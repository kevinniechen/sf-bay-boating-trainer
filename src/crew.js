// Crew & passengers: little people who live on the deck. Nothing here scripts a specific moment
// ("vomit when X", "fall when Y"); instead every person has
//   · a BODY that feels the boat: inertial forces in the deck frame (surge, cornering, roll/pitch
//     gravity, vertical heave/slams) against a grip that depends on posture and personality,
//   · DRIVES that integrate what the body feels and what they see: fear, nausea, thrill, boredom,
//     fatigue — plus emotional contagion from the people around them,
//   · PERCEPTION of points of interest with salience (jets, tall buildings, bridges, boats, the sun,
//     each other) filtered by novelty memory and by what neighbours are pointing at,
//   · UTILITY action selection over a small vocabulary (wander, look, point, chat, sit, hold on, go to
//     the rail and be sick, cheer, brace) with hysteresis.
// The interesting behaviour comes from the overlaps: a hard turn makes the timid one grab a seat,
// her fear spreads, the queasy one's nausea builds in the chop until he heads for the rail, a jet pass
// sends the curious one pointing, the others turn to look — and a slam while someone is leaning over
// the side can put them in the water.
import * as THREE from 'three';
import { ll, terrainAt } from './geo.js';
import { env, sunPosition, KN } from './env.js';
import { W } from './world.js';
import { traffic, makeScripted } from './traffic.js';
import { fw } from './fleetweek.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const G = 9.81;

// ---------------------------------------------------------------- deck layout (Protector 33, deck coords:
// x → starboard, z → aft, y up from the cockpit sole). Rails/gunwales are low: momentum can carry you over.
const DECK = { x0: -1.0, x1: 1.0, z0: -0.95, z1: 4.0, cabinZ: 1.25, floorY: 0.41 };
const OBST = [[-0.45, 0.45, 0.32], [0.45, 0.45, 0.32], [-0.95, 2.6, 0.26], [0.95, 2.6, 0.26]];
const SEATS = [
  { x: -0.45, z: 0.45, yaw: 0 }, { x: -0.95, z: 2.6, yaw: -Math.PI / 2 }, { x: 0.95, z: 2.6, yaw: Math.PI / 2 },
  { x: -0.7, z: 3.95, yaw: 0 }, { x: 0, z: 3.95, yaw: 0 }, { x: 0.7, z: 3.95, yaw: 0 },
];
const RAILS = [];
for (const z of [1.6, 2.1, 3.1, 3.6]) for (const s of [-1, 1]) RAILS.push({ x: s * 0.9, z, yaw: s * Math.PI / 2, side: s });
const HELM = { x: 0.45, z: 0.2 };

// ---------------------------------------------------------------- landmarks people know by name
const LANDMARKS = [
  ['the Golden Gate Bridge', 37.8199, -122.4783, 227, 3.0], ['the Bay Bridge', 37.7983, -122.3778, 160, 1.8],
  ['Salesforce Tower', 37.7897, -122.3972, 326, 2.2], ['the Transamerica Pyramid', 37.7952, -122.4028, 260, 2.0],
  ['Coit Tower', 37.8024, -122.4058, 64, 1.6], ['the Ferry Building', 37.7955, -122.3937, 75, 1.4],
  ['Alcatraz', 37.8267, -122.4230, 45, 2.2], ['Angel Island', 37.8613, -122.4335, 60, 1.0],
  ['the Palace of Fine Arts', 37.8029, -122.4484, 40, 1.0], ['the sea lions at Pier 39', 37.8087, -122.4098, 2, 1.5],
  ['Fort Point', 37.8105, -122.4770, 20, 0.8], ['Sausalito', 37.8565, -122.4800, 40, 1.0],
];
let LM = null;

