// Arsenal: weapon definitions (ballistic data), classes/gadgets, procedural box-modelled guns with
// animatable parts (magazine, bolt, belt cover, cylinder, rocket) and the first-person viewmodel with
// spring-driven recoil and per-style reload animations.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// vel: muzzle velocity (m/s) – projectiles are simulated with gravity (g = 9.81) and travel time.
// style: reload animation (mag | shell | bolt | belt | cyl | rocket). bolt: bolt-action cycle time after each shot.
const W = (o) => Object.assign({ head: 1.8, pellets: 1, spreadMove: 0.02, recoilBias: 0, kick: 1, vox: 1, range: 250, style: 'mag', sight: 'holo', zoom: 0, drag: 0.0006 }, o);
export const WEAPONS = {
  // ---- ASSALTO ----
  k7: W({ name: 'K-7 CARABINA', cls: 'assalto', type: 'rifle', snd: 'rifle', dmg: 25, rpm: 700, auto: true, mag: 30, reserve: 150, reload: 2.3, vel: 820,
    spreadHip: 0.032, spreadAds: 0.003, recoilV: 0.0175, recoilH: 0.007, recoilBias: 0.25, falloff: [30, 70, 0.7], fovAds: 52, desc: 'Fuzil versátil. Recuo vertical forte e controlável.' }),
  arco: W({ name: 'ARCO B-9 BULLPUP', cls: 'assalto', type: 'bullpup', snd: 'rifle', dmg: 23, rpm: 820, auto: true, mag: 30, reserve: 150, reload: 2.6, vel: 860,
    spreadHip: 0.03, spreadAds: 0.0035, recoilV: 0.014, recoilH: 0.009, recoilBias: -0.2, falloff: [28, 65, 0.7], fovAds: 50, sight: 'reddot', desc: 'Bullpup de cadência alta. Recuo horizontal nervoso.' }),
  // ---- ENGENHEIRO ----
  vespa: W({ name: 'VESPA SMG', cls: 'engenheiro', type: 'smg', snd: 'smg', dmg: 19, head: 1.6, rpm: 920, auto: true, mag: 36, reserve: 180, reload: 1.9, vel: 420,
    spreadHip: 0.024, spreadAds: 0.006, spreadMove: 0.012, recoilV: 0.011, recoilH: 0.008, recoilBias: -0.1, kick: 0.7, falloff: [18, 45, 0.55], fovAds: 58, range: 150, desc: 'SMG compacta. Domina corredores do laboratório.' }),
  faisca: W({ name: 'FAÍSCA PDW', cls: 'engenheiro', type: 'pdw', snd: 'smg', dmg: 16, head: 1.5, rpm: 1050, auto: true, mag: 50, reserve: 200, reload: 2.4, vel: 600,
    spreadHip: 0.022, spreadAds: 0.007, spreadMove: 0.01, recoilV: 0.008, recoilH: 0.009, kick: 0.6, falloff: [15, 40, 0.5], fovAds: 58, range: 150, sight: 'reddot', desc: 'PDW de 50 tiros, cadência absurda, alcance curto.' }),
  martelo: W({ name: 'MARTELO 12', cls: 'engenheiro', type: 'shotgun', snd: 'shotgun', dmg: 14, head: 1.3, rpm: 75, auto: false, mag: 6, reserve: 36, reload: 0.55, style: 'shell', vel: 400,
    spreadHip: 0.075, spreadAds: 0.055, spreadMove: 0.01, recoilV: 0.075, recoilH: 0.02, kick: 2.2, falloff: [8, 25, 0.25], vox: 2, fovAds: 60, pellets: 10, range: 60, sight: 'iron', drag: 0.004, desc: 'Escopeta de bomba. Abre buracos em paredes.' }),
  // ---- SUPORTE ----
  trovao: W({ name: 'TROVÃO M-100', cls: 'suporte', type: 'lmg', snd: 'dmr', dmg: 26, rpm: 640, auto: true, mag: 100, reserve: 300, reload: 5.2, style: 'belt', vel: 850,
    spreadHip: 0.045, spreadAds: 0.006, spreadMove: 0.04, recoilV: 0.013, recoilH: 0.011, recoilBias: 0.1, kick: 1.2, falloff: [35, 80, 0.7], vox: 2, fovAds: 50, desc: 'Metralhadora de fita. 100 tiros de supressão que moem concreto.' }),
  bigorna: W({ name: 'BIGORNA .30', cls: 'suporte', type: 'lmg2', snd: 'dmr', dmg: 31, rpm: 520, auto: true, mag: 60, reserve: 240, reload: 4.2, vel: 880,
    spreadHip: 0.05, spreadAds: 0.005, spreadMove: 0.045, recoilV: 0.02, recoilH: 0.01, recoilBias: 0.3, kick: 1.5, falloff: [40, 90, 0.75], vox: 2, fovAds: 48, desc: 'LMG de tambor, calibre pesado, 4 tiros matam até longe.' }),
  // ---- RECONHECIMENTO ----
  lanca: W({ name: 'LANÇA DMR', cls: 'recon', type: 'dmr', snd: 'dmr', dmg: 58, head: 2.2, rpm: 240, auto: false, mag: 12, reserve: 60, reload: 2.6, vel: 880,
    spreadHip: 0.05, spreadAds: 0.0007, spreadMove: 0.03, recoilV: 0.05, recoilH: 0.012, recoilBias: 0.3, kick: 1.8, falloff: [60, 140, 0.85], vox: 3, fovAds: 32, range: 300, sight: 'scope', zoom: 4, desc: 'Semiautomático com luneta 4x. 2 no corpo, 1 na cabeça.' }),
  orion: W({ name: 'ÓRION .338', cls: 'recon', type: 'sniper', snd: 'sniper', dmg: 105, head: 2.5, rpm: 50, auto: false, mag: 5, reserve: 30, reload: 3.2, bolt: 1.05, vel: 900,
    spreadHip: 0.09, spreadAds: 0.0, spreadMove: 0.06, recoilV: 0.09, recoilH: 0.015, kick: 3, falloff: [100, 300, 0.9], vox: 5, fovAds: 14, range: 400, sight: 'scope', zoom: 8, drag: 0.0003, desc: 'Ferrolho .338, luneta 8x. Mata com 1 tiro no corpo de perto. SHIFT segura o fôlego.' }),
  vigia: W({ name: 'VIGIA 7.62', cls: 'recon', type: 'sniper2', snd: 'sniper', dmg: 80, head: 2.5, rpm: 70, auto: false, mag: 8, reserve: 40, reload: 2.8, bolt: 0.75, vel: 820,
    spreadHip: 0.07, spreadAds: 0.0, spreadMove: 0.05, recoilV: 0.07, recoilH: 0.015, kick: 2.4, falloff: [80, 250, 0.85], vox: 4, fovAds: 22, range: 350, sight: 'scope', zoom: 5, desc: 'Ferrolho leve, ciclo rápido, luneta 5x.' }),
  // ---- SECUNDÁRIAS ----
  p9: W({ name: 'P9', cls: 'any', type: 'pistol', snd: 'pistol', dmg: 24, rpm: 400, auto: false, mag: 15, reserve: 75, reload: 1.5, vel: 360,
    spreadHip: 0.02, spreadAds: 0.006, spreadMove: 0.01, recoilV: 0.022, recoilH: 0.008, kick: 0.8, falloff: [15, 40, 0.6], fovAds: 62, range: 120, sight: 'iron', desc: 'Pistola padrão, confiável.' }),
  juiz: W({ name: 'JUIZ .44', cls: 'any', type: 'revolver', snd: 'dmr', dmg: 55, head: 2, rpm: 150, auto: false, mag: 6, reserve: 36, reload: 2.4, style: 'cyl', vel: 420,
    spreadHip: 0.025, spreadAds: 0.004, spreadMove: 0.015, recoilV: 0.06, recoilH: 0.015, kick: 1.8, falloff: [20, 50, 0.6], fovAds: 60, range: 150, sight: 'iron', desc: 'Revólver .44. Dois tiros derrubam.' }),
  rajada: W({ name: 'RAJADA MP', cls: 'any', type: 'mpistol', snd: 'pistol', dmg: 15, head: 1.5, rpm: 1100, auto: true, mag: 20, reserve: 100, reload: 1.6, vel: 350,
    spreadHip: 0.03, spreadAds: 0.012, spreadMove: 0.01, recoilV: 0.012, recoilH: 0.012, kick: 0.6, falloff: [10, 30, 0.5], fovAds: 62, range: 100, sight: 'iron', desc: 'Pistola-metralhadora. Esvazia o pente em 1 segundo.' }),
  // ---- GADGET (Engenheiro) ----
  rpg: W({ name: 'RPG-Q', cls: 'gadget', type: 'launcher', snd: 'rocket', dmg: 0, rpm: 30, auto: false, mag: 1, reserve: 3, reload: 3.0, style: 'rocket', vel: 70, rocket: true,
    spreadHip: 0.02, spreadAds: 0.004, recoilV: 0.05, recoilH: 0.01, kick: 2.5, falloff: [1, 2, 1], fovAds: 50, range: 300, sight: 'iron', desc: 'Foguete com gravidade reduzida. Derruba paredes inteiras.' }),
};
export const PRIMARIES = ['k7', 'arco', 'vespa', 'faisca', 'martelo', 'trovao', 'bigorna', 'lanca', 'orion', 'vigia'];
export const SECONDARIES = ['p9', 'juiz', 'rajada'];
export const CLASSES = {
  assalto: { name: 'ASSALTO', icon: '✚', color: '#ff6a5a', gadget: 'SERINGA DE ADRENALINA', gdesc: 'F: cura total + corrida 25% mais rápida por 4 s (2 cargas). +1 granada. Regeneração mais rápida.', weapons: ['k7', 'arco'] },
  engenheiro: { name: 'ENGENHEIRO', icon: '⚙', color: '#ffb84a', gadget: 'LANÇA-FOGUETES RPG-Q', gdesc: 'F: saca o RPG-Q (3 foguetes). Abre buracos e derruba prédios. Resistência a explosões.', weapons: ['vespa', 'faisca', 'martelo'] },
  suporte: { name: 'SUPORTE', icon: '▣', color: '#7dff8a', gadget: 'CAIXA DE SUPRIMENTOS', gdesc: 'F: arremessa uma caixa que repõe munição/granadas e cura quem estiver perto. Munição extra.', weapons: ['trovao', 'bigorna'] },
  recon: { name: 'RECONHECIMENTO', icon: '◎', color: '#39e6ff', gadget: 'SENSOR DE MOVIMENTO', gdesc: 'F: arremessa um sensor que marca inimigos num raio de 30 m por 25 s. Z marca o inimigo na mira.', weapons: ['lanca', 'orion', 'vigia'] },
};

