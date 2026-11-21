// 带种子的抽样（概率第 4 批，抽样模拟 sim 用）。纯函数，不碰 DOM。
// 模拟出来的数只拿来「看」：大数定律、中心极限、抽样分布长什么样；判对错、理论值一律用精确的公式，不用这里的数。
import { compile, evaluate } from '../expr.js';
import { DIST } from '../fx/special.js';
import { readQ } from './num.js';

/** 带种子的随机数（mulberry32）：同一个种子每次一样，刷新、回看、别的设备上都是同一组 */
export function rng(seed = 1) {
  // seed: 0 就是 0（以前 0 当成 1，seed: 0 和 seed: 1 是同一组数）
  let a = Number(seed) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = 'N(μ, σ²)、U(a, b)、Exp(λ)、B(n, p)、P(λ)、Geo(p)、chi2(n)、t(n)、N2(ρ)，或者离散的 {0: 0.5, 1: 0.5}';
const need = (ok, msg) => { if (!ok) throw new Error(msg); };
const unit = (p, what) => need(p >= 0 && p <= 1, `${what} 要在 0 到 1 之间（现在是 ${p}）`);
const whole = (n, what) => need(Number.isInteger(n) && n >= 1, `${what} 要是正整数（现在是 ${n}）`);

// 每种分布：几个参数、查参数、理论的均值方差、怎么抽
const normal = (r) => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); };
function poisson(l, r) {
  // 大的 λ 拆成几段加起来（e^{−λ} 不会下溢成 0）
  let total = 0;
  for (let rest = l; rest > 0; rest -= 200) {
    const m = Math.min(rest, 200), u = r();
    let k = 0, p = Math.exp(-m), F = p;
    while (u > F && k < 5000) { k++; p *= m / k; F += p; }
    total += k;
  }
  return total;
}
const TABLE = {
  N: { n: 2, check: ([, v]) => need(v > 0, `正态分布写 N(μ, σ²)：方差要是正数（现在是 ${v}）`), theory: ([m, v]) => ({ mean: m, var: v }), draw: ([m, v]) => { const s = Math.sqrt(v); return (r) => m + s * normal(r); } },
  U: { n: 2, check: ([a, b]) => need(b > a, `均匀分布 U(a, b) 要 a < b（现在是 ${a}、${b}）`), theory: ([a, b]) => ({ mean: (a + b) / 2, var: (b - a) ** 2 / 12 }), draw: ([a, b]) => (r) => a + (b - a) * r() },
  Exp: { n: 1, check: ([l]) => need(l > 0, `指数分布 Exp(λ) 的 λ 要是正数（现在是 ${l}）`), theory: ([l]) => ({ mean: 1 / l, var: 1 / (l * l) }), draw: ([l]) => (r) => -Math.log(1 - r()) / l },
  B: { n: 2, check: ([n, p]) => { whole(n, '二项分布 B(n, p) 的 n'); need(n <= 5000, '二项分布的 n 最多 5000'); unit(p, '二项分布 B(n, p) 的 p'); }, theory: ([n, p]) => ({ mean: n * p, var: n * p * (1 - p) }), draw: ([n, p]) => (r) => { let k = 0; for (let i = 0; i < n; i++) if (r() < p) k++; return k; } },
  P: { n: 1, check: ([l]) => need(l > 0 && l <= 5000, `泊松分布 P(λ) 的 λ 要是正数、不超过 5000（现在是 ${l}）`), theory: ([l]) => ({ mean: l, var: l }), draw: ([l]) => (r) => poisson(l, r) },
  Geo: { n: 1, check: ([p]) => { unit(p, '几何分布 Geo(p) 的 p'); need(p > 0, '几何分布 Geo(p) 的 p 不能是 0'); }, theory: ([p]) => ({ mean: 1 / p, var: (1 - p) / (p * p) }), draw: ([p]) => (r) => (p === 1 ? 1 : 1 + Math.floor(Math.log(1 - r()) / Math.log(1 - p))) },
  chi2: { n: 1, check: ([n]) => { whole(n, 'χ² 分布的自由度'); need(n <= 500, 'χ² 分布的自由度最多 500'); }, theory: ([n]) => ({ mean: n, var: 2 * n }), draw: ([n]) => (r) => { let s = 0; for (let i = 0; i < n; i++) s += normal(r) ** 2; return s; } },
  t: { n: 1, check: ([n]) => { whole(n, 't 分布的自由度'); need(n <= 500, 't 分布的自由度最多 500'); }, theory: ([n]) => ({ mean: n > 1 ? 0 : NaN, var: n > 2 ? n / (n - 2) : n === 2 ? Infinity : NaN }), draw: ([n]) => (r) => { const z = normal(r); let s = 0; for (let i = 0; i < n; i++) s += normal(r) ** 2; return z / Math.sqrt(s / n); } },
  N2: { n: 1, pair: true, check: ([rho]) => need(Math.abs(rho) <= 1, `二维正态 N2(ρ) 的相关系数要在 −1 和 1 之间（现在是 ${rho}）`), theory: () => ({ mean: 0, var: 1 }), draw: ([rho]) => { const k = Math.sqrt(1 - rho * rho); return (r) => { const x = normal(r), e = normal(r); return [x, rho * x + k * e]; }; } },
};
const ALIAS = { n: 'N', u: 'U', exp: 'Exp', e: 'Exp', b: 'B', p: 'P', poisson: 'P', 'π': 'P', geo: 'Geo', g: 'Geo', chi2: 'chi2', 'χ²': 'chi2', 'χ2': 'chi2', 'χ^2': 'chi2', t: 't', n2: 'N2' };

