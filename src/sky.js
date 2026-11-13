// Storm sky, weather, objective beacons and ambient life. One Env instance owns:
//   sky      gradient dome with two scrolling cloud layers, moon, sheet lightning (1 draw call, shaded only where
//            the sky is visible: it is drawn after the opaque world at the far plane), a distant skyline ring with
//            lit windows, blinking beacons, a branching lightning bolt, searchlights over both bases
//   weather  rain streaks, ground splashes (both animated in the vertex shader; a height-map texture built from
//            game.colTop keeps rain out of covered places and puts splashes at the right height), puddle ripples,
//            ground mist, wind gusts
//   beacons  light column + capture ring per objective, driven by game.flags every frame
//   life     steam vents, reactor motes / embers, superposition shimmer, patrol drones
import * as THREE from 'three';
import { VS, SX, SZ, MAT } from './world.js';
import { BASES, G } from './mapgen.js';
import { FOGU, syncFog, rng, canvas, quadGeo, inst, Rings, Beams } from './fx.js';

const ADD = THREE.AdditiveBlending;
const CY = [0.25, 0.9, 1.0], OR = [1.0, 0.52, 0.14], WH = [0.8, 0.86, 1.0];
const MAXB = 6, SEG = 48, ROWS = [-2.2, -0.12, 0, 0.18], ROWI = [0, 0.2, 1, 0], NONE = [];
const FOG0 = 0.022 * 0.022;

