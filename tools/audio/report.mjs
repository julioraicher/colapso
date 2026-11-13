#!/usr/bin/env node
// Measures what the audio pipeline produced (nobody on the build machine can listen, so everything is verified by
// numbers and pictures):  node tools/audio/report.mjs [--all] [--spec <outdir>]
//   per sound: duration, peak dBFS, loudest-100 ms RMS, leading silence, spectral centroid; flags for clipping,
//              DC offset, late onsets and silent gaps
//   gunfire:   a distinctness matrix of the 14 weapons (envelope and spectrum correlation, duration, centroid)
//   loops:     seam continuity of every ambience bed and of the music loops
//   --spec:    spectrogram contact sheets (guns, blasts, ambience across the seam, thunder, music)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as A from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'src/sounds');
const M = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const ALL = process.argv.includes('--all'); const si = process.argv.indexOf('--spec'); const SPEC = si > 0 ? process.argv[si + 1] : null;
const sr = 44100; const cache = {};
const file = (n) => cache[n] || (cache[n] = A.decode(path.join(DIR, n + '.ogg'), { sr, ch: (M.info[n] || { ch: 1 }).ch })); // decode with the file's own channel count (ffmpeg lowers a mono signal 3 dB when it upmixes)
const sprite = (n) => { const [sh, st, ln] = M.sprites[n]; return A.slice(file(sh), Math.round(st * sr), Math.round((st + ln) * sr)); };
const f1 = (x, w = 6) => x.toFixed(1).padStart(w);
let flags = 0;

// ---- every sprite ----
console.log('== sounds (peak dBFS, loudest 100 ms RMS dBFS, lead ms, centroid Hz)');
const bySheet = {};
for (const n of Object.keys(M.sprites)) (bySheet[M.sprites[n][0]] || (bySheet[M.sprites[n][0]] = [])).push(n);
const STRICT = { guns: 5, far: 8, blast: 8, steps: 8, impacts: 8, foley: 8 }; // max leading silence (ms) for transient material
const SLOW = /^(whiz|melee|artyIn|thunder|death|vault|gear|jump|sting|spawn|ability|rl_|scope|draw|pickup|lawload|collapse|imp_water|throw|bodyfall)/;
for (const [sh, names] of Object.entries(bySheet)) {
  let worstLead = 0, maxPk = -99, n = 0, sum = 0;
  for (const nm of names) {
    const c = sprite(nm); const m = A.measure(c, sr); n++; sum += m.loudDb; if (m.peakDb > maxPk) maxPk = m.peakDb;
    const fl = [];
    if (m.clipped) fl.push('CLIP' + m.clipped);
    if (Math.abs(m.dc) > 0.01) fl.push('DC');
    if (STRICT[sh] && !SLOW.test(nm)) { if (m.leadMs > worstLead) worstLead = m.leadMs; if (m.leadMs > STRICT[sh]) fl.push('LEAD'); }
    if (m.gapMs > 250 && !/^(battle|siren|uav|heartbeat|kill|radio|pump|pin|thunder|rl_)/.test(nm)) fl.push('GAP' + m.gapMs.toFixed(0));
    if (m.loudDb < -40) fl.push('QUIET');
    if (fl.length) flags++;
    if (ALL || fl.length || sh === 'guns') console.log(' ', nm.padEnd(24), f1(m.dur, 5) + 's', 'pk' + f1(m.peakDb), 'loud' + f1(m.loudDb), 'lead' + f1(m.leadMs, 5), 'cen' + m.centroid.toFixed(0).padStart(6), fl.join(' '));
  }
  console.log(`  [${sh}] ${n} sounds, mean loud ${f1(sum / n)} dBFS, max peak ${f1(maxPk)} dBFS${STRICT[sh] ? ', worst transient lead ' + worstLead.toFixed(1) + ' ms' : ''}`);
}

