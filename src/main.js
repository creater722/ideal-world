import * as THREE from 'three';
import {
  TAU, clamp, lerp, smoothstep, hash2, valueNoise, fbm, mulberry32,
  heightAt, lakeDist, shoreAmount, LAKE, SITES, WORLD,
} from './core.js';
import { createPostFX } from './postfx.js';
import { createPlaces } from './places.js';
import { createMusic } from './music.js';
import { computeCalendar, YEAR_SEC } from './seasons.js';
import { createWeather } from './weather.js';

/* =========================================================
   理想的世界
   一片写实的原野：真阴影、真空气、真水面，
   三个可以走进去的地方，和一层一直在响的音乐。
   ========================================================= */

const canvas = document.getElementById('scene');

// 出错就在标题栏留个记号，否则黑屏时完全不知道发生了什么
window.__err = [];
window.addEventListener('error', (e) => {
  window.__err.push(String(e.message));
  document.title = 'ERR:' + e.message;
});
window.addEventListener('unhandledrejection', (e) => {
  window.__err.push('REJ:' + String(e.reason));
  document.title = 'REJ:' + String(e.reason);
});

/* ---------------- 1. 渲染器 ---------------- */
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
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const FOG_COLOR = 0xd9dcc9;
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0058);

const camera = new THREE.PerspectiveCamera(61, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.layers.enable(1);
camera.rotation.order = 'YXZ';

const SUN_DIR = new THREE.Vector3(0.46, 0.43, -0.78).normalize();
const MOON_DIR = new THREE.Vector3(-0.42, 0.51, 0.72).normalize();

const whitePixel = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
whitePixel.needsUpdate = true;

const NO_SHADOW = new URLSearchParams(location.search).has('noshadow');

/* ---------------- 季节 / 天气 ---------------- */
const QS = new URLSearchParams(location.search);
let yearSec = YEAR_SEC;
if (QS.has('yearsec')) yearSec = clamp(parseFloat(QS.get('yearsec')), 60, 86400);
let yearOffset = 0; // 调试用：把历法拨到指定节气/季节
const weather = createWeather(scene);
let calendar = computeCalendar(0, yearSec);

/* ---------------- 2. 天空 ---------------- */
const skyUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: SUN_DIR.clone() },
  uMoonDir: { value: MOON_DIR.clone() },
  uZenith: { value: new THREE.Color(0x3f7fc4) },
  uHorizon: { value: new THREE.Color(0xf7eed0) },
  uHaze: { value: new THREE.Color(0xffdfae) },
  uSunColor: { value: new THREE.Color(0xfff0c8) },
  uCloud: { value: new THREE.Color(0xfffaf0) },
  uNight: { value: 0 },
  uCover: { value: 0.42 },
  uDusk: { value: 0 },
  uMoonBoost: { value: 0 },
  uStarBoost: { value: 0 },
};

const skyFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uMoonDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSunColor;
  uniform vec3 uCloud;
  uniform float uNight;
  uniform float uCover;
  uniform float uDusk;
  uniform float uMoonBoost;
  uniform float uStarBoost;
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

    // 天顶到地平线：蓝要出现得快一点，否则整片天是米白的
    vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.42, up), 0.55));
    // 贴地的一层雾霭
    col = mix(col, uHaze, exp(-max(dir.y, 0.0) * 11.0) * 0.20);

    // 云：两层不同尺度，高层慢
    if (dir.y > 0.008) {
      vec2 cp = dir.xz / (dir.y + 0.16) * 1.35;
      vec2 drift = vec2(uTime * 0.0022, uTime * 0.0009);
      float base = fbm2(cp * 0.58 + drift);
      float detail = fbm2(cp * 1.65 + drift * 2.4 + 11.0);
      float c = base * 0.55 + detail * 0.45;

      // 阈值决定云量：低了是一整片白，高了才有云块
      float thr = 0.72 - uCover * 0.16;
      float cover = smoothstep(thr, thr + 0.155, c);
      cover *= smoothstep(0.006, 0.11, dir.y);

      // 云底压暗、朝上一侧受光，才有体积
      float lit = smoothstep(thr, thr + 0.26, c);
      // 黄昏时云暗面转紫灰、亮面吃满暖光 —— 这是"逢魔之时"最关键的一笔
      vec3 shade = uCloud * (0.44 + 0.14 * uNight) * mix(vec3(1.0), vec3(0.60, 0.52, 0.74), uDusk);
      vec3 litCol = mix(uCloud * 1.12, uSunColor, 0.32 + uDusk * 0.58);
      vec3 cloudCol = mix(shade, litCol, lit);

      // 逆光时的银边 / 金边
      float back = pow(max(dot(dir, uSunDir), 0.0), 5.0);
      cloudCol += uSunColor * back * (1.0 - lit) * (0.42 + uDusk * 0.95);

      col = mix(col, cloudCol, cover * 0.72);
    }

    // 黄昏：太阳那一侧的地平线被烧成金橙，背对的一侧仍是冷青。
    // 一侧暖一侧冷，黄昏才立得住，否则就是整体加了个橙色滤镜。
    if (uDusk > 0.002) {
      vec3 flatDir = normalize(vec3(dir.x, 0.0001, dir.z));
      vec3 flatSun = normalize(vec3(uSunDir.x, 0.0001, uSunDir.z));
      float toward = max(dot(flatDir, flatSun), 0.0);
      float lowBand = exp(-max(dir.y, 0.0) * 5.2);
      float warm = pow(toward, 3.4) * lowBand * uDusk;
      col = mix(col, uSunColor * 1.15, warm * 0.46);
      float away = pow(max(-dot(flatDir, flatSun), 0.0), 1.5) * lowBand * uDusk;
      col = mix(col, vec3(0.26, 0.23, 0.38), away * 0.26);
    }

    // 太阳：小圆盘 + 两层光晕（亮度必须收敛，否则 Bloom 会把整片天洗白）
    float sd = max(dot(dir, uSunDir), 0.0);
    // 黄昏时太阳被厚大气削弱，是个柔和橙球，不是刺眼白点
    float sunPeak = mix(5.2, 2.0, uDusk);
    float sunShade = 1.0 - uCover * 0.85; // 阴天云把太阳藏起来
    col += uSunColor * (pow(sd, 14000.0) * sunPeak + pow(sd, 460.0) * mix(0.16, 0.26, uDusk) + pow(sd, 12.0) * 0.035) * sunShade;

    // 星空
    if (uNight > 0.01 && dir.y > 0.02) {
      vec2 sph = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0))) * 230.0;
      vec2 id = floor(sph);
      vec2 f = fract(sph) - 0.5;
      float h = hash(id);
      float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + h * 63.0);
      float starDense = mix(0.972, 0.958, uStarBoost);
      float star = smoothstep(0.06, 0.0, length(f)) * step(starDense, h) * twinkle;
      // 银河：一条淡淡的带
      float band = exp(-pow((dir.x * 0.7 + dir.z * 0.7) * 3.2, 2.0));
      col += vec3(0.80, 0.86, 1.0) * star * uNight * smoothstep(0.02, 0.2, dir.y) * 1.4;
      col += vec3(0.34, 0.38, 0.52) * band * uNight * (0.055 + uStarBoost * 0.06) * smoothstep(0.05, 0.4, dir.y);
    }

    // 月亮
    if (uNight > 0.01) {
      float md = max(dot(dir, uMoonDir), 0.0);
      col += vec3(1.0, 0.97, 0.89) * (pow(md, 9000.0) * (7.0 + uMoonBoost * 6.0) + pow(md, 420.0) * (0.24 + uMoonBoost * 0.5)) * uNight;
    }

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

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(2900, 48, 28),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: skyVert,
    fragmentShader: skyFrag,
  })
);
sky.frustumCulled = false;
scene.add(sky);

/* 单独一份天空，用来烘环境贴图 */
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

/* ---------------- 3. 环境贴图（IBL） ---------------- */
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
let envRT = null;
let envPending = false;

function rebuildEnv() {
  if (envPending) return;
  envPending = true;
  // 让出一帧，避免和主循环抢时间
  setTimeout(() => {
    envPending = false;
    const old = envRT;
    envRT = pmrem.fromScene(envScene, 0, 0.1, 60);
    scene.environment = envRT.texture;
    if (old) old.dispose();
  }, 0);
}

/* ---------------- 4. 灯光 ---------------- */
const sunLight = new THREE.DirectionalLight(0xffe6b4, 3.0);
sunLight.position.copy(SUN_DIR).multiplyScalar(180);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 460;
const SHADOW_SPAN = 62;
sunLight.shadow.camera.left = -SHADOW_SPAN;
sunLight.shadow.camera.right = SHADOW_SPAN;
sunLight.shadow.camera.top = SHADOW_SPAN;
sunLight.shadow.camera.bottom = -SHADOW_SPAN;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.035;
sunLight.shadow.radius = 2.2;
// 改完 left/right/top/bottom 必须重算投影矩阵，否则还是默认的 10×10 米
sunLight.shadow.camera.updateProjectionMatrix();
scene.add(sunLight);
scene.add(sunLight.target);

const hemiLight = new THREE.HemisphereLight(0xbcd6f2, 0x4e5a30, 0.95);
scene.add(hemiLight);

/* ---------------- 5. 时间与天光 ---------------- */
const TIME_KEYS = [
  { h: 0.0, elev: -26, az: 84, sun: 0x8fa6c6, sunI: 0.07, zenith: 0x060f1d, horizon: 0x131f30, haze: 0x1c2a3a, cloud: 0x33445a, fog: 0x121b26, fogD: 0.0072, hemiSky: 0x1b2a42, hemiGround: 0x0c1109, hemiI: 0.32, expo: 1.05, cover: 0.3 },
  { h: 4.9, elev: -7, az: 62, sun: 0xb9877a, sunI: 0.12, zenith: 0x152846, horizon: 0x4b586e, haze: 0x6c6374, cloud: 0x69718a, fog: 0x2f3947, fogD: 0.0070, hemiSky: 0x2f4262, hemiGround: 0x121810, hemiI: 0.42, expo: 1.03, cover: 0.42 },
  { h: 6.3, elev: 3, az: -62, sun: 0xffb07a, sunI: 0.9, zenith: 0x35608f, horizon: 0xffbe93, haze: 0xffc9a2, cloud: 0xffc9b0, fog: 0xd2a68c, fogD: 0.0068, hemiSky: 0x7a8db2, hemiGround: 0x2a3220, hemiI: 0.6, expo: 1.02, cover: 0.5 },
  { h: 8.8, elev: 33, az: -38, sun: 0xffe8bc, sunI: 2.7, zenith: 0x3e81c6, horizon: 0xf6edd4, haze: 0xffe4bd, cloud: 0xfff9ef, fog: 0xd9dcc9, fogD: 0.0058, hemiSky: 0xb7d2ef, hemiGround: 0x53622c, hemiI: 0.92, expo: 1.02, cover: 0.4 },
  { h: 12.5, elev: 61, az: 6, sun: 0xfff5da, sunI: 3.3, zenith: 0x2f74bd, horizon: 0xf2ecd8, haze: 0xffeac6, cloud: 0xfffdf6, fog: 0xd6dbc8, fogD: 0.0052, hemiSky: 0xbcd6f2, hemiGround: 0x5a6830, hemiI: 1.02, expo: 1.0, cover: 0.34 },
  { h: 16.4, elev: 27, az: 34, sun: 0xffeab8, sunI: 3.0, zenith: 0x3f7fc4, horizon: 0xf7eed0, haze: 0xffdfae, cloud: 0xfffaf0, fog: 0xd9dcc9, fogD: 0.0058, hemiSky: 0xbcd6f2, hemiGround: 0x5a6830, hemiI: 0.95, expo: 1.02, cover: 0.42 },
  { h: 18.0, elev: 12, az: 38, sun: 0xffbf74, sunI: 2.2, zenith: 0x557fa8, horizon: 0xffd09a, haze: 0xffb775, cloud: 0xffd2b4, fog: 0xe0b896, fogD: 0.0066, hemiSky: 0x93a5c6, hemiGround: 0x474426, hemiI: 0.72, expo: 1.03, cover: 0.5 },
  { h: 18.45, elev: 7.5, az: 40, sun: 0xffb264, sunI: 1.95, zenith: 0x3d6b96, horizon: 0xffc98f, haze: 0xffb078, cloud: 0xffd0b0, fog: 0xe6b48e, fogD: 0.0068, hemiSky: 0x8a9fc0, hemiGround: 0x4c4428, hemiI: 0.66, expo: 1.02, cover: 0.56 },
  { h: 19.0, elev: 2, az: 44, sun: 0xff9a52, sunI: 1.4, zenith: 0x45658f, horizon: 0xffbd82, haze: 0xff9f5f, cloud: 0xffc39c, fog: 0xdcab86, fogD: 0.0070, hemiSky: 0x7f8cae, hemiGround: 0x3c3720, hemiI: 0.6, expo: 1.0, cover: 0.52 },
  { h: 19.42, elev: -0.5, az: 47, sun: 0xff8a52, sunI: 1.0, zenith: 0x2f4a72, horizon: 0xff9d6c, haze: 0xff8856, cloud: 0xf5ac96, fog: 0xd49c84, fogD: 0.0072, hemiSky: 0x6c7ca4, hemiGround: 0x352e1c, hemiI: 0.58, expo: 1.0, cover: 0.52 },
  { h: 19.8, elev: -2, az: 50, sun: 0xff7d45, sunI: 0.7, zenith: 0x3a5784, horizon: 0xff9a64, haze: 0xff7d48, cloud: 0xf3a98c, fog: 0xcc9578, fogD: 0.0074, hemiSky: 0x66779c, hemiGround: 0x2e2a1b, hemiI: 0.5, expo: 1.0, cover: 0.46 },
  { h: 20.7, elev: -8, az: 56, sun: 0xe98a68, sunI: 0.22, zenith: 0x273e60, horizon: 0x9c6555, haze: 0xa3654c, cloud: 0x8a7680, fog: 0x7c5b56, fogD: 0.0076, hemiSky: 0x44567a, hemiGround: 0x1d2216, hemiI: 0.48, expo: 1.02, cover: 0.4 },
  { h: 21.7, elev: -17, az: 62, sun: 0x9fb6d8, sunI: 0.1, zenith: 0x0d2039, horizon: 0x21344c, haze: 0x2a3c52, cloud: 0x44556b, fog: 0x1e2e40, fogD: 0.0072, hemiSky: 0x3a5478, hemiGround: 0x121810, hemiI: 0.5, expo: 1.04, cover: 0.34 },
  { h: 23.3, elev: -25, az: 68, sun: 0x8fa6c6, sunI: 0.07, zenith: 0x07111f, horizon: 0x162334, haze: 0x1e2c3d, cloud: 0x36475c, fog: 0x141d27, fogD: 0.0071, hemiSky: 0x2a405e, hemiGround: 0x0e1410, hemiI: 0.46, expo: 1.05, cover: 0.3 },
];

