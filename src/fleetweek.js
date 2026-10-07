// Fleet Week (early October): the Blue Angels airshow over the Marina Green show box, the USCG
// safety zone, Navy ships at anchor off the city front and a few hundred spectator boats.
// Jets: six F/A-18E/F Super Hornets (blue/gold) + "Fat Albert" (C-130J). Maneuvers are piecewise
// constant-speed paths (straights, level turns, vertical loops); aircraft attitude comes from the
// path's velocity and acceleration (bank/pitch follow the lift vector), smoke trails drift downwind,
// and the sound is computed from sound-delayed positions with Doppler and air absorption.
import * as THREE from 'three';
import { ll, sdfAt } from './geo.js';
import { env, windAt } from './env.js';
import { W, hazeify } from './world.js';
import { GB, MAT, buildPowerboat, buildSailboat, buildBuoy, buildRIB } from './models.js';
import { traffic, Vessel } from './traffic.js';
import { jetAudio } from './audio.js';
import { say } from './radio.js';

const D2R = Math.PI / 180;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const BLUE = '#0d2a6e', GOLD = '#f2c230', DARKG = '#2a2d31';

// ---------------------------------------------------------------- show box geometry
// Show line runs ENE along the Marina / Crissy waterfront ~0.3 km offshore; the crowd is on shore
// (south), the box extends ~1.2 km north toward Alcatraz. Local frame: a = along the show line (east),
// n = away from the crowd (north-ish), y = up.
const SHOW = { lat: 37.8120, lon: -122.4450, brg: 82, aMin: -2500, aMax: 2500, nMin: -280, nMax: 1200 };
let C = null, AX = null, NX = null;
function frame() {
  if (C) return;
  C = ll(SHOW.lat, SHOW.lon);
  const b = SHOW.brg * D2R, n = (SHOW.brg - 90) * D2R;
  AX = { x: Math.sin(b), z: -Math.cos(b) }; NX = { x: -Math.sin(n), z: Math.cos(n) };   // n points away from shore
  // NX must point north-ish (−z); flip if needed
  if (NX.z > 0) { NX.x = -NX.x; NX.z = -NX.z; }
}
function toWorld(p, out = new THREE.Vector3()) { return out.set(C.x + AX.x * p.x + NX.x * p.z, p.y, C.z + AX.z * p.x + NX.z * p.z); }
function dirToWorld(d, out = new THREE.Vector3()) { return out.set(AX.x * d.x + NX.x * d.z, d.y, AX.z * d.x + NX.z * d.z); }

