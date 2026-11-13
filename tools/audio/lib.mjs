// Shared helpers for the audio pipeline: decoding through ffmpeg into Float32Arrays, small DSP
// utilities (trim, fades, mixing, loop crossfade, level measurement, spectral centroid) and Vorbis encoding.
// Node only. Nothing here runs in the game.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'colapso-audio-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* best effort */ } });
let tmpN = 0;
export const tmpFile = (ext) => path.join(TMP, `t${tmpN++}.${ext}`);

function run(args, input) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + args.join(' ') + '\n' + (r.stderr ? r.stderr.toString() : r.error));
  return r.stdout;
}

// Decode any file ffmpeg understands to planar float channels at the requested rate.
// af: optional ffmpeg audio filter chain applied at the SOURCE rate, before the final resample.
export function decode(file, { sr = 44100, ch = 1, af = null, ss = null, t = null } = {}) {
  const args = [];
  if (ss != null) args.push('-ss', String(ss));
  if (t != null) args.push('-t', String(t));
  args.push('-i', file);
  if (af) args.push('-af', af);
  args.push('-ac', String(ch), '-ar', String(sr), '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1');
  const out = run(args);
  const inter = new Float32Array(out.buffer, out.byteOffset, Math.floor(out.byteLength / 4));
  return deinterleave(inter, ch);
}
export function deinterleave(inter, ch) {
  const n = Math.floor(inter.length / ch); const res = [];
  for (let c = 0; c < ch; c++) { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = inter[i * ch + c]; res.push(d); }
  return res;
}
export function interleave(chans) {
  const ch = chans.length, n = chans[0].length; const out = new Float32Array(n * ch);
  for (let c = 0; c < ch; c++) { const d = chans[c]; for (let i = 0; i < n; i++) out[i * ch + c] = d[i]; }
  return out;
}
// Run a float signal through an ffmpeg filter chain (same rate in and out unless outSr is given).
export function filter(chans, sr, af, outSr = sr) {
  const inter = interleave(chans);
  const out = run(['-f', 'f32le', '-ar', String(sr), '-ac', String(chans.length), '-i', 'pipe:0', '-af', af, '-ac', String(chans.length), '-ar', String(outSr), '-f', 'f32le', '-acodec', 'pcm_f32le', 'pipe:1'], Buffer.from(inter.buffer, inter.byteOffset, inter.byteLength));
  return deinterleave(new Float32Array(out.buffer, out.byteOffset, Math.floor(out.byteLength / 4)), chans.length);
}
export function writeWav(file, chans, sr) {
  const ch = chans.length, n = chans[0].length; const data = Buffer.alloc(44 + n * ch * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * ch * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20);
  data.writeUInt16LE(ch, 22); data.writeUInt32LE(sr, 24); data.writeUInt32LE(sr * ch * 2, 28); data.writeUInt16LE(ch * 2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * ch * 2, 40);
  let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { let v = chans[c][i]; v = v > 1 ? 1 : v < -1 ? -1 : v; data.writeInt16LE(Math.round(v * 32767), o); o += 2; }
  fs.writeFileSync(file, data);
}
// Encode to Ogg Vorbis. The float data goes in as f32le so nothing is quantised before the encoder.
export function encodeOgg(file, chans, sr, q = 4) {
  const inter = interleave(chans);
  run(['-y', '-f', 'f32le', '-ar', String(sr), '-ac', String(chans.length), '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', String(q), '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', file], Buffer.from(inter.buffer, inter.byteOffset, inter.byteLength));
}

