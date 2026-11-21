// 小型表达式语言：数、向量 [1, 2]、矩阵 [[1, 2], [3, 4]]（按行写），
// 支持 + - * / ^、转置 '、阶乘 !、函数 det inv T col row dot norm proj rot lerp 等。
//
// 三角函数默认弧度（计划 3，dr-calc-base：答案、\calc、let、graph、derive、检验都是弧度）；
// 画图的几处（scene、space、图上的标注、figure set、predict）要的是角度，调用时明着写 { deg: true }。
// rot(角度) 名字就写着是角度，两种都按角度。哪个文件用哪种，tests/expr-rad.test.js 列着。
// 数值用浮点；判分时再转成分数比较。要精确值（\calc、matrix 组件、课堂的 calc 工具）用 exact.js，写法一样。
//
// 向量是列向量：a' 是一行（1×n 矩阵），a'*b 是一个数，a*b' 是外积（n×n 矩阵）。exact.js 用同样的规则。

import { DIST } from './fx/special.js';
import { numIntegral, numIntegral2, cubature2 } from './fx/integral.js';
const FUNCS = {
  det: (M) => det(asMat(M)),
  inv: (M) => inv(asMat(M)),
  T: (M) => transposeAny(M),
  transpose: (M) => transposeAny(M),
  tr: (M) => trace(asMat(M)),
  rank: (M) => rrefFloat(asMat(M)).rank,
  rref: (M) => rrefFloat(asMat(M)).R,
  diag: (...a) => diag(a.length === 1 && isVec(a[0]) ? a[0] : a.map(num)),
  E: (n = 2) => eye(num(n)), // 教材里单位矩阵写 E：E(3) 和 I(3) 一样
  col: (M, j) => asMat(M).map((r) => r[idx(j, asMat(M)[0].length)]),
  row: (M, i) => asMat(M)[idx(i, asMat(M).length)].slice(),
  dot: (u, v) => dot(asVec(u), asVec(v)),
  norm: (v) => (isNum(v) ? Math.abs(v) : Math.hypot(...asVec(v))), // |x| 写在数上就是绝对值
  proj: (u, v) => scale(dot(asVec(u), asVec(v)) / dot(asVec(v), asVec(v)), asVec(v)),
  // 基变换（视觉第 6 批）：v 在基 b1、b2 下的坐标 [c1, c2]（v = c1·b1 + c2·b2）
  coords: (v, b1, b2) => {
    const [x, y] = asVec(v), [a, c] = asVec(b1), [b, d] = asVec(b2);
    const det = a * d - b * c;
    if (Math.abs(det) <= 1e-12 * Math.max(1, Math.hypot(a, c) * Math.hypot(b, d))) throw new Error('coords 的两个基向量共线：不是一组基');
    return [(x * d - b * y) / det, (a * y - c * x) / det];
  },
  cross: (u, v) => { const [a, b, c] = asVec(u), [d, e, f] = asVec(v); return [b * f - c * e, c * d - a * f, a * e - b * d]; },
  // 空间里的距离和夹角（三维图）：点是 [x, y, z]，平面是 [a, b, c, d]（ax + by + cz = d），直线是 [[点], [方向]]。
  // 图里起了名字的平面、直线就是这样的量。夹角是弧度；angledeg 是度
  dist: (a, b) => geoDist(a, b),
  angleof: (a, b) => geoAngle(a, b),
  angledeg: (a, b) => (geoAngle(a, b) * 180) / Math.PI,
  rot: (deg) => { const r = (num(deg) * Math.PI) / 180; return [[Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]]; },
  lerp: (a, b, t) => add(scale(1 - num(t), a), scale(num(t), b)),
  mat: (...cols) => transpose(cols.map(asVec)), // 由列向量组成矩阵
  I: (n = 2) => eye(num(n)),
  sqrt: (x) => Math.sqrt(num(x)),
  abs: (x) => Math.abs(num(x)),
  sin: (x) => Math.sin(num(x)),
  cos: (x) => Math.cos(num(x)),
  tan: (x) => Math.tan(num(x)),
  cot: (x) => 1 / Math.tan(num(x)),
  sec: (x) => 1 / Math.cos(num(x)),
  csc: (x) => 1 / Math.sin(num(x)),
  arcsin: (x) => Math.asin(num(x)),
  arccos: (x) => Math.acos(num(x)),
  arctan: (x) => Math.atan(num(x)),
  arccot: (x) => Math.PI / 2 - Math.atan(num(x)), // 考研的 arccot：值在 (0, π)
  atan2: (y, x) => Math.atan2(num(y), num(x)),
  min: (...a) => Math.min(...a.map(num)),
  max: (...a) => Math.max(...a.map(num)),
  round: (x, n = 0) => { const k = 10 ** num(n); return Math.round(num(x) * k) / k; },
  exp: (x) => Math.exp(num(x)),
  ln: (x) => Math.log(num(x)),
  log: (x, b = 10) => Math.log(num(x)) / Math.log(num(b)),
  lg: (x) => Math.log10(num(x)),
  floor: (x) => Math.floor(num(x)),
  ceil: (x) => Math.ceil(num(x)),
  sign: (x) => Math.sign(num(x)),
  // 概率统计
  fact: (n) => fact(num(n)),
  choose: (n, k) => choose(num(n), num(k)),
  normpdf: (x, mu = 0, s = 1) => Math.exp(-(((num(x) - num(mu)) / num(s)) ** 2) / 2) / (num(s) * Math.sqrt(2 * Math.PI)),
  normcdf: (x, mu = 0, s = 1) => 0.5 * (1 + erf((num(x) - num(mu)) / (num(s) * Math.SQRT2))),
  binompmf: (k, n, p) => (Number.isInteger(num(k)) && num(k) >= 0 && num(k) <= num(n) ? choose(num(n), num(k)) * num(p) ** num(k) * (1 - num(p)) ** (num(n) - num(k)) : 0),
  poissonpmf: (k, l) => (Number.isInteger(num(k)) && num(k) >= 0 ? Math.exp(-num(l)) * num(l) ** num(k) / fact(num(k)) : 0),
  exppdf: (x, l = 1) => (num(x) < 0 ? 0 : num(l) * Math.exp(-num(l) * num(x))),
  unifpdf: (x, a = 0, b = 1) => (num(x) >= num(a) && num(x) <= num(b) ? 1 / (num(b) - num(a)) : 0),
  // 标准正态：Φ（分布函数）、φ（密度）。学生写 Φ(1.96)
  Phi: (x) => 0.5 * (1 + erf(num(x) / Math.SQRT2)),
  phi: (x) => Math.exp(-(num(x) ** 2) / 2) / Math.sqrt(2 * Math.PI),
  // 计算机课：整数、进制、位运算（位运算只对非负整数；负数先用 unsigned(x, n) 换成 n 位的无符号数）
  // 向量的第 i 个分量（从 1 数）、有几个分量：样本数据的连乘、求和用（sum(i, 1, len(xs), el(xs, i))）
  el: (v, i) => { const a = asVec(v), k = intOf(i, '第几个') - 1; if (k < 0 || k >= a.length) throw new Error(`没有第 ${k + 1} 个分量（一共 ${a.length} 个，从 1 数）`); return a[k]; },
  len: (v) => asVec(v).length,
  // 概率统计的特殊函数：Γ、B，χ² / t / F 的密度、分布函数、分位点，几何、超几何（fx/special.js）
  ...DIST,
  log2: (x) => Math.log2(num(x)),
  mod: (a, b) => { const m = intOf(b, '模'); if (m === 0) throw new Error('mod 的模不能是 0'); return ((intOf(a, 'mod') % m) + m) % m; },
  div: (a, b) => { const d = intOf(b, '除数'); if (d === 0) throw new Error('除以 0 了'); return Math.floor(intOf(a, 'div') / d); },
  gcd: (a, b) => gcd(intOf(a, 'gcd'), intOf(b, 'gcd')),
  lcm: (a, b) => { const x = intOf(a, 'lcm'), y = intOf(b, 'lcm'); return x && y ? Math.abs(x * y) / gcd(x, y) : 0; },
  and: (a, b) => Number(BigInt(uintOf(a)) & BigInt(uintOf(b))),
  or: (a, b) => Number(BigInt(uintOf(a)) | BigInt(uintOf(b))),
  xor: (a, b) => Number(BigInt(uintOf(a)) ^ BigInt(uintOf(b))),
  not: (a, n) => Number(BigInt(uintOf(a, bitsOf(n))) ^ ((1n << BigInt(bitsOf(n))) - 1n)),
  shl: (a, k) => uintOf(a) * 2 ** uintOf(k, 64),
  shr: (a, k) => Math.floor(uintOf(a) / 2 ** uintOf(k, 64)),
  bit: (a, i) => Math.floor(uintOf(a) / 2 ** uintOf(i, 64)) % 2,
  signed: (x, n) => { const b = bitsOf(n), v = uintOf(x, b); return v >= 2 ** (b - 1) ? v - 2 ** b : v; },
  unsigned: (x, n) => { const b = bitsOf(n), v = intOf(x, 'unsigned'); if (v < -(2 ** (b - 1)) || v >= 2 ** b) throw new Error(`${v} 用 ${b} 位放不下`); return ((v % 2 ** b) + 2 ** b) % 2 ** b; },
  // 写成二进制 / 十六进制的文字（只能直接写出来，不能再拿去算）：负数写成 n 位补码
  bin: (x, n) => radixText(x, n, 2),
  hex: (x, n) => radixText(x, n, 16),
  dec: (x, k = 2) => decText(x, k),
};

