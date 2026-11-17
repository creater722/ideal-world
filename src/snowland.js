/* =========================================================
   snowland.js — 雪原（冰湖）
   第三个世界：雪丘、结冰的湖、松林、雪里的农场；
   夜里天上挂着极光，白天下着细雪。和草原共用同一套光影骨架。
   ========================================================= */

import * as THREE from 'three';
import {
  TAU, clamp, lerp, smoothstep, valueNoise, fbm, mulberry32,
  heightAt, terrainHeightAt, pathDistance, insideFarmWork, meadowBoost, grazeFactor, farmMowFactor,
  flowerSeaFactor, iceDist, pineDensity,
  FARM, WORLD, PATH_POINTS, INNER_PATH_POINTS, MEADOWS, FLOWER_SEA, ICE, LAKE_PATH,
} from './snowcore.js';
import { createPostFX } from './postfx.js';
import { createMusic } from './music.js';
import { createTimeOfDay, phaseName, formatClock } from './snowtime.js';
import { createSnowPlaces } from './snowplaces.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------------------------------------------------------
   从出生点通往冰湖的一条踩雪小径：草在这条带子里让位给雪
   --------------------------------------------------------- */
const FLOWER_ROAD = LAKE_PATH;

function flowerRoadFactor() {
  return 0;
}

/* 花海的颜色分区：沿路方向推过去的一条条色带，带子本身还会轻微摆动 */
function seaZone(x, z) {
  const wob = fbm(x * 0.0065 + 71.7, z * 0.0065 - 23.4, 2) * 3.4;
  return 0.5 + 0.5 * Math.sin(z * 0.085 + wob);
}

/* 圆圈花海 + 走廊花海，取更满的那个 */
function seaAt(x, z) {
  const a = flowerSeaFactor(x, z);
  const b = flowerRoadFactor(x, z);
  return b > a ? b : a;
}

/* =========================================================
   0. 基本设置
   ========================================================= */

const canvas = document.getElementById('scene');
window.__err = [];
window.addEventListener('error', (e) => {
  window.__err.push(String(e.message));
  document.title = 'ERR:' + e.message + ' @ ' + String(e.error && e.error.stack || '').slice(0, 260);
});
window.addEventListener('unhandledrejection', (e) => {
  window.__err.push('REJ:' + String(e.reason));
  document.title = 'REJ:' + String(e.reason);
});

// 着色器编译失败只会 console.error，不会抛异常，这里顺手记下来
const __consoleError = console.error.bind(console);
console.error = (...args) => {
  try {
    window.__err.push(args.map((a) => String(a)).join(' ').slice(0, 300));
  } catch (err) { /* 忽略 */ }
  __consoleError(...args);
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const FOG_COLOR = 0xdde8f2;
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0032);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3400);
camera.rotation.order = 'YXZ';

const SUN_DIR = new THREE.Vector3(0.38, 0.54, 0.75).normalize();
const MOON_DIR = new THREE.Vector3(-0.3, 0.7, -0.6).normalize();
const time = createTimeOfDay(16.4);
const timeState = time.state;
SUN_DIR.copy(timeState.sunDir);
MOON_DIR.copy(timeState.moonDir);

const whitePixel = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
whitePixel.needsUpdate = true;
const NO_SHADOW = new URLSearchParams(location.search).has('noshadow');

/* =========================================================
   1. 天空
   ========================================================= */

const skyUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: SUN_DIR.clone() },
  uMoonDir: { value: MOON_DIR.clone() },
  uZenith: { value: new THREE.Color(0x3f80c6) },
  uHorizon: { value: new THREE.Color(0xeaf0da) },
  uHaze: { value: new THREE.Color(0xffedc8) },
  uFog: { value: new THREE.Color(FOG_COLOR) },
  uSunColor: { value: new THREE.Color(0xfff4d8) },
  uCloud: { value: new THREE.Color(0xfffcf4) },
  uNight: { value: 0 },
  uStars: { value: 0 },
  uAurora: { value: 0 },
  uDusk: { value: 0 },
  uCover: { value: 0.56 },
};

const skyFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uFog;
  uniform vec3 uSunColor;
  uniform vec3 uCloud;
  uniform float uNight;
  uniform float uStars;
  uniform float uAurora;
  uniform float uDusk;
  uniform float uCover;
  varying vec3 vDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm2(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + vec2(13.7, 7.1);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    float up = clamp(dir.y, 0.0, 1.0);

    vec3 col = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.60));
    col = mix(col, uHaze, exp(-max(dir.y, 0.0) * 6.5) * 0.26);

    // 积云：底暗顶亮。黄昏时暗面转紫、亮面吃暖光
    if (dir.y > 0.006) {
      // 穹顶投影：分母留得比 0.16 大很多，靠近地平线才不会被拉成放射条纹
      vec2 cp = dir.xz * 3.2 / (dir.y * 0.85 + 0.55);
      vec2 drift = vec2(uTime * 0.0020, uTime * 0.0008);
      float base = fbm2(cp * 0.55 + drift);
      float detail = fbm2(cp * 1.62 + drift * 2.2 + 11.0);
      float c = base * 0.58 + detail * 0.42;

      float thr = 0.660 - uCover * 0.22;
      float cover = smoothstep(thr, thr + 0.15, c);
      cover *= smoothstep(0.006, 0.10, dir.y);

      float lit = smoothstep(thr, thr + 0.25, c);
      vec3 shade = uCloud * mix(0.47, 0.16, uNight) * mix(vec3(1.0), vec3(0.60, 0.52, 0.74), uDusk);
      vec3 litCol = mix(
        uCloud * mix(1.12, 0.30, uNight),
        uSunColor,
        (0.30 + uDusk * 0.55) * (1.0 - uNight * 0.82)
      );
      vec3 cloudCol = mix(shade, litCol, lit);

      float back = pow(max(dot(dir, uSunDir), 0.0), 5.0);
      cloudCol += uSunColor * back * (1.0 - lit) * (0.36 + uDusk * 0.9);
      col = mix(col, cloudCol, cover * mix(0.80, 0.55, uNight));
    }

    // 黄昏：太阳那一侧烧成金橙，另一侧留冷青
    if (uDusk > 0.002) {
      vec3 flatDir = normalize(vec3(dir.x, 0.0001, dir.z));
      vec3 flatSun = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
      float toward = max(dot(flatDir, flatSun), 0.0);
      float lowBand = exp(-max(dir.y, 0.0) * 3.4);
      float warm = pow(toward, 3.4) * lowBand * uDusk;
      col = mix(col, uSunColor * 1.15, warm * 0.46);
      float away = pow(max(-dot(flatDir, flatSun), 0.0), 1.5) * lowBand * uDusk;
      col = mix(col, vec3(0.26, 0.23, 0.38), away * 0.26);
    }

    // 太阳
    float sd = max(dot(dir, uSunDir), 0.0);
    float sunPeak = mix(4.6, 2.0, uDusk);
    col += uSunColor * (pow(sd, 15000.0) * sunPeak + pow(sd, 520.0) * mix(0.18, 0.26, uDusk) + pow(sd, 13.0) * 0.04);

    // 星空与银河（等天真的黑下来才出现，别在日落时抢戏）
    if (uStars > 0.01 && dir.y > 0.0) {
      vec2 sph = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0))) * 230.0;
      vec2 id = floor(sph);
      vec2 f = fract(sph) - 0.5;
      float h = hash(id);
      float twinkle = 0.55 + 0.45 * sin(uTime * 1.4 + h * 63.0);
      float star = smoothstep(0.075, 0.0, length(f)) * step(0.966, h) * twinkle;

      // 第二层更密更暗的小星，让天不是"撒了几十颗"
      vec2 sph2 = sph * 2.17 + 31.0;
      vec2 id2 = floor(sph2);
      float h2 = hash(id2);
      vec2 f2 = fract(sph2) - 0.5;
      float star2 = smoothstep(0.055, 0.0, length(f2)) * step(0.982, h2) * (0.5 + 0.5 * sin(uTime * 0.9 + h2 * 88.0));

      float upMask = smoothstep(0.02, 0.22, dir.y);
      col += vec3(0.82, 0.88, 1.0) * (star * 1.35 + star2 * 0.7) * uStars * upMask;

      // 银河：一条斜穿天球的带子，云絮 + 暗尘 + 更密的星
      vec3 bandN = normalize(vec3(0.46, 0.30, -0.83));
      float dBand = dot(dir, bandN);
      float core = exp(-pow(dBand * 11.0, 2.0));
      float halo = exp(-pow(dBand * 3.4, 2.0));
      // 用银河自己的切向坐标采样：方位角采样会在天顶拧成放射状条纹
      vec3 bandT = normalize(cross(bandN, vec3(0.0, 1.0, 0.0)));
      vec3 bandB = cross(bandN, bandT);
      vec2 bandUv = vec2(dot(dir, bandT) * 5.5, dot(dir, bandB) * 11.0);
      float cloud = fbm2(bandUv * 1.2 + 3.1);
      float dust = fbm2(bandUv * 2.6 - 7.7);
      float lanes = mix(0.42, 1.0, smoothstep(0.34, 0.66, dust))
                  * mix(0.5, 1.0, smoothstep(0.06, 0.26, abs(dBand)));
      float milky = (halo * 0.20 + core * 0.95) * (0.20 + cloud * 1.05) * lanes;
      col += vec3(0.62, 0.66, 0.90) * milky * uStars * smoothstep(0.05, 0.30, dir.y) * 0.46;
      col += vec3(0.80, 0.85, 1.0) * star * uStars * core * upMask * 3.0;
    }

    // 月亮
    if (uStars > 0.01) {
      float md = max(dot(dir, uMoonDir), 0.0);
      col += vec3(1.0, 0.97, 0.89) * (pow(md, 9000.0) * 7.0 + pow(md, 420.0) * 0.24) * uStars;
    }

    // 极光：只在夜里出现，横在偏北的天上，慢慢流动
    if (uAurora > 0.01) {
      vec3 flatDir = normalize(vec3(dir.x, 0.0001, dir.z));
      float north = smoothstep(-0.55, 0.75, flatDir.z);
      float wav = sin(dir.x * 5.2 + uTime * 0.10 + sin(dir.z * 3.1 + uTime * 0.06) * 2.2);
      float band =
        exp(-pow((dir.y - 0.34 - 0.10 * wav) * 5.5, 2.0)) +
        0.55 * exp(-pow((dir.y - 0.55 - 0.08 * wav) * 7.5, 2.0));
      float curtain = 0.55 + 0.45 * sin(dir.x * 17.0 + uTime * 0.18 + dir.z * 5.0);
      vec3 ac = mix(vec3(0.22, 1.05, 0.60), vec3(0.58, 0.42, 1.05), smoothstep(0.12, 0.86, wav));
      col += ac * band * curtain * north * uAurora * smoothstep(-0.02, 0.18, dir.y) * 0.62;
    }

    // 地平线以下接到雾色：地形只画到 800 米，再往外就是这片天。
    // 天的这一截必须和远处地面的雾同色，否则地形的尽头
    // 会横着一条「雾色 vs 霞色」的切割线，看着像整个世界断了一刀
    float below = smoothstep(0.045, -0.006, dir.y);
    col = mix(col, uFog, below);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyMesh = new THREE.Mesh(
  new THREE.SphereGeometry(3300, 48, 28),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: skyVert,
    fragmentShader: skyFrag,
  })
);
skyMesh.frustumCulled = false;
scene.add(skyMesh);

const envSky = new THREE.Mesh(
  new THREE.SphereGeometry(10, 32, 18),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: skyVert,
    fragmentShader: skyFrag,
  })
);
const envScene = new THREE.Scene();
envScene.add(envSky);

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
let envRT = null;
let envPending = false;
let envClock = 0;
let envRefHour = -99;

function rebuildEnv() {
  if (envPending) return;
  envPending = true;
  setTimeout(() => {
    envPending = false;
    const old = envRT;
    envRT = pmrem.fromScene(envScene, 0, 0.1, 60);
    scene.environment = envRT.texture;
    if (old) old.dispose();
  }, 0);
}
rebuildEnv();

/* =========================================================
   2. 灯光
   ========================================================= */

const sunLight = new THREE.DirectionalLight(0xffe8bd, 3.15);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 280;
const SHADOW_SPAN = 38;

/* 把阴影相机的焦点吸附到「光空间的像素格」。
   阴影贴图是按光的方向投影的，所以吸附也必须在这个坐标系里做，
   只吸世界 XZ 是不够的。 */
const _shadowRight = new THREE.Vector3();
const _shadowUp = new THREE.Vector3();
const _shadowDir = new THREE.Vector3();
const _shadowFocus = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function snapShadowFocus(x, y, z, dir, out) {
  const texel = (SHADOW_SPAN * 2) / (sunLight.shadow.mapSize.x || 2048);
  _shadowDir.copy(dir).normalize();
  _shadowRight.crossVectors(WORLD_UP, _shadowDir);
  if (_shadowRight.lengthSq() < 1e-6) _shadowRight.set(1, 0, 0);
  _shadowRight.normalize();
  _shadowUp.crossVectors(_shadowDir, _shadowRight).normalize();

  const a = x * _shadowRight.x + y * _shadowRight.y + z * _shadowRight.z;
  const b = x * _shadowUp.x + y * _shadowUp.y + z * _shadowUp.z;
  const da = Math.round(a / texel) * texel - a;
  const db = Math.round(b / texel) * texel - b;

  out.set(
    x + _shadowRight.x * da + _shadowUp.x * db,
    y + _shadowRight.y * da + _shadowUp.y * db,
    z + _shadowRight.z * da + _shadowUp.z * db
  );
  return out;
}
sunLight.shadow.camera.left = -SHADOW_SPAN;
sunLight.shadow.camera.right = SHADOW_SPAN;
sunLight.shadow.camera.top = SHADOW_SPAN;
sunLight.shadow.camera.bottom = -SHADOW_SPAN;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.03;
sunLight.shadow.radius = 2.2;
sunLight.shadow.camera.updateProjectionMatrix();
scene.add(sunLight);
scene.add(sunLight.target);

const hemiLight = new THREE.HemisphereLight(0xc9e0f6, 0x677440, 1.12);
scene.add(hemiLight);

/* 月光只负责让夜里的羊、牛和农场有轮廓，不投影 */
const moonLight = new THREE.DirectionalLight(0xa8c2ee, 0);
moonLight.position.set(-60, 90, -50);
scene.add(moonLight);
scene.add(moonLight.target);

/* =========================================================
   3. 程序化贴图
   ========================================================= */

function makeGroundTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  // 雪面：底色是冷白，斑块是背光处的淡蓝，颗粒是雪粒的高光
  ctx.fillStyle = '#e9f0f6';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(20261114);

  for (let i = 0; i < 460; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 18 + rnd() * 88;
    const light = 0.88 + rnd() * 0.26;
    ctx.fillStyle = `rgba(${Math.round(196 * light)},${Math.round(214 * light)},${Math.round(232 * light)},${0.02 + rnd() * 0.05})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, TAU);
    ctx.fill();
  }

  for (let i = 0; i < 36000; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const dry = rnd() < 0.22;
    if (dry) {
      // 风把雪吹出的细纹：比底色暗一点点的蓝灰
      ctx.fillStyle = `rgba(${176 + Math.floor(rnd() * 26)},${196 + Math.floor(rnd() * 24)},${218 + Math.floor(rnd() * 22)},${0.05 + rnd() * 0.09})`;
    } else {
      ctx.fillStyle = `rgba(${236 + Math.floor(rnd() * 19)},${242 + Math.floor(rnd() * 13)},${250 + Math.floor(rnd() * 5)},${0.05 + rnd() * 0.1})`;
    }
    ctx.fillRect(x, y, 0.8 + rnd() * 1.9, 0.8 + rnd() * 2.6);
  }

  for (let i = 0; i < 520; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.7 + rnd() * 1.8;
    const g = 208 + Math.floor(rnd() * 40);
    ctx.fillStyle = `rgba(${g - 14},${g - 4},${g + 6},${0.18 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * Math.PI, 0, TAU);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(64, 64);
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

/* 花瓣层：撒在地上的碎花，给花海和草地补一层近看才有的细节 */
function makeFallenLeafTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.translate(S / 2, S / 2);
  ctx.beginPath();
  ctx.moveTo(0, -S * 0.42);
  ctx.bezierCurveTo(S * 0.33, -S * 0.2, S * 0.31, S * 0.22, 0, S * 0.42);
  ctx.bezierCurveTo(-S * 0.31, S * 0.22, -S * 0.33, -S * 0.2, 0, -S * 0.42);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(198,198,198,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -S * 0.34);
  ctx.lineTo(0, S * 0.36);
  ctx.stroke();
  ctx.lineWidth = 1.4;
  for (let i = -2; i <= 2; i++) {
    const y = i * S * 0.12;
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(sgn * S * 0.09, y + S * 0.03, sgn * S * 0.18, y + S * 0.09);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePetalScatterTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const rnd = mulberry32(9091);
  const petals = [
    [244, 178, 198], [252, 236, 240], [247, 214, 98],
    [226, 112, 88], [186, 204, 240], [255, 250, 232],
  ];

  // 一簇一簇地撒，不要均匀铺满，地面才透气
  for (let cl = 0; cl < 300; cl++) {
    const cx = rnd() * S;
    const cy = rnd() * S;
    const spread = 8 + rnd() * 26;
    const n = 2 + Math.floor(rnd() * 7);
    for (let i = 0; i < n; i++) {
      const x = cx + (rnd() - 0.5) * spread;
      const y = cy + (rnd() - 0.5) * spread;
      const p = petals[Math.floor(rnd() * petals.length)];
      const r = 1.6 + rnd() * 2.8;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rnd() * Math.PI);
      ctx.fillStyle = `rgba(${p[0]},${p[1]},${p[2]},${0.5 + rnd() * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * (0.5 + rnd() * 0.4), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  // 再撒一层枯叶，地面才像"落下来过东西"
  const leaves = [[176, 132, 74], [154, 112, 60], [196, 156, 96], [138, 100, 56]];
  for (let i = 0; i < 150; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const L = leaves[Math.floor(rnd() * leaves.length)];
    const r = 2.4 + rnd() * 3.4;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rnd() * Math.PI);
    ctx.fillStyle = `rgba(${L[0]},${L[1]},${L[2]},${0.45 + rnd() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.46, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

/* 云影贴图：周期性的软噪声，草和地面按它被云遮暗 */
function makeCloudShadowTexture() {
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  const T = Math.PI * 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      // 三组正弦叠加：天然可平铺，没有接缝
      let n = 0.52
        + 0.20 * Math.sin(T * u * 2 + 1.3) * Math.cos(T * (v * 3 + 0.4))
        + 0.13 * Math.sin(T * (u * 5 - 2.1) + 1.7) * Math.cos(T * (v * 4 + 1.1))
        + 0.07 * Math.cos(T * (u * 9 + 0.2)) * Math.sin(T * (v * 7 - 0.9));
      n = Math.min(1, Math.max(0, n));
      const c = Math.round(255 * n);
      const i = (y * S + x) * 4;
      data[i] = c;
      data[i + 1] = c;
      data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function makeGrassTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const rnd = mulberry32(5151);

  for (let i = 0; i < 320; i++) {
    const baseX = S * 0.5 + (rnd() - 0.5) * S * 0.94;
    const baseY = S + 6;
    const h = S * (0.40 + rnd() * 0.58);
    const lean = (rnd() - 0.5) * S * 0.36;
    const tipX = baseX + lean;
    const tipY = baseY - h;
    const ctrlX = baseX + lean * 0.26;
    const ctrlY = baseY - h * 0.66;
    const w = 1.5 + rnd() * 2.8;
    // 雪原的草是冻死的枯草：黄褐到灰白，几乎没有绿
    const hue = 34 + rnd() * 18;
    const sat = 16 + rnd() * 20;
    const lig = 34 + rnd() * 22;

    const grad = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
    const dry = rnd() < 0.18;
    grad.addColorStop(0, `hsla(${hue},${sat}%,${Math.max(8, lig * 0.42)}%,1)`);
    grad.addColorStop(0.55, `hsla(${hue},${sat}%,${lig}%,1)`);
    grad.addColorStop(1, dry
      ? `hsla(${hue - 8},${sat * 0.55}%,${Math.min(82, lig + 36)}%,0.96)`
      : `hsla(${hue + 4},${Math.max(10, sat - 8)}%,${Math.min(78, lig + 30)}%,0.97)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(baseX - w, baseY);
    ctx.quadraticCurveTo(ctrlX - w * 0.5, ctrlY, tipX, tipY);
    ctx.quadraticCurveTo(ctrlX + w * 0.5, ctrlY, baseX + w, baseY);
    ctx.closePath();
    ctx.fill();
  }

  // 草穗
  for (let i = 0; i < 26; i++) {
    const baseX = S * 0.5 + (rnd() - 0.5) * S * 0.84;
    const h = S * (0.64 + rnd() * 0.32);
    const tipX = baseX + (rnd() - 0.5) * 54;
    const tipY = S - h;
    ctx.strokeStyle = `hsla(${38 + rnd() * 14},18%,${54 + rnd() * 18}%,0.9)`;
    ctx.lineWidth = 1 + rnd() * 1.1;
    ctx.beginPath();
    ctx.moveTo(baseX, S);
    ctx.quadraticCurveTo(baseX + (rnd() - 0.5) * 22, S - h * 0.7, tipX, tipY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(202,194,142,0.8)';
    for (let j = 0; j < 6; j++) {
      ctx.beginPath();
      ctx.arc(tipX + (rnd() - 0.5) * 8, tipY + j * 4 + rnd() * 3, 0.8 + rnd() * 0.8, 0, TAU);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function makeFlowerTexture(kind) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  const rnd = mulberry32(900 + kind * 41);

  if (kind === 0) {
    // 白雏菊
    const petals = 15;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + rnd() * 0.1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const grad = ctx.createLinearGradient(0, -10, 0, -94);
      grad.addColorStop(0, 'rgba(255,255,250,1)');
      grad.addColorStop(0.72, 'rgba(252,250,240,0.98)');
      grad.addColorStop(1, 'rgba(246,242,226,0.7)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -55, 8, 40, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 22);
    g.addColorStop(0, 'rgba(247,198,62,1)');
    g.addColorStop(0.7, 'rgba(234,170,42,1)');
    g.addColorStop(1, 'rgba(202,138,28,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, TAU);
    ctx.fill();
  } else if (kind === 1) {
    // 黄色毛茛
    const petals = 5;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const grad = ctx.createRadialGradient(0, -44, 6, 0, -44, 52);
      grad.addColorStop(0, 'rgba(255,228,126,1)');
      grad.addColorStop(0.75, 'rgba(244,198,66,1)');
      grad.addColorStop(1, 'rgba(218,168,38,0.94)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -46, 30, 40, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(190,142,36,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, TAU);
    ctx.fill();
  } else if (kind === 2) {
    // 粉色波斯菊
    const petals = 8;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + rnd() * 0.12;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const grad = ctx.createLinearGradient(0, -14, 0, -96);
      grad.addColorStop(0, 'rgba(252,214,224,1)');
      grad.addColorStop(0.6, 'rgba(244,178,198,1)');
      grad.addColorStop(1, 'rgba(231,154,180,0.92)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -57, 17, 43, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 18);
    g.addColorStop(0, 'rgba(250,214,94,1)');
    g.addColorStop(1, 'rgba(220,172,52,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 17, 0, TAU);
    ctx.fill();
  } else if (kind === 3) {
    // 一小簇碎白花
    for (let i = 0; i < 7; i++) {
      const px = cx + (rnd() - 0.5) * 108;
      const py = cy + (rnd() - 0.5) * 108;
      const r = 13 + rnd() * 8;
      for (let j = 0; j < 5; j++) {
        const a = (j / 5) * TAU + rnd() * 0.3;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(255,253,246,0.96)';
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.62, r * 0.34, r * 0.6, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(238,208,118,0.95)';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.28, 0, TAU);
      ctx.fill();
    }
  } else if (kind === 4) {
    // 淡蓝勿忘我：一小簇蓝色碎花
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rnd() * 0.5;
      const rr = 22 + rnd() * 58;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr * 0.75;
      const r = 11 + rnd() * 7;
      ctx.strokeStyle = 'rgba(78,112,62,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 5);
      ctx.quadraticCurveTo(px * 0.7 + cx * 0.3, py * 0.7 + cy * 0.3, px, py);
      ctx.stroke();
      for (let j = 0; j < 5; j++) {
        const aa = (j / 5) * TAU + rnd() * 0.2;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(aa);
        const g = ctx.createLinearGradient(0, -r, 0, 0);
        g.addColorStop(0, 'rgba(196,216,246,1)');
        g.addColorStop(1, 'rgba(138,172,228,0.95)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.58, r * 0.32, r * 0.62, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(246,226,120,0.95)';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.26, 0, TAU);
      ctx.fill();
    }
  } else {
    // 红罂粟：四片薄红大瓣，中心一圈黑蕊
    const petals = 4;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + 0.25;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const grad = ctx.createRadialGradient(0, -40, 4, 0, -40, 66);
      grad.addColorStop(0, 'rgba(236,104,74,1)');
      grad.addColorStop(0.62, 'rgba(206,64,44,1)');
      grad.addColorStop(1, 'rgba(154,38,30,0.9)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -50, 43, 50, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(38,28,22,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      ctx.fillStyle = 'rgba(218,186,96,0.9)';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * 23, cy + Math.sin(a) * 23, 2.4, 0, TAU);
      ctx.fill();
    }
  }

  // 雪原：把花瓣的颜色抽成近乎无色，只留形状与明暗，
  // 具体颜色由每一朵花的实例色决定（霜蓝、淡紫、冷白）
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = 'hsl(210, 12%, 55%)';
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function makeSeedHeadTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const rnd = mulberry32(7331);

  for (let i = 0; i < 10; i++) {
    const baseX = 36 + rnd() * 440;
    const h = 250 + rnd() * 210;
    const lean = (rnd() - 0.5) * 78;
    const tipX = baseX + lean;
    const tipY = S - h;

    ctx.strokeStyle = `hsla(${66 + rnd() * 24},${24 + rnd() * 16}%,${30 + rnd() * 16}%,0.95)`;
    ctx.lineWidth = 2.4 + rnd() * 2.4;
    ctx.beginPath();
    ctx.moveTo(baseX, S);
    ctx.quadraticCurveTo(baseX + lean * 0.2, S - h * 0.62, tipX, tipY);
    ctx.stroke();

    // 一片细叶
    ctx.fillStyle = `hsla(${72 + rnd() * 18},${26 + rnd() * 14}%,${28 + rnd() * 12}%,0.85)`;
    ctx.beginPath();
    ctx.ellipse(baseX + lean * 0.16, S - h * 0.35, 4 + rnd() * 4, 26 + rnd() * 26, lean > 0 ? 0.5 : -0.5, 0, TAU);
    ctx.fill();

    // 毛茸茸的穗
    const headLen = 34 + rnd() * 42;
    for (let j = 0; j < 30; j++) {
      const t = j / 29;
      const hy = tipY + t * headLen;
      const spread = 5 + t * 11;
      const side = (rnd() - 0.5) * 2 * spread;
      ctx.strokeStyle = `hsla(${44 + rnd() * 18},${28 + rnd() * 20}%,${50 + rnd() * 18}%,0.9)`;
      ctx.lineWidth = 0.9 + rnd() * 0.8;
      ctx.beginPath();
      ctx.moveTo(tipX + side * 0.16, hy);
      ctx.lineTo(tipX + side, hy - 4 - rnd() * 8);
      ctx.stroke();
    }
    ctx.strokeStyle = 'hsla(46,30%,56%,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX + lean * 0.12, tipY + headLen);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function makeCloverTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const rnd = mulberry32(5521);

  const leaf = (x, y, r, rot) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.4;
      const lx = Math.cos(a) * r * 0.55;
      const ly = Math.sin(a) * r * 0.55;
      const g = ctx.createRadialGradient(lx, ly, 1, lx, ly, r * 0.7);
      g.addColorStop(0, `hsla(${88 + rnd() * 22},${30 + rnd() * 20}%,${40 + rnd() * 14}%,0.96)`);
      g.addColorStop(1, `hsla(${82 + rnd() * 20},${28 + rnd() * 16}%,${26 + rnd() * 10}%,0.9)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(lx, ly, r * 0.42, r * 0.7, a + Math.PI / 2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  };

  for (let i = 0; i < 52; i++) {
    const x = 24 + rnd() * 464;
    const y = 100 + rnd() * 400;
    const r = 15 + rnd() * 24;
    ctx.strokeStyle = 'rgba(74,104,44,0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.quadraticCurveTo(x + (rnd() - 0.5) * 30, y + 30, x, y);
    ctx.stroke();
    leaf(x, y, r, rnd() * TAU);
  }

  // 三叶草的小白花
  for (let i = 0; i < 9; i++) {
    const x = 40 + rnd() * 432;
    const y = 60 + rnd() * 220;
    const r = 6 + rnd() * 5;
    ctx.strokeStyle = 'rgba(90,118,52,0.85)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x, y + 80);
    ctx.quadraticCurveTo(x + 4, y + 40, x, y);
    ctx.stroke();
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * TAU;
      ctx.fillStyle = `rgba(252,248,238,${0.85 + rnd() * 0.15})`;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75, r * 0.42, r * 0.6, a, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(238,208,120,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.28, 0, TAU);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function makeBeeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.translate(32, 32);
  ctx.fillStyle = 'rgba(240,248,246,0.65)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 11, -7, 11, 6, s * -0.5, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#e8bf46';
  ctx.beginPath();
  ctx.ellipse(0, 2, 8, 11, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#3d3324';
  for (const y of [-2, 5]) ctx.fillRect(-7.5, y, 15, 3.2);
  ctx.fillStyle = '#2f2a20';
  ctx.beginPath();
  ctx.arc(0, -9, 5, 0, TAU);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeDandelionTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.translate(32, 38);
  ctx.strokeStyle = 'rgba(255,253,244,0.9)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 17, Math.sin(a) * 17);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,250,0.95)';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 18, Math.sin(a) * 18, 1.6, 0, TAU);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(160,132,90,0.9)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(0, 20);
  ctx.stroke();
  ctx.fillStyle = 'rgba(150,118,76,0.95)';
  ctx.beginPath();
  ctx.ellipse(0, 23, 2.2, 4, 0, 0, TAU);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePollenTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,252,238,1)');
  g.addColorStop(0.3, 'rgba(255,246,214,0.5)');
  g.addColorStop(1, 'rgba(255,244,208,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeButterflyTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.translate(64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.97)';
  for (const dir of [-1, 1]) {
    ctx.save();
    ctx.scale(dir, 1);
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.bezierCurveTo(20, -36, 54, -34, 48, -6);
    ctx.bezierCurveTo(44, 12, 18, 16, 2, 6);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(2, 4);
    ctx.bezierCurveTo(20, 16, 40, 20, 34, 36);
    ctx.bezierCurveTo(28, 48, 8, 36, 2, 12);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(116,98,74,0.9)';
  ctx.fillRect(-2.2, -14, 4.4, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* 土路贴图：中间实、两边透明 */
function makePathTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(6161);
  ctx.fillStyle = '#dfe9f2';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.8 + rnd() * 2.6;
    const dark = rnd() < 0.55;
    ctx.fillStyle = dark
      ? `rgba(176,194,212,${0.12 + rnd() * 0.24})`
      : `rgba(248,252,255,${0.10 + rnd() * 0.22})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 80; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const g = 190 + Math.floor(rnd() * 50);
    ctx.fillStyle = `rgba(${g - 6},${g},${g + 8},0.5)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.2 + rnd() * 2.4, 1 + rnd() * 1.6, rnd() * 3, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const grad = ctx.createLinearGradient(0, 0, S, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.28, 'rgba(0,0,0,1)');
  grad.addColorStop(0.72, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/* =========================================================
   4. 地形
   ========================================================= */

let terrainMesh = null;
{
  const SIZE = WORLD.terrainSize;
  const SEG = 700;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const count = pos.count;
  const heights = new Float32Array(count);
  const XS = new Float32Array(count);
  const ZS = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    heights[i] = h;
    XS[i] = x;
    ZS[i] = z;
    pos.setY(i, h);
  }

  const colorArr = new Float32Array(count * 3);
  const seaArr = new Float32Array(count);
  const col = new THREE.Color();
  const rowLen = SEG + 1;
  const cell = SIZE / SEG;

  const grassA = new THREE.Color(0xe8eff6);
  const grassB = new THREE.Color(0xf6fafd);
  const grassDry = new THREE.Color(0xd6e2ee);
  const trail = new THREE.Color(0xcbd6e2);      // 踩硬的雪道
  const hillTone = new THREE.Color(0xcdd9e6);
  // 地形放大后，颜色要跟着地势分：坡上晒得干、谷底更润，
  // 再叠一层大尺度的枯荣斑块 —— 否则两公里看过去还是同一张绿纸
  const highTone = new THREE.Color(0xf9fcff);   // 山肩被风刮薄，露出最白的雪
  const lushTone = new THREE.Color(0xdde7f0);   // 洼地积厚雪，偏蓝
  const farGrass = new THREE.Color(0xdbe6f0);

  // 花海的底色：一片粉、一片白、一片红，远处先看见的是这些色块
  const seaFloor = new THREE.Color(0xdfe9f2);
  const seaPink = new THREE.Color(0xe6eef6);
  const seaWhite = new THREE.Color(0xf2f7fb);
  const seaRed = new THREE.Color(0xdae5f0);
  const seaBlue = new THREE.Color(0xd3e0ee);
  const seaGold = new THREE.Color(0xe9f1f8);

  for (let i = 0; i < count; i++) {
    const x = XS[i];
    const z = ZS[i];
    const h = heights[i];

    const n1 = fbm(x * 0.030 + 11, z * 0.030 - 4, 3);
    const n2 = fbm(x * 0.0068 - 7, z * 0.0068 + 3, 3);

    col.copy(grassA).lerp(grassB, clamp(n1 * 1.55, 0, 1));
    col.lerp(grassDry, clamp((n2 - 0.47) * 1.6, 0, 1) * 0.62);

    // 土路：地表也染一层，路边不是一刀切
    const pd = pathDistance(x, z);
    if (pd < 2.8) {
      col.lerp(trail, smoothstep(2.8, 0.8, pd) * 0.42);
    }

    // 大尺度枯荣斑块：一片草原上总有晒黄的坡和还绿着的洼
    // （强度压低：地面色和草叶色不能拉开太多，否则近看地面像碎裂的补丁）
    const patch = fbm(x * 0.0021 + 31, z * 0.0021 - 17, 3);
    col.lerp(grassDry, clamp((patch - 0.55) * 1.6, 0, 1) * 0.16);

    // 地势配色：高处干黄、谷底润绿
    const alt = smoothstep(8, 52, h);
    if (alt > 0) col.lerp(highTone, alt * 0.22);
    const lowland = smoothstep(2, -16, h);
    if (lowland > 0) col.lerp(lushTone, lowland * 0.35);

    // 远处的山脊被草和雾压成灰绿
    const r = Math.hypot(x, z);
    const far = smoothstep(WORLD.hillStart, WORLD.hillFull, r);
    if (far > 0) col.lerp(farGrass, far * 0.55);

    // 花海：地面先暗成深绿，再被大片同色的花染上颜色
    const sea = seaAt(x, z);
    seaArr[i] = sea;
    if (sea > 0.002) {
      col.lerp(seaFloor, sea * 0.26);
      const zone = seaZone(x, z);
      const tint =
        zone < 0.40 ? seaPink :
        zone < 0.55 ? seaWhite :
        zone < 0.63 ? seaRed :
        zone < 0.72 ? seaBlue :
        zone < 0.86 ? seaGold : seaWhite;
      col.lerp(tint, sea * 0.44);
    }

    // 坡度
    const ix = i % rowLen;
    const iz = (i / rowLen) | 0;
    const hl = heights[iz * rowLen + Math.max(0, ix - 1)];
    const hr = heights[iz * rowLen + Math.min(rowLen - 1, ix + 1)];
    const hu = heights[Math.max(0, iz - 1) * rowLen + ix];
    const hd = heights[Math.min(rowLen - 1, iz + 1) * rowLen + ix];
    const slope = (Math.abs(hr - hl) + Math.abs(hd - hu)) / (2 * cell);
    const steep = smoothstep(0.55, 1.4, slope);
    if (steep > 0) col.lerp(hillTone, steep * 0.45);

    colorArr[i * 3] = col.r;
    colorArr[i * 3 + 1] = col.g;
    colorArr[i * 3 + 2] = col.b;
  }

  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geo.setAttribute('aSea', new THREE.BufferAttribute(seaArr, 1));

  const petalScatterTex = makePetalScatterTexture();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: makeGroundTexture(),
    roughness: 1.0,
    metalness: 0.0,
  });

  // 地面也要吃云影，否则云飘过去只有草在暗
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCloudMap = sharedUniforms.uCloudMap;
    shader.uniforms.uCloudOffset = sharedUniforms.uCloudOffset;
    shader.uniforms.uCloudAmount = sharedUniforms.uCloudAmount;
    shader.uniforms.uPetalMap = { value: petalScatterTex };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aSea;\nvarying vec3 vCloudPos;\nvarying float vSea;'
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vCloudPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vSea = aSea;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uCloudMap;\nuniform vec2 uCloudOffset;\nuniform float uCloudAmount;\nuniform sampler2D uPetalMap;\nvarying vec3 vCloudPos;\nvarying float vSea;'
      )
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          'if (vSea > 0.01) {',
          '  vec2 fp1 = vCloudPos.xz * 0.28;',
          '  vec2 fp2 = vCloudPos.xz * 0.105 + vec2(0.37, 0.19);',
          '  vec4 p1 = texture2D(uPetalMap, fp1);',
          '  vec4 p2 = texture2D(uPetalMap, fp2);',
          '  float pa = clamp(p1.a + p2.a * 0.72, 0.0, 1.0);',
          '  vec3 pc = (p1.rgb * p1.a + p2.rgb * p2.a * 0.72) / max(1e-3, p1.a + p2.a * 0.72);',
          '  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.70 + pc * 0.86, pa * vSea * 0.9);',
          '}',
        ].join('\n')
      )
      .replace(
        '#include <fog_fragment>',
        [
          'float cloudCS = texture2D(uCloudMap, vCloudPos.xz * 0.0055 + uCloudOffset).r;',
          'float cloudK = mix(1.0, mix(0.54, 1.03, smoothstep(0.28, 0.74, cloudCS)), uCloudAmount);',
          'gl_FragColor.rgb *= cloudK;',
          '#include <fog_fragment>',
        ].join('\n')
      );
  };

  terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.frustumCulled = false;
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
}

/* =========================================================
   4.6 远处的雪山
   ========================================================= */
/* 真正的三维山体：一张高度场，用脊状分形堆出主峰、沟壑和碎岩，
   按每个面的法线打光，雪按「高度 + 坡度」长在山上。
   向阳面亮、背阴面暗、山谷发青、山脊挂雪 —— 这些都不是画上去的。 */
const MTN = {
  x: 0,
  z0: 1330,     // 靠近玩家的这一边：落在地形边缘（z=1300）之后
  w: 6400,      // 山脉东西向铺开 6.4 公里，站在草原上左右都望不到头
  d: 1500,
  segX: 620,
  segZ: 220,
  baseY: -150,  // 山脚埋到地平线以下，接缝被前面的丘陵和雾盖住
  peak: 760,
};

/* 一维格点噪声：山脊线沿东西方向的高度靠它 */
const mtnLattice = (() => {
  const r = mulberry32(913377);
  const a = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) a[i] = r();
  return a;
})();

function mtnLatticeAt(u) {
  const i = Math.floor(u);
  const f = u - i;
  const s = f * f * (3 - 2 * f);
  const a = mtnLattice[((i % 1024) + 1024) % 1024];
  const b = mtnLattice[(((i + 1) % 1024) + 1024) % 1024];
  return a + (b - a) * s;
}

/* 尖顶分形：取 |2n-1| 的补，得到有尖有谷的脊线 */
function mtnRidge1(u) {
  let v = 0;
  let amp = 1;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < 4; o++) {
    const n = mtnLatticeAt(u * f + o * 53.7);
    const r = 1 - Math.abs(n * 2 - 1);
    v += r * r * amp;
    norm += amp;
    amp *= 0.52;
    f *= 2.13;
  }
  return v / norm;
}

/* 山脊高度（0~1）：大块山基上长峰群，峰上再长尖角。
   小尺度的峰只挂在大山体的坡上，山才不是一排等距的锯齿。 */
function mtnCrest(u) {
  // 脊状噪声的实际取值挤在 0.25 上下，先拉伸到满量程，山才有真正的高差
  const stretch = (v) => clamp((v - 0.10) / 0.40, 0, 1);
  const massif = Math.pow(stretch(mtnRidge1(u * 1.55 + 3.10)), 1.25);
  const peaks = Math.pow(stretch(mtnRidge1(u * 5.30 + 9.70)), 1.70);
  const crags = Math.pow(stretch(mtnRidge1(u * 14.0 + 23.30)), 2.10);
  const body =
    massif * 0.60 + peaks * 0.32 * (0.40 + massif) + crags * 0.11 * (0.28 + peaks);
  // 一座主峰压住整条山脉，两侧的峰比它矮一截
  const hero = 0.10 + 0.90 * Math.exp(-Math.pow((u - 0.615) / 0.145, 2.0))
    + 0.34 * Math.exp(-Math.pow((u - 0.845) / 0.10, 2.0));
  return clamp(body * hero * 1.34, 0, 1.12);
}

/* 雪山自己的 uniform：applyTime 里从时辰状态同步过来 */
/* 山的骨架是一组山脊线：每条从峰顶往一个方向伸出去，两头带高度。
   山脊与山脊之间自然会落成山谷 —— 这是锥形山峰做不到的。 */
const MTN_RIDGES = [
  // [x1, z1, h1, x2, z2, h2, 半宽]
  [280, 1730, 1010, 760, 1775, 440, 580],    // 主峰向东
  [280, 1730, 1010, -200, 1795, 525, 580],   // 主峰向西
  [280, 1730, 1010, 520, 1450, 440, 450],    // 主峰向南（朝观众的一侧）
  [280, 1730, 1010, 60, 1900, 580, 540],     // 主峰向北
  [-620, 1790, 685, -300, 1855, 495, 450],   // 西侧第二座
  [-620, 1790, 685, -1120, 1795, 410, 490],
  [-1560, 1775, 465, -2010, 1780, 275, 450],
  [1230, 1790, 580, 1640, 1775, 335, 470],
  [1230, 1790, 580, 830, 1855, 380, 400],
  [-150, 1560, 365, 420, 1530, 300, 450],    // 前面那道矮山肩
];

const mtnUniforms = {
  uSunDir: { value: SUN_DIR.clone() },
  uSunColor: { value: new THREE.Color(0xffeec6) },
  uSunI: { value: 1.0 },
  uSkyColor: { value: new THREE.Color(0xb7d2e8) },
  uFogColor: { value: new THREE.Color(0xc8d6e2) },
  uNight: { value: 0 },
  uDusk: { value: 0 },
};

function buildSnowRange() {
  const { w, d, segX, segZ, z0, baseY } = MTN;
  const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(MTN.x, baseY, z0 + d / 2);

  const pos = geo.attributes.position;
  const count = pos.count;
  const rowLen = segX + 1;
  const left = MTN.x - w / 2;
  const heights = new Float32Array(count);

  // 山体：几个峰按距离衰减叠加成一块高山，再用脊状分形刻出山脊网
  function mtnRidgeField(x, z) {
    let v = 0;
    let amp = 1;
    let f = 0.0024;
    let norm = 0;
    for (let o = 0; o < 5; o++) {
      const n = 1 - Math.abs(valueNoise(x * f + o * 17.3, z * f - o * 9.1) * 2 - 1);
      v += n * n * amp;
      norm += amp;
      amp *= 0.52;
      f *= 2.07;
    }
    return v / norm;
  }

  const ridgeVals = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const tz = (z - z0) / d;

    // 山脊线取最大的那条：两条脊相交处自然形成棱线
    let ridgeH = 0;
    for (let k = 0; k < MTN_RIDGES.length; k++) {
      const r = MTN_RIDGES[k];
      const abx = r[3] - r[0];
      const abz = r[4] - r[1];
      const len2 = abx * abx + abz * abz || 1;
      let t = ((x - r[0]) * abx + (z - r[1]) * abz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = r[0] + abx * t;
      const pz = r[1] + abz * t;
      const d = Math.hypot(x - px, z - pz) / r[6];
      const prof = Math.pow(Math.max(0, 1 - d), 1.75);
      const v = (r[2] + (r[5] - r[2]) * t) * prof;
      if (v > ridgeH) ridgeH = v;
    }

    // 山脚垫一层厚底座，山脊之间不至于漏出天空
    let base = 0;
    for (let k = 0; k < MTN_RIDGES.length; k += 2) {
      const r = MTN_RIDGES[k];
      const dd = Math.hypot((x - r[0]) / (r[6] * 2.1), (z - r[1]) / (r[6] * 2.1));
      if (dd < 1) base += r[2] * 0.30 * Math.pow(1 - dd, 1.8);
    }

    let massif = Math.max(ridgeH, base);

    // 脊状分形：脊线连成网，山脊与沟壑自然分叉
    const rid = clamp((mtnRidgeField(x, z) - 0.07) / 0.42, 0, 1);
    ridgeVals[i] = rid;

    const scale = massif / 940;
    let h = massif * (0.80 + 0.36 * rid);
    h += (fbm(x * 0.0095 + 2.7, z * 0.0095 - 5.3, 4) - 0.5) * 62 * scale;
    h += (fbm(x * 0.0280 - 11.2, z * 0.0280 + 6.6, 3) - 0.5) * 22 * scale;

    // 前后两端沉到地平线以下，接缝被前面的丘陵挡住
    h *= Math.min(1, tz / 0.07) * Math.min(1, (1 - tz) / 0.09);
    if (h < 0) h *= 0.3;

    heights[i] = h;
    pos.setY(i, baseY + h);
  }
  geo.computeVertexNormals();

  // 沟谷 AO：比四周高的山脊提亮，凹下去的雪沟压暗 —— 这是立体感的一半
  const nrm = geo.attributes.normal;
  const snowAttr = new Float32Array(count);
  const rockAttr = new Float32Array(count);
  const aoAttr = new Float32Array(count);
  const RINGS = [2, 5, 10, 18];

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = nrm.getY(i);

    const line = 190 + (fbm(x * 0.0028 - 3.1, z * 0.0028 + 7.4, 3) - 0.5) * 130;
    let sn = smoothstep(line - 188, line + 176, y);
    sn *= smoothstep(0.10, 0.40, ny);                       // 陡的岩壁挂不住雪
    // 沟里存不住雪：山脊之间的深槽露出深色岩体。
    // 只在雪线附近这么干，峰顶的雪面才干净，不会长出一片脏斑。
    const rockRib = smoothstep(0.04, 0.34, ridgeVals[i]);
    const lowK = smoothstep(line + 235, line - 74, y);
    sn *= 1.0 - (1.0 - rockRib) * lowK;
    sn *= 0.90 + fbm(x * 0.019 + 5.5, z * 0.019 - 9.1, 3) * 0.22;
    snowAttr[i] = clamp(sn, 0, 1);

    rockAttr[i] = clamp(fbm(x * 0.0065 + 13.0, z * 0.0065 - 4.0, 3) * 1.45 - 0.16, 0, 1);

    // 邻域平均：取几圈不同半径，山脊比四周高就亮、沟里就暗
    const ix = i % rowLen;
    const iy = (i - ix) / rowLen;
    let sum = 0;
    let wsum = 0;
    for (let r = 0; r < RINGS.length; r++) {
      const rad = RINGS[r];
      let local = 0;
      let lw = 0;
      for (let k = 0; k < 8; k++) {
        const jx = ix + (k === 0 ? rad : k === 1 ? -rad : k === 4 ? rad : k === 5 ? -rad : k === 6 ? rad : k === 7 ? -rad : 0);
        const jy = iy + (k === 2 ? rad : k === 3 ? -rad : k === 4 ? rad : k === 5 ? -rad : k === 6 ? -rad : k === 7 ? rad : 0);
        if (jx < 0 || jx > segX || jy < 0 || jy > segZ) continue;
        local += heights[jy * rowLen + jx];
        lw += 1;
      }
      if (lw > 0) {
        sum += (local / lw) * rad;
        wsum += rad;
      }
    }
    const avg = wsum > 0 ? sum / wsum : heights[i];
    aoAttr[i] = clamp(1 + (heights[i] - avg) / 160, 0.42, 1.12);
  }

  geo.setAttribute('aSnow', new THREE.BufferAttribute(snowAttr, 1));
  geo.setAttribute('aRock', new THREE.BufferAttribute(rockAttr, 1));
  geo.setAttribute('aAO', new THREE.BufferAttribute(aoAttr, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: mtnUniforms,
    vertexShader: /* glsl */ `
      attribute float aSnow;
      attribute float aRock;
      attribute float aAO;
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying float vSnow;
      varying float vRock;
      varying float vAO;

      void main() {
        vWorld = position;
        vNrm = normalize(normal);
        vSnow = aSnow;
        vRock = aRock;
        vAO = aAO;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunI;
      uniform vec3 uSkyColor;
      uniform vec3 uFogColor;
      uniform float uNight;
      uniform float uDusk;

      varying vec3 vWorld;
      varying vec3 vNrm;
      varying float vSnow;
      varying float vRock;
      varying float vAO;

      float h21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vn(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
          mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);

        // 细节随距离收掉，远处不会抖成噪点
        float detail = 1.0 - smoothstep(700.0, 1800.0, dist);
        float g1 = vn(vWorld.xz * 0.052);
        float g2 = vn(vWorld.xz * 0.155) * detail;

        // 用噪声的梯度扰动法线：山面才有岩石的皴，不是一块光溜溜的模子
        float e = 7.0;
        float n0 = vn(vWorld.xz * 0.043);
        float nx = vn((vWorld.xz + vec2(e, 0.0)) * 0.043);
        float nz = vn((vWorld.xz + vec2(0.0, e)) * 0.043);
        vec3 N = normalize(vNrm + vec3(n0 - nx, 0.0, n0 - nz) * 3.4 * detail);

        // 环境光：朝上的面吃天光，朝下的面吃地面反照
        float up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 amb = mix(uFogColor * 0.40, uSkyColor * 0.98, up);

        // 直射：这是体积感的来源，向阳面亮、背阴面沉下去
        float ndl = max(dot(N, uSunDir), 0.0);
        vec3 direct = uSunColor * ndl * uSunI * 1.30;

        // 岩石：冷灰，带噪声的深浅
        vec3 rock = mix(vec3(0.150, 0.158, 0.168), vec3(0.385, 0.378, 0.360), vRock);
        rock *= 0.68 + g1 * 0.52 + g2 * 0.20;
        rock *= 0.78 + 0.34 * up;

        // 雪：噪声打碎边界，陡坡露岩
        float brk = vn(vWorld.xz * 0.030 + 17.0);
        // 顺着坡面往下淌的雪沟：x 高频、z 低频
        float streak = vn(vec2(vWorld.x * 0.085, vWorld.z * 0.014) + 3.0);
        // 阈值收窄、抬高：雪面上只留细碎变化，不会破出一块块灰斑
        float sn = smoothstep(
          0.46, 0.64,
          vSnow + (brk - 0.5) * 0.13 + (streak - 0.5) * 0.13
        );
        sn *= smoothstep(0.10, 0.40, N.y);
        vec3 snowCol = vec3(0.76, 0.80, 0.89) * (0.86 + g2 * 0.18);

        vec3 albedo = mix(rock, snowCol, sn);
        // AO 同时压雪和岩，沟里的雪才不是一层糖霜
        // AO 主要作用在岩石上；雪面平整，只吃一点点，否则会糊成脏斑
        float aoK = mix(0.95, 0.30, sn);
        vec3 col = albedo * (amb + direct) * mix(1.0, vAO, aoK);

        // 日照金山：太阳压到地平线时，高处的雪还亮着，山下的谷已经沉进阴影
        float high = smoothstep(220.0, 690.0, vWorld.y);
        col += uSunColor * uDusk * high * mix(0.30, 0.85, sn) * 0.42;

        // 逆光金边：太阳落到山背后时，雪脊上透出一线暖光
        float back = pow(max(dot(-V, uSunDir), 0.0), 2.2);
        col += uSunColor * back * sn * (0.10 + uDusk * 1.55) * (0.35 + 0.65 * (1.0 - ndl));
        // 山脊自带的一点雪面亮边
        col += vec3(0.95, 0.96, 1.0) * sn * pow(1.0 - max(N.y, 0.0), 3.0) * 0.10;

        // 夜里沉成深蓝 —— 必须在雾混合之前做。
        // 雾色是按着时辰调好的（夜里本来就是暗的），如果在雾之后再压暗，
        // 山脚那圈雾会跟着变暗，和同距离的地面雾对不上，
        // 山就像被一条亮带横着切断、浮在地上 —— 黄昏最明显
        col *= mix(1.0, 0.30, uNight);
        col += uSkyColor * uNight * 0.028;

        // 空气透视：越远、越低，越化进天边的雾色
        float aerial = smoothstep(1200.0, 3000.0, dist) * 0.22;
        // 山脚的雾：颜色必须与地面远处的雾一模一样（就是 uFogColor，不能再乘任何系数），
        // 越贴近山根化得越彻底 —— 山是「从雾里长出来」的，不是被一条亮带切开
        float mistN = vn(vWorld.xz * 0.0075 + 9.0) * 0.62 + vn(vWorld.xz * 0.024 - 3.0) * 0.38;
        float mistTop = 330.0 + mistN * 245.0;
        float foot = smoothstep(mistTop, mistTop - 345.0, vWorld.y);
        // 雪比岩石更"穿透"雾：雾天里最先看见的总是雪线
        foot *= mix(1.0, 0.72, vSnow);
        // 山根埋在地平线以下（baseY=-90），这一段彻底化进雾里，接缝归零
        float sink = smoothstep(58.0, -150.0, vWorld.y);
        float fogCap = mix(0.90, 1.0, sink);
        col = mix(col, uFogColor, clamp(aerial + foot, 0.0, fogCap));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, mat };
}

/* 花海尽头的地标：一棵孤树 */
function buildLoneTree() {
  const g = new THREE.Group();
  const x = 6.5;
  const z = 186;
  const y = heightAt(x, z);

  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5b452e });
  const leafMats = [0xcfdcea, 0xdce7f2, 0xc2d2e2, 0xe6eff7].map(
    (c) => new THREE.MeshLambertMaterial({ color: c })
  );
  const blobGeo = new THREE.SphereGeometry(1, 12, 9);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.62, 5.4, 9), trunkMat);
  trunk.position.y = 2.7;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);

  for (const [ax, ay, az, rot] of [[0.9, 4.4, 0.3, -0.7], [-0.85, 4.9, -0.2, 0.75], [0.2, 5.6, -0.8, 0.2]]) {
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6), trunkMat);
    br.position.set(ax * 0.5, ay, az * 0.5);
    br.rotation.z = rot;
    br.rotation.x = az * 0.6;
    br.castShadow = true;
    g.add(br);
  }

  // 树冠用十几个小球拼，轮廓才不圆
  const crown = [
    [0, 6.6, 0, 1.9], [-1.5, 6.1, 0.7, 1.5], [1.6, 6.2, -0.5, 1.55],
    [0.4, 7.5, 0.4, 1.35], [-0.9, 7.1, -0.8, 1.2], [1.1, 5.5, 1.0, 1.15],
    [-1.4, 5.4, -0.9, 1.05], [0.9, 6.9, -1.3, 1.1], [-0.5, 5.9, 1.4, 1.0],
    [2.0, 6.8, 0.4, 0.95], [-2.0, 6.7, -0.2, 0.9], [0.2, 5.2, -1.2, 0.95],
  ];
  for (let i = 0; i < crown.length; i++) {
    const [bx, by, bz, r] = crown[i];
    const m = new THREE.Mesh(blobGeo, leafMats[i % leafMats.length]);
    m.position.set(bx, by, bz);
    m.scale.set(r, r * 0.82, r);
    m.rotation.set(i * 0.7, i * 1.3, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }

  // 远处的树不在阴影相机范围里，地上补一块软阴影
  const shadeMat = new THREE.MeshBasicMaterial({
    color: 0x1d2416,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  const shade = new THREE.Mesh(new THREE.CircleGeometry(3.4, 20), shadeMat);
  shade.rotation.x = -Math.PI / 2;
  shade.position.set(0.2, 0.03, 0.1);
  shade.renderOrder = 1;
  g.add(shade);

  // 树下几块石头，给个落脚点
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x8d8b80 });
  for (const [sx, sz, sr] of [[1.8, 1.2, 0.55], [-2.1, -0.8, 0.42], [2.6, -1.4, 0.34]]) {
    const st = new THREE.Mesh(blobGeo, stoneMat);
    st.position.set(sx, sr * 0.45, sz);
    st.scale.set(sr, sr * 0.6, sr * 0.85);
    st.castShadow = true;
    st.receiveShadow = true;
    g.add(st);
  }

  g.position.set(x, y, z);
  scene.add(g);
  return g;
}

const loneTree = buildLoneTree();

const snowRange = buildSnowRange();

/* =========================================================
   4.7 冰湖
   一块真的会反光的冰：午后是青白色，黄昏吃一层粉，夜里深蓝透亮。
   冰面上有裂纹、有风吹上去的雪堆，冰缘化进雪里。
   ========================================================= */

const iceUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(0xfff3e0) },
  uSunI: { value: 1 },
  uSkyColor: { value: new THREE.Color(0xa8c8ee) },
  uFogColor: { value: new THREE.Color(FOG_COLOR) },
  uFogDensity: { value: 0.003 },
  uNight: { value: 0 },
  uDusk: { value: 0 },
};

function buildIceLake() {
  const size = ICE.r * 2.5;
  const geo = new THREE.PlaneGeometry(size, size, 140, 140);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const dist = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    dist[i] = iceDist(pos.getX(i) + ICE.x, pos.getZ(i) + ICE.z);
  }
  geo.setAttribute('aD', new THREE.BufferAttribute(dist, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: iceUniforms,
    vertexShader: /* glsl */ `
      attribute float aD;
      varying vec3 vWorld;
      varying float vD;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vD = aD;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunI;
      uniform vec3 uSkyColor;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uNight;
      uniform float uDusk;
      varying vec3 vWorld;
      varying float vD;

      float h21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vn(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
          mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      float fbm2(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vn(p);
          p = p * 2.03 + vec2(7.1, 3.7);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        if (vD > 1.045) discard;

        vec2 q = vWorld.xz;
        float dist = length(cameraPosition - vWorld);

        // 冰的纹理：大块的浑浊 + 细的裂纹网
        float murk = fbm2(q * 0.055);
        float fine = fbm2(q * 0.42 + 3.1);
        float crackN = abs(fbm2(q * 0.19 + 11.0) - 0.5);
        float crack = smoothstep(0.05, 0.006, crackN);
        // 裂纹只在中远处出现：脚下太清楚会显得像地砖
        crack *= smoothstep(6.0, 26.0, dist) * 0.85;

        // 风吹到冰上的雪：靠岸更厚
        float snowN = fbm2(q * 0.028 - 4.0) * 0.72 + fbm2(q * 0.11 + 9.0) * 0.28;
        float snowPatch = smoothstep(0.76, 0.94, snowN + smoothstep(0.66, 1.0, vD) * 0.62);

        vec3 iceA = vec3(0.13, 0.27, 0.42);   // 深处：深青蓝，能看见冰底
        vec3 iceB = vec3(0.38, 0.55, 0.70);   // 浅处
        vec3 ice = mix(iceA, iceB, murk * 0.8 + 0.12);
        ice *= 0.88 + fine * 0.2;
        // 冰面上的白霜：中间薄、靠岸厚
        ice = mix(ice, vec3(0.93, 0.96, 1.0), snowPatch * 0.95);

        // 法线：一点点起伏，让高光有形状
        float e = 0.6;
        float nx = fbm2((q + vec2(e, 0.0)) * 0.09) - fbm2((q - vec2(e, 0.0)) * 0.09);
        float nz = fbm2((q + vec2(0.0, e)) * 0.09) - fbm2((q - vec2(0.0, e)) * 0.09);
        vec3 N = normalize(vec3(nx * 2.6, 1.0, nz * 2.6));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);

        float ndl = max(dot(N, uSunDir), 0.0);
        vec3 amb = uSkyColor * 0.52 + vec3(0.02, 0.03, 0.05);
        vec3 sun = uSunColor * uSunI * (0.28 + 0.72 * ndl);
        vec3 col = ice * (amb + sun * 0.75);

        // 太阳在冰上的高光：冰比水糙，光斑更宽
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), mix(60.0, 9.0, uDusk));
        col += uSunColor * spec * (0.9 + uDusk * 1.8) * uSunI;

        // 冰映天色
        col = mix(col, uSkyColor * (0.55 + 0.45 * ndl), fres * (0.26 + uDusk * 0.22) * (1.0 - uNight * 0.5));

        // 裂纹：比冰暗、比冰蓝
        col = mix(col, vec3(0.10, 0.18, 0.28) * (0.6 + 0.7 * uSunI), crack * 0.85);

        // 夜里：冰是深蓝的，像一块墨玉 —— 但不能黑成一片，要留住天光的反射
        col *= mix(1.0, 0.52, uNight);
        col += uSkyColor * uNight * 0.10;

        // 冰缘化进雪里
        col = mix(col, vec3(0.90, 0.94, 0.98) * (amb + sun * 0.6), smoothstep(0.90, 1.02, vD) * 0.85);

        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, fogF);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(ICE.x, ICE.level + 0.02, ICE.z);
  mesh.renderOrder = 1;
  scene.add(mesh);
  return mesh;
}

const iceLake = buildIceLake();



/* =========================================================
   5. 土路
   ========================================================= */

function makePathRibbon(pointsXZ, halfWidth) {
  const pts = pointsXZ.map((p) => new THREE.Vector3(p[0], 0, p[1]));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
  const samples = curve.getPoints(110);
  const positions = [];
  const uvs = [];
  const indices = [];
  let length = 0;
  let prev = samples[0];

  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    if (i > 0) length += p.distanceTo(prev);
    prev = p;

    const prevP = samples[Math.max(0, i - 1)];
    const nextP = samples[Math.min(samples.length - 1, i + 1)];
    let tx = nextP.x - prevP.x;
    let tz = nextP.z - prevP.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const nx = -tz;
    const nz = tx;

    const wob = 0.86 + valueNoise(i * 0.37 + 4.2, 2.7) * 0.28;
    const w = halfWidth * wob;
    for (const s of [-1, 1]) {
      const x = p.x + nx * w * s;
      const z = p.z + nz * w * s;
      positions.push(x, heightAt(x, z) + 0.065, z);
      uvs.push(s * 0.5 + 0.5, length / 2.6);
    }
    if (i < samples.length - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    map: makePathTexture(),
    roughness: 1.0,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

makePathRibbon(PATH_POINTS, 0.72);
makePathRibbon(INNER_PATH_POINTS, 0.68);
// 去花海的路面：走的人多了压出来的一道窄车辙
makePathRibbon(FLOWER_ROAD, 0.46);

/* =========================================================
   6. 风与草
   ========================================================= */

const sharedUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uGust: { value: 0 },
  uSunDir: { value: SUN_DIR.clone() },
  uSunColor: { value: new THREE.Color(0xffeec6) },
  uSunI: { value: 1.05 },
  uSkyColor: { value: new THREE.Color(0xb7d2e8) },
  uFogColor: { value: new THREE.Color(FOG_COLOR) },
  uFogDensity: { value: 0.0044 },
  uShadowMap: { value: whitePixel },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowTexel: { value: 1 / 2048 },
  uCloudMap: { value: makeCloudShadowTexture() },
  uCloudOffset: { value: new THREE.Vector2(0, 0) },
  uCloudAmount: { value: 0.35 },
  uNight: { value: 0 },
  uDusk: { value: 0 },
  uDew: { value: 0 },
};

const WIND_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uWind;
  uniform float uGust;

  vec3 windOffset(vec3 world, float h, float stiff, float phase) {
    float t = uTime;
    // 整片花海被风压过去的一道低频浪，uGust 大的时候最明显
    float fieldWave = sin(world.x * 0.042 + world.z * 0.028 + t * 0.85) * uGust;
    float gust = sin(world.x * 0.098 + t * 0.52) * 0.5 + sin(world.z * 0.121 - t * 0.35) * 0.5;
    // 风阵：一道波顺着风向滚过草原，uGust 由 JS 每隔十秒左右放一次
    float front = sin(world.x * 0.052 + world.z * 0.031 - t * 1.15);
    float wave = front * (0.20 + uGust * 2.4);
    float sway = sin(t * 1.55 + phase + world.x * 0.26 + world.z * 0.17) * 0.58
               + sin(t * 2.65 + phase * 1.7) * 0.22;
    float bend = pow(clamp(h, 0.0, 1.0), 1.5) * stiff;
    return vec3(
      (0.78 * sway + 0.62 * gust + 0.35 * wave + fieldWave * 0.85) * 0.2 * bend * uWind,
      0.0,
      (0.54 * sway - 0.46 * gust + 0.22 * wave * 0.6 + fieldWave * 0.4) * 0.2 * bend * uWind
    );
  }
`;

const SHADOW_GLSL = /* glsl */ `
  uniform sampler2D uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform float uShadowTexel;

  float shadowFactor(vec4 coord, vec3 n) {
    if (coord.w <= 0.0) return 1.0;
    vec3 p = coord.xyz / coord.w;
    if (p.x < 0.003 || p.x > 0.997 || p.y < 0.003 || p.y > 0.997 || p.z > 1.0) return 1.0;
    float d = p.z - 0.0012;
    vec2 t = vec2(uShadowTexel);
    float s = 0.0;
    s += step(d, texture2D(uShadowMap, p.xy + vec2(-t.x, -t.y)).r);
    s += step(d, texture2D(uShadowMap, p.xy + vec2( t.x, -t.y)).r);
    s += step(d, texture2D(uShadowMap, p.xy + vec2(-t.x,  t.y)).r);
    s += step(d, texture2D(uShadowMap, p.xy + vec2( t.x,  t.y)).r);
    return s * 0.25;
  }
`;

const LIGHT_GLSL = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunI;
  uniform vec3 uSkyColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform sampler2D uCloudMap;
  uniform vec2 uCloudOffset;
  uniform float uCloudAmount;
  uniform float uNight;
  uniform float uDusk;
  uniform float uDew;
  uniform float uTime;
  uniform float uGust;

  /* 云影：取样一张滚动的软噪声，云过去的时候这片草就暗一下 */
  float cloudShade(vec2 xz) {
    float cs = texture2D(uCloudMap, xz * 0.0055 + uCloudOffset).r;
    return mix(1.0, mix(0.50, 1.03, smoothstep(0.28, 0.74, cs)), uCloudAmount);
  }
`;

const grassVertex = /* glsl */ `
  uniform mat4 uShadowMatrix;
  ${WIND_GLSL}
  attribute float aPhase;
  attribute float aStiff;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vH;
  varying vec3 vNormalW;
  varying vec4 vShadowCoord;

  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    float h = clamp(position.y, 0.0, 1.0);
    world.xyz += windOffset(world.xyz, h, aStiff, aPhase);

    vUv = uv;
    vWorld = world.xyz;
    vH = h;
    vColor = instanceColor;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vShadowCoord = uShadowMatrix * vec4(world.xyz, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const grassFragment = /* glsl */ `
  uniform sampler2D uMap;
  ${LIGHT_GLSL}
  ${SHADOW_GLSL}

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vH;
  varying vec3 vNormalW;
  varying vec4 vShadowCoord;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float dist = length(cameraPosition - vWorld);
    float nearFade = smoothstep(0.18, 0.9, dist);
    if (tex.a * nearFade < 0.22) discard;

    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);

    float sh = shadowFactor(vShadowCoord, n);
    float cs = cloudShade(vWorld.xz);
    float ao = mix(0.54, 1.0, pow(vH, 0.62));

    float ndl = 0.30 + 0.70 * abs(dot(n, uSunDir));
    vec3 sun = uSunColor * ndl * 1.52 * uSunI * sh * cs;
    vec3 amb = uSkyColor * 0.62 + vec3(0.006, 0.011, 0.018);
    vec3 col = vColor * tex.rgb * (sun + amb) * ao;

    float back = pow(max(-dot(v, uSunDir), 0.0), 2.2);
    col += vColor * tex.rgb * uSunColor * back * (0.18 + 0.82 * vH) * 0.95 * uSunI * sh * cs;

    // 黄昏逆光：太阳贴在草尖后面时，叶片边缘透出橙红的边光
    float rim = pow(max(-dot(v, uSunDir), 0.0), 3.6);
    col += vColor * tex.rgb * uSunColor * rim * pow(vH, 0.65) * uDusk * 2.15 * uSunI * sh * cs;

    // 晨露：叶尖上零星的闪点，只在近处、只在这个时辰
    if (uDew > 0.01) {
      vec3 hv = normalize(uSunDir + v);
      float spec = pow(max(dot(n, hv), 0.0), 160.0);
      float gate = step(0.70, fract(sin(dot(floor(vWorld.xz * 11.0), vec2(41.3, 289.1))) * 43758.5));
      col += uSunColor * spec * gate * uDew * 2.6 * (1.0 - smoothstep(6.0, 24.0, dist)) * sh;
    }

    // 叶片高光：顺着太阳方向看过去，嫩叶会有一层细亮的反光
    vec3 hv = normalize(uSunDir + v);
    float sheen = pow(max(dot(n, hv), 0.0), 24.0);
    col += uSunColor * sheen * 0.34 * uSunI * sh * cs * (0.30 + 0.70 * vH);

    // 风阵推过来时，草尖被抹亮一层，像浪一样滚过草原
    float gustFront = sin(vWorld.x * 0.052 + vWorld.z * 0.031 - uTime * 1.15);
    col *= 1.0 + gustFront * uGust * 0.13 * clamp(vH, 0.0, 1.0);

    col *= mix(vec3(0.93, 0.94, 0.92), vec3(1.16, 1.05, 0.80), clamp(vH, 0.0, 1.0));

    // 夜里草是蓝银色的，不是一团黑
    col = mix(col, col * vec3(0.60, 0.72, 1.14) + vec3(0.004, 0.008, 0.018), uNight * 0.55);

    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const flowerVertex = /* glsl */ `
  uniform mat4 uShadowMatrix;
  ${WIND_GLSL}
  attribute float aPhase;
  attribute float aStiff;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vH;
  varying vec3 vNormalW;
  varying vec4 vShadowCoord;

  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    float h = 0.34 + clamp(position.y + 0.5, 0.0, 1.0) * 0.66;
    world.xyz += windOffset(world.xyz, 1.0, aStiff, aPhase);

    vUv = uv;
    vWorld = world.xyz;
    vH = h;
    vColor = instanceColor;
    vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vShadowCoord = uShadowMatrix * vec4(world.xyz, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const flowerFragment = /* glsl */ `
  uniform sampler2D uMap;
  ${LIGHT_GLSL}
  ${SHADOW_GLSL}

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vH;
  varying vec3 vNormalW;
  varying vec4 vShadowCoord;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float dist = length(cameraPosition - vWorld);
    float nearFade = smoothstep(0.1, 0.5, dist);
    if (tex.a * nearFade < 0.45) discard;

    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    float sh = shadowFactor(vShadowCoord, n);

    float ndl = 0.62 + 0.38 * abs(dot(n, uSunDir));
    float cs = cloudShade(vWorld.xz);
    vec3 sun = uSunColor * ndl * 1.16 * uSunI * sh * cs;
    vec3 amb = (uSkyColor * 0.85 + vec3(0.008, 0.014, 0.024)) * mix(1.0, cs, 0.55);
    vec3 col = vColor * tex.rgb * (sun + amb);

    float back = pow(max(-dot(v, uSunDir), 0.0), 2.0);
    col += vColor * tex.rgb * uSunColor * back * 0.45 * uSunI * sh * cs;

    // 花瓣在黄昏也会被点亮一层暖边
    float rim = pow(max(-dot(v, uSunDir), 0.0), 4.5);
    col += vColor * tex.rgb * uSunColor * rim * uDusk * 0.9 * uSunI * sh * cs;

    // 花瓣的半透光：太阳在花背后时，整朵花都亮起来
    float glow = pow(max(-dot(v, uSunDir), 0.0), 1.5) * 0.16;
    col += vColor * tex.rgb * uSunColor * glow * uSunI * sh * cs;

    // 风阵经过时花头一起亮一下
    float gustFront = sin(vWorld.x * 0.052 + vWorld.z * 0.031 - uTime * 1.15);
    col *= 1.0 + gustFront * uGust * 0.10;

    col = mix(col, col * vec3(0.62, 0.74, 1.12) + vec3(0.004, 0.008, 0.016), uNight * 0.6);

    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const grassMaterial = new THREE.ShaderMaterial({
  uniforms: { ...sharedUniforms, uMap: { value: makeGrassTexture() } },
  vertexShader: grassVertex,
  fragmentShader: grassFragment,
  side: THREE.DoubleSide,
});

const stemMaterial = new THREE.ShaderMaterial({
  uniforms: sharedUniforms,
  vertexShader: grassVertex,
  fragmentShader: grassFragment,
  side: THREE.DoubleSide,
});

/* 草穗与三叶草用同一套风/光，只是贴图不同 */
const seedHeadMaterial = new THREE.ShaderMaterial({
  uniforms: { ...sharedUniforms, uMap: { value: makeSeedHeadTexture() } },
  vertexShader: grassVertex,
  fragmentShader: grassFragment,
  side: THREE.DoubleSide,
});

const cloverMaterial = new THREE.ShaderMaterial({
  uniforms: { ...sharedUniforms, uMap: { value: makeCloverTexture() } },
  vertexShader: grassVertex,
  fragmentShader: grassFragment,
  side: THREE.DoubleSide,
});

function makeFlowerMaterial(kind) {
  return new THREE.ShaderMaterial({
    uniforms: { ...sharedUniforms, uMap: { value: makeFlowerTexture(kind) } },
    vertexShader: flowerVertex,
    fragmentShader: flowerFragment,
    side: THREE.DoubleSide,
  });
}

const flowerMaterials = [
  makeFlowerMaterial(0),
  makeFlowerMaterial(1),
  makeFlowerMaterial(2),
  makeFlowerMaterial(3),
  makeFlowerMaterial(4),
  makeFlowerMaterial(5),
];

/* ---------- 几何 ---------- */

function makeGrassCardGeometry(planes = 3, segments = 3) {
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let p = 0; p < planes; p++) {
    const angle = (p / planes) * Math.PI;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const start = positions.length / 3;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const curve = 0.12 * t * t;
      for (const x of [-0.5, 0.5]) {
        const px = x * ca + curve * sa;
        const pz = -x * sa + curve * ca;
        positions.push(px, t, pz);
        uvs.push(x + 0.5, t);
      }
    }
    for (let i = 0; i < segments; i++) {
      const a = start + i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function makeStemGeometry() {
  const positions = [-0.014, 0, 0, 0.014, 0, 0, -0.012, 1, 0, 0.012, 1, 0];
  const uvs = [0, 0, 1, 0, 0, 1, 1, 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 1, 3, 2]);
  geo.computeVertexNormals();
  return geo;
}

function makeFlowerHeadGeometry() {
  const positions = [];
  const uvs = [];
  const indices = [];
  const addQuad = (horizontal) => {
    const base = positions.length / 3;
    if (!horizontal) {
      positions.push(-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0);
    } else {
      positions.push(0, -0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5);
    }
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  addQuad(false);
  addQuad(true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}


/* ---------- 松林 ---------- */
/* 雪原的主角不是草，是松树：一棵树 = 树干 + 三层锥形树冠 + 每层顶上的雪盖。
   全部烘进一个几何体、按实例绘制 —— 一片林子也只有一次 draw call。 */
function paintGeo(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const pineGeo = (() => {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.09, 0.17, 2.1, 6);
  trunk.translate(0, 1.05, 0);
  parts.push(paintGeo(trunk, 0x4a3a2a));

  const layers = [
    { y: 0.95, r: 1.02, h: 2.15, c: 0x2b4436 },
    { y: 2.05, r: 0.78, h: 1.95, c: 0x32503d },
    { y: 3.00, r: 0.50, h: 1.85, c: 0x3a5c46 },
  ];
  for (const L of layers) {
    const cone = new THREE.ConeGeometry(L.r, L.h, 9);
    cone.translate(0, L.y + L.h * 0.5, 0);
    parts.push(paintGeo(cone, L.c));
    // 雪盖：只盖住每层树冠的上半截，边缘不能大过树冠，否则像千层饼
    const cap = new THREE.ConeGeometry(L.r * 0.55, L.h * 0.34, 9);
    cap.translate(0, L.y + L.h * 0.82, 0);
    parts.push(paintGeo(cap, 0xeff5fa));
  }
  return mergeGeometries(parts, false);
})();

const pineMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.92,
  metalness: 0.0,
});

// 一棵树占的地方：用来让草在树根周围稀疏一点
const pineSpots = new Map();
function pineKey(cx, cz) {
  return cx + ',' + cz;
}

/* ---------- 区块化草海 ---------- */

const CHUNK = 34;
const RINGS = 4;
const tuftGeoBase = makeGrassCardGeometry(3, 3);
const stemGeoBase = makeStemGeometry();
const headGeoBase = makeFlowerHeadGeometry();
const seedHeadGeoBase = makeGrassCardGeometry(2, 3);
const cloverGeoBase = makeGrassCardGeometry(2, 2);
const petalGeoBase = new THREE.PlaneGeometry(1, 1);
petalGeoBase.rotateX(-Math.PI / 2);

const fallenLeafMat = new THREE.MeshLambertMaterial({
  map: makeFallenLeafTexture(),
  transparent: true,
  alphaTest: 0.4,
  side: THREE.DoubleSide,
});

const chunks = new Map();
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

// 雪里的枯草：稻草色压在雪上，深浅不一才不是一根根塑料管
const grassPalette = [0xd6cdb5, 0xc9c0a6, 0xe0d8c2, 0xbdb499, 0xd2c9b0, 0xb0a78e, 0xe8e1cf];
// 雪原上的花：霜花、冰蓝、淡紫，稀稀落落地从雪里探出来
const flowerPalettes = [
  [0xffffff, 0xf2f7fc, 0xfafdff],
  [0xcfe0f2, 0xbdd2ea, 0xdfeaf8],
  [0xdcd0ee, 0xcfc2e6, 0xe6ddf4],
  [0xe8f2fb, 0xdceaf7, 0xf4f9fd],
  [0xa9c4e8, 0x95b4dd, 0xbcd2ee],
  [0xe0b8c4, 0xd4a8b8, 0xeac8d2],
];

function ringCount(ring, counts) {
  return counts[Math.min(ring, counts.length - 1)];
}

function buildChunk(cx, cz, ring) {
  const rand = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x9e3779b9);
  const group = new THREE.Group();
  const baseX = cx * CHUNK;
  const baseZ = cz * CHUNK;

  // 这个区块压到花海多少：中间最满，边上渐薄
  const seaK = Math.max(
    seaAt(baseX + CHUNK * 0.5, baseZ + CHUNK * 0.5),
    seaAt(baseX + 3, baseZ + 3),
    seaAt(baseX + CHUNK - 3, baseZ + 3),
    seaAt(baseX + 3, baseZ + CHUNK - 3),
    seaAt(baseX + CHUNK - 3, baseZ + CHUNK - 3)
  );

  // 雪原不是草海：枯草只从雪里探出零星几簇，花更少
  const tuftCount = ringCount(ring, [1500, 1350, 1100, 820, 560]);
  const flowerCount = ringCount(ring, [210, 185, 150, 100, 65]);
  const seedCount = ringCount(ring, [150, 130, 100, 60, 35]);
  const cloverCount = 0;   // 雪原没有三叶草：绿色贴图在雪里太扎眼

  /* 草 */
  const tuftGeo = tuftGeoBase.clone();
  const phases = new Float32Array(tuftCount);
  const stiffs = new Float32Array(tuftCount);
  const grassMesh = new THREE.InstancedMesh(tuftGeo, grassMaterial, tuftCount);

  for (let i = 0; i < tuftCount; i++) {
    const x = baseX + rand() * CHUNK;
    const z = baseZ + rand() * CHUNK;
    const y = heightAt(x, z);
    const vitality = fbm(x * 0.021 + 5, z * 0.021 + 2, 3);

    if (pathDistance(x, z) < 1.05 || insideFarmWork(x, z, 0.25) || iceDist(x, z) < 1.06) {
      dummy.position.set(x, -999, z);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      grassMesh.setMatrixAt(i, dummy.matrix);
      grassMesh.setColorAt(i, tmpColor.setHex(0x000000));
      phases[i] = 0;
      stiffs[i] = 0;
      continue;
    }

    dummy.position.set(x, y, z);
    dummy.rotation.set((rand() - 0.5) * 0.16, rand() * TAU, (rand() - 0.5) * 0.16);
    const width = 0.26 + rand() * 0.16;
    const sea = seaAt(x, z);
    // 花海里的草被花盖住大半，留短一点，花才立得出来
    // 雪压着草，只从雪里露出短短的梢
    // 雪里的枯草是细高的单株，不是趴在地上的一撮——否则远看像一块块褐色席子
    const tall = (0.46 + rand() * 0.34) * (0.84 + vitality * 0.42)
      * grazeFactor(x, z) * farmMowFactor(x, z) * (1 - sea * 0.92);
    dummy.scale.set(width, tall, width);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);

    const c = grassPalette[Math.floor(rand() * grassPalette.length)];
    tmpColor.setHex(c).offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.05);
    if (rand() < 0.12) tmpColor.setHex(0xd7cb90);
    if (vitality > 0.55) tmpColor.offsetHSL(0.012, 0.02, 0.016);
    if (sea > 0.05) tmpColor.offsetHSL(0.012, 0.05, -0.03);
    grassMesh.setColorAt(i, tmpColor);

    phases[i] = rand() * TAU;
    stiffs[i] = 0.65 + rand() * 0.8;
  }
  tuftGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  tuftGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(stiffs, 1));
  grassMesh.computeBoundingSphere();
  grassMesh.frustumCulled = false;
  group.add(grassMesh);

  /* 高草穗：地平线附近毛茸茸的一层 */
  const seedGeo = seedHeadGeoBase.clone();
  const seedPhases = new Float32Array(seedCount);
  const seedStiffs = new Float32Array(seedCount);
  const seedMesh = new THREE.InstancedMesh(seedGeo, seedHeadMaterial, seedCount);
  for (let i = 0; i < seedCount; i++) {
    const x = baseX + rand() * CHUNK;
    const z = baseZ + rand() * CHUNK;
    const y = heightAt(x, z);
    const clump = fbm(x * 0.046 + 9, z * 0.046 - 3, 3);
    const blocked = pathDistance(x, z) < 1.2 || insideFarmWork(x, z, 0.2) || iceDist(x, z) < 1.06;
    if (blocked || (clump < 0.45 && rand() < 0.65)) {
      dummy.position.set(x, -999, z);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      seedMesh.setMatrixAt(i, dummy.matrix);
      seedMesh.setColorAt(i, tmpColor.setHex(0x000000));
      seedPhases[i] = 0;
      seedStiffs[i] = 0;
      continue;
    }

    dummy.position.set(x, y, z);
    dummy.rotation.set((rand() - 0.5) * 0.1, rand() * TAU, (rand() - 0.5) * 0.1);
    const w = 0.4 + rand() * 0.3;
    const h = (0.62 + rand() * 0.52) * grazeFactor(x, z) * farmMowFactor(x, z);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    seedMesh.setMatrixAt(i, dummy.matrix);
    tmpColor.setHex([0xd6c891, 0xc9bb82, 0xdfd3a2, 0xb8af78][Math.floor(rand() * 4)])
      .offsetHSL((rand() - 0.5) * 0.015, 0, (rand() - 0.5) * 0.05);
    seedMesh.setColorAt(i, tmpColor);
    seedPhases[i] = rand() * TAU;
    seedStiffs[i] = 0.7 + rand() * 0.55;
  }
  seedGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(seedPhases, 1));
  seedGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(seedStiffs, 1));
  seedMesh.computeBoundingSphere();
  seedMesh.frustumCulled = false;
  group.add(seedMesh);

  /* 三叶草：贴地的低草层，填住草根之间的土 */
  const cloverGeo = cloverGeoBase.clone();
  const cloverPhases = new Float32Array(cloverCount);
  const cloverStiffs = new Float32Array(cloverCount);
  const cloverMesh = new THREE.InstancedMesh(cloverGeo, cloverMaterial, cloverCount);
  for (let i = 0; i < cloverCount; i++) {
    const x = baseX + rand() * CHUNK;
    const z = baseZ + rand() * CHUNK;
    const y = heightAt(x, z);
    const boost = meadowBoost(x, z);
    const sea = seaAt(x, z);
    const blocked = pathDistance(x, z) < 1.15 || insideFarmWork(x, z, 0.2) || iceDist(x, z) < 1.06;
    if (blocked || rand() > 0.62 + boost * 0.38 - sea * 0.26) {
      dummy.position.set(x, -999, z);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      cloverMesh.setMatrixAt(i, dummy.matrix);
      cloverMesh.setColorAt(i, tmpColor.setHex(0x000000));
      cloverPhases[i] = 0;
      cloverStiffs[i] = 0;
      continue;
    }

    dummy.position.set(x, y, z);
    dummy.rotation.set((rand() - 0.5) * 0.12, rand() * TAU, (rand() - 0.5) * 0.12);
    const w = (0.28 + rand() * 0.24) * (1 - sea * 0.5);
    const h = (0.1 + rand() * 0.12) * grazeFactor(x, z) * farmMowFactor(x, z);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    cloverMesh.setMatrixAt(i, dummy.matrix);
    tmpColor.setHex([0x9fb96b, 0x89aa58, 0xb2c982, 0x7f9e50][Math.floor(rand() * 4)])
      .offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.04 + sea * 0.04);
    cloverMesh.setColorAt(i, tmpColor);
    cloverPhases[i] = rand() * TAU;
    cloverStiffs[i] = 0.5 + rand() * 0.4;
  }
  cloverGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(cloverPhases, 1));
  cloverGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(cloverStiffs, 1));
  cloverMesh.computeBoundingSphere();
  cloverMesh.frustumCulled = false;
  group.add(cloverMesh);

  /* 花 */
  const stemGeo = stemGeoBase.clone();
  const stemPhases = new Float32Array(flowerCount);
  const stemStiffs = new Float32Array(flowerCount);
  const stemMesh = new THREE.InstancedMesh(stemGeo, stemMaterial, flowerCount);

  const buckets = [[], [], [], [], [], []];

  for (let i = 0; i < flowerCount; i++) {
    let x = baseX + rand() * CHUNK;
    let z = baseZ + rand() * CHUNK;
    let y = heightAt(x, z);

    const boost = meadowBoost(x, z);
    const keep = 0.42 + boost * 0.58;
    let sea = seaAt(x, z);
    const inYard = Math.abs(x - FARM.x) < FARM.halfX - 0.6 && Math.abs(z - FARM.z) < FARM.halfZ - 0.6;
    const blocked = pathDistance(x, z) < 1.25 || insideFarmWork(x, z, 0.25) || (inYard && rand() < 0.6) || iceDist(x, z) < 1.05;
    // 花海里几乎不留空：能开的地方都开满
    const keepAll = keep + sea * (1.02 - keep);
    if (blocked || rand() > keepAll) {
      dummy.position.set(x, -999, z);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      stemMesh.setMatrixAt(i, dummy.matrix);
      stemMesh.setColorAt(i, tmpColor.setHex(0x000000));
      stemPhases[i] = 0;
      stemStiffs[i] = 0;
      continue;
    }

    let kind;
    if (sea > 0.12) {
      // 花海：一大片一大片地同色，边缘才掺别的花
      const zone = seaZone(x, z);
      if (zone < 0.40) kind = 2;        // 粉色波斯菊
      else if (zone < 0.52) kind = 3;   // 白色碎花
      else if (zone < 0.62) kind = 5;   // 红罂粟
      else if (zone < 0.74) kind = 4;   // 蓝色勿忘我
      else if (zone < 0.88) kind = 1;   // 黄色毛茛
      else kind = 0;                    // 白雏菊
      // 一片只留一个主色 + 一个固定的点缀色，别把六种花搅在一起
      const accent = kind === 2 ? 3 : kind === 5 ? 3 : kind === 4 ? 0 : kind === 1 ? 0 : 2;
      const mixRate = 0.02 + (1 - sea) * 0.10;
      if (rand() < mixRate) kind = accent;
    } else {
      const drift = fbm(x * 0.016 + 21, z * 0.016 - 5, 3) + (rand() - 0.5) * 0.06;
      if (drift < 0.36) kind = 0;
      else if (drift < 0.50) kind = 1;
      else if (drift < 0.60) kind = 2;
      else if (drift < 0.70) kind = 3;
      else if (drift < 0.82) kind = 4;
      else kind = 5;
    }

    const cluster = fbm(x * 0.035 + 31, z * 0.035 - 12, 3);
    if (cluster < 0.36 && rand() < 0.45) {
      x = baseX + rand() * CHUNK;
      z = baseZ + rand() * CHUNK;
      y = heightAt(x, z);
      sea = seaAt(x, z);
    }

    // 高矮分层：花海里绝大多数是矮花，插一小撮高花，才有前景/中景的纵深
    let stemH;
    if (sea > 0.25) {
      stemH = rand() < 0.16 ? 0.78 + rand() * 0.36 : 0.26 + rand() * 0.13;
    } else {
      const tall = rand() < 0.12;
      stemH = tall ? 0.52 + rand() * 0.22 : 0.26 + rand() * 0.15;
    }
    stemH *= 1 + sea * 0.22;
    const headSize = Math.min(0.2, ((kind === 3 || kind === 4 || kind === 5 ? 0.15 : stemH > 0.6 ? 0.145 : 0.11) + rand() * 0.035)
      * (1 + sea * 0.2));
    const phase = rand() * TAU;

    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rand() * TAU, 0);
    dummy.scale.set(1, Math.max(0.0001, stemH), 1);
    dummy.updateMatrix();
    stemMesh.setMatrixAt(i, dummy.matrix);
    stemMesh.setColorAt(i, tmpColor.setHex(0x5e7233).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.08));

    buckets[kind].push({
      x,
      y: y + stemH,
      z,
      headSize,
      rot: [(rand() - 0.5) * 0.4, rand() * TAU, (rand() - 0.5) * 0.28],
      color: flowerPalettes[kind][Math.floor(rand() * flowerPalettes[kind].length)],
    });

    stemPhases[i] = phase;
    stemStiffs[i] = 0.85 + rand() * 0.4;
  }

  stemGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(stemPhases, 1));
  stemGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(stemStiffs, 1));
  stemMesh.computeBoundingSphere();
  stemMesh.frustumCulled = false;
  group.add(stemMesh);

  for (let k = 0; k < 6; k++) {
    const list = buckets[k];
    if (!list.length) continue;
    const headGeo = headGeoBase.clone();
    const mesh = new THREE.InstancedMesh(headGeo, flowerMaterials[k], list.length);
    const ph = new Float32Array(list.length);
    const st = new Float32Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      dummy.position.set(f.x, f.y, f.z);
      dummy.rotation.set(f.rot[0], f.rot[1], f.rot[2]);
      dummy.scale.setScalar(f.headSize);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tmpColor.setHex(f.color));
      ph[i] = headPhases(i);
      st[i] = 0.9 + ((i * 0.37) % 0.4);
    }
    headGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    headGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(st, 1));
    mesh.computeBoundingSphere();
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  /* 花海底层的碎花：矮矮地贴在地面，把花茎之间的缝补满 */
  if (seaK > 0.05) {
    const lowCount = Math.round(seaK * 3000);
    const lowGeo = headGeoBase.clone();
    const lowMesh = new THREE.InstancedMesh(lowGeo, flowerMaterials[3], lowCount);
    const lowPhases = new Float32Array(lowCount);
    const lowStiffs = new Float32Array(lowCount);
    const lowTints = [
      [0xf3bcca, 0xeeabc0], [0xfff8f4, 0xfbecef], [0xd8583c],
      [0xb8ccef], [0xf6d268], [0xffffff],
    ];
    for (let i = 0; i < lowCount; i++) {
      const x = baseX + rand() * CHUNK;
      const z = baseZ + rand() * CHUNK;
      const y = heightAt(x, z);
      const sea = seaAt(x, z);
      const show = sea > 0.22;
      dummy.position.set(x, show ? y + 0.10 + rand() * 0.24 : -999, z);
      dummy.rotation.set((rand() - 0.5) * 0.5, rand() * TAU, (rand() - 0.5) * 0.5);
      dummy.scale.setScalar((0.13 + rand() * 0.10) * (show ? 1 : 0.0001));
      dummy.updateMatrix();
      lowMesh.setMatrixAt(i, dummy.matrix);
      const zone = seaZone(x, z);
      const zp = zone < 0.40 ? 0 : zone < 0.55 ? 1 : zone < 0.63 ? 2 : zone < 0.72 ? 3 : zone < 0.86 ? 4 : 5;
      const pal = lowTints[rand() < 0.82 ? zp : Math.floor(rand() * 6)];
      lowMesh.setColorAt(i, tmpColor.setHex(pal[Math.floor(rand() * pal.length)]));
      lowPhases[i] = rand() * TAU;
      lowStiffs[i] = 0.75 + rand() * 0.3;
    }
    lowGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(lowPhases, 1));
    lowGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(lowStiffs, 1));
    lowMesh.computeBoundingSphere();
    lowMesh.frustumCulled = false;
    group.add(lowMesh);
  }

  /* 花根下的绿叶地毯：矮、宽、密，专门用来盖住花茎之间露出来的土 */
  if (seaK > 0.12) {
    const leafCount = Math.round(seaK * 3000);
    const leafGeo = cloverGeoBase.clone();
    const leafMesh = new THREE.InstancedMesh(leafGeo, cloverMaterial, leafCount);
    const leafPhases = new Float32Array(leafCount);
    const leafStiffs = new Float32Array(leafCount);
    const greens = [0x6f8c3c, 0x7d9a45, 0x64803a, 0x88a24f, 0x5d7636];
    for (let i = 0; i < leafCount; i++) {
      const x = baseX + rand() * CHUNK;
      const z = baseZ + rand() * CHUNK;
      const y = heightAt(x, z);
      const sea = seaAt(x, z);
      const show = sea > 0.3;
      dummy.position.set(x, show ? y + 0.03 : -999, z);
      // 平铺在地上（不是竖着插），一片就能盖住半平米
      dummy.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.22, rand() * TAU, 0);
      const wide = 0.5 + rand() * 0.42;
      dummy.scale.set(wide, show ? wide * (0.8 + rand() * 0.4) : 0.0001, wide);
      dummy.updateMatrix();
      leafMesh.setMatrixAt(i, dummy.matrix);
      leafMesh.setColorAt(i, tmpColor.setHex(greens[Math.floor(rand() * greens.length)])
        .offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.06));
      leafPhases[i] = rand() * TAU;
      leafStiffs[i] = 0.35 + rand() * 0.3;
    }
    leafGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(leafPhases, 1));
    leafGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(leafStiffs, 1));
    leafMesh.computeBoundingSphere();
    leafMesh.frustumCulled = false;
    group.add(leafMesh);
  }

  /* 落花：被风吹下来的花瓣，铺在花根之间，近看才有的一层细节 */
  if (seaK > 0.08) {
    const petalCount = Math.round(seaK * 2200);
    const petalGeo = petalGeoBase.clone();
    const petalMesh = new THREE.InstancedMesh(petalGeo, flowerMaterials[2], petalCount);
    const petalPhases = new Float32Array(petalCount);
    const petalStiffs = new Float32Array(petalCount);
    const tints = [0xf3bcca, 0xfff8f4, 0xf6d268, 0xd8583c, 0xb8ccef, 0xeeabc0];
    for (let i = 0; i < petalCount; i++) {
      const x = baseX + rand() * CHUNK;
      const z = baseZ + rand() * CHUNK;
      const y = heightAt(x, z);
      const inSea = seaAt(x, z) > 0.14;
      dummy.position.set(x, inSea ? y + 0.055 : -999, z);
      dummy.rotation.set((rand() - 0.5) * 0.16, rand() * TAU, (rand() - 0.5) * 0.16);
      dummy.scale.setScalar((0.07 + rand() * 0.09) * (inSea ? 1 : 0.0001));
      dummy.updateMatrix();
      petalMesh.setMatrixAt(i, dummy.matrix);
      petalMesh.setColorAt(i, tmpColor.setHex(tints[Math.floor(rand() * tints.length)]));
      petalPhases[i] = rand() * TAU;
      petalStiffs[i] = 0.04;
    }
    petalGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(petalPhases, 1));
    petalGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(petalStiffs, 1));
    petalMesh.computeBoundingSphere();
    petalMesh.frustumCulled = false;
    group.add(petalMesh);
  }

  /* 碎石：花海里零星的小石头，脚边才有的一层 */
  if (seaK > 0.12) {
    const stoneCount = Math.round(seaK * 420);
    const stoneGeo = new THREE.SphereGeometry(1, 6, 4);
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0x9b978c });
    const stoneMesh = new THREE.InstancedMesh(stoneGeo, stoneMat, stoneCount);
    const stoneTints = [0x9b978c, 0x8b877c, 0xa9a396, 0x77736a];
    for (let i = 0; i < stoneCount; i++) {
      const x = baseX + rand() * CHUNK;
      const z = baseZ + rand() * CHUNK;
      const y = heightAt(x, z);
      const show = seaAt(x, z) > 0.3;
      const r = 0.05 + rand() * 0.12;
      dummy.position.set(x, show ? y + r * 0.35 : -999, z);
      dummy.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
      dummy.scale.set(r, show ? r * 0.55 : 0.0001, r * (0.8 + rand() * 0.5));
      dummy.updateMatrix();
      stoneMesh.setMatrixAt(i, dummy.matrix);
      stoneMesh.setColorAt(i, tmpColor.setHex(stoneTints[Math.floor(rand() * stoneTints.length)]));
    }
    stoneMesh.computeBoundingSphere();
    stoneMesh.frustumCulled = false;
    group.add(stoneMesh);
  }

  /* 落叶：铺在花根之间的褐叶，和花瓣混着来 */
  if (seaK > 0.08) {
    const fallenCount = Math.round(seaK * 1100);
    const fallenGeo = petalGeoBase.clone();
    const fallenMesh = new THREE.InstancedMesh(fallenGeo, fallenLeafMat, fallenCount);
    const fallenPhases = new Float32Array(fallenCount);
    const fallenStiffs = new Float32Array(fallenCount);
    const leafTints = [0xb57a3e, 0xc08c4c, 0x8f6634, 0xd6a45c, 0xa06030, 0xcaa060];
    for (let i = 0; i < fallenCount; i++) {
      const x = baseX + rand() * CHUNK;
      const z = baseZ + rand() * CHUNK;
      const y = heightAt(x, z);
      const inSea = seaAt(x, z) > 0.14;
      dummy.position.set(x, inSea ? y + 0.062 : -999, z);
      dummy.rotation.set(-Math.PI / 2 + (rand() - 0.5) * 0.3, rand() * TAU, 0);
      const sz = 0.16 + rand() * 0.15;
      dummy.scale.set(sz, inSea ? sz * (0.85 + rand() * 0.3) : 0.0001, sz);
      dummy.updateMatrix();
      fallenMesh.setMatrixAt(i, dummy.matrix);
      fallenMesh.setColorAt(i, tmpColor.setHex(leafTints[Math.floor(rand() * leafTints.length)])
        .offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.06));
      fallenPhases[i] = rand() * TAU;
      fallenStiffs[i] = 0;
    }
    fallenGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(fallenPhases, 1));
    fallenGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(fallenStiffs, 1));
    fallenMesh.computeBoundingSphere();
    fallenMesh.frustumCulled = false;
    group.add(fallenMesh);
  }

  /* 松林：成片长在坡上，冰面、雪道、农场里不长 */
  const pineHere = pineDensity(baseX + CHUNK * 0.5, baseZ + CHUNK * 0.5);
  if (pineHere > 0.03) {
    const want = Math.round(pineHere * 17);
    const mats = [];
    const cols = [];
    const spots = [];
    for (let i = 0; i < want; i++) {
      const x = baseX + rand() * CHUNK;
      const z = baseZ + rand() * CHUNK;
      if (pineDensity(x, z) < 0.12) continue;
      if (pathDistance(x, z) < 2.4 || iceDist(x, z) < 1.12) continue;
      const y = heightAt(x, z);
      const scl = 0.85 + rand() * 1.05;
      dummy.position.set(x, y - 0.05, z);
      dummy.rotation.set((rand() - 0.5) * 0.06, rand() * TAU, (rand() - 0.5) * 0.06);
      dummy.scale.set(scl * (0.9 + rand() * 0.2), scl * (0.92 + rand() * 0.3), scl * (0.9 + rand() * 0.2));
      dummy.updateMatrix();
      mats.push(dummy.matrix.clone());
      cols.push(tmpColor.setHex(0xffffff)
        .offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.07).clone());
      spots.push([x, z]);
    }
    if (mats.length) {
      const mesh = new THREE.InstancedMesh(pineGeo, pineMat, mats.length);
      for (let i = 0; i < mats.length; i++) {
        mesh.setMatrixAt(i, mats[i]);
        mesh.setColorAt(i, cols[i]);
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      mesh.frustumCulled = false;
      group.add(mesh);
      pineSpots.set(pineKey(cx, cz), spots);
    }
  }

  return { group, cx, cz };
}