// ---------------------------------------------------------------- aircraft models (nose −Z, up +Y)
function buildHornet() {
  const gb = new GB();
  const q = (a, b, c, d, col) => gb.quad(a, b, c, d, col);
  gb.cyl(0.78, 11.5, BLUE, 0, 0, 0.6, 12, Math.PI / 2);                       // fuselage
  gb.cyl(0.78, 4.2, BLUE, 0, 0, -7.25, 12, -Math.PI / 2, 0, 0, 0.06);         // radome
  gb.sphere(1, '#c9a24a', 0, 0.72, -4.6, 0.42, 0.42, 1.5);                    // gold-tinted canopy
  gb.box(1.9, 0.9, 6.0, BLUE, 0, -0.25, 1.2);                                 // intakes / belly
  gb.box(0.06, 0.18, 9.5, GOLD, 0.8, 0.0, -0.5); gb.box(0.06, 0.18, 9.5, GOLD, -0.8, 0.0, -0.5); // side stripes
  for (const s of [-1, 1]) {
    // LEX (leading-edge extension) and wing: blue on top, gold underneath
    q([s * 0.75, 0.12, -5.6], [s * 0.75, 0.12, -0.8], [s * 1.7, 0.12, -0.6], [s * 1.0, 0.12, -3.2], BLUE);
    q([s * 0.75, 0.15, -1.0], [s * 0.75, 0.15, 3.6], [s * 6.8, 0.15, 3.1], [s * 6.8, 0.15, 1.5], BLUE);
    q([s * 0.75, 0.09, -1.0], [s * 6.8, 0.09, 1.5], [s * 6.8, 0.09, 3.1], [s * 0.75, 0.09, 3.6], GOLD);
    q([s * 6.6, 0.16, 1.55], [s * 6.6, 0.16, 3.1], [s * 6.85, 0.16, 3.1], [s * 6.85, 0.16, 1.5], GOLD);   // gold wingtip
    // horizontal stabilator
    q([s * 0.7, 0.0, 4.4], [s * 0.7, 0.0, 6.7], [s * 3.5, 0.0, 6.6], [s * 3.5, 0.0, 5.6], BLUE);
    // canted twin fins (20° out)
    const bx = s * 1.05, tx = s * (1.05 + 1.1);
    q([bx, 0.5, 2.6], [bx, 0.5, 5.7], [tx, 3.6, 6.1], [tx, 3.6, 4.7], BLUE);
    gb.box(0.07, 0.25, 1.3, GOLD, tx, 3.5, 5.4);
    gb.cyl(0.46, 1.1, DARKG, s * 0.55, 0, 6.6, 10, Math.PI / 2);              // nozzles
  }
  const m = new THREE.Mesh(gb.build(), MAT.vcDouble);
  hazeify(m.material);
  return m;
}
function buildFatAlbert() {
  const gb = new GB(), q = (a, b, c, d, col) => gb.quad(a, b, c, d, col);
  gb.cyl(2.1, 24, BLUE, 0, 0, 1, 14, Math.PI / 2);
  gb.cyl(2.1, 3.4, BLUE, 0, -0.1, -12.7, 14, -Math.PI / 2, 0, 0, 0.9);       // nose
  gb.cyl(2.1, 6, BLUE, 0, 0.9, 16, 14, Math.PI / 2, 0, 0, 0.55);             // upswept tail cone
  gb.box(2.4, 0.5, 1.4, '#20272e', 0, 1.0, -11.4);                            // cockpit glazing
  gb.box(0.1, 0.5, 26, GOLD, 2.08, 0.3, 1); gb.box(0.1, 0.5, 26, GOLD, -2.08, 0.3, 1);
  for (const s of [-1, 1]) {
    q([s * 1.5, 2.15, -2.4], [s * 1.5, 2.15, 2.0], [s * 20.2, 2.0, 0.9], [s * 20.2, 2.0, -1.1], BLUE);
    q([s * 1.5, 2.05, -2.4], [s * 20.2, 1.9, -1.1], [s * 20.2, 1.9, 0.9], [s * 1.5, 2.05, 2.0], '#e8e8e8');
    for (const ex of [5.3, 10.2]) {
      gb.cyl(0.75, 5.0, BLUE, s * ex, 1.4, -1.4, 10, Math.PI / 2);
      gb.box(4.0, 0.25, 0.08, '#151515', s * ex, 1.4, -4.1);                   // blurred prop
      gb.box(0.25, 4.0, 0.08, '#151515', s * ex, 1.4, -4.1);
    }
    q([s * 0.8, 2.6, 15.0], [s * 0.8, 2.6, 18.5], [s * 8.0, 2.8, 18.4], [s * 8.0, 2.8, 16.6], BLUE);
  }
  q([0, 2.4, 12.5], [0, 2.4, 18.6], [0, 11.5, 19.6], [0, 11.5, 16.3], BLUE);
  gb.box(0.12, 1.0, 3.4, GOLD, 0, 10.5, 18.0);
  const m = new THREE.Mesh(gb.build(), MAT.vcDouble);
  hazeify(m.material);
  return m;
}

