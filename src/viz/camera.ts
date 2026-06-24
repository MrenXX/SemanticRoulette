import * as THREE from "three";

/**
 * Camera rig orbiting a central body. Supports:
 *  - ambient slow drift,
 *  - user **drag-to-rotate** with speed proportional to drag velocity + inertia
 *    (a flywheel that decays and eases back into drift when idle),
 *  - ease-focus / driveTo for reveals (which suspend drift + inertia).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private azimuth = 0;
  private elevation = 0.28;
  private radius = 40;
  private minRadius = 8;
  private maxRadius = 90;
  private readonly driftSpeed = 0.05;

  // Drag / inertia state.
  private dragging = false;
  private azVel = 0; // angular velocity (rad/s) carried as momentum
  private elVel = 0;
  private idleTime = 0; // seconds since last user interaction
  private readonly minEl = -0.62;
  private readonly maxEl = 1.15;

  private focusing = false;
  private focusUntil = 0;
  // Cinematic follow (reveal): camera look (and optionally pose) track a moving point.
  private following = false;
  private followLook: (() => THREE.Vector3) | null = null;
  private followPose: (() => THREE.Vector3) | null = null;
  private followPosGain = 4;
  private followLookGain = 6;
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly currentLook = new THREE.Vector3();

  reducedMotion = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(52, aspect, 0.1, 600);
    this.updateOrbitTarget();
    this.camera.position.copy(this.desiredPos);
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Clamp the orbit distance to a body-appropriate range (e.g. a black hole
   *  needs a larger minimum so the camera never dives into the lensing). */
  setRadiusBounds(min: number, max: number) {
    this.minRadius = min;
    this.maxRadius = max;
    this.radius = Math.max(min, Math.min(max, this.radius));
  }

  /** Mouse-wheel zoom. Positive deltaY (scroll down) dollies out. Multiplicative
   *  so each notch feels proportional. Updates the *resting* radius the camera
   *  returns to after a reveal. */
  zoom(deltaY: number) {
    const factor = Math.exp(deltaY * 0.0014);
    this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius * factor));
    this.focusing = false;
    this.following = false;
    this.idleTime = 0;
  }

  private updateOrbitTarget() {
    const ce = Math.cos(this.elevation);
    const se = Math.sin(this.elevation);
    this.desiredPos.set(
      Math.cos(this.azimuth) * this.radius * ce,
      se * this.radius,
      Math.sin(this.azimuth) * this.radius * ce,
    );
    this.desiredLook.set(0, 0, 0);
  }

  // ---- user drag -----------------------------------------------------------

  beginDrag() {
    this.dragging = true;
    this.focusing = false;
    this.following = false;
    this.azVel = 0;
    this.elVel = 0;
    this.idleTime = 0;
  }

  /** dx/dy in pixels since the last move; dt in seconds. */
  drag(dx: number, dy: number, dt: number) {
    if (!this.dragging) return;
    const sens = 0.005;
    const dAz = dx * sens;
    const dEl = dy * sens;
    this.azimuth += dAz;
    this.elevation = Math.max(this.minEl, Math.min(this.maxEl, this.elevation + dEl));
    // Velocity so release carries momentum proportional to drag speed.
    if (dt > 1e-4) {
      this.azVel = dAz / dt;
      this.elVel = dEl / dt;
    }
    this.idleTime = 0;
  }

  endDrag() {
    this.dragging = false;
    this.idleTime = 0;
    const maxV = 6; // clamp wild flings
    this.azVel = Math.max(-maxV, Math.min(maxV, this.azVel));
    this.elVel = Math.max(-maxV, Math.min(maxV, this.elVel));
  }

  get interacting(): boolean {
    return this.dragging || Math.abs(this.azVel) > 0.01 || Math.abs(this.elVel) > 0.01;
  }

  // ---- reveal focus --------------------------------------------------------

  focusOn(target: THREE.Vector3Like, distance = 14, holdMs = 1600) {
    this.focusing = true;
    this.following = false;
    this.focusUntil = performance.now() + holdMs;
    const t = new THREE.Vector3(target.x, target.y, target.z);
    const dir = new THREE.Vector3().subVectors(this.camera.position, t);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0.3, 1);
    dir.normalize();
    dir.y += 0.25;
    dir.normalize();
    this.desiredPos.copy(t).addScaledVector(dir, distance);
    this.desiredLook.copy(t);
  }

  /** Drive the camera to an explicit pose (eased). For mechanics like warp dive. */
  driveTo(pos: THREE.Vector3Like, look: THREE.Vector3Like, holdMs = 1200) {
    this.focusing = true;
    this.following = false;
    this.focusUntil = performance.now() + holdMs;
    this.desiredPos.set(pos.x, pos.y, pos.z);
    this.desiredLook.set(look.x, look.y, look.z);
  }

  /** Cinematic tracking: the look target (and optionally the pose) follow a
   *  moving point each frame. Used by Supernova to trail the guess orb without
   *  the nausea of a literal chase cam (keep `poseFn` gentle/stable). Separate
   *  pose/look gains let the pose glide slowly while the look stays locked on the
   *  subject so it never leaves frame. */
  follow(
    lookFn: () => THREE.Vector3,
    poseFn?: () => THREE.Vector3,
    gains?: { pos?: number; look?: number },
  ) {
    this.following = true;
    this.focusing = false;
    this.followLook = lookFn;
    this.followPose = poseFn ?? null;
    this.followPosGain = gains?.pos ?? 4;
    this.followLookGain = gains?.look ?? 6;
  }

  stopFollow(returnToOrbit = true) {
    if (!this.following) return;
    this.following = false;
    this.followLook = null;
    this.followPose = null;
    if (returnToOrbit) this.release();
  }

  release() {
    this.focusing = false;
    this.following = false;
    this.followLook = null;
    this.followPose = null;
    // Re-sync orbit ANGLES to the camera's current direction so the return is a
    // pure radial dolly (no lateral arc), but KEEP the user's resting radius so
    // we don't get stuck zoomed-in on the centre after a reveal.
    const p = this.camera.position;
    const len = p.length() || 1;
    this.elevation = Math.max(this.minEl, Math.min(this.maxEl, Math.asin(p.y / len)));
    this.azimuth = Math.atan2(p.z, p.x);
    this.radius = Math.max(this.minRadius, Math.min(this.maxRadius, this.radius));
    this.idleTime = 0;
  }

  update(dt: number, now: number) {
    if (this.following) {
      if (this.followLook) this.desiredLook.copy(this.followLook());
      if (this.followPose) this.desiredPos.copy(this.followPose());
    } else {
      if (this.focusing && now > this.focusUntil) this.release(); // clears focusing
      if (this.focusing) {
        // hold: desiredPos / desiredLook were set by focusOn / driveTo
      } else if (this.dragging) {
        this.updateOrbitTarget(); // angles already updated by drag()
      } else if (this.interacting) {
        this.azimuth += this.azVel * dt;
        this.elevation = Math.max(this.minEl, Math.min(this.maxEl, this.elevation + this.elVel * dt));
        const damp = Math.exp(-2.2 * dt); // flywheel friction
        this.azVel *= damp;
        this.elVel *= damp;
        this.updateOrbitTarget();
      } else {
        this.idleTime += dt;
        if (!this.reducedMotion && this.idleTime > 0.6) this.azimuth += this.driftSpeed * dt;
        this.elevation += (0.28 - this.elevation) * (1 - Math.exp(-0.5 * dt));
        this.updateOrbitTarget();
      }
    }

    if (this.following) {
      const ap = 1 - Math.exp(-this.followPosGain * dt);
      const al = 1 - Math.exp(-this.followLookGain * dt);
      this.camera.position.lerp(this.desiredPos, ap);
      this.currentLook.lerp(this.desiredLook, al);
    } else {
      const k = this.focusing ? 3.2 : this.dragging ? 18 : 6;
      const a = 1 - Math.exp(-k * dt);
      this.camera.position.lerp(this.desiredPos, a);
      this.currentLook.lerp(this.desiredLook, a);
    }
    this.camera.lookAt(this.currentLook);
  }
}
