// AI traffic for a busy October Saturday on the central bay: ships, ferries, tour boats,
// sailboats (cruisers + race fleets), powerboats, fishing boats, paddlers, swimmers, kiters...
import * as THREE from 'three';
import { ll, sdfAt, depthAt, SHIP_LANES, noWakeZoneAt, BOUNDS } from './geo.js';
import { currentAt, windAt, waveHeight, env, KN, baseWindKn } from './env.js';
import { findPath, clearLine, randomWaterPoint } from './nav.js';
import { classify, cpa, relBearing, angDiff } from './rules.js';
import { PRACTICE_STARTS, SITES } from './docks.js';
import { emitFoam, W } from './world.js';
import {
  buildPowerboat, buildSailboat, buildContainerShip, buildTanker, buildCarCarrier, buildFerryCat, buildFerryMono, buildTug,
  buildBarge, buildFishing, buildRIB, buildJetSki, buildKayak, buildSwimmer, buildKiter, buildBuoy,
} from './models.js';

const D2R = Math.PI / 180;
export const traffic = { vessels: [], marks: [], hooks: {} };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function fp(lat, lon, br, a, b) { const p = ll(lat, lon), t = br * D2R; return { x: p.x + Math.sin(t) * a + Math.cos(t) * b, z: p.z - Math.cos(t) * a + Math.sin(t) * b }; }
const P = (lat, lon) => ll(lat, lon);
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const SHIP_NAMES = ['PACIFIC MERIDIAN', 'EVER LUMEN', 'ORIENT HARMONY', 'ALOHA TRADER', 'NORDIC SPIRIT', 'CAPE KESTREL', 'GOLDEN CREST', 'SIERRA EXPRESS', 'HORIZON VOYAGER', 'MARE LIBERUM', 'BAY PIONEER', 'STELLAR TIDE'];
const FERRY_NAMES = { gg: ['MENDOCINO', 'NAPA', 'SONOMA', 'SAN FRANCISCO', 'MARIN'], bay: ['INTINTOLI', 'HYDRUS', 'CETUS', 'DORADO', 'PYXIS', 'VELA', 'LYRA'], bg: ['OSKI', 'ZELINSKY', 'GOLDEN BEAR', 'BAY MONARCH'], alc: ['ALCATRAZ FLYER', 'ALCATRAZ CLIPPER', 'ALCATRAZ ISLANDER'] };

// ---------------------------------------------------------------- vessel
let nextId = 1;
export class Vessel {
  constructor(o) {
    Object.assign(this, {
      id: nextId++, x: 0, z: 0, h: 0, speed: 0, targetSpeed: 0, maxSpeed: 10, turnRate: 0.25, accel: 0.6,
      path: [], wp: 0, len: 10, beam: 3.4, active: true, cat: 'power', isSail: false, ram: false, fishing: false, human: false, anchored: false,
      vx: 0, vz: 0, avoidH: 0, avoidS: 1, avoidT: 0, hornT: 0, timer: 0, state: 'go', obeys: true, foamT: 0, bob: 1, scripted: false,
    }, o);
    if (this.desH === undefined) this.desH = this.h;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    W.scene.add(this.mesh);
  }
  get fwd() { return { x: Math.sin(this.h), z: -Math.cos(this.h) }; }
  remove() { W.scene.remove(this.mesh); if (this.extra) for (const e of this.extra) W.scene.remove(e); this.active = false; }
  setPath(pts) { this.path = pts; this.wp = 0; }
}

function mk(type, o) { const v = new Vessel({ type, ...o }); traffic.vessels.push(v); return v; }

// ---------------------------------------------------------------- spawning
let density = 1;
export function spawnTraffic(level = 'typical') {
  clearTraffic();
  density = level === 'light' ? 0.35 : level === 'insane' ? 1.6 : level === 'none' ? 0 : 1;
  if (density === 0) return;
  spawnShips();
  spawnFerries();
  spawnTours();
  spawnSail();
  spawnRaceFleets();
  spawnPower();
  spawnFishing();
  spawnSmall();
  spawnLaw();
}
export function clearTraffic() {
  for (const v of traffic.vessels) v.remove();
  traffic.vessels.length = 0;
  for (const m of traffic.marks) W.scene.remove(m.mesh);
  traffic.marks.length = 0;
}

// ---- ships
const LANES = () => SHIP_LANES.map(l => l.xz.map(([x, z]) => ({ x, z })));
function spawnShip(laneIdx, outbound, progress = 0, name) {
  const lane = LANES()[laneIdx];
  const pts = outbound ? [...lane].reverse() : lane;
  const kind = laneIdx === 1 ? 'tanker' : pick(['container', 'container', 'container', 'carcarrier']);
  const len = kind === 'container' ? rnd(260, 330) : kind === 'tanker' ? rnd(220, 250) : rnd(190, 200);
  const mesh = kind === 'container' ? buildContainerShip(len) : kind === 'tanker' ? buildTanker(len) : buildCarCarrier(len);
  // place along path by progress
  let segs = [], tot = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z); segs.push(d); tot += d; }
  let dist = tot * progress, i = 0;
  while (i < segs.length - 1 && dist > segs[i]) { dist -= segs[i]; i++; }
  const t = dist / segs[i];
  const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t, z = pts[i].z + (pts[i + 1].z - pts[i].z) * t;
  const h = Math.atan2(pts[i + 1].x - pts[i].x, -(pts[i + 1].z - pts[i].z));
  const v = mk('ship', {
    mesh, x, z, h, len, beam: len * (kind === 'tanker' ? 0.17 : 0.15), cat: 'ship', kind, maxSpeed: 12 * KN, speed: 12 * KN, targetSpeed: 12 * KN,
    turnRate: 0.035, accel: 0.05, name: name || pick(SHIP_NAMES), outbound, lane: laneIdx, bob: 0,
  });
  v.setPath(pts.slice(i + 1)); v.onEnd = 'despawn';
  traffic.hooks.radio?.('ship', v, progress === 0);
  return v;
}
function spawnShips() {
  spawnShip(0, false, 0.45);
  spawnShip(0, true, 0.2);
  if (density >= 1) spawnShip(1, true, 0.55);
  traffic.shipTimer = rnd(120, 260) / density;
}

