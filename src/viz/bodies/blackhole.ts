import * as THREE from "three";
import type { SceneTokens } from "../../theme/tokens.js";
import type { CentralBody, BodyKind } from "./types.js";

/**
 * Gravitationally-lensed black hole (Interstellar / Gargantua look). A fullscreen
 * clip-space triangle whose fragment shader reconstructs a world-space view ray
 * per pixel from the live camera, then ray-marches a Schwarzschild null geodesic
 * (kick-drift-kick leapfrog of `a = -1.5·h²·x / r⁵`, the Binet photon equation —
 * approach adapted from the MIT-licensed oseiskar/black-hole). Because the ray is
 * bent, the accretion disk's far side is lensed up-and-over the top and
 * down-and-under the bottom, the background starfield warps around the shadow,
 * and a bright photon ring hugs the event horizon. Self-contained: it renders its
 * own lensed sky + disk, so it composites as the scene's background. Units inside
 * the shader are Schwarzschild radii (horizon at r = 1); `uScale` maps to world.
 */

const VERT = /* glsl */ `
  precision highp float;
  in vec3 position;
  out vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

function fragment(steps: number): string {
  return /* glsl */ `
  precision highp float;
  in vec2 vUv;
  out vec4 fragColor;

  uniform vec3 uCamPos, uCamRight, uCamUp, uCamForward;
  uniform float uAspect, uFovMult, uTime, uScale, uEnergy;
  uniform vec3 uColHot, uColCool, uColRing;

  #define NSTEPS ${steps}
  const float R_INNER = 2.2;
  const float R_OUTER = 6.2;
  const float R_ESCAPE = 26.0;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Tanner Helland blackbody approximation (public domain): Kelvin -> RGB.
  vec3 blackbody(float T) {
    float t = clamp(T, 1500.0, 40000.0) / 100.0;
    float r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(max(t - 60.0, 1e-3), -0.1332047), 0.0, 1.0);
    float g = t <= 66.0 ? clamp(0.3900816 * log(t) - 0.6318414, 0.0, 1.0)
                        : clamp(1.1298909 * pow(max(t - 60.0, 1e-3), -0.0755148), 0.0, 1.0);
    float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.5432068 * log(max(t - 10.0, 1.0)) - 1.196254, 0.0, 1.0));
    return vec3(r, g, b);
  }

  // Procedural lensed sky: sharp stars (two cell octaves) + a faint nebula wash.
  vec3 starfield(vec3 d) {
    vec2 sph = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
    vec3 c = vec3(0.0);
    for (int k = 0; k < 2; k++) {
      float sc = k == 0 ? 22.0 : 39.0;
      vec2 g = sph * sc + float(k) * 13.7;
      vec2 id = floor(g);
      float h = hash21(id + float(k) * 5.0);
      if (h > 0.86) {
        vec2 f = fract(g) - 0.5;
        vec2 off = (vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5) * 0.6;
        float spark = smoothstep(0.07, 0.0, length(f - off));
        float tw = 0.6 + 0.4 * sin(uTime * 1.5 + h * 45.0);
        vec3 tint = mix(vec3(0.75, 0.84, 1.0), vec3(1.0, 0.92, 0.78), hash21(id + 1.7));
        c += tint * spark * tw * ((h - 0.86) / 0.14);
      }
    }
    float neb = 0.5 + 0.5 * sin(sph.x * 2.0 + uTime * 0.02) * cos(sph.y * 3.0);
    c += mix(uColCool, uColHot, 0.5 + 0.4 * d.y) * 0.012 * neb;
    return c;
  }

  // Accretion-disk emission at an equatorial-plane crossing point.
  vec3 diskColor(vec3 xc, vec3 vel) {
    float rc = length(xc);
    float band = smoothstep(R_INNER, R_INNER * 1.18, rc) * (1.0 - smoothstep(R_OUTER * 0.68, R_OUTER, rc));
    if (band <= 0.001) return vec3(0.0);
    float ang = atan(xc.z, xc.x);
    float kep = pow(R_INNER / max(rc, R_INNER), 1.5);          // keplerian swirl
    float swirl = ang + uTime * 0.5 * kep * 6.0;
    float n1 = 0.5 + 0.5 * sin(swirl * 8.0 + rc * 1.5 + hash21(vec2(floor(swirl * 3.0), floor(rc * 4.0))) * 6.2831);
    float n2 = 0.5 + 0.5 * sin(swirl * 17.0 - rc * 0.7);
    float streaks = mix(n1, n1 * n2, 0.6);
    float f = clamp((rc - R_INNER) / (R_OUTER - R_INNER), 0.0, 1.0);
    float T = mix(11000.0, 3200.0, pow(f, 0.6));               // hot inner -> cool outer
    vec3 bb = mix(blackbody(T), uColHot, 0.35);
    vec3 orbV = normalize(cross(vec3(0.0, 1.0, 0.0), xc));     // gas orbital direction
    float beam = 1.0 + 0.6 * dot(orbV, normalize(vel));        // doppler beaming
    float dens = band * (0.35 + 0.75 * streaks) * beam;
    return bb * dens * (1.4 + uEnergy * 1.5);
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    ndc.x *= uAspect;
    vec3 rd = normalize(ndc.x * uCamRight + ndc.y * uCamUp + uFovMult * uCamForward);
    vec3 ro = uCamPos / uScale;                                // world -> Schwarzschild units
    vec3 N = vec3(0.0, 1.0, 0.0);                              // equatorial disk normal

    // Early-out: rays whose straight path stays far from the hole can't lens or
    // hit the disk — just sample the (undistorted) sky. Keeps most pixels cheap.
    float tca = -dot(ro, rd);
    float b = length(ro + rd * max(tca, 0.0));
    if (tca < 0.0 || b > R_OUTER + 3.5) {
      fragColor = vec4(starfield(rd), 1.0);
      return;
    }

    vec3 x = ro;
    vec3 v = rd;
    vec3 hh = cross(x, v);
    float h2 = dot(hh, hh);                                    // conserved angular momentum²
    vec3 col = vec3(0.0);
    float transmit = 1.0;
    bool captured = false;
    float sPrev = dot(x, N);
    vec3 xPrev = x;
    float minR = 1e9;

    for (int i = 0; i < NSTEPS; i++) {
      float r2 = dot(x, x);
      float r = sqrt(r2);
      minR = min(minR, r);
      if (r2 < 1.0) { captured = true; break; }                // event horizon
      if (r2 > R_ESCAPE * R_ESCAPE && dot(x, v) > 0.0) break;   // escaped outward
      float dt = clamp(0.16 * r, 0.02, 1.2);                    // fine near the photon sphere
      vec3 a = -1.5 * h2 * x / (r2 * r2 * r);                   // Schwarzschild deflection
      v += a * (0.5 * dt);
      x += v * dt;
      float r2b = dot(x, x); float rb = sqrt(r2b);
      vec3 a2 = -1.5 * h2 * x / (r2b * r2b * rb);
      v += a2 * (0.5 * dt);
      float s = dot(x, N);
      if (s * sPrev < 0.0 && transmit > 0.02) {                // crossed the disk plane
        float tc = sPrev / (sPrev - s);
        vec3 xc = mix(xPrev, x, tc);
        vec3 dc = diskColor(xc, v);
        col += transmit * dc;
        transmit *= 1.0 - clamp((dc.r + dc.g + dc.b) * 0.25, 0.0, 0.9);
      }
      sPrev = s; xPrev = x;
    }

    // Photon ring: bright band from rays grazing the photon sphere (r = 1.5).
    float ringQ = (minR - 1.5) / 0.075;          // squared directly: pow(neg, 2.) is undefined in GLSL
    float ring = exp(-ringQ * ringQ);
    col += uColRing * ring * (1.6 + uEnergy * 2.0);

    if (!captured) col += transmit * starfield(normalize(v));  // lensed background
    fragColor = vec4(col, 1.0);
  }
