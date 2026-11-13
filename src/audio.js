// Procedural audio. Everything synthesised once into AudioBuffers via OfflineAudioContext,
// then played through a spatial chain: distance gain (inverse law) + air-absorption lowpass
// + propagation delay (d / 343 m/s) + shared convolution reverb (synthetic impulse response).
const SR = 44100;
const C_SOUND = 343;

export class Audio {
  constructor() {
    this.ctx = null; this.buf = {}; this.ready = false; this.listener = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
    this.vol = 0.8;
  }
  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this.makeIR(2.4, 2.2);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    await this.synthAll();
    this.ready = true;
    this.startAmbience();
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  makeIR(sec, decay) {
    const len = SR * sec | 0; const b = this.ctx.createBuffer(2, len, SR);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections cluster + exponential diffuse tail
        const er = i < SR * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = er + (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * 0.5;
      }
    }
    return b;
  }
  async render(sec, build) {
    const oc = new OfflineAudioContext(1, Math.ceil(SR * sec), SR);
    build(oc, oc.destination);
    return oc.startRendering();
  }
  noise(oc, sec) {
    const b = oc.createBuffer(1, Math.ceil(SR * sec), SR); const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = last * 0.6 + w * 0.4; d[i] = w * 0.7 + last * 0.3; }
    const s = oc.createBufferSource(); s.buffer = b; return s;
  }
  env(oc, node, a, peak, dec, t0 = 0) {
    const g = oc.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
    node.connect(g); return g;
  }
  // Gunshot = supersonic crack (HP noise) + muzzle blast (BP noise) + body thump (pitch-swept sine) + mech click
  gunshot(oc, out, o) {
    const crack = this.noise(oc, 0.1); const hp = oc.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = o.crackF;
    crack.connect(hp); this.env(oc, hp, 0.001, o.crack, 0.05).connect(out); crack.start();
    const blast = this.noise(oc, o.len); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = o.blastF; bp.Q.value = 0.7;
    const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(6000, 0); lp.frequency.exponentialRampToValueAtTime(400, o.len);
    blast.connect(bp); bp.connect(lp); this.env(oc, lp, 0.002, o.blast, o.len * 0.8).connect(out); blast.start();
    const th = oc.createOscillator(); th.type = 'sine'; th.frequency.setValueAtTime(o.thumpF, 0); th.frequency.exponentialRampToValueAtTime(35, 0.18);
    this.env(oc, th, 0.002, o.thump, 0.2).connect(out); th.start(); th.stop(0.3);
    const cl = oc.createOscillator(); cl.type = 'square'; cl.frequency.value = 2400;
    this.env(oc, cl, 0.001, 0.05, 0.015, 0.012).connect(out); cl.start(); cl.stop(0.05);
  }
  async synthAll() {
    const B = this.buf;
    const jobs = {
      rifle: [0.5, (oc, o) => this.gunshot(oc, o, { crackF: 3000, crack: 0.9, blastF: 900, blast: 1.0, len: 0.35, thumpF: 140, thump: 0.9 })],
      smg: [0.35, (oc, o) => this.gunshot(oc, o, { crackF: 3500, crack: 0.6, blastF: 1300, blast: 0.8, len: 0.22, thumpF: 180, thump: 0.6 })],
      shotgun: [0.8, (oc, o) => this.gunshot(oc, o, { crackF: 1800, crack: 0.8, blastF: 500, blast: 1.2, len: 0.6, thumpF: 100, thump: 1.2 })],
      dmr: [0.8, (oc, o) => this.gunshot(oc, o, { crackF: 2500, crack: 1.2, blastF: 700, blast: 1.1, len: 0.55, thumpF: 110, thump: 1.1 })],
      pistol: [0.35, (oc, o) => this.gunshot(oc, o, { crackF: 3000, crack: 0.6, blastF: 1500, blast: 0.6, len: 0.2, thumpF: 200, thump: 0.5 })],
      explosion: [2.2, (oc, o) => {
        const n = this.noise(oc, 2.2); const lp = oc.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.setValueAtTime(5000, 0); lp.frequency.exponentialRampToValueAtTime(120, 1.8);
        n.connect(lp); this.env(oc, lp, 0.003, 1.4, 1.9).connect(o); n.start();
        const s = oc.createOscillator(); s.frequency.setValueAtTime(90, 0); s.frequency.exponentialRampToValueAtTime(22, 1.0);
        this.env(oc, s, 0.005, 1.5, 1.1).connect(o); s.start(); s.stop(1.3);
      }],
      debris: [1.4, (oc, o) => {
        for (let i = 0; i < 26; i++) {
          const t = Math.random() * 1.1; const n = this.noise(oc, 0.12);
          const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300 + Math.random() * 2500; bp.Q.value = 3;
          n.connect(bp); this.env(oc, bp, 0.002, 0.35 * (1 - t / 1.3), 0.08, t).connect(o); n.start(t);
        }
      }],
      impact: [0.15, (oc, o) => {
        const n = this.noise(oc, 0.15); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1.5;
        n.connect(bp); this.env(oc, bp, 0.001, 0.6, 0.08).connect(o); n.start();
      }],
      ricochet: [0.4, (oc, o) => {
        const s = oc.createOscillator(); s.type = 'sine'; s.frequency.setValueAtTime(4200, 0); s.frequency.exponentialRampToValueAtTime(1600, 0.35);
        this.env(oc, s, 0.002, 0.18, 0.3).connect(o); s.start(); s.stop(0.4);
      }],
      flesh: [0.15, (oc, o) => {
        const n = this.noise(oc, 0.15); const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
        n.connect(lp); this.env(oc, lp, 0.002, 0.9, 0.09).connect(o); n.start();
      }],
      hit: [0.09, (oc, o) => {
        const s = oc.createOscillator(); s.type = 'triangle'; s.frequency.value = 1900;
        this.env(oc, s, 0.001, 0.4, 0.06).connect(o); s.start(); s.stop(0.09);
      }],
      kill: [0.3, (oc, o) => {
        [1300, 1950].forEach((f, i) => { const s = oc.createOscillator(); s.type = 'triangle'; s.frequency.value = f;
          this.env(oc, s, 0.002, 0.35, 0.12, i * 0.07).connect(o); s.start(i * 0.07); s.stop(0.3); });
      }],
      step: [0.12, (oc, o) => {
        const n = this.noise(oc, 0.12); const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
        n.connect(lp); this.env(oc, lp, 0.004, 0.35, 0.07).connect(o); n.start();
      }],
      reload: [0.9, (oc, o) => {
        [[0.05, 900, 0.3], [0.45, 1400, 0.4], [0.7, 2200, 0.35]].forEach(([t, f, a]) => {
          const n = this.noise(oc, 0.06); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 4;
          n.connect(bp); this.env(oc, bp, 0.001, a, 0.04, t).connect(o); n.start(t);
        });
      }],
      empty: [0.08, (oc, o) => { const s = oc.createOscillator(); s.type = 'square'; s.frequency.value = 3000; this.env(oc, s, 0.001, 0.1, 0.02).connect(o); s.start(); s.stop(0.08); }],
      whiz: [0.25, (oc, o) => {
        const n = this.noise(oc, 0.25); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
        bp.frequency.setValueAtTime(5000, 0); bp.frequency.exponentialRampToValueAtTime(1200, 0.22);
        n.connect(bp); this.env(oc, bp, 0.03, 0.5, 0.18).connect(o); n.start();
      }],
      capture: [0.7, (oc, o) => {
        [523, 659, 784].forEach((f, i) => { const s = oc.createOscillator(); s.type = 'sine'; s.frequency.value = f;
          this.env(oc, s, 0.01, 0.25, 0.3, i * 0.12).connect(o); s.start(i * 0.12); s.stop(0.7); });
      }],
      lost: [0.7, (oc, o) => {
        [392, 330, 262].forEach((f, i) => { const s = oc.createOscillator(); s.type = 'sine'; s.frequency.value = f;
          this.env(oc, s, 0.01, 0.25, 0.3, i * 0.12).connect(o); s.start(i * 0.12); s.stop(0.7); });
      }],
      ability: [0.8, (oc, o) => {
        const s = oc.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(120, 0); s.frequency.exponentialRampToValueAtTime(900, 0.5);
        const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; s.connect(lp);
        this.env(oc, lp, 0.05, 0.3, 0.6).connect(o); s.start(); s.stop(0.8);
        const n = this.noise(oc, 0.8); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 2;
        n.connect(bp); this.env(oc, bp, 0.2, 0.15, 0.5).connect(o); n.start();
      }],
      abilityEnd: [0.6, (oc, o) => {
        const s = oc.createOscillator(); s.type = 'sawtooth'; s.frequency.setValueAtTime(900, 0); s.frequency.exponentialRampToValueAtTime(90, 0.5);
        const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; s.connect(lp);
        this.env(oc, lp, 0.02, 0.3, 0.5).connect(o); s.start(); s.stop(0.6);
      }],
      pin: [0.2, (oc, o) => { const n = this.noise(oc, 0.1); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 8; n.connect(bp); this.env(oc, bp, 0.001, 0.4, 0.05).connect(o); n.start(); }],
      hurt: [0.25, (oc, o) => { const n = this.noise(oc, 0.25); const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; n.connect(lp); this.env(oc, lp, 0.005, 0.8, 0.2).connect(o); n.start(); }],
    };
    await Promise.all(Object.entries(jobs).map(async ([k, [sec, fn]]) => { B[k] = await this.render(sec, fn); }));
  }
  startAmbience() {
    const ctx = this.ctx; const len = SR * 4;
    const b = ctx.createBuffer(1, len, SR); const d = b.getChannelData(0);
    let l = 0; for (let i = 0; i < len; i++) { l = l * 0.995 + (Math.random() * 2 - 1) * 0.05; d[i] = l; }
    const s = ctx.createBufferSource(); s.buffer = b; s.loop = true;
    const g = ctx.createGain(); g.gain.value = 0.35; s.connect(g); g.connect(this.master); s.start();
    this.amb = g;
  }
  setListener(pos, yaw) { const L = this.listener; L.x = pos.x; L.y = pos.y; L.z = pos.z; L.yaw = yaw; }
  // Play a buffer. pos = null → 2D (UI / own weapon).
  play(name, pos = null, vol = 1, rate = 1, rev = 0.25) {
    if (!this.ready) return;
    const ctx = this.ctx; const b = this.buf[name]; if (!b) return;
    const s = ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (0.96 + Math.random() * 0.08);
    const g = ctx.createGain();
    let when = ctx.currentTime;
    if (pos) {
      const L = this.listener;
      const dx = pos.x - L.x, dy = pos.y - L.y, dz = pos.z - L.z;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      if (dist > 160) return;
      g.gain.value = vol * Math.min(1, 6 / dist); // ~inverse-distance law (−6 dB / doubling)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.value = Math.max(600, 18000 / (1 + dist * 0.08)); // air absorption: HF dies first
      const pan = ctx.createStereoPanner();
      const yw = L.yaw || 0, hd = Math.max(0.5, Math.hypot(dx, dz));
      pan.pan.value = Math.max(-1, Math.min(1, (dx * Math.cos(yw) - dz * Math.sin(yw)) / hd * 0.85));
      s.connect(lp); lp.connect(pan); pan.connect(g);
      when += dist / C_SOUND; // speed of sound delay — distant shots arrive late, like reality
      const rg = ctx.createGain(); rg.gain.value = rev + Math.min(0.6, dist / 80); g.connect(rg); rg.connect(this.reverb);
    } else {
      g.gain.value = vol; s.connect(g);
      if (rev > 0) { const rg = ctx.createGain(); rg.gain.value = rev; g.connect(rg); rg.connect(this.reverb); }
    }
    g.connect(this.master);
    s.start(when);
  }
}