function splitArgs(s) {
  const out = []; let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++; if (c === ')') depth--;
    if (depth === 0 && /[,，]/.test(c)) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim());
}

/** 读分布的写法（前面的「X ~」不要也行；参数能写式子，用得到 vars 里的滑块）。回 { kind, params, pair, src } 或离散的 { kind: 'D', values, probs } */
export function parseDist(src, vars = {}) {
  if (src && typeof src === 'object' && src.kind) return src;
  // 名字带数字的也认（X1 ~、(X1, X2) ~）
  let s = String(src ?? '').trim().replace(/^[（(]?\s*[A-Za-z]\w*(?:\s*[,，]\s*[A-Za-z]\w*)?\s*[)）]?\s*[~∼～]\s*/, '');
  if (s.startsWith('{')) {
    const items = s.replace(/^\{|\}$/g, '').split(/[,，;；]/).map((x) => x.trim()).filter(Boolean);
    const values = [], probs = [];
    for (const it of items) {
      const m = /^(.+?)\s*[:：]\s*(.+)$/.exec(it);
      const v = m && readQ(m[1]), p = m && readQ(m[2]);
      need(v && p, `离散分布写成 {值: 概率, …}（「${it}」读不懂）`);
      values.push(v.toNumber()); probs.push(p.toNumber());
    }
    need(values.length > 0, '离散分布一个值都没写');
    need(probs.every((p) => p >= 0), '离散分布的概率不能是负数');
    const sum = probs.reduce((a, b) => a + b, 0);
    need(Math.abs(sum - 1) < 1e-9, `离散分布的概率加起来要是 1（现在是 ${Number(sum.toPrecision(6))}）`);
    return { kind: 'D', values, probs, pair: false, src: s };
  }
  const m = /^([A-Za-zχπ][A-Za-z0-9²^]*)\s*[（(]([\s\S]*)[)）]$/.exec(s);
  const kind = m && (TABLE[m[1]] ? m[1] : ALIAS[m[1].toLowerCase()]);
  need(kind, `「${s}」不是认得的分布。能写的：${KINDS}`);
  const def = TABLE[kind];
  const args = splitArgs(m[2]);
  need(args.length === def.n, `${kind} 要 ${def.n} 个参数（现在是 ${args.length} 个）。能写的：${KINDS}`);
  const params = args.map((a) => {
    const v = evaluate(a, vars);
    need(typeof v === 'number' && Number.isFinite(v), `${kind} 的参数「${a}」算出来不是一个数`);
    return v;
  });
  def.check(params);
  return { kind, params, pair: !!def.pair, src: s };
}

