// The living bay — more going on than on a real Saturday:
//   · a humpback whale (blows, rolls, flukes up, sometimes breaches; curious if you idle nearby, dives if
//     you blast at it; it's solid)
//   · sharks whose fins patrol and then circle anyone who ends up in the water
//   · the Escape from Alcatraz swim: a ferry off the island, swimmers jumping in, a stream of swimmers
//     to the Marina, paddleboard/kayak escorts and safety RIBs
//   · banner planes towing MONACO.COM along the city front
//   · a sea-lion colony on Pier 39's K-dock (barking, flopping, sliding in when you roar past)
//   · brown pelicans gliding in lines and plunge-diving, gulls hovering over your wake,
//     dolphins that come bow-ride, porpoises off the Gate
// Everything also publishes points of interest so the crew notices and reacts.
import * as THREE from 'three';
import { ll, sdfAt, toLL } from './geo.js';
import { env, waveHeight, windAt, currentAt, KN } from './env.js';
import { W, emitFoam } from './world.js';
import { GB, MAT, buildFerryMono, buildKayak, buildRIB, buildSwimmer } from './models.js';
import { traffic, Vessel } from './traffic.js';
import { SEA_LIONS } from './docks.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const life = { pois: [], solid: [], on: false };
let built = false;

// ---------------------------------------------------------------- spray / splash sprites (shared)
let splashTex = null; const sprays = [];
function spray(x, y, z, n, size, up, life0 = 1.6, color = 0xffffff) {
  if (!splashTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.5, 'rgba(240,248,250,0.5)'); gr.addColorStop(1, 'rgba(240,248,250,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); splashTex = new THREE.CanvasTexture(c);
  }
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: splashTex, color, transparent: true, depthWrite: false }));
    s.position.set(x + rnd(-1, 1) * size * 0.3, y, z + rnd(-1, 1) * size * 0.3);
    s.userData = { v: new THREE.Vector3(rnd(-1, 1) * up * 0.35, rnd(0.6, 1) * up, rnd(-1, 1) * up * 0.35), t: 0, life: life0 * rnd(0.7, 1.2), s: size * rnd(0.6, 1.2) };
    W.scene.add(s); sprays.push(s);
  }
}
function updateSprays(dt) {
  for (const s of sprays) {
    const u = s.userData; u.t += dt; u.v.y -= 9.8 * dt * 0.55; s.position.addScaledVector(u.v, dt);
    const k = u.t / u.life; s.scale.setScalar(u.s * (0.6 + k)); s.material.opacity = Math.max(0, 0.9 * (1 - k));
  }
  for (let i = sprays.length - 1; i >= 0; i--) if (sprays[i].userData.t > sprays[i].userData.life) { W.scene.remove(sprays[i]); sprays[i].material.dispose(); sprays.splice(i, 1); }
}

