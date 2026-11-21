// 三维的几何（视觉交互第 3 批；纯函数，tests/fx-solid.test.js）。画在 space.js。
//   曲面的网格（显式 z = f(x, y)、参数曲面、贴着一个区域的）、任意方程的曲面按三族截痕画线框、
//   平面（方程 → 法向量和点）、两个平面的交线、三个平面的情形、多边形被平面切开、
//   旋转体、两张曲面之间的区域（底、顶、侧面、竖着的一根、水平的截面）、空间向量场、三阶矩阵的实特征方向。
// 以前三维图只有向量、平面片和二次型的线框：曲面、旋转体、积分区域都画不出来，三个平面叠在一起看不清谁在前。
// 坐标都是数学坐标 [x, y, z]。函数算不出来（抛错、NaN、无穷）一律当没定义。
import { contourLines } from './plane.js';
import { numIntegral } from './integral.js';

export const SOLID_MAX_QUADS = 2400; // 一张图里的面片最多这么多（一帧里排得完、画得完）

const fin = (p) => Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === 'number' && Number.isFinite(x));
const num1 = (g) => (...a) => { let v; try { v = g(...a); } catch { return NaN; } return typeof v === 'number' && Number.isFinite(v) ? v : NaN; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (k, a) => [k * a[0], k * a[1], k * a[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * 参数曲面 P(u, v) → 网格。回 { pts（(nu+1)(nv+1) 个，第 j 行第 i 个是 pts[j*(nu+1)+i]；没定义的是 null）, quads（四个角都有定义的格子，各四个下标）, nu, nv }。
 * 格子太多（超过 SOLID_MAX_QUADS）自动减稀
 */
export function meshGrid(P, [u0, u1], [v0, v1], { nu = 24, nv = 24 } = {}) {
  nu = Math.max(1, Math.round(nu)); nv = Math.max(1, Math.round(nv));
  if (nu * nv > SOLID_MAX_QUADS) { const k = Math.sqrt(SOLID_MAX_QUADS / (nu * nv)); nu = Math.max(1, Math.floor(nu * k)); nv = Math.max(1, Math.floor(nv * k)); }
  const pts = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    let p; try { p = P(u0 + ((u1 - u0) * i) / nu, v0 + ((v1 - v0) * j) / nv); } catch { p = null; }
    pts.push(fin(p) ? p : null);
  }
  const quads = [], edge = [], W = nu + 1;
  const at = (i, j) => { let p; try { p = P(u0 + ((u1 - u0) * i) / nu, v0 + ((v1 - v0) * j) / nv); } catch { p = null; } return fin(p) ? p : null; };
  // 一条格子边上从有定义的一头 (i1, j1) 往没定义的一头走：二分找到还有定义的最后一点
  const reach = ([i1, j1], [i2, j2]) => {
    let a = 0, b = 1, last = at(i1, j1);
    for (let k = 0; k < 30; k++) { const m = (a + b) / 2, p = at(i1 + (i2 - i1) * m, j1 + (j2 - j1) * m); if (p) { a = m; last = p; } else b = m; }
    return last;
  };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const q = [j * W + i, j * W + i + 1, (j + 1) * W + i + 1, (j + 1) * W + i];
    if (q.every((k) => pts[k])) { quads.push(q); continue; }
    // 只有一部分角有定义（曲面在这一格里到头了，球写在比它大的底上）：沿着边找到头的地方，裁成一个多边形
    // （以前整格丢掉，边是锯齿）
    const ij = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    if (!q.some((k) => pts[k])) continue;
    const poly = [];
    for (let k = 0; k < 4; k++) {
      const a = q[k], b = q[(k + 1) % 4];
      if (pts[a]) poly.push(pts[a]);
      if (!!pts[a] !== !!pts[b]) poly.push(pts[a] ? reach(ij[k], ij[(k + 1) % 4]) : reach(ij[(k + 1) % 4], ij[k]));
    }
    if (poly.length >= 3) edge.push(poly);
  }
  return { pts, quads, edge, nu, nv };
}

// 区域里的一点：s 沿 a..b，t 从 0 到 1 在 lo..hi 之间
function basePoint(base, s, t) {
  if (base.rect) return [base.rect[0] + (base.rect[1] - base.rect[0]) * s, base.rect[2] + (base.rect[3] - base.rect[2]) * t];
  const p = base.a + (base.b - base.a) * s, l = num1(base.lo)(p), h = num1(base.hi)(p), r = l + (h - l) * t;
  if (Number.isNaN(r)) return null;
  return base.shape === 'y' ? [p, r] : base.shape === 'x' ? [r, p] : [r * Math.cos(p), r * Math.sin(p)];
}

/**
 * 显式曲面 z = f(x, y) 在一个区域上的网格：网格线贴着区域的边。
 * base：{ rect: [x0, x1, y0, y1] }，或者和 fx/plane.js 的 typedRegion 一样的 { shape: 'y' | 'x' | 'r', lo, hi, a, b }。
 * n：沿 a..b（rect 是 x）分几格；m：另一个方向
 */
export function meshOver(f, base, { n = 24, m = 24 } = {}) {
  const F = num1(f);
  return meshGrid((s, t) => { const q = basePoint(base, s, t); if (!q) return null; return [q[0], q[1], F(q[0], q[1])]; }, [0, 1], [0, 1], { nu: n, nv: m });
}

/**
 * 任意方程的曲面 F(x, y, z) = 0：三族平面（x = 常数、y = 常数、z = 常数）各切 n 刀，把截痕画出来当线框（截痕法）。
 * 回 { x: [{ at, lines }], y: […], z: […] }，lines 是三维的折线。每一刀是 fx/plane.js 的 contourLines（极点、跳跃处不画假线）
 */
export function sliceLines(F, box, { n = 9, grid = 48, _inner = false } = {}) {
  const f = num1(F);
  const cut = (lo, hi, rect, g, lift) => Array.from({ length: n }, (_, k) => {
    const at = n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * k) / (n - 1);
    return { at, lines: contourLines((p, q) => g(at, p, q), 0, rect, { nx: grid, ny: grid }).map((l) => l.map(([p, q]) => lift(at, p, q))) };
  });
  const out = {
    x: cut(box.x0, box.x1, { x0: box.y0, x1: box.y1, y0: box.z0, y1: box.z1 }, (x, y, z) => f(x, y, z), (x, y, z) => [x, y, z]),
    y: cut(box.y0, box.y1, { x0: box.x0, x1: box.x1, y0: box.z0, y1: box.z1 }, (y, x, z) => f(x, y, z), (y, x, z) => [x, y, z]),
    z: cut(box.z0, box.z1, { x0: box.x0, x1: box.x1, y0: box.y0, y1: box.y1 }, (z, x, y) => f(x, y, z), (z, x, y) => [x, y, z]),
  };
  if (_inner || ['x', 'y', 'z'].some((k) => out[k].some((c) => c.lines.length))) return out;
  // 一刀都没切到：曲面可能很小、夹在两刀之间（以前什么都不画、也不说）。在细一点的格子上找变号的地方，
  // 有就在那一小块里再切一遍（没有曲面的式子，x² + y² + z² + 1 = 0，照旧什么都不画）
  const m = 24, at = (i, lo, hi) => lo + ((hi - lo) * i) / m;
  const sign = [];
  let pos = false, neg = false;
  for (let i = 0; i <= m; i++) for (let j = 0; j <= m; j++) for (let k = 0; k <= m; k++) {
    const v = f(at(i, box.x0, box.x1), at(j, box.y0, box.y1), at(k, box.z0, box.z1));
    if (!Number.isFinite(v)) continue;
    if (v > 0) pos = true; else if (v < 0) neg = true;
    sign.push([i, j, k, Math.sign(v)]);
  }
  if (!pos || !neg) return out;
  const few = sign.filter((t) => t[3] < 0).length <= sign.filter((t) => t[3] > 0).length ? -1 : 1;
  const lo = [m, m, m], hi = [0, 0, 0];
  for (const [i, j, k, sg] of sign) if (sg === few) { [i, j, k].forEach((t, d) => { lo[d] = Math.min(lo[d], t); hi[d] = Math.max(hi[d], t); }); }
  const span = [[box.x0, box.x1], [box.y0, box.y1], [box.z0, box.z1]];
  const sub = (d) => [at(Math.max(0, lo[d] - 1), ...span[d]), at(Math.min(m, hi[d] + 1), ...span[d])];
  const [[x0, x1], [y0, y1], [z0, z1]] = [0, 1, 2].map(sub);
  return sliceLines(F, { x0, x1, y0, y1, z0, z1 }, { n, grid, _inner: true });
}

