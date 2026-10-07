// Scenario mode: scripted situations with a pre-brief quiz and a graded debrief.
import { ll, toLL, SHIP_LANES, noWakeZoneAt, pointInPoly, NO_WAKE_ZONES, sdfAt } from './geo.js';
import { env, KN, currentAt } from './env.js';
import { traffic, makeScripted, spawnTow, spawnFleetAt } from './traffic.js';
import { cpa, relBearing, angDiff, classify } from './rules.js';
import { GUEST_SPOTS, PIER_FRAMES, PLAYER_SLIP } from './docks.js';
import { buildSwimmer } from './models.js';
import { W } from './world.js';

const D2R = Math.PI / 180;
const dir = (deg) => ({ x: Math.sin(deg * D2R), z: -Math.cos(deg * D2R) });
const P = (lat, lon) => ll(lat, lon);
const item = (label, pts, max, note = '') => ({ label, pts: Math.max(0, Math.round(pts)), max, note, ok: pts >= max * 0.99 });

// ---------------------------------------------------------------- helpers used by scenarios
function collisionStart(player, kn, tMeet, tgtHdg, tgtKn, offset = 0) {
  const pv = dir(player.headingDeg), sp = kn * KN;
  const Pm = { x: player.x + pv.x * sp * tMeet, z: player.z + pv.z * sp * tMeet };
  const tv = dir(tgtHdg), ts = tgtKn * KN;
  const r = { x: Math.cos(tgtHdg * D2R), z: Math.sin(tgtHdg * D2R) };
  return { x: Pm.x - tv.x * ts * tMeet + r.x * offset, z: Pm.z - tv.z * ts * tMeet + r.z * offset, h: tgtHdg * D2R, speed: ts };
}
function scripted(type, s, extra = {}) {
  const v = makeScripted(type, { x: s.x, z: s.z, h: s.h, desH: s.h, speed: s.speed, targetSpeed: s.speed, maxSpeed: s.speed * 1.5 + 1, turnRate: 0.25, accel: 0.8, ...extra });
  v.highlight = true;
  return v;
}
function bursts(horns) {
  const out = []; let cur = null;
  for (const h of horns) {
    if (!cur || h.t - cur.end > 1.8) { cur = { start: h.t, end: h.t + h.dur, blasts: [] }; out.push(cur); }
    cur.blasts.push(h); cur.end = h.t + h.dur;
  }
  return out.map(b => ({ t: b.start, shorts: b.blasts.filter(x => x.dur < 1.8).length, prolonged: b.blasts.filter(x => x.dur >= 3.5 && x.dur <= 7.5).length, n: b.blasts.length }));
}
function inNoWake(p) { return !!noWakeZoneAt(p.x, p.z); }

export function dockGrade(G, R, opts = {}) {
  const p = G.player, M = R.M;
  const items = [];
  items.push(item('Fenders out before the final approach', M.fendersBeforeApproach ? 10 : 0, 10, 'Fenders go out BEFORE you enter the marina — on the dock side, and on both sides when rafting or crowded.'));
  items.push(item(`No-wake speed in the marina/cove (max ${M.maxNWkn.toFixed(1)} kn)`, M.maxNWkn <= 5.5 ? 15 : M.maxNWkn <= 7 ? 7 : 0, 15, 'Docking speed is "no faster than you\'re willing to hit the dock". Inside the zone: 5 kn max, and slower close in.'));
  const imp = M.maxDockImpact;
  items.push(item(`Gentle contact (hardest touch ${(imp / KN).toFixed(2)} kn)`, imp <= 0.26 ? 25 : imp <= 0.5 ? 12 : 0, 25, 'Arrive at a slow walk (≤ 0.5 kn) and let the fenders kiss the dock. Use short bursts in gear then neutral.'));
  items.push(item('No contact with other boats', M.boatHits ? 0 : 15, 15, 'Hitting someone else\'s boat is the classic crowded-dock mistake — wind and current set you onto them.'));
  const zoneOK = R.S.tiedInZone;
  items.push(item(zoneOK ? 'Secured lines in the target spot' : p.tied ? 'Tied up — but not in the target spot' : 'Not tied up', zoneOK ? 25 : p.tied ? 10 : 0, 25, 'Lines: bow, stern and at least one spring. Press L once you are alongside and stopped.'));
  items.push(item(`Time (${Math.round(R.t)} s)`, R.t <= (opts.fast || 240) ? 10 : R.t <= (opts.ok || 420) ? 5 : 0, 10));
  return items;
}

