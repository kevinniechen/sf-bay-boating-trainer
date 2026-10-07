// SF Bay Boating Trainer — main loop, input, camera, menus, free-ride coaching.
import * as THREE from 'three';
import { buildGeo, loadDEM, ll, toLL, noWakeZoneAt, shipLaneAt, depthAt, HAZARDS, sdfAt } from './geo.js';
import { startFleetWeek, stopFleetWeek, updateFleetWeek } from './fleetweek.js';
import { env, buildCurrents, buildWind, updateChop, advanceEnv, advanceClock, setTidePreset, currentAt, windAt, KN, chopAt, tideCurrentFactor, baseWindKn } from './env.js';
import { buildDocks, indexStructs, SITES, PRACTICE_STARTS, PLAYER_SLIP, nearestSite, GUEST_SPOTS, NAV_AIDS } from './docks.js';
import { Post } from './post.js';
import { initWorld, preloadBuildings, hazeifyScene, W, updateWorld, updateChopTexture, updateParticles, updateCurrentArrows, crests, crestPos, setQuality, setDpr, QUALITY } from './world.js';
import { buildNav } from './nav.js';
import { PlayerBoat, resistance, THRUST } from './boat.js';
import { traffic, spawnTraffic, updateTraffic, initLights, updateLights, vesselInfo, clearTraffic } from './traffic.js';
import { classify, isRisk, cpa, trueBearing, angDiff, relBearing } from './rules.js';
import { SCENARIOS, Runner } from './scenarios.js';
import { ROUTES, Tour } from './tour.js';
import { hud, toast, updateInstruments, drawCompass, drawEngines, drawMinimap, drawTargets, drawAdvisor, drawRadio, initChart, openChart, closeChart, drawChart, showDockCard, fmtRange, ft, engHit, LEVER_SWEEP } from './hud.js';
import { initAudio, updateAudio, hornStart, hornStop, horn, thud, beep, setMuted, crunch, squeak, updateContactAudio, updateAmbient, shiftClunk, crank } from './audio.js';
import { radio, say, radioShip, updateRadio, weather } from './radio.js';

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
const G = {};
let player, runner;
let mode = 'menu'; // menu | free | scenario | tour
let tour = null, tourCamAuto = true, routeStops = null;
let paused = true, timeScale = 1;
let camSnap = true, camMode = 'chase', camYaw = 0, camPitch = 0.12, camDist = 24, topAlt = 45, northUp = false, binoc = false;
let showFinder = false, showCurrents = false, showAdvisor = true;
let dest = null;
const keys = new Set();
let hornDown = null;
const stats = { dist: 0, violations: [], startClock: 0 };

// ============================================================================ boot
async function boot() {
  const step = async (msg) => { $('loadmsg').textContent = msg; await new Promise(r => setTimeout(r, 15)); };
  await step('Loading USGS elevation & NOAA bathymetry…');
  await loadDEM();
  await step('Surveying the real shoreline & depths…');
  buildGeo();
  await step('Building piers, marinas & guest docks…');
  buildDocks();
  await step('Computing tidal currents & wind field…');
  buildCurrents(); buildWind(); updateChop();
  await step('Rendering the bay, the city and the bridges…');
  try { W.qualityName = localStorage.getItem('sfbay_quality') || 'balanced'; } catch (e) { W.qualityName = 'balanced'; }
  await preloadBuildings();
  initWorld($('c'));
  indexStructs();
  updateChopTexture();
  await step('Charting AI routes…');
  buildNav([
    [37.8655, -122.4540], [37.8700, -122.4470], [37.8740, -122.4420], [37.8690, -122.4545], [37.8665, -122.4560],
    [37.8530, -122.4720], [37.8565, -122.4740], [37.8600, -122.4775], [37.8630, -122.4830], [37.8660, -122.4890], [37.8690, -122.4930],
    [37.8150, -122.3730], [37.8155, -122.3800], [37.8090, -122.4100], [37.8110, -122.4300], [37.8100, -122.4450],
    [37.7838, -122.3830], [37.7900, -122.3850], [37.8340, -122.4730], [37.8752, -122.4385], [37.8720, -122.4395],
  ]);
  await step('Launching the boat…');
  player = new PlayerBoat(W.scene);
  player.m.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  hazeifyScene(player.m.root);
  W.post = new Post(W.renderer);
  player._ai = traffic.vessels;
  G.player = player;
  initLights();
  runner = new Runner(G);
  traffic.hooks.radio = (k, v, fresh) => radioShip(k, v, fresh);
  traffic.hooks.horn = (v, pattern) => hornFrom(v, pattern);
  traffic.hooks.left = () => { };
  radio.listeners.push(() => drawRadio());
  initChart({ onSite: (s) => showDockCard(s, { dest: (st) => setDest(st), go: (st) => practiceAt(st.id) }), onCanvasClick: (p) => { if (mode === 'free') setDest(p); } });
  const s0 = PLAYER_SLIP.spot;
  player.reset(s0.x, s0.z, s0.heading);
  buildMenus();
  $('loading').style.display = 'none';
  if (new URLSearchParams(location.search).has('mute')) { audio_muted = true; setMuted(true); }   // ?mute: silent (testing)
  startLobby();
  requestAnimationFrame(frame);
}

// ============================================================================ G (scenario API)
Object.assign(G, {
  placePlayer(lat, lon, hdg, kn) {
    const p = ll(lat, lon);
    player.reset(p.x, p.z, hdg);
    const f = player.fwd;
    player.vx = f.x * kn * KN; player.vz = f.z * kn * KN;
    if (kn > 0.5) {
      player.setThrottleLevers(throttleFor(kn));
      for (const e of player.engines) e.thrust = THRUST.T_IDLE_F + (THRUST.T_MAX_F - THRUST.T_IDLE_F) * Math.pow(e.thr, 1.6);
      // calibrate the levers so the boat actually holds this speed here (wind, chop, current)
      const want = kn * KN;
      player.noWake = true;   // calibration runs in place: don't pile foam on one spot
      for (let it = 0; it < 120; it++) {
        player.x = p.x; player.z = p.z; player.h = hdg * D2R; player.r = 0;
        const sp = player.surge;
        player.setThrottleLevers(Math.max(0.01, Math.min(1, player.engines[0].thr + (want - sp) * 0.02)));
        player.update(1 / 20);
      }
      player.x = p.x; player.z = p.z; player.h = hdg * D2R; player.r = 0; player.wheel = 0; player.steer = 0;
      const f2 = player.fwd; player.vx = f2.x * want; player.vz = f2.z * want;
      player.events.length = 0; player.damage = 0; player.maxImpact = 0; player.noWake = false;
    }
    camYaw = 0; camSnap = true;
  },
  applyEnv(e = {}) {
    env.clock = e.clock ?? 13;
    setTidePreset(e.tide || 'real');
    if (typeof e.wind === 'number') { env.windMode = 'fixed'; env.windFixedKn = e.wind; } else env.windMode = 'auto';
    env.fog = e.fog || 0; env.visibility = e.fog ? 400 : 20000;
    updateChop(); updateChopTexture();
    stopFleetWeek();
    if (e.daySpeed != null) env.daySpeed = e.daySpeed;
    spawnTraffic(e.traffic === 'fleetweek' ? 'typical' : e.traffic || 'typical');
    if (e.traffic === 'fleetweek') startFleetWeek();
    radio.log.length = 0;
    weather();
  },
  setPaused(p) { paused = p; },
  showQuiz, showDebrief,
  setZone(z) {
    if (!z) { W.zone.visible = false; return; }
    W.zone.visible = true; W.zone.position.set(z.x, 0.3, z.z); W.zone.rotation.y = -(z.h || 0) * D2R; W.zone.scale.set(z.w || 5, 1, z.len || 12);
  },
  setDest: (p) => setDest(p),
  hornFrom: (v, pat) => hornFrom(v, pat),
  hornDeep: (d) => horn('prolonged', d, true),
  say, toast, beep,
  camPos: () => W.camera.position,
  inNoWake: () => !!noWakeZoneAt(player.x, player.z),
});

function throttleFor(kn) {
  // invert steady state: 2 * T(thr) = R(kn)
  const T = resistance(kn) / 2;
  if (T <= THRUST.T_IDLE_F) return 0;
  return Math.min(1, Math.pow((T - THRUST.T_IDLE_F) / (THRUST.T_MAX_F - THRUST.T_IDLE_F), 1 / 1.6));
}

function hornFrom(v, pattern) {
  const d = Math.hypot(v.x - player.x, v.z - player.z);
  horn(pattern, d, v.cat === 'ship' || v.type === 'tug');
  if (d < 1500 && (mode === 'free' || mode === 'scenario')) {
    const what = { danger: '5 SHORT BLASTS (danger/doubt!)', prolonged: '1 prolonged blast (leaving dock / fog)', back: '3 short blasts (backing)' }[pattern] || pattern;
    toast(`${v.name || 'A vessel'} sounds ${what}${pattern === 'danger' && d < 900 ? ' — probably at YOU' : ''}`, pattern === 'danger' ? 'alarm' : 'info', 4500);
  }
}

