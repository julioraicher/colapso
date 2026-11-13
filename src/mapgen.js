// Procedural map: "Instituto Kappa" — research facility at night. Deterministic (seeded).
import { MAT, SX, SY, SZ, VS } from './world.js';

export const G = 2; // first air layer above ground (ground surface at y = 1)

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function generate(w, seed = 7) {
  const R = rng(seed);
  const F = (...a) => w.fill(...a);
  // ground
  F(0, 0, 0, SX - 1, 0, SZ - 1, MAT.BEDROCK);
  F(0, 1, 0, SX - 1, 1, SZ - 1, MAT.ASPHALT);
  // grass patches with slight relief
  for (let i = 0; i < 14; i++) {
    const cx = 10 + R() * (SX - 20) | 0, cz = 10 + R() * (SZ - 20) | 0, r = 5 + R() * 9;
    for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.hypot(x - cx, z - cz); if (d > r) continue;
      w.set(x | 0, 1, z | 0, MAT.GRASS);
      if (d < r * 0.5 && R() < 0.5) w.set(x | 0, 2, z | 0, MAT.GRASS);
    }
  }
  // road grid with lane markings
  const road = (x0, z0, x1, z1, alongX) => {
    F(x0, 1, z0, x1, 1, z1, MAT.ASPHALT);
    if (alongX) { const mz = (z0 + z1) >> 1; for (let x = x0; x <= x1; x++) if ((x >> 2) % 2 === 0) w.set(x, 1, mz, MAT.LINE); }
    else { const mx = (x0 + x1) >> 1; for (let z = z0; z <= z1; z++) if ((z >> 2) % 2 === 0) w.set(mx, 1, z, MAT.LINE); }
  };
  road(0, 92, SX - 1, 99, true);
  road(56, 0, 63, SZ - 1, false);
  road(128, 0, 135, SZ - 1, false);
  for (let i = 10; i < SX - 6; i += 22) for (const z of [90, 101]) { if (Math.abs(i - 96) < 26) continue; F(i, G, z, i, G + 6, z, MAT.METAL); F(i, G + 7, z - 1, i, G + 7, z + 1, MAT.LAMP_O); }
  for (let j = 10; j < SZ - 6; j += 22) for (const x of [54, 65, 126, 137]) { if (Math.abs(j - 96) < 26) continue; F(x, G, j, x, G + 6, j, MAT.METAL); F(x - 1, G + 7, j, x + 1, G + 7, j, MAT.LAMP_W); }

  // perimeter wall with red beacons
  for (let x = 0; x < SX; x++) for (const z of [0, SZ - 1]) { F(x, G, z, x, G + 9, z, MAT.METAL); if (x % 12 === 6) w.set(x, G + 10, z, MAT.LAMP_R); }
  for (let z = 0; z < SZ; z++) for (const x of [0, SX - 1]) { F(x, G, z, x, G + 9, z, MAT.METAL); if (z % 12 === 6) w.set(x, G + 10, z, MAT.LAMP_R); }

  // ---------- Zone A: Laboratório (3 floors, west) ----------
  building(w, 14, 74, 34, 44, 3, { wall: MAT.PAINT, trim: MAT.TRIM, lamp: MAT.LAMP_C, R });
  // ---------- Zone B: Reator (centre) ----------
  reactor(w, 96, 96, R);
  // ---------- Zone C: Hangar (east) ----------
  hangar(w, 146, 72, 34, 48, R);

  // Team bases (north = team 1 / enemies, south = team 0 / player)
  base(w, 96, 12, MAT.LAMP_O, R);
  base(w, 96, SZ - 13, MAT.LAMP_C, R);

  // Secondary structures
  building(w, 70, 26, 18, 14, 2, { wall: MAT.CONCRETE, trim: MAT.TRIM, lamp: MAT.LAMP_W, R });
  building(w, 106, 150, 18, 14, 2, { wall: MAT.CONCRETE, trim: MAT.TRIM, lamp: MAT.LAMP_W, R });
  building(w, 20, 20, 22, 16, 2, { wall: MAT.BRICK, trim: MAT.TRIM, lamp: MAT.LAMP_O, R });
  building(w, 150, 156, 22, 16, 2, { wall: MAT.BRICK, trim: MAT.TRIM, lamp: MAT.LAMP_O, R });
  building(w, 150, 22, 18, 16, 1, { wall: MAT.PAINT, trim: MAT.TRIM, lamp: MAT.LAMP_M, R });
  building(w, 22, 150, 18, 16, 1, { wall: MAT.PAINT, trim: MAT.TRIM, lamp: MAT.LAMP_M, R });

  // Cover clutter: containers, jersey barriers, crates, sandbags — avoid flag circles & buildings
  const free = (x0, z0, x1, z1) => {
    for (let z = z0 - 2; z <= z1 + 2; z++) for (let x = x0 - 2; x <= x1 + 2; x++) {
      if (x < 2 || z < 2 || x >= SX - 2 || z >= SZ - 2) return false;
      for (let y = G; y < G + 3; y++) if (w.get(x, y, z) && w.get(x, y, z) !== MAT.GRASS) return false;
    }
    return true;
  };
  const containerCols = [MAT.RUST, MAT.TRIM, MAT.PAINT, MAT.METAL];
  for (let i = 0; i < 26; i++) {
    const along = R() < 0.5; const L = 12, Wd = 5;
    const x0 = 6 + R() * (SX - 24) | 0, z0 = 6 + R() * (SZ - 24) | 0;
    const x1 = x0 + (along ? L : Wd) - 1, z1 = z0 + (along ? Wd : L) - 1;
    if (!free(x0, z0, x1, z1) || nearFlag(x0, z0, 14)) continue;
    const m = containerCols[R() * 4 | 0];
    const hgt = 5;
    F(x0, G, z0, x1, G + hgt - 1, z1, m);
    // ribbing / door ends
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const edge = (along ? (x === x0 || x === x1) : (z === z0 || z === z1));
      if (edge) for (let y = G; y < G + hgt; y++) w.set(x, y, z, MAT.METAL);
    }
    if (R() < 0.35 && free(x0, z0, x1, z1 + 0)) { /* stack */ F(x0, G + hgt, z0, x1, G + hgt * 2 - 1, z1, containerCols[R() * 4 | 0]); }
  }
  for (let i = 0; i < 70; i++) {
    const x0 = 4 + R() * (SX - 12) | 0, z0 = 4 + R() * (SZ - 12) | 0;
    const t = R();
    if (t < 0.45) { // jersey barrier
      const along = R() < 0.5; const x1 = x0 + (along ? 5 : 1), z1 = z0 + (along ? 1 : 5);
      if (!free(x0, z0, x1, z1)) continue;
      F(x0, G, z0, x1, G + 1, z1, MAT.CONCRETE);
      if (along) F(x0, G + 2, z0, x1, G + 2, z0, MAT.CONCRETE); else F(x0, G + 2, z0, x0, G + 2, z1, MAT.CONCRETE);
    } else if (t < 0.75) { // crates
      if (!free(x0, z0, x0 + 2, z0 + 2)) continue;
      F(x0, G, z0, x0 + 1, G + 1, z0 + 1, MAT.WOOD);
      if (R() < 0.5) F(x0 + 1, G, z0 + 2, x0 + 2, G + 1, z0 + 3, MAT.WOOD);
      if (R() < 0.4) F(x0, G + 2, z0, x0 + 1, G + 3, z0 + 1, MAT.WOOD);
    } else if (t < 0.88) { // sandbag arc
      if (!free(x0, z0, x0 + 6, z0 + 6)) continue;
      for (let a = 0; a < Math.PI; a += 0.12) { const x = x0 + 3 + Math.round(Math.cos(a) * 3), z = z0 + 3 + Math.round(Math.sin(a) * 3); F(x, G, z, x, G + 2, z, MAT.SAND); }
    } else { // light pole
      if (!free(x0, z0, x0, z0)) continue;
      F(x0, G, z0, x0, G + 6, z0, MAT.METAL); F(x0, G + 7, z0 - 1, x0, G + 7, z0 + 1, MAT.LAMP_W);
    }
  }
  // trees on grass (low-poly blobs)
  for (let i = 0; i < 26; i++) {
    const x = 6 + R() * (SX - 12) | 0, z = 6 + R() * (SZ - 12) | 0;
    if (w.get(x, 1, z) !== MAT.GRASS || !free(x - 2, z - 2, x + 2, z + 2)) continue;
    const h = 6 + R() * 4 | 0;
    F(x, G, z, x, G + h, z, MAT.WOOD);
    const r = 2 + R() * 1.5;
    for (let dy = -2; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++)
      if (dx * dx + dz * dz + (dy * 1.2) ** 2 <= r * r + R() * 1.5) w.set(x + dx, G + h + dy, z + dz, MAT.LEAF);
  }
}

