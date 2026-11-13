// Procedural map: "Instituto Kappa" — research facility at night. Deterministic (seeded).
import { MAT, SX, SY, SZ, VS } from './world.js';

export const G = 2; // first air layer above ground (ground surface at y = 1)

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// World-space centres (metres) of every explosive barrel placed by generate(): [{x, y, z}]
export const BARRELS = [];

export function generate(w, seed = 7) {
  const R = rng(seed);
  BARRELS.length = 0;
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

  // ---------- v2 detail pass ----------
  detail(w, R);

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
    // window frames: mullions + flush sills in trim; upper floors get a protruding ledge under the band
    for (let x = x0 + 2; x <= x1 - 2; x++) {
      if ((x - x0) % 5 === 0) { w.fill(x, yb + 2, z0, x, yb + 3, z0, o.trim); w.fill(x, yb + 2, z1, x, yb + 3, z1, o.trim); }
      w.set(x, yb + 1, z0, o.trim); w.set(x, yb + 1, z1, o.trim);
      if (f > 0) { w.set(x, yb + 1, z0 - 1, MAT.CONCRETE); w.set(x, yb + 1, z1 + 1, MAT.CONCRETE); }
    }
    for (let z = z0 + 2; z <= z1 - 2; z++) {
      if ((z - z0) % 5 === 0) { w.fill(x0, yb + 2, z, x0, yb + 3, z, o.trim); w.fill(x1, yb + 2, z, x1, yb + 3, z, o.trim); }
      w.set(x0, yb + 1, z, o.trim); w.set(x1, yb + 1, z, o.trim);
      if (f > 0) { w.set(x0 - 1, yb + 1, z, MAT.CONCRETE); w.set(x1 + 1, yb + 1, z, MAT.CONCRETE); }
    }
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
  // entrance canopies (thin slab, 1.5 m deep) with a downlight
  w.fill(mx - 3, G + 6, z0 - 3, mx + 3, G + 6, z0 - 1, MAT.CONCRETE); w.set(mx, G + 6, z0 - 2, MAT.LAMP_W);
  w.fill(mx - 3, G + 6, z1 + 1, mx + 3, G + 6, z1 + 3, MAT.CONCRETE); w.set(mx, G + 6, z1 + 2, MAT.LAMP_W);
  w.fill(x0 - 3, G + 6, mz - 3, x0 - 1, G + 6, mz + 3, MAT.CONCRETE); w.set(x0 - 2, G + 6, mz, MAT.LAMP_W);
  w.fill(x1 + 1, G + 6, mz - 3, x1 + 3, G + 6, mz + 3, MAT.CONCRETE); w.set(x1 + 2, G + 6, mz, MAT.LAMP_W);
  // rooftop: AC units with fan grilles, vents, antenna mast with red beacon
  if (wd > 12) {
    for (const az of [z0 + 3, z1 - 5]) { w.fill(x1 - 5, yr + 1, az, x1 - 3, yr + 2, az + 2, MAT.METAL); w.set(x1 - 4, yr + 3, az + 1, MAT.PANEL); w.fill(x1 - 6, yr + 1, az + 1, x1 - 6, yr + 1, az + 1, MAT.PANEL); }
    const ax = x0 + (wd >> 1), az = z1 - 2;
    w.fill(ax, yr + 1, az, ax, yr + 8, az, MAT.METAL); w.fill(ax - 1, yr + 6, az, ax + 1, yr + 6, az, MAT.METAL); w.set(ax, yr + 9, az, MAT.LAMP_R);
    for (let i = 0; i < 3; i++) { const vx = x0 + 12 + (R() * (wd - 16) | 0), vz = z0 + 6 + (R() * (dp - 10) | 0); if (!w.get(vx, yr + 1, vz)) { w.fill(vx, yr + 1, vz, vx, yr + 2, vz, MAT.METAL); w.set(vx, yr + 3, vz, MAT.PANEL); } }
  }
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

// ======================================================================================
// v2 DETAIL PASS: vehicles, industrial props, signage, explosive barrels, ground detail.
// ======================================================================================
const GLYPH = {
  K: ['1.1', '1.1', '11.', '1.1', '1.1'], A: ['.1.', '1.1', '111', '1.1', '1.1'], P: ['11.', '1.1', '11.', '1..', '1..'],
  O: ['111', '1.1', '1.1', '1.1', '111'], M: ['1.1', '111', '111', '1.1', '1.1'], E: ['111', '1..', '11.', '1..', '111'],
  G: ['111', '1..', '1.1', '1.1', '111'], H: ['1.1', '1.1', '111', '1.1', '1.1'], N: ['11.', '1.1', '1.1', '1.1', '1.1'],
  R: ['11.', '1.1', '11.', '1.1', '1.1'], C: ['111', '1..', '1..', '1..', '111'], B: ['11.', '1.1', '11.', '1.1', '11.'],
  T: ['111', '.1.', '.1.', '.1.', '.1.'], L: ['1..', '1..', '1..', '1..', '111'], I: ['111', '.1.', '.1.', '.1.', '111'],
  S: ['111', '1..', '111', '..1', '111'], 0: ['111', '1.1', '1.1', '1.1', '111'], 1: ['.1.', '11.', '.1.', '.1.', '111'],
  2: ['111', '..1', '111', '1..', '111'], 3: ['111', '..1', '.11', '..1', '111'], '-': ['...', '...', '111', '...', '...'], ' ': ['...', '...', '...', '...', '...'],
};
// Vertical sign: text runs along (ux, uz) starting at (x, z); rows go down from yTop. Unlit cells = backing.
function sign(w, text, x, yTop, z, ux, uz, lit, back = MAT.PANEL, frame = true) {
  const tw = text.length * 4 - 1;
  for (let c = frame ? -1 : 0; c <= (frame ? tw : tw - 1); c++) for (let r = frame ? -1 : 0; r <= (frame ? 5 : 4); r++) {
    let m = back;
    if (c >= 0 && c < tw && r >= 0 && r < 5) { const g = GLYPH[text[(c / 4) | 0]] || GLYPH[' ']; const gc = c % 4; if (gc < 3 && g[r][gc] === '1') m = lit; }
    w.set(x + ux * c, yTop - r, z + uz * c, m);
  }
}
// Floor paint: glyphs scaled by k, rows along +x, text along +z
function floorText(w, text, x, z, k, m) {
  for (let i = 0; i < text.length; i++) { const g = GLYPH[text[i]]; for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r][c] === '1')
    w.fill(x + r * k, 1, z + i * 4 * k + c * k, x + r * k + k - 1, 1, z + i * 4 * k + c * k + k - 1, m); }
}

