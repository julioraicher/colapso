// Voxel world: storage, chunked meshing with baked lighting (AO + sun shadow), DDA raycast,
// AABB collision, destruction with structural-integrity collapse.
import * as THREE from 'three';

export const VS = 0.5;            // voxel size in metres
export const SX = 192, SY = 48, SZ = 192;
export const CS = 16;             // chunk size (voxels)
const CX = SX / CS, CY = SY / CS, CZ = SZ / CS;

// Material table. hp: bullet-hits to break (255 = indestructible).
export const MAT = {
  AIR: 0, BEDROCK: 1, DIRT: 2, GRASS: 3, ASPHALT: 4, CONCRETE: 5, BRICK: 6, WOOD: 7,
  METAL: 8, GLASS: 9, SAND: 10, ROOF: 11, PAINT: 12, RUST: 13, LEAF: 14, LINE: 15, TRIM: 16,
  LAMP_C: 20, LAMP_O: 21, LAMP_M: 22, LAMP_W: 23, LAMP_R: 24,
};
export const MATDEF = [];
function md(id, color, hp, vari = 0.08, debris = color, emit = null) { MATDEF[id] = { color: new THREE.Color(color), hp, vari, debris: new THREE.Color(debris), emit }; }
export const isEmitter = (m) => m >= 20 && m <= 24;
export function setPalette(p) {
  md(MAT.BEDROCK, p.bedrock, 255, 0.05);
  md(MAT.DIRT, p.dirt, 3, 0.12);
  md(MAT.GRASS, p.grass, 3, 0.14, p.dirt);
  md(MAT.ASPHALT, p.asphalt, 8, 0.06);
  md(MAT.CONCRETE, p.concrete, 6, 0.07);
  md(MAT.BRICK, p.brick, 4, 0.12);
  md(MAT.WOOD, p.wood, 2, 0.12);
  md(MAT.METAL, p.metal, 40, 0.05);
  md(MAT.GLASS, p.glass, 1, 0.03);
  md(MAT.SAND, p.sand, 5, 0.1);
  md(MAT.ROOF, p.roof, 3, 0.08);
  md(MAT.PAINT, p.paint, 6, 0.05, p.concrete);
  md(MAT.RUST, p.rust, 30, 0.12);
  md(MAT.LEAF, p.leaf, 1, 0.18);
  md(MAT.LINE, p.line, 8, 0.04, p.asphalt);
  md(MAT.TRIM, p.trim, 6, 0.05, p.concrete);
  // emitters: light level (0..15 per channel) — propagated by BFS flood fill
  md(MAT.LAMP_C, 0x8ff6ff, 3, 0, 0x8ff6ff, [3, 12, 14]);
  md(MAT.LAMP_O, 0xffc070, 3, 0, 0xffc070, [15, 10, 4]);
  md(MAT.LAMP_M, 0xff7af0, 3, 0, 0xff7af0, [15, 5, 14]);
  md(MAT.LAMP_W, 0xf2f6ff, 3, 0, 0xf2f6ff, [14, 13, 12]);
  md(MAT.LAMP_R, 0xff5040, 3, 0, 0xff5040, [15, 3, 2]);
}
// light level → linear intensity (exponential falloff ≈ attenuation per 0.5 m)
const LF = new Float32Array(16); for (let i = 1; i < 16; i++) LF[i] = Math.pow(0.78, 15 - i) * 0.95;

