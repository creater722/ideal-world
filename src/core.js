/* =========================================================
   core.js — 地形 / 噪声 / 共用常量
   世界只有一个真源：heightAt()。地形网格、植被、玩家、
   萤火虫、水面、建筑基座全部读它，保证不会各算各的。
   ========================================================= */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm(x, y, octaves = 4, gain = 0.5, lac = 2.0) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(x * f, y * f);
    f *= lac;
    amp *= gain;
  }
  return v;
}

export function ridged(x, y, octaves = 4) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * f, y * f) * 2 - 1);
    v += amp * n * n;
    f *= 2.07;
    amp *= 0.5;
  }
  return v;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 世界地理 ---------------- */

export const WORLD = {
  radius: 640,        // 玩家可走范围：湖、林子、山脊之间能跑一整圈
  terrainSize: 2400,  // 地形网格边长
  rimStart: 520,      // 山脊起坡半径
  rimFull: 1060,
};

export const LAKE = {
  x: 48,
  z: -88,
  r: 46,
  level: -0.85,
  depth: 5.4,
};

/* 三个地点。坐标写死，因为它们决定了地形要挖/要平的地方 */
export const SITES = {
  cabin: { x: -34, z: -44, yaw: 0.42 },
  pavilion: { x: LAKE.x, z: LAKE.z, yaw: 0.2 },
  station: { x: 82, z: 46, yaw: -1.15 },
};

/* 归一化到湖心的距离：1.0 ≈ 湖岸，>1 在岸上 */
export function lakeDist(x, z) {
  const dx = x - LAKE.x;
  const dz = z - LAKE.z;
  const sz = 0.92;
  const a = Math.atan2(dz / sz, dx);
  // 沿湖岸缓慢起伏的噪声，让岸线不是完美的圆
  const wob =
    1 +
    (valueNoise(Math.cos(a) * 1.7 + 9.3, Math.sin(a) * 1.7 - 4.1) - 0.5) * 0.18 +
    (valueNoise(Math.cos(a) * 4.3 - 3.0, Math.sin(a) * 4.3 + 7.0) - 0.5) * 0.07;
  return Math.hypot(dx, dz / sz) / (LAKE.r * wob);
}

/* 湖盆剖面：中心最深，向岸抬到水面 */
function lakeProfile(ld) {
  const t = clamp(ld / 1.5, 0, 1);
  return LAKE.level - LAKE.depth * Math.cos((t * Math.PI) / 2);
}

export function heightAt(x, z) {
  // 大尺度丘陵：几百米一级的起伏，走过去是真正的坡
  let h = (fbm(x * 0.0021 + 4.7, z * 0.0021 + 9.2, 5) - 0.5) * 44.0;
  // 中尺度缓坡
  h += (fbm(x * 0.0078 - 2.0, z * 0.0078 + 6.0, 4) - 0.5) * 8.2;
  // 小尺度土埂与坑洼
  h += (fbm(x * 0.038 + 13, z * 0.038 - 7, 3) - 0.5) * 1.1;
  h += (fbm(x * 0.085 + 13, z * 0.085 - 7, 3) - 0.5) * 0.32;
  // 极细颗粒，近处踩下去有实感
  h += (valueNoise(x * 0.62 + 3.3, z * 0.62 + 8.1) - 0.5) * 0.055;

  const r = Math.hypot(x, z);

  // 中远处的脊状丘陵：湖和林子之外的地不是一张平纸
  const mid = smoothstep(110, 560, r);
  if (mid > 0) {
    const ridge = ridged(x * 0.0026 + 23, z * 0.0026 - 13, 4);
    h += mid * (ridge - 0.44) * 52.0;
  }

  // 出生点抬升，保证脚下高于水面
  h += 2.1 * Math.exp(-(x * x + z * z) / 6200);

  // 湖盆：1.5 以内交接水面，往外退回自然地形
  const ld = lakeDist(x, z);
  if (ld < 1.62) {
    const w = smoothstep(1.62, 1.04, ld);
    h = lerp(h, lakeProfile(ld), w);
  }

  // 外圈山脊：盆地边缘一圈真正的山，湖在山脚下
  const rim = smoothstep(WORLD.rimStart, WORLD.rimFull, r);
  if (rim > 0) {
    const ridge = ridged(x * 0.0030 + 17, z * 0.0030 - 8, 5);
    h += rim * (14 + ridge * 180);
  }

  return h;
}

/* 湖岸沙滩带：0 = 草地，1 = 湿沙 */
export function shoreAmount(x, z) {
  const ld = lakeDist(x, z);
  const h = heightAt(x, z);
  const above = h - LAKE.level;
  return clamp(smoothstep(1.32, 1.0, ld) * smoothstep(1.1, 0.05, above), 0, 1);
}

/* 缓存的梯度，用来做坡度限制（太陡的地方不长草） */
export function slopeAt(x, z) {
  const e = 0.7;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}