// —— 平面 ——

/** 平面 ax + by + cz = d → { n: 法向量, p0: 平面上离原点最近的点 }；法向量是零回 null */
export function planeFrom(a, b, c, d) {
  const n = [a, b, c], n2 = dot(n, n);
  if (![a, b, c, d].every(Number.isFinite) || !(n2 > 1e-18)) return null;
  return { n, p0: mul(d / n2, n) };
}

/** 两个平面的交线 { p: 线上一点, d: 方向（单位向量） }；平行回 null，重合回 { same: true } */
export function planeMeet2(P1, P2) {
  const d = cross(P1.n, P2.n), l1 = len(P1.n), l2 = len(P2.n);
  if (len(d) <= 1e-9 * l1 * l2) return Math.abs(dot(P1.n, sub(P2.p0, P1.p0))) <= 1e-9 * l1 * Math.max(1, len(P1.p0), len(P2.p0)) ? { same: true } : null;
  const d1 = dot(P1.n, P1.p0), d2 = dot(P2.n, P2.p0);
  return { p: mul(1 / dot(d, d), cross(sub(mul(d1, P2.n), mul(d2, P1.n)), d)), d: mul(1 / len(d), d) };
}

// 行的秩（先把每一行按法向量的长度归一，容差是相对的）
function rankOf(rows, tol = 1e-9) {
  const m = rows.map((r) => r.slice());
  let rank = 0;
  for (let col = 0; col < m[0].length && rank < m.length; col++) {
    let piv = rank;
    for (let i = rank + 1; i < m.length; i++) if (Math.abs(m[i][col]) > Math.abs(m[piv][col])) piv = i;
    if (Math.abs(m[piv][col]) <= tol) continue;
    [m[rank], m[piv]] = [m[piv], m[rank]];
    for (let i = rank + 1; i < m.length; i++) { const k = m[i][col] / m[rank][col]; for (let j = col; j < m[0].length; j++) m[i][j] -= k * m[rank][j]; }
    rank++;
  }
  return rank;
}