function vehicle(w, x0, z0, alongX, kind, col, flip = false, R) {
  const L = kind === 'van' ? 10 : kind === 'truck' ? 14 : 9;
  const S = (i, j, y, m) => { if (flip) i = L - 1 - i; if (alongX) w.set(x0 + i, y, z0 + j, m); else w.set(x0 + j, y, z0 + i, m); };
  const wheels = kind === 'truck' ? [1, 2, 5, 6, 11, 12] : [1, 2, L - 3, L - 2];
  for (let i = 0; i < L; i++) for (let j = 0; j < 4; j++) {
    const edge = j === 0 || j === 3;
    S(i, j, G, edge && wheels.includes(i) ? MAT.TIRE : (edge ? col : MAT.PANEL));
    let m1 = col;
    if (i === 0 && edge) m1 = MAT.LAMP_R;
    if (i === L - 1) m1 = edge ? MAT.LAMP_W : MAT.PANEL;
    if (kind === 'truck' && i < 10) m1 = MAT.METAL; // flatbed
    S(i, j, G + 1, m1);
  }
  if (kind === 'car') {
    for (let i = 2; i <= L - 4; i++) for (let j = 0; j < 4; j++) {
      const ring = j === 0 || j === 3 || i === 2 || i === L - 4;
      const pillar = (i === 2 || i === L - 4) && (j === 0 || j === 3);
      S(i, j, G + 2, pillar ? col : ring ? MAT.GLASS : col);
    }
  } else {
    const c0 = kind === 'van' ? 0 : 10, c1 = L - 2;
    for (let i = c0; i <= c1; i++) for (let j = 0; j < 4; j++) {
      const wind = i === c1 || (i === c1 - 1 && (j === 0 || j === 3));
      S(i, j, G + 2, wind ? MAT.GLASS : col); S(i, j, G + 3, i === c1 && j > 0 && j < 3 ? MAT.GLASS : col);
    }
    if (kind === 'van') for (let y = G + 1; y <= G + 3; y++) { S(0, 1, y, MAT.PANEL); S(0, 2, y, MAT.PANEL); }
    if (kind === 'truck') {
      if (R() < 0.5) { // crate cargo
        for (let i = 1; i <= 8; i++) for (let j = 0; j < 4; j++) if ((i % 4) !== 0) { S(i, j, G + 2, MAT.WOOD); if (i < 4) S(i, j, G + 3, MAT.WOOD); }
      } else { // tank cargo
        for (let i = 1; i <= 8; i++) for (let j = 0; j < 4; j++) for (let y = G + 2; y <= G + 4; y++) {
          const corner = (j === 0 || j === 3) && (y === G + 4); if (!corner) S(i, j, y, i === 1 || i === 8 ? MAT.METAL : MAT.OLIVE);
        }
        S(4, 1, G + 5, MAT.METAL); S(4, 2, G + 5, MAT.LINE);
      }
    }
  }
}

