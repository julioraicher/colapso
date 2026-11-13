import * as THREE from 'three';
import { World, setPalette, VS, SX, SY, SZ, MAT, MATDEF } from './world.js';
import { generate, FLAGS, BASES, G } from './mapgen.js';
import { Player } from './player.js';
import { WEAPONS, PRIMARIES, Viewmodel, damageAt } from './weapons.js';
import { Audio } from './audio.js';
import { FX } from './fx.js';
import { Nav, Bot, rayEntity } from './ai.js';
import { scanTunnel, Echo, E_MAX } from './abilities.js';
import { HUD } from './hud.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'colapso.settings.v1';
const DEF_SETTINGS = { sens: 1, adsSens: 0.7, fov: 78, vol: 0.8, quality: 'auto', invert: false, showFps: false };

class Game {
  constructor() {
    this.settings = Object.assign({}, DEF_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
    this.canvas = $('gl');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.autoClear = false;
    this.scale = this.settings.quality === 'low' ? 0.6 : this.settings.quality === 'high' ? 1 : 0.85;
    this.scene = new THREE.Scene();
    this.skyCol = new THREE.Color(0x0b1220);
    this.scene.background = this.skyCol.clone();
    this.scene.fog = new THREE.FogExp2(0x0d1522, 0.022);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 160);
    this.scene.add(new THREE.HemisphereLight(0x6f8fc0, 0x1a1a22, 1.1));
    const moon = new THREE.DirectionalLight(0x9fb8ff, 0.9); moon.position.set(-0.5, 1, 0.35); this.scene.add(moon);
    this.audio = new Audio(); this.audio.setVolume(this.settings.vol);
    this.vm = new Viewmodel();
    this.hud = new HUD(this);
    this.keys = {}; this.mouse = { l: false, r: false, dx: 0, dy: 0 };
    this.state = 'loading';
    this.entities = []; this.bots = []; this.grenades = [];
    this.time = 0; this.trauma = 0; this.fovPunch = 0;
    this.frameTimes = []; this.perf = { avg: 16, worst: 0 };
    this.bindInput(); this.bindUI();
    window.addEventListener('resize', () => this.resize()); this.resize();
  }
  saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1) * this.scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vm.cam.aspect = w / h; this.vm.cam.updateProjectionMatrix();
    if (this.fx) this.fx.setScale(h * Math.min(window.devicePixelRatio, 1) * this.scale);
  }

  async load() {
    const step = async (p, t) => { $('lbar').style.width = p + '%'; $('ltxt').textContent = t; await new Promise(r => setTimeout(r, 16)); };
    await step(5, 'paleta');
    setPalette({ bedrock: 0x15171c, dirt: 0x3a3430, grass: 0x2f5a3c, asphalt: 0x353a45, concrete: 0x8a929e, brick: 0x8a4a3c, wood: 0x7a5a3e,
      metal: 0x4c5664, glass: 0x7fe9ff, sand: 0x9a8a68, roof: 0x3a4250, paint: 0xd6dde6, rust: 0x9a5530, leaf: 0x2c6a4a, line: 0xe8c34a, trim: 0x2a8fa8 });
    const light = { sunV: new THREE.Vector3(-0.45, 1, 0.3).normalize(), sunCol: new THREE.Color(0.32, 0.38, 0.55), skyCol: new THREE.Color(0.2, 0.24, 0.34), groundCol: new THREE.Color(0.08, 0.08, 0.1) };
    this.world = new World(this.scene, light);
    await step(15, 'gerando instituto');
    generate(this.world, 1337);
    await step(35, 'propagando luz');
    this.world.computeLight();
    await step(50, 'malha voxel');
    this.world.buildAll();
    await step(70, 'navegação');
    this.nav = new Nav(this.world);
    this.colTop = new Uint8Array(SX * SZ); this.updateColTop(0, 0, SX - 1, SZ - 1);
    this.world.onChange = (a, b, c, d) => { this.nav.rebuildVox(a, b, c, d); this.hud.markMap(a, b, c, d); this.updateColTop(a, b, c, d); };
    this.world.onFall = (cells) => this.onCollapse(cells);
    await step(80, 'efeitos');
    this.fx = new FX(this.scene, this.world);
    this.buildSky(); this.buildRain(); this.resize();
    await step(90, 'áudio');
    this.player = new Player(this.world);
    this.pent = { isPlayer: true, p: this.player, team: 0, name: 'VOCÊ', kills: 0, deaths: 0, score: 0, caps: 0,
      get alive() { return this.p.alive; }, get pos() { return this.p.pos; }, get chest() { return this.chestPos(); },
      chestPos() { return new THREE.Vector3(this.p.pos.x, this.p.pos.y + this.p.h * 0.72, this.p.pos.z); },
      hurt: (d, now, from) => this.playerHurt(d, from) };
    this.echo = new Echo(this);
    this.hud.buildMinimap();
    await step(96, 'compilando shaders');
    this.renderer.compile(this.scene, this.camera); this.renderer.compile(this.vm.scene, this.vm.cam);
    await step(100, 'pronto');
    $('loading').classList.add('hidden');
    this.state = 'menu'; this.show('menu');
    this.lastT = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  updateColTop(a, b, c, d) {
    for (let z = Math.max(0, b); z <= Math.min(SZ - 1, d); z++) for (let x = Math.max(0, a); x <= Math.min(SX - 1, c); x++) {
      let y = SY - 1; while (y > 0 && !this.world.get(x, y, z)) y--; this.colTop[z * SX + x] = y + 1;
    }
  }
  buildSky() {
    // gradient dome with storm-cloud bands (vertex colours, no textures)
    const g = new THREE.SphereGeometry(120, 24, 12); const col = [];
    const p = g.attributes.position; const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 120; const x = p.getX(i), z = p.getZ(i);
      const n = Math.sin(x * 0.05) * Math.cos(z * 0.04) * 0.5 + 0.5;
      c.setRGB(0.04 + 0.05 * n * (1 - y), 0.06 + 0.06 * n * (1 - y), 0.1 + 0.08 * n * (1 - y));
      if (y < 0.1) c.setRGB(0.07, 0.09, 0.13);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(g, this.skyMat); this.sky.renderOrder = -1; this.scene.add(this.sky);
    this.lightning = 0; this.nextLightning = 6;
  }
  buildRain() {
    const N = this.settings.quality === 'low' ? 700 : 1400; this.rainN = N;
    this.rainP = new Float32Array(N * 6); this.rainOff = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.rainOff[i * 3] = Math.random() * 40 - 20; this.rainOff[i * 3 + 1] = Math.random() * 20; this.rainOff[i * 3 + 2] = Math.random() * 40 - 20; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.rainP, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x8fb0d0, transparent: true, opacity: 0.35, fog: true }));
    this.rain.frustumCulled = false; this.scene.add(this.rain);
  }

  // ---------------- match ----------------
  startMatch() {
    // clean previous
    for (const b of this.bots) this.scene.remove(b.model);
    this.bots = [];
    this.flags = FLAGS.map(f => ({ ...f, cap: 0, owner: -1, contested: false, n: [0, 0] }));
    this.tickets = [300, 300]; this.drainT = 0;
    for (let i = 0; i < 7; i++) this.bots.push(new Bot(this, 0));
    for (let i = 0; i < 8; i++) this.bots.push(new Bot(this, 1));
    this.entities = [this.pent, ...this.bots, this.echo];
    this.pent.kills = this.pent.deaths = this.pent.score = this.pent.caps = 0;
    for (const b of this.bots) { b.respawnT = 0.2 + Math.random() * 2; }
    this.player.alive = false;
    this.energy = E_MAX; this.nades = 2; this.loadout = this.loadout || 'k7';
    this.hud.reset();
    this.audio.init();
    this.openDeploy(true);
  }
  spawnPointFor(team, who) {
    const opts = [BASES[team]];
    for (const f of this.flags) if (f.owner === team && Math.abs(f.cap) >= 1 && !f.contested) opts.push(f);
    let pick = who && who.isBot && opts.length > 1 && Math.random() < 0.7 ? opts[1 + (Math.random() * (opts.length - 1) | 0)] : opts[Math.random() * opts.length | 0];
    if (who && who.chosenSpawn) pick = who.chosenSpawn;
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * (pick === BASES[team] ? 6 : 7);
      const p = new THREE.Vector3(pick.x + Math.cos(a) * r, 0, pick.z + Math.sin(a) * r);
      const h = this.nav.heightAt(p); if (h === null) continue;
      p.y = h;
      // avoid spawning in view of close enemies
      let bad = false; for (const e of this.entities) if (e.alive && e.team !== team && e.pos.distanceTo(p) < 12) bad = true;
      if (!bad) return p;
    }
    const b = BASES[team]; return new THREE.Vector3(b.x, G * VS, b.z);
  }
  spawnOptions() {
    const o = [{ ...BASES[0], label: 'BASE' }];
    for (const f of this.flags) if (f.owner === 0 && Math.abs(f.cap) >= 1 && !f.contested) o.push({ ...f, label: f.id });
    return o;
  }
  openDeploy(first) {
    this.state = 'deploy'; document.exitPointerLock && document.exitPointerLock();
    this.deploySel = this.spawnOptions()[0];
    this.show('deploy'); $('hud').classList.remove('hidden');
    $('dtitle').textContent = first ? 'IMPLANTAÇÃO · ESCOLHA ARMA E PONTO' : 'REIMPLANTAÇÃO';
    this.hud.drawDeploy();
  }
  deploy() {
    const s = this.deploySel || BASES[0];
    this.pent.chosenSpawn = s;
    const p = this.spawnPointFor(0, this.pent); this.pent.chosenSpawn = null;
    this.player.spawn(p, s === BASES[0] || !s.id ? 0 : Math.atan2(-(96 * VS - p.x), -(96 * VS - p.z)));
    if (s.id) this.player.yaw = this.player.yaw; // face map centre from flags
    this.weapons = { primary: { id: this.loadout, ...this.ammoFor(this.loadout) }, secondary: { id: 'p9', ...this.ammoFor('p9') } };
    this.slot = 'primary'; this.setWeapon('primary');
    this.energy = E_MAX; this.nades = 2; this.player.hp = 100;
    this.state = 'play'; this.show(null);
    this.lock();
    this.spawnProtect = 2;
  }
  ammoFor(id) { const w = WEAPONS[id]; return { mag: w.mag, reserve: w.reserve }; }
  get W() { return this.weapons[this.slot]; }
  get WD() { return WEAPONS[this.weapons[this.slot].id]; }
  setWeapon(slot) {
    this.slot = slot; this.vm.setWeapon(this.W.id, this.WD); this.reloadT = 0; this.fireCool = 0.3; this.audio.play('reload', null, 0.3, 1.6, 0);
  }

  // ---------------- input ----------------
  lock() { if (!this.testMode) this.canvas.requestPointerLock && this.canvas.requestPointerLock(); }
  bindInput() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') { e.preventDefault(); if (this.state === 'play') this.show('score', true); }
      this.keys[e.code] = true;
      if (this.state !== 'play') { if (e.code === 'Escape' && this.state === 'pause') this.resume(); return; }
      if (e.code === 'KeyR') this.startReload();
      if (e.code === 'Digit1' && this.slot !== 'primary') this.setWeapon('primary');
      if (e.code === 'Digit2' && this.slot !== 'secondary') this.setWeapon('secondary');
      if (e.code === 'KeyG') this.playerGrenade();
      if (e.code === 'KeyQ') this.tunnel();
      if (e.code === 'KeyE') this.superpose();
      if (e.code === 'KeyF' && this.state === 'play') this.toggleFps();
    });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'Tab') this.hud.hideScore(); });
    document.addEventListener('mousedown', (e) => {
      if (this.state !== 'play') return;
      if (!document.pointerLockElement && !this.testMode) { this.lock(); return; }
      if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true;
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) { this.mouse.l = false; this.triggerReleased = true; } if (e.button === 2) this.mouse.r = false; });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { if (this.state === 'play') this.setWeapon(this.slot === 'primary' ? 'secondary' : 'primary'); });
    document.addEventListener('mousemove', (e) => {
      if (this.state !== 'play' || (!document.pointerLockElement && !this.testMode)) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'play' && !this.testMode) this.pause();
    });
    window.addEventListener('blur', () => { this.keys = {}; this.mouse.l = this.mouse.r = false; });
  }
  toggleFps() { this.settings.showFps = !this.settings.showFps; this.saveSettings(); $('fps').classList.toggle('hidden', !this.settings.showFps); }
  pause() { this.state = 'pause'; this.show('pause'); this.mouse.l = false; }
  resume() { this.state = 'play'; this.show(null); this.lock(); }
  show(id, keep) {
    for (const k of ['menu', 'how', 'opts', 'pause', 'deploy', 'end', 'score']) $(k).classList.toggle('hidden', k !== id);
    if (id === 'menu') $('hud').classList.add('hidden');
  }
  bindUI() {
    const back = () => this.show(this.state === 'pause' ? 'pause' : 'menu');
    $('bPlay').onclick = () => { this.audio.init(); this.startMatch(); };
    $('bHow').onclick = () => this.show('how'); $('bHowBack').onclick = back;
    $('bOpt').onclick = () => { this.hud.fillOpts(); this.show('opts'); }; $('bOptBack').onclick = back;
    $('bQuit').onclick = () => { if (window.close) window.close(); };
    $('bResume').onclick = () => this.resume();
    $('bPOpt').onclick = () => { this.hud.fillOpts(); this.show('opts'); };
    $('bPHow').onclick = () => this.show('how');
    $('bMenu').onclick = () => { this.state = 'menu'; this.show('menu'); };
    $('bDeploy').onclick = () => this.deploy();
    $('bAgain').onclick = () => this.startMatch();
    $('bEndMenu').onclick = () => { this.state = 'menu'; this.show('menu'); };
  }

  // ---------------- combat ----------------
  startReload() {
    const W = this.W, D = this.WD;
    if (this.reloadT > 0 || W.mag >= D.mag || W.reserve <= 0) return;
    this.reloadT = D.reload; this.reloadDur = D.reload; this.audio.play('reload', null, 0.5, D.perShell ? 1.8 : 1, 0);
  }
  playerFire() {
    const W = this.W, D = this.WD, p = this.player;
    if (W.mag <= 0) { if (this.triggerReleased) { this.audio.play('empty', null, 0.6); this.triggerReleased = false; } this.startReload(); return; }
    if (this.reloadT > 0) { if (D.perShell && W.mag > 0) this.reloadT = 0; else return; }
    if (!D.auto && !this.triggerReleased) return;
    this.triggerReleased = false;
    W.mag--; this.fireCool = 60 / D.rpm;
    const eye = p.eye; const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const moving = Math.hypot(p.vel.x, p.vel.z) > 1 || !p.onGround;
    const ads = this.ads;
    let spread = D.spreadHip * (1 - ads) + D.spreadAds * ads + (moving ? D.spreadMove : 0) + this.bloom;
    if (p.crouch) spread *= 0.75;
    this.bloom = Math.min(0.03, this.bloom + (D.auto ? 0.0025 : 0.006) * (1 - ads * 0.6));
    const target = eye.clone().addScaledVector(dir, 100);
    const muzzle = this.muzzleWorld();
    this.fireBullet(this.pent, eye, target, D, spread, false, muzzle);
    // recoil: heavy & raw — vertical climb with partial recovery, horizontal jitter with bias
    const rk = (1 - ads * 0.3) * (p.crouch ? 0.8 : 1);
    const v = D.recoilV * rk * (0.85 + Math.random() * 0.3);
    const h = D.recoilH * rk * ((Math.random() * 2 - 1) + D.recoilBias);
    this.recoilP += v; p.pitch += v; p.yaw -= h;
    this.trauma = Math.min(1, this.trauma + 0.12 * D.kick);
    this.vm.fire(D.kick);
    this.fx.muzzle(muzzle);
    this.audio.play(D.snd, null, 0.9, 1, 0.35);
    // neighbours hear you: reveal on enemy minimap / alert bots nearby
    this.pent.spottedT = 2.5;
    for (const b of this.bots) if (b.alive && b.team === 1 && b.pos.distanceTo(p.pos) < 40 && !b.target) { b.lastSeen = p.pos.clone(); b.lastSeenT = this.time; }
  }
  muzzleWorld() {
    const m = new THREE.Vector3(); this.vm.cur.userData.muzzle.getWorldPosition(m);
    // viewmodel space → world: vm camera sits at origin looking −Z; same frame as main camera
    return m.applyMatrix4(this.camera.matrixWorld);
  }
  // Generic hitscan. shooter: entity; from: ray origin; to: aim point; spread: cone half-angle (rad)
  fireBullet(shooter, from, to, D, spread, isEcho = false, muzzleOverride = null) {
    const base = new THREE.Vector3().subVectors(to, from).normalize();
    const muzzle = muzzleOverride || from;
    if (shooter !== this.pent && !isEcho) { this.audio.play(D.snd, muzzle, 1.0, 1, 0.3); this.fx.muzzle(muzzle); if (shooter.team === 1) shooter.spottedT = 2.5; }
    if (isEcho) this.audio.play(D.snd, muzzle, 0.8, 1.15, 0.3);
    for (let k = 0; k < D.pellets; k++) {
      // uniform sample within cone
      const d = base.clone();
      if (spread > 0) {
        const u = Math.random(), a = Math.random() * Math.PI * 2, r = Math.sqrt(u) * spread;
        const t1 = new THREE.Vector3().crossVectors(d, Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
        const t2 = new THREE.Vector3().crossVectors(d, t1);
        d.addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
      }
      const wh = this.world.raycast(from, d, D.range);
      let maxT = wh ? wh.dist : D.range;
      let hitE = null, hitR = null;
      for (const e of this.entities) {
        if (!e.alive || e === shooter || e.team === shooter.team) continue;
        if (e.isPlayer && (e.p.phased || this.spawnProtect > 0)) continue;
        const r = rayEntity(from, d, e.pos, e.isPlayer ? e.p.crouch : e.crouch, maxT);
        if (r && r.t < maxT) { maxT = r.t; hitE = e; hitR = r; }
      }
      const end = from.clone().addScaledVector(d, maxT);
      if (Math.random() < (D.pellets > 1 ? 0.3 : 0.5)) this.fx.tracer(muzzle, end, shooter.team === 0 ? [1, 0.85, 0.55] : [1, 0.55, 0.3]);
      // near-miss whiz + suppression for player
      if (shooter.team !== 0 && this.player.alive) {
        const pe = this.player.eye; const tt = pe.clone().sub(from).dot(d);
        if (tt > 0 && tt < maxT) { const cp = from.clone().addScaledVector(d, tt); const dd = cp.distanceTo(pe); if (dd < 1.6 && dd > 0.3 && Math.random() < 0.4) { this.audio.play('whiz', cp, 1.2); this.suppress = Math.min(1, this.suppress + 0.15); } }
      }
      if (hitE) {
        const dmg = damageAt(D, maxT) * (hitR.head ? D.head : 1);
        this.fx.blood(end, d);
        const wasAlive = hitE.alive;
        hitE.hurt(dmg, this.time, shooter);
        if (hitE.isBot && !hitE.alive && wasAlive) { hitE.fallDir = 1; this.onKill(shooter, hitE, hitR.head); }
        if (shooter === this.pent || shooter === this.echo) { this.hud.hit(!hitE.alive, hitR.head); this.audio.play(hitE.alive ? 'hit' : 'kill', null, 0.5, hitR.head ? 1.3 : 1, 0); }
        else this.audio.play('flesh', end, 0.7);
      } else if (wh) {
        const n = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
        this.fx.impact(end, n, wh.m);
        const broke = this.world.damageVoxel(wh.x, wh.y, wh.z, D.vox);
        if (broke) { this.fx.debris(end.x, end.y, end.z, n.x * 2 + d.x, 2, n.z * 2 + d.z, broke, 0.5, 2.5); if (broke === MAT.GLASS) this.audio.play('debris', end, 0.4, 2.2); }
        if (Math.random() < 0.25) this.audio.play(wh.m === MAT.METAL || wh.m === MAT.RUST ? 'ricochet' : 'impact', end, 0.5);
      }
    }
  }
  onKill(killer, victim, head) {
    if (!killer) return;
    const kname = killer === this.echo ? 'ECO (VOCÊ)' : killer.name;
    this.hud.feed(kname, victim.name, killer.team, head, killer === this.pent || killer === this.echo, victim === this.pent);
    if (killer === this.pent || killer === this.echo) { this.scavenge(); this.pent.kills++; this.pent.score += head ? 150 : 100; this.hud.toast(head ? 'ABATE · TIRO NA CABEÇA' : 'ABATE', head ? 150 : 100); }
    else if (killer.kills !== undefined) killer.kills++;
    if (victim.team !== undefined) this.tickets[victim.team] = Math.max(0, this.tickets[victim.team] - 1);
  }
  scavenge() {
    if (!this.weapons) return;
    for (const k of ['primary', 'secondary']) { const W = this.weapons[k], D = WEAPONS[W.id]; W.reserve = Math.min(D.reserve, W.reserve + Math.ceil(D.mag * (k === 'primary' ? 0.5 : 0.34))); }
  }
  resupply(dt) {
    // standing in base or an owned flag zone slowly refills ammo & grenades
    const p = this.player.pos; let ok = Math.hypot(p.x - BASES[0].x, p.z - BASES[0].z) < 12;
    for (const f of this.flags) if (f.owner === 0 && f.cap >= 1 && this.inFlag(f)) ok = true;
    if (!ok) { this.resT = 0; return; }
    this.resT = (this.resT || 0) + dt;
    if (this.resT > 2.5) { this.resT = 0; let got = false;
      for (const k of ['primary', 'secondary']) { const W = this.weapons[k], D = WEAPONS[W.id]; if (W.reserve < D.reserve) { W.reserve = Math.min(D.reserve, W.reserve + Math.ceil(D.mag / 3)); got = true; } }
      if (this.nades < 2) { this.nades++; got = true; }
      if (got) this.audio.play('reload', null, 0.25, 1.4, 0);
    }
  }
  playerHurt(d, from) {
    const p = this.player; if (!p.alive || this.spawnProtect > 0 || p.phased) return;
    p.hurt(d, this.time);
    this.hud.damage(from ? (from.pos || from.p.pos) : null);
    this.trauma = Math.min(1, this.trauma + 0.25); this.audio.play('hurt', null, 0.6, 1, 0);
    if (!p.alive) {
      this.pent.deaths++; this.tickets[0] = Math.max(0, this.tickets[0] - 1);
      this.hud.feed(from ? (from.name || '???') : 'AMBIENTE', 'VOCÊ', from ? from.team : 1, false, false, true);
      if (this.echo.alive) this.echo.kill(false);
      this.deathT = 3.5; this.killer = from;
      this.hud.toast(from && from.name ? `ABATIDO POR ${from.name}` : 'VOCÊ MORREU', 0, true);
      this.mouse.l = false;
    }
  }
  // ---------------- explosives ----------------
  playerGrenade() { if (this.nades <= 0 || !this.player.alive) return; this.nades--; const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); this.throwGrenade(this.pent, this.player.eye, null, dir); }
  throwGrenade(owner, from, target, dirIn) {
    let v;
    if (dirIn) v = dirIn.clone().multiplyScalar(17).add(new THREE.Vector3(0, 3.5, 0));
    else {
      // ballistic solve (45°-ish lob) for bots: v² = g d / sin2θ
      const d = new THREE.Vector3(target.x - from.x, 0, target.z - from.z); const dist = d.length(); d.normalize();
      const sp = Math.min(19, Math.sqrt(19 * dist / Math.sin(2 * 0.6)));
      v = d.multiplyScalar(sp * Math.cos(0.6)); v.y = sp * Math.sin(0.6);
    }
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), new THREE.MeshLambertMaterial({ color: 0x2a3a2a, emissive: owner.team === 0 ? 0x2288aa : 0xaa5522 }));
    mesh.position.copy(from); this.scene.add(mesh);
    this.grenades.push({ p: from.clone(), v, t: 2.4, owner, mesh });
    this.audio.play('pin', from, 0.8);
  }
  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]; g.t -= dt; g.v.y -= 19 * dt;
      const np = g.p.clone().addScaledVector(g.v, dt);
      const vx = Math.floor(np.x / VS), vy = Math.floor(np.y / VS), vz = Math.floor(np.z / VS);
      if (this.world.get(vx, vy, vz)) {
        const ox = Math.floor(g.p.x / VS), oy = Math.floor(g.p.y / VS), oz = Math.floor(g.p.z / VS);
        if (ox !== vx && this.world.get(vx, oy, oz)) g.v.x *= -0.4; if (oy !== vy) { g.v.y *= -0.35; g.v.x *= 0.7; g.v.z *= 0.7; } if (oz !== vz && this.world.get(ox, oy, vz)) g.v.z *= -0.4;
        if (Math.abs(g.v.y) > 2) this.audio.play('impact', g.p, 0.3, 0.6);
      } else g.p.copy(np);
      g.mesh.position.copy(g.p); g.mesh.rotation.x += dt * 10;
      if (g.t <= 0) { this.scene.remove(g.mesh); this.grenades.splice(i, 1); this.explode(g.p, 2.8, g.owner); }
    }
  }
  explode(c, r, owner) {
    const res = this.world.explode(c, r, 1);
    this.fx.explosion(c, r);
    this.audio.play('explosion', c, 1.6, 1, 0.5);
    if (res.removed.length > 10) this.audio.play('debris', c, 1, 1);
    // debris: sample removed voxels
    const step = Math.max(1, Math.floor(res.removed.length / 90));
    for (let i = 0; i < res.removed.length; i += step) {
      const q = res.removed[i]; const px = (q.x + 0.5) * VS, py = (q.y + 0.5) * VS, pz = (q.z + 0.5) * VS;
      const dx = px - c.x, dy = py - c.y, dz = pz - c.z; const L = Math.hypot(dx, dy, dz) + 0.1;
      const s = 6 + Math.random() * 8;
      this.fx.debris(px, py, pz, dx / L * s, dy / L * s + 4, dz / L * s, q.m, 0.5 + Math.random() * 0.5, 4);
    }
    // damage with LOS & falloff (impulse ~ 1/r²-ish clipped)
    const R = 7;
    for (const e of this.entities) {
      if (!e.alive) continue;
      const ep = e.isPlayer ? e.chestPos() : e.chest; const d = ep.distanceTo(c);
      if (d > R) continue;
      if (!this.world.los(c.clone().add(new THREE.Vector3(0, 0.3, 0)), ep) && d > 2) continue;
      if (e.team === owner.team && e !== owner) continue; // no friendly fire (self-damage allowed)
      const dmg = 140 * Math.pow(1 - d / R, 1.4);
      const was = e.alive; e.hurt(dmg, this.time, owner);
      if (e.isBot && was && !e.alive) { e.fallDir = 1; this.onKill(owner, e, false); }
      if (owner === this.pent && e !== this.pent) this.hud.hit(!e.alive, false);
    }
    const pd = this.player.eye.distanceTo(c);
    if (pd < 6 && this.player.alive) { const k = (1 - pd / 6) * 9; const dir = this.player.eye.sub(c).normalize(); this.player.vel.addScaledVector(dir, k); this.player.vel.y += k * 0.4; }
    this.trauma = Math.min(1, this.trauma + Math.max(0, 1 - pd / 25));
    if (pd < 10) this.hud.flash(0.4 * (1 - pd / 10));
  }
  onCollapse(cells) {
    // structural failure: unsupported chunks fall as debris (subsampled for perf)
    const step = Math.max(1, Math.floor(cells.length / 220));
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < cells.length; i += step) {
      const q = cells[i]; const px = (q.x + 0.5) * VS, py = (q.y + 0.5) * VS, pz = (q.z + 0.5) * VS;
      this.fx.debris(px, py, pz, (Math.random() - 0.5) * 1.5, -1 - Math.random() * 2, (Math.random() - 0.5) * 1.5, q.m, 0.9 + Math.random() * 0.3, 5 + Math.random() * 2);
      cx += px; cy += py; cz += pz;
    }
    const n = Math.ceil(cells.length / step); const c = new THREE.Vector3(cx / n, cy / n, cz / n);
    if (cells.length > 30) { this.audio.play('debris', c, 1.4, 0.7); this.audio.play('explosion', c, 0.5, 0.5); this.trauma = Math.min(1, this.trauma + 0.3); }
    // crush entities under falling mass
    if (cells.length > 40) for (const e of this.entities) {
      if (!e.alive) continue; const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
      if (d < 3 && e.pos.y < c.y) { const was = e.alive; e.hurt(60, this.time, null); if (e.isBot && was && !e.alive) this.hud.feed('COLAPSO ESTRUTURAL', e.name, -1, false, false, false); }
    }
  }
  // ---------------- quantum abilities ----------------
  tunnel() {
    const p = this.player; if (!p.alive || this.phase) return;
    const s = scanTunnel(this.world, p.pos, p.yaw);
    let to, cost;
    if (s && s.exit) { to = s.exit; cost = s.cost; }
    else if (!s) { // free dash
      cost = 18; const dir = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      to = p.pos.clone(); for (let k = 1; k <= 12; k++) { const q = p.pos.clone().addScaledVector(dir, k * 0.5); if (this.world.boxHits(q.x - 0.32, q.y + 0.02, q.z - 0.32, q.x + 0.32, q.y + p.h, q.z + 0.32)) break; to = q; }
    } else { this.hud.toast('BARREIRA ESPESSA DEMAIS · T ≈ 0', 0, true); this.audio.play('empty', null, 0.6); return; }
    if (cost > this.energy) { this.hud.toast('ENERGIA INSUFICIENTE', 0, true); this.audio.play('empty', null, 0.6); return; }
    this.energy -= cost;
    this.phase = { from: p.pos.clone(), to, t: 0, dur: 0.22 + (s && s.exit ? s.d * 0.06 : 0) };
    p.phased = true; this.fovPunch = 14; this.audio.play('ability', null, 0.7, 1.4, 0.3);
    this.fx.quantum(p.eye, 30, [0.3, 1, 1]);
    this.hud.quantum(0.9);
  }
  updatePhase(dt) {
    const ph = this.phase, p = this.player; if (!ph) return;
    ph.t += dt; const k = Math.min(1, ph.t / ph.dur); const e = k * k * (3 - 2 * k);
    p.pos.lerpVectors(ph.from, ph.to, e); p.vel.set(0, 0, 0);
    if (k >= 1) { this.phase = null; p.phased = false; p.vel.set(-Math.sin(p.yaw) * 4, 0, -Math.cos(p.yaw) * 4); this.fx.quantum(p.eye, 25, [0.3, 1, 1]); this.audio.play('abilityEnd', null, 0.5, 1.4); }
  }
  superpose() {
    const p = this.player; if (!p.alive) return;
    if (this.echo.alive) { // collapse onto the echo
      const from = p.pos.clone(); const to = this.echo.pos.clone();
      this.fx.quantum(p.eye, 50, [1, 0.4, 1]);
      this.echo.kill(false);
      p.pos.copy(to); p.vel.set(0, 0, 0);
      this.fx.quantum(p.eye, 50, [1, 0.4, 1]);
      this.audio.play('abilityEnd', null, 0.8, 0.8); this.hud.quantum(1); this.fovPunch = 10;
      this.hud.toast('COLAPSO DA FUNÇÃO DE ONDA', 0);
      // bots tracking the old position lose you
      for (const b of this.bots) if (b.target === this.pent) { b.seeT = 0; b.lastSeen = from; }
      return;
    }
    if (this.energy < 50) { this.hud.toast('ENERGIA INSUFICIENTE', 0, true); this.audio.play('empty', null, 0.6); return; }
    this.energy -= 50;
    this.echo.start(p.pos.clone(), p.yaw, WEAPONS[this.weapons.primary.id].type === 'shotgun' ? WEAPONS.k7 : WEAPONS[this.weapons.primary.id]);
    this.fx.quantum(p.eye, 40, [0.4, 1, 1]); this.audio.play('ability', null, 0.8, 1); this.hud.quantum(0.6);
    this.hud.toast('SUPERPOSIÇÃO · [E] PARA COLAPSAR', 0);
  }
  onEchoLost() { this.hud.toast('DECOERÊNCIA · ECO PERDIDO', 0, true); this.audio.play('lost', null, 0.4); }

  // ---------------- conquest ----------------
  updateFlags(dt) {
    let own = [0, 0];
    for (const f of this.flags) {
      f.n = [0, 0];
      for (const e of this.entities) { if (!e.alive || e.isEcho) continue; if (Math.hypot(e.pos.x - f.x, e.pos.z - f.z) < 7.5 && Math.abs(e.pos.y - 1) < 6) f.n[e.team]++; }
      const diff = f.n[0] - f.n[1]; f.contested = f.n[0] > 0 && f.n[1] > 0;
      const prevOwner = f.owner, prevFull = Math.abs(f.cap) >= 1;
      if (diff !== 0) {
        f.cap = THREE.MathUtils.clamp(f.cap + Math.sign(diff) * Math.min(3, Math.abs(diff)) * dt * 0.09, -1, 1);
        if (f.cap >= 1) f.owner = 0; else if (f.cap <= -1) f.owner = 1; else if ((f.owner === 0 && f.cap <= 0) || (f.owner === 1 && f.cap >= 0)) f.owner = -1;
      }
      if (f.owner !== prevOwner || (Math.abs(f.cap) >= 1) !== prevFull) {
        if (f.owner === 0 && f.cap >= 1) { this.audio.play('capture', null, 0.5, 1, 0); this.hud.toast('PONTO ' + f.id + ' CAPTURADO', f.n[0] && this.inFlag(f) ? 200 : 0); if (this.inFlag(f)) { this.pent.score += 200; this.pent.caps++; } }
        if (f.owner === 1 && f.cap <= -1) { this.audio.play('lost', null, 0.5, 1, 0); this.hud.toast('PONTO ' + f.id + ' PERDIDO', 0, true); }
      }
      if (f.owner >= 0 && Math.abs(f.cap) >= 1) own[f.owner]++;
    }
    // ticket bleed: team with more flags drains the other
    this.drainT += dt;
    if (this.drainT > 4) { this.drainT = 0; if (own[0] > own[1]) this.tickets[1] = Math.max(0, this.tickets[1] - (own[0] - own[1])); if (own[1] > own[0]) this.tickets[0] = Math.max(0, this.tickets[0] - (own[1] - own[0])); }
    if ((this.tickets[0] <= 0 || this.tickets[1] <= 0) && this.state === 'play') this.endMatch(this.tickets[1] <= 0);
  }
  inFlag(f) { const p = this.player.pos; return this.player.alive && Math.hypot(p.x - f.x, p.z - f.z) < 7.5; }
  endMatch(win) {
    this.state = 'end'; document.exitPointerLock && document.exitPointerLock();
    $('endT').textContent = win ? 'VITÓRIA' : 'DERROTA';
    $('endS').textContent = `ABATES ${this.pent.kills} · MORTES ${this.pent.deaths} · CAPTURAS ${this.pent.caps} · PONTOS ${this.pent.score}`;
    this.show('end'); this.audio.play(win ? 'capture' : 'lost', null, 0.7);
  }

  // ---------------- main loop ----------------
  loop(t) {
    requestAnimationFrame((t2) => this.loop(t2));
    let dt = Math.min(0.05, (t - this.lastT) / 1000); this.lastT = t;
    if (this.testMode && this.fixedDt) dt = this.fixedDt;
    this.frame(dt);
  }
  frame(dt) {
    const t0 = performance.now();
    if (this.state === 'play' || this.state === 'deploy' || this.state === 'pause' || this.state === 'end') {
      if (this.state !== 'pause') this.update(dt);
    } else {
      // menu: slow cinematic orbit
      this.time += dt;
      const a = this.time * 0.05; this.camera.position.set(48 + Math.cos(a) * 30, 14, 48 + Math.sin(a) * 30); this.camera.lookAt(48, 4, 48);
      this.updateWeather(dt); if (this.sky) this.sky.position.copy(this.camera.position);
    }
    this.world && this.world.update(this.state === 'play' ? 4 : 8);
    this.render();
    // adaptive resolution (auto quality): keep frame time near 16.7 ms
    const ft = performance.now() - t0; this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length >= 60) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length; this.perf.avg = avg; this.perf.worst = Math.max(...this.frameTimes);
      this.frameTimes.length = 0;
      if (this.settings.quality === 'auto' && !this.testMode) {
        if (avg > 22 && this.scale > 0.5) { this.scale = Math.max(0.5, this.scale - 0.1); this.resize(); }
        else if (avg < 14 && this.scale < 1) { this.scale = Math.min(1, this.scale + 0.05); this.resize(); }
      }
      if (this.settings.showFps) $('fps').textContent = `${(1000 / avg).toFixed(0)} FPS · ${avg.toFixed(1)} ms · res ${(this.scale * 100) | 0}%`;
    }
  }
  updateWeather(dt) {
    // rain follows camera
    const cp = this.camera.position; const P = this.rainP, O = this.rainOff;
    const top = this.colTop;
    for (let i = 0; i < this.rainN; i++) {
      O[i * 3 + 1] -= dt * 22; if (O[i * 3 + 1] < -4) O[i * 3 + 1] += 22;
      const x = cp.x + O[i * 3] - 1.5, z = cp.z + O[i * 3 + 2]; let y = cp.y + O[i * 3 + 1];
      const cx = (x / VS) | 0, cz = (z / VS) | 0;
      if (top && cx >= 0 && cz >= 0 && cx < SX && cz < SZ && y < top[cz * SX + cx] * VS) y = -100;
      P[i * 6] = x; P[i * 6 + 1] = y; P[i * 6 + 2] = z; P[i * 6 + 3] = x + 0.08; P[i * 6 + 4] = y + 0.55; P[i * 6 + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    // lightning: double-strobe, brightens baked world via material colour multiplier + delayed thunder
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      this.nextLightning = 9 + Math.random() * 16; this.lightning = 1; this.lightningPh = 0;
      const dist = 300 + Math.random() * 900; // metres → thunder delay = d / 343
      setTimeout(() => this.audio.play('explosion', null, 0.35 * (1 - dist / 1400) + 0.1, 0.35, 0.8), dist / 343 * 1000);
    }
    if (this.lightning > 0) {
      this.lightningPh += dt; const k = this.lightningPh;
      const I = (k < 0.06 ? 1 : k < 0.12 ? 0.2 : k < 0.2 ? 0.8 : Math.max(0, 0.8 - (k - 0.2) * 3));
      if (k > 0.5) this.lightning = 0;
      const m = 1 + I * 1.6; this.world.mat.color.setRGB(m, m, m * 1.05);
      this.scene.background.setRGB(0.04 + I * 0.4, 0.07 + I * 0.45, 0.12 + I * 0.55);
      this.scene.fog.color.setRGB(0.05 + I * 0.3, 0.08 + I * 0.33, 0.13 + I * 0.4);
      this.skyMat.color.setScalar(1 + I * 5);
    } else { this.world.mat.color.setRGB(1, 1, 1); this.skyMat.color.setScalar(1); this.scene.background.copy(this.skyCol); this.scene.fog.color.setHex(0x0d1522); }
  }
  update(dt) {
    this.time += dt; const now = this.time; const p = this.player;
    if (this.spawnProtect > 0) this.spawnProtect -= dt;
    this.suppress = Math.max(0, (this.suppress || 0) - dt * 0.6);
    // --- player ---
    if (this.state === 'play' && p.alive) {
      const sens = 0.0022 * this.settings.sens * (this.ads > 0.5 ? this.settings.adsSens : 1);
      p.yaw -= this.mouse.dx * sens; p.pitch -= this.mouse.dy * sens * (this.settings.invert ? -1 : 1);
      // recoil recovery (partial: BF-like, player must pull down)
      const rec = Math.min(this.recoilP, this.recoilP * dt * 6); if (!this.mouse.l) { p.pitch -= rec * 0.55; this.recoilP -= rec; } else this.recoilP *= Math.exp(-dt * 0.5);
      p.pitch = THREE.MathUtils.clamp(p.pitch, -1.5, 1.5);
      const K = this.keys;
      const inp = { f: K.KeyW, b: K.KeyS, l: K.KeyA, r: K.KeyD, sprint: K.ShiftLeft || K.ShiftRight, crouch: K.ControlLeft || K.KeyC, jump: K.Space };
      if (this.botPilot) Object.assign(inp, this.botPilot(this));
      if (!this.phase) p.update(dt, inp, now, (v) => this.audio.play('step', null, 0.25 * v, 0.9 + Math.random() * 0.2, 0));
      this.updatePhase(dt);
      const wantAds = this.mouse.r && !p.sprint && this.reloadT <= 0;
      this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
      p.ads = this.ads;
      this.bloom = Math.max(0, this.bloom - dt * 0.06);
      // firing
      this.fireCool -= dt;
      if (this.mouse.l && this.fireCool <= 0 && !p.sprint && !this.phase) this.playerFire();
      if (p.sprint && this.reloadT > 0 && false) this.reloadT = 0;
      if (this.reloadT > 0) {
        this.reloadT -= dt;
        if (this.reloadT <= 0) {
          const W = this.W, D = this.WD;
          if (D.perShell) { if (W.reserve > 0 && W.mag < D.mag) { W.mag++; W.reserve--; this.audio.play('impact', null, 0.3, 1.5, 0); if (W.mag < D.mag && W.reserve > 0) this.reloadT = D.reload; } }
          else { const need = D.mag - W.mag, take = Math.min(need, W.reserve); W.mag += take; W.reserve -= take; }
        }
      }
      this.resupply(dt);
      // energy regen
      this.energy = Math.min(E_MAX, this.energy + dt * (this.echo.alive ? 0 : 7));
      if (p.hp <= 0 && p.alive) { p.alive = false; this.playerHurt(0, null); }
    } else if (this.state === 'play' && !p.alive) {
      this.deathT -= dt;
      if (this.deathT <= 0) this.openDeploy(false);
    }
    this.mouse.dx = this.mouse.dy = 0;
    // --- AI / world ---
    for (const b of this.bots) b.update(dt, now);
    this.echo.update(dt, now);
    for (const e of this.entities) if (e.spottedT > 0) e.spottedT -= dt;
    this.updateGrenades(dt);
    if (this.state === 'play') this.updateFlags(dt);
    this.fx.update(dt);
    this.updateWeather(dt);
    // --- camera ---
    const eye = p.alive ? p.eye : this.deathCam(dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma;
    const n1 = Math.sin(now * 47.3) * Math.cos(now * 23.1), n2 = Math.sin(now * 37.9 + 1.3) * Math.cos(now * 29.7);
    this.camera.position.copy(eye); if (p.alive) this.camera.position.y -= p.landKick * 0.12;
    this.camera.rotation.order = 'YXZ';
    const tilt = p.slideT > 0 ? 0.05 : 0;
    if (p.alive) this.camera.rotation.set(p.pitch + sh * n1 * 0.04, p.yaw + sh * n2 * 0.04, sh * n1 * 0.02 + tilt);
    this.fovPunch *= Math.exp(-dt * 6);
    const D = this.weapons ? this.WD : WEAPONS.k7;
    const baseFov = this.settings.fov + (p.sprint ? 6 : 0) + this.fovPunch;
    this.camera.fov = THREE.MathUtils.lerp(baseFov, D.fovAds, this.ads); this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);
    this.audio.setListener(eye, p.yaw);
    // viewmodel
    if (this.weapons) this.vm.update(dt, { mdx: 0, mdy: 0, sprint: p.sprint && Math.hypot(p.vel.x, p.vel.z) > 3, ads: this.ads, slide: p.slideT > 0, reloadT: this.reloadT, reloadDur: this.reloadDur || 1, bob: p.bob, moveK: Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 5) * (p.onGround ? 1 : 0.2), land: p.landKick, fov: 60 - this.ads * 10 });
    this.hud.update(dt);
  }
  deathCam(dt) {
    const p = this.player; const k = this.killer && this.killer.pos;
    const e = new THREE.Vector3(p.pos.x, p.pos.y + 2.5, p.pos.z);
    this.camera.position.copy(e);
    if (k) this.camera.lookAt(k.x, k.y + 1.3, k.z);
    return e.clone().add(new THREE.Vector3(0, (3 - (this.deathT || 0)) * 0.3, 0));
  }
  render() {
    const r = this.renderer;
    r.info.autoReset = false; r.info.reset();
    r.clear();
    if (this.state !== 'menu' && this.state !== 'loading') this.camera.rotation.order = 'YXZ';
    r.render(this.scene, this.camera);
    const scoped = this.weapons && this.WD.type === 'dmr' && this.ads > 0.9;
    document.getElementById('scope').classList.toggle('hidden', !(scoped && this.state === 'play'));
    if ((this.state === 'play' || this.state === 'pause') && this.player.alive && this.weapons && !this.phase && !scoped) {
      r.clearDepth(); r.render(this.vm.scene, this.vm.cam);
    }
  }
}

const game = new Game();
window.__game = game;
game.recoilP = 0; game.ads = 0; game.bloom = 0; game.fireCool = 0; game.reloadT = 0; game.triggerReleased = true; game.suppress = 0;
game.load().catch(e => { console.error(e); document.getElementById('ltxt').textContent = 'ERRO: ' + e.message; });