for (const k of TIME_KEYS) {
  k.cSun = new THREE.Color(k.sun);
  k.cZenith = new THREE.Color(k.zenith);
  k.cHorizon = new THREE.Color(k.horizon);
  k.cHaze = new THREE.Color(k.haze);
  k.cCloud = new THREE.Color(k.cloud);
  k.cFog = new THREE.Color(k.fog);
  k.cHemiSky = new THREE.Color(k.hemiSky);
  k.cHemiGround = new THREE.Color(k.hemiGround);
}

const timeState = {
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  haze: new THREE.Color(),
  cloud: new THREE.Color(),
  sun: new THREE.Color(),
  fog: new THREE.Color(),
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  sunI: 0,
  hemiI: 0,
  fogD: 0,
  expo: 1,
  elev: 0,
  az: 0,
  cover: 0.4,
  dusk: 0,
};

let hour = 16.6;
let timeJump = null;
let nightAmount = 0;
let duskAmount = 0;
let envClock = 0;
let envRefHour = -99;

function sampleTime(h) {
  h = ((h % 24) + 24) % 24;
  let i = 0;
  while (i < TIME_KEYS.length - 1 && TIME_KEYS[i + 1].h <= h) i++;
  const a = TIME_KEYS[i];
  let b = TIME_KEYS[i + 1];
  let span;
  if (!b) {
    b = TIME_KEYS[0];
    span = 24 - a.h;
  } else {
    span = b.h - a.h;
  }
  let t = clamp((h - a.h) / span, 0, 1);
  t = t * t * (3 - 2 * t);

  timeState.zenith.lerpColors(a.cZenith, b.cZenith, t);
  timeState.horizon.lerpColors(a.cHorizon, b.cHorizon, t);
  timeState.haze.lerpColors(a.cHaze, b.cHaze, t);
  timeState.cloud.lerpColors(a.cCloud, b.cCloud, t);
  timeState.sun.lerpColors(a.cSun, b.cSun, t);
  timeState.fog.lerpColors(a.cFog, b.cFog, t);
  timeState.hemiSky.lerpColors(a.cHemiSky, b.cHemiSky, t);
  timeState.hemiGround.lerpColors(a.cHemiGround, b.cHemiGround, t);
  timeState.sunI = lerp(a.sunI, b.sunI, t);
  timeState.hemiI = lerp(a.hemiI, b.hemiI, t);
  timeState.fogD = lerp(a.fogD, b.fogD, t) * 0.34;
  timeState.expo = lerp(a.expo, b.expo, t);
  timeState.elev = lerp(a.elev, b.elev, t);
  timeState.az = lerp(a.az, b.az, t);
  timeState.cover = lerp(a.cover, b.cover, t);
}

function phaseName(h) {
  if (h < 4.9) return '深夜';
  if (h < 6.8) return '拂晓';
  if (h < 10.8) return '清晨';
  if (h < 13.6) return '正午';
  if (h < 17.3) return '午后';
  if (h < 18.6) return '金色时刻';
  if (h < 20.2) return '黄昏';
  if (h < 22.4) return '夜晚';
  return '深夜';
}

let lastClockText = '';
const clockEl = document.getElementById('clock');
const placeEl = document.getElementById('place');
const wxEl = document.getElementById('wx');

function weatherName(w) {
  if (w.snow > 0.25) return '雪';
  if (w.rain > 0.6) return '大雨';
  if (w.rain > 0.15) return '雨';
  if (w.fog > 0.45) return '雾';
  if (w.cloud > 0.62) return '阴';
  if (w.cloud > 0.32) return '多云';
  return '晴';
}

let lastWxText = '';
function updateWeatherHud() {
  if (!wxEl) return;
  const fest = calendar.mainFestival;
  const text = `${calendar.seasonName} · ${calendar.term} · ${weatherName(weather.state)}${fest ? ' · <span class="fest">' + fest.name + '</span>' : ''}`;
  if (text !== lastWxText) {
    lastWxText = text;
    wxEl.innerHTML = text;
  }
}

let snowCover = 0;
let seasonClock = 1;
let lastAppliedSnow = -1;
let lastAppliedSeason = -1;
let hudClock = 1;

