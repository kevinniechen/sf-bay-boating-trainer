// Geography of the central San Francisco Bay.
// Local tangent-plane projection: x = east (m), z = south (m), y = up. North is -z.
// Coordinates are approximations from memory of NOAA chart 18649/18653 — good for
// learning the lay of the land, NOT for navigation.

export const LAT0 = 37.83, LON0 = -122.43;
const MLAT = 110574;
const MLON = 111320 * Math.cos(LAT0 * Math.PI / 180);

export function ll(lat, lon) { return { x: (lon - LON0) * MLON, z: -(lat - LAT0) * MLAT }; }
export function toLL(x, z) { return { lat: LAT0 - z / MLAT, lon: LON0 + x / MLON }; }
export const llx = (lat, lon) => (lon - LON0) * MLON;
export const llz = (lat) => -(lat - LAT0) * MLAT;

export const BOUNDS = {
  minX: llx(0, -122.52), maxX: llx(0, -122.35),
  minZ: llz(37.92), maxZ: llz(37.765),
};

// ---------------------------------------------------------------- landmasses
// type: city | hills | island | rock | flat
export const LANDMASSES = [
  {
    name: 'San Francisco', type: 'city', pts: [
      [37.8108, -122.4772], [37.8098, -122.4752], [37.8075, -122.4718], [37.8060, -122.4668], [37.8050, -122.4610],
      [37.8046, -122.4550], [37.8052, -122.4505], [37.8060, -122.4478], [37.8057, -122.4445], [37.8055, -122.4400],
      [37.8056, -122.4360], [37.8061, -122.4335], [37.8065, -122.4310], [37.8061, -122.4285], [37.8057, -122.4262],
      [37.8054, -122.4240], [37.8062, -122.4220], [37.8075, -122.4200], [37.8079, -122.4170], [37.8081, -122.4135],
      [37.8082, -122.4105], [37.8076, -122.4078], [37.8071, -122.4058], [37.8064, -122.4040], [37.8055, -122.4023],
      [37.8045, -122.4010], [37.8033, -122.4000], [37.8020, -122.3990], [37.8005, -122.3979], [37.7990, -122.3968],
      [37.7975, -122.3957], [37.7962, -122.3948], [37.7950, -122.3943], [37.7938, -122.3932], [37.7922, -122.3918],
      [37.7905, -122.3906], [37.7888, -122.3900], [37.7870, -122.3897], [37.7850, -122.3895], [37.7832, -122.3895],
      [37.7815, -122.3890], [37.7805, -122.3885], [37.7796, -122.3880], [37.7789, -122.3872], [37.7779, -122.3884],
      [37.7773, -122.3900], [37.7764, -122.3897], [37.7757, -122.3872], [37.7740, -122.3866], [37.7700, -122.3868],
      [37.7600, -122.3870], [37.7600, -122.5300], [37.7870, -122.5300], [37.7880, -122.5060], [37.7900, -122.4950],
      [37.7935, -122.4845], [37.8020, -122.4810], [37.8085, -122.4795],
    ],
  },
  {
    name: 'Marin', type: 'hills', pts: [
      [37.8150, -122.5300], [37.8195, -122.5100], [37.8230, -122.4990], [37.8262, -122.4900], [37.8250, -122.4830],
      [37.8236, -122.4798], [37.8262, -122.4772], [37.8295, -122.4762], [37.8322, -122.4752], [37.8331, -122.4772],
      [37.8344, -122.4778], [37.8357, -122.4760], [37.8356, -122.4725], [37.8368, -122.4705], [37.8395, -122.4708],
      [37.8425, -122.4722], [37.8462, -122.4742], [37.8500, -122.4757], [37.8535, -122.4765], [37.8558, -122.4770],
      [37.8572, -122.4776], [37.8580, -122.4790], [37.8595, -122.4805], [37.8610, -122.4825], [37.8625, -122.4850],
      [37.8640, -122.4885], [37.8655, -122.4915], [37.8678, -122.4942], [37.8705, -122.4968], [37.8740, -122.4995],
      [37.8780, -122.5030], [37.8830, -122.5075], [37.8880, -122.5110], [37.8905, -122.5080],
      // east shore of Richardson Bay, heading south (Strawberry, Belvedere)
      [37.8900, -122.5000], [37.8880, -122.4950], [37.8850, -122.4930], [37.8820, -122.4880], [37.8790, -122.4820],
      [37.8760, -122.4770], [37.8740, -122.4740], [37.8720, -122.4728],
      // Belvedere Island
      [37.8695, -122.4725], [37.8668, -122.4708], [37.8648, -122.4680], [37.8638, -122.4645], [37.8642, -122.4612],
      [37.8660, -122.4598], [37.8685, -122.4592], [37.8710, -122.4592], [37.8728, -122.4598],
      // Tiburon downtown (Belvedere Cove side) and Point Tiburon
      [37.8738, -122.4582], [37.8737, -122.4565], [37.8731, -122.4553], [37.8722, -122.4542], [37.8712, -122.4532],
      [37.8708, -122.4520],
      // Tiburon east shore along Raccoon Strait
      [37.8722, -122.4505], [37.8745, -122.4488], [37.8775, -122.4462], [37.8805, -122.4430], [37.8840, -122.4405],
      [37.8890, -122.4395], [37.8960, -122.4415], [37.9040, -122.4460], [37.9120, -122.4510], [37.9300, -122.4510],
      [37.9300, -122.5300],
    ],
  },
  {
    name: 'Angel Island', type: 'island', pts: [
      [37.8700, -122.4395], [37.8662, -122.4450], [37.8625, -122.4474], [37.8600, -122.4472], [37.8565, -122.4445],
      [37.8538, -122.4392], [37.8520, -122.4310], [37.8526, -122.4230], [37.8536, -122.4186], [37.8578, -122.4172],
      [37.8620, -122.4178], [37.8668, -122.4192], [37.8706, -122.4222], [37.8730, -122.4268], [37.8732, -122.4315],
      [37.8708, -122.4334], [37.8692, -122.4343], [37.8679, -122.4358], [37.8684, -122.4380],
    ],
  },
  { name: 'Alcatraz', type: 'rock', ellipse: { lat: 37.8267, lon: -122.4228, a: 255, b: 85, bearing: 330 } },
  {
    name: 'Yerba Buena Island', type: 'island', pts: [
      [37.8135, -122.3712], [37.8150, -122.3660], [37.8140, -122.3605], [37.8105, -122.3575], [37.8065, -122.3590],
      [37.8045, -122.3640], [37.8055, -122.3700], [37.8090, -122.3735],
    ],
  },
  {
    name: 'Treasure Island', type: 'flat', pts: [
      [37.8172, -122.3728], [37.8292, -122.3772], [37.8328, -122.3702], [37.8306, -122.3605], [37.8202, -122.3580],
      [37.8166, -122.3615], [37.8152, -122.3625], [37.8150, -122.3640], [37.8166, -122.3660],
    ],
  },
];

