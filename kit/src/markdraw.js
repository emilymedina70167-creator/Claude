// 板书标注的几何（纯函数，有测试 tests/marks.test.js）：手绘风格的圈、框、下划线、划掉、涂色、箭头，旁注放哪。
// 坐标都是宿主里的像素（左上角是原点）。seed 让同一条标注每次重画的抖动都一样：
// 图重画、屏幕转向时标注跟着挪，但不会每次变个形状。

// 字符串 → 0..1 的伪随机数序列（mulberry32）
export function rng(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) { h = Math.imul(h ^ ch.codePointAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 几个矩形的外包框 { x, y, w, h }（没有就是 null） */
export function union(rects) {
  const rs = (rects || []).filter((r) => r && Number.isFinite(r.x) && Number.isFinite(r.y));
  if (!rs.length) return null;
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  const x2 = Math.max(...rs.map((r) => r.x + r.w)), y2 = Math.max(...rs.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

export function overlaps(a, b, gap = 0) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

const f = (n) => Math.round(n * 10) / 10;
const P = ([x, y]) => `${f(x)} ${f(y)}`;

// 一串点连成光滑的曲线（Catmull-Rom 换成三次贝塞尔）
export function smooth(pts, closed = false) {
  if (pts.length < 3) return `M${pts.map(P).join(' L')}`;
  const at = (i) => (closed ? pts[(i + pts.length) % pts.length] : pts[Math.max(0, Math.min(pts.length - 1, i))]);
  let d = `M${P(pts[0])}`;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${P(c1)} ${P(c2)} ${P(p2)}`;
  }
  return closed ? `${d} Z` : d;
}

// 手画的椭圆：比一圈多绕一点，收尾稍微偏出去一点，像粉笔圈的
function ellipse(cx, cy, rx, ry, rot, R) {
  const n = 40;
  const start = -Math.PI * (0.62 + R() * 0.16);
  const total = Math.PI * 2 * (1.07 + R() * 0.05);
  const ph1 = R() * 6.28, ph2 = R() * 6.28;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const th = start + total * t;
    const wob = 1 + 0.03 * Math.sin(th * 2 + ph1) + 0.018 * Math.sin(th * 3 + ph2);
    const grow = 1 + 0.08 * t;
    const x = Math.cos(th) * rx * wob * grow, y = Math.sin(th) * ry * wob * grow;
    pts.push([cx + x * cos - y * sin, cy + x * sin + y * cos]);
  }
  return smooth(pts);
}

// 一笔稍微弯一点的线（box 的边、下划线、划掉）
function stroke(a, b, R, bow = 1.6) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
  const k = (R() - 0.5) * 2 * bow;
  return `M${P(a)} Q${P([mx + nx * k, my + ny * k])} ${P(b)}`;
}

const PAD = 6;

/**
 * 一条标注的形状。geom：{ box }（要标的地方的外包框）、{ diag: [cell…] }（主对角线上各格）或 { point }。
 * 返回 { strokes: [d], fills: [d], bbox }：strokes 是线，fills 是涂色；bbox 是画出来的范围（旁注要躲开它）
 */
export function shapeFor(style, geom, seed) {
  const R = rng(seed);
  const j = (s = 1.4) => (R() - 0.5) * 2 * s;
  if (geom.diag?.length) {
    // 主对角线：一个斜着的长圈，从第一个对角元圈到最后一个
    const cs = geom.diag.map((c) => [c.x + c.w / 2, c.y + c.h / 2]);
    const a = cs[0], b = cs[cs.length - 1];
    const r = Math.max(...geom.diag.map((c) => Math.max(c.w, c.h))) / 2 + PAD * 0.6;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const rot = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    const rx = len / 2 + r * 1.05, ry = r;
    const ext = [Math.abs(rx * Math.cos(rot)) + Math.abs(ry * Math.sin(rot)), Math.abs(rx * Math.sin(rot)) + Math.abs(ry * Math.cos(rot))].map((e) => e * 1.1);
    return { strokes: [ellipse(cx, cy, rx, ry, rot, R)], fills: [], bbox: { x: cx - ext[0], y: cy - ext[1], w: ext[0] * 2, h: ext[1] * 2 } };
  }
  if (geom.point) {
    // 图上的一个点：圈一个小圈（箭头直接指过去）
    const { x, y } = geom.point;
    const r = 15;
    const box = { x: x - r, y: y - r, w: r * 2, h: r * 2 };
    if (style === 'arrow') return { strokes: [], fills: [], bbox: { x: x - 4, y: y - 4, w: 8, h: 8 }, point: geom.point };
    return { strokes: [ellipse(x, y, r, r * 0.92, j(0.3), R)], fills: [], bbox: box };
  }
  const b = geom.box;
  const { x, y, w, h } = b;
  switch (style) {
    case 'circle': {
      // 公式里左右挨着别的符号，上下比较空：圈得高一点、窄一点，宽度刚好包住这一项的四个角再多 2px，
      // 不然会压到旁边的字（A² = αβᵀαβᵀ 圈中间的 βᵀα）。单个字母时别太瘦长
      const ry = h / 2 * 1.35 + PAD * 0.7;
      const rx = Math.max(w / 2 / Math.sqrt(1 - (h / 2 / ry) ** 2) + 2, ry * 0.85);
      const cx = x + w / 2, cy = y + h / 2;
      return { strokes: [ellipse(cx, cy, rx, ry, j(0.04), R)], fills: [], bbox: { x: cx - rx * 1.1, y: cy - ry * 1.1, w: rx * 2.2, h: ry * 2.2 } };
    }
    case 'underline': {
      const yy = y + h + 4;
      return { strokes: [stroke([x - 4 + j(), yy + j(1)], [x + w + 4 + j(), yy - 1 + j(1)], R, 2.2)], fills: [], bbox: { x: x - 6, y: y, w: w + 12, h: h + 9 } };
    }
    case 'strike': {
      // 宽的划一横；窄的（一个数、一项）像 \cancel 斜着划
      const wide = w > h * 2.6;
      const d = wide
        ? stroke([x - 3, y + h * 0.56 + j(1.5)], [x + w + 3, y + h * 0.46 + j(1.5)], R, 1.5)
        : stroke([x - 2 + j(), y + h + 2 + j()], [x + w + 2 + j(), y - 2 + j()], R, 1.2);
      return { strokes: [d], fills: [], bbox: { x: x - 4, y: y - 4, w: w + 8, h: h + 8 } };
    }
    case 'highlight': {
      const p = 4;
      const d = `M${P([x - p + j(), y + 1 + j()])} L${P([x + w + p + j(), y - 1 + j()])} L${P([x + w + p - 1 + j(), y + h + 1 + j()])} L${P([x - p + 1 + j(), y + h + 2 + j()])} Z`;
      return { strokes: [], fills: [d], bbox: { x: x - p - 2, y: y - 3, w: w + p * 2 + 4, h: h + 6 } };
    }
    case 'arrow':
      // 箭头的线要等旁注放好了才知道从哪画来（arrowPath）；这里只给出要指的范围
      return { strokes: [], fills: [], bbox: { x: x - 2, y: y - 2, w: w + 4, h: h + 4 } };
    default: { // box
      // 矩阵的一行（一列）：上下（左右）收紧，挨着的几行各框各的，框线不打架
      const tx = geom.tight === 'x', ty = geom.tight === 'y';
      const px = tx ? geom.inset ?? 1 : PAD - 1, py = ty ? geom.inset ?? 1 : PAD - 1;
      const L = x - px, T = y - py, Rr = x + w + px, B = y + h + py;
      // 角上多出去一点。收紧的方向上不出头、抖得也小：不然竖边伸进上下两行的框里，几行的框线叠成一团
      const o = () => (geom.tight ? 1.5 + R() * 2.5 : 3 + R() * 4);
      const ox = () => (tx ? 0 : o()), oy = () => (ty ? 0 : o());
      const jx = () => j(tx ? 0.5 : 1.4), jy = () => j(ty ? 0.5 : 1.4);
      const bh = ty ? 0.6 : 1.6, bv = tx ? 0.6 : 1.6;
      const d = [
        stroke([L - ox(), T + jy()], [Rr + ox(), T + jy()], R, bh),
        stroke([Rr + jx(), T - oy()], [Rr + jx(), B + oy()], R, bv),
        stroke([Rr + ox(), B + jy()], [L - ox(), B + jy()], R, bh),
        stroke([L + jx(), B + oy()], [L + jx(), T - oy()], R, bv),
      ].join(' ');
      return { strokes: [d], fills: [], bbox: { x: L - 7, y: T - 7, w: Rr - L + 14, h: B - T + 14 } };
    }
  }
}

// 点到矩形最近的点
function nearest(p, r) {
  return [Math.max(r.x, Math.min(p[0], r.x + r.w)), Math.max(r.y, Math.min(p[1], r.y + r.h))];
}

/**
 * 箭头：从 from 区域（旁注）指到 to 区域（或一个点）。返回 SVG path（线 + 箭头的两笔）
 */
export function arrowPath(from, to, seed) {
  const R = rng(`${seed}:arrow`);
  const toC = to.w !== undefined ? [to.x + to.w / 2, to.y + to.h / 2] : [to.x, to.y];
  const fromC = [from.x + from.w / 2, from.y + from.h / 2];
  const a0 = nearest(toC, from);
  let b0 = to.w !== undefined ? nearest(fromC, to) : [to.x, to.y];
  const len0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) || 1;
  const ux = (b0[0] - a0[0]) / len0, uy = (b0[1] - a0[1]) / len0;
  const a = [a0[0] + ux * 4, a0[1] + uy * 4];
  // 箭头尖停在目标外面一点，别压住要看的东西
  const b = [b0[0] - ux * (to.w !== undefined ? 5 : 9), b0[1] - uy * (to.w !== undefined ? 5 : 9)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const bend = (R() > 0.5 ? 1 : -1) * Math.min(26, len * 0.18);
  const c = [(a[0] + b[0]) / 2 - uy * bend, (a[1] + b[1]) / 2 + ux * bend];
  // 箭头方向按曲线末端的切线
  const tx = b[0] - c[0], ty = b[1] - c[1];
  const tl = Math.hypot(tx, ty) || 1;
  const dx = tx / tl, dy = ty / tl;
  const hl = Math.min(13, len * 0.4), ang = 0.5;
  const h1 = [b[0] - hl * (dx * Math.cos(ang) - dy * Math.sin(ang)), b[1] - hl * (dy * Math.cos(ang) + dx * Math.sin(ang))];
  const h2 = [b[0] - hl * (dx * Math.cos(-ang) - dy * Math.sin(-ang)), b[1] - hl * (dy * Math.cos(-ang) + dx * Math.sin(-ang))];
  return `M${P(a)} Q${P(c)} ${P(b)} M${P(h1)} L${P(b)} L${P(h2)}`;
}

const SIDE_ORDER = ['right', 'above', 'below', 'left'];
const GAPS = [8, 30, 60, 100, 150];
const ALIGNS = ['center', 'start', 'end'];

// 重叠的面积
function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// 两个矩形之间的空隙（挨着或重叠是 0）
export function gapBetween(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

function candidate(t, size, s, g, a) {
  const cx = a === 'center' ? t.x + t.w / 2 - size.w / 2 : a === 'start' ? t.x : t.x + t.w - size.w;
  const cy = a === 'center' ? t.y + t.h / 2 - size.h / 2 : a === 'start' ? t.y : t.y + t.h - size.h;
  if (s === 'right') return { x: t.x + t.w + g, y: cy };
  if (s === 'left') return { x: t.x - g - size.w, y: cy };
  if (s === 'above') return { x: cx, y: t.y - g - size.h };
  return { x: cx, y: t.y + t.h + g };
}

/**
 * 旁注放哪。target：形状的范围；size：旁注的大小；area：旁注能放的范围 { x0, y0, x1, y1 }（宿主里的坐标）。
 * 在四边、几种距离、几种对齐里挑一个：不压住要标的东西（target）、尽量不压字（obstacles：正文、按钮的范围）、
 * 不压别的旁注和形状（taken），近的、side 指定的那边优先。
 * keep：上次挑好的 { side, gap, align }（图在动时沿用，不重新挑，旁注不会跳来跳去）。
 * 返回 { x, y, side, gap, align, lead }：lead 表示旁注离得远，要连一条线过去
 */
export function placeNote(target, size, area, { side, taken = [], far = false, obstacles = [], keep = null } = {}) {
  const clampX = (x) => Math.max(area.x0, Math.min(area.x1 - size.w, x));
  const clampY = (y) => Math.max(area.y0, Math.min(area.y1 - size.h, y));
  const make = (s, g, a) => {
    const raw = candidate(target, size, s, g, a);
    const r = { x: clampX(raw.x), y: clampY(raw.y), w: size.w, h: size.h };
    return { r, s, g, a, moved: Math.abs(r.x - raw.x) + Math.abs(r.y - raw.y) };
  };
  const done = (c) => ({ x: c.r.x, y: c.r.y, side: c.s, gap: c.g, align: c.a, lead: gapBetween(c.r, target) > 18 });
  if (keep && SIDE_ORDER.includes(keep.side)) return done(make(keep.side, keep.gap, keep.align));
  const order = side ? [side, ...SIDE_ORDER.filter((x) => x !== side)] : SIDE_ORDER;
  const gaps = far ? [34, 60, 100, 150] : GAPS;
  let best = null;
  order.forEach((s, rank) => {
    for (const g of gaps) {
      if ((s === 'left' || s === 'right') && g > 60) continue;
      ALIGNS.forEach((a, ai) => {
        const c = make(s, g, a);
        if (overlapArea(c.r, target) > 0) return; // 压住要标的东西：不要
        let score = rank * 40 + ai * 15 + g * 6 + c.moved * 2;
        for (const o of obstacles) score += overlapArea(c.r, o);
        for (const o of taken) score += overlapArea(c.r, o) * 3;
        if (!best || score < best.score) best = { ...c, score };
      });
    }
  });
  return done(best || make(order[0], gaps[0], 'center'));
}

/** 旁注离得远时连过去的一条细线（不带箭头） */
export function leaderPath(from, to, seed) {
  const R = rng(`${seed}:lead`);
  const fc = [from.x + from.w / 2, from.y + from.h / 2], tc = [to.x + to.w / 2, to.y + to.h / 2];
  const a = nearest(tc, from), b0 = nearest(fc, to);
  const len = Math.hypot(b0[0] - a[0], b0[1] - a[1]) || 1;
  const ux = (b0[0] - a[0]) / len, uy = (b0[1] - a[1]) / len;
  const a1 = [a[0] + ux * 3, a[1] + uy * 3], b = [b0[0] - ux * 4, b0[1] - uy * 4];
  const bend = (R() > 0.5 ? 1 : -1) * Math.min(14, len * 0.12);
  const c = [(a1[0] + b[0]) / 2 - uy * bend, (a1[1] + b[1]) / 2 + ux * bend];
  return `M${P(a1)} Q${P(c)} ${P(b)}`;
}
