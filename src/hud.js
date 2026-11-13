// DOM HUD + menu presentation. Layout: tickets/flags top, minimap TL, killfeed TR, vitals+abilities BL, weapon panel BR,
// persistent controls legend along the bottom, projected objective markers, tactical map, first-steps checklist.
// Rule for the per-frame path: cache DOM refs and write only when a value actually changed (setT/setC/setS/bar).
import * as THREE from 'three';
import { SX, SZ, SY, VS, MATDEF, MAT } from './world.js';
import { WEAPONS, SECONDARIES, CLASSES, buildGun } from './weapons.js';
import { scanTunnel } from './abilities.js';
import { BASES } from './mapgen.js';
import { IC, kc, keycapify, esc, clsIcon, GADGET_IC, keyboardHTML, cheatHTML, RANKS, rankOf } from './ui-icons.js';
export { RANKS, rankOf };

const $ = (id) => document.getElementById(id);
const EL = {};
const E = (id) => EL[id] || (EL[id] = $(id)); // cached lookup, static elements only
const setT = (el, v) => { if (el._t !== v) { el._t = v; el.textContent = v; } };
const setH = (el, v) => { if (el._h !== v) { el._h = v; el.innerHTML = v; } };
const CK = {}, SK = {}; // interned cache-key names, so the per-frame path allocates no strings for them
const setC = (el, c, on) => { on = !!on; const k = CK[c] || (CK[c] = '_c_' + c); if (el[k] !== on) { el[k] = on; el.classList.toggle(c, on); } };
const setS = (el, p, v) => { const k = SK[p] || (SK[p] = '_s_' + p); if (el[k] !== v) { el[k] = v; el.style[p] = v; } };
const bar = (el, f) => { const q = Math.round(Math.max(0, Math.min(1, f || 0)) * 100); if (el._q !== q) { el._q = q; el.style.transform = 'scaleX(' + q / 100 + ')'; } };
const fmtN = (n) => (+n || 0).toLocaleString('pt-BR');
const owner = (f) => (f.owner === 0 && f.cap >= 1 ? 0 : f.owner === 1 && f.cap <= -1 ? 1 : -1);
const CYAN = '#39e6ff', ORANGE = '#ff8a2a', TAU = Math.PI * 2;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4();

const GSHORT = { assalto: 'SERINGA', engenheiro: 'RPG', suporte: 'SUPRIMENTOS', recon: 'SENSOR' };
const DIFFX = ['Inimigos mais lentos e menos precisos. Ideal para aprender os controles.', 'Experiência equilibrada. Recomendado para a maioria dos jogadores.', 'Inimigos rápidos e letais. Para quem já domina o jogo.'];
const HINTX = { always: 'A barra de teclas fica sempre visível na parte de baixo da tela.', start: 'A barra de teclas aparece só nos primeiros 90 segundos de cada partida.', never: 'Sem barra de teclas nem lista de primeiros passos. As teclas continuam nos painéis.' };
const ESS = [[kc('W') + kc('A') + kc('S') + kc('D'), 'Mover'], [kc('M1'), 'Atirar'], [kc('SHIFT'), 'Correr'], [kc('M2'), 'Mirar'], [kc('ESPAÇO'), 'Pular'], [kc('R'), 'Recarregar'], [kc('CTRL'), 'Agachar · deslizar'], [kc('G'), 'Granada'],
  [kc('Q'), 'Atravessar paredes'], [kc('E'), 'Criar um eco (clone)'], [kc('TAB'), 'Placar'], [kc('H'), 'Ver todos os controles']];
const TUT = [['move', kc('W') + kc('A') + kc('S') + kc('D'), 'ANDE'], ['sprint', kc('SHIFT'), 'CORRA'], ['ads', kc('M2'), 'MIRE'], ['fire', kc('M1'), 'ATIRE'], ['reload', kc('R'), 'RECARREGUE'],
  ['tunnel', kc('Q'), 'ATRAVESSE PAREDE'], ['echo', kc('E'), 'CRIE UM ECO'], ['cap', IC.flag, 'CAPTURE UM PONTO']];