export const FLAGS = [
  { id: 'A', name: 'LABORATÓRIO', x: 31 * VS, z: 96 * VS },
  { id: 'B', name: 'REATOR', x: 96 * VS, z: 96 * VS },
  { id: 'C', name: 'HANGAR', x: 163 * VS, z: 96 * VS },
];
export const BASES = [ // spawn areas per team
  { x: 96 * VS, z: (SZ - 13) * VS, yaw: 0 },
  { x: 96 * VS, z: 12 * VS, yaw: Math.PI },
];
function nearFlag(x, z, r) { for (const f of FLAGS) if (Math.hypot(x - f.x / VS, z - f.z / VS) < r) return true; return false; }

function building(w, x0, z0, wd, dp, floors, o) {
  const FH = 7; const x1 = x0 + wd - 1, z1 = z0 + dp - 1;
  const R = o.R;
  w.fill(x0, 1, z0, x1, 1, z1, MAT.CONCRETE);
  for (let f = 0; f < floors; f++) {
    const yb = G + f * FH;
    // slab
    w.fill(x0, yb - 1, z0, x1, yb - 1, z1, MAT.CONCRETE);
    // walls
    for (let y = yb; y < yb + FH - 1; y++) {
      for (let x = x0; x <= x1; x++) { w.set(x, y, z0, o.wall); w.set(x, y, z1, o.wall); }
      for (let z = z0; z <= z1; z++) { w.set(x0, y, z, o.wall); w.set(x1, y, z, o.wall); }
    }
    // pillars / trim at corners
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) w.fill(x, yb, z, x, yb + FH - 2, z, o.trim);
    // window bands (glass) – skip corners
    for (let x = x0 + 2; x <= x1 - 2; x++) if ((x - x0) % 5 !== 0) { w.fill(x, yb + 2, z0, x, yb + 3, z0, MAT.GLASS); w.fill(x, yb + 2, z1, x, yb + 3, z1, MAT.GLASS); }
    for (let z = z0 + 2; z <= z1 - 2; z++) if ((z - z0) % 5 !== 0) { w.fill(x0, yb + 2, z, x0, yb + 3, z, MAT.GLASS); w.fill(x1, yb + 2, z, x1, yb + 3, z, MAT.GLASS); }
    // ceiling lamp strips
    for (let x = x0 + 4; x <= x1 - 4; x += 8) for (let z = z0 + 4; z <= z1 - 4; z += 8) w.fill(x, yb + FH - 2, z, x, yb + FH - 2, z + 1, o.lamp);
    // trim stripe outside between floors
    for (let x = x0; x <= x1; x++) { w.set(x, yb - 1, z0, o.trim); w.set(x, yb - 1, z1, o.trim); }
    for (let z = z0; z <= z1; z++) { w.set(x0, yb - 1, z, o.trim); w.set(x1, yb - 1, z, o.trim); }
    // interior partition with doorway (cover inside)
    if (wd > 20) {
      const xm = x0 + (wd / 2 | 0);
      for (let y = yb; y < yb + FH - 1; y++) for (let z = z0 + 1; z < z1; z++) w.set(xm, y, z, MAT.CONCRETE);
      const dz = z0 + (dp / 2 | 0); w.fill(xm, yb, dz - 2, xm, yb + 4, dz + 2, 0);
      w.fill(xm, yb, z0 + 4, xm, yb + 4, z0 + 6, 0); w.fill(xm, yb, z1 - 6, xm, yb + 4, z1 - 4, 0);
    }
  }
  // roof slab + parapet + neon edge
  const yr = G + floors * FH - 1;
  w.fill(x0, yr, z0, x1, yr, z1, MAT.CONCRETE);
  for (let x = x0; x <= x1; x++) { w.set(x, yr + 1, z0, o.wall); w.set(x, yr + 1, z1, o.wall); }
  for (let z = z0; z <= z1; z++) { w.set(x0, yr + 1, z, o.wall); w.set(x1, yr + 1, z, o.wall); }
  for (let x = x0 + 1; x < x1; x += 3) w.set(x, yr + 1, z0, o.lamp);
  // rooftop unit
  w.fill(x0 + 3, yr + 1, z0 + 3, x0 + 6, yr + 3, z0 + 7, MAT.METAL);
  // doors: centre of each side on ground floor (3 wide, 5 tall)
  const mx = (x0 + x1) >> 1, mz = (z0 + z1) >> 1;
  w.fill(mx - 1, G, z0, mx + 1, G + 4, z0, 0); w.fill(mx - 1, G, z1, mx + 1, G + 4, z1, 0);
  w.fill(x0, G, mz - 1, x0, G + 4, mz + 1, 0); w.fill(x1, G, mz - 1, x1, G + 4, mz + 1, 0);
  // door frames lit
  w.set(mx, G + 5, z0, o.lamp); w.set(mx, G + 5, z1, o.lamp); w.set(x0, G + 5, mz, o.lamp); w.set(x1, G + 5, mz, o.lamp);
  // staircase in a corner going up through every floor (and to roof)
  for (let f = 0; f < floors; f++) {
    const yb = G + f * FH; const sx = x0 + 2 + (f % 2 ? 0 : 0), sz = z0 + 2;
    const dir = f % 2 === 0 ? 1 : -1; const startX = dir > 0 ? x0 + 2 : x0 + 2 + FH;
    for (let s = 0; s < FH; s++) {
      const x = startX + dir * s;
      w.fill(x, yb, sz, x, yb + s, sz + 2, MAT.CONCRETE);
      w.fill(x, yb + s + 1, sz, x, yb + s + 5, sz + 2, 0); // headroom / hole through slab
    }
  }
  // some interior cover: desks
  for (let f = 0; f < floors; f++) {
    const yb = G + f * FH;
    for (let i = 0; i < Math.floor(wd * dp / 120); i++) {
      const x = x0 + 4 + (R() * (wd - 8) | 0), z = z0 + 7 + (R() * (dp - 10) | 0);
      if (w.get(x, yb, z) || w.get(x + 2, yb, z + 1)) continue;
      w.fill(x, yb, z, x + 2, yb + 1, z + 1, R() < 0.5 ? MAT.WOOD : MAT.METAL);
    }
  }
}

