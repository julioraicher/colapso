// Reactor overload set-piece test: forces tickets low, runs countdown + chain, screenshots before/after, times worst frame.
const { chromium } = require('playwright'); const path = require('path');
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message + e.stack));
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  const pose = () => { const g = window.__game, p = g.player; p.pos.set(48, 1, 72); p.yaw = 0; p.pitch = 0.18; p.vel.set(0, 0, 0); p.hp = 100; p.alive = true; };
  await pg.evaluate(`(${(() => { const g = window.__game; g.testMode = true; g.startMatch(); g.deploy(); g.spawnProtect = 999; for (const b of g.bots) { b.respawnT = 999; b.alive = false; b.model.visible = false; } }).toString()})()`);
  await pg.evaluate(`(${pose.toString()})(); window.__game.update(1/30); window.__game.render();`);
  await pg.screenshot({ path: out + '/ev_before.png' });
  const r = await pg.evaluate(`(() => { const g = window.__game; g.tickets = [180, 185]; let worst = 0; const pose = ${pose.toString()};
    for (let i = 0; i < 30 * 26; i++) { pose(); const t = performance.now(); g.update(1/30); g.world.update(4); worst = Math.max(worst, performance.now() - t); if (g.event.st === 'boom' && g.event.k === 2 && !g._shot) { g._shot = 1; g.render(); return { mid: true, worst, st: g.event.st }; } }
    return { worst, st: g.event.st }; })()`);
  console.log(JSON.stringify(r));
  await pg.screenshot({ path: out + '/ev_mid.png' });
  const r2 = await pg.evaluate(`(() => { const g = window.__game; let worst = 0; const pose = ${pose.toString()};
    for (let i = 0; i < 30 * 8; i++) { pose(); const t = performance.now(); g.update(1/30); g.world.update(4); worst = Math.max(worst, performance.now() - t); }
    for (let i = 0; i < 60; i++) g.world.update(8); g.render(); return { worst, st: g.event.st, dirty: g.world.dirty.size }; })()`);
  console.log(JSON.stringify(r2));
  await pg.screenshot({ path: out + '/ev_after.png' });
  console.log(errs.join('\n')); await b.close();
})();
