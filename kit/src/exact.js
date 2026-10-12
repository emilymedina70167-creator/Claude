// 精确计算：分数用 BigInt，不丢精度。写法和 expr.js 完全一样（同一个解析器），给这几处用：
//   \calc{表达式}（页面把公式里的数算出来，Claude 不手算）、matrix 组件、课堂里的 calc 工具、整节课的 let 块。
// 开方、三角、e、π 这类算不出精确值的，抛出 Inexact，调用方（calcValue）退回 expr.js 的小数。
// 纯函数，不碰 DOM，有测试（tests/exact.test.js）。
import { parse, evaluate as evaluateFloat, isNum, isVec, isMat } from './expr.js';

export class Inexact extends Error {
  constructor(what) {
    super(`${what}算不出精确值`);
    this.inexact = true;
  }
}

const MAX_EXP = 10000n; // 幂次上限：A^99 没问题，A^1e9 这种写错了的不要把页面卡住
const MAX_DIGITS = 400; // 结果里的数太大（几百位）时不往黑板上写

function gcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) [a, b] = [b, a % b];
  return a;
}

// 有理数 n/d：d > 0，约到最简
export class Q {
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('除以 0 了');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static int(k) { return new Q(BigInt(k)); }
  // JS 的数 → 分数：整数照写；1/3 这类浮点找回原来的分数；其余按十进制写法换（0.1 → 1/10）
  static from(x) {
    if (x instanceof Q) return x;
    if (typeof x === 'bigint') return new Q(x);
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('这里需要一个数');
    if (Number.isInteger(x)) return new Q(BigInt(x));
    return smallFraction(x) || decimal(x);
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) {
    if (o.n === 0n) throw new Error('除以 0 了');
    return new Q(this.n * o.d, this.d * o.n);
  }
  neg() { return new Q(-this.n, this.d); }
  cmp(o) { const x = this.n * o.d - o.n * this.d; return x < 0n ? -1 : x > 0n ? 1 : 0; }
  get zero() { return this.n === 0n; }
  get integer() { return this.d === 1n; }
  toNumber() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? `${this.n}` : `${this.n}/${this.d}`; }
  toTeX() {
    if (this.d === 1n) return `${this.n}`;
    const neg = this.n < 0n;
    return `${neg ? '-' : ''}\\tfrac{${neg ? -this.n : this.n}}{${this.d}}`;
  }
}

const ZERO = new Q(0n), ONE = new Q(1n);

// 连分数：分母不超过一百万、误差小到只可能是浮点误差时，就是原来那个分数
function smallFraction(x) {
  let h0 = 1n, h1 = 0n, k0 = 0n, k1 = 1n;
  let y = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(y);
    const ba = BigInt(a);
    [h0, h1] = [ba * h0 + h1, h0];
    [k0, k1] = [ba * k0 + k1, k0];
    if (k0 > 1000000n) return null;
    if (Math.abs(Number(h0) / Number(k0) - x) <= 1e-12 * Math.max(1, Math.abs(x))) return new Q(h0, k0);
    const frac = y - a;
    if (frac < 1e-15) return null;
    y = 1 / frac;
  }
  return null;
}

function decimal(x) {
  const [m, e] = x.toExponential().split('e');
  const [whole, fracPart = ''] = m.replace('-', '').split('.');
  const digits = BigInt(whole + fracPart) * (x < 0 ? -1n : 1n);
  const exp = Number(e) - fracPart.length;
  return exp >= 0 ? new Q(digits * 10n ** BigInt(exp)) : new Q(digits, 10n ** BigInt(-exp));
}

// —— 值：数（Q）、向量（Q 的数组，列向量）、矩阵（Q 的二维数组，按行）——
export const isQ = (x) => x instanceof Q;
export const isQVec = (x) => Array.isArray(x) && x.length > 0 && x.every(isQ);
export const isQMat = (x) => Array.isArray(x) && x.length > 0 && x.every((r) => isQVec(r) && r.length === x[0].length);

/** JS 的数 / 数组（浮点）或已经是精确的值 → 精确的值 */
export function toExact(v) {
  if (v instanceof Q) return v;
  if (typeof v === 'number' || typeof v === 'bigint') return Q.from(v);
  if (Array.isArray(v)) return v.map(toExact);
  throw new Error('这里需要数、向量或矩阵');
}

/** 精确的值 → JS 的数 / 数组（给图、判分这些用浮点的地方） */
export function toFloat(v) {
  if (v instanceof Q) return v.toNumber();
  if (Array.isArray(v)) return v.map(toFloat);
  return v;
}