export class World {
  constructor(scene, light) {
    this.scene = scene;
    this.v = new Uint8Array(SX * SY * SZ);
    this.hp = new Uint8Array(SX * SY * SZ);
    this.lr = new Uint8Array(SX * SY * SZ); this.lg = new Uint8Array(SX * SY * SZ); this.lb = new Uint8Array(SX * SY * SZ);
    this.chunks = new Array(CX * CY * CZ).fill(null);
    this.dirty = new Set();
    this.light = light; // {sun: Vector3 (normalised), sunCol, skyCol, groundCol}
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    this.glassMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, fog: true });
    this.lost = [];
    this.onChange = null; // callback(minx,minz,maxx,maxz) for nav updates
  }
  idx(x, y, z) { return (y * SZ + z) * SX + x; }
  inb(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ; }
  get(x, y, z) { if (y < 0) return MAT.BEDROCK; if (!this.inb(x, y, z)) return 0; return this.v[(y * SZ + z) * SX + x]; }
  set(x, y, z, m) {
    if (!this.inb(x, y, z)) return;
    const i = this.idx(x, y, z); this.v[i] = m; this.hp[i] = m ? MATDEF[m].hp : 0;
  }
  fill(x0, y0, z0, x1, y1, z1, m) {
    for (let y = Math.max(0, y0); y <= Math.min(SY - 1, y1); y++)
      for (let z = Math.max(0, z0); z <= Math.min(SZ - 1, z1); z++)
        for (let x = Math.max(0, x0); x <= Math.min(SX - 1, x1); x++) this.set(x, y, z, m);
  }
  markDirtyVoxel(x, y, z) {
    const cx = (x / CS) | 0, cy = (y / CS) | 0, cz = (z / CS) | 0;
    this.dirty.add(this.cidx(cx, cy, cz));
    // neighbours (faces/AO across chunk borders) and shadow receivers below
    const lx = x % CS, ly = y % CS, lz = z % CS;
    if (lx === 0 && cx > 0) this.dirty.add(this.cidx(cx - 1, cy, cz));
    if (lx === CS - 1 && cx < CX - 1) this.dirty.add(this.cidx(cx + 1, cy, cz));
    if (lz === 0 && cz > 0) this.dirty.add(this.cidx(cx, cy, cz - 1));
    if (lz === CS - 1 && cz < CZ - 1) this.dirty.add(this.cidx(cx, cy, cz + 1));
    if (ly === 0 && cy > 0) this.dirty.add(this.cidx(cx, cy - 1, cz));
    if (ly === CS - 1 && cy < CY - 1) this.dirty.add(this.cidx(cx, cy + 1, cz));
  }
  cidx(cx, cy, cz) { return (cy * CZ + cz) * CX + cx; }

  transparent(m) { return m === 0 || m === MAT.GLASS || m === MAT.LEAF; }
  // Coloured light: multi-source BFS, each channel max(neighbour − 1). O(N) and exact for Manhattan falloff.
  computeLight() {
    this.lr.fill(0); this.lg.fill(0); this.lb.fill(0);
    const q = [];
    for (let i = 0; i < this.v.length; i++) {
      const m = this.v[i]; if (m >= 20 && m <= 24) { const e = MATDEF[m].emit; this.lr[i] = e[0]; this.lg[i] = e[1]; this.lb[i] = e[2]; q.push(i); }
    }
    this.propagate(q);
  }
  propagate(q) {
    const SXZ = SX * SZ;
    let h = 0;
    while (h < q.length) {
      const i = q[h++];
      const r = this.lr[i] - 1, g = this.lg[i] - 1, b = this.lb[i] - 1;
      if (r <= 0 && g <= 0 && b <= 0) continue;
      const x = i % SX, z = ((i / SX) | 0) % SZ, y = (i / SXZ) | 0;
      for (let k = 0; k < 6; k++) {
        let j;
        if (k === 0) { if (x === SX - 1) continue; j = i + 1; }
        else if (k === 1) { if (x === 0) continue; j = i - 1; }
        else if (k === 2) { if (z === SZ - 1) continue; j = i + SX; }
        else if (k === 3) { if (z === 0) continue; j = i - SX; }
        else if (k === 4) { if (y === SY - 1) continue; j = i + SXZ; }
        else { if (y === 0) continue; j = i - SXZ; }
        if (!this.transparent(this.v[j])) continue;
        let up = false;
        if (this.lr[j] < r) { this.lr[j] = r; up = true; }
        if (this.lg[j] < g) { this.lg[j] = g; up = true; }
        if (this.lb[j] < b) { this.lb[j] = b; up = true; }
        if (up) { q.push(j); if (q.length > 400000) return; }
      }
    }
  }
  // Destroyed emitters: clear light in the affected box (bbox + max range), then re-seed from the box shell
  // and surviving emitters inside it. Exact for BFS light since nothing outside the box depended on them.
  flushLights() {
    if (!this.lost.length) return;
    let a = SX, b = SY, c = SZ, d = 0, e = 0, f = 0;
    for (const [x, y, z] of this.lost) { a = Math.min(a, x); b = Math.min(b, y); c = Math.min(c, z); d = Math.max(d, x); e = Math.max(e, y); f = Math.max(f, z); }
    this.lost.length = 0;
    const R = 15;
    const x0 = Math.max(0, a - R), y0 = Math.max(0, b - R), z0 = Math.max(0, c - R), x1 = Math.min(SX - 1, d + R), y1 = Math.min(SY - 1, e + R), z1 = Math.min(SZ - 1, f + R);
    const q = [];
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = this.idx(x, y, z); const m = this.v[i];
      if (m >= 20 && m <= 24) { const em = MATDEF[m].emit; this.lr[i] = em[0]; this.lg[i] = em[1]; this.lb[i] = em[2]; q.push(i); }
      else { this.lr[i] = 0; this.lg[i] = 0; this.lb[i] = 0; }
    }
    // shell just outside the box keeps valid light → seeds
    for (let y = y0 - 1; y <= y1 + 1; y++) for (let z = z0 - 1; z <= z1 + 1; z++) for (let x = x0 - 1; x <= x1 + 1; x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1) continue;
      if (!this.inb(x, y, z)) continue; const i = this.idx(x, y, z); if (this.lr[i] | this.lg[i] | this.lb[i]) q.push(i);
    }
    this.propagate(q);
    for (let y = y0; y <= y1 + CS; y += CS) for (let z = z0; z <= z1 + CS; z += CS) for (let x = x0; x <= x1 + CS; x += CS)
      this.markDirtyVoxel(Math.min(x, SX - 1), Math.min(y, SY - 1), Math.min(z, SZ - 1));
  }
  // Newly opened cells pull light from neighbours (holes in walls leak neon outside).
  relight(cells) {
    const q = [];
    for (const [x, y, z] of cells) for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      if (this.inb(x + dx, y + dy, z + dz)) q.push(this.idx(x + dx, y + dy, z + dz));
    }
    this.propagate(q);
    for (const [x, y, z] of cells) for (let dy = -6; dy <= 6; dy += 6) for (let dz = -6; dz <= 6; dz += 6) for (let dx = -6; dx <= 6; dx += 6)
      if (this.inb(x + dx, y + dy, z + dz)) this.markDirtyVoxel(x + dx, y + dy, z + dz);
  }

  buildAll() { for (let i = 0; i < this.chunks.length; i++) this.buildChunk(i); this.dirty.clear(); }
  // Rebuild a bounded number of dirty chunks per frame (keeps frame time flat after big explosions).
  update(maxPerFrame = 6) {
    let n = 0;
    for (const i of this.dirty) { this.dirty.delete(i); this.buildChunk(i); if (++n >= maxPerFrame) break; }
  }

  // Sun visibility from a point (voxel coords): DDA-free fixed-step march, early-outs at world top.
  sunVis(px, py, pz) {
    const s = this.light.sunV;
    for (let t = 1; t < 70; t += 1) {
      const x = Math.floor(px + s.x * t), y = Math.floor(py + s.y * t), z = Math.floor(pz + s.z * t);
      if (y >= SY) return 1;
      if (x < 0 || z < 0 || x >= SX || z >= SZ) return 1;
      const m = this.v[(y * SZ + z) * SX + x];
      if (m && m !== MAT.GLASS) return m === MAT.LEAF ? 0.55 : 0;
    }
    return 1;
  }

  buildChunk(ci) {
    const cx = ci % CX, cz = ((ci / CX) | 0) % CZ, cy = (ci / (CX * CZ)) | 0;
    const old = this.chunks[ci];
    if (old) { for (const m of old) { this.scene.remove(m); m.geometry.dispose(); } }
    this.chunks[ci] = null;
    const L = this.light;
    const pos = [], col = [], ind = [];
    const gpos = [], gcol = [], gind = [];
    const x0 = cx * CS, y0 = cy * CS, z0 = cz * CS;
    const c = new THREE.Color();
    for (let y = y0; y < y0 + CS; y++) for (let z = z0; z < z0 + CS; z++) for (let x = x0; x < x0 + CS; x++) {
      const m = this.v[(y * SZ + z) * SX + x];
      if (!m) continue;
      const isGlass = m === MAT.GLASS;
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const nx = x + F.n[0], ny = y + F.n[1], nz = z + F.n[2];
        const nm = this.get(nx, ny, nz);
        if (nm && !(nm === MAT.GLASS && !isGlass) && !(nm === MAT.LEAF && m !== MAT.LEAF)) continue;
        if (ny < 0) continue;
        const P = isGlass ? gpos : pos, C = isGlass ? gcol : col, I = isGlass ? gind : ind;
        // albedo with deterministic per-voxel noise (hash) – breaks up flat colour without textures
        const def = MATDEF[m];
        const h = hash3(x, y, z);
        const k = 1 + (h - 0.5) * 2 * def.vari;
        // lighting
        const nd = F.n[0] * L.sunV.x + F.n[1] * L.sunV.y + F.n[2] * L.sunV.z;
        let sun = 0;
        if (nd > 0) sun = nd * this.sunVis(x + 0.5 + F.n[0] * 0.6, y + 0.5 + F.n[1] * 0.6, z + 0.5 + F.n[2] * 0.6);
        const skyw = 0.5 + 0.5 * F.n[1];
        let lr = L.sunCol.r * sun + L.skyCol.r * skyw + L.groundCol.r * (1 - skyw);
        let lg = L.sunCol.g * sun + L.skyCol.g * skyw + L.groundCol.g * (1 - skyw);
        let lb = L.sunCol.b * sun + L.skyCol.b * skyw + L.groundCol.b * (1 - skyw);
        if (this.inb(nx, ny, nz)) { const li = this.idx(nx, ny, nz); lr += LF[this.lr[li]]; lg += LF[this.lg[li]]; lb += LF[this.lb[li]]; }
        // soft-knee tonemap (Reinhard-like) so overlapping neon pools never clip to flat cyan
        lr = 1.45 * lr / (1 + 0.85 * lr); lg = 1.45 * lg / (1 + 0.85 * lg); lb = 1.45 * lb / (1 + 0.85 * lb);
        if (def.emit) { lr = lg = lb = 1.5; }
        const base = P.length / 3;
        const ao = [0, 0, 0, 0];
        for (let v = 0; v < 4; v++) {
          const cv = F.c[v];
          P.push((x + cv[0]) * VS, (y + cv[1]) * VS, (z + cv[2]) * VS);
          // ambient occlusion: two edge neighbours + corner in the layer in front of the face
          const a = F.ao[v];
          const s1 = this.occ(nx + a[0][0], ny + a[0][1], nz + a[0][2]);
          const s2 = this.occ(nx + a[1][0], ny + a[1][1], nz + a[1][2]);
          const cr = this.occ(nx + a[0][0] + a[1][0], ny + a[0][1] + a[1][1], nz + a[0][2] + a[1][2]);
          const o = s1 && s2 ? 3 : s1 + s2 + cr;
          ao[v] = o;
          const af = AOF[o];
          c.copy(def.color);
          C.push(c.r * k * lr * af, c.g * k * lg * af, c.b * k * lb * af);
        }
        // flip quad diagonal to avoid AO anisotropy
        if (ao[0] + ao[2] > ao[1] + ao[3]) I.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        else I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const meshes = [];
    if (ind.length) meshes.push(this.mk(pos, col, ind, this.mat));
    if (gind.length) meshes.push(this.mk(gpos, gcol, gind, this.glassMat));
    for (const m of meshes) this.scene.add(m);
    this.chunks[ci] = meshes.length ? meshes : null;
  }
  occ(x, y, z) { const m = this.get(x, y, z); return m && m !== MAT.GLASS ? 1 : 0; }
  mk(pos, col, ind, mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(ind, 1) : new THREE.Uint16BufferAttribute(ind, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.matrixAutoUpdate = false;
    return m;
  }

  // Amanatides–Woo DDA raycast in world units. Returns {x,y,z (voxel), m, dist, nx,ny,nz, point}
  raycast(o, d, maxDist, ignoreGlass = false) {
    let x = Math.floor(o.x / VS), y = Math.floor(o.y / VS), z = Math.floor(o.z / VS);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = sx ? Math.abs(VS / d.x) : Infinity, tdy = sy ? Math.abs(VS / d.y) : Infinity, tdz = sz ? Math.abs(VS / d.z) : Infinity;
    let tmx = sx ? ((sx > 0 ? (x + 1) * VS - o.x : o.x - x * VS) / Math.abs(d.x)) : Infinity;
    let tmy = sy ? ((sy > 0 ? (y + 1) * VS - o.y : o.y - y * VS) / Math.abs(d.y)) : Infinity;
    let tmz = sz ? ((sz > 0 ? (z + 1) * VS - o.z : o.z - z * VS) / Math.abs(d.z)) : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0;
    while (t <= maxDist) {
      const m = this.get(x, y, z);
      if (m && !(ignoreGlass && m === MAT.GLASS)) {
        return { x, y, z, m, dist: t, nx, ny, nz, point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) };
      }
      if (y < -1 || y > SY + 2) break;
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }
  // Line of sight test between two world points (glass is see-through).
  los(a, b) {
    const d = new THREE.Vector3().subVectors(b, a); const L = d.length(); d.divideScalar(L);
    return !this.raycast(a, d, L - 0.05, true);
  }

  // Does an AABB (world units, min/max) overlap any solid voxel?
  boxHits(minx, miny, minz, maxx, maxy, maxz) {
    const x0 = Math.floor(minx / VS), x1 = Math.floor((maxx - 1e-6) / VS);
    const y0 = Math.floor(miny / VS), y1 = Math.floor((maxy - 1e-6) / VS);
    const z0 = Math.floor(minz / VS), z1 = Math.floor((maxz - 1e-6) / VS);
    if (x0 < 0 || z0 < 0 || x1 >= SX || z1 >= SZ) return true; // world border
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const m = this.get(x, y, z); if (m && m !== MAT.LEAF) return true;
    }
    return false;
  }
  groundHeightAt(wx, wz, fromY = SY - 1) {
    const x = Math.floor(wx / VS), z = Math.floor(wz / VS);
    for (let y = fromY; y >= 0; y--) { const m = this.get(x, y, z); if (m && m !== MAT.LEAF) return (y + 1) * VS; }
    return 0;
  }

  // Damage one voxel (bullets). Returns material if destroyed, else 0.
  damageVoxel(x, y, z, dmg) {
    if (!this.inb(x, y, z)) return 0;
    const i = this.idx(x, y, z); const m = this.v[i];
    if (!m || MATDEF[m].hp >= 255 || y === 0) return 0;
    const h = this.hp[i] - dmg;
    if (h > 0) { this.hp[i] = h; return 0; }
    this.v[i] = 0; this.hp[i] = 0; this.markDirtyVoxel(x, y, z);
    if (isEmitter(m)) this.lost.push([x, y, z]);
    this.afterRemoval([[x, y, z]]);
    this.relight([[x, y, z]]);
    this.flushLights();
    return m;
  }
  // Spherical blast (world centre, radius in m). Returns list of removed {x,y,z,m} (for debris).
  explode(c, r, power = 1) {
    const removed = [];
    const vx = c.x / VS, vy = c.y / VS, vz = c.z / VS, vr = r / VS;
    const r2 = vr * vr;
    const edge = [];
    for (let y = Math.floor(vy - vr); y <= Math.ceil(vy + vr); y++)
      for (let z = Math.floor(vz - vr); z <= Math.ceil(vz + vr); z++)
        for (let x = Math.floor(vx - vr); x <= Math.ceil(vx + vr); x++) {
          if (!this.inb(x, y, z) || y === 0) continue;
          const dx = x + 0.5 - vx, dy = y + 0.5 - vy, dz = z + 0.5 - vz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) continue;
          const i = this.idx(x, y, z); const m = this.v[i];
          if (!m) continue;
          const hard = MATDEF[m].hp;
          if (hard >= 255) continue;
          // falloff + hardness: hard materials survive at the rim (jagged holes)
          const f = 1 - Math.sqrt(d2) / vr;
          if (hard > 20 && f < 0.6) continue;
          if (f * 10 * power + hash3(x, y, z) * 3 < Math.min(hard, 12) * 0.35) continue;
          this.v[i] = 0; this.hp[i] = 0; removed.push({ x, y, z, m }); if (m >= 20 && m <= 24) this.lost.push([x, y, z]);
          this.markDirtyVoxel(x, y, z);
          edge.push([x, y, z]);
        }
    const fallen = this.afterRemoval(edge);
    this.relight(edge.length > 200 ? edge.filter((_, i) => i % 4 === 0) : edge);
    this.flushLights();
    return { removed, fallen };
  }

  // Structural integrity: flood fill from neighbours of removed voxels. Any component not connected
  // to the ground (y<=1 or indestructible) within a budget becomes falling debris.
  afterRemoval(cells) {
    const seen = new Set(); const fallen = [];
    // DFS pops the last-pushed neighbour first: push "down" last so the search dives toward the ground
    const N6 = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
    const seeds = [];
    for (const [x, y, z] of cells) for (const n of N6) {
      const a = x + n[0], b = y + n[1], c = z + n[2];
      if (this.inb(a, b, c) && this.v[this.idx(a, b, c)]) seeds.push([a, b, c]);
    }
    let budget = 150000;
    for (const s of seeds) {
      const si = this.idx(s[0], s[1], s[2]);
      if (seen.has(si)) continue;
      const comp = []; const stack = [s]; seen.add(si);
      let grounded = false;
      while (stack.length) {
        const p = stack.pop(); comp.push(p);
        if (p[1] <= 1) { grounded = true; break; }
        const m = this.v[this.idx(p[0], p[1], p[2])];
        if (MATDEF[m].hp >= 255) { grounded = true; break; }
        if (--budget <= 0 || comp.length > 6000) { grounded = true; break; } // too big to evaluate → assume supported
        for (const n of N6) {
          const a = p[0] + n[0], b = p[1] + n[1], c = p[2] + n[2];
          if (!this.inb(a, b, c)) continue;
          const j = this.idx(a, b, c);
          if (seen.has(j) || !this.v[j]) continue;
          seen.add(j); stack.push([a, b, c]);
        }
      }
      if (!grounded) {
        for (const p of comp) {
          const i = this.idx(p[0], p[1], p[2]);
          fallen.push({ x: p[0], y: p[1], z: p[2], m: this.v[i] }); if (this.v[i] >= 20 && this.v[i] <= 24) this.lost.push(p);
          this.v[i] = 0; this.hp[i] = 0; this.markDirtyVoxel(p[0], p[1], p[2]);
        }
      }
      if (budget <= 0) break;
    }
    if (fallen.length && this.onFall) this.onFall(fallen);
    if (this.onChange) {
      let a = SX, b = SZ, c = 0, d = 0;
      for (const p of cells) { a = Math.min(a, p[0]); b = Math.min(b, p[2]); c = Math.max(c, p[0]); d = Math.max(d, p[2]); }
      for (const p of fallen) { a = Math.min(a, p.x); b = Math.min(b, p.z); c = Math.max(c, p.x); d = Math.max(d, p.z); }
      if (c >= a) this.onChange(a, b, c, d);
    }
    return fallen;
  }
}

export function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const AOF = [1, 0.8, 0.64, 0.5];

// Face table: normal, 4 corners (CCW from outside), AO neighbour offsets per corner (u,v directions)
const FACES = (() => {
  const out = [];
  const axes = [[0, 1, 2], [1, 2, 0], [2, 0, 1]]; // [a, u, v] with u x v = a
  for (const [a, u, v] of axes) for (const s of [1, -1]) {
    const n = [0, 0, 0]; n[a] = s;
    let uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (s < 0) uv = [[0, 0], [0, 1], [1, 1], [1, 0]];
    const c = [], ao = [];
    for (const [cu, cv] of uv) {
      const p = [0, 0, 0]; p[a] = s > 0 ? 1 : 0; p[u] = cu; p[v] = cv; c.push(p);
      const du = [0, 0, 0]; du[u] = cu ? 1 : -1;
      const dv = [0, 0, 0]; dv[v] = cv ? 1 : -1;
      ao.push([du, dv]);
    }
    out.push({ n, c, ao });
  }
  return out;
})();
