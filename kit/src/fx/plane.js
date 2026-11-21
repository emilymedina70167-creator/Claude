// 平面上两个变量的几何（视觉交互第 2 批；纯函数，tests/fx-plane.test.js）。画在 graph.js。
//   等值线（隐函数的曲线、等高线）、参数曲线、方向场、向量场、过一点的解曲线、
//   积分区域（X 型、Y 型、极坐标；任意条件）、区域里的一条、把点投到曲线上。
// 以前等高线只有二次型能画（借 scene 的 conic），方向场、区域都是主讲一条条手写；这里交给页面算。
// 坐标都是数学坐标。F(x, y) 算不出来（抛错、NaN、无穷）一律当没定义。

export const PLANE_MAX_GRID = 120; // 行进方格的网格一边最多几格（一帧里画得完）
export const PLANE_MAX_LEVELS = 12;

const val2 = (F) => (x, y) => { let v; try { v = F(x, y); } catch { return NaN; } return typeof v === 'number' && Number.isFinite(v) ? v : NaN; };
const clampN = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n)) || lo));

// 正好落在等值线上的格点挪开一点点：不然一条线会在格点上断成好几截、鞍点的四支分不清
const EPS0 = 1e-12;
// 梯度很小的地方（鞍点、极值点旁边）一格里线拐得急，一格一条直线段接不上：这些格子每格再分 FINE × FINE
const FINE = 8, FINE_MAX_CELLS = 600, FLAT = 0.3;

// 一个格子里的线段。G：{ W1（一行几个格点）, base（边的编号从哪起）, cbase（角的编号）, val(i, j), zero(i, j), x(i), y(j) }
// 交点按「哪条格子边」记：横边 h(i, j) 是 (i, j)—(i+1, j)，竖边 v(i, j) 是 (i, j)—(i, j+1)。
// 相邻两个格子共用一条边，按边的编号接线——按坐标接的话，同一个交点从两边各算一次会差出最后一位，线就断了
function marchCell(G, i, j, pts, segs, mid) {
  const fake = G.fake || (G.fake = new Set());
  const v0 = G.val(i, j), v1 = G.val(i + 1, j), v2 = G.val(i + 1, j + 1), v3 = G.val(i, j + 1); // 左下、右下、右上、左上
  if (Number.isNaN(v0) || Number.isNaN(v1) || Number.isNaN(v2) || Number.isNaN(v3)) return;
  const x0 = G.x(i), y0 = G.y(j), x1 = G.x(i + 1), y1 = G.y(j + 1);
  const hId = (a, b) => G.base + 2 * (b * G.W1 + a), vId = (a, b) => G.base + 2 * (b * G.W1 + a) + 1;
  // 一条边两头异号不一定是线穿过去：极点（y = tan x 的渐近线）、跳跃（取整）两边也异号。
  // 所以每个交点验一下：在这条边上二分三次，真的零点两头的值会跟着小下去（到原来的 1/8 上下）；极点、跳跃的不会。
  // 顺手拿最后那一小段插值，位置也更准
  const cross = (id, xa, ya, va, xb, yb, vb) => {
    if (fake.has(id)) return null;
    if (pts.has(id)) return id;
    const big = Math.max(Math.abs(va), Math.abs(vb));
    let ta = 0, tb = 1, fa = va, fb = vb;
    if (big > 1e-9) { // 格点正好在线上的（挪开了 1e-12 的）不用验
      for (let k = 0; k < 3; k++) {
        const tm = (ta + tb) / 2, fm = mid(xa + (xb - xa) * tm, ya + (yb - ya) * tm);
        if (Number.isNaN(fm)) { fake.add(id); return null; }
        if (fm === 0) { ta = tb = tm; fa = fb = 0; break; }
        if ((fm > 0) === (fa > 0)) { ta = tm; fa = fm; } else { tb = tm; fb = fm; }
      }
      if (Math.max(Math.abs(fa), Math.abs(fb)) > 0.4 * big) { fake.add(id); return null; }
    }
    const t = fa === fb ? ta : ta + ((tb - ta) * fa) / (fa - fb);
    pts.set(id, [xa + (xb - xa) * t, ya + (yb - ya) * t]);
    return id;
  };
  const e = {};
  const put = (k, id) => { if (id !== null) e[k] = id; };
  if (v0 * v1 < 0) put('b', cross(hId(i, j), x0, y0, v0, x1, y0, v1));
  if (v1 * v2 < 0) put('r', cross(vId(i + 1, j), x1, y0, v1, x1, y1, v2));
  if (v3 * v2 < 0) put('t', cross(hId(i, j + 1), x0, y1, v3, x1, y1, v2));
  if (v0 * v3 < 0) put('l', cross(vId(i, j), x0, y0, v0, x0, y1, v3));
  const ks = Object.keys(e);
  if (ks.length === 2) {
    // 两个交点都落在格点上、还是斜对着的两个角，而第三个角本来也正好在线上（xy = 0 的原点旁边）：
    // 线是沿着格子边拐过那个角的，不是斜着切过去
    const zc = [G.zero(i, j), G.zero(i + 1, j), G.zero(i + 1, j + 1), G.zero(i, j + 1)];
    const via = zc[0] + zc[1] + zc[2] + zc[3] === 3 ? [0, 1, 2, 3].find((q) => zc[q] && zc[(q + 1) % 4] && zc[(q + 3) % 4]) : -1;
    if (via >= 0) {
      const cid = -1 - (G.cbase + (j + (via >= 2 ? 1 : 0)) * G.W1 + i + (via === 1 || via === 2 ? 1 : 0));
      if (!pts.has(cid)) pts.set(cid, [via === 1 || via === 2 ? x1 : x0, via >= 2 ? y1 : y0]);
      segs.push([e[ks[0]], cid], [cid, e[ks[1]]]);
    } else segs.push([e[ks[0]], e[ks[1]]]);
  } else if (ks.length === 4) {
    // 鞍点：四条边都有交点。中心和左下角同号 → 左下角不被单独切出去
    const c = mid((x0 + x1) / 2, (y0 + y1) / 2);
    if ((Number.isNaN(c) ? v0 : c) * v0 > 0) segs.push([e.b, e.r], [e.t, e.l]);
    else segs.push([e.b, e.l], [e.t, e.r]);
  }
}