export function damageAt(w, dist) {
  const [a, b, min] = w.falloff;
  if (dist <= a) return w.dmg;
  if (dist >= b) return w.dmg * min;
  return w.dmg * (1 - (1 - min) * (dist - a) / (b - a));
}

// --- tiny box-modelling helper ---
const _mats = new Map();
export function lam(hex, emissive = 0) {
  const k = hex + ':' + emissive; if (_mats.has(k)) return _mats.get(k);
  const m = new THREE.MeshLambertMaterial({ color: hex, emissive: emissive ? hex : 0, emissiveIntensity: emissive });
  _mats.set(k, m); return m;
}
export function box(parent, w, h, d, x, y, z, mat, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
}
function cyl(parent, r, len, x, y, z, mat, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); parent.add(m); return m;
}

// Draw-call reduction: within each node, merge sibling meshes that share a material into one mesh.
// Animated parts are groups, so they stay independent; only rigid sub-meshes are fused.
export function flatten(root) {
  const nodes = []; root.traverse(o => { if (!o.isMesh) nodes.push(o); });
  for (const n of nodes) {
    const byMat = new Map();
    for (const c of n.children) if (c.isMesh && !c.userData.keep) { if (!byMat.has(c.material)) byMat.set(c.material, []); byMat.get(c.material).push(c); }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map(m => { m.updateMatrix(); const g = m.geometry.index ? m.geometry.clone() : m.geometry.clone(); g.applyMatrix4(m.matrix); for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; });
      const merged = mergeGeometries(geos); if (!merged) continue;
      for (const m of list) n.remove(m);
      n.add(new THREE.Mesh(merged, mat));
    }
  }
  return root;
}
// Animatable part: a group whose rest pose is remembered
function part(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); g.userData.home = g.position.clone(); g.userData.homeR = g.rotation.clone(); parent.add(g); return g; }