// ---- ferries
function berth(lat, lon, br, a, b, heading) { const p = fp(lat, lon, br, a, b); return { ...p, h: heading * D2R }; }
const TERM = () => ({
  FB: { name: 'Ferry Building', berths: [berth(37.79563, -122.39164, 114, 0, -9, 114), berth(37.79534, -122.39140, 114, 0, -9, 114), berth(37.79507, -122.39100, 114, 0, -9, 114)], approach: P(37.7970, -122.3880) },
  SAU: { name: 'Sausalito', berths: [berth(37.85637, -122.47845, 90, 55, 10, 90)], approach: P(37.8556, -122.4740) },
  TIB: { name: 'Tiburon', berths: [berth(37.87262, -122.45592, 120, 26, 9, 120)], approach: P(37.8712, -122.4545) },
  AYA: { name: 'Angel Island', berths: [berth(37.86866, -122.43482, 290, 42, 0, 20)], approach: P(37.8708, -122.4370) },
  ALC: { name: 'Alcatraz', berths: [berth(37.8270, -122.4218, 60, 62, 0, 150)], approach: fp(37.8270, -122.4218, 60, 320, 0) },
  P33: { name: 'Pier 33', berths: [berth(37.8068, -122.4045, 35, 150, 26, 35), berth(37.8068, -122.4045, 35, 90, 26, 35)], approach: fp(37.8068, -122.4045, 35, 330, 70) },
  P41: { name: 'Pier 41', berths: [berth(37.8088, -122.4135, 15, 70, 18, 15)], approach: fp(37.8088, -122.4135, 15, 240, 50) },
  P43: { name: 'Pier 43½', berths: [berth(37.8086, -122.4160, 10, 55, 14, 10)], approach: fp(37.8086, -122.4160, 10, 230, 20) },
  MB: { name: 'Mission Bay', berths: [{ ...P(37.7746, -122.3857), h: 180 * D2R }], approach: P(37.7800, -122.3828) },
  LARK: { name: 'Larkspur', exit: true, approach: P(37.9170, -122.4290) },
  VAL: { name: 'Vallejo', exit: true, approach: P(37.9170, -122.3780) },
  OAK: { name: 'Oakland/Alameda', exit: true, approach: P(37.7925, -122.3525) },
});
const VIA = {
  'FB-SAU': [[37.8010, -122.3920], [37.8120, -122.4060], [37.8205, -122.4300], [37.8350, -122.4580], [37.8480, -122.4690]],
  'FB-TIB': [[37.8010, -122.3920], [37.8150, -122.4100], [37.8350, -122.4350], [37.8530, -122.4525], [37.8660, -122.4530]],
  'P41-SAU': [[37.8150, -122.4200], [37.8350, -122.4580], [37.8480, -122.4690]],
  'P41-TIB': [[37.8180, -122.4250], [37.8450, -122.4455], [37.8660, -122.4530]],
  'TIB-AYA': [[37.8700, -122.4500], [37.8720, -122.4420]],
  'P33-ALC': [[37.8150, -122.4130]],
  'FB-LARK': [[37.8050, -122.3880], [37.8250, -122.4050], [37.8450, -122.4090], [37.8700, -122.4090], [37.9000, -122.4220]],
  'FB-VAL': [[37.8050, -122.3850], [37.8300, -122.3850], [37.8700, -122.3800]],
  'FB-OAK': [[37.7965, -122.3850], [37.7976, -122.3790], [37.7935, -122.3650]],
  'FB-MB': [[37.7900, -122.3850], [37.7838, -122.3812]],
};
function legPath(a, b, T) {
  const key = a + '-' + b, rkey = b + '-' + a;
  let via = VIA[key] ? VIA[key] : VIA[rkey] ? [...VIA[rkey]].reverse() : [];
  const pts = [T[a].approach, ...via.map(([la, lo]) => P(la, lo)), T[b].approach];
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    if (clearLine(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, -20, 2.5)) out.push(pts[i + 1]);
    else out.push(...findPath(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z));
  }
  return out;
}

function spawnFerry(route, livery, model, speedKn, name, phase = 0) {
  const T = TERM();
  const len = model === 'cat' ? rnd(34, 42) : rnd(30, 38);
  const mesh = model === 'cat' ? buildFerryCat(len, livery) : buildFerryMono(len, livery);
  const v = mk('ferry', {
    mesh, len, beam: len * (model === 'cat' ? 0.3 : 0.27), cat: 'ferry', livery, maxSpeed: speedKn * KN, turnRate: 0.12, accel: 0.5,
    name: name || pick(FERRY_NAMES[livery] || ['BAY LINER']), route, stop: 0, bob: 0.4,
  });
  // start at a random point of the route: at a berth or underway
  const si = Math.floor(Math.random() * route.length);
  const tName = route[si];
  const term = T[tName];
  if (!term.exit && Math.random() < 0.35) {
    const b = term.berths[Math.floor(Math.random() * term.berths.length)];
    v.x = b.x; v.z = b.z; v.h = b.h; v.state = 'dwell'; v.timer = rnd(10, 80); v.stop = si; v.berth = b;
  } else {
    const nxt = route[(si + 1) % route.length];
    const pth = legPath(tName, nxt, T);
    const k = Math.floor(Math.random() * Math.max(1, pth.length - 1));
    const a = k === 0 ? term.approach : pth[k - 1], bb = pth[k];
    const t = Math.random();
    v.x = a.x + (bb.x - a.x) * t; v.z = a.z + (bb.z - a.z) * t; v.h = Math.atan2(bb.x - a.x, -(bb.z - a.z));
    v.setPath(pth.slice(k)); v.state = 'go'; v.stop = (si + 1) % route.length; v.speed = v.maxSpeed; v.targetSpeed = v.maxSpeed;
  }
  return v;
}
function spawnFerries() {
  const d = density;
  spawnFerry(['FB', 'SAU'], 'gg', 'cat', 28);
  if (d >= 1) spawnFerry(['FB', 'SAU'], 'gg', 'cat', 28);
  spawnFerry(['FB', 'LARK'], 'gg', 'cat', 32);
  if (d >= 1) spawnFerry(['FB', 'LARK'], 'gg', 'cat', 32);
  spawnFerry(['FB', 'TIB'], 'gg', 'cat', 26);
  spawnFerry(['P41', 'SAU'], 'bg', 'cat', 24);
  spawnFerry(['P41', 'TIB', 'AYA'], 'bg', 'cat', 24);
  spawnFerry(['TIB', 'AYA'], 'bg', 'mono', 11, 'ANGEL ISLAND');
  spawnFerry(['P33', 'ALC'], 'alc', 'mono', 13);
  spawnFerry(['P33', 'ALC'], 'alc', 'mono', 13);
  if (d >= 1) spawnFerry(['P33', 'ALC'], 'alc', 'mono', 13);
  spawnFerry(['FB', 'OAK'], 'bay', 'cat', 30);
  if (d >= 1) spawnFerry(['FB', 'OAK'], 'bay', 'cat', 30);
  spawnFerry(['FB', 'VAL'], 'bay', 'cat', 34);
  if (d >= 1) spawnFerry(['FB', 'MB'], 'bay', 'cat', 24);
}