/**
 * 等值线 F(x, y) = level：行进方格。回几条折线，每条 [[x, y], …]。
 * 格子的四个角有没定义的就跳过；鞍点的格子（对角同号）按格子中心的值决定怎么连。
 * 线上梯度比别处小得多的格子（鞍点、极值点旁边）自动加密。
 */
export function contourLines(F, level, box, { nx = 96, ny = 96 } = {}) {
  const f = val2(F);
  nx = clampN(nx, 2, PLANE_MAX_GRID); ny = clampN(ny, 2, PLANE_MAX_GRID);
  const dx = (box.x1 - box.x0) / nx, dy = (box.y1 - box.y0) / ny;
  const g = [];
  for (let j = 0; j <= ny; j++) { const row = new Float64Array(nx + 1); for (let i = 0; i <= nx; i++) row[i] = f(box.x0 + i * dx, box.y0 + j * dy) - level; g.push(row); }
  const zero = g.map((row) => { const z = new Uint8Array(nx + 1); for (let i = 0; i <= nx; i++) if (row[i] === 0) { z[i] = 1; row[i] = EPS0; } return z; });
  const mid = (x, y) => f(x, y) - level;
  const W1 = nx + 1;
  const coarse = { W1, base: 0, cbase: 0, val: (i, j) => g[j][i], zero: (i, j) => zero[j][i], x: (i) => box.x0 + i * dx, y: (j) => box.y0 + j * dy };

  // 哪些格子要加密：线穿过的格子里，梯度（四个角估的）比这条线上的中位数小得多的，连同它周围一圈
  const cut = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v0 = g[j][i], v1 = g[j][i + 1], v2 = g[j + 1][i + 1], v3 = g[j + 1][i];
    if (Number.isNaN(v0 + v1 + v2 + v3)) continue;
    const pos = (v0 > 0) + (v1 > 0) + (v2 > 0) + (v3 > 0);
    if (pos === 0 || pos === 4) continue;
    cut.push({ i, j, m: Math.hypot((v1 - v0 + v2 - v3) / (2 * dx), (v3 - v0 + v2 - v1) / (2 * dy)) });
  }
  const refine = new Set();
  if (cut.length >= 8) {
    const med = cut.map((c) => c.m).sort((a, b) => a - b)[cut.length >> 1];
    const flat = cut.filter((c) => c.m < FLAT * med).sort((a, b) => a.m - b.m).slice(0, Math.floor(FINE_MAX_CELLS / 9));
    for (const c of flat) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const i = c.i + a, j = c.j + b;
      if (i >= 0 && i < nx && j >= 0 && j < ny) refine.add(j * nx + i);
    }
  }

  const pts = new Map(), segs = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!refine.has(j * nx + i)) marchCell(coarse, i, j, pts, segs, mid);
  const lines = joinSegs(segs).map((line) => line.map((id) => pts.get(id)));
  if (!refine.size) return lines;

  // 加密的格子：细网格上的格点值现算现记（相邻的细格共用）
  const W1f = nx * FINE + 1, memo = new Map(), zf = new Set();
  const fval = (I, J) => {
    const k = J * W1f + I;
    let v = memo.get(k);
    if (v === undefined) { v = f(box.x0 + (I * dx) / FINE, box.y0 + (J * dy) / FINE) - level; if (v === 0) { zf.add(k); v = EPS0; } memo.set(k, v); }
    return v;
  };
  const fineG = { W1: W1f, base: 2 * (nx + 1) * (ny + 1) + 2, cbase: (nx + 1) * (ny + 1) + 1, val: fval, zero: (I, J) => (fval(I, J), zf.has(J * W1f + I) ? 1 : 0), x: (I) => box.x0 + (I * dx) / FINE, y: (J) => box.y0 + (J * dy) / FINE };
  const fpts = new Map(), fsegs = [];
  for (const k of refine) {
    const i = k % nx, j = (k - i) / nx;
    for (let b = 0; b < FINE; b++) for (let a = 0; a < FINE; a++) marchCell(fineG, i * FINE + a, j * FINE + b, fpts, fsegs, mid);
  }
  const fineLines = joinSegs(fsegs).map((line) => line.map((id) => fpts.get(id)));
  return stitch(lines, fineLines, 0.3 * Math.min(dx, dy));
}

