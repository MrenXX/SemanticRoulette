import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CameraRig } from "./camera.js";
import { CONFIG } from "../game/config.js";
import type { SceneTokens } from "../theme/tokens.js";
import type { SoundKit } from "../audio/sound.js";
import { GuessPresenter, RevealOutcome } from "./presenter.js";
import { AmbientField } from "./field.js";
import { createBody, type CentralBody, type BodyKind } from "./bodies/index.js";
import { createMechanic, type MechanicId, type RevealMechanic } from "./reveals/index.js";
import type { RevealContext } from "./reveals/types.js";
import { markerColor } from "./reveals/shared.js";

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2"));
  } catch {
    return false;
  }
}

/** Detect a software/CPU WebGL backend (SwiftShader, llvmpipe…) so the heavier
 *  shaders (e.g. the lensed black hole) can start in a cheaper quality mode. */
function detectLowGfx(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    return /swiftshader|software|llvmpipe|microsoft basic/i.test(r);
  } catch {
    return false;
  }
}

interface Anim { start: number; dur: number; onFrame: (t: number) => void; resolve: () => void; }
interface Temp { obj: THREE.Object3D; until: number; }

function label(text: string, cls: string): CSS2DObject {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.center.set(0.5, 1);
  o.position.set(0, 0.7, 0);
  return o;
}

export interface DeepSpaceOptions {
  body: BodyKind;
  mechanic: MechanicId;
}

/** Deep-space, target-centred world. Drag to orbit; reveals delegate to a
 *  swappable mechanic; the central body is a swappable variant. */
export class DeepSpaceScene implements GuessPresenter {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labelRenderer: CSS2DRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly clock = new THREE.Clock();
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private outputPass!: OutputPass;
  private disposed = false;

  private readonly field: AmbientField;
  private body: CentralBody;
  private mechanic: RevealMechanic;

  private readonly markers = new THREE.Group();
  private readonly markerGeo = new THREE.SphereGeometry(0.28, 18, 18);
  private readonly markerMats: THREE.Material[] = [];
  private readonly popping = new Set<{ mesh: THREE.Object3D; to: number }>();
  private centerLabel: CSS2DObject | null = null;

  private readonly anims: Anim[] = [];
  private readonly temps: Temp[] = [];
  private energy = 0; // transient body excitement during reveals

  private tokens: SceneTokens;
  private readonly sound: SoundKit;
  private readonly reduced: boolean;
  private lowGfx = false;
  private running = false;
  private frame = 0;
  private revealing = false;
  private revealAborted = false;
  private readonly ctx: RevealContext;

  // drag
  private dragPointer = -1;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;

