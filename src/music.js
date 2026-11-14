/* =========================================================
   music.js — 程序化放松音乐
   不用采样、不联网。用和声进行 + 五声音阶旋律 + 程序化混响 IR。
   白天在 D 大调五声上飘，入夜转到小调并把密度压下去。
   ========================================================= */

const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);

/* 和弦池：每个和弦一组 MIDI 音，从低到高 */
const DAY_CHORDS = [
  [50, 62, 66, 69, 76], // Dadd9
  [47, 59, 62, 66, 69], // Bm7
  [43, 55, 59, 62, 66], // Gmaj7
  [45, 57, 61, 64, 69], // A7sus4
  [50, 62, 69, 73, 76], // Dmaj9 变体
  [43, 55, 62, 66, 71], // G6/9
];

const NIGHT_CHORDS = [
  [50, 62, 65, 69, 72], // Dm
  [46, 58, 62, 65, 69], // Bbmaj7
  [43, 55, 58, 62, 65], // Gm7
  [45, 57, 60, 64, 67], // Asus4
  [48, 60, 63, 67, 70], // Cm7 变体
  [41, 53, 57, 60, 64], // Fmaj7
];

const DAY_MELODY = [74, 76, 78, 81, 83, 86, 88, 90];
const NIGHT_MELODY = [62, 65, 69, 70, 72, 74, 77, 81];

/* 程序化混响冲激响应：指数衰减的噪声，带一点点早期反射 */
function makeReverbIR(ctx, seconds = 4.6, decay = 2.6) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      let s = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      // 前 120ms 更亮，之后逐渐变暗
      if (t < 0.03) s *= 0.55 + t * 12;
      d[i] = s;
    }
  }
  return buf;
}