`;
}

export class BlackHoleBody implements CentralBody {
  readonly kind: BodyKind = "blackhole";
  readonly object = new THREE.Group();
  readonly framing = 13;
  readonly cameraMinRadius = 14;

  private readonly mat: THREE.RawShaderMaterial;
  private readonly mesh: THREE.Mesh;
  private energy = 0;

  constructor(tokens: SceneTokens, lowQuality = false) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));

    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: fragment(lowQuality ? 30 : 64),
      depthTest: false,
      depthWrite: false,
      transparent: false,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uCamForward: { value: new THREE.Vector3(0, 0, -1) },
        uAspect: { value: 1 },
        uFovMult: { value: 1 },
        uTime: { value: 0 },
        uScale: { value: 1.4 },
        uEnergy: { value: 0 },
        uColHot: { value: new THREE.Color(tokens.pointTarget) },
        uColCool: { value: new THREE.Color(tokens.guess) },
        uColRing: { value: new THREE.Color(tokens.pointActive) },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100000; // drawn first: it is the sky behind the scene
    this.mesh.onBeforeRender = (_r, _s, camera) => this.syncCamera(camera as THREE.PerspectiveCamera);
    this.object.add(this.mesh);
  }

  private syncCamera(cam: THREE.PerspectiveCamera) {
    const e = cam.matrixWorld.elements;
    (this.mat.uniforms.uCamPos.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
    (this.mat.uniforms.uCamRight.value as THREE.Vector3).set(e[0], e[1], e[2]).normalize();
    (this.mat.uniforms.uCamUp.value as THREE.Vector3).set(e[4], e[5], e[6]).normalize();
    (this.mat.uniforms.uCamForward.value as THREE.Vector3).set(-e[8], -e[9], -e[10]).normalize();
    this.mat.uniforms.uAspect.value = cam.aspect;
    this.mat.uniforms.uFovMult.value = 1.0 / Math.tan(((cam.fov * Math.PI) / 180) / 2);
  }

  update(dt: number, t: number, energy: number) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uEnergy.value = Math.max(energy, this.energy);
    this.energy *= Math.exp(-2.2 * dt);
  }

  flare(score: number) {
    this.energy = Math.min(1.2, 0.4 + score / 100);
  }

  applyTokens(tokens: SceneTokens) {
    (this.mat.uniforms.uColHot.value as THREE.Color).set(tokens.pointTarget);
    (this.mat.uniforms.uColCool.value as THREE.Color).set(tokens.guess);
    (this.mat.uniforms.uColRing.value as THREE.Color).set(tokens.pointActive);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