const q = (x, what = '这里') => { if (!isQ(x)) throw new Error(`${what}需要一个数`); return x; };
const vec = (x) => { if (!isQVec(x)) throw new Error('这里需要一个向量'); return x; };
const mat = (x) => { if (!isQMat(x)) throw new Error('这里需要一个矩阵'); return x; };
const int = (x, what) => { q(x, what); if (!x.integer) throw new Error(`${what}要是整数`); return Number(x.n); };
const square = (M, what) => { mat(M); if (M.length !== M[0].length) throw new Error(`只有方阵才有${what}`); return M; };

export function add(a, b) {
  if (isQ(a) && isQ(b)) return a.add(b);
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && isQ(a[0]) === isQ(b[0])) return a.map((x, i) => add(x, b[i]));
  throw new Error('尺寸不同，不能相加（单位矩阵按需要写 E(3)、E(4)）');
}
export function scale(k, a) {
  if (isQ(a)) return k.mul(a);
  if (Array.isArray(a)) return a.map((x) => scale(k, x));
  throw new Error('无法数乘');
}
const dot = (u, v) => {
  if (u.length !== v.length) throw new Error(`维数不同（${u.length} 和 ${v.length}），不能做内积`);
  return u.reduce((s, x, i) => s.add(x.mul(v[i])), ZERO);
};
export function mul(a, b) {
  if (isQ(a)) return scale(a, b);
  if (isQ(b)) return scale(b, a);
  if (isQMat(a) && isQVec(b)) {
    if (a[0].length !== b.length) throw new Error(`矩阵有 ${a[0].length} 列，向量有 ${b.length} 个分量，不能相乘`);
    return a.length === 1 ? dot(a[0], b) : a.map((r) => dot(r, b));
  }
  if (isQMat(a) && isQMat(b)) {
    if (a[0].length !== b.length) throw new Error(`尺寸不匹配：${a.length}×${a[0].length} 乘 ${b.length}×${b[0].length}`);
    return a.map((r) => b[0].map((_, j) => r.reduce((s, x, k) => s.add(x.mul(b[k][j])), ZERO)));
  }
  if (isQVec(a) && isQMat(b)) {
    if (b.length !== 1) throw new Error(`向量是 ${a.length}×1，后面要是一行（1×n）才能相乘；外积写成 u*v'`);
    return a.map((x) => b[0].map((y) => x.mul(y)));
  }
  if (isQVec(a) && isQVec(b)) throw new Error("两个向量不能直接相乘：内积写 dot(u, v) 或 u'*v，外积写 u*v'");
  throw new Error('无法相乘');
}
export const transpose = (x) => (isQ(x) ? x : isQVec(x) ? [x.slice()] : mat(x)[0].map((_, j) => x.map((r) => r[j])));
export const eye = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : ZERO)));

function powQ(x, e) {
  if (e > MAX_EXP) throw new Error(`次数太大（${e}），最多 ${MAX_EXP}`);
  if (e < 0n) {
    if (x.zero) throw new Error('0 不能做负数次幂');
    return new Q(x.d ** -e, x.n ** -e);
  }
  return new Q(x.n ** e, x.d ** e);
}
function power(a, k) {
  q(k, '次数');
  if (isQ(a)) {
    if (!k.integer) {
      // 开得尽的分数次幂（4^(1/2)）也算精确；其余退回小数
      const r = k.d === 2n ? sqrtQ(a) : null;
      if (r) return powQ(r, k.n);
      throw new Inexact('分数次幂');
    }
    return powQ(a, k.n);
  }
  square(a, '幂');
  if (!k.integer) throw new Error('矩阵只能做整数次幂');
  let e = k.n;
  let base = a;
  if (e < 0n) { base = inv(a); e = -e; }
  if (e > MAX_EXP) throw new Error(`次数太大（${e}），最多 ${MAX_EXP}`);
  let r = eye(a.length);
  while (e > 0n) {
    if (e & 1n) r = mul(r, base);
    e >>= 1n;
    if (e) base = mul(base, base);
  }
  return r;
}

