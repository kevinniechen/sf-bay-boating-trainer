// HUD: instruments, compass tape, engine controls, minimap/radar, AIS target list,
// Rules Advisor, radio log, toasts — and the full-screen chart / Dock Guide.
import { BOUNDS, GX, GZ, CELL, sdf, depthGrid, LANDMASSES, NO_WAKE_ZONES, SHIP_LANES, HAZARDS, ll, toLL, OUTER_WATER_XZ, DEM } from './geo.js';
import { env, currentAt, windAt, tideLabel, tideHeight, KN, CGX, CGZ, CUR_CELL } from './env.js';
import { STRUCTS, SITES, GUEST_SPOTS, NAV_AIDS, PRACTICE_STARTS } from './docks.js';
import { radio } from './radio.js';

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
export const hud = { chartOpen: false, layers: { depth: true, current: true, wind: false, traffic: true, lanes: true, nowake: true, hazards: true, labels: true, zones: true } };

export function fmtRange(m) { const yd = m * 1.0936; return yd < 1500 ? `${Math.round(yd / 10) * 10} yd` : `${(m / 1852).toFixed(2)} nm`; }
export const ft = (m) => Math.round(m * 3.281);
const deg3 = (d) => String(Math.round(((d % 360) + 360) % 360)).padStart(3, '0') + '°';

// ---------------------------------------------------------------- toasts
export function toast(msg, kind = 'info', ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.innerHTML = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('fade'), ms);
  setTimeout(() => el.remove(), ms + 600);
  while ($('toasts').children.length > 5) $('toasts').firstChild.remove();
}

// ---------------------------------------------------------------- instruments
export function updateInstruments(p, extra) {
  const c = currentAt(p.x, p.z), w = windAt(p.x, p.z);
  const cs = Math.hypot(c.x, c.z) / KN, cset = (Math.atan2(c.x, -c.z) / D2R + 360) % 360;
  const depthFt = p.depth > 0 ? ft(p.depth) : 0;
  const ax = w.x - p.vx, az = w.z - p.vz, aw = Math.hypot(ax, az) / KN;
  const hh = Math.floor(env.clock), mm = Math.floor((env.clock - hh) * 60);
  const zone = extra.zone ? `<div class="warn">${extra.zone}</div>` : '';
  setHTML('inst', `
    <div class="big"><span>${p.sogKn.toFixed(1)}</span><small>kn SOG</small></div>
    <div class="row"><b>HDG</b> ${deg3(p.headingDeg)} <b>COG</b> ${p.sogKn > 0.3 ? deg3(p.cogDeg) : '---'}</div>
    <div class="row ${depthFt < 6 ? 'alarm' : depthFt < 12 ? 'warn' : ''}"><b>DEPTH</b> ${depthFt} ft <span class="dim">(tide ${(tideHeight() * 3.281).toFixed(1)} ft)</span></div>
    <div class="row"><b>WIND</b> ${Math.round(w.speed / KN)} kn from ${deg3(w.fromDeg)} <span class="dim">app ${Math.round(aw)}</span></div>
    <div class="row"><b>CURRENT</b> ${cs.toFixed(1)} kn → ${deg3(cset)}</div>
    <div class="row dim">${tideLabel()}</div>
    <div class="row dim">${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · Sat Oct 3 ${extra.timeScale > 1 ? ` · <b>${extra.timeScale}× time</b>` : ''}</div>
    <div class="row">${p.fenders ? '<span class="ok">FENDERS OUT</span>' : '<span class="dim">fenders in</span>'} ${p.tied ? '<span class="ok">· TIED UP</span>' : p.alongside ? '<span class="ok">· ALONGSIDE (L to tie)</span>' : ''}</div>
    ${p.damage > 0 ? `<div class="row ${p.damage > 40 ? 'alarm' : 'warn'}"><b>DAMAGE</b> ${Math.round(p.damage)}%</div>` : ''}
    ${zone}`);
  return { aw };
}

// ---------------------------------------------------------------- compass tape
export function drawCompass(p) {
  const cv = $('compass'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(12,15,17,0.70)'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  const hd = p.headingDeg, ppd = 4;
  ctx.strokeStyle = '#e9ecea'; ctx.fillStyle = '#e9ecea'; ctx.font = 'bold 13px "Barlow Condensed", system-ui'; ctx.textAlign = 'center';
  for (let d = Math.floor(hd - 60); d <= hd + 60; d++) {
    const x = W / 2 + (d - hd) * ppd, dd = ((d % 360) + 360) % 360;
    if (dd % 5 === 0) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x, H - (dd % 10 === 0 ? 12 : 6)); ctx.stroke(); }
    if (dd % 30 === 0) ctx.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[dd] ?? dd, x, 16);
  }
  if (p.sogKn > 0.5) { const x = W / 2 + ((p.cogDeg - hd + 540) % 360 - 180) * ppd; ctx.fillStyle = '#ffd54f'; ctx.fillRect(x - 2, H - 16, 4, 16); }
  ctx.fillStyle = '#ff5252'; ctx.beginPath(); ctx.moveTo(W / 2 - 7, 0); ctx.lineTo(W / 2 + 7, 0); ctx.lineTo(W / 2, 9); ctx.fill();
}

