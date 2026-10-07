// Player boat: Protector 33 Targa RIB (NZ-built rigid inflatable with a targa hardtop), twin Mercury
// Verado 350s, ~50 kn top end. LOA 10.3 m, beam 3.25 m over the tubes, ~5.8 t loaded.
// 3-DOF planar physics (surge, sway, yaw) + visual heave/pitch/roll.
import * as THREE from 'three';
import { buildPlayerBoat } from './models.js';
import { currentAt, windAt, chopAt, waveHeight, tideHeight, env, KN } from './env.js';
import { sdfAt, sdfGrad, depthAt } from './geo.js';
import { structsNear, circleOBB } from './docks.js';
import { emitFoam } from './world.js';

const D2R = Math.PI / 180;
// ---- Mass properties: hull ~3.7 t + 2 × 290 kg Verados + ~650 L fuel + 4 crew ≈ 5.8 t (12,800 lb)
const MASS = 5800, L_HULL = 10.3, B_HULL = 3.25, DRAFT = 0.6;
const IZZ = MASS * (0.27 * L_HULL) ** 2;                 // yaw inertia, radius of gyration ~0.27 L
// Added mass. Structure & surge/yaw values follow Fossen (PythonVehicleSimulator otter.py: Xu̇=-0.1m, Nṙ=-1.7Iz).
// Sway uses strip theory for a shallow-draft planing hull (ρπT²L ≈ 0.7–1.1 m) instead of otter's
// catamaran value (-1.5m), which would make a monohull directionally unstable at speed.
const XUD = -0.1 * MASS, YVD = -0.75 * MASS, NRD = -1.2 * IZZ;
const M11 = MASS - XUD, M22 = MASS - YVD, M33 = IZZ - NRD;
const RHO = 1026, RHO_AIR = 1.225;
// Hoerner 2-D cross-flow drag coefficient vs B/(2T) (Fossen gnc.py)
const HOER_X = [0.0109, 0.1766, 0.3530, 0.4519, 0.4728, 0.4929, 0.4933, 0.5585, 0.6464, 0.8336, 0.9880, 1.3081, 1.6392, 1.8600, 2.3129, 2.6000, 3.0088, 3.4508, 3.7379, 4.0031];
const HOER_Y = [1.9661, 1.9657, 1.8976, 1.7872, 1.5837, 1.2786, 1.2108, 1.0836, 0.9986, 0.8796, 0.8284, 0.7599, 0.6914, 0.6571, 0.6307, 0.5962, 0.5868, 0.5859, 0.5599, 0.5593];
function hoerner(BT2) { if (BT2 <= HOER_X[0]) return HOER_Y[0]; for (let i = 0; i + 1 < HOER_X.length; i++) if (BT2 <= HOER_X[i + 1]) return HOER_Y[i] + (HOER_Y[i + 1] - HOER_Y[i]) * (BT2 - HOER_X[i]) / (HOER_X[i + 1] - HOER_X[i]); return HOER_Y[HOER_Y.length - 1]; }
const CD_CROSS = hoerner(B_HULL / (2 * DRAFT));
// Propulsion: in-gear idle thrust, full thrust; astern ≈ 0.58 × ahead (Fossen k_neg/k_pos)
// twin Verado 350s (700 hp) on a 24° deep-V RIB: ~50 kn top end, ~5 kn idling in gear. Astern is much weaker.
const T_IDLE_F = 400, T_MAX_F = 6900, T_IDLE_R = 0.7 * 400, T_MAX_R = 0.38 * 6900;
const ENGINE_Y = [-0.5, 0.5], ENGINE_L = -5.25;
const MAX_STEER = 32 * D2R;          // outboard steering angle at hard over
const HELM_TURNS = 4.4;              // hydraulic helm, turns lock-to-lock
const STEER_RATE = 38 * D2R;         // hydraulic cylinder slew (deg/s)
const GEARCASE_LIFT = 0.5 * RHO * 0.22 * 3.0; // two lower units: ~0.11 m² each, CLα ≈ 3 /rad
const BT_THRUST = 450, BT_X = 4.3;   // bow thruster: ~63 kgf electric tunnel thruster
// resistance table: knots -> kN (displacement, planing hump around 14-18 kn, planing).
// Deep-V RIB, ~5.8 t: resistance/weight ≈ 0.09 at the hump, ~0.18 at 50 kn (≈ 290 kW delivered by 700 hp).
const RES = [[0, 0], [2, 0.12], [4, 0.5], [6, 1.2], [8, 2.1], [10, 3.4], [12, 4.5], [14, 5.1], [16, 5.2], [18, 5.0], [22, 4.9], [26, 5.3], [30, 6.0], [35, 7.0], [40, 8.2], [45, 9.3], [50, 10.4], [55, 11.9], [60, 13.8], [70, 18.5], [80, 24]];
export function resistance(kn) {
  const a = Math.abs(kn);
  for (let i = 0; i + 1 < RES.length; i++) if (a <= RES[i + 1][0]) {
    const [k0, r0] = RES[i], [k1, r1] = RES[i + 1];
    return (r0 + (r1 - r0) * (a - k0) / (k1 - k0)) * 1000;
  }
  return 24000;
}
export const THRUST = { T_IDLE_F, T_MAX_F };
// hull collision circles: [longitudinal offset (+ fwd), radius]
const CIRCLES = [[4.45, 0.8], [3.1, 1.35], [1.25, 1.62], [-0.8, 1.62], [-2.8, 1.62], [-4.6, 1.55], [-5.35, 0.5]];