// ---------- DSP ----------
export const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
export const lin = (d) => Math.pow(10, d / 20);
export function peak(chans) { let p = 0; for (const d of chans) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } return p; }
export function rms(chans, from = 0, to = chans[0].length) { let s = 0, n = 0; for (const d of chans) for (let i = from; i < to; i++) { s += d[i] * d[i]; n++; } return Math.sqrt(s / Math.max(1, n)); }
// RMS over the loudest window (default 100 ms): a better loudness proxy for one-shots than whole-file RMS.
export function loudWindowRms(chans, sr, win = 0.1) {
  const d = mono(chans), w = Math.max(1, Math.min(d.length, Math.round(win * sr))); let s = 0, best = 0;
  for (let i = 0; i < d.length; i++) { s += d[i] * d[i]; if (i >= w) s -= d[i - w] * d[i - w]; if (i >= w - 1 && s > best) best = s; }
  return Math.sqrt(best / w);
}
export function mono(chans) { if (chans.length === 1) return chans[0]; const n = chans[0].length; const m = new Float32Array(n); for (const d of chans) for (let i = 0; i < n; i++) m[i] += d[i] / chans.length; return m; }
export function gain(chans, g) { for (const d of chans) for (let i = 0; i < d.length; i++) d[i] *= g; return chans; }
export function slice(chans, a, b) { return chans.map(d => d.slice(Math.max(0, a), Math.min(d.length, b))); }
export function pad(chans, n) { return chans.map(d => { if (d.length >= n) return d; const o = new Float32Array(n); o.set(d); return o; }); }
export function concat(a, b) { return a.map((d, c) => { const o = new Float32Array(d.length + b[c].length); o.set(d); o.set(b[c], d.length); return o; }); }
export function silence(n, ch = 1) { const r = []; for (let c = 0; c < ch; c++) r.push(new Float32Array(n)); return r; }
export function toChannels(chans, ch) {
  if (chans.length === ch) return chans;
  if (ch === 1) return [mono(chans)];
  return [chans[0], chans[0].slice()];
}
// First sample whose magnitude exceeds thr (relative to the file peak). Used to cut leading silence.
export function onset(chans, relDb = -34) {
  const p = peak(chans); if (p <= 0) return 0; const thr = p * lin(relDb); const n = chans[0].length;
  for (let i = 0; i < n; i++) for (const d of chans) if (Math.abs(d[i]) >= thr) return i;
  return 0;
}
// Last sample above the threshold (relative to peak): where the tail has faded to nothing.
export function tailEnd(chans, relDb = -60) {
  const p = peak(chans); if (p <= 0) return 0; const thr = p * lin(relDb); const n = chans[0].length;
  for (let i = n - 1; i >= 0; i--) for (const d of chans) if (Math.abs(d[i]) >= thr) return i + 1;
  return 0;
}
export function fadeIn(chans, n) { for (const d of chans) { const m = Math.min(n, d.length); for (let i = 0; i < m; i++) d[i] *= i / m; } return chans; }
export function fadeOut(chans, n, curve = 1) { for (const d of chans) { const m = Math.min(n, d.length); for (let i = 0; i < m; i++) d[d.length - 1 - i] *= Math.pow(i / m, curve); } return chans; }
export function removeDc(chans) { for (const d of chans) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i]; s /= Math.max(1, d.length); for (let i = 0; i < d.length; i++) d[i] -= s; } return chans; }
// Mix b into a copy of a at sample offset `at` with gain g (result grows if needed).
export function mixInto(a, b, at = 0, g = 1) {
  const n = Math.max(a[0].length, at + b[0].length);
  return a.map((d, c) => { const o = new Float32Array(n); o.set(d); const s = b[Math.min(c, b.length - 1)]; for (let i = 0; i < s.length; i++) o[at + i] += s[i] * g; return o; });
}
// Seamless loop: equal-power crossfade of the last `x` samples into the first `x` samples; result is x shorter.
export function loopCrossfade(chans, x) {
  return chans.map(d => {
    const n = d.length - x; const o = new Float32Array(n); o.set(d.subarray(0, n));
    for (let i = 0; i < x; i++) { const t = i / x; const a = Math.sin(t * Math.PI / 2), b = Math.cos(t * Math.PI / 2); o[i] = d[i] * a + d[n + i] * b; }
    return o;
  });
}
// Soft limiter (tanh knee above `knee`), keeps transients mostly intact and guarantees |x| < 1.
export function softClip(chans, knee = 0.85) {
  for (const d of chans) for (let i = 0; i < d.length; i++) { const v = d[i], a = Math.abs(v); if (a > knee) d[i] = Math.sign(v) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee))); }
  return chans;
}

