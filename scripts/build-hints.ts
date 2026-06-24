/**
 * Regenerate ONLY public/data/targets.json (hints) from the EXISTING
 * public/data/vocab.json + vectors.bin. vectors.bin and vocab.json are never
 * written here, so guess scoring stays byte-identical — only the hint word lists
 * (and therefore displayed hint scores) change.
 *
 * Run: npm run hints
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { canonicalize } from "../src/game/canonicalize.js";
import { sameConcept } from "../src/game/hints.js";
import { loadDenylist, loadOverrides, selectHints, type ScoredWord } from "./hint-select.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "public", "data");

const PER_TARGET = 10;
const MIN_HINTS = 6;

interface VocabMeta { version: string; dim: number; count: number; words: string[] }
interface TargetsFile { version: string; targets: { word: string; hints: string[] }[] }

function sha(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex").slice(0, 12);
}

function main() {
  // ---- load existing vocab + vectors (read-only) ----
  const vocabBuf = readFileSync(join(DATA, "vocab.json"));
  const vectorsBuf = readFileSync(join(DATA, "vectors.bin"));
  const meta = JSON.parse(vocabBuf.toString("utf8")) as VocabMeta;
  const { dim, count, words } = meta;
  const data = new Int8Array(vectorsBuf.buffer, vectorsBuf.byteOffset, vectorsBuf.byteLength);
  if (data.length !== count * dim) {
    throw new Error(`vectors.bin size mismatch: got ${data.length}, expected ${count * dim}`);
  }
  const index = new Map<string, number>();
  for (let i = 0; i < words.length; i++) index.set(words[i], i);
  const vocabSha = sha(vocabBuf);
  const vectorsSha = sha(vectorsBuf);
  console.log(`vocab ${count} words (dim ${dim}); vectors.bin sha ${vectorsSha}, vocab.json sha ${vocabSha}`);

  // ---- existing targets (preserve the exact set + order) ----
  const existing = JSON.parse(readFileSync(join(DATA, "targets.json"), "utf8")) as TargetsFile;
  const deny = loadDenylist();
  const overrides = loadOverrides();
  console.log(`targets: ${existing.targets.length}; denylist: ${deny.size}; overrides: ${Object.keys(overrides).length}`);

  const idot = (ti: number, j: number): number => {
    const a = ti * dim;
    const b = j * dim;
    let s = 0;
    for (let k = 0; k < dim; k++) s += data[a + k] * data[b + k];
    return s;
  };

  const out: TargetsFile = { version: existing.version, targets: [] };
  const thin: string[] = [];

  for (const { word } of existing.targets) {
    const ti = index.get(word);
    if (ti === undefined) throw new Error(`target "${word}" not in vocab — refusing to change the target set`);

    const scored: ScoredWord[] = new Array(count - 1);
    let n = 0;
    for (let j = 0; j < count; j++) {
      if (j === ti) continue;
      scored[n++] = { w: words[j], s: idot(ti, j) };
    }
    scored.sort((x, y) => y.s - x.s);

    const hints = selectHints({
      target: word,
      scored,
      deny,
      inVocab: (w) => index.has(w),
      overrides: overrides[word],
      perTarget: PER_TARGET,
      minLength: 3,
    });
    if (hints.length < MIN_HINTS) thin.push(`${word} (${hints.length})`);
    out.targets.push({ word, hints });
  }

  // ---- invariant asserts ----
  const beforeWords = existing.targets.map((t) => t.word).sort().join(",");
  const afterWords = out.targets.map((t) => t.word).sort().join(",");
  if (beforeWords !== afterWords) throw new Error("target word set changed — aborting");

  for (const { word, hints } of out.targets) {
    for (const h of hints) {
      if (!index.has(h)) throw new Error(`hint "${h}" for "${word}" is OOV (would score 0)`);
    }
    for (let a = 0; a < hints.length; a++) {
      for (let b = a + 1; b < hints.length; b++) {
        if (canonicalize(hints[a]) === canonicalize(hints[b]) || sameConcept(hints[a], hints[b])) {
          throw new Error(`duplicate concept in "${word}": ${hints[a]} ~ ${hints[b]}`);
        }
      }
    }
  }
  // Enforce the minimum-hints invariant BEFORE writing (forces curation via
  // overrides rather than silently shipping a sparse target).
  if (thin.length) {
    throw new Error(`targets below ${MIN_HINTS} hints — add overrides in hint-overrides.json: ${thin.join(", ")}`);
  }

  writeFileSync(join(DATA, "targets.json"), JSON.stringify(out));

  // vectors.bin / vocab.json must be untouched (we never wrote them).
  const vectorsShaAfter = sha(readFileSync(join(DATA, "vectors.bin")));
  const vocabShaAfter = sha(readFileSync(join(DATA, "vocab.json")));
  if (vectorsShaAfter !== vectorsSha || vocabShaAfter !== vocabSha) {
    throw new Error("vectors.bin/vocab.json changed — scoring would be affected");
  }

  console.log(`\nWrote targets.json (${out.targets.length} targets), version ${out.version}.`);
  console.log(`scores unchanged ✓  (vectors.bin ${vectorsShaAfter}, vocab.json ${vocabShaAfter})`);
  console.log(`all targets have ≥ ${MIN_HINTS} hints ✓`);

  console.log("\nSample:");
  for (const t of out.targets.slice(0, 8)) console.log(`  ${t.word.padEnd(12)} -> ${t.hints.join(", ")}`);
}

main();
