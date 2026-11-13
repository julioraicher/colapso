// =================================================================================================
// kit.js — shared pixel-art modelling kit (weapons, soldiers, props). One atlas, one material,
// one BufferGeometry per rigid piece. No assets: every texel is procedural.
//
// UNITS / AXES  metres, radians, right-handed, +Y up. Guns point to -Z (muzzle at -Z, stock at +Z).
//               Rotations are Euler XYZ; a bare number means "rotation about X" (pitch).
//
// ATLAS         kitAtlas() -> THREE.DataTexture 256x256, 16x16-px tiles (TILE.name -> tile index),
//               nearest magnification, hand-built mip chain that stops at 1 texel per tile (tiles
//               never bleed), sRGB. Tiles hold luminance detail that MULTIPLIES the primitive tint:
//               neutral texel = the tint itself, texels go up to ~1.37x brighter (highlights, wear).
//   surfaces    flat metal blued polymer grip wood wood2 fabric ripstop camo splinter molle leather
//               skin vent panel | rivet rail knurl glass hazard grille ribs worn screen tread slots
//               carbon
//   decals      (alpha cut-out, use with k.decal) kappa omega cross warn arrow dot ring bars diamond
//   kitText(s)  -> [x, y, w, h] atlas rect of a short string in a 3x5 pixel font (A-Z 0-9 - . / : +)
//   PAL         tuned tints (sRGB hex). The game's lights are strongly blue: neutral or slightly warm greys
//               read as steel, blue-grey tints turn navy and dark tints turn to mud. Start from PAL.
//   exports     Kit, TILE, PAL, kitMaterial, kitAtlas, kitText, kitDemo, kitTiles
//
// KIT           const k = new Kit(ppm, defaultStyle?)   ppm = texels per metre (96 guns, 40 soldiers)
//   style       { tile, tint, glow, edge, bone, turn, ppm } — all optional, missing fields fall back
//               to k.set({...}) defaults. A bare number is a tint: k.box(.1,.1,.1, 0,0,0, 0xff0000).
//                 tint  sRGB hex            glow  0..2 unlit emissive share (1 = fully self-lit;
//                       .1-.2 keeps faces and team marks readable in the dark)
//                 edge  0..1.8 strength of the automatic 1-texel rim (top row lighter, bottom row
//                       darker, on every face); default depends on the tile (metal 1, cloth .35)
//                 turn  1 = rotate the tile 90 degrees on this primitive     bone  bone index
//   primitives  (x, y, z = centre; all return the kit, so calls chain)
//     k.box(w, h, d, x, y, z, style?, rot?)                      w along X, h along Y, d along Z
//     k.taper(w, h, d, x, y, z, axis, scale, style?, rot?, shift?)
//         box whose `axis` face ('+y', '-z', ...) is scaled by `scale` (number or [a, b] for the two
//         other axes in x<y<z order) and moved by shift [a, b] metres. scale 0 collapses it to an edge.
//     k.wedge(w, h, d, x, y, z, style?, rot?)                    ramp: full height at -Z, zero at +Z
//     k.cyl(axis, r, len, x, y, z, style?, o?)                   axis 'x' | 'y' | 'z'
//         o = sides, or { n: 8, r2: r, rot, caps: 3, smooth, oval: 1, phase }. r is the radius at the
//         - end of the axis, r2 at the + end (r2: 0 = cone). caps bit 1 = - end, bit 2 = + end.
//         n <= 6 is flat-shaded (hex barrel), more is smooth. oval squashes the 2nd cross axis.
//     k.tube(axis, r, rInner, len, x, y, z, style?, o?)          hollow cylinder (scope body, ring sight,
//         muzzle, barrel shroud); o = sides or { n, rot, smooth, phase }
//     k.ball(r | [rx, ry, rz], x, y, z, style?, o?)              o = { n: 8, m: 5, top: 0, bot: 1, rot, caps }
//         ellipsoid, poles on Y; top/bot cut it by latitude (bot: .5 = dome), cuts are capped.
//     k.decal(tile | rect, w, h, x, y, z, face, style?, rot?)    flat cut-out quad facing `face`
//         ('+x' '-x' '+y' '-y' '+z' '-z'); x, y, z is a point ON the surface (it is lifted a hair).
//         Up is +Y on side faces and -Z on '+y' (reads correctly from behind the gun). style = ink tint.
//     k.text(str, height, x, y, z, face, style?, rot?)           kitText + decal, width from aspect
//   transforms  k.push(x, y, z, rot?, scale?) ... k.pop()        sub-assembly frame (scale n or [x,y,z])
//               k.group(x, y, z, rot?, fn)                       push, fn(k), pop
//               k.mirror(fn)                                     fn(+1) then fn(-1) mirrored in X
//               k.bone(i)                                        bone index for what follows (-1 = none)
//   outputs     k.geometry() -> BufferGeometry (position, normal, uv, color, kit, [skinIndex, skinWeight])
//               k.mesh(parent?, x, y, z, material?) -> THREE.Mesh, remembers userData.home / homeR
//               k.skinned(bones, material?) -> THREE.SkinnedMesh, rigid one-bone-per-vertex skinning.
//                   Model in bind pose, bones already placed; parentless bones are added to the mesh.
//                   The geometry is reusable: new THREE.Mesh(geo, kitMaterial()) for every copy.
//               k.tris, k.prims, k.reset()
//   UVs         every face gets a WHOLE number of texels (size * ppm, rounded, at least 1) so there are
//               no cut texels. Tile u runs along Z (X on front/back faces), tile v runs down: stripes
//               of 'rail', 'ribs', 'metal' follow the barrel on side and top faces alike.
//
// MATERIAL      kitMaterial() -> the ONE shared MeshLambertMaterial (atlas + vertex tint + per-vertex
//               glow as unlit emissive + rim, fog on, alphaTest for decals; Mesh and SkinnedMesh).
//               kitMaterial({ unique: true, color? }) -> a clone whose .color tints one object
//               (hit flash, World.lightAt probe). Never assign another material to kit geometry.
//
// ANIMATED PARTS are separate small Kits: model the part around its own pivot, then
//               const bolt = kb.mesh(gunGroup, x, y, z)  -> move bolt.position / rotation per frame.
//               A gun is 1 draw call + 1 per moving part.
//
// EXAMPLE
//   import { Kit, TILE, PAL, kitMaterial } from './kit.js';
//   const g = new THREE.Group(), k = new Kit(96);
//   const steel = { tile: TILE.blued, tint: PAL.gunmetal }, poly = { tile: TILE.polymer, tint: PAL.polymer };
//   k.box(.044, .05, .30, 0, .03, 0, steel);                               // receiver
//   k.box(.022, .012, .26, 0, .061, 0, { tile: TILE.rail, tint: PAL.black }); // top rail
//   k.cyl('z', .011, .30, 0, .035, -.30, { tile: TILE.metal, tint: PAL.steel }, 8); // barrel
//   k.box(.034, .09, .045, 0, -.04, .09, { tile: TILE.grip, tint: PAL.black }, -.3); // grip, raked back
//   k.group(0, -.01, -.03, .14, () => k.box(.028, .12, .06, 0, -.06, 0, { tile: TILE.ribs, tint: PAL.tan }));
//   k.mirror(s => k.box(.004, .02, .05, .024, .03, .05, poly));               // both side plates
//   k.box(.003, .012, .03, -.023, .04, .06, { tile: TILE.screen, tint: PAL.kappa, glow: 1 }); // lit counter
//   k.text('K-7', .012, -.0225, .03, -.08, '-x', PAL.white);                  // stencil, left side
//   k.mesh(g);                                                             // 1 draw call
//   const kb = new Kit(96); kb.box(.012, .01, .03, 0, 0, 0, steel);       // bolt handle, own pivot
//   g.userData.bolt = kb.mesh(g, .028, .04, -.02);
//   // skinned: const k = new Kit(40); k.bone(0).box(.36,.5,.2, 0,1.2,0, cloth); k.bone(1).ball(.11, 0,1.6,0, skin);
//   //          const hips = new THREE.Bone(), head = new THREE.Bone(); head.position.y = 1.5; hips.add(head);
//   //          const body = k.skinned([hips, head]);   // then rotate head / hips per frame
// =================================================================================================
import * as THREE from 'three';