function barrel(w, x, z) {
  for (let y = G; y <= G + 2; y++) for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (w.get(x + dx, y, z + dz)) return false;
  for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) { w.set(x + dx, G, z + dz, MAT.BARREL); w.set(x + dx, G + 1, z + dz, MAT.LINE); w.set(x + dx, G + 2, z + dz, MAT.BARREL); }
  BARRELS.push({ x: (x + 1) * VS, y: (G + 1.5) * VS, z: (z + 1) * VS });
  return true;
}
function barrels(w, x, z, n) { const P = [[0, 0], [3, 0], [1, 3], [4, 3]]; for (let i = 0; i < n; i++) barrel(w, x + P[i][0], z + P[i][1]); }

function fence(w, x0, z0, x1, z1, gaps = []) {
  // posts every 4, two thin rails; gaps = [[a,b]] ranges along the run that stay open
  const alongX = z0 === z1, n = alongX ? x1 - x0 : z1 - z0;
  for (let k = 0; k <= n; k++) {
    if (gaps.some(([a, b]) => k >= a && k <= b)) continue;
    const x = alongX ? x0 + k : x0, z = alongX ? z0 : z0 + k;
    if (k % 4 === 0) w.fill(x, G, z, x, G + 4, z, MAT.METAL);
    else { w.set(x, G + 1, z, MAT.METAL); w.set(x, G + 3, z, MAT.METAL); }
  }
}
function hazardBarrier(w, x0, z0, alongX, len) {
  for (let k = 0; k < len; k++) {
    const x = alongX ? x0 + k : x0, z = alongX ? z0 : z0 + k;
    w.fill(x, G, z, x, G + 1, z, MAT.CONCRETE); w.set(x, G + 2, z, ((k >> 1) & 1) ? MAT.LINE : MAT.PANEL);
  }
}
function pipeRack(w, xa, xb, z) { // overhead pipe bridge across a road (x from xa to xb at row z)
  for (const px of [xa, xb]) { w.fill(px, G, z, px + 1, G + 8, z + 1, MAT.METAL); }
  w.fill(xa, G + 7, z, xb + 1, G + 7, z, MAT.METAL); w.fill(xa, G + 8, z + 1, xb + 1, G + 8, z + 1, MAT.RUST);
  w.fill(xa, G + 9, z, xb + 1, G + 9, z, MAT.OLIVE);
  w.set((xa + xb) >> 1, G + 6, z, MAT.LAMP_O);
}