// ---------------------------------------------------------------- humpback whale
function buildWhale() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const gb = new GB(), DK = '#2a3036', BEL = '#cfd5d8';
  gb.sphere(1, DK, 0, 0, 0, 1.9, 1.55, 6.2);                 // body (bow −Z)
  gb.sphere(1, BEL, 0, -0.55, -1.2, 1.5, 1.05, 4.6);          // pale throat grooves / belly
  gb.sphere(1, DK, 0, 0.45, -4.6, 1.3, 0.8, 2.0);             // head ridge
  for (let k = 0; k < 6; k++) gb.sphere(0.12, '#3a4046', rnd(-0.6, 0.6), 1.1, -5.4 + k * 0.5);   // tubercles
  gb.sphere(1, DK, 0, 1.25, 2.4, 0.18, 0.4, 0.7);             // small dorsal hump
  gb.sphere(1, DK, 0, 0.1, 5.6, 0.9, 0.75, 2.4);              // tail stock
  body.add(gb.mesh());
  const pec = new GB();
  for (const s of [-1, 1]) { pec.box(4.6, 0.18, 1.0, BEL, s * 3.6, -0.6, -2.6, s * 0.35, 0, s * -0.35); }   // the long white pectoral fins
  body.add(pec.mesh());
  const fl = new THREE.Group(); fl.position.set(0, 0.1, 7.6); body.add(fl);
  const fg = new GB();
  fg.quad([0, 0, 0], [-2.6, 0, 1.3], [-2.3, 0, 2.0], [0, 0, 1.2], DK); fg.quad([0, 0, 0], [0, 0, 1.2], [2.3, 0, 2.0], [2.6, 0, 1.3], DK);
  fg.quad([0, -0.06, 0], [0, -0.06, 1.2], [-2.3, -0.06, 2.0], [-2.6, -0.06, 1.3], '#e8eaec'); fg.quad([0, -0.06, 0], [2.6, -0.06, 1.3], [2.3, -0.06, 2.0], [0, -0.06, 1.2], '#e8eaec');
  fl.add(new THREE.Mesh(fg.build(), MAT.vcDouble));
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, body, fl };
}
const whale = { st: 'deep', t: 0, x: 0, z: 0, h: 0, y: -9, pitch: 0, roll: 0, v: 2, blows: 0, mesh: null };
life.whale = whale; life.planes = null;
function whaleInit() {
  const m = buildWhale(); m.root.scale.setScalar(1.5); whale.mesh = m; W.scene.add(m.root);   // a big one: ~19 m
  const p = ll(37.8225, -122.4440); whale.x = p.x; whale.z = p.z; whale.h = rnd(0, 6.28); whale.st = 'deep'; whale.t = rnd(4, 10);
  life.solid.push(whale.solid = { active: true, x: 0, z: 0, h: 0, len: 21, beam: 6, vx: 0, vz: 0, name: 'a humpback whale', whale: true, noCollide: true });
}
function whaleUpdate(dt, player) {
  const w = whale, m = w.mesh;
  w.t -= dt;
  const dP = Math.hypot(player.x - w.x, player.z - w.z), pk = player.sogKn;
  // steering: wander deep water; come over to an idling boat; leave a fast one alone
  let want = w.h + Math.sin(env.time * 0.05) * 0.3;
  if (dP < 400 && pk < 6) want = Math.atan2(player.x - w.x, -(player.z - w.z)) + 0.9;      // circle the boat
  if (dP < 140 && pk > 14 && w.st !== 'deep') { w.st = 'dive'; w.t = 5; }                 // spooked
  const ahead = { x: w.x + Math.sin(w.h) * 90, z: w.z - Math.cos(w.h) * 90 };
  if (sdfAt(ahead.x, ahead.z) > -60) want = w.h + 1.2;
  w.h += clamp(norm(want - w.h), -0.15 * dt, 0.15 * dt);
  const sp = w.st === 'deep' ? 2.4 : 1.6;
  const c = currentAt(w.x, w.z);
  w.x += (Math.sin(w.h) * sp + c.x * 0.5) * dt; w.z += (-Math.cos(w.h) * sp + c.z * 0.5) * dt;
  const wy = waveHeight(w.x, w.z, env.time);
  let ty = -9, tp = 0, fluke = 0;
  switch (w.st) {
    case 'deep': if (w.t <= 0) { if (Math.random() < 0.22) { w.st = 'breach'; w.t = 0; w.vy = 17.5; w.y = -8; spray(w.x, 0, w.z, 4, 6, 4); } else { w.st = 'rise'; w.t = 3; w.blows = 3 + Math.floor(rnd(0, 3)); } } break;
    case 'rise': ty = -0.6; tp = 0.12; if (w.t <= 0) { w.st = 'blow'; w.t = rnd(5, 8); blow(w); } break;
    case 'blow': ty = -0.55 + Math.sin(w.t * 0.8) * 0.15; tp = -0.05 + Math.sin(w.t * 0.9) * 0.08; if (w.t <= 0) { if (--w.blows > 0) { w.st = 'roll'; w.t = 4; } else { w.st = 'dive'; w.t = 6; } } break;
    case 'roll': ty = -1.4; tp = -0.25; if (w.t <= 0) { w.st = 'rise'; w.t = 3; } break;
    case 'dive': ty = -11; tp = -0.55; fluke = clamp(1 - w.t / 6, 0, 1); if (w.t <= 0) { w.st = 'deep'; w.t = rnd(25, 60); } break;
    case 'breach': {
      // ballistic leap: 2/3 of the body clears the water, rotates onto its side, crashes back
      w.vy -= 9.81 * dt; w.y += w.vy * dt; w.roll = Math.min(1.5, (w.roll || 0) + dt * 0.8);
      tp = clamp(0.2 + w.vy * 0.09, -0.6, 1.25);
      if (w.vy < 0 && w.y < -1 && !w.splashed) { w.splashed = true; spray(w.x, 0.5, w.z, 26, 14, 14, 2.4); for (let k = 0; k < 30; k++) emitFoam(w.x + rnd(-8, 8), w.z + rnd(-8, 8), rnd(-3, 3), rnd(-3, 3), rnd(3, 6), rnd(10, 25), 60); life.onBreach?.(w); }
      if (w.y < -10) { w.st = 'deep'; w.t = rnd(20, 50); w.roll = 0; w.splashed = false; }
      break;
    }
  }
  if (w.st !== 'breach') { w.y += (ty + wy - w.y) * Math.min(1, dt * 0.8); w.roll += (0 - w.roll) * Math.min(1, dt); }
  w.pitch += (tp - w.pitch) * Math.min(1, dt * 1.2);
  m.root.position.set(w.x, w.y, w.z); m.root.rotation.set(w.pitch, -w.h, w.roll, 'YXZ');
  m.fl.rotation.x = -fluke * 1.1 + Math.sin(env.time * 0.8) * 0.15;
  m.root.visible = w.y > -12;
  w.blowT = (w.blowT || 0) - dt;
  const s = w.solid; s.x = w.x; s.z = w.z; s.h = w.h; s.noCollide = w.y < -3; s.active = true;
  if (w.y > -2.5) life.pois.push({ id: 'whale', name: 'a humpback whale', x: w.x, z: w.z, y: Math.max(1, w.y + 2), sal: w.st === 'breach' ? 12 : 7, kind: 'animal' });
}
function blow(w) {
  // the spout: a tall plume of mist at the blowhole, drifting downwind
  const f = { x: Math.sin(w.h), z: -Math.cos(w.h) };
  spray(w.x + f.x * 3.5, 1.5, w.z + f.z * 3.5, 14, 2.4, 7.5, 2.8, 0xf4f7f8);
  life.onBlow?.(w);
}

