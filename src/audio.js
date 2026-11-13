// COLAPSO audio engine. Sample based: every sound is a processed recording embedded by src/sounds/index.js
// (built by tools/audio/build-sounds.mjs, sources and licences in CREDITS.md). The original procedural sounds
// (src/audio-synth.js) stay as an automatic fallback for anything that is missing or fails to decode.
//
// Signal flow:  voice -> [air low-pass -> pan] -> gain -> bus (weapons | sfx | foley | ambience | music | ui)
//               world buses -> state low-pass (low health, shell shock, pause) -> master -> glue comp -> limiter
//               reverb send -> room / exterior convolvers, crossfaded by how much cover is above the listener
// The engine drives itself: once `audio.game` is set it polls the game 8 times a second (state, health, flags,
// tickets, reactor event, cover) for ambience, music and feel, and watches the player each frame from setListener().
import { FILES, META, AUDIO_CREDITS } from './sounds/index.js';
import { Synth } from './audio-synth.js';
import { WEAPONS } from './weapons.js';
import { MAT, VS } from './world.js';

export { AUDIO_CREDITS };

const C_SOUND = 343, MAX_VOICES = 40, MIN_GAIN = 0.004, MAX_DIST = 160, HALF_PI = Math.PI / 2;
// old sound class names and legacy calls keep working
const ALIAS = { rifle: 'gun_k7', smg: 'gun_vespa', sniper: 'gun_orion', shotgun: 'gun_martelo', dmr: 'gun_lanca', pistol: 'gun_p9', rocket: 'gun_rpg', reload: 'pickup', glass: 'glass_break', land: 'land_concrete' };
const SURF = ['concrete', 'metal', 'wood', 'dirt', 'grass', 'water', 'glass'];
const SURF_OF = new Uint8Array(64); // voxel material -> surface class (0 = concrete, asphalt, brick ...)
for (const m of [MAT.METAL, MAT.RUST, MAT.BARREL, MAT.CAR_A, MAT.CAR_B, MAT.CAR_C, MAT.PANEL]) if (m) SURF_OF[m] = 1;
if (MAT.WOOD) SURF_OF[MAT.WOOD] = 2;
for (const m of [MAT.DIRT, MAT.SAND, MAT.TIRE, MAT.OLIVE]) if (m) SURF_OF[m] = 3;
for (const m of [MAT.GRASS, MAT.LEAF]) if (m) SURF_OF[m] = 4;
if (MAT.WATER) SURF_OF[MAT.WATER] = 5;
if (MAT.GLASS) SURF_OF[MAT.GLASS] = 6;
const IMPACT_OF = ['imp_concrete', 'imp_metal', 'imp_wood', 'imp_dirt', 'imp_dirt', 'imp_water', 'imp_glass'];
const SHELL_OF = ['shell_concrete', 'shell_metal', 'shell_concrete', 'shell_dirt', 'shell_dirt', 'shell_dirt', 'shell_concrete'];
// which procedural buffer stands in for a sampled group
const SYN_OF = [[/^gun_(k7|arco)/, 'rifle'], [/^gun_(vespa|faisca)/, 'smg'], [/^gun_martelo/, 'shotgun'], [/^gun_(orion|vigia)/, 'sniper'], [/^gun_(p9|rajada)/, 'pistol'], [/^gun_rpg/, 'rocket'], [/^(gun_|far_)/, 'dmr'],
  [/^(explosion|exp_|thunder)/, 'explosion'], [/^(debris|collapse|glass_break)/, 'debris'], [/^(imp_|nade_bounce|shellIn)/, 'impact'], [/^(step_|land_|jump)/, 'step'], [/^(draw|bolt|pump|pickup|scope|rl_)/, 'reload'],
  [/^(empty|firemode|click|ui_)/, 'empty'], [/^(headshot|spot|tick|countdown)/, 'hit'], [/^(ricochet|whiz|flesh|hit|kill|capture|lost|ability|abilityEnd|siren|pin|hurt)$/, null]];
const CX = [0, 1.6, -1.6, 0, 0], CZ = [0, 0, 0, 1.6, -1.6]; // cover probes around the listener (m)

const smooth = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
const hold = (p, t) => { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t); };
// move a parameter towards v, without piling up automation events when nothing changed
const aim = (p, v, t, tc) => { if (p._v !== undefined && Math.abs(p._v - v) <= Math.abs(v) * 0.01 + 1e-4) return; p._v = v; p.setTargetAtTime(v, t, tc); };

export class Audio {
  constructor() {
    this.ctx = null; this.ready = false; this.loaded = false; this.failed = []; this.loadMs = 0;
    this.buf = {}; this.syn = {}; this.loopBuf = {}; this.tracks = null; this.amb = null;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.vol = 0.8; this.musicVol = 0.6; this.game = null; this.world = null;
    this.groups = META.groups; this.rr = {}; this.synOf = {};
    this.voices = []; this.vpool = []; this.lastStart = new Map(); this.stat = { started: 0, quiet: 0, dup: 0, capped: 0, stolen: 0 };
    this.occ = new Map(); this.occBudget = 6; this.indoor = 0;
    this.reloadSrc = []; this.lastImpact = 0; this.lastHover = 0; this.lastDuck = -1;
    this.fallV = 0; this.airN = 0; this._og = true; this._ads = false; this._p = { x: 0, y: 0, z: 0 };
    this.st = { state: '', lowHp: false, baseLP: 20000, shockT: 0, nextBeat: 0, nextBattle: 0, gustT: 0, gust: 0.3, heatT: -99, endT: -99, endDone: false, maxT: 1 };
    // every weapon gets its own recording: the fire call sites already play WEAPONS[id].snd
    for (const [id, D] of Object.entries(WEAPONS)) D.snd = 'gun_' + id;
    this.sheetIndex = {};
    for (const n in META.sprites) { const s = META.sprites[n]; (this.sheetIndex[s[0]] || (this.sheetIndex[s[0]] = [])).push([n, s[1], s[2]]); }
    if (typeof window !== 'undefined') {
      // the first gesture anywhere starts the engine, so the menu has sound before PLAY is pressed
      this._kick = () => { this.init(); if (this.ctx && this.ctx.state === 'running') { window.removeEventListener('pointerdown', this._kick, true); window.removeEventListener('keydown', this._kick, true); } };
      window.addEventListener('pointerdown', this._kick, true); window.addEventListener('keydown', this._kick, true);
      // the desktop build allows autoplay (electron/main.js), so its menu music can start without a click
      if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')) setTimeout(this._kick, 0);
    }
  }