// ---------------------------------------------------------------- paths
// A path is a start (position + direction, local frame) and segments at constant speed:
//   ['s', len]            straight
//   ['t', R, deg, dir]    level turn (dir +1 = left / CCW from above, −1 = right)
//   ['l', R, deg]         vertical pull (loop) in the plane of motion
const UP = new THREE.Vector3(0, 1, 0);
function makePath(p0, f0, segs) {
  const out = []; let p = p0.clone(), f = f0.clone().normalize(), s0 = 0;
  for (const sg of segs) {
    if (sg[0] === 's') { out.push({ type: 's', s0, len: sg[1], p: p.clone(), f: f.clone() }); p.addScaledVector(f, sg[1]); s0 += sg[1]; continue; }
    const R = sg[1], ang = sg[2] * D2R;
    const k = sg[0] === 't' ? UP.clone().multiplyScalar(sg[3] || 1) : new THREE.Vector3().crossVectors(f, UP).normalize();
    const r0 = new THREE.Vector3().crossVectors(f, k).multiplyScalar(R), c = p.clone().sub(r0);
    const seg = { type: 'a', s0, len: R * ang, R, c, r0, k, f: f.clone() };
    out.push(seg);
    p = c.clone().add(r0.clone().applyAxisAngle(k, ang)); f = f.clone().applyAxisAngle(k, ang);
    s0 += R * ang;
  }
  out.total = s0;
  return out;
}
const _t = new THREE.Vector3();
function pathPos(path, s, out) {
  s = Math.max(0, Math.min(path.total, s));
  let sg = path[path.length - 1];
  for (const x of path) if (s <= x.s0 + x.len) { sg = x; break; }
  const d = s - sg.s0;
  if (sg.type === 's') return out.copy(sg.p).addScaledVector(sg.f, d);
  return out.copy(sg.c).add(_t.copy(sg.r0).applyAxisAngle(sg.k, d / sg.R));
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const E = V(1, 0, 0), Wst = V(-1, 0, 0);
const DELTA = [[0, 0, 0], [9, -1, 9], [-9, -1, 9], [0, -2, 18], [18, -2, 18], [-18, -2, 18]];
const DIAMOND = [[0, 0, 0], [8, -1, 8], [-8, -1, 8], [0, -2, 16]];
const LINE4 = [[-24, 0, 0], [-8, 0, 0], [8, 0, 0], [24, 0, 0]];
const ECHELON = [0, 1, 2, 3, 4, 5].map(i => [i * 9, -i * 0.9, i * 9]);
const IN = 3000;                                   // approach/exit leg length (m)
const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
const sm = (t) => t * t * (3 - 2 * t);
// Jet assignment like the real team: #1–#4 the Diamond, #5/#6 the Solos, all six for Delta.
const JD = [0, 1, 2, 3], J5 = [4], J6 = [5], J56 = [4, 5], JA = [0, 1, 2, 3, 4, 5];
// Maneuvers (local frame: x along the show line → east, y up, z away from the crowd). Eastbound turns
// away from the crowd are dir −1, westbound +1. form rows: [right, up, back, own roll].
function maneuvers() {
  return [
    { name: 'Delta pass', call: 'Blue Angels Delta, six-ship, in from the east along the show line. Smoke on!',
      groups: [{ jets: JA, form: DELTA, v: 165, path: makePath(V(IN, 140, 160), Wst, [['s', 2 * IN]]) }],
      smoke: (p) => Math.abs(p.x) < 2600 },
    { name: 'Sneak pass', call: 'Number Five — sneak pass, from behind the crowd, just under the speed of sound.',
      groups: [{ jets: J5, form: [[0, 0, 0]], v: 290, path: makePath(V(-IN - 2500, 28, 220), E, [['s', 2 * IN + 5000]]), vapor: (p) => Math.abs(p.x) < 900 }],
      smoke: () => false },
    { name: 'Diamond roll', call: 'Diamond, four-ship — Diamond Roll at show center.',
      groups: [{ jets: JD, form: DIAMOND, v: 160, path: makePath(V(-IN, 170, 320), E, [['s', 2 * IN]]), roll: (p) => Math.PI * 2 * sm(ramp(p.x, -450, 450)) }],
      smoke: (p) => Math.abs(p.x) < 2400 },
    { name: 'Opposing knife-edge', call: 'Solos — opposing knife-edge pass. They close at over a thousand miles an hour.',
      groups: [
        { jets: J5, form: [[0, 0, 0]], v: 200, path: makePath(V(-IN, 60, 230), E, [['s', 2 * IN]]), roll: (p) => -Math.PI / 2 * sm(ramp(700 - Math.abs(p.x), 0, 500)) },
        { jets: J6, form: [[0, 0, 0]], v: 200, path: makePath(V(IN, 60, 190), Wst, [['s', 2 * IN]]), roll: (p) => Math.PI / 2 * sm(ramp(700 - Math.abs(p.x), 0, 500)) },
      ], smoke: (p) => Math.abs(p.x) < 2600 },
    { name: 'Double Farvel', call: 'Diamond — Double Farvel: the Boss and the slot are flying upside down.',
      groups: [{ jets: JD, form: [[0, 0, 0, Math.PI], [8, -1, 8], [-8, -1, 8], [0, -2, 16, Math.PI]], v: 150, path: makePath(V(IN, 150, 300), Wst, [['s', 2 * IN]]) }],
      smoke: (p) => Math.abs(p.x) < 2400 },
    { name: 'Minimum radius turn', call: 'Number Six — minimum-radius turn, seven G, right in front of you.',
      groups: [{ jets: J6, form: [[0, 0, 0]], v: 150, path: makePath(V(-IN, 110, 240), E, [['s', IN], ['t', 330, 360, -1], ['s', IN]]) }],
      smoke: (p) => p.x > -300 && p.x < 300 },
    { name: 'Diamond loop', call: 'Diamond — four-ship loop. Smoke on.',
      groups: [{ jets: JD, form: DIAMOND, v: 150, path: makePath(V(-IN, 160, 320), E, [['s', IN], ['l', 720, 360], ['s', IN]]) }],
      smoke: (p) => Math.abs(p.x) < 2000 || p.y > 200 },
    { name: 'Calypso pass', call: 'Solos — Calypso Pass: Five inverted, canopy to canopy above Six.',
      groups: [{ jets: J56, form: [[0, 0, 0], [0, 7.5, 0, Math.PI]], v: 150, path: makePath(V(IN, 80, 230), Wst, [['s', 2 * IN]]) }],
      smoke: (p) => Math.abs(p.x) < 2200 },
    { name: 'Line-abreast loop', call: 'Diamond — line-abreast loop, wingtip to wingtip.',
      groups: [{ jets: JD, form: LINE4, v: 150, path: makePath(V(IN, 160, 340), Wst, [['s', IN], ['l', 700, 360], ['s', IN]]) }],
      smoke: (p) => Math.abs(p.x) < 2000 || p.y > 200 },
    { name: 'Fortus', call: 'Number Six — the Fortus: low and slow, nose high, about one-two-five knots.',
      groups: [{ jets: J6, form: [[0, 0, 0]], v: 68, path: makePath(V(-1700, 70, 230), E, [['s', 3400]]), pitch: () => 24 * D2R }],
      smoke: () => false },
    { name: 'Echelon parade', call: 'Delta, echelon parade — all six on the right wing, showing you their topsides.',
      groups: [{ jets: JA, form: ECHELON, v: 135, path: makePath(V(IN, 130, 260), Wst, [['s', IN], ['t', 900, 120, 1], ['s', IN]]) }],
      smoke: (p) => Math.abs(p.x) < 2200 },
    { name: 'Opposing aileron rolls', call: 'Solos — opposing aileron rolls through show center.',
      groups: [
        { jets: J5, form: [[0, 0, 0]], v: 190, path: makePath(V(-IN, 75, 240), E, [['s', 2 * IN]]), roll: (p) => Math.PI * 4 * sm(ramp(p.x, -800, 800)) },
        { jets: J6, form: [[0, 0, 0]], v: 190, path: makePath(V(IN, 75, 200), Wst, [['s', 2 * IN]]), roll: (p) => -Math.PI * 4 * sm(ramp(-p.x, -800, 800)) },
      ], smoke: (p) => Math.abs(p.x) < 2400 },
    { name: 'Diamond 360', call: 'Diamond — Diamond 360, a tight level turn over the box.',
      groups: [{ jets: JD, form: DIAMOND, v: 160, path: makePath(V(-IN, 150, 120), E, [['s', IN], ['t', 520, 360, -1], ['s', IN]]) }],
      smoke: (p) => Math.abs(p.x) < 1800 || p.z > 200 },
    { name: 'Fat Albert', call: 'And here is Fat Albert, the team\'s C-130J — low pass from the west.',
      groups: [{ craft: 'c130', form: [[0, 0, 0]], v: 105, path: makePath(V(-IN - 500, 90, 320), E, [['s', IN + 500], ['t', 900, 30, -1], ['t', 900, 30, 1], ['s', IN]]) }],
      smoke: () => false },
    { name: 'Delta loop', call: 'Delta — six-ship loop. Smoke on!',
      groups: [{ jets: JA, form: DELTA, v: 150, path: makePath(V(-IN, 160, 340), E, [['s', IN], ['l', 760, 360], ['s', IN]]) }],
      smoke: (p) => Math.abs(p.x) < 2000 || p.y > 200 },
    { name: 'Delta breakout', call: 'Delta — the Delta Breakout! Six jets, six directions.',
      groups: DELTA.map((o, i) => ({ jets: [i], form: [[0, 0, 0]], v: 170, path: makePath(V(IN + o[2], 150 + o[1], 300 + o[0] * 1.2), Wst, [['s', IN + o[2]], ['l', 700, 35 + i * 6], ['t', 1100, 25 + (i - 2.5) * 22, i % 2 ? 1 : -1], ['s', 4000]]) })),
      smoke: (p) => Math.abs(p.x) < 3000 || p.y > 250 },
  ];
}

// ---------------------------------------------------------------- smoke (GPU points, ring buffer)
const SMAX = 16000;
let smoke = null, sHead = 0;
function initSmoke() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMAX * 3), 3));
  g.setAttribute('birth', new THREE.BufferAttribute(new Float32Array(SMAX).fill(-1e9), 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uScale: { value: 600 }, uCol: { value: new THREE.Color(1, 1, 1) }, uShade: { value: new THREE.Color(0.6, 0.65, 0.72) }, uSun: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: `attribute float birth; uniform float uTime; uniform vec2 uWind; uniform float uScale; varying float vA; varying float vAge;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){
        float age = uTime - birth; vAge = age;
        vec3 p = position + vec3(uWind.x, 0.12, uWind.y) * age;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float size = min(6.0 + age * 2.4, 46.0);
        gl_PointSize = clamp(size * uScale / -mv.z, 0.0, 300.0);
        vA = age < 0.0 || age > 32.0 ? 0.0 : pow(1.0 - age / 32.0, 1.6) * smoothstep(0.0, 0.3, age);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform vec3 uCol; uniform vec3 uShade; varying float vA; varying float vAge;
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5 || vA <= 0.0) discard;
        float a = smoothstep(0.5, 0.05, r) * vA * 0.7;
        vec3 c = mix(uShade, uCol, clamp(0.65 - d.y * 1.2, 0.0, 1.0));   // lit from above, shaded underneath
        gl_FragColor = vec4(c, a);
      }`,
  });
  smoke = new THREE.Points(g, mat); smoke.frustumCulled = false; smoke.renderOrder = 5;
  W.scene.add(smoke);
}
function emitSmoke(p) {
  const pos = smoke.geometry.attributes.position, b = smoke.geometry.attributes.birth;
  pos.array[sHead * 3] = p.x; pos.array[sHead * 3 + 1] = p.y; pos.array[sHead * 3 + 2] = p.z;
  b.array[sHead] = env.time;
  sHead = (sHead + 1) % SMAX;
  pos.needsUpdate = true; b.needsUpdate = true;
}

