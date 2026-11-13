// Cheap "realism" layer for night/rain: light halos around emitters (fake bloom) and wet-ground
// reflections under them. Two draw calls total, rebuilt only when an emitter is destroyed.
import * as THREE from 'three';
import { VS, SX, SY, SZ, MATDEF } from './world.js';

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

export class Glow {
  constructor(scene, world) {
    this.scene = scene; this.w = world;
    this.haloMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: radialTex(false) }, scale: { value: 400 }, fogDensity: { value: 0.022 } },
      vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; varying float vF; uniform float scale; uniform float fogDensity;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv; gl_PointSize = min(300.0, size*scale/max(0.5,-mv.z)); vC = color; float d=-mv.z; vF = exp(-fogDensity*fogDensity*d*d*0.5); }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vF; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC * t.a * vF, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.reflMat = new THREE.MeshBasicMaterial({ map: radialTex(true), vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: true, polygonOffset: true, polygonOffsetFactor: -2 });
    this.rebuild();
  }
  setScale(h) { this.haloMat.uniforms.scale.value = h / 2; }
  rebuild() {
    if (this.pts) { this.scene.remove(this.pts); this.pts.geometry.dispose(); }
    if (this.refl) { this.scene.remove(this.refl); this.refl.geometry.dispose(); }
    const w = this.w; const seen = new Map();
    // cluster emitters on a 2-voxel grid
    for (let y = 1; y < SY; y++) for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const m = w.v[(y * SZ + z) * SX + x]; if (m < 20 || m > 24) continue;
      const k = ((y >> 1) * 4096 + (z >> 1)) * 4096 + (x >> 1);
      const e = seen.get(k); if (e) { e.n++; e.x += x; e.y += y; e.z += z; } else seen.set(k, { n: 1, x, y, z, m });
    }
    const hp = [], hc = [], hs = [], rp = [], rc = [], ru = [], ri = [];
    for (const e of seen.values()) {
      const cx = (e.x / e.n + 0.5) * VS, cy = (e.y / e.n + 0.5) * VS, cz = (e.z / e.n + 0.5) * VS;
      const col = MATDEF[e.m].color;
      hp.push(cx, cy, cz); hc.push(col.r * 0.55, col.g * 0.55, col.b * 0.55); hs.push(0.9 + Math.min(1.6, e.n * 0.25));
      // reflection on the first floor below (wet asphalt/concrete) within 7 m
      const vx = Math.floor(cx / VS), vz = Math.floor(cz / VS);
      let fy = -1; for (let y = Math.floor(cy / VS) - 1; y >= 0 && y > cy / VS - 14; y--) { if (w.get(vx, y, vz)) { fy = y; break; } }
      if (fy < 0) continue;
      const h = cy - (fy + 1) * VS; const R = 0.9 + h * 0.35, I = Math.max(0, 0.5 - h * 0.035) * (0.6 + Math.min(1, e.n * 0.3));
      const py = (fy + 1) * VS + 0.015, b = rp.length / 3;
      rp.push(cx - R, py, cz - R * 1.6, cx + R, py, cz - R * 1.6, cx + R, py, cz + R * 1.6, cx - R, py, cz + R * 1.6);
      for (let k = 0; k < 4; k++) rc.push(col.r * I, col.g * I, col.b * I);
      ru.push(0, 0, 1, 0, 1, 1, 0, 1); ri.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3)); g.setAttribute('size', new THREE.Float32BufferAttribute(hs, 1));
    this.pts = new THREE.Points(g, this.haloMat); this.pts.frustumCulled = false; this.scene.add(this.pts);
    const r = new THREE.BufferGeometry();
    r.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); r.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3)); r.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2)); r.setIndex(ri);
    this.refl = new THREE.Mesh(r, this.reflMat); this.refl.frustumCulled = false; this.scene.add(this.refl);
    this.count = seen.size;
  }
}
