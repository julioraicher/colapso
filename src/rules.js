// Match rules: game modes (conquest / team deathmatch / king of the hill), score keeping, spawn selection,
// per-match statistics, rotating missions and weapon mastery. Pure game logic, no rendering.
// Per-weapon handling data (fire modes, bipods) also lives here so src/weapons.js stays untouched.
import * as THREE from 'three';
import { VS } from './world.js';
import { FLAGS, BASES, G } from './mapgen.js';
import { WEAPONS } from './weapons.js';

export const MAP_NAME = 'INSTITUTO KAPPA';
export const MODES = {
  conquest: { id: 'conquest', name: 'CONQUISTA', short: 'CONQUISTA', label: 'TICKETS', target: 300, time: 0,
    play: 'Conquista 8 contra 8 · capture os pontos A, B e C',
    desc: 'Capture os pontos A, B e C. Quem tem mais pontos drena os tickets do rival.',
    goal: 'Segure os pontos A, B e C até os tickets inimigos zerarem.' },
  tdm: { id: 'tdm', name: 'MATA-MATA EM EQUIPE', short: 'MATA-MATA', label: 'ABATES', target: 60, time: 480,
    play: 'Mata-mata em equipe 8 contra 8 · primeiro time a 60 abates',
    desc: 'Sem pontos de captura. Vence o primeiro time a 60 abates, ou quem estiver na frente após 8 minutos.',
    goal: 'Não há pontos para capturar: cace a Ômega pelo instituto. Vence o primeiro time a 60 abates, ou quem liderar após 8 minutos.' },
  koth: { id: 'koth', name: 'REI DO REATOR', short: 'REI DO REATOR', label: 'PONTOS', target: 200, time: 900,
    play: 'Rei do Reator 8 contra 8 · domine o reator até 200 pontos',
    desc: 'Uma única zona: o reator. O time que a domina sem inimigos dentro ganha 1 ponto por segundo. Vence quem fizer 200.',
    goal: 'Só o reator importa: domine a zona central e expulse a Ômega de dentro dela. Cada segundo de domínio vale 1 ponto; vence quem fizer 200.' },
};
export const MODE_ORDER = ['conquest', 'tdm', 'koth'];

// ---- weapon handling rules, keyed by weapon id ----
export const FIRE_MODES = {
  k7: ['auto', 'semi'], arco: ['auto', 'burst'], vespa: ['auto', 'burst'], faisca: ['auto'], martelo: ['pump'],
  trovao: ['auto'], bigorna: ['auto', 'semi'], lanca: ['semi'], orion: ['bolt'], vigia: ['bolt'],
  p9: ['semi'], juiz: ['semi'], rajada: ['auto', 'burst'], rpg: ['rocket'],
};
export const FIRE_LABEL = { auto: 'AUTO', burst: 'RAJADA ×3', semi: 'SEMI', bolt: 'FERROLHO', pump: 'BOMBA', rocket: 'FOGUETE' };
export const BIPOD = { trovao: true, bigorna: true, orion: true, vigia: true };
export function fireModesOf(id) { const w = WEAPONS[id]; return FIRE_MODES[id] || [w && w.rocket ? 'rocket' : w && w.bolt ? 'bolt' : w && w.auto ? 'auto' : 'semi']; }

// weapon type -> mission / stat family
const FAMILY = { rifle: 'rifle', bullpup: 'rifle', smg: 'smg', pdw: 'smg', shotgun: 'shotgun', lmg: 'lmg', lmg2: 'lmg', dmr: 'sniper', sniper: 'sniper', sniper2: 'sniper', pistol: 'side', revolver: 'side', mpistol: 'side' };
const WID = new Map(Object.entries(WEAPONS).map(([id, w]) => [w, id]));
export const weaponIdOf = (def) => WID.get(def) || null;

