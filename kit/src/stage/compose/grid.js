// 自由构图的细网格（第八轮）：老师看到、写的位置都按格子，不按像素。
// 横 48 列，竖按屏幕比例取行；换设备、横竖屏都通用。纯函数。

export const COLS = 48;

// 间距三档（格）：s 半格、m 一格、l 两格
export const GAPS = { s: 0.5, m: 1, l: 2 };

export function gridOf({ w, h }) {
  const cell = w / COLS;
  return { cols: COLS, rows: Math.max(1, Math.floor(h / cell)), cell };
}

// 字号档：一节课里不变，照屏幕宽挑一档，让句子的字在 26～30 像素之间
export function typeScaleOf({ w }) {
  return Math.min(1.11, Math.max(0.96, w / 1240));
}

// 框盖到的格子（c1 / r1 不含）
export function toCells(box, grid) {
  const k = grid.cell, eps = 1e-6;
  return {
    c0: Math.floor(box.x / k + eps),
    r0: Math.floor(box.y / k + eps),
    c1: Math.ceil((box.x + box.w) / k - eps),
    r1: Math.ceil((box.y + box.h) / k - eps),
  };
}

export function fromCells({ c0, r0, c1, r1 }, grid) {
  const k = grid.cell;
  return { x: c0 * k, y: r0 * k, w: (c1 - c0) * k, h: (r1 - r0) * k };
}

export function cellText({ c0, r0, c1, r1 }) {
  return `${c0},${r0}-${c1},${r1}`;
}

// 「6,4-40,12」：第 6 列第 4 行到第 40 列第 12 行；写错返回 null。
// 行数不知道屏幕多高，这里只拦明显不对的（倒着写、列超过 48）
export function parseAt(text) {
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*-\s*(\d+)\s*,\s*(\d+)\s*$/.exec(String(text || ''));
  if (!m) return null;
  const [c0, r0, c1, r1] = m.slice(1).map(Number);
  if (c1 <= c0 || r1 <= r0 || c1 > COLS) return null;
  return { c0, r0, c1, r1 };
}
