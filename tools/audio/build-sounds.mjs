#!/usr/bin/env node
// COLAPSO audio pipeline. Turns freely licensed source recordings into the game's sound set:
//   src/sounds/<sheet>.ogg   mono/stereo Vorbis "sprite sheets" (many short sounds per file: a Vorbis file carries
//                            ~4 kB of codebooks, so one file per footstep would waste about 1 MB)
//   src/sounds/<loop>.ogg    seamless ambience beds (loop points sit inside a wrap margin)
//   src/sounds/<music>.ogg   score sections with a crossfaded seam, played by HTMLAudioElement at runtime
//   src/sounds/index.js      generated: imports every .ogg (esbuild 'binary' loader) + metadata + AUDIO_CREDITS
//   src/sounds/manifest.json same metadata for the Node tools (report.mjs)
//   CREDITS.md               generated source / licence / modification table
// Usage: node tools/audio/build-sounds.mjs        (needs ffmpeg with libvorbis and the source repos, see PACKS)
// The outputs are committed: CI has neither ffmpeg nor the sources.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'src/sounds');
const H = process.env.AUDIO_SRC || '/home/claude';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- sources
const PACKS = {
  soldat: { dir: `${H}/soldat/base/shared/sfx`, repo: 'https://github.com/Soldat/base', prefix: 'shared/sfx/', pack: 'Soldat base assets', author: 'Soldat team and contributors', licence: 'CC BY 4.0' },
  kimp: { dir: `${H}/boyquotes/kenney-impact-sounds-for-godot/addons/kenney impact sounds`, repo: 'https://github.com/boyquotes/kenney-impact-sounds-for-godot', prefix: 'addons/kenney impact sounds/', pack: 'Kenney Impact Sounds', author: 'Kenney (kenney.nl)', licence: 'CC0 1.0' },
  kui: { dir: `${H}/calinou/kenney-interface-sounds/addons/kenney_interface_sounds`, repo: 'https://github.com/Calinou/kenney-interface-sounds', prefix: 'addons/kenney_interface_sounds/', pack: 'Kenney Interface Sounds', author: 'Kenney (kenney.nl)', licence: 'CC0 1.0' },
  ksci: { dir: `${H}/boyquotes/kenney-sci-fi-sounds-for-godot/addons/kenney sci-fi sounds`, repo: 'https://github.com/boyquotes/kenney-sci-fi-sounds-for-godot', prefix: 'addons/kenney sci-fi sounds/', pack: 'Kenney Sci-Fi Sounds', author: 'Kenney (kenney.nl)', licence: 'CC0 1.0' },
  oc: { dir: `${H}/facebookincubator/Meta-open-sound/corpora/oculus-audio-pack/ogg`, repo: 'https://github.com/facebookincubator/Meta-open-sound', prefix: 'corpora/oculus-audio-pack/ogg/', pack: 'Oculus Audio Pack 01', author: 'Oculus VR, LLC', licence: 'CC BY 4.0' },
  sp: { dir: `${H}/sonic-pi/samples`, repo: 'https://github.com/sonic-pi-net/sonic-pi', prefix: 'etc/samples/', pack: 'Sonic Pi sample library', author: 'Sonic Pi contributors / freesound.org authors', licence: 'CC0 1.0' },
  ss: { dir: `${H}/soundsafari/picked`, repo: 'https://github.com/soundsafari/CC0-1.0-Music', prefix: '', pack: 'CC0-1.0-Music (FreePD / freesound mirror)', author: '', licence: 'CC0 1.0' },
};
// per-file author + original path for the aggregated CC0 music repository
const SS_FILES = {
  'Hidden Truth.mp3': ['freepd.com/Hidden Truth.mp3', 'Rafael Krux (FreePD)'],
  'Dawn of the Apocalypse.mp3': ['freepd.com/Dawn of the Apocalypse.mp3', 'Rafael Krux (FreePD)'],
  'After the End.mp3': ['freepd.com/After the End.mp3', 'Rafael Krux (FreePD)'],
  '592036__guidofm__thunder-rain-next-to-window-23lufs.wav': ['freesound.org/592036__guidofm__thunder-rain-next-to-window-23lufs.wav', 'guidofm (freesound.org)'],
};
if (!fs.existsSync(PACKS.ksci.dir)) { const d = path.dirname(PACKS.ksci.dir); if (fs.existsSync(d)) PACKS.ksci.dir = path.join(d, fs.readdirSync(d)[0]); PACKS.ksci.prefix = 'addons/' + path.basename(PACKS.ksci.dir) + '/'; }
if (!fs.existsSync(PACKS.kimp.dir)) { const d = path.dirname(PACKS.kimp.dir); if (fs.existsSync(d)) PACKS.kimp.dir = path.join(d, fs.readdirSync(d)[0]); PACKS.kimp.prefix = 'addons/' + path.basename(PACKS.kimp.dir) + '/'; }

const USE = new Map(); // source ref -> { outs:Set, mods:Set }
let CUR = '?';
function use(ref, spec) {
  const i = ref.indexOf(':'); const pk = ref.slice(0, i), rel = ref.slice(i + 1); const P = PACKS[pk];
  if (!P) throw new Error('unknown pack in ' + ref);
  const file = path.join(P.dir, rel); if (!fs.existsSync(file)) throw new Error('missing source ' + file);
  let u = USE.get(ref); if (!u) USE.set(ref, u = { outs: new Set(), mods: new Set() });
  u.outs.add(CUR.replace(/_\d+$/, ''));
  u.mods.add('trimmed'); u.mods.add('level normalised'); u.mods.add('resampled'); u.mods.add('re-encoded (Ogg Vorbis)');
  if (spec) {
    if (spec.rate && spec.rate !== 1) u.mods.add('pitch-shifted');
    if (spec.af || spec.post) u.mods.add('filtered / EQ');
    if (spec.layers || spec._layer) u.mods.add('layered');
    if (spec._mod) u.mods.add(spec._mod);
  }
  return file;
}

