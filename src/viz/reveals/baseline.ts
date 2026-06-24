import * as THREE from "three";
import { CONFIG } from "../../game/config.js";
import type { RevealOutcome } from "../presenter.js";
import { RevealContext, RevealMechanic, randomDir } from "./types.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Baseline: ambient stars flicker, decelerate, then the camera settles on the
 *  guess's landing point. Kept as a selectable option. */
export class BaselineReveal implements RevealMechanic {
  readonly id = "baseline";
  private cycling = false;
  private timer = 0;
  private start = 0;

  beginCycle(ctx: RevealContext) {
    this.cycling = true;
    this.start = performance.now();
    const spin = () => {
      if (!this.cycling) return;
      for (let n = 0; n < 5; n++) ctx.field.flashRandom();
      ctx.sound.tick(0.4);
      this.timer = window.setTimeout(spin, ctx.reduced ? 110 : 55);
    };
    spin();
  }

  cancel() {
    this.cycling = false;
    clearTimeout(this.timer);
  }

  async settle(ctx: RevealContext, outcome: RevealOutcome, onSettle?: () => void) {
    const minMs = ctx.reduced ? 300 : CONFIG.minRevealMs;
    const waited = performance.now() - this.start;
    if (waited < minMs) await delay(minMs - waited);
    this.cycling = false;
    clearTimeout(this.timer);

    const steps = ctx.reduced ? [110, 220] : [90, 150, 260];
    for (let i = 0; i < steps.length; i++) {
      for (let n = 0; n < 3; n++) ctx.field.flashRandom();
      ctx.sound.tick(0.4 + (0.5 * i) / steps.length);
      await delay(steps[i]);
    }

    const radius = outcome.win ? 0 : ctx.radiusFor(outcome.score);
    const pos = randomDir(new THREE.Vector3()).multiplyScalar(radius);
    if (outcome.win) {
      ctx.revealCenter(outcome.word);
    } else {
      ctx.placeGuessMarker(pos, outcome);
      ctx.rig.focusOn({ x: pos.x, y: pos.y, z: pos.z }, ctx.body.framing + radius * 0.35, 1900);
    }
    ctx.body.flare(outcome.score);
    onSettle?.();
    if (outcome.win) ctx.sound.win();
    else ctx.sound.land(outcome.score);
    await delay(ctx.reduced ? 160 : 280);
  }
}