function sightOn(g, kind, y, z, dark, accent) {
  if (kind === 'holo') {
    box(g, 0.036, 0.012, 0.07, 0, y - 0.022, z, dark);
    box(g, 0.004, 0.035, 0.012, -0.017, y, z - 0.025, dark); box(g, 0.004, 0.035, 0.012, 0.017, y, z - 0.025, dark);
    box(g, 0.038, 0.004, 0.012, 0, y + 0.019, z - 0.025, dark);
    box(g, 0.003, 0.003, 0.001, 0, y, z - 0.025, lam(0xff3b30, 2));
  } else if (kind === 'reddot') {
    box(g, 0.03, 0.01, 0.05, 0, y - 0.018, z, dark);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 4, 10), dark); ring.position.set(0, y, z - 0.015); g.add(ring);
    box(g, 0.003, 0.003, 0.001, 0, y, z - 0.015, lam(0x39ff6a, 2));
  } else if (kind === 'scope') {
    cyl(g, 0.022, 0.26, 0, y, z, dark, 10);
    cyl(g, 0.028, 0.04, 0, y, z - 0.14, dark, 10); cyl(g, 0.026, 0.035, 0, y, z + 0.13, dark, 10);
    box(g, 0.012, 0.03, 0.02, 0, y - 0.03, z - 0.05, dark); box(g, 0.012, 0.03, 0.02, 0, y - 0.03, z + 0.06, dark);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), lam(accent, 0.8)); lens.position.set(0, y, z - 0.161); lens.rotation.y = Math.PI; g.add(lens);
  } else { // iron sights
    box(g, 0.006, 0.02, 0.006, 0, y, z - 0.3, dark); box(g, 0.02, 0.016, 0.006, 0, y - 0.002, z + 0.05, dark);
  }
}