// ============================================================================ featured runs & lobby
// Hand-picked moments on the bay: each sets the place, the light, the weather and the traffic.
const FEATURED = [
  { id: 'golden', title: 'Sausalito Golden Hour', sub: 'Sun dropping behind the Headlands, glitter on the water', tag: '18:20 · light air', clock: 18.33, wind: 8, place: [37.8562, -122.4712, 200, 7] },
  { id: 'sunrise', title: 'Sunrise Under the Bay Bridge', sub: 'First light over the East Bay hills, glassy water', tag: '07:05 · calm', clock: 7.08, wind: 3, tide: 'slackflood', place: [37.7915, -122.3800, 60, 6] },
  { id: 'bluebird', title: 'Bluebird Day off Tiburon', sub: "Raccoon Strait to Sam's under deep blue skies", tag: '12:30 · breeze', clock: 12.5, wind: 12, place: [37.8640, -122.4520, 330, 9], dest: 'sams' },
  { id: 'fleetweek', title: 'Fleet Week — Blue Angels', sub: 'Airshow over the Marina Green, Navy ships, hundreds of spectator boats', tag: '15:00 · show box hot', clock: 15.0, wind: 10, traffic: 'fleetweek', place: [37.8237, -122.4505, 172, 1.5] },
  { id: 'karl', title: 'Karl the Fog at the Gate', sub: 'Foghorns, 300 m visibility, a ship somewhere out there', tag: '09:30 · thick fog', clock: 9.5, wind: 7, fog: 1, place: [37.8140, -122.4620, 285, 6] },
  { id: 'night', title: 'City Lights at Night', sub: 'Bay Lights, Ferry Building clock, the skyline twinkling', tag: '20:30 · clear night', clock: 20.5, wind: 5, place: [37.8075, -122.3835, 218, 6] },
  { id: 'smoker', title: 'Max Ebb Smoker off Alcatraz', sub: '22 kn westerly against a 3 kn ebb — steep chop', tag: '15:30 · small craft adv.', clock: 15.5, wind: 22, tide: 'maxebb', place: [37.8230, -122.4150, 270, 14] },
  { id: 'ayala', title: 'Morning Calm in Ayala Cove', sub: 'Angel Island glassing off, first boats picking up moorings', tag: '08:45 · glassy', clock: 8.75, wind: 3, tide: 'slackflood', place: [37.8712, -122.4372, 160, 4], dest: 'ayala' },
];
function featuredHTML() {
  return FEATURED.map(f => `<button class="feat" data-id="${f.id}"><span class="ft">${f.title}</span><span class="fs">${f.sub}</span><span class="fg">${f.tag}</span></button>`).join('');
}
function applyFeatured(f, asLobby = false) {
  runner.stop(); endTour(); setRouteOverlay(null); routeStops = null; setDest(null);
  G.applyEnv({ clock: f.clock, tide: f.tide || 'real', wind: f.wind, traffic: f.traffic || 'typical', fog: f.fog || 0, daySpeed: +($('f-day')?.value || 6) });
  if (f.fog) { env.fog = 1; env.visibility = 320; }
  prepActive = false; renderPrep();
  readyBoat(); player.fenders = false;
  G.placePlayer(...f.place);
  if (f.dest) setDest(SITES.find(x => x.id === f.dest));
  camMode = 'chase'; camYaw = 0; camPitch = 0.12; camDist = 24; camSnap = true;
  stats.dist = 0; stats.violations = [];
  W.zone.visible = false;
  if (asLobby) { mode = 'menu'; showMenu('main'); } else { mode = 'free'; showMenu(null); }
  document.body.classList.toggle('lobby', asLobby);
  paused = false;
}
// The main menu sits over a live, drivable boat: underway off Sausalito at golden hour, lines off.
function startLobby() { applyFeatured(FEATURED[0], true); }

// ============================================================================ menus
function showMenu(name) {
  for (const id of ['menu-main', 'menu-free', 'menu-scen', 'menu-pause', 'menu-help', 'menu-tour']) $(id).style.display = 'none';
  if (name) { $('menu-' + name).style.display = 'flex'; $('overlay').style.display = 'flex'; }
  else $('overlay').style.display = 'none';
  document.body.classList.toggle('lobby', mode === 'menu');
  if (name === 'scen') renderScenarioList();
  if (name === 'tour') renderTourList();
  if (name === 'pause') renderPause();
}
function buildMenus() {
  $('btn-free').onclick = () => { initAudio(); showMenu('free'); };
  $('btn-scen').onclick = () => { initAudio(); showMenu('scen'); };
  $('btn-guide').onclick = () => { initAudio(); startFree({ start: 'slip', clock: 13, tide: 'real', wind: 'auto', traffic: 'typical' }); openChart(player); paused = true; };
  $('btn-help').onclick = () => showMenu('help');
  $('featured').innerHTML = featuredHTML();
  document.querySelectorAll('#featured .feat').forEach(b => b.onclick = () => { initAudio(); applyFeatured(FEATURED.find(f => f.id === b.dataset.id)); });
  // buttons keep focus after a click; drop it so Space/Enter/arrows go to the boat, not the menu
  document.addEventListener('click', (e) => { if (e.target.closest('button')) e.target.closest('button').blur(); });
  document.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.blur(); });
  $('btn-tour').onclick = () => { initAudio(); showMenu('tour'); };
  document.querySelectorAll('.back').forEach(b => b.onclick = () => showMenu(mode === 'menu' ? 'main' : 'pause'));
  const sel = $('f-start');
  const docked = [['home', 'Pier 40 — your slip'], ['sausalito', 'Sausalito city guest dock'], ['sams', "Sam's Anchor Cafe (Tiburon)"], ['ayala', 'Ayala Cove, Angel Island'], ['p39', 'Pier 39 Marina'], ['p15', 'Pier 1½ (Ferry Building)'], ['horseshoe', 'Horseshoe Cove'], ['schoonmaker', 'Schoonmaker Point (Sausalito)'], ['clippercove', 'Clipper Cove (Treasure Island)']];
  sel.innerHTML = `<optgroup label="Tied up at a dock — engines running, ready to cast off">` + docked.map(([k, n]) => `<option value="dock:${k}">${n}</option>`).join('') + `</optgroup>`
    + `<optgroup label="Cold start"><option value="slip">Pier 40 slip — full pre-departure checklist</option></optgroup>`
    + `<optgroup label="Underway">` + Object.entries(PRACTICE_STARTS).map(([k, s]) => `<option value="${k}">${SITES.find(x => x.id === k)?.name || k} — ${s.label}</option>`).join('') + `<option value="gate">Under the Golden Gate Bridge</option></optgroup>`;
  $('btn-go').onclick = () => {
    startFree({ start: $('f-start').value, clock: +$('f-time').value, tide: $('f-tide').value, wind: $('f-wind').value, traffic: $('f-traffic').value, fog: $('f-fog').checked });
  };
  document.querySelectorAll('.q-sel').forEach(el => { el.innerHTML = Object.entries(QUALITY).map(([k, q]) => `<option value="${k}">${q.label}</option>`).join(''); el.value = W.qualityName; el.onchange = () => applyQuality(el.value); });
  $('btn-resume').onclick = () => { showMenu(null); paused = false; };
  $('btn-restart').onclick = () => { if (mode === 'scenario' && runner.def) startScenario(runner.def); else if (mode === 'tour' && tour) startTour(tour.route); else showMenu('free'); };
  $('btn-tomenu').onclick = () => { startLobby(); };
  $('btn-pause-help').onclick = () => showMenu('help');
  $('btn-pause-scen').onclick = () => showMenu('scen');
}
function renderScenarioList() {
  let best = {};
  try { best = JSON.parse(localStorage.getItem('sfbay_best') || '{}'); } catch (e) { /* ignore */ }
  const cats = [...new Set(SCENARIOS.map(s => s.cat))];
  $('scen-list').innerHTML = cats.map(c => `<h3>${c}</h3><div class="scen-grid">` + SCENARIOS.filter(s => s.cat === c).map(s => `
    <button class="scen" data-id="${s.id}"><div class="st">${s.title}</div><div class="sw">${s.where}</div>
    <div class="sb">${best[s.id] != null ? `Best: <b class="${best[s.id] >= 80 ? 'ok' : best[s.id] >= 60 ? 'warn' : 'alarm'}">${best[s.id]}</b>` : 'Not attempted'}</div></button>`).join('') + '</div>').join('');
  document.querySelectorAll('.scen').forEach(b => b.onclick = () => startScenario(SCENARIOS.find(s => s.id === b.dataset.id)));
}
function renderPause() {
  const v = stats.violations.slice(-8).map(x => `<li>${x}</li>`).join('') || '<li class="dim">None — nice.</li>';
  $('pause-stats').innerHTML = `<div>Distance: <b>${(stats.dist / 1852).toFixed(1)} nm</b> · Damage: <b>${Math.round(player.damage)}%</b> · Slams: ${player.slams}</div><div class="viol"><b>Logbook — rule & seamanship notes:</b><ul>${v}</ul></div>`;
}

