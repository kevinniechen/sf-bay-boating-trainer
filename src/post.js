// Cheap "AAA" post stack: HDR scene → quarter-res bloom → one composite pass doing ACES tone
// mapping, a filmic split-tone grade, analytic sun glow/lens ghosts, and a vignette.
// Cost: the scene render + 4 tiny passes at 1/4 resolution + 1 full-screen composite.
import * as THREE from 'three';

const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const VS = `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.enabled = true;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(TRI);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    const hf = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.rtA = new THREE.WebGLRenderTarget(4, 4, hf);
    this.rtB = new THREE.WebGLRenderTarget(4, 4, hf);
    this.bright = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uThresh: { value: 1.0 }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tSrc; uniform float uThresh; uniform vec2 uTexel; varying vec2 vUv;
        void main(){
          // 4-tap box downsample, then a soft-knee threshold
          vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
                  + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
          float l = max(c.r, max(c.g, c.b));
          float k = clamp((l - uThresh * 0.6) / (uThresh * 0.8), 0.0, 1.0);
          gl_FragColor = vec4(min(c * k * k, vec3(40.0)), 1.0); }`,
    });
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tSrc, vUv).rgb * 0.2270;
          c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.3162;
          c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.0703;
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.comp = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tBloom: { value: null }, uExposure: { value: 1.0 }, uBloom: { value: 0.22 },
        uSun: { value: new THREE.Vector3(0.5, 0.5, 0) }, uSunCol: { value: new THREE.Color(1, 0.9, 0.75) }, uAspect: { value: 1 },
        uVig: { value: 0.28 }, uWarm: { value: 1.0 },
      },
      vertexShader: VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uExposure; uniform float uBloom;
        uniform vec3 uSun; uniform vec3 uSunCol; uniform float uAspect; uniform float uVig; uniform float uWarm; varying vec2 vUv;
        vec3 pRRTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
        vec3 pAces(vec3 c){
          const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
          const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
          c *= uExposure / 0.6; c = I * c; c = pRRTFit(c); c = O * c; return clamp(c, 0.0, 1.0); }
        vec3 pToSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main(){
          vec3 hdr = texture2D(tScene, vUv).rgb;
          vec3 bloom = texture2D(tBloom, vUv).rgb;
          hdr += bloom * uBloom;
          // analytic sun glow + lens ghosts, gated by how bright the sun spot really is (free occlusion test)
          if (uSun.z > 0.0) {
            vec2 d = (vUv - uSun.xy) * vec2(uAspect, 1.0);
            bool onScreen = all(greaterThan(uSun.xy, vec2(0.0))) && all(lessThan(uSun.xy, vec2(1.0)));
            float vis = (onScreen ? clamp(dot(texture2D(tBloom, uSun.xy).rgb, vec3(0.33)) * 0.6, 0.0, 1.0) : 0.55) * uSun.z;
            // god rays: march from this pixel toward the sun through the bright-pass (sky gaps between
            // hills, smoke, rigging) — works even with the sun just off-screen
            vec2 stepv = (uSun.xy - vUv) / 28.0; vec2 sp = vUv; float decay = 1.0, rays = 0.0;
            for (int i = 0; i < 28; i++) { sp += stepv; vec2 cs = clamp(sp, 0.001, 0.999); rays += dot(texture2D(tBloom, cs).rgb, vec3(0.33)) * decay; decay *= 0.95; }
            float rlen = length(d);
            hdr += uSunCol * rays * 0.012 * uSun.z * smoothstep(1.6, 0.0, rlen);
            // starburst (6 diffraction spikes) + hot core + a veil of glare over the whole frame
            float ang = atan(d.y, d.x);
            float spikes = pow(abs(cos(ang * 3.0 + 0.3)), 60.0) + 0.6 * pow(abs(cos(ang * 3.0 + 1.35)), 90.0);
            hdr += uSunCol * spikes * exp(-rlen * 9.0) * vis * 1.4;
            hdr += uSunCol * (0.06 / (dot(d, d) * 40.0 + 0.06)) * vis * 0.55;
            hdr += uSunCol * exp(-rlen * 1.6) * vis * 0.07;
            vec2 axis = vec2(0.5) - uSun.xy;
            for (int i = 1; i <= 3; i++) {
              vec2 gp = uSun.xy + axis * (0.55 * float(i));
              vec2 gd = (vUv - gp) * vec2(uAspect, 1.0);
              float g = smoothstep(0.045 * float(i), 0.0, length(gd));
              hdr += uSunCol * vec3(0.55, 0.75, 1.0) * g * vis * 0.025;
            }
          }
          vec3 c = pAces(hdr);
          // filmic split-tone: cool shadows, warm (October) highlights, a touch more saturation
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c += mix(vec3(-0.010, 0.0, 0.016), vec3(0.020, 0.010, -0.018) * uWarm, smoothstep(0.15, 0.85, l));
          c = mix(vec3(l), c, 1.14);
          c = c * c * (3.0 - 2.0 * c) * 0.18 + c * 0.82;     // gentle S-curve
          vec2 v = vUv - 0.5; c *= 1.0 - uVig * dot(v, v) * 1.6;
          gl_FragColor = vec4(pToSRGB(clamp(c, 0.0, 1.0)), 1.0); }`,
    });
  }
  setSize(w, h, dpr) {
    const W = Math.max(1, Math.floor(w * dpr)), H = Math.max(1, Math.floor(h * dpr));
    this.rtScene.setSize(W, H);
    const qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2);
    this.rtA.setSize(qw, qh); this.rtB.setSize(qw, qh);
    this.bright.uniforms.uTexel.value.set(1 / W, 1 / H);
    this.comp.uniforms.uAspect.value = w / h;
    this.qw = qw; this.qh = qh;
  }
  pass(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
  render(scene, camera) {
    const r = this.r;
    r.setRenderTarget(this.rtScene); r.render(scene, camera);
    this.bright.uniforms.tSrc.value = this.rtScene.texture; this.pass(this.bright, this.rtA);
    for (let k = 0; k < 2; k++) {
      this.blur.uniforms.tSrc.value = this.rtA.texture; this.blur.uniforms.uDir.value.set(1.6 / this.qw, 0); this.pass(this.blur, this.rtB);
      this.blur.uniforms.tSrc.value = this.rtB.texture; this.blur.uniforms.uDir.value.set(0, 1.6 / this.qh); this.pass(this.blur, this.rtA);
    }
    this.comp.uniforms.tScene.value = this.rtScene.texture; this.comp.uniforms.tBloom.value = this.rtA.texture;
    this.pass(this.comp, null);
  }
}
