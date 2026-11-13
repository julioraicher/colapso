// First-person kinematic controller: axis-separated AABB vs voxel grid, auto step-up,
// sprint / crouch / slide, coyote time + jump buffering, headbob phase for the viewmodel.
import * as THREE from 'three';
import { VS } from './world.js';

const R = 0.32, H_STAND = 1.75, H_CROUCH = 1.15, EYE_OFF = 0.12;
export class Player {
  constructor(world) {
    this.w = world;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.h = H_STAND; this.onGround = false;
    this.crouch = false; this.sprint = false; this.slideT = 0; this.coyote = 0; this.jumpBuf = 0;
    this.bob = 0; this.stepAcc = 0; this.landKick = 0;
    this.hp = 100; this.lastHurt = -99; this.alive = true; this.team = 0;
    this.speedMul = 1; this.ads = 0;
  }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + this.h - EYE_OFF, this.pos.z); }
  spawn(p, yaw) { this.pos.copy(p); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.hp = 100; this.alive = true; this.h = H_STAND; }
  collides(px, py, pz, h) { return this.w.boxHits(px - R, py, pz - R, px + R, py + h, pz + R); }

  update(dt, inp, now, onStep) {
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
    if (this.jumpBuf > 0 && this.coyote > 0) { this.vel.y = 6.4; this.jumpBuf = 0; this.coyote = 0; this.slideT = 0; }
    this.vel.y -= 19 * dt;
    if (this.vel.y < -40) this.vel.y = -40;

    // integrate with substeps (prevents tunnelling at high speeds)
    const n = Math.ceil(Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt / (VS * 0.45)) || 1;
    const sdt = dt / n; const wasGround = this.onGround; let vyBefore = this.vel.y;
    this.onGround = false;
    for (let i = 0; i < n; i++) this.move(sdt);
    if (this.onGround && !wasGround && vyBefore < -6) { this.landKick = Math.min(1, -vyBefore / 16); onStep && onStep(1.4); }
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
    if (now - this.lastHurt > 5 && this.hp < 100 && this.alive) this.hp = Math.min(100, this.hp + 22 * dt);
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
