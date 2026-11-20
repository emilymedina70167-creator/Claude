// 平面上两个变量的几何（视觉交互第 2 批；纯函数，tests/fx-plane.test.js）。画在 graph.js。
//   等值线（隐函数的曲线、等高线）、参数曲线、方向场、向量场、过一点的解曲线、
//   积分区域（X 型、Y 型、极坐标；任意条件）、区域里的一条、把点投到曲线上。
// 以前等高线只有二次型能画（借 scene 的 conic），方向场、区域都是主讲一条条手写；这里交给页面算。
// 坐标都是数学坐标。F(x, y) 算不出来（抛错、NaN、无穷）一律当没定义。

export const PLANE_MAX_GRID = 120; // 行进方格的网格一边最多几格（一帧里画得完）
export const PLANE_MAX_LEVELS = 12;

const val2 = (F) => (x, y) => { let v; try { v = F(x, y); } catch { return NaN; } return typeof v === 'number' && Number.isFinite(v) ? v : NaN; };
const clampN = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n)) || lo));

/**
 * 等值线 F(x, y) = level：行进方格。回几条折线，每条 [[x, y], …]。
 * 格子的四个角有没定义的就跳过；鞍点的格子（对角同号）按格子中心的值决定怎么连。
 */
export function contourLines(F, level, box, { nx = 96, ny = 96 } = {}) {
  const f = val2(F);
  nx = clampN(nx, 2, PLANE_MAX_GRID); ny = clampN(ny, 2, PLANE_MAX_GRID);
  const dx = (box.x1 - box.x0) / nx, dy = (box.y1 - box.y0) / ny;
  const g = [];
  for (let j = 0; j <= ny; j++) { const row = new Float64Array(nx + 1); for (let i = 0; i <= nx; i++) row[i] = f(box.x0 + i * dx, box.y0 + j * dy) - level; g.push(row); }
  // 正好落在等值线上的格点挪开一点点：不然一条线会在格点上断成好几截、鞍点的四支分不清
  const eps = 1e-12;
  for (const row of g) for (let i = 0; i <= nx; i++) if (row[i] === 0) row[i] = eps;
  // 交点按「哪条格子边」记：横边 h(i, j) 是 (i, j)—(i+1, j)，竖边 v(i, j) 是 (i, j)—(i, j+1)。
  // 相邻两个格子共用一条边，按边的编号接线——按坐标接的话，同一个交点从两边各算一次会差出最后一位，线就断了
  const W1 = nx + 1;
  const hId = (i, j) => 2 * (j * W1 + i), vId = (i, j) => 2 * (j * W1 + i) + 1;
  const pts = new Map();
  const cross = (id, xa, ya, va, xb, yb, vb) => { if (!pts.has(id)) { const t = va / (va - vb); pts.set(id, [xa + (xb - xa) * t, ya + (yb - ya) * t]); } return id; };
  const segs = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = g[j][i], v1 = g[j][i + 1], v2 = g[j + 1][i + 1], v3 = g[j + 1][i]; // 左下、右下、右上、左上
    if (Number.isNaN(v0) || Number.isNaN(v1) || Number.isNaN(v2) || Number.isNaN(v3)) continue;
    const x0 = box.x0 + i * dx, y0 = box.y0 + j * dy, x1 = x0 + dx, y1 = y0 + dy;
    const e = {};
    if (v0 * v1 < 0) e.b = cross(hId(i, j), x0, y0, v0, x1, y0, v1);
    if (v1 * v2 < 0) e.r = cross(vId(i + 1, j), x1, y0, v1, x1, y1, v2);
    if (v3 * v2 < 0) e.t = cross(hId(i, j + 1), x0, y1, v3, x1, y1, v2);
    if (v0 * v3 < 0) e.l = cross(vId(i, j), x0, y0, v0, x0, y1, v3);
    const ks = Object.keys(e);
    if (ks.length === 2) segs.push([e[ks[0]], e[ks[1]]]);
    else if (ks.length === 4) {
      // 鞍点：四条边都有交点。中心和左下角同号 → 左下角不被单独切出去
      const c = f(x0 + dx / 2, y0 + dy / 2) - level;
      if ((Number.isNaN(c) ? v0 : c) * v0 > 0) segs.push([e.b, e.r], [e.t, e.l]);
      else segs.push([e.b, e.l], [e.t, e.r]);
    }
  }
  return joinSegs(segs).map((line) => line.map((id) => pts.get(id)));
}