// ---------------------------------------------------------------- sharks
function buildFin() {
  const gb = new GB();
  gb.tri([0, 0, -0.3], [0, 0.65, 0.25], [0, 0, 0.45], '#454c52');
  gb.tri([0, 0, 2.2], [0, 0.32, 2.55], [0, 0, 2.6], '#454c52');                       // tail tip
  gb.sphere(1, '#3a4248', 0, -0.35, 1.0, 0.45, 0.3, 1.8);                              // body just under the surface
  return new THREE.Mesh(gb.build(), MAT.vcDouble);
}
const sharks = [];
function sharksInit() {
  const homes = [[37.8240, -122.4280], [37.8150, -122.4600], [37.8320, -122.4500]];
  for (const [la, lo] of homes) { const p = ll(la, lo); const m = buildFin(); W.scene.add(m); sharks.push({ m, x: p.x + rnd(-80, 80), z: p.z + rnd(-80, 80), h: rnd(0, 6.28), hx: p.x, hz: p.z, ph: rnd(0, 6), target: null }); }
}
function sharksUpdate(dt) {
  // anything human in the water within 350 m draws them in to circle it
  const people = traffic.vessels.filter(v => v.active && v.human && v.type !== 'kiter' && v.type !== 'kayak');
  for (const s of sharks) {
    let tgt = null, bd = 350;
    for (const v of people) { const d = Math.hypot(v.x - s.x, v.z - s.z); if (d < bd) { bd = d; tgt = v; } }
    let want;
    if (tgt) { const a = Math.atan2(s.x - tgt.x, -(s.z - tgt.z)); const R = 9 + Math.sin(s.ph) * 2; const cx = tgt.x + Math.sin(a + 0.35) * R, cz = tgt.z - Math.cos(a + 0.35) * R; want = Math.atan2(cx - s.x, -(cz - s.z)); s.v = bd > 40 ? 2.6 : 1.8; }
    else { const d = Math.hypot(s.hx - s.x, s.hz - s.z); want = d > 250 ? Math.atan2(s.hx - s.x, -(s.hz - s.z)) : s.h + Math.sin(env.time * 0.3 + s.ph) * 0.8; s.v = 1.2; }
    s.h += clamp(norm(want - s.h), -1.2 * dt, 1.2 * dt);
    s.x += Math.sin(s.h) * s.v * dt; s.z -= Math.cos(s.h) * s.v * dt;
    s.ph += dt * 2.2;
    const wy = waveHeight(s.x, s.z, env.time);
    s.m.position.set(s.x, wy - 0.05, s.z); s.m.rotation.set(0, -s.h + Math.sin(s.ph) * 0.12, 0);
    s.m.visible = true;
    life.pois.push({ id: 'shark' + sharks.indexOf(s), name: 'a shark', x: s.x, z: s.z, y: 0.5, sal: tgt ? 6 : 3.5, kind: 'animal', scary: true });
  }
}

