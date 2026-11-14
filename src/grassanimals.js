/* =========================================================
   grassanimals.js — 草原上的 Q 版小羊与小牛
   全部用基础几何体搭：奶白卷毛、大头、大眼高光、腮红、
   粉耳朵、金铃铛。行为只有吃草、慢走、抬头看人。
   ========================================================= */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, heightAt, mulberry32, FARM } from './grasscore.js';

/* 共享几何：整张地图的羊牛都用同一批球和圆柱 */
const SPHERE = new THREE.SphereGeometry(1, 22, 16);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const TORUS_S = new THREE.TorusGeometry(1, 0.12, 8, 26);
const TORUS_L = new THREE.TorusGeometry(1, 0.1, 8, 30);

function makeWoolTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(20261114);
  ctx.fillStyle = '#f7efdf';
  ctx.fillRect(0, 0, S, S);

  // 一小团一小团的卷毛
  for (let i = 0; i < 190; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 5 + rnd() * 11;
    ctx.strokeStyle = rnd() < 0.55 ? 'rgba(214,196,166,0.55)' : 'rgba(255,255,250,0.8)';
    ctx.lineWidth = 2 + rnd() * 2;
    ctx.beginPath();
    for (let a = 0; a < 5.2; a += 0.35) {
      const rr = r * (0.45 + a / 9);
      const px = x + Math.cos(a + i) * rr;
      const py = y + Math.sin(a + i) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // 细软的毛
  for (let i = 0; i < 500; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    ctx.strokeStyle = rnd() < 0.5 ? 'rgba(232,220,198,0.45)' : 'rgba(255,255,248,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 3, y + 4, x + 1, y + 8);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 2.2);
  tex.anisotropy = 8;
  return tex;
}

function makePlushTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(7021);
  ctx.fillStyle = '#f4f4f4';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const g = 200 + Math.floor(rnd() * 55);
    ctx.fillStyle = `rgba(${g},${g},${g},0.4)`;
    ctx.fillRect(x, y, 0.7, 1.6 + rnd() * 2.4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function makeBlushTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,142,156,0.62)');
  g.addColorStop(0.55, 'rgba(255,150,162,0.34)');
  g.addColorStop(1, 'rgba(255,160,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeShadowTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(28,24,16,0.52)');
  g.addColorStop(0.55, 'rgba(28,24,16,0.20)');
  g.addColorStop(1, 'rgba(28,24,16,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let MATS = null;

function ensureMaterials() {
  if (MATS) return MATS;
  const woolTex = makeWoolTexture();
  const plushTex = makePlushTexture();
  const blushTex = makeBlushTexture();
  const shadowTex = makeShadowTexture();

  MATS = {
    wool: new THREE.MeshStandardMaterial({ map: woolTex, color: 0xfffaf0, roughness: 1.0, metalness: 0 }),
    sheepFace: new THREE.MeshStandardMaterial({ map: plushTex, color: 0xfbf2e2, roughness: 0.98 }),
    sheepMuzzle: new THREE.MeshStandardMaterial({ map: plushTex, color: 0xfff8ec, roughness: 0.98 }),
    pink: new THREE.MeshStandardMaterial({ map: plushTex, color: 0xf0b0b4, roughness: 0.95 }),
    pinkInner: new THREE.MeshStandardMaterial({ color: 0xe4949b, roughness: 0.95 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x171311, roughness: 0.16, metalness: 0.0 }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    blush: new THREE.MeshBasicMaterial({ map: blushTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    nose: new THREE.MeshStandardMaterial({ color: 0xdb929a, roughness: 0.7 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x6b4a3c, roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe8b94f, metalness: 0.78, roughness: 0.28, emissive: 0x2a1c00 }),
    hoof: new THREE.MeshStandardMaterial({ color: 0xd8a5a6, roughness: 0.9 }),
    contact: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 }),

    cowBrown: new THREE.MeshStandardMaterial({ map: plushTex, color: 0xb47c55, roughness: 0.98 }),
    cowBrownDark: new THREE.MeshStandardMaterial({ map: plushTex, color: 0x9c6846, roughness: 0.98 }),
    cowCream: new THREE.MeshStandardMaterial({ map: plushTex, color: 0xf3e3c8, roughness: 0.98 }),
    cowMuzzle: new THREE.MeshStandardMaterial({ map: plushTex, color: 0xf7ead3, roughness: 0.98 }),
    horn: new THREE.MeshStandardMaterial({ color: 0xe6d4ab, roughness: 0.8 }),
    hornDark: new THREE.MeshStandardMaterial({ color: 0xb99f74, roughness: 0.85 }),
    darkHoof: new THREE.MeshStandardMaterial({ color: 0x5c4030, roughness: 0.9 }),
    cowNose: new THREE.MeshStandardMaterial({ color: 0xc98d84, roughness: 0.7 }),
  };

  MATS.wool.bumpMap = woolTex;
  MATS.wool.bumpScale = 0.012;
  for (const key of ['sheepFace', 'sheepMuzzle', 'pink', 'cowBrown', 'cowBrownDark', 'cowCream', 'cowMuzzle']) {
    MATS[key].bumpMap = plushTex;
    MATS[key].bumpScale = 0.006;
  }

  return MATS;
}

/* ---------------- 小工具 ---------------- */

function ball(parent, mat, r, x, y, z, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(SPHERE, mat);
  m.scale.set(r * sx, r * sy, r * sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cyl(parent, mat, r, h, x, y, z) {
  const m = new THREE.Mesh(CYL, mat);
  m.scale.set(r, h, r);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function makeBlush(parent, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.115, 0.075), MATS.blush);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.rotation.z = 0.08;
  parent.add(m);
  return m;
}

function makeEye(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const eye = new THREE.Mesh(SPHERE, MATS.eye);
  eye.scale.set(0.05, 0.058, 0.042);
  g.add(eye);
  const hi = new THREE.Mesh(SPHERE, MATS.shine);
  hi.scale.set(0.0135, 0.0155, 0.01);
  hi.position.set(-0.014, 0.018, -0.033);
  g.add(hi);
  const hi2 = new THREE.Mesh(SPHERE, MATS.shine);
  hi2.scale.set(0.006, 0.007, 0.005);
  hi2.position.set(0.013, -0.013, -0.036);
  g.add(hi2);
  return g;
}

function makeMouth(parent, x, y, z) {
  const mat = MATS.mouth;
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.0038, 5, 12, Math.PI), mat);
    m.position.set(x + s * 0.017, y, z);
    m.rotation.z = Math.PI;
    m.rotation.y = 0.12 * s;
    parent.add(m);
  }
}

function makeBell(parent, x, y, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const ring = new THREE.Mesh(TORUS_S, MATS.gold);
  ring.scale.setScalar(0.032 * scale);
  ring.position.y = 0.055 * scale;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const body = new THREE.Mesh(SPHERE, MATS.gold);
  body.scale.set(0.052 * scale, 0.06 * scale, 0.046 * scale);
  body.castShadow = true;
  g.add(body);
  const slit = new THREE.Mesh(CYL, MATS.mouth);
  slit.scale.set(0.006 * scale, 0.032 * scale, 0.006 * scale);
  slit.position.set(0, -0.045 * scale, 0.035 * scale);
  g.add(slit);
  return g;
}

function makeContactShadow(r) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 1.35), MATS.contact);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.018;
  m.renderOrder = 2;
  return m;
}

