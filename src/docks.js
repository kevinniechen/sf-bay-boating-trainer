// Docks, piers, marinas, guest docks and the information shown in the Dock Guide.
// Layouts are schematic reconstructions — shapes, orientation and relative busyness are
// meant to teach you what to expect, but always confirm with current charts, cruising
// guides and the facility (call ahead / check their website) before you go.
import { ll, SAUSALITO_CHANNEL, sdfAt } from './geo.js';

const D2R = Math.PI / 180;

export const STRUCTS = [];   // {kind, cx, cz, hl, hw, rot, h, color, site, label}
export const MOORED = [];    // {x, z, heading, len, type, site}
export const GUEST_SPOTS = []; // {site, label, x, z, heading, len, free}
export const MOORINGS = [];  // {x, z, occupied, type, len, heading}
export const NAV_AIDS = [];  // {x, z, kind, name}
export const SEA_LIONS = []; // {x, z}
export const SPECIAL = [];   // big static vessels {kind, x, z, heading, len}
export const SITES = [];

class Frame {
  constructor(lat, lon, bearing) {
    const p = ll(lat, lon);
    this.x = p.x; this.z = p.z; this.b = bearing;
    const t = bearing * D2R;
    this.fx = Math.sin(t); this.fz = -Math.cos(t); this.rx = Math.cos(t); this.rz = Math.sin(t);
  }
  P(a, b) { return { x: this.x + this.fx * a + this.rx * b, z: this.z + this.fz * a + this.rz * b }; }
}

let curSite = null;
function rect(F, a0, b0, a1, b1, kind, h, color, label) {
  const c = F.P((a0 + a1) / 2, (b0 + b1) / 2);
  const s = { kind, cx: c.x, cz: c.z, hl: Math.abs(a1 - a0) / 2, hw: Math.abs(b1 - b0) / 2, rot: F.b * D2R, h, color, site: curSite?.id, label };
  STRUCTS.push(s);
  return s;
}
const FLOAT = (F, a0, b0, a1, b1, label) => rect(F, a0, b0, a1, b1, 'float', 0.45, '#8d8478', label);
const PIER = (F, a0, b0, a1, b1, label, h = 3.2, color = '#a39e93') => rect(F, a0, b0, a1, b1, 'pier', h, color, label);
const BLDG = (F, a0, b0, a1, b1, h, color = '#cfc6b0', label) => rect(F, a0, b0, a1, b1, 'building', h, color, label);
const BREAK = (F, a0, b0, a1, b1) => rect(F, a0, b0, a1, b1, 'break', 2.2, '#77736b');
// lat/lon-native helpers (for layouts measured off aerial imagery)
function bearingLL(la0, lo0, la1, lo1) { const a = ll(la0, lo0), b = ll(la1, lo1); return { br: Math.atan2(b.x - a.x, -(b.z - a.z)) / D2R, len: Math.hypot(b.x - a.x, b.z - a.z) }; }
function lineLL(la0, lo0, la1, lo1, w, kind, h, color, label) { const { br, len } = bearingLL(la0, lo0, la1, lo1); return rect(new Frame(la0, lo0, br), 0, -w / 2, len, w / 2, kind, h, color, label); }
function dockRowLL(la0, lo0, la1, lo1, o = {}) {
  const { br, len } = bearingLL(la0, lo0, la1, lo1), F = new Frame(la0, lo0, br);
  FLOAT(F, 0, -1.5, len, 1.5);
  slips(F, { a0: 3, a1: len - 3, b: -1.5, dir: -1, ...o, guest: false });
  slips(F, { a0: 3, a1: len - 3, b: 1.5, dir: 1, ...o });
  return F;
}

let seed = 1234567;
function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function rpick(a) { return a[Math.floor(rand() * a.length)]; }

function addMoored(x, z, heading, len, type) {
  MOORED.push({ x, z, heading, len, type, site: curSite?.id });
  // static OBB for collisions
  const t = heading * D2R;
  STRUCTS.push({ kind: 'boat', cx: x, cz: z, hl: len / 2, hw: len * 0.17, rot: t, h: 0, site: curSite?.id });
}

// Slips: fingers perpendicular to a main dock that runs along the frame's a-axis at offset b.
// dir = +1 fingers extend toward +b, -1 toward -b. Boats lie bow-in toward the main dock.
function slips(F, { a0, a1, b, dir, finger = 10, pitch = 5.4, occ = 0.8, mix = 0.5, guest = false, label = '', reserve = null, big = 0 }) {
  for (let a = a0; a <= a1 + 0.01; a += pitch) {
    const fb0 = b, fb1 = b + dir * finger;
    rect(F, a - 0.45, Math.min(fb0, fb1), a + 0.45, Math.max(fb0, fb1), 'float', 0.4, '#8d8478');
    const ac = a + pitch / 2;
    if (ac > a1) break;
    const len = Math.min(finger * 1.25, 7 + rand() * (finger * 0.6) + big);
    const center = F.P(ac, b + dir * (len / 2 + 0.8));
    const heading = (F.b + (dir > 0 ? 270 : 90)) % 360; // bow toward the main dock
    if (reserve && Math.abs(ac - reserve.a) < pitch / 2) {
      reserve.spot = { x: center.x, z: F.P(ac, b + dir * (10.7 / 2 + 0.8)).z, heading, ...F.P(ac, b + dir * (10.7 / 2 + 0.8)) };
      continue;
    }
    if (rand() < occ) {
      addMoored(center.x, center.z, heading, len, rand() < mix ? 'sail' : 'power');
    } else if (guest) {
      GUEST_SPOTS.push({ site: curSite.id, label, x: center.x, z: center.z, heading, len: finger * 1.2, free: true, slip: true });
    }
  }
}