// ---------------------------------------------------------------- Escape from Alcatraz swim
const race = { on: false, ferry: null, jumpT: 0, start: null, finish: null, swimmers: [], escorts: [] };
function raceStart() {
  race.start = ll(37.8236, -122.4192); race.finish = ll(37.8078, -122.4452);
  const f = buildFerryMono(40, 'rw');
  const fv = new Vessel({ type: 'ferry', mesh: f, len: 40, beam: 11, cat: 'power', ram: true, x: race.start.x, z: race.start.z, h: 250 * Math.PI / 180, scripted: true, anchored: true, name: 'RACE START FERRY', maxSpeed: 0, bob: 0.4 });
  fv.script = (v) => { v.speed = 0; v.targetSpeed = 0; }; traffic.vessels.push(fv); race.ferry = fv;
  race.on = true; race.jumpT = 0;
  // the field already strung out along the course
  for (let i = 0; i < 70; i++) addSwimmer(Math.pow(Math.random(), 0.8));
  // paddleboard & kayak escorts on both flanks, two safety RIBs
  for (let i = 0; i < 12; i++) {
    const sup = Math.random() < 0.6;
    const ev = new Vessel({ type: 'kayak', mesh: buildKayak(sup), len: sup ? 3.3 : 4.5, beam: 0.8, cat: 'small', human: true, x: 0, z: 0, h: 0, scripted: true, maxSpeed: 1.4, name: sup ? 'Race paddleboarder' : 'Race kayak', bob: 1 });
    ev.k = Math.random(); ev.side = i % 2 ? 1 : -1; ev.off = rnd(60, 140);
    placeOnCourse(ev, ev.k, ev.side * ev.off);
    ev.script = (v, dt) => escortScript(v, dt); traffic.vessels.push(ev); race.escorts.push(ev);
  }
  for (let i = 0; i < 2; i++) {
    const rv = new Vessel({ type: 'law', mesh: buildRIB(8, 'uscg'), len: 8, beam: 3, cat: 'power', x: 0, z: 0, h: 0, scripted: true, maxSpeed: 4, name: 'RACE SAFETY ' + (i + 1), bob: 1 });
    rv.k = 0.3 + i * 0.4; rv.side = i ? 1 : -1; rv.off = 180; placeOnCourse(rv, rv.k, rv.side * rv.off);
    rv.script = (v, dt) => escortScript(v, dt); traffic.vessels.push(rv); race.escorts.push(rv);
  }
}
function coursePt(k, lat = 0) {
  const s = race.start, f = race.finish, dx = f.x - s.x, dz = f.z - s.z, L = Math.hypot(dx, dz);
  // the real line bows east of a straight line: swimmers aim up-current
  const bow = Math.sin(k * Math.PI) * 220;
  const px = -dz / L, pz = dx / L;
  return { x: s.x + dx * k + px * (bow + lat), z: s.z + dz * k + pz * (bow + lat), h: Math.atan2(dx, -dz) };
}
function placeOnCourse(v, k, lat) { const p = coursePt(k, lat); v.x = p.x; v.z = p.z; v.h = p.h; v.mesh.position.set(p.x, 0, p.z); }
function addSwimmer(k, lat = rnd(-110, 110)) {
  const v = new Vessel({ type: 'swimmer', mesh: buildSwimmer(), len: 1.8, beam: 0.6, cat: 'small', human: true, x: 0, z: 0, h: 0, scripted: true, maxSpeed: 1.0, name: 'Alcatraz swimmer', bob: 1 });
  v.k = k; v.lat = lat; v.pace = rnd(0.75, 1.35); placeOnCourse(v, k, lat);
  v.script = (s, dt) => swimScript(s, dt);
  traffic.vessels.push(v); race.swimmers.push(v); return v;
}
function swimScript(v, dt) {
  const L = Math.hypot(race.finish.x - race.start.x, race.finish.z - race.start.z);
  v.k += v.pace * dt / L; v.lat += Math.sin(env.time * 0.2 + v.id) * dt * 0.3;
  if (v.k >= 1) { v.remove(); return; }
  const p = coursePt(v.k, v.lat);
  // swim toward the course point; the current still sets them (move() adds it)
  v.desH = Math.atan2(p.x - v.x, -(p.z - v.z)); v.targetSpeed = v.pace;
  v.mesh.rotation.z = Math.sin(env.time * 4 + v.id) * 0.25;             // stroke roll
}
function escortScript(v, dt) {
  // ride along the flank of the pack
  const ks = race.swimmers.filter(s => s.active).map(s => s.k);
  const mid = ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : 0.5;
  v.k += ((mid + (v.k - mid) * 0.98) - v.k) * dt * 0.05;
  const p = coursePt(clamp(v.k, 0.02, 0.98), v.side * v.off);
  const d = Math.hypot(p.x - v.x, p.z - v.z);
  v.desH = Math.atan2(p.x - v.x, -(p.z - v.z)); v.targetSpeed = d > 8 ? v.maxSpeed : 0.2;
}
// jumpers leaving the ferry: a short ballistic arc, a splash, then they're in the race
const jumpers = [];
function raceUpdate(dt) {
  if (!race.on || !race.ferry?.active) return;
  race.swimmers = race.swimmers.filter(v => v.active);
  race.jumpT -= dt;
  if (race.jumpT <= 0 && race.swimmers.length < 110) {
    race.jumpT = rnd(0.5, 1.6);
    const f = race.ferry, side = { x: Math.cos(f.h), z: Math.sin(f.h) }, fw = { x: Math.sin(f.h), z: -Math.cos(f.h) };
    const along = rnd(-12, 12);
    const m = buildSwimmer(); m.scale.setScalar(1.4);
    m.position.set(f.x + side.x * 5.6 + fw.x * along, 3.2, f.z + side.z * 5.6 + fw.z * along);
    W.scene.add(m); jumpers.push({ m, vx: side.x * 2.2, vz: side.z * 2.2, vy: 2.5, t: 0 });
  }
  for (const j of jumpers) {
    j.t += dt; j.vy -= 9.8 * dt; j.m.position.x += j.vx * dt; j.m.position.y += j.vy * dt; j.m.position.z += j.vz * dt;
    j.m.rotation.x = Math.min(1.4, j.t * 2.5);
    if (j.m.position.y < 0) {
      spray(j.m.position.x, 0.2, j.m.position.z, 4, 1.2, 3, 0.9);
      const s = addSwimmer(0.002, rnd(-20, 20)); s.x = j.m.position.x; s.z = j.m.position.z;
      W.scene.remove(j.m); j.done = true;
    }
  }
  for (let i = jumpers.length - 1; i >= 0; i--) if (jumpers[i].done) jumpers.splice(i, 1);
  const lead = race.swimmers.reduce((a, s) => (s.k > (a?.k || 0) ? s : a), null);
  if (lead) life.pois.push({ id: 'race', name: 'the Escape from Alcatraz swimmers', x: lead.x, z: lead.z, y: 0.3, sal: 2.5, kind: 'event' });
}