/* 同一材质的静态毛球合成一个网格，省掉几十个绘制调用 */
function mergeDirectMeshes(group, mat) {
  const list = [];
  for (const c of group.children) {
    if (c.isMesh && c.material === mat) list.push(c);
  }
  if (list.length < 2) return;
  const geos = [];
  for (const o of list) {
    o.updateMatrix();
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrix);
    geos.push(g);
  }
  const merged = mergeGeometries(geos, false);
  if (!merged) return;
  for (const o of list) group.remove(o);
  for (const g of geos) g.dispose();
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/* ---------------- 小羊 ---------------- */

function createSheepModel() {
  const M = MATS;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // 身体：一团云
  ball(body, M.wool, 0.40, 0, 0.52, 0.02, 1.0, 0.88, 1.22);
  ball(body, M.wool, 0.18, 0, 0.73, -0.08);
  ball(body, M.wool, 0.17, -0.30, 0.61, -0.06);
  ball(body, M.wool, 0.17, 0.30, 0.61, -0.06);
  ball(body, M.wool, 0.17, -0.27, 0.52, 0.30);
  ball(body, M.wool, 0.17, 0.27, 0.52, 0.30);
  ball(body, M.wool, 0.18, 0, 0.71, 0.30);
  ball(body, M.wool, 0.19, 0, 0.46, -0.29);
  ball(body, M.wool, 0.19, 0, 0.50, 0.45);

  // 尾巴
  const tail = new THREE.Group();
  tail.position.set(0, 0.57, 0.44);
  body.add(tail);
  ball(tail, M.wool, 0.105, 0, 0.01, 0.12);
  ball(tail, M.wool, 0.07, 0.02, 0.07, 0.18);

  // 四条短腿，带一个膝关节
  const legs = [];
  for (const side of [-1, 1]) {
    for (const fz of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.18, 0.33, fz * 0.23);
      body.add(hip);
      cyl(hip, M.wool, 0.052, 0.15, 0, -0.075, 0);

      const knee = new THREE.Group();
      knee.position.set(0, -0.15, 0);
      hip.add(knee);
      cyl(knee, M.wool, 0.046, 0.135, 0, -0.0675, 0);

      const hoof = new THREE.Mesh(SPHERE, M.hoof);
      hoof.scale.set(0.062, 0.036, 0.068);
      hoof.position.set(0, -0.135, 0.008);
      hoof.castShadow = true;
      knee.add(hoof);

      legs.push({ hip, knee });
    }
  }

  // 项圈
  const collar = new THREE.Mesh(TORUS_L, M.pink);
  collar.scale.setScalar(0.175);
  collar.position.set(0, 0.69, -0.38);
  collar.rotation.x = Math.PI / 2;
  collar.rotation.z = 0.12;
  collar.castShadow = true;
  body.add(collar);
  const bell = makeBell(body, 0, 0.6, -0.5, 1.0);

  // 头：脖子上的一个枢轴，低头吃草靠它
  const head = new THREE.Group();
  head.position.set(0, 0.66, -0.22);
  body.add(head);

  // 蓬松的羊毛帽
  ball(head, M.wool, 0.30, 0, 0.24, 0.01, 1.0, 0.96, 0.94);
  ball(head, M.wool, 0.14, 0.17, 0.38, 0.02);
  ball(head, M.wool, 0.14, -0.17, 0.38, 0.02);
  ball(head, M.wool, 0.15, 0, 0.44, -0.01);
  ball(head, M.wool, 0.13, 0.24, 0.24, 0.04);
  ball(head, M.wool, 0.13, -0.24, 0.24, 0.04);
  ball(head, M.wool, 0.15, 0, 0.29, 0.17);
  ball(head, M.wool, 0.13, 0.14, 0.11, 0.20);
  ball(head, M.wool, 0.13, -0.14, 0.11, 0.20);

  // 脸
  ball(head, M.sheepFace, 0.25, 0, 0.18, -0.24, 1.0, 0.9, 0.68);
  ball(head, M.sheepMuzzle, 0.12, 0, 0.105, -0.362, 1.0, 0.66, 0.62);

  const eyes = [];
  for (const s of [-1, 1]) {
    eyes.push(makeEye(head, s * 0.098, 0.205, -0.398));
    makeBlush(head, s * 0.175, 0.135, -0.374, Math.PI + s * 0.62);
  }

  // 粉鼻子 + 小嘴
  ball(head, M.nose, 0.036, 0, 0.132, -0.432, 1.0, 0.72, 0.6);
  const noseHi = new THREE.Mesh(SPHERE, M.shine);
  noseHi.scale.set(0.009, 0.0065, 0.005);
  noseHi.position.set(-0.012, 0.145, -0.444);
  head.add(noseHi);
  makeMouth(head, 0, 0.088, -0.438);

  // 粉耳朵
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.255, 0.245, -0.045);
    ear.rotation.z = -s * 0.32;
    ear.rotation.y = s * 0.28;
    head.add(ear);
    ball(ear, M.pink, 0.118, s * 0.055, -0.015, 0, 1.0, 0.55, 0.34);
    ball(ear, M.pinkInner, 0.078, s * 0.065, -0.012, -0.026, 1.0, 0.48, 0.16);
    ears.push(ear);
  }

  // 一点点更细的卷毛，让轮廓不是完美圆
  ball(head, M.wool, 0.10, 0.20, 0.15, 0.10);
  ball(head, M.wool, 0.10, -0.20, 0.15, 0.10);

  mergeDirectMeshes(body, M.wool);
  mergeDirectMeshes(head, M.wool);
  mergeDirectMeshes(tail, M.wool);

  const shadow = makeContactShadow(0.62);
  root.add(shadow);

  return { root, body, head, legs, ears, eyes, tail, collar, bell, shadow, scale: 0.9 };
}

