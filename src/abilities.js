// Quantum kit:
//  Q  TUNELAMENTO  – phase dash through matter. Barrier transmission T = exp(-2κd) (WKB, rectangular
//                    barrier); energy cost = C0 / T, so cost grows exponentially with wall thickness d.
//  E  SUPERPOSIÇÃO – split into |você⟩ + |eco⟩. The echo advances and fights; enemies can't tell which
//                    is real. Press E again to collapse the state onto the echo (you teleport there).
import * as THREE from 'three';
import { VS } from './world.js';
import { buildSoldier, lerpAngle } from './ai.js';
import { WEAPONS } from './weapons.js';

export const KAPPA = 0.42;          // 1/m – "barrier opacity" of matter for the gauntlet
export const C0 = 22;               // base cost (energy) at T = 1
export const E_MAX = 100;

// Find a wall in front of the player: returns {d (thickness m), exit (Vector3 feet pos), cost, T} or null
export function scanTunnel(world, p, yaw) {
  const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const fits = (x, y, z) => !world.boxHits(x - 0.32, y, z - 0.32, x + 0.32, y + 1.7, z + 0.32);
  const step = VS * 0.5;
  let entered = -1;
  for (let s = 0.3; s < 9; s += step) {
    const x = p.x + dir.x * s, z = p.z + dir.z * s;
    const blocked = !fits(x, p.y + 0.02, z);
    if (blocked && entered < 0) { if (s > 2.5) return null; entered = s; }
    if (!blocked && entered >= 0) {
      // exit found: snap to ground at exit
      let y = p.y + 0.02;
      for (let k = 0; k < 4 && !fits(x, y, z); k++) y += VS;
      const d = Math.max(VS, s - entered - 0.32);
      const T = Math.exp(-2 * KAPPA * d);
      return { d, T, cost: C0 / T, exit: new THREE.Vector3(x, y, z), dir };
    }
  }
  if (entered >= 0) return { d: 99, T: 0, cost: Infinity, exit: null, dir }; // too thick
  return null;
}

// The echo (decoy): a translucent copy that runs forward and engages enemies.
export class Echo {
  constructor(game) {
    this.g = game; this.team = 0; this.alive = false; this.isEcho = true; this.name = 'ECO';
    this.model = buildSoldier(0, 'rifle');
    const ghost = new THREE.MeshBasicMaterial({ color: 0x5ff3ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.model.traverse(o => { if (o.isMesh) o.material = ghost; });
    this.model.visible = false; game.scene.add(this.model);
    this.pos = new THREE.Vector3(); this.yaw = 0; this.hp = 60; this.t = 0; this.wdef = WEAPONS.k7; this.cool = 0; this.walk = 0; this.crouch = false;
  }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z); }
  get chest() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.25, this.pos.z); }
  start(pos, yaw, wdef) {
    this.pos.copy(pos); this.yaw = yaw; this.alive = true; this.hp = 60; this.t = 8; this.wdef = wdef; this.model.visible = true; this.cool = 0.4;
    // destination: farthest walkable point up to 18 m along view direction
    const dir = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    let dest = pos.clone();
    for (let s = 2; s <= 18; s += 1) { const q = pos.clone().addScaledVector(dir, s); if (this.g.nav.heightAt(q) === null) break; dest = q; }
    this.path = this.g.nav.path(pos, dest) || []; this.pi = 0;
  }
  hurt(d) { if (!this.alive) return; this.hp -= d; if (this.hp <= 0) { this.kill(true); } }
  kill(decohered) { if (!this.alive) return; this.alive = false; this.model.visible = false; this.g.fx.quantum(this.chest, 40, [0.4, 1, 1]); if (decohered) this.g.onEchoLost(); }
  update(dt, now) {
    if (!this.alive) return;
    this.t -= dt; if (this.t <= 0) { this.kill(true); return; }
    const g = this.g;
    // flicker (superposition shimmer)
    this.model.traverse(o => { if (o.isMesh) o.material.opacity = 0.35 + Math.random() * 0.3; });
    // target nearest visible enemy
    let best = null, bd = 60;
    for (const e of g.entities) { if (!e.alive || e.team === 0) continue; const d = e.pos.distanceTo(this.pos); if (d < bd && g.world.los(this.eye, e.chest)) { bd = d; best = e; } }
    let vx = 0, vz = 0;
    if (this.path && this.pi < this.path.length) {
      const n = this.path[this.pi]; const dx = n.x - this.pos.x, dz = n.z - this.pos.z; const dd = Math.hypot(dx, dz);
      if (dd < 0.4) this.pi++; else { vx = dx / dd * 5.2; vz = dz / dd * 5.2; if (!best) this.yaw = lerpAngle(this.yaw, Math.atan2(-dx, -dz), Math.min(1, dt * 8)); }
    }
    if (best) {
      this.yaw = lerpAngle(this.yaw, Math.atan2(-(best.pos.x - this.pos.x), -(best.pos.z - this.pos.z)), Math.min(1, dt * 10));
      this.cool -= dt;
      if (this.cool <= 0) { g.fireBullet(this, this.chest.add(new THREE.Vector3(0, 0.25, 0)), best.chest, this.wdef, 0.03, true); this.cool = 60 / this.wdef.rpm * 1.3; }
    }
    const w = g.world, p = this.pos;
    const hit = (x, y, z) => w.boxHits(x - 0.3, y + 0.05, z - 0.3, x + 0.3, y + 1.7, z + 0.3);
    if (!hit(p.x + vx * dt, p.y, p.z)) p.x += vx * dt; else if (!hit(p.x + vx * dt, p.y + VS + 0.01, p.z)) { p.x += vx * dt; p.y += VS; }
    if (!hit(p.x, p.y, p.z + vz * dt)) p.z += vz * dt; else if (!hit(p.x, p.y + VS + 0.01, p.z + vz * dt)) { p.z += vz * dt; p.y += VS; }
    p.y = w.groundHeightAt(p.x, p.z, Math.floor((p.y + 0.6) / VS));
    const U = this.model.userData; const spd = Math.hypot(vx, vz);
    this.walk += spd * dt * 2.4; const sw = Math.sin(this.walk) * Math.min(1, spd / 3) * 0.7;
    U.legs[0].leg.rotation.x = sw; U.legs[1].leg.rotation.x = -sw;
    this.model.position.copy(p); this.model.rotation.y = this.yaw;
  }
}