function headPhases(i) {
  return (i * 2.399) % TAU;
}

let lastCx = NaN;
let lastCz = NaN;
let pendingQueue = [];

function ensureChunks(px, pz, budget = 2) {
  const ccx = Math.floor(px / CHUNK);
  const ccz = Math.floor(pz / CHUNK);

  if (ccx !== lastCx || ccz !== lastCz) {
    lastCx = ccx;
    lastCz = ccz;

    const wanted = [];
    for (let dz = -RINGS; dz <= RINGS; dz++) {
      for (let dx = -RINGS; dx <= RINGS; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (RINGS + 0.55) * (RINGS + 0.55)) continue;
        const cx = ccx + dx;
        const cz = ccz + dz;
        const key = cx + ',' + cz;
        if (chunks.has(key)) continue;
        wanted.push({ cx, cz, key, ring: Math.max(Math.abs(dx), Math.abs(dz)), d2 });
      }
    }
    wanted.sort((a, b) => a.d2 - b.d2);
    pendingQueue = wanted;

    for (const [key, chunk] of chunks) {
      if (Math.abs(chunk.cx - ccx) > RINGS + 1 || Math.abs(chunk.cz - ccz) > RINGS + 1) {
        scene.remove(chunk.group);
        chunk.group.traverse((o) => {
          if (o.isInstancedMesh) o.geometry.dispose();
        });
        chunks.delete(key);
      }
    }
  }

  let n = 0;
  while (pendingQueue.length && n < budget) {
    const item = pendingQueue.shift();
    if (!chunks.has(item.key)) {
      chunks.set(item.key, buildChunk(item.cx, item.cz, item.ring));
      scene.add(chunks.get(item.key).group);
    }
    n++;
  }
}