const TS = 16, AT = 256, GAIN = 2, TEXT_Y0 = 192;

// ---- atlas ----------------------------------------------------------------------------------
const lin2s = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
// p = perceptual multiplier on the tint (1 = tint, max ~1.37) -> stored sRGB byte (shader multiplies by GAIN)
const enc = p => Math.max(0, Math.min(255, Math.round(255 * lin2s(Math.pow(Math.max(p, 0), 2.2) / GAIN))));
const H = (x, y, s = 0) => { let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 362437)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
// value noise that wraps on the 16-px tile; c = cell size (divides 16)
const vn = (x, y, c, s) => {
  const n = TS / c, gx = Math.floor(x / c), gy = Math.floor(y / c), fx = x / c - gx, fy = y / c - gy;
  const a = H(gx % n, gy % n, s), b = H((gx + 1) % n, gy % n, s), cc = H(gx % n, (gy + 1) % n, s), d = H((gx + 1) % n, (gy + 1) % n, s);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
};
const bmp = rows => (x, y) => rows[y][x] === 'X' ? 1 : null;

/** Tile name -> tile index (column + 16 * row in the atlas). */
export const TILE = {};
const EDGE = new Float32Array(256), DEFS = [];
const T = (i, name, edge, fn) => { TILE[name] = i; EDGE[i] = edge; DEFS[i] = fn; };

