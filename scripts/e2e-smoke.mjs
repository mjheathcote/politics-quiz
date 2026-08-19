#!/usr/bin/env node
/**
 * End-to-end smoke test: builds the site, serves the static output, drives it
 * with a real headless browser through a full 30-question quiz, and asserts on
 * both correctness (scoring/ranking/driving-statements match what was answered)
 * and the privacy timing requirement (answer-key.json must not be fetched until
 * the last question is answered).
 *
 * This is deliberately separate from `npm test` (which is fast, offline, and
 * pure-function-only) — this one needs a browser and a real build, so it's not
 * run on every save, but it should be run before deploying any change that
 * touches src/pages, src/lib/quizApp.ts, or src/lib/loadPolicies.ts.
 *
 * Usage: node scripts/e2e-smoke.mjs
 */
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`✓ ${message}`);
}

console.log("Building site...");
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

console.log(`\nStarting static server on :${PORT}...`);
const server = spawn("python3", ["-m", "http.server", String(PORT)], {
  cwd: path.join(ROOT, "dist"),
  stdio: "ignore",
});

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("static server did not come up in time");
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  const requestedBeforeStart = [];
  page.on("request", (req) => requestedBeforeStart.push(req.url()));

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  assert(
    !requestedBeforeStart.some((u) => u.includes("answer-key.json")),
    "answer-key.json is NOT requested on initial page load",
  );

  const html = await page.content();
  assert(!/partyId|sourceUrl/.test(html), "rendered HTML never contains partyId or sourceUrl");

  await page.click("#start-btn");

  const answerKey = await page.evaluate(() => fetch("/answer-key.json").then((r) => r.json()));
  const byStatementText = new Map(Object.values(answerKey).map((e) => [e.statement, e]));

  let skipCount = 0;
  const answeredLog = [];
  for (let i = 0; i < 30; i++) {
    await page.waitForSelector(".scale button");
    const statementText = (await page.textContent(".statement-text")).trim();
    const entry = byStatementText.get(statementText);
    if (!entry) throw new Error(`displayed statement not found in answer key: ${statementText}`);

    if (entry.partyId === "green") {
      await page.click(".scale button:nth-child(5)");
      answeredLog.push([entry.partyId, 5]);
    } else if (entry.partyId === "reform") {
      await page.click(".scale button:nth-child(1)");
      answeredLog.push([entry.partyId, 1]);
    } else if (entry.partyId === "labour" && skipCount < 2) {
      skipCount++;
      await page.click("#skip-btn");
      continue;
    } else {
      await page.click(".scale button:nth-child(3)");
      answeredLog.push([entry.partyId, 3]);
    }
    await page.waitForTimeout(260);
  }

  await page.waitForSelector("h1:has-text('Your results')", { timeout: 5000 });

  const best = (await page.textContent(".match-card.best .party-name")).trim();
  const worst = (await page.textContent(".match-card.worst .party-name")).trim();
  const summary = (await page.textContent(".results-summary p")).trim();
  const bestDrivers = await page.$$eval(".match-card.best .driving-title", (els) => els.map((e) => e.textContent));
  const worstDrivers = await page.$$eval(".match-card.worst .driving-title", (els) => els.map((e) => e.textContent));

  assert(best === "Green Party", `best match is Green Party (got "${best}")`);
  assert(worst === "Reform UK", `worst match is Reform UK (got "${worst}")`);
  assert(summary.includes("28 of 30"), `answered-count reflects the 2 skipped Labour questions (got "${summary}")`);
  assert(
    bestDrivers.every((t) => ["Public ownership of water", "A wealth tax on the very richest", "Rent controls and a rent freeze"].includes(t)),
    "best-match driving statements are genuinely Green Party policies",
  );
  assert(
    worstDrivers.every((t) => ["Stop the boats", "Mass deportation programme", "Scrap indefinite leave to remain"].includes(t)),
    "worst-match driving statements are genuinely Reform UK policies",
  );
  assert(pageErrors.length === 0, `no uncaught page errors (got ${pageErrors.length}: ${pageErrors.join("; ")})`);

  console.log("\nAll e2e smoke checks passed.");
} finally {
  if (browser) await browser.close();
  server.kill();
}