// ---------------------------------------------------------------- rendering
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function normalise(c, sr, norm) {
  if (!norm) return c;
  let g = 1; const p0 = A.peak(c); if (p0 <= 0) return c;
  if (norm.loud != null) { const l = A.loudWindowRms(c, sr, norm.win || 0.1); if (l > 0) g = A.lin(norm.loud) / l; }
  else if (norm.rms != null) { const r = A.rms(c); if (r > 0) g = A.lin(norm.rms) / r; }
  else if (norm.peak != null) g = A.lin(norm.peak) / p0;
  if (norm.clip === false) { A.gain(c, g); return c; }
  // a loudness target must not drive a short click far into the limiter: at most maxClip dB of soft limiting
  const C = 0.75; // peak ceiling, -2.5 dBFS: Vorbis overshoots sharp transients by up to 2 dB
  const cap = A.lin(norm.maxClip ?? 3) * C / p0; if (g > cap) g = cap;
  A.gain(c, g);
  if (p0 * g > C) { A.gain(c, 1 / C); A.softClip(c, norm.knee || 0.72); A.gain(c, C); }
  return c;
}
const DC = new Map(); // decode cache (variants and layers reuse the same sources)
function dec(file, o) { const k = file + '|' + o.sr + '|' + o.ch + '|' + (o.af || ''); let c = DC.get(k); if (!c) { c = A.decode(file, o); if (c[0].length < 3e6) DC.set(k, c); } return c.map(d => d.slice()); }
const GEN = {
  // Random scatter of small hits with a decaying density: rubble, glass rain.
  scatter(s, sr, ch) {
    const R = rng(s.seed || 1); let c = A.silence(Math.round(s.len * sr), ch);
    for (let i = 0; i < s.n; i++) {
      const t = Math.pow(R(), s.curve || 1.7) * (s.len - 0.25) + (s.t0 || 0); const src = s.pool[Math.floor(R() * s.pool.length)];
      const l = render({ src, rate: (s.rate || 1) * (0.8 + R() * 0.5), norm: { loud: -12 }, _layer: 1, _mod: 'scattered into a debris tail' }, sr, ch);
      c = A.mixInto(c, l, Math.round(t * sr), A.lin((s.gain || 0) - 14 * t / s.len - R() * 6));
    }
    return A.slice(c, 0, Math.round(s.len * sr));
  },
  // Time-varying resample (falling or rising pitch): incoming shell whistle.
  glide(s, sr, ch) {
    const c = render({ ...s.of, norm: { loud: -12 }, _mod: 'pitch glide' }, sr, ch); const n = Math.round(s.len * sr);
    return c.map(d => { const o = new Float32Array(n); let p = 0; for (let i = 0; i < n; i++) { const k = i / n; const r = s.r0 * Math.pow(s.r1 / s.r0, k); const j = Math.floor(p), f = p - j; if (j + 1 >= d.length) break; o[i] = (d[j] * (1 - f) + d[j + 1] * f) * Math.pow(k, s.swell || 1.5); p += r; } return o; });
  },
  // Cut one thunder clap out of a long storm recording: find where the low band rises inside [from, to].
  thunder(s, sr, ch) {
    const file = use(s.src, { af: 1, _mod: 'thunder clap isolated, rain hiss low-passed' });
    const c = A.decode(file, { sr, ch, af: s.af, ss: s.from, t: s.to - s.from });
    const lo = A.filter(c, sr, 'lowpass=f=220'); const e = A.envelope(lo[0], sr, 0.05); let i = 0; while (i < e.length && e[i] < A.lin(s.thr ?? -16)) i++;
    const st = Math.max(0, Math.round((i * 0.05 - (s.pre ?? 0.35)) * sr));
    return A.slice(c, st, st + Math.round(s.len * sr));
  },
};
function render(spec, sr, ch = 1) {
  if (typeof spec === 'string') spec = { src: spec };
  let c;
  if (spec.gen) c = GEN[spec.gen](spec, sr, ch);
  else {
    const file = use(spec.src, spec); const rate = spec.rate || 1;
    c = dec(file, { sr: Math.round(sr / rate), ch, af: spec.af || null });
    if (spec.from != null || spec.to != null) c = A.slice(c, Math.round((spec.from || 0) * sr / rate), spec.to != null ? Math.round(spec.to * sr / rate) : c[0].length);
    if (spec.trim !== false) { const on = A.onset(c, spec.trimDb ?? -34); c = A.slice(c, Math.max(0, on - Math.round(0.001 * sr)), c[0].length); }
  }
  if (spec.len) c = A.slice(c, 0, Math.round(spec.len * sr));
  else if (spec.trim !== false) { const e = A.tailEnd(c, -58); c = A.slice(c, 0, Math.min(c[0].length, e + Math.round(0.01 * sr))); }
  if (spec.fadeIn) A.fadeIn(c, Math.round(spec.fadeIn / 1000 * sr));
  const fo = spec.fadeOut ?? (spec.len ? Math.min(120, spec.len * 250) : 12);
  if (fo > 0) A.fadeOut(c, Math.round(fo / 1000 * sr), spec.fadeCurve || 1);
  if (spec.layers) {
    normalise(c, sr, { loud: -12 + (spec.gain || 0), clip: false });
    for (const L of spec.layers) { const l = render({ ...L, at: 0, gain: 0, norm: { loud: -12 + (L.gain || 0), clip: false }, _layer: 1 }, sr, ch); c = A.mixInto(c, l, Math.round((L.at || 0) * sr), 1); }
    use_layers(spec);
  } else if (spec.gain) A.gain(c, A.lin(spec.gain));
  if (spec.post) c = A.filter(c, sr, spec.post);
  A.removeDc(c);
  return normalise(c, sr, spec.norm);
}
function use_layers(spec) { if (spec.src) { const u = USE.get(spec.src); if (u) u.mods.add('layered'); } }

const SPR = {};   // sound name -> [sheet, start s, length s]
const INFO = {};  // file -> { sr, ch, q } (for the tools)
const SIZES = []; // [file, bytes, seconds, kind]
function buildSheet(name, { sr, ch = 1, q = 3, norm, cells }) {
  const gap = Math.round(0.04 * sr); let pos = 0; const parts = [];
  for (const [cell, spec] of Object.entries(cells)) {
    CUR = cell; const c = Array.isArray(spec) ? spec : render({ norm, ...(typeof spec === 'string' ? { src: spec } : spec) }, sr, ch);
    SPR[cell] = [name, +(pos / sr).toFixed(5), +(c[0].length / sr).toFixed(5)]; parts.push([pos, c]); pos += c[0].length + gap;
  }
  const all = A.silence(pos, ch); for (const [p, c] of parts) for (let k = 0; k < ch; k++) all[k].set(c[Math.min(k, c.length - 1)], p);
  const f = path.join(OUT, name + '.ogg'); A.encodeOgg(f, all, sr, q); SIZES.push([name + '.ogg', fs.statSync(f).size, pos / sr, 'sfx']); INFO[name] = { sr, ch, q };
}
const LOOPS = {};
function buildLoop(name, spec, { sr, ch = 2, q = 2, len, xf = 1.5, rms = -22, margin = 0.06 }) {
  CUR = name; let c = render({ ...spec, trim: false, fadeOut: 0, norm: null, _mod: 'loop seam crossfaded' }, sr, ch);
  c = A.slice(c, 0, Math.round((len + xf) * sr)); c = A.loopCrossfade(c, Math.round(xf * sr)); A.removeDc(c); normalise(c, sr, { rms });
  const m = Math.round(margin * sr), n = c[0].length;
  const out = c.map(d => { const o = new Float32Array(n + 2 * m); o.set(d.subarray(n - m), 0); o.set(d, m); o.set(d.subarray(0, m), m + n); return o; });
  const f = path.join(OUT, name + '.ogg'); A.encodeOgg(f, out, sr, q); LOOPS[name] = { start: margin, end: +(margin + n / sr).toFixed(5) }; INFO[name] = { sr, ch, q }; SIZES.push([name + '.ogg', fs.statSync(f).size, n / sr, 'ambience']);
}
// Find a loop inside a piece of music: the start s and length L whose following seconds resemble each other most
// (band-spectrum similarity over a 4 s window), then refine L to the sample by waveform correlation.
function findLoop(mono, sr, { from, to, minLen, maxLen }) {
  const N = 1024, hop = 512; const frames = Math.floor((mono.length - N) / hop); const B = 14; const F = new Float32Array(frames * B);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) { re[i] = mono[f * hop + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    dft(re, im);
    let nrm = 0; for (let b = 0; b < B; b++) { const k0 = Math.floor(2 * Math.pow(N / 4, b / B)), k1 = Math.max(k0 + 1, Math.floor(2 * Math.pow(N / 4, (b + 1) / B))); let s = 0; for (let k = k0; k < k1; k++) s += re[k] * re[k] + im[k] * im[k]; const v = Math.sqrt(Math.sqrt(s)); F[f * B + b] = v; nrm += v * v; }
    nrm = Math.sqrt(nrm) + 1e-9; for (let b = 0; b < B; b++) F[f * B + b] /= nrm;
  }
  const fps = sr / hop, W = Math.round(4 * fps); let best = { score: -1 };
  for (let s = Math.round(from * fps); s < Math.round(to * fps); s += Math.round(0.25 * fps)) {
    for (let L = Math.round(minLen * fps); L <= Math.round(maxLen * fps); L++) {
      if (s + L + W >= frames || (s + L) / fps > to) break;
      let sc = 0; for (let w = 0; w < W; w++) { const a = (s + w) * B, b = (s + L + w) * B; for (let k = 0; k < B; k++) sc += F[a + k] * F[b + k]; }
      sc /= W; if (sc > best.score) best = { score: sc, s, L };
    }
  }
  // refine: maximise the waveform correlation of 1.5 s after both ends, within +-1 frame
  const s0 = best.s * hop, win = Math.round(1.5 * sr); let bc = -2, bl = best.L * hop;
  for (let l = best.L * hop - hop; l <= best.L * hop + hop; l += 4) { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < win; i += 3) { const a = mono[s0 + i], b = mono[s0 + l + i]; ab += a * b; aa += a * a; bb += b * b; } const cc = ab / Math.sqrt(aa * bb + 1e-12); if (cc > bc) { bc = cc; bl = l; } }
  return { start: s0 / sr, len: bl / sr, score: best.score, corr: bc };
}
function dft(re, im) { // radix-2 FFT (in place)
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2; const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
}
const MUSIC = {};
function buildMusic(name, src, { from, to, minLen, maxLen, xf = 3, ov = 0.8, rms = -20, q = 2, sr = 44100, gain = 1, af = null }) {
  CUR = name; const file = use(src, { af, _mod: 'loop section cut, seam crossfaded' });
  const st = A.decode(file, { sr, ch: 2, af }); const m = A.decode(file, { sr: 11025, ch: 1 })[0];
  const L = findLoop(m, 11025, { from, to, minLen, maxLen });
  const a = Math.round(L.start * sr), n = Math.round(L.len * sr), x = Math.round(xf * sr);
  let c = A.slice(st, a, a + n + x); c = A.loopCrossfade(c, x); normalise(c, sr, { rms, knee: 0.8 });
  const o = Math.round(ov * sr); const out = c.map(d => { const r = new Float32Array(n + o); r.set(d, 0); r.set(d.subarray(0, o), n); return r; });
  const f = path.join(OUT, name + '.ogg'); A.encodeOgg(f, out, sr, q);
  MUSIC[name] = { loop: +(n / sr).toFixed(4), ov, gain }; INFO[name] = { sr, ch: 2, q }; SIZES.push([name + '.ogg', fs.statSync(f).size, (n + o) / sr, 'music']);
  console.log(`  ${name}: loop ${L.start.toFixed(2)}s +${L.len.toFixed(2)}s  similarity ${L.score.toFixed(3)}  wave corr ${L.corr.toFixed(3)}`);
}
// Split a reload recording into its events (clusters of transients separated by quiet gaps).
const RELOADS = {};
function reloadSegments(key, src, sr, cells, { relDb = -36, gapMs = 60, minMs = 14, norm = { loud: -17 } } = {}) {
  CUR = 'rl_' + key; const file = use(src, { _mod: 'split into reload events' }); const d = A.decode(file, { sr, ch: 1, af: 'highpass=f=60' })[0]; // some takes carry a DC offset
  const hop = Math.round(sr * 0.004), n = Math.floor(d.length / hop); const e = new Float32Array(n); let mx = 0;
  for (let i = 0; i < n; i++) { let m = 0; for (let j = 0; j < hop; j++) { const a = Math.abs(d[i * hop + j]); if (a > m) m = a; } e[i] = m; if (m > mx) mx = m; }
  const thr = mx * A.lin(relDb); const segs = []; let st = -1, last = -1;
  for (let i = 0; i < n; i++) { if (e[i] >= thr) { if (st < 0) st = i; last = i; } else if (st >= 0 && (i - last) * 4 > gapMs) { segs.push([st, last]); st = -1; } }
  if (st >= 0) segs.push([st, last]);
  const ev = []; const whole = A.loudWindowRms([d], sr, 0.1); const g = whole > 0 ? A.lin(norm.loud) / whole : 1; // one gain for the whole take keeps the events' balance
  for (const [a, b] of segs) {
    if ((b - a + 1) * 4 < minMs) continue;
    const s0 = Math.max(0, a * hop - Math.round(0.002 * sr)), s1 = Math.min(d.length, (b + 1) * hop + Math.round(0.03 * sr)); const c = [d.slice(s0, s1)];
    let pk = 0, pi = 0; for (let i = 0; i < c[0].length; i++) { const v = Math.abs(c[0][i]); if (v > pk) { pk = v; pi = i; } }
    if (pk < mx * A.lin(-21)) continue; // drop inaudible rustles
    A.fadeIn(c, Math.round(0.002 * sr)); A.fadeOut(c, Math.round(0.02 * sr)); A.gain(c, g); if (A.peak(c) > 0.9) A.softClip(c, 0.72);
    const nm = `rl_${key}_${ev.length}`; cells[nm] = c; ev.push([nm, +(s0 / d.length).toFixed(4), +(pi / sr).toFixed(4)]);
  }
  RELOADS[key] = { dur: +(d.length / sr).toFixed(3), ev };
  console.log(`  reload ${key}: ${ev.length} events at ${ev.map(v => (v[1] * 100).toFixed(0) + '%').join(' ')}`);
}

