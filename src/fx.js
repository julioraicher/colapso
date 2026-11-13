// Particle systems, all pooled and fixed-size (zero GC churn, constant draw calls):
// debris (InstancedMesh cubes w/ voxel collision), sparks (additive points), smoke (alpha points),
// tracers (line segments), muzzle flash light.
import * as THREE from 'three';
import { VS, MATDEF } from './world.js';

function circleTex(soft) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(soft ? 0.4 : 0.25, 'rgba(255,255,255,' + (soft ? 0.6 : 0.9) + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}

class PointPool {
  constructor(scene, n, size, blending, tex, opacity = 1) {
    this.n = n; this.i = 0;
    this.p = new Float32Array(n * 3); this.c = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n); this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    this.g = g;
    this.a = new Float32Array(n);
    g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    // custom point shader: per-particle alpha (smoke fades out instead of turning black) + perspective size
    this.m = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, size: { value: size }, scale: { value: 400 }, opacity: { value: opacity }, fogColor: { value: new THREE.Color(0x0d1522) }, fogDensity: { value: 0.022 } },
      vertexShader: `attribute vec3 color; attribute float alpha; varying vec3 vC; varying float vA; varying float vFog; uniform float size; uniform float scale; uniform float fogDensity;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * scale / max(0.1,-mv.z); vC = color; vA = alpha;
        float d = -mv.z; vFog = 1.0 - exp(-fogDensity*fogDensity*d*d); }`,
      fragmentShader: `uniform sampler2D map; uniform float opacity; uniform vec3 fogColor; varying vec3 vC; varying float vA; varying float vFog;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); float a = t.a * vA * opacity; if (a < 0.01) discard; gl_FragColor = vec4(mix(vC, fogColor, vFog), a); }`,
      transparent: true, blending, depthWrite: false });
    this.additive = blending === THREE.AdditiveBlending;
    this.pts = new THREE.Points(g, this.m); this.pts.frustumCulled = false; scene.add(this.pts);
    for (let k = 0; k < n; k++) this.p[k * 3 + 1] = -999;
  }
  emit(x, y, z, vx, vy, vz, r, g, b, life, grav = 9.8, drag = 0) {
    const k = this.i; this.i = (this.i + 1) % this.n;
    this.p[k * 3] = x; this.p[k * 3 + 1] = y; this.p[k * 3 + 2] = z;
    this.v[k * 3] = vx; this.v[k * 3 + 1] = vy; this.v[k * 3 + 2] = vz;
    this.base[k * 3] = r; this.base[k * 3 + 1] = g; this.base[k * 3 + 2] = b;
    this.life[k] = life; this.max[k] = life; this.grav[k] = grav; this.drag[k] = drag;
  }
  update(dt) {
    const { p, v, c, life, max, base, a } = this;
    for (let k = 0; k < this.n; k++) {
      if (life[k] <= 0) { if (p[k * 3 + 1] > -900) p[k * 3 + 1] = -999; continue; }
      life[k] -= dt;
      const d = Math.exp(-this.drag[k] * dt);
      v[k * 3] *= d; v[k * 3 + 1] = v[k * 3 + 1] * d - this.grav[k] * dt; v[k * 3 + 2] *= d;
      p[k * 3] += v[k * 3] * dt; p[k * 3 + 1] += v[k * 3 + 1] * dt; p[k * 3 + 2] += v[k * 3 + 2] * dt;
      const f = Math.max(0, life[k] / max[k]);
      c[k * 3] = base[k * 3]; c[k * 3 + 1] = base[k * 3 + 1]; c[k * 3 + 2] = base[k * 3 + 2]; a[k] = this.additive ? f : Math.min(1, f * 1.5) * Math.min(1, (max[k] - life[k]) * 6);
    }
    this.g.attributes.position.needsUpdate = true; this.g.attributes.color.needsUpdate = true; this.g.attributes.alpha.needsUpdate = true;
  }
}

