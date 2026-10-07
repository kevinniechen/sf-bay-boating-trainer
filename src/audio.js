// Synthesized audio: twin engines, water rush, wind, horns (yours and other vessels'), impacts.
export const audio = { ctx: null, on: true, master: null };
let eng = [], water, wind, hornOsc = null, noiseBuf;

function noise(ctx) {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
function loopNoise(ctx, type, freq, q) {
  const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(audio.master); src.start();
  return { src, f, g };
}

// ---------------------------------------------------------------- engines (Mercury Verado 350: supercharged inline-6)
// Firing frequency = rpm/60 × 3 (four-stroke I6). A supercharger whine rides on top under load. A harmonic-rich periodic wave carries the tone; a cam-rate
// LFO gives the lumpy idle; band-passed noise adds combustion roughness under load; a low-pass
// closes down when the exhaust goes out through the prop hub underwater at speed.
function v12Wave(ctx) {
  const n = 28, real = new Float32Array(n), imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    let a = 1 / Math.pow(k, 0.85);
    if (k === 2 || k === 4) a *= 1.7;          // uneven pulses → burble
    if (k % 6 === 0) a *= 1.3;
    const ph = Math.sin(k * 12.9898) * Math.PI;
    real[k] = a * Math.cos(ph); imag[k] = a * Math.sin(ph);
  }
  return ctx.createPeriodicWave(real, imag);
}
let comp = null, rush, spray, lapT = 2, gullT = 12, lionT = 4, bellT = 3, fogT = 8;
export function initAudio() {
  if (audio.ctx) { audio.ctx.resume(); return; }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  audio.ctx = ctx;
  comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
  comp.connect(ctx.destination);
  audio.master = ctx.createGain(); audio.master.gain.value = audio.on ? 0.6 : 0; audio.master.connect(comp);
  const wave = v12Wave(ctx);
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator(); osc.setPeriodicWave(wave);
    const sub = ctx.createOscillator(); sub.type = 'sine';               // low "thump" one octave down
    const tone = ctx.createGain(); tone.gain.value = 0.55;
    const subG = ctx.createGain(); subG.gain.value = 0.35;
    const am = ctx.createGain(); am.gain.value = 1;                    // lope
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth); lfoDepth.connect(am.gain);
    const nz = ctx.createBufferSource(); nz.buffer = noise(ctx); nz.loop = true; nz.loopStart = i * 0.7;
    const nzF = ctx.createBiquadFilter(); nzF.type = 'bandpass'; nzF.Q.value = 1.4;
    const nzG = ctx.createGain(); nzG.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
    const out = ctx.createGain(); out.gain.value = 0;
    const pan = ctx.createStereoPanner(); pan.pan.value = i ? 0.22 : -0.22;
    osc.connect(tone); sub.connect(subG); tone.connect(am); subG.connect(am);
    nz.connect(nzF); nzF.connect(nzG); nzG.connect(am);
    am.connect(lp); lp.connect(out); out.connect(pan); pan.connect(audio.master);
    osc.start(); sub.start(); lfo.start(); nz.start();
    // Verado supercharger whine: a narrow tone at blower speed (~2.6× crank), audible from idle up
    const sc = ctx.createOscillator(); sc.type = 'triangle';
    const scG = ctx.createGain(); scG.gain.value = 0;
    sc.connect(scG); scG.connect(pan); sc.start();
    eng.push({ osc, sub, lfo, lfoDepth, nzF, nzG, lp, out, sc, scG, detune: i ? 1.013 : 1 });
  }
  // water: low rush under the hull + high spray hiss when planing
  rush = loopNoise(ctx, 'lowpass', 300, 0.7);
  spray = loopNoise(ctx, 'highpass', 2500, 0.5);
  water = rush;
  wind = loopNoise(ctx, 'bandpass', 600, 0.4);
}

export function setMuted(m) { audio.on = !m; if (audio.master) audio.master.gain.value = m ? 0 : 0.6; }

