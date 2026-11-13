import * as esbuild from 'esbuild';
import fs from 'fs';
fs.mkdirSync('dist', { recursive: true });
await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, minify: process.argv.includes('--min'), format: 'iife', target: 'es2020', outfile: 'dist/game.js', sourcemap: false, logLevel: 'warning' });
fs.copyFileSync('index.html', 'dist/index.html');
console.log('built', (fs.statSync('dist/game.js').size / 1024).toFixed(0) + ' KB');
