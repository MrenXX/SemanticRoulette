import type { SceneTokens } from "../../theme/tokens.js";
import type { CentralBody, BodyKind } from "./types.js";
import { StarBody } from "./star.js";
import { BlackHoleBody } from "./blackhole.js";

export type { CentralBody, BodyKind } from "./types.js";

export const BODY_KINDS: BodyKind[] = ["star", "blackhole"];

export const BODY_LABELS: Record<BodyKind, string> = {
  star: "Star",
  blackhole: "Black hole",
};

export function createBody(kind: BodyKind, tokens: SceneTokens, lowQuality = false): CentralBody {
  switch (kind) {
    case "blackhole":
      return new BlackHoleBody(tokens, lowQuality);
    case "star":
    default:
      return new StarBody(tokens);
  }
}