// 粗网格的线和加密那一块的线在交界上接起来（两边在同一条格子边上各自插值，差一点点，按距离认）
function stitch(coarse, fine, tol) {
  const all = [...coarse.map((l) => ({ l, fine: false, alive: true })), ...fine.map((l) => ({ l, fine: true, alive: true }))];
  // 端点按 tol 大小的格子记下来，找邻近的端点只看周围九格（线多的时候逐对比太慢）
  const key = (p, dx = 0, dy = 0) => `${Math.floor(p[0] / tol) + dx},${Math.floor(p[1] / tol) + dy}`;
  const ends = new Map();
  const note = (i) => { for (const p of [all[i].l[0], all[i].l[all[i].l.length - 1]]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } };
  all.forEach((_, i) => note(i));
  const near = (p, self) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of ends.get(key(p, dx, dy)) || []) {
      const o = all[i];
      if (i === self || !o.alive || (!o.fine && !all[self].fine)) continue; // 粗的和粗的本来就按边的编号接过了
      const head = Math.hypot(o.l[0][0] - p[0], o.l[0][1] - p[1]) <= tol, tail = Math.hypot(o.l[o.l.length - 1][0] - p[0], o.l[o.l.length - 1][1] - p[1]) <= tol;
      if (head || tail) return { i, head };
    }
    return null;
  };
  for (let a = 0; a < all.length; a++) {
    if (!all[a].alive) continue;
    for (let guard = 0; guard < all.length; guard++) {
      const A = all[a].l;
      const t = near(A[A.length - 1], a), h = t ? null : near(A[0], a);
      if (!t && !h) break;
      const hit = t || h, B = all[hit.i].l;
      all[hit.i].alive = false;
      // 接上以后这条线两种来源都有了：算细的（它的两头还能接着接粗的、细的）
      all[a].l = t ? [...A, ...(hit.head ? B : B.slice().reverse())] : [...(hit.head ? B.slice().reverse() : B), ...A];
      all[a].fine = true;
      note(a);
    }
  }
  return all.filter((x) => x.alive).map((x) => x.l);
}

