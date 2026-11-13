// Bots: 2.5D navigation grid (1 m cells) + A*, perception with LOS, aim model with reaction time
// and settling error, objective logic for Conquest, grenade use against cover.
import * as THREE from 'three';
import { VS, SX, SZ, SY } from './world.js';
import { lam, box, buildGun, WEAPONS, PRIMARIES, flatten } from './weapons.js';
import { G } from './mapgen.js';

export const NC = 1.0;                 // nav cell size (m)
const NX = SX * VS / NC | 0, NZ = SZ * VS / NC | 0;
const NV = NC / VS;                    // voxels per nav cell

export class Nav {
  constructor(world) { this.w = world; this.h = new Int16Array(NX * NZ).fill(-1); this.rebuild(0, 0, NX - 1, NZ - 1); }
  // standable voxel layer per cell: lowest y with solid below and 4 voxels (2 m) headroom over the whole cell
  rebuild(a, b, c, d) {
    const w = this.w;
    for (let cz = Math.max(0, b); cz <= Math.min(NZ - 1, d); cz++) for (let cx = Math.max(0, a); cx <= Math.min(NX - 1, c); cx++) {
      let res = -1;
      for (let y = 1; y < SY - 4 && res < 0; y++) {
        let ok = true, support = false;
        for (let dz = 0; dz < NV && ok; dz++) for (let dx = 0; dx < NV && ok; dx++) {
          const x = cx * NV + dx, z = cz * NV + dz;
          for (let k = 0; k < 4; k++) { const m = w.get(x, y + k, z); if (m && m !== 14) { ok = false; break; } }
          if (w.get(x, y - 1, z)) support = true;
        }
        if (ok && support) res = y;
      }
      // borders unwalkable
      if (cx < 1 || cz < 1 || cx >= NX - 1 || cz >= NZ - 1) res = -1;
      this.h[cz * NX + cx] = res;
    }
  }
  rebuildVox(x0, z0, x1, z1) { this.rebuild(Math.floor(x0 / NV) - 1, Math.floor(z0 / NV) - 1, Math.ceil(x1 / NV) + 1, Math.ceil(z1 / NV) + 1); }
  cell(p) { return [Math.min(NX - 1, Math.max(0, p.x / NC | 0)), Math.min(NZ - 1, Math.max(0, p.z / NC | 0))]; }
  ok(cx, cz) { return cx >= 0 && cz >= 0 && cx < NX && cz < NZ && this.h[cz * NX + cx] >= 0; }
  pass(ax, az, bx, bz) { const ha = this.h[az * NX + ax], hb = this.h[bz * NX + bx]; return ha >= 0 && hb >= 0 && Math.abs(ha - hb) <= 1; }
  nearestOk(cx, cz) {
    if (this.ok(cx, cz)) return [cx, cz];
    for (let r = 1; r < 8; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (this.ok(cx + dx, cz + dz)) return [cx + dx, cz + dz];
    return null;
  }
  // A* with octile heuristic, binary heap
  path(from, to, maxIter = 6000) {
    let s = this.nearestOk(...this.cell(from)), g = this.nearestOk(...this.cell(to));
    if (!s || !g) return null;
    const N = NX * NZ, si = s[1] * NX + s[0], gi = g[1] * NX + g[0];
    if (!this.gs || this.gs.length !== N) { this.gs = new Float32Array(N); this.came = new Int32Array(N); this.stamp = new Uint32Array(N); this.st = 0; this.closed = new Uint32Array(N); }
    const st = ++this.st; const gs = this.gs, came = this.came, stamp = this.stamp, closed = this.closed;
    const heap = []; const hf = (i) => { const x = i % NX, z = i / NX | 0; const dx = Math.abs(x - g[0]), dz = Math.abs(z - g[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    gs[si] = 0; stamp[si] = st; came[si] = -1; push(si, hf(si));
    let it = 0, best = si, bestH = hf(si);
    while (heap.length && it++ < maxIter) {
      const [, i] = pop();
      if (closed[i] === st) continue; closed[i] = st;
      if (i === gi) { best = gi; break; }
      const x = i % NX, z = i / NX | 0;
      const hh = hf(i); if (hh < bestH) { bestH = hh; best = i; }
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz; if (!this.ok(nx, nz) || !this.pass(x, z, nx, nz)) continue;
        if (dx && dz && (!this.ok(x + dx, z) || !this.ok(x, z + dz) || !this.pass(x, z, x + dx, z) || !this.pass(x, z, x, z + dz))) continue;
        const ni = nz * NX + nx; const cost = gs[i] + (dx && dz ? 1.414 : 1);
        if (stamp[ni] !== st || cost < gs[ni]) { stamp[ni] = st; gs[ni] = cost; came[ni] = i; push(ni, cost + hf(ni)); }
      }
    }
    const out = []; let k = best;
    while (k !== -1 && out.length < 2000) { out.push(new THREE.Vector3((k % NX + 0.5) * NC, this.h[k] * VS, ((k / NX | 0) + 0.5) * NC)); k = came[k]; if (k === si) break; }
    out.reverse();
    return out;
  }
  heightAt(p) { const [cx, cz] = this.cell(p); const h = this.h[cz * NX + cx]; return h >= 0 ? h * VS : null; }
}

// ---------- Soldier model ----------
const TEAMCOL = [{ body: 0x46566a, dark: 0x252c36, visor: 0x39e6ff }, { body: 0x5a4a3e, dark: 0x2a221d, visor: 0xff8a2a }];
export function buildSoldier(team, gunType) {
  const c = TEAMCOL[team];
  const root = new THREE.Group();
  const body = lam(c.body), dark = lam(c.dark), visor = lam(c.visor, 1.6);
  const hips = new THREE.Group(); hips.position.y = 0.9; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  box(torso, 0.44, 0.55, 0.26, 0, 0.3, 0, body);
  box(torso, 0.46, 0.3, 0.3, 0, 0.36, 0.0, dark);        // vest
  box(torso, 0.1, 0.06, 0.02, 0.12, 0.42, -0.16, visor);  // chest light (team readability)
  const head = new THREE.Group(); head.position.y = 0.72; torso.add(head);
  box(head, 0.24, 0.26, 0.26, 0, 0, 0, dark);
  box(head, 0.2, 0.07, 0.04, 0, 0.02, -0.13, visor);
  box(head, 0.28, 0.08, 0.3, 0, 0.13, 0, body);           // helmet rim
  const legs = [];
  for (const sx of [-0.12, 0.12]) {
    const leg = new THREE.Group(); leg.position.set(sx, 0, 0); hips.add(leg);
    box(leg, 0.16, 0.48, 0.18, 0, -0.24, 0, dark);
    const shin = new THREE.Group(); shin.position.y = -0.48; leg.add(shin);
    box(shin, 0.15, 0.44, 0.17, 0, -0.2, 0, body);
    box(shin, 0.16, 0.08, 0.26, 0, -0.42, -0.04, dark);
    legs.push({ leg, shin });
  }
  const arms = new THREE.Group(); arms.position.set(0, 0.45, 0); torso.add(arms);
  box(arms, 0.12, 0.12, 0.38, 0.22, -0.02, -0.12, body, 0.2);
  box(arms, 0.12, 0.12, 0.42, -0.16, -0.04, -0.26, body, 0.4);
  const gun = buildGun(gunType, { accent: c.visor }); gun.scale.setScalar(1.15); gun.position.set(0.05, 0.02, -0.38); arms.add(gun);
  root.userData = { hips, torso, head, legs, arms, gun };
  flatten(root);
  return root;
}

let _mk = null;
function MARKER() {
  if (_mk) return _mk;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#ff3b30'; x.strokeStyle = '#000'; x.lineWidth = 4; x.beginPath(); x.moveTo(8, 10); x.lineTo(56, 10); x.lineTo(32, 54); x.closePath(); x.stroke(); x.fill();
  _mk = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, fog: false }); return _mk;
}
const NAMES = ['Vega', 'Orion', 'Kappa', 'Tau', 'Rho', 'Sigma', 'Lyra', 'Draco', 'Hydra', 'Quasar', 'Pulsar', 'Fermi', 'Bohr', 'Dirac', 'Planck', 'Higgs', 'Curie', 'Gauss', 'Euler', 'Noether', 'Pauli', 'Maxwell', 'Tesla', 'Lorentz'];
let nameI = 0;

export class Bot {
  constructor(game, team) {
    this.g = game; this.team = team; this.name = NAMES[nameI++ % NAMES.length] + '-' + (10 + Math.random() * 89 | 0);
    const wid = PRIMARIES[Math.random() * PRIMARIES.length | 0];
    this.wid = wid; this.wdef = WEAPONS[wid];
    this.model = buildSoldier(team, this.wdef.type); game.scene.add(this.model);
    if (team === 1) { this.marker = new THREE.Sprite(MARKER()); this.marker.scale.set(0.45, 0.45, 1); this.marker.position.y = 2.3; this.marker.visible = false; this.model.add(this.marker); }
    this.pos = new THREE.Vector3(); this.yaw = 0; this.alive = false; this.hp = 100;
    this.path = null; this.pi = 0; this.repath = 0; this.target = null; this.seeT = 0; this.lastSeen = null; this.lastSeenT = -99;
    this.cool = 0; this.burst = 0; this.ammo = this.wdef.mag; this.reloadT = 0; this.aimErr = 0.1; this.react = 0;
    this.thinkT = Math.random() * 0.3; this.walk = 0; this.deadT = 0; this.respawnT = 1 + Math.random() * 3;
    this.goal = null; this.strafe = 0; this.strafeT = 0; this.nade = 15 + Math.random() * 20; this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.kills = 0; this.deaths = 0; this.baseSkill = (team === 1 ? 0.62 : 0.52) + Math.random() * 0.33; this.skill = this.baseSkill; this.isBot = true; this.crouch = false;
    this.model.visible = false; this.suppress = 0;
  }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 1.15 : 1.6), this.pos.z); }
  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.25, this.pos.z); }
  spawnAt(p) {
    this.pos.copy(p); this.alive = true; this.hp = 100; this.ammo = this.wdef.mag; this.reloadT = 0;
    this.model.visible = true; this.model.rotation.set(0, 0, 0); this.path = null; this.target = null; this.goal = null; this.react = 0.5;
  }
  hurt(d, now, from) {
    if (!this.alive) return;
    this.hp -= d; this.suppress = Math.min(1, this.suppress + 0.4); this.flinch = 1;
    if (from && from.alive && (!this.target || !this.target.alive || Math.random() < 0.5)) { this.lastSeen = from.pos.clone(); this.lastSeenT = now; this.alertBy = from; }
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.deadT = 0; this.respawnT = 7; this.deaths++; }
  }
  update(dt, now) {
    const g = this.g, m = this.model, U = m.userData;
    if (!this.alive) {
      this.deadT += dt;
      // fall over (simple procedural "ragdoll")
      const t = Math.min(1, this.deadT / 0.45);
      m.rotation.x = -t * t * Math.PI / 2 * (this.fallDir || 1);
      m.position.y = this.pos.y + Math.sin(t * Math.PI) * 0.15 - t * 0.1;
      if (this.deadT > 4) m.visible = false;
      this.respawnT -= dt;
      if (this.respawnT <= 0 && g.state === 'play') { const sp = g.spawnPointFor(this.team, this); if (sp) this.spawnAt(sp); }
      return;
    }
    this.suppress = Math.max(0, this.suppress - dt * 0.5);
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.22 + Math.random() * 0.1; this.think(now); }
    // ---- combat ----
    let moving = true;
    const T = this.target;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ammo = this.wdef.mag; }
    if (T && T.alive && this.seeT > 0) {
      const tp = T.isPlayer ? T.chestPos() : T.chest;
      const d = this.eye.distanceTo(tp);
      const wantYaw = Math.atan2(-(tp.x - this.pos.x), -(tp.z - this.pos.z));
      this.yaw = lerpAngle(this.yaw, wantYaw, Math.min(1, dt * 8));
      this.react -= dt;
      // keep distance: stop to shoot at range, strafe otherwise
      if ((d < 25 || ['dmr', 'sniper', 'sniper2', 'lmg', 'lmg2'].includes(this.wdef.type)) && !this.seekCover) moving = false;
      this.aimErr = Math.max(0.012 / this.skill, this.aimErr - dt * 0.12 * this.skill);
      this.cool -= dt;
      if (this.react <= 0 && this.cool <= 0 && this.reloadT <= 0) {
        if (this.ammo <= 0) { this.reloadT = this.wdef.reload * (this.wdef.perShell ? 4 : 1); }
        else {
          const w = this.wdef;
          g.fireBullet(this, this.muzzleWorld(), tp, w, this.aimErr * (1 + this.suppress * 1.5) + (moving ? 0.02 : 0));
          this.ammo--;
          this.cool = 60 / w.rpm * (w.auto ? 1 : 1.6 + Math.random() * 0.6);
          if (w.auto && --this.burst <= 0) { this.burst = 3 + Math.random() * 6 | 0; this.cool += 0.25 + Math.random() * 0.45; }
        }
      }
      this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = 0.6 + Math.random() * 1.2; this.strafe = this.seekCover ? 0 : Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.25) this.strafe = 0; this.crouch = !moving && Math.random() < 0.35; }
    } else { this.crouch = false; }
    // ---- grenade at last-known position behind cover ----
    this.nade -= dt;
    if (this.nade <= 0 && this.lastSeen && now - this.lastSeenT < 4 && (!T || this.seeT <= 0)) {
      const d = this.pos.distanceTo(this.lastSeen);
      if (d > 8 && d < 35) { g.throwGrenade(this, this.eye, this.lastSeen); }
      this.nade = 20 + Math.random() * 25;
    }
    // ---- locomotion ----
    let vx = 0, vz = 0; const sp = this.crouch ? 1.5 : (T && this.seeT > 0 ? 2.6 : 4.2);
    if (this.path && this.pi < this.path.length && (moving || !T)) {
      const n = this.path[this.pi];
      const dx = n.x - this.pos.x, dz = n.z - this.pos.z; const dd = Math.hypot(dx, dz);
      if (dd < 0.45) this.pi++;
      else { vx = dx / dd * sp; vz = dz / dd * sp; if (!(T && this.seeT > 0)) this.yaw = lerpAngle(this.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 6)); }
    }
    if (T && this.seeT > 0 && this.strafe) { const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw); vx += cy * this.strafe * 2; vz += -sy * this.strafe * 2; }
    this.tryMove(vx * dt, vz * dt);
    // ground follow (falls if floor destroyed)
    const gh = g.world.groundHeightAt(this.pos.x, this.pos.z, Math.floor((this.pos.y + 0.6) / VS));
    if (gh < this.pos.y - 0.05) { this.vy = (this.vy || 0) - 19 * dt; this.pos.y = Math.max(gh, this.pos.y + this.vy * dt); } else { this.pos.y = gh; this.vy = 0; }
    if (this.pos.y < -5) this.hurt(999, now, null);
    // stuck detection → repath
    if (now - (this.stuckCheck || 0) > 1.5) { this.stuckCheck = now; if (this.lastPos.distanceTo(this.pos) < 0.3 && this.path && !(T && this.seeT > 0)) { this.path = null; this.repath = 0; } this.lastPos.copy(this.pos); }
    // ---- animation ----
    const spd = Math.hypot(vx, vz);
    this.walk += spd * dt * 2.4;
    if (spd > 1 && Math.floor(this.walk / Math.PI) !== this.lastStep) { this.lastStep = Math.floor(this.walk / Math.PI); if (g.player.pos.distanceTo(this.pos) < 18) g.audio.play('step', this.pos, this.team === 1 ? 0.9 : 0.5, 0.85); }
    const sw = Math.sin(this.walk) * Math.min(1, spd / 3) * 0.7;
    U.legs[0].leg.rotation.x = sw; U.legs[1].leg.rotation.x = -sw;
    U.legs[0].shin.rotation.x = Math.max(0, -sw) * 1.2; U.legs[1].shin.rotation.x = Math.max(0, sw) * 1.2;
    U.hips.position.y = (this.crouch ? 0.6 : 0.9) + Math.abs(Math.cos(this.walk)) * 0.04 * Math.min(1, spd / 3);
    if (this.crouch) { U.legs[0].leg.rotation.x = -1.2; U.legs[0].shin.rotation.x = 1.9; U.legs[1].leg.rotation.x = -0.3; U.legs[1].shin.rotation.x = 1.5; }
    let pitch = 0; if (T && this.seeT > 0) { const tp = T.isPlayer ? T.chestPos() : T.chest; pitch = Math.atan2(tp.y - this.eye.y, Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z)); }
    this.flinch = Math.max(0, (this.flinch || 0) - dt * 6);
    U.arms.rotation.x = pitch + this.flinch * 0.35; U.head.rotation.x = pitch * 0.6 - this.flinch * 0.3; U.torso.rotation.x = -this.flinch * 0.15;
    m.position.copy(this.pos); m.rotation.set(0, this.yaw, 0);
    // recoil twitch
    U.gun.position.z = -0.38 + Math.max(0, this.cool - 60 / this.wdef.rpm * 0.5) * 0.0;
  }
  muzzleWorld() { const p = new THREE.Vector3(); this.model.userData.gun.userData.muzzle.getWorldPosition(p); return p; }
  tryMove(dx, dz) {
    const w = this.g.world, p = this.pos, r = 0.3, h = this.crouch ? 1.2 : 1.75;
    const hit = (x, y, z) => w.boxHits(x - r, y + 0.05, z - r, x + r, y + h, z + r);
    if (!hit(p.x + dx, p.y, p.z)) p.x += dx; else if (!hit(p.x + dx, p.y + VS + 0.01, p.z)) { p.x += dx; p.y += VS; }
    if (!hit(p.x, p.y, p.z + dz)) p.z += dz; else if (!hit(p.x, p.y + VS + 0.01, p.z + dz)) { p.z += dz; p.y += VS; }
  }
  think(now) {
    const g = this.g;
    // rubber-band: the team behind on tickets fights harder (keeps matches close and tense)
    if (g.tickets) { const deficit = g.tickets[1 - this.team] - g.tickets[this.team]; this.skill = this.baseSkill * (1 + 0.3 * Math.max(0, Math.min(1, deficit / 60))) * (this.team === 1 ? (g.diffMul || 1) : 1); }
    // perception: nearest visible enemy (incl. player & quantum decoys) within cone or recently alerted
    let best = null, bd = 1e9;
    const eye = this.eye;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    for (const e of g.entities) {
      if (!e.alive || e.team === this.team) continue;
      const ep = e.isPlayer ? e.chestPos() : e.chest;
      const dx = ep.x - eye.x, dz = ep.z - eye.z; const d = Math.hypot(dx, dz);
      if (d > 85) continue;
      const inCone = (dx * fx + dz * fz) / d > -0.2 || d < 8 || e === this.alertBy;
      if (!inCone) continue;
      // stealth: crouched far targets & tunnelling player harder to see
      if (e.isPlayer && (e.p.phased || g.spawnProtect > 0)) continue;
      if (d < bd && g.world.los(eye, ep)) { bd = d; best = e; }
    }
    if (best) {
      if (best !== this.target || this.seeT <= 0) { this.react = (0.25 + Math.random() * 0.35) / this.skill * (best.isPlayer && best.p.crouch ? 1.3 : 1); this.aimErr = 0.08 + bd * 0.0015; }
      this.target = best; this.seeT = 1; this.lastSeen = (best.isPlayer ? best.p.pos : best.pos).clone(); this.lastSeenT = now;
    } else { this.seeT = 0; if (this.target && (!this.target.alive)) this.target = null; }
    // take cover when hurt / suppressed / reloading: sample nearby nav cells hidden from the threat
    if (this.seekCover && (now > this.seekCover || (this.path && this.pi >= this.path.length))) { this.seekCover = 0; this.crouchHold = now + 1.5; }
    const threat = this.target && this.target.alive ? this.target : null;
    if (threat && !this.seekCover && now - (this.coverT || 0) > 4 && (this.hp < 50 || this.suppress > 0.6 || this.reloadT > 0)) {
      this.coverT = now;
      const te = threat.isPlayer ? threat.p.eye : threat.eye;
      let best = null, bs = 1e9;
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 7;
        const c = new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r);
        const h = g.nav.heightAt(c); if (h === null || Math.abs(h - this.pos.y) > 1) continue; c.y = h + 1.1;
        if (g.world.los(te, c)) continue;
        const sc = r + c.distanceTo(te) * -0.05; if (sc < bs) { bs = sc; best = c; }
      }
      if (best) { best.y -= 1.1; this.path = g.nav.path(this.pos, best); this.pi = 0; this.seekCover = now + 3; this.repath = 3.5; }
    }
    if (this.crouchHold && now < this.crouchHold && !this.seekCover) this.crouch = true;
    // objective: go to best flag (not ours), or chase last seen
    this.repath -= 0.25;
    if (this.repath <= 0 || !this.path || this.pi >= this.path.length) {
      this.repath = 4 + Math.random() * 3;
      let dest = null;
      if (this.lastSeen && now - this.lastSeenT < 6 && Math.random() < 0.5) dest = this.lastSeen;
      else {
        const flags = g.flags;
        let bestF = null, bs = -1e9;
        for (const f of flags) {
          const owned = f.owner === this.team && Math.abs(f.cap) >= 1;
          const d = Math.hypot(f.x - this.pos.x, f.z - this.pos.z);
          const danger = g.event && g.event.st === 'warn' && f.id === 'B' ? -200 : 0;
          const s = danger + (owned ? -40 : 30) - d * 0.6 + (this.goalF === f ? 15 : 0) + Math.random() * 25 + (f.contested ? 20 : 0);
          if (s > bs) { bs = s; bestF = f; }
        }
        this.goalF = bestF;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 6;
        dest = new THREE.Vector3(bestF.x + Math.cos(a) * r, 0, bestF.z + Math.sin(a) * r);
      }
      this.path = g.nav.path(this.pos, dest); this.pi = 0;
    }
  }
}
export function lerpAngle(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

// Ray vs soldier hitboxes (head sphere + body AABB). Returns {t, head}.
export function rayEntity(o, d, pos, crouch, maxT) {
  const hy = pos.y + (crouch ? 1.2 : 1.62);
  // head sphere r=0.17
  const ox = o.x - pos.x, oy = o.y - hy, oz = o.z - pos.z;
  const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - 0.17 * 0.17;
  const disc = b * b - c;
  let best = null;
  if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < maxT) best = { t, head: true }; }
  // body box
  const mn = [pos.x - 0.27, pos.y, pos.z - 0.27], mx = [pos.x + 0.27, pos.y + (crouch ? 1.05 : 1.45), pos.z + 0.27];
  let t0 = 0, t1 = maxT; const O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(D[i]) < 1e-9) { if (O[i] < mn[i] || O[i] > mx[i]) return best; continue; }
    let a = (mn[i] - O[i]) / D[i], bb = (mx[i] - O[i]) / D[i]; if (a > bb) [a, bb] = [bb, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, bb); if (t0 > t1) return best;
  }
  if (!best || t0 < best.t) best = { t: t0, head: false };
  return best;
}
