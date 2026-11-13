// Soldiers: rigged, skinned pixel-art infantry built with the kit. One SkinnedMesh per soldier (rigid
// skinning, 17 bones), seeded appearance per faction and class, procedural animation (gait, crouch,
// two-handed aim with analytic IK, recoil, reload, flinch) and scripted deaths with weight.
//
//   buildSoldier({ team, cls, weaponId, seed, world?, ghost? }) -> soldier
//     team      0 = KAPPA (navy digital camo, angular armour, cyan lights), 1 = OMEGA (tan splinter camo, round
//               helmets, scarves, orange-red lights)
//     cls       'assalto' | 'engenheiro' | 'suporte' | 'recon' (English aliases accepted); default: the weapon's class
//     weaponId  key of WEAPONS; default: a typical weapon of the class
//     seed      number or string (a bot name): height, build, skin, headgear, face, gear layout
//     world     optional World: its lightAt() tints the soldier (roofs, lamps)
//     ghost     true = translucent additive cyan copy (the Echo decoy)
//   soldier.root                  THREE.Group to add to the scene; the soldier positions / rotates it itself
//   soldier.update(dt, state)     state = { pos, yaw, vx, vz, crouch, aimPitch, aiming, reload01, ammo, alive }
//                                 pos = feet (metres), yaw: the model faces -Z, vx / vz = world velocity,
//                                 reload01 = reload progress 0..1 or -1, ammo: a decrease plays a shot (recoil + flash)
//   soldier.setWeapon(weaponId)   swap the gun in the hands
//   soldier.muzzleWorld(out?)     world position of the muzzle
//   soldier.hit(dx, dz, k?)       directional flinch; (dx, dz) = world direction the hit pushes towards
//   soldier.die(info?)            info = { dx, dz, blast, head, power, room, variant } picks and starts a death
//   soldier.respawn()             back to a living, armed soldier
//   soldier.setLabel(text, css?)  name plate sprite above the head (soldier.label, hidden until made visible)
//   soldier.setOpacity(o)         ghost only
//   soldier.headCenter(out?)      world position of the head centre (hit-sphere check)
//   soldier.dispose()
//   buildSoldier(team, gunType)   legacy call: returns root (root.userData.soldier is the soldier)
import * as THREE from 'three';
import { Kit, TILE, PAL, kitMaterial } from './kit.js';
import { buildGun, WEAPONS } from './weapons.js';

// ---- skeleton --------------------------------------------------------------------------------
const HIPS = 0, SPINE = 1, CHEST = 2, HEAD = 3, ARM_R = 4, FORE_R = 5, HAND_R = 6, ARM_L = 7, FORE_L = 8, HAND_L = 9,
  THIGH_R = 10, SHIN_R = 11, FOOT_R = 12, THIGH_L = 13, SHIN_L = 14, FOOT_L = 15, HELM = 16, NB = 17;
const NAMES = ['hips', 'spine', 'chest', 'head', 'armR', 'foreR', 'handR', 'armL', 'foreL', 'handL', 'thighR', 'shinR', 'footR', 'thighL', 'shinL', 'footL', 'helm'];
const PARENT = [-1, 0, 1, 2, 2, 4, 5, 2, 7, 8, 0, 10, 11, 0, 13, 14, 3];
// joints in the bind pose (model space, metres, facing -Z, arms hanging)
const JOINT = [[0, .98, 0], [0, 1.1, 0], [0, 1.26, 0], [0, 1.5, .01], [.235, 1.43, 0], [.235, 1.13, 0], [.235, .86, 0], [-.235, 1.43, 0], [-.235, 1.13, 0], [-.235, .86, 0],
  [.1, .94, 0], [.1, .5, 0], [.1, .08, 0], [-.1, .94, 0], [-.1, .5, 0], [-.1, .08, 0], [0, 1.66, 0]];
const L_ARM1 = .3, L_ARM2 = .27, L_LEG1 = .44, L_LEG2 = .42;
const GS = 1.04;                                   // third-person gun scale
const AMB = .12;                                   // self-lit share of every surface: keeps the factions' colours readable at night
const FIST = new THREE.Vector3(0, -.063, -.004);   // fist centre in hand space
const XA = new THREE.Vector3(1, 0, 0), ZA = new THREE.Vector3(0, 0, 1);
const Q_GRIP_R = new THREE.Quaternion().setFromAxisAngle(XA, 1.77);                                   // hand relative to the gun
const Q_GRIP_L = new THREE.Quaternion().setFromAxisAngle(ZA, .7).multiply(new THREE.Quaternion().setFromAxisAngle(XA, 1.8));
const Q_GUN = Q_GRIP_R.clone().invert();                                                              // gun relative to the right hand

// where the hands and the shoulder meet each gun type (gun space: -Z muzzle, +Z stock)
const hold = (gy, gz, sy, sz, by, bz, my, mz, x = 0) => ({ grip: [x, gy, gz], sup: [x, sy, sz], butt: [x, by, bz], mag: [x, my, mz] });
const HOLD = {
  rifle: hold(-.07, .08, -.045, -.17, -.01, .33, -.13, -.08), bullpup: hold(-.075, -.06, -.04, -.21, -.01, .325, -.12, .18),
  smg: hold(-.07, .1, -.05, -.12, 0, .28, -.16, -.04), pdw: hold(-.07, .06, -.055, -.11, 0, .3, .07, -.02),
  shotgun: hold(-.07, .1, -.05, -.15, -.02, .41, -.06, 0), lmg: hold(-.075, .1, -.05, -.19, -.01, .36, -.1, -.05),
  dmr: hold(-.07, .1, -.05, -.16, -.01, .38, -.12, -.08), sniper: hold(-.07, .13, -.045, -.13, -.03, .41, -.08, -.02),
  pistol: hold(-.045, .02, -.05, .03, .03, .36, -.08, .025), launcher: hold(-.07, 0, -.065, -.25, -.045, .14, 0, -.3, .02),
};
HOLD.lmg2 = HOLD.lmg; HOLD.sniper2 = HOLD.sniper; HOLD.mpistol = HOLD.revolver = HOLD.pistol;

const CLS = { assalto: 'assalto', assault: 'assalto', engenheiro: 'engenheiro', engineer: 'engenheiro', suporte: 'suporte', support: 'suporte', recon: 'recon', reconhecimento: 'recon', sniper: 'recon' };
const CLS_GUN = { assalto: 'k7', engenheiro: 'vespa', suporte: 'trovao', recon: 'orion' };

// ---- small maths -----------------------------------------------------------------------------
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hashSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f);

// ---- factions --------------------------------------------------------------------------------
const C = (tile, tint, o) => Object.assign({ tile: TILE[tile], tint }, o);
const WHITE = { tint: 0xffffff, glow: .35 };
const FAC = [
  { // KAPPA, institute security
    accent: PAL.kappa, glyph: TILE.kappa,
    uni: C('camo', 0x6a779c), legs: [C('camo', 0x5a6688), C('camo', 0x626c86), C('ripstop', 0x545f7c)],
    gear: C('molle', 0x53555c), pouch: C('fabric', 0x494b52), pack: C('ripstop', 0x4c4f58), roll: C('fabric', 0x4a5670),
    helm: C('polymer', 0x535c72), cap: C('fabric', 0x4a5572), beanie: [0x3e4456, 0x45516e, 0x35373f], mask: C('fabric', 0x33363f),
    pad: C('polymer', 0x44464c), belt: C('polymer', 0x3c3d44), strap: C('flat', 0x393b44), boot: C('leather', 0x45423f), sole: C('tread', 0x2a2a2c),
    glove: C('grip', 0x4e5056), patch: C('flat', 0x2b3550), tube: C('metal', 0x687080), nade: C('metal', 0x566050), med: C('fabric', 0xc4c7cb),
    lens: C('glass', 0x7fe9ff, { glow: .8 }), light: C('flat', PAL.kappa, { glow: 2, edge: 0 }), ink: { tint: PAL.kappa, glow: .9 },
    scarf: [0x2f3648, 0x3a4664], strips: [0x3d4862, 0x56617c, 0x2f3646, 0x6a7692], cape: C('fabric', 0x414c66),
  },
  { // OMEGA, private military company
    accent: PAL.omega, glyph: TILE.omega,
    uni: C('splinter', 0xcfa868), legs: [C('splinter', 0x8f9655), C('ripstop', 0xa99b68), C('splinter', 0xa9895a)],
    gear: C('molle', 0x8f7d52), pouch: C('fabric', 0x7f7048), pack: C('ripstop', 0x77693f), roll: C('fabric', 0x6f7646),
    helm: C('splinter', 0x9c9862), cap: C('fabric', 0x8a7a4e), beanie: [0x6f7646, 0xa3522c, 0x6a6258], mask: C('fabric', 0x5c5540),
    pad: C('polymer', 0x5e5340), belt: C('leather', 0x6b5132), strap: C('flat', 0x4b4030), boot: C('leather', 0x7c5834), sole: C('tread', 0x2c2723),
    glove: C('grip', 0x70603f), patch: C('flat', 0x5a3a22), tube: C('metal', 0x7d8250), nade: C('metal', 0x6b7446), med: C('fabric', 0xc9c2ae),
    lens: C('glass', 0xe8a03c, { glow: .4 }), light: C('flat', 0xff5a1e, { glow: 2, edge: 0 }), ink: { tint: PAL.omega, glow: .9 },
    scarf: [0xc45a2c, 0xa8492a, 0xb98a4e, 0x8c3a2a], strips: [0x8a8f4c, 0xc2a266, 0x6b5a3a, 0xa27e48], cape: C('fabric', 0x8f8a52),
  },
];

/** Seeded appearance: everything that differs between two soldiers of the same faction and class. */
function makeLook(team, cls, seed) {
  const r = rng((seed ^ (team * 0x51ed27 + 0x2f6e2b1)) >>> 0), pick = a => a[r() * a.length | 0];
  const L = { team, cls, seed };
  L.h = .955 + r() * .075;                                                                     // height
  L.w = (.94 + r() * .13) * (cls === 'suporte' ? 1.06 : cls === 'recon' ? .96 : 1);          // build
  L.skin = r() * 5 | 0;
  L.head = cls === 'recon' ? (r() < .7 ? 'hood' : pick(['beanie', 'cap'])) : cls === 'suporte' ? pick(['helmet', 'helmet', 'goggles'])
    : pick(['helmet', 'helmet', 'helmet', 'goggles', 'goggles', 'cap', 'cap', 'beanie']);
  L.face = r() < (team ? .25 : .5) ? 'mask' : r() < (team ? .5 : .22) ? 'beard' : 'bare';
  L.scarf = r() < (team ? .68 : .1);
  L.scarfUp = L.scarf && L.face === 'bare' && r() < .35;
  L.sleeves = team === 1 && cls !== 'recon' && r() < .5;
  L.gloves = team === 0 || r() < .6;
  L.pads = team === 0 || r() < .5;
  L.mags = cls === 'recon' ? 2 : 2 + (r() * 2 | 0);
  L.nades = r() * 3 | 0;
  L.side = r() < .5 ? 1 : -1;
  L.mic = r() < .75; L.watch = r() < .5;
  L.hair = pick([0x2a2420, 0x4a3524, 0x191513, 0x6b4a2a, 0x8d877c, 0x7a3b20]);
  L.legs = r() * 3 | 0; L.beanie = r() * 3 | 0; L.scarfC = r() * 4 | 0; L.extra = r() * 16 | 0;
  return L;
}

