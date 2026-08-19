// Shared types for the quiz engine and scoring logic. Mirrors scripts/schema.json.

export type PartyId = "labour" | "conservative" | "reform" | "libdem" | "green";

export const PARTY_IDS: PartyId[] = ["labour", "conservative", "reform", "libdem", "green"];

/** One policy entry exactly as it appears in data/YYYY-MM/{partyId}.json. */
export interface Policy {
  id: string;
  title: string;
  statement: string;
  sourceUrl: string;
}

/** One full party-month data file, as loaded from disk at build time. */
export interface PartyData {
  party: string;
  partyId: PartyId;
  asOf: string;
  policies: Policy[];
}

/**
 * What the quiz-rendering client is allowed to see. No partyId, no sourceUrl, no
 * party name or title (title alone is often identifying, e.g. "Stop the boats") —
 * only the neutral statement text and an opaque id.
 */
export interface QuizStatement {
  id: string;
  statement: string;
}

/**
 * What gets reintroduced at reveal time, keyed by statement id. This is the file
 * that must never be fetched by the client until the quiz is complete (see
 * README's "Privacy design" section).
 */
export interface AnswerKeyEntry {
  id: string;
  partyId: PartyId;
  party: string;
  title: string;
  statement: string;
  sourceUrl: string;
}

export type AnswerKey = Record<string, AnswerKeyEntry>;

/** 5-point agreement scale. Stored client-side as { [statementId]: score }. */
export const SCALE = {
  STRONGLY_DISAGREE: 1,
  DISAGREE: 2,
  NEUTRAL: 3,
  AGREE: 4,
  STRONGLY_AGREE: 5,
} as const;

export type ScaleValue = 1 | 2 | 3 | 4 | 5;

/** Client-side answer store: statement id -> score. Only ids the user has
 * actually answered are present as keys (no entry = unanswered, not neutral). */
export type Answers = Record<string, ScaleValue>;

export interface PartyScore {
  partyId: PartyId;
  party: string;
  /** Average of the user's scores across this party's statements they answered,
   * on the 1-5 scale. `null` if the user answered none of this party's statements. */
  averageScore: number | null;
  answeredCount: number;
  totalCount: number;
}

export interface DrivingStatement {
  id: string;
  title: string;
  statement: string;
  sourceUrl: string;
  score: ScaleValue;
}

export interface PartyMatch {
  partyId: PartyId;
  party: string;
  averageScore: number | null;
  answeredCount: number;
  totalCount: number;
  /** The 2-3 statements belonging to this party that most drove the result:
   * highest-scored for a "best" match, lowest-scored for a "worst" match. */
  drivingStatements: DrivingStatement[];
}

export interface QuizResults {
  rankings: PartyScore[];
  best: PartyMatch | null;
  secondBest: PartyMatch | null;
  worst: PartyMatch | null;
  /** True if the user answered too few statements (e.g. all from one party, or a
   * near-empty quiz) for the ranking to be meaningful. UI should show a caveat. */
  lowConfidence: boolean;
}