// Alongside (parallel) tie-up along a float edge: positions along a from a0..a1 at side b (boat centreline).
function alongside(F, { a0, a1, b, spacing = 13, occ = 0.6, label = '', mix = 0.3, guest = true, types = null }) {
  for (let a = a0; a <= a1 + 0.01; a += spacing) {
    const p = F.P(a, b);
    const heading = rand() < 0.5 ? F.b : (F.b + 180) % 360;
    if (rand() < occ) {
      addMoored(p.x, p.z, heading, 8 + rand() * 4.5, types ? rpick(types) : (rand() < mix ? 'sail' : 'power'));
    } else if (guest) {
      GUEST_SPOTS.push({ site: curSite.id, label, x: p.x, z: p.z, heading, len: spacing, free: true });
    }
  }
}
// Same but along the b-axis (float runs along b)
function alongsideB(F, { b0, b1, a, spacing = 13, occ = 0.6, label = '', mix = 0.3, guest = true }) {
  for (let b = b0; b <= b1 + 0.01; b += spacing) {
    const p = F.P(a, b);
    const heading = rand() < 0.5 ? (F.b + 90) % 360 : (F.b + 270) % 360;
    if (rand() < occ) addMoored(p.x, p.z, heading, 8 + rand() * 4.5, rand() < mix ? 'sail' : 'power');
    else if (guest) GUEST_SPOTS.push({ site: curSite.id, label, x: p.x, z: p.z, heading, len: spacing, free: true });
  }
}

function moorField(lat, lon, r, n, occ = 0.75, mix = 0.8) {
  const c = ll(lat, lon);
  let placed = 0, guard = 0;
  while (placed < n && guard++ < 500) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
    const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
    if (MOORINGS.some(m => Math.hypot(m.x - x, m.z - z) < 26)) continue;
    const occupied = rand() < occ;
    const m = { x, z, occupied, type: rand() < mix ? 'sail' : 'power', len: 8 + rand() * 5, heading: 255, site: curSite?.id };
    MOORINGS.push(m); placed++;
    if (occupied) STRUCTS.push({ kind: 'boat', cx: x, cz: z, hl: m.len / 2, hw: m.len * 0.17, rot: 255 * D2R, h: 0, site: curSite?.id, mooring: m });
  }
}

function site(def) {
  const p = ll(def.lat, def.lon);
  curSite = { ...def, x: p.x, z: p.z };
  SITES.push(curSite);
  return curSite;
}

// ============================================================================ SF waterfront
const SF_PIERS = [
  ['Pier 45', 37.8085, -122.4180, 0, 240, 50, true],
  ['Pier 43½', 37.8086, -122.4160, 10, 80, 18, false],
  ['Pier 41', 37.8088, -122.4135, 15, 100, 25, true],
  ['Pier 35', 37.8074, -122.4062, 30, 300, 55, true],
  ['Pier 33', 37.8068, -122.4045, 35, 220, 38, true],
  ['Pier 31', 37.8062, -122.4033, 40, 240, 40, true],
  ['Pier 27', 37.8052, -122.4017, 45, 400, 55, true],
  ['Pier 23', 37.8040, -122.4005, 50, 220, 45, true],
  ['Pier 19', 37.8030, -122.3997, 53, 260, 50, true],
  ['Pier 17', 37.8020, -122.3990, 54, 260, 50, true],
  ['Pier 15', 37.8010, -122.3983, 55, 260, 50, true],
  ['Pier 9', 37.7998, -122.3974, 56, 260, 42, true],
  ['Pier 7', 37.7991, -122.3969, 57, 270, 10, false],
  ['Pier 5', 37.7986, -122.3965, 57, 170, 26, true],
  ['Pier 3', 37.7980, -122.3961, 58, 230, 34, true],
  ['Pier 1½', 37.7974, -122.3957, 58, 110, 16, true],
  ['Pier 1', 37.7967, -122.3952, 60, 190, 48, true],
  ['Pier 14', 37.7932, -122.3920, 70, 190, 6, false],
  ['Pier 22½', 37.7898, -122.3903, 72, 60, 18, true],
  ['Pier 26', 37.7882, -122.3897, 72, 230, 42, true],
  ['Pier 28', 37.7873, -122.3896, 72, 230, 42, true],
  ['Pier 30-32', 37.7857, -122.3894, 72, 250, 120, false],
  ['Pier 38', 37.7845, -122.3894, 72, 230, 36, true],
  ['Fort Mason Pier 1', 37.8063, -122.4325, 350, 200, 40, true],
  ['Fort Mason Pier 2', 37.8066, -122.4308, 352, 200, 40, true],
  ['Fort Mason Pier 3', 37.8064, -122.4292, 355, 190, 38, true],
];
export const PIER_FRAMES = {};
export const PLAYER_SLIP = { a: 152 };