export class FX {
  constructor(scene, world) {
    this.scene = scene; this.w = world;
    const add = THREE.AdditiveBlending;
    this.sparks = new PointPool(scene, 700, 0.14, add, circleTex(false));
    this.smoke = new PointPool(scene, 260, 2.4, THREE.NormalBlending, circleTex(true), 0.55);
    this.glow = new PointPool(scene, 120, 1.6, add, circleTex(true));
    // debris
    this.DN = 700;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.debMat = new THREE.MeshLambertMaterial();
    this.deb = new THREE.InstancedMesh(geo, this.debMat, this.DN);
    this.deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.deb.frustumCulled = false;
    this.dP = new Float32Array(this.DN * 3); this.dV = new Float32Array(this.DN * 3); this.dR = new Float32Array(this.DN * 3);
    this.dW = new Float32Array(this.DN * 3); this.dL = new Float32Array(this.DN); this.dS = new Float32Array(this.DN); this.di = 0;
    const col = new THREE.Color(0, 0, 0);
    for (let i = 0; i < this.DN; i++) { this.deb.setColorAt(i, col); }
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.sv = new THREE.Vector3(); this.pv = new THREE.Vector3();
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.DN; i++) this.deb.setMatrixAt(i, this.zero);
    scene.add(this.deb);
    // tracers
    this.TN = 48; this.tP = new Float32Array(this.TN * 6); this.tL = new Float32Array(this.TN); this.ti = 0;
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(this.tP, 3).setUsage(THREE.DynamicDrawUsage));
    this.tC = new Float32Array(this.TN * 6); tg.setAttribute('color', new THREE.BufferAttribute(this.tC, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: add, depthWrite: false }));
    this.tracers.frustumCulled = false; scene.add(this.tracers);
    // flash light (lights Lambert entities — bots, viewmodel, debris)
    this.flash = new THREE.PointLight(0xffc77a, 0, 14, 1.6); scene.add(this.flash); this.flashT = 0;
    this.boom = new THREE.PointLight(0xff9a4a, 0, 30, 1.4); scene.add(this.boom); this.boomT = 0;
  }
  tracer(a, b, col = [1, 0.85, 0.5]) {
    const k = this.ti; this.ti = (this.ti + 1) % this.TN;
    this.tP.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6);
    this.tC.set([col[0] * 0.3, col[1] * 0.3, col[2] * 0.3, col[0], col[1], col[2]], k * 6);
    this.tL[k] = 0.06;
  }
  muzzle(p) { this.flash.position.copy(p); this.flash.intensity = 7; this.flashT = 0.05; this.glow.emit(p.x, p.y, p.z, 0, 0, 0, 1, 0.75, 0.4, 0.05, 0); }
  impact(p, n, mat) {
    const c = MATDEF[mat] ? MATDEF[mat].debris : new THREE.Color(0.6, 0.6, 0.6);
    for (let i = 0; i < 7; i++) this.sparks.emit(p.x, p.y, p.z, n.x * 3 + (Math.random() - 0.5) * 4, n.y * 3 + Math.random() * 3, n.z * 3 + (Math.random() - 0.5) * 4, c.r * 1.6, c.g * 1.6, c.b * 1.6, 0.5, 12, 1);
    if (mat === 8 || mat === 13) for (let i = 0; i < 5; i++) this.sparks.emit(p.x, p.y, p.z, n.x * 5 + (Math.random() - 0.5) * 6, n.y * 5 + Math.random() * 4, n.z * 5 + (Math.random() - 0.5) * 6, 2, 1.5, 0.6, 0.3, 14, 0.5);
    this.smoke.emit(p.x + n.x * 0.1, p.y + n.y * 0.1, p.z + n.z * 0.1, n.x * 0.6, 0.4, n.z * 0.6, c.r * 0.8 + 0.1, c.g * 0.8 + 0.1, c.b * 0.8 + 0.12, 0.9, -0.3, 1.5);
  }
  blood(p, d) {
    for (let i = 0; i < 9; i++) this.sparks.emit(p.x, p.y, p.z, d.x * 2 + (Math.random() - 0.5) * 3, Math.random() * 2, d.z * 2 + (Math.random() - 0.5) * 3, 0.7, 0.05, 0.08, 0.5, 10, 1);
  }
  // quantum effect colour (cyan/magenta)
  quantum(p, n = 30, col = [0.3, 1, 1]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2, s = 1 + Math.random() * 3;
      this.sparks.emit(p.x, p.y, p.z, Math.cos(a) * Math.cos(b) * s, Math.sin(b) * s, Math.sin(a) * Math.cos(b) * s, col[0], col[1], col[2], 0.6, 0, 2);
    }
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, col[0], col[1], col[2], 0.35, 0);
  }
  explosion(p, r) {
    this.boom.position.copy(p); this.boom.intensity = 60; this.boomT = 0.35;
    for (let i = 0; i < 8; i++) this.glow.emit(p.x + (Math.random() - 0.5) * r, p.y + (Math.random() - 0.3) * r, p.z + (Math.random() - 0.5) * r, 0, 1, 0, 1, 0.55, 0.2, 0.35 + Math.random() * 0.2, -2);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 14;
      this.sparks.emit(p.x, p.y, p.z, Math.cos(a) * s, Math.random() * 10, Math.sin(a) * s, 2, 1.2, 0.4, 0.4 + Math.random() * 0.6, 12, 0.5);
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 3;
      const g = 0.25 + Math.random() * 0.12;
      this.smoke.emit(p.x + Math.cos(a) * r * 0.5, p.y + Math.random() * r * 0.5, p.z + Math.sin(a) * r * 0.5, Math.cos(a) * s, 1 + Math.random() * 2, Math.sin(a) * s, g, g, g * 1.05, 2.5 + Math.random() * 2, -0.4, 0.8);
    }
  }
  debris(x, y, z, vx, vy, vz, mat, size = 0.6, life = 5) {
    const k = this.di; this.di = (this.di + 1) % this.DN;
    this.dP[k * 3] = x; this.dP[k * 3 + 1] = y; this.dP[k * 3 + 2] = z;
    this.dV[k * 3] = vx; this.dV[k * 3 + 1] = vy; this.dV[k * 3 + 2] = vz;
    this.dW[k * 3] = (Math.random() - 0.5) * 12; this.dW[k * 3 + 1] = (Math.random() - 0.5) * 12; this.dW[k * 3 + 2] = (Math.random() - 0.5) * 12;
    this.dR[k * 3] = this.dR[k * 3 + 1] = this.dR[k * 3 + 2] = 0;
    this.dL[k] = life + Math.random(); this.dS[k] = VS * size;
    const def = MATDEF[mat]; const c = def ? def.color.clone() : new THREE.Color(0.5, 0.5, 0.5);
    if (def && def.emit) c.multiplyScalar(1.5);
    this.deb.setColorAt(k, c); this.deb.instanceColor.needsUpdate = true;
  }
  setScale(h) { for (const pp of [this.sparks, this.smoke, this.glow]) pp.m.uniforms.scale.value = h / 2; }
  update(dt) {
    this.sparks.update(dt); this.smoke.update(dt); this.glow.update(dt);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
    if (this.boomT > 0) { this.boomT -= dt; this.boom.intensity = Math.max(0, this.boomT / 0.35) * 60; }
    for (let k = 0; k < this.TN; k++) if (this.tL[k] > 0) { this.tL[k] -= dt; if (this.tL[k] <= 0) this.tP.fill(0, k * 6, k * 6 + 6); }
    this.tracers.geometry.attributes.position.needsUpdate = true; this.tracers.geometry.attributes.color.needsUpdate = true;
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
      const s = this.dS[k] * Math.min(1, this.dL[k] * 2);
      this.e.set(this.dR[i3], this.dR[i3 + 1], this.dR[i3 + 2]); this.q.setFromEuler(this.e);
      this.pv.set(P[i3], P[i3 + 1], P[i3 + 2]); this.sv.set(s, s, s);
      this.m4.compose(this.pv, this.q, this.sv); this.deb.setMatrixAt(k, this.m4);
    }
    this.deb.instanceMatrix.needsUpdate = true;
  }
}
