/* =========================================================
   grassfarm.js — 草原农场
   谷仓、栅栏、菜畦、水井、草垛、木牌，以及三种能种能收的菜。
   菜的生长完全在本地推进，不需要存档。
   ========================================================= */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, FARM, BARN, clamp, lerp, mulberry32 } from './grasscore.js';

export const CROPS = [
  { key: 'carrot', name: '胡萝卜', color: '#e07a2f', grow: 38, yield: 3, hint: '橙色的，羊也喜欢' },
  { key: 'wheat', name: '小麦', color: '#d8b45c', grow: 32, yield: 2, hint: '风一吹就沙沙响' },
  { key: 'tomato', name: '番茄', color: '#d24b39', grow: 42, yield: 3, hint: '要等它慢慢红' },
];

const MATURE_AT = 0.7;

/* ---------------- 程序化贴图 ---------------- */

function makeWoodTexture(base, dark, light) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(base.length * 977 + 19);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  // 一条条竖着的木板
  for (let x = 0; x < S; x += 32) {
    ctx.fillStyle = `rgba(0,0,0,${0.10 + rnd() * 0.08})`;
    ctx.fillRect(x, 0, 2, S);
    ctx.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.05})`;
    ctx.fillRect(x + 2, 0, 1, S);
  }

  // 木纹
  for (let i = 0; i < 150; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const h = 10 + rnd() * 60;
    ctx.strokeStyle = rnd() < 0.5 ? dark : light;
    ctx.globalAlpha = 0.10 + rnd() * 0.12;
    ctx.lineWidth = 0.7 + rnd() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + 1.5, y + h * 0.35, x - 1.5, y + h * 0.7, x + 1, y + h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 几颗木节
  for (let i = 0; i < 7; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.35;
    for (let r = 2; r < 8; r += 2) {
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.6, rnd() * 0.4, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function makeSoilTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(7719);
  ctx.fillStyle = '#6b4c36';
  ctx.fillRect(0, 0, S, S);

  // 垄沟
  for (let y = 30; y < S; y += 58) {
    ctx.fillStyle = 'rgba(38,24,16,0.22)';
    ctx.fillRect(0, y, S, 4);
    ctx.fillStyle = 'rgba(174,134,94,0.12)';
    ctx.fillRect(0, y - 2, S, 2);
  }

  // 土块
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 0.6 + rnd() * 2.4;
    const l = rnd();
    ctx.fillStyle = l > 0.55
      ? `rgba(118,86,60,${0.12 + rnd() * 0.25})`
      : `rgba(45,29,20,${0.12 + rnd() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  // 一点点小石子
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const g = 100 + rnd() * 50;
    ctx.fillStyle = `rgba(${g},${g - 6},${g - 16},0.45)`;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.2 + rnd() * 2, 1 + rnd() * 1.4, rnd() * 3, 0, TAU);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.6, 1.3);
  tex.anisotropy = 8;
  return tex;
}

function makeRoofTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(4451);
  ctx.fillStyle = '#463d35';
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 22) {
    ctx.fillStyle = `rgba(0,0,0,${0.16 + rnd() * 0.08})`;
    ctx.fillRect(0, y, S, 3);
    for (let x = ((y / 22) % 2) * 16; x < S; x += 32) {
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(x, y + 3, 1, 19);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, y + 3, S, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function makeHayTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(1923);
  ctx.fillStyle = '#c6a45a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 6 + rnd() * 22;
    ctx.strokeStyle = rnd() < 0.5
      ? `rgba(232,206,138,${0.25 + rnd() * 0.4})`
      : `rgba(138,105,45,${0.18 + rnd() * 0.3})`;
    ctx.lineWidth = 0.7 + rnd() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rnd() - 0.5) * 6);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  return tex;
}

function makeStoneTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(881);
  ctx.fillStyle = '#8b877c';
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 26) {
    for (let x = ((y / 26) % 2) * 22; x < S; x += 44) {
      const l = 0.82 + rnd() * 0.3;
      ctx.fillStyle = `rgb(${Math.round(138 * l)},${Math.round(133 * l)},${Math.round(121 * l)})`;
      ctx.fillRect(x + 1.5, y + 1.5, 41, 23);
      ctx.strokeStyle = 'rgba(58,54,48,0.6)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1.5, y + 1.5, 41, 23);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function makeSignTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#efe2c4';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#8a6844';
  ctx.lineWidth = 12;
  ctx.strokeRect(9, 9, 494, 238);
  ctx.strokeStyle = 'rgba(120,90,56,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, 464, 208);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b4028';
  ctx.font = '600 74px "Songti SC","STSong","Noto Serif SC",serif';
  ctx.fillText('草原农场', 256, 118);
  ctx.font = '400 30px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#7c5d3c';
  ctx.fillText('胡萝卜 · 小麦 · 番茄', 256, 178);
  ctx.font = '400 22px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#9a7a52';
  ctx.fillText('E  播种 · 浇水 · 收获', 256, 216);

  // 小叶子
  ctx.fillStyle = '#6e8a45';
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(64, 72);
    ctx.scale(s, 1);
    ctx.rotate(0.6);
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 22, 0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------------- 作物贴图与几何 ---------------- */

function makeLeafTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const grad = ctx.createLinearGradient(64, 118, 64, 10);
  grad.addColorStop(0, '#3f6a2c');
  grad.addColorStop(0.55, '#5e8f3d');
  grad.addColorStop(1, '#82ad51');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(64, 122);
  ctx.bezierCurveTo(8, 86, 16, 30, 64, 8);
  ctx.bezierCurveTo(112, 30, 120, 86, 64, 122);
  ctx.closePath();
  ctx.fill();

  // 叶脉
  ctx.strokeStyle = 'rgba(226,240,198,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(64, 118);
  ctx.quadraticCurveTo(62, 68, 64, 14);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  for (let i = 1; i < 5; i++) {
    const y = 24 + i * 18;
    ctx.beginPath();
    ctx.moveTo(64, y);
    ctx.quadraticCurveTo(44, y + 6, 30, y + 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(64, y);
    ctx.quadraticCurveTo(84, y + 6, 98, y + 18);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

let ASSETS = null;

function ensureAssets() {
  if (ASSETS) return ASSETS;

  const leafTex = makeLeafTexture();
  const leafGeo = new THREE.PlaneGeometry(0.19, 0.36);
  leafGeo.translate(0, 0.18, 0);

  const bladeGeo = (() => {
    const positions = [];
    const uvs = [];
    const indices = [];
    const SEG = 4;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const w = (0.024 * (1 - t) + 0.003) * 0.5;
      const z = Math.sin(t * 1.2) * 0.05;
      positions.push(-w, t, z, w, t, z);
      uvs.push(0, t, 1, t);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  })();

  const sphere = new THREE.SphereGeometry(1, 18, 12);
  const cylGeo = new THREE.CylinderGeometry(0.8, 1, 1, 6);
  const coneGeo = new THREE.ConeGeometry(1, 1, 5);
  const carrotRootGeo = new THREE.CylinderGeometry(0.095, 0.012, 0.28, 10);
  const carrotRingGeo = new THREE.TorusGeometry(1, 0.032, 6, 16);
  const stakeGeo = new THREE.CylinderGeometry(0.012, 0.016, 0.55, 5);

  const awnGeo = (() => {
    const positions = [];
    const indices = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      const dx = Math.cos(a) * 0.028;
      const dz = Math.sin(a) * 0.028;
      const base = positions.length / 3;
      positions.push(-0.004, 0, 0, 0.004, 0, 0, dx, 0.16, dz);
      indices.push(base, base + 1, base + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  })();

  ASSETS = {
    leafTex,
    leafGeo,
    bladeGeo,
    sphere,
    cylGeo,
    coneGeo,
    carrotRootGeo,
    carrotRingGeo,
    stakeGeo,
    awnGeo,
    leafMat: new THREE.MeshStandardMaterial({
      map: leafTex,
      transparent: false,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.92,
      metalness: 0,
    }),
    stemMat: new THREE.MeshStandardMaterial({ color: 0x4e7930, roughness: 0.95 }),
    carrotMat: new THREE.MeshStandardMaterial({ color: 0xe0762c, roughness: 0.78 }),
    carrotRingMat: new THREE.MeshStandardMaterial({ color: 0xc05a1d, roughness: 0.82 }),
    wheatStemMat: new THREE.MeshStandardMaterial({ color: 0xb5943f, roughness: 0.95 }),
    wheatHeadMat: new THREE.MeshStandardMaterial({ color: 0xd8ae55, roughness: 0.9, side: THREE.DoubleSide }),
    wheatHeadMat2: new THREE.MeshStandardMaterial({ color: 0xe3c272, roughness: 0.9, side: THREE.DoubleSide }),
    tomatoLeafMat: new THREE.MeshStandardMaterial({ color: 0x4f7c36, roughness: 0.95 }),
    tomatoMat: new THREE.MeshStandardMaterial({ color: 0xd24836, roughness: 0.4 }),
    tomatoOrangeMat: new THREE.MeshStandardMaterial({ color: 0xe07a3a, roughness: 0.42 }),
    tomatoGreenMat: new THREE.MeshStandardMaterial({ color: 0x8aa84f, roughness: 0.6 }),
    tomatoCalyxMat: new THREE.MeshStandardMaterial({ color: 0x517d38, roughness: 0.95 }),
    tomatoFlowerMat: new THREE.MeshStandardMaterial({ color: 0xf2d35a, roughness: 0.8 }),
    stakeMat: new THREE.MeshStandardMaterial({ color: 0xb08b5a, roughness: 0.95 }),
  };
  return ASSETS;
}

/* ---------------- 单株作物 ---------------- */

/* 把一株作物里同材质的零件合并成一个网格，绘制调用能少一个数量级 */
function mergePlantMeshes(group) {
  const byMat = new Map();
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  for (const o of meshes) {
    o.updateMatrix();
    const geo = o.geometry.clone();
    if (!geo.getAttribute('uv')) {
      const count = geo.getAttribute('position').count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    geo.applyMatrix4(o.matrix);
    let list = byMat.get(o.material);
    if (!list) {
      list = [];
      byMat.set(o.material, list);
    }
    list.push(geo);
  }
  while (group.children.length) group.remove(group.children[0]);
  for (const [mat, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    group.add(mesh);
    if (geos.length > 1) for (const g of geos) g.dispose();
  }
}

function makeCropPlant(kind, stage, rand) {
  const A = ASSETS;
  const g = new THREE.Group();

  const addLeaf = (len, angle, lean, y = 0) => {
    const m = new THREE.Mesh(A.leafGeo, A.leafMat);
    m.scale.setScalar(len);
    m.position.y = y;
    m.rotation.y = angle;
    m.rotation.z = -lean;
    g.add(m);
    return m;
  };

  if (kind === 0) {
    // 胡萝卜：从两片小芽长成一丛羽毛叶，最后露出带纹路的橙色根
    const n = stage === 0 ? 3 : stage === 1 ? 6 : 9;
    const scale = stage === 0 ? 0.38 : stage === 1 ? 0.7 : 1.0;
    for (let i = 0; i < n; i++) {
      addLeaf(scale * (0.8 + rand() * 0.3), (i / n) * TAU + rand() * 0.4, 0.55 + rand() * 0.5);
    }
    if (stage >= 1) {
      const root = new THREE.Mesh(A.carrotRootGeo, A.carrotMat);
      const s = stage === 2 ? 1 : 0.55;
      root.scale.set(s, s, s);
      root.position.y = stage === 2 ? -0.02 : -0.03;
      root.rotation.y = rand() * TAU;
      root.castShadow = true;
      g.add(root);

      if (stage === 2) {
        const rings = [[0.065, 0.078], [0.005, 0.061], [-0.055, 0.044]];
        for (const [ry, rr] of rings) {
          const ring = new THREE.Mesh(A.carrotRingGeo, A.carrotRingMat);
          ring.scale.set(rr, rr, rr);
          ring.rotation.x = Math.PI / 2;
          ring.position.y = ry;
          g.add(ring);
        }
        // 根顶的一小撮绿领
        for (let i = 0; i < 3; i++) {
          const collar = new THREE.Mesh(A.leafGeo, A.leafMat);
          collar.scale.setScalar(0.32);
          collar.position.y = 0.1;
          collar.rotation.y = rand() * TAU;
          collar.rotation.z = 0.5 + rand() * 0.3;
          g.add(collar);
        }
      }
    }
  } else if (kind === 1) {
    // 小麦：细叶，成熟时变成一束金色穗
    if (stage < 2) {
      const blades = stage === 0 ? 4 : 7;
      const h = stage === 0 ? 0.15 : 0.32;
      for (let i = 0; i < blades; i++) {
        const m = new THREE.Mesh(A.bladeGeo, A.stemMat);
        m.scale.y = h * (0.8 + rand() * 0.35);
        m.rotation.y = rand() * TAU;
        m.rotation.z = (rand() - 0.5) * 0.5;
        m.position.set((rand() - 0.5) * 0.09, 0, (rand() - 0.5) * 0.09);
        g.add(m);
      }
    } else {
      const blades = 9;
      for (let i = 0; i < blades; i++) {
        const h = 0.48 + rand() * 0.22;
        const bx = (rand() - 0.5) * 0.17;
        const bz = (rand() - 0.5) * 0.17;
        const blade = new THREE.Mesh(A.bladeGeo, A.wheatStemMat);
        blade.scale.set(1.15, h, 1.0);
        blade.rotation.y = rand() * TAU;
        blade.rotation.z = (rand() - 0.5) * 0.38;
        blade.position.set(bx, 0, bz);
        g.add(blade);

        const headMat = rand() < 0.5 ? A.wheatHeadMat : A.wheatHeadMat2;
        const head = new THREE.Mesh(A.sphere, headMat);
        head.scale.set(0.028, 0.08, 0.028);
        const lean = (rand() - 0.5) * 0.4;
        head.position.set(bx + Math.sin(lean) * h * 0.3, h * 0.97, bz + Math.cos(lean) * h * 0.05);
        head.rotation.z = lean;
        g.add(head);

        const awn = new THREE.Mesh(A.awnGeo, headMat);
        awn.position.copy(head.position);
        awn.position.y += 0.055;
        awn.rotation.y = rand() * TAU;
        awn.rotation.z = lean * 0.5;
        g.add(awn);
      }
    }
  } else {
    // 番茄：小苗、绿丛、红果
    const stemH = stage === 0 ? 0.14 : stage === 1 ? 0.22 : 0.28;
    const stem = new THREE.Mesh(A.cylGeo, A.stemMat);
    stem.scale.set(0.014, stemH, 0.014);
    stem.position.y = stemH * 0.5;
    g.add(stem);

    const leaves = stage === 0 ? 2 : stage === 1 ? 5 : 7;
    for (let i = 0; i < leaves; i++) {
      addLeaf(
        (stage === 2 ? 0.42 : 0.55) + rand() * (stage === 2 ? 0.24 : 0.3),
        (i / leaves) * TAU + rand() * 0.5,
        0.65 + rand() * 0.35,
        stemH * 0.55
      );
    }

    if (stage >= 1) {
      const stake = new THREE.Mesh(A.stakeGeo, A.stakeMat);
      stake.position.set(0.15, 0.275, 0.11);
      stake.rotation.z = -0.05;
      g.add(stake);
    }

    if (stage >= 1) {
      for (let i = 0; i < 3; i++) {
        const bush = new THREE.Mesh(A.sphere, A.tomatoLeafMat);
        const s = 0.07 + rand() * 0.035;
        bush.scale.set(s, s * 0.85, s);
        bush.position.set((rand() - 0.5) * 0.16, 0.12 + rand() * 0.1, (rand() - 0.5) * 0.16);
        g.add(bush);
      }
    }

    if (stage === 2) {
      // 四颗果实，红、橙、青都有，像一株真的番茄
      const fruitMats = [A.tomatoMat, A.tomatoOrangeMat, A.tomatoMat, A.tomatoGreenMat];
      for (let i = 0; i < 4; i++) {
        const fruit = new THREE.Mesh(A.sphere, fruitMats[i]);
        const s = 0.046 + rand() * 0.018;
        fruit.scale.set(s, s * 0.92, s);
        fruit.position.set((rand() - 0.5) * 0.26, 0.09 + rand() * 0.14, (rand() - 0.5) * 0.26);
        fruit.castShadow = true;
        g.add(fruit);

        const calyx = new THREE.Mesh(A.coneGeo, A.tomatoCalyxMat);
        calyx.scale.set(0.032, 0.026, 0.032);
        calyx.position.copy(fruit.position);
        calyx.position.y += s * 0.9;
        g.add(calyx);
      }

      // 两朵小黄花
      for (let i = 0; i < 2; i++) {
        const flower = new THREE.Mesh(A.sphere, A.tomatoFlowerMat);
        flower.scale.set(0.03, 0.016, 0.03);
        flower.position.set((rand() - 0.5) * 0.24, 0.28 + rand() * 0.08, (rand() - 0.5) * 0.24);
        g.add(flower);
        const center = new THREE.Mesh(A.sphere, A.carrotMat);
        center.scale.set(0.01, 0.007, 0.01);
        center.position.copy(flower.position);
        center.position.y += 0.007;
        g.add(center);
      }
    }
  }

  mergePlantMeshes(g);
  return g;
}

/* ---------------- 农场 ---------------- */

export function createFarm(scene) {
  const A = ensureAssets();
  const woodCream = makeWoodTexture('#d6c39d', '#9f8761', '#efe2c2');
  const woodRed = makeWoodTexture('#a54a3d', '#74302a', '#c25e4a');
  const woodDark = makeWoodTexture('#8a5f3b', '#5d3d26', '#a87a4c');
  const woodFloor = makeWoodTexture('#b28c63', '#7d6444', '#cbaa80');
  const soilTex = makeSoilTexture();
  const roofTex = makeRoofTexture();
  const hayTex = makeHayTexture();
  const stoneTex = makeStoneTexture();
  const signTex = makeSignTexture();

  const M = {
    red: new THREE.MeshStandardMaterial({ map: woodRed, roughness: 0.88 }),
    cream: new THREE.MeshStandardMaterial({ map: woodCream, roughness: 0.85 }),
    dark: new THREE.MeshStandardMaterial({ map: woodDark, roughness: 0.9 }),
    floor: new THREE.MeshStandardMaterial({
      map: woodFloor,
      roughness: 0.92,
      envMapIntensity: 0.3,
      emissive: 0x3a2413,
      emissiveIntensity: 0.8,
    }),
    binLid: new THREE.MeshStandardMaterial({ color: 0x93a0a6, roughness: 0.5, metalness: 0.45, envMapIntensity: 0.7 }),
    soil: new THREE.MeshStandardMaterial({ map: soilTex, roughness: 1.0 }),
    roof: new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.92 }),
    hay: new THREE.MeshStandardMaterial({ map: hayTex, roughness: 1.0 }),
    stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 1.0 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x2c3a3c,
      roughness: 0.3,
      metalness: 0.2,
      emissive: 0xffb45a,
      emissiveIntensity: 0,
    }),
    darkWood: new THREE.MeshStandardMaterial({ color: 0x5b3c28, roughness: 0.9 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd6a844, roughness: 0.35, metalness: 0.75 }),
    sign: new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.85 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x8f7b55, roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ color: 0x2e4a4c, roughness: 0.2, metalness: 0.3 }),
  };

  const root = new THREE.Group();
  root.name = 'farm';
  scene.add(root);

  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffe0a8,
    emissive: 0xffa24a,
    emissiveIntensity: 0.25,
    roughness: 0.5,
    metalness: 0.1,
  });
  const nightLights = [];

  const box = (parent, w, h, d, mat, x, y, z, ry = 0, rz = 0, cast = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.rotation.z = rz;
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  const sphere = (parent, r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(A.sphere, mat);
    m.scale.set(r * sx, r * sy, r * sz);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  /* ---------- 谷仓 ---------- */
  const barn = new THREE.Group();
  barn.position.set(BARN.cx, FARM.y, BARN.cz);
  root.add(barn);

  box(barn, 6.75, 0.28, 4.95, M.stone, 0, 0.14, 0);

  // 谷仓不再是实心盒子：四面墙 + 门洞，里面能走进去
  box(barn, 6.2, 0.1, 4.4, M.floor, 0, 0.33, 0, 0, 0, false);   // 木地板
  box(barn, 6.2, 0.12, 4.4, M.cream, 0, 3.54, 0, 0, 0, false); // 内顶
  box(barn, 6.4, 3.6, 0.2, M.red, 0, 1.94, -2.2);              // 后墙
  box(barn, 0.2, 3.6, 4.6, M.red, -3.1, 1.94, 0);              // 左墙
  box(barn, 0.2, 3.6, 4.6, M.red, 3.1, 1.94, 0);               // 右墙
  box(barn, 2.04, 3.6, 0.2, M.red, -2.18, 1.94, 2.2);          // 前墙左
  box(barn, 2.04, 3.6, 0.2, M.red, 2.18, 1.94, 2.2);           // 前墙右
  box(barn, 2.32, 1.3, 0.2, M.red, 0, 2.95, 2.2);              // 门楣

  // 内壁浅色木板：走进来是暖木色，不是红墙
  box(barn, 5.9, 3.15, 0.05, M.cream, 0, 1.95, -2.08, 0, 0, false);
  box(barn, 0.05, 3.15, 4.2, M.cream, -2.99, 1.95, 0, 0, 0, false);
  box(barn, 0.05, 3.15, 4.2, M.cream, 2.99, 1.95, 0, 0, 0, false);
  box(barn, 2.06, 3.15, 0.05, M.cream, -2.19, 1.95, 2.08, 0, 0, false);
  box(barn, 2.06, 3.15, 0.05, M.cream, 2.19, 1.95, 2.08, 0, 0, false);

  // 山墙（前后各一片三角形）
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-3.2, 0);
  gableShape.lineTo(3.2, 0);
  gableShape.lineTo(0, 1.52);
  gableShape.closePath();
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  for (const z of [-2.31, 2.31]) {
    const m = new THREE.Mesh(gableGeo, M.red);
    m.position.set(0, 3.74, z);
    m.castShadow = true;
    m.receiveShadow = true;
    if (z < 0) m.rotation.y = Math.PI;
    barn.add(m);
  }

  // 屋顶两坡
  for (const s of [-1, 1]) {
    box(barn, 3.95, 0.16, 5.35, M.roof, s * 1.7, 4.5, 0, 0, s * -0.415);
    // 山墙封檐板
    box(barn, 3.6, 0.13, 0.14, M.cream, s * 1.63, 4.51, 2.36, 0, s * -0.415);
    box(barn, 3.6, 0.13, 0.14, M.cream, s * 1.63, 4.51, -2.36, 0, s * -0.415);
  }
  box(barn, 0.26, 0.15, 5.4, M.dark, 0, 5.28, 0);

  // 大门：一扇可以滑开的木门
  const doorPanel = new THREE.Group();
  doorPanel.position.set(0, 1.2, 2.35);
  barn.add(doorPanel);
  box(doorPanel, 2.32, 2.3, 0.14, M.dark, 0, 0, 0, 0, 0, false);
  box(doorPanel, 0.13, 3.0, 0.09, M.cream, 0, 0, 0.09, 0, 0.79);
  box(doorPanel, 0.13, 3.0, 0.09, M.cream, 0, 0, 0.09, 0, -0.79);
  box(barn, 2.5, 0.13, 0.16, M.cream, 0, 2.42, 2.4);
  box(barn, 2.5, 0.13, 0.16, M.cream, 0, 0.04, 2.4);
  box(barn, 0.13, 2.5, 0.16, M.cream, -1.2, 1.23, 2.4);
  box(barn, 0.13, 2.5, 0.16, M.cream, 1.2, 1.23, 2.4);
  box(barn, 4.9, 0.08, 0.12, M.dark, -0.6, 2.55, 2.42, 0, 0, false);

  // 干草口
  box(barn, 1.34, 1.24, 0.14, M.cream, 0, 4.12, 2.35);
  box(barn, 1.06, 0.96, 0.1, M.glass, 0, 4.12, 2.43, 0, 0, false);
  box(barn, 1.06, 0.07, 0.12, M.cream, 0, 4.12, 2.45);
  box(barn, 0.07, 0.96, 0.12, M.cream, 0, 4.12, 2.45);
  box(barn, 0.82, 0.26, 0.3, M.hay, 0, 3.74, 2.44);

  // 侧窗
  for (const s of [-1, 1]) {
    box(barn, 0.12, 1.1, 1.15, M.cream, s * 3.22, 2.35, 0.75);
    box(barn, 0.08, 0.9, 0.95, M.glass, s * 3.27, 2.35, 0.75, 0, 0, false);
    box(barn, 0.1, 0.07, 0.95, M.cream, s * 3.31, 2.35, 0.75);
    box(barn, 0.1, 0.9, 0.07, M.cream, s * 3.31, 2.35, 0.75);
  }

  // 小屋顶的风向标
  box(barn, 0.96, 0.62, 0.96, M.cream, 0, 5.7, 0);
  const cupola = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.52, 4), M.roof);
  cupola.position.set(0, 6.28, 0);
  cupola.rotation.y = Math.PI / 4;
  cupola.castShadow = true;
  barn.add(cupola);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6), M.gold);
  rod.position.set(0, 6.95, 0);
  barn.add(rod);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 4), M.gold);
  arrow.position.set(0.16, 7.12, 0);
  arrow.rotation.z = -Math.PI / 2;
  barn.add(arrow);
  sphere(barn, 0.07, M.gold, 0, 7.4, 0);

  // 屋檐下的风灯
  const barnLight = new THREE.PointLight(0xffb45a, 0, 16, 2);
  barnLight.position.set(1.9, 2.6, 3.2);
  barnLight.userData.base = 2.4;
  nightLights.push(barnLight);
  barn.add(barnLight);
  box(barn, 0.05, 0.45, 0.05, M.dark, 1.9, 3.0, 2.5);
  box(barn, 0.24, 0.3, 0.24, lanternMat, 1.9, 2.7, 2.62, 0, 0, false);
  box(barn, 0.3, 0.05, 0.3, M.dark, 1.9, 2.88, 2.62, 0, 0, false);
  box(barn, 0.3, 0.05, 0.3, M.dark, 1.9, 2.53, 2.62, 0, 0, false);

  // 门缝里透出来的一盏灯
  const doorLight = new THREE.PointLight(0xffc07a, 0, 9, 2);
  doorLight.position.set(0, 1.7, 1.95);
  doorLight.userData.base = 1.1;
  nightLights.push(doorLight);
  barn.add(doorLight);

  /* ---------- 谷仓内部：粮仓、麻袋、架子、干草 ---------- */
  const binLocalX = -1.65;
  const binLocalZ = -1.2;
  const barnFloorY = 0.38;

  box(barn, 2.0, 1.15, 1.25, M.dark, binLocalX, barnFloorY + 0.575, binLocalZ);
  box(barn, 2.14, 0.08, 1.39, M.binLid, binLocalX, 1.55, binLocalZ, 0, 0, false);
  for (const hx of [-0.6, 0.6]) {
    box(barn, 0.22, 0.03, 0.1, M.dark, binLocalX + hx, 1.6, binLocalZ - 0.64, 0, 0, false);
  }
  box(barn, 0.26, 0.04, 0.05, M.dark, binLocalX, 1.6, binLocalZ + 0.6, 0, 0, false);
  const grain = new THREE.Mesh(A.sphere, M.hay);
  grain.scale.set(0.95, 0.3, 0.52);
  grain.position.set(binLocalX, 1.51, binLocalZ);
  grain.castShadow = false;
  barn.add(grain);

  const sackMat = new THREE.MeshStandardMaterial({ color: 0xc7a979, map: hayTex, roughness: 1 });
  for (const [sx, sz, ss] of [
    [0.55, -0.15, 0.34],
    [-0.05, 0.12, 0.28],
    [0.95, -0.6, 0.24],
  ]) {
    const sack = new THREE.Mesh(A.sphere, sackMat);
    sack.scale.set(ss, ss * 0.92, ss * 0.8);
    const cy = barnFloorY + ss * 0.92 + 0.01;
    sack.position.set(binLocalX + sx, cy, binLocalZ + sz + 0.8);
    sack.castShadow = true;
    barn.add(sack);

    const neck = new THREE.Mesh(A.cylGeo, sackMat);
    neck.scale.set(ss * 0.32, ss * 0.32, ss * 0.32);
    neck.position.set(binLocalX + sx, cy + ss * 0.8, binLocalZ + sz + 0.8);
    neck.castShadow = true;
    barn.add(neck);

    const rope = new THREE.Mesh(new THREE.TorusGeometry(ss * 0.33, ss * 0.045, 6, 12), M.rope);
    rope.rotation.x = Math.PI / 2;
    rope.position.set(binLocalX + sx, cy + ss * 0.93, binLocalZ + sz + 0.8);
    barn.add(rope);
  }

  // 后墙的木架和陶罐
  box(barn, 2.4, 0.08, 0.3, M.dark, 1.55, 1.9, -2.0);
  box(barn, 0.08, 0.35, 0.28, M.dark, 0.55, 1.72, -2.0);
  box(barn, 0.08, 0.35, 0.28, M.dark, 2.55, 1.72, -2.0);
  const jarMat = new THREE.MeshStandardMaterial({ color: 0x8c9b6a, roughness: 0.45, metalness: 0.05 });
  for (const jx of [0.9, 1.45, 2.0]) {
    const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.26, 10), jarMat);
    jar.position.set(jx, 2.06, -2.0);
    jar.castShadow = true;
    barn.add(jar);
    box(barn, 0.16, 0.05, 0.16, M.dark, jx, 2.2, -2.0, 0, 0, false);
  }

  // 里面的一捆干草与吊灯
  const baleIn = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 14), M.hay);
  baleIn.position.set(2.1, barnFloorY + 0.34, -0.8);
  baleIn.rotation.z = Math.PI / 2;
  baleIn.castShadow = true;
  barn.add(baleIn);

  const interiorLight = new THREE.PointLight(0xffc07a, 0.42, 12, 2);
  interiorLight.position.set(1.4, 2.25, 0.4);
  interiorLight.userData.base = 1.3;
  interiorLight.userData.dayBase = 0.55;
  nightLights.push(interiorLight);
  barn.add(interiorLight);
  box(barn, 0.05, 0.5, 0.05, M.dark, 1.4, 3.0, 0.4);
  box(barn, 0.2, 0.26, 0.2, lanternMat, 1.4, 2.5, 0.4, 0, 0, false);
  box(barn, 0.26, 0.05, 0.26, M.dark, 1.4, 2.64, 0.4, 0, 0, false);

  /* ---------- 谷仓室内陈设 ---------- */
  const inside = new THREE.Group();
  inside.name = 'barnInside';
  barn.add(inside);

  const ironMat = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.55, metalness: 0.6 });
  const herbMat = new THREE.MeshStandardMaterial({ color: 0x77804b, roughness: 1 });
  const herbDryMat = new THREE.MeshStandardMaterial({ color: 0xa08f5f, roughness: 1 });
  const appleMat = new THREE.MeshStandardMaterial({ color: 0xc23c2e, roughness: 0.45 });
  const appleGreenMat = new THREE.MeshStandardMaterial({ color: 0x86a340, roughness: 0.5 });
  const pumpkinMat = new THREE.MeshStandardMaterial({ color: 0xd07c2c, roughness: 0.85 });
  const catMat = new THREE.MeshStandardMaterial({ color: 0xc78b53, roughness: 0.95 });
  const catCreamMat = new THREE.MeshStandardMaterial({ color: 0xe9d9bd, roughness: 0.95 });
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x5d4630, roughness: 0.9 });
  const garlicMat = new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.8 });

  // 室内补光：压住天光带来的冷蓝色，让木地板和台面暖起来
  const fillLight = new THREE.PointLight(0xffd2a0, 1.15, 10, 2);
  fillLight.position.set(0, 2.6, 0.1);
  fillLight.userData.base = 0.7;
  fillLight.userData.dayBase = 1.15;
  nightLights.push(fillLight);
  inside.add(fillLight);

  // 角柱与顶梁：进门抬头能看见木构架
  for (const sx of [-2.94, 2.94]) {
    for (const sz of [-1.94, 1.94]) {
      box(inside, 0.16, 3.12, 0.16, M.dark, sx, 1.94, sz);
    }
  }
  for (const bz of [-1.25, 1.3]) {
    box(inside, 6.06, 0.16, 0.2, M.dark, 0, 3.28, bz);
  }
  box(inside, 0.18, 0.16, 4.24, M.dark, 0, 3.42, 0);

  // 室内墙脚的深色踢脚板
  box(inside, 5.9, 0.14, 0.06, M.dark, 0, 0.45, -2.03, 0, 0, false);
  for (const s of [-1, 1]) {
    box(inside, 0.06, 0.14, 4.2, M.dark, s * 2.96, 0.45, 0, 0, 0, false);
    box(inside, 1.8, 0.14, 0.06, M.dark, s * 2.08, 0.45, 2.03, 0, 0, false);
  }

  // 后墙的小窗：四格窗棂、玻璃和窗台
  for (const s of [-1, 1]) {
    box(inside, 0.07, 0.74, 0.06, M.cream, s * 0.45, 2.35, -2.05);
  }
  box(inside, 0.97, 0.07, 0.06, M.cream, 0, 2.72, -2.05);
  box(inside, 0.97, 0.07, 0.06, M.cream, 0, 1.98, -2.05);
  box(inside, 0.86, 0.64, 0.02, M.glass, 0, 2.35, -2.045, 0, 0, false);
  box(inside, 0.035, 0.64, 0.03, M.cream, 0, 2.35, -2.04, 0, 0, false);
  box(inside, 0.86, 0.035, 0.03, M.cream, 0, 2.35, -2.04, 0, 0, false);
  box(inside, 1.06, 0.06, 0.16, M.cream, 0, 1.98, -1.99);

  // 进门的地垫：三色草编
  const rugMat = new THREE.MeshStandardMaterial({ color: 0xa8624a, roughness: 0.95 });
  for (let i = 0; i < 3; i++) {
    box(inside, 1.8, 0.02, 0.17, i % 2 ? rugMat : M.rope, 0, 0.4, 1.48 + i * 0.17, 0, 0, false);
  }

  // 门内侧的铁箍与门环
  box(doorPanel, 1.9, 0.09, 0.035, ironMat, 0, 0.62, -0.088);
  box(doorPanel, 1.9, 0.09, 0.035, ironMat, 0, -0.62, -0.088);
  box(doorPanel, 0.09, 2.1, 0.035, ironMat, 0, 0, -0.088);
  const doorRing = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 12), ironMat);
  doorRing.position.set(-0.82, 0.05, -0.11);
  doorPanel.add(doorRing);

  // 门洞上方的内墙板，别露出外墙的红色
  box(inside, 2.6, 1.23, 0.05, M.cream, 0, 2.915, 2.08, 0, 0, false);
  // 门洞侧壁与顶部的浅色包边
  for (const s of [-1, 1]) {
    box(inside, 0.06, 2.0, 0.23, M.cream, s * 1.145, 1.36, 2.165);
  }
  box(inside, 2.3, 0.06, 0.23, M.cream, 0, 2.34, 2.165);
  box(inside, 2.34, 0.08, 0.24, M.floor, 0, 0.4, 2.16);
  // 门楣内侧的横木
  box(inside, 2.7, 0.24, 0.34, M.floor, 0, 2.54, 2.17);

  // 门楣内侧的蹄铁
  const shoe = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.022, 6, 14, Math.PI * 1.4), ironMat);
  shoe.position.set(0, 2.78, 2.03);
  shoe.rotation.z = Math.PI * 0.3;
  inside.add(shoe);

  // 侧窗的室内窗框、窗台和玻璃
  for (const s of [-1, 1]) {
    const wx = s * 2.94;
    box(inside, 0.07, 1.0, 0.09, M.cream, wx, 2.35, 0.27);
    box(inside, 0.07, 1.0, 0.09, M.cream, wx, 2.35, 1.23);
    box(inside, 0.07, 0.09, 1.05, M.cream, wx, 2.84, 0.75);
    box(inside, 0.07, 0.09, 1.05, M.cream, wx, 1.86, 0.75);
    box(inside, 0.02, 0.86, 0.9, M.glass, s * 2.93, 2.35, 0.75, 0, 0, false);
    box(inside, 0.16, 0.07, 1.15, M.cream, wx - s * 0.06, 1.83, 0.75);
  }

  // 阁楼：右侧后方的干草平台、栏杆和木梯
  const loftY = 2.52;
  box(inside, 1.98, 0.1, 1.3, M.dark, 1.9, loftY, -1.5);
  box(inside, 0.14, 2.1, 0.14, M.dark, 1.02, 1.43, -0.9);
  box(inside, 0.14, 2.1, 0.14, M.dark, 2.8, 1.43, -0.9);
  box(inside, 1.98, 0.08, 0.1, M.cream, 1.9, 3.02, -0.88);
  for (const px of [0.96, 1.44, 1.92, 2.4, 2.86]) {
    box(inside, 0.06, 0.5, 0.06, M.cream, px, 2.77, -0.88);
  }
  box(inside, 0.7, 0.42, 0.5, M.hay, 2.32, 2.78, -1.72);
  box(inside, 0.62, 0.36, 0.46, M.hay, 2.3, 3.16, -1.74, 0.12);
  box(inside, 0.5, 0.4, 0.5, M.hay, 1.32, 2.77, -1.7, 0.06);

  const ladder = new THREE.Group();
  ladder.position.set(2.7, 0.38, -0.38);
  ladder.rotation.x = -0.27;
  inside.add(ladder);
  for (const sx of [-0.24, 0.24]) {
    box(ladder, 0.07, 2.2, 0.07, M.cream, sx, 1.1, 0);
  }
  for (let i = 0; i < 6; i++) {
    box(ladder, 0.55, 0.055, 0.055, M.dark, 0, 0.22 + i * 0.34, 0.02);
  }

  // 左前方的木箱、苹果和南瓜
  function makeCrate(x, y, z, s) {
    box(inside, s, s * 0.84, s * 0.94, M.dark, x, y + s * 0.42, z);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        box(inside, 0.055, s * 0.9, 0.055, M.cream, x + sx * (s * 0.5 - 0.028), y + s * 0.44, z + sz * (s * 0.47 - 0.028));
      }
    }
    box(inside, s * 1.03, 0.05, s * 0.97, M.cream, x, y + s * 0.85, z);
    box(inside, s * 0.96, 0.022, 0.014, M.darkWood, x, y + s * 0.38, z + s * 0.47, 0, 0, false);
  }
  makeCrate(-2.32, barnFloorY, 1.42, 0.72);
  const appleSpots = [
    [-2.46, 1.06, 1.32, appleMat],
    [-2.24, 1.07, 1.3, appleMat],
    [-2.42, 1.06, 1.55, appleGreenMat],
    [-2.18, 1.05, 1.52, appleMat],
    [-2.32, 1.13, 1.42, appleMat],
  ];
  for (const [ax, ay, az, am] of appleSpots) {
    sphere(inside, 0.082, am, ax, ay, az);
  }
  for (let i = 0; i < 3; i++) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.007, 0.035, 4), M.darkWood);
    stem.position.set(appleSpots[i][0], appleSpots[i][1] + 0.085, appleSpots[i][2]);
    inside.add(stem);
  }

  function makePumpkin(x, z, r) {
    const p = new THREE.Mesh(A.sphere, pumpkinMat);
    p.scale.set(r, r * 0.76, r);
    p.position.set(x, barnFloorY + r * 0.72, z);
    p.castShadow = true;
    p.receiveShadow = true;
    inside.add(p);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.07, 5), M.darkWood);
    stem.position.set(x, barnFloorY + r * 1.4, z);
    inside.add(stem);
  }
  makePumpkin(-1.76, 1.86, 0.2);
  makePumpkin(-2.44, 1.92, 0.15);

  // 右墙边的两只木桶
  function makeBarrel(x, z, r, h) {
    const profile = [];
    for (let i = 0; i <= 8; i++) {
      const tt = i / 8;
      profile.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.sin(Math.PI * tt)), tt * h));
    }
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), M.dark);
    body.position.set(x, barnFloorY, z);
    body.castShadow = true;
    body.receiveShadow = true;
    inside.add(body);
    for (const tt of [0.26, 0.74]) {
      const rr = r * (0.86 + 0.14 * Math.sin(Math.PI * tt));
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(rr + 0.006, 0.017, 6, 18), ironMat);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(x, barnFloorY + h * tt, z);
      hoop.castShadow = true;
      inside.add(hoop);
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.84, r * 0.84, 0.05, 16), M.dark);
    lid.position.set(x, barnFloorY + h + 0.012, z);
    lid.castShadow = true;
    inside.add(lid);
  }
  makeBarrel(2.62, 1.2, 0.31, 0.76);
  makeBarrel(2.55, 0.5, 0.35, 0.86);

  // 后墙下的小工作台、凳子和台面上的零碎
  box(inside, 1.5, 0.08, 0.62, M.floor, 2.05, 1.34, -1.6);
  for (const sx of [-0.66, 0.66]) {
    for (const sz of [-0.23, 0.23]) {
      box(inside, 0.08, 0.92, 0.08, M.dark, 2.05 + sx, 0.84, -1.6 + sz);
    }
  }
  box(inside, 1.4, 0.05, 0.5, M.dark, 2.05, 0.66, -1.6);
  box(inside, 0.3, 0.18, 0.22, M.cream, 1.8, 1.47, -1.62);
  box(inside, 0.34, 0.03, 0.24, M.darkWood, 1.8, 1.57, -1.62, 0, 0, false);
  box(inside, 0.42, 0.02, 0.3, M.rope, 2.36, 1.39, -1.56, 0.2, 0, false);
  const benchJar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.24, 10), jarMat);
  benchJar.position.set(2.5, 1.5, -1.68);
  benchJar.castShadow = true;
  inside.add(benchJar);

  const stoolSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.06, 12), M.floor);
  stoolSeat.position.set(1.45, 0.93, -0.9);
  stoolSeat.castShadow = true;
  stoolSeat.receiveShadow = true;
  inside.add(stoolSeat);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.4;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.53, 6), M.dark);
    leg.position.set(1.45 + Math.cos(a) * 0.13, 0.65, -0.9 + Math.sin(a) * 0.13);
    leg.rotation.z = Math.cos(a) * 0.08;
    leg.rotation.x = -Math.sin(a) * 0.08;
    leg.castShadow = true;
    inside.add(leg);
  }

  // 中央干草卷和睡在上面的小猫
  const loungeBale = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.86, 16), M.hay);
  loungeBale.position.set(0.02, 0.71, -1.72);
  loungeBale.rotation.z = Math.PI / 2;
  loungeBale.castShadow = true;
  loungeBale.receiveShadow = true;
  inside.add(loungeBale);

  const cat = new THREE.Group();
  cat.position.set(0.04, 1.055, -1.7);
  cat.rotation.y = 0.45;
  inside.add(cat);
  const catBody = new THREE.Mesh(A.sphere, catMat);
  catBody.scale.set(0.17, 0.1, 0.22);
  catBody.position.set(0, 0.09, 0);
  catBody.castShadow = true;
  cat.add(catBody);
  const catChest = new THREE.Mesh(A.sphere, catCreamMat);
  catChest.scale.set(0.09, 0.075, 0.11);
  catChest.position.set(0, 0.1, 0.12);
  cat.add(catChest);
  const catHead = new THREE.Mesh(A.sphere, catMat);
  catHead.scale.set(0.105, 0.095, 0.1);
  catHead.position.set(0, 0.17, 0.17);
  catHead.castShadow = true;
  cat.add(catHead);
  const catMuzzle = new THREE.Mesh(A.sphere, catCreamMat);
  catMuzzle.scale.set(0.055, 0.04, 0.04);
  catMuzzle.position.set(0, 0.145, 0.255);
  cat.add(catMuzzle);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.038, 0.075, 4), catMat);
    ear.position.set(s * 0.062, 0.25, 0.15);
    ear.rotation.z = -s * 0.25;
    cat.add(ear);
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.008, 0.008), M.darkWood);
    eye.position.set(s * 0.042, 0.19, 0.258);
    cat.add(eye);
  }
  const catTail = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.026, 5, 14, Math.PI * 1.35), catMat);
  catTail.rotation.x = Math.PI / 2;
  catTail.rotation.z = 0.5;
  catTail.position.set(0.02, 0.035, -0.02);
  cat.add(catTail);

  // 左墙挂着的干草叉、绳圈和草帽
  const forkX = -2.86;
  const forkZ = -0.35;
  const forkHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.2, 8), M.dark);
  forkHandle.position.set(forkX, 2.22, forkZ);
  forkHandle.castShadow = true;
  inside.add(forkHandle);
  box(inside, 0.05, 0.05, 0.3, ironMat, forkX, 1.62, forkZ);
  for (const dz of [-0.115, -0.04, 0.04, 0.115]) {
    const tine = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.006, 0.34, 5), ironMat);
    tine.position.set(forkX, 1.45, forkZ + dz);
    tine.castShadow = true;
    inside.add(tine);
  }
  box(inside, 0.07, 0.05, 0.07, ironMat, forkX - 0.02, 2.62, forkZ, 0, 0, false);
  for (const rz of [-1.28, -1.03]) {
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.032, 6, 18), M.rope);
    coil.position.set(-2.92, 2.32, rz);
    coil.rotation.y = Math.PI / 2;
    coil.castShadow = true;
    inside.add(coil);
  }

  const hat = new THREE.Group();
  hat.position.set(-2.88, 2.58, 1.5);
  hat.rotation.z = -Math.PI / 2;
  inside.add(hat);
  const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 16), M.hay);
  hatBrim.castShadow = true;
  hat.add(hatBrim);
  const hatCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.16, 14), M.hay);
  hatCrown.position.y = 0.085;
  hatCrown.castShadow = true;
  hat.add(hatCrown);
  const hatBand = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.018, 6, 14), M.rope);
  hatBand.rotation.x = Math.PI / 2;
  hatBand.position.y = 0.03;
  hat.add(hatBand);

  // 横梁下挂的香草束和大蒜辫
  const hangings = [];
  function hangBundle(x, z, dry, phase) {
    const g = new THREE.Group();
    g.position.set(x, 3.18, z);
    g.userData.phase = phase;
    inside.add(g);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.15, 4), M.rope);
    string.position.y = -0.075;
    g.add(string);
    const mat = dry ? herbDryMat : herbMat;
    for (let i = 0; i < 3; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.3, 6), mat);
      leaf.rotation.z = Math.PI;
      leaf.position.set((i - 1) * 0.055, -0.29, i % 2 ? 0.03 : -0.03);
      leaf.castShadow = true;
      g.add(leaf);
    }
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.035, 6), M.rope);
    tie.position.y = -0.145;
    g.add(tie);
    hangings.push(g);
  }
  hangBundle(-1.9, -1.25, false, 0.4);
  hangBundle(-1.48, -1.25, true, 1.7);
  hangBundle(-1.06, -1.25, false, 2.9);

  const garlicBraid = new THREE.Group();
  garlicBraid.position.set(-0.5, 3.18, -1.25);
  garlicBraid.userData.phase = 1.1;
  inside.add(garlicBraid);
  const garlicString = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), M.rope);
  garlicString.position.y = -0.08;
  garlicBraid.add(garlicString);
  for (let i = 0; i < 4; i++) {
    const bulb = new THREE.Mesh(A.sphere, garlicMat);
    bulb.scale.set(0.072 - i * 0.008, 0.078, 0.072 - i * 0.008);
    bulb.position.set((i % 2 ? 0.035 : -0.035) + i * 0.008, -0.17 - i * 0.09, 0);
    bulb.castShadow = true;
    garlicBraid.add(bulb);
  }
  const garlicWisp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), herbDryMat);
  garlicWisp.rotation.z = Math.PI;
  garlicWisp.position.y = -0.56;
  garlicBraid.add(garlicWisp);
  hangings.push(garlicBraid);

  // 门口右侧的靴子、扫帚和水桶
  for (const bx of [1.38, 1.58]) {
    const boot = new THREE.Group();
    boot.position.set(bx, barnFloorY, 1.74);
    boot.rotation.y = (bx - 1.48) * 1.1;
    inside.add(boot);
    box(boot, 0.15, 0.3, 0.15, bootMat, 0, 0.15, 0);
    box(boot, 0.15, 0.1, 0.26, bootMat, 0, 0.05, 0.075);
    box(boot, 0.15, 0.03, 0.26, M.darkWood, 0, 0.015, 0.075, 0, 0, false);
    const toe = new THREE.Mesh(A.sphere, bootMat);
    toe.scale.set(0.075, 0.055, 0.1);
    toe.position.set(0, 0.055, 0.2);
    boot.add(toe);
    box(boot, 0.16, 0.025, 0.16, M.rope, 0, 0.305, 0, 0, 0, false);
  }

  const broom = new THREE.Group();
  broom.position.set(1.92, barnFloorY, 1.8);
  broom.rotation.x = 0.14;
  broom.rotation.z = -0.08;
  inside.add(broom);
  const broomStick = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.6, 7), M.darkWood);
  broomStick.position.y = 0.8;
  broomStick.castShadow = true;
  broom.add(broomStick);
  const broomHead = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.36, 7), M.hay);
  broomHead.position.y = 0.18;
  broomHead.castShadow = true;
  broom.add(broomHead);
  const broomBand = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.017, 5, 10), M.rope);
  broomBand.rotation.x = Math.PI / 2;
  broomBand.position.y = 0.34;
  broom.add(broomBand);

  const milkBucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.26, 12), ironMat);
  milkBucket.position.set(0.72, 0.52, 0.72);
  milkBucket.castShadow = true;
  inside.add(milkBucket);
  const milkBucketHandle = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.012, 5, 12, Math.PI), ironMat);
  milkBucketHandle.position.set(0.72, 0.65, 0.72);
  milkBucketHandle.rotation.y = Math.PI / 2;
  inside.add(milkBucketHandle);

  // 地上零星散落的干草
  const strawGeo = new THREE.BoxGeometry(0.16, 0.006, 0.012);
  const strawMat = new THREE.MeshStandardMaterial({ color: 0xcbb072, roughness: 1 });
  const straw = new THREE.InstancedMesh(strawGeo, strawMat, 80);
  const strawRnd = mulberry32(3341);
  const strawM4 = new THREE.Matrix4();
  const strawQ = new THREE.Quaternion();
  const strawE = new THREE.Euler();
  const strawV = new THREE.Vector3();
  const strawS = new THREE.Vector3();
  for (let i = 0; i < 80; i++) {
    let sx;
    let sz;
    if (i % 3 === 0) {
      const a = strawRnd() * TAU;
      const rr = Math.sqrt(strawRnd()) * 0.95;
      sx = 0.02 + Math.cos(a) * rr;
      sz = -1.72 + Math.sin(a) * rr;
    } else if (i % 3 === 1) {
      sx = 1.5 + (strawRnd() - 0.5) * 1.5;
      sz = -0.8 + (strawRnd() - 0.5) * 1.4;
    } else {
      sx = -1.3 + (strawRnd() - 0.5) * 2.0;
      sz = 0.7 + (strawRnd() - 0.5) * 1.6;
    }
    strawE.set(0, strawRnd() * TAU, (strawRnd() - 0.5) * 0.12);
    strawQ.setFromEuler(strawE);
    strawS.set(0.6 + strawRnd() * 0.9, 1, 1);
    strawV.set(sx, barnFloorY + 0.008, sz);
    strawM4.compose(strawV, strawQ, strawS);
    straw.setMatrixAt(i, strawM4);
  }
  straw.castShadow = false;
  straw.receiveShadow = true;
  inside.add(straw);

  // 从右侧窗户斜进来的一束光
  const shaftMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0.045 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float fade = smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.5, 1.0, vUv.y));
        gl_FragColor = vec4(1.0, 0.87, 0.63, fade * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  function addLightShaft(from, to, rAtFrom, rAtTo) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(rAtTo, rAtFrom, len, 12, 1, true);
    const mesh = new THREE.Mesh(geo, shaftMat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    mesh.frustumCulled = false;
    inside.add(mesh);
  }
  addLightShaft(new THREE.Vector3(2.86, 2.72, 0.75), new THREE.Vector3(0.75, 0.44, 0.1), 0.36, 0.78);

  // 室内飘着的灰尘
  const moteGeo = new THREE.BufferGeometry();
  const moteArr = new Float32Array(160 * 3);
  const moteRnd = mulberry32(9021);
  for (let i = 0; i < 160; i++) {
    moteArr[i * 3] = (moteRnd() - 0.5) * 5.2;
    moteArr[i * 3 + 1] = 0.5 + moteRnd() * 2.7;
    moteArr[i * 3 + 2] = (moteRnd() - 0.5) * 3.6;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(moteArr, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xffedc6,
    size: 0.012,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  inside.add(motes);

  // 室内陈设的碰撞范围
  const crateWorld = { x: BARN.cx - 2.32, z: BARN.cz + 1.42 };
  const workbenchWorld = { x: BARN.cx + 2.05, z: BARN.cz - 1.6 };
  const barrelWorlds = [
    { x: BARN.cx + 2.62, z: BARN.cz + 1.2, r: 0.32 },
    { x: BARN.cx + 2.55, z: BARN.cz + 0.5, r: 0.36 },
  ];
  const baleWorld = { x: BARN.cx + 0.02, z: BARN.cz - 1.72, r: 0.42 };

  // 谷仓门、长凳、粮仓的世界坐标与状态
  let doorOpen = false;
  let doorAnim = 0;
  const benchSeat = { x: FARM.x - 5.4, z: FARM.z + 0.6, yaw: Math.PI };
  const doorWorld = { x: BARN.cx, z: BARN.cz + 2.3 };
  const binWorld = { x: BARN.cx + binLocalX, z: BARN.cz + binLocalZ };
  const storage = { 0: 0, 1: 0, 2: 0 };

  /* ---------- 栅栏 ---------- */
  const railMat = M.cream;
  const postH = 1.05;

  function addFenceRun(x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 2.1));
    const ry = Math.atan2(dx, dz);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x1 + dx * t;
      const z = z1 + dz * t;
      box(root, 0.16, postH, 0.16, M.dark, x, FARM.y + postH * 0.5, z, 0);
      box(root, 0.23, 0.08, 0.23, M.dark, x, FARM.y + postH + 0.02, z, 0);
    }
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const mx = x1 + dx * (t0 + t1) * 0.5;
      const mz = z1 + dz * (t0 + t1) * 0.5;
      const seg = len / n;
      box(root, 0.09, 0.13, seg - 0.14, railMat, mx, FARM.y + 0.48, mz, ry);
      box(root, 0.09, 0.13, seg - 0.14, railMat, mx, FARM.y + 0.83, mz, ry);
    }
  }

  const fx = FARM.x;
  const fz = FARM.z;
  const hx = FARM.halfX;
  const hz = FARM.halfZ;
  addFenceRun(fx - hx, fz - hz, fx + hx, fz - hz);
  addFenceRun(fx - hx, fz - hz, fx - hx, fz + hz);
  addFenceRun(fx + hx, fz - hz, fx + hx, fz + hz);
  addFenceRun(fx - hx, fz + hz, fx - FARM.gateHalf, fz + hz);
  addFenceRun(fx + FARM.gateHalf, fz + hz, fx + hx, fz + hz);

  // 门柱与打开的两扇门
  for (const s of [-1, 1]) {
    const x = fx + s * FARM.gateHalf;
    box(root, 0.22, 1.5, 0.22, M.dark, x, FARM.y + 0.75, fz + hz);
    box(root, 0.3, 0.09, 0.3, M.cream, x, FARM.y + 1.53, fz + hz);
    sphere(root, 0.055, M.gold, x, FARM.y + 1.6, fz + hz);

    const gate = new THREE.Group();
    gate.position.set(x, FARM.y + 0.75, fz + hz);
    gate.rotation.y = s * 1.18;
    root.add(gate);
    box(gate, 0.08, 0.11, 1.26, M.cream, 0, 0.32, -0.62);
    box(gate, 0.08, 0.11, 1.26, M.cream, 0, -0.3, -0.62);
    box(gate, 0.07, 0.11, 1.42, M.cream, 0, 0.01, -0.62, 0, 0.48);
  }
  box(root, 2.7, 0.07, 0.7, M.stone, fx, FARM.y + 0.035, fz + hz + 0.35);

  // 门口的风灯
  const gateLight = new THREE.PointLight(0xffb45a, 0, 13, 2);
  gateLight.position.set(fx - 1.55, FARM.y + 1.75, fz + hz + 0.25);
  gateLight.userData.base = 1.8;
  nightLights.push(gateLight);
  root.add(gateLight);
  box(root, 0.06, 0.5, 0.06, M.dark, fx - 1.5, FARM.y + 1.95, fz + hz + 0.1);
  box(root, 0.2, 0.26, 0.2, lanternMat, fx - 1.5, FARM.y + 1.62, fz + hz + 0.2, 0, 0, false);
  box(root, 0.24, 0.05, 0.24, M.dark, fx - 1.5, FARM.y + 1.78, fz + hz + 0.2, 0, 0, false);
  box(root, 0.24, 0.05, 0.24, M.dark, fx - 1.5, FARM.y + 1.48, fz + hz + 0.2, 0, 0, false);

  /* ---------- 菜畦 ---------- */
  const bedX = fx + 4.0;
  const bedZ = [fz - 3.2, fz + 0.9, fz + 5.0];
  const bedW = 4.8;
  const bedD = 2.2;
  const beds = [];
  const clickMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });

  for (let i = 0; i < 3; i++) {
    const cx = bedX;
    const cz = bedZ[i];
    const topY = FARM.y + 0.26;

    const soilMat = M.soil.clone();
    box(root, bedW, 0.26, bedD, soilMat, cx, FARM.y + 0.13, cz, 0, 0, false);

    // 浇水时从土里荡开的一圈水光
    const rippleMat = new THREE.MeshBasicMaterial({
      color: 0xb9ddea,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.66, 26), rippleMat);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(cx, topY + 0.035, cz);
    ripple.visible = false;
    ripple.frustumCulled = false;
    root.add(ripple);

    // 木边
    box(root, bedW + 0.24, 0.24, 0.14, M.dark, cx, FARM.y + 0.16, cz - bedD * 0.5 - 0.06);
    box(root, bedW + 0.24, 0.24, 0.14, M.dark, cx, FARM.y + 0.16, cz + bedD * 0.5 + 0.06);
    box(root, 0.14, 0.24, bedD + 0.24, M.dark, cx - bedW * 0.5 - 0.06, FARM.y + 0.16, cz);
    box(root, 0.14, 0.24, bedD + 0.24, M.dark, cx + bedW * 0.5 + 0.06, FARM.y + 0.16, cz);

    const plants = new THREE.Group();
    plants.position.set(cx, topY, cz);
    root.add(plants);

    // 不可见的点击判定：盖住整畦作物，鼠标点哪里都能收
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(bedW + 0.2, 1.3, bedD + 0.2), clickMat);
    hitbox.position.set(cx, FARM.y + 0.75, cz);
    hitbox.userData.bedIndex = i;
    hitbox.castShadow = false;
    hitbox.receiveShadow = false;
    hitbox.frustumCulled = false;
    root.add(hitbox);

    const def = [
      { crop: 2, growth: 0.9 },
      { crop: 0, growth: 0.52 },
      { crop: 1, growth: 0.9 },
    ][i];

    beds.push({
      index: i,
      cx,
      cz,
      topY,
      halfX: bedW * 0.5,
      halfZ: bedD * 0.5,
      plants,
      hitbox,
      soilMat,
      ripple,
      rippleMat,
      rippleT: 1,
      moisture: 0.62 + i * 0.04,
      planted: true,
      crop: def.crop,
      growth: def.growth,
      stage: def.growth < 0.36 ? 0 : def.growth < MATURE_AT ? 1 : 2,
    });
  }

  /* ---------- 收成、推车、洒水壶的状态 ---------- */
  const cart = { 0: 0, 1: 0, 2: 0 };
  const CART_CAP = 18;
  const CAN_MAX = 3;
  let canWater = 0;
  let cartPushing = false;
  let groundSeq = 0;
  let wellDrawT = 1;
  const groundCrops = [];
  const pickTargets = beds.map((b) => b.hitbox);
  const farmEvents = [];

  function rebuildBed(bed) {
    while (bed.plants.children.length) {
      const child = bed.plants.children[0];
      if (child.geometry) child.geometry.dispose();
      bed.plants.remove(child);
    }
    bed.hitbox.visible = bed.planted;
    if (!bed.planted) return;

    const rand = mulberry32(9001 + bed.index * 131);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 6; c++) {
        const px = -1.88 + c * 0.752 + (rand() - 0.5) * 0.1;
        const pz = -0.66 + r * 0.66 + (rand() - 0.5) * 0.08;
        const plant = makeCropPlant(bed.crop, bed.stage, rand);
        plant.position.set(px, 0, pz);
        plant.rotation.y = rand() * TAU;
        plant.scale.setScalar(0.88 + rand() * 0.18);
        plant.userData.phase = rand() * TAU;
        plant.userData.sway = 0.012 + rand() * 0.014;
        bed.plants.add(plant);
      }
    }
  }

  for (const bed of beds) rebuildBed(bed);

  /* ---------- 水井 ---------- */
  const well = new THREE.Group();
  well.position.set(fx - 3.1, FARM.y, fz + 5.1);
  root.add(well);
  const wellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.96, 0.78, 18), M.stone);
  wellBase.position.y = 0.39;
  wellBase.castShadow = true;
  wellBase.receiveShadow = true;
  well.add(wellBase);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.09, 8, 20), M.stone);
  rim.position.y = 0.8;
  rim.rotation.x = Math.PI / 2;
  rim.castShadow = true;
  well.add(rim);
  const wellWater = new THREE.Mesh(new THREE.CircleGeometry(0.74, 20), M.water);
  wellWater.position.y = 0.72;
  wellWater.rotation.x = -Math.PI / 2;
  well.add(wellWater);
  for (const s of [-1, 1]) {
    box(well, 0.12, 1.55, 0.12, M.dark, s * 0.65, 1.55, 0);
  }
  const wellRoof = new THREE.Mesh(new THREE.ConeGeometry(0.98, 0.48, 4), M.roof);
  wellRoof.position.y = 2.44;
  wellRoof.rotation.y = Math.PI / 4;
  wellRoof.castShadow = true;
  well.add(wellRoof);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 5), M.rope);
  rope.position.y = 1.75;
  well.add(rope);
  const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.22, 10), M.dark);
  bucket.position.y = 1.26;
  bucket.castShadow = true;
  well.add(bucket);
  const bucketRim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 6, 12), M.gold);
  bucketRim.position.y = 1.37;
  bucketRim.rotation.x = Math.PI / 2;
  well.add(bucketRim);

  /* ---------- 草垛 ---------- */
  const haySpots = [
    [fx - 7.4, fz + 2.3, 0.0],
    [fx - 6.7, fz + 3.15, 0.35],
    [fx - 7.05, fz + 2.7, 0.9],
  ];
  for (const [hx2, hz2, ry] of haySpots) {
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 16), M.hay);
    bale.position.set(hx2, FARM.y + 0.42, hz2);
    bale.rotation.z = Math.PI / 2;
    bale.rotation.y = ry;
    bale.castShadow = true;
    bale.receiveShadow = true;
    root.add(bale);
    for (const s of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.012, 5, 16), M.rope);
      band.position.set(hx2, FARM.y + 0.42, hz2);
      band.rotation.y = Math.PI / 2;
      band.position.x += s * 0.28;
      root.add(band);
    }
  }
  // 顶层再压一捆（视觉上是个小垛）
  const topBale = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 16), M.hay);
  topBale.position.set(fx - 7.05, FARM.y + 1.06, fz + 2.7);
  topBale.rotation.z = Math.PI / 2;
  topBale.rotation.y = 0.6;
  topBale.castShadow = true;
  root.add(topBale);

  /* ---------- 木牌 ---------- */
  const sign = new THREE.Group();
  sign.position.set(fx + 2.5, FARM.y, fz + 6.7);
  root.add(sign);
  for (const s of [-1, 1]) {
    box(sign, 0.13, 1.5, 0.13, M.dark, s * 0.72, 0.75, 0);
  }
  box(sign, 1.78, 0.92, 0.1, M.cream, 0, 1.36, 0);
  const signFace = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.82), M.sign);
  signFace.position.set(0, 1.36, 0.056);
  sign.add(signFace);

  /* ---------- 小农具：独轮车、洒水壶、长凳、窗台花箱 ---------- */
  const woodMat = M.dark;
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x78857f, roughness: 0.45, metalness: 0.5 });

  // 独轮车
  const barrow = new THREE.Group();
  barrow.position.set(fx - 0.8, FARM.y, fz + 2.6);
  barrow.rotation.y = 0.45;
  root.add(barrow);
  box(barrow, 1.1, 0.08, 0.62, woodMat, 0, 0.42, 0);
  box(barrow, 1.1, 0.24, 0.06, woodMat, 0, 0.54, -0.3);
  box(barrow, 1.1, 0.24, 0.06, woodMat, 0, 0.54, 0.3);
  box(barrow, 0.06, 0.24, 0.62, woodMat, -0.55, 0.54, 0);
  box(barrow, 0.06, 0.24, 0.62, woodMat, 0.55, 0.54, 0);
  for (const s of [-1, 1]) {
    box(barrow, 0.06, 0.06, 0.92, woodMat, s * 0.42, 0.5, 0.56, 0, 0, true);
    box(barrow, 0.08, 0.4, 0.08, woodMat, s * 0.42, 0.2, -0.34);
  }
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 14), M.darkWood);
  wheel.position.set(0, 0.2, 0.42);
  wheel.rotation.z = Math.PI / 2;
  wheel.castShadow = true;
  barrow.add(wheel);
  for (let i = 0; i < 3; i++) {
    const veg = new THREE.Mesh(A.sphere, i === 2 ? A.tomatoLeafMat : A.carrotMat);
    veg.scale.setScalar(i === 2 ? 0.12 : 0.08);
    veg.position.set((i - 1) * 0.24, 0.55, (i % 2) * 0.18 - 0.05);
    veg.castShadow = true;
    barrow.add(veg);
  }
  const barrowHay = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.34), M.hay);
  barrowHay.position.set(0.25, 0.54, 0.02);
  barrowHay.castShadow = true;
  barrow.add(barrowHay);

  // 洒水壶
  const can = new THREE.Group();
  can.position.set(fx - 2.0, FARM.y, fz + 4.0);
  can.rotation.y = -0.6;
  root.add(can);
  const canBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.3, 12), metalMat);
  canBody.position.y = 0.18;
  canBody.castShadow = true;
  can.add(canBody);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.38, 8), metalMat);
  spout.position.set(0.24, 0.3, 0);
  spout.rotation.z = -1.0;
  spout.castShadow = true;
  can.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.018, 6, 14, Math.PI), metalMat);
  handle.position.set(-0.02, 0.36, 0);
  handle.rotation.x = Math.PI / 2;
  can.add(handle);

  // 长凳
  const bench = new THREE.Group();
  bench.position.set(fx - 5.4, FARM.y, fz + 0.6);
  root.add(bench);
  box(bench, 1.55, 0.09, 0.42, woodMat, 0, 0.46, 0);
  box(bench, 1.55, 0.42, 0.08, woodMat, 0, 0.72, -0.19);
  for (const s of [-1, 1]) {
    box(bench, 0.09, 0.46, 0.36, woodMat, s * 0.62, 0.23, 0);
    box(bench, 0.07, 0.5, 0.07, woodMat, s * 0.62, 0.7, -0.19);
  }

  // 谷仓正面的窗台花箱
  const flowerMats = [
    new THREE.MeshStandardMaterial({ color: 0xd8583c, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xf0c85a, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xf2b6c4, roughness: 0.8 }),
  ];
  for (const s of [-1, 1]) {
    box(barn, 0.72, 0.18, 0.24, M.dark, s * 2.0, 1.32, 2.42);
    box(barn, 0.62, 0.04, 0.18, M.soil, s * 2.0, 1.42, 2.42, 0, 0, false);
    for (let i = 0; i < 3; i++) {
      const fl = new THREE.Mesh(A.sphere, flowerMats[i]);
      fl.scale.set(0.055, 0.045, 0.055);
      fl.position.set(s * 2.0 + (i - 1) * 0.17, 1.5, 2.43);
      barn.add(fl);
      const stem = new THREE.Mesh(A.cylGeo, A.stemMat);
      stem.scale.set(0.008, 0.12, 0.008);
      stem.position.set(s * 2.0 + (i - 1) * 0.17, 1.42, 2.43);
      barn.add(stem);
    }
  }

  /* ---------- 碰撞与交互 ---------- */
  const fenceSegs = [
    { x1: fx - hx, z1: fz - hz, x2: fx + hx, z2: fz - hz },
    { x1: fx - hx, z1: fz - hz, x2: fx - hx, z2: fz + hz },
    { x1: fx + hx, z1: fz - hz, x2: fx + hx, z2: fz + hz },
    { x1: fx - hx, z1: fz + hz, x2: fx - FARM.gateHalf, z2: fz + hz },
    { x1: fx + FARM.gateHalf, z1: fz + hz, x2: fx + hx, z2: fz + hz },
  ];

  function pushOutCircle(px, pz, cx, cz, minD) {
    const dx = px - cx;
    const dz = pz - cz;
    const d = Math.hypot(dx, dz);
    if (d < minD && d > 1e-5) {
      return { x: cx + (dx / d) * minD, z: cz + (dz / d) * minD };
    }
    return { x: px, z: pz };
  }

  function pushOutBox(px, pz, cx, cz, halfX, halfZ, r) {
    const dx = px - cx;
    const dz = pz - cz;
    const ox = halfX + r - Math.abs(dx);
    const oz = halfZ + r - Math.abs(dz);
    if (ox > 0 && oz > 0) {
      if (ox < oz) return { x: cx + Math.sign(dx || 1) * (halfX + r), z: pz };
      return { x: px, z: cz + Math.sign(dz || 1) * (halfZ + r) };
    }
    return { x: px, z: pz };
  }

  function pushOutSeg(px, pz, r, x1, z1, x2, z2) {
    const abx = x2 - x1;
    const abz = z2 - z1;
    const len2 = abx * abx + abz * abz;
    let t = ((px - x1) * abx + (pz - z1) * abz) / len2;
    t = clamp(t, 0, 1);
    const qx = x1 + abx * t;
    const qz = z1 + abz * t;
    const dx = px - qx;
    const dz = pz - qz;
    const d = Math.hypot(dx, dz);
    const minD = r + 0.1;
    if (d < minD && d > 1e-5) {
      return { x: qx + (dx / d) * minD, z: qz + (dz / d) * minD };
    }
    return { x: px, z: pz };
  }

  function resolve(px, pz, r) {
    let x = px;
    let z = pz;

    // 谷仓：四面墙，正面留门洞；门关着时门洞也挡
    const bx = BARN.cx;
    const bz = BARN.cz;
    const walls = [
      [bx - 3.2, bz - 2.3, bx + 3.2, bz - 2.3],
      [bx - 3.2, bz - 2.3, bx - 3.2, bz + 2.3],
      [bx + 3.2, bz - 2.3, bx + 3.2, bz + 2.3],
      [bx - 3.2, bz + 2.3, bx - 1.16, bz + 2.3],
      [bx + 1.16, bz + 2.3, bx + 3.2, bz + 2.3],
    ];
    if (!doorOpen) walls.push([bx - 1.16, bz + 2.3, bx + 1.16, bz + 2.3]);
    for (const w of walls) {
      const p = pushOutSeg(x, z, r, w[0], w[1], w[2], w[3]);
      x = p.x;
      z = p.z;
    }

    // 粮仓木箱
    let res = pushOutBox(x, z, binWorld.x, binWorld.z, 1.0, 0.63, r);
    x = res.x;
    z = res.z;

    // 室内木箱、工作台、木桶和干草卷
    res = pushOutBox(x, z, crateWorld.x, crateWorld.z, 0.42, 0.42, r);
    x = res.x;
    z = res.z;
    res = pushOutBox(x, z, workbenchWorld.x, workbenchWorld.z, 0.78, 0.36, r);
    x = res.x;
    z = res.z;
    for (const b of barrelWorlds) {
      res = pushOutCircle(x, z, b.x, b.z, b.r + r);
      x = res.x;
      z = res.z;
    }
    res = pushOutCircle(x, z, baleWorld.x, baleWorld.z, baleWorld.r + r);
    x = res.x;
    z = res.z;

    // 菜畦
    for (const bed of beds) {
      res = pushOutBox(x, z, bed.cx, bed.cz, bed.halfX, bed.halfZ, r);
      x = res.x;
      z = res.z;
    }

    // 水井
    res = pushOutCircle(x, z, fx - 3.1, fz + 5.1, 1.0 + r);
    x = res.x;
    z = res.z;

    // 草垛
    res = pushOutCircle(x, z, fx - 7.1, fz + 2.7, 1.15 + r);
    x = res.x;
    z = res.z;

    // 栅栏：线段推挤
    for (const s of fenceSegs) {
      const abx = s.x2 - s.x1;
      const abz = s.z2 - s.z1;
      const len2 = abx * abx + abz * abz;
      let t = ((x - s.x1) * abx + (z - s.z1) * abz) / len2;
      t = clamp(t, 0, 1);
      const qx = s.x1 + abx * t;
      const qz = s.z1 + abz * t;
      const dx = x - qx;
      const dz = z - qz;
      const d = Math.hypot(dx, dz);
      const minD = r + 0.1;
      if (d < minD && d > 1e-5) {
        x = qx + (dx / d) * minD;
        z = qz + (dz / d) * minD;
      }
    }

    return { x, z };
  }

  function nearestBed(px, pz, maxDist = 3.5) {
    let best = null;
    let bestD = maxDist;
    for (const bed of beds) {
      const d = Math.hypot(px - bed.cx, pz - bed.cz);
      if (d < bestD) {
        bestD = d;
        best = bed;
      }
    }
    return best;
  }

  let selected = 0;

  function setSelected(i) {
    selected = clamp(i, 0, CROPS.length - 1);
  }

  function harvestBed(bed) {
    if (!bed) return { type: 'none' };
    if (!bed.planted) return { type: 'empty' };
    if (bed.stage < 2) {
      return { type: 'wait', crop: bed.crop, progress: clamp(bed.growth / MATURE_AT, 0, 1) };
    }
    const crop = bed.crop;
    const amount = CROPS[crop].yield;
    inventory[crop] += amount;
    bed.planted = false;
    bed.growth = 0;
    bed.stage = 0;
    rebuildBed(bed);
    return { type: 'harvest', crop, amount };
  }

  function interact(bed) {
    if (!bed) return { type: 'none' };

    if (!bed.planted) {
      bed.planted = true;
      bed.crop = selected;
      bed.growth = 0;
      bed.stage = 0;
      rebuildBed(bed);
      return { type: 'plant', crop: selected };
    }

    return harvestBed(bed);
  }

  function update(t, dt) {
    doorAnim += ((doorOpen ? 1 : 0) - doorAnim) * Math.min(1, dt * 5);
    doorPanel.position.x = -2.34 * doorAnim;

    // 室内：吊灯轻晃、猫呼吸、挂草摆动、灰尘漂浮
    const level = interiorLight.userData.level;
    if (level !== undefined) {
      interiorLight.intensity = level * (0.95 + 0.05 * Math.sin(t * 6.7) * Math.sin(t * 2.9 + 1.3));
    }
    catBody.scale.y = 0.1 * (1 + Math.sin(t * 1.3) * 0.035);
    catHead.position.y = 0.17 + Math.sin(t * 1.3) * 0.004;
    for (const h of hangings) {
      h.rotation.z = Math.sin(t * 0.8 + h.userData.phase) * 0.045;
    }
    motes.rotation.y = t * 0.018;
    motes.position.y = Math.sin(t * 0.3) * 0.05;

    for (const bed of beds) {
      // 作物跟着风轻轻摆
      if (bed.planted) {
        for (const plant of bed.plants.children) {
          plant.rotation.z = Math.sin(t * 1.35 + plant.userData.phase) * plant.userData.sway;
        }
      }
      if (!bed.planted || bed.stage >= 2) continue;
      bed.growth = Math.min(1, bed.growth + dt / CROPS[bed.crop].grow);
      const st = bed.growth < 0.36 ? 0 : bed.growth < MATURE_AT ? 1 : 2;
      if (st !== bed.stage) {
        bed.stage = st;
        rebuildBed(bed);
      }
    }
  }

  function toggleDoor() {
    doorOpen = !doorOpen;
    return doorOpen;
  }

  function isDoorOpen() {
    return doorOpen;
  }

  function isInsideBarn(x, z) {
    return Math.abs(x - BARN.cx) < 3.0 && Math.abs(z - BARN.cz) < 2.1;
  }

  function floorLift(x, z) {
    return isInsideBarn(x, z) ? 0.38 : 0;
  }

  function depositStorage() {
    const moved = { 0: 0, 1: 0, 2: 0 };
    let total = 0;
    for (let i = 0; i < 3; i++) {
      const n = inventory[i];
      moved[i] = n;
      storage[i] += n;
      inventory[i] = 0;
      total += n;
    }
    return { moved, total, storage };
  }

  function bedProgress(bed) {
    return clamp(bed.growth / MATURE_AT, 0, 1);
  }

  function setNight(v) {
    const k = clamp(v, 0, 1);
    M.glass.emissiveIntensity = k * 1.7;
    lanternMat.emissiveIntensity = 0.25 + k * 2.0;
    for (const l of nightLights) {
      const level = (l.userData.dayBase || 0) + k * (l.userData.base || 1);
      l.intensity = level;
      l.userData.level = level;
    }
    shaftMat.uniforms.uOpacity.value = 0.045 * (1 - k);
    moteMat.opacity = 0.34 - k * 0.14;
  }

  return {
    root,
    beds,
    clickTargets: beds.map((b) => b.hitbox),
    CROPS,
    inventory,
    storage,
    update,
    resolve,
    nearestBed,
    interact,
    harvestBed,
    depositStorage,
    toggleDoor,
    isDoorOpen,
    isInsideBarn,
    floorLift,
    bench: benchSeat,
    door: doorWorld,
    storageBin: binWorld,
    setSelected,
    getSelected: () => selected,
    bedProgress,
    setNight,
    MATURE_AT,
  };
}
