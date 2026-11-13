// Automated playtest: an AI "pilot" drives the real player controller through a match while the sim runs
// headless at fixed dt. Reports gameplay metrics + JS errors + screenshots at checkpoints.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2] || '/tmp/claude-0/shots'; const SECS = +(process.argv[3] || 240);
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  await pg.evaluate(() => {
    const g = window.__game; g.testMode = true; g.startMatch(); g.deploy();
    const THREE_V = g.player.pos.constructor;
    g.stats = { shots: 0, tunnels: 0, echoes: 0, collapses: 0, nades: 0, maxStepMs: 0, stuck: 0 };
    let path = null, pi = 0, repath = 0, abilT = 3, lastPos = g.player.pos.clone(), stuckT = 0;
    g.botPilot = (g) => {
      const p = g.player; const inp = { f: false, b: false, l: false, r: false, sprint: false, crouch: false, jump: false };
      // target: nearest visible enemy
      let best = null, bd = 70;
      for (const e of g.bots) if (e.alive && e.team === 1) { const d = e.pos.distanceTo(p.pos); if (d < bd && g.world.los(p.eye, e.chest)) { bd = d; best = e; } }
      g.mouse.l = false; g.mouse.r = false;
      if (best) {
        const c = best.chest; const dx = c.x - p.eye.x, dy = c.y - p.eye.y, dz = c.z - p.eye.z;
        const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        let d = wantYaw - p.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        p.yaw += d * 0.35; p.pitch += (wantPitch - p.pitch) * 0.35;
        if (Math.abs(d) < 0.08) { g.mouse.l = true; g.mouse.r = bd > 15; if (g.fireCool <= 0) g.stats.shots++; if (!g.WD.auto) g.triggerReleased = true; }
        if (g.W.mag === 0) g.startReload();
        if (bd > 20 && Math.random() < 0.003 && g.nades > 0) { g.playerGrenade(); g.stats.nades++; }
      }
      // movement toward contested/unowned flag
      repath -= 1 / 30;
      if (repath <= 0 || !path || pi >= path.length) {
        repath = 3;
        const f = g.flags.slice().sort((a, b) => ((a.owner === 0 && a.cap >= 1) - (b.owner === 0 && b.cap >= 1)) || (Math.hypot(a.x - p.pos.x, a.z - p.pos.z) - Math.hypot(b.x - p.pos.x, b.z - p.pos.z)))[0];
        path = g.nav.path(p.pos, new THREE_V(f.x + Math.random() * 6 - 3, 0, f.z + Math.random() * 6 - 3)); pi = 0;
      }
      if (path && pi < path.length && !(best && bd < 20)) {
        const n = path[pi]; const dx = n.x - p.pos.x, dz = n.z - p.pos.z; const dd = Math.hypot(dx, dz);
        if (dd < 0.6) pi++;
        else {
          if (!best) { const wy = Math.atan2(-dx, -dz); let d = wy - p.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.yaw += d * 0.3; p.pitch *= 0.9; }
          // move in world dir relative to yaw
          const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
          const a = (dx * fx + dz * fz) / dd, s = (dx * rx + dz * rz) / dd;
          inp.f = a > 0.3; inp.b = a < -0.3; inp.r = s > 0.3; inp.l = s < -0.3; inp.sprint = !best && a > 0.7;
        }
      } else if (best) { inp.l = Math.sin(g.time * 2) > 0; inp.r = !inp.l; }
      stuckT += 1 / 30; if (stuckT > 2) { stuckT = 0; if (lastPos.distanceTo(p.pos) < 0.5 && !best) { g.stats.stuck++; inp.jump = true; repath = 0; } lastPos.copy(p.pos); }
      // abilities
      abilT -= 1 / 30;
      if (abilT <= 0) {
        abilT = 4 + Math.random() * 4;
        const before = g.energy;
        if (Math.random() < 0.5) { g.tunnel(); if (g.energy < before) g.stats.tunnels++; }
        else if (!g.echo.alive) { g.superpose(); if (g.echo.alive) g.stats.echoes++; }
      }
      if (g.echo.alive && g.echo.t < 3 && Math.random() < 0.05) { g.superpose(); g.stats.collapses++; }
      return inp;
    };
  });
  const shots = [30, 90, 150];
  for (let s = 0; s < SECS; s += 10) {
    const r = await pg.evaluate((n) => {
      const g = window.__game; let worst = 0;
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        if (g.state === 'deploy') g.deploy();
        if (g.state === 'end') break;
        g.update(1 / 30); g.world.update(4);
        worst = Math.max(worst, performance.now() - t);
      }
      g.stats.maxStepMs = Math.max(g.stats.maxStepMs, worst);
      return { t: g.time.toFixed(0), state: g.state, tickets: g.tickets, flags: g.flags.map(f => f.id + ':' + f.cap.toFixed(2)).join(' '), k: g.pent.kills, d: g.pent.deaths, hp: g.player.hp | 0, en: g.energy | 0, alive: g.bots.filter(b => b.alive).length, worstMs: worst.toFixed(1), botKills: g.bots.reduce((a, b) => a + b.kills, 0) };
    }, 300);
    console.log(JSON.stringify(r));
    if (shots.includes(s)) { await pg.evaluate(() => { const g = window.__game; g.render(); }); await pg.screenshot({ path: `${out}/pt_${s}.png` }); }
    if (r.state === 'end') break;
  }
  const st = await pg.evaluate(() => window.__game.stats); console.log('STATS', JSON.stringify(st));
  console.log('ERRORS', errs.length); console.log(errs.slice(0, 10).join('\n'));
  await b.close();
})();
