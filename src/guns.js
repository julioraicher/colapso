// Weapon models: one unique pixel-art model per weapon id, built with the kit (src/kit.js).
// Conventions: metres, the gun points along -Z, origin on the bore line above the pistol grip.
// First person ('fp'): one body mesh plus one mesh per animated part. Third person ('tp'): same
// silhouette and colours with the detail pass skipped and every part baked into ONE mesh.
// Also here: the first-person gloves / forearms and the casing geometry used by the viewmodel.
import * as THREE from 'three';
import { Kit, TILE as T, PAL, kitMaterial, kitText } from './kit.js';

const st = (tile, tint, o) => Object.assign({ tile, tint }, o);
// Shared finishes. The light rigs are strongly blue, so greys stay neutral or slightly warm.
const BLK = st(T.polymer, PAL.black), POL = st(T.polymer, PAL.polymer), GM = st(T.blued, PAL.gunmetal), STL = st(T.metal, PAL.steel),
  DRK = st(T.metal, 0x5c5a57), RAIL = st(T.rail, PAL.black), GRP = st(T.grip, PAL.black), RUB = st(T.flat, PAL.rubber),
  BRS = st(T.metal, PAL.brass), COP = st(T.metal, PAL.copper), HOLE = st(T.flat, 0x0e0e10, { edge: 0 }), WEAR = st(T.worn, PAL.steel, { edge: 0 }),
  WOOD = st(T.wood, PAL.wood), WOODD = st(T.wood, PAL.woodDark), LTH = st(T.leather, PAL.leather), HAZ = st(T.hazard, PAL.hazard);
const AMBER = 0xffb030, GREEN = 0x5dff8a, TRIT = 0x8dffa0;

// ---- small shared pieces --------------------------------------------------------------------
const led = (k, x, y, z, col, face = '+z', s = .004) => k.decal(T.dot, s, s, x, y, z, face, { tint: col, glow: 2 });
const pin = (k, y, z, w, r = .0035, mat = STL) => k.cyl('x', r, w + .002, 0, y, z, mat, 6);
// Cartridge pointing to -Z, centred on (x, y, z).
function round(k, x, y, z, len = .05, r = .0055) {
  k.cyl('z', r, len * .62, x, y, z + len * .19, BRS, 6);
  k.cyl('z', r * .3, len * .38, x, y, z - len * .31, COP, { n: 6, r2: r * .85 });
}
// Raked pistol grip hanging from (0, y, z). The right-hand anchor reuses the same numbers.
function pgrip(k, y, z, D, o) {
  const { w = .032, h = .095, d = .042, rake = -.3, body = BLK, side = GRP } = o || {};
  k.push(0, y, z, rake);
  k.box(w, h, d, 0, -h / 2, 0, body);
  if (D) {
    k.mirror(() => k.box(.003, h * .6, d * .72, w / 2 + .0005, -h * .52, 0, side));   // textured side panels
    k.box(w * .72, h * .55, .004, 0, -h * .5, d / 2 + .001, side);                      // backstrap
    k.box(w + .005, .01, d + .008, 0, -h + .003, .002, body);                           // flared base
    k.box(w * .6, .018, .012, 0, -.006, d / 2 + .004, body);                            // beavertail
  }
  k.pop();
}
// Trigger guard and trigger blade. y = underside of the receiver, z = centre of the guard.
function trig(k, y, z, D, len = .062, mat = BLK) {
  k.box(.01, .005, len, 0, y - .034, z, mat); k.box(.01, .034, .005, 0, y - .017, z - len / 2, mat);
  if (D) k.box(.006, .024, .007, 0, y - .013, z + .01, STL, .3);
}
// Box magazine hanging from its top centre; curve > 0 sweeps the bottom forward. The top cartridge shows once it is out.
function mag(m, w, len, d, curve, body, D, floor, cart = .05) {
  const h = len / 2;
  m.push(0, 0, 0, curve * .5); m.box(w, h + .006, d, 0, -h / 2 + .003, 0, body);
  m.push(0, -h, 0, curve); m.box(w, h, d, 0, -h / 2, 0, body); m.box(w + .004, .01, d + .006, 0, -h + .001, 0, floor || body); m.pop(); m.pop();
  if (D && cart) round(m, 0, .007, -.003, cart, Math.min(.0058, w * .19));
}
// Front post between protective ears: b = surface it stands on, y = sight line (post tip).
function fpost(k, b, y, z, D, mat = BLK, dot) {
  k.box(.022, .006, .018, 0, b + .003, z, mat);
  k.box(.004, y - b, .004, 0, (y + b) / 2, z, mat);
  if (D) { k.mirror(() => k.box(.003, y - b + .007, .012, .0105, (y + b + .007) / 2, z, mat)); if (dot) led(k, 0, y - .0035, z + .002, dot, '+z', .0035); }
}
// Rear notch: two posts level with the sight line, the gap centred on x = 0.
function rnotch(k, b, y, z, D, mat = BLK, dot, gap = .007) {
  k.box(.03, (y - b) * .45, .012, 0, b + (y - b) * .225, z, mat);
  k.mirror(() => k.box(.008, y - b, .008, gap / 2 + .004, (y + b) / 2, z, mat));
  if (D && dot) k.mirror(() => led(k, gap / 2 + .004, y - .0035, z + .004, dot, '+z', .0035));
}
// Hooded holographic sight on a rail whose top is b; the reticle sits at b + .034.
function holo(k, b, z, D, col) {
  k.box(.036, .016, .075, 0, b + .008, z + .008, BLK);                          // base, battery compartment
  k.mirror(() => k.box(.004, .036, .05, .018, b + .032, z, BLK));               // hood walls
  k.box(.04, .004, .054, 0, b + .052, z, BLK);                                  // hood roof
  if (!D) return;
  k.decal(T.ring, .017, .017, 0, b + .034, z - .012, '+z', { tint: col, glow: 2 });
  k.mirror(() => k.cyl('x', .0065, .006, .0205, b + .008, z + .03, STL, 6));    // clamp knobs
  k.box(.022, .009, .004, 0, b + .008, z + .0475, POL);                         // rear buttons
  k.mirror(() => k.box(.002, .004, .05, .0195, b + .049, z, WEAR));             // scuffed hood edges
}
// Tube red dot on a low mount; the dot sits at b + .03.
function reddot(k, b, z, D, col) {
  const y = b + .03;
  k.box(.026, .011, .04, 0, b + .0055, z, BLK);
  k.tube('z', .0195, .0155, .075, 0, y, z, BLK, 8);
  if (!D) return;
  k.tube('z', .0215, .0155, .01, 0, y, z - .0335, GM, 8); k.tube('z', .0215, .0155, .01, 0, y, z + .0335, GM, 8);   // lens bezels
  k.cyl('y', .0065, .012, 0, y + .0235, z + .006, GM, 6); k.cyl('x', .0065, .012, .0235, y, z + .006, GM, 6);       // adjustment turrets
  led(k, 0, y, z - .012, col, '+z', .0055);
  k.mirror(() => k.cyl('x', .005, .005, .0145, b + .006, z, STL, 6));
}
// Open mini reflex: one window hoop; the dot sits at b + .022.
function mini(k, b, z, D, col) {
  k.box(.03, .01, .046, 0, b + .005, z + .008, BLK);
  k.mirror(() => k.box(.004, .026, .008, .014, b + .021, z - .012, BLK)); k.box(.032, .004, .008, 0, b + .036, z - .012, BLK);   // window hoop
  if (!D) return;
  led(k, 0, b + .022, z - .0115, col, '+z', .0055);
  k.box(.012, .005, .012, 0, b + .0125, z + .016, GM); led(k, 0, b + .0152, z + .016, col, '+y', .004);   // emitter
  k.mirror(() => k.cyl('x', .004, .004, .016, b + .005, z + .012, STL, 6));
}
// Telescopic sight on two rings. y = optical axis, b = rail top, z0 = ocular (rear) end.
function scope(k, y, b, z0, len, r, ro, D, body, lens) {
  const zf = z0 - len, zo = len * .2, zt = z0 - len * .45;
  k.cyl('z', r, len, 0, y, z0 - len / 2, body, 8);                                           // main tube
  k.cyl('z', ro, zo, 0, y, zf + zo / 2, body, 8);                                            // objective bell
  k.cyl('z', ro, zo * .5, 0, y, zf + zo * 1.25, body, { n: 8, r2: r });
  k.cyl('z', r * 1.35, len * .16, 0, y, z0 - len * .08, body, 8);                            // ocular
  k.cyl('z', ro * .88, .003, 0, y, zf - .001, st(T.glass, lens, { glow: .4 }), 8);           // coated objective lens
  k.cyl('z', r * 1.15, .003, 0, y, z0 + .001, st(T.glass, 0x33415c, { glow: .12 }), 8);      // ocular lens
  k.cyl('y', r * .8, r * 1.5, 0, y + r * 1.4, zt, body, 8);                                  // elevation turret
  k.cyl('x', r * .8, r * 1.5, r * 1.4, y, zt, body, 8);                                      // windage turret
  for (const z of [z0 - len * .27, z0 - len * .62]) k.box(r * 2 + .008, y + r + .004 - b, .014, 0, (b + y + r + .004) / 2, z, GM);   // rings
  if (!D) return;
  k.cyl('x', r * .7, r * 1.2, -r * 1.3, y, zt, body, 8);                                     // parallax knob
  k.cyl('y', r * .86, .004, 0, y + r * 2.2, zt, st(T.knurl, PAL.steel), 8); k.cyl('x', r * .86, .004, r * 2.2, y, zt, st(T.knurl, PAL.steel), 8);
  k.cyl('z', r * 1.42, .012, 0, y, z0 - len * .18, st(T.knurl, PAL.polymer), 8);             // zoom ring
  k.tube('z', ro * 1.04, ro * .9, .03, 0, y, zf - .012, body, 8);                            // sunshade
}

