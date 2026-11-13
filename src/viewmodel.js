// First-person viewmodel: the weapon rig with gloved hands and sleeved forearms, spring recoil,
// per-style reload choreography driven by each gun's anchors (see the specs in guns.js), bolt and
// pump cycles, pooled shell casings, pixel muzzle flashes, inspect and a knife swipe.
// Conventions: the viewmodel camera sits at the origin looking down -Z; the rig root carries the gun
// (which points along -Z). In ADS the root goes to (0, -sightY, -adsZ), so the sight line is on the
// screen centre. Nothing in update() allocates.
import * as THREE from 'three';
import { buildGun, handMesh, forearmMesh, casingGeo } from './guns.js';
import { kitMaterial } from './kit.js';

const ease = (t) => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const seg = (t, a, b) => ease((t - a) / (b - a));
const bump = (t, a, b, c, d) => seg(t, a, b) * (1 - seg(t, c, d));   // 0 -> 1 (a..b) -> 0 (c..d)
const UP = new THREE.Vector3(0, 1, 0), Z3 = [0, 0, 0];
const HIP = [0.13, -0.145, -0.42], MAG_OUT = [-0.03, -0.34, 0.02, -0.25, 0], EJECT = [0.03, 0.02, -0.04], R_HOLD = { p: [0, -0.047, 0.088], rake: -0.3 }, PORT = [0, -0.034, -0.03];
const PARTS = ['mag', 'cover', 'cyl', 'rocket'], ALL = ['mag', 'bolt', 'cover', 'cyl', 'rocket', 'pump', 'shell'];
const PUMP = 0.5, INSPECT = 2.5, MELEE = 0.5;
// Sprint carry per family: [dx, dy, dz, rx, ry, rz]
const SPRINT = { long: [0.05, -0.03, 0, -0.25, 0.75, 0.15], pistol: [-0.02, 0.03, 0.1, 0.55, 0.12, -0.12], heavy: [0.04, -0.07, 0, -0.38, 0.6, 0.22] };
// Muzzle-flash proportions per weapon [wide, tall, long]; the size itself comes from the gun's spec.
const FLASH = { orion: [1.9, 0.7, 0.8], bigorna: [1.5, 0.8, 1], martelo: [1.25, 1.25, 0.8], lanca: [0.6, 0.6, 1.4], trovao: [1, 1, 1.35], vigia: [1, 1, 1.2], rpg: [1.3, 1.3, 0.6], juiz: [1.2, 1.2, 0.9] };

const setHome = (o, x, y, z, rx = 0) => { o.position.set(x, y, z); o.rotation.set(rx, 0, 0); o.userData.home = o.position.clone(); o.userData.homeR = o.rotation.clone(); return o; };

// 64x32 pixel-art flash sheet: left half = star burst seen from the front, right half = flame seen from the side.
function flashTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32; const x = c.getContext('2d');
  const ramp = ['rgba(224,84,26,.55)', 'rgba(255,154,48,.9)', '#ffd860', '#fffbe0'];
  const put = (px, py, i) => { if (i <= 0.04) return; x.fillStyle = ramp[i > 0.62 ? 3 : i > 0.4 ? 2 : i > 0.2 ? 1 : 0]; x.fillRect(px, py, 1, 1); };
  for (let py = 0; py < 32; py++) for (let px = 0; px < 32; px++) {
    const dx = (px - 15.5) / 15.5, dy = (py - 15.5) / 15.5, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const R = Math.max(0.42, Math.pow(Math.abs(Math.cos(a * 2)), 5), 0.72 * Math.pow(Math.abs(Math.sin(a * 2)), 7));
    put(px, py, 1 - r / R);
    const u = Math.abs(dx), v = (31 - py) / 31, w = v < 0.18 ? 0.45 + 3 * v : 1 - (v - 0.18) / 0.82;
    put(32 + px, py, w > 0 ? (1 - u / w) * (1.15 - 0.6 * v) : 0);
  }
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace; return t;
}
// One mesh (one draw call): a star facing the camera plus two crossed flames along -Z.
function flashMesh() {
  const g = new THREE.BufferGeometry(), s = 0.11, w = 0.055, l = 0.34;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-s, -s, -0.02, s, -s, -0.02, s, s, -0.02, -s, s, -0.02,
    -w, 0, 0.02, w, 0, 0.02, w, 0, -l, -w, 0, -l, 0, -w, 0.02, 0, w, 0.02, 0, w, -l, 0, -w, -l], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.5, 0, 1, 0, 1, 1, 0.5, 1, 0.5, 0, 1, 0, 1, 1, 0.5, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11]);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, fog: false }));
  m.renderOrder = 10; m.frustumCulled = false; m.visible = false; return m;
}