const P3_TEXT = {
  point: '唯一解（三个平面交于一点）',
  line: '无穷多解（三个平面交于一条直线）',
  'two-same': '无穷多解（两个平面重合，和第三个交于一条直线）',
  plane: '无穷多解（三个平面重合）',
  parallel: '无解（三个平面互相平行）',
  'two-same-parallel': '无解（两个平面重合，第三个和它们平行）',
  'two-parallel': '无解（两个平面平行，第三个和它们各交于一条直线）',
  prism: '无解（两两相交，三条交线互相平行，围成三棱柱）',
};

/**
 * 三个平面（方程组 Ax = b 的三行）的位置关系。回 { rankA, rankAb, kind, text, point?, line? }：
 *   kind：point 唯一解 / line 交于一线 / two-same 两个重合 / plane 三个重合 / parallel 三个平行 / two-same-parallel / two-parallel / prism 三棱柱；
 *   text 是给学生看的一句（带两个秩）。秩按 1e-9 的相对容差（系数差 1e-12 的当成退化）
 */
export function planes3(P1, P2, P3) {
  const ps = [P1, P2, P3];
  const rows = ps.map((p) => { const l = len(p.n); return [...mul(1 / l, p.n), dot(p.n, p.p0) / l]; });
  const scale = Math.max(1, ...rows.map((r) => Math.abs(r[3])));
  const rankA = rankOf(rows.map((r) => r.slice(0, 3))), rankAb = rankOf(rows.map((r) => [r[0], r[1], r[2], r[3] / scale]));
  const pairs = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => planeMeet2(ps[i], ps[j]));
  // 几种情形和画出来的交线用同一把尺子（2026-11-21：以前秩和两两的交线各用各的容差，系数差 1e-9 时
  // 说「三个平面平行」却画了两条交线）。先看两两的关系，秩只在两两都相交时用来分「一点 / 一条线 / 三棱柱」
  const nLine = pairs.filter((m) => m && !m.same).length, nSame = pairs.filter((m) => m && m.same).length;
  let kind, point, line;
  if (nLine === 3) {
    if (rankA === 3) {
      kind = 'point';
      // 克拉默：x = [d1 (n2 × n3) + d2 (n3 × n1) + d3 (n1 × n2)] / (n1 · n2 × n3)
      const [n1, n2, n3] = ps.map((p) => p.n), [d1, d2, d3] = ps.map((p) => dot(p.n, p.p0));
      point = mul(1 / dot(n1, cross(n2, n3)), add(add(mul(d1, cross(n2, n3)), mul(d2, cross(n3, n1))), mul(d3, cross(n1, n2))));
    } else if (rankAb === 3) kind = 'prism';
    else { kind = 'line'; line = pairs[0]; }
  } else if (nLine === 2) {
    if (nSame) { kind = 'two-same'; line = pairs.find((m) => m && !m.same); } else kind = 'two-parallel';
  } else kind = nSame === 3 ? 'plane' : nSame ? 'two-same-parallel' : 'parallel';
  const RANKS = { point: [3, 3], line: [2, 2], 'two-same': [2, 2], prism: [2, 3], 'two-parallel': [2, 3], plane: [1, 1], 'two-same-parallel': [1, 2], parallel: [1, 2] };
  const [rA, rAb] = RANKS[kind];
  // 要画的交线：一条线、两张重合的只画那一条；都平行的不画（两两的交线只剩一条的那种数值边角也不画）
  const meets = kind === 'line' || kind === 'two-same' ? [line, null, null] : nLine >= 2 ? pairs.map((m) => (m && !m.same ? m : null)) : [null, null, null];
  return { rankA: rA, rankAb: rAb, kind, text: `r(A) = ${rA}，r(A, b) = ${rAb}：${P3_TEXT[kind]}`, meets, ...(point ? { point } : {}), ...(line ? { line } : {}) };
}

/**
 * 凸多边形被平面切成两块：回 [法向量那一侧的, 另一侧的]，哪一侧没有就是 null。
 * 多边形就在这个平面上的不切（整个算在一侧）
 */
export function splitPolygon(poly, plane) {
  const l = len(plane.n), s = poly.map((p) => dot(plane.n, sub(p, plane.p0)) / l);
  const eps = 1e-9 * Math.max(1, ...poly.flat().map(Math.abs));
  const pos = s.some((x) => x > eps), neg = s.some((x) => x < -eps);
  if (!neg) return [poly, null];
  if (!pos) return [null, poly];
  const f = [], b = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length, a = poly[i], c = poly[j], sa = s[i], sc = s[j];
    if (sa >= -eps) f.push(a);
    if (sa <= eps) b.push(a);
    if ((sa > eps && sc < -eps) || (sa < -eps && sc > eps)) { const t = sa / (sa - sc), m = add(a, mul(t, sub(c, a))); f.push(m); b.push(m); }
  }
  return [f.length >= 3 ? f : null, b.length >= 3 ? b : null];
}