// ---- the arsenal -----------------------------------------------------------------------------
// Each model receives c (part factory), k (body kit) and D (detail pass on = first person) and returns its spec:
// muzzle, sightY, adsZ, hip, eject, flash, cas, hold (grip anchors), magOut / magGrab, band (accent strip), ...

// K-7: black polymer carbine, tan magazine, hooded holo sight, left-side charging handle.
function k7(c, k, D) {
  const TAN = st(T.ribs, PAL.tan), SLOT = st(T.slots, PAL.black);
  k.box(.044, .05, .29, 0, .015, -.025, GM);                                  // upper receiver
  k.box(.04, .042, .235, 0, -.03, .003, BLK);                                 // lower receiver
  k.box(.043, .05, .07, 0, -.042, -.078, BLK, .08);                           // magazine well
  k.box(.022, .009, .57, 0, .0445, -.155, RAIL);                              // top rail, receiver to handguard tip
  k.cyl('z', .029, .27, 0, .008, -.305, SLOT, { n: 8, smooth: false });       // slotted handguard
  k.cyl('z', .0095, .1, 0, .008, -.485, DRK, 8);                               // barrel
  k.tube('z', .013, .0065, .05, 0, .008, -.555, st(T.slots, 0x5c5a57), 8);    // birdcage flash hider
  k.cyl('z', .014, .2, 0, .014, .22, DRK, 8);                                  // buffer tube
  k.box(.036, .048, .15, 0, .008, .262, BLK);                                 // stock body
  k.box(.03, .02, .13, 0, -.036, .27, BLK, .45);                              // lower strut
  k.box(.04, .12, .018, 0, -.022, .345, RUB);                                 // butt pad
  pgrip(k, -.047, .088, D);
  holo(k, .049, -.02, D, PAL.red);
  c.part('mag', 0, -.062, -.082, m => mag(m, .03, .17, .058, .2, TAN, D, st(T.flat, 0x9a8250)));
  c.part('bolt', -.0225, .024, -.07, b => { b.box(.012, .012, .02, -.006, 0, 0, STL); b.box(.006, .02, .012, -.014, 0, 0, STL); });
  if (D) {
    trig(k, -.051, .035, D);
    k.box(.003, .012, .1, -.0225, .024, -.045, HOLE);                          // charging-handle slot
    k.box(.002, .022, .06, .0225, .018, -.04, HOLE); k.box(.004, .006, .062, .0235, .031, -.04, GM);   // ejection port, dust-cover hinge
    k.box(.008, .016, .016, .024, .014, .0, GM, [0, .5, 0]);                   // case deflector
    pin(k, -.02, -.108, .04); pin(k, -.03, .1, .04); pin(k, .002, .09, .044, .003);
    k.box(.003, .006, .018, -.0215, -.014, .06, STL, .5);                      // selector lever
    k.box(.003, .014, .01, -.0215, -.004, -.03, STL);                          // bolt release
    k.cyl('x', .004, .004, .0215, -.03, -.04, STL, 6);                         // magazine release
    k.mirror(() => k.box(.002, .003, .12, .0205, -.012, .03, HOLE));           // lower panel line
    k.box(.05, .008, .018, 0, .036, .128, DRK);                                // charging latch
    k.cyl('z', .017, .012, 0, .014, .128, STL, 8);                             // castle nut
    k.box(.024, .012, .03, 0, .054, .095, BLK); k.box(.024, .012, .03, 0, .054, -.415, BLK);   // folded backup sights
    k.mirror(() => { for (let i = 0; i < 3; i++) k.box(.002, .008, .04, .0275, .008, -.215 - i * .075, HOLE); });
    k.box(.022, .03, .07, .038, .012, -.33, st(T.polymer, PAL.tan)); led(k, .038, .02, -.2949, GREEN); k.cyl('z', .006, .004, .038, .012, -.367, st(T.glass, PAL.lens), 6);   // laser module, right side
    k.mirror(() => k.box(.002, .003, .22, .0215, .0395, -.03, WEAR));          // worn top edges
    k.box(.032, .012, .1, 0, .036, .25, POL);                                  // cheek rest
    k.text('K-7', .014, -.0222, .014, .055, '-x', PAL.white);
    k.cyl('x', .006, .05, 0, -.012, .3, STL, 6);                               // sling loop
    k.cyl('z', .0105, .012, 0, .008, -.526, STL, 8);                           // crush washer
  }
  return { muzzle: [0, .008, -.582], sightY: .083, adsZ: .135, eject: [.03, .02, -.04], flash: 1, cas: 'rifle', band: [.048, .012, .02, 0, .008, .3],
    magGrab: [0, -.17, -.035], rack: 'l', hold: { r: { p: [0, -.047, .088], rake: -.3 }, l: { pose: 'under', p: [0, -.019, -.3], w: .054 } } };
}

// ARCO B-9: grey-and-teal bullpup, magazine behind the grip, tube red dot on a sight bridge.
function arco(c, k, D) {
  const GRY = st(T.polymer, 0xa7a59f), TEAL = st(T.panel, 0x2a9d93), TEALR = st(T.ribs, 0x2a9d93);
  k.box(.05, .085, .44, 0, -.002, .11, GRY);                                  // main shell, action behind the grip
  k.taper(.05, .07, .2, 0, .002, -.21, '-z', [.72, .7], TEAL, 0, [0, .004]);  // handguard nose
  k.box(.052, .1, .016, 0, -.008, .338, RUB);                                 // butt plate
  k.box(.024, .02, .28, 0, .05, -.03, GRY);                                   // sight bridge
  k.box(.02, .009, .26, 0, .0645, -.03, RAIL);
  k.cyl('z', .009, .12, 0, .006, -.35, DRK, 8);                                // barrel
  k.tube('z', .0125, .007, .045, 0, .006, -.4, DRK, 6);                        // pronged flash hider
  pgrip(k, -.044, -.03, D, { rake: -.22, body: GRY, side: st(T.grip, 0x2a9d93) });
  k.box(.028, .012, .11, 0, -.14, -.07, GRY); k.box(.028, .085, .012, 0, -.095, -.126, GRY, -.12);   // full-hand guard
  reddot(k, .069, -.04, D, GREEN);
  c.part('mag', 0, -.044, .17, m => mag(m, .03, .15, .06, .16, st(T.ribs, PAL.polymer), D, TEAL));
  c.part('bolt', -.026, .03, -.09, b => { b.box(.014, .012, .016, -.006, 0, 0, STL); b.cyl('y', .007, .022, -.015, 0, 0, BLK, 6); });
  if (D) {
    k.box(.006, .024, .007, 0, -.058, -.078, STL, .3);                         // trigger
    k.box(.046, .008, .2, 0, .0425, .22, TEAL);                                // cheek panel
    k.mirror(() => { k.box(.002, .085, .003, .0255, -.002, .06, HOLE); k.box(.002, .003, .27, .0255, .014, .195, HOLE); k.box(.003, .03, .09, .0255, -.02, .26, TEALR); });
    k.box(.002, .022, .06, .0255, .026, .2, HOLE); k.box(.003, .012, .04, .0255, .026, .205, STL);   // ejection port, bolt face
    k.box(.003, .012, .085, -.0255, .03, -.06, HOLE);                          // charging slot
    k.cyl('x', .005, .054, 0, -.022, .03, st(T.flat, PAL.red), 6);             // cross-bolt safety
    k.cyl('x', .006, .054, 0, .02, .3, STL, 6);                                // sling socket
    k.box(.02, .02, .012, 0, -.052, .215, TEAL);                               // magazine catch
    k.box(.02, .03, .012, 0, .03, -.165, GRY);                                 // bridge front leg
    k.text('ARCO B-9', .012, -.0255, -.004, .16, '-x', 0x3a3938);
    k.mirror(() => k.box(.002, .003, .2, .0105, .0595, -.03, WEAR));
    k.cyl('z', .011, .014, 0, .006, -.372, STL, 8);
    k.box(.03, .006, .05, 0, -.037, -.25, RAIL);                               // under-rail stub
  }
  return { muzzle: [0, .006, -.425], sightY: .099, adsZ: .15, eject: [.03, .026, .2], flash: .95, cas: 'rifle', band: [.054, .012, .02, 0, .0, .29],
    magGrab: [0, -.15, -.02], rack: 'l', hold: { r: { p: [0, -.044, -.03], rake: -.22 }, l: { pose: 'under', p: [0, -.03, -.22], w: .046 } } };
}