T(0, 'flat', .8, () => 1);
const MROW = [0, .05, -.04, 0, .07, -.06, .02, 0, -.03, .06, 0, -.05, .04, 0, .03, -.02];
T(1, 'metal', 1, (x, y) => 1 + MROW[y] + (H(x >> 2, y, 1) > .8 ? -.07 : 0));
T(2, 'blued', 1.2, (x, y) => {
  const n = H(x, y, 2), v = vn(x, y, 4, 3);
  if ((x + 2 * y) % 16 === 5 && x > 3 && x < 11) return 1.24;          // one diagonal scratch
  if (n > .962) return 1.3; if (n < .035) return .8;                   // wear specks, pits
  return v > .62 ? 1.03 : v < .36 ? .92 : .97;
});
T(3, 'polymer', .7, (x, y) => 1 + (H(x, y, 4) > .8 ? .09 : H(x, y, 5) > .82 ? -.1 : 0));
T(4, 'grip', .4, (x, y) => { const a = (x + y) % 4 === 0, b = (x - y + 16) % 4 === 0; return a && b ? .6 : a || b ? .74 : 1.1; });
T(5, 'wood', .7, (x, y) => { const w = Math.sin((y + 1.6 * Math.sin(x * Math.PI / 8)) * Math.PI * 3 / 8 + .5); return w > .6 ? .78 : w > .1 ? .93 : w > -.55 ? 1.02 : 1.12; });
const WROW = [1, .86, 1, 1.07, .9, 1, 1, .82, 1.05, 1, .9, 1, 1.07, .86, 1, .95];
T(6, 'wood2', .7, (x, y) => {
  const r = Math.hypot(x - 5, (y - 8) * 1.5);
  if (r < 1.2) return .6; if (r < 3.6) return (Math.floor(r * 1.4) & 1) ? .84 : 1.06;
  return WROW[(y + (x > 9 ? 1 : 0)) & 15];
});
T(7, 'fabric', .35, (x, y) => (((x >> 1) + (y >> 1)) & 1 ? 1.05 : .93) * ((x & 1) && (y & 1) ? .95 : 1));
T(8, 'ripstop', .35, (x, y) => (x % 4 === 0 || y % 4 === 0) ? 1.1 : 1 - H(x, y, 7) * .05);
T(9, 'camo', .35, (x, y) => { const X = x & ~1, Y = y & ~1, v = vn(X, Y, 4, 11) * .65 + vn(X, Y, 8, 12) * .35 + (H(X, Y, 13) - .5) * .22; return v < .4 ? .62 : v < .6 ? 1 : 1.26; });
T(10, 'splinter', .35, (x, y) => { const a = (x + y) & 15, b = (x - 2 * y + 32) & 15; return a < 5 ? .64 : b < 6 ? 1.24 : 1; });
T(11, 'molle', .2, (x, y) => { const r = y % 8, c = x % 8; if (r < 2) return .6; if (r === 2) return 1.18; if (c === 0) return .68; return r === 7 ? .86 : c === 1 ? 1.1 : 1; });
T(12, 'leather', .5, (x, y) => { const v = vn(x, y, 4, 21); return v > .68 ? 1.1 : v < .32 ? .86 : (H(x, y, 22) > .92 ? .8 : 1); });
T(13, 'skin', .25, (x, y) => H(x >> 1, y >> 1, 31) > .86 ? .965 : 1);
T(14, 'vent', .6, (x, y) => { const r = y % 4, c = x % 8; if (c >= 1 && c <= 6) { if (r === 1) return .3; if (r === 2) return c === 1 || c === 6 ? .34 : .42; if (r === 3) return 1.2; } return 1; });
T(15, 'panel', .8, (x, y) => (x === 0 || y === 0) ? .55 : (x === 1 || y === 1) ? 1.15 : (x === 15 || y === 15) ? .9 : H(x, y, 41) > .93 ? .94 : 1);
T(16, 'rivet', .9, (x, y) => { const c = x % 8, r = y % 8; if (c === 3 && r === 3) return 1.35; if ((c === 4 && r === 3) || (c === 3 && r === 4)) return 1.1; if (c === 4 && r === 4) return .55; return H(x, y, 42) > .9 ? .95 : 1; });
T(17, 'rail', .5, (x, y) => [1.2, 1, .38, .5][x % 4]);
T(18, 'knurl', .5, (x, y) => ((x + y) & 1) ? 1.16 : .74);
T(19, 'glass', .6, (x, y) => { let p = .72 + (15 - y) * .028; if ((x + y === 7 || x + y === 8) && x >= 2 && x <= 6) p = 1.37; else if (x + y === 13 && x > 4 && x < 10) p = 1.16; return p; });
T(20, 'hazard', .7, (x, y) => ((x + y) % 8) < 4 ? 1.05 : .16);
T(21, 'grille', .6, (x, y) => { const c = x % 4, r = y % 4; return c < 2 && r < 2 ? (c === 0 && r === 0 ? .26 : .4) : (r === 2 && c < 2 ? 1.16 : 1); });
T(22, 'ribs', .6, (x, y) => [.6, 1.18, 1, 1][y % 4]);
T(23, 'worn', .9, (x, y) => { const v = vn(x, y, 4, 53), e = Math.max(vn((x + 1) & 15, y, 4, 53), vn(x, (y + 1) & 15, 4, 53)); return v > .74 ? 1.3 : e > .74 ? .72 : H(x, y, 52) > .95 ? .9 : 1; });
T(24, 'screen', 0, (x, y) => (y & 1) ? .78 : 1.15);
T(25, 'tread', .4, (x, y) => ((x + Math.abs((y % 8) - 4)) % 4 < 2) ? .6 : 1.05);
T(26, 'slots', .8, (x, y) => { const c = x % 8, r = y % 8; if (c >= 1 && c <= 5) { if (r === 3 || r === 4) return .3; if (r === 5) return 1.2; } return 1; });
T(27, 'carbon', .6, (x, y) => (((x >> 1) + (y >> 1)) & 1) ? ((x & 1) ? 1.12 : .96) : ((y & 1) ? .72 : .84));
// decals: null = cut out
T(32, 'kappa', 0, bmp(['................', '..XXX.....XXX...', '..XXX....XXX....', '..XXX...XXX.....', '..XXX..XXX......', '..XXX.XXX.......', '..XXXXXX........', '..XXXXX.........', '..XXXXXX........', '..XXX.XXX.......', '..XXX..XXX......', '..XXX...XXX.....', '..XXX....XXX....', '..XXX.....XXX...', '................', '................']));
T(33, 'omega', 0, bmp(['................', '.....XXXXXX.....', '...XXXXXXXXXX...', '..XXXX....XXXX..', '..XXX......XXX..', '.XXX........XXX.', '.XXX........XXX.', '.XXX........XXX.', '.XXX........XXX.', '..XXX......XXX..', '..XXXX....XXXX..', '...XXX....XXX...', '....XX....XX....', '.XXXXX....XXXXX.', '.XXXXX....XXXXX.', '................']));
T(34, 'cross', 0, (x, y) => {
  if (x < 1 || y < 1 || x > 14 || y > 14 || ((x === 1 || x === 14) && (y === 1 || y === 14))) return null;
  return ((x >= 6 && x <= 9 && y >= 3 && y <= 12) || (y >= 6 && y <= 9 && x >= 3 && x <= 12)) ? [1.25, .16, .13] : [1.27, 1.27, 1.27];
});
T(35, 'warn', 0, (x, y) => {
  const d = Math.abs(x - 7.5), half = (y - 1) * .5 + .75; if (y < 1 || y > 14 || d >= half) return null;
  if (y >= 14 || d >= half - 1.1) return [.16, .16, .16];
  return d < 1 && ((y >= 5 && y <= 9) || y === 11 || y === 12) ? [.16, .16, .16] : [1.3, 1.05, .16];
});
T(36, 'arrow', 0, (x, y) => { const d = Math.abs(x - 7.5); return y >= 3 && y <= 12 && d < 7 && Math.abs(d - (y - 4)) < 1.6 ? 1 : null; });
T(37, 'dot', 0, (x, y) => { const r = Math.hypot(x - 7.5, y - 7.5); if (r > 6.6) return null; return Math.hypot(x - 5.5, y - 5.5) < 1.6 ? 1.37 : r > 5.4 ? .7 : 1; });
T(38, 'ring', 0, (x, y) => { const r = Math.hypot(x - 7.5, y - 7.5); return (r > 4.6 && r < 6.9) || r < 1.3 ? 1 : null; });
T(39, 'bars', 0, (x, y) => (x >= 2 && x <= 13 && (y % 4 === 3 || y % 4 === 0) && y >= 3 && y <= 12) ? 1 : null);
T(40, 'diamond', 0, (x, y) => Math.abs(x - 7.5) + Math.abs(y - 7.5) < 6.2 ? 1 : null);

/** Tuned tints (sRGB hex). Skin is an array, light to dark. */
export const PAL = {
  black: 0x393837, polymer: 0x555452, gunmetal: 0x72706c, blued: 0x4a5368, steel: 0xb2aea6, chrome: 0xe0dcd4,
  tan: 0xc4a56c, olive: 0x7f8c52, green: 0x58733f, sand: 0xdbc793, khaki: 0xa59c6f, navy: 0x3e5582, grey: 0x7e7c78, white: 0xf2eee6,
  wood: 0xb26d36, woodDark: 0x7c4b22, leather: 0x8e5530, brass: 0xe2b248, copper: 0xd17238, rubber: 0x272626,
  red: 0xe23b2a, hazard: 0xffbe1a, kappa: 0x39e6ff, omega: 0xff8a2a, lens: 0x4a92da,
  skin: [0xf6d0aa, 0xe0ad7c, 0xba8254, 0x8a5d3a, 0x5e3c25],
};

const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100',
  G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111101101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101101111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001110',
  '-': '000000111000000', '.': '000000000000010', '/': '001001010100100', ':': '000010000010000', '+': '000010111010000',
};

let _data = null, _tex = null, _mips = null, _pending = false;
const _texts = new Map(); let _tx = 0, _ty = TEXT_Y0;