export function updateAudio(player, apparentWind) {
  if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  const sp = player.speed, kn = sp / 0.5144;
  player.engines.forEach((e, i) => {
    const E = eng[i];
    const on = e.rpm > 50;
    const fire = Math.max(12, e.rpm / 60 * 3) * E.detune;
    const load = e.gear !== 0 ? Math.min(1, Math.abs(e.thrust) / 6900 * 1.0 + e.thr * 0.5) : e.thr * 0.3;
    E.osc.frequency.setTargetAtTime(fire, t, 0.06);
    E.sub.frequency.setTargetAtTime(fire / 2, t, 0.06);
    E.lfo.frequency.setTargetAtTime(Math.max(3, e.rpm / 120), t, 0.1);
    E.lfoDepth.gain.setTargetAtTime(Math.max(0, 0.45 - e.rpm / 3500) * (on ? 1 : 0), t, 0.2);
    E.nzF.frequency.setTargetAtTime(fire * 3.2, t, 0.1);
    E.nzG.gain.setTargetAtTime(0.08 + load * 0.5, t, 0.1);
    // through-hub exhaust: muffled when moving in gear, open "idle relief" burble when slow
    const hub = Math.min(1, kn / 12) * (e.gear !== 0 ? 1 : 0.3);
    E.lp.frequency.setTargetAtTime(220 + e.rpm * 0.32 * (1 - 0.45 * hub) + load * 900, t, 0.1);
    E.out.gain.setTargetAtTime(on ? (0.07 + load * 0.13 + e.rpm / 6000 * 0.08) : 0, t, 0.12);
    E.sc.frequency.setTargetAtTime(Math.max(60, e.rpm / 60 * 2.6 * 8) * E.detune, t, 0.08);
    E.scG.gain.setTargetAtTime(on ? 0.006 + load * 0.02 * Math.min(1, e.rpm / 3000) : 0, t, 0.15);
  });
  rush.g.gain.setTargetAtTime(Math.min(0.32, Math.pow(sp, 0.8) * 0.03), t, 0.2);
  rush.f.frequency.setTargetAtTime(200 + sp * 45, t, 0.2);
  spray.g.gain.setTargetAtTime(kn > 18 ? Math.min(0.12, (kn - 18) * 0.004) : 0, t, 0.3);
  wind.g.gain.setTargetAtTime(Math.min(0.28, Math.pow(apparentWind / 22, 2) * 0.22), t, 0.25);
  wind.f.frequency.setTargetAtTime(350 + apparentWind * 18, t, 0.3);
}

