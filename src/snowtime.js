/* =========================================================
   snowtime.js — 雪原的时辰
   和草原同一套结构，换了一整套冷色：天光偏青蓝，雪面反光顶上来，
   黄昏是粉紫，夜里是深蓝加极光。
   ========================================================= */

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './snowcore.js';

export const TIME_KEYS = [
  { h: 0.0, elev: -26, az: 84, sun: 0x8ea8d6, sunI: 0.07, zenith: 0x040a18, horizon: 0x0e1a2e, haze: 0x18283c, cloud: 0x2c3a50, fog: 0x101a28, fogD: 0.0068, hemiSky: 0x1a2c4c, hemiGround: 0x2a3646, hemiI: 0.46, expo: 1.06, cover: 0.26 },
  { h: 4.9, elev: -7, az: 62, sun: 0xb99eb0, sunI: 0.12, zenith: 0x142a4c, horizon: 0x54658a, haze: 0x6d6a86, cloud: 0x6a7488, fog: 0x2c3a4c, fogD: 0.0066, hemiSky: 0x2e4468, hemiGround: 0x27313c, hemiI: 0.46, expo: 1.04, cover: 0.4 },
  { h: 6.3, elev: 3, az: 112, sun: 0xffb9a0, sunI: 0.95, zenith: 0x3a6ba8, horizon: 0xffcfd2, haze: 0xffd2c8, cloud: 0xffd6d8, fog: 0xd8c8d0, fogD: 0.0062, hemiSky: 0x8098bc, hemiGround: 0x6a7280, hemiI: 0.66, expo: 1.03, cover: 0.48 },
  { h: 8.8, elev: 33, az: 122, sun: 0xfff4e2, sunI: 2.5, zenith: 0x2f6db8, horizon: 0xeaf2fa, haze: 0xe4eef8, cloud: 0xfbfdff, fog: 0xdfe9f2, fogD: 0.0054, hemiSky: 0xa8c8ee, hemiGround: 0x8b9cb0, hemiI: 0.96, expo: 1.02, cover: 0.38 },
  { h: 12.5, elev: 61, az: 134, sun: 0xfffaf0, sunI: 3.2, zenith: 0x2a6cbd, horizon: 0xeef4fa, haze: 0xf0f4fa, cloud: 0xffffff, fog: 0xe2ebf4, fogD: 0.0048, hemiSky: 0xaccdf4, hemiGround: 0x8fa2b8, hemiI: 1.04, expo: 1.0, cover: 0.32 },
  { h: 16.4, elev: 27, az: 145, sun: 0xfff2dc, sunI: 2.9, zenith: 0x3570b8, horizon: 0xeef2f6, haze: 0xf2eee4, cloud: 0xfcfdff, fog: 0xdfe8f1, fogD: 0.0054, hemiSky: 0xacccf2, hemiGround: 0x8e9db2, hemiI: 0.98, expo: 1.02, cover: 0.4 },
  { h: 18.0, elev: 12, az: 150, sun: 0xffc9a0, sunI: 2.1, zenith: 0x5a7cae, horizon: 0xf6d2c6, haze: 0xf3c3b4, cloud: 0xf8dcd4, fog: 0xdccbd0, fogD: 0.0060, hemiSky: 0x93a6c4, hemiGround: 0x7b8496, hemiI: 0.76, expo: 1.03, cover: 0.46 },
  { h: 18.45, elev: 7.5, az: 154, sun: 0xffb896, sunI: 1.9, zenith: 0x40639c, horizon: 0xf6c0be, haze: 0xf5b3ac, cloud: 0xf6d0cc, fog: 0xddc2c8, fogD: 0.0062, hemiSky: 0x8a9cc0, hemiGround: 0x76808e, hemiI: 0.7, expo: 1.02, cover: 0.5 },
  { h: 19.0, elev: 2, az: 160, sun: 0xff9a7a, sunI: 1.35, zenith: 0x3e5a92, horizon: 0xefa9b4, haze: 0xee9a9a, cloud: 0xf0b8b8, fog: 0xd0aeb8, fogD: 0.0064, hemiSky: 0x7f8cae, hemiGround: 0x6b7280, hemiI: 0.64, expo: 1.0, cover: 0.5 },
  { h: 19.42, elev: -0.5, az: 164, sun: 0xff8a72, sunI: 0.95, zenith: 0x2c4272, horizon: 0xe08aa0, haze: 0xd97f92, cloud: 0xd8a0a8, fog: 0xa88a9a, fogD: 0.0066, hemiSky: 0x6a7aa0, hemiGround: 0x5a6270, hemiI: 0.6, expo: 1.0, cover: 0.48 },
  { h: 19.8, elev: -2, az: 168, sun: 0xff7d5c, sunI: 0.66, zenith: 0x304a80, horizon: 0xc07888, haze: 0xc07084, cloud: 0xc89098, fog: 0x8e7488, fogD: 0.0068, hemiSky: 0x61719a, hemiGround: 0x505868, hemiI: 0.54, expo: 1.0, cover: 0.44 },
  { h: 20.7, elev: -8, az: 172, sun: 0xd68aa0, sunI: 0.2, zenith: 0x1c2e58, horizon: 0x6a5878, haze: 0x6e5a76, cloud: 0x6a6a80, fog: 0x4a4658, fogD: 0.0070, hemiSky: 0x3e4e72, hemiGround: 0x38404e, hemiI: 0.5, expo: 1.02, cover: 0.38 },
  { h: 21.7, elev: -17, az: 62, sun: 0x9fb6d8, sunI: 0.1, zenith: 0x08142c, horizon: 0x182740, haze: 0x24344a, cloud: 0x3a4a62, fog: 0x18243a, fogD: 0.0068, hemiSky: 0x34507a, hemiGround: 0x2c3746, hemiI: 0.52, expo: 1.05, cover: 0.3 },
  { h: 23.3, elev: -25, az: 68, sun: 0x8fa6c6, sunI: 0.07, zenith: 0x050e20, horizon: 0x0f1c32, haze: 0x1a2a3e, cloud: 0x2c3c54, fog: 0x121e30, fogD: 0.0067, hemiSky: 0x223a5e, hemiGround: 0x263040, hemiI: 0.54, expo: 1.06, cover: 0.26 },
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

const ANCHORS = [
  { h: 18.35, line: '雪面上开始有粉色了。' },
  { h: 19.35, line: '太阳落到冰湖后面去了。' },
  { h: 21.7, line: '极光出来了。' },
  { h: 6.3, line: '天快亮了。' },
  { h: 12.5, line: '正午的雪晃眼。' },
  { h: 16.4, line: '风把雪吹起来了。' },
];

export function phaseName(h) {
  h = ((h % 24) + 24) % 24;
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

export function formatClock(h) {
  h = ((h % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function createTimeOfDay(startHour = 15.2) {
  const state = {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    haze: new THREE.Color(),
    cloud: new THREE.Color(),
    sun: new THREE.Color(),
    fog: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    sunI: 0,
    hemiI: 0,
    fogD: 0,
    expo: 1,
    elev: 0,
    az: 0,
    cover: 0.4,
    dusk: 0,
    night: 0,
    hour: startHour,
  };

  let hour = startHour;
  let jump = null;

  function sample(h) {
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

    state.zenith.lerpColors(a.cZenith, b.cZenith, t);
    state.horizon.lerpColors(a.cHorizon, b.cHorizon, t);
    state.haze.lerpColors(a.cHaze, b.cHaze, t);
    state.cloud.lerpColors(a.cCloud, b.cCloud, t);
    state.sun.lerpColors(a.cSun, b.cSun, t);
    state.fog.lerpColors(a.cFog, b.cFog, t);
    state.hemiSky.lerpColors(a.cHemiSky, b.cHemiSky, t);
    state.hemiGround.lerpColors(a.cHemiGround, b.cHemiGround, t);
    state.sunI = lerp(a.sunI, b.sunI, t);
    state.hemiI = lerp(a.hemiI, b.hemiI, t) * 1.1;
    // 雪原的空气比草原干净：雪面反光强，雾要更薄
    state.fogD = lerp(a.fogD, b.fogD, t) * 0.42;
    state.expo = lerp(a.expo, b.expo, t) * 1.02;
    state.elev = lerp(a.elev, b.elev, t);
    state.az = lerp(a.az, b.az, t);
    state.cover = lerp(a.cover, b.cover, t);
    state.hour = h;

    const elev = (state.elev * Math.PI) / 180;
    const az = (state.az * Math.PI) / 180;
    state.sunDir.set(
      Math.sin(az) * Math.cos(elev),
      Math.sin(elev),
      -Math.cos(az) * Math.cos(elev)
    );
    state.moonDir
      .set(
        -state.sunDir.x * 0.9,
        clamp(-state.sunDir.y + 0.35, 0.15, 0.9),
        -state.sunDir.z * 0.9
      )
      .normalize();

    state.night = smoothstep(9, -3, state.elev);
    state.dusk = smoothstep(15, 5, state.elev) * smoothstep(-8, 1.5, state.elev);
  }

  sample(hour);

  return {
    state,
    get hour() {
      return hour;
    },
    get jumping() {
      return !!jump;
    },
    update(dt) {
      let arrived = null;
      if (jump) {
        jump.elapsed += dt;
        const t = clamp(jump.elapsed / jump.duration, 0, 1);
        const e = t * t * (3 - 2 * t);
        hour = jump.from + jump.diff * e;
        if (t >= 1) {
          arrived = jump.line;
          jump = null;
        }
      } else {
        hour += dt / 120;
      }
      sample(hour);
      return arrived;
    },
    skip() {
      if (jump) return null;
      const h = ((hour % 24) + 24) % 24;
      let anchor = ANCHORS.find((a) => a.h > h + 0.25);
      let to = anchor ? anchor.h : ANCHORS[0].h + 24;
      if (!anchor) anchor = ANCHORS[0];
      const diff = to - h;
      jump = {
        from: hour,
        diff,
        elapsed: 0,
        duration: clamp(diff * 6.0, 11, 26),
        line: anchor.line,
      };
      return anchor.line;
    },
    setHour(h) {
      jump = null;
      hour = h;
      sample(hour);
    },
  };
}
