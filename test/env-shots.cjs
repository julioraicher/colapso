// Environment / FX review tool (adapted copy of scenes.cjs).
// node test/env-shots.cjs <outdir> '<json>' | @file.json  [distdir]
// shot: { name, x, y, z, yaw, pitch, hud:0|1, fov, frames, dt, pre:"js run before the frames (g = game, T = THREE-ish helpers)",
//         each:"js run every frame (i = frame index)", post:"js run after the frames", perf:n (time n update+render frames), keep:1 (do not reset bots) }
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
  let js = process.argv[3]; if (js.startsWith('@')) js = fs.readFileSync(js.slice(1), 'utf8');
  const shots = JSON.parse(js);
  const dist = process.argv[4] || 'dist';
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message + (e.stack || '')));
  pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); else if (m.text().startsWith('ENV')) console.log(m.text()); });
  await pg.goto('file://' + path.resolve(dist, 'index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  await pg.evaluate(() => {
    const g = window.__game; g.testMode = true; g.startMatch(); g.deploy(); g.spawnProtect = 999;
    for (const b of g.bots) { b.alive = false; b.model.visible = false; b.respawnT = 999; }
    window.V3 = (x, y, z) => new g.player.pos.constructor(x, y, z);
  });
  for (const s of shots) {
    const info = await pg.evaluate((s) => {
      const g = window.__game, p = g.player, V3 = window.V3;
      const hud = document.getElementById('hud'); if (hud) hud.style.visibility = s.hud ? '' : 'hidden';
      for (const id of ['legend']) { const e = document.getElementById(id); if (e) e.style.visibility = s.hud ? '' : 'hidden'; }
      const pose = () => { p.pos.set(s.x, s.y, s.z); p.yaw = s.yaw || 0; p.pitch = s.pitch || 0; p.vel.set(0, 0, 0); p.hp = 100; p.alive = true; };
      if (s.x !== undefined) pose();
      if (s.fov) g.settings.fov = s.fov;
      g.mouse.r = !!s.ads;
      if (s.wpn) { g.weapons.primary = { id: s.wpn, mag: 10, reserve: 50 }; g.setWeapon('primary'); }
      if (s.bot) { const b = g.bots.find(b => b.team === s.bot.team && !b.alive) || g.bots[0]; b.spawnAt(V3(s.bot.x, s.bot.y, s.bot.z)); b.respawnT = 999; b.yaw = s.bot.yaw || 0; b.think = () => {}; }
      const dt = s.dt || 1 / 30;
      if (s.pre) (new Function('g', 'V3', 's', s.pre))(g, V3, s);
      const each = s.each ? new Function('g', 'V3', 'i', 's', s.each) : null;
      for (let i = 0; i < (s.frames ?? 30); i++) { if (s.x !== undefined && !s.free) pose(); if (each) each(g, V3, i, s); g.update(dt); g.world.update(20); }
      if (s.post) (new Function('g', 'V3', 's', s.post))(g, V3, s);
      g.render();
      const r = { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, pts: g.renderer.info.render.points, lines: g.renderer.info.render.lines };
      if (s.perf) {
        const gl = g.renderer.getContext(); const px = new Uint8Array(4); let tu = 0, tr = 0, worst = 0;
        for (let i = 0; i < s.perf; i++) {
          if (s.x !== undefined && !s.free) pose(); if (each) each(g, V3, i, s);
          const t0 = performance.now(); g.update(dt); g.world.update(4); const t1 = performance.now(); g.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t2 = performance.now();
          tu += t1 - t0; tr += t2 - t1; worst = Math.max(worst, t2 - t0);
        }
        r.updMs = +(tu / s.perf).toFixed(3); r.renMs = +(tr / s.perf).toFixed(2); r.worstMs = +worst.toFixed(1);
      }
      return r;
    }, s);
    console.log(s.name, JSON.stringify(info));
    if (!s.noshot) await pg.screenshot({ path: `${out}/${s.name}.png` });
  }
  console.log(errs.length ? 'ERRORS ' + errs.length + '\n' + errs.slice(0, 12).join('\n') : 'ERRORS 0');
  await b.close();
})();