function paint() {
  const d = new Uint8Array(AT * AT * 4);
  for (let t = 0; t < DEFS.length; t++) {
    const fn = DEFS[t]; if (!fn) continue;
    const ox = (t % 16) * TS, oy = (t >> 4) * TS;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const v = fn(x, y); if (v == null) continue;
      const o = ((oy + y) * AT + ox + x) * 4;
      if (typeof v === 'number') d[o] = d[o + 1] = d[o + 2] = enc(v); else { d[o] = enc(v[0]); d[o + 1] = enc(v[1]); d[o + 2] = enc(v[2]); }
      d[o + 3] = 255;
    }
  }
  return d;
}
// Box-filtered mips in linear light, colour weighted by alpha; the chain stops at 16x16 (one texel per tile).
function remip() {
  let src = _data, s = AT;
  for (let l = 1; l < _mips.length; l++) {
    const h = s >> 1, dst = _mips[l].data;
    for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) { const i = ((y * 2 + (k >> 1)) * s + x * 2 + (k & 1)) * 4, w = src[i + 3]; r += LIN[src[i]] * w; g += LIN[src[i + 1]] * w; b += LIN[src[i + 2]] * w; a += w; }
      const o = (y * h + x) * 4;
      if (a > 0) { dst[o] = 255 * lin2s(r / a) + .5; dst[o + 1] = 255 * lin2s(g / a) + .5; dst[o + 2] = 255 * lin2s(b / a) + .5; }
      dst[o + 3] = Math.min(255, a * .375);
    }
    src = dst; s = h;
  }
}
/** The shared atlas texture (created on first use). */
export function kitAtlas() {
  if (_tex) return _tex;
  _data = paint();
  _mips = [{ data: _data, width: AT, height: AT }];
  for (let s = AT >> 1; s >= AT / TS; s >>= 1) _mips.push({ data: new Uint8Array(s * s * 4), width: s, height: s });
  remip();
  _tex = new THREE.DataTexture(_data, AT, AT, THREE.RGBAFormat);
  _tex.mipmaps = _mips; _tex.magFilter = THREE.NearestFilter; _tex.minFilter = THREE.NearestMipmapLinearFilter;
  _tex.colorSpace = THREE.SRGBColorSpace; _tex.generateMipmaps = false; _tex.needsUpdate = true;
  return _tex;
}
/** Atlas rect [x, y, w, h] (pixels) of a short string, 3x5 font, upper case. Cached; pass it to k.decal. */
export function kitText(str) {
  str = String(str).toUpperCase();
  let r = _texts.get(str); if (r) return r;
  kitAtlas();
  const w = str.length * 4 - 1;
  if (_tx + w + 1 > AT) { _tx = 0; _ty += 7; }
  if (_ty + 6 > AT) { console.warn('kitText: atlas text area full'); return [0, TEXT_Y0, 1, 1]; }
  for (let i = 0; i < str.length; i++) {
    const g = FONT[str[i]]; if (!g) continue;
    for (let k = 0; k < 15; k++) if (g[k] === '1') { const o = ((_ty + 1 + ((k / 3) | 0)) * AT + _tx + i * 4 + (k % 3)) * 4; _data[o] = _data[o + 1] = _data[o + 2] = enc(1); _data[o + 3] = 255; }
  }
  r = [_tx, _ty + 1, w, 5]; _tx += w + 2; _texts.set(str, r);
  if (!_pending) { _pending = true; Promise.resolve().then(() => { _pending = false; remip(); _tex.needsUpdate = true; }); }
  return r;
}

// ---- material -------------------------------------------------------------------------------
const VERT_DECL = '#include <common>\nattribute vec4 kit;\nvarying vec2 vKuv;\nflat varying vec4 vKit;\nflat varying vec2 vKface;';
const VERT_MAIN = `#include <uv_vertex>
  { float kE = floor(kit.x / 256.0), kT = kit.x - kE * 256.0;   // kit = (tile + 256 * edge8, glow, face w, face h)
    vKit = vec4(mod(kT, 16.0) * 16.0, floor(kT / 16.0) * 16.0, kit.y, kE / 8.0); vKface = kit.zw; vKuv = uv; }`;
const FRAG_DECL = '#include <common>\nvarying vec2 vKuv;\nflat varying vec4 vKit;\nflat varying vec2 vKface;';
// uv is in texels from the face's top-left corner; tiles wrap every 16 texels; face w < 0 = absolute atlas texels (decals)
const FRAG_MAP = `float kRim = 0.0;
#ifdef USE_MAP
  vec2 kuv = vKuv, kdx = dFdx(vKuv), kdy = dFdy(vKuv);
  if (vKface.x > 0.5) kuv.x = min(kuv.x, vKface.x - 0.002);
  if (vKface.y > 0.5) kuv.y = min(kuv.y, vKface.y - 0.002);
  vec2 kat = vKface.x < -0.5 ? kuv : vKit.xy + mod(kuv, 16.0);
  vec4 ktx = textureGrad(map, kat / 256.0, kdx / 256.0, kdy / 256.0);
  ktx.rgb *= ${GAIN.toFixed(1)};
  float kEdge = vKit.w * clamp(1.75 - max(length(kdx), length(kdy)), 0.0, 1.0);   // rims fade when texels get sub-pixel
  if (kEdge > 0.0) {
    vec2 kip = floor(kuv);
    if (vKface.y > 0.5) kRim = kip.y < 0.5 ? 1.0 : (kip.y > vKface.y - 1.5 ? -1.0 : 0.0);
    if (kRim == 0.0 && vKface.x > 0.5) kRim = kip.x < 0.5 ? 0.5 : (kip.x > vKface.x - 1.5 ? -0.5 : 0.0);
    kRim *= kEdge;
    ktx.rgb *= 1.0 + (kRim > 0.0 ? 0.55 : 0.42) * kRim;
  }
  diffuseColor *= ktx;
#endif`;
const FRAG_COLOR = '#include <color_fragment>\n  diffuseColor.rgb += vec3(0.03) * max(kRim, 0.0);';
const FRAG_GLOW = '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vKit.z; diffuseColor.rgb *= max(0.0, 1.0 - vKit.z);';
function patch(m) {
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_DECL).replace('#include <uv_vertex>', VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', FRAG_DECL).replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <color_fragment>', FRAG_COLOR).replace('#include <emissivemap_fragment>', FRAG_GLOW);
  };
  m.customProgramCacheKey = () => 'kit1';
  return m;
}
let _mat = null;
/** The shared kit material; { unique: true, color? } returns a tintable clone (same GPU program). */
export function kitMaterial(opts) {
  if (!_mat) { _mat = patch(new THREE.MeshLambertMaterial({ map: kitAtlas(), vertexColors: true, alphaTest: 0.5, fog: true })); _mat.name = 'kit'; }
  if (opts && opts.unique) { const m = patch(_mat.clone()); if (opts.color != null) m.color.set(opts.color); return m; }
  return _mat;
}

