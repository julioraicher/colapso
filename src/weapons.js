// Arsenal: weapon definitions (ballistic data), classes / gadgets and the legacy box-modelling helpers
// (lam, box, flatten) still used by the bots. The weapon models live in guns.js, the first-person
// viewmodel (hands, recoil, reload animations, casings) in viewmodel.js; both are re-exported here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
export { buildGun } from './guns.js';        // pixel-art weapon models (one per weapon id)
export { Viewmodel } from './viewmodel.js';  // first-person rig: hands, reloads, casings, flashes

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