function updateClock(h) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const text = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${phaseName(h)}`;
  if (text !== lastClockText) {
    lastClockText = text;
    if (clockEl) clockEl.textContent = text;
  }
}

const C_WEATHER_ZENITH = new THREE.Color(0x9aa4ae);
const C_WEATHER_HORIZON = new THREE.Color(0xc9c8bd);
const C_WEATHER_FOG = new THREE.Color(0xc4c6c2);
const C_SPRING_ZENITH = new THREE.Color(0x8fc4e8);
const C_SPRING_HORIZON = new THREE.Color(0xfff2d2);
const C_AUTUMN_HORIZON = new THREE.Color(0xffd9a0);
const C_AUTUMN_HAZE = new THREE.Color(0xffc98a);
const C_WINTER_ZENITH = new THREE.Color(0xa8c2d8);
const C_WINTER_SUN = new THREE.Color(0xfff2e0);
const FIREFLY_SEASON = [0.55, 1, 0.75, 0.12]; // 萤火虫夏天最多
const POLLEN_SEASON = [0.6, 0.32, 0.12, 0];  // 花粉春天最盛

function applyTime() {
  const h = ((hour % 24) + 24) % 24;
  sampleTime(h);

  // 天气改写天光：阴天吃光，雨雪把天顶压灰、雾加浓
  const wx = weather.state;
  timeState.sunI *= 1 - 0.62 * wx.cloud;
  timeState.hemiI *= 1 - 0.45 * wx.cloud;
  timeState.cover = clamp(timeState.cover + wx.cloud * 0.42, 0, 0.95);
  const wetFog = wx.fog * 0.8 + wx.rain * 0.42 + wx.snow * 0.4;
  timeState.fogD = timeState.fogD * (1 + wetFog * 1.5) + wetFog * 0.0024;
  const grey = wx.rain * 0.6 + wx.snow * 0.72 + wx.fog * 0.35;
  if (grey > 0.002) {
    timeState.zenith.lerp(C_WEATHER_ZENITH, grey);
    timeState.horizon.lerp(C_WEATHER_HORIZON, grey);
    timeState.fog.lerp(C_WEATHER_FOG, grey);
  }
  timeState.expo = clamp(timeState.expo - wx.cloud * 0.1, 0.82, 1.08);

  // 季节色调：春青嫩、秋金暖、冬清冷
  const s = calendar.season;
  if (s === 0) {
    timeState.zenith.lerp(C_SPRING_ZENITH, 0.1);
    timeState.horizon.lerp(C_SPRING_HORIZON, 0.06);
  } else if (s === 2) {
    timeState.horizon.lerp(C_AUTUMN_HORIZON, 0.2);
    timeState.haze.lerp(C_AUTUMN_HAZE, 0.16);
  } else if (s === 3) {
    timeState.zenith.lerp(C_WINTER_ZENITH, 0.12);
    timeState.sun.lerp(C_WINTER_SUN, 0.1);
  }

  const elev = (timeState.elev * Math.PI) / 180;
  const az = (timeState.az * Math.PI) / 180;
  SUN_DIR.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev));
  MOON_DIR.set(-SUN_DIR.x * 0.9, clamp(-SUN_DIR.y + 0.35, 0.15, 0.9), -SUN_DIR.z * 0.9).normalize();

  // 阴影相机跟着人走，4096 的贴图才不会浪费在空地上
  const gy = heightAt(player.x, player.z);
  sunLight.position.set(player.x, gy, player.z).addScaledVector(SUN_DIR, 190);
  sunLight.target.position.set(player.x, gy, player.z);
  sunLight.target.updateMatrixWorld();

  skyUniforms.uSunDir.value.copy(SUN_DIR);
  skyUniforms.uMoonDir.value.copy(MOON_DIR);
  skyUniforms.uZenith.value.copy(timeState.zenith);
  skyUniforms.uHorizon.value.copy(timeState.horizon);
  skyUniforms.uHaze.value.copy(timeState.haze);
  skyUniforms.uCloud.value.copy(timeState.cloud);
  skyUniforms.uSunColor.value.copy(timeState.sun);
  skyUniforms.uNight.value = smoothstep(-1, -10, timeState.elev);
  skyUniforms.uCover.value = timeState.cover;

  // 逢魔之时：太阳从 +15° 落到地平线下 8° 这一段，色彩变化最剧烈
  duskAmount = smoothstep(15, 5, timeState.elev) * smoothstep(-8, 1.5, timeState.elev);
  skyUniforms.uDusk.value = duskAmount;
  timeState.dusk = duskAmount;

  sharedUniforms.uSunColor.value.copy(timeState.sun);
  sharedUniforms.uSunI.value = clamp(timeState.sunI / 3.0, 0.05, 1.2);
  sharedUniforms.uSkyColor.value.copy(timeState.hemiSky);
  sharedUniforms.uFogColor.value.copy(timeState.fog);
  sharedUniforms.uFogDensity.value = timeState.fogD;
  sharedUniforms.uSunDir.value.copy(SUN_DIR);

  scene.fog.color.copy(timeState.fog);
  scene.fog.density = timeState.fogD;

  sunLight.color.copy(timeState.sun);
  sunLight.intensity = timeState.sunI * 1.05;
  hemiLight.color.copy(timeState.hemiSky);
  hemiLight.groundColor.copy(timeState.hemiGround);
  hemiLight.intensity = timeState.hemiI;
  renderer.toneMappingExposure = timeState.expo + thunderFlash * 0.55;

  nightAmount = smoothstep(9, -3, timeState.elev);
  // 萤火虫要等天真的暗下来，黄昏时出来是穿帮；夏天最多，冬天几乎绝迹
  fireflyMat.uniforms.uOpacity.value = smoothstep(4, -5, timeState.elev) * 0.95 * FIREFLY_SEASON[calendar.season];

  updateClock(h);
  window.__hour = h;
}

const TIME_ANCHORS = [
  { h: 18.99, line: '太阳落下去之后，湖面会安静很久。' },
  { h: 21.7, line: '萤火虫出来了。' },
  { h: 6.3, line: '天快亮了。' },
  { h: 12.5, line: '正午的光太亮，草都低下头。' },
  { h: 18.0, line: '光开始变软了。' },
];

function skipTime() {
  if (timeJump) return;
  const h = ((hour % 24) + 24) % 24;
  let anchor = TIME_ANCHORS.find((a) => a.h > h + 0.25);
  let to = anchor ? anchor.h : TIME_ANCHORS[0].h + 24;
  if (!anchor) anchor = TIME_ANCHORS[0];
  const diff = to - h;
  timeJump = {
    from: hour,
    diff,
    elapsed: 0,
    duration: clamp(diff * 3.4, 6, 13),
    line: anchor.line,
  };
}

function updateTime(dt) {
  if (timeJump) {
    timeJump.elapsed += dt;
    const t = clamp(timeJump.elapsed / timeJump.duration, 0, 1);
    const e = t * t * (3 - 2 * t);
    hour = timeJump.from + timeJump.diff * e;
    if (t >= 1) {
      const line = timeJump.line;
      timeJump = null;
      showLine(line);
      rebuildEnv();
    }
  } else {
    hour += dt / 120;
  }

  applyTime();

  // 环境贴图节流重建：每 9 秒，或时间跨过 0.35 小时
  envClock += dt;
  const dh = Math.abs(hour - envRefHour);
  if (envClock > 9 || dh > 0.35) {
    envClock = 0;
    envRefHour = hour;
    rebuildEnv();
  }
}

// 调试接口：直接换时辰（也方便录制演示）
window.__setHour = (h) => {
  hour = h;
  timeJump = null;
  applyTime();
  rebuildEnv();
};

/* ---------------- 6. 程序化贴图 ---------------- */
function makeGroundTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8d9464';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(20261113);

  // 大块色差
  for (let i = 0; i < 420; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 20 + rnd() * 90;
    const light = 0.86 + rnd() * 0.26;
    ctx.fillStyle = `rgba(${Math.round(146 * light)},${Math.round(154 * light)},${Math.round(96 * light)},${0.02 + rnd() * 0.04})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, TAU);
    ctx.fill();
  }

  // 干草碎屑 / 土粒
  for (let i = 0; i < 34000; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const brown = rnd() < 0.22;
    if (brown) {
      ctx.fillStyle = `rgba(${120 + Math.floor(rnd() * 50)},${100 + Math.floor(rnd() * 40)},${70 + Math.floor(rnd() * 30)},${0.05 + rnd() * 0.12})`;
    } else {
      ctx.fillStyle = `rgba(${100 + Math.floor(rnd() * 60)},${130 + Math.floor(rnd() * 55)},${60 + Math.floor(rnd() * 45)},${0.05 + rnd() * 0.11})`;
    }
    ctx.fillRect(x, y, 0.8 + rnd() * 2.0, 0.8 + rnd() * 2.8);
  }

  // 少量小石子
  for (let i = 0; i < 700; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.7 + rnd() * 2.2;
    const g = 130 + Math.floor(rnd() * 40);
    ctx.fillStyle = `rgba(${g},${g - 6},${g - 18},${0.2 + rnd() * 0.4})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * Math.PI, 0, TAU);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function makeGrassTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const rnd = mulberry32(5150);

  // 真实草叶：底部宽、顶尖，是填充的叶身不是一根线
  for (let i = 0; i < 300; i++) {
    const baseX = S * 0.5 + (rnd() - 0.5) * S * 0.94;
    const baseY = S + 6;
    const h = S * (0.42 + rnd() * 0.56);
    const lean = (rnd() - 0.5) * S * 0.34;
    const tipX = baseX + lean;
    const tipY = baseY - h;
    const ctrlX = baseX + lean * 0.26;
    const ctrlY = baseY - h * 0.66;
    const w = 1.5 + rnd() * 2.6;
    const hue = 68 + rnd() * 34;
    const sat = 16 + rnd() * 19;
    const lig = 13 + rnd() * 17;

    const grad = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
    const dry = rnd() < 0.16;
    grad.addColorStop(0, `hsla(${hue},${sat}%,${Math.max(8, lig * 0.42)}%,1)`);
    grad.addColorStop(0.55, `hsla(${hue},${sat}%,${lig}%,1)`);
    grad.addColorStop(1, dry
      ? `hsla(${hue - 18},${sat * 0.7}%,${Math.min(58, lig + 26)}%,0.96)`
      : `hsla(${hue + 8},${Math.max(20, sat - 10)}%,${Math.min(60, lig + 22)}%,0.97)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(baseX - w, baseY);
    ctx.quadraticCurveTo(ctrlX - w * 0.5, ctrlY, tipX, tipY);
    ctx.quadraticCurveTo(ctrlX + w * 0.5, ctrlY, baseX + w, baseY);
    ctx.closePath();
    ctx.fill();
  }

  // 草穗
  for (let i = 0; i < 22; i++) {
    const baseX = S * 0.5 + (rnd() - 0.5) * S * 0.84;
    const h = S * (0.66 + rnd() * 0.3);
    const tipX = baseX + (rnd() - 0.5) * 52;
    const tipY = S - h;
    ctx.strokeStyle = `hsla(${66 + rnd() * 22},26%,${42 + rnd() * 18}%,0.9)`;
    ctx.lineWidth = 1 + rnd() * 1.1;
    ctx.beginPath();
    ctx.moveTo(baseX, S);
    ctx.quadraticCurveTo(baseX + (rnd() - 0.5) * 22, S - h * 0.7, tipX, tipY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(196,190,140,0.8)';
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

/* 真实野花：花瓣数量、形状、花心都不一样 */
function makeFlowerTexture(kind) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  const rnd = mulberry32(900 + kind * 37);

  if (kind === 0) {
    // 雏菊：细长白瓣，一圈
    const petals = 16;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + rnd() * 0.1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const grad = ctx.createLinearGradient(0, -10, 0, -96);
      grad.addColorStop(0, 'rgba(255,255,252,1)');
      grad.addColorStop(0.7, 'rgba(252,250,240,0.98)');
      grad.addColorStop(1, 'rgba(246,242,226,0.72)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -56, 8.5, 42, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, 22);
    g.addColorStop(0, 'rgba(246,196,58,1)');
    g.addColorStop(0.7, 'rgba(232,168,40,1)');
    g.addColorStop(1, 'rgba(200,136,26,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 21, 0, TAU);
    ctx.fill();
  } else if (kind === 1) {
    // 毛茛：五瓣圆润，油亮
    const petals = 5;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const grad = ctx.createRadialGradient(0, -44, 6, 0, -44, 52);
      grad.addColorStop(0, 'rgba(255,226,120,1)');
      grad.addColorStop(0.75, 'rgba(242,196,62,1)');
      grad.addColorStop(1, 'rgba(216,166,36,0.94)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -46, 30, 40, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(188,140,34,0.95)';
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, TAU);
    ctx.fill();
  } else if (kind === 2) {
    // 矢车菊 / 淡紫：细碎花瓣
    const petals = 12;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + rnd() * 0.2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const grad = ctx.createLinearGradient(0, -12, 0, -84);
      grad.addColorStop(0, 'rgba(196,178,232,1)');
      grad.addColorStop(0.7, 'rgba(174,152,216,1)');
      grad.addColorStop(1, 'rgba(150,126,198,0.8)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-11, -14);
      ctx.quadraticCurveTo(-13, -62, 0, -84);
      ctx.quadraticCurveTo(13, -62, 11, -14);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(120,96,168,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, TAU);
    ctx.fill();
  } else {
    // 虞美人：四瓣薄红
    const petals = 4;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * TAU + 0.3;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const grad = ctx.createRadialGradient(0, -40, 4, 0, -40, 60);
      grad.addColorStop(0, 'rgba(226,96,66,1)');
      grad.addColorStop(0.7, 'rgba(196,62,42,1)');
      grad.addColorStop(1, 'rgba(150,40,28,0.82)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -48, 40, 46, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(40,32,26,0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, TAU);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function makePollenTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,252,238,1)');
  g.addColorStop(0.28, 'rgba(255,246,218,0.5)');
  g.addColorStop(1, 'rgba(255,244,210,0)');
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
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
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
  ctx.fillStyle = 'rgba(110,96,74,0.92)';
  ctx.fillRect(-2.2, -14, 4.4, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- 7. 地形 ---------------- */
let terrainMesh = null;
{
  const SIZE = WORLD.terrainSize;
  const SEG = 600;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const count = pos.count;
  const heights = new Float32Array(count);
  const XS = new Float32Array(count);
  const ZS = new Float32Array(count);

  // 第一遍：只求高度。heightAt 不便宜，每个顶点只准调一次。
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    heights[i] = h;
    XS[i] = x;
    ZS[i] = z;
    pos.setY(i, h);
  }

  // 第二遍：着色。坡度用邻接顶点差分，不再重复采样。
  const colorArr = new Float32Array(count * 3);
  const col = new THREE.Color();
  const rowLen = SEG + 1;
  const cell = SIZE / SEG;

  // 地面色调压到和远处草叶的平均色一致：
  // 否则草丛覆盖圈（约 150 米）一到头，裸地面就亮出一圈「草地到头了」的断层
  const grassA = new THREE.Color(0x67743c);
  const grassB = new THREE.Color(0x8b9752);
  const grassDry = new THREE.Color(0x96905f);
  const sand = new THREE.Color(0xb0a586);
  const mud = new THREE.Color(0x4c4a38);
  const rock = new THREE.Color(0x6d6a62);

  for (let i = 0; i < count; i++) {
    const x = XS[i];
    const z = ZS[i];
    const h = heights[i];
    const above = h - LAKE.level;

    const n1 = fbm(x * 0.032 + 11, z * 0.032 - 4, 3);
    const n2 = fbm(x * 0.0072 - 7, z * 0.0072 + 3, 3);

    col.copy(grassA).lerp(grassB, clamp(n1 * 1.5, 0, 1));
    col.lerp(grassDry, clamp((n2 - 0.48) * 1.5, 0, 1) * 0.55);

    // 湖岸：湿泥 -> 沙
    const ld = lakeDist(x, z);
    const shore = clamp(smoothstep(1.32, 1.0, ld) * smoothstep(1.1, 0.05, above), 0, 1);
    if (shore > 0) {
      col.lerp(mud, clamp(shore * 0.9, 0, 1));
      col.lerp(sand, clamp((shore - 0.35) * 1.3, 0, 1) * 0.7);
    }

    // 水下更暗更浑
    if (above < 0) {
      col.lerp(mud, clamp(-above * 0.34, 0, 1));
      col.multiplyScalar(clamp(1 + above * 0.055, 0.32, 1));
    }

    // 山脊露岩
    const r = Math.hypot(x, z);
    const rim = smoothstep(WORLD.rimStart, WORLD.rimFull, r);
    if (rim > 0) col.lerp(rock, rim * 0.68);

    // 陡坡草挂不住
    const ix = i % rowLen;
    const iz = (i / rowLen) | 0;
    const hl = heights[iz * rowLen + Math.max(0, ix - 1)];
    const hr = heights[iz * rowLen + Math.min(rowLen - 1, ix + 1)];
    const hu = heights[Math.max(0, iz - 1) * rowLen + ix];
    const hd = heights[Math.min(rowLen - 1, iz + 1) * rowLen + ix];
    const slope = (Math.abs(hr - hl) + Math.abs(hd - hu)) / (2 * cell);
    const steep = smoothstep(0.42, 1.35, slope);
    col.lerp(rock, steep * 0.48);

    colorArr[i * 3] = col.r;
    colorArr[i * 3 + 1] = col.g;
    colorArr[i * 3 + 2] = col.b;
  }

  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(colorArr.slice(), 3));
  baseTerrainColors = colorArr;
  terrainGeo = geo;

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: makeGroundTexture(),
    roughness: 1.0,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  terrainMat = mat;

  const terrain = new THREE.Mesh(geo, mat);
  terrain.frustumCulled = false;
  terrain.receiveShadow = true;
  terrainMesh = terrain;
  scene.add(terrain);
}

/* 四季落在地形上：顶点色重染 + 材质整体调子。
   全量 16 万顶点，节流到每 0.5 秒或季节/积雪明显变化时。 */
let terrainGeo = null;
let terrainMat = null;
let baseTerrainColors = null;

const SEASON_TINT = [
  { r: 0.94, g: 1.12, b: 0.90 },  // 春：嫩
  { r: 0.88, g: 1.04, b: 0.82 },  // 夏：浓
  { r: 1.38, g: 0.88, b: 0.42 },  // 秋：金
  { r: 0.84, g: 0.80, b: 0.66 },  // 冬：枯
];

/* 永久雪峰 + 雪线分层 + 季节积雪
   海拔 > 22m 强制白雪（雪峰），12~22m 雪线过渡，12m 以下才看 snowCover
   同时用法线与竖直方向夹角做山脊高光（fake rim light） */
function applySeasonTerrain(season, seasonT, snowCover) {
  if (!terrainGeo) return;
  const arr = terrainGeo.attributes.color.array;
  const pos = terrainGeo.attributes.position.array;
  const nrm = terrainGeo.attributes.normal.array;
  const t = SEASON_TINT[season];

  // 永久雪峰雪线（海拔）
  const SNOW_LINE_HIGH = 22;   // >22m 强制白雪
  const SNOW_LINE_LOW = 12;    // 12~22m 过渡带

  for (let i = 0; i < arr.length; i += 3) {
    let r = baseTerrainColors[i];
    let g = baseTerrainColors[i + 1];
    let b = baseTerrainColors[i + 2];
    r *= lerp(1, t.r, 1);
    g *= lerp(1, t.g, 1);
    b *= lerp(1, t.b, 1);

    const vi = i;  // vertex index
    const h = pos[vi * 3 + 1];
    const nx = nrm[vi * 3];
    const ny = nrm[vi * 3 + 1];
    const nz = nrm[vi * 3 + 2];

    // ---------- 雪线分层 ----------
    let snow = 0;
    if (h > SNOW_LINE_HIGH) {
      // 雪峰：强制白雪（非冬季也有，比如金顶夕阳照雪顶）
      snow = 1.0;
    } else if (h > SNOW_LINE_LOW) {
      // 雪线过渡带：越高越白 + 季节积雪强度调制
      const frac = (h - SNOW_LINE_LOW) / (SNOW_LINE_HIGH - SNOW_LINE_LOW);  // 0~1
      const noise = valueNoise(vi * 0.0031 + 11, vi * 0.0017 - 5);
      snow = frac * (0.65 + noise * 0.35);
      if (season === 3) snow = Math.min(1, snow + snowCover * 0.3);
    } else {
      // 低海拔：只有冬季 + 足够 snowCover 才盖雪
      if (season === 3 && snowCover > 0.05) {
        const noise = valueNoise(vi * 0.0041 + 3, vi * 0.0023 + 7);
        const wob = 0.4 + noise * 0.6;
        snow = snowCover * wob;
        // 陡坡存不住雪：用法线 y 分量（越陡峭 ny 越小）
        snow *= smoothstep(0.35, 0.85, ny);
      }
    }

    // 雪的颜色：偏蓝白 + 一点灰影
    if (snow > 0.001) {
      const sw = snow;
      r = lerp(r, 0.96, sw);
      g = lerp(g, 0.975, sw);
      b = lerp(b, 1.0, sw);
    }

    // ---------- 山脊高光（fake rim light） ----------
    // 法线越水平（ny 越小，= 越陡），高光越强
    const steep = 1 - ny;  // 0=平地，1=垂直崖壁
    // 高光颜色：雪峰上偏暖（夕阳金顶），低海拔偏白
    let hiR, hiG, hiB;
    if (snow > 0.5) {
      // 雪顶高光：暖白，让夕阳下雪顶发金
      hiR = 1.0; hiG = 0.96; hiB = 0.92;
    } else {
      // 普通山脊高光：冷灰白
      hiR = 0.9; hiG = 0.93; hiB = 0.98;
    }
    const hiStrength = steep * steep * 0.18;  // 只在很陡的地方亮
    r = lerp(r, hiR, hiStrength);
    g = lerp(g, hiG, hiStrength);
    b = lerp(b, hiB, hiStrength);

    arr[i] = r;
    arr[i + 1] = g;
    arr[i + 2] = b;
  }
  terrainGeo.attributes.color.needsUpdate = true;
}

/* ---------------- 8. 风 / 光照统一 uniform ---------------- */
const sharedUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uSunDir: { value: SUN_DIR.clone() },
  uSunColor: { value: new THREE.Color(0xffe9b8) },
  uSunI: { value: 1 },
  uSkyColor: { value: new THREE.Color(0xa9c6e6) },
  uFogColor: { value: new THREE.Color(FOG_COLOR) },
  uFogDensity: { value: 0.0058 },
  uShadowMap: { value: whitePixel },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowTexel: { value: 1 / 4096 },
};

const WIND_GLSL = /* glsl */ `
  uniform float uTime;
  uniform float uWind;

  vec3 windOffset(vec3 world, float h, float stiff, float phase) {
    float t = uTime;
    float gust = sin(world.x * 0.098 + t * 0.52) * 0.5 + sin(world.z * 0.121 - t * 0.35) * 0.5;
    float wave = sin(world.x * 0.036 + world.z * 0.028 + t * 0.42);
    float sway = sin(t * 1.55 + phase + world.x * 0.26 + world.z * 0.17) * 0.58
               + sin(t * 2.65 + phase * 1.7) * 0.22;
    float bend = pow(clamp(h, 0.0, 1.0), 1.5) * stiff;
    return vec3(
      (0.78 * sway + 0.62 * gust + 0.35 * wave) * 0.2 * bend * uWind,
      0.0,
      (0.54 * sway - 0.46 * gust + 0.22 * wave) * 0.2 * bend * uWind
    );
  }
`;

const SHADOW_GLSL = /* glsl */ `
  uniform sampler2D uShadowMap;
  uniform mat4 uShadowMatrix;
  uniform float uShadowTexel;

  float shadowFactor(vec4 coord, vec3 n) {
    if (coord.w <= 0.0) return 1.0;
    // three 的 shadow.matrix 输出已经是 0..1 的 UV 空间，不要再缩放
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

const LIGHT_GLSL = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunI;
  uniform vec3 uSkyColor;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
`;

const grassFragment = /* glsl */ `
  ${LIGHT_GLSL}
  ${SHADOW_GLSL}

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying float vH;
  varying vec3 vNormalW;
  varying vec4 vShadowCoord;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);

    float sh = shadowFactor(vShadowCoord, n);
    // 草叶互相遮挡：底部更暗
    float ao = mix(0.42, 1.0, pow(vH, 0.62));

    float ndl = 0.30 + 0.70 * abs(dot(n, uSunDir));
    vec3 sun = uSunColor * ndl * 1.35 * uSunI * sh;
    vec3 amb = uSkyColor * 0.52 + vec3(0.006, 0.011, 0.018);
    vec3 col = vColor * (sun + amb) * ao;

    // 逆光透射：草叶边缘被太阳打透
    float back = pow(max(dot(v, uSunDir), 0.0), 2.2);
    col += vColor * uSunColor * back * (0.18 + 0.82 * vH) * 0.72 * uSunI * sh;

    // 高处偏暖：阳光是从上面来的
    col *= mix(vec3(0.93, 0.94, 0.92), vec3(1.18, 1.06, 0.79), clamp(vH, 0.0, 1.0));

    float dist = length(cameraPosition - vWorld);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const grassCardFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uSeasonTint;
  uniform float uSnow;
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
    float ao = mix(0.54, 1.0, pow(vH, 0.62));

    float ndl = 0.30 + 0.70 * abs(dot(n, uSunDir));
    vec3 sun = uSunColor * ndl * 1.32 * uSunI * sh;
    vec3 amb = uSkyColor * 0.52 + vec3(0.006, 0.011, 0.018);
    vec3 col = vColor * tex.rgb * (sun + amb) * ao;

    float back = pow(max(dot(v, uSunDir), 0.0), 2.2);
    col += vColor * tex.rgb * uSunColor * back * (0.18 + 0.82 * vH) * 0.7 * uSunI * sh;

    col *= mix(vec3(0.93, 0.94, 0.92), vec3(1.16, 1.05, 0.80), clamp(vH, 0.0, 1.0));

    // 四季：整片草地换调子；雪压草尖
    col *= uSeasonTint;
    col = mix(col, vec3(0.93, 0.95, 0.98), uSnow * clamp(vH + 0.3, 0.0, 1.0));

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

    // 花瓣薄，两面都受光
    float ndl = 0.62 + 0.38 * abs(dot(n, uSunDir));
    vec3 sun = uSunColor * ndl * 1.18 * uSunI * sh;
    vec3 amb = uSkyColor * 0.85 + vec3(0.008, 0.014, 0.024);
    vec3 col = vColor * tex.rgb * (sun + amb);

    float back = pow(max(dot(v, uSunDir), 0.0), 2.0);
    col += vColor * tex.rgb * uSunColor * back * 0.45 * uSunI * sh;

    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFogColor, fogF);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const grassCardMaterial = new THREE.ShaderMaterial({
  uniforms: {
    ...sharedUniforms,
    uMap: { value: makeGrassTexture() },
    uSeasonTint: { value: new THREE.Color(1, 1, 1) },
    uSnow: { value: 0 },
  },
  vertexShader: grassVertex,
  fragmentShader: grassCardFragment,
  side: THREE.DoubleSide,
});

const stemMaterial = new THREE.ShaderMaterial({
  uniforms: sharedUniforms,
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

const flowerMaterials = [makeFlowerMaterial(0), makeFlowerMaterial(1), makeFlowerMaterial(2), makeFlowerMaterial(3)];

/* ---------------- 9. 草与花几何 ---------------- */
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

/* ---------------- 10. 区块化草原 ---------------- */
const CHUNK = 30;
const RINGS = 4;
const tuftGeoBase = makeGrassCardGeometry(3, 3);
const stemGeoBase = makeStemGeometry();
const headGeoBase = makeFlowerHeadGeometry();

const chunks = new Map();
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

/* 草色：真实草原的黄绿到橄榄绿，不发光 */
const grassPalette = [0xc8cfa0, 0xb4bd82, 0xd6d8ae, 0xa9b476, 0xcdd0a2];

/* 花色：白 / 黄 / 淡紫 / 薄红，都压过饱和 */
const flowerPalettes = [
  [0xf2f0e0, 0xeceada, 0xf6f4e8],
  [0xe6c464, 0xe9cb72, 0xdcb854],
  [0xb9a8d2, 0xc2b3d8, 0xac9ac8],
  [0xc86a52, 0xc05844, 0xd07a60],
];

function ringCount(ring, counts) {
  return counts[Math.min(ring, counts.length - 1)];
}

// 建筑占地范围内不长草，否则草会从木地板里穿出来
function inBuilding(x, z) {
  const c = Math.cos(SITES.cabin.yaw);
  const s = Math.sin(SITES.cabin.yaw);
  const dx = x - SITES.cabin.x;
  const dz = z - SITES.cabin.z;
  const lx = dx * c + dz * s;
  const lz = -dx * s + dz * c;
  if (Math.abs(lx) < 3.7 && Math.abs(lz) < 3.3) return true;
  const dsx = x - SITES.station.x;
  const dsz = z - SITES.station.z;
  if (Math.abs(dsx) < 7 && Math.abs(dsz) < 3) return true;
  return false;
}

function buildChunk(cx, cz, ring) {
  const rand = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x9e3779b9);
  const group = new THREE.Group();
  const baseX = cx * CHUNK;
  const baseZ = cz * CHUNK;

  // 密度必须平缓下降，断崖式降级会在草地上切出一道道缝
  // 区块 26→30，按面积把近景密度补回来
  const tuftCount = ringCount(ring, [5000, 4400, 3400, 2200, 1100]);
  // 真实草原是草的海洋，花只是点缀
  const flowerCount = ringCount(ring, [560, 520, 400, 240, 100]);

  /* 草 */
  const tuftGeo = tuftGeoBase.clone();
  const phases = new Float32Array(tuftCount);
  const stiffs = new Float32Array(tuftCount);
  const grassMesh = new THREE.InstancedMesh(tuftGeo, grassCardMaterial, tuftCount);

  for (let i = 0; i < tuftCount; i++) {
    const x = baseX + rand() * CHUNK;
    const z = baseZ + rand() * CHUNK;
    const y = heightAt(x, z);
    const vitality = fbm(x * 0.021 + 5, z * 0.021 + 2, 3);
    const shoreLd = lakeDist(x, z);
    const shore = shoreAmount(x, z);

    // 水里和贴水的沙岸上不长草
    if (LAKE.level - y > 0.15 || shoreLd < 1.58 || inBuilding(x, z)) {
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
    // 别让每簇都笔直站着，稍微歪一点俯视才不透空
    dummy.rotation.set((rand() - 0.5) * 0.18, rand() * TAU, (rand() - 0.5) * 0.18);
    const width = 0.52 + rand() * 0.38;
    const tall = (0.42 + rand() * 0.34) * (0.82 + vitality * 0.44) * (1 - shore * 0.55);
    dummy.scale.set(width, tall, width);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);

    const c = grassPalette[Math.floor(rand() * grassPalette.length)];
    tmpColor.setHex(c).offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.055);
    if (vitality > 0.56) tmpColor.offsetHSL(0.014, 0.02, 0.015);
    // 湖边草偏湿绿
    if (shore > 0.3) tmpColor.offsetHSL(-0.02, 0.03, -0.02);
    grassMesh.setColorAt(i, tmpColor);

    phases[i] = rand() * TAU;
    stiffs[i] = 0.65 + rand() * 0.75;
  }
  tuftGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  tuftGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(stiffs, 1));
  grassMesh.computeBoundingSphere();
  grassMesh.frustumCulled = false;
  group.add(grassMesh);

  /* 花：按品种分四组，各自一次 draw call */
  const stemGeo = stemGeoBase.clone();
  const stemPhases = new Float32Array(flowerCount);
  const headPhases = new Float32Array(flowerCount);
  const stemStiffs = new Float32Array(flowerCount);
  const stemMesh = new THREE.InstancedMesh(stemGeo, stemMaterial, flowerCount);

  const buckets = [[], [], [], []];
  const heads = [];

  for (let i = 0; i < flowerCount; i++) {
    let x = baseX + rand() * CHUNK;
    let z = baseZ + rand() * CHUNK;
    let y = heightAt(x, z);

    // 成片地开
    const cluster = fbm(x * 0.028 + 31, z * 0.028 - 12, 3);
    if (cluster < 0.38 && rand() < 0.7) {
      x = baseX + rand() * CHUNK;
      z = baseZ + rand() * CHUNK;
      y = heightAt(x, z);
    }

    const inWater = LAKE.level - y > 0.08 || lakeDist(x, z) < 1.62 || inBuilding(x, z);
    const tall = rand() < 0.1;
    const stemH = inWater ? 0 : tall ? 0.52 + rand() * 0.26 : 0.22 + rand() * 0.2;
    const headSize = (tall ? 0.14 : 0.088) + rand() * 0.05;
    const phase = rand() * TAU;

    // 品种沿噪声漂移成带：白最多，红最少
    const drift = fbm(x * 0.013 + 21, z * 0.013 - 5, 3) + (rand() - 0.5) * 0.05;
    let kind = 0;
    if (drift < 0.46) kind = 0;
    else if (drift < 0.54) kind = 1;
    else if (drift < 0.60) kind = 2;
    else kind = 3;

    dummy.position.set(inWater ? x : x, inWater ? -999 : y, z);
    dummy.rotation.set(0, rand() * TAU, 0);
    dummy.scale.set(1, Math.max(0.0001, stemH), 1);
    dummy.updateMatrix();
    stemMesh.setMatrixAt(i, dummy.matrix);
    stemMesh.setColorAt(i, tmpColor.setHex(0x495a26).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.08));

    if (!inWater) {
      buckets[kind].push({
        x, y: y + stemH, z, headSize,
        rot: [(rand() - 0.5) * 0.4, rand() * TAU, (rand() - 0.5) * 0.28],
        color: flowerPalettes[kind][Math.floor(rand() * flowerPalettes[kind].length)],
      });
    }

    stemPhases[i] = phase;
    headPhases[i] = phase;
    stemStiffs[i] = 0.85 + rand() * 0.4;
  }

  stemGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(stemPhases, 1));
  stemGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(stemStiffs, 1));
  stemMesh.computeBoundingSphere();
  stemMesh.frustumCulled = false;
  group.add(stemMesh);

  for (let k = 0; k < 4; k++) {
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
      ph[i] = headPhases[i % headPhases.length];
      st[i] = 0.9 + ((i * 0.37) % 0.4);
    }
    headGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    headGeo.setAttribute('aStiff', new THREE.InstancedBufferAttribute(st, 1));
    mesh.computeBoundingSphere();
    mesh.frustumCulled = false;
    group.add(mesh);
    heads.push(mesh);
  }

  /* 草和花不参与湖面反射，省一大半开销 */
  group.traverse((o) => o.layers.set(1));

  return { group, cx, cz };
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
    // 近的先建，补得快
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

/* ---------------- 11. 树 ---------------- */
/* 树冠不能是标准球，否则远看就是一把西兰花。
   按顶点位置做哈希扰动，同一位置的多份顶点会得到相同位移，不会裂开。 */
function makeBlobGeo(seed) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = valueNoise(x * 2.9 + seed * 7.3, z * 2.9 + y * 2.1);
    const k = 0.76 + n * 0.46;
    pos.setXYZ(i, x * k, y * k * 0.94, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const treeColliders = [];
const treeCrowns = [];
{
  const treeRnd = mulberry32(424242);
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x5d4630, roughness: 0.95 });
  const leafGeos = [0, 1, 2, 3].map((k) => makeBlobGeo(700 + k * 37));

  // 树的分布：成丛，远离湖心，留出地点周围的空地
  const spots = [];
  spots.push({ x: -54, z: -22, s: 1.2 });
  spots.push({ x: 66, z: -18, s: 1.35 });

  for (let i = 0; i < 170; i++) {
    const a = treeRnd() * TAU;
    const r = 40 + treeRnd() * 470;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const ld = lakeDist(x, z);
    if (ld < 1.75) continue;                     // 湖里不长树
    if (Math.hypot(x - SITES.cabin.x, z - SITES.cabin.z) < 19) continue;
    if (Math.hypot(x - SITES.station.x, z - SITES.station.z) < 16) continue;
    // 成丛：噪声高才长
    if (fbm(x * 0.014 + 40, z * 0.014 - 9, 3) < 0.46 && treeRnd() < 0.72) continue;
    spots.push({ x, z, s: 0.8 + treeRnd() * 0.85 });
  }

  for (const sp of spots) {
    const y = heightAt(sp.x, sp.z);
    if (LAKE.level - y > 0.1) continue;
    const tree = new THREE.Group();
    // 树冠单独一组：玩家走到树下面时整组隐藏，否则一大块绿色糊在镜头上
    const crown = new THREE.Group();
    tree.add(crown);

    const h = (4.6 + treeRnd() * 3.4) * sp.s;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * sp.s, 0.3 * sp.s, h, 8), barkMat);
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    // 分枝
    const branches = 2 + Math.floor(treeRnd() * 2);
    for (let b = 0; b < branches; b++) {
      const bh = 0.42 + treeRnd() * 0.4;
      const bl = (1.4 + treeRnd() * 1.4) * sp.s;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * sp.s, 0.12 * sp.s, bl, 6), barkMat);
      br.position.set((treeRnd() - 0.5) * 0.5, h * bh, (treeRnd() - 0.5) * 0.5);
      br.rotation.set((treeRnd() - 0.5) * 0.9, treeRnd() * TAU, (treeRnd() - 0.5) * 0.9);
      br.translateY(bl / 2);
      br.castShadow = true;
      tree.add(br);
    }

    const leafMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.235 + treeRnd() * 0.045, 0.33, 0.26 + treeRnd() * 0.09, THREE.SRGBColorSpace),
      roughness: 0.9,
      flatShading: true,
    });
    // 玩家走进树冠时，近处的叶团按屏幕抖动淡出，否则一大块纯绿糊在镜头上
    leafMat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
      shader.fragmentShader = 'varying vec3 vWPos;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         {
           float cd = distance(vWPos, cameraPosition);
           float fade = smoothstep(1.5, 3.6, cd);
           if (fade < 0.995) {
             float dz = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
             if (dz > fade) discard;
           }
         }`
      );
    };

    // 树冠：从下往上收，底层大、顶层小，才有树的轮廓
    const blobs = 9 + Math.floor(treeRnd() * 5);
    for (let b = 0; b < blobs; b++) {
      const t = b / (blobs - 1);
      const layer = Math.pow(t, 0.7);
      const radius = (1.62 - layer * 0.95) * sp.s;
      const ang = treeRnd() * TAU;
      const dist = radius * (0.5 + treeRnd() * 0.55);
      const s = (1.28 - layer * 0.56 + treeRnd() * 0.34) * sp.s;
      const blob = new THREE.Mesh(leafGeos[b % leafGeos.length], leafMat);
      blob.scale.set(s * (0.92 + treeRnd() * 0.36), s * (0.66 + treeRnd() * 0.3), s * (0.92 + treeRnd() * 0.36));
      blob.position.set(
        Math.cos(ang) * dist,
        h * (0.76 + layer * 0.30) + treeRnd() * 0.4 * sp.s,
        Math.sin(ang) * dist
      );
      blob.rotation.set(treeRnd() * 3, treeRnd() * 3, treeRnd() * 3);
      blob.castShadow = true;
      blob.receiveShadow = true;
      crown.add(blob);
    }

    tree.position.set(sp.x, y, sp.z);
    tree.rotation.y = treeRnd() * TAU;
    scene.add(tree);

    treeColliders.push({ cx: sp.x, cz: sp.z, cos: 1, sin: 0, hx: 0.85 * sp.s, hz: 0.85 * sp.s });
    treeCrowns.push({ x: sp.x, z: sp.z, r: 4.0 * sp.s, crown, leafMat, hue: 0.235 + treeRnd() * 0.045, light: 0.26 + treeRnd() * 0.09 });
  }
}

