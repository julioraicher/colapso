// Audio engine test: node test/audio.cjs
// Opens dist/index.html, starts the engine and a match, waits for every sample to decode, then checks that each
// required sound name resolves to decoded recordings, plays each one through the real engine, exercises reloads,
// impacts, the interface sounds, the music loop swap and the state-driven effects, and finally simulates a
// firefight (30 shots from several positions + 2 explosions inside one second) to verify the voice cap and the
// cost of play(). Exit code 0 = pass.
const { chromium } = require('playwright');
const path = require('path');

const GUNS = ['k7', 'arco', 'vespa', 'faisca', 'martelo', 'trovao', 'bigorna', 'lanca', 'orion', 'vigia', 'p9', 'juiz', 'rajada', 'rpg'];
const REQUIRED = [
  ...GUNS.map(g => 'gun_' + g), 'rifle', 'smg', 'sniper', 'shotgun', 'dmr', 'pistol', 'rocket', 'empty',
  'far_rifle', 'far_small', 'far_heavy',
  'draw', 'bolt', 'boltFwd', 'pump', 'shellIn', 'pickup', 'scope', 'scopeback', 'pin', 'throw', 'melee', 'meleeHit', 'firemode',
  'step', 'jump', 'land', 'land_hard', ...['concrete', 'metal', 'wood', 'dirt', 'grass', 'water', 'glass'].flatMap(s => ['step_' + s + '_run', 'step_' + s + '_walk', 'land_' + s]),
  'impact', 'imp_concrete', 'imp_metal', 'imp_wood', 'imp_glass', 'imp_dirt', 'imp_water', 'flesh', 'ricochet', 'whiz', 'glass_break', 'debris', 'collapse',
  'explosion', 'explosion_rocket', 'explosion_barrel', 'explosion_big', 'exp_far', 'exp_far_big',
  'thunder', 'battle', 'siren',
  'hit', 'headshot', 'kill', 'capture', 'lost', 'hurt', 'death', 'ability', 'abilityEnd', 'spawn', 'spot', 'tick',
  'vault', 'uav', 'artyIn', 'streakReady', 'mission', 'countdown', 'radio',
  'heartbeat', 'lowammo', 'gear', 'casing', 'shell_concrete', 'shell_metal', 'shell_dirt', 'nade_bounce',
  'sting_win', 'sting_lose', 'sting_capture',
  ...['hover', 'click', 'confirm', 'back', 'deploy', 'tick', 'error', 'rank'].map(n => 'ui_' + n),
];
const UI = ['hover', 'click', 'confirm', 'back', 'deploy', 'tick', 'error', 'rank'];

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' || (m.type() === 'warning' && /audio/i.test(m.text()))) errs.push(m.type() + ': ' + m.text()); });
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  const fail = []; const ok = (c, msg) => { if (!c) fail.push(msg); return c; };

  // ---- menu: engine start, non-blocking load, menu music through the music bus ----
  const boot = await pg.evaluate(async () => {
    const a = window.__game.audio, t0 = performance.now(); const p = a.init(); const syncMs = performance.now() - t0; const readyAtOnce = a.ready, loadedAtOnce = a.loaded;
    await p; a.init(); // idempotent
    const an = a.ctx.createAnalyser(); an.fftSize = 2048; a.bus.m.connect(an); window.__musAn = an;
    const out = a.ctx.createAnalyser(); out.fftSize = 2048; a.out.connect(out); window.__outAn = out;
    window.__rms = (n) => { const d = new Float32Array(n.fftSize); n.getFloatTimeDomainData(d); let s = 0, pk = 0; for (const v of d) { s += v * v; if (Math.abs(v) > pk) pk = Math.abs(v); } return [Math.sqrt(s / d.length), pk]; };
    return { syncMs, readyAtOnce, loadedAtOnce, ctx: a.ctx.state, sr: a.ctx.sampleRate, st: a.stats(), credits: (window.__game.audio.constructor && 1), hasGame: a.game === window.__game };
  });
  console.log(`engine: init() returned in ${boot.syncMs.toFixed(1)} ms (ready ${boot.readyAtOnce}, samples decoded later: ${!boot.loadedAtOnce}), context ${boot.ctx} @ ${boot.sr} Hz, decode ${boot.st.loadMs} ms, ${boot.st.buffers} buffers, failed: [${boot.st.failed}]`);
  ok(boot.ctx === 'running', 'audio context is not running'); ok(boot.readyAtOnce, 'ready flag not set by init()'); ok(boot.st.loaded && !boot.st.failed.length, 'samples failed to decode: ' + boot.st.failed);
  ok(boot.hasGame, 'audio.game hook missing'); ok(boot.syncMs < 250, 'init() blocks the menu for ' + boot.syncMs.toFixed(0) + ' ms');
  await pg.waitForTimeout(2500);
  const menu = await pg.evaluate(() => { const a = window.__game.audio, T = a.tracks.music_menu; let mx = 0; for (let i = 0; i < 1; i++) mx = Math.max(mx, window.__rms(window.__musAn)[0]); return { on: T.on, t: T.decks[0] ? T.decks[0].el.currentTime : -1, rms: mx, state: a.st.state, amb: !!a.amb, loops: Object.keys(a.loopBuf) }; });
  console.log(`menu: music_menu playing=${menu.on} at ${menu.t.toFixed(2)} s, music bus RMS ${menu.rms.toFixed(4)}, loops decoded: ${menu.loops.join(' ')}`);
  ok(menu.on && menu.t > 0.5, 'menu music is not playing'); ok(menu.rms > 1e-4, 'music bus is silent (media element not routed)'); ok(menu.loops.length === 4 && menu.amb, 'ambience loops missing');

  // ---- music loop swap: jump near the loop point and listen for a gap ----
  const swap = await pg.evaluate(async () => {
    const a = window.__game.audio, T = a.tracks.music_menu; const cur = T.cur; T.decks[cur].el.currentTime = T.m.loop - 1.2; let min = 9, n = 0;
    const t0 = performance.now(); while (performance.now() - t0 < 3200) { await new Promise(r => setTimeout(r, 40)); if (performance.now() - t0 > 400) { min = Math.min(min, window.__rms(window.__musAn)[0]); n++; } }
    return { flipped: T.cur !== cur, t: T.decks[T.cur].el.currentTime, minRms: min, n };
  });
  console.log(`music loop: deck swapped=${swap.flipped}, new deck at ${swap.t.toFixed(2)} s, lowest music RMS across the seam ${swap.minRms.toFixed(4)} (${swap.n} probes)`);
  ok(swap.flipped && swap.t > 0.3 && swap.t < 3.5, 'music loop swap did not happen'); ok(swap.minRms > 2e-5, 'music dropped out at the loop seam');

  // ---- match ----
  await pg.evaluate(() => { const g = window.__game; g.testMode = true; g.startMatch(); g.deploy(); g.spawnProtect = 999; });
  await pg.waitForTimeout(1500);
  const res = await pg.evaluate(async (args) => {
    const { REQUIRED, UI, GUNS } = args; const g = window.__game, a = g.audio, out = { missing: [], synth: [], thrown: [], notes: [] };
    const P = g.player.pos, at = (dx, dy, dz) => ({ x: P.x + dx, y: P.y + 1.5 + dy, z: P.z + dz });
    for (const n of REQUIRED) { const s = a.status(n); if (!a.has(n) || !s.kind) out.missing.push(n); else if (s.kind !== 'sample' || s.decoded !== s.variants) out.synth.push(n + ':' + s.kind + ' ' + s.decoded + '/' + s.variants); }
    // every name once, 2D and positional, through the real engine
    const before = a.stats().started; let i = 0;
    for (const n of REQUIRED) {
      try { a.play(n, null, 0.5, 1, 0.1); a.play(n, at(4 + (i % 7), 0, 3 - (i % 5)), 0.6); } catch (e) { out.thrown.push(n + ': ' + e.message); }
      if (++i % 12 === 0) await new Promise(r => setTimeout(r, 60));
    }
    out.playedAll = a.stats().started - before;
    try { a.play('no_such_sound'); a.play('no_such_sound', at(1, 0, 1), 1, 1, 0.2); } catch (e) { out.thrown.push('unknown name threw'); }
    for (const n of UI) { try { a.ui(n); } catch (e) { out.thrown.push('ui ' + n + ': ' + e.message); } }
    for (let k = 0; k < 10; k++) a.ui('hover'); // must be rate limited
    const W = g.audio.constructor; out.snd = GUNS.every(id => { let ok = false; try { ok = a.status('gun_' + id).kind === 'sample'; } catch (e) { /* */ } return ok; });
    // legacy call shapes used by main.js / ai.js today
    try { a.play('step', null, 0.175, 1, 0); a.play('step', null, 0.35, 1, 0); a.play('step', at(3, -1.5, 2), 0.9, 0.85); a.play('explosion', null, 0.3, 0.35, 0.8); a.play('debris', at(5, 0, 0), 0.4, 2.2); a.play('debris', at(5, 0, 0), 1.4, 0.7); a.play('impact', at(2, 0, 2), 0.3, 0.6); a.play('hit', null, 0.5, 1.3, 0); a.play('reload', null, 0.25, 1.4, 0); } catch (e) { out.thrown.push('legacy: ' + e.message); }
    await new Promise(r => setTimeout(r, 300));
    // reload foley for every weapon, and impacts for every material
    out.reloadScheduled = 0; out.reloadPer = {};
    for (const id of GUNS) { try { a.reload(id, { reload: 2 }, 0.5); out.reloadPer[id] = a.reloadSrc.length; out.reloadScheduled += a.reloadSrc.length; } catch (e) { out.thrown.push('reload ' + id + ': ' + e.message); } await new Promise(r => setTimeout(r, 30)); }
    a.cancelReload();
    for (let m = 0; m < 34; m++) { try { a.lastImpact = 0; a.impact(m, at(3, 0, 3)); } catch (e) { out.thrown.push('impact ' + m + ': ' + e.message); } }
    await new Promise(r => setTimeout(r, 1200));

    // ---- firefight: 30 shots from several positions and 2 explosions within one second ----
    const s0 = a.stats(); let calls = 0, cost = 0, maxVoices = 0;
    const shooters = [[12, 0, 5, 'gun_k7'], [-20, 0, 14, 'gun_trovao'], [35, 2, -30, 'gun_vespa'], [-60, 0, -45, 'gun_orion'], [8, 0, -9, 'gun_p9'], [90, 0, 60, 'gun_bigorna']];
    for (let k = 0; k < 30; k++) {
      const sh = shooters[k % shooters.length]; const t = performance.now();
      a.play(sh[3], at(sh[0], sh[1], sh[2]), 1, 1, 0.3); if (k % 3 === 0) { a.play('gun_arco', null, 0.9, 1, 0.35); calls++; }
      if (k === 10) { a.play('explosion', at(6, 0, 4), 1.6, 1, 0.5); a.play('debris', at(6, 0, 4), 1, 1); calls += 2; }
      if (k === 22) { a.play('explosion_rocket', at(-25, 0, 10), 1.6, 1, 0.5); calls++; }
      a.impact(5, at(2, 0, 2)); a.play('whiz', at(1, 0, 1), 1.1, 1.2); calls += 3;
      cost += performance.now() - t; maxVoices = Math.max(maxVoices, a.stats().voices);
      await new Promise(r => setTimeout(r, 33));
    }
    const s1 = a.stats(); out.fight = { calls, avgMs: cost / calls, maxVoices, started: s1.started - s0.started, quiet: s1.quiet - s0.quiet, dup: s1.dup - s0.dup, capped: s1.capped - s0.capped, stolen: s1.stolen - s0.stolen };
    const lv = window.__rms(window.__outAn); out.fight.outRms = lv[0]; out.fight.outPeak = lv[1];
    // ---- stress: far more than the cap in one burst ----
    const t1 = performance.now(); let n2 = 0;
    for (let k = 0; k < 400; k++) { const an = k * 0.7, d = 4 + (k % 40) * 2.5; a.play(k % 2 ? 'gun_k7' : 'imp_metal', at(Math.cos(an) * d, 0, Math.sin(an) * d), 1, 1 + (k % 9) * 0.01, 0.2); n2++; }
    out.stress = { avgMs: (performance.now() - t1) / n2, voices: a.stats().voices, capped: a.stats().capped - s1.capped, stolen: a.stats().stolen - s1.stolen };
    await new Promise(r => setTimeout(r, 400)); out.stress.voicesLater = a.stats().voices;

    // ---- state-driven feel ----
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(3300); // let the shell shock from the blasts above pass
    out.indoor0 = a.indoor; out.duck = a.ambDuck.gain.value;
    g.player.hp = 20; g.player.lastHurt = g.time; await wait(800); out.lowHp = a.st.lowHp; out.lowLP = a.worldLP.frequency.value;
    g.player.hp = 100; await wait(900); out.recovered = !a.st.lowHp; out.recLP = a.worldLP.frequency.value;
    a.play('explosion', at(2, 0, 1), 1.6, 1, 0.5); await wait(250); out.shockLP = a.worldLP.frequency.value; await wait(3300); out.afterShockLP = a.worldLP.frequency.value;
    g.pause(); await wait(700); out.pauseGain = a.worldGain.gain.value; out.pauseLP = a.worldLP.frequency.value; out.pauseMus = a.musLP.frequency.value;
    g.state = 'play'; g.show(null); await wait(700); out.resumeGain = a.worldGain.gain.value;
    out.tracks = Object.fromEntries(Object.entries(a.tracks).map(([k, T]) => [k, { on: T.on, level: T.level }]));
    // heat: tickets below 25 % must bring in the combat bed
    const keep = g.tickets.slice(); g.tickets[1] = Math.floor(keep[1] * 0.2); await wait(600); out.combat = a.tracks.music_combat.level; g.tickets[1] = keep[1];
    out.final = a.stats(); out.pollErr = a._pollErr ? String(a._pollErr) : null;
    return out;
  }, { REQUIRED, UI, GUNS });

  console.log(`names: ${REQUIRED.length} required, missing [${res.missing}], not fully sampled [${res.synth}], exceptions [${res.thrown}], voices started while playing all: ${res.playedAll}`);
  ok(!res.missing.length, 'missing sounds: ' + res.missing); ok(!res.synth.length, 'sounds that fell back to synthesis: ' + res.synth); ok(!res.thrown.length, 'exceptions: ' + res.thrown);
  console.log('reload events per weapon: ' + JSON.stringify(res.reloadPer));
  ok(res.reloadScheduled > 30 && Object.values(res.reloadPer).every(n => n > 0), 'reload foley scheduled too few events: ' + res.reloadScheduled);
  const f = res.fight;
  console.log(`firefight: ${f.calls} play() calls, avg ${f.avgMs.toFixed(3)} ms per call, peak active voices ${f.maxVoices} (cap 40), started ${f.started}, skipped quiet ${f.quiet} / duplicate ${f.dup} / over cap ${f.capped}, stolen ${f.stolen}, output RMS ${f.outRms.toFixed(3)} peak ${f.outPeak.toFixed(3)}`);
  console.log(`stress: 400 calls in one burst, avg ${res.stress.avgMs.toFixed(3)} ms per call, active voices ${res.stress.voices} (after 0.4 s: ${res.stress.voicesLater}), refused over cap ${res.stress.capped}, stolen ${res.stress.stolen}`);
  ok(f.maxVoices <= 40 && res.stress.voices <= 40, 'voice cap exceeded'); ok(f.avgMs < 0.2, 'play() too slow: ' + f.avgMs.toFixed(3) + ' ms'); ok(f.outPeak <= 1.0, 'output clips: ' + f.outPeak); ok(f.outRms > 0.001, 'no output during the firefight');
  console.log(`feel: indoor ${res.indoor0.toFixed(2)}, low health -> ${res.lowHp} (world low-pass ${res.lowLP.toFixed(0)} Hz), recovered -> ${res.recovered} (${res.recLP.toFixed(0)} Hz), blast at 2 m -> ${res.shockLP.toFixed(0)} Hz then ${res.afterShockLP.toFixed(0)} Hz, pause -> world gain ${res.pauseGain.toFixed(2)}, low-pass ${res.pauseLP.toFixed(0)} Hz, music ${res.pauseMus.toFixed(0)} Hz, resume -> ${res.resumeGain.toFixed(2)}`);
  console.log(`music: ${JSON.stringify(res.tracks)}, combat bed level with tickets at 20 %: ${res.combat}`);
  ok(res.lowHp && res.lowLP < 6000, 'low-health filter did not engage'); ok(res.recovered && res.recLP > 12000, 'low-health filter did not clear'); ok(res.shockLP < 3000 && res.afterShockLP > 12000, 'shell shock dip wrong');
  ok(res.pauseGain < 0.5 && res.pauseLP < 1500 && res.pauseMus < 2000, 'pause does not duck / filter'); ok(res.resumeGain > 0.8, 'resume did not restore the world level');
  ok(res.tracks.music_tension.on || res.tracks.music_combat.on, 'no match music'); ok(res.combat > 0, 'combat bed did not rise with low tickets'); ok(!res.pollErr, 'state poll failed: ' + res.pollErr);
  ok(!errs.length, 'console errors: ' + errs.slice(0, 5).join(' | '));
  console.log(`final: ${JSON.stringify(res.final)}`);
  console.log(fail.length ? 'AUDIO TEST FAIL\n - ' + fail.join('\n - ') : 'AUDIO TEST PASS');
  await b.close(); process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error('AUDIO TEST ERROR', e); process.exit(2); });
