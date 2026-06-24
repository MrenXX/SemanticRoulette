import * as THREE from "three";
import { CONFIG } from "../../game/config.js";
import type { RevealOutcome } from "../presenter.js";
import { RevealContext, RevealMechanic, easeInCubic, easeOutCubic, randomDir } from "./types.js";
import { makeOrb, disposeObj } from "./shared.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const easeInQuart = (t: number) => t * t * t * t;

/**
 * Supernova Snap (rebuilt). Every ambient object — stars, planets, nebula dust —
 * is dragged into the centre and crushed to a singularity; it DETONATES (a deep
 * boom, no shock ring) and everything explodes back to place while the guess is
 * flung outward to its final radius, the camera tracking it the whole way. A
 * tight launch = high score; a long flight = a fun near-miss. Owns
 * collapse → singularity → rebirth — distinct from orbiting and from capture.
 */
export class SupernovaSnap implements RevealMechanic {
  readonly id = "supernova";
  private flash: THREE.Sprite | null = null;
  private orb: THREE.Sprite | null = null;
  private readonly orbPos = new THREE.Vector3();
  private start = 0;

  beginCycle(ctx: RevealContext) {
    this.start = performance.now();
    // A central flash sprite (no ring); blooms at the detonation.
    this.flash = makeOrb(0xffffff, 0.001);
    (this.flash.material as THREE.SpriteMaterial).opacity = 0;
    ctx.addTemp(this.flash);
    ctx.sound.swell();
  }

  cancel() {
    /* the scene resets field collapse/burst, markers and follow on cancel */
  }

  async settle(ctx: RevealContext, outcome: RevealOutcome, onSettle?: () => void) {
    const reduced = ctx.reduced;
    const finalR = outcome.win ? 1.4 : ctx.radiusFor(outcome.score);
    const dir = randomDir(new THREE.Vector3());
    const target = dir.clone().multiplyScalar(finalR);

    const minMs = reduced ? 300 : CONFIG.minRevealMs;
    const elapsed = performance.now() - this.start;
    if (elapsed < minMs * 0.3) await delay(minMs * 0.3 - elapsed);
    if (ctx.aborted) return;

    // 1) COLLAPSE — a slow, ACCELERATING implosion: the whole field rushes in and
    //    compresses. The camera eases in but stays back enough to watch it crush
    //    down, and the swell rises the whole way.
    ctx.setMarkersDim(1);
    ctx.rig.focusOn({ x: 0, y: 0, z: 0 }, ctx.body.framing + 6, reduced ? 400 : 1500);
    await ctx.animate(reduced ? 220 : 1000, (t) => {
      const e = easeInQuart(t); // accelerates as the energy falls inward
      ctx.field.setCollapse(e);
      ctx.body.flare(outcome.score * 0.16 * e);
      ctx.sound.tick(0.12 + t * 0.5);
    });
    if (ctx.aborted) return;

    // 2) SINGULARITY — a held compression beat: everything crushed to a bright
    //    point, energy wound up tight before release.
    ctx.sound.thump();
    await ctx.animate(reduced ? 110 : 320, (t) => {
      ctx.field.setCollapse(1);
      this.flash!.scale.setScalar(0.3 + t * 1.3);
      (this.flash!.material as THREE.SpriteMaterial).opacity = 0.25 + t * 0.5;
      ctx.body.flare(outcome.score * 0.3);
    });
    if (ctx.aborted) return;

    // 3) DETONATION + SCATTER — a deep cosmic boom; the shell expands fast then
    //    DECELERATES (easeOut) like a real remnant. The guess rides outward slowly
    //    enough for the camera to glide after it — the look stays locked on the
    //    centre↔orb midpoint so the core never leaves frame.
    ctx.sound.boom(reduced);
    this.orb = makeOrb(ctx.tokens.pointActive, 0.001);
    this.orbPos.copy(dir).multiplyScalar(0.01);
    this.orb.position.copy(this.orbPos);
    ctx.addTemp(this.orb);

    if (!reduced) {
      const stable = this.framePose(ctx, finalR);
      const mid = new THREE.Vector3();
      ctx.rig.follow(
        () => mid.copy(this.orbPos).multiplyScalar(0.5),
        () => stable,
        { pos: 2.4, look: 4.5 },
      );
    }

    const dur = reduced ? 260 : 1500;
    await ctx.animate(dur, (t) => {
      const e = easeOutCubic(t);
      ctx.field.setCollapse(1 - e); // scatter back out, fast then easing
      ctx.field.setBurst(Math.sin(easeOutCubic(Math.min(1, t * 1.25)) * Math.PI) * 0.6); // rise→fall
      // central flash blooms big then fades slowly.
      this.flash!.scale.setScalar(2 + easeOutCubic(Math.min(1, t * 1.5)) * (reduced ? 12 : 30));
      (this.flash!.material as THREE.SpriteMaterial).opacity = (1 - easeInCubic(t)) * 0.85;
      // guess flies centre→finalR on a decelerating ease (no snappy back-overshoot).
      const orbR = finalR * easeOutCubic(t);
      this.orbPos.copy(dir).multiplyScalar(Math.max(0.01, orbR));
      this.orb!.position.copy(this.orbPos);
      this.orb!.scale.setScalar(easeOutCubic(Math.min(1, t * 1.3)) * 1.7);
      if (!reduced && t > 0.5 && Math.random() > 0.92) ctx.field.flashRandom(); // sparse embers
    });
    ctx.field.setCollapse(0);
    ctx.field.setBurst(0);
    if (ctx.aborted) return;

    // 4) SETTLE — the orb lands: place the marker / reveal the centre and fire the
    //    HUD count-up NOW (synced to the visual landing), restore the stage, frame
    //    the result, then hand the camera back to the user orbit.
    if (outcome.win) ctx.revealCenter(outcome.word);
    else ctx.placeGuessMarker(target, outcome);
    onSettle?.();
    ctx.setMarkersDim(0);
    ctx.body.flare(outcome.score);
    if (outcome.win) ctx.sound.win();
    else ctx.sound.land(outcome.score);

    if (!reduced) {
      ctx.rig.stopFollow(false);
      ctx.rig.focusOn({ x: target.x, y: target.y, z: target.z }, ctx.body.framing + finalR * 0.3, 1600);
    }

    // cleanup
    if (this.orb) { ctx.removeTemp(this.orb); disposeObj(this.orb); this.orb = null; }
    if (this.flash) { ctx.removeTemp(this.flash); disposeObj(this.flash); this.flash = null; }
    await delay(0);
  }

  /** A stable, pulled-back camera pose sized (from the live FOV/aspect) to keep
   *  both the central body and the orb's final radius comfortably in frame. */
  private framePose(ctx: RevealContext, finalR: number): THREE.Vector3 {
    const cam = ctx.rig.camera;
    const fovV = THREE.MathUtils.degToRad(cam.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * cam.aspect);
    const fit = Math.max(finalR, ctx.body.framing * 0.5) + 3;
    const dist = fit / Math.sin(Math.min(fovV, fovH) / 2);
    const pose = cam.position.clone().setLength(THREE.MathUtils.clamp(dist, ctx.body.framing + 4, 80));
    pose.y += 2;
    return pose;
  }
}