/* 对岸森林的四季色（InstancedMesh 的 instanceColor 重写） */
function applySeasonForest(season, seasonT, snowCover) {
  if (!forestCrowns || !forestBase.length) return;
  const c = new THREE.Color();
  const white = new THREE.Color(0xe8ecf0);
  for (let i = 0; i < forestBase.length; i++) {
    const b = forestBase[i];
    if (season === 0) {
      c.setHSL(b.h - 0.03, b.s * 0.85, b.l * 1.5);
    } else if (season === 1) {
      c.setHSL(b.h, b.s, b.l);
    } else if (season === 2) {
      const gold = hash2(i * 7.3, i * 3.1);
      const warm = 0.75 + seasonT * 0.25;
      c.setHSL(0.05 + gold * 0.06, 0.6 + gold * 0.2, (0.3 + gold * 0.16) * warm);
    } else {
      c.setHSL(0.07, 0.1, b.l * 1.1);
      if (snowCover > 0.02) c.lerp(white, snowCover * 0.5);
    }
    forestCrowns.setColorAt(i, c);
  }
  forestCrowns.instanceColor.needsUpdate = true;
}

/* 四季落在树上：春嫩夏浓秋金冬枯，冬天一半树落光叶子、下雪则挂白 */
function applySeasonTrees(season, seasonT, snowCover) {
  for (const tc of treeCrowns) {
    const leaf = tc.leafMat;
    if (season === 0) {
      leaf.color.setHSL(0.21 + tc.hue * 0.2, 0.36, 0.30 + tc.light * 0.35, THREE.SRGBColorSpace);
    } else if (season === 1) {
      leaf.color.setHSL(0.235 + tc.hue * 0.3, 0.35, 0.26 + tc.light * 0.6, THREE.SRGBColorSpace);
    } else if (season === 2) {
      // 秋：整片染金，绿→金→红的进度由每棵树自己的种子决定，错落才好看
      const gold = hash2(tc.x * 1.3, tc.z * 1.3);
      const warm = 0.75 + seasonT * 0.25;
      leaf.color.setHSL(0.045 + gold * 0.085, 0.62 + gold * 0.22, (0.4 + gold * 0.15) * warm, THREE.SRGBColorSpace);
    } else {
      // 冬：枯棕；落光叶子的树只剩枝
      leaf.color.setHSL(0.08, 0.22, 0.28 + tc.light * 0.2, THREE.SRGBColorSpace);
      tc.winterBare = hash2(tc.x * 5.1, tc.z * 5.1) <= 0.42;
    }
    if (season !== 3) tc.winterBare = false;
    // 雪挂树冠
    if (snowCover > 0.02) {
      const c = leaf.color;
      const snow = snowCover * 0.75;
      c.lerp(new THREE.Color(0xe9edf2), snow);
    }
  }
}

