import { TEMPERATURE_LABELS } from "./config.js";

/**
 * Rank of a guess among the vocabulary by similarity-to-target.
 * `sortedDescSims` is the descending similarity of the target to every other
 * word. rank = 1 + (#words strictly closer than the guess).
 */
export function rankOf(simTargetGuess: number, sortedDescSims: ArrayLike<number>): number {
  let lo = 0;
  let hi = sortedDescSims.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDescSims[mid] > simTargetGuess) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

/**
 * Logarithmic rank → 0–100 score, kept as a float (2 dp) so the count-up
 * "lands" on a satisfying decimal. Exact match = 100.
 */
export function logRankScore(rank: number, vocabSize: number): number {
  if (rank <= 0) return 100;
  const s = 100 * (1 - Math.log(rank + 1) / Math.log(vocabSize + 1));
  return Math.round(Math.max(0, Math.min(100, s)) * 100) / 100;
}

export function temperatureLabel(score: number): string {
  for (const [threshold, name] of TEMPERATURE_LABELS) {
    if (score >= threshold) return name;
  }
  return "Freezing";
}

/** Normalized progress in [0,1] used to drive the score-aware landing radius. */
export function scoreFraction(score: number): number {
  return Math.max(0, Math.min(1, score / 100));
}