/* =========================================================
   7. 花粉 / 蝴蝶
   ========================================================= */

const POLLEN_COUNT = 2200;
const pollenPositions = new Float32Array(POLLEN_COUNT * 3);
const pollenSeeds = new Float32Array(POLLEN_COUNT);
const pollenGround = new Float32Array(POLLEN_COUNT);
{
  const rand = mulberry32(771);
  for (let i = 0; i < POLLEN_COUNT; i++) {
    const x = (rand() - 0.5) * 80;
    const z = (rand() - 0.5) * 80;
    const g = heightAt(x, z);
    pollenPositions[i * 3] = x;
    pollenPositions[i * 3 + 1] = g + 0.2 + rand() * 2.8;
    pollenPositions[i * 3 + 2] = z;
    pollenSeeds[i] = rand() * TAU;
    pollenGround[i] = g;
  }
}
const pollenGeo = new THREE.BufferGeometry();
pollenGeo.setAttribute('position', new THREE.BufferAttribute(pollenPositions, 3));
const pollenMat = new THREE.PointsMaterial({
  size: 0.075,
  map: makePollenTexture(),
  transparent: true,
  depthWrite: false,
  opacity: 0.85,
  color: 0xf8fcff,
  sizeAttenuation: true,
  blending: THREE.NormalBlending,
});
const pollen = new THREE.Points(pollenGeo, pollenMat);
pollen.frustumCulled = false;
scene.add(pollen);

