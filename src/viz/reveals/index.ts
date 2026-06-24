import type { RevealMechanic } from "./types.js";
import { BaselineReveal } from "./baseline.js";
import { OrbitalRoulette } from "./orbitalRoulette.js";
import { SupernovaSnap } from "./supernova.js";

export type { RevealMechanic, RevealContext } from "./types.js";

export type MechanicId = "orbital" | "supernova" | "baseline";

export const MECHANIC_IDS: MechanicId[] = ["orbital", "supernova", "baseline"];

export const MECHANIC_LABELS: Record<MechanicId, string> = {
  orbital: "Orbital Roulette",
  supernova: "Supernova Snap",
  baseline: "Classic",
};

export function createMechanic(id: MechanicId): RevealMechanic {
  switch (id) {
    case "supernova":
      return new SupernovaSnap();
    case "baseline":
      return new BaselineReveal();
    case "orbital":
    default:
      return new OrbitalRoulette();
  }
}