// 线段（两头是边的编号）首尾接成折线
function joinSegs(segs) {
  const ends = new Map(); // 边的编号 → 用到它的线段下标
  segs.forEach((s, i) => { for (const k of s) { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
  const used = new Uint8Array(segs.length), out = [];
  const grow = (line, atEnd) => {
    for (;;) {
      const tip = atEnd ? line[line.length - 1] : line[0];
      const next = (ends.get(tip) || []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [a, b] = segs[next];
      const other = a === tip ? b : a;
      if (atEnd) line.push(other); else line.unshift(other);
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    grow(line, true); grow(line, false);
    out.push(line);
  }
  return out;
}

/** 参数曲线 P(t) = [x, y]，t 从 a 到 b。没定义的点、跳得太远（给了 box：超过对角线的 1/4）的地方断开 */
export function paramCurve(P, a, b, { n = 400, box = null } = {}) {
  const out = [];
  let cur = null;
  const far = box ? Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 4 : Infinity;
  for (let i = 0; i <= n; i++) {
    const t = a + ((b - a) * i) / n;
    let p;
    try { p = P(t); } catch { p = null; }
    const ok = Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
    if (!ok) { cur = null; continue; }
    if (cur && Math.hypot(p[0] - cur[cur.length - 1][0], p[1] - cur[cur.length - 1][1]) > far) cur = null;
    if (!cur) { cur = []; out.push(cur); }
    cur.push([p[0], p[1]]);
  }
  return out.filter((s) => s.length >= 2);
}

/**
 * 方向场 y′ = F(x, y)：每个格点一小段，中心在格点、方向 (1, F)。
 * aspect：屏幕上 y 方向每单位的像素 ÷ x 方向的（不等比例的图里，让每一段在屏幕上一样长）；不传按数学坐标。
 */
export function slopeMarks(F, box, { nx = 17, ny = 11, aspect = 1 } = {}) {
  const f = val2(F), out = [];
  const sx = (box.x1 - box.x0) / Math.max(1, nx - 1), sy = (box.y1 - box.y0) / Math.max(1, ny - 1);
  const len = 0.38 * Math.min(sx, sy * aspect); // 屏幕上的长度（按 x 的单位量）
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = box.x0 + i * sx, y = box.y0 + j * sy, k = f(x, y);
    if (Number.isNaN(k)) continue;
    const m = Math.hypot(1, k * aspect);
    out.push({ x, y, dx: len / m, dy: (len * k) / m });
  }
  return out;
}

/** 向量场 (P, Q)：每个格点一个箭头，从格点出发；长度按大小相对最大值开平方，缩放到格距的 0.2～0.85 倍。零向量不画 */
export function fieldArrows(P, Q, box, { nx = 15, ny = 10 } = {}) {
  const p = val2(P), q = val2(Q), raw = [];
  const sx = (box.x1 - box.x0) / Math.max(1, nx - 1), sy = (box.y1 - box.y0) / Math.max(1, ny - 1);
  let top = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = box.x0 + i * sx, y = box.y0 + j * sy, u = p(x, y), v = q(x, y);
    if (Number.isNaN(u) || Number.isNaN(v)) continue;
    const mag = Math.hypot(u, v);
    if (mag < 1e-12) continue;
    top = Math.max(top, mag);
    raw.push({ x, y, u, v, mag });
  }
  const step = Math.min(sx, sy);
  return raw.map(({ x, y, u, v, mag }) => { const L = step * (0.2 + 0.65 * Math.sqrt(mag / top)); return { x, y, dx: (u / mag) * L, dy: (v / mag) * L, mag }; });
}

// 往一边走：state → 下一个 state 的导数由 deriv 给；出了外框、算不出来、走满就停
function march(deriv, start, h, box, max) {
  const padX = (box.x1 - box.x0) * 0.2, padY = (box.y1 - box.y0) * 0.2;
  const inside = ([x, y]) => x >= box.x0 - padX && x <= box.x1 + padX && y >= box.y0 - padY && y <= box.y1 + padY;
  const out = [];
  let p = start;
  for (let i = 0; i < max; i++) {
    const k1 = deriv(p); if (!k1) break;
    const k2 = deriv([p[0] + (h / 2) * k1[0], p[1] + (h / 2) * k1[1]]); if (!k2) break;
    const k3 = deriv([p[0] + (h / 2) * k2[0], p[1] + (h / 2) * k2[1]]); if (!k3) break;
    const k4 = deriv([p[0] + h * k3[0], p[1] + h * k3[1]]); if (!k4) break;
    const q = [p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])];
    if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) break;
    if (!inside(q)) {
      // 出框的那一步：退回到外框上（解冲向无穷时，最后一点不落在几万的地方）
      const t = clipT(p, q, { x0: box.x0 - padX, x1: box.x1 + padX, y0: box.y0 - padY, y1: box.y1 + padY });
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      break;
    }
    out.push(q);
    p = q;
  }
  return out;
}
function clipT(p, q, b) {
  let t = 1;
  for (const [i, lo, hi] of [[0, b.x0, b.x1], [1, b.y0, b.y1]]) {
    const d = q[i] - p[i];
    if (d > 0) t = Math.min(t, (hi - p[i]) / d);
    else if (d < 0) t = Math.min(t, (lo - p[i]) / d);
  }
  return Math.max(0, Math.min(1, t));
}