function reactor(w, cx, cz, R) {
  // raised platform ring with ramps, central reactor core with magenta glow
  const r0 = 22;
  for (let z = cz - r0; z <= cz + r0; z++) for (let x = cx - r0; x <= cx + r0; x++) {
    const d = Math.hypot(x - cx, z - cz);
    if (d <= r0) w.set(x, 1, z, MAT.CONCRETE);
    if (d > r0 - 1.2 && d <= r0) w.set(x, 1, z, MAT.LINE);
    if (d <= 9) w.fill(x, G, z, x, G, z, MAT.METAL);
    if (d <= 6) w.fill(x, G + 1, z, x, G + 1, z, MAT.TRIM);
    if (d <= 3.6) w.fill(x, G + 2, z, x, G + 14, z, d > 2.5 ? MAT.GLASS : d < 1.2 ? MAT.LAMP_M : MAT.METAL);
    if (d > 4.5 && d <= 5.6) { w.fill(x, G + 2, z, x, G + 3, z, MAT.METAL); w.set(x, G + 10, z, MAT.METAL); w.set(x, G + 15, z, MAT.TRIM); }
    if (d > 16 && d <= 17 && ((Math.atan2(z - cz, x - cx) * 8 / Math.PI) | 0) % 2 === 0) w.fill(x, G, z, x, G + 2, z, MAT.CONCRETE);
  }
  // pylons
  for (let a = 0; a < 4; a++) {
    const ang = a * Math.PI / 2 + Math.PI / 4; const px = Math.round(cx + Math.cos(ang) * 12), pz = Math.round(cz + Math.sin(ang) * 12);
    w.fill(px - 1, G, pz - 1, px + 1, G + 12, pz + 1, MAT.METAL);
    w.fill(px - 1, G + 13, pz - 1, px + 1, G + 13, pz + 1, MAT.LAMP_M);
    // arc conduit to core
    for (let t = 0; t <= 1; t += 0.04) { const x = Math.round(px + (cx - px) * t), z = Math.round(pz + (cz - pz) * t); w.set(x, G + 12 + Math.round(Math.sin(t * Math.PI) * 3), z, MAT.TRIM); }
  }
}

