// Procedural boat wakes drawn on the water surface (replaces blurry point-sprite wakes up close).
// Each trail is a ribbon laid along the boat's track: 9 vertices across, one row per track sample.
// Per vertex the CPU writes the across-coordinate, age, along-track distance from the bow and the
// boat's speed/length at that moment; the shader turns that into
//   · the turbulent prop wash behind the transom (frothy fbm foam over turquoise aerated water),
//   · the two Kelvin wave arms spreading from the bow (19.5° slow, narrower once planing),
//   · fading with age. Vertices follow the swell so the wake hugs the waves instead of floating.
import * as THREE from 'three';
import { waveHeight, chopAt, env } from './env.js';
import { W } from './world.js';

const ACROSS = 9, MAXP = 170, LIFE = 55;
const KELVIN = 19.47 * Math.PI / 180;

const VS = `
  attribute vec4 aW;   // x: across (−1..1), y: age (s), z: dist behind bow (m), w: half-width (m)
  attribute vec2 aS;   // x: boat speed at that moment (m/s), y: boat length (m)
  varying vec4 vW; varying vec2 vS; varying vec3 vP;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){
    vW = aW; vS = aS; vP = position;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const FS = `
  uniform float uTime; uniform float uLight; uniform vec3 uSunCol; uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;
  varying vec4 vW; varying vec2 vS; varying vec3 vP;
  #include <logdepthbuf_pars_fragment>
  float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hs(i), hs(i+vec2(1,0)), f.x), mix(hs(i+vec2(0,1)), hs(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
  void main(){
    #include <logdepthbuf_fragment>
    float u = vW.x, age = vW.y, dist = vW.z, hw = vW.w, sp = vS.x, L = vS.y;
    float x = abs(u) * hw;                                   // metres from the track centre
    float kn = sp / 0.5144;
    float life = clamp(8.0 + kn * 1.1, 8.0, 50.0);
    float fade = exp(-age / life) * smoothstep(0.0, 0.25, age);
    // ---- prop wash: white and churning right behind the transom, then a narrowing, streaky band of
    //      lighter turquoise (aerated water) that slowly heals
    float behind = smoothstep(L * 0.8, L * 1.0, dist);
    float washW = 0.42 * L * 0.32 + 0.7 + age * (0.18 + kn * 0.012);
    float core = (1.0 - smoothstep(washW * 0.35, washW, x)) * behind;
    vec2 q = vP.xz * 0.7 + vec2(uTime * 0.3, -uTime * 0.1);
    float froth = fbm(q) * 0.65 + fbm(vP.xz * 2.6 - uTime * 0.5) * 0.35;
    float energy = clamp(kn / 20.0, 0.1, 1.0);
    float fresh = exp(-age / (1.5 + energy * 2.5));                      // churned white close behind the boat
    float foamW = core * smoothstep(0.75 - 0.45 * fresh * energy, 0.95, froth + 0.25 * fresh);
    float aer = core * (0.25 + 0.35 * fresh) * smoothstep(0.25, 0.6, froth + 0.2);
    // ---- Kelvin arms: a thin crest line set just inside the ribbon edge, foamy only near the boat
    float d = (1.0 - abs(u)) * hw - 1.2;                                 // metres from the crest line
    float armW = 0.22 + age * 0.03;
    float arm = exp(-pow(d / armW, 2.0)) * smoothstep(L * 0.15, L * 0.6, dist) * smoothstep(3.0, 9.0, kn);
    float armFoam = arm * smoothstep(0.35, 0.75, fbm(vP.xz * 1.8 + uTime * 0.3)) * exp(-age / 6.0);
    float armSheen = arm * 0.22 * exp(-age / 14.0);                     // the crest reads as a brighter line of water
    // ---- compose over the water
    vec3 foamC = vec3(0.93, 0.96, 0.96) * (0.16 + 0.84 * uLight) + uSunCol * 0.05;
    vec3 aerC = vec3(0.42, 0.66, 0.66) * (0.14 + 0.86 * uLight);
    float fA = clamp(foamW * 0.92 + armFoam * 0.7, 0.0, 1.0) * fade;
    float aA = clamp(aer * 0.55 + armSheen, 0.0, 1.0) * fade;
    vec3 col = mix(aerC, foamC, fA / max(fA + aA * (1.0 - fA), 0.001));
    float a = fA + aA * (1.0 - fA);
    a *= smoothstep(1.0, 0.9, abs(u));                                   // soft ribbon edge
    float dist2 = length(vP - cameraPosition);
    a *= 1.0 - smoothstep(uFogNear, uFogFar, dist2);
    col = mix(col, uFogColor, smoothstep(uFogNear, uFogFar, dist2) * 0.5);
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, a);
  }`;

class Trail {
  constructor(mat) {
    this.pts = [];               // {x, z, h, sp, L, B, t, s}
    this.s = 0;                  // cumulative path length
    this.owner = null;
    const n = MAXP * ACROSS;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.aw = new Float32Array(n * 4); this.as = new Float32Array(n * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aW', new THREE.BufferAttribute(this.aw, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(this.as, 2).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < MAXP - 1; i++) for (let j = 0; j < ACROSS - 1; j++) {
      const a = i * ACROSS + j, b = a + 1, c = a + ACROSS, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    W.scene.add(this.mesh);
  }
  reset(owner) { this.pts.length = 0; this.s = 0; this.owner = owner; this.geo.setDrawRange(0, 0); }
  // x, z = bow position; h = heading; sp = speed (m/s)
  update(x, z, h, sp, L, B, t) {
    const last = this.pts[0];
    const moving = sp > 0.7;
    if (moving && (!last || Math.hypot(x - last.x, z - last.z) > 1.4 || t - last.t > 0.35)) {
      if (last) this.s += Math.hypot(x - last.x, z - last.z);
      this.pts.unshift({ x, z, h, sp, L, B, t, s: this.s });
      if (this.pts.length > MAXP - 1) this.pts.length = MAXP - 1;
    }
    while (this.pts.length && t - this.pts[this.pts.length - 1].t > LIFE) this.pts.pop();
    // live head row at the bow right now
    const rows = moving ? [{ x, z, h, sp, L, B, t, s: this.s + (last ? Math.hypot(x - last.x, z - last.z) : 0) }, ...this.pts] : this.pts;
    const sNow = rows.length ? rows[0].s : 0;
    const n = Math.min(rows.length, MAXP);
    // the water mesh is coarser than the analytic wave: lift the ribbon with the chop so crests don't poke through
    const lift = 0.08 + 0.45 * Math.min(1, chopAt(x, z).chop);
    for (let i = 0; i < n; i++) {
      const r = rows[i], age = t - r.t, dist = sNow - r.s;
      const Fr = r.sp / Math.sqrt(9.81 * r.L);
      const theta = KELVIN * Math.min(1, Math.pow(0.55 / Math.max(Fr, 0.05), 0.7));
      const hw = Math.min(70, r.B * 0.55 + dist * Math.tan(Math.max(theta, 0.11))) + 1.5;
      const cx = Math.cos(r.h), cz = Math.sin(r.h);       // starboard unit vector
      for (let j = 0; j < ACROSS; j++) {
        const u = j / (ACROSS - 1) * 2 - 1, k = (i * ACROSS + j);
        const px = r.x + cx * u * hw, pz = r.z + cz * u * hw;
        this.pos[k * 3] = px; this.pos[k * 3 + 1] = waveHeight(px, pz, env.time) + lift; this.pos[k * 3 + 2] = pz;
        this.aw[k * 4] = u; this.aw[k * 4 + 1] = age; this.aw[k * 4 + 2] = dist; this.aw[k * 4 + 3] = hw;
        this.as[k * 2] = r.sp; this.as[k * 2 + 1] = r.L;
      }
    }
    const g = this.geo;
    g.attributes.position.needsUpdate = true; g.attributes.aW.needsUpdate = true; g.attributes.aS.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, n - 1) * (ACROSS - 1) * 6);
  }
}

let mat = null, player = null;
const pool = [];
export function initWakes() {
  const wu = W.waterMat.uniforms;
  mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexShader: VS, fragmentShader: FS,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { uTime: { value: 0 }, uLight: wu.uLight, uSunCol: wu.uSunCol, uFogColor: wu.uFogColor, uFogNear: wu.uFogNear, uFogFar: wu.uFogFar },
  });
  player = new Trail(mat);
  for (let i = 0; i < 6; i++) pool.push(new Trail(mat));
}
const _cand = [];
// Player gets its own trail; the six nearest moving AI vessels share the pool.
export function updateWakes(p, vessels, camPos) {
  if (!mat) return;
  const t = env.time;
  mat.uniforms.uTime.value = t;
  const f = p.fwd;
  player.update(p.x + f.x * 4.6, p.z + f.z * 4.6, p.h, p.speed, 10.3, 3.25, t);
  _cand.length = 0;
  for (const v of vessels) {
    if (!v.active || !v.mesh.visible || v.speed < 1.2 || v.human || v.type === 'barge') continue;
    const d = (v.x - camPos.x) ** 2 + (v.z - camPos.z) ** 2;
    if (d < 1100 * 1100) _cand.push([d, v]);
  }
  _cand.sort((a, b) => a[0] - b[0]);
  const want = _cand.slice(0, pool.length).map(c => c[1]);
  for (const v of vessels) v._trail = false;
  const free = pool.filter(tr => !want.includes(tr.owner));
  for (const v of want) {
    let tr = pool.find(x => x.owner === v);
    if (!tr) { tr = free.shift(); tr.reset(v); }
    v._trail = true;
    tr.update(v.x + Math.sin(v.h) * v.len * 0.45, v.z - Math.cos(v.h) * v.len * 0.45, v.h, v.speed, v.len, v.beam || v.len * 0.33, t);
  }
  for (const tr of free) if (tr.owner && !want.includes(tr.owner)) { tr.update(0, 0, 0, 0, 10, 3, t); if (!tr.pts.length) tr.owner = null; }
}