/** 过 (x0, y0) 的解曲线 y′ = F(x, y)：RK4，沿弧长走（陡的地方步子不会跨出去一大截），往两边 */
export function flowLine(F, from, box, opts = {}) {
  const f = val2(F);
  // 按弧长参数化：(1, F) / |(1, F)|。竖直渐近线附近 x 的步子自己变小
  const dir = (s) => ([x, y]) => { const k = f(x, y); if (Number.isNaN(k)) return null; const m = Math.hypot(1, k); return [s / m, (s * k) / m]; };
  return bothWays(dir, from, box, opts);
}

/** 沿向量场 (P, Q) 的流线（按弧长走）；场是零的地方停 */
export function flowField(P, Q, from, box, opts = {}) {
  const p = val2(P), q = val2(Q);
  const dir = (s) => ([x, y]) => { const u = p(x, y), v = q(x, y), m = Math.hypot(u, v); if (Number.isNaN(m) || m < 1e-12) return null; return [(s * u) / m, (s * v) / m]; };
  return bothWays(dir, from, box, opts);
}
function bothWays(dir, from, box, { h, max = 4000 } = {}) {
  const step = h ?? Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 600;
  const fwd = march(dir(1), from, step, box, max / 2), back = march(dir(-1), from, step, box, max / 2);
  return [...back.reverse(), [from[0], from[1]], ...fwd];
}

const val1 = (g) => (t) => { let v; try { v = g(t); } catch { return NaN; } return typeof v === 'number' && Number.isFinite(v) ? v : NaN; };
const at = (kind, t, r) => (kind === 'y' ? [t, r] : kind === 'x' ? [r, t] : [r * Math.cos(t), r * Math.sin(t)]);

/**
 * 写成「一个变量从 lo 到 hi、另一个从 a 到 b」的区域：
 *   kind 'y'：x 从 a 到 b，y 从 lo(x) 到 hi(x)（X 型）；'x'：y 从 a 到 b，x 从 lo(y) 到 hi(y)（Y 型）；
 *   'r'：θ 从 a 到 b，r 从 lo(θ) 到 hi(θ)（极坐标）。
 * 回 { poly, ok }：poly 沿下边界去、沿上边界回；有取样点没定义时 ok 是 false（那几个点跳过）
 */