// ---- tour boats
const TOURS = {
  rw: { home: 'P43', livery: 'rw', loop: [[37.8150, -122.4200], [37.8135, -122.4550], [37.8160, -122.4795], [37.8185, -122.4870], [37.8250, -122.4800], [37.8310, -122.4650], [37.8335, -122.4320], [37.8290, -122.4160], [37.8160, -122.4140]] },
  bg: { home: 'P41', livery: 'bg', loop: [[37.8160, -122.4180], [37.8140, -122.4560], [37.8165, -122.4795], [37.8230, -122.4795], [37.8320, -122.4600], [37.8320, -122.4280], [37.8180, -122.4120]] },
  horn: { home: null, livery: 'horn', start: [37.8005, -122.3905], loop: [[37.8040, -122.3870], [37.8150, -122.3950], [37.8215, -122.4150], [37.8190, -122.4300], [37.8120, -122.4150], [37.8030, -122.3920]] },
};
function spawnTours() {
  const T = TERM();
  for (const [k, n] of [['rw', 2], ['bg', 2], ['horn', 2]]) {
    for (let i = 0; i < Math.max(1, Math.round(n * density)); i++) {
      const tour = TOURS[k];
      const len = k === 'horn' ? 48 : rnd(38, 46);
      const mesh = k === 'horn' ? buildFerryMono(len, 'horn') : buildFerryMono(len, tour.livery === 'bg' ? 'bg' : 'rw');
      const pts = tour.loop.map(([a, b]) => P(a, b));
      const j = Math.floor(Math.random() * pts.length), a = pts[j], b = pts[(j + 1) % pts.length];
      const v = mk('tour', {
        mesh, len, beam: len * 0.27, cat: 'ferry', tour: k, maxSpeed: (k === 'horn' ? 8 : 12) * KN, turnRate: 0.08, accel: 0.3,
        name: k === 'rw' ? 'RED & WHITE ' + pick(['ROYAL PRINCE', 'HARBOR EMPRESS', 'BAY STAR']) : k === 'bg' ? 'BLUE & GOLD ' + pick(['HARBOR QUEEN', 'BAY MONARCH']) : 'HORNBLOWER ' + pick(['SAN FRANCISCO BELLE', 'CALIFORNIA HORNBLOWER']),
        x: a.x + (b.x - a.x) * 0.5, z: a.z + (b.z - a.z) * 0.5, h: Math.atan2(b.x - a.x, -(b.z - a.z)), bob: 0.4,
      });
      v.loop = pts; v.loopIdx = (j + 1) % pts.length; v.setPath([b]); v.speed = v.maxSpeed; v.targetSpeed = v.maxSpeed;
    }
  }
}

