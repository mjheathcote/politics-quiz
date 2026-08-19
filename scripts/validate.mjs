#!/usr/bin/env node
/**
 * Validates every data/YYYY-MM/{partyId}.json file against scripts/schema.json.
 *
 * Usage:
 *   node scripts/validate.mjs [YYYY-MM]
 *
 * If a month is not given, validates the most recent data/ directory.
 * Exits non-zero on any failure so it can be used as a CI / pipeline gate.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { validatePartyData, ROOT } from "./lib/schema-validate.mjs";

const DATA_DIR = path.join(ROOT, "data");
const REQUIRED_PARTY_IDS = ["labour", "conservative", "reform", "libdem", "green"];

function latestMonthDir() {
  const months = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (months.length === 0) {
    throw new Error(`No month directories found under ${DATA_DIR}`);
  }
  return months[months.length - 1];
}

function main() {
  const month = process.argv[2] || latestMonthDir();
  const monthDir = path.join(DATA_DIR, month);
  if (!existsSync(monthDir)) {
    console.error(`✗ Month directory not found: ${monthDir}`);
    process.exit(1);
  }

  let failed = false;
  const seenIds = new Set();

  for (const partyId of REQUIRED_PARTY_IDS) {
    const file = path.join(monthDir, `${partyId}.json`);
    if (!existsSync(file)) {
      console.error(`✗ ${partyId}: missing file ${file}`);
      failed = true;
      continue;
    }

    let data;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`✗ ${partyId}: invalid JSON — ${err.message}`);
      failed = true;
      continue;
    }

    const result = validatePartyData(partyId, data);
    if (!result.ok) {
      console.error(`✗ ${partyId}: schema errors`);
      for (const err of result.errors) console.error(`    ${err}`);
      failed = true;
      continue;
    }

    for (const policy of data.policies) {
      if (seenIds.has(policy.id)) {
        console.error(`✗ ${partyId}: duplicate policy id "${policy.id}" across data set`);
        failed = true;
      }
      seenIds.add(policy.id);
    }

    console.log(`✓ ${partyId}: 6 policies, schema OK`);
  }

  if (failed) {
    console.error(`\nValidation FAILED for ${month}`);
    process.exit(1);
  }

  console.log(`\nAll 5 party files valid for ${month}.`);
}

main();