const butterflies = [];
{
  const rand = mulberry32(818);
  const tex = makeButterflyTexture();
  const spots = [];
  for (const m of MEADOWS) {
    for (let i = 0; i < 3; i++) {
      spots.push([m.x + (rand() - 0.5) * m.r * 1.6, m.z + (rand() - 0.5) * m.r * 1.6]);
    }
  }
  // 花海是蝴蝶最密的地方
  for (let i = 0; i < 16; i++) {
    const a = rand() * TAU;
    const r = Math.sqrt(rand()) * FLOWER_SEA.r * 0.92;
    spots.push([FLOWER_SEA.x + Math.cos(a) * r, FLOWER_SEA.z + Math.sin(a) * r]);
  }
  const colors = [0xf3ead0, 0xf0dfa8, 0xefd3d8, 0xe4e0f0, 0xf3d9bc];
  for (let i = 0; i < spots.length; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: colors[Math.floor(rand() * colors.length)],
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    });
    const sprite = new THREE.Sprite(mat);
    const baseScale = 0.09 + rand() * 0.055;
    sprite.scale.setScalar(baseScale);
    scene.add(sprite);
    butterflies.push({
      sprite,
      hx: spots[i][0],
      hz: spots[i][1],
      ph: rand() * TAU,
      speed: 0.18 + rand() * 0.16,
      flap: 7 + rand() * 5,
      baseScale,
      yOff: 0.5 + rand() * 1.1,
    });
  }
}

/* ---------------- 蜜蜂：在花丛之间短距离悬停 ---------------- */
const bees = [];
{
  const rand = mulberry32(991);
  const tex = makeBeeTexture();
  for (let i = 0; i < 30; i++) {
    // 三分之一留在花海，其余分散在各个小花丛
    const m = i % 3 === 0
      ? {
          x: FLOWER_SEA.x + (rand() - 0.5) * FLOWER_SEA.r * 1.5,
          z: FLOWER_SEA.z + (rand() - 0.5) * FLOWER_SEA.r * 1.5,
          r: 1.4,
        }
      : MEADOWS[Math.floor(rand() * MEADOWS.length)];
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    });
    const sprite = new THREE.Sprite(mat);
    const baseScale = 0.085 + rand() * 0.035;
    sprite.scale.setScalar(baseScale);
    scene.add(sprite);
    bees.push({
      sprite,
      hx: m.x + (rand() - 0.5) * m.r,
      hz: m.z + (rand() - 0.5) * m.r,
      ph: rand() * TAU,
      speed: 1.0 + rand() * 1.4,
      radius: 0.35 + rand() * 0.7,
      baseScale,
      yOff: 0.45 + rand() * 0.5,
    });
  }
}

/* ---------------- 土路上的碎石：半埋在土里，近看才有的颗粒 ---------------- */
{
  const rand = mulberry32(6060);
  const lines = [PATH_POINTS, INNER_PATH_POINTS];
  const segs = [];
  let total = 0;
  for (const pts of lines) {
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      segs.push({ a: pts[i], b: pts[i + 1], len, start: total });
      total += len;
    }
  }

  const COUNT = 460;
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0.0 });
  const stones = new THREE.InstancedMesh(geo, mat, COUNT);
  const stoneColors = [0x8b7f6b, 0x9c907a, 0x776e5d, 0xa89b83, 0x6f695c];
  for (let i = 0; i < COUNT; i++) {
    let pick = segs[segs.length - 1];
    const d = rand() * total;
    for (const s of segs) {
      if (d >= s.start && d < s.start + s.len) { pick = s; break; }
    }
    const t = rand();
    const x = pick.a[0] + (pick.b[0] - pick.a[0]) * t;
    const z = pick.a[1] + (pick.b[1] - pick.a[1]) * t;
    const nx = -(pick.b[1] - pick.a[1]) / pick.len;
    const nz = (pick.b[0] - pick.a[0]) / pick.len;
    const off = (rand() - 0.5) * 1.7;
    const px = x + nx * off;
    const pz = z + nz * off;
    const big = rand() < 0.10 ? 1.6 + rand() * 0.8 : 1;
    const s = (0.022 + rand() * 0.045) * big;
    dummy.position.set(px, heightAt(px, pz) + s * 0.25, pz);
    dummy.rotation.set(rand() * TAU, rand() * TAU, rand() * TAU);
    dummy.scale.set(s, s * 0.55, s * (0.8 + rand() * 0.5));
    dummy.updateMatrix();
    stones.setMatrixAt(i, dummy.matrix);
    stones.setColorAt(i, tmpColor.setHex(stoneColors[Math.floor(rand() * stoneColors.length)])
      .offsetHSL(0, 0, (rand() - 0.5) * 0.06));
  }
  stones.computeBoundingSphere();
  stones.frustumCulled = false;
  scene.add(stones);
}

/* ---------------- 蒲公英种子：白天慢慢飘 ---------------- */
const DANDELION_COUNT = 460;
const dandelionPositions = new Float32Array(DANDELION_COUNT * 3);
const dandelionSeeds = new Float32Array(DANDELION_COUNT);
const dandelionGround = new Float32Array(DANDELION_COUNT);
{
  const rand = mulberry32(663);
  for (let i = 0; i < DANDELION_COUNT; i++) {
    const x = (rand() - 0.5) * 76;
    const z = 8 + (rand() - 0.5) * 76;
    const g = heightAt(x, z);
    dandelionPositions[i * 3] = x;
    dandelionPositions[i * 3 + 1] = g + 0.4 + rand() * 2.4;
    dandelionPositions[i * 3 + 2] = z;
    dandelionSeeds[i] = rand() * TAU;
    dandelionGround[i] = g;
  }
}
const dandelionGeo = new THREE.BufferGeometry();
dandelionGeo.setAttribute('position', new THREE.BufferAttribute(dandelionPositions, 3));
const dandelionMat = new THREE.PointsMaterial({
  size: 0.22,
  map: makeDandelionTexture(),
  transparent: true,
  depthWrite: false,
  opacity: 0.9,
  color: 0xfbfdff,
  sizeAttenuation: true,
  blending: THREE.NormalBlending,
});
const dandelions = new THREE.Points(dandelionGeo, dandelionMat);
dandelions.frustumCulled = false;
scene.add(dandelions);

/* ---------------- 萤火虫：天黑了才出来，成群结队地亮 ---------------- */
const FIREFLY_COUNT = 240;   // 雪原没有萤火虫，只有一点点浮在草窝上的雪光
const FIREFLY_CLUSTERS = 7;
const fireflyCenters = [
  { x: MEADOWS[0].x, z: MEADOWS[0].z, r: 3.4 },
  { x: MEADOWS[1].x + 2, z: MEADOWS[1].z - 2, r: 2.6 },
  { x: MEADOWS[2].x - 3, z: MEADOWS[2].z + 2, r: 2.8 },
  { x: MEADOWS[7].x + 1, z: MEADOWS[7].z - 3, r: 3.2 },
  { x: FARM.x + FARM.halfX + 3.5, z: FARM.z - FARM.halfZ - 2.5, r: 2.4 },
  { x: PATH_POINTS[3][0] + 2, z: PATH_POINTS[3][1] + 1.5, r: 2.2 },
  { x: FLOWER_SEA.x, z: FLOWER_SEA.z, r: 4.6 },
];
const fireflyGeo = new THREE.BufferGeometry();
{
  const rnd = mulberry32(8128);
  const pos = new Float32Array(FIREFLY_COUNT * 3);
  const phase = new Float32Array(FIREFLY_COUNT);
  const size = new Float32Array(FIREFLY_COUNT);
  const cluster = new Float32Array(FIREFLY_COUNT);
  const kick = new Float32Array(FIREFLY_COUNT);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const ci = i % FIREFLY_CLUSTERS;
    const c = fireflyCenters[ci];
    const r = Math.sqrt(rnd()) * c.r * 2.1;
    const a = rnd() * TAU;
    const x = c.x + Math.cos(a) * r;
    const z = c.z + Math.sin(a) * r;
    pos[i * 3] = x;
    pos[i * 3 + 1] = heightAt(x, z) + 0.35 + rnd() * 1.9;
    pos[i * 3 + 2] = z;
    phase[i] = rnd();
    size[i] = 1.0 + rnd() * 1.1;
    cluster[i] = ci;
    kick[i] = rnd() * TAU;
  }
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fireflyGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  fireflyGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  fireflyGeo.setAttribute('aCluster', new THREE.BufferAttribute(cluster, 1));
  fireflyGeo.setAttribute('aKick', new THREE.BufferAttribute(kick, 1));
}

const fireflyMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: sharedUniforms.uTime,
    uOpacity: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */ `
    uniform float uTime;
    uniform float uPixelRatio;
    attribute float aPhase;
    attribute float aSize;
    attribute float aCluster;
    attribute float aKick;
    varying float vGlow;
    varying vec3 vHue;

    void main() {
      vec3 p = position;
      p.x += sin(uTime * 0.29 + aPhase * 21.0) * 0.55;
      p.z += cos(uTime * 0.25 + aPhase * 17.0) * 0.55;
      p.y += sin(uTime * 0.43 + aPhase * 31.0) * 0.24;

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;

      // 同一窝的萤火虫周期一致，只差一点相位：看起来像一片在呼吸
      float pulse = 0.5 + 0.5 * sin(uTime * (1.2 + aCluster * 0.19) + aCluster * 2.3 + aKick * 0.55);
      vGlow = 0.12 + 0.88 * pow(pulse, 2.4);
      vHue = mix(vec3(0.58, 0.82, 1.0), vec3(0.86, 0.95, 1.0), fract(aPhase * 7.3));
      gl_PointSize = aSize * uPixelRatio * 16.0 / max(-mv.z, 0.5);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    varying float vGlow;
    varying vec3 vHue;

    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float glow = smoothstep(0.5, 0.0, length(uv));
      glow = pow(glow, 2.2);
      float a = glow * vGlow * uOpacity;
      if (a < 0.003) discard;
      // 亮度别给太满：加法混合下 1200 个点叠在一起，核会先炸成白团，
      // 光晕交给 Bloom 去做，核留一点绿黄
      gl_FragColor = vec4(vHue * a * 1.35, a);
    }
  `,
});

const fireflies = new THREE.Points(fireflyGeo, fireflyMat);
fireflies.frustumCulled = false;
scene.add(fireflies);
let fireflyActive = false;

function updateFireflies(t, dt) {
  if (fireflyMat.uniforms.uOpacity.value <= 0.02) {
    fireflyActive = false;
    return;
  }
  const arr = fireflyGeo.attributes.position.array;
  const camX = camera.position.x;
  const camZ = camera.position.z;

  // 窝离镜头太远就慢慢挪过来：走到哪儿都有几群萤火虫
  for (const c of fireflyCenters) {
    if (c.gy === undefined) c.gy = heightAt(c.x, c.z);
    const d = Math.hypot(c.x - camX, c.z - camZ);
    if (d > 44) {
      const k = Math.min(1, ((d - 44) / d) * dt * 0.9);
      c.x += (camX - c.x) * k;
      c.z += (camZ - c.z) * k;
      c.gy = heightAt(c.x, c.z);
    }
  }

  if (!fireflyActive) {
    fireflyActive = true;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const ix = i * 3;
      const c = fireflyCenters[i % FIREFLY_CLUSTERS];
      const r = Math.sqrt(Math.random()) * c.r * 2.1;
      const a = Math.random() * TAU;
      arr[ix] = c.x + Math.cos(a) * r;
      arr[ix + 2] = c.z + Math.sin(a) * r;
      arr[ix + 1] = c.gy + 0.35 + Math.random() * 1.9;
    }
    fireflyGeo.attributes.position.needsUpdate = true;
    return;
  }

  const pull = Math.min(1, dt * 0.5);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const ix = i * 3;
    const c = fireflyCenters[i % FIREFLY_CLUSTERS];
    arr[ix] += (0.055 + Math.sin(t * 0.21 + i) * 0.05) * dt + (c.x - arr[ix]) * pull;
    arr[ix + 2] += Math.cos(t * 0.17 + i * 1.7) * 0.05 * dt + (c.z - arr[ix + 2]) * pull;
    arr[ix + 1] += (c.gy + 1.1 - arr[ix + 1]) * Math.min(1, dt * 0.6);
  }
  fireflyGeo.attributes.position.needsUpdate = true;
}

/* ---------------- 贴地薄雾：只在清晨铺在草上 ---------------- */
const mistUniforms = {
  uTime: sharedUniforms.uTime,
  uOpacity: { value: 0 },
  uColor: { value: new THREE.Color(0xc9d8dd) },
  uWarm: { value: new THREE.Color(0xffd7ab) },
  uSunDir: sharedUniforms.uSunDir,
  uSunColor: sharedUniforms.uSunColor,
};