// VESPA: stubby blowback SMG, vented shroud, long stick magazine, wire stock folded along the right side.
function vespa(c, k, D) {
  const VENT = st(T.vent, 0x5c5a57);
  k.box(.044, .05, .3, 0, .012, -.05, GM);                                    // square-section receiver
  k.box(.038, .04, .17, 0, -.03, .035, BLK);                                  // fire-control housing
  k.box(.04, .07, .05, 0, -.045, -.085, BLK, .04);                            // magazine housing
  k.cyl('z', .021, .1, 0, .012, -.25, VENT, { n: 8, smooth: false });         // vented barrel shroud
  k.cyl('z', .0085, .05, 0, .012, -.32, DRK, 8);                               // barrel stub
  k.tube('z', .012, .0065, .028, 0, .012, -.345, STL, 6);                      // muzzle nut
  k.box(.022, .009, .2, 0, .0415, -.04, RAIL);
  pgrip(k, -.048, .09, D, { rake: -.25 });
  mini(k, .046, -.03, D, AMBER);
  k.box(.03, .04, .025, 0, .008, .112, DRK);                                  // stock hinge
  k.box(.006, .006, .26, .028, .026, -.03, STL); k.box(.006, .006, .26, .028, -.012, -.03, STL);   // folded struts
  k.box(.008, .07, .02, .029, .008, -.165, RUB);                              // butt plate, folded forward
  k.box(.046, .014, .03, 0, .012, -.19, HAZ);                                 // warning band
  c.part('mag', 0, -.072, -.088, m => mag(m, .026, .2, .036, .04, DRK, D, HAZ, .03));
  c.part('bolt', -.0225, .024, -.14, b => { b.cyl('x', .007, .022, -.012, 0, 0, STL, 6); b.box(.006, .01, .014, -.003, 0, 0, STL); });
  if (D) {
    trig(k, -.05, .04, D);
    k.box(.003, .01, .1, -.0225, .024, -.1, HOLE);                             // cocking slot
    k.box(.002, .02, .05, .0225, .018, -.06, HOLE);                            // ejection port
    pin(k, -.02, -.04, .038); pin(k, -.038, .1, .038);
    k.box(.003, .006, .016, -.0195, -.018, .07, st(T.flat, PAL.red), .5);      // selector
    k.mirror(() => k.box(.002, .003, .2, .0215, .0365, -.04, WEAR));
    k.box(.016, .012, .012, 0, .042, .09, BLK);                                // rear lug
    k.text('VESPA', .012, -.0222, .008, .03, '-x', PAL.hazard);
    k.cyl('z', .0225, .008, 0, .012, -.3, STL, 8);
    k.box(.042, .008, .054, 0, -.082, -.087, GM, .04);                         // flared magwell lip
    k.cyl('x', .005, .036, .014, .008, .112, STL, 6);
  }
  return { muzzle: [0, .012, -.362], sightY: .068, adsZ: .14, eject: [.03, .018, -.06], flash: .8, cas: 'pistol', band: [.046, .014, .03, 0, .012, -.19],
    magGrab: [0, -.1, -.004], rack: 'l', hold: { r: { p: [0, -.048, .09], rake: -.25 }, l: { pose: 'grip', p: [0, -.012, -.085], w: .04, d: .05, rake: .04 } } };
}

// FAISCA: white-shelled PDW, see-through magazine laid along the top, ring sight on the nose, thumbhole grips.
function faisca(c, k, D) {
  const WHT = st(T.polymer, 0xd6d2c8), AMB = st(T.glass, 0xe09a2c, { glow: .22 }), DG = st(T.polymer, PAL.polymer);
  k.box(.05, .09, .36, 0, -.005, .02, WHT);                                   // body shell
  k.box(.048, .05, .09, 0, -.07, .16, WHT, -.3);                              // dropped butt
  k.box(.052, .12, .014, 0, -.025, .207, RUB);
  pgrip(k, -.05, .06, D, { rake: -.18, body: WHT, side: st(T.grip, PAL.polymer) });
  k.box(.03, .09, .034, 0, -.092, -.1, WHT, .1); k.box(.03, .014, .17, 0, -.14, -.02, WHT);   // front grip, hand guard
  k.cyl('z', .0085, .06, 0, 0, -.19, DRK, 8); k.cyl('z', .016, .036, 0, 0, -.233, DRK, { n: 8, r2: .011 });   // barrel, cone flash hider
  k.box(.04, .04, .05, 0, .06, -.135, DG);                                    // sight block on the nose
  reddot(k, .08, -.135, D, GREEN);
  c.part('mag', 0, .046, .035, m => {
    if (!D) { m.box(.04, .02, .26, 0, 0, 0, AMB); return; }
    m.mirror(() => m.box(.006, .02, .26, .017, 0, 0, AMB)); m.box(.028, .02, .012, 0, 0, -.124, AMB); m.box(.028, .02, .012, 0, 0, .124, AMB);
    m.box(.028, .004, .236, 0, -.008, 0, st(T.flat, 0x8a5a18));
    for (let i = 0; i < 10; i++) m.cyl('x', .0048, .028, 0, .003, -.104 + i * .023, BRS, 6);
  });
  c.part('bolt', -.0255, .012, -.1, b => b.box(.01, .012, .022, -.005, 0, 0, DG));
  if (D) {
    k.box(.006, .024, .007, 0, -.062, .012, STL, .3);
    k.box(.003, .012, .07, -.0255, .012, -.07, HOLE);
    k.mirror(() => { k.box(.002, .003, .3, .0255, -.02, .02, HOLE); k.box(.002, .05, .003, .0255, .01, .1, HOLE); k.box(.003, .024, .06, .0255, .012, .15, DG); });
    k.box(.03, .003, .06, 0, -.0505, .12, HOLE);                               // downward ejection chute
    k.cyl('x', .005, .054, 0, -.03, .0, st(T.flat, PAL.hazard), 6);            // safety
    k.box(.02, .012, .02, 0, .046, .178, DG);                                  // magazine latch
    k.text('FAISCA', .012, -.0255, -.03, .1, '-x', 0x3a3938);
    k.decal(T.warn, .016, .016, -.0255, -.008, -.11, '-x');
    k.cyl('x', .006, .054, 0, .02, .19, STL, 6);
    k.box(.026, .006, .05, 0, -.053, -.04, RAIL);
  }
  return { muzzle: [0, 0, -.255], sightY: .11, adsZ: .075, eject: [0, -.06, .12], ejectV: [.15, -1.2, .1], flash: .8, cas: 'pistol', band: [.054, .012, .02, 0, .0, .15],
    magOut: [-.2, -.28, .1, 0, .09], magGrab: [-.02, 0, .04], sideGrab: 1, rack: 'l',
    hold: { r: { p: [0, -.05, .06], rake: -.18 }, l: { pose: 'grip', p: [0, -.05, -.1], w: .03, d: .034, rake: .1 } } };
}

// MARTELO 12: pump shotgun, parkerised steel and walnut, ghost-ring sights, shell carrier on the receiver.
function martelo(c, k, D) {
  const PARK = st(T.blued, 0x6c6a66), RED = st(T.flat, PAL.red);
  k.box(.042, .062, .23, 0, 0, .01, PARK);                                    // receiver
  k.cyl('z', .0115, .5, 0, .014, -.355, DRK, 8);                               // barrel
  k.cyl('z', .0105, .44, 0, -.012, -.325, DRK, 8);                             // magazine tube
  k.box(.03, .05, .014, 0, .002, -.5, PARK);                                  // barrel clamp
  k.box(.034, .046, .11, 0, -.03, .165, WOOD, .32);                           // wrist
  k.taper(.038, .12, .2, 0, -.062, .3, '-z', [.9, .5], WOOD, 0, [0, .028]);   // butt
  k.box(.04, .125, .018, 0, -.062, .409, RUB);
  c.part('pump', 0, -.012, -.3, p => {
    p.cyl('z', .024, .15, 0, 0, 0, st(T.ribs, PAL.wood, { turn: 1 }), { n: 8, smooth: false });
    if (D) p.mirror(() => p.box(.003, .008, .16, .013, .004, .15, STL));       // action bars
  });
  c.part('shell', 0, 0, 0, s => { s.cyl('z', .0095, .046, 0, 0, -.006, RED, 6); s.cyl('z', .0102, .012, 0, 0, .023, BRS, 6); });
  k.tube('z', .0125, .0095, .008, 0, .046, .075, PARK, 8); k.box(.01, .008, .016, 0, .0315, .075, PARK);   // ghost ring
  fpost(k, .0255, .046, -.585, D, PARK, 0xff5a2a);
  if (!D) k.box(.008, .05, .1, -.025, .0, .0, RED);
  if (D) {
    trig(k, -.031, .07, D, .06, PARK);
    k.box(.006, .05, .12, -.024, .0, .0, BLK);                                 // shell carrier
    for (let i = 0; i < 5; i++) { k.cyl('y', .009, .04, -.034, .006, -.046 + i * .0225, RED, 6); k.cyl('y', .0097, .012, -.034, -.02, -.046 + i * .0225, BRS, 6); }
    k.box(.002, .022, .07, .0215, .008, -.01, HOLE);                           // ejection port
    k.box(.03, .003, .08, 0, -.0315, -.03, HOLE);                              // loading port
    k.cyl('x', .005, .046, 0, -.012, .1, st(T.flat, PAL.red), 6);              // cross-bolt safety
    k.cyl('z', .0125, .012, 0, -.012, -.551, STL, 8);                          // magazine cap
    k.mirror(() => k.box(.002, .003, .2, .0205, .0295, .01, WEAR));
    k.box(.008, .004, .46, 0, .0275, -.34, st(T.rail, 0x5c5a57));              // ribbed top
    k.mirror(() => k.box(.003, .03, .07, .0165, -.03, .165, st(T.grip, PAL.woodDark), .32));   // chequered wrist
    k.text('MARTELO 12', .011, .0215, -.018, .02, '+x', PAL.white);
    k.cyl('x', .005, .03, 0, -.03, -.5, STL, 6); k.cyl('x', .005, .04, 0, -.1, .37, STL, 6);   // sling swivels
    k.tube('z', .0135, .0095, .008, 0, .014, -.602, STL, 8);
  }
  return { muzzle: [0, .014, -.612], sightY: .046, adsZ: .17, eject: [.03, .01, -.01], flash: 1.7, cas: 'hull', band: [.044, .012, .02, 0, -.03, .36],
    port: [0, -.034, -.03], hold: { r: { p: [0, -.017, .127], rake: .32, stock: 1, w: .034, d: .046 }, l: { pose: 'under', p: [0, -.035, -.3], w: .046 } } };
}

