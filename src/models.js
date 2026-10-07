// Low-poly vessel and structure models built from merged, vertex-coloured geometry.
// Model convention: bow points to -Z, starboard is +X, up is +Y, waterline at y = 0.
import * as THREE from 'three';

export const MAT = {
  // PBR so hulls pick up the sky (image-based lighting from the scene environment)
  vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.0, envMapIntensity: 0.9 }),
  vcDouble: new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.0, envMapIntensity: 1.0 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1b2a33, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2 }),
  sail: new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.0 }),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color(), _n3 = new THREE.Matrix3(), _v = new THREE.Vector3();
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const cylCache = new Map();
function cylGeom(rt, rb, seg) {
  const k = rt + ',' + rb + ',' + seg;
  if (!cylCache.has(k)) cylCache.set(k, new THREE.CylinderGeometry(rt, rb, 1, seg).toNonIndexed());
  return cylCache.get(k);
}
const sphereGeom = new THREE.SphereGeometry(1, 10, 7).toNonIndexed();
const coneGeom4 = new THREE.ConeGeometry(1, 1, 4).toNonIndexed();

export class GB {
  constructor() { this.p = []; this.n = []; this.c = []; }
  addGeom(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    _n3.getNormalMatrix(_m);
    const P = geo.attributes.position, N = geo.attributes.normal;
    _c.set(color);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m); this.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize(); this.n.push(_v.x, _v.y, _v.z);
      this.c.push(_c.r, _c.g, _c.b);
    }
    return this;
  }
  box(w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) { return this.addGeom(UNIT_BOX, color, x, y, z, rx, ry, rz, w, h, d); }
  cyl(r, h, color, x, y, z, seg = 8, rx = 0, ry = 0, rz = 0, rTop = null) {
    return this.addGeom(cylGeom(rTop ?? r, r, seg), color, x, y, z, rx, ry, rz, 1, h, 1);
  }
  sphere(r, color, x, y, z, sx = 1, sy = 1, sz = 1) { return this.addGeom(sphereGeom, color, x, y, z, 0, 0, 0, r * sx, r * sy, r * sz); }
  pyramid(r, h, color, x, y, z, ry = Math.PI / 4) { return this.addGeom(coneGeom4, color, x, y, z, 0, ry, 0, r, h, r); }
  tri(a, b, c, color) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    _c.set(color);
    for (const p of [a, b, c]) { this.p.push(p[0], p[1], p[2]); this.n.push(nx, ny, nz); this.c.push(_c.r, _c.g, _c.b); }
    return this;
  }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); return this; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
  mesh(mat = MAT.vc) { const m = new THREE.Mesh(this.build(), mat); return m; }
}

// Generic lofted monohull. taper = fraction of length where the bow taper starts.
export function hull(gb, L, B, freeboard, draft, opts = {}) {
  const { side = '#ffffff', bottom = '#c0392b', deck = '#e8e4da', taper = 0.55, sheer = 0.35, deckCap = true,
    stripe = null, transom = true, deckFrom = 0, blunt = 0, chineFrac = 0.92, xOff = 0 } = opts;
  if (xOff) { const sub = new GB(); const r = hull(sub, L, B, freeboard, draft, { ...opts, xOff: 0 });
    for (let i = 0; i < sub.p.length; i += 3) sub.p[i] += xOff;
    gb.p.push(...sub.p); gb.n.push(...sub.n); gb.c.push(...sub.c); return r; }
  const N = 14, st = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = L / 2 - t * L;
    let b = B / 2;
    if (t > taper) { const u = (t - taper) / (1 - taper); b *= Math.max(blunt, Math.sqrt(Math.max(0, 1 - u * u))); }
    if (t < 0.04) b *= 0.94 + t * 1.5;
    const top = freeboard + sheer * t * t;
    const keel = -draft * (t > 0.85 ? 1 - (t - 0.85) * 3 : 1);
    st.push({ z, b, top, keel, chineY: keel * 0.25 + 0.05 * draft });
  }
  for (let i = 0; i < N; i++) {
    const a = st[i], c = st[i + 1];
    for (const s of [1, -1]) {
      const k0 = [0, a.keel, a.z], k1 = [0, c.keel, c.z];
      const ch0 = [s * a.b * chineFrac, a.chineY, a.z], ch1 = [s * c.b * chineFrac, c.chineY, c.z];
      const sh0 = [s * a.b, a.top, a.z], sh1 = [s * c.b, c.top, c.z];
      if (s > 0) { gb.quad(k0, k1, ch1, ch0, bottom); gb.quad(ch0, ch1, sh1, sh0, side); }
      else { gb.quad(k0, ch0, ch1, k1, bottom); gb.quad(ch0, sh0, sh1, ch1, side); }
      if (stripe) {
        const y0 = a.top - stripe.from, y1 = c.top - stripe.from, w = stripe.w;
        const o = s * 0.012;
        const p0 = [s * a.b + o, y0, a.z], p1 = [s * c.b + o, y1, c.z], p2 = [s * c.b + o, y1 - w, c.z], p3 = [s * a.b + o, y0 - w, a.z];
        if (s > 0) gb.quad(p0, p3, p2, p1, stripe.color); else gb.quad(p0, p1, p2, p3, stripe.color);
      }
    }
    if (deckCap && i >= Math.floor(deckFrom * N)) {
      gb.quad([-a.b, a.top, a.z], [a.b, a.top, a.z], [c.b, c.top, c.z], [-c.b, c.top, c.z], deck);
    }
  }
  if (transom) {
    const a = st[0];
    gb.quad([-a.b, a.top, a.z], [-a.b * chineFrac, a.chineY, a.z], [a.b * chineFrac, a.chineY, a.z], [a.b, a.top, a.z], side);
    gb.tri([-a.b * chineFrac, a.chineY, a.z], [0, a.keel, a.z], [a.b * chineFrac, a.chineY, a.z], bottom);
  }
  return st;
}