/* ---------------- 11.5 散落的石头 ---------------- */
{
  const rnd = mulberry32(6060);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  const COUNT = 260;
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const d = new THREE.Object3D();
  const c = new THREE.Color();
  let n = 0;

  for (let i = 0; i < COUNT * 4 && n < COUNT; i++) {
    const a = rnd() * TAU;
    const r = 6 + rnd() * 155;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (lakeDist(x, z) < 1.5) continue;
    if (Math.hypot(x - SITES.cabin.x, z - SITES.cabin.z) < 7) continue;
    if (Math.hypot(x - SITES.station.x, z - SITES.station.z) < 9) continue;

    const y = heightAt(x, z);
    // 小石头多，大石头少
    const s = 0.13 + rnd() * rnd() * rnd() * 0.62;
    d.position.set(x, y - s * 0.4, z);
    d.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
    d.scale.set(s * (0.8 + rnd() * 0.55), s * (0.52 + rnd() * 0.36), s * (0.8 + rnd() * 0.55));
    d.updateMatrix();
    mesh.setMatrixAt(n, d.matrix);

    const g = 0.13 + rnd() * 0.09;
    c.setRGB(g * 1.04, g * 1.0, g * 0.9);
    mesh.setColorAt(n, c);
    n++;
  }

  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
}

/* ---------------- 12. 地点 ---------------- */
const places = createPlaces(scene, null);

/* ---------------- 12.6 对岸森林与远处灯火 ---------------- */
let forestCrowns = null;
let forestBase = [];
{
  const rnd = mulberry32(5522);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    flatShading: true,
  });
  const MAX = 300;
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, MAX);
  crowns.frustumCulled = false;
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  let n = 0;

  // 森林只长在湖的远侧，别铺满整圈 —— 否则玩家会被树冠糊一脸
  const farA = Math.atan2(-30 - LAKE.z, 0 - LAKE.x) + Math.PI;
  // 成簇的树冠，没有细长的树干，避免变成一排“棒棒糖”
  for (let c = 0; c < 30; c++) {
    const a = farA + (rnd() - 0.5) * 2.5;
    const rad = LAKE.r * (1.66 + rnd() * 0.75);
    const cx = LAKE.x + Math.cos(a) * rad;
    const cz = LAKE.z + Math.sin(a) * rad;
    const cy = heightAt(cx, cz);
    if (LAKE.level - cy > 0.2) continue;
    const spread = 5 + rnd() * 10;
    const count = 4 + Math.floor(rnd() * 7);
    for (let k = 0; k < count && n < MAX; k++) {
      const ca = rnd() * TAU;
      const cr = Math.sqrt(rnd()) * spread;
      const x = cx + Math.cos(ca) * cr;
      const z = cz + Math.sin(ca) * cr;
      const y = heightAt(x, z);
      if (LAKE.level - y > 0.1) continue;
      const tall = rnd() < 0.14;
      const h = tall ? 6 + rnd() * 4 : 2 + rnd() * 4.5;
      const w = tall ? h * 0.3 : h * (0.55 + rnd() * 0.45);
      d.position.set(x, y + h * 0.5, z);
      d.rotation.set((rnd() - 0.5) * 0.16, rnd() * TAU, (rnd() - 0.5) * 0.16);
      d.scale.set(w, h * 0.62, w);
      d.updateMatrix();
      crowns.setMatrixAt(n, d.matrix);
      col.setHSL(0.27 + rnd() * 0.05, 0.24 + rnd() * 0.18, 0.1 + rnd() * 0.07);
      crowns.setColorAt(n, col);
      forestBase.push({ h: 0.27 + rnd() * 0.05, s: 0.24 + rnd() * 0.18, l: 0.1 + rnd() * 0.07 });
      n++;
    }
  }

  crowns.count = n;
  crowns.instanceColor.needsUpdate = true;
  scene.add(crowns);
  forestCrowns = crowns;
}

{
  /* 对岸的远处灯火：夜里才亮 */
  const LN = 90;
  const lpos = new Float32Array(LN * 3);
  const lightsRnd = mulberry32(8811);
  const farA = Math.atan2(-30 - LAKE.z, 0 - LAKE.x) + Math.PI;
  for (let i = 0; i < LN; i++) {
    const a = farA + (lightsRnd() - 0.5) * 2.0;
    const rad = LAKE.r * (1.62 + lightsRnd() * 0.85);
    const x = LAKE.x + Math.cos(a) * rad;
    const z = LAKE.z + Math.sin(a) * rad;
    const y = heightAt(x, z);
    lpos[i * 3] = x;
    lpos[i * 3 + 1] = y + 0.8 + lightsRnd() * 2.6;
    lpos[i * 3 + 2] = z;
  }
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
  const lmat = new THREE.PointsMaterial({
    size: 1.1,
    map: makePollenTexture(),
    color: 0xffc98a,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const lakeLights = new THREE.Points(lgeo, lmat);
  lakeLights.frustumCulled = false;
  scene.add(lakeLights);
  window.__lakeLights = lakeLights;
}

/* ---------------- 13. 蝴蝶 / 花粉 / 萤火虫 ---------------- */
const butterflyTex = makeButterflyTexture();
const butterflies = [];
{
  const rnd = mulberry32(9001);
  const colors = [0xf6eeda, 0xf0dea0, 0xe8c8cc, 0xf6eeda, 0xd8d0f0];
  for (let i = 0; i < 22; i++) {
    const mat = new THREE.SpriteMaterial({
      map: butterflyTex,
      color: colors[Math.floor(rnd() * colors.length)],
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(0.17 + rnd() * 0.12);
    const r = 10 + rnd() * 54;
    const a = rnd() * TAU;
    butterflies.push({
      sprite,
      hx: Math.cos(a) * r,
      hz: Math.sin(a) * r,
      ph: rnd() * TAU,
      speed: 0.13 + rnd() * 0.1,
      flap: 8 + rnd() * 6,
      baseScale: sprite.scale.x,
      yOff: 0.5 + rnd() * 0.9,
    });
    scene.add(sprite);
  }
}

const POLLEN_COUNT = 1100;
const pollenPositions = new Float32Array(POLLEN_COUNT * 3);
const pollenSeeds = new Float32Array(POLLEN_COUNT);
const pollenGround = new Float32Array(POLLEN_COUNT);
{
  const rnd = mulberry32(777);
  for (let i = 0; i < POLLEN_COUNT; i++) {
    pollenPositions[i * 3] = (rnd() - 0.5) * 80;
    pollenPositions[i * 3 + 1] = 0.3 + rnd() * 3.4;
    pollenPositions[i * 3 + 2] = (rnd() - 0.5) * 80;
    pollenSeeds[i] = rnd() * TAU;
    pollenGround[i] = heightAt(pollenPositions[i * 3], pollenPositions[i * 3 + 2]);
  }
}
const pollenGeo = new THREE.BufferGeometry();
pollenGeo.setAttribute('position', new THREE.BufferAttribute(pollenPositions, 3));
const pollenMat = new THREE.PointsMaterial({
  size: 0.034,
  map: makePollenTexture(),
  color: 0xfff4d6,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  sizeAttenuation: true,
});
const pollen = new THREE.Points(pollenGeo, pollenMat);
pollen.frustumCulled = false;
scene.add(pollen);

const FIREFLY_COUNT = 840;
const fireflyGeo = new THREE.BufferGeometry();
{
  const rnd = mulberry32(8128);
  const pos = new Float32Array(FIREFLY_COUNT * 3);
  const phase = new Float32Array(FIREFLY_COUNT);
  const size = new Float32Array(FIREFLY_COUNT);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const r = Math.sqrt(rnd()) * 38;
    const a = rnd() * TAU;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    pos[i * 3] = x;
    pos[i * 3 + 1] = heightAt(x, z) + 0.45 + rnd() * 1.9;
    pos[i * 3 + 2] = z;
    phase[i] = rnd();
    size[i] = 1.0 + rnd() * 1.0;
  }
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  fireflyGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  fireflyGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
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
    varying float vGlow;
    varying vec3 vHue;

    void main() {
      vec3 p = position;
      p.x += sin(uTime * 0.29 + aPhase * 21.0) * 0.75;
      p.z += cos(uTime * 0.25 + aPhase * 17.0) * 0.75;
      p.y += sin(uTime * 0.43 + aPhase * 31.0) * 0.24;

      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;

      float pulse = 0.5 + 0.5 * sin(uTime * (1.0 + aPhase * 0.85) + aPhase * 40.0);
      vGlow = 0.2 + 0.8 * pow(pulse, 2.6);
      vHue = mix(vec3(0.56, 1.0, 0.32), vec3(1.0, 0.92, 0.52), fract(aPhase * 7.3));
      gl_PointSize = aSize * uPixelRatio * 62.0 / max(-mv.z, 0.5);
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
      gl_FragColor = vec4(vHue * a * 2.4, a);
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

  if (!fireflyActive) {
    fireflyActive = true;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const ix = i * 3;
      const r = Math.sqrt(Math.random()) * 36;
      const a = Math.random() * TAU;
      arr[ix] = camX + Math.cos(a) * r;
      arr[ix + 2] = camZ + Math.sin(a) * r;
      arr[ix + 1] = heightAt(arr[ix], arr[ix + 2]) + 0.4 + Math.random() * 1.9;
    }
    fireflyGeo.attributes.position.needsUpdate = true;
    return;
  }

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const ix = i * 3;
    arr[ix] += (0.055 + Math.sin(t * 0.21 + i) * 0.05) * dt;
    arr[ix + 2] += Math.cos(t * 0.17 + i * 1.7) * 0.05 * dt;

    let wrapped = false;
    if (arr[ix] - camX > 38) { arr[ix] -= 76; wrapped = true; }
    else if (arr[ix] - camX < -38) { arr[ix] += 76; wrapped = true; }
    if (arr[ix + 2] - camZ > 38) { arr[ix + 2] -= 76; wrapped = true; }
    else if (arr[ix + 2] - camZ < -38) { arr[ix + 2] += 76; wrapped = true; }
    if (wrapped) arr[ix + 1] = heightAt(arr[ix], arr[ix + 2]) + 0.4 + Math.random() * 1.7;
  }
  fireflyGeo.attributes.position.needsUpdate = true;
}

/* ---------------- 14. 玩家 ---------------- */
const EYE = 1.64;
const LIE_EYE = 0.34;
const PLAYER_R = 0.34;
const player = { x: 0, z: 0, yaw: 0, pitch: 0.02, vx: 0, vz: 0, bob: 0 };
let camY = heightAt(0, 0) + EYE;
let lieAmount = 0;
let lying = false;
let savedPitch = 0;

/* 跳跃：edge-triggered，空中 camY = 起跳地面 + 眼高 + jumpOffset */
let jumpVy = 0;         // 垂直速度（正向上）
let jumpOffset = 0;     // 相对起跳地面的高度偏移（0=地面）
let jumpFloorY = 0;     // 起跳瞬间锁定的地面高度（空中不随地形变）
let jumpQueued = false; // 用于 edge-trigger
const JUMP_V0 = 5.8;    // 初速度 m/s（跳起约 1.2m 高）
const JUMP_G = 14;      // 重力 m/s²

/* 第三人称 */
let thirdPerson = false;
let tpCam = null;   // 第三人称相机平滑位置 {x,y,z}
let avatar = null;  // 玩家小木人

function buildAvatar() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.8 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x4a6b4a, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8c8a0, roughness: 0.8 });
  const hatM = new THREE.MeshStandardMaterial({ color: 0xd4b06a, roughness: 0.9 });
  const shoeM = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
  const beltM = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 });
  const scarf = new THREE.MeshStandardMaterial({ color: 0xb84a3a, roughness: 0.9 });

  const box = (w, h, d, m, x, y, z, parent) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    (parent || g).add(mesh);
    return mesh;
  };

  // 腿（pivot 在髋部）
  const legL = new THREE.Group(); legL.position.set(-0.09, 0.8, 0);
  const legR = new THREE.Group(); legR.position.set(0.09, 0.8, 0);
  box(0.1, 0.44, 0.11, wood, 0, -0.22, 0, legL);
  box(0.1, 0.44, 0.11, wood, 0, -0.22, 0, legR);
  box(0.11, 0.09, 0.19, shoeM, 0, -0.47, 0.02, legL);
  box(0.11, 0.09, 0.19, shoeM, 0, -0.47, 0.02, legR);
  g.add(legL, legR);

  // 身体 + 腰带 + 红领巾（本地 -z 是前进方向，领巾在胸前）
  box(0.36, 0.52, 0.22, cloth, 0, 1.04, 0);
  box(0.37, 0.07, 0.23, beltM, 0, 0.84, 0);
  box(0.16, 0.2, 0.04, scarf, 0, 1.2, -0.12);

  // 胳膊（pivot 在肩）
  const armL = new THREE.Group(); armL.position.set(-0.23, 1.22, 0);
  const armR = new THREE.Group(); armR.position.set(0.23, 1.22, 0);
  box(0.09, 0.44, 0.1, cloth, 0, -0.2, 0, armL);
  box(0.09, 0.44, 0.1, cloth, 0, -0.2, 0, armR);
  box(0.08, 0.09, 0.09, skin, 0, -0.45, 0, armL);
  box(0.08, 0.09, 0.09, skin, 0, -0.45, 0, armR);
  g.add(armL, armR);

  // 头 + 草帽
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), skin);
  head.position.set(0, 1.44, 0);
  head.castShadow = true;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.05, 12), hatM);
  hat.position.set(0, 1.55, 0);
  hat.castShadow = true;
  g.add(hat);
  const hatTop = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12), hatM);
  hatTop.position.set(0, 1.62, 0);
  hatTop.castShadow = true;
  g.add(hatTop);

  g.visible = false;
  scene.add(g);
  avatar = { g, legL, legR, armL, armR };
}