function hangar(w, x0, z0, wd, dp, R) {
  const x1 = x0 + wd - 1, z1 = z0 + dp - 1, H = 16;
  w.fill(x0, 1, z0, x1, 1, z1, MAT.CONCRETE);
  // walls of corrugated metal (destructible but tough) with concrete base
  for (let y = G; y < G + H; y++) {
    const m = y < G + 3 ? MAT.CONCRETE : MAT.RUST;
    for (let x = x0; x <= x1; x++) { w.set(x, y, z0, m); w.set(x, y, z1, m); }
    for (let z = z0; z <= z1; z++) { w.set(x0, y, z, m); w.set(x1, y, z, m); }
  }
  // arched roof
  for (let x = x0; x <= x1; x++) {
    const t = (x - x0) / (wd - 1); const hy = G + H + Math.round(Math.sin(t * Math.PI) * 5);
    for (let z = z0; z <= z1; z++) w.set(x, hy, z, MAT.METAL);
    for (let y = G + H; y < hy; y++) { w.set(x, y, z0, MAT.METAL); w.set(x, y, z1, MAT.METAL); }
  }
  // big doors (west and east) and side doors
  const mz = (z0 + z1) >> 1;
  w.fill(x0, G, mz - 7, x0, G + 10, mz + 7, 0);
  w.fill(x1, G, mz - 5, x1, G + 8, mz + 5, 0);
  w.fill(x0 + 10, G, z0, x0 + 12, G + 4, z0, 0); w.fill(x0 + 10, G, z1, x0 + 12, G + 4, z1, 0);
  // hazard stripes on floor & lamps on ceiling
  for (let z = z0 + 1; z < z1; z++) if (((z >> 1) & 1)) { w.set(x0 + 1, 1, z, MAT.LINE); w.set(x1 - 1, 1, z, MAT.LINE); }
  for (let x = x0 + 4; x < x1 - 2; x += 8) for (let z = z0 + 6; z < z1 - 4; z += 10) w.fill(x, G + H - 1, z, x + 1, G + H - 1, z, MAT.LAMP_O);
  // catwalk along north wall with ladder-steps
  w.fill(x0 + 1, G + 7, z0 + 1, x1 - 1, G + 7, z0 + 3, MAT.METAL);
  for (let s = 0; s < 8; s++) w.fill(x1 - 3 - s, G + s, z0 + 4, x1 - 3 - s, G + s, z0 + 6, MAT.METAL);
  // parked shuttle (low-poly prism) as central cover
  const sx = x0 + 10, sz = mz;
  for (let x = sx; x < sx + 16; x++) {
    const t = (x - sx) / 16; const half = Math.round(2 + Math.sin(t * Math.PI) * 3);
    for (let z = sz - half; z <= sz + half; z++) for (let y = G + 1; y < G + 1 + Math.round(2 + Math.sin(t * Math.PI) * 3); y++) w.set(x, y, z, z === sz - half || z === sz + half ? MAT.TRIM : MAT.PAINT);
    w.set(x, G + 1 + Math.round(2 + Math.sin(t * Math.PI) * 3), sz, MAT.GLASS);
  }
  w.fill(sx + 2, G, sz - 1, sx + 3, G, sz + 1, MAT.METAL); w.fill(sx + 12, G, sz - 1, sx + 13, G, sz + 1, MAT.METAL);
  w.fill(sx - 1, G + 2, sz - 1, sx - 1, G + 3, sz + 1, MAT.LAMP_C);
  // container stacks inside
  w.fill(x1 - 9, G, z1 - 7, x1 - 2, G + 4, z1 - 3, MAT.TRIM);
  w.fill(x1 - 9, G + 5, z1 - 7, x1 - 2, G + 9, z1 - 3, MAT.RUST);
}

function base(w, cx, cz, lamp, R) {
  // spawn bunker: U-shaped wall, landing pad lights
  for (let x = cx - 14; x <= cx + 14; x++) for (let z = cz - 6; z <= cz + 6; z++) {
    w.set(x, 1, z, MAT.CONCRETE);
    if ((x === cx - 14 || x === cx + 14) && (z % 3 === 0)) w.set(x, 1, z, lamp);
  }
  const back = cz < SZ / 2 ? cz - 7 : cz + 7;
  w.fill(cx - 15, G, back, cx + 15, G + 6, back, MAT.CONCRETE);
  w.fill(cx - 15, G, Math.min(back, cz), cx - 15, G + 3, Math.max(back, cz), MAT.CONCRETE);
  w.fill(cx + 15, G, Math.min(back, cz), cx + 15, G + 3, Math.max(back, cz), MAT.CONCRETE);
  for (let x = cx - 14; x <= cx + 14; x += 4) w.set(x, G + 7, back, lamp);
}
