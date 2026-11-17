/* =========================================================
   weather.js — 天气状态机与雨雪粒子
   天气按季节抽签：夏天多雷雨，冬天多雪，春秋多雾。
   输出 cloud / rain / snow / fog / wind 五个强度（0..1），
   主场景据此调天光、雾、音效，粒子系统跟着相机走。
   ========================================================= */

import * as THREE from 'three';
import { mulberry32 } from './core.js';

function makeStreakTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(28, 1, 8, 62);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeFlakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 32, 32);
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/* 各季节天气权重 */
const SEASON_WEIGHTS = [
  //         晴    多云   阴    雨   雷雨   雪    雾
  [0.34, 0.26, 0.14, 0.14, 0.02, 0.0, 0.10], // 春
  [0.30, 0.24, 0.14, 0.18, 0.10, 0.0, 0.04], // 夏
  [0.28, 0.26, 0.18, 0.12, 0.04, 0.0, 0.12], // 秋
  [0.24, 0.20, 0.22, 0.06, 0.0, 0.16, 0.12], // 冬
];

const WEATHER_TYPES = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'snow', 'fog'];

/* 目标强度：cloud / rain / snow / fog / wind */
const TARGET = {
  clear:   { cloud: 0.18, rain: 0, snow: 0, fog: 0,    wind: 0.5 },
  cloudy:  { cloud: 0.55, rain: 0, snow: 0, fog: 0,    wind: 0.75 },
  overcast:{ cloud: 0.85, rain: 0, snow: 0, fog: 0.15, wind: 0.6 },
  rain:    { cloud: 0.75, rain: 0.75, snow: 0, fog: 0.15, wind: 0.9 },
  storm:   { cloud: 0.92, rain: 1.0, snow: 0, fog: 0.28, wind: 1.0 },
  snow:    { cloud: 0.7, rain: 0, snow: 0.85, fog: 0.25, wind: 0.65 },
  fog:     { cloud: 0.6, rain: 0, snow: 0, fog: 0.75, wind: 0.35 },
};

