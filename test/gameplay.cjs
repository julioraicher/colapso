// Targeted headless checks for the gameplay systems: game modes and their win conditions, call-ins (UAV, artillery,
// supply pod, enemy artillery), vault / ledge grab / fall damage, fire modes, bipod, regeneration, the pre-match
// countdown, statistics, missions and the bot roster.
// Usage: node test/gameplay.cjs [outdir] [filter]     (filter: part of a group name: roster, conquest, tdm, koth,
// callins, movement, weapons, countdown, missions, elite)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const out = process.argv[2] || '/tmp/claude-0/shots'; const only = process.argv[3] || '';
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  let fails = 0, passes = 0;
  const check = (name, ok, detail) => { if (ok) passes++; else fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined ? ' ' + JSON.stringify(detail) : '')); };
  const shot = async (name) => { await pg.evaluate(() => window.__game.render()); await pg.screenshot({ path: `${out}/${name}.png` }); };
  // a freshly loaded page (pristine world) with a match of the given mode under way
  const fresh = async (mode, live) => {
    await pg.goto('file://' + path.resolve('dist/index.html'));
    await pg.waitForFunction(() => window.__game && window.__game.state === 'menu', null, { timeout: 120000 });
    await pg.evaluate(([mode, live]) => {
      const g = window.__game; g.testMode = !live; g.setMode(mode); g.startMatch(); g.deploy();
      window.V3 = g.player.pos.constructor;
      // fixed-step simulation; fn(i) runs before every step and may return true to stop
      window.step = (secs, fn) => { for (let i = 0; i < secs * 30; i++) { if (fn && fn(i)) break; if (g.state === 'end') break; g.update(1 / 30); g.world.update(4); } };
      window.solidIn = (c, r) => { const w = g.world; let n = 0; const x0 = Math.floor((c.x - r) * 2), x1 = Math.ceil((c.x + r) * 2), z0 = Math.floor((c.z - r) * 2), z1 = Math.ceil((c.z + r) * 2); for (let y = 0; y < 48; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (w.get(x, y, z)) n++; return n; };
      // open, level ground closest to (cx, cz)
      window.openSpot = (cx, cz) => {
        const w = g.world; let best = null, bd = 1e9;
        for (let x = 12; x < 84; x += 1.5) for (let z = 12; z < 84; z += 1.5) {
          const h = w.groundHeightAt(x, z); if (h > 1.6) continue; let flat = true;
          for (const [a, c] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2]]) if (Math.abs(w.groundHeightAt(x + a, z + c) - h) > 0.6) flat = false;
          if (!flat) continue; const d = Math.hypot(x - cx, z - cz); if (d < bd) { bd = d; best = new window.V3(x, h, z); }
        }
        return best;
      };
      // a spot with a floor, at least 2.5 m of room and a thin roof above it
      window.roofedSpot = () => {
        const w = g.world;
        for (let x = 14; x < 82; x += 1) for (let z = 14; z < 82; z += 1) {
          const top = w.groundHeightAt(x, z); if (top < 3 || top > 9) continue;
          const vx = Math.floor(x * 2), vz = Math.floor(z * 2); let vy = Math.round(top * 2) - 1, thick = 0;
          while (vy >= 0 && w.get(vx, vy, vz)) { vy--; thick++; }
          if (vy < 4 || thick > 2) continue;
          const fl = w.groundHeightAt(x, z, vy); if (top - fl < 2.5 || fl > 2) continue;
          return { x, z, top, fl, vx, vz, roofVy: Math.round(top * 2) - 1 };
        }
        return null;
      };
    }, [mode, !!live]);
  };

  const groups = {
    roster: async () => {
      await fresh('conquest');
      const r = await pg.evaluate(() => {
        const g = window.__game; window.step(3);
        const cls = {}; let bad = 0; for (const bot of g.bots) { const k = bot.team + ':' + bot.cls; cls[k] = (cls[k] || 0) + 1; if (!bot.squad || !bot.wdef || !bot.hand) bad++; }
        const sq = g.squads.list.map(s => s.team + ':' + s.members.map(m => m.cls.slice(0, 3)).join('+') + '>' + (s.goalF ? s.goalF.id : '-'));
        const sizes = g.squads.list.map(s => s.members.length);
        return { cls, bad, sq, sizes, elites: g.bots.filter(bot => bot.elite).length, alive: g.bots.filter(bot => bot.alive).length };
      });
      check('bots: every bot has a class, a weapon profile and a squad', r.bad === 0 && Object.keys(r.cls).length === 8, r.cls);
      check('bots: three squads of two or three per team with an objective', r.sq.length === 6 && r.sizes.every(n => n >= 2 && n <= 3) && r.sq.every(s => !s.endsWith('-')), r.sq);
    },

    conquest: async () => {
      await fresh('conquest');
      const r = await pg.evaluate(() => {
        const g = window.__game, o = { mode: g.mode, name: g.modeName, flags: g.flags.map(f => f.id).join(''), tickets: g.tickets.slice() };
        window.step(1); o.mt = +g.matchTime.toFixed(2); g.tickets[1] = 0; window.step(0.3); o.state = g.state; o.endT = document.getElementById('endT').textContent;
        o.tiles = document.querySelectorAll('#endtiles .tile').length; o.endMis = document.getElementById('endmis').children.length;
        g.startMatch(); g.deploy(); window.step(1); g.tickets[0] = 0; window.step(0.3); o.state2 = g.state; o.endT2 = document.getElementById('endT').textContent;
        return o;
      });
      check('conquest: three flags, 300 tickets a side, match clock runs', r.flags === 'ABC' && r.tickets[0] === 300 && r.tickets[1] === 300 && r.mt > 0.9, r);
      check('conquest: enemy tickets at zero is a victory', r.state === 'end' && r.endT === 'VITÓRIA', r.endT);
      check('conquest: own tickets at zero is a defeat', r.state2 === 'end' && r.endT2 === 'DERROTA', r.endT2);
      check('end screen: statistics tiles and missions are filled', r.tiles >= 8 && r.endMis === 3, { tiles: r.tiles, missions: r.endMis });
    },

    tdm: async () => {
      await fresh('tdm');
      const r = await pg.evaluate(() => {
        const g = window.__game, o = { name: g.modeName, flags: g.flags.length, max: g.scoreMax, limit: g.timeLimit, label: g.scoreLabel, alias: g.tickets === g.score };
        window.step(14, () => { g.spawnProtect = 5; });
        o.moving = g.bots.filter(bot => bot.alive && Math.hypot(bot.vx || 0, bot.vz || 0) > 0.5).length; o.goals = g.squads.list.filter(s => s.goalP).length; o.score14 = g.score.slice();
        const kill = (head) => { const e = g.bots.find(bot => bot.alive && bot.team === 1); g.hitD = g.WD; e.hurt(999, g.time, g.pent, {}); g.onKill(g.pent, e, head, 12); };
        const s0 = g.score[0]; kill(false); o.scored = g.score[0] - s0;
        g.score[0] = 59; kill(true); window.step(0.2); o.state = g.state; o.endT = document.getElementById('endT').textContent;
        // time limit with the enemy ahead
        g.startMatch(); g.deploy(); window.step(0.5); g.score[1] = 3; g.score[0] = 1; g.matchTime = g.timeLimit - 0.1; window.step(0.4); o.state2 = g.state; o.endT2 = document.getElementById('endT').textContent;
        // time limit on a draw: overtime, the next point wins
        g.startMatch(); g.deploy(); window.step(0.5); g.score[0] = g.score[1] = 4; g.matchTime = g.timeLimit - 0.1; window.step(0.4); o.overtime = g.overtime; o.state3 = g.state;
        kill(false); window.step(0.2); o.state4 = g.state; o.endT4 = document.getElementById('endT').textContent;
        return o;
      });
      check('tdm: no flags, score to 60, eight-minute limit', r.flags === 0 && r.max === 60 && r.limit === 480 && r.alias, r);
      check('tdm: bots hunt without objectives', r.moving >= 4 && r.goals === 6, { moving: r.moving, squadsWithGoal: r.goals, score14: r.score14 });
      check('tdm: a kill scores one point for the killer\'s team', r.scored === 1, r.scored);
      check('tdm: reaching 60 kills is a victory', r.state === 'end' && r.endT === 'VITÓRIA', r.endT);
      check('tdm: the lead decides at the time limit', r.state2 === 'end' && r.endT2 === 'DERROTA', r.endT2);
      check('tdm: a draw at the limit goes to overtime and the next kill wins', r.overtime === true && r.state3 === 'play' && r.state4 === 'end' && r.endT4 === 'VITÓRIA', { overtime: r.overtime, then: r.endT4 });
    },

    koth: async () => {
      await fresh('koth');
      const r = await pg.evaluate(() => {
        const g = window.__game, p = g.player, f = g.flags[0], o = { name: g.modeName, flags: g.flags.length, hill: !!(f && f.hill), max: g.scoreMax };
        window.step(2);
        // the player stands on the hill; enemies that come close are removed (or one is held inside, to contest)
        let guest = null;
        const pin = () => {
          p.pos.set(f.x, 1.2, f.z); p.vel.set(0, 0, 0); g.spawnProtect = 5;
          for (const bot of g.bots) if (bot.team === 1 && bot.alive && bot !== guest && Math.hypot(bot.pos.x - f.x, bot.pos.z - f.z) < 10) bot.hurt(999, g.time, g.pent, {});
          if (guest) { if (!guest.alive) guest = g.bots.find(bot => bot.alive && bot.team === 1); if (guest) { guest.pos.set(f.x + 2, 1.2, f.z + 2); guest.hp = 100; } }
        };
        let capT = -1; window.step(14, (i) => { pin(); if (f.owner === 0 && f.cap >= 1) { capT = i / 30; return true; } });
        o.capT = +capT.toFixed(1); const s0 = g.score[0]; window.step(5, pin); o.held5 = g.score[0] - s0;
        guest = g.bots.find(bot => bot.alive && bot.team === 1); const s1 = g.score[0]; window.step(3, pin); o.contested3 = g.score[0] - s1; o.wasContested = f.contested; guest = null;
        g.score[0] = 197; window.step(6, pin); o.state = g.state; o.endT = document.getElementById('endT').textContent; o.final = g.score.slice();
        // enemy holds it alone
        g.startMatch(); g.deploy(); window.step(1); const f2 = g.flags[0]; f2.owner = 1; f2.cap = -1; g.score[1] = 199;
        const en = g.bots.find(bot => bot.team === 1 && bot.alive) || g.bots.find(bot => bot.team === 1);
        window.step(4, () => { g.player.pos.set(4, 30, 4); g.player.vel.set(0, 0, 0); g.spawnProtect = 5; if (en.alive) { en.pos.set(f2.x, 1.2, f2.z); en.hp = 100; } for (const bot of g.bots) if (bot.team === 0 && bot.alive && Math.hypot(bot.pos.x - f2.x, bot.pos.z - f2.z) < 10) bot.hurt(999, g.time, en, {}); });
        o.state2 = g.state; o.endT2 = document.getElementById('endT').textContent;
        return o;
      });
      check('koth: one central zone, first to 200', r.flags === 1 && r.hill && r.max === 200, r);
      check('koth: standing in the zone captures it', r.capT > 2 && r.capT < 8, r.capT);
      check('koth: one point per second while held uncontested', r.held5 >= 4 && r.held5 <= 6, r.held5);
      check('koth: no points while contested', r.contested3 === 0 && r.wasContested, r.contested3);
      check('koth: reaching 200 is a victory', r.state === 'end' && r.endT === 'VITÓRIA', r.final);
      check('koth: the enemy reaching 200 is a defeat', r.state2 === 'end' && r.endT2 === 'DERROTA', r.endT2);
    },

    callins: async () => {
      await fresh('conquest');
      // UAV
      const u = await pg.evaluate(() => {
        const g = window.__game, o = {}; window.step(3, () => { g.spawnProtect = 5; });
        o.before = g.streaks.map(s => s.ready); g.callins.earn(600); o.ready = g.streaks.map(s => s.ready); o.pts = g.streakPts;
        o.used = g.callins.use(0); window.step(1.2, () => { g.spawnProtect = 5; });
        const en = g.bots.filter(bot => bot.alive && bot.team === 1);
        o.enemies = en.length; o.marked = en.filter(bot => bot.markT > 0 && bot.spottedT > 0).length; o.markers = en.filter(bot => bot.marker && bot.marker.visible).length;
        o.active = g.streaks[0].active; o.left = +g.streaks[0].t.toFixed(1); o.stat = g.stats.callins; o.again = g.callins.use(0);
        return o;
      });
      check('uav: ready at 600 points, the others are not', u.ready[0] === true && !u.ready[1] && !u.ready[2] && !u.before[0], u.ready);
      check('uav: every living enemy is marked (minimap + 3D marker)', u.used && u.enemies > 0 && u.marked === u.enemies && u.markers === u.enemies, { enemies: u.enemies, marked: u.marked, markers: u.markers });
      check('uav: active for 20 s, counted in the statistics, cannot be reused at once', u.active && u.left > 17 && u.stat === 1 && u.again === false, { left: u.left, stat: u.stat });
      await shot('uav');
      const u2 = await pg.evaluate(() => { const g = window.__game; window.step(20, () => { g.spawnProtect = 5; }); return { active: g.streaks[0].active }; });
      check('uav: ends after its 20 s', u2.active === false, u2);

      // artillery: direct strike credited to the player
      const a = await pg.evaluate(() => {
        const g = window.__game, p = g.player, o = {};
        const c = window.openSpot(48, 30); o.c = [c.x, c.y, c.z];
        const before = window.solidIn(c, 11), k0 = g.pent.kills, v0 = g.stats.voxels, sc0 = g.pent.score;
        const vict = g.bots.filter(bot => bot.team === 1 && bot.alive).slice(0, 4), d0 = vict.map(bot => bot.deaths);
        const S = g.callins.strike(c, g.pent, 0.5); let shells = 0, t = 0;
        window.step(9, () => {
          t += 1 / 30; p.pos.set(4, 30, 4); p.vel.set(0, 0, 0); g.spawnProtect = 5; shells = Math.max(shells, S.k);
          vict.forEach((bot, i) => { if (bot.alive && bot.deaths === d0[i]) { bot.pos.set(c.x + (i - 1.5) * 1.1, c.y, c.z + (i % 2) * 0.9); if (t < 0.5) bot.hp = 100; } });
        });
        o.removed = before - window.solidIn(c, 11); o.shells = shells; o.kills = g.pent.kills - k0; o.voxStat = g.stats.voxels - v0; o.score = g.pent.score - sc0; o.left = g.callins.strikes.length;
        o.victDead = vict.filter((bot, i) => bot.deaths > d0[i]).length;
        return o;
      });
      check('artillery: eight shells remove voxels', a.shells === 8 && a.removed > 150, { shells: a.shells, removed: a.removed });
      check('artillery: kills and destroyed voxels are credited to the player', a.kills >= 1 && a.voxStat > 100 && a.score > 0, { kills: a.kills, of: a.victDead, voxStat: a.voxStat, score: a.score });
      check('artillery: the strike cleans up after itself', a.left === 0, a.left);

      // artillery through the key path, with a picture of the shells coming down
      const a2 = await pg.evaluate(() => {
        const g = window.__game, p = g.player, o = {};
        const c = window.openSpot(48, 30); const far = window.openSpot(48, 62) || c;
        p.pos.set(far.x, far.y + 0.05, far.z); p.vel.set(0, 0, 0); p.yaw = Math.atan2(-(c.x - far.x), -(c.z - far.z)); p.pitch = -0.06; g.spawnProtect = 30;
        window.step(0.3, () => { g.spawnProtect = 30; });
        const A = g.streaks[1]; A.pts = 0; A.ready = false;      // the kills above paid for one already: start from an empty meter
        o.notReady = g.callins.use(1); g.callins.earn(1400); o.ready = g.streaks[1].ready; o.used = g.callins.use(1); o.n = g.callins.strikes.length;
        if (o.n) { const S = g.callins.strikes[0]; o.dist = +Math.hypot(S.c.x - p.pos.x, S.c.z - p.pos.z).toFixed(1); o.delay = +S.t.toFixed(2); }
        o.readyAfter = g.streaks[1].ready; o.pts = g.streaks[1].pts;
        window.step(4.3, () => { g.spawnProtect = 30; });
        return o;
      });
      check('artillery: [5] refuses before 1400 points and calls a strike on the aimed point after', a2.notReady === false && a2.ready && a2.used && a2.n === 1 && a2.dist > 3 && a2.dist <= 150 && Math.abs(a2.delay - 2.5) < 0.01 && !a2.readyAfter && a2.pts === 0, a2);
      await shot('artillery');

      // enemy artillery on the player: warned, lethal if ignored, death report filled
      const e = await pg.evaluate(() => {
        const g = window.__game, p = g.player, o = {};
        window.step(6, () => { g.spawnProtect = 5; });
        const c = window.openSpot(30, 48); p.pos.set(c.x, c.y + 0.05, c.z); p.vel.set(0, 0, 0); p.hp = 100;
        for (const bot of g.bots) if (bot.team === 1 && bot.alive) bot.hurt(999, g.time, g.pent, {});      // nobody else may take the kill
        g.callins.strike(c, g.callins.battery, 3); o.danger = !!g.callins.dangerAt(p.pos, 0); o.dangerEnemy = !!g.callins.dangerAt(p.pos, 1);
        let t = 0, diedAt = -1; g.spawnProtect = 0;
        window.step(9, () => { t += 1 / 30; if (p.alive) { p.pos.set(c.x, c.y + 0.05, c.z); p.vel.set(0, 0, 0); g.spawnProtect = 0; } else if (diedAt < 0) diedAt = t; return diedAt >= 0; });
        o.diedAt = +diedAt.toFixed(1); o.last = g.lastDeath; o.state = g.state;
        return o;
      });
      check('enemy artillery: the target area is flagged as dangerous for the player\'s team only', e.danger && !e.dangerEnemy, e);
      check('enemy artillery: no shell before the fuse runs out, lethal after', e.diedAt >= 3, e.diedAt);
      check('death report names the killer and the weapon', !!e.last && e.last.killerName === 'ARTILHARIA ÔMEGA' && !!e.last.weaponName, e.last);

      // supply pod through a roof
      const d = await pg.evaluate(() => {
        const g = window.__game, p = g.player, w = g.world, o = {};
        if (!p.alive) { window.step(8, () => g.state === 'deploy'); g.deploy(); }
        window.step(0.5, () => { g.spawnProtect = 5; });
        const R = window.roofedSpot(); o.roofed = !!R; const T = R ? new window.V3(R.x, R.fl, R.z) : window.openSpot(60, 48);
        if (R) o.room = +(R.top - R.fl).toFixed(1);
        const P = g.callins.dropPod(T); let t = 0;
        window.step(5, () => { t += 1 / 30; p.pos.set(4, 30, 4); p.vel.set(0, 0, 0); g.spawnProtect = 5; return P.landed; });
        o.landed = P.landed; o.fallT = +t.toFixed(2); o.gy = P.gy; o.target = T.y; o.through = R ? w.get(Math.round(R.x * 2) - 1, R.roofVy, Math.round(R.z * 2) - 1) === 0 && w.get(Math.round(R.x * 2), R.roofVy, Math.round(R.z * 2)) === 0 : null;
        // resupply
        g.weapons.primary.reserve = 0; g.nades = 0; const hp0 = 35; p.hp = hp0;
        window.step(3, () => { p.pos.set(P.x + 1.2, P.gy + 0.05, P.z); p.vel.set(0, 0, 0); g.spawnProtect = 5; });
        o.hp = Math.round(p.hp); o.reserve = g.weapons.primary.reserve; o.nades = g.nades; o.life = +P.t.toFixed(0);
        p.pos.set(P.x + 4.5, P.gy + 0.05, P.z + 3); p.vel.set(0, 0, 0); p.yaw = Math.atan2(4.5, 3); p.pitch = -0.05; window.step(0.2, () => { g.spawnProtect = 5; });
        return o;
      });
      check('supply pod: lands on the aimed floor' + (d.roofed ? ', through the roof' : ' (no roofed spot found: open ground)'), d.landed && Math.abs(d.gy - d.target) < 0.6 && (d.through === null || d.through === true), d);
      check('supply pod: heals and resupplies for 40 s', d.hp > 80 && d.reserve > 0 && d.nades > 0 && d.life >= 35 && d.life <= 40, { hp: d.hp, reserve: d.reserve, nades: d.nades, life: d.life });
      await shot('pod');
    },

    movement: async () => {
      await fresh('conquest');
      const r = await pg.evaluate(() => {
        const g = window.__game, p = g.player, w = g.world, o = {};
        window.step(0.5);
        const M = w.get(Math.floor(p.pos.x * 2), Math.max(0, Math.floor(p.pos.y * 2) - 1), Math.floor(p.pos.z * 2)) || 1;
        // a test pad in the sky (slab top at 19.0 m) with three blocks: 1.5 m, 2.0 m and 2.5 m high
        w.fill(14, 36, 14, 50, 47, 50, 0); w.fill(14, 36, 14, 50, 37, 50, M);
        w.fill(28, 38, 26, 33, 40, 29, M);          // 1.5 m   x 14..17 m, z 13..15 m
        w.fill(38, 38, 26, 43, 41, 29, M);          // 2.0 m   x 19..22 m
        w.fill(18, 38, 26, 23, 42, 29, M);          // 2.5 m   x  9..12 m
        const put = (x) => { p.pos.set(x, 19.01, 17.5); p.vel.set(0, 0, 0); p.yaw = 0; p.pitch = 0; p.vault = null; p.onGround = true; g.spawnProtect = 99; };
        const run = (secs, pilot) => { let vt = 0; g.botPilot = pilot; window.step(secs, () => { g.spawnProtect = 99; if (p.vault) vt++; }); g.botPilot = null; return +(vt / 30).toFixed(2); };
        // vault: walk into the block and press jump once blocked
        put(15.5); const v0 = p.vaults;
        o.dur15 = run(2.2, () => (p.vaults > v0 && !p.vault ? {} : { f: true, jump: p.onGround && !!p.findLedge(1.5, p.pos.y + 1.5) }));
        o.y15 = +(p.pos.y - 19).toFixed(2); o.v15 = p.vaults - v0; o.ground15 = p.onGround; o.z15 = +p.pos.z.toFixed(2); o.stat = g.stats.vaults;
        // ledge grab: jump at the edge of the higher block
        put(20.5); const v1 = p.vaults;
        o.dur20 = run(2.5, () => (p.vaults > v1 && !p.vault ? {} : { f: true, jump: p.pos.z < 16.2 }));
        o.y20 = +(p.pos.y - 19).toFixed(2); o.v20 = p.vaults - v1;
        // too high
        put(10.5); const v2 = p.vaults; let top = 0; g.botPilot = () => ({ f: true, jump: p.pos.z < 16.2 }); window.step(2, () => { g.spawnProtect = 99; top = Math.max(top, p.pos.y - 19); }); g.botPilot = null;
        o.y25 = +top.toFixed(2); o.v25 = p.vaults - v2;
        // fall damage
        for (const bot of g.bots) if (bot.team === 1 && bot.alive) bot.hurt(999, g.time, g.pent, {});
        const drop = (h) => { p.pos.set(12, 19.01 + h, 21); p.vel.set(0, 0, 0); p.hp = 100; p.onGround = false; let landed = false; window.step(3, () => { g.spawnProtect = 0; if (p.onGround && p.pos.y < 19.2) landed = true; return landed; }); return Math.round(100 - p.hp); };
        o.fall3 = drop(3); o.fall7 = drop(7); o.fall11 = drop(11); o.alive = p.alive;
        return o;
      });
      check('vault: the player ends on top of a 1.5 m obstacle in 0.3 to 0.45 s', r.v15 === 1 && Math.abs(r.y15 - 1.5) < 0.05 && r.ground15 && r.dur15 >= 0.28 && r.dur15 <= 0.47 && r.stat === 1, { y: r.y15, dur: r.dur15, z: r.z15 });
      check('ledge grab: a jump reaches the edge one voxel higher (2.0 m)', r.v20 === 1 && Math.abs(r.y20 - 2.0) < 0.05, { y: r.y20, dur: r.dur20 });
      check('a 2.5 m wall cannot be climbed', r.v25 === 0 && r.y25 < 1.4, { top: r.y25 });
      check('fall damage is mild: none from 3 m, some from 7 m, more from 11 m, never lethal here', r.fall3 === 0 && r.fall7 >= 5 && r.fall7 <= 40 && r.fall11 > r.fall7 && r.fall11 <= 70 && r.alive, { 3: r.fall3, 7: r.fall7, 11: r.fall11 });
    },

    weapons: async () => {
      await fresh('conquest');
      const r = await pg.evaluate(() => {
        const g = window.__game, p = g.player, o = {};
        const keep = () => { g.spawnProtect = 99; p.pitch = 1.3; };
        window.step(0.5, keep);
        const arm = (id) => { g.weapons.primary = { id, ...g.ammoFor(id) }; g.setWeapon('primary'); window.step(1.2, keep); };
        const pull = (secs) => { const s0 = g.stats.shots; g.triggerReleased = true; g.mouse.l = true; window.step(secs, keep); g.mouse.l = false; window.step(0.6, keep); return g.stats.shots - s0; };
        arm('arco'); o.m0 = g.fireModeId; o.label0 = g.fireMode; o.auto = pull(1);
        g.cycleFireMode(); o.m1 = g.fireModeId; o.label1 = g.fireMode; o.burst = pull(1); o.burst2 = pull(0.05);
        g.cycleFireMode(); o.m2 = g.fireModeId;
        arm('k7'); g.cycleFireMode(); o.m3 = g.fireModeId; o.semi = pull(1);
        arm('orion'); o.m4 = g.fireModeId; g.cycleFireMode(); o.m5 = g.fireModeId;
        // bipod: crouched and still with a machine gun
        arm('trovao'); g.botPilot = () => ({ crouch: true }); window.step(1.2, keep); o.bipod = g.bipod; o.bipodLabel = g.fireMode;
        g.botPilot = () => ({ f: true }); window.step(0.6, keep); o.bipodMoving = g.bipod; g.botPilot = null;
        // regeneration after a quiet spell
        o.cls = g.cls; g.spawnProtect = 0; g.playerHurt(60, null); o.hp0 = Math.round(p.hp);
        window.step(2.5, keep); o.hp2 = Math.round(p.hp); window.step(9, keep); o.hp11 = Math.round(p.hp);
        return o;
      });
      check('fire mode: automatic by default, held trigger keeps firing', r.m0 === 'auto' && r.auto >= 6, { mode: r.label0, shots: r.auto });
      check('fire mode: [X] switches to burst, three rounds per pull', r.m1 === 'burst' && r.burst === 3 && r.burst2 === 3 && r.m2 === 'auto', { mode: r.label1, held: r.burst, tapped: r.burst2 });
      check('fire mode: semi fires one round per pull', r.m3 === 'semi' && r.semi === 1, { shots: r.semi });
      check('fire mode: single-mode weapons stay as they are', r.m4 === 'bolt' && r.m5 === 'bolt', r.m4);
      check('bipod: deploys crouched and still, folds when moving', r.bipod === true && /BIPÉ/.test(r.bipodLabel) && r.bipodMoving === false, r.bipodLabel);
      check('regeneration: nothing right after a hit, health comes back after the quiet spell', r.hp0 === 40 && r.hp2 === 40 && r.hp11 > 70, { cls: r.cls, hp: [r.hp0, r.hp2, r.hp11] });
    },

    countdown: async () => {
      await fresh('koth', true);
      const r = await pg.evaluate(() => {
        const g = window.__game, p = g.player, o = { cd: g.countdown, frozen: p.frozen };
        const p0 = p.pos.clone(); g.botPilot = () => ({ f: true }); window.step(2.5);
        o.moved = +Math.hypot(p.pos.x - p0.x, p.pos.z - p0.z).toFixed(2); o.mt = g.matchTime; o.left = +g.countdown.toFixed(1); o.protect = g.spawnProtect > 0;
        o.shown = !document.getElementById('cd').classList.contains('hidden'); o.text = document.getElementById('cdn').textContent;
        o.botsAlive = g.bots.filter(bot => bot.alive).length; o.botsMoving = g.bots.filter(bot => bot.alive && Math.hypot(bot.vx || 0, bot.vz || 0) > 0.1).length; o.fire = g.callins.use(0);
        return o;
      });
      check('countdown: 5 s, player and bots held in place, clock stopped, protected', r.cd > 4.5 && r.cd <= 5 && r.frozen && r.moved < 0.05 && r.mt === 0 && r.protect && r.botsAlive >= 12 && r.botsMoving === 0, r);
      check('countdown: shown on the HUD', r.shown && /^[1-5]$/.test(r.text), { text: r.text });
      await shot('countdown');
      const r2 = await pg.evaluate(() => {
        const g = window.__game, p = g.player, p0 = p.pos.clone(); window.step(Math.max(0, g.countdown) + 1.5);
        return { cd: g.countdown, frozen: p.frozen, moved: +Math.hypot(p.pos.x - p0.x, p.pos.z - p0.z).toFixed(2), mt: +g.matchTime.toFixed(1), shown: !document.getElementById('cd').classList.contains('hidden') };
      });
      check('countdown: the match starts when it ends', r2.cd === 0 && !r2.frozen && r2.moved > 2 && r2.mt > 1 && !r2.shown, r2);
      await pg.evaluate(() => { window.__game.botPilot = null; });
    },

    missions: async () => {
      await fresh('conquest');
      const r = await pg.evaluate(() => {
        const g = window.__game, o = {}; window.step(3, () => { g.spawnProtect = 5; });
        o.missions = g.missions.map(m => `${m.id}:${m.prog}/${m.goal}:${m.xp}xp`); const m = g.missions[0];
        const xp0 = +(localStorage.getItem('colapso.xp') || 0); g.rules.mission(m.ev, m.goal); o.done = m.done; o.xpGain = +(localStorage.getItem('colapso.xp') || 0) - xp0; o.xp = m.xp;
        const e = g.bots.find(bot => bot.alive && bot.team === 1), id = g.W.id, mk0 = g.mastery[id] || 0; g.hitD = g.WD; e.hurt(999, g.time, g.pent, {}); g.onKill(g.pent, e, true, 42);
        o.stats = { kills: g.stats.kills, head: g.stats.headshots, longest: Math.round(g.stats.longestShot), fav: g.stats.favWeapon, streak: g.stats.bestStreak };
        o.mastery = (g.mastery[id] || 0) - mk0; o.masterySaved = !!localStorage.getItem('colapso.mastery.v1'); o.saved = !!localStorage.getItem('colapso.missions.v1');
        o.summary = g.rules.summary().map(t => t.join('=')); const doneId = m.id;
        g.pause && 0; g.endMatch(true); o.endTiles = document.querySelectorAll('#endtiles .tile').length; o.endMis = document.getElementById('endmis').textContent.length > 20;
        g.startMatch(); o.rotated = g.missions.length === 3 && !g.missions.some(x => x.done) && !g.missions.some(x => x.id === doneId); o.fresh = g.stats.kills === 0;
        g.deploy(); return o;
      });
      check('missions: three active, completing one grants its XP and is saved', r.missions.length === 3 && r.done && r.xpGain === r.xp && r.xp > 0 && r.saved, { missions: r.missions, xp: r.xpGain });
      check('missions: a finished mission is replaced in the next match', r.rotated, r.rotated);
      check('stats: kill, headshot, longest shot, favourite weapon and mastery are recorded', r.stats.kills === 1 && r.stats.head === 1 && r.stats.longest === 42 && !!r.stats.fav && r.stats.streak === 1 && r.mastery === 1 && r.masterySaved, r.stats);
      check('stats: eight end-screen tiles from the summary, reset on a new match', r.summary.length === 8 && r.endTiles >= 8 && r.endMis && r.fresh, r.summary);
      // pause menu shows the missions
      const pm = await pg.evaluate(() => { const g = window.__game; g.show('pause'); const n = document.getElementById('pmis').children.length; g.show(null); return n; });
      check('pause menu lists the three missions', pm === 3, pm);
    },

    elite: async () => {
      await fresh('conquest');
      const r = await pg.evaluate(() => {
        const g = window.__game, w = g.world, o = {}; window.step(3, () => { g.spawnProtect = 5; });
        const e = g.bots.find(bot => bot.elite && bot.alive); o.elites = g.bots.filter(bot => bot.elite).map(bot => bot.team + ':' + bot.cls);
        // a thin wall on a test pad in the sky: the elite on one side, its last contact on the other
        w.fill(14, 36, 14, 50, 47, 50, 0); w.fill(14, 36, 14, 50, 37, 50, 1); w.fill(20, 38, 30, 44, 43, 30, 1); g.nav.rebuildVox(14, 14, 50, 50);
        const place = () => { e.pos.set(16, 19, 17.5); e.path = null; e.lastSeen = new window.V3(16, 19, 11); e.lastSeenT = g.time; e.dashCd = 0; e.target = null; e.seeT = 0; e.hp = 100; };
        place(); o.veteran = g.squads.tryDash(e, g.time);                    // default difficulty: never
        const keep = g.settings.diff; g.settings.diff = 2; place(); o.ok = g.squads.tryDash(e, g.time); o.tele = !!e.dash;
        window.step(0.7, () => { g.spawnProtect = 5; e.hp = 100; }); o.zTele = +e.pos.z.toFixed(2);
        window.step(0.7, () => { g.spawnProtect = 5; e.hp = 100; }); o.zAfter = +e.pos.z.toFixed(2); o.done = !e.dash; o.dashes = g.squads.tally.dashes;
        g.settings.diff = keep; return o;
      });
      check('elite: two Omega elites, no dash below the highest difficulty', r.elites.length === 2 && r.elites.every(s => s.startsWith('1:')) && r.veteran === false, r.elites);
      check('elite: telegraphs for 0.8 s, then phases through a thin wall', r.ok && r.tele && Math.abs(r.zTele - 17.5) < 0.05 && r.zAfter < 15 && r.done && r.dashes === 1, r);
    },
  };

  for (const [name, fn] of Object.entries(groups)) {
    if (only && !only.split(',').some(k => name.includes(k))) continue;
    console.log('# ' + name);
    try { await fn(); } catch (e) { fails++; console.log('FAIL ' + name + ' threw: ' + e.message.split('\n').slice(0, 3).join(' | ')); }
  }
  console.log(`RESULT ${passes} passed, ${fails} failed`);
  console.log('ERRORS', errs.length); console.log(errs.slice(0, 10).join('\n'));
  await b.close(); process.exitCode = fails || errs.length ? 1 : 0;
})();
