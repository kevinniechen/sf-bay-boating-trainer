// Scene construction: sky, water, terrain, city, bridges, landmarks, docks, moored boats,
// particles and markers.
import * as THREE from 'three';
import {
  BOUNDS, GX, GZ, CELL, heightGrid, landId, sdf, depthGrid, LANDMASSES, ll, toLL, fbm, vnoise, sdfAt, terrainAt,
  OUTER_WATER_XZ, outerIsWater, pointInPoly, distToPolyline, DEM, demAt, MAIN_LL, REGION_LL, LAND_H,
} from './geo.js';
import { env, chopData, CGX, CGZ, WAVES, SWELL, sunPosition, currentAt, KN, baseWindKn } from './env.js';
import { STRUCTS, MOORED, MOORINGS, NAV_AIDS, SEA_LIONS, SPECIAL, GUEST_SPOTS, SITES } from './docks.js';
import {
  GB, MAT, hull, buildPowerboat, buildSailboat, buildTallShip, buildTanker, buildCruiseShip, buildRIB, buildBuoy,
  buildMooringBall, buildHouseboat, buildSeaLion, buildFishing, buildFerryMono, buildCarCarrier,
} from './models.js';

export const W = {};

// ---------------------------------------------------------------- aerial perspective (all built-in materials)
// Replaces three's distance fog with: haze that thins with altitude (the marine haze hugs the water,
// so ridgelines stay crisp while the far waterline goes soft) and that warms toward the sun.
// World position comes from mvPosition (works for meshes, instancing, sprites and points).
export const HAZE = { uHazeSun: { value: new THREE.Vector3(0, 1, 0) }, uHazeSunCol: { value: new THREE.Color(1, 0.9, 0.75) }, uHazeH: { value: 380 }, uFogTop: { value: 0 }, uFogTime: { value: 0 } };
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogWorld;\n#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\n vFogDepth = - mvPosition.z; vFogWorld = (inverse(viewMatrix) * mvPosition).xyz;\n#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
 uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
 uniform vec3 uHazeSun; uniform vec3 uHazeSunCol; uniform float uHazeH; uniform float uFogTop; uniform float uFogTime;
 float fogVN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
   float a = fract(sin(dot(i, vec2(127.1,311.7)))*43758.5), b = fract(sin(dot(i+vec2(1,0), vec2(127.1,311.7)))*43758.5);
   float c = fract(sin(dot(i+vec2(0,1), vec2(127.1,311.7)))*43758.5), d = fract(sin(dot(i+vec2(1,1), vec2(127.1,311.7)))*43758.5);
   return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
 #ifdef FOG_EXP2
  uniform float fogDensity;
 #else
  uniform float fogNear; uniform float fogFar;
 #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
 vec3 fRay = vFogWorld - cameraPosition; float fDist = length(fRay);
 float fH = max(uHazeH, 1.0), fCam = max(cameraPosition.y, 0.0), fDy = fRay.y;
 float fK = abs(fDy) > 0.5 ? (exp(-fCam / fH) - exp(-(fCam + fDy) / fH)) / (fDy / fH) : exp(-fCam / fH);
 float fEff = uHazeH > 0.5 ? fDist * clamp(fK * 1.25 + 0.15, 0.15, 1.6) : fDist;
 #ifdef FOG_EXP2
  float fogFactor = 1.0 - exp(- fogDensity * fogDensity * fEff * fEff);
 #else
  float fogFactor = smoothstep(fogNear, fogFar, fEff);
  if (uFogTop > 0.5) {
   // marine layer: only the part of the ray below the fog top counts; density drifts in patchy banks
   float cy = cameraPosition.y, inside;
   if (cy < uFogTop) inside = fDy > 0.01 ? fDist * clamp((uFogTop - cy) / fDy, 0.0, 1.0) : fDist;
   else inside = fDy < -0.01 ? fDist * (1.0 - clamp((cy - uFogTop) / -fDy, 0.0, 1.0)) : 0.0;
   vec2 fq = vFogWorld.xz * 0.0022 + uFogTime * vec2(0.012, 0.004);
   float patchy = 0.45 + 1.0 * fogVN(fq) * fogVN(fq * 2.7 + 3.1) + 0.25 * fogVN(fq * 0.4);
   fogFactor = 1.0 - exp(-inside * 3.0 / fogFar * patchy);
  }
 #endif
 float fSun = pow(max(dot(fRay / max(fDist, 0.001), uHazeSun), 0.0), 6.0);
 gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, uHazeSunCol, fSun * 0.65), fogFactor);
#endif`;
// attach the shared haze uniforms to a material (chains any existing onBeforeCompile)
const hazed = new WeakSet();
export function hazeify(mat) {
  if (!mat || hazed.has(mat)) return; hazed.add(mat);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (sh, r) { Object.assign(sh.uniforms, HAZE); if (prev) prev.call(this, sh, r); };
  // three caches programs by onBeforeCompile.toString(): this wrapper is identical for every material,
  // so key on the wrapped hook too, or custom shaders (buildings, terrain…) silently share a plain program
  const key = 'hz|' + (prev ? prev.toString() : '');
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}
export function hazeifyScene(root) { root.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(hazeify); }); }

// ---------------------------------------------------------------- quality presets
// dpr = max render-resolution multiplier (dynamic resolution scales below it),
// fps = frame cap (ProMotion displays run rAF at 120 Hz — rendering every frame doubles heat),
// waterSeg = near-water grid density, drawDist = AI vessel draw distance (m).
export const QUALITY = {
  battery: { label: 'Battery saver (30 fps)', dpr: 1.0, fps: 30, waterSeg: 150, drawDist: 7000 },
  balanced: { label: 'Balanced (60 fps)', dpr: 1.35, fps: 60, waterSeg: 210, drawDist: 11000 },
  high: { label: 'High (up to 120 fps, Retina)', dpr: 2.0, fps: 120, waterSeg: 280, drawDist: 15000 },
};
export function setQuality(name) {
  const q = QUALITY[name] || QUALITY.balanced;
  W.qualityName = QUALITY[name] ? name : 'balanced'; W.q = q;
  W.dprMax = Math.min(q.dpr, window.devicePixelRatio || 1);
  W.dpr = W.dprMax;
  if (W.renderer) W.renderer.setPixelRatio(W.dpr);
  if (W.waterInner && W.waterInner.userData.seg !== q.waterSeg) {
    W.waterInner.geometry.dispose();
    W.waterInner.geometry = new THREE.PlaneGeometry(700, 700, q.waterSeg, q.waterSeg).rotateX(-Math.PI / 2);
    W.waterInner.userData.seg = q.waterSeg;
  }
}
export function setDpr(d) { W.dpr = Math.max(0.6, Math.min(W.dprMax, d)); W.renderer.setPixelRatio(W.dpr); }
const D2R = Math.PI / 180;

// ============================================================================ init
export function initWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  W.renderer = renderer;
  const scene = new THREE.Scene();
  W.scene = scene;
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 90000);
  W.camera = camera;
  scene.fog = new THREE.Fog(0xc9d6e0, 2000, 30000);

  W.sun = new THREE.DirectionalLight(0xffffff, 2.2);
  W.sun.position.set(1000, 2000, 500);
  // soft shadows in a ~180 m box that follows the boat (boats, docks, piers)
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  W.sun.castShadow = true;
  W.sun.shadow.mapSize.set(2048, 2048);
  Object.assign(W.sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 6000 });
  W.sun.shadow.bias = -0.0003; W.sun.shadow.normalBias = 0.4;
  scene.add(W.sun); scene.add(W.sun.target);
  W.hemi = new THREE.HemisphereLight(0xa9c6e8, 0x4b4a3c, 0.8);
  scene.add(W.hemi);

  buildSky();
  buildWater();
  buildTerrain();
  buildBackdrop();
  buildCity();
  buildTrees();
  buildBridges();
  buildLandmarks();
  buildDockMeshes();
  buildMooredBoats();
  buildNavAids();
  buildSpecials();
  // everything built so far (land, city, bridges, docks…) shows up in the water's reflection cube
  for (const o of scene.children) if (o !== W.waterInner && o !== W.waterOuter) o.layers.enable(1);  // incl. lights, or the cube renders unlit
  if (W.docks) { W.docks.castShadow = true; W.docks.receiveShadow = true; }
  for (const m of W.mooredMeshes || []) { m.castShadow = true; m.receiveShadow = true; }
  buildFogBank();
  buildNightLights();
  buildParticles();
  buildMarkers();
  hazeifyScene(scene);
  for (const k of Object.keys(MAT)) hazeify(MAT[k]);

  setQuality(W.qualityName || 'balanced');
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  });
}

