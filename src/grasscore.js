/* =========================================================
   grasscore.js — 草原地形 / 噪声 / 地理常量
   草原是独立的一张地图：没有湖，没有原野的山脊包围，
   只有缓慢起伏的草海和很远、很淡的山影。
   所有东西（草、花、羊、牛、农场、玩家）都只认 heightAt()。
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
  radius: 1080,       // 玩家能走到的边界：一路能走到雪山脚下
  terrainSize: 2600,  // 地形网格边长
  hillStart: 470,     // 外圈山脊开始抬起的半径
  hillFull: 1120,
};

/* 农场。坐标写死：地形要在这里压平 */
export const FARM = {
  x: 17,
  z: -31,
  y: 0,          // 由 baseHeight 算出
  radius: 16.5,  // 完全平整
  blend: 26.0,   // 向草地过渡的外半径
  halfX: 9.2,
  halfZ: 8.2,
  gateHalf: 1.35,
};

/* 一条从出生点绕到农场门口的土路（也给 terrain 上色用） */
export const PATH_POINTS = [
  [0.0, 8.0],
  [0.8, 1.5],
  [3.2, -5.5],
  [7.2, -13.0],
  [11.5, -18.8],
  [15.0, -21.5],
  [17.0, -22.4],
];

export const INNER_PATH_POINTS = [
  [17.0, -24.2],
  [17.4, -27.0],
  [18.5, -31.0],
  [19.6, -35.4],
];

/* 花海：草原南面一大片缓坡，整坡都种上花。
   从出生点沿土路走向农场，越过农场左手边就能看见。 */
export const FLOWER_SEA = { x: -24, z: -88, r: 34 };

/* 小花海：这几个地方花会明显变密 */
export const MEADOWS = [
  { x: -9, z: -2, r: 13, k: 1.0 },
  { x: 5, z: 3, r: 8, k: 0.8 },
  { x: 6, z: -11, r: 9, k: 0.9 },
  { x: 17, z: -17, r: 9, k: 0.85 },
  { x: 27, z: -44, r: 11, k: 0.7 },
  { x: -18, z: -26, r: 13, k: 0.8 },
  { x: -3, z: -15, r: 8, k: 0.7 },
  { x: 2, z: 22, r: 10, k: 0.6 },
];

/* 地形基础高度。
   原来的草原是一层几十厘米的小起伏铺到天边，走两百米和走两公里看到的是同一张图。
   现在分五层叠：大尺度缓丘（±32m）→ 中尺度坡地 → 通往雪山的谷地 →
   中远处的脊状丘陵 → 地平线上的一圈远山。 */
function baseHeight(x, z) {
  // 1) 大尺度地势：八九百米一级的缓丘，走过来是一道道波澜
  let h = (fbm(x * 0.00115 + 4.2, z * 0.00115 - 2.6, 5) - 0.5) * 64.0;
  // 2) 中尺度坡地
  h += (fbm(x * 0.0042 + 8.1, z * 0.0042 + 3.4, 4) - 0.5) * 13.0;
  // 3) 小起伏与踩下去的手感
  h += (fbm(x * 0.0190 - 2.1, z * 0.0190 + 7.3, 3) - 0.5) * 2.2;
  h += (fbm(x * 0.0720 + 1.7, z * 0.0720 - 5.9, 3) - 0.5) * 0.4;

  // 4) 通往雪山的一条谷地：花道顺着谷底走，两边是抬起来的丘。
  //    谷底一路压低，远山在这条走廊上让开一个口子 ——
  //    站在出生点朝北看，视线是顺着这条路一直通到山脚的。
  const vx = x - Math.sin(z * 0.0018) * 120;
  const vw = 120 + Math.max(0, z) * 0.075;
  const valley = Math.exp(-Math.pow(vx / vw, 2)) * smoothstep(-40, 200, z);

  h -= valley * 12;

  // 5) 出生点附近轻轻抬起，站上去能看见更远
  h += 2.4 * Math.exp(-(x * x + z * z) / 9000);

  const r = Math.hypot(x, z);

  // 6) 中远处的脊状丘陵：草原不是一张饼，走几百米就有一道坡要爬
  const mid = smoothstep(120, 640, r);
  if (mid > 0) {
    const ridge = ridged(x * 0.0019 + 13, z * 0.0019 - 7, 4);
    h += mid * (ridge - 0.44) * 44.0 * (1 - valley * 0.55);
  }

  // 7) 外圈远山：地平线上一圈抬起来的山脊，草原才有盆地的味道
  const far = smoothstep(WORLD.hillStart, WORLD.hillFull, r);
  if (far > 0) {
    const ridge = ridged(x * 0.0015 + 31, z * 0.0015 - 11, 5);
    h += far * (8.0 + ridge * 96.0) * (1 - valley * 0.82);
  }
  return h;
}