export function buildDocks() {
  if (SITES.length) return;
  curSite = { id: 'sf' };
  // Waterfront piers come from the real elevation data (they're land in the DEM, draped with the
  // aerial photo); we only keep their frames for placing things relative to them.
  for (const [name, lat, lon, br] of SF_PIERS) PIER_FRAMES[name] = new Frame(lat, lon, br);

  // ---------------------------------------------------------------- Pier 40 / South Beach Harbor
  site({
    id: 'p40', name: 'Pier 40 / South Beach Harbor', lat: 37.7810, lon: -122.3865, kind: 'home',
    busy: 3, summary: 'Your home berth. 700-slip city marina tucked between Pier 40 and Oracle Park.',
    info: [
      'Layout: Pier 40 is a long concrete pier with a big shed. Its south face has a floating dock with slips — your boat lives here, bow-in. South of it, six long docks run east-west inside a rock breakwater.',
      'Exit: back out of the slip, turn in the fairway, idle east along Pier 40 and leave through the entrance at the NE corner between the Pier 40 tip and the breakwater end. 5 kn / no wake until clear.',
      'Once outside: you are just south of the Bay Bridge. Ferries to Mission Bay/Oracle Park pass right outside the entrance, SF Bay Ferry boats to Oakland/Alameda cross under the bridge, and deep-draft ships to/from Oakland use the east span of the west Bay Bridge (between the center anchorage and Yerba Buena Island). Ships anchor in Anchorage 7 just southeast.',
      'Wind is usually lighter here (the city blocks the westerly) — then it hits you hard once you pass north of the bridge.',
      'Fireboat station at Pier 22½ (just north) — fireboats may get underway fast.',
    ],
  });
  {
    // measured from NAIP imagery: Pier 38 & 40 run due east; 7 dock rows inside the east breakwater
    const F = new Frame(37.78167, -122.38768, 90);
    PIER_FRAMES.p40 = F;
    PIER(F, 0, -17, 186, 17, 'Pier 40');
    BLDG(F, 6, -14, 180, 14, 10, '#9a948a', 'Pier 40 shed');
    FLOAT(F, 186, -7, 246, -4, 'Pier 40 east float');
    lineLL(37.78234, -122.38780, 37.78234, -122.38468, 38, 'pier', 3.2, '#a39e93', 'Pier 38');
    { const P8 = new Frame(37.78234, -122.38780, 90); BLDG(P8, 6, -16, 268, 16, 11, '#8f8a80', 'Pier 38 shed'); }
    FLOAT(F, 10, 20, 205, 23, 'Pier 40 south float');
    slips(F, { a0: 14, a1: 200, b: 23, dir: 1, finger: 11, pitch: 5.6, occ: 0.82, mix: 0.25, reserve: PLAYER_SLIP, big: 2 });
    for (const [lat, lonEnd] of [[37.78111, -122.38486], [37.78078, -122.38486], [37.78045, -122.38486], [37.78012, -122.38486], [37.77981, -122.38486], [37.77951, -122.38486], [37.77928, -122.38522]])
      dockRowLL(lat, -122.38752, lat, lonEnd, { finger: 9, pitch: 5.2, occ: 0.85 });
    lineLL(37.78150, -122.38760, 37.77905, -122.38760, 4, 'float', 0.45, '#8d8478', 'shore walkway');
    lineLL(37.77908, -122.38755, 37.77908, -122.38535, 6, 'pier', 2.6, '#9b968a', 'south pier');
    lineLL(37.78189, -122.38450, 37.77958, -122.38424, 9, 'break', 2.2);
    lineLL(37.77958, -122.38424, 37.77886, -122.38516, 9, 'break', 2.2);
  }

  // ---------------------------------------------------------------- Ferry Building & Pier 1½
  site({
    id: 'p15', name: 'Pier 1½ (Ferry Building)', lat: 37.7963, lon: -122.3927, kind: 'public',
    busy: 4, summary: 'Short-term tie-up just north of the Ferry Building. Very exposed to ferry wakes and the city-front current.',
    info: [
      'Layout: small float along the NORTH side of Pier 1½, between Pier 1½ and Pier 3. The approach is a ~50 m wide slot between piers — enter perpendicular to the seawall and turn in.',
      'Traffic: the Downtown Ferry Terminal (Gates E/F/G) is immediately SOUTH of the Ferry Building. Ferries arrive and depart every few minutes on a Saturday at 25–35 kn, backing out with 3 short blasts. Never loiter in front of the gates.',
      'Hornblower dining yachts work out of Pier 3 next door.',
      'Current: the city-front current runs parallel to the pier heads (ebb toward Alcatraz/NW, flood toward the Bay Bridge/SE) at 1–2.5 kn. It drops off once you are between the piers — expect a sudden change in set as your bow enters the slot.',
      'Wakes: constant. Fenders low and plenty of them; spring lines.',
      'Verify current tie-up rules / time limits with the Port of San Francisco before relying on this dock.',
    ],
  });
  {
    // Downtown Ferry Terminal gates E/F/G (floats angled NE) and the Pier 1½ guest float (measured)
    lineLL(37.79572, -122.39190, 37.79554, -122.39138, 9, 'float', 0.6, '#8d8478', 'Ferry Gate E');
    lineLL(37.79543, -122.39168, 37.79524, -122.39112, 9, 'float', 0.6, '#8d8478', 'Ferry Gate F');
    lineLL(37.79516, -122.39128, 37.79498, -122.39072, 9, 'float', 0.6, '#8d8478', 'Ferry Gate G');
    const F = new Frame(37.79650, -122.39290, 150);
    PIER_FRAMES['Pier 1½'] = F;
    FLOAT(F, 0, -1.5, 34, 1.5, 'Pier 1½ guest float');
    alongside(F, { a0: 5, a1: 30, b: 3.4, spacing: 13.5, occ: 0.35, label: 'Pier 1½ float (outer side)' });
  }

  // ---------------------------------------------------------------- Pier 39
  site({
    id: 'p39', name: 'Pier 39 Marina', lat: 37.8100, lon: -122.4095, kind: 'marina',
    busy: 4, summary: 'Big tourist-pier marina with guest slips on both sides of Pier 39. Sea lions live on the floats in the West Marina.',
    info: [
      'Layout: West Marina (between Pier 39 and Pier 41) and East Marina (between Pier 39 and Pier 35), each protected by a breakwater along the north side. Entrances are at the outer ends — the west entrance faces west toward Fisherman\'s Wharf, the east entrance faces east.',
      'Sea lions: the famous colony hauls out on floats (K-Dock) near the west marina entrance. Keep your distance and do not tie up there.',
      'Current: the city-front current runs hard right across both entrances (2+ kn at max). Line up well up-current and crab in — you will be set sideways until the breakwater shelters you.',
      'Traffic: Blue & Gold (Pier 41) and Red & White (Pier 43½) tour boats and ferries leave from right next door, plus the Alcatraz ferries from Pier 33 to the east.',
      'Guest slips by reservation (call the harbor office on VHF / phone). On an October Saturday expect to need a reservation.',
    ],
  });
  {
    // Pier 39 (measured): East Marina rows run E–W inside a north breakwater; sea lions on the
    // west-marina floats behind the angled west breakwater.
    const F = new Frame(37.80872, -122.41068, 355);
    for (const lat of [37.81060, 37.81024, 37.80988, 37.80952]) dockRowLL(lat, -122.40995, lat, -122.40860, { finger: 9, pitch: 5.2, occ: 0.82, guest: lat === 37.81060, label: 'Pier 39 East Marina guest slip' });
    lineLL(37.81098, -122.41010, 37.81098, -122.40840, 7, 'break', 2.2);
    lineLL(37.81021, -122.41268, 37.81068, -122.41155, 6, 'break', 2.2);
    for (const lat of [37.80995, 37.80960]) dockRowLL(lat, -122.41145, lat, -122.41225, { finger: 8, pitch: 5, occ: 0.8 });
    for (let i = 0; i < 4; i++) {
      const q = ll(37.81030 - i * 0.00007, -122.41210 + i * 0.00008);
      const Fk = new Frame(37.81030 - i * 0.00007, -122.41210 + i * 0.00008, 60);
      FLOAT(Fk, 0, -3, 12, 3, 'K-Dock (sea lions)');
      for (let k = 0; k < 7; k++) SEA_LIONS.push(Fk.P(1 + rand() * 10, -2.5 + rand() * 5));
    }
  }

  // ---------------------------------------------------------------- Aquatic Park / Hyde St
  site({
    id: 'aquatic', name: 'Aquatic Park', lat: 37.8085, lon: -122.4245, kind: 'restricted',
    busy: 3, summary: 'Swim cove inside the curved Municipal Pier. Swimmers year-round, rowers & kayaks. Anchoring by permit only.',
    info: [
      'Layout: the curved Municipal Pier (Van Ness pier) wraps the west and north sides; Hyde Street Pier with the historic ships (Balclutha, Eureka, C.A. Thayer) forms the east side. The opening is on the NE between the end of the Muni Pier and Hyde St Pier.',
      'SWIMMERS: Dolphin Club / South End Rowing Club swimmers are in the water all day, often with only an orange tow-float showing. Dead slow, lookout on the bow, and generally just stay out.',
      'Shallow (8–12 ft) and very sheltered. Outside the Muni Pier the city-front current runs strongly.',
    ],
  });
  {
    curSite = SITES[SITES.length - 1];
    const pts = [[37.8063, -122.4285], [37.8080, -122.4287], [37.8095, -122.4283], [37.8103, -122.4272], [37.8107, -122.4258], [37.8107, -122.4243]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = ll(...pts[i]), b = ll(...pts[i + 1]);
      const len = Math.hypot(b.x - a.x, b.z - a.z), br = Math.atan2(b.x - a.x, -(b.z - a.z)) / D2R;
      const F = new Frame(pts[i][0], pts[i][1], br);
      PIER(F, -4, -4.5, len + 4, 4.5, 'Municipal Pier', 3.6, '#b5ae9f');
    }
    const H = new Frame(37.8079, -122.4212, 355);
    PIER(H, 0, -10, 230, 10, 'Hyde Street Pier', 3.2, '#8a7a62');
    SPECIAL.push({ kind: 'tallship', ...H.P(150, -22), heading: 355, len: 75, name: 'Balclutha' });
    const FW = new Frame(37.8080, -122.4192, 0);
    FLOAT(FW, 15, -2, 90, 1, 'Fish Alley');
    alongside(FW, { a0: 22, a1: 85, b: 4, spacing: 12, occ: 1, guest: false, types: ['fishing'] });
    alongside(FW, { a0: 22, a1: 85, b: -5, spacing: 12, occ: 1, guest: false, types: ['fishing'] });
    const P45 = PIER_FRAMES['Pier 45'];
    SPECIAL.push({ kind: 'liberty', ...P45.P(150, 36), heading: 0, len: 135, name: "SS Jeremiah O'Brien" });
    SPECIAL.push({ kind: 'sub', ...P45.P(90, -32), heading: 0, len: 95, name: 'USS Pampanito' });
  }

  // ---------------------------------------------------------------- SF Marina / St. Francis
  site({
    id: 'marina', name: 'SF Marina Small Craft Harbor (St. Francis YC / GGYC)', lat: 37.8072, lon: -122.4420, kind: 'marina',
    busy: 4, summary: 'City marina in front of the Marina Green; St. Francis YC and Golden Gate YC sit on the jetties. Racing central.',
    info: [
      'Layout: West Harbor and East Harbor behind long breakwaters, sharing an entrance between them off the Golden Gate YC jetty. St. Francis YC is at the west end.',
      'Entrance: narrow, and the westerly blows straight across it in the afternoon while the current runs along the breakwater. Expect sailboats under sail coming in and out — they may not be able to give you much room.',
      'Racing: on Saturdays race committees set courses right off the breakwater ("city front"). Fleets of 10–40 boats round marks near here — do not motor through a start or a mark rounding.',
      'Anita Rock lies ~300 yd off the St. Francis YC. Kiteboarders launch from Crissy Field just west and rip back and forth at 20+ kn.',
      'Guest berths are limited (yacht club reciprocals / harbor office).',
    ],
  });
  {
    const F = new Frame(37.8058, -122.4440, 0);
    BREAK(F, 225, -262, 233, 40);
    for (const b of [-220, -175, -130, -85, -40]) {
      FLOAT(F, 15, b - 1.5, 200, b + 1.5);
      slips(F, { a0: 18, a1: 196, b: b - 1.5, dir: -1, finger: 9, pitch: 4.8, occ: 0.85, mix: 0.85 });
      slips(F, { a0: 18, a1: 196, b: b + 1.5, dir: 1, finger: 9, pitch: 4.8, occ: 0.85, mix: 0.85 });
    }
    BREAK(F, 160, 110, 168, 330);
    for (const b of [150, 195, 240, 285]) {
      FLOAT(F, 15, b - 1.5, 150, b + 1.5);
      slips(F, { a0: 18, a1: 146, b: b - 1.5, dir: -1, finger: 9, pitch: 4.8, occ: 0.85, mix: 0.85 });
      slips(F, { a0: 18, a1: 146, b: b + 1.5, dir: 1, finger: 9, pitch: 4.8, occ: 0.85, mix: 0.85 });
    }
    PIER(F, 0, 45, 210, 105, 'Golden Gate YC jetty', 2.6, '#8f8a80');
    BLDG(F, 170, 60, 200, 95, 8, '#e9e5dc', 'Golden Gate Yacht Club');
    BLDG(F, -5, -300, 25, -255, 10, '#efe9dc', 'St. Francis Yacht Club');
  }

  // ---------------------------------------------------------------- Horseshoe Cove
  site({
    id: 'horseshoe', name: 'Horseshoe Cove (Fort Baker)', lat: 37.8330, lon: -122.4755, kind: 'marina',
    busy: 2, summary: 'Small cove right under the north end of the Golden Gate Bridge — Presidio YC and USCG Station Golden Gate.',
    info: [
      'Layout: the cove opens to the south-east. Presidio YC docks run down the EAST side, protected by a breakwater arm; the Coast Guard Station Golden Gate pier sticks out from the WEST side. Coast Guard boats leave at speed — give them room.',
      'Outside the cove the current around Lime Point and the north tower is fierce on the ebb (4–5 kn) with standing waves when the westerly opposes it. Yellow Bluff just to the north has notorious eddies and gusts.',
      'Useful as a bail-out spot near the Gate. Guest dock space is limited (Presidio YC reciprocal).',
    ],
  });
  {
    // measured: marina on the EAST side behind a breakwater arm; USCG Station Golden Gate pier on the west
    const D = new Frame(37.83328, -122.47465, 148);
    FLOAT(D, 0, -1.5, 108, 1.5, 'Presidio YC dock');
    alongside(D, { a0: 8, a1: 100, b: -3.4, spacing: 12, occ: 0.85, label: 'Presidio YC guest (reciprocal)' });
    alongside(D, { a0: 8, a1: 100, b: 3.4, spacing: 12, occ: 0.9, guest: false });
    lineLL(37.83245, -122.47571, 37.83230, -122.47352, 10, 'break', 2.2);
    const IN = new Frame(37.83262, -122.47530, 90);
    FLOAT(IN, 0, -1.5, 98, 1.5, 'breakwater float');
    alongside(IN, { a0: 6, a1: 92, b: -3.4, spacing: 12, occ: 0.85, guest: false });
    const CG = new Frame(37.83223, -122.47774, 116);
    PIER(CG, 0, -4, 95, 4, 'USCG Station Golden Gate', 3);
    alongside(CG, { a0: 30, a1: 80, b: -8, spacing: 24, occ: 1, guest: false, types: ['uscg'] });
  }

  // ---------------------------------------------------------------- Sausalito
  site({
    id: 'sausalito', name: 'Sausalito waterfront', lat: 37.8566, lon: -122.4780, kind: 'guest',
    busy: 5, summary: 'Downtown Sausalito: ferry landing, a small city guest dock, the Spinnaker point and Sausalito Yacht Harbor. Packed on sunny Saturdays.',
    info: [
      'From south to north along Bridgeway: (1) Sausalito FERRY LANDING — a pier with a float at the end, Golden Gate Ferry and Blue & Gold land here every ~30–60 min. Never block it; ferries back off it with 3 short blasts. (2) CITY GUEST DOCK — a short float just north of the ferry, parallel to shore; first-come, short time limit, boats raft up on busy days. (3) The SPINNAKER restaurant on its own little point. (4) SAUSALITO YACHT HARBOR — rows of docks behind a floating breakwater; guest slips by reservation with the harbor office.',
      'Speed: the whole waterfront and Richardson Bay are a 5-knot / no-wake zone, and the local sheriff/harbor patrol enforces it. Your wake slams boats into the docks.',
      'Wind: the westerly comes over the hills in gusts ("williwaws") — calm one moment, 20 kn from a new direction the next, often blowing you OFF the dock. Have lines ready before you commit.',
      'Current: weak along the waterfront (<0.5 kn) — a nice break after crossing the bay.',
      'Depth: the dredged channel hugs the Sausalito shore. East of the channel markers Richardson Bay is only 2–6 ft deep at low tide. Red markers are on your right (starboard) as you head IN (northwest).',
    ],
  });
  {
    // ferry float (measured) with gangway, city guest dock just north of it, Spinnaker point
    const FL = new Frame(37.85637, -122.47845, 90);
    PIER(FL, 0, -2, 25, 2, 'Sausalito ferry gangway', 2.6);
    FLOAT(FL, 25, -5, 82, 5, 'Sausalito ferry landing');
    const GD = new Frame(37.85668, -122.47800, 90);
    PIER(GD, -12, -1.5, 0, 1.5, 'gangway', 2.4);
    FLOAT(GD, 0, -1.5, 45, 1.5, 'Sausalito city guest dock');
    alongside(GD, { a0: 6, a1: 40, b: -3.4, spacing: 13, occ: 0.55, label: 'Sausalito guest dock (north side)' });
    alongside(GD, { a0: 6, a1: 40, b: 3.4, spacing: 13, occ: 0.75, label: 'Sausalito guest dock (south side)' });
    const SP = new Frame(37.85880, -122.47860, 90);
    BLDG(SP, 0, -12, 22, 12, 7, '#e8e2d4', 'The Spinnaker');
    const YH = new Frame(37.8590, -122.4800, 55);
    for (const b of [-10, -48, -86, -124, -162]) {
      FLOAT(YH, 10, b - 1.5, 170, b + 1.5);
      slips(YH, { a0: 12, a1: 166, b: b - 1.5, dir: -1, finger: 10, pitch: 5.2, occ: 0.85, mix: 0.6 });
      slips(YH, { a0: 12, a1: 166, b: b + 1.5, dir: 1, finger: 10, pitch: 5.2, occ: b === -10 ? 0.55 : 0.85, mix: 0.6, guest: b === -10, label: 'Sausalito Yacht Harbor guest slip (reserve)' });
    }
    BREAK(YH, 182, -190, 187, 0);
    const SYC = new Frame(37.8608, -122.4822, 50);
    FLOAT(SYC, 5, -1.5, 75, 1.5, 'Sausalito Yacht Club');
    slips(SYC, { a0: 8, a1: 72, b: -1.5, dir: -1, finger: 8, pitch: 5, occ: 0.85, mix: 0.8 });
    slips(SYC, { a0: 8, a1: 72, b: 1.5, dir: 1, finger: 8, pitch: 5, occ: 0.85, mix: 0.8 });
    const PH = new Frame(37.8622, -122.4848, 40);
    for (const b of [0, -38]) {
      FLOAT(PH, 10, b - 1.5, 130, b + 1.5);
      slips(PH, { a0: 12, a1: 126, b: b - 1.5, dir: -1, finger: 9, pitch: 5, occ: 0.85, mix: 0.7 });
      slips(PH, { a0: 12, a1: 126, b: b + 1.5, dir: 1, finger: 9, pitch: 5, occ: 0.85, mix: 0.7 });
    }
  }
  site({
    id: 'schoonmaker', name: 'Schoonmaker Point Marina', lat: 37.8650, lon: -122.4895, kind: 'guest',
    busy: 3, summary: 'Marina with guest slips at the north end of the Sausalito waterfront; Le Garage restaurant and a small beach next door.',
    info: [
      'Layout: three docks running out NE from shore. Guest berths are on the outer end of the southern dock — call the harbor office first.',
      'Approach: follow the Sausalito channel markers (reds to starboard heading in). Do not cut the corner east of the markers — it is mudflat at low tide.',
      'Calmer than downtown, but the same gusty williwaws. 5 kn zone.',
    ],
  });
  {
    const F = new Frame(37.8648, -122.4902, 40);
    for (const b of [0, -40, -80]) {
      FLOAT(F, 10, b - 1.5, 150, b + 1.5);
      slips(F, { a0: 12, a1: 146, b: b - 1.5, dir: -1, finger: 10, pitch: 5.2, occ: 0.85, mix: 0.6 });
      slips(F, { a0: 12, a1: 146, b: b + 1.5, dir: 1, finger: 10, pitch: 5.2, occ: b === 0 ? 0.5 : 0.85, mix: 0.6, guest: b === 0, label: 'Schoonmaker guest slip' });
    }
    BLDG(F, -30, 10, -10, 40, 6, '#e6dccb', 'Le Garage');
  }
  site({
    id: 'clipper', name: 'Clipper Yacht Harbor', lat: 37.8705, lon: -122.4950, kind: 'marina',
    busy: 2, summary: 'Large Sausalito marina at the head of the channel. Mostly permanent berths; fuel dock.',
    info: [
      'Layout: six long docks fanning out NE. Fuel dock near the entrance. Beyond it, the Waldo Point / Gate 5 houseboat community lines the shore.',
      'The channel shoals as you go north — watch your depth, especially at a minus tide.',
    ],
  });
  {
    const F = new Frame(37.8702, -122.4958, 45);
    for (const b of [0, -40, -80, -120, -160]) {
      FLOAT(F, 10, b - 1.5, 220, b + 1.5);
      slips(F, { a0: 12, a1: 216, b: b - 1.5, dir: -1, finger: 10, pitch: 5.2, occ: 0.9, mix: 0.6 });
      slips(F, { a0: 12, a1: 216, b: b + 1.5, dir: 1, finger: 10, pitch: 5.2, occ: 0.9, mix: 0.6 });
    }
    const HB = new Frame(37.8768, -122.5015, 60);
    for (const b of [0, -32, -64]) {
      FLOAT(HB, 10, b - 1.5, 125, b + 1.5);
      for (let a = 16; a < 120; a += 13) for (const s of [-1, 1]) { const p = HB.P(a, b + s * 8); MOORED.push({ x: p.x, z: p.z, heading: (HB.b + 90) % 360, len: 12, type: 'house', site: 'clipper' }); STRUCTS.push({ kind: 'boat', cx: p.x, cz: p.z, hl: 6, hw: 4, rot: (HB.b + 90) * D2R, h: 0 }); }
    }
  }
  // Sausalito channel markers: reds on the NE (starboard heading in), greens on the SW
  {
    const ch = SAUSALITO_CHANNEL.map(([a, b]) => ll(a, b));
    let n = 2;
    for (let i = 0; i + 1 < ch.length; i++) {
      const a = ch[i], b = ch[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      const rx = -dz / L, rz = dx / L; // right-hand normal when heading in (NW)
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      NAV_AIDS.push({ x: mx + rx * 55, z: mz + rz * 55, kind: 'red', name: `R "${n}"` });
      NAV_AIDS.push({ x: mx - rx * 55, z: mz - rz * 55, kind: 'green', name: `G "${n - 1}"` });
      n += 2;
    }
  }

  // ---------------------------------------------------------------- Tiburon / Belvedere
  site({
    id: 'sams', name: "Sam's Anchor Cafe (Tiburon)", lat: 37.8723, lon: -122.4562, kind: 'restaurant',
    busy: 5, summary: "Classic dock-and-dine. Two guest floats right off Sam's deck on Main Street, in the little basin next to the Tiburon ferry pier. Packed and chaotic on sunny weekends.",
    info: [
      "Layout: Sam's deck on Main Street faces south over the water. Its guest dock is two parallel floats running out from the deck (~100 ft). Boats tie along the outer sides and in the slot between them; on busy days they raft 2–3 deep and dock hands direct you.",
      "Neighbours: the floats come down into the same small basin as the Corinthian Yacht Club slips, protected by CYC's angled breakwater. The Tiburon FERRY pier is right next door to the east — the basin entrance is just past the end of the ferry pier, so never loiter there.",
      'Approach: come in from the southeast, pass the end of the ferry pier (watch for the ferry), slow to no-wake, and turn up into the basin toward the deck. It is tight with CYC boats on your left — fenders out on both sides.',
      'Wind: the afternoon westerly pours over Belvedere Island in gusts of 10–20 kn, usually blowing across or slightly OFF the dock. Current inside the cove is weak, but the Raccoon Strait current (2–4 kn) sweeps past the cove entrance.',
      'Saturday reality: noon–4pm in October can mean 15–25 boats jockeying for space, people on the dock watching you, and paddle-boarders in the cove. Have fenders out on BOTH sides and lines ready before you enter.',
    ],
  });
  {
    // measured from NAIP: Sam's deck faces south across the water; its guest dock is two parallel
    // floats running out ~155° from the deck. Tiburon ferry pier just east; Corinthian YC harbor on the point.
    const DK = new Frame(37.87275, -122.45668, 90);
    PIER(DK, 0, -2, 26, 12, "Sam's deck", 2.4, '#7b6a55');
    BLDG(DK, 0, -22, 26, -2, 7, '#e9dfcf', "Sam's Anchor Cafe");
    const S1 = new Frame(37.87261, -122.45651, 155), S2 = new Frame(37.87261, -122.45632, 155);
    FLOAT(S1, 0, -1.3, 30, 1.3, "Sam's guest dock (west float)");
    FLOAT(S2, 0, -1.3, 26, 1.3, "Sam's guest dock (east float)");
    alongside(S1, { a0: 6, a1: 26, b: 3.2, spacing: 12.5, occ: 0.5, label: "Sam's dock — west float, outer side" });
    alongside(S1, { a0: 6, a1: 26, b: -3.2, spacing: 12.5, occ: 0.8, label: "Sam's dock — between the floats" });
    alongside(S2, { a0: 6, a1: 22, b: -3.2, spacing: 12.5, occ: 0.6, label: "Sam's dock — east float, outer side" });
    const TF = new Frame(37.87262, -122.45592, 120);
    PIER(TF, 0, -2.5, 40, 2.5, 'Tiburon ferry pier', 2.8);
    // Corinthian Yacht Club harbor (on the point)
    lineLL(37.87232, -122.45722, 37.87154, -122.45722, 3, 'float', 0.45, '#8d8478', 'CYC walkway');
    dockRowLL(37.87230, -122.45716, 37.87230, -122.45650, { finger: 8, pitch: 4.8, occ: 0.85, mix: 0.7 });
    dockRowLL(37.87202, -122.45712, 37.87202, -122.45579, { finger: 9, pitch: 5, occ: 0.85, mix: 0.7 });
    { const Fb = new Frame(37.87154, -122.45712, 90); FLOAT(Fb, 0, -1.5, 108, 1.5, 'CYC outer float');
      slips(Fb, { a0: 4, a1: 104, b: -1.5, dir: -1, finger: 10, pitch: 5.4, occ: 0.85, mix: 0.6 }); }
    lineLL(37.87154, -122.45576, 37.87211, -122.45539, 4, 'break', 2.2);
    BLDG(new Frame(37.87165, -122.45760, 90), 0, -12, 28, 6, 8, '#efe8da', 'Corinthian Yacht Club');
    moorField(37.8702, -122.4598, 120, 16, 0.8, 0.85);
  }

  // ---------------------------------------------------------------- Angel Island / Ayala Cove
  site({
    id: 'ayala', name: 'Angel Island — Ayala Cove', lat: 37.8682, lon: -122.4352, kind: 'guest',
    busy: 5, summary: 'State park cove with public guest docks and mooring buoys. Fills by late morning on nice weekends.',
    info: [
      'Layout: small cove on the NW side of Angel Island facing Tiburon across Raccoon Strait. Guest docks run out from the WEST side of the cove; the ferry pier is on the EAST side (Tiburon & SF ferries land there — keep it clear). Mooring buoys fill the middle (bow-and-stern tie on two balls).',
      'Fees: day-use / overnight fees are paid at the self-pay station or to the ranger.',
      'Entrance: the Raccoon Strait current runs right across the mouth of the cove at 2–4 kn. Expect to be set sideways as you enter; once inside it is nearly still water.',
      'Depth: the cove shoals toward the beach — under 5 ft at low tide near the inner end. Stay toward the docks/buoys.',
      'Wind: sheltered from the westerly by the island — usually the calmest docking on the central bay.',
    ],
  });
  {
    // measured: the guest float runs SSW off the east shore with two fingers off its west side;
    // the ferry pier is just north on the east shore.
    const F = new Frame(37.86828, -122.43486, 205);
    PIER(F, -10, -1.5, 0, 1.5, 'gangway', 2.4);
    FLOAT(F, 0, -1.5, 77, 1.5, 'Ayala Cove guest dock');
    alongside(F, { a0: 8, a1: 72, b: -3.4, spacing: 13, occ: 0.65, label: 'Ayala guest dock (east side)' });
    alongside(F, { a0: 8, a1: 52, b: 3.4, spacing: 13, occ: 0.7, label: 'Ayala guest dock (west side)' });
    for (const lon of [-122.43547, -122.43571]) lineLL(37.86772, lon + 0.00025, 37.86772, lon - 0.00010, 2.4, 'float', 0.45, '#8d8478', 'Ayala finger');
    const FP = new Frame(37.86866, -122.43482, 290);
    PIER(FP, 0, -3, 28, 3, 'Ayala ferry pier', 3);
    FLOAT(FP, 28, -9, 36, 9, 'Ayala ferry landing');
    moorField(37.8683, -122.4368, 90, 12, 0.6, 0.75);
  }

  // ---------------------------------------------------------------- Alcatraz
  site({
    id: 'alcatraz', name: 'Alcatraz Island', lat: 37.8267, lon: -122.4228, kind: 'restricted',
    busy: 3, summary: 'National Park. NO private boat landing. Alcatraz Cruises ferries from Pier 33 land at the east-side dock every ~30 min.',
    info: [
      'There is no recreational dock. The only landing is the NPS/concession ferry dock on the east side — stay well clear of it and of the ferries running between it and Pier 33.',
      'Current: Alcatraz sits in the middle of the main tidal stream. 2–3 kn around the island with eddies in its lee; wind-against-tide chop on the west side on an ebb afternoon.',
      'Shipping: deep-draft vessels pass both north and south of the island. Little Alcatraz rock is off the NW tip.',
    ],
  });
  {
    const F = new Frame(37.8270, -122.4218, 60);
    PIER(F, 0, -6, 45, 6, 'Alcatraz dock', 3.4);
    FLOAT(F, 45, -12, 55, 12, 'Alcatraz ferry float');
  }

  // ---------------------------------------------------------------- Treasure Island / Clipper Cove
  site({
    id: 'clippercove', name: 'Clipper Cove (Treasure Island)', lat: 37.8155, lon: -122.3700, kind: 'anchorage',
    busy: 3, summary: 'Protected cove between Treasure Island and Yerba Buena Island. Popular anchorage; Treasure Isle Marina on the TI side.',
    info: [
      'Layout: cove opens to the WEST. Treasure Isle Marina docks line the north (TI) side. Anchored boats fill the middle on weekends.',
      'Shallow at the west entrance and the east end — favour the middle on entry and watch the depth sounder; boats regularly touch bottom at low tide near the entrance.',
      'Very sheltered from the westerly (in the lee of YBI). From the city: pass under the Bay Bridge west span, then north around the west side of YBI.',
    ],
  });
  {
    const F = new Frame(37.8170, -122.3690, 190);
    for (const b of [-90, -50, -10, 30]) {
      FLOAT(F, 8, b - 1.5, 85, b + 1.5);
      slips(F, { a0: 10, a1: 81, b: b - 1.5, dir: -1, finger: 9, pitch: 5, occ: 0.75, mix: 0.7 });
      slips(F, { a0: 10, a1: 81, b: b + 1.5, dir: 1, finger: 9, pitch: 5, occ: 0.75, mix: 0.7, guest: b === 30, label: 'Treasure Isle Marina guest' });
    }
    moorField(37.8152, -122.3735, 140, 14, 0.9, 0.85);
  }

  // ---------------------------------------------------------------- other statics
  {
    curSite = { id: 'sf' };
    const P27 = PIER_FRAMES['Pier 27'];
    SPECIAL.push({ kind: 'cruise', ...P27.P(210, -27 - 17), heading: 45, len: 290, name: 'Cruise ship at Pier 27' });
    const P22 = PIER_FRAMES['Pier 22½'];
    SPECIAL.push({ kind: 'fireboat', ...P22.P(30, 16), heading: 72, len: 27, name: 'SFFD Fireboat' });
    const anch = ll(37.7815, -122.3700);
    SPECIAL.push({ kind: 'anchored', x: anch.x, z: anch.z, heading: 240, len: 220, name: 'Bulk carrier (Anchorage 7)' });
    const anch2 = ll(37.7760, -122.3760);
    SPECIAL.push({ kind: 'anchored', x: anch2.x, z: anch2.z, heading: 245, len: 185, name: 'Tanker (Anchorage 7)' });
  }

  // ---------------------------------------------------------------- aids to navigation (approximate)
  const aid = (lat, lon, kind, name) => { const p = ll(lat, lon); NAV_AIDS.push({ x: p.x, z: p.z, kind, name }); };
  aid(37.8180, -122.4050, 'rw', 'Blossom Rock lighted buoy');
  aid(37.8379, -122.4467, 'rw', 'Harding Rock buoy');
  aid(37.8064, -122.4553, 'green', 'Anita Rock');
  aid(37.8290, -122.4285, 'green', 'Little Alcatraz');
  aid(37.8527, -122.4165, 'red', 'Point Blunt "2"');
  aid(37.8635, -122.4650, 'green', 'Belvedere Point');
  aid(37.8195, -122.4500, 'yellow', 'VTS lane marker');
  aid(37.8195, -122.4300, 'yellow', 'VTS lane marker');
  aid(37.8080, -122.3790, 'yellow', 'Bay Bridge ship channel');
  aid(37.8700, -122.4505, 'red', 'Point Tiburon');
  aid(37.8705, -122.4405, 'green', 'Ayala Cove entrance');
  cullOnLand();
}

// Anything that ended up on real land (per the elevation data) is removed, so no boat ever sits on a hillside.
function cullOnLand() {
  const wet = (x, z, tol = 2) => sdfAt(x, z) < tol;
  const before = STRUCTS.length;
  const keep = STRUCTS.filter(st => st.kind === 'pier' || st.kind === 'building' || st.kind === 'break' || wet(st.cx, st.cz, st.kind === 'float' ? 6 : 1.5));
  STRUCTS.length = 0; STRUCTS.push(...keep);
  const fm = MOORED.filter(m => wet(m.x, m.z, 1.5)); MOORED.length = 0; MOORED.push(...fm);
  const fg = GUEST_SPOTS.filter(g => wet(g.x, g.z, 1)); GUEST_SPOTS.length = 0; GUEST_SPOTS.push(...fg);
  const fo = MOORINGS.filter(m => wet(m.x, m.z, 0)); MOORINGS.length = 0; MOORINGS.push(...fo);
  const fs = SPECIAL.filter(m => wet(m.x, m.z, -3)); SPECIAL.length = 0; SPECIAL.push(...fs);
  const fa = NAV_AIDS.filter(a => wet(a.x, a.z, -3)); NAV_AIDS.length = 0; NAV_AIDS.push(...fa);
  console.info(`[docks] removed ${before - STRUCTS.length} structures that fell on land`);
}

// ---------------------------------------------------------------- spatial index for collision
const CELLSZ = 60;
const grid = new Map();
export function indexStructs() {
  grid.clear();
  for (const s of STRUCTS) {
    const r = Math.hypot(s.hl, s.hw);
    const i0 = Math.floor((s.cx - r) / CELLSZ), i1 = Math.floor((s.cx + r) / CELLSZ);
    const j0 = Math.floor((s.cz - r) / CELLSZ), j1 = Math.floor((s.cz + r) / CELLSZ);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = i * 100000 + j;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    }
  }
}
export function structsNear(x, z, r = 30) {
  const out = new Set();
  const i0 = Math.floor((x - r) / CELLSZ), i1 = Math.floor((x + r) / CELLSZ);
  const j0 = Math.floor((z - r) / CELLSZ), j1 = Math.floor((z + r) / CELLSZ);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const a = grid.get(i * 100000 + j);
    if (a) for (const s of a) out.add(s);
  }
  return out;
}
// circle vs oriented box. Returns {depth, nx, nz} (normal pushes circle out) or null.
export function circleOBB(x, z, r, s) {
  // OBB local axes: a along bearing rot -> (sin, -cos), b -> (cos, sin)
  const fx = Math.sin(s.rot), fz = -Math.cos(s.rot), rx = Math.cos(s.rot), rz = Math.sin(s.rot);
  const dx = x - s.cx, dz = z - s.cz;
  const la = dx * fx + dz * fz, lb = dx * rx + dz * rz;
  const ca = Math.max(-s.hl, Math.min(s.hl, la)), cb = Math.max(-s.hw, Math.min(s.hw, lb));
  let da = la - ca, db = lb - cb;
  let d2 = da * da + db * db;
  if (d2 > r * r) return null;
  if (d2 < 1e-9) { // centre inside box
    const pa = s.hl - Math.abs(la), pb = s.hw - Math.abs(lb);
    if (pa < pb) { da = Math.sign(la) || 1; db = 0; return { depth: pa + r, nx: fx * da, nz: fz * da }; }
    db = Math.sign(lb) || 1; return { depth: pb + r, nx: rx * db, nz: rz * db };
  }
  const d = Math.sqrt(d2);
  const na = da / d, nb = db / d;
  return { depth: r - d, nx: fx * na + rx * nb, nz: fz * na + rz * nb };
}