// Expand ellipses into polygons and project everything.
for (const L of LANDMASSES) {
  if (L.ellipse) {
    const e = L.ellipse, c = ll(e.lat, e.lon), th = e.bearing * Math.PI / 180;
    const fx = Math.sin(th), fz = -Math.cos(th), rx = Math.cos(th), rz = Math.sin(th);
    L.xz = [];
    for (let i = 0; i < 28; i++) {
      const t = i / 28 * Math.PI * 2;
      const a = Math.cos(t) * e.a, b = Math.sin(t) * e.b * (1 + 0.15 * Math.sin(3 * t));
      L.xz.push([c.x + fx * a + rx * b, c.z + fz * a + rz * b]);
    }
  } else {
    L.xz = L.pts.map(([la, lo]) => { const p = ll(la, lo); return [p.x, p.z]; });
  }
}

// ---------------------------------------------------------------- hills (gaussian bumps, metres)
export const HILLS = [
  // SF
  [37.8024, -122.4058, 70, 230], [37.8010, -122.4190, 80, 380], [37.7930, -122.4130, 95, 420],
  [37.7920, -122.4350, 100, 800], [37.7980, -122.4640, 90, 1100], [37.7860, -122.3930, 25, 200],
  [37.7890, -122.4800, 60, 700],
  // Marin headlands / Sausalito ridge / Tiburon
  [37.8320, -122.4900, 180, 1200], [37.8450, -122.4850, 200, 1000], [37.8580, -122.4900, 170, 800],
  [37.8700, -122.5100, 150, 1000], [37.8850, -122.4650, 150, 1100], [37.8950, -122.4550, 120, 900],
  [37.8680, -122.4660, 85, 330],
  // Angel Island (Mt Livermore 788 ft)
  [37.8609, -122.4326, 215, 750],
  // YBI
  [37.8098, -122.3650, 95, 350],
];

