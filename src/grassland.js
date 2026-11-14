/* =========================================================
   grassland.js — 草原
   一张和原野完全分开的地图：没有湖，只有草、花、羊、牛和农场。
   ========================================================= */

import * as THREE from 'three';
import {
  TAU, clamp, lerp, smoothstep, valueNoise, fbm, mulberry32,
  heightAt, pathDistance, insideFarmWork, meadowBoost, grazeFactor, farmMowFactor,
  FARM, WORLD, PATH_POINTS, INNER_PATH_POINTS, MEADOWS,
} from './grasscore.js';
import { createPostFX } from './postfx.js';
import { createMusic } from './music.js';
import { createTimeOfDay, phaseName, formatClock } from './grasstime.js';
import { createFarm, CROPS } from './grassfarm.js';
import { createHerd } from './grassanimals.js';

/* =========================================================
   0. 基本设置
   ========================================================= */

const canvas = document.getElementById('scene');
window.__err = [];
window.addEventListener('error', (e) => {
  window.__err.push(String(e.message));
  document.title = 'ERR:' + e.message;
});
window.addEventListener('unhandledrejection', (e) => {
  window.__err.push('REJ:' + String(e.reason));
  document.title = 'REJ:' + String(e.reason);
});

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
const FOG_COLOR = 0xd9dfc4;
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0044);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2600);
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
  uSunColor: { value: new THREE.Color(0xfff4d8) },
  uCloud: { value: new THREE.Color(0xfffcf4) },
  uNight: { value: 0 },
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
  uniform vec3 uSunColor;
  uniform vec3 uCloud;
  uniform float uNight;
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

    vec3 col = mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.44, up), 0.58));
    col = mix(col, uHaze, exp(-max(dir.y, 0.0) * 10.0) * 0.22);

    // 积云：底暗顶亮。黄昏时暗面转紫、亮面吃暖光
    if (dir.y > 0.006) {
      vec2 cp = dir.xz / (dir.y + 0.15) * 1.28;
      vec2 drift = vec2(uTime * 0.0020, uTime * 0.0008);
      float base = fbm2(cp * 0.55 + drift);
      float detail = fbm2(cp * 1.62 + drift * 2.2 + 11.0);
      float c = base * 0.58 + detail * 0.42;

      float thr = 0.660 - uCover * 0.22;
      float cover = smoothstep(thr, thr + 0.15, c);
      cover *= smoothstep(0.006, 0.10, dir.y);

      float lit = smoothstep(thr, thr + 0.25, c);
      vec3 shade = uCloud * (0.47 + 0.14 * uNight) * mix(vec3(1.0), vec3(0.60, 0.52, 0.74), uDusk);
      vec3 litCol = mix(uCloud * 1.12, uSunColor, 0.30 + uDusk * 0.55);
      vec3 cloudCol = mix(shade, litCol, lit);

      float back = pow(max(dot(dir, uSunDir), 0.0), 5.0);
      cloudCol += uSunColor * back * (1.0 - lit) * (0.36 + uDusk * 0.9);
      col = mix(col, cloudCol, cover * 0.80);
    }

    // 黄昏：太阳那一侧烧成金橙，另一侧留冷青
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

    // 太阳
    float sd = max(dot(dir, uSunDir), 0.0);
    float sunPeak = mix(4.6, 2.0, uDusk);
    col += uSunColor * (pow(sd, 15000.0) * sunPeak + pow(sd, 520.0) * mix(0.18, 0.26, uDusk) + pow(sd, 13.0) * 0.04);

    // 星空与银河
    if (uNight > 0.01 && dir.y > 0.02) {
      vec2 sph = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0))) * 230.0;
      vec2 id = floor(sph);
      vec2 f = fract(sph) - 0.5;
      float h = hash(id);
      float twinkle = 0.6 + 0.4 * sin(uTime * 1.7 + h * 63.0);
      float star = smoothstep(0.06, 0.0, length(f)) * step(0.972, h) * twinkle;
      float band = exp(-pow((dir.x * 0.7 + dir.z * 0.7) * 3.2, 2.0));
      col += vec3(0.80, 0.86, 1.0) * star * uNight * smoothstep(0.02, 0.2, dir.y) * 1.4;
      col += vec3(0.34, 0.38, 0.52) * band * uNight * 0.055 * smoothstep(0.05, 0.4, dir.y);
    }

    // 月亮
    if (uNight > 0.01) {
      float md = max(dot(dir, uMoonDir), 0.0);
      col += vec3(1.0, 0.97, 0.89) * (pow(md, 9000.0) * 7.0 + pow(md, 420.0) * 0.24) * uNight;
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

const skyMesh = new THREE.Mesh(
  new THREE.SphereGeometry(2000, 48, 28),
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
  ctx.fillStyle = '#a7b46b';
  ctx.fillRect(0, 0, S, S);
  const rnd = mulberry32(20261114);

  for (let i = 0; i < 460; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 18 + rnd() * 88;
    const light = 0.88 + rnd() * 0.26;
    ctx.fillStyle = `rgba(${Math.round(154 * light)},${Math.round(168 * light)},${Math.round(96 * light)},${0.02 + rnd() * 0.045})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, TAU);
    ctx.fill();
  }

  for (let i = 0; i < 36000; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const dry = rnd() < 0.2;
    if (dry) {
      ctx.fillStyle = `rgba(${162 + Math.floor(rnd() * 46)},${146 + Math.floor(rnd() * 36)},${98 + Math.floor(rnd() * 26)},${0.05 + rnd() * 0.1})`;
    } else {
      ctx.fillStyle = `rgba(${112 + Math.floor(rnd() * 50)},${142 + Math.floor(rnd() * 52)},${76 + Math.floor(rnd() * 38)},${0.05 + rnd() * 0.1})`;
    }
    ctx.fillRect(x, y, 0.8 + rnd() * 1.9, 0.8 + rnd() * 2.6);
  }

  for (let i = 0; i < 520; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.7 + rnd() * 1.8;
    const g = 128 + Math.floor(rnd() * 36);
    ctx.fillStyle = `rgba(${g},${g - 8},${g - 20},${0.18 + rnd() * 0.32})`;
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
    const hue = 64 + rnd() * 38;
    const sat = 26 + rnd() * 26;
    const lig = 28 + rnd() * 19;

    const grad = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
    const dry = rnd() < 0.18;
    grad.addColorStop(0, `hsla(${hue},${sat}%,${Math.max(8, lig * 0.42)}%,1)`);
    grad.addColorStop(0.55, `hsla(${hue},${sat}%,${lig}%,1)`);
    grad.addColorStop(1, dry
      ? `hsla(${hue - 16},${sat * 0.7}%,${Math.min(60, lig + 26)}%,0.96)`
      : `hsla(${hue + 8},${Math.max(22, sat - 10)}%,${Math.min(62, lig + 23)}%,0.97)`);
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
    ctx.strokeStyle = `hsla(${64 + rnd() * 24},28%,${44 + rnd() * 18}%,0.9)`;
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
  ctx.fillStyle = '#8f7954';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.8 + rnd() * 2.6;
    const dark = rnd() < 0.55;
    ctx.fillStyle = dark
      ? `rgba(97,78,54,${0.12 + rnd() * 0.24})`
      : `rgba(170,150,112,${0.10 + rnd() * 0.2})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  for (let i = 0; i < 80; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const g = 118 + Math.floor(rnd() * 44);
    ctx.fillStyle = `rgba(${g},${g - 8},${g - 20},0.5)`;
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
  const SEG = 440;
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
  const col = new THREE.Color();
  const rowLen = SEG + 1;
  const cell = SIZE / SEG;

  const grassA = new THREE.Color(0x93a44f);
  const grassB = new THREE.Color(0xc2cc7c);
  const grassDry = new THREE.Color(0xcbbf83);
  const trail = new THREE.Color(0x9c8258);
  const hillTone = new THREE.Color(0x969a70);

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

    // 远处的山脊被草和雾压成灰绿
    const r = Math.hypot(x, z);
    const far = smoothstep(WORLD.hillStart, WORLD.hillFull, r);
    if (far > 0) col.lerp(hillTone, far * 0.5);

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

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: makeGroundTexture(),
    roughness: 1.0,
    metalness: 0.0,
  });

  terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.frustumCulled = false;
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
}

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

/* =========================================================
   6. 风与草
   ========================================================= */

const sharedUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },
  uSunDir: { value: SUN_DIR.clone() },
  uSunColor: { value: new THREE.Color(0xffeec6) },
  uSunI: { value: 1.05 },
  uSkyColor: { value: new THREE.Color(0xb7d2e8) },
  uFogColor: { value: new THREE.Color(FOG_COLOR) },
  uFogDensity: { value: 0.0044 },
  uShadowMap: { value: whitePixel },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowTexel: { value: 1 / 2048 },
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
    float ao = mix(0.54, 1.0, pow(vH, 0.62));

    float ndl = 0.30 + 0.70 * abs(dot(n, uSunDir));
    vec3 sun = uSunColor * ndl * 1.52 * uSunI * sh;
    vec3 amb = uSkyColor * 0.62 + vec3(0.006, 0.011, 0.018);
    vec3 col = vColor * tex.rgb * (sun + amb) * ao;

    float back = pow(max(dot(v, uSunDir), 0.0), 2.2);
    col += vColor * tex.rgb * uSunColor * back * (0.18 + 0.82 * vH) * 0.7 * uSunI * sh;

    col *= mix(vec3(0.93, 0.94, 0.92), vec3(1.16, 1.05, 0.80), clamp(vH, 0.0, 1.0));

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
    vec3 sun = uSunColor * ndl * 1.16 * uSunI * sh;
    vec3 amb = uSkyColor * 0.85 + vec3(0.008, 0.014, 0.024);
    vec3 col = vColor * tex.rgb * (sun + amb);

    float back = pow(max(dot(v, uSunDir), 0.0), 2.0);
    col += vColor * tex.rgb * uSunColor * back * 0.45 * uSunI * sh;

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