export class PlayerBoat {
  constructor(scene) {
    const m = buildPlayerBoat();
    this.m = m;
    m.root.rotation.order = 'YXZ';
    scene.add(m.root);
    this.reset(0, 0, 0);
  }
  reset(x, z, headingDeg) {
    this.x = x; this.z = z; this.h = headingDeg * D2R;
    this.wrecked = false; if (this.m) this.m.body.visible = true;
    this.vx = 0; this.vz = 0; this.r = 0;
    // lever: -1 (full astern) .. 0 (neutral detent) .. +1 (full ahead). Gear & throttle derive from it.
    this.engines = [0, 1].map(() => ({ lever: 0, gear: 0, thr: 0, thrust: 0, rpm: 650, failed: false, running: true, tilt: 0, hot: 0, detent: null }));
    // pre-departure state (everything "ready" unless a checklist start is requested)
    this.prep = { cover: false, battery: true, lanyard: true };
    this.wheel = 0; this.wheelTurns = 0; this.steer = 0;
    this.u = 0; this.v = 0;
    this.bt = { power: false, cmd: 0, thrust: 0, heat: 0, tripped: 0 };
    this.lines = []; this.lineMeshes = this.lineMeshes || null;
    this.scrape = 0; this.contactKind = null;
    this.fenders = false; this.alongside = null;
    this.damage = 0; this.grounded = false; this.propStrike = 0;
    this.pitch = 0; this.roll = 0; this.heave = 0; this.oscP = 0; this.oscPv = 0; this.oscR = 0; this.oscRv = 0;
    this.events = []; this.maxImpact = 0; this.slams = 0; this.lastSlam = 0; this.wakeHits = 0;
    this.foamT = 0; this.contactNow = false; this.contacts = 0;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get sogKn() { return this.speed / KN; }
  get fwd() { return { x: Math.sin(this.h), z: -Math.cos(this.h) }; }
  get right() { return { x: Math.cos(this.h), z: Math.sin(this.h) }; }
  get headingDeg() { return ((this.h / D2R) % 360 + 360) % 360; }
  get cogDeg() { return ((Math.atan2(this.vx, -this.vz) / D2R) % 360 + 360) % 360; }
  get surge() { const f = this.fwd; return this.vx * f.x + this.vz * f.z; }
  get tied() { return this.lines.length ? this.lines : null; }
  // keep body-frame water-relative state in sync after anything edits world velocity directly
  syncBody() {
    const f = this.fwd, s = this.right, c = currentAt(this.x, this.z);
    const rx = this.vx - c.x, rz = this.vz - c.z;
    this.u = rx * f.x + rz * f.z; this.v = rx * s.x + rz * s.z;
  }
  // helm: wheel position in turns from center (stays where you leave it — hydraulic steering)
  turnWheel(dTurns) {
    const lim = HELM_TURNS / 2;
    this.wheelTurns = Math.max(-lim, Math.min(lim, this.wheelTurns + dTurns));
    this.wheel = this.wheelTurns / lim;
  }

  // ---------------------------------------------------------------- controls
  // Binnacle geometry: |lever| < GEAR_IN = neutral, GEAR_IN..IDLE_TOP = in gear at idle,
  // beyond that the throttle opens progressively to full at the end of travel.
  static GEAR_IN = 0.12; static IDLE_TOP = 0.25;
  setLever(i, v) {
    const e = this.engines[i];
    e.lever = Math.max(-1, Math.min(1, v));
    const a = Math.abs(e.lever), g = a < PlayerBoat.GEAR_IN ? 0 : Math.sign(e.lever);
    if (g !== e.gear) this.events.push({ type: 'shift', engine: i, gear: g });
    e.gear = e.failed ? 0 : g;
    e.thr = a <= PlayerBoat.IDLE_TOP ? 0 : (a - PlayerBoat.IDLE_TOP) / (1 - PlayerBoat.IDLE_TOP);
  }
  // put both levers where they need to be for an in-gear throttle setting (used to start scenarios underway)
  setThrottleLevers(thr) { for (let i = 0; i < 2; i++) this.setLever(i, PlayerBoat.IDLE_TOP + thr * (1 - PlayerBoat.IDLE_TOP)); }
  startEngine(i) {
    const e = this.engines[i];
    if (e.running) return 'running';
    if (!this.prep.battery) return 'battery';
    if (!this.prep.lanyard) return 'lanyard';
    if (Math.abs(e.lever) >= PlayerBoat.GEAR_IN) return 'gear';
    e.running = true; e.rpm = 1100; return 'ok';
  }
  stopEngine(i) { this.engines[i].running = false; }

  // ---------------------------------------------------------------- physics
  update(dt, input) {
    const f = this.fwd, s = this.right;
    // ---- helm: outboards follow the wheel through a hydraulic cylinder (no self-centering)
    this.wheel = this.wheelTurns / (HELM_TURNS / 2);
    const target = this.wheel * MAX_STEER;
    this.steer += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, target - this.steer));

