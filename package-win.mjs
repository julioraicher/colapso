// Builds the Windows release: bundles game, wraps in Electron (win32-x64), zips.
import { execSync } from 'child_process';
import fs from 'fs';
import { packager } from '@electron/packager';
execSync('node build.mjs --min', { stdio: 'inherit' });
fs.rmSync('electron/game', { recursive: true, force: true }); fs.mkdirSync('electron/game', { recursive: true });
for (const f of ['index.html', 'game.js']) fs.copyFileSync('dist/' + f, 'electron/game/' + f);
const electronVersion = JSON.parse(fs.readFileSync('node_modules/electron/package.json')).version;
const [appPath] = await packager({ dir: 'electron', out: 'out', platform: 'win32', arch: 'x64', overwrite: true, electronVersion, executableName: 'Colapso', name: 'Colapso', asar: true, prune: false });
console.log('packaged', appPath);
// trim unused locales to shrink download
const loc = appPath + '/locales'; for (const f of fs.readdirSync(loc)) if (!/^(pt-BR|en-US)\.pak$/.test(f)) fs.rmSync(loc + '/' + f);
fs.writeFileSync(appPath + '/LEIA-ME.txt', 'COLAPSO\r\n\r\nDe dois cliques em Colapso.exe para jogar.\r\nSe o Windows mostrar "O Windows protegeu o computador", clique em "Mais informacoes" > "Executar assim mesmo" (o jogo nao e assinado digitalmente).\r\n\r\nControles: WASD mover, SHIFT correr, ESPACO pular, CTRL agachar/deslizar, mouse atirar/mirar, R recarregar, G granada, Q tunelamento, E superposicao, TAB placar, ESC pausa, F mostra FPS, F11 tela cheia.\r\n');
fs.rmSync('out/Colapso-windows.zip', { force: true });
execSync(`cd out && zip -qr -9 Colapso-windows.zip ${appPath.split('/').pop()}`);
// also a browser build (single folder, opens offline via index.html)
fs.rmSync('out/Colapso-navegador.zip', { force: true });
execSync('cd dist && zip -q -9 ../out/Colapso-navegador.zip index.html game.js');
for (const f of ['Colapso-windows.zip', 'Colapso-navegador.zip']) console.log(f, (fs.statSync('out/' + f).size / 1e6).toFixed(1) + ' MB');