/** The whole body as kit primitives in the bind pose, one bone per primitive. */
function buildBody(L) {
  const k = new Kit(40, { glow: AMB }), T = L.team, F = FAC[T], W = L.w, cls = L.cls, X = L.extra;
  const r = rng(L.seed ^ 0x9e3779b9), rnd = (a, b) => a + r() * (b - a), pick = a => a[r() * a.length | 0];
  const sk = { tile: TILE.skin, tint: PAL.skin[L.skin], glow: .2 }, skD = { tile: TILE.skin, tint: shade(PAL.skin[L.skin], .7), glow: .16 };
  const hair = { tile: TILE.fabric, tint: L.hair }, eye = { tile: TILE.flat, tint: 0x16120f, edge: 0 };
  const steel = { tile: TILE.metal, tint: PAL.steel }, dark = { tile: TILE.blued, tint: 0x4a4a4c };
  const uni = F.uni, legs = F.legs[L.legs], slim = cls === 'recon', heavy = cls === 'suporte';
  const scarf = { tile: TILE.fabric, tint: F.scarf[L.scarfC % F.scarf.length] };
  const strip = () => ({ tile: TILE.fabric, tint: pick(F.strips), edge: .5 });

  // ---- legs ----
  k.mirror(s => {
    const R = s > 0, ox = .1 + .084 * W;
    k.bone(R ? THIGH_R : THIGH_L);
    k.taper(.168 * W, .47, .188 * W, .1, .715, 0, '-y', .84, legs);
    if (R) {   // drop-leg holster with a pistol
      k.box(.05, .17, .105, ox + .022, .8, -.005, F.pad).box(.032, .07, .05, ox + .022, .905, .022, dark).box(.054, .03, .11, ox + .022, .745, -.005, F.strap);
      k.box(.176 * W, .028, .196 * W, .1, .85, 0, F.strap).box(.166 * W, .026, .186 * W, .1, .745, 0, F.strap);
    } else k.box(.04, .15, .125, ox + .016, .7, .005, legs).box(.046, .045, .135, ox + .016, .765, .005, legs);   // cargo pocket, flap
    k.bone(R ? SHIN_R : SHIN_L);
    k.taper(.138 * W, .3, .152 * W, .1, .38, .004, '-y', .9, legs);
    k.box(.148 * W, .045, .165 * W, .1, .245, .004, legs);                                    // bloused cuff
    if (L.pads || R) k.box(.132, .125, .04, .1, .5, -.088 * W, F.pad).taper(.105, .085, .03, .1, .5, -.088 * W - .034, '-z', .55, F.pad).box(.152 * W, .022, .162 * W, .1, .445, 0, F.strap);
    if (T === 0) k.box(.094, .19, .018, .1, .345, -.076 * W - .006, F.pad).box(.05, .03, .012, .1, .41, -.076 * W - .018, F.gear);   // shin guard
    k.box(.128 * W, .16, .148 * W, .1, .15, .004, F.boot).box(.07, .09, .012, .1, .15, -.074 * W - .004, F.strap);   // boot shaft, laces
    k.bone(R ? FOOT_R : FOOT_L);
    k.box(.12, .075, .2, .1, .058, -.03, F.boot);
    k.taper(.12, .062, .085, .1, .051, -.172, '-z', [.82, .55], F.boot, 0, [0, -.014]);       // toe cap
    k.box(.126, .024, .3, .1, .012, -.066, F.sole).box(.126, .02, .08, .1, .03, .046, F.sole);
  });

  // ---- pelvis, belt ----
  k.bone(HIPS);
  const hz = .109 * W, hx = .1675 * W;
  k.box(.335 * W, .2, .218 * W, 0, .985, 0, legs);
  k.box(.35 * W, .052, .232 * W, 0, 1.078, 0, F.belt).box(.056, .042, .014, 0, 1.078, -hz - .012, steel);
  k.box(.076, .085, .04, .1, 1.03, -hz - .024, F.pouch).box(.08, .026, .044, .1, 1.064, -hz - .024, F.strap);
  k.box(.05, .135, .12, -hx - .026, .995, .03, F.pouch);                                      // dump pouch
  for (let i = 0; i < L.nades; i++) { const gx = -.07 - i * .068; k.cyl('y', .029, .068, gx, 1.022, -hz - .034, F.nade, 6).box(.022, .026, .022, gx, 1.068, -hz - .034, dark); }
  if (X & 1) k.cyl('y', .046, .12, .14, .995, hz + .04, F.roll, 8).cyl('y', .02, .03, .14, 1.07, hz + .04, dark, 6);   // canteen
  else k.box(.1, .09, .05, .12, 1, hz + .03, F.pouch);
  if (cls === 'assalto') k.box(.13, .1, .06, -.1, 1, hz + .034, F.med).decal(TILE.cross, .075, .075, -.1, 1, hz + .0645, '+z', WHITE);   // IFAK
  if (cls === 'engenheiro') {   // tool pouch
    k.box(.1, .16, .07, -.11, .975, hz + .04, F.pouch).box(.016, .09, .022, -.138, 1.08, hz + .04, steel);
    k.box(.014, .07, .014, -.105, 1.075, hz + .052, { tile: TILE.flat, tint: PAL.red }).box(.014, .07, .014, -.082, 1.07, hz + .034, { tile: TILE.flat, tint: PAL.hazard });
  }
  if (heavy) k.box(.17, .15, .04, 0, .975, -hz - .018, F.gear).box(.06, .14, .14, hx + .03, .99, .03, F.pouch);     // groin plate, drum pouch

  k.bone(SPINE).box(.315 * W, .21, .205 * W, 0, 1.17, 0, uni);

  // ---- chest, armour ----
  k.bone(CHEST);
  const cz = .113 * W, pd = heavy ? .06 : .05, pw = heavy ? .32 : .29;
  k.taper(.39 * W, .275, .226 * W, 0, 1.375, 0, '+y', [.8, .86], uni);
  k.box(.15, .05, .15, 0, 1.522, .008, uni);
  k.box(.108, .11, .112, 0, 1.5, .006, L.face === 'mask' ? F.mask : sk);
  let fz, bz;   // front / back surface of the rig
  if (slim) {
    k.box(.39 * W + .016, .1, .226 * W + .016, 0, 1.275, 0, F.gear).box(.24, .17, .022, 0, 1.36, -cz - .008, F.gear);
    k.mirror(() => k.box(.05, .26, .02, .1, 1.39, cz + .006, F.strap));
    fz = -cz - .019; bz = cz + .016;
  } else {
    k.box(pw, .3, pd, 0, 1.335, -cz - pd / 2 + .008, F.gear).box(pw, .31, pd, 0, 1.34, cz + pd / 2 - .008, F.gear);
    k.box(.39 * W + .024, .13, .226 * W + .016, 0, 1.262, 0, F.gear).box(.09, .024, .02, 0, 1.5, cz + pd - .012, F.strap);
    fz = -cz - pd + .008; bz = cz + pd - .008;
  }
  k.mirror(() => k.box(.062, .03, .226 * W + .06, .105, 1.517, 0, F.strap));
  if (T === 0 || heavy) k.mirror(() => {   // shoulder armour stays with the torso and hides the joint
    k.taper(.138 * W, .09, .162 * W, .25, 1.455, 0, '+y', [.72, .8], F.gear);
    if (T === 0) k.box(.014, .034, .056, .25 + .069 * W + .004, 1.44, 0, F.light);
  });
  if (heavy) k.box(.05, .5, .016, 0, 1.365, fz - .006, { tile: TILE.ribs, tint: PAL.brass, turn: 1 }, [0, 0, -.72]);   // ammo belt across the chest
  else if (cls !== 'engenheiro') k.box(.032, .5, .012, 0, 1.365, fz - .004, F.strap, [0, 0, -.72]);                       // sling
  for (let i = 0, n = L.mags, x0 = -(n - 1) * .0445; i < n; i++) { const x = x0 + i * .089; k.box(.08, .135, .05, x, 1.255, fz - .025, F.pouch).box(.054, .04, .028, x, 1.335, fz - .022, dark).box(.084, .028, .054, x, 1.3, fz - .025, F.strap); }
  k.box(.15, .075, .028, 0, 1.432, fz - .014, F.pouch).decal(F.glyph, .06, .06, .04, 1.432, fz - .0285, '-z', F.ink);
  k.box(.056, .022, .006, -.035, 1.436, fz - .03, { tile: TILE.flat, tint: 0xd9d5c9, edge: 0 });                  // name tape
  k.box(.046, .03, .016, L.side * .112, 1.488, fz - .006, F.light);                                               // strap light
  if (X & 2) k.box(.03, .13, .022, -L.side * .118, 1.38, fz - .012, F.pad, [0, 0, L.side * .15]).box(.026, .05, .02, -L.side * .128, 1.468, fz - .012, dark, [0, 0, L.side * .15]);   // knife
  if (X & 4) k.cyl('z', .014, .07, -L.side * .108, 1.5, -cz - .05, dark, 6);                                      // torch
  const rs = -L.side, rx = rs * (heavy ? .205 : .152), rz = heavy ? bz + .12 : bz + .018;
  k.box(.062, .13, .046, rx, 1.385, rz, F.pad).box(.03, .022, .03, rx, 1.46, rz, dark);                           // radio
  k.box(.012, .3, .012, rx + rs * .018, 1.61, rz + .006, F.strap).box(.02, .03, .02, rx + rs * .018, 1.765, rz + .006, F.pad);   // antenna
  if (cls === 'assalto') {   // assault pack with the medic pouch
    k.box(.25, .27, .095, 0, 1.345, bz + .0475, F.pack).taper(.25, .05, .095, 0, 1.505, bz + .0475, '+y', [.8, .6], F.pack);
    k.box(.16, .14, .04, 0, 1.33, bz + .115, F.med).decal(TILE.cross, .11, .11, 0, 1.33, bz + .1355, '+z', WHITE);
    k.mirror(() => k.box(.028, .22, .016, .1, 1.35, bz + .1, F.strap));
    k.box(.07, .03, .014, 0, 1.468, bz + .1, F.light);
  } else if (cls === 'engenheiro') {   // rocket tube across the back
    k.box(.24, .3, .06, 0, 1.34, bz + .03, F.pack);
    k.group(0, 1.37, bz + .11, [0, 0, .9], () => {
      k.cyl('y', .047, .76, 0, 0, 0, F.tube, 8).cyl('y', .056, .07, 0, .365, 0, F.pad, 8).cyl('y', .056, .05, 0, -.375, 0, F.pad, 8);
      k.cyl('y', .05, .05, 0, .17, 0, { tile: TILE.hazard, tint: PAL.hazard }, 8).box(.03, .1, .034, 0, -.12, .056, F.pad);
    });
    k.box(.06, .03, .014, .085, 1.465, bz + .063, F.light);
    k.box(.04, .5, .012, 0, 1.36, fz - .004, F.strap, [0, 0, .72]);
  } else if (heavy) {   // big ammo pack, bedroll, heavier armour
    const pz = bz + .1;
    k.box(.33, .44, .2, 0, 1.33, pz, F.pack);
    k.mirror(() => k.box(.06, .22, .13, .195, 1.25, pz, F.pouch).box(.03, .34, .016, .09, 1.34, pz + .101, F.strap).box(.03, .15, .14, .1, 1.6, pz - .01, F.strap));
    k.box(.23, .17, .055, 0, 1.235, pz + .1275, F.pouch).box(.235, .03, .06, 0, 1.31, pz + .1275, F.strap);
    k.cyl('x', .062, .36, 0, 1.6, pz - .01, F.roll, 8);
    k.box(.07, .2, .016, -.1, 1.43, pz + .104, { tile: TILE.ribs, tint: PAL.brass });
    k.box(.08, .032, .014, .06, 1.49, pz + .104, F.light);
    k.box(.2, .075, .05, 0, 1.54, cz + .012, F.gear).box(.14, .05, .04, 0, 1.522, -cz - .016, F.gear);
  } else {   // recon: slim pack under a ghillie cape
    k.box(.2, .22, .06, 0, 1.33, bz + .03, F.pack).box(.42 * W, .27, .03, 0, 1.4, bz + .066, F.cape, .1);
    for (let i = 0; i < 13; i++) k.box(rnd(.04, .07), rnd(.1, .17), .016, rnd(-.2, .2), rnd(1.2, 1.46), bz + .084 + r() * .02, strip(), [rnd(-.2, .12), 0, rnd(-.4, .4)]);
    k.mirror(() => { for (let i = 0; i < 2; i++) k.box(rnd(.04, .06), rnd(.08, .12), .016, rnd(.08, .2), 1.535, rnd(-.06, .08), strip(), [1.2 + rnd(-.3, .3), 0, rnd(-.4, .4)]); });
    k.box(.06, .028, .014, 0, 1.515, bz + .09, F.light);
  }
  if (L.scarf) {
    k.box(.2, .075, .19, 0, 1.522, .004, scarf).taper(.16, .11, .04, 0, 1.468, fz - .016, '-y', [.5, .8], scarf);
    k.box(.045, .13, .03, L.side * .075, 1.44, fz - .034, scarf, [0, 0, L.side * .25]);
  }

  // ---- head, face ----
  k.bone(HEAD);
  const goggles = L.head === 'goggles', helmet = goggles || L.head === 'helmet';
  k.taper(.18, .216, .196, 0, 1.626, -.004, '-y', [.82, .88], sk);
  k.mirror(() => k.box(.016, .046, .032, .092, 1.632, .004, skD));
  k.box(.03, .046, .022, 0, 1.617, -.106, skD);
  if (goggles) {
    k.box(.192, .062, .03, 0, 1.648, -.106, F.pad).box(.166, .042, .012, 0, 1.648, -.124, F.lens);
    k.mirror(() => k.box(.012, .03, .1, .096, 1.648, -.04, F.strap));
  } else { k.mirror(() => k.box(.036, .022, .012, .046, 1.65, -.1, eye)); k.box(.16, .014, .012, 0, 1.672, -.099, skD); }
  if (L.face === 'mask') k.box(.19, .112, .206, 0, 1.565, -.004, F.mask).box(.19, .08, .206, 0, 1.7, -.004, F.mask).box(.19, .045, .12, 0, 1.64, .04, F.mask);
  else if (L.face === 'beard') { k.box(.172, .07, .06, 0, 1.553, -.066, hair).box(.07, .016, .012, 0, 1.592, -.096, hair); k.mirror(() => k.box(.02, .08, .1, .083, 1.57, -.03, hair)); }
  else if (!L.scarfUp) k.box(.056, .012, .01, 0, 1.573, -.094, { tile: TILE.flat, tint: shade(PAL.skin[L.skin], .5), edge: 0 });
  if (L.scarfUp) k.box(.194, .075, .21, 0, 1.575, -.006, scarf);
  if (!helmet && L.head !== 'hood') { k.box(.184, .1, .05, 0, 1.6, .078, hair); k.mirror(() => k.box(.012, .06, .09, .092, 1.67, .03, hair)); }
  if (helmet) { k.mirror(() => k.box(.012, .1, .022, .094, 1.585, -.03, F.strap)); k.box(.08, .028, .04, 0, 1.52, -.07, F.strap); }   // chin strap
  if (L.head === 'cap') k.mirror(() => k.box(.04, .088, .078, .108, 1.632, .004, F.pad).box(.012, .032, .032, .132, 1.632, .004, T ? F.light : F.pad));   // headset cups
  if ((L.mic || L.head === 'cap') && L.head !== 'hood') {   // boom mic
    if (L.head !== 'cap') k.box(.03, .06, .05, -.103, 1.635, 0, F.pad);
    k.box(.012, .012, .1, -.106, 1.588, -.058, F.pad, .35).box(.024, .022, .028, -.082, 1.57, -.106, F.pad);
  }

  // ---- headgear (its own bone: helmets can be shot off) ----
  k.bone(HELM);
  if (helmet && T === 0) {   // angular shell
    k.taper(.238, .118, .264, 0, 1.73, .008, '+y', [.7, .76], F.helm).box(.238, .078, .172, 0, 1.648, .054, F.helm);
    k.box(.228, .032, .04, 0, 1.676, -.122, F.pad).box(.15, .02, .012, 0, 1.677, -.146, F.light);                 // brow band, visor strip
    k.mirror(() => k.box(.014, .03, .13, .124, 1.705, .012, { tile: TILE.rail, tint: PAL.black }).box(.012, .05, .05, .123, 1.648, .06, F.pad));
    k.box(.052, .042, .022, 0, 1.728, -.118, F.pad, -.25).box(.07, .012, .15, 0, 1.792, .012, F.pad);
    k.box(.05, .022, .012, 0, 1.7, .142, F.light).box(.1, .05, .034, 0, 1.66, .145, F.pad);                        // rear light, battery pack
  } else if (helmet) {   // round dome
    k.ball([.127, .12, .144], 0, 1.672, .008, F.helm, { bot: .5, n: 8, m: 4 });
    k.cyl('y', .15, .026, 0, 1.675, .008, F.strap, { n: 8, oval: .885 }).box(.248, .07, .16, 0, 1.642, .062, F.helm);
    k.box(.04, .03, .016, -.072, 1.712, -.118, F.light).box(.05, .024, .012, 0, 1.69, .151, F.light);
    k.box(.26, .02, .02, 0, 1.715, .118, F.strap);
    if (X & 8 && !goggles) k.box(.2, .05, .03, 0, 1.752, -.1, F.pad, -.5).box(.17, .034, .012, 0, 1.757, -.117, F.lens, -.5);   // goggles pushed up
  } else if (L.head === 'cap') {
    k.box(.2, .078, .212, 0, 1.755, 0, F.cap).box(.176, .016, .09, 0, 1.724, -.148, F.cap, -.1).box(.228, .02, .036, 0, 1.803, .004, F.pad);
    if (T) k.decal(F.glyph, .06, .06, 0, 1.755, -.106, '-z', F.ink); else k.box(.09, .018, .012, 0, 1.752, -.108, F.light);
    k.box(.05, .018, .012, 0, 1.752, .108, F.light);
  } else if (L.head === 'beanie') {
    const b1 = { tile: TILE.fabric, tint: F.beanie[L.beanie] }, b2 = { tile: TILE.fabric, tint: shade(F.beanie[L.beanie], .75) };
    k.taper(.2, .1, .214, 0, 1.745, 0, '+y', [.74, .78], b1).box(.206, .04, .22, 0, 1.703, 0, b2);
    if (T) k.mirror(() => k.box(.016, .03, .04, .108, 1.705, 0, F.light)); else k.box(.05, .02, .012, 0, 1.703, -.116, F.light).box(.05, .02, .012, 0, 1.703, .116, F.light);
  } else {   // ghillie hood
    k.box(.252, .062, .274, 0, 1.768, .014, F.cape).box(.252, .215, .06, 0, 1.662, .122, F.cape).box(.252, .034, .03, 0, 1.742, -.118, F.cape);
    k.mirror(() => k.box(.036, .19, .2, .11, 1.668, .02, F.cape));
    for (let i = 0; i < 10; i++) { const a = rnd(.5, 5.8), x = Math.sin(a) * .135, z = .02 - Math.cos(a) * .14; k.box(rnd(.03, .06), rnd(.07, .13), .016, x, rnd(1.62, 1.78), z, strip(), [rnd(-.3, .3), -a, rnd(-.4, .4)]); }
    k.box(.05, .02, .012, L.side * .06, 1.742, -.136, F.light).box(.05, .02, .012, 0, 1.7, .156, F.light);
  }

  // ---- arms ----
  k.mirror(s => {
    const R = s > 0, ox = .235 + .057 * W;
    k.bone(R ? ARM_R : ARM_L);
    k.taper(.126 * W, .075, .136 * W, .235, 1.442, 0, '+y', [.7, .8], uni);
    k.taper(.114 * W, .32, .124 * W, .235, 1.285, 0, '-y', .88, uni);
    k.box(.01, .085, .085, ox, 1.335, 0, F.patch).decal(F.glyph, .07, .07, ox + .0055, 1.335, 0, '+x', F.ink);       // shoulder patch
    if (T === 1) k.box(.014, .034, .05, ox + .004, 1.245, 0, F.light);                                            // arm light
    if (slim) for (let i = 0; i < 3; i++) k.box(.014, rnd(.08, .13), rnd(.035, .055), ox + .008, rnd(1.22, 1.42), rnd(-.04, .04), strip(), [rnd(-.3, .3), 0, rnd(-.05, .2)]);
    k.bone(R ? FORE_R : FORE_L);
    k.taper(.102 * W, .285, .11 * W, .235, .995, 0, '-y', .84, L.sleeves ? sk : uni);
    if (L.sleeves) k.box(.126 * W, .05, .136 * W, .235, 1.135, 0, uni);
    else if (L.pads) k.box(.118 * W, .1, .05, .235, 1.125, .052 * W, F.pad);
    if (!R && L.watch) k.box(.108 * W, .026, .116 * W, .235, .895, 0, F.pad);
    if (!R && T === 0) k.box(.012, .075, .062, .235 + .051 * W + .004, .965, 0, F.pad).box(.006, .052, .042, .235 + .051 * W + .012, .965, 0, { tile: TILE.screen, tint: PAL.kappa, glow: 1.1, edge: 0 });   // wrist terminal
    k.bone(R ? HAND_R : HAND_L);
    const gl = L.gloves ? F.glove : sk;
    k.taper(.08, .098, .09, .235, .798, -.004, '-y', [.92, .8], gl).box(.028, .05, .038, .203, .806, -.043, gl);
    if (L.gloves) k.box(.092, .034, .1, .235, .856, 0, F.strap).box(.084, .03, .028, .235, .776, -.04, F.pad);
  });
  return k;
}

