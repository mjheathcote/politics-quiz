#!/usr/bin/env node
/**
 * Monthly data pipeline: for each of the 5 fixed UK-wide parties, calls the
 * Anthropic Messages API once with the web_search tool enabled, asks for that
 * party's current top 6 policies as strict JSON, validates the result against
 * scripts/schema.json, and writes data/YYYY-MM/{partyId}.json.
 *
 * Fully automated / no human review by design:
 *   - On any failure for a party (network error, malformed JSON, schema failure),
 *     the previous month's file for that party is copied forward instead of
 *     writing anything broken or blank. Nothing invalid is ever committed.
 *   - Exit code is non-zero only if a party has NEVER had a valid file (i.e.
 *     there is nothing to fall back to) — that's the one case a human does need
 *     to notice, since the site would be missing a party entirely.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/fetch-policies.mjs
 *   node scripts/fetch-policies.mjs --party green        # single party, for testing
 *   node scripts/fetch-policies.mjs --dry-run             # call + validate, don't write
 *   node scripts/fetch-policies.mjs --month 2026-09        # override target month
 *   node scripts/fetch-policies.mjs --mock                 # no network call at all;
 *                                                            uses scripts/lib/mock-response.mjs
 *                                                            fixtures — for testing parsing/
 *                                                            validation/fallback logic without
 *                                                            an API key
 *
 * Env vars:
 *   ANTHROPIC_API_KEY      required unless --mock
 *   ANTHROPIC_MODEL        default: claude-sonnet-4-5-20250929
 *   WEB_SEARCH_TOOL_TYPE   default: web_search_20250305 (most broadly-supported version;
 *                          bump this if Anthropic ships a newer web_search tool version
 *                          you want to opt into)
 *   WEB_SEARCH_MAX_USES    default: 5
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { validatePartyData, ROOT } from "./lib/schema-validate.mjs";

const DATA_DIR = path.join(ROOT, "data");
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const PARTIES = [
  { id: "labour", name: "Labour Party" },
  { id: "conservative", name: "Conservative Party" },
  { id: "reform", name: "Reform UK" },
  { id: "libdem", name: "Liberal Democrats" },
  { id: "green", name: "Green Party" },
];

function parseArgs(argv) {
  const args = { party: null, dryRun: false, month: null, mock: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--party") args.party = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--month") args.month = argv[++i];
    else if (a === "--mock") args.mock = true;
  }
  return args;
}

function currentMonth() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function buildPrompt(party) {
  return `You are a neutral political-data assistant. Use web search to find the ${party.name}'s CURRENT top 6 policies (UK-wide, as of today) — the policies they are most actively campaigning on or emphasising right now.

Search for recent, authoritative sources: the party's own official website/policy pages first, then recent reputable news coverage if the official site is thin on specifics.

Return ONLY a single JSON object, with no markdown code fences and no commentary before or after it, matching exactly this shape:

{
  "party": "${party.name}",
  "partyId": "${party.id}",
  "asOf": "${today()}",
  "policies": [
    {
      "id": "${party.id}-01",
      "title": "Short policy title (a few words)",
      "statement": "A neutral, factual one-to-two-sentence description of the policy, written in the party's own terms but without campaign slogans or editorializing. 20-400 characters.",
      "sourceUrl": "https://the-actual-source-url-you-found"
    }
  ]
}

Requirements:
- Exactly 6 entries in "policies", ids "${party.id}-01" through "${party.id}-06".
- Every "sourceUrl" must be a real URL you found via search, not invented.
- "statement" must be neutral and factual, not persuasive copy — a reader should not be able to tell which party it's from just by tone.
- Do not include any party name, logo reference, or identifying phrase inside "statement" or "title" — those fields will be shown to quiz users without knowing which party they belong to.
- Output valid JSON only. No \`\`\`json fences, no leading/trailing text.`;
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/** Extracts the first balanced top-level {...} object from a string. */
function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("no '{' found in model output");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("no balanced '}' found — response may have been truncated");
}

async function callAnthropic(party) {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
  const toolType = process.env.WEB_SEARCH_TOOL_TYPE || "web_search_20250305";
  const maxUses = Number(process.env.WEB_SEARCH_MAX_USES || 5);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: buildPrompt(party) }],
      tools: [{ type: toolType, name: "web_search", max_uses: maxUses }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }

  const json = await res.json();
  const textBlocks = (json.content || []).filter((b) => b.type === "text").map((b) => b.text);
  if (textBlocks.length === 0) throw new Error("no text content in API response");
  // The final text block is the model's answer after any search turns.
  return textBlocks[textBlocks.length - 1];
}