// ---------------------------------------------------------------- scenario definitions
export const SCENARIOS = [
  // ============================================================ RULES OF THE ROAD
  {
    id: 'headon', cat: 'Rules of the Road', title: 'Head-on off the city front',
    where: 'North of Pier 45, heading west toward the Golden Gate', env: { clock: 12.5, tide: 'flood', traffic: 'light' },
    brief: 'You\'re running west along the city front at 18 kn. A powerboat is coming straight at you on a reciprocal course.',
    quiz: {
      q: 'A powerboat is approaching dead ahead on a reciprocal course (you see both sides of it). What do you do?',
      a: ['Hold course and speed — you were here first', 'Both vessels alter course to STARBOARD and pass port-to-port', 'Turn to port and pass starboard-to-starboard', 'Speed up to get past quickly'],
      correct: 1, explain: 'Rule 14: in a head-on situation NEITHER vessel is stand-on. Both turn to starboard (right) so you pass port-to-port. Make the turn early and big enough that the other boat sees it. Inland signal: 1 short blast.',
    },
    setup(G, R) {
      G.placePlayer(37.8125, -122.4180, 270, 18);
      const p = G.player, f = dir(270), r = dir(0);
      const t = scripted('power', { x: p.x + f.x * 1050 + r.x * 12, z: p.z + f.z * 1050 + r.z * 12, h: 90 * D2R, speed: 20 * KN }, { len: 11, style: 'sport', name: 'Oncoming powerboat' });
      t.script = (v) => { if (!v.acted && Math.hypot(v.x - p.x, v.z - p.z) < 420) { v.acted = true; v.desH += 30 * D2R; } };
      R.S.t = t; R.track(t);
    },
    done(G, R) { const T = R.T[0]; return (T.passed && T.range > 250) || R.t > 95; },
    grade(G, R) {
      const T = R.T[0], A = R.A;
      const turnedStbd = A.maxStbd >= 15 && A.stbdRange > 250;
      return [
        item(`Altered to starboard (max ${Math.round(A.maxStbd)}°)`, turnedStbd ? 30 : A.maxStbd >= 15 ? 15 : 0, 30, 'Both vessels turn right in a head-on situation.'),
        item('Never turned to port toward it', A.maxPort > 10 ? 0 : 20, 20, 'A left turn in a head-on meeting is how collisions happen — the other boat is turning right into you.'),
        item(`Passing distance (CPA ${Math.round(T.minRange)} m)`, T.minRange >= 50 ? 25 : T.minRange >= 30 ? 15 : 0, 25),
        item('Early action (began > 400 m away)', A.stbdRange > 400 ? 15 : A.stbdRange > 250 ? 7 : 0, 15, 'Rule 16: take early and substantial action.'),
        item('Sounded 1 short blast (Inland signal, bonus)', bursts(R.M.horns).some(b => b.shorts === 1) ? 10 : 0, 10, 'One short = "I intend to leave you on my port side".'),
      ];
    },
  },
  {
    id: 'crossstbd', cat: 'Rules of the Road', title: 'Crossing: boat on your starboard bow',
    where: 'Central Bay between Alcatraz and Angel Island', env: { clock: 13, tide: 'ebb', traffic: 'light' },
    brief: 'You\'re heading north toward Angel Island at 20 kn. A powerboat is crossing from your right. Its bearing isn\'t changing.',
    quiz: {
      q: 'A powerboat is on your STARBOARD bow and its compass bearing is steady. You are…',
      a: ['Stand-on: hold course and speed', 'Give-way: turn to starboard and/or slow down, and pass astern of it', 'Give-way: speed up and cross ahead of it', 'Give-way: turn to port to cross ahead'],
      correct: 1, explain: 'Rule 15: when two power vessels cross, the one that has the other on its STARBOARD side gives way and should avoid crossing ahead. Steady bearing + closing range = collision course. Turn right (show it your port side) and pass behind it, or slow/stop. Make it obvious.',
    },
    setup(G, R) {
      G.placePlayer(37.8380, -122.4300, 0, 20);
      const s = collisionStart(G.player, 20, 55, 270, 22);
      const t = scripted('power', s, { len: 12, style: 'cruiser', name: 'Crossing cruiser' });
      R.S.t = t; R.track(t);
    },
    done(G, R) { const T = R.T[0]; return (T.passed && T.range > 200) || R.t > 90; },
    grade(G, R) {
      const T = R.T[0], A = R.A;
      return [
        item(T.crossAhead !== null && T.crossAhead < 600 ? `Crossed AHEAD of it (${Math.round(T.crossAhead)} m ahead)` : 'Passed astern of the stand-on vessel', T.crossAhead !== null && T.crossAhead < 600 ? 0 : 35, 35, 'The give-way vessel should avoid crossing ahead (Rule 15).'),
        item(`Passing distance (CPA ${Math.round(T.minRange)} m)`, T.minRange >= 60 ? 25 : T.minRange >= 30 ? 12 : 0, 25),
        item('Early action (> 350 m)', A.firstActionRange > 350 ? 15 : A.firstActionRange > 200 ? 7 : 0, 15, 'Rule 16: early and substantial.'),
        item('Substantial action (≥ 25° turn or ≥ 50% slower)', A.maxStbd >= 25 || A.minSpeedRatio <= 0.5 ? 15 : 0, 15, 'Small course changes aren\'t visible to the other skipper.'),
        item('Did not turn to port', A.maxPort > 10 ? 0 : 10, 10, 'Turning left toward a vessel on your right just keeps you on a collision course.'),
      ];
    },
  },
  {
    id: 'crossportfail', cat: 'Rules of the Road', title: 'Stand-on… but they aren\'t giving way',
    where: 'Approaching Raccoon Strait from the south', env: { clock: 14, tide: 'flood', traffic: 'light' },
    brief: 'Heading NW at 18 kn. A boat is crossing from your LEFT. Its skipper appears to be on their phone.',
    quiz: {
      q: 'A powerboat is crossing from your PORT side on a collision course. What is your role and what do you do?',
      a: ['Give-way: turn to starboard now', 'Stand-on: hold course & speed; if it doesn\'t act, sound 5+ short blasts and maneuver to avoid — but not by turning to port', 'Stand-on: hold course and speed no matter what — it\'s their job', 'Turn to port toward its stern'],
      correct: 1, explain: 'Rule 17: the stand-on vessel keeps course and speed (17a). But you MAY act once it\'s apparent the give-way vessel isn\'t acting (17b), and you MUST act when collision can\'t be avoided by the give-way alone (17c) — and you should avoid turning to port for a vessel on your port side. Rule 34(d): 5 short blasts = "I doubt your intentions".',
    },
    setup(G, R) {
      G.placePlayer(37.8400, -122.4300, 315, 18);
      const s = collisionStart(G.player, 18, 55, 45, 20);
      const t = scripted('power', s, { len: 9, style: 'cc', name: 'Distracted skipper' });
      R.S.t = t; R.track(t);
    },
    done(G, R) { const T = R.T[0]; return (T.passed && T.range > 200) || R.t > 90 || R.M.collision; },
    grade(G, R) {
      const T = R.T[0], A = R.A, B = bursts(R.M.horns);
      const danger = B.some(b => b.shorts >= 4);
      return [
        item('Held course & speed while it was still far (> 350 m)', A.heldEarly ? 30 : 10, 30, 'Stand-on means predictable: don\'t make moves the give-way vessel can\'t anticipate.'),
        item('Sounded the danger signal (5+ short blasts)', danger ? 20 : 0, 20, 'Hold H briefly 5 times quickly. Tells them "I don\'t understand what you\'re doing".'),
        item('Took avoiding action when it failed to act', A.lateAction ? 20 : 0, 20, 'Slow/stop or turn to starboard once it\'s clear they aren\'t acting (Rule 17b/c).'),
        item('Did not turn to port toward it', A.maxPort > 12 ? 0 : 15, 15, 'Rule 17(c).'),
        item(R.M.collision ? 'COLLISION' : `No collision (CPA ${Math.round(T.minRange)} m)`, R.M.collision ? 0 : T.minRange >= 30 ? 15 : 8, 15),
      ];
    },
  },
  {
    id: 'crossportok', cat: 'Rules of the Road', title: 'Stand-on: let them give way',
    where: 'East of the Embarcadero piers, heading toward Pier 39', env: { clock: 12, tide: 'ebb', traffic: 'light' },
    brief: 'You\'re heading NW at 15 kn. A cruiser is crossing from your port side. This time the other skipper knows the rules.',
    quiz: {
      q: 'The crossing boat is on your PORT side. What\'s your job?',
      a: ['Slow down and let it pass ahead', 'Maintain course and speed so it can predict you', 'Turn to starboard early', 'Sound 3 short blasts'],
      correct: 1, explain: 'Rule 17(a)(i): the stand-on vessel shall keep her course and speed. Being predictable is what lets the give-way vessel solve the problem. Changing course or slowing can make it worse.',
    },
    setup(G, R) {
      G.placePlayer(37.8060, -122.3870, 330, 15);
      const s = collisionStart(G.player, 15, 55, 60, 18);
      const t = scripted('power', s, { len: 12, style: 'cruiser', name: 'Courteous cruiser' });
      t.script = (v) => { if (!v.acted && Math.hypot(v.x - G.player.x, v.z - G.player.z) < 430) { v.acted = true; v.desH += 55 * D2R; v.targetSpeed *= 0.6; } };
      R.S.t = t; R.track(t);
    },
    done(G, R) { const T = R.T[0]; return (T.passed && T.range > 200) || R.t > 90; },
    grade(G, R) {
      const T = R.T[0], A = R.A;
      return [
        item(`Held course (max deviation ${Math.round(Math.max(A.maxStbd, A.maxPort))}°)`, Math.max(A.maxStbd, A.maxPort) <= 10 ? 40 : Math.max(A.maxStbd, A.maxPort) <= 20 ? 20 : 0, 40),
        item(`Held speed (min ${Math.round(A.minSpeedRatio * 100)}% of start)`, A.minSpeedRatio >= 0.75 ? 30 : A.minSpeedRatio >= 0.5 ? 15 : 0, 30),
        item(`Safe pass (CPA ${Math.round(T.minRange)} m)`, T.minRange >= 40 ? 30 : 10, 30),
      ];
    },
  },
  {
    id: 'overtake', cat: 'Rules of the Road', title: 'Overtaking a trawler in Raccoon Strait',
    where: 'Raccoon Strait, between Angel Island and Tiburon', env: { clock: 13.5, tide: 'flood', traffic: 'light' },
    brief: 'You\'re running up Raccoon Strait at 20 kn and closing on a slow trawler. The strait is narrow and current is strong.',
    quiz: {
      q: 'You\'re coming up from behind a slow trawler. Who must keep clear?',
      a: ['The trawler must move over for you', 'You — the overtaking vessel keeps clear until well past and clear', 'Whoever is to the right', 'Nobody, it\'s open water'],
      correct: 1, explain: 'Rule 13: any vessel overtaking another keeps out of its way until finally past and clear — this overrides every other rule, even sail-vs-power. Pass with room, mind your wake, and don\'t cut back across its bow. Inland: 1 short = passing on its starboard side, 2 short = on its port side, and wait for the same reply.',
    },
    setup(G, R) {
      G.placePlayer(37.8580, -122.4535, 25, 20);
      const p = G.player, f = dir(25), r = dir(115);
      const t = scripted('fishing', { x: p.x + f.x * 420 + r.x * 6, z: p.z + f.z * 420 + r.z * 6, h: 25 * D2R, speed: 7 * KN }, { len: 13, name: 'Slow trawler', cat: 'power' });
      R.S.t = t; R.track(t);
    },
    done(G, R) { const T = R.T[0]; return (T.along > 160) || R.t > 130 || R.M.collision; },
    grade(G, R) {
      const T = R.T[0];
      const sig = bursts(R.M.horns).some(b => b.shorts === 1 || b.shorts === 2);
      return [
        item(`Passing distance (CPA ${Math.round(T.minRange)} m)`, T.minRange >= 30 ? 35 : T.minRange >= 18 ? 18 : 0, 35, 'Give it room: in a strait with current, a boat being passed can be set toward you.'),
        item('Did not cut across its bow after passing', T.cutBow ? 0 : 25, 25, '"Past and clear" means far enough ahead that it doesn\'t have to change anything.'),
        item('Wake courtesy (slow when close, or passed wide)', T.minRange >= 60 || T.closeSpeedMax <= 12 * KN ? 15 : 0, 15, 'Your wake is your responsibility.'),
        item('Overtaking signal (1 or 2 short) — bonus', sig ? 10 : 0, 10),
        item(R.M.collision ? 'COLLISION' : 'No collision', R.M.collision ? 0 : 15, 15),
      ];
    },
  },
  {
    id: 'sailport', cat: 'Rules of the Road', title: 'Sailboat crossing from port',
    where: 'Off the St. Francis Yacht Club, heading east', env: { clock: 14, tide: 'flood', traffic: 'light' },
    brief: 'Running east along the city front at 18 kn. A sailboat under sail is crossing from your LEFT.',
    quiz: {
      q: 'A sailboat under sail is crossing from your PORT side. Who gives way?',
      a: ['The sailboat — it\'s on my port side so I\'m stand-on', 'I do — a power-driven vessel keeps out of the way of a sailing vessel', 'Neither — we both turn to starboard', 'The sailboat — slow vessels yield to fast ones'],
      correct: 1, explain: 'Rule 18: power gives way to sail regardless of which side it\'s on (exceptions: you\'re being overtaken by it, or it\'s impeding a vessel restricted to a channel). Sailboats can tack suddenly — pass well astern and slow so your wake doesn\'t knock the wind out of their sails.',
    },
    setup(G, R) {
      G.placePlayer(37.8150, -122.4450, 90, 18);
      const s = collisionStart(G.player, 18, 60, 160, 6);
      const t = scripted('sail', s, { len: 10, name: 'Sailboat (starboard tack)' });
      t.script = (v) => { v.twa = 95 * D2R; v.windKn = 15; };
      R.S.t = t; R.track(t);
    },
    done(G, R) { const T = R.T[0]; return (T.passed && T.range > 200) || R.t > 95; },
    grade(G, R) {
      const T = R.T[0], A = R.A;
      return [
        item(T.crossAhead !== null && T.crossAhead < 400 ? 'Crossed ahead of the sailboat' : 'Passed astern of the sailboat', T.crossAhead !== null && T.crossAhead < 400 ? 0 : 35, 35),
        item(`Passing distance (CPA ${Math.round(T.minRange)} m)`, T.minRange >= 50 ? 25 : T.minRange >= 25 ? 12 : 0, 25),
        item('Wake courtesy near the sailboat', T.minRange >= 80 || T.closeSpeedMax <= 15 * KN ? 15 : 0, 15),
        item('Early action (> 300 m)', A.firstActionRange > 300 ? 15 : A.firstActionRange > 150 ? 7 : 0, 15),
        item('No collision', R.M.collision ? 0 : 10, 10),
      ];
    },
  },
  // ============================================================ BIG SHIPS
  {
    id: 'shipbridge', cat: 'Big Ships', title: 'Container ship under the Bay Bridge',
    where: 'South of the Bay Bridge west span, near Pier 40', env: { clock: 11, tide: 'ebb', traffic: 'light' },
    brief: 'You just left Pier 40 and are heading north at 20 kn for the bridge span nearest Yerba Buena Island — the same span outbound ships use.',
    quiz: {
      q: 'A 300 m container ship is outbound from Oakland, heading for the same bridge span you\'re aiming at. Best action?',
      a: ['Speed up and cross ahead — you\'re much faster', 'Hold course: it\'s on your starboard side so it must give way to you', 'Slow down or turn away now, let it pass, and cross well astern — don\'t impede it', 'Call it on VHF 16 and ask it to slow down'],
      correct: 2, explain: 'Rule 9: you shall not impede a vessel that can only navigate safely within a channel. The crossing rules don\'t give you priority over a ship confined to the channel. Ships at 12 kn need a mile+ to stop, and the bridge has a blind zone under its bow up to 1/4–1/2 nm. Listen on VHF 13/14 — ships announce themselves.',
    },
    setup(G, R) {
      G.placePlayer(37.7975, -122.3730, 0, 20);
      const lane = SHIP_LANES[0].xz.map(([x, z]) => ({ x, z })).reverse(); // outbound
      const p = G.player;
      // find where the player's northbound track crosses the lane
      let cross = null, ci = 0;
      for (let i = 0; i + 1 < lane.length; i++) {
        const a = lane[i], b = lane[i + 1];
        if ((a.x - p.x) * (b.x - p.x) <= 0) { const t = (p.x - a.x) / (b.x - a.x); cross = { x: p.x, z: a.z + (b.z - a.z) * t }; ci = i; break; }
      }
      const tP = Math.abs(cross.z - p.z) / (20 * KN);
      let back = 12 * KN * (tP + 22);
      let k = ci, pos = { ...cross };
      while (back > 0 && k >= 0) { const a = lane[k], d = Math.hypot(pos.x - a.x, pos.z - a.z); if (d >= back) { const t = back / d; pos = { x: pos.x + (a.x - pos.x) * t, z: pos.z + (a.z - pos.z) * t }; back = 0; } else { back -= d; pos = { ...a }; k--; } }
      const nxt = lane[ci + 1];
      const h = Math.atan2(cross.x - pos.x, -(cross.z - pos.z));
      const ship = scripted('ship', { x: pos.x, z: pos.z, h, speed: 12 * KN }, { len: 300, beam: 45, cat: 'ship', name: 'ORIENT HARMONY', turnRate: 0.03, accel: 0.05 });
      ship.path = [cross, ...lane.slice(ci + 1)]; ship.wp = 0;
      ship.script = (v, dt) => {
        if (v.wp < v.path.length) { const t = v.path[v.wp]; if (Math.hypot(t.x - v.x, t.z - v.z) < 120) v.wp++; else v.desH = Math.atan2(t.x - v.x, -(t.z - v.z)); }
        const c = cpa(v.x, v.z, v.vx, v.vz, p.x, p.z, p.vx, p.vz);
        if (!v.honked && c.tcpa > 0 && c.tcpa < 150 && c.dcpa < 220 && Math.abs(relBearing(v.x, v.z, v.h, p.x, p.z)) < 60) { v.honked = true; G.hornFrom(v, 'danger'); G.say(13, v.name, 'Small motor vessel off my bow, this is the container ship ORIENT HARMONY outbound under the Bay Bridge. I am restricted to the channel — alter course and keep clear!'); R.M.shipHonkT = R.t; }
      };
      G.say(14, 'ORIENT HARMONY', 'San Francisco Traffic, ORIENT HARMONY departing Oakland Outer Harbor, outbound, passing under the Bay Bridge west span east of the center anchorage. Pilot aboard.');
      R.S.t = ship; R.track(ship);
    },
    done(G, R) { const T = R.T[0]; return (T.passed && T.range > 350) || R.t > 160 || R.M.collision; },
    grade(G, R) {
      const T = R.T[0], A = R.A;
      const aheadBad = T.crossAhead !== null && T.crossAhead < 1000;
      return [
        item(aheadBad ? `Crossed ahead of the ship at only ${Math.round(T.crossAhead)} m` : 'Did not cross ahead of the ship', aheadBad ? 0 : 40, 40, 'Rule of thumb: never cross a ship\'s bow inside 1 nm (1850 m).'),
        item(`Closest approach ${Math.round(T.minRange)} m`, T.minRange >= 250 ? 25 : T.minRange >= 150 ? 12 : 0, 25),
        item('Acted before the ship had to sound the danger signal', R.M.shipHonkT == null || A.firstActionT < R.M.shipHonkT ? 20 : 0, 20, 'Five short blasts from a ship means YOU are the problem.'),
        item(R.M.collision ? 'COLLISION' : 'No collision', R.M.collision ? 0 : 15, 15),
      ];
    },
  },
  {
    id: 'gatecross', cat: 'Big Ships', title: 'Crossing the lane at the Golden Gate (ebb chop)',
    where: 'Under the Golden Gate Bridge, north side', env: { clock: 15.5, tide: 'maxebb', wind: 20, traffic: 'light' },
    brief: 'You\'re heading south from Horseshoe Cove to the city side. A ship is inbound under the bridge. Max ebb against a 20 kn westerly = steep, short chop.',
    quiz: {
      q: 'How should you cross a shipping lane with a ship inbound?',
      a: ['At a shallow angle so you can keep an eye on the ship', 'At right angles, as directly as safely possible, astern of the ship', 'Wait in the middle of the lane for the ship to pass', 'Run alongside the ship inside the lane'],
      correct: 1, explain: 'Rule 10(c) (traffic separation): cross on a heading as nearly as practicable at right angles to the lane — minimum time in the lane and an obvious aspect to the ship. Cross astern. In wind-against-tide chop, slow down and take the waves at an angle to avoid slamming.',
    },
    setup(G, R) {
      G.placePlayer(37.8255, -122.4700, 190, 18);
      const lane = SHIP_LANES[0].xz.map(([x, z]) => ({ x, z }));
      const p = G.player;
      const a = lane[0], b = lane[1];
      const tP = 95;
      const cross = (() => { const t = (p.x - a.x) / (b.x - a.x); return { x: p.x, z: a.z + (b.z - a.z) * t }; })();
      const L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const back = 14 * KN * (tP + 12);
      const s = { x: cross.x - ux * back, z: cross.z - uz * back, h: Math.atan2(ux, -uz), speed: 14 * KN };
      const ship = scripted('ship', s, { len: 290, beam: 44, cat: 'ship', name: 'PACIFIC MERIDIAN', turnRate: 0.03, accel: 0.05 });
      ship.path = lane.slice(1); ship.wp = 0;
      ship.script = (v) => {
        if (v.wp < v.path.length) { const t = v.path[v.wp]; if (Math.hypot(t.x - v.x, t.z - v.z) < 120) v.wp++; else v.desH = Math.atan2(t.x - v.x, -(t.z - v.z)); }
        const c = cpa(v.x, v.z, v.vx, v.vz, p.x, p.z, p.vx, p.vz);
        if (!v.honked && c.tcpa > 0 && c.tcpa < 150 && c.dcpa < 250 && Math.abs(relBearing(v.x, v.z, v.h, p.x, p.z)) < 60) { v.honked = true; G.hornFrom(v, 'danger'); R.M.shipHonkT = R.t; }
      };
      G.say(14, 'PACIFIC MERIDIAN', 'San Francisco Traffic, PACIFIC MERIDIAN inbound at the Golden Gate Bridge, bound Oakland, one-four knots.');
      R.S.t = ship; R.track(ship); R.S.lane = lane; R.S.laneH = Math.atan2(ux, -uz) / D2R; R.S.inLaneT = 0; R.S.badAngleT = 0; R.S.laneTime = 0;
    },
    tick(G, R, dt) {
      const p = G.player, S = R.S;
      const ln = SHIP_LANES[0];
      const inLane = !!(function () { let best = 1e9; for (let i = 0; i + 1 < ln.xz.length; i++) { const [ax, az] = ln.xz[i], [bx, bz] = ln.xz[i + 1]; const dx = bx - ax, dz = bz - az; let t = ((p.x - ax) * dx + (p.z - az) * dz) / (dx * dx + dz * dz); t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(ax + dx * t - p.x, az + dz * t - p.z)); } return best < 250; })();
      if (inLane) { S.laneTime += dt; const rel = Math.abs(angDiff(p.headingDeg, S.laneH)); const perp = Math.abs(90 - Math.min(rel, 180 - rel)); if (perp > 30) S.badAngleT += dt; }
      S.inLane = inLane;
    },
    done(G, R) { const T = R.T[0]; return (T.passed && T.range > 400 && !R.S.inLane) || R.t > 210 || R.M.collision; },
    grade(G, R) {
      const T = R.T[0], S = R.S;
      const aheadBad = T.crossAhead !== null && T.crossAhead < 1200;
      return [
        item(`Crossed near right angles (${Math.round(S.badAngleT)} s at a shallow angle)`, S.badAngleT < 8 ? 25 : S.badAngleT < 20 ? 12 : 0, 25),
        item(aheadBad ? `Crossed ahead of the ship (${Math.round(T.crossAhead)} m)` : 'Crossed astern of the ship', aheadBad ? 0 : 30, 30),
        item(`Time in the lane (${Math.round(S.laneTime)} s)`, S.laneTime < 90 ? 15 : S.laneTime < 150 ? 7 : 0, 15),
        item(`Closest approach (${Math.round(T.minRange)} m)`, T.minRange >= 300 ? 15 : T.minRange >= 180 ? 7 : 0, 15),
        item(`Handled the chop (${R.M.slams} slams)`, R.M.slams <= 3 ? 15 : R.M.slams <= 7 ? 7 : 0, 15, 'Throttle back in steep chop and quarter the waves.'),
      ];
    },
  },
  {
    id: 'ferryback', cat: 'Big Ships', title: 'Ferry backing out at Sausalito',
    where: 'Sausalito waterfront', env: { clock: 12, tide: 'flood', traffic: 'light' },
    brief: 'You\'re idling up the Sausalito waterfront toward the guest dock. A Golden Gate ferry is at the landing ahead.',
    quiz: {
      q: 'The ferry at the landing sounds ONE PROLONGED blast followed by THREE SHORT blasts. What does it mean?',
      a: ['Danger — get out of the way', 'It is leaving the dock, and it is operating astern propulsion (backing)', 'It intends to turn to starboard', 'It\'s a fog signal'],
      correct: 1, explain: 'Rule 34(g): one prolonged blast = vessel leaving a dock or berth. Rule 34(a): three short = "my engines are going astern". A ferry backing out has limited maneuverability and limited visibility astern — stop and give it room until it\'s clearly underway.',
    },
    setup(G, R) {
      G.placePlayer(37.8538, -122.4745, 335, 5);
      const b = (() => { const p = ll(37.8562, -122.4772), t = 75 * D2R; return { x: p.x + Math.sin(t) * 60, z: p.z - Math.cos(t) * 60 }; })();
      const f = makeScripted('ferry', { x: b.x, z: b.z, h: 255 * D2R, desH: 255 * D2R, speed: 0, targetSpeed: 0, len: 40, beam: 12, livery: 'gg', cat: 'ferry', name: 'GG Ferry MENDOCINO', manual: true });
      f.highlight = true;
      f.script = (v, dt) => {
        v.st = (v.st || 0) + dt;
        const back = dir(75);
        if (v.st > 8 && !v.h1) { v.h1 = true; G.hornFrom(v, 'prolonged'); setTimeout(() => G.hornFrom(v, 'back'), 5500); }
        if (v.st > 14 && v.st < 40) { v.vx = back.x * 1.6; v.vz = back.z * 1.6; v.h += (165 * D2R - v.h) * 0.0; R.S.backing = true; }
        else if (v.st >= 40 && v.st < 60) { v.vx *= 0.97; v.vz *= 0.97; v.h += Math.max(-0.12 * dt, Math.min(0.12 * dt, Math.atan2(Math.sin(150 * D2R - v.h), Math.cos(150 * D2R - v.h)))); R.S.backing = true; }
        else if (v.st >= 60) { R.S.backing = false; v.spd = Math.min(12, (v.spd || 0) + dt * 0.6); const fw = dir(v.h / D2R); v.vx = fw.x * v.spd; v.vz = fw.z * v.spd; v.h += Math.max(-0.08 * dt, Math.min(0.08 * dt, Math.atan2(Math.sin(150 * D2R - v.h), Math.cos(150 * D2R - v.h)))); }
        else { v.vx = 0; v.vz = 0; }
        v.x += v.vx * dt; v.z += v.vz * dt; v.speed = Math.hypot(v.vx, v.vz);
      };
      R.S.t = f; R.track(f);
    },
    tick(G, R, dt) { if (R.S.backing && R.T[0].range < 350 && G.player.sogKn < 1.5) R.S.waited = true; },
    done(G, R) { return R.t > 100 || R.M.collision; },
    grade(G, R) {
      const T = R.T[0];
      return [
        item(`No-wake speed in Sausalito (max ${R.M.maxNWkn.toFixed(1)} kn)`, R.M.maxNWkn <= 5.5 ? 20 : 0, 20),
        item('Stopped/held position while the ferry backed out', R.S.waited ? 30 : 0, 30, 'A vessel backing out has right to expect you to wait. Hold station with short bursts in and out of gear.'),
        item(`Gave it room (closest ${Math.round(T.minRange)} m)`, T.minRange >= 80 ? 30 : T.minRange >= 40 ? 15 : 0, 30),
        item('Did not cross its bow', T.crossAhead !== null && T.crossAhead < 200 ? 0 : 20, 20),
      ];
    },
  },
  {
    id: 'ferryovertake', cat: 'Big Ships', title: 'Fast ferry overtaking you',
    where: 'Off Pier 39, heading toward the Ferry Building', env: { clock: 13, tide: 'ebb', wind: 14, traffic: 'light' },
    brief: 'You\'re cruising SE at 12 kn. A 30-knot catamaran ferry is coming up fast from behind.',
    quiz: {
      q: 'A fast ferry is overtaking you from astern. Who is the stand-on vessel?',
      a: ['The ferry — commercial vessels always have right of way', 'You — the overtaking vessel keeps clear; hold your course and speed', 'Neither — you both alter to starboard', 'You must immediately turn out of its way'],
      correct: 1, explain: 'Rule 13: the overtaking vessel keeps clear, even a ferry. Your job is to be predictable: hold course & speed. Then deal with its wake: slow down and turn to take the wake at an angle (not beam-on, not head-on at speed).',
    },
    setup(G, R) {
      G.placePlayer(37.8180, -122.4080, 130, 12);
      const p = G.player, f = dir(130), l = dir(40);
      const ferry = scripted('ferry', { x: p.x - f.x * 750 + l.x * 58, z: p.z - f.z * 750 + l.z * 58, h: 130 * D2R, speed: 30 * KN }, { len: 40, beam: 12, livery: 'gg', cat: 'ferry', name: 'GG Ferry NAPA' });
      R.S.t = ferry; R.track(ferry);
    },
    tick(G, R, dt) {
      const T = R.T[0], p = G.player;
      if (!R.S.passedT && T.along < -20) R.S.passedT = R.t; // player is astern of the ferry now
      if (T.range < 400 && !R.S.passedT) { R.S.devMax = Math.max(R.S.devMax || 0, Math.abs(angDiff(p.headingDeg, 130))); if (angDiff(p.headingDeg, 130) < -15) R.S.turnedPort = true; }
      if (R.S.passedT && R.t - R.S.passedT < 30) { if (p.sogKn <= 8 || Math.abs(angDiff(p.headingDeg, 130)) >= 20) R.S.wakeOK = true; }
    },
    done(G, R) { return (R.S.passedT && R.t - R.S.passedT > 30) || R.t > 110 || R.M.collision; },
    grade(G, R) {
      return [
        item(`Held course while being overtaken (max ${Math.round(R.S.devMax || 0)}°)`, (R.S.devMax || 0) <= 12 ? 40 : (R.S.devMax || 0) <= 25 ? 20 : 0, 40),
        item('No turn across its path', R.S.turnedPort ? 0 : 30, 30),
        item('Took the wake well (slowed or quartered it)', R.S.wakeOK ? 20 : 0, 20, `Wake hits taken: ${R.M.wakeHits}.`),
        item('No collision', R.M.collision ? 0 : 10, 10),
      ];
    },
  },
  {
    id: 'tow', cat: 'Big Ships', title: 'Tug with a long tow',
    where: 'Central Bay, west of Treasure Island', env: { clock: 12, tide: 'flood', traffic: 'light' },
    brief: 'Heading east at 16 kn. A tug is crossing ahead from right to left. Several hundred yards behind it there\'s a barge.',
    quiz: {
      q: 'A tug is crossing your bow and a barge is following a few hundred yards behind it. What\'s the danger?',
      a: ['None — there\'s plenty of room between them', 'It\'s towing on a long hawser: NEVER pass between a tug and its tow', 'The barge has broken loose', 'You should pass ahead of the tug'],
      correct: 1, explain: 'A towline can be 1,000+ ft long and sag underwater — invisible until it isn\'t. A tug with tow is "restricted in ability to maneuver". By day a tow over 200 m shows a diamond shape; by night 3 white masthead lights in a vertical line + yellow towing light. Pass well astern of the barge.',
    },
    setup(G, R) {
      G.placePlayer(37.8300, -122.3950, 90, 16);
      const p = G.player, f = dir(90);
      const xc = p.x + f.x * 650, zc = p.z;
      const start = { x: xc, z: zc + 160 };
      const path = [{ x: xc, z: zc - 3000 }];
      const tug = spawnTow(start, [start, ...path]);
      tug.highlight = true; tug.towing.highlight = true; tug.towing.x = xc; tug.towing.z = start.z + 260;
      tug.trail = []; for (let i = 0; i < 60; i++) tug.trail.push({ x: xc, z: start.z + 260 - i * 4.4 });
      R.S.tug = tug; R.S.barge = tug.towing; R.S.xc = xc;
      R.track(tug); R.track(tug.towing);
    },
    tick(G, R) {
      const p = G.player, S = R.S;
      if (S.prev) {
        // did the player cross the hawser segment (tug stern -> barge bow)?
        const a = { x: S.tug.x, z: S.tug.z + 15 }, b = { x: S.barge.x, z: S.barge.z - 42 };
        const cr = (o, q, r) => (q.x - o.x) * (r.z - o.z) - (q.z - o.z) * (r.x - o.x);
        const p1 = S.prev, p2 = { x: p.x, z: p.z };
        if (cr(a, b, p1) * cr(a, b, p2) < 0 && cr(p1, p2, a) * cr(p1, p2, b) < 0) S.between = true;
        if ((p1.x - S.xc) * (p2.x - S.xc) <= 0 && S.crossZ == null) S.crossZ = p.z;
      }
      S.prev = { x: p.x, z: p.z };
    },
    done(G, R) { return (G.player.x > R.S.xc + 150) || R.t > 160 || R.M.collision; },
    grade(G, R) {
      const S = R.S, T1 = R.T[0], T2 = R.T[1];
      const astern = S.crossZ != null && S.crossZ > S.barge.z + 42 + 100;
      return [
        item(S.between ? 'PASSED BETWEEN TUG AND TOW' : 'Never passed between tug and tow', S.between ? 0 : 50, 50),
        item(astern ? 'Passed well astern of the barge' : S.crossZ != null && S.crossZ < S.tug.z - 200 ? 'Crossed ahead of the tug' : 'Did not pass well astern of the barge', astern ? 25 : S.crossZ != null && S.crossZ < S.tug.z - 200 ? 10 : 0, 25),
        item(`Distance to tug ${Math.round(T1.minRange)} m, barge ${Math.round(T2.minRange)} m`, Math.min(T1.minRange, T2.minRange) >= 80 ? 15 : 5, 15),
        item('No collision', R.M.collision ? 0 : 10, 10),
      ];
    },
  },
  // ============================================================ SEAMANSHIP
  {
    id: 'fog', cat: 'Seamanship', title: 'Fog rolls in at the Golden Gate',
    where: 'Just west of the Golden Gate Bridge, inbound', env: { clock: 16.5, tide: 'flood', wind: 14, traffic: 'light' },
    brief: 'You\'re coming in under the bridge at 20 kn. The fog bank that\'s been sitting outside is about to swallow you.',
    quiz: {
      q: 'Visibility suddenly drops to ~250 m. What do the rules require of you (power vessel making way)?',
      a: ['Keep speed up to get out of the fog quickly', 'Proceed at a safe speed and sound ONE PROLONGED blast at intervals of not more than 2 minutes', 'Sound five short blasts every minute', 'Stop and anchor in the channel'],
      correct: 1, explain: 'Rule 19: safe speed for the conditions (be able to stop within the distance you can see — at 250 m that\'s single-digit knots). Rule 35(a): power vessel making way: 1 prolonged blast at ≤ 2-minute intervals. Listen for others; the Golden Gate Bridge has its own fog signals. Turn on nav lights; post a lookout; use radar/AIS if you have it.',
    },
    setup(G, R) {
      G.placePlayer(37.8185, -122.4950, 85, 20);
      R.S.fogT = 12;
      const p = G.player;
      const ship = scripted('ship', { x: p.x + 1600, z: p.z + 420, h: 262 * D2R, speed: 10 * KN }, { len: 260, beam: 40, cat: 'ship', name: 'NORDIC SPIRIT', turnRate: 0.03, accel: 0.05 });
      ship.script = (v) => { v.fogT = (v.fogT || 30) - 1 / 60; if (env.fog > 0.5 && (!v.lastH || R.t - v.lastH > 110)) { v.lastH = R.t; G.hornFrom(v, 'prolonged'); } };
      R.track(ship);
      R.S.ship = ship;
    },
    tick(G, R, dt) {
      const S = R.S, p = G.player;
      if (R.t > S.fogT && env.fog < 1) { env.fog = Math.min(1, env.fog + dt / 8); env.visibility = 20000 - env.fog * 19760; }
      if (env.fog > 0.9 && !S.fogOn) { S.fogOn = R.t; G.toast('Fog! Visibility ~250 m', 'warn'); }
      if (S.fogOn && !S.slowT && p.sogKn <= 8) S.slowT = R.t - S.fogOn;
      if (S.fogOn && !S.crosser && R.t - S.fogOn > 40) {
        const s = { x: p.x + dir(p.headingDeg + 55).x * 330, z: p.z + dir(p.headingDeg + 55).z * 330, h: ((p.headingDeg + 240) % 360) * D2R, speed: 12 * KN };
        S.crosser = scripted('power', s, { len: 10, style: 'cc', name: 'Boat in fog' });
        R.track(S.crosser);
      }
      if (S.fogOn && (!S.ghT || R.t - S.ghT > 20)) { S.ghT = R.t; G.hornDeep(2600); }
    },
    done(G, R) { return R.t > 200 || R.M.collision; },
    grade(G, R) {
      const S = R.S;
      const pro = R.M.horns.filter(h => h.dur >= 3.5 && h.dur <= 7.5 && S.fogOn && h.t >= S.fogOn - 2).map(h => h.t);
      let gapOK = pro.length > 0 && pro[0] - S.fogOn <= 60;
      const seq = [S.fogOn, ...pro, R.t];
      for (let i = 1; i < seq.length; i++) if (seq[i] - seq[i - 1] > 130) gapOK = false;
      const crossT = R.T.find(t => t.v === S.crosser);
      return [
        item(`Slowed to safe speed (≤ 8 kn) ${S.slowT != null ? `in ${Math.round(S.slowT)} s` : '— never'}`, S.slowT != null && S.slowT <= 30 ? 30 : S.slowT != null ? 12 : 0, 30),
        item(`Fog signal: prolonged blasts ≤ 2 min apart (${pro.length} sounded)`, gapOK ? 30 : pro.length ? 15 : 0, 30, 'Hold H for 4–6 seconds = one prolonged blast.'),
        item(`Avoided the boat that appeared out of the fog${crossT ? ` (CPA ${Math.round(crossT.minRange)} m)` : ''}`, !crossT || crossT.minRange >= 40 ? 20 : crossT.minRange >= 20 ? 10 : 0, 20),
        item('No collision or grounding', R.M.collision || R.M.groundings ? 0 : 20, 20),
      ];
    },
    cleanup() { env.fog = 0; env.visibility = 20000; },
  },
  {
    id: 'swimmers', cat: 'Seamanship', title: 'Swimmers & paddlers at Aquatic Park',
    where: 'Off the Municipal Pier, heading east to Pier 39', env: { clock: 10.5, tide: 'flood', traffic: 'light' },
    brief: 'You\'re heading east past Aquatic Park toward Pier 39. It\'s a Saturday morning — an open-water swim is finishing with kayak escorts.',
    quiz: {
      q: 'You see small orange floats bobbing in the water ahead near Aquatic Park. What are they?',
      a: ['Crab pot floats', 'Swimmers\' tow-buoys — there\'s a swimmer next to each one', 'Mooring balls', 'Race marks'],
      correct: 1, explain: 'Open-water swimmers tow bright buoys so boats can see them. Heads are nearly invisible in chop. Around Aquatic Park and the city front, slow to no-wake, post a lookout, and give swimmers and their escort kayaks a very wide berth.',
    },
    setup(G, R) {
      G.placePlayer(37.8122, -122.4310, 95, 10);
      R.S.sw = [];
      const c = P(37.8113, -122.4230);
      for (let i = 0; i < 9; i++) {
        const s = scripted('swimmer', { x: c.x + (Math.random() - 0.5) * 120, z: c.z + (Math.random() - 0.5) * 50, h: 95 * D2R, speed: 0.6 }, { len: 1.8, beam: 0.6, cat: 'small', human: true, name: 'Swimmer' });
        s.highlight = false; R.S.sw.push(s);
      }
      for (let i = 0; i < 2; i++) { const k = scripted('kayak', { x: c.x + (i ? 70 : -40), z: c.z - 25 + i * 40, h: 95 * D2R, speed: 0.8 }, { len: 4.5, beam: 0.8, cat: 'small', human: true, name: 'Escort kayak' }); k.highlight = false; R.S.sw.push(k); }
      R.S.target = P(37.8128, -122.4115);
      G.setZone({ x: R.S.target.x, z: R.S.target.z, h: 0, len: 120, w: 120 });
      R.S.minD = 1e9; R.S.fastNear = 0;
    },
    tick(G, R) {
      const p = G.player;
      for (const s of R.S.sw) { const d = Math.hypot(s.x - p.x, s.z - p.z); R.S.minD = Math.min(R.S.minD, d); if (d < 100) R.S.fastNear = Math.max(R.S.fastNear, p.sogKn); }
      const ap = NO_WAKE_ZONES.find(z => z.name.startsWith('Aquatic'));
      if (pointInPoly(p.x, p.z, ap.xz)) R.S.entered = true;
      if (Math.hypot(p.x - R.S.target.x, p.z - R.S.target.z) < 70) R.S.arrived = true;
    },
    done(G, R) { return R.S.arrived || R.t > 360 || R.M.collision; },
    grade(G, R) {
      const S = R.S;
      return [
        item(`Speed near swimmers (max ${S.fastNear.toFixed(1)} kn within 100 m)`, S.fastNear <= 5.5 ? 35 : S.fastNear <= 8 ? 15 : 0, 35),
        item(`Closest approach to a swimmer/paddler: ${Math.round(S.minD)} m`, S.minD >= 25 ? 35 : S.minD >= 12 ? 15 : 0, 35),
        item('Reached Pier 39', S.arrived ? 15 : 0, 15),
        item('Stayed out of the Aquatic Park swim area', S.entered ? 0 : 15, 15),
      ];
    },
  },
  {
    id: 'slot', cat: 'Seamanship', title: 'Wind against tide: Pier 39 → Sausalito',
    where: 'The Slot at max ebb', env: { clock: 15, tide: 'maxebb', wind: 22, traffic: 'typical' },
    brief: 'Run from Pier 39 to Sausalito across the Slot. 22 kn westerly vs. a max ebb — the steepest chop of the day.',
    quiz: {
      q: 'Why is the water so much rougher at max ebb on a windy afternoon?',
      a: ['The ebb current flows against the westerly wind, steepening and shortening the waves', 'Ships make more wake at ebb', 'The water is shallower at ebb so waves break', 'It isn\'t — it\'s the same as flood'],
      correct: 0, explain: 'When current opposes the wind the waves "stack up": same height in less wavelength = steep, square chop. In SF Bay that\'s the ebb against the afternoon westerly, worst near the Gate, Alcatraz and the Slot. Slow down, quarter the waves, and keep weight low. On flood the same wind gives a much gentler ride.',
    },
    setup(G, R) {
      G.placePlayer(37.8135, -122.4120, 300, 15);
      R.S.target = P(37.8530, -122.4710);
      G.setZone({ x: R.S.target.x, z: R.S.target.z, h: 0, len: 260, w: 260 });
      G.setDest(R.S.target);
    },
    tick(G, R) { if (Math.hypot(G.player.x - R.S.target.x, G.player.z - R.S.target.z) < 140) R.S.arrived = true; },
    done(G, R) { return R.S.arrived || R.t > 900 || R.M.collision; },
    grade(G, R) {
      return [
        item(`Arrived in ${Math.round(R.t / 60)} min`, R.S.arrived && R.t <= 720 ? 20 : R.S.arrived ? 10 : 0, 20),
        item(`Slams: ${R.M.slams}`, R.M.slams <= 4 ? 40 : R.M.slams <= 8 ? 20 : 0, 40, 'Each slam is your crew\'s spine. Trim speed until the boat rides, not pounds.'),
        item('No collision or grounding', R.M.collision || R.M.groundings ? 0 : 20, 20),
        item('Respected the Sausalito no-wake zone', R.M.maxNWkn <= 5.5 ? 20 : 0, 20),
      ];
    },
  },
  {
    id: 'race', cat: 'Seamanship', title: 'Through a racing fleet at the city front',
    where: 'Fort Mason to Crissy Field', env: { clock: 14, tide: 'flood', wind: 17, traffic: 'light' },
    brief: 'A Saturday race fleet is working the city front. Get from Fort Mason to Crissy Field without wrecking anyone\'s race (or your boat).',
    quiz: {
      q: 'A fleet of racing sailboats is ahead. What\'s the best plan?',
      a: ['Go full speed straight through — they\'ll get out of the way', 'Slow down, go around the fleet (or behind it), stay clear of marks and starting lines, minimize wake', 'Follow closely behind the lead boat', 'Sound 5 short blasts so they move'],
      correct: 1, explain: 'Racing sailboats under sail are stand-on to you (Rule 18) and will be tacking and gybing on short notice, often focused on each other. Detour around the course, stay clear of marks and the committee boat, and keep your wake small.',
    },
    setup(G, R) {
      G.placePlayer(37.8125, -122.4310, 270, 15);
      R.S.fleet = spawnFleetAt(37.8112, -122.4470, 14);
      R.S.target = P(37.8110, -122.4640);
      G.setZone({ x: R.S.target.x, z: R.S.target.z, h: 0, len: 200, w: 200 });
      R.S.minD = 1e9; R.S.fastNear = 0;
    },
    tick(G, R) {
      const p = G.player;
      for (const s of R.S.fleet) { if (!s.active) continue; const d = Math.hypot(s.x - p.x, s.z - p.z); R.S.minD = Math.min(R.S.minD, d); if (d < 100) R.S.fastNear = Math.max(R.S.fastNear, p.sogKn); }
      if (Math.hypot(p.x - R.S.target.x, p.z - R.S.target.z) < 110) R.S.arrived = true;
    },
    done(G, R) { return R.S.arrived || R.t > 480 || R.M.collision; },
    grade(G, R) {
      const S = R.S;
      return [
        item(`Closest approach to a racing boat: ${Math.round(S.minD)} m`, S.minD >= 30 ? 40 : S.minD >= 15 ? 20 : 0, 40),
        item(`Speed near the fleet: ${S.fastNear.toFixed(1)} kn`, S.fastNear <= 12 ? 30 : S.fastNear <= 18 ? 12 : 0, 30),
        item('Reached Crissy Field', S.arrived ? 30 : 0, 30),
      ];
    },
  },
  // ============================================================ EMERGENCIES
  {
    id: 'mob', cat: 'Emergencies', title: 'Man overboard!',
    where: 'North of Alcatraz at 22 kn', env: { clock: 13, tide: 'ebb', wind: 14, traffic: 'light' },
    brief: 'Running west at 22 kn. A guest is sitting on the stern... Press O (MOB) when it happens. Recover them alongside with the engines in NEUTRAL.',
    quiz: {
      q: 'Someone falls off the stern at speed. What are the first things you do?',
      a: ['Throttle up and circle back as fast as possible', 'Shout "man overboard!", point and keep pointing, hit the MOB button on the plotter, throw a flotation device, then turn back', 'Call the Coast Guard before doing anything else', 'Stop immediately and reverse toward them'],
      correct: 1, explain: 'Keep eyes on the person (assign a pointer), mark the position (MOB button), throw flotation, then turn back. Approach slowly, ideally heading into wind/current, and put the engines in NEUTRAL before the person gets near the boat — propellers are the #1 killer in MOB recoveries. Bring them alongside the helm side, forward of the engines. Call a Mayday/Pan-pan if you can\'t recover quickly.',
    },
    setup(G, R) {
      G.placePlayer(37.8350, -122.4250, 270, 22);
      R.S.mobAt = 6;
    },
    tick(G, R, dt) {
      const p = G.player, S = R.S;
      if (!S.person && R.t >= S.mobAt) {
        const f = p.fwd;
        const sw = makeScripted('swimmer', { x: p.x - f.x * 7, z: p.z - f.z * 7, h: 0, speed: 0, targetSpeed: 0, len: 1.8, beam: 0.6, cat: 'small', human: true, name: 'PERSON IN WATER', noCollide: true });
        sw.highlight = true; S.person = sw; S.mobT = R.t;
        G.toast('🆘 MAN OVERBOARD! Your guest fell off the stern! Press <b>O</b> to mark.', 'alarm', 6000);
        G.beep(1200, 0.6, 0.2);
      }
      if (!S.person) return;
      const q = S.person, d = Math.hypot(q.x - p.x, q.z - p.z);
      S.minD = Math.min(S.minD ?? 1e9, d);
      if (S.returnT == null && d < 30 && R.t - S.mobT > 10) S.returnT = R.t - S.mobT;
      if (d < 30) S.fastClose = Math.max(S.fastClose || 0, p.sogKn);
      const f = p.fwd;
      const sternD = Math.hypot(q.x - (p.x - f.x * 5.4), q.z - (p.z - f.z * 5.4));
      const inGear = p.engines.some(e => e.gear !== 0 && !e.failed);
      if (sternD < 7 && inGear) S.propDanger = true;
      if (d < 8 && inGear) S.gearNear = true;
      // alongside & stopped & neutral -> recovery
      const rel = { x: q.x - p.x, z: q.z - p.z };
      const along = rel.x * f.x + rel.z * f.z, across = Math.abs(rel.x * p.right.x + rel.z * p.right.z);
      if (Math.abs(along) < 4.5 && across < 3.6 && p.speed < 0.6 && !inGear) { S.holdT = (S.holdT || 0) + dt; if (S.holdT > 1.5 && !S.recovered) { S.recovered = true; G.toast('Person recovered aboard!', 'ok'); q.remove(); } }
      else S.holdT = 0;
    },
    onKey(G, R, key) { if (key === 'o' && R.S.person && R.S.mobPressT == null) { R.S.mobPressT = R.t - R.S.mobT; G.toast('MOB position marked', 'ok'); G.setDest({ x: R.S.person.x, z: R.S.person.z }); } },
    done(G, R) { return R.S.recovered || R.t > 300 || (R.S.propDanger && R.S.minD < 4); },
    grade(G, R) {
      const S = R.S;
      return [
        item(S.mobPressT != null ? `MOB button pressed after ${S.mobPressT.toFixed(1)} s` : 'MOB position never marked', S.mobPressT != null && S.mobPressT <= 5 ? 15 : S.mobPressT != null && S.mobPressT <= 10 ? 8 : 0, 15),
        item(S.returnT != null ? `Returned to the person in ${Math.round(S.returnT)} s` : 'Never got back to the person', S.returnT != null && S.returnT <= 120 ? 20 : S.returnT != null && S.returnT <= 180 ? 10 : 0, 20),
        item(`Slow final approach (max ${(S.fastClose || 0).toFixed(1)} kn within 30 m)`, (S.fastClose || 0) <= 2.5 ? 20 : (S.fastClose || 0) <= 4 ? 10 : 0, 20),
        item(S.propDanger ? 'PERSON NEAR SPINNING PROPS' : S.gearNear ? 'Engines in gear with the person close' : 'Engines in neutral near the person', S.propDanger ? 0 : S.gearNear ? 12 : 30, 30, 'Neutral before they come within a boat length; never back down on a person.'),
        item(S.recovered ? 'Recovered the person' : 'Person not recovered', S.recovered ? 15 : 0, 15),
      ];
    },
  },
  {
    id: 'oneengine', cat: 'Emergencies', title: 'Single-engine docking at Pier 1½',
    where: 'Off the Ferry Building', env: { clock: 12.5, tide: 'flood', wind: 12, traffic: 'typical' },
    brief: 'Your starboard engine just died (fuel filter). Bring her into the Pier 1½ guest float on the port engine alone — with ferry wakes rolling through.',
    quiz: {
      q: 'Docking with only the PORT engine. Which way will the boat tend to turn when you shift that engine into forward with the wheel centered?',
      a: ['The bow swings to STARBOARD — away from the running engine', 'The bow swings to PORT — toward the running engine', 'Straight — the wheel is centered', 'It depends only on the wind'],
      correct: 0, explain: 'An off-center engine pushing forward yaws the boat away from its side: port engine ahead → bow goes to starboard; port engine astern → bow goes to port. With outboards you steer the thrust, so counter-steer and use short bursts. Plan an approach that uses the turning tendency (e.g., approach so the bias swings you onto the dock).',
    },
    setup(G, R) {
      const s = P(37.7975, -122.3895);
      G.placePlayer(37.7975, -122.3895, 225, 4);
      G.player.setLever(1, 0); G.player.engines[1].failed = true; G.player.engines[1].running = false;
      const spot = pickSpot('p15', s);
      R.S.spot = spot; G.setZone(zoneFromSpot(spot));
    },
    done: dockDone, grade(G, R) { return dockGrade(G, R, { fast: 300, ok: 500 }); },
  },
  // ============================================================ DOCKING
  {
    id: 'dock_sams', cat: 'Docking', title: "Dock at Sam's Anchor Cafe (Tiburon)",
    where: 'Belvedere Cove, Tiburon', env: { clock: 13, tide: 'flood', traffic: 'typical' },
    brief: "Lunch at Sam's. Find the open spot on the guest dock (green), get fenders out (F), come in slowly and tie up (L). The afternoon gusts come over Belvedere.",
    quiz: {
      q: 'Before approaching a crowded restaurant dock, what should be ready?',
      a: ['Nothing special — just go slow', 'Fenders out (dock side + other side if rafting), bow/stern/spring lines rigged, crew briefed, an approach planned into the wind with a bail-out route', 'A reservation at the restaurant', 'Approach fast to keep steerage, then reverse hard'],
      correct: 1, explain: 'Prepare BEFORE you\'re in the tight space. Plan to approach into the wind/current where possible (it acts as a brake and holds you steady). Have an abort plan. Speed: no faster than you\'re willing to hit the dock.',
    },
    setup(G, R) { G.placePlayer(37.8712, -122.4545, 320, 4); const spot = pickSpot('sams', G.player); R.S.spot = spot; G.setZone(zoneFromSpot(spot)); },
    done: dockDone, grade(G, R) { return dockGrade(G, R); },
  },
  {
    id: 'dock_ayala', cat: 'Docking', title: 'Dock at Ayala Cove (Angel Island)',
    where: 'Raccoon Strait → Ayala Cove', env: { clock: 11.5, tide: 'maxflood', traffic: 'typical' },
    brief: 'Max flood is ripping through Raccoon Strait across the cove entrance. Get into Ayala Cove and onto the guest dock without being swept into the moored boats.',
    quiz: {
      q: 'Current is flowing across the entrance to the cove at 3 knots. How do you enter?',
      a: ['Aim straight at the dock and go slow', 'Point up-current of your target and crab across (ferry glide), adding speed as needed to stay on the line; expect the set to stop once inside', 'Wait for slack water — there is no other way', 'Enter backwards'],
      correct: 1, explain: 'Your boat moves with the water. Aim up-current so your track over the ground goes where you want (watch your COG vs heading). Once inside the cove the current dies — be ready to straighten up and slow down.',
    },
    setup(G, R) { G.placePlayer(37.8712, -122.4380, 160, 5); const spot = pickSpot('ayala', G.player); R.S.spot = spot; G.setZone(zoneFromSpot(spot)); },
    done: dockDone, grade(G, R) { return dockGrade(G, R); },
  },
  {
    id: 'dock_sausalito', cat: 'Docking', title: 'Sausalito guest dock (williwaws)',
    where: 'Downtown Sausalito', env: { clock: 15, tide: 'ebb', wind: 20, traffic: 'typical' },
    brief: 'Gusts are tumbling off the Sausalito hills. Dock at the city guest dock next to the ferry landing. Don\'t block the ferry.',
    quiz: {
      q: 'Gusts are blowing you OFF the dock as you come alongside. What helps most?',
      a: ['Come in at a steeper angle, get a bow/midship spring on first, then power gently against it to bring the stern in', 'Approach parallel and fast', 'Approach from downwind with the wind behind you', 'Have someone jump to the dock from far away'],
      correct: 0, explain: 'When the wind blows you off, approach at a steeper angle (20–30°), get a line on early (a midship or bow spring), then idle forward against the spring with the wheel turned away from the dock to walk the stern in. Never let crew jump.',
    },
    setup(G, R) { G.placePlayer(37.8530, -122.4728, 340, 5); const spot = pickSpot('sausalito', G.player); R.S.spot = spot; G.setZone(zoneFromSpot(spot)); },
    done: dockDone, grade(G, R) { return dockGrade(G, R); },
  },
  {
    id: 'dock_slip', cat: 'Docking', title: 'Back to your slip at Pier 40',
    where: 'South Beach Harbor', env: { clock: 17, tide: 'ebb', wind: 16, traffic: 'light' },
    brief: 'Home time. Enter South Beach Harbor and put the boat back in your slip on the Pier 40 float (bow-in, between the fingers). Wind is blowing down the fairway.',
    quiz: {
      q: 'You\'re idling down a fairway with the wind behind you. How do you control speed?',
      a: ['Keep both engines in forward at idle', 'Shift in and out of gear (forward/neutral, a touch of reverse) — idle in gear is often too fast with wind behind', 'Turn off one engine', 'Use the trim tabs'],
      correct: 1, explain: 'Idle in gear on a 35\' twin is ~5 kn — too fast in a marina with a tailwind. Pros "bump" the levers: ease into gear 2 seconds, back to neutral, coast, repeat; and use one engine in reverse to stop or twist. Pivot the boat with opposite engines (port forward + starboard reverse = turn right on the spot).',
    },
    setup(G, R) {
      const F = PIER_FRAMES.p40, s = F.P(420, -60);
      const { lat, lon } = toLL(s.x, s.z);
      G.placePlayer(lat, lon, 255, 4);
      const sp = PLAYER_SLIP.spot;
      R.S.spot = { x: sp.x, z: sp.z, heading: sp.heading, len: 11 }; R.S.slip = true;
      G.setZone(zoneFromSpot(R.S.spot, 4.5));
    },
    done: dockDone, grade(G, R) { return dockGrade(G, R, { fast: 300, ok: 500 }); },
  },
  {
    id: 'leave_slip', cat: 'Docking', title: 'Leave the slip in a crosswind',
    where: 'Your slip, Pier 40', env: { clock: 15.5, tide: 'flood', wind: 18, traffic: 'light' },
    brief: 'You\'re tied up bow-in. 18 kn is blowing across the slip, pushing you toward the neighboring boat. Fenders (F), cast off (L), back out, and exit the harbor.',
    quiz: {
      q: 'Backing out of a slip with a strong crosswind. What\'s the key?',
      a: ['Back out very slowly so you have time to think', 'Back out decisively with enough speed for control, using the upwind engine in reverse more (or twisting) to keep the bow from blowing down', 'Cast off the upwind lines first', 'Wait for the wind to stop'],
      correct: 1, explain: 'Too slow in a crosswind = the bow blows off and you end up on your neighbor. Plan: fenders out, cast off downwind lines first and upwind lines last, then back out briskly and steer/twist to keep the bow from falling off until you\'re in the fairway.',
    },
    setup(G, R) {
      const sp = PLAYER_SLIP.spot; const { lat, lon } = toLL(sp.x, sp.z);
      G.placePlayer(lat, lon, sp.heading, 0);
      G.player.secureLines(); G.player.lines.forEach(l => { l.snug = 0; }); G.player.fenders = false;
      const F = PIER_FRAMES.p40, e = F.P(320, -48);
      R.S.exit = e; G.setZone({ x: e.x, z: e.z, h: 0, len: 60, w: 60 });
      R.S.fendersAtCastoff = null;
    },
    tick(G, R) {
      const p = G.player;
      if (!p.tied && R.S.fendersAtCastoff == null) R.S.fendersAtCastoff = p.fenders;
      if (Math.hypot(p.x - R.S.exit.x, p.z - R.S.exit.z) < 35) R.S.out = true;
    },
    done(G, R) { return R.S.out || R.t > 360 || R.M.collision; },
    grade(G, R) {
      const imp = R.M.maxImpact;
      return [
        item(`No hard contact (hardest ${(imp / KN).toFixed(2)} kn)`, imp <= 0.2 ? 35 : imp <= 0.45 ? 15 : 0, 35),
        item(`No-wake in the harbor (max ${R.M.maxNWkn.toFixed(1)} kn)`, R.M.maxNWkn <= 5.5 ? 20 : 0, 20),
        item(R.S.out ? `Cleared the harbor in ${Math.round(R.t)} s` : 'Did not exit the harbor', R.S.out && R.t <= 300 ? 20 : R.S.out ? 10 : 0, 20),
        item('Fenders out before casting off', R.S.fendersAtCastoff ? 10 : 0, 10),
        item(`Smooth lever work (${R.M.maxBackKn.toFixed(1)} kn max backing speed in the harbor)`, R.M.maxBackKn <= 3 ? 15 : R.M.maxBackKn <= 4.5 ? 7 : 0, 15, 'Back out at a controlled 1–3 kn: enough to steer, slow enough to stop.'),
      ];
    },
  },
  // ============================================================ NIGHT
  {
    id: 'lights', cat: 'Night', title: 'Night navigation lights quiz',
    where: 'Central Bay at night', env: { clock: 20.6, tide: 'flood', wind: 10, traffic: 'none' }, quizOnly: true,
    brief: 'It\'s dark. You\'re stopped mid-bay. Vessels will appear ahead showing only their lights — identify each one and decide what to do.',
    setup(G, R) {
      G.placePlayer(37.8320, -122.4300, 0, 0);
      R.S.items = LIGHT_ITEMS; R.S.i = -1; R.S.correct = 0; R.S.answers = [];
      R.nextLight = () => {
        if (R.S.v) { R.S.v.remove(); for (const x of R.S.extra || []) x.remove(); }
        R.S.i++;
        if (R.S.i >= R.S.items.length) { R.finish('done'); return; }
        const it = R.S.items[R.S.i], p = G.player;
        const pos = { x: p.x + dir(it.brg).x * it.range, z: p.z + dir(it.brg).z * it.range };
        const v = makeScripted('power', { x: pos.x, z: pos.z, h: it.hdg * D2R, desH: it.hdg * D2R, speed: 0, targetSpeed: 0, len: it.len || 12, manual: true, noCollide: true });
        v.mesh.visible = false; v._lights = it.lights;
        R.S.v = v; R.S.extra = [];
        if (it.barge) { const b = makeScripted('power', { x: pos.x - dir(it.hdg).x * 250, z: pos.z - dir(it.hdg).z * 250, h: it.hdg * D2R, desH: it.hdg * D2R, speed: 0, len: 80, manual: true, noCollide: true }); b.mesh.visible = false; b._lights = [[30, 2, -10, 'r', 'port'], [30, 2, 10, 'g', 'stbd'], [-40, 2, 0, 'w', 'stern']]; R.S.extra.push(b); }
        G.showQuiz({ q: `#${R.S.i + 1}: ${it.q}`, a: it.a, correct: it.correct, explain: it.explain }, (ok) => { if (ok) R.S.correct++; R.S.answers.push(ok); }, () => R.nextLight());
      };
    },
    start(G, R) { R.nextLight(); },
    done() { return false; },
    grade(G, R) {
      return R.S.items.map((it, i) => item(`#${i + 1} ${it.short}`, R.S.answers[i] ? Math.round(100 / R.S.items.length) : 0, Math.round(100 / R.S.items.length), it.explain));
    },
  },
];