function renderTourList() {
  $('tour-list').innerHTML = ROUTES.map(r => `<button class="scen" data-id="${r.id}"><div class="st">${r.title}</div><div class="sw">${r.summary}</div><div class="sb">${r.legs.length} legs · ${r.legs.filter(l => l.stop).length} dockings · ~1½ min to watch</div></button>`).join('');
  document.querySelectorAll('#tour-list .scen').forEach(b => b.onclick = () => startTour(ROUTES.find(r => r.id === b.dataset.id)));
}
function readyBoat() {
  prepActive = false; renderPrep();
  player.prep = { cover: false, battery: true, lanyard: true };
  player.engines.forEach(e => { e.running = true; e.tilt = 0; });
  player.fenders = true;
}
function startTour(route) {
  runner.stop(); endTour();
  mode = 'tour';
  G.applyEnv({ clock: 11, tide: 'real', traffic: 'typical' });
  const s0 = PLAYER_SLIP.spot; player.reset(s0.x, s0.z, s0.heading); readyBoat();
  tour = new Tour(G, route, {
    note: (t) => renderTour(),
    tie: (on) => { if (on) { player.secureLines(); player.lines.forEach(l => { l.snug = 0; }); beep(880, 0.08); } else player.castOffAll(); },
    finished: () => { renderTour(); showTourEnd(); },
  });
  setRouteOverlay(tour.path);
  tourCamAuto = false; camMode = 'chase'; camDist = 30; camSnap = true; setDest(null); W.zone.visible = false;
  stats.violations = [];
  showMenu(null); paused = false;
  $('tourPanel').style.display = 'block'; document.body.classList.add('touring');
  renderTour();
}
function endTour() {
  tour = null;
  $('tourPanel').style.display = 'none'; $('tourEnd').style.display = 'none'; document.body.classList.remove('touring');
}
let routeLine = null;
function setRouteOverlay(path) {
  hud.routePath = path;
  if (routeLine) { W.scene.remove(routeLine); routeLine.geometry.dispose(); routeLine = null; }
  if (!path) return;
  const pts = []; for (let i = 0; i < path.length; i += 2) pts.push(new THREE.Vector3(path[i].x, 0.6, path[i].z));
  routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.85 }));
  routeLine.frustumCulled = false; W.scene.add(routeLine);
}
function renderTour() {
  if (!tour) return;
  const sg = tour.seg, hh = Math.floor(env.clock), mm = Math.floor((env.clock - hh) * 60);
  const simMin = tour.simT / 60;
  $('tourPanel').innerHTML = `<div class="th">ROUTE TOUR · ${tour.paused ? '⏸ PAUSED' : !sg ? 'done' : (tour.crucial ? 'SLOW — crucial part · ' : '⏩ FAST-FORWARD · ') + Math.round((tour.curRate || sg.rate) * tour.speedMul) + '×'}</div>
    <div class="tl">${sg ? sg.label : 'Route complete'}</div>
    <div class="dim">Clock ${hh}:${String(mm).padStart(2, '0')} · ${Math.floor(simMin / 60)}h ${String(Math.floor(simMin % 60)).padStart(2, '0')}m on the water in ${Math.round(tour.realT)} s</div>
    <div class="tnotes">${tour.log.slice(-4).reverse().map((t, i) => `<div class="${i ? 'old' : ''}">${t}</div>`).join('')}</div>
    <div class="tk"><kbd>Space</kbd> pause · <kbd>-</kbd>/<kbd>=</kbd> slower/faster · <kbd>N</kbd> skip to next docking · drag/scroll to look · <kbd>C</kbd> camera · <kbd>A</kbd> auto-cam · <kbd>M</kbd> chart · <kbd>Esc</kbd> menu</div>`;
}
function showTourEnd() {
  const el = $('tourEnd');
  el.innerHTML = `<div class="qhead">Route complete</div><h2>${tour.route.title}</h2>
    <p class="brief">Here's everything you passed, in order — read it through once, then try driving it.</p>
    <ol class="tourlist">${tour.route.notes.map(n => `<li>${n[2]}</li>`).join('')}</ol>
    <div class="dc-btns"><button id="te-replay" class="primary">Watch again</button><button id="te-drive">Drive it yourself</button><button id="te-menu">Main menu</button></div>`;
  el.style.display = 'block';
  const route = tour.route;
  $('te-replay').onclick = () => startTour(route);
  $('te-drive').onclick = () => { el.style.display = 'none'; driveRoute(route); };
  $('te-menu').onclick = () => { endTour(); setRouteOverlay(null); mode = 'menu'; clearTraffic(); showMenu('main'); };
}
// free ride from the slip with the route drawn and each stop as the next destination
function driveRoute(route) {
  const path = tour ? tour.path : null;
  endTour();
  startFree({ start: 'slip', clock: 11, tide: 'real', wind: 'auto', traffic: 'typical' });
  setRouteOverlay(path);
  routeStops = route.legs.filter(l => l.stop).map(l => { const st = l.stop.site === 'home' ? { ...PLAYER_SLIP.spot, name: 'Home slip' } : SITES.find(x => x.id === l.stop.site); return { x: st.x, z: st.z, name: l.stop.label }; });
  setDest(routeStops[0]);
}

function startFree(o) {
  runner.stop(); endTour(); setRouteOverlay(null); routeStops = null;
  mode = 'free';
  G.applyEnv({ clock: o.clock, tide: o.tide, wind: o.wind === 'auto' ? undefined : +o.wind, traffic: o.traffic, fog: o.fog ? 1 : 0, daySpeed: +($('f-day')?.value || 6) });
  document.body.classList.remove('lobby');
  if (o.fog) { env.fog = 1; env.visibility = 300; }
  if (o.start === 'slip') {
    const s = PLAYER_SLIP.spot; player.reset(s.x, s.z, s.heading); player.secureLines(); player.lines.forEach(l => { l.snug = 0; });
    beginPrep();
    toast('You\'re tied up in your slip at Pier 40. Work through the checklist to get underway.', 'info', 6000);
  } else if (o.start.startsWith('dock:')) {
    startDocked(o.start.slice(5));
  } else if (o.start === 'gate') {
    G.placePlayer(37.8180, -122.4760, 80, 10);
  } else {
    const s = PRACTICE_STARTS[o.start]; G.placePlayer(s.lat, s.lon, s.heading, 4);
    const site = SITES.find(x => x.id === o.start); if (site) setDest(site);
  }
  camSnap = true;
  if (o.start !== 'slip' && !o.start.startsWith('dock:')) { prepActive = false; renderPrep(); }
  stats.dist = 0; stats.violations = [];
  W.zone.visible = false;
  showMenu(null); paused = false;
}
// Tied up alongside (or in the slip) with the boat ready to go: cover off, battery on, engines
// trimmed down and idling in neutral, fenders out, lines on.
function startDocked(id) {
  let spot;
  if (id === 'home') spot = { ...PLAYER_SLIP.spot };
  else {
    const site = SITES.find(x => x.id === id);
    const spots = GUEST_SPOTS.filter(g => g.site === id);
    spots.sort((a, b) => Math.hypot(a.x - site.x, a.z - site.z) - Math.hypot(b.x - site.x, b.z - site.z));
    spot = spots[0] || null;
    if (!spot) { const s = PRACTICE_STARTS[id]; G.placePlayer(s.lat, s.lon, s.heading, 0); toast('No open spot at that dock right now — starting just off it.', 'warn'); return; }
    spot.free = false;
  }
  player.reset(spot.x, spot.z, spot.heading);
  readyBoat();
  player.secureLines(); player.lines.forEach(l => { l.snug = 0; });
  const name = id === 'home' ? 'your slip at Pier 40' : SITES.find(x => x.id === id)?.name;
  toast(`Tied up at ${name}. Engines idling in neutral. Cast off with <b>L</b> (or one line at a time), then ease a lever into gear.`, 'ok', 7000);
}
function practiceAt(id) {
  closeChart();
  if (mode !== 'free') startFree({ start: id, clock: env.clock, tide: 'real', wind: 'auto', traffic: 'typical' });
  else { const s = PRACTICE_STARTS[id]; G.placePlayer(s.lat, s.lon, s.heading, 3); setDest(SITES.find(x => x.id === id)); }
  showFinder = true; W.finder.visible = true;
  paused = false;
  toast('Dock finder ON (G): green pads = open guest spots. Fenders out (F) before you go in!', 'info', 6000);
}
function setDest(p) {
  dest = p ? { x: p.x, z: p.z, name: p.name || 'Waypoint' } : null;
  W.dest.visible = !!dest;
  if (dest) { W.dest.position.set(dest.x, 150, dest.z); toast(`Destination: <b>${dest.name}</b>`, 'info'); }
}
function startScenario(def) {
  endTour(); setRouteOverlay(null); routeStops = null;
  mode = 'scenario';
  showMenu(null);
  $('debrief').style.display = 'none';
  setDest(null); W.zone.visible = false;
  stats.violations = [];
  prepActive = false; renderPrep();
  runner.start(def);
  $('scen-title').innerHTML = `<b>${def.title}</b><span>${def.brief}</span>`;
  $('scen-title').style.display = 'block';
}