export function createWeather(scene) {
  /* ---------- 状态机 ---------- */
  let type = 'clear';
  let nextAt = 90;
  let cur = { cloud: 0.18, rain: 0, snow: 0, fog: 0, wind: 0.5 };
  let last = { ...cur };
  let swapT = 1;
  /* 天气倾向（按节日/季节调整）：顺序与 SEASON_WEIGHTS 一致 */
  const bias = [1, 1, 1, 1, 1, 1, 1];

  function pick(season) {
    const w = SEASON_WEIGHTS[season].map((v, i) => v * (bias[i] || 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return WEATHER_TYPES[i];
    }
    return 'clear';
  }

  /* ---------- 雨 ---------- */
  const RAIN_N = 2400;
  const RAIN_HALF = 26, RAIN_TOP = 30;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_N * 3);
  const rainSeed = new Float32Array(RAIN_N);
  {
    const rnd = mulberry32(9102);
    for (let i = 0; i < RAIN_N; i++) {
      rainPos[i * 3] = (rnd() - 0.5) * RAIN_HALF * 2;
      rainPos[i * 3 + 1] = rnd() * RAIN_TOP;
      rainPos[i * 3 + 2] = (rnd() - 0.5) * RAIN_HALF * 2;
      rainSeed[i] = rnd();
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  }
  const rainMat = new THREE.PointsMaterial({
    size: 0.55,
    map: makeStreakTexture(),
    color: 0x4f6a80,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.NormalBlending,
  });
  const rain = new THREE.Points(rainGeo, rainMat);
  rain.frustumCulled = false;
  rain.renderOrder = 3;
  scene.add(rain);

  /* ---------- 雪 ---------- */
  const SNOW_N = 2500;
  const SNOW_HALF = 30, SNOW_TOP = 28;
  const snowGeo = new THREE.BufferGeometry();
  const snowPos = new Float32Array(SNOW_N * 3);
  const snowSeed = new Float32Array(SNOW_N);
  const snowFall = new Float32Array(SNOW_N);
  {
    const rnd = mulberry32(9103);
    for (let i = 0; i < SNOW_N; i++) {
      snowPos[i * 3] = (rnd() - 0.5) * SNOW_HALF * 2;
      snowPos[i * 3 + 1] = rnd() * SNOW_TOP;
      snowPos[i * 3 + 2] = (rnd() - 0.5) * SNOW_HALF * 2;
      snowSeed[i] = rnd() * Math.PI * 2;
      snowFall[i] = 0.7 + rnd() * 1.4;
    }
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  }
  const snowMat = new THREE.PointsMaterial({
    size: 0.42,
    map: makeFlakeTexture(),
    color: 0xd8e2ee,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  snow.renderOrder = 3;
  scene.add(snow);

  const WIND_BIAS = { x: 0.82, z: 0.57 }; // 与水面风向一致
  let placed = false; // 第一次更新时把粒子搬到相机周围

  return {
    /* 当前强度（调用方每帧读） */
    state: cur,
    bias,
    rainObj: rain,
    snowObj: snow,
    get type() { return type; },

    setWeather(name) {
      type = name;
      last = { ...cur };
      swapT = 0;
    },

    /* 调试用：立即跳到目标天气，不做渐变 */
    force(name) {
      type = name;
      Object.assign(cur, TARGET[name]);
      Object.assign(last, TARGET[name]);
      swapT = 1;
      nextAt = 99999;
    },

    update(dt, season, camX, camY, camZ) {
      nextAt -= dt;
      if (nextAt <= 0) {
        nextAt = 110 + Math.random() * 190;
        last = { ...cur };
        type = pick(season);
        swapT = 0;
      }
      swapT = Math.min(1, swapT + dt / 22);
      const e = swapT * swapT * (3 - 2 * swapT);
      const tg = TARGET[type];
      cur.cloud += (tg.cloud - cur.cloud) * e;
      cur.rain += (tg.rain - cur.rain) * e;
      cur.snow += (tg.snow - cur.snow) * e;
      cur.fog += (tg.fog - cur.fog) * e;
      cur.wind += (tg.wind - cur.wind) * e;

      /* 第一次更新：把粒子盒平移到相机周围（初始化时相机还没就位） */
      if (!placed) {
        placed = true;
        for (let i = 0; i < RAIN_N; i++) {
          const ix = i * 3;
          rainPos[ix] = camX + (Math.random() - 0.5) * RAIN_HALF * 2;
          rainPos[ix + 1] = camY + Math.random() * RAIN_TOP;
          rainPos[ix + 2] = camZ + (Math.random() - 0.5) * RAIN_HALF * 2;
        }
        rainGeo.attributes.position.needsUpdate = true;
        for (let i = 0; i < SNOW_N; i++) {
          const ix = i * 3;
          snowPos[ix] = camX + (Math.random() - 0.5) * SNOW_HALF * 2;
          snowPos[ix + 1] = camY + Math.random() * SNOW_TOP;
          snowPos[ix + 2] = camZ + (Math.random() - 0.5) * SNOW_HALF * 2;
        }
        snowGeo.attributes.position.needsUpdate = true;
      }

      /* 雨 */
      const rainA = cur.rain;
      rainMat.opacity = rainA * 0.8;
      rain.visible = rainA > 0.02;
      if (rain.visible) {
        const speed = 30 + cur.rain * 16;
        const drift = WIND_BIAS.x * cur.wind * 3.2;
        const driftZ = WIND_BIAS.z * cur.wind * 3.2;
        const r = rainPos;
        for (let i = 0; i < RAIN_N; i++) {
          const ix = i * 3;
          r[ix + 1] -= speed * dt;
          r[ix] += drift * dt * (0.6 + rainSeed[i]);
          r[ix + 2] += driftZ * dt * (0.6 + rainSeed[i]);
          if (r[ix + 1] < 0) {
            r[ix + 1] = camY + RAIN_TOP + rainSeed[i] * 6;
            r[ix] = camX + (Math.random() - 0.5) * RAIN_HALF * 2;
            r[ix + 2] = camZ + (Math.random() - 0.5) * RAIN_HALF * 2;
          }
        }
        rainGeo.attributes.position.needsUpdate = true;
      }

      /* 雪 */
      const snowA = cur.snow;
      snowMat.opacity = snowA * 0.95;
      snow.visible = snowA > 0.02;
      if (snow.visible) {
        const s = snowPos;
        for (let i = 0; i < SNOW_N; i++) {
          const ix = i * 3;
          s[ix + 1] -= snowFall[i] * dt;
          s[ix] += (Math.sin(snowSeed[i] + s[ix + 1] * 0.02) * 0.5 + WIND_BIAS.x * cur.wind * 1.1) * dt;
          s[ix + 2] += (Math.cos(snowSeed[i] * 1.3 + s[ix + 1] * 0.018) * 0.4 + WIND_BIAS.z * cur.wind * 1.1) * dt;
          if (s[ix + 1] < 0) {
            s[ix + 1] = camY + SNOW_TOP + Math.random() * 4;
            s[ix] = camX + (Math.random() - 0.5) * SNOW_HALF * 2;
            s[ix + 2] = camZ + (Math.random() - 0.5) * SNOW_HALF * 2;
          }
        }
        snowGeo.attributes.position.needsUpdate = true;
      }
    },
  };
}