/** 几张平面片互相切开：polys 是 [{ poly, of: 它是第几张平面, … }]，每块被别的平面都切一遍（切出来的小块前后才排得对） */
export function splitAll(polys, planes) {
  let out = polys;
  planes.forEach((pl, k) => {
    const next = [];
    for (const o of out) {
      if (o.of === k) { next.push(o); continue; }
      for (const piece of splitPolygon(o.poly, pl)) if (piece) next.push({ ...o, poly: piece });
    }
    out = next;
  });
  return out;
}

// —— 旋转体 ——

/**
 * 曲线 y = f(x)（a ≤ x ≤ b）转出来的面。axis 'x'：绕 x 轴，点是 [x, f cos t, f sin t]；
 * 'y'：绕 y 轴——图里竖着的那根是 z，点是 [x cos t, x sin t, f(x)]。upTo：转到多大的角（默认一整圈）
 */
export function revolveMesh(f, [a, b], axis = 'x', { n = 24, m = 32, upTo = 2 * Math.PI } = {}) {
  const F = num1(f);
  const P = axis === 'y' ? (x, t) => { const h = F(x); return [x * Math.cos(t), x * Math.sin(t), h]; } : (x, t) => { const r = F(x); return [x, r * Math.cos(t), r * Math.sin(t)]; };
  return meshGrid(P, [a, b], [0, upTo], { nu: n, nv: m });
}

/** 旋转体的体积：绕 x 轴 π∫f²（圆盘法），绕 y 轴 2π∫|x f|（柱壳法）。算不出来是 NaN */
export function revolveVolume(f, a, b, axis = 'x') {
  const F = num1(f);
  // 绕 y 轴、x 跨过 0：左右两半转出来叠在一起，2π∫|x f| 会算两遍（画面另报写法错误）
  if (axis === 'y' && a * b < 0) return NaN;
  const r = axis === 'y' ? numIntegral((x) => 2 * Math.PI * Math.abs(x * F(x)), a, b) : numIntegral((x) => Math.PI * F(x) ** 2, a, b);
  return r.ok === true ? Math.abs(r.value) : NaN;
}

/** 绕 x 轴的侧面积 2π∫|f|√(1 + f′²) */
export function revolveArea(f, df, a, b) {
  const F = num1(f), D = num1(df);
  const r = numIntegral((x) => 2 * Math.PI * Math.abs(F(x)) * Math.hypot(1, D(x)), a, b);
  return r.ok === true ? Math.abs(r.value) : NaN;
}

// —— 两张曲面之间的区域 ——

/** 点在底里面有多深（正的在里面，0 在边上；连续的——截面的边界要拿它当等值线画） */
export function baseDepth(base, x, y) {
  if (base.rect) return Math.min(x - base.rect[0], base.rect[1] - x, y - base.rect[2], base.rect[3] - y);
  // 两条线之间（不论谁写在前）：画的那一块（basePoint 在两条线之间插值）、fx/plane.js 的 inTyped 都是这个口径
  const l0 = num1(base.lo), h0 = num1(base.hi), lo = (t) => Math.min(l0(t), h0(t)), hi = (t) => Math.max(l0(t), h0(t));
  const a = Math.min(base.a, base.b), b = Math.max(base.a, base.b);
  if (base.shape === 'r') {
    const r = Math.hypot(x, y);
    let t = Math.atan2(y, x);
    t += Math.ceil((a - t) / (2 * Math.PI) - 1e-12) * 2 * Math.PI;
    const full = b - a >= 2 * Math.PI - 1e-9;
    if (!full && t > b) return -Math.min(t - b, a + 2 * Math.PI - t) * Math.max(r, 1e-9);
    const d = Math.min(r - lo(t), hi(t) - r);
    return full ? d : Math.min(d, (t - a) * r, (b - t) * r);
  }
  const [p, q] = base.shape === 'y' ? [x, y] : [y, x];
  return Math.min(p - a, b - p, q - lo(p), hi(p) - q);
}

/** 区域 { z 从 lo(x, y) 到 hi(x, y)，(x, y) 在 base 里 } 的边界：{ bottom, top（两张网格）, walls（侧面上的竖线，每条两个点） } */
export function solidBounds(lo, hi, base, { n = 24, m = 12 } = {}) {
  const bottom = meshOver(lo, base, { n, m }), top = meshOver(hi, base, { n, m });
  const W = bottom.nu + 1, walls = [];
  const edge = [];
  for (let i = 0; i <= bottom.nu; i++) edge.push(i, bottom.nv * W + i);
  for (let j = 1; j < bottom.nv; j++) edge.push(j * W, j * W + bottom.nu);
  for (const k of edge) {
    const p = bottom.pts[k], q = top.pts[k];
    if (p && q && Math.abs(p[2] - q[2]) > 1e-9) walls.push([p, q]);
  }
  return { bottom, top, walls };
}

/** 区域里过 (x, y) 竖着的那一根（先一后二的「一」）：{ z0, z1 }；(x, y) 不在底里、上下限没定义、下面比上面高回 null */
export function columnOf(lo, hi, base, x, y) {
  if (!(baseDepth(base, x, y) >= -1e-12)) return null;
  const z0 = num1(lo)(x, y), z1 = num1(hi)(x, y);
  return Number.isNaN(z0) || Number.isNaN(z1) || z0 > z1 ? null : { z0, z1 };
}