// ============================================================================ sky
// Physically based atmospheric scattering (Preetham et al., as in three.js examples/Sky.js),
// tuned for a clear-but-hazy October afternoon on the Bay: deep blue overhead, milky horizon.
const SKY_VS = `
uniform vec3 sunPosition; uniform float rayleigh; uniform float turbidity; uniform float mieCoefficient; uniform vec3 up;
varying vec3 vWorldPosition; varying vec3 vSunDirection; varying float vSunfade; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
const float e = 2.718281828459045; const float pi = 3.141592653589793;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float cutoffAngle = 1.6110731556870734; const float steepness = 1.5; const float EE = 1000.0;
float sunIntensity(float c) { c = clamp(c, -1.0, 1.0); return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(c)) / steepness))); }
vec3 totalMie(float T) { float c = (0.2 * T) * 10E-18; return 0.434 * c * MieConst; }
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0); vWorldPosition = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w * 0.99999;
  vSunDirection = normalize(sunPosition); vSunE = sunIntensity(dot(vSunDirection, up));
  vSunfade = 1.0 - clamp(1.0 - exp((sunPosition.y / 450000.0)), 0.0, 1.0);
  float rc = rayleigh - (1.0 * (1.0 - vSunfade));
  vBetaR = totalRayleigh * rc; vBetaM = totalMie(turbidity) * mieCoefficient;
}`;
const SKY_FS = `
varying vec3 vWorldPosition; varying vec3 vSunDirection; varying float vSunfade; varying vec3 vBetaR; varying vec3 vBetaM; varying float vSunE;
uniform float mieDirectionalG; uniform vec3 up; uniform float uExposure; uniform float uNight; uniform float uFog; uniform vec3 uFogCol; uniform float uTime; uniform float uFogTop;
const float pi = 3.141592653589793; const float rayleighZenithLength = 8.4E3; const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.99995667694644844;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075; const float ONE_OVER_FOURPI = 0.07957747154594767;
float rayleighPhase(float c) { return THREE_OVER_SIXTEENPI * (1.0 + pow(c, 2.0)); }
float hgPhase(float c, float g) { float g2 = pow(g, 2.0); return ONE_OVER_FOURPI * ((1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5)); }
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  float zenithAngle = acos(max(0.0, dot(up, direction)));
  float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
  float sR = rayleighZenithLength * inverse; float sM = mieZenithLength * inverse;
  vec3 Fex = exp(-(vBetaR * sR + vBetaM * sM));
  float cosTheta = dot(direction, vSunDirection);
  vec3 betaRTheta = vBetaR * rayleighPhase(cosTheta * 0.5 + 0.5);
  vec3 betaMTheta = vBetaM * hgPhase(cosTheta, mieDirectionalG);
  vec3 Lin = pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * Fex, vec3(0.5)), clamp(pow(1.0 - dot(up, vSunDirection), 5.0), 0.0, 1.0));
  vec3 L0 = vec3(0.1) * Fex;
  float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta);
  L0 += (vSunE * 19000.0 * Fex) * sundisk;
  vec3 texColor = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  vec3 col = pow(texColor, vec3(1.0 / (1.2 + (1.2 * vSunfade)))) * uExposure;
  // thin October haze just above the horizon (much clearer than summer)
  float hz = 1.0 - smoothstep(0.0, 0.06, direction.y);
  col = mix(col, col * 0.7 + vec3(0.30, 0.33, 0.36) * uExposure * clamp(vSunE / 600.0, 0.15, 1.0), hz * 0.22);
  // wisps of high cirrus drifting from the west, lit by the sun (warm near it)
  if (direction.y > 0.02) {
    vec2 cp = direction.xz / (direction.y + 0.12) * 1.6 + vec2(uTime * 0.0015, 0.0);
    float c = n2(cp * vec2(0.9, 3.2)) * 0.6 + n2(cp * vec2(2.1, 7.0)) * 0.3 + n2(cp * 5.0) * 0.1;
    c = smoothstep(0.58, 0.9, c) * smoothstep(0.02, 0.25, direction.y) * (1.0 - smoothstep(0.6, 0.95, direction.y));
    vec3 cc = vec3(1.0, 0.97, 0.93) * clamp(vSunE / 700.0, 0.05, 1.0) * uExposure * (1.0 + 1.5 * pow(max(cosTheta, 0.0), 8.0));
    col = mix(col, cc, c * 0.28);
  }
  // ---- clear-day polariser: deepen the blue toward the zenith (Preetham alone reads washed out)
  float sunAlt = vSunDirection.y, dayK = smoothstep(0.05, 0.35, sunAlt);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, mix(vec3(lum), col, 1.5) * vec3(0.78, 0.92, 1.15), dayK * smoothstep(0.02, 0.5, direction.y));
  // clear October blue: pale at the horizon, deep cobalt overhead
  vec3 grad = mix(vec3(0.52, 0.70, 0.92), vec3(0.07, 0.25, 0.76), pow(smoothstep(0.0, 0.7, max(direction.y, 0.0)), 0.55)) * uExposure * 1.3;
  col = mix(col, grad, dayK * 0.84 * smoothstep(0.0, 0.07, direction.y) * (1.0 - uFog));
  // ---- twilight: warm glow on the horizon toward the sun, pink "Belt of Venus" over the earth's shadow opposite
  vec2 hd = normalize(direction.xz + 1e-5), sd2 = normalize(vSunDirection.xz + 1e-5);
  float toward = dot(hd, sd2) * 0.5 + 0.5;
  float twi = smoothstep(-0.24, -0.03, sunAlt) * (1.0 - smoothstep(0.02, 0.16, sunAlt));
  float el = max(direction.y, 0.0);
  vec3 glow = mix(vec3(1.0, 0.36, 0.10), vec3(0.95, 0.55, 0.62), smoothstep(0.0, 0.18, el));
  col += glow * exp(-el * 9.0) * pow(toward, 3.0) * twi * 0.55 * uExposure;
  float belt = smoothstep(0.03, 0.09, el) * (1.0 - smoothstep(0.12, 0.32, el)) * pow(1.0 - toward, 2.0);
  col += vec3(0.62, 0.38, 0.48) * belt * twi * 0.22 * uExposure;
  col = mix(col, col * vec3(0.55, 0.62, 0.85), (1.0 - smoothstep(0.0, 0.05, el)) * pow(1.0 - toward, 2.0) * twi * 0.6);   // earth shadow
  // ---- night: deep navy gradient, sodium glow of the city on the horizon, twinkling stars
  vec3 nightC = mix(vec3(0.020, 0.030, 0.065), vec3(0.004, 0.007, 0.020), smoothstep(0.0, 0.6, el)) + vec3(0.09, 0.05, 0.025) * exp(-el * 14.0);
  col = max(col, nightC * uNight * uExposure * 2.0);
  // the sun: a blinding core + corona the bloom/rays can feed on
  col += vec3(1.0, 0.96, 0.88) * (pow(max(cosTheta, 0.0), 2600.0) * 14.0 + pow(max(cosTheta, 0.0), 260.0) * 0.9) * smoothstep(-0.02, 0.06, sunAlt) * uExposure * (1.0 - uFog);
  if (uNight > 0.0 && direction.y > 0.03) {
    vec3 q = floor(direction * 520.0); float hs = h3(q);
    float st = step(0.9975, hs) * smoothstep(0.03, 0.35, direction.y);
    float tw = 0.55 + 0.45 * sin(uTime * (2.0 + 5.0 * h3(q + 7.7)) + hs * 60.0);
    col += vec3(0.9, 0.92, 1.0) * st * uNight * tw * (0.4 + 0.9 * h3(q + 3.1));
  }
  if (uFogTop > 0.5) {
    // inside the marine layer: looking up you see the sun's glow through thinning fog
    float inside = uFogTop / max(direction.y, 0.02);
    float ff = 1.0 - exp(-inside * 0.0085);
    col = mix(col, uFogCol, ff);
  } else col = mix(col, uFogCol, uFog * (1.0 - smoothstep(0.0, 0.35, direction.y)));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      sunPosition: { value: new THREE.Vector3(0, 1, 0) }, up: { value: new THREE.Vector3(0, 1, 0) },
      turbidity: { value: 1.7 }, rayleigh: { value: 2.1 }, mieCoefficient: { value: 0.0026 }, mieDirectionalG: { value: 0.86 }, uTime: { value: 0 },
      uExposure: { value: 0.52 }, uNight: { value: 0 }, uFog: { value: 0 }, uFogCol: { value: new THREE.Color('#c7ccd0') }, uFogTop: HAZE.uFogTop,
    },
    vertexShader: SKY_VS, fragmentShader: SKY_FS,
  });
}
function buildSky() {
  W.sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 24), makeSkyMaterial());
  W.sky.renderOrder = -1; W.sky.frustumCulled = false;
  W.sky.layers.enable(1);
  W.scene.add(W.sky);
  // a sky-only scene for image-based lighting (PMREM) of the boats/docks
  W.envScene = new THREE.Scene();
  W.envSky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), W.sky.material);
  W.envScene.add(W.envSky);
  W.pmrem = new THREE.PMREMGenerator(W.renderer);
  // live reflection cube (sky + hills + city + bridges) for the water
  W.reflRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  W.reflCam = new THREE.CubeCamera(2, 80000, W.reflRT);
  W.reflCam.layers.set(1);
  W.scene.add(W.reflCam);
}
let envSunKey = '';
// Read the actual sky colour at the horizon (all round, and toward the sun) from a tiny render,
// so distance haze always matches the sky. Only runs when the sun moves.
const hzRT = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType });
const hzCam = new THREE.PerspectiveCamera(60, 1, 0.1, 5000), hzBuf = new Uint16Array(8 * 8 * 4);
W.horizon = new THREE.Color('#bccbd5'); W.horizonSun = new THREE.Color('#e8d7bd');
function sampleHorizon(sd) {
  const r = W.renderer, acc = new THREE.Color(0, 0, 0), sunAz = Math.atan2(sd.x, -sd.z);
  let best = null;
  for (let i = 0; i < 6; i++) {
    const az = sunAz + i * Math.PI / 3;
    hzCam.position.set(0, 0, 0); hzCam.lookAt(Math.sin(az), 0.03, -Math.cos(az));
    r.setRenderTarget(hzRT); r.render(W.envScene, hzCam);
    r.readRenderTargetPixels(hzRT, 0, 3, 8, 1, hzBuf);
    const c = new THREE.Color(THREE.DataUtils.fromHalfFloat(hzBuf[16]), THREE.DataUtils.fromHalfFloat(hzBuf[17]), THREE.DataUtils.fromHalfFloat(hzBuf[18]));
    acc.r += c.r / 6; acc.g += c.g / 6; acc.b += c.b / 6;
    if (i === 0) best = c;
  }
  r.setRenderTarget(null);
  W.horizon.copy(acc); W.horizonSun.copy(best);
}
function updateEnvironment(sd) {
  const key = `${Math.round(sd.x * 60)},${Math.round(sd.y * 60)},${Math.round(sd.z * 60)},${Math.round(env.fog * 10)}`;
  if (key === envSunKey) return;
  envSunKey = key;
  try { sampleHorizon(sd); } catch (e) { /* readback unsupported: keep defaults */ }
  const old = W.envRT;
  W.envRT = W.pmrem.fromScene(W.envScene, 0, 0.1, 2000);
  W.scene.environment = W.envRT.texture;
  if (old) old.dispose();
}

// ============================================================================ water
// Tiling ripple normal map: a sum of integer-frequency waves is exactly periodic, so it tiles.
function rippleNormalMap(size = 256) {
  const waves = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let n = 0; n < 48; n++) {
    const kx = Math.round((rnd() * 2 - 1) * 14), ky = Math.round((rnd() * 2 - 1) * 14);
    if (!kx && !ky) continue;
    const k = Math.hypot(kx, ky);
    waves.push([kx, ky, 1 / Math.pow(k, 1.35), rnd() * Math.PI * 2]);
  }
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let dx = 0, dy = 0;
    const u = i / size, v = j / size;
    for (const [kx, ky, a, ph] of waves) { const c = Math.cos(2 * Math.PI * (kx * u + ky * v) + ph) * a * 2 * Math.PI; dx += c * kx; dy += c * ky; }
    const nx = -dx * 0.012, ny = -dy * 0.012, nz = 1, l = Math.hypot(nx, ny, nz);
    const o = (j * size + i) * 4;
    data[o] = (nx / l * 0.5 + 0.5) * 255; data[o + 1] = (ny / l * 0.5 + 0.5) * 255; data[o + 2] = (nz / l * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
function buildWater() {
  const tex = new THREE.DataTexture(new Uint8Array(CGX * CGZ * 4), CGX, CGZ, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  W.chopTex = tex;
  // depth texture (metres/40) for water colour: sediment-brown over the flats, green-teal in the channels
  const dd = new Uint8Array(CGX * CGZ * 4);
  for (let j = 0; j < CGZ; j++) for (let i = 0; i < CGX; i++) {
    const gi = Math.min(GX - 1, i * 4), gj = Math.min(GZ - 1, j * 4), d = depthGrid[gj * GX + gi];
    dd[(j * CGX + i) * 4] = Math.max(0, Math.min(255, (d < 0 ? 0 : d) / 40 * 255));
  }
  const dtex = new THREE.DataTexture(dd, CGX, CGZ, THREE.RGBAFormat);
  dtex.magFilter = THREE.LinearFilter; dtex.minFilter = THREE.LinearFilter; dtex.needsUpdate = true;
  const waves = WAVES.map(w => new THREE.Vector4(w.len, w.amp, w.off, 0));
  const uniforms = {
    uTime: { value: 0 }, uWindTo: { value: 0 }, uChop: { value: tex }, uDepth: { value: dtex }, uRipple: { value: rippleNormalMap() },
    uEnv: { value: W.reflRT.texture },
    uBMin: { value: new THREE.Vector2(BOUNDS.minX, BOUNDS.minZ) },
    uBSize: { value: new THREE.Vector2((CGX - 1) * 100, (CGZ - 1) * 100) },
    uWaves: { value: waves }, uSwell: { value: new THREE.Vector2(SWELL.len, SWELL.dirDeg * D2R) },
    uCenter: { value: new THREE.Vector2() }, uFadeR: { value: 330 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
    uFogColor: { value: new THREE.Color('#c9d6e0') }, uHazeCol: HAZE.uHazeSunCol, uFogNear: { value: 2000 }, uFogFar: { value: 30000 },
    uLight: { value: 1 }, uWind: { value: 0.5 },
  };
  const vs = `
    uniform float uTime; uniform float uWindTo; uniform sampler2D uChop; uniform vec2 uBMin; uniform vec2 uBSize;
    uniform vec4 uWaves[4]; uniform vec2 uSwell; uniform vec2 uCenter; uniform float uFadeR;
    varying vec3 vW; varying vec2 vGrad; varying float vChop; varying float vCrest; varying vec2 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vec2 uv = (wp.xz - uBMin) / uBSize; vUv = uv;
      vec4 cs = texture2D(uChop, uv);
      float chop = cs.r * 2.0, swell = cs.g * 2.0;
      float fade = 1.0 - smoothstep(uFadeR * 0.55, uFadeR, length(wp.xz - uCenter));
      float h = 0.0; vec2 g = vec2(0.0); float amp = 0.001;
      for (int i = 0; i < 4; i++) {
        float a = uWindTo + uWaves[i].z; float k = 6.2831853 / uWaves[i].x; float c = sqrt(9.81 / k);
        vec2 d = vec2(sin(a), -cos(a)); float ph = dot(d, wp.xz) * k - c * k * uTime;
        float A = uWaves[i].y * chop; h += sin(ph) * A; g += d * k * A * cos(ph); amp += A;
      }
      { float a = uSwell.y; float k = 6.2831853 / uSwell.x; float c = sqrt(9.81 / k);
        vec2 d = vec2(sin(a), -cos(a)); float ph = dot(d, wp.xz) * k - c * k * uTime;
        h += sin(ph) * swell; g += d * k * swell * cos(ph); }
      vCrest = h / (amp + swell + 0.001);
      h *= fade; g *= fade;
      wp.y += h; vW = wp.xyz; vGrad = g; vChop = chop;
      gl_Position = projectionMatrix * viewMatrix * wp;
      #include <logdepthbuf_vertex>
    }`;
  const fs = `
    uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform samplerCube uEnv; uniform sampler2D uDepth; uniform sampler2D uRipple;
    uniform vec3 uFogColor; uniform vec3 uHazeCol; uniform float uFogNear; uniform float uFogFar; uniform float uLight; uniform float uWindTo; uniform float uWind;
    varying vec3 vW; varying vec2 vGrad; varying float vChop; varying float vCrest; varying vec2 vUv;
    #include <logdepthbuf_pars_fragment>
    float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(hsh(i), hsh(i+vec2(1,0)), f.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), f.x), f.y); }
    vec2 rip(vec2 p) { return texture2D(uRipple, p).xy * 2.0 - 1.0; }
    void main(){
      #include <logdepthbuf_fragment>
      vec3 V = cameraPosition - vW; float dist = length(V); V /= dist;
      float far = smoothstep(120.0, 2600.0, dist);
      vec2 wd = vec2(sin(uWindTo), -cos(uWindTo));
      // three scrolling ripple layers; strength follows the local wind ("catspaws" from the gust noise)
      float gust = 0.55 + 0.9 * vn(vW.xz * 0.004 + wd * uTime * 0.02);
      float rs = (0.08 + vChop * 0.35 + uWind * 0.18) * gust * (1.0 - far * 0.9);
      vec2 r1 = rip(vW.xz / 23.0 + wd * uTime * 0.035);
      vec2 r2 = rip(vW.xz / 7.3 + vec2(wd.y, -wd.x) * uTime * 0.06);
      vec2 r3 = rip(vW.xz / 2.1 - wd * uTime * 0.11);
      vec2 rg = (r1 * 0.55 + r2 * 0.35 + r3 * 0.25 * (1.0 - smoothstep(10.0, 90.0, dist))) * rs;
      vec3 N = normalize(vec3(-vGrad.x - rg.x, 1.0, -vGrad.y - rg.y));
      float NdV = max(dot(N, V), 0.001);
      // reflections use a calmer normal (ripples tilt real reflections only ~10°); glitter keeps full detail
      // At grazing view angles the wave backs that tilt away from us are hidden behind crests in reality;
      // flatten the reflection normal by view angle so they don't show up as bright horizon-coloured facets.
      float slopeK = clamp(V.y * 5.0, 0.18, 1.0);
      vec3 Nr = normalize(vec3((-vGrad.x - rg.x * 0.3) * slopeK, 1.0, (-vGrad.y - rg.y * 0.3) * slopeK));
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(Nr, V), 0.001), 5.0);
      vec3 R = reflect(-V, Nr);
      float upR = smoothstep(-0.30, 0.12, R.y);       // facets reflecting below the horizon see other waves, not land
      R.y = max(R.y, 0.02);
      // mip bias = cheap rough-surface blur: choppy near water smears the reflected shoreline like the real thing
      vec3 refl = textureCube(uEnv, R, mix(3.2, 1.0, far) + vChop * 1.2).rgb;   // cube render targets need no X flip
      // body colour: San Francisco Bay is turbid — green-grey, browner where it's shallow and muddy
      float dep = texture2D(uDepth, vUv).r * 40.0;
      vec3 deep = vec3(0.018, 0.060, 0.062), mid = vec3(0.030, 0.080, 0.070), shoal = vec3(0.085, 0.100, 0.065);
      vec3 body = mix(shoal, mix(mid, deep, smoothstep(8.0, 30.0, dep)), smoothstep(0.8, 6.0, dep));
      float sunUp = clamp(uSunDir.y * 3.0, 0.0, 1.0);
      body *= 0.25 + 0.75 * uLight;
      // light scattering through the backs of the waves when looking toward the sun
      float sss = pow(max(dot(-V, uSunDir) * 0.5 + 0.5, 0.0), 3.0) * clamp(vCrest * 0.5 + 0.5, 0.0, 1.0) * sunUp;
      body += vec3(0.04, 0.10, 0.08) * sss * (0.4 + vChop);
      // the cube's horizon band (shoreline/haze edge) aliases into hard facets on chop: fade it to the
      // sampled horizon colour for low reflection angles, keep the cube for the sky above
      refl = mix(uFogColor * vec3(0.74, 0.79, 0.84), refl, mix(1.0, smoothstep(0.03, 0.16, R.y), clamp(uWind * 2.2 + vChop * 0.8, 0.0, 1.0)));   // glassy water stays a mirror
      refl = mix(body * 2.2 + uFogColor * 0.35, refl, upR);
      vec3 col = mix(body, refl * 0.92, F);
      // GGX sun glitter — roughness grows with wind, so a breezy afternoon gives a broad glitter path
      vec3 L = normalize(uSunDir), H = normalize(L + V);
      float NdL = max(dot(N, L), 0.0), NdH = max(dot(N, H), 0.0);
      float a = mix(0.06, 0.22, clamp(uWind + vChop, 0.0, 1.0)); float a2 = a * a;
      float dn = NdH * NdH * (a2 - 1.0) + 1.0; float D = a2 / (3.14159 * dn * dn);
      float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      float spec = D * Fs * NdL / (4.0 * NdV * max(NdL, 0.05) + 0.001);
      col += uSunCol * min(spec, 60.0) * sunUp * 0.9;
      // whitecaps
      vec2 fp = vec2(dot(vW.xz, wd), dot(vW.xz, vec2(-wd.y, wd.x)));
      // whitecaps: only on the steepest crests, broken into wind-aligned streaks with fine noise
      float foamN = vn(fp * vec2(0.6, 2.2) + uTime * 0.25) * vn(fp * vec2(3.1, 9.0) - uTime * 0.4);
      float streak = vn(fp * vec2(1.2, 14.0) + uTime * 0.6);
      float foam = smoothstep(0.80, 1.0, vCrest) * smoothstep(0.45, 1.1, vChop) * smoothstep(0.18, 0.42, foamN) * (0.4 + 0.6 * streak);
      col = mix(col, vec3(0.78, 0.82, 0.82) * max(uLight, 0.25), clamp(foam, 0.0, 1.0) * 0.55 * (1.0 - far));
      float fogF = smoothstep(uFogNear, uFogFar, dist * clamp(exp(-cameraPosition.y / 420.0) * 1.25 + 0.15, 0.15, 1.6));
      float sunScat = pow(max(dot(-V, uSunDir), 0.0), 6.0);
      col = mix(col, mix(uFogColor, uHazeCol, sunScat * 0.65), fogF);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs });
  W.waterMat = mat;
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 210, 210).rotateX(-Math.PI / 2), mat);
  inner.userData.seg = 210;
  inner.frustumCulled = false;
  const outer = new THREE.Mesh(new THREE.RingGeometry(320, 70000, 64, 8).rotateX(-Math.PI / 2), mat);
  outer.frustumCulled = false; outer.position.y = -0.02;
  W.scene.add(inner); W.scene.add(outer);
  W.waterInner = inner; W.waterOuter = outer;
}