// ---------------------------------------------------------------- show state & scheduler
// Like the real demo, two things can be on stage at once: the Solos perform while the Diamond
// repositions out of sight, so there's always something to watch. Each maneuver claims its jets.
export const fw = { active: false, t: 0, next: 0, sinceStart: 99, list: null, running: [], jets: [], vapor: [], c130: null };
function pool() {
  if (fw.jets.length) return;
  const base = buildHornet();
  const vg = new THREE.ConeGeometry(2.6, 7, 16, 1, true); vg.rotateX(-Math.PI / 2);          // transonic vapor cone
  const vm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i++) {
    const m = i ? base.clone() : base; m.visible = false; W.scene.add(m); fw.jets.push(m);
    const v = new THREE.Mesh(vg, vm); v.position.z = 1.5; v.visible = false; m.add(v); fw.vapor.push(v);
  }
  fw.c130 = buildFatAlbert(); fw.c130.visible = false; W.scene.add(fw.c130);
  initSmoke();
}
const usesOf = (m) => m.groups.flatMap(g => g.craft === 'c130' ? ['c130'] : g.jets);
function startManeuver(m, t0 = 0) {
  m.dur = Math.max(...m.groups.map(g => g.path.total / g.v)) + 1;
  fw.running.push({ m, t: t0, uses: usesOf(m) });
  fw.sinceStart = 0;
  say('AIR', 'Air Boss', m.call);
}
export function startFleetWeek() {
  frame(); pool();
  fw.active = true; fw.list = maneuvers(); fw.running = []; fw.next = 1; fw.sinceStart = 0;
  spawnFleet();
  say('AIR', 'Air Boss', 'All stations, San Francisco Fleet Week. The aerobatic box off the Marina Green is HOT. Spectator vessels remain outside the yellow buoys.');
  // open the show right away: the Delta is already inbound and reaches show center in ~6 s
  startManeuver(fw.list[0], (IN - 1000) / 165);
}
export function stopFleetWeek() {
  fw.active = false; fw.running = [];
  for (const j of fw.jets) j.visible = false;
  if (fw.c130) fw.c130.visible = false;
  jetAudio(0, 500, 0);
}