// 底在 xy 平面上占多大
function baseBox(base) {
  if (base.rect) return { x0: base.rect[0], x1: base.rect[1], y0: base.rect[2], y1: base.rect[3] };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i <= 64; i++) for (const t of [0, 1]) {
    const q = basePoint(base, i / 64, t);
    if (!q) continue;
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
  }
  const px = (x1 - x0) * 0.04 + 1e-6, py = (y1 - y0) * 0.04 + 1e-6;
  return { x0: x0 - px, x1: x1 + px, y0: y0 - py, y1: y1 + py };
}

/** 截面法：平面 z = z0 截这个区域，截出来那一块的边界（三维的折线，都在 z = z0 上）。截不到回 [] */
export function crossSection(lo, hi, base, z0, { grid = 64 } = {}) {
  const L = num1(lo), H = num1(hi);
  const box = baseBox(base);
  if (!Number.isFinite(box.x0 + box.x1 + box.y0 + box.y1)) return [];
  const G = (x, y) => { const d = baseDepth(base, x, y); if (!(d > -1e9)) return NaN; if (d < 0) return d; return Math.min(H(x, y) - z0, z0 - L(x, y), d); };
  return contourLines(G, 0, box, { nx: grid, ny: grid }).map((l) => l.map(([x, y]) => [x, y, z0]));
}

/**
 * 截面的面积（截面法里的 A(z)）：在底自己的坐标 (p, q) 里算（极坐标的底是 θ、r，面积元 r）——
 * 每条 p = 常数的线上找出截面占的那几段（扫一遍、变号的地方二分），段长（带面积元）对 p 积分。
 * 截不到是 0；算不出来是 NaN。截面正好贴着平的顶 / 底时算那一面（往里让一丁点）；
 * 上下限没定义的地方没有立体（球写在比它大的矩形上）。比扫的间距还窄的一条（碗底、锥尖那一点）数不到，当 0
 */
export function sectionArea(lo, hi, base, z0) {
  const L = num1(lo), H = num1(hi);
  const polar = !base.rect && base.shape === 'r';
  const xy = base.rect || base.shape === 'y' ? (p, q) => [p, q] : polar ? (t, r) => [r * Math.cos(t), r * Math.sin(t)] : (p, q) => [q, p];
  const X = base.rect ? [base.rect[0], base.rect[1]] : [base.a, base.b];
  const yl = base.rect ? () => base.rect[2] : num1(base.lo), yh = base.rect ? () => base.rect[3] : num1(base.hi);
  const eps = 1e-9 * Math.max(1, Math.abs(z0));
  const inside = (p, q) => { const [x, y] = xy(p, q), h = H(x, y), l = L(x, y); return h - z0 + eps > 0 && z0 - l + eps > 0; }; // NaN 比什么都是 false：没定义的地方不在里面
  // 一段 [q1, q2] 的「长」：直角坐标是长度，极坐标 ∫ r dr
  const piece = polar ? (q1, q2) => Math.abs(q2 * Math.abs(q2) - q1 * Math.abs(q1)) / 2 : (q1, q2) => q2 - q1;
  const N = 48;
  const line = (p) => {
    const a0 = yl(p), b0 = yh(p);
    if (!Number.isFinite(a0 + b0)) return 0;
    // 两头往里让一丁点：根号写的边界（y = ±√(4 − x²)）正好在边上会因舍入没定义
    const a = Math.min(a0, b0), b = Math.max(a0, b0), d = 1e-12 * (b - a);
    if (!(b > a)) return 0;
    const cut = (q1, q2, in1) => { let u = q1, w = q2; for (let k = 0; k < 40; k++) { const m = (u + w) / 2; if (inside(p, m) === in1) u = m; else w = m; } return (u + w) / 2; };
    let sum = 0, prev = a + d, was = inside(p, prev), start = was ? prev : null;
    for (let j = 1; j <= N; j++) {
      const q = j === N ? b - d : a + ((b - a) * j) / N, now = inside(p, q);
      if (now !== was) { const c = cut(prev, q, was); if (was) { sum += piece(start, c); start = null; } else start = c; }
      prev = q; was = now;
    }
    if (was) sum += piece(start, b - d);
    return sum;
  };
  const dp = 1e-12 * Math.abs(X[1] - X[0]), x0 = Math.min(X[0], X[1]) + dp, x1 = Math.max(X[0], X[1]) - dp;
  if (!(x1 > x0)) return 0;
  // 对 p 积。线上的段长是连续的、可以有折（截面的边拐过去），截面开始、结束的地方常是根号的样子（球的截面
  // 两头 √(p − p₀)）：先找出段长大于 0 的那几段 p，每一段用 p = 中点 − 半宽·cos θ 换元（根号的两头变平滑），
  // 再等分三点高斯（以前整个范围等分 160 段，两头的根号只准到约 1e-4）
  const S = 160, step = (x1 - x0) / S, vals = Array.from({ length: S + 1 }, (_, i) => line(x0 + step * i));
  const edge = (u, w, inU) => { for (let k = 0; k < 50; k++) { const m = (u + w) / 2; if ((line(m) > 0) === inU) u = m; else w = m; } return (u + w) / 2; };
  const runs = [];
  let from = vals[0] > 0 ? x0 : null;
  for (let i = 1; i <= S; i++) {
    const p = x0 + step * i, was = vals[i - 1] > 0, now = vals[i] > 0;
    if (was !== now) { const c = edge(p - step, p, was); if (was) { runs.push([from, c]); from = null; } else from = c; }
  }
  if (from !== null) runs.push([from, x1]);
  const M = 96, g = Math.sqrt(0.6);
  let total = 0;
  for (const [a, b] of runs) {
    const mid = (a + b) / 2, half = (b - a) / 2, w = Math.PI / M;
    const f = (t) => line(mid - half * Math.cos(t)) * half * Math.sin(t);
    for (let i = 0; i < M; i++) { const c = (i + 0.5) * w; total += (w / 18) * (5 * f(c - (g * w) / 2) + 8 * f(c) + 5 * f(c + (g * w) / 2)); }
  }
  return Number.isFinite(total) ? total : NaN;
}

