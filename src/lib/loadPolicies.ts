// Build-time only (uses node:fs) — never imported into client bundles. Finds the
// latest data/YYYY-MM/ directory, loads all 5 party files, and builds the quiz
// pool once per build via scoring.ts's buildQuizPool(). Both index.astro (for the
// public quiz statements) and answer-key.json.ts (for the private answer key)
// import getQuizPool() so the data is only read and validated once per build.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildQuizPool, shuffle, seededRng } from "./scoring.ts";
import type { PartyData } from "./types.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DATA_DIR = path.join(ROOT, "data");

function latestMonthDir(): string {
  const months = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort();
  if (months.length === 0) {
    throw new Error(`No month directories found under ${DATA_DIR} — run the data pipeline first.`);
  }
  return months[months.length - 1];
}

function loadPartyData(month: string): PartyData[] {
  const dir = path.join(DATA_DIR, month);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as PartyData);
}

/** Stable per-month seed so the build-time shuffle order doesn't depend on
 * Math.random() (keeps builds reproducible) while still breaking up any
 * party-clustering signal from the on-disk file read order. Each visitor's
 * browser reshuffles again on top of this — see quizApp.ts — so this isn't the
 * only source of randomness, just a defensive first pass. */
function monthSeed(month: string): number {
  let h = 0;
  for (const ch of month) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

type QuizPool = ReturnType<typeof buildQuizPool> & { month: string };

let cached: QuizPool | null = null;

export function getQuizPool(): QuizPool {
  if (cached) return cached;
  const month = latestMonthDir();
  const pool = buildQuizPool(loadPartyData(month));
  const quizStatements = shuffle(pool.quizStatements, seededRng(monthSeed(month)));
  cached = { ...pool, quizStatements, month };
  return cached;
}