// ---------------------------------------------------------------- manifest
const S = (f) => 'soldat:' + f + '.wav';
const KI = (f) => 'kimp:' + f + '.ogg';
const KU = (f) => 'kui:' + f + (fs.existsSync(path.join(PACKS.kui.dir, f + '.wav')) ? '.wav' : '.ogg');
const KS = (f) => 'ksci:' + f + '.ogg';
const OC = (f) => 'oc:' + f + '.ogg';
const SP = (f) => 'sp:' + f + '.flac';
// n pre-rendered variants of one shot: small pitch offsets and a different spectral tilt each
const VAR = [{}, { rate: 1.03, post: 'equalizer=f=4200:t=q:w=0.8:g=1.6' }, { rate: 0.972, post: 'equalizer=f=4200:t=q:w=0.8:g=-1.8,equalizer=f=220:t=q:w=0.9:g=1.2' }];
function variants(cells, name, spec, n) { for (let i = 0; i < n; i++) { const v = VAR[i]; cells[`${name}_${i + 1}`] = { ...spec, rate: (spec.rate || 1) * (v.rate || 1), post: [spec.post, v.post].filter(Boolean).join(',') || undefined }; } }

console.log('building sounds into', path.relative(ROOT, OUT));
const t0 = Date.now();

// ---- 1. gunfire (one distinct Soldat recording per weapon wherever the pack has one) ----
{
  const c = {};
  // the two assault rifles: one as recorded (a touch lower), the bullpup tighter, higher and brighter
  variants(c, 'gun_k7', { src: S('ak74-fire'), rate: 0.97, len: 0.58 }, 3);
  variants(c, 'gun_arco', { src: S('steyraug-fire'), rate: 1.06, len: 0.44, fadeOut: 140, post: 'highpass=f=150,equalizer=f=5200:t=q:w=0.8:g=2.5' }, 3);
  variants(c, 'gun_vespa', { src: S('mp5-fire'), len: 0.36, post: 'equalizer=f=5000:t=q:w=0.9:g=-3,equalizer=f=900:t=q:w=1:g=2' }, 3); // 9 mm: rounder, less crack than the rifles
  // PDW: the short rotary-gun shot, pitched up and brightened, with a light mechanical tick
  variants(c, 'gun_faisca', { src: S('minigun-fire'), len: 0.2, fadeOut: 60, layers: [{ src: S('m2use'), rate: 1.4, gain: -13, at: 0.004, len: 0.08 }], post: 'highpass=f=140,equalizer=f=2200:t=q:w=0.9:g=2' }, 3);
  // the two machine guns: belt-fed with a mechanical tick, and the heavy calibre one lower, longer, with a sub layer
  variants(c, 'gun_trovao', { src: S('m249-fire'), len: 0.56, layers: [{ src: S('m2use'), rate: 1.2, gain: -13, at: 0.006, len: 0.1 }] }, 3);
  variants(c, 'gun_bigorna', { src: S('m2fire'), rate: 0.9, len: 0.9, fadeOut: 240, layers: [{ src: SP('bd_boom'), gain: -11, at: 0, len: 0.6 }] }, 3);
  // machine pistol: the pistol shot cut short and pitched up, plus the slide clack
  variants(c, 'gun_rajada', { src: S('colt1911-fire'), rate: 1.2, len: 0.24, fadeOut: 90, layers: [{ src: S('colt1911-reload'), from: 0.76, rate: 1.3, gain: -14, at: 0.012, len: 0.07 }], post: 'highpass=f=240,equalizer=f=3400:t=q:w=0.9:g=2.5' }, 3);
  variants(c, 'gun_p9', { src: S('colt1911-fire'), rate: 1.08, len: 0.32, fadeOut: 150, post: 'highpass=f=170' }, 2); // a short dry pop
  variants(c, 'gun_juiz', { src: S('deserteagle-fire'), rate: 0.93, len: 1.1, fadeOut: 300, layers: [{ src: S('bounce'), gain: -9, at: 0 }] }, 2);
  variants(c, 'gun_martelo', { src: S('spas12-fire'), len: 0.9, fadeOut: 200, layers: [{ src: KS('low_frequency_explosion_001'), gain: -11, at: 0, len: 0.5 }] }, 2);
  variants(c, 'gun_lanca', { src: S('ruger77-fire'), len: 0.9, fadeOut: 260 }, 2);
  // the two bolt-action rifles share the big anti-materiel recording: one deep and long with a sub layer, one pitched up, short and cracking
  c.gun_orion_1 = { src: S('barretm82-fire'), rate: 0.92, len: 2.5, fadeOut: 900, fadeCurve: 1.6, layers: [{ src: SP('bd_boom'), gain: -8, at: 0, len: 1.2 }], post: 'equalizer=f=90:t=q:w=0.9:g=3' };
  c.gun_vigia_1 = { src: S('barretm82-fire'), rate: 1.24, len: 1.15, fadeOut: 500, fadeCurve: 1.4, layers: [{ src: S('ruger77-fire'), gain: -7, at: 0, len: 0.09, af: 'highpass=f=2500' }], post: 'highpass=f=130,equalizer=f=3800:t=q:w=0.8:g=3.5' };
  c.gun_rpg_1 = { src: S('law'), len: 1.7, fadeOut: 600, layers: [{ src: S('m79-fire'), gain: -3, at: 0 }] };
  buildSheet('guns', { sr: 44100, q: 4, norm: { loud: -9, knee: 0.72, maxClip: 6 }, cells: c });
}