// ---------- analysis ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// Long-term average power spectrum (Hann, 2048, 50 % overlap). Returns { spec, binHz }.
export function spectrum(d, sr, N = 2048) {
  const spec = new Float64Array(N / 2); const re = new Float64Array(N), im = new Float64Array(N); let frames = 0;
  const hop = N / 2;
  for (let s = 0; s + 16 <= d.length && (s === 0 || s + N <= d.length + hop); s += hop) {
    for (let i = 0; i < N; i++) { const v = s + i < d.length ? d[s + i] : 0; re[i] = v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
    fft(re, im); for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k]; frames++;
    if (s + N >= d.length) break;
  }
  for (let k = 0; k < N / 2; k++) spec[k] /= Math.max(1, frames);
  return { spec, binHz: sr / N };
}
export function centroid(d, sr) {
  const { spec, binHz } = spectrum(d, sr); let a = 0, b = 0;
  for (let k = 1; k < spec.length; k++) { const m = Math.sqrt(spec[k]); a += m * k * binHz; b += m; }
  return b > 0 ? a / b : 0;
}
// Share of energy below / above given frequencies (for "sub heavy" and "bright" checks).
export function bandShare(d, sr, lo, hi) {
  const { spec, binHz } = spectrum(d, sr); let a = 0, b = 0;
  for (let k = 1; k < spec.length; k++) { const f = k * binHz; b += spec[k]; if (f >= lo && f < hi) a += spec[k]; }
  return b > 0 ? a / b : 0;
}
// Amplitude envelope sampled every `hop` seconds (RMS per hop), normalised to its max.
export function envelope(d, sr, hop = 0.005, len = 0) {
  const h = Math.max(1, Math.round(hop * sr)); const n = len ? Math.round(len / hop) : Math.ceil(d.length / h); const e = new Float32Array(n); let mx = 0;
  for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let j = i * h; j < (i + 1) * h && j < d.length; j++) { s += d[j] * d[j]; c++; } e[i] = c ? Math.sqrt(s / c) : 0; if (e[i] > mx) mx = e[i]; }
  if (mx > 0) for (let i = 0; i < n; i++) e[i] /= mx;
  return e;
}
export function correlation(a, b) {
  const n = Math.min(a.length, b.length); let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}
// Coarse log-spaced band spectrum in dB (for the distinctness matrix): 16 bands 60 Hz .. sr/2.
export function bandProfile(d, sr, bands = 16) {
  const { spec, binHz } = spectrum(d, sr); const lo = 60, hi = sr / 2; const out = new Float32Array(bands);
  for (let b = 0; b < bands; b++) {
    const f0 = lo * Math.pow(hi / lo, b / bands), f1 = lo * Math.pow(hi / lo, (b + 1) / bands); let s = 0, c = 0;
    for (let k = Math.max(1, Math.floor(f0 / binHz)); k <= Math.min(spec.length - 1, Math.ceil(f1 / binHz)); k++) { s += spec[k]; c++; }
    out[b] = 10 * Math.log10(Math.max(1e-12, c ? s / c : 0));
  }
  return out;
}
export function measure(chans, sr) {
  const d = mono(chans); const p = peak(chans); const on = onset(chans, -34); const end = tailEnd(chans, -60);
  let dc = 0; for (let i = 0; i < d.length; i++) dc += d[i]; dc /= Math.max(1, d.length);
  let clipped = 0, runMax = 0, runCur = 0;
  for (let i = 0; i < d.length; i++) { if (Math.abs(d[i]) >= 0.999) { clipped++; runCur++; if (runCur > runMax) runMax = runCur; } else runCur = 0; }
  // longest inner silence (below -60 dBFS absolute) between the onset and the end of the tail
  let gap = 0, cur = 0; for (let i = on; i < end; i++) { if (Math.abs(d[i]) < 0.001) { cur++; if (cur > gap) gap = cur; } else cur = 0; }
  return { dur: d.length / sr, peakDb: db(p), rmsDb: db(rms(chans)), loudDb: db(loudWindowRms(chans, sr)), leadMs: on / sr * 1000, tailMs: (d.length - end) / sr * 1000, centroid: centroid(d, sr), dc, clipped, clipRun: runMax, gapMs: gap / sr * 1000 };
}
