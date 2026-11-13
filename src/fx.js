// Combat effects. Everything is pooled and fixed-size (no per-frame allocations, constant buffers):
// instanced billboard particles (streak sparks with bounce, smoke, fire), ground / billboard rings
// (shockwaves, ripples), voxel-face decals (bullet holes, scorched voxels), tapered tracer ribbons,
// light-beam cards, tumbling debris cubes and two cheap dynamic lights injected into the baked voxel material.
import * as THREE from 'three';
import { VS, SX, SY, SZ, MAT, MATDEF } from './world.js';

const ADD = THREE.AdditiveBlending;
// The custom shaders in this file write display-referred colours (no colour-space conversion), so the scene
// fog colour is converted once per frame into this shared uniform.
export const FOGU = { value: new THREE.Color().setRGB(0.051, 0.082, 0.133) };
export const FOGD = { value: 0.022 };
export function syncFog(scene) { if (scene.fog) { FOGU.value.copy(scene.fog.color).convertLinearToSRGB(); FOGD.value = scene.fog.density; } }

export function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function dotTex(soft) {
  const c = canvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(soft ? 0.4 : 0.25, 'rgba(255,255,255,' + (soft ? 0.6 : 0.9) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
// lumpy puff: overlapping soft blobs, used for smoke, dust and fire
function puffTex(seed, blobs = 9) {
  const c = canvas(64, 64), g = c.getContext('2d'), R = rng(seed);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < blobs; i++) {
    const a = R() * 6.283, d = R() * 10, r = 9 + R() * 9, x = 32 + Math.cos(a) * d, y = 32 + Math.sin(a) * d;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.46)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.17)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}
// decal atlas, 4 x 2 cells of 16 x 16 chunky pixels: 0 stone hole, 1 metal dent, 2 wood, 3 glass crack,
// 4 soft ground, 5 / 6 charred voxel face, 7 charred fringe (dithered)
function decalAtlas() {
  const c = canvas(256, 128), g = c.getContext('2d'), R = rng(99);
  const px = (cx, cy, x, y, col) => { if (x < 0 || y < 0 || x > 15 || y > 15) return; g.fillStyle = col; g.fillRect(cx * 64 + x * 4, cy * 64 + y * 4, 4, 4); };
  const blob = (cx, cy, r, col, fill = 1, r0 = 0) => { for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d <= r && d >= r0 && R() < fill) px(cx, cy, x, y, col); } };
  blob(0, 0, 5.4, 'rgba(12,12,16,0.34)', 0.5, 2.4); blob(0, 0, 4.0, 'rgba(160,165,178,0.26)', 0.4, 2.2); blob(0, 0, 2.3, 'rgba(6,7,9,0.95)');
  blob(1, 0, 4.6, 'rgba(8,8,10,0.4)', 0.55, 2.6); blob(1, 0, 3.1, 'rgba(176,186,204,0.5)', 0.7, 1.9); blob(1, 0, 1.9, 'rgba(4,5,7,0.96)');
  for (let i = 0; i < 9; i++) { const x = 5 + (R() * 6 | 0), l = 2 + (R() * 4 | 0), up = R() < 0.5; for (let k = 0; k < l; k++) px(2, 0, x, up ? 6 - k : 9 + k, R() < 0.6 ? 'rgba(196,164,118,0.5)' : 'rgba(20,12,6,0.6)'); }
  blob(2, 0, 2.0, 'rgba(10,6,3,0.95)');
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 + R() * 0.5, l = 4 + R() * 3.5; for (let k = 1.2; k < l; k += 0.7) px(3, 0, Math.round(7.5 + Math.cos(a) * k), Math.round(7.5 + Math.sin(a) * k), 'rgba(235,250,255,' + (0.85 - k / l * 0.4).toFixed(2) + ')'); }
  blob(3, 0, 1.3, 'rgba(8,16,24,0.85)');
  blob(0, 1, 4.4, 'rgba(10,9,8,0.36)', 0.5, 2.4); blob(0, 1, 2.7, 'rgba(8,7,6,0.8)');
  for (const cx of [1, 2, 3]) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edge = x === 0 || y === 0 || x === 15 || y === 15, r = R();
    if (cx === 3 && r < 0.42) continue;
    const a = ((edge ? 0.62 : 0.84) + R() * 0.14).toFixed(2);
    px(cx, 1, x, y, R() < 0.06 ? 'rgba(62,58,55,' + a + ')' : 'rgba(7,6,6,' + a + ')');
  }
  const t = new THREE.CanvasTexture(c); t.flipY = false; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.NearestFilter; return t;
}

const QUAD = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]);
export function quadGeo(n) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(QUAD, 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.instanceCount = n;
  return g;
}
export const inst = (g, name, arr, size) => { const a = new THREE.InstancedBufferAttribute(arr, size).setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };

