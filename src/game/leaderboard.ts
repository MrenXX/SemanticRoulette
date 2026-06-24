/** Personal best runs, persisted in localStorage (per browser). */
export interface Run {
  word: string;
  /** Final bank score on a win (higher is better). */
  score: number;
  guesses: number;
  hints: number;
  date: number;
}

const KEY = "semantic-roulette:best-runs";
const MAX = 10;

export function loadRuns(): Run[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const runs = JSON.parse(raw) as Run[];
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

export interface RecordResult {
  runs: Run[];
  /** 1-based position in the leaderboard, or -1 if it didn't place. */
  rank: number;
  /** True if this is the new top score. */
  isBest: boolean;
}

/** Record a won run, returning the updated board and where it placed. */
export function recordRun(run: Run): RecordResult {
  const runs = loadRuns();
  runs.push(run);
  runs.sort((a, b) => b.score - a.score || a.guesses - b.guesses || a.date - b.date);
  const trimmed = runs.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* storage unavailable — leaderboard is best-effort */
  }
  const rank = trimmed.indexOf(run) + 1;
  return { runs: trimmed, rank: rank || -1, isBest: rank === 1 };
}
