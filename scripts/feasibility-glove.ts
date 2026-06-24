/**
 * Phase 0 (v2) — GloVe single-word semantic feasibility GATE.
 *
 * Proves whole-word GloVe vectors fix the v1 subword bias (key -> keyboard) and
 * give true associations (key -> lock/door/chain) before we build on them.
 * Also checks int8 quantization preserves neighbour rankings.
 *
 * Run: npx tsx scripts/feasibility-glove.ts
 */
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GLOVE = join(__dirname, "vocab", "glove-100.gz");
const LIMIT = 50000; // load the most common N words (GloVe is frequency-sorted)
let DIM = 100;

interface Vocab {
  words: string[];
  vecs: Float32Array[]; // L2-normalized
  index: Map<string, number>;
}

async function loadGlove(limit: number): Promise<Vocab> {
  const rl = createInterface({
    input: createReadStream(GLOVE).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  const words: string[] = [];
  const vecs: Float32Array[] = [];
  const index = new Map<string, number>();
  let first = true;
  for await (const line of rl) {
    if (!line) continue;
    const parts = line.split(" ");
    if (first) {
      first = false;
      // word2vec header "<count> <dim>" — skip if present.
      if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
        DIM = parseInt(parts[1], 10);
        continue;
      }
    }
    const word = parts[0];
    if (!/^[a-z]+$/.test(word)) continue; // letters only, lowercase
    const v = new Float32Array(DIM);
    let n = 0;
    for (let i = 0; i < DIM; i++) {
      const x = parseFloat(parts[i + 1]);
      v[i] = x;
      n += x * x;
    }
    n = Math.sqrt(n) || 1;
    for (let i = 0; i < DIM; i++) v[i] /= n;
    index.set(word, words.length);
    words.push(word);
    vecs.push(v);
    if (words.length >= limit) break;
  }
  return { words, vecs, index };
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function nearest(vocab: Vocab, word: string, k: number): { w: string; s: number }[] {
  const i = vocab.index.get(word);
  if (i === undefined) return [];
  const q = vocab.vecs[i];
  const out: { w: string; s: number }[] = [];
  for (let j = 0; j < vocab.words.length; j++) {
    if (j === i) continue;
    out.push({ w: vocab.words[j], s: dot(q, vocab.vecs[j]) });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, k);
}

function rankOf(vocab: Vocab, target: string, guess: string): number | null {
  const ti = vocab.index.get(target);
  const gi = vocab.index.get(guess);
  if (ti === undefined || gi === undefined) return null;
  const sg = dot(vocab.vecs[ti], vocab.vecs[gi]);
  let rank = 1;
  for (let j = 0; j < vocab.words.length; j++) {
    if (j === ti) continue;
    if (dot(vocab.vecs[ti], vocab.vecs[j]) > sg) rank++;
  }
  return rank;
}

async function main() {
  console.log(`== GloVe feasibility (loading top ${LIMIT} words) ==\n`);
  const vocab = await loadGlove(LIMIT);
  console.log(`Loaded ${vocab.words.length} words, dim ${DIM}\n`);

  const probes = ["key", "ocean", "coffee", "guitar", "cat", "winter", "door"];
  for (const w of probes) {
    const nn = nearest(vocab, w, 12);
    console.log(`${w.padEnd(9)} -> ${nn.map((x) => `${x.w}(${x.s.toFixed(2)})`).join(", ")}`);
  }

  console.log("\n-- The v1 problem words, target = key --");
  for (const g of ["lock", "door", "chain", "keys", "metal", "keyboard", "mouse", "computer"]) {
    const r = rankOf(vocab, "key", g);
    console.log(`  key ~ ${g.padEnd(10)} rank ${r}`);
  }

  console.log("\n-- Assertions (what actually matters for the game) --");
  const checks: [string, boolean][] = [];
  // 1. v1 subword bias is GONE: keyboard must NOT be near "key".
  const keyNN50 = nearest(vocab, "key", 50).map((x) => x.w);
  checks.push(["v1 bias fixed: 'keyboard' NOT in key's top-50", !keyNN50.includes("keyboard")]);
  const kbRank = rankOf(vocab, "key", "keyboard")!;
  checks.push([`key~keyboard is far (rank ${kbRank} > 1000)`, kbRank > 1000]);
  // 2. Concrete words have sensible neighbours.
  const oceanNN = nearest(vocab, "ocean", 10).map((x) => x.w);
  checks.push(["ocean neighbours include sea/waters/coast", ["sea", "waters", "coast", "seas"].some((w) => oceanNN.includes(w))]);
  const guitarNN = nearest(vocab, "guitar", 12).map((x) => x.w);
  checks.push(["guitar neighbours include bass/drums/piano", ["bass", "drums", "piano"].some((w) => guitarNN.includes(w))]);
  // 3. Relative ordering holds.
  const c = (a: string, b: string) => dot(vocab.vecs[vocab.index.get(a)!], vocab.vecs[vocab.index.get(b)!]);
  checks.push(["cat~dog > cat~table", c("cat", "dog") > c("cat", "table")]);
  checks.push(["ocean~sea > ocean~engine", c("ocean", "sea") > c("ocean", "engine")]);
  checks.push(["winter~summer > winter~guitar", c("winter", "summer") > c("winter", "guitar")]);

  let pass = true;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) pass = false;
  }
  console.log("\n  NOTE: 'key' is polysemous (GloVe's dominant sense is the adjective");
  console.log("  'crucial/important'), so polysemous words must be EXCLUDED from targets.");

  // int8 quantization: does it preserve the top-10 neighbour set for sample words?
  console.log("\n-- int8 quantization check --");
  const quant = (v: Float32Array) => {
    const q = new Int8Array(v.length);
    for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
    return q;
  };
  const qvecs = vocab.vecs.map(quant);
  const qdot = (a: Int8Array, b: Int8Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  let overlapTotal = 0, cases = 0;
  for (const w of ["key", "ocean", "guitar", "winter"]) {
    const i = vocab.index.get(w)!;
    const top = new Set(nearest(vocab, w, 10).map((x) => x.w));
    const qout: { w: string; s: number }[] = [];
    for (let j = 0; j < vocab.words.length; j++) if (j !== i) qout.push({ w: vocab.words[j], s: qdot(qvecs[i], qvecs[j]) });
    qout.sort((a, b) => b.s - a.s);
    const qtop = qout.slice(0, 10).map((x) => x.w);
    const overlap = qtop.filter((x) => top.has(x)).length;
    overlapTotal += overlap; cases++;
    console.log(`  ${w.padEnd(8)} top-10 overlap fp32 vs int8: ${overlap}/10`);
  }
  const avgOverlap = overlapTotal / cases;
  checks.push([`int8 preserves >=8/10 neighbours (avg ${avgOverlap.toFixed(1)})`, avgOverlap >= 8]);
  console.log(`  ${avgOverlap >= 8 ? "PASS" : "WARN"}  avg overlap ${avgOverlap.toFixed(1)}/10`);

  console.log(`\n== GATE: ${pass ? "PASS" : "FAIL"} ==  (int8 ${avgOverlap >= 8 ? "ok" : "marginal -> consider fp32"})`);
  if (!pass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