// ---------------------------------------------------------------- banner planes (MONACO.COM)
function bannerTex(text) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#d0021b'; g.fillRect(0, 0, 1024, 10); g.fillRect(0, 150, 1024, 10);
  g.fillStyle = '#111111'; g.font = '900 118px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 512, 84);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function buildPlane() {
  const gb = new GB();
  gb.cyl(0.6, 7.5, '#f4f4f4', 0, 0, 0, 10, Math.PI / 2);
  gb.cyl(0.6, 1.2, '#f4f4f4', 0, 0, -4.3, 10, -Math.PI / 2, 0, 0, 0.25);
  gb.box(11, 0.12, 1.5, '#f4f4f4', 0, 0.75, -0.6); gb.box(11.05, 0.13, 0.3, '#c0392b', 0, 0.76, -1.2);
  gb.box(3.4, 0.08, 0.9, '#f4f4f4', 0, 0.1, 3.4); gb.box(0.08, 1.4, 1.0, '#c0392b', 0, 0.7, 3.4);
  gb.box(0.06, 1.7, 0.12, '#222', 0, 0, -4.95);                           // prop blur
  gb.box(1.3, 0.5, 1.4, '#3b5b7a', 0, 0.55, -1.5);                         // cabin glass
  return gb.mesh();
}
const planes = []; life.planes = planes;
function planesInit() {
  const routes = [
    { c: ll(37.8085, -122.4300), rx: 1600, rz: 600, alt: 170, rot: 0.15, sp: 40 },
    { c: ll(37.8420, -122.4380), rx: 1400, rz: 900, alt: 210, rot: -0.4, sp: 38 },
  ];
  for (const r of routes) {
    const m = buildPlane(); W.scene.add(m);
    const tex = bannerTex('MONACO.COM');
    const geo = new THREE.PlaneGeometry(44, 6.8, 32, 1);
    const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.FrontSide, roughness: 0.8 }));
    const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.FrontSide, roughness: 0.8 })); back.rotation.y = Math.PI;
    const banner = new THREE.Group(); banner.add(front); banner.add(back); W.scene.add(banner);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x333333 })); line.frustumCulled = false; W.scene.add(line);
    planes.push({ m, banner, geo, base: geo.attributes.position.array.slice(), line, r, a: rnd(0, 6.28), trail: [] });
  }
}
const _pp = new THREE.Vector3(), _pq = new THREE.Vector3();
function planesUpdate(dt, player) {
  for (const p of planes) {
    const r = p.r;
    // the circuit drifts over to wherever you are, so the ad is always somewhere in your sky
    const dc = Math.hypot(r.c.x - player.x, r.c.z - player.z);
    if (dc > 1800) { r.c.x += (player.x - r.c.x) * dt * 0.01; r.c.z += (player.z - r.c.z) * dt * 0.01; } p.a += dt * r.sp / ((r.rx + r.rz) * 0.5);
    const lx = Math.cos(p.a) * r.rx, lz = Math.sin(p.a) * r.rz, c = Math.cos(r.rot), s = Math.sin(r.rot);
    const x = r.c.x + lx * c - lz * s, z = r.c.z + lx * s + lz * c, y = r.alt + Math.sin(p.a * 2) * 15;
    const prev = p.m.position.clone();
    p.m.position.set(x, y, z);
    if (prev.lengthSq() > 0) { const d = _pp.subVectors(p.m.position, prev); const h = Math.atan2(d.x, -d.z); p.m.rotation.set(0, -h, 0.35, 'YXZ'); }
    // banner trails ~70 m behind along the flight path
    p.trail.unshift(p.m.position.clone()); if (p.trail.length > 240) p.trail.pop();
    let acc = 0, bp = p.trail[p.trail.length - 1], bq = bp;
    for (let i = 1; i < p.trail.length; i++) { acc += p.trail[i].distanceTo(p.trail[i - 1]); if (acc > 55) { bp = p.trail[i]; bq = p.trail[Math.min(p.trail.length - 1, i + 6)]; break; } }
    const bdir = _pq.subVectors(bp, bq); const bh = Math.atan2(bdir.x, -bdir.z);
    p.banner.position.copy(bp).add(new THREE.Vector3(Math.sin(bh) * -22, -3, -Math.cos(bh) * -22));
    p.banner.rotation.set(0, -bh + Math.PI / 2, 0);
    // flutter: a travelling wave down the banner
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) { const u = (p.base[i] + 22) / 44; a[i + 2] = Math.sin(u * 9 - env.time * 9) * 0.6 * u; }
    p.geo.attributes.position.needsUpdate = true;
    const la = p.line.geometry.attributes.position.array; la.set([x, y - 0.5, z, bp.x, bp.y - 1, bp.z]); p.line.geometry.attributes.position.needsUpdate = true;
    life.pois.push({ id: 'plane' + planes.indexOf(p), name: 'the MONACO.COM banner plane', x, z, y, sal: 2.2, kind: 'plane' });
  }
}

