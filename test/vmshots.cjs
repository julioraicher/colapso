// First-person viewmodel contact sheets (adapted from test/scenes.cjs). Run from the worktree root:
//   node test/vmshots.cjs <out.png> '<json rows>' [--cell=WxH] [--cols=n] [--nohud=1]
// row: { wpn, ads?: 1, fire?: 1, seq?: 'reload'|'bolt'|'fire'|'inspect'|'sprint'|'melee', at?: [..], crop?: [x, y, w, h], label? }
//   reload / bolt / inspect / melee: `at` are fractions of the animation; fire / sprint: seconds after the event.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
(async () => {
  const args = process.argv.slice(2), flags = {}, pos = [];
  for (const a of args) { const m = /^--(\w+)=(.*)$/.exec(a); if (m) flags[m[1]] = m[2]; else pos.push(a); }
  const out = pos[0], rows = JSON.parse(pos[1]);
  const [cw, ch] = (flags.cell || '640x360').split('x').map(Number), cols = +(flags.cols || 4);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message + (e.stack || '')));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  await pg.evaluate(() => { const g = window.__game; g.testMode = true; g.startMatch(); g.deploy(); for (const b of g.bots) { b.alive = false; b.model.visible = false; b.respawnT = 999; } });
  if (flags.nohud) await pg.addStyleTag({ content: 'body *:not(canvas) { visibility: hidden !important } canvas, #scope, #scope * { visibility: visible !important }' });
  const cells = [];
  for (const r of rows) {
    await pg.evaluate((r) => {
      const g = window.__game, p = g.player; p.pos.set(r.x ?? 48, r.y ?? 1, r.z ?? 60); p.yaw = r.yaw ?? 0.3; p.pitch = r.pitch ?? 0; p.vel.set(0, 0, 0);
      p.hp = 100; g.mouse.r = false; g.mouse.l = false;
      g.weapons.primary = { id: r.wpn, mag: 10, reserve: 50 }; g.setWeapon('primary'); g.vm.hasRocket = true;
      for (let i = 0; i < 16; i++) { g.update(1 / 30); g.world.update(20); }
      if (r.ads) { g.mouse.r = true; for (let i = 0; i < 24; i++) g.update(1 / 30); }
      const D = g.WD, a = r.ads ? 1 : 0;
      window.__vt = { tau: 0, st: { mdx: 0, mdy: 0, sprint: false, ads: a, slide: false, reloadT: 0, reloadDur: 1, style: D.style, boltT: 0, boltDur: 1, bob: 0, moveK: 0, land: 0, fov: 60 - a * 10 } };
      if (r.fire || r.seq === 'fire' || r.seq === 'bolt') g.vm.fire(D.kick);
      if (r.fire) { g.vm.flashT = 99; g.vm.update(1 / 60, window.__vt.st); }
      if (r.seq === 'inspect') g.vm.inspect();
      if (r.seq === 'melee') g.vm.melee();
      if (r.seq === 'sprint') window.__vt.st.sprint = true;
    }, r);
    const at = r.seq ? r.at : [null];
    for (const f of at) {
      const info = await pg.evaluate(([r, f]) => {
        const g = window.__game, V = window.__vt, st = V.st, D = g.WD;
        if (f != null) {
          const total = r.seq === 'reload' ? D.reload : r.seq === 'bolt' ? D.bolt : r.seq === 'inspect' ? 2.5 : r.seq === 'melee' ? 0.5 : 1, target = f * total;
          while (V.tau < target - 1e-6) {
            const dt = Math.min(1 / 60, target - V.tau); V.tau += dt;
            if (r.seq === 'reload') { st.reloadDur = total; st.reloadT = Math.max(1e-4, total - V.tau); }
            if (r.seq === 'bolt') { st.boltDur = total; st.boltT = Math.max(1e-4, total - V.tau); }
            g.vm.update(dt, st);
          }
        }
        g.render(); return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles };
      }, [r, f]);
      const c = r.crop || [0, 0, 1280, 720];
      const buf = await pg.screenshot({ clip: { x: c[0], y: c[1], width: c[2], height: c[3] } });
      cells.push({ label: `${r.label || r.wpn}${r.ads ? ' ADS' : ''}${r.seq ? ' ' + r.seq + ' ' + f : ''}${r.fire ? ' fire' : ''}  [${info.calls} calls]`, src: 'data:image/png;base64,' + buf.toString('base64') });
    }
  }
  const rowsN = Math.ceil(cells.length / cols);
  const html = `<!doctype html><body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${cw}px);font:12px monospace">` +
    cells.map(c => `<div style="position:relative;width:${cw}px;height:${ch}px;overflow:hidden"><img src="${c.src}" style="width:${cw}px;height:${ch}px;object-fit:cover"><span style="position:absolute;left:4px;top:2px;color:#ff0;background:#0008;padding:0 3px">${c.label}</span></div>`).join('');
  const tmp = out + '.html'; fs.writeFileSync(tmp, html);
  const p2 = await b.newPage({ viewport: { width: cw * cols, height: ch * rowsN } });
  await p2.goto('file://' + path.resolve(tmp)); await p2.waitForTimeout(200); await p2.screenshot({ path: out }); fs.unlinkSync(tmp);
  console.log(`${cells.length} cells -> ${out}`); console.log(errs.length ? 'ERRORS ' + errs.length + '\n' + errs.slice(0, 6).join('\n') : 'ERRORS 0');
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