// TROVAO M-100: olive belt-fed LMG. Feed cover (with the holo) hinges at the front, ammo pouch with a live belt,
// carry handle folded right, bipod folded back.
function trovao(c, k, D) {
  const OLV = st(T.panel, PAL.olive), OLP = st(T.polymer, PAL.olive), BOX = st(T.fabric, PAL.khaki), VNT = st(T.vent, PAL.olive);
  k.box(.056, .074, .34, 0, 0, -.03, OLV);                                    // receiver
  k.box(.05, .052, .22, 0, -.004, -.31, VNT);                                 // vented handguard
  k.cyl('z', .013, .44, 0, .012, -.42, DRK, 8);                                // heavy barrel
  k.box(.026, .04, .03, 0, -.002, -.5, GM);                                   // gas block
  k.cyl('z', .019, .06, 0, .012, -.67, DRK, { n: 8, r2: .012 });               // cone flash hider
  k.box(.03, .026, .23, 0, .018, .255, OLP); k.box(.026, .022, .2, 0, -.036, .25, OLP, .14); k.box(.042, .12, .02, 0, -.018, .375, OLP);   // skeleton stock
  pgrip(k, -.037, .09, D);
  k.box(.012, .012, .12, .024, .066, -.27, BLK); k.box(.01, .03, .01, .018, .05, -.22, GM, [0, 0, -.4]); k.box(.01, .03, .01, .018, .05, -.32, GM, [0, 0, -.4]);   // carry handle
  k.box(.03, .02, .02, 0, -.034, -.5, GM); k.mirror(() => k.box(.008, .008, .22, .017, -.04, -.39, DRK));   // bipod
  c.part('cover', 0, .037, -.19, v => {
    v.box(.054, .022, .24, 0, .011, .12, OLV); v.box(.022, .009, .2, 0, .0265, .12, RAIL);
    holo(v, .031, .13, D, PAL.red);
    if (D) { v.box(.03, .008, .02, 0, .012, .245, GM); v.mirror(() => v.box(.002, .003, .22, .0265, .0205, .12, WEAR)); }
  });
  c.part('mag', -.028, -.04, -.07, m => {
    m.box(.075, .095, .12, 0, -.05, 0, BOX);
    if (!D) return;
    m.box(.079, .012, .124, 0, -.006, 0, st(T.fabric, PAL.olive)); m.box(.02, .1, .004, .01, -.05, .061, st(T.molle, PAL.olive));   // lid, strap
    for (let i = 0; i < 5; i++) round(m, -.006, .002 + i * .0185, -.03, .05, .0048);          // belt climbing into the feed tray
    m.box(.004, .09, .018, -.003, .04, -.02, DRK);                             // links
    m.decal(T.warn, .03, .03, -.0375, -.05, .02, '-x'); m.text('100', .016, -.0375, -.05, -.03, '-x', 0x3a3938);
  });
  if (D) {
    trig(k, -.037, .04, D);
    k.box(.042, .004, .1, 0, .039, -.1, STL); round(k, -.004, .046, -.09, .05, .0048);   // feed tray with a round on it
    k.box(.014, .01, .03, .034, .0, -.08, STL); k.cyl('y', .006, .02, .042, 0, -.08, BLK, 6);   // charging handle
    k.box(.002, .02, .06, .0285, -.02, -.04, HOLE);
    pin(k, -.024, -.16, .056); pin(k, -.024, .11, .056); pin(k, .02, .11, .056);
    k.text('M-100', .014, -.0285, -.012, .03, '-x', PAL.sand);
    k.mirror(() => k.box(.012, .012, .02, .017, -.04, -.29, RUB));             // bipod feet
    k.box(.04, .008, .05, 0, .046, .37, GM, -.5);                              // shoulder rest
    k.box(.016, .03, .012, 0, .04, -.5, GM); k.box(.004, .016, .004, 0, .062, -.5, GM);   // front sight
    k.cyl('z', .0155, .012, 0, .012, -.2, STL, 8);                             // barrel latch
    k.mirror(() => k.box(.002, .003, .3, .0285, .0355, -.03, WEAR));
    k.cyl('x', .006, .046, 0, -.03, .37, STL, 6);
  }
  return { muzzle: [0, .012, -.71], sightY: .102, adsZ: .13, hip: [.14, -.16, -.46], eject: [.032, -.02, -.06], flash: 1.25, cas: 'rifle', band: [.046, .012, .02, 0, -.018, .32],
    magGrab: [0, -.1, 0], hold: { r: { p: [0, -.037, .09], rake: -.3 }, l: { pose: 'under', p: [0, -.03, -.31], w: .05 } } };
}

// BIGORNA .30: blued steel and walnut, 60-round drum, finned heavy barrel, club-foot stock.
function bigorna(c, k, D) {
  const BLS = st(T.blued, 0x5f5d5a), RIB = st(T.ribs, 0x5f5d5a, { turn: 1 });
  k.box(.046, .066, .3, 0, 0, -.02, BLS);                                     // stamped receiver
  k.box(.04, .014, .25, 0, .039, -.025, RIB);                                 // ribbed dust cover
  k.box(.044, .042, .19, 0, -.01, -.265, WOOD);                               // lower handguard
  k.box(.036, .024, .17, 0, .03, -.255, WOODD);                               // upper handguard
  k.cyl('z', .012, .5, 0, .01, -.42, DRK, 8);                                  // heavy barrel
  k.cyl('z', .008, .1, 0, .034, -.39, DRK, 6);                                 // gas tube
  k.box(.022, .046, .028, 0, .021, -.45, BLS);                                // gas block
  k.box(.014, .044, .018, 0, .034, -.61, BLS); k.tube('z', .012, .009, .012, 0, .062, -.61, BLS, 8);   // hooded front sight
  k.cyl('z', .015, .05, 0, .01, -.695, DRK, 8);                                // muzzle brake
  k.taper(.038, .07, .22, 0, -.008, .24, '-z', [.9, .7], WOOD, 0, [0, .008]); k.box(.036, .05, .07, 0, -.065, .315, WOOD); k.box(.04, .125, .012, 0, -.03, .356, BLS);   // club-foot stock
  pgrip(k, -.033, .085, D, { body: WOODD, side: st(T.grip, PAL.woodDark) });
  k.box(.022, .009, .12, 0, .0505, 0, RAIL); mini(k, .055, 0, D, AMBER);
  c.part('mag', 0, -.033, -.075, m => {
    m.box(.03, .05, .046, 0, -.012, 0, BLS); m.cyl('x', .064, .058, 0, -.085, 0, BLS, 12);
    if (!D) return;
    m.cyl('x', .05, .066, 0, -.085, 0, DRK, 12); m.cyl('x', .012, .076, 0, -.085, 0, BRS, 6);   // raised faces, winding key
    m.mirror(() => { m.decal(T.ring, .06, .06, .0335, -.085, 0, '+x', 0x2a2a2c); });
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; m.cyl('x', .004, .07, 0, -.085 + Math.sin(a) * .04, Math.cos(a) * .04, STL, 6); }   // rivets
    round(m, 0, .018, -.004, .05, .0055);
  });
  c.part('bolt', .0235, .012, -.06, b => { b.box(.016, .01, .014, .007, 0, 0, STL); b.cyl('y', .006, .022, .017, 0, 0, STL, 6); });
  if (D) {
    trig(k, -.033, .035, D, .062, BLS);
    for (let i = 0; i < 5; i++) k.cyl('z', .018, .006, 0, .01, -.49 - i * .017, DRK, 8);   // cooling fins
    k.box(.003, .012, .1, .0235, .012, -.03, HOLE);
    k.mirror(() => k.box(.002, .012, .03, .0158, .01, -.69, HOLE));             // brake ports
    pin(k, -.01, -.15, .046); pin(k, -.018, .1, .046); pin(k, .012, .11, .046);
    k.box(.003, .01, .03, .0235, -.012, .06, STL, -.2);                        // selector lever
    k.text('BIGORNA', .012, -.0232, .004, .02, '-x', PAL.sand); k.text('.30', .012, -.0232, -.014, .02, '-x', PAL.sand);
    k.mirror(() => k.box(.002, .003, .26, .0225, .0315, -.02, WEAR));
    k.mirror(() => k.box(.003, .02, .1, .0225, -.012, -.265, st(T.slots, PAL.woodDark)));   // handguard vents
    k.box(.012, .012, .012, 0, .05, .085, BLS);                                // rear lug
    k.cyl('x', .005, .044, 0, -.085, .33, STL, 6); k.box(.008, .012, .02, -.02, -.02, -.47, STL);
  }
  return { muzzle: [0, .01, -.725], sightY: .077, adsZ: .15, hip: [.14, -.16, -.46], eject: [.03, .02, -.03], flash: 1.3, cas: 'big', band: [.04, .012, .02, 0, -.004, .3],
    magGrab: [0, -.15, 0], rack: 'r', hold: { r: { p: [0, -.033, .085], rake: -.3 }, l: { pose: 'under', p: [0, -.031, -.27], w: .046 } } };
}