// ---------------------------------------------------------------- spectators, Navy ships, safety zone
function vessel(o) { const v = new Vessel(o); traffic.vessels.push(v); return v; }
function buildWarship(kind) {
  const gb = new GB(), G = '#7c848d', DK = '#59616a';
  if (kind === 'lha') {           // amphibious assault ship: long flat deck, island to starboard
    const L = 257, B = 32;
    gb.box(B * 0.92, 18, L * 0.86, G, 0, 7, 0);
    gb.box(B * 0.6, 14, L * 0.12, G, 0, 5, -L * 0.47);                 // bow
    gb.box(B * 1.1, 1.2, L * 0.95, '#4b5157', 0, 16.6, -L * 0.02);       // flight deck
    gb.box(0.4, 0.05, L * 0.9, '#d9d9d9', 0, 17.25, 0);                  // centerline
    gb.box(7, 14, 40, G, B * 0.42, 24, 15); gb.box(4, 10, 14, DK, B * 0.42, 34, 10);   // island
    gb.box(0.6, 12, 0.6, DK, B * 0.42, 44, 10);
    for (const z of [-80, -30, 40, 90]) gb.box(12, 3, 16, '#3c4248', -6, 18.2, z);   // aircraft on deck
    gb.box(B, 3, L * 0.9, '#2e3338', 0, -1, 0);
    return { mesh: gb.mesh(), len: L, beam: B };
  }
  if (kind === 'ddg') {           // Arleigh Burke destroyer
    const L = 155, B = 20;
    gb.box(B * 0.95, 9, L * 0.8, G, 0, 2.5, 6);
    gb.box(B * 0.55, 8, L * 0.2, G, 0, 2.5, -L * 0.42);
    gb.box(B * 0.25, 5, 12, G, 0, 4, -L * 0.5);
    gb.box(13, 9, 30, G, 0, 11, -12); gb.box(9, 7, 10, DK, 0, 19, -14);
    gb.box(2, 14, 2, DK, 0, 28, -10); gb.box(6, 0.6, 0.6, DK, 0, 31, -10);
    gb.box(8, 8, 9, G, 0, 10.5, 22); gb.box(5, 4, 5, DK, 0, 16.5, 22);    // stacks
    gb.box(4, 2.5, 6, DK, 0, 8.5, -48); gb.cyl(0.3, 7, DK, 0, 9, -54, 6, -Math.PI / 2);   // 5" gun
    gb.box(1.6, 1.2, 6, '#ffffff', B * 0.48, 4.5, -60);                 // hull number panel
    gb.box(B, 3, L * 0.85, '#2e3338', 0, -1.5, 0);
    return { mesh: gb.mesh(), len: L, beam: B };
  }
  // USCG national security cutter: white with the orange racing stripe
  const L = 127, B = 16;
  gb.box(B * 0.95, 8, L * 0.8, '#f2f2f0', 0, 2.5, 6);
  gb.box(B * 0.55, 7, L * 0.2, '#f2f2f0', 0, 2.5, -L * 0.42);
  gb.box(0.1, 6, 3, '#e8571e', B * 0.48, 3.5, -38); gb.box(0.1, 6, 1.2, '#1f3c88', B * 0.48, 3.5, -35.6);
  gb.box(-0.1, 6, 3, '#e8571e', -B * 0.48, 3.5, -38);
  gb.box(11, 8, 26, '#f2f2f0', 0, 10, -8); gb.box(2, 12, 2, '#f2f2f0', 0, 20, -8);
  gb.box(6, 6, 8, '#f2f2f0', 0, 9, 16); gb.box(B, 3, L * 0.85, '#2e3338', 0, -1.5, 0);
  return { mesh: gb.mesh(), len: L, beam: B };
}
const still = (v) => { v.targetSpeed = 0; v.speed = 0; v.desH = v.h; };
function spawnFleet() {
  // Navy & Coast Guard ships anchored off the city front, east of the box
  for (const [kind, lat, lon, hdg, name] of [
    ['lha', 37.8135, -122.3935, 300, 'USS TRIPOLI (LHA-7)'],
    ['ddg', 37.8195, -122.4040, 275, 'USS SPRUANCE (DDG-111)'],
    ['nsc', 37.8215, -122.4155, 280, 'USCGC MUNRO (WMSL-755)'],
  ]) {
    const p = ll(lat, lon); const s = buildWarship(kind);
    vessel({ type: 'ship', mesh: s.mesh, len: s.len, beam: s.beam, cat: 'ship', ram: true, anchored: true, scripted: true, script: still, x: p.x, z: p.z, h: hdg * D2R, name, maxSpeed: 0, bob: 0.1, special: true });
  }
  // safety-zone buoys along the north and side edges of the box
  for (let a = SHOW.aMin; a <= SHOW.aMax; a += 625) placeBuoy(a, SHOW.nMax);
  for (let n = 300; n < SHOW.nMax; n += 450) { placeBuoy(SHOW.aMin, n); placeBuoy(SHOW.aMax, n); }
  // Coast Guard / police RIBs patrolling the box edge
  const edge = [[SHOW.aMin, SHOW.nMax + 60], [0, SHOW.nMax + 80], [SHOW.aMax, SHOW.nMax + 60]].map(([a, n]) => { const w = toWorld(V(a, 0, n)); return { x: w.x, z: w.z }; });
  for (let i = 0; i < 3; i++) {
    const p = edge[i];
    const v = vessel({ type: 'law', mesh: buildRIB(i ? 11 : 14, i === 2 ? 'police' : 'uscg'), len: 12, beam: 4, cat: 'power', x: p.x, z: p.z, h: 0, maxSpeed: 9 * 0.5144, turnRate: 0.4, accel: 1, name: i === 2 ? 'SFPD MARINE 3' : `COAST GUARD 29${i}1${i}`, bob: 1 });
    v.patrol = edge; v.setPath([edge[(i + 1) % 3]]); v.onEnd = 'patrol'; v.state = 'go';
  }
  // spectator fleet: anchored/drifting just outside the box, thickest north of show center
  const taken = [];
  const free = (x, z, r) => taken.every(t => (t.x - x) ** 2 + (t.z - z) ** 2 > (r + t.r) ** 2);
  let placed = 0, tries = 0;
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  while (placed < 240 && tries < 6000) {
    tries++;
    // packed toward show center and the front row along the buoy line, thinning out behind
    const a = gauss() * 2600, n = SHOW.nMax + 70 + Math.pow(Math.random(), 2.2) * 1000;
    const wpos = toWorld(V(a, 0, n));
    const len = Math.random() < 0.25 ? rnd(9, 14) : rnd(6.5, 13);
    if (sdfAt(wpos.x, wpos.z) > -25 || !free(wpos.x, wpos.z, len * 0.9)) continue;
    taken.push({ x: wpos.x, z: wpos.z, r: len * 0.9 });
    const sail = Math.random() < 0.3;
    const mesh = sail ? buildSailboat(len).group : buildPowerboat(len, pick(['cruiser', 'cc', 'cc', 'sport', 'trawler', 'cruiser']));
    const v = vessel({ type: 'fishing', mesh, len, beam: len * 0.34, cat: 'power', x: wpos.x, z: wpos.z, h: rnd(0, 6.28), maxSpeed: 4 * 0.5144, turnRate: 0.25, accel: 0.3, bob: 1, anchored: Math.random() < 0.6, name: 'Spectator' });
    v.spot = { x: wpos.x, z: wpos.z }; v.state = 'drift'; v.timer = rnd(60, 400); v.fishing = false;
    placed++;
  }
}
function placeBuoy(a, n) {
  const p = toWorld(V(a, 0, n));
  if (sdfAt(p.x, p.z) > -15) return;
  const mesh = buildBuoy('yellow'); mesh.position.set(p.x, 0, p.z); W.scene.add(mesh);
  traffic.marks.push({ mesh, x: p.x, z: p.z });
}