/** 理论的均值、方差 */
export function theory(dist, vars) {
  const d = parseDist(dist, vars);
  if (d.kind !== 'D') return TABLE[d.kind].theory(d.params);
  const mean = d.values.reduce((s, v, i) => s + v * d.probs[i], 0);
  return { mean, var: d.values.reduce((s, v, i) => s + v * v * d.probs[i], 0) - mean * mean };
}
/** 抽一个：回 (r) => 数（二维的回一对） */
export function sampler(dist, vars) {
  const d = parseDist(dist, vars);
  if (d.kind !== 'D') return TABLE[d.kind].draw(d.params);
  const cum = []; d.probs.reduce((s, p, i) => (cum[i] = s + p), 0);
  return (r) => { const u = r(); let i = 0; while (i < cum.length - 1 && u >= cum[i]) i++; return d.values[i]; };
}

// —— 统计量 ——
const total = (xs) => { let s = 0; for (const x of xs) s += x; return s; };
const mean = (xs) => total(xs) / xs.length;
const ss = (xs) => { const m = mean(xs); let s = 0; for (const x of xs) s += (x - m) ** 2; return s; };
const S2 = (xs) => ss(xs) / (xs.length - 1);
const median = (xs) => { const a = [...xs].sort((p, q) => p - q), h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };
function corr(pts) {
  const n = pts.length; let mx = 0, my = 0;
  for (const [x, y] of pts) { mx += x; my += y; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
/** 起了名字的统计量：run(样本, { mu, sigma })；min 是最少要几个样本 */
export const STATS = {
  mean: { label: '样本均值', tex: '\\bar X', min: 1, run: mean },
  sum: { label: '样本的和', tex: '\\sum X_i', min: 1, run: total },
  var: { label: '除以 n 的样本方差', tex: '\\tfrac1n\\sum (X_i - \\bar X)^2', min: 1, run: (xs) => ss(xs) / xs.length },
  S2: { label: '样本方差', tex: 'S^2', min: 2, run: S2 },
  S: { label: '样本标准差', tex: 'S', min: 2, run: (xs) => Math.sqrt(S2(xs)) },
  max: { label: '最大值', tex: 'X_{(n)}', min: 1, run: (xs) => Math.max(...xs) },
  min: { label: '最小值', tex: 'X_{(1)}', min: 1, run: (xs) => Math.min(...xs) },
  median: { label: '中位数', tex: '\\text{中位数}', min: 1, run: median },
  z: { label: '标准化的样本均值', tex: '\\dfrac{\\bar X - \\mu}{\\sigma/\\sqrt n}', min: 1, run: (xs, c) => (mean(xs) - c.mu) / (c.sigma / Math.sqrt(xs.length)) },
  t: { label: 't 统计量', tex: '\\dfrac{\\bar X - \\mu}{S/\\sqrt n}', min: 2, run: (xs, c) => (mean(xs) - c.mu) / Math.sqrt(S2(xs) / xs.length) },
  chi: { label: 'χ² 统计量', tex: '\\dfrac{(n-1)S^2}{\\sigma^2}', min: 2, run: (xs, c) => ss(xs) / (c.sigma * c.sigma) },
  r: { label: '样本相关系数', tex: 'r', min: 2, pair: true, run: corr },
};
/** 统计量：名字，或者用 xbar、S、S2、var、n、mu、sigma、total、max、min 写的式子。回 { run(样本), min, pair, label, tex } */
export function statOf(name, ctx = {}) {
  const key = String(name ?? '').trim();
  const c = { mu: ctx.mu ?? 0, sigma: ctx.sigma ?? 1 };
  if (Object.hasOwn(STATS, key)) { const s = STATS[key]; return { ...s, name: key, run: (xs) => s.run(xs, c) }; }
  let f;
  try { f = compile(key); f({ xbar: 0, S: 1, S2: 1, var: 1, n: 2, mu: 0, sigma: 1, total: 0, max: 0, min: 0, ...(ctx.vars || {}) }); } catch (e) {
    throw new Error(`统计量「${key}」读不懂（${e.message}）：写名字 ${Object.keys(STATS).join(' ')}，或者用 xbar、S、S2、var、n、mu、sigma、total、max、min 写式子`);
  }
  const uses = (w) => new RegExp(`(?<![A-Za-z_])${w}(?![A-Za-z0-9_])`).test(key);
  return {
    name: key, label: key, tex: null, min: uses('S') || uses('S2') ? 2 : 1, pair: false,
    run: (xs) => {
      const n = xs.length, v2 = n > 1 ? S2(xs) : NaN;
      return f({ ...(ctx.vars || {}), xbar: mean(xs), S: Math.sqrt(v2), S2: v2, var: ss(xs) / n, n, mu: c.mu, sigma: c.sigma, total: total(xs), max: Math.max(...xs), min: Math.min(...xs) });
    },
  };
}

/** 一台抽样机：next() 抽 n 个、算出统计量，回 { xs, value } */
export function simulator({ dist, n, stat = 'mean', seed = 1, vars }) {
  const d = parseDist(dist, vars), th = theory(d);
  const s = statOf(stat, { mu: th.mean, sigma: Math.sqrt(th.var), vars });
  need(Number.isInteger(n) && n >= 1, `样本量要是正整数（现在是 ${n}）`);
  need(n >= s.min, `${s.label}至少要 ${s.min} 个样本（现在 n = ${n}）`);
  need(!!s.pair === !!d.pair, s.pair ? `${s.label}要成对的样本：draw 写 (X, Y) ~ N2(ρ)` : '成对的样本只能算样本相关系数 r');
  const draw = sampler(d), r = rng(seed);
  return { dist: d, stat: s, theory: th, next: () => { const xs = Array.from({ length: n }, () => draw(r)); return { xs, value: s.run(xs) }; } };
}
/** 抽 reps 次，回每次的统计量 */
export function simulate({ reps = 1000, ...opts }) {
  const sim = simulator(opts);
  const out = new Float64Array(reps);
  for (let i = 0; i < reps; i++) out[i] = sim.next().value;
  return out;
}

/**
 * 直方图。连续的：{ edges, counts, density（面积按全部个数算，画在范围里的那部分）, outside }；
 * discrete: true：{ values, counts, freq }（一个取值一根）
 */
export function histogram(values, { bins = 20, range, discrete = false } = {}) {
  const xs = Array.from(values).filter(Number.isFinite), N = xs.length;
  if (discrete) {
    const map = new Map();
    for (const x of xs) map.set(x, (map.get(x) || 0) + 1);
    const vs = [...map.keys()].sort((a, b) => a - b);
    return { values: vs, counts: vs.map((v) => map.get(v)), freq: vs.map((v) => map.get(v) / N), n: N };
  }
  let [lo, hi] = range || [Math.min(...xs), Math.max(...xs)];
  if (!N && !range) { lo = 0; hi = 1; }
  if (!(hi > lo)) { lo -= 0.5; hi += 0.5; }
  const w = (hi - lo) / bins;
  const counts = Array(bins).fill(0);
  let outside = 0;
  for (const x of xs) {
    if (x < lo || x > hi) { outside++; continue; }
    counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++;
  }
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * w), counts, density: counts.map((c) => (N ? c / (N * w) : 0)), outside, n: N };
}

