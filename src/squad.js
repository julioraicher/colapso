// Squad layer for the bots: fire teams of two or three that share an objective, a team-wide memory of enemy
// sightings, overwatch spots for recon, the supply crates of support bots, reactions to noise and to fallen
// teammates, the squad radio (hud.radio) and the elite phase-dash. The per-soldier brain stays in ai.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VS, SX, SZ } from './world.js';
import { FLAGS, BASES } from './mapgen.js';
import { scanTunnel } from './abilities.js';

const MAPW = SX * VS, MAPD = SZ * VS;
const RANK = { assalto: 0, engenheiro: 1, suporte: 2, recon: 3 };   // assault leads, recon never does
// deathmatch has no flags: squads sweep these landmarks (metres) when nobody has been seen for a while
const LANDMARKS = [...FLAGS.map(f => ({ x: f.x, z: f.z })), { x: 30, z: 30 }, { x: 66, z: 30 }, { x: 30, z: 66 }, { x: 66, z: 66 }, { x: 48, z: 26 }, { x: 48, z: 70 }];
const _v = new THREE.Vector3();

function paint(geo, col) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3), k = new THREE.Color(col);
  for (let i = 0; i < n; i++) { c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
}

export class Squads {
  constructor(g) { this.g = g; this.list = []; this.intel = [[], []]; this.cd = {}; this.lastSay = -9; this.vcache = new Map(); this.crates = []; this.tally = { rockets: [0, 0], crates: [0, 0], dashes: 0, strikes: 0, radio: 0 }; }
  // One unlit, vertex-coloured mesh per crate (team light strip on top); a hidden prototype is compiled at load time.
  warm() {
    const mk = (glow) => mergeGeometries([paint(new THREE.BoxGeometry(0.6, 0.35, 0.4), 0x4a5c4a), paint(new THREE.BoxGeometry(0.62, 0.06, 0.42).translate(0, 0.12, 0), glow)]);
    this.crateGeo = [mk(0x7dff8a), mk(0xff9a4a)]; this.crateMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const m = new THREE.Mesh(this.crateGeo[0], this.crateMat); m.visible = false; this.g.scene.add(m);
  }
  reset() {
    const g = this.g;
    for (const c of this.crates) g.scene.remove(c.mesh);
    this.list = []; this.intel = [[], []]; this.cd = {}; this.lastSay = -9; this.vcache.clear(); this.crates = []; this.tally = { rockets: [0, 0], crates: [0, 0], dashes: 0, strikes: 0, radio: 0 };   // behaviour counters, read by the tests
    for (const team of [0, 1]) {
      const bots = g.bots.filter(b => b.team === team).sort((a, b) => RANK[a.cls] - RANK[b.cls]);
      const n = Math.max(1, Math.ceil(bots.length / 3)), sq = [];
      for (let i = 0; i < n; i++) sq.push({ team, idx: i, members: [], leader: null, goalF: null, goalP: null, t: i * 0.4, holdT: 0, lm: -1 });
      bots.forEach((b, i) => { const s = sq[i % n]; s.members.push(b); b.squad = s; if (!s.leader) s.leader = b; });
      this.list.push(...sq);
      // the two sharpest Omega riflemen are the elites (phase-dash on the highest difficulty)
      if (team === 1) bots.filter(b => b.cls !== 'recon').sort((a, b) => b.baseSkill - a.baseSkill).slice(0, 2).forEach(b => { b.elite = true; });
    }
  }
  update(dt) {
    const g = this.g, now = g.time;
    if (g.countdown > 0) return;
    for (const s of this.list) if ((s.t -= dt) <= 0) { s.t = 2.5 + Math.random() * 1.5; this.decide(s, now); }
    // Omega's crates heal Omega (Kappa's go through game.gadgets and also resupply the player)
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i]; c.t -= dt; c.mesh.rotation.y += dt * 0.6;
      for (const b of g.bots) if (b.alive && b.team === 1 && b.hp < 100 && b.pos.distanceToSquared(c.p) < 16) b.hp = Math.min(100, b.hp + 10 * dt);
      if (c.t <= 0) { g.scene.remove(c.mesh); this.crates.splice(i, 1); }
    }
  }
  // Pick the squad's objective: a flag in conquest / king of the hill, a point to hunt around in deathmatch.
  decide(s, now) {
    const g = this.g, lead = s.members.find(b => b.alive) || s.leader, c = lead.pos, prevF = s.goalF;
    if (g.flags.length) {
      let best = null, bs = -1e9, bestOwned = false;
      for (const f of g.flags) {
        const owned = f.owner === s.team && Math.abs(f.cap) >= 1, foe = f.n ? f.n[1 - s.team] : 0;
        let sc = (owned ? (foe ? 28 : -35) : 30) + (f.contested ? 20 : 0) - Math.hypot(f.x - c.x, f.z - c.z) * 0.55 + (prevF === f ? 16 : 0) + Math.random() * 12;
        if (g.flags.length > 1) for (const o of this.list) if (o !== s && o.team === s.team && o.goalF === f) sc -= 20;   // spread over the map
        if (g.event && g.event.st === 'warn' && f.id === 'B') sc -= 200;                                                  // reactor about to blow
        if (g.callins.dangerAt(f, s.team)) sc -= 150;                                                                     // shells incoming
        if (s.team === 0 && s.idx === 0 && g.player.alive) { const pd = Math.hypot(f.x - g.player.pos.x, f.z - g.player.pos.z); sc += pd < 14 ? 30 : pd < 30 ? 12 : 0; }   // the first Kappa squad sticks with the player
        if (sc > bs) { bs = sc; best = f; bestOwned = owned; }
      }
      s.goalF = best; s.goalP = best;
      if (best !== prevF && lead.alive) {
        if (best.hill) this.say(lead, 'push', 'TODOS PARA O REATOR!', 30, false);
        else this.say(lead, 'push', bestOwned ? `PONTO ${best.id} SOB ATAQUE! VOLTANDO PARA DEFENDER.` : `AVANÇANDO PARA O PONTO ${best.id}!`, 22, false);
      }
      return;
    }
    // deathmatch: go for the freshest sighting, otherwise sweep the landmarks near the last contact
    const I = this.intel[s.team]; let hot = null, hs = 1e9;
    for (const q of I) { if (now - q.t > 14) continue; const d = Math.hypot(q.x - c.x, q.z - c.z) + (now - q.t) * 2; if (d < hs) { hs = d; hot = q; } }
    s.goalF = null;
    if (hot) { if (!s.goalP || Math.hypot(s.goalP.x - hot.x, s.goalP.z - hot.z) > 6) s.goalP = { x: hot.x, z: hot.z }; s.holdT = now + 9; return; }
    const there = s.goalP && Math.hypot(s.goalP.x - c.x, s.goalP.z - c.z) < 9;
    if (s.goalP && !(there && now > s.holdT) && now < s.holdT + 25) return;
    const ref = I.length ? I[I.length - 1] : { x: MAPW / 2, z: MAPD / 2 }; let bi = 0, bsc = 1e9;
    for (let i = 0; i < LANDMARKS.length; i++) {
      if (i === s.lm) continue; const L = LANDMARKS[i];
      let sc = Math.hypot(L.x - ref.x, L.z - ref.z) + Math.random() * 22;
      for (const o of this.list) if (o !== s && o.team === s.team && o.lm === i) sc += 18;
      if (sc < bsc) { bsc = sc; bi = i; }
    }
    s.lm = bi; s.goalP = LANDMARKS[bi]; s.holdT = now + 10 + Math.random() * 8;
    if (lead.alive) this.say(lead, 'sweep', 'ÁREA LIMPA. SEGUINDO EM FRENTE.', 40);
  }
  // Shared team memory: where an enemy was last seen.
  report(team, pos, now) {
    const I = this.intel[team];
    for (const q of I) if ((q.x - pos.x) ** 2 + (q.z - pos.z) ** 2 < 49) { q.x = pos.x; q.z = pos.z; q.t = now; return; }
    if (I.length >= 8) I.shift();
    I.push({ x: pos.x, z: pos.z, t: now });
  }
  // Overwatch spot for a recon bot: standable, 16 to 42 m out, with a clear line to the objective P; higher ground and
  // the team's own side of the map are preferred. The candidates are cached for a while (the map keeps changing).
  vantage(P, b) {
    const g = this.g, key = b.team + ':' + (P.x | 0) + ':' + (P.z | 0); let v = this.vcache.get(key);
    if (!v || g.time - v.t > 50) {
      if (this.vcache.size > 40) this.vcache.clear();
      const py = g.nav.heightAt(P) ?? 1, to = new THREE.Vector3(P.x, py + 1.3, P.z), home = BASES[b.team], list = [];
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * 26, q = new THREE.Vector3(P.x + Math.cos(a) * r, 0, P.z + Math.sin(a) * r);
        if (q.x < 2 || q.z < 2 || q.x > MAPW - 2 || q.z > MAPD - 2) continue;
        const h = g.nav.heightAt(q); if (h === null) continue;
        q.y = h;
        if (!g.world.los(_v.set(q.x, h + 1.2, q.z), to)) continue;
        list.push({ p: q, s: (h - py) * 4 + r * 0.3 - Math.abs(q.z - home.z) * 0.12 + Math.random() * 3 });
      }
      list.sort((x, y) => y.s - x.s); v = { t: g.time, list: list.slice(0, 6) }; this.vcache.set(key, v);
    }
    if (!v.list.length) return null;
    b.vantI = (b.vantI ?? (Math.random() * 6 | 0)) + 1;
    return v.list[b.vantI % v.list.length].p;
  }
  // A shot or a blast: nearby soldiers of the other team who are not already fighting turn towards it.
  noise(shooter, pos, range = 36) {
    const g = this.g, now = g.time;
    if (shooter) { if (now - (shooter.noiseT || -9) < 0.7) return; shooter.noiseT = now; }
    const team = shooter ? shooter.team : -1, r2 = range * range;
    for (const b of g.bots) {
      if (!b.alive || b.team === team || (b.target && b.seeT > 0)) continue;
      const d2 = (b.pos.x - pos.x) ** 2 + (b.pos.z - pos.z) ** 2; if (d2 > r2) continue;
      b.heardT = now; b.heard.set(pos.x + (Math.random() - 0.5) * 5, pos.y, pos.z + (Math.random() - 0.5) * 5);
      // close enough to place it: treat it as a (slightly stale) sighting
      if (shooter && d2 < 625 && !(b.lastSeen && now - b.lastSeenT < 1.5)) { b.lastSeen = b.heard.clone(); b.lastSeenT = now - 1.5; }
    }
  }
  // A soldier went down: teammates close by duck, look for the killer and call it in.
  onDeath(victim, killer) {
    const g = this.g, now = g.time; if (!victim || victim.team === undefined || !victim.pos) return;
    let near = null, nd = 14 * 14;
    for (const b of g.bots) {
      if (!b.alive || b === victim || b.team !== victim.team) continue;
      const d2 = b.pos.distanceToSquared(victim.pos); if (d2 > 14 * 14) continue;
      b.suppress = Math.min(1, b.suppress + 0.35);
      if (killer && killer.isBot !== undefined && killer.alive && killer.pos && !(b.target && b.seeT > 0)) { b.alertBy = killer; b.heardT = now; b.heard.copy(killer.pos); }
      else if (killer === g.pent && g.player.alive && !(b.target && b.seeT > 0)) { b.alertBy = killer; b.heardT = now; b.heard.copy(g.player.pos); }
      if (d2 < nd) { nd = d2; near = b; }
    }
    if (near && victim.team === 0) this.say(near, 'down', 'HOMEM ABATIDO!', 18);
  }
  // The player is taking fire: Kappa soldiers close by turn on the attacker.
  onPlayerHurt(from) {
    const g = this.g, now = g.time; if (!from || !from.alive || !from.pos) return;
    for (const b of g.bots) if (b.alive && b.team === 0 && !(b.target && b.seeT > 0) && b.pos.distanceToSquared(g.player.pos) < 22 * 22) { b.alertBy = from; b.heardT = now; b.heard.copy(from.pos); }
  }
  // Squad radio: only Kappa talks to the player; one line every few seconds at most, each kind on its own cooldown.
  // local = only when the speaker is close enough to matter to the player.
  say(b, kind, text, cd = 14, local = true) {
    const g = this.g, now = g.time;
    if (!b || b.team !== 0 || g.state !== 'play' || g.countdown > 0) return false;
    if (now - this.lastSay < 5 || now < (this.cd[kind] || 0)) return false;
    if (local && g.player.pos.distanceToSquared(b.pos) > 45 * 45) return false;
    this.lastSay = now; this.cd[kind] = now + cd; this.tally.radio++;
    g.hud.radio(b.name.toUpperCase(), text); g.audio.play('radio', null, 0.3);
    return true;
  }
  // Support bot throws down a supply crate (30 s, 4 m aura).
  dropCrate(b) {
    const g = this.g, mesh = new THREE.Mesh(this.crateGeo[b.team], this.crateMat), fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const p = new THREE.Vector3(b.pos.x + fx * 0.6, b.pos.y + 1.0, b.pos.z + fz * 0.6);
    g.scene.add(mesh); g.audio.play('pin', p, 0.5, 0.6); this.tally.crates[b.team]++;
    if (b.team === 0) { mesh.position.copy(p); g.gadgets.push({ kind: 'crate', p, v: new THREE.Vector3(fx * 2.5, 2, fz * 2.5), mesh, t: 30, landed: false }); return; }
    p.set(b.pos.x + fx * 0.9, 0, b.pos.z + fz * 0.9); p.y = g.world.groundHeightAt(p.x, p.z, Math.floor((b.pos.y + 0.9) / VS)) + 0.18;
    mesh.position.copy(p); this.crates.push({ p, mesh, t: 30 });
  }
  // Elite Omega soldiers (highest difficulty only): a short phase-dash through a thin wall towards the last known
  // position of their target. Orange sparks on both sides of the wall and a rising hum give 0.8 s of warning.
  tryDash(b, now) {
    const g = this.g;
    if ((g.settings.diff ?? 1) < 2 || now < (b.dashCd || 0) || !b.lastSeen || now - b.lastSeenT > 5) return false;
    const dx = b.lastSeen.x - b.pos.x, dz = b.lastSeen.z - b.pos.z, d = Math.hypot(dx, dz); if (d < 3 || d > 22) return false;
    b.dashCd = now + 4;                                                   // do not rescan on every think
    const yaw = Math.atan2(-dx, -dz), s = scanTunnel(g.world, b.pos, yaw);
    if (!s || !s.exit || s.d > 1.3 || g.nav.heightAt(s.exit) === null) return false;
    b.dash = { t: 0, tele: 0.8, from: b.pos.clone(), to: s.exit.clone(), yaw, fx: 0 }; b.dashCd = now + 25 + Math.random() * 15; this.tally.dashes++;
    g.audio.play('ability', b.pos, 1.2, 0.75, 0.3);
    return true;
  }
  updateDash(b, dt) {
    const g = this.g, D = b.dash; D.t += dt; b.yaw = D.yaw;
    if (D.t < D.tele) {
      if ((D.fx -= dt) <= 0) { D.fx = 0.12; g.fx.quantum(b.chest, 8, [1, 0.45, 0.15]); g.fx.quantum(_v.set(D.to.x, D.to.y + 1.2, D.to.z), 6, [1, 0.45, 0.15]); }
      return;
    }
    const k = Math.min(1, (D.t - D.tele) / 0.25); b.pos.lerpVectors(D.from, D.to, k * k * (3 - 2 * k));
    if (k >= 1) { b.dash = null; b.path = null; b.repath = 0; b.thinkT = 0; g.fx.quantum(b.chest, 30, [1, 0.45, 0.15]); g.audio.play('abilityEnd', b.pos, 1.1, 0.8); }
  }
}