/* ---------- 区块化草海 ---------- */

const CHUNK = 30;
const RINGS = 3;
const tuftGeoBase = makeGrassCardGeometry(3, 3);
const stemGeoBase = makeStemGeometry();
const headGeoBase = makeFlowerHeadGeometry();
const seedHeadGeoBase = makeGrassCardGeometry(2, 3);
const cloverGeoBase = makeGrassCardGeometry(2, 2);

const chunks = new Map();
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

const grassPalette = [0xdfe2ad, 0xccd595, 0xe7e8c0, 0xc0cb8c, 0xe1e4b5, 0xb9c57f, 0xd2d89c];
const flowerPalettes = [
  [0xffffff, 0xf8f5e6, 0xfffdf6],
  [0xf6d268, 0xefc65a, 0xf9db78],
  [0xf3bcca, 0xeeabc0, 0xf7cbd6],
  [0xfff8f4, 0xfbecef, 0xfffdfa],
  [0xb8ccef, 0xa9c0ea, 0xcadaf5],
  [0xd8583c, 0xcb4a33, 0xe26848],
];

function ringCount(ring, counts) {
  return counts[Math.min(ring, counts.length - 1)];
}

function buildChunk(cx, cz, ring) {
  const rand = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ 0x9e3779b9);
  const group = new THREE.Group();
  const baseX = cx * CHUNK;
  const baseZ = cz * CHUNK;

  const tuftCount = ringCount(ring, [5000, 4300, 3200, 1800]);
  const flowerCount = ringCount(ring, [1100, 980, 770, 450]);
  const seedCount = ringCount(ring, [280, 250, 190, 110]);
  const cloverCount = ringCount(ring, [830, 750, 590, 350]);

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

    if (pathDistance(x, z) < 1.05 || insideFarmWork(x, z, 0.25)) {
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
    const width = 0.56 + rand() * 0.36;
    const tall = (0.38 + rand() * 0.30) * (0.84 + vitality * 0.42) * grazeFactor(x, z) * farmMowFactor(x, z);
    dummy.scale.set(width, tall, width);
    dummy.updateMatrix();
    grassMesh.setMatrixAt(i, dummy.matrix);

    const c = grassPalette[Math.floor(rand() * grassPalette.length)];
    tmpColor.setHex(c).offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.05);
    if (rand() < 0.12) tmpColor.setHex(0xd7cb90);
    if (vitality > 0.55) tmpColor.offsetHSL(0.012, 0.02, 0.016);
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
    const blocked = pathDistance(x, z) < 1.2 || insideFarmWork(x, z, 0.2);
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
    const blocked = pathDistance(x, z) < 1.15 || insideFarmWork(x, z, 0.2);
    if (blocked || rand() > 0.62 + boost * 0.38) {
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
    const w = 0.34 + rand() * 0.3;
    const h = (0.1 + rand() * 0.12) * grazeFactor(x, z) * farmMowFactor(x, z);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    cloverMesh.setMatrixAt(i, dummy.matrix);
    tmpColor.setHex([0x9fb96b, 0x89aa58, 0xb2c982, 0x7f9e50][Math.floor(rand() * 4)])
      .offsetHSL((rand() - 0.5) * 0.02, 0, (rand() - 0.5) * 0.04);
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
    const inYard = Math.abs(x - FARM.x) < FARM.halfX - 0.6 && Math.abs(z - FARM.z) < FARM.halfZ - 0.6;
    const blocked = pathDistance(x, z) < 1.25 || insideFarmWork(x, z, 0.25) || (inYard && rand() < 0.6);
    if (blocked || rand() > keep) {
      dummy.position.set(x, -999, z);
      dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      stemMesh.setMatrixAt(i, dummy.matrix);
      stemMesh.setColorAt(i, tmpColor.setHex(0x000000));
      stemPhases[i] = 0;
      stemStiffs[i] = 0;
      continue;
    }

    const drift = fbm(x * 0.016 + 21, z * 0.016 - 5, 3) + (rand() - 0.5) * 0.06;
    let kind = 0;
    if (drift < 0.36) kind = 0;
    else if (drift < 0.50) kind = 1;
    else if (drift < 0.60) kind = 2;
    else if (drift < 0.70) kind = 3;
    else if (drift < 0.82) kind = 4;
    else kind = 5;

    const cluster = fbm(x * 0.035 + 31, z * 0.035 - 12, 3);
    if (cluster < 0.36 && rand() < 0.45) {
      x = baseX + rand() * CHUNK;
      z = baseZ + rand() * CHUNK;
      y = heightAt(x, z);
    }

    const tall = rand() < 0.12;
    const stemH = tall ? 0.52 + rand() * 0.22 : 0.26 + rand() * 0.15;
    const headSize = (kind === 3 || kind === 4 || kind === 5 ? 0.17 : tall ? 0.165 : 0.12) + rand() * 0.04;
    const phase = rand() * TAU;

    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rand() * TAU, 0);
    dummy.scale.set(1, Math.max(0.0001, stemH), 1);
    dummy.updateMatrix();
    stemMesh.setMatrixAt(i, dummy.matrix);
    stemMesh.setColorAt(i, tmpColor.setHex(0x4d6029).offsetHSL((rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.08));

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

const POLLEN_COUNT = 760;
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
  size: 0.1,
  map: makePollenTexture(),
  transparent: true,
  depthWrite: false,
  opacity: 0.55,
  color: 0xfff7dc,
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
  for (let i = 0; i < 16; i++) {
    const m = MEADOWS[Math.floor(rand() * MEADOWS.length)];
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

/* ---------------- 蒲公英种子：白天慢慢飘 ---------------- */
const DANDELION_COUNT = 190;
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
  size: 0.15,
  map: makeDandelionTexture(),
  transparent: true,
  depthWrite: false,
  opacity: 0.6,
  color: 0xfffbf0,
  sizeAttenuation: true,
  blending: THREE.NormalBlending,
});
const dandelions = new THREE.Points(dandelionGeo, dandelionMat);
dandelions.frustumCulled = false;
scene.add(dandelions);

