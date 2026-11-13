// DOM HUD: military-classic layout (tickets/flags top, minimap TL, killfeed TR, ammo BR, vitals+abilities BL),
// minimap from a top-down colour bake of the voxel world, deploy map, scoreboard.
import * as THREE from 'three';
import { SX, SZ, SY, VS, MATDEF, MAT } from './world.js';
import { WEAPONS, PRIMARIES, SECONDARIES, CLASSES, buildGun } from './weapons.js';
import { scanTunnel } from './abilities.js';
import { BASES } from './mapgen.js';

const $ = (id) => document.getElementById(id);
export const RANKS = [['RECRUTA', 0], ['SOLDADO', 1500], ['CABO', 4000], ['SARGENTO', 8000], ['SUBTENENTE', 14000], ['TENENTE', 22000], ['CAPITÃO', 34000], ['MAJOR', 50000], ['CORONEL', 72000], ['GENERAL QUÂNTICO', 100000]];
export function rankOf(xp) { let i = 0; while (i + 1 < RANKS.length && xp >= RANKS[i + 1][1]) i++; return { name: RANKS[i][0], i, next: RANKS[i + 1] ? RANKS[i + 1][1] : null }; }
const WDESC = {
  k7: 'Fuzil automático versátil. Recuo vertical forte, controlável.',
  vespa: 'SMG de cadência alta. Domina interiores do laboratório.',
  martelo: 'Escopeta de bomba. Abre buracos nas paredes a curta distância.',
  lanca: 'DMR semiautomático com luneta. Dois tiros no corpo, um na cabeça.',
};

