const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message + (e.stack||'')));
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  await pg.waitForTimeout(400); await pg.screenshot({ path: out + '/s_menu.png' });
  await pg.evaluate(() => { const g = window.__game; g.testMode = true; g.startMatch(); g.deploy(); for (const b of g.bots) { b.alive = false; b.model.visible = false; b.respawnT = 999; } });
  const shots = JSON.parse(process.argv[3]);
  for (const s of shots) {
    const info = await pg.evaluate((s) => {
      const g = window.__game, p = g.player; p.pos.set(s.x, s.y, s.z); p.yaw = s.yaw; p.pitch = s.pitch || 0; p.vel.set(0,0,0);
      if (s.ads) g.mouse.r = true; else g.mouse.r = false;
      if (s.wpn) { g.weapons.primary = { id: s.wpn, mag: 10, reserve: 50 }; g.setWeapon('primary'); }
      if (s.bot) { const b = g.bots.find(b => b.team === s.bot.team && !b.alive) || g.bots[0]; b.spawnAt(new p.pos.constructor(s.bot.x, s.bot.y, s.bot.z)); b.respawnT = 999; b.yaw = s.bot.yaw || 0; b.think = () => {}; }
      if (s.nade) { g.explode(new p.pos.constructor(s.nade.x, s.nade.y, s.nade.z), s.nade.r || 2.8, g.pent); }
      if (s.echo) { g.energy = 100; g.superpose(); }
      if (s.fire) { g.vm.fire(1); g.vm.flashT = 99; }
      for (let i = 0; i < (s.frames ?? 30); i++) { g.update(1/30); g.world.update(20); }
      g.render(); return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, pos: p.pos.toArray().map(v=>+v.toFixed(1)) };
    }, s);
    console.log(s.name, JSON.stringify(info));
    await pg.screenshot({ path: `${out}/s_${s.name}.png` });
  }
  console.log(errs.join('\n'));
  await b.close();
})();
