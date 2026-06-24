/**
 * Tiny Web Audio sound kit — tasteful, synthesized, mutable. Created lazily and
 * unlocked on the first user gesture (browser autoplay policy). No assets.
 */
export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private reverb: ConvolverNode | null = null;

  /** Call from a user gesture (first submit/click) to enable audio. */
  unlock() {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  get isMuted() {
    return this.muted;
  }

  private blip(freq: number, dur: number, type: OscillatorType, gain: number) {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Rapid cycling tick. `p` (0..1) raises pitch as the slot slows. */
  tick(p = 0.5) {
    this.blip(360 + p * 520, 0.035, "square", 0.05);
  }

  /** Landing chime — pitch and brightness scale with score. */
  land(score: number) {
    const base = 240 + score * 4.2;
    this.blip(base, 0.18, "triangle", 0.16);
    setTimeout(() => this.blip(base * 1.5, 0.22, "sine", 0.12), 70);
    if (score >= 82) setTimeout(() => this.blip(base * 2, 0.26, "sine", 0.09), 150);
  }

  win() {
    const notes = [392, 523, 659, 784];
    notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.3, "triangle", 0.16), i * 110));
  }

  reveal() {
    this.blip(180, 0.5, "sine", 0.12);
    setTimeout(() => this.blip(140, 0.6, "sine", 0.1), 120);
  }

  // ---- reveal-mechanic sounds ----------------------------------------------

  /** Short noise burst through a band-pass — used for snaps/detonations. */
  private noise(dur: number, freq: number, q: number, gain: number) {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Rising charge swell (supernova vacuum) — lengthened to ride the ~1s collapse. */
  swell() {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(42, t);
    osc.frequency.exponentialRampToValueAtTime(360, t + 1.05); // long rising suck-in
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.95);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 1.24);
  }

  /** Sub-bass compression thump at the singularity. */
  thump() {
    if (this.muted || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    g.gain.setValueAtTime(0.24, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.36);
  }

  /** Bright detonation burst. */
  burst() {
    this.noise(0.22, 2600, 1.2, 0.16);
    this.blip(520, 0.12, "sawtooth", 0.1);
  }

  /** Cached convolution reverb (synth impulse) for a vast, space-like tail. */
  private getReverb(): ConvolverNode | null {
    if (!this.ctx || !this.master) return null;
    if (this.reverb) return this.reverb;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 3.2);
    const impulse = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.85;
    conv.connect(wet).connect(this.master);
    this.reverb = conv;
    return conv;
  }

  /**
   * Cosmic supernova detonation (Outer-Wilds-ish): not a terrestrial crack but a
   * deep sub-bass swell→boom, a shimmering detuned tonal bloom (awe), and a soft
   * low-passed pressure wave — all fed through a long reverb tail. Gains ramp from
   * near-zero (no clicks) and every node is stopped + disconnected after its tail.
   */
  boom(reduced = false) {
    if (this.muted || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const master = this.master;
    const t = ctx.currentTime;
    const tail = reduced ? 0.5 : 1.0; // scales the long decays
    const verb = this.getReverb();
    const send = (node: AudioNode) => { node.connect(master); if (verb) node.connect(verb); };
    const cleanup = (...nodes: AudioNode[]) => () => { for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } } };

    // 1) deep sub-bass swell→boom with a long tail (the weight)
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(38, t);
    sub.frequency.exponentialRampToValueAtTime(120, t + 0.16); // swell up
    sub.frequency.exponentialRampToValueAtTime(27, t + 1.4 * tail + 0.2); // settle deep
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.42, t + 0.16); // soft attack
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 * tail);
    sub.connect(sg);
    send(sg);
    sub.start(t);
    sub.stop(t + 2.5 * tail);
    sub.onended = cleanup(sub, sg);

    // 2) shimmering detuned tonal bloom (the awe) — soft cluster with vibrato
    const partials = [196, 294, 392, 587];
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 5.5;
    lfoG.gain.value = 3.5;
    lfo.connect(lfoG);
    lfo.start(t);
    lfo.stop(t + 2.8 * tail);
    lfo.onended = cleanup(lfo, lfoG);
    partials.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f * (1 + (i - 1.5) * 0.0016); // slight detune spread
      lfoG.connect(o.frequency); // vibrato
      const peak = 0.07 / (1 + i * 0.5);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.35 + i * 0.06); // slow bloom
      g.gain.exponentialRampToValueAtTime(0.0001, t + (2.0 + i * 0.2) * tail);
      o.connect(g);
      send(g);
      o.start(t);
      o.stop(t + (2.1 + i * 0.2) * tail);
      o.onended = cleanup(o, g);
    });

    // 3) soft low-passed pressure "whoosh" — slow attack, sweeping down (no crack)
    const nlen = Math.floor(ctx.sampleRate * 1.6 * tail);
    const buf = ctx.createBuffer(1, Math.max(1, nlen), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 1.5 * tail); // expanding shell
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.15, t + 0.22); // slow attack
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.7 * tail);
    src.connect(lp).connect(ng);
    send(ng);
    src.start(t);
    src.stop(t + 1.75 * tail);
    src.onended = cleanup(src, lp, ng);
  }
}

