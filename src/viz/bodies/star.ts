import * as THREE from "three";
import type { SceneTokens } from "../../theme/tokens.js";
import type { CentralBody, BodyKind } from "./types.js";
import { glowTexture } from "../textures.js";

const SURF_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vP = position;
    gl_Position = projectionMatrix * mv;
  }
`;

// Animated star surface: layered sin "granulation" + limb brightening.
const SURF_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uHot;
  uniform vec3 uCool;
  varying vec3 vN;
  varying vec3 vP;
  float n(vec3 p){
    return sin(p.x*3.0+uTime*0.7)*sin(p.y*3.4-uTime*0.5)*sin(p.z*3.1+uTime*0.6);
  }
  void main(){
    float g = n(vP*1.3)*0.5 + n(vP*3.1)*0.3 + n(vP*6.0)*0.2;
    g = g*0.5+0.5;
    float limb = pow(clamp(dot(vN, vec3(0.0,0.0,1.0)), 0.0, 1.0), 0.5);
    vec3 col = mix(uCool, uHot, g);
    col += uHot * (1.0 - limb) * 0.6;      // bright rim
    col *= 1.0 + uEnergy * 0.8;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class StarBody implements CentralBody {
  readonly kind: BodyKind = "star";
  readonly object = new THREE.Group();
  readonly framing = 9;

  private readonly mat: THREE.ShaderMaterial;
  private readonly corona: THREE.Sprite;
  private readonly flares: THREE.Sprite[] = [];
  private flareEnergy = 0;

  constructor(tokens: SceneTokens) {
    const hot = new THREE.Color(tokens.pointTarget);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uHot: { value: hot.clone() },
        uCool: { value: hot.clone().multiplyScalar(0.5) },
      },
      vertexShader: SURF_VERT,
      fragmentShader: SURF_FRAG,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 48), this.mat);
    this.object.add(core);

    this.corona = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: hot, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.corona.scale.setScalar(7);
    this.object.add(this.corona);

    for (let i = 0; i < 3; i++) {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: hot, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      f.scale.setScalar(3);
      this.flares.push(f);
      this.object.add(f);
    }
  }

  update(_dt: number, t: number, energy: number) {
    const e = Math.max(energy, this.flareEnergy);
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uEnergy.value = e;
    const pulse = 6.6 + Math.sin(t * 1.4) * 0.4 + e * 4;
    this.corona.scale.setScalar(pulse);
    (this.corona.material as THREE.SpriteMaterial).opacity = 0.7 + e * 0.3;
    for (let i = 0; i < this.flares.length; i++) {
      const a = t * (0.6 + i * 0.25) + i * 2;
      const r = 1.4;
      this.flares[i].position.set(Math.cos(a) * r, Math.sin(a * 1.3) * r, Math.sin(a) * r);
      (this.flares[i].material as THREE.SpriteMaterial).opacity = this.flareEnergy * 0.8;
      this.flares[i].scale.setScalar(2 + this.flareEnergy * 3);
    }
    this.flareEnergy *= Math.exp(-2.5 * _dt);
  }

  flare(score: number) {
    this.flareEnergy = Math.min(1, 0.4 + score / 100);
  }

  applyTokens(tokens: SceneTokens) {
    const hot = new THREE.Color(tokens.pointTarget);
    (this.mat.uniforms.uHot.value as THREE.Color).copy(hot);
    (this.mat.uniforms.uCool.value as THREE.Color).copy(hot.clone().multiplyScalar(0.5));
    (this.corona.material as THREE.SpriteMaterial).color.copy(hot);
    for (const f of this.flares) (f.material as THREE.SpriteMaterial).color.copy(hot);
  }

  dispose() {
    this.object.traverse((o) => {
      const any = o as unknown as { geometry?: THREE.BufferGeometry; material?: THREE.Material };
      any.geometry?.dispose();
      any.material?.dispose();
    });
  }
}