// ---- sailboats (cruising)
const SAIL_ZONES = [
  { c: [37.8150, -122.4500], r: 1300, n: 14 }, // city front / Crissy
  { c: [37.8270, -122.4050], r: 1600, n: 12 }, // the slot / Alcatraz east
  { c: [37.8400, -122.4500], r: 1300, n: 10 }, // Harding / Sausalito approach
  { c: [37.8540, -122.4680], r: 700, n: 7 },   // Richardson Bay entrance
  { c: [37.8680, -122.4440], r: 650, n: 7 },   // Raccoon Strait
  { c: [37.8440, -122.4180], r: 900, n: 6 },   // Angel Island south
  { c: [37.8000, -122.3700], r: 900, n: 4 },   // Bay Bridge / YBI
  { c: [37.8350, -122.3800], r: 1200, n: 6 },  // TI west
];
function makeSail(x, z, len) {
  const sailC = Math.random() < 0.15 ? pick(['#2c2c2c', '#e6d9b8', '#d9e3ea']) : '#f7f5ef';
  const sb = buildSailboat(len, sailC);
  const v = mk('sail', {
    mesh: sb.group, rig: sb.rig, mainPiv: sb.mainPiv, len, beam: len * 0.33, cat: 'sail', isSail: true, x, z,
    h: Math.random() * Math.PI * 2, maxSpeed: (4.5 + len * 0.2) * KN, turnRate: 0.25, accel: 0.25, tack: 1, tackT: rnd(30, 120), bob: 1,
  });
  return v;
}
function spawnSail() {
  for (const zn of SAIL_ZONES) {
    const c = P(...zn.c);
    for (let i = 0; i < Math.round(zn.n * density); i++) {
      const p = randomWaterPoint(c.x, c.z, zn.r, -50, 3);
      if (!p) continue;
      const v = makeSail(p.x, p.z, rnd(7.5, 15));
      v.zone = { x: c.x, z: c.z, r: zn.r };
      v.target = randomWaterPoint(c.x, c.z, zn.r, -60, 3) || p;
      v.speed = v.maxSpeed * 0.7;
    }
  }
}
// ---- race fleets with marks
export function spawnFleetAt(lat, lon, n, lenRange = [9, 11]) {
  const saved = density; density = 1;
  const from = env.windDirFrom * D2R;
  const c = P(lat, lon);
  const up = { x: Math.sin(from), z: -Math.cos(from) };
  const wwd = { x: c.x + up.x * 650, z: c.z + up.z * 650 }, lwd = { x: c.x - up.x * 650, z: c.z - up.z * 650 };
  for (const m of [wwd, lwd]) {
    const mesh = buildBuoy('yellow'); mesh.scale.setScalar(0.8); mesh.position.set(m.x, 0, m.z); W.scene.add(mesh);
    traffic.marks.push({ mesh, x: m.x, z: m.z });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = Math.random();
    const x = lwd.x + (wwd.x - lwd.x) * t + rnd(-200, 200), z = lwd.z + (wwd.z - lwd.z) * t + rnd(-200, 200);
    if (sdfAt(x, z) > -40) continue;
    const v = makeSail(x, z, rnd(...lenRange));
    v.race = { wwd, lwd, leg: Math.random() < 0.5 ? 'up' : 'down' };
    v.target = v.race.leg === 'up' ? wwd : lwd; v.speed = v.maxSpeed * 0.8; v.racing = true;
    out.push(v);
  }
  density = saved;
  return out;
}
function spawnRaceFleets() {
  const fleets = [
    { c: [37.8105, -122.4470], n: 12, len: [9, 11] },   // city front (St. Francis / GGYC)
    { c: [37.8270, -122.3950], n: 10, len: [10, 14] },  // central bay / slot
  ];
  const from = env.windDirFrom * D2R;
  for (const f of fleets) {
    const c = P(...f.c);
    const up = { x: Math.sin(from), z: -Math.cos(from) };
    const wwd = { x: c.x + up.x * 650, z: c.z + up.z * 650 }, lwd = { x: c.x - up.x * 650, z: c.z - up.z * 650 };
    for (const m of [wwd, lwd]) {
      const mesh = buildBuoy('yellow'); mesh.scale.setScalar(0.8); mesh.position.set(m.x, 0, m.z); W.scene.add(mesh);
      traffic.marks.push({ mesh, x: m.x, z: m.z });
    }
    const n = Math.round(f.n * Math.min(1.3, density));
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      const x = lwd.x + (wwd.x - lwd.x) * t + rnd(-180, 180), z = lwd.z + (wwd.z - lwd.z) * t + rnd(-180, 180);
      if (sdfAt(x, z) > -40) continue;
      const v = makeSail(x, z, rnd(...f.len));
      v.race = { wwd, lwd, leg: Math.random() < 0.5 ? 'up' : 'down' };
      v.target = v.race.leg === 'up' ? wwd : lwd;
      v.speed = v.maxSpeed * 0.8;
      v.racing = true;
    }
  }
}
// ---- powerboats
function endpoints() {
  const out = Object.values(PRACTICE_STARTS).map(s => P(s.lat, s.lon));
  for (const ll2 of [[37.8300, -122.4500], [37.8200, -122.4000], [37.8450, -122.4300], [37.8100, -122.3800], [37.8600, -122.4150], [37.8350, -122.3750], [37.8000, -122.4600]]) out.push(P(...ll2));
  return out;
}
function spawnPower() {
  const eps = endpoints();
  const n = Math.round(38 * density);
  for (let i = 0; i < n; i++) {
    const a = pick(eps), p = randomWaterPoint(a.x, a.z, 900, -40, 2.5);
    if (!p) continue;
    const len = rnd(6, 16);
    const style = pick(['cruiser', 'cc', 'cc', 'sport', 'sport', 'trawler']);
    const fast = style === 'trawler' ? rnd(8, 10) : rnd(16, 34);
    const v = mk('power', {
      mesh: buildPowerboat(len, style), len, beam: len * 0.34, cat: 'power', x: p.x, z: p.z, h: Math.random() * 6.28,
      maxSpeed: fast * KN, turnRate: 0.35, accel: 1.2, obeys: Math.random() > 0.2, bob: 1,
    });
    routePower(v, eps);
    v.speed = v.maxSpeed * 0.8;
  }
}
function routePower(v, eps = endpoints()) {
  let dest = pick(eps);
  const d = randomWaterPoint(dest.x, dest.z, 300, -25, 2.5) || dest;
  v.setPath(findPath(v.x, v.z, d.x, d.z));
  v.state = 'go'; v.onEnd = 'loiter';
}
// ---- fishing
function spawnFishing() {
  const spots = [[37.8275, -122.4300], [37.8375, -122.4460], [37.8520, -122.4150], [37.8135, -122.4720], [37.8580, -122.4500], [37.8400, -122.4680], [37.8230, -122.4200], [37.8180, -122.3880]];
  for (const s of spots) for (let i = 0; i < Math.max(1, Math.round(1.3 * density)); i++) {
    const c = P(...s), p = randomWaterPoint(c.x, c.z, 200, -40, 3);
    if (!p) continue;
    const len = rnd(7, 13);
    const v = mk('fishing', {
      mesh: Math.random() < 0.5 ? buildFishing(len) : buildPowerboat(len, 'cc'), len, beam: len * 0.35, cat: 'power', x: p.x, z: p.z, h: Math.random() * 6.28,
      maxSpeed: 8 * KN, turnRate: 0.3, accel: 0.8, drift: true, spot: c, state: 'drift', timer: rnd(30, 200), anchored: Math.random() < 0.3, bob: 1,
    });
  }
}
// ---- paddlers, swimmers, kiters, jet skis
function spawnSmall() {
  const kayakZones = [[37.8082, -122.4245, 160, 5], [37.7772, -122.3888, 70, 3], [37.8575, -122.4755, 220, 4], [37.8700, -122.4565, 140, 3], [37.8697, -122.4360, 90, 2], [37.8152, -122.3720, 150, 2], [37.8070, -122.4600, 200, 2], [37.8640, -122.4860, 200, 3]];
  for (const [la, lo, r, n] of kayakZones) {
    const c = P(la, lo);
    for (let i = 0; i < Math.max(1, Math.round(n * density)); i++) {
      const p = randomWaterPoint(c.x, c.z, r, -10, 0.8);
      if (!p) continue;
      const sup = Math.random() < 0.4;
      mk('kayak', { mesh: buildKayak(sup), len: sup ? 3.3 : 4.5, beam: 0.8, cat: 'small', human: true, x: p.x, z: p.z, h: Math.random() * 6.28, maxSpeed: rnd(1.5, 2.8) * KN, turnRate: 0.4, accel: 0.3, zone: { x: c.x, z: c.z, r }, bob: 1 });
    }
  }
  // Aquatic Park swimmers
  const ap = P(37.8083, -122.4248);
  for (let i = 0; i < Math.round(14 * Math.max(0.6, density)); i++) {
    const p = randomWaterPoint(ap.x, ap.z, 170, -8, 0.5);
    if (!p) continue;
    mk('swimmer', { mesh: buildSwimmer(), len: 1.8, beam: 0.6, cat: 'small', human: true, x: p.x, z: p.z, h: Math.random() * 6.28, maxSpeed: rnd(0.8, 1.3) * KN, turnRate: 0.3, accel: 0.2, zone: { x: ap.x, z: ap.z, r: 170 }, bob: 1 });
  }
  // kiteboarders & windsurfers off Crissy Field
  const kz = P(37.8115, -122.4615);
  for (let i = 0; i < Math.round(10 * density); i++) {
    const p = randomWaterPoint(kz.x, kz.z, 650, -40, 2);
    if (!p) continue;
    const k = buildKiter();
    const v = mk('kiter', { mesh: k.group, kite: k.kite, kline: k.line, len: 2, beam: 1, cat: 'small', human: true, x: p.x, z: p.z, h: 0, maxSpeed: rnd(15, 22) * KN, turnRate: 0.8, accel: 1.5, zone: { x: kz.x, z: kz.z, r: 750 }, dir: Math.random() < 0.5 ? 1 : -1, bob: 1 });
    v.speed = v.maxSpeed;
  }
  // jet skis
  for (let i = 0; i < Math.round(6 * density); i++) {
    const c = pick([P(37.8150, -122.4150), P(37.8300, -122.4400), P(37.8500, -122.4650), P(37.8000, -122.3800)]);
    const p = randomWaterPoint(c.x, c.z, 600, -60, 3);
    if (!p) continue;
    mk('jetski', { mesh: buildJetSki(), len: 3.2, beam: 1.2, cat: 'power', x: p.x, z: p.z, h: Math.random() * 6.28, maxSpeed: rnd(25, 40) * KN, turnRate: 0.9, accel: 3, zone: { x: c.x, z: c.z, r: 900 }, obeys: false, bob: 1 });
  }
  // tug & tow
  if (density >= 0.5) spawnTow();
}
export function spawnTow(start = null, path = null) {
  const pts = path || [[37.7930, -122.3550], [37.8100, -122.3780], [37.8350, -122.3880], [37.8700, -122.3800], [37.9150, -122.3750]].map(a => P(...a));
  const s = start || pts[0];
  const tug = mk('tug', { mesh: buildTug(30), len: 30, beam: 10, cat: 'tow', ram: true, x: s.x, z: s.z, h: Math.atan2(pts[1].x - s.x, -(pts[1].z - s.z)), maxSpeed: 7 * KN, speed: 7 * KN, targetSpeed: 7 * KN, turnRate: 0.05, accel: 0.1, name: 'TUG ' + pick(['SAN JOAQUIN', 'DELTA LINDA', 'REVOLUTION', 'SEA EAGLE']), bob: 0.5 });
  tug.setPath(pts.slice(1)); tug.onEnd = 'despawn';
  const barge = mk('barge', { mesh: buildBarge(85), len: 85, beam: 24, cat: 'tow', ram: true, x: s.x - Math.sin(tug.h) * 260, z: s.z + Math.cos(tug.h) * 260, h: tug.h, maxSpeed: 7 * KN, bob: 0.2, follower: tug, hawser: 250 });
  tug.towing = barge;
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3 * 12), 3));
  const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x222222 }));
  line.frustumCulled = false;
  W.scene.add(line); barge.hawserLine = line; barge.extra = [line];
  tug.trail = [];
  return tug;
}
function spawnLaw() {
  const pts = [P(37.8250, -122.4400), P(37.8100, -122.4100), P(37.8400, -122.4600), P(37.8600, -122.4500), P(37.8050, -122.3850)];
  for (const [liv, name] of [['uscg', 'COAST GUARD 45612'], ['police', 'SFPD MARINE 1']]) {
    const p = pick(pts);
    const v = mk('law', { mesh: buildRIB(liv === 'uscg' ? 14 : 11, liv), len: 14, beam: 4.4, cat: 'power', x: p.x, z: p.z, h: 0, maxSpeed: 22 * KN, turnRate: 0.4, accel: 1, name, bob: 1 });
    v.setPath(findPath(p.x, p.z, pick(pts).x, pick(pts).z)); v.onEnd = 'patrol'; v.patrol = pts;
  }
}