// ---------------------------------------------------------------- sea lions (Pier 39 K-dock)
function buildSeaLion2() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const gb = new GB(), C = pick(['#6d4c33', '#5d4037', '#7a5a3a', '#4e3426']);
  gb.sphere(1, C, 0, 0.28, 0.1, 0.42, 0.32, 1.05);
  gb.sphere(1, C, 0, 0.22, 0.95, 0.25, 0.18, 0.4);
  for (const s of [-1, 1]) gb.box(0.4, 0.05, 0.22, '#3e2a1c', s * 0.4, 0.06, -0.15, 0, 0, s * 0.4);   // fore flippers
  gb.box(0.45, 0.05, 0.2, '#3e2a1c', 0, 0.06, 1.25);                                                 // hind flippers
  body.add(gb.mesh());
  const head = new THREE.Group(); head.position.set(0, 0.45, -0.85); body.add(head);
  const hb = new GB(); hb.sphere(0.2, C, 0, 0, 0, 1, 1, 1.15); hb.sphere(0.1, '#3e2a1c', 0, -0.03, -0.2, 0.9, 0.8, 1.2); hb.box(0.05, 0.03, 0.02, '#111', 0, 0.06, -0.19);
  head.add(hb.mesh());
  return { g, body, head };
}
const lions = [];
function lionsInit() {
  for (const p of SEA_LIONS) for (let k = 0; k < 3; k++) {
    const m = buildSeaLion2(); W.scene.add(m.g);
    const L = { m, x: p.x + rnd(-1.5, 1.5), z: p.z + rnd(-1.2, 1.2), hx: p.x, hz: p.z, h: rnd(0, 6.28), st: 'bask', t: rnd(2, 15), ph: rnd(0, 6) };
    lions.push(L);
  }
}
function lionsUpdate(dt, player) {
  const near = Math.hypot(player.x - (lions[0]?.hx || 0), player.z - (lions[0]?.hz || 0));
  const roar = near < 70 && player.sogKn > 7;
  for (const L of lions) {
    L.t -= dt; L.ph += dt;
    if (L.st === 'bask') {
      if (roar && Math.random() < dt * 0.6) { L.st = 'swim'; L.t = rnd(20, 50); L.h = Math.atan2(L.x - player.x, -(L.z - player.z)); spray(L.x, 0.3, L.z, 2, 0.8, 2, 0.8); }
      else if (L.t <= 0) { L.st = Math.random() < 0.3 ? 'bark' : Math.random() < 0.15 ? 'swim' : 'bask'; L.t = L.st === 'swim' ? rnd(20, 60) : rnd(2, 6); }
      L.m.g.position.set(L.x, 0.42, L.z); L.m.body.rotation.set(0, -L.h, Math.sin(L.ph * 0.4) * 0.05);
      L.m.head.rotation.x = 0.2 + Math.sin(L.ph * 0.3) * 0.1;
    } else if (L.st === 'bark') {
      L.m.head.rotation.x = -0.7 + Math.sin(L.ph * 12) * 0.12; L.m.body.rotation.x = 0.12;
      if (L.t <= 0) { L.st = 'bask'; L.t = rnd(4, 20); }
    } else {      // swimming: porpoising arcs near the pier, then haul back out
      const d = Math.hypot(L.hx - L.x, L.hz - L.z);
      const want = d > 60 || L.t < 5 ? Math.atan2(L.hx - L.x, -(L.hz - L.z)) : L.h + Math.sin(L.ph * 0.5) * 0.6;
      L.h += clamp(norm(want - L.h), -1.5 * dt, 1.5 * dt);
      L.x += Math.sin(L.h) * 2 * dt; L.z -= Math.cos(L.h) * 2 * dt;
      const arc = Math.max(0, Math.sin(L.ph * 1.6)) * 0.35 - 0.3;
      L.m.g.position.set(L.x, waveHeight(L.x, L.z, env.time) + arc, L.z); L.m.body.rotation.set(-Math.cos(L.ph * 1.6) * 0.4, -L.h, 0);
      if (L.t <= 0 && d < 4) { L.st = 'bask'; L.t = rnd(10, 40); L.x = L.hx + rnd(-1.5, 1.5); L.z = L.hz + rnd(-1.2, 1.2); }
    }
  }
  if (lions.length) life.pois.push({ id: 'lions', name: 'the sea lions', x: lions[0].hx, z: lions[0].hz, y: 0.5, sal: near < 400 ? 3.5 : 0.5, kind: 'animal' });
}