  // ------------------------------------------------------------------ start-up
  // Idempotent. Returns a promise that resolves when every sample is decoded (nobody has to wait for it).
  init() {
    if (this._init) { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return this._init; }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return (this._init = Promise.resolve());
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return (this._init = Promise.resolve()); }
    this.buildGraph(); this.ready = true;
    this._init = this.load();
    this.timer = setInterval(() => this.poll(), 125);
    return this._init;
  }
  buildGraph() {
    const ctx = this.ctx; const G = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const LP = (f) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; b.Q.value = 0.5; return b; };
    const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.09; lim.connect(ctx.destination);
    const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -15; glue.knee.value = 10; glue.ratio.value = 4; glue.attack.value = 0.003; glue.release.value = 0.2; glue.connect(lim);
    this.out = lim;
    this.master = G(this.vol); this.master.connect(glue);
    this.worldLP = LP(20000); this.worldLP.connect(this.master);
    this.worldGain = G(0.45); this.worldGain.connect(this.worldLP);
    this.ambDuck = G(1); this.ambDuck.connect(this.worldGain);
    this.musLP = LP(20000); this.musLP.connect(this.master);
    this.musDuck = G(1); this.musDuck.connect(this.musLP);
    // a wide dip where footsteps and gun cracks live: the score never masks them
    const meq = ctx.createBiquadFilter(); meq.type = 'peaking'; meq.frequency.value = 2600; meq.Q.value = 0.6; meq.gain.value = -3.5; meq.connect(this.musDuck);
    this.bus = { w: G(1), s: G(1), f: G(1), a: G(0.9), m: G(this.musicVol), u: G(0.9) };
    this.bus.w.connect(this.worldGain); this.bus.s.connect(this.worldGain); this.bus.f.connect(this.worldGain);
    this.bus.a.connect(this.ambDuck); this.bus.m.connect(meq); this.bus.u.connect(this.master);
    // two impulse responses (2.9 s in total): a tight room and a wide exterior with slap-back echoes
    this.revIn = G(1);
    this.room = ctx.createConvolver(); this.room.buffer = this.makeIR(0.6, 3.4, false);
    this.ext = ctx.createConvolver(); this.ext.buffer = this.makeIR(2.3, 2.4, true);
    this.roomG = G(0.05); this.extG = G(0.34);
    this.revIn.connect(this.room); this.revIn.connect(this.ext); this.room.connect(this.roomG); this.ext.connect(this.extG);
    this.roomG.connect(this.worldGain); this.extG.connect(this.worldGain);
  }
  makeIR(sec, decay, exterior) {
    const sr = this.ctx.sampleRate, len = sr * sec | 0; const b = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len; lp += ((Math.random() * 2 - 1) - lp) * (0.75 - 0.7 * t); // the tail gets darker as it decays
        d[i] = lp * Math.pow(1 - t, decay) * (exterior ? 0.55 : 0.8);
      }
      if (exterior) { // discrete echoes off distant facades, a little different for each ear
        for (const [ms, g] of [[70, 0.5], [118, 0.42], [205, 0.3], [330, 0.2], [520, 0.12]]) {
          const p = (ms + (ch ? 9 : 0) + Math.random() * 6) * sr / 1000 | 0, n = sr * 0.006 | 0;
          for (let k = 0; k < n && p + k < len; k++) d[p + k] += (Math.random() * 2 - 1) * g * (1 - k / n);
        }
      } else for (let k = 0; k < 14; k++) d[(4 + Math.random() * 38) * sr / 1000 | 0] += (Math.random() * 2 - 1) * 0.7; // dense early reflections
    }
    return b;
  }
  async load() {
    const t0 = performance.now(); const jobs = [];
    try { this.initMusic(); } catch (e) { /* the score is optional */ }
    const syn = new Synth(); jobs.push(syn.synthAll().then(() => { this.syn = syn.buf; }).catch(() => {}));
    for (const name in FILES) {
      if (META.music[name]) continue; // music stays compressed and is streamed by an <audio> element
      jobs.push(this.decode(FILES[name]).then(b => this.adopt(name, b)).catch(() => { this.failed.push(name); }));
    }
    await Promise.all(jobs);
    try { this.startAmbience(); } catch (e) { /* ambience is optional */ }
    this.loaded = true; this.loadMs = Math.round(performance.now() - t0);
  }
  decode(bytes) {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); // decodeAudioData detaches its input
    return new Promise((res, rej) => { const p = this.ctx.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); });
  }
  // A decoded file is either a loop bed or a sprite sheet that is cut into one AudioBuffer per sound.
  adopt(name, b) {
    if (META.loops[name]) { this.loopBuf[name] = b; return; }
    const list = this.sheetIndex[name]; if (!list) return;
    const sr = b.sampleRate, nch = b.numberOfChannels;
    for (const [n, st, ln] of list) {
      const a = Math.min(b.length - 1, Math.round(st * sr)), len = Math.max(1, Math.min(b.length - a, Math.round(ln * sr)));
      const o = this.ctx.createBuffer(nch, len, sr);
      for (let c = 0; c < nch; c++) o.copyToChannel(b.getChannelData(c).subarray(a, a + len), c);
      this.buf[n] = o;
    }
  }

  // ------------------------------------------------------------------ public API
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  setMusicVolume(v) { this.musicVol = v; if (this.bus) this.bus.m.gain.value = v; }
  has(name) { return name === 'step' || name === 'impact' || !!(this.groups[name] || ALIAS[name] || this.buf[name] || this.syn[name]); }
  // What a name resolves to right now: { kind: 'sample' | 'synth' | null, variants, decoded }.
  status(name) {
    if (name === 'step') name = 'step_concrete_run'; else if (name === 'impact') name = 'imp_concrete';
    const G = this.groups[name] || this.groups[ALIAS[name]];
    if (G) { let d = 0; for (const v of G.v) if (this.buf[v]) d++; return { kind: d ? 'sample' : this.syn[this.fallback(name)] ? 'synth' : null, variants: G.v.length, decoded: d }; }
    return { kind: this.buf[name] ? 'sample' : this.syn[name] ? 'synth' : null, variants: 1, decoded: this.buf[name] ? 1 : 0 };
  }
  stats() { const now = this.ctx ? this.ctx.currentTime : 0; let n = 0; for (const v of this.voices) if (v.end > now) n++; return { voices: n, ...this.stat, loaded: this.loaded, loadMs: this.loadMs, failed: this.failed.slice(), buffers: Object.keys(this.buf).length, indoor: +this.indoor.toFixed(2), state: this.st.state }; }
  setListener(pos, yaw) {
    const L = this.listener; L.x = pos.x; L.y = pos.y; L.z = pos.z; L.yaw = yaw; this.occBudget = 6;
    const g = this.game; if (!g || !this.ready || g.state !== 'play') return;
    const p = g.player; if (!p || p.alive === false || !p.vel) return;
    // aiming foley
    const ads = g.ads > 0.5;
    if (ads !== this._ads) { this._ads = ads; let D = null; try { D = g.WD; } catch (e) { /* no weapon yet */ } this.fire(ads ? 'scope' : 'scopeback', null, D && D.sight === 'scope' ? 1 : 0.5, 1, 0, 0); }
    // jump and soft landings (hard landings arrive through the step callback, see step())
    const og = !!p.onGround;
    if (!og) { if (this._og && p.vel.y > 4) this.fire('jump', null, 1, 1, 0.05, 0); if (p.vel.y < this.fallV) this.fallV = p.vel.y; this.airN++; }
    else {
      if (!this._og && this.airN > 8 && this.fallV > -6 && this.fallV < -1.5) this.fire('land_' + SURF[this.surfaceAt(p.pos.x, p.pos.y, p.pos.z)], null, 0.4, 1.1, 0.08, 0);
      this.fallV = 0; this.airN = 0;
    }
    this._og = og;
  }
  // Play a sound by name. pos = null -> 2D (interface, the player's own weapon). Unknown names are ignored.
  play(name, pos = null, vol = 1, rate = 1, rev = 0.25) {
    if (!this.ready || this.ctx.state !== 'running') return;
    switch (name) {
      case 'step': this.step(pos, vol, rate); return;
      case 'impact': if (pos && rate <= 0.7) { name = 'nade_bounce'; rate = 1; vol *= 2; } else name = 'imp_concrete'; break; // legacy: grenade bounce is play('impact', p, v, 0.6)
      case 'debris': if (rate > 1.8) { name = 'glass_break'; rate = 1; vol *= 1.6; } else if (rate < 0.8) { name = 'collapse'; rate = 1; vol *= 0.8; } break; // legacy: glass = rate 2.2, collapse = rate 0.7
      case 'explosion': if (!pos && rate < 0.5) { name = 'thunder'; rate = 1; vol *= 2.4 * (1 - 0.3 * this.indoor); break; } // legacy thunder call (2D, rate 0.35)
      // falls through
      case 'explosion_rocket': case 'explosion_barrel': case 'explosion_big': if (pos) this.blastFeel(pos, vol); break;
      case 'hit': case 'kill': if (!pos && rate > 1.2 && rate < 1.5) this.fire('headshot', null, vol, 1, 0, 0); break; // rate 1.3 means head shot
      case 'capture': case 'lost': this.flagCue(name); break;
      case 'draw': this.cancelReload(); break;
      case 'bolt': this.casing(0.28, 'casing'); break;
      case 'pump': this.casing(0.2, 'casing'); break;
      case 'thunder': vol *= 1 - 0.3 * this.indoor; break;
      default: if (!pos && name.charCodeAt(0) === 103 && name.startsWith('gun_')) this.ownShot();
    }
    this.fire(name, pos, vol, rate, rev, 0);
  }
  // Interface feedback: 'hover' | 'click' | 'confirm' | 'back' | 'deploy' | 'tick' | 'error' | 'rank'.
  ui(name) {
    if (!this.ready || this.ctx.state !== 'running') return;
    if (name === 'hover') { const t = performance.now(); if (t - this.lastHover < 60) return; this.lastHover = t; }
    this.fire('ui_' + name, null, 1, 1, 0, 0);
  }
  // Bullet hit on the world: picks the sound from the voxel material, thins out bursts and far hits.
  impact(mat, pos) {
    if (!this.ready || this.ctx.state !== 'running' || !pos) return;
    const L = this.listener, dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > 4900) return;
    const now = this.ctx.currentTime, near = d2 < 196;
    if (now - this.lastImpact < (near ? 0.035 : 0.08) || (!near && Math.random() > 0.5)) return;
    this.lastImpact = now;
    const s = SURF_OF[mat] || 0, r = Math.random();
    if (s === 1 ? r < 0.5 : s === 0 && r < 0.14) this.fire('ricochet', pos, 0.55, 1, 0.3, 0);
    else this.fire(IMPACT_OF[s], pos, 0.6, 1, 0.2, 0);
  }
  // Reload foley for one weapon, timed to `duration` on the audio clock. Either the events cut from that weapon's
  // reload recording keep their relative timing, or a hand-built sequence is used (revolver, launcher, shotgun).
  reload(weaponId, def, duration) {
    if (!this.ready || this.ctx.state !== 'running') return;
    this.cancelReload();
    const R = META.reloadMap[weaponId] || { src: 'ak74' }; const t0 = this.ctx.currentTime + 0.03, dur = duration || (def && def.reload) || 2;
    if (R.seq) { for (const e of R.seq) this.sched(e[0], t0 + e[1] * dur, e[2], e[3]); return; }
    const S = META.reloads[R.src], rate = R.rate || 1; if (!S) return;
    const ev = S.ev, last = ev[ev.length - 1], lb = this.buf[last[0]]; const tail = lb ? lb.duration / rate : 0.4;
    const k = Math.min(1, (dur + 0.06 - tail) / Math.max(0.01, last[1] * dur)); // squeeze so the last action ends inside the reload
    for (const e of ev) this.sched(e[0], t0 + e[1] * dur * k, 0.95, rate);
  }
  cancelReload() { const R = this.reloadSrc; for (let i = 0; i < R.length; i++) { try { R[i].stop(); } catch (e) { /* already ended */ } } R.length = 0; }
  sched(n, when, gain, rate) {
    const G = this.groups[n]; const b = this.buf[G ? this.pick(n, G) : n] || this.syn.reload; if (!b) return;
    const ctx = this.ctx, s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = b; s.playbackRate.value = rate * (0.98 + Math.random() * 0.04); g.gain.value = gain * (G ? G.g : 0.8);
    s.connect(g); g.connect(this.bus.f); s.start(when); this.reloadSrc.push(s);
  }

  // ------------------------------------------------------------------ voices
  pick(name, G) { const n = G.v.length; if (n === 1) return G.v[0]; let i = this.rr[name]; i = i === undefined ? Math.random() * n | 0 : (i + 1 + (Math.random() * (n - 1) | 0)) % n; this.rr[name] = i; return G.v[i]; }
  fallback(name) { let s = this.synOf[name]; if (s !== undefined) return s; s = name; for (const [re, to] of SYN_OF) if (re.test(name)) { s = to || name; break; } return (this.synOf[name] = s); }
  // One voice. lpf === undefined -> 2D. Applies the voice budget: quiet, duplicate and excess voices never start.
  voice(buf, bus, gain, rate, when, key, lpf, pan, send) {
    const ctx = this.ctx, now = ctx.currentTime, S = this.stat, V = this.voices;
    if (gain < MIN_GAIN) { S.quiet++; return; }
    const last = this.lastStart.get(key); if (last !== undefined && Math.abs(when - last) < 0.015) { S.dup++; return; }
    let n = V.length;
    for (let i = n - 1; i >= 0; i--) { const v = V[i]; if (v.end <= now) { v.src = v.g = null; this.vpool.push(v); V[i] = V[--n]; V.length = n; } }
    const score = lpf === undefined ? gain * 1.6 : gain; // near, loud and 2D sounds win
    if (n >= MAX_VOICES) {
      let w = 0; for (let i = 1; i < n; i++) if (V[i].score < V[w].score) w = i;
      if (score <= V[w].score) { S.capped++; return; }
      const v = V[w]; try { v.g.gain.setTargetAtTime(0, now, 0.008); v.src.stop(now + 0.05); } catch (e) { /* already stopped */ }
      v.src = v.g = null; this.vpool.push(v); V[w] = V[--n]; V.length = n; S.stolen++;
    }
    this.lastStart.set(key, when);
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; s.playbackRate.value = rate; g.gain.value = gain;
    if (lpf !== undefined) {
      const f = ctx.createBiquadFilter(), p = ctx.createStereoPanner(); f.type = 'lowpass'; f.frequency.value = lpf; f.Q.value = 0.5; p.pan.value = pan;
      s.connect(f); f.connect(p); p.connect(g);
    } else s.connect(g);
    g.connect(bus);
    if (send > 0.01) { const rg = ctx.createGain(); rg.gain.value = send; g.connect(rg); rg.connect(this.revIn); }
    s.start(when);
    const v = this.vpool.pop() || {}; v.src = s; v.g = g; v.end = when + buf.duration / rate + 0.03; v.score = score; V.push(v); S.started++;
  }
  // Start a group: variant choice, spatial chain, occlusion, near / far crossfade, layers.
  fire(name, pos, vol, rate, rev, delay) {
    let G = this.groups[name]; if (!G) { const a = ALIAS[name]; if (a) { name = a; G = this.groups[a]; } }
    let b = this.buf[G ? this.pick(name, G) : name];
    if (!b) { b = this.syn[G ? this.fallback(name) : name]; if (!b) return; }
    const bus = this.bus[G ? G.b : 's'], g = G ? G.g : 1; let when = this.ctx.currentTime + delay;
    const r = rate * (1 + (Math.random() * 2 - 1) * (G ? G.p : 0.03));
    if (!pos) this.voice(b, bus, vol * g, r, when, name, undefined, 0, rev);
    else {
      const L = this.listener, dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z; let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > MAX_DIST) return; if (d < 1) d = 1;
      const hd = Math.max(0.5, Math.sqrt(dx * dx + dz * dz)), cy = Math.cos(L.yaw), sy = Math.sin(L.yaw);
      const pan = Math.max(-1, Math.min(1, (dx * cy - dz * sy) / hd * 0.85)), front = (-dx * sy - dz * cy) / hd;
      let lpf = Math.max(600, 18000 / (1 + d * 0.08)); // air absorption: highs die first
      if (front < 0) lpf *= 1 + 0.3 * front;             // sounds behind the head are a little duller
      const edge = 1 - smooth(120, MAX_DIST, d); let att = edge, send = rev + Math.min(0.6, d / 80);
      const w = this.world || (this.game && this.game.world);
      if (w && d < 60 && d > 2.5) { const o = this.occlusion(w, pos, d); if (o > 0) { att *= 1 - 0.6 * o; lpf = lpf * (1 - o) + Math.min(lpf, 900) * o; send *= 1 + 0.4 * o; } }
      when += d / C_SOUND; // sound takes its time: far shots arrive late
      let near = 1;
      if (G && G.far) { // distance character: the dry close recording gives way to a distant one with more reverb
        const k = smooth(G.n[0], G.n[1], d);
        if (k > 0.01) {
          near = Math.cos(k * HALF_PI); const F = this.groups[G.far], fb = this.buf[this.pick(G.far, F)];
          if (fb) this.voice(fb, this.bus[F.b], vol * F.g * Math.min(1, F.ref / d) * att * Math.sin(k * HALF_PI), r, when, G.far, Math.max(lpf, 2200) * (att < edge ? 0.6 : 1), pan, send + 0.3);
          else near = 1;
        }
      }
      if (near > 0.02) this.voice(b, bus, vol * g * Math.min(1, ((G && G.ref) || 6) / d) * att * near, r, when, name, lpf, pan, send);
    }
    if (G) {
      if (G.l) for (const l of G.l) this.fire(l.n, pos, vol * l.g, rate, rev, delay + l.d);
      if (G.syn && !pos) { const sb = this.syn[name]; if (sb) this.voice(sb, bus, vol * G.syn, rate, when, name + '~', undefined, 0, rev); } // synthetic layer (quantum abilities)
    }
  }
  // How blocked is the path listener -> pos: 0 clear, 0.5 thin wall, 1 thick. At most 6 marches per frame, cached
  // per 2 m source cell for 0.3 s (the value and its time stamp share one number, nothing is allocated).
  occlusion(w, pos, d) {
    const key = (pos.x >> 1 & 255) | (pos.y >> 1 & 63) << 8 | (pos.z >> 1 & 255) << 14, now = this.ctx.currentTime, c = this.occ.get(key);
    if (c !== undefined && (now - Math.floor(c / 8) / 100 < 0.3 || this.occBudget <= 0)) return (c % 8) / 4;
    if (this.occBudget <= 0) return 0;
    this.occBudget--;
    const L = this.listener, n = Math.floor((d - 1) / 0.3), ix = (pos.x - L.x) / d, iy = (pos.y - L.y) / d, iz = (pos.z - L.z) / d; let hits = 0;
    for (let i = 0; i < n; i++) {
      const t = 0.4 + i * 0.3, m = w.get(Math.floor((L.x + ix * t) / VS), Math.floor((L.y + iy * t) / VS), Math.floor((L.z + iz * t) / VS));
      if (m && m !== MAT.GLASS && m !== MAT.LEAF && m !== MAT.WATER && ++hits >= 4) break;
    }
    const o = hits === 0 ? 0 : Math.min(4, 2 + (hits >> 1));
    if (this.occ.size > 400) this.occ.clear();
    this.occ.set(key, Math.floor(now * 100) * 8 + o);
    return o / 4;
  }
  surfaceAt(x, y, z) {
    const w = this.world || (this.game && this.game.world); if (!w || !w.get) return 0;
    const vx = Math.floor(x / VS), vz = Math.floor(z / VS), vy = Math.floor((y - 0.05) / VS);
    if (w.get(vx, vy + 1, vz) === MAT.WATER) return 5;
    let m = w.get(vx, vy, vz); if (!m) m = w.get(vx, vy - 1, vz);
    return SURF_OF[m] || 0;
  }
  // Fraction of sky hidden above the listener (5 probes): 0 outdoors, 1 under a roof.
  cover(w) {
    const L = this.listener, y0 = Math.floor(L.y / VS) + 1; let c = 0;
    for (let i = 0; i < 5; i++) {
      const vx = Math.floor((L.x + CX[i]) / VS), vz = Math.floor((L.z + CZ[i]) / VS);
      for (let y = y0; y < y0 + 44; y++) { const m = w.get(vx, y, vz); if (m && m !== MAT.LEAF) { c++; break; } }
    }
    return c / 5;
  }

  // ------------------------------------------------------------------ gameplay sounds with logic
  // Footsteps: surface from the voxel under the feet, gait from the loudness the caller reports
  // (player.js: 0.3 crouch, 0.7 walk, 1 sprint, 1.4 landing, each times 0.25; bots pass a position).
  step(pos, vol, rate) {
    if (pos) { this.fire('step_' + SURF[this.surfaceAt(pos.x, pos.y, pos.z)] + '_run', pos, vol * 1.15, rate, 0.15, 0); return; }
    const g = this.game, p = g && g.player, L = this.listener;
    const s = p && p.pos ? this.surfaceAt(p.pos.x, p.pos.y, p.pos.z) : this.surfaceAt(L.x, L.y - 1.6, L.z);
    if (vol >= 0.33) { this.fire(this.fallV < -11 ? 'land_hard' : 'land_' + SURF[s], null, Math.min(1, vol * 2.4), 1, 0.12, 0); return; }
    const run = vol >= 0.22;
    this.fire('step_' + SURF[s] + (run ? '_run' : '_walk'), null, vol * 2.3, rate, 0.1, 0);
    if (run && p && p.sprint && Math.random() < 0.5) this.fire('gear', null, 1, 1, 0, 0.04); // kit rattles while sprinting
  }
  // The player's own shot: duck the beds, warn when the magazine runs low, drop a casing on the floor.
  ownShot() {
    this.duck(0.62, 0.28, false);
    const g = this.game; if (!g) return; let W, D; try { W = g.W; D = g.WD; } catch (e) { return; } if (!W || !D) return;
    if (D.mag >= 5 && W.mag <= D.mag * 0.25) { const k = 1 - Math.max(0, W.mag) / (D.mag * 0.25); this.fire('lowammo', null, 0.45 + 0.55 * k, 1 + 0.3 * k, 0, 0); }
    if (!D.rocket && !D.bolt && D.style !== 'cyl' && D.type !== 'shotgun' && Math.random() < (D.auto ? 0.4 : 0.85)) this.casing(0.36 + Math.random() * 0.14, null);
  }
  casing(delay, group) { const p = this.game && this.game.player; const s = p && p.pos ? this.surfaceAt(p.pos.x, p.pos.y, p.pos.z) : 0; this.fire(group || SHELL_OF[s], null, 0.7, 1, 0.1, delay); }
  blastFeel(pos, vol) {
    const L = this.listener, d = Math.hypot(pos.x - L.x, pos.y - L.y, pos.z - L.z);
    if (d < 30) this.duck(0.45, 0.5, true);
    if (d < 9) this.shock((d < 5 ? 1 : 1 - (d - 5) / 4) * Math.min(1, vol / 1.2));
  }
  // Ambience and music step back a few dB for a moment (own fire, close blasts).
  duck(amt, rel, force) {
    const now = this.ctx.currentTime; if (!force && now - this.lastDuck < 0.08) return; this.lastDuck = now;
    let p = this.ambDuck.gain; hold(p, now); p.setTargetAtTime(amt, now, 0.012); p.setTargetAtTime(1, now + 0.1, rel);
    p = this.musDuck.gain; hold(p, now); p.setTargetAtTime(amt, now, 0.012); p.setTargetAtTime(1, now + 0.1, rel);
  }
  // Shell shock: the world goes dull for 2-3 s under a soft ringing tone (the tone is synthesised: two sines).
  shock(k) {
    if (k <= 0.05) return; const ctx = this.ctx, now = ctx.currentTime, S = this.st, f = this.worldLP.frequency; S.shockT = now + 2.9;
    hold(f, now); f.setTargetAtTime(380 + (1 - k) * 1800, now, 0.015); f.setTargetAtTime(S.baseLP, now + 0.4, 0.7); f._v = undefined;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 3920; o2.frequency.value = 5840; g.gain.value = 0;
    o.connect(g); o2.connect(g); g.connect(this.master);
    g.gain.setTargetAtTime(0.028 * k, now + 0.02, 0.05); g.gain.setTargetAtTime(0, now + 0.6, 0.65);
    o.start(now); o2.start(now); o.stop(now + 3.6); o2.stop(now + 3.6);
  }
  flagCue(name) {
    const st = this.game && this.game.state;
    if (st === 'end') this.endSting(); else if (name === 'capture' && st === 'play') this.fire('sting_capture', null, 0.9, 1, 0, 0.15);
  }
  endSting() {
    const S = this.st; if (S.endDone) return; S.endDone = true; S.endT = this.ctx.currentTime;
    const t = this.game && this.game.tickets; this.fire(!t || t[0] > t[1] ? 'sting_win' : 'sting_lose', null, 1, 1, 0, 0.1);
  }

  // ------------------------------------------------------------------ ambience
  startAmbience() {
    const ctx = this.ctx, A = this.amb = {}; const G = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const loop = (name) => { const b = this.loopBuf[name], L = META.loops[name]; if (!b || !L) return null; const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.loopStart = L.start; s.loopEnd = L.end; s.start(0, L.start + Math.random() * (L.end - L.start) * 0.5); return s; };
    A.rainOutLP = ctx.createBiquadFilter(); A.rainOutLP.type = 'lowpass'; A.rainOutLP.frequency.value = 18000; A.rainOutG = G(0); A.rainInG = G(0); A.windG = G(0); A.reactorG = G(0);
    let ro = loop('rain_out');
    if (!ro) { // last resort: the old brown-noise bed
      const len = ctx.sampleRate * 4, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0); let l = 0;
      for (let i = 0; i < len; i++) { l = l * 0.995 + (Math.random() * 2 - 1) * 0.05; d[i] = l; }
      ro = ctx.createBufferSource(); ro.buffer = b; ro.loop = true; ro.start();
    }
    ro.connect(A.rainOutLP); A.rainOutLP.connect(A.rainOutG); A.rainOutG.connect(this.bus.a);
    const ri = loop('rain_in'); if (ri) ri.connect(A.rainInG); A.rainInG.connect(this.bus.a);
    const wi = loop('wind'); if (wi) wi.connect(A.windG); A.windG.connect(this.bus.a);
    A.reactor = loop('reactor'); A.reactorLP = ctx.createBiquadFilter(); A.reactorLP.type = 'lowpass'; A.reactorLP.frequency.value = 4000; A.reactorPan = ctx.createStereoPanner();
    if (A.reactor) A.reactor.connect(A.reactorLP); A.reactorLP.connect(A.reactorPan); A.reactorPan.connect(A.reactorG); A.reactorG.connect(this.bus.a);
  }

  // ------------------------------------------------------------------ music (streamed, never decoded to PCM)
  initMusic() {
    this.tracks = {};
    for (const name in META.music) {
      const url = URL.createObjectURL(new Blob([FILES[name]], { type: 'audio/ogg' }));
      const fader = this.ctx.createGain(); fader.gain.value = 0; fader.connect(this.bus.m);
      this.tracks[name] = { m: META.music[name], url, fader, decks: [null, null], cur: 0, level: 0, on: false, swap: false, offT: 0 };
    }
  }
  deck(T, i) {
    let d = T.decks[i]; if (d) return d;
    const el = document.createElement('audio'); el.preload = 'auto'; el.src = T.url; const g = this.ctx.createGain(); g.gain.value = 1;
    try { this.ctx.createMediaElementSource(el).connect(g); } catch (e) { return null; }
    g.connect(T.fader); d = T.decks[i] = { el, g };
    el.addEventListener('ended', () => { if (T.on && T.decks[T.cur] === d) { el.currentTime = 0; const p = el.play(); if (p && p.catch) p.catch(() => {}); } }); // safety net if a loop swap was missed
    return d;
  }
  // Fade a track to a level (0 stops it once the fade is over).
  music(name, level, tau) {
    const T = this.tracks && this.tracks[name]; if (!T || T.level === level) return;
    T.level = level; const now = this.ctx.currentTime; hold(T.fader.gain, now); T.fader.gain.setTargetAtTime(level * (T.m.gain || 1), now, tau);
    if (level > 0) {
      T.offT = 0;
      if (!T.on) { const d = this.deck(T, T.cur); if (!d) return; T.on = true; const p = d.el.play(); if (p && p.catch) p.catch(() => { T.on = false; T.level = -1; }); }
    } else T.offT = now + tau * 5;
  }
  // Loop handling: the file is the loop plus a short repeat of its head. Just before the loop point the other deck
  // starts from zero and the two are crossfaded while they play the same material, so the seam cannot gap.
  pumpMusic(now) {
    for (const k in this.tracks) {
      const T = this.tracks[k]; if (!T.on) continue;
      if (T.offT && now > T.offT) { for (const d of T.decks) if (d) d.el.pause(); T.on = false; T.offT = 0; continue; }
      const d = T.decks[T.cur], t = d.el.currentTime;
      if (T.swap || t < T.m.loop - 0.32) continue;
      const o = this.deck(T, T.cur ^ 1); if (!o) continue;
      T.swap = true;
      setTimeout(() => {
        if (!T.on) { T.swap = false; return; }
        try { o.el.currentTime = 0; } catch (e) { /* not seekable yet */ }
        const p = o.el.play(); if (p && p.catch) p.catch(() => {});
        const n = this.ctx.currentTime, x = Math.min(0.4, T.m.ov * 0.5);
        o.g.gain.cancelScheduledValues(n); o.g.gain.setValueAtTime(0, n); o.g.gain.linearRampToValueAtTime(1, n + x);
        d.g.gain.cancelScheduledValues(n); d.g.gain.setValueAtTime(1, n); d.g.gain.linearRampToValueAtTime(0, n + x);
        setTimeout(() => { d.el.pause(); try { d.el.currentTime = 0; } catch (e) { /* ignore */ } T.cur ^= 1; T.swap = false; }, Math.max(100, T.m.ov * 1000 - 80));
      }, Math.max(0, (T.m.loop - t) * 1000 - 20));
    }
  }
  // Menu theme; a quiet bed on the deploy screen; in a match a sparse bed that gives way to the driving one while
  // the player fights over a flag, tickets run out or the reactor is about to blow; stingers on the end screen.
  musicState(st, now) {
    const S = this.st, g = this.game; let menu = 0, ten = 0, com = 0, heat = false;
    if (st === 'play' || st === 'pause' || st === 'deploy') {
      let hot = false;
      if (g) {
        const t = g.tickets; if (t) { S.maxT = Math.max(S.maxT, t[0], t[1]); if (Math.min(t[0], t[1]) < S.maxT * 0.25) hot = true; }
        const E = g.event; if (E && (E.st === 'warn' || E.st === 'boom')) hot = true;
        const p = g.player, F = g.flags;
        if (!hot && p && p.pos && F) for (const f of F) if (f.n && f.n[0] > 0 && f.n[1] > 0 && Math.hypot(f.x - p.pos.x, f.z - p.pos.z) < 24) { hot = true; break; }
      }
      if (hot) S.heatT = now; heat = now - S.heatT < 9;
      if (st === 'deploy') { ten = heat ? 0.25 : 0.42; com = heat ? 0.36 : 0; } else { ten = heat ? 0 : 0.62; com = heat ? 0.8 : 0; }
    } else if (st === 'end') { if (now - S.endT > 6.5) menu = 0.6; } else menu = 1;
    this.music('music_menu', menu, menu ? 1.2 : 0.5); this.music('music_tension', ten, 1.0); this.music('music_combat', com, heat ? 0.7 : 1.6);
  }

  // ------------------------------------------------------------------ state poll (8 Hz, own timer)
  poll() {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    try {
      const now = ctx.currentTime, g = this.game, S = this.st, st = (g && g.state) || 'menu';
      const mv = g && g.settings && typeof g.settings.music === 'number' ? g.settings.music : null;
      if (mv !== null && mv !== this._mv) { this._mv = mv; this.setMusicVolume(mv); }
      const inGame = st === 'play' || st === 'pause' || st === 'deploy';
      if (st !== S.state) {
        const prev = S.state; S.state = st;
        if (st === 'play' && prev === 'deploy') this.fire('spawn', null, 0.8, 1, 0.1, 0);
        if (st === 'end') this.endSting(); else S.endDone = false;
        if (st === 'deploy' && prev !== 'play' && prev !== 'pause') { S.maxT = 1; S.heatT = -99; }
        if (st !== 'play' && st !== 'pause') this.cancelReload();
        // the world steps back outside a match; pause ducks and filters everything
        hold(this.worldGain.gain, now); this.worldGain.gain.setTargetAtTime(st === 'pause' ? 0.3 : st === 'play' ? 1 : st === 'deploy' ? 0.7 : 0.45, now, 0.12);
        hold(this.musLP.frequency, now); this.musLP.frequency.setTargetAtTime(st === 'pause' ? 900 : 20000, now, 0.1);
      }
      // low health: heartbeat and a gentle low-pass over the world, cleared on recovery, death or respawn
      const p = g && g.player, hp = p && typeof p.hp === 'number' ? p.hp : 100;
      const low = (st === 'play' || st === 'pause') && !!p && p.alive !== false && hp < (S.lowHp ? 38 : 30);
      if (low !== S.lowHp) { S.lowHp = low; S.nextBeat = now + 0.05; }
      const base = st === 'pause' ? 650 : low ? 3400 : 20000;
      if (S.shockT && now > S.shockT) { S.shockT = 0; S.baseLP = -1; }
      if (base !== S.baseLP) { S.baseLP = base; if (!S.shockT) { hold(this.worldLP.frequency, now); this.worldLP.frequency.setTargetAtTime(base, now, 0.18); } }
      if (low && st === 'play' && S.nextBeat - now < 0.14) {
        const k = 1 - Math.max(0, hp) / 38; this.fire('heartbeat', null, 0.55 + 0.45 * k, 1, 0, Math.max(0, S.nextBeat - now)); S.nextBeat = Math.max(now, S.nextBeat) + 1.0 - 0.38 * k;
      }
      // cover above the listener -> room or exterior response, outdoor rain or muffled rain with roof patter
      const w = this.world || (g && g.world);
      this.indoor += ((w && w.get && inGame ? this.cover(w) : 0) - this.indoor) * 0.4;
      const k = this.indoor, A = this.amb;
      aim(this.roomG.gain, 0.05 + 0.5 * k, now, 0.3); aim(this.extG.gain, 0.34 * (1 - 0.8 * k), now, 0.3);
      if (A) {
        aim(A.rainOutG.gain, 0.62 * (1 - 0.7 * k), now, 0.3); aim(A.rainOutLP.frequency, k > 0.02 ? 16000 * Math.pow(0.05, k) : 18000, now, 0.3); aim(A.rainInG.gain, 0.6 * k, now, 0.3);
        if (now > S.gustT) { S.gustT = now + 2.5 + Math.random() * 4; S.gust = Math.random() * Math.random(); }
        aim(A.windG.gain, (0.2 + 0.55 * S.gust) * (1 - 0.75 * k), now, 1.1);
        // reactor hum near the map centre (48 m, 48 m); it strains during the overload and dies with the core
        let rg = 0, rr = 1, rp = 0, rf = 4000; const E = g && g.event, es = E ? E.st : 'idle';
        if (inGame && es !== 'done') {
          const L = this.listener, dx = 48 - L.x, dz = 48 - L.z, d = Math.max(1, Math.hypot(dx, dz) + 2);
          rg = Math.pow(Math.min(1, 10 / d), 1.3) * (1 - smooth(50, 75, d)) * (es === 'warn' ? 1.1 : es === 'boom' ? 1.3 : 0.6); rr = es === 'warn' ? 1.3 : es === 'boom' ? 1.5 : 1;
          rp = Math.max(-1, Math.min(1, (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / Math.max(4, d) * 0.8)); rf = Math.max(500, 12000 / (1 + d * 0.08)) * (1 - 0.5 * k);
        }
        aim(A.reactorG.gain, rg, now, 0.25); aim(A.reactorPan.pan, rp, now, 0.15); aim(A.reactorLP.frequency, rf, now, 0.25); if (A.reactor) aim(A.reactor.playbackRate, rr, now, 1.5);
      }
      // a battle goes on elsewhere: distant bursts and blasts at random bearings
      if (st === 'play' || st === 'deploy') {
        if (!S.nextBattle) S.nextBattle = now + 3;
        if (now > S.nextBattle) {
          S.nextBattle = now + 2.5 + Math.random() * 6.5; const a = Math.random() * 6.283, d = 85 + Math.random() * 55, L = this.listener, P = this._p;
          P.x = L.x + Math.cos(a) * d; P.y = L.y + 3; P.z = L.z + Math.sin(a) * d; this.fire('battle', P, 0.55 + Math.random() * 0.45, 1, 0.5, 0);
        }
      } else S.nextBattle = 0;
      if (this.tracks) { this.musicState(st, now); this.pumpMusic(now); }
    } catch (e) { if (!this._pollErr) { this._pollErr = e; console.warn('audio poll failed', e); } }
  }
}