// ---------------------------------------------------------------- player boat: Protector 33 Targa RIB
// Rigid deep-V GRP hull with a navy Hypalon collar, a targa wheelhouse (raked windscreen, side glass,
// hardtop with a Garmin radome), open aft cockpit, stainless rails and twin Mercury Verado 350s.
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _qq = new THREE.Quaternion(), _ee = new THREE.Euler();
function seg(gb, a, b, r, color, nseg = 10) {
  _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = _dir.length(); _dir.normalize();
  _qq.setFromUnitVectors(_up, _dir); _ee.setFromQuaternion(_qq);
  gb.addGeom(cylGeom(r, r, nseg), color, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, _ee.x, _ee.y, _ee.z, 1, len, 1);
}
function decal(text, w, h, { color = '#ffffff', font = '700 120px "Barlow Condensed", Arial Narrow, sans-serif', italic = false, spacing = 10 } = {}) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = Math.round(1024 * h / w);
  const ctx = cv.getContext('2d'); ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = (italic ? 'italic ' : '') + font; ctx.letterSpacing = spacing + 'px';
  ctx.fillText(text, cv.width / 2, cv.height / 2 + 4);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false }));
  return m;
}
export function buildPlayerBoat() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  // everything sits in a group lowered so the collar rides just above the waterline aft (as on the real boat)
  const sunk = new THREE.Group(); sunk.position.y = -0.24; body.add(sunk);
  const gb = new GB();
  const L = 10.3, B = 3.25;
  const NAVY = '#151c3d', WHITE = '#f3f3f0', CREAM = '#e6dcc6', SS = '#d4d9dd', GLASS = '#1d2a33', DARK = '#15181b';
  // rigid hull inside the collar (the tubes carry the beam out to 3.25 m)
  const HL = 9.9, HB = 2.72;
  const st = hull(gb, HL, HB, 0.74, 0.62, { side: WHITE, bottom: '#eceeee', deck: WHITE, taper: 0.48, sheer: 0.32, deckFrom: 0.58, chineFrac: 0.9, xOff: 0 });
  // ---- Hypalon collar: tube follows the sheer, both sides meet at the stem, cones run past the transom
  const TR = 0.29, tubeY = (s) => s.top + 0.1;
  const pts = (sgn) => st.map((q, i) => [sgn * Math.max(0, q.b - 0.02), tubeY(q) + (i === st.length - 1 ? 0.08 : 0), q.z - (i === st.length - 1 ? 0.18 : 0)]);
  for (const sgn of [-1, 1]) {
    const P = pts(sgn);
    for (let i = 0; i < P.length - 1; i++) { seg(gb, P[i], P[i + 1], TR * (i > P.length - 4 ? 0.92 : 1), NAVY, 12); gb.sphere(TR * (i > P.length - 4 ? 0.92 : 1), NAVY, ...P[i + 1]); }
    gb.sphere(TR, NAVY, ...P[0]);
    // aft cones (black wear caps), slightly kicked up
    const c0 = P[0], c1 = [c0[0], c0[1] + 0.05, c0[2] + 0.42];
    seg(gb, c0, c1, TR * 0.93, NAVY, 12);
    gb.addGeom(cylGeom(0.05, TR * 0.92, 12), DARK, c1[0], c1[1] + 0.02, c1[2] + 0.2, Math.PI / 2 - 0.12, 0, 0, 1, 0.42, 1);
    // rub strake & lifeline handles along the tube
    seg(gb, [sgn * (st[1].b + TR * 0.95), tubeY(st[1]) - 0.06, st[1].z], [sgn * (st[9].b + TR * 0.9), tubeY(st[9]) - 0.06, st[9].z], 0.035, DARK, 6);
    for (let k = 2; k <= 8; k += 3) gb.box(0.04, 0.05, 0.28, '#2d3440', sgn * (st[k].b + 0.05), tubeY(st[k]) + TR * 0.95, st[k].z);
  }
  // ---- deck, cockpit sole, gunwale tops
  gb.box(HB - 0.25, 0.06, 6.2, '#e8e5dc', 0, 0.62, 2.0);
  for (const sgn of [-1, 1]) gb.box(0.22, 0.5, 6.2, WHITE, sgn * (HB / 2 - 0.12), 0.88, 2.0);
  // ---- targa wheelhouse
  const cz0 = -1.45, cz1 = 1.25, cw = 2.28;
  const glass = new GB();                                // windscreen & side glass: a separate see-through mesh            // cabin front / roof aft edge, width
  gb.box(1.95, 0.62, 1.45, WHITE, 0, 1.05, -2.15);      // forward cabin trunk (cuddy below)
  gb.quad([-0.97, 1.36, -2.88], [0.97, 1.36, -2.88], [1.1, 1.48, cz0], [-1.1, 1.48, cz0], WHITE); // trunk top, sloping to the bow
  gb.box(1.1, 0.03, 0.55, GLASS, 0, 1.46, -2.3, 0, 0.06);                                       // forward hatch
  for (const sgn of [-1, 1]) {
    gb.box(0.08, 0.72, 2.75, WHITE, sgn * cw / 2, 1.1, cz0 + 1.3);                  // cabin side (lower)
    gb.box(0.09, 0.07, 2.6, NAVY, sgn * (cw / 2 + 0.01), 1.34, cz0 + 1.25);          // navy swoosh
    gb.box(0.09, 0.03, 2.2, '#9aa3ad', sgn * (cw / 2 + 0.012), 1.25, cz0 + 1.1);
    // side glass between pillars
    glass.quad([sgn * cw / 2, 1.47, cz0 + 0.15], [sgn * cw / 2, 1.47, cz0 + 2.0], [sgn * (cw / 2 - 0.12), 2.18, cz0 + 1.95], [sgn * (cw / 2 - 0.12), 2.18, cz0 + 0.55], GLASS);
    // A-pillar, B-pillar and the thick aft targa leg
    seg(gb, [sgn * cw / 2, 1.47, cz0 + 0.02], [sgn * (cw / 2 - 0.12), 2.24, cz0 + 0.5], 0.05, WHITE, 6);
    seg(gb, [sgn * cw / 2, 1.47, cz0 + 2.02], [sgn * (cw / 2 - 0.12), 2.24, cz0 + 1.98], 0.045, WHITE, 6);
    gb.quad([sgn * (cw / 2), 0.86, 0.95], [sgn * (cw / 2), 0.86, cz1 + 0.05], [sgn * (cw / 2 - 0.1), 2.26, cz1], [sgn * (cw / 2 - 0.1), 2.26, 0.75], WHITE);
    gb.quad([sgn * (cw / 2 - 0.16), 0.86, 0.95], [sgn * (cw / 2 - 0.16), 2.26, 0.75], [sgn * (cw / 2 - 0.26), 2.26, cz1], [sgn * (cw / 2 - 0.16), 0.86, cz1 + 0.05], '#e3e2dc');
  }
  // raked windscreen (three panes) and its frame
  glass.quad([-cw / 2, 1.47, cz0], [cw / 2, 1.47, cz0], [cw / 2 - 0.12, 2.2, cz0 + 0.5], [-cw / 2 + 0.12, 2.2, cz0 + 0.5], GLASS);
  for (const x of [-0.38, 0.38]) seg(gb, [x, 1.47, cz0 - 0.01], [x * 0.95, 2.2, cz0 + 0.49], 0.022, WHITE, 5);
  // hardtop roof with drip edge
  gb.box(cw + 0.06, 0.1, cz1 - cz0 - 0.3, WHITE, 0, 2.29, (cz0 + cz1) / 2 + 0.15);
  gb.box(cw - 0.1, 0.06, cz1 - cz0 - 0.5, '#ebeae5', 0, 2.37, (cz0 + cz1) / 2 + 0.2);
  // Garmin radome, whip antenna, all-round light, horn
  gb.cyl(0.33, 0.12, WHITE, 0, 2.48, 0.15, 16);
  gb.sphere(0.33, WHITE, 0, 2.54, 0.15, 1, 0.42, 1);
  gb.box(0.18, 0.02, 0.01, '#222', 0, 2.5, -0.19);
  seg(gb, [0.95, 2.36, 1.1], [1.25, 4.9, 1.75], 0.012, '#eeeeee', 4);
  seg(gb, [-0.2, 2.4, 1.05], [-0.2, 2.95, 1.05], 0.02, SS, 6);
  gb.cyl(0.04, 0.08, '#ffffff', -0.2, 3.0, 1.05, 8);
  // ---- inside the wheelhouse: dash, helm on the starboard side, bolster seats
  gb.box(cw - 0.2, 0.5, 0.55, '#e9e7e1', 0, 1.2, cz0 + 0.35);
  gb.box(cw - 0.3, 0.05, 0.6, '#262b30', 0, 1.47, cz0 + 0.45, 0, -0.25);
  gb.box(0.55, 0.3, 0.04, '#0b2733', 0.45, 1.6, cz0 + 0.55, 0, -0.5);   // Garmin MFD
  gb.box(0.4, 0.26, 0.04, '#0b2733', -0.15, 1.6, cz0 + 0.55, 0, -0.5);
  gb.box(0.28, 0.32, 0.38, '#cfd3d6', 0.86, 1.36, cz0 + 0.95);         // binnacle pod right of the wheel
  for (const sx of [-0.45, 0.45]) {                                  // two bolster helm seats
    gb.box(0.25, 0.5, 0.25, SS, sx, 0.88, 0.45);
    gb.box(0.58, 0.16, 0.55, CREAM, sx, 1.2, 0.45);
    gb.box(0.58, 0.55, 0.14, CREAM, sx, 1.5, 0.74);
  }
  // ---- aft cockpit: transom bench, engine well, stainless rails
  gb.box(HB - 0.4, 0.42, 0.72, WHITE, 0, 0.84, 4.25);
  gb.box(HB - 0.45, 0.12, 0.66, CREAM, 0, 1.11, 4.22);
  gb.box(HB - 0.45, 0.42, 0.12, CREAM, 0, 1.34, 4.58);
  gb.box(HB - 0.3, 0.1, 0.38, '#e8e5dc', 0, 0.98, 4.75);
  gb.box(0.4, 0.25, 0.5, CREAM, -0.95, 0.95, 2.6);                  // side jump seats
  gb.box(0.4, 0.25, 0.5, CREAM, 0.95, 0.95, 2.6);
  for (const sgn of [-1, 1]) {
    seg(gb, [sgn * 1.15, 1.08, 3.05], [sgn * 1.15, 1.65, 3.25], 0.022, SS, 6);
    seg(gb, [sgn * 1.15, 1.65, 3.25], [sgn * 1.15, 1.65, 4.85], 0.022, SS, 6);
    seg(gb, [sgn * 1.15, 1.65, 4.85], [sgn * 1.15, 1.12, 4.95], 0.022, SS, 6);
    // bow rail along the trunk
    seg(gb, [sgn * 0.96, 1.42, -2.75], [sgn * 0.96, 1.72, -3.0], 0.02, SS, 6);
    seg(gb, [sgn * 0.96, 1.72, -3.0], [sgn * 0.5, 1.6, -4.3], 0.02, SS, 6);
  }
  seg(gb, [-1.15, 1.65, 4.85], [1.15, 1.65, 4.85], 0.022, SS, 6);
  seg(gb, [-0.5, 1.6, -4.3], [0.5, 1.6, -4.3], 0.02, SS, 6);
  gb.box(0.2, 0.1, 0.55, '#9aa1a8', 0, st[13].top + 0.32, -4.75);   // anchor roller
  const hullMesh = new THREE.Mesh(gb.build(), MAT.vcDouble);
  sunk.add(hullMesh);
  const glassMesh = new THREE.Mesh(glass.build(), new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false }));
  glassMesh.renderOrder = 4; sunk.add(glassMesh);
  // ---- decals: PROTECTOR on the aft tubes, CRAZY 8 + logo on the cabin sides
  for (const sgn of [-1, 1]) {
    const tq = st[3];
    const pd = decal('PROTECTOR', 1.6, 0.26, { color: '#f4f4f4', spacing: 14 });
    pd.position.set(sgn * (tq.b + TR + 0.005), tubeY(tq) - 0.02, tq.z + 0.3); pd.rotation.y = sgn * Math.PI / 2; sunk.add(pd);
    const cn = decal('CRAZY 8', 0.9, 0.2, { color: '#14181c', font: '700 150px "Barlow Condensed", Arial Narrow, sans-serif', spacing: 6 });
    cn.position.set(sgn * (cw / 2 + 0.048), 1.3, cz0 + 0.45); cn.rotation.y = sgn * Math.PI / 2; sunk.add(cn);
    const lg = decal('PROTECTOR', 0.6, 0.09, { color: '#1b2550', italic: true, spacing: 4 });
    lg.position.set(sgn * (cw / 2 + 0.048), 1.15, cz0 + 1.55); lg.rotation.y = sgn * Math.PI / 2; sunk.add(lg);
  }

  // ---- twin Mercury Verado 350s
  const engines = [];
  for (const sx of [-0.5, 0.5]) {
    const piv = new THREE.Group(); piv.position.set(sx, 0.95, 5.05);
    const eg = new GB();
    eg.box(0.66, 0.78, 0.98, '#0f1012', 0, 0.62, 0.42);           // cowl
    eg.sphere(0.36, '#0f1012', 0, 1.0, 0.42, 0.92, 0.32, 1.35);    // rounded top
    eg.box(0.67, 0.16, 0.99, '#9ba3aa', 0, 0.34, 0.42);           // silver band
    eg.box(0.6, 0.18, 0.9, '#1a1b1d', 0, 0.16, 0.42);             // lower cowl
    eg.box(0.32, 1.25, 0.44, '#16171a', 0, -0.55, 0.32);           // midsection
    eg.box(0.36, 0.26, 0.72, '#16171a', 0, -1.22, 0.28);           // gearcase
    eg.box(0.06, 0.38, 0.55, '#16171a', 0, -1.52, 0.32);           // skeg
    eg.box(0.62, 0.05, 0.3, '#16171a', 0, -0.95, 0.28);            // cavitation plate
    const em = eg.mesh(); piv.add(em);
    const lbl = decal('350', 0.36, 0.16, { color: '#d9dde0', spacing: 2 });
    for (const sgn of [-1, 1]) { const l2 = lbl.clone(); l2.position.set(sgn * 0.335, 0.66, 0.66); l2.rotation.y = sgn * Math.PI / 2; piv.add(l2); }
    const mb = decal('MERCURY', 0.6, 0.12, { color: '#c8ced3', spacing: 6 });
    for (const sgn of [-1, 1]) { const l3 = mb.clone(); l3.position.set(sgn * 0.335, 0.86, 0.35); l3.rotation.y = sgn * Math.PI / 2; piv.add(l3); }
    const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 3), new THREE.MeshStandardMaterial({ color: 0x8a8f94, metalness: 0.8, roughness: 0.3 }));
    prop.rotation.x = Math.PI / 2; prop.position.set(0, -1.22, 0.7); piv.add(prop);
    sunk.add(piv); engines.push({ pivot: piv, prop });
  }
  // ---- helm (starboard side of the wheelhouse); levers on the binnacle pod to the right of the wheel
  const wheel = new THREE.Group();
  const wmat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6 });
  const wr = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 6, 20), wmat);
  wheel.add(wr);
  for (let i = 0; i < 3; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.19, 0.02), new THREE.MeshStandardMaterial({ color: 0xc9ced2, metalness: 0.8, roughness: 0.25 })); sp.rotation.z = i * Math.PI * 2 / 3; sp.position.set(Math.sin(-i * 2.094) * 0.095, Math.cos(i * 2.094) * 0.095, 0); wheel.add(sp); }
  wheel.position.set(0.45, 1.66, cz0 + 0.88); wheel.rotation.x = -0.75; sunk.add(wheel);
  const levers = [];
  for (const sx of [0.8, 0.92]) {
    const lp = new THREE.Group(); lp.position.set(sx, 1.53, cz0 + 0.95);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.035), new THREE.MeshStandardMaterial({ color: 0xd4d9dd, metalness: 0.9, roughness: 0.2 }));
    arm.position.y = 0.11; lp.add(arm);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.045, 0.05), new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.7 }));
    knob.position.y = 0.23; lp.add(knob);
    sunk.add(lp); levers.push(lp);
  }
  // fenders (hidden until deployed) — hung outside the tubes
  const fenders = new THREE.Group();
  const fm = new THREE.MeshStandardMaterial({ color: 0x1b2550, roughness: 0.6 });
  for (const s2 of [-1, 1]) for (const z of [-2.0, 0.6, 3.2]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.62, 8), fm);
    f.position.set(s2 * 1.8, 0.55, z); fenders.add(f);
  }
  fenders.visible = false; sunk.add(fenders);
  // navy canvas cockpit cover + engine bags (snapped on in the slip)
  const cover = new THREE.Group();
  const cg = new GB();
  cg.box(HB - 0.1, 0.06, 3.6, '#22325a', 0, 1.7, 3.1);
  cg.box(HB - 0.1, 0.9, 0.06, '#22325a', 0, 1.25, 4.9);
  for (const sgn of [-1, 1]) cg.box(0.06, 0.8, 3.6, '#22325a', sgn * (HB / 2 - 0.05), 1.3, 3.1);
  for (const sx of [-0.5, 0.5]) cg.box(0.74, 0.95, 1.06, '#22325a', sx, 1.62, 5.47);
  cover.add(cg.mesh()); sunk.add(cover);
  const navLights = [
    { x: -1.16, y: 1.4, z: -1.5, color: 0xff2020, sector: 'port' },
    { x: 1.16, y: 1.4, z: -1.5, color: 0x20ff40, sector: 'stbd' },
    { x: -0.2, y: 3.05, z: 1.05, color: 0xffffff, sector: 'all' },
  ];
  // first-person eye: standing at the starboard helm, under the hardtop
  return { root, body, engines, wheel, levers, fenders, cover, navLights, length: L, beam: B, helmEye: [0.45, 1.68, 0.2] };
}

