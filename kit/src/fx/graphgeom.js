// 函数图里几样东西的几何（视觉交互第 1 批；纯函数，tests/fx-graphgeom.test.js）：
// 黎曼和的矩形、两条曲线之间的那一块、标签互相让开。坐标都是数学坐标（标签那个是屏幕坐标），画在 graph.js。

import { numIntegral } from './integral.js';

const val = (f, x) => { let y; try { y = f(x); } catch { return NaN; } return typeof y === 'number' && Number.isFinite(y) ? y : NaN; };

export const RIEMANN_MAX = 500;

/**
 * 黎曼和：[a, b] 分成 n 等份，每份上取左端 / 右端 / 中点的函数值当高。
 * 回 { rects: [{ x0, x1, y, xs }]（xs 是取样点；没定义的那一块不在里面）, sum }（有没定义的块时 sum 是 NaN）
 */
export function riemannRects(f, a, b, n, rule = 'left') {
  const k = Math.max(1, Math.min(RIEMANN_MAX, Math.round(Number(n)) || 1));
  const h = (b - a) / k;
  const rects = [];
  let sum = 0;
  for (let i = 0; i < k; i++) {
    const x0 = a + i * h, x1 = a + (i + 1) * h;
    const xs = rule === 'right' ? x1 : rule === 'mid' ? (x0 + x1) / 2 : x0;
    const y = val(f, xs);
    if (Number.isNaN(y)) { sum = NaN; continue; }
    sum += y * h;
    rects.push({ x0, x1, y, xs });
  }
  return { rects, sum };
}

/**
 * 两条曲线之间（x 从 a 到 b）：poly 先沿 f 从 a 到 b、再沿 g 从 b 回 a（围成的那一块）；area 是 ∫|f − g|（梯形法）。
 * 有没定义的点时那些点不进 poly，area 是 NaN。
 */
export function betweenArea(f, g, a, b, n = 200) {
  const top = [], bot = [];
  let area = 0, prev = null;
  for (let i = 0; i <= n; i++) {
    const x = a + ((b - a) * i) / n, yf = val(f, x), yg = val(g, x);
    if (Number.isNaN(yf) || Number.isNaN(yg)) { area = NaN; prev = null; continue; }
    top.push([x, yf]); bot.push([x, yg]);
    const d = Math.abs(yf - yg);
    if (prev !== null) {
      const s = (yf - yg) * prev.s;
      // 这一小段里两条线交叉了：两个三角形分开算（直接取梯形会把正负抵掉）
      area += s < 0 ? ((b - a) / n) * (prev.d * prev.d + d * d) / (2 * (prev.d + d)) : ((b - a) / n) * (prev.d + d) / 2;
    }
    prev = { d, s: Math.sign(yf - yg) || (prev ? prev.s : 1) };
  }
  return { poly: [...top, ...bot.reverse()], area: Math.abs(area) };
}

/** 两条曲线之间的面积 ∫|f − g|，给读数用：自适应积分（梯形法只有四五位，1/6 认不成分数）。算不出来是 NaN */
export function areaBetween(f, g, a, b) {
  const r = numIntegral((x) => Math.abs(val(f, x) - val(g, x)), a, b, { maxSeg: 400 });
  // 两条线交叉的地方 |f − g| 有尖角，收敛得慢一点：没到 1e-10 但数是有限的也用
  return Number.isFinite(r.value) ? Math.abs(r.value) : NaN;
}

const hits = (p, q, gap = 2) => !(p.x + p.w / 2 + gap <= q.x - q.w / 2 || q.x + q.w / 2 + gap <= p.x - p.w / 2 || p.y + p.h / 2 + gap <= q.y - q.h / 2 || q.y + q.h / 2 + gap <= p.y - p.h / 2);

/**
 * 标签让位。items: [{ x, y, w, h }]（想放的中心和大小，屏幕坐标），box: { x0, y0, x1, y1 }。
 * 按先后放：先拉回框里，和已经放好的叠了就往上、往下一档一档挪，再不行往两边挪。回每个标签的中心 [x, y]。
 */
export function placeLabels(items, box) {
  const placed = [];
  const clamp = (it, x, y) => ({ ...it, x: Math.max(box.x0 + it.w / 2, Math.min(box.x1 - it.w / 2, x)), y: Math.max(box.y0 + it.h / 2, Math.min(box.y1 - it.h / 2, y)) });
  for (const it of items) {
    let best = clamp(it, it.x, it.y);
    if (placed.some((p) => hits(best, p))) {
      const tries = [];
      for (let k = 1; k <= 8; k++) tries.push([0, -k * (it.h + 2)], [0, k * (it.h + 2)]);
      for (let k = 1; k <= 4; k++) tries.push([k * (it.w + 4), 0], [-k * (it.w + 4), 0]);
      for (const [dx, dy] of tries) {
        const c = clamp(it, it.x + dx, it.y + dy);
        // 被框挡回来、没真的挪开的不算
        if (!placed.some((p) => hits(c, p))) { best = c; break; }
      }
    }
    placed.push(best);
  }
  return placed.map((p) => [p.x, p.y]);
}

/**
 * 函数在 a 处是不是光滑的（能画切线）：左右差商对得上。分段函数的尖点（|x² − 1| 在 1、(x ≥ 0)·x 在 0）
 * 符号求导会照其中一段给出一个斜率，那条「切线」是错的。span：窗口的宽（定步长）
 */
export function smoothAt(f, a, k, span) {
  const h = 1e-6 * Math.max(span, 1e-9), y = val(f, a), l = val(f, a - h), r = val(f, a + h);
  if ([y, l, r].some(Number.isNaN)) return true; // 一边没定义（定义域的端点）：不拦，照公式画
  const dl = (y - l) / h, dr = (r - y) / h;
  if (!Number.isFinite(dl) || !Number.isFinite(dr)) return true; // 差商冲到无穷（竖直切线）：不是尖点，不拦
  return Math.abs(dl - dr) <= 0.02 * Math.max(1, Math.abs(dl), Math.abs(dr), Math.abs(k) || 0);
}

/**
 * y 的范围没写时怎么取：从 0 起，上面留一点头（和以前一样）。
 * 有极点、爆掉的值时最大最小会被撑到几十万：超出中间八成的值太多的那一头，裁到「中间八成再往外两倍」
 */
export function autoRange(values) {
  const ys = [0, ...values.filter(Number.isFinite)].sort((p, q) => p - q);
  if (ys.length === 1) return [0, 1];
  let bot = ys[0], top = ys[ys.length - 1];
  const lo = ys[Math.floor((ys.length - 1) * 0.1)], hi = ys[Math.ceil((ys.length - 1) * 0.9)], mid = hi - lo;
  if (mid > 0 && top - bot > 8 * mid) { bot = Math.max(bot, Math.min(0, lo - 2 * mid)); top = Math.min(top, Math.max(0, hi + 2 * mid)); }
  if (top === bot) top = bot + 1;
  return [bot === 0 ? 0 : bot - (top - bot) * 0.08, top * 1.15 - bot * 0.15];
}
