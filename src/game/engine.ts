import { CONFIG, MESSAGES } from "./config.js";
import type { TargetEntry, GuessResult, Scored, GamePhase } from "./types.js";
import { VectorStore } from "./vectors.js";
import { rankOf, logRankScore, temperatureLabel } from "./scoring.js";
import { validateGuess, canonicalize } from "./canonicalize.js";
import { sameConcept } from "./hints.js";

export type Precheck =
  | { ok: false; reason: string }
  | { ok: true; clean: string; canon: string; win: boolean; idx: number };

export interface Commit {
  result: GuessResult;
  assist: string | null;
}

export type HintResponse =
  | { ok: false; reason: string }
  | { ok: true; scored: Scored; bank: number; remaining: number };

/**
 * Core game state machine (v2). Scoring is instant: a guess is looked up in the
 * word-vector store and ranked against the whole vocabulary. No async inference.
 */
export class GameEngine {
  readonly store: VectorStore;
  private readonly targets: TargetEntry[];

  private target!: TargetEntry;
  private targetIndex = -1;
  private targetCanon = "";
  private sortedSims: Int32Array = new Int32Array(0);
  private readonly guessedCanon = new Set<string>();

  phase: GamePhase = "loading";
  bank: number = CONFIG.startScore;
  hintsUsed = 0;
  guesses: GuessResult[] = [];
  revealedHints: Scored[] = [];

  constructor(store: VectorStore, targets: TargetEntry[]) {
    this.store = store;
    // Keep only targets that exist in the vector vocabulary.
    this.targets = targets.filter((t) => store.has(t.word));
  }

  /** Begin a new round. Optionally force a specific target (for demos/tests). */
  startRound(targetWord?: string): void {
    const pool = this.targets;
    this.target =
      (targetWord && pool.find((t) => t.word === targetWord)) ||
      pool[Math.floor(Math.random() * pool.length)];
    this.targetIndex = this.store.indexOf(this.target.word);
    this.targetCanon = canonicalize(this.target.word);
    this.sortedSims = this.store.sortedSimsFrom(this.targetIndex);

    this.bank = CONFIG.startScore;
    this.hintsUsed = 0;
    this.guesses = [];
    this.revealedHints = [];
    this.guessedCanon.clear();
    this.phase = "ready";
  }

  get hintsRemaining(): number {
    return CONFIG.maxHints - this.hintsUsed;
  }

  /** Best (highest) score guessed so far this round. */
  get bestScore(): number {
    return this.guesses.reduce((m, g) => Math.max(m, g.score), 0);
  }

  get solution(): string {
    return this.target.word;
  }

  private scoreWord(word: string, idx: number): Scored {
    const sim = this.store.dot(this.targetIndex, idx);
    const rank = rankOf(sim, this.sortedSims);
    const score = logRankScore(rank, this.store.count);
    return { word, similarity: sim, rank, outOf: this.store.count, score, label: temperatureLabel(score) };
  }

  /** Synchronous gate: validate, dedupe, win-detect, and out-of-vocabulary check. */
  precheck(raw: string): Precheck {
    if (this.phase !== "ready") return { ok: false, reason: MESSAGES.roundOver };
    const v = validateGuess(raw);
    if (!v.ok) return { ok: false, reason: v.reason! };
    const canon = v.canonical!;
    const clean = v.clean!;
    if (this.guessedCanon.has(canon)) return { ok: false, reason: MESSAGES.alreadyGuessed };

    if (canon === this.targetCanon) return { ok: true, clean, canon, win: true, idx: -1 };

    let idx = this.store.indexOf(clean);
    if (idx < 0) idx = this.store.indexOf(canon);
    if (idx < 0) return { ok: false, reason: MESSAGES.notInList };
    return { ok: true, clean, canon, win: false, idx };
  }

  /** Finalize a prechecked guess: score, apply penalty, update state. */
  commit(pre: Extract<Precheck, { ok: true }>): Commit {
    this.guessedCanon.add(pre.canon);

    if (pre.win) {
      // Reveal/record the actual hidden word, not the (possibly inflected) guess.
      const result: GuessResult = {
        word: this.target.word, similarity: Infinity, rank: 0, outOf: this.store.count,
        score: 100, label: temperatureLabel(100), win: true,
      };
      this.guesses.push(result);
      this.phase = "won";
      return { result, assist: null };
    }

    const result: GuessResult = { ...this.scoreWord(pre.clean, pre.idx), win: false };
    this.guesses.push(result);
    this.bank = Math.max(0, this.bank - CONFIG.wrongGuessPenalty);

    let assist: string | null = null;
    if (result.rank <= CONFIG.assistRank) {
      assist = CONFIG.revealFirstLetterOnAssist
        ? `So close — starts with “${this.target.word[0]}”, ${this.target.word.length} letters.`
        : "Burning up — same neighborhood!";
    } else if (result.rank <= CONFIG.nearWinRank) {
      assist = "Same neighborhood — keep going!";
    }
    return { result, assist };
  }

  /** Reveal + score the next unused, non-guessed filtered hint. */
  hint(): HintResponse {
    if (this.phase !== "ready") return { ok: false, reason: MESSAGES.roundOver };
    if (this.hintsUsed >= CONFIG.maxHints) return { ok: false, reason: "No hints left." };
    const revealedCanon = new Set(this.revealedHints.map((r) => canonicalize(r.word)));
    // Don't reveal a hint that is effectively the same word as the target, an
    // already-revealed hint, or an already-guessed word. `canonicalize` is a gentle
    // stemmer that misses spelling/derivation variants (organisation/organization,
    // gold/golden, magic/magical), so we also reject `sameConcept` matches — otherwise
    // the player burns a hint on a word they effectively already have.
    const avoid = [
      this.target.word,
      ...this.revealedHints.map((r) => r.word),
      ...this.guesses.map((g) => g.word),
    ];
    const next = this.target.hints.find((h) => {
      const c = canonicalize(h);
      if (revealedCanon.has(c) || this.guessedCanon.has(c)) return false;
      return !avoid.some((w) => sameConcept(h, w));
    });
    if (!next) return { ok: false, reason: "No more hints available." };
    const idx = this.store.indexOf(next);
    const scored = idx >= 0
      ? this.scoreWord(next, idx)
      : { word: next, similarity: 0, rank: this.store.count, outOf: this.store.count, score: 0, label: "Freezing" };

    this.revealedHints.push(scored);
    this.hintsUsed += 1;
    this.bank = Math.max(0, this.bank - CONFIG.hintPenalty);
    return { ok: true, scored, bank: this.bank, remaining: this.hintsRemaining };
  }

  /** Give up: end the round and surface the target word. */
  reveal(): string {
    this.phase = "revealed";
    return this.target.word;
  }
}
