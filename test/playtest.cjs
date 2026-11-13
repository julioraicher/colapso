// Automated playtest: an AI "pilot" drives the real player controller through a match while the sim runs
// headless at fixed dt. Reports gameplay metrics + JS errors + screenshots at checkpoints.
// Usage: node test/playtest.cjs <outdir> [seconds] [conquest|tdm|koth]
// The pilot also climbs obstacles (vault / mantle) and spends its call-in rewards; both are asserted at the end.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2] || '/tmp/claude-0/shots'; const SECS = +(process.argv[3] || 240); const MODE = process.argv[4] || 'conquest';
  require('fs').mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + path.resolve('dist/index.html'));
  await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
  await pg.evaluate((MODE) => {
    const g = window.__game; g.testMode = true; g.setMode(MODE); g.startMatch(); g.deploy();
    const THREE_V = g.player.pos.constructor;
    // the pilot's own counters (g.stats belongs to the game: the per-match statistics)
    g.pt = { shots: 0, tunnels: 0, echoes: 0, collapses: 0, nades: 0, maxStepMs: 0, stuck: 0, drills: 0, callins: [] };
    g.callins.earn(1400);        // the pilot is handed its rewards up front so that a short run exercises all three call-ins
    let path = null, pi = 0, repath = 0, abilT = 3, lastPos = g.player.pos.clone(), stuckT = 0, drill = null, drillT = 5, podT = 10, aimed = false;
    // a ledge 1 to 1.5 m above the feet with level ground in front of it, a few metres away
    const findClimb = (p) => {
      const w = g.world, fy = Math.floor((p.pos.y + 2.2) / 0.5);
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        for (let r = 0.5; r <= 7; r += 0.5) {
          const h = w.groundHeightAt(p.pos.x + dx * r, p.pos.z + dz * r, fy) - p.pos.y;
          if (h >= 0.95 && h <= 1.5 && r >= 1) return { x: p.pos.x + dx * (r + 0.5), z: p.pos.z + dz * (r + 0.5) };
          if (Math.abs(h) > 0.3) break;
        }
      }
      return null;
    };
    g.botPilot = (g) => {
      const p = g.player; const inp = { f: false, b: false, l: false, r: false, sprint: false, crouch: false, jump: false };
      // target: nearest visible enemy
      let best = null, bd = 70;
      for (const e of g.bots) if (e.alive && e.team === 1) { const d = e.pos.distanceTo(p.pos); if (d < bd && g.world.los(p.eye, e.chest)) { bd = d; best = e; } }
      g.mouse.l = false; g.mouse.r = false; aimed = false;
      if (best) {
        const c = best.chest; const dx = c.x - p.eye.x, dy = c.y - p.eye.y, dz = c.z - p.eye.z;
        const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
        let d = wantYaw - p.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        p.yaw += d * 0.35; p.pitch += (wantPitch - p.pitch) * 0.35;
        if (Math.abs(d) < 0.08) { aimed = true; g.mouse.l = true; g.mouse.r = bd > 15; if (g.fireCool <= 0) g.pt.shots++; if (!g.WD.auto) g.triggerReleased = true; }
        if (g.W.mag === 0) g.startReload();
        if (bd > 20 && Math.random() < 0.003 && g.nades > 0) { g.playerGrenade(); g.pt.nades++; }
      }
      // call-ins: the UAV as soon as it is ready, artillery on a distant enemy in the sights, the supply pod on whatever is ahead
      const S = g.streaks;
      if (S[0].ready && g.callins.use(0)) g.pt.callins.push('uav@' + g.time.toFixed(0));
      if (S[1].ready && best && bd > 22 && aimed && g.callins.use(1)) g.pt.callins.push('arty@' + g.time.toFixed(0));
      if (S[2].ready && !best && (podT -= 1 / 30) <= 0) { podT = 1.5; if (g.callins.use(2)) g.pt.callins.push('pod@' + g.time.toFixed(0)); }
      // climbing drill: until the first vault has happened, walk at a nearby ledge every few seconds and climb it
      drillT -= 1 / 30;
      if (!drill && !best && p.vaults === 0 && drillT <= 0 && p.onGround) { drillT = 5; const c = findClimb(p); if (c) { drill = { x: c.x, z: c.z, t: 3 }; g.pt.drills++; } }
      if (drill) {
        drill.t -= 1 / 30; const dx = drill.x - p.pos.x, dz = drill.z - p.pos.z;
        if (drill.t <= 0 || p.vaults > 0 || Math.hypot(dx, dz) < 0.3) { drill = null; repath = 0; }
        else { p.yaw = Math.atan2(-dx, -dz); p.pitch *= 0.8; inp.f = true; inp.jump = p.onGround && !!p.findLedge(1.5, p.pos.y + 1.5); return inp; }
      }
      // movement toward contested/unowned flag
      repath -= 1 / 30;
      if (repath <= 0 || !path || pi >= path.length) {
        repath = 3;
        let f = g.flags.slice().sort((a, b) => ((a.owner === 0 && a.cap >= 1) - (b.owner === 0 && b.cap >= 1)) || (Math.hypot(a.x - p.pos.x, a.z - p.pos.z) - Math.hypot(b.x - p.pos.x, b.z - p.pos.z)))[0];
        if (!f) {                // no objectives (team deathmatch): hunt the nearest living enemy
          let ed = 1e9; for (const e of g.bots) if (e.alive && e.team === 1) { const d = e.pos.distanceTo(p.pos); if (d < ed) { ed = d; f = e.pos; } }
          if (!f) f = { x: 48, z: 48 };
        }
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
          if (inp.f && p.onGround && p.findLedge(1.5, p.pos.y + 1.5)) inp.jump = true;      // climb whatever low obstacle is in the way
        }
      } else if (best) { inp.l = Math.sin(g.time * 2) > 0; inp.r = !inp.l; }
      stuckT += 1 / 30; if (stuckT > 2) { stuckT = 0; if (lastPos.distanceTo(p.pos) < 0.5 && !best) { g.pt.stuck++; inp.jump = true; repath = 0; } lastPos.copy(p.pos); }
      // abilities
      abilT -= 1 / 30;
      if (abilT <= 0) {
        abilT = 4 + Math.random() * 4;
        const before = g.energy;
        if (Math.random() < 0.5) { g.tunnel(); if (g.energy < before) g.pt.tunnels++; }
        else if (!g.echo.alive) { g.superpose(); if (g.echo.alive) g.pt.echoes++; }
      }
      if (g.echo.alive && g.echo.t < 3 && Math.random() < 0.05) { g.superpose(); g.pt.collapses++; }
      return inp;
    };
  }, MODE);
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
      g.pt.maxStepMs = Math.max(g.pt.maxStepMs, worst);
      return { t: g.time.toFixed(0), state: g.state, tickets: g.tickets, flags: g.flags.map(f => f.id + ':' + f.cap.toFixed(2)).join(' '), k: g.pent.kills, d: g.pent.deaths, hp: g.player.hp | 0, en: g.energy | 0, alive: g.bots.filter(b => b.alive).length, worstMs: worst.toFixed(1), botKills: g.bots.reduce((a, b) => a + b.kills, 0), vaults: g.player.vaults, callins: g.pt.callins.length };
    }, 300);
    console.log(JSON.stringify(r));
    if (shots.includes(s)) { await pg.evaluate(() => { const g = window.__game; g.render(); }); await pg.screenshot({ path: `${out}/pt_${s}.png` }); }
    if (r.state === 'end') break;
  }
  const fin = await pg.evaluate(() => { const g = window.__game; return { pt: g.pt, match: g.stats, vaults: g.player.vaults, mode: g.mode, tally: g.squads.tally }; });
  console.log('STATS', JSON.stringify(fin.pt)); console.log('MATCH', fin.mode, JSON.stringify(fin.match)); console.log('BOTS', JSON.stringify(fin.tally));
  const asserts = [['pilot vaulted an obstacle', fin.vaults >= 1], ['pilot used a call-in', fin.pt.callins.length >= 1]];
  for (const [n, ok] of asserts) console.log('ASSERT ' + (ok ? 'OK   ' : 'FAIL ') + n);
  console.log('ERRORS', errs.length); console.log(errs.slice(0, 10).join('\n'));
  await b.close(); process.exitCode = errs.length || asserts.some(a => !a[1]) ? 1 : 0;
})();