/** 折线上走到全长的 frac（0～1）处，是第几个点（按长度，不按点数） */
export function indexAt(line, frac) {
  if (line.length < 2) return 0;
  const acc = [0];
  for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const want = Math.max(0, Math.min(1, frac)) * acc[acc.length - 1];
  let k = 0;
  while (k < acc.length - 1 && acc[k + 1] <= want) k++;
  return k < acc.length - 1 && want - acc[k] > acc[k + 1] - want ? k + 1 : k;
}

/** 几条折线里最长的那条（按长度，不按点数：加密过的一小段点很多） */
export function longestLine(lines) {
  let best = null, bl = -1;
  for (const l of lines) { let s = 0; for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); if (s > bl) { bl = s; best = l; } }
  return best;
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
  const out = [];
  const sx = (box.x1 - box.x0) / Math.max(1, nx - 1), sy = (box.y1 - box.y0) / Math.max(1, ny - 1);
  const len = 0.38 * Math.min(sx, sy * aspect); // 屏幕上的长度（按 x 的单位量）
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = box.x0 + i * sx, y = box.y0 + j * sy;
    let k; try { k = F(x, y); } catch { continue; }
    if (typeof k !== 'number' || Number.isNaN(k)) continue;
    // 斜率无穷：竖的一小段（屏幕上和别的一样长）
    if (!Number.isFinite(k)) { out.push({ x, y, dx: 0, dy: len / aspect }); continue; }
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
function march(deriv, start, h, box, max, singular) {
  const padX = (box.x1 - box.x0) * 0.2, padY = (box.y1 - box.y0) * 0.2;
  const inside = ([x, y]) => x >= box.x0 - padX && x <= box.x1 + padX && y >= box.y0 - padY && y <= box.y1 + padY;
  const out = [];
  let p = start, prev = null;
  const back = (a, b) => a[0] * b[0] + a[1] * b[1] < 0;
  for (let i = 0; i < max; i++) {
    const k1 = deriv(p); if (!k1) break;
    // 方向一下子掉头：切线竖起来了（y′ = −x/y 走到 y = 0），作为 y(x) 的解到这里为止；或者到了场的奇点。不接着画
    if (prev && back(prev, k1)) break;
    if (singular && singular(p, h)) break;
    const k2 = deriv([p[0] + (h / 2) * k1[0], p[1] + (h / 2) * k1[1]]); if (!k2) break;
    const k3 = deriv([p[0] + (h / 2) * k2[0], p[1] + (h / 2) * k2[1]]); if (!k3) break;
    const k4 = deriv([p[0] + h * k3[0], p[1] + h * k3[1]]); if (!k4) break;
    if (back(k1, k2) || back(k1, k3) || back(k1, k4)) break; // 这一步中间就掉头了：这一步算出来的点不可信
    prev = k1;
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
  // 方向场的奇点（y′ = y/x 的原点）：一步之内四个方向上的斜率指着差很多的方向（当直线看，夹角过 55°）。解到这里为止，不穿过去
  const singular = ([x, y], h) => {
    const ang = [[h, 0], [-h, 0], [0, h], [0, -h]].map(([dx, dy]) => { let k; try { k = F(x + dx, y + dy); } catch { k = NaN; } return typeof k === 'number' && !Number.isNaN(k) ? Math.atan(k) : null; });
    if (ang.some((a) => a === null)) return false; // 旁边有没定义的点：让别的规矩（算不出来就停、掉头就停）管
    let worst = 0;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const d = Math.abs(ang[i] - ang[j]); worst = Math.max(worst, Math.min(d, Math.PI - d)); }
    return worst > (55 * Math.PI) / 180;
  };
  return bothWays(dir, from, box, { ...opts, singular });
}

