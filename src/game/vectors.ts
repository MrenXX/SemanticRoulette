/**
 * Runtime word-vector store (replaces the v1 MiniLM worker/model).
 *
 * Loads a compact int8 GloVe matrix + vocabulary once, then answers everything
 * synchronously and instantly: word lookup, cosine (via int8 dot), and ranking a
 * guess against the whole vocabulary. No neural inference, no model download.
 */
export interface VocabMeta {
  version: string;
  dim: number;
  count: number;
  words: string[];
}

export class VectorStore {
  readonly dim: number;
  readonly count: number;
  readonly version: string;
  readonly words: string[];
  private readonly data: Int8Array; // count * dim, row-major, normalized*127
  private readonly index = new Map<string, number>();

  private constructor(meta: VocabMeta, data: Int8Array) {
    this.dim = meta.dim;
    this.count = meta.count;
    this.version = meta.version;
    this.words = meta.words;
    this.data = data;
    for (let i = 0; i < meta.words.length; i++) this.index.set(meta.words[i], i);
  }

  static async load(base: string = import.meta.env.BASE_URL): Promise<VectorStore> {
    const prefix = base.endsWith("/") ? base : base + "/";
    const [meta, bin] = await Promise.all([
      fetch(`${prefix}data/vocab.json`).then((r) => r.json() as Promise<VocabMeta>),
      fetch(`${prefix}data/vectors.bin`).then((r) => r.arrayBuffer()),
    ]);
    const data = new Int8Array(bin);
    const expected = meta.count * meta.dim;
    if (data.length !== expected) {
      throw new Error(`Vector size mismatch: got ${data.length}, expected ${expected}`);
    }
    return new VectorStore(meta, data);
  }

  /** Index of a word, or -1 if out of vocabulary. */
  indexOf(word: string): number {
    const i = this.index.get(word);
    return i === undefined ? -1 : i;
  }

  has(word: string): boolean {
    return this.index.has(word);
  }

  /** A (no-copy) row view of the int8 vector at `i`. */
  row(i: number): Int8Array {
    return this.data.subarray(i * this.dim, (i + 1) * this.dim);
  }

  /** Unnormalized int8 dot product between rows i and j (∝ cosine). */
  dot(i: number, j: number): number {
    const d = this.dim;
    const a = i * d;
    const b = j * d;
    const data = this.data;
    let s = 0;
    for (let k = 0; k < d; k++) s += data[a + k] * data[b + k];
    return s;
  }

  /**
   * Descending int8-dot similarities of `targetIndex` to every other vocab word.
   * Computed once per round; ranking a guess is then a binary search.
   */
  sortedSimsFrom(targetIndex: number): Int32Array {
    const out = new Int32Array(this.count - 1);
    let n = 0;
    for (let j = 0; j < this.count; j++) {
      if (j === targetIndex) continue;
      out[n++] = this.dot(targetIndex, j);
    }
    out.sort();
    // ascending -> reverse to descending
    out.reverse();
    return out;
  }
}
