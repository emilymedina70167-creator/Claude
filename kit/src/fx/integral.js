// 数值积分（计划 3，dr-calc-base Task 5；纯函数，tests/fx-integral.test.js）：核外部算的定积分、反常积分、变限积分的值。
// 自适应 Gauss–Kronrod（7 点 Gauss 嵌在 15 点 Kronrod 里，两者之差当误差），误差大的那一段对半分，
// 绝对 + 相对 1e-10，最多 2000 段：不收敛的（∫₀¹ 1/x）到上限就报判不了，不卡页面。
// 端点上不求值，所以 1/√x 这种端点可积的奇点照样算；无穷限换 x = a + t/(1−t)。
const XK = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.586087235467691, 0.405845151377397, 0.207784955007898, 0];
const WK = [0.022935322010529, 0.063092092629979, 0.104790010322250, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
const WG = [0.129484966168870, 0.279705391489277, 0.381830050505119, 0.417959183673469]; // XK[1], XK[3], XK[5], XK[7]
export const MAX_SEGMENTS = 2000;
const TOL = 1e-10;

function gk(f, a, b) {
  const c = (a + b) / 2, h = (b - a) / 2;
  const fc = f(c);
  let k = WK[7] * fc, g = WG[3] * fc;
  for (let i = 0; i < 7; i++) {
    const dx = h * XK[i];
    const s = f(c - dx) + f(c + dx);
    k += WK[i] * s;
    if (i % 2 === 1) g += WG[(i - 1) / 2] * s;
  }
  return { value: k * h, err: Math.abs((k - g) * h) };
}

// 有限区间上的自适应积分
function adaptive(f, a, b, maxSeg, tol = TOL) {
  let segs = [{ a, b, ...gk(f, a, b) }];
  for (let n = 1; ; n++) {
    let total = 0, err = 0, worst = 0;
    for (let i = 0; i < segs.length; i++) { total += segs[i].value; err += segs[i].err; if (segs[i].err > segs[worst].err) worst = i; }
    if (!Number.isFinite(total) || Number.isNaN(err)) return { value: NaN, ok: null, why: '被积函数在区间里有算不出来的点' };
    if (err <= Math.max(tol, tol * Math.abs(total))) return { value: total, err, ok: true };
    if (segs.length >= maxSeg) return { value: total, err, ok: null, why: '算不收敛（可能发散，或者奇点太强）' };
    const s = segs[worst], m = (s.a + s.b) / 2;
    segs.splice(worst, 1, { a: s.a, b: m, ...gk(f, s.a, m) }, { a: m, b: s.b, ...gk(f, m, s.b) });
  }
}

const safe = (f) => (x) => { let y; try { y = f(x); } catch { y = NaN; } return y; };

/**
 * ∫_a^b f(x) dx。a、b 可以是 ±Infinity。回 { value, ok: true | null, err?, why? }（null 是页面判不了）
 */
export function numIntegral(f, a, b, { maxSeg = MAX_SEGMENTS, tol = TOL } = {}) {
  const g = safe(f);
  const o = { maxSeg, tol };
  if (a === b) return { value: 0, ok: true, err: 0 };
  if (a > b) { const r = numIntegral(f, b, a, o); return { ...r, value: -r.value }; }
  if (Number.isFinite(a) && Number.isFinite(b)) return adaptive(g, a, b, maxSeg, tol);
  if (Number.isFinite(a)) return adaptive((t) => g(a + t / (1 - t)) / ((1 - t) ** 2), 0, 1, maxSeg, tol);
  if (Number.isFinite(b)) return adaptive((t) => g(b - t / (1 - t)) / ((1 - t) ** 2), 0, 1, maxSeg, tol);
  const l = numIntegral(f, -Infinity, 0, o), r = numIntegral(f, 0, Infinity, o);
  if (l.ok !== true || r.ok !== true) return { value: l.value + r.value, ok: null, why: (l.ok !== true ? l : r).why };
  return { value: l.value + r.value, ok: true, err: l.err + r.err };
}

/**
 * 二重积分 ∫_{x0}^{x1} ∫_{y0(x)}^{y1(x)} f(x, y) dy dx（核外部算的概率、二重积分的值）。
 * y0、y1 是 (x) => 数（可以是 ±Infinity）。内层每次最多 200 段。
 * 只给光滑的被积函数用：带指示函数的（条件 × 密度）内层的自适应会整段漏掉窄的支撑还报「收敛」，那种走 cubature2。
 * tol：外层的容差（默认和一元的一样 1e-10；图里的读数给 1e-8）
 */
export function numIntegral2(f, [x0, x1], [y0, y1], { tol } = {}) {
  let bad = null;
  const inner = (x) => {
    const r = numIntegral((y) => f(x, y), y0(x), y1(x), { maxSeg: 200 });
    if (r.ok !== true) { bad = r.why; return NaN; }
    return r.value;
  };
  const r = numIntegral(inner, x0, x1, tol ? { maxSeg: 400, tol } : { maxSeg: 400 });
  if (bad) return { value: NaN, ok: null, why: `内层积分${bad}` };
  return r;
}

// 一根轴上 [a, b] ↔ [0, 1]：回 [x, dx/du]。无穷限的换元和一元的一样
function axisMap(a, b) {
  if (Number.isFinite(a) && Number.isFinite(b)) { const w = b - a; return (u) => [a + w * u, w]; }
  if (Number.isFinite(a) && b === Infinity) return (u) => [a + u / (1 - u), 1 / ((1 - u) * (1 - u))];
  if (a === -Infinity && Number.isFinite(b)) return (u) => [b - (1 - u) / u, 1 / (u * u)];
  if (a === -Infinity && b === Infinity) return (u) => { const t = 2 * u - 1, q = 1 - t * t; return [t / q, (2 * (1 + t * t)) / (q * q)]; };
  return () => [NaN, NaN];
}

const G2 = [-0.5773502691896257, 0.5773502691896257], W2 = [1, 1];
const G3 = [-0.7745966692414834, 0, 0.7745966692414834], W3 = [5 / 9, 8 / 9, 5 / 9];
export const CUBATURE_BUDGET = 400000; // 被积函数和条件一共最多算几次：到了就说算不出来，不卡页面
const QUAD = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]];

