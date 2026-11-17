import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const result = await esbuild.build({
  entryPoints: ['src/grassland.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});

const js = result.outputFiles[0].text;
const template = readFileSync('src/grassland.html', 'utf8');
const html = template.replace('/*__BUNDLE__*/', () => js);

mkdirSync('dist', { recursive: true });
writeFileSync(resolve('dist/grassland.html'), html);
writeFileSync(resolve('草原.html'), html);

const login = readFileSync('src/login.html', 'utf8');
writeFileSync(resolve('dist/login.html'), login);
writeFileSync(resolve('登录.html'), login);

console.log(`built -> 草原.html (${(html.length / 1024).toFixed(0)} KB), 登录.html (${(login.length / 1024).toFixed(0)} KB)`);
