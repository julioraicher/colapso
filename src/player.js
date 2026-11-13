// First-person kinematic controller: axis-separated AABB vs voxel grid, auto step-up,
// sprint / crouch / slide, coyote time + jump buffering, headbob phase for the viewmodel,
// vault / mantle over obstacles up to 1.5 m (ledge grab up to 2 m while airborne), fall damage.
import * as THREE from 'three';
import { VS } from './world.js';

const R = 0.32, H_STAND = 1.75, H_CROUCH = 1.15, EYE_OFF = 0.12;
const FROZEN = { f: false, b: false, l: false, r: false, sprint: false, crouch: false, jump: false };
export class Player {
  constructor(world) {
    this.w = world;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.h = H_STAND; this.onGround = false;
    this.crouch = false; this.sprint = false; this.slideT = 0; this.coyote = 0; this.jumpBuf = 0;
    this.bob = 0; this.stepAcc = 0; this.landKick = 0;
    this.hp = 100; this.lastHurt = -99; this.alive = true; this.team = 0;
    this.speedMul = 1; this.ads = 0;
    this.regenDelay = 6; this.regenRate = 15;      // every class regenerates after a quiet spell
    this.vault = null; this.vaultK = 0; this.vaults = 0; this.groundY = 0; this.fallDmg = 0; this.evVault = 0; this.evLand = 0; this.frozen = false;
  }
  // the eye dips during a vault (hands on the ledge, knees tucked)
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + this.h - EYE_OFF - Math.sin(this.vaultK * Math.PI) * 0.24, this.pos.z); }
  spawn(p, yaw) { this.pos.copy(p); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.hp = 100; this.alive = true; this.h = H_STAND; this.vault = null; this.vaultK = 0; this.groundY = p.y; this.fallDmg = 0; this.crouch = false; this.slideT = 0; }
  collides(px, py, pz, h) { return this.w.boxHits(px - R, py, pz - R, px + R, py + h, pz + R); }

  // Obstacle straight ahead that can be climbed: returns the landing spot {x, y, z, h} or null.
  // maxUp: highest ledge above the feet; topLimit: absolute cap for the ledge top (airborne grabs).
  findLedge(maxUp, topLimit) {
    const p = this.pos, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    // first distance at which the body (above auto-step height) is blocked
    let d0 = -1;
    for (let d = 0.1; d <= 0.75; d += 0.1) if (this.collides(p.x + fx * d, p.y + 0.55, p.z + fz * d, this.h - 0.55)) { d0 = d; break; }
    if (d0 < 0) return null;
    const lx = p.x + fx * (d0 + 0.5), lz = p.z + fz * (d0 + 0.5);
    for (let k = Math.ceil((p.y + 0.6) / VS - 1e-4); k * VS <= p.y + maxUp + 0.02 && k * VS <= topLimit + 0.02; k++) {
      const ty = k * VS;
      if (this.collides(lx, ty + 0.02, lz, H_CROUCH)) continue;                 // no room on top at this level
      if (!this.collides(lx, ty - 0.2, lz, 0.18)) continue;                      // nothing to stand on (open air)
      if (this.collides(p.x, p.y + 0.05, p.z, ty - p.y + this.h)) return null;   // no headroom to rise
      return { x: lx, y: ty + 0.01, z: lz, h: ty - p.y };
    }
    return null;
  }
  startVault(L) {
    this.vault = { fx: this.pos.x, fy: this.pos.y, fz: this.pos.z, tx: L.x, ty: L.y, tz: L.z, t: 0, dur: 0.3 + Math.max(0, L.h - 1) * 0.16 };
    this.vel.set(0, 0, 0); this.jumpBuf = 0; this.coyote = 0; this.slideT = 0; this.evVault = L.h; this.vaults++;
    if (this.collides(L.x, L.y, L.z, H_STAND)) this.crouch = true;              // low ceiling up there: arrive crouched
  }
  // Scripted motion: rise first, then slide forward over the edge. No collision while it runs (the path was checked).
  updateVault(dt) {
    const v = this.vault; v.t += dt; const k = Math.min(1, v.t / v.dur);
    const up = Math.min(1, k / 0.7), ky = 1 - (1 - up) * (1 - up), q = Math.max(0, (k - 0.3) / 0.7), kx = q * q * (3 - 2 * q);
    this.pos.set(v.fx + (v.tx - v.fx) * kx, v.fy + (v.ty - v.fy) * ky, v.fz + (v.tz - v.fz) * kx);
    this.vaultK = k; this.sprint = true; this.onGround = false;
    const th = this.crouch ? H_CROUCH : H_STAND; this.h += (th - this.h) * Math.min(1, dt * 14);
    if (k >= 1) {
      this.vault = null; this.vaultK = 0; this.sprint = false; this.onGround = true; this.coyote = 0.1; this.groundY = this.pos.y;
      const sp = 3.6; this.vel.set(-Math.sin(this.yaw) * sp, 0, -Math.cos(this.yaw) * sp);
    }
  }

  update(dt, inp, now, onStep) {
    if (this.vault) { this.updateVault(dt); return; }
    if (this.frozen) inp = FROZEN;                 // pre-match countdown: look around, no movement
    // --- orientation handled by caller (mouse); here: movement ---
    const wantCrouch = inp.crouch;
    const fwd = (inp.f ? 1 : 0) - (inp.b ? 1 : 0), str = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    this.sprint = inp.sprint && fwd > 0 && !wantCrouch && this.ads < 0.5;
    // slide: crouch while sprinting on ground
    if (wantCrouch && !this.crouch && this.onGround && this.wasSprint && this.slideT <= 0) {
      this.slideT = 0.75;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 0.1) { this.vel.x *= 9.2 / hs; this.vel.z *= 9.2 / hs; }
    }
    this.wasSprint = this.sprint;
    // crouch height (only stand up if there's headroom)
    if (wantCrouch) this.crouch = true;
    else if (this.crouch && !this.collides(this.pos.x, this.pos.y, this.pos.z, H_STAND)) this.crouch = false;
    const th = this.crouch ? H_CROUCH : H_STAND;
    this.h += (th - this.h) * Math.min(1, dt * 14);

    let speed = this.crouch ? 2.3 : this.sprint ? 6.9 : 4.4;
    speed *= 1 - this.ads * 0.38;
    speed *= this.speedMul;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * str, wz = -cy * fwd - sy * str;
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }

    if (this.slideT > 0) {
      this.slideT -= dt;
      const f = Math.exp(-dt * 1.6); this.vel.x *= f; this.vel.z *= f;
      if (!wantCrouch) this.slideT = 0;
    } else {
      const accel = this.onGround ? 70 : 12;
      const tx = wx * speed, tz = wz * speed;
      const dx = tx - this.vel.x, dz = tz - this.vel.z; const dl = Math.hypot(dx, dz);
      const step = accel * dt;
      if (dl <= step) { this.vel.x = tx; this.vel.z = tz; } else { this.vel.x += dx / dl * step; this.vel.z += dz / dl * step; }
    }
    // gravity & jump (coyote + buffer)
    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    this.jumpBuf = inp.jump ? 0.12 : this.jumpBuf - dt;
    if (this.onGround) this.groundY = this.pos.y;
    // vault / mantle: jump while moving forward into an obstacle 1 to 1.5 m high (auto step-up covers 0.5 m);
    // airborne, a ledge up to 2 m above the take-off ground can still be grabbed.
    if (this.jumpBuf > 0 && fwd > 0) {
      const L = this.coyote > 0 ? this.findLedge(1.5, this.pos.y + 1.5) : this.vel.y < 4 ? this.findLedge(1.5, this.groundY + 2) : null;
      if (L && L.h >= (this.coyote > 0 ? 0.95 : 0.35)) { this.startVault(L); return; }
    }
    if (this.jumpBuf > 0 && this.coyote > 0) { this.vel.y = 6.4; this.jumpBuf = 0; this.coyote = 0; this.slideT = 0; }
    this.vel.y -= 19 * dt;
    if (this.vel.y < -40) this.vel.y = -40;

    // integrate with substeps (prevents tunnelling at high speeds)
    const n = Math.ceil(Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt / (VS * 0.45)) || 1;
    const sdt = dt / n; const wasGround = this.onGround; let vyBefore = this.vel.y;
    this.onGround = false;
    for (let i = 0; i < n; i++) this.move(sdt);
    if (this.onGround && !wasGround && vyBefore < -6) {
      this.landKick = Math.min(1, -vyBefore / 16); onStep && onStep(1.4); this.evLand = -vyBefore;
      if (vyBefore < -13) this.fallDmg = Math.min(70, (-vyBefore - 13) * 5);     // mild: a 6 m drop costs ~10, 10 m ~30
    }
    if (!this.onGround && this.pos.y < -10) { this.hp = 0; }

    // head bob / footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5 && this.slideT <= 0) {
      this.bob += hs * dt * 1.9;
      this.stepAcc += hs * dt;
      const stride = this.sprint ? 2.1 : 1.7;
      if (this.stepAcc > stride) { this.stepAcc = 0; onStep && onStep(this.crouch ? 0.3 : this.sprint ? 1 : 0.7); }
    }
    this.landKick *= Math.exp(-dt * 8);
    // health regen
    if (now - this.lastHurt > this.regenDelay && this.hp < 100 && this.alive) this.hp = Math.min(100, this.hp + this.regenRate * dt);
  }
  move(dt) {
    const p = this.pos, v = this.vel, h = this.h;
    // X
    let nx = p.x + v.x * dt;
    if (this.collides(nx, p.y, p.z, h)) {
      if ((this.onGround || this.coyote > 0) && !this.collides(nx, p.y + VS + 0.01, p.z, h)) { p.y += VS + 0.01; this.stepUp = 0.5; p.x = nx; }
      else v.x = 0;
    } else p.x = nx;
    // Z
    let nz = p.z + v.z * dt;
    if (this.collides(p.x, p.y, nz, h)) {
      if ((this.onGround || this.coyote > 0) && !this.collides(p.x, p.y + VS + 0.01, nz, h)) { p.y += VS + 0.01; this.stepUp = 0.5; p.z = nz; }
      else v.z = 0;
    } else p.z = nz;
    // Y
    let ny = p.y + v.y * dt;
    if (this.collides(p.x, ny, p.z, h)) {
      if (v.y < 0) { p.y = Math.ceil(ny / VS - 1e-4) * VS; if (this.collides(p.x, p.y, p.z, h)) p.y = Math.floor(ny / VS + 1) * VS; this.onGround = true; }
      v.y = 0;
    } else p.y = ny;
  }
  hurt(d, now) { if (!this.alive) return; this.hp -= d; this.lastHurt = now; if (this.hp <= 0) { this.hp = 0; this.alive = false; } }
}