/** Old box-model guns (one mesh per colour and part): bake everything into one kit-format mesh. */
function bakeGun(gun, mat) {
  const P = [], N = [], C = [], K = [], m = new THREE.Matrix4(), n3 = new THREE.Matrix3(), v = new THREE.Vector3(), list = [];
  gun.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(gun.matrixWorld).invert();
  gun.traverse(o => { if (o.isMesh) list.push(o); });
  for (const o of list) {
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = g.attributes.position, nn = g.attributes.normal, c = o.material.color, em = o.material.emissive;
    const glow = em && em.r + em.g + em.b > 0 ? Math.min(1.5, o.material.emissiveIntensity) : AMB;
    m.multiplyMatrices(inv, o.matrixWorld); n3.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); P.push(v.x, v.y, v.z);
      v.fromBufferAttribute(nn, i).applyMatrix3(n3).normalize(); N.push(v.x, v.y, v.z);
      C.push(c.r, c.g, c.b); K.push(0, glow, 0, 0);
    }
    o.removeFromParent(); o.geometry.dispose(); if (g !== o.geometry) g.dispose();
  }
  const geo = new THREE.BufferGeometry(), F = (a, n) => new THREE.Float32BufferAttribute(a, n);
  geo.setAttribute('position', F(P, 3)); geo.setAttribute('normal', F(N, 3)); geo.setAttribute('uv', F(new Float32Array(P.length / 3 * 2).fill(.5), 2));
  geo.setAttribute('color', F(C, 3)); geo.setAttribute('kit', F(K, 4));
  const mesh = new THREE.Mesh(geo, mat); mesh.userData.baked = true; gun.add(mesh); return mesh;
}