// ---------------------------------------------------------------- update
const _c = { x: 0, z: 0 }, _w = { x: 0, z: 0, speed: 0, fromDeg: 0 };
let avoidTick = 0, lodFrame = 0;
export function updateTraffic(dt, player, camPos) {
  const T = TERM();
  avoidTick -= dt;
  const doAvoid = avoidTick <= 0;
  if (doAvoid) avoidTick = 0.4;
  if (density > 0 && !traffic.frozen) {
    traffic.shipTimer -= dt;
    if (traffic.shipTimer <= 0) {
      const shipCount = traffic.vessels.filter(v => v.cat === 'ship' && v.active && !v.scripted).length;
      if (shipCount < 2 + (density > 1 ? 1 : 0)) spawnShip(Math.random() < 0.72 ? 0 : 1, Math.random() < 0.5, 0);
      traffic.shipTimer = rnd(200, 420) / density;
    }
  }
  lodFrame++;
  for (const v of traffic.vessels) {
    if (!v.active) continue;
    // level of detail: vessels > 2.5 km from the camera update every 4th frame with accumulated dt
    let vdt = dt;
    if (!v.scripted) {
      const fx = v.x - camPos.x, fz = v.z - camPos.z;
      if (fx * fx + fz * fz > 2500 * 2500) {
        v._acc = (v._acc || 0) + dt;
        if ((lodFrame + v.id) % 4 !== 0) continue;
        vdt = v._acc;
      }
      v._acc = 0;
    }
    if (v.scripted) { v.script?.(v, vdt, player); }
    else behave(v, vdt, T);
    if (doAvoid && !v.scripted) avoidance(v, player);
    if (!v.manual) move(v, vdt);
    render(v, vdt, camPos);
  }
  // purge inactive
  for (let i = traffic.vessels.length - 1; i >= 0; i--) if (!traffic.vessels[i].active) traffic.vessels.splice(i, 1);
}

function steerTo(v, tx, tz) {
  return Math.atan2(tx - v.x, -(tz - v.z));
}

function behave(v, dt, T) {
  v.timer -= dt;
  v.desH = v.h;
  switch (v.type) {
    case 'ship': case 'tug': followPath(v, dt, 120); break;
    case 'barge': {
      const tug = v.follower;
      if (!tug.active) { v.remove(); return; }
      tug.trail.push({ x: tug.x, z: tug.z });
      if (tug.trail.length > 600) tug.trail.shift();
      // follow the point on the tug's trail ~hawser metres behind
      let acc = 0, tp = tug.trail[0];
      for (let i = tug.trail.length - 1; i > 0; i--) { acc += Math.hypot(tug.trail[i].x - tug.trail[i - 1].x, tug.trail[i].z - tug.trail[i - 1].z); if (acc > v.hawser) { tp = tug.trail[i]; break; } }
      if (tp) {
        const d = Math.hypot(tp.x - v.x, tp.z - v.z);
        v.desH = steerTo(v, tug.x, tug.z); v.targetSpeed = Math.min(tug.speed * 1.2, d > 5 ? tug.speed : tug.speed * 0.5);
        if (Math.hypot(tug.x - v.x, tug.z - v.z) < v.hawser) v.targetSpeed = tug.speed * 0.8;
      }
      break;
    }
    case 'ferry': behaveFerry(v, dt, T); break;
    case 'tour': {
      if (v.state === 'dwell') { v.targetSpeed = 0; if (v.timer <= 0) { v.state = 'go'; traffic.hooks.horn?.(v, 'prolonged'); } break; }
      followPath(v, dt, 60);
      if (v.wp >= v.path.length) { v.setPath([v.loop[v.loopIdx]]); v.loopIdx = (v.loopIdx + 1) % v.loop.length; }
      break;
    }
    case 'sail': behaveSail(v, dt); break;
    case 'power': case 'law': {
      if (v.state === 'loiter') {
        v.targetSpeed = 0;
        if (v.timer <= 0) { if (v.type === 'law') { const p = pick(v.patrol); v.setPath(findPath(v.x, v.z, p.x, p.z)); v.state = 'go'; } else routePower(v); }
        break;
      }
      followPath(v, dt, 40);
      const nw = (v.nwT = (v.nwT || 0) - dt) <= 0 ? (v.nwT = 1, v.inNW = !!noWakeZoneAt(v.x, v.z)) : v.inNW;
      if (v.inNW) v.targetSpeed = Math.min(v.targetSpeed, 5 * KN);
      if (v.wp >= v.path.length) { v.state = 'loiter'; v.timer = rnd(20, 120); }
      break;
    }
    case 'fishing': {
      if (v.anchored) { v.targetSpeed = 0; v.desH = (env.windDirFrom) * D2R; break; }
      if (v.state === 'drift') {
        v.targetSpeed = 0;
        if (v.timer <= 0 || Math.hypot(v.x - v.spot.x, v.z - v.spot.z) > 450) { v.state = 'reposition'; v.setPath([v.spot]); }
      } else {
        followPath(v, dt, 30);
        if (v.wp >= v.path.length) { v.state = 'drift'; v.timer = rnd(60, 240); }
      }
      break;
    }
    case 'kayak': case 'swimmer': {
      if (!v.target || Math.hypot(v.target.x - v.x, v.target.z - v.z) < 10 || v.timer <= 0) {
        v.target = randomWaterPoint(v.zone.x, v.zone.z, v.zone.r, -6, 0.5) || { x: v.zone.x, z: v.zone.z }; v.timer = rnd(40, 200);
      }
      v.desH = steerTo(v, v.target.x, v.target.z); v.targetSpeed = v.maxSpeed;
      break;
    }
    case 'kiter': {
      const wind = baseWindKn(env.clock);
      if (wind < 11) { v.mesh.visible = false; v.targetSpeed = 0; v.noCollide = true; break; }
      v.mesh.visible = true; v.noCollide = false;
      const from = env.windDirFrom * D2R;
      v.desH = from + v.dir * 100 * D2R;
      const d = Math.hypot(v.x - v.zone.x, v.z - v.zone.z);
      const look = { x: v.x + Math.sin(v.h) * 60, z: v.z - Math.cos(v.h) * 60 };
      if ((d > v.zone.r && Math.cos(steerTo(v, v.zone.x, v.zone.z) - v.h) < 0) || sdfAt(look.x, look.z) > -25 || v.timer <= 0) { v.dir *= -1; v.timer = rnd(25, 70); }
      v.targetSpeed = v.maxSpeed;
      break;
    }
    case 'jetski': {
      if (!v.target || Math.hypot(v.target.x - v.x, v.target.z - v.z) < 30) v.target = randomWaterPoint(v.zone.x, v.zone.z, v.zone.r, -60, 3) || { x: v.zone.x, z: v.zone.z };
      v.desH = steerTo(v, v.target.x, v.target.z) + Math.sin(env.time * 0.7 + v.id) * 0.5; v.targetSpeed = v.maxSpeed;
      break;
    }
  }
  // generic land look-ahead safety for wanderers
  if (v.type !== 'ship' && v.type !== 'barge' && v.speed > 0.5) {
    const la = Math.max(25, v.speed * 6);
    const lx = v.x + Math.sin(v.desH) * la, lz = v.z - Math.cos(v.desH) * la;
    if (sdfAt(lx, lz) > -8 && !(v.type === 'ferry' && v.state === 'arrive')) {
      const l2 = { x: v.x + Math.sin(v.desH + 0.8) * la, z: v.z - Math.cos(v.desH + 0.8) * la };
      v.desH += sdfAt(l2.x, l2.z) < sdfAt(lx, lz) ? 0.8 : -0.8;
    }
  }
}

