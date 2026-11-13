// UI kit shared by the HUD and the menus: inline SVG icon set, keycaps, the drawn keyboard + mouse
// diagram, the compact controls cheat-sheet, ranks. Everything is original line art (no external assets).

export const RANKS = [['RECRUTA', 0], ['SOLDADO', 1500], ['CABO', 4000], ['SARGENTO', 8000], ['SUBTENENTE', 14000], ['TENENTE', 22000], ['CAPITÃO', 34000], ['MAJOR', 50000], ['CORONEL', 72000], ['GENERAL QUÂNTICO', 100000]];
export function rankOf(xp) { let i = 0; while (i + 1 < RANKS.length && xp >= RANKS[i + 1][1]) i++; return { name: RANKS[i][0], i, base: RANKS[i][1], next: RANKS[i + 1] ? RANKS[i + 1][1] : null }; }

const svg = (body, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const F = 'fill="currentColor" stroke="none"';

export const IC = {
  play: svg(`<path d="M7.5 4.5v15l12-7.5z" ${F}/>`),
  help: svg(`<circle cx="12" cy="12" r="9"/><path d="M9.2 9.4a2.9 2.9 0 1 1 4.3 2.5c-.9.5-1.5 1.1-1.5 2.3"/><circle cx="12" cy="17.3" r=".9" ${F}/>`),
  gear: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2.6l1.3 2.7 2.9-.9.4 3 3 .4-.9 2.9 2.7 1.3-2.7 1.3.9 2.9-3 .4-.4 3-2.9-.9L12 21.4l-1.3-2.7-2.9.9-.4-3-3-.4.9-2.9L2.6 12l2.7-1.3-.9-2.9 3-.4.4-3 2.9.9z"/>`),
  power: svg(`<path d="M12 3v8.5"/><path d="M6.4 6.6a8 8 0 1 0 11.2 0"/>`),
  target: svg(`<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.2" ${F}/>`),
  back: svg(`<path d="M14.5 5l-7 7 7 7"/>`),
  chev: svg(`<path d="M9.5 5l7 7-7 7"/>`),
  check: svg(`<path d="M4.5 12.5l5 5 10-11"/>`),
  x: svg(`<path d="M6 6l12 12M18 6L6 18"/>`),
  skull: svg(`<path d="M5 11a7 7 0 1 1 14 0c0 2.4-1 3.9-2.3 4.9V19H7.3v-3.1C6 14.9 5 13.4 5 11z"/><circle cx="9.3" cy="11.4" r="1.7" ${F}/><circle cx="14.7" cy="11.4" r="1.7" ${F}/><path d="M10.6 19v-2.2M13.4 19v-2.2"/>`),
  head: svg(`<circle cx="12" cy="12" r="5.2"/><path d="M12 2.5v4.5M12 17v4.5M2.5 12H7M17 12h4.5"/><circle cx="12" cy="12" r="1.5" ${F}/>`),
  grenade: svg(`<rect x="6.8" y="9" width="10.4" height="11.5" rx="4.4"/><path d="M10 9V6h4v3M14 6.6h3.4l1.2 3.4"/><path d="M6.8 14.5h10.4"/>`),
  syringe: svg(`<path d="M17 3.5l3.5 3.5M18.8 5.2l-2.4 2.4M13.5 5.5l5 5M15 7L6.6 15.4l-.6 2.6 2.6-.6L17 9"/><path d="M6 18l-2.5 2.5M10.2 11.8l1.6 1.6"/>`),
  rocket: svg(`<path d="M3.5 16l9.5-9.5 3.5 3.5L7 19.5z"/><path d="M13 6.5L17 3l4 4-3.5 4"/><path d="M4.5 19.5L3 21M8.5 13l2.5 2.5"/>`),
  crate: svg(`<rect x="3.5" y="7.5" width="17" height="12" rx="1"/><path d="M3.5 11.5h17M12 14v3M10.5 15.5h3"/><path d="M8 7.5l1-3h6l1 3"/>`),
  sensor: svg(`<circle cx="12" cy="14.5" r="2"/><path d="M12 16.5V21M8.4 11a5 5 0 0 1 7.2 0M5.8 8.4a8.7 8.7 0 0 1 12.4 0"/>`),
  health: svg(`<path d="M9.4 4h5.2v5.4H20v5.2h-5.4V20H9.4v-5.4H4V9.4h5.4z" ${F}/>`),
  atom: svg(`<circle cx="12" cy="12" r="1.7" ${F}/><ellipse cx="12" cy="12" rx="9.6" ry="3.7"/><ellipse cx="12" cy="12" rx="9.6" ry="3.7" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.6" ry="3.7" transform="rotate(120 12 12)"/>`),
  flag: svg(`<path d="M5.5 21V3.5M5.5 4.5h12l-2.6 3.8 2.6 3.8h-12"/>`),
  map: svg(`<path d="M3.5 6.5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2zM9 4.5v13M15 6.5v13"/>`),
  star: svg(`<path d="M12 3.2l2.7 5.5 6 .9-4.4 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.4-4.2 6-.9z"/>`),
  medal: svg(`<circle cx="12" cy="14.5" r="5.5"/><path d="M8.5 9.5L6 3h4l2 4 2-4h4l-2.5 6.5"/><path d="M12 12.3l.8 1.6 1.7.2-1.3 1.2.3 1.7-1.5-.8-1.5.8.3-1.7-1.3-1.2 1.7-.2z" ${F}/>`),
  clock: svg(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>`),
  eye: svg(`<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.7"/>`),
  warn: svg(`<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v5"/><circle cx="12" cy="17.4" r=".8" ${F}/>`),
  radio: svg(`<path d="M4.5 9.5h15v10.5h-15zM8 9.5l8.5-5"/><circle cx="9.3" cy="14.7" r="2.2"/><path d="M14.5 13.2h2.5M14.5 16.2h2.5"/>`),
  vol: svg(`<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4.3 4.3 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>`),
  screen: svg(`<rect x="3" y="4.5" width="18" height="12" rx="1"/><path d="M8.5 20h7M12 16.5V20"/>`),
  ui: svg(`<rect x="3" y="4.5" width="18" height="15" rx="1"/><path d="M3 8.5h18M6.5 12.5h5M6.5 15.5h8"/>`),
  mousei: svg(`<rect x="6.5" y="2.5" width="11" height="19" rx="5.5"/><path d="M12 6v4"/>`),
  users: svg(`<circle cx="8.5" cy="8" r="3"/><path d="M2.8 19.5v-2a5.7 5.7 0 0 1 11.4 0v2"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 13.2a4.6 4.6 0 0 1 4.7 4.6v1.7"/>`),
  bolt: svg(`<path d="M13.5 2.5L5 13.5h6l-1.5 8 9-11.5h-6z" ${F}/>`),
  wall: svg(`<path d="M3 5h18v14H3zM3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>`),
  tunnel: svg(`<path d="M10 3.5v17M14 3.5v17" opacity=".7"/><path d="M2.5 12H8M10.6 12h2.8M16 12h5M18 8.8l3.2 3.2-3.2 3.2"/>`),
  echo: svg(`<circle cx="8.3" cy="7" r="2.6"/><path d="M3.6 20.5v-5a4.7 4.7 0 0 1 9.4 0v5"/><g opacity=".6" stroke-dasharray="2.2 2"><circle cx="16.6" cy="7" r="2.6"/><path d="M15.5 11.3a4.7 4.7 0 0 1 5.4 4.2v5"/></g>`),
  gun: svg(`<path d="M2.5 8.5h16l1-1.5h2v3.5h-1.5V12h-7l-1 2.5h-3l-.8 5H5l1-5.5-2-1.5-1.5.5z"/>`),
  boom: svg(`<path d="M12 2.5l2 5 4.5-2.5-1.5 5 5 1.5-4.5 2.5 2.5 4.5-5-1-1 5-2.5-4.5L7.5 21l.5-5-5 .5 3.5-4-4-3 5-.5-1-5 4 3z"/>`),
  swap: svg(`<path d="M4 8h13M13.5 4.5L17 8l-3.5 3.5M20 16H7M10.5 12.5L7 16l3.5 3.5"/>`),
  // class emblems
  cls_assalto: svg(`<path d="M12 3l7.5 2.8v5.4c0 4.6-3.1 8-7.5 9.8-4.4-1.8-7.5-5.2-7.5-9.8V5.8z"/><path d="M12 8v7.4M8.3 11.7h7.4"/>`),
  cls_engenheiro: svg(`<path d="M20 7.4a4.7 4.7 0 0 1-6.3 4.4L7 18.5a1.9 1.9 0 0 1-2.7-2.7L11 9.1a4.7 4.7 0 0 1 4.4-6.3l-2.7 2.7.7 2.7 2.7.7z"/>`),
  cls_suporte: svg(`<path d="M5.5 20V10c0-2 .9-4.2 2-5.8 1.1 1.6 2 3.800 2 5.8v10zM14.500 20V10c0-2 .9-4.2 2-5.800 1.100 1.600 2 3.800 2 5.800v10z"/><path d="M5.500 16.200h4M14.500 16.200h4"/>`),
  cls_recon: svg(`<circle cx="12" cy="12" r="8.500"/><path d="M12 2v5.200M12 16.800V22M2 12h5.200M16.800 12H22"/><circle cx="12" cy="12" r="1.200" ${F}/>`),
};
export const clsIcon = (k, fallback = '') => IC['cls_' + k] || `<span class="ic txt">${fallback}</span>`;
export const GADGET_IC = { assalto: 'syringe', engenheiro: 'rocket', suporte: 'crate', recon: 'sensor' };

// mouse glyph with one part lit: 'l' | 'r' | 'w'
export function mouseSvg(part) {
  const lit = part === 'l' ? `<path d="M11.2 3.200A5.800 5.800 0 0 0 6.200 9v1.200h5z" ${F}/>` : part === 'r' ? `<path d="M12.800 3.200A5.800 5.800 0 0 1 17.800 9v1.200h-5z" ${F}/>` : `<rect x="10.600" y="4.600" width="2.800" height="5.600" rx="1.400" ${F}/>`;
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.600" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6.200" y="2.500" width="11.600" height="19" rx="5.800"/>${part === 'w' ? '' : '<path d="M12 2.500v7.700M6.200 10.200h11.600"/>'}${lit}</svg>`;
}
// Keycap. kc('Q'), kc('SHIFT'), kc('M1') = left mouse, kc('M2') = right mouse, kc('MW') = wheel
export function kc(k, cls = '') {
  if (k === 'M1' || k === 'M2' || k === 'MW') return `<kbd class="kc ms ${cls}">${mouseSvg(k === 'M1' ? 'l' : k === 'M2' ? 'r' : 'w')}</kbd>`;
  return `<kbd class="kc ${k.length > 1 ? 'w' : ''} ${cls}">${k}</kbd>`;
}
// "[E] PARA COLAPSAR" -> keycap markup (used by toasts coming from gameplay code)
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function keycapify(text) { return esc(text).replace(/\[([A-Z0-9ÇÃ]{1,6})\]/g, (m, k) => kc(k)); }
export { esc };

// Which optional (other-stream) bindings exist in this build. Evaluated lazily every time a diagram opens.
export function optionalKeys(g) {
  return {
    inspect: typeof g?.vm?.inspect === 'function',
    melee: typeof g?.vm?.melee === 'function' || typeof g?.melee === 'function',
    fireMode: g?.fireMode !== undefined || typeof g?.cycleFireMode === 'function' || typeof g?.toggleFireMode === 'function',
    streaks: Array.isArray(g?.streaks),
  };
}

// ---- drawn keyboard: [code, cap, width] ; action map gives label + category ----
const ROWS = [
  [['Escape', 'ESC', 1.25], [null, '', 0.75], ['F1', 'F1'], ['', 'F2'], ['', 'F3'], ['', 'F4'], [null, '', 0.5], ['', 'F5'], ['', 'F6'], ['', 'F7'], ['', 'F8'], [null, '', 4.1]],
  [['', "'"], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'], ['', '7'], ['', '8'], ['', '9'], ['', '0'], ['', '-'], ['', '='], ['', '⌫', 1.6]],
  [['Tab', 'TAB', 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['', 'Y'], ['', 'U'], ['', 'I'], ['', 'O'], ['KeyP', 'P'], ['', '´'], ['', '['], ['', '↵', 1.1]],
  [['', 'CAPS', 1.8], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'], ['', 'J'], ['', 'K'], ['', 'L'], ['', 'Ç'], ['', '~'], ['', ']', 1.8]],
  [['ShiftLeft', 'SHIFT', 2.3], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['', 'N'], ['KeyM', 'M'], ['', ','], ['', '.'], ['', ';'], ['', 'SHIFT', 2.3]],
  [['ControlLeft', 'CTRL', 1.6], ['', '', 1.2], ['', 'ALT', 1.2], ['Space', 'ESPAÇO', 6.4], ['', 'ALT', 1.2], ['', '', 1.2], ['', 'CTRL', 1.8]],
];
function keyActions(g) {
  const o = optionalKeys(g);
  const A = {
    Escape: ['PAUSA', 'ui'], F1: ['AJUDA', 'ui'], Tab: ['PLACAR', 'ui'],
    Digit1: ['PRIMÁRIA', 'cb'], Digit2: ['SECUND.', 'cb'], Digit3: ['GADGET', 'cb'],
    KeyQ: ['TÚNEL', 'qt'], KeyW: ['FRENTE', 'mv'], KeyE: ['ECO', 'qt'], KeyR: ['RECARGA', 'cb'], KeyT: ['MARCAR', 'ui'], KeyP: ['FPS', 'ui'],
    KeyA: ['ESQ.', 'mv'], KeyS: ['TRÁS', 'mv'], KeyD: ['DIR.', 'mv'], KeyF: ['GADGET', 'cb'], KeyG: ['GRANADA', 'cb'], KeyH: ['AJUDA', 'ui'],
    ShiftLeft: ['CORRER', 'mv'], KeyZ: ['MARCAR', 'ui'], KeyC: ['AGACHAR', 'mv'], KeyM: ['MAPA', 'ui'],
    ControlLeft: ['AGACHAR', 'mv'], Space: ['PULAR', 'mv'],
  };
  if (o.fireMode) A.KeyX = ['MODO', 'cb'];
  if (o.melee) A.KeyV = ['FACA', 'cb'];
  if (o.inspect) A.KeyB = ['INSPEÇÃO', 'cb'];
  if (o.streaks) { A.Digit4 = ['UAV', 'cb']; A.Digit5 = ['ARTILH.', 'cb']; A.Digit6 = ['CÁPSULA', 'cb']; }
  return A;
}
export function keyboardHTML(g) {
  const A = keyActions(g);
  let h = '<div class="kbd"><div class="kbk">';
  ROWS.forEach((row, ri) => {
    h += `<div class="kr${ri === 0 ? ' fn' : ''}">`;
    for (const [code, cap, w = 1] of row) {
      if (code === null) { h += `<i class="kgap" style="flex:${w}"></i>`; continue; }
      const a = code && A[code];
      h += `<div class="kk${a ? ' on ' + a[1] : ''}" style="flex:${w}"><b>${cap}</b>${a ? `<span>${a[0]}</span>` : ''}</div>`;
    }
    h += '</div>';
  });
  h += '</div><div class="kms"><svg viewBox="0 0 120 190" class="msvg" aria-hidden="true">'
    + '<path class="mb l" d="M58 6C30 6 12 26 12 54v22h46z"/><path class="mb r" d="M62 6c28 0 46 20 46 48v22H62z"/>'
    + '<path class="mbody" d="M12 80h96v44c0 34-20 60-48 60s-48-26-48-60z"/>'
    + '<rect class="mw" x="52" y="24" width="16" height="36" rx="8"/>'
    + '</svg>'
    + '<div class="mlab l"><b>BOTÃO ESQUERDO</b><span>ATIRAR</span></div>'
    + '<div class="mlab r"><b>BOTÃO DIREITO</b><span>MIRAR</span></div>'
    + '<div class="mlab w"><b>RODA</b><span>TROCAR ARMA</span></div>'
    + '<div class="mlab m"><b>MOVER O MOUSE</b><span>OLHAR</span></div>'
    + '</div></div>'
    + '<div class="klegend"><span class="mv"><i></i>MOVIMENTO</span><span class="cb"><i></i>COMBATE</span><span class="qt"><i></i>HABILIDADES QUÂNTICAS</span><span class="ui"><i></i>EQUIPE E INTERFACE</span>'
    + `<em>${kc('SHIFT')} + ${kc('W')} depois ${kc('CTRL')} = DESLIZAR &nbsp;·&nbsp; ${kc('SHIFT')} na luneta = SEGURAR O FÔLEGO</em></div>`;
  return h;
}
// Compact grouped list with keycaps (pause menu, how-to)
export function cheatHTML(g) {
  const o = optionalKeys(g);
  const row = (keys, text) => `<div class="chr"><span class="chk">${keys}</span><span>${text}</span></div>`;
  const grp = (cls, title, rows) => `<div class="chg ${cls}"><h4>${title}</h4>${rows.join('')}</div>`;
  return grp('mv', 'MOVIMENTO', [
    row(kc('W') + kc('A') + kc('S') + kc('D'), 'Mover'),
    row(kc('SHIFT'), 'Correr'),
    row(kc('CTRL') + '<u>ou</u>' + kc('C'), 'Agachar · correndo: deslizar'),
    row(kc('ESPAÇO'), 'Pular · contra um obstáculo: escalar'),
  ]) + grp('cb', 'COMBATE', [
    row(kc('M1'), 'Atirar'),
    row(kc('M2'), 'Mirar · com luneta ' + kc('SHIFT') + ' segura o fôlego'),
    row(kc('R'), 'Recarregar'),
    row(kc('1') + kc('2') + '<u>ou</u>' + kc('MW'), 'Trocar de arma'),
    row(kc('G'), 'Granada (derruba paredes)'),
    row(kc('F') + '<u>ou</u>' + kc('3'), 'Equipamento da classe'),
    ...(o.fireMode ? [row(kc('X'), 'Modo de tiro (auto · rajada · semi)')] : []),
    ...(o.melee ? [row(kc('V'), 'Ataque corpo a corpo')] : []),
    ...(o.inspect ? [row(kc('B'), 'Inspecionar a arma')] : []),
    ...(o.streaks ? [row(kc('4') + kc('5') + kc('6'), 'Reforços: UAV · artilharia · cápsula')] : []),
  ]) + grp('qt', 'HABILIDADES QUÂNTICAS', [
    row(kc('Q'), 'Tunelamento: atravessa a parede à frente'),
    row(kc('E'), 'Superposição: cria um eco'),
    row(kc('E') + '<u>de novo</u>', 'Colapsar: teleporta até o eco'),
  ]) + grp('ui', 'EQUIPE E INTERFACE', [
    row(kc('Z') + '<u>ou</u>' + kc('T'), 'Marcar inimigo na mira'),
    row(kc('TAB'), 'Placar (segure)'),
    row(kc('M'), 'Mapa grande'),
    row(kc('H') + '<u>ou</u>' + kc('F1'), 'Todos os controles'),
    row(kc('ESC'), 'Pausa'),
    row(kc('P'), 'Contador de FPS'),
  ]);
}
