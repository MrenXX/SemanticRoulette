/**
 * Abstraction over "how a guess/hint is revealed" so the HUD is agnostic to the
 * active theme (deep-space 3D vs suminagashi 2D). Placement is derived from the
 * score inside each presenter (higher score ⇒ closer to centre).
 */
export interface RevealOutcome {
  word: string;
  /** Displayed 0–100 score (drives radial placement). */
  score: number;
  win: boolean;
  /** Distinguishes a hint landing from a guess landing (styling). */
  kind: "guess" | "hint";
}

export interface GuessPresenter {
  /** Start the cycling/anticipation immediately. */
  beginCycle(): void;
  /**
   * Decelerate and land on the outcome. Guarantees a minimum on-screen time so
   * the reveal feels deliberate. `onSettle` fires the instant it lands (so the
   * HUD score count-up can sync to it).
   */
  settle(outcome: RevealOutcome, onSettle?: () => void): Promise<void>;
  /** Abort an in-flight cycle. */
  cancel(): void;
  /** Reveal the target at the centre on give-up / win. */
  revealTarget(word: string): void;
  /** Reset between rounds (with a visible transition). */
  reset(): Promise<void> | void;
  setMuted(muted: boolean): void;
  /** Tear down (on theme switch). */
  dispose(): void;
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