// ---------------------------------------------------------------- quiz & debrief overlays
let quizState = null;
function showQuiz(q, onAnswer, onContinue, def) {
  const el = $('quiz');
  quizState = { q, onAnswer, onContinue, answered: false };
  el.innerHTML = `${def ? `<div class="qhead">${def.cat} · ${def.where}</div><h2>${def.title}</h2><p class="brief">${def.brief}</p>` : ''}
    <div class="qq">${q.q}</div>
    <div class="qa">${q.a.map((a, i) => `<button data-i="${i}"><b>${i + 1}</b> ${a}</button>`).join('')}</div>
    <div class="qexp" id="qexp"></div>`;
  el.style.display = 'block';
  el.querySelectorAll('.qa button').forEach(b => b.onclick = () => answerQuiz(+b.dataset.i));
}
function answerQuiz(i) {
  if (!quizState) return;
  if (quizState.answered) return;
  quizState.answered = true;
  const ok = i === quizState.q.correct;
  document.querySelectorAll('#quiz .qa button').forEach((b, k) => { b.classList.add(k === quizState.q.correct ? 'right' : k === i ? 'wrong' : 'dim'); });
  $('qexp').innerHTML = `<div class="${ok ? 'ok' : 'alarm'}">${ok ? '✔ Correct' : '✘ Not quite'}</div><p>${quizState.q.explain}</p><button id="qcont" class="primary">Continue (Enter) ▶</button>`;
  $('qcont').onclick = continueQuiz;
  beep(ok ? 1100 : 300, 0.15);
  quizState.onAnswer?.(ok);
}
function continueQuiz() {
  if (!quizState || !quizState.answered) return;
  const c = quizState.onContinue; quizState = null;
  $('quiz').style.display = 'none';
  c?.();
}
function showDebrief(def, items, score) {
  paused = true;
  const letter = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  const idx = SCENARIOS.indexOf(def);
  $('debrief').innerHTML = `
    <div class="qhead">${def.cat} · Debrief</div><h2>${def.title}</h2>
    <div class="score ${score >= 80 ? 'ok' : score >= 60 ? 'warn' : 'alarm'}">${score}<small>/100 · ${letter}</small></div>
    <table>${items.map(it => `<tr class="${it.pts >= it.max ? 'pass' : it.pts > 0 ? 'part' : 'fail'}"><td>${it.pts >= it.max ? '✔' : it.pts > 0 ? '◐' : '✘'}</td><td>${it.label}${it.note ? `<div class="note">${it.note}</div>` : ''}</td><td class="pts">${Math.min(it.pts, it.max)}/${it.max}</td></tr>`).join('')}</table>
    <div class="dc-btns"><button id="db-retry" class="primary">Retry (R)</button>${SCENARIOS[idx + 1] ? '<button id="db-next">Next scenario ▶</button>' : ''}<button id="db-list">All scenarios</button><button id="db-free">Free ride from here</button></div>`;
  $('debrief').style.display = 'block';
  $('db-retry').onclick = () => startScenario(def);
  if ($('db-next')) $('db-next').onclick = () => startScenario(SCENARIOS[idx + 1]);
  $('db-list').onclick = () => { $('debrief').style.display = 'none'; showMenu('scen'); };
  $('db-free').onclick = () => { $('debrief').style.display = 'none'; runner.stop(); mode = 'free'; $('scen-title').style.display = 'none'; W.zone.visible = false; paused = false; };
}

// ============================================================================ input
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  if (keys.has(k)) return;
  keys.add(k);
  initAudio();
  if (quizState) {
    if (!quizState.answered && k >= '1' && k <= '4') answerQuiz(+k - 1);
    else if (quizState.answered && (k === 'enter' || k === ' ')) continueQuiz();
    return;
  }
  if ($('debrief').style.display === 'block') {
    if (k === 'r') startScenario(runner.def);
    return;
  }
  if (k === 'escape' || k === 'p') {
    if (hud.chartOpen) { closeChart(); paused = false; return; }
    if (mode === 'menu') { // lobby: Esc hides/shows the menu so you can just drive
      if ($('overlay').style.display === 'flex' && $('menu-main').style.display !== 'flex') showMenu('main');
      else showMenu($('overlay').style.display === 'flex' ? null : 'main');
      return;
    }
    if ($('overlay').style.display === 'flex') { showMenu(null); paused = false; } else { paused = true; showMenu('pause'); }
    return;
  }
  if (k === 'm' && mode !== 'menu') { if (hud.chartOpen) { closeChart(); paused = false; } else { openChart(player); if (mode === 'scenario') paused = true; } return; }
  if (mode === 'tour' && tour && !paused) {
    if (k === ' ') { tour.paused = !tour.paused; renderTour(); }
    else if (k === '-') { tour.speedMul = Math.max(0.125, tour.speedMul / 2); renderTour(); }
    else if (k === '=' || k === '+') { tour.speedMul = Math.min(8, tour.speedMul * 2); renderTour(); }
    else if (k === 'n') { tour.skip(); renderTour(); }
    else if (k === 'c') { tourCamAuto = false; camMode = { chase: 'helm', helm: 'top', top: 'orbit', orbit: 'chase' }[camMode]; toast(`Camera: ${camMode}`, 'info', 1200); }
    else if (k === 'a') { tourCamAuto = !tourCamAuto; toast(tourCamAuto ? 'Auto camera ON (overhead for dockings)' : 'Auto camera OFF — drag/scroll/C to look around', 'info', 2000); }
    else if (k === 'e') binoc = true;
    else if ('7890'.includes(k) && k.length === 1) { tourCamAuto = false; camMode = { 7: 'chase', 8: 'helm', 9: 'top', 0: 'orbit' }[k]; camSnap = true; }
    return;
  }
  if (paused) return;
  switch (k) {
    case 'a': case 's': toast('There\'s no neutral button — neutral is the detent in the middle of the lever. Pull/push the lever until it clicks into N (green light).', 'info', 3500); break;
    case '1': case '2': case '3': case '4': case '5': case '6': prepAction(+k); break;
    case 'b': player.bt.power = !player.bt.power; toast(player.bt.power ? (player.prep.battery ? 'Bow thruster ON — hold , or . to push the bow' : 'Bow thruster switch ON — but the battery is off') : 'Bow thruster OFF', 'info', 2200); break;
    case 'h': hornDown = env.time; hornStart(); break;
    case 'f': player.fenders = !player.fenders; toast(player.fenders ? 'Fenders OUT' : 'Fenders in', 'info', 1500); break;
    case 'l': player.toggleLines(); if (!player.tied) prepAction(7, true); break;
    case 'c': camMode = { chase: 'helm', helm: 'top', top: 'orbit', orbit: 'chase' }[camMode]; toast(`Camera: ${{ chase: 'Chase', helm: 'Helm (drag mouse to look around)', top: 'Overhead docking view (wheel = zoom, Y = north-up)', orbit: 'Orbit (drag/wheel)' }[camMode]}`, 'info', 1800); camYaw = 0; break;
    case 'y': northUp = !northUp; break;
    case '7': case '8': case '9': case '0': camMode = { 7: 'chase', 8: 'helm', 9: 'top', 0: 'orbit' }[k]; camYaw = 0; camSnap = true; break;
    case 'g': showFinder = !showFinder; W.finder.visible = showFinder; toast(showFinder ? 'Dock finder ON: green = open guest spots' : 'Dock finder off', 'info', 1800); break;
    case 'v': showCurrents = !showCurrents; toast(showCurrents ? 'Current overlay ON — arrows & drifting flecks show set and strength' : 'Current overlay off', 'info', 2000); break;
    case 'n': showAdvisor = !showAdvisor; break;
    case 't': if (mode === 'free') { timeScale = timeScale === 1 ? 2 : timeScale === 2 ? 4 : 1; toast(`Time ×${timeScale}`, 'info', 1200); } break;
    case 'e': binoc = true; break;
    case '`': case 'f3': perf.show = !perf.show; $('perf').style.display = perf.show ? 'block' : 'none'; break;
    case 'k': setMuted(!!(audio_muted = !audio_muted)); break;
    case 'o': if (mode === 'scenario') runner.def?.onKey?.(G, runner, 'o'); else { toast('MOB button: position marked', 'warn'); setDest({ x: player.x, z: player.z, name: 'MOB' }); } break;
    case 'r': if (mode === 'scenario' && runner.def) startScenario(runner.def); break;
  }
});
let audio_muted = false;
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (k === 'h' && hornDown != null) {
    const dur = env.time - hornDown; hornDown = null; hornStop();
    if (runner.active) runner.M.horns.push({ t: runner.t - dur, dur });
    toast(dur < 1.8 ? 'short blast' : dur >= 3.5 ? 'prolonged blast' : 'blast (2–3 s is neither short nor prolonged)', 'info', 900);
  }
  if (k === 'e') binoc = false;
  if (player) { if (k === 'q' || k === 'z') player.engines[0].detent = null; if (k === 'w' || k === 'x') player.engines[1].detent = null; }
});
// if the window loses focus while a key is held, the key-up never arrives: release everything
window.addEventListener('blur', () => { keys.clear(); if (player) player.engines.forEach(e => { e.detent = null; }); if (hornDown != null) { hornDown = null; hornStop(); } });
let mdrag = null;
$('c').addEventListener('mousedown', (e) => { mdrag = { x: e.clientX, y: e.clientY, yaw: camYaw, pitch: camPitch }; });
window.addEventListener('mouseup', () => { mdrag = null; });
window.addEventListener('mousemove', (e) => {
  if (!mdrag) return;
  camYaw = mdrag.yaw - (e.clientX - mdrag.x) * 0.006;
  camPitch = Math.max(-0.6, Math.min(1.3, mdrag.pitch + (e.clientY - mdrag.y) * 0.004));
});
$('c').addEventListener('wheel', (e) => {
  if (camMode === 'top') topAlt = Math.max(12, Math.min(600, topAlt * (e.deltaY > 0 ? 1.12 : 0.89)));
  else camDist = Math.max(8, Math.min(250, camDist * (e.deltaY > 0 ? 1.12 : 0.89)));
}, { passive: true });