/**
 * 带断口的二重积分（条件 × 密度、分段的函数、绝对值）：把 [x0, x1] × [y0(x), y1(x)] 拉成单位正方形，四叉树。
 *   marks：[(x, y) => 数]，每个的零点是一条断口（条件 a ≤ b 给 b − a；|e| 给 e）。
 *   一个格子里每个 mark：四个角和中心同号、而且（离 0 够远，或者在格子里是线性的）→ 断口不经过；
 *     变号而且是线性的 → 断口穿过：沿一个方向一条条线积，每条线上先按 mark 两头的值找出断点，再一段一段高斯求积（直的断口是准的）；
 *     别的（离 0 近又不线性：一条比格子还窄的带子、断口拐弯）→ 再分。
 *   断口不经过的格子：3 × 3 高斯，和 2 × 2 的差当误差，差大了再分。
 * 回 { value, ok: true | null, err, why?, evals }：估的误差超过 1e-3（相对 ∬|f|）、被积函数有算不出来的点、算的次数到顶，都是 null。
 */
export function cubature2(f, [x0, x1], [y0, y1], { marks = [], base = 16, minDepth = 2, maxDepth = 7, smoothDepth = 6, budget = CUBATURE_BUDGET } = {}) {
  if (x0 === x1) return { value: 0, ok: true, err: 0, evals: 0 };
  if (x0 > x1) { const r = cubature2(f, [x1, x0], [y0, y1], { marks, base, minDepth, maxDepth, smoothDepth, budget }); return { ...r, value: -r.value }; }
  const ax = axisMap(x0, x1);
  let evals = 0, bad = false;
  // (u, w) → [x, y, 雅可比]
  const at = (u, w) => {
    const [x, jx] = ax(u);
    let a, b;
    try { a = y0(x); b = y1(x); } catch { return [NaN, NaN, NaN]; }
    if (a === b) return [x, a, 0];
    const [y, jy] = axisMap(Math.min(a, b), Math.max(a, b))(w);
    return [x, y, jx * jy * (a > b ? -1 : 1)];
  };
  const h = (u, w) => {
    evals++;
    const [x, y, j] = at(u, w);
    if (j === 0) return 0;
    let v; try { v = f(x, y); } catch { v = NaN; }
    const r = v * j;
    if (!Number.isFinite(r)) bad = true;
    return r;
  };
  const markAt = (g, u, w) => { evals++; const [x, y] = at(u, w); let v; try { v = g(x, y); } catch { v = NaN; } return typeof v === 'number' ? v : NaN; };
  // 0：断口不经过；1：穿过、沿 w 一条条线积；3：穿过、沿 u 积；2：要再分
  // 线要横着穿过断口才准（断口和线平行时，线上的积分对另一个方向是跳的）：按 mark 在两个方向上的变化挑方向，几条断口挑不到一起就再分
  const kindOf = (u, w, s) => {
    let okW = true, okU = true, any = false;
    for (const g of marks) {
      const v = CORNERS.map(([du, dw]) => markAt(g, u + du * s, w + dw * s));
      if (v.some(Number.isNaN)) return 2; // 没定义的点（∞ − ∞ 的那个角）
      const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo;
      const cross = lo <= 0 && hi > 0;
      // 有的角在无穷远（mark 是 ±∞）：只认正负，同号就是不经过，变号再分
      if (!Number.isFinite(span)) { if (cross) return 2; continue; }
      const linear = Math.abs(v[4] - (v[0] + v[1] + v[2] + v[3]) / 4) <= 0.01 * span + 1e-13 * Math.max(Math.abs(lo), Math.abs(hi));
      if (!cross) { if (!linear && Math.min(Math.abs(lo), Math.abs(hi)) < span) return 2; continue; }
      if (!linear) return 2;
      any = true;
      const gu = Math.abs(v[1] - v[0] + v[2] - v[3]), gw = Math.abs(v[3] - v[0] + v[2] - v[1]);
      if (gw < 0.5 * gu) okW = false;
      if (gu < 0.5 * gw) okU = false;
    }
    return !any ? 0 : okW ? 1 : okU ? 3 : 2;
  };
  const gauss = (u, w, s, X, W) => {
    let sum = 0;
    for (let i = 0; i < X.length; i++) for (let j = 0; j < X.length; j++) sum += W[i] * W[j] * h(u + (s * (X[i] + 1)) / 2, w + (s * (X[j] + 1)) / 2);
    return (sum * s * s) / 4;
  };
  // 断口穿过的格子：u 方向 3 个高斯点，每条线上按 mark 在两头的值线性找断点，分段 3 点高斯
  const byLines = (u, w, s, alongU) => {
    // p：线在第几条（垂直于线的方向），q：沿线的位置（0～1）
    const pt = alongU ? (p, q) => [u + s * q, w + s * p] : (p, q) => [u + s * p, w + s * q];
    // 一条线段两头的 mark 变号：先线性找断点，再在那一点算一次 mark 用割线修一下（弯的断口，圆、抛物线）
    const cutOn = (g, P) => {
      const a = markAt(g, ...P(0)), b = markAt(g, ...P(1));
      if (Number.isNaN(a) || Number.isNaN(b) || (a > 0) === (b > 0)) return null;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return 0.5;
      const c = a / (a - b), m = markAt(g, ...P(c));
      if (!Number.isFinite(m) || m === 0) return c;
      const c2 = (m > 0) === (a > 0) ? c + ((1 - c) * m) / (m - b) : (c * a) / (a - m);
      return c2 > 0 && c2 < 1 ? c2 : c;
    };
    // 断口从格子的上下两条边（q = 0、q = 1）穿出去的地方，线上的积分对 p 有折角：在那里把 p 分段，每段里才是光滑的
    const ps = [0, 1];
    for (const g of marks) for (const q of [0, 1]) { const c = cutOn(g, (t) => pt(t, q)); if (c !== null) ps.push(c); }
    ps.sort((x, y) => x - y);
    let sum = 0;
    for (let m = 1; m < ps.length; m++) {
      const p0 = ps[m - 1], plen = ps[m] - p0;
      if (!(plen > 1e-12)) continue;
      let part = 0;
      for (let i = 0; i < 3; i++) {
        const p = p0 + (plen * (G3[i] + 1)) / 2;
        const cuts = [0, 1];
        for (const g of marks) { const c = cutOn(g, (t) => pt(p, t)); if (c !== null) cuts.push(c); }
        cuts.sort((x, y) => x - y);
        let line = 0;
        for (let k = 1; k < cuts.length; k++) {
          const q0 = cuts[k - 1], len = cuts[k] - q0;
          if (!(len > 1e-12)) continue;
          let seg = 0;
          for (let j = 0; j < 3; j++) seg += W3[j] * h(...pt(p, q0 + (len * (G3[j] + 1)) / 2));
          line += (seg * len) / 2;
        }
        part += W3[i] * line;
      }
      sum += (part * plen) / 2;
    }
    return sum * s * s;
  };
  const fail = (why, value = NaN, err) => ({ value, ok: null, why, evals, ...(err === undefined ? {} : { err }) });
  const NAN_WHY = '被积函数在区域里有算不出来的点';
  let value = 0, abs = 0, err = 0, rough2 = 0;
  // 第一层：整个正方形分成 base × base。量级先拿每格的中心估一个（定光滑格子的容差）
  let level = [], scale = 0;
  for (let i = 0; i < base; i++) for (let j = 0; j < base; j++) { level.push([i / base, j / base]); scale += Math.abs(h((i + 0.5) / base, (j + 0.5) / base)) / (base * base); }
  if (bad) return fail(NAN_WHY);
  let s = 1 / base;
  for (let depth = 0; level.length; depth++, s /= 2) {
    const next = [];
    const split = (u, w) => { for (const [du, dw] of QUAD) next.push([u + du * s, w + dw * s]); };
    for (const [u, w] of level) {
      if (evals > budget) return fail('算不收敛（断口太碎，或者奇点太强）');
      const kind = marks.length ? kindOf(u, w, s) : 0;
      if (kind === 2 && depth < maxDepth) { split(u, w); continue; }
      if (kind === 2) {
        // 分到最细还理不清的格子（无穷远的边上、比格子还窄的带子）：格子里取 4 × 4 个点，误差按最大值记。
        // 点不取在正中间：|x − y| ≤ 0 这种只在一条线上成立的条件，正中间的点会正好落在线上，把面积是 0 的东西数出一个数来
        let sum = 0, mx = 0;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = h(u + ((i + 0.37) * s) / 4, w + ((j + 0.61) * s) / 4); sum += v; mx = Math.max(mx, Math.abs(v)); }
        const a = (sum * s * s) / 16;
        value += a; abs += Math.abs(a); rough2 += ((mx * s * s) / 4) ** 2;
      } else if (kind) {
        if (depth < minDepth) { split(u, w); continue; }
        const a = byLines(u, w, s, kind === 3);
        value += a; abs += Math.abs(a);
      } else {
        const a = gauss(u, w, s, G3, W3), d = Math.abs(a - gauss(u, w, s, G2, W2));
        if (d > 1e-6 * Math.max(scale, abs) * s * s + 1e-15 && depth < smoothDepth) { split(u, w); continue; }
        value += a; abs += Math.abs(a); err += d;
      }
      if (bad) return fail(NAN_WHY);
    }
    level = next;
  }
  err += 3 * Math.sqrt(rough2);
  if (!Number.isFinite(value)) return fail(NAN_WHY);
  if (err > 1e-3 * abs + 1e-12) return fail('算不收敛（可能发散，或者奇点太强）', value, err);
  return { value, ok: true, err, evals };
}