/** 平面和一个长方体盒子（{ x0, x1, y0, y1, z0, z1 }）的截面多边形（3～6 个顶点）；不相交回 null */
export function planeInBox(plane, box) {
  const n = mul(1 / len(plane.n), plane.n);
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = mul(1 / len(sub(a, mul(dot(a, n), n))), sub(a, mul(dot(a, n), n))), e2 = cross(n, e1);
  const c = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, (box.z0 + box.z1) / 2];
  const o = sub(c, mul(dot(n, sub(c, plane.p0)), n)); // 盒子中心在平面上的投影
  const h = 2 * Math.hypot(box.x1 - box.x0, box.y1 - box.y0, box.z1 - box.z0);
  let poly = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => add(o, add(mul(s * h, e1), mul(t * h, e2))));
  const faces = [[[1, 0, 0], [box.x0, 0, 0]], [[-1, 0, 0], [box.x1, 0, 0]], [[0, 1, 0], [0, box.y0, 0]], [[0, -1, 0], [0, box.y1, 0]], [[0, 0, 1], [0, 0, box.z0]], [[0, 0, -1], [0, 0, box.z1]]];
  for (const [fn, fp] of faces) { poly = splitPolygon(poly, { n: fn, p0: fp })[0]; if (!poly) return null; }
  return poly;
}

/** 空间向量场：n × n × n 个格点上各一个箭头 { p, d }。长度按大小相对最大值开平方，缩放到格距的 0.15～0.6 倍（三维里箭头长了互相挡）；零向量不画 */
export function fieldArrows3(P, Q, R, box, n = 4) {
  const f = [num1(P), num1(Q), num1(R)], raw = [];
  const at = (lo, hi, i) => (n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const p = [at(box.x0, box.x1, i), at(box.y0, box.y1, j), at(box.z0, box.z1, k)], v = f.map((g) => g(...p)), m = len(v);
    if (v.some(Number.isNaN) || !(m > 1e-12)) continue;
    raw.push({ p, v, m });
  }
  const max = Math.max(0, ...raw.map((r) => r.m));
  const step = Math.min(box.x1 - box.x0, box.y1 - box.y0, box.z1 - box.z0) / Math.max(1, n - 1);
  return raw.map(({ p, v, m }) => ({ p, d: mul((step * (0.15 + 0.45 * Math.sqrt(m / max))) / m, v) }));
}

// —— 三阶矩阵的实特征方向 ——

// (M 的零空间) 的一组标准正交基：行化简，容差 tol
function nullSpace(M, tol) {
  const m = M.map((r) => r.slice()), piv = [];
  let row = 0;
  for (let col = 0; col < 3 && row < 3; col++) {
    let p = row;
    for (let i = row + 1; i < 3; i++) if (Math.abs(m[i][col]) > Math.abs(m[p][col])) p = i;
    if (Math.abs(m[p][col]) <= tol) continue;
    [m[row], m[p]] = [m[p], m[row]];
    const k = m[row][col];
    for (let j = 0; j < 3; j++) m[row][j] /= k;
    for (let i = 0; i < 3; i++) if (i !== row) { const c = m[i][col]; for (let j = 0; j < 3; j++) m[i][j] -= c * m[row][j]; }
    piv.push(col);
    row++;
  }
  const free = [0, 1, 2].filter((c) => !piv.includes(c)), out = [];
  for (const fc of free) {
    const v = [0, 0, 0];
    v[fc] = 1;
    piv.forEach((pc, r) => { v[pc] = -m[r][fc]; });
    // 和前面的正交化
    let w = v;
    for (const u of out) w = sub(w, mul(dot(w, u), u));
    const l = len(w);
    if (l > 1e-9) out.push(mul(1 / l, w));
  }
  return out;
}

// 实对称矩阵：雅可比转动。特征值、特征向量一个不丢（挨得再近也是三个互相垂直的方向）
function jacobi3(a) {
  const A = a.map((r) => r.slice()), V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 40; sweep++) {
    if (Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]) < 1e-17) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), sn = t * c;
      for (let k = 0; k < 3; k++) { const x = A[k][p], y = A[k][q]; A[k][p] = c * x - sn * y; A[k][q] = sn * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = A[p][k], y = A[q][k]; A[p][k] = c * x - sn * y; A[q][k] = sn * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - sn * y; V[k][q] = sn * x + c * y; }
    }
  }
  return [0, 1, 2].map((j) => ({ value: A[j][j], vector: [V[0][j], V[1][j], V[2][j]] })).sort((x, y) => x.value - y.value);
}