// ---- missions: three active at a time, progress persisted, completed ones rotate out at the next match ----
export const MISSION_POOL = [
  { id: 'cap3', ev: 'cap', goal: 3, xp: 500, text: 'CAPTURE 3 PONTOS' },
  { id: 'vox400', ev: 'vox', goal: 400, xp: 400, text: 'DESTRUA 400 BLOCOS' },
  { id: 'knife2', ev: 'k_knife', goal: 2, xp: 500, text: '2 ABATES COM A FACA' },
  { id: 'sniper5', ev: 'k_sniper', goal: 5, xp: 600, text: '5 ABATES COM FUZIL DE PRECISÃO' },
  { id: 'callin3', ev: 'callin', goal: 3, xp: 400, text: 'CHAME 3 REFORÇOS' },
  { id: 'head6', ev: 'head', goal: 6, xp: 500, text: '6 ABATES COM TIRO NA CABEÇA' },
  { id: 'kills20', ev: 'kill', goal: 20, xp: 500, text: 'ABATA 20 INIMIGOS' },
  { id: 'tunnel3', ev: 'k_tunnel', goal: 3, xp: 600, text: '3 ABATES LOGO APÓS TUNELAR' },
  { id: 'vault12', ev: 'vault', goal: 12, xp: 300, text: 'ESCALE 12 OBSTÁCULOS' },
  { id: 'expl4', ev: 'k_expl', goal: 4, xp: 500, text: '4 ABATES COM EXPLOSIVOS' },
  { id: 'tdm1', ev: 'play_tdm', goal: 1, xp: 300, text: 'JOGUE UMA PARTIDA DE MATA-MATA' },
  { id: 'smg8', ev: 'k_smg', goal: 8, xp: 500, text: '8 ABATES COM SUBMETRALHADORA' },
  { id: 'multi2', ev: 'multi', goal: 2, xp: 500, text: 'FAÇA 2 ABATES DUPLOS' },
  { id: 'spot6', ev: 'spot', goal: 6, xp: 300, text: 'MARQUE 6 INIMIGOS' },
  { id: 'echo2', ev: 'k_echo', goal: 2, xp: 500, text: '2 ABATES FEITOS PELO ECO' },
  { id: 'koth1', ev: 'play_koth', goal: 1, xp: 300, text: 'JOGUE UMA PARTIDA DE REI DO REATOR' },
  { id: 'lmg8', ev: 'k_lmg', goal: 8, xp: 500, text: '8 ABATES COM METRALHADORA' },
  { id: 'long1', ev: 'long', goal: 1, xp: 400, text: 'UM ABATE A MAIS DE 60 M' },
  { id: 'rifle10', ev: 'k_rifle', goal: 10, xp: 500, text: '10 ABATES COM FUZIL DE ASSALTO' },
  { id: 'win2', ev: 'win', goal: 2, xp: 800, text: 'VENÇA 2 PARTIDAS' },
  { id: 'shot5', ev: 'k_shotgun', goal: 5, xp: 500, text: '5 ABATES COM ESCOPETA' },
  { id: 'streak5', ev: 'streak5', goal: 1, xp: 600, text: 'SEQUÊNCIA DE 5 ABATES SEM MORRER' },
  { id: 'side4', ev: 'k_side', goal: 4, xp: 500, text: '4 ABATES COM A ARMA SECUNDÁRIA' },
  { id: 'arty2', ev: 'k_arty', goal: 2, xp: 600, text: '2 ABATES COM ARTILHARIA' },
];
const MKEY = 'colapso.missions.v1', MASTKEY = 'colapso.mastery.v1';
const store = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } } };

function newStats() {
  return { shots: 0, hits: 0, accuracy: 0, kills: 0, headshots: 0, bestStreak: 0, longestShot: 0, favWeapon: '', distance: 0, voxels: 0, captures: 0, callins: 0, knifeKills: 0, vaults: 0, missionXp: 0, byWeapon: {} };
}

// Spawn anchors for modes without owned flags (metres). Bases first, then landmarks spread over the map.
const ANCHORS = [BASES[0], BASES[1], ...FLAGS.map(f => ({ x: f.x, z: f.z })),
  { x: 15, z: 14 }, { x: 80, z: 14 }, { x: 15, z: 82 }, { x: 80, z: 82 }, { x: 30, z: 30 }, { x: 66, z: 66 }, { x: 30, z: 66 }, { x: 66, z: 30 }];

