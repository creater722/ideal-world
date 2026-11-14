/* =========================================================
   places.js — 三个可以去的地方
   湖（可涉浅水）、湖心亭（过桥进入）、湖畔木屋（推门进屋）、
   废弃站台（铁轨通到雾里）。
   全部吃真实地形高度，带碰撞与室内判定。
   ========================================================= */

import * as THREE from 'three';
import {
  TAU, clamp, lerp, smoothstep, mulberry32,
  heightAt, lakeDist, LAKE, SITES,
} from './core.js';

/* ---------- 材质库 ---------- */
function mats(envIntensity) {
  // 木头石头都是哑光：用 Lambert，避免掠射角菲涅尔把屋顶反成白色
  const m = (color) => new THREE.MeshLambertMaterial({ color });

  return {
    wood: m(0x6a4c34),
    woodDark: m(0x4a3524),
    woodLight: m(0x8a6a48),
    plank: m(0x7b5c3e),
    stone: m(0x8e8b84),
    stoneDark: m(0x6e6b66),
    roof: m(0x2b2521),
    roofTile: m(0x342c26),
    concrete: m(0xa39e94),
    rust: m(0x6e4a34),
    iron: m(0x4a4744),
    canvas: new THREE.MeshLambertMaterial({ color: 0xb8ae94, side: THREE.DoubleSide }),
    warmGlow: new THREE.MeshBasicMaterial({ color: 0xffcf90 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x1a2226,
      roughness: 0.14,
      metalness: 0.1,
      envMapIntensity: envIntensity,
      transparent: true,
      opacity: 0.72,
    }),
  };
}

function box(w, h, d, mat, x, y, z, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt, rb, h, seg, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/* ---------- 水面 ---------- */
function makeWater(radius) {
  // 必须细分：CircleGeometry 只有中心和一圈顶点，aDepth 会在整片水面上线性插值，岸线全错
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, 140, 140);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + LAKE.x;
    const z = pos.getZ(i) + LAKE.z;
    // 允许负值：负 = 这里的地面已经高过水面，不该画水
    depth[i] = LAKE.level - heightAt(x, z);
    pos.setY(i, 0);
  }
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

  const uniforms = {
    uTime: { value: 0 },
    uSkyTop: { value: new THREE.Color(0x3f7fc4) },
    uSkyHorizon: { value: new THREE.Color(0xf7eed0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xfff0c8) },
    uSunI: { value: 1 },
    uFogColor: { value: new THREE.Color(0xe6e5c9) },
    uFogDensity: { value: 0.006 },
    uDeep: { value: new THREE.Color(0x081a24) },
    uShallow: { value: new THREE.Color(0x2e5044) },
    uReflection: { value: null },
    uReflectMatrix: { value: new THREE.Matrix4() },
    uDusk: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aDepth;
      uniform mat4 uReflectMatrix;
      varying vec2 vUv;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec4 vReflectCoord;

      void main() {
        vUv = uv;
        vDepth = aDepth;
        vec3 p = position;
        // 低频长浪，高频只在片元里做
        p.y += sin(p.x * 0.34 + uTime * 0.62) * 0.011
             + sin(p.z * 0.27 - uTime * 0.47) * 0.009
             + sin((p.x + p.z) * 0.72 + uTime * 1.1) * 0.004;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vReflectCoord = uReflectMatrix * world;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunI;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform sampler2D uReflection;
      uniform float uDusk;
      varying vec2 vUv;
      varying float vDepth;
      varying vec3 vWorld;
      varying vec4 vReflectCoord;

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

      void main() {
        // 地面高过水面的地方不画。留一点余量，阈值太紧会在岸边切出块状缺口
        if (vDepth < -0.22) discard;

        vec3 V = normalize(cameraPosition - vWorld);
        vec2 p = vWorld.xz;

        // 法线：两层慢波 + 一层细纹。细纹不能省，否则太阳倒影会糊成一个白饼
        float n1 = noise(p * 0.36 + vec2(uTime * 0.035, uTime * 0.022));
        float n2 = noise(p * 0.92 + vec2(-uTime * 0.05, uTime * 0.038));
        float n3 = noise(p * 2.6 + vec2(uTime * 0.09, -uTime * 0.07));
        float n4 = noise(p * 6.4 + vec2(-uTime * 0.16, uTime * 0.13));
        vec3 N = normalize(vec3(
          (n1 - 0.5) * 0.16 + (n2 - 0.5) * 0.09 + (n3 - 0.5) * 0.05 + (n4 - 0.5) * 0.03,
          1.0,
          (n2 - 0.5) * 0.16 + (n3 - 0.5) * 0.09 + (n4 - 0.5) * 0.05
        ));

        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fres = pow(1.0 - ndv, 4.5);
        // 黄昏时水面更像镜子
        fres = mix(0.02, mix(0.88, 0.955, uDusk), fres);

        vec3 R = reflect(-V, N);
        // 掠射角反射到的是远山（暗），抬头一点才是天空（亮）
        vec3 skyRefl = mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.6 + 0.02, 0.0, 1.0));
        vec3 ridgeRefl = mix(vec3(0.10, 0.135, 0.11), uSkyHorizon * 0.62, 0.42);
        skyRefl = mix(ridgeRefl, skyRefl, smoothstep(-0.07, 0.13, R.y));
        // 水映天，但要留住蓝：压红、留蓝
        skyRefl *= vec3(0.70, 0.84, 0.96);

        float shallow = 1.0 - smoothstep(0.0, 2.6, vDepth);
        vec3 waterCol = mix(uDeep, uShallow, shallow * 0.8);
        // 浅水要透出沙底，否则贴着岸的地方是一片黑
        waterCol = mix(waterCol, vec3(0.30, 0.28, 0.20), shallow * 0.55);
        // 黄昏的深水不是黑的，它映着紫金色的天
        waterCol = mix(waterCol, uSunColor * 0.11 + vec3(0.045, 0.035, 0.085), uDusk * 0.6);

        // 真正的平面反射：桥、亭子、山和天空都映在水里
        vec2 suv = vReflectCoord.xy / max(vReflectCoord.w, 0.0001);
        // 扰动必须够大，波纹才搅得碎太阳的像；太小就是一块均匀的白饼
        suv.x += N.x * 0.13 + (n4 - 0.5) * 0.009;
        suv.y += N.z * 0.13 + (n3 - 0.5) * 0.009;
        // 近处水面可能落在镜像相机视锥外，直接 clamp 会把纹理边缘拉伸成一个大白斑。
        // 越界处退回解析天空色，边界做一点软过渡。
        float edgeDist = min(min(suv.x, 1.0 - suv.x), min(suv.y, 1.0 - suv.y));
        float inFrame = smoothstep(-0.015, 0.03, edgeDist);
        vec3 refl = texture2D(uReflection, clamp(suv, vec2(0.002), vec2(0.998))).rgb;
        refl = mix(refl, skyRefl, 0.08);
        refl = mix(skyRefl, refl, inFrame);
        // 水面不是镜子，吸收一部分，也顺便压住过曝
        refl *= 0.86;

        vec3 col = mix(waterCol, refl, clamp(fres * 0.94, 0.0, 0.92));

        // 太阳镜面：低角度时高光被拉成一条金光大道（指数降低 = 光斑拉长）
        float sd = max(dot(R, uSunDir), 0.0);
        float tight = mix(900.0, 150.0, uDusk);
        float loose = mix(60.0, 22.0, uDusk);
        // 峰值必须收着点：这一段本来就叠了反射和 Bloom，放开就糊成一片白
        col += uSunColor * pow(sd, tight) * (5.5 + uDusk * 1.5) * uSunI;
        col += uSunColor * pow(sd, loose) * (0.06 + uDusk * 0.15) * uSunI;
        col += uSunColor * pow(sd, 9.0) * 0.02 * uSunI * (0.3 + shallow);

        // 碎金：波纹把太阳打碎成一片闪点。白天也要开，否则正对太阳时是一块白饼
        float sp1 = noise(p * 9.0 + vec2(uTime * 0.55, -uTime * 0.40));
        float sp2 = noise(p * 21.0 - vec2(uTime * 0.90, uTime * 0.70));
        float glit = smoothstep(0.60, 0.97, sp1 * 0.62 + sp2 * 0.38);
        float glitAmt = mix(0.55, 1.15, uDusk);
        col += uSunColor * glit * pow(sd, mix(420.0, 38.0, uDusk)) * glitAmt * 1.3 * uSunI;

        // 岸边一圈细白
        float foamNoise = noise(p * 1.7 + vec2(uTime * 0.35, 0.0));
        float foam = smoothstep(0.30, 0.0, vDepth + (foamNoise - 0.5) * 0.18);
        col = mix(col, vec3(0.42, 0.46, 0.43), foam * 0.34);

        // 雾
        float dist = length(cameraPosition - vWorld);
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFogColor, fogF);

        // 浅水透出湖底、深水不透（写反了整片湖会变成黑泥）
        float alpha = mix(0.26, 0.96, smoothstep(0.0, 1.0, vDepth));
        alpha = max(alpha, foam * 0.5);

        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(LAKE.x, LAKE.level, LAKE.z);
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

