// Cheap "realism" layer for night/rain: light halos around emitters (fake bloom, some of them flickering like
// tired neon), wet-ground reflections under them and soft light shafts below street lamps.
// Three draw calls total, rebuilt only when an emitter is destroyed.
import * as THREE from 'three';
import { VS, SX, SY, SZ, MAT, MATDEF } from './world.js';
import { Beams } from './fx.js';

function radialTex(stretch) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  if (stretch) { // streaky reflection: vertical smear like light on wet asphalt
    const g2 = x.createLinearGradient(0, 0, 0, 64); g2.addColorStop(0, 'rgba(0,0,0,0.6)'); g2.addColorStop(0.5, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,0.6)');
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = g2; x.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}
const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

export class Glow {
  // opt: { low }
  constructor(scene, world, opt = {}) {
    this.scene = scene; this.w = world; this.t = 0; this.maxShafts = opt.low ? 28 : 72;
    this.haloMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: radialTex(false) }, scale: { value: 400 }, fogDensity: { value: 0.022 }, time: { value: 0 } },
      vertexShader: `attribute vec3 color; attribute float size; attribute float flick; varying vec3 vC; varying float vF; uniform float scale; uniform float fogDensity; uniform float time;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = min(300.0, size*scale/max(0.5,-mv.z)); float d=-mv.z; vF = exp(-fogDensity*fogDensity*d*d*0.5);
          float f = 1.0;
          if (flick > 0.0) { // buzzing tube: steady hum, then bursts of random on/off stutter
            float t = time + flick * 37.0;
            float burst = step(0.6, fract(t * 0.13 + flick));
            float st = step(0.4, fract(sin(floor(t * 17.0) * 12.9898 + flick * 78.233) * 43758.5453));
            f = mix(0.92 + 0.08 * sin(t * 50.0), st * 0.85 + 0.15, burst);
          }
          vC = color * f; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vF; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a * vF, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.reflMat = new THREE.MeshBasicMaterial({ map: radialTex(true), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true, polygonOffset: true, polygonOffsetFactor: -2 });
    this.shafts = new Beams(scene, this.maxShafts, { rain: true, fog: 0.7, order: 3 });
    this.rebuild();
  }
  setScale(h) { this.haloMat.uniforms.scale.value = h / 2; }
  update(dt) { this.t += dt; this.haloMat.uniforms.time.value = this.t; this.shafts.update(this.t); }
  rebuild() {
    if (this.pts) { this.scene.remove(this.pts); this.pts.geometry.dispose(); }
    if (this.refl) { this.scene.remove(this.refl); this.refl.geometry.dispose(); }
    const w = this.w; const seen = new Map();
    // cluster emitters on a 2-voxel grid
    for (let y = 1; y < SY; y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const m = w.v[(y * SZ + z) * SX + x]; if (m < 20 || m > 24) continue;
      const k = ((y >> 1) * 4096 + (z >> 1)) * 4096 + (x >> 1);
      const e = seen.get(k); if (e) { e.n++; e.x += x; e.y += y; e.z += z; } else seen.set(k, { n: 1, x, y, z, m, vx: x, vy: y, vz: z });
    }
    const hp = [], hc = [], hs = [], hf = [], rp = [], rc = [], ru = [], ri = [];
    const sh = this.shafts, shPos = []; let ns = 0;
    for (const e of seen.values()) {
      const cx = (e.x / e.n + 0.5) * VS, cy = (e.y / e.n + 0.5) * VS, cz = (e.z / e.n + 0.5) * VS;
      const col = MATDEF[e.m].color;
      hp.push(cx, cy, cz); hc.push(col.r * 0.55, col.g * 0.55, col.b * 0.55); hs.push(0.9 + Math.min(1.6, e.n * 0.25));
      // one neon group in seven (hashed on a coarse grid so a whole sign stutters together) and the odd street lamp flicker
      const h = hash3(e.vx >> 3, e.vy >> 3, e.vz >> 3), neon = e.m !== MAT.LAMP_W && e.m !== MAT.LAMP_R;
      hf.push((neon ? h % 7 === 0 : h % 13 === 0) ? 0.1 + (h % 89) / 100 : 0);
      // reflection on the first floor below (wet asphalt/concrete) within 7 m
      const vx = Math.floor(cx / VS), vz = Math.floor(cz / VS);
      let fy = -1; for (let y = Math.floor(cy / VS) - 1; y >= 0 && y > cy / VS - 14; y--) { if (w.get(vx, y, vz)) { fy = y; break; } }
      // light shaft: warm / white lamps hanging over at least 3 m of open air (street lamps, canopies, hangar lights)
      if (ns < this.maxShafts && (e.m === MAT.LAMP_O || e.m === MAT.LAMP_W) && e.n <= 4) {
        let best = 0;
        for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          let y = e.vy - 1, air = 0; while (y > 0 && !w.get(e.vx + ox, y, e.vz + oz) && air < 20) { y--; air++; }
          if (air >= 6 && air < 20 && air > best) best = air;
        }
        let dup = false; for (let i = 0; i < shPos.length; i += 3) if (Math.abs(shPos[i] - cx) < 1.3 && Math.abs(shPos[i + 2] - cz) < 1.3 && Math.abs(shPos[i + 1] - cy) < 1) { dup = true; break; }
        if (best && !dup) {
          const len = best * VS, I = 0.17;
          sh.set(ns++, cx, cy - VS * 0.4, cz, 0, -1, 0, len, 0.22, 0.45 + len * 0.3, col.r * I, col.g * I, col.b * I, 2.5, 0, 0, (h % 100) / 100);
          shPos.push(cx, cy, cz);
        }
      }
      if (fy < 0) continue;
      const hgt = cy - (fy + 1) * VS; const R = 0.9 + hgt * 0.35, I = Math.max(0, 0.5 - hgt * 0.035) * (0.6 + Math.min(1, e.n * 0.3));
      const py = (fy + 1) * VS + 0.015, b = rp.length / 3;
      rp.push(cx - R, py, cz - R * 1.6, cx + R, py, cz - R * 1.6, cx + R, py, cz + R * 1.6, cx - R, py, cz + R * 1.6);
      for (let k = 0; k < 4; k++) rc.push(col.r * I, col.g * I, col.b * I);
      ru.push(0, 0, 1, 0, 1, 1, 0, 1); ri.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    sh.setCount(ns); this.shaftCount = ns;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3)); g.setAttribute('size', new THREE.Float32BufferAttribute(hs, 1));
    g.setAttribute('flick', new THREE.Float32BufferAttribute(hf, 1));
    this.pts = new THREE.Points(g, this.haloMat); this.pts.frustumCulled = false; this.pts.renderOrder = 4; this.scene.add(this.pts);
    const r = new THREE.BufferGeometry();
    r.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); r.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3)); r.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2)); r.setIndex(ri);
    this.refl = new THREE.Mesh(r, this.reflMat); this.refl.frustumCulled = false; this.refl.renderOrder = 2; this.scene.add(this.refl);
    this.count = seen.size;
  }
}