/* ---------------- 小牛 ---------------- */

function createCowModel() {
  const M = MATS;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // 棕色身体
  ball(body, M.cowBrown, 0.50, 0, 0.63, 0.02, 1.0, 0.82, 1.16);
  // 奶油色肚子，从下面露出来
  ball(body, M.cowCream, 0.38, 0, 0.53, 0.0, 1.0, 0.62, 1.12);

  // 四条腿，带膝关节
  const legs = [];
  for (const side of [-1, 1]) {
    for (const fz of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.24, 0.40, fz * 0.27);
      body.add(hip);
      cyl(hip, M.cowBrown, 0.068, 0.19, 0, -0.095, 0);

      const knee = new THREE.Group();
      knee.position.set(0, -0.19, 0);
      hip.add(knee);
      cyl(knee, M.cowBrown, 0.06, 0.16, 0, -0.08, 0);

      const hoof = new THREE.Mesh(SPHERE, M.darkHoof);
      hoof.scale.set(0.075, 0.045, 0.082);
      hoof.position.set(0, -0.16, 0.01);
      hoof.castShadow = true;
      knee.add(hoof);

      legs.push({ hip, knee });
    }
  }

  // 尾巴
  const tail = new THREE.Group();
  tail.position.set(0, 0.76, 0.55);
  body.add(tail);
  cyl(tail, M.cowBrown, 0.019, 0.42, 0, -0.21, 0.02);
  const tuft = new THREE.Mesh(SPHERE, M.cowBrownDark);
  tuft.scale.set(0.045, 0.075, 0.045);
  tuft.position.set(0, -0.43, 0.02);
  tuft.castShadow = true;
  tail.add(tuft);

  // 项圈 + 铃铛
  const collar = new THREE.Mesh(TORUS_L, M.pink);
  collar.scale.setScalar(0.205);
  collar.position.set(0, 0.95, -0.36);
  collar.rotation.x = Math.PI / 2;
  collar.rotation.z = 0.1;
  collar.castShadow = true;
  body.add(collar);
  const bell = makeBell(body, 0, 0.85, -0.53, 1.12);

  // 头
  const head = new THREE.Group();
  head.position.set(0, 0.88, -0.26);
  body.add(head);

  ball(head, M.cowBrown, 0.30, 0, 0.17, -0.04, 1.0, 0.94, 0.88);
  // 白色额纹：从额头一路铺到鼻梁，和白色口鼻连成一片
  ball(head, M.cowCream, 0.135, 0, 0.16, -0.265, 1.0, 2.07, 0.78);
  // 白色口鼻
  ball(head, M.cowMuzzle, 0.19, 0, 0.055, -0.27, 1.0, 0.58, 0.64);
  ball(head, M.cowCream, 0.10, 0, -0.02, -0.30, 1.0, 0.52, 0.62);
  ball(head, M.cowNose, 0.055, 0, 0.075, -0.405, 1.15, 0.72, 0.55);
  const noseHi = new THREE.Mesh(SPHERE, M.shine);
  noseHi.scale.set(0.013, 0.009, 0.006);
  noseHi.position.set(-0.014, 0.09, -0.423);
  head.add(noseHi);
  makeMouth(head, 0, 0.022, -0.404);

  const eyes = [];
  for (const s of [-1, 1]) {
    eyes.push(makeEye(head, s * 0.155, 0.22, -0.268));
    makeBlush(head, s * 0.225, 0.135, -0.232, Math.PI + s * 0.7);
  }

  // 耳朵：棕色外耳 + 粉内耳，耷拉着
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.315, 0.245, -0.02);
    ear.rotation.z = -s * 0.42;
    ear.rotation.y = s * 0.22;
    head.add(ear);
    ball(ear, M.cowBrown, 0.125, s * 0.07, -0.02, 0, 1.0, 0.6, 0.38);
    ball(ear, M.pinkInner, 0.082, s * 0.075, -0.018, -0.028, 1.0, 0.5, 0.16);
    ears.push(ear);
  }

  // 小角
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.21, 8), M.horn);
    horn.position.set(s * 0.165, 0.425, -0.03);
    horn.rotation.z = -s * 0.24;
    horn.rotation.x = -0.08;
    horn.castShadow = true;
    head.add(horn);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.014, 6, 12), M.hornDark);
    ring.position.set(s * 0.175, 0.36, -0.03);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = -s * 0.24;
    head.add(ring);
  }

  // 头顶一撮奶油色毛
  ball(head, M.cowCream, 0.085, 0, 0.40, -0.10, 1.2, 0.55, 0.9);
  ball(head, M.cowCream, 0.065, 0.07, 0.405, -0.12, 1.1, 0.5, 0.8);
  ball(head, M.cowCream, 0.065, -0.07, 0.405, -0.12, 1.1, 0.5, 0.8);

  const shadow = makeContactShadow(0.78);
  root.add(shadow);

  return { root, body, head, legs, ears, eyes, tail, collar, bell, shadow, scale: 0.98 };
}