// ---------------------------------------------------------------- AI vessel models
function rnd(a, b) { return a + Math.random() * (b - a); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

export function buildPowerboat(L = 9, style = 'cruiser') {
  const gb = new GB();
  const B = L * 0.34;
  const side = pick(['#ffffff', '#ffffff', '#f5f5f0', '#1f3a5f', '#30343a', '#8a1c1c', '#e9e2cf']);
  hull(gb, L, B, L * 0.1, L * 0.05, { side, bottom: '#e8e8e8', deck: '#f2efe6', taper: 0.5, sheer: L * 0.04, stripe: side === '#ffffff' ? { from: 0.15, w: 0.08, color: pick(['#1f3a5f', '#2b6cb0', '#222', '#b7791f']) } : null });
  const top = L * 0.1;
  if (style === 'cruiser') {
    gb.box(B * 0.8, L * 0.12, L * 0.38, '#f5f5f0', 0, top + L * 0.06, -L * 0.02);
    gb.box(B * 0.82, L * 0.05, L * 0.12, '#1b2630', 0, top + L * 0.1, -L * 0.2, 0, -0.5);
    gb.box(B * 0.7, L * 0.03, L * 0.3, '#f5f5f0', 0, top + L * 0.14, 0.05 * L);
  } else if (style === 'cc') { // center console
    gb.box(B * 0.32, L * 0.1, L * 0.11, '#f5f5f0', 0, top + L * 0.05, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.cyl(0.03, L * 0.18, '#ccc', sx * B * 0.25, top + L * 0.09, sz * L * 0.08, 5);
    gb.box(B * 0.65, 0.06, L * 0.24, pick(['#1f3a5f', '#f5f5f0', '#2d2d2d']), 0, top + L * 0.18, 0);
    gb.box(0.5, 0.7, 0.5, '#111', 0, top + 0.1, L / 2 + 0.25);
  } else if (style === 'sport') {
    gb.box(B * 0.85, L * 0.04, L * 0.1, '#1b2630', 0, top + L * 0.04, -L * 0.08, 0, -0.7);
  } else if (style === 'trawler') {
    gb.box(B * 0.85, L * 0.14, L * 0.5, '#f5f5f0', 0, top + L * 0.07, L * 0.05);
    gb.box(B * 0.75, L * 0.1, L * 0.25, '#f5f5f0', 0, top + L * 0.19, L * 0.0);
    gb.box(B * 0.76, L * 0.03, L * 0.2, '#1b2630', 0, top + L * 0.2, -L * 0.12);
  }
  return gb.mesh();
}

export function buildSailboat(L = 10, sailColor = '#f7f5ef') {
  const g = new THREE.Group();
  const gb = new GB();
  const B = L * 0.33;
  hull(gb, L, B, L * 0.08, L * 0.07, { side: pick(['#ffffff', '#ffffff', '#ffffff', '#1f3a5f', '#2f4f3f', '#7a1f1f']), bottom: '#2a2a40', deck: '#e8e2d2', taper: 0.48, sheer: L * 0.03 });
  gb.box(B * 0.55, L * 0.06, L * 0.25, '#f2efe6', 0, L * 0.11, -L * 0.02);
  gb.box(0.25, L * 0.18, L * 0.12, '#1a1a1a', 0, -L * 0.12, 0); // keel
  const hullM = gb.mesh(); g.add(hullM);
  const rig = new THREE.Group(); g.add(rig);
  const mastH = L * 1.35;
  const rb = new GB();
  rb.cyl(0.06, mastH, '#c9ccd0', 0, L * 0.08 + mastH / 2, -L * 0.08, 5);
  const mastTop = L * 0.08 + mastH, mz = -L * 0.08;
  rig.add(rb.mesh());
  // sails as separate group so they can swing with the boom
  const main = new GB();
  main.tri([0, L * 0.18, mz], [0, mastTop - 0.3, mz], [0, L * 0.18, mz + L * 0.42], sailColor);
  const mainM = main.mesh(MAT.sail);
  const mainPiv = new THREE.Group(); mainPiv.position.set(0, 0, 0); mainPiv.add(mainM);
  // pivot main around mast: shift geometry so mast is at origin
  mainM.position.z = 0; rig.add(mainPiv);
  const jib = new GB();
  const bowZ = -L * 0.48;
  jib.tri([0, L * 0.12, bowZ], [0, mastTop * 0.82, mz], [0, L * 0.14, mz + L * 0.05], sailColor);
  const jibM = jib.mesh(MAT.sail); rig.add(jibM);
  return { group: g, rig, mainPiv, mainM, jibM, mastZ: mz, mastTop };
}

export function buildContainerShip(L = 300) {
  const gb = new GB();
  const B = L * 0.15;
  hull(gb, L, B, 14, 11, { side: pick(['#1f3a5f', '#2a2a2a', '#8b1e1e', '#2f5d3a', '#3b4a6b']), bottom: '#7a2020', deck: '#555', taper: 0.75, sheer: 4, blunt: 0.15, chineFrac: 0.98 });
  const colors = ['#b03a2e', '#1f618d', '#d4ac0d', '#7d3c98', '#117a65', '#ca6f1e', '#909497', '#e6e6e6', '#2e4053', '#a04000'];
  const bayLen = 13, rows = Math.floor(B / 2.6) - 1;
  for (let z = -L * 0.38; z < L * 0.32; z += bayLen + 0.6) {
    if (Math.abs(z - L * 0.28) < 12) continue;
    const tiers = 3 + Math.floor(Math.random() * 4);
    for (let r = 0; r < rows; r++) {
      const x = (r - (rows - 1) / 2) * 2.6;
      const h = tiers - (Math.random() < 0.2 ? Math.floor(Math.random() * 3) : 0);
      for (let t = 0; t < h; t++) gb.box(2.45, 2.55, bayLen, pick(colors), x, 16 + t * 2.6, z);
    }
  }
  // bridge/accommodation aft
  gb.box(B * 0.9, 28, 14, '#f2f2f2', 0, 28, L * 0.36);
  gb.box(B * 1.05, 3, 8, '#f2f2f2', 0, 41, L * 0.355);
  gb.box(B * 0.88, 2, 13.8, '#1b2630', 0, 39, L * 0.36 - 0.2);
  gb.box(7, 14, 9, '#333', 0, 45, L * 0.42);
  gb.box(6, 1, 1, '#c0392b', 0, 51, L * 0.42);
  gb.box(0.6, 18, 0.6, '#ddd', 0, 42, -L * 0.47);
  return gb.mesh();
}

export function buildTanker(L = 240) {
  const gb = new GB();
  const B = L * 0.17;
  hull(gb, L, B, 10, 13, { side: pick(['#7a1f1f', '#1f3a5f', '#222', '#3d5a40']), bottom: '#6a1a1a', deck: '#6b6b5a', taper: 0.78, sheer: 3, blunt: 0.2, chineFrac: 0.98 });
  for (let z = -L * 0.4; z < L * 0.3; z += 6) gb.box(1, 1.2, 0.8, '#d0c070', 0, 11.5, z);
  gb.box(1.5, 1.5, L * 0.7, '#d0c070', 0, 11, -L * 0.05);
  gb.box(B * 0.8, 18, 16, '#efefef', 0, 19, L * 0.38);
  gb.box(B * 0.78, 1.8, 15.8, '#1b2630', 0, 26, L * 0.38);
  gb.box(6, 10, 7, '#c33', 0, 31, L * 0.45);
  return gb.mesh();
}

export function buildCarCarrier(L = 200) {
  const gb = new GB();
  const B = L * 0.16;
  hull(gb, L, B, 10, 9, { side: '#f2f2f2', bottom: '#7a2020', deck: '#ddd', taper: 0.8, sheer: 1, blunt: 0.3, chineFrac: 0.99 });
  gb.box(B * 0.98, 22, L * 0.9, '#f2f2f2', 0, 21, 0);
  gb.box(B * 0.99, 2, L * 0.88, pick(['#1f3a5f', '#c0392b', '#117a65']), 0, 14, 0);
  gb.box(B * 0.7, 3, 10, '#1b2630', 0, 33, -L * 0.4);
  return gb.mesh();
}

export function buildCruiseShip(L = 290) {
  const gb = new GB();
  const B = L * 0.12;
  hull(gb, L, B, 12, 8, { side: '#f5f5f5', bottom: '#1f3a5f', deck: '#ddd', taper: 0.7, sheer: 3, blunt: 0.1, chineFrac: 0.98 });
  for (let d = 0; d < 7; d++) {
    const w = B * (0.98 - d * 0.04), len = L * (0.82 - d * 0.05);
    gb.box(w, 3, len, '#fafafa', 0, 13.5 + d * 3, L * 0.02 + d * 2);
    gb.box(w + 0.05, 0.9, len - 2, '#2c4a6b', 0, 14 + d * 3, L * 0.02 + d * 2);
  }
  gb.box(10, 12, 14, '#1f3a5f', 0, 41, L * 0.25);
  return gb.mesh();
}

export function buildFerryCat(L = 40, livery = 'gg') {
  const gb = new GB();
  const B = L * 0.3;
  const liv = {
    gg: { hull: '#f4f4f4', band: '#d35400', cabin: '#f4f4f4' },     // Golden Gate Ferry: orange band
    bay: { hull: '#f4f4f4', band: '#1565c0', cabin: '#f4f4f4' },    // SF Bay Ferry: blue
    bg: { hull: '#f4f4f4', band: '#1a4f8b', cabin: '#f6f6f2' },     // Blue & Gold
    alc: { hull: '#1b2a4a', band: '#f4f4f4', cabin: '#f4f4f4' },    // Alcatraz Cruises
  }[livery] || { hull: '#fff', band: '#555', cabin: '#fff' };
  for (const s of [-1, 1]) {
    hull(gb, L, B * 0.22, 2.2, 1.6, { side: liv.hull, bottom: '#333', deck: '#ccc', taper: 0.6, sheer: 0.6, deckCap: false, xOff: s * B * 0.38 });
  }
  gb.box(B, 1.2, L * 0.92, liv.hull, 0, 2.6, 0.02 * L);
  gb.box(B * 1.01, 0.6, L * 0.9, liv.band, 0, 2.3, 0.02 * L);
  gb.box(B * 0.92, 2.6, L * 0.62, liv.cabin, 0, 4.4, 0.05 * L);
  gb.box(B * 0.93, 1.0, L * 0.6, '#1b2630', 0, 4.7, 0.05 * L);
  gb.box(B * 0.7, 2.2, L * 0.25, liv.cabin, 0, 6.8, -0.02 * L);
  gb.box(B * 0.71, 0.8, L * 0.24, '#1b2630', 0, 7.1, -0.02 * L);
  gb.box(B * 0.4, 0.1, 0.1, '#ccc', 0, 8.5, -0.1 * L);
  return gb.mesh();
}

export function buildFerryMono(L = 36, livery = 'alc') {
  const gb = new GB();
  const B = L * 0.27;
  const hullC = livery === 'alc' ? '#1b2a4a' : livery === 'rw' ? '#f4f4f4' : '#f4f4f4';
  const band = livery === 'rw' ? '#c0392b' : livery === 'horn' ? '#2c3e50' : '#f4f4f4';
  hull(gb, L, B, 2.6, 1.8, { side: hullC, bottom: '#333', deck: '#ccc', taper: 0.62, sheer: 0.8, stripe: { from: 0.3, w: 0.5, color: band } });
  const decks = livery === 'horn' ? 3 : 2;
  for (let d = 0; d < decks; d++) {
    const len = L * (0.7 - d * 0.12);
    gb.box(B * (0.92 - d * 0.06), 2.4, len, '#f6f6f2', 0, 3.8 + d * 2.5, L * 0.06);
    gb.box(B * (0.93 - d * 0.06), 0.9, len - 1, '#1b2630', 0, 4.1 + d * 2.5, L * 0.06);
  }
  gb.box(B * 0.4, 1.8, 3, '#f6f6f2', 0, 3.8 + decks * 2.5, -L * 0.1);
  return gb.mesh();
}

export function buildTug(L = 30) {
  const gb = new GB();
  const B = L * 0.36;
  hull(gb, L, B, 2.4, 2.8, { side: pick(['#1a1a1a', '#1f3a5f', '#2e5e3e']), bottom: '#7a2020', deck: '#555', taper: 0.62, sheer: 1.2, stripe: { from: 0.2, w: 0.5, color: '#f4f4f4' } });
  gb.box(B * 0.6, 3, L * 0.32, '#f4f4f4', 0, 4, -L * 0.08);
  gb.box(B * 0.5, 2.2, L * 0.18, '#f4f4f4', 0, 6.6, -L * 0.12);
  gb.box(B * 0.51, 0.8, L * 0.17, '#1b2630', 0, 7.0, -L * 0.12);
  gb.box(1.2, 4, 1.2, '#c0392b', -1, 8, L * 0.05); gb.box(1.2, 4, 1.2, '#c0392b', 1, 8, L * 0.05);
  // fender tires around hull
  for (let z = -L * 0.4; z < L * 0.45; z += 2.5) for (const s of [-1, 1]) gb.box(0.4, 0.6, 1.4, '#111', s * B * 0.5, 1.6, z);
  return gb.mesh();
}

export function buildBarge(L = 90) {
  const gb = new GB();
  const B = L * 0.28;
  gb.box(B, 4, L, '#5d4e37', 0, 0.5, 0);
  gb.box(B * 0.9, 3, L * 0.85, pick(['#8d8d8d', '#a1887f', '#6d6d6d']), 0, 4, 0);
  return gb.mesh();
}

export function buildFishing(L = 12) {
  const gb = new GB();
  const B = L * 0.35;
  hull(gb, L, B, 1.4, 1.0, { side: pick(['#ffffff', '#2e5e7e', '#7e3a2e', '#e0d8c0']), bottom: '#7a2020', deck: '#bbb', taper: 0.55, sheer: 0.6 });
  gb.box(B * 0.6, 2.0, L * 0.25, '#f4f4f4', 0, 2.3, -L * 0.15);
  gb.box(B * 0.61, 0.6, L * 0.24, '#1b2630', 0, 2.8, -L * 0.15);
  gb.cyl(0.05, 5, '#ccc', 0, 4, -L * 0.05, 5);
  gb.cyl(0.03, 4, '#888', B * 0.4, 3.4, L * 0.3, 4, 0, 0, -0.6);
  return gb.mesh();
}

export function buildRIB(L = 14, livery = 'uscg') {
  const gb = new GB();
  const B = L * 0.32;
  const side = livery === 'uscg' ? '#f4f4f4' : livery === 'fire' ? '#b71c1c' : '#1a237e';
  hull(gb, L, B, 1.3, 0.8, { side, bottom: '#222', deck: '#666', taper: 0.55, sheer: 0.5 });
  if (livery === 'uscg') { gb.box(0.1, 0.8, 2.2, '#e65100', B * 0.5, 0.9, -L * 0.25, 0, 0, 0); gb.box(0.1, 0.8, 2.2, '#e65100', -B * 0.5, 0.9, -L * 0.25); }
  gb.box(B * 0.7, 2.0, L * 0.3, livery === 'fire' ? '#f4f4f4' : '#d8d8d8', 0, 2.3, 0);
  gb.box(B * 0.71, 0.6, L * 0.29, '#1b2630', 0, 2.8, 0);
  gb.box(B * 0.5, 0.25, 0.4, '#1565c0', 0, 3.45, 0);
  if (livery === 'fire') { gb.cyl(0.2, 2, '#c0c0c0', 0, 4.4, -L * 0.1, 6); gb.cyl(0.2, 1.4, '#c0c0c0', 0, 3, -L * 0.35, 6, 0.8); }
  return gb.mesh();
}

export function buildJetSki() {
  const gb = new GB();
  hull(gb, 3.2, 1.2, 0.5, 0.25, { side: pick(['#f4f4f4', '#ffeb3b', '#212121', '#1565c0']), bottom: '#333', deck: '#333', taper: 0.5, sheer: 0.1 });
  gb.box(0.4, 0.3, 1.0, '#222', 0, 0.75, 0.3);
  gb.box(0.4, 0.7, 0.3, pick(['#e53935', '#1565c0', '#222']), 0, 1.2, 0.3);
  gb.sphere(0.13, '#d7b38c', 0, 1.65, 0.25);
  gb.box(0.5, 0.06, 0.06, '#222', 0, 1.05, -0.2);
  return gb.mesh();
}

export function buildKayak(sup = false) {
  const gb = new GB();
  if (sup) {
    gb.box(0.75, 0.12, 3.3, pick(['#ffffff', '#ffd54f', '#4fc3f7']), 0, 0.05, 0);
    gb.box(0.35, 0.9, 0.22, pick(['#222', '#1565c0', '#e53935']), 0, 0.6, 0);
    gb.box(0.36, 0.7, 0.2, '#283593', 0, 1.35, 0);
    gb.sphere(0.12, '#d7b38c', 0, 1.82, 0);
    gb.cyl(0.02, 1.8, '#333', 0.3, 1.0, -0.3, 4, 0.3);
  } else {
    hull(gb, 4.5, 0.65, 0.25, 0.12, { side: pick(['#ff7043', '#ffd600', '#26c6da', '#e53935', '#43a047']), bottom: '#555', deck: '#333', taper: 0.4, sheer: 0.02 });
    gb.box(0.4, 0.45, 0.3, pick(['#e65100', '#1565c0', '#c62828']), 0, 0.5, 0.1);
    gb.sphere(0.12, '#d7b38c', 0, 0.88, 0.1);
    gb.cyl(0.02, 2.2, '#222', 0, 0.55, 0, 4, 0, 0, 1.5);
  }
  return gb.mesh();
}

export function buildSwimmer() {
  const gb = new GB();
  gb.sphere(0.13, pick(['#ff6f00', '#ffeb3b', '#f44336', '#ffffff']), 0, 0.06, 0, 1, 0.9, 1.1);
  gb.box(1.0, 0.06, 0.1, '#d7b38c', 0, 0.02, 0.3);
  gb.sphere(0.18, '#ff6f00', 0, 0.04, 0.7, 1, 0.5, 1.4); // tow buoy
  return gb.mesh();
}

export function buildKiter() {
  const g = new THREE.Group();
  const gb = new GB();
  gb.box(0.45, 0.06, 1.5, '#fafafa', 0, 0.04, 0);
  gb.box(0.35, 0.8, 0.22, '#222', 0, 0.55, 0);
  gb.box(0.36, 0.65, 0.2, '#111', 0, 1.25, 0);
  gb.sphere(0.12, '#d7b38c', 0, 1.7, 0);
  g.add(gb.mesh());
  const kite = new THREE.Mesh(new THREE.TorusGeometry(6, 0.8, 4, 16, Math.PI), new THREE.MeshLambertMaterial({ color: pick([0xff1744, 0x00e5ff, 0xffea00, 0x76ff03, 0xff9100]) }));
  kite.scale.set(1, 0.6, 1);
  g.add(kite);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x333333 });
  const lineG = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(0, 10, 10)]);
  const line = new THREE.Line(lineG, lineMat); g.add(line);
  return { group: g, kite, line };
}

