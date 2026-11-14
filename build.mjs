import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const result = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});

const js = result.outputFiles[0].text;
const template = readFileSync('src/index.html', 'utf8');
const html = template.replace('/*__BUNDLE__*/', () => js);

mkdirSync('dist', { recursive: true });
writeFileSync(resolve('dist/index.html'), html);
writeFileSync(resolve('理想的世界.html'), html);

console.log(`built -> 理想的世界.html (${(html.length / 1024).toFixed(0)} KB)`);