// ---------------------------------------------------------------- birds: pelicans (lines, plunge-dives) & gulls (over your wake)
function buildBird(kind) {
  const g = new THREE.Group(); const gb = new GB();
  const big = kind === 'pelican', C = big ? '#6b5f55' : '#f2f2f2', WC = big ? '#4a423c' : '#cfd5d8';
  gb.sphere(1, C, 0, 0, 0, big ? 0.22 : 0.12, big ? 0.2 : 0.11, big ? 0.6 : 0.3);
  gb.sphere(1, big ? '#e9e2c9' : '#ffffff', 0, 0.08, big ? -0.62 : -0.3, big ? 0.12 : 0.07, big ? 0.12 : 0.07, big ? 0.14 : 0.08);
  if (big) gb.box(0.07, 0.07, 0.5, '#c9a44a', 0, 0.02, -0.95); else gb.box(0.03, 0.03, 0.1, '#e5b52a', 0, 0.07, -0.4);
  g.add(gb.mesh());
  const span = big ? 1.1 : 0.6;
  const wing = (s) => { const w = new THREE.Group(); const wb = new GB(); wb.box(span, 0.03, big ? 0.38 : 0.2, WC, s * span / 2, 0, 0); if (!big) wb.box(0.12, 0.031, 0.2, '#222', s * span * 0.95, 0, 0); w.add(wb.mesh()); g.add(w); return w; };
  g.userData = { wl: wing(-1), wr: wing(1) };
  return g;
}
const flocks = [], gulls = [];
function birdsInit() {
  for (let f = 0; f < 3; f++) {
    const fl = { birds: [], x: 0, z: 0, h: rnd(0, 6.28), y: 3, t: 0, ph: rnd(0, 6), placed: false };
    const n = 5 + Math.floor(rnd(0, 5));
    for (let i = 0; i < n; i++) { const b = buildBird('pelican'); W.scene.add(b); fl.birds.push({ m: b, dive: 0, vy: 0, y: 0, off: i }); }
    flocks.push(fl);
  }
  for (let i = 0; i < 4; i++) { const b = buildBird('gull'); W.scene.add(b); gulls.push({ m: b, ph: rnd(0, 6), ox: rnd(-6, 6), oz: rnd(14, 28), oy: rnd(5, 9) }); }
}
function birdsUpdate(dt, player) {
  for (const fl of flocks) {
    const d = Math.hypot(fl.x - player.x, fl.z - player.z);
    if (!fl.placed || d > 1500) {        // keep the birds where you are
      const a = rnd(0, 6.28), r = rnd(250, 700); fl.x = player.x + Math.sin(a) * r; fl.z = player.z - Math.cos(a) * r; fl.h = a + Math.PI + rnd(-0.8, 0.8); fl.placed = true;
      if (sdfAt(fl.x, fl.z) > -20) { fl.placed = false; continue; }
    }
    fl.ph += dt; fl.h += Math.sin(fl.ph * 0.15) * 0.05 * dt;
    if (sdfAt(fl.x + Math.sin(fl.h) * 80, fl.z - Math.cos(fl.h) * 80) > -10) fl.h += 1.2 * dt;
    fl.x += Math.sin(fl.h) * 11 * dt; fl.z -= Math.cos(fl.h) * 11 * dt;
    const fx = Math.sin(fl.h), fz = -Math.cos(fl.h), rx = Math.cos(fl.h), rz = Math.sin(fl.h);
    fl.birds.forEach((b, i) => {
      // pelicans fly in a line just above the swell, wingtip to wave
      const back = i * 3.2, side = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.6;
      let x = fl.x - fx * back + rx * side, z = fl.z - fz * back + rz * side;
      let y = Math.max(waveHeight(x, z, env.time) + 1.6, 2.2 + Math.sin(fl.ph * 0.7 + i) * 0.8);
      if (!b.dive && Math.random() < dt * 0.012) { b.dive = 1; b.vy = 0; b.y = y; }
      if (b.dive === 1) { b.vy -= 14 * dt; b.y += b.vy * dt; y = b.y; if (y < 0.1) { spray(x, 0.2, z, 3, 1.3, 3.5, 1); b.dive = 2; b.t = 3; } }
      else if (b.dive === 2) { y = 0.25; b.t -= dt; if (b.t <= 0) b.dive = 0; }
      b.m.position.set(x, y, z); b.m.rotation.set(b.dive === 1 ? -1.3 : 0, -fl.h, 0, 'YXZ');
      const flap = b.dive === 1 ? 0.9 : b.dive === 2 ? 1.2 : Math.max(0, Math.sin(fl.ph * 2.5 + i * 0.5)) * 0.5 * (Math.sin(fl.ph * 0.3 + i) > 0.4 ? 1 : 0.1);
      b.m.userData.wl.rotation.z = flap; b.m.userData.wr.rotation.z = -flap;
    });
    life.pois.push({ id: 'pel' + flocks.indexOf(fl), name: 'the pelicans', x: fl.x, z: fl.z, y: 2, sal: 1.6, kind: 'animal' });
  }
  // gulls hang over your wake when you're moving at a sensible speed (and hope for scraps)
  const f = player.fwd, follow = player.sogKn > 3 && player.sogKn < 24;
  for (const g of gulls) {
    g.ph += dt;
    const tx = player.x - f.x * g.oz + Math.cos(player.h) * g.ox + Math.sin(g.ph * 0.7) * 3, tz = player.z - f.z * g.oz + Math.sin(player.h) * g.ox + Math.cos(g.ph * 0.6) * 3;
    const ty = follow ? g.oy + Math.sin(g.ph) * 0.8 : 60;
    const p = g.m.position; const k = Math.min(1, dt * (follow ? 1.5 : 0.3));
    if (p.lengthSq() === 0) p.set(tx, 60, tz);
    p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; p.z += (tz - p.z) * k;
    g.m.rotation.set(0, -player.h + Math.sin(g.ph * 0.5) * 0.3, Math.sin(g.ph * 0.8) * 0.3, 'YXZ');
    const flap = Math.sin(g.ph * 9) * 0.5 * (Math.sin(g.ph * 0.4) > 0 ? 1 : 0.15);
    g.m.userData.wl.rotation.z = flap; g.m.userData.wr.rotation.z = -flap;
    g.m.visible = p.y < 55;
  }
}