export function buildSeaLion() {
  const gb = new GB();
  gb.sphere(0.35, '#5d4037', 0, 0.25, 0, 0.8, 0.6, 2.0);
  gb.sphere(0.16, '#4e342e', 0, 0.45, -0.7, 1, 1, 1.2);
  return gb.mesh();
}

export function buildBuoy(kind = 'green') {
  const gb = new GB();
  const col = { green: '#1b8a3a', red: '#c62828', yellow: '#f9a825', rw: '#f4f4f4', white: '#f4f4f4' }[kind] || '#888';
  gb.cyl(0.9, 1.2, col, 0, 0.4, 0, 10);
  if (kind === 'red') gb.addGeom(new THREE.ConeGeometry(0.8, 1.6, 10).toNonIndexed(), col, 0, 1.8, 0);
  else gb.cyl(0.7, 1.6, col, 0, 1.8, 0, 10);
  gb.cyl(0.12, 2.5, '#333', 0, 3.6, 0, 5);
  if (kind === 'rw') gb.cyl(0.71, 0.5, '#c62828', 0, 1.8, 0, 10);
  return gb.mesh();
}

export function buildMooringBall() {
  const gb = new GB();
  gb.sphere(0.45, '#f4f4f4', 0, 0.15, 0);
  gb.cyl(0.47, 0.15, '#1565c0', 0, 0.15, 0, 10);
  return gb.mesh();
}