/* ---------------- 走路 / 吃草 / 看人 ---------------- */

function makeAnimal(scene, kind, opts = {}) {
  ensureMaterials();
  const model = kind === 'sheep' ? createSheepModel() : createCowModel();
  const root = model.root;
  const scale = opts.scale || model.scale;
  root.scale.setScalar(scale);
  scene.add(root);

  const rand = mulberry32((opts.seed || 1) * 7919 + (kind === 'sheep' ? 11 : 97));
  const a = {
    kind,
    root,
    model,
    x: opts.x || 0,
    z: opts.z || 0,
    homeX: opts.x || 0,
    homeZ: opts.z || 0,
    yaw: rand() * TAU,
    speed: opts.speed || (kind === 'sheep' ? 0.34 : 0.28),
    state: 'graze',
    timer: 2 + rand() * 4,
    walkPhase: rand() * TAU,
    moveAmt: 0,
    targetX: 0,
    targetZ: 0,
    headPitch: -0.5,
    blinkTimer: 2 + rand() * 4,
    lookCooldown: 2 + rand() * 3,
    bleatCooldown: 5 + rand() * 8,
    callTimer: 5 + rand() * 10,
    hopT: 0,
    hopCooldown: 3 + rand() * 5,
    lastStep: -1,
    seed: rand() * 10,
    scale,
    radius: (kind === 'sheep' ? 0.52 : 0.70) * scale,
    onSound: opts.onSound || null,
    onStep: opts.onStep || null,
  };
  a.targetX = a.x;
  a.targetZ = a.z;

  pickTarget(a, rand);
  root.position.set(a.x, heightAt(a.x, a.z), a.z);
  root.rotation.y = a.yaw;
  return a;
}