// Builds gun model; returns Group with userData {muzzle, mag, bolt, cover, cyl, rocket, sightY}
export function buildGun(type, opts = {}) {
  const g = new THREE.Group();
  const body = lam(opts.body || 0x3c434e), dark = lam(0x1f2228), accent = opts.accent || 0x39e6ff, glow = lam(accent, 1.2), grip = lam(0x3a3530), wood = lam(0x5a4030), olive = lam(0x4a5040);
  const muzzle = new THREE.Object3D(); const U = g.userData;
  let sightY = 0.07;
  const magBox = (x, y, z, w, h, d, rx = 0.2, mat = dark) => { const m = part(g, x, y, z); box(m, w, h, d, 0, 0, 0, mat, rx); U.mag = m; return m; };
  switch (type) {
    case 'rifle':
      box(g, 0.06, 0.08, 0.42, 0, 0, -0.05, body); box(g, 0.045, 0.05, 0.3, 0, 0.005, -0.38, dark);
      cyl(g, 0.011, 0.2, 0, 0, -0.6, dark); cyl(g, 0.018, 0.06, 0, 0, -0.69, dark);
      magBox(0, -0.09, -0.08, 0.04, 0.13, 0.06, 0.25);
      box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.08, grip, -0.3); box(g, 0.05, 0.06, 0.18, 0, -0.01, 0.24, body);
      box(g, 0.012, 0.012, 0.28, 0.031, 0.02, -0.2, glow);
      U.bolt = part(g, 0.034, 0.015, -0.02); box(U.bolt, 0.012, 0.012, 0.04, 0, 0, 0, dark);
      sightOn(g, opts.sight || 'holo', 0.07, -0.05, dark, accent); muzzle.position.set(0, 0, -0.73); break;
    case 'bullpup':
      box(g, 0.065, 0.1, 0.55, 0, -0.005, 0.05, body); box(g, 0.05, 0.05, 0.2, 0, 0.0, -0.3, dark);
      cyl(g, 0.011, 0.16, 0, 0, -0.47, dark); cyl(g, 0.017, 0.05, 0, 0, -0.56, dark);
      magBox(0, -0.1, 0.18, 0.04, 0.12, 0.06, 0.2);   // mag behind the grip (bullpup!)
      box(g, 0.035, 0.09, 0.04, 0, -0.085, -0.06, grip, -0.25); box(g, 0.068, 0.02, 0.4, 0, 0.055, -0.02, dark);
      box(g, 0.012, 0.03, 0.3, 0.034, 0.0, 0.0, glow);
      U.bolt = part(g, -0.035, 0.02, 0.1); box(U.bolt, 0.01, 0.012, 0.04, 0, 0, 0, dark);
      sightOn(g, 'reddot', 0.09, -0.02, dark, accent); sightY = 0.09; muzzle.position.set(0, 0, -0.6); break;
    case 'smg':
      box(g, 0.06, 0.09, 0.32, 0, 0, -0.02, body); cyl(g, 0.013, 0.14, 0, 0, -0.25, dark);
      magBox(0, -0.12, -0.04, 0.035, 0.18, 0.045, 0.05);
      box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.1, grip, -0.3); box(g, 0.03, 0.03, 0.16, 0, 0.0, 0.2, dark);
      box(g, 0.012, 0.03, 0.2, 0.032, 0.0, -0.05, glow);
      U.bolt = part(g, 0.032, 0.03, 0.02); box(U.bolt, 0.01, 0.012, 0.03, 0, 0, 0, dark);
      sightOn(g, 'holo', 0.068, -0.02, dark, accent); sightY = 0.068; muzzle.position.set(0, 0, -0.33); break;
    case 'pdw':
      box(g, 0.06, 0.1, 0.36, 0, 0, 0.0, body); box(g, 0.062, 0.03, 0.3, 0, 0.065, 0.0, dark); // top-loaded mag rail
      magBox(0, 0.06, -0.02, 0.045, 0.018, 0.3, 0, lam(0x2a5a6a));  // translucent-ish top magazine
      cyl(g, 0.012, 0.1, 0, -0.01, -0.23, dark); box(g, 0.035, 0.08, 0.05, 0, -0.08, 0.06, grip, -0.2);
      box(g, 0.012, 0.012, 0.2, -0.032, -0.02, 0, glow);
      sightOn(g, 'reddot', 0.1, 0.03, dark, accent); sightY = 0.1; muzzle.position.set(0, -0.01, -0.29); break;
    case 'shotgun':
      box(g, 0.065, 0.08, 0.38, 0, 0, 0, body); cyl(g, 0.018, 0.42, 0, 0.015, -0.38, dark); cyl(g, 0.014, 0.36, 0, -0.025, -0.36, dark);
      U.pump = part(g, 0, -0.04, -0.33); box(U.pump, 0.05, 0.045, 0.2, 0, 0, 0, grip);
      box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.1, grip, -0.3); box(g, 0.055, 0.07, 0.22, 0, -0.02, 0.3, wood);
      box(g, 0.012, 0.012, 0.36, 0.034, 0.02, -0.05, glow); box(g, 0.012, 0.02, 0.012, 0, 0.05, -0.55, glow);
      U.shell = part(g, 0.0, -0.09, 0.0); cyl(U.shell, 0.01, 0.06, 0, 0, 0, lam(0xc03a2a)); U.shell.visible = false;
      sightY = 0.05; muzzle.position.set(0, 0.015, -0.6); break;
    case 'lmg': case 'lmg2': {
      const heavy = type === 'lmg';
      box(g, 0.075, 0.1, 0.48, 0, 0, -0.02, olive); box(g, 0.05, 0.06, 0.3, 0, 0.0, -0.4, dark);
      cyl(g, heavy ? 0.016 : 0.014, 0.3, 0, 0.005, -0.66, dark); cyl(g, 0.024, 0.07, 0, 0.005, -0.82, dark);
      for (let i = 0; i < 5; i++) box(g, 0.054, 0.01, 0.02, 0, 0.033, -0.32 - i * 0.04, dark); // cooling fins
      box(g, 0.035, 0.09, 0.04, 0, -0.085, 0.1, grip, -0.3); box(g, 0.06, 0.08, 0.2, 0, -0.01, 0.3, olive);
      box(g, 0.012, 0.012, 0.36, 0.039, 0.025, -0.15, glow);
      // bipod (folded)
      box(g, 0.008, 0.008, 0.2, 0.02, -0.04, -0.55, dark); box(g, 0.008, 0.008, 0.2, -0.02, -0.04, -0.55, dark);
      U.cover = part(g, 0, 0.055, 0.04); box(U.cover, 0.07, 0.015, 0.18, 0, 0, -0.07, olive);
      if (heavy) { const m = magBox(-0.06, -0.08, -0.05, 0.08, 0.1, 0.12, 0, olive); box(m, 0.02, 0.05, 0.03, 0.04, 0.07, 0, lam(0xc8a040)); } // ammo box + belt
      else { const m = part(g, 0, -0.1, -0.06); cyl(m, 0.07, 0.06, 0, 0, 0, dark, 14).rotation.set(0, 0, Math.PI / 2); U.mag = m; } // drum
      sightOn(g, 'holo', 0.09, 0.02, dark, accent); sightY = 0.09; muzzle.position.set(0, 0.005, -0.86); break; }
    case 'dmr':
      box(g, 0.06, 0.085, 0.5, 0, 0, -0.03, body); cyl(g, 0.011, 0.36, 0, 0.005, -0.45, dark);
      magBox(0, -0.1, -0.08, 0.04, 0.12, 0.06, 0.15);
      box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.1, grip, -0.3); box(g, 0.055, 0.08, 0.2, 0, -0.01, 0.3, body);
      box(g, 0.012, 0.012, 0.4, 0.031, 0.02, -0.2, glow);
      sightOn(g, 'scope', 0.08, -0.04, dark, accent); sightY = 0.08; muzzle.position.set(0, 0.005, -0.64); break;
    case 'sniper': case 'sniper2': {
      const big = type === 'sniper';
      box(g, 0.06, 0.07, 0.42, 0, 0, 0.0, big ? lam(0x2e3a30) : wood); cyl(g, big ? 0.014 : 0.012, big ? 0.55 : 0.45, 0, 0.01, big ? -0.48 : -0.43, dark);
      if (big) { box(g, 0.05, 0.03, 0.06, 0, 0.01, -0.77, dark); } // brake
      magBox(0, -0.07, -0.02, 0.04, 0.07, 0.07, 0);
      box(g, 0.035, 0.09, 0.04, 0, -0.08, 0.13, grip, -0.3); box(g, 0.05, 0.1, 0.24, 0, -0.03, 0.33, big ? lam(0x2e3a30) : wood);
      box(g, 0.05, 0.03, 0.1, 0, 0.05, 0.36, dark); // cheek riser
      U.bolt = part(g, 0.036, 0.03, 0.08); box(U.bolt, 0.012, 0.012, 0.08, 0, 0, 0, dark); box(U.bolt, 0.05, 0.01, 0.01, 0.025, 0, 0.03, dark); const k = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), dark); k.position.set(0.05, 0, 0.03); U.bolt.add(k);
      sightOn(g, 'scope', 0.085, -0.02, dark, accent); sightY = 0.085; muzzle.position.set(0, 0.01, big ? -0.8 : -0.66); break; }
    case 'pistol': case 'mpistol':
      box(g, 0.04, 0.05, 0.2, 0, 0.03, -0.05, body); U.bolt = part(g, 0, 0.045, -0.05); box(U.bolt, 0.042, 0.022, 0.2, 0, 0, 0, dark);
      box(g, 0.035, 0.11, 0.045, 0, -0.04, 0.02, grip, -0.2);
      magBox(0, -0.07, 0.025, 0.03, type === 'mpistol' ? 0.16 : 0.08, 0.035, -0.2);
      if (type === 'mpistol') { box(g, 0.03, 0.04, 0.03, 0, -0.01, -0.13, grip); }
      box(g, 0.01, 0.01, 0.16, 0.021, 0.04, -0.05, glow); box(g, 0.008, 0.012, 0.008, 0, 0.062, -0.13, glow);
      sightY = 0.062; muzzle.position.set(0, 0.03, -0.16); break;
    case 'revolver':
      box(g, 0.035, 0.04, 0.24, 0, 0.035, -0.08, lam(0x6a6e78)); cyl(g, 0.01, 0.12, 0, 0.04, -0.24, dark);
      U.cyl = part(g, -0.0, 0.025, -0.01); cyl(U.cyl, 0.026, 0.05, 0, 0, 0, lam(0x6a6e78), 6);
      box(g, 0.035, 0.11, 0.045, 0, -0.04, 0.05, wood, -0.35); box(g, 0.008, 0.014, 0.008, 0, 0.065, -0.27, glow);
      sightY = 0.065; muzzle.position.set(0, 0.04, -0.31); break;
    case 'launcher':
      cyl(g, 0.045, 0.9, 0.02, 0.0, -0.2, olive, 10); cyl(g, 0.055, 0.1, 0.02, 0.0, -0.62, dark, 10);
      box(g, 0.035, 0.09, 0.04, 0.02, -0.08, 0.0, grip, -0.2); box(g, 0.035, 0.08, 0.04, 0.02, -0.07, -0.25, grip);
      box(g, 0.02, 0.05, 0.05, -0.04, 0.06, -0.15, dark); box(g, 0.012, 0.012, 0.6, 0.07, 0.0, -0.2, glow);
      U.rocket = part(g, 0.02, 0, -0.7); const cone = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 8), lam(0x7a8a50)); cone.rotation.x = -Math.PI / 2; U.rocket.add(cone);
      sightY = 0.06; muzzle.position.set(0.02, 0, -0.72); break;
  }
  g.add(muzzle); U.muzzle = muzzle; U.sightY = sightY;
  return g;
}