export class HUD {
  constructor(game) { this.g = game; this.hmT = 0; this.vig = 0; this.qT = 0; this.flashV = 0; this.msgT = 0; this.dmgDirs = []; this.mapDirty = false; this.mapT = 0; }
  reset() {
    $('kf').innerHTML = ''; $('msg').innerHTML = ''; this.event(null);
    $('flags').innerHTML = this.g.flags.map(f => `<div class="fl" id="fl${f.id}"><span>${f.id}</span></div>`).join('');
  }
  buildMinimap() {
    // top-down bake: highest solid voxel colour, shaded by height; emitters glow
    const c = document.createElement('canvas'); c.width = SX; c.height = SZ; this.mapC = c; this.mapX = c.getContext('2d', { willReadFrequently: true });
    this.bakeMap(0, 0, SX - 1, SZ - 1);
  }
  markMap(a, b, c, d) {
    const r = this.mapBox; if (!r) this.mapBox = [a, b, c, d]; else { r[0] = Math.min(r[0], a); r[1] = Math.min(r[1], b); r[2] = Math.max(r[2], c); r[3] = Math.max(r[3], d); }
    this.mapDirty = true;
  }
  bakeMap(x0, z0, x1, z1) {
    x0 = Math.max(0, x0 - 2); z0 = Math.max(0, z0 - 2); x1 = Math.min(SX - 1, x1 + 2); z1 = Math.min(SZ - 1, z1 + 2);
    const w = this.g.world; const ctx = this.mapX;
    const img = ctx.getImageData(x0, z0, x1 - x0 + 1, z1 - z0 + 1); const d = img.data;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      let y = SY - 1, m = 0; for (; y >= 0; y--) { m = w.get(x, y, z); if (m && m !== MAT.LEAF) break; }
      const def = MATDEF[m] || MATDEF[MAT.ASPHALT];
      const k = 0.35 + Math.min(1, y / 30) * 0.9;
      const i = ((z - z0) * (x1 - x0 + 1) + (x - x0)) * 4;
      const e = def.emit ? 1.6 : 1;
      d[i] = Math.min(255, def.color.r * 255 * k * e); d[i + 1] = Math.min(255, def.color.g * 255 * k * e); d[i + 2] = Math.min(255, def.color.b * 255 * k * e); d[i + 3] = 255;
    }
    ctx.putImageData(img, x0, z0);
  }
  fillOpts() {
    const s = this.g.settings;
    const bind = (id, key, fmt = (v) => v) => { const el = $(id); el.value = s[key]; const lab = $('v' + id.slice(1)); if (lab) lab.textContent = fmt(s[key]);
      el.oninput = () => { s[key] = parseFloat(el.value); if (lab) lab.textContent = fmt(s[key]); this.g.saveSettings(); if (key === 'vol') this.g.audio.setVolume(s.vol); }; };
    bind('oSens', 'sens', v => (+v).toFixed(2)); bind('oAds', 'adsSens', v => (+v).toFixed(2)); bind('oFov', 'fov'); bind('oVol', 'vol', v => Math.round(v * 100) + '%');
    $('oQ').value = s.quality; $('oQ').onchange = () => { s.quality = $('oQ').value; this.g.scale = s.quality === 'low' ? 0.6 : s.quality === 'high' ? 1 : 0.85; this.g.resize(); this.g.saveSettings(); };
    $('oInv').checked = s.invert; $('oInv').onchange = () => { s.invert = $('oInv').checked; this.g.saveSettings(); };
    $('oFps').checked = s.showFps; $('oFps').onchange = () => { s.showFps = $('oFps').checked; $('fps').classList.toggle('hidden', !s.showFps); this.g.saveSettings(); };
  }
  // ---------- deploy ----------
  drawDeploy() {
    const g = this.g;
    const C = CLASSES[g.cls];
    $('classes').innerHTML = Object.entries(CLASSES).map(([k, c], i) => `<div class="cls ${g.cls === k ? 'sel' : ''}" data-k="${k}" style="--cc:${c.color}"><div class="ic">${c.icon}</div><h3>${i + 1} · ${c.name}</h3><p>${c.gadget}</p></div>`).join('');
    for (const el of document.querySelectorAll('.cls')) el.onclick = () => g.setClass(el.dataset.k);
    const st = (lab, v) => `<div class="stat">${lab}<i><b style="width:${Math.max(4, Math.min(100, v * 100))}%"></b></i></div>`;
    $('wlist').innerHTML = C.weapons.map(id => {
      const w = WEAPONS[id]; const dps = w.dmg * w.pellets * w.rpm / 60;
      return `<div class="wcard ${g.loadout === id ? 'sel' : ''}" data-id="${id}"><h4>${w.name}</h4>${st('DANO/S', dps / 600)}${st('ALCANCE', w.falloff[1] / 300)}${st('CONTROLE', 1 - w.recoilV / 0.1)}</div>`;
    }).join('');
    for (const el of document.querySelectorAll('.wcard')) el.onclick = () => { g.loadout = el.dataset.id; this.drawDeploy(); };
    $('slist').innerHTML = SECONDARIES.map(id => `<div class="chip ${g.secondary === id ? 'sel' : ''}" data-id="${id}">${WEAPONS[id].name}</div>`).join('');
    for (const el of document.querySelectorAll('.chip')) el.onclick = () => { g.secondary = el.dataset.id; this.drawDeploy(); };
    $('gbox').style.setProperty('--cc', C.color);
    $('gbox').innerHTML = `<b style="color:${C.color}">${C.icon} ${C.gadget}</b><p>${C.gdesc}</p>`;
    // weapon detail + spinning 3D preview
    const w = WEAPONS[g.loadout];
    const ttk = Math.ceil(100 / (w.dmg * w.pellets)), ttkMs = Math.round((ttk - 1) * 60000 / w.rpm);
    $('wdetail').innerHTML = `<canvas id="wprev" width="520" height="260"></canvas><h3>${w.name}</h3><p>${w.desc}</p><div class="spec">
      <span>VELOCIDADE DE BOCA</span><span>${w.vel} m/s</span>
      <span>QUEDA A 100 m</span><span>${(0.5 * 9.81 * (100 / w.vel) ** 2 * 100).toFixed(1)} cm · voo ${(100 / w.vel * 1000).toFixed(0)} ms</span>
      <span>CADÊNCIA</span><span>${w.rpm} disparos/min ${w.bolt ? '· ferrolho' : w.auto ? '· automática' : '· semi'}</span>
      <span>DANO</span><span>${w.dmg}${w.pellets > 1 ? ' × ' + w.pellets : ''} · cabeça ×${w.head}</span>
      <span>TIROS P/ ABATER</span><span>${ttk} (≈${ttkMs} ms de perto)</span>
      <span>PENTE</span><span>${w.mag} / ${w.reserve}</span>
      <span>MIRA</span><span>${w.sight === 'scope' ? 'luneta ' + w.zoom + 'x' : w.sight === 'iron' ? 'mira aberta' : w.sight === 'reddot' ? 'red dot' : 'holográfica'}</span>
      <span>DESTRUIÇÃO</span><span>${'■'.repeat(Math.min(5, w.vox))}${'□'.repeat(5 - Math.min(5, w.vox))}</span></div>`;
    this.preview(g.loadout);
    // rank
    const xp = +(localStorage.getItem('colapso.xp') || 0); const R = rankOf(xp);
    $('rankbox').innerHTML = `<b>${R.name}</b><br>${xp.toLocaleString('pt-BR')} XP · próxima: ${R.next ? R.next.toLocaleString('pt-BR') : '—'}`;
    // map
    const cv = $('dmap'); const ctx = cv.getContext('2d');
    const S = cv.width / (SX * VS);
    ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1; ctx.drawImage(this.mapC, 0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(5,8,14,.35)'; ctx.fillRect(0, 0, cv.width, cv.height);
    const opts = g.spawnOptions();
    for (const f of g.flags) this.flagIcon(ctx, f.x * S, f.z * S, f, 14);
    for (const o of opts) {
      const sel = g.deploySel && g.deploySel.x === o.x && g.deploySel.z === o.z;
      ctx.strokeStyle = sel ? '#fff' : '#39e6ff'; ctx.lineWidth = sel ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(o.x * S, o.z * S, sel ? 22 : 18, 0, Math.PI * 2); ctx.stroke();
      if (o.label === 'BASE') { ctx.fillStyle = '#39e6ff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BASE', o.x * S, o.z * S + 4); }
    }
    const eb = BASES[1]; ctx.fillStyle = '#ff8a2a'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BASE ÔMEGA', eb.x * S, eb.z * S + 4);
    cv.onclick = (ev) => {
      const r = cv.getBoundingClientRect(); const mx = (ev.clientX - r.left) / r.width * cv.width, my = (ev.clientY - r.top) / r.height * cv.height;
      let best = null, bd = 50; for (const o of opts) { const d = Math.hypot(o.x * S - mx, o.z * S - my); if (d < bd) { bd = d; best = o; } }
      if (best) { g.deploySel = best; this.drawDeploy(); }
    };
  }
  // Small dedicated renderer for the loadout preview (only alive on the deploy screen)
  preview(id) {
    const cv = $('wprev'); if (!cv) return;
    if (!this.pr) {
      this.prC = document.createElement('canvas'); this.prC.width = 520; this.prC.height = 260;
      this.pr = new THREE.WebGLRenderer({ canvas: this.prC, antialias: true, alpha: true });
      this.ps = new THREE.Scene(); this.ps.add(new THREE.HemisphereLight(0xbfd8ff, 0x303040, 2.4)); const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(1, 1, 1); this.ps.add(d);
      const rim = new THREE.DirectionalLight(0x39e6ff, 2); rim.position.set(-1, 0.3, -1); this.ps.add(rim);
      this.pc = new THREE.PerspectiveCamera(30, 2, 0.01, 10); this.pc.position.set(0, 0.12, 2.0); this.pc.lookAt(0, 0, 0);
      const loop = () => { if (this.g.state !== 'deploy') { this.prLoop = false; return; } this.prLoop = true; if (this.pg) { this.pg.rotation.y += 0.01; this.pr.render(this.ps, this.pc); const c2 = $('wprev'); if (c2) { const x = c2.getContext('2d'); x.clearRect(0, 0, 520, 260); x.drawImage(this.prC, 0, 0); } } requestAnimationFrame(loop); };
      this.prStart = loop;
    }
    if (this.pg) this.ps.remove(this.pg);
    const w = WEAPONS[id]; this.pg = new THREE.Group(); const gun = buildGun(w.type, { sight: w.sight }); gun.position.z = 0.15; this.pg.add(gun); this.pg.rotation.y = -1.1; this.ps.add(this.pg);
    const s = { sniper: 1.5, lmg: 1.45, lmg2: 1.45, dmr: 1.55, rifle: 1.75, bullpup: 1.9, shotgun: 1.8, smg: 2.4, pdw: 2.4, pistol: 3.6, mpistol: 3.6, revolver: 3.2 }[w.type] || 2;
    this.pg.scale.setScalar(s * 1.05);
    if (!this.prLoop) this.prStart();
  }
  flagIcon(ctx, x, y, f, r) {
    const col = f.owner === 0 && f.cap >= 1 ? '#39e6ff' : f.owner === 1 && f.cap <= -1 ? '#ff8a2a' : '#aab';
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = 'rgba(8,12,18,.85)'; ctx.fillRect(-r / 2, -r / 2, r, r); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(-r / 2, -r / 2, r, r);
    ctx.restore(); ctx.fillStyle = col; ctx.font = `bold ${r * 0.75 | 0}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(f.id, x, y + 1); ctx.textBaseline = 'alphabetic';
  }
  // ---------- events ----------
  hit(kill, head) { const h = $('hm'); h.style.opacity = 1; h.classList.toggle('k', kill); this.hmT = kill ? 0.3 : 0.12; }
  damage(from) {
    this.vig = Math.min(1, this.vig + 0.5);
    if (from) this.dmgDirs.push({ x: from.x, z: from.z, t: 1.2 });
  }
  flash(v) { this.flashV = Math.max(this.flashV, v); }
  quantum(v) { this.qT = Math.max(this.qT, v); }
  feed(k, v, team, head, mine, meVictim) {
    const el = document.createElement('div');
    const kc = team === 0 ? 'a' : team === 1 ? 'e' : '';
    const vc = team === 0 ? 'e' : team === 1 ? 'a' : '';
    el.innerHTML = `<span class="${mine ? 'me' : kc}">${k}</span> ${head ? '⌖' : '▸'} <span class="${meVictim ? 'me' : vc}">${v}</span>`;
    $('kf').prepend(el); setTimeout(() => el.remove(), 6000);
    while ($('kf').children.length > 6) $('kf').lastChild.remove();
  }
  toast(text, pts, bad) {
    $('msg').innerHTML = `<div class="big" style="color:${bad ? '#ff6a5a' : '#fff'}">${text}</div>${pts ? `<div class="pts">+${pts}</div>` : ''}`;
    this.msgT = 2;
  }
  event(t) { const el = $('evt'); if (!t) { el.classList.add('hidden'); return; } el.classList.remove('hidden'); el.textContent = t; }
  breath(scoped, hold, b) { const el = $('breath'); el.classList.toggle('hidden', !scoped); if (scoped) el.textContent = hold ? `SEGURANDO O FÔLEGO ${b.toFixed(1)}s` : b <= 0.05 ? 'SEM FÔLEGO' : 'SHIFT · SEGURAR O FÔLEGO'; }
  hideScore() { if (this.g.state === 'play') $('score').classList.add('hidden'); }
  // ---------- per-frame ----------
  update(dt) {
    const g = this.g, p = g.player;
    if (this.hmT > 0) { this.hmT -= dt; if (this.hmT <= 0) $('hm').style.opacity = 0; }
    this.vig = Math.max(0, this.vig - dt * 0.8);
    const lowHp = p.alive ? Math.max(0, (50 - p.hp) / 50) * 0.6 : 0.8;
    $('vign').style.opacity = Math.max(this.vig, lowHp, (g.suppress || 0) * 0.35);
    this.qT = Math.max(0, this.qT - dt * 1.5); $('qfx').style.opacity = Math.max(this.qT, g.echo.alive ? 0.25 + Math.sin(g.time * 8) * 0.08 : 0);
    this.flashV = Math.max(0, this.flashV - dt * 1.2); $('flash').style.opacity = this.flashV;
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) $('msg').innerHTML = ''; }
    if (!g.weapons) return;
    // ammo
    const W = g.W, D = g.WD;
    $('ammo').innerHTML = `${W.mag}<small> / ${W.reserve}</small>`;
    $('ammo').style.color = W.mag <= D.mag * 0.25 ? '#ff6a5a' : '';
    $('wname').textContent = g.reloadT > 0 ? 'RECARREGANDO…' : D.name;
    const gl = g.cls === 'engenheiro' ? `RPG ${g.weapons.gadget ? g.weapons.gadget.mag + g.weapons.gadget.reserve : 0}` : `${CLASSES[g.cls].gadget.split(' ')[0]} ×${g.gadget}`;
    $('nades').textContent = '◆'.repeat(g.nades) + ' GRANADAS [G] · ' + gl + ' [F]';
    $('hpv').textContent = Math.ceil(p.hp); $('hpbar').firstElementChild.style.width = p.hp + '%';
    $('hpbar').firstElementChild.style.background = p.hp < 35 ? '#ff5a4a' : '';
    $('env').textContent = Math.floor(g.energy); $('enbar').firstElementChild.style.width = g.energy + '%';
    $('abE').classList.toggle('off', g.energy < 50 && !g.echo.alive); $('abE').classList.toggle('act', g.echo.alive);
    $('abE').innerHTML = g.echo.alive ? `<b>E</b>COLAPSAR · ${g.echo.t.toFixed(1)}s` : '<b>E</b>SUPERPOSIÇÃO · 50';
    // crosshair spread
    const sp = (D.spreadHip * (1 - g.ads) + D.spreadAds * g.ads + g.bloom + (Math.hypot(p.vel.x, p.vel.z) > 1 ? D.spreadMove : 0)) * 900 + 4;
    const xh = $('xh'); xh.style.opacity = g.ads > 0.6 ? 0 : 1;
    xh.children[0].style.left = (-sp - 8) + 'px'; xh.children[1].style.left = sp + 'px'; xh.children[2].style.top = (-sp - 8) + 'px'; xh.children[3].style.top = sp + 'px';
    // tunnelling preview: show thickness, transmission & cost when facing a wall
    this.tunT = (this.tunT || 0) - dt;
    if (this.tunT <= 0 && p.alive) {
      this.tunT = 0.1;
      const s = scanTunnel(g.world, p.pos, p.yaw); const th = $('tunhint'); const mk = $('enmark');
      if (s) {
        th.classList.remove('hidden');
        if (s.exit && s.cost <= 100) { th.textContent = `Q · d=${s.d.toFixed(1)} m · T=${s.T.toFixed(2)} · custo ${Math.ceil(s.cost)}`; th.classList.toggle('no', s.cost > g.energy); mk.classList.remove('hidden'); mk.style.left = Math.min(100, s.cost) + '%'; }
        else { th.textContent = 'Q · BARREIRA ESPESSA · T≈0'; th.classList.add('no'); mk.classList.add('hidden'); }
        $('abQ').classList.toggle('off', !s.exit || s.cost > g.energy); if (s.exit && s.cost > 100) mk.classList.add('hidden');
      } else { th.classList.add('hidden'); mk.classList.add('hidden'); $('abQ').classList.toggle('off', g.energy < 18); }
    }
    // flags & tickets
    $('tk0').textContent = g.tickets[0]; $('tk1').textContent = g.tickets[1];
    let inF = null;
    for (const f of g.flags) {
      const el = $('fl' + f.id); if (!el) continue;
      el.className = 'fl' + (f.owner === 0 && f.cap >= 1 ? ' us' : f.owner === 1 && f.cap <= -1 ? ' them' : '') + (f.contested ? ' contest' : '');
      if (g.inFlag(f)) inF = f;
    }
    if (inF) {
      $('capbox').classList.remove('hidden');
      const c = inF.cap; const b = $('capbar').firstElementChild;
      b.style.left = c >= 0 ? '50%' : (50 + c * 50) + '%'; b.style.width = Math.abs(c) * 50 + '%'; b.style.background = c >= 0 ? '#39e6ff' : '#ff8a2a';
      $('captxt').textContent = `${inF.id} · ${inF.name} · ` + (inF.contested ? 'CONTESTADO' : inF.cap >= 1 ? 'SEGURO' : inF.n[0] > inF.n[1] ? 'CAPTURANDO' : 'NEUTRALIZANDO') + ` (${inF.n[0]}v${inF.n[1]})`;
    } else $('capbox').classList.add('hidden');
    // damage direction
    const dd = $('dmgdir'); let html = '';
    this.dmgDirs = this.dmgDirs.filter(d => (d.t -= dt) > 0);
    for (const d of this.dmgDirs) {
      const ang = Math.atan2(d.x - p.pos.x, d.z - p.pos.z); const rel = -(ang - (p.yaw + Math.PI));
      html += `<i style="transform:rotate(${rel}rad) translateY(-120px) ;opacity:${Math.min(1, d.t)}"></i>`;
    }
    dd.innerHTML = html;
    // minimap
    this.mapT -= dt; if (this.mapDirty && this.mapT <= 0) { this.mapDirty = false; this.mapT = 0.5; const r = this.mapBox; this.mapBox = null; this.bakeMap(r[0], r[1], r[2], r[3]); }
    this.drawMinimap();
    if (!$('score').classList.contains('hidden')) this.drawScore();
  }
  drawMinimap() {
    const g = this.g, p = g.player; const cv = $('mm'); const ctx = cv.getContext('2d');
    const W = cv.width, R = 34; // metres radius shown
    const S = W / (R * 2);
    ctx.save(); ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.rect(0, 0, W, W); ctx.clip();
    ctx.translate(W / 2, W / 2); ctx.rotate(p.yaw); ctx.scale(S, S); ctx.translate(-p.pos.x, -p.pos.z);
    ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.85; ctx.drawImage(this.mapC, 0, 0, SX * VS, SZ * VS); ctx.globalAlpha = 1;
    for (const f of g.flags) {
      ctx.strokeStyle = f.owner === 0 && f.cap >= 1 ? '#39e6ff' : f.owner === 1 && f.cap <= -1 ? '#ff8a2a' : '#ccd'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.arc(f.x, f.z, 7.5, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(f.x, f.z); ctx.rotate(-p.yaw); ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 5px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.id, 0, 2); ctx.restore();
    }
    for (const e of g.entities) {
      if (!e.alive || e.isPlayer) continue;
      if (e.team === 1 && !(e.spottedT > 0)) continue;
      ctx.fillStyle = e.isEcho ? '#b0ffff' : e.team === 0 ? '#39e6ff' : '#ff5a3a';
      ctx.beginPath(); ctx.arc(e.pos.x, e.pos.z, 0.9, 0, Math.PI * 2); ctx.fill();
    }
    for (const gr of g.grenades) { ctx.fillStyle = '#ffd25a'; ctx.fillRect(gr.p.x - 0.5, gr.p.z - 0.5, 1, 1); }
    ctx.restore();
    // player arrow
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(W / 2, W / 2 - 7); ctx.lineTo(W / 2 - 5, W / 2 + 5); ctx.lineTo(W / 2 + 5, W / 2 + 5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.strokeRect(0.5, 0.5, W - 1, W - 1);
  }
  drawScore() {
    const g = this.g;
    const rows = (team) => {
      const list = g.entities.filter(e => !e.isEcho && e.team === team).map(e => ({ n: e.name, k: e.kills || 0, d: e.deaths || 0, me: e.isPlayer, s: e.isPlayer ? e.score : (e.kills || 0) * 100 }));
      list.sort((a, b) => b.s - a.s);
      return `<tr><th>${team === 0 ? 'KAPPA' : 'ÔMEGA'} · ${g.tickets[team]}</th><th>A</th><th>M</th><th>PTS</th></tr>` + list.map(r => `<tr class="${r.me ? 'me' : ''}"><td style="color:${team === 0 ? '#39e6ff' : '#ff8a2a'}">${r.n}</td><td>${r.k}</td><td>${r.d}</td><td>${r.s}</td></tr>`).join('');
    };
    $('sc0').innerHTML = rows(0); $('sc1').innerHTML = rows(1);
  }
}