/* ---------------- 萤火虫：天黑了才出来 ---------------- */
const FIREFLY_COUNT = 1200;
const fireflyGeo = new THREE.BufferGeometry();
{
  const rnd = mulberry32(8128);
  const pos = new Float32Array(FIREFLY_COUNT * 3);
  const phase = new Float32Array(FIREFLY_COUNT);
  const size = new Float32Array(FIREFLY_COUNT);
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const r = Math.sqrt(rnd()) * 40;
    const a = rnd() * TAU;
    const x = Math.cos(a) * r;
    const z = 8 + Math.sin(a) * r;
    pos[i * 3] = x;
    pos[i * 3 + 1] = heightAt(x, z) + 0.4 + rnd() * 2.0;
    pos[i * 3 + 2] = z;
    phase[i] = rnd();
    size[i] = 1.0 + rnd() * 1.1;
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
      const r = Math.sqrt(Math.random()) * 38;
      const a = Math.random() * TAU;
      arr[ix] = camX + Math.cos(a) * r;
      arr[ix + 2] = camZ + Math.sin(a) * r;
      arr[ix + 1] = heightAt(arr[ix], arr[ix + 2]) + 0.35 + Math.random() * 2.0;
    }
    fireflyGeo.attributes.position.needsUpdate = true;
    return;
  }

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const ix = i * 3;
    arr[ix] += (0.055 + Math.sin(t * 0.21 + i) * 0.05) * dt;
    arr[ix + 2] += Math.cos(t * 0.17 + i * 1.7) * 0.05 * dt;

    let wrapped = false;
    if (arr[ix] - camX > 40) { arr[ix] -= 80; wrapped = true; }
    else if (arr[ix] - camX < -40) { arr[ix] += 80; wrapped = true; }
    if (arr[ix + 2] - camZ > 40) { arr[ix + 2] -= 80; wrapped = true; }
    else if (arr[ix + 2] - camZ < -40) { arr[ix + 2] += 80; wrapped = true; }
    if (wrapped) arr[ix + 1] = heightAt(arr[ix], arr[ix + 2]) + 0.35 + Math.random() * 2.0;
  }
  fireflyGeo.attributes.position.needsUpdate = true;
}

