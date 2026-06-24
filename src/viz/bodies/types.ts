import * as THREE from "three";
import type { SceneTokens } from "../../theme/tokens.js";

export type BodyKind = "star" | "blackhole";

/** The hidden-target central body. Reacts to reveals via pulse()/flare(). */
export interface CentralBody {
  readonly kind: BodyKind;
  readonly object: THREE.Object3D;
  /** Per-frame animation. `energy` (0..1) is a transient excitement level. */
  update(dt: number, t: number, energy: number): void;
  /** A brief reaction whose strength scales with the guess score (0..100). */
  flare(score: number): void;
  applyTokens(tokens: SceneTokens): void;
  /** Suggested camera framing distance for this body. */
  readonly framing: number;
  /** Minimum orbit radius the camera may zoom to (defaults to a global min). */
  readonly cameraMinRadius?: number;
  dispose(): void;
}
