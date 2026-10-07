// Environment: time of day, sun, tide, tidal currents, wind and wind-driven chop.
import { ll, BOUNDS, sdfAt, distToPolyline, vnoise, depthAt } from './geo.js';

export const KN = 0.514444; // m/s per knot
const D2R = Math.PI / 180;

// ---------------------------------------------------------------- config
export const env = {
  clock: 13.0,            // hours, local (PDT) — Oct 3
  tidePhase: Math.PI * 1.5, // 0..2PI ; sin>0 flood, sin<0 ebb
  tideAmp: 1.0,           // 1 = spring-ish, 0.6 = neap
  tideMode: 'real',       // real | fixed
  windMode: 'auto',       // auto (by time of day) | fixed
  windFixedKn: 15,
  windDirFrom: 255,       // degrees true
  visibility: 20000,      // metres
  fog: 0,                 // 0..1
  time: 0,                // seconds since start (for noise)
  daySpeed: 6,            // sky clock multiplier: the sun visibly moves (6× = a sunset in a few minutes)
};

const TIDE_RATE = Math.PI * 2 / (12.42 * 3600);

export function setTidePreset(p) {
  env.tideMode = p === 'real' ? 'real' : 'fixed';
  const map = { maxflood: 0.5, maxebb: 1.5, slackflood: 0.0, slackebb: 1.0, flood: 0.5, ebb: 1.5, real: 1.35 };
  env.tidePhase = (map[p] ?? 1.5) * Math.PI;
}

export function tideCurrentFactor() { return Math.sin(env.tidePhase) * env.tideAmp; }
export function tideHeight() { return 1.0 - Math.cos(env.tidePhase) * 0.85 * env.tideAmp; } // m above MLLW
export function tideLabel() {
  const s = Math.sin(env.tidePhase), c = Math.cos(env.tidePhase);
  const strength = Math.abs(s * env.tideAmp);
  if (strength < 0.18) return c > 0 ? 'Slack (low water, flood beginning)' : 'Slack (high water, ebb beginning)';
  const word = strength > 0.8 ? 'Max ' : strength > 0.45 ? '' : 'Weak ';
  return word + (s > 0 ? 'Flood (flowing IN)' : 'Ebb (flowing OUT)');
}

// ---------------------------------------------------------------- sun
export function sunPosition(clock) {
  const lat = 37.83 * D2R, dec = -4.0 * D2R;
  const solar = clock - 1 + 0.02; // PDT -> local solar time approx for Oct 3
  const H = (solar - 12) * 15 * D2R;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  let az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  return { alt, az: (az + Math.PI * 2) % (Math.PI * 2) }; // az from north, clockwise
}