function pickTarget(a, rand) {
  for (let i = 0; i < 10; i++) {
    const ang = rand() * TAU;
    const r = 2.2 + rand() * 5.4;
    const tx = a.homeX + Math.cos(ang) * r;
    const tz = a.homeZ + Math.sin(ang) * r;
    const df = Math.hypot(tx - FARM.x, tz - FARM.z);
    if (df < 20 || Math.hypot(tx, tz) > 210) continue;
    a.targetX = tx;
    a.targetZ = tz;
    return;
  }
  a.targetX = a.homeX;
  a.targetZ = a.homeZ;
}

function updateAnimal(a, t, dt, player, rand, night) {
  const m = a.model;
  const dxp = player.x - a.x;
  const dzp = player.z - a.z;
  const distP = Math.hypot(dxp, dzp);
  const idleScale = 1 + night * 0.8;

  a.timer -= dt;
  a.lookCooldown -= dt;
  a.bleatCooldown -= dt;
  a.blinkTimer -= dt;
  a.callTimer -= dt;
  a.hopCooldown -= dt;

  // 偶尔自己叫一声，哪怕没人靠近；白天更勤
  if (a.callTimer <= 0) {
    a.callTimer = (7 + rand() * 12) * (1 + night * 0.7);
    if (distP < 34 && rand() < 0.86 && a.onSound) a.onSound(a.kind, a);
  }

  // 每几秒眨一次眼；夜里吃草时眼皮更沉
  if (a.blinkTimer < 0) {
    if (a.blinkTimer < -0.13) a.blinkTimer = 2.6 + rand() * 4.2;
  }
  const blink = a.blinkTimer < 0 ? 0.12 : 1;
  const sleepy = night > 0.55 && a.state === 'graze' ? 0.45 : 1;
  for (const eye of m.eyes) eye.scale.y = blink * sleepy;

  // 人靠得太近，就先抬头看一眼
  if (a.lookCooldown <= 0 && distP < 4.4 && a.state !== 'look') {
    a.state = 'look';
    a.timer = 2.4 + rand() * 2.6;
    a.lookCooldown = 5.5 + rand() * 4;
    if (a.bleatCooldown <= 0) {
      a.bleatCooldown = 9 + rand() * 9;
      if (a.onSound) a.onSound(a.kind, a);
    }
    if (a.hopCooldown <= 0 && distP < 3.4) {
      a.hopT = 0.42;
      a.hopCooldown = 5 + rand() * 6;
    }
  }

  if (a.timer <= 0) {
    if (a.state === 'look') {
      a.state = 'graze';
      a.timer = 1.6 + rand() * 3.0 * idleScale;
    } else if (a.state === 'walk') {
      a.state = 'graze';
      a.timer = 1.4 + rand() * 3.2 * idleScale;
    } else {
      if (rand() < 0.62 - night * 0.25) {
        pickTarget(a, rand);
        a.state = 'walk';
        a.timer = 6 + rand() * 5;
        if (a.scale < 0.86 && rand() < 0.3) a.hopT = 0.42;
      } else {
        a.state = 'graze';
        a.timer = 2.2 + rand() * 4.0 * idleScale;
      }
    }
  }

  let wantMove = 0;
  if (a.state === 'walk') {
    const dx = a.targetX - a.x;
    const dz = a.targetZ - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.35) {
      a.state = 'graze';
      a.timer = 1.4 + rand() * 3.2;
    } else {
      wantMove = 1;
      const ux = dx / d;
      const uz = dz / d;
      const speed = a.speed * (1 - night * 0.35);
      a.x += ux * speed * dt;
      a.z += uz * speed * dt;
      const targetYaw = Math.atan2(-ux, -uz);
      let diff = ((targetYaw - a.yaw + Math.PI * 3) % TAU) - Math.PI;
      a.yaw += diff * Math.min(1, dt * 3.4);
    }
  } else if (a.state === 'look' && distP > 0.2) {
    const ux = dxp / distP;
    const uz = dzp / distP;
    const targetYaw = Math.atan2(-ux, -uz);
    let diff = ((targetYaw - a.yaw + Math.PI * 3) % TAU) - Math.PI;
    a.yaw += diff * Math.min(1, dt * 2.6);
  }

  a.moveAmt += (wantMove - a.moveAmt) * Math.min(1, dt * 6);
  a.walkPhase += dt * (3.4 + a.moveAmt * 4.6);

  const stepIdx = Math.floor(a.walkPhase / Math.PI);
  if (stepIdx !== a.lastStep) {
    a.lastStep = stepIdx;
    if (a.moveAmt > 0.3 && a.onStep) a.onStep(a);
  }

  a.hopT = Math.max(0, a.hopT - dt);
  const hop = a.hopT > 0 ? Math.sin((1 - a.hopT / 0.42) * Math.PI) * 0.115 : 0;

  // 头：吃草时低下去，还会左右扫；看人时抬起来
  const wantPitch = a.state === 'graze' ? -0.62 : a.state === 'look' ? 0.13 : -0.05;
  a.headPitch += (wantPitch - a.headPitch) * Math.min(1, dt * 2.6);
  const nibble = a.state === 'graze' ? Math.sin(t * 3.4 + a.seed) * 0.045 : 0;
  const headBob = Math.sin(a.walkPhase * 2) * 0.035 * a.moveAmt;
  m.head.rotation.x = a.headPitch + nibble + headBob;
  m.head.rotation.y = a.state === 'graze'
    ? Math.sin(t * 0.5 + a.seed) * 0.14
    : Math.sin(t * 0.35 + a.seed) * 0.03;
  m.head.rotation.z = a.state === 'look' ? Math.sin(t * 0.9 + a.seed) * 0.05 : Math.sin(t * 0.6 + a.seed) * 0.02;

  // 身体轻微起伏
  const bodyBob = Math.abs(Math.sin(a.walkPhase)) * 0.018 * a.moveAmt;
  m.body.position.y = bodyBob;
  m.body.rotation.z = Math.sin(a.walkPhase) * 0.012 * a.moveAmt;

  // 四条腿：髋关节摆动，膝关节跟着弯
  for (let i = 0; i < m.legs.length; i++) {
    const leg = m.legs[i];
    const phase = a.walkPhase + (i < 2 ? 0 : Math.PI);
    leg.hip.rotation.x = Math.sin(phase) * 0.55 * a.moveAmt;
    leg.knee.rotation.x = Math.max(0, Math.sin(phase + 0.7)) * 0.5 * a.moveAmt;
  }

  // 耳朵偶尔抖一下
  const flick = Math.pow(Math.max(0, Math.sin(t * 0.9 + a.seed * 2.1)), 14) * 0.16;
  for (let i = 0; i < m.ears.length; i++) {
    const s = i === 0 ? -1 : 1;
    m.ears[i].rotation.z = -s * 0.32 + flick * s;
  }

  // 尾巴慢慢摆
  m.tail.rotation.x = Math.sin(t * 1.7 + a.seed) * 0.14;
  m.tail.rotation.z = Math.sin(t * 1.1 + a.seed * 1.7) * 0.1;

  // 铃铛跟着走路的节奏晃
  m.bell.rotation.z = Math.sin(t * 2.2 + a.seed) * 0.16 + Math.sin(a.walkPhase) * 0.12 * a.moveAmt;
  m.bell.rotation.x = Math.sin(t * 1.7 + a.seed) * 0.1;

  // 呼吸 + 落地时压一下
  const breath = 1 + Math.sin(t * 1.5 + a.seed) * 0.012;
  m.body.scale.set(1, breath * (1 - hop * 0.8), 1);

  a.x = clamp(a.x, -220, 220);
  a.z = clamp(a.z, -220, 220);
  const gy = heightAt(a.x, a.z);
  a.root.position.set(a.x, gy + 0.005 + hop, a.z);
  a.root.rotation.y = a.yaw;
  m.shadow.position.y = 0.018 - hop / Math.max(a.scale, 0.01);
}

