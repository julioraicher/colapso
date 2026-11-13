// Bots: 2.5D navigation grid (1 m cells) + A*, perception with LOS, aim model with reaction time
// and settling error, objective logic for Conquest, grenade use against cover.
// Bots are class-based players: the class sets the weapon, the kit (rockets, crates, overwatch) and the behaviour;
// squads, shared sightings and the radio live in squad.js, reached through game.squads.
import * as THREE from 'three';
import { VS, SX, SZ, SY } from './world.js';
import { WEAPONS, CLASSES } from './weapons.js';
import { buildSoldier } from './soldier.js';
import { G, BASES } from './mapgen.js';

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
// Rigged, animated soldiers live in soldier.js; a Bot owns one (this.soldier) and shows its root as this.model.
export { buildSoldier };
let BOTS = [];

let _mk = null;
function MARKER() {
  if (_mk) return _mk;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#ff3b30'; x.strokeStyle = '#000'; x.lineWidth = 4; x.beginPath(); x.moveTo(8, 10); x.lineTo(56, 10); x.lineTo(32, 54); x.closePath(); x.stroke(); x.fill();
  _mk = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true, fog: false }); return _mk;
}
const NAMES = ['Vega', 'Orion', 'Kappa', 'Tau', 'Rho', 'Sigma', 'Lyra', 'Draco', 'Hydra', 'Quasar', 'Pulsar', 'Fermi', 'Bohr', 'Dirac', 'Planck', 'Higgs', 'Curie', 'Gauss', 'Euler', 'Noether', 'Pauli', 'Maxwell', 'Tesla', 'Lorentz'];
let nameI = 0;

// Class slot per team (index = slot in the team): the class decides the weapon, the kit and the behaviour.
const ROLES = ['assalto', 'engenheiro', 'suporte', 'assalto', 'recon', 'engenheiro', 'suporte', 'assalto'];
// Per weapon type: k = how slowly the aim walks onto the target, burst = [min, extra] rounds per burst, rng = engagement range (m).
const HANDLING = {
  rifle: { k: 1, burst: [3, 5], rng: 90 }, bullpup: { k: 1, burst: [3, 6], rng: 90 }, smg: { k: 0.9, burst: [4, 7], rng: 48 }, pdw: { k: 0.9, burst: [5, 8], rng: 42 },
  shotgun: { k: 0.8, burst: [1, 0], rng: 20 }, lmg: { k: 1.35, burst: [8, 9], rng: 90 }, lmg2: { k: 1.35, burst: [7, 8], rng: 90 },
  dmr: { k: 0.85, burst: [1, 0], rng: 105 }, sniper: { k: 0.75, burst: [1, 0], rng: 105 }, sniper2: { k: 0.75, burst: [1, 0], rng: 105 },
};
const _t = new THREE.Vector3(), _aim = new THREE.Vector3();