/**
 * 3 × 3 实矩阵的实特征值和特征方向：[{ value, vectors（这个特征值的特征子空间的一组标准正交基：1、2 或 3 个） }]，按特征值从小到大。
 * 复的特征值不回（转动的矩阵只有转轴那一个）。重根看得出只有一个方向还是有一个平面。
 * 对称矩阵走雅可比；别的解三次方程——三个根全是实的还是只有一个，看的是相对的量（根挨得近时判别式是差的六次方，不能拿绝对的小数去比）
 */
export function eig3(A) {
  const s = Math.max(1e-300, ...A.flat().map(Math.abs));
  const a = A.map((r) => r.map((x) => x / s));
  if (Math.abs(a[0][1] - a[1][0]) + Math.abs(a[0][2] - a[2][0]) + Math.abs(a[1][2] - a[2][1]) < 1e-13) {
    const out = [];
    for (const e of jacobi3(a)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.value / s - e.value) < 1e-9) last.vectors.push(e.vector); else out.push({ value: e.value * s, vectors: [e.vector] });
    }
    return out;
  }
  const tr = a[0][0] + a[1][1] + a[2][2];
  const c1 = a[0][0] * a[1][1] - a[0][1] * a[1][0] + a[0][0] * a[2][2] - a[0][2] * a[2][0] + a[1][1] * a[2][2] - a[1][2] * a[2][1];
  const det = dot(a[0], cross(a[1], a[2]));
  // λ³ − tr λ² + c1 λ − det = 0，换成 t = λ − tr/3：t³ + p t + q = 0
  const p = c1 - (tr * tr) / 3, q = (-2 * tr ** 3) / 27 + (tr * c1) / 3 - det, sh = tr / 3;
  let roots;
  if (p > -1e-14) roots = [p < 1e-14 ? Math.cbrt(-q) : (() => { const r = Math.sqrt((q * q) / 4 + p ** 3 / 27); return Math.cbrt(-q / 2 + r) + Math.cbrt(-q / 2 - r); })()];
  else {
    const m = 2 * Math.sqrt(-p / 3), arg = (3 * q) / (p * m);
    // |arg| ≤ 1：三个实根（等于 1 是重根）。略大于 1 的当成重根试——是一对虚部很小的复根的话，下面找不到特征向量，自己就落选了
    if (Math.abs(arg) <= 1 + 1e-9) { const th = Math.acos(Math.max(-1, Math.min(1, arg))) / 3; roots = [0, 1, 2].map((k) => m * Math.cos(th - (2 * Math.PI * k) / 3)); } else roots = [(q > 0 ? -1 : 1) * m * Math.cosh(Math.acosh(Math.abs(arg)) / 3)];
  }
  // 在特征多项式上再牛顿两步（三角公式在根挨得近时丢几位）
  const poly = (x) => ((x - tr) * x + c1) * x - det, dpoly = (x) => (3 * x - 2 * tr) * x + c1;
  const vals = roots.map((t) => { let x = t + sh; for (let k = 0; k < 2; k++) { const d = dpoly(x); if (Math.abs(d) > 1e-12) x -= poly(x) / d; } return x; }).sort((x, y) => x - y);
  // 重根在三次方程上只准到一半的位数；它同时是导数（二次）的根，那个是准的
  const dd = 4 * tr * tr - 12 * c1;
  if (dd >= 0) for (let i = 0; i < vals.length; i++) for (const r of [(2 * tr + Math.sqrt(dd)) / 6, (2 * tr - Math.sqrt(dd)) / 6]) if (Math.abs(r - vals[i]) < 1e-5 && Math.abs(poly(r)) < 1e-13) vals[i] = r;
  const out = [];
  for (const lam of vals) {
    if (out.length && Math.abs(out[out.length - 1].value / s - lam) < 2e-6) continue;
    const vectors = nullSpace(a.map((r, i) => r.map((x, j) => x - (i === j ? lam : 0))), 1e-6);
    if (vectors.length) out.push({ value: lam * s, vectors });
  }
  return out;
}

/**
 * 显式曲面 z = f(x, y) 在 (x, y) 的切平面：{ p: 切点, n: 法向量 [−f_x, −f_y, 1] }。那一点没定义、不可微（圆锥的顶点、|x| 的棱）回 null。
 * 可不可微看左右差商：步长缩小八倍以后两边还是差那么多的是折角，跟着缩小的只是弯得厉害
 */
export function tangentPlane(f, x, y, h) {
  const F = num1(f), z = F(x, y);
  if (Number.isNaN(z)) return null;
  const gap = (dx, dy, k) => { const a = F(x + dx * k, y + dy * k), b = F(x - dx * k, y - dy * k); return Number.isNaN(a) || Number.isNaN(b) ? NaN : { d: Math.abs((a - z) / k - (z - b) / k), s: Math.max(1, Math.abs((a - z) / k), Math.abs((z - b) / k)), c: (a - b) / (2 * k) }; };
  const out = [];
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const g1 = gap(dx, dy, h), g2 = gap(dx, dy, h / 8);
    if (!g1.s || !g2.s) return null; // 有一边没定义（定义域的边上）
    if (g2.d > 0.02 * g2.s && g2.d > 0.5 * g1.d) return null;
    out.push(g1.c);
  }
  if (!Number.isFinite(out[0] + out[1])) return null;
  return { p: [x, y, z], n: [-out[0], -out[1], 1] };
}

