/** Shared domain types (v2 — GloVe word-vector engine). */

/** A curated playable target plus its precomputed, filtered hints. */
export interface TargetEntry {
  word: string;
  /** Ordered nearest, filtered hint words (best first). */
  hints: string[];
}

export interface TargetsFile {
  version: string;
  targets: TargetEntry[];
}

/** Result of scoring a single word (guess or hint) against the target. */
export interface Scored {
  word: string;
  /** Raw int8 dot product to the target (∝ cosine; internal). */
  similarity: number;
  /** 1 = closest word in the vocabulary. */
  rank: number;
  /** Vocabulary size used for the ranking. */
  outOf: number;
  /** Displayed 0–100 score (log-rank mapped, 2 dp; exact match = 100). */
  score: number;
  /** Temperature label derived from score. */
  label: string;
}

export interface GuessResult extends Scored {
  /** True when the guess canonically equals the target. */
  win: boolean;
}

export type GamePhase = "loading" | "ready" | "revealing" | "won" | "revealed";

