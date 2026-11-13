// Weapon definitions + first-person viewmodel (procedural box-modelled guns & arms, spring-driven animation).
import * as THREE from 'three';

export const WEAPONS = {
  k7: { name: 'K-7 CARABINA', type: 'rifle', snd: 'rifle', dmg: 25, head: 1.9, rpm: 700, auto: true, mag: 30, reserve: 150, reload: 2.2,
    spreadHip: 0.032, spreadAds: 0.003, spreadMove: 0.025, recoilV: 0.0175, recoilH: 0.007, recoilBias: 0.25, kick: 1, falloff: [30, 70, 0.7], vox: 1, fovAds: 52, pellets: 1, range: 220, vel: 0 },
  vespa: { name: 'VESPA SMG', type: 'smg', snd: 'smg', dmg: 19, head: 1.6, rpm: 920, auto: true, mag: 36, reserve: 180, reload: 1.8,
    spreadHip: 0.024, spreadAds: 0.006, spreadMove: 0.012, recoilV: 0.011, recoilH: 0.008, recoilBias: -0.1, kick: 0.7, falloff: [18, 45, 0.55], vox: 1, fovAds: 58, pellets: 1, range: 150 },
  martelo: { name: 'MARTELO 12', type: 'shotgun', snd: 'shotgun', dmg: 14, head: 1.3, rpm: 75, auto: false, mag: 6, reserve: 36, reload: 0.55, perShell: true,
    spreadHip: 0.075, spreadAds: 0.055, spreadMove: 0.01, recoilV: 0.075, recoilH: 0.02, recoilBias: 0, kick: 2.2, falloff: [8, 25, 0.25], vox: 2, fovAds: 60, pellets: 10, range: 60 },
  lanca: { name: 'LANÇA DMR', type: 'dmr', snd: 'dmr', dmg: 58, head: 2.2, rpm: 240, auto: false, mag: 12, reserve: 60, reload: 2.6,
    spreadHip: 0.05, spreadAds: 0.0007, spreadMove: 0.03, recoilV: 0.05, recoilH: 0.012, recoilBias: 0.3, kick: 1.8, falloff: [60, 140, 0.85], vox: 3, fovAds: 32, pellets: 1, range: 300 },
  p9: { name: 'P9', type: 'pistol', snd: 'pistol', dmg: 24, head: 1.8, rpm: 400, auto: false, mag: 15, reserve: 75, reload: 1.5,
    spreadHip: 0.02, spreadAds: 0.006, spreadMove: 0.01, recoilV: 0.022, recoilH: 0.008, recoilBias: 0, kick: 0.8, falloff: [15, 40, 0.6], vox: 1, fovAds: 62, pellets: 1, range: 120 },
};
export const PRIMARIES = ['k7', 'vespa', 'martelo', 'lanca'];

export function damageAt(w, dist) {
  const [a, b, min] = w.falloff;
  if (dist <= a) return w.dmg;
  if (dist >= b) return w.dmg * min;
  return w.dmg * (1 - (1 - min) * (dist - a) / (b - a));
}

// --- tiny box-modelling helper ---
const _mats = new Map();
export function lam(hex, emissive = 0) {
  const k = hex + ':' + emissive; if (_mats.has(k)) return _mats.get(k);
  const m = new THREE.MeshLambertMaterial({ color: hex, emissive: emissive ? hex : 0, emissiveIntensity: emissive });
  _mats.set(k, m); return m;
}
export function box(parent, w, h, d, x, y, z, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
}