    // ---- water-relative body velocities (u surge, v sway) and yaw rate r
    const cur = currentAt(this.x, this.z);
    { const rx = this.vx - cur.x, rz = this.vz - cur.z; this.u = rx * f.x + rz * f.z; this.v = rx * s.x + rz * s.z; }
    const u = this.u, v = this.v, r = this.r;
    const ukn = u / KN;
    const plane = Math.min(1, Math.max(0, (Math.abs(ukn) - 12) / 10)); // 0 displacement .. 1 fully planing
    let X = 0, Y = 0, N = 0;

    // ---- propulsion: twin outboards, thrust vectored with steering, prop walk astern
    for (let i = 0; i < 2; i++) {
      const e = this.engines[i];
      if (e.failed) e.gear = 0;
      const p = Math.pow(e.thr, 1.6);
      let cmd = 0;
      if (!e.failed && e.running) {
        // prop thrust falls off with boat speed (static bollard thrust ≈ 1.3 × thrust at top speed)
        if (e.gear === 1) cmd = (T_IDLE_F + (T_MAX_F - T_IDLE_F) * p) * (1.3 - 0.3 * Math.min(1.2, Math.max(0, ukn) / 50));
        else if (e.gear === -1) cmd = -(T_IDLE_R + (T_MAX_R - T_IDLE_R) * p);
      }
      if (this.propStrike > 0) cmd *= 0.3;
      // trim range 0–0.45 is normal running trim; above that the prop ventilates (tilt / trailer range)
      cmd *= 1 - 0.9 * Math.min(1, Math.max(0, (e.tilt - 0.45) / 0.35));
      if (e.running && e.tilt > 0.62) { e.hot += dt; if (e.hot > 12 && !e.hotWarned) { e.hotWarned = true; this.events.push({ type: 'overheat', engine: i }); } }
      else e.hot = Math.max(0, e.hot - dt * 2);
      // propeller/engine response (gear engagement + spool): first-order lag
      e.thrust += (cmd - e.thrust) * (1 - Math.exp(-dt / (Math.abs(cmd) > Math.abs(e.thrust) ? 0.6 : 0.35)));
      const rpmT = e.failed || !e.running ? 0 : 650 + 5350 * e.thr * (e.gear === 0 ? 0.9 : 1);
      e.rpm += (rpmT - e.rpm) * (1 - Math.exp(-dt / 0.4));
      const T = e.thrust;
      const tx = T * Math.cos(this.steer), ty = -T * Math.sin(this.steer);
      // prop walk: counter-rotating pair (port LH, stbd RH). Astern, a RH prop walks the stern to port.
      const walk = T < 0 ? -T * 0.07 * (i === 1 ? -1 : 1) : 0;
      X += tx; Y += ty + walk;
      N += ENGINE_L * (ty + walk) - ENGINE_Y[i] * tx;
    }

    // ---- bow thruster (electric tunnel thruster; useless above ~3 kn)
    const bt = this.bt;
    bt.tripped = Math.max(0, bt.tripped - dt);
    const btOn = bt.power && this.prep.battery && bt.tripped <= 0;
    const btCmd = btOn ? bt.cmd * BT_THRUST : 0;
    bt.thrust += (btCmd - bt.thrust) * (1 - Math.exp(-dt / 0.25));
    if (btOn && bt.cmd) { bt.heat += dt; if (bt.heat > 45) { bt.tripped = 30; bt.heat = 0; this.events.push({ type: 'btTrip' }); } }
    else bt.heat = Math.max(0, bt.heat - dt * 0.5);
    const btEff = Math.max(0, 1 - Math.abs(u) / 1.6);
    Y += bt.thrust * btEff; N += BT_X * bt.thrust * btEff;

