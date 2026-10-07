// Catastrophic impacts: the boat (or a small AI boat you hit) breaks apart — fireball, smoke column,
// a flash, and debris chunks in the boat's own colours that tumble, splash down, float and sink.
import * as THREE from 'three';
import { waveHeight, env } from './env.js';
import { W } from './world.js';
import { boom } from './audio.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
let debris = [], fx = [], light = null, fireTex = null, smokeTex = null;

function radialTex(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// x, z: centre; vx, vz: velocity at impact; colors: palette of the hull; size: boat length
export function explode(x, z, vx, vz, colors, size = 10, fire = true) {
  if (!fireTex) {
    fireTex = radialTex([[0, 'rgba(255,250,220,1)'], [0.25, 'rgba(255,190,60,0.95)'], [0.6, 'rgba(230,80,20,0.5)'], [1, 'rgba(120,20,0,0)']]);
    smokeTex = radialTex([[0, 'rgba(40,38,36,0.85)'], [0.6, 'rgba(50,48,46,0.45)'], [1, 'rgba(60,60,60,0)']]);
  }
  const n = Math.round(14 + size * 1.6);
  for (let i = 0; i < n; i++) {
    const s = rnd(0.15, 0.25) * size * (Math.random() < 0.2 ? 1.6 : 0.6);
    const geo = Math.random() < 0.6 ? new THREE.BoxGeometry(s, s * rnd(0.08, 0.3), s * rnd(0.3, 1)) : new THREE.TetrahedronGeometry(s * 0.5);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pick(colors), roughness: 0.6 }));
    m.castShadow = true;
    m.position.set(x + rnd(-0.3, 0.3) * size, rnd(0.5, 1.5), z + rnd(-0.3, 0.3) * size);
    const out = rnd(3, 10);
    const a = rnd(0, Math.PI * 2);
    m.userData = { v: new THREE.Vector3(vx * 0.5 + Math.cos(a) * out, rnd(3, 12), vz * 0.5 + Math.sin(a) * out), w: new THREE.Vector3(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)), t: 0, sink: rnd(15, 45), float: rnd(0.2, 0.7) };
    W.scene.add(m); debris.push(m);
  }
  if (fire) {
    for (let i = 0; i < 22; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.position.set(x + rnd(-2, 2), rnd(0.5, 3), z + rnd(-2, 2));
      sp.userData = { kind: 'fire', t: rnd(-0.15, 0), life: rnd(0.8, 1.8), v: new THREE.Vector3(rnd(-5, 5), rnd(3, 11), rnd(-5, 5)), s0: rnd(3, 7) };
      W.scene.add(sp); fx.push(sp);
    }
    for (let i = 0; i < 26; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, depthWrite: false, transparent: true }));
      sp.position.set(x + rnd(-2, 2), rnd(1, 4), z + rnd(-2, 2));
      sp.userData = { kind: 'smoke', t: rnd(-1.2, 0), life: rnd(7, 14), v: new THREE.Vector3(rnd(-1.5, 1.5), rnd(2, 5), rnd(-1.5, 1.5)), s0: rnd(4, 8) };
      W.scene.add(sp); fx.push(sp);
    }
    if (!light) { light = new THREE.PointLight(0xffa040, 0, 300, 1.6); W.scene.add(light); }
    light.position.set(x, 6, z); light.intensity = 4000; light.userData.t = 0;
    boom(1);
  } else boom(0.45);
}

export function updateWreck(dt) {
  const t = env.time;
  for (const m of debris) {
    const u = m.userData; u.t += dt;
    const wy = waveHeight(m.position.x, m.position.z, t);
    if (m.position.y > wy + 0.05 || u.v.y > 0) {
      u.v.y -= 9.81 * dt;
      m.position.addScaledVector(u.v, dt);
      m.rotation.x += u.w.x * dt; m.rotation.y += u.w.y * dt; m.rotation.z += u.w.z * dt;
      if (m.position.y <= wy && u.v.y < -3) { u.v.multiplyScalar(0.25); u.w.multiplyScalar(0.3); }   // splash-down
    } else {
      // floating: bob on the waves, drift, slowly waterlog and sink
      const sinkK = Math.max(0, (u.t - u.sink) / 20);
      m.position.y += (wy - u.float * 0.2 - sinkK * 2 - m.position.y) * Math.min(1, dt * 3);
      u.v.multiplyScalar(Math.exp(-dt * 0.8)); u.v.y = 0;
      m.position.x += u.v.x * dt; m.position.z += u.v.z * dt;
      u.w.multiplyScalar(Math.exp(-dt * 2));
      m.rotation.x += u.w.x * dt; m.rotation.z += u.w.z * dt;
    }
  }
  debris = debris.filter(m => { if (m.userData.t > m.userData.sink + 24) { W.scene.remove(m); m.geometry.dispose(); return false; } return true; });
  for (const s of fx) {
    const u = s.userData; u.t += dt;
    if (u.t < 0) { s.visible = false; continue; }
    s.visible = true;
    const k = u.t / u.life;
    s.position.addScaledVector(u.v, dt);
    if (u.kind === 'fire') { u.v.multiplyScalar(Math.exp(-dt * 2)); s.scale.setScalar(u.s0 * (0.6 + k * 1.6)); s.material.opacity = Math.max(0, 1 - k); }
    else { u.v.multiplyScalar(Math.exp(-dt * 0.4)); s.scale.setScalar(u.s0 * (1 + k * 4)); s.material.opacity = Math.max(0, 0.75 * (1 - k)) * Math.min(1, u.t * 2); }
  }
  fx = fx.filter(s => { if (s.userData.t > s.userData.life) { W.scene.remove(s); s.material.dispose(); return false; } return true; });
  if (light && light.intensity > 0) { light.userData.t += dt; light.intensity = 4000 * Math.exp(-light.userData.t * 2.5) * (0.85 + 0.15 * Math.sin(light.userData.t * 40)); if (light.intensity < 1) light.intensity = 0; }
}
export function clearWreck() {
  for (const m of debris) W.scene.remove(m);
  for (const s of fx) W.scene.remove(s);
  debris = []; fx = [];
  if (light) light.intensity = 0;
}
