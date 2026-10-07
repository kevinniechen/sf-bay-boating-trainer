// Water navigation graph for AI route planning (auto-built from the land SDF + bathymetry).
import { BOUNDS, sdfAt, depthAt, ll } from './geo.js';

export const NODES = [];
const SP = 360;

export function clearLine(x0, z0, x1, z1, sdfMin = -40, depthMin = 2.6) {
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.ceil(L / 22));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
    if (sdfAt(x, z) > sdfMin) return false;
    if (depthAt(x, z) < depthMin) return false;
  }
  return true;
}

export function buildNav(extraLL = []) {
  NODES.length = 0;
  for (let z = BOUNDS.minZ + SP / 2; z < BOUNDS.maxZ; z += SP) {
    for (let x = BOUNDS.minX + SP / 2; x < BOUNDS.maxX; x += SP) {
      const jx = x + ((z / SP) % 2 ? SP / 2 : 0);
      if (sdfAt(jx, z) < -110 && depthAt(jx, z) > 3.2) NODES.push({ x: jx, z, adj: [] });
    }
  }
  // finer nodes in tight spots (Raccoon Strait, Belvedere, Sausalito channel, Clipper cove, city front)
  for (const [la, lo] of extraLL) {
    const p = ll(la, lo);
    if (sdfAt(p.x, p.z) < -12) NODES.push({ x: p.x, z: p.z, adj: [], extra: true });
  }
  for (let i = 0; i < NODES.length; i++) for (let j = i + 1; j < NODES.length; j++) {
    const a = NODES[i], b = NODES[j];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    const maxD = (a.extra || b.extra) ? 700 : SP * 1.6;
    if (d > maxD) continue;
    const relaxed = a.extra || b.extra;
    if (clearLine(a.x, a.z, b.x, b.z, relaxed ? -14 : -45, relaxed ? 1.9 : 2.6)) { a.adj.push({ j, d }); b.adj.push({ j: i, d }); }
  }
}

function nearestVisible(x, z) {
  let best = -1, bd = 1e18;
  for (let i = 0; i < NODES.length; i++) {
    const n = NODES[i], d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd && d < 1500 * 1500 && clearLine(x, z, n.x, n.z, -8, 1.6)) { bd = d; best = i; }
  }
  if (best < 0) for (let i = 0; i < NODES.length; i++) { const n = NODES[i], d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

const cache = new Map();
export function findPath(x0, z0, x1, z1) {
  if (clearLine(x0, z0, x1, z1, -20, 2.2)) return [{ x: x1, z: z1 }];
  const s = nearestVisible(x0, z0), e = nearestVisible(x1, z1);
  if (s < 0 || e < 0) return [{ x: x1, z: z1 }];
  const key = s * 100000 + e;
  let nodes = cache.get(key);
  if (!nodes) {
    const g = new Float64Array(NODES.length).fill(Infinity), prev = new Int32Array(NODES.length).fill(-1);
    const open = new Set([s]); g[s] = 0;
    const H = (i) => Math.hypot(NODES[i].x - NODES[e].x, NODES[i].z - NODES[e].z);
    while (open.size) {
      let cur = -1, bf = Infinity;
      for (const i of open) { const f = g[i] + H(i); if (f < bf) { bf = f; cur = i; } }
      if (cur === e) break;
      open.delete(cur);
      for (const { j, d } of NODES[cur].adj) {
        const ng = g[cur] + d;
        if (ng < g[j]) { g[j] = ng; prev[j] = cur; open.add(j); }
      }
    }
    nodes = [];
    for (let c = e; c >= 0; c = prev[c]) nodes.unshift(c);
    if (nodes[0] !== s) nodes = [e];
    cache.set(key, nodes);
  }
  const pts = nodes.map(i => ({ x: NODES[i].x, z: NODES[i].z }));
  pts.push({ x: x1, z: z1 });
  // string-pull: skip intermediate points when the line is clear
  const out = [];
  let cx = x0, cz = z0, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clearLine(cx, cz, pts[j].x, pts[j].z, -25, 2.2)) j--;
    out.push(pts[j]); cx = pts[j].x; cz = pts[j].z; i = j + 1;
  }
  return out;
}

export function randomWaterPoint(cx, cz, r, sdfMax = -60, depthMin = 3) {
  for (let k = 0; k < 40; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (sdfAt(x, z) < sdfMax && depthAt(x, z) > depthMin) return { x, z };
  }
  return null;
}