// 高斯-若尔当消元：行最简形和秩（主元优先选 ±1，和 linalg.js 的逐步演示一致，少出分数）
export function rrefOf(M) {
  const R = mat(M).map((r) => r.slice());
  const rows = R.length, cols = R[0].length;
  let r = 0;
  const pivots = [];
  for (let c = 0; c < cols && r < rows; c++) {
    let p = -1;
    for (let i = r; i < rows; i++) {
      if (R[i][c].zero) continue;
      if (p < 0) p = i;
      if (R[i][c].integer && (R[i][c].n === 1n || R[i][c].n === -1n)) { p = i; break; }
    }
    if (p < 0) continue;
    [R[r], R[p]] = [R[p], R[r]];
    const k = R[r][c];
    R[r] = R[r].map((x) => x.div(k));
    for (let i = 0; i < rows; i++) {
      if (i === r || R[i][c].zero) continue;
      const f = R[i][c];
      R[i] = R[i].map((x, j) => x.sub(f.mul(R[r][j])));
    }
    pivots.push([r, c]);
    r++;
  }
  return { R, rank: r, pivots };
}
export function det(M) {
  square(M, '行列式');
  const A = M.map((r) => r.slice());
  const n = A.length;
  let d = ONE;
  for (let c = 0; c < n; c++) {
    let p = c;
    while (p < n && A[p][c].zero) p++;
    if (p === n) return ZERO;
    if (p !== c) { [A[c], A[p]] = [A[p], A[c]]; d = d.neg(); }
    d = d.mul(A[c][c]);
    for (let i = c + 1; i < n; i++) {
      if (A[i][c].zero) continue;
      const f = A[i][c].div(A[c][c]);
      A[i] = A[i].map((x, j) => x.sub(f.mul(A[c][j])));
    }
  }
  return d;
}
export function inv(M) {
  square(M, '逆矩阵');
  const n = M.length;
  const { R, rank } = rrefOf(M.map((r, i) => [...r, ...eye(n)[i]]));
  if (rank < n || R.some((r, i) => !r[i].integer || r[i].n !== 1n)) throw new Error('矩阵不可逆（行列式是 0）');
  return R.map((r) => r.slice(n));
}

// 开平方：分子分母都是完全平方数时精确，否则 null
function isqrt(n) {
  if (n < 0n) return null;
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x * x === n ? x : null;
}
function sqrtQ(x) {
  const a = isqrt(x.n), b = isqrt(x.d);
  return a !== null && b !== null ? new Q(a, b) : null;
}

function fact(n) {
  if (n < 0 || n > 1000) throw new Error('阶乘只算 0 到 1000');
  let r = 1n;
  for (let i = 2n; i <= BigInt(n); i++) r *= i;
  return new Q(r);
}

function roundQ(x, places = 0) {
  const k = 10n ** BigInt(places);
  const t = x.mul(new Q(k));
  // 四舍五入（远离 0）
  const twice = (t.n * 2n) / t.d;
  const r = twice >= 0n ? (twice + 1n) / 2n : -((-twice + 1n) / 2n);
  return new Q(r, k);
}
const floorQ = (x) => new Q(x.n >= 0n ? x.n / x.d : -((-x.n + x.d - 1n) / x.d));

const FUNCS = {
  det: (M) => det(M),
  inv: (M) => inv(M),
  T: (x) => transpose(x),
  transpose: (x) => transpose(x),
  tr: (M) => { square(M, '迹'); return M.reduce((s, r, i) => s.add(r[i]), ZERO); },
  rank: (M) => Q.int(rrefOf(M).rank),
  rref: (M) => rrefOf(M).R,
  diag: (...a) => {
    const v = a.length === 1 && isQVec(a[0]) ? a[0] : a.map((x) => q(x));
    if (!v.length) throw new Error('diag 至少要一个数');
    return v.map((x, i) => v.map((_, j) => (i === j ? x : ZERO)));
  },
  col: (M, j) => { mat(M); const k = int(j, '列号') - 1; if (k < 0 || k >= M[0].length) throw new Error(`没有第 ${k + 1} 列（从 1 开始数）`); return M.map((r) => r[k]); },
  row: (M, i) => { mat(M); const k = int(i, '行号') - 1; if (k < 0 || k >= M.length) throw new Error(`没有第 ${k + 1} 行（从 1 开始数）`); return M[k].slice(); },
  dot: (u, v) => dot(vec(u), vec(v)),
  cross: (u, v) => {
    const [a, b, c] = vec(u), [d, e, f] = vec(v);
    if (u.length !== 3 || v.length !== 3) throw new Error('叉积只对三维向量');
    return [b.mul(f).sub(c.mul(e)), c.mul(d).sub(a.mul(f)), a.mul(e).sub(b.mul(d))];
  },
  proj: (u, v) => scale(dot(vec(u), vec(v)).div(dot(v, v)), v),
  lerp: (a, b, t) => add(scale(ONE.sub(q(t)), a), scale(t, b)),
  mat: (...cols) => transpose(cols.map(vec)),
  I: (n = Q.int(2)) => eye(int(n, '阶数')),
  E: (n = Q.int(2)) => eye(int(n, '阶数')),
  abs: (x) => (q(x).n < 0n ? x.neg() : x),
  sign: (x) => Q.int(q(x).cmp(ZERO)),
  min: (...a) => a.map((x) => q(x)).reduce((m, x) => (x.cmp(m) < 0 ? x : m)),
  max: (...a) => a.map((x) => q(x)).reduce((m, x) => (x.cmp(m) > 0 ? x : m)),
  floor: (x) => floorQ(q(x)),
  ceil: (x) => floorQ(q(x).neg()).neg(),
  round: (x, n = ZERO) => roundQ(q(x), int(n, '位数')),
  fact: (n) => fact(int(n, '阶乘')),
  choose: (n, k) => {
    const N = int(n, 'n'), K = int(k, 'k');
    if (K < 0 || K > N) return ZERO;
    return fact(N).div(fact(K).mul(fact(N - K)));
  },
  sqrt: (x) => { const r = sqrtQ(q(x)); if (!r) throw new Inexact('开方'); return r; },
  norm: (v) => { const r = sqrtQ(dot(vec(v), v)); if (!r) throw new Inexact('长度'); return r; },
};

