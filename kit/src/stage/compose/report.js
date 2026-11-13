// 版面写给老师（第八轮）：每样东西占哪几格、画布上最大的几块空地、哪条要求没照办。纯函数。
// 老师看不见画面：照这几行决定下一轮怎么构图（哪里还空着、要不要 place 一下）。

import { toCells, cellText } from './grid.js';

const NAME = { say: '话', goals: '挑战' };

/** 画布上面积最大的几块空矩形（格子），贪心：每次挑最大的一块，占上再挑；和东西不相交 */
export function freeRects(boxes, grid, max = 3) {
  const { cols, rows } = grid;
  const busy = Array.from({ length: rows }, () => new Uint8Array(cols));
  const mark = (c) => {
    for (let r = Math.max(0, c.r0); r < Math.min(rows, c.r1); r++)
      for (let k = Math.max(0, c.c0); k < Math.min(cols, c.c1); k++) busy[r][k] = 1;
  };
  for (const b of boxes.values()) mark(toCells(b, grid));
  const out = [];
  for (let n = 0; n < max; n++) {
    // 最大的全空矩形：一行一行往下，算每一列往上连着空了几格，再按直方图找最大矩形
    const hgt = new Array(cols).fill(0);
    let best = null;
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) hgt[k] = busy[r][k] ? 0 : hgt[k] + 1;
      for (let k = 0; k < cols; k++) {
        if (!hgt[k]) continue;
        let h = hgt[k];
        for (let e = k; e < cols && hgt[e]; e++) {
          h = Math.min(h, hgt[e]);
          const area = h * (e - k + 1);
          if (!best || area > best.area) best = { area, c0: k, c1: e + 1, r0: r - h + 1, r1: r + 1 };
        }
      }
    }
    if (!best || best.area < 12) break;
    out.push({ c0: best.c0, r0: best.r0, c1: best.c1, r1: best.r1 });
    mark(best);
  }
  return out;
}

/** 舞台现状里「版面」那几行 */
export function layoutLines({ boxes, grid, unmet = [], scale = 1 }) {
  const lines = [];
  const parts = [...boxes].map(([id, b]) => `${NAME[id] || id} ${cellText(toCells(b, grid))}`);
  lines.push(`版面（${grid.cols} 列 × ${grid.rows} 行）：${parts.join('；') || '空'}`);
  // 压着的、出了屏幕的（老师摆过的东西页面不挪：照实说，怎么改由老师定）
  const W = grid.cols * grid.cell, H = grid.rows * grid.cell;
  const list = [...boxes].filter(([id]) => id !== 'say' && id !== 'goals');
  const hit = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const over = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (hit(list[i][1], list[j][1])) over.push(`${list[i][0]} 和 ${list[j][0]}`);
  if (over.length) lines.push(`压着：${over.join('；')}`);
  const out = list.filter(([, b]) => b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1).map(([id]) => NAME[id] || id);
  if (out.length) lines.push(`出了屏幕：${out.join('、')}`);
  const free = freeRects(boxes, grid);
  if (free.length) lines.push(`空着：${free.map(cellText).join('；')}`);
  const why = unmet.map((u) => (typeof u === 'string' ? u : u.why)).filter(Boolean);
  const fit = why.filter((w) => /^放不下/.test(w));
  const rest = why.filter((w) => !/^放不下/.test(w));
  if (rest.length) lines.push(`没照办：${rest.join('；')}`);
  if (fit.length) lines.push(fit[fit.length - 1]);
  else if (scale < 1) lines.push(`放不下，整台缩到 ${Math.round(scale * 10)} 成`);
  return lines;
}