/* =========================================================
   8. 农场与动物
   ========================================================= */

const farm = createFarm(scene);

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

const herd = createHerd(scene, { onSound: playAnimalSound, onStep: playAnimalStep });

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
const seedEls = Array.from(document.querySelectorAll('.seed'));
const stockPanel = document.getElementById('stock');
const stockEls = [document.getElementById('c0'), document.getElementById('c1'), document.getElementById('c2')];
const storageEls = [document.getElementById('s0'), document.getElementById('s1'), document.getElementById('s2')];

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
let nearBin = false;
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

function setSeedUI() {
  const sel = farm.getSelected();
  seedEls.forEach((el, i) => el.classList.toggle('on', i === sel));
}

function updateStock(bump = false) {
  for (let i = 0; i < 3; i++) stockEls[i].textContent = String(farm.inventory[i]);
  if (bump && stockPanel) {
    stockPanel.classList.remove('bump');
    void stockPanel.offsetWidth;
    stockPanel.classList.add('bump');
  }
}

function updateStorage() {
  for (let i = 0; i < 3; i++) storageEls[i].textContent = String(farm.storage[i]);
}

function renderPrompt() {
  nearBed = null;
  nearBench = false;
  nearDoor = false;
  nearBin = false;

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

  const binD = Math.hypot(player.x - farm.storageBin.x, player.z - farm.storageBin.z);
  if (farm.isInsideBarn(player.x, player.z) && binD < 2.3) {
    nearBin = true;
    const bag = farm.inventory[0] + farm.inventory[1] + farm.inventory[2];
    const stored = farm.storage[0] + farm.storage[1] + farm.storage[2];
    if (bag > 0) {
      show(
        `bin-${bag}-${stored}`,
        `<span class="key">E</span><span>存入粮仓</span><span class="sub">背包 ${bag} 份 · 已存 ${stored} 份</span>`
      );
    } else {
      show(
        `bin-empty-${stored}`,
        `<span>粮仓</span><span class="sub">已存 ${stored} 份 · 先去菜畦收菜</span>`
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
      `<span class="key">E</span><span>${open ? '关上' : '打开'}谷仓门</span><span class="sub">${open ? '里面就是粮仓' : '推开木门进去'}</span>`
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
    html = `<span class="key">E</span><span>收获 · ${def.name}</span><span class="sub">也可直接点击 · ${def.yield} 份</span>`;
    promptBar = null;
  } else {
    const pct = Math.round(farm.bedProgress(bed) * 100);
    key = `grow-${bed.index}-${bed.crop}`;
    html = `<span>${def.name}生长中</span><span class="bar"><i></i></span><span class="sub">${pct}%</span>`;
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
  sfxDoor();
  showToast(open ? '谷仓门开了' : '谷仓门关上了');
  promptKey = '';
  renderPrompt();
}

function depositGrain() {
  const res = farm.depositStorage();
  if (res.total > 0) {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      if (res.moved[i]) parts.push(`${CROPS[i].name} ${res.moved[i]}`);
    }
    showToast(`存入粮仓 · ${parts.join(' · ')}`, 3000);
    updateStock(true);
    updateStorage();
    sfxDeposit();
  } else {
    showToast('背包空着 · 先去菜畦收菜');
  }
  promptKey = '';
  renderPrompt();
}

function interact() {
  if (seated) {
    standUp();
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
  if (!nearBed) return;
  const res = farm.interact(nearBed);
  if (res.type === 'plant') {
    showToast(`种下了 · ${CROPS[res.crop].name}`);
    sfxPlant();
  } else if (res.type === 'harvest') {
    showToast(`+${res.amount} ${CROPS[res.crop].name}`);
    updateStock(true);
    sfxHarvest();
  } else if (res.type === 'wait') {
    showToast(`${CROPS[res.crop].name}还在长 · ${Math.round(res.progress * 100)}%`);
  }
  promptKey = '';
  renderPrompt();
}

function pickBedAt(clientX, clientY) {
  clickNdc.set(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(clickNdc, camera);
  raycaster.far = 9;
  const hits = raycaster.intersectObjects(farm.clickTargets, false);
  if (!hits.length) return null;
  return farm.beds[hits[0].object.userData.bedIndex] || null;
}

function onCanvasClick(e) {
  if (!started || paused) return;
  const locked = document.pointerLockElement === canvas;
  const bed = locked
    ? pickBedAt(window.innerWidth * 0.5, window.innerHeight * 0.5)
    : pickBedAt(e.clientX, e.clientY);

  if (bed) {
    const res = farm.harvestBed(bed);
    if (res.type === 'harvest') {
      showToast(`+${res.amount} ${CROPS[res.crop].name}`);
      updateStock(true);
      sfxHarvest();
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
    paused = false;
    pauseEl.classList.add('hidden');
    body.classList.add('playing');
  } else if (started) {
    if (dragMode) {
      paused = false;
      body.classList.remove('playing');
      pauseEl.classList.add('hidden');
    } else {
      paused = true;
      body.classList.remove('playing');
      pauseEl.classList.remove('hidden');
    }
  }
});
document.addEventListener('pointerlockerror', () => enableDragMode());
pauseEl.addEventListener('click', () => {
  pauseEl.classList.add('hidden');
  paused = false;
  canvas.focus();
  tryLock();
});
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
      canvas.style.cursor = pickBedAt(e.clientX, e.clientY) ? 'pointer' : 'default';
      return;
    }
    dx = e.clientX - lastMouseX;
    dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.style.cursor = pickBedAt(e.clientX, e.clientY) ? 'pointer' : 'default';
  }

  if (!dx && !dy) return;
  const sens = locked ? 0.0021 : 0.0029;
  player.yaw -= dx * sens;
  player.pitch = clamp(player.pitch - dy * sens, -1.15, 1.15);
});

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  held.add(e.code);
  if (!started) {
    if (e.code === 'Enter') startGame();
    return;
  }
  if (seated && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
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
let stepBuffer = null;

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

  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.052;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain).connect(windGain.gain);
  lfo.start();

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