// ---- 2. distant gunfire, distant battle, explosions ----
{
  const c = {}; const D = (i) => S('dist-gun' + i);
  c.far_rifle_1 = D(1); c.far_rifle_2 = D(2); c.far_rifle_3 = D(3);
  c.far_small_1 = D(4); c.far_small_2 = { src: D(2), rate: 1.3 }; c.far_small_3 = { src: D(1), rate: 1.36 };
  c.far_heavy_1 = { src: D(3), rate: 0.76 }; c.far_heavy_2 = { src: D(1), rate: 0.72 }; c.far_heavy_3 = { src: D(2), rate: 0.8, layers: [{ src: S('dist-m79'), gain: -10, at: 0.02, len: 1.2 }] };
  const burst = (srcs, n, per, seed) => { const R = rng(seed); const L = []; for (let i = 1; i < n; i++) L.push({ src: srcs[Math.floor(R() * srcs.length)], rate: 0.96 + R() * 0.08, at: +(i * per * (0.92 + R() * 0.16)).toFixed(3), gain: -R() * 4 }); return { src: srcs[0], layers: L }; };
  c.battle_1 = burst([D(1), D(2), D(3)], 4, 0.1, 11); c.battle_2 = burst([D(2), D(3)], 7, 0.088, 12); c.battle_3 = burst([D(4), D(4)], 5, 0.07, 13);
  c.battle_4 = burst([D(3), D(1)], 3, 0.22, 14); c.battle_5 = { src: D(1), rate: 0.8 }; c.battle_6 = burst([D(1), D(3), D(2)], 11, 0.094, 15);
  c.battle_7 = S('dist-grenade'); c.battle_8 = S('dist-m79');
  buildSheet('far', { sr: 32000, q: 3, norm: { loud: -16 }, cells: c });
}
{
  const c = {};
  c.exp_grenade_1 = { src: S('grenade-explosion'), len: 2.05, fadeOut: 500, layers: [{ src: KS('low_frequency_explosion_000'), gain: -8, at: 0 }] };
  c.exp_grenade_2 = { src: S('grenade-explosion'), rate: 0.93, len: 2.1, fadeOut: 500, layers: [{ src: KS('low_frequency_explosion_001'), gain: -7, at: 0 }, { src: KS('explosion_crunch_001'), gain: -13, at: 0.05 }] };
  c.exp_rocket_1 = { src: S('m79-explosion'), len: 2.0, fadeOut: 500, layers: [{ src: KS('explosion_crunch_003'), gain: -9, at: 0.02 }, { src: SP('bd_boom'), gain: -7, at: 0 }] };
  c.exp_barrel_1 = { src: S('cluster-explosion'), layers: [{ src: KI('impact_metal_heavy_002'), gain: -5, at: 0 }, { src: S('burn'), gain: -9, at: 0.04, len: 1.5, fadeOut: 900 }, { src: KS('low_frequency_explosion_001'), gain: -6, at: 0 }, { src: KI('impact_tin_medium_001'), rate: 0.7, gain: -12, at: 0.21 }] };
  c.exp_big_1 = { src: S('m79-explosion'), rate: 0.68, len: 4.2, fadeOut: 1500, fadeCurve: 1.5, layers: [{ src: S('grenade-explosion'), rate: 0.8, gain: -3, at: 0.13 }, { src: SP('bd_boom'), rate: 0.8, gain: -3, at: 0 }, { src: SP('misc_cineboom'), gain: -8, at: 0.02, len: 4, fadeOut: 1500 }, { src: KS('explosion_crunch_004'), rate: 0.62, gain: -8, at: 0.3 }, { src: KS('low_frequency_explosion_000'), rate: 0.8, gain: -4, at: 0.06 }] };
  c.exp_far_1 = { src: S('dist-grenade'), norm: { loud: -14 } }; c.exp_far_2 = { src: S('dist-m79'), norm: { loud: -14 } };
  c.exp_far_3 = { src: S('dist-m79'), rate: 0.66, norm: { loud: -13 }, layers: [{ src: SP('bd_boom'), rate: 0.7, gain: -6, at: 0.05, af: 'lowpass=f=120' }] };
  // rubble: a crunchy blast tail with rock, plank and metal hits raining down
  const rock = [KI('impact_mining_000'), KI('impact_mining_001'), KI('impact_mining_002'), KI('impact_mining_003'), KI('impact_mining_004'), KI('impact_generic_light_001'), KI('impact_generic_light_003')];
  for (let i = 0; i < 3; i++) c['debris_' + (i + 1)] = { src: KS('explosion_crunch_00' + i), gain: -2, len: 1.6, fadeOut: 500, norm: { loud: -13 }, layers: [{ gen: 'scatter', pool: rock, n: 16, len: 1.5, seed: 31 + i, gain: 2, t0: 0.03 }] };
  c.collapse_1 = { src: KS('explosion_crunch_004'), rate: 0.6, len: 3.6, fadeOut: 1200, norm: { loud: -11 }, layers: [{ gen: 'scatter', pool: [...rock, KI('impact_plank_medium_001'), KI('impact_metal_medium_002'), KI('impact_wood_heavy_001')], n: 42, len: 3.3, seed: 77, gain: 3, curve: 1.2, rate: 0.8, t0: 0.05 }, { src: S('rocketz'), rate: 0.6, gain: -6, at: 0, len: 0.7, fadeOut: 300 }, { src: SP('bd_boom'), rate: 0.75, gain: -5, at: 0.1 }, { src: S('m2explode'), rate: 0.7, gain: -8, at: 0.04 }] };
  buildSheet('blast', { sr: 44100, q: 4, norm: { loud: -8, knee: 0.7, maxClip: 6 }, cells: c });
}

// ---- 3. reload and handling foley ----
{
  const c = {}; const sr = 32000;
  for (const [k, f] of [['ak74', 'ak74-reload'], ['steyr', 'steyraug-reload'], ['mp5', 'mp5-reload'], ['m249', 'm249-reload'], ['ruger', 'ruger77-reload'], ['barrett', 'barretm82-reload'], ['deagle', 'deserteagle-reload'], ['colt', 'colt1911-reload'], ['m79', 'm79-reload']]) reloadSegments(k, S(f), sr, c, k === 'm249' ? { gapMs: 36, relDb: -30 } : {});
  Object.assign(c, {
    draw_1: S('changeweapon'), draw_2: S('takegun'), pickup_1: S('pickupgun'), scope_1: S('scope'), scopeback_1: S('scopeback'),
    bolt_1: { src: S('ruger77-reload'), from: 0.355, to: 0.56, trim: false, fadeIn: 3, fadeOut: 25 },                   // bolt lifted and drawn back
    boltFwd_1: { src: S('ruger77-reload'), from: 1.36, to: 1.71, trim: false, fadeIn: 8, fadeOut: 20 },                 // pushed home and locked
    pump_1: { src: S('ruger77-reload'), from: 0.355, to: 0.56, trim: false, rate: 0.8, fadeIn: 3, fadeOut: 25, layers: [{ src: S('ruger77-reload'), from: 1.4, to: 1.71, trim: false, rate: 0.8, at: 0.19, gain: 0 }] },
    shellIn_1: { src: S('spas12-reload'), norm: { peak: -5 } }, shellIn_2: { src: S('spas12-reload'), rate: 1.07, norm: { peak: -5 } }, shellIn_3: { src: S('spas12-reload'), rate: 0.94, norm: { peak: -5 } }, // very sharp clicks: peak-normalised
    pin_1: S('grenade-pullout'), throw_1: S('grenade-throw'), nadeBounce_1: S('grenade-bounce'), nadeBounce_2: { src: S('grenade-bounce'), rate: 0.88 },
    empty_1: { src: OC('MECHSwtch_SwitchSmallOff_OS_02'), len: 0.16 }, firemode_1: { src: OC('MECHSwtch_SwitchSmallOn_OS_02'), len: 0.22 },
    click_1: { src: S('m2use'), len: 0.2 }, clipfall_1: S('clipfall'), lawload_1: S('law-start'), lawlock_1: S('law-end'),
    casing_1: S('shell'), casing_2: S('shell2'), casing_3: S('gaugeshell'),
    melee_1: { src: OC('SWSH_Swoosh_OS_01'), len: 0.4 }, melee_2: { src: OC('SWSH_Swoosh_OS_03'), len: 0.42 }, melee_3: { src: OC('WHSH_WhooshMedium_OS_02') },
    meleeHit_1: { src: S('slash'), layers: [{ src: KI('impact_punch_heavy_000'), gain: -2, at: 0.01 }] }, meleeHit_2: { src: S('slash'), rate: 0.9, layers: [{ src: KI('impact_punch_heavy_003'), gain: -2, at: 0.01 }] },
    vault_1: { src: OC('CLOTHMvmt_MovementWithGear_OS_01'), layers: [{ src: KI('impact_soft_heavy_001'), gain: -4, at: 0.3 }] },
    gear_1: { src: OC('CLOTHMvmt_MovementWithGear_OS_02'), len: 0.45 }, gear_2: { src: OC('CLOTHMvmt_MovementWithGear_OS_03'), len: 0.5 }, gear_3: { src: OC('CLOTHMvmt_MovementWithGear_OS_04'), len: 0.5 }, gear_4: { src: OC('CLOTHMvmt_ClothingMovement_OS_02'), len: 0.5 },
    lowammo_1: { src: KI('impact_metal_light_003'), rate: 1.7, len: 0.14, af: 'highpass=f=1800' },
  });
  for (const [srf, k] of [['Concrete', 'concrete'], ['Metal', 'metal'], ['Grass', 'dirt']]) for (let i = 1; i <= 3; i++) c[`shell_${k}_${i}`] = { src: OC(`BLLTShel_ShellCasing${srf}_OS_0${i}`), len: 0.7, fadeOut: 250 };
  buildSheet('foley', { sr, q: 3, norm: { loud: -17 }, cells: c });
}

