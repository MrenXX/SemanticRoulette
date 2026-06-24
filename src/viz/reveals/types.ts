import * as THREE from "three";
import type { CameraRig } from "../camera.js";
import type { CentralBody } from "../bodies/index.js";
import type { AmbientField } from "../field.js";
import type { SoundKit } from "../../audio/sound.js";
import type { SceneTokens } from "../../theme/tokens.js";
import type { RevealOutcome } from "../presenter.js";

/**
 * Helper API the scene exposes to a reveal mechanic. Mechanics drive temporary
 * objects through `animate` (hooked into the render loop for smooth 60fps), and
 * place the final persistent marker via `placeGuessMarker`.
 */
export interface RevealContext {
  scene: THREE.Scene;
  rig: CameraRig;
  body: CentralBody;
  field: AmbientField;
  sound: SoundKit;
  tokens: SceneTokens;
  reduced: boolean;
  /** True once the in-flight reveal has been cancelled/aborted. A mechanic must
   *  check this after every `await` and bail before any further side effect. */
  readonly aborted: boolean;
  /** World radius from the centre for a 0–100 score (closer = higher). */
  radiusFor(score: number): number;
  /** Smooth animation hooked to the render loop. onFrame gets raw t in [0,1]. */
  animate(durationMs: number, onFrame: (t: number) => void): Promise<void>;
  /** Add a temporary object now; auto-removed/disposed after ttlMs (0 = manual). */
  addTemp(obj: THREE.Object3D, ttlMs?: number): void;
  removeTemp(obj: THREE.Object3D): void;
  /** Place the persistent labelled guess/hint/target marker. */
  placeGuessMarker(pos: THREE.Vector3, outcome: RevealOutcome): void;
  /** Reveal the central target word label (win / give-up). */
  revealCenter(word: string): void;
  /** Fade existing guess/hint markers + their labels (0 = normal, 1 = hidden). */
  setMarkersDim(amount: number): void;
}

export interface RevealMechanic {
  readonly id: string;
  /** Start anticipation immediately on submit (synchronous). */
  beginCycle(ctx: RevealContext): void;
  /** Run the full reveal; resolve when settled. onSettle fires at the landing. */
  settle(ctx: RevealContext, outcome: RevealOutcome, onSettle?: () => void): Promise<void>;
  /** Abort any in-flight cycling. */
  cancel(): void;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutBack = (t: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** A random unit direction biased slightly off the equator for nicer framing. */
export function randomDir(out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.75, Math.random() - 0.5).normalize();
}
