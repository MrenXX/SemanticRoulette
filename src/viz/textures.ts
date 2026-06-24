import * as THREE from "three";

/** Cached procedural sprite textures (shared across the scene; cheap, no assets). */

let glow: THREE.Texture | null = null;
let disc: THREE.Texture | null = null;
let spikes: THREE.Texture | null = null;
let star: THREE.Texture | null = null;

/** Soft radial glow (corona / halo). */
export function glowTexture(): THREE.Texture {
  if (glow) return glow;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.5)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glow = new THREE.CanvasTexture(c);
  return glow;
}

/** Crisp small disc with a soft edge (star/planet points). */
export function discTexture(): THREE.Texture {
  if (disc) return disc;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.85)");
  grd.addColorStop(0.78, "rgba(255,255,255,0.25)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  disc = new THREE.CanvasTexture(c);
  return disc;
}

/** A bright star with 4 diffraction spikes (white dwarf / bright stars). */
export function spikeTexture(): THREE.Texture {
  if (spikes) return spikes;
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const cx = s / 2;
  // core
  const core = g.createRadialGradient(cx, cx, 0, cx, cx, s * 0.18);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  // spikes (additive gradients along axes)
  g.globalCompositeOperation = "lighter";
  for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
    const grd = g.createLinearGradient(cx - dx * cx, cx - dy * cx, cx + dx * cx, cx + dy * cx);
    grd.addColorStop(0, "rgba(255,255,255,0)");
    grd.addColorStop(0.5, "rgba(255,255,255,0.9)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    if (dx) g.fillRect(0, cx - 1.2, s, 2.4);
    else g.fillRect(cx - 1.2, 0, 2.4, s);
  }
  spikes = new THREE.CanvasTexture(c);
  return spikes;
}

/** A small star sprite with a faint cross flare — used for the ambient field. */
export function starTexture(): THREE.Texture {
  if (star) return star;
  const s = 96;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  const cx = s / 2;
  const core = g.createRadialGradient(cx, cx, 0, cx, cx, s * 0.42);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.4, "rgba(255,255,255,0.5)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = "lighter";
  g.strokeStyle = "rgba(255,255,255,0.35)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, 6); g.lineTo(cx, s - 6);
  g.moveTo(6, cx); g.lineTo(s - 6, cx);
  g.stroke();
  star = new THREE.CanvasTexture(c);
  return star;
}
