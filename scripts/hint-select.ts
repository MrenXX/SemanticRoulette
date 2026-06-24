/**
 * Shared hint-selection logic used by both `build-hints.ts` (regenerate hints from
 * the existing vectors) and `build-vectors.ts` (full rebuild). Keeps the two paths
 * consistent: same stopwords, same denylist/overrides, same `sameConcept` de-dup.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../src/game/canonicalize.js";
import { sameConcept } from "../src/game/hints.js";

const VOCAB_DIR = join(dirname(fileURLToPath(import.meta.url)), "vocab");

/** Function/abstract words excluded from hints and target eligibility. */
export const STOP = new Set(
  `the of and to in a is was for on that by this with i you it not or be are from at as your all
   have new more an we will can us about if my has but our one other do no time they he up may what
   which their out any there see only so his when here who also now get am been would were me some
   these like than find back top just over into two day most make them should her its such after then
   where each she very many used said does set under general off down per think come going yet via etc
   those using both being much sign use both within without about above below between among during
   before after since until while because although though however therefore thus hence whereas mr mrs
   said say says according including made including well good great little own same right left next
   last first second third still even ever never always often sometimes around again away though
   year years month months week weeks today yesterday tomorrow part way thing things lot kind sort
   number group end side place case point fact area home people person man woman child life world
   work want need know think feel become seem look give take get put keep let mean show tell ask try
   call move turn start stop play run walk talk live believe hold bring happen write provide sit
   stand lose pay meet include continue set learn change lead understand watch follow stop create
   speak read allow add spend grow open win offer remember love consider appear buy wait serve die
   send build stay fall cut reach kill remain`
    .split(/\s+/).map((w) => w.trim()).filter(Boolean),
);

function loadWordList(file: string): string[] {
  return readFileSync(join(VOCAB_DIR, file), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith("#"));
}

export function loadDenylist(): Set<string> {
  try {
    return new Set(loadWordList("hint-denylist.txt"));
  } catch {
    return new Set();
  }
}

export function loadOverrides(): Record<string, string[]> {
  try {
    const raw = JSON.parse(readFileSync(join(VOCAB_DIR, "hint-overrides.json"), "utf8")) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith("_")) continue;
      if (Array.isArray(v)) out[k] = v.map((w) => String(w).trim().toLowerCase()).filter(Boolean);
    }
    return out;
  } catch {
    return {};
  }
}

export interface ScoredWord { w: string; s: number }

export interface SelectHintsOpts {
  target: string;
  /** Vocabulary neighbours sorted by descending similarity to the target. */
  scored: ScoredWord[];
  deny: Set<string>;
  inVocab: (w: string) => boolean;
  /** Curated words for this target (bypass deny but still validated + deduped). */
  overrides?: string[];
  perTarget?: number;
  minLength?: number;
}

/**
 * Choose up to `perTarget` diverse, quality hints for a target: curated overrides
 * first, then the best vocabulary neighbours, skipping stopwords, denylisted/short
 * tokens, the target itself, and anything `sameConcept` with the target or an
 * already-chosen hint.
 */
export function selectHints(o: SelectHintsOpts): string[] {
  const per = o.perTarget ?? 10;
  const minLen = o.minLength ?? 3;
  const tc = canonicalize(o.target);
  const chosen: string[] = [];

  const acceptable = (w: string): boolean => {
    if (!w || w === o.target || !o.inVocab(w)) return false;
    const cw = canonicalize(w);
    if (cw === tc || sameConcept(w, o.target)) return false;
    // De-dup chosen hints by the gentle stemmer AND the stronger concept check:
    // canonicalize catches short -ing/-ed pairs (spewing/spewed) that sameConcept's
    // prefix rule misses, while sameConcept catches spelling/derivation variants.
    return !chosen.some((h) => h === w || canonicalize(h) === cw || sameConcept(h, w));
  };

  // 1) curated overrides (validated + deduped; allowed even if otherwise filtered)
  for (const w of o.overrides ?? []) {
    if (chosen.length >= per) break;
    if (acceptable(w)) chosen.push(w);
  }
  // 2) best neighbours
  for (const { w } of o.scored) {
    if (chosen.length >= per) break;
    if (w.length < minLen || STOP.has(w) || o.deny.has(w)) continue;
    if (acceptable(w)) chosen.push(w);
  }
  return chosen;
}