const _cc = { x: 0, z: 0 };
export function updateChopTexture() {
  const d = W.chopTex.image.data;
  for (let j = 0; j < CGZ; j++) for (let i = 0; i < CGX; i++) {
    const k = j * CGX + i;
    d[k * 4] = Math.min(255, chopData[k * 2] * 127.5);
    d[k * 4 + 1] = Math.min(255, chopData[k * 2 + 1] * 127.5);
    currentAt(BOUNDS.minX + i * 100, BOUNDS.minZ + j * 100, _cc); // current packed in BA for the GPU flecks
    d[k * 4 + 2] = Math.max(0, Math.min(255, (_cc.x / 10 + 0.5) * 255));
    d[k * 4 + 3] = Math.max(0, Math.min(255, (_cc.z / 10 + 0.5) * 255));
  }
  W.chopTex.needsUpdate = true;
}

// ============================================================================ terrain
const LAND_COLORS = {
  city: ['#b9b3a6', '#a9a397', '#c4bdb0'],
  hills: ['#b39a5c', '#a88d50', '#6b7442', '#556236'],
  island: ['#6d7a45', '#a8935a', '#4f5f35'],
  rock: ['#8d877a', '#7c7668'],
  flat: ['#a7a49c', '#9d9a90'],
};
function landColor(type, x, z, h, d, c) {
  const n = fbm(x / 400, z / 400), n2 = vnoise(x / 90, z / 90);
  const { lat, lon } = toLL(x, z);
  if (type === 'city') {
    if (lon < -122.447 && lat > 37.786) { c.set(n > 0.5 ? '#3f5a35' : '#56693f'); if (d < 60) c.set('#d6c8a0'); return; } // Presidio / Crissy
    c.set(LAND_COLORS.city[Math.floor(n2 * 2.99)]);
    if (d < 40) c.set('#9d978a');
    return;
  }
  if (type === 'hills' || type === 'island') {
    const green = type === 'island' ? 0.45 : 0.62;
    if (n > green) c.set(n2 > 0.5 ? '#55633a' : '#4a5833');
    else c.set(n2 > 0.5 ? '#b49b5e' : '#a68d52');
    if (h < 6 && d < 40) c.set('#cbbd97');
    // towns: Sausalito / Tiburon / Belvedere / Mill Valley are leafy & built up
    if ((lat > 37.85 && lat < 37.88 && lon > -122.505 && lon < -122.474 && d < 700) || (lat > 37.862 && lat < 37.895 && lon > -122.475 && lon < -122.445 && d < 900)) c.lerp(new THREE.Color('#7b8060'), 0.55);
    return;
  }
  c.set(LAND_COLORS[type][Math.floor(n2 * 1.99)] || '#999');
}

const texLoader = new THREE.TextureLoader();
function imageryTexture(url) {
  const t = texLoader.load(url);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  return t;
}
// Aerial photo colour is "flat" daylight; this darkens shadowed slopes and lets the scene's
// sun & sky light it like real terrain, while keeping the photo's colours.
function terrainMaterial(map) {
  const m = new THREE.MeshLambertMaterial({ map, color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.08)) * 1.25;`);
  };
  return m;
}

function buildTerrain() {
  const step = 2;
  const nx = Math.floor((GX - 1) / step) + 1, nz = Math.floor((GZ - 1) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  const useDEM = !!DEM.main;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const gi = i * step, gj = j * step, k = gj * GX + gi, v = j * nx + i;
    const x = BOUNDS.minX + gi * CELL, z = BOUNDS.minZ + gj * CELL;
    let h = heightGrid[k];
    const d = sdf[k];
    if (d <= 0) h = Math.max(-14, Math.min(-0.6, d * 0.12 - 0.6));
    pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
    const { lat, lon } = toLL(x, z);
    uv[v * 2] = (lon - MAIN_LL.lon0) / (MAIN_LL.lon1 - MAIN_LL.lon0);
    uv[v * 2 + 1] = (lat - MAIN_LL.lat0) / (MAIN_LL.lat1 - MAIN_LL.lat0);
    if (!useDEM) { if (d > 0) landColor(LANDMASSES[landId[k]].type, x, z, h, d, c); else c.set('#6b6a55'); }
    // underwater vertices only show on the faces of seawalls / pier decks: make those concrete-grey
    else if (d <= 0) c.setRGB(0.95, 0.92, 0.86);
    else c.setRGB(1, 1, 1);
    col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
    if (pos[a * 3 + 1] < -1 && pos[b * 3 + 1] < -1 && pos[cc * 3 + 1] < -1 && pos[d * 3 + 1] < -1) continue;
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = useDEM ? terrainMaterial(imageryTexture('data/imagery.jpg')) : new THREE.MeshLambertMaterial({ vertexColors: true });
  if (useDEM) {
    mat.vertexColors = true;
    // where the vertex colour says "wall", replace the stretched photo texel with concrete
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `
        float wall = smoothstep(0.995, 0.93, vColor.b);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.41, 0.39), wall);`)
        .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.08)) * 1.25;`);
    };
  }
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; m.layers.enable(1);
  W.scene.add(m); W.terrain = m;
}

// Surrounding region (East Bay hills, Mt Tam, the Peninsula) from the regional DEM + imagery.
function buildBackdrop() {
  if (!DEM.region) return;
  const N = 220, R = REGION_LL;
  const pos = [], uv = [], idx = [];
  const inMain = (lat, lon, m) => lat > MAIN_LL.lat0 + m && lat < MAIN_LL.lat1 - m && lon > MAIN_LL.lon0 + m * 1.27 && lon < MAIN_LL.lon1 - m * 1.27;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const lat = R.lat1 - (R.lat1 - R.lat0) * j / N, lon = R.lon0 + (R.lon1 - R.lon0) * i / N;
    const p = ll(lat, lon);
    let h = demAt(DEM.region, lat, lon);
    if (inMain(lat, lon, 0.004)) h = -80;            // the detailed terrain covers this area
    else if (h < LAND_H) h = -1.2;                    // open water: just below the water plane (no visible cliff at the shore)
    pos.push(p.x, h, p.z);
    uv.push((lon - R.lon0) / (R.lon1 - R.lon0), (lat - R.lat0) / (R.lat1 - R.lat0));
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    if (pos[a * 3 + 1] < -1 && pos[b * 3 + 1] < -1 && pos[c * 3 + 1] < -1 && pos[d * 3 + 1] < -1) continue;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, terrainMaterial(imageryTexture('data/region_imagery.jpg')));
  m.position.y = -0.4; m.layers.enable(1);
  W.scene.add(m);
  // Oakland port cranes + East Bay towers
  const gb = new GB();
  for (let i = 0; i < 18; i++) {
    const p = ll(37.7930 + i * 0.0011, -122.3255 + (i % 3) * 0.0004);
    gb.box(2, 55, 2, '#c0392b', p.x - 8, 27, p.z); gb.box(2, 55, 2, '#c0392b', p.x + 8, 27, p.z);
    gb.box(2, 3, 90, '#c0392b', p.x, 52, p.z, 1.2); gb.box(20, 6, 6, '#d0d0d0', p.x, 57, p.z);
  }
  for (let i = 0; i < 30; i++) {
    const p = ll(37.803 + (Math.random() - 0.5) * 0.012, -122.270 + (Math.random() - 0.5) * 0.012);
    const h = 30 + Math.random() * 110; gb.box(30, h, 30, '#b8b4ab', p.x, h / 2, p.z);
  }
  const cm = gb.mesh(); cm.layers.enable(1); W.scene.add(cm);
}

