/* =========================================================
   snowplaces.js — 雪原自己的东西
   不是农场：一座烧着炉子的猎屋、一眼冒热气的温泉、
   冰面上一个钓鱼的小屋、几个雪人、一架雪橇，
   还有在雪地里跑来跑去的白狐。
   ========================================================= */

import * as THREE from 'three';

const _v = new THREE.Vector3();

function woodMat(color = 0x6b4a32) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeSoftTexture(inner = 'rgba(255,255,255,0.95)', outer = 'rgba(255,255,255,0)') {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSnowPlaces(scene, { heightAt, iceDist, ICE }) {
  const group = new THREE.Group();
  scene.add(group);

  const softTex = makeSoftTexture();
  const clockLights = [];
  const doors = [];
  const steamPuffs = [];
  const smokePuffs = [];
  const tips = [];

  /* =========================================================
     1. 猎屋：一座烧着炉子的木屋，门可以推开
     ========================================================= */
  const CABIN = { x: 17, z: -31, yaw: 0.12 };
  const cabinY = heightAt(CABIN.x, CABIN.z);

  {
    const g = new THREE.Group();
    g.position.set(CABIN.x, cabinY, CABIN.z);
    g.rotation.y = CABIN.yaw;

    const logMat = woodMat(0x63432d);
    const logLight = woodMat(0x77513a);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9 });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xeef4fa, roughness: 0.95 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 1 });

    // 石头地基
    g.add(box(7.6, 0.5, 6.4, stoneMat, 0, 0.25, 0));

    // 四面原木墙：一层层叠上去，接缝里塞着雪
    const layers = 6;
    for (let i = 0; i < layers; i++) {
      const y = 0.62 + i * 0.46;
      const mat = i % 2 ? logMat : logLight;
      g.add(box(6.4, 0.42, 0.34, mat, 0, y, -2.6));
      g.add(box(6.4, 0.42, 0.34, mat, 0, y, 2.6));
      g.add(box(0.34, 0.42, 5.2, mat, -3.0, y, 0));
      g.add(box(0.34, 0.42, 5.2, mat, 3.0, y, 0));
    }

    // 山墙
    const gableMat = woodMat(0x5a3d2a);
    for (const zz of [-2.6, 2.6]) {
      const shape = new THREE.Shape();
      shape.moveTo(-3.2, 0);
      shape.lineTo(3.2, 0);
      shape.lineTo(0, 1.9);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
      geo.translate(0, 3.3, zz - 0.15);
      const m = new THREE.Mesh(geo, gableMat);
      m.castShadow = true;
      g.add(m);
    }

    // 两坡屋顶 + 屋顶上的雪
    for (const s of [-1, 1]) {
      const roof = box(3.9, 0.22, 6.2, roofMat, s * 1.72, 4.36, 0);
      roof.rotation.z = -s * 0.52;
      g.add(roof);
      const snow = box(3.95, 0.26, 6.28, snowMat, s * 1.74, 4.56, 0);
      snow.rotation.z = -s * 0.52;
      g.add(snow);
    }

    // 门（可以推开）
    const doorPivot = new THREE.Group();
    doorPivot.position.set(0, 0.6, 2.62);
    const door = box(1.25, 1.95, 0.12, woodMat(0x4d3524), 0.62, 0.98, 0);
    doorPivot.add(door);
    // 门把手
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc9a44a, roughness: 0.4, metalness: 0.6 }));
    knob.position.set(1.1, 0.95, 0.09);
    doorPivot.add(knob);
    g.add(doorPivot);
    doors.push({ pivot: doorPivot, open: false, target: 0 });

    // 窗：炉火的光从里面透出来
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x3a2a1c,
      emissive: new THREE.Color(0xffa64d),
      emissiveIntensity: 1.4,
      roughness: 0.6,
    });
    const win = box(1.15, 0.95, 0.08, winMat, -1.72, 2.35, 2.66);
    g.add(win);
    // 窗框
    const frameMat = woodMat(0x3f2c1e);
    g.add(box(1.3, 0.09, 0.1, frameMat, -1.72, 2.84, 2.68));
    g.add(box(1.3, 0.09, 0.1, frameMat, -1.72, 1.86, 2.68));
    g.add(box(0.09, 0.95, 0.1, frameMat, -2.3, 2.35, 2.68));
    g.add(box(0.09, 0.95, 0.1, frameMat, -1.14, 2.35, 2.68));
    g.add(box(0.07, 0.95, 0.07, frameMat, -1.72, 2.35, 2.7));

    // 烟囱
    const chimney = box(0.72, 2.1, 0.72, stoneMat, 1.55, 4.35, -1.2);
    g.add(chimney);
    const cap = box(0.9, 0.16, 0.9, stoneMat, 1.55, 5.45, -1.2);
    g.add(cap);

    // 柴堆
    for (let i = 0; i < 9; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.5, 7), i % 2 ? logMat : logLight);
      log.rotation.z = Math.PI / 2;
      log.position.set(-4.1 + (i % 3) * 0.02, 0.62 + Math.floor(i / 3) * 0.25, 1.0 + (i % 3) * 0.26);
      log.castShadow = true;
      g.add(log);
    }

    // 门口的马灯：夜里是唯一一盏暖灯
    const post = box(0.13, 2.0, 0.13, woodMat(0x3c2b1f), 1.85, 1.0, 3.05);
    g.add(post);
    const lampBody = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: new THREE.Color(0xffa64d), emissiveIntensity: 2.2 })
    );
    lampBody.position.set(1.85, 2.05, 3.05);
    g.add(lampBody);
    const lampLight = new THREE.PointLight(0xffb066, 0, 9, 2);
    lampLight.position.set(1.85, 2.05, 3.05);
    g.add(lampLight);
    clockLights.push({ light: lampLight, base: 1.25, lamp: lampBody });

    // 门口台阶
    g.add(box(1.9, 0.18, 0.7, stoneMat, 0, 0.09, 3.0));

    group.add(g);
    tips.push({
      id: 'door',
      key: 'cabin-door',
      x: CABIN.x + Math.sin(CABIN.yaw) * 2.6,
      z: CABIN.z + Math.cos(CABIN.yaw) * 2.6,
      r: 2.4,
      label: () => (doors[0].open ? '掩上门' : '推开门'),
      sub: '屋里烧着炉子',
    });
  }

  /* =========================================================
     2. 温泉：雪地里一汪冒热气的水
     ========================================================= */
  const SPRING = { x: -74, z: 62, r: 4.6 };
  const springY = heightAt(SPRING.x, SPRING.z);
  let springWater = null;
  let springLight = null;

  {
    const g = new THREE.Group();
    g.position.set(SPRING.x, springY, SPRING.z);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x635e57, roughness: 1, flatShading: true });
    const stoneDark = new THREE.MeshStandardMaterial({ color: 0x4e4a44, roughness: 1, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xeef4fa, roughness: 0.95 });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);

    // 池沿：一圈半埋在雪里的石头，大小不一，朝水的一面压低
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      const rr = SPRING.r + 0.05 + ((i * 7) % 5) * 0.05;
      const rock = new THREE.Mesh(rockGeo, i % 3 ? stoneMat : stoneDark);
      const s2 = 0.26 + ((i * 37) % 10) / 34;
      const wx = SPRING.x + Math.cos(a) * rr;
      const wz = SPRING.z + Math.sin(a) * rr;
      rock.position.set(Math.cos(a) * rr, heightAt(wx, wz) - springY + s2 * 0.12, Math.sin(a) * rr);
      rock.scale.set(s2 * 1.1, s2 * 0.5, s2 * 0.95);
      rock.rotation.set(i * 0.7, i * 1.3, i * 0.4);
      rock.castShadow = true;
      rock.receiveShadow = true;
      g.add(rock);
      // 背水面堆着雪
      if (i % 4 === 0) {
        const cap = new THREE.Mesh(rockGeo, snowMat);
        cap.scale.set(s2 * 0.95, s2 * 0.22, s2 * 0.8);
        cap.position.set(rock.position.x, rock.position.y + s2 * 0.3, rock.position.z);
        g.add(cap);
      }
    }

    // 水面：比池沿低一点，像真的一汪水
    const waterGeo = new THREE.CircleGeometry(SPRING.r + 0.15, 48);
    waterGeo.rotateX(-Math.PI / 2);
    const waterUniforms = {
      uTime: { value: 0 },
      uSunColor: { value: new THREE.Color(0xfff2dc) },
      uSkyColor: { value: new THREE.Color(0xa8c8ee) },
      uNight: { value: 0 },
      uDusk: { value: 0 },
    };
    const waterMat = new THREE.ShaderMaterial({
      uniforms: waterUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform float uNight;
        uniform float uDusk;
        varying vec3 vWorld;
        varying vec2 vUv;

        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
                     mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
        }

        void main() {
          // 水一直在沸：慢波纹 + 从池心荡开的水花
          float n1 = vn(vWorld.xz * 1.5 + vec2(uTime * 0.3, uTime * 0.21));
          float n2 = vn(vWorld.xz * 3.4 - vec2(uTime * 0.44, uTime * 0.35));
          float ripple = sin(length(vUv - 0.5) * 34.0 - uTime * 2.4) * 0.5 + 0.5;
          float foam = smoothstep(0.52, 0.92, n1 * 0.62 + n2 * 0.38);

          vec3 deep = vec3(0.055, 0.20, 0.20);
          vec3 shallow = vec3(0.14, 0.46, 0.42);
          vec3 col = mix(deep, shallow, foam * 0.7 + n1 * 0.3);
          col += vec3(0.10, 0.20, 0.17) * ripple * foam * 0.7;

          // 天光、太阳、以及白天也看得见的一层水汽白
          col += uSunColor * 0.18 * (0.4 + 0.6 * uDusk);
          col += uSkyColor * 0.12;
          col = mix(col, vec3(0.72, 0.82, 0.80), foam * 0.35);

          // 夜里水是唯一的暖：绿光往上一浮
          col = mix(col, col * 1.6 + vec3(0.03, 0.10, 0.09), uNight * 0.45);

          // 边缘化开：水贴着石沿，不能是一个蓝色圆盘
          float rr = length(vUv - 0.5) * 2.0;
          float edge = smoothstep(1.0, 0.82, rr);
          float a = (0.78 + foam * 0.22) * edge;
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.position.y = 0.28;
    water.renderOrder = 2;
    g.add(water);
    springWater = waterUniforms;

    // 池底：暗色圆盘，水才有深浅
    const bed = new THREE.Mesh(
      new THREE.CircleGeometry(SPRING.r + 0.1, 32),
      new THREE.MeshStandardMaterial({ color: 0x233432, roughness: 1 })
    );
    bed.rotation.x = -Math.PI / 2;
    bed.position.y = 0.18;
    g.add(bed);

    // 两点暖光：夜里池子是雪原上最暖的地方
    const lamp = new THREE.PointLight(0x7fe0c8, 0, 12, 2);
    lamp.position.set(0, 1.2, 0);
    g.add(lamp);
    springLight = lamp;

    // 两条长凳
    for (const s2 of [-1, 1]) {
      const bench = new THREE.Group();
      const seat = box(2.2, 0.14, 0.55, woodMat(0x6a4a31), 0, 0.52, 0);
      bench.add(seat);
      for (const lx of [-0.8, 0.8]) {
        bench.add(box(0.16, 0.5, 0.16, woodMat(0x4d3524), lx, 0.26, 0));
      }
      bench.position.set(s2 * (SPRING.r + 2.4), 0, s2 * 1.6);
      bench.rotation.y = s2 * 1.2;
      g.add(bench);
    }

    // 蒸汽：贴着水面往上冒，越往上越散
    const steamGeo = new THREE.BufferGeometry();
    const steamCount = 140;
    const steamPos = new Float32Array(steamCount * 3);
    const steamSeed = new Float32Array(steamCount);
    const rand = (() => { let a = 7; return () => (a = (a * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < steamCount; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * (SPRING.r - 0.4);
      steamPos[i * 3] = Math.cos(a) * r;
      steamPos[i * 3 + 1] = rand() * 2.6;
      steamPos[i * 3 + 2] = Math.sin(a) * r;
      steamSeed[i] = rand() * Math.PI * 2;
    }
    steamGeo.setAttribute('position', new THREE.BufferAttribute(steamPos, 3));
    const steamMat = new THREE.PointsMaterial({
      size: 1.6,
      map: softTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.3,
      color: 0xf2fbff,
      sizeAttenuation: true,
    });
    const steam = new THREE.Points(steamGeo, steamMat);
    steam.frustumCulled = false;
    g.add(steam);
    steamPuffs.push({ points: steam, geo: steamGeo, count: steamCount, seeds: steamSeed, mat: steamMat });

    group.add(g);
    tips.push({
      id: 'spring',
      key: 'spring',
      x: SPRING.x,
      z: SPRING.z + SPRING.r + 1.6,
      r: 5.6,
      label: () => '坐到水里泡一会儿',
      sub: '水是热的，雪落在水面上就化了',
    });
  }

  /* =========================================================
     3. 冰钓小屋：冰面上一个钓鱼的小棚子
     ========================================================= */
  const HUT = { x: 46, z: 332, yaw: -0.5 };
  {
    const g = new THREE.Group();
    g.position.set(HUT.x, ICE.level + 0.02, HUT.z);
    g.rotation.y = HUT.yaw;

    const wall = woodMat(0x6b503a);
    const dark = woodMat(0x46332a);
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xeef4fa, roughness: 0.95 });

    g.add(box(2.6, 2.2, 2.4, wall, 0, 1.1, 0));
    // 门洞（一块木板掩着）
    g.add(box(1.0, 1.8, 0.1, dark, -0.55, 0.9, 1.24));
    // 屋顶
    const roof = box(3.0, 0.16, 2.8, dark, 0, 2.3, 0);
    roof.rotation.x = 0.08;
    g.add(roof);
    g.add(box(3.05, 0.2, 2.85, snowMat, 0, 2.42, 0));
    // 门口挂的鱼
    for (let i = 0; i < 3; i++) {
      const fish = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x9fb2bd, roughness: 0.7 })
      );
      fish.scale.set(0.5, 0.45, 1.5);
      fish.position.set(1.15, 1.7 - i * 0.4, 1.22);
      g.add(fish);
    }

    // 冰洞：一个黑窟窿，边上一圈碎冰
    const hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0x081420 })
    );
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(2.1, 0.03, 1.1);
    g.add(hole);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const chip = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: 0xdcecf8, roughness: 0.6 }));
      chip.position.set(2.1 + Math.cos(a) * 0.55, 0.06, 1.1 + Math.sin(a) * 0.55);
      chip.scale.y = 0.5;
      g.add(chip);
    }
    // 钓竿
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 2.2, 5), dark);
    rod.position.set(2.35, 1.1, 1.35);
    rod.rotation.set(0.35, 0, -0.5);
    g.add(rod);
    // 小桶
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.2, 0.36, 10), new THREE.MeshStandardMaterial({ color: 0x7d8b93, roughness: 0.6, metalness: 0.3 }));
    bucket.position.set(1.35, 0.18, 1.5);
    g.add(bucket);

    group.add(g);
    tips.push({
      id: 'fishing',
      key: 'fishing',
      x: HUT.x + 2.1,
      z: HUT.z + 1.1,
      r: 2.0,
      label: () => '守着冰洞钓一会儿',
      sub: '冰下的水黑得像墨',
    });
  }

  /* =========================================================
     4. 雪人：三个，各有各的表情
     ========================================================= */
  const SNOWMEN = [
    { x: 25, z: -17, s: 1.0, scarf: 0xc0392b },
    { x: -12, z: 46, s: 0.85, scarf: 0x2f6f8f },
    { x: 18, z: 206, s: 1.1, scarf: 0x7a5230 },
  ];
  {
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xdfe8f2, roughness: 1 });
    const coal = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 1 });
    const carrot = new THREE.MeshStandardMaterial({ color: 0xd97b2a, roughness: 0.8 });
    for (const sm of SNOWMEN) {
      const y = heightAt(sm.x, sm.z);
      const g = new THREE.Group();
      g.position.set(sm.x, y, sm.z);
      g.scale.setScalar(sm.s);

      const b1 = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 12), snowMat);
      b1.position.y = 0.55;
      b1.scale.y = 1.05;
      g.add(b1);
      const b2 = new THREE.Mesh(new THREE.SphereGeometry(0.44, 14, 12), snowMat);
      b2.position.y = 1.34;
      g.add(b2);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 14, 12), snowMat);
      head.position.y = 1.86;
      g.add(head);

      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), coal);
        eye.position.set(s * 0.11, 1.93, 0.26);
        g.add(eye);
      }
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 7), carrot);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 1.86, 0.34);
      g.add(nose);
      // 树枝手臂
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.8, 5), woodMat(0x4a3323));
        arm.position.set(s * 0.62, 1.42, 0);
        arm.rotation.z = s * 1.15;
        arm.rotation.x = 0.2;
        g.add(arm);
      }
      // 围巾
      const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.075, 6, 14), new THREE.MeshStandardMaterial({ color: sm.scarf, roughness: 1 }));
      scarf.rotation.x = Math.PI / 2;
      scarf.position.y = 1.62;
      g.add(scarf);
      // 扣子
      for (let i = 0; i < 3; i++) {
        const btn = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), coal);
        btn.position.set(0, 1.32 - i * 0.24, 0.4 + i * 0.03);
        g.add(btn);
      }
      // 头顶的雪
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), snowMat);
      cap.scale.set(1.05, 0.4, 1.05);
      cap.position.y = 2.1;
      g.add(cap);

      group.add(g);
      tips.push({
        id: 'snowman',
        key: `snowman-${sm.x}`,
        x: sm.x,
        z: sm.z,
        r: 1.7,
        label: () => '拍拍雪人的脑袋',
        sub: '它站了一整个冬天',
      });
    }
  }

  /* =========================================================
     5. 雪橇：门口停着一架，随时可以拖出去
     ========================================================= */
  {
    const y0 = heightAt(9.5, -27.5);
    const g = new THREE.Group();
    g.position.set(9.5, y0, -27.5);
    g.rotation.y = -0.5;
    const sledWood = woodMat(0x8a6242);
    const runner = new THREE.MeshStandardMaterial({ color: 0x40393a, roughness: 0.4, metalness: 0.5 });
    for (const s of [-1, 1]) {
      const r = box(0.08, 0.07, 2.0, runner, s * 0.34, 0.08, 0);
      g.add(r);
      const curve = box(0.08, 0.07, 0.36, runner, s * 0.34, 0.2, 1.06);
      curve.rotation.x = -0.5;
      g.add(curve);
      g.add(box(0.06, 0.26, 0.06, sledWood, s * 0.34, 0.24, -0.85));
      g.add(box(0.06, 0.26, 0.06, sledWood, s * 0.34, 0.24, 0.8));
    }
    for (let i = 0; i < 6; i++) {
      g.add(box(0.86, 0.06, 0.13, sledWood, 0, 0.31, -0.75 + i * 0.3));
    }
    // 一条毯子
    const blanket = box(0.8, 0.08, 0.9, new THREE.MeshStandardMaterial({ color: 0x8f3a34, roughness: 1 }), 0, 0.36, -0.15);
    g.add(blanket);
    group.add(g);
    tips.push({
      id: 'sled',
      key: 'sled',
      x: 9.5,
      z: -27.5,
      r: 1.8,
      label: () => '坐上雪橇',
      sub: '从坡上滑下去，风会灌进衣领',
    });
  }

  /* =========================================================
     6. 冰柱：湖岸和石头底下挂着的冰锥
     ========================================================= */
  {
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xcfe6f6,
      roughness: 0.15,
      metalness: 0.05,
      transparent: true,
      opacity: 0.82,
      envMapIntensity: 1.4,
    });
    const cone = new THREE.ConeGeometry(0.09, 0.9, 6);
    const spots = [
      [-24, 196], [30, 190], [-56, 210], [66, 214], [-8, 402], [40, 410], [-40, 400],
    ];
    const dummy = new THREE.Object3D();
    const total = spots.length * 9;
    const mesh = new THREE.InstancedMesh(cone, iceMat, total);
    let n = 0;
    for (const [sx, sz] of spots) {
      const gy = heightAt(sx, sz);
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), new THREE.MeshStandardMaterial({ color: 0x67645e, roughness: 1, flatShading: true }));
      rock.position.set(sx, gy + 0.5, sz);
      rock.scale.set(1.4, 0.9, 1.2);
      rock.rotation.set(sx * 0.01, sx, 0.3);
      rock.castShadow = true;
      group.add(rock);
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const rr = 1.1 + (i % 3) * 0.18;
        dummy.position.set(sx + Math.cos(a) * rr, gy + 0.62, sz + Math.sin(a) * rr);
        dummy.rotation.set(Math.PI + (i % 3 - 1) * 0.08, a, 0);
        const s = 0.55 + ((i * 13) % 10) / 12;
        dummy.scale.set(s, s * (1.1 + (i % 4) * 0.25), s);
        dummy.updateMatrix();
        mesh.setMatrixAt(n++, dummy.matrix);
      }
    }
    mesh.count = n;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    group.add(mesh);
  }

  /* =========================================================
     7. 白狐：雪地里跑来跑去的小东西
     ========================================================= */
  const foxes = [];
  {
    const furMat = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.9 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.6 });
    const homes = [
      { x: 34, z: -8, r: 16 },
      { x: -30, z: 120, r: 18 },
      { x: 62, z: 260, r: 22 },
      { x: -10, z: -74, r: 14 },
    ];
    const rand = (() => { let a = 991; return () => (a = (a * 48271) % 2147483647) / 2147483647; })();
    for (const h of homes) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 9), furMat);
      body.scale.set(1.0, 0.8, 1.9);
      body.position.y = 0.34;
      body.castShadow = true;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 9), furMat);
      head.position.set(0, 0.46, 0.5);
      head.scale.set(0.95, 0.9, 1.1);
      g.add(head);
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 8), furMat);
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, 0.42, 0.72);
      g.add(snout);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), noseMat);
      nose.position.set(0, 0.42, 0.85);
      g.add(nose);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 6), furMat);
        ear.position.set(s * 0.1, 0.62, 0.46);
        ear.rotation.z = s * 0.18;
        g.add(ear);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), noseMat);
        eye.position.set(s * 0.075, 0.49, 0.66);
        g.add(eye);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.72, 8), furMat);
      tail.rotation.x = -1.15;
      tail.position.set(0, 0.4, -0.86);
      g.add(tail);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), darkMat);
      tip.position.set(0, 0.62, -1.08);
      g.add(tip);
      const legs = [];
      for (const [lx, lz] of [[-0.16, 0.28], [0.16, 0.28], [-0.16, -0.3], [0.16, -0.3]]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.26, 6), furMat);
        leg.position.set(lx, 0.13, lz);
        g.add(leg);
        legs.push(leg);
      }
      const y = heightAt(h.x, h.z);
      g.position.set(h.x, y, h.z);
      group.add(g);
      foxes.push({
        g, legs, home: h,
        target: new THREE.Vector2(h.x, h.z),
        speed: 0.9 + rand() * 0.6,
        phase: rand() * Math.PI * 2,
        wait: rand() * 3,
        yaw: rand() * Math.PI * 2,
      });
    }
  }

  /* =========================================================
     8. 冰洞：湖西岸一座能走进去的冰洞
     ========================================================= */
  const CAVE = { x: -98, z: 392, yaw: 0.35 };
  {
    const cy = heightAt(CAVE.x, CAVE.z);
    const g = new THREE.Group();
    g.position.set(CAVE.x, cy, CAVE.z);
    g.rotation.y = CAVE.yaw;

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x55524d, roughness: 1, flatShading: true });
    const rockMat2 = new THREE.MeshStandardMaterial({ color: 0x46433f, roughness: 1, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xe6eef6, roughness: 1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x121a22, roughness: 1, metalness: 0 });
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xbfe0f2, roughness: 0.12, metalness: 0.05,
      transparent: true, opacity: 0.8, envMapIntensity: 1.6,
    });

    // 岩丘：一整块被雪盖住的山包，不是一堆散石
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), rockMat);
    hill.scale.set(7.2, 3.4, 6.4);
    hill.position.set(0, -0.6, -0.8);
    hill.castShadow = true;
    hill.receiveShadow = true;
    g.add(hill);
    const hillSnow = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshStandardMaterial({ color: 0xd8e3ee, roughness: 1 }));
    hillSnow.scale.set(6.9, 1.35, 6.1);
    hillSnow.position.set(0, 2.15, -0.9);
    g.add(hillSnow);
    // 几块露出雪面的石头，打碎轮廓
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.4;
      if (Math.abs(a - Math.PI / 2) < 0.8) continue;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), i % 2 ? rockMat : rockMat2);
      const sc = 1.2 + (i % 3) * 0.5;
      rock.scale.set(sc, sc * 0.85, sc * 0.9);
      rock.position.set(Math.cos(a) * 5.4, 0.2, Math.sin(a) * 4.9 - 0.6);
      rock.rotation.set(i, i * 1.7, i * 0.4);
      rock.castShadow = true;
      g.add(rock);
    }

    // 门洞：一条真正的通道 —— 两侧墙 + 顶 + 地面 + 尽头堵死
    const portal = new THREE.Group();
    portal.position.set(0, 0, 4.4);
    const wallL = box(0.6, 3.2, 4.4, darkMat, -1.55, 1.6, -1.9);
    const wallR = box(0.6, 3.2, 4.4, darkMat, 1.55, 1.6, -1.9);
    const roof = box(3.7, 0.6, 4.4, darkMat, 0, 3.0, -1.9);
    const back = box(3.4, 3.2, 0.5, darkMat, 0, 1.6, -4.0);
    for (const m of [wallL, wallR, roof, back]) portal.add(m);
    // 通道的地面：冰
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 4.2), iceMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0.06, -1.9);
    portal.add(floor);
    // 门框：石头包一圈，进门才不突兀
    const pillarGeo = new THREE.IcosahedronGeometry(1, 0);
    for (const s2 of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const rock = new THREE.Mesh(pillarGeo, k ? rockMat2 : rockMat);
        rock.scale.set(1.05, 1.5, 1.0);
        rock.position.set(s2 * 1.9, 0.6 + k * 1.5, 0.2);
        rock.rotation.set(k, s2 * k, k * 0.5);
        rock.castShadow = true;
        portal.add(rock);
      }
    }
    const arch = new THREE.Mesh(pillarGeo, rockMat);
    arch.scale.set(2.6, 0.8, 1.1);
    arch.position.set(0, 3.3, 0.2);
    arch.rotation.set(0.25, 0.3, 0.05);
    arch.castShadow = true;
    portal.add(arch);
    g.add(portal);

    // 洞里的冰柱
    const icicle = new THREE.ConeGeometry(0.08, 0.8, 6);
    const hang = new THREE.InstancedMesh(icicle, iceMat, 22);
    const dm = new THREE.Object3D();
    let hn = 0;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 * 1.6;
      dm.position.set(Math.cos(a) * (0.5 + (i % 4) * 0.28), 2.75 + (i % 3) * 0.1, 2.9 - (i % 5) * 0.8);
      dm.rotation.set(Math.PI, a, 0);
      const sc = 0.7 + (i % 4) * 0.3;
      dm.scale.set(sc, sc * (0.8 + (i % 3) * 0.3), sc);
      dm.updateMatrix();
      hang.setMatrixAt(hn++, dm.matrix);
    }
    hang.count = hn;
    g.add(hang);

    // 深处的冰晶：洞里唯一的光源
    const crystalMat = new THREE.MeshStandardMaterial({
      color: 0x9fe8ff, emissive: new THREE.Color(0x54c8e8), emissiveIntensity: 1.8, roughness: 0.2,
    });
    for (let i = 0; i < 4; i++) {
      const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), crystalMat);
      cr.position.set(-1.0 + i * 0.66, 0.5, 1.2 - (i % 2) * 0.7);
      cr.scale.y = 1.9;
      cr.rotation.y = i * 1.3;
      g.add(cr);
    }
    const caveLight = new THREE.PointLight(0x7fe0ff, 1.7, 12, 2);
    caveLight.position.set(0, 1.9, 1.8);
    g.add(caveLight);
    clockLights.push({ light: caveLight, base: 1.6, lamp: null });

    // 门口踩出来的脚印
    for (let i = 0; i < 6; i++) {
      const step = new THREE.Mesh(
        new THREE.CircleGeometry(0.42 - i * 0.03, 10),
        new THREE.MeshStandardMaterial({ color: 0xd2dfeb, roughness: 1 })
      );
      step.rotation.x = -Math.PI / 2;
      step.position.set((i % 2 ? 0.3 : -0.28), 0.02, 6.0 + i * 1.1);
      g.add(step);
    }

    group.add(g);
    tips.push({
      id: 'cave',
      key: 'cave',
      x: CAVE.x + Math.sin(CAVE.yaw) * 6.4,
      z: CAVE.z + Math.cos(CAVE.yaw) * 6.4,
      r: 2.8,
      label: () => '走进冰洞',
      sub: '里面比外面安静得多',
    });
  }

  /* =========================================================
     9. 营火：猎屋旁边的一堆火
     ========================================================= */
  const FIRE = { x: 11.5, z: -20.5 };
  const fireParts = [];
  {
    const fy = heightAt(FIRE.x, FIRE.z);
    const g = new THREE.Group();
    g.position.set(FIRE.x, fy, FIRE.z);

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5c5851, roughness: 1, flatShading: true });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const rock = new THREE.Mesh(rockGeo, stoneMat);
      const s2 = 0.2 + ((i * 31) % 10) / 60;
      rock.scale.set(s2, s2 * 0.6, s2);
      rock.position.set(Math.cos(a) * 1.15, s2 * 0.3, Math.sin(a) * 1.15);
      rock.rotation.set(i, i * 2, 0);
      rock.castShadow = true;
      g.add(rock);
    }
    // 交叉的柴
    for (let i = 0; i < 5; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.35, 6), woodMat(0x3e2a1d));
      log.position.set(0, 0.2, 0);
      log.rotation.set(Math.PI / 2 - 0.35, (i / 5) * Math.PI * 2, 0);
      log.castShadow = true;
      g.add(log);
    }
    // 火：三层锥体叠在一起，加法混合
    const flameMats = [
      new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xffb24a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
    ];
    for (let i = 0; i < 3; i++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.1, 0.9 - i * 0.18, 8), flameMats[i]);
      cone.position.set((i - 1) * 0.08, 0.62 + i * 0.04, (i % 2) * 0.06);
      g.add(cone);
      fireParts.push({ mesh: cone, phase: i * 1.7, base: 1 - i * 0.12 });
    }
    const fireLight = new THREE.PointLight(0xff9a4a, 1.4, 14, 2);
    fireLight.position.set(0, 1.1, 0);
    g.add(fireLight);
    clockLights.push({ light: fireLight, base: 1.6, lamp: null });

    // 两根坐人的圆木
    for (const s2 of [-1, 1]) {
      const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.6, 8), woodMat(0x5a3f2b));
      seat.rotation.z = Math.PI / 2;
      seat.rotation.y = s2 * 0.4;
      seat.position.set(s2 * 1.9, 0.24, s2 * 0.6);
      seat.castShadow = true;
      g.add(seat);
    }

    group.add(g);
    tips.push({
      id: 'fire',
      key: 'fire',
      x: FIRE.x,
      z: FIRE.z,
      r: 2.4,
      label: () => '在火边烤烤手',
      sub: '柴是干的，火一直没灭',
    });
  }

  /* =========================================================
     10. 路标石堆 + 倒木：让雪原不那么空
     ========================================================= */
  {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x67635c, roughness: 1, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xeef4fa, roughness: 0.95 });
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    // 沿着去冰湖的雪道，每隔几十米垒一堆
    const path = [[-3, 44], [-9, 82], [-11, 120], [-8, 156], [-3, 184]];
    for (const [px, pz] of path) {
      const y = heightAt(px + 2.2, pz + 1.2);
      const g = new THREE.Group();
      g.position.set(px + 2.2, y, pz + 1.2);
      let hh = 0;
      for (let i = 0; i < 4; i++) {
        const s2 = 0.42 - i * 0.075;
        const rock = new THREE.Mesh(rockGeo, stoneMat);
        rock.scale.set(s2 * 1.2, s2 * 0.7, s2);
        rock.position.y = hh + s2 * 0.32;
        rock.rotation.set(i * 1.1, i * 2.1, i * 0.4);
        rock.castShadow = true;
        g.add(rock);
        // 顶上一小撮雪
        if (i === 3) {
          const cap = new THREE.Mesh(rockGeo, snowMat);
          cap.scale.set(s2 * 1.05, s2 * 0.35, s2 * 0.9);
          cap.position.y = hh + s2 * 0.62;
          g.add(cap);
        }
        hh += s2 * 0.55;
      }
      group.add(g);
    }
  }

  {
    // 倒木与树桩：松林边缘的旧痕迹
    const barkMat = new THREE.MeshStandardMaterial({ color: 0x4b3a2a, roughness: 1 });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xeef4fa, roughness: 0.95 });
    const logs = [
      { x: 58, z: -84, yaw: 0.7, len: 3.4 },
      { x: -62, z: 128, yaw: -1.1, len: 2.8 },
      { x: 92, z: 214, yaw: 0.2, len: 3.9 },
      { x: -120, z: 260, yaw: 1.4, len: 3.1 },
      { x: 30, z: 470, yaw: -0.6, len: 2.6 },
      { x: -150, z: -20, yaw: 0.9, len: 3.6 },
    ];
    for (const L of logs) {
      const y = heightAt(L.x, L.z);
      const g = new THREE.Group();
      g.position.set(L.x, y, L.z);
      g.rotation.y = L.yaw;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, L.len, 8), barkMat);
      trunk.rotation.z = Math.PI / 2;
      trunk.position.y = 0.3;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      g.add(trunk);
      // 沿树干的一道雪
      const strip = new THREE.Mesh(new THREE.BoxGeometry(L.len * 0.94, 0.08, 0.3), snowMat);
      strip.position.set(0, 0.52, 0);
      g.add(strip);
      // 断口
      const cut = new THREE.Mesh(new THREE.CircleGeometry(0.24, 8), new THREE.MeshStandardMaterial({ color: 0xa78a63, roughness: 1 }));
      cut.rotation.y = Math.PI / 2;
      cut.position.set(L.len * 0.5, 0.3, 0);
      g.add(cut);
      group.add(g);
    }
    for (const S of [{ x: 46, z: -60 }, { x: -80, z: 180 }, { x: 118, z: 300 }, { x: -40, z: -120 }]) {
      const y = heightAt(S.x, S.z);
      const g = new THREE.Group();
      g.position.set(S.x, y, S.z);
      const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.7, 9), barkMat);
      stump.position.y = 0.35;
      stump.castShadow = true;
      g.add(stump);
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.4, 9), new THREE.MeshStandardMaterial({ color: 0xa78a63, roughness: 1 }));
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.71;
      g.add(top);
      group.add(g);
    }
  }

  /* =========================================================
     11. 冰脊：湖面上被挤出来的碎冰
     ========================================================= */
  {
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0xd6ecfa,
      roughness: 0.18,
      metalness: 0.02,
      transparent: true,
      opacity: 0.85,
      flatShading: true,
      envMapIntensity: 1.3,
    });
    const shardGeo = new THREE.ConeGeometry(0.5, 1.5, 5);
    const count = 150;
    const mesh = new THREE.InstancedMesh(shardGeo, shardMat, count);
    const dm = new THREE.Object3D();
    let n2 = 0;
    for (let i = 0; i < count; i++) {
      // 只在冰面上，避开钓鱼屋
      const a = (i * 2.399) % (Math.PI * 2);
      const r = Math.sqrt((i % 97) / 97) * (ICE.r * 0.95);
      const x = ICE.x + Math.cos(a) * r;
      const z = ICE.z + Math.sin(a) * r * 0.94;
      if (iceDist(x, z) > 0.96) continue;
      if (Math.hypot(x - HUT.x, z - HUT.z) < 6) continue;
      dm.position.set(x, ICE.level - 0.28, z);
      dm.rotation.set((i % 5 - 2) * 0.18, i * 1.7, (i % 7 - 3) * 0.14);
      const sc = 0.35 + ((i * 29) % 10) / 12;
      dm.scale.set(sc, sc * (1.1 + (i % 4) * 0.35), sc);
      dm.updateMatrix();
      mesh.setMatrixAt(n2++, dm.matrix);
    }
    mesh.count = n2;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  /* =========================================================
     更新：蒸汽、炊烟、灯火、狐狸
     ========================================================= */
  function update(t, dt, ctx) {
    const night = ctx && typeof ctx.night === 'number' ? ctx.night : 0;

    // 蒸汽往上飘，越飘越淡
    for (const s of steamPuffs) {
      const arr = s.geo.attributes.position.array;
      for (let i = 0; i < s.count; i++) {
        const ix = i * 3;
        arr[ix + 1] += (0.5 + Math.sin(t * 0.6 + s.seeds[i]) * 0.12) * dt;
        arr[ix] += Math.sin(t * 0.5 + s.seeds[i]) * 0.08 * dt;
        arr[ix + 2] += Math.cos(t * 0.43 + s.seeds[i] * 1.3) * 0.07 * dt;
        if (arr[ix + 1] > 3.3) {
          const a = s.seeds[i] * 7.3;
          const r = Math.sqrt((s.seeds[i] * 13.7) % 1) * 3.6;
          arr[ix] = Math.cos(a) * r;
          arr[ix + 1] = 0.15;
          arr[ix + 2] = Math.sin(a) * r;
        }
      }
      s.geo.attributes.position.needsUpdate = true;
      s.mat.opacity = 0.2 + 0.16 * (1 - night * 0.35);
    }

    // 门
    for (const d of doors) {
      d.pivot.rotation.y += (d.target - d.pivot.rotation.y) * Math.min(1, dt * 6);
    }

    // 马灯：夜里亮，白天收
    for (const l of clockLights) {
      const k = 0.15 + night * 0.95;
      l.light.intensity = l.base * k * (1 + Math.sin(t * 2.3) * 0.03 + Math.sin(t * 7.1) * 0.02);
      if (l.lamp && l.lamp.material) l.lamp.material.emissiveIntensity = 0.5 + night * 2.4;
    }

    // 白狐：走走停停，走的时候四条腿轮流点地
    for (const f of foxes) {
      if (f.wait > 0) {
        f.wait -= dt;
        const bob = Math.sin(t * 1.6 + f.phase) * 0.004;
        f.g.position.y = heightAt(f.g.position.x, f.g.position.z) + Math.max(0, bob);
        for (const leg of f.legs) leg.rotation.x *= 0.85;
      } else {
        const dx = f.target.x - f.g.position.x;
        const dz = f.target.y - f.g.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) {
          f.wait = 1.5 + Math.random() * 4;
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * f.home.r;
          f.target.set(f.home.x + Math.cos(a) * r, f.home.z + Math.sin(a) * r);
        } else {
          const step = Math.min(d, f.speed * dt);
          const nx = f.g.position.x + (dx / d) * step;
          const nz = f.g.position.z + (dz / d) * step;
          f.g.position.set(nx, heightAt(nx, nz), nz);
          const want = Math.atan2(dx, dz);
          let diff = want - f.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          f.yaw += diff * Math.min(1, dt * 5);
          f.g.rotation.y = f.yaw;
          const gait = Math.sin(t * 9 + f.phase);
          f.legs[0].rotation.x = gait * 0.6;
          f.legs[3].rotation.x = gait * 0.6;
          f.legs[1].rotation.x = -gait * 0.6;
          f.legs[2].rotation.x = -gait * 0.6;
          f.g.position.y += Math.abs(Math.sin(t * 9 + f.phase)) * 0.02;
        }
      }
    }

    if (springLight) {
      springLight.intensity = night * 2.4 + 0.15;
    }

    // 火苗：三层锥体各自抖，越里面越稳
    for (const f of fireParts) {
      const k = 1 + Math.sin(t * 9.3 + f.phase) * 0.08 + Math.sin(t * 21.7 + f.phase * 2) * 0.04;
      f.mesh.scale.set(f.base * (1 + Math.sin(t * 7.1 + f.phase) * 0.05), k, f.base);
      f.mesh.rotation.y = t * 1.6 + f.phase;
    }

    if (springWater) {
      springWater.uTime.value = t;
      springWater.uNight.value = night;
      springWater.uDusk.value = ctx && ctx.dusk ? ctx.dusk : 0;
      if (ctx && ctx.sun) springWater.uSunColor.value.copy(ctx.sun);
      if (ctx && ctx.sky) springWater.uSkyColor.value.copy(ctx.sky);
    }
  }

  /* 交互提示：返回 { key, id, html } 或 null */
  function prompt(player) {
    for (const tp of tips) {
      const d = Math.hypot(player.x - tp.x, player.z - tp.z);
      if (d < tp.r) {
        return {
          id: tp.id,
          key: tp.key,
          html: `<span class="key">E</span><span>${tp.label()}</span><span class="sub">${tp.sub}</span>`,
        };
      }
    }
    return null;
  }

  /* 按 E：返回一句 toast，或 null */
  function interact(player) {
    for (const tp of tips) {
      const d = Math.hypot(player.x - tp.x, player.z - tp.z);
      if (d >= tp.r) continue;
      if (tp.id === 'door') {
        const d0 = doors[0];
        d0.open = !d0.open;
        d0.target = d0.open ? -1.25 : 0;
        return d0.open ? '屋里的热气扑出来，炉子上坐着水。' : '把门带上了。';
      }
      if (tp.id === 'spring') return '__soak__';
      if (tp.id === 'fishing') return Math.random() < 0.35 ? '拎上来一条小的，冰面上蹦了两下。' : '守了很久，鱼线一动没动。';
      if (tp.id === 'sled') return '坐上去，腿一蹬，雪从滑板底下唰地散开。';
      if (tp.id === 'snowman') return '把雪人歪掉的脑袋扶正了一点。';
      if (tp.id === 'cave') return '洞里挂满了冰，呼吸的声音在石壁上来回撞。';
      if (tp.id === 'fire') return '火苗舔着柴，手心一下就暖了。';
      return null;
    }
    return null;
  }

  return { group, update, prompt, interact, CABIN, SPRING, HUT };
}
