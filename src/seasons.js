/* =========================================================
   seasons.js — 四季与节气历法
   一年一个周期，走得很慢（默认 1 小时现实时间 = 1 年）。
   24 节气按公历近似日期定位，节日挂在节气附近。
   ========================================================= */

export const YEAR_SEC = 3600; // 一年 = 1 小时现实时间（可用 ?yearSec= 覆盖）

/* 24 节气：公历近似 dayOfYear（1/1 = 1） */
export const TERMS = [
  { d: 6, name: '小寒' }, { d: 20, name: '大寒' },
  { d: 35, name: '立春' }, { d: 50, name: '雨水' },
  { d: 65, name: '惊蛰' }, { d: 80, name: '春分' },
  { d: 95, name: '清明' }, { d: 110, name: '谷雨' },
  { d: 126, name: '立夏' }, { d: 141, name: '小满' },
  { d: 157, name: '芒种' }, { d: 171, name: '夏至' },
  { d: 188, name: '小暑' }, { d: 204, name: '大暑' },
  { d: 220, name: '立秋' }, { d: 236, name: '处暑' },
  { d: 251, name: '白露' }, { d: 266, name: '秋分' },
  { d: 282, name: '寒露' }, { d: 297, name: '霜降' },
  { d: 312, name: '立冬' }, { d: 327, name: '小雪' },
  { d: 342, name: '大雪' }, { d: 356, name: '冬至' },
];

/* 节日（农历近似映射到公历）：
   deco: lantern 灯笼 / spring 春节(春联+烟花) / boat 龙舟 / star 星空
          lanterns 孔明灯 / chrys 菊花 / snow 雪+灯 / smoke 烟花
   前后氛围期 atmosphere 天 */
export const FESTIVALS = [
  { d: 1, name: '元旦', deco: 'smoke', atmo: 2 },
  { d: 39, name: '除夕', deco: 'spring', atmo: 3 },
  { d: 40, name: '春节', deco: 'spring', atmo: 4 },
  { d: 54, name: '元宵', deco: 'lantern', atmo: 3 },
  { d: 95, name: '清明', deco: 'mist', atmo: 2 },
  { d: 160, name: '端午', deco: 'boat', atmo: 3 },
  { d: 220, name: '七夕', deco: 'star', atmo: 2 },
  { d: 259, name: '中秋', deco: 'lanterns', atmo: 4 },
  { d: 283, name: '重阳', deco: 'chrys', atmo: 2 },
  { d: 356, name: '冬至', deco: 'snow', atmo: 3 },
];

export const SEASON_NAMES = ['春', '夏', '秋', '冬'];

/* dayOfYear → 季节（以立春/立夏/立秋/立冬为界） */
export function seasonOf(doy) {
  if (doy >= 35 && doy < 126) return 0;
  if (doy >= 126 && doy < 220) return 1;
  if (doy >= 220 && doy < 312) return 2;
  return 3;
}

const SEASON_SPANS = [
  { start: 35, len: 91 },    // 春 立春→立夏
  { start: 126, len: 94 },   // 夏
  { start: 220, len: 92 },   // 秋
  { start: 312, len: 88 },   // 冬（跨年，特殊处理）
];

export function computeCalendar(elapsed, yearSec = YEAR_SEC) {
  const doy = ((elapsed / yearSec) % 1) * 365.25;
  const s = seasonOf(doy);

  // 季节内进度 0..1，用于颜色渐变
  let seasonT;
  const span = SEASON_SPANS[s];
  if (s === 3 && doy < 35) {
    // 冬天跨年：立冬(312)→次年立春(35)
    seasonT = (doy + 365.25 - 312) / (365.25 - 312 + 35);
  } else {
    seasonT = (doy - span.start) / span.len;
  }
  seasonT = Math.min(1, Math.max(0, seasonT));

  // 当前与下一个节气
  let term = TERMS[0];
  let nextTerm = TERMS[0];
  for (let i = 0; i < TERMS.length; i++) {
    if (TERMS[i].d <= doy) {
      term = TERMS[i];
      nextTerm = TERMS[(i + 1) % TERMS.length];
    }
  }
  let termProg = (doy - term.d) / (nextTerm.d + (nextTerm.d < term.d ? 365.25 : 0) - term.d);
  termProg = Math.min(1, Math.max(0, termProg));

  // 活跃节日（含氛围期）
  const active = [];
  for (const f of FESTIVALS) {
    let dist = Math.abs(doy - f.d);
    if (dist > 182) dist = 365.25 - dist;
    if (dist <= f.atmo + 0.5) {
      active.push({ ...f, dist, fade: 1 - Math.min(1, Math.max(0, (dist - f.atmo) / 0.5)) });
    }
  }

  return {
    doy,
    season: s,
    seasonName: SEASON_NAMES[s],
    seasonT,
    term: term.name,
    nextTerm: nextTerm.name,
    termProg,
    festivals: active,
    /* 主节日 = 最近的一个（装饰以它为准） */
    mainFestival: active.length ? active.reduce((a, b) => (a.dist < b.dist ? a : b)) : null,
  };
}
