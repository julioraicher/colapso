// Model viewer: renders kit / gun / soldier models headless into one turntable contact sheet.
//   node test/modelview.cjs <out.png> <spec>... [--size=WxH] [--angles=n] [--lights=auto|world|vm] [--elev=deg] [--yaw=deg]
// Specs:  kit:demo[:<child>] | kit:tiles | kit:bench | kit:skin | kit:prims
//             showcase (or one child), tile swatch board, 200-primitive timing, SkinnedMesh self-test, one of each primitive
//         gun:<weaponId>[:tp]                       buildGun(WEAPONS[id].type, { id, sight[, lod: 'tp'] })
//         soldier:<team>:<cls>[:<seed>]             buildSoldier({ team, cls, seed }) from src/soldier.js
// Any spec may end in @world or @vm to force a light rig for that row (gun:k7@world).
// One row per spec, one column per angle. --size is the size of ONE cell (default 400x300), --angles
// defaults to 4. Lights: 'world' = the game's world-scene rig, 'vm' = the first-person weapon rig;
// 'auto' (default) uses vm for first-person guns and world for everything else.
// Sources are taken from ./src of the current directory, so it runs from any worktree.
const fs = require('fs'), os = require('os'), path = require('path');
const cwd = process.cwd();
const req = n => require(require.resolve(n, { paths: [cwd, __dirname] }));

(async () => {
  const args = process.argv.slice(2), flags = {}, pos = [];
  for (const a of args) { const m = /^--(\w+)=(.*)$/.exec(a); if (m) flags[m[1]] = m[2]; else pos.push(a); }
  const out = pos.shift(), specs = pos;
  if (!out || !specs.length) { console.error('usage: node test/modelview.cjs <out.png> <spec>... [--size=WxH] [--angles=n] [--lights=auto|world|vm] [--elev=deg] [--yaw=deg]'); process.exit(2); }
  const [cw, ch] = (flags.size || '400x300').split('x').map(Number);
  const cfg = { specs, cw, ch, angles: +(flags.angles || 4), lights: flags.lights || 'auto', elev: +(flags.elev ?? 14), yaw: +(flags.yaw ?? 35) };

  const src = f => path.join(cwd, 'src', f), has = f => fs.existsSync(src(f)), J = JSON.stringify;
  for (const s of specs) if (s.startsWith('soldier') && !has('soldier.js')) console.log(`note: ${src('soldier.js')} does not exist yet, "${s}" will be an empty row`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modelview-'));
  const entry = path.join(tmp, 'entry.js');
  fs.writeFileSync(entry, [
    `import * as KIT from ${J(src('kit.js'))};`,
    has('weapons.js') ? `import * as W from ${J(src('weapons.js'))};` : 'const W = null;',
    has('soldier.js') ? `import * as S from ${J(src('soldier.js'))};` : 'const S = null;',
    `import { run } from ${J(path.join(__dirname, 'modelview.entry.js'))};`,
    `try { window.__mv = run({ KIT, W, S }, ${J(cfg)}); } catch (e) { window.__mv = [{ spec: '*', error: e.message + '\\n' + e.stack }]; }`,
  ].join('\n'));
  const t0 = Date.now();
  await req('esbuild').build({ entryPoints: [entry], bundle: true, format: 'iife', target: 'es2020', outfile: path.join(tmp, 'mv.js'), logLevel: 'warning', absWorkingDir: cwd });
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0c1016;overflow:hidden"><script src="mv.js"></script>');

  const { chromium } = req('playwright');
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pg = await b.newPage({ viewport: { width: cw * cfg.angles, height: ch * specs.length } });
  const errs = [];
  pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  pg.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await pg.goto('file://' + path.join(tmp, 'index.html'));
  await pg.waitForFunction(() => window.__mv, null, { timeout: 120000 });
  await pg.waitForTimeout(150);
  const rows = await pg.evaluate(() => window.__mv);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await pg.screenshot({ path: out });
  await b.close();
  for (const r of rows) console.log(r.error ? `${r.spec}: ERROR ${r.error}` : `${r.spec}: ${r.tris} tris, ${r.calls} draw calls, build ${r.buildMs} ms, size ${r.size.join(' x ')} m, lights ${r.rig}${r.note ? ', ' + r.note : ''}`);
  console.log(`bundle+render ${Date.now() - t0} ms -> ${out}` + (errs.length ? `\nCONSOLE (${errs.length}):\n` + errs.slice(0, 12).join('\n') : '\nconsole: clean'));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(rows.some(r => r.error) || errs.some(e => e.startsWith('PAGEERROR')) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