/** 空间曲线 P(t) 在 t 的单位切向量。那一点没定义、速度是零（尖点）、左右方向对不上（折角）回 null */
export function curveTangent(P, t, h) {
  const at = (u) => { let p; try { p = P(u); } catch { return null; } return fin(p) ? p : null; };
  const p = at(t), q1 = at(t - h), q2 = at(t + h);
  if (!p || !q1 || !q2) return null;
  const d = sub(q2, q1), speed = len(d) / (2 * h);
  // 速度是零：和旁边比（差商在尖点上是 h² 的量级，不会正好是 0）
  const far = [at(t - 50 * h), at(t - 49 * h), at(t + 49 * h), at(t + 50 * h)];
  const around = Math.max(far[0] && far[1] ? len(sub(far[1], far[0])) / h : 0, far[2] && far[3] ? len(sub(far[3], far[2])) / h : 0);
  if (!(speed > 1e-12) || speed < 1e-3 * around) return null;
  // 折角：左右两边的方向在更小的步长上还是对不上
  const k = h / 8, r1 = at(t - k), r2 = at(t + k);
  if (r1 && r2) { const u = sub(p, r1), w = sub(r2, p), lu = len(u), lw = len(w); if (lu > 0 && lw > 0 && dot(u, w) / (lu * lw) < 0.999) return null; }
  return mul(1 / len(d), d);
}

/** 一元函数 g 在 [d0, d1] 上的变号点（等分 n 段找、二分求）：视线和曲面碰了几次、各在多深。没定义的一段两边不连成假根 */
export function rootsAlong(g, d0, d1, n = 240) {
  const G = num1(g), out = [];
  let a = d0, ga = G(a);
  for (let i = 1; i <= n; i++) {
    const b = d0 + ((d1 - d0) * i) / n, gb = G(b);
    if (!Number.isNaN(ga) && !Number.isNaN(gb) && (ga > 0) !== (gb > 0)) {
      let lo = a, hi = b, gl = ga, ok = true;
      for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2, gm = G(m); if (Number.isNaN(gm)) { ok = false; break; } if ((gm > 0) === (gl > 0)) { lo = m; gl = gm; } else hi = m; }
      if (ok) out.push((lo + hi) / 2);
    }
    a = b; ga = gb;
  }
  return out;
}

/**
 * 竖直方向对准哪里：{ zc: 盒子的中心, half: 内容的半高 }。zs 是内容上取的一些 z。
 * 冲上天的那几个值（1/r² 靠近 0）不算进高度；写了范围 R、内容又比盒子高的，盒子贴着内容多的那一头
 */
export function frameZ(zs, R) {
  const a = zs.filter(Number.isFinite).sort((p, q) => p - q);
  if (!a.length) return { zc: 0, half: 0 };
  const lo = a[Math.floor((a.length - 1) * 0.1)], hi = a[Math.ceil((a.length - 1) * 0.9)], mid = hi - lo;
  const bot = Math.max(a[0], lo - 2 * mid), top = Math.min(a[a.length - 1], hi + 2 * mid);
  const half = (top - bot) / 2;
  if (!(R > 0) || half <= R) return { zc: (bot + top) / 2, half };
  const med = a[Math.floor(a.length / 2)];
  return { zc: Math.max(bot + R, Math.min(top - R, med)), half };
}

/** 一个多边形裁到 z0 ≤ z ≤ z1 里；整个在外面回 null */
export function clipPolyZ(poly, z0, z1) {
  const a = splitPolygon(poly, { n: [0, 0, 1], p0: [0, 0, z0] })[0];
  if (!a) return null;
  return splitPolygon(a, { n: [0, 0, -1], p0: [0, 0, z1] })[0] || null;
}

/** F(x, y, z) 是不是一次式：是就回 [a, b, c, d]（F = ax + by + cz + d），不是回 null。多探几个点（只探一个点时 x² + y 会混过去） */
export function linearPlane(F) {
  const d = F(0, 0, 0), a = F(1, 0, 0) - d, b = F(0, 1, 0) - d, c = F(0, 0, 1) - d;
  if (![a, b, c, d].every(Number.isFinite)) return null; // 在原点附近没定义、是无穷：不是平面
  const tol = 1e-9 * Math.max(1, Math.abs(d), Math.abs(a), Math.abs(b), Math.abs(c));
  for (const [x, y, z] of [[1, 2, 3], [-2, 1, 0.5], [0.3, -0.7, 2], [-1, -1, -1], [2, 0, -3]]) {
    const v = F(x, y, z);
    if (!(Math.abs(v - (a * x + b * y + c * z + d)) <= tol * (1 + Math.abs(x) + Math.abs(y) + Math.abs(z)))) return null;
  }
  return [a, b, c, d];
}

/** 四边形（四个角按顺序）切成 n × n 小块（双线性插值），每块四个角。切平面这种一整张的面片按块排远近用 */
export function subdivideQuad(q, n = 6) {
  const at = (s, t) => [0, 1, 2].map((k) => (1 - s) * (1 - t) * q[0][k] + s * (1 - t) * q[1][k] + s * t * q[2][k] + (1 - s) * t * q[3][k]);
  const out = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push([at(i / n, j / n), at((i + 1) / n, j / n), at((i + 1) / n, (j + 1) / n), at(i / n, (j + 1) / n)]);
  return out;
}