// ---------------------------------------------------------------- SDF grid
export const CELL = 25;
export const GX = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / CELL) + 1;
export const GZ = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / CELL) + 1;
export const sdf = new Float32Array(GX * GZ);     // + inside land, - water (metres)
export const landId = new Int8Array(GX * GZ);      // landmass index or -1
export const depthGrid = new Float32Array(GX * GZ); // metres at MLLW (water only)
export const heightGrid = new Float32Array(GX * GZ); // terrain height (land)

let segs = null;
function buildSegs() {
  const arr = [];
  for (const L of LANDMASSES) {
    const p = L.xz;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      arr.push(a[0], a[1], b[0], b[1]);
    }
  }
  segs = new Float64Array(arr);
}

function minSegDist2(px, pz) {
  let best = 1e18;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i], az = segs[i + 1], bx = segs[i + 2], bz = segs[i + 3];
    const dx = bx - ax, dz = bz - az;
    let t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz + 1e-9);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + dx * t - px, ez = az + dz * t - pz;
    const d = ex * ex + ez * ez;
    if (d < best) best = d;
  }
  return best;
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

function fillLandIds() {
  landId.fill(-1);
  for (let li = 0; li < LANDMASSES.length; li++) {
    const poly = LANDMASSES[li].xz;
    for (let j = 0; j < GZ; j++) {
      const z = BOUNDS.minZ + j * CELL;
      const xs = [];
      for (let i = 0, k = poly.length - 1; i < poly.length; k = i++) {
        const zi = poly[i][1], zk = poly[k][1];
        if ((zi > z) !== (zk > z)) xs.push(poly[i][0] + (z - zi) * (poly[k][0] - poly[i][0]) / (zk - zi));
      }
      xs.sort((a, b) => a - b);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        let i0 = Math.ceil((xs[n] - BOUNDS.minX) / CELL), i1 = Math.floor((xs[n + 1] - BOUNDS.minX) / CELL);
        i0 = Math.max(0, i0); i1 = Math.min(GX - 1, i1);
        for (let i = i0; i <= i1; i++) landId[j * GX + i] = li;
      }
    }
  }
}

function computeSDF() {
  // coarse pass (100 m) then exact pass near the coast
  const CC = 4;
  const cgx = Math.ceil(GX / CC) + 1, cgz = Math.ceil(GZ / CC) + 1;
  const coarse = new Float32Array(cgx * cgz);
  for (let j = 0; j < cgz; j++) for (let i = 0; i < cgx; i++) {
    coarse[j * cgx + i] = Math.sqrt(minSegDist2(BOUNDS.minX + i * CC * CELL, BOUNDS.minZ + j * CC * CELL));
  }
  for (let j = 0; j < GZ; j++) {
    const cj = j / CC, j0 = Math.floor(cj), fj = cj - j0;
    for (let i = 0; i < GX; i++) {
      const ci = i / CC, i0 = Math.floor(ci), fi = ci - i0;
      const c00 = coarse[j0 * cgx + i0], c10 = coarse[j0 * cgx + i0 + 1];
      const c01 = coarse[(j0 + 1) * cgx + i0], c11 = coarse[(j0 + 1) * cgx + i0 + 1];
      let d = (c00 * (1 - fi) + c10 * fi) * (1 - fj) + (c01 * (1 - fi) + c11 * fi) * fj;
      if (d < 260) d = Math.sqrt(minSegDist2(BOUNDS.minX + i * CELL, BOUNDS.minZ + j * CELL));
      const idx = j * GX + i;
      sdf[idx] = landId[idx] >= 0 ? d : -d;
    }
  }
}