const NAMES = ['Maya', 'Leo', 'Priya', 'Sam', 'Jules', 'Ava', 'Ken', 'Noor', 'Diego', 'Hana', 'Theo', 'Rosa', 'Ike', 'Lena'];
const SHIRTS = ['#e4572e', '#29335c', '#f3a712', '#669bbc', '#a8c686', '#f2f2f2', '#c1121f', '#6a4c93', '#2a9d8f', '#ffb4a2'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d29f78'];
const HAIR = ['#2b1d14', '#5a3825', '#a67b5b', '#e6c27a', '#111111', '#7a4b2a'];

export const crew = { people: [], root: null, hooks: {}, pois: [], enabled: true, bubbles: null, dialogue: false };

// ---------------------------------------------------------------- the little person mesh
function box(w, h, d, color, y = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.y = y; m.castShadow = true; return m;
}
function buildPerson(p) {
  const root = new THREE.Group();
  const s = p.scale;
  const hips = new THREE.Group(); hips.position.y = 0.86 * s; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  const chest = box(0.36 * s, 0.5 * s, 0.22 * s, p.shirt, 0.26 * s); torso.add(chest);
  if (p.vest) torso.add(box(0.38 * s, 0.36 * s, 0.25 * s, '#ff6f00', 0.3 * s));   // life jacket
  const neck = new THREE.Group(); neck.position.y = 0.53 * s; torso.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14 * s, 12, 9), new THREE.MeshStandardMaterial({ color: p.skin, roughness: 0.7 }));
  head.position.y = 0.13 * s; head.castShadow = true; neck.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.147 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: p.hair, roughness: 0.9 }));
  hair.position.y = 0.14 * s; hair.rotation.x = -0.25; neck.add(hair);
  if (p.cap) { const c = box(0.3 * s, 0.07 * s, 0.32 * s, p.cap, 0.25 * s); c.position.z = -0.04; neck.add(c); }
  const eyes = box(0.16 * s, 0.03 * s, 0.02, '#1a1a1a', 0.15 * s); eyes.position.z = -0.135 * s; neck.add(eyes);   // they visibly look at things
  const arm = (side) => {
    const g = new THREE.Group(); g.position.set(side * 0.22 * s, 0.47 * s, 0); torso.add(g);
    const a = box(0.1 * s, 0.56 * s, 0.1 * s, p.shirt, -0.26 * s); g.add(a);
    const hand = box(0.09 * s, 0.09 * s, 0.09 * s, p.skin, -0.58 * s); g.add(hand);
    return g;
  };
  const leg = (side) => {
    const g = new THREE.Group(); g.position.set(side * 0.1 * s, 0, 0); hips.add(g);
    g.add(box(0.14 * s, 0.82 * s, 0.15 * s, p.pants, -0.41 * s));
    const shoe = box(0.15 * s, 0.07 * s, 0.24 * s, '#222', -0.83 * s); shoe.position.z = -0.04; g.add(shoe);
    return g;
  };
  const parts = { root, hips, torso, neck, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1) };
  return parts;
}

// ---------------------------------------------------------------- person
class Person {
  constructor(i, captain = false) {
    this.name = captain ? 'Captain' : NAMES[(i * 5 + Math.floor(Math.random() * NAMES.length)) % NAMES.length];
    this.captain = captain;
    // personality: the same rules, different people
    this.tr = captain ? { brave: 0.9, queasy: 0.05, curious: 0.4, social: 0.5, clumsy: 0.1 }
      : { brave: rnd(0.1, 0.95), queasy: rnd(0.05, 1), curious: rnd(0.2, 1), social: rnd(0.1, 1), clumsy: rnd(0, 0.8) };
    this.scale = rnd(0.9, 1.06);
    this.look = { shirt: captain ? '#f4f4f4' : pick(SHIRTS), pants: pick(['#2f3e46', '#3a3a3a', '#6b5b4b', '#1d3557', '#c9b79c']), skin: pick(SKINS), hair: pick(HAIR),
      cap: captain ? '#1b2550' : (Math.random() < 0.35 ? pick(['#1b2550', '#c1121f', '#f2f2f2', '#2a9d8f']) : null), vest: !captain && Math.random() < 0.3 };
    Object.assign(this, { shirt: this.look.shirt, pants: this.look.pants, skin: this.look.skin, hair: this.look.hair, cap: this.look.cap, vest: this.look.vest });
    this.m = buildPerson(this);
    this.x = 0; this.z = 2; this.vx = 0; this.vz = 0; this.yaw = 0; this.y = 0; this.vy = 0;
    this.d = { fear: 0.05, nausea: 0, thrill: 0, boredom: rnd(0, 0.5), fatigue: rnd(0, 0.3) };
    this.balance = 1; this.posture = 'stand'; this.fallT = 0;
    this.act = { type: 'idle', t: 0 }; this.thinkT = rnd(0, 1);
    this.seat = null; this.rail = null; this.att = null; this.attT = 0;
    this.mem = new Map(); this.boost = new Map();
    this.pose = { walk: 0, phase: rnd(0, 6), sit: 0, lean: 0, tx: 0, tz: 0, cheer: 0, point: 0, hold: 0, vomit: 0, fallen: 0, hy: 0, hp: 0 };
    this.barkT = 0; this.overboard = null; this.prevDeckY = null; this.prevDeckV = 0;
  }
  // ---- perception & interest
  interest(p, t) {
    if (p.who === this) return 0;
    const last = this.mem.get(p.id);
    const novelty = last == null ? 1 : 1 - Math.exp(-(t - last) / 45);
    return p.sal * (0.5 + this.tr.curious) * (0.35 + 0.65 * novelty) + (this.boost.get(p.id) || 0);
  }
  bestPOI(t) {
    let best = null, bs = 0;
    for (const p of crew.pois) { const s = this.interest(p, t) * rnd(0.8, 1.2); if (s > bs) { bs = s; best = p; } }
    return [best, bs];
  }
  say(text, force = false) {
    if (!crew.dialogue) return;            // no dialogue: people react through body language only
    if (!force && (this.barkT > 0 || Math.random() > 0.8)) return;
    this.barkT = rnd(6, 12);
    this.bubble = { text, t: 3.2 };
  }
}

