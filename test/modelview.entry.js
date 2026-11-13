// Browser side of test/modelview.cjs: builds each spec, renders a turntable contact sheet.
// mods = { KIT, W (weapons.js), S (soldier.js or null) }, cfg = { specs, cw, ch, angles, lights, elev }
import * as THREE from 'three';

const RIGS = {
  world: s => { s.add(new THREE.HemisphereLight(0x6f8fc0, 0x1a1a22, 1.1)); const d = new THREE.DirectionalLight(0x9fb8ff, 0.9); d.position.set(-0.5, 1, 0.35); s.add(d); },
  vm: s => { s.add(new THREE.HemisphereLight(0x9fc4ff, 0x30303a, 2.2)); const d = new THREE.DirectionalLight(0xbcd0ff, 1.2); d.position.set(0.5, 1, 0.3); s.add(d); },
};
const pick = (m, name) => m && (m[name] || (m.default && m.default[name]));

function build(spec, { KIT, W, S }) {
  const at = spec.split('@'), p = at[0].split(':'), out = { rig: 'world', obj: null, tick: null, note: '' };
  const done = () => { if (at[1]) out.rig = at[1]; return out; };
  if (p[0] === 'kit') {
    const fn = { demo: 'kitDemo', tiles: 'kitTiles' }[p[1]] || p[1];
    if (p[1] === 'bench') {   // 200 primitives, averaged
      const { Kit, TILE } = KIT; let k, t0;
      for (let r = -10; r < 20; r++) { if (r === 0) t0 = performance.now(); k = new Kit(96); for (let i = 0; i < 200; i++) { const a = i * .7; if (i % 4 === 3) k.cyl('z', .01, .05, Math.cos(a) * .3, (i % 20) * .03, Math.sin(a) * .3, { tile: TILE.metal, tint: 0x8090a0 }); else k.box(.03, .02, .06, Math.cos(a) * .3, (i % 20) * .03, Math.sin(a) * .3, { tile: 1 + i % 20, tint: 0x607080 + i * 513 }, [0, a, 0]); } k.geometry(); }
      out.note = `200 prims incl. geometry(): ${((performance.now() - t0) / 20).toFixed(2)} ms avg`; out.obj = k.mesh(); return done();
    }
    if (p[1] === 'skin') {   // SkinnedMesh self-test: three bones, the arm and the head posed away from the bind pose
      const { Kit, TILE, PAL } = KIT, k = new Kit(40);
      k.bone(0).box(.36, .5, .2, 0, 1.2, 0, { tile: TILE.camo, tint: PAL.olive }).box(.38, .1, .22, 0, 1.0, 0, { tile: TILE.molle, tint: PAL.tan });
      k.bone(1).ball([.1, .12, .1], 0, 1.6, 0, { tile: TILE.skin, tint: PAL.skin[1], glow: .12 }).ball(.125, 0, 1.63, 0, { tile: TILE.splinter, tint: PAL.grey }, { bot: .55 });
      k.bone(2).box(.1, .1, .5, .25, 1.38, .22, { tile: TILE.ripstop, tint: PAL.navy }).decal(TILE.omega, .09, .09, .3, 1.38, .1, '+x', PAL.omega);
      const hips = new THREE.Bone(), head = new THREE.Bone(), arm = new THREE.Bone();
      hips.position.y = 1; head.position.y = .5; arm.position.set(.25, .38, 0); hips.add(head, arm);
      const m = k.skinned([hips, head, arm], KIT.kitMaterial({ unique: true, color: 0xfff0d8 })); arm.rotation.x = -1.1; head.rotation.y = .6;   // unique clone: same program, own tint
      out.obj = m; out.note = 'arm raised and head turned by bones, unique tinted material'; return done();
    }
    if (p[1] === 'prims') {   // one of each primitive: winding / normal / uv check
      const { Kit, TILE, PAL } = KIT, k = new Kit(96), st = { tile: TILE.panel, tint: PAL.steel }, tn = { tile: TILE.ribs, tint: PAL.tan };
      k.push(-.225, 0, 0);
      k.box(.1, .1, .1, 0, 0, 0, st).taper(.1, .1, .1, .15, 0, 0, '+y', [.4, .7], tn).wedge(.1, .1, .1, .3, 0, 0, st).taper(.1, .1, .1, .45, 0, 0, '-z', .3, tn, 0, [0, .03]);
      k.cyl('z', .05, .1, 0, .15, 0, tn, 8).cyl('y', .05, .1, .15, .15, 0, st, 6).cyl('x', .05, .1, .3, .15, 0, tn, { n: 10, r2: 0 }).tube('z', .05, .035, .1, .45, .15, 0, st, 8);
      k.ball(.05, 0, .3, 0, { tile: TILE.camo, tint: PAL.olive }).ball([.05, .05, .06], .15, .3, 0, { tile: TILE.glass, tint: PAL.lens }, { bot: .5 }).ball(.05, .3, .3, 0, tn, { top: .25, bot: .75, n: 6, m: 3 });
      k.box(.1, .1, .1, .45, .3, 0, { tile: TILE.flat, tint: PAL.polymer });
      for (const f of ['+x', '-x', '+y', '-y', '+z', '-z']) { const s = f[0] === '-' ? -1 : 1, a = 'xyz'.indexOf(f[1]), q = [.45, .3, 0]; q[a] += s * .05; k.text(f.replace('+', 'P').replace('-', 'N'), .03, q[0], q[1], q[2], f, PAL.hazard); }
      k.pop();
      k.mirror(sg => k.group(.34, .15, 0, [0, 0, .3], () => k.box(.04, .3, .04, 0, 0, 0, sg > 0 ? st : tn).decal(TILE.arrow, .04, .04, .02, .1, 0, '+x', PAL.red)));
      out.obj = k.mesh(); return done();
    }
    if (typeof KIT[fn] !== 'function') throw new Error(`src/kit.js has no export ${fn}`);
    out.obj = KIT[fn](); if (p[2] != null) out.obj = out.obj.children[+p[2]] || out.obj; return done();
  }
  if (p[0] === 'gun') {
    const WEAPONS = pick(W, 'WEAPONS'), buildGun = pick(W, 'buildGun');
    if (!WEAPONS || !buildGun) throw new Error('src/weapons.js exports no WEAPONS / buildGun');
    const w = WEAPONS[p[1]]; if (!w) throw new Error(`unknown weapon "${p[1]}" (have: ${Object.keys(WEAPONS).join(' ')})`);
    const opts = { id: p[1], sight: w.sight }; if (p[2] === 'tp') opts.lod = 'tp'; else out.rig = 'vm';
    out.obj = buildGun(w.type, opts); return done();
  }
  if (p[0] === 'soldier') {
    const buildSoldier = pick(S, 'buildSoldier');
    if (!S) throw new Error('src/soldier.js does not exist yet');
    if (!buildSoldier) throw new Error('src/soldier.js exports no buildSoldier');
    const opts = { team: +p[1] || 0, cls: p[2] || 'assault' }; if (p[3] != null) opts.seed = +p[3];
    const r = buildSoldier(opts);
    out.obj = r && r.isObject3D ? r : r && (r.root || r.group || r.model);
    if (!out.obj) throw new Error('buildSoldier returned nothing renderable (expected Object3D or { root })');
    const host = typeof r.update === 'function' ? r : typeof out.obj.userData.update === 'function' ? out.obj.userData : null;
    if (host) out.tick = () => host.update(1 / 30);
    return done();
  }
  throw new Error(`unknown spec "${spec}" (kit:demo[:<child>] | kit:tiles | kit:bench | kit:skin | kit:prims | gun:<id>[:tp] | soldier:<team>:<cls>[:<seed>], optional @world / @vm suffix)`);
}