// ---- 4. footsteps (surface x gait), jump and landings ----
{
  const c = {};
  for (const [srf, k] of [['Concrete', 'concrete'], ['Metal', 'metal'], ['Wood', 'wood'], ['Dirt', 'dirt'], ['Grass', 'grass']]) {
    for (let i = 1; i <= 4; i++) c[`step_${k}_run_${i}`] = { src: OC(`FEETHmn_Shoe${srf}Run_OS_0${i}`), len: 0.34, fadeOut: 90 };
    for (let i = 1; i <= 4; i++) c[`step_${k}_walk_${i}`] = { src: OC(`FEETHmn_Shoe${srf}Walk_OS_0${i}`), len: 0.4, fadeOut: 110 };
    for (let i = 1; i <= 2; i++) c[`land_${k}_${i}`] = { src: OC(`FEETHmn_Shoe${srf}Land_OS_0${i}`), len: 0.55, fadeOut: 160, norm: { loud: -15 } };
  }
  for (let i = 1; i <= 4; i++) c[`step_water_${i}`] = { src: S('water-step'), rate: [1, 0.9, 1.1, 0.82][i - 1], layers: [{ src: OC(`FEETHmn_ShoeConcreteWalk_OS_0${i}`), gain: -7, at: 0, len: 0.3 }] };
  for (let i = 1; i <= 4; i++) c[`step_glass_${i}`] = { src: OC(`FEETHmn_ShoeConcreteRun_OS_0${i}`), len: 0.34, layers: [{ src: KI(`impact_glass_light_00${i}`), gain: -9, at: 0.01, len: 0.2, rate: 1.3 }] };
  c.jump_1 = { src: OC('CLOTHMvmt_ClothingMovement_OS_01'), len: 0.4, layers: [{ src: S('jump'), gain: -3, at: 0 }] }; c.jump_2 = { src: OC('CLOTHMvmt_ClothingMovement_OS_04'), len: 0.4, layers: [{ src: S('jump'), gain: -3, at: 0, rate: 1.1 }] };
  c.landHard_1 = { src: S('fall-hard'), norm: { loud: -13 }, layers: [{ src: OC('FEETHmn_ShoeConcreteLand_OS_01'), gain: 0, at: 0 }, { src: KI('impact_soft_heavy_003'), gain: -4, at: 0 }] };
  buildSheet('steps', { sr: 32000, q: 3, norm: { loud: -18 }, cells: c });
}

// ---- 5. bullet impacts, ricochets, fly-bys, glass, bodies and voices ----
{
  const c = {};
  for (let i = 0; i < 5; i++) c[`imp_concrete_${i + 1}`] = { src: KI('impact_mining_00' + i), rate: 1.25, len: 0.3, fadeOut: 120, layers: [{ src: KI('impact_generic_light_00' + i), gain: -4, at: 0 }] };
  for (let i = 0; i < 5; i++) c[`imp_metal_${i + 1}`] = { src: KI(i < 3 ? 'impact_metal_medium_00' + i : 'impact_metal_light_00' + i), len: 0.34, fadeOut: 140 };
  for (let i = 0; i < 4; i++) c[`imp_wood_${i + 1}`] = { src: KI('impact_wood_medium_00' + i), len: 0.3, layers: [{ src: KI('impact_plank_medium_00' + i), gain: -6, at: 0, len: 0.25 }] };
  for (let i = 0; i < 4; i++) c[`imp_glass_${i + 1}`] = { src: KI('impact_glass_medium_00' + i), len: 0.4, fadeOut: 150 };
  for (let i = 0; i < 4; i++) c[`imp_dirt_${i + 1}`] = { src: KI('impact_soft_medium_00' + i), len: 0.25, layers: [{ src: KI('footstep_grass_00' + i), gain: -6, at: 0, len: 0.22 }] };
  c.imp_water_1 = { src: S('bryzg'), len: 0.6, fadeOut: 250 }; c.imp_water_2 = { src: S('bryzg'), rate: 1.2, len: 0.5, fadeOut: 220 }; c.imp_water_3 = { src: S('water-step'), rate: 0.8 };
  for (let i = 0; i < 4; i++) c[`flesh_${i + 1}`] = { src: KI('impact_punch_medium_00' + i), len: 0.25, fadeOut: 100, layers: [{ src: KI('impact_soft_heavy_00' + i), gain: -3, at: 0, len: 0.2 }, { src: S('dead-hit'), gain: -10, at: 0, rate: 0.9 + i * 0.06 }] };
  for (let i = 1; i <= 7; i++) c[`ric_${i}`] = S('ric' + (i === 1 ? '' : i));
  for (let i = 1; i <= 5; i++) c[`whiz_${i}`] = S('bulletby' + (i === 1 ? '' : i));
  c.glassBreak_1 = { src: OC('GLASBrk_WindowPaneSmallBreak_OS_01'), layers: [{ src: KI('impact_glass_heavy_000'), gain: -5, at: 0 }] };
  c.glassBreak_2 = { src: OC('GLASBrk_GlassBottleBreak_OS_01'), layers: [{ src: KI('impact_glass_heavy_002'), gain: -4, at: 0 }] };
  c.glassBreak_3 = { src: OC('GLASBrk_WindowPaneSmallBreak_OS_01'), rate: 0.84, layers: [{ src: KU('glass_004'), gain: -8, at: 0.06 }, { src: KI('impact_glass_heavy_004'), gain: -5, at: 0 }] };
  for (let i = 0; i < 3; i++) c[`hurt_${i + 1}`] = { src: KI('impact_punch_medium_00' + (i + 1)), len: 0.3, post: 'lowpass=f=1400', layers: [{ src: S('vesthit'), gain: -8, at: 0, len: 0.2 }], norm: { loud: -14 } };
  c.death_1 = S('death'); c.death_2 = S('death2'); c.death_3 = S('death3');
  c.death_4 = OC('VOXMale_Male01Death_OS_01'); c.death_5 = OC('VOXMale_Male02Death_OS_01'); c.death_6 = OC('VOXMale_Male02Death_OS_03');
  c.bodyfall_1 = { src: KI('impact_soft_heavy_002'), layers: [{ src: OC('CLOTHMvmt_ClothingMovement_OS_03'), gain: -6, at: 0.02, len: 0.5 }] };
  buildSheet('impacts', { sr: 32000, q: 3, norm: { loud: -14 }, cells: c });
}