// ---------------------------------------------------------------- manager
export function initCrew(player, n = 4) {
  crew.player = player;
  if (!LM) LM = LANDMARKS.map(([name, la, lo, h, fame], i) => { const p = ll(la, lo); return { id: 'lm' + i, name, x: p.x, z: p.z, top: Math.max(2, terrainAt(p.x, p.z)) + h, fame }; });
  if (!crew.root) {
    crew.root = new THREE.Group(); crew.root.position.y = DECK.floorY - 0.24 + 0.24;   // deck sole in body coords
    crew.root.position.y = DECK.floorY;
    player.m.body.add(crew.root);
    crew.bubbles = document.createElement('div'); crew.bubbles.id = 'bubbles'; document.body.appendChild(crew.bubbles);
  }
  for (const p of crew.people) { crew.root.remove(p.m.root); p.el?.remove(); if (p.overboard) p.overboard.remove(); }
  crew.people = [];
  const cap = new Person(0, true); cap.x = HELM.x; cap.z = HELM.z; crew.people.push(cap);
  for (let i = 0; i < n; i++) {
    const p = new Person(i + 1);
    const spot = SEATS[(i + 1) % SEATS.length];
    p.x = spot.x + rnd(-0.1, 0.1); p.z = Math.min(DECK.z1 - 0.3, spot.z + rnd(-0.6, 0.2)); p.yaw = rnd(-1, 1);
    crew.people.push(p);
  }
  for (const p of crew.people) {
    crew.root.add(p.m.root);
    p.el = document.createElement('div'); p.el.className = 'bubble'; crew.bubbles.appendChild(p.el);
  }
  crew.prev = null;
}
export function crewVisible(v) { if (crew.root) crew.root.visible = v; if (crew.bubbles) crew.bubbles.style.display = v ? '' : 'none'; }

// points of interest, refreshed a few times a second (shared by everyone aboard)
function gatherPOIs(player, t) {
  const pois = [];
  const px = player.x, pz = player.z, vis = Math.min(env.visibility, 9000);
  for (const l of LM) {
    const d = Math.hypot(l.x - px, l.z - pz);
    if (d > vis) continue;
    pois.push({ id: l.id, name: l.name, x: l.x, z: l.z, y: l.top * 0.8, sal: l.fame * clamp((l.top + 60) / (d * 0.08 + 40), 0.15, 2.5), kind: 'landmark' });
  }
  for (const b of (W.tallBuildings || [])) {
    const d = Math.hypot(b.x - px, b.z - pz);
    if (d > Math.min(vis, 3500)) continue;
    pois.push({ id: 'b' + b.i, name: b.h > 150 ? 'that skyscraper' : 'that building', x: b.x, z: b.z, y: b.top * 0.85, sal: 0.25 + clamp(b.h / (d * 0.06 + 30), 0, 1.6), kind: 'building' });
  }
  for (const v of traffic.vessels) {
    if (!v.active || !v.mesh.visible) continue;
    const d = Math.hypot(v.x - px, v.z - pz);
    if (d > 600 || d < 3) continue;
    const big = v.cat === 'ship' ? 2.2 : v.type === 'ferry' ? 1.4 : v.type === 'kiter' ? 1.3 : v.isSail ? 1.0 : 0.6;
    const nm = v.name && v.name !== 'Spectator' ? v.name.split(' (')[0] : v.type === 'kiter' ? 'that kiteboarder' : v.isSail ? 'that sailboat' : v.cat === 'ship' ? 'that ship' : v.human ? 'that swimmer' : 'that boat';
    pois.push({ id: 'v' + v.id, name: nm, x: v.x, z: v.z, y: 2 + v.len * 0.08, sal: big * clamp(160 / (d + 40), 0.1, 2.2) + Math.min(1, v.speed / 12) * 0.4, kind: 'vessel', close: d < 60 });
  }
  if (fw.active) for (const j of [...fw.jets, fw.c130]) {
    if (!j || !j.visible) continue;
    const d = j.position.distanceTo(W.camera.position);
    pois.push({ id: 'jet' + j.id, name: j === fw.c130 ? 'Fat Albert' : 'the Blue Angels', x: j.position.x, z: j.position.z, y: j.position.y, sal: 6 * clamp(2500 / (d + 300), 0.3, 3), kind: 'jet', loud: d < 900 });
  }
  const sp = sunPosition(env.clock);
  if (sp.alt > -0.03 && sp.alt < 0.22 && env.fog < 0.3) {
    pois.push({ id: 'sun', name: env.clock > 12 ? 'the sunset' : 'the sunrise', x: px + Math.sin(sp.az) * 4000, z: pz - Math.cos(sp.az) * 4000, y: Math.tan(sp.alt) * 4000, sal: 2.2, kind: 'sun' });
  }
  if (player.sogKn > 18) pois.push({ id: 'wake', name: 'our wake', x: px - player.fwd.x * 60, z: pz - player.fwd.z * 60, y: 0, sal: 0.6, kind: 'wake' });
  for (const q of crew.people) if (!q.overboard) pois.push({ id: 'p:' + q.name, name: q.name, who: q, x: 0, z: 0, y: 0, sal: 0.35, kind: 'person' });
  crew.pois = pois;
}