// ============================================================================ city & towns
// Real buildings: OpenStreetMap footprints & heights (data/buildings.bin, see tools/fetch_buildings.py),
// extruded and merged into ~800 m chunks (frustum-culled as units). A facade shader draws floors and
// windows from wall coordinates (no textures), and lights some windows at night.
let OSM_BUF = null;
export async function preloadBuildings() {
  try { const r = await fetch('data/buildings.bin'); if (r.ok) OSM_BUF = await r.arrayBuffer(); } catch (e) { /* optional */ }
}
const BCOL = [
  ['#e3c99c', '#9fb4c3', '#efe6d4', '#c98f6b', '#7f9a8a', '#d7b7a3', '#b8a48a', '#8a6a4c', '#7d8fa0', '#e8d9b8', '#a9b8a0', '#d3c3d8'], // houses: Victorian pastels, Marin shingle & redwood
  ['#e8e0d2', '#d6cfc1', '#cbc4b6', '#efe9de', '#d9d2c8'],                                                     // apartments
  ['#d4cdc0', '#bdb7ad', '#e3ded4', '#c7c9c9', '#ab a59b'.replace(' ', '')],                                  // commercial
  ['#b9b2a3', '#a39d91', '#c4bfb3', '#8f8a80'],                                                                 // industrial / pier sheds
  ['#d8d0bf', '#cfc6b0', '#e6dfd0'],                                                                            // civic / other
  ['#9fb2c0', '#b6c2ca', '#8496a3', '#c9ced2', '#a7aeb3'],                                                      // towers
];
W.bUniforms = { uNightB: { value: 0 } };
function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.6 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNightB = W.bUniforms.uNightB;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 bUv; varying vec3 vB;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvB = bUv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vB; uniform float uNightB;\nfloat bh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float bWin = 0.0, bLit = 0.0;
        if (vB.x >= 0.0) {
          diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.0, 4.5, vB.y));   // ground-contact AO
          float bay = vB.z > 4.5 ? 2.6 : 3.4;                 // towers: tighter curtain-wall grid
          vec2 cell = vec2(vB.x / bay, (vB.y - 0.8) / 3.3);
          vec2 f = fract(cell);
          bWin = step(0.16, f.x) * step(f.x, 0.84) * step(0.30, f.y) * step(f.y, 0.86) * step(2.2, vB.y);
          if (vB.z > 4.5) bWin = max(bWin, 0.55 * step(2.0, vB.y));  // glass towers read mostly as glass
          float floorLine = 1.0 - smoothstep(0.0, 0.06, abs(f.y - 0.12));
          diffuseColor.rgb *= 1.0 - floorLine * 0.12;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.13, 0.16), bWin * 0.72);
          bLit = bWin * step(0.56, bh(floor(cell) + vB.zz * 17.0)) * (0.55 + 0.45 * bh(floor(cell) * 1.3 + 2.0));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += mix(vec3(1.0, 0.72, 0.42), vec3(0.85, 0.92, 1.0), step(0.7, bh(floor(vB.xy / 3.0) + 5.3))) * bLit * uNightB * 1.25;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.08, bWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.75, bWin);   // glass mirrors the sky and flashes in the low sun`);
  };
  return m;
}
function buildOSMBuildings() {
  const dv = new DataView(OSM_BUF); let o = 4;
  const n = dv.getUint32(0, true);
  const chunks = new Map();
  const skip = [ll(37.7952, -122.4028), ll(37.8024, -122.4058)]; // Transamerica & Coit: drawn as their real shapes
  const c = new THREE.Color(), rc = new THREE.Color();
  let count = 0;
  for (let b = 0; b < n; b++) {
    const nv = dv.getUint16(o, true), hdm = dv.getUint16(o + 2, true), kind = dv.getUint8(o + 4); o += 6;
    const pts = [];
    for (let i = 0; i < nv; i++) { const lon = -122.43 + dv.getFloat32(o, true), lat = 37.83 + dv.getFloat32(o + 4, true); o += 8; pts.push(ll(lat, lon)); }
    let cx = 0, cz = 0; for (const p of pts) { cx += p.x; cz += p.z; } cx /= nv; cz /= nv;
    if (skip.some(q => Math.hypot(q.x - cx, q.z - cz) < 40)) continue;
    let base = 1e9; for (const p of pts) base = Math.min(base, terrainAt(p.x, p.z));
    if (base < 0.5) base = 2.5;                    // on a pier / at the shoreline
    base -= 0.6;
    const h = hdm / 10 + 0.6, top = base + h;
    // orientation: make the ring counter-clockwise in (x, z) seen from above
    let area = 0; for (let i = 0; i < nv; i++) { const a = pts[i], q = pts[(i + 1) % nv]; area += a.x * q.z - q.x * a.z; }
    if (area > 0) pts.reverse();
    const key = Math.floor(cx / 800) * 1000 + Math.floor(cz / 800);
    if (!chunks.has(key)) chunks.set(key, { p: [], n: [], c: [], u: [] });
    const ch = chunks.get(key);
    const pal = BCOL[kind] || BCOL[4];
    const hsh = Math.abs(Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5) % 1;
    c.set(pal[Math.floor(hsh * pal.length)]);
    c.offsetHSL(0, 0, (hsh - 0.5) * 0.08).multiplyScalar(0.86);
    const tag = kind === 5 ? 5 : (hsh * 4);         // bUv.z: >4.5 = tower facade, otherwise per-building seed
    let per = 0;
    for (let i = 0; i < nv; i++) {
      const a = pts[i], q = pts[(i + 1) % nv];
      const ex = q.x - a.x, ez = q.z - a.z, L = Math.hypot(ex, ez);
      if (L < 0.2) continue;
      const nx = ez / L, nz = -ex / L;
      const quad = [[a.x, base, a.z, per, 0], [q.x, base, q.z, per + L, 0], [q.x, top, q.z, per + L, h], [a.x, base, a.z, per, 0], [q.x, top, q.z, per + L, h], [a.x, top, a.z, per, h]];
      for (const [x, y, z, u, v] of quad) { ch.p.push(x, y, z); ch.n.push(nx, 0, nz); ch.c.push(c.r, c.g, c.b); ch.u.push(u, v, tag); }
      per += L;
    }
    // roofs: small houses get a hipped roof (every edge sloping up to the centroid), others stay flat
    let fa = 0; for (let i = 0; i < nv; i++) { const a = pts[i], q = pts[(i + 1) % nv]; fa += a.x * q.z - q.x * a.z; } fa = Math.abs(fa) / 2;
    const pitched = (kind === 0 || (kind === 1 && fa < 260)) && fa < 420 && h < 14 && nv <= 8;
    if (pitched) {
      rc.set(['#4a4642', '#5b3f33', '#3d4247', '#7a4b3a', '#55524c'][Math.floor(hsh * 97) % 5]);
      const rh = Math.min(3.2, 0.32 * Math.sqrt(fa)), apex = [cx, top + rh, cz];
      for (let i = 0; i < nv; i++) {
        const a = pts[i], q = pts[(i + 1) % nv];
        const ux = q.x - a.x, uz = q.z - a.z, vx = apex[0] - a.x, vy = rh, vz = apex[2] - a.z;
        let nx = -uz * vy, ny = uz * vx - ux * vz, nz = ux * vy; const l = Math.hypot(nx, ny, nz) || 1;   // (q − a) × (apex − a)
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const shade = 0.85 + 0.15 * ((i * 7 + 3) % 4) / 3;
        for (const P of [[a.x, top, a.z], [apex[0], apex[1], apex[2]], [q.x, top, q.z]]) { ch.p.push(...P); ch.n.push(nx / l, ny / l, nz / l); ch.c.push(rc.r * shade, rc.g * shade, rc.b * shade); ch.u.push(-1, -1, 0); }
      }
    } else {
      rc.copy(c).multiplyScalar(kind === 0 ? 0.62 : 0.74);
      const tris = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p.x, p.z)), []);
      for (const t of tris) for (const k of [t[0], t[2], t[1]]) { ch.p.push(pts[k].x, top, pts[k].z); ch.n.push(0, 1, 0); ch.c.push(rc.r, rc.g, rc.b); ch.u.push(-1, -1, 0); }
    }
    if (h > 45) (W.tallBuildings || (W.tallBuildings = [])).push({ i: count, x: cx, z: cz, h, top });
    if (kind === 5 || h > 55) NL.push([cx, top + 2, cz, 1, 0.08, 0.05, 2]);                // red aviation beacon (blinks)
    else if (count % 4 === 0) NL.push([pts[0].x, base + 6, pts[0].z, 1.0, 0.72, 0.42, 1]);   // street / porch light
    count++;
  }
  const mat = buildingMaterial();
  let tris = 0;
  for (const ch of chunks.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ch.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(ch.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(ch.c, 3));
    g.setAttribute('bUv', new THREE.Float32BufferAttribute(ch.u, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    W.scene.add(m);
    tris += ch.p.length / 9;
  }
  console.info(`[city] ${count} OSM buildings in ${chunks.size} chunks, ${(tris / 1e6).toFixed(2)}M triangles`);
}
function buildCity() {
  if (OSM_BUF) { buildOSMBuildings(); buildLandmarkTowers(); return; }
  const items = [];
  const rnd = Math.random;
  const tryAdd = (x, z, w, d, h, color, ry = 0) => items.push({ x, z, w, d, h, color, ry });
  const dt = ll(37.7915, -122.3990);
  const sfId = 0, marinId = 1;
  // SF
  for (let n = 0; n < 26000 && items.length < 9000; n++) {
    const x = BOUNDS.minX + rnd() * (BOUNDS.maxX - BOUNDS.minX), z = ll(37.81, 0).z + rnd() * (BOUNDS.maxZ - ll(37.81, 0).z);
    const gi = Math.round((x - BOUNDS.minX) / CELL), gj = Math.round((z - BOUNDS.minZ) / CELL);
    const k = gj * GX + gi;
    if (landId[k] !== sfId || sdf[k] < 22) continue;
    const { lat, lon } = toLL(x, z);
    if (lon < -122.4475 && lat > 37.786) continue;           // Presidio
    if (lat > 37.8035 && lon < -122.428 && lon > -122.447 && sdf[k] < 140) continue; // Marina Green / Fort Mason
    if (sdf[k] > 2600) continue;
    const dd = Math.hypot(x - dt.x, z - dt.z);
    let h, w = 14 + rnd() * 18, d = 14 + rnd() * 18;
    if (dd < 900) { h = 25 + rnd() * 110 * (1 - dd / 1000) + rnd() * 40; w = 22 + rnd() * 20; d = w; }
    else if (dd < 1700) h = 12 + rnd() * 35;
    else h = 7 + rnd() * 9 + (rnd() < 0.05 ? 15 : 0);
    const col = dd < 1700 ? ['#c9c4ba', '#b8b4ab', '#d8d2c6', '#9fa4a8', '#e2ddd2'][Math.floor(rnd() * 5)] : ['#efe8dc', '#e7dcc7', '#f4f0e8', '#d9cdb8', '#e3d6c2', '#cfd8dc', '#f2e2c7'][Math.floor(rnd() * 7)];
    tryAdd(x, z, w, d, h, col, 0.3 * (rnd() - 0.5) + (dd < 2500 ? -0.35 : 0));
  }
  // Marin towns
  const townBoxes = [[37.850, 37.876, -122.505, -122.474, 700], [37.862, 37.896, -122.476, -122.444, 900]];
  for (let n = 0; n < 12000 && items.length < 11500; n++) {
    const tb = townBoxes[n % 2];
    const lat = tb[0] + rnd() * (tb[1] - tb[0]), lon = tb[2] + rnd() * (tb[3] - tb[2]);
    const p = ll(lat, lon), gi = Math.round((p.x - BOUNDS.minX) / CELL), gj = Math.round((p.z - BOUNDS.minZ) / CELL), k = gj * GX + gi;
    if (landId[k] !== marinId || sdf[k] < 15 || sdf[k] > tb[4]) continue;
    tryAdd(p.x, p.z, 8 + rnd() * 8, 8 + rnd() * 8, 5 + rnd() * 5, ['#f4f0e8', '#e9dfcc', '#d8cdb5', '#c9d4d8', '#f2e6d0', '#b7c4b0'][Math.floor(rnd() * 6)], rnd() * 3);
  }
  // Treasure Island
  for (let n = 0; n < 400; n++) {
    const p = ll(37.817 + rnd() * 0.013, -122.375 + rnd() * 0.014);
    const gi = Math.round((p.x - BOUNDS.minX) / CELL), gj = Math.round((p.z - BOUNDS.minZ) / CELL), k = gj * GX + gi;
    if (landId[k] !== 5 || sdf[k] < 40) continue;
    tryAdd(p.x, p.z, 15 + rnd() * 30, 15 + rnd() * 30, 6 + rnd() * 10, '#cfc9bd', 0.3);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), items.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  items.forEach((it, i) => {
    const y = terrainAt(it.x, it.z) - 1;
    m4.compose(p.set(it.x, y, it.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.ry), s.set(it.w, it.h + 1, it.d));
    im.setMatrixAt(i, m4); im.setColorAt(i, c.set(it.color));
  });
  W.scene.add(im);
  buildLandmarkTowers();
}
function buildLandmarkTowers() {
  const gb = new GB();
  const skipBoxes = !!OSM_BUF;
  const tower = (lat, lon, w, h, color, taper = false) => {
    const q = ll(lat, lon), y = terrainAt(q.x, q.z) - 1;
    if (taper) { gb.cyl(w / 2, h * 0.92, color, q.x, y + h * 0.46, q.z, 12, 0, 0, 0, w * 0.42); gb.cyl(w * 0.42, h * 0.08, color, q.x, y + h * 0.96, q.z, 12, 0, 0, 0, w * 0.15); }
    else gb.box(w, h, w, color, q.x, y + h / 2, q.z, 0.4);
  };
  if (!skipBoxes) {
  tower(37.7898, -122.3969, 48, 326, '#c8ccd0', true);   // Salesforce Tower
  tower(37.7896, -122.3953, 32, 245, '#a7b0b8');           // 181 Fremont
  tower(37.7905, -122.3960, 34, 197, '#9eb0c0');           // Millennium
  tower(37.7920, -122.4035, 40, 237, '#4a4040');           // 555 California
  tower(37.7858, -122.3925, 30, 188, '#b5bec6');           // One Rincon Hill
  tower(37.7925, -122.3970, 36, 160, '#cfcac0');
  tower(37.7935, -122.3995, 38, 150, '#a8a39a');
  tower(37.7890, -122.3925, 34, 140, '#c2c6ca');
  }
  { // Transamerica Pyramid
    const q = ll(37.7952, -122.4028), y = terrainAt(q.x, q.z);
    gb.pyramid(34, 260, '#f0ece2', q.x, y + 130, q.z, Math.PI / 4 + 0.35);
  }
  { // Coit Tower on Telegraph Hill
    const q = ll(37.8024, -122.4058), y = terrainAt(q.x, q.z);
    gb.cyl(7, 64, '#ece6d6', q.x, y + 32, q.z, 12);
  }
  { // Ferry Building clock tower
    const q = ll(37.7955, -122.3935);
    gb.box(13, 75, 13, '#e3d8c0', q.x, 37, q.z); gb.box(9, 12, 9, '#e3d8c0', q.x, 80, q.z); gb.pyramid(7, 8, '#7d8a80', q.x, 90, q.z);
  }
  W.scene.add(gb.mesh());
}

function buildTrees() {
  const pts = [];
  const rnd = Math.random;
  const zones = [
    [37.788, 37.806, -122.485, -122.448, 0, 2600], // Presidio
    [37.852, 37.873, -122.448, -122.418, 2, 2600], // Angel Island
    [37.805, 37.814, -122.372, -122.358, 4, 500],  // YBI
    [37.850, 37.880, -122.505, -122.474, 1, 1500], // Sausalito hills
    [37.862, 37.900, -122.478, -122.440, 1, 1800], // Tiburon/Belvedere
    [37.826, 37.850, -122.505, -122.470, 1, 600],  // Fort Baker
  ];
  for (const [la0, la1, lo0, lo1, id, n] of zones) {
    for (let i = 0; i < n; i++) {
      const p = ll(la0 + rnd() * (la1 - la0), lo0 + rnd() * (lo1 - lo0));
      const gi = Math.round((p.x - BOUNDS.minX) / CELL), gj = Math.round((p.z - BOUNDS.minZ) / CELL), k = gj * GX + gi;
      if (landId[k] !== id || sdf[k] < 12) continue;
      if (fbm(p.x / 400, p.z / 400) < (id === 1 ? 0.5 : 0.35)) continue;
      pts.push(p);
    }
  }
  const geo = new THREE.ConeGeometry(1, 1, 6); geo.translate(0, 0.5, 0);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x3c5230 }), pts.length);
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  pts.forEach((p, i) => {
    const h = 9 + Math.random() * 14, r = 3 + Math.random() * 3;
    m4.makeScale(r, h, r); m4.setPosition(p.x, terrainAt(p.x, p.z) - 1, p.z);
    im.setMatrixAt(i, m4); im.setColorAt(i, c.setHSL(0.27 + Math.random() * 0.06, 0.3, 0.18 + Math.random() * 0.08));
  });
  W.scene.add(im);
}

