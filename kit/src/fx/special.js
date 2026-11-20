// 概率统计要的特殊函数（视觉交互第 1 批；纯函数，tests/fx-special.test.js）。
// 为什么自己写：三大抽样分布的密度要 Γ 函数（χ² 的自由度取奇数时 fact(n/2 − 1) 算不了），
// 上 α 分位点要分布函数的反函数；这些以前都得主讲手算常数、查表，图上的读数页面算不出来。
// 不 import expr.js（expr.js 把这里的 DIST 接进它的函数表）。

const need = (ok, msg) => { if (!ok) throw new Error(msg); };
const num = (x) => { if (typeof x !== 'number') throw new Error('这里需要一个数'); return x; };
const dof = (...ns) => ns.forEach((n) => need(num(n) > 0, `自由度要是正数（现在是 ${n}）`));
const prob = (p) => { need(num(p) >= 0 && p <= 1, `概率要在 0 和 1 之间（现在是 ${p}）`); return p; };

// —— Γ：Lanczos（g = 7，9 项），实数上精确到 1e-13 量级 ——
const LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lgamma(x) {
  num(x);
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x); // 反射公式
  const z = x - 1;
  let a = LG[0];
  for (let i = 1; i < 9; i++) a += LG[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}
export function gamma(x) {
  num(x);
  if (Number.isInteger(x)) {
    if (x <= 0) return NaN; // 极点
    if (x <= 170) { let r = 1; for (let i = 2; i < x; i++) r *= i; return r; } // 整数给精确的阶乘
  }
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  return Math.exp(lgamma(x));
}
export const beta = (a, b) => Math.exp(lgamma(num(a)) + lgamma(num(b)) - lgamma(a + b));

const EPS = 1e-15, TINY = 1e-300;

/** 正则化的下不完全 Γ：P(a, x) = γ(a, x) / Γ(a) */
export function gammaP(a, x) {
  if (!(x > 0)) return 0;
  if (x === Infinity) return 1;
  const lead = Math.exp(-x + a * Math.log(x) - lgamma(a));
  if (x < a + 1) { // 级数
    let term = 1 / a, sum = term;
    for (let n = 1; n < 2000; n++) { term *= x / (a + n); sum += term; if (Math.abs(term) < Math.abs(sum) * EPS) break; }
    return Math.min(1, sum * lead);
  }
  // 连分式（Lentz），算的是 Q = 1 − P
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i < 2000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.max(0, 1 - lead * h);
}

/** 正则化的不完全 B：I_x(a, b) */
export function betaI(x, a, b) {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const lead = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x > (a + 1) / (a + b + 2)) return 1 - betaI(1 - x, b, a); // 连分式在这半边收敛慢：用对称式
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 2000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.min(1, Math.max(0, (lead * h) / a));
}

// 分位点：分布函数单调，先倍增找到上界再二分（80 次到双精度）。lo 是支撑的左端
function invert(cdf, p, lo, start = 1) {
  if (p <= 0) return lo;
  if (p >= 1) return Infinity;
  let a = lo, b = Math.max(start, lo + 1);
  for (let i = 0; i < 200 && cdf(b) < p; i++) { a = b; b = lo + (b - lo) * 2; }
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (m === a || m === b) break;
    if (cdf(m) < p) a = m; else b = m;
  }
  return (a + b) / 2;
}

// 误差函数：normcdf 在 expr.js 里用的是 1.5e-7 的近似式，反函数要更准的——用 P(1/2, x²)
const Phi = (z) => (z === 0 ? 0.5 : z > 0 ? 0.5 + 0.5 * gammaP(0.5, (z * z) / 2) : 0.5 - 0.5 * gammaP(0.5, (z * z) / 2));

function norminv(p, mu = 0, s = 1) {
  prob(p); num(mu); num(s);
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  if (p === 0.5) return mu;
  // Acklam 的有理逼近（相对误差 1.15e-9），再牛顿一步
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  let z;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); z = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); z = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else { const q = p - 0.5, r = q * q; z = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  for (let i = 0; i < 2; i++) z -= (Phi(z) - p) / (Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI));
  return mu + s * z;
}