/* 出生点朝向湖 */
{
  const dx = LAKE.x - 0;
  const dz = LAKE.z - 0;
  player.yaw = Math.atan2(-dx, -dz);
}

/* ---------------- 15. 输入 ---------------- */
const body = document.body;
const introEl = document.getElementById('intro');
const pauseEl = document.getElementById('pause');
const keysEl = document.getElementById('keys');
const whisperEl = document.getElementById('whisper');
const fadeEl = document.getElementById('fade');

let started = false;
let paused = false;
let dragMode = false;
let dragging = false;
const held = new Set();
const toastEl = document.getElementById('toast');

/* ---- 键位：可自定义，存 localStorage ---- */
const BIND_STORE = 'iw.binds.v1';
const DEFAULT_BINDS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  run: 'ShiftLeft',
  jump: 'Space',
};
const BIND_LABELS = {
  forward: '前进', back: '后退', left: '左移', right: '右移', run: '快走', jump: '跳跃',
};
const binds = { ...DEFAULT_BINDS };
try {
  const saved = JSON.parse(localStorage.getItem(BIND_STORE) || '{}');
  for (const k of Object.keys(DEFAULT_BINDS)) {
    if (typeof saved[k] === 'string' && saved[k]) binds[k] = saved[k];
  }
} catch (e) { /* 隐私模式等情况下忽略 */ }

function persistBinds() {
  try { localStorage.setItem(BIND_STORE, JSON.stringify(binds)); } catch (e) { /* 忽略 */ }
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
    ` · ${codeLabel(b.run)} 快走 · F 躺下 · V 视角 · T 换时辰 · M 声音 · H 净屏 · Esc 菜单`;
}

let toastTimer = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2400);
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
  body.classList.remove('playing');
  pauseEl.classList.remove('hidden');
  void pauseEl.offsetHeight;   // 强制一次 reflow，否则 opacity 过渡不触发
  pauseEl.classList.add('show');
  showPanel('main');
}

function closeMenu() {
  pauseEl.classList.remove('show');
  paused = false;
  setTimeout(() => {
    if (!paused) pauseEl.classList.add('hidden');
  }, 340);
}