// 这些函数 expr.js 有、但结果一般不是有理数：交给小数去算
const FLOAT_ONLY = new Set(['rot', 'sin', 'cos', 'tan', 'atan2', 'exp', 'ln', 'log', 'normpdf', 'normcdf', 'binompmf', 'poissonpmf', 'exppdf', 'unifpdf']);

function run(n, vars) {
  switch (n.t) {
    case 'num': return Q.from(n.v);
    case 'var': {
      if (n.name in vars) return toExact(vars[n.name]);
      if (n.name === 'pi' || n.name === 'e') throw new Inexact(n.name === 'pi' ? 'π ' : 'e ');
      if (n.name === 'I' || n.name === 'E') return eye(2);
      throw new Error(`未定义的变量 ${n.name}`);
    }
    case 'neg': return scale(new Q(-1n), run(n.a, vars));
    case 'list': {
      const items = n.items.map((x) => run(x, vars));
      if (items.length && !items.every(isQ) && !(items.every(isQVec) && items.every((r) => r.length === items[0].length))) throw new Error('方括号里要么全是数（向量），要么全是一样长的行（矩阵）');
      return items;
    }
    case 'call': {
      const f = FUNCS[n.name];
      if (!f) {
        if (FLOAT_ONLY.has(n.name)) throw new Inexact(`${n.name}() `);
        throw new Error(`没有函数 ${n.name}()`);
      }
      return f(...n.args.map((x) => run(x, vars)));
    }
    case 'bin': {
      const a = run(n.a, vars), b = run(n.b, vars);
      if (n.op === '+') return add(a, b);
      if (n.op === '-') return add(a, scale(new Q(-1n), b));
      if (n.op === '*') return mul(a, b);
      if (n.op === '/') { if (!isQ(b)) throw new Error('只能除以数'); return scale(ONE.div(b), a); }
      if (n.op === '^') return power(a, b);
      if (!isQ(a) || !isQ(b)) throw new Error('只能比较两个数');
      const c = a.cmp(b);
      const ok = n.op === '<' ? c < 0 : n.op === '<=' ? c <= 0 : n.op === '>' ? c > 0 : n.op === '>=' ? c >= 0 : n.op === '==' ? c === 0 : c !== 0;
      return ok ? ONE : ZERO;
    }
  }
  throw new Error('表达式错误');
}

/** 精确求值。vars 里可以是精确的值，也可以是 JS 的数 / 数组。算不出精确值时抛 Inexact */
export function evaluateExact(src, vars = {}) {
  return run(typeof src === 'string' ? parse(src) : src, vars || {});
}

// —— 写出来 ——

const bigText = (x) => {
  const s = x.toString();
  if (s.replace('-', '').replace('/', '').length > MAX_DIGITS) throw new Error('结果的数太大了，写不上黑板');
  return s;
};