async function getMockResponse(party) {
  const { mockResponses } = await import("./lib/mock-response.mjs");
  const resp = mockResponses[party.id];
  if (!resp) throw new Error(`no mock response fixture for ${party.id}`);
  return resp;
}

function findLatestExistingFile(partyId, beforeMonth) {
  if (!existsSync(DATA_DIR)) return null;
  const months = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .filter((m) => !beforeMonth || m < beforeMonth)
    .sort()
    .reverse();
  for (const month of months) {
    const file = path.join(DATA_DIR, month, `${partyId}.json`);
    if (existsSync(file)) return file;
  }
  return null;
}

async function processParty(party, { month, dryRun, mock }) {
  const label = party.id;
  let rawText;
  try {
    rawText = mock ? await getMockResponse(party) : await callAnthropic(party);
  } catch (err) {
    return fallback(party, month, dryRun, `API call failed: ${err.message}`);
  }

  let parsed;
  try {
    const stripped = stripCodeFences(rawText);
    const jsonText = extractJsonObject(stripped);
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return fallback(party, month, dryRun, `parse failed: ${err.message}`);
  }

  const result = validatePartyData(party.id, parsed);
  if (!result.ok) {
    return fallback(party, month, dryRun, `schema validation failed: ${result.errors.join("; ")}`);
  }

  if (dryRun) {
    console.log(`✓ ${label}: fetched + validated OK (dry run, not written)`);
    console.log(JSON.stringify(parsed, null, 2));
    return { partyId: party.id, status: "fresh", written: false };
  }

  const monthDir = path.join(DATA_DIR, month);
  mkdirSync(monthDir, { recursive: true });
  writeFileSync(path.join(monthDir, `${party.id}.json`), JSON.stringify(parsed, null, 2) + "\n");
  console.log(`✓ ${label}: fetched + validated OK, wrote data/${month}/${party.id}.json`);
  return { partyId: party.id, status: "fresh", written: true };
}

function fallback(party, month, dryRun, reason) {
  console.warn(`⚠ ${party.id}: ${reason}`);

  const currentMonthFile = path.join(DATA_DIR, month, `${party.id}.json`);
  if (existsSync(currentMonthFile)) {
    console.warn(`  → keeping already-written data/${month}/${party.id}.json for this run`);
    return { partyId: party.id, status: "kept-current", written: true };
  }

  const prevFile = findLatestExistingFile(party.id, month);
  if (!prevFile) {
    console.error(`✗ ${party.id}: no fallback available — this party has NEVER had a valid file`);
    return { partyId: party.id, status: "missing", written: false };
  }

  const prevMonth = path.basename(path.dirname(prevFile));
  console.warn(`  → falling back to data/${prevMonth}/${party.id}.json (carried forward, unchanged)`);
  if (dryRun) {
    return { partyId: party.id, status: "fallback", written: false, fallbackFrom: prevMonth };
  }

  const data = JSON.parse(readFileSync(prevFile, "utf8"));
  const monthDir = path.join(DATA_DIR, month);
  mkdirSync(monthDir, { recursive: true });
  writeFileSync(path.join(monthDir, `${party.id}.json`), JSON.stringify(data, null, 2) + "\n");
  return { partyId: party.id, status: "fallback", written: true, fallbackFrom: prevMonth };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const month = args.month || currentMonth();
  const parties = args.party ? PARTIES.filter((p) => p.id === args.party) : PARTIES;

  if (args.party && parties.length === 0) {
    console.error(`Unknown --party "${args.party}". Valid: ${PARTIES.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  console.log(`Running fetch-policies for month=${month}${args.mock ? " (MOCK, no network)" : ""}${args.dryRun ? " (DRY RUN)" : ""}\n`);

  const results = [];
  for (const party of parties) {
    // Run sequentially — keeps API usage/log output easy to read and avoids
    // rate-limit surprises; 5 parties is small enough that this is fast anyway.
    results.push(await processParty(party, { month, dryRun: args.dryRun, mock: args.mock }));
  }

  console.log("\nSummary:");
  for (const r of results) console.log(`  ${r.partyId}: ${r.status}${r.fallbackFrom ? ` (from ${r.fallbackFrom})` : ""}`);

  const missing = results.filter((r) => r.status === "missing");
  if (missing.length > 0) {
    console.error(`\n${missing.length} part${missing.length === 1 ? "y has" : "ies have"} no data at all: ${missing.map((r) => r.partyId).join(", ")}`);
    process.exit(1);
  }

  console.log("\nDone — every party has a valid file for this month (fresh or carried forward).");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
