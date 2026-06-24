/**
 * v2 offline pipeline: GloVe -> filtered vocab -> int8 vectors + filtered hints.
 *
 * Outputs (public/data/):
 *   vectors.bin   Int8Array(count*dim), L2-normalized then *127 (endian-agnostic)
 *   vocab.json    { version, dim, count, words[] }   (index = row in vectors.bin)
 *   targets.json  { version, targets: [{ word, hints[] }] }
 *
 * Scoring at runtime uses int8 dot products (rank order is preserved; the scale
 * cancels). Verified in feasibility: int8 keeps 9.8/10 nearest neighbours.
 *
 * Run: npx tsx scripts/build-vectors.ts
 */
import { createReadStream, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STOP, loadDenylist, loadOverrides, selectHints, type ScoredWord } from "./hint-select.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLOVE = join(__dirname, "vocab", "glove-100.gz");
const OUT = join(__dirname, "..", "public", "data");

const VOCAB_SIZE = 40000; // most-common letters-only words for scoring
const HINTS_PER_TARGET = 10;
let DIM = 100;

function readTargets(): string[] {
  const raw = readFileSync(join(__dirname, "vocab", "targets.txt"), "utf8");
  return [...new Set(
    raw.split(/\r?\n/).map((l) => l.trim().toLowerCase())
      .filter((l) => l && !l.startsWith("#") && /^[a-z]+$/.test(l)),
  )];
}

interface Vocab { words: string[]; vecs: Int8Array[]; index: Map<string, number>; }

async function loadGloveInt8(limit: number, mustInclude: Set<string>): Promise<Vocab> {
  const rl = createInterface({ input: createReadStream(GLOVE).pipe(createGunzip()), crlfDelay: Infinity });
  const words: string[] = [];
  const vecs: Int8Array[] = [];
  const index = new Map<string, number>();
  let first = true;
  const pushWord = (word: string, parts: string[]) => {
    const v = new Float32Array(DIM);
    let n = 0;
    for (let i = 0; i < DIM; i++) { const x = parseFloat(parts[i + 1]); v[i] = x; n += x * x; }
    n = Math.sqrt(n) || 1;
    const q = new Int8Array(DIM);
    for (let i = 0; i < DIM; i++) q[i] = Math.max(-127, Math.min(127, Math.round((v[i] / n) * 127)));
    index.set(word, words.length); words.push(word); vecs.push(q);
  };
  const deferred = new Map<string, string[]>(); // targets/included words seen after the limit
  for await (const line of rl) {
    if (!line) continue;
    const parts = line.split(" ");
    if (first) {
      first = false;
      if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) { DIM = parseInt(parts[1], 10); continue; }
    }
    const word = parts[0];
    if (!/^[a-z]+$/.test(word) || word.length < 2 || word.length > 18) continue;
    if (words.length < limit) {
      pushWord(word, parts);
    } else if (mustInclude.has(word) && !index.has(word)) {
      deferred.set(word, parts);
      if (deferred.size >= mustInclude.size) break;
    }
    if (words.length >= limit && deferred.size === 0 && mustInclude.size === 0) break;
  }
  for (const [word, parts] of deferred) if (!index.has(word)) pushWord(word, parts);
  return { words, vecs, index };
}

function idot(a: Int8Array, b: Int8Array): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

async function main() {
  console.log("== build-vectors ==\n");
  const targets = readTargets();
  const must = new Set(targets);
  console.log(`Loading GloVe (top ${VOCAB_SIZE} + ${targets.length} targets)...`);
  const vocab = await loadGloveInt8(VOCAB_SIZE, must);
  console.log(`Vocab: ${vocab.words.length} words, dim ${DIM}\n`);

  // Validate targets are present; warn on polysemy (top neighbours are stopwords).
  const finalTargets: { word: string; hints: string[] }[] = [];
  const dropped: string[] = [];
  const deny = loadDenylist();
  const overrides = loadOverrides();
  for (const t of targets) {
    const ti = vocab.index.get(t);
    if (ti === undefined) { dropped.push(`${t} (not in GloVe)`); continue; }
    const scored: ScoredWord[] = [];
    for (let j = 0; j < vocab.words.length; j++) {
      if (j === ti) continue;
      scored.push({ w: vocab.words[j], s: idot(vocab.vecs[ti], vocab.vecs[j]) });
    }
    scored.sort((a, b) => b.s - a.s);
    // polysemy guard: if most of the top-10 are stopwords, the target sense is abstract.
    const top10 = scored.slice(0, 10);
    const stopHits = top10.filter((x) => STOP.has(x.w)).length;
    if (stopHits >= 5) { dropped.push(`${t} (polysemous: ${top10.slice(0, 4).map((x) => x.w).join("/")})`); continue; }
    const hints = selectHints({
      target: t,
      scored,
      deny,
      inVocab: (w) => vocab.index.has(w),
      overrides: overrides[t],
      perTarget: HINTS_PER_TARGET,
      minLength: 3,
    });
    finalTargets.push({ word: t, hints });
  }

  console.log(`Targets kept: ${finalTargets.length}, dropped: ${dropped.length}`);
  if (dropped.length) console.log("  dropped: " + dropped.join(", "));
  console.log("\nSample hints:");
  for (const t of finalTargets.slice(0, 8)) console.log(`  ${t.word.padEnd(12)} -> ${t.hints.slice(0, 6).join(", ")}`);

  // Pack int8 matrix.
  const count = vocab.words.length;
  const buf = new Int8Array(count * DIM);
  for (let i = 0; i < count; i++) buf.set(vocab.vecs[i], i * DIM);

  const version = createHash("sha1").update(`glove6B-${DIM}-${count}`).digest("hex").slice(0, 12);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "vectors.bin"), Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  writeFileSync(join(OUT, "vocab.json"), JSON.stringify({ version, dim: DIM, count, words: vocab.words }));
  writeFileSync(join(OUT, "targets.json"), JSON.stringify({ version, targets: finalTargets }));

  console.log(`\nWrote:`);
  console.log(`  vectors.bin  ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB (${count}x${DIM} int8)`);
  console.log(`  vocab.json   ${count} words`);
  console.log(`  targets.json ${finalTargets.length} targets, version ${version}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