function quitToTitle() {
  started = false;
  paused = false;
  dragMode = false;
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

document.getElementById('btn-save').addEventListener('click', (e) => {
  e.stopPropagation();
  toast('存档还在开发中，这个世界不需要你保存');
});

document.getElementById('btn-quit').addEventListener('click', (e) => {
  e.stopPropagation();
  quitToTitle();
});

/* ---- 季节设置面板 ---- */
document.getElementById('btn-season').addEventListener('click', (e) => {
  e.stopPropagation();
  showPanel('season');
  refreshSeasonPanel();
});

function refreshSeasonPanel() {
  // 季节按钮高亮
  document.querySelectorAll('.season-btn').forEach((b) => {
    const s = +b.dataset.season;
    b.classList.toggle('active', calendar.season === s);
  });
  // 天气按钮高亮
  document.querySelectorAll('.weather-btn').forEach((b) => {
    b.classList.toggle('active', weather.type === b.dataset.wx);
  });
  // 速度 slider + 显示
  const yr = document.getElementById('yearsec');
  const yrVal = document.getElementById('yearsec-val');
  if (yr) { yr.value = Math.round(yearSec); }
  if (yrVal) { yrVal.textContent = formatYearSec(yearSec); }
}

function formatYearSec(s) {
  if (s < 120) return `${Math.round(s)} 秒 / 年（快速）`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟 / 年`;
  const h = s / 3600;
  if (Math.abs(h - 1) < 0.01) return '1 小时 / 年（默认）';
  return `${h.toFixed(h % 1 < 0.1 ? 0 : 1)} 小时 / 年（缓慢）`;
}

/* 季节按钮 */
document.querySelectorAll('.season-btn').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const s = +b.dataset.season;
    window.__setSeason(s);
    refreshSeasonPanel();
    toast(`切换到 ${['春', '夏', '秋', '冬'][s]} 季`);
  });
});

/* 天气按钮 */
document.querySelectorAll('.weather-btn').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    weather.force(b.dataset.wx);
    refreshSeasonPanel();
    const names = { clear: '晴', cloudy: '多云', overcast: '阴', rain: '雨', storm: '雷雨', snow: '雪', fog: '雾' };
    toast(`切换到 ${names[b.dataset.wx]}`);
  });
});

/* 轮转速度 slider */
{
  const yr = document.getElementById('yearsec');
  const yrVal = document.getElementById('yearsec-val');
  if (yr) {
    yr.addEventListener('input', () => {
      yearSec = +yr.value;
      if (yrVal) yrVal.textContent = formatYearSec(yearSec);
    });
    yr.addEventListener('change', () => {
      yearSec = +yr.value;
      toast('四季轮转速度已更新');
    });
  }
}

/* 每次打开暂停面板时刷新季节高亮 */
const origShowPanel = showPanel;
showPanel = function(name) {
  origShowPanel(name);
  if (name === 'season') refreshSeasonPanel();
};

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

function startGame() {
  if (started) return;
  started = true;
  body.classList.add('playing', 'started');
  introEl.classList.add('dismiss');
  setTimeout(() => { if (started) introEl.classList.add('hidden'); }, 1500);
  refreshKeyHint();
  fadeEl.style.transition = 'none';
  fadeEl.style.opacity = '0.95';
  requestAnimationFrame(() => {
    fadeEl.style.transition = 'opacity 2.6s ease';
    fadeEl.style.opacity = '0';
  });
  initAudio();
  tryLock();
  setTimeout(() => {
    if (started && !document.pointerLockElement && !dragMode) enableDragMode();
  }, 900);
  setTimeout(() => showLine('你可以随便走走，这里没有要做的事。', 3200));
  setTimeout(() => keysEl.classList.add('dim'), 20000);
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
  pauseEl.classList.remove('show');
  body.classList.remove('playing');
  if (started) toast('鼠标没能锁住：按住左键拖动画面也能走');
}

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    closeMenu();
    body.classList.add('playing');
  } else if (started && !dragMode) {
    // 浏览器在指针锁定下会吞掉 Esc 的 keydown，所以「按 Esc 弹菜单」
    // 实际上是从这里触发的：解锁 == 想停下
    openMenu();
  }
});

document.addEventListener('pointerlockerror', () => enableDragMode());

document.getElementById('enter').addEventListener('click', (e) => {
  e.stopPropagation();
  startGame();
});
introEl.addEventListener('click', startGame);

// 调试 / 截图：?still 直接进场，?x/?z/?yaw 定位，?hour 定点时辰
if (QS.has('still')) {
  if (QS.has('x')) player.x = parseFloat(QS.get('x'));
  if (QS.has('z')) player.z = parseFloat(QS.get('z'));
  if (QS.has('yaw')) player.yaw = parseFloat(QS.get('yaw'));
  if (QS.has('pitch')) player.pitch = parseFloat(QS.get('pitch'));
  if (QS.has('hour')) hour = parseFloat(QS.get('hour'));
  startGame();
}

canvas.addEventListener('mousedown', () => {
  if (started && dragMode) dragging = true;
});
window.addEventListener('mouseup', () => { dragging = false; });

canvas.addEventListener('mousemove', (e) => {
  if (!started || paused) return;
  const locked = document.pointerLockElement === canvas;
  if (!locked && !(dragMode && dragging)) return;
  const sens = locked ? 0.0021 : 0.0029;
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = clamp(player.pitch, lying ? 0.1 : -1.2, lying ? 1.3 : 1.15);
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
      toast(`${codeLabel(e.code)} 原本是「${BIND_LABELS[occupied]}」，已与「${BIND_LABELS[action]}」互换`);
    } else {
      toast(`「${BIND_LABELS[action]}」改为 ${codeLabel(e.code)}`);
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
  if (e.code === 'KeyF') toggleLie();
  if (e.code === 'KeyT') skipTime();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyV') {
    thirdPerson = !thirdPerson;
    toast(thirdPerson ? '第三人称 · 再按 V 切回' : '第一人称');
  }
  if (e.code === 'KeyH') body.classList.toggle('clean');
});

window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

function toggleLie() {
  lying = !lying;
  if (lying) {
    savedPitch = player.pitch;
    player.pitch = 0.7;
    showLine('就这样躺着吧，天空会替你保管时间。');
  } else {
    player.pitch = savedPitch;
  }
}

/* ---------------- 16. 声音 ---------------- */
let audioCtx = null;
let masterGain = null;
let muted = false;
let music = null;
let windGain = null;
let waterGain = null;
let rainGain = null;
let currentIndoor = 0;
let thunderFlash = 0;

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
  masterGain.gain.value = 0.6;
  masterGain.connect(audioCtx.destination);

  // 风：低通滤过的棕噪声
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
  lowpass.frequency.value = 640;
  lowpass.Q.value = 0.5;
  windGain = audioCtx.createGain();
  windGain.gain.value = 0.16;
  wind.connect(lowpass).connect(windGain).connect(masterGain);
  wind.start();

  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.055;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 0.07;
  lfo.connect(lfoGain).connect(windGain.gain);
  lfo.start();

  // 水声：只在湖边响，用另一段更低更亮的噪声
  const wlen = audioCtx.sampleRate * 4;
  const wbuf = audioCtx.createBuffer(1, wlen, audioCtx.sampleRate);
  const wd = wbuf.getChannelData(0);
  let l2 = 0;
  for (let i = 0; i < wlen; i++) {
    const white = Math.random() * 2 - 1;
    l2 = (l2 + 0.09 * white) / 1.09;
    wd[i] = l2 * 2.2;
  }
  const waterSrc = audioCtx.createBufferSource();
  waterSrc.buffer = wbuf;
  waterSrc.loop = true;
  const wbp = audioCtx.createBiquadFilter();
  wbp.type = 'bandpass';
  wbp.frequency.value = 1500;
  wbp.Q.value = 0.7;
  waterGain = audioCtx.createGain();
  waterGain.gain.value = 0.0;
  waterSrc.connect(wbp).connect(waterGain).connect(masterGain);
  waterSrc.start();

  // 雨声：白噪声 + 低通，随雨势起落
  const rlen = audioCtx.sampleRate * 3;
  const rbuf = audioCtx.createBuffer(1, rlen, audioCtx.sampleRate);
  const rd = rbuf.getChannelData(0);
  let l3 = 0;
  for (let i = 0; i < rlen; i++) {
    const white = Math.random() * 2 - 1;
    l3 = (l3 + 0.03 * white) / 1.03;
    rd[i] = l3 * 1.6 + white * 0.22;
  }
  const rainSrc = audioCtx.createBufferSource();
  rainSrc.buffer = rbuf;
  rainSrc.loop = true;
  const rlp = audioCtx.createBiquadFilter();
  rlp.type = 'lowpass';
  rlp.frequency.value = 1050;
  rlp.Q.value = 0.35;
  rainGain = audioCtx.createGain();
  rainGain.gain.value = 0;
  rainSrc.connect(rlp).connect(rainGain).connect(masterGain);
  rainSrc.start();

  music = createMusic(audioCtx, masterGain);
  music.start();

  scheduleBirds();
  scheduleCrickets();
}

/* 雷：低频噪声滚过去，配一道天光 */
function thunder() {
  if (!audioCtx || muted) return;
  thunderFlash = 1;
  const t0 = audioCtx.currentTime;
  const len = Math.floor(audioCtx.sampleRate * 2.4);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.16 * white) / 1.16;
    d[i] = last * Math.exp(-i / (len * 0.2)) * 2.8;
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(560, t0);
  lp.frequency.exponentialRampToValueAtTime(80, t0 + 2.2);
  const g = audioCtx.createGain();
  g.gain.value = 0.85;
  src.connect(lp).connect(g).connect(masterGain);
  src.start();
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
    const f = 2100 + Math.random() * 1800;
    osc.frequency.setValueAtTime(f, start);
    osc.frequency.exponentialRampToValueAtTime(f * (1.22 + Math.random() * 0.55), start + 0.055);
    osc.frequency.exponentialRampToValueAtTime(f * 0.86, start + 0.12);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.028, start + 0.014);
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
    if (audioCtx && audioCtx.currentTime > 1 && nightAmount < 0.45 && currentIndoor < 0.5) chirp();
    scheduleBirds();
  }, 3800 + Math.random() * 8000);
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
    osc.frequency.value = 3800 + Math.random() * 600;
    const start = t0 + i * 0.062;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.008, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    osc.connect(gain);
    gain.connect(pan || masterGain);
    osc.start(start);
    osc.stop(start + 0.07);
  }
}

function scheduleCrickets() {
  setTimeout(() => {
    if (nightAmount > 0.35 && !muted) cricketChirp();
    scheduleCrickets();
  }, 520 + Math.random() * 900);
}

function toggleMute() {
  if (!audioCtx) return;
  muted = !muted;
  masterGain.gain.setTargetAtTime(muted ? 0 : 0.6, audioCtx.currentTime, 0.15);
}

/* ---------------- 17. 低语 / 地点提示 ---------------- */
const WHISPERS = [
  '风正好，草也开着。',
  '在这里，时间不必有去处。',
  '把脚步放慢，花不会催你。',
  '远处还是草，再远处还是。',
  '你可以什么都不做。',
  '阳光落在肩上，很轻。',
  '如果累了，按 F 躺下。',
  '湖那边有个亭子，走过去要一会儿。',
  '湖面很静，风来的时候才有一点波纹。',
  '小屋的门是开着的。',
];

const NIGHT_WHISPERS = [
  '萤火虫替草叶守夜。',
  '夜里的湖，听不见边。',
  '星星很多，不用担心数不完。',
  '风变凉了，但屋子里的灯还亮着。',
];

let whisperTimer = null;

function showLine(text, delay = 0) {
  clearTimeout(whisperTimer);
  whisperTimer = setTimeout(() => {
    whisperEl.textContent = text;
    whisperEl.classList.add('on');
    whisperTimer = setTimeout(() => whisperEl.classList.remove('on'), 6200);
  }, delay);
}

let whisperIndex = 1;
setInterval(() => {
  if (!started || paused || body.classList.contains('clean')) return;
  if (nightAmount > 0.55) {
    showLine(NIGHT_WHISPERS[Math.floor(Math.random() * NIGHT_WHISPERS.length)]);
  } else {
    showLine(WHISPERS[whisperIndex++ % WHISPERS.length]);
  }
}, 58000);

let lastPlaceName = '';

function placeNameAt(x, z) {
  if (places.indoorAt(x, z) > 0.5) return '小木屋';
  const dPav = Math.hypot(x - SITES.pavilion.x, z - SITES.pavilion.z);
  if (dPav < 4.2) return '湖心亭';
  const dSt = Math.hypot(x - SITES.station.x, z - SITES.station.z);
  if (dSt < 4.5) return '旧站台';
  const ld = lakeDist(x, z);
  if (ld < 1.15) return '湖边';
  if (ld < 1.55) return '湖岸';
  return '';
}

/* ---------------- 18. 世界更新 ---------------- */
function updateWorld(t, dt) {
  skyUniforms.uTime.value = t;
  sky.position.copy(camera.position);
  sharedUniforms.uTime.value = t;
  sharedUniforms.uWind.value = 0.8 + Math.sin(t * 0.12) * 0.24 + Math.sin(t * 0.35) * 0.09;

  /* ---- 季节与天气 ---- */
  calendar = computeCalendar(t + yearOffset, yearSec);
  weather.update(dt, calendar.season, camera.position.x, camera.position.y, camera.position.z);
  const wx = weather.state;
  const fest = calendar.mainFestival;
  const deco = fest ? fest.deco : '';

  // 节日改变天气口味：清明雨雾、冬至多雪
  const b = weather.bias;
  b[0] = 1; b[1] = 1; b[2] = 1; b[3] = 1; b[4] = 1; b[5] = 1; b[6] = 1;
  if (deco === 'mist') { b[3] = 2.2; b[6] = 2.6; }
  if (deco === 'snow' || calendar.season === 3) b[5] = 2.2;

  // 积雪缓慢积累 / 消融
  snowCover += (wx.snow * (calendar.season === 3 ? 2.0 : 1.0) - snowCover * 0.12) * dt * 0.8;
  snowCover = clamp(snowCover, 0, 1);

  // 季节重染地形与树（节流：半秒一次，禁止 snowCover 差值触发——那会导致下雪天每帧全量刷闪屏）
  seasonClock += dt;
  if (seasonClock > 0.5 || calendar.season !== lastAppliedSeason) {
    seasonClock = 0;
    lastAppliedSnow = snowCover;
    lastAppliedSeason = calendar.season;
    applySeasonTerrain(calendar.season, calendar.seasonT, snowCover);
    applySeasonTrees(calendar.season, calendar.seasonT, snowCover);
    applySeasonForest(calendar.season, calendar.seasonT, snowCover);
    const tint = SEASON_TINT[calendar.season];
    grassCardMaterial.uniforms.uSeasonTint.value.set(tint.r, tint.g, tint.b);
    // 冬季草地雪更明显；非冬季下雪也有临时雪（慢慢化）
    grassCardMaterial.uniforms.uSnow.value = snowCover * (calendar.season === 3 ? 1.3 : 0.5);
  }

  // 花粉随季节，清明变柳絮（白）
  pollenMat.opacity = 0.5 * POLLEN_SEASON[calendar.season];
  pollenMat.color.set(deco === 'mist' ? 0xf4f6f0 : 0xfff4d6);

  // 节日装饰
  const fw = places.festival;
  fw.lanterns.visible = deco === 'spring' || deco === 'lantern' || deco === 'snow' || deco === 'smoke';
  fw.couplets.visible = deco === 'spring';
  fw.dragonBoat.visible = deco === 'boat';
  fw.mugwort.visible = deco === 'boat';
  fw.chrys.visible = deco === 'chrys';
  fw.skyOn = deco === 'lanterns';
  fw.enabled = deco === 'spring' || deco === 'lantern' || deco === 'smoke';
  fw.root.visible = !!fest;
  fw.update(t, dt, nightAmount);

  // 中秋月更圆更亮，七夕星河更密
  skyUniforms.uMoonBoost.value = deco === 'lanterns' ? fest.fade : 0;
  skyUniforms.uStarBoost.value = deco === 'star' ? fest.fade : 0;

  // 雨打湖面：细碎的小涟漪
  if (wx.rain > 0.25 && Math.random() < wx.rain * 0.7) {
    const ripples = places.water.ripples;
    const i = (Math.random() * ripples.length) | 0;
    const a = Math.random() * TAU;
    const r = Math.sqrt(Math.random()) * LAKE.r * 0.92;
    ripples[i].set(LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r * 0.92, t, 0.22);
  }

  // 雷
  thunderFlash = Math.max(0, thunderFlash - dt * 1.4);
  if (wx.rain > 0.82 && Math.random() < dt / 30) thunder();

  // 天气 HUD（节流）
  hudClock += dt;
  if (hudClock > 0.4) {
    hudClock = 0;
    updateWeatherHud();
  }

  // 阴影矩阵
  const shadowMap = sunLight.shadow.map;
  sharedUniforms.uShadowMap.value = NO_SHADOW || !shadowMap ? whitePixel : shadowMap.texture;
  sharedUniforms.uShadowMatrix.value.copy(sunLight.shadow.matrix);
  sharedUniforms.uShadowTexel.value = 1 / (sunLight.shadow.mapSize.x || 4096);

  // 花粉
  const arr = pollenGeo.attributes.position.array;
  for (let i = 0; i < POLLEN_COUNT; i++) {
    const ix = i * 3;
    arr[ix] += (0.5 + Math.sin(t * 0.47 + pollenSeeds[i]) * 0.26) * dt;
    arr[ix + 2] += (0.3 + Math.cos(t * 0.41 + pollenSeeds[i] * 1.3) * 0.22) * dt;
    arr[ix + 1] += Math.sin(t * 0.85 + pollenSeeds[i]) * 0.032 * dt;

    let wrapped = false;
    if (arr[ix] - camera.position.x > 40) {
      arr[ix] -= 80;
      wrapped = true;
    }
    if (arr[ix] - camera.position.x < -40) {
      arr[ix] += 80;
      wrapped = true;
    }
    if (arr[ix + 2] - camera.position.z > 40) {
      arr[ix + 2] -= 80;
      wrapped = true;
    }
    if (arr[ix + 2] - camera.position.z < -40) {
      arr[ix + 2] += 80;
      wrapped = true;
    }

    // 只在重生时采样一次地形，避免每帧上千次高度查询
    if (wrapped) {
      pollenGround[i] = heightAt(arr[ix], arr[ix + 2]);
      arr[ix + 1] = pollenGround[i] + 0.14 + Math.random() * 2.8;
    } else if (arr[ix + 1] < pollenGround[i] + 0.14) {
      arr[ix + 1] = pollenGround[i] + 0.14 + Math.random() * 1.8;
    }

    // 贴到镜头前会被放大成一片白斑，直接挪到远处
    const ddx = arr[ix] - camera.position.x;
    const ddy = arr[ix + 1] - camera.position.y;
    const ddz = arr[ix + 2] - camera.position.z;
    if (ddx * ddx + ddy * ddy + ddz * ddz < 2.56) {
      const a = Math.random() * TAU;
      const r = 4 + Math.random() * 8;
      arr[ix] = camera.position.x + Math.cos(a) * r;
      arr[ix + 2] = camera.position.z + Math.sin(a) * r;
      pollenGround[i] = heightAt(arr[ix], arr[ix + 2]);
      arr[ix + 1] = pollenGround[i] + 0.3 + Math.random() * 2.6;
    }
  }
  pollenGeo.attributes.position.needsUpdate = true;

  // 蝴蝶
  for (const b of butterflies) {
    const px = b.hx + Math.sin(t * b.speed + b.ph) * 5.8;
    const pz = b.hz + Math.sin(t * b.speed * 0.74 + b.ph * 1.7) * 5.8;
    const py = heightAt(px, pz) + b.yOff + Math.sin(t * 0.82 + b.ph) * 0.3;
    b.sprite.position.set(px, py, pz);
    const flap = 0.5 + Math.abs(Math.sin(t * b.flap + b.ph)) * 0.6;
    b.sprite.scale.set(b.baseScale * flap, b.baseScale, 1);
    b.sprite.material.rotation = Math.sin(t * 0.6 + b.ph) * 0.25;
    b.sprite.material.opacity = 0.95 * (1 - nightAmount) * (calendar.season < 2 ? 1 : 0);
  }

  updateFireflies(t, dt);

  // 走近树就把树冠收起来，避免镜头被一团绿糊住（冬季光秃的树本来就没有树冠）
  for (const tc of treeCrowns) {
    const dx = camera.position.x - tc.x;
    const dz = camera.position.z - tc.z;
    tc.crown.visible = dx * dx + dz * dz > 25 && !tc.winterBare;
  }
  if (window.__lakeLights) {
    window.__lakeLights.material.opacity = Math.min(0.9, nightAmount * 0.9);
  }

  // 地点
  places.update(t, timeState, SUN_DIR, timeState.sunI, nightAmount, MOON_DIR);

  // 壁炉火焰轻微摇摆（查所有 userData.isFire 的 Group）
  {
    const walk = (obj) => {
      if (obj.userData && obj.userData.isFire) {
        obj.scale.y = 1 + Math.sin(t * 6) * 0.08 + Math.sin(t * 11) * 0.05;
        obj.position.y = obj.userData.baseY + Math.sin(t * 3.5) * 0.01;
        obj.rotation.y = Math.sin(t * 2.2) * 0.08;
      }
      obj.children.forEach(walk);
    };
    walk(scene);
  }

  // 室内 / 水边
  const indoor = places.indoorAt(player.x, player.z);
  currentIndoor += (indoor - currentIndoor) * Math.min(1, dt * 3.5);
  if (windGain) windGain.gain.setTargetAtTime(lerp(0.16, 0.045, currentIndoor) * (1 + wx.wind * 0.3 + wx.snow * 0.5 + wx.rain * 0.2), audioCtx.currentTime, 0.4);
  if (rainGain) rainGain.gain.setTargetAtTime((wx.rain * 0.3 + wx.snow * 0.05) * (1 - currentIndoor * 0.85), audioCtx.currentTime, 0.5);
  if (waterGain) {
    const ld = lakeDist(player.x, player.z);
    const nearWater = clamp(1 - (ld - 1.0) / 0.9, 0, 1);
    waterGain.gain.setTargetAtTime(nearWater * 0.055, audioCtx.currentTime, 0.6);
  }
  if (music) {
    music.setNight(nightAmount);
    music.setIndoor(currentIndoor);
  }

  // 地点提示
  const name = placeNameAt(player.x, player.z);
  if (name !== lastPlaceName) {
    lastPlaceName = name;
    if (placeEl) {
      placeEl.textContent = name;
      placeEl.classList.toggle('on', !!name);
    }
    if (name === '小木屋') showLine('屋里有灯，风停在外面。');
    if (name === '湖心亭') showLine('四面都是水，声音被摊平了。');
    if (name === '旧站台') showLine('已经很久没有车来了。');
  }
}

function updatePlayer(t, dt) {
  if (!started) {
    const y = heightAt(0, 0) + EYE;
    camera.position.set(0, y + Math.sin(t * 0.4) * 0.032, 0);
    camera.rotation.set(0.02, player.yaw + Math.sin(t * 0.05) * 0.1, Math.sin(t * 0.2) * 0.004);
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

  if (lying && (ix || iz)) lying = false;

  const run = held.has(binds.run) || held.has('ShiftRight');
  const maxSpeed = lying ? 0 : run ? 4.0 : 2.0;

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

  // 碰撞（按高度区分一楼墙 / 二楼墙）
  const feetY = camY - EYE;
  const res = places.resolve(nx, nz, PLAYER_R, feetY);
  nx = res.x;
  nz = res.z;
  for (const c of treeColliders) {
    const dx = nx - c.cx;
    const dz = nz - c.cz;
    const d = Math.hypot(dx, dz);
    const minD = c.hx + PLAYER_R;
    if (d < minD && d > 1e-4) {
      nx = c.cx + (dx / d) * minD;
      nz = c.cz + (dz / d) * minD;
    }
  }

  // 深水不让进（但跳跃中跳过）
  const floorInfo = places.floorAt(nx, nz, feetY);
  const tooDeep = !floorInfo.onDeck && LAKE.level - floorInfo.y > 0.42 && jumpOffset <= 0.01;
  if (!tooDeep) {
    player.x = nx;
    player.z = nz;
  } else {
    player.vx *= 0.2;
    player.vz *= 0.2;
  }

  // 世界边界
  const radius = Math.hypot(player.x, player.z);
  if (radius > WORLD.radius) {
    player.x *= WORLD.radius / radius;
    player.z *= WORLD.radius / radius;
  }

  const speed = Math.hypot(player.vx, player.vz);
  player.bob += dt * speed * 3.0;

  lieAmount += ((lying ? 1 : 0) - lieAmount) * Math.min(1, dt * 3.2);

  const eye = lerp(EYE, LIE_EYE, lieAmount);

  // 跳跃（edge-triggered）：地面上才允许跳，起跳瞬间锁定 jumpFloorY
  const curFloor = floorInfo.y;
  const wasOnGround = jumpOffset <= 0.01 && jumpVy <= 0;
  const jumpKey = held.has(binds.jump) || held.has('Space');
  if (jumpKey && !jumpQueued && wasOnGround && !lying) {
    jumpVy = JUMP_V0;
    jumpOffset = 0;
    jumpFloorY = curFloor;
  }
  jumpQueued = jumpKey;

  // 重力 + 位移
  if (jumpOffset > 0 || jumpVy > 0) {
    jumpVy -= JUMP_G * dt;
    jumpOffset += jumpVy * dt;
    // 落地判定：起跳点 + jumpOffset <= 当前地面高度（玩家"落回"任何可站的地方）
    // 用 curFloor 和 jumpFloorY + jumpOffset 比较，这样能跳到更高的 deck 上
    const expectedGround = jumpFloorY + jumpOffset;
    const actualFloor = curFloor;
    if (jumpVy < 0 && expectedGround <= actualFloor + 0.02) {
      // 落地：把 jumpOffset 对齐到当前地形（玩家可以跳到更高的地方）
      jumpOffset = Math.max(0, actualFloor - jumpFloorY);
      jumpVy = 0;
    }
  }

  // camY = 起跳点 + 眼高 + 跳跃偏移（空中时不受下方地形影响）
  const targetCamY = jumpOffset > 0.01 || jumpVy > 0
    ? jumpFloorY + eye + jumpOffset
    : curFloor + eye;
  camY = lerp(camY, targetCamY, 1 - Math.exp(-dt * (jumpOffset > 0.01 ? 16 : 11)));

  const bobAmt = Math.min(speed / 2.0, 1) * (1 - lieAmount);
  const bobY = Math.sin(player.bob) * 0.021 * bobAmt;
  const bobX = Math.sin(player.bob * 0.5) * 0.011 * bobAmt;

  // 玩家小木人（第三人称可见）
  if (!avatar) buildAvatar();
  if (avatar) {
    avatar.g.visible = thirdPerson && started;
    if (avatar.g.visible) {
      const swing = Math.sin(player.bob) * bobAmt;
      avatar.legL.rotation.x = swing * 0.6;
      avatar.legR.rotation.x = -swing * 0.6;
      avatar.armL.rotation.x = -swing * 0.5;
      avatar.armR.rotation.x = swing * 0.5;
      avatar.g.position.set(player.x, (camY - eye) + 0.02, player.z);
      avatar.g.rotation.y = player.yaw;
    }
  }

  const roll = Math.sin(player.bob * 0.5) * 0.004 * bobAmt + lieAmount * Math.sin(t * 0.5) * 0.011;

  if (thirdPerson) {
    // 第三人称：相机在身后，看向玩家
    // 玩家 forward = (-sin(yaw), -cos(yaw))，身后 = player - forward*back
    const indoorT = places.indoorAt(player.x, player.z) > 0.4;
    const back = indoorT ? 1.9 : 3.4;
    let cx = player.x + Math.sin(player.yaw) * back;
    let cz = player.z + Math.cos(player.yaw) * back;
    let cy = camY + 0.5 - clamp(player.pitch, -0.6, 0.8) * 1.6;

    // 相机防穿墙：撞到就贴墙并向玩家拉近
    const res = places.resolve(cx, cz, 0.3, camY - eye);
    if (Math.hypot(res.x - cx, res.z - cz) > 0.02) {
      cx = res.x;
      cz = res.z;
      const ddx = player.x - cx;
      const ddz = player.z - cz;
      const dd = Math.hypot(ddx, ddz) || 1;
      cx += (ddx / dd) * 0.4;
      cz += (ddz / dd) * 0.4;
    }
    // 不穿地 / 不进水
    const floorCam = places.floorAt(cx, cz, camY - eye).y;
    cy = Math.max(cy, floorCam + 0.45);
    if (lakeDist(cx, cz) < 1) cy = Math.max(cy, LAKE.level + 0.35);

    if (!tpCam) tpCam = { x: cx, y: cy, z: cz };
    const k = 1 - Math.exp(-dt * 9);
    tpCam.x += (cx - tpCam.x) * k;
    tpCam.y += (cy - tpCam.y) * k;
    tpCam.z += (cz - tpCam.z) * k;
    camera.position.set(tpCam.x, tpCam.y, tpCam.z);
    camera.lookAt(player.x, camY - 0.45, player.z);
  } else {
    tpCam = null;
    camera.position.set(
      player.x + bobX * Math.cos(player.yaw),
      camY + bobY,
      player.z - bobX * Math.sin(player.yaw)
    );
    camera.rotation.set(player.pitch + lieAmount * 0.06, player.yaw, roll, 'YXZ');
    camera.position.y += Math.sin(t * 0.7) * 0.0035 * (1 - lieAmount);
  }

  ensureChunks(player.x, player.z);
}

/* ---------------- 19. 主循环 ---------------- */
const postfx = createPostFX(renderer, scene, camera);

/* 湖面平面反射 */
const reflectRT = new THREE.WebGLRenderTarget(2, 2, {
  type: THREE.HalfFloatType,
  depthBuffer: true,
  stencilBuffer: false,
});
reflectRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
const mirrorCam = new THREE.PerspectiveCamera();
const reflectSize = new THREE.Vector2();
const reflectClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LAKE.level + 0.03);
const reflectBias = new THREE.Matrix4().set(
  0.5, 0, 0, 0.5,
  0, 0.5, 0, 0.5,
  0, 0, 0.5, 0.5,
  0, 0, 0, 1
);
const reflectMatrix = new THREE.Matrix4();

function resizeReflection() {
  renderer.getDrawingBufferSize(reflectSize);
  // 高分屏上死守 0.62 会让反射贴图比屏幕还贵：限制到约 1200 宽，远处看不出差别
  const scale = clamp(1200 / Math.max(reflectSize.x, 1), 0.4, 0.62);
  reflectRT.setSize(
    Math.max(2, Math.floor(reflectSize.x * scale)),
    Math.max(2, Math.floor(reflectSize.y * scale))
  );
}

resizeReflection();
places.water.uniforms.uReflection.value = reflectRT.texture;

const reflectForward = new THREE.Vector3();
const reflectToLake = new THREE.Vector3();

function renderReflection() {
  const u = places.water.uniforms;
  const toLake = reflectToLake.set(LAKE.x - camera.position.x, 0, LAKE.z - camera.position.z);
  const lakeDistNow = toLake.length();
  if (lakeDistNow > 0.001) toLake.multiplyScalar(1 / lakeDistNow);
  camera.getWorldDirection(reflectForward);

  // 湖在身后、或者远到只剩一条线时，整个反射 pass 都可以省掉，退回解析天空
  if (
    camera.position.y <= LAKE.level + 0.05 ||
    lakeDistNow > 185 ||
    (lakeDistNow > 62 && toLake.dot(reflectForward) < -0.12)
  ) {
    u.uReflValid.value = 0;
    return;
  }
  u.uReflValid.value = 1;

  mirrorCam.fov = camera.fov;
  mirrorCam.aspect = camera.aspect;
  mirrorCam.near = camera.near;
  mirrorCam.far = camera.far;
  mirrorCam.position.set(
    camera.position.x,
    2 * LAKE.level - camera.position.y,
    camera.position.z
  );
  mirrorCam.rotation.set(-camera.rotation.x, camera.rotation.y, -camera.rotation.z, 'YXZ');
  mirrorCam.updateProjectionMatrix();
  mirrorCam.updateMatrixWorld();

  reflectMatrix
    .copy(reflectBias)
    .multiply(mirrorCam.projectionMatrix)
    .multiply(mirrorCam.matrixWorldInverse);
  places.water.uniforms.uReflectMatrix.value.copy(reflectMatrix);

  const waterMesh = places.water.mesh;
  const prevRT = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  const prevColor = renderer.outputColorSpace;
  const prevShadow = renderer.shadowMap.autoUpdate;
  const prevClipping = renderer.clippingPlanes;

  waterMesh.visible = false;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.clippingPlanes = [reflectClip];
  renderer.setRenderTarget(reflectRT);
  renderer.clear();
  renderer.render(scene, mirrorCam);
  renderer.setRenderTarget(prevRT);

  renderer.clippingPlanes = prevClipping;
  renderer.shadowMap.autoUpdate = prevShadow;
  renderer.toneMapping = prevTone;
  renderer.outputColorSpace = prevColor;
  waterMesh.visible = true;
}

let lastFrame = performance.now();
let elapsed = 0;
let fpsClock = 0;
let fpsFrames = 0;

function animate(now) {
  requestAnimationFrame(animate);
  // RAF 时间戳与 performance.now 可能不同源（部分无头环境），dt 必须夹在 [0, 0.05]
  const dt = Math.max(0, Math.min((now - lastFrame) / 1000, 0.05));
  lastFrame = now;
  elapsed += dt;

  updateTime(dt);
  updatePlayer(elapsed, dt);
  updateWorld(elapsed, dt);
  renderReflection();

  postfx.setSun(SUN_DIR, camera);
  postfx.grade.uniforms.uDusk.value = duskAmount;
  postfx.render(dt, elapsed);

  fpsClock += dt;
  fpsFrames++;
  if (fpsClock >= 1) {
    window.__fps = Math.round(fpsFrames / fpsClock);
    fpsClock = 0;
    fpsFrames = 0;
  }
}

/* ---------------- 20. 初始化 ---------------- */
// 先把近处几环铺满，剩下的交给主循环补
ensureChunks(0, 0, 21);
applyTime();
rebuildEnv();
requestAnimationFrame(animate);

// 调试：把历法拨到某个季节 / 节气日 / 天气
window.__setSeason = (s) => {
  const doy = [75, 170, 260, 350][clamp(s | 0, 0, 3)];
  yearOffset = (doy / 365.25) * yearSec - elapsed;
};
window.__setDoy = (d) => {
  yearOffset = (parseFloat(d) / 365.25) * yearSec - elapsed;
};
window.__cal = () => calendar;
window.__weather = () => weather;
window.__probe = () => JSON.stringify({
  cam: camera.position.toArray().map((v) => +v.toFixed(2)),
  yaw: +player.yaw.toFixed(3),
  pitch: +player.pitch.toFixed(3),
  cabin: places.cabin.group.position.toArray().map((v) => +v.toFixed(2)),
  player: [+player.x.toFixed(2), +player.z.toFixed(2)],
  festVisible: places.festival.root.visible,
  lanterns: places.festival.lanterns.visible,
  couplets: places.festival.couplets.visible,
  lanternPos: (() => {
    const l = places.festival.lanterns.children;
    return l.map((c) => c.position.toArray().map((v) => +v.toFixed(1)));
  })(),
  coupletPos: (() => {
    const c = places.festival.couplets.children;
    return c.slice(0, 3).map((m) => m.position.toArray().map((v) => +v.toFixed(1)));
  })(),
  fireOp: +places.festival.fwMat.opacity.toFixed(2),
  night: +nightAmount.toFixed(2),
  floorAt: JSON.stringify(places.floorAt(player.x, player.z)),
  camY: +camY.toFixed(2),
});
window.__dbg = () => {
  const tc = treeCrowns[0];
  return JSON.stringify({
    trees: treeCrowns.length,
    leaf: tc ? '#' + tc.leafMat.color.getHexString() : 'none',
    season: calendar.season,
    tint: '#' + grassCardMaterial.uniforms.uSeasonTint.value.getHexString(),
    snow: +grassCardMaterial.uniforms.uSnow.value.toFixed(3),
    snowVis: weather.snowObj.visible,
    snowOp: +weather.snowObj.material.opacity.toFixed(2),
    rainVis: weather.rainObj.visible,
    wx: weather.state,
  });
};

// 调试用：?still 直接站进世界，跳过开场与 HUD
if (new URLSearchParams(location.search).has('still')) {  started = true;
  body.classList.add('started', 'clean');
  introEl.classList.add('hidden');
  const p = new URLSearchParams(location.search);
  if (p.has('h')) hour = parseFloat(p.get('h'));
  if (p.has('x')) player.x = parseFloat(p.get('x'));
  if (p.has('z')) player.z = parseFloat(p.get('z'));
  if (p.has('yaw')) player.yaw = parseFloat(p.get('yaw'));
  if (p.has('pitch')) player.pitch = parseFloat(p.get('pitch'));
  if (p.has('season')) window.__setSeason(parseInt(p.get('season')));
  if (p.has('doy')) window.__setDoy(parseFloat(p.get('doy')));
  if (p.has('weather')) weather.force(p.get('weather'));
  if (p.has('snow')) snowCover = clamp(parseFloat(p.get('snow')), 0, 1);
  applyTime();
  camY = places.floorAt(player.x, player.z).y + EYE;
  if (p.has('f1')) camY = places.cabin.floorY + EYE;
  if (p.has('camh')) camY = parseFloat(p.get('camh'));
  if (p.has('tp')) thirdPerson = p.get('tp') !== '0';
  // 调试用：?menu 直接打开设置菜单，?panel=keys|world 直达子面板
  if (p.has('menu')) {
    setTimeout(() => openMenu(), 900);
    if (p.has('panel')) setTimeout(() => showPanel(p.get('panel')), 1200);
  }
  if (p.has('probe')) {
    setTimeout(() => {
      document.title = `cam=${camY.toFixed(2)} floor=${places.cabin.floorY.toFixed(2)} px=${player.x.toFixed(1)},${player.z.toFixed(1)}`;
    }, 3500);
  }
  ensureChunks(player.x, player.z, 999);
  if (p.has('noterrain') && terrainMesh) terrainMesh.visible = false;
  if (p.has('noshadowall')) { sunLight.castShadow = false; }
  if (p.has('nofx')) {
    pollen.visible = false;
    fireflies.visible = false;
    for (const b of butterflies) b.sprite.visible = false;
    if (window.__lakeLights) window.__lakeLights.visible = false;
  }
  if (p.has('noinst')) {
    scene.traverse((o) => {
      if (o.isInstancedMesh) o.visible = false;
    });
    for (const tc of treeCrowns) tc.crown.visible = false;
  }
  if (p.has('nograss')) {
    for (const [, chunk] of chunks) {
      chunk.group.traverse((o) => {
        if (o.isInstancedMesh) o.visible = false;
      });
    }
  }
  if (p.has('audio')) {
    initAudio();
    setTimeout(() => {
      if (!window.__err.length) {
        document.title = `OK:${audioCtx ? audioCtx.state : 'noctx'}:${music ? 'music' : 'nomusic'}:fps=${window.__fps}`;
      }
    }, 4000);
  }
  // 调试用：?selftest 跑一遍菜单 + 改键的完整链路
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
        log.push('hint=' + keysEl.textContent.slice(0, 12));
        document.getElementById('btn-save').click();
        log.push('toast=' + toastEl.classList.contains('on'));
      } catch (e) {
        log.push('EX:' + e.message);
      }
      document.title = log.join(' | ');
    }, 2200);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  fireflyMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  postfx.resize();
  resizeReflection();
});
