// Bot-vs-bot balance: player removed from play; measures team symmetry over N simulated seconds.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  const r = await pg.evaluate((secs) => {
    const g = window.__game; g.testMode = true; g.startMatch(); g.deploy(); g.player.pos.set(2, 30, 2); g.player.phased = true; g.botPilot = () => ({});
    const log = []; let t0 = performance.now();
    for (let i = 0; i < secs * 30; i++) { g.player.pos.set(2, 30, 2); g.player.vel.set(0,0,0); g.update(1 / 30); g.world.update(4); if (i % 900 === 0) log.push(`${(i/30)|0}s T${g.tickets} F:${g.flags.map(f=>f.cap.toFixed(1)).join(',')}`); if (g.state === 'end') break; }
    const k = [0, 0], d = [0, 0]; for (const b of g.bots) { k[b.team] += b.kills; d[b.team] += b.deaths; }
    return { log, kills: k, deaths: d, ms: ((performance.now() - t0) / (secs * 30)).toFixed(2), tickets: g.tickets, end: g.state };
  }, +(process.argv[2] || 300));
  console.log(JSON.stringify(r, null, 1)); console.log(errs.join('\n')); await b.close();
})();
