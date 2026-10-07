// Route Tours: an autopilot drives a full day's route (with every docking) at high time
// compression while narrating what you're seeing, so you can learn the way around.
import { ll, toLL, depthAt } from './geo.js';
import { env, advanceEnv, KN, tideHeight } from './env.js';
import { PIER_FRAMES, PLAYER_SLIP, GUEST_SPOTS, STRUCTS } from './docks.js';
import { findPath, clearLine } from './nav.js';
import { updateTraffic } from './traffic.js';

const D2R = Math.PI / 180;
const P = (lat, lon) => ll(lat, lon);
const hdgOf = (dx, dz) => Math.atan2(dx, -dz);
const dirv = (h) => ({ x: Math.sin(h), z: -Math.cos(h) });

// ---------------------------------------------------------------- route definitions
// Each leg: transit via-points (lat/lon) and an optional stop. Notes fire when the boat passes nearby.
export const ROUTES = [
  {
    id: 'grand', title: 'Pier 40 → Angel Island → Tiburon → Sausalito → Golden Gate → home',
    summary: 'The classic Saturday loop: lunch-stop docks, Richardson Bay, under the Gate and back down the city front. About 26 nm and 3 hours real time.',
    start: 'slip',
    legs: [
      {
        name: 'Pier 40 → Ayala Cove (Angel Island)', speed: 26,
        via: [[37.7944, -122.3827], [37.8000, -122.3880], [37.8100, -122.4000], [37.8160, -122.4100], [37.8240, -122.4150], [37.8450, -122.4390], [37.8585, -122.4525], [37.8680, -122.4480], [37.8752, -122.4385]],
        stop: { site: 'ayala', dwell: 20 * 60, label: 'Ayala Cove guest dock' },
      },
      {
        name: 'Ayala Cove → Sam\'s Anchor Cafe (Tiburon)', speed: 20,
        via: [[37.8735, -122.4400], [37.8705, -122.4470], [37.8700, -122.4530], [37.8712, -122.4545]],
        stop: { site: 'sams', dwell: 45 * 60, label: 'Sam\'s guest dock (lunch)', approach: [[37.8718, -122.4551], [37.8722, -122.4556]] },
      },
      {
        name: 'Tiburon → Richardson Bay → Sausalito', speed: 22,
        via: [[37.8712, -122.4545], [37.8690, -122.4565], [37.8610, -122.4645], [37.8560, -122.4720], [37.8600, -122.4775], [37.8630, -122.4830], [37.8660, -122.4890], [37.8690, -122.4930], [37.8660, -122.4885], [37.8615, -122.4800], [37.8560, -122.4745]],
        stop: { site: 'sausalito', dwell: 30 * 60, label: 'Sausalito city guest dock' },
      },
      {
        name: 'Sausalito → Golden Gate Bridge', speed: 26,
        via: [[37.8530, -122.4720], [37.8460, -122.4700], [37.8400, -122.4665], [37.8330, -122.4715], [37.8250, -122.4770], [37.8172, -122.4783], [37.8140, -122.4900], [37.8105, -122.4920], [37.8130, -122.4830]],
      },
      {
        name: 'Golden Gate → city front → home (Pier 40)', speed: 26,
        via: [[37.8150, -122.4780], [37.8120, -122.4600], [37.8115, -122.4450], [37.8125, -122.4300], [37.8130, -122.4180], [37.8150, -122.4100], [37.8100, -122.4000], [37.8000, -122.3880], [37.7944, -122.3827], [37.7860, -122.3818]],
        stop: { site: 'home', dwell: 0, label: 'Your slip, Pier 40' },
      },
    ],
    notes: [
      [37.7838, -122.3880, 'Leaving South Beach Harbor: 5 kn until you\'re past the breakwater. Back out of the slip, twist with the engines (port ahead / stbd astern) to face east, idle down the fairway.'],
      [37.7860, -122.3818, 'Outside the harbor: Bay Bridge ahead. Ships to Oakland use the span east of the center anchorage — you pass under the span nearest the city. Listen to VHF 13/14.'],
      [37.7944, -122.3827, 'Under the Bay Bridge west span (between the first two towers). Fireboat station Pier 22½ on your left. Then the Ferry Building — ferries leave the gates every few minutes at 30 kn.'],
      [37.8000, -122.3880, 'Off the Ferry Building: stay ~400 yd off the piers. Pier 1½ guest float is just north of the clock tower; Hornblower dining yachts at Pier 3.'],
      [37.8100, -122.4000, 'Cruise ship terminal (Pier 27) and Alcatraz ferry landing (Pier 33). Alcatraz boats shuttle north every 30 min — cross behind them.'],
      [37.8160, -122.4100, 'Pier 39: marina either side, sea lions on the west floats. Blossom Rock buoy is off your right. Now head NNW toward Alcatraz.'],
      [37.8240, -122.4150, 'Pass EAST of Alcatraz, ~500 yd off. No landing here. You\'re crossing the Oakland ship lane — look both ways (west toward the Gate, east toward the bridge).'],
      [37.8450, -122.4390, 'Central Bay: the westerly is strongest here ("the Slot"). Angel Island ahead — aim for its west end (Point Stuart). Ebb sets you west, flood sets you east.'],
      [37.8585, -122.4525, 'Point Stuart / Raccoon Strait entrance. Current here can run 3+ kn — watch COG vs heading. Tiburon on your left, Angel Island on your right.'],
      [37.8752, -122.4385, 'Ayala Cove entrance: slow to 5 mph NOW. The strait current sweeps across the mouth — crab in up-current. Ferry pier on the EAST side, guest docks on the WEST side, mooring balls in the middle.'],
      [37.8705, -122.4470, 'Crossing Raccoon Strait toward Tiburon. Downtown Tiburon is ahead; the ferry pier sticks out from Main Street.'],
      [37.8712, -122.4545, 'Tiburon: no wake. Sam\'s dock is inside the little basin behind the Corinthian YC breakwater — go in just past the end of the Tiburon ferry pier (watch for the ferry), then turn up toward Sam\'s deck. CYC slips on your left.'],
      [37.8610, -122.4645, 'Rounding Belvedere Point — there\'s a shoal off the point; give it 300 yd. Ahead: Sausalito on the far shore, Richardson Bay opening to the right.'],
      [37.8600, -122.4775, 'Richardson Bay channel: RED markers on your RIGHT going in. Outside the channel the bay is 2–6 ft deep (mud). 5 kn the whole way.'],
      [37.8690, -122.4930, 'Clipper Yacht Harbor and Schoonmaker Point (guest slips) on your left; houseboats beyond. Turn around and head back down the channel to downtown Sausalito.'],
      [37.8560, -122.4745, 'Downtown Sausalito: ferry landing (don\'t block it), the city guest dock just north of it, the Spinnaker point, then Sausalito Yacht Harbor. Gusts come down off the hills.'],
      [37.8460, -122.4700, 'Leaving Sausalito southbound, speed back up once clear of the no-wake zone.'],
      [37.8400, -122.4665, 'Yellow Bluff: notorious back-eddies and gusts. Stay a couple hundred yards off.'],
      [37.8330, -122.4715, 'Horseshoe Cove (Presidio YC, Coast Guard Station Golden Gate) on your right — the bail-out spot near the Gate.'],
      [37.8172, -122.4783, 'Under the Golden Gate Bridge! Big ebb + westerly = steep standing waves here. Ships use the middle; you\'re crossing their lane — check for traffic coming in.'],
      [37.8105, -122.4920, 'Outside the Gate: Pacific swell begins. Turn back in, passing closer to the south tower side.'],
      [37.8120, -122.4600, 'Crissy Field: kiteboarders zip across at 20+ kn in the afternoon. Then the St. Francis YC and the Marina — race committees often set courses right here.'],
      [37.8125, -122.4300, 'Fort Mason piers, then Aquatic Park inside the curved Muni Pier — swimmers in the water. Stay well outside.'],
      [37.8130, -122.4180, 'Fisherman\'s Wharf and Hyde St Pier (the tall ship Balclutha), then Pier 45 (Liberty ship & submarine).'],
      [37.7860, -122.3818, 'Home stretch: enter South Beach Harbor between the Pier 40 tip and the breakwater end, 5 kn, fenders out, lines ready.'],
    ],
  },
];