function makeBones() {
  const bones = [];
  for (let i = 0; i < NB; i++) {
    const b = new THREE.Bone(), p = PARENT[i], j = JOINT[i]; b.name = NAMES[i];
    if (p < 0) b.position.set(j[0], j[1], j[2]); else { const q = JOINT[p]; b.position.set(j[0] - q[0], j[1] - q[1], j[2] - q[2]); bones[p].add(b); }
    bones.push(b);
  }
  return bones;
}

// ---- IK --------------------------------------------------------------------------------------
const _e = new THREE.Euler(), _m = new THREE.Matrix4(), _QU = new THREE.Quaternion(), _QL = new THREE.Quaternion(), _W = new THREE.Vector3();
function basis(q, hx, hy, hz, yx, yy, yz) {   // X = hinge, Y = up the limb, Z = X x Y
  _m.set(hx, yx, hy * yz - hz * yy, 0, hy, yy, hz * yx - hx * yz, 0, hz, yz, hx * yy - hy * yx, 0, 0, 0, 0, 1);
  return q.setFromRotationMatrix(_m);
}
/**
 * Analytic two-bone IK. Limbs run along -Y of their bones; the hinge (knee / elbow) is the bones' X axis.
 * A = root joint, T = target for the end joint, pole = direction the middle joint bends towards, Qp = model-space
 * rotation of the parent of `up`, sg = +1 knee / -1 elbow. Leaves the reached end point in _W and the model-space
 * rotation of the lower bone in _QL.
 */
function ik(up, lo, Qp, A, T, l1, l2, pole, sg) {
  let nx = T.x - A.x, ny = T.y - A.y, nz = T.z - A.z, d = Math.hypot(nx, ny, nz);
  if (d < 1e-6) { nx = nz = 0; ny = -1; d = 1e-6; } else { nx /= d; ny /= d; nz /= d; }
  const dMax = (l1 + l2) * .9985, dMin = Math.abs(l1 - l2) + .02; d = d > dMax ? dMax : d < dMin ? dMin : d;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const k = pole.x * nx + pole.y * ny + pole.z * nz; let px = pole.x - k * nx, py = pole.y - k * ny, pz = pole.z - k * nz, pl = Math.hypot(px, py, pz);
  if (pl < 1e-5) { px = -ny; py = nx; pz = 0; pl = Math.hypot(px, py); if (pl < 1e-5) { px = 1; py = 0; pl = 1; } }
  px /= pl; py /= pl; pz /= pl;
  const mx = A.x + nx * a + px * h, my = A.y + ny * a + py * h, mz = A.z + nz * a + pz * h;
  const wx = A.x + nx * d, wy = A.y + ny * d, wz = A.z + nz * d;
  const hx = sg * (ny * pz - nz * py), hy = sg * (nz * px - nx * pz), hz = sg * (nx * py - ny * px);
  basis(_QU, hx, hy, hz, (A.x - mx) / l1, (A.y - my) / l1, (A.z - mz) / l1);
  basis(_QL, hx, hy, hz, (mx - wx) / l2, (my - wy) / l2, (mz - wz) / l2);
  up.quaternion.copy(Qp).invert().multiply(_QU); lo.quaternion.copy(_QU).invert().multiply(_QL);
  _W.set(wx, wy, wz);
}

const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _hg = new THREE.Vector3();
function raise(d, y) { y = clamp(y, -1, 1); const h = Math.hypot(d.x, d.z), k = Math.sqrt(1 - y * y); if (h > 1e-4) { d.x *= k / h; d.z *= k / h; } else d.x = k; d.y = y; }
/**
 * Ground contact for a posed two-bone limb: a middle or end joint that would sink below its clearance (c1, c2,
 * model space, ground at y = 0) is laid on the ground instead. Same conventions as ik().
 */
function settle(up, lo, Qp, A, l1, l2, c1, c2, sg) {
  _QU.multiplyQuaternions(Qp, up.quaternion); _QL.multiplyQuaternions(_QU, lo.quaternion);
  _d1.set(0, -1, 0).applyQuaternion(_QU); _d2.set(0, -1, 0).applyQuaternion(_QL);
  let ch = false;
  if (A.y + l1 * _d1.y < c1) { raise(_d1, (c1 - A.y) / l1); ch = true; }
  const my = A.y + l1 * _d1.y;
  if (my + l2 * _d2.y < c2) { raise(_d2, (c2 - my) / l2); ch = true; }
  if (!ch) return;
  _hg.crossVectors(_d2, _d1).multiplyScalar(sg);
  if (_hg.lengthSq() < 1e-3) { _hg.set(1, 0, 0).applyQuaternion(_QU); _hg.addScaledVector(_d1, -_hg.dot(_d1)); }
  _hg.normalize(); basis(_QU, _hg.x, _hg.y, _hg.z, -_d1.x, -_d1.y, -_d1.z);
  _hg.addScaledVector(_d2, -_hg.dot(_d2)).normalize(); basis(_QL, _hg.x, _hg.y, _hg.z, -_d2.x, -_d2.y, -_d2.z);
  up.quaternion.copy(Qp).invert().multiply(_QU); lo.quaternion.copy(_QU).invert().multiply(_QL);
}

