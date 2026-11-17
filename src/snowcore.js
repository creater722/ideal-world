/* =========================================================
   snowcore.js — 雪原地形 / 噪声 / 地理常量
   第三个世界：一片被雪盖住的谷地，中间是一面结冰的湖，
   四周是松林和雪丘，再远处是压着雪的山脊。
   所有东西（枯草、松树、羊、农场、玩家）都只认 heightAt()。
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
  radius: 720,
  terrainSize: 2400,
  hillStart: 430,
  hillFull: 1020,
};

/* 冰湖：整个世界的中心。冰面是平的，可以走上去。 */
export const ICE = {
  x: 0,
  z: 300,
  r: 118,       // 冰面半径
  level: 0,     // 冰面高度
};

/* 温泉：雪地里一汪冒热气的水，地形要先压平 */
export const SPRING = { x: -74, z: 62, r: 7.2, y: 0 };

/* 猎屋：雪里的一座屋子，压平地面 */
export const FARM = {
  x: 17,
  z: -31,
  y: 0,
  radius: 24.0,   // 雪原的地形起伏大，院子要铺得比草原更宽，房子才不陷进坡里
  blend: 38.0,
  halfX: 9.2,
  halfZ: 8.2,
  gateHalf: 1.35,
};

/* 一条从出生点绕到农场门口的踩雪小径 */
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

/* 从出生点往北通往冰湖的雪道 */
export const LAKE_PATH = [
  [0.0, 8.0],
  [-3.0, 44.0],
  [-9.0, 82.0],
  [-11.0, 120.0],
  [-8.0, 156.0],
  [-3.0, 184.0],
  [0.0, 196.0],
];

/* 兼容草原那套导入：雪原没有成片花海，但蜜蜂和蝴蝶要有落脚点 */
export const FLOWER_SEA = { x: -4, z: 44, r: 0.001 };
// 萤火虫/蜜蜂/蝴蝶的落脚点（有 8 个位置被代码直接引用，不能少）
export const MEADOWS = [
  { x: -4, z: 44, r: 12, k: 0.6 },
  { x: 24, z: -16, r: 10, k: 0.7 },
  { x: 6, z: 168, r: 14, k: 0.5 },
  { x: -38, z: 96, r: 11, k: 0.6 },
  { x: 52, z: 58, r: 10, k: 0.5 },
  { x: -30, z: -64, r: 12, k: 0.55 },
  { x: 78, z: -38, r: 10, k: 0.5 },
  { x: 16, z: 236, r: 13, k: 0.55 },
];

/* ---------------- 冰湖几何 ---------------- */

// 归一化到冰湖中心的距离：1.0 ≈ 冰缘，>1 在岸上
export function iceDist(x, z) {
  const dx = x - ICE.x;
  const dz = z - ICE.z;
  const sz = 0.94;
  const a = Math.atan2(dz / sz, dx);
  // 岸线不能是一个圆：两层角向噪声把它咬出湾和岬
  const wob =
    1 +
    (valueNoise(Math.cos(a) * 2.1 + 3.7, Math.sin(a) * 2.1 - 8.1) - 0.5) * 0.16 +
    (valueNoise(Math.cos(a) * 5.3 - 6.0, Math.sin(a) * 5.3 + 2.0) - 0.5) * 0.06;
  return Math.hypot(dx, dz / sz) / (ICE.r * wob);
}

/* 地形基础高度：
   ±30m 的雪丘 → 中坡 → 中远处脊状雪岭 → 外圈雪山；
   冰湖在中间挖一个浅碗，湖面压平到 ICE.level。 */
