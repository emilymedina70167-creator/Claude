// 会的程度 K：记得的前提下，真题难度的题我会的概率（spec 6.2）。每块一个分布，在 0～1 的网格上算后验：
// 数据少时自然宽；作答的似然带上作答那天的 R 和猜对的底，所以隔很久做错，一部分算成忘了、一部分算成不会，不扣两次。
// 课堂题按难度差 DELTA 换算回真题难度（logit 上平移），做得再好也不会把真题级算高。纯函数。
import { DELTA } from './priors.js';

/** 41 个点，0.0125 … 0.9875（不含 0 和 1：logit 要有定义） */
export const GRID = Object.freeze(Array.from({ length: 41 }, (_, i) => 0.0125 + (i * 0.975) / 40));
const LOGIT = GRID.map((k) => Math.log(k / (1 - k)));
const sig = (x) => 1 / (1 + Math.exp(-x));

const norm = (w) => {
  let s = 0;
  for (const x of w) s += x;
  for (let i = 0; i < w.length; i++) w[i] = s > 0 ? w[i] / s : 1 / w.length;
  return w;
};

// 不完全 Beta 函数（Numerical Recipes 的连分式）：先验要按每一格的真实概率质量取，不能取格点上的密度——
// 底子差的部分 a < 1，密度在 0 附近趋于无穷，取密度的话 0 附近的质量全丢了，均值会被算高好几倍（实测 0.03 → 0.12）
function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let ser = 1.000000000190015;
  for (const k of c) ser += k / ++y;
  return -t + Math.log((2.5066282746310005 * ser) / x);
}
function betacf(a, b, x) {
  const FP = 1e-30;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FP) d = FP;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
/** Beta(a, b) 的分布函数 */
function betaCdf(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
// 每一格管到两边的中点（第一格从 0 起、最后一格到 1）
const EDGES = [0, ...GRID.slice(1).map((k, i) => (GRID[i] + k) / 2), 1];

/** Beta(mean·n, (1−mean)·n) 落在每一格的概率质量 */
// 先验只有十来种（每部分一个、讲过的一个），首页一次要几百个块：算过的记住（不完全 Beta 一次几十次连分式）
const PRIOR_CACHE = new Map();
export function priorGrid(mean, n) {
  const key = `${mean}|${n}`;
  let w = PRIOR_CACHE.get(key);
  if (!w) {
    const a = Math.max(1e-3, mean * n), b = Math.max(1e-3, (1 - mean) * n);
    const cdf = EDGES.map((x) => betaCdf(x, a, b));
    w = norm(Float64Array.from(GRID, (_, i) => Math.max(0, cdf[i + 1] - cdf[i])));
    PRIOR_CACHE.set(key, w);
  }
  return Float64Array.from(w);
}

/**
 * 一串作答 [{ ok, level: 'exam' | 'class', r, g }] 之后的后验。
 * 一次做对的概率 p = g + (1 − g)·r·f(K)，f(K) = K（真题级）或 σ(logit K + delta)（课堂题）
 */
export function posterior(prior, obs = [], { delta = DELTA } = {}) {
  const w = Float64Array.from(prior);
  for (const o of obs) {
    const g = Number(o.g) || 0;
    const r = Number.isFinite(o.r) ? o.r : 1;
    for (let i = 0; i < w.length; i++) {
      const f = o.level === 'exam' ? GRID[i] : sig(LOGIT[i] + delta);
      const p = g + (1 - g) * r * f;
      w[i] *= o.ok ? p : 1 - p;
    }
    norm(w);
  }
  return w;
}

export function meanOf(post) {
  let m = 0;
  for (let i = 0; i < post.length; i++) m += post[i] * GRID[i];
  return m;
}

/** 逆 CDF 抽一个网格点（u ∈ [0, 1)） */
export function sampleK(post, u) {
  let c = 0;
  for (let i = 0; i < post.length; i++) { c += post[i]; if (u < c) return GRID[i]; }
  return GRID[GRID.length - 1];
}