// LANCA DMR: tan chassis, short prism scope with a fibre-optic strip, slim suppressor with a heat wrap.
function lanca(c, k, D) {
  const FDE = st(T.blued, PAL.tan), FDP = st(T.polymer, PAL.tan), SLOT = st(T.slots, PAL.tan), sy = .085;
  k.box(.046, .052, .32, 0, .014, -.03, FDE);                                 // upper
  k.box(.042, .044, .25, 0, -.032, .005, FDE);                                // lower
  k.box(.045, .05, .08, 0, -.044, -.085, FDE, .06);                           // magazine well
  k.box(.022, .009, .62, 0, .0445, -.18, RAIL);
  k.cyl('z', .028, .3, 0, .008, -.34, SLOT, { n: 8, smooth: false });         // handguard
  k.cyl('z', .0105, .14, 0, .008, -.56, DRK, 8);                               // barrel
  k.cyl('z', .018, .19, 0, .008, -.72, st(T.metal, 0x4c4b4a), 8);             // suppressor
  k.cyl('z', .0195, .06, 0, .008, -.69, st(T.fabric, PAL.khaki), 8);           // heat wrap
  k.cyl('z', .014, .1, 0, .014, .18, DRK, 8);
  k.box(.038, .06, .17, 0, 0, .29, FDP); k.box(.034, .034, .1, 0, -.046, .325, FDP); k.box(.04, .13, .02, 0, -.02, .385, RUB);   // fixed precision stock
  k.box(.036, .02, .11, 0, .04, .28, BLK);                                    // cheek riser
  pgrip(k, -.05, .09, D, { rake: -.2 });
  k.box(.03, .016, .1, 0, .057, -.04, BLK);                                   // scope mount
  k.cyl('z', .02, .1, 0, sy, -.04, BLK, 8);                                    // prism housing
  k.cyl('z', .027, .045, 0, sy, -.11, BLK, { n: 8, r2: .021 });                // objective bell
  k.cyl('z', .023, .035, 0, sy, .025, BLK, 8);                                 // ocular
  k.cyl('z', .023, .003, 0, sy, -.1335, st(T.glass, 0xe0622a, { glow: .4 }), 8);
  k.cyl('z', .019, .003, 0, sy, .0435, st(T.glass, 0x33415c, { glow: .12 }), 8);
  c.part('mag', 0, -.064, -.088, m => mag(m, .032, .1, .066, .06, st(T.ribs, PAL.black), D, null, .06));
  if (D) {
    trig(k, -.054, .037, D);
    k.box(.006, .005, .07, 0, sy + .021, -.04, st(T.flat, 0xff5a2a, { glow: .8 }));   // fibre-optic collector
    k.cyl('x', .008, .012, .024, sy, -.03, GM, 6); k.cyl('y', .008, .01, 0, sy + .024, -.002, GM, 6);
    k.mirror(() => { k.cyl('x', .006, .006, .018, .057, -.07, STL, 6); k.cyl('x', .006, .006, .018, .057, -.01, STL, 6); });
    k.box(.002, .024, .07, .0235, .018, -.04, HOLE); k.box(.008, .016, .016, .025, .014, .01, FDE, [0, .5, 0]);
    pin(k, -.022, -.12, .042); pin(k, -.032, .11, .042);
    k.box(.003, .006, .018, -.0225, -.016, .065, STL, .5); k.box(.003, .014, .01, -.0225, -.006, -.035, STL);
    k.mirror(() => { for (let i = 0; i < 3; i++) k.box(.002, .008, .05, .0265, .008, -.24 - i * .085, HOLE); });
    k.mirror(() => k.box(.002, .003, .24, .0225, .0395, -.03, WEAR));
    k.text('LANCA', .013, -.0232, .016, .06, '-x', 0x3a3938);
    k.cyl('z', .012, .014, 0, .008, -.622, STL, 8);
    k.box(.05, .008, .018, 0, .036, .136, DRK); k.cyl('z', .017, .012, 0, .014, .136, STL, 8);
    k.box(.028, .012, .03, 0, .054, -.46, BLK);                                // folded front sight
    k.cyl('y', .008, .014, 0, -.07, .35, STL, 6);                              // monopod stub
    k.cyl('z', .0185, .004, 0, .008, -.815, st(T.flat, 0x1c1c1e), 8);
  }
  return { muzzle: [0, .008, -.82], sightY: sy, adsZ: .15, eject: [.03, .02, -.04], flash: .7, cas: 'big', band: [.04, .012, .02, 0, .0, .34],
    magGrab: [0, -.1, -.01], hold: { r: { p: [0, -.05, .09], rake: -.2 }, l: { pose: 'under', p: [0, -.018, -.34], w: .052 } } };
}

// ORION .338: long green chassis rifle, fluted barrel, three-port muzzle brake, turreted 8x scope, folded bipod.
function orion(c, k, D) {
  const GRN = st(T.blued, PAL.green), GRS = st(T.slots, PAL.green), FLT = st(T.ribs, 0x5c5a57);
  k.cyl('z', .019, .27, 0, .014, -.005, GM, 8);                                // receiver tube
  k.box(.044, .05, .27, 0, -.024, -.005, GRN);                                // chassis
  k.box(.046, .044, .36, 0, -.02, -.32, GRS);                                 // slotted fore-end
  k.cyl('z', .0135, .64, 0, .014, -.46, FLT, 8);                               // fluted heavy barrel
  k.box(.04, .03, .08, 0, .014, -.815, GM);                                   // muzzle brake
  k.box(.022, .009, .3, 0, .0375, -.03, RAIL);
  k.box(.04, .043, .03, 0, -.0235, .145, GM);                                 // stock hinge
  k.box(.03, .024, .24, 0, -.014, .28, GRN); k.box(.026, .02, .23, 0, -.06, .29, GRN, .27);   // skeleton stock
  k.box(.036, .03, .11, 0, .03, .32, BLK);                                    // cheek riser
  k.box(.04, .14, .022, 0, -.035, .411, RUB);
  pgrip(k, -.049, .09, D, { rake: -.15, h: .1 });
  scope(k, .084, .042, .12, .36, .017, .029, D, BLK, 0x9a5cf0);
  k.box(.04, .02, .03, 0, -.046, -.47, GM); k.mirror(() => k.box(.009, .009, .24, .017, -.05, -.6, DRK));   // bipod, folded forward
  c.part('mag', 0, -.049, -.06, m => mag(m, .034, .07, .1, 0, BLK, D, st(T.flat, PAL.polymer), .075));
  c.part('bolt', 0, .014, .06, b => {
    b.cyl('z', .0085, .1, 0, 0, 0, STL, 8); b.cyl('z', .012, .03, 0, 0, .065, GM, 8);       // body, shroud
    b.box(.044, .009, .011, .034, -.006, .035, STL, [0, 0, -.3]); b.ball(.011, .057, -.014, .035, BLK, { n: 6, m: 4 });
  });
  if (D) {
    trig(k, -.049, .04, D);
    k.box(.004, .014, .08, .0175, .02, .0, HOLE);                              // ejection port
    k.mirror(() => { for (let i = 0; i < 3; i++) k.box(.002, .016, .012, .0205, .014, -.79 - i * .022, HOLE); });   // brake ports
    for (let i = 0; i < 3; i++) k.box(.02, .002, .012, 0, .0295, -.79 - i * .022, HOLE);
    k.mirror(() => k.box(.006, .03, .008, .012, .004, .3, GM));                // cheek riser posts
    k.mirror(() => k.box(.012, .012, .02, .017, -.05, -.71, RUB));             // bipod feet
    pin(k, -.03, -.12, .044); pin(k, -.03, .1, .044);
    k.box(.003, .012, .014, -.0225, -.012, .09, STL); k.box(.006, .006, .018, .02, .03, .12, st(T.flat, PAL.red));   // bolt release, safety
    k.text('ORION .338', .013, -.0222, -.024, .0, '-x', PAL.sand);
    k.cyl('z', .016, .014, 0, .014, -.77, STL, 8);
    k.mirror(() => k.box(.002, .003, .24, .0215, .0005, -.005, WEAR));
    led(k, -.012, .101, .0235, GREEN, '+z', .004);                             // bubble level on the rear ring
    k.cyl('y', .007, .03, 0, -.085, .39, STL, 6);                              // monopod
    k.box(.03, .006, .1, 0, -.045, -.36, RAIL);
  }
  return { muzzle: [0, .014, -.86], sightY: .084, adsZ: .21, hip: [.135, -.15, -.45], eject: [.03, .02, .0], flash: 1.6, cas: 'big', band: [.034, .012, .02, 0, -.014, .36],
    magGrab: [0, -.075, 0], knob: [.057, -.014, .035], hold: { r: { p: [0, -.049, .09], rake: -.15 }, l: { pose: 'under', p: [0, -.042, -.3], w: .046 } } };
}