// ---- builder --------------------------------------------------------------------------------
const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();
const _p = new THREE.Vector3(), _sc = new THREE.Vector3(), _col = new THREE.Color(), _c8 = new Float64Array(24), _v3 = [0, 0, 0], _nn = [0, 0, 0];
const _ix = [0, 0, 0, 0], _uu = [0, 0, 0, 0], _vv = [0, 0, 0, 0], _qq = [0, 0, 0, 0];
const AX = { x: 0, y: 1, z: 2 };
const HF = [[5, 1, 3, 7], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [1, 0, 2, 3]];   // +x -x +y -y +z -z, CCW from outside
const FACE = { '+x': [1, 0, 0, 0, 1, 0], '-x': [-1, 0, 0, 0, 1, 0], '+y': [0, 1, 0, 0, 0, -1], '-y': [0, -1, 0, 0, 0, 1], '+z': [0, 0, 1, 0, 1, 0], '-z': [0, 0, -1, 0, 1, 0] };   // normal, up
function compose(out, x, y, z, rot, s) {
  let rx = 0, ry = 0, rz = 0;
  if (rot) { if (typeof rot === 'number') rx = rot; else { rx = rot[0] || 0; ry = rot[1] || 0; rz = rot[2] || 0; } }
  if (s == null) _sc.set(1, 1, 1); else if (typeof s === 'number') _sc.set(s, s, s); else _sc.set(s[0], s[1], s[2]);
  return out.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _sc);
}

export class Kit {
  /** @param ppm texels per metre (about 96 for first-person weapons, 40 for soldiers)  @param style default style */
  constructor(ppm = 96, style) {
    this.ppm = ppm; this.m = new THREE.Matrix4(); this.stack = [];
    this.def = { tile: 0, tint: 0xffffff, glow: 0, edge: undefined, bone: -1, turn: 0, ppm: undefined };
    this.S = { k0: 0, glow: 0, bone: -1, turn: 0, ppm, r: 1, g: 1, b: 1 };
    this.reset(); if (style) this.set(style);
  }
  reset() { this.P = []; this.N = []; this.U = []; this.C = []; this.K = []; this.B = []; this.I = []; this.nv = 0; this.prims = 0; this.skin = false; this._fw = 0; this._fh = 0; this._flip = false; this.m.identity(); this.stack.length = 0; return this; }
  get tris() { return this.I.length / 3; }
  /** Change the default style for the primitives that follow. */
  set(style) { Object.assign(this.def, typeof style === 'number' ? { tint: style } : style); return this; }
  bone(i) { this.def.bone = i; return this; }
  push(x = 0, y = 0, z = 0, rot, scale) { this.stack.push(this.m.clone()); this.m.multiply(compose(_l, x, y, z, rot, scale)); return this; }
  pop() { this.m.copy(this.stack.pop()); return this; }
  group(x, y, z, rot, fn, scale) { if (typeof rot === 'function') { fn = rot; rot = 0; } this.push(x, y, z, rot, scale); fn(this); return this.pop(); }
  mirror(fn) { fn(1, this); this.push(0, 0, 0, 0, [-1, 1, 1]); fn(-1, this); return this.pop(); }

  _begin(st, x, y, z, rot) {
    const d = this.def, S = this.S; let tint;
    if (st == null) st = d; else if (typeof st !== 'object' || st.isColor) { tint = st; st = d; }
    const tile = st.tile ?? d.tile, edge = st.edge ?? d.edge ?? EDGE[tile];
    S.glow = st.glow ?? d.glow; S.bone = st.bone ?? d.bone; S.turn = st.turn ?? d.turn; S.ppm = st.ppm ?? d.ppm ?? this.ppm;
    S.k0 = tile + 256 * Math.round(Math.max(0, Math.min(1.875, edge)) * 8);
    _col.set(tint ?? st.tint ?? d.tint); S.r = _col.r; S.g = _col.g; S.b = _col.b;
    if (S.bone >= 0) this.skin = true;
    _m.multiplyMatrices(this.m, compose(_l, x, y, z, rot)); _n3.getNormalMatrix(_m); this._flip = _m.determinant() < 0; this.prims++;
  }
  _v(x, y, z, nx, ny, nz, u, v) {
    const e = _m.elements, n = _n3.elements, S = this.S;
    this.P.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    const a = n[0] * nx + n[3] * ny + n[6] * nz, b = n[1] * nx + n[4] * ny + n[7] * nz, c = n[2] * nx + n[5] * ny + n[8] * nz, l = 1 / (Math.hypot(a, b, c) || 1);
    this.N.push(a * l, b * l, c * l); this.U.push(u, v); this.C.push(S.r, S.g, S.b); this.K.push(S.k0, S.glow, this._fw, this._fh); this.B.push(S.bone);
    return this.nv++;
  }
  _tri(a, b, c) { if (this._flip) this.I.push(a, c, b); else this.I.push(a, b, c); }
  _quad(a, b, c, d) { this._tri(a, b, c); this._tri(a, c, d); }
  // Planar quad from 4 corners of c (offsets), CCW from outside. Texels: u along Z (X on z-faces), v down, whole texels per face.
  _face(c, i0, i1, i2, i3) {
    const ix = _ix; ix[0] = i0; ix[1] = i1; ix[2] = i2; ix[3] = i3; let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 4; k++) { const a = ix[k], b = ix[(k + 1) & 3]; nx += (c[a + 1] - c[b + 1]) * (c[a + 2] + c[b + 2]); ny += (c[a + 2] - c[b + 2]) * (c[a] + c[b]); nz += (c[a] - c[b]) * (c[a + 1] + c[b + 1]); }
    let l = Math.hypot(nx, ny, nz); if (l < 1e-12) return; nx /= l; ny /= l; nz /= l;
    let ux, uy, uz; if (Math.abs(nz) < .9) { ux = -nz * nx; uy = -nz * ny; uz = 1 - nz * nz; } else { ux = 1 - nx * nx; uy = -nx * ny; uz = -nx * nz; }
    l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
    let vx = uy * nz - uz * ny, vy = uz * nx - ux * nz, vz = ux * ny - uy * nx;
    if ((Math.abs(ny) < .9 ? -vy : vx) < 0) { ux = -ux; uy = -uy; uz = -uz; vx = -vx; vy = -vy; vz = -vz; }
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; const uu = _uu, vv = _vv;
    for (let k = 0; k < 4; k++) { const a = ix[k], u = c[a] * ux + c[a + 1] * uy + c[a + 2] * uz, v = c[a] * vx + c[a + 1] * vy + c[a + 2] * vz; uu[k] = u; vv[k] = v; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const eu = u1 - u0, ev = v1 - v0; if (eu < 1e-9 || ev < 1e-9) return;
    const ppm = this.S.ppm, nu = Math.max(1, Math.round(eu * ppm)), nv = Math.max(1, Math.round(ev * ppm)), turn = this.S.turn;
    this._fw = turn ? nv : nu; this._fh = turn ? nu : nv;
    const q = _qq;
    for (let k = 0; k < 4; k++) { const a = ix[k], tu = (uu[k] - u0) / eu * nu, tv = (vv[k] - v0) / ev * nv; q[k] = turn ? this._v(c[a], c[a + 1], c[a + 2], nx, ny, nz, tv, tu) : this._v(c[a], c[a + 1], c[a + 2], nx, ny, nz, tu, tv); }
    this._quad(q[0], q[1], q[2], q[3]);
  }
  _hexa(c) { for (let f = 0; f < 6; f++) { const q = HF[f]; this._face(c, q[0] * 3, q[1] * 3, q[2] * 3, q[3] * 3); } return this; }
  _corners(w, h, d) { const c = _c8, a = w / 2, b = h / 2, e = d / 2; for (let i = 0; i < 8; i++) { c[i * 3] = i & 1 ? a : -a; c[i * 3 + 1] = i & 2 ? b : -b; c[i * 3 + 2] = i & 4 ? e : -e; } return c; }