// ---------------------------------------------------------------- current field
// Streams: polyline (lat/lon) in FLOOD direction, peak flood kn, peak ebb kn, half-width m.
const STREAMS = [
  { pts: [[37.8130, -122.5250], [37.8160, -122.4780]], flood: 3.6, ebb: 4.8, w: 900 },             // Golden Gate
  { pts: [[37.8160, -122.4780], [37.8215, -122.4500], [37.8255, -122.4320], [37.8270, -122.4080], [37.8250, -122.3850], [37.8280, -122.3500]], flood: 2.6, ebb: 3.2, w: 900 }, // central / slot
  { pts: [[37.8180, -122.4760], [37.8330, -122.4640], [37.8500, -122.4560], [37.8620, -122.4490], [37.8720, -122.4430], [37.8830, -122.4330], [37.9050, -122.4200]], flood: 2.6, ebb: 3.0, w: 520 }, // Raccoon Strait
  { pts: [[37.8130, -122.4700], [37.8118, -122.4450], [37.8125, -122.4200], [37.8110, -122.4040], [37.8030, -122.3900], [37.7960, -122.3800], [37.7870, -122.3760], [37.7700, -122.3780]], flood: 1.8, ebb: 2.4, w: 480 }, // city front
  { pts: [[37.8350, -122.4180], [37.8550, -122.4080], [37.8800, -122.4000], [37.9100, -122.3950]], flood: 1.6, ebb: 1.8, w: 900 }, // east of Angel Island
  { pts: [[37.8060, -122.3800], [37.8000, -122.3680], [37.7950, -122.3500]], flood: 1.4, ebb: 1.6, w: 600 }, // under the west span
  { pts: [[37.8500, -122.4680], [37.8600, -122.4720], [37.8680, -122.4900]], flood: 0.5, ebb: 0.6, w: 350 }, // Richardson Bay entrance
  // city-front back eddy: during flood a counter-current runs WEST close to the shore
  { pts: [[37.8090, -122.4150], [37.8085, -122.4350], [37.8075, -122.4560]], flood: 0.9, ebb: -0.4, w: 160 },
];
// Areas of still water (multiplier on current)
const STILL = [
  [37.8695, -122.4365, 260, 0.08], // Ayala Cove
  [37.8705, -122.4570, 380, 0.12], // Belvedere Cove
  [37.8600, -122.4800, 700, 0.25], // Sausalito waterfront
  [37.8760, -122.4950, 1400, 0.2], // Richardson Bay
  [37.7815, -122.3880, 230, 0.05], // South Beach Harbor
  [37.8095, -122.4100, 230, 0.15], // Pier 39 marina
  [37.8080, -122.4245, 240, 0.12], // Aquatic Park
  [37.8070, -122.4420, 260, 0.1],  // SF Marina
  [37.8150, -122.3700, 450, 0.12], // Clipper Cove
  [37.8340, -122.4762, 200, 0.15], // Horseshoe Cove
];

export const CUR_CELL = 100;
export const CGX = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / CUR_CELL) + 1;
export const CGZ = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / CUR_CELL) + 1;
const floodX = new Float32Array(CGX * CGZ), floodZ = new Float32Array(CGX * CGZ);
const ebbX = new Float32Array(CGX * CGZ), ebbZ = new Float32Array(CGX * CGZ);

function nearestOnPolyline(x, z, pts) {
  let best = 1e18, dirx = 0, dirz = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + dx * t - x, ez = az + dz * t - z, d = ex * ex + ez * ez;
    if (d < best) { best = d; const L = Math.sqrt(L2); dirx = dx / L; dirz = dz / L; }
  }
  return { d: Math.sqrt(best), dirx, dirz };
}

function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export function buildCurrents() {
  const streams = STREAMS.map(s => ({ ...s, xz: s.pts.map(([a, b]) => { const p = ll(a, b); return [p.x, p.z]; }) }));
  const still = STILL.map(([la, lo, r, m]) => { const p = ll(la, lo); return [p.x, p.z, r, m]; });
  for (let j = 0; j < CGZ; j++) for (let i = 0; i < CGX; i++) {
    const x = BOUNDS.minX + i * CUR_CELL, z = BOUNDS.minZ + j * CUR_CELL, k = j * CGX + i;
    const s = sdfAt(x, z);
    if (s > 0) continue;
    let fx = 0, fz = 0, ex = 0, ez = 0, wsum = 0;
    for (const st of streams) {
      const n = nearestOnPolyline(x, z, st.xz);
      const w = Math.exp(-((n.d / st.w) ** 2));
      if (w < 0.01) continue;
      fx += n.dirx * st.flood * w; fz += n.dirz * st.flood * w;
      ex -= n.dirx * st.ebb * w; ez -= n.dirz * st.ebb * w;
      wsum += w;
    }
    // general bay "fill/drain" background
    const bg = 0.25 * Math.max(0, 1 - wsum);
    fx += 0.7 * bg; fz += -0.2 * bg; ex -= 0.7 * bg; ez -= -0.2 * bg;
    let att = smoothstep(8, 220, -s);
    for (const [sx, sz, r, m] of still) {
      const d = Math.hypot(sx - x, sz - z);
      if (d < r * 1.6) att *= m + (1 - m) * smoothstep(r * 0.7, r * 1.6, d);
    }
    // depth matters a little: shallow water flows slower
    const dep = depthAt(x, z);
    if (dep > 0 && dep < 3) att *= 0.4 + 0.2 * dep;
    const f = KN * att;
    floodX[k] = fx * f; floodZ[k] = fz * f; ebbX[k] = ex * f; ebbZ[k] = ez * f;
  }
}