// ---- 6. interface, feedback and gameplay cues ----
{
  const c = {};
  Object.assign(c, {
    ui_hover_1: { src: KU('select_002'), norm: { loud: -20 } }, ui_click_1: KU('click_001'), ui_confirm_1: KU('confirmation_002'), ui_back_1: KU('back_002'),
    ui_deploy_1: { src: KU('confirmation_001'), layers: [{ src: KU('maximize_004'), gain: -6, at: 0.02 }] }, ui_tick_1: KU('tick_004'), ui_error_1: KU('error_008'),
    ui_rank_1: { src: OC('UIMisc_Powerup_OS_01'), len: 1.5, fadeOut: 400 },
    hit_1: { src: KU('glass_002'), len: 0.1, fadeOut: 50, norm: { loud: -14 } },
    headshot_1: { src: KU('glass_005'), rate: 1.25, len: 0.16, layers: [{ src: SP('elec_ping'), rate: 1.5, gain: -5, at: 0 }], norm: { loud: -14 } },
    kill_1: { src: KU('glass_001'), len: 0.3, layers: [{ src: KU('glass_005'), rate: 1.12, gain: 0, at: 0.075 }, { src: SP('bd_fat'), gain: -6, at: 0 }], norm: { loud: -14 } },
    capture_1: { src: KU('confirmation_002'), layers: [{ src: S('capture'), gain: -5, at: 0 }] },
    lost_1: { src: KU('error_006'), layers: [{ src: S('infilt-point'), gain: -4, at: 0, len: 1.2, fadeOut: 500 }] },
    spawn_1: { src: S('spawn'), len: 1.3, fadeOut: 600 }, spot_1: SP('elec_blip2'), tick_1: KU('tick_001'),
    countdown_1: SP('elec_beep'), mission_1: { src: OC('UIAlert_Notification_OS_03'), layers: [{ src: KU('glitch_002'), gain: -8, at: 0 }] },
    streakReady_1: { src: OC('UIMisc_Powerup_OS_02'), len: 1.3, fadeOut: 350 },
    uav_1: { src: SP('elec_ping'), layers: [{ src: SP('elec_ping'), gain: -9, at: 0.32 }, { src: SP('elec_ping'), gain: -16, at: 0.64 }] },
    radio_1: { src: KU('tick_001'), layers: [{ src: SP('vinyl_hiss'), from: 1, to: 1.09, trim: false, gain: -4, at: 0.012, af: 'highpass=f=900,lowpass=f=4200', fadeIn: 4, fadeOut: 12 }, { src: KU('tick_002'), gain: -3, at: 0.105 }] },
    // incoming shell: a hissing thruster recording narrowed to a whistle and swept downwards
    artyIn_1: { gen: 'glide', of: { src: KS('thruster_fire_000'), af: 'bandpass=f=2400:width_type=q:w=5,bandpass=f=2400:width_type=q:w=3', trim: false }, r0: 1.7, r1: 0.6, len: 2.1, swell: 1.6, fadeOut: 40, norm: { loud: -13, win: 0.3 } },
    // reactor alarm: the low buzzer signal pitched up, three pulses per 1.2 s cycle
    siren_1: { src: S('signal'), rate: 1.5, len: 0.2, fadeOut: 30, layers: [{ src: S('signal'), rate: 1.5, len: 0.2, at: 0.4, gain: 0 }, { src: S('signal'), rate: 1.5, len: 0.2, at: 0.8, gain: 0 }], post: 'highpass=f=140,equalizer=f=1500:t=q:w=0.7:g=5', norm: { loud: -13 } },
    // heartbeat: two low kick-drum hits
    heartbeat_1: { src: SP('bd_pure'), len: 0.2, af: 'lowpass=f=170', layers: [{ src: SP('bd_pure'), rate: 1.14, len: 0.18, gain: -4, at: 0.27, af: 'lowpass=f=190' }], norm: { loud: -13 } },
    ability_1: { src: KS('force_field_002'), norm: { loud: -15 } }, abilityEnd_1: { src: KS('force_field_004'), rate: 0.72, norm: { loud: -15 } },
  });
  buildSheet('ui', { sr: 44100, q: 4, norm: { loud: -16 }, cells: c });
}

// ---- 7. thunder (real storm recording; the constant rain hiss is low-passed away) ----
{
  const T = 'ss:592036__guidofm__thunder-rain-next-to-window-23lufs.wav'; const af = 'lowpass=f=2600,highpass=f=24';
  const c = {
    thunder_1: { gen: 'thunder', src: T, af, from: 9, to: 31, len: 9, thr: -24, fadeIn: 250, fadeOut: 2500 },
    thunder_2: { gen: 'thunder', src: T, af, from: 148, to: 162, len: 8, thr: -22, fadeIn: 200, fadeOut: 2500 },
    thunder_3: { gen: 'thunder', src: T, af, from: 161.5, to: 171, len: 6.5, thr: -22, fadeIn: 200, fadeOut: 2200 },
    thunder_4: { gen: 'thunder', src: T, af, from: 63, to: 73, len: 6.5, thr: -28, fadeIn: 300, fadeOut: 2500 },
  };
  buildSheet('thunder', { sr: 22050, q: 3, norm: { loud: -12, win: 0.4 }, cells: c });
}

// ---- 8. ambience beds ----
buildLoop('rain_out', { src: OC('RAIN_CityRain_LOOP_01'), from: 6 }, { sr: 32000, ch: 2, q: 2, len: 13, xf: 2, rms: -23 });
buildLoop('rain_in', { src: OC('RAINInt_ForestCabinRain_LOOP_01'), from: 5, af: 'lowpass=f=7000' }, { sr: 32000, ch: 2, q: 1, len: 12, xf: 2, rms: -24 });
buildLoop('wind', { src: S('sfx_wind') }, { sr: 22050, ch: 1, q: 2, len: 5.6, xf: 1.2, rms: -22 });
buildLoop('reactor', { src: OC('MACHMisc_MachineHum_LOOP_01'), from: 3, rate: 0.7, layers: [{ src: KS('space_engine_low_000'), gain: -3, at: 0, trim: false, len: 7, fadeOut: 0 }] }, { sr: 22050, ch: 1, q: 2, len: 4.4, xf: 0.5, rms: -20 });

// ---- 9. score (ready-made CC0 music from FreePD, cut into loops) and stingers ----
buildMusic('music_menu', 'ss:Hidden Truth.mp3', { from: 3, to: 88, minLen: 60, maxLen: 80, rms: -19 });
buildMusic('music_tension', 'ss:Dawn of the Apocalypse.mp3', { from: 4, to: 118, minLen: 58, maxLen: 72, rms: -20 });
buildMusic('music_combat', 'ss:After the End.mp3', { from: 3, to: 86, minLen: 56, maxLen: 72, rms: -19 });
{
  const c = {
    sting_win_1: { src: OC('MUSCStngr_VictoryOrchestral_OS_03'), trim: true, layers: [{ src: SP('misc_cineboom'), gain: -9, at: 0, len: 4.5, fadeOut: 2000 }] },
    sting_lose_1: { src: OC('MUSCStngr_LossOrchestral_OS_03'), layers: [{ src: SP('bass_drop_c'), gain: -12, at: 0, af: 'lowpass=f=900' }] },
    sting_capture_1: { src: OC('MUSCStngr_LevelUpOrchestral_OS_02') },
  };
  buildSheet('stings', { sr: 44100, ch: 2, q: 3, norm: { loud: -15, win: 0.4 }, cells: c });
}