// ---------------------------------------------------------------- per-frame
const _w = new THREE.Vector3(), _l = new THREE.Vector3();
let poiT = 0;
export function updateCrew(dt, player, opts = {}) {
  if (!crew.people.length || dt <= 0) return;
  const t = env.time;
  poiT -= dt; if (poiT <= 0) { poiT = 0.3; gatherPOIs(player, t); }
  // ---- what the deck does (deck frame): surge/sway accelerations from the boat's velocity change.
  // A crash is just a very large one-frame Δv — it throws people with no special-casing.
  const f = player.fwd, r = player.right;
  const bvx = player.vx, bvz = player.vz;
  const lu = bvx * f.x + bvz * f.z, lv = bvx * r.x + bvz * r.z;
  // teleports (new run, scenario start) aren't accelerations: re-baseline instead of flinging everyone
  if (crew.prev && (Math.hypot(player.x - crew.prev.x, player.z - crew.prev.z) > 30 || Math.hypot(lu - crew.prev.u, lv - crew.prev.v) > 25)) { crew.prev = null; for (const q of crew.people) q.prevDeckY = null; }
  if (!crew.prev) crew.prev = { u: lu, v: lv, x: player.x, z: player.z };
  crew.prev.x = player.x; crew.prev.z = player.z;
  const du = (lu - crew.prev.u), dv = (lv - crew.prev.v) + lu * player.r * dt;   // Δv this frame incl. centripetal
  crew.prev.u = lu; crew.prev.v = lv;
  // inertial impulse on passengers (deck frame: +x stbd, +z aft): opposite to the boat's Δv
  const Jx = -dv, Jz = du;
  const roll = player.roll + player.oscR, pitch = player.pitch + player.oscP;
  const gx = G * Math.sin(roll), gz = G * Math.sin(pitch);       // heel / bow-up slide
  const kn = player.sogKn;
  const crowdFear = crew.people.reduce((a, q) => a + (q.overboard ? 0 : q.d.fear), 0) / Math.max(1, crew.people.length);
  for (const p of crew.people) {
    if (p.overboard) { overboardUpdate(p, dt, player); continue; }
    // ---- vertical: deck heave at this person's spot; airborne when the deck drops faster than gravity
    const deckY = player.heave - p.z * Math.sin(pitch) + p.x * Math.sin(roll);
    if (p.prevDeckY == null) p.prevDeckY = deckY;
    const dvY = (deckY - p.prevDeckY) / dt; p.prevDeckY = deckY;
    const aY = (dvY - p.prevDeckV) / dt; p.prevDeckV = dvY;
    const normal = clamp((G + aY) / G, 0, 3);
    if (p.y > 0 || aY < -G * 1.05) { p.vy += (-G - aY) * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) { if (p.vy < -2) { p.balance -= 0.6 + p.tr.clumsy * 0.5; p.d.fear += 0.15; } p.vy = 0; } }
    // ---- grip: how much push this posture can resist before sliding (m/s² equivalent)
    const grip = ({ sit: 13, hold: 11, lean: 5, stand: 2.9, fallen: 4 }[p.posture] || 3) * (p.posture === 'stand' ? (0.85 + 0.5 * p.tr.brave - 0.45 * p.tr.clumsy - 0.3 * p.d.nausea) : 1) * normal;
    const ix = Jx / dt + gx, iz = Jz / dt + gz;                  // felt horizontal push (m/s²)
    const im = Math.hypot(ix, iz);
    const excess = Math.max(0, im - grip);
    if (excess > 0) {
      p.vx += ix / im * excess * dt; p.vz += iz / im * excess * dt;
      p.balance -= excess * dt * (0.25 + p.tr.clumsy * 0.3);
    }
    p.felt = im;
    // ---- drives
    const motion = im + Math.abs(aY) * 0.6;
    const speedFear = Math.max(0, kn - (18 + 30 * p.tr.brave)) * 0.012;
    p.d.fear = clamp(p.d.fear + (Math.max(0, motion - (3 + 5 * p.tr.brave)) * 0.05 + speedFear + (crowdFear - p.d.fear) * 0.1 * p.tr.social - 0.05) * dt, 0, 1.5);
    p.d.nausea = clamp(p.d.nausea + (p.tr.queasy * (Math.abs(aY) * 0.012 + Math.abs(player.oscR) * 0.6 + (kn < 6 ? Math.abs(roll) * 0.25 : 0)) - 0.006) * dt, 0, 1.2);
    p.d.thrill = clamp(p.d.thrill + ((kn > 28 ? (kn - 28) * 0.01 : -0.04) * p.tr.brave + (crew.pois.some(q => q.loud) ? 0.15 * p.tr.brave : 0)) * dt, 0, 1);
    p.d.boredom = clamp(p.d.boredom + (0.012 - (p.att ? 0.02 * Math.min(1, p.att.sal) : 0)) * dt, 0, 1);
    p.d.fatigue = clamp(p.d.fatigue + (p.posture === 'stand' ? 0.004 : -0.01) * dt, 0, 1);
    for (const [k, v] of p.boost) { const nv = v - dt * 0.4; if (nv <= 0) p.boost.delete(k); else p.boost.set(k, nv); }
    p.barkT -= dt;
    // ---- balance & falling (emergent: comes from the forces above, not from a "fall" trigger)
    p.balance = Math.min(1, p.balance + dt * (p.posture === 'stand' ? 0.35 : 0.8));
    if (p.posture === 'fallen') { p.fallT -= dt; if (p.fallT <= 0 && im < 4) { p.posture = 'stand'; p.balance = 0.6; } }
    else if (p.balance < 0 && !p.captain) {
      p.posture = 'fallen'; p.fallT = rnd(1.5, 3.5); p.d.fear += 0.3; p.seat = null; p.rail = null;
      p.say(pick(['whoa—!', 'ow!', 'AAH', 'oof', 'hey!!']), true);
      for (const q of crew.people) if (q !== p && !q.overboard && Math.hypot(q.x - p.x, q.z - p.z) < 3) { q.d.fear += 0.1; if (q.captain) q.say('Hold on to something!'); }
    }
    // ---- think: utility action selection (staggered, with hysteresis)
    p.thinkT -= dt;
    if (p.thinkT <= 0 && p.posture !== 'fallen') { p.thinkT = rnd(0.6, 1.3); think(p, t, kn, im, player); }
    // ---- act
    actUpdate(p, dt, t);
    // ---- move on the deck: walking intent + inertial slide, with friction, obstacles and edges
    const fr = p.posture === 'fallen' ? 3.5 : 6;
    p.vx -= p.vx * Math.min(1, fr * dt) * (excess > 0 ? 0.25 : 1); p.vz -= p.vz * Math.min(1, fr * dt) * (excess > 0 ? 0.25 : 1);
    if (p.goal && (p.posture === 'stand') && !p.captain) {
      const dx = p.goal.x - p.x, dz = p.goal.z - p.z, d = Math.hypot(dx, dz);
      const vmax = 0.9 * (1 - 0.4 * p.d.nausea) * (1 - clamp(im / 8, 0, 0.7));
      if (d > 0.08) { p.vx += (dx / d * vmax - p.vx) * Math.min(1, dt * 5); p.vz += (dz / d * vmax - p.vz) * Math.min(1, dt * 5); p.walking = true; } else p.walking = false;
    } else p.walking = false;
    if (p.captain) { p.vx *= 0.5; p.vz *= 0.5; const k = Math.min(1, dt * 3); p.x += (HELM.x - p.x) * k; p.z += (HELM.z - p.z) * k; }
    // separation from others
    for (const q of crew.people) if (q !== p && !q.overboard) { const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz); if (d < 0.42 && d > 1e-3) { p.vx += dx / d * (0.42 - d) * 6 * dt; p.vz += dz / d * (0.42 - d) * 6 * dt; } }
    p.x += p.vx * dt; p.z += p.vz * dt;
    for (const [ox, oz, orad] of OBST) { const dx = p.x - ox, dz = p.z - oz, d = Math.hypot(dx, dz); if (d < orad && !(p.seat && Math.abs(p.seat.x - ox) < 0.01 && Math.abs(p.seat.z - oz) < 0.01)) { p.x = ox + dx / (d || 1) * orad; p.z = oz + dz / (d || 1) * orad; } }
    edges(p, player);
  }
  // facing: walking → toward motion; else toward the action's facing / attention
  for (const p of crew.people) if (!p.overboard) pose(p, dt, player, opts);
  if (crew.dialogue) bubbles(player);
}

