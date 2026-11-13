// Call-in rewards earned with score: [4] UAV sweep, [5] artillery barrage, [6] supply pod, plus the enemy team's
// occasional artillery strike. Every reward has its own meter that fills with the player's points (they survive death)
// and empties when the reward is used. Blasts go through game.explode(); this module owns only its own visuals
// (marker columns of light, the falling shells' streaks, the pod).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VS, SX, SZ } from './world.js';
import { WEAPONS } from './weapons.js';
import { Beams } from './fx.js';

export const STREAKS = [
  { id: 'uav', key: '4', name: 'VARREDURA UAV', short: 'UAV', cost: 600 },
  { id: 'arty', key: '5', name: 'BARRAGEM DE ARTILHARIA', short: 'ARTILHARIA', cost: 1400 },
  { id: 'pod', key: '6', name: 'CÁPSULA DE SUPRIMENTOS', short: 'CÁPSULA', cost: 900 },
];
export const UAV_T = 20;
const UAV_PULSE = 2.5, ARTY_DELAY = 2.5, ARTY_N = 8, ARTY_R = 9, POD_T = 40, POD_R = 5.5, RANGE = 150, ENEMY_FUSE = 6.5;
const MAPW = SX * VS, MAPD = SZ * VS;
const rnd = (k) => (Math.random() - 0.5) * 2 * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
// marker columns: Kappa strike, Omega strike, supply pod (rgb at full strength)
const NB = 8, C_MINE = [0.2, 0.86, 1.0], C_FOE = [1.0, 0.27, 0.2], C_POD = [0.42, 1.0, 0.5];

function paint(geo, col) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3), k = new THREE.Color(col);
  for (let i = 0; i < n; i++) { c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}
// Drop pod: tapered hull on a skirt with four landing fins and a Kappa band (one merged, vertex-coloured mesh).
function podGeometry() {
  const P = [
    paint(new THREE.CylinderGeometry(0.4, 0.5, 1.15, 8).translate(0, 0.78, 0), 0x46525f),
    paint(new THREE.CylinderGeometry(0.16, 0.4, 0.3, 8).translate(0, 1.5, 0), 0x2c343e),
    paint(new THREE.CylinderGeometry(0.55, 0.6, 0.18, 8).translate(0, 0.11, 0), 0x232a33),
    paint(new THREE.CylinderGeometry(0.425, 0.447, 0.16, 8).translate(0, 1.08, 0), 0x1f9fb8),
  ];
  for (let i = 0; i < 4; i++) P.push(paint(new THREE.BoxGeometry(0.08, 0.62, 0.36).translate(0, 0.36, 0.6).rotateY(i * Math.PI / 2 + Math.PI / 4), 0x5d6977));
  return mergeGeometries(P);
}
function podGlowGeometry() {
  return mergeGeometries([new THREE.CylinderGeometry(0.47, 0.5, 0.09, 8, 1, true).translate(0, 0.5, 0), new THREE.BoxGeometry(0.13, 0.13, 0.13).translate(0, 1.72, 0)]);
}