/* ---------- 木屋用贴图 ---------- */
function makeWoodTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(1717);

  ctx.fillStyle = '#6d5b47';
  ctx.fillRect(0, 0, S, S);

  const boardH = 42;
  for (let y = 0; y < S; y += boardH) {
    const tone = 0.80 + rnd() * 0.32;
    const r = Math.round(112 * tone);
    const gg = Math.round(93 * tone);
    const b = Math.round(73 * tone);
    ctx.fillStyle = `rgb(${r},${gg},${b})`;
    ctx.fillRect(0, y, S, boardH - 1);

    // 木纹：每块板上几道深浅不一的纹路
    for (let i = 0; i < 30; i++) {
      const yy = y + 2 + rnd() * (boardH - 5);
      ctx.strokeStyle = `rgba(${(r * 0.55) | 0},${(gg * 0.55) | 0},${(b * 0.55) | 0},${0.05 + rnd() * 0.13})`;
      ctx.lineWidth = 0.6 + rnd() * 1.3;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let x = 0; x <= S; x += 24) {
        ctx.lineTo(x, yy + Math.sin(x * 0.021 + i * 1.7) * 1.4);
      }
      ctx.stroke();
    }

    // 板缝：下沿暗、上沿一点高光（别太重，否则墙面像条形码）
    ctx.fillStyle = 'rgba(26, 19, 13, 0.42)';
    ctx.fillRect(0, y + boardH - 2, S, 2);
    ctx.fillStyle = 'rgba(198, 178, 152, 0.10)';
    ctx.fillRect(0, y, S, 1);

    // 钉子
    for (let x = 14; x < S; x += 72) {
      ctx.fillStyle = 'rgba(38, 30, 22, 0.5)';
      ctx.beginPath();
      ctx.arc(x + (rnd() - 0.5) * 10, y + boardH * 0.5, 1.5, 0, TAU);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeRoofTexture() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(4242);

  ctx.fillStyle = '#241e1a';
  ctx.fillRect(0, 0, S, S);

  // 横向木板瓦，逐行叠压，错缝
  const rowH = 34;
  let row = 0;
  for (let y = 0; y < S; y += rowH) {
    const tone = 0.78 + rnd() * 0.36;
    const r = Math.round(60 * tone);
    const g2 = Math.round(50 * tone);
    const b = Math.round(43 * tone);
    const cols = 5;
    const off = row % 2 === 0 ? 0 : S / cols / 2;

    for (let i = -1; i <= cols; i++) {
      const x0 = (i * S) / cols + off;
      const t2 = 0.85 + rnd() * 0.3;
      ctx.fillStyle = `rgb(${(r * t2) | 0},${(g2 * t2) | 0},${(b * t2) | 0})`;
      ctx.fillRect(x0 + 1, y + 1, S / cols - 2, rowH - 3);
      ctx.fillStyle = 'rgba(14,10,8,0.55)';
      ctx.fillRect(x0, y, 2, rowH);
    }

    // 行底阴影，制造叠压的厚度
    ctx.fillStyle = 'rgba(8,6,5,0.6)';
    ctx.fillRect(0, y + rowH - 3, S, 3);
    row++;
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeStoneTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(9091);

  ctx.fillStyle = '#6a6660';
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 90; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const rw = 12 + rnd() * 34;
    const rh = 9 + rnd() * 24;
    const g = 88 + Math.floor(rnd() * 62);
    ctx.fillStyle = `rgb(${g},${g - 3},${g - 9})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rw / 2, rh / 2, rnd() * Math.PI, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(38,36,32,0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* ---------- 木屋 ---------- */
function buildCabin(M, site) {
  const g = new THREE.Group();
  // 地基高度取建筑四角地形的最高点：地形网格是 2.25m 一格插值出来的，
  // 比 heightAt 单点采样高，用中心点会有一半地板被地形埋掉
  const groundY = Math.max(
    heightAt(site.x - 3, site.z - 3),
    heightAt(site.x + 3, site.z - 3),
    heightAt(site.x - 3, site.z + 3),
    heightAt(site.x + 3, site.z + 3),
    heightAt(site.x, site.z)
  ) + 0.05;
  g.position.set(site.x, groundY, site.z);
  g.rotation.y = site.yaw;

  const W = 6.2;
  const D = 5.4;
  const T = 0.18;
  const floorY = 0.42;              // 一层地板面
  const WH1 = 2.70;                 // 一层净高
  const SLAB = 0.18;                // 楼板厚
  const y2 = floorY + WH1 + SLAB;   // 二层地板面
  const WH2 = 2.45;                 // 二层净高
  const yTop = y2 + WH2;            // 檐口高度

  /* 贴图材质：木板墙 / 木瓦顶 / 毛石基 */
  const woodTex = makeWoodTexture();
  woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
  woodTex.repeat.set(2.6, 1.25);
  const wallMat = M.plank.clone();
  wallMat.color = new THREE.Color(0xffffff);
  wallMat.map = woodTex;
  // 双面：从门口往里看时，墙的内侧面才不会被剔除成一个黑洞
  wallMat.side = THREE.DoubleSide;

  const roofTex = makeRoofTexture();
  roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
  roofTex.repeat.set(2.4, 1.8);
  const roofMat = M.roof.clone();
  roofMat.color = new THREE.Color(0xffffff);
  roofMat.map = roofTex;

  const stoneTex = makeStoneTexture();
  stoneTex.wrapS = stoneTex.wrapT = THREE.RepeatWrapping;
  stoneTex.repeat.set(2.5, 0.6);
  const stoneMat = M.stoneDark.clone();
  stoneMat.color = new THREE.Color(0xffffff);
  stoneMat.map = stoneTex;

  // 室内地板：室内全在阴影里，Lambert 会死黑，用不受光的基础材质 + 木纹
  const floorTex = makeWoodTexture();
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(2.2, 2.2);
  floorTex.center.set(0.5, 0.5);
  floorTex.rotation = Math.PI / 2;
  const floorMat = new THREE.MeshBasicMaterial({ color: 0xb99f80, map: floorTex });

  // 毛石基础（加深到 0.9，填满地形的起伏，别让房子悬空或陷进去）
  g.add(box(W + 0.5, 0.9, D + 0.5, stoneMat, 0, -0.21, 0));

  // 一层地板：和石基同样的做法（同尺寸的 box，只换材质），顶面正好在 floorY
  const floorBox = box(W, 0.9, D, floorMat, 0, floorY - 0.45, 0);
  floorBox.name = 'cabinFloor';
  g.add(floorBox);

  /* ---- 一层墙 ---- */
  const doorW = 1.15;
  const doorH = WH1 - 0.42;
  const sideW = (W - doorW) / 2;

  g.add(box(W, WH1, T, wallMat, 0, floorY + WH1 / 2, -D / 2 + T / 2));
  g.add(box(T, WH1, D, wallMat, W / 2 - T / 2, floorY + WH1 / 2, 0));
  g.add(box(T, WH1, D, wallMat, -W / 2 + T / 2, floorY + WH1 / 2, 0));
  g.add(box(sideW, WH1, T, wallMat, -(doorW / 2 + sideW / 2), floorY + WH1 / 2, D / 2 - T / 2));
  g.add(box(sideW, WH1, T, wallMat, doorW / 2 + sideW / 2, floorY + WH1 / 2, D / 2 - T / 2));
  // 门楣
  g.add(box(doorW, 0.36, T, wallMat, 0, floorY + doorH + 0.18, D / 2 - T / 2));

  /* ---- 楼板：留出楼梯洞 ---- */
  const stX0 = -W / 2;              // 楼梯贴西墙
  const stX1 = -W / 2 + 1.05;       // 楼梯宽
  const stZ0 = -1.55;               // 洞北端
  const stZ1 = 2.15;                // 洞南端（上楼入口）
  const slabY = y2 - SLAB / 2;

  // 大板：楼梯洞以东，铺满（室内无直射光，用不受光的材质）
  g.add(box(W / 2 - stX1, SLAB, D, floorMat, (stX1 + W / 2) / 2, slabY, 0));
  // 小板：楼梯洞以北
  g.add(box(stX1 - stX0, SLAB, stZ0 + D / 2, floorMat, (stX0 + stX1) / 2, slabY, (-D / 2 + stZ0) / 2));

  // 楼梯洞封边
  g.add(box(0.09, 0.24, stZ1 - stZ0, M.woodDark, stX1, y2 - 0.02, (stZ0 + stZ1) / 2));
  g.add(box(stX1 - stX0, 0.24, 0.09, M.woodDark, (stX0 + stX1) / 2, y2 - 0.02, stZ0));

  /* ---- 二层墙 ---- */
  const balW = 1.7;                       // 阳台门宽
  const balH = 2.0;
  const balSideW = (D - balW) / 2;

  g.add(box(W, WH2, T, wallMat, 0, y2 + WH2 / 2, -D / 2 + T / 2));
  g.add(box(T, WH2, D, wallMat, -W / 2 + T / 2, y2 + WH2 / 2, 0));
  g.add(box(W, WH2, T, wallMat, 0, y2 + WH2 / 2, D / 2 - T / 2));
  // 东墙：留阳台门洞
  g.add(box(T, WH2, balSideW, wallMat, W / 2 - T / 2, y2 + WH2 / 2, -(balW / 2 + balSideW / 2)));
  g.add(box(T, WH2, balSideW, wallMat, W / 2 - T / 2, y2 + WH2 / 2, balW / 2 + balSideW / 2));
  g.add(box(T, WH2 - balH, balW, wallMat, W / 2 - T / 2, y2 + balH + (WH2 - balH) / 2, 0));

  /* ---- 结构件：角柱两层通高 + 腰线 ---- */
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(0.22, yTop - floorY, 0.22, M.woodDark, sx * (W / 2 - 0.05), floorY + (yTop - floorY) / 2, sz * (D / 2 - 0.05)));
    }
  }
  // 腰线：楼板位置一圈外挑木条，把上下两层分开
  for (const sz of [-1, 1]) {
    g.add(box(W + 0.12, 0.15, 0.13, M.woodDark, 0, y2 - SLAB * 0.5, sz * (D / 2 + 0.03)));
  }
  g.add(box(0.13, 0.15, D + 0.12, M.woodDark, -W / 2 - 0.03, y2 - SLAB * 0.5, 0));

  // 勒脚线
  // 踢脚线：必须沿墙四边各一条。写成一整块会盖住整个地面（历史 bug）
  const skirtH = 0.12;
  for (const sz of [-1, 1]) {
    g.add(box(W - 0.04, skirtH, 0.06, M.woodDark, 0, floorY + skirtH / 2, sz * (D / 2 - 0.1)));
  }
  for (const sx of [-1, 1]) {
    g.add(box(0.06, skirtH, D - 0.04, M.woodDark, sx * (W / 2 - 0.1), floorY + skirtH / 2, 0));
  }

  // 屋顶：两坡 + 屋脊压条 + 封檐板
  const roofH = 1.65;
  const overhang = 0.75;
  const slope = Math.atan2(roofH, W / 2 + overhang);
  const panelW = Math.hypot(W / 2 + overhang, roofH);
  const eaveY = yTop;
  for (const s of [-1, 1]) {
    const panel = box(panelW, 0.15, D + overhang * 2, roofMat, s * (W / 4 + overhang / 2), eaveY + roofH / 2, 0);
    // 靠近屋脊的一端必须更高：旋转方向取 -s，反了就成了往外翘的"蝴蝶顶"
    panel.rotation.z = -s * slope;
    g.add(panel);

    // 封檐板：檐口一圈厚木，屋顶才有分量
    g.add(box(0.1, 0.22, D + overhang * 2 + 0.04, M.woodDark, s * (W / 2 + overhang), eaveY - 0.07, 0));
    // 檐下斜撑
    for (const zz of [-1, 1]) {
      const strut = box(0.08, 0.08, 0.66, M.woodDark, s * (W / 2 - 0.12), eaveY + 0.16, zz * (D / 2 - 0.24));
      strut.rotation.x = zz * 0.6;
      g.add(strut);
    }
  }
  // 屋脊压条
  g.add(box(0.3, 0.16, D + overhang * 2 + 0.08, M.woodDark, 0, eaveY + roofH + 0.02, 0));

  // 山墙：必须是真三角形。用矩形会从屋面下穿出来，把屋顶戳穿。
  const triShape = new THREE.Shape();
  triShape.moveTo(-W / 2, 0);
  triShape.lineTo(W / 2, 0);
  triShape.lineTo(0, roofH);
  triShape.closePath();
  const triGeo = new THREE.ExtrudeGeometry(triShape, { depth: 0.12, bevelEnabled: false });
  // 山墙也要是木板，不能是一块深色三角
  const gableMat = wallMat.clone();
  gableMat.map = woodTex.clone();
  gableMat.map.needsUpdate = true;
  gableMat.map.wrapS = gableMat.map.wrapT = THREE.RepeatWrapping;
  gableMat.map.repeat.set(0.3, 0.62);
  for (const sz of [-1, 1]) {
    const gable = new THREE.Mesh(triGeo, gableMat);
    gable.position.set(0, eaveY, sz > 0 ? D / 2 - 0.12 : -D / 2);
    gable.castShadow = true;
    gable.receiveShadow = true;
    g.add(gable);

    // 山墙上的横向木条，让它看起来是一块块拼起来的
    for (let i = 1; i <= 2; i++) {
      const yy = (roofH * i) / 3;
      const ww = W * (1 - yy / roofH) * 0.94;
      g.add(box(ww, 0.06, 0.05, M.woodLight, 0, eaveY + yy, sz * (D / 2 + 0.015)));
    }
  }

  // 烟囱：挂在东北角墙外，室内不占地方、不挡视线
  const chimX = W / 2 + 0.34;
  const chimZ = -D / 2 + 0.62;
  const chimBottom = floorY;
  const chimTop = eaveY + 1.55;
  const chimH = chimTop - chimBottom;
  g.add(box(0.5, chimH, 0.5, stoneMat, chimX, chimBottom + chimH / 2, chimZ));
  g.add(box(0.58, 0.1, 0.58, M.stoneDark, chimX, chimTop, chimZ));
  g.add(box(0.4, 0.12, 0.4, M.woodDark, chimX, chimTop + 0.1, chimZ));

  /* ---- 一层东墙：大窗（朝向湖）---- */
  const fw = 0.08;
  const mkWindow = (cx, cy, cz, ww, hh, axis) => {
    // axis='x' 表示窗开在东/西墙
    const isX = axis === 'x';
    const t2 = 0.06;
    g.add(box(isX ? t2 : ww, hh, isX ? ww : t2, M.glass, cx, cy, cz));
    const o = 0.012;
    if (isX) {
      g.add(box(0.09, hh + fw * 2, fw, M.woodDark, cx + o, cy, cz - ww / 2 - fw / 2));
      g.add(box(0.09, hh + fw * 2, fw, M.woodDark, cx + o, cy, cz + ww / 2 + fw / 2));
      g.add(box(0.09, fw, ww + fw * 2, M.woodDark, cx + o, cy + hh / 2 + fw / 2, cz));
      g.add(box(0.09, fw, ww + fw * 2, M.woodDark, cx + o, cy - hh / 2 - fw / 2, cz));
      g.add(box(0.06, hh, 0.04, M.woodDark, cx + o + 0.01, cy, cz));
      g.add(box(0.06, 0.04, ww, M.woodDark, cx + o + 0.01, cy, cz));
      g.add(box(0.24, 0.07, ww + 0.34, M.woodLight, cx + 0.08, cy - hh / 2 - 0.11, cz));
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), M.warmGlow);
      glow.position.set(cx + 0.045, cy, cz);
      glow.rotation.y = Math.PI / 2;
      g.add(glow);
    } else {
      g.add(box(ww + fw * 2, hh + fw * 2, 0.09, M.woodDark, cx, cy, cz - o));
      g.add(box(fw, hh, 0.04, M.woodDark, cx, cy, cz - o - 0.01));
      g.add(box(ww, 0.04, 0.06, M.woodDark, cx, cy, cz - o - 0.01));
      g.add(box(ww + 0.34, 0.07, 0.24, M.woodLight, cx, cy - hh / 2 - 0.11, cz + 0.06));
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), M.warmGlow);
      glow.position.set(cx, cy, cz - 0.045);
      g.add(glow);
    }
  };

  mkWindow(W / 2 + 0.01, floorY + 1.72, 0.5, 1.15, 0.95, 'x');
  // 二层北墙小窗
  mkWindow(-0.9, y2 + 1.55, -D / 2 + 0.01, 0.95, 0.85, 'z');

  /* ---- 一层门廊 ---- */
  g.add(box(doorW + 0.9, 0.16, 0.46, M.woodLight, 0, 0.3, D / 2 + 0.31));
  g.add(box(doorW + 0.9, 0.16, 0.4, M.woodLight, 0, 0.14, D / 2 + 0.72));
  // 门廊雨棚
  const canopy = box(doorW + 1.2, 0.1, 0.9, roofMat, 0, floorY + doorH + 0.52, D / 2 + 0.42);
  canopy.rotation.x = -0.16;
  g.add(canopy);
  for (const s of [-1, 1]) {
    g.add(box(0.1, doorH + 0.5, 0.1, M.woodDark, s * (doorW / 2 + 0.42), floorY + (doorH + 0.5) / 2, D / 2 + 0.78));
  }

  /* ---- 一层门 ---- */
  const dfw = 0.1;
  g.add(box(dfw, doorH + dfw * 2, 0.1, M.woodDark, -doorW / 2 - dfw / 2, floorY + doorH / 2, D / 2 + 0.03));
  g.add(box(dfw, doorH + dfw * 2, 0.1, M.woodDark, doorW / 2 + dfw / 2, floorY + doorH / 2, D / 2 + 0.03));
  g.add(box(doorW + dfw * 2, dfw, 0.1, M.woodDark, 0, floorY + doorH + dfw / 2, D / 2 + 0.03));
  g.add(box(doorW + dfw * 2, 0.08, 0.28, M.woodLight, 0, floorY + 0.02, D / 2 + 0.06));

  const doorPivot = new THREE.Group();
  doorPivot.position.set(-doorW / 2, 0, D / 2 - 0.03);
  doorPivot.add(box(doorW * 0.97, doorH - 0.08, 0.06, M.woodLight, doorW * 0.485, floorY + doorH / 2, 0));
  for (const yy of [0.3, 0.7]) {
    doorPivot.add(box(doorW * 0.9, 0.07, 0.075, M.woodDark, doorW * 0.485, floorY + doorH * yy, 0.035));
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), M.iron);
  knob.position.set(doorW * 0.87, floorY + doorH * 0.52, 0.07);
  doorPivot.add(knob);
  doorPivot.rotation.y = -1.62;
  g.add(doorPivot);

  /* ---- 二层阳台门（玻璃门，朝向湖）---- */
  const balDoorX = W / 2;
  g.add(box(0.05, balH, balW, M.glass, balDoorX + 0.01, y2 + balH / 2, 0));
  g.add(box(0.09, balH + 0.16, 0.09, M.woodDark, balDoorX + 0.02, y2 + balH / 2, -balW / 2 - 0.045));
  g.add(box(0.09, balH + 0.16, 0.09, M.woodDark, balDoorX + 0.02, y2 + balH / 2, balW / 2 + 0.045));
  g.add(box(0.09, 0.09, balW + 0.18, M.woodDark, balDoorX + 0.02, y2 + balH + 0.045, 0));
  // 门中间的竖框（双开玻璃门）
  g.add(box(0.07, balH, 0.07, M.woodDark, balDoorX + 0.03, y2 + balH / 2, 0));
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.iron);
    h.position.set(balDoorX + 0.05, y2 + balH * 0.5, s * 0.12);
    g.add(h);
  }

  /* ---- 阳台 ---- */
  const balX0 = W / 2;
  const balX1 = W / 2 + 1.9;
  const balZ0 = -1.6;
  const balZ1 = 1.6;
  const balCX = (balX0 + balX1) / 2;
  const balCZ = (balZ0 + balZ1) / 2;
  const balWid = balX1 - balX0;
  const balDep = balZ1 - balZ0;

  // 地板
  g.add(box(balWid, 0.14, balDep, floorMat, balCX, y2 - 0.07, balCZ));
  // 地板下的横梁
  for (const zz of [balZ0 + 0.15, balCZ, balZ1 - 0.15]) {
    g.add(box(balWid, 0.12, 0.12, M.woodDark, balCX, y2 - 0.2, zz));
  }
  // 两根斜撑
  for (const zz of [balZ0 + 0.2, balZ1 - 0.2]) {
    const brace = box(0.9, 0.11, 0.11, M.woodDark, balX0 + 0.42, y2 - 0.55, zz);
    brace.rotation.z = 0.72;
    g.add(brace);
  }

  // 栏杆：三面（外沿 + 两侧）
  const railH = 1.02;
  const mkRail = (x1, z1, x2, z2) => {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    const ang = Math.atan2(dx, dz);
    // 上下两道横杆
    for (const yy of [railH, railH * 0.52]) {
      g.add(box(0.07, 0.07, len, M.woodLight, (x1 + x2) / 2, y2 + yy, (z1 + z2) / 2, ang));
    }
    // 立柱
    const nPost = Math.max(2, Math.round(len / 0.42));
    for (let i = 0; i <= nPost; i++) {
      const t = i / nPost;
      g.add(box(0.055, railH, 0.055, M.woodDark, x1 + dx * t, y2 + railH / 2, z1 + dz * t, ang));
    }
  };
  mkRail(balX1, balZ0, balX1, balZ1);       // 外沿
  mkRail(balX0 + 0.05, balZ0, balX1, balZ0); // 北侧
  mkRail(balX0 + 0.05, balZ1, balX1, balZ1); // 南侧

  // 阳台角落的小凳 + 一盏灯
  g.add(box(0.42, 0.07, 0.42, M.woodLight, balX1 - 0.45, y2 + 0.42, balZ0 + 0.45));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(0.05, 0.42, 0.05, M.woodDark, balX1 - 0.45 + sx * 0.16, y2 + 0.21, balZ0 + 0.45 + sz * 0.16));
    }
  }
  const balLamp = new THREE.PointLight(0xffb877, 0.0, 6, 1.8);
  balLamp.position.set(balX1 - 0.3, y2 + 2.05, balZ1 - 0.3);
  g.add(balLamp);
  const balBulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), M.warmGlow);
  balBulb.position.copy(balLamp.position);
  g.add(balBulb);

  /* ---- 楼梯 ---- */
  const stairW = stX1 - stX0 - 0.1;
  const stairCX = (stX0 + stX1) / 2;
  const steps = 14;
  const runZ0 = stZ1;                 // 入口（低）
  const runZ1 = stZ0;                 // 顶部（高）
  const dzStep = (runZ0 - runZ1) / steps;
  const dyStep = (y2 - floorY) / steps;

  for (let i = 0; i < steps; i++) {
    const zc = runZ0 - (i + 0.5) * dzStep;
    const yc = floorY + (i + 1) * dyStep;
    // 踏板
    g.add(box(stairW, 0.07, dzStep + 0.03, M.woodLight, stairCX, yc, zc));
    // 立板
    g.add(box(stairW, dyStep, 0.04, M.woodDark, stairCX, yc - dyStep / 2, zc + dzStep / 2));
  }
  // 楼梯侧梁
  const stringerLen = Math.hypot(runZ0 - runZ1, y2 - floorY);
  const stringerAng = Math.atan2(y2 - floorY, runZ0 - runZ1);
  for (const sx of [stX0 + 0.06, stX1 - 0.06]) {
    const st = box(0.07, 0.26, stringerLen, M.woodDark, sx, (floorY + y2) / 2 - 0.1, (runZ0 + runZ1) / 2);
    st.rotation.x = stringerAng;
    g.add(st);
  }
  // 楼梯扶手（靠房间一侧）
  const handRail = box(0.07, 0.07, stringerLen, M.woodLight, stX1 - 0.04, (floorY + y2) / 2 + 0.92, (runZ0 + runZ1) / 2);
  handRail.rotation.x = stringerAng;
  g.add(handRail);
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const zz = runZ0 + (runZ1 - runZ0) * t;
    const yy = floorY + (y2 - floorY) * t;
    g.add(box(0.06, 0.92, 0.06, M.woodDark, stX1 - 0.04, yy + 0.46, zz));
  }

  /* ---- 一层家具：桌、椅、书架、地毯 ---- */
  const tableY = floorY + 0.74;
  g.add(box(1.5, 0.08, 0.95, M.woodLight, 1.15, tableY, 0.55));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(box(0.09, 0.74, 0.09, M.woodDark, 1.15 + sx * 0.62, floorY + 0.37, 0.55 + sz * 0.37));
    }
  }
  // 桌上的杯子
  g.add(cyl(0.05, 0.045, 0.1, 8, M.stone, 0.75, tableY + 0.09, 0.4));

  const mkChair = (cx, cz, ry) => {
    const c = new THREE.Group();
    c.add(box(0.44, 0.06, 0.44, M.woodLight, 0, floorY + 0.45, 0));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        c.add(box(0.05, 0.45, 0.05, M.woodDark, sx * 0.18, floorY + 0.225, sz * 0.18));
      }
    }
    c.add(box(0.44, 0.5, 0.06, M.woodLight, 0, floorY + 0.72, -0.19));
    c.position.set(cx, 0, cz);
    c.rotation.y = ry;
    g.add(c);
  };
  mkChair(0.35, 0.55, 1.4);
  mkChair(1.95, 0.55, -1.4);

  // 书架（靠北墙）
  const shelfX = 0.1;
  const shelfZ = -D / 2 + 0.36;
  g.add(box(1.9, 0.06, 0.36, M.woodDark, shelfX, floorY + 2.0, shelfZ));
  for (const sx of [-1, 1]) {
    g.add(box(0.07, 2.0, 0.36, M.woodDark, shelfX + sx * 0.92, floorY + 1.0, shelfZ));
  }
  g.add(box(1.9, 2.0, 0.04, M.woodDark, shelfX, floorY + 1.0, shelfZ - 0.16));
  for (const yy of [0.55, 1.1, 1.55]) {
    g.add(box(1.78, 0.05, 0.32, M.woodLight, shelfX, floorY + yy, shelfZ));
    // 书上身：一排小方块
    for (let i = 0; i < 9; i++) {
      const bh = 0.18 + ((i * 7) % 5) * 0.022;
      const col = [0x8c3b32, 0x3f5a7a, 0x6b6136, 0x4a4a52, 0x7a5a3a][i % 5];
      const bk = box(0.055 + ((i * 3) % 3) * 0.012, bh, 0.24, new THREE.MeshLambertMaterial({ color: col }),
        shelfX - 0.78 + i * 0.13, floorY + yy + 0.025 + bh / 2, shelfZ);
      g.add(bk);
    }
  }

  // 地毯（室内无直射光，Lambert 会黑成一片，用基础材质）
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.0), new THREE.MeshBasicMaterial({ color: 0x8a4a3e }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(1.1, floorY + 0.012, 0.6);
  rug.receiveShadow = true;
  g.add(rug);

  /* ---- 二层家具：床、柜 ---- */
  const bedX = 1.25;
  const bedZ = -1.15;
  g.add(box(1.55, 0.3, 2.15, M.woodDark, bedX, y2 + 0.15, bedZ));
  g.add(box(1.45, 0.16, 2.0, new THREE.MeshLambertMaterial({ color: 0xd8cfbe }), bedX, y2 + 0.36, bedZ));
  // 被子
  g.add(box(1.48, 0.1, 1.3, new THREE.MeshLambertMaterial({ color: 0x9a9384 }), bedX, y2 + 0.47, bedZ + 0.3));
  // 枕头
  g.add(box(0.62, 0.11, 0.36, new THREE.MeshLambertMaterial({ color: 0xe6dfd0 }), bedX, y2 + 0.47, bedZ - 0.78));
  // 床头板
  g.add(box(1.55, 0.6, 0.07, M.woodLight, bedX, y2 + 0.55, bedZ - 1.06));

  // 床头小柜
  g.add(box(0.44, 0.5, 0.4, M.woodLight, bedX + 1.0, y2 + 0.25, bedZ - 0.8));
  g.add(cyl(0.07, 0.07, 0.16, 8, M.iron, bedX + 1.0, y2 + 0.58, bedZ - 0.8));

  /* ---- 灯 ---- */
  const lamp = new THREE.PointLight(0xffb066, 2.2, 12, 1.5);
  lamp.position.set(1.0, floorY + 2.3, 0.3);
  lamp.castShadow = false;
  g.add(lamp);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M.warmGlow);
  bulb.position.copy(lamp.position);
  g.add(bulb);
  // 吊线
  g.add(cyl(0.008, 0.008, y2 - (floorY + 2.34), 4, M.iron, 1.0, (floorY + 2.34 + y2) / 2, 0.3));

  const lamp2 = new THREE.PointLight(0xffb066, 2.0, 11, 1.5);
  lamp2.position.set(0.9, y2 + 2.05, 0.1);
  lamp2.castShadow = false;
  g.add(lamp2);
  const bulb2 = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), M.warmGlow);
  bulb2.position.copy(lamp2.position);
  g.add(bulb2);

  /* ---- 屋外杂物：柴堆、水桶 ---- */
  g.add(cyl(0.26, 0.3, 0.52, 10, M.woodDark, -W / 2 - 0.55, 0.26, 1.4));
  for (let i = 0; i < 5; i++) {
    const log = cyl(0.09, 0.09, 0.9, 6, M.wood, -W / 2 - 0.42, 0.1 + (i % 2) * 0.17, -1.1 + i * 0.19);
    log.rotation.z = Math.PI / 2;
    g.add(log);
  }

  const cos = Math.cos(site.yaw);
  const sin = Math.sin(site.yaw);
  const toWorld = (lx, lz) => ({
    x: site.x + lx * cos - lz * sin,
    z: site.z + lx * sin + lz * cos,
  });

  const colliders = [];
  const pushWall = (lx, lz, hx, hz, y0, y1) => {
    const w = toWorld(lx, lz);
    colliders.push({ cx: w.x, cz: w.z, cos, sin, hx, hz, y0, y1 });
  };

  // 一层墙（从地面到楼板）
  pushWall(0, -D / 2 + T / 2, W / 2, T / 2, groundY - 1, groundY + y2 - 0.05);
  pushWall(-W / 2 + T / 2, 0, T / 2, D / 2, groundY - 1, groundY + y2 - 0.05);
  pushWall(W / 2 - T / 2, 0, T / 2, D / 2, groundY - 1, groundY + y2 - 0.05);
  // 南墙：门洞两侧各一段，中间必须留空 —— 否则门只是个画上去的洞
  const sideWallW = (W - doorW) / 2;
  pushWall(-(doorW / 2 + sideWallW / 2), D / 2 - T / 2, sideWallW / 2, T / 2, groundY - 1, groundY + y2 - 0.05);
  pushWall(doorW / 2 + sideWallW / 2, D / 2 - T / 2, sideWallW / 2, T / 2, groundY - 1, groundY + y2 - 0.05);

  // 二层墙：东墙留阳台门洞，其余三面照旧
  pushWall(0, -D / 2 + T / 2, W / 2, T / 2, groundY + y2, groundY + yTop);
  pushWall(-W / 2 + T / 2, 0, T / 2, D / 2, groundY + y2, groundY + yTop);
  pushWall(0, D / 2 - T / 2, W / 2, T / 2, groundY + y2, groundY + yTop);
  pushWall(W / 2 - T / 2, -(balW / 2 + balSideW / 2), T / 2, balSideW / 2, groundY + y2, groundY + yTop);
  pushWall(W / 2 - T / 2, balW / 2 + balSideW / 2, T / 2, balSideW / 2, groundY + y2, groundY + yTop);

  // 阳台栏杆：别让人从二楼掉下去
  pushWall(balX1, balCZ, 0.09, balDep / 2, groundY + y2, groundY + y2 + 1.2);
  pushWall(balCX, balZ0, balWid / 2, 0.09, groundY + y2, groundY + y2 + 1.2);
  pushWall(balCX, balZ1, balWid / 2, 0.09, groundY + y2, groundY + y2 + 1.2);

  /* 可站立面清单 */
  const mkDeck = (lx, lz, hx, hz, yLocal, extra) => {
    const w = toWorld(lx, lz);
    return { x: w.x, z: w.z, hx, hz, cos, sin, y: groundY + yLocal, ...extra };
  };
  const stairMid = toWorld(stairCX, (runZ0 + runZ1) / 2);

  const cabinDecks = [
    mkDeck(0, 0, W / 2 - 0.12, D / 2 - 0.12, floorY),
    // 楼梯：沿局部 z 从低到高
    {
      x: stairMid.x,
      z: stairMid.z,
      hx: stairW / 2 + 0.06,
      hz: (runZ0 - runZ1) / 2 + 0.12,
      cos,
      sin,
      y: groundY + floorY,
      y0: groundY + y2,
      y1: groundY + floorY,
    },
    mkDeck((stX1 + W / 2) / 2, 0, (W / 2 - stX1) / 2, D / 2 - 0.12, y2),
    mkDeck((stX0 + stX1) / 2, (stZ0 - D / 2) / 2, (stX1 - stX0) / 2, (stZ0 + D / 2) / 2 - 0.12, y2),
    mkDeck(balCX, balCZ, balWid / 2 - 0.05, balDep / 2 - 0.05, y2),
  ];

  return {
    group: g,
    groundY,
    floorY: groundY + floorY,
    floor2Y: groundY + y2,
    // 室内程度：屋里 1，阳台 0.65，屋外 0
    inside(x, z) {
      const dx = x - site.x;
      const dz = z - site.z;
      const lx = dx * cos + dz * sin;
      const lz = -dx * sin + dz * cos;
      const inHouse = Math.abs(lx) < W / 2 - T * 0.5 && Math.abs(lz) < D / 2 - T * 0.5;
      if (inHouse) return 1;
      const onBalcony = lx > W / 2 && lx < balX1 && Math.abs(lz) < balDep / 2;
      return onBalcony ? 0.65 : 0;
    },
    lamp,
    lamp2,
    balLamp,
    colliders,
    decks: cabinDecks,
    deck: cabinDecks[0],
  };
}

/* ---------- 湖心亭 + 桥 ---------- */
function buildPavilion(M, site) {
  const g = new THREE.Group();
  const deckY = LAKE.level + 0.62;
  const S = 3.2; // 半边长

  // 平台
  g.add(box(S * 2, 0.16, S * 2, M.plank, 0, deckY, 0));
  // 平台下裙板
  for (const s of [-1, 1]) {
    g.add(box(S * 2, 0.3, 0.08, M.woodDark, 0, deckY - 0.23, s * (S - 0.04)));
    g.add(box(0.08, 0.3, S * 2, M.woodDark, s * (S - 0.04), deckY - 0.23, 0));
  }

  // 四根柱：从湖底立起来，不是浮在水上
  const colH = 2.55;
  const pcos = Math.cos(site.yaw);
  const psin = Math.sin(site.yaw);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * (S - 0.24);
      const lz = sz * (S - 0.24);
      const wx = site.x + lx * pcos + lz * psin;
      const wz = site.z - lx * psin + lz * pcos;
      const bottom = heightAt(wx, wz) - 0.55;
      const pileH = deckY - bottom;
      g.add(cyl(0.13, 0.17, pileH, 8, M.woodDark, lx, bottom + pileH / 2, lz));

      const p = cyl(0.1, 0.12, colH, 10, M.woodDark, lx, deckY + colH / 2, lz);
      g.add(p);
      // 木楔
      g.add(box(0.26, 0.1, 0.26, M.woodLight, lx, deckY + colH - 0.1, lz));
    }
  }

  // 横梁
  for (const sz of [-1, 1]) g.add(box(S * 2 - 0.3, 0.13, 0.13, M.woodDark, 0, deckY + colH, sz * (S - 0.24)));
  for (const sx of [-1, 1]) g.add(box(0.13, 0.13, S * 2 - 0.3, M.woodDark, sx * (S - 0.24), deckY + colH, 0));

  // 攒尖顶
  const roof = new THREE.Mesh(new THREE.ConeGeometry(S * 1.62, 1.5, 4, 1, true), M.roofTile);
  roof.position.set(0, deckY + colH + 0.72, 0);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.receiveShadow = true;
  g.add(roof);
  // 顶下的檐板
  const eaves = new THREE.Mesh(new THREE.ConeGeometry(S * 1.66, 0.22, 4, 1, true), M.roof);
  eaves.position.set(0, deckY + colH + 0.06, 0);
  eaves.rotation.y = Math.PI / 4;
  g.add(eaves);
  // 宝顶
  g.add(cyl(0.05, 0.09, 0.3, 8, M.iron, 0, deckY + colH + 1.6, 0));

  // 栏杆：只做两侧，留出桥的入口（-x 方向）
  const railY = deckY + 0.5;
  for (const sz of [-1, 1]) {
    g.add(box(S * 2 - 0.2, 0.08, 0.08, M.woodLight, 0, railY, sz * (S - 0.1)));
    for (let i = -2; i <= 2; i++) {
      g.add(box(0.07, 0.5, 0.07, M.woodDark, i * 0.62, deckY + 0.25, sz * (S - 0.1)));
    }
  }
  g.add(box(0.08, 0.08, S * 2 - 0.2, M.woodLight, S - 0.1, railY, 0));
  for (let i = -2; i <= 2; i++) {
    g.add(box(0.07, 0.5, 0.07, M.woodDark, S - 0.1, deckY + 0.25, i * 0.62));
  }

  // 亭中石桌凳
  g.add(cyl(0.42, 0.46, 0.1, 14, M.stone, 0, deckY + 0.72, 0));
  g.add(cyl(0.11, 0.13, 0.68, 10, M.stoneDark, 0, deckY + 0.42, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    g.add(cyl(0.17, 0.19, 0.34, 10, M.stoneDark, Math.cos(a) * 0.95, deckY + 0.25, Math.sin(a) * 0.95));
  }

  g.position.set(site.x, 0, site.z);
  g.rotation.y = site.yaw;

  return {
    group: g,
    deckY,
    deck: { x: site.x, z: site.z, hx: S - 0.15, hz: S - 0.15, cos: Math.cos(site.yaw), sin: Math.sin(site.yaw), y: deckY + 0.08 },
  };
}

/* ---------- 桥 ---------- */
function buildBridge(M, from, to, width = 2.0) {
  const g = new THREE.Group();
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);

  const deckY = LAKE.level + 0.62;
  // 桥面高度沿桥采样：始终高出地形一点，再缓缓降到湖面
  const startY = heightAt(from.x, from.z) + 0.12;
  const archH = 0.12;
  const N = 64;
  const profile = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    const base = startY + (deckY - startY) * t + Math.sin(t * Math.PI) * archH;
    profile[i] = Math.max(base, heightAt(x, z) + 0.15);
  }
  const yAt = (t) => {
    const f = Math.min(1, Math.max(0, t)) * N;
    const i = Math.floor(f);
    const k = Math.min(N, i + 1);
    return profile[i] + (profile[k] - profile[i]) * (f - i);
  };
  const rnd = mulberry32(31337);

  // 桥板
  const plankW = 0.19;
  const count = Math.floor(len / (plankW + 0.045));
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    const p = box(width, 0.09, plankW, i % 3 === 0 ? M.woodLight : M.plank, x, yAt(t), z, yaw);
    p.rotation.z = (rnd() - 0.5) * 0.014;
    g.add(p);
  }

  // 桥墩
  const piers = Math.max(2, Math.round(len / 6));
  for (let i = 1; i < piers; i++) {
    const t = i / piers;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    const bottom = heightAt(x, z) - 0.4;
    const top = yAt(t) - 0.06;
    const h = top - bottom;
    if (h < 0.15) continue;
    for (const s of [-1, 1]) {
      const px = x + Math.cos(yaw) * s * (width / 2 - 0.12);
      const pz = z - Math.sin(yaw) * s * (width / 2 - 0.12);
      g.add(cyl(0.1, 0.12, h, 8, M.woodDark, px, bottom + h / 2, pz));
    }

    // 桥墩之间的横撑和斜撑，让露出水面的桩看起来是桥的一部分
    const braceY = LAKE.level + 0.42;
    if (braceY > bottom + 0.2 && braceY < top - 0.35) {
      g.add(box(width - 0.24, 0.09, 0.09, M.woodDark, x, braceY, z, yaw));
      const bw = width - 0.24;
      const rise = 0.85;
      const frame = new THREE.Group();
      frame.position.set(x, braceY + 0.05, z);
      frame.rotation.y = yaw;
      for (const s of [-1, 1]) {
        const brace = box(Math.hypot(bw, rise), 0.06, 0.06, M.woodDark, 0, 0, 0, 0);
        brace.rotation.z = s * Math.atan2(rise, bw);
        frame.add(brace);
      }
      g.add(frame);
    }
  }

  // 栏杆：分段跟着桥面，立柱落地
  const railH = 0.62;
  const posts = Math.max(2, Math.round(len / 3.2));
  for (const s of [-1, 1]) {
    const ox = Math.cos(yaw) * s * (width / 2 - 0.06);
    const oz = -Math.sin(yaw) * s * (width / 2 - 0.06);
    for (let i = 0; i < posts; i++) {
      const t0 = i / posts;
      const t1 = (i + 1) / posts;
      const x0 = from.x + dx * t0 + ox;
      const z0 = from.z + dz * t0 + oz;
      const x1 = from.x + dx * t1 + ox;
      const z1 = from.z + dz * t1 + oz;
      const segY = (yAt(t0) + yAt(t1)) / 2 + railH;
      const segLen = Math.hypot(x1 - x0, z1 - z0) + 0.03;
      g.add(box(0.07, 0.07, segLen, M.woodLight, (x0 + x1) / 2, segY, (z0 + z1) / 2, yaw));
    }
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const x = from.x + dx * t;
      const z = from.z + dz * t;
      g.add(box(0.075, railH, 0.075, M.woodDark, x + ox, yAt(t) + railH / 2, z + oz, yaw));
    }
  }

  return {
    group: g,
    // 桥面占一条带：局部坐标判定
    deck: {
      x: from.x + dx / 2,
      z: from.z + dz / 2,
      hx: width / 2,
      hz: len / 2,
      // inDeck 用的是另一套局部坐标，这里必须跟着它的约定
      cos: dz / len,
      sin: -dx / len,
      y: deckY + 0.1,
      profile,
      yaw,
      from,
      to,
    },
  };
}

/* ---------- 废弃站台 ---------- */
function buildStation(M, site) {
  const g = new THREE.Group();
  const groundY = heightAt(site.x, site.z);
  g.position.set(site.x, groundY, site.z);
  g.rotation.y = site.yaw;

  const PL = 11;   // 站台长
  const PW = 3.4;  // 站台宽
  const PH = 0.62; // 站台高

  // 站台
  g.add(box(PL, PH, PW, M.concrete, 0, PH / 2, 0));
  // 站台边缘的白线
  g.add(box(PL, 0.02, 0.1, M.stoneDark, 0, PH + 0.01, -PW / 2 + 0.16));

  // 铁轨：两条，通到雾里
  const railLen = 150;
  for (const s of [-1, 1]) {
    g.add(box(0.09, 0.14, railLen, M.rust, s * 0.72, 0.14, -PW / 2 - 1.5, 0));
  }
  // 枕木
  for (let i = -22; i <= 22; i++) {
    g.add(box(2.5, 0.11, 0.24, M.woodDark, 0, 0.05, i * 0.68 - PW / 2 - 1.5));
  }
  // 道砟
  g.add(box(3.2, 0.1, railLen, M.stoneDark, 0, 0.02, -PW / 2 - 1.5));

  // 顶棚 + 柱
  const canopyY = 2.75;
  for (const x of [-3.6, 0, 3.6]) {
    g.add(cyl(0.07, 0.08, canopyY, 8, M.iron, x, PH + canopyY / 2, -0.9));
    g.add(cyl(0.07, 0.08, canopyY, 8, M.iron, x, PH + canopyY / 2, 0.9));
    // 斜撑
    const brace = box(0.06, 0.06, 1.6, M.iron, x, PH + canopyY - 0.12, 0);
    brace.rotation.x = 0.35;
    g.add(brace);
  }
  // 棚顶（略微倾斜）
  const canopy = box(PL * 0.92, 0.1, PW * 1.15, M.roofTile, 0, PH + canopyY + 0.15, 0);
  canopy.rotation.x = -0.045;
  g.add(canopy);

  // 站牌
  const post = cyl(0.055, 0.065, 2.1, 8, M.iron, -4.6, PH + 1.05, 0.9);
  g.add(post);
  const signBoard = box(1.5, 0.62, 0.06, M.canvas, -4.6, PH + 1.92, 0.9);
  g.add(signBoard);
  g.add(box(1.54, 0.06, 0.08, M.stoneDark, -4.6, PH + 2.25, 0.9));

  // 长椅
  const benchY = PH + 0.45;
  g.add(box(2.0, 0.08, 0.5, M.woodLight, 1.6, benchY, 0.55));
  g.add(box(2.0, 0.42, 0.07, M.woodLight, 1.6, benchY + 0.3, 0.78));
  for (const x of [0.75, 2.45]) {
    g.add(box(0.07, 0.42, 0.5, M.iron, x, benchY - 0.21, 0.55));
  }

  // 一盏旧灯（不亮，只在夜里亮一点）
  const lampPost = cyl(0.06, 0.09, 3.1, 8, M.iron, -1.4, PH + 1.55, 1.35);
  g.add(lampPost);
  const lampHead = cyl(0.16, 0.1, 0.24, 8, M.iron, -1.4, PH + 3.18, 1.35);
  g.add(lampHead);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), M.warmGlow);
  glow.position.set(-1.4, PH + 3.04, 1.35);
  g.add(glow);
  const stationLamp = new THREE.PointLight(0xffb877, 0.0, 12, 1.8);
  stationLamp.position.copy(glow.position);
  g.add(stationLamp);

  const cos = Math.cos(site.yaw);
  const sin = Math.sin(site.yaw);

  return {
    group: g,
    groundY,
    deck: {
      x: site.x, z: site.z,
      hx: PL / 2, hz: PW / 2,
      cos, sin,
      y: groundY + PH,
    },
    stationLamp,
    colliders: [
      // 站牌柱、灯柱
      { cx: site.x + (-4.6 * cos + 0.9 * sin), cz: site.z - (-4.6 * sin + 0.9 * cos), cos, sin, hx: 0.12, hz: 0.12 },
      { cx: site.x + (-1.4 * cos + 1.35 * sin), cz: site.z - (-1.4 * sin + 1.35 * cos), cos, sin, hx: 0.12, hz: 0.12 },
    ],
  };
}

/* ---------- 汇总 ---------- */
export function createPlaces(scene, envMap) {
  const M = mats(0.32);
  if (envMap) {
    for (const key of Object.keys(M)) {
      const mat = M[key];
      if (mat.envMapIntensity !== undefined && mat.isMeshStandardMaterial) {
        mat.envMap = envMap;
      }
    }
  }

  const colliders = [];
  const decks = [];

  /* 湖 */
  const water = makeWater(LAKE.r * 2.35);
  scene.add(water.mesh);

  /* 亭 */
  const pav = buildPavilion(M, SITES.pavilion);
  scene.add(pav.group);
  decks.push(pav.deck);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const lx = sx * 2.96;
      const lz = sz * 2.96;
      const cos = Math.cos(SITES.pavilion.yaw);
      const sin = Math.sin(SITES.pavilion.yaw);
      colliders.push({
        cx: SITES.pavilion.x + lx * cos + lz * sin,
        cz: SITES.pavilion.z - lx * sin + lz * cos,
        cos, sin, hx: 0.16, hz: 0.16,
      });
    }
  }

  /* 桥：从西南岸边连到亭子 */
  {
    const dx = SITES.pavilion.x - 0;
    const dz = SITES.pavilion.z - 0;
    const d = Math.hypot(dx, dz);
    const nx = dx / d;
    const nz = dz / d;
    const shoreT = LAKE.r * 1.5;
    const from = { x: SITES.pavilion.x - nx * shoreT, z: SITES.pavilion.z - nz * shoreT };
    const to = { x: SITES.pavilion.x - nx * 2.6, z: SITES.pavilion.z - nz * 2.6 };
    const bridge = buildBridge(M, from, to, 2.1);
    scene.add(bridge.group);
    decks.push(bridge.deck);
    // 桥两侧栏杆当碰撞，防止掉水里
    for (const s of [-1, 1]) {
      const yaw = bridge.deck.yaw;
      const ox = Math.cos(yaw) * s * 1.05;
      const oz = -Math.sin(yaw) * s * 1.05;
      colliders.push({
        cx: (from.x + to.x) / 2 + ox,
        cz: (from.z + to.z) / 2 + oz,
        cos: Math.cos(yaw), sin: Math.sin(yaw),
        hx: 0.1, hz: Math.hypot(to.x - from.x, to.z - from.z) / 2,
      });
    }
  }

  /* 木屋 */
  const cabin = buildCabin(M, SITES.cabin);
  scene.add(cabin.group);
  decks.push(...cabin.decks);
  colliders.push(...cabin.colliders);

  /* 站台 */
  const station = buildStation(M, SITES.station);
  scene.add(station.group);
  decks.push(station.deck);
  colliders.push(...station.colliders);

  const tmp = { x: 0, z: 0 };

  function inDeck(d, x, z, pad = 0) {
    const dx = x - d.x;
    const dz = z - d.z;
    const lx = dx * d.cos + dz * d.sin;
    const lz = -dx * d.sin + dz * d.cos;
    return Math.abs(lx) < d.hx + pad && Math.abs(lz) < d.hz + pad;
  }

  return {
    water,
    cabin,
    pavilion: pav,
    station,

    /* 脚下高度：考虑桥面、平台、木屋楼层、楼梯。
       fromY = 玩家当前脚底高度，高于这个 +0.55 的地板够不着，不参与计算，
       否则站在一楼会被二楼的楼板吸上去。 */
    floorAt(x, z, fromY = Infinity) {
      let y = heightAt(x, z);
      let onDeck = false;
      let deckY = 0;
      for (const d of decks) {
        if (!inDeck(d, x, z, 0.1)) continue;
        let dy = d.y;
        const dx = x - d.x;
        const dz = z - d.z;
        const lz = -dx * d.sin + dz * d.cos;
        const t = Math.min(1, Math.max(0, (lz + d.hz) / (2 * d.hz)));
        if (d.profile) {
          const f = t * (d.profile.length - 1);
          const i = Math.floor(f);
          const k = Math.min(d.profile.length - 1, i + 1);
          dy = d.profile[i] + (d.profile[k] - d.profile[i]) * (f - i) + 0.06;
        } else if (d.y0 !== undefined) {
          dy = d.y0 + (d.y1 - d.y0) * t + Math.sin(t * Math.PI) * (d.arch || 0);
        }
        if (dy > fromY + 0.55) continue;
        if (dy > y) {
          y = dy;
          deckY = dy;
          onDeck = true;
        }
      }
      return { y, onDeck, deckY };
    },

    /* 是否在水里（深水） */
    waterDepth(x, z) {
      return LAKE.level - heightAt(x, z);
    },

    /* 室内程度 0..1（阳台算半室内） */
    indoorAt(x, z) {
      return cabin.inside(x, z);
    },

    /* 碰撞：把点推出来。y = 玩家脚底高度，用来区分一层墙和二层墙 */
    resolve(x, z, radius, y = 0) {
      tmp.x = x;
      tmp.z = z;
      for (const c of colliders) {
        if (c.y0 !== undefined && (y < c.y0 - 0.2 || y > c.y1)) continue;
        const dx = tmp.x - c.cx;
        const dz = tmp.z - c.cz;
        const lx = dx * c.cos + dz * c.sin;
        const lz = -dx * c.sin + dz * c.cos;
        const qx = clamp(lx, -c.hx, c.hx);
        const qz = clamp(lz, -c.hz, c.hz);
        const ex = lx - qx;
        const ez = lz - qz;
        const d2 = ex * ex + ez * ez;
        if (d2 < radius * radius) {
          let nx;
          let nz;
          let depth;
          if (d2 > 1e-7) {
            const d = Math.sqrt(d2);
            nx = ex / d;
            nz = ez / d;
            depth = radius - d;
          } else {
            const px = c.hx - Math.abs(lx);
            const pz = c.hz - Math.abs(lz);
            if (px < pz) {
              nx = Math.sign(lx) || 1;
              nz = 0;
              depth = px + radius;
            } else {
              nx = 0;
              nz = Math.sign(lz) || 1;
              depth = pz + radius;
            }
          }
          const wx = nx * c.cos - nz * c.sin;
          const wz = nx * c.sin + nz * c.cos;
          tmp.x += wx * depth * 1.02;
          tmp.z += wz * depth * 1.02;
        }
      }
      return { x: tmp.x, z: tmp.z };
    },

    update(t, timeState, sunDir, sunIntensity, nightAmount) {
      const u = water.uniforms;
      u.uTime.value = t;
      u.uSkyTop.value.copy(timeState.zenith);
      u.uSkyHorizon.value.copy(timeState.horizon);
      u.uSunDir.value.copy(sunDir);
      u.uSunColor.value.copy(timeState.sun);
      u.uSunI.value = timeState.sunI;
      u.uFogColor.value.copy(timeState.fog);
      u.uFogDensity.value = timeState.fogD;
      u.uDusk.value = timeState.dusk || 0;

      // 夜里屋里的灯更明显
      cabin.lamp.intensity = lerp(1.5, 2.8, nightAmount);
      cabin.lamp2.intensity = lerp(0.9, 2.4, nightAmount);
      cabin.balLamp.intensity = lerp(0.0, 2.0, nightAmount);
      station.stationLamp.intensity = lerp(0.0, 2.2, nightAmount);
      M.warmGlow.color.setRGB(
        lerp(0.20, 1.0, nightAmount),
        lerp(0.18, 0.74, nightAmount),
        lerp(0.15, 0.40, nightAmount)
      );
    },
  };
}
