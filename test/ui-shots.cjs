// UI review shots: every menu and HUD state at a given viewport, plus a layout audit (off-screen / clipped elements).
// usage: node test/ui-shots.cjs <outdir> [width] [height] [only,comma,separated]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2] || '/tmp/claude-0/wf/ui/shots'; const VW = +(process.argv[3] || 1366), VH = +(process.argv[4] || 768);
  const only = process.argv[5] ? process.argv[5].split(',') : null;
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: VW, height: VH } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  const audit = () => pg.evaluate(() => {
    const bad = []; const W = innerWidth, H = innerHeight;
    const roots = [...document.querySelectorAll('.ov:not(.hidden)')]; const hud = document.getElementById('hud');
    if (!hud.classList.contains('hidden') && !hud.classList.contains('behind')) roots.push(hud);
    const skip = (el) => el.closest('#objs,#scope,#vign,#qfx,#flash,#dmgdir,#xh,#hm,svg') || el.id === 'legin';
    const rects = [];
    for (const r of roots) for (const el of r.querySelectorAll('*')) {
      if (skip(el)) continue; const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue;
      const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '');
      if (b.left < -1 || b.top < -1 || b.right > W + 1 || b.bottom > H + 1) bad.push('OFFSCREEN ' + name + ' ' + [b.left, b.top, b.right, b.bottom].map(v => v | 0).join(','));
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 2 && el.textContent.trim() && !el.querySelector('canvas')) bad.push('CLIPPED ' + name + ' "' + el.textContent.trim().slice(0, 30) + '" ' + el.scrollWidth + '>' + el.clientWidth);
      if (r === hud && el.parentElement === hud && el.classList.contains('hz') && el.id !== 'legend') rects.push([name, b]);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i][1], c = rects[j][1]; if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) bad.push('OVERLAP ' + rects[i][0] + ' x ' + rects[j][0]); }
    return bad.slice(0, 14);
  });
  let n = 0;
  const shot = async (name) => { n++; if (only && !only.includes(name)) return; await pg.waitForTimeout(250); const f = `${out}/${String(n).padStart(2, '0')}_${name}.png`; await pg.screenshot({ path: f }); const a = await audit(); console.log(name.padEnd(10), a.length ? '\n  ' + a.join('\n  ') : 'ok'); };
  const step = (frames = 20) => pg.evaluate((frames) => { const g = window.__game; for (let i = 0; i < frames; i++) { g.update(1 / 30); g.world.update(20); } g.render(); }, frames);
  const key = (code) => pg.evaluate((code) => document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })), code);

  await shot('menu');
  await pg.evaluate(() => window.__game.show('how')); await shot('how');
  await pg.evaluate(() => window.__game.show('opts')); await shot('opts');
  await pg.evaluate(() => { const g = window.__game; g.show('menu'); g.testMode = true; g.startMatch(); });
  await pg.waitForTimeout(700); await shot('deploy');
  await pg.evaluate(() => { const g = window.__game; g.deploy(); for (const b of g.bots) { if (b.team === 1) { b.alive = false; b.model.visible = false; b.respawnT = 999; } } g.player.yaw = 0.5; });
  await step(40); await shot('play');
  await pg.evaluate(() => { const g = window.__game; g.W.mag = 5; g.hud.feed('RAPOSA', 'LINCE', 0, true, false, false); g.hud.feed('VOCÊ', 'CORVO', 0, false, true, false); g.hud.toast('ABATE · TIRO NA CABEÇA', 150); g.hud.toast('INIMIGO MARCADO', 10); g.hud.radio('COMANDO', 'Ômega avançando pelo ponto B.'); g.hud.event('⚠ SOBRECARGA DO REATOR · 14s · SAIA DO PONTO B'); g.energy = 30; });
  await step(4); await shot('lowammo');
  await pg.evaluate(() => { const g = window.__game; g.hud.event(null); g.energy = 100; g.weapons.primary = { id: 'orion', mag: 5, reserve: 30 }; g.setWeapon('primary'); g.mouse.r = true; g.player.pitch = 0.05; });
  await step(40); await shot('scoped');
  await pg.evaluate(() => { const g = window.__game, p = g.player, f = g.flags[0]; g.mouse.r = false; const q = p.pos.clone(); q.set(f.x + 2, 0, f.z + 2); const h = g.nav.heightAt(q); p.pos.set(q.x, h === null ? 1 : h, q.z); p.vel.set(0, 0, 0); p.yaw = 2.2; p.pitch = 0; });
  await step(60); await shot('onflag');
  await pg.evaluate(() => { const g = window.__game; g.player.alive = false; g.deathT = 3.2; g.killer = g.bots.find(b => b.team === 1); g.pent.alive = false; });
  await step(4); await shot('dead');
  await pg.evaluate(() => { const g = window.__game; g.pent.alive = true; g.player.alive = true; g.deploy(); g.player.yaw = 0.5; });
  await step(20); await key('KeyH'); await shot('keys'); await key('KeyH');
  await step(5); await key('KeyM'); await step(10); await shot('bigmap'); await key('KeyM');
  await pg.evaluate(() => { const g = window.__game; g.settings.hints = 'never'; g.settings.hudScale = 1.2; g.hud.applyUi(); });
  await step(5); await shot('nolegend');
  await pg.evaluate(() => { const g = window.__game; g.settings.hints = 'always'; g.settings.hudScale = 1; g.hud.applyUi(); });
  await step(3);
  await pg.evaluate(() => window.__game.pause()); await shot('pause'); await pg.evaluate(() => window.__game.resume());
  await pg.evaluate(() => window.__game.show('score', true)); await shot('score'); await pg.evaluate(() => window.__game.hud.hideScore());
  await pg.evaluate(() => { const g = window.__game; g.pent.kills = 14; g.pent.deaths = 6; g.pent.caps = 3; g.pent.score = 3150; g.endMatch(true); }); await shot('end');
  console.log('ERRORS', errs.length); console.log(errs.slice(0, 10).join('\n'));
  await b.close();
})();