/** 沿向量场 (P, Q) 的流线（按弧长走）；场是零的地方停 */
export function flowField(P, Q, from, box, opts = {}) {
  const p = val2(P), q = val2(Q);
  const dir = (s) => ([x, y]) => { const u = p(x, y), v = q(x, y), m = Math.hypot(u, v); if (Number.isNaN(m) || m < 1e-12) return null; return [(s * u) / m, (s * v) / m]; };
  return bothWays(dir, from, box, opts);
}
function bothWays(dir, from, box, { h, max = 4000, singular } = {}) {
  const step = h ?? Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 600;
  const fwd = march(dir(1), from, step, box, max / 2, singular), back = march(dir(-1), from, step, box, max / 2, singular);
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
  const L = val1(lo), H = val1(hi);
  const sample = (t) => { const l = L(t), h = H(t); return Number.isNaN(l) || Number.isNaN(h) ? null : { t, l, h }; };
  const dt = (b - a) / n;
  // 有定义和没定义的交界：二分找到定义域的边（不然区域停在最后一个采样点上，离真的边差半格）
  const edge = (tIn, tOut) => { let best = null; for (let k = 0; k < 40; k++) { const m = (tIn + tOut) / 2, s = sample(m); if (s) { best = s; tIn = m; } else tOut = m; } return best; };
  // 陡的地方（圆的两头）加密：两点之间上下限变得比步长快得多就对半分
  const refine = (p, q, depth, out) => {
    if (depth < 6 && Math.max(Math.abs(q.l - p.l), Math.abs(q.h - p.h)) > 2 * Math.abs(q.t - p.t) && Math.abs(q.t - p.t) > 1e-9) {
      const m = sample((p.t + q.t) / 2);
      if (m) { refine(p, m, depth + 1, out); out.push(m); refine(m, q, depth + 1, out); }
    }
  };
  const runs = [];
  let cur = null, prev = null, ok = true;
  for (let i = 0; i <= n; i++) {
    const t = i === n ? b : a + dt * i, s = sample(t);
    if (!s) ok = false;
    if (s && !cur) { cur = []; runs.push(cur); if (i > 0) { const e = edge(t, t - dt); if (e && e.t < t) { cur.push(e); refine(e, s, 0, cur); } } }
    else if (s && prev) refine(prev, s, 0, cur);
    if (s) cur.push(s);
    else if (cur) { const e = edge(prev.t, t); if (e && e.t > prev.t) { refine(prev, e, 0, cur); cur.push(e); } cur = null; }
    prev = s;
  }
  const polys = runs.filter((r) => r.length >= 2).map((r) => [...r.map((s) => at(kind, s.t, s.l)), ...r.map((s) => at(kind, s.t, s.h)).reverse()]);
  // poly：最大的那一块（只有一块时就是它）
  return { polys, poly: polys.reduce((p, q) => (q.length > p.length ? q : p), []), ok };
}

/** 点 (x, y) 在不在这样的区域里（事件 ∩ 样本空间用）。极坐标的角按 2π 绕着认 */
export function inTyped(kind, lo, hi, a, b) {
  const L = val1(lo), H = val1(hi);
  if (a > b) [a, b] = [b, a]; // 范围写反了：画出来的是同一块，判的也按同一块
  const between = (t, r) => { const l = L(t), h = H(t); return !Number.isNaN(l) && !Number.isNaN(h) && r >= Math.min(l, h) - 1e-12 && r <= Math.max(l, h) + 1e-12; };
  if (kind === 'r') {
    // 角挪进 [a, a + 2π)，区间超过一圈的再多试一圈
    const sweep = (t0, r) => { for (let t = t0 + Math.ceil((a - t0) / (2 * Math.PI) - 1e-12) * 2 * Math.PI; t <= b + 1e-12; t += 2 * Math.PI) if (between(t, r)) return true; return false; };
    return (x, y) => {
      const r = Math.hypot(x, y), t0 = Math.atan2(y, x);
      // r 是负的那些角（玫瑰线的另外几瓣）画在对面：同一个点也是 (−r, θ + π)
      return sweep(t0, r) || sweep(t0 + Math.PI, -r);
    };
  }
  return (x, y) => { const [t, r] = kind === 'y' ? [x, y] : [y, x]; return t >= a - 1e-12 && t <= b + 1e-12 && between(t, r); };
}

