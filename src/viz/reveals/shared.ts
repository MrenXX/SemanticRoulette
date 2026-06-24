import * as THREE from "three";
import { glowTexture } from "../textures.js";
import type { SceneTokens } from "../../theme/tokens.js";

/** A glowing guess "orb" sprite used by several mechanics. */
export function makeOrb(color: THREE.ColorRepresentation, scale = 1): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  s.scale.setScalar(scale);
  return s;
}

/** A thin additive ring mesh in the X?-plane (for shockwaves / odds rings). */
export function makeRing(radius: number, thickness: number, color: THREE.ColorRepresentation): THREE.Mesh {
  const geo = new THREE.RingGeometry(Math.max(0.01, radius - thickness), radius, 64);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

/** Dispose a mesh/sprite's geometry+material. */
export function disposeObj(obj: THREE.Object3D) {
  const any = obj as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
  any.geometry?.dispose();
  if (Array.isArray(any.material)) any.material.forEach((m) => m.dispose());
  else any.material?.dispose();
}

/** Colour for a guess/hint marker, brightened by score. */
export function markerColor(tokens: SceneTokens, score: number, kind: "guess" | "hint"): THREE.Color {
  const base = new THREE.Color(kind === "hint" ? tokens.guess : tokens.pointActive);
  return new THREE.Color(tokens.point).lerp(base, Math.min(1, 0.25 + score / 100));
}