/* =========================================================
   11.5 时辰 / 天光
   ========================================================= */

let lastClockText = '';

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
  skyUniforms.uCloud.value.copy(s.cloud);
  skyUniforms.uSunColor.value.copy(s.sun);
  skyUniforms.uNight.value = s.night;
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
  moonLight.intensity = s.night * 0.55;
  renderer.toneMappingExposure = s.expo;

  sharedUniforms.uSunDir.value.copy(SUN_DIR);
  sharedUniforms.uSunColor.value.copy(s.sun);
  sharedUniforms.uSunI.value = clamp(s.sunI / 3.0, 0.05, 1.2);
  sharedUniforms.uSkyColor.value.copy(s.hemiSky);
  sharedUniforms.uFogColor.value.copy(s.fog);
  sharedUniforms.uFogDensity.value = s.fogD;

  fireflyMat.uniforms.uOpacity.value = smoothstep(4, -5, s.elev) * 0.95;
  pollenMat.opacity = 0.55 * (1 - s.night * 0.85);
  dandelionMat.opacity = 0.6 * (1 - s.night * 0.9);

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

function updateWorld(t, dt) {
  skyUniforms.uTime.value = t;
  skyMesh.position.copy(camera.position);
  sharedUniforms.uTime.value = t;
  sharedUniforms.uWind.value = 0.82 + Math.sin(t * 0.12) * 0.22 + Math.sin(t * 0.35) * 0.08;

  // 阴影矩阵
  const shadowMap = sunLight.shadow.map;
  sharedUniforms.uShadowMap.value = NO_SHADOW || !shadowMap ? whitePixel : shadowMap.texture;
  sharedUniforms.uShadowMatrix.value.copy(sunLight.shadow.matrix);
  sharedUniforms.uShadowTexel.value = 1 / (sunLight.shadow.mapSize.x || 2048);

  // 阳光跟着玩家走，38 米的阴影范围才不浪费
  const gy = heightAt(player.x, player.z);
  sunLight.position.set(player.x, gy, player.z).addScaledVector(SUN_DIR, 150);
  sunLight.target.position.set(player.x, gy, player.z);
  sunLight.target.updateMatrixWorld();

  moonLight.position.set(player.x, gy, player.z).addScaledVector(MOON_DIR, 130);
  moonLight.target.position.set(player.x, gy, player.z);
  moonLight.target.updateMatrixWorld();

  // 花粉
  const arr = pollenGeo.attributes.position.array;
  for (let i = 0; i < POLLEN_COUNT; i++) {
    const ix = i * 3;
    arr[ix] += (0.42 + Math.sin(t * 0.47 + pollenSeeds[i]) * 0.24) * dt;
    arr[ix + 2] += (0.26 + Math.cos(t * 0.41 + pollenSeeds[i] * 1.3) * 0.2) * dt;
    arr[ix + 1] += Math.sin(t * 0.85 + pollenSeeds[i]) * 0.03 * dt;

    let wrapped = false;
    if (arr[ix] - camera.position.x > 42) { arr[ix] -= 84; wrapped = true; }
    if (arr[ix] - camera.position.x < -42) { arr[ix] += 84; wrapped = true; }
    if (arr[ix + 2] - camera.position.z > 42) { arr[ix + 2] -= 84; wrapped = true; }
    if (arr[ix + 2] - camera.position.z < -42) { arr[ix + 2] += 84; wrapped = true; }

    if (wrapped) {
      pollenGround[i] = heightAt(arr[ix], arr[ix + 2]);
      arr[ix + 1] = pollenGround[i] + 0.14 + Math.random() * 2.7;
    } else if (arr[ix + 1] < pollenGround[i] + 0.14) {
      arr[ix + 1] = pollenGround[i] + 0.14 + Math.random() * 1.7;
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

  // 蝴蝶
  for (const b of butterflies) {
    const px = b.hx + Math.sin(t * b.speed + b.ph) * 5.2;
    const pz = b.hz + Math.sin(t * b.speed * 0.74 + b.ph * 1.7) * 5.2;
    const py = heightAt(px, pz) + b.yOff + Math.sin(t * 0.82 + b.ph) * 0.26;
    b.sprite.position.set(px, py, pz);
    const flap = 0.5 + Math.abs(Math.sin(t * b.flap + b.ph)) * 0.6;
    b.sprite.scale.set(b.baseScale * flap, b.baseScale, 1);
    b.sprite.material.rotation = Math.sin(t * 0.6 + b.ph) * 0.25;
    b.sprite.material.opacity = 0.95 * (1 - timeState.night * 0.95);
  }

  // 蜜蜂
  for (const b of bees) {
    const a = t * b.speed + b.ph;
    const px = b.hx + Math.cos(a) * b.radius;
    const pz = b.hz + Math.sin(a * 0.8) * b.radius;
    const py = heightAt(px, pz) + b.yOff + Math.sin(t * 6 + b.ph) * 0.08;
    b.sprite.position.set(px, py, pz);
    const s = b.baseScale * (0.85 + Math.abs(Math.sin(t * 24 + b.ph)) * 0.3);
    b.sprite.scale.setScalar(s);
    b.sprite.material.opacity = 0.95 * (1 - timeState.night * 0.95);
  }

  // 蒲公英种子
  const darr = dandelionGeo.attributes.position.array;
  for (let i = 0; i < DANDELION_COUNT; i++) {
    const ix = i * 3;
    darr[ix] += (0.18 + Math.sin(t * 0.33 + dandelionSeeds[i]) * 0.1) * dt;
    darr[ix + 2] += (0.06 + Math.cos(t * 0.27 + dandelionSeeds[i] * 1.4) * 0.08) * dt;
    darr[ix + 1] += Math.sin(t * 0.5 + dandelionSeeds[i]) * 0.05 * dt;

    let wrapped = false;
    if (darr[ix] - camera.position.x > 38) { darr[ix] -= 76; wrapped = true; }
    else if (darr[ix] - camera.position.x < -38) { darr[ix] += 76; wrapped = true; }
    if (darr[ix + 2] - camera.position.z > 38) { darr[ix + 2] -= 76; wrapped = true; }
    else if (darr[ix + 2] - camera.position.z < -38) { darr[ix + 2] += 76; wrapped = true; }
    if (wrapped) {
      dandelionGround[i] = heightAt(darr[ix], darr[ix + 2]);
      darr[ix + 1] = dandelionGround[i] + 0.35 + Math.random() * 2.3;
    }
  }
  dandelionGeo.attributes.position.needsUpdate = true;

  updateFireflies(t, dt);

  // 农场
  farm.update(t, dt);
  herd.update(t, dt, player, timeState.night);

  // 地点名
  const inFarm = Math.abs(player.x - FARM.x) < FARM.halfX + 0.5 && Math.abs(player.z - FARM.z) < FARM.halfZ + 0.5;
  const name = inFarm ? '草原农场' : '';
  if (name !== lastPlaceName) {
    lastPlaceName = name;
    placeEl.textContent = name;
    placeEl.classList.toggle('on', !!name);
    if (name) showToast('菜畦就在右手边');
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
    camY = lerp(camY, heightAt(player.x, player.z) + 1.12, 1 - Math.exp(-dt * 10));
    camera.position.set(player.x, camY, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    return;
  }

  let ix = 0;
  let iz = 0;
  if (!paused) {
    if (held.has('KeyW') || held.has('ArrowUp')) iz -= 1;
    if (held.has('KeyS') || held.has('ArrowDown')) iz += 1;
    if (held.has('KeyA') || held.has('ArrowLeft')) ix -= 1;
    if (held.has('KeyD') || held.has('ArrowRight')) ix += 1;
  }

  const run = held.has('ShiftLeft') || held.has('ShiftRight');
  const maxSpeed = run ? 3.9 : 2.1;

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

  const radius = Math.hypot(player.x, player.z);
  if (radius > WORLD.radius) {
    player.x *= WORLD.radius / radius;
    player.z *= WORLD.radius / radius;
  }

  const speed = Math.hypot(player.vx, player.vz);
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

  postfx.setSun(SUN_DIR, camera);
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
setSeedUI();
applyTime();
ensureChunks(player.x, player.z, 21);
requestAnimationFrame(animate);

// 调试 / 截图：?still 直接站进草原
if (new URLSearchParams(location.search).has('still')) {
  started = true;
  body.classList.add('started');
  introEl.classList.add('hidden');
  const p = new URLSearchParams(location.search);
  if (p.has('x')) player.x = parseFloat(p.get('x'));
  if (p.has('z')) player.z = parseFloat(p.get('z'));
  if (p.has('yaw')) player.yaw = parseFloat(p.get('yaw'));
  if (p.has('pitch')) player.pitch = parseFloat(p.get('pitch'));
  if (p.has('clean')) body.classList.add('clean');

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
  if (p.has('nograss')) {
    for (const [, chunk] of chunks) {
      chunk.group.traverse((o) => {
        if (o.isInstancedMesh) o.visible = false;
      });
    }
  }
  setTimeout(() => {
    document.title = `GRASS:fps=${window.__fps || 0}:beds=${farm.beds.length}:sel=${farm.getSelected()}:h=${timeState.hour.toFixed(1)}:err=${window.__err.length}`;
  }, 3000);
}

window.__grass = { player, farm, herd, heightAt, CROPS, updatePlayer, held, playAnimalSound };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  fireflyMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
  postfx.resize();
});
