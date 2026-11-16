/* =========================================================
   postfx.js — 后处理管线
   RenderPass → Bloom → Grade(色差/暗角/颗粒/日晕) → OutputPass
   全部在 HDR 线性空间里跑，最后由 OutputPass 统一 ACES + sRGB。
   ========================================================= */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.013 },
    uVignette: { value: 1.0 },
    uAberration: { value: 0.0013 },
    uWarmth: { value: new THREE.Vector3(1.02, 1.0, 0.978) },
    uLift: { value: new THREE.Vector3(0.0018, 0.0028, 0.0050) },
    uSunScreen: { value: new THREE.Vector2(0.5, 0.5) },
    uSunVis: { value: 0.0 },
    uSunColor: { value: new THREE.Color(0xffd9a0) },
    uDusk: { value: 0.0 },
    uHeat: { value: 0.0 },
    uFade: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    uniform vec3 uWarmth;
    uniform vec3 uLift;
    uniform vec2 uSunScreen;
    uniform float uSunVis;
    uniform vec3 uSunColor;
    uniform float uDusk;
    uniform float uHeat;
    uniform float uFade;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float r2 = dot(center, center);

      // 正午的热浪：只在地平线附近轻轻抖一下 uv，别让人看出是特效
      vec2 suv = uv;
      if (uHeat > 0.001) {
        // 空间频率别太高：太密会在一帧里就产生摩尔纹，动起来像闪屏
        float w = sin(uv.x * 17.0 + uTime * 1.05) * sin(uv.y * 12.0 - uTime * 0.85);
        suv += vec2(w * 0.0012, w * 0.0008) * uHeat * smoothstep(0.46, 0.96, uv.y);
      }

      // 横向色差：越靠边越明显，模拟镜头
      vec2 dir = center * uAberration * (0.35 + r2 * 2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, suv + dir).r;
      col.g = texture2D(tDiffuse, suv).g;
      col.b = texture2D(tDiffuse, suv - dir).b;

      // 日光晕：必须沿"像素 → 太阳"这条射线取样，才是射出来的光
      if (uSunVis > 0.001) {
        vec2 toSun = uSunScreen - uv;
        float d2sun = length(toSun);
        vec2 rd = toSun / max(d2sun, 0.0001);
        // 每个像素错开采样起点，否则 16 等分会在画面上留下放射状条带
        // 固定抖动：逐帧随机会在亮块（雪山/太阳）进画面时变成满屏闪烁
        float jit = rand(uv * 733.0);
        float halo = 0.0;
        float wsum = 0.0;
        for (int i = 1; i <= 20; i++) {
          float t = (float(i) - jit) / 20.0;
          vec2 sampleUv = uv + rd * t * (0.22 + d2sun * 1.2);
          vec3 s = texture2D(tDiffuse, clamp(sampleUv, 0.002, 0.998)).rgb;
          float lum = dot(s, vec3(0.2126, 0.7152, 0.0722));
          float w = 1.0 - t * 0.72;
          halo += smoothstep(0.70, 2.8, lum) * w;
          wsum += w;
        }
        halo /= max(wsum, 0.0001);
        float glow = pow(clamp(1.0 - d2sun * 1.05, 0.0, 1.0), 2.4);
        col += uSunColor * halo * glow * uSunVis * (0.10 + uDusk * 0.26);
      }

      // 冷暗部、暖高光：写实胶片的一点脾气
      col *= uWarmth;
      // 黄昏把整体色温再往暖处推一点，高光尤其
      col *= mix(vec3(1.0), vec3(1.07, 1.0, 0.88), uDusk * 0.65);

      // 分离调色：暗部偏紫、高光偏暖 —— 黄昏的电影感就藏在这一步
      float lum0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = mix(vec3(1.0), vec3(0.94, 0.94, 1.12), uDusk);
      vec3 highTint = mix(vec3(1.0), vec3(1.08, 1.01, 0.93), uDusk);
      col *= mix(shadowTint, highTint, smoothstep(0.02, 0.55, lum0));
      col += uLift * (1.0 - smoothstep(0.0, 0.35, dot(col, vec3(0.333))));

      // 暗角
      float vig = smoothstep(0.92, 0.18, length(center) * 1.18);
      col *= mix(1.0, vig, uVignette * 0.55);

      // 胶片颗粒（亮度越高越轻，避免死白死黑里冒沙子）
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float grainMask = smoothstep(0.0, 0.22, lum) * (1.0 - smoothstep(0.85, 2.2, lum));
      // 固定种子：颗粒只是用来打散天空色阶，不能随时间变，
      // 否则每帧都是全新噪声 = 整屏每秒闪 60 次
      float n = rand(uv * vec2(1920.0, 1080.0) + 19.0) - 0.5;
      col += n * uGrain * grainMask;

      col = mix(col, vec3(1.0), uFade * 0.0);

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export function createPostFX(renderer, scene, camera) {
  const size = new THREE.Vector2();
  renderer.getSize(size);

  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.16,   // strength：只要一点光晕，不要雾
    0.58,   // radius
    1.15    // threshold：只让太阳、水面反光、萤火虫冒出来
  );
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uWarmth.value.set(1.025, 1.0, 0.972);
  composer.addPass(grade);

  const output = new OutputPass();
  composer.addPass(output);

  const _v = new THREE.Vector3();

  return {
    composer,
    bloom,
    grade,
    render(dt, elapsed) {
      grade.uniforms.uTime.value = elapsed;
      composer.render(dt);
    },
    /* 把太阳方向转到屏幕坐标，交给 grade 做日晕 */
    setSun(sunDir, camera) {
      _v.copy(sunDir).multiplyScalar(1000).add(camera.position);
      _v.project(camera);
      const inFront = _v.z < 1;
      grade.uniforms.uSunScreen.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      const edge = 1 - Math.min(1, Math.max(Math.abs(_v.x), Math.abs(_v.y)) / 1.15);
      grade.uniforms.uSunVis.value = inFront ? Math.pow(edge, 0.6) : 0.0;
    },
    setExposure(v) {
      renderer.toneMappingExposure = v;
    },
    resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      composer.setSize(w, h);
      bloom.resolution.set(w, h);
    },
  };
}