const LIGHT_ITEMS = [
  {
    short: 'Red + green + white masthead', brg: 0, range: 600, hdg: 180,
    lights: [[4, 6, 0, 'w', 'mast'], [3, 3, -1.8, 'r', 'port'], [3, 3, 1.8, 'g', 'stbd'], [-6, 2, 0, 'w', 'stern']],
    q: 'Dead ahead you see a WHITE light above, with a RED and a GREEN light below it, side by side.', a: ['A power vessel heading straight at you — both turn to starboard', 'A sailboat crossing', 'An anchored vessel', 'A vessel moving away from you'], correct: 0,
    explain: 'Seeing both sidelights means it\'s pointed right at you. Masthead white = power-driven. Head-on: both alter to starboard (Rule 14).',
  },
  {
    short: 'Green + white masthead', brg: -18, range: 600, hdg: 90,
    lights: [[4, 6, 0, 'w', 'mast'], [3, 3, -1.8, 'r', 'port'], [3, 3, 1.8, 'g', 'stbd'], [-6, 2, 0, 'w', 'stern']],
    q: 'Slightly to your LEFT you see a WHITE light over a GREEN light, moving right.', a: ['Power vessel showing its starboard side, crossing from your port side: you are STAND-ON', 'Power vessel showing its port side: you must give way', 'Sailboat: you must give way', 'Overtaking situation'], correct: 0,
    explain: 'Green = its starboard side faces you → you are on its starboard side → IT must give way (Rule 15). Hold course and speed, but watch it. Memory aid: "green — go (carefully)".',
  },
  {
    short: 'Red + white masthead', brg: 18, range: 600, hdg: 270,
    lights: [[4, 6, 0, 'w', 'mast'], [3, 3, -1.8, 'r', 'port'], [3, 3, 1.8, 'g', 'stbd'], [-6, 2, 0, 'w', 'stern']],
    q: 'Slightly to your RIGHT you see a WHITE light over a RED light, moving left.', a: ['You are stand-on', 'Power vessel crossing from your starboard side: you are GIVE-WAY — slow or turn right to pass astern', 'Anchored vessel', 'Fishing vessel'], correct: 1,
    explain: 'Red = you see its port side → it has you on its port side → you are the give-way vessel. "Red — stop/give way". Pass behind it.',
  },
  {
    short: 'Single white (stern light)', brg: 0, range: 450, hdg: 0,
    lights: [[4, 6, 0, 'w', 'mast'], [3, 3, -1.8, 'r', 'port'], [3, 3, 1.8, 'g', 'stbd'], [-6, 2, 0, 'w', 'stern']],
    q: 'Ahead you see a single WHITE light low on the water, and you\'re gaining on it.', a: ["A vessel's stern light — you are overtaking it and must keep clear", 'A vessel head-on', 'A navigation buoy, ignore it', 'A vessel restricted in ability to maneuver'], correct: 0,
    explain: 'A lone white light could be a stern light (or an anchored vessel). If you\'re closing on it, you\'re overtaking — keep clear (Rule 13).',
  },
  {
    short: 'Tug with tow > 200 m', brg: 10, range: 650, hdg: 270, len: 30, barge: true,
    lights: [[10, 9, 0, 'w', 'mast'], [10, 11, 0, 'w', 'mast'], [10, 13, 0, 'w', 'mast'], [8, 5, -4, 'r', 'port'], [8, 5, 4, 'g', 'stbd'], [-15, 4, 0, 'w', 'stern'], [-15, 5.2, 0, 'y', 'stern']],
    q: 'You see THREE WHITE lights stacked vertically above a RED light, and well behind it, a dimmer RED light.', a: ['A large ship with range lights', 'A tug towing astern with a tow longer than 200 m, crossing right to left — keep well clear and never pass between', 'Three separate fishing boats', 'A vessel aground'], correct: 1,
    explain: '3 masthead lights in a vertical line = towing, tow length > 200 m (2 lights = shorter tow). The tow\'s own sidelights trail far behind. Never cross between them.',
  },
  {
    short: 'Red + green, no masthead (sail)', brg: 0, range: 450, hdg: 180, len: 10,
    lights: [[4.5, 1, -1.2, 'r', 'port'], [4.5, 1, 1.2, 'g', 'stbd'], [-5, 1, 0, 'w', 'stern']],
    q: 'Dead ahead: a RED and a GREEN light side by side, low, with NO white light above them.', a: ['Power vessel head-on', 'A sailing vessel coming toward you — as a power vessel you give way', 'Two kayaks', 'A buoy'], correct: 1,
    explain: 'Sidelights without a masthead light = sailing vessel (or small boat). Power gives way to sail (Rule 18).',
  },
  {
    short: 'Ship: two masthead lights + red', brg: 25, range: 1800, hdg: 230, len: 280,
    lights: [[110, 22, 0, 'w', 'mast'], [-80, 38, 0, 'w', 'mast'], [60, 18, -20, 'r', 'port'], [60, 18, 20, 'g', 'stbd'], [-140, 15, 0, 'w', 'stern']],
    q: 'To your right, far off: two WHITE lights (the rear one higher) and a RED light. The white lights are spread apart.', a: ['Two small boats', 'A large vessel (over 50 m) crossing from your starboard to port — give way and keep well clear; the range lights show its heading', 'A tug with a short tow', 'A vessel at anchor'], correct: 1,
    explain: 'Vessels over 50 m carry two masthead lights, the aft one higher ("range lights"). When they line up, the ship is pointed at you. Red = its port side → you\'re give-way, and with a ship, get well out of the way early.',
  },
];