// ---------------------------------------------------------------- control panel
// Left → right: helm (wheel), twin binnacle (styled after a Yamaha/Mercury digital twin control),
// trim, bow thruster, camera. Every control shows its key, and the key lights up while held.
export const LEVER_SWEEP = 52 * D2R;
export const engHit = { levers: [], wheel: null };
function keycap(ctx, x, y, label, down, w = 22) {
  ctx.fillStyle = down ? '#e8a33d' : '#22282b';
  ctx.strokeStyle = down ? '#ffd08a' : '#4a5357'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.roundRect(x, y, w, 18, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = down ? '#17130c' : '#dfe8ee'; ctx.font = 'bold 11px "Barlow Condensed", system-ui'; ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + 13);
}
function label(ctx, x, y, t, col = '#8f9894', size = 10, align = 'left', bold = false) {
  ctx.fillStyle = col; ctx.font = `${bold ? '600 ' : '500 '}${size + 1}px "Barlow Condensed", system-ui`; ctx.textAlign = align;
  ctx.letterSpacing = bold && t === t.toUpperCase() ? '1.2px' : '0px'; ctx.fillText(t, x, y); ctx.letterSpacing = '0px';
}
export function drawEngines(p, keys = new Set(), camMode = 'chase') {
  const cv = $('engines'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(12,15,17,0.74)'; ctx.beginPath(); ctx.roundRect(0, 0, W, H, 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.fillStyle = '#e8a33d'; ctx.fillRect(0, 0, W, 2);

  // ======== HELM
  const wx = 92, wy = 86, wr = 52;
  engHit.wheel = { cx: wx, cy: wy, r: wr };
  label(ctx, 14, 16, 'HELM', '#a8b2ad', 10, 'left', true);
  ctx.save(); ctx.translate(wx, wy); ctx.rotate(p.wheelTurns * Math.PI * 2);
  ctx.strokeStyle = '#151515'; ctx.lineWidth = 11; ctx.beginPath(); ctx.arc(0, 0, wr, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, wr + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#a9b1b8'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + k * Math.PI * 2 / 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12); ctx.lineTo(Math.cos(a) * (wr - 4), Math.sin(a) * (wr - 4)); ctx.stroke(); }
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#d32f2f'; ctx.beginPath(); ctx.arc(0, -wr, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2c2c2c'; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  keycap(ctx, wx - wr - 14, wy - 9, '←', keys.has('arrowleft'));
  keycap(ctx, wx + wr - 8, wy - 9, '→', keys.has('arrowright'));
  const turns = p.wheelTurns;
  label(ctx, wx, 158, Math.abs(turns) < 0.04 ? 'wheel centered' : `${Math.abs(turns).toFixed(1)} turns ${turns > 0 ? 'STBD' : 'PORT'}`, Math.abs(turns) < 0.08 ? '#66bb6a' : '#ffd54f', 11, 'center', true);
  const steerDeg = p.steer / D2R;
  ctx.fillStyle = '#0f1a22'; ctx.fillRect(wx - 55, 166, 110, 7);
  ctx.fillStyle = '#4a6070'; ctx.fillRect(wx - 1, 164, 2, 11);
  ctx.fillStyle = Math.abs(steerDeg) < 1 ? '#66bb6a' : '#ffd54f'; ctx.fillRect(wx, 167, steerDeg / 32 * 55, 5);
  label(ctx, wx, 186, `engines ${Math.abs(steerDeg).toFixed(0)}° ${steerDeg > 0.5 ? 'stbd' : steerDeg < -0.5 ? 'port' : ''} · Shift = spin fast`, '#6b7370', 9, 'center');

  // ======== BINNACLE — top-down view of a twin side-mount digital control (Flexball/Yamaha style):
  // chrome housing with a glass button panel, a chrome arm down each side pivoting at the housing's
  // mid-line, and black grips meeting in the middle. Seen from above, pushing a lever forward slides
  // its grip toward the bow (up); N = grip level with the pivots; astern = grip slides aft (down).
  const bx0 = 188;
  label(ctx, bx0, 16, 'THROTTLE / SHIFT', '#a8b2ad', 10, 'left', true);
  engHit.levers = [];
  const cx0 = bx0 + 136, pivY = 114, ARM = 70, hw2 = 58, hh2 = 46;
  const chrome = (x0, x1) => { const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#5d656c'); g.addColorStop(0.18, '#d9dee2'); g.addColorStop(0.42, '#f7f9fa'); g.addColorStop(0.62, '#9aa3aa'); g.addColorStop(0.85, '#e3e7ea'); g.addColorStop(1, '#646c73'); return g; };
  // fore/aft scale on the outside of each arm
  const run = p.engines.map(e => e.running && !e.failed);
  const yOf = (v) => pivY - Math.sin(v * LEVER_SWEEP) * ARM;
  // housing shadow + body
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.roundRect(cx0 - hw2 + 3, pivY - hh2 + 5, hw2 * 2, hh2 * 2, 18); ctx.fill();
  ctx.fillStyle = chrome(cx0 - hw2, cx0 + hw2); ctx.beginPath(); ctx.roundRect(cx0 - hw2, pivY - hh2, hw2 * 2, hh2 * 2, 18); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
  // glass panel with the four buttons
  const gw2 = 40, gh2 = 36;
  const glass = ctx.createLinearGradient(0, pivY - gh2, 0, pivY + gh2); glass.addColorStop(0, '#2a2522'); glass.addColorStop(1, '#14110f');
  ctx.fillStyle = glass; ctx.beginPath(); ctx.roundRect(cx0 - gw2, pivY - gh2, gw2 * 2, gh2 * 2, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.stroke();
  const pbtn = (x, y, txt, led, on) => {
    ctx.fillStyle = '#2b4c86'; ctx.beginPath(); ctx.roundRect(x - 14, y - 9, 28, 18, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x - 13, y - 8, 26, 3);
    ctx.fillStyle = on ? led : '#18263a'; ctx.shadowColor = led; ctx.shadowBlur = on ? 10 : 0;
    ctx.beginPath(); ctx.arc(x - 18, y - 9, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    label(ctx, x, y + 3.5, txt, on ? '#ffffff' : '#a9bfdf', 7, 'center', true);
  };
  const nP = (run[0] || p.prep.battery) && p.engines[0].gear === 0, nS = (run[1] || p.prep.battery) && p.engines[1].gear === 0;
  const sync = run[0] && run[1] && Math.abs(p.engines[0].lever - p.engines[1].lever) < 0.03 && p.engines[0].gear !== 0;
  pbtn(cx0 - 18, pivY - 16, 'N P', '#2ee66b', nP); pbtn(cx0 + 18, pivY - 16, 'N S', '#2ee66b', nS);
  pbtn(cx0 - 18, pivY + 10, 'START', '#4fc3f7', run[0] || run[1]); pbtn(cx0 + 18, pivY + 10, 'SYNC', '#ffb300', sync);
  label(ctx, cx0, pivY + 30, 'D I G I T A L', '#8b8f93', 6, 'center');
  const names = ['PORT', 'STBD'], kF = ['q', 'w'], kR = ['z', 'x'];
  // draw arms/grips: the one further aft first so the forward grip overlaps it in the middle
  const order = [0, 1].sort((a2, b2) => p.engines[a2].lever - p.engines[b2].lever);
  p.engines.forEach((e, i) => {
    const sgn = i === 0 ? -1 : 1, ax = cx0 + sgn * (hw2 + 7);
    // scale outside the arm
    const sx = ax + sgn * 16;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(sx, yOf(1)); ctx.lineTo(sx, yOf(-1)); ctx.stroke();
    if (e.thr > 0) { ctx.strokeStyle = e.lever > 0 ? 'rgba(255,170,40,0.9)' : 'rgba(255,90,90,0.85)'; ctx.beginPath(); ctx.moveTo(sx, yOf(Math.sign(e.lever) * 0.25)); ctx.lineTo(sx, yOf(e.lever)); ctx.stroke(); }
    const tk = (v, len, col, w = 1.5) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(sx - len, yOf(v)); ctx.lineTo(sx + len, yOf(v)); ctx.stroke(); };
    tk(0, 7, '#2ee66b', 2.5); tk(0.12, 4, '#7d8a90'); tk(-0.12, 4, '#7d8a90'); tk(1, 4, '#7d8a90'); tk(-1, 4, '#7d8a90');
    const tl = (v, t, c) => label(ctx, sx + sgn * 12, yOf(v) + 4, t, c, 10, 'center', true);
    tl(1, 'F', e.gear === 1 && run[i] ? '#ffffff' : '#6d7f8c'); tl(0, 'N', e.gear === 0 ? '#2ee66b' : '#6d7f8c'); tl(-1, 'R', e.gear === -1 && run[i] ? '#ff6b6b' : '#6d7f8c');
    // pivot hub on the housing side
    ctx.fillStyle = chrome(ax - 9, ax + 9); ctx.beginPath(); ctx.arc(ax, pivY, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.stroke();
    // keys beside each lever
    const kx = i === 0 ? cx0 - 136 : cx0 + 114;
    keycap(ctx, kx, 64, kF[i].toUpperCase(), keys.has(kF[i]) || (keys.has('shift') && keys.has(kF[1 - i])), 22);
    label(ctx, kx + 11, 93, 'F ▲ push', '#8f9894', 8, 'center');
    keycap(ctx, kx, 128, kR[i].toUpperCase(), keys.has(kR[i]) || (keys.has('shift') && keys.has(kR[1 - i])), 22);
    label(ctx, kx + 11, 157, 'R ▼ pull', '#8f9894', 8, 'center');
    label(ctx, cx0 + sgn * 62, 30, names[i], '#e9ecea', 10, 'center', true);
    label(ctx, cx0 + sgn * 62, 42, e.failed ? 'FAILED' : !e.running ? 'OFF' : `${Math.round(e.rpm / 10) * 10} rpm${e.thr > 0 ? ' · ' + Math.round(e.thr * 100) + '%' : ''}`, e.failed ? '#ff5252' : !e.running ? '#8a99a5' : '#9fb3c2', 9, 'center');
  });
  for (const i of order) {
    const e = p.engines[i], sgn = i === 0 ? -1 : 1, ax = cx0 + sgn * (hw2 + 7), gy = yOf(e.lever);
    const lift = Math.cos(e.lever * LEVER_SWEEP);   // grip is highest at N → biggest shadow offset
    engHit.levers.push({ i, ax, gy, pivY, ARM, x0: Math.min(ax, cx0) - 14, x1: Math.max(ax, cx0) + 14 });
    // arm (foreshortened: runs from the pivot to the grip end)
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(ax - 6 + 4 * lift, Math.min(pivY, gy) + 4 * lift, 12, Math.abs(gy - pivY) + 1);
    ctx.fillStyle = chrome(ax - 7, ax + 7); ctx.beginPath(); ctx.roundRect(ax - 7, Math.min(pivY, gy) - 8, 14, Math.abs(gy - pivY) + 16, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    // grip: from the arm in to the centre line, drop shadow scaled by height above the housing
    const gx0 = Math.min(ax, cx0 + sgn * 2), gx1 = Math.max(ax, cx0 + sgn * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.roundRect(gx0 + 6 * lift, gy - 9 + 7 * lift, gx1 - gx0, 18, 8); ctx.fill();
    const rub = ctx.createLinearGradient(0, gy - 10, 0, gy + 10); rub.addColorStop(0, '#3a3d40'); rub.addColorStop(0.35, '#16181a'); rub.addColorStop(1, '#050606');
    ctx.fillStyle = rub; ctx.beginPath(); ctx.roundRect(gx0, gy - 10, gx1 - gx0, 20, 9); ctx.fill();
    // chrome collar where the two grips meet and where the grip joins the arm
    ctx.fillStyle = '#cfd5d9'; ctx.fillRect(cx0 + sgn * 2 - (sgn > 0 ? 0 : 5), gy - 10, 5, 20);
    ctx.fillStyle = chrome(ax - 9, ax + 9); ctx.beginPath(); ctx.roundRect(ax - 9, gy - 11, 18, 22, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
    if (i === 0) { // trim rocker on the outboard side of the port arm
      ctx.fillStyle = '#7d868d'; ctx.beginPath(); ctx.roundRect(ax - 7, gy - 8, 7, 16, 3); ctx.fill();
      ctx.fillStyle = '#e5e9ec'; ctx.fillRect(ax - 6, gy - 1, 5, 1);
    }
    if (e.gear !== 0 && run[i]) { ctx.fillStyle = e.gear > 0 ? 'rgba(255,170,40,0.9)' : 'rgba(255,90,90,0.9)'; ctx.fillRect(gx0 + 4, gy + 6, gx1 - gx0 - 8, 2); }
  }
  label(ctx, bx0 + 136, 16, 'Shift = both levers', '#6b7370', 8, 'center');

  // ======== TRIM
  const tx = 470;
  label(ctx, tx, 16, 'TRIM', '#a8b2ad', 10, 'left', true);
  const trim = (p.engines[0].tilt + p.engines[1].tilt) / 2;
  ctx.fillStyle = '#0f1a22'; ctx.fillRect(tx + 4, 26, 12, 96);
  ctx.fillStyle = 'rgba(46,230,107,0.25)'; ctx.fillRect(tx + 4, 26 + 96 * (1 - 0.4), 12, 96 * 0.25); // sweet spot 0.15–0.4
  ctx.fillStyle = trim > 0.45 ? '#ff7043' : '#ffd54f'; ctx.fillRect(tx + 2, 26 + 96 * (1 - trim) - 2, 16, 4);
  keycap(ctx, tx + 24, 34, '↑', keys.has('arrowup'));
  keycap(ctx, tx + 24, 96, '↓', keys.has('arrowdown'));
  label(ctx, tx + 34, 70, trim > 0.6 ? 'TILT' : trim > 0.45 ? 'HIGH' : trim < 0.1 ? 'IN' : 'RUN', trim > 0.45 ? '#ff7043' : '#e9ecea', 9, 'center', true);
  label(ctx, tx, 136, 'up = bow up, faster', '#6b7370', 8);
  label(ctx, tx, 147, 'down = chop/turns', '#6b7370', 8);

  // ======== BOW THRUSTER
  const bx = 552, b = p.bt;
  label(ctx, bx, 16, 'BOW THRUSTER', '#a8b2ad', 10, 'left', true);
  const pw = b.power && p.prep.battery;
  keycap(ctx, bx, 24, 'B', keys.has('b'));
  ctx.fillStyle = b.tripped > 0 ? '#ff5252' : pw ? '#2ee66b' : '#26313a'; ctx.shadowColor = '#2ee66b'; ctx.shadowBlur = pw ? 8 : 0;
  ctx.beginPath(); ctx.arc(bx + 34, 33, 5, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  label(ctx, bx + 44, 37, b.tripped > 0 ? `CUTOUT ${Math.ceil(b.tripped)}s` : pw ? 'ON' : 'OFF', '#e9ecea', 10);
  keycap(ctx, bx, 50, ',', keys.has(','));
  keycap(ctx, bx + 52, 50, '.', keys.has('.'));
  label(ctx, bx + 11, 82, '◀ bow', pw && b.cmd < 0 ? '#e8a33d' : '#6b7370', 9, 'center');
  label(ctx, bx + 63, 82, 'bow ▶', pw && b.cmd > 0 ? '#e8a33d' : '#6b7370', 9, 'center');

  // ======== CAMERA
  label(ctx, bx, 104, 'VIEW', '#a8b2ad', 10, 'left', true);
  const views = [['chase', '7', '3rd person'], ['helm', '8', '1st person'], ['top', '9', 'overhead'], ['orbit', '0', 'free orbit']];
  views.forEach(([m, k, nm], i) => {
    const y = 110 + i * 17;
    keycap(ctx, bx, y, k, camMode === m, 18);
    label(ctx, bx + 24, y + 12, nm, camMode === m ? '#ffffff' : '#7f95a3', 9, 'left', camMode === m);
  });
  label(ctx, bx, 186, 'C cycle · drag look · scroll zoom', '#6b7370', 8);
}

// ---------------------------------------------------------------- minimap (heading-up radar style)
let mmBase = null, mmDocks = null;
// only touch the DOM when the content actually changed (avoids layout/style recalc every tick)
const htmlCache = new Map();
function setHTML(id, html) { if (htmlCache.get(id) === html) return; htmlCache.set(id, html); $(id).innerHTML = html; }
const CATCOL = { ship: '#ff3b30', ferry: '#ff9500', tow: '#ff3b30', sail: '#ffffff', power: '#ffd60a', small: '#5ac8fa' };
export function drawMinimap(p, vessels, range = 1500) {
  const cv = $('minimap'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  const s = (W / 2) / range;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a2033'; ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); ctx.fill(); ctx.clip();
  ctx.translate(W / 2, H / 2); ctx.rotate(-p.h);
  // land/shoal layer: prerendered once to an offscreen canvas (1 px = one 25 m cell)
  if (!mmBase) {
    mmBase = document.createElement('canvas'); mmBase.width = GX; mmBase.height = GZ;
    const c2 = mmBase.getContext('2d'), img = c2.createImageData(GX, GZ);
    for (let k = 0; k < GX * GZ; k++) {
      const o = k * 4;
      if (sdf[k] > 0) { img.data[o] = 91; img.data[o + 1] = 107; img.data[o + 2] = 74; img.data[o + 3] = 255; }
      else if (depthGrid[k] < 2.2) { img.data[o] = 45; img.data[o + 1] = 79; img.data[o + 2] = 94; img.data[o + 3] = 255; }
    }
    c2.putImageData(img, 0, 0);
    mmDocks = STRUCTS.filter(st => st.kind !== 'boat' && st.kind !== 'buoy');
  }
  ctx.save(); ctx.scale(s, s);
  ctx.drawImage(mmBase, BOUNDS.minX - CELL / 2 - p.x, BOUNDS.minZ - CELL / 2 - p.z, GX * CELL, GZ * CELL);
  ctx.restore();
  // docks
  ctx.fillStyle = '#c8b99a';
  for (const st of mmDocks) {
    const dx = st.cx - p.x, dz = st.cz - p.z;
    if (Math.abs(dx) > range * 1.2 || Math.abs(dz) > range * 1.2) continue;
    ctx.save(); ctx.translate(dx * s, dz * s); ctx.rotate(st.rot);
    ctx.fillRect(-st.hw * s, -st.hl * s, Math.max(1, st.hw * 2 * s), Math.max(1, st.hl * 2 * s)); ctx.restore();
  }
  // planned route
  if (hud.routePath) {
    ctx.strokeStyle = 'rgba(255,213,79,0.85)'; ctx.lineWidth = 2; ctx.beginPath();
    hud.routePath.forEach((q, i) => { const X = (q.x - p.x) * s, Y = (q.z - p.z) * s; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.stroke();
  }
  // range rings
  ctx.strokeStyle = 'rgba(120,200,255,0.18)'; ctx.lineWidth = 1;
  for (const rr of [range / 3, range * 2 / 3]) { ctx.beginPath(); ctx.arc(0, 0, rr * s, 0, Math.PI * 2); ctx.stroke(); }
  // vessels
  for (const v of vessels) {
    if (!v.active || (v.mesh && !v.mesh.visible)) continue;
    const dx = v.x - p.x, dz = v.z - p.z;
    if (dx * dx + dz * dz > range * range * 1.1) continue;
    ctx.save(); ctx.translate(dx * s, dz * s); ctx.rotate(v.h);
    ctx.fillStyle = v.highlight ? '#ff00ff' : CATCOL[v.cat] || '#ccc';
    const L = Math.max(4, v.len * s), B = Math.max(2.5, v.beam * s);
    ctx.beginPath(); ctx.moveTo(0, -L / 2); ctx.lineTo(B / 2, L / 2); ctx.lineTo(-B / 2, L / 2); ctx.closePath(); ctx.fill();
    if (v.speed > 1) { ctx.strokeStyle = ctx.fillStyle; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(0, -L / 2); ctx.lineTo(0, -L / 2 - v.speed * 60 * s); ctx.stroke(); ctx.globalAlpha = 1; }
    ctx.restore();
  }
  ctx.restore();
  // own ship
  ctx.fillStyle = '#00e676'; ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 9); ctx.lineTo(W / 2 + 5, H / 2 + 7); ctx.lineTo(W / 2 - 5, H / 2 + 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,230,118,0.6)'; ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 9); ctx.lineTo(W / 2, H / 2 - 9 - p.speed * 60 * s); ctx.stroke();
  // north arrow
  ctx.save(); ctx.translate(W - 18, 18); ctx.rotate(-p.h); ctx.fillStyle = '#ff5252'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px "Barlow Condensed", system-ui'; ctx.textAlign = 'center'; ctx.fillText('N', 0, 14); ctx.restore();
  ctx.fillStyle = '#9ab'; ctx.font = '10px "Barlow Condensed", system-ui'; ctx.textAlign = 'left'; ctx.fillText(fmtRange(range), 6, H - 6);
}

// ---------------------------------------------------------------- AIS-style target list
export function drawTargets(list) {
  setHTML('targets', list.slice(0, 6).map(t => `
    <div class="tgt ${t.risk ? 'risk' : ''}">
      <span class="dot" style="background:${CATCOL[t.v.cat] || '#ccc'}"></span>
      <span class="nm">${t.v.name || t.label}</span>
      <span>${fmtRange(t.c.range)} · ${deg3(t.brg)}</span>
      <span class="dim">${t.c.tcpa > 0 && t.c.tcpa < 900 ? `CPA ${fmtRange(t.c.dcpa)} in ${Math.round(t.c.tcpa)}s` : 'opening'}</span>
    </div>`).join(''));
}

// ---------------------------------------------------------------- rules advisor
export function drawAdvisor(adv) {
  const el = $('advisor');
  if (!adv) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
  if (el.style.display !== 'block') el.style.display = 'block';
  const roleCls = adv.cls.role === 'give-way' || adv.cls.role === 'keep-clear' ? 'give' : adv.cls.role === 'both' ? 'both' : 'stand';
  const roleTxt = { 'give-way': 'YOU ARE GIVE-WAY', 'keep-clear': 'KEEP CLEAR', 'stand-on': 'YOU ARE STAND-ON', both: 'BOTH ALTER TO STARBOARD' }[adv.cls.role] || '';
  setHTML('advisor', `
    <div class="role ${roleCls}">${roleTxt}</div>
    <div class="what">${adv.label} · ${adv.cls.beta > 0 ? 'starboard' : 'port'} side, rel. bearing ${Math.round(Math.abs(adv.cls.beta))}° ${adv.cls.beta > 0 ? 'R' : 'L'}</div>
    <div class="cpa">CPA <b>${fmtRange(adv.cls.dcpa)}</b> in <b>${Math.round(adv.cls.tcpa)} s</b> · range ${fmtRange(adv.cls.range)}
      ${adv.steady ? '<span class="alarm"> · BEARING STEADY = COLLISION COURSE</span>' : ''}</div>
    <div class="rule">${adv.cls.rule}</div>
    <div class="adv">${adv.cls.advice}</div>
    ${adv.cls.signal ? `<div class="sig">${adv.cls.signal}</div>` : ''}`);
}

// ---------------------------------------------------------------- radio log
export function drawRadio() {
  const el = $('radio');
  el.innerHTML = radio.log.slice(-5).map(m => {
    const hh = Math.floor(m.t), mm = Math.floor((m.t - hh) * 60);
    return `<div><span class="ch">CH ${m.ch}</span> <span class="dim">${hh}:${String(mm).padStart(2, '0')}</span> <b>${m.from}:</b> ${m.text}</div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// ============================================================================ CHART
let base = null, view = { s: 0.05, ox: 0, oz: 0 }, drag = null, chartCtx = null;
const chartState = { player: null, vessels: [], dest: null, onSite: null, hover: null, tick: 0, onCanvasClick: null };

function buildBase() {
  const w = Math.floor(GX / 2), h = Math.floor(GZ / 2);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (j * 2) * GX + i * 2, o = (j * w + i) * 4;
    let c;
    if (sdf[k] > 0) c = [246, 231, 184];
    else {
      const d = depthGrid[k];
      c = d < 1.5 ? [150, 200, 160] : d < 3.6 ? [160, 210, 235] : d < 6 ? [190, 225, 243] : d < 18 ? [221, 239, 248] : [252, 253, 255];
    }
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // depth contour outlines (coastline)
  base = cv;
}

export function initChart(opts) {
  Object.assign(chartState, opts);
  const cv = $('chartcv');
  chartCtx = cv.getContext('2d');
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const wx = view.ox + mx / view.s, wz = view.oz + my / view.s;
    view.s *= e.deltaY < 0 ? 1.18 : 1 / 1.18;
    view.s = Math.max(0.02, Math.min(4, view.s));
    view.ox = wx - mx / view.s; view.oz = wz - my / view.s;
  }, { passive: false });
  cv.addEventListener('mousedown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: view.ox, oz: view.oz, moved: false }; });
  window.addEventListener('mousemove', (e) => {
    if (!hud.chartOpen) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    chartState.hover = { x: view.ox + mx / view.s, z: view.oz + my / view.s, mx, my };
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      view.ox = drag.ox - dx / view.s; view.oz = drag.oz - dy / view.s;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (!hud.chartOpen || !drag) return;
    const wasDrag = drag.moved; drag = null;
    if (wasDrag) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    // click on a site label?
    let best = null, bd = 30;
    for (const s of SITES) {
      const sx = (s.x - view.ox) * view.s, sy = (s.z - view.oz) * view.s;
      const d = Math.hypot(sx - mx, sy - my);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) chartState.onSite?.(best);
    else chartState.onCanvasClick?.({ x: view.ox + mx / view.s, z: view.oz + my / view.s });
  });
  document.querySelectorAll('#chart-layers input').forEach(inp => {
    inp.checked = hud.layers[inp.dataset.layer];
    inp.addEventListener('change', () => { hud.layers[inp.dataset.layer] = inp.checked; });
  });
}

export function openChart(player) {
  if (!base) buildBase();
  hud.chartOpen = true;
  $('chart').style.display = 'flex';
  const cv = $('chartcv');
  cv.width = cv.clientWidth; cv.height = cv.clientHeight;
  view.s = Math.min(cv.width / 9000, cv.height / 9000);
  view.ox = player.x - cv.width / 2 / view.s; view.oz = player.z - cv.height / 2 / view.s;
}
export function closeChart() { hud.chartOpen = false; $('chart').style.display = 'none'; }

const ROUTE_LINES = [
  ['Ferry: SF ↔ Sausalito', [[37.7950, -122.3910], [37.8010, -122.3920], [37.8120, -122.4060], [37.8205, -122.4300], [37.8350, -122.4580], [37.8480, -122.4690], [37.8562, -122.4762]]],
  ['Ferry: SF ↔ Larkspur (east of Angel Is.)', [[37.7950, -122.3910], [37.8050, -122.3880], [37.8250, -122.4050], [37.8450, -122.4090], [37.8700, -122.4090], [37.9000, -122.4220], [37.9170, -122.4290]]],
  ['Ferry: SF ↔ Tiburon / Angel Is.', [[37.8010, -122.3920], [37.8150, -122.4100], [37.8350, -122.4350], [37.8530, -122.4525], [37.8640, -122.4552], [37.8722, -122.4550]]],
  ['Ferry: Pier 33 ↔ Alcatraz', [[37.8085, -122.4020], [37.8150, -122.4130], [37.8260, -122.4190]]],
  ['Ferry: SF ↔ Oakland/Alameda', [[37.7950, -122.3910], [37.7965, -122.3850], [37.7976, -122.3790], [37.7935, -122.3650], [37.7925, -122.3525]]],
  ['Ferry: SF ↔ Vallejo/Richmond', [[37.7950, -122.3910], [37.8050, -122.3850], [37.8300, -122.3850], [37.8700, -122.3800], [37.9170, -122.3780]]],
  ['Tour boats: Pier 39/41/43½ → Golden Gate → Alcatraz loop', [[37.8150, -122.4200], [37.8135, -122.4550], [37.8160, -122.4795], [37.8185, -122.4870], [37.8250, -122.4800], [37.8310, -122.4650], [37.8335, -122.4320], [37.8290, -122.4160], [37.8160, -122.4140]]],
];
const ZONES_INFO = [
  ['Race courses (Saturday)', 37.8105, -122.4470, 700, 'rgba(255,0,200,0.10)'],
  ['Race course / the Slot', 37.8270, -122.3950, 800, 'rgba(255,0,200,0.10)'],
  ['Kiteboarders (afternoons, 15+ kn)', 37.8115, -122.4615, 650, 'rgba(0,200,255,0.12)'],
  ['Swimmers!', 37.8083, -122.4248, 200, 'rgba(255,120,0,0.20)'],
  ['Fishing boats', 37.8275, -122.4300, 250, 'rgba(0,160,0,0.12)'],
  ['Fishing boats', 37.8375, -122.4460, 250, 'rgba(0,160,0,0.12)'],
  ['Fishing boats', 37.8520, -122.4150, 250, 'rgba(0,160,0,0.12)'],
  ['Anchorage 7 (ships at anchor)', 37.7790, -122.3730, 700, 'rgba(160,0,200,0.10)'],
];

export function drawChart(player, vessels, dest) {
  if (!hud.chartOpen) return;
  const cv = $('chartcv'), ctx = chartCtx, L = hud.layers;
  if (cv.width !== cv.clientWidth) { cv.width = cv.clientWidth; cv.height = cv.clientHeight; }
  const W = cv.width, H = cv.height, s = view.s;
  const X = (x) => (x - view.ox) * s, Y = (z) => (z - view.oz) * s;
  ctx.fillStyle = '#f6e7b8'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ddeff8';
  for (const poly of OUTER_WATER_XZ) { ctx.beginPath(); poly.forEach(([x, z], i) => i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))); ctx.closePath(); ctx.fill(); }
  ctx.imageSmoothingEnabled = s < 0.12;
  if (L.depth) ctx.drawImage(base, X(BOUNDS.minX), Y(BOUNDS.minZ), (BOUNDS.maxX - BOUNDS.minX) * s, (BOUNDS.maxZ - BOUNDS.minZ) * s);
  // coastline (clipped to the surveyed area)
  ctx.save(); ctx.beginPath(); ctx.rect(X(BOUNDS.minX) + 2, Y(BOUNDS.minZ) + 2, (BOUNDS.maxX - BOUNDS.minX) * s - 4, (BOUNDS.maxZ - BOUNDS.minZ) * s - 4); ctx.clip();
  ctx.strokeStyle = '#5a4a2a'; ctx.lineWidth = 1.2;
  if (!DEM.main) for (const Lm of LANDMASSES) { ctx.beginPath(); Lm.xz.forEach(([x, z], i) => i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))); ctx.closePath(); ctx.stroke(); }
  ctx.restore();
  if (L.nowake) for (const zn of NO_WAKE_ZONES) {
    ctx.fillStyle = 'rgba(255,140,0,0.13)'; ctx.strokeStyle = 'rgba(230,100,0,0.7)'; ctx.setLineDash([5, 4]);
    ctx.beginPath(); zn.xz.forEach(([x, z], i) => i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  }
  if (L.zones) for (const [name, la, lo, r, col] of ZONES_INFO) {
    const p = ll(la, lo);
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(p.x), Y(p.z), r * s, 0, Math.PI * 2); ctx.fill();
    if (s > 0.06) { ctx.fillStyle = '#6a2a6a'; ctx.font = 'italic 11px "Barlow Condensed", system-ui'; ctx.textAlign = 'center'; ctx.fillText(name, X(p.x), Y(p.z) - r * s - 3); }
  }
  if (L.lanes) {
    for (const ln of SHIP_LANES) {
      ctx.strokeStyle = 'rgba(200,0,120,0.55)'; ctx.lineWidth = Math.max(2, ln.width * s); ctx.globalAlpha = 0.25;
      ctx.beginPath(); ln.xz.forEach(([x, z], i) => i ? ctx.lineTo(X(x), Y(z)) : ctx.moveTo(X(x), Y(z))); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.5; ctx.setLineDash([10, 6]); ctx.stroke(); ctx.setLineDash([]);
      const m = ln.xz[Math.floor(ln.xz.length / 2)];
      ctx.fillStyle = '#a0006a'; ctx.font = 'bold 11px "Barlow Condensed", system-ui'; ctx.textAlign = 'left'; if (s > 0.04) ctx.fillText('SHIP LANE: ' + ln.name, X(m[0]) + 8, Y(m[1]) - 8);
    }
    ctx.lineWidth = 1.3;
    for (const [name, pts] of ROUTE_LINES) {
      ctx.strokeStyle = 'rgba(230,110,0,0.85)'; ctx.setLineDash([3, 4]);
      ctx.beginPath(); pts.forEach(([a, b], i) => { const p = ll(a, b); i ? ctx.lineTo(X(p.x), Y(p.z)) : ctx.moveTo(X(p.x), Y(p.z)); }); ctx.stroke(); ctx.setLineDash([]);
      if (s > 0.09) { const m = ll(...pts[Math.floor(pts.length / 2)]); ctx.fillStyle = '#b05000'; ctx.font = '10px "Barlow Condensed", system-ui'; ctx.fillText(name, X(m.x) + 6, Y(m.z) + 12); }
    }
  }
  // bridges
  ctx.strokeStyle = '#444'; ctx.lineWidth = Math.max(2, 27 * s);
  for (const [a, b] of [[[37.8075, -122.4760], [37.8290, -122.4805]], [[37.7885, -122.3890], [37.8100, -122.3660]], [[37.8128, -122.3598], [37.8245, -122.3115]]]) {
    const A = ll(...a), B = ll(...b); ctx.beginPath(); ctx.moveTo(X(A.x), Y(A.z)); ctx.lineTo(X(B.x), Y(B.z)); ctx.stroke();
  }
  if (s > 0.03) { ctx.fillStyle = '#333'; ctx.font = 'bold 11px "Barlow Condensed", system-ui'; const g = ll(37.8170, -122.4770), bb = ll(37.7990, -122.3770); ctx.fillText('Golden Gate Bridge', X(g.x) + 12, Y(g.z)); ctx.fillText('Bay Bridge (west span)', X(bb.x) + 14, Y(bb.z) + 14); }
  // docks
  ctx.fillStyle = '#6d5a3a';
  for (const st of STRUCTS) {
    if (st.kind === 'buoy') continue;
    const x = X(st.cx), y = Y(st.cz);
    if (x < -50 || y < -50 || x > W + 50 || y > H + 50) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(st.rot);
    ctx.fillStyle = st.kind === 'boat' ? '#8aa0b0' : st.kind === 'break' ? '#6b6b6b' : st.kind === 'float' ? '#7a5c34' : '#5a4a3a';
    ctx.fillRect(-st.hw * s, -st.hl * s, Math.max(1, st.hw * 2 * s), Math.max(1, st.hl * 2 * s)); ctx.restore();
  }
  // free guest spots
  if (s > 0.15) for (const g of GUEST_SPOTS) {
    if (!g.free) continue;
    ctx.save(); ctx.translate(X(g.x), Y(g.z)); ctx.rotate(g.heading * D2R);
    ctx.fillStyle = 'rgba(0,200,90,0.65)'; ctx.fillRect(-1.7 * s, -g.len / 2 * s, 3.4 * s, g.len * s); ctx.restore();
  }
  // hazards & aids
  if (L.hazards) {
    for (const hz of HAZARDS) {
      const p = ll(hz.lat, hz.lon), x = X(p.x), y = Y(p.z);
      ctx.strokeStyle = '#d00'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5); ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5); ctx.stroke();
      if (s > 0.05) { ctx.fillStyle = '#b00'; ctx.font = 'bold 10px "Barlow Condensed", system-ui'; ctx.textAlign = 'left'; ctx.fillText(hz.name, x + 7, y + 3); }
    }
    for (const a of NAV_AIDS) {
      ctx.fillStyle = { red: '#d32f2f', green: '#2e7d32', yellow: '#f9a825', rw: '#d32f2f' }[a.kind] || '#555';
      ctx.beginPath(); ctx.arc(X(a.x), Y(a.z), 3.5, 0, Math.PI * 2); ctx.fill();
      if (s > 0.25) { ctx.font = '9px "Barlow Condensed", system-ui'; ctx.fillText(a.name, X(a.x) + 5, Y(a.z) - 4); }
    }
  }
  // currents
  if (L.current) {
    const step = Math.max(120, 28 / s);
    const c = { x: 0, z: 0 };
    for (let z = Math.ceil(view.oz / step) * step; z < view.oz + H / s; z += step) for (let x = Math.ceil(view.ox / step) * step; x < view.ox + W / s; x += step) {
      if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) continue;
      currentAt(x, z, c);
      const sp = Math.hypot(c.x, c.z) / KN;
      if (sp < 0.12) continue;
      const a = Math.atan2(c.x, -c.z), len = Math.min(26, 6 + sp * 7);
      const px = X(x), py = Y(z);
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      ctx.strokeStyle = ctx.fillStyle = `hsl(${Math.max(0, 200 - sp * 45)},85%,${sp > 2 ? 40 : 45}%)`;
      ctx.lineWidth = sp > 2 ? 2.2 : 1.4;
      ctx.beginPath(); ctx.moveTo(0, len / 2); ctx.lineTo(0, -len / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -len / 2 - 3); ctx.lineTo(3.5, -len / 2 + 3); ctx.lineTo(-3.5, -len / 2 + 3); ctx.fill();
      ctx.restore();
    }
  }
  if (L.wind) {
    const step = Math.max(500, 70 / s);
    const w = {};
    for (let z = Math.ceil(view.oz / step) * step; z < view.oz + H / s; z += step) for (let x = Math.ceil(view.ox / step) * step; x < view.ox + W / s; x += step) {
      windAt(x, z, w);
      const kn = w.speed / KN, a = Math.atan2(w.x, -w.z);
      ctx.save(); ctx.translate(X(x), Y(z)); ctx.rotate(a);
      ctx.strokeStyle = '#334'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(0, -14); ctx.lineTo(4, -8); ctx.moveTo(0, -14); ctx.lineTo(-4, -8); ctx.stroke();
      ctx.rotate(-a); ctx.fillStyle = '#223'; ctx.font = 'bold 10px "Barlow Condensed", system-ui'; ctx.textAlign = 'center'; ctx.fillText(Math.round(kn), 0, 26);
      ctx.restore();
    }
  }
  // site labels
  if (L.labels) for (const st of SITES) {
    const x = X(st.x), y = Y(st.z);
    const col = st.kind === 'restricted' ? '#b71c1c' : st.kind === 'home' ? '#1565c0' : st.kind === 'restaurant' ? '#6a1b9a' : '#1b5e20';
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = 'bold 12px "Barlow Condensed", system-ui'; ctx.textAlign = 'left';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeText(st.name, x + 9, y + 4);
    ctx.fillStyle = col; ctx.fillText(st.name, x + 9, y + 4);
  }
  // vessels
  if (L.traffic) for (const v of vessels) {
    if (!v.active || (v.mesh && !v.mesh.visible)) continue;
    const x = X(v.x), y = Y(v.z);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(v.h);
    const Lp = Math.max(6, v.len * s), Bp = Math.max(4, v.beam * s);
    ctx.fillStyle = CATCOL[v.cat] === '#ffffff' ? '#fff' : CATCOL[v.cat] || '#999';
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -Lp / 2); ctx.lineTo(Bp / 2, Lp / 2); ctx.lineTo(-Bp / 2, Lp / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (v.speed > 1) { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.moveTo(0, -Lp / 2); ctx.lineTo(0, -Lp / 2 - v.speed * 60 * s); ctx.stroke(); }
    ctx.restore();
    if (s > 0.2 && v.name) { ctx.fillStyle = '#333'; ctx.font = '9px "Barlow Condensed", system-ui'; ctx.fillText(v.name, x + 6, y - 6); }
  }
  if (hud.routePath) {
    ctx.strokeStyle = 'rgba(230,160,0,0.9)'; ctx.lineWidth = 3; ctx.beginPath();
    hud.routePath.forEach((q, i) => i ? ctx.lineTo(X(q.x), Y(q.z)) : ctx.moveTo(X(q.x), Y(q.z))); ctx.stroke();
  }
  // destination
  if (dest) { ctx.strokeStyle = '#e6a800'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(X(player.x), Y(player.z)); ctx.lineTo(X(dest.x), Y(dest.z)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#e6a800'; ctx.beginPath(); ctx.arc(X(dest.x), Y(dest.z), 7, 0, Math.PI * 2); ctx.fill(); }
  // player
  ctx.save(); ctx.translate(X(player.x), Y(player.z)); ctx.rotate(player.h);
  ctx.fillStyle = '#00c853'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  // scale bar
  const nm = 1852 * s;
  ctx.fillStyle = '#222'; ctx.fillRect(20, H - 30, nm, 4); ctx.font = '11px "Barlow Condensed", system-ui'; ctx.textAlign = 'left'; ctx.fillText('1 nautical mile', 20, H - 36);
  // hover readout
  const hv = chartState.hover;
  if (hv) {
    const c = currentAt(hv.x, hv.z), d = depthGrid[Math.round((hv.z - BOUNDS.minZ) / CELL) * GX + Math.round((hv.x - BOUNDS.minX) / CELL)];
    const { lat, lon } = toLL(hv.x, hv.z);
    $('chart-readout').innerHTML = `${lat.toFixed(4)}°N ${(-lon).toFixed(4)}°W · depth ${d > 0 ? ft(d) + ' ft (MLLW)' : 'land'} · current ${(Math.hypot(c.x, c.z) / KN).toFixed(1)} kn · ${fmtRange(Math.hypot(hv.x - player.x, hv.z - player.z))} from you`;
  }
}

// ---------------------------------------------------------------- dock card
export function showDockCard(site, actions) {
  const el = $('dockcard');
  const free = GUEST_SPOTS.filter(g => g.site === site.id && g.free).length;
  const total = GUEST_SPOTS.filter(g => g.site === site.id).length;
  const busy = '●'.repeat(site.busy || 0) + '○'.repeat(5 - (site.busy || 0));
  el.innerHTML = `
    <div class="dc-head"><div><div class="dc-kind ${site.kind}">${{ home: 'HOME BERTH', guest: 'GUEST DOCK', restaurant: 'DOCK & DINE', marina: 'MARINA', public: 'PUBLIC DOCK', restricted: 'RESTRICTED / NO LANDING', anchorage: 'ANCHORAGE' }[site.kind] || ''}</div>
      <h2>${site.name}</h2></div><button class="x" id="dc-close">✕</button></div>
    <div class="dc-sum">${site.summary}</div>
    <div class="dc-busy">October Saturday busyness: <span>${busy}</span> ${total ? `· open guest spots right now: <b>${free}</b> of ${total}` : ''}</div>
    ${site.info.map(p => `<p>${p}</p>`).join('')}
    <p class="dim">Layouts are schematic. Confirm rules, fees and availability with the facility and current charts (NOAA 18649 / 18653).</p>
    <div class="dc-btns">
      <button id="dc-dest">Set as destination</button>
      ${PRACTICE_STARTS[site.id] ? '<button id="dc-go" class="primary">Practice docking here</button>' : ''}
    </div>`;
  el.style.display = 'block';
  $('dc-close').onclick = () => { el.style.display = 'none'; };
  $('dc-dest').onclick = () => { actions.dest(site); el.style.display = 'none'; };
  if ($('dc-go')) $('dc-go').onclick = () => { actions.go(site); el.style.display = 'none'; };
}
