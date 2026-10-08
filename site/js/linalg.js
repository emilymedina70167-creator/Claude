// 精确分数运算 + 线性代数算法（不依赖 DOM，可在 Node 里测试）

const gcd = (a, b) => {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
};

export class Frac {
  constructor(n, d = 1) {
    if (d === 0) throw new Error('分母不能为 0');
    if (d < 0) { n = -n; d = -d; }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  static from(x) {
    if (x instanceof Frac) return x;
    if (typeof x === 'number') {
      if (Number.isInteger(x)) return new Frac(x, 1);
      let d = 1;
      while (!Number.isInteger(Math.round(x * d * 1e9) / 1e9) && d < 1e6) d *= 10;
      return new Frac(Math.round(x * d), d);
    }
    const s = String(x).trim();
    const m = s.match(/^([-+]?\d*\.?\d+)\s*\/\s*([-+]?\d*\.?\d+)$/);
    if (m) return Frac.from(Number(m[1])).div(Frac.from(Number(m[2])));
    const v = Number(s);
    if (s === '' || Number.isNaN(v)) throw new Error(`无法识别的数字：${s}`);
    return Frac.from(v);
  }
  add(o) { o = Frac.from(o); return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { o = Frac.from(o); return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { o = Frac.from(o); return new Frac(this.n * o.n, this.d * o.d); }
  div(o) { o = Frac.from(o); return new Frac(this.n * o.d, this.d * o.n); }
  neg() { return new Frac(-this.n, this.d); }
  isZero() { return this.n === 0; }
  isOne() { return this.n === 1 && this.d === 1; }
  equals(o) { o = Frac.from(o); return this.n === o.n && this.d === o.d; }
  valueOf() { return this.n / this.d; }
  toString() { return this.d === 1 ? `${this.n}` : `${this.n}/${this.d}`; }
  toTeX() {
    if (this.d === 1) return `${this.n}`;
    return this.n < 0 ? `-\\tfrac{${-this.n}}{${this.d}}` : `\\tfrac{${this.n}}{${this.d}}`;
  }
}

// 宽松的矩阵/向量解析：支持 [[1, 2], [3, 4]]、[1 2; 3 4]、分数 1/2、小数
export function parseArray(str) {
  const tokens = String(str).match(/\[|\]|;|[-+]?\d*\.?\d+(?:\s*\/\s*\d*\.?\d+)?/g);
  if (!tokens) throw new Error(`无法解析：${str}`);
  const root = [];
  const stack = [root];
  for (const t of tokens) {
    const top = stack[stack.length - 1];
    if (t === '[') { const a = []; top.push(a); stack.push(a); }
    else if (t === ']') { if (stack.length > 1) stack.pop(); }
    else if (t === ';') top.push(SEMI);
    else top.push(Frac.from(t.replace(/\s/g, '')));
  }
  const fix = (a) => {
    if (!Array.isArray(a)) return a;
    if (a.includes(SEMI)) {
      const rows = [[]];
      for (const x of a) x === SEMI ? rows.push([]) : rows[rows.length - 1].push(fix(x));
      return rows.filter((r) => r.length);
    }
    return a.map(fix);
  };
  const out = fix(root);
  // root 是额外包的一层；写法不带外层括号（如 "1 2; 3 4"）时直接返回
  return out.length === 1 && Array.isArray(out[0]) ? out[0] : out;
}
const SEMI = Symbol('row');

export function asMatrix(a) {
  if (!Array.isArray(a)) throw new Error('需要一个矩阵');
  if (!Array.isArray(a[0])) return [a];
  const w = a[0].length;
  if (a.some((r) => r.length !== w)) throw new Error('矩阵每一行的元素个数必须相同');
  return a;
}

export const toNum = (a) => (Array.isArray(a) ? a.map(toNum) : Number(a));

// 高斯-若尔当消元，记录每一步，方便逐步播放
export function rrefSteps(input, { mode = 'rref', augmented = false } = {}) {
  const M = input.map((r) => r.map((x) => Frac.from(x)));
  const rows = M.length;
  const cols = M[0].length;
  const pivotLimit = augmented ? cols - 1 : cols;
  const steps = [{ matrix: copy(M), op: null, rows: [] }];
  const pivots = [];
  const R = (i) => `R_{${i + 1}}`;
  let r = 0;
  for (let c = 0; c < pivotLimit && r < rows; c++) {
    // 选主元：优先选 ±1，少出分数
    let pick = -1;
    for (let i = r; i < rows; i++) {
      if (M[i][c].isZero()) continue;
      if (pick < 0) pick = i;
      if (Math.abs(M[i][c].n) === 1 && M[i][c].d === 1) { pick = i; break; }
    }
    if (pick < 0) continue;
    if (pick !== r) {
      [M[pick], M[r]] = [M[r], M[pick]];
      steps.push({ matrix: copy(M), op: `${R(r)} \\leftrightarrow ${R(pick)}`, rows: [r, pick], kind: 'swap' });
    }
    const p = M[r][c];
    if (mode === 'rref' && !p.isOne()) {
      const k = new Frac(1).div(p);
      M[r] = M[r].map((x) => x.mul(k));
      steps.push({ matrix: copy(M), op: `${R(r)} \\to ${coef(k)}${R(r)}`, rows: [r], kind: 'scale' });
    }
    for (let i = 0; i < rows; i++) {
      if (i === r || M[i][c].isZero()) continue;
      if (mode !== 'rref' && i < r) continue;
      const f = M[i][c].div(M[r][c]);
      M[i] = M[i].map((x, j) => x.sub(f.mul(M[r][j])));
      const sign = f.n > 0 ? '-' : '+';
      const af = f.n > 0 ? f : f.neg();
      steps.push({ matrix: copy(M), op: `${R(i)} \\to ${R(i)} ${sign} ${coef(af)}${R(r)}`, rows: [i], src: r, kind: 'replace' });
    }
    pivots.push([r, c]);
    r++;
  }
  return { steps, pivots, result: M, rows, cols, augmented };
}

const coef = (k) => (k.isOne() ? '' : k.d === 1 ? `${k.n}` : `\\left(${k.toTeX()}\\right)`);
const copy = (M) => M.map((r) => r.slice());

// 对增广矩阵的 RREF 判断解的情况
export function classify({ result, pivots, cols, augmented }) {
  if (!augmented) return null;
  const nVars = cols - 1;
  const inconsistent = result.some((row) => row.slice(0, nVars).every((x) => x.isZero()) && !row[nVars].isZero());
  if (inconsistent) return { type: 'none' };
  const pivotCols = pivots.map(([, c]) => c);
  const free = [];
  for (let j = 0; j < nVars; j++) if (!pivotCols.includes(j)) free.push(j);
  if (!free.length) {
    const x = new Array(nVars);
    for (const [r, c] of pivots) x[c] = result[r][nVars];
    return { type: 'unique', x };
  }
  return { type: 'infinite', free, pivotCols };
}

export function matmul(A, B) {
  if (A[0].length !== B.length) throw new Error(`尺寸不匹配：A 是 ${A.length}×${A[0].length}，B 是 ${B.length}×${B[0].length}`);
  return A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s.add(a.mul(B[k][j])), new Frac(0))));
}