function detail(w, R) {
  const get = (x, y, z) => w.get(x, y, z);
  // ---- ground: sidewalks, repaired patches, cracks, manholes, puddles ----
  const pave = (x0, z0, x1, z1) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { const m = get(x, 1, z); if (m === MAT.ASPHALT || m === MAT.GRASS) { w.set(x, 1, z, MAT.CONCRETE); if (get(x, 2, z) === MAT.GRASS) w.set(x, 2, z, 0); } } };
  pave(1, 89, SX - 2, 91); pave(1, 100, SX - 2, 102);
  pave(53, 1, 55, SZ - 2); pave(64, 1, 66, SZ - 2); pave(125, 1, 127, SZ - 2); pave(136, 1, 138, SZ - 2);
  for (let i = 0; i < 14; i++) { const x = 4 + R() * (SX - 12) | 0, z = 4 + R() * (SZ - 12) | 0, a = 3 + R() * 6 | 0, b = 3 + R() * 6 | 0;
    for (let zz = z; zz < z + b; zz++) for (let xx = x; xx < x + a; xx++) if (get(xx, 1, zz) === MAT.ASPHALT) w.set(xx, 1, zz, MAT.ASPHALT2); }
  for (let i = 0; i < 60; i++) { let x = 4 + R() * (SX - 8) | 0, z = 4 + R() * (SZ - 8) | 0; const len = 6 + R() * 14 | 0;
    for (let k = 0; k < len; k++) { if (get(x, 1, z) === MAT.ASPHALT) w.set(x, 1, z, MAT.ASPHALT2); if (R() < 0.5) x += R() < 0.5 ? 1 : -1; else z += R() < 0.5 ? 1 : -1; } }
  for (let x = 12; x < SX - 8; x += 26) if (get(x, 1, 93) === MAT.ASPHALT) w.fill(x, 1, 93, x + 1, 1, 94, MAT.METAL);
  for (const rx of [58, 130]) for (let z = 14; z < SZ - 8; z += 26) if (get(rx, 1, z) === MAT.ASPHALT) w.fill(rx, 1, z, rx + 1, 1, z + 1, MAT.METAL);
  for (let i = 0; i < 45; i++) { const cx = 4 + R() * (SX - 8), cz = 4 + R() * (SZ - 8), r = 1.2 + R() * 2.8, sq = 0.5 + R();
    for (let z = Math.floor(cz - r * 1.6); z <= cz + r * 1.6; z++) for (let x = Math.floor(cx - r * 1.6); x <= cx + r * 1.6; x++) {
      if (Math.hypot((x - cx) * sq, (z - cz) / sq) > r) continue; const m = get(x, 1, z);
      if ((m === MAT.ASPHALT || m === MAT.ASPHALT2) && !get(x, 2, z)) w.set(x, 1, z, MAT.WATER); } }

  // ---- parked vehicles along the roads ----
  const cols = [MAT.CAR_A, MAT.CAR_B, MAT.CAR_C, MAT.PAINT, MAT.PANEL, MAT.OLIVE];
  const V = [
    [56, 18, false, 'car'], [60, 40, false, 'van'], [56, 64, false, 'car'], [60, 116, false, 'car'], [56, 136, false, 'truck'], [60, 166, false, 'car'],
    [132, 18, false, 'truck'], [128, 46, false, 'car'], [132, 64, false, 'van'], [128, 122, false, 'car'], [132, 140, false, 'car'], [128, 160, false, 'van'],
    [64, 96, true, 'car'], [2, 92, true, 'van'], [181, 96, true, 'car'],
  ];
  V.forEach(([x, z, ax, k], i) => vehicle(w, x, z, ax, k, k === 'truck' ? MAT.OLIVE : cols[(i * 7 + (R() * 3 | 0)) % cols.length], R() < 0.5, R));

  // ---- signage ----
  sign(w, 'KAPPA', 48, 16, 105, 0, -1, MAT.LAMP_C);          // lab east facade (reads from the road)
  sign(w, 'LAB', 26, 16, 73, 1, 0, MAT.LAMP_M);              // lab north facade
  sign(w, 'HANGAR', 145, 17, 84, 0, 1, MAT.LAMP_O, MAT.PANEL, false); // hangar west face above the big door
  sign(w, 'KAPPA', 105, G + 5, 185, -1, 0, MAT.LAMP_C);      // own base back wall (inner face)
  sign(w, 'OMEGA', 87, G + 5, 6, 1, 0, MAT.LAMP_O);           // enemy base back wall
  floorText(w, '03', 149, 104, 2, MAT.LINE);                  // hangar floor marking
  sign(w, 'C', 145, G + 3, 104, 0, 1, MAT.LINE, MAT.PANEL);   // zone letter beside the hangar door

  // ---- lab: server racks (2nd floor), lab benches (ground + 3rd floor), radar on the roof ----
  { const yb = G + 7;
    for (const rz of [84, 88, 100, 104]) for (let x = 16; x <= 29; x++) {
      if (x === 22 || x === 23) continue;
      for (let y = yb; y <= yb + 4; y++) for (const z of [rz, rz + 1]) {
        if (get(x, y, z)) continue;
        const face = (z === rz || z === rz + 1) && y > yb && y < yb + 4 && (x + y) % 3 === 0;
        w.set(x, y, z, face ? [MAT.LAMP_C, MAT.LAMP_O, MAT.LAMP_C][(x + y + z) % 3] : MAT.METAL);
      }
    }
    const y3 = G + 14;
    for (const bz of [82, 88, 100]) for (let x = 34; x <= 44; x++) { if (x === 39 || get(x, y3, bz)) continue; w.fill(x, y3, bz, x, y3 + 1, bz + 1, MAT.PANEL); if (x % 3 === 0) w.set(x, y3 + 2, bz, MAT.METAL); }
    for (const [bx, bz] of [[18, 86], [38, 106]]) { w.fill(bx, G, bz, bx + 5, G + 1, bz + 1, MAT.PANEL); w.set(bx + 2, G + 2, bz, MAT.METAL); w.set(bx + 3, G + 2, bz + 1, MAT.LAMP_C); }
    // radar dish on the lab roof
    const yr = G + 3 * 7 - 1, cx = 38, cz = 106;
    w.fill(cx, yr + 1, cz, cx + 1, yr + 4, cz + 1, MAT.METAL);
    const n = [0.55, 0.62, -0.55]; const nl = Math.hypot(...n); n[0] /= nl; n[1] /= nl; n[2] /= nl;
    const c = [cx + 1, yr + 8, cz + 1];
    for (let dy = -5; dy <= 5; dy++) for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) {
      const along = dx * n[0] + dy * n[1] + dz * n[2]; const px = dx - n[0] * along, py = dy - n[1] * along, pz = dz - n[2] * along;
      const rad = Math.hypot(px, py, pz); const bowl = rad * rad * 0.08;            // paraboloid depth
      if (rad <= 4 && Math.abs(along - bowl) < 0.55) w.set(c[0] + dx, c[1] + dy, c[2] + dz, rad > 3.3 ? MAT.TRIM : MAT.METAL);
    }
    for (let t = 0; t <= 2.6; t += 0.5) w.set(Math.round(c[0] + n[0] * t), Math.round(c[1] + n[1] * t), Math.round(c[2] + n[2] * t), MAT.METAL);
    w.set(Math.round(c[0] + n[0] * 3), Math.round(c[1] + n[1] * 3), Math.round(c[2] + n[2] * 3), MAT.LAMP_R);
  }

  // ---- sniper tower east of the lab + skybridge to the lab's 3rd floor ----
  { const y = G + 13; // deck level (stand on y+1 = lab 3rd floor)
    for (const [px, pz] of [[66, 105], [72, 105], [66, 113], [72, 113]]) { w.fill(px, G, pz, px, y + 5, pz, MAT.METAL); }
    w.fill(66, y, 105, 72, y, 113, MAT.METAL);
    for (let x = 66; x <= 72; x++) { w.set(x, y + 1, 105, MAT.SAND); w.set(x, y + 1, 113, x >= 69 && x <= 71 ? 0 : MAT.SAND); }
    for (let z = 105; z <= 113; z++) { w.set(72, y + 1, z, MAT.SAND); if (z < 107 || z > 111) w.set(66, y + 1, z, MAT.SAND); }
    w.fill(66, y + 6, 105, 72, y + 6, 113, MAT.RUST); w.set(69, y + 6, 109, MAT.LAMP_O);
    w.fill(69, y + 7, 109, 69, y + 10, 109, MAT.METAL); w.set(69, y + 11, 109, MAT.LAMP_R);
    // bridge deck + railings, door cut into the lab
    w.fill(48, y, 107, 65, y, 111, MAT.METAL);
    for (let x = 48; x <= 65; x++) { if (x % 2 === 0) { w.set(x, y + 1, 107, MAT.METAL); w.set(x, y + 1, 111, MAT.METAL); } w.set(x, y + 2, 107, MAT.METAL); w.set(x, y + 2, 111, MAT.METAL); }
    w.set(57, y - 1, 109, MAT.LAMP_W);
    w.fill(47, y + 1, 108, 47, y + 4, 110, 0);
    // stairs from the ground (south side): 1 voxel per step
    for (let k = 0; k <= 13; k++) { const z = 127 - k; w.fill(69, G, z, 71, G + k, z, MAT.CONCRETE); w.fill(69, G + k + 1, z, 71, G + k + 5, z, 0); }
  }

  // ---- water tower ----
  { const cx = 36, cz = 52, top = G + 14;
    for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) w.fill(cx + dx, G, cz + dz, cx + dx, top, cz + dz, MAT.METAL);
    for (let k = 0; k <= 6; k++) { for (const hy of [G + 4, G + 9]) { w.set(cx - 3 + k, hy + (k >> 1), cz - 3, MAT.RUST); w.set(cx - 3 + k, hy + (k >> 1), cz + 3, MAT.RUST); w.set(cx - 3, hy + (k >> 1), cz - 3 + k, MAT.RUST); w.set(cx + 3, hy + (k >> 1), cz - 3 + k, MAT.RUST); } }
    for (let y = top + 1; y <= top + 9; y++) for (let z = cz - 5; z <= cz + 5; z++) for (let x = cx - 5; x <= cx + 5; x++) {
      const d = Math.hypot(x - cx, z - cz); const rr = y > top + 7 ? 4.6 - (y - top - 7) * 1.8 : 4.6;
      if (d <= rr && (d > rr - 1.2 || y === top + 1 || y >= top + 7)) w.set(x, y, z, y === top + 4 ? MAT.LINE : MAT.OLIVE);
    }
    w.set(cx, top + 11, cz, MAT.LAMP_R);
  }

  // ---- generator yard (fenced) with transformer, pallets, cable tray to the hangar ----
  { const x0 = 152, z0 = 126, x1 = 176, z1 = 148;
    fence(w, x0, z0, x1, z0, [[9, 13]]); fence(w, x0, z1, x1, z1, [[16, 19]]); fence(w, x0, z0, x0, z1, [[9, 12]]); fence(w, x1, z0, x1, z1);
    for (const [gx, gz] of [[156, 130], [156, 137], [166, 130]]) {
      w.fill(gx, G, gz, gx + 5, G + 2, gz + 2, MAT.OLIVE); w.fill(gx + 1, G + 1, gz - 0, gx + 4, G + 1, gz, MAT.PANEL);
      w.set(gx + 5, G + 2, gz + 1, MAT.LAMP_C); w.fill(gx + 1, G + 3, gz + 1, gx + 1, G + 5, gz + 1, MAT.METAL);
    }
    w.fill(167, G, 140, 170, G + 4, 143, MAT.METAL); w.set(167, G + 3, 141, MAT.LAMP_O); w.fill(168, G + 5, 141, 169, G + 6, 142, MAT.TRIM);
    for (let k = 0; k < 3; k++) w.fill(172, G + k, 144, 174, G + k, 146, MAT.WOOD);
    for (let x = 147; x <= 178; x++) { w.set(x, G + 8, 120, MAT.METAL); if (x % 6 === 0) w.set(x, G + 7, 120, MAT.METAL); }
  }

  // ---- overhead pipe racks across both north-south roads, wall pipes along the lab ----
  pipeRack(w, 123, 139, 60);
  pipeRack(w, 51, 67, 128);
  for (let z = 76; z <= 115; z++) { w.set(13, G + 5, z, MAT.METAL); w.set(13, G + 6, z, MAT.RUST); if (z % 12 === 4) w.fill(13, G, z, 13, G + 4, z, MAT.METAL); }
  for (let x = 16; x <= 45; x++) { if (!get(x, G + 9, 73)) w.set(x, G + 9, 73, MAT.METAL); }

  // ---- fences, checkpoint booth, hazard chicanes, pallets ----
  fence(w, 51, 132, 51, 170, [[10, 14], [26, 30]]);
  fence(w, 4, 70, 44, 70, [[22, 30]]);
  { const bx = 67, bz = 146; // checkpoint booth
    for (let y = G; y <= G + 4; y++) for (let z = bz; z <= bz + 3; z++) for (let x = bx; x <= bx + 3; x++) {
      const edge = x === bx || x === bx + 3 || z === bz || z === bz + 3; if (!edge) continue;
      w.set(x, y, z, (y === G + 2 || y === G + 3) && !(x === bx + 3 && z === bz + 3) && !(x === bx && z === bz) ? MAT.GLASS : MAT.PAINT);
    }
    w.fill(bx, G, bz + 1, bx, G + 3, bz + 2, 0); w.fill(bx - 1, G + 5, bz - 1, bx + 4, G + 5, bz + 4, MAT.TRIM); w.set(bx + 1, G + 5, bz + 1, MAT.LAMP_W);
  }
  hazardBarrier(w, 56, 153, true, 5); hazardBarrier(w, 59, 158, true, 5);
  hazardBarrier(w, 131, 37, true, 5); hazardBarrier(w, 128, 42, true, 5);
  hazardBarrier(w, 116, 70, true, 6); hazardBarrier(w, 72, 120, true, 6);
  for (const [px, pz] of [[6, 80], [6, 104], [44, 60], [118, 40], [176, 60], [140, 170]]) { const n = 1 + ((px + pz) % 3);
    let ok = true; for (let y = G; y < G + n; y++) for (let z = pz; z < pz + 3; z++) for (let x = px; x < px + 3; x++) if (get(x, y, z)) ok = false;
    if (ok) for (let k = 0; k < n; k++) w.fill(px, G + k, pz, px + 2, G + k, pz + 2, MAT.WOOD); }

  // ---- explosive barrel clusters (near flags & cover, never in spawn bases) ----
  barrels(w, 49, 84, 2); barrels(w, 49, 104, 2); barrels(w, 114, 79, 3); barrels(w, 75, 112, 2);
  barrels(w, 139, 81, 2); barrels(w, 139, 108, 3); barrels(w, 166, 108, 2); barrels(w, 70, 62, 2);
  barrels(w, 119, 128, 3); barrels(w, 42, 140, 2); barrels(w, 150, 60, 2); barrels(w, 8, 58, 2); barrels(w, 159, 141, 2);
}