export class Viewmodel {
  constructor() {
    const sc = this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    sc.add(new THREE.HemisphereLight(0x9fc4ff, 0x30303a, 2.2));
    const d = new THREE.DirectionalLight(0xbcd0ff, 1.2); d.position.set(0.5, 1, 0.3); sc.add(d);
    this.flash = new THREE.PointLight(0xffb060, 0, 3, 1.5); this.flash.position.set(0.1, -0.05, -0.8); sc.add(this.flash);
    this.root = new THREE.Group(); sc.add(this.root);
    this.mflash = flashMesh();
    this.foreR = forearmMesh(1); this.foreL = forearmMesh(-1); sc.add(this.foreR, this.foreL);
    this.foreR.position.z = this.foreL.position.z = 1;                     // behind the camera until a weapon is set
    this.brass = this.pool('brass', 28); this.hulls = this.pool('hull', 8);
    this.guns = {}; this.cur = null; this.type = null; this.def = null; this.id = null; this.fam = 'long';
    this.kick = 0; this.kickV = 0; this.rot = 0; this.rotV = 0; this.roll = 0;
    this.swayX = 0; this.swayY = 0; this.switchT = 0; this.sprintW = 0; this.adsW = 0; this.tiltW = 0;
    this.flashT = 0; this.hasRocket = true;
    this.pumpT = 0; this.inspectT = 0; this.meleeT = 0; this.casePending = false; this.dumped = false; this.cylA = 0; this.cylTo = 0;
    this.kn = null; this.knHand = null;
    this.pt = new Float32Array(6); this.pc = new Float32Array(6);          // pose target / smoothed: tiltX, tiltY, tiltZ, dx, dy, dz
    this.lt = new THREE.Vector3(); this.rt = new THREE.Vector3();          // hand targets (gun space)
    this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3(); this.v3 = new THREE.Vector3(); this.v4 = new THREE.Vector3();
    this.m1 = new THREE.Matrix4(); this.q1 = new THREE.Quaternion(); this.e1 = new THREE.Euler();
  }
  // Casing pool: one InstancedMesh, ring-allocated, simulated on plain typed arrays.
  pool(kind, n) {
    const m = new THREE.InstancedMesh(casingGeo(kind), kitMaterial(), n); m.count = 0; m.frustumCulled = false; this.scene.add(m);
    return { m, n, next: 0, p: new Float32Array(n * 3), v: new Float32Array(n * 3), life: new Float32Array(n), ang: new Float32Array(n), spin: new Float32Array(n), sc: new Float32Array(n) };
  }
  // Gun + both hands, built once per weapon id. The hands are children of the gun and sit on its grip anchors.
  rig(id, def) {
    const g = buildGun(def.type, { id, sight: def.sight }), U = g.userData, H = U.hold || {}, r = H.r || R_HOLD, l = H.l;
    const rk = r.rake || 0;
    U.rh = setHome(handMesh(1, { pose: r.stock ? 'stock' : 'grip', w: r.w, d: r.d, trigger: true }), r.p[0], r.p[1], r.p[2], rk); g.add(U.rh);
    U.fistC = r.stock ? [0, -0.035 * Math.sin(rk), 0.035 * Math.cos(rk)] : [0, -0.035 * Math.cos(rk), -0.035 * Math.sin(rk)];   // middle of the closed fist, gun space
    U.lh = null; U.hk = Z3; U.grabOff = Z3; U.carry = Z3;
    if (l) {
      const pose = l.pose || 'grip';
      if (pose === 'under') {
        const w = l.w ?? 0.032, dh = l.d ?? 0.04;
        U.lh = setHome(handMesh(-1, l), l.p[0], l.p[1], l.p[2]);
        U.hk = [-(w / 2 + 0.022), -dh + 0.006, 0]; U.carry = [w / 2 + 0.009, dh + 0.012, 0];
      } else if (pose === 'wrap') {          // support hand closed over the firing hand
        const w = (r.w ?? 0.032) + 0.06, d = (r.d ?? 0.042) + 0.038;
        U.lh = setHome(handMesh(-1, { pose, w, d }), r.p[0], r.p[1] - 0.008, r.p[2], r.rake || 0);
        U.hk = [-w / 2 - 0.008, 0.035, 0]; U.grabOff = [w / 2 - 0.011, 0, 0.01]; U.carry = [w / 2 + 0.008, -0.03, 0];
      } else {
        const w = l.w ?? 0.032;
        U.lh = setHome(handMesh(-1, l), l.p[0], l.p[1], l.p[2], l.rake || 0);
        U.hk = [-w / 2 - 0.008, 0.035, 0]; U.grabOff = U.sideGrab ? U.hk : Z3; U.carry = [w / 2 + 0.008, -0.03, 0];
      }
      g.add(U.lh);
    }
    return g;
  }
  setWeapon(id, def) {
    if (this.cur) this.root.remove(this.cur);
    if (!this.guns[id]) this.guns[id] = this.rig(id, def);
    const g = this.cur = this.guns[id], U = g.userData; this.root.add(g); U.muzzle.add(this.mflash);
    this.type = def.type; this.def = def; this.id = id; this.switchT = 0.35;
    this.fam = U.fam || (def.type === 'lmg' || def.type === 'lmg2' || def.type === 'launcher' ? 'heavy' : 'long');
    this.foreL.visible = !!U.lh;
    this.pumpT = 0; this.inspectT = 0; this.meleeT = 0; this.casePending = false; this.dumped = false; this.cylA = this.cylTo = 0;
    if (this.kn) this.kn.visible = false;
    this.flashT = 0; this.flash.intensity = 0; this.mflash.visible = false;
    this.pc.fill(0); this.resetParts();
  }
  resetParts() {
    const U = this.cur.userData;
    for (const k of ALL) { const p = U[k]; if (!p) continue; p.position.copy(p.userData.home); p.rotation.copy(p.userData.homeR); p.visible = k !== 'shell'; }
    U.rh.position.copy(U.rh.userData.home); if (U.lh) { U.lh.position.copy(U.lh.userData.home); U.lh.visible = true; }
  }
  fire(k) {
    const U = this.cur.userData, f = U.flash ?? 1, sh = FLASH[this.id];
    this.kickV += 0.9 * k; this.rotV += 7 * k; this.roll = (Math.random() - 0.5) * 0.06 * k;
    this.flashT = 0.05; this.inspectT = 0;
    if (f > 0) {
      const s = f * (0.85 + Math.random() * 0.4), m = this.mflash;
      m.visible = true; m.rotation.z = sh ? (Math.random() - 0.5) * 0.5 : Math.random() * 6.28;
      if (sh) m.scale.set(s * sh[0], s * sh[1], s * sh[2]); else m.scale.setScalar(s);
      this.flash.intensity = 3 + 2 * f; U.muzzle.getWorldPosition(this.flash.position);
    }
    const b = U.bolt; if (b && !this.def.bolt) b.position.z = b.userData.home.z + (U.travel || 0.035);   // slide / charging handle reciprocates
    if (U.cyl) this.cylTo += Math.PI / 3;
    if (this.def.bolt) this.casePending = true;                 // thrown out by the bolt cycle
    else if (U.pump) { this.casePending = true; this.pumpT = PUMP; }
    else this.eject(U.cas, 1, null);
  }
  /** P2: turn the weapon over for 2.5 s (cancelled by firing, reloading, aiming or sprinting). Returns the duration. */
  inspect() { if (this.cur && this.inspectT <= 0 && this.meleeT <= 0) this.inspectT = INSPECT; return INSPECT; }
  /** P2: knife swipe with the support hand (visual only). Returns the duration in seconds. */
  melee() {
    if (!this.cur || this.meleeT > 0) return MELEE;
    if (!this.kn) {
      const k = this.kn = buildGun('knife', { id: 'knife' }), h = k.userData.hold.r;
      this.knHand = setHome(handMesh(-1, { pose: 'grip', w: h.w, d: h.d }), h.p[0], h.p[1], h.p[2], h.rake); k.add(this.knHand); this.scene.add(k);
    }
    this.meleeT = MELEE; this.inspectT = 0; this.kn.visible = true; return MELEE;
  }
  // Throws n spent cases: from the ejection port, or dumped out of `from` (the revolver's cylinder).
  eject(kind, n, from) {
    if (!kind) return;
    const U = this.cur.userData, P = kind === 'hull' ? this.hulls : this.brass, e = U.eject || EJECT, ev = U.ejectV, v = this.v3;
    const sc = kind === 'pistol' ? 0.62 : kind === 'big' ? 1.35 : 1;
    for (let j = 0; j < n; j++) {
      const i = P.next, k = i * 3; P.next = (i + 1) % P.n;
      if (from) v.set(from.position.x + (Math.random() - 0.5) * 0.03, from.position.y + (Math.random() - 0.5) * 0.03, from.position.z + 0.04); else v.set(e[0], e[1], e[2]);
      this.cur.localToWorld(v); P.p[k] = v.x; P.p[k + 1] = v.y; P.p[k + 2] = v.z;
      if (from) v.set((Math.random() - 0.5) * 0.4, -0.2 - Math.random() * 0.4, 0.5 + Math.random() * 0.5);
      else if (ev) v.set(ev[0] + (Math.random() - 0.5) * 0.3, ev[1], ev[2] + (Math.random() - 0.5) * 0.2);
      else v.set(1.2 + Math.random() * 0.7, 1.0 + Math.random() * 0.6, 0.2 + Math.random() * 0.5);
      v.applyQuaternion(this.root.quaternion); P.v[k] = v.x; P.v[k + 1] = v.y; P.v[k + 2] = v.z;
      P.life[i] = 0.65; P.ang[i] = Math.random() * 6.28; P.spin[i] = (12 + Math.random() * 16) * (Math.random() < 0.5 ? -1 : 1); P.sc[i] = sc;
    }
  }
  stepCasings(P, dt) {
    const m = P.m, M = this.m1, q = this.q1, e = this.e1, pv = this.v1, sv = this.v2; let live = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      const k = i * 3; P.life[i] -= dt; P.v[k + 1] -= 9.8 * dt;
      P.p[k] += P.v[k] * dt; P.p[k + 1] += P.v[k + 1] * dt; P.p[k + 2] += P.v[k + 2] * dt; P.ang[i] += P.spin[i] * dt;
      e.set(P.ang[i], P.ang[i] * 0.37 + i, P.ang[i] * 0.71); q.setFromEuler(e);
      M.compose(pv.set(P.p[k], P.p[k + 1], P.p[k + 2]), q, sv.setScalar(P.sc[i])); m.setMatrixAt(live++, M);
    }
    if (live || m.count) { m.count = live; m.instanceMatrix.needsUpdate = true; }
  }

  // Reload choreography, t in [0, 1]: poses the gun (this.pt), moves its parts and steers the support hand (lt, gun space).
  reload(t, style, U, lt) {
    const T = this.pt, L = U.lh, hk = U.hk, v = this.v3, w = this.v4;
    if (style === 'mag') {
      const pistol = U.fam === 'pistol', p = bump(t, 0, 0.14, 0.86, 1), M = U.mag, B = U.bolt && !this.def.bolt ? U.bolt : null;
      T[0] = (pistol ? 0.34 : 0.2) * p; T[1] = (pistol ? 0.22 : 0.16) * p; T[2] = -0.5 * p; T[3] = -0.03 * p; T[4] = 0.055 * p;
      let far = false;
      if (M) {
        const h = M.userData.home, o = U.magOut || MAG_OUT, gr = U.magGrab || Z3, g0 = U.grabOff;
        const out = bump(t, 0.16, 0.32, 0.46, 0.66), up = o[4] ? bump(t, 0.12, 0.18, 0.64, 0.7) : 0, rx = o[3] * out;
        M.position.set(h.x + o[0] * out, h.y + o[1] * out + o[4] * up, h.z + o[2] * out); M.rotation.x = M.userData.homeR.x + rx; M.visible = !(t > 0.33 && t < 0.45);
        T[4] += 0.012 * bump(t, 0.655, 0.675, 0.675, 0.72);                          // the fresh magazine is slapped home
        if (L) {
          const c = Math.cos(rx), sn = Math.sin(rx);
          far = h.z > U.rh.userData.home.z;                                           // magazine behind the firing hand: swing wide around it
          if (far) { w.set(-0.08, Math.min(lt.y, h.y + gr[1]) - 0.07, (lt.z + h.z) / 2); lt.lerp(w, seg(t, 0.02, 0.09)); }
          v.set(M.position.x + gr[0] + g0[0], M.position.y + gr[1] * c - gr[2] * sn + g0[1], M.position.z + gr[1] * sn + gr[2] * c + g0[2]);
          lt.lerp(v, far ? seg(t, 0.09, 0.16) : seg(t, 0.04, 0.15));
          if (far) lt.lerp(w, seg(t, 0.69, 0.74));
        }
      }
      const rack = B && U.rack === 'l' && L, r0 = far ? 0.74 : 0.7;
      if (B) {
        if (U.slideLock) B.position.z = B.userData.home.z + (U.travel || 0.04) * bump(t, 0.02, 0.05, 0.8, 0.83);   // slide held open until the release
        else {
          B.position.z = B.userData.home.z + (U.travel || 0.05) * bump(t, 0.81, 0.865, 0.875, 0.9);
          if (rack) { v.set(B.position.x + hk[0], B.position.y + hk[1], B.position.z + hk[2]); lt.lerp(v, seg(t, r0, 0.795)); }
        }
      }
      if (L) lt.lerp(L.userData.home, rack ? seg(t, 0.905, 0.99) : seg(t, r0, 0.88));
    } else if (style === 'belt') {
      const p = bump(t, 0, 0.08, 0.9, 1), Cv = U.cover, M = U.mag, cz = U.coverLen || 0.24;
      T[0] = 0.14 * p; T[1] = 0.12 * p; T[2] = -0.12 * p; T[4] = 0.05 * p;
      if (Cv) Cv.rotation.x = -1.2 * bump(t, 0.07, 0.16, 0.78, 0.85);
      if (M) {
        const h = M.userData.home, o = U.magOut || MAG_OUT, out = bump(t, 0.24, 0.36, 0.5, 0.64);
        M.position.set(h.x + o[0] * out, h.y + o[1] * out, h.z + o[2] * out); M.visible = !(t > 0.37 && t < 0.49);
      }
      if (L) {
        const a = Cv ? Cv.rotation.x : 0, ch = Cv ? Cv.userData.home : lt;
        const lipY = ch.y + 0.02 * Math.cos(a) - cz * Math.sin(a) + hk[1], lipZ = ch.z + 0.02 * Math.sin(a) + cz * Math.cos(a) + hk[2];   // rear lip of the cover (hinged at the front)
        if (Cv) lt.lerp(v.set(ch.x + hk[0], lipY, lipZ), seg(t, 0.02, 0.07));
        if (M) { const gr = U.magGrab || Z3; lt.lerp(v.set(M.position.x + gr[0], M.position.y + gr[1], M.position.z + gr[2]), seg(t, 0.17, 0.24)); }
        if (Cv) {
          lt.lerp(v.set(ch.x + hk[0] + 0.012, ch.y + 0.014 + hk[1] - 0.008 * bump(t, 0.7, 0.72, 0.72, 0.75), ch.z + 0.1 + hk[2]), seg(t, 0.645, 0.7));   // lays the belt on the feed tray
          lt.lerp(v.set(ch.x + hk[0], lipY, lipZ), seg(t, 0.75, 0.785));
        }
        lt.lerp(L.userData.home, seg(t, 0.875, 0.97));
      }
    } else if (style === 'shell') {           // one shell per cycle: carried up on the fingertips, thumbed into the loading port
      T[0] = 0.2; T[1] = 0.14; T[2] = -0.85; T[3] = -0.02; T[4] = 0.05;
      const S = U.shell, pt = U.port || PORT, cy = U.carry;
      if (S && L) {
        const push = seg(t, 0.54, 0.74);
        v.set(pt[0] - 0.02, pt[1] - 0.26, pt[2] + 0.07).lerp(w.set(pt[0], pt[1] - 0.014, pt[2] + 0.03), seg(t, 0.06, 0.5));
        v.y += 0.012 * push; v.z -= 0.055 * push;
        S.position.copy(v); S.visible = t > 0.03 && t < 0.76;
        lt.set(v.x - cy[0], v.y - cy[1], v.z - cy[2] + 0.03 * push);
        lt.lerp(w.set(pt[0] - 0.02 - cy[0], pt[1] - 0.26 - cy[1], pt[2] + 0.07 - cy[2]), seg(t, 0.8, 1));
      }
    } else if (style === 'cyl') {             // swing out, dump the empties, load, spin, close
      const p = bump(t, 0, 0.12, 0.86, 1), Y = U.cyl;
      T[0] = 0.5 * bump(t, 0, 0.12, 0.36, 0.5) + 0.12 * p; T[1] = 0.25 * p; T[2] = -0.6 * p; T[3] = -0.03 * p; T[4] = 0.05 * p;
      if (Y) {
        const h = Y.userData.home, o = bump(t, 0.1, 0.2, 0.76, 0.85);
        Y.position.set(h.x - 0.038 * o, h.y - 0.014 * o, h.z); Y.rotation.z = this.cylA + Math.PI * 2 * seg(t, 0.58, 0.76);
        if (!this.dumped && t > 0.24) { this.dumped = true; this.eject('rifle', U.dump || 0, Y); }
        if (L) {
          const lh = L.userData.home;
          lt.lerp(v.set(lh.x - 0.02, lh.y + 0.01, lh.z - 0.03), seg(t, 0.05, 0.14));
          lt.lerp(v.set(lh.x - 0.08, lh.y - 0.3, lh.z + 0.05), seg(t, 0.28, 0.4));
          lt.lerp(v.set(Y.position.x - 0.026 + hk[0], Y.position.y + hk[1], Y.position.z + 0.05 - 0.02 * seg(t, 0.56, 0.6) + hk[2]), seg(t, 0.44, 0.56));
          lt.lerp(lh, seg(t, 0.87, 0.98));
        }
      }
    } else if (style === 'rocket') {          // a fresh rocket is brought up from below, lined up and pushed into the muzzle
      const p = bump(t, 0, 0.18, 0.8, 1), Rk = U.rocket;
      T[0] = -0.1 * p; T[1] = 0.7 * p; T[2] = -0.1 * p; T[3] = 0.05 * p; T[4] = 0.03 * p; T[5] = 0.16 * p;   // muzzle swung across to the support hand
      if (Rk) {
        const h = Rk.userData.home, q1 = 1 - seg(t, 0.24, 0.46), q2 = 1 - seg(t, 0.46, 0.7);
        Rk.visible = t > 0.22; Rk.position.set(h.x - 0.2 * q1, h.y - 0.4 * q1, h.z - 0.1 * q1 - 0.24 * q2);
        if (L) {
          const lh = L.userData.home;
          lt.lerp(v.set(lh.x - 0.15, lh.y - 0.35, lh.z - 0.25), seg(t, 0.05, 0.2));
          lt.lerp(v.set(Rk.position.x, Rk.position.y - 0.05, Rk.position.z - 0.1), seg(t, 0.2, 0.24));
          lt.lerp(lh, seg(t, 0.72, 0.9));
        }
      }
    }
  }
  // Parts drift back to rest whenever no reload is running.
  settle(U, dt) {
    const k = Math.min(1, dt * 14);
    for (let i = 0; i < 4; i++) {
      const p = U[PARTS[i]]; if (!p) continue;
      p.position.lerp(p.userData.home, k); p.rotation.x += (p.userData.homeR.x - p.rotation.x) * k; p.visible = true;
    }
    if (U.rocket) U.rocket.visible = this.hasRocket !== false;
    if (U.shell) U.shell.visible = false;
    this.dumped = false;
  }
  // Bolt-action cycle after each shot: handle up, back (the case flies), forward, down. The firing hand works the knob.
  cycleBolt(t, U, rt) {
    const B = U.bolt, up = bump(t, 0.08, 0.2, 0.78, 0.92), back = bump(t, 0.24, 0.42, 0.52, 0.72), kn = U.knob;
    B.rotation.z = up; B.position.z = B.userData.home.z + (U.travel || 0.085) * back;
    if (kn) {
      const c = Math.cos(up), sn = Math.sin(up), fc = U.fistC;
      this.v3.set(B.position.x + kn[0] * c - kn[1] * sn, B.position.y + kn[0] * sn + kn[1] * c - fc[1], B.position.z + kn[2] - fc[2]);
      rt.lerp(this.v3, bump(t, 0, 0.08, 0.9, 1));
    }
    if (this.casePending && t > 0.4) { this.casePending = false; this.eject(U.cas, 1, null); }
    return up;
  }
  // Forearm from the hand's wrist towards an elbow anchor in camera space (kept below and behind the wrist).
  arm(fore, hand, ex, ey, ez) {
    const w = this.v1.copy(hand.userData.wrist).applyMatrix4(hand.matrixWorld);
    const e = this.v2.set(ex, Math.min(ey, w.y - 0.14), Math.max(ez, w.z + 0.18));
    fore.position.copy(w); this.m1.lookAt(e, w, UP); fore.quaternion.setFromRotationMatrix(this.m1);
  }

  update(dt, s) {
    const g = this.cur; if (!g) return;
    const U = g.userData, D = this.def, T = this.pt, P = this.pc, L = U.lh, R = U.rh, B = U.bolt, lt = this.lt, rt = this.rt, K = 220, C = 22;
    this.kickV += (-K * this.kick - C * this.kickV) * dt; this.kick += this.kickV * dt;
    this.rotV += (-K * this.rot - C * this.rotV) * dt; this.rot += this.rotV * dt;
    this.roll *= Math.exp(-dt * 10);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.intensity = 0; this.mflash.visible = false; } }
    this.swayX += (-s.mdx * 0.0009 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (s.mdy * 0.0009 - this.swayY) * Math.min(1, dt * 8);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.05, 0.05); this.swayY = THREE.MathUtils.clamp(this.swayY, -0.05, 0.05);
    this.sprintW += ((s.sprint ? 1 : 0) - this.sprintW) * Math.min(1, dt * 9);
    this.adsW = s.ads;
    this.tiltW += ((s.slide ? 1 : 0) - this.tiltW) * Math.min(1, dt * 8);
    if (this.switchT > 0) this.switchT -= dt;
    const kf = Math.min(1, dt * 14), reloading = s.reloadT > 0;
    T.fill(0); rt.copy(R.userData.home); if (L) lt.copy(L.userData.home);
    let lGo = false, rGo = false, boltUp = 0;

    if (B && !D.bolt) B.position.z += (B.userData.home.z - B.position.z) * Math.min(1, dt * 30);   // slide / handle runs forward again
    if (reloading) { this.reload(1 - s.reloadT / s.reloadDur, s.style, U, lt); lGo = true; this.inspectT = 0; }
    else this.settle(U, dt);
    if (B && D.bolt) {
      if (s.boltT > 0) { boltUp = this.cycleBolt(1 - s.boltT / s.boltDur, U, rt); rGo = true; }
      else { B.rotation.z -= B.rotation.z * kf; B.position.z += (B.userData.home.z - B.position.z) * kf; }
    }
    if (U.pump) {
      const pm = U.pump, hz = pm.userData.home.z;
      if (this.pumpT > 0) {                   // rack the fore-end after each shot; the hull leaves at the rear stop
        this.pumpT -= dt; const t = 1 - Math.max(0, this.pumpT) / PUMP, back = bump(t, 0.2, 0.45, 0.55, 0.85);
        pm.position.z = hz + 0.085 * back; T[0] += 0.05 * back; T[5] += 0.012 * back;
        if (!reloading && L) { lt.z += 0.085 * back; lGo = true; }
        if (this.casePending && t >= 0.45) { this.casePending = false; this.eject('hull', 1, null); }
      } else pm.position.z += (hz - pm.position.z) * kf;
    }
    if (U.cyl && !reloading) { this.cylA += (this.cylTo - this.cylA) * Math.min(1, dt * 22); U.cyl.rotation.z = this.cylA; }
    if (this.inspectT > 0) {
      if (s.ads > 0.3 || s.sprint) this.inspectT = 0;
      else {
        this.inspectT -= dt; const t = 1 - Math.max(0, this.inspectT) / INSPECT, e = bump(t, 0, 0.14, 0.86, 1);
        const a = bump(t, 0, 0.14, 0.42, 0.56), b = bump(t, 0.44, 0.58, 0.86, 1);   // left side first, then rolled over to the right side
        T[0] += 0.38 * a + 0.3 * b; T[1] += 0.95 * a - 0.5 * b; T[2] += -0.45 * a + 1.0 * b; T[3] += -0.1 * e; T[4] += 0.07 * e; T[5] += -0.04 * e;
        if (L && !lGo) { lt.x -= 0.06 * e; lt.y -= 0.32 * e; lGo = true; }
      }
    }
    if (this.meleeT > 0) {
      this.meleeT -= dt; const t = 1 - Math.max(0, this.meleeT) / MELEE, e = bump(t, 0, 0.2, 0.7, 1), kn = this.kn;
      T[1] -= 0.25 * e; T[2] -= 0.2 * e; T[3] += 0.05 * e; T[4] -= 0.08 * e;
      kn.position.set(-0.36, -0.42, -0.3).lerp(this.v3.set(0.0, -0.1, -0.55), seg(t, 0, 0.32)).lerp(this.v3.set(0.26, -0.2, -0.46), seg(t, 0.36, 0.6)).lerp(this.v3.set(0.3, -0.55, -0.3), seg(t, 0.64, 1));
      kn.rotation.set(0.25, -0.2 - 1.1 * seg(t, 0.2, 0.62), 0.9 - 0.5 * seg(t, 0.2, 0.62));
      if (this.meleeT <= 0) { kn.visible = false; if (L) L.position.y -= 0.3; }
      if (L) L.visible = this.meleeT <= 0;
    }

    const kp = 1 - Math.exp(-dt * 18);
    for (let i = 0; i < 6; i++) P[i] += (T[i] - P[i]) * kp;
    R.position.lerp(rt, 1 - Math.exp(-dt * (rGo ? 45 : 16)));
    if (L) L.position.lerp(lt, 1 - Math.exp(-dt * (lGo ? 45 : 16)));

    const a = this.adsW, hip = 1 - a, sw = this.sprintW * hip, hp = U.hip || HIP, S = SPRINT[this.fam], r = this.root;
    const bobA = hip * 0.9 + 0.15, sT = this.switchT > 0 ? this.switchT : 0;
    const bx = Math.cos(s.bob) * 0.012 * s.moveK * bobA, by = Math.abs(Math.sin(s.bob)) * 0.014 * s.moveK * bobA;
    r.position.set(
      hp[0] * hip + bx + this.swayX * hip + S[0] * sw + P[3] * hip,
      hp[1] * hip - (U.sightY || 0.07) * a - by - this.swayY + P[4] * hip - sT * 0.8 - s.land * 0.04 + S[1] * sw,
      hp[2] * hip - (U.adsZ || 0.3) * a + this.kick * 0.4 * (1 - a * 0.5) + S[2] * sw + P[5]);
    r.rotation.set(
      this.rot * 0.14 * (1 - a * 0.6) + this.swayY * 2 + S[3] * sw + P[0] + boltUp * 0.05 - sT * 1.2,
      this.swayX * 2 + S[4] * sw + P[1] + 0.03 * hip,
      this.roll + P[2] + 0.3 * this.tiltW * hip + S[5] * sw - boltUp * 0.15);

    r.updateMatrixWorld(true);
    this.arm(this.foreR, R, 0.31 - 0.08 * a, -0.52 + 0.1 * a, -0.04 + 0.14 * a);
    if (this.meleeT > 0) { this.kn.updateMatrixWorld(true); this.arm(this.foreL, this.knHand, -0.3, -0.6, 0.0); this.foreL.visible = true; }
    else if (L) this.arm(this.foreL, L, -0.16 - 0.08 * a, -0.62 + 0.12 * a, -0.35 + 0.15 * a);   // elbow low and forward: the support arm rises steeply from the bottom edge
    else this.foreL.visible = false;
    this.stepCasings(this.brass, dt); this.stepCasings(this.hulls, dt);
    if (this.cam.fov !== s.fov) { this.cam.fov = s.fov; this.cam.updateProjectionMatrix(); }
  }
}