const _cur = { x: 0, z: 0 };
export function currentAt(x, z, out = _cur) {
  let fi = (x - BOUNDS.minX) / CUR_CELL, fj = (z - BOUNDS.minZ) / CUR_CELL;
  fi = Math.max(0, Math.min(CGX - 1.001, fi)); fj = Math.max(0, Math.min(CGZ - 1.001, fj));
  const i = fi | 0, j = fj | 0, u = fi - i, v = fj - j, k = j * CGX + i;
  const s = tideCurrentFactor();
  const AX = s >= 0 ? floodX : ebbX, AZ = s >= 0 ? floodZ : ebbZ, m = Math.abs(s);
  const bl = (A) => ((A[k] * (1 - u) + A[k + 1] * u) * (1 - v) + (A[k + CGX] * (1 - u) + A[k + CGX + 1] * u) * v);
  out.x = bl(AX) * m; out.z = bl(AZ) * m;
  return out;
}

// ---------------------------------------------------------------- wind
const WIND_BY_HOUR = [[6, 3], [9, 5], [10, 6], [11, 9], [12, 12], [13, 15], [14, 18], [15, 20], [16, 21], [17, 19], [18, 15], [19, 11], [21, 6], [24, 4]];
export function baseWindKn(clock) {
  if (env.windMode === 'fixed') return env.windFixedKn;
  for (let i = 0; i + 1 < WIND_BY_HOUR.length; i++) {
    const [h0, w0] = WIND_BY_HOUR[i], [h1, w1] = WIND_BY_HOUR[i + 1];
    if (clock >= h0 && clock <= h1) return w0 + (w1 - w0) * (clock - h0) / (h1 - h0);
  }
  return 4;
}

// zone: lat, lon, radius, multiplier, gustiness, direction offset (deg, + = more northerly/right)
const WIND_ZONES = [
  { line: [[37.8160, -122.4900], [37.8260, -122.4250], [37.8260, -122.3900], [37.8300, -122.3550]], r: 1300, mul: 1.25, gust: 0.15, dir: 0 }, // the Slot
  { p: [37.8560, -122.4820], r: 1300, mul: 0.6, gust: 0.5, dir: 25 },  // Sausalito lee (williwaws)
  { p: [37.8740, -122.4960], r: 1500, mul: 0.72, gust: 0.35, dir: 20 }, // Richardson Bay
  { p: [37.8700, -122.4570], r: 480, mul: 0.5, gust: 0.45, dir: 15 },  // Belvedere Cove
  { p: [37.8695, -122.4365], r: 380, mul: 0.35, gust: 0.35, dir: 0 },  // Ayala Cove
  { p: [37.8680, -122.4450], r: 900, mul: 1.0, gust: 0.25, dir: -12 }, // Raccoon Strait
  { p: [37.8620, -122.4100], r: 1200, mul: 0.62, gust: 0.3, dir: 10 }, // Angel Island lee
  { p: [37.7850, -122.3850], r: 1900, mul: 0.7, gust: 0.25, dir: 10 }, // south of the Bay Bridge
  { p: [37.8070, -122.4250], r: 700, mul: 0.82, gust: 0.25, dir: 0 },  // city front shoreline
  { p: [37.8150, -122.3700], r: 550, mul: 0.45, gust: 0.35, dir: 0 },  // Clipper Cove
  { p: [37.8340, -122.4765], r: 320, mul: 0.5, gust: 0.4, dir: 0 },   // Horseshoe Cove
  { p: [37.8395, -122.4715], r: 500, mul: 1.15, gust: 0.55, dir: 15 }, // Yellow Bluff
];
const WCELL = 200;
const WGX = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / WCELL) + 1, WGZ = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / WCELL) + 1;
const wMul = new Float32Array(WGX * WGZ), wGust = new Float32Array(WGX * WGZ), wDir = new Float32Array(WGX * WGZ);
const fetchGrid = new Float32Array(CGX * CGZ);