/** 前 k 个的平均（k = 1 … n） */
export function runningMean(values) {
  const out = new Float64Array(values.length);
  let s = 0;
  for (let i = 0; i < values.length; i++) { s += values[i]; out[i] = s / (i + 1); }
  return out;
}

/** 均值的置信区间：给了 sigma 用正态的分位点，没给用 t(n − 1) 和样本标准差 */
export function interval({ xs, level = 0.95, sigma }) {
  const n = xs.length, m = mean(xs), p = 1 - (1 - level) / 2;
  need(level > 0 && level < 1, `置信水平要在 0 和 1 之间（现在是 ${level}）`);
  if (sigma != null) { const h = DIST.norminv(p) * sigma / Math.sqrt(n); return [m - h, m + h]; }
  need(n >= 2, 'σ 未知的置信区间至少要 2 个样本');
  const h = DIST.tinv(p, n - 1) * Math.sqrt(S2(xs) / n);
  return [m - h, m + h];
}

// 一帧最多抽多少个样本（组数 × 每组的 n）：iPad 上大约 30 毫秒。一下要抽很多组（n 上千 × 1000 组）时
// 分成几帧抽，每帧画一次，页面不卡住（以前一下卡半秒以上）
export const SAMPLE_BUDGET = 200000;
/** k 组、每组 n 个 → 每一帧抽几组 */
export function drawChunks(k, n, budget = SAMPLE_BUDGET) {
  const per = Math.max(1, Math.floor(budget / Math.max(1, n)));
  const out = [];
  for (let left = k; left > 0; left -= per) out.push(Math.min(per, left));
  return out;
}
