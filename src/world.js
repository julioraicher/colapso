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
  BARREL: 25, WATER: 26, ASPHALT2: 27, CAR_A: 28, CAR_B: 29, CAR_C: 30, TIRE: 31, PANEL: 32, OLIVE: 33,
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
  // detail materials (map v2)
  md(MAT.BARREL, p.barrel ?? 0xb3261c, 2, 0.06);
  md(MAT.WATER, p.water ?? 0x1c2633, 8, 0.03, p.asphalt);
  md(MAT.ASPHALT2, p.asphalt2 ?? 0x262a32, 8, 0.05);
  md(MAT.CAR_A, p.carA ?? 0x8a1f24, 10, 0.03);
  md(MAT.CAR_B, p.carB ?? 0x2b4b6e, 10, 0.03);
  md(MAT.CAR_C, p.carC ?? 0x8f8c84, 10, 0.03);
  md(MAT.TIRE, p.tire ?? 0x121214, 6, 0.04);
  md(MAT.PANEL, p.panel ?? 0x1b2029, 8, 0.04);
  md(MAT.OLIVE, p.olive ?? 0x46553c, 12, 0.06);
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
    this.dflag = new Uint8Array(CX * CY * CZ);     // 1 while a chunk sits in the dirty set (saves the Set lookups)
    this.lostHold = false; this.held = false;      // a blast this frame: the mesher and the lamp-light flush wait one frame
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
    this.markChunk((cy * CZ + cz) * CX + cx);
    // neighbours (faces/AO across chunk borders) and shadow receivers below
    const lx = x % CS, ly = y % CS, lz = z % CS;
    if (lx === 0 && cx > 0) this.markChunk(this.cidx(cx - 1, cy, cz));
    if (lx === CS - 1 && cx < CX - 1) this.markChunk(this.cidx(cx + 1, cy, cz));
    if (lz === 0 && cz > 0) this.markChunk(this.cidx(cx, cy, cz - 1));
    if (lz === CS - 1 && cz < CZ - 1) this.markChunk(this.cidx(cx, cy, cz + 1));
    if (ly === 0 && cy > 0) this.markChunk(this.cidx(cx, cy - 1, cz));
    if (ly === CS - 1 && cy < CY - 1) this.markChunk(this.cidx(cx, cy + 1, cz));
  }
  markChunk(ci) { if (!this.dflag[ci]) { this.dflag[ci] = 1; this.dirty.add(ci); } }
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
    const SXZ = SX * SZ, v = this.v, lr = this.lr, lg = this.lg, lb = this.lb, GL = MAT.GLASS, LE = MAT.LEAF;
    // FIFO in a reused typed array: the same visiting order and the same 400 000 cap as a plain array, without the garbage
    let n = q.length, Q = this.pq;
    if (!Q || Q.length < Math.max(n + 1, 400001)) Q = this.pq = new Int32Array(Math.max(n + 1, 400001));
    for (let i = 0; i < n; i++) Q[i] = q[i];
    let h = 0;
    while (h < n) {
      const i = Q[h++];
      const r = lr[i] - 1, g = lg[i] - 1, b = lb[i] - 1;
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
        const m = v[j]; if (m !== 0 && m !== GL && m !== LE) continue;
        let up = false;
        if (lr[j] < r) { lr[j] = r; up = true; }
        if (lg[j] < g) { lg[j] = g; up = true; }
        if (lb[j] < b) { lb[j] = b; up = true; }
        if (up) { Q[n++] = j; if (n > 400000) return; }
      }
    }
  }
  // Destroyed emitters: clear light in the affected box (bbox + max range), then re-seed from the box shell
  // and surviving emitters inside it. Exact for BFS light since nothing outside the box depended on them.
  // Lamps lost far apart are relit as separate boxes: two groups are independent when a gap of more than 30 voxels on
  // one axis keeps the stale light of one (reach 14) clear of the other's box and shell (bbox + 16).
  flushLights() {
    this.lostHold = false;
    const L = this.lost; if (!L.length) return;
    const boxes = [];
    for (let n = 0; n < L.length; n++) {
      const p = L[n]; let a = p[0], b = p[1], c = p[2], d = p[0], e = p[1], f = p[2];
      for (let i = boxes.length - 1; i >= 0; i--) {
        const o = boxes[i];
        if (o[0] - d > 30 || a - o[3] > 30 || o[1] - e > 30 || b - o[4] > 30 || o[2] - f > 30 || c - o[5] > 30) continue;
        a = Math.min(a, o[0]); b = Math.min(b, o[1]); c = Math.min(c, o[2]); d = Math.max(d, o[3]); e = Math.max(e, o[4]); f = Math.max(f, o[5]);
        boxes.splice(i, 1); i = boxes.length;                             // it grew: look at the other groups again
      }
      boxes.push([a, b, c, d, e, f]);
    }
    L.length = 0;
    for (const o of boxes) this.flushBox(o[0], o[1], o[2], o[3], o[4], o[5]);
  }
  flushBox(a, b, c, d, e, f) {
    const R = 15, v = this.v, lr = this.lr, lg = this.lg, lb = this.lb;
    const x0 = Math.max(0, a - R), y0 = Math.max(0, b - R), z0 = Math.max(0, c - R), x1 = Math.min(SX - 1, d + R), y1 = Math.min(SY - 1, e + R), z1 = Math.min(SZ - 1, f + R);
    const q = [];
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      let i = (y * SZ + z) * SX + x0;
      for (let x = x0; x <= x1; x++, i++) {
        const m = v[i];
        if (m >= 20 && m <= 24) { const em = MATDEF[m].emit; lr[i] = em[0]; lg[i] = em[1]; lb[i] = em[2]; q.push(i); }
        else { lr[i] = 0; lg[i] = 0; lb[i] = 0; }
      }
    }
    // shell just outside the box keeps valid light → seeds (walks only the six faces, in scan order)
    const xa = Math.max(0, x0 - 1), xb = Math.min(SX - 1, x1 + 1);
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      if (y < 0 || y >= SY) continue;
      for (let z = z0 - 1; z <= z1 + 1; z++) {
        if (z < 0 || z >= SZ) continue;
        const row = (y * SZ + z) * SX;
        if (y < y0 || y > y1 || z < z0 || z > z1) { for (let i = row + xa; i <= row + xb; i++) if (lr[i] | lg[i] | lb[i]) q.push(i); continue; }
        if (x0 > 0) { const i = row + x0 - 1; if (lr[i] | lg[i] | lb[i]) q.push(i); }
        if (x1 < SX - 1) { const i = row + x1 + 1; if (lr[i] | lg[i] | lb[i]) q.push(i); }
      }
    }
    this.propagate(q);
    for (let y = y0; y <= y1 + CS; y += CS) for (let z = z0; z <= z1 + CS; z += CS) for (let x = x0; x <= x1 + CS; x += CS)
      this.markDirtyVoxel(Math.min(x, SX - 1), Math.min(y, SY - 1), Math.min(z, SZ - 1));
  }
  // Newly opened cells pull light from neighbours (holes in walls leak neon outside).
  relight(cells) {
    const q = [], SXZ = SX * SZ;
    for (let n = 0; n < cells.length; n++) {
      const p = cells[n], x = p[0], y = p[1], z = p[2], i = (y * SZ + z) * SX + x;
      if (x + 1 < SX) q.push(i + 1); if (x > 0) q.push(i - 1);
      if (y + 1 < SY) q.push(i + SXZ); if (y > 0) q.push(i - SXZ);
      if (z + 1 < SZ) q.push(i + SX); if (z > 0) q.push(i - SX);
    }
    this.propagate(q);
    for (let n = 0; n < cells.length; n++) {
      const p = cells[n], x = p[0], y = p[1], z = p[2];
      for (let dy = -6; dy <= 6; dy += 6) for (let dz = -6; dz <= 6; dz += 6) for (let dx = -6; dx <= 6; dx += 6)
        if (this.inb(x + dx, y + dy, z + dz)) this.markDirtyVoxel(x + dx, y + dy, z + dz);
    }
  }

  buildAll() { for (let i = 0; i < this.chunks.length; i++) this.buildChunk(i); this.dirty.clear(); this.dflag.fill(0); }
  // Rebuild dirty chunks: up to maxPerFrame of them and about budgetMs of work per call, so that no single frame
  // carries the whole cost of a big blast. The frame of a blast itself is left alone (lostHold): the lamp-light flush
  // it owes runs at the start of the next call, before the chunks (never two frames in a row late), and counts
  // against the budget. A call without a flush always rebuilds at least one chunk.
  update(maxPerFrame = 6, budgetMs = maxPerFrame) {
    if (this.lostHold && !this.held) { this.held = true; this.lostHold = false; return; }
    this.held = false; this.lostHold = false;
    const t0 = performance.now(); let n = 0, flushed = false;
    if (this.lost.length) { this.flushLights(); flushed = true; }
    for (const i of this.dirty) {
      if (n >= maxPerFrame || ((n || flushed) && performance.now() - t0 >= budgetMs)) break;
      this.dirty.delete(i); this.dflag[i] = 0; this.buildChunk(i); n++;
    }
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

  // Baked-light probe for dynamic objects (soldiers, props): point in metres -> out.r/g/b (a THREE.Color works).
  // O(1): one roof probe (at most 24 cells straight up) plus the flood-filled lamp light of that cell.
  // Open outdoor night is (1, 1, 1); under a roof the ambient halves; lamps add their colour relative to the
  // ambient; clamped to 0.35..2.2 per channel. The lamp field is stepped per voxel: smooth it over a few frames.
  lightAt(x, y, z, out) {
    const vx = Math.floor(x / VS), vz = Math.floor(z / VS), SXZ = SX * SZ; let vy = Math.floor(y / VS);
    if (vx < 0 || vz < 0 || vx >= SX || vz >= SZ || vy >= SY) { out.r = out.g = out.b = 1; return out; }
    if (vy < 0) vy = 0;
    let i = (vy * SZ + vz) * SX + vx;
    if (!this.transparent(this.v[i]) && vy + 1 < SY) i += SXZ;          // probe inside a solid: use the cell above
    let sky = 1;
    for (let j = i + SXZ, n = 0; n < 24 && j < this.v.length; j += SXZ, n++) { const m = this.v[j]; if (m && m !== MAT.GLASS) { sky = m === MAT.LEAF ? 0.75 : 0.5; break; } }
    const L = this.light, c = (v) => v < 0.35 ? 0.35 : v > 2.2 ? 2.2 : v;
    out.r = c(sky + LF[this.lr[i]] / (L.skyCol.r + 0.5 * L.sunCol.r));
    out.g = c(sky + LF[this.lg[i]] / (L.skyCol.g + 0.5 * L.sunCol.g));
    out.b = c(sky + LF[this.lb[i]] / (L.skyCol.b + 0.5 * L.sunCol.b));
    return out;
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
    if (this.lost.length) this.lostHold = true;      // lamp light is flushed by update() on the next frame
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
    if (edge.length) this.lostHold = true;           // the mesher and the lamp-light flush start on the next frame (see update)
    return { removed, fallen };
  }

  // Structural integrity: flood fill from neighbours of removed voxels. Any component not connected
  // to the ground (y<=1 or indestructible) within a budget becomes falling debris.
  // The fill runs on voxel indices in reused typed arrays (visited flags, stack, component), in the search order of the
  // original version: DFS that pops the last-pushed neighbour first, "down" pushed last so that it dives to the ground.
  afterRemoval(cells) {
    const v = this.v, SXZ = SX * SZ, fallen = [];
    if (!this.arSeen) { this.arSeen = new Uint8Array(SX * SY * SZ); this.arList = new Int32Array(1 << 16); this.arStack = new Int32Array(6 * 6002 + 8); this.arComp = new Int32Array(6002); }
    const seen = this.arSeen, stack = this.arStack, comp = this.arComp; let list = this.arList, ln = 0;
    let budget = 150000;
    scan:
    for (let n = 0; n < cells.length; n++) {
      const cl = cells[n], cx = cl[0], cy = cl[1], cz = cl[2];
      for (let k = 0; k < 6; k++) {
        const a = cx + (k === 1 ? 1 : k === 2 ? -1 : 0), b = cy + (k === 0 ? 1 : k === 5 ? -1 : 0), c = cz + (k === 3 ? 1 : k === 4 ? -1 : 0);
        if (a < 0 || b < 0 || c < 0 || a >= SX || b >= SY || c >= SZ) continue;
        const si = (b * SZ + c) * SX + a;
        if (!v[si] || seen[si]) continue;
        let sn = 0, cn = 0, grounded = false;
        stack[sn++] = si; seen[si] = 1; if (ln === list.length) { const g = new Int32Array(ln * 2); g.set(list); list = this.arList = g; } list[ln++] = si;
        while (sn) {
          const i = stack[--sn]; comp[cn++] = i;
          const y = (i / SXZ) | 0;
          if (y <= 1) { grounded = true; break; }
          if (MATDEF[v[i]].hp >= 255) { grounded = true; break; }
          if (--budget <= 0 || cn > 6000) { grounded = true; break; } // too big to evaluate → assume supported
          const x = i % SX, z = ((i / SX) | 0) % SZ;
          for (let m = 0; m < 6; m++) {
            let j;
            if (m === 0) { if (y === SY - 1) continue; j = i + SXZ; }
            else if (m === 1) { if (x === SX - 1) continue; j = i + 1; }
            else if (m === 2) { if (x === 0) continue; j = i - 1; }
            else if (m === 3) { if (z === SZ - 1) continue; j = i + SX; }
            else if (m === 4) { if (z === 0) continue; j = i - SX; }
            else { j = i - SXZ; }                                     // y >= 2 here
            if (seen[j] || !v[j]) continue;
            seen[j] = 1; if (ln === list.length) { const g = new Int32Array(ln * 2); g.set(list); list = this.arList = g; } list[ln++] = j;
            stack[sn++] = j;
          }
        }
        if (!grounded) {
          for (let q = 0; q < cn; q++) {
            const i = comp[q], x = i % SX, z = ((i / SX) | 0) % SZ, y = (i / SXZ) | 0, m = v[i];
            fallen.push({ x, y, z, m }); if (m >= 20 && m <= 24) this.lost.push([x, y, z]);
            v[i] = 0; this.hp[i] = 0; this.markDirtyVoxel(x, y, z);
          }
        }
        if (budget <= 0) break scan;
      }
    }
    for (let q = 0; q < ln; q++) seen[list[q]] = 0;
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