export function buildWind() {
  const zones = WIND_ZONES.map(zn => zn.line
    ? { ...zn, xz: zn.line.map(([a, b]) => { const p = ll(a, b); return [p.x, p.z]; }) }
    : { ...zn, c: ll(zn.p[0], zn.p[1]) });
  for (let j = 0; j < WGZ; j++) for (let i = 0; i < WGX; i++) {
    const x = BOUNDS.minX + i * WCELL, z = BOUNDS.minZ + j * WCELL, k = j * WGX + i;
    let mul = 1, gust = 0.2, dir = 0;
    for (const zn of zones) {
      const d = zn.xz ? distToPolyline(x, z, zn.xz) : Math.hypot(zn.c.x - x, zn.c.z - z);
      const w = Math.exp(-((d / zn.r) ** 2));
      mul += (zn.mul - 1) * w; gust += (zn.gust - 0.2) * w; dir += zn.dir * w;
    }
    wMul[k] = Math.max(0.25, Math.min(1.4, mul)); wGust[k] = Math.max(0.1, gust); wDir[k] = dir;
  }
  // fetch (distance to land upwind) for chop
  const from = env.windDirFrom * D2R, ux = Math.sin(from), uz = -Math.cos(from);
  for (let j = 0; j < CGZ; j++) for (let i = 0; i < CGX; i++) {
    const x = BOUNDS.minX + i * CUR_CELL, z = BOUNDS.minZ + j * CUR_CELL;
    let f = 0;
    for (; f < 4000; f += 100) if (sdfAt(x + ux * f, z + uz * f) > 0) break;
    if (x + ux * f < BOUNDS.minX) f = 4000; // open to the ocean through the Gate
    fetchGrid[j * CGX + i] = f;
  }
}

function sampleW(grid, x, z) {
  let fi = (x - BOUNDS.minX) / WCELL, fj = (z - BOUNDS.minZ) / WCELL;
  fi = Math.max(0, Math.min(WGX - 1.001, fi)); fj = Math.max(0, Math.min(WGZ - 1.001, fj));
  const i = fi | 0, j = fj | 0, u = fi - i, v = fj - j, k = j * WGX + i;
  return (grid[k] * (1 - u) + grid[k + 1] * u) * (1 - v) + (grid[k + WGX] * (1 - u) + grid[k + WGX + 1] * u) * v;
}

const _w = { x: 0, z: 0, speed: 0, fromDeg: 0, gust: 0 };
export function windAt(x, z, out = _w) {
  const base = baseWindKn(env.clock) * KN;
  const mul = sampleW(wMul, x, z), g = sampleW(wGust, x, z), dOff = sampleW(wDir, x, z);
  const t = env.time;
  const n = vnoise(t * 0.12 + x * 0.0015, z * 0.0015 + t * 0.03) * 2 - 1;
  const n2 = vnoise(t * 0.5 + x * 0.004 + 50, z * 0.004) * 2 - 1;
  const gustF = 1 + g * (0.7 * n + 0.3 * n2);
  const speed = Math.max(0, base * mul * gustF);
  const fromDeg = env.windDirFrom + dOff + n * 8;
  const to = (fromDeg + 180) * D2R;
  out.x = Math.sin(to) * speed; out.z = -Math.cos(to) * speed; out.speed = speed; out.fromDeg = (fromDeg + 360) % 360; out.gust = gustF;
  return out;
}