// 2×2 实特征值/特征向量（浮点，用于作图）
export function eigen2([[a, b], [c, d]]) {
  const tr = a + d;
  const det = a * d - b * c;
  const disc = tr * tr - 4 * det;
  if (disc < -1e-12) return { complex: true, tr, det, re: tr / 2, im: Math.sqrt(-disc) / 2 };
  const s = Math.sqrt(Math.max(disc, 0));
  const ls = disc < 1e-12 ? [tr / 2] : [(tr + s) / 2, (tr - s) / 2];
  const out = [];
  for (const l of ls) {
    if (Math.abs(b) > 1e-12) out.push({ value: l, vector: norm([b, l - a]) });
    else if (Math.abs(c) > 1e-12) out.push({ value: l, vector: norm([l - d, c]) });
    else {
      // 对角矩阵
      if (Math.abs(a - d) < 1e-12) return { complex: false, tr, det, scalar: true, values: [a] };
      out.push({ value: l, vector: Math.abs(l - a) < 1e-12 ? [1, 0] : [0, 1] });
    }
  }
  return { complex: false, tr, det, pairs: out };
}
const norm = ([x, y]) => { const n = Math.hypot(x, y) || 1; return [x / n, y / n]; };

export function fmt(x, digits = 2) {
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  return Number(x.toFixed(digits)).toString();
}