// tileable fBm value noise: R = large cloud shapes, G = detail
function noiseTex(size = 256) {
  const lat = (seed, P) => { const R = rng(seed), a = new Float32Array(P * P); for (let i = 0; i < a.length; i++) a[i] = R(); return a; };
  const fbm = (seed, base, oct) => {
    const out = new Float32Array(size * size); let amp = 1, tot = 0;
    for (let o = 0; o < oct; o++) {
      const P = base << o, L = lat(seed + o * 17, P), s = P / size;
      for (let y = 0; y < size; y++) {
        const fy = y * s, y0 = fy | 0, ty = fy - y0, y1 = (y0 + 1) % P, sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < size; x++) {
          const fx = x * s, x0 = fx | 0, tx = fx - x0, x1 = (x0 + 1) % P, sx = tx * tx * (3 - 2 * tx);
          const a = L[y0 * P + x0], b = L[y0 * P + x1], c = L[y1 * P + x0], e = L[y1 * P + x1];
          out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy);
        }
      }
      tot += amp; amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  };
  const A = fbm(11, 4, 5), B = fbm(53, 8, 4), d = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { d[i * 4] = A[i] * 255; d[i * 4 + 1] = B[i] * 255; d[i * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;   // bilinear only: the sky shader runs on every visible sky pixel
  return t;
}

// distant city: two silhouette layers with tiny lit windows, masts with beacons. Wraps horizontally.
function skylineTex() {
  const W = 2048, H = 160, c = canvas(W, H), g = c.getContext('2d'), R = rng(2077), beacons = [];
  const rect = (x, y, w, h) => { x = Math.round(x); g.fillRect(x, H - y - h, w, h); if (x + w > W) g.fillRect(x - W, H - y - h, w, h); };
  const WARM = ['rgb(214,160,86)', 'rgb(160,116,62)', 'rgb(236,196,124)', 'rgb(120,88,50)'], COOL = ['rgb(120,170,204)', 'rgb(86,196,220)', 'rgb(150,160,190)'];
  const layer = (body, hmin, hmax, wmin, wmax, lit, mast) => {
    for (let x = 0; x < W;) {
      const w = Math.round(wmin + R() * (wmax - wmin)), tall = R() < 0.13, h = Math.round(hmin + R() * (hmax - hmin) * (tall ? 1 : 0.6));
      g.fillStyle = body; rect(x, 0, w, h);
      let top = h;
      if (R() < 0.45) { const sw = Math.round(w * (0.35 + R() * 0.35)), sh = Math.round(4 + R() * 12); rect(x + ((w - sw) >> 1), h, sw, sh); top = h + sh; }
      if (mast && (tall || R() < 0.16)) { const ah = Math.round(5 + R() * 12), ax = x + (w >> 1); rect(ax, top, 1, ah); if (tall || R() < 0.5) beacons.push([((ax + 0.5) % W) / W, (top + ah + 0.5) / H]); }
      const k = lit * (R() < 0.25 ? 2.6 : R() < 0.5 ? 0.25 : 1), neon = mast && R() < 0.12;
      for (let wy = 5; wy < h - 3; wy += 3) for (let wx = 2; wx < w - 2; wx += 2) {
        if (R() > k) continue;
        g.fillStyle = R() < 0.74 ? WARM[(R() * WARM.length) | 0] : COOL[(R() * COOL.length) | 0]; rect(x + wx, wy, 1, 1);
      }
      if (neon) { g.fillStyle = R() < 0.5 ? 'rgb(214,70,196)' : 'rgb(60,200,224)'; rect(x + 2, Math.round(h * (0.55 + R() * 0.3)), Math.max(3, Math.round(w * 0.4)), 1); }
      x += Math.round(w * (0.7 + R() * 0.75));
    }
  };
  layer('rgb(31,37,52)', 30, 78, 12, 40, 0.035, false);
  layer('rgb(15,19,29)', 44, 150, 16, 54, 0.085, true);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return { tex: t, beacons };
}

const SKY_V = `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); p.z = p.w * 0.99999; gl_Position = p; }`;
const SKY_F = `
uniform sampler2D noise; uniform float time; uniform float flash; uniform vec3 boltDir; uniform vec3 moonDir; uniform vec3 fogCol;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec2 uv = d.xz / (h + 0.16);
  float n1 = texture2D(noise, uv * 0.05 + time * vec2(0.0042, 0.0013)).r;
#ifdef LOW
  float n2 = n1;
#else
  float n2 = texture2D(noise, uv * 0.13 + time * vec2(0.0085, -0.0052) + n1 * 0.08).g;
#endif
  float n = n1 * 0.64 + n2 * 0.36;
  float dens = smoothstep(0.36, 0.54, n);
  float belly = smoothstep(0.47, 0.70, n);
  float md = max(dot(d, moonDir), 0.0);
  float m8 = md * md; m8 *= m8; m8 *= m8; float m32 = m8 * m8; m32 *= m32;
  // clear night sky seen through the gaps, with the moon
  vec3 gap = mix(vec3(0.10, 0.13, 0.19), vec3(0.045, 0.06, 0.105), sqrt(h));
  gap += vec3(0.30, 0.36, 0.48) * (m32 * 0.5 + m8 * 0.10);
  gap += vec3(0.93, 0.94, 0.88) * smoothstep(0.99972, 0.99986, md);
  // clouds: thin lit edges, dark bellies, moonlight through the thin parts, lightning from inside
  vec3 cl = mix(vec3(0.27, 0.31, 0.385), vec3(0.115, 0.135, 0.185), belly);
  cl += vec3(0.42, 0.46, 0.52) * m8 * (1.0 - belly * 0.75);
  float bl = max(dot(d, boltDir), 0.0); bl *= bl; bl *= bl;
  cl += vec3(0.7, 0.8, 1.0) * flash * (0.18 + 1.2 * bl) * (0.3 + 0.7 * n2);
  gap += vec3(0.25, 0.3, 0.4) * flash * (0.1 + 0.4 * bl);
  vec3 col = mix(gap, cl, dens);
  // light-polluted haze towards the horizon, fog below it
  float hz = 1.0 - h; hz *= hz; hz *= hz; hz *= hz;
  col = mix(col, vec3(0.185, 0.185, 0.215) + vec3(0.11, 0.13, 0.17) * flash, hz * 0.9);
  col = mix(col, fogCol, 1.0 - smoothstep(-0.05, 0.035, d.y));
  gl_FragColor = vec4(col, 1.0);
}`;
const FAR_V = `varying vec2 vUv; void main() { vUv = uv; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); p.z = p.w * 0.99999; gl_Position = p; }`;
const SKYLINE_F = `
uniform sampler2D map; uniform vec3 fogCol; uniform float flash; varying vec2 vUv;
void main() { vec4 t = texture2D(map, vUv); if (t.a < 0.5) discard; vec3 c = t.rgb + vec3(0.03, 0.035, 0.05) * flash; gl_FragColor = vec4(mix(fogCol, c, smoothstep(0.07, 0.2, vUv.y)), 1.0); }`;
const BOLT_F = `
uniform float k; varying vec2 vUv;
void main() { float x = abs(vUv.x * 2.0 - 1.0); float core = 1.0 - smoothstep(0.04, 0.26, x); float gw = 1.0 - x; gw *= gw; gl_FragColor = vec4(vec3(0.72, 0.82, 1.0) * ((core * 1.7 + gw * 0.32) * vUv.y * k), 1.0); }`;
const DOT_V = `
attribute vec3 aCol; attribute vec3 aPar; uniform float time; uniform float pxs; varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
  float b = fract(time * aPar.y + aPar.x);
  vC = aCol * (0.12 + 0.88 * smoothstep(0.0, 0.04, b) * (1.0 - smoothstep(0.1, 0.4, b)));
  gl_PointSize = aPar.z * pxs;
}`;
const DOT_F = `varying vec3 vC; void main() { float a = max(0.0, 1.0 - length(gl_PointCoord - 0.5) * 2.0); gl_FragColor = vec4(vC * (a * a * 1.6), 1.0); }`;
const HMAP = `
float coverTop(vec2 xz) {
  vec2 huv = xz / vec2(${(SX * VS).toFixed(1)}, ${(SZ * VS).toFixed(1)});
  if (huv.x < 0.0 || huv.x > 1.0 || huv.y < 0.0 || huv.y > 1.0) return -1.0;
  return texture2D(hmap, huv).r * 255.0 * ${VS.toFixed(2)};
}`;
const RAIN_V = `
attribute vec3 aux;
uniform sampler2D hmap; uniform float time; uniform vec2 drift; uniform vec3 wind; uniform float px; uniform float flash;
varying float vA;
const float R = 22.0; const float H = 26.0;
${HMAP}
void main() {
  float sp = 17.0 + aux.x * 9.0;
  float fall = fract(position.y - time * sp / H);
  vec3 c = cameraPosition;
  vec2 xz = position.xz * (2.0 * R) + drift;
  xz = c.xz + mod(xz - c.xz + R, 2.0 * R) - R;
  vec3 head = vec3(xz.x, c.y - 7.0 + fall * H, xz.y);
  vec3 dir = normalize(vec3(wind.x, -sp, wind.z));
  vec3 P = head - dir * (aux.z * (0.45 + aux.x * 0.4));
  vec3 toCam = c - P; float dist = length(toCam);
  vec3 side = cross(dir, toCam); side /= max(length(side), 1e-4);
  P += side * (aux.y * 0.5 * max(0.008, px * dist));
  gl_Position = head.y < coverTop(head.xz) ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(P, 1.0);
  float hd = length(head.xz - c.xz);
  vA = (1.0 - aux.z) * (1.0 - smoothstep(R * 0.7, R, hd)) * smoothstep(0.5, 2.0, dist) * mix(0.5, 0.17, clamp(dist / 20.0, 0.0, 1.0)) * (1.0 + flash * 1.6);
}`;
const RAIN_F = `varying float vA; void main() { gl_FragColor = vec4(0.66, 0.78, 0.9, vA); }`;
const SPLASH_V = `
attribute float aR;
uniform sampler2D hmap; uniform float time; uniform float pscale; uniform float flash;
varying float vA;
const float R = 15.0;
${HMAP}
void main() {
  float cyc = time * (1.5 + aR) + position.z;
  float life = fract(cyc) / 0.22, id = floor(cyc);
  vec2 hh = fract(sin(vec2(dot(vec2(position.x, id), vec2(127.1, 311.7)), dot(vec2(position.y, id), vec2(269.5, 183.3)))) * 43758.5453);
  vec3 c = cameraPosition;
  vec2 xz = c.xz + mod(hh * (2.0 * R) - c.xz + R, 2.0 * R) - R;
  float top = coverTop(xz);
  vec4 mv = viewMatrix * vec4(xz.x, top + 0.04, xz.y, 1.0);
  float d = -mv.z;
  gl_Position = (top < 0.0 || life >= 1.0) ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  gl_PointSize = clamp((0.05 + 0.15 * life) * pscale / max(d, 0.3), 1.5, 16.0);
  vA = (1.0 - life) * (1.0 - smoothstep(R * 0.6, R, length(xz - c.xz))) * (0.3 + flash * 0.5);
}`;
const SPLASH_F = `
varying float vA;
void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float a = (1.0 - smoothstep(0.7, 1.0, d)) * (0.4 + 0.6 * smoothstep(0.15, 0.7, d)); gl_FragColor = vec4(vec3(0.62, 0.74, 0.88) * (a * vA), 1.0); }`;
const MIST_V = `
attribute vec4 iPos; attribute vec3 iSz;
uniform float time; uniform float flash;
varying vec2 vUv; varying float vA; varying float vPh;
void main() {
  vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
  vec3 P = iPos.xyz + vec3(sin(time * 0.07 + iPos.w * 6.0) * 2.5, 0.0, cos(time * 0.05 + iPos.w * 4.0) * 2.5);
  float dist = length(cameraPosition - P);
  P += right * (position.x * iSz.x) + vec3(0.0, (position.y + 0.5) * iSz.y, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vUv = position.xy + 0.5; vPh = iPos.w;
  vA = iSz.z * smoothstep(4.0, 11.0, dist) * exp(-${(FOG0 * 0.55).toFixed(7)} * dist * dist) * (1.0 + flash * 1.2);
}`;
const MIST_F = `
uniform sampler2D noise; uniform float time;
varying vec2 vUv; varying float vA; varying float vPh;
void main() {
  float e = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float n = texture2D(noise, vec2(vUv.x * 0.55 + vPh + time * 0.012, vUv.y * 0.2 + vPh * 0.7)).r;
  float a = smoothstep(0.0, 0.55, e) * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y)) * smoothstep(0.3, 0.7, n) * vA;
  gl_FragColor = vec4(0.34, 0.4, 0.5, a);
}`;
const BEACON_V = `attribute vec3 aCol; varying vec3 vC; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vC = aCol * exp(-${(FOG0 * 0.35).toFixed(7)} * dot(mv.xyz, mv.xyz)); }`;
const BEACON_F = `varying vec3 vC; void main() { gl_FragColor = vec4(vC, 1.0); }`;

export class Env {
  constructor(game) {
    const g = this.g = game;
    this.t = 0; this.frame = 0; this.fxTick = -1; this.low = g.settings.quality === 'low';
    this.time = { value: 0 }; this.flash = { value: 0 };
    this.wind = new THREE.Vector3(3, 0, 1); this.drift = new THREE.Vector2();
    this.tv = new THREE.Vector3(); this.ta = new THREE.Vector3(); this.tb = new THREE.Vector3(); this.m4 = new THREE.Matrix4(); this.q4 = new THREE.Quaternion(); this.sc = new THREE.Vector3(1.5, 1.5, 1.5); this.up = new THREE.Vector3(0, 1, 0);
    this.noise = noiseTex();
    this.fogBase = g.scene.fog ? g.scene.fog.color.clone() : new THREE.Color(0x0d1522); this.bgBase = g.skyCol ? g.skyCol.clone() : this.fogBase.clone();
    this.lights = g.scene.children.filter(o => o.isHemisphereLight || o.isDirectionalLight).map(o => ({ o, i: o.intensity }));
    this.wasLit = false; this.hasBolt = false; this.amp = 1;
    // rain cover / splash height map: the game's colTop array, uploaded again whenever the world changes
    this.hmap = new THREE.DataTexture(g.colTop, SX, SZ, THREE.RedFormat, THREE.UnsignedByteType); this.hmap.needsUpdate = true;
    const orig = g.updateColTop.bind(g); g.updateColTop = (a, b, c, d) => { orig(a, b, c, d); this.hmap.needsUpdate = true; };
    this._buildSky(); this._buildBeams(); this._buildBeacons(); this._buildLife(); this._buildDrones();
  }

  // ------------------------------------------------------------------ sky
  _buildSky() {
    const g = this.g, sky = this.sky = new THREE.Group(); g.scene.add(sky);
    this.moonDir = new THREE.Vector3(-0.52, 0.42, -0.74).normalize(); this.boltDir = new THREE.Vector3(0, 1, 0);
    this.skyMat = new THREE.ShaderMaterial({ defines: this.low ? { LOW: 1 } : {}, uniforms: { noise: { value: this.noise }, time: this.time, flash: this.flash, boltDir: { value: this.boltDir }, moonDir: { value: this.moonDir }, fogCol: FOGU },
      vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false });
    this.skyMat.color = new THREE.Color(1, 1, 1);   // legacy field of the old dome material
    const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 20, 12), this.skyMat); dome.renderOrder = 900; dome.frustumCulled = false; sky.add(dome);
    // skyline ring
    const sl = skylineTex(), N = 96, Y0 = Math.tan(-2.5 * Math.PI / 180) * 100, Y1 = Math.tan(21 * Math.PI / 180) * 100;
    const pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2, c = Math.cos(a) * 100, s = Math.sin(a) * 100;
      pos.set([c, Y0, s, c, Y1, s], i * 6); uv.set([i / N, 0, i / N, 1], i * 4);
      if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); rg.setIndex(idx);
    const ring = new THREE.Mesh(rg, new THREE.ShaderMaterial({ uniforms: { map: { value: sl.tex }, fogCol: FOGU, flash: this.flash }, vertexShader: FAR_V, fragmentShader: SKYLINE_F, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false }));
    ring.renderOrder = 902; ring.frustumCulled = false; sky.add(ring);
    // blinking lights: skyline masts, then three per drone (updated every frame)
    const NB = sl.beacons.length, ND = this.low ? 0 : 2, NP = NB + ND * 3;
    const pp = this.dotPos = new Float32Array(NP * 3), pc = new Float32Array(NP * 3), pr = new Float32Array(NP * 3);
    for (let i = 0; i < NB; i++) {
      const [u, v] = sl.beacons[i], a = u * Math.PI * 2;
      pp.set([Math.cos(a) * 99, Y0 + v * (Y1 - Y0) + 0.3, Math.sin(a) * 99], i * 3); pc.set([1, 0.16, 0.1], i * 3); pr.set([(i * 0.37) % 1, 0.42 + (i % 3) * 0.09, 4.5], i * 3);
    }
    for (let d = 0; d < ND; d++) {
      const b = (NB + d * 3) * 3;
      pp.set([0, -500, 0, 0, -500, 0, 0, -500, 0], b);
      pc.set([1, 0.1, 0.08, 0.1, 1, 0.3, 1, 1, 1], b); pr.set([0.05, 0, 4, 0.05, 0, 4, d * 0.4, 0.9, 6], b);
    }
    this.dotBase = NB;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', this.dotAttr = new THREE.BufferAttribute(pp, 3).setUsage(THREE.DynamicDrawUsage)); dg.setAttribute('aCol', new THREE.BufferAttribute(pc, 3)); dg.setAttribute('aPar', new THREE.BufferAttribute(pr, 3));
    this.dotMat = new THREE.ShaderMaterial({ uniforms: { time: this.time, pxs: { value: 1 } }, vertexShader: DOT_V, fragmentShader: DOT_F, transparent: true, blending: ADD, depthWrite: false });
    const dots = new THREE.Points(dg, this.dotMat); dots.frustumCulled = false; dots.renderOrder = 1; sky.add(dots);
    // lightning bolt: ribbon strips rebuilt per strike, drawn between dome and skyline
    const MAXN = 96;
    this.boltPos = new Float32Array(MAXN * 6); this.boltUv = new Float32Array(MAXN * 4); this.boltIdx = new Uint16Array(MAXN * 6); this.bp = new Float32Array(48);
    const bg = this.boltGeo = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage)); bg.setAttribute('uv', new THREE.BufferAttribute(this.boltUv, 2).setUsage(THREE.DynamicDrawUsage));
    bg.setIndex(new THREE.BufferAttribute(this.boltIdx, 1).setUsage(THREE.DynamicDrawUsage));
    this.boltMat = new THREE.ShaderMaterial({ uniforms: { k: { value: 0 } }, vertexShader: FAR_V, fragmentShader: BOLT_F, blending: ADD, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });   // not "transparent": stays in the opaque list
    this.bolt = new THREE.Mesh(bg, this.boltMat); this.bolt.renderOrder = 901; this.bolt.frustumCulled = false; sky.add(this.bolt);
    this._strike(600);   // prebuilt once (drawn with k = 0 until the first strike) so its pipeline is warm
  }
  // new bolt at a random bearing: jagged trunk from the cloud base to the horizon plus a few forks
  _strike(dist, az0 = Math.random() * 6.283) {
    const R = Math.random, P = this.boltPos, U = this.boltUv, I = this.boltIdx, bp = this.bp, T = this.tv, A = this.ta, B = this.tb;
    this.boltDir.set(Math.cos(az0) * 0.86, 0.5, Math.sin(az0) * 0.86).normalize();
    this.boltAz = az0;
    let nv = 0, ni = 0;
    const dirOf = (v, az, el) => v.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const strip = (n, hw, inten) => {
      const base = nv;
      for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
        dirOf(A, bp[i0 * 2], bp[i0 * 2 + 1]); dirOf(B, bp[i1 * 2], bp[i1 * 2 + 1]); dirOf(T, bp[i * 2], bp[i * 2 + 1]);
        B.sub(A).cross(T).normalize().multiplyScalar(hw * (i === n - 1 ? 0.35 : 1));   // perpendicular to the path and to the view ray
        P[nv * 3] = T.x * 100 - B.x; P[nv * 3 + 1] = T.y * 100 - B.y; P[nv * 3 + 2] = T.z * 100 - B.z; U[nv * 2] = 0; U[nv * 2 + 1] = inten; nv++;
        P[nv * 3] = T.x * 100 + B.x; P[nv * 3 + 1] = T.y * 100 + B.y; P[nv * 3 + 2] = T.z * 100 + B.z; U[nv * 2] = 1; U[nv * 2 + 1] = inten; nv++;
        if (i < n - 1) { const k = base + i * 2; I[ni++] = k; I[ni++] = k + 1; I[ni++] = k + 2; I[ni++] = k + 1; I[ni++] = k + 3; I[ni++] = k + 2; }
      }
    };
    const near = Math.min(1.7, Math.max(0.7, 700 / dist)), eTop = Math.min(1.0, Math.max(0.42, Math.atan2(700, dist))), NT = 16, hw = 0.9 * near;
    const taz = new Float32Array(NT), tel = new Float32Array(NT); let az = az0;
    for (let i = 0; i < NT; i++) { az += (R() - 0.5) * 0.075; taz[i] = az; tel[i] = eTop * (1 - i / (NT - 1)) - 0.02 + (i > 0 && i < NT - 1 ? (R() - 0.5) * 0.02 : 0); bp[i * 2] = az; bp[i * 2 + 1] = tel[i]; }
    strip(NT, hw, 1);
    const forks = 2 + ((R() * 3) | 0);
    for (let f = 0; f < forks; f++) {
      const j = 2 + ((R() * 9) | 0), sg = R() < 0.5 ? -1 : 1, m = 4 + ((R() * 4) | 0); let a = taz[j], e = tel[j];
      for (let k = 0; k < m; k++) { bp[k * 2] = a; bp[k * 2 + 1] = e; a += sg * (0.014 + R() * 0.034); e -= 0.016 + R() * 0.036; }
      strip(m, hw * 0.5, 0.55);
    }
    const bg = this.boltGeo; bg.setDrawRange(0, ni); bg.attributes.position.needsUpdate = true; bg.attributes.uv.needsUpdate = true; bg.index.needsUpdate = true;
  }
  // searchlights over both bases (slots 0-3), objective columns (4-9), drone cones (10-11): one draw call
  _buildBeams() {
    const g = this.g, B = this.beams = new Beams(g.scene, 12, { fog: 0.12, order: 3 });
    for (let i = 0; i < 12; i++) B.set(i, 0, -50, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);
    for (let t = 0; t < 2; t++) {
      const b = BASES[t]; if (!b) continue;
      const cx = Math.floor(b.x / VS), cz = Math.floor(b.z / VS); let top = 0;
      for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) { const x = cx + dx, z = cz + dz; if (x >= 0 && z >= 0 && x < SX && z < SZ) top = Math.max(top, g.colTop[z * SX + x]); }
      const col = t === 0 ? [0.4, 0.78, 1.0] : [1.0, 0.6, 0.3], I = 0.085, n = this.low ? 1 : 2;
      for (let k = 0; k < n; k++) B.set(t * 2 + k, b.x + (k ? 3 : -3), Math.min(top, 24) * VS, b.z, k ? 0.25 : -0.25, 1, t === 0 ? -0.35 : 0.35, 80, 0.3, 3.4, col[0] * I, col[1] * I, col[2] * I, 7, 0.5, 0.16 + k * 0.05, t * 2.1 + k * 1.3);
    }
  }

  // ------------------------------------------------------------------ objective beacons
  _buildBeacons() {
    const nV = MAXB * (SEG + 1) * 4, idx = [];
    this.bPos = new Float32Array(nV * 3); this.bCol = new Float32Array(nV * 3);
    for (let f = 0; f < MAXB; f++) for (let s = 0; s < SEG; s++) for (let r = 0; r < 3; r++) { const a = (f * (SEG + 1) + s) * 4 + r, c = a + 4; idx.push(a, c, a + 1, a + 1, c, c + 1); }
    const bg = this.bGeo = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(this.bPos, 3).setUsage(THREE.DynamicDrawUsage)); bg.setAttribute('aCol', new THREE.BufferAttribute(this.bCol, 3).setUsage(THREE.DynamicDrawUsage)); bg.setIndex(idx);
    this.bMesh = new THREE.Mesh(bg, new THREE.ShaderMaterial({ vertexShader: BEACON_V, fragmentShader: BEACON_F, transparent: true, blending: ADD, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.bMesh.frustumCulled = false; this.bMesh.renderOrder = 2; this.g.scene.add(this.bMesh);
    this.bSig = -1; this.bN = 0;
  }
  // flags: [{ x, z, owner (-1 | 0 | 1), cap (-1..1, sign = capturing team), contested?, r?, y? }]; copes with any length
  _beacons() {
    const flags = this.g.flags || NONE, n = Math.min(MAXB, flags.length), B = this.beams, P = this.bPos, C = this.bCol;
    let sig = n;
    for (let i = 0; i < n; i++) { const f = flags[i]; sig = (sig * 131 + Math.round(f.x * 4) * 7 + Math.round(f.z * 4) * 3 + Math.round((f.r || 7.5) * 4) + Math.round((f.y || 0) * 4)) % 1000003; }
    if (sig !== this.bSig) {   // objectives appeared, vanished or moved: lay the rings out again
      this.bSig = sig; this.bN = n;
      for (let i = 0; i < n; i++) {
        const f = flags[i], rad = f.r || 7.5, y = (f.y ?? 1.0) + 0.05;
        for (let s = 0; s <= SEG; s++) { const a = s / SEG * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a); for (let r = 0; r < 4; r++) { const k = ((i * (SEG + 1) + s) * 4 + r) * 3, rr = rad + ROWS[r]; P[k] = f.x + sn * rr; P[k + 1] = y; P[k + 2] = f.z - cs * rr; } }
        B.set(4 + i, f.x, y + 2.3, f.z, 0, 1, 0, 42, 1.05, 0.6, 0, 0, 0, 48);   // starts above head height and fades out as you approach
      }
      for (let i = n; i < MAXB; i++) B.hide(4 + i);
      this.bGeo.attributes.position.needsUpdate = true; this.bGeo.setDrawRange(0, n * SEG * 18); this.bMesh.visible = n > 0;
    }
    for (let i = 0; i < n; i++) {
      const f = flags[i], cap = f.cap || 0, frac = Math.min(1, Math.abs(cap)), team = cap > 0 ? 0 : 1, owner = f.owner ?? -1;
      const pulse = f.contested ? 0.62 + 0.38 * Math.sin(this.t * 9) : 1;
      const oc = owner === 0 ? CY : owner === 1 ? OR : WH, tc = team === 0 ? CY : OR, k = 0.46 * pulse;
      B.setColor(4 + i, oc[0] * k, oc[1] * k, oc[2] * k);
      for (let s = 0; s <= SEG; s++) {
        const on = frac > 0 && s / SEG <= frac, col = on ? tc : WH, I = on ? 0.62 * pulse : 0.16;
        for (let r = 0; r < 4; r++) { const j = ((i * (SEG + 1) + s) * 4 + r) * 3, w = I * ROWI[r]; C[j] = col[0] * w; C[j + 1] = col[1] * w; C[j + 2] = col[2] * w; }
      }
    }
    if (n) this.bGeo.attributes.aCol.needsUpdate = true;
  }

  // ------------------------------------------------------------------ ambient life
  _buildLife() {
    const w = this.g.world, top = this.g.colTop, vents = this.vents = []; this.reAcc = 0;
    // manhole covers: isolated 2 x 2 metal plates flush with the road
    for (let z = 2; z < SZ - 3; z++) for (let x = 2; x < SX - 3; x++) {
      if (w.get(x, 1, z) !== MAT.METAL || w.get(x + 1, 1, z) !== MAT.METAL || w.get(x, 1, z + 1) !== MAT.METAL || w.get(x + 1, 1, z + 1) !== MAT.METAL) continue;
      if (w.get(x - 1, 1, z) === MAT.METAL || w.get(x, 1, z - 1) === MAT.METAL || w.get(x + 2, 1, z) === MAT.METAL || w.get(x, 1, z + 2) === MAT.METAL || w.get(x, 2, z) || w.get(x + 1, 2, z + 1)) continue;
      vents.push({ x: (x + 1) * VS, y: 1.05, z: (z + 1) * VS, vx: x, vy: 1, vz: z, m: MAT.METAL, s: 1, acc: Math.random() });
    }
    // rooftop units: a panel on a metal box, open to the sky
    for (let z = 2; z < SZ - 2; z++) for (let x = 2; x < SX - 2; x++) {
      const y = top[z * SX + x] - 1; if (y < G + 6 || vents.length >= 40 || w.get(x, y, z) !== MAT.PANEL || w.get(x, y - 1, z) !== MAT.METAL) continue;
      let ok = true; for (const v of vents) if (Math.abs(v.x - x * VS) + Math.abs(v.z - z * VS) < 5 && v.m === MAT.PANEL) { ok = false; break; }
      if (ok) vents.push({ x: (x + 0.5) * VS, y: (y + 1) * VS, z: (z + 0.5) * VS, vx: x, vy: y, vz: z, m: MAT.PANEL, s: 1.3, acc: Math.random() });
    }
  }
  _life(dt) {
    const g = this.g, fx = g.fx, cp = g.camera.position, w = g.world, R = Math.random, M = fx.smoke, S = fx.sparks, q = fx.q;
    for (const v of this.vents) {   // steam
      const dx = v.x - cp.x, dz = v.z - cp.z; if (dx * dx + dz * dz > 1500) continue;
      v.acc += dt * 3 * q; if (v.acc < 1) continue; v.acc -= 1;
      if (w.get(v.vx, v.vy, v.vz) !== v.m) continue;
      const k = M.emit(v.x + (R() - 0.5) * 0.4, v.y, v.z + (R() - 0.5) * 0.4, (R() - 0.5) * 0.3, 0.9 + R() * 0.8, (R() - 0.5) * 0.3, 0.3, 0.33, 0.38, 2 + R() * 1.2, -0.3, 0.5, 0.22 * v.s, 0.95 * v.s); M.al[k] = 0.6;
    }
    // reactor: quantum motes orbiting the live core, embers and smoke once it has blown
    const rx = 96 * VS, rz = 96 * VS, ex = rx - cp.x, ez = rz - cp.z;
    if (ex * ex + ez * ez < 3600) {
      this.reAcc += dt * 9 * q;
      const alive = w.get(96, G + 8, 96) === MAT.LAMP_M;
      while (this.reAcc >= 1) {
        this.reAcc -= 1; const a = R() * 6.283, d = 1.5 + R() * 4.5;
        if (alive) { const m = R() < 0.75; S.emit(rx + Math.cos(a) * d, 1.2 + R() * 7, rz + Math.sin(a) * d, -Math.sin(a) * 0.7, 0.3 + R() * 0.8, Math.cos(a) * 0.7, m ? 1 : 0.3, m ? 0.35 : 0.95, 1, 1.6 + R() * 1.8, -0.15, 0.2, 0.75, 0.2); }
        else {
          const k = S.emit(rx + Math.cos(a) * d * 0.9, 0.6 + R() * 1.5, rz + Math.sin(a) * d * 0.9, R() - 0.5, 1 + R() * 2, R() - 0.5, 1.4, 0.55, 0.12, 2 + R() * 2, -0.5, 0.8, 0.7, 0.25); S.fade(k, 0.8, 0.15, 0.02);
          if (R() < 0.14) { const j = M.emit(rx + Math.cos(a) * d * 0.5, 0.8, rz + Math.sin(a) * d * 0.5, 0, 1.6 + R(), 0, 0.09, 0.08, 0.08, 3 + R() * 1.5, -0.3, 0.4, 0.7, 1.7); M.al[j] = 0.7; }
        }
      }
    }
    const e = g.echo; if (e && e.alive && e.pos) { this.tv.set(e.pos.x, e.pos.y + 1.25, e.pos.z); fx.shimmer(this.tv, dt); }   // superposition shimmer
  }
  // two decorative patrol drones: dark body, nav lights, a faint search cone
  _buildDrones() {
    this.drones = [];
    if (this.low) return;
    const parts = [[0, 0, 0, 0.5, 0.2, 0.8], [0, 0.02, 0, 1.6, 0.06, 0.12], [0, 0.02, 0, 0.12, 0.06, 1.6], [0.8, 0.08, 0, 0.4, 0.04, 0.4], [-0.8, 0.08, 0, 0.4, 0.04, 0.4], [0, 0.08, 0.8, 0.4, 0.04, 0.4], [0, 0.08, -0.8, 0.4, 0.04, 0.4], [0, -0.16, 0.3, 0.16, 0.14, 0.16]];
    const pos = [];
    for (const [x, y, z, sx, sy, sz] of parts) { const b = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); b.translate(x, y, z); for (const v of b.attributes.position.array) pos.push(v); }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.droneMesh = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: 0x0b0f17, fog: true }), 2);
    this.droneMesh.frustumCulled = false; this.droneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.g.scene.add(this.droneMesh);
    for (let i = 0; i < 2; i++) this.drones.push({ ph: i * 3.3 + 0.6, rx: 34 - i * 12, rz: 22 + i * 14, sp: (i ? -1 : 1) * (0.085 + i * 0.03), alt: 19.5 + i * 2.5 });
  }
  _drones() {
    const t = this.t, B = this.beams, dp = this.dotPos, sp = this.sky.position, T = this.tv;
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i], a = t * d.sp + d.ph;
      const x = 48 + Math.cos(a) * d.rx, z = 48 + Math.sin(a) * d.rz, y = d.alt + Math.sin(t * 0.4 + d.ph) * 0.8;
      let tx = -Math.sin(a) * d.rx * d.sp, tz = Math.cos(a) * d.rz * d.sp; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      this.q4.setFromAxisAngle(this.up, Math.atan2(tx, tz)); T.set(x, y, z); this.m4.compose(T, this.q4, this.sc); this.droneMesh.setMatrixAt(i, this.m4);
      const b = (this.dotBase + i * 3) * 3, rx = tz * 1.25, rz = -tx * 1.25;   // right vector
      dp[b] = x + rx - sp.x; dp[b + 1] = y - sp.y; dp[b + 2] = z + rz - sp.z; dp[b + 3] = x - rx - sp.x; dp[b + 4] = y - sp.y; dp[b + 5] = z - rz - sp.z; dp[b + 6] = x - sp.x; dp[b + 7] = y - 0.3 - sp.y; dp[b + 8] = z - sp.z;
      const dl = Math.hypot(tx * 0.35, 1, tz * 0.35);
      B.setOrigin(10 + i, x, y - 0.3, z); B.setDir(10 + i, tx * 0.35 / dl, -1 / dl, tz * 0.35 / dl, (y - 1) * 1.06);
      if (!d.on) { d.on = true; const k = (10 + i) * 4; B.r[k] = 0.1; B.r[k + 1] = 2.6; B.c[k] = 0.04; B.c[k + 1] = 0.055; B.c[k + 2] = 0.075; B.c[k + 3] = 4; B.aR.needsUpdate = B.aC.needsUpdate = true; }
    }
    if (this.drones.length) { this.droneMesh.instanceMatrix.needsUpdate = true; this.dotAttr.needsUpdate = true; }
  }

  // ------------------------------------------------------------------ weather
  buildRain() {
    const g = this.g, scene = g.scene, top = g.colTop, R = rng(4242), NR = this.NR = 2000, NS = this.NS = 640;
    // rain: thin camera-facing quads, simulated in the vertex shader (no per-frame CPU or buffer uploads)
    const pos = new Float32Array(NR * 12), aux = new Float32Array(NR * 12), idx = new Uint16Array(NR * 6);
    for (let i = 0; i < NR; i++) {
      const x = R(), y = R(), z = R(), s = R();
      for (let k = 0; k < 4; k++) { pos.set([x, y, z], (i * 4 + k) * 3); aux.set([s, k === 0 || k === 3 ? -1 : 1, k < 2 ? 0 : 1], (i * 4 + k) * 3); }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rg.setAttribute('aux', new THREE.BufferAttribute(aux, 3)); rg.setIndex(new THREE.BufferAttribute(idx, 1));
    this.rainMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: this.hmap }, time: this.time, drift: { value: this.drift }, wind: { value: this.wind }, px: { value: 0.003 }, flash: this.flash },
      vertexShader: RAIN_V, fragmentShader: RAIN_F, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true });
    this.rain = new THREE.Mesh(rg, this.rainMat); this.rain.frustumCulled = false; this.rain.renderOrder = 8; scene.add(this.rain);
    // splashes where drops land: points that re-roll their position every cycle
    const sp = new Float32Array(NS * 3), sa = new Float32Array(NS); for (let i = 0; i < NS; i++) { sp.set([R(), R(), R()], i * 3); sa[i] = R(); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('aR', new THREE.BufferAttribute(sa, 1));
    this.splashMat = new THREE.ShaderMaterial({ uniforms: { hmap: { value: this.hmap }, time: this.time, pscale: { value: 440 }, flash: this.flash }, vertexShader: SPLASH_V, fragmentShader: SPLASH_F, transparent: true, blending: ADD, depthWrite: false });
    this.splash = new THREE.Points(sg, this.splashMat); this.splash.frustumCulled = false; this.splash.renderOrder = 7; scene.add(this.splash);
    // mist: a few low, wide billboards over open ground
    const spots = [], want = 16, R2 = rng(777);
    for (let tries = 0; tries < 5000 && spots.length < want; tries++) {
      const x = 8 + ((R2() * (SX - 16)) | 0), z = 8 + ((R2() * (SZ - 16)) | 0); let ok = true;
      for (let dz = -4; dz <= 4 && ok; dz += 2) for (let dx = -4; dx <= 4; dx += 2) if (top[(z + dz) * SX + x + dx] > 2) { ok = false; break; }
      if (ok) for (const s of spots) if (Math.hypot(s[0] - x, s[1] - z) < 20) { ok = false; break; }
      if (ok) spots.push([x, z]);
    }
    const mN = this.mistN = spots.length, mg = quadGeo(Math.max(1, mN)), mp = new Float32Array(Math.max(1, mN) * 4), ms = new Float32Array(Math.max(1, mN) * 3);
    for (let i = 0; i < mN; i++) { mp.set([spots[i][0] * VS, 1.0, spots[i][1] * VS, R2()], i * 4); ms.set([7 + R2() * 5, 1.3 + R2() * 0.9, 0.2 + R2() * 0.1], i * 3); }
    inst(mg, 'iPos', mp, 4); inst(mg, 'iSz', ms, 3);
    this.mist = new THREE.Mesh(mg, new THREE.ShaderMaterial({ uniforms: { noise: { value: this.noise }, time: this.time, flash: this.flash }, vertexShader: MIST_V, fragmentShader: MIST_F, transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }));
    this.mist.frustumCulled = false; this.mist.renderOrder = 4; scene.add(this.mist);
    // puddles (water voxels open to the sky) for rain ripples
    const pud = []; for (let z = 1; z < SZ - 1; z++) for (let x = 1; x < SX - 1; x++) if (top[z * SX + x] === 2 && g.world.get(x, 1, z) === MAT.WATER) pud.push(x, z);
    this.pud = new Uint8Array(pud); this.ripples = new Rings(scene, 64, 2); this.ripAcc = 0;
    this._counts();
  }
  _counts() {
    const low = this.low;
    this.rain.geometry.setDrawRange(0, (low ? 800 : this.NR) * 6); this.splash.geometry.setDrawRange(0, low ? 220 : this.NS);
    this.mist.geometry.instanceCount = Math.max(1, low ? Math.min(7, this.mistN) : this.mistN); this.mist.visible = this.mistN > 0;
  }
  _ripples(dt) {
    const g = this.g, n = this.pud.length >> 1; if (!n) return;
    const cp = g.camera.position, R = Math.random, top = g.colTop;
    this.ripAcc += dt * (this.low ? 14 : 34);
    while (this.ripAcc >= 1) {
      this.ripAcc -= 1;
      for (let tries = 0; tries < 5; tries++) {
        const i = ((R() * n) | 0) * 2, x = this.pud[i], z = this.pud[i + 1], dx = (x + 0.5) * VS - cp.x, dz = (z + 0.5) * VS - cp.z;
        if (dx * dx + dz * dz > 480 || top[z * SX + x] !== 2) continue;
        this.ripples.emit((x + R()) * VS, 1.012, (z + R()) * VS, 0.03, 0.2 + R() * 0.22, 0.55 + R() * 0.3, 0.42, 0.52, 0.66, 0.5, 0.34);
        break;
      }
    }
    this.ripples.update(dt);
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g, cam = g.camera, fx = g.fx, scene = g.scene;
    this.t += dt; const t = this.t; this.time.value = t; this.frame++;
    if (fx.tick === this.fxTick) fx.update(dt);   // states that do not tick the effects (menu) still animate them
    this.fxTick = fx.tick;
    if (this.frame === 40 && fx.prewarm) fx.prewarm(g.renderer, scene, cam);
    if (this.frame % 90 === 1) {
      // 'auto' quality: once the adaptive resolution has been pushed down this far the GPU is struggling, so the
      // effects go lean too and stay lean for the session (a latch, so the two controllers never oscillate)
      const ql = g.settings.quality; if (ql === 'auto' && g.scale < 0.7) this.lean = true;
      const low = ql === 'low' || (ql === 'auto' && this.lean === true);
      if (low !== this.low) { this.low = low; fx.q = low ? 0.5 : 1; fx.wlOff = low; if (this.rain) this._counts(); }
    }
    // wind: a steady slant with slow gusts; rain, smoke and steam lean with it
    const gust = Math.max(0, Math.sin(t * 0.21) * Math.sin(t * 0.067 + 1.3)) + 0.25 * Math.sin(t * 0.9) * Math.sin(t * 0.33);
    this.wind.set(2.4 + 4.2 * gust, 0, 0.9 + 1.4 * Math.sin(t * 0.05));
    this.drift.x = (this.drift.x + this.wind.x * dt) % 4400; this.drift.y = (this.drift.y + this.wind.z * dt) % 4400;
    fx.wind.copy(this.wind);
    const hpx = g.renderer.domElement.height || 720, tanF = Math.tan(cam.fov * Math.PI / 360);
    if (this.rain) { this.rainMat.uniforms.px.value = 2 * tanF / hpx * 1.3; this.splashMat.uniforms.pscale.value = hpx / (2 * tanF); }
    this.dotMat.uniforms.pxs.value = hpx / 720;
    // lightning: double strobe that brightens the baked world, the fog, the clouds from inside and the lit
    // entities, plus a bolt at a random bearing; thunder arrives after dist / 343 s
    g.nextLightning -= dt;
    if (g.nextLightning <= 0) {
      g.nextLightning = 9 + Math.random() * 16; g.lightning = 1; g.lightningPh = 0;
      const dist = 300 + Math.random() * 900; // metres → thunder delay = d / 343
      setTimeout(() => g.audio.play('thunder', null, 0.84 * (1 - dist / 1400) + 0.24, 1, 0.8), dist / 343 * 1000);
      this._strike(dist); this.hasBolt = Math.random() < 0.72; this.amp = 1 - (dist - 300) / 900 * 0.35;
    }
    if (g.lightning > 0) {
      g.lightningPh += dt; const k = g.lightningPh;
      const I = (k < 0.06 ? 1 : k < 0.12 ? 0.2 : k < 0.2 ? 0.8 : Math.max(0, 0.8 - (k - 0.2) * 3)) * this.amp;
      if (k > 0.5) g.lightning = 0;
      this._flash(g.lightning > 0 ? I : 0);
    } else if (this.wasLit) this._flash(0);
    this._beacons(); this._drones(); this._life(dt);
    if (this.rain) this._ripples(dt);
    this.beams.update(t);
    if (g.glow && g.glow.update) g.glow.update(dt);
  }
  _flash(I) {
    const g = this.g, scene = g.scene, fb = this.fogBase, bb = this.bgBase;
    this.wasLit = I > 0;
    const m = 1 + I * 1.6; g.world.mat.color.setRGB(m, m, 1 + I * 1.73);
    if (scene.background && scene.background.isColor) scene.background.setRGB(bb.r + I * 0.4, bb.g + I * 0.45, bb.b + I * 0.55);
    scene.fog.color.setRGB(fb.r + I * 0.3, fb.g + I * 0.33, fb.b + I * 0.4);
    syncFog(scene);
    this.flash.value = I; g.fx.setFlash(I);
    for (const L of this.lights) L.o.intensity = L.i * (1 + I * 1.3);
    this.bolt.visible = this.hasBolt && I > 0.3; this.boltMat.uniforms.k.value = I;
  }
}
