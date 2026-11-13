// Bot-vs-bot balance: player removed from play; measures team symmetry over N simulated seconds.
// Usage: node test/balance.cjs [seconds] [conquest|tdm|koth|all] [even]
// The player's seat stays empty, so Kappa fields seven bots against eight; "even" benches one Omega bot (seven a side).
// Also reports the average cost of one simulation step ("ms") and how much of it is spent in the bots and in the
// gameplay rule modules ("prof", milliseconds per step), so a run on another build gives a like-for-like baseline.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const secs = +(process.argv[2] || 300), arg = process.argv[3] || 'conquest', even = process.argv[4] === 'even';
  const modes = arg === 'all' ? ['conquest', 'tdm', 'koth'] : [arg];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  for (const mode of modes) {
    await pg.goto('file://' + path.resolve('dist/index.html'));      // a fresh world for every mode
    await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
    const r = await pg.evaluate(([secs, mode, even]) => {
      const g = window.__game; g.testMode = true; if (g.setMode) g.setMode(mode); g.startMatch(); g.deploy();
      if (even) { const out = g.bots.filter(bot => bot.team === 1).pop(); out.alive = false; out.respawnT = 1e9; out.model.visible = false; if (out.squad) out.squad.members = out.squad.members.filter(m => m !== out); } g.player.pos.set(2, 30, 2); g.player.phased = true; g.botPilot = () => ({});
      const prof = { bots: 0, rules: 0, callins: 0, squads: 0 };
      const wrap = (o, k) => { if (!o || !o.update) return; const f = o.update.bind(o); o.update = (a, c) => { const t = performance.now(); f(a, c); prof[k] += performance.now() - t; }; };
      for (const bot of g.bots) wrap(bot, 'bots');
      wrap(g.rules, 'rules'); wrap(g.callins, 'callins'); wrap(g.squads, 'squads');
      const log = []; let n = 0; const t0 = performance.now();
      for (let i = 0; i < secs * 30; i++) {
        g.player.pos.set(2, 30, 2); g.player.vel.set(0, 0, 0); g.update(1 / 30); g.world.update(4); n++;
        if (i % 900 === 0) log.push(`${(i / 30) | 0}s T${g.tickets.map(v => Math.round(v))} F:${g.flags.map(f => f.cap.toFixed(1)).join(',')}`);
        if (g.state === 'end') break;
      }
      const ms = (performance.now() - t0) / n;
      const k = [0, 0], d = [0, 0]; for (const bot of g.bots) { k[bot.team] += bot.kills; d[bot.team] += bot.deaths; }
      for (const key in prof) prof[key] = +(prof[key] / n).toFixed(3);
      return { mode: (g.mode || 'conquest') + (even ? ' 7v7' : ' 7v8'), log, kills: k, deaths: d, ms: ms.toFixed(2), prof, tickets: g.tickets.map(v => Math.round(v)), end: g.state, simSecs: (n / 30) | 0,
        result: g.state === 'end' ? document.getElementById('endT').textContent : null, tally: g.squads ? g.squads.tally : null };
    }, [secs, mode, even]);
    console.log(JSON.stringify(r));
  }
  console.log('ERRORS', errs.length); console.log(errs.slice(0, 10).join('\n')); await b.close();
})();
