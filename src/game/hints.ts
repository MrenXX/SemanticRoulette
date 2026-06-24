/**
 * Hint-diversity helper. `canonicalize` (used for the win check) is a deliberately
 * gentle stemmer; it does NOT merge spelling/derivation variants such as
 * "organisation"/"organization", "gold"/"golden", or "magic"/"magical"/"magician".
 * Two such words are different vectors with different scores, so showing both as
 * hints reads as "the same word twice" and wastes a hint.
 *
 * `sameConcept` is a stronger, deliberately MERGE-biased check used to keep hints
 * (and generated hint lists) diverse. At generation an over-merge is harmless — we
 * just skip and backfill from the next neighbour — so we accept rare over-merges
 * (cheese/cheesecake, rhino/rhinoceros) in exchange for never showing variants.
 */

/** Normalize for concept comparison: lowercase, letters only, British→American
 *  spelling, and a symmetric plural fold (applied to BOTH words so e.g.
 *  house/houses both fold to "hous" and compare equal). */
function normalizeConcept(word: string): string {
  let w = word.trim().toLowerCase().replace(/[^a-z]/g, "");
  // British -ise/-isation → American -ize/-ization (organisation ≡ organization).
  w = w
    .replace(/isation$/, "ization")
    .replace(/ised$/, "ized")
    .replace(/ising$/, "izing")
    .replace(/ise$/, "ize");
  // Symmetric plural fold (intentionally lossy; applied to both sides).
  if (/(?:s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2); // buses→bus, boxes→box, dishes→dish
  else if (/ies$/.test(w) && w.length > 4) w = w.slice(0, -3) + "y"; // berries→berry
  else if (/s$/.test(w) && !/(?:ss|us|is)$/.test(w) && w.length > 3) w = w.slice(0, -1); // snakes→snake (not venus/basis)
  return w;
}

function sharedPrefixLen(a: string, b: string): number {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/**
 * True when two words denote the same concept for hint purposes: identical after
 * normalization, one a morphological extension of the other (prefix-containment),
 * or sharing a long stem prefix. Tuned + tested against the real hint data
 * (see scripts/test-hints.mjs).
 */
export function sameConcept(a: string, b: string): boolean {
  const x = normalizeConcept(a);
  const y = normalizeConcept(b);
  if (!x || !y) return a.trim().toLowerCase() === b.trim().toLowerCase();
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  // "gold"/"golden", "fire"/"fired", "magic"/"magician", "launch"/"launchers".
  if (l.startsWith(s) && s.length >= 4 && l.length - s.length <= 4) return true;
  // "cascade"/"cascading", "eruption"/"erupting", "astronomy"/"astronomers".
  if (s.length >= 6 && l.length >= 6 && sharedPrefixLen(x, y) >= 5 && l.length - s.length <= 4) return true;
  return false;
}
