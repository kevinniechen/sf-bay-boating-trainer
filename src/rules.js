// Navigation Rules (Inland Rules apply inside the COLREGS demarcation line at the Golden Gate).
// Encounter geometry + who-gives-way classification used by the live Rules Advisor, the AI
// traffic and the scenario grader.
const D2R = Math.PI / 180;

export function angDiff(a, b) { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; }

// Closest point of approach between two constant-velocity tracks
export function cpa(ax, az, avx, avz, bx, bz, bvx, bvz) {
  const rx = bx - ax, rz = bz - az, vx = bvx - avx, vz = bvz - avz;
  const v2 = vx * vx + vz * vz;
  const t = v2 < 1e-6 ? 0 : -(rx * vx + rz * vz) / v2;
  const tc = Math.max(0, t);
  const dx = rx + vx * tc, dz = rz + vz * tc;
  return { tcpa: t, dcpa: Math.hypot(dx, dz), range: Math.hypot(rx, rz) };
}

// relative bearing (deg, + to starboard) of point (x,z) seen from a vessel at (ox,oz) heading h (rad)
export function relBearing(ox, oz, h, x, z) {
  const b = Math.atan2(x - ox, -(z - oz)) / D2R;
  return angDiff(b, h / D2R);
}
export function trueBearing(ox, oz, x, z) { return ((Math.atan2(x - ox, -(z - oz)) / D2R) + 360) % 360; }

export const SIGNALS = {
  short1: 'One short blast: "I intend to leave you on my PORT side" (meeting/crossing) or "I intend to overtake on your STARBOARD side".',
  short2: 'Two short blasts: "I intend to leave you on my STARBOARD side" or "I intend to overtake on your PORT side".',
  short3: 'Three short blasts: "I am operating astern propulsion" (backing).',
  danger: 'Five or more short, rapid blasts: DANGER / DOUBT — "I don\'t understand your intentions" or "your action is unsafe".',
  prolonged: 'One prolonged blast (4–6 s): leaving a dock/berth, approaching a blind bend; in fog, every 2 min when making way.',
};