// 画图的地方用角度：只盖这四个（新加的 arcsin 这些只有弧度：画图里用不到，写了也说得清）
const DEG = {
  ...FUNCS,
  sin: (d) => Math.sin((num(d) * Math.PI) / 180),
  cos: (d) => Math.cos((num(d) * Math.PI) / 180),
  tan: (d) => Math.tan((num(d) * Math.PI) / 180),
  atan2: (y, x) => (Math.atan2(num(y), num(x)) * 180) / Math.PI,
};
const tableOf = (opts) => (opts?.deg ? DEG : FUNCS);
/** 学生在实数的题里能写的初等函数（formula.js 读学生的写法、fx/ 认「这是实数的函数」用） */
export const FX_NAMES = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'arccot', 'ln', 'lg', 'exp', 'sqrt', 'abs', 'Phi', 'phi'];

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }
function intOf(x, what) {
  const v = num(x);
  if (!Number.isInteger(v)) throw new Error(`${what} 要整数（现在是 ${v}）`);
  return v;
}
function bitsOf(n) {
  if (n === undefined) throw new Error('要写位数，比如 not(x, 8)、signed(x, 8)');
  const b = intOf(n, '位数');
  if (b < 1 || b > 64) throw new Error('位数写 1 到 64');
  return b;
}
// 非负整数；给了位数 b 时还要放得进 b 位
function uintOf(x, b) {
  const v = intOf(x, '位运算');
  if (v < 0) throw new Error(`位运算只对非负整数（${v} 是负数：先用 unsigned(${v}, 位数) 换成无符号数）`);
  if (b !== undefined && v >= 2 ** b) throw new Error(`${v} 用 ${b} 位放不下`);
  return v;
}
// 进制文字：n 是位数（二进制）或位数（十六进制的几位）。负数要给位数，写成补码
export function radixText(x, n, base) {
  const v = intOf(x, base === 2 ? 'bin' : 'hex');
  const width = n === undefined ? 0 : intOf(n, '位数');
  if (width < 0 || width > 64) throw new Error('位数写 1 到 64');
  let big = BigInt(v);
  if (big < 0n) {
    if (!width) throw new Error(`负数要写位数才能写成补码，比如 ${base === 2 ? 'bin' : 'hex'}(${v}, 8)`);
    const bits = BigInt(base === 2 ? width : width * 4);
    if (big < -(1n << (bits - 1n))) throw new Error(`${v} 用 ${bits} 位补码放不下`);
    big += 1n << bits;
  }
  const s = big.toString(base).toUpperCase();
  if (width && s.length > width) throw new Error(`${v} 写成${base === 2 ? '二' : '十六'}进制有 ${s.length} 位，比 ${width} 位长`);
  return new Radix(s.padStart(width, '0'), base);
}

// bin / hex 的结果：一串数字，记着是几进制（写出来时四位一组）。不能再参与运算
export class Radix {
  constructor(digits, base) { this.digits = digits; this.base = base; }
  toString() { return this.digits; }
  // 公式里：等宽字体，从右往左四位一组
  toTeX() {
    const groups = [];
    for (let i = this.digits.length; i > 0; i -= 4) groups.unshift(this.digits.slice(Math.max(0, i - 4), i));
    return `\\texttt{${groups.join('\\,')}}`;
  }
}
export const isRadix = (x) => x instanceof Radix;

// dec(x, 2) 的结果：四舍五入成小数写出来（平均周转时间、ASL、有效访问时间这种要写小数的）。和 bin / hex 一样只能直接写出来
export class Dec extends Radix {
  constructor(text) { super(text, 10); }
  toTeX() { return this.digits.replace(/^-/, '-'); }
}
/** 一个数四舍五入到 k 位小数，去掉末尾的 0（15.25、2.67、3） */
export function decText(x, k = 2) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('dec() 里要一个数');
  if (!(Number.isInteger(k) && k >= 0 && k <= 10)) throw new Error('dec(x, 位数)：位数写 0 到 10');
  const t = (Math.round((Math.abs(x) + Number.EPSILON) * 10 ** k) / 10 ** k).toFixed(k).replace(/\.?0+$/, '');
  return new Dec(x < 0 && Number(t) !== 0 ? `-${t}` : t);
}
const CONSTS = { pi: Math.PI, e: Math.E, inf: Infinity };

function fact(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`阶乘要非负整数（现在是 ${n}）`);
  if (n > 170) return Infinity; // 双精度放不下了：不白乘几千次（级数的通项里 (2k+1)! 这种，k 一大每一项都要乘）
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}
function choose(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }
// 误差函数（Abramowitz–Stegun 7.1.26，误差 < 1.5e-7）
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// src 可以是表达式原文，也可以是 parse 出来的语法树。opts.deg：三角函数按角度（画图的地方）
export function evaluate(src, vars = {}, opts) {
  return run(typeof src === 'string' ? parse(src) : src, vars, tableOf(opts));
}

// 解析成语法树（exact.js 用同一棵树精确求值）
export function parse(src) {
  const p = new Parser(String(src));
  const ast = p.parseExpr();
  p.expectEnd();
  return ast;
}

export function compile(src, opts) {
  const p = new Parser(String(src));
  const ast = p.parseExpr();
  p.expectEnd();
  const fns = tableOf(opts);
  return (vars = {}) => run(ast, vars, fns);
}

