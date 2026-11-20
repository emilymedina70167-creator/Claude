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
 * y0、y1 是 (x) => 数（可以是 ±Infinity）。内层每次最多 200 段
 */
export function numIntegral2(f, [x0, x1], [y0, y1]) {
  let bad = null;
  const inner = (x) => {
    const r = numIntegral((y) => f(x, y), y0(x), y1(x), { maxSeg: 200 });
    if (r.ok !== true) { bad = r.why; return NaN; }
    return r.value;
  };
  // 外层的容差放宽到 1e-8：内层每次只准到 1e-10，外层再按 1e-10 要求，被积函数有断的地方（指示函数）永远「不收敛」，白白分到 400 段
  const r = numIntegral(inner, x0, x1, { maxSeg: 400, tol: 1e-8 });
  if (bad) return { value: NaN, ok: null, why: `内层积分${bad}` };
  return r;
}
