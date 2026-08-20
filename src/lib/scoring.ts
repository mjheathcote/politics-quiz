// Pure functions: no DOM, no fetch, no build-time I/O. Takes party data already in
// memory and produces quiz pools / scores / results. This is what step 3 tests.
import {
  PARTY_IDS,
  type PartyData,
  type PartyId,
  type QuizStatement,
  type AnswerKey,
  type AnswerKeyEntry,
  type Answers,
  type PartyScore,
  type PartyMatch,
  type DrivingStatement,
  type QuizResults,
} from "./types.ts";

const POLICIES_PER_PARTY = 6;
const DRIVING_STATEMENTS_MIN = 2;
const DRIVING_STATEMENTS_MAX = 3;
/** Below this many total answers, a ranking is technically computable but not
 * meaningful — flagged via QuizResults.lowConfidence rather than hidden, so the
 * UI can decide how to present it. */
const LOW_CONFIDENCE_THRESHOLD = 10;

export class PoolValidationError extends Error {}

/**
 * Splits the 5 loaded party files into the two artifacts described in the
 * README's privacy design: a public quiz pool (id + statement only) and a
 * private answer key (everything else), keyed by statement id.
 */
export function buildQuizPool(partyDataList: PartyData[]): {
  quizStatements: QuizStatement[];
  answerKey: AnswerKey;
} {
  const foundPartyIds = new Set(partyDataList.map((p) => p.partyId));
  for (const id of PARTY_IDS) {
    if (!foundPartyIds.has(id)) {
      throw new PoolValidationError(`missing party data for "${id}"`);
    }
  }
  if (partyDataList.length !== PARTY_IDS.length) {
    throw new PoolValidationError(
      `expected exactly ${PARTY_IDS.length} parties, got ${partyDataList.length}`,
    );
  }

  const quizStatements: QuizStatement[] = [];
  const answerKey: AnswerKey = {};

  for (const party of partyDataList) {
    if (party.policies.length !== POLICIES_PER_PARTY) {
      throw new PoolValidationError(
        `"${party.partyId}" has ${party.policies.length} policies, expected ${POLICIES_PER_PARTY}`,
      );
    }
    for (const policy of party.policies) {
      if (answerKey[policy.id]) {
        throw new PoolValidationError(`duplicate statement id "${policy.id}" across parties`);
      }
      quizStatements.push({ id: policy.id, statement: policy.statement });
      answerKey[policy.id] = {
        id: policy.id,
        partyId: party.partyId,
        party: party.party,
        title: policy.title,
        statement: policy.statement,
        sourceUrl: policy.sourceUrl,
      };
    }
  }

  return { quizStatements, answerKey };
}

/**
 * Fisher-Yates shuffle. Accepts an injectable RNG (defaults to Math.random) so
 * tests can assert deterministic ordering with a seeded generator.
 */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Small deterministic PRNG for tests (mulberry32) — not for production shuffling. */
export function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scores each of the 5 parties from the statements the user actually answered,
 * normalized by how many of that party's statements were answered (a plain
 * average, so answering 2 vs 6 of a party's statements is comparable).
 */
export function scoreParties(answers: Answers, answerKey: AnswerKey): PartyScore[] {
  const byParty = new Map<PartyId, { party: string; sum: number; count: number; total: number }>();
  for (const id of PARTY_IDS) byParty.set(id, { party: "", sum: 0, count: 0, total: 0 });

  for (const entry of Object.values(answerKey)) {
    const bucket = byParty.get(entry.partyId)!;
    bucket.party = entry.party;
    bucket.total += 1;
    const score = answers[entry.id];
    if (score !== undefined) {
      bucket.sum += score;
      bucket.count += 1;
    }
  }

  return PARTY_IDS.map((partyId) => {
    const b = byParty.get(partyId)!;
    return {
      partyId,
      party: b.party,
      averageScore: b.count > 0 ? b.sum / b.count : null,
      answeredCount: b.count,
      totalCount: b.total,
    };
  });
}

/** Ranks scored parties best-first. Parties with no answers (averageScore===null)
 * sort to the bottom, below every scored party, since "no data" isn't "worst". */
export function rankParties(scores: PartyScore[]): PartyScore[] {
  return scores.slice().sort((a, b) => {
    if (a.averageScore === null && b.averageScore === null) return 0;
    if (a.averageScore === null) return 1;
    if (b.averageScore === null) return -1;
    return b.averageScore - a.averageScore;
  });
}