// ---------------------------------------------------------------- dolphins (bow-riding) & porpoises
function buildDolphin(small) {
  const gb = new GB(), C = small ? '#3b4045' : '#6f7880';
  const s = small ? 0.7 : 1;
  gb.sphere(1, C, 0, 0, 0, 0.3 * s, 0.3 * s, 1.1 * s); gb.sphere(1, '#c9ced2', 0, -0.12 * s, -0.2 * s, 0.22 * s, 0.16 * s, 0.8 * s);
  gb.box(0.06 * s, 0.06 * s, 0.35 * s, C, 0, -0.02 * s, -1.25 * s);
  gb.tri([0, 0.2 * s, 0], [0, 0.5 * s, 0.35 * s], [0, 0.2 * s, 0.45 * s], C);
  gb.box(0.7 * s, 0.04 * s, 0.22 * s, C, 0, 0, 1.15 * s);
  return new THREE.Mesh(gb.build(), MAT.vcDouble);
}
const dolphins = { pod: [], st: 'away', t: rnd(30, 70) }, porp = [];
function dolphinsInit() {
  for (let i = 0; i < 3; i++) { const m = buildDolphin(false); m.visible = false; W.scene.add(m); dolphins.pod.push({ m, ph: rnd(0, 6), side: i % 2 ? 1 : -1, off: rnd(1.8, 3.2), back: rnd(-1, 3) }); }
  const gate = ll(37.8150, -122.4720);
  for (let i = 0; i < 4; i++) { const m = buildDolphin(true); W.scene.add(m); porp.push({ m, x: gate.x + rnd(-200, 200), z: gate.z + rnd(-200, 200), h: rnd(0, 6.28), ph: rnd(0, 6), hx: gate.x, hz: gate.z }); }
}
function dolphinsUpdate(dt, player) {
  const D = dolphins; D.t -= dt;
  const kn = player.sogKn, ok = kn > 7 && kn < 22;
  if (D.st === 'away' && D.t <= 0 && ok) { D.st = 'riding'; D.t = rnd(35, 70); life.onDolphins?.(); }
  else if (D.st === 'riding' && (D.t <= 0 || !ok)) { D.st = 'away'; D.t = rnd(60, 160); }
  const f = player.fwd, r = player.right;
  for (const d of D.pod) {
    d.ph += dt * (2.2 + kn * 0.05);
    if (D.st !== 'riding') { d.m.visible = false; continue; }
    d.m.visible = true;
    const fwd = 5.5 + d.back + Math.sin(d.ph * 0.3) * 1.5, lat = d.side * (d.off + Math.sin(d.ph * 0.4) * 0.5);
    const x = player.x + f.x * fwd + r.x * lat, z = player.z + f.z * fwd + r.z * lat;
    const arc = Math.sin(d.ph);
    d.m.position.set(x, waveHeight(x, z, env.time) - 0.45 + Math.max(0, arc) * 0.9, z);
    d.m.rotation.set(-Math.cos(d.ph) * 0.55, -player.h, d.side * 0.1, 'YXZ');
    if (arc > 0.95 && Math.random() < 0.2) spray(x, 0.2, z, 1, 0.6, 1.6, 0.6);
  }
  if (D.st === 'riding') life.pois.push({ id: 'dolphins', name: 'the dolphins', x: player.x + f.x * 6, z: player.z + f.z * 6, y: 0, sal: 8, kind: 'animal' });
  for (const p of porp) {
    p.ph += dt * 1.4;
    const d = Math.hypot(p.hx - p.x, p.hz - p.z);
    const want = d > 300 ? Math.atan2(p.hx - p.x, -(p.hz - p.z)) : p.h + Math.sin(p.ph * 0.2) * 0.5;
    p.h += clamp(norm(want - p.h), -0.6 * dt, 0.6 * dt);
    p.x += Math.sin(p.h) * 2.5 * dt; p.z -= Math.cos(p.h) * 2.5 * dt;
    const arc = Math.sin(p.ph);
    p.m.position.set(p.x, waveHeight(p.x, p.z, env.time) - 0.35 + Math.max(0, arc) * 0.4, p.z);
    p.m.rotation.set(-Math.cos(p.ph) * 0.5, -p.h, 0, 'YXZ');
    p.m.visible = arc > -0.3;
  }
  if (porp.length) life.pois.push({ id: 'porp', name: 'the porpoises', x: porp[0].x, z: porp[0].z, y: 0, sal: 2.6, kind: 'animal' });
}

// ---------------------------------------------------------------- lifecycle
export function startLife(opts = {}) {
  if (!built) { whaleInit(); sharksInit(); planesInit(); lionsInit(); birdsInit(); dolphinsInit(); built = true; }
  life.on = true;
  race.on = false; race.swimmers = []; race.escorts = [];
  for (const j of jumpers) W.scene.remove(j.m); jumpers.length = 0;
  // the swim runs in daylight on clear-ish days (traffic was respawned, so build it fresh)
  if (opts.race && env.clock > 7 && env.clock < 17 && env.fog < 0.5) raceStart();
  const night = env.clock < 6.8 || env.clock > 19.6;
  for (const p of planes) { p.m.visible = !night; p.banner.visible = !night; p.line.visible = !night; }
}
export function updateLife(dt, player) {
  if (!life.on || dt <= 0) return;
  life.pois.length = 0;
  whaleUpdate(dt, player);
  sharksUpdate(dt);
  raceUpdate(dt);
  if (planes[0]?.m.visible) planesUpdate(dt, player);
  lionsUpdate(dt, player);
  birdsUpdate(dt, player);
  dolphinsUpdate(dt, player);
  updateSprays(dt);
}