// ---------------------------------------------------------------- ambience (cheap, event-driven)
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0008, t + a + d); }
function panned(vol, pan) {
  const ctx = audio.ctx, g = ctx.createGain(), p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(audio.master); g.gain.value = vol; return g;
}
function lap(vol) { // water slapping the hull
  const ctx = audio.ctx, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 350 + Math.random() * 500; f.Q.value = 2.5;
  const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(panned(1, (Math.random() - 0.5) * 1.2));
  env(g, t, 0.01, vol, 0.18 + Math.random() * 0.15); src.start(t, Math.random()); src.stop(t + 0.5);
}
function gull(vol, pan) {
  const ctx = audio.ctx; let t = ctx.currentTime;
  const n = 2 + Math.floor(Math.random() * 3), base = 1500 + Math.random() * 500;
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator(); o.type = 'triangle';
    const vib = ctx.createOscillator(); vib.frequency.value = 28; const vg = ctx.createGain(); vg.gain.value = 60; vib.connect(vg); vg.connect(o.frequency);
    o.frequency.setValueAtTime(base * 1.2, t); o.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.28);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = base; f.Q.value = 3;
    const g = ctx.createGain(); o.connect(f); f.connect(g); g.connect(panned(1, pan));
    env(g, t, 0.03, vol, 0.28); o.start(t); vib.start(t); o.stop(t + 0.4); vib.stop(t + 0.4);
    t += 0.32 + Math.random() * 0.1;
  }
}
function seaLion(vol, pan) {
  const ctx = audio.ctx; let t = ctx.currentTime;
  for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 170 + Math.random() * 70;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 650; f.Q.value = 2;
    const g = ctx.createGain(); o.connect(f); f.connect(g); g.connect(panned(1, pan));
    env(g, t, 0.02, vol, 0.22); o.start(t); o.stop(t + 0.3);
    t += 0.28 + Math.random() * 0.25;
  }
}
function bell(vol, pan) {
  const ctx = audio.ctx, t = ctx.currentTime;
  for (const [fr, a, d] of [[523, 1, 2.6], [1310, 0.5, 1.6], [2093, 0.3, 1.0], [2780, 0.15, 0.6]]) {
    const o = ctx.createOscillator(); o.frequency.value = fr; const g = ctx.createGain(); o.connect(g); g.connect(panned(1, pan));
    env(g, t, 0.003, vol * a, d); o.start(t); o.stop(t + d + 0.1);
  }
}
// Golden Gate Bridge foghorn: low two-tone diaphone ("BEEE-ohhh")
function foghorn(vol, pan) {
  const ctx = audio.ctx, t = ctx.currentTime;
  for (const [fr, t0, d] of [[148, 0, 1.9], [110, 2.0, 2.6]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = ctx.createGain(); o.connect(f); f.connect(g); g.connect(panned(1, pan));
    g.gain.setValueAtTime(0, t + t0); g.gain.linearRampToValueAtTime(vol, t + t0 + 0.15); g.gain.setValueAtTime(vol, t + t0 + d - 0.2); g.gain.linearRampToValueAtTime(0, t + t0 + d);
    o.start(t + t0); o.stop(t + t0 + d + 0.1);
  }
}
// info: { kn, chop, docked, landDist, p39: {d, pan}, buoy: {d, pan}, gate: {d, pan}, fog }
export function updateAmbient(dt, info) {
  if (!audio.ctx || !audio.on) return;
  lapT -= dt; gullT -= dt; lionT -= dt; bellT -= dt; fogT -= dt;
  if (lapT <= 0) { lapT = 0.4 + Math.random() * (info.docked ? 1.2 : 2.2); if (info.kn < 4) lap(0.05 + Math.min(0.12, info.chop * 0.2) + (info.docked ? 0.04 : 0)); }
  if (gullT <= 0) { gullT = 7 + Math.random() * 18; if (info.landDist < 450) gull(0.05 * (1 - info.landDist / 500), (Math.random() - 0.5) * 1.6); }
  if (lionT <= 0) { lionT = 3 + Math.random() * 6; if (info.p39.d < 700) seaLion(0.16 * (1 - info.p39.d / 750), info.p39.pan); }
  if (bellT <= 0) { bellT = 2.5 + Math.random() * 4; if (info.buoy.d < 350) bell(0.12 * (1 - info.buoy.d / 380), info.buoy.pan); }
  if (fogT <= 0) { fogT = 20; if (info.fog && info.gate.d < 6000) foghorn(0.3 / (1 + info.gate.d / 1500), info.gate.pan); }
}
export function shiftClunk() {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  thud(0.18);
  const src = ctx.createBufferSource(); src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 6;
  const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(audio.master);
  env(g, t, 0.002, 0.08, 0.07); src.start(t); src.stop(t + 0.12);
}
// starter cranking then catching
export function crank() {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 95;
  const am = ctx.createOscillator(); am.frequency.value = 9; const amg = ctx.createGain(); amg.gain.value = 0.5; am.connect(amg);
  const g = ctx.createGain(); g.gain.value = 0; amg.connect(g.gain);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
  o.connect(f); f.connect(g); g.connect(audio.master);
  g.gain.setValueAtTime(0.1, t); g.gain.setValueAtTime(0.1, t + 0.7); g.gain.linearRampToValueAtTime(0, t + 0.8);
  o.start(t); am.start(t); o.stop(t + 0.85); am.stop(t + 0.85);
}

// player's horn (held while key down)
export function hornStart() {
  if (!audio.ctx || hornOsc) return;
  const ctx = audio.ctx;
  const g = ctx.createGain(); g.gain.value = 0.18; g.connect(audio.master);
  const a = ctx.createOscillator(); a.type = 'square'; a.frequency.value = 330;
  const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 415;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
  a.connect(f); b.connect(f); f.connect(g); a.start(); b.start();
  hornOsc = { a, b, g };
}
export function hornStop() {
  if (!hornOsc) return;
  const t = audio.ctx.currentTime;
  hornOsc.g.gain.setTargetAtTime(0, t, 0.03);
  const h = hornOsc; hornOsc = null;
  setTimeout(() => { h.a.stop(); h.b.stop(); }, 200);
}

// other vessels' horn signals: pattern 'danger' (5 short), 'prolonged', 'back' (3 short), 'short1', 'short2'
export function horn(pattern, dist, deep = false) {
  if (!audio.ctx) return;
  const ctx = audio.ctx;
  const vol = Math.min(0.4, 0.5 / (1 + dist / 350));
  if (vol < 0.01) return;
  const seq = pattern === 'danger' ? [1, 1, 1, 1, 1] : pattern === 'prolonged' ? [5] : pattern === 'back' ? [1, 1, 1] : pattern === 'short2' ? [1, 1] : pattern === 'fog' ? [5] : [1];
  const delay = dist / 340;
  let t = ctx.currentTime + delay;
  const g = ctx.createGain(); g.gain.value = 0; g.connect(audio.master);
  const freqs = deep ? [72, 108] : [160, 200];
  const oscs = freqs.map(fr => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; return o; });
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700 / (1 + dist / 1500);
  oscs.forEach(o => { o.connect(f); o.start(t); });
  f.connect(g);
  for (const s of seq) {
    const d = s === 5 ? 4.5 : 0.9;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, t + d); g.gain.linearRampToValueAtTime(0, t + d + 0.08);
    t += d + 0.45;
  }
  oscs.forEach(o => o.stop(t + 0.2));
}