export function buildHouseboat() {
  const gb = new GB();
  const w = rnd(6, 9), l = rnd(10, 16);
  gb.box(w, 1.2, l, '#6d5f4b', 0, 0.2, 0);
  gb.box(w * 0.92, rnd(3, 5.5), l * 0.85, pick(['#e8d5b7', '#b5c9c3', '#d7ccc8', '#a5d6a7', '#ffe0b2', '#90a4ae', '#f8bbd0']), 0, 2.8, 0);
  gb.box(w * 0.98, 0.4, l * 0.9, '#5d4037', 0, 5.4, 0);
  return gb.mesh();
}

export function buildTallShip(L = 75) {
  const g = new THREE.Group();
  const gb = new GB();
  hull(gb, L, L * 0.17, 5, 5, { side: '#1a1a1a', bottom: '#7a2020', deck: '#b39a72', taper: 0.65, sheer: 2.5, stripe: { from: 0.6, w: 0.8, color: '#f4f4f4' } });
  for (const z of [-L * 0.28, 0, L * 0.26]) {
    gb.cyl(0.5, 45, '#6d4c2f', 0, 27, z, 6);
    for (let y = 18; y < 48; y += 9) gb.box(L * 0.22 * (1 - (y - 18) / 60), 0.4, 0.4, '#6d4c2f', 0, y, z);
  }
  gb.box(0.6, 0.6, L * 0.3, '#6d4c2f', 0, 8, -L * 0.6, 0, 0.25);
  g.add(gb.mesh());
  return g;
}
