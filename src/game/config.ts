/**
 * Central, tunable game configuration. All gameplay numbers live here so the
 * loop can be balanced in one place.
 */
export const CONFIG = {
  /** Bank score. */
  startScore: 1000,
  wrongGuessPenalty: 10, // unique wrong guess
  hintPenalty: 75, // per hint
  maxHints: 3,

  /** Near-win assistance. */
  nearWinRank: 10, // "same neighborhood" message at/under this rank
  assistRank: 5, // optional length/first-letter reveal at/under this rank
  revealFirstLetterOnAssist: false, // off by default (kept gentle)

  /**
   * Reveal animation timing. Scoring is now instant (vector lookup), so this is
   * purely the satisfying cycle duration — kept short so it feels snappy.
   */
  minRevealMs: 650,

  /**
   * Score-aware radial placement (world units from the centre/target). Higher
   * score ⇒ closer to centre.
   */
  landing: {
    farRadius: 16,
    nearRadius: 1.6,
    jitter: 0.6,
  },
} as const;

/** Temperature labels keyed by displayed 0–100 score (descending thresholds). */
export const TEMPERATURE_LABELS: ReadonlyArray<readonly [number, string]> = [
  [100, "Boiling"],
  [82, "Scorching"],
  [66, "Hot"],
  [50, "Warm"],
  [34, "Tepid"],
  [20, "Cool"],
  [10, "Cold"],
  [0, "Freezing"],
];

export const MESSAGES = {
  notInList: "not in word list",
  alreadyGuessed: "already guessed that",
  oneWord: "one word only",
  empty: "type a word",
  lettersOnly: "letters only",
  tooLong: "that's too long",
  roundOver: "round is over",
} as const;
