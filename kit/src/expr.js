// 小型表达式语言：数、向量 [1, 2]、矩阵 [[1, 2], [3, 4]]（按行写），
// 支持 + - * / ^、转置 '、函数 det inv T col row dot norm proj rot lerp 等。
// 数值用浮点；判分时再转成分数比较。

const FUNCS = {
  det: (M) => det(asMat(M)),
  inv: (M) => inv(asMat(M)),
  T: (M) => transpose(asMat(M)),
  transpose: (M) => transpose(asMat(M)),
  col: (M, j) => asMat(M).map((r) => r[idx(j, asMat(M)[0].length)]),
  row: (M, i) => asMat(M)[idx(i, asMat(M).length)].slice(),
  dot: (u, v) => dot(asVec(u), asVec(v)),
  norm: (v) => Math.hypot(...asVec(v)),
  proj: (u, v) => scale(dot(asVec(u), asVec(v)) / dot(asVec(v), asVec(v)), asVec(v)),
  cross: (u, v) => { const [a, b, c] = asVec(u), [d, e, f] = asVec(v); return [b * f - c * e, c * d - a * f, a * e - b * d]; },
  rot: (deg) => { const r = (num(deg) * Math.PI) / 180; return [[Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]]; },
  lerp: (a, b, t) => add(scale(1 - num(t), a), scale(num(t), b)),
  mat: (...cols) => transpose(cols.map(asVec)), // 由列向量组成矩阵
  I: (n = 2) => eye(num(n)),
  sqrt: (x) => Math.sqrt(num(x)),
  abs: (x) => Math.abs(num(x)),
  sin: (deg) => Math.sin((num(deg) * Math.PI) / 180),
  cos: (deg) => Math.cos((num(deg) * Math.PI) / 180),
  min: (...a) => Math.min(...a.map(num)),
  max: (...a) => Math.max(...a.map(num)),
  round: (x, n = 0) => { const k = 10 ** num(n); return Math.round(num(x) * k) / k; },
};
const CONSTS = { pi: Math.PI };

export function evaluate(src, vars = {}) {
  const p = new Parser(String(src));
  const ast = p.parseExpr();
  p.expectEnd();
  return run(ast, vars);
}

export function compile(src) {
  const p = new Parser(String(src));
  const ast = p.parseExpr();
  p.expectEnd();
  return (vars = {}) => run(ast, vars);
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
  parseExpr() {
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
    while (this.eat("'")) a = { t: 'call', name: 'T', args: [a] };
    return a;
  }
  parsePrimary() {
    const tok = this.next();
    if (!tok) throw new Error('表达式不完整');
    if (tok.k === 'num') return { t: 'num', v: tok.n };
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
  const re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_Ͱ-Ͽ][\wͰ-Ͽ]*)|(\*\*|[-+*/^()[\],'|·]))/y;
  let m;
  let pos = 0;
  s = s.replace(/−/g, '-').replace(/×/g, '*');
  while (pos < s.length) {
    re.lastIndex = pos;
    if (/^\s*$/.test(s.slice(pos))) break;
    m = re.exec(s);
    if (!m) throw new Error(`无法识别：${s.slice(pos).trim().slice(0, 12)}`);
    pos = re.lastIndex;
    if (m[1] !== undefined) out.push({ k: 'num', v: m[1], n: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ k: 'id', v: m[2] });
    else out.push({ k: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  return out;
}

// —— 求值 ——
function run(n, vars) {
  switch (n.t) {
    case 'num': return n.v;
    case 'var': {
      if (n.name in vars) return vars[n.name];
      if (n.name in CONSTS) return CONSTS[n.name];
      if (n.name === 'I') return eye(2);
      throw new Error(`未定义的变量 ${n.name}`);
    }
    case 'neg': return scale(-1, run(n.a, vars));
    case 'list': return n.items.map((x) => run(x, vars));
    case 'call': {
      const f = FUNCS[n.name];
      if (!f) throw new Error(`没有函数 ${n.name}()`);
      return f(...n.args.map((x) => run(x, vars)));
    }
    case 'bin': {
      const a = run(n.a, vars), b = run(n.b, vars);
      if (n.op === '+') return add(a, b);
      if (n.op === '-') return add(a, scale(-1, b));
      if (n.op === '*') return mul(a, b);
      if (n.op === '/') { if (!isNum(b)) throw new Error('只能除以数'); return scale(1 / b, a); }
      if (n.op === '^') return power(a, b);
    }
  }
  throw new Error('表达式错误');
}

export const isNum = (x) => typeof x === 'number';
export const isVec = (x) => Array.isArray(x) && x.length > 0 && x.every(isNum);
export const isMat = (x) => Array.isArray(x) && x.length > 0 && x.every((r) => isVec(r) && r.length === x[0].length);
const num = (x) => { if (!isNum(x)) throw new Error('这里需要一个数'); return x; };
const asVec = (x) => { if (!isVec(x)) throw new Error('这里需要一个向量'); return x; };
const asMat = (x) => { if (!isMat(x)) throw new Error('这里需要一个矩阵'); return x; };
const idx = (k, n) => { const i = num(k) - 1; if (i < 0 || i >= n || !Number.isInteger(i)) throw new Error(`下标 ${k} 超出范围（从 1 开始数）`); return i; };

export function add(a, b) {
  if (isNum(a) && isNum(b)) return a + b;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((x, i) => add(x, b[i]));
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
    return a.map((r) => dot(r, b));
  }
  if (isMat(a) && isMat(b)) {
    if (a[0].length !== b.length) throw new Error(`尺寸不匹配：${a.length}×${a[0].length} 乘 ${b.length}×${b[0].length}`);
    return a.map((r) => b[0].map((_, j) => r.reduce((s, x, k) => s + x * b[k][j], 0)));
  }
  if (isVec(a) && isVec(b)) throw new Error('两个向量相乘请用 dot(u, v)');
  throw new Error('无法相乘');
}
function power(a, k) {
  num(k);
  if (isNum(a)) return a ** k;
  asMat(a);
  if (k === -1) return inv(a);
  if (!Number.isInteger(k) || k < 0) throw new Error('矩阵只能做非负整数次幂或 ^-1');
  let r = eye(a.length);
  for (let i = 0; i < k; i++) r = mul(r, a);
  return r;
}
export const dot = (u, v) => { if (u.length !== v.length) throw new Error('维数不同'); return u.reduce((s, x, i) => s + x * v[i], 0); };
export const transpose = (M) => M[0].map((_, j) => M.map((r) => r[j]));
export const eye = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j)));
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
  if (isNum(v)) return numTeX(v);
  if (isMat(v)) return `\\begin{bmatrix}${v.map((r) => r.map(numTeX).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`;
  if (isVec(v)) return `\\begin{bmatrix}${v.map(numTeX).join(' \\\\ ')}\\end{bmatrix}`;
  return '\\text{?}';
}