    // ---- surge resistance (planing hull curve) — astern the transom ploughs
    const { chop } = chopAt(this.x, this.z);
    // trim: ~0.25–0.3 lifts the bow and frees the hull at speed (less drag); trimmed in, the bow ploughs
    const trim = (this.engines[0].tilt + this.engines[1].tilt) / 2;
    this.trimEffect = plane * (0.1 * Math.exp(-(((trim - 0.28) / 0.13) ** 2)) - 0.08 * Math.max(0, 0.12 - trim) / 0.12);
    let R = resistance(ukn) * (u < 0 ? 1.8 : 1) * (1 + chop * 0.12 * Math.min(1, Math.abs(ukn) / 20)) * (1 - this.trimEffect);
    if (this.propStrike > 0) R += 4000;
    X -= Math.sign(u) * R;

    // ---- cross-flow drag by strip theory (Fossen crossFlowDrag + Hoerner), wetted length shrinks on plane
    const nStrip = 16, Lw = L_HULL * (1 - 0.35 * plane), T = DRAFT * (1 - 0.45 * plane);
    const x0 = -L_HULL / 2, dx = Lw / nStrip;
    for (let k = 0; k < nStrip; k++) {
      const xl = x0 + (k + 0.5) * dx;
      const w = v + xl * r;
      const dY = -0.5 * RHO * T * CD_CROSS * Math.abs(w) * w * dx;
      Y += dY; N += xl * dY;
    }
    // planing-surface yaw damping grows with speed (wetted bottom resists yawing)
    N -= 4000 * Math.abs(u) * r;   // scaled to the lighter RIB's yaw inertia
    // small linear damping so creeping motions die out (time constants ~8 s sway, ~10 s yaw)
    Y -= (M22 / 8) * v * 0.15; N -= (M33 / 10) * r * 0.15;
    // ---- lift: outboard lower units act as twin fins at the stern; planing chines near the CG
    if (Math.abs(u) > 0.3) {
      const down = 1 - this.engines.reduce((a, e) => a + e.tilt, 0) / 2;
      const wf = v + ENGINE_L * r;
      const Uf = Math.abs(u);
      // lower units are steerable foils: angle of attack = local drift angle + steering angle
      // (astern the flow comes from behind, so steering acts the other way). Stall at ~20°.
      const aoa = Math.max(-0.24, Math.min(0.24, wf / Uf + Math.sign(u) * Math.sin(this.steer)));
      const raw = wf / Uf + Math.sign(u) * Math.sin(this.steer);
      // beyond stall the lower units still resist sideways flow as bluff bodies (Cd ≈ 1.1)
      const post = raw - aoa;
      const Yf = -GEARCASE_LIFT * down * Uf * Uf * aoa - 0.5 * RHO * 0.22 * 1.1 * down * Uf * Uf * post * Math.abs(post);
      Y += Yf; N += ENGINE_L * Yf;
      // hull lateral lift (keel/strakes/chines). Its centre sits aft of the CG — this is what makes
      // a powerboat track straight and resist the Munk moment; it moves further aft on plane.
      const xh = -1.8 - 0.8 * plane;
      const Yh = -(1000 + 200 * plane) * Uf * Math.max(-0.5 * Uf, Math.min(0.5 * Uf, v + xh * r));
      Y += Yh; N += xh * Yh;
    }

    // ---- wind (apparent): centre of effort shifts with wind angle (Isherwood-style)
    const wnd = windAt(this.x, this.z);
    const ax = wnd.x - this.vx, az = wnd.z - this.vz, am = Math.hypot(ax, az);
    const wa = ax * f.x + az * f.z, wb = ax * s.x + az * s.z;
    const q = 0.5 * RHO_AIR * am;
    const Fwx = q * wa * 6.2 * 0.9, Fwy = q * wb * 14.0 * 1.05;   // targa cabin: ~6 m² frontal, ~14 m² side
    const gamma = Math.atan2(Math.abs(wb), -wa); // 0 = from dead ahead
    const xce = 0.6 + 1.2 * Math.cos(gamma);       // targa cabin sits just forward of midships
    X += Fwx; Y += Fwy; N += xce * Fwy;

