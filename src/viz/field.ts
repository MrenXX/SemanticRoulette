import * as THREE from "three";
import type { SceneTokens } from "../theme/tokens.js";
import { glowTexture, starTexture } from "./textures.js";

const STAR_COUNT = 900;
const FAR_COUNT = 1400;
const SHELL_MIN = 4.5;
const SHELL_MAX = 22;
const ZERO = new THREE.Vector3();

// Star temperatures (blue → white → amber → red).
const STAR_PALETTE = ["#9db4ff", "#bcd0ff", "#ffffff", "#fff2cf", "#ffd9a0", "#ffb27a"];

const STAR_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aGlow;
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uImplosion;
  uniform float uBurst;
  uniform float uThin;
  varying float vGlow;
  varying float vProx;
  varying vec3 vColor;
  void main() {
    if (uThin > 0.5 && aSeed < 0.62) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // thin the field behind a black hole
    vec3 pos = mix(position, vec3(0.0), uImplosion * uImplosion);
    pos *= (1.0 + uBurst * 0.5);        // outward kick on detonation
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    float dist = length(pos);
    float prox = clamp(1.0 - (dist - 2.0) / 20.0, 0.0, 1.0);
    float twinkle = 0.65 + 0.35 * sin(uTime * 1.4 + aSeed * 6.2831);
    float glow = clamp(aGlow, 0.0, 1.0);
    gl_PointSize = uSize * aSize * uPixelRatio * (620.0 / -mv.z) * (0.55 + prox * 0.8 + glow * 3.0) * twinkle * (1.0 + uBurst * 1.6) * (1.0 - 0.25 * uThin);
    gl_Position = projectionMatrix * mv;
    vGlow = glow; vProx = prox; vColor = aColor;
  }
`;

const STAR_FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D uTex;
  uniform vec3 uActive;
  uniform highp float uBurst;
  varying float vGlow;
  varying float vProx;
  varying vec3 vColor;
  void main() {
    vec4 tex = texture2D(uTex, gl_PointCoord);
    if (tex.a < 0.01) discard;
    vec3 col = mix(vColor, uActive, vGlow * 0.8) * (1.0 + uBurst * 1.6);
    float intensity = 0.5 + 0.5 * vProx + 0.8 * vGlow;
    gl_FragColor = vec4(col * intensity, tex.a * (0.5 + 0.5 * vProx + 0.6 * vGlow));
  }
`;