// ---------------------------------------------------------------- per-frame update
const _p = new THREE.Vector3(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _v = new THREE.Vector3(), _a = new THREE.Vector3();
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Matrix4(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
const _lw = new THREE.Vector3(), _cr = new THREE.Vector3();
let smokeT = 0;
// local-frame position of formation member k at time τ, plus its world matrix
function memberState(g, k, tau, outPos, outMat) {
  const s = tau * g.v, h = 0.06 * g.v;
  pathPos(g.path, s, _p); pathPos(g.path, s - h, _pa); pathPos(g.path, s + h, _pb);
  _v.subVectors(_pb, _pa).divideScalar(0.12);                          // m/s (local)
  _a.copy(_pb).add(_pa).addScaledVector(_p, -2).divideScalar(0.06 * 0.06);
  _f.copy(_v).normalize();
  // lift vector = centripetal accel + gravity reaction → "up" of the aircraft (bank & pitch follow the path)
  _u.copy(_a).addScaledVector(_f, -_a.dot(_f)); _u.y += 9.81; _u.normalize();
  _r.crossVectors(_f, _u).normalize(); _u.crossVectors(_r, _f).normalize();
  if (g.roll) { const rr = g.roll(_p); _q.setFromAxisAngle(_f, rr); _r.applyQuaternion(_q); _u.applyQuaternion(_q); }
  const o = g.form[k];
  _w.copy(_p).addScaledVector(_r, o[0]).addScaledVector(_u, o[1]).addScaledVector(_f, -o[2]);
  toWorld(_w, outPos);
  const fw_ = dirToWorld(_f, new THREE.Vector3());
  if (outMat) {
    // the member's own attitude: formation roll + its own roll (inverted wingmen) + nose-high pitch
    const f2 = _f.clone(), u2 = _u.clone(), r2 = _r.clone();
    if (o[3]) { _q.setFromAxisAngle(f2, o[3]); u2.applyQuaternion(_q); r2.applyQuaternion(_q); }
    if (g.pitch) { _q.setFromAxisAngle(r2, g.pitch(_p)); f2.applyQuaternion(_q); u2.applyQuaternion(_q); }
    const fwv = dirToWorld(f2, new THREE.Vector3()), uw = dirToWorld(u2, new THREE.Vector3()), rw = dirToWorld(r2, new THREE.Vector3());
    outMat.makeBasis(rw, uw, fwv.negate()); outMat.setPosition(outPos);
  }
  return { fwd: fw_, vel: fw_.clone().multiplyScalar(g.v), local: _w.clone() };
}

export function updateFleetWeek(dt, listener, camRight) {
  if (!fw.active) return;
  fw.sinceStart += dt;
  // schedule: start the next maneuver once its jets are free and the last one has had the stage a bit
  const busy = new Set(fw.running.flatMap(r => r.uses));
  const nm = fw.list[fw.next];
  if (fw.sinceStart > 9 && usesOf(nm).every(j => !busy.has(j))) { startManeuver(nm); fw.next = (fw.next + 1) % fw.list.length; }
  for (const j of fw.jets) j.visible = false; fw.c130.visible = false;
  for (const v of fw.vapor) v.visible = false;
  let I = 0, best = null, bestI = 0;
  smokeT -= dt; const puff = smokeT <= 0; if (puff) smokeT = 0.014;
  for (const run of fw.running) {
    run.t += dt;
    const man = run.m;
    for (const g of man.groups) {
      for (let k = 0; k < g.form.length; k++) {
        const ji = g.craft === 'c130' ? -1 : g.jets[k];
        const mesh = ji < 0 ? fw.c130 : fw.jets[ji];
        const st = memberState(g, k, run.t, mesh.position, _m);
        mesh.quaternion.setFromRotationMatrix(_m); mesh.visible = true;
        if (ji >= 0 && g.vapor && g.vapor(st.local)) fw.vapor[ji].visible = true;
        if (puff && man.smoke(st.local)) emitSmoke(mesh.position.clone().addScaledVector(st.fwd, -9));
        // sound: evaluate at the retarded time (the sound you hear left the jet d/c seconds ago)
        let d = mesh.position.distanceTo(listener), tr = run.t - d / 343;
        const pr = new THREE.Vector3(), sr = memberState(g, k, Math.max(0, tr), pr, null);
        tr = run.t - pr.distanceTo(listener) / 343;
        d = Math.max(25, pr.distanceTo(listener));
        _cr.subVectors(listener, pr).normalize();
        const rear = Math.max(0, -_cr.dot(sr.fwd));                        // exhaust side is loudest
        const w = (ji < 0 ? 0.25 : 1) * (1 + 1.6 * rear) * (tr < 0 ? 0 : 1);
        const ii = w * (200 / d) ** 2;
        I += ii;
        if (ii > bestI) { bestI = ii; best = { d, pr: pr.clone(), vrad: sr.vel.dot(_cr), c130: ji < 0 }; }
      }
    }
  }
  fw.running = fw.running.filter(r => r.t < r.m.dur);
  if (best) {
    // amplitude ∝ 1/distance: a Hornet at ~200 m is the loudest thing in the bay (~120 dB)
    const level = Math.sqrt(I);
    const dop = Math.max(0.5, Math.min(2.5, 343 / Math.max(80, 343 - best.vrad)));
    const cutoff = (250 + 11000 * Math.exp(-best.d / 1100)) * dop * (best.c130 ? 0.35 : 1);
    const pan = camRight ? _cr.subVectors(best.pr, listener).normalize().dot(camRight) : 0;
    jetAudio(level, cutoff, pan, best.c130 ? 1.4 : 0.8);
  } else jetAudio(0, 400, 0);
  smokeUniforms(dt);
}
function smokeUniforms() {
  if (!smoke) return;
  const u = smoke.material.uniforms;
  u.uTime.value = env.time;
  const w = windAt(C.x, C.z); u.uWind.value.set(w.x, w.z);
  u.uScale.value = 600 * (W.dpr || 1) * (window.innerHeight / 900);
  const day = Math.max(0.15, Math.min(1, W.sun.intensity / 3.4));
  u.uCol.value.copy(W.sun.color).multiplyScalar(0.35 + 0.65 * day).addScalar(0.08 * day);
  u.uShade.value.copy(W.horizon).multiplyScalar(0.75);
}