export class CallIns {
  constructor(g) {
    this.g = g; g.streakPts = 0;
    g.streaks = STREAKS.map(d => ({ ...d, pts: 0, prog: 0, ready: false, active: false, t: 0 }));
    this.strikes = []; this.shells = []; this.pods = []; this.sweep = -1; this.sweepT = 0;
    this.seen = 0; this.eT = 0; this.eKills = 0; this.pollT = 0; this.evtOn = false; this.used = 0; this.podTold = false;
    this.battery = { team: 1, name: 'ARTILHARIA ÔMEGA', pos: new THREE.Vector3(), kills: 0 };
  }
  // Build the shared geometry / materials and leave a hidden prototype in the scene, so its shader is compiled with
  // everything else while the game loads (no hitch at the first call-in). The marker columns are soft camera-facing
  // beams (the cards of the objective columns): one draw call for all of them, none while no marker is up.
  warm() {
    this.podGeo = podGeometry(); this.podGlow = podGlowGeometry();
    this.podMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.podLit = new THREE.MeshBasicMaterial({ color: 0x7dff8a, side: THREE.DoubleSide });
    const B = this.beams = new Beams(this.g.scene, NB, { fog: 0.1, order: 3 }); this.beamOn = new Uint8Array(NB); this.beamN = 0;
    for (let i = 0; i < NB; i++) B.set(i, 0, -50, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0);
    B.mesh.visible = false;
    const b = this.podMesh(); b.visible = false; this.g.scene.add(b);
  }
  // A column of light h metres tall standing on (x, y, z). Returns its slot, or -1 when every slot is taken.
  beam(x, y, z, h, r) {
    let i = 0; while (i < NB && this.beamOn[i]) i++; if (i >= NB) return -1;
    this.beamOn[i] = 1; this.beamN++; this.beams.set(i, x, y, z, 0, 1, 0, h, r, r * 0.4, 0, 0, 0); this.beams.mesh.visible = true;
    return i;
  }
  unbeam(i) { if (i >= 0 && this.beamOn[i]) { this.beamOn[i] = 0; this.beams.hide(i); if (--this.beamN <= 0) { this.beamN = 0; this.beams.mesh.visible = false; } } }
  lit(i, c, k) { if (i >= 0) this.beams.setColor(i, c[0] * k, c[1] * k, c[2] * k); }
  podMesh() { const m = new THREE.Mesh(this.podGeo, this.podMat); m.add(new THREE.Mesh(this.podGlow, this.podLit)); return m; }
  reset() {
    const g = this.g;
    for (const S of this.strikes) this.unbeam(S.beam);
    for (const P of this.pods) { g.scene.remove(P.mesh); this.unbeam(P.beam); }
    this.strikes.length = 0; this.shells.length = 0; this.pods.length = 0; this.sweep = -1; this.sweepT = 0;
    for (const s of g.streaks) { s.pts = 0; s.prog = 0; s.ready = false; s.active = false; s.t = 0; s.lock = 0; }
    g.streakPts = 0; this.seen = 0; this.eT = 0; this.eKills = 0; this.pollT = 0; this.used = 0; this.battery.kills = 0; this.podTold = false;
    if (this.evtOn) { this.evtOn = false; g.hud.event(null); }
  }
  // The player scored n points: every meter that is not full yet takes them.
  earn(n) {
    const g = this.g; g.streakPts += n;
    for (const s of g.streaks) {
      if (s.ready || s.lock > 0) continue;
      s.pts = Math.min(s.cost, s.pts + n);
      if (s.pts >= s.cost) { s.ready = true; g.hud.toast(`${s.name} PRONTA · [${s.key}]`, 0); g.audio.play('streakReady', null, 0.7); }
    }
  }
  // Key 4 / 5 / 6. Returns true when the reward was spent.
  use(i) {
    const g = this.g, s = g.streaks[i], p = g.player;
    if (!s || g.state !== 'play' || !p.alive || g.countdown > 0) return false;
    if (!s.ready) { g.hud.toast(s.active ? `${s.name} JÁ ESTÁ ATIVA` : `${s.name} · FALTAM ${s.cost - s.pts} PONTOS`, 0, true); g.audio.ui('error'); return false; }
    if (s.id === 'uav') {
      s.active = true; s.t = UAV_T; this.sweepT = 0;
      g.hud.toast('VARREDURA UAV ATIVA · INIMIGOS NO MINIMAPA', 0); g.hud.radio('COMANDO', 'UAV no ar. Varrendo o instituto por 20 segundos.');
    } else {
      const t = this.aimPoint(RANGE);
      if (!t) { g.hud.toast('SEM ALVO · MIRE NO CHÃO OU NUMA PAREDE A ATÉ 150 M', 0, true); g.audio.ui('error'); return false; }
      if (s.id === 'arty') { this.strike(t, g.pent, ARTY_DELAY); g.hud.toast('BARRAGEM A CAMINHO · PROTEJA-SE', 0); g.hud.radio('COMANDO', 'Coordenadas recebidas. Artilharia a caminho!'); }
      else { this.dropPod(t); g.hud.toast('CÁPSULA DE SUPRIMENTOS A CAMINHO', 0); g.hud.radio('COMANDO', 'Cápsula lançada. Afaste-se do ponto de impacto.'); }
    }
    s.ready = false; s.pts = 0; s.lock = s.id === 'uav' ? UAV_T : 25; this.used++;      // its meter stays shut for a while: no chain of call-ins
    g.rules.stat('callins'); g.rules.mission('callin'); g.audio.play('radio', null, 0.5);
    return true;
  }
  // Point under the crosshair (up to max metres), dropped onto the floor below it. null when aiming at the sky.
  aimPoint(max) {
    const g = this.g, eye = g.player.eye, dir = g.camera.getWorldDirection(new THREE.Vector3());
    const h = g.world.raycast(eye, dir, max); if (!h) return null;
    const q = h.point.clone().addScaledVector(dir, -0.3);
    q.x = clamp(q.x, 1.5, MAPW - 1.5); q.z = clamp(q.z, 1.5, MAPD - 1.5);
    q.y = g.world.groundHeightAt(q.x, q.z, Math.max(0, Math.floor(q.y / VS)));
    return q;
  }
  topAt(x, z) { return this.g.colTop[clamp(z / VS | 0, 0, SZ - 1) * SX + clamp(x / VS | 0, 0, SX - 1)] * VS; }
  // Artillery: coloured smoke and a column of light on the target, then ARTY_N shells inside ARTY_R over about four seconds.
  strike(c, owner, delay) {
    const g = this.g, S = { c: c.clone(), owner, team: owner.team, t: delay, k: 0, next: 0, R: ARTY_R, smoke: 0, end: 1.2, beam: this.beam(c.x, c.y, c.z, 48, 0.5) };
    this.strikes.push(S);
    g.audio.play('artyIn', S.c, 1.6, 1, 0.4);
    return S;
  }
  shell(x, z, owner) {
    x = clamp(x, 1, MAPW - 1); z = clamp(z, 1, MAPD - 1);
    this.shells.push({ x, z, y: this.topAt(x, z) + 60, owner });
  }
  dropPod(t) {
    const g = this.g, mesh = this.podMesh();
    const P = { x: t.x, z: t.z, gy: t.y, y: Math.max(this.topAt(t.x, t.z), t.y) + 60, v: 42, landed: false, t: POD_T, tick: 0, broke: 0, mesh, beam: this.beam(t.x, t.y, t.z, 36, 0.4) };
    mesh.position.set(P.x, P.y, P.z); g.scene.add(mesh);
    this.pods.push(P); g.audio.play('artyIn', _a.set(P.x, P.gy, P.z), 1.2, 0.8, 0.3);
    return P;
  }
  // Is this position inside the danger area of a strike that would hurt `team`? (bots run, the HUD warns)
  dangerAt(pos, team) {
    for (const S of this.strikes) if (S.team !== team && (pos.x - S.c.x) ** 2 + (pos.z - S.c.z) ** 2 < (S.R + 4) ** 2) return S;
    return null;
  }
  update(dt) {
    const g = this.g, p = g.player, fx = g.fx;
    const sc = g.pent.score; if (sc > this.seen) this.earn(sc - this.seen); this.seen = sc;
    for (const s of g.streaks) { s.prog = s.ready ? 1 : s.pts / s.cost; if (s.lock > 0) s.lock -= dt; }
    // --- UAV: a pulse every 2.5 s marks every living enemy (minimap dot + 3D marker) until the next one
    const u = g.streaks[0];
    if (u.active) {
      u.t -= dt; this.sweepT -= dt;
      if (this.sweepT <= 0) {
        this.sweepT = UAV_PULSE; this.sweep = 0; g.audio.play('uav', null, 0.45);
        for (const b of g.bots) if (b.alive && b.team === 1) { b.markT = Math.max(b.markT || 0, UAV_PULSE + 0.4); b.spottedT = Math.max(b.spottedT || 0, UAV_PULSE + 0.4); }
      }
      if (u.t <= 0) { u.active = false; u.t = 0; g.hud.toast('VARREDURA UAV ENCERRADA', 0); }
    }
    if (this.sweep >= 0) { this.sweep += dt / 1.3; if (this.sweep >= 1) this.sweep = -1; }
    // --- strikes: marker, then the shells
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const S = this.strikes[i]; S.t -= dt; S.smoke -= dt;
      if (S.smoke <= 0 && S.k < ARTY_N) {
        S.smoke = 0.07; const mine = S.team === 0;
        fx.smoke.emit(S.c.x + rnd(0.4), S.c.y + 0.3, S.c.z + rnd(0.4), rnd(0.7), 1.8 + Math.random(), rnd(0.7), mine ? 0.25 : 1, mine ? 0.85 : 0.28, mine ? 1 : 0.2, 2.2, -0.5, 0.8);
      }
      this.lit(S.beam, S.team === 0 ? C_MINE : C_FOE, 0.8 + 0.45 * Math.sin(g.time * 16));     // urgent flicker until the last shell
      if (S.t <= 0 && S.k < ARTY_N) {
        S.next -= dt;
        if (S.next <= 0) {
          S.next = 0.42 + Math.random() * 0.22;
          const a = Math.random() * Math.PI * 2, r = S.k === 0 ? 0 : Math.sqrt(Math.random()) * S.R;   // the first one lands on the marker
          this.shell(S.c.x + Math.cos(a) * r, S.c.z + Math.sin(a) * r, S.owner);
          if (S.k % 3 === 1) g.audio.play('artyIn', S.c, 0.9, 1.3, 0.3);
          S.k++;
        }
      } else if (S.k >= ARTY_N && (S.end -= dt) <= 0) { this.unbeam(S.beam); this.strikes.splice(i, 1); }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i], y0 = s.y, top = this.topAt(s.x, s.z); s.y -= 115 * dt;
      fx.tracer(_a.set(s.x, y0 + 6, s.z), _b.set(s.x, Math.max(s.y, top), s.z), [1, 0.75, 0.4]);
      if (s.y <= top + 0.3) {
        if (g.boomT === g.time) { s.y = top + 0.3; continue; }        // one heavy blast per frame: this one waits for the next (frame-time safety)
        this.shells.splice(i, 1);
        g.blast = 'ARTILHARIA'; g.explode(new THREE.Vector3(s.x, top + 0.4, s.z), 3.8, s.owner, 2.0, 'explosion_big'); g.blast = null;
      }
    }
    // --- supply pods
    for (let i = this.pods.length - 1; i >= 0; i--) if (this.updatePod(this.pods[i], dt)) this.pods.splice(i, 1);
    this.seen = g.pent.score;            // what the call-ins themselves score counts for the match, but does not pay for the next call-in
    this.enemyLogic(dt);
    // --- warning banner while the player stands where shells are about to land
    let warn = null;
    if (p.alive && g.state === 'play') for (const S of this.strikes) if ((S.team === 1 || S.owner === g.pent) && (p.pos.x - S.c.x) ** 2 + (p.pos.z - S.c.z) ** 2 < (S.R + 5) ** 2) warn = S;
    if (warn) { this.evtOn = true; g.hud.event((warn.team === 1 ? '⚠ ARTILHARIA INIMIGA · SAIA DA ÁREA' : '⚠ SUA ARTILHARIA VAI CAIR AQUI · AFASTE-SE') + (warn.t > 0 ? ' · ' + Math.ceil(warn.t) + 's' : '')); }
    else if (this.evtOn) { this.evtOn = false; g.hud.event(null); }
  }
  // Returns true when the pod is spent and was removed.
  updatePod(P, dt) {
    const g = this.g, w = g.world, fx = g.fx;
    if (!P.landed) {
      const y0 = P.y; P.y -= P.v * dt;
      // punch through whatever is in the way (2 x 2 voxel column), down to the floor that was aimed at
      const vx = Math.round(P.x / VS) - 1, vz = Math.round(P.z / VS) - 1; let stop = false;
      g.hitBy = g.pent;
      for (let vy = Math.floor(y0 / VS); vy >= Math.floor(P.y / VS) && vy * VS >= P.gy - 0.01 && !stop; vy--) {
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
          if (!w.get(vx + a, vy, vz + b)) continue;
          const m = w.damageVoxel(vx + a, vy, vz + b, 999);
          if (!m) { stop = true; continue; }                          // indestructible: the pod settles on top of it
          fx.debris((vx + a + 0.5) * VS, (vy + 0.5) * VS, (vz + b + 0.5) * VS, rnd(3), -2 - Math.random() * 3, rnd(3), m, 0.7, 3);
          if (P.broke++ % 6 === 0) g.audio.impact(m, _a.set(P.x, vy * VS, P.z));
        }
        if (stop) P.gy = (vy + 1) * VS;
      }
      g.hitBy = null;
      fx.smoke.emit(P.x + rnd(0.2), P.y + 1.7, P.z + rnd(0.2), rnd(0.5), 3, rnd(0.5), 0.6, 0.6, 0.64, 1.1, -0.2, 1);
      fx.glow.emit(P.x, P.y + 0.1, P.z, 0, 0, 0, 1, 0.7, 0.35, 0.07, 0);
      if (P.y <= P.gy) { P.y = P.gy; this.landPod(P); }
      P.mesh.position.y = P.y; this.lit(P.beam, C_POD, 0.75 + 0.35 * Math.sin(g.time * 12));
      return false;
    }
    P.t -= dt; this.lit(P.beam, C_POD, (P.t < 4 ? 0.4 : 0.6) + 0.22 * Math.sin(g.time * (P.t < 4 ? 14 : 4)));      // slow breathing; quick blink before it leaves
    // settle again if the floor under it gets destroyed
    if (!w.get(Math.floor(P.x / VS), Math.floor((P.gy - 0.2) / VS), Math.floor(P.z / VS))) { P.gy = w.groundHeightAt(P.x, P.z, Math.max(0, Math.floor(P.gy / VS))); P.mesh.position.y = P.gy; if (P.beam >= 0) this.beams.setOrigin(P.beam, P.x, P.gy, P.z); }
    // strong supply crate: fast heal, ammunition for every weapon, grenades, gadget charges, a little energy
    const pl = g.player;
    if (pl.alive && g.state === 'play' && g.weapons && (pl.pos.x - P.x) ** 2 + (pl.pos.z - P.z) ** 2 < POD_R * POD_R && Math.abs(pl.pos.y - P.gy) < 3.5) {
      if (pl.hp < 100) pl.hp = Math.min(100, pl.hp + 30 * dt);
      if (!this.podTold) { this.podTold = true; g.hud.toast('CÁPSULA · MUNIÇÃO, GRANADAS E CURA ENQUANTO ESTIVER PERTO', 0); }
      if ((P.tick += dt) > 0.8) {
        P.tick = 0; let got = false;
        for (const k of Object.keys(g.weapons)) { const W = g.weapons[k], D = WEAPONS[W.id], max = D.reserve * (k === 'primary' && g.cls === 'suporte' ? 1.5 : 1); if (W.reserve < max) { W.reserve = Math.min(max, W.reserve + Math.max(1, Math.ceil(D.mag * 0.75))); got = true; } }
        if (g.nades < (g.cls === 'assalto' ? 3 : 2)) { g.nades++; got = true; }
        if (g.gadget < ({ assalto: 2, suporte: 1, recon: 1 }[g.cls] || 0)) { g.gadget++; got = true; }
        g.energy = Math.min(100, g.energy + 10);
        if (got) g.audio.play('pickup', null, 0.6, 1.1, 0);
      }
    }
    for (const b of g.bots) if (b.alive && b.team === 0 && b.hp < 100 && (b.pos.x - P.x) ** 2 + (b.pos.z - P.z) ** 2 < POD_R * POD_R) b.hp = Math.min(100, b.hp + 30 * dt);
    if (P.t <= 0) { g.scene.remove(P.mesh); this.unbeam(P.beam); return true; }
    return false;
  }
  landPod(P) {
    const g = this.g, c = new THREE.Vector3(P.x, P.gy + 0.4, P.z);
    P.landed = true; P.mesh.position.set(P.x, P.gy, P.z); if (P.beam >= 0) this.beams.setOrigin(P.beam, P.x, P.gy, P.z);
    g.audio.play('land', c, 1.7, 0.7, 0.3); g.audio.play('debris', c, 0.9, 1);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; g.fx.smoke.emit(P.x + Math.cos(a) * 0.6, P.gy + 0.2, P.z + Math.sin(a) * 0.6, Math.cos(a) * 3.5, 0.6, Math.sin(a) * 3.5, 0.5, 0.5, 0.53, 1.6, -0.2, 1.5); }
    g.trauma = Math.min(1, g.trauma + Math.max(0, 0.7 - g.player.pos.distanceTo(c) / 18));
    for (const e of g.entities) {                                     // anyone hostile under it is crushed
      if (!e.alive || e.team === 0 || Math.hypot(e.pos.x - P.x, e.pos.z - P.z) > 2.3 || Math.abs(e.pos.y - P.gy) > 2.5) continue;
      g.killHow = 'pod'; const was = e.alive; e.hurt(260, g.time, g.pent, { blast: c });
      if (e.isBot && was && !e.alive) { e.fallDir = 1; g.onKill(g.pent, e, false, 0); g.hud.hit(true, false); }
      g.killHow = null;
    }
    g.squads.noise(null, c, 30);
  }
  // The enemy team earns a barrage with its kills. It always targets ground Kappa holds, and it is announced
  // ENEMY_FUSE seconds before the first shell (toast, radio, red smoke and column of light, red circle on the maps).
  enemyLogic(dt) {
    const g = this.g; if (g.state !== 'play' || g.countdown > 0) return;
    this.eT += dt; if ((this.pollT -= dt) > 0) return; this.pollT = 1;
    let k = 0; for (const b of g.bots) if (b.team === 1) k += b.kills;
    // king of the hill is about one zone: shelling it is Omega's way back in, so the battery answers sooner there
    const hill = g.mode === 'koth', gap = ([140, 105, 80][g.settings.diff ?? 1] || 105) * (hill ? 0.6 : 1);
    if (this.eT < gap || k - this.eKills < (hill ? 4 : 8) || g.matchTime < (hill ? 35 : 50) || this.strikes.some(S => S.team === 1)) return;
    const z = this.enemyTarget(); if (!z) { this.pollT = 5; return; }
    this.eT = 0; this.eKills = k;
    const c = new THREE.Vector3(z.x, 0, z.z); c.y = g.nav.heightAt(c) ?? g.world.groundHeightAt(c.x, c.z, 12);
    this.battery.pos.copy(c); this.strike(c, this.battery, ENEMY_FUSE); this.g.squads.tally.strikes++;
    g.hud.toast('ARTILHARIA INIMIGA · ' + z.toast, 0, true); g.hud.radio('COMANDO', `Artilharia Ômega mirando ${z.where}. Saiam daí!`); g.audio.play('radio', null, 0.5);
  }
  enemyTarget() {
    const g = this.g; let best = null, bs = 0;
    for (const f of g.flags) {
      const held = f.owner === 0 && f.cap >= 1, n0 = f.n ? f.n[0] : 0, n1 = f.n ? f.n[1] : 0;
      if (n1 > 1 || !(held || n0 >= 2)) continue;                    // never onto their own people
      const s = (held ? 2 : 0) + n0 * 1.5 + (g.inFlag(f) ? 1.5 : 0) + Math.random();
      if (s > bs) { bs = s; best = f; }
    }
    if (best) return { x: best.x, z: best.z, toast: best.hill ? 'SAIA DO REATOR' : 'SAIA DO PONTO ' + best.id, where: best.hill ? 'o reator' : 'o ponto ' + best.id };
    // nothing held (or deathmatch): the tightest knot of Kappa soldiers
    let cx = 0, cz = 0, cn = 1;
    for (const a of g.entities) {
      if (!a.alive || a.team !== 0 || a.isEcho) continue; let n = 0, sx = 0, sz = 0;
      for (const b of g.entities) if (b.alive && b.team === 0 && !b.isEcho && a.pos.distanceToSquared(b.pos) < 81) { n++; sx += b.pos.x; sz += b.pos.z; }
      if (n > cn) { cn = n; cx = sx / n; cz = sz / n; }
    }
    return cn >= 2 ? { x: cx, z: cz, toast: 'SAIA DA ÁREA MARCADA', where: 'a posição de vocês' } : null;
  }
}