// 表达式里用到的变量名（用于找依赖）
export function names(src) {
  const out = new Set();
  const walk = (n) => {
    if (!n) return;
    if (n.t === 'var') out.add(n.name);
    (n.args || []).forEach(walk);
    (n.items || []).forEach(walk);
    walk(n.a); walk(n.b);
  };
  const p = new Parser(String(src));
  walk(p.parseExpr());
  return [...out];
}

// —— 解析 ——
class Parser {
  constructor(s) {
    this.toks = tokenize(s);
    this.i = 0;
  }
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  eat(v) { if (this.peek()?.v === v) { this.i++; return true; } return false; }
  expect(v) { if (!this.eat(v)) throw new Error(`缺少 “${v}”`); }
  expectEnd() { if (this.i < this.toks.length) throw new Error(`多余的内容：${this.toks.slice(this.i).map((t) => t.v).join('')}`); }
  // 比较：a < b 等，成立是 1、不成立是 0（用于 highlight=k<=3、分段函数 (x>0)*x 等）
  parseExpr() {
    const a = this.parseSum();
    const op = ['<=', '>=', '==', '!=', '<', '>'].find((o) => this.peek()?.v === o);
    if (!op) return a;
    this.i++;
    return { t: 'bin', op, a, b: this.parseSum() };
  }
  parseSum() {
    let a = this.parseTerm();
    for (;;) {
      if (this.eat('+')) a = { t: 'bin', op: '+', a, b: this.parseTerm() };
      else if (this.eat('-')) a = { t: 'bin', op: '-', a, b: this.parseTerm() };
      else return a;
    }
  }
  parseTerm() {
    let a = this.parseUnary();
    for (;;) {
      if (this.eat('*') || this.eat('·')) a = { t: 'bin', op: '*', a, b: this.parseUnary() };
      else if (this.eat('/')) a = { t: 'bin', op: '/', a, b: this.parseUnary() };
      else if (this.implicit()) a = { t: 'bin', op: '*', a, b: this.parseUnary() };
      else return a;
    }
  }
  // 2u、2(…)、2[…] 这类省略乘号的写法
  implicit() {
    const prev = this.toks[this.i - 1];
    const nx = this.peek();
    return prev && nx && prev.k === 'num' && (nx.k === 'id' || nx.v === '(' || nx.v === '[');
  }
  parseUnary() {
    if (this.eat('-')) return { t: 'neg', a: this.parseUnary() };
    if (this.eat('+')) return this.parseUnary();
    return this.parsePow();
  }
  parsePow() {
    const a = this.parsePostfix();
    if (this.eat('^')) return { t: 'bin', op: '^', a, b: this.parseUnary() };
    return a;
  }
  parsePostfix() {
    let a = this.parsePrimary();
    for (;;) {
      if (this.eat("'")) a = { t: 'call', name: 'T', args: [a] };
      else if (this.eat('!')) a = { t: 'call', name: 'fact', args: [a] };
      else return a;
    }
  }
  parsePrimary() {
    const tok = this.next();
    if (!tok) throw new Error('表达式不完整');
    if (tok.k === 'num') return tok.big !== undefined ? { t: 'num', v: tok.n, big: tok.big } : { t: 'num', v: tok.n };
    if (tok.v === '(') { const e = this.parseExpr(); this.expect(')'); return e; }
    if (tok.v === '[') {
      const items = [];
      if (!this.eat(']')) {
        do items.push(this.parseExpr()); while (this.eat(','));
        this.expect(']');
      }
      return { t: 'list', items };
    }
    if (tok.v === '|') { const e = this.parseExpr(); this.expect('|'); return { t: 'call', name: 'norm', args: [e] }; }
    if (tok.k === 'id') {
      if (this.eat('(')) {
        const args = [];
        if (!this.eat(')')) {
          do args.push(this.parseExpr()); while (this.eat(','));
          this.expect(')');
        }
        return { t: 'call', name: tok.v, args };
      }
      return { t: 'var', name: tok.v };
    }
    throw new Error(`看不懂 “${tok.v}”`);
  }
}