    // ---- dock lines (tension-only ropes) — forces in world frame at the cleats
    if (this.lines.length) {
      for (const ln of this.lines) {
        const c = this.cleatWorld(ln.cleat);
        const dxw = ln.ax - c.x, dzw = ln.az - c.z, d = Math.hypot(dxw, dzw) || 1e-6;
        // velocity of the cleat along the line
        const rl = { x: c.x - this.x, z: c.z - this.z };
        const cvx = this.vx + r * -rl.z, cvz = this.vz + r * rl.x;
        const ext = d - ln.len;
        ln.taut = ext > 0;
        if (ext <= 0) continue;
        const rate = -(cvx * dxw + cvz * dzw) / d; // >0 when stretching
        const F = Math.min(26000, 22000 * ext + 9000 * Math.max(0, rate));
        const fxw = F * dxw / d, fzw = F * dzw / d;
        const bx = fxw * f.x + fzw * f.z, by = fxw * s.x + fzw * s.z;
        X += bx; Y += by;
        N += ln.cleat.l * by - ln.cleat.y * bx;
        ln.strain = ext;
        if (F > 15000 && !ln.warned) { ln.warned = true; this.events.push({ type: 'lineStrain', line: ln }); }
      }
      // crew snug up lines that were just made fast
      for (const ln of this.lines) if (ln.snug > 0) { ln.snug -= dt; ln.len = Math.max(ln.minLen, ln.len - dt * 0.35); }
    }