function followPath(v, dt, arriveR) {
  if (v.wp >= v.path.length) {
    if (v.onEnd === 'despawn') { traffic.hooks.left?.(v); v.remove(); }
    else if (v.onEnd === 'patrol') { const p = pick(v.patrol); v.setPath(findPath(v.x, v.z, p.x, p.z)); }
    v.targetSpeed = 0; return;
  }
  const t = v.path[v.wp];
  const d = Math.hypot(t.x - v.x, t.z - v.z);
  if (d < arriveR) { v.wp++; }
  v.desH = steerTo(v, t.x, t.z);
  v.targetSpeed = v.maxSpeed;
}

function behaveFerry(v, dt, T) {
  const term = T[v.route[v.stop]];
  if (v.state === 'dwell') {
    v.targetSpeed = 0;
    if (v.berth) { v.desH = v.berth.h; }
    if (v.timer <= 0) {
      const next = (v.stop + 1) % v.route.length;
      const pth = legPath(v.route[v.stop], v.route[next], T);
      // depart: pull away from the float first
      v.setPath(pth); v.state = 'go'; v.stop = next; v.berth = null;
      traffic.hooks.horn?.(v, 'prolonged');
    }
    return;
  }
  if (v.state === 'go') {
    followPath(v, dt, 70);
    const ap = term.approach, da = Math.hypot(ap.x - v.x, ap.z - v.z);
    if (da < 900) v.targetSpeed = Math.min(v.targetSpeed, Math.max(10 * KN, v.maxSpeed * da / 900));
    if (v.wp >= v.path.length || da < 60) {
      if (term.exit) { v.state = 'exited'; v.timer = rnd(60, 200); v.mesh.visible = false; v.noCollide = true; return; }
      v.berth = term.berths[Math.floor(Math.random() * term.berths.length)];
      v.state = 'arrive';
    }
    return;
  }
  if (v.state === 'arrive') {
    const b = v.berth, d = Math.hypot(b.x - v.x, b.z - v.z);
    v.desH = d > 25 ? steerTo(v, b.x, b.z) : b.h;
    v.targetSpeed = Math.min(v.maxSpeed, Math.max(0.6, d * 0.04)) * (d > 6 ? 1 : 0);
    if (d < 8) { v.state = 'dwell'; v.timer = rnd(60, 150); v.speed *= 0.5; }
    return;
  }
  if (v.state === 'exited') {
    v.targetSpeed = 0;
    if (v.timer <= 0) { // come back in
      v.mesh.visible = true; v.noCollide = false;
      v.x = term.approach.x; v.z = term.approach.z;
      const next = (v.stop + 1) % v.route.length;
      const pth = legPath(v.route[v.stop], v.route[next], T);
      v.h = steerTo(v, pth[0].x, pth[0].z);
      v.setPath(pth); v.stop = next; v.state = 'go'; v.speed = v.maxSpeed;
    }
  }
}

function behaveSail(v, dt) {
  windAt(v.x, v.z, _w);
  const from = _w.fromDeg * D2R;
  if (v.race) {
    const m = v.target;
    if (Math.hypot(m.x - v.x, m.z - v.z) < 45) { v.race.leg = v.race.leg === 'up' ? 'down' : 'up'; v.target = v.race.leg === 'up' ? v.race.wwd : v.race.lwd; }
  } else if (!v.target || Math.hypot(v.target.x - v.x, v.target.z - v.z) < 60 || v.timer <= 0) {
    v.target = randomWaterPoint(v.zone.x, v.zone.z, v.zone.r, -60, 3) || { x: v.zone.x, z: v.zone.z }; v.timer = rnd(120, 400);
  }
  const brg = steerTo(v, v.target.x, v.target.z);
  const twa = norm(brg - from); // angle off the wind (0 = straight into wind)
  const NOGO = 44 * D2R;
  v.tackT -= dt;
  let des;
  if (Math.abs(twa) < NOGO) {
    // beat: hold a tack, switch periodically
    if (v.tackT <= 0) { v.tack *= -1; v.tackT = rnd(40, 140); }
    des = from + v.tack * (NOGO + 4 * D2R);
  } else if (Math.abs(twa) > 160 * D2R && !v.racing) {
    des = from + Math.sign(twa || 1) * 150 * D2R; // avoid dead run (gybe angles)
  } else des = brg;
  // land/shallow: tack away
  const look = { x: v.x + Math.sin(des) * 90, z: v.z - Math.cos(des) * 90 };
  if (sdfAt(look.x, look.z) > -20 || depthAt(look.x, look.z) < 2.5) { v.tack *= -1; v.tackT = rnd(40, 100); des = from + v.tack * (NOGO + 4 * D2R); }
  v.desH = des;
  const a = Math.abs(norm(v.h - from));
  const polar = a < 38 * D2R ? 0.15 : a < 50 * D2R ? 0.72 : a < 130 * D2R ? 1.0 : 0.8;
  const wf = Math.min(1.15, _w.speed / KN / 12);
  v.targetSpeed = v.maxSpeed * polar * wf;
  v.twa = norm(v.h - from);
  v.windKn = _w.speed / KN;
}