const mistMat = new THREE.ShaderMaterial({
  uniforms: mistUniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uOpacity;
    uniform vec3 uColor;
    uniform vec3 uWarm;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    varying vec2 vUv;
    varying vec3 vWorld;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.07 + vec2(11.3, 7.7);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 p = vWorld.xz * 0.055;
      float n = fbm(p + vec2(uTime * 0.006, uTime * 0.004)) * 0.65
              + fbm(p * 2.6 - vec2(uTime * 0.009, 0.0)) * 0.35;
      float r = length(vUv - 0.5) * 2.0;
      float edge = smoothstep(1.0, 0.22, r);
      float hole = smoothstep(0.015, 0.16, r);   // 贴脸那一圈不要糊住镜头
      float a = smoothstep(0.36, 0.72, n) * edge * hole * uOpacity;
      if (a < 0.004) discard;

      vec2 toCam = normalize(cameraPosition.xz - vWorld.xz + vec2(0.0001));
      float warm = pow(max(dot(normalize(uSunDir.xz + vec2(0.0001)), toCam), 0.0), 2.0);
      vec3 col = mix(uColor, uWarm, warm * 0.85);
      col = mix(col, col * 0.9 + uSunColor * 0.10, 0.45);
      gl_FragColor = vec4(col, a);
    }
  `,
});

const mistLayers = [];
for (let i = 0; i < 3; i++) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), mistMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;
  scene.add(mesh);
  mistLayers.push(mesh);
}

function updateMist(t) {
  const op = mistUniforms.uOpacity.value;
  const on = op > 0.005;
  for (let i = 0; i < mistLayers.length; i++) {
    const mesh = mistLayers[i];
    mesh.visible = on;
    if (!on) continue;
    const gx = camera.position.x;
    const gz = camera.position.z;
    mesh.position.set(gx, heightAt(gx, gz) + 0.45 + i * 0.8, gz);
    mesh.rotation.z = t * 0.006 * (i % 2 ? -1 : 1);
  }
}

/* ---------------- 蝙蝠：接蝴蝶的夜班 ---------------- */
function makeBatTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#15111b';
  ctx.beginPath();
  ctx.ellipse(S / 2, S * 0.52, 5.5, 13, 0, 0, TAU);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(S / 2, S * 0.48);
    ctx.quadraticCurveTo(S / 2 + s * 20, S * 0.33, S / 2 + s * 52, S * 0.5);
    ctx.quadraticCurveTo(S / 2 + s * 33, S * 0.5, S / 2 + s * 28, S * 0.64);
    ctx.quadraticCurveTo(S / 2 + s * 17, S * 0.54, S / 2, S * 0.56);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const bats = [];
{
  const rand = mulberry32(313);
  const tex = makeBatTexture();
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    });
    const sprite = new THREE.Sprite(mat);
    const scale = 0.26 + rand() * 0.12;
    sprite.scale.setScalar(scale);
    sprite.visible = false;
    scene.add(sprite);
    bats.push({
      sprite,
      cx: FARM.x + (rand() - 0.5) * 20,
      cz: FARM.z + (rand() - 0.5) * 20,
      radius: 5 + rand() * 9,
      height: 7 + rand() * 5,
      speed: 0.32 + rand() * 0.32,
      flap: 9 + rand() * 6,
      ph: rand() * TAU,
      scale,
    });
  }
}

/* =========================================================
   8. 雪原自己的地方：猎屋、温泉、冰钓屋、雪人、雪橇、白狐
   ========================================================= */

// 雪原没有农场。草原那套菜地交互代码还挂在上面，这里留一个够不着的空壳，
// 既不会报错，也不会在雪地里长出胡萝卜。
const FAR = { x: 1e6, z: 1e6 };
const farm = {
  beds: [], cart: [0, 0, 0], storage: [0, 0, 0], cartCap: 18, canMax: 8,
  storageBin: FAR, door: FAR, bench: { x: 1e6, z: 1e6, yaw: 0 }, well: FAR,
  cartWorld: FAR, clickTargets: [], floorLift: () => 0,
  update() {}, setNight() {}, setPushing() {},
  getSelected: () => 0, setSelected() {},
  waterCharges: () => 0, fillCan() {}, cartLoad: () => 0, unloadCart: () => false,
  isInsideBarn: () => false, isDoorOpen: () => false, toggleDoor: () => false,
  pushDoor() {}, closeDoor() {}, moveCart() {}, nearestBed: () => null,
  bedProgress: () => 0, harvestBed: () => null, collectProduce() {},
  interact: () => ({ type: 'none' }), resolve: (x, z) => ({ x, z }), pollEvents: () => [],
  serialize: () => ({}), restore: () => false,
};

const CROPS = [{ name: '' }, { name: '' }, { name: '' }];

const snowPlaces = createSnowPlaces(scene, { heightAt, iceDist, ICE });

let audioCtx = null;
let animalCallReady = true;

function spatialParams(animal) {
  const dx = animal.x - camera.position.x;
  const dz = animal.z - camera.position.z;
  const dist = Math.hypot(dx, dz);
  const pan = clamp(
    (dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw)) / Math.max(dist, 0.1),
    -1,
    1
  );
  const vol = Math.pow(clamp(1 - dist / 42, 0, 1), 1.5);
  return { dist, pan, vol };
}

function makePanner(pan) {
  if (!audioCtx || !audioCtx.createStereoPanner) return null;
  const p = audioCtx.createStereoPanner();
  p.pan.value = pan;
  p.connect(masterGain);
  return p;
}

function playAnimalSound(kind, animal) {
  if (!audioCtx || muted || !animalCallReady || !animal) return;
  animalCallReady = false;
  setTimeout(() => { animalCallReady = true; }, 420);

  const { pan, vol } = spatialParams(animal);
  if (vol < 0.03) return;

  const t = audioCtx.currentTime;
  const out = makePanner(pan) || masterGain;
  const gain = audioCtx.createGain();
  const formant = audioCtx.createBiquadFilter();
  const lp = audioCtx.createBiquadFilter();
  formant.type = 'bandpass';
  lp.type = 'lowpass';
  gain.connect(out);

  const osc = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain2 = audioCtx.createGain();
  const vib = audioCtx.createOscillator();
  const vibGain = audioCtx.createGain();
  vib.connect(vibGain);
  vib.start(t);

  if (kind === 'sheep') {
    const base = 395 + (animal.seed % 5) * 28 + Math.random() * 34;
    osc.type = 'sawtooth';
    osc2.type = 'triangle';
    osc2.frequency.value = base * 0.5;
    gain2.gain.value = 0.012 * vol;
    formant.frequency.value = 1020;
    formant.Q.value = 2.3;
    lp.frequency.value = 2350;
    vib.frequency.value = 7.4;
    vibGain.gain.value = base * 0.022;
    vibGain.connect(osc.frequency);

    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.24, t + 0.09);
    osc.frequency.exponentialRampToValueAtTime(base * 0.72, t + 0.44);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.086 * vol, t + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);

    osc.connect(formant).connect(lp).connect(gain);
    osc2.connect(gain2).connect(lp);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + 0.52);
    osc2.stop(t + 0.52);
    vib.stop(t + 0.55);
  } else {
    const base = 138 + (animal.seed % 4) * 9 + Math.random() * 12;
    osc.type = 'triangle';
    osc2.type = 'sawtooth';
    osc2.frequency.value = base * 1.006;
    gain2.gain.value = 0.02 * vol;
    formant.frequency.value = 520;
    formant.Q.value = 1.9;
    lp.frequency.value = 1150;
    vib.frequency.value = 4.6;
    vibGain.gain.value = base * 0.018;
    vibGain.connect(osc.frequency);

    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * 1.1, t + 0.14);
    osc.frequency.linearRampToValueAtTime(base * 0.78, t + 0.82);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.105 * vol, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.12);

    osc.connect(formant).connect(lp).connect(gain);
    osc2.connect(gain2).connect(formant);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + 1.15);
    osc2.stop(t + 1.15);
    vib.stop(t + 1.2);
  }
}

function playAnimalStep(animal) {
  if (!audioCtx || muted || !stepBuffer) return;
  const { dist, pan, vol } = spatialParams(animal);
  if (dist > 12 || vol < 0.12) return;
  const t = audioCtx.currentTime;
  const out = makePanner(pan) || masterGain;
  const src = audioCtx.createBufferSource();
  src.buffer = stepBuffer;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 760 + Math.random() * 340;
  bp.Q.value = 0.8;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.018 * vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + 0.15);
}

const herd = { animals: [], update() {} };

/* =========================================================
   9. 玩家
   ========================================================= */

const EYE = 1.64;
const PLAYER_R = 0.34;
const SPAWN = { x: 0, z: 8 };
const player = { x: SPAWN.x, z: SPAWN.z, yaw: 0, pitch: -0.02, vx: 0, vz: 0, bob: 0 };
let camY = heightAt(player.x, player.z) + EYE;
{
  const dx = FARM.x - player.x;
  const dz = FARM.z - player.z;
  player.yaw = Math.atan2(-dx, -dz);
}

/* =========================================================
   10. 输入 / HUD
   ========================================================= */

const body = document.body;
const introEl = document.getElementById('intro');
const pauseEl = document.getElementById('pause');
const keysEl = document.getElementById('keys');
const placeEl = document.getElementById('place');
const timeEl = document.getElementById('time');
const promptEl = document.getElementById('prompt');
const toastEl = document.getElementById('toast');
const seedEls = [];
const stockPanel = document.getElementById('stock');
const stockEls = [];
const storageEls = [];
const waterPill = null;
const waterN = null;

const raycaster = new THREE.Raycaster();
const clickNdc = new THREE.Vector2();

let started = false;
let paused = false;
let dragMode = false;
let lastLockTry = 0;
let lastMouseX = null;
let lastMouseY = null;
let dragHintShown = false;
const held = new Set();
let nearBed = null;
let nearBench = false;
let nearDoor = false;
let doorCloseT = 0;
let nearBin = false;
let nearWell = false;
let nearCart = false;
let pushingCart = false;
let seated = false;
let promptKey = '';
let promptBar = null;
let toastTimer = null;

function showToast(text, duration = 2100) {
  toastEl.textContent = text;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), duration);
}

/* ---- 键位：可自定义，存 localStorage ---- */
const BIND_STORE = 'gw.binds.v1';
const DEFAULT_BINDS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
};
const BIND_LABELS = {
  forward: '前进', back: '后退', left: '左移', right: '右移', run: '快走',
};
const binds = { ...DEFAULT_BINDS };
try {
  const saved = JSON.parse(localStorage.getItem(BIND_STORE) || '{}');
  for (const k of Object.keys(DEFAULT_BINDS)) {
    if (typeof saved[k] === 'string' && saved[k]) binds[k] = saved[k];
  }
} catch (err) { /* 隐私模式等情况下忽略 */ }

const menuTipEl = document.getElementById('menu-tip');

function persistBinds() {
  try { localStorage.setItem(BIND_STORE, JSON.stringify(binds)); } catch (err) { /* 忽略 */ }
}

/* 把 KeyboardEvent.code 变成好看的标签 */
function codeLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const special = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'Shift', ShiftRight: 'Shift',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl',
    AltLeft: 'Alt', AltRight: 'Alt',
    Space: '空格', Tab: 'Tab', CapsLock: 'Caps',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
  };
  return special[code] || code;
}

function refreshKeyHint() {
  const b = binds;
  keysEl.textContent =
    `${codeLabel(b.forward)} ${codeLabel(b.left)} ${codeLabel(b.back)} ${codeLabel(b.right)} 走` +
    ` · ${codeLabel(b.run)} 快走 · 点击收菜 · 1/2/3 选种 · E 互动 / 推车` +
    ` · T 换时辰 · M 声音 · H 净屏 · Esc 菜单`;
}

/* 菜单里的提示条（HUD 的 toast 被菜单盖住了，所以单独一条） */
let menuTipTimer = 0;
function menuTip(msg) {
  if (!menuTipEl) return;
  clearTimeout(menuTipTimer);
  if (!msg) {
    menuTipEl.classList.remove('on');
    return;
  }
  menuTipEl.textContent = msg;
  menuTipEl.classList.add('on');
  menuTipTimer = setTimeout(() => menuTipEl.classList.remove('on'), 2800);
}

/* ---- 面板切换 ---- */
function showPanel(name) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('on'));
  const el = document.getElementById('panel-' + name);
  if (el) el.classList.add('on');
}

/* ---- 菜单开关 ---- */
function openMenu() {
  if (!started) return;
  paused = true;
  held.clear();
  lastMouseX = null;
  lastMouseY = null;
  body.classList.remove('playing');
  pauseEl.classList.remove('hidden');
  void pauseEl.offsetHeight;   // 强制一次 reflow，否则 opacity 过渡不触发
  pauseEl.classList.add('show');
  showPanel('main');
  menuTip('');
}

function closeMenu() {
  pauseEl.classList.remove('show');
  paused = false;
  lastMouseX = null;   // 免得关掉菜单后第一下鼠标把视角甩出去
  lastMouseY = null;
  setTimeout(() => {
    if (!paused) pauseEl.classList.add('hidden');
  }, 340);
}

function quitToTitle() {
  started = false;
  paused = false;
  dragMode = false;
  seated = false;
  if (pushingCart) {
    pushingCart = false;
    farm.setPushing(false);
  }
  held.clear();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  pauseEl.classList.remove('show');
  pauseEl.classList.add('hidden');
  body.classList.remove('playing', 'started');
  introEl.classList.remove('dismiss', 'hidden');
  showPanel('main');
}

/* ---- 菜单按钮 ---- */
document.getElementById('btn-resume').addEventListener('click', (e) => {
  e.stopPropagation();
  closeMenu();
  tryLock();
});

document.getElementById('btn-world').addEventListener('click', (e) => {
  e.stopPropagation();
  showPanel('world');
});

document.getElementById('btn-keys').addEventListener('click', (e) => {
  e.stopPropagation();
  refreshBindButtons();
  showPanel('keys');
});

document.getElementById('btn-quit').addEventListener('click', (e) => {
  e.stopPropagation();
  quitToTitle();
});

document.querySelectorAll('[data-back]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    showPanel('main');
  });
});

document.getElementById('goto-grass').addEventListener('click', (e) => {
  e.stopPropagation();
  const target = location.protocol === 'file:' ? '草原.html' : './grassland.html';
  pauseEl.classList.remove('show');
  const fadeEl = document.getElementById('fade');
  fadeEl.style.transition = 'opacity .55s ease';
  fadeEl.style.opacity = '1';
  setTimeout(() => { location.href = target; }, 580);
});

document.getElementById('goto-wild').addEventListener('click', (e) => {
  e.stopPropagation();
  const target = location.protocol === 'file:' ? '理想的世界.html' : './';
  pauseEl.classList.remove('show');
  const fadeEl = document.getElementById('fade');
  fadeEl.style.transition = 'opacity .55s ease';
  fadeEl.style.opacity = '1';
  setTimeout(() => { location.href = target; }, 580);
});

/* ---- 按键绑定 ---- */
let listening = null;

function refreshBindButtons() {
  document.querySelectorAll('.bind-key').forEach((btn) => {
    if (listening && listening.btn === btn) return;
    btn.textContent = codeLabel(binds[btn.dataset.bind]);
  });
}

document.querySelectorAll('.bind-key').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (listening) {
      listening.btn.classList.remove('listening');
      listening.btn.textContent = codeLabel(binds[listening.action]);
    }
    if (listening && listening.btn === btn) { listening = null; return; }
    listening = { btn, action: btn.dataset.bind };
    btn.classList.add('listening');
    btn.textContent = '按下新键…';
  });
});

/* 返回上一步：把监听中的按钮恢复 */
function cancelListening() {
  if (!listening) return;
  listening.btn.classList.remove('listening');
  listening.btn.textContent = codeLabel(binds[listening.action]);
  listening = null;
}

function setSeedUI() {}
function updateStock() {}
function updateStorage() {}
function updateWater() {}

/* =========================================================
   10.5 云端存档
   ========================================================= */

const CLOUD_TOKEN_KEY = 'iw.cloud.token';
const CLOUD_NAME_KEY = 'iw.cloud.name';
const CLOUD_API = location.protocol === 'file:'
  ? 'http://121.199.0.224/ideal-world/api/index.php'
  : new URL('api/index.php', location.href).href;

const saveStateEl = document.getElementById('save-state');
const saveFormEl = document.getElementById('save-form');
const saveUserBoxEl = document.getElementById('save-user-box');
const saveUserEl = document.getElementById('save-user');
const savePassEl = document.getElementById('save-pass');
const saveNameEl = document.getElementById('save-name');
const saveMetaEl = document.getElementById('save-meta');
const saveHintEl = document.getElementById('save-hint');
const saveImportEl = document.getElementById('save-import');
const saveOpenLoginEl = document.getElementById('save-open-login');
if (saveOpenLoginEl) {
  saveOpenLoginEl.href = location.protocol === 'file:' ? '登录.html' : './login.html';
}

let cloudToken = '';
let cloudName = '';
let cloudRev = 0;
let cloudUpdatedAt = 0;
let cloudLastSaved = '';
let cloudSaving = false;
let cloudTimer = 0;

try {
  cloudToken = localStorage.getItem(CLOUD_TOKEN_KEY) || '';
  cloudName = localStorage.getItem(CLOUD_NAME_KEY) || '';
} catch (e) {
  cloudToken = '';
  cloudName = '';
}

function cloudSetState(text) {
  if (saveStateEl) saveStateEl.textContent = text;
}

function cloudFormatTime(seconds) {
  if (!seconds) return '还没有云端存档';
  const d = new Date(seconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cloudUpdateUI() {
  const logged = !!cloudToken;
  if (saveFormEl) saveFormEl.hidden = logged;
  if (saveUserBoxEl) saveUserBoxEl.hidden = !logged;
  if (saveHintEl) saveHintEl.textContent = logged ? '已登录' : '未登录';
  if (saveNameEl) saveNameEl.textContent = cloudName || '';
  if (!logged) {
    if (saveMetaEl) saveMetaEl.textContent = '';
    cloudSetState('登录后，菜地、推车、粮仓和地面上的收成会保存到云端。');
    return;
  }
  if (saveMetaEl) saveMetaEl.textContent = cloudUpdatedAt
    ? `上次同步：${cloudFormatTime(cloudUpdatedAt)}`
    : (cloudLastSaved ? '已同步' : '正在连接云端…');
  cloudSetState('已开启自动同步：每 20 秒、离开页面时都会保存；换设备登录同一账号即可接着玩。');
}

async function cloudCall(action, payload, method = 'POST') {
  if (!CLOUD_API) throw new Error('本地打开时不能使用云存档，请用线上地址');
  const headers = { 'Content-Type': 'application/json' };
  if (cloudToken) {
    headers.Authorization = 'Bearer ' + cloudToken;
    headers['X-Auth-Token'] = cloudToken;
  }
  const res = await fetch(`${CLOUD_API}?action=${encodeURIComponent(action)}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
    cache: 'no-store',
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error('存档服务返回异常');
  }
  if (res.status === 401) {
    cloudToken = '';
    cloudName = '';
    try {
      localStorage.removeItem(CLOUD_TOKEN_KEY);
      localStorage.removeItem(CLOUD_NAME_KEY);
    } catch (e) { /* ignore */ }
    cloudUpdateUI();
  }
  return { status: res.status, data };
}

function cloudSnapshot() {
  return {
    v: 1,
    world: 'snow',
    hour: Math.round(time.hour * 1000) / 1000,
    player: {
      x: Math.round(player.x * 100) / 100,
      z: Math.round(player.z * 100) / 100,
      yaw: Math.round(player.yaw * 1000) / 1000,
      pitch: Math.round(player.pitch * 1000) / 1000,
    },
    farm: farm.serialize(),
  };
}

function cloudApply(data) {
  if (!data || typeof data !== 'object' || data.v !== 1) return false;
  if (data.world && data.world !== 'snow') return false;
  if (Number.isFinite(data.hour)) {
    time.setHour(((data.hour % 24) + 24) % 24);
  }
  const p = data.player;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
    const lim = WORLD.radius - 4;
    player.x = clamp(p.x, -lim, lim);
    player.z = clamp(p.z, -lim, lim);
    player.yaw = Number(p.yaw) || 0;
    player.pitch = clamp(Number(p.pitch) || 0, -1.35, 1.35);
    player.vx = 0;
    player.vz = 0;
    camY = heightAt(player.x, player.z) + EYE;
  }
  if (data.farm && Object.keys(data.farm).length && !farm.restore(data.farm)) return false;
  seated = false;
  pushingCart = false;
  farm.setPushing(false);
  updateStock();
  updateStorage();
  updateWater();
  return true;
}

async function cloudSave(keepalive = false) {
  if (!cloudToken || cloudSaving || !CLOUD_API) return;
  const snapshot = cloudSnapshot();
  const text = JSON.stringify(snapshot);
  if (text === cloudLastSaved) return;
  cloudSaving = true;
  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + cloudToken,
      'X-Auth-Token': cloudToken,
    };
    const res = await fetch(`${CLOUD_API}?action=save`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ rev: cloudRev, data: text }),
      cache: 'no-store',
      keepalive,
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      cloudToken = '';
      cloudName = '';
      try {
        localStorage.removeItem(CLOUD_TOKEN_KEY);
        localStorage.removeItem(CLOUD_NAME_KEY);
      } catch (e) { /* ignore */ }
      cloudUpdateUI();
      return;
    }
    if (res.status === 409 && data && data.data) {
      // 别处已经存过更新的一版：以云端为准，避免旧页面覆盖新进度
      if (cloudApply(data.data)) {
        cloudRev = data.rev;
        cloudUpdatedAt = data.updatedAt || 0;
        cloudLastSaved = JSON.stringify(data.data);
        if (saveMetaEl) saveMetaEl.textContent = `上次同步：${cloudFormatTime(data.updatedAt)}`;
        showToast('云端已有更新的存档 · 已载入最新进度');
      }
      return;
    }
    if (!res.ok || !data || !data.ok) {
      throw new Error((data && data.error) || '同步失败');
    }
    cloudRev = data.rev;
    cloudUpdatedAt = data.updatedAt || 0;
    cloudLastSaved = text;
    if (saveMetaEl) saveMetaEl.textContent = `上次同步：${cloudFormatTime(data.updatedAt)}`;
  } catch (e) {
    if (!keepalive) cloudSetState(`同步失败：${e.message || '检查一下网络'}（本地进度还在）`);
  } finally {
    cloudSaving = false;
  }
}

function cloudQueueSave() {
  if (!cloudToken) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => cloudSave(), 1400);
}

async function cloudLogin(register) {
  if (!CLOUD_API) {
    cloudSetState('本地打开时不能云存档，请用线上地址');
    return;
  }
  const username = (saveUserEl ? saveUserEl.value : '').trim();
  const password = savePassEl ? savePassEl.value : '';
  if (!username || !password) {
    cloudSetState('请先填用户名和密码');
    return;
  }
  cloudSetState(register ? '正在创建账号…' : '正在登录…');
  try {
    const { status, data } = await cloudCall(register ? 'register' : 'login', { username, password });
    if (!data || !data.ok) {
      cloudSetState((data && data.error) || '登录失败');
      return;
    }
    cloudToken = data.token;
    cloudName = data.username;
    cloudRev = data.rev || 0;
    try {
      localStorage.setItem(CLOUD_TOKEN_KEY, cloudToken);
      localStorage.setItem(CLOUD_NAME_KEY, cloudName);
    } catch (e) { /* ignore */ }
    cloudUpdateUI();
    if (data.data && cloudApply(data.data)) {
      cloudLastSaved = JSON.stringify(data.data);
      cloudUpdatedAt = data.updatedAt || 0;
      if (saveMetaEl) saveMetaEl.textContent = `上次同步：${cloudFormatTime(data.updatedAt)}`;
      showToast('已载入云端存档');
    } else {
      await cloudSave();
      showToast(register ? '账号已创建 · 当前世界已上传' : '已登录 · 当前世界已上传');
    }
    if (savePassEl) savePassEl.value = '';
  } catch (e) {
    cloudSetState(e.message || '连不上存档服务');
  }
}

async function cloudReload() {
  if (!cloudToken) return;
  cloudSetState('正在从云端载入…');
  try {
    const { status, data } = await cloudCall('load', null, 'GET');
    if (status !== 200 || !data || !data.ok) {
      cloudSetState((data && data.error) || '载入失败');
      return;
    }
    cloudRev = data.rev || 0;
    if (data.data && cloudApply(data.data)) {
      cloudLastSaved = JSON.stringify(data.data);
      cloudUpdatedAt = data.updatedAt || 0;
      if (saveMetaEl) saveMetaEl.textContent = `上次同步：${cloudFormatTime(data.updatedAt)}`;
      cloudSetState('已载入云端最新存档');
      showToast('已载入云端最新存档');
    } else {
      cloudSetState('云端还没有存档，先点“立即同步”上传当前世界');
    }
  } catch (e) {
    cloudSetState(e.message || '载入失败');
  }
}

function cloudLogout() {
  cloudToken = '';
  cloudName = '';
  cloudRev = 0;
  cloudUpdatedAt = 0;
  cloudLastSaved = '';
  try {
    localStorage.removeItem(CLOUD_TOKEN_KEY);
    localStorage.removeItem(CLOUD_NAME_KEY);
  } catch (e) { /* ignore */ }
  cloudUpdateUI();
  cloudSetState('已退出登录，云端存档仍然保留');
}