/* ---------------- 对外 ---------------- */

export function createHerd(scene, opts = {}) {
  const rand = mulberry32(424242);
  const animals = [];

  const add = (kind, x, z, seedBase, scale) => {
    const a = makeAnimal(scene, kind, {
      x,
      z,
      seed: seedBase,
      scale,
      onSound: opts.onSound,
      onStep: opts.onStep,
    });
    animals.push(a);
    return a;
  };

  // 一小群羊贴着左侧草坡，两头牛在路右边，出生点一抬头就能看见
  add('sheep', -4.8, -3.2, 1, 0.96);
  add('sheep', -7.8, -6.6, 2, 0.9);
  add('sheep', -2.8, -8.4, 3, 0.99);
  add('sheep', -10.5, -1.8, 4, 0.88);
  add('cow', 5.2, -5.2, 5, 1.0);
  add('cow', 9.0, -8.6, 6, 0.96);

  // 两只小羊羔和一头小牛，让羊群和牛群有大小层次
  add('sheep', -3.1, -6.0, 7, 0.68);
  add('sheep', -6.9, -1.4, 8, 0.72);
  add('cow', 7.0, -7.2, 9, 0.68);

  return {
    animals,
    update(t, dt, player, night = 0) {
      for (const a of animals) updateAnimal(a, t, dt, player, rand, night);
    },
  };
}