function chi2pdf(x, n) { dof(n); num(x); if (x < 0) return 0; if (x === 0) return n < 2 ? Infinity : n === 2 ? 0.5 : 0; return Math.exp((n / 2 - 1) * Math.log(x) - x / 2 - (n / 2) * Math.LN2 - lgamma(n / 2)); }
function chi2cdf(x, n) { dof(n); return gammaP(n / 2, num(x) / 2); }
function tpdf(x, n) { dof(n); num(x); return Math.exp(lgamma((n + 1) / 2) - lgamma(n / 2) - 0.5 * Math.log(n * Math.PI) - ((n + 1) / 2) * Math.log(1 + (x * x) / n)); }
function tcdf(x, n) { dof(n); num(x); if (x === 0) return 0.5; const tail = 0.5 * betaI(n / (n + x * x), n / 2, 0.5); return x > 0 ? 1 - tail : tail; }
function fpdf(x, m, n) {
  dof(m, n); num(x);
  if (x < 0) return 0;
  if (x === 0) return m < 2 ? Infinity : m === 2 ? 1 : 0;
  return Math.exp(0.5 * (m * Math.log(m * x) + n * Math.log(n) - (m + n) * Math.log(m * x + n)) - Math.log(x) - (lgamma(m / 2) + lgamma(n / 2) - lgamma((m + n) / 2)));
}
function fcdf(x, m, n) { dof(m, n); num(x); return x <= 0 ? 0 : x === Infinity ? 1 : betaI((m * x) / (m * x + n), m / 2, n / 2); }

const int = (k) => Number.isInteger(num(k));
const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

/** 表达式里的函数名 → 实现（expr.js 展开进 FUNCS） */
export const DIST = {
  gamma, beta: (a, b) => beta(a, b),
  chi2pdf, chi2cdf, chi2inv: (p, n) => { dof(n); return invert((x) => chi2cdf(x, n), prob(p), 0, n); },
  tpdf, tcdf,
  tinv: (p, n) => { dof(n); prob(p); if (p === 0.5) return 0; if (p === 0) return -Infinity; return p > 0.5 ? invert((x) => tcdf(x, n), p, 0, 1) : -invert((x) => tcdf(x, n), 1 - p, 0, 1); },
  fpdf, fcdf, finv: (p, m, n) => { dof(m, n); return invert((x) => fcdf(x, m, n), prob(p), 0, 1); },
  norminv,
  // 大的 n 逐项加会溢出成 NaN（C(2000, 1000) 放不下）：用不完全 B 函数，P(X ≤ k) = I_{1−p}(n − k, k + 1)
  binomcdf: (k, n, p) => {
    num(n); prob(p);
    const m = Math.floor(num(k));
    if (m < 0) return 0;
    if (m >= n) return 1;
    if (n <= 60) { let s = 0; for (let i = 0; i <= m; i++) s += choose(n, i) * p ** i * (1 - p) ** (n - i); return Math.min(1, s); }
    return betaI(1 - p, n - m, m + 1);
  },
  // P(X ≤ k) = Q(k + 1, λ)：λ 大的时候 e^{−λ} 下溢成 0，逐项加出来全是 0
  poissoncdf: (k, l) => { need(num(l) >= 0, `泊松分布的 λ 不能是负数（现在是 ${l}）`); const m = Math.floor(num(k)); return m < 0 ? 0 : l === 0 ? 1 : 1 - gammaP(m + 1, l); },
  // 几何分布：第 k 次才第一次成功（k = 1, 2, …）
  geompmf: (k, p) => { prob(p); return int(k) && k >= 1 ? (1 - p) ** (k - 1) * p : 0; },
  // 超几何：N 件里 M 件次品，取 n 件，恰有 k 件次品
  hyperpmf: (k, N, M, n) => {
    [N, M, n].forEach(num);
    need(n <= N && M <= N && n >= 0 && M >= 0, `超几何分布：取的件数、次品数都不能比总数多（hyperpmf(k, 总数 N, 次品 M, 取 n 件)，现在是 N = ${N}、M = ${M}、n = ${n}）`);
    return int(k) ? (choose(M, k) * choose(N - M, n - k)) / choose(N, n) : 0;
  },
  expcdf: (x, l = 1) => { need(num(l) > 0, `指数分布的 λ 要是正数（现在是 ${l}）`); return num(x) < 0 ? 0 : 1 - Math.exp(-l * x); },
  unifcdf: (x, a = 0, b = 1) => (num(x) <= num(a) ? 0 : x >= num(b) ? 1 : (x - a) / (b - a)),
};