export function thud(intensity) {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180 + intensity * 150;
  const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(0.9, 0.2 + intensity * 0.5), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  src.connect(f); f.connect(g); g.connect(audio.master); src.start(t); src.stop(t + 0.4);
}

export function beep(freq = 880, dur = 0.12, vol = 0.12) {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.frequency.value = freq; o.type = 'sine';
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + dur + 0.05);
}

export function squelch() {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 0.7;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  src.connect(f); f.connect(g); g.connect(audio.master); src.start(t); src.stop(t + 0.3);
}

// ---------------------------------------------------------------- damage & contact sounds
let scrapeN = null, btN = null;
// fiberglass crunch: low thump + a burst of cracking crackles, louder/longer with severity
export function crunch(sev) {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  thud(0.4 + sev * 0.6);
  const n = 3 + Math.floor(sev * 9);
  for (let i = 0; i < n; i++) {
    const t0 = t + Math.random() * (0.08 + sev * 0.35);
    const src = ctx.createBufferSource(); src.buffer = noise(ctx);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 2600; f.Q.value = 3 + Math.random() * 5;
    const g = ctx.createGain(); const v = 0.12 + sev * 0.25;
    g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03 + Math.random() * 0.07);
    src.connect(f); f.connect(g); g.connect(audio.master); src.start(t0, Math.random()); src.stop(t0 + 0.12);
  }
  // warning chime from the helm
  if (sev > 0.6) { beep(1400, 0.12, 0.12); setTimeout(() => beep(1400, 0.12, 0.12), 180); }
}
// rubber fender squeak on a gentle, fendered touch
export function squeak(v = 0.5) {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(260, t); o.frequency.linearRampToValueAtTime(420 + v * 200, t + 0.18); o.frequency.linearRampToValueAtTime(300, t + 0.3);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06 + v * 0.06, t + 0.04); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + 0.4);
}
// continuous gelcoat scrape (hull sliding on a dock or another boat) and bow-thruster whine
export function updateContactAudio(scrape, fenders, btThrust) {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  if (!scrapeN) {
    scrapeN = loopNoise(ctx, 'bandpass', 1400, 1.2);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 180;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0; o.connect(f); f.connect(g); g.connect(audio.master); o.start();
    btN = { o, f, g };
  }
  const sv = Math.min(1, scrape * 1.6);
  scrapeN.g.gain.setTargetAtTime(sv > 0.08 ? sv * (fenders ? 0.05 : 0.35) : 0, t, 0.05);
  scrapeN.f.frequency.setTargetAtTime(fenders ? 500 : 1200 + sv * 1500, t, 0.05);
  const b = Math.abs(btThrust) / 620;
  btN.g.gain.setTargetAtTime(b * 0.08, t, 0.08);
  btN.o.frequency.setTargetAtTime(120 + b * 260, t, 0.1);
}

// ---------------------------------------------------------------- airshow jets (Fleet Week)
// One shared chain: broadband roar (low-passed noise, cutoff falls with distance = air absorption),
// a crackle band for the afterburner/exhaust, and a low rumble. The airshow computes the summed
// level, cutoff (Doppler + distance), and pan from the retarded (sound-delayed) aircraft positions.
let jet = null;
export function jetAudio(level, cutoff, pan, rumble = 0.5) {
  if (!audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  if (!jet) {
    const src = ctx.createBufferSource(); src.buffer = noise(ctx); src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.Q.value = 0.5;
    const cr = ctx.createBiquadFilter(); cr.type = 'bandpass'; cr.frequency.value = 1800; cr.Q.value = 0.8;
    const crG = ctx.createGain(); crG.gain.value = 0;
    const lo = ctx.createBiquadFilter(); lo.type = 'lowpass'; lo.frequency.value = 90;
    const loG = ctx.createGain(); loG.gain.value = 0;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner();
    src.connect(lp); lp.connect(lp2); lp2.connect(g);
    src.connect(cr); cr.connect(crG); crG.connect(g);
    src.connect(lo); lo.connect(loG); loG.connect(p);
    g.connect(p); p.connect(audio.master); src.start();
    jet = { lp, lp2, crG, loG, g, p };
  }
  const L = Math.min(1.2, level);
  jet.g.gain.setTargetAtTime(L * 0.9, t, 0.08);
  jet.loG.gain.setTargetAtTime(L * rumble * 2.2, t, 0.1);
  jet.crG.gain.setTargetAtTime(L * Math.min(1, cutoff / 4000) * 0.35, t, 0.08);
  jet.lp.frequency.setTargetAtTime(Math.max(120, cutoff), t, 0.08);
  jet.lp2.frequency.setTargetAtTime(Math.max(120, cutoff * 1.3), t, 0.08);
  jet.p.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, pan)), t, 0.1);
}