  box(w, h, d, x = 0, y = 0, z = 0, style, rot) { this._begin(style, x, y, z, rot); return this._hexa(this._corners(w, h, d)); }
  taper(w, h, d, x, y, z, axis = '+y', scale = .5, style, rot, shift) {
    this._begin(style, x, y, z, rot); const c = this._corners(w, h, d);
    const ai = AX[axis[axis.length - 1]], sg = axis[0] === '-' ? 0 : 1, o1 = ai === 0 ? 1 : 0, o2 = ai === 2 ? 1 : 2;
    const s1 = typeof scale === 'number' ? scale : scale[0], s2 = typeof scale === 'number' ? scale : scale[1], h1 = shift ? shift[0] : 0, h2 = shift ? shift[1] : 0;
    for (let i = 0; i < 8; i++) if (((i >> ai) & 1) === sg) { c[i * 3 + o1] = c[i * 3 + o1] * s1 + h1; c[i * 3 + o2] = c[i * 3 + o2] * s2 + h2; }
    return this._hexa(c);
  }
  wedge(w, h, d, x, y, z, style, rot) { return this.taper(w, h, d, x, y, z, '+z', [1, 0], style, rot, [0, -h / 2]); }

  // vertex in the cylinder frame: (a, b) cross-section, t along the axis
  _pv(ai, a, b, t, na, nb, nt, u, v) { const p = _v3, n = _nn; p[ai] = t; p[(ai + 1) % 3] = a; p[(ai + 2) % 3] = b; n[ai] = nt; n[(ai + 1) % 3] = na; n[(ai + 2) % 3] = nb; return this._v(p[0], p[1], p[2], n[0], n[1], n[2], u, v); }
  // side wall of a prism: radius ra at t = -h, rb at t = +h; inv = inward-facing (inside of a tube)
  _wall(ai, ra, rb, h, n, phase, smooth, oval, nl, nc, along, inv) {
    const step = Math.PI * 2 / n, slope = (ra - rb) / (2 * h), g = inv ? -1 : 1;
    this._fw = along ? nl : 0; this._fh = along ? 0 : nl;
    for (let i = 0; i < n; i++) {
      const t0 = phase + i * step, t1 = t0 + step, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      let n0a = c0, n0b = s0 / oval, n1a = c1, n1b = s1 / oval;
      if (!smooth) { n0a = n1a = Math.cos(t0 + step / 2); n0b = n1b = Math.sin(t0 + step / 2) / oval; }
      let l = g / Math.hypot(n0a, n0b); n0a *= l; n0b *= l; l = g / Math.hypot(n1a, n1b); n1a *= l; n1b *= l;
      const w0 = i / n * nc, w1 = (i + 1) / n * nc, sl = slope * g;
      const A = along ? this._pv(ai, c0 * ra, s0 * ra * oval, -h, n0a, n0b, sl, 0, w0) : this._pv(ai, c0 * ra, s0 * ra * oval, -h, n0a, n0b, sl, w0, nl);
      const B = along ? this._pv(ai, c1 * ra, s1 * ra * oval, -h, n1a, n1b, sl, 0, w1) : this._pv(ai, c1 * ra, s1 * ra * oval, -h, n1a, n1b, sl, w1, nl);
      const C = along ? this._pv(ai, c1 * rb, s1 * rb * oval, h, n1a, n1b, sl, nl, w1) : this._pv(ai, c1 * rb, s1 * rb * oval, h, n1a, n1b, sl, w1, 0);
      const D = along ? this._pv(ai, c0 * rb, s0 * rb * oval, h, n0a, n0b, sl, nl, w0) : this._pv(ai, c0 * rb, s0 * rb * oval, h, n0a, n0b, sl, w0, 0);
      if (inv) this._quad(A, D, C, B); else this._quad(A, B, C, D);
    }
    this._fw = this._fh = 0;
  }
  // end cap at t = sg * h: disc (ri = 0) or annulus, planar texels
  _cap(ai, rad, ri, h, sg, n, phase, oval) {
    const step = Math.PI * 2 / n, nd = Math.max(1, Math.round(2 * rad * this.S.ppm)), k = ri / rad;
    const ctr = ri > 0 ? -1 : this._pv(ai, 0, 0, sg * h, 0, 0, sg, nd / 2, nd / 2), first = this.nv;
    for (let i = 0; i < n; i++) {
      const t = phase + i * step, c = Math.cos(t), s = Math.sin(t);
      this._pv(ai, c * rad, s * rad * oval, sg * h, 0, 0, sg, (c * .5 + .5) * nd, (.5 - s * .5) * nd);
      if (ri > 0) this._pv(ai, c * ri, s * ri * oval, sg * h, 0, 0, sg, (c * k * .5 + .5) * nd, (.5 - s * k * .5) * nd);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (ri > 0) { const a = first + i * 2, b = first + j * 2; if (sg > 0) this._quad(a, b, b + 1, a + 1); else this._quad(a, a + 1, b + 1, b); }
      else if (sg > 0) this._tri(ctr, first + i, first + j); else this._tri(ctr, first + j, first + i);
    }
  }
  cyl(axis, r, len, x = 0, y = 0, z = 0, style, o) {
    let n = 8, r2 = r, rot, caps = 3, smooth, oval = 1, phase;
    if (typeof o === 'number') n = o; else if (o) { n = o.n ?? 8; r2 = o.r2 ?? r; rot = o.rot; caps = o.caps ?? 3; smooth = o.smooth; oval = o.oval ?? 1; phase = o.phase; }
    this._begin(style, x, y, z, rot);
    const ai = AX[axis[axis.length - 1]], S = this.S, ppm = S.ppm, h = len / 2;
    if (smooth == null) smooth = n > 6; if (phase == null) phase = (ai === 2 ? Math.PI / 2 : 0) - Math.PI / n;   // a flat facet faces up / forward
    const nl = Math.max(1, Math.round(Math.hypot(len, r - r2) * ppm)), nc = Math.max(n, Math.round(Math.PI * Math.max(r, r2) * (1 + oval) * ppm));
    this._wall(ai, r, r2, h, n, phase, smooth, oval, nl, nc, (ai !== 1) !== !!S.turn, false);   // u along the axis for x / z, v along the axis (down) for y
    if ((caps & 1) && r > 1e-6) this._cap(ai, r, 0, h, -1, n, phase, oval);
    if ((caps & 2) && r2 > 1e-6) this._cap(ai, r2, 0, h, 1, n, phase, oval);
    return this;
  }
  tube(axis, r, ri, len, x = 0, y = 0, z = 0, style, o) {
    let n = 8, rot, smooth, phase;
    if (typeof o === 'number') n = o; else if (o) { n = o.n ?? 8; rot = o.rot; smooth = o.smooth; phase = o.phase; }
    this._begin(style, x, y, z, rot);
    const ai = AX[axis[axis.length - 1]], S = this.S, ppm = S.ppm, h = len / 2, along = (ai !== 1) !== !!S.turn;
    if (smooth == null) smooth = n > 6; if (phase == null) phase = (ai === 2 ? Math.PI / 2 : 0) - Math.PI / n;
    const nl = Math.max(1, Math.round(len * ppm));
    this._wall(ai, r, r, h, n, phase, smooth, 1, nl, Math.max(n, Math.round(Math.PI * 2 * r * ppm)), along, false);
    this._wall(ai, ri, ri, h, n, phase, smooth, 1, nl, Math.max(n, Math.round(Math.PI * 2 * ri * ppm)), along, true);
    this._cap(ai, r, ri, h, -1, n, phase, 1); this._cap(ai, r, ri, h, 1, n, phase, 1);
    return this;
  }
  ball(r, x = 0, y = 0, z = 0, style, o) {
    const rx = typeof r === 'number' ? r : r[0], ry = typeof r === 'number' ? r : r[1], rz = typeof r === 'number' ? r : r[2];
    const n = o?.n ?? 8, m = o?.m ?? 5, top = o?.top ?? 0, bot = o?.bot ?? 1, caps = o?.caps ?? true;
    this._begin(style, x, y, z, o?.rot);
    const ppm = this.S.ppm, step = Math.PI * 2 / n, phase = Math.PI / 2 - Math.PI / n;
    const nu = Math.max(n, Math.round(Math.PI * (rx + rz) * ppm)), nv = Math.max(m, Math.round(Math.PI * ry * (bot - top) * ppm));
    this._fw = 0; this._fh = nv;
    const vert = (i, j) => { const f = Math.PI * (top + (bot - top) * j / m), t = phase + i * step, sf = Math.sin(f), cf = Math.cos(f), ct = Math.cos(t), st = Math.sin(t); return this._v(sf * ct * rx, cf * ry, sf * st * rz, sf * ct / rx, cf / ry, sf * st / rz, i / n * nu, j / m * nv); };
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const A = vert(i, j), B = vert(i, j + 1), C = vert(i + 1, j + 1), D = vert(i + 1, j); this._quad(A, D, C, B); }
    this._fw = this._fh = 0;
    if (caps) for (let e = 0; e < 2; e++) {
      const fr = e ? bot : top; if (fr <= 0 || fr >= 1) continue;
      const f = Math.PI * fr, sf = Math.sin(f), yy = Math.cos(f) * ry, sg = e ? -1 : 1, nd = Math.max(1, Math.round(2 * sf * rx * ppm)), ctr = this._v(0, yy, 0, 0, sg, 0, nd / 2, nd / 2), first = this.nv;
      for (let i = 0; i < n; i++) { const t = phase + i * step, c = Math.cos(t), s = Math.sin(t); this._v(sf * c * rx, yy, sf * s * rz, 0, sg, 0, (c * .5 + .5) * nd, (s * .5 + .5) * nd); }
      for (let i = 0; i < n; i++) { const a = first + i, b = first + (i + 1) % n; if (e) this._tri(ctr, a, b); else this._tri(ctr, b, a); }
    }
    return this;
  }
  decal(tile, w, h, x = 0, y = 0, z = 0, face = '+z', style, rot) {
    this._begin(style, x, y, z, rot);
    const F = FACE[face] || FACE['+z'], nx = F[0], ny = F[1], nz = F[2], ax = F[3], ay = F[4], az = F[5];
    let bx = ay * nz - az * ny, by = az * nx - ax * nz, bz = ax * ny - ay * nx;     // right = up x normal
    const lift = .2 / this.S.ppm, e = .02; let px, py, pw, ph;
    if (typeof tile === 'number') { px = (tile % 16) * TS; py = (tile >> 4) * TS; pw = ph = TS; } else { px = tile[0]; py = tile[1]; pw = tile[2]; ph = tile[3]; }
    let ul = px + e, ur = px + pw - e; if (this._flip) { const t = ul; ul = ur; ur = t; }   // keep glyphs readable on the mirrored side
    this.S.k0 = this.S.k0 % 256; this._fw = -1; this._fh = 0;
    const cx = nx * lift, cy = ny * lift, cz = nz * lift, hw = w / 2, hh = h / 2;
    const P = (su, sv, u, v) => this._v(cx + bx * hw * su + ax * hh * sv, cy + by * hw * su + ay * hh * sv, cz + bz * hw * su + az * hh * sv, nx, ny, nz, u, v);
    this._quad(P(-1, -1, ul, py + ph - e), P(1, -1, ur, py + ph - e), P(1, 1, ur, py + e), P(-1, 1, ul, py + e));
    return this;
  }
  text(str, height, x, y, z, face, style, rot) { const r = kitText(str); return this.decal(r, height * r[2] / r[3], height, x, y, z, face, style, rot); }

  geometry() {
    const g = new THREE.BufferGeometry(), F = THREE.Float32BufferAttribute;
    g.setAttribute('position', new F(this.P, 3)); g.setAttribute('normal', new F(this.N, 3)); g.setAttribute('uv', new F(this.U, 2));
    g.setAttribute('color', new F(this.C, 3)); g.setAttribute('kit', new F(this.K, 4));
    if (this.skin) {
      const n = this.nv, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = Math.max(0, this.B[i]); sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    }
    g.setIndex(this.I); g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
  mesh(parent, x = 0, y = 0, z = 0, material) {
    const m = new THREE.Mesh(this.geometry(), material || kitMaterial());
    m.position.set(x, y, z); m.userData.home = m.position.clone(); m.userData.homeR = m.rotation.clone();
    if (parent) parent.add(m); return m;
  }
  skinned(bones, material) {
    this.skin = true;
    const g = this.geometry(), m = new THREE.SkinnedMesh(g, material || kitMaterial());
    for (const b of bones) if (!b.parent) m.add(b);
    m.updateMatrixWorld(true); for (const b of bones) b.updateWorldMatrix(true, false);
    m.bind(new THREE.Skeleton(bones));
    m.boundingSphere = g.boundingSphere.clone(); m.boundingSphere.radius = m.boundingSphere.radius * 1.8 + .3;   // roomy: skips the per-vertex bound pass, survives any pose
    m.boundingBox = new THREE.Box3().setFromCenterAndSize(m.boundingSphere.center, _p.setScalar(m.boundingSphere.radius * 2));
    return m;
  }
}