export function run(mods, cfg) {
  const { specs, cw, ch, angles } = cfg, W = cw * angles, H = ch * specs.length;
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H); renderer.autoClear = false; renderer.info.autoReset = false;
  document.body.appendChild(renderer.domElement);
  const label = (row, text, err) => { const d = document.createElement('div'); d.textContent = text; d.style.cssText = `position:absolute;left:6px;top:${row * ch + 4}px;font:12px monospace;color:${err ? '#ff7a6a' : '#9fb4c8'};white-space:pre`; document.body.appendChild(d); };
  const rows = [];
  specs.forEach((spec, row) => {
    const info = { spec };
    try {
      const t0 = performance.now(), b = build(spec, mods); info.buildMs = +(performance.now() - t0).toFixed(2);
      if (b.tick) for (let i = 0; i < 20; i++) { try { b.tick(); } catch (e) { info.note = 'update() threw: ' + e.message; break; } }
      const rig = cfg.lights === 'auto' ? b.rig : cfg.lights;
      const scene = new THREE.Scene(); RIGS[rig](scene);
      const holder = new THREE.Group(), pivot = new THREE.Group(); holder.add(b.obj); pivot.add(holder); scene.add(pivot);
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(holder, true), sph = box.getBoundingSphere(new THREE.Sphere());
      holder.position.copy(sph.center).negate();
      const fov = 26, cam = new THREE.PerspectiveCamera(fov, cw / ch, 0.01, 100), el = cfg.elev * Math.PI / 180;
      const fit = Math.min(1, cw / ch), dist = sph.radius / Math.sin(fov * Math.PI / 360 * fit) * 1.02;
      cam.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist); cam.lookAt(0, 0, 0);
      renderer.setScissorTest(true);
      for (let a = 0; a < angles; a++) {
        pivot.rotation.y = cfg.yaw * Math.PI / 180 + a * Math.PI * 2 / angles;
        const x = a * cw, y = H - (row + 1) * ch;
        renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch);
        renderer.setClearColor(row % 2 ? 0x0f141c : 0x0c1016, 1); renderer.clear();
        renderer.info.reset(); renderer.render(scene, cam);
        if (a === 0) { info.calls = renderer.info.render.calls; info.tris = renderer.info.render.triangles; }
      }
      info.size = box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)); info.rig = rig; if (b.note) info.note = b.note;
      label(row, `${spec}   ${info.tris} tris   ${info.calls} draw calls   build ${info.buildMs} ms   lights: ${rig}${info.note ? '   ' + info.note : ''}`);
    } catch (e) { info.error = e.message; label(row, `${spec}   ${e.message}`, true); }
    rows.push(info);
  });
  return rows;
}