// ---- gun distinctness ----
console.log('\n== gunfire distinctness (first variant of each weapon)');
const guns = Object.keys(M.groups).filter(g => g.startsWith('gun_')); const F = {};
for (const g of guns) {
  const d = A.mono(sprite(M.groups[g].v[0])); const e = A.envelope(d, sr, 0.005, 0.5); const bp = A.bandProfile(d, sr); const end = A.tailEnd([d], -40) / sr;
  F[g] = { e, bp, dur: end, cen: A.centroid(d, sr), sub: A.bandShare(d, sr, 20, 150), hi: A.bandShare(d, sr, 4000, 22050) };
  console.log(' ', g.padEnd(12), 'len(-40dB)' + f1(end * 1000, 6) + ' ms', 'centroid' + F[g].cen.toFixed(0).padStart(6), 'sub<150Hz' + f1(F[g].sub * 100, 5) + '%', 'air>4k' + f1(F[g].hi * 100, 5) + '%');
}
console.log('  similarity = mean of envelope correlation (5 ms steps, first 500 ms) and band-spectrum correlation; 1.00 = identical');
console.log('  ' + ' '.repeat(12) + guns.map(g => g.slice(4, 9).padStart(6)).join(''));
let worst = { v: 0 }; let near = 0; const pairs = [];
for (const a of guns) {
  let row = '  ' + a.padEnd(12);
  for (const b of guns) {
    if (a === b) { row += '     -'; continue; }
    const s = (Math.max(0, A.correlation(F[a].e, F[b].e)) + Math.max(0, A.correlation(F[a].bp, F[b].bp))) / 2; row += s.toFixed(2).padStart(6);
    const dr = Math.max(F[a].dur, F[b].dur) / Math.min(F[a].dur, F[b].dur), cr = Math.max(F[a].cen, F[b].cen) / Math.min(F[a].cen, F[b].cen);
    if (a < b) { pairs.push({ a, b, s, dr, cr, ds: Math.abs(F[a].sub - F[b].sub), idx: (1 - s) * 4 + Math.abs(Math.log2(dr)) + Math.abs(Math.log2(cr)) * 2 + Math.abs(F[a].sub - F[b].sub) * 2 }); if (s > worst.v) worst = { v: s, a, b, dr, cr }; if (s > 0.97 && dr < 1.1 && cr < 1.08) { near++; console.log('  NEAR-IDENTICAL', a, b); } }
  }
  console.log(row);
}
console.log(`  closest pair: ${worst.a} / ${worst.b} similarity ${worst.v.toFixed(3)}, length ratio ${worst.dr.toFixed(2)}, centroid ratio ${worst.cr.toFixed(2)}  ->  ${near ? near + ' NEAR-IDENTICAL PAIRS' : 'no two weapons are near-identical'}`);
flags += near;
console.log('  least distinct pairs (index = 4(1-similarity) + |log2 length ratio| + 2|log2 centroid ratio| + 2|sub share difference|):');
for (const p of pairs.sort((x, y) => x.idx - y.idx).slice(0, 6)) console.log(`    ${p.a.slice(4).padEnd(8)} ${p.b.slice(4).padEnd(8)} index ${p.idx.toFixed(2)}  similarity ${p.s.toFixed(2)}  length x${p.dr.toFixed(2)}  centroid x${p.cr.toFixed(2)}  sub share diff ${(p.ds * 100).toFixed(0)} pts`);

