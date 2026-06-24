import * as THREE from "three";
import { CONFIG } from "../../game/config.js";
import type { RevealOutcome } from "../presenter.js";
import { RevealContext, RevealMechanic, easeOutCubic } from "./types.js";
import { makeOrb, makeRing, disposeObj } from "./shared.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Build an orthonormal basis (u, v) spanning the plane with the given normal. */
function basis(normal: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const n = normal.clone().normalize();
  const ref = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(ref, n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  return [u, v];
}

/**
 * Orbital Roulette (signature mechanic). The guess enters as a luminous ball on
 * a wide orbit and whips around the central body like a roulette ball; its orbit
 * DECAYS inward through concentric odds rings, decelerating, and DROPS into its
 * final orbit (radius = score). On-theme: it's literally Semantic *Roulette*.
 */
export class OrbitalRoulette implements RevealMechanic {
  readonly id = "orbital";
  private orb: THREE.Sprite | null = null;
  private rings: THREE.Mesh[] = [];
  private liveRing: THREE.Mesh | null = null;
  private readonly normal = new THREE.Vector3();
  private readonly u = new THREE.Vector3();
  private readonly v = new THREE.Vector3();

  beginCycle(ctx: RevealContext) {
    this.normal.set(Math.random() - 0.5, 0.55 + Math.random() * 0.3, Math.random() - 0.5).normalize();
    const [u, v] = basis(this.normal);
    this.u.copy(u);
    this.v.copy(v);

    this.orb = makeOrb(ctx.tokens.pointActive, 2.6);
    ctx.addTemp(this.orb);

    // Faint concentric "odds" rings the ball will cross.
    this.rings = [];
    const radii = [14, 10.5, 7.5, 5, 3];
    for (const r of radii) {
      const ring = makeRing(r, 0.06, ctx.tokens.guess);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.12;
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.normal);
      ctx.addTemp(ring);
      this.rings.push(ring);
    }

    // The bright "live" orbit line the ball literally rides: a unit ring scaled
    // every frame to the ball's current radius (same plane), so the light is
    // always exactly on the circle as it spirals inward.
    this.liveRing = makeRing(1, 0.03, ctx.tokens.pointActive);
    (this.liveRing.material as THREE.MeshBasicMaterial).opacity = 0.9;
    this.liveRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.normal);
    this.liveRing.scale.setScalar(17);
    ctx.addTemp(this.liveRing);

    ctx.sound.tick(0.3);
  }

  cancel() {
    /* the scene flushes in-flight animations on cancel */
  }

  async settle(ctx: RevealContext, outcome: RevealOutcome, onSettle?: () => void) {
    if (!this.orb) return;
    const reduced = ctx.reduced;
    const finalR = outcome.win ? 1.4 : ctx.radiusFor(outcome.score);
    const startR = 17;
    const spins = reduced ? 1.6 : 3.2 + (outcome.score / 100) * 1.4; // hotter guesses orbit longer
    const dur = reduced ? 480 : Math.max(CONFIG.minRevealMs, 1500);
    const startAngle = Math.random() * Math.PI * 2;
    const pos = new THREE.Vector3();
    let lastRingCrossed = -1;
    let lastSpin = 0;

    // Frame the action from a little further out.
    ctx.rig.focusOn({ x: 0, y: 0, z: 0 }, ctx.body.framing + 12, dur + 700);

    await ctx.animate(dur, (t) => {
      // Decelerating angle (fast → slow) and inward-decaying radius.
      const ang = startAngle + spins * Math.PI * 2 * easeOutCubic(t);
      const radius = startR + (finalR - startR) * easeOutCubic(t) + Math.sin(t * Math.PI) * 0.8 * (1 - t);
      pos.copy(this.u).multiplyScalar(Math.cos(ang) * radius)
        .addScaledVector(this.v, Math.sin(ang) * radius);
      this.orb!.position.copy(pos);
      this.orb!.scale.setScalar(2.6 - t * 0.9);

      // The live orbit ring tracks the ball's exact radius so it always rides
      // the glowing line as it spirals inward.
      if (this.liveRing) {
        this.liveRing.scale.setScalar(Math.max(0.01, radius));
        (this.liveRing.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * (0.5 + 0.5 * Math.sin(t * 40.0));
      }

      // Tick + spark each time we cross a ring threshold or complete a spin.
      const curSpin = Math.floor(spins * easeOutCubic(t));
      if (curSpin !== lastSpin) {
        lastSpin = curSpin;
        ctx.sound.tick(0.4 + t * 0.5);
      }
      const ringIdx = this.rings.findIndex((r, i) =>
        radius <= (r.geometry as THREE.RingGeometry).parameters.outerRadius && i > lastRingCrossed);
      if (ringIdx >= 0) {
        lastRingCrossed = ringIdx;
        const m = this.rings[ringIdx].material as THREE.MeshBasicMaterial;
        m.opacity = 0.6;
        ctx.field.flashRandom();
      }
      for (const r of this.rings) {
        const m = r.material as THREE.MeshBasicMaterial;
        m.opacity *= 0.94;
      }
    });

    // Drop into the final orbit.
    if (outcome.win) {
      ctx.revealCenter(outcome.word);
      this.orb!.scale.setScalar(0.001);
    } else {
      ctx.placeGuessMarker(pos, outcome);
      this.orb!.scale.setScalar(0.001);
      ctx.rig.focusOn({ x: pos.x, y: pos.y, z: pos.z }, ctx.body.framing + finalR * 0.3, 1700);
    }
    ctx.body.flare(outcome.score);
    onSettle?.();
    if (outcome.win) ctx.sound.win();
    else ctx.sound.land(outcome.score);

    // Fade + clean temp objects.
    await ctx.animate(reduced ? 160 : 360, (t) => {
      for (const r of this.rings) (r.material as THREE.MeshBasicMaterial).opacity *= 1 - t * 0.3;
      if (this.liveRing) (this.liveRing.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    });
    if (this.orb) { ctx.removeTemp(this.orb); disposeObj(this.orb); this.orb = null; }
    if (this.liveRing) { ctx.removeTemp(this.liveRing); disposeObj(this.liveRing); this.liveRing = null; }
    for (const r of this.rings) { ctx.removeTemp(r); disposeObj(r); }
    this.rings = [];
    await delay(0);
  }
}