export function typedRegion(kind, lo, hi, a, b, { n = 120 } = {}) {
  const L = val1(lo), H = val1(hi), low = [], high = [];
  let ok = true;
  for (let i = 0; i <= n; i++) {
    const t = a + ((b - a) * i) / n, l = L(t), h = H(t);
    if (Number.isNaN(l) || Number.isNaN(h)) { ok = false; continue; }
    low.push(at(kind, t, l)); high.push(at(kind, t, h));
  }
  return { poly: [...low, ...high.reverse()], ok };
}

/** 区域在 t 处的那一条（竖条 / 横条 / 射线上的一段）；那里没定义回 null */
export function stripOf(kind, lo, hi, t) {
  const l = val1(lo)(t), h = val1(hi)(t);
  if (Number.isNaN(l) || Number.isNaN(h)) return null;
  return { from: at(kind, t, l), to: at(kind, t, h), lo: l, hi: h };
}

/**
 * 条件 C(x, y) 成立的地方：一行行的小矩形（同一行里挨着的合并）。
 * 整格都成立 / 都不成立的按一格算；四个角不一样的（边界上的）细分成 fine × fine 再看。
 */
export function whereRuns(C, box, { nx = 96, ny = 96, fine = 4 } = {}) {
  const c = (x, y) => { try { return !!C(x, y); } catch { return false; } };
  nx = clampN(nx, 1, PLANE_MAX_GRID); ny = clampN(ny, 1, PLANE_MAX_GRID);
  const dx = (box.x1 - box.x0) / nx, dy = (box.y1 - box.y0) / ny;
  const corner = [];
  for (let j = 0; j <= ny; j++) { const row = new Uint8Array(nx + 1); for (let i = 0; i <= nx; i++) row[i] = c(box.x0 + i * dx, box.y0 + j * dy) ? 1 : 0; corner.push(row); }
  const out = [];
  // 一行里连着成立的格子合成一个矩形
  const rowRuns = (y0, y1, cells, w, xStart) => {
    let from = -1;
    for (let i = 0; i <= cells.length; i++) {
      if (i < cells.length && cells[i]) { if (from < 0) from = i; } else if (from >= 0) { out.push({ x0: xStart + from * w, x1: xStart + i * w, y0, y1 }); from = -1; }
    }
  };
  for (let j = 0; j < ny; j++) {
    const y0 = box.y0 + j * dy;
    const whole = new Uint8Array(nx), mixed = [];
    for (let i = 0; i < nx; i++) {
      const s = corner[j][i] + corner[j][i + 1] + corner[j + 1][i] + corner[j + 1][i + 1];
      if (s === 4) whole[i] = 1; else if (s > 0) mixed.push(i);
    }
    rowRuns(y0, y0 + dy, whole, dx, box.x0);
    for (const i of mixed) {
      const x0 = box.x0 + i * dx, fx = dx / fine, fy = dy / fine;
      for (let q = 0; q < fine; q++) {
        const cells = new Uint8Array(fine);
        for (let p = 0; p < fine; p++) cells[p] = c(x0 + (p + 0.5) * fx, y0 + (q + 0.5) * fy) ? 1 : 0;
        rowRuns(y0 + q * fy, y0 + (q + 1) * fy, cells, fx, x0);
      }
    }
  }
  return out;
}

/** 把点投到 G(x, y) = 0 上：沿梯度的牛顿法。梯度是零、不收敛回 null */
export function projectTo(G, [x, y], { tol = 1e-9, max = 30 } = {}) {
  const g = val2(G);
  for (let i = 0; i < max; i++) {
    const v = g(x, y);
    // 值是无穷（极点旁边）、点跑到了无穷远：投不上
    if (!Number.isFinite(v) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(v) <= tol) return [x, y];
    const h = 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
    const gx = (g(x + h, y) - g(x - h, y)) / (2 * h), gy = (g(x, y + h) - g(x, y - h)) / (2 * h);
    const n2 = gx * gx + gy * gy;
    if (!(n2 > 1e-18)) return null;
    x -= (v * gx) / n2; y -= (v * gy) / n2;
  }
  return Math.abs(g(x, y)) <= tol * 1e3 ? [x, y] : null;
}