export class Bot {
  constructor(game, team, slot = 0) {
    this.g = game; this.team = team; this.name = NAMES[nameI++ % NAMES.length] + '-' + (10 + Math.random() * 89 | 0);
    this.cls = ROLES[slot % ROLES.length];
    const ws = CLASSES[this.cls].weapons, wid = ws[Math.random() * ws.length | 0];
    this.wid = wid; this.wdef = WEAPONS[wid]; this.hand = HANDLING[this.wdef.type] || HANDLING.rifle;
    BOTS = BOTS.filter(b => b.model.parent || (b.soldier.dispose(), false)); BOTS.push(this);   // frees the soldiers of a finished match
    this.soldier = buildSoldier({ team, weaponId: wid, seed: this.name, world: game.world }); this.model = this.soldier.root; game.scene.add(this.model);
    if (team === 1) { this.marker = new THREE.Sprite(MARKER()); this.marker.scale.set(0.45, 0.45, 1); this.marker.position.y = 2.3; this.marker.visible = false; this.model.add(this.marker); }
    this.pos = new THREE.Vector3(); this.yaw = 0; this.alive = false; this.hp = 100;
    this.path = null; this.pi = 0; this.repath = 0; this.target = null; this.seeT = 0; this.lastSeen = null; this.lastSeenT = -99;
    this.cool = 0; this.burst = 0; this.ammo = this.wdef.mag; this.reloadT = 0; this.aimErr = 0.1; this.react = 0;
    this.thinkT = Math.random() * 0.3; this.walk = 0; this.deadT = 0; this.respawnT = 1 + Math.random() * 3;
    this.goal = null; this.strafe = 0; this.strafeT = 0; this.nade = 15 + Math.random() * 20; this.stuckT = 0; this.lastPos = new THREE.Vector3();
    this.kills = 0; this.deaths = 0; this.baseSkill = (team === 1 ? 0.62 : 0.52) + Math.random() * 0.33; this.skill = this.baseSkill; this.isBot = true; this.crouch = false;
    this.model.visible = false; this.suppress = 0;
    // class kit and behaviour state
    this.rockets = 0; this.rpgT = 0; this.rpgCd = 0; this.rpgAim = null; this.crateCd = 10 + Math.random() * 25; this.heal = 0;
    this.aimX = 0; this.aimY = 0; this.holdT = 0; this.supT = 0; this.lookT = 0; this.lookYaw = 0; this.fleeT = 0; this.heardT = -9; this.heard = new THREE.Vector3();
    this.squad = null; this.goalP = null; this.goalF = null; this.arrT = 0; this.waitT = 0; this.holdDur = 0; this.holdYaw = null; this.holdCrouch = false; this.crouchHold = 0;
    this.vant = null; this.vantP = null; this.vantUntil = 0; this.shotsHere = 0; this.relocN = 4; this.relocT = 0;
    this.vx = 0; this.vz = 0; this.lastHurtT = -9; this.hopT = 0; this.elite = false; this.dash = null;
  }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + (this.crouch ? 1.15 : 1.6), this.pos.z); }
  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.25, this.pos.z); }
  spawnAt(p) {
    this.pos.copy(p); this.alive = true; this.hp = 100; this.ammo = this.wdef.mag; this.reloadT = 0;
    this.model.visible = true; this.soldier.respawn(); this.lastAnim = null; this.lastHit = null; this.aimHold = 0; this.path = null; this.target = null; this.goal = null; this.react = 0.5;
    const now = this.g.time;
    this.rockets = this.cls === 'engenheiro' ? 2 : 0; this.rpgT = 0; this.rpgCd = now + 5 + Math.random() * 8; this.heal = this.cls === 'assalto' ? 1 : 0; this.crateCd = Math.max(this.crateCd, now + 5 + Math.random() * 8);
    this.seeT = 0; this.lastSeen = null; this.arrT = 0; this.goalP = null; this.vant = null; this.shotsHere = 0; this.fleeT = 0; this.holdT = 0; this.supT = 0; this.dash = null; this.seekCover = 0; this.suppress = 0; this.vy = 0;
  }
  hurt(d, now, from, info) {
    if (!this.alive) return;
    this.hp -= d; this.suppress = Math.min(1, this.suppress + 0.4); this.flinch = 1; this.onHit(d, from, info); this.lastHurtT = now;
    if (from && from.alive && (!this.target || !this.target.alive || Math.random() < 0.5)) { this.lastSeen = from.pos.clone(); this.lastSeenT = now; this.alertBy = from; }
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.deadT = 0; this.respawnT = 7; this.deaths++; }
    else if (this.hp < 35) this.g.squads.say(this, 'help', 'ESTOU FERIDO! PRECISO DE APOIO!', 30);
  }
  update(dt, now) {
    const g = this.g, m = this.model;
    if (!this.alive) {
      this.deadT += dt;
      // scripted death with weight (soldier.js): the body lies for about 6 s, then sinks and hides itself
      if (m.visible) { if (!this.soldier.dead) this.fall(); this.soldier.update(dt, null); }
      this.respawnT -= dt;
      if (this.respawnT <= 0 && g.state === 'play') { const sp = g.spawnPointFor(this.team, this); if (sp) this.spawnAt(sp); }
      return;
    }
    const frozen = g.countdown > 0;                       // pre-match countdown: stand ready
    this.suppress = Math.max(0, this.suppress - dt * 0.5);
    this.thinkT -= dt;
    if (this.thinkT <= 0 && !frozen && !this.dash) { this.thinkT = 0.22 + Math.random() * 0.1; this.think(now); }
    // ---- combat ----
    let moving = true;
    const T = this.target, see = !frozen && !this.dash && this.rpgT <= 0 && !!T && T.alive && this.seeT > 0;
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.ammo = this.wdef.mag; }
    this.cool -= dt;
    if (this.dash) { g.squads.updateDash(this, dt); moving = false; }
    else if (this.rpgT > 0) {
      // engineer: shoulders the launcher and holds still before firing (the wind-up is the warning)
      const a = this.rpgAim; moving = false; this.aimHold = 1.4;
      this.yaw = lerpAngle(this.yaw, Math.atan2(-(a.x - this.pos.x), -(a.z - this.pos.z)), Math.min(1, dt * 9));
      if ((this.rpgT -= dt) <= 0) { this.rockets--; g.squads.tally.rockets[this.team]++; g.fireBullet(this, this.muzzleWorld(), a, WEAPONS.rpg, 0.01 / this.skill); this.cool = 0.9; this.react = Math.max(this.react, 0.4); }
    } else if (see) {
      const tp = T.isPlayer ? T.chestPos() : T.chest, eye = this.eye, H = this.hand;
      const dx = tp.x - eye.x, dz = tp.z - eye.z, d = eye.distanceTo(tp);
      this.yaw = lerpAngle(this.yaw, Math.atan2(-(tp.x - this.pos.x), -(tp.z - this.pos.z)), Math.min(1, dt * 8));
      this.react -= dt;
      const reloc = now < this.relocT;
      // keep distance: stop to shoot inside the weapon's range; assault keeps pushing, a relocating sniper keeps walking
      if (!this.seekCover && !reloc && d <= H.rng && (d < 25 || this.cls === 'recon' || this.cls === 'suporte') && !(this.cls === 'assalto' && d > 16 && this.hp > 55)) moving = false;
      // humanised aim: the offset walks onto the target (slower for heavy weapons, under fire and on the move) and trails a strafing one
      const tvx = T.isPlayer ? T.p.vel.x : T.vx || 0, tvz = T.isPlayer ? T.p.vel.z : T.vz || 0;
      const lag = -(tvz * dx - tvx * dz) / Math.max(1, Math.hypot(dx, dz)) * (0.05 / this.skill) / Math.max(4, d);
      const kk = Math.min(1, dt * (0.9 + 1.2 * this.skill) / H.k * (1 - 0.5 * this.suppress) * (moving ? 0.65 : 1) * (this.react > 0 ? 0.5 : 1));
      this.aimX += (lag - this.aimX) * kk; this.aimY -= this.aimY * kk;
      if (this.react <= 0 && this.cool <= 0 && this.reloadT <= 0 && !(reloc && d > 20)) {
        if (this.ammo <= 0) this.reload();
        else if (d > H.rng * 1.15) { /* out of reach for this weapon: hold fire, think() closes the distance */ }
        else if (!g.world.los(eye, tp)) this.loseSight(now);   // slipped behind cover between two looks: no shooting (or tracking) through walls
        else this.shoot(tp, d, moving, 0);
      }
      this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeT = 0.6 + Math.random() * 1.2; this.strafe = this.seekCover || this.cls === 'recon' ? 0 : Math.random() < 0.5 ? -1 : 1; if (Math.random() < 0.25) this.strafe = 0; this.crouch = !moving && Math.random() < (this.cls === 'recon' || this.cls === 'suporte' ? 0.6 : 0.35); }
    } else if (!frozen) {
      const ls = this.lastSeen;
      if (ls && now < this.holdT && now - this.lastSeenT < 7) {
        // lost sight: keep the angle on the last known position (never the true one); support keeps that cover under fire
        this.yaw = lerpAngle(this.yaw, Math.atan2(-(ls.x - this.pos.x), -(ls.z - this.pos.z)), Math.min(1, dt * 6)); this.aimHold = 1.4;
        if (this.cls !== 'assalto') moving = false;
        if (this.supT > 0) {
          this.supT -= dt;
          if (this.cool <= 0 && this.reloadT <= 0 && this.ammo > 0) { _t.set(ls.x + (Math.random() - 0.5) * 1.2, ls.y + 0.8 + Math.random() * 0.6, ls.z + (Math.random() - 0.5) * 1.2); this.shoot(_t, this.eye.distanceTo(_t), false, 0.015); }
        }
      } else if (now < this.lookT) this.yaw = lerpAngle(this.yaw, this.lookYaw, Math.min(1, dt * 5));                                   // a noise: look that way
      else if (this.arrT && this.holdYaw !== null) this.yaw = lerpAngle(this.yaw, this.holdYaw + Math.sin(now * 0.7 + this.baseSkill * 40) * 0.5, Math.min(1, dt * 3));   // on station: scan the sector
      this.crouch = !!(this.arrT && this.holdCrouch) || now < this.crouchHold;
    }
    // ---- grenade at last-known position behind cover ----
    this.nade -= dt;
    if (!frozen && this.nade <= 0 && this.lastSeen && now - this.lastSeenT < 4 && !see && this.rpgT <= 0 && !this.dash) {
      const d = this.pos.distanceTo(this.lastSeen);
      if (d > 8 && d < 35) { g.throwGrenade(this, this.eye, this.lastSeen); g.squads.say(this, 'nade', 'GRANADA!', 9); }
      this.nade = (20 + Math.random() * 25) * (this.cls === 'assalto' ? 0.65 : 1);
    }
    // ---- locomotion ----
    let vx = 0, vz = 0; const sp = this.crouch ? 1.5 : see ? 2.6 : now < this.fleeT ? 5 : this.cls === 'assalto' ? 4.5 : 4.2;
    if (!frozen && moving && this.path && this.pi < this.path.length) {
      const n = this.path[this.pi];
      const dx = n.x - this.pos.x, dz = n.z - this.pos.z; const dd = Math.hypot(dx, dz);
      if (dd < 0.45) this.pi++;
      else { vx = dx / dd * sp; vz = dz / dd * sp; if (!see && now >= this.lookT && now >= this.holdT) this.yaw = lerpAngle(this.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 6)); }
    }
    if (see && this.strafe) { const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw); vx += cy * this.strafe * 2; vz += -sy * this.strafe * 2; }
    this.tryMove(vx * dt, vz * dt);
    // ground follow (falls if floor destroyed)
    const gh = g.world.groundHeightAt(this.pos.x, this.pos.z, Math.floor((this.pos.y + 0.6) / VS));
    if (gh < this.pos.y - 0.05) { this.vy = (this.vy || 0) - 19 * dt; this.pos.y = Math.max(gh, this.pos.y + this.vy * dt); } else { this.pos.y = gh; this.vy = 0; }
    if (this.pos.y < -5) this.hurt(999, now, null);
    // stuck on the way somewhere → try to climb what is in the way (up to 1 m), then repath
    if (now - (this.stuckCheck || 0) > 1.5) {
      this.stuckCheck = now;
      if (this.lastPos.distanceTo(this.pos) < 0.3 && moving && !frozen && this.path && this.pi < this.path.length && !see) { if (now > this.hopT + 2) this.hopT = now + 1.2; else { this.path = null; this.repath = 0; } }
      this.lastPos.copy(this.pos);
    }
    // ---- animation ----
    const spd = Math.hypot(vx, vz);
    this.walk += spd * dt * 2.4;
    if (spd > 1 && Math.floor(this.walk / Math.PI) !== this.lastStep) { this.lastStep = Math.floor(this.walk / Math.PI); if (g.player.pos.distanceTo(this.pos) < 18) g.audio.play('step', this.pos, this.team === 1 ? 0.9 : 0.5, 0.85); }
    let pitch = 0; if (T && this.seeT > 0) { const tp = T.isPlayer ? T.chestPos() : T.chest; pitch = Math.atan2(tp.y - this.eye.y, Math.hypot(tp.x - this.pos.x, tp.z - this.pos.z)); this.aimHold = 1.4; } else this.aimHold = (this.aimHold || 0) - dt;
    this.flinch = Math.max(0, (this.flinch || 0) - dt * 6);
    // the soldier animates itself from what the body really did (blocked bots do not walk on the spot)
    const S = this.pose || (this.pose = { pos: this.pos, alive: true }), lp = this.lastAnim || (this.lastAnim = this.pos.clone()), idt = dt > 1e-4 ? 1 / dt : 0;
    S.yaw = this.yaw; S.vx = (this.pos.x - lp.x) * idt; S.vz = (this.pos.z - lp.z) * idt; lp.copy(this.pos);
    S.crouch = this.crouch; S.aiming = this.aimHold > 0; S.aimPitch = pitch; S.ammo = this.ammo;
    S.reload01 = this.reloadT > 0 ? 1 - this.reloadT / (this.wdef.reload * (this.wdef.perShell ? 4 : 1)) : -1;
    this.soldier.world = g.world; this.soldier.update(dt, S);
    if (this.team === 0) (this.soldier.label || this.soldier.setLabel(this.name)).visible = g.player.pos.distanceToSquared(this.pos) < 625;   // name plate on teammates within 25 m
    this.vx = S.vx; this.vz = S.vz;                       // real velocity: other bots' aim trails it
  }
  muzzleWorld() { return this.soldier.muzzleWorld(); }
  // One shot (or one shotgun blast) at tp. The aim point is offset by (aimX, aimY) radians, so the first rounds of an
  // engagement land beside the target and walk onto it; the scatter grows with range, movement and suppression.
  shoot(tp, d, moving, extra) {
    const g = this.g, w = this.wdef, H = this.hand, mz = this.muzzleWorld();
    const dx = tp.x - mz.x, dz = tp.z - mz.z, dh = Math.hypot(dx, dz) || 1;
    _aim.set(tp.x - dz / dh * this.aimX * d, tp.y + this.aimY * d, tp.z + dx / dh * this.aimX * d);
    const sp = (0.008 + d * 0.00008) / this.skill * (1 + this.suppress * 1.2) + (moving ? 0.015 : 0) + extra + (w.pellets > 1 ? w.spreadAds * 0.8 : 0);
    g.fireBullet(this, mz, _aim, w, sp);
    this.ammo--; this.shotsHere++;
    this.aimX += (Math.random() - 0.5) * w.recoilH * 1.2; this.aimY += w.recoilV * 0.06;   // recoil nudges the aim: long bursts wander
    this.cool = 60 / w.rpm * (w.auto ? 1 : 1.6 + Math.random() * 0.6);
    if (w.auto && --this.burst <= 0) { this.burst = H.burst[0] + (Math.random() * H.burst[1] | 0); this.cool += this.cls === 'suporte' ? 0.2 + Math.random() * 0.3 : 0.25 + Math.random() * 0.45; }
  }
  reload() { this.reloadT = this.wdef.reload * (this.wdef.perShell ? 4 : 1); this.g.squads.say(this, 'reload', 'RECARREGANDO!', 20); }
  // The target is no longer visible: hold the angle for a moment; support suppresses the spot.
  loseSight(now) {
    this.seeT = 0;
    this.holdT = now + (this.cls === 'recon' ? 5 : this.cls === 'assalto' ? 0.6 : 1.8);
    this.supT = this.cls === 'suporte' && this.ammo > 10 && this.reloadT <= 0 ? 1.4 + Math.random() : 0;
  }
  // Engineer: a rocket for enemies bunched together, or for whatever the last seen enemy is hiding behind.
  considerRocket(now, best, bd) {
    const g = this.g; let aim = null;
    if (best) {
      if (bd > 14 && bd < 60) { let n = 0; for (const e of g.entities) if (e.alive && e.team !== this.team && !e.isEcho && e.pos.distanceToSquared(best.pos) < 30) n++; if (n >= 2) aim = best.pos.clone(); }
    } else if (this.lastSeen && now - this.lastSeenT < 3.5 && now - this.lastSeenT > 0.6) {
      const d = this.pos.distanceTo(this.lastSeen);
      if (d > 12 && d < 55) aim = this.lastSeen.clone().setY(this.lastSeen.y + 0.9);
    }
    if (!aim) return;
    for (const e of g.entities) if (e.alive && e.team === this.team && e !== this && e.pos.distanceToSquared(aim) < 49) return;   // friends inside the blast
    const eye = this.eye, dir = aim.clone().sub(eye), L = dir.length(), h = g.world.raycast(eye, dir.divideScalar(L), L);
    if (h && h.dist < 8) return;                                                                                              // it would go off in our own face
    this.rpgAim = aim; this.rpgT = 0.9; this.rpgCd = now + (16 + Math.random() * 12) / (this.team === 1 ? Math.min(1.2, g.diffMul || 1) : 1);
    g.audio.play('draw', this.pos, 1.2, 0.7); g.squads.say(this, 'rpg', 'FOGUETE SAINDO!', 12);
  }
  // Support: a supply crate on a contested objective, next to hurt teammates, or by a player who is running dry.
  considerCrate(now) {
    const g = this.g, F = this.squad && this.squad.goalF; let ok = false;
    if (F && Math.hypot(F.x - this.pos.x, F.z - this.pos.z) < 8 && (F.contested || !(F.owner === this.team && Math.abs(F.cap) >= 1))) ok = true;
    if (!ok) for (const b of g.bots) if (b !== this && b.alive && b.team === this.team && b.hp < 60 && b.pos.distanceToSquared(this.pos) < 64) { ok = true; break; }
    if (!ok && this.team === 0 && g.player.alive && g.weapons && g.player.pos.distanceToSquared(this.pos) < 144 && (g.player.hp < 55 || g.weapons.primary.reserve < WEAPONS[g.weapons.primary.id].mag)) ok = true;
    if (!ok) { this.crateCd = now + 2.5; return; }
    this.crateCd = now + 40 + Math.random() * 15; g.squads.dropCrate(this);
    g.squads.say(this, 'crate', 'SUPRIMENTOS NO CHÃO!', 20);
  }
  // Nearest friendly heal source within 28 m (supply pod or crate), as a destination.
  healSpot() {
    const g = this.g, p = this.pos; let bx = 0, bz = 0, bd = 28 * 28;
    const see = (x, z) => { const d = (x - p.x) ** 2 + (z - p.z) ** 2; if (d < bd) { bd = d; bx = x; bz = z; } };
    if (this.team === 0) { for (const P of g.callins.pods) if (P.landed) see(P.x, P.z); for (const c of g.gadgets) if (c.kind === 'crate' && c.landed) see(c.p.x, c.p.z); }
    else for (const c of g.squads.crates) see(c.p.x, c.p.z);
    return bd < 28 * 28 ? new THREE.Vector3(bx, 0, bz) : null;
  }
  // Where trouble is expected from: the latest enemy sighting of the team, otherwise the enemy base.
  threatYaw(p) { const I = this.g.squads.intel[this.team], q = I.length ? I[I.length - 1] : BASES[1 - this.team]; return Math.atan2(-(q.x - p.x), -(q.z - p.z)); }
  // model side of a hit: directional flinch, and what the death animation needs to know about the last hit.
  // info (optional 4th argument of hurt): { head: bool } for bullets, { blast: Vector3 centre } for explosions.
  onHit(d, from, info) {
    const c = (info && info.blast && info.blast.isVector3 && info.blast) || (from && from.pos); let dx = 0, dz = 0;
    if (c) { dx = this.pos.x - c.x; dz = this.pos.z - c.z; }
    this.soldier.hit(dx, dz, Math.min(1.2, 0.35 + d / 60));
    this.lastHit = { dx, dz, blast: !!(info && info.blast), head: !!(info && info.head), power: d };
  }
  // start the death animation: pushed away from the last hit, as far as level ground goes
  fall() {
    const h = this.lastHit || {}, w = this.g.world, p = this.pos, l = Math.hypot(h.dx || 0, h.dz || 0); let room = 3.5;
    if (l > 1e-3) {
      const ux = h.dx / l, uz = h.dz / l, vy = Math.floor((p.y + 0.6) / VS);
      for (let s = 0.5; s <= 3.5; s += 0.5) {
        const x = p.x + ux * s, z = p.z + uz * s;
        if (w.boxHits(x - 0.25, p.y + 0.3, z - 0.25, x + 0.25, p.y + 1.1, z + 0.25) || Math.abs(w.groundHeightAt(x, z, vy) - p.y) > 0.3) { room = s - 0.4; break; }
      }
    }
    this.soldier.die({ dx: h.dx, dz: h.dz, blast: h.blast, head: h.head, power: h.power, room }); this.lastHit = null;
  }
  tryMove(dx, dz) {
    const w = this.g.world, p = this.pos, r = 0.3, h = this.crouch ? 1.2 : 1.75;
    const hit = (x, y, z) => w.boxHits(x - r, y + 0.05, z - r, x + r, y + h, z + r);
    const hop = this.g.time < this.hopT && !hit(p.x, p.y + 2 * VS + 0.01, p.z);   // stuck against something low: climb up to 1 m
    if (!hit(p.x + dx, p.y, p.z)) p.x += dx; else if (!hit(p.x + dx, p.y + VS + 0.01, p.z)) { p.x += dx; p.y += VS; } else if (hop && !hit(p.x + dx, p.y + 2 * VS + 0.01, p.z)) { p.x += dx; p.y += 2 * VS; }
    if (!hit(p.x, p.y, p.z + dz)) p.z += dz; else if (!hit(p.x, p.y + VS + 0.01, p.z + dz)) { p.z += dz; p.y += VS; } else if (hop && !hit(p.x, p.y + 2 * VS + 0.01, p.z + dz)) { p.z += dz; p.y += 2 * VS; }
  }
  think(now) {
    const g = this.g, sq = g.squads;
    // rubber-band: the team that is behind fights harder (keeps matches close and tense)
    this.skill = this.baseSkill * (1 + 0.3 * g.rules.deficit(this.team)) * (this.team === 1 ? (g.diffMul || 1) : 1);
    // perception: nearest visible enemy (incl. player & quantum decoys) within cone or recently alerted
    let best = null, bd = 1e9;
    const eye = this.eye, range = this.cls === 'recon' ? 100 : 85;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    for (const e of g.entities) {
      if (!e.alive || e.team === this.team) continue;
      const ep = e.isPlayer ? e.chestPos() : e.chest;
      const dx = ep.x - eye.x, dz = ep.z - eye.z; const d = Math.hypot(dx, dz);
      if (d > range) continue;
      const inCone = (dx * fx + dz * fz) / d > -0.2 || d < 8 || e === this.alertBy;
      if (!inCone) continue;
      // stealth: crouched far targets & tunnelling player harder to see
      if (e.isPlayer && (e.p.phased || g.spawnProtect > 0)) continue;
      if (d < bd && g.world.los(eye, ep)) { bd = d; best = e; }
    }
    const had = this.seeT > 0, prev = this.target;
    if (best) {
      if (best !== prev || !had) {
        this.react = (0.25 + Math.random() * 0.35) / this.skill * (best.isPlayer && best.p.crouch ? 1.3 : 1) * (this.cls === 'recon' ? 1.2 : 1);
        // the first shots land wide (more with range and with heavy weapons), mostly beside and short of the target
        const e0 = Math.min(0.14, (0.03 + bd * 0.0012) * this.hand.k / this.skill);
        this.aimX = (Math.random() < 0.5 ? -1 : 1) * e0 * (0.6 + Math.random() * 0.4); this.aimY = -e0 * Math.random() * 0.5;
        this.burst = this.hand.burst[0] + (Math.random() * this.hand.burst[1] | 0);
        if (this.team === 0) {
          let f = null; for (const q of g.flags) if ((q.x - best.pos.x) ** 2 + (q.z - best.pos.z) ** 2 < 81) f = q;
          if (f) sq.say(this, 'foe' + f.id, f.hill ? 'INIMIGO NO REATOR!' : `INIMIGO NO PONTO ${f.id}!`, 25, false);
          else if (best.cls === 'recon' && bd > 30) sq.say(this, 'sniper', 'ATIRADOR INIMIGO À VISTA!', 30);
          else sq.say(this, 'contact', 'CONTATO! INIMIGO À VISTA!', 30);
        }
      }
      this.target = best; this.seeT = 1; this.lastSeen = (best.isPlayer ? best.p.pos : best.pos).clone(); this.lastSeenT = now;
      sq.report(this.team, this.lastSeen, now);
      if (this.team === 0 && best.isBot) best.spottedT = Math.max(best.spottedT || 0, 1.2);   // what a teammate sees shows on the minimap
    } else {
      if (had && prev && prev.alive) this.loseSight(now);
      this.seeT = 0; if (this.target && (!this.target.alive)) this.target = null;
      if (now - this.heardT < 1 && now >= this.holdT) { this.lookT = now + 1.6; this.lookYaw = Math.atan2(-(this.heard.x - this.pos.x), -(this.heard.z - this.pos.z)); }
    }
    // danger: shells about to land here, a grenade at the feet → run
    if (now >= this.fleeT) {
      const Z = g.callins.dangerAt(this.pos, this.team); let ax = 0, az = 0, run = 0;
      if (Z && Z.t < (Z.team === 0 ? 1.5 * Math.min(1.2, this.skill + 0.3) : 4.6)) { ax = this.pos.x - Z.c.x; az = this.pos.z - Z.c.z; run = Z.R + 7; sq.say(this, 'arty', 'ARTILHARIA! SAIAM DA ÁREA!', 15); }
      else for (const gr of g.grenades) if (gr.t < 1.7 && gr.owner.team !== this.team && gr.p.distanceToSquared(this.pos) < 30) { ax = this.pos.x - gr.p.x; az = this.pos.z - gr.p.z; run = 8; sq.say(this, 'nade', 'GRANADA!', 9); break; }
      if (run) {
        const l = Math.hypot(ax, az) || 1;
        this.path = g.nav.path(this.pos, _t.set(this.pos.x + ax / l * run, 0, this.pos.z + az / l * run)); this.pi = 0;
        this.fleeT = now + (Z ? 3.5 : 1.6); this.repath = 5; this.arrT = 0; this.seekCover = 0; this.rpgT = 0; return;
      }
    }
    // take cover when hurt / suppressed / reloading: sample nearby nav cells hidden from the threat
    if (this.seekCover && (now > this.seekCover || (this.path && this.pi >= this.path.length))) { this.seekCover = 0; this.crouchHold = now + 1.5; }
    const threat = this.target && this.target.alive ? this.target : null;
    if (threat && !this.seekCover && now - (this.coverT || 0) > 4 && (this.hp < 50 || this.suppress > 0.6 || this.reloadT > 0)) {
      this.coverT = now;
      const te = threat.isPlayer ? threat.p.eye : threat.eye;
      let spot = null, bs = 1e9;
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 7;
        const c = new THREE.Vector3(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r);
        const h = g.nav.heightAt(c); if (h === null || Math.abs(h - this.pos.y) > 1) continue; c.y = h + 1.1;
        if (g.world.los(te, c)) continue;
        const sc = r + c.distanceTo(te) * -0.05; if (sc < bs) { bs = sc; spot = c; }
      }
      if (spot) { spot.y -= 1.1; this.path = g.nav.path(this.pos, spot); this.pi = 0; this.seekCover = now + 3; this.repath = 3.5; this.arrT = 0; }
    }
    // class kit
    if (this.cls === 'engenheiro') { if (this.rockets > 0 && now > this.rpgCd && this.rpgT <= 0 && this.reloadT <= 0 && !this.seekCover) this.considerRocket(now, best, bd); }
    else if (this.cls === 'suporte') { if (now > this.crateCd) this.considerCrate(now); }
    else if (this.heal > 0 && this.hp < 45 && !best && now - this.lastHurtT > 1.2) { this.heal--; this.hp = Math.min(100, this.hp + 45); }   // assault: adrenaline shot
    if (this.elite && !best && this.team === 1 && sq.tryDash(this, now)) return;
    if (this.rpgT > 0) return;
    // objective: the squad's goal (flag or hunting ground); chase a fresh contact, heal up when hurt, hold when there
    this.repath -= 0.25;
    const S = this.squad, P = S ? S.goalP : null;
    const arrived = !this.path || this.pi >= this.path.length;
    if (arrived && !this.arrT && this.path) { this.arrT = now; this.waitT = now + this.holdDur; }
    const relocate = this.cls === 'recon' && !!this.vant && this.shotsHere >= this.relocN;   // a few shots from one spot, then move
    if (this.repath <= 0 || !this.path || P !== this.goalP || relocate || (arrived && now > this.waitT)) {
      if (relocate) { this.vant = null; this.shotsHere = 0; this.relocT = now + 4; sq.say(this, 'reloc', 'MUDANDO DE POSIÇÃO.', 40); }
      this.repath = 4 + Math.random() * 3; this.arrT = 0; this.goalP = P; this.goalF = S ? S.goalF : null; this.holdDur = 0; this.holdYaw = null; this.holdCrouch = false;
      let dest = null;
      if (this.hp < 55 && !best) dest = this.healSpot();
      if (!dest && best && bd > this.hand.rng) dest = this.lastSeen;                                                  // out of reach for this weapon: close in
      if (!dest && !relocate && this.lastSeen && now - this.lastSeenT < 6 && Math.random() < (this.cls === 'assalto' ? 0.65 : this.cls === 'recon' ? 0.1 : 0.45)) dest = this.lastSeen;   // hunt the last contact
      if (!dest && !best && now - this.heardT < 3 && Math.random() < 0.3) dest = this.heard;                        // investigate a noise
      if (!dest && P) {
        if (this.cls === 'recon') {
          // overwatch: a spot with a long view of the objective
          if (!this.vant || this.vantP !== P || now > this.vantUntil) {
            this.vant = sq.vantage(P, this); this.vantP = P; this.vantUntil = now + 28 + Math.random() * 12; this.shotsHere = 0; this.relocN = 3 + (Math.random() * 3 | 0);
          }
          if (this.vant) { dest = this.vant; this.holdDur = 30; this.holdYaw = Math.atan2(-(P.x - dest.x), -(P.z - dest.z)); this.holdCrouch = true; }
        }
        if (!dest) {
          const inside = Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < 8, a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 5;
          dest = _t.set(P.x + Math.cos(a) * r, 0, P.z + Math.sin(a) * r);
          if (inside) { this.holdDur = 4 + Math.random() * 6; this.holdYaw = this.threatYaw(dest); this.holdCrouch = Math.random() < 0.45; }   // on the objective: pick a spot and hold it
        }
      }
      if (dest) { this.path = g.nav.path(this.pos, dest); this.pi = 0; }
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