  constructor(container: HTMLElement, tokens: SceneTokens, sound: SoundKit, opts: DeepSpaceOptions) {
    this.tokens = tokens;
    this.sound = sound;
    this.reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const w = container.clientWidth || innerWidth;
    const h = container.clientHeight || innerHeight;
    const pr = Math.min(devicePixelRatio, this.reduced ? 1.25 : 2);

    this.renderer = new THREE.WebGLRenderer({ antialias: !this.reduced, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(new THREE.Color(tokens.background), 1);
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.style.cursor = "grab";
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(w, h);
    const lr = this.labelRenderer.domElement;
    lr.style.position = "absolute";
    lr.style.inset = "0";
    lr.style.pointerEvents = "none";
    container.appendChild(lr);

    this.scene.background = new THREE.Color(tokens.background);
    this.rig = new CameraRig(w / h);
    this.rig.reducedMotion = this.reduced;

    this.lowGfx = detectLowGfx(this.renderer);
    // Allow forcing quality (?gfx=high|low) for weak GPUs or visual checks.
    const gfx = new URLSearchParams(location.search).get("gfx");
    if (gfx === "low") this.lowGfx = true;
    else if (gfx === "high") this.lowGfx = false;
    this.field = new AmbientField(tokens, pr);
    this.scene.add(this.field.group);
    this.body = createBody(opts.body, tokens, this.lowGfx);
    this.scene.add(this.body.object);
    this.scene.add(this.markers);
    this.mechanic = createMechanic(opts.mechanic);
    this.rig.setRadiusBounds(this.body.cameraMinRadius ?? 8, 90);
    this.field.setBlackHoleMode(this.body.kind === "blackhole");

    this.setupComposer(w, h, pr);
    this.wireDrag();
    addEventListener("resize", this.onResize);

    const self = this;
    this.ctx = {
      scene: this.scene,
      rig: this.rig,
      get body() { return self.body; },
      field: this.field,
      sound: this.sound,
      get tokens() { return self.tokens; },
      reduced: this.reduced,
      get aborted() { return self.revealDead; },
      radiusFor: (s) => self.radiusFor(s),
      animate: (d, f) => self.animate(d, f),
      addTemp: (o, ttl) => self.addTemp(o, ttl),
      removeTemp: (o) => self.removeTemp(o),
      placeGuessMarker: (p, o) => self.placeGuessMarker(p, o),
      revealCenter: (word) => self.revealCenter(word),
      setMarkersDim: (a) => self.setMarkersDim(a),
    };
  }

  private setupComposer(w: number, h: number, pr: number) {
    this.composer = new EffectComposer(this.renderer);
    // Cap the post-processing resolution: bloom is the heaviest pass and gains
    // little above ~1.5x DPR, so this keeps mid-range GPUs comfortably at 60fps.
    this.composer.setPixelRatio(Math.min(pr, 1.5));
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this.tokens.bloom, 0.4, 0.62);
    this.composer.addPass(this.bloom);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  // ---- drag-to-rotate ------------------------------------------------------

  private wireDrag() {
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => {
      if (this.revealing || this.dragPointer !== -1) return;
      this.dragPointer = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.lastT = performance.now();
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
      this.rig.beginDrag();
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.dragPointer) return;
      const now = performance.now();
      const dt = Math.max(0.001, (now - this.lastT) / 1000);
      this.rig.drag(e.clientX - this.lastX, e.clientY - this.lastY, dt);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.lastT = now;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.dragPointer) return;
      this.dragPointer = -1;
      el.style.cursor = "grab";
      this.rig.endDrag();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);

    // Mouse-wheel zoom (dolly the orbit radius). Blocked during a reveal cycle,
    // but always preventDefault so ctrl/trackpad wheel never page-zooms the HUD.
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (this.revealing) return;
      this.rig.zoom(e.deltaY);
    }, { passive: false });
  }

  // ---- variant switching ---------------------------------------------------

  setBody(kind: BodyKind) {
    if (kind === this.body.kind) return;
    // If a reveal is mid-flight, end it cleanly first (resolves pending anims).
    if (this.revealing) this.cancel();
    if (this.centerLabel) { this.body.object.remove(this.centerLabel); this.centerLabel.element.remove(); this.centerLabel = null; }
    this.scene.remove(this.body.object);
    this.body.dispose();
    this.body = createBody(kind, this.tokens, this.lowGfx);
    this.scene.add(this.body.object);
    this.rig.setRadiusBounds(this.body.cameraMinRadius ?? 8, 90);
    this.field.setBlackHoleMode(kind === "blackhole");
  }

  setMechanic(id: MechanicId) {
    if (id === this.mechanic.id) return;
    if (this.revealing) this.cancel();
    this.mechanic.cancel();
    this.mechanic = createMechanic(id);
  }

  applyTokens(tokens: SceneTokens) {
    this.tokens = tokens;
    this.scene.background = new THREE.Color(tokens.background);
    this.renderer.setClearColor(new THREE.Color(tokens.background), 1);
    this.field.applyTokens(tokens);
    this.body.applyTokens(tokens);
    this.bloom.strength = tokens.bloom;
  }

  private onResize = () => {
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    const w = el.clientWidth || innerWidth;
    const h = el.clientHeight || innerHeight;
    this.renderer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.rig.setAspect(w / h);
  };

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    this.loop();
  }

  // ---- animation runner ----------------------------------------------------

  private animate(durationMs: number, onFrame: (t: number) => void): Promise<void> {
    // If the scene is gone — or the in-flight reveal was aborted — resolve
    // immediately so the awaiting mechanic (and the HUD's `await settle()`) can
    // never hang and never animate onto a swapped body.
    if (this.disposed || !this.running || this.revealAborted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.anims.push({ start: performance.now(), dur: Math.max(1, durationMs), onFrame, resolve });
    });
  }

  private flushAnims() {
    // Resolve pending animations WITHOUT running their final frame: on abort the
    // mechanic's objects may be mid-teardown, so we don't want to touch them.
    for (const a of this.anims.splice(0)) a.resolve();
  }

  private addTemp(obj: THREE.Object3D, ttlMs = 0) {
    if (this.revealDead) return; // a cancelled/disposed reveal must not re-populate the scene
    this.scene.add(obj);
    this.temps.push({ obj, until: ttlMs > 0 ? performance.now() + ttlMs : 0 });
  }

  /** A reveal must stop touching the scene once it is cancelled OR the scene is
   *  torn down — a suspended mechanic can otherwise resume past disposal. */
  private get revealDead(): boolean {
    return this.revealAborted || this.disposed || !this.running;
  }

  /** Dispose an object subtree's geometries/materials/textures and remove labels. */
  private disposeTree(obj: THREE.Object3D) {
    obj.traverse((o) => {
      if (o instanceof CSS2DObject) o.element.remove();
      const any = o as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      any.geometry?.dispose();
      if (Array.isArray(any.material)) any.material.forEach((m) => m.dispose());
      else any.material?.dispose();
    });
  }

  private removeTemp(obj: THREE.Object3D) {
    this.scene.remove(obj);
    const i = this.temps.findIndex((t) => t.obj === obj);
    if (i >= 0) this.temps.splice(i, 1);
  }

  // ---- reveal context impl -------------------------------------------------

  radiusFor(score: number): number {
    const f = Math.max(0, Math.min(1, score / 100));
    const { farRadius, nearRadius } = CONFIG.landing;
    return farRadius + (nearRadius - farRadius) * f;
  }

  private placeGuessMarker(pos: THREE.Vector3, outcome: RevealOutcome) {
    if (this.revealDead) return; // a cancelled/disposed reveal must not leave a stray marker
    const col = markerColor(this.tokens, outcome.score, outcome.kind === "hint" ? "hint" : "guess");
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.96 });
    this.markerMats.push(mat);
    const mesh = new THREE.Mesh(this.markerGeo, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.001);
    const prefix = outcome.kind === "hint" ? "◇ " : "";
    mesh.add(label(`${prefix}${outcome.word} · ${outcome.score.toFixed(1)}`,
      "marker-label" + (outcome.kind === "hint" ? " marker-label--hint" : "")));
    this.markers.add(mesh);
    this.popping.add({ mesh, to: 0.8 + (outcome.score / 100) * 0.8 });
  }

  private revealCenter(word: string) {
    if (this.revealDead) return; // a cancelled/disposed reveal must not relabel the centre
    if (this.centerLabel) { this.body.object.remove(this.centerLabel); this.centerLabel.element.remove(); }
    this.centerLabel = label(word, "marker-label marker-label--target");
    this.centerLabel.position.set(0, 1.6, 0);
    this.body.object.add(this.centerLabel);
  }

  /** Fade existing markers + their CSS labels (used by reveals that clear the
   *  stage, e.g. the supernova collapse). amount 0 = normal, 1 = hidden. */
  private setMarkersDim(amount: number) {
    const k = 1 - Math.max(0, Math.min(1, amount));
    for (const child of this.markers.children) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (mat) mat.opacity = 0.96 * k;
      mesh.children.forEach((o) => {
        if (o instanceof CSS2DObject) (o.element as HTMLElement).style.opacity = String(k);
      });
    }
  }

  // ---- GuessPresenter ------------------------------------------------------

  beginCycle() {
    this.revealing = true;
    this.revealAborted = false;
    this.energy = 0.5;
    this.mechanic.beginCycle(this.ctx);
  }

  async settle(outcome: RevealOutcome, onSettle?: () => void) {
    try {
      await this.mechanic.settle(this.ctx, outcome, onSettle);
    } finally {
      this.revealing = false;
      this.energy = 0;
    }
  }

  cancel() {
    // Abort first so any still-suspended mechanic coroutine can't animate, add
    // temps, or place markers on the (possibly swapped) scene after this point.
    this.revealAborted = true;
    this.mechanic.cancel();
    this.flushAnims();
    // Own the teardown of any temp objects the mechanic left behind.
    for (const t of this.temps.splice(0)) { this.scene.remove(t.obj); this.disposeTree(t.obj); }
    // Guarantee a clean stage regardless of which mechanic/phase was interrupted.
    this.field.setCollapse(0);
    this.field.setBurst(0);
    this.setMarkersDim(0);
    // Clear BOTH the focus dolly and any follow so no cinematic camera move
    // survives the cancel (the collapse phase uses focusOn, not follow).
    this.rig.release();
    this.revealing = false;
  }

  revealTarget(word: string) {
    this.revealAborted = false; // explicit give-up reveal is never suppressed
    this.revealCenter(word);
    this.body.flare(100);
    this.rig.focusOn({ x: 0, y: 0, z: 0 }, this.body.framing, 2600);
    this.sound.reveal();
  }

  async reset() {
    this.cancel();
    // reset() runs only between rounds (never mid-reveal), so re-enable the
    // animation runner for its own warp transition.
    this.revealAborted = false;
    // Warp transition: spin the field and flash before clearing.
    this.field.setImplosion(0);
    const spin0 = this.field.group.rotation.y;
    await this.animate(this.reduced ? 140 : 360, (t) => {
      this.field.group.rotation.y = spin0 + t * 1.2;
      if (Math.random() > 0.4) this.field.flashRandom();
    });
    this.field.group.rotation.y = spin0;
    this.clearMarkers();
    this.rig.release();
  }

  private clearMarkers() {
    for (const child of [...this.markers.children]) {
      this.markers.remove(child);
      this.disposeTree(child);
    }
    for (const m of this.markerMats) m.dispose();
    this.markerMats.length = 0;
    this.popping.clear();
    if (this.centerLabel) { this.body.object.remove(this.centerLabel); this.centerLabel.element.remove(); this.centerLabel = null; }
    // remove + dispose any leftover temp objects from an interrupted mechanic
    for (const t of this.temps.splice(0)) { this.scene.remove(t.obj); this.disposeTree(t.obj); }
  }

  setMuted(muted: boolean) {
    this.sound.setMuted(muted);
  }

  /** Test/debug hook: current camera world position [x,y,z] and distance. */
  cameraInfo(): { x: number; y: number; z: number; dist: number } {
    const p = this.rig.camera.position;
    return { x: p.x, y: p.y, z: p.z, dist: p.length() };
  }

  // ---- loop ----------------------------------------------------------------

  private loop = () => {
    if (!this.running) return;
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const now = performance.now();

    // advance animations
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i];
      const tt = Math.min(1, (now - a.start) / a.dur);
      try { a.onFrame(tt); } catch (err) { console.error("reveal animation frame failed", err); }
      if (tt >= 1) { this.anims.splice(i, 1); a.resolve(); }
    }
    // expire temps
    for (let i = this.temps.length - 1; i >= 0; i--) {
      if (this.temps[i].until && now > this.temps[i].until) {
        this.scene.remove(this.temps[i].obj);
        this.temps.splice(i, 1);
      }
    }

    this.field.update(dt, t);
    this.body.update(dt, t, this.energy);
    this.energy *= Math.exp(-3 * dt);

    if (this.popping.size) {
      const a = 1 - Math.exp(-10 * dt);
      for (const p of this.popping) {
        const s = (p.mesh as THREE.Mesh).scale.x + (p.to - (p.mesh as THREE.Mesh).scale.x) * a;
        p.mesh.scale.setScalar(s);
        if (Math.abs(p.to - s) < 0.01) { p.mesh.scale.setScalar(p.to); this.popping.delete(p); }
      }
    }

    this.rig.update(dt, now);
    this.composer.render();
    this.labelRenderer.render(this.scene, this.rig.camera);
  };

  dispose() {
    this.disposed = true;
    this.revealAborted = true; // stop any suspended reveal from resuming past teardown
    this.running = false;
    cancelAnimationFrame(this.frame);
    removeEventListener("resize", this.onResize);
    this.mechanic.cancel();
    this.flushAnims();
    this.clearMarkers();
    this.field.dispose();
    this.body.dispose();
    this.markerGeo.dispose();
    for (const m of this.markerMats) m.dispose();
    // EffectComposer.dispose() does not free added passes' render targets.
    this.bloom.dispose();
    this.outputPass.dispose?.();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}