// ---- loop seams ----
console.log('\n== loop seams');
const lvl = (c, a, b) => A.db(A.rms(c, Math.max(0, Math.round(a * sr)), Math.min(c[0].length, Math.round(b * sr))));
for (const [n, L] of Object.entries(M.loops)) {
  const c = file(n), d = A.mono(c); const s = Math.round(L.start * sr), e = Math.round(L.end * sr);
  let step = 0; for (let i = s + 1; i < e; i += 3) step += Math.abs(d[i] - d[i - 1]); step /= (e - s) / 3;
  const jump = Math.abs(d[s] - d[e - 1]); // what the looping source actually does at the wrap
  const W = Math.round(Math.min(2, (L.end - L.start) / 3) * sr); const before = A.bandProfile(d.subarray(e - W, e), sr), after = A.bandProfile(d.subarray(s, s + W), sr); let dmax = 0, top = -999; for (let i = 4; i < before.length; i++) top = Math.max(top, before[i]); for (let i = 4; i < before.length; i++) if (before[i] > top - 45) dmax = Math.max(dmax, Math.abs(before[i] - after[i])); // bands above ~200 Hz that carry signal
  let wc = 0; { const mN = Math.round(0.05 * sr); wc = A.correlation(d.subarray(e, e + mN), d.subarray(s, s + mN)); } // the samples after the loop end must repeat the loop start
  const ok = jump < step * 8 && dmax < 6 && wc > 0.8; if (!ok) flags++;
  console.log(`  ${n.padEnd(14)} loop ${(L.end - L.start).toFixed(2)} s  wrap jump ${(jump / (step + 1e-9)).toFixed(2)}x the mean sample step  level before/after ${f1(lvl(c, L.end - 1, L.end))} / ${f1(lvl(c, L.start, L.start + 1))} dB  max band difference ${dmax.toFixed(1)} dB  wrap continuity ${wc.toFixed(3)}  ${ok ? 'OK' : 'CHECK'}`);
}
for (const [n, T] of Object.entries(M.music)) {
  const c = file(n), d = A.mono(c); const L = Math.round(T.loop * sr), o = Math.round(T.ov * sr);
  const corr = A.correlation(d.subarray(0, o), d.subarray(L, L + o)); // the appended head must equal the real head
  const prof = []; for (let t = 0; t + 5 <= T.loop; t += 5) prof.push(lvl(c, t, t + 5)); const med = prof.slice().sort((a, b) => a - b)[prof.length >> 1];
  const seam = lvl(c, 0, 3), end = lvl(c, T.loop - 3, T.loop); const m = A.measure(c, sr);
  const ok = corr > 0.9 && Math.abs(seam - end) < 6 && !m.clipped; if (!ok) flags++;
  console.log(`  ${n.padEnd(14)} loop ${T.loop.toFixed(2)} s (+${T.ov} s overlap)  head/overlap correlation ${corr.toFixed(3)}  level first 3 s ${f1(seam)} dB, last 3 s ${f1(end)} dB, median ${f1(med)} dB  peak ${f1(m.peakDb)} dBFS  ${ok ? 'OK' : 'CHECK'}`);
}
console.log(`\n${flags} flag(s)`);

// ---- pictures ----
if (SPEC) {
  fs.mkdirSync(SPEC, { recursive: true });
  const pic = (name, chans, w, h) => { const wav = A.tmpFile('wav'); A.writeWav(wav, [A.mono(chans)], sr); const out = path.join(SPEC, name + '.png'); const r = spawnSync(A.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-lavfi', `showspectrumpic=s=${w}x${h}:legend=0:scale=log:fscale=lin:stop=16000`, out]); if (r.status !== 0) console.log(r.stderr.toString()); return out; };
  const strip = (names, each) => { let all = A.silence(1, 1); for (const n of names) { let c = [A.mono(sprite(n))]; c = A.pad(A.slice(c, 0, Math.round(each * sr)), Math.round(each * sr)); all = A.concat(all, c); } return all; };
  pic('guns', strip(guns.map(g => M.groups[g].v[0]), 1.2), 1680, 420);
  pic('blasts', strip(['exp_grenade_1', 'exp_rocket_1', 'exp_barrel_1', 'exp_big_1', 'exp_far_1', 'debris_1', 'collapse_1'], 3), 1680, 360);
  const seamOf = (n) => { const c = [A.mono(file(n))], L = M.loops[n]; const e = Math.round(L.end * sr), s = Math.round(L.start * sr); return A.concat(A.slice(c, e - 3 * sr, e), A.slice(c, s, s + 3 * sr)); };
  let amb = A.silence(1, 1); for (const n of ['rain_out', 'rain_in', 'wind', 'reactor']) amb = A.concat(amb, A.concat(seamOf(n), A.silence(sr / 4, 1)));
  pic('ambience_seams', amb, 1500, 360);
  pic('thunder', strip(['thunder_1', 'thunder_2', 'thunder_3', 'thunder_4'], 9), 1500, 300);
  const mp = Object.keys(M.music).map(n => pic('m_' + n, file(n), 1500, 240));
  spawnSync(A.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...mp.flatMap(p => ['-i', p]), '-filter_complex', `vstack=inputs=${mp.length}`, path.join(SPEC, 'music.png')]);
  console.log('spectrograms in', SPEC);
}