export function buildGun(type, opts = {}) {
  const g = new THREE.Group();
  const body = lam(0x3c434e), dark = lam(0x1f2228), accent = lam(opts.accent || 0x39e6ff, 1.2), grip = lam(0x3a3530);
  const muzzle = new THREE.Object3D();
  if (type === 'rifle') {
    box(g, 0.06, 0.08, 0.42, 0, 0, -0.05, body);
    box(g, 0.045, 0.05, 0.3, 0, 0.005, -0.38, dark);           // handguard
    box(g, 0.02, 0.02, 0.18, 0, 0.0, -0.6, dark);               // barrel
    box(g, 0.035, 0.035, 0.06, 0, 0.0, -0.69, dark);            // brake
    box(g, 0.04, 0.12, 0.06, 0, -0.09, -0.08, dark, 0.25);      // mag
    box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.08, grip, -0.3);      // grip
    box(g, 0.05, 0.06, 0.18, 0, -0.01, 0.24, body);             // stock
    box(g, 0.012, 0.012, 0.28, 0.031, 0.02, -0.2, accent);      // neon strip
    box(g, 0.036, 0.012, 0.07, 0, 0.045, -0.05, dark);          // optic base
    box(g, 0.004, 0.035, 0.012, -0.017, 0.068, -0.075, dark);   // holo frame posts
    box(g, 0.004, 0.035, 0.012, 0.017, 0.068, -0.075, dark);
    box(g, 0.038, 0.004, 0.012, 0, 0.087, -0.075, dark);
    box(g, 0.003, 0.003, 0.001, 0, 0.07, -0.075, lam(0xff3b30, 2)); // red holo dot
    muzzle.position.set(0, 0, -0.73);
  } else if (type === 'smg') {
    box(g, 0.06, 0.09, 0.32, 0, 0, -0.02, body);
    box(g, 0.025, 0.025, 0.14, 0, 0.0, -0.25, dark);
    box(g, 0.035, 0.18, 0.045, 0, -0.12, -0.04, dark);
    box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.1, grip, -0.3);
    box(g, 0.03, 0.03, 0.16, 0, 0.0, 0.2, dark);
    box(g, 0.012, 0.03, 0.2, 0.032, 0.0, -0.05, accent);
    box(g, 0.03, 0.01, 0.05, 0, 0.05, -0.02, dark);
    box(g, 0.004, 0.03, 0.01, -0.014, 0.068, -0.04, dark); box(g, 0.004, 0.03, 0.01, 0.014, 0.068, -0.04, dark);
    box(g, 0.003, 0.003, 0.001, 0, 0.068, -0.04, lam(0x39e6ff, 2));
    muzzle.position.set(0, 0, -0.33);
  } else if (type === 'shotgun') {
    box(g, 0.065, 0.08, 0.38, 0, 0, 0, body);
    box(g, 0.035, 0.035, 0.42, 0, 0.015, -0.38, dark);
    box(g, 0.05, 0.045, 0.2, 0, -0.04, -0.33, grip);             // pump
    box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.1, grip, -0.3);
    box(g, 0.055, 0.07, 0.22, 0, -0.02, 0.3, grip);
    box(g, 0.012, 0.012, 0.36, 0.034, 0.02, -0.05, accent);
    box(g, 0.012, 0.02, 0.012, 0, 0.05, -0.55, accent);           // bead sight
    muzzle.position.set(0, 0.015, -0.6);
  } else if (type === 'dmr') {
    box(g, 0.06, 0.085, 0.5, 0, 0, -0.03, body);
    box(g, 0.022, 0.022, 0.36, 0, 0.005, -0.45, dark);
    box(g, 0.04, 0.14, 0.06, 0, -0.1, -0.08, dark, 0.15);
    box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.1, grip, -0.3);
    box(g, 0.055, 0.08, 0.2, 0, -0.01, 0.3, body);
    box(g, 0.05, 0.05, 0.22, 0, 0.075, -0.04, dark);             // scope
    box(g, 0.056, 0.056, 0.02, 0, 0.075, 0.08, accent);           // scope ring glow
    box(g, 0.012, 0.012, 0.4, 0.031, 0.02, -0.2, accent);
    muzzle.position.set(0, 0.005, -0.64);
  } else { // pistol
    box(g, 0.04, 0.05, 0.2, 0, 0.03, -0.05, body);
    box(g, 0.035, 0.11, 0.045, 0, -0.04, 0.02, grip, -0.2);
    box(g, 0.01, 0.01, 0.16, 0.021, 0.04, -0.05, accent);
    box(g, 0.008, 0.012, 0.008, 0, 0.062, -0.13, accent);
    muzzle.position.set(0, 0.03, -0.16);
  }
  g.add(muzzle); g.userData.muzzle = muzzle;
  return g;
}

// Sight height per gun type (ADS alignment)
const SIGHT = { rifle: 0.07, smg: 0.068, shotgun: 0.05, dmr: 0.075, pistol: 0.062 };