// ------------------------------------------------------------------ particles
const PVERT = `
attribute vec3 iPos; attribute vec4 iCol; attribute vec2 iSize;
#ifdef STREAK
attribute vec3 iVel;
#endif
uniform float fogDensity;
varying vec4 vC; varying vec2 vUv; varying float vFog;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  vec2 c = position.xy;
#ifdef STREAK
  vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
  float sp = length(vv.xy);
  vec2 dir = sp > 0.001 ? vv.xy / sp : vec2(0.0, 1.0);
  float len = iSize.x + min(sp * 0.035, 0.9) * step(0.0001, iSize.x);
  mv.xy += dir * (c.y * len) + vec2(-dir.y, dir.x) * (c.x * iSize.x);
#else
  float cs = cos(iSize.y), sn = sin(iSize.y);
  mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * iSize.x;
#endif
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vFog = 1.0 - exp(-fogDensity * fogDensity * d * d);
  vUv = position.xy + 0.5;
  vC = iCol;
#ifdef NEARFADE
  vC.a *= smoothstep(0.4, 1.9, d);
#endif
}`;
const PFRAG = `
uniform sampler2D map; uniform float opacity; uniform float lit; uniform vec3 fogColor;
varying vec4 vC; varying vec2 vUv; varying float vFog;
void main() {
  float a = texture2D(map, vUv).a * vC.a * opacity;
#ifdef ADDITIVE
  gl_FragColor = vec4(vC.rgb * (a * (1.0 - vFog)), 1.0);
#else
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vC.rgb * lit, fogColor, vFog), a);
#endif
}`;
// Instanced camera-facing quads. emit() keeps the historical signature (size is in metres, s0 / s1 are
// multipliers of the pool size at birth / death) and returns the slot so callers can tweak fade(), al[], bnc[].
export class Particles {
  constructor(scene, n, size, blending, tex, opacity = 1, opt = {}) {
    const add = blending === ADD;
    this.n = n; this.i = 0; this.size = size; this.additive = add; this.w = opt.world || null; this.rot = !!opt.rot; this.busy = 0.3; this.ax = 0; this.az = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 4); this.s = new Float32Array(n * 2);
    this.base = new Float32Array(n * 3); this.end = new Float32Array(n * 3);
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n); this.al = new Float32Array(n); this.spin = new Float32Array(n); this.bnc = new Uint8Array(n);
    const g = quadGeo(n);
    this.aP = inst(g, 'iPos', this.p, 3); this.aC = inst(g, 'iCol', this.c, 4); this.aS = inst(g, 'iSize', this.s, 2);
    this.aV = opt.streak ? inst(g, 'iVel', this.v, 3) : null;
    const defines = {}; if (add) defines.ADDITIVE = 1; if (opt.streak) defines.STREAK = 1; if (opt.nearFade) defines.NEARFADE = 1;
    this.m = new THREE.ShaderMaterial({ defines, uniforms: { map: { value: tex }, opacity: { value: opacity }, lit: { value: 1 }, fogColor: FOGU, fogDensity: FOGD },
      vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, blending, depthWrite: false });
    this.pts = new THREE.Mesh(g, this.m); this.pts.frustumCulled = false; this.pts.renderOrder = opt.order || 5; scene.add(this.pts);
  }
  fade(k, r, g, b) { const E = this.end, k3 = k * 3; E[k3] = r; E[k3 + 1] = g; E[k3 + 2] = b; }
  emit(x, y, z, vx, vy, vz, r, g, b, life, grav = 9.8, drag = 0, s0 = 1, s1 = s0) {
    const k = this.i, k3 = k * 3; this.i = (k + 1) % this.n;
    const p = this.p, v = this.v, B = this.base, E = this.end;
    p[k3] = x; p[k3 + 1] = y; p[k3 + 2] = z; v[k3] = vx; v[k3 + 1] = vy; v[k3 + 2] = vz;
    B[k3] = E[k3] = r; B[k3 + 1] = E[k3 + 1] = g; B[k3 + 2] = E[k3 + 2] = b;
    this.life[k] = this.max[k] = life; this.grav[k] = grav; this.drag[k] = drag;
    this.s0[k] = s0 * this.size; this.s1[k] = s1 * this.size; this.al[k] = 1; this.bnc[k] = 0;
    if (this.rot) { this.s[k * 2 + 1] = Math.random() * 6.283; this.spin[k] = (Math.random() - 0.5) * 1.4; }
    if (life > this.busy) this.busy = life;
    if (!this.pts.visible) this.pts.visible = true;
    return k;
  }
  update(dt) {
    if (this.busy < -0.25) { if (this.pts.visible) this.pts.visible = false; return; }   // idle pools cost no draw call
    this.busy -= dt;
    const { p, v, c, s, life, max, base, end, grav, drag, s0, s1, al, bnc, spin, n, additive, w } = this;
    const ax = this.ax * dt, az = this.az * dt;
    for (let k = 0; k < n; k++) {
      const k2 = k * 2;
      if (life[k] <= 0) { s[k2] = 0; continue; }
      life[k] -= dt;
      if (life[k] <= 0) { s[k2] = 0; continue; }
      const k3 = k * 3, k4 = k * 4;
      if (drag[k] > 0) { const d = Math.exp(-drag[k] * dt); v[k3] *= d; v[k3 + 1] *= d; v[k3 + 2] *= d; }
      v[k3] += ax; v[k3 + 1] -= grav[k] * dt; v[k3 + 2] += az;
      const nx = p[k3] + v[k3] * dt, ny = p[k3 + 1] + v[k3 + 1] * dt, nz = p[k3 + 2] + v[k3 + 2] * dt;
      if (bnc[k] && w.get((nx / VS) | 0, (ny / VS) | 0, (nz / VS) | 0)) {
        // bounce on the axis that entered a solid cell
        if (w.get((p[k3] / VS) | 0, (ny / VS) | 0, (p[k3 + 2] / VS) | 0)) { v[k3 + 1] *= -0.42; v[k3] *= 0.7; v[k3 + 2] *= 0.7; }
        else { v[k3] *= -0.4; v[k3 + 2] *= -0.4; }
        bnc[k]--;
      } else { p[k3] = nx; p[k3 + 1] = ny; p[k3 + 2] = nz; }
      const f = life[k] / max[k], u = 1 - f * f;
      c[k4] = base[k3] + (end[k3] - base[k3]) * u; c[k4 + 1] = base[k3 + 1] + (end[k3 + 1] - base[k3 + 1]) * u; c[k4 + 2] = base[k3 + 2] + (end[k3 + 2] - base[k3 + 2]) * u;
      c[k4 + 3] = (additive ? f : Math.min(1, f * 1.6) * Math.min(1, (max[k] - life[k]) * 8)) * al[k];
      s[k2] = s0[k] + (s1[k] - s0[k]) * (1 - f); s[k2 + 1] += spin[k] * dt;
    }
    this.aP.needsUpdate = this.aC.needsUpdate = this.aS.needsUpdate = true; if (this.aV) this.aV.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ rings (shockwaves, ripples, light pools)
const RVERT = `
attribute vec3 iPos; attribute vec4 iPar; attribute vec3 iCol;
uniform float fogDensity;
varying vec2 vUv; varying vec3 vC; varying float vTh;
void main() {
  vec2 c = position.xy * 2.0; float R = iPar.x; vec4 mv;
  if (iPar.z > 0.5) { mv = viewMatrix * vec4(iPos, 1.0); mv.xy += c * R; }
  else mv = viewMatrix * vec4(iPos + vec3(c.x * R, 0.0, c.y * R), 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  vUv = c; vTh = iPar.y; vC = iCol * (iPar.w * exp(-fogDensity * fogDensity * d * d));
}`;
const RFRAG = `
varying vec2 vUv; varying vec3 vC; varying float vTh;
void main() {
  float d = length(vUv); float a;
  if (vTh >= 1.0) { a = max(0.0, 1.0 - d); a *= a; }
  else { float e = (d - 1.0 + vTh) / vTh; a = (e <= 0.0 || e >= 1.0) ? 0.0 : smoothstep(0.0, 0.7, e) * (1.0 - smoothstep(0.82, 1.0, e)); }
  gl_FragColor = vec4(vC * a, 1.0);
}`;
// Additive rings: flat on the ground (default) or camera-facing. thick >= 1 draws a filled soft disc.
export class Rings {
  constructor(scene, n = 48, order = 3) {
    this.n = n; this.i = 0; this.busy = 0.3;
    this.p = new Float32Array(n * 3); this.par = new Float32Array(n * 4); this.col = new Float32Array(n * 3);
    this.r0 = new Float32Array(n); this.r1 = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n); this.a0 = new Float32Array(n); this.delay = new Float32Array(n);
    const g = quadGeo(n);
    this.aP = inst(g, 'iPos', this.p, 3); this.aR = inst(g, 'iPar', this.par, 4); this.aC = inst(g, 'iCol', this.col, 3);
    this.m = new THREE.ShaderMaterial({ uniforms: { fogDensity: FOGD }, vertexShader: RVERT, fragmentShader: RFRAG, transparent: true, blending: ADD, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.mesh = new THREE.Mesh(g, this.m); this.mesh.frustumCulled = false; this.mesh.renderOrder = order; scene.add(this.mesh);
  }
  emit(x, y, z, r0, r1, life, r, g, b, alpha = 1, thick = 0.2, billboard = false, delay = 0) {
    const k = this.i, k3 = k * 3, k4 = k * 4; this.i = (k + 1) % this.n;
    this.p[k3] = x; this.p[k3 + 1] = y; this.p[k3 + 2] = z; this.col[k3] = r; this.col[k3 + 1] = g; this.col[k3 + 2] = b;
    this.par[k4] = 0; this.par[k4 + 1] = thick; this.par[k4 + 2] = billboard ? 1 : 0; this.par[k4 + 3] = 0;
    this.r0[k] = r0; this.r1[k] = r1; this.life[k] = this.max[k] = life; this.a0[k] = alpha; this.delay[k] = delay;
    if (life + delay > this.busy) this.busy = life + delay;
    if (!this.mesh.visible) this.mesh.visible = true;
    return k;
  }
  update(dt) {
    if (this.busy < -0.25) { if (this.mesh.visible) this.mesh.visible = false; return; }
    this.busy -= dt;
    const { par, life, max, r0, r1, a0, delay, n } = this;
    for (let k = 0; k < n; k++) {
      const k4 = k * 4;
      if (life[k] <= 0) { par[k4] = 0; continue; }
      if (delay[k] > 0) { delay[k] -= dt; continue; }
      life[k] -= dt;
      if (life[k] <= 0) { par[k4] = 0; continue; }
      const f = 1 - life[k] / max[k], e = 1 - (1 - f) * (1 - f);
      par[k4] = r0[k] + (r1[k] - r0[k]) * e; par[k4 + 3] = a0[k] * (1 - f) * (1 - f * 0.5);
    }
    this.aP.needsUpdate = this.aR.needsUpdate = this.aC.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ decals on voxel faces
const DVERT = `
attribute vec3 iPos; attribute vec3 iN; attribute vec4 iPar;
uniform float fogDensity;
varying vec2 vUv; varying float vA;
void main() {
  vec3 n = iN;
  vec3 t = normalize(cross(abs(n.y) > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), n));
  vec3 b = cross(n, t);
  float cs = cos(iPar.y), sn = sin(iPar.y);
  vec2 c = vec2(position.x * cs - position.y * sn, position.x * sn + position.y * cs) * iPar.x;
  vec4 mv = viewMatrix * vec4(iPos + t * c.x + b * c.y + n * 0.012, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = -mv.z;
  float cell = iPar.w;
  vUv = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + 0.02 + (position.xy + 0.5) * 0.96) * vec2(0.25, 0.5);
  vA = iPar.z * exp(-fogDensity * fogDensity * d * d);
}`;
const DFRAG = `
uniform sampler2D map;
varying vec2 vUv; varying float vA;
void main() { vec4 t = texture2D(map, vUv); float a = t.a * vA; if (a < 0.02) discard; gl_FragColor = vec4(t.rgb, a); }`;
// Two ring buffers in one instanced mesh: bullet holes [0, NH) and charred voxel faces [NH, N).
// Every decal remembers its voxel; it is released as soon as that voxel disappears.
export class Decals {
  constructor(scene, world, nHoles = 192, nChar = 960) {
    const n = nHoles + nChar; this.w = world; this.n = n; this.NH = nHoles; this.NC = nChar; this.hi = 0; this.ci = 0; this.ri = 0; this.dirty = true;
    this.p = new Float32Array(n * 3); this.nr = new Float32Array(n * 3); this.par = new Float32Array(n * 4); this.vox = new Int16Array(n * 3);
    for (let k = 0; k < n; k++) this.nr[k * 3 + 1] = 1;
    const g = quadGeo(n);
    this.aP = inst(g, 'iPos', this.p, 3); this.aN = inst(g, 'iN', this.nr, 3); this.aR = inst(g, 'iPar', this.par, 4);
    this.m = new THREE.ShaderMaterial({ uniforms: { map: { value: decalAtlas() }, fogDensity: FOGD }, vertexShader: DVERT, fragmentShader: DFRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(g, this.m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1; scene.add(this.mesh);
  }
  _put(k, x, y, z, nx, ny, nz, size, rot, alpha, cell, vx, vy, vz) {
    const k3 = k * 3, k4 = k * 4;
    this.p[k3] = x; this.p[k3 + 1] = y; this.p[k3 + 2] = z; this.nr[k3] = nx; this.nr[k3 + 1] = ny; this.nr[k3 + 2] = nz;
    this.par[k4] = size; this.par[k4 + 1] = rot; this.par[k4 + 2] = alpha; this.par[k4 + 3] = cell;
    this.vox[k3] = vx; this.vox[k3 + 1] = vy; this.vox[k3 + 2] = vz; this.dirty = true;
  }
  // bullet hole at hit point p on the face with normal n (axis aligned), clamped inside that voxel face
  hole(p, n, cell, size) {
    if (!n.x && !n.y && !n.z) return;
    const vx = Math.floor((p.x - n.x * 0.05) / VS), vy = Math.floor((p.y - n.y * 0.05) / VS), vz = Math.floor((p.z - n.z * 0.05) / VS);
    const lo = size * 0.5 + 0.004, hi = VS - lo;
    let x = Math.min(vx * VS + hi, Math.max(vx * VS + lo, p.x)), y = Math.min(vy * VS + hi, Math.max(vy * VS + lo, p.y)), z = Math.min(vz * VS + hi, Math.max(vz * VS + lo, p.z));
    if (n.x) x = (n.x > 0 ? vx + 1 : vx) * VS; else if (n.y) y = (n.y > 0 ? vy + 1 : vy) * VS; else z = (n.z > 0 ? vz + 1 : vz) * VS;
    const k = this.hi; this.hi = (k + 1) % this.NH;
    this._put(k, x, y, z, n.x, n.y, n.z, size, Math.random() * 6.283, 1, cell, vx, vy, vz);
  }
  // scorch the top face of voxel (vx, vy, vz)
  char(vx, vy, vz, alpha, cell) {
    const k = this.NH + this.ci; this.ci = (this.ci + 1) % this.NC;
    this._put(k, (vx + 0.5) * VS, (vy + 1) * VS, (vz + 0.5) * VS, 0, 1, 0, VS * 1.01, ((Math.random() * 4) | 0) * 1.5708, alpha, cell, vx, vy, vz);
  }
  _check(k) { const k3 = k * 3; if (this.par[k * 4] > 0 && !this.w.get(this.vox[k3], this.vox[k3 + 1], this.vox[k3 + 2])) { this.par[k * 4] = 0; this.dirty = true; } }
  sweep() { for (let k = 0; k < this.n; k++) this._check(k); }
  roll(count) { for (let j = 0; j < count; j++) { this._check(this.ri); this.ri = (this.ri + 1) % this.n; } }
  flush() { if (this.dirty) { this.dirty = false; this.aP.needsUpdate = this.aN.needsUpdate = this.aR.needsUpdate = true; } }
}

// ------------------------------------------------------------------ light-beam cards
// One camera-facing tapered quad per beam (searchlights, lamp shafts, objective columns): a single layer of
// faint additive fill, far cheaper than a cone.
const BVERT = `
attribute vec4 iO; attribute vec4 iD; attribute vec4 iR; attribute vec4 iC;
uniform float time; uniform float fogK;
varying vec2 vUv; varying vec3 vC; varying float vPh;
void main() {
  float t = position.y + 0.5;
  vec3 dir = iD.xyz;
  if (iR.z > 0.0) { float a = time * iR.w + iO.w; dir = normalize(dir + iR.z * vec3(sin(a), 0.0, cos(a * 0.73 + iO.w * 2.0))); }
  vec3 P = iO.xyz + dir * (t * iD.w);
  vec3 toCam = cameraPosition - P;
  vec3 side = cross(dir, toCam); float sl = length(side); side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  P += side * (position.x * 2.0 * mix(iR.x, iR.y, t));
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  float dist = length(toCam);
  float nf = iC.w > 0.0 ? smoothstep(iC.w * 0.35, iC.w, dist) : 1.0;
  vUv = vec2(position.x + 0.5, t); vPh = iO.w;
  vC = iC.rgb * (nf * exp(-fogK * dist * dist));
}`;
const BFRAG = `
uniform float time; uniform float fall;
varying vec2 vUv; varying vec3 vC; varying float vPh;
void main() {
  float e = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = e * e * (3.0 - 2.0 * e) * smoothstep(0.0, 0.05, vUv.y) * pow(1.0 - vUv.y, fall);
#ifdef RAIN
  a *= 0.7 + 0.3 * sin(vUv.x * 41.0 + vPh * 9.0 + 1.6 * sin(vUv.y * 9.0 - time * 8.0 + vUv.x * 13.0));
#endif
  gl_FragColor = vec4(vC * a, 1.0);
}`;
export class Beams {
  // opt: rain (streaky modulation), fall (falloff exponent along the beam), fog (0..1 share of scene fog), order
  constructor(scene, n, opt = {}) {
    this.n = n;
    this.o = new Float32Array(n * 4); this.d = new Float32Array(n * 4); this.r = new Float32Array(n * 4); this.c = new Float32Array(n * 4);
    const g = this.g = quadGeo(n);
    this.aO = inst(g, 'iO', this.o, 4); this.aD = inst(g, 'iD', this.d, 4); this.aR = inst(g, 'iR', this.r, 4); this.aC = inst(g, 'iC', this.c, 4);
    this.m = new THREE.ShaderMaterial({ defines: opt.rain ? { RAIN: 1 } : {}, uniforms: { time: { value: 0 }, fall: { value: opt.fall || 1 }, fogK: { value: 0.022 * 0.022 * (opt.fog ?? 0.5) } },
      vertexShader: BVERT, fragmentShader: BFRAG, transparent: true, blending: ADD, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, this.m); this.mesh.frustumCulled = false; this.mesh.renderOrder = opt.order || 3; scene.add(this.mesh);
  }
  set(i, ox, oy, oz, dx, dy, dz, len, r0, r1, r, g, b, near = 0, sweepAmp = 0, sweepSpeed = 0, phase = 0) {
    const k = i * 4, o = this.o, d = this.d, R = this.r, c = this.c;
    o[k] = ox; o[k + 1] = oy; o[k + 2] = oz; o[k + 3] = phase; d[k] = dx; d[k + 1] = dy; d[k + 2] = dz; d[k + 3] = len;
    R[k] = r0; R[k + 1] = r1; R[k + 2] = sweepAmp; R[k + 3] = sweepSpeed; c[k] = r; c[k + 1] = g; c[k + 2] = b; c[k + 3] = near;
    this.aO.needsUpdate = this.aD.needsUpdate = this.aR.needsUpdate = this.aC.needsUpdate = true;
  }
  setColor(i, r, g, b) { const k = i * 4, c = this.c; if (c[k] !== r || c[k + 1] !== g || c[k + 2] !== b) { c[k] = r; c[k + 1] = g; c[k + 2] = b; this.aC.needsUpdate = true; } }
  setOrigin(i, x, y, z) { const k = i * 4, o = this.o; if (o[k] !== x || o[k + 1] !== y || o[k + 2] !== z) { o[k] = x; o[k + 1] = y; o[k + 2] = z; this.aO.needsUpdate = true; } }
  setDir(i, x, y, z, len) { const k = i * 4, d = this.d; d[k] = x; d[k + 1] = y; d[k + 2] = z; d[k + 3] = len; this.aD.needsUpdate = true; }
  hide(i) { this.setColor(i, 0, 0, 0); if (this.d[i * 4 + 3] !== 0) { this.d[i * 4 + 3] = 0; this.aD.needsUpdate = true; } }
  setCount(n) { this.g.instanceCount = Math.min(this.n, n); this.mesh.visible = n > 0; }
  update(time) { this.m.uniforms.time.value = time; }
}

// ------------------------------------------------------------------ tracers
const TVERT = `
attribute vec4 iA; attribute vec3 iB; attribute vec4 iC;
uniform float px;
varying vec4 vC; varying float vX;
void main() {
  float t = position.y + 0.5;
  vec3 P = mix(iA.xyz, iB, t);
  vec3 toCam = cameraPosition - P;
  vec3 side = cross(iB - iA.xyz, toCam); float sl = length(side); side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  float w = max(iA.w * (0.4 + 0.6 * t), px * length(toCam)) * step(0.00001, iA.w);
  P += side * (position.x * w);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
  vC = vec4(iC.rgb, iC.a * (0.25 + 0.75 * t)); vX = position.x * 2.0;
}`;
const TFRAG = `
varying vec4 vC; varying float vX;
void main() { float e = min(1.0, (1.0 - abs(vX)) * 2.5); gl_FragColor = vec4(vC.rgb * (e * vC.a), 1.0); }`;

// material classes for bullet impacts
const KIND = new Uint8Array(64);   // 0 stone, 1 metal, 2 wood, 3 glass, 4 water, 5 soft, 6 leaf, 7 lamp
for (const m of [MAT.METAL, MAT.RUST, MAT.BARREL, MAT.CAR_A, MAT.CAR_B, MAT.CAR_C, MAT.PANEL, MAT.OLIVE]) KIND[m] = 1;
KIND[MAT.WOOD] = 2; KIND[MAT.GLASS] = 3; KIND[MAT.WATER] = 4; KIND[MAT.LEAF] = 6;
for (const m of [MAT.DIRT, MAT.GRASS, MAT.SAND, MAT.TIRE]) KIND[m] = 5;
for (let m = 20; m <= 24; m++) KIND[m] = 7;
const GREY = new THREE.Color(0.6, 0.6, 0.6);
const E_FIRE = 1, E_SMOKE = 2, E_DUST = 3;

export class FX {
  // opt: { camera, low }
  constructor(scene, world, opt = {}) {
    this.scene = scene; this.w = world; this.camera = opt.camera || null; this.q = opt.low ? 0.5 : 1; this.t = 0; this.tick = 0; this.h = 720;
    this.wind = new THREE.Vector3(2.5, 0, 0.8);
    this.sparks = new Particles(scene, 700, 0.07, ADD, dotTex(false), 1, { streak: true, world, order: 6 });
    this.smoke = new Particles(scene, 420, 1.6, THREE.NormalBlending, puffTex(7), 0.62, { rot: true, nearFade: true, order: 5 });
    this.glow = new Particles(scene, 420, 1.3, ADD, puffTex(3, 12), 1, { rot: true, nearFade: true, order: 6 });
    this.rings = new Rings(scene, 48, 3);
    this.decals = new Decals(scene, world, opt.low ? 96 : 192, opt.low ? 480 : 960);
    this.sweepDecals = false;
    // debris
    this.DN = 700;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.debMat = new THREE.MeshLambertMaterial();
    this.deb = new THREE.InstancedMesh(geo, this.debMat, this.DN);
    this.deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.deb.frustumCulled = false;
    this.dP = new Float32Array(this.DN * 3); this.dV = new Float32Array(this.DN * 3); this.dR = new Float32Array(this.DN * 3);
    this.dW = new Float32Array(this.DN * 3); this.dL = new Float32Array(this.DN); this.dS = new Float32Array(this.DN); this.dA = new Float32Array(this.DN).fill(1); this.di = 0;
    this.col = new THREE.Color(0, 0, 0);
    for (let i = 0; i < this.DN; i++) { this.deb.setColorAt(i, this.col); }
    this.m4 = new THREE.Matrix4(); this.q4 = new THREE.Quaternion(); this.e = new THREE.Euler(); this.sv = new THREE.Vector3(); this.pv = new THREE.Vector3();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.DN; i++) this.deb.setMatrixAt(i, this.zero);
    scene.add(this.deb);
    // tracers: instanced ribbons, tapered and faded from head to tail
    this.TN = 128; this.tA = new Float32Array(this.TN * 4); this.tB = new Float32Array(this.TN * 3); this.tC = new Float32Array(this.TN * 4);
    this.tL = new Float32Array(this.TN); this.tM = new Float32Array(this.TN); this.tI = new Float32Array(this.TN); this.ti = 0; this.tBusy = 0.3;
    const tg = quadGeo(this.TN);
    this.aTA = inst(tg, 'iA', this.tA, 4); this.aTB = inst(tg, 'iB', this.tB, 3); this.aTC = inst(tg, 'iC', this.tC, 4);
    this.tMat = new THREE.ShaderMaterial({ uniforms: { px: { value: 0.0028 } }, vertexShader: TVERT, fragmentShader: TFRAG, transparent: true, blending: ADD, depthWrite: false, side: THREE.DoubleSide });
    this.tracers = new THREE.Mesh(tg, this.tMat); this.tracers.frustumCulled = false; this.tracers.renderOrder = 6; scene.add(this.tracers);
    // flash lights (light Lambert entities: bots, viewmodel, debris)
    this.flash = new THREE.PointLight(0xffc77a, 0, 14, 1.6); scene.add(this.flash); this.flashT = 0;
    this.boom = new THREE.PointLight(0xff9a4a, 0, 30, 1.4); scene.add(this.boom); this.boomT = 0; this.boomD = 0.4; this.boomK = 0;
    // the same two lights also reach the baked voxel world: slot 0 = muzzle flash, slot 1 = explosion / fire.
    // Flat normals come from screen-space derivatives so a flash never shows through to the far side of a wall.
    this.wlP = [new THREE.Vector4(0, -99, 0, 1), new THREE.Vector4(0, -99, 0, 1)]; this.wlC = [new THREE.Vector3(), new THREE.Vector3()]; this.wlOn = { value: 0 };
    const wlP = this.wlP, wlC = this.wlC, wlOn = this.wlOn;
    if (world.mat) {
      world.mat.onBeforeCompile = (sh) => {
        sh.uniforms.wlP = { value: wlP }; sh.uniforms.wlC = { value: wlC }; sh.uniforms.wlOn = wlOn;
        sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = 'varying vec3 vWP; uniform vec4 wlP[2]; uniform vec3 wlC[2]; uniform float wlOn;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  if (wlOn > 0.0) {
    vec3 wN = normalize(cross(dFdx(vWP), dFdy(vWP)));
    for (int i = 0; i < 2; i++) {
      vec3 dv = wlP[i].xyz - vWP; float d2 = dot(dv, dv);
      float at = max(0.0, 1.0 - d2 * wlP[i].w);
      float nl = clamp(dot(wN, dv) * inversesqrt(d2 + 0.01) * 0.9 + 0.1, 0.0, 1.0);
      diffuseColor.rgb += (diffuseColor.rgb * 1.5 + 0.045) * wlC[i] * (at * at * nl);
    }
  }`);
      };
      world.mat.needsUpdate = true;
    }
    // timed emitters: lingering fires, smoke columns, delayed dust clouds
    this.em = []; for (let i = 0; i < 16; i++) this.em.push({ type: 0, x: 0, y: 0, z: 0, t: 0, dur: 0, acc: 0, acc2: 0, size: 1, delay: 0 });
    this.lastBoomT = -1; this.lastBoomP = new THREE.Vector3(); this.lastQT = -9; this.lastQP = new THREE.Vector3(); this.lastQM = false;
    this.tv = new THREE.Vector3(); this.cp = new THREE.Vector3(0, -999, 0);
  }

  // ---- tracers. col: team index (0 KAPPA, 1 OMEGA) or an rgb array. The two legacy arrays map to the team colours.
  tracer(a, b, col = 0) {
    let r = 0.55, g = 0.92, bl = 1.0;                                                     // KAPPA: cyan-white
    if (col === 1 || (col && col.length && col[1] < 0.7 && col[0] > 0.9 && col[2] < 0.4)) { r = 1.0; g = 0.52; bl = 0.17; }   // OMEGA: orange
    else if (col && col.length && !(col[0] === 1 && col[1] === 0.85)) { r = col[0]; g = col[1]; bl = col[2]; }
    this._trace(a, b, r, g, bl, 0.034, 0.055, 0.95);
  }
  _trace(a, b, r, g, bl, width, life, intensity) {
    const k = this.ti, k4 = k * 4, k3 = k * 3; this.ti = (k + 1) % this.TN;
    this.tA[k4] = a.x; this.tA[k4 + 1] = a.y; this.tA[k4 + 2] = a.z; this.tA[k4 + 3] = width;
    this.tB[k3] = b.x; this.tB[k3 + 1] = b.y; this.tB[k3 + 2] = b.z;
    this.tC[k4] = r; this.tC[k4 + 1] = g; this.tC[k4 + 2] = bl; this.tC[k4 + 3] = intensity;
    this.tL[k] = this.tM[k] = life; this.tI[k] = intensity;
    if (life > this.tBusy) this.tBusy = life; this.tracers.visible = true;
  }
  _light(slot, p, r, g, b, radius) { this.wlP[slot].set(p.x, p.y, p.z, 1 / (radius * radius)); this.wlC[slot].set(r, g, b); }
  muzzle(p) {
    // with several shooters in one frame the flash nearest to the camera keeps the light
    if (this.flashT > 0.045 && this.flash.position.distanceToSquared(this.cp) < p.distanceToSquared(this.cp)) return;
    this.flash.position.copy(p); this.flash.intensity = 7; this.flashT = 0.05;
    this._light(0, p, 1.5, 1.05, 0.55, 6.5);
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, 1, 0.75, 0.4, 0.05, 0, 0, 0.8, 0.9);
  }
  // bullet impact: the effect is chosen from the material that was hit
  impact(p, n, mat) {
    const def = MATDEF[mat], c = def ? def.debris : GREY, kind = KIND[mat] | 0, q = this.q, R = Math.random;
    const S = this.sparks, M = this.smoke, D = this.decals;
    const x = p.x + n.x * 0.05, y = p.y + n.y * 0.05, z = p.z + n.z * 0.05;
    let k;
    switch (kind) {
      case 1: { // metal: ricochet sparks that bounce, a tiny flash, a dent
        const N = 4 + ((R() * 6 * q) | 0);
        for (let i = 0; i < N; i++) { const s = 3 + R() * 6; k = S.emit(x, y, z, n.x * s + (R() - 0.5) * 6, n.y * s + (R() - 0.2) * 5, n.z * s + (R() - 0.5) * 6, 1.9, 1.5, 0.75, 0.2 + R() * 0.35, 13, 0.8, 0.8, 0.4); S.bnc[k] = 1; S.fade(k, 1.6, 0.5, 0.1); }
        this.glow.emit(x, y, z, 0, 0, 0, 1, 0.8, 0.5, 0.06, 0, 0, 0.3, 0.45);
        k = M.emit(x, y, z, n.x * 0.5, 0.3, n.z * 0.5, 0.2, 0.21, 0.23, 0.45, -0.2, 2, 0.1, 0.3); M.al[k] = 0.5;
        D.hole(p, n, 1, 0.15 + R() * 0.05); break; }
      case 2: { // wood: splinters and pale dust
        for (let i = 0; i < 3; i++) this._chip(x, y, z, n, mat, 0.2 + R() * 0.16, 0.22, 3.2);
        k = M.emit(x, y, z, n.x * 0.8, 0.4, n.z * 0.8, 0.3, 0.25, 0.18, 0.7, -0.2, 2, 0.12, 0.42); M.al[k] = 0.6;
        D.hole(p, n, 2, 0.2 + R() * 0.05); break; }
      case 3: { // glass: glittering shards and a crack
        const N = 5 + ((R() * 4 * q) | 0);
        for (let i = 0; i < N; i++) S.emit(x, y, z, n.x * 2.5 + (R() - 0.5) * 4, n.y * 2.5 + R() * 2.5, n.z * 2.5 + (R() - 0.5) * 4, 0.75, 1.25, 1.45, 0.3 + R() * 0.4, 10, 0.5, 0.75, 0.3);
        D.hole(p, n, 3, 0.34 + R() * 0.08); break; }
      case 4: { // water: droplets and a ripple
        const N = 4 + ((R() * 4 * q) | 0);
        for (let i = 0; i < N; i++) S.emit(x, y, z, (R() - 0.5) * 1.6, 2 + R() * 2.6, (R() - 0.5) * 1.6, 0.42, 0.55, 0.7, 0.3 + R() * 0.2, 12, 0, 0.7, 0.4);
        this.rings.emit(p.x, p.y + 0.02, p.z, 0.05, 0.55 + R() * 0.3, 0.6, 0.45, 0.58, 0.74, 0.5, 0.3);
        break; }
      case 5: { // dirt, grass, sand, rubber: a dull puff and clods
        for (let i = 0; i < 2; i++) this._chip(x, y, z, n, mat, 0.1 + R() * 0.08, 1, 3);
        k = M.emit(x, y, z, n.x * 0.8 + (R() - 0.5) * 0.4, 0.5 + n.y, n.z * 0.8 + (R() - 0.5) * 0.4, c.r * 0.5 + 0.06, c.g * 0.5 + 0.06, c.b * 0.5 + 0.06, 0.8, -0.1, 2, 0.14, 0.55); M.al[k] = 0.7;
        D.hole(p, n, 4, 0.2 + R() * 0.06); break; }
      case 6: // leaves
        for (let i = 0; i < 3; i++) this._chip(x, y, z, n, mat, 0.09 + R() * 0.06, 1, 1.6);
        break;
      case 7: { // lamps: electric sparks in the lamp colour
        const e = def ? def.color : GREY;
        for (let i = 0; i < 8; i++) { k = S.emit(x, y, z, n.x * 3 + (R() - 0.5) * 6, n.y * 3 + R() * 3, n.z * 3 + (R() - 0.5) * 6, e.r * 1.7, e.g * 1.7, e.b * 1.7, 0.25 + R() * 0.3, 12, 0.6, 0.8, 0.3); S.bnc[k] = 1; }
        this.glow.emit(x, y, z, 0, 0, 0, e.r, e.g, e.b, 0.07, 0, 0, 0.35, 0.5); break; }
      default: { // concrete, brick, asphalt...: dust in the material colour, chips, the odd spark
        for (let i = 0; i < 2; i++) this._chip(x, y, z, n, mat, 0.1 + R() * 0.1, 1, 3.5);
        const g = 0.5 + R() * 0.2;
        k = M.emit(x, y, z, n.x * 1.1 + (R() - 0.5) * 0.5, 0.35 + n.y * 0.6, n.z * 1.1 + (R() - 0.5) * 0.5, c.r * g + 0.08, c.g * g + 0.08, c.b * g + 0.09, 0.75 + R() * 0.35, -0.25, 1.8, 0.12, 0.5 + R() * 0.15); M.al[k] = 0.7;
        if (R() < 0.35) for (let i = 0; i < 2; i++) S.emit(x, y, z, n.x * 4 + (R() - 0.5) * 5, n.y * 4 + R() * 3, n.z * 4 + (R() - 0.5) * 5, 1.7, 1.1, 0.45, 0.15 + R() * 0.2, 12, 1, 0.7, 0.3);
        D.hole(p, n, 0, 0.19 + R() * 0.08); }
    }
  }
  // small tumbling fragment (aspect < 1 makes a splinter)
  _chip(x, y, z, n, mat, size, aspect, speed) {
    const R = Math.random, k = this.di;
    this.debris(x, y, z, n.x * speed + (R() - 0.5) * 2.4, n.y * speed + 1 + R() * 2, n.z * speed + (R() - 0.5) * 2.4, mat, size, 0);
    this.dL[k] = 0.5 + R() * 0.4; this.dA[k] = aspect;
  }
  blood(p, d) {
    const R = Math.random, M = this.smoke;
    for (let i = 0; i < 6; i++) { const k = M.emit(p.x, p.y, p.z, d.x * 2 + (R() - 0.5) * 3, R() * 2.2, d.z * 2 + (R() - 0.5) * 3, 0.42, 0.02, 0.03, 0.4 + R() * 0.2, 10, 1, 0.05, 0.035); M.al[k] = 1.5; }
    const k = M.emit(p.x, p.y, p.z, d.x * 0.8, 0.2, d.z * 0.8, 0.36, 0.02, 0.03, 0.3, 0, 2, 0.14, 0.34); M.al[k] = 0.7;
  }
  // quantum effect (cyan / magenta): spark burst, expanding ripple rings, and an afterimage streak that links
  // two bursts fired close together in time (tunnel entry -> exit, collapse onto the echo)
  quantum(p, n = 30, col = [0.3, 1, 1]) {
    const R = Math.random, S = this.sparks, mag = col[0] > 0.7, cam = this.camera;
    n = Math.round(n * (0.6 + 0.4 * this.q));
    for (let i = 0; i < n; i++) {
      const a = R() * 6.283, b = R() * Math.PI - Math.PI / 2, s = 1.5 + R() * 4.5;
      const k = S.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s, Math.sin(a) * Math.cos(b) * s, col[0], col[1], col[2], 0.45 + R() * 0.35, 0, 2.6, 0.9, 0.3);
      if (i % 3 === 0) S.fade(k, mag ? 0.3 : 1, mag ? 1 : 0.4, 1);                         // a few motes shift to the sister colour
    }
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, col[0], col[1], col[2], 0.3, 0, 0, 0.6, 1.5);
    // ripple: when the burst sits on the camera (first person) the ring opens just ahead of the eye
    let rx = p.x, ry = p.y, rz = p.z, r1 = 2.2;
    if (cam && cam.position.distanceToSquared(p) < 0.6) { cam.getWorldDirection(this.tv); rx += this.tv.x * 1.7; ry += this.tv.y * 1.7; rz += this.tv.z * 1.7; r1 = 2.6; }
    this.rings.emit(rx, ry, rz, 0.15, r1, 0.5, col[0], col[1], col[2], 0.75, 0.16, true);
    this.rings.emit(rx, ry, rz, 0.1, r1 * 0.7, 0.55, mag ? 0.3 : 1, mag ? 1 : 0.4, 1, 0.5, 0.1, true, 0.09);
    const dt = this.t - this.lastQT, dd = p.distanceTo(this.lastQP);
    if (dt < 1.5 && this.lastQM === mag && dd > 1.2 && dd < 30) {
      this._trace(this.lastQP, p, col[0], col[1], col[2], 0.55, 0.5, 0.3);
      this._trace(this.lastQP, p, 1, 1, 1, 0.09, 0.32, 0.5);
      const N = Math.min(26, (dd * 2.2) | 0);
      for (let i = 0; i < N; i++) { const f = R(); S.emit(this.lastQP.x + (p.x - this.lastQP.x) * f + (R() - 0.5) * 0.5, this.lastQP.y + (p.y - this.lastQP.y) * f + (R() - 0.5) * 0.9, this.lastQP.z + (p.z - this.lastQP.z) * f + (R() - 0.5) * 0.5, (R() - 0.5), (R() - 0.5), (R() - 0.5), col[0], col[1], col[2], 0.35 + R() * 0.5, 0, 1, 0.8, 0.2); }
    }
    this.lastQT = this.t; this.lastQP.copy(p); this.lastQM = mag;
  }
  // faint shimmer around a superposed body (called every frame by the environment while the echo lives)
  shimmer(p, dt) {
    const R = Math.random;
    if (R() < dt * 16) { const a = R() * 6.283, m = R() < 0.3; this.sparks.emit(p.x + Math.cos(a) * 0.45, p.y - 1 + R() * 1.7, p.z + Math.sin(a) * 0.45, 0, 0.5 + R() * 0.8, 0, m ? 1 : 0.3, m ? 0.4 : 1, 1, 0.4 + R() * 0.4, 0, 0, 0.6, 0.2); }
    if (R() < dt * 1.3) this.rings.emit(p.x, p.y - 1.15, p.z, 0.2, 0.9, 0.7, 0.3, 1, 1, 0.35, 0.14);
  }
  explosion(p, r) {
    const R = Math.random, q = this.q, G = this.glow, M = this.smoke, S = this.sparks, w = this.w;
    // a second call at the same spot in the same tick is the fuel of a barrel: fireball + lingering fire
    if (this.t - this.lastBoomT < 1e-4 && p.distanceToSquared(this.lastBoomP) < 0.01) {
      for (let i = 0; i < 7; i++) { const a = R() * 6.283, d = R() * r * 0.3; const k = G.emit(p.x + Math.cos(a) * d, p.y + R() * r * 0.4, p.z + Math.sin(a) * d, Math.cos(a) * 1.5, 2 + R() * 3, Math.sin(a) * 1.5, 1, 0.6, 0.2, 0.5 + R() * 0.4, -2.5, 1.5, r * 0.5, r * 0.95); G.fade(k, 0.5, 0.08, 0.02); G.al[k] = 0.7; }
      this.fire(p, 7 + R() * 3, Math.min(1.3, r / 3.4));
      return;
    }
    this.lastBoomT = this.t; this.lastBoomP.copy(p);
    // light: entities (point light) and voxels (injected light)
    this.boom.position.copy(p); this.boom.intensity = 60; this.boomD = 0.45; this.boomT = this.boomD; this.boomK = 4.2;
    this._light(1, p, 4.2, 2.5, 1.1, 5 + r * 3);
    // bright core flash, then the expanding fireball
    G.emit(p.x, p.y, p.z, 0, 0, 0, 1, 0.95, 0.8, 0.11, 0, 0, r * 1.5, r * 2.1);
    const NF = Math.round((7 + r * 1.2) * (0.5 + 0.5 * q));
    for (let i = 0; i < NF; i++) {
      const a = R() * 6.283, e = R() * 1.6 - 0.4, d = R() * r * 0.4, s = 1 + R() * 2.5;
      const k = G.emit(p.x + Math.cos(a) * d, p.y + Math.sin(e) * d * 0.7 + 0.1, p.z + Math.sin(a) * d, Math.cos(a) * s, 1 + R() * 2.2, Math.sin(a) * s, 1, 0.62, 0.22, 0.34 + R() * 0.36, -1.5, 2.5, r * 0.42, r * (0.8 + R() * 0.35));
      G.fade(k, 0.45, 0.07, 0.02); G.al[k] = 0.62;
    }
    // smoke born lit by the fire, cooling to dark grey
    const NS = Math.round((9 + r * 1.5) * q);
    for (let i = 0; i < NS; i++) {
      const a = R() * 6.283, d = R() * r * 0.5, s = 1.2 + R() * 3, g = 0.055 + R() * 0.04;
      const k = M.emit(p.x + Math.cos(a) * d, p.y + R() * r * 0.45, p.z + Math.sin(a) * d, Math.cos(a) * s, 1 + R() * 2.4, Math.sin(a) * s, 0.5, 0.27, 0.11, 2.2 + R() * 2, -0.45, 1.1, r * 0.3, r * (0.62 + R() * 0.3));
      M.fade(k, g, g, g * 1.1); M.al[k] = 0.95;
    }
    this._em(E_SMOKE, p.x, p.y, p.z, 2.4, Math.min(2.2, r / 3));
    // sparks with gravity and bounce, then slow embers
    const NK = Math.round((26 + r * 7) * q);
    for (let i = 0; i < NK; i++) {
      const a = R() * 6.283, e = R() * 1.9 - 0.5, s = 5 + R() * 15;
      const k = S.emit(p.x, p.y + 0.1, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 2, Math.sin(a) * Math.cos(e) * s, 2, 1.35, 0.5, 0.5 + R() * 0.9, 14, 0.6, 0.95, 0.35);
      S.bnc[k] = 2; S.fade(k, 1.5, 0.35, 0.05);
    }
    const NE = Math.round(12 * q);
    for (let i = 0; i < NE; i++) { const k = S.emit(p.x + (R() - 0.5) * r, p.y + R() * r * 0.5, p.z + (R() - 0.5) * r, (R() - 0.5) * 3, 1 + R() * 3, (R() - 0.5) * 3, 1.3, 0.55, 0.12, 1.5 + R() * 1.6, -0.7, 1.2, 0.7, 0.35); S.fade(k, 0.9, 0.2, 0.02); }
    // shock front: a quick camera-facing ring, and on the ground a ring plus a pool of light
    this.rings.emit(p.x, p.y, p.z, r * 0.3, r * 2.0, 0.24, 1, 0.92, 0.8, 0.3, 0.1, true);
    let gy = -99;
    const fy = Math.floor((p.y + 0.5) / VS);
    for (let i = 0; i < 4; i++) { const hgt = w.groundHeightAt(p.x + (i === 0 ? r : i === 1 ? -r : 0) * 1.3, p.z + (i === 2 ? r : i === 3 ? -r : 0) * 1.3, fy); if (hgt <= p.y + 0.7 && hgt > gy) gy = hgt; }
    if (gy > p.y - 1.8) {
      this.rings.emit(p.x, gy + 0.06, p.z, r * 0.4, r * 2.7, 0.4, 1, 0.82, 0.55, 0.55, 0.2);
      this.rings.emit(p.x, gy + 0.05, p.z, r * 2.2, r * 3.2, 0.34, 1, 0.6, 0.25, 0.5, 1);
    }
    this._scorch(p, r);
  }
  // char the exposed top faces of the voxels around an explosion (dithered towards the rim)
  _scorch(p, r) {
    const w = this.w, D = this.decals, R = Math.random, rad = r * 1.45, Rv = Math.ceil(rad / VS), cx = Math.floor(p.x / VS), cz = Math.floor(p.z / VS);
    const yTop = Math.min(SY - 2, Math.floor((p.y + r * 0.6) / VS)), yBot = Math.max(1, Math.floor((p.y - r * 1.3) / VS));
    const keep = Math.min(1, 300 / (Rv * Rv * 3.14));
    for (let dz = -Rv; dz <= Rv; dz++) for (let dx = -Rv; dx <= Rv; dx++) {
      if (dx * dx + dz * dz > Rv * Rv) continue;
      const x = cx + dx, z = cz + dz; if (x < 1 || z < 1 || x >= SX - 1 || z >= SZ - 1) continue;
      let y = yTop; if (w.get(x, y, z)) continue;                                       // column starts inside a wall
      while (y > yBot && !w.get(x, y - 1, z)) y--;
      if (y <= yBot) continue; y--;
      const m = w.get(x, y, z); if (m === MAT.WATER || m === MAT.LEAF || (m >= 20 && m <= 24)) continue;
      const ex = (x + 0.5) * VS - p.x, ey = (y + 1) * VS - p.y, ez = (z + 0.5) * VS - p.z;
      const a = 1 - Math.sqrt(ex * ex + ey * ey + ez * ez) / rad; if (a <= 0) continue;
      if (R() > keep || R() > a * 2.3) continue;
      D.char(x, y, z, Math.min(0.92, 0.3 + a * 1.15), a > 0.42 ? (R() < 0.5 ? 5 : 6) : 7);
    }
  }
  _em(type, x, y, z, dur, size, delay = 0) {
    let e = null; for (const q of this.em) { if (!q.type) { e = q; break; } if (!e || q.t < e.t) e = q; }
    e.type = type; e.x = x; e.y = y; e.z = z; e.t = dur; e.dur = dur; e.acc = 0; e.acc2 = 0; e.size = size; e.delay = delay;
    return e;
  }
  // lingering fire with flicker and glow (barrels). Purely visual.
  fire(p, dur = 7, size = 1) {
    let n = 0, old = null; for (const q of this.em) if (q.type === E_FIRE) { n++; if (!old || q.t < old.t) old = q; }
    if (n >= 5 && old) old.type = 0;
    const gy = this.w.groundHeightAt(p.x, p.z, Math.max(0, Math.floor((p.y + 0.3) / VS)));
    this._em(E_FIRE, p.x, p.y - gy < 4 ? gy : p.y, p.z, dur, size);
  }
  // rolling dust of a structural collapse: c = centroid of the falling mass, n = number of voxels
  dust(c, n = 80) {
    if (n < 10) return;
    const k = Math.min(1, n / 260), R = Math.random, M = this.smoke;
    const N0 = Math.round((2 + 4 * k) * this.q);
    for (let i = 0; i < N0; i++) { const j = M.emit(c.x + (R() - 0.5) * 2, c.y + (R() - 0.5) * 1.5, c.z + (R() - 0.5) * 2, (R() - 0.5) * 1.5, -0.5 - R(), (R() - 0.5) * 1.5, 0.27, 0.265, 0.26, 1.5 + R(), 0.6, 1, 0.45, 1.2); M.al[j] = 0.6; }
    const gy = this.w.groundHeightAt(c.x, c.z, Math.max(0, Math.floor(c.y / VS)));
    this._em(E_DUST, c.x, gy, c.z, 0.01, 0.5 + k, Math.sqrt(2 * Math.max(0, c.y - gy) / 19) * 0.9);   // blooms when the mass lands
  }
  _emit(e, dt) {
    const R = Math.random, q = this.q, G = this.glow, M = this.smoke, S = this.sparks;
    if (e.delay > 0) { e.delay -= dt; return; }
    e.t -= dt;
    if (e.type === E_FIRE) {
      const s = e.size, k = Math.min(1, e.t / 1.6) * Math.min(1, (e.dur - e.t) * 3 + 0.3);
      e.acc += dt * 24 * s * k * (0.4 + 0.6 * q);
      while (e.acc >= 1) {
        e.acc -= 1; const a = R() * 6.283, d = R() * 0.45 * s;
        const j = G.emit(e.x + Math.cos(a) * d, e.y + 0.1 + R() * 0.25, e.z + Math.sin(a) * d, (R() - 0.5) * 0.5, 1.1 + R() * 1.5, (R() - 0.5) * 0.5, 1, 0.62, 0.2, 0.36 + R() * 0.3, -2.2, 0.6, (0.4 + 0.2 * k) * s, 0.13 * s);
        G.fade(j, 0.6, 0.09, 0.02); G.al[j] = 0.42;
      }
      e.acc2 += dt;
      if (e.acc2 > 0.1) {
        e.acc2 = 0;
        if (R() < 0.3 * q + 0.1) { const g = 0.05 + R() * 0.03, j = M.emit(e.x + (R() - 0.5) * 0.4 * s, e.y + 1.0 * s, e.z + (R() - 0.5) * 0.4 * s, (R() - 0.5) * 0.4, 1.4 + R(), (R() - 0.5) * 0.4, 0.3, 0.15, 0.07, 2.2 + R(), -0.3, 0.6, 0.4 * s, 0.95 * s); M.fade(j, g, g, g * 1.1); M.al[j] = 0.75; }
        if (R() < 0.45) { const j = S.emit(e.x + (R() - 0.5) * 0.6 * s, e.y + 0.4, e.z + (R() - 0.5) * 0.6 * s, (R() - 0.5) * 1.6, 1.5 + R() * 2.5, (R() - 0.5) * 1.6, 1.4, 0.6, 0.12, 0.9 + R() * 1.1, -0.8, 1, 0.65, 0.3); S.fade(j, 0.9, 0.2, 0.02); }
        this.rings.emit(e.x, e.y + 0.05, e.z, 2.6 * s, 2.9 * s, 0.24, 1, 0.5, 0.16, (0.2 + R() * 0.16) * k, 1);   // flickering pool of light
      }
    } else if (e.type === E_SMOKE) {
      e.acc += dt * 5 * (0.4 + 0.6 * q) * Math.min(1, e.t / 1.2 + 0.2);
      while (e.acc >= 1) {
        e.acc -= 1; const s = e.size, g = 0.06 + R() * 0.04;
        const j = M.emit(e.x + (R() - 0.5) * s, e.y + R() * 0.5, e.z + (R() - 0.5) * s, (R() - 0.5) * 0.6, 1.8 + R() * 1.6, (R() - 0.5) * 0.6, g * 1.6, g * 1.2, g, 2.6 + R() * 1.4, -0.35, 0.5, 0.5 * s, 1.25 * s); M.al[j] = 0.85;
      }
    } else if (e.type === E_DUST) {
      const s = e.size, N = Math.round((7 + 13 * (s - 0.5)) * q);
      for (let i = 0; i < N; i++) {
        const a = R() * 6.283, sp = (2.2 + R() * 3.6) * (0.7 + 0.5 * s), d = R() * 1.2 * s, g = 0.23 + R() * 0.07;
        const j = M.emit(e.x + Math.cos(a) * d, e.y + 0.3 + R() * 0.6, e.z + Math.sin(a) * d, Math.cos(a) * sp, 0.3 + R() * 1.1, Math.sin(a) * sp, g * 1.06, g, g * 0.95, 2.6 + R() * 2.2, -0.12, 1.5, 0.5 + 0.3 * s, 1.4 + 1.0 * s);
        M.al[j] = 0.72; M.fade(j, g * 0.8, g * 0.78, g * 0.78);
      }
      e.t = 0;
    }
    if (e.t <= 0) e.type = 0;
  }
  debris(x, y, z, vx, vy, vz, mat, size = 0.6, life = 5) {
    const k = this.di; this.di = (this.di + 1) % this.DN;
    this.dP[k * 3] = x; this.dP[k * 3 + 1] = y; this.dP[k * 3 + 2] = z;
    this.dV[k * 3] = vx; this.dV[k * 3 + 1] = vy; this.dV[k * 3 + 2] = vz;
    this.dW[k * 3] = (Math.random() - 0.5) * 12; this.dW[k * 3 + 1] = (Math.random() - 0.5) * 12; this.dW[k * 3 + 2] = (Math.random() - 0.5) * 12;
    this.dR[k * 3] = this.dR[k * 3 + 1] = this.dR[k * 3 + 2] = 0;
    this.dL[k] = life + Math.random(); this.dS[k] = VS * size; this.dA[k] = 1;
    const def = MATDEF[mat], c = this.col; if (def) c.copy(def.color); else c.setRGB(0.5, 0.5, 0.5);
    if (def && def.emit) c.multiplyScalar(1.5);
    this.deb.setColorAt(k, c); this.deb.instanceColor.needsUpdate = true;
    this.sweepDecals = true;   // debris means voxels broke: release the decals that sat on them
  }
  setScale(h) { this.h = h; this.tMat.uniforms.px.value = 1.62 / Math.max(200, h) * 1.3; }
  // lightning brightens smoke and dust together with the world (set by the environment)
  setFlash(i) { this.smoke.m.uniforms.lit.value = 1 + i * 1.4; }
  update(dt) {
    this.t += dt; this.tick++;
    syncFog(this.scene);
    if (this.camera) this.cp.copy(this.camera.position);
    let fire = null, fd = 1e9;
    for (const e of this.em) { if (!e.type) continue; this._emit(e, dt); if (e.type === E_FIRE && e.delay <= 0) { const d = (e.x - this.cp.x) ** 2 + (e.z - this.cp.z) ** 2; if (d < fd) { fd = d; fire = e; } } }
    this.smoke.ax = this.wind.x * 0.35; this.smoke.az = this.wind.z * 0.35;
    this.sparks.update(dt); this.smoke.update(dt); this.glow.update(dt); this.rings.update(dt);
    if (this.sweepDecals) { this.decals.sweep(); this.sweepDecals = false; } else this.decals.roll(24);
    this.decals.flush();
    // lights
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.intensity = 0; this.wlC[0].set(0, 0, 0); } }
    let lit = this.flashT > 0;
    if (this.boomT > 0) {
      this.boomT -= dt; const k = Math.max(0, this.boomT / this.boomD);
      this.boom.intensity = k * 60; this.wlC[1].set(1, 0.6, 0.26).multiplyScalar(k * k * this.boomK); lit = true;
    } else if (fire) {
      const k = (0.75 + 0.25 * Math.sin(this.t * 23) * Math.sin(this.t * 7.3) + (Math.random() - 0.5) * 0.2) * Math.min(1, fire.t / 1.6);
      this.tv.set(fire.x, fire.y + 0.7, fire.z); this.boom.position.copy(this.tv); this.boom.intensity = 9 * k;
      this._light(1, this.tv, 1.5 * k, 0.75 * k, 0.28 * k, 7.5); lit = true;
    } else if (this.boom.intensity > 0) { this.boom.intensity = 0; this.wlC[1].set(0, 0, 0); }
    this.wlOn.value = lit ? 1 : 0;
    // tracers
    if (this.tBusy > -0.25) {
      this.tBusy -= dt;
      for (let k = 0; k < this.TN; k++) if (this.tL[k] > 0) {
        this.tL[k] -= dt;
        if (this.tL[k] <= 0) { this.tA[k * 4 + 3] = 0; this.tC[k * 4 + 3] = 0; } else { const f = this.tL[k] / this.tM[k]; this.tC[k * 4 + 3] = this.tI[k] * f * Math.sqrt(f); }
      }
      this.aTA.needsUpdate = this.aTB.needsUpdate = this.aTC.needsUpdate = true;
    } else if (this.tracers.visible) this.tracers.visible = false;
    // debris
    const w = this.w;
    for (let k = 0; k < this.DN; k++) {
      if (this.dL[k] <= 0) continue;
      this.dL[k] -= dt;
      if (this.dL[k] <= 0) { this.deb.setMatrixAt(k, this.zero); continue; }
      const i3 = k * 3; const P = this.dP, V = this.dV;
      V[i3 + 1] -= 19 * dt;
      const nx = P[i3] + V[i3] * dt, ny = P[i3 + 1] + V[i3 + 1] * dt, nz = P[i3 + 2] + V[i3 + 2] * dt;
      const vx = Math.floor(nx / VS), vy = Math.floor(ny / VS), vz = Math.floor(nz / VS);
      if (w.get(vx, vy, vz)) {
        // bounce on the axis that entered a solid cell
        if (w.get(Math.floor(P[i3] / VS), vy, Math.floor(P[i3 + 2] / VS))) { V[i3 + 1] *= -0.3; V[i3] *= 0.6; V[i3 + 2] *= 0.6; this.dW[i3] *= 0.5; this.dW[i3 + 2] *= 0.5; }
        else { V[i3] *= -0.3; V[i3 + 2] *= -0.3; }
      } else { P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz; }
      this.dR[i3] += this.dW[i3] * dt; this.dR[i3 + 1] += this.dW[i3 + 1] * dt; this.dR[i3 + 2] += this.dW[i3 + 2] * dt;
      const s = this.dS[k] * Math.min(1, this.dL[k] * 2), a = this.dA[k];
      this.e.set(this.dR[i3], this.dR[i3 + 1], this.dR[i3 + 2]); this.q4.setFromEuler(this.e);
      this.pv.set(P[i3], P[i3 + 1], P[i3 + 2]); this.sv.set(s * a, s * a, s);
      this.m4.compose(this.pv, this.q4, this.sv); this.deb.setMatrixAt(k, this.m4);
    }
    this.deb.instanceMatrix.needsUpdate = true;
  }
}