/** 精确的值 → TeX：分数用 \tfrac，向量写成列，矩阵用 bmatrix（和 expr.js 的 valueTeX 一致） */
export function exactTeX(v) {
  if (isQ(v)) { bigText(v); return v.toTeX(); }
  if (isQMat(v)) return `\\begin{bmatrix}${v.map((r) => r.map(exactTeX).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
  if (isQVec(v)) return `\\begin{bmatrix}${v.map(exactTeX).join(' \\\\ ')}\\end{bmatrix}`;
  throw new Error('写不出这个值');
}

/** 精确的值 → 文字：3/4、[1, 2]、[[1, 2], [3, 4]] */
export function exactText(v) {
  if (isQ(v)) return bigText(v);
  if (Array.isArray(v)) return `[${v.map(exactText).join(', ')}]`;
  throw new Error('写不出这个值');
}

// 小数的写法（算不出精确值时）：最多 4 位有效数字
function approxTeX(x) {
  if (typeof x === 'number') {
    if (!Number.isFinite(x)) return '\\text{?}';
    const s = Number(x.toPrecision(4));
    return String(Object.is(s, -0) ? 0 : s);
  }
  if (isMat(x)) return `\\begin{bmatrix}${x.map((r) => r.map(approxTeX).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
  if (isVec(x)) return `\\begin{bmatrix}${x.map(approxTeX).join(' \\\\ ')}\\end{bmatrix}`;
  return '\\text{?}';
}
const approxText = (x) => (isNum(x) ? String(Number(x.toPrecision(6))) : Array.isArray(x) ? `[${x.map(approxText).join(', ')}]` : '?');

/**
 * 算一个表达式：先精确算；算不出精确值的（开方、三角……）退回小数。
 * vars：精确的值或 JS 的数 / 数组都行。返回 { value, exact, tex, text, float }；写错了抛出 Error（中文原因）
 */
export function calcValue(src, vars = {}) {
  const ast = parse(src);
  try {
    const value = run(ast, vars || {});
    return { value, exact: true, tex: exactTeX(value), text: exactText(value), float: toFloat(value) };
  } catch (e) {
    if (!e?.inexact) throw e;
  }
  const fv = {};
  for (const [k, v] of Object.entries(vars || {})) fv[k] = toFloat(v);
  const value = evaluateFloat(src, fv);
  return { value, exact: false, tex: approxTeX(value), text: approxText(value), float: value };
}

/**
 * 组件自己的 let（parseScene 解析出的命令，带 src）接在 base（整节课的量）后面精确地算一遍，给 \calc 当变量。
 * 算不出来的跳过（组件自己会报错）
 */
export function letScope(cmds, base = {}) {
  const scope = { ...base };
  for (const c of cmds || []) {
    if (c?.kind !== 'let' || !c.src) continue;
    try { scope[c.name] = calcValue(c.src, scope).value; } catch { /* 组件画的时候会报 */ }
  }
  return scope;
}

/** 精确的量 → 浮点（给 expr.js 求值的组件当初始变量） */
export function floatVars(vars) {
  const out = {};
  for (const [k, v] of Object.entries(vars || {})) out[k] = toFloat(v);
  return out;
}

// —— let 块：整节课的量 ——
const LET_LINE = /^\s*(?:let\s+)?([A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*)\s*[=＝]\s*(.+?)\s*$/;
const RESERVED = new Set(['I', 'E', 'pi', 'e', 'step', 't']);

/**
 * 解析 let 块：一行一个「名字 = 表达式」（前面写不写 let 都行，# 后面是注释）。
 * 返回 [{ name, src }]；看不懂的行抛出 Error（中文原因）
 */
export function parseLets(src) {
  const out = [];
  for (const raw of String(src ?? '').split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trim();
    if (!line) continue;
    const m = line.match(LET_LINE);
    if (!m) throw new Error(`看不懂这一行：${line.slice(0, 60)}（let 块里一行写一个「名字 = 表达式」）`);
    if (RESERVED.has(m[1])) throw new Error(`${m[1]} 是保留的名字（单位矩阵、常数、联动用的变量），换一个`);
    out.push({ name: m[1], src: m[2] });
  }
  if (!out.length) throw new Error('let 块是空的：一行写一个「名字 = 表达式」');
  return out;
}

/**
 * 公式里的 \calc{表达式} 换成算出来的 TeX（括号可以嵌套）。evaluate(src) → TeX，写错时抛出 Error。
 * 返回 { tex, errors: [{ expr, msg }] }；算不出来的那一处换成 \text{?}
 */
export function expandCalc(tex, evaluate) {
  const s = String(tex ?? '');
  if (!s.includes('\\calc')) return { tex: s, errors: [] };
  const errors = [];
  let out = '';
  let i = 0;
  const re = /\\calc\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    let depth = 1, j = re.lastIndex;
    for (; j < s.length && depth; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
    }
    if (depth) { errors.push({ expr: s.slice(re.lastIndex), msg: '\\calc{ 少了右括号 }' }); break; }
    const expr = s.slice(re.lastIndex, j - 1);
    out += s.slice(i, m.index);
    try {
      out += `{${evaluate(expr)}}`;
    } catch (e) {
      errors.push({ expr, msg: e?.message || String(e) });
      out += '{\\text{?}}';
    }
    i = j;
    re.lastIndex = j;
  }
  out += s.slice(i);
  return { tex: out, errors };
}