function edges(p, player) {
  // cabin sides are walls; the open cockpit's gunwales are low — enough momentum carries you over
  const cockpit = p.z > DECK.cabinZ;
  const xlim = cockpit ? DECK.x1 : 0.92;
  for (const s of [-1, 1]) {
    if (s * p.x > xlim) {
      const out = s * p.vx;
      const airborne = p.y > 0.15;
      if (cockpit && !p.captain && (out > 2.6 - (airborne ? 1.0 : 0) - (p.posture === 'lean' ? 1.2 : 0)) && p.posture !== 'hold') { goOverboard(p, player, s); return; }
      p.x = s * xlim; if (out > 0) { p.vx *= -0.3; if (out > 1.2) { p.balance -= out * 0.25; p.d.fear += 0.1; } }
    }
  }
  if (p.z > DECK.z1) { if (p.vz > 3.2 && !p.captain) { goOverboard(p, player, 0); return; } p.z = DECK.z1; if (p.vz > 0) p.vz *= -0.3; }
  if (p.z < DECK.z0) { p.z = DECK.z0; if (p.vz < 0) { p.balance -= -p.vz * 0.3; p.vz *= -0.3; } }
}

// ---------------------------------------------------------------- deciding what to do
function freeSeat(p) {
  let best = null, bd = 1e9;
  for (const s of SEATS) { if (crew.people.some(q => q !== p && q.seat === s)) continue; const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s; } }
  return best;
}
function freeRail(p, side = 0) {
  let best = null, bd = 1e9;
  for (const s of RAILS) { if (side && s.side !== side) continue; if (crew.people.some(q => q !== p && q.rail === s)) continue; const d = Math.hypot(s.x - p.x, s.z - p.z) + rnd(0, 0.5); if (d < bd) { bd = d; best = s; } }
  return best;
}
function think(p, t, kn, felt, player) {
  const D = p.d, T = p.tr;
  const [poi, ps] = p.bestPOI(t);
  const cur = p.act.type;
  const others = crew.people.filter(q => q !== p && !q.overboard && q.posture !== 'fallen');
  const near = others.filter(q => Math.hypot(q.x - p.x, q.z - p.z) < 2.6);
  const scared = D.fear + (felt > 4 ? 0.3 : 0) + (kn > 30 ? (kn - 30) * 0.02 * (1 - T.brave) : 0);
  const opts = p.captain ? [
    ['look', ps * 0.6 + 0.1, poi],
    ['ahead', 0.6 + kn * 0.03, null],
  ] : [
    ['sit', scared * 1.3 + D.fatigue * 0.6 + D.nausea * 0.3 - D.boredom * 0.3, null],
    ['hold', scared * 1.0 + felt * 0.05, null],
    ['sick', D.nausea > 0.85 ? 3 : D.nausea > 0.6 ? D.nausea : 0, null],
    ['look', ps * (1 - scared * 0.5) * (0.5 + T.curious * 0.5), poi],
    ['point', poi && ps > 1.6 && near.length && poi.kind !== 'person' ? ps * 0.55 * T.social : 0, poi],
    ['chat', near.length ? T.social * (0.3 + D.boredom) * (1 - scared) : 0, near[0]],
    ['cheer', D.thrill * T.brave * 1.4, poi],
    ['wander', D.boredom * 0.7 * (1 - scared), null],
  ];
  let best = opts[0];
  for (const o of opts) { const sc = o[1] + (o[0] === cur ? 0.25 : 0) + rnd(0, 0.08); if (sc > best[1] + (best[0] === cur ? 0.25 : 0)) best = o; }
  const [type, , tgt] = best;
  if (type === cur && (type !== 'look' || tgt === p.att)) return;
  setAction(p, type, tgt, player);
}
function setAction(p, type, tgt, player) {
  const prev = p.act.type;
  p.act = { type, t: 0, tgt };
  if (type !== 'sit') p.seat = null;
  if (type !== 'hold' && type !== 'sick') p.rail = null;
  p.goal = null;
  if (p.posture !== 'fallen') p.posture = 'stand';
  switch (type) {
    case 'sit': p.seat = freeSeat(p); if (p.seat) p.goal = p.seat; else { p.act.type = 'hold'; p.rail = freeRail(p); p.goal = p.rail; } if (p.d.fear > 0.6) p.say(pick(['Slow down!!', 'I need to sit…', 'Okay okay okay', 'Is this safe?!'])); break;
    case 'hold': p.rail = freeRail(p); p.goal = p.rail; break;
    case 'sick': {
      // the downwind side, ideally — but whichever rail is free and close will do
      p.rail = freeRail(p); p.goal = p.rail; p.say(pick(['ugh…', 'I don\'t feel so good', 'oh no', 'mmmph']), true);
      for (const q of crew.people) if (q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 3) q.d.nausea += 0.08 * q.tr.queasy;    // it's contagious
      break;
    }
    case 'look': p.att = tgt; if (tgt) { p.mem.set(tgt.id, env.time); if (Math.random() < 0.35 * p.tr.curious && tgt.kind !== 'person') p.say(remark(tgt)); if (tgt.kind === 'jet' || tgt.kind === 'landmark' || tgt.kind === 'sun') { const s = freeRail(p); if (s && Math.random() < 0.5) p.goal = s; } } break;
    case 'point': p.att = tgt; p.mem.set(tgt.id, env.time); p.say(`Look — ${tgt.name}!`, true);
      for (const q of crew.people) if (q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 3.5) { q.boost.set(tgt.id, 2.5 * (0.5 + q.tr.social)); q.thinkT = Math.min(q.thinkT, rnd(0.2, 0.8)); }
      break;
    case 'chat': p.att = { id: 'p:' + tgt.name, who: tgt, name: tgt.name, kind: 'person', sal: 0.5 }; if (Math.random() < 0.4) p.say(pick(['Did you see that?', 'This is amazing', 'Where are we headed?', 'I could live out here', 'Is that Alcatraz?', 'brrr, it\'s windy', 'Best day ever'])); tgt.boost.set('p:' + p.name, 1.2); break;
    case 'cheer': p.att = tgt; p.say(pick(['WOOHOO!', 'Faster!!', 'YEAH!', 'Let\'s gooo', 'Wheee!']), true); break;
    case 'wander': p.goal = { x: rnd(-0.8, 0.8), z: rnd(1.5, 3.7) }; break;
    case 'ahead': p.att = null; break;
  }
  if (prev === 'sit' && type !== 'sit' && p.d.fear < 0.2 && Math.random() < 0.2) p.say('Okay, I\'m good now');
}
function remark(poi) {
  switch (poi.kind) {
    case 'jet': return pick([`${poi.name}!!`, 'SO LOUD', 'How are they that close?!', 'Did you feel that?!', 'They\'re upside down!']);
    case 'landmark': return pick([`That's ${poi.name}`, `Wow, ${poi.name}`, `Look at ${poi.name}`, `I've never seen ${poi.name} from the water`]);
    case 'building': return pick(['How tall is that?', 'Nice view of the city', 'I can see my office']);
    case 'vessel': return poi.close ? pick([`${poi.name} is close…`, 'Wave!', 'Hi!!']) : pick([`Look at ${poi.name}`, 'Big boat', 'Is that a ferry?']);
    case 'sun': return pick(['What a sunset', 'Golden hour!', 'So pretty', 'Get a photo!']);
    case 'wake': return pick(['Look at our wake!', 'We\'re flying']);
    default: return '';
  }
}
function actUpdate(p, dt, t) {
  const a = p.act; a.t += dt;
  if (p.goal && Math.hypot(p.goal.x - p.x, p.goal.z - p.z) < 0.1) {
    if (a.type === 'sit' && p.seat) p.posture = 'sit';
    else if ((a.type === 'hold' || a.type === 'look') && p.rail) p.posture = 'hold';
    else if (a.type === 'sick' && p.rail) { p.posture = 'lean'; }
    p.goal = null;
  }
  if (a.type === 'sick' && p.posture === 'lean' && a.t > 2.5) {
    // the moment itself: a little green splash over the side, then relief
    if (!a.done) { a.done = true; splash(p); p.d.nausea = 0.3; p.d.fear = Math.max(0, p.d.fear - 0.1); for (const q of crew.people) if (q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 3 && Math.random() < 0.5) q.say(pick(['eww', 'you okay?', 'oh no…', 'poor thing'])); }
    if (a.t > 6) { p.posture = 'stand'; p.thinkT = 0; p.say(pick(['…better', 'sorry', 'I\'m fine. I\'m fine.']), true); }
  }
}