function pickSpot(siteId, near) {
  const spots = GUEST_SPOTS.filter(g => g.site === siteId && g.free);
  if (!spots.length) return null;
  spots.sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z));
  return spots[0];
}
function zoneFromSpot(s, w = 5) { return s ? { x: s.x, z: s.z, h: s.heading, len: Math.max(12, Math.min(16, s.len)), w } : null; }
function dockDone(G, R) {
  const p = G.player, s = R.S.spot;
  if (p.tied && s) {
    const d = Math.hypot(p.x - s.x, p.z - s.z), dh = Math.abs(angDiff(p.headingDeg, s.heading));
    const aligned = R.S.slip ? (dh < 18 || dh > 162) : (dh < 30 || dh > 150);
    R.S.tiedInZone = d < (R.S.slip ? 4.5 : 8) && aligned;
    R.S.tiedT = (R.S.tiedT || 0) + 1;
    return true;
  }
  return R.t > 600 || p.damage >= 60;
}

// ============================================================================ runner
export class Runner {
  constructor(G) { this.G = G; this.def = null; }
  get active() { return !!this.def && this.phase !== 'done'; }
  start(def) {
    const G = this.G;
    this.def = def; this.t = 0; this.phase = 'setup';
    this.S = {}; this.T = [];
    this.M = { horns: [], impacts: [], collision: false, groundings: 0, maxNWkn: 0, maxDockImpact: 0, boatHits: 0, slams: 0, wakeHits: 0, hardShifts: 0, maxBackKn: 0, fendersBeforeApproach: false, maxImpact: 0 };
    this.A = { maxStbd: 0, maxPort: 0, stbdRange: 0, firstActionRange: 0, firstActionT: null, minSpeedRatio: 1, heldEarly: true, lateAction: false };
    G.applyEnv(def.env);
    def.setup(G, this);
    this.h0 = G.player.headingDeg; this.sp0 = Math.max(0.5, G.player.speed);
    this.slams0 = G.player.slams; this.wake0 = G.player.wakeHits;
    if (def.quizOnly) { this.phase = 'run'; G.setPaused(false); def.start?.(G, this); return; }
    G.setPaused(true);
    G.showQuiz(def.quiz, (ok) => { this.quizOK = ok; }, () => { this.phase = 'run'; this.h0 = G.player.headingDeg; G.setPaused(false); def.start?.(G, this); }, def);
  }
  track(v) { this.T.push({ v, minRange: 1e9, range: 1e9, crossAhead: null, crossAstern: null, prevAcross: null, passed: false, along: 0, cutBow: false, closeSpeedMax: 0 }); }
  onImpact(e) {
    const M = this.M;
    if (e.kind === 'vessel' || (e.kind === 'boat' && e.impact > 0.5)) { if (e.sev === 'collision' || e.impact > 0.6) M.collision = true; }
    if (e.kind === 'boat' || e.kind === 'vessel') M.boatHits++;
    M.maxImpact = Math.max(M.maxImpact, e.impact);
    if (e.kind === 'float' || e.kind === 'pier' || e.kind === 'boat') M.maxDockImpact = Math.max(M.maxDockImpact, e.impact);
  }
  update(dt) {
    if (!this.def || this.phase !== 'run') return;
    const G = this.G, p = G.player, M = this.M, A = this.A;
    this.t += dt;
    M.slams = p.slams - this.slams0; M.wakeHits = p.wakeHits - this.wake0;
    if (inNoWake(p)) M.maxNWkn = Math.max(M.maxNWkn, p.sogKn);
    if (p.surge < 0) M.maxBackKn = Math.max(M.maxBackKn, -p.surge / KN);
    if (this.S.spot && Math.hypot(p.x - this.S.spot.x, p.z - this.S.spot.z) < 60 && p.fenders && !M.approachChecked) { M.fendersBeforeApproach = true; }
    if (this.S.spot && Math.hypot(p.x - this.S.spot.x, p.z - this.S.spot.z) < 45) M.approachChecked = true;
    // own-ship action tracking relative to the primary target
    const dh = angDiff(p.headingDeg, this.h0);
    const T0 = this.T[0];
    for (const T of this.T) {
      const v = T.v; if (!v) continue;
      const dx = p.x - v.x, dz = p.z - v.z;
      T.range = Math.hypot(dx, dz);
      if (T.range < T.minRange) T.minRange = T.range;
      const f = { x: Math.sin(v.h), z: -Math.cos(v.h) }, s = { x: Math.cos(v.h), z: Math.sin(v.h) };
      const along = dx * f.x + dz * f.z, across = dx * s.x + dz * s.z;
      if (T.prevAcross !== null && Math.sign(across) !== Math.sign(T.prevAcross) && T.range < 2500) {
        if (along > 0) { if (T.crossAhead === null || along < T.crossAhead) T.crossAhead = along; if (T.along > 0 && along < 150 && T.range < 200) T.cutBow = true; }
        else T.crossAstern = -along;
      }
      T.prevAcross = across; T.along = along;
      const c = cpa(p.x, p.z, p.vx, p.vz, v.x, v.z, v.vx || 0, v.vz || 0);
      if (c.tcpa < 0 && T.range < 1500 && T.minRange < 1400) T.passed = true;
      if (T.range < 60) T.closeSpeedMax = Math.max(T.closeSpeedMax, p.speed);
    }
    if (T0) {
      if (dh > A.maxStbd) { A.maxStbd = dh; if (dh >= 15 && !A.stbdRange) A.stbdRange = T0.range; }
      if (-dh > A.maxPort) A.maxPort = -dh;
      const ratio = p.speed / this.sp0;
      A.minSpeedRatio = Math.min(A.minSpeedRatio, ratio);
      const acting = Math.abs(dh) > 12 || ratio < 0.7;
      if (acting && !A.firstActionRange) { A.firstActionRange = T0.range; A.firstActionT = this.t; }
      if (T0.range > 350 && acting) A.heldEarly = false;
      if (T0.range < 320 && (dh > 12 || ratio < 0.6)) A.lateAction = true;
    }
    this.def.tick?.(G, this, dt);
    if (this.def.done(G, this)) this.finish('done');
  }
  finish(reason) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const G = this.G;
    let items = this.def.grade(G, this);
    if (this.def.quiz) items = [item(this.quizOK ? 'Pre-brief question: correct' : 'Pre-brief question: incorrect', this.quizOK ? 10 : 0, 10, this.def.quiz.explain), ...items];
    const max = items.reduce((a, b) => a + b.max, 0), got = items.reduce((a, b) => a + Math.min(b.max, b.pts), 0);
    const score = Math.round(got / max * 100);
    this.def.cleanup?.();
    G.showDebrief(this.def, items, score);
    try {
      const best = JSON.parse(localStorage.getItem('sfbay_best') || '{}');
      if (!best[this.def.id] || score > best[this.def.id]) { best[this.def.id] = score; localStorage.setItem('sfbay_best', JSON.stringify(best)); }
    } catch (e) { /* storage unavailable */ }
  }
  stop() { this.def?.cleanup?.(); this.def = null; this.phase = 'done'; }
}