export function createMusic(ctx, destination) {
  const now0 = ctx.currentTime;

  /* ---------- 母线 ---------- */
  const bus = ctx.createGain();
  bus.gain.value = 0.0;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 30;
  comp.ratio.value = 3;
  comp.attack.value = 0.04;
  comp.release.value = 0.4;

  // 室内时把整体压暗
  const indoorFilter = ctx.createBiquadFilter();
  indoorFilter.type = 'lowpass';
  indoorFilter.frequency.value = 18000;
  indoorFilter.Q.value = 0.4;

  bus.connect(comp).connect(indoorFilter).connect(destination);

  /* ---------- 混响 ---------- */
  const reverb = ctx.createConvolver();
  reverb.buffer = makeReverbIR(ctx);
  const reverbGain = ctx.createGain();
  reverbGain.gain.value = 0.85;
  const reverbLP = ctx.createBiquadFilter();
  reverbLP.type = 'lowpass';
  reverbLP.frequency.value = 4200;
  reverb.connect(reverbLP).connect(reverbGain).connect(bus);

  /* ---------- 和声垫 ---------- */
  const padBus = ctx.createGain();
  padBus.gain.value = 0.30;
  padBus.connect(bus);
  padBus.connect(reverb);

  const melodyBus = ctx.createGain();
  melodyBus.gain.value = 0.24;
  melodyBus.connect(bus);
  melodyBus.connect(reverb);

  /* 一层很低的持续低音，给一点身体感 */
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.055;
  droneGain.connect(bus);
  droneGain.connect(reverb);
  const droneOsc = ctx.createOscillator();
  droneOsc.type = 'sine';
  droneOsc.frequency.value = midiToFreq(38); // D2
  const droneOsc2 = ctx.createOscillator();
  droneOsc2.type = 'sine';
  droneOsc2.frequency.value = midiToFreq(45) * 1.002; // A2
  droneOsc.connect(droneGain);
  droneOsc2.connect(droneGain);
  droneOsc.start(now0);
  droneOsc2.start(now0);

  /* ---------- 状态 ---------- */
  let night = 0;         // 0 白天 .. 1 夜
  let indoor = 0;
  let running = false;
  let chordIndex = 0;
  let nextChordAt = 0;
  let nextNoteAt = 0;
  let timer = null;

  const CHORD_DUR = 13.5;

  function scheduleChord(at, chords) {
    const notes = chords[chordIndex % chords.length];
    const dur = CHORD_DUR;
    const voices = 4;

    for (let i = 0; i < voices; i++) {
      const midi = notes[i];
      if (midi === undefined) continue;

      // 每个音两个略微失谐的层，产生缓慢的拍频，听起来是"活"的
      for (const det of [-4, 4]) {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.value = midiToFreq(midi) * Math.pow(2, det / 1200);

        const g = ctx.createGain();
        const peak = i === 0 ? 0.14 : 0.075 / (1 + i * 0.28);

        // 慢起慢收，叠起来就没有"触发感"
        const attack = 3.4 + Math.random() * 1.6;
        const release = 5.2 + Math.random() * 1.8;

        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(peak, at + attack);
        g.gain.setValueAtTime(peak, at + dur - release);
        g.gain.linearRampToValueAtTime(0.0001, at + dur + 0.4);

        osc.connect(g).connect(padBus);
        osc.start(at);
        osc.stop(at + dur + 0.6);
      }
    }

    chordIndex++;
  }

  function scheduleNote(at, pool) {
    const len = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < len; i++) {
      const t = at + i * (0.42 + Math.random() * 0.55);
      const midi = pool[Math.floor(Math.random() * pool.length)];
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = midiToFreq(midi);

      // 一点钟声的泛音
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = midiToFreq(midi) * 2.005;

      const g = ctx.createGain();
      const g2 = ctx.createGain();
      const peak = 0.11 + Math.random() * 0.05;
      const fall = 2.6 + Math.random() * 2.8;

      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + fall);

      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(peak * 0.22, t + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + fall * 0.5);

      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = (Math.random() * 1.5 - 0.75) * 0.7;
        osc.connect(g).connect(pan).connect(melodyBus);
        osc2.connect(g2).connect(pan);
      } else {
        osc.connect(g).connect(melodyBus);
        osc2.connect(g2).connect(melodyBus);
      }

      osc.start(t);
      osc.stop(t + fall + 0.1);
      osc2.start(t);
      osc2.stop(t + fall + 0.1);
    }
  }

  function tick() {
    if (!running) return;
    const now = ctx.currentTime + 0.1;

    // 和弦：按 3:1 混编白天/夜晚的池子
    const chords = night > 0.5 ? NIGHT_CHORDS : DAY_CHORDS;
    const pool = night > 0.5 ? NIGHT_MELODY : DAY_MELODY;

    while (nextChordAt < now + 2.0) {
      if (nextChordAt < now) nextChordAt = now + 0.2;
      scheduleChord(nextChordAt, chords);
      nextChordAt += CHORD_DUR;
    }

    while (nextNoteAt < now + 1.5) {
      if (nextNoteAt < now) nextNoteAt = now + 1.0 + Math.random() * 2.5;
      // 夜里音符更稀
      const gap = lerp(3.2, 8.5, night) + Math.random() * lerp(2.5, 6.0, night);
      if (Math.random() < 0.78) scheduleNote(nextNoteAt, pool);
      nextNoteAt += gap;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      nextChordAt = ctx.currentTime + 0.6;
      nextNoteAt = ctx.currentTime + 4.0;
      bus.gain.setValueAtTime(0.0001, ctx.currentTime);
      bus.gain.linearRampToValueAtTime(0.62, ctx.currentTime + 9.0);
      tick();
      timer = setInterval(tick, 400);
    },
    setNight(v) {
      if (Math.abs(v - night) < 0.02) return;
      night = v;
      // 夜里低音垫降半音，更沉
      droneOsc.frequency.setTargetAtTime(midiToFreq(night > 0.5 ? 38 : 38), ctx.currentTime, 0.5);
      padBus.gain.setTargetAtTime(night > 0.5 ? 0.22 : 0.3, ctx.currentTime, 1.2);
      melodyBus.gain.setTargetAtTime(night > 0.5 ? 0.3 : 0.24, ctx.currentTime, 1.2);
    },
    setIndoor(v) {
      if (Math.abs(v - indoor) < 0.02) return;
      indoor = v;
      indoorFilter.frequency.setTargetAtTime(lerp(18000, 2400, v), ctx.currentTime, 1.4);
      reverbGain.gain.setTargetAtTime(lerp(0.85, 0.28, v), ctx.currentTime, 1.4);
    },
    fadeOut(seconds = 2.5) {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      bus.gain.setTargetAtTime(0.0001, ctx.currentTime, seconds / 3);
    },
    resume() {
      if (!timer) {
        running = true;
        nextChordAt = ctx.currentTime + 0.3;
        nextNoteAt = ctx.currentTime + 3.0;
        bus.gain.setTargetAtTime(0.62, ctx.currentTime, 0.8);
        tick();
        timer = setInterval(tick, 400);
      }
    },
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