// ---------------------------------------------------------------- overboard & recovery
function goOverboard(p, player, side) {
  const b = player.m.body; b.updateMatrixWorld(true);
  _w.set(p.x + side * 0.6, 0, p.z).applyMatrix4(crew.root.matrixWorld);
  const sw = makeScripted('swimmer', { x: _w.x, z: _w.z, h: player.h, len: 1.8, beam: 0.6, human: true, cat: 'small', name: `${p.name} (MOB)`, maxSpeed: 0 });
  // a person in the water isn't a rigid obstacle for the hull (and must not jolt everyone else overboard)
  sw.noCollide = true;
  sw.script = (v) => { v.targetSpeed = 0; v.speed = 0; };
  p.overboard = sw; p.posture = 'fallen'; p.m.root.visible = false; p.seat = p.rail = null;
  p.say('HELP!!', true);
  crew.hooks.mob?.(p, sw);
  for (const q of crew.people) if (q !== p && !q.overboard) { q.d.fear = Math.min(1.5, q.d.fear + 0.5); if (!q.captain) { q.boost.set('v' + sw.id, 6); q.thinkT = 0.1; } q.say(q.captain ? 'MAN OVERBOARD!' : pick([`${p.name}!!`, 'OH MY GOD', 'Stop the boat!!']), true); }
}
function overboardUpdate(p, dt, player) {
  const v = p.overboard;
  if (!v.active) { p.overboard = null; return; }
  const d = Math.hypot(v.x - player.x, v.z - player.z);
  if (d < 5 && player.sogKn < 2.2) {
    p.recT = (p.recT || 0) + dt;
    if (p.recT > 1.5) {
      v.remove(); p.overboard = null; p.recT = 0; p.m.root.visible = true;
      p.x = 0; p.z = DECK.z1 - 0.2; p.vx = p.vz = 0; p.posture = 'fallen'; p.fallT = 3; p.d.fear = 1; p.d.boredom = 0;
      p.say(pick(['Thank you…', 'That was SO cold', '*coughs*', 'never again']), true);
      crew.hooks.recovered?.(p);
    }
  } else p.recT = 0;
}
export function ejectAll(player, speed = 6) {
  for (const p of crew.people) if (!p.overboard) { p.vx = rnd(-1, 1) * speed; p.vz = rnd(-1, 1) * speed; goOverboard(p, player, Math.sign(p.vx) || 1); }
}
export function anyOverboard() { return crew.people.some(p => p.overboard); }

