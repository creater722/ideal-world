import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

mkdirSync('dist', { recursive: true });

// 农场、羊群这些模块是从草原沿用的，它们 import 的是 grasscore；
// 打包雪原时把 grasscore 解析到 snowcore，两套地形就各用各的
const snowCorePlugin = {
  name: 'snowcore-swap',
  setup(build) {
    build.onResolve({ filter: /grasscore\.js$/ }, () => ({ path: resolve('src/snowcore.js') }));
  },
};

// 一个页面 = 源码 + 模板；草原和雪原共用这套打包流程
async function buildPage({ entry, template, out, cn, plugins }) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    legalComments: 'none',
    plugins: plugins || [],
  });
  const js = result.outputFiles[0].text;
  const html = readFileSync(template, 'utf8').replace('/*__BUNDLE__*/', () => js);
  writeFileSync(resolve(`dist/${out}`), html);
  writeFileSync(resolve(cn), html);
  return html.length;
}

const grassKB = (await buildPage({
  entry: 'src/grassland.js',
  template: 'src/grassland.html',
  out: 'grassland.html',
  cn: '草原.html',
})) / 1024;

const snowKB = (await buildPage({
  entry: 'src/snowland.js',
  template: 'src/snow.html',
  out: 'snow.html',
  cn: '雪原.html',
  plugins: [snowCorePlugin],
})) / 1024;

const login = readFileSync('src/login.html', 'utf8');
writeFileSync(resolve('dist/login.html'), login);
writeFileSync(resolve('登录.html'), login);

console.log(
  `built -> 草原.html (${grassKB.toFixed(0)} KB), 雪原.html (${snowKB.toFixed(0)} KB), 登录.html (${(login.length / 1024).toFixed(0)} KB)`
);
