// Run with: node --test src/lib/scoring.test.ts
// Exercises scoring.ts against the real hand-written sample data in
// data/2026-08/*.json (step 1's output), per the build plan's step 3: "Build and
// test scoring logic against the hardcoded sample JSON from step 1."
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  buildQuizPool,
  scoreParties,
  rankParties,
  getDrivingStatements,
  buildResults,
  shuffle,
  seededRng,
  PoolValidationError,
} from "./scoring.ts";
import { PARTY_IDS, type PartyData, type Answers, type ScaleValue } from "./types.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SAMPLE_MONTH = "2026-08";

function loadSampleData(): PartyData[] {
  const dir = path.join(ROOT, "data", SAMPLE_MONTH);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as PartyData);
}

describe("buildQuizPool", () => {
  test("produces exactly 30 statements from the 5 sample files, none identifying", () => {
    const { quizStatements, answerKey } = buildQuizPool(loadSampleData());
    assert.equal(quizStatements.length, 30);
    assert.equal(Object.keys(answerKey).length, 30);

    for (const s of quizStatements) {
      assert.equal(Object.keys(s).length, 2, `quiz statement ${s.id} must only expose id+statement`);
      assert.ok(!("partyId" in s), "partyId must not be present on quiz statements");
      assert.ok(!("sourceUrl" in s), "sourceUrl must not be present on quiz statements");
    }
  });

  test("every party contributes exactly 6 statements to the pool", () => {
    const { answerKey } = buildQuizPool(loadSampleData());
    const counts = new Map<string, number>();
    for (const entry of Object.values(answerKey)) {
      counts.set(entry.partyId, (counts.get(entry.partyId) ?? 0) + 1);
    }
    for (const id of PARTY_IDS) assert.equal(counts.get(id), 6, `${id} should contribute 6`);
  });

  test("rejects a pool missing a party", () => {
    const data = loadSampleData().filter((p) => p.partyId !== "green");
    assert.throws(() => buildQuizPool(data), PoolValidationError);
  });

  test("rejects a party with the wrong number of policies", () => {
    const data = loadSampleData();
    const withBadGreen = data.map((p) =>
      p.partyId === "green" ? { ...p, policies: p.policies.slice(0, 5) } : p,
    );
    assert.throws(() => buildQuizPool(withBadGreen), PoolValidationError);
  });

  test("rejects duplicate statement ids across parties", () => {
    const data = loadSampleData();
    const collided = data.map((p, i) =>
      i === 0 ? { ...p, policies: [{ ...p.policies[0], id: data[1].policies[0].id }, ...p.policies.slice(1)] } : p,
    );
    assert.throws(() => buildQuizPool(collided), PoolValidationError);
  });
});

describe("shuffle", () => {
  test("preserves all elements (just reorders)", () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const shuffled = shuffle(items, seededRng(42));
    assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
  });

  test("seededRng is deterministic across calls", () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const a = shuffle(items, seededRng(7));
    const b = shuffle(items, seededRng(7));
    assert.deepEqual(a, b);
  });

  test("does not mutate the input array", () => {
    const items = [1, 2, 3, 4, 5];
    const copy = items.slice();
    shuffle(items, seededRng(1));
    assert.deepEqual(items, copy);
  });
});

describe("scoreParties / rankParties", () => {
  const { answerKey } = buildQuizPool(loadSampleData());

  function idsFor(partyId: string): string[] {
    return Object.values(answerKey)
      .filter((e) => e.partyId === partyId)
      .map((e) => e.id);
  }

  test("averages only the statements the user actually answered, per party", () => {
    const greenIds = idsFor("green");
    const answers: Answers = {
      [greenIds[0]]: 5,
      [greenIds[1]]: 3,
      // greenIds[2..5] intentionally left unanswered
    };
    const scores = scoreParties(answers, answerKey);
    const green = scores.find((s) => s.partyId === "green")!;
    assert.equal(green.answeredCount, 2);
    assert.equal(green.totalCount, 6);
    assert.equal(green.averageScore, 4); // (5+3)/2
  });

  test("a party with zero answers gets averageScore null, not zero", () => {
    const scores = scoreParties({ [idsFor("labour")[0]]: 5 }, answerKey);
    const green = scores.find((s) => s.partyId === "green")!;
    assert.equal(green.answeredCount, 0);
    assert.equal(green.averageScore, null);
  });

  test("rankParties sorts by averageScore descending, nulls last", () => {
    const answers: Answers = {
      [idsFor("green")[0]]: 5,
      [idsFor("reform")[0]]: 1,
      [idsFor("labour")[0]]: 3,
      // conservative, libdem left fully unanswered -> null
    };
    const ranked = rankParties(scoreParties(answers, answerKey));
    assert.equal(ranked[0].partyId, "green");
    assert.equal(ranked[1].partyId, "labour");
    assert.equal(ranked[2].partyId, "reform");
    // last two (null averages) can be in either relative order, but must be last
    assert.deepEqual(
      new Set(ranked.slice(3).map((r) => r.partyId)),
      new Set(["conservative", "libdem"]),
    );
    assert.ok(ranked.slice(3).every((r) => r.averageScore === null));
  });
});