// VIGIA 7.62: walnut-stocked light bolt rifle, blued tapered barrel, slim 5x scope, cartridge loops, flush magazine.
function vigia(c, k, D) {
  const BL = st(T.blued, 0x5a5d68), CHK = st(T.grip, PAL.woodDark);
  k.box(.04, .04, .4, 0, -.014, -.22, WOOD);                                  // fore-end
  k.taper(.04, .04, .05, 0, -.014, -.445, '-z', [.6, .55], WOODD, 0, [0, .004]);   // ebony tip
  k.box(.042, .052, .17, 0, -.014, .06, WOOD);                                // action bedding
  k.box(.034, .044, .1, 0, -.034, .185, WOOD, .38);                           // wrist
  k.taper(.038, .115, .2, 0, -.06, .32, '-z', [.9, .55], WOOD, 0, [0, .03]);  // butt
  k.box(.03, .02, .12, 0, .004, .33, WOOD);                                   // raised comb
  k.box(.04, .12, .016, 0, -.06, .428, RUB);
  k.cyl('z', .016, .25, 0, .014, .005, BL, 8);                                 // receiver
  k.cyl('z', .0078, .5, 0, .014, -.37, BL, { n: 8, r2: .0115 });               // tapered barrel
  scope(k, .064, .03, .1, .28, .0135, .02, D, st(T.blued, 0x55534f), 0x4ad88a);
  c.part('mag', 0, -.04, -.04, m => { m.box(.03, .034, .08, 0, -.012, 0, BL); m.box(.032, .006, .084, 0, -.031, 0, STL); if (D) round(m, 0, .012, -.004, .06, .0055); });
  c.part('bolt', 0, .014, .07, b => {
    b.cyl('z', .0075, .09, 0, 0, 0, STL, 8); b.cyl('z', .0105, .026, 0, 0, .058, BL, 8);
    b.box(.04, .008, .01, .03, -.006, .03, STL, [0, 0, -.35]); b.ball(.01, .05, -.015, .03, STL, { n: 6, m: 4 });
  });
  if (D) {
    trig(k, -.04, .05, D, .06, BL);
    k.box(.004, .012, .07, .0145, .02, -.01, HOLE);
    k.box(.004, .034, .1, -.0225, -.012, .06, LTH);                            // cartridge loops on the near side
    for (let i = 0; i < 4; i++) { k.cyl('y', .0052, .03, -.028, -.006, .028 + i * .022, BRS, 6); k.cyl('y', .0045, .014, -.028, .014, .028 + i * .022, COP, { n: 6, r2: .001 }); }
    k.mirror(() => { k.box(.003, .024, .12, .0195, -.016, -.25, CHK); k.box(.003, .03, .07, .0165, -.034, .185, CHK, .38); });   // chequering
    k.box(.044, .044, .016, 0, -.014, -.36, LTH); k.box(.044, .044, .016, 0, -.014, -.1, LTH);   // leather wraps
    k.cyl('z', .0095, .012, 0, .014, -.616, BL, 8); k.box(.006, .012, .03, 0, .028, -.59, BL); k.cyl('y', .003, .006, 0, .036, -.6, BRS, 6);   // crown, ramp, brass bead
    k.cyl('z', .0145, .006, 0, .064, -.02, BRS, 8);                            // brass scope band
    k.text('VIGIA 7.62', .011, -.0205, -.014, -.17, '-x', 0x2a1a0c);
    k.cyl('x', .005, .03, 0, -.038, -.4, STL, 6); k.cyl('x', .005, .04, 0, -.1, .38, STL, 6);
    k.box(.002, .016, .05, .0215, -.03, .34, BRS);                             // maker's plate
  }
  return { muzzle: [0, .014, -.625], sightY: .064, adsZ: .19, eject: [.03, .02, .0], flash: 1.3, cas: 'big', band: [.044, .014, .02, 0, -.014, -.3],
    magGrab: [0, -.04, 0], knob: [.05, -.015, .03], hold: { r: { p: [0, -.02, .14], rake: .38, stock: 1, w: .034, d: .044 }, l: { pose: 'under', p: [0, -.034, -.24], w: .042 } } };
}

// P9: service pistol, steel slide over a black polymer frame, three-dot night sights.
function p9(c, k, D) {
  const SL = st(T.blued, 0x6a6866), SER = st(T.ribs, 0x6a6866, { turn: 1 });
  k.box(.03, .026, .17, 0, .014, -.058, BLK);                                 // frame, dust cover
  k.box(.03, .03, .05, 0, .01, .045, BLK);
  pgrip(k, .004, .03, D, { w: .03, h: .1, d: .046, rake: -.2 });
  trig(k, .002, -.03, D, .055);
  c.part('bolt', 0, .042, -.045, s => {                                       // slide
    s.box(.031, .03, .2, 0, 0, 0, SL);
    s.box(.005, .007, .008, 0, .0185, -.09, BLK); s.mirror(() => s.box(.007, .007, .008, .0075, .0185, .09, BLK));
    s.cyl('z', .0065, .012, 0, -.002, -.097, STL, 8);
    if (!D) return;
    s.mirror(() => s.box(.002, .022, .035, .0158, -.001, .075, SER));          // rear serrations
    s.box(.014, .003, .04, .004, .0145, -.01, HOLE); s.box(.011, .002, .03, .004, .015, -.012, STL);   // ejection port, barrel hood
    s.mirror(() => s.box(.002, .003, .2, .0146, .0145, 0, WEAR));
    s.text('P9', .011, -.0158, .002, -.03, '-x', PAL.white);
    led(s, 0, .019, -.0859, TRIT); s.mirror(() => led(s, .0075, .019, .0941, TRIT));
  });
  c.part('mag', 0, 0, .034, m => {
    m.push(0, 0, 0, -.2); m.box(.022, .11, .034, 0, -.055, 0, DRK); m.box(.028, .01, .044, 0, -.112, -.002, BLK);
    if (D) round(m, 0, .004, -.004, .028, .0045); m.pop();
  });
  if (D) {
    k.box(.002, .006, .03, -.0155, .024, -.01, STL); k.box(.002, .008, .012, -.0155, .014, -.06, STL);   // slide stop, takedown lever
    k.cyl('x', .004, .032, 0, .002, -.004, STL, 6);
    k.box(.02, .006, .05, 0, -.002, -.11, RAIL);                               // light rail
    k.cyl('x', .003, .032, 0, .012, .058, STL, 6);
  }
  return { muzzle: [0, .04, -.152], sightY: .064, adsZ: .29, hip: [.085, -.11, -.37], eject: [.02, .056, -.02], flash: .6, cas: 'pistol', band: [.032, .008, .03, 0, .014, -.12],
    magOut: [0, -.3, .06, 0, 0], magGrab: [0, -.1, .02], travel: .04, slideLock: 1, fam: 'pistol',
    hold: { r: { p: [0, .004, .03], rake: -.2, w: .03, d: .046 }, l: { pose: 'wrap' } } };
}

// JUIZ .44: big stainless revolver, fluted six-shot cylinder, vent-rib barrel with a full underlug, walnut grips.
function juiz(c, k, D) {
  const SS = st(T.metal, PAL.steel), SSD = st(T.metal, 0x8a8782);
  k.box(.02, .012, .13, 0, .0725, -.012, SS);                                 // top strap
  k.box(.03, .07, .03, 0, .042, .05, SS);                                     // recoil shield
  k.box(.022, .014, .12, 0, .004, -.015, SS);                                 // frame under the cylinder
  k.box(.026, .074, .022, 0, .041, -.076, SS);                                // yoke
  k.cyl('z', .012, .17, 0, .056, -.172, SS, 8);                                // barrel
  k.box(.016, .028, .165, 0, .033, -.17, SS);                                 // full underlug
  k.box(.01, .01, .17, 0, .073, -.172, st(T.vent, PAL.steel));                // vent rib
  pgrip(k, .0, .055, D, { w: .032, h: .105, d: .048, rake: -.38, body: WOOD, side: st(T.grip, PAL.woodDark) });
  trig(k, -.003, -.005, D, .05, SS);
  k.box(.006, .012, .03, 0, .084, -.24, GM);                                  // ramp front sight
  rnotch(k, .0785, .09, .045, D, GM, PAL.white);
  c.part('cyl', 0, .04, -.018, y => {
    y.cyl('z', .026, .06, 0, 0, 0, SS, 12);
    if (!D) return;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, b = a + Math.PI / 6;
      y.box(.011, .004, .036, Math.cos(a) * .0252, Math.sin(a) * .0252, -.01, SSD, [0, 0, a + Math.PI / 2]);   // flutes
      y.cyl('z', .0062, .003, Math.cos(b) * .0165, Math.sin(b) * .0165, .0305, BRS, 6);                        // cartridge heads
    }
    y.cyl('z', .006, .004, 0, 0, .031, SSD, 6);
  });
  if (D) {
    k.box(.008, .022, .012, 0, .068, .072, SSD, -.6);                            // hammer spur
    k.box(.006, .004, .006, 0, .0885, -.232, st(T.flat, PAL.red, { glow: .5 }));   // red ramp insert
    k.cyl('z', .005, .1, 0, .024, -.14, SSD, 6);                               // ejector rod
    k.cyl('x', .005, .034, 0, -.05, .075, BRS, 6);                             // grip medallion
    k.box(.004, .012, .016, -.014, .03, .04, SSD);                             // cylinder latch
    k.text('.44', .012, -.0085, .033, -.17, '-x', 0x3a3938);
    k.mirror(() => k.box(.002, .003, .12, .0095, .078, -.012, WEAR));
    k.cyl('z', .0125, .006, 0, .056, -.257, SSD, 8);
  }
  return { muzzle: [0, .056, -.262], sightY: .09, adsZ: .29, hip: [.085, -.118, -.38], flash: 1.3, cas: null, dump: 6, band: [.018, .008, .05, 0, .033, -.2], fam: 'pistol',
    hold: { r: { p: [0, .0, .055], rake: -.38, w: .032, d: .048 }, l: { pose: 'wrap' } } };
}