function baseHeight(x, z) {
  let h = (fbm(x * 0.0014 + 4.2, z * 0.0014 - 2.6, 5) - 0.5) * 58.0;
  h += (fbm(x * 0.0046 + 8.1, z * 0.0046 + 3.4, 4) - 0.5) * 12.0;
  h += (fbm(x * 0.0190 - 2.1, z * 0.0190 + 7.3, 3) - 0.5) * 1.9;
  h += (fbm(x * 0.0720 + 1.7, z * 0.0720 - 5.9, 3) - 0.5) * 0.4;

  const r = Math.hypot(x, z);

  const mid = smoothstep(150, 680, r);
  if (mid > 0) {
    const ridge = ridged(x * 0.0020 + 13, z * 0.0020 - 7, 4);
    h += mid * (ridge - 0.44) * 50.0;
  }

  // 出生点附近轻轻抬起，站上去能看见冰湖
  // 出生点是一座能俯瞰冰湖的小丘：站在这儿一眼就能看见冰面
  h += 8.5 * Math.exp(-(x * x + z * z) / 16000);

  // 湖周边先把大起伏抹平，岸线才稳定地高于冰面
  const id = iceDist(x, z);
  const lakeMask = smoothstep(2.2, 1.05, id);
  if (lakeMask > 0) {
    h = lerp(h, 2.4, lakeMask * 0.92);
    // 挖碗：冰面以内压到冰下，冰缘一圈是缓坡
    h -= smoothstep(1.28, 0.95, id) * 5.0;
    if (id < 1.0) h = Math.min(h, ICE.level - 1.5);
  }

  const far = smoothstep(WORLD.hillStart, WORLD.hillFull, r);
  if (far > 0) {
    const ridge = ridged(x * 0.0016 + 31, z * 0.0016 - 11, 5);
    h += far * (10.0 + ridge * 145.0) * (1 - lakeMask);
  }

  return h;
}

FARM.y = baseHeight(FARM.x, FARM.z);
SPRING.y = baseHeight(SPRING.x, SPRING.z);

export function heightAt(x, z) {
  let h = baseHeight(x, z);
  const d = Math.hypot(x - FARM.x, z - FARM.z);
  if (d < FARM.blend) {
    const w = smoothstep(FARM.blend, FARM.radius, d);
    h = lerp(h, FARM.y, w);
  }
  // 温泉池要坐得住：周围压成一小块平地
  const ds = Math.hypot(x - SPRING.x, z - SPRING.z);
  if (ds < 14) {
    const w = smoothstep(14, SPRING.r, ds);
    h = lerp(h, SPRING.y, w);
  }
  // 冰面上可以走：脚踩冰面，不是踩湖底
  const id = iceDist(x, z);
  if (id < 1.0) h = ICE.level;
  return h;
}

/* 地形网格用的高度：冰面以下要沉下去，冰才不是浮在地上的一张纸 */
export function terrainHeightAt(x, z) {
  const h = heightAt(x, z);
  const id = iceDist(x, z);
  if (id < 1.02) return Math.min(h, ICE.level - 1.2) - smoothstep(1.02, 0.9, id) * 0.6;
  return h;
}

export function slopeAt(x, z) {
  const e = 0.65;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}

/* 松林密度：成片长在坡上，冰面/农场/雪道上不长 */
export function pineDensity(x, z) {
  if (iceDist(x, z) < 1.08) return 0;
  const d = Math.hypot(x - FARM.x, z - FARM.z);
  if (d < 22) return 0;
  const grove = fbm(x * 0.0055 + 41, z * 0.0055 - 27, 3);
  const band = fbm(x * 0.0016 - 13, z * 0.0016 + 9, 2);
  const far = smoothstep(45, 190, Math.hypot(x, z));
  let k = clamp((grove - 0.37) * 4.4, 0, 1) * clamp((band - 0.28) * 3.4, 0, 1);
  k *= 0.45 + far * 0.55;
  if (k < 0.04) return 0;
  return k;
}

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
    distToPolyline(x, z, INNER_PATH_POINTS),
    distToPolyline(x, z, LAKE_PATH)
  );
}

export const BARN = {
  cx: FARM.x - 5.2,
  cz: FARM.z - 3.6,
  w: 6.4,
  d: 4.6,
};

export function insideFarmWork(x, z, pad = 0.8) {
  if (
    Math.abs(x - BARN.cx) < BARN.w * 0.5 + pad &&
    Math.abs(z - BARN.cz) < BARN.d * 0.5 + pad
  ) return true;
  for (const dz of [-3.2, 0.9, 5.0]) {
    if (
      Math.abs(x - (FARM.x + 4.0)) < 2.4 + pad &&
      Math.abs(z - (FARM.z + dz)) < 1.1 + pad
    ) return true;
  }
  return false;
}

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

export function farmMowFactor(x, z) {
  const dx = Math.abs(x - FARM.x);
  const dz = Math.abs(z - FARM.z);
  const inside =
    smoothstep(FARM.halfX + 1.2, FARM.halfX - 1.6, dx) *
    smoothstep(FARM.halfZ + 1.2, FARM.halfZ - 1.6, dz);
  return lerp(1, 0.46, inside);
}

export function meadowBoost() {
  return 0;
}

export function flowerSeaFactor() {
  return 0;
}