// own/other: {x,z,h,vx,vz,speed,cat,isSail,ram,fishing,len,human}
export function classify(own, other) {
  const beta = relBearing(own.x, own.z, own.h, other.x, other.z);   // where the other is, from me
  const alpha = relBearing(other.x, other.z, other.h, own.x, own.z); // where I am, from the other
  const c = cpa(own.x, own.z, own.vx, own.vz, other.x, other.z, other.vx, other.vz);
  const closing = c.tcpa > 0;
  const ownS = own.speed, othS = other.speed;
  const res = { beta, alpha, ...c, situation: 'none', role: 'none', rule: '', advice: '', signal: '' };

  if (other.cat === 'ship' || other.cat === 'tow') {
    res.situation = other.cat === 'tow' ? 'tow' : 'ship';
    res.role = 'keep-clear';
    res.rule = other.cat === 'tow' ? 'Rule 18 / Rule 3(g) — vessel restricted in ability to maneuver (tug with tow)' : 'Rule 9(b),(d) — don\'t impede a vessel that can safely navigate only within a channel; VTS lanes';
    res.advice = other.cat === 'tow'
      ? 'Tug with a long tow: NEVER pass between the tug and its barge — the hawser may be underwater. Pass well astern of the barge.'
      : 'Big ship: it can\'t stop (a mile+) or turn quickly and may not see you under its bow (blind zone up to 1/4–1/2 nm). Get out of the lane early with a large, obvious course change, show it your side, pass astern. Never cross its bow inside ~1 nm.';
    res.signal = 'If it sounds 5+ short blasts, it means YOU — act immediately.';
    return res;
  }
  if (other.human) {
    res.situation = 'small'; res.role = 'keep-clear';
    res.rule = 'Rule 2 (good seamanship), Rule 6 (safe speed); you are responsible for your wake';
    res.advice = 'Paddlers/swimmers are hard to see and can\'t move fast. Slow to no-wake, give 50+ yards and pass behind them.';
    return res;
  }
  // overtaking (Rule 13) applies before Rule 18 priorities
  if (Math.abs(alpha) > 112.5 && ownS > othS + 0.4 && closing && Math.abs(beta) < 70) {
    res.situation = 'overtaking'; res.role = 'give-way';
    res.rule = 'Rule 13 — the overtaking vessel keeps clear';
    res.advice = 'You are OVERTAKING: you must keep clear the whole way past until finally past and clear. Pass with lots of room, mind your wake, don\'t cut back across its bow.';
    res.signal = beta >= 0 ? 'Inland: 2 short = I intend to overtake on your PORT side' : 'Inland: 1 short = I intend to overtake on your STARBOARD side';
    return res;
  }
  if (Math.abs(beta) > 112.5 && othS > ownS + 0.4 && closing) {
    res.situation = 'overtaken'; res.role = 'stand-on';
    res.rule = 'Rule 13 / 17 — you are being overtaken; you are the stand-on vessel';
    res.advice = 'A faster vessel is overtaking you. Hold your course and speed so it can predict you. Be ready for its wake (turn to take it at an angle).';
    return res;
  }
  if (other.isSail && !own.isSail) {
    res.situation = 'sail'; res.role = 'give-way';
    res.rule = 'Rule 18(a)(iv) — power-driven vessels keep out of the way of sailing vessels';
    res.advice = 'A sailboat UNDER SAIL has priority over you no matter which side it is on (unless you are being overtaken, or it is in a narrow channel). Alter course to pass astern of it, or slow down. Expect it to tack without warning.';
    return res;
  }
  if (other.fishing) {
    res.situation = 'fishing'; res.role = 'give-way';
    res.rule = 'Rule 18(a)(iii) — keep out of the way of a vessel engaged in fishing (nets/trawl)';
    res.advice = 'Give fishing vessels a wide berth and pass astern — they may have lines or gear out.';
    return res;
  }
  if (other.anchored) {
    res.situation = 'anchored'; res.role = 'keep-clear'; res.rule = 'Rule 2 / 6 — avoid anchored vessels'; res.advice = 'Anchored/drifting boat: pass at a safe distance and slow so your wake doesn\'t roll them.';
    return res;
  }
  // power vs power
  const recip = Math.abs(angDiff(own.h / D2R, other.h / D2R + 180));
  if (Math.abs(beta) < 10 && recip < 14) {
    res.situation = 'headon'; res.role = 'both';
    res.rule = 'Rule 14 — head-on: BOTH vessels alter course to STARBOARD';
    res.advice = 'Meeting head-on: turn to STARBOARD (right) early and obviously so you pass port-to-port. Never turn left.';
    res.signal = 'Inland: 1 short = "I intend to leave you on my port side" (port-to-port).';
    return res;
  }
  if (beta > 0 && beta < 112.5) {
    res.situation = 'crossing-stbd'; res.role = 'give-way';
    res.rule = 'Rule 15/16 — crossing: the vessel with the other on its STARBOARD side gives way';
    res.advice = 'It\'s on your STARBOARD side — you are the GIVE-WAY vessel. Take early, substantial action: turn to starboard to pass astern of it, and/or slow down/stop. Do not cross ahead.';
    res.signal = 'Inland: 2 short if you will leave it on your starboard side (passing astern of it while turning left is discouraged); usually just turn right & pass astern.';
    return res;
  }
  if (beta < 0 && beta > -112.5) {
    res.situation = 'crossing-port'; res.role = 'stand-on';
    res.rule = 'Rule 17 — crossing: you are the STAND-ON vessel (it is on your port side)';
    res.advice = 'It\'s on your PORT side — you are STAND-ON: hold course and speed. If it doesn\'t act, sound 5 short and take action yourself — but do NOT turn to port toward it; turn to starboard or stop.';
    res.signal = '5+ short blasts if it isn\'t giving way.';
    return res;
  }
  return res;
}

// Is there a real risk of collision?
export function isRisk(c, own, other) {
  const safe = 45 + (other.len || 10) * 0.5 + (other.cat === 'ship' ? 350 : other.cat === 'ferry' ? 90 : 0);
  return c.tcpa > 0 && c.tcpa < (other.cat === 'ship' ? 420 : 200) && c.dcpa < safe && c.range < (other.cat === 'ship' ? 3500 : 1500);
}