// Each engine has ONE lever: hold the forward key to push it ahead, hold the reverse key to pull
// it back. The further it goes, the more throttle. Neutral is a detent in the middle: the lever
// stops there — release the key and press again to go through to the other gear.
const LEVER_RATE = 0.55; // lever travel per second (neutral -> full ahead in ~1.8 s)
let strainT = 0;
function handleInput(dt) {
  const both = keys.has('shift');
  for (const [i, fk, rk] of [[0, 'q', 'z'], [1, 'w', 'x']]) {
    const e = player.engines[i];
    if (e.failed || leverDrag?.i === i) continue;
    // Shift + one engine's keys moves both levers together (one hand on both knobs)
    const f2 = both && keys.has(i ? 'q' : 'w'), r2 = both && keys.has(i ? 'z' : 'x');
    const dir = ((keys.has(fk) || f2) ? 1 : 0) - ((keys.has(rk) || r2) ? 1 : 0);
    if (!dir || e.detent === dir) continue;
    const prev = e.lever;
    let nv = prev + dir * LEVER_RATE * dt;
    if (prev !== 0 && Math.sign(nv) !== Math.sign(prev)) { nv = 0; e.detent = dir; beep(520, 0.05, 0.08); }
    player.setLever(i, nv);
  }
  // hydraulic helm: ~1.2 turns/s hand-over-hand, Shift = spinning it fast (~2.2 turns/s)
  const spin = keys.has('shift') ? 2.2 : 1.2;
  // trim/tilt rocker (on the port grip): ↑ bow up / ↓ bow down. Electric — needs the battery.
  if (player.prep.battery && (keys.has('arrowup') || keys.has('arrowdown'))) {
    const d = (keys.has('arrowup') ? 1 : -1) * dt * 0.22;
    player.engines.forEach(e => { e.tilt = Math.max(0, Math.min(1, e.tilt + d)); });
  }
  if (keys.has('arrowleft')) player.turnWheel(-spin * dt);
  if (keys.has('arrowright')) player.turnWheel(spin * dt);
  // bow thruster joystick
  player.bt.cmd = (keys.has('.') ? 1 : 0) - (keys.has(',') ? 1 : 0);
  // pulling against tied lines
  strainT -= dt;
  if (player.tied && strainT <= 0 && player.engines.some(e => e.running && e.gear !== 0 && e.thr > 0.25) && player.lines.some(l => l.taut)) {
    strainT = 5; toast('Lines are taut — you\'re pulling against the dock lines. Cast them off (L or the LINES panel) to leave.', 'warn', 3500);
  }
}

// ---- mouse: grab a lever knob or the wheel rim on the control panel
let leverDrag = null, wheelDrag = null;
{
  const cv = $('engines');
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * cv.width / r.width, y: (ev.clientY - r.top) * cv.height / r.height }; };
  cv.addEventListener('pointerdown', (ev) => {
    if (!player) return;
    const p = pos(ev);
    for (const L of engHit.levers) {
      // top-down binnacle: grab the grip bar or the arm column of either lever
      const onGrip = p.x > L.x0 && p.x < L.x1 && Math.abs(p.y - L.gy) < 14;
      const onArm = Math.abs(p.x - L.ax) < 14 && p.y > Math.min(L.gy, L.pivY) - 12 && p.y < Math.max(L.gy, L.pivY) + 12;
      if (onGrip || onArm) { leverDrag = { i: L.i, L, dy: p.y - L.gy }; cv.setPointerCapture(ev.pointerId); ev.preventDefault(); return; }
    }
    const w = engHit.wheel;
    if (w && Math.hypot(p.x - w.cx, p.y - w.cy) < w.r + 12) { wheelDrag = { a: Math.atan2(p.y - w.cy, p.x - w.cx) }; cv.setPointerCapture(ev.pointerId); ev.preventDefault(); }
  });
  cv.addEventListener('pointermove', (ev) => {
    if (!player || paused) return;
    const p = pos(ev);
    if (leverDrag) {
      const { L, i } = leverDrag, e = player.engines[i];
      // grip height above/below the pivot line → lever angle (seen from above: y = pivot − sin(angle)·arm)
      const sy = Math.max(-1, Math.min(1, (L.pivY - (p.y - leverDrag.dy)) / L.ARM));
      let nv = Math.max(-1, Math.min(1, Math.asin(sy) / LEVER_SWEEP));
      // neutral detent: the lever "clicks" into N and you have to push past the notch to leave it
      if (e.lever === 0 && Math.abs(nv) < 0.09) nv = 0;
      else if (Math.sign(nv) !== Math.sign(e.lever) && e.lever !== 0) { nv = 0; beep(520, 0.05, 0.08); }
      player.setLever(i, nv);
    } else if (wheelDrag) {
      const w = engHit.wheel, a = Math.atan2(p.y - w.cy, p.x - w.cx);
      let d = a - wheelDrag.a; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
      player.turnWheel(d / (Math.PI * 2)); wheelDrag.a = a;
    }
  });
  const up = () => { leverDrag = null; wheelDrag = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
}

// where the interesting noises are, relative to the listener
const AMB = { p39: ll(37.8103, -122.4118), gate: ll(37.8172, -122.4783) };
function relPan(x, z) { const b = Math.atan2(x - player.x, -(z - player.z)) - player.h; return Math.sin(b); }
function ambientInfo() {
  let buoy = { d: 1e9, pan: 0 };
  for (const a of NAV_AIDS) { const d = Math.hypot(a.x - player.x, a.z - player.z); if (d < buoy.d) buoy = { d, pan: relPan(a.x, a.z) }; }
  const dd = (p) => ({ d: Math.hypot(p.x - player.x, p.z - player.z), pan: relPan(p.x, p.z) });
  return { kn: player.sogKn, chop: chopAt(player.x, player.z).chop, docked: !!player.tied, landDist: Math.max(0, -sdfAt(player.x, player.z)),
    p39: dd(AMB.p39), buoy, gate: dd(AMB.gate), fog: env.fog > 0.4 || (env.clock > 16 && env.clock < 21) };
}