// ---------------------------------------------------------------- engine metadata
// Groups: name -> { v: variants, b: bus (w weapons, s sfx, f foley, u ui, m music), g: base gain, p: pitch spread,
//                   far: far-distance group, ref: distance of full level (m), n: near/far crossfade range, l: layers }
const G = {}; const V = (base, n) => Array.from({ length: n }, (_, i) => `${base}_${i + 1}`);
const gun = (id, n, g, far, extra) => { G['gun_' + id] = { v: V('gun_' + id, n), b: 'w', g, p: 0.025, far, ref: 9, n: [38, 80], ...extra }; };
gun('k7', 3, 0.78, 'far_rifle'); gun('arco', 3, 0.74, 'far_rifle'); gun('vespa', 3, 0.66, 'far_small'); gun('faisca', 3, 0.6, 'far_small');
gun('martelo', 2, 0.95, 'far_heavy'); gun('trovao', 3, 0.84, 'far_rifle'); gun('bigorna', 3, 0.92, 'far_heavy'); gun('lanca', 2, 0.92, 'far_heavy');
gun('orion', 1, 1.0, 'far_heavy', { p: 0.03 }); gun('vigia', 1, 0.95, 'far_heavy', { p: 0.03 }); gun('p9', 2, 0.62, 'far_small'); gun('juiz', 2, 0.88, 'far_heavy');
gun('rajada', 3, 0.58, 'far_small'); gun('rpg', 1, 0.95, 'far_heavy');
Object.assign(G, {
  far_rifle: { v: V('far_rifle', 3), b: 'w', g: 0.9, p: 0.05, ref: 60 }, far_small: { v: V('far_small', 3), b: 'w', g: 0.75, p: 0.05, ref: 60 }, far_heavy: { v: V('far_heavy', 3), b: 'w', g: 1.1, p: 0.05, ref: 60 },
  battle: { v: V('battle', 8), b: 'a', g: 0.5, p: 0.08, ref: 70 },
  explosion: { v: V('exp_grenade', 2), b: 's', g: 1.0, p: 0.04, far: 'exp_far', ref: 14, n: [50, 120] },
  explosion_rocket: { v: V('exp_rocket', 1), b: 's', g: 1.05, p: 0.05, far: 'exp_far', ref: 15, n: [50, 120] },
  explosion_barrel: { v: V('exp_barrel', 1), b: 's', g: 1.0, p: 0.06, far: 'exp_far', ref: 13, n: [50, 120] },
  explosion_big: { v: V('exp_big', 1), b: 's', g: 1.25, p: 0.03, far: 'exp_far_big', ref: 22, n: [70, 150] },
  exp_far: { v: ['exp_far_1', 'exp_far_2'], b: 's', g: 0.9, p: 0.06, ref: 70 }, exp_far_big: { v: ['exp_far_3'], b: 's', g: 1.4, p: 0.04, ref: 90 },
  debris: { v: V('debris', 3), b: 's', g: 0.8, p: 0.08, ref: 8 }, collapse: { v: V('collapse', 1), b: 's', g: 1.0, p: 0.06, ref: 14 }, glass_break: { v: V('glassBreak', 3), b: 's', g: 0.9, p: 0.08, ref: 7 },
  draw: { v: V('draw', 2), b: 'f', g: 0.55, p: 0.04 }, pickup: { v: V('pickup', 1), b: 'f', g: 0.6, p: 0.04 }, scope: { v: V('scope', 1), b: 'f', g: 0.4, p: 0.04 }, scopeback: { v: V('scopeback', 1), b: 'f', g: 0.4, p: 0.04 },
  bolt: { v: V('bolt', 1), b: 'f', g: 0.75, p: 0.03 }, boltFwd: { v: V('boltFwd', 1), b: 'f', g: 0.75, p: 0.03 }, pump: { v: V('pump', 1), b: 'f', g: 0.8, p: 0.03 }, shellIn: { v: V('shellIn', 3), b: 'f', g: 1.0, p: 0.03 },
  pin: { v: V('pin', 1), b: 'f', g: 0.8, p: 0.04, ref: 4, l: [{ n: 'throw', g: 0.9, d: 0.16 }] }, throw: { v: V('throw', 1), b: 'f', g: 0.7, p: 0.05, ref: 4 }, nade_bounce: { v: V('nadeBounce', 2), b: 's', g: 0.9, p: 0.08, ref: 5 },
  empty: { v: V('empty', 1), b: 'f', g: 0.8, p: 0.03 }, firemode: { v: V('firemode', 1), b: 'f', g: 0.7, p: 0.03 }, click: { v: V('click', 1), b: 'f', g: 0.6, p: 0.04 }, clipfall: { v: V('clipfall', 1), b: 'f', g: 0.6, p: 0.06 },
  lawload: { v: V('lawload', 1), b: 'f', g: 0.8, p: 0.03 }, lawlock: { v: V('lawlock', 1), b: 'f', g: 0.8, p: 0.03 }, casing: { v: V('casing', 3), b: 'f', g: 0.5, p: 0.08 },
  melee: { v: V('melee', 3), b: 'f', g: 0.7, p: 0.06, ref: 4 }, meleeHit: { v: V('meleeHit', 2), b: 's', g: 0.9, p: 0.05, ref: 5 }, vault: { v: V('vault', 1), b: 'f', g: 0.6, p: 0.05 },
  gear: { v: V('gear', 4), b: 'f', g: 0.28, p: 0.08 }, lowammo: { v: V('lowammo', 1), b: 'w', g: 0.3, p: 0.02 },
  shell_concrete: { v: V('shell_concrete', 3), b: 'f', g: 0.3, p: 0.08 }, shell_metal: { v: V('shell_metal', 3), b: 'f', g: 0.3, p: 0.08 }, shell_dirt: { v: V('shell_dirt', 3), b: 'f', g: 0.22, p: 0.08 },
  jump: { v: V('jump', 2), b: 'f', g: 0.45, p: 0.06 }, land_hard: { v: V('landHard', 1), b: 'f', g: 0.9, p: 0.05 },
  ricochet: { v: V('ric', 7), b: 's', g: 0.75, p: 0.06, ref: 7 }, whiz: { v: V('whiz', 5), b: 's', g: 0.8, p: 0.06, ref: 5 },
  flesh: { v: V('flesh', 4), b: 's', g: 0.8, p: 0.06, ref: 6 }, hurt: { v: V('hurt', 3), b: 's', g: 0.9, p: 0.05 }, death: { v: V('death', 6), b: 's', g: 0.85, p: 0.05, ref: 8 }, bodyfall: { v: V('bodyfall', 1), b: 's', g: 0.7, p: 0.08, ref: 5 },
  hit: { v: V('hit', 1), b: 'u', g: 0.8, p: 0.015 }, headshot: { v: V('headshot', 1), b: 'u', g: 0.7, p: 0.015 }, kill: { v: V('kill', 1), b: 'u', g: 0.85, p: 0.015 },
  capture: { v: V('capture', 1), b: 'u', g: 0.9, p: 0 }, lost: { v: V('lost', 1), b: 'u', g: 0.9, p: 0 }, spawn: { v: V('spawn', 1), b: 'u', g: 0.5, p: 0.02 }, spot: { v: V('spot', 1), b: 'u', g: 0.6, p: 0.02 }, tick: { v: V('tick', 1), b: 'u', g: 0.6, p: 0.01 },
  countdown: { v: V('countdown', 1), b: 'u', g: 0.6, p: 0 }, mission: { v: V('mission', 1), b: 'u', g: 0.7, p: 0 }, streakReady: { v: V('streakReady', 1), b: 'u', g: 0.7, p: 0 }, uav: { v: V('uav', 1), b: 'u', g: 0.6, p: 0 }, radio: { v: V('radio', 1), b: 'u', g: 0.55, p: 0.03 },
  artyIn: { v: V('artyIn', 1), b: 's', g: 1.0, p: 0.04, ref: 30 }, siren: { v: V('siren', 1), b: 's', g: 0.55, p: 0, ref: 14 }, heartbeat: { v: V('heartbeat', 1), b: 'u', g: 0.9, p: 0.02 },
  ability: { v: V('ability', 1), b: 's', g: 0.55, p: 0.02, syn: 0.75 }, abilityEnd: { v: V('abilityEnd', 1), b: 's', g: 0.5, p: 0.02, syn: 0.75 },
  thunder: { v: V('thunder', 4), b: 'a', g: 1.0, p: 0.05 },
  sting_win: { v: V('sting_win', 1), b: 'm', g: 1.0, p: 0 }, sting_lose: { v: V('sting_lose', 1), b: 'm', g: 1.0, p: 0 }, sting_capture: { v: V('sting_capture', 1), b: 'm', g: 0.75, p: 0 },
});
for (const n of ['hover', 'click', 'confirm', 'back', 'deploy', 'tick', 'error', 'rank']) G['ui_' + n] = { v: V('ui_' + n, 1), b: 'u', g: n === 'hover' ? 0.16 : n === 'tick' ? 0.4 : 0.55, p: n === 'hover' ? 0.03 : 0 };
for (const s of ['concrete', 'metal', 'wood', 'dirt', 'grass']) { G[`step_${s}_run`] = { v: V(`step_${s}_run`, 4), b: 'f', g: 1, p: 0.05, ref: 5 }; G[`step_${s}_walk`] = { v: V(`step_${s}_walk`, 4), b: 'f', g: 1, p: 0.05, ref: 5 }; G['land_' + s] = { v: V('land_' + s, 2), b: 'f', g: 1, p: 0.05, ref: 5 }; }
for (const s of ['water', 'glass']) { G[`step_${s}_run`] = G[`step_${s}_walk`] = { v: V('step_' + s, 4), b: 'f', g: 1, p: 0.06, ref: 5 }; G['land_' + s] = G.land_concrete; }
for (const [m, n] of [['concrete', 5], ['metal', 5], ['wood', 4], ['glass', 4], ['dirt', 4], ['water', 3]]) G['imp_' + m] = { v: V('imp_' + m, n), b: 's', g: 0.8, p: 0.1, ref: 6 };
// how each weapon's reload is voiced: recording to take the events from, playback rate, or a hand-built sequence
// [sound, time as a fraction of the reload, gain, rate]
const RELOAD_MAP = {
  k7: { src: 'ak74' }, lanca: { src: 'ak74', rate: 0.86 }, arco: { src: 'steyr' }, vespa: { src: 'mp5' }, faisca: { src: 'mp5', rate: 1.12 },
  trovao: { src: 'm249' }, bigorna: { src: 'm249', rate: 0.88 }, orion: { src: 'barrett' }, vigia: { src: 'ruger' }, p9: { src: 'colt' }, rajada: { src: 'colt', rate: 1.15 },
  juiz: { seq: [['click', 0.1, 0.8, 1.1], ['casing', 0.27, 0.7, 1], ['casing', 0.3, 0.5, 1.1], ['casing', 0.34, 0.45, 0.92], ['shellIn', 0.45, 0.5, 1.5], ['shellIn', 0.53, 0.45, 1.56], ['shellIn', 0.61, 0.5, 1.45], ['rl_colt_2', 0.79, 0.9, 0.88], ['click', 0.92, 0.7, 1.35]] },
  rpg: { seq: [['draw', 0.04, 0.5, 0.8], ['lawload', 0.32, 1, 0.85], ['rl_m79_1', 0.66, 0.9, 1], ['lawlock', 0.8, 0.8, 1], ['gear', 0.88, 1.2, 0.9]] },
  martelo: { seq: [['gear', 0.0, 0.9, 1.1]] },
};
const CREDIT_NOTES = {
  soldat: 'Gunfire, reload and handling foley, ricochets, fly-bys, distant battle, explosions, death cries, wind. Modified (trimmed, layered, pitch-shifted, filtered, re-encoded).',
  kimp: 'Bullet impacts, debris hits, body impacts.', kui: 'Menu and HUD feedback sounds.', ksci: 'Explosion layers, quantum ability layers, incoming shell whistle.',
  oc: 'Footsteps, rain beds, reactor hum, shell casings, cloth and gear, glass breaks, stingers. "Oculus Audio Pack 01" by Oculus VR, LLC, licensed under CC BY 4.0; modified.',
  sp: 'Sub layers, pings and beeps, heartbeat.', ss: 'Score: "Hidden Truth", "Dawn of the Apocalypse", "After the End" by Rafael Krux (FreePD, CC0). Thunder: recording by guidofm (freesound, CC0).',
};
const usedPacks = new Set([...USE.keys()].map(k => k.slice(0, k.indexOf(':'))));
const AUDIO_CREDITS = Object.entries(PACKS).filter(([k]) => usedPacks.has(k)).map(([k, P]) => ({ pack: P.pack, author: k === 'ss' ? 'Rafael Krux; guidofm' : P.author, licence: P.licence, url: P.repo, note: CREDIT_NOTES[k] }));

