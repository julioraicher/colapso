const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  await pg.evaluate(() => { const g = window.__game; g.testMode = true; g.startMatch(); });
  await pg.waitForTimeout(400); await pg.evaluate(() => window.__game.deploy()); await pg.waitForTimeout(1500);
  const place = (back) => pg.evaluate((back) => { const g = window.__game, p = g.player; p.pitch = 0; g.spawnProtect = 0;
    for (const o of g.bots) { o.think = () => {}; if (o.team === 1) o.pos.set(2, 30, 2); }
    const e = g.bots.find(o => o.team === 1 && o.alive); const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    e.pos.set(p.pos.x + fx * 1.3, p.pos.y, p.pos.z + fz * 1.3); e.yaw = back ? p.yaw : p.yaw + Math.PI; e.hp = 100; e.tryMove = () => {}; window.__e = e; g.meleeUntil = 0; return { name: e.name, hp: e.hp }; }, back);
  const res = [];
  for (const back of [false, true]) {
    await place(back); await pg.waitForTimeout(250);
    await pg.evaluate(() => { const e = window.__e, p = window.__game.player; const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw); e.pos.set(p.pos.x + fx * 1.3, p.pos.y, p.pos.z + fz * 1.3); window.__game.melee(); });
    await pg.waitForTimeout(120); 
    await pg.waitForTimeout(500);
    res.push(await pg.evaluate((back) => ({ back, hp: window.__e.hp, alive: window.__e.alive, score: window.__game.pent.score }), back));
  }
  console.log(JSON.stringify(res)); console.log('errs', errs.length, errs.slice(0, 5).join(' | '));
  await b.close();
})();