/**
 * Picks the 2-3 statements belonging to `partyId` that most drove the result:
 * highest-scored answers for direction "best", lowest-scored for "worst".
 * Only statements the user actually answered are eligible.
 */
export function getDrivingStatements(
  partyId: PartyId,
  answers: Answers,
  answerKey: AnswerKey,
  direction: "best" | "worst",
): DrivingStatement[] {
  const answered = Object.values(answerKey)
    .filter((e) => e.partyId === partyId && answers[e.id] !== undefined)
    .map((e) => ({
      id: e.id,
      title: e.title,
      statement: e.statement,
      sourceUrl: e.sourceUrl,
      score: answers[e.id],
    }));

  answered.sort((a, b) => (direction === "best" ? b.score - a.score : a.score - b.score));

  // For a "best" match, only statements the user actually agreed with (>=4) are
  // meaningful drivers; for "worst", only ones they disagreed with (<=2). If
  // there aren't enough of those, fall back to whatever's most extreme rather
  // than padding with neutral statements that didn't really drive anything.
  const meaningful = answered.filter((s) => (direction === "best" ? s.score >= 4 : s.score <= 2));
  const pool = meaningful.length >= DRIVING_STATEMENTS_MIN ? meaningful : answered;

  return pool.slice(0, DRIVING_STATEMENTS_MAX);
}

function toMatch(score: PartyScore, answers: Answers, answerKey: AnswerKey, direction: "best" | "worst"): PartyMatch {
  return {
    ...score,
    drivingStatements: getDrivingStatements(score.partyId, answers, answerKey, direction),
  };
}

/** Rounds to the same precision the UI displays (`toFixed(1)`), so a tie is
 * defined by what the user actually sees, not by imperceptible float noise. */
function roundForDisplay(score: number): number {
  return Math.round(score * 10) / 10;
}

/** Longest prefix of a descending-sorted, fully-scored list that shares the
 * leader's rounded score. */
function tiedPrefix(sortedScored: PartyScore[]): PartyScore[] {
  if (sortedScored.length === 0) return [];
  const top = roundForDisplay(sortedScored[0].averageScore!);
  const group: PartyScore[] = [];
  for (const s of sortedScored) {
    if (roundForDisplay(s.averageScore!) !== top) break;
    group.push(s);
  }
  return group;
}

/** Longest suffix of a descending-sorted, fully-scored list that shares the
 * last party's rounded score. */
function tiedSuffix(sortedScored: PartyScore[]): PartyScore[] {
  if (sortedScored.length === 0) return [];
  const bottom = roundForDisplay(sortedScored[sortedScored.length - 1].averageScore!);
  const group: PartyScore[] = [];
  for (let i = sortedScored.length - 1; i >= 0; i--) {
    if (roundForDisplay(sortedScored[i].averageScore!) !== bottom) break;
    group.unshift(sortedScored[i]);
  }
  return group;
}

/**
 * Assembles the full reveal: ranked list, best/second-best/worst matches each
 * with their driving statements (partyId + sourceUrl reintroduced here, and only
 * here — this function is only ever called after the quiz is complete).
 */
export function buildResults(answers: Answers, answerKey: AnswerKey): QuizResults {
  const totalAnswered = Object.keys(answers).length;
  const rankings = rankParties(scoreParties(answers, answerKey));
  const scored = rankings.filter((r) => r.averageScore !== null);

  const bestGroup = tiedPrefix(scored);
  const bestTie = bestGroup.map((s) => toMatch(s, answers, answerKey, "best"));
  const best = bestTie[0] ?? null;

  // "Second-best" only makes sense when there's a single, unambiguous leader.
  const secondBest =
    bestGroup.length <= 1 && scored[1] ? toMatch(scored[1], answers, answerKey, "best") : null;

  // Worst is meaningless if there's only one scored party, or if every scored
  // party is tied with the leader (nothing to contrast against).
  let worstGroup = scored.length >= 2 ? tiedSuffix(scored) : [];
  if (worstGroup.length === scored.length && bestGroup.length === scored.length) worstGroup = [];
  const worstTie = worstGroup.map((s) => toMatch(s, answers, answerKey, "worst"));
  const worst = worstTie[0] ?? null;

  return {
    rankings,
    bestTie,
    best,
    secondBest,
    worstTie,
    worst,
    lowConfidence: totalAnswered < LOW_CONFIDENCE_THRESHOLD,
  };
}
