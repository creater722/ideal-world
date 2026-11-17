/* =========================================================
   grasstime.js — 草原的时辰
   和原野共用同一套调色思路：太阳高度决定一切。
   光色、雾、天光、曝光、星星和萤火虫都从 state 里读。
   ========================================================= */

import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './grasscore.js';

/* 方位角做过偏移：白天的太阳放在镜头身后，
   这样从出生点望向农场时是顺光，草和羊都是亮的；
   黄昏的暖边留在身后，转身就能看见。 */
export const TIME_KEYS = [
  { h: 0.0, elev: -26, az: 84, sun: 0x8fa6c6, sunI: 0.07, zenith: 0x051224, horizon: 0x122642, haze: 0x1c2a3a, cloud: 0x33445a, fog: 0x121b26, fogD: 0.0072, hemiSky: 0x1b2a42, hemiGround: 0x141d15, hemiI: 0.40, expo: 1.05, cover: 0.30 },
  { h: 4.9, elev: -7, az: 62, sun: 0xb9877a, sunI: 0.12, zenith: 0x152846, horizon: 0x53607a, haze: 0x6c6374, cloud: 0x69718a, fog: 0x2f3947, fogD: 0.0070, hemiSky: 0x2f4262, hemiGround: 0x121810, hemiI: 0.42, expo: 1.03, cover: 0.42 },
  { h: 6.3, elev: 3, az: 112, sun: 0xffb07a, sunI: 0.9, zenith: 0x35608f, horizon: 0xffbe93, haze: 0xffc9a2, cloud: 0xffc9b0, fog: 0xd2a68c, fogD: 0.0068, hemiSky: 0x7a8db2, hemiGround: 0x2a3220, hemiI: 0.6, expo: 1.02, cover: 0.5 },
  { h: 8.8, elev: 33, az: 122, sun: 0xffe8bc, sunI: 2.7, zenith: 0x3e81c6, horizon: 0xf6edd4, haze: 0xffe4bd, cloud: 0xfff9ef, fog: 0xd9dcc9, fogD: 0.0058, hemiSky: 0xb7d2ef, hemiGround: 0x53622c, hemiI: 0.92, expo: 1.02, cover: 0.4 },
  { h: 12.5, elev: 61, az: 134, sun: 0xfff5da, sunI: 3.3, zenith: 0x2f74bd, horizon: 0xf2ecd8, haze: 0xffeac6, cloud: 0xfffdf6, fog: 0xd6dbc8, fogD: 0.0052, hemiSky: 0xbcd6f2, hemiGround: 0x5a6830, hemiI: 1.02, expo: 1.0, cover: 0.34 },
  { h: 16.4, elev: 27, az: 145, sun: 0xffeab8, sunI: 3.0, zenith: 0x3f7fc4, horizon: 0xf7eed0, haze: 0xffdfae, cloud: 0xfffaf0, fog: 0xd9dcc9, fogD: 0.0058, hemiSky: 0xbcd6f2, hemiGround: 0x5a6830, hemiI: 0.95, expo: 1.02, cover: 0.42 },
  { h: 18.0, elev: 12, az: 150, sun: 0xffbf74, sunI: 2.2, zenith: 0x557fa8, horizon: 0xffd09a, haze: 0xffb775, cloud: 0xffd2b4, fog: 0xe0b896, fogD: 0.0066, hemiSky: 0x93a5c6, hemiGround: 0x474426, hemiI: 0.72, expo: 1.03, cover: 0.5 },
  { h: 18.45, elev: 7.5, az: 154, sun: 0xffb264, sunI: 1.95, zenith: 0x3d6b96, horizon: 0xffc98f, haze: 0xffb078, cloud: 0xffd0b0, fog: 0xe6b48e, fogD: 0.0068, hemiSky: 0x8a9fc0, hemiGround: 0x4c4428, hemiI: 0.66, expo: 1.02, cover: 0.56 },
  { h: 19.0, elev: 2, az: 160, sun: 0xff9a52, sunI: 1.4, zenith: 0x3f5f96, horizon: 0xffb07d, haze: 0xff8f6a, cloud: 0xffc39c, fog: 0xdcaa88, fogD: 0.0070, hemiSky: 0x7f8cae, hemiGround: 0x3c3720, hemiI: 0.6, expo: 1.0, cover: 0.52 },
  { h: 19.42, elev: -0.5, az: 164, sun: 0xff8a52, sunI: 1.0, zenith: 0x2a4272, horizon: 0xff8c78, haze: 0xff7a63, cloud: 0xf5ac98, fog: 0xd49c86, fogD: 0.0072, hemiSky: 0x6c7ca4, hemiGround: 0x352e1c, hemiI: 0.58, expo: 1.0, cover: 0.52 },
  { h: 19.8, elev: -2, az: 168, sun: 0xff7d45, sunI: 0.7, zenith: 0x334e84, horizon: 0xff8878, haze: 0xff6f58, cloud: 0xf3a98c, fog: 0xcc9578, fogD: 0.0074, hemiSky: 0x66779c, hemiGround: 0x2e2a1b, hemiI: 0.5, expo: 1.0, cover: 0.46 },
  { h: 20.7, elev: -8, az: 172, sun: 0xe98a68, sunI: 0.22, zenith: 0x1f3a68, horizon: 0x8f6478, haze: 0x9a6580, cloud: 0x8a7680, fog: 0x7c5b56, fogD: 0.0076, hemiSky: 0x44567a, hemiGround: 0x1d2216, hemiI: 0.48, expo: 1.02, cover: 0.4 },
  { h: 21.7, elev: -17, az: 62, sun: 0x9fb6d8, sunI: 0.1, zenith: 0x0a1c38, horizon: 0x1d3352, haze: 0x2a3c52, cloud: 0x44556b, fog: 0x1e2e40, fogD: 0.0072, hemiSky: 0x3a5478, hemiGround: 0x121810, hemiI: 0.5, expo: 1.04, cover: 0.34 },
  { h: 23.3, elev: -25, az: 68, sun: 0x8fa6c6, sunI: 0.07, zenith: 0x061428, horizon: 0x132845, haze: 0x1e2c3d, cloud: 0x36475c, fog: 0x141d27, fogD: 0.0071, hemiSky: 0x2a405e, hemiGround: 0x18211a, hemiI: 0.52, expo: 1.05, cover: 0.3 },
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
  { h: 18.35, line: '光开始变暖了。' },
  { h: 19.35, line: '太阳快落到草下面去了。' },
  { h: 21.7, line: '萤火虫出来了。' },
  { h: 6.3, line: '天快亮了。' },
  { h: 12.5, line: '正午的光很亮，草都低着头。' },
  { h: 16.4, line: '风又变软了。' },
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

export function createTimeOfDay(startHour = 16.4) {
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
    state.hemiI = lerp(a.hemiI, b.hemiI, t) * 1.08;
    // 雾：地图放大到两公里之后，原来的密度等于把世界关在 300 米以内。
    // 现在要能看见远处的丘陵和雪山脚下的花道，密度降到三分之一左右，
    // 只留一层薄纱做空气透视。
    state.fogD = lerp(a.fogD, b.fogD, t) * 0.27;
    state.expo = lerp(a.expo, b.expo, t) * 1.06;
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