// ---- deaths ----------------------------------------------------------------------------------
// Poses: spine / chest / head are Euler XYZ. Limbs are directions in the parent's frame (chest for arms, hips for
// legs: X right, Y up the spine, Z back). Feet are Euler XYZ in the hips frame. Written for one side, mirrored at random.
const POSE = {
  backAir: { sp: [.12, 0, 0], ch: [.18, 0, 0], hd: [.3, 0, 0], aR: [.5, .3, -.8], fR: [.3, .6, -.6], aL: [-.6, .1, -.75], fL: [-.2, .7, -.5], tR: [.1, -.94, -.34], sR: [0, -.62, .78], tL: [-.12, -.85, -.5], sL: [0, -.75, .65], uR: [.3, 0, 0], uL: [.2, 0, 0] },
  back: { sp: [-.04, 0, .05], ch: [-.06, 0, 0], hd: [-.1, .6, 0], aR: [.9, -.25, .22], fR: [.25, .9, .1], aL: [-.5, -.82, .2], fL: [-.3, -.9, .12], tR: [.18, -1, 0], sR: [.14, -1, .12], tL: [-.15, -.75, -.62], sL: [-.05, -.55, .8], uR: [0, -.5, 0], uL: [-1.3, .2, 0] },
  kneel: { sp: [-.25, 0, 0], ch: [-.3, 0, 0], hd: [-.5, 0, .1], aR: [.15, -.95, -.2], fR: [.05, -.9, -.4], aL: [-.2, -.93, -.25], fL: [-.05, -.85, -.5], tR: [.1, -.913, -.408], sR: [0, -.19, .98], tL: [-.14, -.9, -.42], sL: [0, -.2, .98], uR: [2.9, 0, 0], uL: [2.9, 0, 0] },
  front: { sp: [.05, 0, 0], ch: [.08, 0, 0], hd: [.12, 1, 0], aR: [.35, .85, -.2], fR: [-.3, .9, -.05], aL: [-.75, -.55, -.12], fL: [-.1, .95, -.22], tR: [.15, -1, -.03], sR: [.1, -1, .1], tL: [-.3, -.9, -.03], sL: [-.05, -1, .16], uR: [-.9, -.35, 0], uL: [-1, .5, 0] },
  spinAir: { sp: [.1, .25, 0], ch: [.15, .3, 0], hd: [.2, -.3, 0], aR: [.7, .2, -.5], fR: [.3, .7, -.4], aL: [-.3, -.8, -.4], fL: [.4, -.5, -.7], tR: [.1, -.9, -.4], sR: [0, -.7, .7], tL: [-.1, -.95, -.2], sL: [0, -.8, .55], uR: [.3, 0, 0], uL: [.2, 0, 0] },
  backTwist: { sp: [-.05, -.2, 0], ch: [-.05, -.15, 0], hd: [-.1, -.7, 0], aR: [.1, -.75, -.35], fR: [-.8, -.2, -.1], aL: [-.8, .45, .2], fL: [-.4, .85, .12], tR: [-.35, -.85, -.35], sR: [-.3, -.6, .7], tL: [-.12, -1, 0], sL: [-.2, -.95, .15], uR: [-.6, .3, 0], uL: [0, .5, 0] },
  side: { sp: [-.2, 0, 0], ch: [-.25, 0, 0], hd: [-.2, 0, -.3], aR: [.1, -.3, -.95], fR: [.1, .5, -.85], aL: [.5, -.5, -.7], fL: [.7, -.1, -.7], tR: [0, -.8, -.6], sR: [0, -.5, .85], tL: [.12, -.6, -.8], sL: [.1, -.6, .8], uR: [.4, 0, 0], uL: [.4, 0, 0] },
  fly: { sp: [.25, 0, 0], ch: [.25, 0, 0], hd: [.3, 0, 0], aR: [.8, .5, -.3], fR: [.5, .8, -.2], aL: [-.85, .35, -.4], fL: [-.6, .7, -.1], tR: [.3, -.85, -.4], sR: [.1, -.8, .6], tL: [-.35, -.8, -.5], sL: [-.1, -.6, .8], uR: [.3, 0, 0], uL: [.3, 0, 0] },
};
// hips tracks: [time 0..1, hips height, travel along the fall direction, pitch, roll]
const DEATH = {
  back: { T: .68, K: [[0, .97, 0, 0, 0], [.42, .82, .2, .5, 0], [1, .13, .62, 1.5, 0]], air: 'backAir', end: 'back' },
  front: { T: .95, K: [[0, .97, 0, 0, 0], [.4, .53, -.06, -.2, 0], [.56, .51, -.1, -.4, 0], [1, .17, -.58, -1.42, 0]], air: 'kneel', end: 'front' },
  spin: { T: .85, K: [[0, .97, 0, 0, 0], [.45, .85, .14, .3, -.2], [1, .14, .5, 1.46, -.08]], air: 'spinAir', end: 'backTwist' },
  slump: { T: 1, K: [[0, .97, 0, 0, 0], [.38, .53, .02, -.1, 0], [.56, .5, .02, -.05, -.25], [1, .17, .06, -.1, -1.5]], air: 'kneel', end: 'side' },
};
const PACK_TILT = { assalto: .3, engenheiro: .4, suporte: .6, recon: .2 };   // a body on its back rests on its pack

/** Cubic Hermite through the keys of a hips track (component c), accelerating into the last key. */
function track(K, u, c) {
  const n = K.length - 1; let i = 0; while (i < n - 1 && u > K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1], h = b[0] - a[0], s = clamp((u - a[0]) / h, 0, 1), s2 = s * s, s3 = s2 * s;
  const m0 = i > 0 ? (b[c] - K[i - 1][c]) / (b[0] - K[i - 1][0]) : 0, m1 = i < n - 1 ? (K[i + 2][c] - a[c]) / (K[i + 2][0] - a[0]) : (b[c] - a[c]) / h * 1.4;
  return (2 * s3 - 3 * s2 + 1) * a[c] + (s3 - 2 * s2 + s) * h * m0 + (3 * s2 - 2 * s3) * b[c] + (s3 - s2) * h * m1;
}
// local rotations of a two-bone limb from the directions of its two segments (parent frame)
function limb(qU, qL, dU, dF, mir, sg, zAdd, jit) {
  let ux = dU[0] * mir + jit(), uy = dU[1] + jit(), uz = dU[2] + zAdd + jit(), l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
  let fx = dF[0] * mir + jit(), fy = dF[1] + jit(), fz = dF[2] + zAdd + jit(); l = Math.hypot(fx, fy, fz); fx /= l; fy /= l; fz /= l;
  let hx = sg * (fy * uz - fz * uy), hy = sg * (fz * ux - fx * uz), hz = sg * (fx * uy - fy * ux); l = Math.hypot(hx, hy, hz);
  if (l < .04) { hx = 1 - ux * ux; hy = -ux * uy; hz = -ux * uz; l = Math.hypot(hx, hy, hz) || 1; }   // straight limb: hinge = X made perpendicular
  hx /= l; hy /= l; hz /= l;
  basis(_QU, hx, hy, hz, -ux, -uy, -uz); basis(_QL, hx, hy, hz, -fx, -fy, -fz);
  qU.copy(_QU); qL.copy(_QU).invert().multiply(_QL);
  return _QL;
}
function poseQuats(out, P, mir, zArm, jit) {
  const eul = (a, i) => out[i].setFromEuler(_e.set(a[0], a[1] * mir, a[2] * mir, 'XYZ')), R = mir > 0;
  eul(P.sp, SPINE); eul(P.ch, CHEST); eul(P.hd, HEAD);
  limb(out[R ? ARM_R : ARM_L], out[R ? FORE_R : FORE_L], P.aR, P.fR, mir, -1, zArm, jit);
  limb(out[R ? ARM_L : ARM_R], out[R ? FORE_L : FORE_R], P.aL, P.fL, mir, -1, zArm, jit);
  let q = limb(out[R ? THIGH_R : THIGH_L], out[R ? SHIN_R : SHIN_L], P.tR, P.sR, mir, 1, 0, jit);
  out[R ? FOOT_R : FOOT_L].copy(q).invert().multiply(_QU.setFromEuler(_e.set(P.uR[0], P.uR[1] * mir, P.uR[2] * mir, 'XYZ')));
  q = limb(out[R ? THIGH_L : THIGH_R], out[R ? SHIN_L : SHIN_R], P.tL, P.sL, mir, 1, 0, jit);
  out[R ? FOOT_L : FOOT_R].copy(q).invert().multiply(_QU.setFromEuler(_e.set(P.uL[0], P.uL[1] * mir, P.uL[2] * mir, 'XYZ')));
  out[HAND_R].identity(); out[HAND_L].identity(); out[HELM].identity(); out[HIPS].identity();
}