// ---------------------------------------------------------------- path building
function smooth(pts, step = 8) {
  // Catmull-Rom through the points, resampled every `step` metres
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const L = Math.hypot(p2.x - p1.x, p2.z - p1.z), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function waterRoute(points) {
  // join via-points with water-safe paths (falls back on the nav graph if a straight hop hits land)
  const out = [points[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    if (clearLine(a.x, a.z, b.x, b.z, -15, 1.6)) out.push(b);
    else out.push(...findPath(a.x, a.z, b.x, b.z));
  }
  return out;
}
function arc(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return s;
}
// pick the open guest spot for a site and work out which side the dock is on
function dockTarget(siteId, from) {
  const spots = GUEST_SPOTS.filter(g => g.site === siteId);
  if (!spots.length) return null;
  spots.sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
  const sp = spots[0];
  // outward normal: from the nearest float toward the spot
  let best = null, bd = 1e9;
  for (const st of STRUCTS) {
    if (st.kind !== 'float' && st.kind !== 'pier') continue;
    const d = Math.hypot(st.cx - sp.x, st.cz - sp.z);
    if (d > 80) continue;
    const fx = Math.sin(st.rot), fz = -Math.cos(st.rot), rx = Math.cos(st.rot), rz = Math.sin(st.rot);
    const dx = sp.x - st.cx, dz = sp.z - st.cz;
    const a = Math.max(-st.hl, Math.min(st.hl, dx * fx + dz * fz)), b = Math.max(-st.hw, Math.min(st.hw, dx * rx + dz * rz));
    const cx = st.cx + fx * a + rx * b, cz = st.cz + fz * a + rz * b, dd = Math.hypot(sp.x - cx, sp.z - cz);
    if (dd < bd && dd > 0.01) { bd = dd; best = { nx: (sp.x - cx) / dd, nz: (sp.z - cz) / dd }; }
  }
  const n = best || { nx: 0, nz: 1 };
  // arrive moving along the dock in the direction that points away from where we come from
  let h = sp.heading * D2R; const hv = dirv(h);
  if ((sp.x - from.x) * hv.x + (sp.z - from.z) * hv.z < 0) h += Math.PI;
  return { x: sp.x, z: sp.z, h, nx: n.nx, nz: n.nz, label: sp.label };
}

// Build the full list of motion segments for a route
export function buildRoute(route, player) {
  const segs = [];
  const add = (seg) => { if (seg.pts) { seg.s = arc(seg.pts); seg.len = seg.s[seg.s.length - 1]; } segs.push(seg); };
  const F = PIER_FRAMES.p40, slip = PLAYER_SLIP.spot;
  const slipH = slip.heading * D2R, back = dirv(slipH + Math.PI);
  const fair = { x: slip.x + back.x * 16, z: slip.z + back.z * 16 };
  let cur;
  if (route.start === 'slip') {
    add({ kind: 'rev', label: 'Backing out of the slip', pts: [{ x: slip.x, z: slip.z }, fair], h: slipH, v0: 0.6, v1: 1.2, rate: 4, cam: 'top', levers: [-0.3, -0.3] });
    add({ kind: 'pivot', label: 'Twisting to face the fairway (port ahead, stbd astern)', at: fair, h0: slipH, h1: 90 * D2R, dur: 16, rate: 4, cam: 'top', levers: [0.3, -0.3] });
    const out = [fair, F.P(205, 41), F.P(238, 24), F.P(262, 0), F.P(320, -48)];
    add({ kind: 'fwd', label: 'Idling down the fairway — 5 kn max', pts: smooth(out, 4), v0: 2, v1: 5, rate: 14, cam: 'top', levers: [0.2, 0.2] });
    cur = F.P(320, -48);
  }
  for (const leg of route.legs) {
    const via = [cur, ...leg.via.map(([a, b]) => P(a, b))];
    if (leg.stop && leg.stop.site === 'home') {
      // into South Beach Harbor and bow-in to the slip
      via.push(F.P(330, -55), F.P(262, 0), F.P(238, 24));
      const pts = smooth(waterRoute(via), 10);
      add({ kind: 'fwd', label: leg.name, pts, v0: leg.speed, v1: 5, rate: 120, cam: 'chase', levers: [0.85, 0.85], noWakeSlow: true });
      add({ kind: 'fwd', label: 'Fairway — idle in gear, bumping in and out of neutral', pts: smooth([F.P(238, 24), F.P(205, 41), fair], 4), v0: 4, v1: 0.8, rate: 12, cam: 'top', levers: [0.18, 0.18] });
      add({ kind: 'pivot', label: 'Twisting to line up with the slip (port ahead, stbd astern)', at: fair, h0: 270 * D2R, h1: slipH, dur: 16, rate: 5, cam: 'top', levers: [0.3, -0.3] });
      add({ kind: 'fwd', label: 'Easing bow-in between the fingers', pts: [fair, { x: slip.x, z: slip.z }], v0: 1.0, v1: 0.1, rate: 5, cam: 'top', levers: [0.15, 0.15], dock: true });
      add({ kind: 'stop', label: 'Home — lines on, engines off, cover back on', at: { x: slip.x, z: slip.z }, h: slipH, dur: 20, rate: 5, cam: 'top', tie: true, final: true });
      break;
    }
    const pts = smooth(waterRoute(via), 10);
    let end = pts[pts.length - 1];
    if (!leg.stop) { add({ kind: 'fwd', label: leg.name, pts, v0: leg.speed, v1: leg.speed, rate: 120, cam: 'chase', levers: [0.85, 0.85], noWakeSlow: true }); cur = end; continue; }
    const tgt = dockTarget(leg.stop.site, end);
    add({ kind: 'fwd', label: leg.name, pts, v0: leg.speed, v1: 5, rate: 110, cam: 'chase', levers: [0.85, 0.85], noWakeSlow: true });
    if (tgt) {
      const hv = dirv(tgt.h);
      let far = { x: tgt.x + tgt.nx * 26 - hv.x * 30, z: tgt.z + tgt.nz * 26 - hv.z * 30 };
      let nwPath = null;
      if (leg.stop.approach) { const ap = leg.stop.approach.map(([a, b]) => P(a, b)); far = ap[ap.length - 1]; nwPath = [end, ...ap]; }
      const mid = { x: tgt.x + tgt.nx * 6 - hv.x * 12, z: tgt.z + tgt.nz * 6 - hv.z * 12 };
      const near = { x: tgt.x + tgt.nx * 1.2 - hv.x * 3, z: tgt.z + tgt.nz * 1.2 - hv.z * 3 };
      add({ kind: 'fwd', label: `No-wake into ${leg.stop.label.split(' ')[0]} — fenders out, lines ready`, pts: smooth(nwPath ? nwPath : waterRoute([end, far]), 6), v0: 5, v1: 3, rate: 40, cam: 'chase', levers: [0.2, 0.2] });
      add({ kind: 'fwd', label: `Final approach: ${leg.stop.label} — ~20° to the dock, bump in/out of gear, swing the stern in`, pts: smooth([far, mid, near, { x: tgt.x, z: tgt.z }], 2), v0: 2.5, v1: 0.15, rate: 5, cam: 'top', levers: [0.16, 0.16], dock: true });
      add({ kind: 'stop', label: `Tied up at ${leg.stop.label}`, at: { x: tgt.x, z: tgt.z }, h: tgt.h, dur: 8, rate: 3, cam: 'top', tie: true, dwell: leg.stop.dwell });
      // departure: back off at an angle away from the dock, then go
      const offA = { x: tgt.x + tgt.nx * 9 - hv.x * 10, z: tgt.z + tgt.nz * 9 - hv.z * 10 };
      add({ kind: 'rev', label: 'Casting off — backing away from the dock at an angle', pts: smooth([{ x: tgt.x, z: tgt.z }, { x: tgt.x + tgt.nx * 2.5 - hv.x * 3, z: tgt.z + tgt.nz * 2.5 - hv.z * 3 }, offA], 2), h: tgt.h, v0: 0.4, v1: 1.5, rate: 5, cam: 'top', levers: [-0.2, -0.2] });
      cur = offA;
    } else cur = end;
  }
  return segs;
}

// ---------------------------------------------------------------- playback
export class Tour {
  constructor(G, route, hooks) {
    this.G = G; this.route = route; this.hooks = hooks;
    this.segs = buildRoute(route, G.player);
    this.i = 0; this.s = 0; this.t = 0; this.speedMul = 1; this.paused = false; this.done = false;
    this.notes = route.notes.map(([la, lo, text]) => ({ ...P(la, lo), text, shown: false }));
    this.log = [];
    this.path = this.segs.flatMap(sg => sg.pts || [sg.at]);
    this.realT = 0; this.simT = 0;
    this.legIdx = 0;
  }
  get seg() { return this.segs[this.i]; }
  skip() { // jump to the start of the next stop/approach
    for (let k = this.i + 1; k < this.segs.length; k++) if (this.segs[k].dock || this.segs[k].kind === 'stop') { this.enter(k); return; }
  }
  enter(k) { this.i = k; this.s = 0; this.t = 0; const sg = this.seg; if (sg && sg.kind === 'stop' && sg.tie) this.hooks.tie?.(true); }
  update(rdt) {
    if (this.paused || this.done) return;
    const sg = this.seg, p = this.G.player;
    if (!sg) { this.done = true; this.hooks.finished?.(); return; }
    // time compression: fast-forward through open water, ease down to near real time at the
    // crucial parts (narrated spots, no-wake zones, every docking/undocking manoeuvre)
    const p0 = this.G.player;
    let dmin = 1e9;
    for (const nt of this.notes) dmin = Math.min(dmin, Math.hypot(nt.x - p0.x, nt.z - p0.z));
    let target;
    if (sg.kind !== 'fwd' || sg.dock) target = sg.rate;          // docking, backing, twisting, tied up
    else if (sg.rate < 60) target = sg.rate;                       // harbor fairways / no-wake approaches
    else if (dmin < 160) target = 12;                              // crucial spot: slow to watch
    else if (dmin < 300) target = 35;
    else if (this.G.inNoWake()) target = 45;
    else target = 90;
    this.crucial = target <= 14;
    this.curRate = this.curRate == null ? target : this.curRate + (target - this.curRate) * Math.min(1, rdt * (target < this.curRate ? 4 : 1.2));
    let rate = this.curRate * this.speedMul;
    const simDt = rdt * rate;
    this.realT += rdt; this.simT += simDt;
    advanceEnv(simDt);
    const n = Math.min(6, Math.max(1, Math.ceil(simDt / 0.8)));
    for (let k = 0; k < n; k++) updateTraffic(simDt / n, null, this.G.camPos());
    p.events.length = 0;
    let x, z, h, spd = 0, rev = false;
    if (sg.kind === 'fwd' || sg.kind === 'rev') {
      const frac = Math.min(1, this.s / sg.len);
      let vkn = sg.v0 + (sg.v1 - sg.v0) * (sg.dock ? frac : Math.max(0, (frac - 0.85) / 0.15));
      if (sg.noWakeSlow && this.G.inNoWake()) vkn = Math.min(vkn, 5);
      spd = vkn * KN;
      this.s += spd * simDt;
      const q = this.sample(sg, Math.min(this.s, sg.len));
      x = q.x; z = q.z;
      rev = sg.kind === 'rev';
      h = sg.kind === 'rev' ? (sg.h != null && this.s < 4 ? sg.h : q.h + Math.PI) : q.h;
      if (sg.kind === 'rev' && sg.h != null) { const blend = Math.min(1, this.s / Math.max(6, sg.len)); h = lerpAng(sg.h, q.h + Math.PI, blend * 0.6); }
      if (this.s >= sg.len) this.enter(this.i + 1);
    } else if (sg.kind === 'pivot') {
      this.t += simDt;
      const f = Math.min(1, this.t / sg.dur);
      x = sg.at.x; z = sg.at.z; h = lerpAng(sg.h0, sg.h1, f * f * (3 - 2 * f));
      if (f >= 1) this.enter(this.i + 1);
    } else if (sg.kind === 'stop') {
      this.t += simDt;
      x = sg.at.x; z = sg.at.z; h = sg.h;
      if (this.t >= sg.dur) {
        if (sg.dwell) advanceEnv(sg.dwell);
        if (sg.final) { this.done = true; this.hooks.finished?.(); }
        else { this.hooks.tie?.(false); this.enter(this.i + 1); }
      }
    }
    // smooth heading changes (a real boat can't snap)
    const dh = Math.atan2(Math.sin(h - p.h), Math.cos(h - p.h));
    const prevX = p.x, prevZ = p.z;
    p.h += dh * Math.min(1, simDt * 2.5);
    p.x = x; p.z = z;
    const dtv = Math.max(1e-3, simDt);
    p.vx = (x - prevX) / dtv; p.vz = (z - prevZ) / dtv;
    p.r = 0; p.u = rev ? -spd : spd; p.v = 0;
    p.depth = depthAt(p.x, p.z) + tideHeight();
    // show realistic lever positions for what the boat is doing
    const lv = sg.levers || [0, 0];
    const kn = spd / KN;
    const lev = sg.kind === 'fwd' && !sg.dock ? [0.25 + 0.75 * Math.min(1, Math.max(0, (kn - 6) / 30)), 0] : lv;
    p.setLever(0, sg.kind === 'stop' ? 0 : lev[0]); p.setLever(1, sg.kind === 'stop' ? 0 : (sg.kind === 'fwd' && !sg.dock ? lev[0] : lv[1]));
    p.engines.forEach(e => { e.thrust = 0; e.rpm = e.running ? 650 + 5350 * e.thr : 0; });
    p.visuals(simDt, p.u, 0.3);
    if (spd > 1) p.wake(Math.min(0.1, simDt), p.u);
    // narration
    for (const nt of this.notes) {
      if (nt.shown) continue;
      if (Math.hypot(nt.x - p.x, nt.z - p.z) < 260) { nt.shown = true; this.log.push(nt.text); this.hooks.note?.(nt.text); }
    }
  }
  sample(sg, s) {
    const S = sg.s;
    let lo = 0, hi = S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    const a = sg.pts[lo], b = sg.pts[hi], t = (s - S[lo]) / Math.max(1e-6, S[hi] - S[lo]);
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: hdgOf(b.x - a.x, b.z - a.z) };
  }
}
function lerpAng(a, b, t) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * t; }