// RAJADA MP: tan-framed machine pistol, skeletonised slide, compensator, long magazine, fold-down stub foregrip.
function rajada(c, k, D) {
  const TN = st(T.polymer, PAL.tan), SL = st(T.blued, 0x55534f);
  k.box(.032, .028, .2, 0, .012, -.07, TN);                                   // long frame
  k.box(.032, .03, .05, 0, .01, .047, TN);
  pgrip(k, .004, .03, D, { w: .032, h: .1, d: .048, rake: -.16, body: TN, side: st(T.grip, PAL.khaki) });
  trig(k, .0, -.03, D, .058, TN);
  k.box(.022, .06, .026, 0, -.03, -.125, BLK, .12);                           // stub foregrip
  k.cyl('z', .0085, .07, 0, .04, -.195, STL, 8);                               // extended barrel
  k.box(.026, .028, .045, 0, .042, -.215, SL);                                // compensator
  c.part('bolt', 0, .042, -.05, s => {
    s.box(.033, .03, .21, 0, 0, 0, SL);
    s.box(.005, .007, .008, 0, .0185, -.095, BLK); s.mirror(() => s.box(.007, .007, .008, .008, .0185, .095, BLK));
    if (!D) return;
    for (let i = 0; i < 3; i++) s.box(.014, .003, .026, 0, .0145, -.06 + i * .04, HOLE);   // lightening cuts
    s.mirror(() => { s.box(.002, .022, .03, .0168, -.001, .08, st(T.ribs, 0x55534f, { turn: 1 })); s.box(.002, .003, .21, .0156, .0145, 0, WEAR); });
    s.text('RAJADA', .01, -.0168, .002, -.03, '-x', PAL.sand);
    led(s, 0, .019, -.0909, AMBER); s.mirror(() => led(s, .008, .019, .0991, AMBER));
  });
  c.part('mag', 0, 0, .033, m => {
    m.push(0, 0, 0, -.16); m.box(.024, .2, .036, 0, -.1, 0, st(T.ribs, 0x5c5a57)); m.box(.03, .012, .046, 0, -.2, -.002, TN);
    if (D) round(m, 0, .004, -.004, .028, .0045); m.pop();
  });
  if (D) {
    k.box(.002, .008, .016, -.0165, .024, .04, st(T.flat, PAL.red), .4);       // fire selector
    k.mirror(() => { for (let i = 0; i < 2; i++) k.box(.002, .01, .012, .0135, .046, -.205 - i * .018, HOLE); });   // compensator ports
    k.box(.014, .002, .03, 0, .0565, -.215, HOLE);
    k.cyl('x', .004, .024, 0, -.003, -.122, STL, 6);                           // foregrip hinge
    k.box(.002, .006, .03, -.0165, .024, -.01, STL); k.cyl('x', .004, .034, 0, .002, -.004, STL, 6);
    k.box(.02, .006, .04, 0, -.004, -.075, RAIL);
  }
  return { muzzle: [0, .042, -.242], sightY: .064, adsZ: .29, hip: [.085, -.11, -.37], eject: [.02, .056, -.02], flash: .7, cas: 'pistol', band: [.034, .008, .03, 0, .012, -.15],
    magOut: [0, -.3, .05, 0, 0], magGrab: [0, -.12, .02], travel: .04, slideLock: 1, fam: 'pistol',
    hold: { r: { p: [0, .004, .03], rake: -.16, w: .032, d: .048 }, l: { pose: 'grip', p: [0, -.006, -.127], w: .022, d: .026, rake: .12 } } };
}

// RPG-Q: olive launch tube, wooden heat shield, flared venturi, iron sights on the near side, hazard-banded rocket.
function rpg(c, k, D) {
  const X = .055, OL = st(T.metal, PAL.olive), GRN = st(T.flat, PAL.green);
  k.cyl('z', .032, .9, X, 0, -.05, OL, 10);                                    // launch tube
  k.cyl('z', .037, .26, X, 0, .06, WOOD, 10);                                  // wooden heat shield
  k.cyl('z', .034, .14, X, 0, .47, OL, { n: 10, r2: .056 });                   // flared venturi
  k.tube('z', .039, .031, .03, X, 0, -.5, OL, 10);                             // muzzle collar
  k.push(X, 0, 0); pgrip(k, -.03, 0, D, { rake: -.18 }); trig(k, -.031, -.05, D, .06, GM); k.box(.03, .09, .036, 0, -.075, -.22, WOOD, -.05); k.pop();
  k.box(.05, .012, .016, .022, .03, .05, GM); rnotch(k, .036, .075, .05, D, GM, PAL.white, .009);   // rear leaf on x = 0
  k.box(.05, .012, .016, .022, .03, -.3, GM); fpost(k, .036, .075, -.3, D, GM, PAL.white);
  c.part('rocket', X, 0, -.5, r => {
    r.cyl('z', .044, .09, 0, 0, -.06, GRN, { n: 8, r2: .028 }); r.cyl('z', .044, .07, 0, 0, -.14, GRN, 8);
    r.cyl('z', .012, .13, 0, 0, -.24, GRN, { n: 8, r2: .044 }); r.cyl('z', .008, .03, 0, 0, -.32, STL, 6);
    r.cyl('z', .0455, .018, 0, 0, -.13, HAZ, 8);
    if (D) r.cyl('z', .02, .12, 0, 0, .05, DRK, 6);
  });
  if (D) {
    k.cyl('z', .0385, .012, X, 0, -.06, GM, 10); k.cyl('z', .0385, .012, X, 0, .18, GM, 10);   // shield bands
    k.cyl('z', .0335, .014, X, 0, -.3, GM, 10); k.cyl('z', .0335, .014, X, 0, .3, GM, 10);
    k.text('RPG-Q', .016, X - .033, .002, -.19, '-x', PAL.sand);
    k.decal(T.warn, .026, .026, X - .033, 0, .3, '-x'); k.decal(T.arrow, .022, .022, X - .033, 0, .37, '-x', PAL.hazard, [-Math.PI / 2, 0, 0]);
    k.cyl('x', .005, .02, X - .038, -.01, -.4, STL, 6); k.cyl('x', .005, .02, X - .038, -.01, .36, STL, 6);   // sling loops
    k.box(.03, .008, .04, X, -.118, -.214, GM);
    k.cyl('z', .03, .002, X, 0, -.512, HOLE, 10);                              // dark bore behind the rocket
  }
  return { muzzle: [X, 0, -.53], sightY: .075, adsZ: .22, hip: [.11, -.13, -.44], flash: 1.9, cas: null, band: [.076, .076, .02, X, 0, .35],
    hold: { r: { p: [X, -.03, 0], rake: -.18 }, l: { pose: 'grip', p: [X, -.036, -.222], w: .03, d: .036, rake: -.05 } } };
}

// Combat knife (melee): clip-point blade with a ground edge, steel guard, ribbed handle.
function knife(c, k, D) {
  k.box(.004, .034, .17, 0, 0, -.105, STL);
  k.taper(.004, .034, .05, 0, 0, -.215, '-z', [1, .08], STL, 0, [0, -.014]);
  k.box(.0046, .008, .16, 0, -.0135, -.1, st(T.metal, PAL.chrome));           // ground edge
  k.box(.012, .06, .012, 0, 0, -.014, GM);                                    // guard
  k.box(.022, .028, .1, 0, 0, .045, st(T.ribs, PAL.black, { turn: 1 }));
  k.box(.024, .032, .014, 0, 0, .1, GM);
  if (D) { k.box(.0048, .005, .1, 0, .007, -.09, DRK); k.cyl('x', .004, .026, 0, 0, .1, HOLE, 6); k.decal(T.kappa, .014, .014, -.011, 0, .045, '-x', PAL.kappa); }
  return { muzzle: [0, 0, -.24], sightY: .05, adsZ: .3, flash: 0, cas: null, fam: 'pistol', hold: { r: { p: [0, .014, .045], rake: -1.35, w: .022, d: .028 } } };
}