// ============================================================================ bridges
export const BRIDGE_PIERS = [];
function cableTube(points, radius, color) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(20, points.length * 4), radius, 5, false), new THREE.MeshLambertMaterial({ color }));
}
function suspension(scene, A, B, yA, yB, towerTopA, towerTopB, deckY, color, sag) {
  // returns points of a cable between two tower tops
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = A.x + (B.x - A.x) * t, z = A.z + (B.z - A.z) * t;
    const lin = towerTopA + (towerTopB - towerTopA) * t;
    const y = lin - sag * 4 * t * (1 - t);
    pts.push(new THREE.Vector3(x, Math.max(y, deckY + 2), z));
  }
  return pts;
}

function buildBridges() {
  const scene = W.scene;
  // ------------------------------------------------ Golden Gate
  {
    const orange = '#c0362c';
    const S = ll(37.8115, -122.4777), N = ll(37.8230, -122.4788);
    const SA = ll(37.8080, -122.4762), NA = ll(37.8285, -122.4805);
    const dx = N.x - S.x, dz = N.z - S.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = -uz, pz = ux;
    const br = Math.atan2(ux, -uz);
    const gb = new GB();
    const deckY = 67, topY = 227;
    for (const T of [S, N]) {
      for (const s of [-1, 1]) gb.box(10, topY, 10, orange, T.x + px * s * 14, topY / 2, T.z + pz * s * 14, -br);
      for (const y of [deckY + 25, 130, 170, 205, topY - 4]) gb.box(30, 7, 6, orange, T.x, y, T.z, -br + Math.PI / 2);
      gb.box(55, 6, 40, '#8a8580', T.x, 2, T.z, -br);
      BRIDGE_PIERS.push({ kind: 'bridge', cx: T.x, cz: T.z, hl: 22, hw: 32, rot: br, h: 0 });
    }
    // deck from anchorage to anchorage
    const dL = Math.hypot(NA.x - SA.x, NA.z - SA.z), cx = (SA.x + NA.x) / 2, cz = (SA.z + NA.z) / 2;
    const dbr = Math.atan2(NA.x - SA.x, -(NA.z - SA.z));
    gb.box(27, 4, dL, orange, cx, deckY, cz, -dbr);
    gb.box(27, 3, dL, '#5b5b5b', cx, deckY + 2.5, cz, -dbr);
    gb.box(25, 6, dL, '#9a3027', cx, deckY - 4, cz, -dbr);
    scene.add(gb.mesh());
    const cableMat = new THREE.LineBasicMaterial({ color: orange });
    for (const s of [-1, 1]) {
      const off = (P) => ({ x: P.x + px * s * 14, z: P.z + pz * s * 14 });
      const s0 = off(SA), s1 = off(S), s2 = off(N), s3 = off(NA);
      const main = suspension(scene, s1, s2, topY, topY, topY, topY, deckY, orange, topY - deckY - 4);
      const sideA = [new THREE.Vector3(s0.x, deckY + 8, s0.z), new THREE.Vector3((s0.x + s1.x) / 2, (deckY + topY) / 2 - 20, (s0.z + s1.z) / 2), new THREE.Vector3(s1.x, topY, s1.z)];
      const sideB = [new THREE.Vector3(s2.x, topY, s2.z), new THREE.Vector3((s2.x + s3.x) / 2, (deckY + topY) / 2 - 20, (s2.z + s3.z) / 2), new THREE.Vector3(s3.x, deckY + 8, s3.z)];
      scene.add(cableTube(main, 0.9, orange)); scene.add(cableTube(sideA, 0.9, orange)); scene.add(cableTube(sideB, 0.9, orange));
      const seg = [];
      for (let i = 1; i < main.length - 1; i++) { seg.push(main[i].x, main[i].y, main[i].z, main[i].x, deckY, main[i].z); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      scene.add(new THREE.LineSegments(lg, cableMat));
    }
  }
  // ------------------------------------------------ Bay Bridge west span
  {
    const grey = '#9aa5ad';
    const A = ll(37.7885, -122.3890), B = ll(37.8100, -122.3660);
    const P = (t) => ({ x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t });
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = -uz, pz = ux;
    const br = Math.atan2(ux, -uz);
    const gb = new GB();
    const deckY = 58, topY = 160;
    const towers = [0.17, 0.38, 0.62, 0.83];
    for (const t of towers) {
      const T = P(t);
      for (const s of [-1, 1]) gb.box(7, topY, 7, grey, T.x + px * s * 13, topY / 2, T.z + pz * s * 13, -br);
      for (const y of [deckY + 18, 100, 130, topY - 3]) gb.box(26, 4, 4, grey, T.x, y, T.z, -br + Math.PI / 2);
      gb.box(45, 6, 30, '#8a8580', T.x, 2, T.z, -br);
      BRIDGE_PIERS.push({ kind: 'bridge', cx: T.x, cz: T.z, hl: 16, hw: 24, rot: br, h: 0 });
    }
    const CA = P(0.5);
    gb.box(60, deckY + 25, 40, '#a8a49a', CA.x, (deckY + 25) / 2, CA.z, -br);
    BRIDGE_PIERS.push({ kind: 'bridge', cx: CA.x, cz: CA.z, hl: 22, hw: 32, rot: br, h: 0 });
    gb.box(28, 10, L + 300, grey, (A.x + B.x) / 2 - ux * 150, deckY, (A.z + B.z) / 2 - uz * 150, -br);
    gb.box(26, 2, L + 300, '#5e6266', (A.x + B.x) / 2 - ux * 150, deckY + 5.5, (A.z + B.z) / 2 - uz * 150, -br);
    scene.add(gb.mesh());
    const cableMat = new THREE.LineBasicMaterial({ color: grey });
    const anchors = [0, 0.17, 0.38, 0.5, 0.62, 0.83, 1.0];
    for (const s of [-1, 1]) {
      for (let i = 0; i + 1 < anchors.length; i++) {
        const t0 = anchors[i], t1 = anchors[i + 1];
        const isT0 = towers.includes(t0), isT1 = towers.includes(t1);
        const P0 = P(t0), P1 = P(t1);
        const o0 = { x: P0.x + px * s * 13, z: P0.z + pz * s * 13 }, o1 = { x: P1.x + px * s * 13, z: P1.z + pz * s * 13 };
        const y0 = isT0 ? topY : deckY + 20, y1 = isT1 ? topY : deckY + 20;
        const sag = isT0 && isT1 ? topY - deckY - 6 : 25;
        const pts = suspension(scene, o0, o1, y0, y1, y0, y1, deckY, grey, sag);
        scene.add(cableTube(pts, 0.7, grey));
        const seg = [];
        for (let k = 1; k < pts.length - 1; k++) seg.push(pts[k].x, pts[k].y, pts[k].z, pts[k].x, deckY + 5, pts[k].z);
        const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
        scene.add(new THREE.LineSegments(lg, cableMat));
      }
    }
  }
  // ------------------------------------------------ Bay Bridge east span (YBI -> Oakland)
  {
    const gb = new GB();
    const A = ll(37.8128, -122.3598), T = ll(37.8162, -122.3540), B = ll(37.8245, -122.3115);
    const seg = (P, Q, y0, y1) => {
      const L = Math.hypot(Q.x - P.x, Q.z - P.z), br = Math.atan2(Q.x - P.x, -(Q.z - P.z));
      const n = Math.ceil(L / 120);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, y = y0 + (y1 - y0) * t;
        gb.box(48, 5, L / n + 1, '#d9d9d6', P.x + (Q.x - P.x) * t, y, P.z + (Q.z - P.z) * t, -br);
        if (i % 1 === 0) gb.box(10, y, 8, '#cfcfcb', P.x + (Q.x - P.x) * t, y / 2, P.z + (Q.z - P.z) * t, -br);
      }
    };
    seg(A, T, 50, 50); seg(T, B, 50, 12);
    gb.box(8, 160, 8, '#e8e8e4', T.x, 80, T.z);
    scene.add(gb.mesh());
    const lines = [];
    for (let i = -6; i <= 6; i++) lines.push(T.x, 160, T.z, T.x + i * 25, 50, T.z + i * 5);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xdddddd })));
  }
  for (const p of BRIDGE_PIERS) STRUCTS.push(p);
}