function cloudExport() {
  const payload = { ...cloudSnapshot(), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.href = url;
  a.download = `雪原存档-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  cloudSetState('备份文件已导出，建议存到网盘或另一台设备');
}

function cloudImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || ''));
      if (!cloudApply(data)) {
        cloudSetState('这个备份文件不是雪原存档');
        return;
      }
      cloudLastSaved = '';
      cloudSetState('备份已导入，正在同步到云端…');
      showToast('备份已导入');
      cloudQueueSave();
    } catch (e) {
      cloudSetState('备份文件读不出来');
    }
  };
  reader.readAsText(file);
}

async function cloudBoot() {
  cloudUpdateUI();
  if (!cloudToken) return;
  try {
    const { status, data } = await cloudCall('load', null, 'GET');
    if (status === 200 && data && data.ok) {
      cloudRev = data.rev || 0;
      cloudUpdatedAt = data.updatedAt || 0;
      if (data.data && cloudApply(data.data)) {
        cloudLastSaved = JSON.stringify(data.data);
        if (saveMetaEl) saveMetaEl.textContent = `上次同步：${cloudFormatTime(cloudUpdatedAt)}`;
        cloudSetState(`已连接云端 · ${cloudName}`);
      } else {
        if (saveMetaEl) saveMetaEl.textContent = '云端还没有存档';
        cloudSetState(`已登录 ${cloudName} · 云端还没有存档`);
      }
    }
  } catch (e) {
    cloudSetState(`暂时连不上云端：${e.message || '检查网络'}（本地进度还在）`);
  }
}

document.getElementById('btn-save').addEventListener('click', (e) => {
  e.stopPropagation();
  cloudUpdateUI();
  showPanel('save');
});

document.getElementById('save-login').addEventListener('click', (e) => {
  e.stopPropagation();
  cloudLogin(false);
});
document.getElementById('save-register').addEventListener('click', (e) => {
  e.stopPropagation();
  cloudLogin(true);
});
document.getElementById('save-now').addEventListener('click', (e) => {
  e.stopPropagation();
  cloudSave();
});
document.getElementById('save-reload').addEventListener('click', (e) => {
  e.stopPropagation();
  cloudReload();
});
document.getElementById('save-logout').addEventListener('click', (e) => {
  e.stopPropagation();
  cloudLogout();
});
document.getElementById('save-export').addEventListener('click', (e) => {
  e.stopPropagation();
  cloudExport();
});
if (saveImportEl) {
  saveImportEl.addEventListener('change', () => {
    cloudImport(saveImportEl.files && saveImportEl.files[0]);
    saveImportEl.value = '';
  });
}
if (savePassEl) {
  savePassEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      cloudLogin(false);
    }
  });
}

function renderPrompt() {
  nearBed = null;
  nearBench = false;
  nearDoor = false;
  nearBin = false;
  nearWell = false;
  nearCart = false;

  if (!started || paused) {
    if (promptKey !== '') {
      promptKey = '';
      promptEl.classList.remove('on');
      promptBar = null;
    }
    return;
  }

  const show = (key, html) => {
    if (key !== promptKey) {
      promptKey = key;
      promptEl.innerHTML = html;
      promptEl.classList.add('on');
      promptBar = null;
    }
  };

  if (seated) {
    show('seated', `<span class="key">E</span><span>起身</span><span class="sub">W A S D 也能站起</span>`);
    return;
  }

  // 雪原自己的东西：小屋的门、温泉、冰钓屋、雪人、雪橇
  const sp = snowPlaces.prompt(player);
  if (sp) {
    show(sp.key, sp.html);
    return;
  }

  const binD = Math.hypot(player.x - farm.storageBin.x, player.z - farm.storageBin.z);
  if (farm.isInsideBarn(player.x, player.z) && binD < 2.3) {
    nearBin = true;
    const load = farm.cartLoad();
    const stored = farm.storage[0] + farm.storage[1] + farm.storage[2];
    if (load > 0) {
      show(
        `bin-${load}-${stored}`,
        `<span class="key">E</span><span>倒进粮仓</span><span class="sub">车上 ${load} 份 · 已存 ${stored} 份</span>`
      );
    } else {
      show(
        `bin-empty-${stored}`,
        `<span>粮仓</span><span class="sub">已存 ${stored} 份 · 用推车把菜运进来</span>`
      );
    }
    return;
  }

  const doorD = Math.hypot(player.x - farm.door.x, player.z - farm.door.z);
  if (doorD < 1.55) {
    nearDoor = true;
    const open = farm.isDoorOpen();
    show(
      `door-${open}`,
      `<span class="key">E</span><span>${open ? '关上' : '推开'}谷仓门</span><span class="sub">${open ? '走开一会儿会自动关上' : '走过去也会自动推开'}</span>`
    );
    return;
  }

  const benchD = Math.hypot(player.x - farm.bench.x, player.z - farm.bench.z);
  if (benchD < 1.8) {
    nearBench = true;
    show('bench', `<span class="key">E</span><span>坐下</span><span class="sub">谷仓前的长凳</span>`);
    return;
  }

  const bed = farm.nearestBed(player.x, player.z, 3.6);
  nearBed = bed;
  if (!bed) {
    // 水井：打水
    const wellD = Math.hypot(player.x - farm.well.x, player.z - farm.well.z);
    if (wellD < 2.7) {
      nearWell = true;
      const charges = farm.waterCharges();
      if (charges >= farm.canMax) {
        show('well-full', `<span>水井</span><span class="sub">洒水壶是满的 · 去菜畦浇水</span>`);
      } else {
        show(
          `well-${charges}`,
          `<span class="key">E</span><span>打水</span><span class="sub">装满洒水壶 · 现在 ${charges}/${farm.canMax}</span>`
        );
      }
      return;
    }

    // 小推车
    const cartD = Math.hypot(player.x - farm.cartWorld.x, player.z - farm.cartWorld.z);
    if (pushingCart || cartD < 2.0) {
      nearCart = true;
      const load = farm.cartLoad();
      if (pushingCart) {
        show(
          `cart-push-${load}`,
          `<span class="key">E</span><span>放下小推车</span><span class="sub">车斗 ${load}/${farm.cartCap} · 靠近菜会自动装车</span>`
        );
      } else {
        show(
          `cart-${load}`,
          `<span class="key">E</span><span>推起小推车</span><span class="sub">车斗 ${load}/${farm.cartCap} · 运到粮仓去</span>`
        );
      }
      return;
    }

    if (promptKey !== '') {
      promptKey = '';
      promptEl.classList.remove('on');
      promptBar = null;
    }
    return;
  }

  const def = CROPS[bed.crop];
  const selected = CROPS[farm.getSelected()];
  let key;
  let html;

  if (!bed.planted) {
    key = `empty-${bed.index}-${farm.getSelected()}`;
    html = `<span class="key">E</span><span>播种 · ${selected.name}</span><span class="sub">按 1 2 3 换种子</span>`;
    promptBar = null;
  } else if (bed.stage >= 2) {
    key = `ready-${bed.index}-${bed.crop}`;
    html = `<span class="key">E</span><span>收获 · ${def.name}</span><span class="sub">也可直接点击 · 收成会落在土上</span>`;
    promptBar = null;
  } else {
    const pct = Math.round(farm.bedProgress(bed) * 100);
    const moist = Math.round(bed.moisture * 100);
    const charges = farm.waterCharges();
    if (charges > 0 && bed.moisture < 0.9) {
      key = `water-${bed.index}-${bed.crop}-${charges}-${moist}`;
      html = `<span class="key">E</span><span>浇水 · ${def.name}</span><span class="sub">土壤 ${moist}% · 水壶 ${charges}/${farm.canMax}</span>`;
      promptBar = null;
    } else {
      key = `grow-${bed.index}-${bed.crop}-${moist}`;
      const hint = charges === 0 && bed.moisture < 0.4 ? ' · 土干了，去水井打水' : ` · 土壤 ${moist}%`;
      html = `<span>${def.name}生长中</span><span class="bar"><i></i></span><span class="sub">${pct}%${hint}</span>`;
    }
  }

  if (key !== promptKey) {
    promptKey = key;
    promptEl.innerHTML = html;
    promptEl.classList.add('on');
    promptBar = promptEl.querySelector('.bar i');
  }
  if (promptBar) {
    promptBar.style.width = `${Math.round(farm.bedProgress(bed) * 100)}%`;
  }
}

function sitDown() {
  if (seated) return;
  if (pushingCart) {
    pushingCart = false;
    farm.setPushing(false);
  }
  seated = true;
  player.x = farm.bench.x;
  player.z = farm.bench.z;
  player.yaw = farm.bench.yaw;
  player.pitch = -0.06;
  player.vx = 0;
  player.vz = 0;
  showToast('坐在长凳上歇一会儿');
  promptKey = '';
  renderPrompt();
}

function standUp() {
  if (!seated) return;
  seated = false;
  player.x += -Math.sin(player.yaw) * 0.55;
  player.z += -Math.cos(player.yaw) * 0.55;
  promptKey = '';
  renderPrompt();
}

function toggleBarnDoor() {
  const open = farm.toggleDoor();
  doorCloseT = 0;
  sfxDoor();
  showToast(open ? '谷仓门开了' : '谷仓门关上了');
  promptKey = '';
  renderPrompt();
  cloudQueueSave();
}

function depositGrain() {
  const res = farm.unloadCart();
  if (res.total > 0) {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      if (res.moved[i]) parts.push(`${CROPS[i].name} ${res.moved[i]}`);
    }
    showToast(`入库 · ${parts.join(' · ')}`, 3000);
    updateStock(true);
    updateStorage();
    sfxDeposit();
    cloudQueueSave();
  } else {
    showToast('车斗空着 · 先去菜畦收菜，再推车过来');
  }
  promptKey = '';
  renderPrompt();
}

function toggleCart() {
  pushingCart = !pushingCart;
  farm.setPushing(pushingCart);
  if (pushingCart) sfxCartUp();
  else sfxCartDown();
  showToast(
    pushingCart ? '推起小推车 · 走到菜上会自动装车' : '放下了小推车',
    2600
  );
  promptKey = '';
  renderPrompt();
}

function fillWater() {
  const res = farm.fillCan();
  if (res.type === 'full') {
    showToast('洒水壶是满的 · 去菜畦浇水');
  } else {
    sfxWellDraw();
    showToast(`打满一壶水 · ${res.charges}/${farm.canMax}`, 2400);
  }
  updateWater();
  promptKey = '';
  renderPrompt();
  cloudQueueSave();
}

function interact() {
  if (seated) {
    standUp();
    return;
  }
  const snowMsg = snowPlaces.interact(player);
  if (snowMsg) {
    showToast(snowMsg, 3200);
    return;
  }
  if (nearBin) {
    depositGrain();
    return;
  }
  if (nearDoor) {
    toggleBarnDoor();
    return;
  }
  if (nearBench) {
    sitDown();
    return;
  }
  if (nearWell) {
    fillWater();
    return;
  }
  if (nearBed) {
    const res = farm.interact(nearBed);
    if (res.type === 'plant') {
      showToast(`种下了 · ${CROPS[res.crop].name}`);
      sfxPlant();
    } else if (res.type === 'harvest') {
      showToast(`拔出来了 · ${CROPS[res.crop].name} ×${res.amount} · 推车过来装`, 2800);
      sfxHarvest();
    } else if (res.type === 'water') {
      sfxPour();
      showToast(`浇了水 · 土壤湿了 · 水壶剩 ${res.charges}/${farm.canMax}`, 2600);
      updateWater();
    } else if (res.type === 'wait') {
      showToast(`${CROPS[res.crop].name}还在长 · ${Math.round(res.progress * 100)}%`);
    }
    if (res.type !== 'wait') cloudQueueSave();
    promptKey = '';
    renderPrompt();
    return;
  }
  if (nearCart) {
    toggleCart();
    return;
  }
}

function pickTargetAt(clientX, clientY) {
  clickNdc.set(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(clickNdc, camera);
  raycaster.far = 9;
  const hits = raycaster.intersectObjects(farm.clickTargets, false);
  if (!hits.length) return null;
  // 地上的收成优先，免得被菜畦的点击判定挡住
  for (const h of hits) {
    if (h.object.userData.produce) return { produce: h.object.userData.produce };
  }
  const bed = farm.beds[hits[0].object.userData.bedIndex];
  return bed ? { bed } : null;
}

function collectToCart(item) {
  const d = Math.hypot(player.x - farm.cartWorld.x, player.z - farm.cartWorld.z);
  if (d > 4.6) {
    showToast('小推车离得远 · 先去把它推过来');
    return;
  }
  const res = farm.collectProduce(item);
  if (res.ok) {
    sfxLoad(item.crop);
    showToast(`装车 · ${CROPS[item.crop].name}`);
    cloudQueueSave();
  } else if (res.reason === 'full') {
    showToast('车斗满了 · 先运回粮仓');
  }
}

function onCanvasClick(e) {
  if (!started || paused) return;
  const locked = document.pointerLockElement === canvas;
  const target = locked
    ? pickTargetAt(window.innerWidth * 0.5, window.innerHeight * 0.5)
    : pickTargetAt(e.clientX, e.clientY);

  if (target && target.produce) {
    collectToCart(target.produce);
    promptKey = '';
    renderPrompt();
    return;
  }

  if (target && target.bed) {
    const bed = target.bed;
    const res = farm.harvestBed(bed);
    if (res.type === 'harvest') {
      showToast(`拔出来了 · ${CROPS[res.crop].name} ×${res.amount} · 推车来装`, 2800);
      sfxHarvest();
      cloudQueueSave();
    } else if (res.type === 'wait') {
      showToast(`${CROPS[res.crop].name}还没熟 · ${Math.round(res.progress * 100)}%`);
    } else if (res.type === 'empty') {
      showToast('这块地空着 · 按 E 播种');
    }
    promptKey = '';
    renderPrompt();
    return;
  }

  // 没点中菜，才把这一下当成重新锁定鼠标
  if (dragMode && !locked) {
    const now = performance.now();
    if (now - lastLockTry > 2000) {
      lastLockTry = now;
      tryLock();
    }
  }
}

function startGame() {
  if (started) return;
  started = true;
  body.classList.add('playing', 'started');
  introEl.classList.add('dismiss');
  setTimeout(() => introEl.classList.add('hidden'), 1500);
  refreshKeyHint();
  refreshBindButtons();
  const fadeEl = document.getElementById('fade');
  fadeEl.style.transition = 'none';
  fadeEl.style.opacity = '0.95';
  requestAnimationFrame(() => {
    fadeEl.style.transition = 'opacity 2.6s ease';
    fadeEl.style.opacity = '0';
  });
  canvas.focus();
  try {
    initAudio();
  } catch (err) {
    window.__err.push('AUDIO:' + (err && err.message ? err.message : err));
  }
  tryLock();
  setTimeout(() => {
    if (started && !document.pointerLockElement && !dragMode) enableDragMode();
  }, 900);
  setTimeout(() => {
    if (started && !document.pointerLockElement) canvas.focus();
  }, 1200);
  setTimeout(() => keysEl.classList.add('dim'), 22000);
  setTimeout(() => {
    if (!dragMode) showToast('沿着土路走，前面是农场');
  }, 3600);
}

function tryLock() {
  if (!canvas.requestPointerLock) {
    enableDragMode();
    return;
  }
  try {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => enableDragMode());
  } catch (err) {
    enableDragMode();
  }
}

function enableDragMode() {
  dragMode = true;
  paused = false;
  pauseEl.classList.add('hidden');
  body.classList.remove('playing');
  if (started && !dragHintShown) {
    dragHintShown = true;
    showToast('鼠标直接移动看四周 · 点一下场景可重新锁定鼠标', 5200);
    setTimeout(() => keysEl.classList.add('dim'), 25000);
  }
}

document.addEventListener('pointerlockchange', () => {
  lastMouseX = null;
  lastMouseY = null;
  if (document.pointerLockElement === canvas) {
    closeMenu();
    body.classList.add('playing');
  } else if (started) {
    if (dragMode) {
      paused = false;
      body.classList.remove('playing');
      pauseEl.classList.add('hidden');
    } else {
      // 指针锁定时浏览器会吞掉 Esc 的 keydown，解锁就等于「想停下」
      openMenu();
    }
  }
});
document.addEventListener('pointerlockerror', () => enableDragMode());
document.getElementById('enter').addEventListener('click', (e) => {
  e.stopPropagation();
  startGame();
});
introEl.addEventListener('click', startGame);

canvas.addEventListener('mousedown', () => {
  if (!started) return;
  canvas.focus();
});
canvas.addEventListener('click', onCanvasClick);

// 视角监听放在 window 上：指针锁成功、失败、或浏览器不给 movementX
// 都能转视角。没锁指针时用 clientX/Y 的差值，不要求按住鼠标。
window.addEventListener('mousemove', (e) => {
  if (!started || paused) return;
  const locked = document.pointerLockElement === canvas;
  let dx = 0;
  let dy = 0;

  if (locked) {
    dx = e.movementX || 0;
    dy = e.movementY || 0;
  } else {
    if (lastMouseX === null) {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      canvas.style.cursor = pickTargetAt(e.clientX, e.clientY) ? 'pointer' : 'default';
      return;
    }
    dx = e.clientX - lastMouseX;
    dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.style.cursor = pickTargetAt(e.clientX, e.clientY) ? 'pointer' : 'default';
  }

  if (!dx && !dy) return;
  const sens = locked ? 0.0021 : 0.0029;
  player.yaw -= dx * sens;
  player.pitch = clamp(player.pitch - dy * sens, -1.15, 1.15);
});

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();

  // 按键设置：等待玩家按下新键
  if (listening) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { cancelListening(); return; }
    const action = listening.action;
    const oldKey = binds[action];
    const occupied = Object.keys(binds).find((k) => k !== action && binds[k] === e.code);
    if (occupied) {
      binds[occupied] = oldKey;      // 撞键就互换，不让两个动作共用一个键
      menuTip(`${codeLabel(e.code)} 原本是「${BIND_LABELS[occupied]}」，已与「${BIND_LABELS[action]}」互换`);
    } else {
      menuTip(`「${BIND_LABELS[action]}」改为 ${codeLabel(e.code)}`);
    }
    binds[action] = e.code;
    persistBinds();
    cancelListening();
    refreshBindButtons();
    refreshKeyHint();
    return;
  }

  if (!started) {
    if (e.code === 'Enter') startGame();
    return;
  }

  // Esc：开/关菜单（指针锁定状态下浏览器会自己解锁，走 pointerlockchange）
  if (e.code === 'Escape') {
    if (paused) { closeMenu(); tryLock(); } else { openMenu(); }
    return;
  }

  if (paused) return;

  held.add(e.code);
  if (seated && [
    binds.forward, binds.left, binds.back, binds.right,
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  ].includes(e.code)) {
    standUp();
  }
  if (e.code === 'Digit1' || e.key === '1') { farm.setSelected(0); setSeedUI(); promptKey = ''; }
  if (e.code === 'Digit2' || e.key === '2') { farm.setSelected(1); setSeedUI(); promptKey = ''; }
  if (e.code === 'Digit3' || e.key === '3') { farm.setSelected(2); setSeedUI(); promptKey = ''; }
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyT') {
    const line = time.skip();
    if (line) showToast(line);
  }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyH') body.classList.toggle('clean');
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

/* =========================================================
   11. 声音
   ========================================================= */

let masterGain = null;
let muted = false;
let music = null;
let windGain = null;
let insectGain = null;
let stepBuffer = null;
let cartRollGain = null;
let cartCreakTimer = 0;

function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (music) music.resume();
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();

  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.56;
  masterGain.connect(audioCtx.destination);

  // 动物踩草的沙沙声，一小段衰减噪声反复用
  const stepLen = Math.floor(audioCtx.sampleRate * 0.16);
  stepBuffer = audioCtx.createBuffer(1, stepLen, audioCtx.sampleRate);
  const stepData = stepBuffer.getChannelData(0);
  for (let i = 0; i < stepLen; i++) {
    stepData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / stepLen, 3);
  }

  const len = audioCtx.sampleRate * 6;
  const buffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.4;
  }
  const wind = audioCtx.createBufferSource();
  wind.buffer = buffer;
  wind.loop = true;
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 680;
  lowpass.Q.value = 0.5;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0.15;
  wind.connect(lowpass).connect(windGain).connect(masterGain);
  wind.start();

  // 花海里的虫鸣：一层低频嗡声，进花海才响
  const hum = audioCtx.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 182;
  const humBand = audioCtx.createBiquadFilter();
  humBand.type = 'bandpass';
  humBand.frequency.value = 430;
  humBand.Q.value = 4.5;
  insectGain = audioCtx.createGain();
  insectGain.gain.value = 0;
  hum.connect(humBand).connect(insectGain).connect(masterGain);
  hum.start();

  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.052;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain).connect(windGain.gain);
  lfo.start();

  // 推车木轮滚过草地的底噪：一直循环，音量跟着推车速度走
  const rollLen = Math.floor(audioCtx.sampleRate * 1.2);
  const rollBuffer = audioCtx.createBuffer(1, rollLen, audioCtx.sampleRate);
  const rollData = rollBuffer.getChannelData(0);
  let rollLast = 0;
  for (let i = 0; i < rollLen; i++) {
    const white = Math.random() * 2 - 1;
    rollLast = (rollLast + 0.09 * white) / 1.09;
    rollData[i] = rollLast * 2.6;
  }
  const rollSrc = audioCtx.createBufferSource();
  rollSrc.buffer = rollBuffer;
  rollSrc.loop = true;
  const rollHigh = audioCtx.createBiquadFilter();
  rollHigh.type = 'highpass';
  rollHigh.frequency.value = 60;
  const rollLow = audioCtx.createBiquadFilter();
  rollLow.type = 'lowpass';
  rollLow.frequency.value = 300;
  rollLow.Q.value = 0.9;
  cartRollGain = audioCtx.createGain();
  cartRollGain.gain.value = 0;
  rollSrc.connect(rollHigh).connect(rollLow).connect(cartRollGain).connect(masterGain);
  rollSrc.start();
  const rollLfo = audioCtx.createOscillator();
  rollLfo.frequency.value = 3.4;
  const rollLfoGain = audioCtx.createGain();
  rollLfoGain.gain.value = 72;
  rollLfo.connect(rollLfoGain).connect(rollLow.frequency);
  rollLfo.start();

  music = createMusic(audioCtx, masterGain);
  music.start();
  scheduleBirds();
  scheduleCrickets();
  scheduleAnimalAmbience();
}

function toggleMute() {
  if (!audioCtx) return;
  muted = !muted;
  masterGain.gain.setTargetAtTime(muted ? 0 : 0.56, audioCtx.currentTime, 0.15);
}

function chirp() {
  if (!audioCtx || muted) return;
  const t0 = audioCtx.currentTime;
  const notes = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < notes; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const pan = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
    osc.type = 'sine';
    const start = t0 + i * 0.17 + Math.random() * 0.06;
    const f = 2050 + Math.random() * 1900;
    osc.frequency.setValueAtTime(f, start);
    osc.frequency.exponentialRampToValueAtTime(f * (1.22 + Math.random() * 0.55), start + 0.055);
    osc.frequency.exponentialRampToValueAtTime(f * 0.86, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.026, start + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
    if (pan) {
      pan.pan.value = Math.random() * 1.6 - 0.8;
      osc.connect(gain).connect(pan).connect(masterGain);
    } else {
      osc.connect(gain).connect(masterGain);
    }
    osc.start(start);
    osc.stop(start + 0.17);
  }
}

function scheduleBirds() {
  setTimeout(() => {
    if (audioCtx && audioCtx.currentTime > 1 && timeState.night < 0.45) chirp();
    scheduleBirds();
  }, 4200 + Math.random() * 9000);
}

function cricketChirp() {
  if (!audioCtx || muted) return;
  const t0 = audioCtx.currentTime;
  let pan = null;
  if (audioCtx.createStereoPanner) {
    pan = audioCtx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    pan.connect(masterGain);
  }
  for (let i = 0; i < 3; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 3600 + Math.random() * 700;
    const start = t0 + i * 0.062;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.007, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    osc.connect(gain);
    gain.connect(pan || masterGain);
    osc.start(start);
    osc.stop(start + 0.07);
  }
}

function scheduleCrickets() {
  setTimeout(() => {
    if (timeState.night > 0.35 && !muted) cricketChirp();
    scheduleCrickets();
  }, 520 + Math.random() * 900);
}

// 白天也保证有羊/牛叫：每隔几秒挑一头附近的动物叫一声
function scheduleAnimalAmbience() {
  setTimeout(() => {
    if (audioCtx && !muted && timeState.night < 0.6 && herd) {
      const candidates = herd.animals.filter(
        (a) => Math.hypot(a.x - player.x, a.z - player.z) < 36
      );
      if (candidates.length && Math.random() < 0.82) {
        const a = candidates[Math.floor(Math.random() * candidates.length)];
        playAnimalSound(a.kind, a);
      }
    }
    scheduleAnimalAmbience();
  }, 4200 + Math.random() * 4800);
}

function sfxPlant() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(420, t);
  osc.frequency.exponentialRampToValueAtTime(680, t + 0.08);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.035, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(gain).connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.2);
}

function sfxHarvest() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  for (let i = 0; i < 2; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    const start = t + i * 0.09;
    osc.frequency.setValueAtTime(i ? 880 : 660, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.028, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    osc.connect(gain).connect(masterGain);
    osc.start(start);
    osc.stop(start + 0.22);
  }
}

function sfxDoor() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 420;
  bp.Q.value = 2.2;
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(125, t);
  osc.frequency.linearRampToValueAtTime(84, t + 0.24);
  osc.frequency.linearRampToValueAtTime(108, t + 0.42);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.018, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
  osc.connect(bp).connect(gain).connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.5);
}

function sfxDeposit() {
  if (!audioCtx || muted || !stepBuffer) return;
  const t = audioCtx.currentTime;
  for (let i = 0; i < 4; i++) {
    const src = audioCtx.createBufferSource();
    src.buffer = stepBuffer;
    src.playbackRate.value = 0.55 + Math.random() * 0.5;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 900;
    bp.Q.value = 0.9;
    const g = audioCtx.createGain();
    const start = t + i * 0.09;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(0.03, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    src.connect(bp).connect(g).connect(masterGain);
    src.start(start);
    src.stop(start + 0.2);
  }
  const osc = audioCtx.createOscillator();
  const g2 = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, t);
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(0.025, t + 0.03);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(g2).connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.32);
}

/* 木头碰撞：短促的低频敲击 + 一点木屑感的噪声 */
function woodKnock(t, freq = 140, vol = 0.03) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  osc.connect(g).connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.18);

  if (!stepBuffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = stepBuffer;
  src.playbackRate.value = 1.9;
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1800;
  bp.Q.value = 1.2;
  const ng = audioCtx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.linearRampToValueAtTime(vol * 0.45, t + 0.006);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  src.connect(bp).connect(ng).connect(masterGain);
  src.start(t);
  src.stop(t + 0.08);
}

let lastLoadAt = 0;
/* 收成掉进车斗：一声闷闷的“咚”，不同菜略有区别 */
function sfxLoad(crop = 0) {
  if (!audioCtx || muted) return;
  const now = performance.now();
  if (now - lastLoadAt < 90) return;
  lastLoadAt = now;
  const t = audioCtx.currentTime;
  const base = crop === 1 ? 118 : crop === 2 ? 172 : 148;
  woodKnock(t, base, 0.017);
  if (!stepBuffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = stepBuffer;
  src.playbackRate.value = crop === 1 ? 0.7 : 1.15;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 1200;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.0001, t + 0.004);
  g.gain.linearRampToValueAtTime(0.015, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  src.connect(lp).connect(g).connect(masterGain);
  src.start(t + 0.004);
  src.stop(t + 0.18);
}

/* 打水：辘轳吱呀 → 桶落水 → 水泡 → 提上来再吱一声（约 1.4 秒，跟着木桶动画） */
function sfxWellDraw() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;

  const creak = audioCtx.createOscillator();
  const creakGain = audioCtx.createGain();
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 520;
  bp.Q.value = 4.5;
  creak.type = 'sawtooth';
  creak.frequency.setValueAtTime(96, t);
  creak.frequency.linearRampToValueAtTime(72, t + 0.62);
  creakGain.gain.setValueAtTime(0.0001, t);
  creakGain.gain.exponentialRampToValueAtTime(0.012, t + 0.06);
  creakGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.66);
  creak.connect(bp).connect(creakGain).connect(masterGain);
  creak.start(t);
  creak.stop(t + 0.68);

  const splash = t + 0.62;
  if (stepBuffer) {
    const src = audioCtx.createBufferSource();
    src.buffer = stepBuffer;
    src.playbackRate.value = 0.9;
    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, splash);
    lp.frequency.exponentialRampToValueAtTime(600, splash + 0.3);
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, splash);
    g.gain.linearRampToValueAtTime(0.05, splash + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, splash + 0.34);
    src.connect(lp).connect(g).connect(masterGain);
    src.start(splash);
    src.stop(splash + 0.36);
  }
  for (let i = 0; i < 4; i++) {
    const st = splash + 0.04 + i * 0.075;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520 - i * 55, st);
    osc.frequency.exponentialRampToValueAtTime(180, st + 0.1);
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.013, st + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.13);
    osc.connect(g).connect(masterGain);
    osc.start(st);
    osc.stop(st + 0.15);
  }

  const lift = t + 0.95;
  const o2 = audioCtx.createOscillator();
  const g2 = audioCtx.createGain();
  const bp2 = audioCtx.createBiquadFilter();
  bp2.type = 'bandpass';
  bp2.frequency.value = 760;
  bp2.Q.value = 5;
  o2.type = 'sawtooth';
  o2.frequency.setValueAtTime(120, lift);
  o2.frequency.linearRampToValueAtTime(96, lift + 0.34);
  g2.gain.setValueAtTime(0.0001, lift);
  g2.gain.exponentialRampToValueAtTime(0.009, lift + 0.05);
  g2.gain.exponentialRampToValueAtTime(0.0001, lift + 0.36);
  o2.connect(bp2).connect(g2).connect(masterGain);
  o2.start(lift);
  o2.stop(lift + 0.38);
}

/* 浇水：壶嘴持续的水流声 + 几颗水泡，约 1 秒 */
function sfxPour() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  if (stepBuffer) {
    const src = audioCtx.createBufferSource();
    src.buffer = stepBuffer;
    src.loop = true;
    src.playbackRate.value = 1.7;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1700, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.8);
    bp.Q.value = 1.1;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.028, t + 0.08);
    g.gain.setValueAtTime(0.028, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    src.connect(bp).connect(g).connect(masterGain);
    src.start(t);
    src.stop(t + 1.0);
  }
  for (let i = 0; i < 5; i++) {
    const st = t + 0.08 + i * 0.14 + Math.random() * 0.05;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620 + Math.random() * 220, st);
    osc.frequency.exponentialRampToValueAtTime(300, st + 0.09);
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.008, st + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, st + 0.11);
    osc.connect(g).connect(masterGain);
    osc.start(st);
    osc.stop(st + 0.12);
  }
}

/* 推起小车：木头一响 + 一声短促的吱呀 */
function sfxCartUp() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  woodKnock(t, 150, 0.03);
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 6;
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(260, t + 0.02);
  osc.frequency.linearRampToValueAtTime(340, t + 0.16);
  osc.frequency.linearRampToValueAtTime(295, t + 0.3);
  g.gain.setValueAtTime(0.0001, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.02, t + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  osc.connect(bp).connect(g).connect(masterGain);
  osc.start(t + 0.02);
  osc.stop(t + 0.36);
}

/* 放下小车：车轮落地的一下闷响 */
function sfxCartDown() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  woodKnock(t, 118, 0.032);
  woodKnock(t + 0.05, 92, 0.018);
}

/* 推着走时偶尔响一下的木轮吱呀 */
function sfxCartCreak(speed = 1) {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 620 + Math.random() * 520;
  bp.Q.value = 7;
  osc.type = 'sawtooth';
  const f0 = 180 + Math.random() * 90;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.linearRampToValueAtTime(f0 * 1.35, t + 0.1);
  osc.frequency.linearRampToValueAtTime(f0 * 1.1, t + 0.22);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.008 + speed * 0.004, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
  osc.connect(bp).connect(g).connect(masterGain);
  osc.start(t);
  osc.stop(t + 0.28);
}

/* 每帧更新推车底噪：没推车或站着不动时自然收掉 */
function updateCartAudio(speed, dt) {
  if (!audioCtx || !cartRollGain) return;
  const k = clamp((speed - 0.1) / 2.2, 0, 1);
  cartRollGain.gain.setTargetAtTime(muted ? 0 : k * 0.05, audioCtx.currentTime, 0.07);
  if (k > 0.12) {
    cartCreakTimer -= dt;
    if (cartCreakTimer <= 0) {
      cartCreakTimer = 1.2 + Math.random() * 1.8;
      sfxCartCreak(k);
    }
  } else {
    cartCreakTimer = Math.min(cartCreakTimer, 0.6);
  }
}

/* =========================================================
   11.5 时辰 / 天光
   ========================================================= */

let lastClockText = '';
let cloudBoost = 1;   // 调试用：?cloud=3 把云影放大，方便确认有没有生效

function updateClock(h) {
  const text = `${formatClock(h)} · ${phaseName(h)}`;
  if (text !== lastClockText) {
    lastClockText = text;
    if (timeEl) timeEl.textContent = text;
  }
}

function applyTime() {
  const s = timeState;
  SUN_DIR.copy(s.sunDir);
  MOON_DIR.copy(s.moonDir);

  skyUniforms.uSunDir.value.copy(SUN_DIR);
  skyUniforms.uMoonDir.value.copy(MOON_DIR);
  skyUniforms.uZenith.value.copy(s.zenith);
  skyUniforms.uHorizon.value.copy(s.horizon);
  skyUniforms.uHaze.value.copy(s.haze);
  skyUniforms.uFog.value.copy(s.fog);
  skyUniforms.uCloud.value.copy(s.cloud);
  skyUniforms.uSunColor.value.copy(s.sun);
  skyUniforms.uNight.value = s.night;
  skyUniforms.uStars.value = clamp(smoothstep(-2.5, -9.0, s.elev), 0, 1);
  skyUniforms.uDusk.value = s.dusk;
  skyUniforms.uCover.value = clamp(s.cover + 0.1, 0, 0.82);

  scene.fog.color.copy(s.fog);
  scene.fog.density = s.fogD;

  sunLight.color.copy(s.sun);
  sunLight.intensity = s.elev > -2 ? s.sunI * 1.05 : 0;
  sunLight.castShadow = s.elev > -1;
  hemiLight.color.copy(s.hemiSky);
  hemiLight.groundColor.copy(s.hemiGround);
  hemiLight.intensity = s.hemiI;
  moonLight.intensity = s.night * 0.68;
  renderer.toneMappingExposure = s.expo;

  sharedUniforms.uSunDir.value.copy(SUN_DIR);
  sharedUniforms.uSunColor.value.copy(s.sun);
  sharedUniforms.uSunI.value = clamp(s.sunI / 3.0, 0.05, 1.2);
  sharedUniforms.uSkyColor.value.copy(s.hemiSky);
  sharedUniforms.uFogColor.value.copy(s.fog);
  sharedUniforms.uFogDensity.value = s.fogD;

  // 雪山跟着同一套光走
  mtnUniforms.uSunDir.value.copy(SUN_DIR);
  mtnUniforms.uSunColor.value.copy(s.sun);
  mtnUniforms.uSunI.value = clamp(s.sunI / 3.0, 0.05, 1.2);
  mtnUniforms.uSkyColor.value.copy(s.hemiSky);
  mtnUniforms.uFogColor.value.copy(s.fog);
  mtnUniforms.uNight.value = s.night;
  mtnUniforms.uDusk.value = s.dusk;

  // 极光：天真的黑下来才出现，后半夜最亮
  skyUniforms.uAurora.value =
    clamp(smoothstep(-3.0, -9.5, s.elev), 0, 1) * (0.55 + 0.45 * smoothstep(23.5, 1.5, s.hour));

  // 冰湖跟着同一套光走
  iceUniforms.uSunDir.value.copy(SUN_DIR);
  iceUniforms.uSunColor.value.copy(s.sun);
  iceUniforms.uSunI.value = clamp(s.sunI / 3.0, 0.05, 1.2);
  iceUniforms.uSkyColor.value.copy(s.hemiSky);
  iceUniforms.uFogColor.value.copy(s.fog);
  iceUniforms.uFogDensity.value = s.fogD;
  iceUniforms.uNight.value = s.night;
  iceUniforms.uDusk.value = s.dusk;

  // 时刻驱动的三个"天气参数"：黄昏逆光、清晨露水、云影浓度
  const hh = s.hour;
  sharedUniforms.uNight.value = clamp(smoothstep(-1.0, -9.0, s.elev), 0, 1);
  sharedUniforms.uDusk.value = s.dusk;
  sharedUniforms.uDew.value = clamp(
    smoothstep(4.6, 6.5, hh) * smoothstep(11.2, 8.4, hh), 0, 1
  );
  sharedUniforms.uCloudAmount.value = clamp((0.34 + s.cover * 0.95) * (1 - s.night * 0.94) * cloudBoost, 0, 1);

  // 薄雾：天亮前后铺一层，太阳升高就散
  mistUniforms.uOpacity.value = clamp(
    smoothstep(4.2, 5.7, hh) * smoothstep(9.6, 7.3, hh) * 0.78, 0, 1
  );

  // 花粉与蒲公英：黄昏染成金色、变大变多
  const duskK = s.dusk;
  pollenMat.color.setRGB(1.0, 0.97, 0.86).lerp(tmpColor.setRGB(1.0, 0.74, 0.40), duskK * 0.9);
  pollenMat.size = 0.1 + duskK * 0.04;
  dandelionMat.color.setRGB(1.0, 0.98, 0.94).lerp(tmpColor.setRGB(1.0, 0.80, 0.52), duskK * 0.85);

  fireflyMat.uniforms.uOpacity.value = smoothstep(2, -8, s.elev) * 0.42;
  pollenMat.opacity = (0.52 + duskK * 0.30) * (1 - s.night * 0.88);
  dandelionMat.opacity = (0.58 + duskK * 0.22) * (1 - s.night * 0.9);

  // 雪山的光与雾全在它自己的着色器里，这里不用再染

  if (postfx) {
    postfx.grade.uniforms.uHeat.value = clamp(
      (1 - s.night) * smoothstep(9.8, 12.2, hh) * smoothstep(16.4, 13.6, hh), 0, 1
    );
  }

  if (farm && farm.setNight) farm.setNight(s.night);
  if (music) music.setNight(s.night);
  if (windGain && audioCtx) {
    windGain.gain.setTargetAtTime(0.15 - s.night * 0.05, audioCtx.currentTime, 2.5);
  }

  updateClock(s.hour);
  window.__hour = s.hour;
}

function updateTime(dt) {
  const arrived = time.update(dt);
  applyTime();

  envClock += dt;
  const dh = Math.abs(time.hour - envRefHour);
  if (envClock > 9 || dh > 0.35) {
    envClock = 0;
    envRefHour = time.hour;
    rebuildEnv();
  }
  if (arrived) showToast(arrived);
}

/* =========================================================
   12. 世界更新
   ========================================================= */

let lastPlaceName = '';

/* 风阵：隔一阵子放一次，草会像浪一样从远处推过来 */
let gustTimer = 4;
let gustAmp = 0;

function updateWorld(t, dt) {
  skyUniforms.uTime.value = t;
  skyMesh.position.copy(camera.position);
  sharedUniforms.uTime.value = t;

  gustTimer -= dt;
  if (gustTimer <= 0) {
    gustTimer = 8 + Math.random() * 9;
    gustAmp = 0.55 + Math.random() * 0.65;
  }
  gustAmp *= Math.exp(-dt * 0.5);
  sharedUniforms.uGust.value = gustAmp;
  sharedUniforms.uWind.value = 0.66 + Math.sin(t * 0.12) * 0.14 + gustAmp * 0.55;

  // 云影跟着风走
  sharedUniforms.uCloudOffset.value.x += dt * 0.0030 * (0.7 + gustAmp);
  sharedUniforms.uCloudOffset.value.y += dt * 0.0015 * (0.7 + gustAmp);

  // 阴影矩阵
  const shadowMap = sunLight.shadow.map;
  sharedUniforms.uShadowMap.value = NO_SHADOW || !shadowMap ? whitePixel : shadowMap.texture;
  sharedUniforms.uShadowMatrix.value.copy(sunLight.shadow.matrix);
  sharedUniforms.uShadowTexel.value = 1 / (sunLight.shadow.mapSize.x || 2048);

  // 阳光跟着玩家走，38 米的阴影范围才不浪费
  const gy = heightAt(player.x, player.z);
  // 阴影相机跟着人走，但必须吸附到阴影贴图的像素格上：
  // 否则网格每帧都在人脚下滑动，草和栅栏的阴影边缘会一直"爬"，看着就是闪
  snapShadowFocus(player.x, gy, player.z, SUN_DIR, _shadowFocus);
  sunLight.position.copy(_shadowFocus).addScaledVector(SUN_DIR, 150);
  sunLight.target.position.copy(_shadowFocus);
  sunLight.target.updateMatrixWorld();

  snapShadowFocus(player.x, gy, player.z, MOON_DIR, _shadowFocus);
  moonLight.position.copy(_shadowFocus).addScaledVector(MOON_DIR, 130);
  moonLight.target.position.copy(_shadowFocus);
  moonLight.target.updateMatrixWorld();

  // 细雪：斜着往下飘，落到地上就从头顶重新落一片
  const arr = pollenGeo.attributes.position.array;
  for (let i = 0; i < POLLEN_COUNT; i++) {
    const ix = i * 3;
    arr[ix] += (0.55 + Math.sin(t * 0.37 + pollenSeeds[i]) * 0.45) * dt * 0.85;
    arr[ix + 2] += (0.16 + Math.cos(t * 0.31 + pollenSeeds[i] * 1.3) * 0.3) * dt * 0.7;
    arr[ix + 1] -= (0.55 + (pollenSeeds[i] % 0.9)) * dt;

    let wrapped = false;
    if (arr[ix] - camera.position.x > 42) { arr[ix] -= 84; wrapped = true; }
    if (arr[ix] - camera.position.x < -42) { arr[ix] += 84; wrapped = true; }
    if (arr[ix + 2] - camera.position.z > 42) { arr[ix + 2] -= 84; wrapped = true; }
    if (arr[ix + 2] - camera.position.z < -42) { arr[ix + 2] += 84; wrapped = true; }

    if (wrapped || arr[ix + 1] < pollenGround[i] + 0.15) {
      pollenGround[i] = heightAt(arr[ix], arr[ix + 2]);
      arr[ix + 1] = pollenGround[i] + 3.0 + Math.random() * 8.0;
    }

    const ddx = arr[ix] - camera.position.x;
    const ddy = arr[ix + 1] - camera.position.y;
    const ddz = arr[ix + 2] - camera.position.z;
    if (ddx * ddx + ddy * ddy + ddz * ddz < 2.4) {
      const a = Math.random() * TAU;
      const r = 4 + Math.random() * 8;
      arr[ix] = camera.position.x + Math.cos(a) * r;
      arr[ix + 2] = camera.position.z + Math.sin(a) * r;
      pollenGround[i] = heightAt(arr[ix], arr[ix + 2]);
      arr[ix + 1] = pollenGround[i] + 0.3 + Math.random() * 2.5;
    }
  }
  pollenGeo.attributes.position.needsUpdate = true;

  // 蝴蝶：白天才出来，清晨要等露水干了
  const dayF = clamp((1 - timeState.night) * smoothstep(6.2, 8.6, timeState.hour), 0, 1);
  for (const b of butterflies) {
    const px = b.hx + Math.sin(t * b.speed + b.ph) * 5.2;
    const pz = b.hz + Math.sin(t * b.speed * 0.74 + b.ph * 1.7) * 5.2;
    const py = heightAt(px, pz) + b.yOff + Math.sin(t * 0.82 + b.ph) * 0.26;
    b.sprite.position.set(px, py, pz);
    const flap = 0.5 + Math.abs(Math.sin(t * b.flap + b.ph)) * 0.6;
    b.sprite.scale.set(b.baseScale * flap, b.baseScale, 1);
    b.sprite.material.rotation = Math.sin(t * 0.6 + b.ph) * 0.25;
    b.sprite.material.opacity = 0.95 * dayF;
    b.sprite.visible = dayF > 0.03;
  }

  // 蜜蜂：只在暖和的白天出工
  const beeF = clamp(smoothstep(2, 9, timeState.elev) * smoothstep(20.4, 18.0, timeState.hour), 0, 1);
  for (const b of bees) {
    const a = t * b.speed + b.ph;
    const px = b.hx + Math.cos(a) * b.radius;
    const pz = b.hz + Math.sin(a * 0.8) * b.radius;
    const py = heightAt(px, pz) + b.yOff + Math.sin(t * 6 + b.ph) * 0.08;
    b.sprite.position.set(px, py, pz);
    const s = b.baseScale * (0.85 + Math.abs(Math.sin(t * 24 + b.ph)) * 0.3);
    b.sprite.scale.setScalar(s);
    b.sprite.material.opacity = 0.95 * beeF;
    b.sprite.visible = beeF > 0.03;
  }

  // 蝙蝠：接蝴蝶的夜班
  const batOn = smoothstep(0.30, 0.72, timeState.night);
  for (const b of bats) {
    b.sprite.visible = batOn > 0.02;
    if (!b.sprite.visible) continue;
    const a = t * b.speed + b.ph;
    const x = b.cx + Math.cos(a) * b.radius;
    const z = b.cz + Math.sin(a * 0.9) * b.radius;
    b.sprite.position.set(x, heightAt(x, z) + b.height + Math.sin(t * 0.7 + b.ph) * 0.5, z);
    const flap = 0.55 + Math.abs(Math.sin(t * b.flap + b.ph)) * 0.5;
    b.sprite.scale.set(b.scale * 1.7 * flap, b.scale, 1);
    b.sprite.material.opacity = 0.85 * batOn;
  }

  updateMist(t);

  // 蒲公英种子
  const darr = dandelionGeo.attributes.position.array;
  for (let i = 0; i < DANDELION_COUNT; i++) {
    const ix = i * 3;
    darr[ix] += (0.42 + Math.sin(t * 0.29 + dandelionSeeds[i]) * 0.32) * dt;
    darr[ix + 2] += (0.12 + Math.cos(t * 0.23 + dandelionSeeds[i] * 1.4) * 0.22) * dt;
    darr[ix + 1] -= (0.42 + Math.sin(t * 0.5 + dandelionSeeds[i]) * 0.18) * dt;

    let wrapped = false;
    if (darr[ix] - camera.position.x > 38) { darr[ix] -= 76; wrapped = true; }
    else if (darr[ix] - camera.position.x < -38) { darr[ix] += 76; wrapped = true; }
    if (darr[ix + 2] - camera.position.z > 38) { darr[ix + 2] -= 76; wrapped = true; }
    else if (darr[ix + 2] - camera.position.z < -38) { darr[ix + 2] += 76; wrapped = true; }
    if (wrapped || darr[ix + 1] < dandelionGround[i] + 0.2) {
      dandelionGround[i] = heightAt(darr[ix], darr[ix + 2]);
      darr[ix + 1] = dandelionGround[i] + 2.6 + Math.random() * 7.0;
    }
  }
  dandelionGeo.attributes.position.needsUpdate = true;

  // 虫鸣跟着脚下的花海密度走，夜里收掉
  if (insectGain && audioCtx) {
    const seaHere = seaAt(player.x, player.z);
    insectGain.gain.setTargetAtTime(
      seaHere * 0.014 * (1 - timeState.night * 0.9),
      audioCtx.currentTime,
      0.7
    );
  }

  updateFireflies(t, dt);

  // 雪原：蒸汽、灯火、白狐
  snowPlaces.update(t, dt, {
    night: timeState.night,
    dusk: timeState.dusk,
    sun: timeState.sun,
    sky: timeState.hemiSky,
  });

  // 地点名
  const inFarm = Math.abs(player.x - FARM.x) < FARM.halfX + 0.5 && Math.abs(player.z - FARM.z) < FARM.halfZ + 0.5;
  const onIce = iceDist(player.x, player.z) < 0.985;
  const name = inFarm ? '雪中小屋' : onIce ? '冰湖' : '';
  if (name !== lastPlaceName) {
    lastPlaceName = name;
    placeEl.textContent = name;
    placeEl.classList.toggle('on', !!name);
    if (name === '雪中小屋') showToast('灶上还热着一壶水');
    else if (name === '冰湖') showToast('冰面很结实，可以一直走到对岸');
  }

  renderPrompt();
}

function updatePlayer(t, dt) {
  if (!started) {
    const y = heightAt(player.x, player.z) + EYE;
    camera.position.set(player.x, y + Math.sin(t * 0.4) * 0.03, player.z);
    camera.rotation.set(-0.02, player.yaw + Math.sin(t * 0.05) * 0.08, Math.sin(t * 0.2) * 0.004);
    return;
  }

  if (seated) {
    player.vx = 0;
    player.vz = 0;
    updateCartAudio(0, dt);
    camY = lerp(camY, heightAt(player.x, player.z) + 1.12, 1 - Math.exp(-dt * 10));
    camera.position.set(player.x, camY, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    return;
  }

  let ix = 0;
  let iz = 0;
  if (!paused) {
    // 用自定义键位；方向键始终可用，作为兜底
    if (held.has(binds.forward) || held.has('ArrowUp')) iz -= 1;
    if (held.has(binds.back) || held.has('ArrowDown')) iz += 1;
    if (held.has(binds.left) || held.has('ArrowLeft')) ix -= 1;
    if (held.has(binds.right) || held.has('ArrowRight')) ix += 1;
  }

  const run = held.has(binds.run) || held.has('ShiftRight');
  const maxSpeed = (run ? 3.9 : 2.1) * (pushingCart ? 0.72 : 1);

  const len = Math.hypot(ix, iz) || 1;
  ix /= len;
  iz /= len;

  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  const targetVx = (ix * cos + iz * sin) * maxSpeed;
  const targetVz = (iz * cos - ix * sin) * maxSpeed;
  const accel = 1 - Math.exp(-dt * 9);
  player.vx += (targetVx - player.vx) * accel;
  player.vz += (targetVz - player.vz) * accel;

  let nx = player.x + player.vx * dt;
  let nz = player.z + player.vz * dt;

  // 农场、栅栏、菜畦
  const res = farm.resolve(nx, nz, PLAYER_R);
  nx = res.x;
  nz = res.z;

  // 羊和牛：不让镜头穿过去
  for (const a of herd.animals) {
    const dx = nx - a.x;
    const dz = nz - a.z;
    const d = Math.hypot(dx, dz);
    const minD = a.radius + PLAYER_R;
    if (d < minD && d > 1e-4) {
      nx = a.x + (dx / d) * minD;
      nz = a.z + (dz / d) * minD;
    }
  }

  player.x = nx;
  player.z = nz;

  // 谷仓门：走到门口就推开，进屋后自己关上
  const toDoorX = farm.door.x - player.x;
  const toDoorZ = farm.door.z - player.z;
  const doorD = Math.hypot(toDoorX, toDoorZ);
  if (!farm.isDoorOpen() && doorD < 1.5 && player.vx * toDoorX + player.vz * toDoorZ > 0.02) {
    farm.pushDoor();
    doorCloseT = 0;
    sfxDoor();
    cloudQueueSave();
  }
  if (farm.isDoorOpen()) {
    doorCloseT += dt;
    if (doorCloseT > 2.4 && doorD > 1.65) {
      farm.closeDoor();
      doorCloseT = 0;
      sfxDoor();
      cloudQueueSave();
    }
  } else {
    doorCloseT = 0;
  }

  const radius = Math.hypot(player.x, player.z);
  if (radius > WORLD.radius) {
    player.x *= WORLD.radius / radius;
    player.z *= WORLD.radius / radius;
  }

  // 推着的小车跟在身前
  if (pushingCart) {
    const fwdX = -Math.sin(player.yaw) * 1.18;
    const fwdZ = -Math.cos(player.yaw) * 1.18;
    farm.moveCart(player.x + fwdX, player.z + fwdZ, player.yaw, dt);
  }

  const speed = Math.hypot(player.vx, player.vz);
  updateCartAudio(pushingCart ? speed : 0, dt);
  player.bob += dt * speed * 3.0;

  const lift = farm.floorLift(player.x, player.z);
  camY = lerp(camY, heightAt(player.x, player.z) + lift + EYE, 1 - Math.exp(-dt * 12));

  const bobAmt = Math.min(speed / 2.1, 1);
  const bobY = Math.sin(player.bob) * 0.022 * bobAmt;
  const bobX = Math.sin(player.bob * 0.5) * 0.011 * bobAmt;

  camera.position.set(
    player.x + bobX * Math.cos(player.yaw),
    camY + bobY,
    player.z - bobX * Math.sin(player.yaw)
  );
  const roll = Math.sin(player.bob * 0.5) * 0.004 * bobAmt;
  camera.rotation.set(player.pitch, player.yaw, roll, 'YXZ');
  camera.position.y += Math.sin(t * 0.7) * 0.0035;

  ensureChunks(player.x, player.z);
}

/* =========================================================
   13. 主循环
   ========================================================= */

const postfx = createPostFX(renderer, scene, camera);

let lastFrame = performance.now();
let elapsed = 0;
let fpsClock = 0;
let fpsFrames = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  elapsed += dt;

  updateTime(dt);
  updatePlayer(elapsed, dt);
  updateWorld(elapsed, dt);

  // 小推车在半路自动装车的事件
  const events = farm.pollEvents();
  for (const ev of events) {
    if (ev.type === 'collect') {
      updateStock();
      sfxLoad(ev.crop);
    } else if (ev.type === 'full') {
      showToast('车斗满了 · 先运回粮仓');
    }
  }
  if (events.length) cloudQueueSave();

  postfx.setSun(SUN_DIR, camera);
  // 太阳落到地下以后就别再拉光柱了，否则夜里会凭空出现一道极光
  postfx.grade.uniforms.uSunVis.value *= clamp(1 - timeState.night * 1.35, 0, 1);
  postfx.grade.uniforms.uDusk.value = timeState.dusk;
  postfx.render(dt, elapsed);

  fpsClock += dt;
  fpsFrames++;
  if (fpsClock >= 1) {
    window.__fps = Math.round(fpsFrames / fpsClock);
    fpsClock = 0;
    fpsFrames = 0;
  }
}

/* =========================================================
   14. 初始化
   ========================================================= */

updateStock();
updateStorage();
updateWater();
setSeedUI();
applyTime();
ensureChunks(player.x, player.z, 21);
requestAnimationFrame(animate);

// 云端存档：有令牌就尝试拉取；游戏开始后每 20 秒自动同步
if (!new URLSearchParams(location.search).has('still')) cloudBoot();
setInterval(() => {
  if (started && cloudToken) cloudSave();
}, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cloudToken) cloudSave(true);
});
window.addEventListener('pagehide', () => {
  if (cloudToken) cloudSave(true);
});

// 调试 / 截图：?still 直接站进雪原
if (new URLSearchParams(location.search).has('still')) {
  started = true;
  body.classList.add('started');
  introEl.classList.add('hidden');
  const p = new URLSearchParams(location.search);
  if (p.has('x')) player.x = parseFloat(p.get('x'));
  if (p.has('z')) player.z = parseFloat(p.get('z'));
  if (p.has('yaw')) player.yaw = parseFloat(p.get('yaw'));
  if (p.has('pitch')) player.pitch = parseFloat(p.get('pitch'));
  if (p.has('hour')) time.setHour(parseFloat(p.get('hour')));   // 调试：定点到某个时辰
  if (p.has('clean')) body.classList.add('clean');

  // 调试 / 截图：?menu 直接打开设置菜单，?panel=keys|world 直达子面板
  if (p.has('menu')) {
    setTimeout(() => openMenu(), 900);
    if (p.has('panel')) setTimeout(() => showPanel(p.get('panel')), 1200);
  }

  // 调试：?selftest 跑一遍菜单 + 改键的完整链路，结果写进标题
  if (p.has('selftest')) {
    setTimeout(() => {
      const log = [];
      try {
        openMenu();
        log.push('menu=' + pauseEl.classList.contains('show'));
        document.getElementById('btn-keys').click();
        log.push('panel=' + (document.querySelector('.panel.on') || {}).id);
        const btn = document.querySelector('.bind-key[data-bind="forward"]');
        btn.click();
        log.push('listen=' + (btn.textContent === '按下新键…'));
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', key: 'i', bubbles: true }));
        log.push('bound=' + binds.forward);
        log.push('label=' + btn.textContent);
        document.getElementById('btn-save').click();
        log.push('tip=' + menuTipEl.classList.contains('on'));
        closeMenu();
        log.push('closed=' + !pauseEl.classList.contains('show'));
        log.push('err=' + window.__err.length);
      } catch (e) {
        log.push('EX:' + e.message);
      }
      document.title = log.join(' | ');
    }, 1800);
  }

  // 截图取景：把镜头和一只动物摆到固定位置，方便检查建模
  const focus = p.get('focus');
  if (focus === 'sheep') {
    player.x = -2.2;
    player.z = 0.2;
    player.yaw = 0.695;
    player.pitch = -0.2;
    const a = herd.animals[0];
    a.x = -4.2;
    a.z = -2.2;
    a.state = 'look';
    a.timer = 999;
    a.headPitch = 0.13;
    a.yaw = Math.atan2(-(player.x - a.x), -(player.z - a.z));
    a.root.position.set(a.x, heightAt(a.x, a.z), a.z);
  } else if (focus === 'cow') {
    player.x = 11.2;
    player.z = -10.0;
    player.yaw = 0.876;
    player.pitch = -0.2;
    const a = herd.animals[4];
    a.x = 8.8;
    a.z = -12.0;
    a.state = 'look';
    a.timer = 999;
    a.headPitch = 0.13;
    a.yaw = Math.atan2(-(player.x - a.x), -(player.z - a.z));
    a.root.position.set(a.x, heightAt(a.x, a.z), a.z);
  } else if (focus === 'farm') {
    player.x = 18.25;
    player.z = -26.0;
    player.yaw = -Math.PI / 2;
    player.pitch = -0.24;
  }

  if (p.has('seed')) {
    farm.setSelected(parseInt(p.get('seed'), 10) || 0);
    setSeedUI();
  }
  if (p.has('h')) {
    time.setHour(parseFloat(p.get('h')));
    applyTime();
    envRefHour = time.hour;
    rebuildEnv();
  }

  camY = heightAt(player.x, player.z) + EYE;
  ensureChunks(player.x, player.z, 999);
  if (p.has('nofx')) {
    pollen.visible = false;
    for (const b of butterflies) b.sprite.visible = false;
    for (const b of bees) b.sprite.visible = false;
    dandelions.visible = false;
    fireflies.visible = false;
  }
  // 调试：分别关掉天空 / 光柱 / 雪山，排查画面里的条纹与分层
  if (p.has('nomtn')) snowRange.mesh.visible = false;
  if (p.has('skyno')) skyMesh.visible = false;
  if (p.has('norays')) postfx.grade.uniforms.uSunVis.value = 0;
  if (p.has('cloud')) { cloudBoost = parseFloat(p.get('cloud')) || 1; applyTime(); }
  if (p.has('nograss')) {
    for (const [, chunk] of chunks) {
      chunk.group.traverse((o) => {
        if (o.isInstancedMesh) o.visible = false;
      });
    }
  }
  setTimeout(() => {
    const err = window.__err.length ? ' :: ' + window.__err[0].slice(0, 240) : '';
    document.title = `GRASS:fps=${window.__fps || 0}:beds=${farm.beds.length}:sel=${farm.getSelected()}:h=${timeState.hour.toFixed(1)}:err=${window.__err.length}${err}`;
  }, 3000);
}

window.__grass = {
  player, farm, herd, heightAt, CROPS, updatePlayer, held, playAnimalSound,
  binds, openMenu, closeMenu, showPanel, time,
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  fireflyMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  postfx.resize();
});