describe("getDrivingStatements", () => {
  const { answerKey } = buildQuizPool(loadSampleData());
  function idsFor(partyId: string): string[] {
    return Object.values(answerKey)
      .filter((e) => e.partyId === partyId)
      .map((e) => e.id);
  }

  test("'best' direction prefers highest-scored (agree/strongly agree) statements", () => {
    const [a, b, c, d] = idsFor("green");
    const answers: Answers = { [a]: 5, [b]: 4, [c]: 2, [d]: 3 };
    const drivers = getDrivingStatements("green", answers, answerKey, "best");
    assert.equal(drivers.length, 2); // only 2 statements scored >=4
    assert.deepEqual(drivers.map((s) => s.id), [a, b]);
  });

  test("'worst' direction prefers lowest-scored (disagree/strongly disagree) statements", () => {
    const [a, b, c, d] = idsFor("reform");
    const answers: Answers = { [a]: 1, [b]: 2, [c]: 4, [d]: 3 };
    const drivers = getDrivingStatements("reform", answers, answerKey, "worst");
    assert.equal(drivers.length, 2); // only 2 statements scored <=2
    assert.deepEqual(drivers.map((s) => s.id), [a, b]);
  });

  test("falls back to most-extreme answers when nothing crosses the agree/disagree bar", () => {
    // All neutral (3) — no statement is >=4, so "best" should fall back to the
    // full answered set rather than returning nothing.
    const [a, b, c] = idsFor("libdem");
    const answers: Answers = { [a]: 3, [b]: 3, [c]: 3 };
    const drivers = getDrivingStatements("libdem", answers, answerKey, "best");
    assert.equal(drivers.length, 3);
  });

  test("caps at 3 driving statements even with 6 extreme answers", () => {
    const ids = idsFor("conservative");
    const answers: Answers = Object.fromEntries(ids.map((id) => [id, 5])) as Answers;
    const drivers = getDrivingStatements("conservative", answers, answerKey, "best");
    assert.equal(drivers.length, 3);
  });

  test("only considers answered statements, never unanswered ones", () => {
    const [a] = idsFor("green");
    const drivers = getDrivingStatements("green", { [a]: 5 }, answerKey, "best");
    assert.equal(drivers.length, 1);
  });
});

describe("buildResults (end-to-end)", () => {
  const { answerKey } = buildQuizPool(loadSampleData());
  function idsFor(partyId: string): string[] {
    return Object.values(answerKey)
      .filter((e) => e.partyId === partyId)
      .map((e) => e.id);
  }

  test("a user who agrees with every Green statement and disagrees with every Reform statement gets Green best, Reform worst", () => {
    const answers: Answers = {};
    for (const id of idsFor("green")) answers[id] = 5;
    for (const id of idsFor("reform")) answers[id] = 1;
    // answer everything else neutrally so the quiz counts as "fully answered"
    for (const id of idsFor("labour")) answers[id] = 3;
    for (const id of idsFor("conservative")) answers[id] = 3;
    for (const id of idsFor("libdem")) answers[id] = 3;

    const results = buildResults(answers, answerKey);
    assert.equal(results.best!.partyId, "green");
    assert.equal(results.worst!.partyId, "reform");
    assert.equal(results.best!.drivingStatements.length, 3);
    assert.ok(results.best!.drivingStatements.every((s) => s.score === 5));
    assert.equal(results.worst!.drivingStatements.length, 3);
    assert.ok(results.worst!.drivingStatements.every((s) => s.score === 1));
    assert.equal(results.lowConfidence, false); // all 30 answered
  });

  test("partyId and sourceUrl are present in the result (reveal step reintroduces them)", () => {
    const answers: Answers = {};
    for (const id of idsFor("green")) answers[id] = 5;
    const results = buildResults(answers, answerKey);
    assert.equal(results.best!.partyId, "green");
    assert.ok(results.best!.drivingStatements[0].sourceUrl.startsWith("https://"));
  });

  test("flags lowConfidence when very few statements were answered", () => {
    const [a, b] = idsFor("green");
    const results = buildResults({ [a]: 5, [b]: 5 }, answerKey);
    assert.equal(results.lowConfidence, true);
  });

  test("worst is null when only one party has any answers (nothing to contrast)", () => {
    const answers: Answers = {};
    for (const id of idsFor("green")) answers[id] = 5;
    const results = buildResults(answers, answerKey);
    assert.equal(results.worst, null);
    assert.equal(results.best!.partyId, "green");
  });

  test("handles a completely empty answer set without throwing", () => {
    const results = buildResults({}, answerKey);
    assert.equal(results.best, null);
    assert.equal(results.secondBest, null);
    assert.equal(results.worst, null);
    assert.equal(results.lowConfidence, true);
    assert.equal(results.rankings.length, 5);
    assert.ok(results.rankings.every((r) => r.averageScore === null));
  });
});