// ---- showcase -------------------------------------------------------------------------------
/** Ammo crate, helmet and a rifle receiver section: the reference for how kit models should read. */
export function kitDemo() {
  const g = new THREE.Group();
  // crate (soldier / prop density)
  const c = new Kit(40), ol = { tile: TILE.worn, tint: PAL.olive }, band = { tile: TILE.rivet, tint: PAL.gunmetal };
  c.box(.60, .30, .40, 0, .15, 0, ol);
  c.box(.64, .05, .44, 0, .325, 0, { tile: TILE.panel, tint: PAL.green, turn: 0 });
  c.mirror(() => { c.box(.05, .32, .44, .30, .16, 0, band); c.box(.03, .05, .16, .335, .2, 0, { tile: TILE.fabric, tint: PAL.khaki }); });
  c.box(.50, .075, .01, 0, .09, .2, { tile: TILE.hazard, tint: PAL.hazard, edge: 0 });
  c.decal(TILE.warn, .125, .125, -.15, .21, .2, '+z').text('K-7', .075, .09, .21, .2, '+z', PAL.white);
  c.decal(TILE.kappa, .2, .2, 0, .35, 0, '+y', PAL.kappa).text('5.56', .075, 0, .2, -.2, '-z', PAL.sand);
  c.mesh(g, -.52, -.17, 0);
  // helmet on a head
  const h = new Kit(40), cam = { tile: TILE.camo, tint: PAL.olive };
  h.ball([.1, .12, .105], 0, -.06, 0, { tile: TILE.skin, tint: PAL.skin[1] }, { n: 8, m: 4 });
  h.ball([.125, .125, .14], 0, .01, 0, cam, { n: 8, m: 4, bot: .56 });
  h.cyl('y', .143, .025, 0, -.014, 0, { tile: TILE.flat, tint: PAL.green }, { n: 8, oval: .9 });
  h.box(.19, .05, .03, 0, -.045, .095, { tile: TILE.glass, tint: PAL.lens, glow: .35 });
  h.box(.215, .03, .16, 0, -.045, .01, { tile: TILE.fabric, tint: PAL.black });
  h.box(.05, .04, .03, 0, .055, .13, { tile: TILE.metal, tint: PAL.gunmetal });
  h.mirror(() => h.decal(TILE.kappa, .075, .075, .123, .03, 0, '+x', PAL.kappa));
  h.mesh(g, 0, 0, 0);
  // rifle section (first-person density), muzzle to -Z
  const k = new Kit(96), r = new THREE.Group(); r.position.set(.4, 0, .1); g.add(r);
  const gm = { tile: TILE.blued, tint: PAL.gunmetal }, pol = { tile: TILE.polymer, tint: PAL.polymer }, stl = { tile: TILE.metal, tint: PAL.steel }, blk = { tile: TILE.polymer, tint: PAL.black };
  k.box(.044, .042, .30, 0, .034, -.02, gm).taper(.044, .012, .30, 0, .061, -.02, '+y', [.6, 1], gm);
  k.box(.024, .012, .28, 0, .072, -.02, { tile: TILE.rail, tint: PAL.polymer });
  k.box(.040, .040, .20, 0, -.006, .02, pol);
  k.cyl('z', .030, .17, 0, .034, -.255, { tile: TILE.slots, tint: PAL.tan }, 8);
  k.cyl('z', .011, .10, 0, .034, -.39, stl, 8).cyl('z', .017, .05, 0, .034, -.455, { tile: TILE.grille, tint: PAL.black }, 6);
  k.box(.034, .09, .046, 0, -.062, .1, { tile: TILE.grip, tint: PAL.black }, -.28);
  k.group(0, -.02, -.035, .14, () => { k.box(.028, .12, .06, 0, -.06, 0, { tile: TILE.ribs, tint: PAL.tan }); k.box(.032, .014, .066, 0, -.125, 0, blk); });
  k.box(.008, .006, .07, 0, -.052, .05, blk).box(.008, .03, .006, 0, -.038, .016, blk).box(.006, .022, .008, 0, -.036, .055, stl, -.3);
  k.box(.002, .016, .06, .0225, .04, -.03, { tile: TILE.flat, tint: PAL.rubber, edge: 0 });
  k.box(.003, .012, .03, -.0225, .04, .08, { tile: TILE.screen, tint: PAL.kappa, glow: 1.2 });
  k.decal(TILE.kappa, .03, .03, -.02, -.006, .05, '-x', PAL.kappa).text('K-7', .012, -.0225, .034, -.08, '-x', PAL.white).decal(TILE.dot, .012, .012, -.02, -.004, .095, '-x', PAL.red);
  k.taper(.036, .05, .10, 0, .02, .18, '+z', [.8, .7], pol);
  k.box(.006, .02, .006, 0, .088, -.15, blk).tube('z', .016, .012, .012, 0, .096, .09, blk, 8).box(.012, .006, .02, 0, .08, .09, blk);
  k.mesh(r);
  const kb = new Kit(96); kb.box(.014, .01, .02, 0, 0, 0, stl).cyl('x', .006, .014, .012, 0, 0, { tile: TILE.knurl, tint: PAL.steel }, 6);
  r.userData.bolt = kb.mesh(r, .028, .042, -.03);
  return g;
}
/** Swatch board: one slab per tile in TILE order, 8 per row (first row at the top). */
export function kitTiles() {
  const k = new Kit(96), names = Object.keys(TILE);
  const tint = { wood: PAL.wood, wood2: PAL.woodDark, blued: PAL.blued, metal: PAL.steel, polymer: PAL.polymer, grip: PAL.black, fabric: PAL.navy, ripstop: PAL.khaki, camo: PAL.olive, splinter: PAL.grey, molle: PAL.tan, leather: PAL.leather, skin: PAL.skin[1], glass: PAL.lens, hazard: PAL.hazard, worn: PAL.olive, screen: PAL.kappa, tread: PAL.rubber, carbon: PAL.polymer, rail: PAL.polymer, slots: PAL.tan };
  names.forEach((nm, i) => {
    const x = (i % 8) * .2, y = -Math.floor(i / 8) * .2, t = TILE[nm];
    if (t >= 32) k.box(.1667, .1667, .04, x, y, 0, { tile: TILE.flat, tint: PAL.polymer }).decal(t, .15, .15, x, y, .02, '+z', nm === 'omega' ? PAL.omega : nm === 'kappa' ? PAL.kappa : PAL.white);
    else k.box(.1667, .1667, .04, x, y, 0, { tile: t, tint: tint[nm] ?? PAL.gunmetal, glow: nm === 'screen' ? 1 : 0 });
  });
  return k.mesh();
}