// ============================================================================ night lights
// One additive point cloud for the city & bridges at night: amber deck lamps, the Bay Lights LED
// sculpture shimmering on the west span's cables, red aviation beacons, streetlights. A second pass
// draws each low light's reflection as a vertical streak on the water (placed where the mirror ray
// meets the surface, so boats/land still occlude it). Kinds: 0 steady, 1 twinkle, 2 blink, 3 Bay Lights.
const NL = [];
function buildNightLights() {
  const add = (x, y, z, r, g, b, k) => NL.push([x, y, z, r, g, b, k]);
  const AMBER = [1.0, 0.62, 0.28], WHITE = [1.0, 0.92, 0.8];
  // Golden Gate: roadway lamps both sides, tower floodlights, red beacons on the tower tops
  {
    const S = ll(37.8115, -122.4777), N = ll(37.8230, -122.4788), SA = ll(37.8080, -122.4762), NA = ll(37.8285, -122.4805);
    const dx = N.x - S.x, dz = N.z - S.z, L = Math.hypot(dx, dz), px = -dz / L, pz = dx / L;
    const dL = Math.hypot(NA.x - SA.x, NA.z - SA.z);
    for (let d = 0; d <= dL; d += 32) for (const s of [-1, 1]) { const t = d / dL; add(SA.x + (NA.x - SA.x) * t + px * s * 12, 75, SA.z + (NA.z - SA.z) * t + pz * s * 12, ...AMBER, 1); }
    for (const T of [S, N]) {
      for (const s of [-1, 1]) for (let y = 80; y < 225; y += 18) add(T.x + px * s * 14, y, T.z + pz * s * 14, 1.0, 0.45, 0.25, 0);
      add(T.x, 232, T.z, 1, 0.06, 0.04, 2);
    }
  }
  // Bay Bridge west span: deck lamps + the Bay Lights on the north-side vertical cables
  {
    const A = ll(37.7885, -122.3890), B = ll(37.8100, -122.3660);
    const P = (t) => ({ x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t });
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), px = -dz / L, pz = dx / L;
    const deckY = 58, topY = 160;
    for (let d = -300; d <= L; d += 28) for (const s of [-1, 1]) { const t = d / L; const q = P(t); add(q.x + px * s * 13, deckY + 8, q.z + pz * s * 13, ...WHITE, 1); }
    const spans = [[0.17, 0.38], [0.62, 0.83], [0.0, 0.17, 1], [0.38, 0.5, 1], [0.5, 0.62, 2], [0.83, 1.0, 2]];
    const side = s => (s === undefined ? 1 : 1);
    for (const [t0, t1, kind] of spans) {
      const len = (t1 - t0) * L;
      for (let d = 6; d < len - 4; d += 9) {
        const u = d / len, q = P(t0 + (t1 - t0) * u);
        let ytop;
        if (!kind) ytop = topY - (topY - deckY - 6) * 4 * u * (1 - u);
        else if (kind === 1) ytop = deckY + 20 + (topY - deckY - 20) * u - 25 * 4 * u * (1 - u);
        else ytop = topY - (topY - deckY - 20) * u - 25 * 4 * u * (1 - u);
        for (let y = deckY + 8; y < ytop - 1; y += 5.5) add(q.x - px * 13 * side(), y, q.z - pz * 13 * side(), 1, 1, 1, 3);
      }
    }
    for (const t of [0.17, 0.38, 0.62, 0.83]) { const q = P(t); add(q.x, 164, q.z, 1, 0.06, 0.04, 2); }
  }
  // Bay Bridge east span (self-anchored suspension tower + roadway)
  {
    const A = ll(37.8128, -122.3598), T = ll(37.8162, -122.3540), B = ll(37.8245, -122.3115);
    for (const [P, Q, y0, y1] of [[A, T, 50, 50], [T, B, 50, 12]]) {
      const L = Math.hypot(Q.x - P.x, Q.z - P.z);
      for (let d = 0; d < L; d += 35) { const t = d / L; add(P.x + (Q.x - P.x) * t, y0 + (y1 - y0) * t + 7, P.z + (Q.z - P.z) * t, ...WHITE, 1); }
    }
    for (let y = 60; y < 160; y += 12) add(T.x, y, T.z, 0.85, 0.9, 1.0, 0);
    add(T.x, 164, T.z, 1, 0.06, 0.04, 2);
  }
  // landmarks: Coit Tower, Ferry Building clock tower, Alcatraz lighthouse, Transamerica tip
  const lm = [[37.8024, -122.4058, 70, [1, 0.85, 0.6]], [37.7955, -122.3937, 60, [1, 0.95, 0.85]], [37.8263, -122.4220, 50, [1, 1, 0.9]], [37.7952, -122.4028, 262, [1, 0.1, 0.05]]];
  for (const [la, lo, y, c] of lm) { const p = ll(la, lo); for (let k = 0; k < 6; k++) add(p.x + (k % 3 - 1) * 3, terrainAt(p.x, p.z) + y - k * 4, p.z, ...c, k === 0 && y > 200 ? 2 : 0); }
  const n = NL.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), kd = new Float32Array(n);
  NL.forEach((l, i) => { pos.set(l.slice(0, 3), i * 3); col.set(l.slice(3, 6), i * 3); kd[i] = l[6]; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('kind', new THREE.BufferAttribute(kd, 1));
  W.nlUniforms = { uTime: { value: 0 }, uNightL: { value: 0 }, uDpr: { value: 1 }, uFogVis: { value: 20000 } };
  const common = `attribute vec3 color; attribute float kind; uniform float uTime; uniform float uNightL; uniform float uDpr; uniform float uFogVis;
    varying vec3 vC; varying float vI;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    float lh(vec3 p){ return fract(sin(dot(p, vec3(12.99, 78.23, 37.71))) * 43758.5); }
    float lightI(vec3 p, float k) {
      float h = lh(p), I = 1.0;
      if (k > 0.5 && k < 1.5) I = 0.8 + 0.2 * sin(uTime * (3.0 + 4.0 * h) + h * 40.0);     // atmospheric twinkle
      else if (k > 1.5 && k < 2.5) I = step(0.55, fract(uTime * 0.5 + h)) * 1.6;           // aviation beacon
      else if (k > 2.5) { float w = sin(p.x * 0.018 + p.z * 0.018 - uTime * 1.3) + sin(p.y * 0.07 + uTime * 0.9 + p.x * 0.004);
        I = 0.15 + 1.1 * pow(clamp(w * 0.5 + 0.5, 0.0, 1.0), 3.0); }                       // Bay Lights: slow rippling patterns
      return I;
    }`;
  const frag = `varying vec3 vC; varying float vI; uniform float uRefl;
    #include <logdepthbuf_pars_fragment>
    void main(){
      #include <logdepthbuf_fragment>
      vec2 d = gl_PointCoord - 0.5; if (uRefl > 0.5) d.x *= 3.2; else d.y *= 1.0;
      float r = length(d); if (r > 0.5) discard;
      float a = pow(smoothstep(0.5, 0.0, r), 1.6);
      gl_FragColor = vec4(vC * a * vI, a * vI);
    }`;
  const lightsMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...W.nlUniforms, uRefl: { value: 0 } },
    vertexShader: common + `
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0); float dist = -mv.z;
        vC = color; vI = lightI(position, kind) * uNightL * exp(-dist / uFogVis);
        gl_PointSize = clamp((kind > 2.5 ? 1400.0 : 2600.0) / dist, 1.6, 9.0) * uDpr;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`, fragmentShader: frag,
  });
  const reflMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { ...W.nlUniforms, uRefl: { value: 1 } },
    vertexShader: common + `
      void main(){
        // reflection: where the ray from the eye to the mirror image (y → −y) crosses the water
        vec3 C = cameraPosition, M = vec3(position.x, -position.y, position.z);
        float t = C.y / max(C.y + position.y, 0.01);
        vec3 P = C + (M - C) * t; P.y = 0.08;
        vec4 mv = viewMatrix * vec4(P, 1.0); float dist = -mv.z;
        vC = color; vI = lightI(position, kind) * uNightL * 0.55 * exp(-dist / uFogVis) * (0.7 + 0.3 * sin(uTime * 2.3 + position.x));
        gl_PointSize = clamp(3600.0 / dist, 2.0, 14.0) * uDpr;
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`, fragmentShader: frag,
  });
  const pts = new THREE.Points(g, lightsMat), refl = new THREE.Points(g, reflMat);
  pts.frustumCulled = false; refl.frustumCulled = false; refl.renderOrder = 2;
  W.scene.add(pts); W.scene.add(refl);
  W.nightLights = [pts, refl];
}

// ============================================================================ landmarks
function buildLandmarks() {
  const gb = new GB();
  const at = (lat, lon) => { const p = ll(lat, lon); return { ...p, y: terrainAt(p.x, p.z) }; };
  { const p = at(37.8270, -122.4232); gb.box(150, 16, 32, '#d9d2c0', p.x, p.y + 8, p.z, -0.52); gb.box(35, 10, 25, '#cfc6b0', p.x + 60, p.y + 4, p.z + 40, -0.52); }
  { const p = at(37.8263, -122.4220); gb.box(5, 26, 5, '#f2f2ee', p.x - 60, p.y + 13, p.z - 50); }
  { const p = at(37.8258, -122.4235); gb.cyl(6, 8, '#9a8a70', p.x + 40, p.y + 24, p.z + 60, 10); for (const s of [-1, 1]) for (const t of [-1, 1]) gb.box(0.6, 20, 0.6, '#6b5d48', p.x + 40 + s * 4, p.y + 10, p.z + 60 + t * 4); }
  { const p = at(37.8105, -122.4770); gb.box(45, 16, 45, '#9c5a3c', p.x, p.y + 6, p.z, 0.2); }  // Fort Point
  { const p = at(37.8029, -122.4484); gb.sphere(18, '#d6b98a', p.x, p.y + 25, p.z, 1, 0.8, 1); gb.cyl(17, 22, '#cfb183', p.x, p.y + 11, p.z, 10); } // Palace of Fine Arts
  { // Oracle Park
    const c = at(37.7786, -122.3893);
    for (let i = 0; i < 14; i++) {
      const a = -0.6 + i * 0.22, r = 95;
      gb.box(30, 28, 18, '#6b4f3a', c.x + Math.sin(a) * r * -1 - 30, c.y + 14, c.z + Math.cos(a) * r * -1 + 40, a);
    }
    gb.box(120, 1, 120, '#2f7d32', c.x - 30, c.y + 0.6, c.z + 30);
    for (const [ox, oz] of [[-110, 60], [20, -40], [-60, 120]]) gb.box(3, 55, 3, '#ddd', c.x + ox, c.y + 27, c.z + oz);
  }
  { const p = at(37.8065, -122.4229); gb.box(14, 22, 30, '#c8c2b3', p.x, p.y + 11, p.z); gb.box(30, 4, 2, '#c62828', p.x, p.y + 24, p.z - 10); } // Ghirardelli-ish
  { const p = at(37.8085, -122.3622); gb.box(25, 12, 15, '#f4f4f4', p.x, p.y + 6, p.z); } // USCG YBI
  { const p = at(37.8240, -122.3712); gb.box(60, 20, 30, '#cfc8b8', p.x, p.y + 10, p.z); gb.box(80, 25, 50, '#b8b4aa', p.x + 150, p.y + 12, p.z + 200); }
  W.scene.add(gb.mesh());
}