export class Viewmodel {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x30303a, 2.2));
    const d = new THREE.DirectionalLight(0xbcd0ff, 1.2); d.position.set(0.5, 1, 0.3); this.scene.add(d);
    this.flash = new THREE.PointLight(0xffb060, 0, 3, 1.5); this.flash.position.set(0.1, -0.05, -0.8); this.scene.add(this.flash);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.guns = {};
    this.arms = new THREE.Group();
    const sleeve = lam(0x2c3440), glove = lam(0x1a1c20), band = lam(0x39e6ff, 1);
    // right arm: hand on grip, forearm running back/down/right out of frame
    const ra = new THREE.Group(); ra.position.set(0.0, -0.08, 0.1); this.arms.add(ra);
    box(ra, 0.06, 0.07, 0.09, 0, 0, 0, glove);
    const rf = box(ra, 0.075, 0.075, 0.36, 0.05, -0.08, 0.18, sleeve); rf.rotation.set(0.45, 0.25, 0);
    const rb = box(ra, 0.08, 0.025, 0.06, 0.03, -0.03, 0.08, band); rb.rotation.set(0.45, 0.25, 0); // quantum gauntlet
    // left arm: hand under handguard, forearm toward lower-left
    this.leftArm = new THREE.Group(); this.leftArm.position.set(0, -0.045, -0.32); this.arms.add(this.leftArm);
    box(this.leftArm, 0.065, 0.06, 0.1, 0, -0.01, 0, glove);
    const lf = box(this.leftArm, 0.075, 0.075, 0.4, -0.1, -0.1, 0.16, sleeve); lf.rotation.set(0.35, -0.55, 0);
    this.root.add(this.arms);
    this.cur = null; this.type = null;
    // spring states
    this.kick = 0; this.kickV = 0; this.rot = 0; this.rotV = 0; this.roll = 0;
    this.swayX = 0; this.swayY = 0; this.reloadT = 0; this.reloadDur = 1; this.switchT = 0; this.melee = 0;
    this.sprintW = 0; this.adsW = 0; this.tiltW = 0;
  }
  setWeapon(id, def) {
    if (this.cur) this.root.remove(this.cur);
    if (!this.guns[id]) this.guns[id] = buildGun(def.type);
    this.cur = this.guns[id]; this.root.add(this.cur); this.type = def.type; this.switchT = 0.35;
  }
  get muzzleWorld() { return this.cur.userData.muzzle; }
  fire(k) { this.kickV += 0.9 * k; this.rotV += 7 * k; this.roll = (Math.random() - 0.5) * 0.06 * k; this.flash.intensity = 4; this.flashT = 0.05; }
  update(dt, s) {
    // critically damped-ish springs for recoil (x'' = -k x - c x')
    const K = 220, C = 22;
    this.kickV += (-K * this.kick - C * this.kickV) * dt; this.kick += this.kickV * dt;
    this.rotV += (-K * this.rot - C * this.rotV) * dt; this.rot += this.rotV * dt;
    this.roll *= Math.exp(-dt * 10);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
    this.swayX += (-s.mdx * 0.0009 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (s.mdy * 0.0009 - this.swayY) * Math.min(1, dt * 8);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.05, 0.05); this.swayY = THREE.MathUtils.clamp(this.swayY, -0.05, 0.05);
    this.sprintW += ((s.sprint ? 1 : 0) - this.sprintW) * Math.min(1, dt * 9);
    this.adsW = s.ads;
    this.tiltW += ((s.slide ? 1 : 0) - this.tiltW) * Math.min(1, dt * 8);
    if (this.switchT > 0) this.switchT -= dt;
    let rl = 0; if (s.reloadT > 0) { const t = 1 - s.reloadT / s.reloadDur; rl = Math.sin(Math.min(1, t) * Math.PI); }
    const a = this.adsW, hip = 1 - a;
    const sight = SIGHT[this.type] || 0.07;
    const bobA = hip * 0.9 + 0.15;
    const bx = Math.cos(s.bob) * 0.012 * s.moveK * bobA, by = Math.abs(Math.sin(s.bob)) * 0.014 * s.moveK * bobA;
    const r = this.root;
    r.position.set(
      0.14 * hip + bx + this.swayX * hip + 0.05 * this.sprintW,
      -0.15 * hip - sight * a - by - this.swayY - 0.06 * rl - (this.switchT > 0 ? this.switchT * 0.8 : 0) - s.land * 0.04 - 0.03 * this.sprintW,
      -0.42 * hip - 0.45 * a + this.kick * 0.07 * (1 - a * 0.5));
    r.rotation.set(this.rot * 0.09 * (1 - a * 0.6) + this.swayY * 2 - 0.25 * this.sprintW + 0.4 * rl * 0.3,
      this.swayX * 2 + 0.75 * this.sprintW, this.roll + rl * 0.5 + 0.3 * this.tiltW + 0.15 * this.sprintW);
    this.leftArm.position.y = -0.045 - 0.1 * rl; this.leftArm.position.z = -0.32 + 0.14 * rl;
    this.cam.fov = s.fov; this.cam.updateProjectionMatrix();
  }
}