function tokenize(s) {
  const out = [];
  const re = /\s*(?:(0[xX][0-9A-Fa-f][0-9A-Fa-f_]*|0[bB][01][01_]*)|(\d+\.?\d*|\.\d+)|([A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*)|(\*\*|<=|>=|==|!=|[-+*/^()[\],'|·<>!]))/y;
  let m;
  let pos = 0;
  s = s.replace(/−/g, '-').replace(/×/g, '*').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/≠/g, '!=');
  while (pos < s.length) {
    re.lastIndex = pos;
    if (/^\s*$/.test(s.slice(pos))) break;
    m = re.exec(s);
    if (!m) throw new Error(`无法识别：${s.slice(pos).trim().slice(0, 12)}`);
    pos = re.lastIndex;
    if (m[1] !== undefined) {
      // 0x1F、0b1010_0011：整数，按 BigInt 读（exact.js 精确地用；浮点超过 2^53 会不准）
      const big = BigInt(m[1].replace(/_/g, ''));
      out.push({ k: 'num', v: m[1], n: Number(big), big });
    } else if (m[2] !== undefined) out.push({ k: 'num', v: m[2], n: Number(m[2]) });
    else if (m[3] !== undefined) out.push({ k: 'id', v: m[3] });
    else out.push({ k: 'op', v: m[4] === '**' ? '^' : m[4] });
  }
  return out;
}

// —— 求值 ——
function run(n, vars, fns = FUNCS) {
  switch (n.t) {
    case 'num': return n.v;
    case 'var': {
      if (n.name in vars) return vars[n.name];
      if (n.name in CONSTS) return CONSTS[n.name];
      if (n.name === 'I' || n.name === 'E') return eye(2);
      throw new Error(`未定义的变量 ${n.name}`);
    }
    case 'neg': return scale(-1, run(n.a, vars, fns));
    case 'list': return n.items.map((x) => run(x, vars, fns));
    case 'call': {
      // hasOwn：constructor、toString 这些名字不能顺着原型摸到对象自带的方法
      const sp = Object.hasOwn(SPECIAL, n.name) ? SPECIAL[n.name] : null;
      if (sp && isForm(n, sp)) return sp.run(n, vars, fns);
      const f = Object.hasOwn(fns, n.name) ? fns[n.name] : null;
      if (!f) throw new Error(`没有函数 ${n.name}()`);
      return f(...n.args.map((x) => run(x, vars, fns)));
    }
    case 'bin': {
      const a = run(n.a, vars, fns), b = run(n.b, vars, fns);
      if (isRadix(a) || isRadix(b)) throw new Error('bin()、hex()、dec() 的结果只能直接写出来，不能再算（要算就对原来的数算）');
      if (n.op === '+') return add(a, b);
      if (n.op === '-') return add(a, scale(-1, b));
      if (n.op === '*') return mul(a, b);
      if (n.op === '/') { if (!isNum(b)) throw new Error('只能除以数'); return scale(1 / b, a); }
      if (n.op === '^') return power(a, b);
      if (!isNum(a) || !isNum(b)) throw new Error('只能比较两个数');
      const eps = 1e-9;
      if (n.op === '<') return +(a < b - eps);
      if (n.op === '<=') return +(a <= b + eps);
      if (n.op === '>') return +(a > b + eps);
      if (n.op === '>=') return +(a >= b - eps);
      if (n.op === '==') return +(Math.abs(a - b) <= eps);
      if (n.op === '!=') return +(Math.abs(a - b) > eps);
    }
  }
  throw new Error('表达式错误');
}

// —— 特殊形式：参数里有一个「绑定的字母」，后面的式子要对它的每个取值各算一遍，不能像普通函数那样先把参数算好 ——
//   sum(k, a, b, 式子)、prod、maxof、minof：整数 k 从 a 到 b
//   int(式子, t, a, b)：数值定积分；maxon / minon(式子, x, a, b)：区间上的最值；roots(式子, x, a, b)：区间上的全部实根（向量）
// 只有 4 个参数、而且绑定的那个位置写的是一个字母时才算：max(1, 2, 3, 4) 这样的普通调用不受影响。
// 只在这里（浮点求值）有；exact.js 的 \calc 不认。
export const FORM_MAX_TERMS = 20000; // 求和最多几项：滑块把 n 拖到很大时报出来，不卡住页面
const FORM_EG = { int3: 'int3(1, x, 0, 1, y, 0, 1 - x, z, 0, 1 - x - y)', flux: 'flux(x, y, z, sin(u)*cos(v), sin(u)*sin(v), cos(u), u, 0, pi, v, 0, 2pi)', lineint3: 'lineint3(-y, x, 0, cos(t), sin(t), t, t, 0, 2pi)', lineint: 'lineint(-y, x, cos(t), sin(t), t, 0, 2pi)', int2: 'int2(x*y, x, 0, 1, y, 0, x)', sum: 'sum(k, 1, n, 1/k^2)', prod: 'prod(k, 1, n, k)', maxof: 'maxof(k, 1, n, 式子)', minof: 'minof(k, 1, n, 式子)', int: 'int(cos(t), t, 0, x)', maxon: 'maxon(x - x^2, x, 0, 1)', minon: 'minon(x^2, x, -1, 1)', roots: 'roots(x^3 - 3x, x, -3, 3)' };
function isForm(n, sp) {
  const binds = [].concat(sp.bind);
  if (![].concat(sp.arity || 4).includes(n.args.length)) return false;
  if (binds.every((i) => n.args[i].t === 'var')) return true;
  // 该写字母的位置写了别的：多半是把求和、积分写错了（max、min 没有这个问题：它们的名字是 maxof / maxon）
  if (FORM_ONLY.has(n.name)) throw new Error(`${n.name} 的第${binds.length > 1 ? ` ${binds.map((i) => i + 1).join('、')} ` : binds[0] ? '二' : '一'}个参数是${binds[0] ? '自变量' : '求和用'}的字母，如 ${FORM_EG[n.name]}`);
  return false;
}
// 绑定一层变量：不拷贝整个对象（求和的内圈要快），读的时候顺着原型找到外面的量
const bindVar = (vars, name) => { const v = Object.create(vars); v[name] = 0; return v; };
function intRange(n, vars, fns) {
  const a = run(n.args[1], vars, fns), b = run(n.args[2], vars, fns);
  const ok = (x) => isNum(x) && Math.abs(x - Math.round(x)) < 1e-9;
  if (!ok(a) || !ok(b)) throw new Error(`${n.name} 的上下限要是整数（现在是 ${a} 到 ${b}）`);
  const lo = Math.round(a), hi = Math.round(b);
  if (hi - lo + 1 > FORM_MAX_TERMS) throw new Error(`${n.name} 的项太多（${hi - lo + 1} 项），最多 ${FORM_MAX_TERMS}`);
  return [lo, hi];
}
const overInts = (init, step) => (n, vars, fns) => {
  const [lo, hi] = intRange(n, vars, fns);
  const name = n.args[0].name, body = n.args[3], v = bindVar(vars, name);
  let acc = init;
  for (let k = lo; k <= hi; k++) { v[name] = k; acc = step(acc, num(run(body, v, fns)), k === lo); }
  return acc;
};
// —— 被积式里的断口：条件（a ≤ b）是跳的，|e|、max、min 有折角，取整是台阶 ——
// 自适应求积看不见比取样点还窄的支撑（条件 × 密度，支撑只占一小块）：会整段漏掉还报「收敛」。
// 所以先把这些地方找出来：每个给一个连续的量，它的零点就是断口（fx/integral.js 的 cubature2、下面的 intPieces 用）
const JUMP_OPS = new Set(['<', '<=', '>', '>=']);
const markCache = new WeakMap();
function marksOf(body) {
  let out = markCache.get(body);
  if (out) return out;
  out = [];
  const numOf = (e) => (v, fns) => { const r = run(e, v, fns); return isNum(r) ? r : NaN; };
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.t === 'call' && Object.hasOwn(SPECIAL, n.name) && isFormQuiet(n)) return; // 里面那一层自己管
    if (n.t === 'bin' && JUMP_OPS.has(n.op)) { const a = numOf(n.a), b = numOf(n.b); out.push((v, fns) => b(v, fns) - a(v, fns)); }
    if (n.t === 'call' && n.args.length === 1 && ['abs', 'norm', 'sign'].includes(n.name)) out.push(numOf(n.args[0]));
    if (n.t === 'call' && n.args.length === 2 && ['max', 'min'].includes(n.name)) { const a = numOf(n.args[0]), b = numOf(n.args[1]); out.push((v, fns) => a(v, fns) - b(v, fns)); }
    if (n.t === 'call' && n.args.length === 1 && ['floor', 'ceil', 'round'].includes(n.name)) { const a = numOf(n.args[0]), sh = n.name === 'round' ? 0.5 : 0; out.push((v, fns) => Math.sin(Math.PI * (a(v, fns) - sh))); }
    for (const k of ['a', 'b']) walk(n[k]);
    for (const k of ['args', 'items']) if (Array.isArray(n[k])) n[k].forEach(walk);
  };
  walk(body);
  markCache.set(body, out);
  return out;
}
const isFormQuiet = (n) => { try { return isForm(n, SPECIAL[n.name]); } catch { return true; } };

// 一元的：先在区间上找出断口的位置（mark 变号的地方，二分），在那里把积分分段，每段里是光滑的
function intPieces(f, marks, a, b, N = 96) {
  if (!marks.length || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return numIntegral(f, a, b, { maxSeg: 300 });
  const lo = Math.min(a, b), hi = Math.max(a, b), cuts = [];
  for (const g of marks) {
    const at = (x) => { try { const v = g(x); return typeof v === 'number' ? v : NaN; } catch { return NaN; } };
    const root = (x0, v0, x1, v1) => { for (let k = 0; k < 50; k++) { const m = (x0 + x1) / 2, vm = at(m); if (Number.isNaN(vm)) break; if ((vm > 0) === (v0 > 0)) { x0 = m; v0 = vm; } else { x1 = m; v1 = vm; } } return (x0 + x1) / 2; };
    const scan = (x0, x1, n, deep) => {
      let px = x0, pv = at(x0);
      for (let i = 1; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n, v = at(x);
        if (!Number.isNaN(pv) && !Number.isNaN(v)) {
          if ((pv > 0) !== (v > 0)) cuts.push(root(px, pv, x, v));
          // 没变号但离 0 很近（比这一小段上的变化还小）：可能有一段比取样还窄的支撑，往细里再看一层
          else if (deep && Math.min(Math.abs(pv), Math.abs(v)) < 1.5 * Math.abs(v - pv)) scan(px, x, 16, false);
        }
        px = x; pv = v;
      }
    };
    scan(lo, hi, N, true);
  }
  const xs = [lo, ...cuts.filter((c) => c > lo && c < hi).sort((p, q) => p - q), hi];
  let value = 0, err = 0;
  for (let i = 1; i < xs.length; i++) {
    if (!(xs[i] - xs[i - 1] > 1e-13 * Math.max(1, Math.abs(hi)))) continue;
    const r = numIntegral(f, xs[i - 1], xs[i], { maxSeg: 300 });
    if (r.ok !== true) return r;
    value += r.value; err += r.err || 0;
  }
  return { value: a > b ? -value : value, ok: true, err };
}

// 算一次要几十毫秒的（二重积分、曲线积分）：同样的量再问就不重算——图里别的滑块动了、同一条读数重画，都会再问一遍。
// 每个调用处记最近 128 组（plot 一条带二重积分的曲线是几十组）
const memos = new WeakMap();
function memoRun(n, bound, vars, compute) {
  let m = memos.get(n);
  if (!m) {
    const names = new Set();
    const walk = (k) => { if (!k || typeof k !== 'object') return; if (k.t === 'var') names.add(k.name); for (const c of ['a', 'b']) walk(k[c]); for (const c of ['args', 'items']) if (Array.isArray(k[c])) k[c].forEach(walk); };
    walk(n);
    for (const b of bound) names.delete(b);
    m = { names: [...names], map: new Map() };
    memos.set(n, m);
  }
  let key;
  try { key = JSON.stringify(m.names.map((nm) => { const x = vars[nm]; return x === undefined ? null : x; })); } catch { return compute(); }
  let out = m.map.get(key);
  if (!out) {
    try { out = { v: compute() }; } catch (e) { out = { err: e?.message || String(e) }; }
    if (m.map.size >= 128) m.map.delete(m.map.keys().next().value);
    m.map.set(key, out);
  }
  if (out.err) throw new Error(out.err);
  return out.v;
}

// 区间上的一元函数：算不出来的点是 NaN（最值、求根跳过它们）
function realFn(n, vars, fns) {
  const name = n.args[1].name, body = n.args[0], v = bindVar(vars, name);
  const a = num(run(n.args[2], vars, fns)), b = num(run(n.args[3], vars, fns));
  const f = (x) => { v[name] = x; try { const y = run(body, v, fns); return isNum(y) ? y : NaN; } catch { return NaN; } };
  // 最值、求根是在区间上取点找的：区间要有限（积分另算，它自己换元处理无穷限）
  if (n.name !== 'int' && !(Number.isFinite(a) && Number.isFinite(b))) throw new Error(`${n.name} 的区间要是有限的（现在是 ${a} 到 ${b}）`);
  return { f, a, b, v, name };
}
const GOLD = (Math.sqrt(5) - 1) / 2;
function goldenMax(f, a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN; // 区间有一头是无穷：没法收缩（调用的地方先拦了，这里再守一道）
  let c = b - GOLD * (b - a), d = a + GOLD * (b - a), fc = f(c), fd = f(d);
  for (let i = 0; i < 80 && b - a > 1e-13 * Math.max(1, Math.abs(a) + Math.abs(b)); i++) {
    if (fc > fd || Number.isNaN(fd)) { b = d; d = c; fd = fc; c = b - GOLD * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + GOLD * (b - a); fd = f(d); }
  }
  return Math.max(Number.isNaN(fc) ? -Infinity : fc, Number.isNaN(fd) ? -Infinity : fd);
}
function extremeOn(n, vars, fns, sign) {
  const { f, a, b } = realFn(n, vars, fns);
  if (!(b > a)) { const y = f(a); if (Number.isNaN(y)) throw new Error(`${n.name}：式子在 ${a} 算不出来`); return y; }
  const g = (x) => sign * f(x), N = 400, h = (b - a) / N;
  let best = -Infinity, at = -1;
  for (let i = 0; i <= N; i++) { const y = g(a + i * h); if (y > best) { best = y; at = i; } }
  if (at < 0) throw new Error(`${n.name}：式子在这个区间上算不出来`);
  const m = goldenMax(g, a + Math.max(0, at - 1) * h, a + Math.min(N, at + 1) * h);
  return sign * Math.max(best, m);
}
function rootsOn(n, vars, fns) {
  const { f, a, b } = realFn(n, vars, fns);
  if (!(b > a)) return [];
  const N = 800, h = (b - a) / N, xs = [], ys = [];
  for (let i = 0; i <= N; i++) { xs.push(a + i * h); ys.push(f(xs[i])); }
  const mags = ys.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q);
  // 根的近旁函数值要真的小：1/x、tan x 在极点两边也变号，二分下去函数值越来越大，不是根
  const small = 1e-6 * Math.max(1, mags.length ? mags[mags.length >> 1] : 1);
  const out = [];
  const push = (x) => { if (!out.some((r) => Math.abs(r - x) < 1e-7 * Math.max(1, Math.abs(x)))) out.push(Math.abs(x) < 1e-12 ? 0 : x); };
  // 区间的端点：sin 在 ±π 算出来是 1e-16，不是正好 0，也没有变号可看——函数值够小就算根
  for (const i of [0, N]) if (Number.isFinite(ys[i]) && ys[i] !== 0 && Math.abs(ys[i]) <= 1e-9 * Math.max(1, mags.length ? mags[mags.length >> 1] : 1)) push(xs[i]);
  for (let i = 0; i <= N; i++) {
    const y = ys[i];
    if (y === 0) { push(xs[i]); continue; }
    if (i === N || !Number.isFinite(y) || !Number.isFinite(ys[i + 1]) || ys[i + 1] === 0) continue;
    if (y * ys[i + 1] < 0) {
      let lo = xs[i], hi = xs[i + 1], flo = y;
      for (let k = 0; k < 60 && hi - lo > 1e-13 * Math.max(1, Math.abs(lo)); k++) { const m = (lo + hi) / 2, fm = f(m); if (!Number.isFinite(fm)) break; if (fm === 0) { lo = hi = m; break; } if (fm * flo < 0) hi = m; else { lo = m; flo = fm; } }
      const x = (lo + hi) / 2, fx = f(x);
      if (Number.isFinite(fx) && Math.abs(fx) <= small) push(x);
    } else if (i > 0 && Number.isFinite(ys[i - 1]) && Math.abs(y) < Math.abs(ys[i - 1]) && Math.abs(y) <= Math.abs(ys[i + 1])) {
      // 不变号的重根（x² 在 0）：|f| 的极小值够小才算
      const m = -goldenMax((x) => -Math.abs(f(x)), xs[i - 1], xs[i + 1]);
      if (m <= 1e-9 * Math.max(1, mags[mags.length >> 1])) { let lo = xs[i - 1], hi = xs[i + 1]; for (let k = 0; k < 60; k++) { const c = lo + (hi - lo) / 3, d = hi - (hi - lo) / 3; if (Math.abs(f(c)) < Math.abs(f(d))) hi = d; else lo = c; } push((lo + hi) / 2); }
    }
  }
  return out.sort((p, q) => p - q);
}
// 参数曲线 / 曲面上求切向量的差商步长：离参数范围的端点近了跟着缩（到端点距离的百分之一）。
// 端点上导数无穷的参数式（半圆 y = √(1 − t²)、z = √u）固定步长会被端点夹住，√h 那一段的贡献丢掉，错在第三四位
const nearEnd = (t, lo, hi, h0) => { const d = Math.min(t - lo, hi - t); return Math.min(h0, Math.max(d / 100, h0 * 1e-7)); }; // 贴着端点时留一个最小的步长（再小两个点就重合了）；调用的地方把两头夹在范围里
const SPECIAL = {
  sum: { bind: 0, run: overInts(0, (s, y) => s + y) },
  prod: { bind: 0, run: overInts(1, (s, y) => s * y) },
  maxof: { bind: 0, run: (n, vars, fns) => { const r = overInts(-Infinity, (s, y) => Math.max(s, y))(n, vars, fns); if (r === -Infinity) throw new Error('maxof：一项都没有'); return r; } },
  minof: { bind: 0, run: (n, vars, fns) => { const r = overInts(Infinity, (s, y) => Math.min(s, y))(n, vars, fns); if (r === Infinity) throw new Error('minof：一项都没有'); return r; } },
  int: { bind: 1, run: (n, vars, fns) => {
    const { f, a, b, v, name } = realFn(n, vars, fns);
    // 图里一帧要算几百次：段数给少一点，不收敛就报（不卡住画面）。被积式里有条件、取整的先在断口上分段
    const r = intPieces(f, marksOf(n.args[0]).map((g) => (x) => { v[name] = x; return g(v, fns); }), a, b);
    if (r.ok !== true) throw new Error(`这个积分页面算不出来（${r.why || '不收敛'}）`);
    return r.value;
  } },
  // 二重积分 ∫_a^b dx ∫_c^d 式子 dy，c、d 可以含 x（事件的概率、二重积分的值）
  // 第二类曲线积分 ∫_L P dx + Q dy，L 是参数曲线 (x(t), y(t))，t 从 a 到 b。P、Q 里的 x、y 是曲线上的点；
  // x′、y′ 页面用差商求（两头用单边的）。以前要主讲自己把 P·x′ + Q·y′ 推出来写成一元的积分
  // 定义里的 lineint 调用时多带两个参数：曲线上的点叫什么（fx/defs.js 把 x、y 换成别处写不出来的名字，实参里的 x、y 才不会被抓走）
  lineint: { arity: [7, 9], bind: [4], run: (n, vars, fns) => memoRun(n, [n.args[4].name], vars, () => {
    const [P, Q, xt, yt, tv, a, b] = n.args;
    const xn = n.args[7]?.name || 'x', yn = n.args[8]?.name || 'y';
    const A = num(run(a, vars, fns)), B = num(run(b, vars, fns));
    if (!Number.isFinite(A) || !Number.isFinite(B)) throw new Error('lineint 的参数范围要是有限的');
    const v = Object.create(vars);
    v[tv.name] = 0;
    const at = (t) => { v[tv.name] = t; return [num(run(xt, v, fns)), num(run(yt, v, fns))]; };
    const pv = Object.create(v);
    pv[xn] = 0; pv[yn] = 0;
    const lo = Math.min(A, B), hi = Math.max(A, B), h0 = 1e-5 * Math.max(1, Math.abs(A), Math.abs(B));
    const f = (t) => {
      const h = nearEnd(t, lo, hi, h0), t1 = Math.max(lo, t - h), t2 = Math.min(hi, t + h), p1 = at(t1), p2 = at(t2), p = at(t);
      pv[xn] = p[0]; pv[yn] = p[1];
      return (num(run(P, pv, fns)) * (p2[0] - p1[0]) + num(run(Q, pv, fns)) * (p2[1] - p1[1])) / (t2 - t1);
    };
    const r = numIntegral(f, A, B, { maxSeg: 300 });
    if (r.ok !== true) throw new Error(`这个曲线积分页面算不出来（${r.why || '不收敛'}）`);
    return r.value;
  }) },
  // 空间曲线上的 ∫_L P dx + Q dy + R dz：和 lineint 一样，多一个分量。定义里调用时多带三个参数（曲线上的点叫什么）
  lineint3: { arity: [9, 12], bind: [6], run: (n, vars, fns) => memoRun(n, [n.args[6].name], vars, () => {
    const F = n.args.slice(0, 3), path = n.args.slice(3, 6), tv = n.args[6];
    const names = [n.args[9]?.name || 'x', n.args[10]?.name || 'y', n.args[11]?.name || 'z'];
    const A = num(run(n.args[7], vars, fns)), B = num(run(n.args[8], vars, fns));
    if (!Number.isFinite(A) || !Number.isFinite(B)) throw new Error('lineint3 的参数范围要是有限的');
    const v = Object.create(vars);
    v[tv.name] = 0;
    const at = (t) => { v[tv.name] = t; return path.map((e) => num(run(e, v, fns))); };
    const pv = Object.create(v);
    const lo = Math.min(A, B), hi = Math.max(A, B), h0 = 1e-5 * Math.max(1, Math.abs(A), Math.abs(B));
    const f = (t) => {
      const h = nearEnd(t, lo, hi, h0), t1 = Math.max(lo, t - h), t2 = Math.min(hi, t + h), p1 = at(t1), p2 = at(t2), p = at(t);
      names.forEach((nm, i) => { pv[nm] = p[i]; });
      let s = 0;
      for (let i = 0; i < 3; i++) s += num(run(F[i], pv, fns)) * (p2[i] - p1[i]);
      return s / (t2 - t1);
    };
    const r = numIntegral(f, A, B, { maxSeg: 300 });
    if (r.ok !== true) throw new Error(`这个曲线积分页面算不出来（${r.why || '不收敛'}）`);
    return r.value;
  }) },
  // 通量 ∬_Σ P dydz + Q dzdx + R dxdy = ∬ F(r(u, v))·(r_u × r_v) du dv：Σ 是参数曲面，朝 r_u × r_v 的那一侧。
  // r_u、r_v 页面用差商求。以前要主讲自己把法向量、面积元推出来
  flux: { arity: [12, 15], bind: [6, 9], run: (n, vars, fns) => memoRun(n, [n.args[6].name, n.args[9].name], vars, () => {
    const F = n.args.slice(0, 3), surf = n.args.slice(3, 6), uv = n.args[6], vv = n.args[9];
    const names = [n.args[12]?.name || 'x', n.args[13]?.name || 'y', n.args[14]?.name || 'z'];
    const [ua, ub, va, vb] = [7, 8, 10, 11].map((i) => num(run(n.args[i], vars, fns)));
    if (![ua, ub, va, vb].every(Number.isFinite)) throw new Error('flux 的参数范围要是有限的');
    const s = Object.create(vars);
    s[uv.name] = 0; s[vv.name] = 0;
    const at = (a, b) => { s[uv.name] = a; s[vv.name] = b; return surf.map((e) => num(run(e, s, fns))); };
    const pv = Object.create(s);
    const cl = (t, lo, hi) => Math.max(Math.min(lo, hi), Math.min(Math.max(lo, hi), t));
    const hu = 1e-5 * Math.max(1, Math.abs(ua), Math.abs(ub)), hv = 1e-5 * Math.max(1, Math.abs(va), Math.abs(vb));
    const f = (a, b) => {
      try {
        const ku = nearEnd(a, Math.min(ua, ub), Math.max(ua, ub), hu), kv = nearEnd(b, Math.min(va, vb), Math.max(va, vb), hv);
        const a1 = cl(a - ku, ua, ub), a2 = cl(a + ku, ua, ub), b1 = cl(b - kv, va, vb), b2 = cl(b + kv, va, vb);
        const p = at(a, b), pa1 = at(a1, b), pa2 = at(a2, b), pb1 = at(a, b1), pb2 = at(a, b2);
        const ru = [0, 1, 2].map((i) => (pa2[i] - pa1[i]) / (a2 - a1)), rv = [0, 1, 2].map((i) => (pb2[i] - pb1[i]) / (b2 - b1));
        const nn = [ru[1] * rv[2] - ru[2] * rv[1], ru[2] * rv[0] - ru[0] * rv[2], ru[0] * rv[1] - ru[1] * rv[0]];
        names.forEach((nm, i) => { pv[nm] = p[i]; });
        let d = 0;
        for (let i = 0; i < 3; i++) d += num(run(F[i], pv, fns)) * nn[i];
        return d;
      } catch { return NaN; }
    };
    let r = numIntegral2(f, [ua, ub], [() => va, () => vb], { tol: 1e-8 });
    if (r.ok !== true) r = cubature2(f, [ua, ub], [() => va, () => vb], {});
    if (r.ok !== true) throw new Error(`这个曲面积分页面算不出来（${r.why || '不收敛'}）`);
    return r.value;
  }) },
  // 三重积分 ∫_a^b dx ∫_c^d dy ∫_e^f 式子 dz：c、d 能含 x，e、f 能含 x、y（柱面、球面坐标把雅可比写进式子）。
  // 最里面一层是一元的积分（有条件、绝对值的先在断口上分段），外面两层照二重积分算
  int3: { arity: 10, bind: [1, 4, 7], run: (n, vars, fns) => memoRun(n, [n.args[1].name, n.args[4].name, n.args[7].name], vars, () => {
    const [body, xv, a, b, yv, c, d, zv, e, g] = n.args;
    const A = num(run(a, vars, fns)), B = num(run(b, vars, fns));
    const v = Object.create(vars);
    v[xv.name] = 0; v[yv.name] = 0; v[zv.name] = 0;
    const limX = (ex) => (x) => { v[xv.name] = x; return num(run(ex, v, fns)); };
    const marks = marksOf(body);
    let why = '';
    const inner = (x, y) => {
      v[xv.name] = x; v[yv.name] = y;
      let z0, z1;
      try { z0 = num(run(e, v, fns)); z1 = num(run(g, v, fns)); } catch { return NaN; }
      const f = (z) => { v[xv.name] = x; v[yv.name] = y; v[zv.name] = z; try { const r = run(body, v, fns); return isNum(r) ? r : NaN; } catch { return NaN; } };
      const r = intPieces(f, marks.map((m) => (z) => { v[xv.name] = x; v[yv.name] = y; v[zv.name] = z; return m(v, fns); }), z0, z1, 32);
      if (r.ok !== true) { why = r.why || '不收敛'; return NaN; }
      return r.value;
    };
    // 式子里有条件（用指示函数写的区域）：里层积完是连续但有折角的，一层套一层的自适应求积在折角上分个没完——直接上四叉树，分浅一点
    let r = marks.length ? cubature2(inner, [A, B], [limX(c), limX(d)], { base: 12, smoothDepth: 2 }) : numIntegral2(inner, [A, B], [limX(c), limX(d)], { tol: 1e-7 });
    if (r.ok !== true && !why && !marks.length) r = cubature2(inner, [A, B], [limX(c), limX(d)], {});
    if (r.ok === true) return r.value;
    throw new Error(`这个三重积分页面算不出来（${why || r.why || '不收敛'}）`);
  }) },
  int2: { arity: 7, bind: [1, 4], run: (n, vars, fns) => memoRun(n, [n.args[1].name, n.args[4].name], vars, () => {
    const [body, xv, a, b, yv, c, d] = n.args;
    const A = num(run(a, vars, fns)), B = num(run(b, vars, fns));
    const v = Object.create(vars);
    v[xv.name] = 0; v[yv.name] = 0;
    const f = (x, y) => { v[xv.name] = x; v[yv.name] = y; try { const r = run(body, v, fns); return isNum(r) ? r : NaN; } catch { return NaN; } };
    const lim = (e) => (x) => { v[xv.name] = x; return num(run(e, v, fns)); };
    const lo = lim(c), hi = lim(d);
    const marks = marksOf(body).map((g) => (x, y) => { v[xv.name] = x; v[yv.name] = y; return g(v, fns); });
    // 光滑的被积式：一层套一层的自适应求积（准到 1e-8）；不收敛的（可积的奇点）再让四叉树试一次。
    // 有条件、绝对值、取整的：直接四叉树，断口上分段（fx/integral.js 的 cubature2）。哪条路都核不准就说算不出来，不给一个可能错的数
    let r = marks.length ? null : numIntegral2(f, [A, B], [lo, hi], { tol: 1e-8 });
    if (!r || r.ok !== true) r = cubature2(f, [A, B], [lo, hi], { marks });
    if (r.ok === true) return r.value;
    throw new Error(`这个二重积分页面算不出来（${r.why || '不收敛'}）`);
  }) },
  maxon: { bind: 1, run: (n, vars, fns) => extremeOn(n, vars, fns, 1) },
  minon: { bind: 1, run: (n, vars, fns) => extremeOn(n, vars, fns, -1) },
  roots: { bind: 1, run: rootsOn },
};
const FORM_ONLY = new Set(Object.keys(SPECIAL));
/** 这个名字是不是页面自带的函数（含特殊形式）：图里定义自己的函数时不能撞名 */
// dist / angleof 认的三种东西
const geoKind = (o) => (isVec(o) && o.length === 3 ? 'point' : isVec(o) && o.length === 4 ? 'plane' : Array.isArray(o) && o.length === 2 && o.every((r) => isVec(r) && r.length === 3) ? 'line' : null);
const d3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const x3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function geoDist(a, b) {
  let ka = geoKind(a), kb = geoKind(b);
  if (ka !== 'point' && kb === 'point') { [a, b] = [b, a]; [ka, kb] = [kb, ka]; }
  if (ka === 'point' && kb === 'point') return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  if (ka === 'point' && kb === 'plane') return Math.abs(d3(a, b) - b[3]) / Math.hypot(b[0], b[1], b[2]);
  if (ka === 'point' && kb === 'line') { const w = [a[0] - b[0][0], a[1] - b[0][1], a[2] - b[0][2]]; return Math.hypot(...x3(w, b[1])) / Math.hypot(...b[1]); }
  throw new Error('dist 的写法：dist(点, 点)、dist(点, 平面)、dist(点, 直线)');
}
function geoAngle(a, b) {
  const ka = geoKind(a), kb = geoKind(b);
  const dir = (o, k) => (k === 'plane' ? o.slice(0, 3) : k === 'line' ? o[1] : o);
  if (!ka || !kb || (ka === 'point') !== (kb === 'point')) throw new Error('angleof 的写法：angleof(平面, 平面)、angleof(直线, 直线)、angleof(直线, 平面)，或者两个向量');
  const u = dir(a, ka), w = dir(b, kb), c = d3(u, w) / (Math.hypot(...u) * Math.hypot(...w));
  if (ka === 'point') return Math.acos(Math.max(-1, Math.min(1, c))); // 两个向量：0 到 π
  // 线和面：线的方向和法向量的夹角的余角；别的（面面、线线）取锐角
  return (ka === 'plane') !== (kb === 'plane') ? Math.asin(Math.min(1, Math.abs(c))) : Math.acos(Math.min(1, Math.abs(c)));
}

export const isFuncName = (name) => Object.hasOwn(FUNCS, name) || Object.hasOwn(SPECIAL, name) || Object.hasOwn(DEG, name);

export const isNum = (x) => typeof x === 'number';
export const isVec = (x) => Array.isArray(x) && x.length > 0 && x.every(isNum);
export const isMat = (x) => Array.isArray(x) && x.length > 0 && x.every((r) => isVec(r) && r.length === x[0].length);
const num = (x) => { if (!isNum(x)) throw new Error('这里需要一个数'); return x; };
const asVec = (x) => { if (!isVec(x)) throw new Error('这里需要一个向量'); return x; };
const asMat = (x) => { if (!isMat(x)) throw new Error('这里需要一个矩阵'); return x; };
const idx = (k, n) => { const i = num(k) - 1; if (i < 0 || i >= n || !Number.isInteger(i)) throw new Error(`下标 ${k} 超出范围（从 1 开始数）`); return i; };

export function add(a, b) {
  if (isNum(a) && isNum(b)) return a + b;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && isNum(a[0]) === isNum(b[0])) return a.map((x, i) => add(x, b[i]));
  // 和 exact.js 一样：1×n 加一列 n 个数按一行算
  if (isMat(a) && a.length === 1 && isVec(b) && a[0].length === b.length) return add(a, [b]);
  if (isMat(b) && b.length === 1 && isVec(a) && b[0].length === a.length) return add([a], b);
  throw new Error('尺寸不同，不能相加');
}
export function scale(k, a) {
  if (isNum(a)) return k * a;
  if (Array.isArray(a)) return a.map((x) => scale(k, x));
  throw new Error('无法数乘');
}
export function mul(a, b) {
  if (isNum(a) || isNum(b)) return isNum(a) ? scale(a, b) : scale(b, a);
  if (isMat(a) && isVec(b)) {
    if (a[0].length !== b.length) throw new Error(`矩阵有 ${a[0].length} 列，向量有 ${b.length} 个分量，不能相乘`);
    // 一行乘一列（a'*b）：1×1，就是一个数
    return a.length === 1 ? dot(a[0], b) : a.map((r) => dot(r, b));
  }
  if (isMat(a) && isMat(b)) {
    if (a[0].length !== b.length) throw new Error(`尺寸不匹配：${a.length}×${a[0].length} 乘 ${b.length}×${b[0].length}`);
    return a.map((r) => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
  }
  // 列乘一行（a*b'）：外积
  if (isVec(a) && isMat(b)) {
    if (b.length !== 1) throw new Error(`向量是 ${a.length}×1，后面要是一行（1×n）才能相乘；外积写成 u*v'`);
    return a.map((x) => b[0].map((y) => x * y));
  }
  if (isVec(a) && isVec(b)) throw new Error("两个向量不能直接相乘：内积写 dot(u, v) 或 u'*v，外积写 u*v'");
  throw new Error('无法相乘');
}
function power(a, k) {
  num(k);
  if (isNum(a)) return realPow(a, k);
  asMat(a);
  if (k === -1) return inv(a);
  if (!Number.isInteger(k) || k < 0) throw new Error('矩阵只能做非负整数次幂或 ^-1');
  let r = eye(a.length);
  for (let i = 0; i < k; i++) r = mul(r, a);
  return r;
}
// 负数的分数次方：分母是奇数时取实数（x^(1/3) 在 x = −8 是 −2；JS 的 ** 回 NaN）
function realPow(a, k) {
  const r = a ** k;
  if (!(a < 0) || Number.isInteger(k) || !Number.isNaN(r)) return r;
  for (let q = 3; q <= 99; q += 2) {
    const p = Math.round(k * q);
    if (Math.abs(p - k * q) < 1e-9) return (p % 2 ? -1 : 1) * Math.abs(a) ** k;
  }
  return r;
}
export const dot = (u, v) => { if (u.length !== v.length) throw new Error('维数不同'); return u.reduce((s, x, i) => s + x * v[i], 0); };
export const transpose = (M) => M[0].map((_, j) => M.map((r) => r[j]));
// 转置：矩阵照常；向量（列）转成一行 1×n；数不变
function transposeAny(x) {
  if (isNum(x)) return x;
  if (isVec(x)) return [x.slice()];
  return transpose(asMat(x));
}
export const eye = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
function trace(M) {
  if (M.length !== M[0].length) throw new Error('只有方阵才有迹');
  return M.reduce((s, r, i) => s + r[i], 0);
}
function diag(v) {
  if (!v.length) throw new Error('diag 至少要一个数');
  return v.map((x, i) => v.map((_, j) => (i === j ? x : 0)));
}
// 行最简形（浮点，主元选绝对值最大的；精确版在 exact.js）
function rrefFloat(M) {
  const R = M.map((r) => r.slice());
  const rows = R.length, cols = R[0].length;
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let p = r;
    for (let i = r + 1; i < rows; i++) if (Math.abs(R[i][c]) > Math.abs(R[p][c])) p = i;
    if (Math.abs(R[p][c]) < 1e-9) continue;
    [R[r], R[p]] = [R[p], R[r]];
    const k = R[r][c];
    R[r] = R[r].map((x) => x / k);
    for (let i = 0; i < rows; i++) {
      if (i === r) continue;
      const f = R[i][c];
      if (f) R[i] = R[i].map((x, j) => x - f * R[r][j]);
    }
    r++;
  }
  // 消元留下的 -0 和 1e-16 这类噪声清掉
  return { R: R.map((row) => row.map((x) => (Math.abs(x) < 1e-12 ? 0 : x))), rank: r };
}
export function det(M) {
  const n = M.length;
  if (n !== M[0].length) throw new Error('只有方阵才有行列式');
  if (n === 1) return M[0][0];
  if (n === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
  return M[0].reduce((s, a, j) => s + (j % 2 ? -1 : 1) * a * det(M.slice(1).map((r) => r.filter((_, k) => k !== j))), 0);
}
export function inv(M) {
  const n = M.length;
  const d = det(M);
  if (Math.abs(d) < 1e-12) throw new Error('矩阵不可逆');
  const A = M.map((r, i) => [...r, ...eye(n)[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const k = A[c][c];
    A[c] = A[c].map((x) => x / k);
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; A[r] = A[r].map((x, j) => x - f * A[c][j]); }
  }
  return A.map((r) => r.slice(n));
}

// 浮点 → 尽量写成分数的 TeX
export function numTeX(x) {
  if (!Number.isFinite(x)) return '\\text{?}';
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9) return String(r === 0 ? 0 : r);
  const f = toFraction(x);
  if (f) {
    const [p, q] = f;
    return p < 0 ? `-\\tfrac{${-p}}{${q}}` : `\\tfrac{${p}}{${q}}`;
  }
  return String(Number(x.toFixed(2)));
}

export function numText(x) {
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9) return String(r === 0 ? 0 : r);
  const f = toFraction(x);
  return f ? `${f[0]}/${f[1]}` : String(Number(x.toFixed(2)));
}

// 分母不超过 maxDen 时返回 [分子, 分母]
export function toFraction(x, maxDen = 60) {
  for (let q = 2; q <= maxDen; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < 1e-9) return [p, q];
  }
  return null;
}

export function valueTeX(v) {
  if (isRadix(v)) return v.toTeX();
  if (isNum(v)) return numTeX(v);
  if (isMat(v)) return `\\begin{bmatrix}${v.map((r) => r.map(numTeX).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
  if (isVec(v)) return `\\begin{bmatrix}${v.map(numTeX).join(' \\\\ ')}\\end{bmatrix}`;
  return '\\text{?}';
}