// ---------------------------------------------------------------- vomit splash (tiny particle burst)
let splashes = [];
function splash(p) {
  const g = new THREE.Group();
  for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 4), new THREE.MeshBasicMaterial({ color: '#9bbf45' })); g.add(m); m.userData.v = new THREE.Vector3(Math.sign(p.x || 1) * rnd(0.6, 1.6), rnd(0.2, 1.2), rnd(-0.4, 0.4)); }
  g.position.set(p.x + Math.sign(p.x || 1) * 0.25, 1.3, p.z);
  crew.root.add(g); splashes.push({ g, t: 0 });
}
function updateSplashes(dt) {
  for (const s of splashes) { s.t += dt; for (const m of s.g.children) { m.userData.v.y -= 9.8 * dt; m.position.addScaledVector(m.userData.v, dt); } }
  splashes = splashes.filter(s => { if (s.t > 1.2) { crew.root.remove(s.g); return false; } return true; });
}

// ---------------------------------------------------------------- pose & animation
function pose(p, dt, player, opts) {
  const P = p.pose, m = p.m, k = Math.min(1, dt * 6);
  updateSplashes(dt / Math.max(1, crew.people.length));
  // attention → where the head (and body) points; heads tilt UP to the actual height of the building/jet
  let lookYaw = null, lookPitch = 0;
  const tg = p.act.type === 'ahead' ? null : p.att;
  if (tg) {
    if (tg.who) { lookYaw = Math.atan2(tg.who.x - p.x, -(tg.who.z - p.z)); lookPitch = 0; }
    else {
      _w.set(tg.x, tg.y, tg.z); crew.root.worldToLocal(_l.copy(_w));
      const dx = _l.x - p.x, dz = _l.z - p.z, dy = _l.y - 1.55 * p.scale;
      lookYaw = Math.atan2(dx, -dz); lookPitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
  }
  let want = p.yaw;
  if (p.walking) want = Math.atan2(p.vx, -p.vz);
  else if (p.posture === 'sit' && p.seat) want = p.seat.yaw;
  else if ((p.posture === 'hold' || p.posture === 'lean') && p.rail) want = p.rail.yaw;
  else if (lookYaw != null) want = lookYaw;
  if (p.captain) want = 0;
  let dy = Math.atan2(Math.sin(want - p.yaw), Math.cos(want - p.yaw));
  p.yaw += dy * Math.min(1, dt * 3);
  // head: the remainder (clamped to a human neck)
  const hy = lookYaw == null ? Math.sin(env.time * 0.3 + p.scale * 9) * 0.25 : clamp(Math.atan2(Math.sin(lookYaw - p.yaw), Math.cos(lookYaw - p.yaw)), -1.4, 1.4);
  const hp = clamp(lookPitch, -0.6, 1.1);
  P.hy += (hy - P.hy) * k; P.hp += (hp - P.hp) * k;
  // body targets
  const sitting = p.posture === 'sit', fallen = p.posture === 'fallen', lean = p.posture === 'lean', hold = p.posture === 'hold';
  P.sit += ((sitting ? 1 : 0) - P.sit) * k;
  P.fallen += ((fallen ? 1 : 0) - P.fallen) * Math.min(1, dt * 8);
  P.vomit += ((lean ? 1 : 0) - P.vomit) * k;
  P.hold += ((hold || (sitting && p.d.fear > 0.6) ? 1 : 0) - P.hold) * k;
  P.cheer += ((p.act.type === 'cheer' ? 1 : 0) - P.cheer) * k;
  P.point += ((p.act.type === 'point' && p.act.t < 3 ? 1 : 0) - P.point) * k;
  P.walk += ((p.walking ? 1 : 0) - P.walk) * k;
  P.phase += dt * 7 * P.walk;
  // lean against the felt force (people brace into it) — this is what makes them visibly wobble
  const fx = (p.felt || 0) > 0.5 ? clamp(-p.vx * 0.15, -0.5, 0.5) : 0;
  P.tx += ((clamp(-(crew.prev ? 0 : 0) + fx + Math.sin(env.time * 1.7 + p.scale * 5) * 0.02, -0.6, 0.6)) - P.tx) * k;
  const root = m.root;
  root.position.set(p.x, p.y + (1 - P.sit) * 0 - P.sit * 0.36 * p.scale - P.fallen * 0.7 * p.scale, p.z);
  root.rotation.set(P.fallen * 1.35, -p.yaw, 0, 'YXZ');
  m.torso.rotation.set(-P.vomit * 1.0 - P.sit * 0.08 + P.cheer * 0.1, 0, P.tx);
  m.neck.rotation.set(P.hp - P.vomit * 0.4, -P.hy, 0, 'YXZ');
  const sw = Math.sin(P.phase) * 0.5 * P.walk;
  m.legL.rotation.x = sw + P.sit * 1.45; m.legR.rotation.x = -sw + P.sit * 1.45;
  m.armL.rotation.set(-sw * 0.8 + P.cheer * 2.9 - P.hold * 1.0, 0, -P.hold * 0.6 - P.cheer * 0.3);
  // pointing arm aims along the look direction
  m.armR.rotation.set(sw * 0.8 + P.cheer * 2.9 + P.point * (1.6 + P.hp), P.point * -P.hy * 0.6, P.cheer * 0.3);
  // first-person view is the captain's eyes: don't draw him inside the camera
  root.visible = !(p.captain && opts.camMode === 'helm');
}

// ---------------------------------------------------------------- speech bubbles (DOM, few elements)
const _sp = new THREE.Vector3();
function bubbles(player) {
  for (const p of crew.people) {
    const el = p.el; if (!el) continue;
    if (p.bubble) p.bubble.t -= 1 / 60;
    if (!p.bubble || p.bubble.t <= 0 || (p.captain && false)) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
    const src = p.overboard ? _sp.set(p.overboard.x, 1.2, p.overboard.z) : p.m.root.localToWorld(_sp.set(0, 2.0 * p.scale, 0));
    src.project(W.camera);
    if (src.z > 1 || Math.abs(src.x) > 1.1 || Math.abs(src.y) > 1.1) { el.style.display = 'none'; continue; }
    el.style.display = 'block';
    el.textContent = p.bubble.text;
    el.style.transform = `translate(${(src.x * 0.5 + 0.5) * window.innerWidth}px, ${(-src.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
    el.style.opacity = Math.min(1, p.bubble.t * 2);
  }
}