// ---- dock lines panel: see each line, cast off individually
let linesSig = '';
function renderLines() {
  const el = $('linesPanel');
  const sig = player.lines.map(l => l.name + (l.taut ? 1 : 0)).join('|') + (player.alongside ? 'A' : '');
  if (sig === linesSig) return;
  linesSig = sig;
  if (!player.lines.length) {
    el.style.display = player.alongside ? 'block' : 'none';
    el.innerHTML = '<div class="lh">LINES</div><div>Alongside — press <b>L</b> to make fast</div>';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = '<div class="lh">LINES MADE FAST — click to cast off</div>' + player.lines.map((l, i) => `<div class="ln ${l.taut ? 'taut' : ''}"><span>${l.name}${l.taut ? ' · taut' : ''}</span><button data-i="${i}">cast off</button></div>`).join('') + '<div class="dim" style="margin-top:4px">L = all lines</div>';
  el.querySelectorAll('button').forEach(b => b.onclick = () => { const ln = player.lines[+b.dataset.i]; player.castOffLine(+b.dataset.i); toast(`${ln.name} cast off`, 'info', 1500); if (!player.lines.length) prepAction(7, true); linesSig = ''; renderLines(); });
}

// ---------------------------------------------------------------- pre-departure checklist
const PREP_STEPS = [
  { k: 1, label: 'Unsnap the canvas cover', done: () => !player.prep.cover },
  { k: 2, label: 'Battery switch ON', done: () => player.prep.battery },
  { k: 3, label: 'Clip on the engine kill-switch lanyard', done: () => player.prep.lanyard },
  { k: 4, label: 'Trim both engines DOWN (props in the water)', done: () => player.engines.every(e => e.tilt < 0.05) },
  { k: 5, label: 'Start PORT engine (lever in N)', done: () => player.engines[0].running },
  { k: 6, label: 'Start STARBOARD engine (lever in N)', done: () => player.engines[1].running },
  { k: 7, label: 'Untie the dock lines (L)', done: () => !player.tied },
];
let prepActive = false, trimAnim = null;
function beginPrep() {
  prepActive = true;
  player.prep = { cover: true, battery: false, lanyard: false };
  player.engines.forEach(e => { e.running = false; e.tilt = 1; e.rpm = 0; player.setLever(player.engines.indexOf(e), 0); });
  player.fenders = true;
  renderPrep();
}
function prepAction(k, fromLines = false) {
  if (!prepActive) { if (k === 5 || k === 6) tryStart(k - 5); return; }
  const P = player.prep;
  if (k === 1) { if (P.cover) { P.cover = false; toast('Cover unsnapped and stowed.', 'ok', 1800); } }
  else if (P.cover && k !== 7) { toast('You can\'t reach the helm — unsnap the cover first (1).', 'warn'); }
  else if (k === 2) { P.battery = true; toast('Battery switch ON — electronics powering up.', 'ok', 1800); beep(990, 0.08); }
  else if (k === 3) { P.lanyard = true; toast('Kill-switch lanyard clipped to your life jacket. If you go over, the engines stop.', 'ok', 2800); }
  else if (k === 4) {
    if (!P.battery) toast('Nothing happens — the trim motors are electric. Battery switch first (2).', 'warn', 3000);
    else if (!trimAnim) { toast('Trimming engines down…', 'info', 1500); trimAnim = 1; }
  }
  else if (k === 5 || k === 6) tryStart(k - 5);
  else if (k === 7 && fromLines && player.engines.some(e => !e.running)) toast('You untied without both engines running — you\'re drifting!', 'warn', 3500);
  renderPrep();
}
function tryStart(i) {
  const r = player.startEngine(i), nm = i ? 'Starboard' : 'Port';
  const msg = {
    ok: `${nm} engine started.${player.engines[i].tilt > 0.5 ? ' It\'s still tilted UP — no cooling water! Trim down (4).' : ''}`,
    running: `${nm} engine is already running.`,
    battery: 'Click… nothing. The battery switch is OFF (2).',
    lanyard: 'Engine won\'t crank — the kill-switch lanyard isn\'t attached (3).',
    gear: `Won't crank: ${nm} lever must be in NEUTRAL (neutral-safety switch).`,
  }[r];
  toast(msg, r === 'ok' ? 'ok' : 'warn', 3000);
  if (r === 'ok' || r === 'gear' || r === 'lanyard') crank();
}
function renderPrep() {
  const el = $('prep');
  if (!prepActive) { el.style.display = 'none'; return; }
  const all = PREP_STEPS.every(s => s.done());
  el.style.display = 'block';
  el.innerHTML = `<div class="ph">PRE-DEPARTURE CHECKLIST</div>` + PREP_STEPS.map(s => `<div class="pi ${s.done() ? 'done' : ''}" data-k="${s.k}"><span class="pk">${s.k === 7 ? 'L' : s.k}</span>${s.done() ? '✔' : '○'} ${s.label}</div>`).join('') +
    (all ? '<div class="pdone">All set — ease the levers back (Z + X) to back out of the slip.</div>' : '<div class="dim small">Press the number keys (or click). Fenders are already out.</div>');
  el.querySelectorAll('.pi').forEach(d => d.onclick = () => { const k = +d.dataset.k; if (k === 7) { player.toggleLines(); prepAction(7, true); } else prepAction(k); });
  if (all) setTimeout(() => { if (PREP_STEPS.every(s => s.done())) { prepActive = false; renderPrep(); } }, 6000);
}
function updatePrep(dt) {
  if (trimAnim) {
    let doneAll = true;
    for (const e of player.engines) { e.tilt = Math.max(0, e.tilt - dt / 3); if (e.tilt > 0) doneAll = false; }
    if (doneAll) { trimAnim = null; toast('Engines trimmed down.', 'ok', 1500); renderPrep(); }
  }
}

// ============================================================================ events → feedback
function handleEvents() {
  for (const ev of player.events) {
    if (ev.type === 'impact') {
      if (ev.sev === 'touch' && ev.fenders) squeak(Math.min(1, ev.impact * 3));
      else if (ev.sev === 'touch') crunch(0.15);
      else crunch(ev.sev === 'bump' ? 0.35 : ev.sev === 'crash' ? 0.8 : 1);
      runner.active && runner.onImpact(ev);
      const kn = (ev.impact / KN).toFixed(1);
      if (ev.sev === 'collision') { toast(`COLLISION with ${ev.obj?.name || 'another vessel'} at ${kn} kn!`, 'alarm', 5000); stats.violations.push(`Collision with ${ev.obj?.name || 'a vessel'}`); }
      else if (ev.sev === 'crash') { toast(`Hard impact (${ev.kind}) at ${kn} kn — damage!`, 'alarm'); stats.violations.push(`Hard impact with ${ev.kind} at ${kn} kn`); }
      else if (ev.sev === 'bump') toast(`Bump (${kn} kn)${ev.fenders ? '' : ' — no fenders out! Gelcoat scratched. (F)'}`, 'warn');
      else if (ev.kind === 'float' || ev.kind === 'pier') toast(`Gentle touch (${kn} kn) ✓`, 'ok', 1200);
    } else if (ev.type === 'ground') {
      beep(220, 0.4, 0.2);
      runner.active && (runner.M.groundings++);
      toast(ev.what === 'prop' ? `PROP STRIKE — only ${ft(ev.depth)} ft of water! Back out the way you came.` : `AGROUND! (${ft(ev.depth)} ft)`, 'alarm', 4500);
      stats.violations.push(ev.what === 'prop' ? 'Prop strike in shallow water' : 'Ran aground');
    } else if (ev.type === 'shift') {
      if (player.engines[ev.engine].running) shiftClunk();
    } else if (ev.type === 'overheat') {
      toast(`${ev.engine ? 'Starboard' : 'Port'} engine OVERHEAT alarm — it's tilted up with no cooling water! Trim down (4).`, 'alarm', 5000);
    } else if (ev.type === 'hardshift') {
      runner.active && runner.M.hardShifts++;
      toast('Shift at IDLE! Pull the throttle back before shifting gears.', 'warn');
    } else if (ev.type === 'slam') {
      thud(0.6 * ev.chop + 0.2);
      if (env.time - (G._slamToastT || -99) > 10) { G._slamToastT = env.time; toast(`Slam! ${Math.round(ev.kn)} kn into ${ft(ev.chop * 2)} ft chop — slow down / quarter the waves`, 'warn', 2200); }
    } else if (ev.type === 'tied') { toast(`Lines secured${ev.st?.label ? ' — ' + ev.st.label : ''}`, 'ok'); beep(880, 0.1); }
    else if (ev.type === 'castoff') toast('Lines cast off', 'info', 1500);
    else if (ev.type === 'cantTie') toast(ev.why === 'fast' ? 'Too fast to get a line on — stop the boat first.' : 'Nothing within reach of a cleat — get within ~1 m of the dock, stopped, then press L', 'warn', 2800);
    else if (ev.type === 'lineStrain') toast(`${ev.line.name} is under heavy strain!`, 'warn', 2500);
    else if (ev.type === 'btTrip') toast('Bow thruster THERMAL CUTOUT — use short bursts (it overheats after ~45 s of continuous use).', 'warn', 4000);
  }
  player.events.length = 0;
}

// wake crossing: crests from other boats' wakes carry wave energy
function checkWakes() {
  const n = crests.n, d = crests.d, t = env.time;
  let hit = 0;
  for (let k = 0; k < n; k++) {
    const e = d[k * 7 + 6];
    if (e <= 0) continue;
    const age = t - d[k * 7 + 4], life = d[k * 7 + 5];
    if (age > life) { d[k * 7 + 6] = 0; continue; }
    if (age < 2.5) continue;
    // cheap reject using spawn point + max drift before computing the exact position
    const dx0 = d[k * 7] - player.x, dz0 = d[k * 7 + 1] - player.z;
    if (Math.abs(dx0) > 60 || Math.abs(dz0) > 60) continue;
    const c = crestPos(k, t), dx = c.x - player.x, dz = c.z - player.z;
    if (dx * dx + dz * dz > 30) continue;
    hit = Math.max(hit, e * (1 - age / life));
    d[k * 7 + 6] = 0;
  }
  if (hit > 0) {
    const mag = Math.min(0.5, hit * 0.0007) * (0.5 + Math.min(1.5, player.speed / 8));
    player.oscRv += (Math.random() < 0.5 ? -1 : 1) * mag; player.oscPv += mag * 0.6;
    if (mag > 0.12) { player.wakeHits++; thud(mag); if (mag > 0.25) toast('Big wake hit! Slow down and take wakes at ~45°', 'warn', 2000); }
  }
}

// ============================================================================ free-ride coaching
const brgHist = new Map();
let coachT = 0, lastCoach = '', nwTimer = 0, lastZone = null, shipAheadWarnT = 0;
function advisor(dt) {
  let best = null;
  const own = { x: player.x, z: player.z, h: player.h, vx: player.vx, vz: player.vz, speed: player.speed, cat: 'power', len: 10.7 };
  const tl = [];
  for (const v of traffic.vessels) {
    if (!v.active || (v.mesh && !v.mesh.visible) || v.noCollide) continue;
    const dx = v.x - player.x, dz = v.z - player.z, r2 = dx * dx + dz * dz;
    if (r2 > 4000 * 4000) continue;
    const info = vesselInfo(v);
    const c = cpa(own.x, own.z, own.vx, own.vz, v.x, v.z, v.vx, v.vz);
    const risk = isRisk(c, own, info);
    const brg = trueBearing(player.x, player.z, v.x, v.z);
    // bearing history for "steady bearing" detection
    let hst = brgHist.get(v.id);
    if (!hst) { hst = { b: brg, r: c.range, t: env.time }; brgHist.set(v.id, hst); }
    let steady = false;
    if (env.time - hst.t > 6) { steady = Math.abs(angDiff(brg, hst.b)) < 2 && c.range < hst.r - 20; hst.steady = steady; hst.b = brg; hst.r = c.range; hst.t = env.time; }
    steady = hst.steady && risk;
    tl.push({ v, c, brg, risk, label: labelFor(v) });
    if (risk) {
      const pri = c.tcpa * (info.cat === 'ship' ? 0.4 : 1);
      if (!best || pri < best.pri) best = { v, pri, cls: classify(own, info), steady, label: labelFor(v) };
    }
  }
  tl.sort((a, b) => (b.risk - a.risk) || (a.c.range - b.c.range));
  return { best, tl };
}
function labelFor(v) {
  return { ship: v.kind === 'tanker' ? 'Tanker' : v.kind === 'carcarrier' ? 'Car carrier' : 'Container ship', ferry: 'Ferry', tour: 'Tour boat', sail: v.racing ? 'Racing sailboat' : 'Sailboat', power: 'Powerboat', fishing: 'Fishing boat', kayak: 'Kayak/SUP', swimmer: 'Swimmer', kiter: 'Kiteboarder', jetski: 'Jet ski', tug: 'Tug w/ tow', barge: 'Barge (towed)', law: 'Patrol boat' }[v.type] || v.type;
}
function coach(dt, adv) {
  coachT -= dt;
  if (routeStops && dest && Math.hypot(dest.x - player.x, dest.z - player.z) < 60 && player.tied) { routeStops.shift(); if (routeStops.length) { setDest(routeStops[0]); toast('Next stop: ' + routeStops[0].name, 'ok', 3000); } else { toast('Route complete — welcome home!', 'ok', 5000); routeStops = null; setDest(null); } }
  let msg = '';
  const zone = noWakeZoneAt(player.x, player.z);
  if (zone) {
    if (player.sogKn > 6) { nwTimer += dt; if (nwTimer > 4) { msg = `${zone.name}: slow to 5 kn — your wake is hitting moored boats`; if (nwTimer > 4 && nwTimer - dt <= 4) stats.violations.push(`Speeding (${player.sogKn.toFixed(0)} kn) in ${zone.name}`); } }
    else nwTimer = 0;
    if (zone !== lastZone) toast(`Entering: ${zone.name}`, 'info', 2500);
  } else nwTimer = 0;
  lastZone = zone;
  const lane = shipLaneAt(player.x, player.z);
  if (!msg && lane) msg = 'You\'re in the deep-draft traffic lane. Ships can\'t stop or turn — cross at right angles and get out. Listen to VHF 13/14.';
  if (adv?.best && adv.best.cls.situation === 'ship' && adv.best.cls.dcpa < 300 && env.time - shipAheadWarnT > 20) {
    const T = adv.best;
    const along = (player.x - T.v.x) * Math.sin(T.v.h) + (player.z - T.v.z) * -Math.cos(T.v.h);
    if (along > 0 && T.cls.range < 1500) { stats.violations.push(`Rule 9: in the path of ${T.v.name} at ${fmtRange(T.cls.range)}`); shipAheadWarnT = env.time; }
  }
  const dep = player.depth;
  if (dep > 0 && dep < 2.6 && player.speed > 0.5) msg = `SHOALING: ${ft(dep)} ft under you (draft ~3.5 ft with drives down)`;
  if (!msg) {
    const c = currentAt(player.x, player.z), cs = Math.hypot(c.x, c.z) / KN;
    const { chop } = chopAt(player.x, player.z);
    if (chop > 0.55 && player.sogKn > 18) msg = `Steep chop (${ft(chop * 2)} ft${tideCurrentFactor() < -0.4 ? ', wind against the ebb' : ''}) — slow down and quarter the waves`;
    else if (cs > 2 && player.sogKn < 8) msg = `Current ${cs.toFixed(1)} kn setting you toward ${Math.round((Math.atan2(c.x, -c.z) / D2R + 360) % 360)}° — watch your COG vs heading`;
  }
  if (!msg) {
    const site = nearestSite(player.x, player.z, 380);
    if (site && player.sogKn < 9) msg = `${site.name}: ${site.summary} ${showFinder ? '' : '(G = show open guest spots, M = chart & details)'}`;
  }
  if (!msg && player.speed < 1.2 && !player.fenders && !player.tied) {
    for (const g of GUEST_SPOTS) if (Math.hypot(g.x - player.x, g.z - player.z) < 60) { msg = 'Close to a dock — fenders out? (F)'; break; }
  }
  if (!msg) for (const hz of HAZARDS) { const p = ll(hz.lat, hz.lon); if (Math.hypot(p.x - player.x, p.z - player.z) < 450) { msg = `${hz.name}: ${hz.note}`; break; } }
  if (!msg && W.night) msg = 'Night: power-driven vessels show white masthead + red (port) / green (starboard) + white stern. Red = you see its port side.';
  if ($('coach').textContent !== msg) { $('coach').textContent = msg; $('coach').style.display = msg ? 'block' : 'none'; }
}

// ============================================================================ camera
const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
function updateCamera(dt) {
  const cam = W.camera, p = player;
  cam.fov = binoc ? 14 : camMode === 'helm' ? 70 : 60; cam.updateProjectionMatrix();
  if (camMode === 'helm') {
    const body = p.m.body; body.updateMatrixWorld(true);
    const eye = new THREE.Vector3(...(p.m.helmEye || [-0.12, 2.25, 1.55])).applyMatrix4(body.matrixWorld);
    cam.position.copy(eye);
    const yaw = -p.h + camYaw;
    const look = new THREE.Vector3(Math.sin(-yaw) * Math.cos(camPitch * 0.5 - 0.12), Math.sin(-(camPitch * 0.5 - 0.12)) * 1, -Math.cos(-yaw) * Math.cos(camPitch * 0.5 - 0.12));
    cam.up.set(0, 1, 0);
    cam.lookAt(eye.clone().add(look));
    cam.rotateZ(-(p.roll + p.oscR) * 0.6);
  } else if (camMode === 'chase' || camMode === 'orbit') {
    const yaw = (camMode === 'chase' ? p.h : 0) + camYaw;
    const d = camDist, pitch = camPitch + 0.08;
    const target = new THREE.Vector3(p.x, 2.5, p.z);
    const want = new THREE.Vector3(p.x - Math.sin(yaw) * Math.cos(pitch) * d, 2 + Math.sin(pitch) * d, p.z + Math.cos(yaw) * Math.cos(pitch) * d);
    if (camMode === 'chase' && !camSnap && mode !== 'tour') cam.position.lerp(want, 1 - Math.exp(-dt * 4)); else cam.position.copy(want);
    camSnap = false;
    cam.position.y = Math.max(cam.position.y, 1.5);
    cam.up.set(0, 1, 0); cam.lookAt(target);
  } else if (camMode === 'top') {
    cam.position.set(p.x, topAlt, p.z + 0.001);
    cam.up.set(northUp ? 0 : Math.sin(p.h), 0, northUp ? -1 : -Math.cos(p.h));
    cam.lookAt(p.x, 0, p.z);
  }
}

// ============================================================================ loop
let last = performance.now(), hudT = 0, chopT = 0, canvT = 0, mmT = 0, arrowT = 0, chartT = 0, advCache = null;
let stepping = false, lastDraw = 0, tourUiT = 0;
// perf telemetry for dynamic resolution + overlay
const perf = { frames: 0, cpu: 0, t0: performance.now(), fps: 0, cpuMs: 0, slowT: 0, fastT: 0, show: false };
function frame(now) {
  if (!stepping) requestAnimationFrame(frame);
  // ---- frame pacing: ProMotion runs rAF at 120 Hz; only render at the selected cap.
  // Paused / menu / chart screens drop to a low rate since nothing needs to be smooth.
  const cap = stepping ? 1e9 : (hud.chartOpen ? 20 : paused ? 30 : W.q.fps);
  if (!stepping && now - lastDraw < 1000 / cap - 2) return;
  lastDraw = now;
  const cpu0 = performance.now();
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  const active = !paused && mode !== 'tour' && !hud.chartOpen;
  if (mode === 'tour' && tour && !paused && !hud.chartOpen) {
    tour.update(rdt);
    advanceClock(rdt);
    const sg = tour.seg;
    if (tourCamAuto && sg) { const want = sg.cam === 'top' ? 'top' : 'chase'; if (camMode !== want) { camMode = want; camSnap = true; } if (want === 'top') topAlt = 75; else camDist = 38; }
    handleEvents();
    chopT -= rdt * 30;
    if (chopT <= 0) { chopT = 3; updateChop(); updateChopTexture(); }
    updateParticles(rdt, player.x, player.z, showCurrents);
    tourUiT -= rdt; if (tourUiT <= 0) { tourUiT = 0.25; renderTour(); }
  }
  if (active) {
    handleInput(rdt);
    const sim = rdt * timeScale;
    const steps = Math.max(1, Math.ceil(sim / (1 / 60) - 0.01));
    const h = sim / steps;
    for (let i = 0; i < steps; i++) {
      advanceEnv(h);
      const ox = player.x, oz = player.z;
      player.update(h);
      stats.dist += Math.hypot(player.x - ox, player.z - oz);
      updateTraffic(h, player, W.camera.position);
      runner.update(h);
    }
    updatePrep(rdt);
    handleEvents();
    checkWakes();
    chopT -= sim;
    if (chopT <= 0) { chopT = 3; updateChop(); updateChopTexture(); }
    updateRadio(sim);
    updateParticles(sim, player.x, player.z, showCurrents);
  }
  updateCamera(rdt);
  if (window.__camLook) { const L = window.__camLook(); if (L) { W.camera.fov = L.fov || W.camera.fov; W.camera.updateProjectionMatrix(); W.camera.lookAt(L.x, L.y, L.z); } }   // debug/screenshot hook
  if (!paused && !hud.chartOpen) updateFleetWeek(active ? rdt * timeScale : rdt, W.camera.position, _camR.set(1, 0, 0).applyQuaternion(W.camera.quaternion));
  updateWorld(rdt, player, {});
  arrowT -= rdt;
  if (arrowT <= 0) { arrowT = 0.25; updateCurrentArrows(player.x, player.z, showCurrents && mode !== 'menu'); }
  updateLights(W.camera.position, W.night || env.fog > 0.3);
  if (W.dest.visible && dest) { const d = Math.hypot(dest.x - player.x, dest.z - player.z); W.dest.scale.set(Math.max(1, d / 300), 1, Math.max(1, d / 300)); }
  // ---- HUD (DOM and 2D canvas work is CPU-heavy: run it at low, fixed rates)
  hudT -= rdt; canvT -= rdt; mmT -= rdt; chartT -= rdt;
  {
    if ($('hud').style.display !== 'block') $('hud').style.display = 'block';
    if (canvT <= 0) {
      canvT = 1 / 20;
      drawCompass(player); drawEngines(player, keys, camMode);
      updateContactAudio(player.scrape, player.fenders, player.bt.thrust);
      updateAmbient(1 / 20, ambientInfo());
      updateAudio(player, (() => { const w = windAt(player.x, player.z); return Math.hypot(w.x - player.vx, w.z - player.vz); })());
    }
    if (mmT <= 0) { mmT = 1 / 10; drawMinimap(player, traffic.vessels, camMode === 'top' ? 400 : 1500); }
    if (hudT <= 0) {
      hudT = 0.2;
      advCache = advisor(0.2);
      let zone = '';
      if (dest) { const d = Math.hypot(dest.x - player.x, dest.z - player.z); zone = `→ ${dest.name}: ${fmtRange(d)} · ${String(Math.round(trueBearing(player.x, player.z, dest.x, dest.z))).padStart(3, '0')}°`; }
      updateInstruments(player, { zone, timeScale });
      renderLines();
      drawTargets(advCache.tl);
      drawAdvisor(showAdvisor ? advCache.best : null);
      if (mode === 'free' || mode === 'scenario') coach(0.2, advCache);
      if (runner.active) $('scen-timer').textContent = `${Math.floor(runner.t / 60)}:${String(Math.floor(runner.t % 60)).padStart(2, '0')}`;
      const st = mode === 'scenario' && runner.active ? 'block' : 'none';
      if ($('scen-title').style.display !== st) $('scen-title').style.display = st;
    }
    if (hud.chartOpen && chartT <= 0) { chartT = 1 / 20; drawChart(player, traffic.vessels, dest); }
  }
  // the chart covers the whole screen: don't spend GPU on a 3D frame nobody can see
  if (!hud.chartOpen) renderFrame();
  // ---- telemetry & dynamic resolution
  const cpu = performance.now() - cpu0;
  perf.frames++; perf.cpu += cpu;
  if (now - perf.t0 >= 1000) {
    perf.fps = perf.frames * 1000 / (now - perf.t0); perf.cpuMs = perf.cpu / perf.frames;
    perf.frames = 0; perf.cpu = 0; perf.t0 = now;
    // skip when the tab is hidden/throttled (browser starves rAF) so we don't wrongly drop resolution
    if (active && document.visibilityState === 'visible' && perf.fps > 12) {
      const target = Math.min(W.q.fps, 120);
      if (perf.fps < target * 0.85) { perf.slowT++; perf.fastT = 0; } else if (perf.fps >= target * 0.97) { perf.fastT++; perf.slowT = 0; }
      if (perf.slowT >= 2 && W.dpr > 0.7) { setDpr(W.dpr * 0.88); perf.slowT = 0; }
      if (perf.fastT >= 6 && W.dpr < W.dprMax) { setDpr(W.dpr * 1.06); perf.fastT = 0; }
    }
    if (perf.show) {
      const i = W.renderer.info.render;
      $('perf').textContent = `${perf.fps.toFixed(0)} fps (cap ${W.q.fps}) · CPU ${perf.cpuMs.toFixed(1)} ms/frame · ${i.calls} draws · ${(i.triangles / 1e6).toFixed(2)}M tris · res ×${W.dpr.toFixed(2)} (${Math.round(window.innerWidth * W.dpr)}×${Math.round(window.innerHeight * W.dpr)}) · ${W.qualityName}`;
    }
  }
}
// HDR + bloom + grade (skipped in Battery mode, which renders straight to the screen)
const _sunV = new THREE.Vector3(), _camR = new THREE.Vector3();
let postSize = '';
function renderFrame() {
  const usePost = W.post && W.qualityName !== 'battery';
  if (!usePost) { W.renderer.render(W.scene, W.camera); return; }
  const P = W.post, key = `${window.innerWidth}x${window.innerHeight}@${W.dpr}`;
  if (key !== postSize) { postSize = key; P.setSize(window.innerWidth, window.innerHeight, W.dpr); }
  const u = P.comp.uniforms, sd = W.sky.material.uniforms.sunPosition.value;
  _sunV.copy(W.camera.position).addScaledVector(sd, 5000).project(W.camera);
  const inFront = _sunV.z < 1 && sd.y > -0.03;
  u.uSun.value.set(_sunV.x * 0.5 + 0.5, _sunV.y * 0.5 + 0.5, inFront ? 1 : 0);
  u.uSunCol.value.copy(W.sun.color).multiplyScalar(W.sun.intensity / 3.4);
  u.uExposure.value = W.renderer.toneMappingExposure;
  u.uWarm.value = 1.0;
  P.render(W.scene, W.camera);
}
function applyQuality(name) {
  setQuality(name);
  try { localStorage.setItem('sfbay_quality', W.qualityName); } catch (e) { /* storage unavailable */ }
  document.querySelectorAll('.q-sel').forEach(el => { el.value = W.qualityName; });
}

boot().catch(err => { console.error(err); $('loadmsg').textContent = 'Error: ' + err.message; });
window.__step = (n = 1, dt = 1 / 60) => { stepping = true; const t0 = performance.now(); for (let i = 0; i < n; i++) { last -= dt * 1000; frame(last + dt * 1000 * 2 - dt * 1000); } stepping = false; return performance.now() - t0; };
window.__keys = keys; window.__scen = { start: (id) => startScenario(SCENARIOS.find(s => s.id === id)), list: SCENARIOS.map(s => s.id), runner: () => runner, answer: answerQuiz, cont: continueQuiz }; window.__G = G; window.__W = W; window.__traffic = traffic;