// ---------------------------------------------------------------- bathymetry
// Polylines & zones in lat/lon. Depths in metres at MLLW.
export const SAUSALITO_CHANNEL = [
  [37.8520, -122.4700], [37.8565, -122.4735], [37.8600, -122.4775], [37.8630, -122.4830],
  [37.8660, -122.4890], [37.8690, -122.4930], [37.8725, -122.4960],
];
export const ROCKS = [
  // lat, lon, radius m, depth m, name
  [37.8064, -122.4553, 25, 0.8, 'Anita Rock'],
  [37.8282, -122.4268, 20, 0.6, 'Little Alcatraz'],
  [37.8531, -122.4178, 55, 1.2, 'Point Blunt reef'],
  [37.8635, -122.4635, 40, 1.4, 'Belvedere Point shoal'],
  [37.8392, -122.4706, 40, 1.8, 'Yellow Bluff'],
];
const RB_POLY_LL = [
  [37.8555, -122.4790], [37.8600, -122.4640], [37.8640, -122.4620], [37.8760, -122.4760],
  [37.8920, -122.5040], [37.8900, -122.5130], [37.8700, -122.4990],
];
let RB_POLY = null, CH_XZ = null;

function distToPolyline(x, z, pts) {
  let best = 1e18;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    let t = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
    t = Math.max(0, Math.min(1, t));
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}

const DEEP_LINES = [
  // [polyline lat/lon, extra depth m, width m]
  [[[37.8130, -122.5300], [37.8165, -122.4780], [37.8190, -122.4600]], 80, 700],          // Golden Gate
  [[[37.8190, -122.4600], [37.8240, -122.4350], [37.8260, -122.4050], [37.8240, -122.3800]], 16, 900], // central bay
  [[[37.8300, -122.4600], [37.8550, -122.4530], [37.8680, -122.4460], [37.8800, -122.4350]], 22, 420], // Raccoon Strait
  [[[37.8060, -122.3800], [37.8000, -122.3680], [37.7950, -122.3500]], 8, 450],          // bridge channel
];
let DEEP_XZ = null;
function depthFor(x, z, dist) {
  const { lat, lon } = toLL(x, z);
  if (!DEEP_XZ) DEEP_XZ = DEEP_LINES.map(([pts, e, w]) => [pts.map(([a, b]) => { const p = ll(a, b); return [p.x, p.z]; }), e, w]);
  let cap = lat < 37.792 ? 12 : 14, slope = 0.05;
  for (const [pts, e, w] of DEEP_XZ) {
    const dd = distToPolyline(x, z, pts), k = Math.exp(-((dd / w) ** 2));
    cap += e * k; slope += 0.1 * k * (e / 40);
  }
  let d = Math.min(cap, 1.2 + dist * slope);
  // Richardson Bay — very shallow outside the dredged channel
  if (pointInPoly(x, z, RB_POLY)) {
    const north = lat > 37.877 ? 0.5 : lat > 37.870 ? 1.2 : 2.0;
    d = Math.min(d, north + Math.min(1.2, dist * 0.01));
    const cd = distToPolyline(x, z, CH_XZ);
    if (cd < 70) d = Math.max(d, 4.2 - cd * 0.02);
  }
  // Belvedere Cove
  if (lat > 37.8655 && lat < 37.874 && lon > -122.4605 && lon < -122.452) d = Math.min(d, 1.0 + dist * 0.03, 5.5);
  // Ayala Cove
  if (lat > 37.866 && lat < 37.8725 && lon > -122.440 && lon < -122.432) d = Math.min(d, 0.8 + dist * 0.025, 4.5);
  // Clipper Cove
  if (lat > 37.8128 && lat < 37.8172 && lon > -122.3790 && lon < -122.3610) d = Math.min(d, lon < -122.373 ? 1.8 : 3.8);
  // Aquatic Park
  if (lat > 37.8055 && lat < 37.8105 && lon > -122.4282 && lon < -122.4208) d = Math.min(d, 0.8 + dist * 0.03, 3.8);
  // marinas (dredged)
  if (lat > 37.778 && lat < 37.7836 && lon > -122.3905 && lon < -122.3855) d = Math.min(Math.max(d, 3.5), 4.2);
  for (const [la, lo, r, rd] of ROCKS) {
    if (!r) continue;
    const p = ll(la, lo), dd = Math.hypot(p.x - x, p.z - z);
    if (dd < r * 2.2) d = Math.min(d, rd + Math.max(0, dd - r) * 0.25);
  }
  return Math.max(0.2, d);
}