// ---------------------------------------------------------------- chop (wave amplitude field, metres)
export const chopData = new Float32Array(CGX * CGZ * 2); // [chopAmp, swellAmp]
const GG = ll(37.8160, -122.4785);
export function updateChop() {
  const base = baseWindKn(env.clock);
  const from = env.windDirFrom * D2R, wx = -Math.sin(from), wz = Math.cos(from); // direction wind blows toward
  const c = { x: 0, z: 0 };
  for (let j = 0; j < CGZ; j++) for (let i = 0; i < CGX; i++) {
    const x = BOUNDS.minX + i * CUR_CELL, z = BOUNDS.minZ + j * CUR_CELL, k = j * CGX + i;
    const s = sdfAt(x, z);
    if (s > 0) { chopData[k * 2] = 0; chopData[k * 2 + 1] = 0; continue; }
    const W = base * sampleW(wMul, x, z);
    const fetch = 0.25 + 0.75 * smoothstep(80, 2800, fetchGrid[k]);
    currentAt(x, z, c);
    const opposing = Math.max(0, -(c.x * wx + c.z * wz)) / KN; // knots of current against the wind
    let h = 0.0016 * W * W * fetch * (1 + 0.38 * opposing);
    h *= smoothstep(0, 60, -s) * 0.7 + 0.3;
    const dep = depthAt(x, z);
    if (dep > 0 && dep < 2.5) h *= 0.5;
    const dg = Math.hypot(x - GG.x, z - GG.z);
    const swell = 0.55 * Math.exp(-dg / 1800) * (x < GG.x ? 1.3 : 1);
    chopData[k * 2] = Math.min(1.6, h); chopData[k * 2 + 1] = swell;
  }
}
export function chopAt(x, z) {
  let fi = (x - BOUNDS.minX) / CUR_CELL, fj = (z - BOUNDS.minZ) / CUR_CELL;
  fi = Math.max(0, Math.min(CGX - 1.001, fi)); fj = Math.max(0, Math.min(CGZ - 1.001, fj));
  const i = fi | 0, j = fj | 0, u = fi - i, v = fj - j, k = j * CGX + i;
  const bl = (o) => (chopData[k * 2 + o] * (1 - u) + chopData[(k + 1) * 2 + o] * u) * (1 - v) + (chopData[(k + CGX) * 2 + o] * (1 - u) + chopData[(k + CGX + 1) * 2 + o] * u) * v;
  return { chop: bl(0), swell: bl(1) };
}

// Wave components shared with the water shader. dir offsets relative to wind-to direction.
export const WAVES = [
  { len: 9.0, amp: 0.45, off: 0, speedMul: 1 },
  { len: 13.5, amp: 0.35, off: 0.45, speedMul: 1 },
  { len: 5.5, amp: 0.22, off: -0.6, speedMul: 1 },
  { len: 19, amp: 0.25, off: -0.25, speedMul: 1 },
];
export const SWELL = { len: 95, dirDeg: 255 + 180 + 15 };

export function waveHeight(x, z, t) {
  const { chop, swell } = chopAt(x, z);
  const to = (env.windDirFrom + 180) * D2R;
  let h = 0;
  for (const w of WAVES) {
    const a = to + w.off, k = Math.PI * 2 / w.len, c = Math.sqrt(9.81 / k);
    const dx = Math.sin(a), dz = -Math.cos(a);
    h += Math.sin((dx * x + dz * z) * k - c * k * t) * w.amp * chop;
  }
  {
    const a = SWELL.dirDeg * D2R, k = Math.PI * 2 / SWELL.len, c = Math.sqrt(9.81 / k);
    h += Math.sin((Math.sin(a) * x - Math.cos(a) * z) * k - c * k * t) * swell;
  }
  return h;
}

export function advanceClock(dt) {
  env.clock += dt * env.daySpeed / 3600;
  if (env.clock >= 24) env.clock -= 24;
}
export function advanceEnv(dt) {
  env.time += dt;
  advanceClock(dt);
  if (env.tideMode === 'real') env.tidePhase = (env.tidePhase + dt * TIDE_RATE) % (Math.PI * 2);
}