/** 区域在 t 处的那一条（竖条 / 横条 / 射线上的一段）；那里没定义、出了 range（[a, b]）回 null */
export function stripOf(kind, lo, hi, t, range) {
  // 出了区域自己的范围（for x 0 1 以外）就没有这一条
  if (range && !(t >= Math.min(range[0], range[1]) - 1e-9 && t <= Math.max(range[0], range[1]) + 1e-9)) return null;
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

/**
 * 曲线 G(x, y) = 0 在窗口里离 p 最近的点（沿约束拖点用）。先把曲线画出来（等值线的折线）找最近的，再用牛顿法修到线上。
 * 只用牛顿法从手指出发会跳到别的一支上去（y = 1/x 的另一支、三次曲线的另一段）。窗口里没有这条曲线回 null
 */
export function nearestOn(G, [px, py], box, { n = 64 } = {}) {
  const lines = contourLines(G, 0, box, { nx: n, ny: n });
  let best = null, bd = Infinity;
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    const [ax, ay] = l[i - 1], [bx, by] = l[i], dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx - px, qy - py);
    if (d < bd) { bd = d; best = [qx, qy]; }
  }
  if (!best) return null;
  const q = projectTo(G, best, { max: 8 });
  const cell = Math.max((box.x1 - box.x0) / n, (box.y1 - box.y0) / n);
  const inBox = (r) => r[0] >= box.x0 && r[0] <= box.x1 && r[1] >= box.y0 && r[1] <= box.y1;
  return q && Math.hypot(q[0] - best[0], q[1] - best[1]) <= cell && inBox(q) ? q : best;
}

/**
 * 条件围的区域画出来几乎什么都没有时说一句（写法提醒，2026-11-21）：
 *   一处都不成立（x == 1 这种等式、窗口外）→ 区域画不出来；只占窗口一点点、又碎成很多小块（很细的带子
 *   abs(x² + y² − 4) < 0.02 画成一圈点）→ 那是一条曲线。都提示用 implicit 画曲线。正常的区域回 ''
 */
export function whereNote(runs, box) {
  if (!runs.length) return 'region 的条件在窗口里一处都不成立（等式 == 围不出面积）：要画一条曲线用 implicit，比如 implicit x = 1';
  const area = runs.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0), all = (box.x1 - box.x0) * (box.y1 - box.y0);
  if (area < 0.005 * all && runs.length > 24) return 'region 的条件围出来的是一条很细的带子（画出来是一圈点）：要画曲线用 implicit，比如 implicit x^2 + y^2 = 4';
  return '';
}

/**
 * implicit 的式子在窗口里不变号、却碰到 0（(x − y)² = 0、|x| + |y| = 0 这种）：按变号找线的画法找不到它，
 * 说一句让主讲写成变号的式子。完全碰不到 0 的（x² + y² + 1 = 0，空集）不说。网格上的最小值比最大值小三个数量级算碰到
 */
export function implicitNote(F, box, n = 48) {
  let lo = Infinity, hi = 0, pos = false, neg = false;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    let v; try { v = F(box.x0 + ((box.x1 - box.x0) * i) / n, box.y0 + ((box.y1 - box.y0) * j) / n); } catch { continue; }
    if (!Number.isFinite(v)) continue;
    if (v > 0) pos = true; else if (v < 0) neg = true;
    lo = Math.min(lo, Math.abs(v)); hi = Math.max(hi, Math.abs(v));
  }
  if (pos && neg) return '';
  if (!(hi > 0) || lo > 1e-3 * hi) return '';
  return 'implicit 的式子在窗口里不变号（平方等于 0 这种）：页面按变号找线，画不出来；写成变号的式子，比如 (x − y)^2 = 0 写 x − y = 0';
}