const files = SIZES.map(s => s[0].replace(/\.ogg$/, ''));
const META = { sprites: SPR, groups: G, loops: LOOPS, music: MUSIC, reloads: RELOADS, reloadMap: RELOAD_MAP };
for (const [g, d] of Object.entries(G)) for (const v of d.v) if (!SPR[v]) throw new Error(`group ${g}: missing sprite ${v}`);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ files, info: INFO, ...META, credits: AUDIO_CREDITS }, null, 1));
const id = (f) => 'f_' + f.replace(/[^a-z0-9]/gi, '_');
fs.writeFileSync(path.join(OUT, 'index.js'), `// GENERATED by tools/audio/build-sounds.mjs. Do not edit: change the manifest in that script and rebuild.
// Every .ogg is embedded as a Uint8Array (esbuild 'binary' loader). SFX files are sprite sheets: META.sprites maps a
// sound name to [sheet, start in seconds, length in seconds].
${files.map(f => `import ${id(f)} from './${f}.ogg';`).join('\n')}
export const FILES = { ${files.map(f => `${JSON.stringify(f)}: ${id(f)}`).join(', ')} };
export const META = ${JSON.stringify(META)};
export const AUDIO_CREDITS = ${JSON.stringify(AUDIO_CREDITS, null, 2)};
`);

// ---------------------------------------------------------------- CREDITS.md
{
  const rows = [];
  for (const [ref, u] of [...USE.entries()].sort()) {
    const i = ref.indexOf(':'); const pk = ref.slice(0, i), rel = ref.slice(i + 1); const P = PACKS[pk];
    const p = pk === 'ss' ? SS_FILES[rel][0] : P.prefix + rel; const au = pk === 'ss' ? SS_FILES[rel][1] : P.author + ' / ' + P.pack;
    rows.push(`| ${[...u.outs].sort().join(', ')} | ${P.repo} | \`${p}\` | ${au} | ${P.licence} | ${[...u.mods].join(', ')} |`);
  }
  const md = `# COLAPSO: audio credits

All sound in the game comes from freely licensed recordings (CC0 or CC BY 4.0), processed by \`tools/audio/build-sounds.mjs\`
into the files under \`src/sounds/\`. Nothing was taken from commercial games. A few sounds that have no recording
(the quantum ability sweep, the ear-ring tone, the reverb impulse responses) are synthesised at run time in \`src/audio.js\`.

## Attribution (required by CC BY 4.0)

**Soldat base assets.** Gunfire, reload and handling foley, ricochets, bullet fly-bys, distant battle, explosions, death
cries and wind are adapted from the sound effects of *Soldat* (\`shared/sfx\` of https://github.com/Soldat/base), by the
Soldat team and contributors (Michal Marcinkowski and the contributors listed in that repository's \`Credits.md\`),
licensed under the Creative Commons Attribution 4.0 International licence (https://creativecommons.org/licenses/by/4.0/).
**The files were modified**: trimmed, level-normalised, resampled, in places pitch-shifted, filtered, split into events and
layered with other recordings, then re-encoded as Ogg Vorbis. No endorsement by the Soldat team is implied.

**Oculus Audio Pack 01.** Footsteps, rain, machine hum, shell casings, cloth and gear movement, glass breaks, switches and
the end-of-match stingers are adapted from "Oculus Audio Pack 01" by Oculus VR, LLC
(https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/), obtained from https://github.com/facebookincubator/Meta-open-sound
(\`corpora/oculus-audio-pack\`: files renamed there to the UCS naming convention, OGG previews transcoded from the original WAVs).
**The files were modified**: trimmed, level-normalised, resampled, looped with crossfaded seams, layered and re-encoded.

## Public domain (CC0 1.0) sources, credited with thanks

- **Kenney** (www.kenney.nl): Impact Sounds, Interface Sounds, Sci-Fi Sounds (CC0 1.0).
- **Sonic Pi sample library** (https://github.com/sonic-pi-net/sonic-pi, \`etc/samples\`, CC0 1.0; originals from freesound.org authors).
- **Music**: "Hidden Truth", "Dawn of the Apocalypse" and "After the End" by **Rafael Krux**, published on FreePD.com as CC0 1.0,
  taken from the mirror https://github.com/soundsafari/CC0-1.0-Music (\`freepd.com/\`). Cut into loops and re-encoded.
- **Thunder**: "thunder-rain-next-to-window" by **guidofm** (freesound.org sound 592036), CC0 1.0 as stated by the same mirror (\`freesound.org/\`).

## File by file

Generated from the pipeline manifest. "Our sound" is the name (or name prefix) used by \`src/audio.js\`.

| Our sound(s) | Source repository | Original file | Author / pack | Licence | Modifications |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
  fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), md);
}

// ---------------------------------------------------------------- size table
{
  const tot = {}; console.log('\nfile                     kind       seconds      kB   kbit/s');
  for (const [f, b, s, k] of SIZES) { tot[k] = (tot[k] || 0) + b; console.log(f.padEnd(24), k.padEnd(9), s.toFixed(1).padStart(8), (b / 1024).toFixed(0).padStart(7), (b * 8 / s / 1000).toFixed(0).padStart(8)); }
  const all = Object.values(tot).reduce((a, b) => a + b, 0);
  console.log(Object.entries(tot).map(([k, b]) => `${k} ${(b / 1048576).toFixed(2)} MB`).join('   '), `  TOTAL ${(all / 1048576).toFixed(2)} MB (budget 6 MB)`);
  console.log(`${Object.keys(SPR).length} sprites, ${Object.keys(G).length} groups, ${SIZES.length} files, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