export function nearestSite(x, z, maxD = 600) {
  let best = null, bd = maxD;
  for (const s of SITES) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
  return best;
}

// Practice-start positions (approach) for each site: [lat, lon, heading]
export const PRACTICE_STARTS = {
  p40: { lat: 37.7822, lon: -122.3829, heading: 255, label: 'Outside South Beach Harbor entrance' },
  p15: { lat: 37.7975, lon: -122.3895, heading: 225, label: 'Off Pier 1½' },
  p39: { lat: 37.8125, lon: -122.4085, heading: 180, label: 'Off Pier 39' },
  aquatic: { lat: 37.8130, lon: -122.4240, heading: 190, label: 'Outside Aquatic Park' },
  marina: { lat: 37.8110, lon: -122.4410, heading: 180, label: 'Off the SF Marina' },
  horseshoe: { lat: 37.8340, lon: -122.4700, heading: 270, label: 'Outside Horseshoe Cove' },
  sausalito: { lat: 37.8545, lon: -122.4745, heading: 340, label: 'Approaching Sausalito' },
  schoonmaker: { lat: 37.8610, lon: -122.4790, heading: 315, label: 'Sausalito channel' },
  clipper: { lat: 37.8650, lon: -122.4880, heading: 320, label: 'Sausalito channel (north)' },
  sams: { lat: 37.8712, lon: -122.4545, heading: 320, label: 'Off the Tiburon ferry pier' },
  ayala: { lat: 37.8705, lon: -122.4370, heading: 160, label: 'Ayala Cove entrance' },
  alcatraz: { lat: 37.8200, lon: -122.4200, heading: 0, label: 'South of Alcatraz' },
  clippercove: { lat: 37.8150, lon: -122.3830, heading: 90, label: 'West of Clipper Cove' },
};
