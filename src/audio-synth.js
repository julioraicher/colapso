// Procedural fallback sounds: the game's original placeholder audio, rendered once with OfflineAudioContext.
// src/audio.js uses one of these buffers whenever a sampled sound is missing or failed to decode, and layers the
// 'ability' / 'abilityEnd' sweeps under the sampled sci-fi layers (the quantum abilities keep their synthetic identity).
const SR = 44100;
export class Synth {
  constructor() { this.buf = {}; }
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
      sniper: [1.2, (oc, o) => this.gunshot(oc, o, { crackF: 2200, crack: 1.4, blastF: 500, blast: 1.3, len: 0.9, thumpF: 90, thump: 1.4 })],
      rocket: [1.4, (oc, o) => {
        const n = this.noise(oc, 1.4); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(900, 0); bp.frequency.exponentialRampToValueAtTime(300, 1.2); bp.Q.value = 0.8;
        n.connect(bp); this.env(oc, bp, 0.01, 1.2, 1.2).connect(o); n.start();
        const t = oc.createOscillator(); t.frequency.setValueAtTime(70, 0); t.frequency.exponentialRampToValueAtTime(30, 0.4); this.env(oc, t, 0.003, 1.2, 0.4).connect(o); t.start(); t.stop(0.5);
      }],
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
      siren: [1.2, (oc, o) => {
        const s = oc.createOscillator(); s.type = 'sawtooth';
        s.frequency.setValueAtTime(520, 0); s.frequency.linearRampToValueAtTime(880, 0.6); s.frequency.linearRampToValueAtTime(520, 1.2);
        const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; s.connect(lp);
        const g = oc.createGain(); g.gain.value = 0.35; lp.connect(g); g.connect(o); s.start(); s.stop(1.2);
      }],
      pin: [0.2, (oc, o) => { const n = this.noise(oc, 0.1); const bp = oc.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3500; bp.Q.value = 8; n.connect(bp); this.env(oc, bp, 0.001, 0.4, 0.05).connect(o); n.start(); }],
      hurt: [0.25, (oc, o) => { const n = this.noise(oc, 0.25); const lp = oc.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; n.connect(lp); this.env(oc, lp, 0.005, 0.8, 0.2).connect(o); n.start(); }],
    };
    // One at a time (25 offline contexts rendering at once would starve the frame loop of a small laptop); the two
    // ability sweeps go first because the engine layers them under the sampled ability sounds.
    const keys = Object.keys(jobs).sort((a, b) => (/^ability/.test(b) ? 1 : 0) - (/^ability/.test(a) ? 1 : 0));
    for (const k of keys) { try { const ab = await this.render(jobs[k][0], jobs[k][1]); B[k] = { b: ab, o: 0, d: ab.duration }; } catch (e) { /* this one stays silent */ } } // same { b, o, d } shape as a sampled sprite
  }
}