    // ---- Fossen 3-DOF:  M ν̇ + C(ν)ν = τ   with C from the (rigid + added) mass matrix
    //   u̇ = (X + M22 v r)/M11 ;  v̇ = (Y − M11 u r)/M22 ;  ṙ = (N − (M22 − M11) u v)/M33  (Munk moment)
    const du = (X + M22 * v * r) / M11;
    const dv = (Y - M11 * u * r) / M22;
    const drr = (N - (M22 - M11) * u * v) / M33;
    this.u = u + du * dt; this.v = v + dv * dt; this.r = r + drr * dt;
    this.h += this.r * dt;
    const f2 = this.fwd, s2 = this.right;
    this.vx = f2.x * this.u + s2.x * this.v + cur.x;
    this.vz = f2.z * this.u + s2.z * this.v + cur.z;
    // continuous-ish collision: sub-step the move so a 50 kn boat can't tunnel through a kayak or a piling
    this.scrape *= Math.exp(-dt * 8);
    const nSub = Math.max(1, Math.ceil(this.speed * dt / 0.3));
    for (let k = 0; k < nSub; k++) {
      this.x += this.vx * dt / nSub; this.z += this.vz * dt / nSub;
      this.collide(dt / nSub);
    }
    this.checkDepth(dt);
    this.visuals(dt, this.u, chop);
    this.wake(dt, this.u);
    this.checkAlongside();
    this.updateLineMeshes();
  }

  // ---------------------------------------------------------------- dock lines
  static CLEATS = [
    { id: 'bowP', name: 'Bow line (port)', l: 4.3, y: -0.85, kind: 'bow' },
    { id: 'bowS', name: 'Bow line (stbd)', l: 4.3, y: 0.85, kind: 'bow' },
    { id: 'midP', name: 'Spring (port)', l: 0.4, y: -1.62, kind: 'mid' },
    { id: 'midS', name: 'Spring (stbd)', l: 0.4, y: 1.62, kind: 'mid' },
    { id: 'stnP', name: 'Stern line (port)', l: -4.9, y: -1.45, kind: 'stern' },
    { id: 'stnS', name: 'Stern line (stbd)', l: -4.9, y: 1.45, kind: 'stern' },
  ];
  cleatWorld(c) { const f = this.fwd, s = this.right; return { x: this.x + f.x * c.l + s.x * c.y, z: this.z + f.z * c.l + s.z * c.y }; }
  // Make lines fast to whatever dock is within reach of each cleat. In a slip that gives bow
  // lines to the pier and stern/spring lines to the finger; alongside a float you get
  // bow, stern and two springs.
  secureLines(reach = 3.2) {
    const made = [];
    for (const c of PlayerBoat.CLEATS) {
      const p = this.cleatWorld(c);
      let best = null, bd = reach;
      for (const st of structsNear(p.x, p.z, reach + 2)) {
        if (st.kind !== 'float' && st.kind !== 'pier') continue;
        const cp = closestOnOBB(p.x, p.z, st), d = Math.hypot(cp.x - p.x, cp.z - p.z);
        if (d < bd) { bd = d; best = { ...cp, st }; }
      }
      if (!best) continue;
      if (c.kind === 'mid') {
        // two springs from the midship cleat: one leading aft, one leading forward along the dock
        const f = this.fwd;
        for (const [nm, off] of [['After spring', -4], ['Fwd spring', 4]]) {
          const a = clampToOBB(best.x + f.x * off, best.z + f.z * off, best.st);
          const d = Math.hypot(a.x - p.x, a.z - p.z);
          made.push({ cleat: c, name: `${nm} (${c.y < 0 ? 'port' : 'stbd'})`, ax: a.x, az: a.z, len: d + 0.25, minLen: d * 0.9, snug: 0 });
        }
      } else {
        made.push({ cleat: c, name: c.name, ax: best.x, az: best.z, len: bd + 0.3, minLen: Math.max(0.6, bd * 0.7), snug: 2.5 });
      }
    }
    this.lines = made;
    return made.length;
  }
  castOffLine(i) { this.lines.splice(i, 1); }
  castOffAll() { this.lines = []; }
  updateLineMeshes() {
    if (!this.lineGeo) {
      this.lineGeo = new THREE.BufferGeometry();
      this.lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 9 * 2 * 3), 3));
      const mesh = new THREE.LineSegments(this.lineGeo, new THREE.LineBasicMaterial({ color: 0xf2efe2 }));
      mesh.frustumCulled = false; this.m.root.parent.add(mesh);
    }
    const arr = this.lineGeo.attributes.position.array;
    let n = 0;
    for (const ln of this.lines.slice(0, 8)) {
      const c = this.cleatWorld(ln.cleat);
      const d = Math.hypot(ln.ax - c.x, ln.az - c.z), sag = ln.taut ? 0.05 : Math.min(0.8, 0.1 + (ln.len - d) * 0.6);
      let px = c.x, py = 1.15 + this.heave, pz = c.z;
      for (let k = 1; k <= 9; k++) {
        const t = k / 9, x = c.x + (ln.ax - c.x) * t, z = c.z + (ln.az - c.z) * t;
        const y = (1.15 + this.heave) * (1 - t) + 0.55 * t - Math.sin(t * Math.PI) * sag;
        arr.set([px, py, pz, x, y, z], n * 6); n++;
        px = x; py = y; pz = z;
      }
    }
    this.lineGeo.setDrawRange(0, n * 2);
    this.lineGeo.attributes.position.needsUpdate = true;
  }

  collide(dt, aiVessels = this._ai) {
    const f = this.fwd;
    this.contactNow = false;
    for (const [l, rad] of CIRCLES) {
      const cx = this.x + f.x * l, cz = this.z + f.z * l;
      // land
      const sd = sdfAt(cx, cz);
      if (sd > -rad) {
        const g = sdfGrad(cx, cz);
        this.resolve(cx, cz, -g.x, -g.z, sd + rad, 0, 0, 'land');
      }
      for (const st of structsNear(cx, cz, 40)) {
        const hit = circleOBB(cx, cz, rad, st);
        if (hit) this.resolve(cx, cz, hit.nx, hit.nz, hit.depth, 0, 0, st.kind, st);
      }
    }
    if (aiVessels) for (const v of aiVessels) {
      if (!v.active || v.noCollide) continue;
      const dx = v.x - this.x, dz = v.z - this.z, rr = v.len / 2 + 6;
      if (dx * dx + dz * dz > rr * rr) continue;
      const obb = { cx: v.x, cz: v.z, hl: v.len / 2, hw: v.beam / 2, rot: v.h };
      for (const [l, rad] of CIRCLES) {
        const cx = this.x + f.x * l, cz = this.z + f.z * l;
        const hit = circleOBB(cx, cz, rad, obb);
        if (hit) this.resolve(cx, cz, hit.nx, hit.nz, hit.depth, v.vx || 0, v.vz || 0, 'vessel', v);
      }
    }
  }

  resolve(cx, cz, nx, nz, depth, ovx, ovz, kind, obj) {
    this.x += nx * depth; this.z += nz * depth;
    const rx = cx - this.x, rz = cz - this.z;
    const px = -rz, pz = rx; // perp for yaw (clockwise +)
    const vpx = this.vx + this.r * px - ovx, vpz = this.vz + this.r * pz - ovz;
    const vn = vpx * nx + vpz * nz;
    this.contactNow = true;
    // the other boat gets shoved too (momentum shared by mass) — nobody passes through anybody
    if (kind === 'vessel' && obj && !obj.scripted && obj.cat !== 'ship') {
      const mo = Math.max(150, obj.len * obj.len * obj.len * 4.5), share = MASS / (MASS + mo);
      obj.x -= nx * depth * share * 2; obj.z -= nz * depth * share * 2;
      if (vn < 0) { obj.speed *= 0.6; obj.h += (Math.random() - 0.5) * Math.min(0.6, -vn * share * 0.2); }
    }
    if (vn >= 0) return;
    const e = this.fenders ? 0.12 : 0.28;
    const pn = px * nx + pz * nz;
    const j = -(1 + e) * vn / (1 / MASS + pn * pn / IZZ);
    this.vx += j * nx / MASS; this.vz += j * nz / MASS;
    this.r += pn * j / IZZ;
    // friction along the contact
    const tx = -nz, tz = nx, vt = vpx * tx + vpz * tz;
    this.vx -= vt * tx * 0.15; this.vz -= vt * tz * 0.15;
    this.syncBody();
    const impact = -vn;
    // sliding along the dock/hull without fenders = gelcoat scraping
    if (kind !== 'land' || impact < 0.5) { this.scrape = Math.max(this.scrape, Math.abs(vt) + impact); this.contactKind = kind; }
    // the inflatable collar is a fender all the way round: sliding costs Hypalon scuffs, not gelcoat
    if (!this.fenders && Math.abs(vt) > 0.25 && kind !== 'buoy') this.damage = Math.min(100, this.damage + Math.abs(vt) * 0.006);
    if (impact > 0.12) {
      this.maxImpact = Math.max(this.maxImpact, impact);
      let sev = 'touch';
      if (kind === 'vessel' && impact > 0.4) sev = 'collision';
      else if (impact > 0.85 || (kind === 'land' && impact > 0.5)) sev = 'crash';
      else if (impact > 0.35 || (!this.fenders && impact > 0.3)) sev = 'bump';
      const dmg = sev === 'collision' ? 18 + impact * 12 : sev === 'crash' ? impact * 9 : sev === 'bump' ? (this.fenders ? 0.5 : 1.5) : 0;
      this.damage = Math.min(100, this.damage + dmg);
      this.events.push({ type: 'impact', kind, sev, impact, obj, fenders: this.fenders });
      this.oscRv += (Math.random() - 0.5) * impact * 0.25; this.oscPv += impact * 0.08;
    }
  }

  checkDepth(dt) {
    const f = this.fwd, tide = tideHeight();
    const dStern = depthAt(this.x - f.x * 5.2, this.z - f.z * 5.2) + tide;
    const dBow = depthAt(this.x + f.x * 3.5, this.z + f.z * 3.5) + tide;
    const dMid = depthAt(this.x, this.z) + tide;
    this.depth = dMid;
    this.propStrike = Math.max(0, this.propStrike - dt);
    if (dStern < 1.05 && dStern > -0.5 && this.speed > 0.3) {
      if (this.propStrike <= 0) { this.events.push({ type: 'ground', what: 'prop', depth: dStern }); this.damage = Math.min(100, this.damage + 4 + this.speed); }
      this.propStrike = 1.5;
    }
    const minD = Math.min(dBow, dMid);
    if (minD < 0.55 && minD > -0.5) {
      if (!this.grounded) { this.events.push({ type: 'ground', what: 'hull', depth: minD }); this.damage = Math.min(100, this.damage + 3 + this.speed * 3); }
      this.grounded = true;
      const k = Math.exp(-dt * 4);
      this.vx *= k; this.vz *= k; this.r *= k; this.syncBody();
    } else this.grounded = false;
  }

  visuals(dt, ur, chop) {
    const f = this.fwd, s = this.right, t = env.time;
    const hb = waveHeight(this.x + f.x * 4, this.z + f.z * 4, t), hs = waveHeight(this.x - f.x * 4, this.z - f.z * 4, t);
    const hp = waveHeight(this.x - s.x * 1.6, this.z - s.z * 1.6, t), hr = waveHeight(this.x + s.x * 1.6, this.z + s.z * 1.6, t);
    const kn = Math.abs(ur) / KN;
    const plane = Math.min(1, Math.max(0, (kn - 14) / 10));
    const follow = 1 - plane * 0.6;
    const wp = Math.atan2(hb - hs, 8) * follow, wr = Math.atan2(hr - hp, 3.2) * follow;
    const heave = (hb + hs + hp + hr) / 4 * follow + plane * 0.25;
    let trim = 0;
    if (ur > 0) trim = (kn < 6 ? kn / 6 * 1.5 : kn < 15 ? 1.5 + (kn - 6) / 9 * 5 : Math.max(3, 6.5 - (kn - 15) * 0.12)) * D2R;
    else trim = -Math.min(2, kn * 0.6) * D2R;
    const bank = Math.max(-0.2, Math.min(0.2, this.r * ur * 0.09));
    const trimNow = (this.engines[0].tilt + this.engines[1].tilt) / 2;
    if (ur > 0) trim += plane * (Math.min(trimNow, 0.5) - 0.2) * 6 * D2R;
    // over-trimmed at high speed: porpoising
    if (kn > 40 && trimNow > 0.36) this.oscPv += Math.sin(t * 9) * (trimNow - 0.36) * dt * 6;
    // slamming into steep chop at speed
    if (kn > 18 && chop > 0.3 && t - this.lastSlam > 0.6) {
      const into = Math.abs(hb - hs) > 0.25 && Math.random() < dt * (kn - 15) * chop * 0.6 * (0.6 + 1.6 * Math.max(0, ((this.engines[0].tilt + this.engines[1].tilt) / 2) - 0.1));
      if (into) { this.slams++; this.lastSlam = t; this.oscPv -= 0.25 * chop * (kn / 30); this.events.push({ type: 'slam', kn, chop }); }
    }
    // spring-damper oscillators for wake hits / slams
    this.oscPv += (-this.oscP * 30 - this.oscPv * 4) * dt; this.oscP += this.oscPv * dt;
    this.oscRv += (-this.oscR * 18 - this.oscRv * 2.5) * dt; this.oscR += this.oscRv * dt;
    const a = 1 - Math.exp(-dt / 0.25);
    this.pitch += (wp + trim - this.pitch) * a;
    this.roll += (wr + bank - this.roll) * a;
    this.heave += (heave - this.heave) * a;
    const m = this.m;
    m.root.position.set(this.x, this.heave, this.z);
    m.root.rotation.y = -this.h;
    m.body.rotation.x = this.pitch + this.oscP;
    m.body.rotation.z = -(this.roll + this.oscR);
    m.engines.forEach((e, i) => {
      const en = this.engines[i];
      e.pivot.rotation.y = -this.steer;
      e.pivot.rotation.x = -en.tilt * 1.15;  // trim/tilt (0–0.45 running trim, above = tilted up)
      e.prop.rotation.y += en.gear * en.rpm * dt * 0.05;
    });
    m.wheel.rotation.z = -this.wheelTurns * Math.PI * 2;
    m.levers.forEach((lv, i) => {
      const e = this.engines[i];
      lv.rotation.x = -e.lever * 0.95;
    });
    m.fenders.visible = this.fenders;
    m.cover.visible = this.prep.cover;
  }

  wake(dt, ur) {
    const sp = this.speed;
    this.foamT -= dt;
    if (sp < 0.4 || this.foamT > 0 || this.noWake) return;
    this.foamT = sp > 8 ? 0.03 : 0.25;
    const f = this.fwd, s = this.right;
    const kn = sp / KN;
    const sx = this.x - f.x * 5.4, sz = this.z - f.z * 5.4;
    const spread = Math.min(3.5, sp * 0.18);
    // slow: a thin, short-lived prop-wash trail; on plane: the full white wake
    const size = kn < 12 ? 0.3 + kn * 0.03 : 1.2 + Math.min(4, kn * 0.12);
    const life = kn < 12 ? 4 + kn * 0.6 : 8 + Math.min(40, kn * 1.2);
    const energy = sp * 10.7 * (kn > 12 && kn < 22 ? 1.6 : 1);
    // the visible wake is the procedural ribbon (wake.js); these size-0 emissions only feed wake-crossing physics
    for (const side of [-1, 1]) emitFoam(sx + s.x * side * 1.1, sz + s.z * side * 1.1, s.x * side * spread, s.z * side * spread, 0, life, energy);
    if (kn > 20 && Math.random() < 0.5) for (const side of [-1, 1]) emitFoam(this.x + f.x * 2 + s.x * side * 1.7, this.z + f.z * 2 + s.z * side * 1.7, s.x * side * 5, s.z * side * 5, 0.5, 0.7, 0);   // bow spray sheets
  }

  // detect being alongside a float/pier so lines can be secured
  checkAlongside() {
    this.alongside = null;
    if (this.speed > 0.45 || Math.abs(this.r) > 0.08) return;
    const f = this.fwd;
    let near = 0, best = null;
    for (const [l, rad] of CIRCLES) {
      const cx = this.x + f.x * l, cz = this.z + f.z * l;
      for (const st of structsNear(cx, cz, 20)) {
        if (st.kind !== 'float' && st.kind !== 'pier') continue;
        if (circleOBB(cx, cz, rad + 1.0, st)) { near++; best = st; break; }
      }
    }
    if (near >= 3) this.alongside = best;
  }

  toggleLines() {
    if (this.lines.length) { this.castOffAll(); this.events.push({ type: 'castoff' }); return; }
    if (this.speed > 0.6) { this.events.push({ type: 'cantTie', why: 'fast' }); return; }
    if (this.secureLines()) this.events.push({ type: 'tied', st: this.alongside, n: this.lines.length });
    else this.events.push({ type: 'cantTie' });
  }
}

// closest point on an oriented dock box (its edge, if the point is outside)
function closestOnOBB(x, z, st) {
  const fx = Math.sin(st.rot), fz = -Math.cos(st.rot), rx = Math.cos(st.rot), rz = Math.sin(st.rot);
  const dx = x - st.cx, dz = z - st.cz;
  let a = dx * fx + dz * fz, b = dx * rx + dz * rz;
  a = Math.max(-st.hl, Math.min(st.hl, a)); b = Math.max(-st.hw, Math.min(st.hw, b));
  return { x: st.cx + fx * a + rx * b, z: st.cz + fz * a + rz * b };
}
const clampToOBB = closestOnOBB;