// rule-aware reactions to the player and to each other
function avoidance(v, player) {
  v.avoidT -= 0.4;
  if (v.avoidT <= 0) { v.avoidH *= 0.6; v.avoidS = Math.min(1, v.avoidS + 0.2); }
  if (!player || v.human || v.type === 'barge' || v.state === 'dwell' || v.state === 'exited') return;
  const own = vesselInfo(v);
  const pl = { x: player.x, z: player.z, h: player.h, vx: player.vx, vz: player.vz, speed: player.speed, cat: 'power', len: 10.7 };
  const c = cpa(own.x, own.z, own.vx, own.vz, pl.x, pl.z, pl.vx, pl.vz);
  if (c.range > 1800) return;
  if (v.cat === 'ship' || v.type === 'tug') {
    if (c.tcpa > 0 && c.tcpa < 300 && c.dcpa < 180 && Math.abs(relBearing(v.x, v.z, v.h, pl.x, pl.z)) < 50 && v.hornT <= env.time) {
      traffic.hooks.horn?.(v, 'danger'); v.hornT = env.time + 25;
      traffic.hooks.radio?.('shipcall', v);
    }
    return;
  }
  if (c.tcpa <= 0 || c.tcpa > 90) return;
  const safe = 25 + v.len * 0.8;
  if (c.dcpa > safe) return;
  const cls = classify(own, pl);
  const extremis = c.dcpa < 12 && c.tcpa < 8;
  if (cls.role === 'give-way' || cls.role === 'both' || extremis || v.type === 'ferry') {
    if (!v.obeys && !extremis) return;
    v.avoidH = Math.min(0.9, v.avoidH + 0.35);   // alter to starboard
    v.avoidS = cls.situation === 'overtaking' ? 0.6 : 0.75;
    v.avoidT = 6;
    if ((v.type === 'ferry' || v.type === 'tour') && c.dcpa < 40 && c.range < 350 && v.hornT <= env.time) { traffic.hooks.horn?.(v, 'danger'); v.hornT = env.time + 20; }
  }
}

function vesselInfo(v) {
  return { x: v.x, z: v.z, h: v.h, vx: v.vx, vz: v.vz, speed: v.speed, cat: v.cat, isSail: v.isSail, ram: v.ram, fishing: v.fishing, len: v.len, human: v.human, anchored: v.anchored || (v.type === 'fishing' && v.state === 'drift') };
}
export { vesselInfo };

function move(v, dt) {
  const desired = v.desH + v.avoidH;
  const dh = norm(desired - v.h);
  const rate = v.turnRate * (v.cat === 'ship' ? 1 : Math.min(1, 0.35 + v.speed / Math.max(1, v.maxSpeed)));
  v.h = norm(v.h + Math.max(-rate * dt, Math.min(rate * dt, dh)));
  const ts = v.targetSpeed * v.avoidS;
  v.speed += Math.max(-v.accel * dt * 1.5, Math.min(v.accel * dt, ts - v.speed));
  if (v.speed < 0) v.speed = 0;
  currentAt(v.x, v.z, _c);
  const drift = v.anchored ? 0 : 1;
  v.vx = Math.sin(v.h) * v.speed + _c.x * drift;
  v.vz = -Math.cos(v.h) * v.speed + _c.z * drift;
  if (v.state === 'dwell') { v.vx = 0; v.vz = 0; }
  v.x += v.vx * dt; v.z += v.vz * dt;
  if (v.x < BOUNDS.minX - 500 || v.x > BOUNDS.maxX + 500 || v.z < BOUNDS.minZ - 500 || v.z > BOUNDS.maxZ + 500) {
    if (v.type === 'ship' || v.type === 'tug') { traffic.hooks.left?.(v); v.remove(); }
  }
  // wake
  v.foamT -= dt;
  if (v.speed > 1.5 && v.foamT <= 0 && v.mesh.visible) {
    v.foamT = v.len > 100 ? 0.25 : v.speed > 8 ? 0.1 : 0.2;
    const f = v.fwd, s = { x: Math.cos(v.h), z: Math.sin(v.h) };
    const sx = v.x - f.x * v.len * 0.5, sz = v.z - f.z * v.len * 0.5;
    const kn = v.speed / KN;
    const energy = v.speed * v.len * (v.cat === 'ship' ? 0.35 : v.type === 'ferry' ? 1.4 : 1);
    const sz2 = Math.min(8, 0.8 + v.len * 0.03 + kn * 0.06), life = Math.min(70, 6 + v.len * 0.25 + kn);
    for (const side of [-1, 1]) emitFoam(sx + s.x * side * v.beam * 0.4, sz + s.z * side * v.beam * 0.4, s.x * side * v.speed * 0.2, s.z * side * v.speed * 0.2, v._trail ? 0 : sz2, life, energy);
  }
}