// Cheap lit planet: fixed light dir + optional bands + rim.
function planetMaterial(color: THREE.Color, bands: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uBands: { value: bands }, uLight: { value: new THREE.Vector3(0.6, 0.4, 0.7).normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vL; varying vec3 vPos; uniform vec3 uLight;
      void main(){ vN = normalize(normalMatrix*normal); vL = normalize(normalMatrix*uLight); vPos = position;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying vec3 vN; varying vec3 vL; varying vec3 vPos;
      uniform vec3 uColor; uniform float uBands;
      void main(){
        float diff = clamp(dot(vN, vL), 0.0, 1.0);
        float band = uBands > 0.5 ? (0.85 + 0.15*sin(vPos.y*14.0)) : 1.0;
        float rim = pow(1.0 - clamp(dot(vN, vec3(0.0,0.0,1.0)),0.0,1.0), 3.0);
        vec3 col = uColor * band * (0.12 + 0.95*diff) + uColor*rim*0.4;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Immersive ambient field: temperature-varied stars, planets, nebula, backdrop. */
export class AmbientField {
  readonly group = new THREE.Group();

  private readonly starGeo: THREE.BufferGeometry;
  private readonly starMat: THREE.ShaderMaterial;
  private readonly glowAttr: Float32Array;
  private readonly stars: THREE.Points;

  private readonly farGeo: THREE.BufferGeometry;
  private readonly farMat: THREE.PointsMaterial;
  private readonly far: THREE.Points;

  private readonly planets: THREE.Object3D[] = [];
  private readonly nebulae: THREE.Sprite[] = [];
  private readonly planetHomes: THREE.Vector3[] = [];
  private readonly nebulaHomes: { pos: THREE.Vector3; scale: number }[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(tokens: SceneTokens, pixelRatio: number) {
    // --- main stars ---
    const pos = new Float32Array(STAR_COUNT * 3);
    const seed = new Float32Array(STAR_COUNT);
    const size = new Float32Array(STAR_COUNT);
    const color = new Float32Array(STAR_COUNT * 3);
    this.glowAttr = new Float32Array(STAR_COUNT);
    const pal = STAR_PALETTE.map((c) => new THREE.Color(c));
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = SHELL_MIN + Math.cbrt(Math.random()) * (SHELL_MAX - SHELL_MIN);
      const th = Math.acos(2 * Math.random() - 1);
      const ph = Math.random() * Math.PI * 2;
      pos[i * 3] = r * Math.sin(th) * Math.cos(ph);
      pos[i * 3 + 1] = r * Math.sin(th) * Math.sin(ph) * 0.78;
      pos[i * 3 + 2] = r * Math.cos(th);
      seed[i] = Math.random();
      size[i] = 0.6 + Math.random() * Math.random() * 2.4; // mostly small, few big
      const c = pal[(Math.random() * pal.length) | 0];
      color[i * 3] = c.r; color[i * 3 + 1] = c.g; color[i * 3 + 2] = c.b;
    }
    this.starGeo = new THREE.BufferGeometry();
    this.starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.starGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    this.starGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    this.starGeo.setAttribute("aColor", new THREE.BufferAttribute(color, 3));
    this.starGeo.setAttribute("aGlow", new THREE.BufferAttribute(this.glowAttr, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: starTexture() },
        uActive: { value: new THREE.Color(tokens.pointActive) },
        uSize: { value: tokens.pointSize },
        uPixelRatio: { value: pixelRatio },
        uTime: { value: 0 },
        uImplosion: { value: 0 },
        uBurst: { value: 0 },
        uThin: { value: 0 },
      },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(this.starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.group.add(this.stars);

    // --- distant backdrop (parallax) ---
    const fpos = new Float32Array(FAR_COUNT * 3);
    for (let i = 0; i < FAR_COUNT; i++) {
      const r = 60 + Math.random() * 120;
      const th = Math.acos(2 * Math.random() - 1);
      const ph = Math.random() * Math.PI * 2;
      fpos[i * 3] = r * Math.sin(th) * Math.cos(ph);
      fpos[i * 3 + 1] = r * Math.sin(th) * Math.sin(ph);
      fpos[i * 3 + 2] = r * Math.cos(th);
    }
    this.farGeo = new THREE.BufferGeometry();
    this.farGeo.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
    this.farMat = new THREE.PointsMaterial({
      color: new THREE.Color(tokens.point), size: 0.6, sizeAttenuation: true,
      transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.far = new THREE.Points(this.farGeo, this.farMat);
    this.far.frustumCulled = false;
    this.group.add(this.far);

    // --- planets ---
    const planetSpecs: [string, number, number, boolean][] = [
      ["#b9905a", 1.15, 1, true],  // banded gas giant (ringed)
      ["#6f86b8", 0.8, 0, false],  // ice giant
      ["#9a6b52", 0.55, 0, false], // rocky
    ];
    for (let i = 0; i < planetSpecs.length; i++) {
      const [col, rad, bands, ringed] = planetSpecs[i];
      const mat = planetMaterial(new THREE.Color(col), bands);
      this.disposables.push(mat);
      const geo = new THREE.SphereGeometry(rad, 32, 32);
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      const a = (i / planetSpecs.length) * Math.PI * 2 + 0.6;
      const dist = 24 + i * 8;
      mesh.position.set(Math.cos(a) * dist, (Math.random() - 0.5) * 12 + 4, Math.sin(a) * dist);
      const holder = new THREE.Group();
      holder.add(mesh);
      if (ringed) {
        const rg = new THREE.RingGeometry(rad * 1.4, rad * 2.2, 48);
        this.disposables.push(rg);
        const rm = new THREE.MeshBasicMaterial({ color: new THREE.Color(col), transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
        this.disposables.push(rm);
        const ring = new THREE.Mesh(rg, rm);
        ring.rotation.x = Math.PI * 0.5 - 0.4;
        mesh.add(ring);
      }
      this.planets.push(holder);
      this.planetHomes.push(mesh.position.clone());
      this.group.add(holder);
    }

    // --- nebula dust ---
    const nebColors = [tokens.pointTarget, tokens.pointActive, tokens.guess];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: new THREE.Color(nebColors[i % nebColors.length]),
        transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      const a = Math.random() * Math.PI * 2;
      s.position.set(Math.cos(a) * 22, (Math.random() - 0.5) * 14, Math.sin(a) * 22 - 10);
      s.scale.setScalar(30 + Math.random() * 20);
      this.nebulae.push(s);
      this.nebulaHomes.push({ pos: s.position.clone(), scale: s.scale.x });
      this.group.add(s);
    }
  }

  applyTokens(tokens: SceneTokens) {
    (this.starMat.uniforms.uActive.value as THREE.Color).set(tokens.pointActive);
    this.starMat.uniforms.uSize.value = tokens.pointSize;
    this.farMat.color.set(tokens.point);
    const nebColors = [tokens.pointTarget, tokens.pointActive, tokens.guess];
    this.nebulae.forEach((n, i) => (n.material as THREE.SpriteMaterial).color.set(nebColors[i % nebColors.length]));
  }

  setPixelRatio(pr: number) {
    this.starMat.uniforms.uPixelRatio.value = pr;
  }

  get starCount() {
    return STAR_COUNT;
  }

  /** World position of star i (for mechanics that target real stars). */
  starPosition(i: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.starGeo.attributes.position as THREE.BufferAttribute;
    return out.set(p.getX(i), p.getY(i), p.getZ(i));
  }

  flash(i: number, v = 1) {
    if (i >= 0 && i < STAR_COUNT) this.glowAttr[i] = Math.max(this.glowAttr[i], v);
  }

  flashRandom(): number {
    const i = (Math.random() * STAR_COUNT) | 0;
    this.flash(i);
    return i;
  }

  /** 0..1 — pulls the whole star field toward the centre (supernova vacuum). */
  setImplosion(v: number) {
    this.starMat.uniforms.uImplosion.value = Math.max(0, Math.min(1, v));
  }

  /** 0..1 — collapse ALL near ambient objects toward the centre: stars (via the
   *  implosion uniform), plus planets and nebula dust pulled in + shrunk. The
   *  far backdrop is intentionally left alone. v=0 restores everything. */
  setCollapse(v: number) {
    const c = Math.max(0, Math.min(1, v));
    this.setImplosion(c);
    for (let i = 0; i < this.planets.length; i++) {
      const mesh = this.planets[i].children[0] as THREE.Mesh;
      mesh.position.lerpVectors(this.planetHomes[i], ZERO, c);
      mesh.scale.setScalar(1 - 0.85 * c);
    }
    for (let i = 0; i < this.nebulae.length; i++) {
      const home = this.nebulaHomes[i];
      this.nebulae[i].position.lerpVectors(home.pos, ZERO, c);
      this.nebulae[i].scale.setScalar(home.scale * (1 - 0.7 * c));
    }
  }

  /** Transient detonation energy (0..~1): flares + kicks the stars outward. */
  setBurst(v: number) {
    this.starMat.uniforms.uBurst.value = Math.max(0, v);
  }

  /** In black-hole mode the décor is thinned so nothing unlensed floats in front
   *  of the lensed sky: the far backdrop + planets hide, nebulae dim, and ~half
   *  the near stars are culled. */
  setBlackHoleMode(on: boolean) {
    this.far.visible = !on;
    for (const p of this.planets) p.visible = !on;
    for (const n of this.nebulae) (n.material as THREE.SpriteMaterial).opacity = on ? 0.025 : 0.06;
    this.starMat.uniforms.uThin.value = on ? 1.0 : 0.0;
  }

  update(dt: number, t: number) {
    const decay = Math.exp(-5.5 * dt);
    for (let i = 0; i < STAR_COUNT; i++) this.glowAttr[i] *= decay;
    (this.starGeo.attributes.aGlow as THREE.BufferAttribute).needsUpdate = true;
    this.starMat.uniforms.uTime.value = t;
    this.far.rotation.y = t * 0.006;
    for (let i = 0; i < this.planets.length; i++) {
      this.planets[i].rotation.y += dt * (0.05 + i * 0.02);
      (this.planets[i].children[0] as THREE.Mesh).rotation.y += dt * 0.1;
    }
    for (let i = 0; i < this.nebulae.length; i++) this.nebulae[i].material.rotation = t * 0.02 * (i + 1);
  }

  dispose() {
    this.starGeo.dispose();
    this.starMat.dispose();
    this.farGeo.dispose();
    this.farMat.dispose();
    for (const n of this.nebulae) (n.material as THREE.Material).dispose();
    for (const d of this.disposables) d.dispose();
  }
}