FARM.y = baseHeight(FARM.x, FARM.z);

export function heightAt(x, z) {
  let h = baseHeight(x, z);
  const d = Math.hypot(x - FARM.x, z - FARM.z);
  if (d < FARM.blend) {
    const w = smoothstep(FARM.blend, FARM.radius, d);
    h = lerp(h, FARM.y, w);
  }
  return h;
}

export function slopeAt(x, z) {
  const e = 0.65;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

/* 点到折线的距离（草和花要绕开土路） */
function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const bx = pts[i + 1][0];
    const bz = pts[i + 1][1];
    const abx = bx - ax;
    const abz = bz - az;
    const apx = x - ax;
    const apz = z - az;
    const len2 = abx * abx + abz * abz;
    let t = len2 > 1e-6 ? (apx * abx + apz * abz) / len2 : 0;
    t = clamp(t, 0, 1);
    const dx = x - (ax + abx * t);
    const dz = z - (az + abz * t);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

export function pathDistance(x, z) {
  return Math.min(
    distToPolyline(x, z, PATH_POINTS),
    distToPolyline(x, z, INNER_PATH_POINTS)
  );
}

/* 农场谷仓和菜畦的位置（世界坐标，供草层避让） */
export const BARN = {
  cx: FARM.x - 5.2,
  cz: FARM.z - 3.6,
  w: 6.4,
  d: 4.6,
};

export function insideFarmWork(x, z, pad = 0.8) {
  // 谷仓
  if (
    Math.abs(x - BARN.cx) < BARN.w * 0.5 + pad &&
    Math.abs(z - BARN.cz) < BARN.d * 0.5 + pad
  ) return true;
  // 三条菜畦
  for (const dz of [-3.2, 0.9, 5.0]) {
    if (
      Math.abs(x - (FARM.x + 4.0)) < 2.4 + pad &&
      Math.abs(z - (FARM.z + dz)) < 1.1 + pad
    ) return true;
  }
  return false;
}

/* 羊群和牛群常待的地方，草被啃得短一些，身体和腿才看得见 */
export const GRAZE_ZONES = [
  { x: -6, z: -5, r: 11, core: 5 },
  { x: 7, z: -7, r: 9, core: 4.5 },
];

export function grazeFactor(x, z) {
  let f = 1;
  for (const g of GRAZE_ZONES) {
    const d = Math.hypot(x - g.x, z - g.z);
    const w = smoothstep(g.r, g.core, d);
    f = Math.min(f, lerp(0.48, 1, w));
  }
  return f;
}

/* 农场院子里的草是修过的，不会把菜畦埋掉 */
export function farmMowFactor(x, z) {
  const dx = Math.abs(x - FARM.x);
  const dz = Math.abs(z - FARM.z);
  const inside =
    smoothstep(FARM.halfX + 1.2, FARM.halfX - 1.6, dx) *
    smoothstep(FARM.halfZ + 1.2, FARM.halfZ - 1.6, dz);
  return lerp(1, 0.46, inside);
}

/* 花海加成：在花海附近，花会成片 */
export function meadowBoost(x, z) {
  let k = 0;
  for (const m of MEADOWS) {
    const d = Math.hypot(x - m.x, z - m.z);
    const w = smoothstep(m.r, m.r * 0.25, d);
    k = Math.max(k, w * m.k);
  }
  return k;
}

/* 花海的边界：圆边用两层噪声打碎，避免看出一个圆盘 */
export function flowerSeaFactor(x, z) {
  const dx = x - FLOWER_SEA.x;
  const dz = z - FLOWER_SEA.z;
  const d = Math.hypot(dx, dz);
  if (d > FLOWER_SEA.r * 1.38) return 0;
  const edge =
    (valueNoise(x * 0.032 + 17.3, z * 0.032 - 6.1) - 0.5) * 11.0 +
    (valueNoise(x * 0.093 - 4.7, z * 0.093 + 9.2) - 0.5) * 4.2;
  const rr = FLOWER_SEA.r + edge;
  return smoothstep(rr, rr * 0.56, d);
}

