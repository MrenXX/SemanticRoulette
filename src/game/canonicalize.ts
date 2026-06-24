/**
 * Lightweight morphological canonicalization. Used for duplicate detection and
 * the win check so that plural/tense variants of the target count as a win
 * (e.g. "oceans" → "ocean", "snakes" → "snake", "danced" → "dance"). This is a
 * small rule-based stemmer — not a full lemmatizer — tuned to avoid corrupting
 * common e-ending nouns (it strips a bare plural "s" rather than "es" unless the
 * stem is a sibilant), and to restore a silent "e" for common verb forms.
 */
export function canonicalize(word: string): string {
  let w = word.trim().toLowerCase().replace(/[^a-z'-]/g, "");
  w = w.replace(/'s$/, "");
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y"; // berries -> berry
  if (w.endsWith("oes") && w.length > 3) return w.slice(0, -2); // volcanoes -> volcano, heroes -> hero
  if (/(?:ch|sh|x|z)es$/.test(w)) return w.slice(0, -2); // boxes -> box, beaches -> beach
  if (w.endsWith("sses")) return w.slice(0, -2); // glasses -> glass
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1); // snakes -> snake, cheeses -> cheese
  if (w.endsWith("ing") && w.length > 5) return restoreStem(w.slice(0, -3)); // dancing -> dance
  if (w.endsWith("ed") && w.length > 4) return restoreStem(w.slice(0, -2)); // danced -> dance, jumped -> jump
  return w;
}

/**
 * After stripping "ed"/"ing": collapse a doubled final consonant (running ->
 * run) or restore a silent "e" for soft endings that normally require it
 * (danc -> dance, mov -> move). Applied symmetrically to guess and target.
 */
function restoreStem(stem: string): string {
  if (stem.length > 1 && stem.slice(-1) === stem.slice(-2, -1) && !"aeiou".includes(stem.slice(-1))) {
    return stem.slice(0, -1); // runn -> run
  }
  if (/[cgsuvz]$/.test(stem)) return stem + "e"; // danc -> dance, mov -> move
  return stem;
}

export interface ValidationResult {
  ok: boolean;
  /** Canonical form (present when ok). */
  canonical?: string;
  /** Cleaned, display form (present when ok). */
  clean?: string;
  /** Human-readable reason when rejected. */
  reason?: string;
}

const MAX_LEN = 24;

/**
 * Validate + canonicalize a raw guess. MVP accepts a single lexical word
 * (letters, with internal hyphen/apostrophe). Rejects empty, numbers, emoji,
 * URLs, multi-word phrases, and over-long input. Duplicate detection is the
 * caller's responsibility (compare canonical forms).
 */
export function validateGuess(raw: string): ValidationResult {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return { ok: false, reason: "Type a word." };
  if (/\s/.test(trimmed)) return { ok: false, reason: "One word only." };
  if (trimmed.length > MAX_LEN) return { ok: false, reason: "That's too long." };
  if (/[0-9]/.test(trimmed)) return { ok: false, reason: "Letters only." };
  if (/https?:|www\./i.test(trimmed)) return { ok: false, reason: "Letters only." };
  const clean = trimmed.toLowerCase();
  if (!/^[a-z]+(?:[-'][a-z]+)*$/.test(clean)) {
    return { ok: false, reason: "Letters only." };
  }
  return { ok: true, clean, canonical: canonicalize(clean) };
}