function render(v, dt, camPos) {
  const m = v.mesh;
  const dx = v.x - camPos.x, dz = v.z - camPos.z, d2 = dx * dx + dz * dz;
  const dd = W.q ? W.q.drawDist : 14000;
  if (v.state !== 'exited' && !(v.type === 'kiter' && !m.visible)) m.visible = d2 < dd * dd;
  if (!m.visible) return;
  let y = 0, pitch = 0, roll = 0;
  if (d2 < 600 * 600 && v.bob > 0) {
    const f = v.fwd, L = Math.min(v.len * 0.4, 20);
    const hb = waveHeight(v.x + f.x * L, v.z + f.z * L, env.time), hs = waveHeight(v.x - f.x * L, v.z - f.z * L, env.time);
    y = (hb + hs) * 0.5 * v.bob; pitch = Math.atan2(hb - hs, L * 2) * v.bob;
    roll = Math.sin(env.time * 1.3 + v.id) * 0.03 * v.bob;
  }
  if (v.type === 'swimmer') y = Math.min(y, 0.05);
  m.position.set(v.x, y, v.z);
  m.rotation.y = -v.h;
  m.rotation.x = pitch + (v.cat === 'power' && v.speed > 7 ? 0.05 : 0);
  if (v.isSail && v.twa !== undefined) {
    const heel = Math.min(0.42, (v.windKn || 10) / 24 * 0.42) * Math.sin(Math.min(Math.PI / 2, Math.abs(v.twa))) * -Math.sign(v.twa);
    v.heel = (v.heel || 0) + (heel - (v.heel || 0)) * Math.min(1, dt);
    m.rotation.z = v.heel + roll;
    const boom = Math.min(1.2, Math.abs(v.twa) * 0.5) * Math.sign(v.twa);
    if (v.mainPiv) v.mainPiv.rotation.y = boom * 0.9;
  } else if (v.type === 'kiter') {
    const from = env.windDirFrom * D2R;
    const kx = v.x + Math.sin(from + Math.PI) * 18, kz = v.z - Math.cos(from + Math.PI) * 18;
    // kite is a child of the group: place it in local coords downwind & up
    const lx = kx - v.x, lz = kz - v.z;
    const c = Math.cos(v.h), s = Math.sin(v.h);
    const lxl = lx * c + lz * s, lzl = -lx * s + lz * c;
    v.kite.position.set(lxl, 16, lzl); v.kite.lookAt(v.x, 0, v.z);
    const arr = v.kline.geometry.attributes.position.array;
    arr[0] = 0; arr[1] = 1.2; arr[2] = 0; arr[3] = lxl; arr[4] = 16; arr[5] = lzl; v.kline.geometry.attributes.position.needsUpdate = true;
    m.rotation.z = -v.dir * 0.4 + roll;
  } else m.rotation.z = roll + Math.max(-0.12, Math.min(0.12, (v.avoidH || 0) * 0.1));
  if (v.hawserLine) {
    const tug = v.follower, arr = v.hawserLine.geometry.attributes.position.array;
    const ax = tug.x - Math.sin(tug.h) * 14, az = tug.z + Math.cos(tug.h) * 14, bx = v.x + Math.sin(v.h) * 42, bz = v.z - Math.cos(v.h) * 42;
    for (let i = 0; i < 12; i++) { const t = i / 11; arr[i * 3] = ax + (bx - ax) * t; arr[i * 3 + 1] = 2 - Math.sin(t * Math.PI) * 2.6; arr[i * 3 + 2] = az + (bz - az) * t; }
    v.hawserLine.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- nav lights (night)
let lightPts = null, lightRefl = null;
const LMAX = 3000;
export function initLights() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LMAX * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(LMAX * 3), 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uDpr: { value: 1 } },
    vertexShader: `attribute vec3 color; varying vec3 vC; uniform float uDpr;
      #include <common>
    #include <logdepthbuf_pars_vertex>
      void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = clamp(6000.0 / -mv.z, 4.0, 34.0) * uDpr; gl_Position = projectionMatrix*mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vC;
      #include <logdepthbuf_pars_fragment>
      void main(){
      #include <logdepthbuf_fragment>
      float d = length(gl_PointCoord-0.5); if (d>0.5) discard; float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC*a*1.6, a); }`,
  });
  lightPts = new THREE.Points(g, mat); lightPts.frustumCulled = false;
  W.scene.add(lightPts);
  // each nav light's reflection: a shimmering vertical streak where the mirror ray meets the water
  const rmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uDpr: mat.uniforms.uDpr, uTime: { value: 0 } },
    vertexShader: `attribute vec3 color; varying vec3 vC; uniform float uDpr; uniform float uTime;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){ vec3 C = cameraPosition, M = vec3(position.x, -position.y, position.z);
        float t = C.y / max(C.y + position.y, 0.01); vec3 P = C + (M - C) * t; P.y = 0.06;
        vec4 mv = viewMatrix * vec4(P, 1.0);
        vC = color * 0.5 * (0.65 + 0.35 * sin(uTime * 3.1 + position.x * 0.7 + position.z));
        gl_PointSize = clamp(9000.0 / -mv.z, 4.0, 40.0) * uDpr; gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying vec3 vC;
      #include <logdepthbuf_pars_fragment>
      void main(){
      #include <logdepthbuf_fragment>
      vec2 d = gl_PointCoord - 0.5; d.x *= 3.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vC * a, a); }`,
  });
  lightRefl = new THREE.Points(g, rmat); lightRefl.frustumCulled = false; lightRefl.renderOrder = 2;
  W.scene.add(lightRefl);
}
const COL = { w: [1, 0.95, 0.85], r: [1, 0.1, 0.08], g: [0.1, 1, 0.3], y: [1, 0.8, 0.1] };
export function lightsFor(v) {
  // [fwd, up, side, colour, sector]
  const L = v.len, H = Math.max(1.5, Math.min(40, L * 0.18));
  if (v.human) return v.type === 'swimmer' ? [] : [[0, 1.2, 0, 'w', 'all']];
  if (v.isSail) return [[L * 0.45, 1, -L * 0.12, 'r', 'port'], [L * 0.45, 1, L * 0.12, 'g', 'stbd'], [-L * 0.5, 1, 0, 'w', 'stern']];
  if (v.anchored || v.special) return [[0, H, 0, 'w', 'all']];
  const base = [[L * 0.3, H, 0, 'w', 'mast'], [L * 0.2, H * 0.6, -v.beam * 0.5, 'r', 'port'], [L * 0.2, H * 0.6, v.beam * 0.5, 'g', 'stbd'], [-L * 0.5, H * 0.4, 0, 'w', 'stern']];
  if (v.cat === 'ship') base.push([-L * 0.3, H * 1.3, 0, 'w', 'mast']);
  if (v.type === 'tug' && v.towing) base.push([L * 0.3, H + 1.5, 0, 'w', 'mast'], [L * 0.3, H + 3, 0, 'w', 'mast'], [-L * 0.5, H * 0.4 + 1.2, 0, 'y', 'stern']);
  if (v.type === 'fishing' && !v.anchored) base.push([0, H + 2, 0, 'g', 'all']);
  return base;
}
export function updateLights(camPos, show, extra = []) {
  if (!lightPts) return;
  lightPts.visible = show; if (lightRefl) { lightRefl.visible = show; lightRefl.material.uniforms.uTime.value = env.time; }
  if (!show) return;
  lightPts.material.uniforms.uDpr.value = W.dpr || 1;
  const pos = lightPts.geometry.attributes.position.array, col = lightPts.geometry.attributes.color.array;
  let n = 0;
  const all = [...traffic.vessels, ...extra];
  for (const v of all) {
    if (!v.active || (v.mesh && !v.mesh.visible)) continue;
    const dx = v.x - camPos.x, dz = v.z - camPos.z;
    if (dx * dx + dz * dz > 9000 * 9000) continue;
    const rb = relBearing(v.x, v.z, v.h, camPos.x, camPos.z);
    const lights = v._lights || (v._lights = lightsFor(v));
    const f = { x: Math.sin(v.h), z: -Math.cos(v.h) }, s = { x: Math.cos(v.h), z: Math.sin(v.h) };
    for (const [a, up, b, c, sec] of lights) {
      let vis = sec === 'all' || (sec === 'mast' && Math.abs(rb) <= 112.5) || (sec === 'stern' && Math.abs(rb) >= 112.5) || (sec === 'port' && rb <= 0 && rb >= -112.5) || (sec === 'stbd' && rb >= 0 && rb <= 112.5);
      if (!vis || n >= LMAX) continue;
      pos[n * 3] = v.x + f.x * a + s.x * b; pos[n * 3 + 1] = up + (v.mesh ? v.mesh.position.y : 0); pos[n * 3 + 2] = v.z + f.z * a + s.z * b;
      const cc = COL[c]; col[n * 3] = cc[0]; col[n * 3 + 1] = cc[1]; col[n * 3 + 2] = cc[2];
      n++;
    }
  }
  lightPts.geometry.setDrawRange(0, n);
  lightPts.geometry.attributes.position.needsUpdate = true;
  lightPts.geometry.attributes.color.needsUpdate = true;
}

// helper for scenarios
export function makeScripted(type, opts) {
  let mesh, extra = {};
  if (type === 'sail') { const sb = buildSailboat(opts.len || 10); mesh = sb.group; extra = { rig: sb.rig, mainPiv: sb.mainPiv, isSail: true, cat: 'sail' }; }
  else if (type === 'ship') mesh = buildContainerShip(opts.len || 290);
  else if (type === 'ferry') mesh = buildFerryCat(opts.len || 40, opts.livery || 'gg');
  else if (type === 'fishing') mesh = buildFishing(opts.len || 12);
  else if (type === 'kayak') mesh = buildKayak(false);
  else if (type === 'swimmer') mesh = buildSwimmer();
  else mesh = buildPowerboat(opts.len || 10, opts.style || 'cc');
  const v = mk(type === 'sail' ? 'sail' : type, { mesh, scripted: true, beam: (opts.len || 10) * 0.33, ...extra, ...opts });
  return v;
}