// ============================================================================ docks
function buildDockMeshes() {
  const gb = new GB();
  for (const s of STRUCTS) {
    if (s.kind === 'boat' || s.kind === 'bridge') continue;
    const yaw = -s.rot;
    const W2 = s.hw * 2, L2 = s.hl * 2;
    if (s.kind === 'float') {
      gb.box(W2, 0.75, L2, s.color || '#8d8478', s.cx, 0.07, s.cz, yaw);
    } else if (s.kind === 'pier') {
      gb.box(W2, s.h + 1, L2, s.color || '#a39e93', s.cx, (s.h - 1) / 2, s.cz, yaw);
      gb.box(W2 + 0.4, 0.4, L2 + 0.4, '#8a857a', s.cx, s.h - 0.1, s.cz, yaw);
    } else if (s.kind === 'building') {
      const base = 3.2;
      gb.box(W2, s.h, L2, s.color, s.cx, base + s.h / 2, s.cz, yaw);
      gb.box(W2 * 0.96, 1.2, L2 * 0.98, '#6d6a62', s.cx, base + s.h + 0.6, s.cz, yaw);
    } else if (s.kind === 'break') {
      gb.box(W2 + 2, s.h + 2, L2, '#6f6a60', s.cx, s.h / 2 - 1, s.cz, yaw);
      gb.box(W2, 0.8, L2, '#87817a', s.cx, s.h, s.cz, yaw);
    }
  }
  const m = gb.mesh(); W.scene.add(m); W.docks = m;
  // Sam's umbrellas
  const ub = new GB();
  const sams = SITES.find(s => s.id === 'sams');
  if (sams) for (let i = 0; i < 12; i++) {
    const a = (i / 12 - 0.5) * 50;
    const t = 210 * D2R; const x = sams.x + Math.cos(t) * a - Math.sin(t) * 6, z = sams.z + Math.sin(t) * a + Math.cos(t) * 6;
    ub.addGeom(new THREE.ConeGeometry(2, 0.8, 8).toNonIndexed(), i % 2 ? '#c62828' : '#f4f4f4', x, 5.4, z);
    ub.cyl(0.05, 3, '#ddd', x, 3.9, z, 4);
  }
  W.scene.add(ub.mesh());
}