// ---- shared sprites / materials ----------------------------------------------------------------
let _flashMat = null;
function flashMaterial() {
  if (_flashMat) return _flashMat;
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 1, 16, 16, 15); g.addColorStop(0, '#fff'); g.addColorStop(.35, '#ffd27a'); g.addColorStop(1, 'rgba(255,120,20,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32); x.fillStyle = '#fff3c4';
  for (let i = 0; i < 4; i++) { x.save(); x.translate(16, 16); x.rotate(i * Math.PI / 4 + .3); x.fillRect(-15, -1, 30, 2); x.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  _flashMat = new THREE.SpriteMaterial({ map: t, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  return _flashMat;
}
// Team lights: ONE Points object for every soldier (1 draw call). Two soft halo points per soldier (front and back
// of the head) that never get smaller than a few pixels and are fogged at half strength, so the faction colour
// still reads at 60 m at night.
const LMAX = 96, _v2 = new THREE.Vector2(); let _TL = null;
function teamLights() {
  if (_TL) return _TL;
  const g = new THREE.BufferGeometry(), P = new THREE.BufferAttribute(new Float32Array(LMAX * 3), 3), C = new THREE.BufferAttribute(new Float32Array(LMAX * 4), 4);
  P.setUsage(THREE.DynamicDrawUsage); C.setUsage(THREE.DynamicDrawUsage); g.setAttribute('position', P); g.setAttribute('tint', C);   // tint = rgb, world size (0 = off)
  const m = new THREE.ShaderMaterial({
    uniforms: { px: { value: 400 }, minPx: { value: 2.5 }, fogDensity: { value: .022 } },
    vertexShader: `attribute vec4 tint; varying vec3 vC; uniform float px, minPx, fogDensity;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = max(.3, -mv.z); mv.xyz *= max(0., 1. - .07 / d);   // towards the eye: clears the surface it sits on
        gl_Position = tint.a > 0. ? projectionMatrix * mv : vec4(2., 2., 2., 1.);
        float s = tint.a * px / d, k = clamp(minPx / max(s, .01), 1., 2.2); gl_PointSize = max(s, minPx);
        vC = tint.rgb * k * exp(-fogDensity * fogDensity * d * d * .5); }`,
    fragmentShader: 'varying vec3 vC; void main() { float r = 1. - min(1., length(gl_PointCoord - .5) * 2.); gl_FragColor = vec4(vC * r * r, 1.); }',
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const p = _TL = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 2; p.name = 'teamLights';
  const O = p.userData.owners = new Array(LMAX / 2).fill(null);
  p.onBeforeRender = (r, scene, cam) => {
    const h = r.getDrawingBufferSize(_v2).y; m.uniforms.px.value = h * .5 * cam.projectionMatrix.elements[5]; m.uniforms.minPx.value = Math.max(2, h * .0055);
    if (scene.fog && scene.fog.density) m.uniforms.fogDensity.value = scene.fog.density;
  };
  // Soldiers hidden or removed behind our back lose their lights (they come back with their next update()). This runs
  // in the scene's matrix pass, i.e. before the renderer uploads the buffers of the frame.
  p.updateMatrixWorld = function (force) {
    let ch = false;
    for (let i = 0; i < O.length; i++) { const o = O[i]; if (o && C.array[i * 8 + 3] > 0 && !(o.root.visible && o.root.parent === p.parent)) { C.array[i * 8 + 3] = C.array[i * 8 + 7] = 0; ch = true; } }
    if (ch) C.needsUpdate = true;
    THREE.Points.prototype.updateMatrixWorld.call(this, force);
  };
  return p;
}
const LIGHT_RGB = [[.2, .82, 1], [1, .36, .1]];

const REST = { pos: null, yaw: null, vx: 0, vz: 0, crouch: false, aimPitch: 0, aiming: false, reload01: -1, ammo: null, alive: true };
const qH = new THREE.Quaternion(), qS = new THREE.Quaternion(), qC = new THREE.Quaternion(), QS = new THREE.Quaternion(), QC = new THREE.Quaternion(), QHd = new THREE.Quaternion();
const Qg = new THREE.Quaternion(), Qhr = new THREE.Quaternion(), Qhl = new THREE.Quaternion(), qT = new THREE.Quaternion();
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vD = new THREE.Vector3(), vE = new THREE.Vector3(), vF = new THREE.Vector3(), vG = new THREE.Vector3(), vP = new THREE.Vector3();
const vM = new THREE.Vector3(), vN = new THREE.Vector3(), Ph = new THREE.Vector3(), Pc = new THREE.Vector3(), Pg = new THREE.Vector3(), _c = new THREE.Color();

class Soldier {
  constructor(o) {
    const team = o.team === 1 ? 1 : 0, wid = o.weaponId && WEAPONS[o.weaponId] ? o.weaponId : null;
    const cls = CLS[o.cls] || (wid && CLS[WEAPONS[wid].cls]) || 'assalto';
    const seed = typeof o.seed === 'string' ? hashSeed(o.seed) : o.seed != null ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    this.team = team; this.cls = cls; this.seed = seed; this.world = o.world || null; this.ghost = !!o.ghost;
    const L = this.look = makeLook(team, cls, seed);
    this.root = new THREE.Group(); this.root.name = 'soldier'; this.root.userData.soldier = this;
    if (this.ghost) {
      const m = this.mat = kitMaterial({ unique: true, color: 0x5ff3ff }); m.transparent = true; m.opacity = .55; m.blending = THREE.AdditiveBlending; m.depthWrite = false; m.alphaTest = 0;
      this.ghostBasic = new THREE.MeshBasicMaterial({ color: 0x5ff3ff, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false });
    } else this.mat = kitMaterial({ unique: true });
    this.bones = makeBones();
    const k = buildBody(L);
    this.body = k.skinned(this.bones, this.mat); this.prims = k.prims; this.tris = k.tris;
    this.body.scale.setScalar(L.h);
    this.body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .9, 0), 2.6);   // manual: covers every pose, thrown bodies included
    this.body.frustumCulled = true;
    this.root.add(this.body);
    this.flash = new THREE.Sprite(flashMaterial()); this.flash.visible = false; this.flash.scale.setScalar(.4);
    this.label = null; this.gun = null; this.slot = -1;
    if (!this.ghost) {   // halo points in head space (the head joint is at 0, 1.5, .01 of the model)
      const O = teamLights().userData.owners, hd = L.head, x = L.side * .06; this.slot = O.indexOf(null); if (this.slot >= 0) O[this.slot] = this;
      const lp = hd === 'cap' ? [0, .253, -.12, 0, .252, .1] : hd === 'beanie' ? (team ? [-.118, .205, -.01, .118, .205, -.01] : [0, .203, -.128, 0, .203, .108])
        : hd === 'hood' ? [x, .242, -.148, 0, .2, .148] : team ? [-.072, .212, -.13, 0, .19, .143] : [0, .177, -.158, 0, .2, .134];
      this.lp = [new THREE.Vector3(lp[0], lp[1], lp[2]), new THREE.Vector3(lp[3], lp[4], lp[5])];
    }
    this.A = { t: (seed % 977) * .01, t0: (seed % 613) * .01, ph: (seed % 97) / 97, vf: 0, vr: 0, aim: 0, cr: 0, rl: 0, pitch: 0, rec: 0, fx: 0, fz: 0, ammo: -1, flash: 0, lt: 0, lr: 1, lg: 1, lb: 1 };
    const qs = () => Array.from({ length: NB }, () => new THREE.Quaternion());
    this.D = { on: false, t: 0, q0: qs(), qa: qs(), qb: qs(), p0: new THREE.Vector3(), K: null, gv: new THREE.Vector3(), gw: new THREE.Vector3(), gq: new THREE.Quaternion(), hv: new THREE.Vector3(), hw: new THREE.Vector3() };
    this.dead = false;
    this.setWeapon(wid || CLS_GUN[cls]);
    for (const n of ['update', 'setWeapon', 'muzzleWorld', 'hit', 'die', 'respawn', 'dispose', 'setLabel', 'setOpacity', 'headCenter']) this[n] = this[n].bind(this);
    this.update(0, REST);
  }

  setWeapon(id) {
    const def = WEAPONS[id] || WEAPONS.k7, hand = this.bones[HAND_R];
    if (this.gun) { this.flash.removeFromParent(); this.gun.removeFromParent(); this.gun.traverse(o => { if (o.userData.baked) o.geometry.dispose(); }); }
    const gun = buildGun(def.type, { id, accent: FAC[this.team].accent, lod: 'tp' });
    let n = 0, kit = 0; gun.traverse(o => { if (o.isMesh) { n++; if (o.material && o.material.name === 'kit') kit++; } });
    if (n > 1 && kit < n) bakeGun(gun, this.mat);              // old box-model guns: one mesh, one draw call
    gun.traverse(o => { if (!o.isMesh) return; if (o.material && o.material.name === 'kit') o.material = this.mat; else if (this.ghost) o.material = this.ghostBasic; });
    const H = this.hold = HOLD[def.type] || HOLD.rifle;
    gun.scale.setScalar(GS); gun.quaternion.copy(Q_GUN);
    this.gunPos = new THREE.Vector3(H.grip[0], H.grip[1], H.grip[2]).multiplyScalar(-GS).applyQuaternion(Q_GUN).add(FIST);
    gun.position.copy(this.gunPos); hand.add(gun);
    const mz = gun.userData.muzzle; this.flash.position.set(0, 0, 0);
    if (mz && mz.isObject3D) mz.add(this.flash); else { gun.add(this.flash); if (mz && mz.isVector3) this.flash.position.copy(mz); else this.flash.position.set(0, .03, -.6); }
    this.gun = gun; this.wid = id; this.wdef = def;
    return gun;
  }

  muzzleWorld(out = new THREE.Vector3()) {
    const m = this.flash.parent || this.gun; m.updateWorldMatrix(true, false);
    return out.copy(this.flash.position).applyMatrix4(m.matrixWorld);
  }
  headCenter(out = new THREE.Vector3()) { const h = this.bones[HEAD]; h.updateWorldMatrix(true, false); return out.set(0, .125, -.005).applyMatrix4(h.matrixWorld); }

  hit(dx, dz, k = 1) {
    const A = this.A, l = Math.hypot(dx, dz); if (l < 1e-4) { A.fz = clamp(A.fz + .5 * k, -1.5, 1.5); return; }
    const yaw = this.root.rotation.y, sy = Math.sin(yaw), cy = Math.cos(yaw); k /= l;
    A.fx = clamp(A.fx + (dx * cy - dz * sy) * k, -1.5, 1.5); A.fz = clamp(A.fz + (dx * sy + dz * cy) * k, -1.5, 1.5);
  }

  setLabel(text, css = '#62ecff') {
    if (this.label) { this.label.material.map.dispose(); this.label.material.dispose(); this.label.removeFromParent(); }
    const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d');
    x.font = 'bold 30px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 7; x.strokeStyle = 'rgba(3,9,16,.9)'; x.strokeText(text, 128, 26); x.fillStyle = css; x.fillText(text, 128, 26);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
    const sp = this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
    sp.scale.set(.9, .169, 1); sp.position.y = 2.04 * this.look.h; sp.visible = false; sp.renderOrder = 3; this.root.add(sp);
    return sp;
  }
  setOpacity(o) { this.mat.opacity = o; if (this.ghostBasic) this.ghostBasic.opacity = o * .9; }

  update(dt, s) {
    s = s || REST; dt = dt > .1 ? .1 : dt > 0 ? dt : 0;
    const root = this.root, A = this.A;
    if (s.pos) root.position.set(s.pos.x, s.pos.y, s.pos.z);
    if (this.world && !this.ghost) {   // voxel light probe: darker under roofs, tinted by lamps
      A.lt -= dt;
      if (A.lt <= 0) { A.lt = .18 + (this.seed % 9) * .01; this.world.lightAt(root.position.x, root.position.y + 1.2, root.position.z, _c); A.lr = clamp(_c.r, .6, 1.6); A.lg = clamp(_c.g, .6, 1.6); A.lb = clamp(_c.b, .6, 1.6); }
      const c = this.mat.color, kl = 1 - Math.exp(-dt * 7); c.r += (A.lr - c.r) * kl; c.g += (A.lg - c.g) * kl; c.b += (A.lb - c.b) * kl;
    }
    if (A.flash > 0 && (A.flash -= dt) <= 0) this.flash.visible = false;
    if (this.D.on) this._dead(dt); else { if (s.yaw != null) root.rotation.y = s.yaw; this._pose(dt, s); }
    if (this.slot >= 0) this._lights(this.D.on ? clamp(1 - this.D.t / .45, 0, 1) : 1);
  }
  // world position and strength of the two halo points; they die with the soldier
  _lights(k) {
    const i = this.slot * 2, TL = _TL, P = TL.geometry.attributes.position, C = TL.geometry.attributes.tint, h = this.bones[HEAD], par = this.root.parent, c = LIGHT_RGB[this.team];
    if (par && TL.parent !== par) par.add(TL);
    h.updateWorldMatrix(true, false);
    for (let j = 0; j < 2; j++) { vA.copy(this.lp[j]).applyMatrix4(h.matrixWorld); P.setXYZ(i + j, vA.x, vA.y, vA.z); C.setXYZW(i + j, c[0] * .6, c[1] * .6, c[2] * .6, k > 0 && this.root.visible ? (j ? .13 : .16) * (.4 + .6 * k) : 0); }
    P.needsUpdate = C.needsUpdate = true;
  }

  _pose(dt, s) {
    const A = this.A, B = this.bones, H = this.hold, yaw = this.root.rotation.y, PI = Math.PI;
    const k9 = 1 - Math.exp(-dt * 9), k10 = 1 - Math.exp(-dt * 10);
    A.t += dt;
    A.aim += ((s.aiming ? 1 : 0) - A.aim) * k9; A.cr += ((s.crouch ? 1 : 0) - A.cr) * k9; A.rl += ((s.reload01 >= 0 ? 1 : 0) - A.rl) * k10;
    A.pitch += (clamp(s.aimPitch || 0, -1.1, 1.1) - A.pitch) * k10;
    if (s.ammo != null) {
      if (s.ammo < A.ammo) { A.rec = Math.min(1.5, A.rec + 1); A.flash = .055; this.flash.visible = true; this.flash.scale.setScalar(.34 + Math.random() * .22); this.flash.material.rotation = Math.random() * 6.28; }
      A.ammo = s.ammo;
    }
    A.rec *= Math.exp(-dt * 12); const fd = Math.exp(-dt * 6.5); A.fx *= fd; A.fz *= fd;
    const aim = sstep(0, 1, A.aim), cr = sstep(0, 1, A.cr), rl = sstep(0, 1, A.rl), p = A.pitch * aim, rec = A.rec;

    // ---- locomotion: velocity in model space drives the gait ----
    const sy = Math.sin(yaw), cy = Math.cos(yaw); let vx = s.vx || 0, vz = s.vz || 0; const vl = Math.hypot(vx, vz); if (vl > 6.5) { vx *= 6.5 / vl; vz *= 6.5 / vl; }
    A.vf += (-(vx * sy + vz * cy) - A.vf) * k10; A.vr += ((vx * cy - vz * sy) - A.vr) * k10;
    const spd = Math.hypot(A.vf, A.vr), mv = sstep(.15, .9, spd), still = 1 - mv, run = clamp((spd - 2.3) / 1.7, 0, 1) * (1 - cr);
    const freq = 1.15 + .2 * spd, duty = .62 - .045 * Math.min(spd, 4.5);
    if (spd > .1) A.ph = (A.ph + freq * dt) % 1;
    const amp = Math.min(.27 + .07 * run - .08 * cr, spd * duty / (2 * freq)) * mv;
    const inv = spd > .05 ? 1 / spd : 0, dx = A.vr * inv, dz = inv ? -A.vf * inv : -1, fw = inv ? A.vf * inv : 1;
    const ph = A.ph, c4 = Math.cos(ph * 4 * PI), s2 = Math.sin(ph * 2 * PI), c2 = Math.cos(ph * 2 * PI), breath = Math.sin(A.t * 1.7);

    // ---- torso (model space) ----
    const bl = (.4 + .6 * aim) * (1 - .5 * run), twist = .1 * c2 * mv * fw * (1 - .5 * aim);
    const lean = -.05 - .034 * A.vf * (1 - .45 * aim) - .1 * cr - .06 * aim, roll = -.022 * A.vr - .1 * aim;
    qH.setFromEuler(_e.set(lean * .45 + .1 * A.fz, -.14 * bl + twist, -.011 * A.vr - .06 * A.fx, 'YXZ'));
    qS.setFromEuler(_e.set(lean * .3 + .26 * p + .16 * A.fz - .04 * cr, -.16 * bl - twist * .7, roll * .5 - .12 * A.fx, 'YXZ'));
    qC.setFromEuler(_e.set(lean * .25 + .26 * p + .14 * A.fz + .012 * breath + .03 * rec, -.2 * bl - twist * .7, roll * .5 - .1 * A.fx, 'YXZ'));
    QS.multiplyQuaternions(qH, qS); QC.multiplyQuaternions(QS, qC);
    QHd.setFromEuler(_e.set(p * .95 + .1 * A.fz, Math.sin(A.t * .43 + A.t0) * .3 * (1 - aim) * (1 - .6 * mv), -.1 * aim - .12 * A.fx, 'YXZ'));
    // the hips go wherever they must for the head to sit on its hit sphere
    vA.set(0, .12, 0).applyQuaternion(qH); vB.set(0, .16, 0).applyQuaternion(QS); vC.set(0, .24, .01).applyQuaternion(QC); vD.set(0, .125, -.005).applyQuaternion(QHd);
    // head height in the world: as tall as straight legs allow when relaxed, down on the sights when aiming, 1.2 crouched
    const up = vA.y + vB.y + vC.y + vD.y, hS = this.look.h, yTop = .982, hStand = (yTop + up) * hS;
    const hW = lerp(lerp(hStand, Math.min(hStand, 1.61), aim), 1.2, cr);
    let hy = hW / hS - up - .035 * mv - .03 * run - (.016 + .02 * run) * c4 * mv + .003 * (breath - 1);
    if (hy > yTop) hy = yTop;
    Ph.set(.016 * s2 * mv + .04 * A.fx - (vA.x + vB.x + vC.x + vD.x), hy, .04 * A.fz - (vA.z + vB.z + vC.z + vD.z));
    B[HIPS].position.copy(Ph); B[HIPS].quaternion.copy(qH); B[SPINE].quaternion.copy(qS); B[CHEST].quaternion.copy(qC);
    B[HEAD].quaternion.copy(QC).invert().multiply(QHd);
    Pc.copy(Ph).add(vA).add(vB);

    // ---- gun: low ready / port arms follow the chest, the aim line lives in model space ----
    qT.setFromEuler(_e.set(-.5 + .85 * run, .42 + .5 * run, .12 + .15 * run, 'YXZ')); Qg.multiplyQuaternions(QC, qT);
    qT.setFromEuler(_e.set(A.pitch, .02, -.04, 'YXZ')); Qg.slerp(qT, aim);
    if (rl > .001) { qT.setFromEuler(_e.set(.45, .5, -.5, 'YXZ')).premultiply(QC); Qg.slerp(qT, rl); }
    vE.set(lerp(lerp(.14 + .03 * run, .14, aim), .14, rl), lerp(lerp(.06 - .1 * run, .14, aim), .03, rl), lerp(lerp(-.125, -.115, aim), -.15, rl)).applyQuaternion(QC).add(Pc);   // butt
    vF.set(H.butt[0] * GS, H.butt[1] * GS, H.butt[2] * GS - .035 * rec).applyQuaternion(Qg);
    Pg.copy(vE).sub(vF); Pg.y += .008 * Math.sin(ph * 4 * PI + 1) * mv + .003 * breath;
    if (rec > .001) Qg.multiply(qT.setFromAxisAngle(XA, .05 * rec));

    // ---- right arm: fist on the grip ----
    Qhr.multiplyQuaternions(Qg, Q_GRIP_R);
    vE.set(H.grip[0] * GS, H.grip[1] * GS, H.grip[2] * GS).applyQuaternion(Qg); vF.copy(FIST).applyQuaternion(Qhr); vM.copy(vE).sub(vF);   // gun origin -> wrist
    vE.copy(Pg).add(vM);
    B[ARM_R].position.set(.235, .17 + .012 * aim, .02 * aim);
    vG.copy(B[ARM_R].position).applyQuaternion(QC).add(Pc); vP.set(.55, -.75, .35).applyQuaternion(QC);
    ik(B[ARM_R], B[FORE_R], QC, vG, vE, L_ARM1, L_ARM2, vP, -1);
    B[HAND_R].quaternion.copy(_QL).invert().multiply(Qhr);
    Pg.copy(_W).sub(vM);                                                    // where the gun really is

    // ---- left arm: fist under the handguard, or working the magazine ----
    Qhl.multiplyQuaternions(Qg, Q_GRIP_L);
    vE.set(H.sup[0] * GS - .028, H.sup[1] * GS - .026, H.sup[2] * GS).applyQuaternion(Qg).add(Pg);
    if (rl > .001) {
      let u = s.reload01 >= 0 ? s.reload01 : 1; if (this.wdef.perShell) u = (u * 4) % 1;
      vM.set(H.mag[0] * GS - .02, H.mag[1] * GS - .03, H.mag[2] * GS).applyQuaternion(Qg).add(Pg);
      vN.set(-.1, -.04, -.2).applyQuaternion(QC).add(Pc);                    // pouch on the rig
      vM.lerp(vN, sstep(.2, .4, u) - sstep(.48, .68, u)); vE.lerp(vM, (sstep(.02, .16, u) - sstep(.86, 1, u)) * rl);
    }
    vE.sub(vF.copy(FIST).applyQuaternion(Qhl));
    B[ARM_L].position.set(-.235 + .02 * aim, .17, -.045 * aim);
    vG.copy(B[ARM_L].position).applyQuaternion(QC).add(Pc); vP.set(-.6, -.7, .25).applyQuaternion(QC);
    ik(B[ARM_L], B[FORE_L], QC, vG, vE, L_ARM1, L_ARM2, vP, -1);
    B[HAND_L].quaternion.copy(_QL).invert().multiply(Qhl);

    // ---- legs: feet follow a stance / swing path, knees by IK ----
    const kneel = cr * still, st = still * (.35 + .65 * aim) * (1 - cr), zc = Ph.z + .02;   // the feet stay under the hips, the head over the root
    for (let side = 1; side >= -1; side -= 2) {
      const R = side > 0, pf = R ? ph : (ph + .5) % 1; let al, lift, pit;
      if (pf < duty) { const u = pf / duty; al = 1 - 2 * u; lift = .035 * run * sstep(.7, 1, u); pit = u < .18 ? .22 * (1 - u / .18) : -.5 * sstep(.6, 1, u); }
      else { const u = (pf - duty) / (1 - duty); al = -1 + 2 * u * u * (3 - 2 * u); lift = (.06 + .14 * run + .02 * cr) * Math.sin(PI * Math.pow(u, .8)); pit = -.55 * (1 - u) * (.4 + .6 * run) + .22 * u; }
      pit *= mv * fw;
      let fx = side * (.105 + .02 * aim * still + .06 * Math.abs(dx) * mv) + dx * al * amp * .45, fy = .085 + lift * mv, fz = zc + (R ? .14 * st + .24 * kneel : -.14 * st - .3 * kneel) + dz * al * amp;
      if (R) pit -= .72 * kneel;
      fy += pit < 0 ? -.19 * Math.sin(pit) : .07 * Math.sin(pit);             // the toe (or the heel) stays on the ground
      vE.set(fx, fy, fz);
      vG.set(side * .1, -.04, 0).applyQuaternion(qH).add(Ph);
      vP.set(side * .14, R ? -.4 * kneel : .1 * kneel, -1).applyQuaternion(qH);
      ik(B[R ? THIGH_R : THIGH_L], B[R ? SHIN_R : SHIN_L], qH, vG, vE, L_LEG1, L_LEG2, vP, 1);
      qT.setFromEuler(_e.set(pit, R ? -(.1 + .4 * st) : .1, 0, 'YXZ'));
      B[R ? FOOT_R : FOOT_L].quaternion.copy(_QL).invert().multiply(qT);
    }
  }

  /**
   * info: dx, dz = world direction the killing hit pushes towards; blast = explosion (launched arc); head =
   * headshot (helmet pops); power = damage; room = free metres along the push; variant = force 'back' | 'front' |
   * 'spin' | 'slump' | 'blast'.
   */
  die(info) {
    const D = this.D, B = this.bones, A = this.A, rnd = Math.random; if (D.on) return; info = info || {};
    D.on = true; this.dead = true; D.t = 0; D.ry = this.root.position.y; if (this.label) this.label.visible = false; this.flash.visible = false;
    for (let i = 0; i < NB; i++) D.q0[i].copy(B[i].quaternion);
    D.p0.copy(B[HIPS].position); B[ARM_R].position.set(.235, .17, 0); B[ARM_L].position.set(-.235, .17, 0);
    const yaw = this.root.rotation.y, sy = Math.sin(yaw), cy = Math.cos(yaw);
    let wx = info.dx || 0, wz = info.dz || 0, mx, mz; const wl = Math.hypot(wx, wz), hasDir = wl > 1e-4;
    if (hasDir) { wx /= wl; wz /= wl; mx = wx * cy - wz * sy; mz = wx * sy + wz * cy; } else { const a = rnd() * 6.283; mx = Math.sin(a); mz = Math.cos(a); }
    const al = Math.atan2(mx, mz), aa = Math.abs(al), sg = al < 0 ? -1 : 1, room = info.room != null ? info.room : 3;
    let v = info.variant, fy = 0;
    if (!v) v = info.blast ? 'blast' : !hasDir ? 'slump' : aa < 1 ? (info.head || rnd() < .72 ? 'back' : 'slump') : aa > 2.1 ? 'front' : 'spin';
    D.mir = rnd() < .5 ? 1 : -1; D.blast = v === 'blast';
    let air, end, zArm = 0; const tilt = PACK_TILT[this.cls] || 0;
    if (D.blast) {
      const fwd = aa > 1.571; fy = fwd ? al - sg * Math.PI : al;
      D.vy = 3.4 + rnd() * .9; D.yEnd = fwd ? .145 : .13; D.T = (D.vy + Math.sqrt(D.vy * D.vy + 26 * Math.max(.05, D.p0.y - D.yEnd))) / 13;
      const R = clamp(1.1 + 1.5 * Math.min(1, (info.power || 100) / 120) + rnd() * .5, .3, Math.max(.3, room - .2));
      D.R = fwd ? -R : R; D.slide = (fwd ? -1 : 1) * Math.min(.3, Math.max(0, room - R - .2)); D.pEnd = fwd ? -1.47 : 1.5 - tilt; D.bounce = .09;
      air = POSE.fly; end = fwd ? POSE.front : POSE.back; if (!fwd) zArm = tilt * .6; D.tA = D.T * .3; D.tB = D.T * .7;
    } else {
      const V = DEATH[v] || DEATH.slump; fy = v === 'back' || v === 'slump' ? clamp(hasDir ? al : 0, -.6, .6) : v === 'front' ? clamp(al - sg * Math.PI, -.6, .6) : al + sg * .45;
      if (v === 'spin') D.mir = sg;
      const K = D.K = V.K.map(k => k.slice()), n = K.length - 1, y0 = D.p0.y, back = V.end === 'back' || V.end === 'backTwist';
      K[0][1] = y0; for (let i = 1; i <= n; i++) K[i][1] = Math.min(K[i][1], y0 - .02 * i);
      if (back) { K[n][3] -= tilt; zArm = tilt * .6; }
      const lim = Math.min(1, Math.max(.15, room) / Math.abs(K[n][2] || 1)); for (let i = 1; i <= n; i++) K[i][2] *= lim * (.85 + rnd() * .3);
      D.T = V.T * (.92 + rnd() * .16) * (info.head ? .85 : 1); D.bounce = .035; D.tA = K[1][0] * D.T * 1.1; D.tB = K[n - 1][0] * D.T;
      air = POSE[V.air]; end = POSE[V.end];
    }
    D.fy = fy; D.sx = Math.sin(fy); D.cz = Math.cos(fy);
    poseQuats(D.qa, air, D.mir, 0, () => (rnd() - .5) * .16); poseQuats(D.qb, end, D.mir, zArm, () => (rnd() - .5) * .14);
    // the weapon drops, a helmet may fly
    this.root.updateMatrixWorld(true);
    const g = this.gun; this.root.attach(g); D.gun = 1; D.gv.set(mx * 1.1 + rnd() - .5, 1.4 + rnd(), mz * 1.1 + rnd() - .5); D.gw.set(rnd() * 8 - 4, rnd() * 4 - 2, rnd() * 10 - 5);
    D.helm = 0;
    if (info.head && (this.look.head === 'helmet' || this.look.head === 'goggles')) { this.root.attach(B[HELM]); D.helm = 1; D.hv.set(mx * 2.2 + rnd() - .5, 3 + rnd(), mz * 2.2 + rnd() - .5); D.hw.set(rnd() * 12 - 6, rnd() * 6 - 3, rnd() * 12 - 6); }
    A.rec = 0; A.fx = A.fz = 0;
  }

  _dead(dt) {
    const D = this.D, B = this.bones, t = (D.t += dt), T = D.T, root = this.root;
    if (t < T + .9) {
      const tau = Math.min(1, t / T); let y, d, pitch, roll;
      if (D.blast) {
        const tt = Math.min(t, T); y = Math.max(D.yEnd, D.p0.y + D.vy * tt - 6.5 * tt * tt); d = D.R * tau + D.slide * (1 - Math.exp(-5 * Math.max(0, t - T)));
        pitch = D.pEnd * sstep(0, 1, tau); roll = D.mir * .5 * Math.sin(Math.PI * tau);
      } else { const u = Math.pow(tau, 1.3), K = D.K; y = track(K, u, 1); d = track(K, u, 2); pitch = track(K, u, 3); roll = track(K, u, 4) * D.mir; }
      if (t > T) { const b = Math.min(1, (t - T) / .3), w = Math.sin(Math.PI * b) * (1 - b); y += D.bounce * w; pitch *= 1 - .05 * w; }
      B[HIPS].position.set(D.p0.x + D.sx * d, y, D.p0.z + D.cz * d);
      qT.setFromEuler(_e.set(pitch, D.fy * sstep(0, .7, tau), roll, 'YXZ'));
      B[HIPS].quaternion.copy(D.q0[HIPS]).slerp(qT, sstep(0, .14, t));
      const wa = sstep(0, D.tA, t), wb = sstep(D.tB, T + .12, t);
      for (let i = 1; i < NB; i++) if (i !== HELM || !D.helm) B[i].quaternion.copy(D.q0[i]).slerp(D.qa[i], wa).slerp(D.qb[i], wb);
      // nothing sinks into the ground: limbs that reach it lie down on it
      const qh = B[HIPS].quaternion; QS.multiplyQuaternions(qh, B[SPINE].quaternion); QC.multiplyQuaternions(QS, B[CHEST].quaternion);
      Ph.copy(B[HIPS].position); Pc.set(0, .12, 0).applyQuaternion(qh).add(Ph).add(vA.set(0, .16, 0).applyQuaternion(QS));
      for (let s = 1; s >= -1; s -= 2) {
        const R = s > 0;
        vD.set(s * .235, .17, 0).applyQuaternion(QC).add(Pc); settle(B[R ? ARM_R : ARM_L], B[R ? FORE_R : FORE_L], QC, vD, L_ARM1, L_ARM2, .07, .055, -1);
        vD.set(s * .1, -.04, 0).applyQuaternion(qh).add(Ph); settle(B[R ? THIGH_R : THIGH_L], B[R ? SHIN_R : SHIN_L], qh, vD, L_LEG1, L_LEG2, .085, .08, 1);
      }
    }
    if (D.gun === 1) D.gun = this._drop(this.gun, D.gv, D.gw, dt, .045, 1);
    else if (D.gun === 2) this.gun.quaternion.slerp(D.gq, Math.min(1, dt * 9));
    if (D.helm === 1) D.helm = this._drop(B[HELM], D.hv, D.hw, dt, .075, 0);
    const sink = sstep(5.6, 6.8, t); if (sink > 0) root.position.y = D.ry - sink * .6;
    if (t > 6.8) root.visible = false;
  }
  // free-falling prop in root space; returns 1 while flying, 2 once it rests
  _drop(o, v, w, dt, rest, flat) {
    v.y -= 13 * dt; o.position.addScaledVector(v, dt); o.rotateX(w.x * dt); o.rotateY(w.y * dt); o.rotateZ(w.z * dt);
    if (o.position.y > rest) return 1;
    o.position.y = rest;
    if (v.y < -2.2) { v.y *= -.32; v.x *= .5; v.z *= .5; w.multiplyScalar(.5); return 1; }
    if (flat) { vA.set(0, 0, -1).applyQuaternion(o.quaternion); this.D.gq.setFromEuler(_e.set(0, Math.atan2(-vA.x, -vA.z), Math.random() < .5 ? 1.5 : -1.5, 'YXZ')); }
    return 2;
  }

  respawn() {
    const D = this.D, B = this.bones, A = this.A;
    D.on = false; this.dead = false; D.gun = D.helm = 0;
    const g = this.gun; B[HAND_R].add(g); g.position.copy(this.gunPos); g.quaternion.copy(Q_GUN); g.scale.setScalar(GS);
    const h = B[HELM]; B[HEAD].add(h); h.position.set(0, .16, -.01); h.quaternion.identity(); h.scale.setScalar(1);
    A.vf = A.vr = 0; A.aim = A.cr = A.rl = 0; A.pitch = 0; A.rec = 0; A.fx = A.fz = 0; A.ammo = -1; A.flash = 0; A.lt = 0; this.flash.visible = false;
    this.root.visible = true; this.update(0, REST);
  }

  dispose() {
    if (this.slot >= 0) { const C = _TL.geometry.attributes.tint; C.setW(this.slot * 2, 0); C.setW(this.slot * 2 + 1, 0); C.needsUpdate = true; _TL.userData.owners[this.slot] = null; this.slot = -1; }
    this.root.removeFromParent(); if (this.gun) this.gun.traverse(o => { if (o.userData.baked) o.geometry.dispose(); }); this.body.geometry.dispose(); this.body.skeleton.dispose(); this.mat.dispose(); if (this.ghostBasic) this.ghostBasic.dispose();
    if (this.label) { this.label.material.map.dispose(); this.label.material.dispose(); }
  }
}

/** See the header. The legacy call buildSoldier(team, gunType) returns the root Object3D. */
export function buildSoldier(opts, gunType) {
  if (typeof opts === 'number') {
    const id = Object.keys(WEAPONS).find(k => WEAPONS[k].type === gunType) || 'k7', s = new Soldier({ team: opts, weaponId: id });
    s.root.userData.update = s.update; return s.root;
  }
  return new Soldier(opts || {});
}
export const SOLDIER_BONES = NAMES;