export class HUD {
  constructor(game) {
    this.g = game; this.hmT = 0; this.vig = 0; this.qT = 0; this.flashV = 0; this.dmgDirs = []; this.mapDirty = false; this.mapT = 0;
    this.feedItems = []; this.icons = {}; this.playT = 0; this.tunT = 0; this.slowT = 0; this.scT = 0; this.bigT = 0; this.hs = 1; this.tkMax = 1;
    this.objEls = []; this.flagEls = []; this.mapOpen = false; this.dfr = 0;
    this.decorate(document);
    this.tutInit();
    this.buildLegend();
    this.applyUi();
    window.addEventListener('resize', () => this.applyUi());
    document.addEventListener('keydown', (e) => this.onKey(e));
    const hot = 'button,.cls,.wcard,.chip';
    document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest(hot)) this.sfx('click'); });
    document.addEventListener('mouseover', (e) => { const b = e.target.closest ? e.target.closest(hot) : null; if (b && b !== this.hov) this.sfx('hover'); this.hov = b; });
    E('bKeysBack').onclick = () => this.g.resume();
  }
  sfx(n) { try { const a = this.g.audio; if (a && typeof a.ui === 'function') a.ui(n); } catch (e) { /* optional audio hook */ } }
  decorate(root) { for (const el of root.querySelectorAll('[data-ic]')) if (!el.firstChild) el.innerHTML = IC[el.dataset.ic] || ''; }
  // Scales: HUD and menus are designed at 1366x768 and zoomed uniformly; the user HUD scale multiplies on top.
  applyUi() {
    const s = this.g.settings || {}; const auto = Math.min(innerWidth / 1366, innerHeight / 768) || 1;
    this.hs = Math.max(0.7, Math.min(1.7, auto)) * (s.hudScale || 1);
    const st = document.documentElement.style;
    st.setProperty('--hs', this.hs.toFixed(3)); st.setProperty('--ms', Math.max(0.6, Math.min(1.7, auto)).toFixed(3)); st.setProperty('--xh', s.xhColor || '#ffffff');
    this.legDirty = true;
  }
  buildLegend() {
    const cls = this.g.cls || 'assalto'; this.legCls = this.g.cls;
    const it = [[kc('W') + kc('A') + kc('S') + kc('D'), 'MOVER'], [kc('SHIFT'), 'CORRER'], [kc('CTRL'), 'AGACHAR · DESLIZAR'], [kc('ESPAÇO'), 'PULAR'], [kc('M1'), 'ATIRAR'], [kc('M2'), 'MIRAR'], [kc('R'), 'RECARREGAR'],
      [kc('G'), 'GRANADA'], [kc('Q'), 'TUNELAR'], [kc('E'), 'SUPERPOSIÇÃO'], [kc('F'), GSHORT[cls] || 'EQUIPAMENTO'], [kc('Z'), 'MARCAR'], [kc('TAB'), 'PLACAR'], [kc('M'), 'MAPA']];
    E('legin').innerHTML = it.map(([k, t]) => `<span>${k}${t}</span>`).join('') + `<span class="more">${kc('H')}TODOS OS CONTROLES</span>`;
    this.legDirty = true;
  }
  // Shrink the legend strip until it fits the viewport (font metrics differ between machines).
  fitLegend() {
    const L = E('legin'); L.style.zoom = 1;
    const pw = E('legend').getBoundingClientRect().width, iw = L.getBoundingClientRect().width;
    if (!pw || !iw) { this.legDirty = true; return; }
    const k = pw * 0.985 / iw; L.style.zoom = k < 1 ? k.toFixed(3) : 1;
  }
  // ---------- keys owned by the HUD: H / F1 controls overlay, M tactical map, menu keyboard navigation ----------
  onKey(e) {
    const g = this.g, c = e.code, vis = (id) => !E(id).classList.contains('hidden');
    if (c === 'F1') e.preventDefault();
    if (c === 'KeyH' || c === 'F1') {
      if (e.repeat) return;
      if (g.state === 'play') { g.pause(); g.show('keys'); } else if (g.state === 'pause' && vis('keys')) g.resume();
      return;
    }
    if (c === 'KeyM') { if (g.state === 'play' && !e.repeat) this.setMap(!this.mapOpen); return; }
    if (g.state === 'play' || g.state === 'deploy' || g.state === 'loading') return;
    if (g.state === 'menu') {
      if (c === 'Escape') { if (vis('how')) E('bHowBack').click(); else if (vis('opts')) E('bOptBack').click(); }
      // deferred: Game's own keydown handler must still see the menu state for this event
      if (c === 'Enter' && vis('menu') && !(document.activeElement && document.activeElement.tagName === 'BUTTON')) setTimeout(() => { if (g.state === 'menu') E('bPlay').click(); }, 0);
    }
    if (c === 'ArrowDown' || c === 'ArrowUp') {
      const ov = document.querySelector('.ov:not(.hidden)'); if (!ov) return;
      const bs = [...ov.querySelectorAll('button.btn, button.sbtn')]; if (!bs.length) return;
      const i = bs.indexOf(document.activeElement); bs[(i + (c === 'ArrowDown' ? 1 : bs.length - 1) + (i < 0 && c === 'ArrowUp' ? 1 : 0)) % bs.length].focus(); e.preventDefault();
    }
  }
  setMap(on) { this.mapOpen = !!on; setC(E('bigmap'), 'hidden', !on); this.bigT = 0; }
  // Called from Game.show(id) so every overlay is filled right before it becomes visible.
  onShow(id) {
    const g = this.g;
    E('hud').classList.toggle('behind', !!id && id !== 'score');
    if (id) this.setMap(false);
    if (id === 'menu') { this.rankBar(null, 'menuxp', 'menuxpb'); setH(E('menukeys'), ESS.map(([k, t]) => `<div><span class="ek">${k}</span>${t}</div>`).join('')); }
    else if (id === 'how') E('howkbd').innerHTML = keyboardHTML(g);
    else if (id === 'keys') E('keyskbd').innerHTML = keyboardHTML(g);
    else if (id === 'pause') E('pausekeys').innerHTML = cheatHTML(g);
    else if (id === 'opts') this.fillOpts();
    else if (id === 'end') this.fillEnd();
    else if (id === 'score') this.drawScore();
  }
  setDiff(i) { for (const b of document.querySelectorAll('[data-diff]')) b.classList.toggle('on', +b.dataset.diff === i); E('diffx').textContent = DIFFX[i] || ''; }
  rankBar(nameId, textId, barId) {
    const xp = +(localStorage.getItem('colapso.xp') || 0), R = rankOf(xp), base = RANKS[R.i][1]; const fr = R.next ? (xp - base) / (R.next - base) : 1;
    if (nameId) $(nameId).textContent = R.name;
    $(textId).textContent = R.next ? `FALTAM ${fmtN(R.next - xp)} XP PARA ${RANKS[R.i + 1][0]}` : 'PATENTE MÁXIMA';
    $(barId).style.width = (fr * 100).toFixed(1) + '%';
  }
  fillEnd() {
    const g = this.g, pe = g.pent, win = (E('endT').textContent || '').trim().toUpperCase().startsWith('VIT');
    E('end').classList.toggle('lose', !win);
    if (g.tickets) E('endline').innerHTML = `<b>KAPPA ${g.tickets[0]}</b> &nbsp;×&nbsp; <b>${g.tickets[1]} ÔMEGA</b>`;
    if (pe) {
      E('endtiles').innerHTML = [['ABATES', pe.kills || 0], ['MORTES', pe.deaths || 0], ['CAPTURAS', pe.caps || 0], ['PONTOS', fmtN(pe.score)]].map(([l, v]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');
      E('endS').classList.add('hidden');
    }
    this.rankBar('endrank', 'endxp', 'endxpb');
    try { localStorage.setItem('colapso.tut', '1'); } catch (e) { /* storage unavailable */ }
  }
  reset() {
    const g = this.g;
    E('kf').innerHTML = ''; E('sfeed').innerHTML = ''; E('radio').innerHTML = ''; this.feedItems.length = 0; this.event(null);
    E('flags').innerHTML = g.flags.map(f => `<div class="fl" id="fl${f.id}"><span>${f.id}</span><i><u></u></i></div>`).join('');
    this.flagEls = [...E('flags').children]; for (const el of this.flagEls) el._u = el.querySelector('u');
    E('objs').innerHTML = g.flags.map(f => `<div class="om"><div class="omi"><u></u><div class="omd"></div><b>${f.id}</b><span></span></div></div>`).join('');
    this.objEls = [...E('objs').children].map(el => ({ el, u: el.querySelector('u'), s: el.querySelector('span') }));
    this.tkMax = 1; this.playT = 0; this.dmgDirs.length = 0; this.icId = null; this.setMap(false);
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
    const g = this.g, s = g.settings;
    const bind = (id, key, def, fmt = (v) => v, after) => {
      const el = $(id); el.value = s[key] ?? def; const lab = $('v' + id.slice(1)); if (lab) lab.textContent = fmt(+el.value);
      el.oninput = () => { s[key] = parseFloat(el.value); if (lab) lab.textContent = fmt(s[key]); g.saveSettings(); if (after) after(); };
    };
    bind('oSens', 'sens', 1, v => (+v).toFixed(2)); bind('oAds', 'adsSens', 0.7, v => (+v).toFixed(2)); bind('oFov', 'fov', 78, v => v + '°');
    bind('oVol', 'vol', 0.8, v => Math.round(v * 100) + '%', () => g.audio.setVolume(s.vol));
    bind('oHud', 'hudScale', 1, v => Math.round(v * 100) + '%', () => this.applyUi());
    $('oQ').value = s.quality; $('oQ').onchange = () => { s.quality = $('oQ').value; g.scale = s.quality === 'low' ? 0.6 : s.quality === 'high' ? 1 : 0.85; g.resize(); g.saveSettings(); };
    $('oInv').checked = !!s.invert; $('oInv').onchange = () => { s.invert = $('oInv').checked; g.saveSettings(); };
    $('oFps').checked = !!s.showFps; $('oFps').onchange = () => { s.showFps = $('oFps').checked; $('fps').classList.toggle('hidden', !s.showFps); g.saveSettings(); };
    const hint = () => { const m = s.hints || 'always'; for (const b of document.querySelectorAll('[data-hints]')) b.classList.toggle('on', b.dataset.hints === m); $('hintsx').textContent = HINTX[m] || ''; };
    for (const b of document.querySelectorAll('[data-hints]')) b.onclick = () => { s.hints = b.dataset.hints; g.saveSettings(); hint(); };
    const xh = () => { const c = s.xhColor || '#ffffff'; for (const b of document.querySelectorAll('[data-xh]')) b.classList.toggle('on', b.dataset.xh === c); this.applyUi(); };
    for (const b of document.querySelectorAll('[data-xh]')) b.onclick = () => { s.xhColor = b.dataset.xh; g.saveSettings(); xh(); };
    hint(); xh();
  }
  // ---------- weapon icons: side view baked once per weapon with the deploy preview renderer ----------
  ensurePreview() {
    if (this.pr) return;
    this.prC = document.createElement('canvas'); this.prC.width = 520; this.prC.height = 260;
    this.pr = new THREE.WebGLRenderer({ canvas: this.prC, antialias: true, alpha: true });
    this.ps = new THREE.Scene(); this.ps.add(new THREE.HemisphereLight(0xbfd8ff, 0x303040, 2.4)); const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(1, 1, 1); this.ps.add(d);
    const rim = new THREE.DirectionalLight(0x39e6ff, 2); rim.position.set(-1, 0.3, -1); this.ps.add(rim);
    this.pc = new THREE.PerspectiveCamera(30, 2, 0.01, 10); this.pc.position.set(0, 0.12, 2.0); this.pc.lookAt(0, 0, 0);
  }
  icon(id) {
    if (this.icons[id] !== undefined) return this.icons[id];
    let url = '', gun = null;
    try {
      this.ensurePreview(); const w = WEAPONS[id];
      gun = buildGun(w.type, { id, sight: w.sight });
      const box = new THREE.Box3().setFromObject(gun), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      const IW = 320, IH = 110; this.pr.setSize(IW, IH, false);
      const hw = Math.max(sz.z / 2 * 1.05, sz.y / 2 * 1.08 * IW / IH, 0.01), hh = hw * IH / IW;
      const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.01, 20); cam.position.set(c.x + 5, c.y, c.z); cam.lookAt(c);
      if (this.pg) this.pg.visible = false;
      this.ps.add(gun); this.pr.setClearColor(0x000000, 0); this.pr.render(this.ps, cam);
      // 2D post: light monochrome plate with shading, so the icon reads on dark glass
      const cv = document.createElement('canvas'); cv.width = IW; cv.height = IH; const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(this.prC, 0, 0);
      const im = x.getImageData(0, 0, IW, IH), px = im.data; let any = 0;
      for (let i = 0; i < px.length; i += 4) { if (!px[i + 3]) continue; any++; const v = Math.min(255, 118 + (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) * 0.95); px[i] = v * 0.9; px[i + 1] = v * 0.96; px[i + 2] = v; }
      if (any > 50) { x.putImageData(im, 0, 0); url = cv.toDataURL(); }
    } catch (err) { url = ''; }
    if (this.ps && gun) this.ps.remove(gun);
    if (this.pg) this.pg.visible = true;
    if (this.pr) this.pr.setSize(520, 260, false);
    return (this.icons[id] = url);
  }
  iconImg(id) { const u = this.icon(id); return u ? `<img src="${u}" alt="">` : ''; }
  // ---------- deploy ----------
  drawDeploy() {
    const g = this.g, C = CLASSES[g.cls];
    $('classes').innerHTML = Object.entries(CLASSES).map(([k, c], i) => `<div class="cls ${g.cls === k ? 'sel' : ''}" data-k="${k}" style="--cc:${c.color}">${clsIcon(k, c.icon)}<div><h3>${c.name}</h3><p>${c.gadget}</p></div>${kc(String(i + 1))}<span class="ok">SELECIONADA</span></div>`).join('');
    for (const el of document.querySelectorAll('#classes .cls')) el.onclick = () => g.setClass(el.dataset.k);
    const st = (lab, v) => `<div class="stat"><span>${lab}</span><i><b style="width:${Math.max(4, Math.min(100, v * 100)).toFixed(0)}%"></b></i></div>`;
    $('wlist').innerHTML = C.weapons.map(id => {
      const w = WEAPONS[id]; const dps = w.dmg * w.pellets * w.rpm / 60;
      return `<div class="wcard ${g.loadout === id ? 'sel' : ''}" data-id="${id}">${this.iconImg(id)}<div class="wi"><h4>${w.name}<em>EQUIPADA</em></h4>${st('DANO/S', dps / 600)}${st('ALCANCE', w.falloff[1] / 300)}${st('CONTROLE', 1 - w.recoilV / 0.1)}</div></div>`;
    }).join('');
    for (const el of document.querySelectorAll('#wlist .wcard')) el.onclick = () => { g.loadout = el.dataset.id; this.drawDeploy(); };
    $('slist').innerHTML = SECONDARIES.map(id => `<div class="chip ${g.secondary === id ? 'sel' : ''}" data-id="${id}">${this.iconImg(id)}${WEAPONS[id].name}</div>`).join('');
    for (const el of document.querySelectorAll('#slist .chip')) el.onclick = () => { g.secondary = el.dataset.id; this.drawDeploy(); };
    $('gbox').style.setProperty('--cc', C.color);
    $('gbox').innerHTML = `${IC[GADGET_IC[g.cls]] || ''}<div><b>${C.gadget}</b><p>${C.gdesc}</p></div>`;
    // weapon detail + spinning 3D preview + ballistic sheet
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
    try { this.preview(g.loadout); } catch (err) { /* no WebGL for the preview: the rest of the screen still works */ }
    const xp = +(localStorage.getItem('colapso.xp') || 0); const R = rankOf(xp);
    $('rankbox').innerHTML = `<b>${R.name}</b><br>${fmtN(xp)} XP · próxima patente: ${R.next ? fmtN(R.next) : '—'}`;
    // entry points: chips + pulsing circles on the map
    const opts = g.spawnOptions(); this.spOpts = opts;
    const isSel = (o) => g.deploySel && g.deploySel.x === o.x && g.deploySel.z === o.z;
    const spName = (o) => (o.label === 'BASE' ? 'BASE KAPPA' : 'PONTO ' + o.label);
    $('spawns').innerHTML = opts.map((o, i) => `<div class="chip ${isSel(o) ? 'sel' : ''}" data-i="${i}">${spName(o)}</div>`).join('');
    for (const el of document.querySelectorAll('#spawns .chip')) el.onclick = () => { g.deploySel = opts[+el.dataset.i]; this.drawDeploy(); };
    $('dhint').textContent = `ENTRADA: ${spName(opts.find(isSel) || opts[0])} · ${C.name}`;
    const cv = $('dmap'); this.drawDeployMap();
    cv.onclick = (ev) => {
      const r = cv.getBoundingClientRect(), S = cv.width / (SX * VS); const mx = (ev.clientX - r.left) / r.width * cv.width, my = (ev.clientY - r.top) / r.height * cv.height;
      let best = null, bd = 60; for (const o of opts) { const d = Math.hypot(o.x * S - mx, o.z * S - my); if (d < bd) { bd = d; best = o; } }
      if (best) { g.deploySel = best; this.drawDeploy(); }
    };
  }
  mapTag(ctx, x, y, text, col, W) {
    ctx.font = 'bold 11px Arial, sans-serif'; const w = ctx.measureText(text).width + 10; x = Math.max(w / 2 + 2, Math.min(W - w / 2 - 2, x)); y = Math.max(10, Math.min(W - 10, y));
    ctx.fillStyle = 'rgba(5,8,14,.82)'; ctx.fillRect(x - w / 2, y - 8, w, 16); ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1); ctx.textBaseline = 'alphabetic';
  }
  // North-up tactical base layer shared by the deploy map and the big map
  drawTac(ctx, W) {
    const g = this.g, S = W / (SX * VS);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
    if (this.mapC) ctx.drawImage(this.mapC, 0, 0, W, W); else { ctx.fillStyle = '#0a0f16'; ctx.fillRect(0, 0, W, W); }
    ctx.fillStyle = 'rgba(5,8,14,.4)'; ctx.fillRect(0, 0, W, W);
    this.mapTag(ctx, BASES[0].x * S, BASES[0].z * S - 30, 'BASE KAPPA', CYAN, W);
    ctx.fillStyle = ORANGE; ctx.fillRect(BASES[1].x * S - 5, BASES[1].z * S - 5, 10, 10); this.mapTag(ctx, BASES[1].x * S, BASES[1].z * S + 18, 'BASE ÔMEGA', ORANGE, W);
    for (const f of g.flags) {
      const o = owner(f), col = o === 0 ? CYAN : o === 1 ? ORANGE : '#c9d1dd', x = f.x * S, y = f.z * S;
      ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 7.5 * S, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      this.flagIcon(ctx, x, y, f, 20); if (f.name) this.mapTag(ctx, x, y + 7.5 * S + 11, f.name, col, W);
    }
  }
  drawDeployMap() {
    const cv = $('dmap'); if (!cv || !this.g.flags) return; const ctx = this.dctx || (this.dctx = cv.getContext('2d')); const g = this.g, W = cv.width, S = W / (SX * VS), ph = (performance.now() / 900) % 1;
    this.drawTac(ctx, W);
    for (const o of this.spOpts || []) {
      const sel = g.deploySel && g.deploySel.x === o.x && g.deploySel.z === o.z, x = o.x * S, y = o.z * S;
      ctx.lineWidth = 2; ctx.strokeStyle = `rgba(57,230,255,${(1 - ph).toFixed(2)})`; ctx.beginPath(); ctx.arc(x, y, 17 + ph * 17, 0, TAU); ctx.stroke();
      ctx.lineWidth = sel ? 4 : 2.5; ctx.strokeStyle = sel ? '#fff' : CYAN; ctx.fillStyle = sel ? 'rgba(57,230,255,.5)' : 'rgba(57,230,255,.16)';
      ctx.beginPath(); ctx.arc(x, y, 17, 0, TAU); ctx.fill(); ctx.stroke();
      if (o.label === 'BASE') { ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BASE', x, y + 4); } else this.flagIcon(ctx, x, y, o, 20);
      if (sel) this.mapTag(ctx, x, y - 30, '▼ VOCÊ ENTRA AQUI', '#fff', W);
    }
  }
  drawBig() {
    const cv = E('bmc'), ctx = this.bctx || (this.bctx = cv.getContext('2d')), g = this.g, W = cv.width, S = W / (SX * VS), p = g.player;
    this.drawTac(ctx, W);
    for (const e of g.entities) {
      if (!e.alive || e.isPlayer) continue; if (e.team === 1 && !(e.spottedT > 0)) continue;
      ctx.fillStyle = e.isEcho ? '#b0ffff' : e.team === 0 ? CYAN : '#ff5a3a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(e.pos.x * S, e.pos.z * S, 4.5, 0, TAU); ctx.fill(); ctx.stroke();
    }
    const x = p.pos.x * S, y = p.pos.z * S;
    ctx.save(); ctx.translate(x, y); ctx.rotate(-p.yaw);
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 80, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-8, 8); ctx.lineTo(0, 4); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    this.mapTag(ctx, x, y + 22, 'VOCÊ', '#fff', W);
  }
  // Loadout preview: spins the selected weapon and animates the deploy map (only alive on the deploy screen)
  preview(id) {
    const cv = $('wprev'); if (!cv) return; this.ensurePreview();
    if (this.pg) { this.prRot = this.pg.rotation.y; this.ps.remove(this.pg); }
    const w = WEAPONS[id]; this.pg = new THREE.Group(); const gun = buildGun(w.type, { id, sight: w.sight }); gun.position.z = 0.15; this.pg.add(gun); this.pg.rotation.y = this.prRot ?? -1.1; this.ps.add(this.pg);
    const s = { sniper: 1.5, lmg: 1.45, lmg2: 1.45, dmr: 1.55, rifle: 1.75, bullpup: 1.9, shotgun: 1.8, smg: 2.4, pdw: 2.4, pistol: 3.6, mpistol: 3.6, revolver: 3.2 }[w.type] || 2;
    this.pg.scale.setScalar(s * 1.05);
    if (this.prLoop) return;
    this.prLoop = true;
    const loop = () => {
      if (this.g.state !== 'deploy') { this.prLoop = false; return; }
      if (this.pg) { this.pg.rotation.y += 0.01; this.pr.render(this.ps, this.pc); const c2 = $('wprev'); if (c2) { const x = c2.getContext('2d'); x.clearRect(0, 0, 520, 260); x.drawImage(this.prC, 0, 0); } }
      if ((++this.dfr & 1) === 0) this.drawDeployMap();
      requestAnimationFrame(loop);
    };
    loop();
  }
  flagIcon(ctx, x, y, f, r) {
    const o = owner(f), col = o === 0 ? CYAN : o === 1 ? ORANGE : '#c9d1dd';
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = 'rgba(8,12,18,.88)'; ctx.fillRect(-r / 2, -r / 2, r, r); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(-r / 2, -r / 2, r, r);
    ctx.restore(); ctx.fillStyle = col; ctx.font = `bold ${r * 0.75 | 0}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(f.id || f.label, x, y + 1); ctx.textBaseline = 'alphabetic';
  }
  // ---------- events ----------
  hit(kill, head) { const h = E('hm'); h.style.opacity = 1; h.classList.toggle('k', !!kill); this.hmT = kill ? 0.3 : 0.12; }
  damage(from) {
    this.vig = Math.min(1, this.vig + 0.5);
    if (from) this.dmgDirs.push({ x: from.x, z: from.z, t: 1.2 });
  }
  flash(v) { this.flashV = Math.max(this.flashV, v); }
  quantum(v) { this.qT = Math.max(this.qT, v); }
  feed(k, v, team, head, mine, meVictim) {
    const el = document.createElement('div'); el.className = 'kfi' + (mine ? ' mine' : meVictim ? ' dead' : '');
    const kcl = team === 0 ? 'a' : team === 1 ? 'e' : '', vcl = team === 0 ? 'e' : team === 1 ? 'a' : '';
    el.innerHTML = `<span class="${mine ? 'me' : kcl}">${esc(k)}</span>${head ? IC.head : IC.gun}<span class="${meVictim ? 'me' : vcl}">${esc(v)}</span>`;
    const box = E('kf'); box.prepend(el); setTimeout(() => el.remove(), 6000);
    while (box.children.length > 6) box.lastChild.remove();
  }
  // Stacked score / notice feed under the crosshair: "+100 ABATE", tips, warnings
  toast(text, pts, bad) {
    text = String(text);
    if (/^(ABATIDO POR|VOCÊ MORREU)/.test(text)) return; // shown by the death card instead
    if (pts && /CAPTURADO/.test(text)) this.tutMark('cap');
    const el = document.createElement('div'); el.className = 'sf' + (bad ? ' bad' : '');
    el.innerHTML = (pts ? `<b>+${pts}</b>` : '') + `<span>${keycapify(text.replace(/^([QEGFRZ]) · /, '[$1] '))}</span>`;
    E('sfeed').prepend(el); this.feedItems.unshift({ el, t: pts ? 3.2 : Math.min(5, 2.4 + text.length * 0.035), out: false });
    while (this.feedItems.length > 4) this.feedItems.pop().el.remove();
  }
  // Fading squad radio log (optional hook for other systems)
  radio(name, text) {
    const box = E('radio'), el = document.createElement('div'); el.innerHTML = `<b>${esc(name)}</b>${esc(text)}`; box.append(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 5000); setTimeout(() => el.remove(), 5600);
  }
  event(t) { const el = E('evt'); setC(el, 'hidden', !t); if (t) setT(el, t); }
  breath(scoped, hold, b) { const el = E('breath'); setC(el, 'hidden', !scoped); if (scoped) setH(el, hold ? `SEGURANDO O FÔLEGO ${b.toFixed(1)} s` : b <= 0.05 ? 'SEM FÔLEGO' : kc('SHIFT') + ' SEGURAR O FÔLEGO'); }
  hideScore() { if (this.g.state === 'play') E('score').classList.add('hidden'); }
  // ---------- first-steps checklist (first run only) ----------
  tutInit() {
    this.tut = null; this.tutN = 0; this.tutHideT = 0;
    try { if (localStorage.getItem('colapso.tut')) return; } catch (e) { return; }
    this.tut = TUT.map(([id]) => ({ id, ok: false }));
    E('tutl').innerHTML = TUT.map(([id, keys, text]) => `<div class="tu" id="tu_${id}"><span class="tk">${keys}</span><span>${text}</span><em>${IC.check}</em></div>`).join('');
  }
  tutMark(id) {
    const t = this.tut; if (!t) return; const s = t.find(q => q.id === id); if (!s || s.ok) return;
    s.ok = true; this.tutN++; $('tu_' + id).classList.add('ok');
    if (this.tutN >= t.length) { this.tut = null; this.tutHideT = 5; try { localStorage.setItem('colapso.tut', '1'); } catch (e) { /* ignore */ } this.toast('TREINAMENTO CONCLUÍDO · BOA CAÇADA', 0); }
  }
  tutUpdate(dt, W, active) {
    const g = this.g, show = (!!this.tut || this.tutHideT > 0) && (g.settings.hints || 'always') !== 'never';
    setC(E('tut'), 'hidden', !show); this.tutOn = show; if (this.tutHideT > 0) this.tutHideT -= dt;
    if (!this.tut || !active) { this.tL = null; return; }
    const p = g.player, sp = Math.hypot(p.vel.x, p.vel.z), echo = !!(g.echo && g.echo.alive), L = this.tL;
    if (sp > 2) this.tutMark('move'); if (p.sprint && sp > 4) this.tutMark('sprint'); if (g.ads > 0.8) this.tutMark('ads'); if (g.reloadT > 0) this.tutMark('reload'); if (echo) this.tutMark('echo');
    if (L) {
      if (L.id === W.id && W.mag < L.mag && !(g.reloadT > 0)) this.tutMark('fire');
      if (L.en - g.energy >= 15 && !L.echo && !echo) this.tutMark('tunnel');
      L.id = W.id; L.mag = W.mag; L.en = g.energy; L.echo = echo;
    } else this.tL = { id: W.id, mag: W.mag, en: g.energy, echo };
    setT(E('tutn'), this.tutN + ' / ' + TUT.length);
  }
  // ---------- per-frame ----------
  update(dt) {
    const g = this.g, p = g.player;
    if (this.hmT > 0) { this.hmT -= dt; if (this.hmT <= 0) E('hm').style.opacity = 0; }
    this.vig = Math.max(0, this.vig - dt * 0.8);
    const lowHp = p.alive ? Math.max(0, (50 - p.hp) / 50) * 0.6 : 0.8, echoOn = !!(g.echo && g.echo.alive);
    setS(E('vign'), 'opacity', Math.max(this.vig, lowHp, (g.suppress || 0) * 0.35).toFixed(2));
    this.qT = Math.max(0, this.qT - dt * 1.5); setS(E('qfx'), 'opacity', Math.max(this.qT, echoOn ? 0.25 + Math.sin(g.time * 8) * 0.08 : 0).toFixed(2));
    this.flashV = Math.max(0, this.flashV - dt * 1.2); setS(E('flash'), 'opacity', this.flashV.toFixed(2));
    for (let i = this.feedItems.length - 1; i >= 0; i--) { const it = this.feedItems[i]; it.t -= dt; if (it.t <= 0) { it.el.remove(); this.feedItems.splice(i, 1); } else if (it.t < 0.4 && !it.out) { it.out = true; it.el.classList.add('out'); } }
    if (!g.weapons) return;
    const playing = g.state === 'play', alive = p.alive, act = alive && playing;
    if (playing) this.playT += dt;
    // --- weapon panel
    const W = g.W, D = g.WD, ws = g.weapons;
    const low = W.mag <= D.mag * 0.25, empty = W.mag <= 0;
    setT(E('ammo'), W.mag); setT(E('ammoR'), '/ ' + W.reserve);
    setC(E('wpn'), 'low', low && !empty); setC(E('wpn'), 'empty', empty);
    setT(E('wname'), D.name); setT(E('wmode'), typeof g.fireMode === 'string' ? g.fireMode.toUpperCase() : D.rocket ? 'FOGUETE' : D.bolt ? 'FERROLHO' : D.auto ? 'AUTO' : 'SEMI');
    if (this.icId !== W.id) { this.icId = W.id; const u = this.icon(W.id), im = E('wicon'); if (u) im.src = u; im.style.visibility = u ? '' : 'hidden'; }
    this.slotRow('sl1', ws.primary, g.slot === 'primary'); this.slotRow('sl2', ws.secondary, g.slot === 'secondary');
    const C = CLASSES[g.cls] || {}, gw = ws.gadget, gc = gw ? gw.mag + gw.reserve : (g.gadget || 0);
    setT(E('sl3n'), gw ? WEAPONS[gw.id].name : (C.gadget || 'EQUIPAMENTO')); setT(E('sl3a'), '×' + gc); setC(E('sl3'), 'act', g.slot === 'gadget'); setC(E('sl3'), 'off', gc <= 0);
    setT(E('nades'), '×' + g.nades); setC(E('sl4'), 'off', g.nades <= 0);
    // --- vitals + abilities
    setT(E('hpv'), Math.max(0, Math.ceil(p.hp))); bar(E('hpbar').firstElementChild, p.hp / 100); setC(E('hpbar'), 'low', p.hp < 35); setC(E('vit'), 'low', p.hp < 35);
    setT(E('env'), Math.floor(g.energy)); bar(E('enbar').firstElementChild, g.energy / 100);
    setC(E('abE'), 'act', echoOn); setC(E('abE'), 'off', !echoOn && g.energy < 50);
    setT(E('abEs'), echoOn ? 'COLAPSAR · ' + g.echo.t.toFixed(1) + ' s' : g.energy < 50 ? 'SEM ENERGIA (50)' : 'CUSTO 50');
    // --- crosshair spread
    const sp = Math.round((D.spreadHip * (1 - g.ads) + D.spreadAds * g.ads + g.bloom + (Math.hypot(p.vel.x, p.vel.z) > 1 ? D.spreadMove : 0)) * 900 + 4) || 4;
    const xh = E('xh'); if (xh._sp !== sp) { xh._sp = sp; xh.style.setProperty('--sp', sp + 'px'); }
    setS(xh, 'opacity', g.ads > 0.6 || !alive ? '0' : '1');
    // --- tunnelling preview (10 Hz): thickness, transmission and cost when facing a wall
    this.tunT -= dt;
    if (this.tunT <= 0) {
      this.tunT = 0.1; const th = E('tunhint'), mk = E('enmark'), abQ = E('abQ'), qs = E('abQs');
      const s = act ? scanTunnel(g.world, p.pos, p.yaw) : null;
      if (s) {
        setC(th, 'hidden', false); const cost = Math.ceil(s.cost), poor = s.cost > g.energy;
        if (s.exit && s.cost <= 100) { setH(th, `${kc('Q')}ATRAVESSAR · d=${s.d.toFixed(1)} m · T=${s.T.toFixed(2)} · custo ${cost}`); setC(th, 'no', poor); setC(mk, 'hidden', false); setS(mk, 'left', Math.min(100, cost) + '%'); setT(qs, poor ? `SEM ENERGIA (${cost})` : 'CUSTO ' + cost); setC(abQ, 'off', poor); }
        else { setH(th, `${kc('Q')}BARREIRA ESPESSA · T≈0`); setC(th, 'no', true); setC(mk, 'hidden', true); setT(qs, 'PAREDE ESPESSA'); setC(abQ, 'off', true); }
      } else { setC(th, 'hidden', true); setC(mk, 'hidden', true); const ok = g.energy >= 18; setC(abQ, 'off', !ok); setT(qs, ok ? 'AVANÇO · CUSTO 18' : 'SEM ENERGIA (18)'); }
    }
    // --- reload prompt under the crosshair
    const rl = E('rld'); let mode = 0; // 1 hint, 2 reloading, 3 out of ammo
    if (act) { if (g.reloadT > 0) mode = 2; else if (empty && W.reserve <= 0) mode = 3; else if (low && W.reserve > 0) mode = 1; }
    setC(rl, 'hidden', !mode);
    if (mode) {
      setC(rl, 'busy', mode !== 1); setC(rl, 'empty', mode === 3 || (mode === 1 && empty));
      setH(E('rldt'), mode === 2 ? 'RECARREGANDO' : mode === 3 ? `SEM MUNIÇÃO · ${kc(g.slot === 'secondary' ? '1' : '2')} TROCAR DE ARMA` : empty ? 'RECARREGAR · PENTE VAZIO' : 'RECARREGAR · MUNIÇÃO BAIXA');
      bar(E('rldb').firstElementChild, mode === 2 ? 1 - g.reloadT / (D.reload || 2) : 0);
    }
    // --- tickets, flags row, capture box
    const tk = g.tickets; if (tk[0] > this.tkMax) this.tkMax = tk[0]; if (tk[1] > this.tkMax) this.tkMax = tk[1];
    setT(E('tk0'), tk[0]); setT(E('tk1'), tk[1]); bar(E('tkb0'), tk[0] / this.tkMax); bar(E('tkb1'), tk[1] / this.tkMax);
    let inF = null;
    for (let i = 0; i < g.flags.length; i++) {
      const f = g.flags[i], el = this.flagEls[i]; if (!el) continue; const o = owner(f), here = g.inFlag(f);
      setC(el, 'us', o === 0); setC(el, 'them', o === 1); setC(el, 'contest', f.contested); setC(el, 'neg', f.cap < 0); setC(el, 'here', here); bar(el._u, Math.abs(f.cap));
      if (here) inF = f;
    }
    const cb = E('capbox'); setC(cb, 'hidden', !inF);
    if (inF) {
      const c = inF.cap, b = E('capbar').firstElementChild, q = Math.round(c * 50), o = owner(inF);
      if (b._q !== q) { b._q = q; b.style.left = (q >= 0 ? 50 : 50 + q) + '%'; b.style.width = Math.abs(q) + '%'; b.style.background = q >= 0 ? CYAN : ORANGE; }
      setT(E('captxt'), `PONTO ${inF.id} · ${inF.name} · ${inF.contested ? 'CONTESTADO' : c >= 1 ? 'SEGURO' : c < 0 ? 'NEUTRALIZANDO' : 'CAPTURANDO'} · ${inF.n[0]} × ${inF.n[1]}`);
      setC(cb, 'us', o === 0); setC(cb, 'them', o === 1);
    }
    // --- damage direction (fixed pool, no innerHTML)
    const dd = E('dmgdir').children; let n = 0;
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) if ((this.dmgDirs[i].t -= dt) <= 0) this.dmgDirs.splice(i, 1);
    for (const d of this.dmgDirs) {
      if (n >= dd.length) break; const el = dd[n++], rel = -(Math.atan2(d.x - p.pos.x, d.z - p.pos.z) - (p.yaw + Math.PI));
      el.style.transform = 'rotate(' + rel.toFixed(2) + 'rad) translateY(-120px)'; el.style.opacity = Math.min(1, d.t).toFixed(2); el._on = true;
    }
    for (; n < dd.length; n++) if (dd[n]._on) { dd[n]._on = false; dd[n].style.opacity = 0; }
    // --- death card
    const dead = !alive && playing; setC(E('dead'), 'hidden', !dead); setC(E('hud'), 'isdead', dead);
    if (dead) {
      const ld = g.lastDeath, k = g.killer, t = Math.max(0, g.deathT || 0);
      setT(E('deadN'), (ld && ld.killerName) || (k && k.name) || 'AMBIENTE');
      setT(E('deadW'), ld && ld.weaponName ? ld.weaponName + (ld.dist != null ? ' · ' + Math.round(ld.dist) + ' m' : '') : '');
      setT(E('deadT'), Math.ceil(t)); bar(E('deadB'), t / 3.5);
    }
    // --- legend (hints mode), mode line, checklist
    const hm = g.settings.hints || 'always', showLeg = hm === 'always' || (hm === 'start' && this.playT < 90);
    setC(E('hud'), 'nolegend', !showLeg);
    if (this.legCls !== g.cls) this.buildLegend();
    if (this.legDirty && showLeg) { this.legDirty = false; this.fitLegend(); }
    this.slowT -= dt;
    if (this.slowT <= 0) {
      this.slowT = 0.5; let ml = (g.modeName || 'CONQUISTA') + (g.mapName ? ' · ' + g.mapName : ''); const mt = g.matchTime;
      if (typeof mt === 'number' && isFinite(mt)) ml += ' · ' + Math.floor(mt / 60) + ':' + String(Math.floor(mt % 60)).padStart(2, '0');
      setT(E('modeline'), String(ml).toUpperCase());
    }
    this.tutUpdate(dt, W, act);
    this.updateObjs(act);
    // --- maps + scoreboard
    this.mapT -= dt; if (this.mapDirty && this.mapT <= 0) { this.mapDirty = false; this.mapT = 0.5; const r = this.mapBox; this.mapBox = null; this.bakeMap(r[0], r[1], r[2], r[3]); }
    this.drawMinimap();
    if (this.mapOpen) { this.bigT -= dt; if (this.bigT <= 0) { this.bigT = 0.1; this.drawBig(); } }
    if (!E('score').classList.contains('hidden')) { this.scT -= dt; if (this.scT <= 0) { this.scT = 0.25; this.drawScore(); } } else this.scT = 0;
  }
  slotRow(id, w, act) {
    if (!w) return; const r = this.slR || (this.slR = {}); const o = r[id] || (r[id] = { row: $(id), n: $(id + 'n'), a: $(id + 'a') });
    setT(o.n, WEAPONS[w.id].name); setT(o.a, w.mag + ' / ' + w.reserve); setC(o.row, 'act', act); setC(o.row, 'off', w.mag + w.reserve <= 0);
  }
  // Objective markers: flag letter + distance projected with the game camera, clamped to an ellipse when off-screen
  updateObjs(on) {
    const g = this.g; setC(E('objs'), 'hidden', !on); if (!on) return;
    const cam = g.camera, p = g.player, cx = innerWidth / 2, cy = innerHeight / 2, rx = cx - 100 * this.hs, ry = cy - 175 * this.hs, ads = g.ads > 0.5;
    const rxR = this.tutOn ? Math.max(120, cx - 335 * this.hs) : rx; // keep clear of the first-steps checklist
    cam.updateWorldMatrix(true, false); _m.copy(cam.matrixWorld).invert();
    for (let i = 0; i < g.flags.length; i++) {
      const f = g.flags[i], o = this.objEls[i]; if (!o) continue;
      const dist = Math.hypot(f.x - p.pos.x, f.z - p.pos.z);
      _v.set(f.x, (f.y ?? 1) + 6, f.z).applyMatrix4(_m);
      const behind = _v.z > -0.2; let dx, dy;
      if (behind) { const l = Math.hypot(_v.x, _v.y); if (l < 1e-4) { dx = 0; dy = 1e5; } else { dx = _v.x / l * 1e5; dy = -_v.y / l * 1e5; } }
      else { _v.applyMatrix4(cam.projectionMatrix); dx = _v.x * cx; dy = -_v.y * cy; }
      const k = Math.hypot(dx / (dx > 0 ? rxR : rx), dy / ry), off = behind || k > 1;
      if (off) { dx /= k; dy /= k; }
      const dc = Math.hypot(dx, dy);
      let op = dist < 7.5 ? 0 : off ? 0.9 : dc < 60 ? 0.22 : dc < 150 ? 0.22 + (dc - 60) / 90 * 0.73 : 0.95; if (ads && !off) op *= 0.6;
      const x = Math.round(cx + dx), y = Math.round(cy + dy), oq = Math.round(op * 20), di = Math.round(dist), ow = owner(f);
      if (o.x !== x || o.y !== y) { o.x = x; o.y = y; o.el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; }
      if (o.oq !== oq) { o.oq = oq; o.el.style.opacity = oq / 20; }
      if (o.di !== di) { o.di = di; o.s.textContent = di + ' m'; }
      setC(o.el, 'off', off); setC(o.el, 'us', ow === 0); setC(o.el, 'them', ow === 1); setC(o.el, 'contest', f.contested);
      if (off) { const a = Math.round(Math.atan2(dx, -dy) * 20) / 20; if (o.a !== a) { o.a = a; o.u.style.transform = 'rotate(' + a + 'rad)'; } }
    }
  }
  drawMinimap() {
    const g = this.g, p = g.player; const cv = E('mm'); const ctx = this.mctx || (this.mctx = cv.getContext('2d'));
    const W = cv.width, R = 34; // metres radius shown
    const S = W / (R * 2);
    ctx.save(); ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.rect(0, 0, W, W); ctx.clip();
    ctx.translate(W / 2, W / 2); ctx.rotate(p.yaw); ctx.scale(S, S); ctx.translate(-p.pos.x, -p.pos.z);
    ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.85; ctx.drawImage(this.mapC, 0, 0, SX * VS, SZ * VS); ctx.globalAlpha = 1;
    for (const f of g.flags) {
      const o = owner(f); ctx.strokeStyle = o === 0 ? CYAN : o === 1 ? ORANGE : '#ccd'; ctx.lineWidth = 0.4;
      ctx.beginPath(); ctx.arc(f.x, f.z, 7.5, 0, TAU); ctx.stroke();
      ctx.save(); ctx.translate(f.x, f.z); ctx.rotate(-p.yaw); ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 5px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(f.id, 0, 2); ctx.restore();
    }
    for (const e of g.entities) {
      if (!e.alive || e.isPlayer) continue;
      if (e.team === 1 && !(e.spottedT > 0)) continue;
      ctx.fillStyle = e.isEcho ? '#b0ffff' : e.team === 0 ? CYAN : '#ff5a3a';
      ctx.beginPath(); ctx.arc(e.pos.x, e.pos.z, 0.9, 0, TAU); ctx.fill();
    }
    for (const gr of g.grenades) { ctx.fillStyle = '#ffd25a'; ctx.fillRect(gr.p.x - 0.5, gr.p.z - 0.5, 1, 1); }
    ctx.restore();
    // player arrow + north marker on the rim
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(W / 2, W / 2 - 8); ctx.lineTo(W / 2 - 6, W / 2 + 6); ctx.lineTo(W / 2, W / 2 + 3); ctx.lineTo(W / 2 + 6, W / 2 + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    const nx = Math.sin(p.yaw), ny = -Math.cos(p.yaw), nk = (W / 2 - 9) / Math.max(Math.abs(nx), Math.abs(ny));
    ctx.fillStyle = 'rgba(5,8,14,.8)'; ctx.beginPath(); ctx.arc(W / 2 + nx * nk, W / 2 + ny * nk, 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', W / 2 + nx * nk, W / 2 + ny * nk + 1); ctx.textBaseline = 'alphabetic';
  }
  drawScore() {
    const g = this.g;
    const rows = (team) => {
      const list = g.entities.filter(e => !e.isEcho && e.team === team).map(e => ({ n: e.name, k: e.kills || 0, d: e.deaths || 0, me: e.isPlayer, s: e.isPlayer ? e.score : (e.score ?? (e.kills || 0) * 100) }));
      list.sort((a, b) => b.s - a.s);
      return `<tr><th>${team === 0 ? 'KAPPA' : 'ÔMEGA'}<em>${g.tickets[team]} TICKETS</em></th><th>ABATES</th><th>MORTES</th><th>PONTOS</th></tr>`
        + list.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td><i>${i + 1}</i>${esc(r.n)}${r.me && r.n !== 'VOCÊ' ? '<u>VOCÊ</u>' : ''}</td><td>${r.k}</td><td>${r.d}</td><td>${r.s}</td></tr>`).join('');
    };
    setH(E('sc0'), rows(0)); setH(E('sc1'), rows(1));
  }
}