// ============================================================================ moored boats
function mooredTemplates() {
  const t = {};
  const sailT = (L) => {
    const gb = new GB();
    hull(gb, L, L * 0.33, L * 0.08, L * 0.07, { side: '#ffffff', bottom: '#2a2a40', deck: '#e8e2d2', taper: 0.48, sheer: L * 0.03 });
    gb.box(L * 0.18, L * 0.06, L * 0.25, '#f2efe6', 0, L * 0.11, -L * 0.02);
    gb.cyl(0.06, L * 1.3, '#c9ccd0', 0, L * 0.08 + L * 0.65, -L * 0.08, 5);
    gb.box(0.35, 0.35, L * 0.42, '#1f4e79', 0, L * 0.2, L * 0.13);
    return gb.build();
  };
  const powT = (L, style) => buildPowerboat(L, style).geometry;
  t.sail = [[8, sailT(8)], [10, sailT(10)], [12, sailT(12)], [15, sailT(15)]];
  t.power = [[8, powT(8, 'cc')], [10, powT(10, 'cruiser')], [11, powT(11, 'sport')], [13, powT(13, 'trawler')], [15, powT(15, 'cruiser')]];
  t.big = [[22, powT(22, 'cruiser')]];
  t.yacht = [[45, buildFerryMono(45, 'horn').geometry]];
  t.fishing = [[13, buildFishing(13).geometry]];
  t.uscg = [[14, buildRIB(14, 'uscg').geometry]];
  t.house = [[12, buildHouseboat().geometry], [12, buildHouseboat().geometry], [12, buildHouseboat().geometry]];
  return t;
}
function buildMooredBoats() {
  const T = mooredTemplates();
  const buckets = new Map();
  const all = [...MOORED, ...MOORINGS.filter(m => m.occupied).map(m => ({ ...m, mooring: true }))];
  for (const b of all) {
    const list = T[b.type] || T.power;
    let best = list[0];
    if (b.type === 'house') best = list[Math.floor(Math.random() * list.length)];
    else for (const e of list) if (Math.abs(e[0] - b.len) < Math.abs(best[0] - b.len)) best = e;
    if (!buckets.has(best)) buckets.set(best, []);
    buckets.get(best).push(b);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  W.mooredMeshes = [];
  for (const [tpl, boats] of buckets) {
    const im = new THREE.InstancedMesh(tpl[1], MAT.vc, boats.length);
    boats.forEach((b, i) => {
      const sc = b.type === 'house' || b.type === 'yacht' ? 1 : b.len / tpl[0];
      m4.compose(p.set(b.x, 0, b.z), q.setFromAxisAngle(up, -b.heading * D2R), s.set(sc, sc, sc));
      im.setMatrixAt(i, m4);
    });
    W.scene.add(im); W.mooredMeshes.push(im);
  }
  // mooring balls
  const ball = buildMooringBall().geometry;
  const free = MOORINGS.filter(m => !m.occupied);
  if (free.length) {
    const im = new THREE.InstancedMesh(ball, MAT.vc, free.length);
    free.forEach((m, i) => { m4.makeTranslation(m.x, 0, m.z); im.setMatrixAt(i, m4); });
    W.scene.add(im);
  }
  // sea lions: animated colony in life.js
}

function buildNavAids() {
  W.navAidMeshes = [];
  for (const a of NAV_AIDS) {
    const m = buildBuoy(a.kind);
    m.position.set(a.x, 0, a.z);
    W.scene.add(m); W.navAidMeshes.push({ mesh: m, aid: a });
    STRUCTS.push({ kind: 'buoy', cx: a.x, cz: a.z, hl: 1, hw: 1, rot: 0, h: 0 });
  }
}

function buildSpecials() {
  for (const s of SPECIAL) {
    let m;
    if (s.kind === 'tallship') m = buildTallShip(s.len);
    else if (s.kind === 'liberty') { m = buildTanker(s.len); }
    else if (s.kind === 'sub') { const gb = new GB(); gb.sphere(1, '#2b2f33', 0, 0, 0, 4.5, 3, s.len / 2); gb.box(4, 6, 12, '#2b2f33', 0, 4, -8); m = gb.mesh(); }
    else if (s.kind === 'cruise') m = buildCruiseShip(s.len);
    else if (s.kind === 'fireboat') m = buildRIB(s.len, 'fire');
    else if (s.kind === 'anchored') m = Math.random() < 0.5 ? buildTanker(s.len) : buildCarCarrier(s.len);
    else continue;
    m.position.set(s.x, 0, s.z); m.rotation.y = -s.heading * D2R;
    W.scene.add(m);
    STRUCTS.push({ kind: 'boat', cx: s.x, cz: s.z, hl: s.len / 2, hw: s.len * (s.kind === 'cruise' ? 0.065 : 0.085), rot: s.heading * D2R, h: 0, special: s });
  }
}

// ============================================================================ particles (GPU-animated)
// Foam/wake: each particle stores its spawn state; the vertex shader computes position, size
// and fade from (uTime - birth). The CPU only writes one slot per emission (partial upload).
export const foam = { n: 12000, i: 0, dirtyMin: Infinity, dirtyMax: -1 };
// Small CPU-side list of wake crests from bigger/faster boats, used for wake-hit physics.
export const crests = { n: 1200, i: 0 };
export const flecks = { n: 2400 };
const FOAM_K = 0.35;
function buildParticles() {
  const g = new THREE.BufferGeometry();
  foam.spawn = new Float32Array(foam.n * 4);   // x, z, vx, vz
  foam.time = new Float32Array(foam.n * 3);    // birth, life, size
  foam.time.fill(-1e6);
  const pos = new Float32Array(foam.n * 3);     // unused (positions computed in shader)
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSpawn', new THREE.BufferAttribute(foam.spawn, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aTime', new THREE.BufferAttribute(foam.time, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uColor: { value: new THREE.Color('#f2f6f7') }, uK: { value: FOAM_K } },
    vertexShader: `attribute vec4 aSpawn; attribute vec3 aTime; uniform float uTime; uniform float uScale; uniform float uK; varying float vA;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      void main(){
        float age = uTime - aTime.x, life = aTime.y;
        if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; return; }
        float t = age / life;
        float d = (1.0 - exp(-uK * age)) / uK;
        vec3 p = vec3(aSpawn.x + aSpawn.z * d, 0.25, aSpawn.y + aSpawn.w * d);
        vA = (1.0 - t) * min(1.0, t * 20.0) * 0.75 * clamp(aTime.z / 2.2, 0.22, 1.0);   // small slow-speed wash is faint
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_PointSize = min(64.0, aTime.z * (1.0 + 0.06 * age) * uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5 || vA <= 0.0) discard;
        gl_FragColor = vec4(uColor, vA * (1.0 - d * 2.0)); }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; W.scene.add(pts); foam.points = pts;

  crests.d = new Float32Array(crests.n * 7); // x, z, vx, vz, birth, life, energy

  // current flecks: seeds tile around the focus point and drift with the current, all in-shader.
  const g2 = new THREE.BufferGeometry();
  const seed = new Float32Array(flecks.n * 4);
  for (let i = 0; i < flecks.n; i++) { seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = Math.random() * 20; seed[i * 4 + 3] = 6 + Math.random() * 10; }
  g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flecks.n * 3), 3));
  g2.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const fm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() }, uR: { value: 260 }, uScale: { value: 600 }, uShow: { value: 0 }, uFl: { value: 1 },
      uChop: { value: W.chopTex }, uBMin: W.waterMat.uniforms.uBMin, uBSize: W.waterMat.uniforms.uBSize,
    },
    vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform vec2 uCenter; uniform float uR; uniform float uScale; uniform float uShow;
      uniform sampler2D uChop; uniform vec2 uBMin; uniform vec2 uBSize; varying float vA;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        float life = aSeed.w, tt = uTime + aSeed.z;
        float cyc = floor(tt / life), age = tt - cyc * life, t = age / life;
        vec2 rnd = fract(aSeed.xy + vec2(h1(cyc + aSeed.x * 91.0), h1(cyc * 1.7 + aSeed.y * 57.0)));
        // grid-aligned tiling so seeds don't slide when the camera moves
        vec2 cell = floor(uCenter / (2.0 * uR));
        vec2 p0 = (cell + rnd) * 2.0 * uR;
        p0 += (step(uCenter, p0 - uR) * -2.0 + step(p0 + uR, uCenter) * 2.0) * uR;
        vec4 cs = texture2D(uChop, (p0 - uBMin) / uBSize);
        vec2 cur = (cs.ba - 0.5) * 10.0;
        vec2 p = p0 + cur * age;
        float sp = length(cur);
        vA = sin(t * 3.14159) * mix(0.07, 0.85, uShow) * min(1.0, 0.25 + sp);
        vec4 mv = viewMatrix * vec4(p.x, 0.3, p.y, 1.0);
        gl_PointSize = min(32.0, mix(0.45, 0.8, uShow) * uScale / -mv.z);
        gl_Position = projectionMatrix * mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `varying float vA; uniform float uFl;
      #include <logdepthbuf_pars_fragment>
      void main(){
        #include <logdepthbuf_fragment>
        vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(vec3(0.91, 0.94, 0.91) * uFl, vA * (1.0 - d * 2.0)); }`,
  });
  const p2 = new THREE.Points(g2, fm);
  p2.frustumCulled = false; W.scene.add(p2); flecks.points = p2;
  // current arrows (instanced)
  const ag = new THREE.ConeGeometry(1, 3, 3); ag.rotateX(-Math.PI / 2); // points -Z
  const am = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false });
  W.curArrows = new THREE.InstancedMesh(ag, am, 900);
  W.curArrows.visible = false; W.curArrows.frustumCulled = false;
  W.scene.add(W.curArrows);
}

export function emitFoam(x, z, vx, vz, size, life, energy = 0) {
  const i = foam.i; foam.i = (foam.i + 1) % foam.n;
  const t = env.time;
  foam.spawn[i * 4] = x; foam.spawn[i * 4 + 1] = z; foam.spawn[i * 4 + 2] = vx; foam.spawn[i * 4 + 3] = vz;
  foam.time[i * 3] = t; foam.time[i * 3 + 1] = life; foam.time[i * 3 + 2] = size;
  if (i < foam.dirtyMin) foam.dirtyMin = i;
  if (i > foam.dirtyMax) foam.dirtyMax = i;
  if (energy > 25) {
    const k = crests.i; crests.i = (crests.i + 1) % crests.n;
    const d = crests.d; d[k * 7] = x; d[k * 7 + 1] = z; d[k * 7 + 2] = vx; d[k * 7 + 3] = vz; d[k * 7 + 4] = t; d[k * 7 + 5] = life; d[k * 7 + 6] = energy;
  }
}
// analytic crest position (same motion as the shader)
export function crestPos(k, t) {
  const d = crests.d, age = t - d[k * 7 + 4];
  const m = (1 - Math.exp(-FOAM_K * age)) / FOAM_K;
  return { x: d[k * 7] + d[k * 7 + 2] * m, z: d[k * 7 + 1] + d[k * 7 + 3] * m, age, life: d[k * 7 + 5] };
}

export function updateParticles(dt, cx, cz, showCurrents) {
  const fu = foam.points.material.uniforms; fu.uTime.value = env.time;
  if (W.waterMat) { const l = W.waterMat.uniforms.uLight.value; fu.uColor.value.setRGB(0.95, 0.97, 0.97).multiplyScalar(Math.max(0.06, l * l)).lerp(W.horizon, 0.12); flecks.points.material.uniforms.uFl.value = Math.max(0.08, l * l); }
  if (foam.dirtyMax >= 0) {
    const g = foam.points.geometry, aS = g.attributes.aSpawn, aT = g.attributes.aTime;
    let lo = foam.dirtyMin, hi = foam.dirtyMax;
    if (hi - lo > foam.n / 2) { lo = 0; hi = foam.n - 1; } // wrapped: upload all
    aS.clearUpdateRanges(); aT.clearUpdateRanges();
    aS.addUpdateRange(lo * 4, (hi - lo + 1) * 4); aT.addUpdateRange(lo * 3, (hi - lo + 1) * 3);
    aS.needsUpdate = true; aT.needsUpdate = true;
    foam.dirtyMin = Infinity; foam.dirtyMax = -1;
  }
  const u = flecks.points.material.uniforms;
  u.uTime.value = env.time; u.uCenter.value.set(cx, cz); u.uShow.value = showCurrents ? 1 : 0;
}

const _c = { x: 0, z: 0 };
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _col = new THREE.Color();
export function updateCurrentArrows(cx, cz, visible) {
  const A = W.curArrows;
  A.visible = visible;
  if (!visible) return;
  let n = 0;
  const sp = 90, R = 1300;
  const gx0 = Math.round(cx / sp) * sp, gz0 = Math.round(cz / sp) * sp;
  for (let dz = -R; dz <= R && n < 900; dz += sp) for (let dx = -R; dx <= R && n < 900; dx += sp) {
    const x = gx0 + dx, z = gz0 + dz;
    if (dx * dx + dz * dz > R * R || sdfAt(x, z) > -15) continue;
    currentAt(x, z, _c);
    const s = Math.hypot(_c.x, _c.z), kn = s / KN;
    if (kn < 0.08) continue;
    const ang = Math.atan2(_c.x, -_c.z);
    const sc = 1.2 + kn * 1.5;
    _m4.compose(_p.set(x, 1.2, z), _q.setFromAxisAngle(_up, -ang), _s.set(sc * 0.45, 0.4, sc));
    A.setMatrixAt(n, _m4);
    A.setColorAt(n, _col.setHSL(Math.max(0, 0.55 - kn * 0.13), 0.9, 0.55));
    n++;
  }
  A.count = n;
  A.instanceMatrix.needsUpdate = true;
  if (A.instanceColor) A.instanceColor.needsUpdate = true;
}

// ============================================================================ markers
function makeLabel(text, color = '#ffffff', bg = 'rgba(10,25,40,0.78)') {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 42px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 40;
  cv.width = w; cv.height = 64;
  ctx.font = 'bold 42px system-ui, sans-serif';
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(0, 0, w, 64, 14); ctx.fill();
  ctx.fillStyle = color; ctx.textBaseline = 'middle'; ctx.fillText(text, 20, 34);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  sp.scale.set(w / 64 * 0.035, 0.035, 1);
  sp.renderOrder = 10;
  return sp;
}
export { makeLabel };

function buildMarkers() {
  // dock finder: green pads on free guest spots + labels on sites
  W.finder = new THREE.Group(); W.finder.visible = false; W.scene.add(W.finder);
  const padMat = new THREE.MeshBasicMaterial({ color: 0x2bff88, transparent: true, opacity: 0.45, depthWrite: false });
  for (const g of GUEST_SPOTS) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.3, Math.min(14, g.len)), padMat);
    m.position.set(g.x, 0.5, g.z); m.rotation.y = -g.heading * D2R;
    W.finder.add(m);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 14, 6), padMat);
    beam.position.set(g.x, 7, g.z); W.finder.add(beam);
  }
  for (const s of SITES) {
    const l = makeLabel(s.name, '#ffffff', s.kind === 'restricted' ? 'rgba(120,20,20,0.8)' : 'rgba(10,60,40,0.8)');
    l.position.set(s.x, 40, s.z); W.finder.add(l);
  }
  // destination beacon
  const bm = new THREE.MeshBasicMaterial({ color: 0xffd54f, transparent: true, opacity: 0.55, depthWrite: false });
  W.dest = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 300, 10, 1, true), bm);
  W.dest.visible = false; W.scene.add(W.dest);
  // scenario target zone
  W.zoneMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.35, depthWrite: false });
  W.zone = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1), W.zoneMat);
  W.zone.visible = false; W.scene.add(W.zone);
}

// ============================================================================ per-frame
// ============================================================================ Karl the Fog
// The marine layer: a low fog bank sitting outside the Golden Gate and spilling over the Marin
// Headlands ridge in the afternoon. Soft camera-facing sprites — cheap, and it reads right from the water.
function cloudTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  for (let i = 0; i < 70; i++) {
    const x = 128 + (Math.random() - 0.5) * 150, y = 140 + (Math.random() - 0.5) * 70, r = 30 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildFogBank() {
  const tex = cloudTexture();
  W.fogBank = [];
  const groups = [
    // [lat, lon, spread lat, spread lon, count, y0, y1, size0, size1]
    [37.815, -122.540, 0.030, 0.030, 18, 30, 170, 700, 1400],   // offshore, outside the Gate
    [37.823, -122.505, 0.008, 0.016, 10, 60, 190, 400, 800],    // pushing in under the bridge
    [37.836, -122.495, 0.007, 0.014, 9, 170, 300, 380, 700],    // pouring over the Marin Headlands
    [37.790, -122.505, 0.010, 0.012, 8, 40, 160, 450, 900],     // Lands End / Presidio
  ];
  for (const [la, lo, sla, slo, n, y0, y1, s0, s1] of groups) for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, fog: false, color: 0xffffff });
    const sp = new THREE.Sprite(mat);
    const p = ll(la + (Math.random() - 0.5) * sla * 2, lo + (Math.random() - 0.5) * slo * 2);
    const size = s0 + Math.random() * (s1 - s0);
    sp.scale.set(size, size * 0.42, 1);
    sp.position.set(p.x, y0 + Math.random() * (y1 - y0), p.z);
    sp.userData = { x: p.x, z: p.z, ph: Math.random() * 10 };
    sp.layers.enable(1);
    W.scene.add(sp); W.fogBank.push(sp);
  }
}
// October: usually clear midday, the bank builds off the coast mid-afternoon and creeps in toward evening
function fogBankAmount(clock) {
  if (env.fog > 0.5) return 1;
  const a = THREE.MathUtils.smoothstep(clock, 13, 17.5) * (1 - THREE.MathUtils.smoothstep(clock, 21, 23)) + (clock < 10.5 ? 0.6 * (1 - THREE.MathUtils.smoothstep(clock, 8.5, 10.5)) : 0);
  return 0.35 + 0.65 * a;
}

const _sd = new THREE.Vector3(), _hor = new THREE.Color(), _reflBg = new THREE.Color();
const C_DAYHOR = new THREE.Color('#bccbd5'), C_GOLD = new THREE.Color('#e2b48a'), C_NIGHTHOR = new THREE.Color('#0b111b'), C_FOGH = new THREE.Color('#d3d9dc');
let reflT = 0;
export function updateWorld(dt, focus, opts) {
  const u = W.waterMat.uniforms;
  u.uTime.value = env.time;
  u.uWindTo.value = (env.windDirFrom + 180) * D2R;
  u.uWind.value = Math.min(1, baseWindKn(env.clock) / 22);
  const gx = Math.round(focus.x / 2.5) * 2.5, gz = Math.round(focus.z / 2.5) * 2.5;
  W.waterInner.position.set(gx, 0, gz);
  W.waterOuter.position.set(gx, -0.02, gz);
  u.uCenter.value.set(gx, gz);
  W.sky.position.copy(W.camera.position);

  // ---- sun from the real solar position for Oct 3 at 37.8°N
  const sp = sunPosition(env.clock);
  const alt = sp.alt, az = sp.az;
  const sd = _sd.set(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
  const day = THREE.MathUtils.smoothstep(alt, -0.10, 0.20);
  const golden = THREE.MathUtils.smoothstep(alt, -0.04, 0.04) * (1 - THREE.MathUtils.smoothstep(alt, 0.06, 0.40));
  const su = W.sky.material.uniforms;
  su.sunPosition.value.copy(sd);
  su.uNight.value = 1 - THREE.MathUtils.smoothstep(alt, -0.2, -0.05);
  su.uFog.value = env.fog * 0.85;
  updateEnvironment(sd);
  // direct sun: white at midday, warm and weak near the horizon (atmospheric extinction)
  W.sun.position.set(focus.x + sd.x * 1500, Math.max(30, sd.y * 1500), focus.z + sd.z * 1500);
  W.sun.target.position.set(focus.x, 0, focus.z);
  W.sun.intensity = 3.4 * day * (1 - env.fog * 0.75);
  W.sun.color.setRGB(1, 0.94 - golden * 0.32, 0.86 - golden * 0.5);
  W.hemi.intensity = 0.12 + 0.62 * day;
  W.hemi.color.setRGB(0.58 + golden * 0.25, 0.72, 0.95 - golden * 0.25);
  W.hemi.groundColor.setRGB(0.36, 0.33, 0.26);  // warm bounce off dry October hills
  // haze / fog colour ≈ the sky at the horizon
  const hor = _hor.copy(W.horizon);
  if (env.fog > 0) hor.lerp(C_FOGH.clone().multiplyScalar(0.35 + 0.65 * day), env.fog);
  HAZE.uHazeSun.value.copy(sd); HAZE.uHazeSunCol.value.copy(W.horizonSun).lerp(W.sun.color, 0.25);
  HAZE.uHazeH.value = env.fog > 0.3 ? 0 : 420;
  HAZE.uFogTop.value = env.fog > 0.3 ? 95 : 0; HAZE.uFogTime.value = env.time;
  su.uTime.value = env.time;
  su.uFogCol.value.copy(hor);
  const vis = env.visibility;
  W.scene.fog.color.copy(hor);
  W.scene.fog.near = Math.min(3000, vis * 0.12); W.scene.fog.far = Math.min(vis, 26000);
  u.uFogColor.value.copy(hor); u.uFogNear.value = W.scene.fog.near; u.uFogFar.value = W.scene.fog.far;
  u.uSunDir.value.copy(sd); u.uSunCol.value.copy(W.sun.color).multiplyScalar(day);
  u.uLight.value = 0.12 + 0.88 * day;
  W.night = day < 0.35;
  if (W.nlUniforms) {
    const nl = 1 - THREE.MathUtils.smoothstep(alt, -0.10, 0.03);
    W.nlUniforms.uNightL.value = nl; W.nlUniforms.uTime.value = env.time; W.nlUniforms.uDpr.value = W.dpr || 1;
    W.nlUniforms.uFogVis.value = env.fog > 0.3 ? Math.max(250, env.visibility * 0.8) : 9000;
    for (const o of W.nightLights) o.visible = nl > 0.01;
  }
  W.bUniforms.uNightB.value = 1 - THREE.MathUtils.smoothstep(alt, -0.12, 0.04);
  W.renderer.toneMappingExposure = 0.95 + 0.1 * day;
  // ---- Karl the Fog
  const fa = fogBankAmount(env.clock);
  for (const f of W.fogBank) {
    f.material.opacity = 0.9 * fa * (1 - Math.min(1, env.fog * 1.5));   // inside a thick marine layer the bank is all around you
    f.material.color.setRGB(0.55 + 0.45 * day, 0.55 + 0.43 * day - golden * 0.1, 0.58 + 0.4 * day - golden * 0.22).multiplyScalar(0.06 + 0.94 * day);
    f.position.x = f.userData.x + Math.sin(env.time * 0.01 + f.userData.ph) * 120 + fa * 250;
  }
  // ---- reflection cube for the water (hills, city, bridges, sky), refreshed ~1×/s around the boat
  reflT -= dt;
  if (reflT <= 0) {
    reflT = 1.0; W.reflCam.position.set(focus.x, 3, focus.z);
    // the cube has no water in it: clear "below the horizon" to the haze colour instead of black
    const bg = W.scene.background; W.scene.background = _reflBg.copy(hor);
    W.reflCam.update(W.renderer, W.scene);
    W.scene.background = bg;
  }
  // shadows follow the boat
  W.sun.shadow.camera.updateProjectionMatrix();
  // point sprites are sized in device pixels: keep them consistent across resolution changes
  const ps = 600 * W.dpr * (window.innerHeight / 900);
  foam.points.material.uniforms.uScale.value = ps; flecks.points.material.uniforms.uScale.value = ps;
}