const MODELS = { k7, arco, vespa, faisca, martelo, trovao, bigorna, lanca, orion, vigia, p9, juiz, rajada, rpg, knife };
const BY_TYPE = { rifle: 'k7', bullpup: 'arco', smg: 'vespa', pdw: 'faisca', shotgun: 'martelo', lmg: 'trovao', lmg2: 'bigorna', dmr: 'lanca', sniper: 'orion', sniper2: 'vigia',
  pistol: 'p9', revolver: 'juiz', mpistol: 'rajada', launcher: 'rpg', knife: 'knife' };
for (const s of ['K-7', 'ARCO B-9', 'VESPA', 'FAISCA', 'MARTELO 12', '100', 'M-100', 'BIGORNA', '.30', 'LANCA', 'ORION .338', 'VIGIA 7.62', 'P9', '.44', 'RAJADA', 'RPG-Q']) kitText(s);   // reserve atlas space at load

/**
 * buildGun(type, { id, sight, accent, lod }) -> THREE.Group pointing along -Z.
 * id picks the model (falls back to the type's default), lod 'fp' (default) or 'tp' (one merged mesh),
 * accent adds a small team-coloured band. userData: muzzle (Object3D), sightY, adsZ, hold, body and the
 * animated parts that exist (mag, bolt, cover, cyl, rocket, pump, shell), each with userData.home / homeR.
 */
export function buildGun(type, opts = {}) {
  const id = MODELS[opts.id] ? opts.id : BY_TYPE[type] || 'k7', fp = opts.lod !== 'tp';
  const g = new THREE.Group(), U = g.userData, k = fp ? new Kit(96) : new Kit(64, { glow: .1 });   // bots' guns stay readable in the dark
  const c = {
    // Animated part: its own mesh in first person, baked into the body for the third-person LOD.
    part(name, x, y, z, fn) {
      if (!fp) { k.push(x, y, z); fn(k); k.pop(); return; }
      const kp = new Kit(96); fn(kp); const m = kp.mesh(g, x, y, z); m.userData.keep = true; U[name] = m;
    },
  };
  const spec = MODELS[id](c, k, fp);
  if (opts.accent != null && spec.band) { const b = spec.band; k.box(b[0], b[1], b[2], b[3], b[4], b[5], st(T.flat, opts.accent, { glow: .5 })); }
  const body = k.mesh(g); body.userData.keep = true;     // keep: weapons.flatten() must not re-merge kit meshes
  const mz = new THREE.Object3D(); mz.position.fromArray(spec.muzzle); g.add(mz);
  Object.assign(U, spec, { id, muzzle: mz, body });
  return g;
}

// ---- first-person gloves and forearms -----------------------------------------------------------
const GLV = st(T.fabric, 0x857f68, { edge: 1 }), PAD = st(T.carbon, 0x4a4947), CUF = st(T.ribs, 0x3a3936, { turn: 1 }), SLV = st(T.ripstop, 0x5d5b55), PALM = st(T.leather, 0x5e4c3a);
// Hand wrapped around a grip (w wide, d deep). Origin = top centre of the gripped section, fingers stacked downward.
// side +1 = right hand (palm on +X), -1 = left. trigger: index finger laid along the frame. fwd: support hand closed over
// the firing hand, thumb forward. stock: the fist lies along a straight stock wrist (hollow along +Z, thumb over the top).
function handGrip(k, side, w, d, trigger, fwd, stock) {
  const px = w / 2;
  k.push(0, 0, 0, stock ? -Math.PI / 2 : 0, [side, 1, 1]);
  if (fwd) k.box(.038, .08, d + .02, px + .005, -.034, .004, GLV);            // support palm, flush against the firing hand's fingertips
  else {
    k.box(.024, .08, d + .02, px + .012, -.034, .004, GLV);                   // palm and back of the hand
    k.box(w + .028, stock ? .02 : .026, .02, .01, -.012, d / 2 + .01, GLV);   // web of the thumb
    if (!stock) k.box(w + .016, .05, .018, .012, -.05, d / 2 + .009, GLV);    // heel
  }
  k.box(.007, .046, d * .8, px + .0265, -.03, 0, PAD);                        // knuckle armour
  const n = trigger ? 3 : 4, y0 = trigger ? -.03 : -.008;
  for (let i = 0; i < n; i++) {
    const y = y0 - i * .0215;
    k.box(w + .026, .019, .019, .003, y, -d / 2 - .0095, GLV);                // finger across the front strap
    k.box(.016, .019, d * .5, -px - .008, y, -d / 2 + d * .2, GLV);           // fingertip on the far side
  }
  if (trigger && stock) k.box(.016, .06, .018, px + .008, .024, -d / 2 + .012, GLV);   // index finger forward along the stock
  else if (trigger) { k.box(.016, .018, .05, px + .008, -.006, -d / 2 - .02, GLV); k.box(.015, .017, .024, px - .004, -.006, -d / 2 - .05, GLV, [0, .7, 0]); }
  if (fwd) k.box(.017, .018, .07, px - .0045, -.004, -.032, GLV); else k.box(.017, .019, .05, -px - .0085, -.004, -.004, GLV);   // thumb (fwd: along the frame, outside the firing thumb)
  const wx = stock ? px + .008 : fwd ? px + .012 : px - .006;
  if (stock) k.box(.06, .03, .05, wx, -.1, -.004, CUF); else k.box(.06, .05, .03, wx, -.04, d / 2 + .03, CUF);   // wrist
  k.pop();
  return stock ? new THREE.Vector3(side * wx, -.004, .112) : new THREE.Vector3(side * wx, -.04, d / 2 + .042);
}
// Left hand cupping a fore-end from below. Origin = bottom centre of the fore-end (w wide); fingers reach h up the far side.
function handUnder(k, w, h) {
  const hw = w / 2;
  k.box(w + .03, .022, .085, -.002, -.011, 0, GLV);                           // palm
  k.box(.03, .006, .06, .002, -.0235, 0, PALM);                               // palm pad
  k.box(.02, h + .012, .075, -hw - .01, h / 2 - .008, .008, GLV);             // heel of the hand up the near side
  k.box(.018, .02, .056, -hw - .009, h * .85, -.034, GLV);                    // thumb, pointing forward
  for (let i = 0; i < 4; i++) k.box(.018, h + .004, .0185, hw + .009, h / 2 - .004, -.033 + i * .0215, GLV);   // fingers up the far side
  k.box(.007, h * .6, .07, hw + .0195, h / 2, -.001, PAD);                    // knuckle armour
  k.box(.058, .044, .034, -hw - .014, -.02, .052, CUF, [0, -.5, 0]);          // wrist
  return new THREE.Vector3(-hw - .022, -.024, .064);
}
const _hands = new Map();
/** Glove mesh for one grip anchor ({ pose, w, d, trigger }); userData.wrist = where the forearm attaches (hand space). */
export function handMesh(side, h) {
  const pose = h.pose || 'grip', w = h.w ?? .032, d = h.d ?? (pose === 'under' ? .04 : .042), key = [side, pose, w, d, h.trigger ? 1 : 0].join(':');
  let e = _hands.get(key);
  if (!e) { const k = new Kit(96), wrist = pose === 'under' ? handUnder(k, w, d) : handGrip(k, side, w, d, !!h.trigger, pose === 'wrap', pose === 'stock'); e = { geo: k.geometry(), wrist }; _hands.set(key, e); }
  const m = new THREE.Mesh(e.geo, kitMaterial()); m.userData.wrist = e.wrist; m.userData.keep = true; return m;
}
/** Sleeved forearm: origin at the wrist, +Z runs to the elbow and on past it (always long enough to leave the screen). */
export function forearmMesh(side) {
  const k = new Kit(96);
  k.box(.07, .06, .04, 0, 0, .012, CUF);                                      // glove cuff
  k.box(.074, .064, .014, 0, 0, .024, st(T.flat, PAL.grey));                  // strap
  k.taper(.068, .062, .26, 0, 0, .16, '+z', 1.2, SLV);                        // forearm sleeve
  k.box(.084, .078, .42, 0, -.003, .5, SLV);                                  // upper sleeve
  k.box(.088, .03, .1, 0, .03, .34, st(T.carbon, PAL.black));                 // elbow pad
  if (side < 0) { k.box(.046, .01, .056, 0, .036, .1, BLK); k.box(.026, .003, .022, -.004, .0425, .106, st(T.screen, PAL.kappa, { glow: .45 })); k.box(.076, .008, .012, 0, .03, .135, BLK); led(k, .014, .0412, .084, GREEN, '+y', .004); }   // wrist computer
  else k.decal(T.kappa, .04, .04, 0, .037, .2, '+y', { tint: PAL.kappa, glow: .3 });
  const m = k.mesh(); m.userData.keep = true; return m;
}
/** Spent case geometry for the viewmodel's InstancedMesh pools: 'brass' or 'hull' (shotgun), centred, pointing -Z. */
export function casingGeo(kind) {
  const k = new Kit(96);
  if (kind === 'hull') { k.cyl('z', .0095, .042, 0, 0, -.006, st(T.flat, PAL.red), 6); k.cyl('z', .0102, .014, 0, 0, .021, BRS, 6); }
  else { k.cyl('z', .0052, .034, 0, 0, 0, BRS, 6); k.cyl('z', .006, .004, 0, 0, .017, st(T.metal, 0xb88a30), 6); k.cyl('z', .0036, .002, 0, 0, -.0172, HOLE, 6); }
  return k.geometry();
}