function computeDepthAndHeight() {
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const idx = j * GX + i, x = BOUNDS.minX + i * CELL, z = BOUNDS.minZ + j * CELL, s = sdf[idx];
    if (s < 0) { depthGrid[idx] = depthFor(x, z, -s); heightGrid[idx] = -depthGrid[idx]; }
    else { depthGrid[idx] = -1; heightGrid[idx] = landHeight(x, z, s, landId[idx]); }
  }
}

// cheap deterministic value noise
function hash(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export function fbm(x, z) { return vnoise(x, z) * 0.5 + vnoise(x * 2.1, z * 2.1) * 0.3 + vnoise(x * 4.3, z * 4.3) * 0.2; }

const HILLS_XZ = HILLS.map(([la, lo, h, r]) => { const p = ll(la, lo); return [p.x, p.z, h, r]; });
function landHeight(x, z, d, id) {
  const L = LANDMASSES[id], t = L.type;
  let h;
  const coast = Math.min(1, d / 60);
  if (t === 'city') h = 3 + Math.min(25, d * 0.025);
  else if (t === 'hills') h = 2 + 250 * (1 - Math.exp(-d / 700)) * (0.55 + 0.45 * fbm(x / 900, z / 900));
  else if (t === 'island') h = 2 + 40 * (1 - Math.exp(-d / 200));
  else if (t === 'rock') h = 2 + 30 * Math.min(1, d / 18);
  else h = 3.5;
  if (t !== 'flat' && t !== 'rock') {
    for (const [hx, hz, hh, hr] of HILLS_XZ) {
      const dd = (hx - x) ** 2 + (hz - z) ** 2;
      if (dd < hr * hr * 9) h += hh * Math.exp(-dd / (hr * hr)) * coast;
    }
    h += (fbm(x / 160, z / 160) - 0.5) * 12 * coast;
  }
  return Math.max(1.5, h);
}

// ---------------------------------------------------------------- samplers
function bilinear(grid, x, z) {
  let fi = (x - BOUNDS.minX) / CELL, fj = (z - BOUNDS.minZ) / CELL;
  if (fi < 0) fi = 0; if (fj < 0) fj = 0;
  if (fi > GX - 1.001) fi = GX - 1.001; if (fj > GZ - 1.001) fj = GZ - 1.001;
  const i = fi | 0, j = fj | 0, u = fi - i, v = fj - j, k = j * GX + i;
  return (grid[k] * (1 - u) + grid[k + 1] * u) * (1 - v) + (grid[k + GX] * (1 - u) + grid[k + GX + 1] * u) * v;
}
export const sdfAt = (x, z) => bilinear(sdf, x, z);
export const terrainAt = (x, z) => bilinear(heightGrid, x, z);
export function depthAt(x, z) { // metres at MLLW; negative = land
  const s = sdfAt(x, z);
  if (s > 0) return -1;
  return bilinear(depthGrid, x, z);
}
export function landAt(x, z) {
  const fi = Math.round((x - BOUNDS.minX) / CELL), fj = Math.round((z - BOUNDS.minZ) / CELL);
  if (fi < 0 || fj < 0 || fi >= GX || fj >= GZ) return -1;
  return landId[fj * GX + fi];
}
export function sdfGrad(x, z) {
  const e = 6;
  const gx = sdfAt(x + e, z) - sdfAt(x - e, z), gz = sdfAt(x, z + e) - sdfAt(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  return { x: gx / l, z: gz / l };
}

// ---------------------------------------------------------------- regulatory / chart overlays
export const NO_WAKE_ZONES = [
  { name: 'Sausalito waterfront & Richardson Bay (5 kn)', poly: [[37.8545, -122.4790], [37.8580, -122.4735], [37.8650, -122.4760], [37.8760, -122.4840], [37.8920, -122.5060], [37.8890, -122.5140], [37.8700, -122.5000]] },
  { name: 'Tiburon waterfront / Main St basin (no wake)', poly: [[37.8740, -122.4590], [37.8740, -122.4530], [37.8700, -122.4525], [37.8698, -122.4590]] },
  { name: 'Ayala Cove (5 mph)', poly: [[37.8668, -122.4398], [37.8708, -122.4398], [37.8708, -122.4340], [37.8668, -122.4340]] },
  { name: 'South Beach Harbor (5 kn)', poly: [[37.7836, -122.3902], [37.7836, -122.3858], [37.7795, -122.3850], [37.7795, -122.3902]] },
  { name: 'Pier 39 Marina (5 kn)', poly: [[37.8078, -122.4140], [37.8112, -122.4140], [37.8112, -122.4060], [37.8072, -122.4060]] },
  { name: 'Aquatic Park (swim area, 5 mph)', poly: [[37.8055, -122.4282], [37.8100, -122.4282], [37.8104, -122.4212], [37.8070, -122.4205]] },
  { name: 'SF Marina / St. Francis (5 kn)', poly: [[37.8055, -122.4480], [37.8085, -122.4480], [37.8085, -122.4370], [37.8055, -122.4370]] },
  { name: 'Clipper Cove (5 kn)', poly: [[37.8128, -122.3790], [37.8172, -122.3790], [37.8172, -122.3640], [37.8135, -122.3640]] },
  { name: 'Horseshoe Cove (5 kn)', poly: [[37.8318, -122.4780], [37.8360, -122.4780], [37.8360, -122.4735], [37.8318, -122.4735]] },
];

// Approximate deep-draft routes (VTS). Width in metres.
export const SHIP_LANES = [
  { name: 'Golden Gate ↔ Oakland (via south of Alcatraz & Bay Bridge west span)', width: 500,
    pts: [[37.8135, -122.5200], [37.8165, -122.4780], [37.8195, -122.4500], [37.8195, -122.4300], [37.8160, -122.4060], [37.8070, -122.3800], [37.8035, -122.3720], [37.7990, -122.3600], [37.7960, -122.3500]] },
  { name: 'Golden Gate ↔ Richmond / San Pablo Bay (north of Alcatraz)', width: 500,
    pts: [[37.8195, -122.4500], [37.8340, -122.4300], [37.8420, -122.4050], [37.8530, -122.3850], [37.8800, -122.3650], [37.9100, -122.3600]] },
];

export const HAZARDS = [
  { lat: 37.8064, lon: -122.4553, name: 'Anita Rock', note: 'Rock awash at low tide off St. Francis YC — give it room.' },
  { lat: 37.8531, lon: -122.4178, name: 'Point Blunt', note: 'Reef + tide rips off Angel Island SE point. Steep chop on ebb.' },
  { lat: 37.8392, lon: -122.4706, name: 'Yellow Bluff', note: 'Strong back-eddies, gusts and confused water between Sausalito and Horseshoe Cove.' },
  { lat: 37.8282, lon: -122.4268, name: 'Little Alcatraz', note: 'Rock off Alcatraz NW tip.' },
  { lat: 37.8635, lon: -122.4635, name: 'Belvedere Point', note: 'Shoal off the point; strong current at the Raccoon Strait entrance.' },
  { lat: 37.8780, lon: -122.4900, name: 'Richardson Bay flats', note: 'Mudflats < 3 ft at low tide outside the marked channel. Stay in the channel!' },
  { lat: 37.8115, lon: -122.4777, name: 'GG South Tower', note: 'Big eddies and standing waves around the south tower on ebb.' },
];

// ---------------------------------------------------------------- real elevation data (USGS 3DEP + NOAA bathymetry)
// data/terrain.png covers exactly BOUNDS (lat 37.765–37.92, lon -122.52 – -122.35), north-up,
// linear in lat/lon; height = (R*256 + G)/10 - 1000 metres. region_terrain.png covers REGION.
export const MAIN_LL = { lat0: 37.765, lat1: 37.92, lon0: -122.52, lon1: -122.35 };
export const REGION_LL = { lat0: 37.55, lat1: 38.10, lon0: -122.80, lon1: -122.05 };
export const DEM = { main: null, region: null };
async function loadHeightPNG(url, bounds) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const h = new Float32Array(bmp.width * bmp.height);
  for (let i = 0; i < h.length; i++) h[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 10 - 1000;
  return { w: bmp.width, h: bmp.height, data: h, ...bounds };
}
export async function loadDEM() {
  try {
    [DEM.main, DEM.region] = await Promise.all([loadHeightPNG('data/terrain.png', MAIN_LL), loadHeightPNG('data/region_terrain.png', REGION_LL)]);
  } catch (e) { console.warn('DEM unavailable, using built-in coastline', e); }
}
export function demAt(dem, lat, lon) {
  let fx = (lon - dem.lon0) / (dem.lon1 - dem.lon0) * (dem.w - 1), fy = (dem.lat1 - lat) / (dem.lat1 - dem.lat0) * (dem.h - 1);
  fx = Math.max(0, Math.min(dem.w - 1.001, fx)); fy = Math.max(0, Math.min(dem.h - 1.001, fy));
  const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * dem.w + i, d = dem.data;
  return (d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + dem.w] * (1 - u) + d[k + dem.w + 1] * u) * v;
}
// DEM water surfaces (lidar returns off the water) sit around 0–2 m NAVD88; real land is higher.
export const LAND_H = 2.3;
function classify(lat, lon) {
  const d = (la, lo) => Math.hypot((lat - la) * 110574, (lon - lo) * 87960);
  if (d(37.8267, -122.4228) < 450) return 3;                                   // Alcatraz
  if (lat > 37.849 && lat < 37.876 && lon > -122.450 && lon < -122.414) return 2; // Angel Island
  if (d(37.8098, -122.3650) < 950 && lat < 37.8148) return 4;                   // Yerba Buena
  if (lat > 37.8145 && lat < 37.836 && lon > -122.382 && lon < -122.352) return 5; // Treasure Island
  if (lat > 37.849 || (lat > 37.812 && lon < -122.44)) return 1;               // Marin / Sausalito / Tiburon
  return 0;                                                                     // San Francisco
}
// exact Euclidean distance transform (Felzenszwalb & Huttenlocher), in cells
function edt(feature, W, H) {
  const INF = 1e12, n = Math.max(W, H);
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), zz = new Float64Array(n + 1);
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = feature[i] ? 0 : INF;
  const pass = (len) => {
    let k = 0; v[0] = 0; zz[0] = -INF; zz[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= zz[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; zz[k] = s; zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (zz[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = g[y * W + x]; pass(H); for (let y = 0; y < H; y++) g[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = g[y * W + x]; pass(W); for (let x = 0; x < W; x++) g[y * W + x] = Math.sqrt(d[x]); }
  return g;
}
function buildFromDEM() {
  const N = GX * GZ, land = new Uint8Array(N), hd = new Float32Array(N);
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const k = j * GX + i, { lat, lon } = toLL(BOUNDS.minX + i * CELL, BOUNDS.minZ + j * CELL);
    const h = demAt(DEM.main, lat, lon);
    hd[k] = h; land[k] = h > LAND_H ? 1 : 0;
    landId[k] = land[k] ? classify(lat, lon) : -1;
  }
  const water = new Uint8Array(N); for (let k = 0; k < N; k++) water[k] = 1 - land[k];
  const dToLand = edt(land, GX, GZ), dToWater = edt(water, GX, GZ);
  for (let k = 0; k < N; k++) sdf[k] = land[k] ? (dToWater[k] - 0.5) * CELL : -(dToLand[k] - 0.5) * CELL;
  for (let j = 0; j < GZ; j++) for (let i = 0; i < GX; i++) {
    const k = j * GX + i, x = BOUNDS.minX + i * CELL, z = BOUNDS.minZ + j * CELL;
    if (land[k]) { depthGrid[k] = -1; heightGrid[k] = Math.max(1.6, hd[k]); continue; }
    let dep;
    if (hd[k] < -0.3) dep = -hd[k];              // surveyed bathymetry (≈ MLLW)
    else dep = pointInPoly(x, z, RB_POLY) ? 1.0 : 3.0; // water-surface returns: shallow flats / dredged basins
    if (pointInPoly(x, z, RB_POLY)) {             // keep the dredged Sausalito channel
      const cd = distToPolyline(x, z, CH_XZ);
      if (cd < 70) dep = Math.max(dep, 4.2 - cd * 0.02);
    }
    for (const [la, lo, r, rd] of ROCKS) {
      if (!r) continue;
      const p = ll(la, lo), dd = Math.hypot(p.x - x, p.z - z);
      if (dd < r * 2.2) dep = Math.min(dep, rd + Math.max(0, dd - r) * 0.25);
    }
    // gentle shelf near the shore so the boat can still get to the beach/docks
    dep = Math.max(0.3, Math.min(dep, 0.6 + (-sdf[k]) * 0.35));
    depthGrid[k] = dep; heightGrid[k] = -dep;
  }
}

// ---------------------------------------------------------------- init
let built = false;
export function buildGeo() {
  if (built) return;
  RB_POLY = RB_POLY_LL.map(([a, b]) => { const p = ll(a, b); return [p.x, p.z]; });
  CH_XZ = SAUSALITO_CHANNEL.map(([a, b]) => { const p = ll(a, b); return [p.x, p.z]; });
  for (const z of NO_WAKE_ZONES) z.xz = z.poly.map(([a, b]) => { const p = ll(a, b); return [p.x, p.z]; });
  for (const l of SHIP_LANES) l.xz = l.pts.map(([a, b]) => { const p = ll(a, b); return [p.x, p.z]; });
  if (DEM.main) buildFromDEM();
  else { buildSegs(); fillLandIds(); computeSDF(); computeDepthAndHeight(); }
  built = true;
}

export function noWakeZoneAt(x, z) {
  for (const zn of NO_WAKE_ZONES) if (pointInPoly(x, z, zn.xz)) return zn;
  return null;
}
export function shipLaneAt(x, z) {
  for (const l of SHIP_LANES) if (distToPolyline(x, z, l.xz) < l.width / 2) return l;
  return null;
}
export { distToPolyline };

// ---------------------------------------------------------------- outer backdrop (beyond the playable grid)
export const OUTER_WATER = [
  // Pacific
  [[38.30, -123.6], [38.30, -122.98], [37.90, -122.68], [37.83, -122.535], [37.812, -122.505], [37.787, -122.507], [37.75, -122.510], [37.50, -122.515], [37.40, -122.45], [36.9, -122.4], [36.9, -123.6]],
  // Central + South bay
  [[37.925, -122.50], [37.935, -122.43], [37.935, -122.37], [37.905, -122.332], [37.870, -122.318], [37.830, -122.305], [37.805, -122.334], [37.790, -122.31], [37.770, -122.29], [37.720, -122.23], [37.60, -122.15], [37.45, -122.05], [37.45, -122.12], [37.55, -122.25], [37.62, -122.37], [37.70, -122.383], [37.765, -122.386], [37.80, -122.40], [37.812, -122.48], [37.835, -122.49], [37.88, -122.515]],
  // San Pablo Bay
  [[37.935, -122.43], [37.97, -122.50], [38.05, -122.49], [38.10, -122.30], [38.06, -122.22], [37.98, -122.30], [37.935, -122.37]],
];
export const OUTER_WATER_XZ = OUTER_WATER.map(poly => poly.map(([a, b]) => { const p = ll(a, b); return [p.x, p.z]; }));
export function outerIsWater(x, z) { for (const p of OUTER_WATER_XZ) if (pointInPoly(x, z, p)) return true; return false; }