const ease = (t) => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const seg = (t, a, b) => ease((t - a) / (b - a));

export class Viewmodel {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x30303a, 2.2));
    const d = new THREE.DirectionalLight(0xbcd0ff, 1.2); d.position.set(0.5, 1, 0.3); this.scene.add(d);
    this.flash = new THREE.PointLight(0xffb060, 0, 3, 1.5); this.flash.position.set(0.1, -0.05, -0.8); this.scene.add(this.flash);
    this.root = new THREE.Group(); this.scene.add(this.root);
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.3, 'rgba(255,190,90,.9)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const fm = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.mflash = new THREE.Group();
    const q1 = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.3), fm); q1.rotation.x = Math.PI / 2; q1.position.z = -0.12; this.mflash.add(q1);
    const q2 = q1.clone(); q2.rotation.y = Math.PI / 2; this.mflash.add(q2);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), fm); this.mflash.add(disc); this.mflash.traverse(o => o.renderOrder = 10);
    this.mflash.visible = false;
    this.guns = {};
    this.arms = new THREE.Group();
    const sleeve = lam(0x2c3440), glove = lam(0x1a1c20), band = lam(0x39e6ff, 1);
    const ra = new THREE.Group(); ra.position.set(0.0, -0.08, 0.1); this.arms.add(ra); this.rightArm = ra;
    box(ra, 0.06, 0.07, 0.09, 0, 0, 0, glove);
    const rf = box(ra, 0.075, 0.075, 0.36, 0.05, -0.08, 0.18, sleeve); rf.rotation.set(0.45, 0.25, 0);
    const rb = box(ra, 0.08, 0.025, 0.06, 0.03, -0.03, 0.08, band); rb.rotation.set(0.45, 0.25, 0);
    this.leftArm = new THREE.Group(); this.leftArm.position.set(0, -0.045, -0.32); this.arms.add(this.leftArm);
    box(this.leftArm, 0.065, 0.06, 0.1, 0, -0.01, 0, glove);
    const lf = box(this.leftArm, 0.075, 0.075, 0.4, -0.1, -0.1, 0.16, sleeve); lf.rotation.set(0.35, -0.55, 0);
    this.lHome = new THREE.Vector3(0, -0.045, -0.32);
    this.root.add(this.arms);
    this.cur = null; this.type = null;
    this.kick = 0; this.kickV = 0; this.rot = 0; this.rotV = 0; this.roll = 0;
    this.swayX = 0; this.swayY = 0; this.switchT = 0;
    this.sprintW = 0; this.adsW = 0; this.tiltW = 0;
    this.tmp = new THREE.Vector3();
  }
  setWeapon(id, def) {
    if (this.cur) this.root.remove(this.cur);
    if (!this.guns[id]) this.guns[id] = buildGun(def.type, { sight: def.sight });
    this.cur = this.guns[id]; this.root.add(this.cur); this.cur.userData.muzzle.add(this.mflash); this.type = def.type; this.def = def; this.switchT = 0.35;
    this.cur.position.set(def.type === 'launcher' ? 0.02 : 0, 0, 0);
    this.resetParts();
  }
  resetParts() {
    const U = this.cur.userData;
    for (const k of ['mag', 'bolt', 'cover', 'cyl', 'rocket', 'pump', 'shell']) { const p = U[k]; if (!p) continue; p.position.copy(p.userData.home); p.rotation.copy(p.userData.homeR); p.visible = k !== 'shell'; }
  }
  fire(k) { this.kickV += 0.9 * k; this.rotV += 7 * k; this.roll = (Math.random() - 0.5) * 0.06 * k; this.flash.intensity = 4; this.flashT = 0.05; this.mflash.visible = true; this.mflash.rotation.z = Math.random() * 6.28; this.mflash.scale.setScalar(0.8 + Math.random() * 0.5);
    const b = this.cur.userData.bolt; if (b && this.def && !this.def.bolt) { b.position.z = b.userData.home.z + 0.035; } }
  // Reload choreography. t ∈ [0,1]. Returns {gun tilt pose, left hand target} and moves gun parts.
  animateReload(t, style) {
    const U = this.cur.userData; const L = this.leftArm; const H = this.lHome;
    let tiltX = 0, tiltZ = 0, dip = 0;
    const lt = this.tmp.copy(H);
    if (style === 'mag') {
      tiltZ = 0.55 * seg(t, 0, 0.15) * (1 - seg(t, 0.82, 1)); tiltX = 0.15 * seg(t, 0, 0.15) * (1 - seg(t, 0.82, 1)); dip = 0.03 * tiltZ;
      if (U.mag) {
        const M = U.mag, h = M.userData.home;
        const out = seg(t, 0.12, 0.3), back = seg(t, 0.48, 0.7);
        M.position.set(h.x - 0.02 * out * (1 - back), h.y - 0.35 * out * (1 - back) - (t > 0.3 && t < 0.48 ? 0.35 : 0), h.z);
        M.rotation.x = M.userData.homeR.x - 0.6 * out * (1 - back);
        M.visible = !(t > 0.3 && t < 0.45);
        // left hand: goes to mag, drops with it, fetches new one, inserts, slaps
        const toMag = seg(t, 0.05, 0.14), away = seg(t, 0.3, 0.42), bring = seg(t, 0.42, 0.6), done = seg(t, 0.72, 0.85);
        lt.lerp(new THREE.Vector3(h.x - 0.02, h.y - 0.04, h.z), toMag);
        lt.y -= 0.3 * away * (1 - bring); lt.x -= 0.08 * away * (1 - bring);
        lt.lerp(H, done);
      }
      if (U.bolt) { const r = seg(t, 0.78, 0.84) * (1 - seg(t, 0.86, 0.92)); U.bolt.position.z = U.bolt.userData.home.z + 0.06 * r; }
    } else if (style === 'belt') {
      tiltZ = 0.3 * seg(t, 0, 0.1) * (1 - seg(t, 0.9, 1)); tiltX = 0.25 * seg(t, 0, 0.1) * (1 - seg(t, 0.9, 1));
      if (U.cover) U.cover.rotation.x = -1.6 * seg(t, 0.05, 0.18) * (1 - seg(t, 0.78, 0.88));
      if (U.mag) { const M = U.mag, h = M.userData.home; const out = seg(t, 0.2, 0.36), back = seg(t, 0.5, 0.68);
        M.position.set(h.x, h.y - 0.4 * out * (1 - back), h.z); M.visible = !(t > 0.36 && t < 0.5); }
      lt.set(H.x - 0.02, H.y + 0.08 * seg(t, 0.03, 0.12) * (1 - seg(t, 0.2, 0.25)) - 0.25 * seg(t, 0.25, 0.4) * (1 - seg(t, 0.5, 0.66)), H.z + 0.22 * seg(t, 0.03, 0.12) * (1 - seg(t, 0.86, 0.95)));
    } else if (style === 'shell') {
      // per-shell: tilt, thumb a shell into the loading port
      tiltZ = -0.35; tiltX = 0.12;
      if (U.shell) { U.shell.visible = t > 0.1 && t < 0.75; const p = seg(t, 0.25, 0.7); U.shell.position.set(0.0, -0.16 + 0.1 * p, 0.02 - 0.04 * p); }
      lt.set(H.x + 0.02, H.y - 0.12 + 0.1 * seg(t, 0.2, 0.7), H.z + 0.3);
    } else if (style === 'cyl') {
      tiltZ = 0.9 * seg(t, 0, 0.15) * (1 - seg(t, 0.85, 1)); tiltX = 0.4 * seg(t, 0, 0.15) * (1 - seg(t, 0.85, 1));
      if (U.cyl) { U.cyl.position.x = U.cyl.userData.home.x - 0.05 * seg(t, 0.1, 0.22) * (1 - seg(t, 0.75, 0.85)); U.cyl.rotation.z = 6 * seg(t, 0.2, 0.75); }
      lt.set(H.x - 0.05, H.y - 0.1 * seg(t, 0.25, 0.4) * (1 - seg(t, 0.45, 0.65)), H.z + 0.22);
    } else if (style === 'rocket') {
      tiltX = -0.5 * seg(t, 0, 0.2) * (1 - seg(t, 0.8, 1)); dip = 0.08 * seg(t, 0, 0.2) * (1 - seg(t, 0.8, 1));
      if (U.rocket) { const p = seg(t, 0.3, 0.7); U.rocket.visible = t > 0.25; U.rocket.position.z = U.rocket.userData.home.z - 0.4 * (1 - p); }
      lt.set(H.x, H.y + 0.05, H.z - 0.3 * seg(t, 0.2, 0.3) * (1 - seg(t, 0.7, 0.8)));
    }
    L.position.lerp(lt, 0.5);
    return { tiltX, tiltZ, dip };
  }
  // bolt-action cycle after each shot: up, back, forward, down
  animateBolt(t) {
    const B = this.cur.userData.bolt; if (!B) return 0;
    const up = seg(t, 0.05, 0.22) * (1 - seg(t, 0.78, 0.95)), back = seg(t, 0.25, 0.45) * (1 - seg(t, 0.55, 0.75));
    B.rotation.z = -1.1 * up; B.position.z = B.userData.home.z + 0.09 * back;
    const lt = this.tmp.set(0.07, 0.0 + 0.02 * up, 0.0 + 0.09 * back); this.rightArm.position.lerp(lt, 0.4);
    return up;
  }
  update(dt, s) {
    const K = 220, C = 22;
    this.kickV += (-K * this.kick - C * this.kickV) * dt; this.kick += this.kickV * dt;
    this.rotV += (-K * this.rot - C * this.rotV) * dt; this.rot += this.rotV * dt;
    this.roll *= Math.exp(-dt * 10);
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) { this.flash.intensity = 0; this.mflash.visible = false; } }
    const U = this.cur.userData;
    if (U.bolt && this.def && !this.def.bolt) U.bolt.position.z += (U.bolt.userData.home.z - U.bolt.position.z) * Math.min(1, dt * 30);
    this.swayX += (-s.mdx * 0.0009 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (s.mdy * 0.0009 - this.swayY) * Math.min(1, dt * 8);
    this.swayX = THREE.MathUtils.clamp(this.swayX, -0.05, 0.05); this.swayY = THREE.MathUtils.clamp(this.swayY, -0.05, 0.05);
    this.sprintW += ((s.sprint ? 1 : 0) - this.sprintW) * Math.min(1, dt * 9);
    this.adsW = s.ads;
    this.tiltW += ((s.slide ? 1 : 0) - this.tiltW) * Math.min(1, dt * 8);
    if (this.switchT > 0) this.switchT -= dt;
    let pose = { tiltX: 0, tiltZ: 0, dip: 0 };
    if (s.reloadT > 0) pose = this.animateReload(1 - s.reloadT / s.reloadDur, s.style);
    else { this.resetPartsSoft(); this.leftArm.position.lerp(this.lHome, Math.min(1, dt * 12)); }
    let boltUp = 0;
    if (s.boltT > 0) boltUp = this.animateBolt(1 - s.boltT / s.boltDur); else this.rightArm.position.lerp(this.tmp.set(0, -0.08, 0.1), Math.min(1, dt * 12));
    const a = this.adsW, hip = 1 - a;
    const sight = U.sightY || 0.07;
    const bobA = hip * 0.9 + 0.15;
    const bx = Math.cos(s.bob) * 0.012 * s.moveK * bobA, by = Math.abs(Math.sin(s.bob)) * 0.014 * s.moveK * bobA;
    const r = this.root;
    const heavy = this.type === 'lmg' || this.type === 'lmg2' || this.type === 'launcher' ? 1 : 0;
    r.position.set(
      0.14 * hip + bx + this.swayX * hip + 0.05 * this.sprintW,
      -0.15 * hip - sight * a - by - this.swayY - pose.dip - (this.switchT > 0 ? this.switchT * 0.8 : 0) - s.land * 0.04 - 0.03 * this.sprintW - 0.02 * heavy * hip,
      -0.42 * hip - 0.45 * a + this.kick * 0.07 * (1 - a * 0.5));
    r.rotation.set(this.rot * 0.09 * (1 - a * 0.6) + this.swayY * 2 - 0.25 * this.sprintW + pose.tiltX + boltUp * 0.05,
      this.swayX * 2 + 0.75 * this.sprintW, this.roll + pose.tiltZ + 0.3 * this.tiltW + 0.15 * this.sprintW - boltUp * 0.15);
    this.cam.fov = s.fov; this.cam.updateProjectionMatrix();
  }
  resetPartsSoft() {
    const U = this.cur.userData;
    for (const k of ['mag', 'cover', 'cyl', 'rocket']) { const p = U[k]; if (!p) continue; p.position.lerp(p.userData.home, 0.3); p.rotation.x *= 0.7; p.rotation.z *= 0.7; if (k !== 'rocket' || this.hasRocket !== false) p.visible = true; }
    if (U.rocket) U.rocket.visible = this.hasRocket !== false;
    if (U.shell) U.shell.visible = false;
  }
}
