/* =========================================================
   tractor.js — 草原上的拖拉机
   一辆红色的老拖拉机：大后轮、小前轮、铁皮车篷、排气管。
   按 E 上车，W/S 油门，A/D 转向，鼠标转视角，E 下车。
   车轮会跟着速度转，车身会顺着地形俯仰。
   ========================================================= */

import * as THREE from 'three';

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function createTractor(scene, { heightAt }) {
  const RED = 0xb5372c;
  const RED_DARK = 0x8e2a22;
  const STEEL = 0x3a3a3c;
  const TIRE = 0x1d1d1f;
  const CANVAS = 0x8d8578;

  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.18 });
  const rubber = new THREE.MeshStandardMaterial({ color: TIRE, roughness: 0.95, metalness: 0 });

  const group = new THREE.Group();
  const chassis = new THREE.Group();
  // 模型是按"车头朝 +z"搭的，但移动约定是朝 -z：整台车体转 180°
  chassis.rotation.y = Math.PI;
  group.add(chassis);

  /* ---- 车轮 ---- */
  function makeWheel(radius, width, lugs = 10) {
    const g = new THREE.Group();
    const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 18, 1);
    tireGeo.rotateZ(Math.PI / 2);
    const tire = new THREE.Mesh(tireGeo, rubber);
    tire.castShadow = true;
    g.add(tire);

    // 胎纹：一圈小块，转起来看得出在转
    const lugGeo = new THREE.BoxGeometry(width * 0.9, radius * 0.16, radius * 0.22);
    for (let i = 0; i < lugs; i++) {
      const a = (i / lugs) * Math.PI * 2;
      const lug = new THREE.Mesh(lugGeo, rubber);
      lug.position.set(0, Math.cos(a) * radius * 0.94, Math.sin(a) * radius * 0.94);
      lug.rotation.x = -a;
      g.add(lug);
    }
    // 轮毂
    const hubGeo = new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, width * 1.02, 10);
    hubGeo.rotateZ(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, metal);
    paint(hubGeo, 0xcbb37a);
    g.add(hub);
    // 辐条
    for (let i = 0; i < 4; i++) {
      const spokeGeo = new THREE.BoxGeometry(width * 1.04, radius * 0.5, radius * 0.1);
      const spoke = new THREE.Mesh(spokeGeo, metal);
      paint(spokeGeo, 0xb89a5f);
      spoke.rotation.x = (i / 4) * Math.PI;
      g.add(spoke);
    }
    return g;
  }

  const wheelRL = makeWheel(0.66, 0.36);
  const wheelRR = makeWheel(0.66, 0.36);
  wheelRL.position.set(-0.82, 0.66, -0.62);
  wheelRR.position.set(0.82, 0.66, -0.62);
  chassis.add(wheelRL, wheelRR);

  const hubFL = new THREE.Group();
  const hubFR = new THREE.Group();
  const wheelFL = makeWheel(0.38, 0.24, 8);
  const wheelFR = makeWheel(0.38, 0.24, 8);
  hubFL.add(wheelFL);
  hubFR.add(wheelFR);
  hubFL.position.set(-0.62, 0.38, 0.92);
  hubFR.position.set(0.62, 0.38, 0.92);
  chassis.add(hubFL, hubFR);

  /* ---- 车体 ---- */
  const parts = [];
  const add = (geo, hex, x, y, z) => {
    paint(geo, hex);
    geo.translate(x, y, z);
    parts.push(geo);
  };

  // 底盘梁
  add(new THREE.BoxGeometry(1.3, 0.26, 2.3), STEEL, 0, 0.62, 0.05);
  // 机头
  add(new THREE.BoxGeometry(0.98, 0.62, 1.15), RED, 0, 1.02, 0.62);
  // 机头前的散热格栅
  add(new THREE.BoxGeometry(0.86, 0.44, 0.1), STEEL, 0, 1.0, 1.2);
  // 发动机上盖
  add(new THREE.BoxGeometry(0.8, 0.12, 0.9), RED_DARK, 0, 1.36, 0.62);
  // 挡泥板（后轮上方）
  add(new THREE.BoxGeometry(0.34, 0.3, 1.05), RED, -0.86, 1.3, -0.62);
  add(new THREE.BoxGeometry(0.34, 0.3, 1.05), RED, 0.86, 1.3, -0.62);
  // 座舱地板
  add(new THREE.BoxGeometry(1.0, 0.14, 0.9), STEEL, 0, 1.02, -0.45);
  // 座椅
  add(new THREE.BoxGeometry(0.52, 0.12, 0.5), 0x2f2a24, 0, 1.14, -0.45);
  add(new THREE.BoxGeometry(0.52, 0.5, 0.1), 0x2f2a24, 0, 1.36, -0.7);
  // 方向盘立杆
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.55, 6), STEEL, 0, 1.3, -0.02);
  // 车篷：四根柱 + 顶
  const postGeo = (x, z) => {
    const g = new THREE.CylinderGeometry(0.035, 0.035, 1.15, 6);
    g.translate(x, 1.82, z);
    paint(g, STEEL);
    parts.push(g);
  };
  postGeo(-0.52, -0.78);
  postGeo(0.52, -0.78);
  postGeo(-0.52, 0.08);
  postGeo(0.52, 0.08);
  add(new THREE.BoxGeometry(1.28, 0.08, 1.05), RED, 0, 2.42, -0.36);
  add(new THREE.BoxGeometry(1.3, 0.06, 1.07), CANVAS, 0, 2.47, -0.36);
  // 排气管
  add(new THREE.CylinderGeometry(0.055, 0.055, 0.8, 8), STEEL, 0.34, 1.75, 0.72);
  add(new THREE.CylinderGeometry(0.075, 0.075, 0.08, 8), STEEL, 0.34, 2.16, 0.72);
  // 前灯
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), 0xfff2c0, -0.26, 1.14, 1.22);
  add(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), 0xfff2c0, 0.26, 1.14, 1.22);
  // 尾灯
  add(new THREE.BoxGeometry(0.1, 0.1, 0.06), 0xc23b2a, -0.5, 1.3, -0.95);
  add(new THREE.BoxGeometry(0.1, 0.1, 0.06), 0xc23b2a, 0.5, 1.3, -0.95);

  const bodyGeo = mergeGeos(parts);
  const body = new THREE.Mesh(bodyGeo, metal);
  body.castShadow = true;
  body.receiveShadow = true;
  chassis.add(body);

  /* ---- 车底接触阴影：不然车看着像浮在草上 ---- */
  {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 4.4),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.renderOrder = 2;
    group.add(shadow);
  }

  /* ---- 方向盘 ---- */
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 18), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.8 }));
  wheelRim.position.set(0, 1.52, -0.02);
  wheelRim.rotation.x = 1.15;
  chassis.add(wheelRim);

  /* ---- 前灯的光 ---- */
  const head = new THREE.PointLight(0xffe6b0, 0, 22, 2);
  head.position.set(0, 1.2, 1.5);
  chassis.add(head);

  /* ---- 排气的烟 ---- */
  const smokeTex = (() => {
    const S = 64;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(220,220,215,0.85)');
    g.addColorStop(1, 'rgba(220,220,215,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const PUFF = 26;
  const puffPos = new Float32Array(PUFF * 3);
  const puffAge = new Float32Array(PUFF);
  const puffSeed = new Float32Array(PUFF);
  for (let i = 0; i < PUFF; i++) puffAge[i] = 1;
  const puffGeo = new THREE.BufferGeometry();
  puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPos, 3));
  puffGeo.setAttribute('aAge', new THREE.BufferAttribute(puffAge, 1));
  puffGeo.setAttribute('aSeed', new THREE.BufferAttribute(puffSeed, 1));
  const puffMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: smokeTex } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aAge;
      attribute float aSeed;
      varying float vAge;
      void main() {
        vAge = aAge;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (26.0 + aAge * 60.0) * (1.0 / max(-mv.z, 1.0)) * 60.0;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAge;
      void main() {
        if (vAge > 1.0) discard;
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vec3(0.86, 0.86, 0.84), t.a * (1.0 - vAge) * 0.42);
      }
    `,
  });
  const puffs = new THREE.Points(puffGeo, puffMat);
  puffs.frustumCulled = false;
  scene.add(puffs);

  // 世界坐标的烟（不挂在车上，车走了烟留在原地）
  let puffCursor = 0;
  let puffAcc = 0;

  /* ---- 状态 ---- */
  const state = {
    x: 13.2,
    z: -17.6,
    yaw: Math.PI * 0.99,
    speed: 0,
    steer: 0,
    wheelSpin: 0,
    pitch: 0,
    roll: 0,
  };

  group.position.set(state.x, heightAt(state.x, state.z), state.z);
  group.rotation.order = 'YXZ';
  group.rotation.y = state.yaw;
  scene.add(group);

  function mergeGeos(list) {
    // 简易合并：先统一转成非索引几何，再按顶点拼位置/法线/颜色
    const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let total = 0;
    for (const g of geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    let o = 0;
    for (const gi of geos) {
      const p = gi.attributes.position.array;
      const n = gi.attributes.normal.array;
      const c = gi.attributes.color.array;
      pos.set(p, o * 3);
      nor.set(n, o * 3);
      col.set(c, o * 3);
      o += gi.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }

  /* ---- 每帧 ---- */
  function update(t, dt, input, radius = 1e9) {
    const throttle = input.throttle || 0;
    const steerIn = input.steer || 0;

    // 油门：前进 6 m/s²，倒车 3.2，松开慢慢滑停
    if (throttle > 0) state.speed += 6.2 * dt;
    else if (throttle < 0) state.speed -= 3.2 * dt;
    else state.speed *= Math.exp(-dt * 1.5);

    // 上坡减速，下坡稍微加速
    const fx = -Math.sin(state.yaw);
    const fz = -Math.cos(state.yaw);
    const ahead = heightAt(state.x + fx * 2.2, state.z + fz * 2.2);
    const here = heightAt(state.x, state.z);
    const grade = (ahead - here) / 2.2;
    state.speed -= grade * 3.2 * dt;

    state.speed = Math.max(-4.2, Math.min(input.run ? 13.5 : 9.5, state.speed));

    // 转向：速度越高，方向盘打得越小
    state.steer += (steerIn - state.steer) * Math.min(1, dt * 5);
    const turnRate = 0.9 / (1 + Math.abs(state.speed) * 0.22);
    state.yaw += state.steer * turnRate * (state.speed >= 0 ? 1 : -1) * Math.min(1, Math.abs(state.speed) / 1.6) * dt * Math.abs(state.speed);

    state.x += fx * state.speed * dt;
    state.z += fz * state.speed * dt;

    // 地图边界
    const r = Math.hypot(state.x, state.z);
    if (r > radius) {
      state.x *= radius / r;
      state.z *= radius / r;
      state.speed *= 0.4;
    }

    // 贴地 + 顺坡俯仰
    const y = heightAt(state.x, state.z);
    const hF = heightAt(state.x + fx * 1.3, state.z + fz * 1.3);
    const hB = heightAt(state.x - fx * 1.3, state.z - fz * 1.3);
    const rx = -Math.cos(state.yaw);
    const rz = Math.sin(state.yaw);
    const hR = heightAt(state.x + rx * 0.9, state.z + rz * 0.9);
    const hL = heightAt(state.x - rx * 0.9, state.z - rz * 0.9);
    const pitch = Math.atan2(hF - hB, 2.6);
    const roll = Math.atan2(hR - hL, 1.8);
    state.pitch = pitch;
    state.roll = roll;

    group.position.set(state.x, y + Math.sin(t * 22) * 0.004 * Math.min(1, Math.abs(state.speed)), state.z);
    group.rotation.set(-pitch, state.yaw, roll, 'YXZ');

    // 车轮
    state.wheelSpin += (state.speed / 0.66) * dt;
    wheelRL.rotation.x = state.wheelSpin;
    wheelRR.rotation.x = state.wheelSpin;
    wheelFL.rotation.x = state.wheelSpin * 1.7;
    wheelFR.rotation.x = state.wheelSpin * 1.7;
    hubFL.rotation.y = state.steer * 0.5;
    hubFR.rotation.y = state.steer * 0.5;
    wheelRim.rotation.z = -state.steer * 1.6;

    // 前灯：夜里亮
    head.intensity = (input.night || 0) * 2.2;

    // 排气烟
    puffAcc += Math.abs(state.speed) * dt;
    let emit = puffAcc > 0.9;
    if (emit) puffAcc = 0;
    for (let i = 0; i < PUFF; i++) {
      if (puffAge[i] >= 1) {
        if (emit) {
          puffAge[i] = 0;
          puffSeed[i] = Math.random() * 6.28;
          puffPos[i * 3] = state.x + Math.sin(state.yaw) * 0.34 + fx * 0.72;
          puffPos[i * 3 + 1] = y + 2.2;
          puffPos[i * 3 + 2] = state.z + Math.cos(state.yaw) * 0.34 + fz * 0.72;
          emit = false;
        }
      } else {
        puffAge[i] += dt * 0.5;
        puffPos[i * 3] += Math.sin(t * 0.8 + puffSeed[i]) * 0.12 * dt;
        puffPos[i * 3 + 1] += 0.5 * dt;
        puffPos[i * 3 + 2] += Math.cos(t * 0.7 + puffSeed[i]) * 0.1 * dt;
      }
    }
    puffGeo.attributes.position.needsUpdate = true;
    puffGeo.attributes.aAge.needsUpdate = true;

    return state;
  }

  /* ---- 相机：第三人称追在车后 ---- */
  const camTarget = new THREE.Vector3();
  function placeCamera(camera, orbitYaw, camPitch, t) {
    const yaw = state.yaw + orbitYaw;
    const dist = 6.6;
    const height = 2.9 + camPitch * 2.4;
    const x = state.x + Math.sin(yaw) * dist;
    const z = state.z + Math.cos(yaw) * dist;
    const ground = heightAt(x, z);
    camera.position.set(x, Math.max(ground + 1.2, heightAt(state.x, state.z) + height), z);
    camTarget.set(state.x, heightAt(state.x, state.z) + 1.5 + Math.sin(t * 0.9) * 0.02, state.z);
    camera.lookAt(camTarget);
  }

  function enter() { }
  function exit() { }

  return {
    group,
    state,
    update,
    placeCamera,
    enter,
    exit,
    get x() { return state.x; },
    get z() { return state.z; },
    get speed() { return state.speed; },
    setPos(x, z, yaw) {
      state.x = x;
      state.z = z;
      if (typeof yaw === 'number') state.yaw = yaw;
      state.speed = 0;
      group.position.set(x, heightAt(x, z), z);
    },
  };
}