export class Rules {
  constructor(g) {
    this.g = g; this.pool = MISSION_POOL; this.mDirty = false; this.mSaveT = 0; this.capsSeen = 0; this.lx = 0; this.lz = 0; this.holdT = 0; this.acc = [0, 0]; this.warned = [false, false];
    g.mode = 'conquest'; g.modeName = MODES.conquest.name; g.mapName = MAP_NAME; g.matchTime = 0; g.timeLimit = 0; g.overtime = false;
    g.score = [0, 0]; g.scoreMax = 300; g.scoreLabel = 'TICKETS';
    g.stats = newStats(); g.lastDeath = null; g.mastery = store.get(MASTKEY, {}) || {};
    this.loadMissions();
  }
  // ---------- modes ----------
  setMode(id) {
    const g = this.g; if (!MODES[id]) id = 'conquest';
    g.mode = id; g.modeName = MODES[id].name;
    if (g.settings.mode !== id) { g.settings.mode = id; g.saveSettings(); }
    if (g.hud && g.hud.setMode) g.hud.setMode(id);
    return id;
  }
  cycle() { return this.setMode(MODE_ORDER[(MODE_ORDER.indexOf(this.g.mode) + 1) % MODE_ORDER.length]); }
  // One-time hook into the world: voxels chipped away by the player's bullets, blade or supply pod count for the stats
  // (the caller marks who is responsible through game.hitBy; explosions report through addVox()).
  attach() {
    const g = this.g, w = g.world, dv = w.damageVoxel.bind(w);
    w.damageVoxel = (x, y, z, d) => { const m = dv(x, y, z, d); if (m && g.hitBy === g.pent) this.addVox(1); return m; };
  }
  // Called from startMatch() after the default (conquest) flags and tickets were created.
  start() {
    const g = this.g, M = MODES[g.mode] || MODES.conquest;
    g.modeName = M.name; g.matchTime = 0; g.timeLimit = M.time; g.overtime = false; g.scoreMax = M.target; g.scoreLabel = M.label;
    g.stats = newStats(); g.lastDeath = null; g.streak = 0; g.multi = 0; g.lastKillT = -9; g.medals = {}; g.killer = null;
    this.capsSeen = 0; this.holdT = 0; this.acc = [0, 0]; this.warned = [false, false];
    if (g.mode === 'conquest') g.score = g.tickets;
    else {
      g.flags = g.mode === 'koth' ? [{ id: 'R', name: 'REATOR', x: 96 * VS, z: 96 * VS, cap: 0, owner: -1, contested: false, n: [0, 0], hill: true, spawn: false }] : [];
      g.tickets = g.score = [0, 0]; g.event = { st: 'off', t: 0 };
    }
    for (const gr of g.grenades) g.scene.remove(gr.mesh); g.grenades.length = 0;
    this.rotateMissions();
  }
  // Per-frame while the match is being played.
  update(dt) {
    const g = this.g, p = g.player;
    g.matchTime += dt;
    if (p.alive) { const d = Math.hypot(p.pos.x - this.lx, p.pos.z - this.lz); if (d < 1.2) g.stats.distance += d; }
    this.lx = p.pos.x; this.lz = p.pos.z;
    const caps = g.pent.caps || 0; if (caps > this.capsSeen) { this.stat('captures', caps - this.capsSeen); this.mission('cap', caps - this.capsSeen); } this.capsSeen = caps;
    if (g.mode === 'conquest') { g.updateFlags(dt); g.updateEvent(dt); }
    else {
      if (g.mode === 'koth') this.updateHill(dt);
      const s = g.score, T = g.scoreMax;
      if (g.state === 'play' && (s[0] >= T || s[1] >= T)) g.endMatch(s[0] >= T && s[0] >= s[1]);
      else if (g.state === 'play' && g.timeLimit && g.matchTime >= g.timeLimit) {
        if (s[0] !== s[1]) g.endMatch(s[0] > s[1]);
        else if (!g.overtime) { g.overtime = true; g.hud.toast('PRORROGAÇÃO · O PRÓXIMO PONTO VENCE', 0, true); g.audio.play('countdown', null, 0.6); }
      }
    }
    if (this.mDirty) { this.mSaveT -= dt; if (this.mSaveT <= 0) this.saveMissions(); }
  }
  // King of the hill: same capture fields as a conquest flag (so HUD, bots and beacons just work), faster capture,
  // and the owner scores one point per second while it holds the zone with no enemy inside.
  updateHill(dt) {
    const g = this.g, f = g.flags[0]; if (!f) return;
    f.n[0] = f.n[1] = 0;
    for (const e of g.entities) { if (!e.alive || e.isEcho) continue; if (Math.hypot(e.pos.x - f.x, e.pos.z - f.z) < 7.5 && Math.abs(e.pos.y - 1) < 6) f.n[e.team]++; }
    const diff = f.n[0] - f.n[1]; f.contested = f.n[0] > 0 && f.n[1] > 0;
    const was = f.owner === 0 && f.cap >= 1 ? 0 : f.owner === 1 && f.cap <= -1 ? 1 : -1;
    if (diff !== 0) {
      f.cap = THREE.MathUtils.clamp(f.cap + Math.sign(diff) * Math.min(3, Math.abs(diff)) * dt * 0.22, -1, 1);
      if (f.cap >= 1) f.owner = 0; else if (f.cap <= -1) f.owner = 1; else if ((f.owner === 0 && f.cap <= 0) || (f.owner === 1 && f.cap >= 0)) f.owner = -1;
    }
    const now = f.owner === 0 && f.cap >= 1 ? 0 : f.owner === 1 && f.cap <= -1 ? 1 : -1;
    if (now !== was) {
      if (now === 0) { const mine = g.inFlag(f); g.audio.play('capture', null, 0.5, 1, 0); g.hud.toast('REATOR CAPTURADO', mine ? 200 : 0); if (mine) { g.pent.score += 200; g.pent.caps++; } }
      else if (now === 1) { g.audio.play('lost', null, 0.5, 1, 0); g.hud.toast('A ÔMEGA DOMINOU O REATOR', 0, true); }
    }
    if (now >= 0 && f.n[1 - now] === 0) {
      this.acc[now] += dt;
      if (this.acc[now] >= 1) { this.acc[now] -= 1; g.score[now]++; }
      if (now === 0 && g.inFlag(f)) { this.holdT += dt; if (this.holdT >= 10) { this.holdT = 0; g.pent.score += 50; g.hud.toast('DEFESA DO REATOR', 50); } }
      const left = g.scoreMax - g.score[now];
      if (left <= 30 && !this.warned[now]) { this.warned[now] = true; g.hud.toast(now === 0 ? 'FALTAM 30 PONTOS · SEGURE O REATOR' : 'A ÔMEGA ESTÁ A 30 PONTOS DE VENCER', 0, now === 1); if (g.hud.radio) g.hud.radio('COMANDO', now === 0 ? 'Estamos quase lá. Segurem o reator!' : 'Ômega prestes a vencer. Retomem o reator agora!'); }
    }
  }
  // A soldier died (bots through onKill, the player through playerHurt).
  death(victim, killer) {
    const g = this.g; if (g.state === 'end' || !victim || victim.team === undefined) return;
    if (g.mode === 'conquest') g.tickets[victim.team] = Math.max(0, g.tickets[victim.team] - 1);
    else if (g.mode === 'tdm' && killer && killer.team !== undefined && killer.team !== victim.team) {
      g.score[killer.team]++;
      const left = g.scoreMax - g.score[killer.team];
      if (left === 10) { g.hud.toast(killer.team === 0 ? 'FALTAM 10 ABATES PARA VENCER' : 'A ÔMEGA ESTÁ A 10 ABATES DE VENCER', 0, killer.team === 1); }
    }
  }
  // How far `team` is behind, 0..1 (drives the bots' rubber band in every mode).
  deficit(team) {
    const g = this.g, s = g.score; if (!s) return 0;
    const d = g.mode === 'conquest' ? (s[1 - team] - s[team]) / 60 : g.mode === 'tdm' ? (s[1 - team] - s[team]) / 12 : (s[1 - team] - s[team]) / 50;
    return Math.max(0, Math.min(1, d));
  }
  // ---------- spawning ----------
  // Random standable point around `c`, away from (and out of sight of) nearby enemies. Returns null when none fits.
  pointNear(c, team, rMin, rMax, tries = 30) {
    const g = this.g;
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      const p = new THREE.Vector3(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
      const h = g.nav.heightAt(p); if (h === null) continue;
      p.y = h; let bad = false;
      for (const e of g.entities) {
        if (!e.alive || e.team === team) continue;
        const d = e.pos.distanceTo(p);
        if (d < 12 || (d < 28 && k < tries * 0.6 && g.world.los(new THREE.Vector3(p.x, p.y + 1.5, p.z), new THREE.Vector3(e.pos.x, e.pos.y + 1.5, e.pos.z)))) { bad = true; break; }
      }
      if (!bad) return p;
    }
    return null;
  }
  // Anchor far from the enemy and close to friends (deathmatch has no fixed front line).
  safeAnchor(team) {
    const g = this.g; let best = BASES[team], bs = -1e9;
    for (let i = 0; i < ANCHORS.length; i++) {
      const c = ANCHORS[i]; let dE = 99, dF = 99;
      for (const e of g.entities) { if (!e.alive || e.isEcho) continue; const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z); if (e.team === team) dF = Math.min(dF, d); else dE = Math.min(dE, d); }
      let s = Math.min(dE, 42) - Math.abs(Math.min(dF, 40) - 14) * 0.45 + Math.random() * 8 + (i === team ? 6 : 0) - (i === 1 - team ? 14 : 0);
      if (dE < 20) s -= 60;
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  }
  spawnPoint(team, who) {
    const g = this.g; let pick;
    if (who && who.chosenSpawn && !who.chosenSpawn.dyn) pick = who.chosenSpawn;
    else if (g.mode === 'tdm') pick = this.safeAnchor(team);
    else {
      const opts = [BASES[team]];
      for (const f of g.flags) if (f.spawn !== false && f.owner === team && Math.abs(f.cap) >= 1 && !f.contested) opts.push(f);
      pick = who && who.isBot && opts.length > 1 && Math.random() < 0.7 ? opts[1 + (Math.random() * (opts.length - 1) | 0)] : opts[Math.random() * opts.length | 0];
    }
    const p = this.pointNear(pick, team, 2, pick === BASES[team] ? 8 : 9) || (pick !== BASES[team] && this.pointNear(BASES[team], team, 2, 8));
    if (p) return p;
    const b = BASES[team]; return new THREE.Vector3(b.x, G * VS, b.z);
  }
  spawnOptions() {
    const g = this.g, o = [{ ...BASES[0], label: 'BASE' }];
    if (g.mode === 'tdm') { const a = this.safeAnchor(0); o.unshift({ x: a.x, z: a.z, label: 'EQ', name: 'JUNTO DA EQUIPE', dyn: true }); return o; }
    for (const f of g.flags) if (f.spawn !== false && f.owner === 0 && Math.abs(f.cap) >= 1 && !f.contested) o.push({ ...f, label: f.id });
    return o;
  }
  // ---------- statistics ----------
  stat(k, n = 1) { const s = this.g.stats; s[k] = (s[k] || 0) + n; }
  addVox(n) { if (n > 0) { this.stat('voxels', n); this.mission('vox', n); } }
  shot(D) { const s = this.g.stats; s.shots += D.pellets || 1; s.accuracy = Math.min(100, Math.round(100 * s.hits / Math.max(1, s.shots))); }
  hit() { const s = this.g.stats; s.hits++; s.accuracy = Math.min(100, Math.round(100 * s.hits / Math.max(1, s.shots))); }
  blastName(power) { return this.g.blast || (power >= 1.55 ? 'RPG-Q' : power > 1.2 ? 'BARRIL EXPLOSIVO' : 'GRANADA'); }
  // The player (or the echo) killed `victim`. Adds medals to `tags`, returns bonus points.
  playerKill(killer, victim, head, dist, tags) {
    const g = this.g, s = g.stats; let bonus = 0, id = null, fam = null;
    const how = g.killHow; g.killHow = null;
    if (how === 'melee') { id = 'faca'; fam = 'knife'; g.medal('faca'); this.stat('knifeKills'); }   // melee() shows its own "FACA" toast
    else if (how === 'pod') { id = 'capsula'; fam = 'expl'; tags.push('ENTREGA ESPECIAL'); bonus += 100; }
    else if (g.dmgCause) { id = g.blast ? 'artilharia' : 'explosivo'; fam = 'expl'; if (g.blast) { tags.push('ARTILHARIA'); this.mission('k_arty'); } }
    else { const D = killer === g.echo ? g.echo.wdef : g.hitD; id = weaponIdOf(D); fam = D ? FAMILY[D.type] : null; }
    s.kills++;
    if (head) s.headshots++;
    if (g.streak > s.bestStreak) s.bestStreak = g.streak;
    if (fam !== 'knife' && fam !== 'expl' && dist > s.longestShot) s.longestShot = Math.round(dist);
    if (id) {
      const bw = s.byWeapon; bw[id] = (bw[id] || 0) + 1;
      let fav = id; for (const k in bw) if (bw[k] > bw[fav]) fav = k; s.favWeapon = fav;
      if (WEAPONS[id]) { g.mastery[id] = (g.mastery[id] || 0) + 1; store.set(MASTKEY, g.mastery); const n = g.mastery[id]; if (n === 25 || n === 100 || n === 250) { tags.push(`MAESTRIA ${WEAPONS[id].name} · ${n} ABATES`); bonus += n * 2; } }
    }
    this.mission('kill'); if (fam) this.mission('k_' + fam);
    if (head) this.mission('head');
    if (dist > 60 && fam !== 'expl') this.mission('long');
    if (killer === g.echo) this.mission('k_echo');
    if (g.phaseKillT && g.time - g.phaseKillT < 2) this.mission('k_tunnel');
    if (g.multi === 2) this.mission('multi');
    if (g.streak === 5) this.mission('streak5');
    return bonus;
  }
  // The player died: fill the death card data.
  playerDied(from) {
    const g = this.g, p = g.player; let killerName, weaponName = g.dmgCause || '', dist = null;
    if (from === g.pent) { killerName = 'VOCÊ MESMO'; }
    else if (from) { killerName = from.name || '???'; if (!weaponName && from.wdef) weaponName = from.wdef.name; if (from.pos && from.isBot) dist = Math.hypot(from.pos.x - p.pos.x, from.pos.y - p.pos.y, from.pos.z - p.pos.z); }
    else { killerName = g.dmgCause || 'AMBIENTE'; weaponName = ''; }
    g.lastDeath = { killerName, weaponName, dist };
  }
  // Display name of a stats weapon key.
  weaponName(id) { return WEAPONS[id] ? WEAPONS[id].name : id === 'faca' ? 'FACA' : id === 'artilharia' ? 'ARTILHARIA' : id === 'capsula' ? 'CÁPSULA' : id === 'explosivo' ? 'EXPLOSIVOS' : '—'; }
  // Secondary tiles of the end screen: [label, value].
  summary() {
    const s = this.g.stats;
    return [['PRECISÃO', (s.shots ? s.accuracy : 0) + '%'], ['TIROS NA CABEÇA', s.headshots], ['MELHOR SEQUÊNCIA', s.bestStreak], ['TIRO MAIS LONGO', s.longestShot + ' m'],
      ['ARMA FAVORITA', s.favWeapon ? this.weaponName(s.favWeapon) : '—'], ['DISTÂNCIA', Math.round(s.distance) + ' m'], ['BLOCOS DESTRUÍDOS', s.voxels], ['REFORÇOS USADOS', s.callins]];
  }
  finish(win) {
    const g = this.g;
    if (win) this.mission('win');
    if (g.mode !== 'conquest') this.mission('play_' + g.mode);
    this.saveMissions(); store.set(MASTKEY, g.mastery);
  }
  // ---------- missions ----------
  loadMissions() {
    const g = this.g, sv = store.get(MKEY, null); this.cursor = sv && sv.cursor | 0; const list = [];
    for (const m of (sv && Array.isArray(sv.list) ? sv.list : [])) { const def = this.pool.find(q => q.id === m.id); if (def && list.length < 3) list.push({ ...def, prog: Math.min(def.goal, +m.prog || 0), done: !!m.done }); }
    g.missions = list; this.fillMissions();
  }
  fillMissions() {
    const L = this.g.missions; let guard = 0;
    while (L.length < 3 && guard++ < this.pool.length * 2) {
      const def = this.pool[this.cursor++ % this.pool.length];
      if (!L.some(m => m.id === def.id)) L.push({ ...def, prog: 0, done: false });
    }
    this.saveMissions();
  }
  rotateMissions() { const g = this.g; if (g.missions.some(m => m.done)) { g.missions = g.missions.filter(m => !m.done); this.fillMissions(); } }
  saveMissions() { this.mDirty = false; this.mSaveT = 2; store.set(MKEY, { cursor: this.cursor, list: this.g.missions.map(m => ({ id: m.id, prog: m.prog, done: m.done })) }); }
  mission(ev, n = 1) {
    const g = this.g;
    for (const m of g.missions) {
      if (m.done || m.ev !== ev) continue;
      m.prog = Math.min(m.goal, m.prog + n); this.mDirty = true;
      if (m.prog >= m.goal) {
        m.done = true;
        try { localStorage.setItem('colapso.xp', +(localStorage.getItem('colapso.xp') || 0) + m.xp); } catch (e) { /* storage unavailable */ }
        g.stats.missionXp = (g.stats.missionXp || 0) + m.xp;
        g.hud.toast('MISSÃO CONCLUÍDA · ' + m.text, m.xp + ' XP'); g.audio.play('mission', null, 0.7);
        this.saveMissions();
      }
    }
  }
}
