// 初等行变换（组件 elim，线代）：一个引擎管考研里所有「化成阶梯形再读答案」的题——
//   求秩；向量组的秩、极大无关组、其余向量怎么表示；解线性方程组（唯一解 / 无解 / 通解）；
//   含一个参数的方程组（主元是参数的式子时分情况讨论）；求逆矩阵 [A | E]；解矩阵方程 AX = B、XA = B。
// 数是精确分数，参数的式子是多项式（poly.js）。一步一个行变换，老师也可以自己写 ops: 指定每一步。
// 纯函数，不碰 DOM（tests/elim-engine.test.js）；画面里的公式用外壳传进来的 tex()。
import { Q } from '../exact.js';
import { Poly, P } from '../poly.js';
import { esc } from './arrayview.js';

const ZERO = new Q(0n), ONE = new Q(1n);

// ================= 写法：矩阵、向量、含参数的式子 =================

/** 一个式子（数、分数、参数的多项式）→ Poly。name 是参数的名字（没有参数时为 ''） */
export function parsePolyExpr(src, name = '') {
  const s = String(src ?? '').replace(/\s+/g, '').replace(/−/g, '-').replace(/×/g, '*');
  if (!s) throw new Error('有一格是空的');
  let i = 0;
  const peek = () => s[i];
  const fail = (msg) => { throw new Error(`看不懂「${src}」：${msg}`); };
  const isName = () => name && s.startsWith(name, i);
  function primary() {
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') fail('括号没有配对'); i++; return v; }
    const m = /^\d+(?:\.\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return P(Q.from(Number(m[0]))); }
    if (isName()) { i += name.length; return Poly.x(); }
    if (/[A-Za-zα-ωλ]/.test(peek() || '')) fail(name ? `只能用参数 ${name}` : '这里只能写数（含参数的要写 param:）');
    return fail('少了一个数');
  }
  function power() {
    let v = primary();
    if (peek() === '^') {
      i++;
      const m = /^\d+/.exec(s.slice(i));
      if (!m) fail('^ 后面要写整数次幂');
      i += m[0].length;
      v = v.pow(Number(m[0]));
    }
    return v;
  }
  function unary() {
    if (peek() === '-') { i++; return unary().neg(); }
    if (peek() === '+') { i++; return unary(); }
    return power();
  }
  function term() {
    let v = unary();
    for (;;) {
      if (peek() === '*') { i++; v = v.mul(unary()); continue; }
      if (peek() === '/') {
        i++;
        const d = unary();
        if (!d.isConst || d.zero) fail(d.zero ? '除以 0 了' : '不能除以含参数的式子');
        v = v.scale(ONE.div(d.constValue()));
        continue;
      }
      // 省略乘号：2a、a(a+1)、(a-1)(a+2)
      if (peek() === '(' || isName() || (/\d/.test(peek() || '') && /[)a-zα-ωλ]/i.test(s[i - 1] || ''))) { v = v.mul(power()); continue; }
      return v;
    }
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const op = s[i++]; const t = term(); v = op === '+' ? v.add(t) : v.sub(t); }
    return v;
  }
  const v = expr();
  if (i < s.length) fail(`多了「${s.slice(i)}」`);
  return v;
}

// [[1, 2], [3, 4]] / [1, 2] / (1, 2)：按括号拆，逗号分格（式子里可以有括号）
function splitTop(src) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of src) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if ((ch === ',' || ch === '，') && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const unwrap = (s, what) => {
  const t = String(s ?? '').trim();
  if (!/^[[(].*[\])]$/s.test(t)) throw new Error(`${what}要用方括号写，如 [[1, 2], [3, 4]]`);
  return t.slice(1, -1);
};
export function parseMatrixSrc(src, name, what = 'matrix') {
  const rows = splitTop(unwrap(src, `${what}: `)).map((r, k) => splitTop(unwrap(r, `${what}: 第 ${k + 1} 行`)).map((x) => parsePolyExpr(x, name)));
  if (!rows.length) throw new Error(`${what}: 是空的`);
  const n = rows[0].length;
  rows.forEach((r, k) => { if (r.length !== n) throw new Error(`${what}: 第 ${k + 1} 行有 ${r.length} 个数，第 1 行有 ${n} 个`); });
  return rows;
}
function parseVectorSrc(src, name, what) {
  return splitTop(unwrap(src, `${what}: `)).map((x) => parsePolyExpr(x, name));
}

// ================= 行变换 =================

// 一行的整体系数提出来（只提常数）：(2, 4, 6) → 提出 2；系数都是分数时乘成整数
function rowContent(row) {
  const qs = row.flatMap((p) => p.c);
  if (!qs.length) return null;
  const g = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
  if (qs.some((x) => !x.integer)) {
    const L = qs.reduce((m, x) => m / g(m, x.d) * x.d, 1n);
    return new Q(L); // 乘 L 去掉分母
  }
  const d = qs.reduce((m, x) => g(m, x.n), 0n);
  return d > 1n ? new Q(1n, d) : null;
}

const texQ = (x) => x.toTeX();
// 系数写在 R 前面：1 不写、−1 写成 −、分数和式子加括号
function coefTeX(p, v) {
  if (p.isConst) {
    const k = p.constValue();
    if (k.n === 1n && k.d === 1n) return '';
    if (k.n === -1n && k.d === 1n) return '-';
    return k.d === 1n ? texQ(k) : `\\left(${texQ(k)}\\right)`;
  }
  return `(${p.toFactorTeX(v)})`;
}
const R = (i) => `R_{${i + 1}}`;

function applyOp(M, op) {
  const A = M.map((r) => r.slice());
  if (op.kind === 'swap') [A[op.i], A[op.j]] = [A[op.j], A[op.i]];
  else if (op.kind === 'scale') A[op.i] = A[op.i].map((x) => x.mul(op.k));
  else if (op.kind === 'add') A[op.i] = A[op.i].map((x, c) => x.add(op.k.mul(A[op.j][c])));
  else if (op.kind === 'comb') A[op.i] = A[op.i].map((x, c) => op.a.mul(x).add(op.b.mul(A[op.j][c])));
  return A;
}
function opTeX(op, v) {
  if (op.kind === 'swap') return `${R(op.i)} \\leftrightarrow ${R(op.j)}`;
  if (op.kind === 'scale') return `${R(op.i)} \\to ${coefTeX(op.k, v)}${R(op.i)}`;
  if (op.kind === 'add') {
    const neg = op.k.isConst ? op.k.constValue().n < 0n : false;
    const k = neg ? op.k.neg() : op.k;
    return `${R(op.i)} \\to ${R(op.i)} ${neg ? '-' : '+'} ${coefTeX(k, v)}${R(op.j)}`;
  }
  const negB = op.b.isConst && op.b.constValue().n < 0n;
  const b = negB ? op.b.neg() : op.b;
  return `${R(op.i)} \\to ${coefTeX(op.a, v)}${R(op.i)} ${negB ? '-' : '+'} ${coefTeX(b, v)}${R(op.j)}`;
}
function opText(op) {
  if (op.kind === 'swap') return `交换第 ${op.i + 1}、${op.j + 1} 行`;
  if (op.kind === 'scale') return `第 ${op.i + 1} 行乘 ${op.k.isConst ? op.k.constValue().toString() : '一个式子'}`;
  return `第 ${op.i + 1} 行加上第 ${op.j + 1} 行的倍数`;
}

/** 老师写的 ops：r1 <-> r2；r2 - 2r1；r3 + (1/2)r1；r2 - a r1；2r2、r2 / 3、-r1 */
export function parseOps(src, rows, name = '') {
  const parts = String(src ?? '').split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean);
  return parts.map((t) => {
    const s = t.replace(/\s+/g, '').replace(/−/g, '-').replace(/[Rr]/g, 'r');
    const row = (k) => { const i = Number(k) - 1; if (!(i >= 0 && i < rows)) throw new Error(`ops: 「${t}」里的第 ${k} 行不存在（一共 ${rows} 行）`); return i; };
    let m = /^r(\d+)(?:<->|↔|<=>)r(\d+)$/.exec(s);
    if (m) return { kind: 'swap', i: row(m[1]), j: row(m[2]) };
    m = /^r(\d+)([+-])(.*?)\*?r(\d+)$/.exec(s);
    if (m && m[1] !== m[4]) {
      const k = m[3] === '' ? P(1) : parsePolyExpr(m[3].replace(/^\((.*)\)$/, '$1'), name);
      return { kind: 'add', i: row(m[1]), j: row(m[4]), k: m[2] === '-' ? k.neg() : k };
    }
    m = /^r(\d+)\/(.+)$/.exec(s);
    if (m) { const d = parsePolyExpr(m[2], name); if (!d.isConst || d.zero) throw new Error(`ops: 「${t}」只能除以不为 0 的数`); return { kind: 'scale', i: row(m[1]), k: P(ONE.div(d.constValue())) }; }
    m = /^r(\d+)\*(.+)$/.exec(s) || /^(.*?)\*?r(\d+)$/.exec(s);
    if (m) {
      const [ri, kk] = /^r/.test(s) ? [m[1], m[2]] : [m[2], m[1]];
      const k = kk === '-' ? P(-1) : parsePolyExpr(kk.replace(/^\((.*)\)$/, '$1'), name);
      if (k.zero) throw new Error(`ops: 「${t}」一行乘 0 不是初等变换`);
      if (!k.isConst) throw new Error(`ops: 「${t}」一行乘含参数的式子，参数取某些值时这个式子是 0：要分情况，这里不允许（自动消元会处理）`);
      return { kind: 'scale', i: row(ri), k };
    }
    throw new Error(`ops: 看不懂「${t}」，写成 r1 <-> r2、r2 - 2r1、r3 + (1/2)r1、2r2、r2 / 3`);
  });
}

// ================= 解析组件 =================

export function parse(fields) {
  const name = String(fields.param ?? '').trim();
  if (name && !/^[A-Za-zα-ωλ]$/.test(name)) throw new Error('param: 写一个字母的参数名（如 a、k、λ）');
  let A, names = null, B = null, goal;
  if (fields.vectors !== undefined) {
    const parts = splitTop(String(fields.vectors));
    if (parts.length < 2) throw new Error('vectors: 至少写两个向量，如 a1 = (1, 2), a2 = (3, 4)');
    const vecs = parts.map((p, k) => {
      const m = /^([A-Za-zα-ω]\w*)\s*=\s*(.*)$/s.exec(p);
      return { name: m ? m[1] : `α${k + 1}`, v: parseVectorSrc(m ? m[2] : p, name, 'vectors') };
    });
    const n = vecs[0].v.length;
    vecs.forEach((x) => { if (x.v.length !== n) throw new Error(`vectors: ${x.name} 有 ${x.v.length} 个分量，${vecs[0].name} 有 ${n} 个`); });
    A = Array.from({ length: n }, (_, i) => vecs.map((x) => x.v[i]));
    names = vecs.map((x) => x.name);
    goal = 'basis';
  } else {
    if (fields.matrix === undefined && fields.a === undefined) throw new Error('elim 要写 matrix:（矩阵），或者 vectors:（向量组）');
    A = parseMatrixSrc(fields.matrix ?? fields.a, name, 'matrix');
    goal = 'rank';
  }
  const m = A.length, n = A[0].length;
  if (m > 6 || n > 7) throw new Error('矩阵最大 6 行 7 列（一屏放得下）');
  let side = 'left';
  if (fields.b !== undefined) {
    const b = parseVectorSrc(fields.b, name, 'b');
    if (b.length !== m) throw new Error(`b: 要有 ${m} 个数（和矩阵的行数一样），现在 ${b.length} 个`);
    B = b.map((x) => [x]);
    goal = 'solve';
  } else if (/^(true|yes|1|是)$/i.test(String(fields.augmented || '').trim())) {
    if (n < 2) throw new Error('augmented: true 时最后一列是常数项，矩阵至少要两列');
    B = A.map((r) => [r[n - 1]]);
    A = A.map((r) => r.slice(0, n - 1));
    goal = 'solve';
  } else if (/^(true|yes|1|是)$/i.test(String(fields.inverse || '').trim())) {
    if (m !== n) throw new Error('求逆矩阵要是方阵');
    B = A.map((_, i) => A.map((__, j) => P(i === j ? 1 : 0)));
    goal = 'inverse';
  } else if (fields.rhs !== undefined || fields.bmatrix !== undefined) {
    B = parseMatrixSrc(fields.rhs ?? fields.bmatrix, name, 'rhs');
    side = String(fields.side || 'left').trim().toLowerCase() === 'right' ? 'right' : 'left';
    if (side === 'right') {
      // XA = B：两边转置，A^T X^T = B^T
      if (B[0].length !== n) throw new Error(`XA = B：B 的列数要和 A 的列数一样（${n}）`);
      A = A[0].map((_, j) => A.map((r) => r[j]));
      B = B[0].map((_, j) => B.map((r) => r[j]));
    } else if (B.length !== m) throw new Error(`AX = B：B 的行数要和 A 一样（${m}）`);
    goal = 'matrixeq';
  }
  if (name && !['solve', 'rank', 'basis'].includes(goal)) throw new Error('含参数的只能求秩、向量组、解方程组（求逆、矩阵方程先把参数取定）');
  if (name && ![...A.flat(), ...(B || []).flat()].some((p) => !p.isConst)) throw new Error(`写了 param: ${name}，矩阵里却没有 ${name}`);
  if (!name && [...A.flat(), ...(B || []).flat()].some((p) => !p.isConst)) throw new Error('矩阵里有字母：要写 param:（参数名）');
  const want = String(fields.goal || '').trim().toLowerCase();
  if (want) {
    const G = { rank: 'rank', 秩: 'rank', basis: 'basis', 极大无关组: 'basis', solve: 'solve', 解: 'solve', inverse: 'inverse', 逆: 'inverse' };
    if (!G[want]) throw new Error('goal: 写 rank、basis、solve 或 inverse');
    if (G[want] === 'basis' && !names) names = A[0].map((_, j) => `α${j + 1}`);
    if (G[want] === 'basis' && B) throw new Error('goal: basis 不要写 b:');
    goal = G[want];
  }
  const vars = String(fields.vars || '').split(/[,，\s]+/).filter(Boolean);
  const mode = goal === 'rank' && !name ? 'ref' : String(fields.mode || '').trim().toLowerCase() === 'ref' ? 'ref' : 'rref';
  const ops = fields.ops ? parseOps(fields.ops, m, name) : null;
  return { A, B, names, goal, param: name, vars, mode: name ? 'ref' : mode, ops, side, n: A[0].length, m };
}

// ================= 跑 =================

const isZeroRow = (row, upto) => row.slice(0, upto).every((x) => x.zero);
const lead = (row, upto) => row.slice(0, upto).findIndex((x) => !x.zero);

// 当前矩阵是不是阶梯形 / 最简形（判断老师写的 ops 做完了没有）
function isRef(M, n) {
  let last = -1, zero = false;
  for (const row of M) {
    const l = lead(row, n);
    if (l < 0) { zero = true; continue; }
    if (zero || l <= last) return false;
    last = l;
  }
  return true;
}
function isRref(M, n) {
  if (!isRef(M, n)) return false;
  for (let i = 0; i < M.length; i++) {
    const l = lead(M[i], n);
    if (l < 0) continue;
    const p = M[i][l];
    if (!(p.isConst && p.constValue().n === 1n && p.constValue().d === 1n)) return false;
    for (let k = 0; k < M.length; k++) if (k !== i && !M[k][l].zero) return false;
  }
  return true;
}

/** 自动消元：先往下消成阶梯形（尽量不出分数），要最简形再从下往上把主元化成 1、消掉上面的 */
function autoOps(M0, n, mode, param) {
  const ops = [];
  let M = M0.map((r) => r.slice());
  const conds = []; // 含参数时用到的「这个式子不为 0」
  const push = (op, extra = {}) => { M = applyOp(M, op); ops.push({ op, M: M.map((r) => r.slice()), ...extra }); };
  const tidy = (i) => {
    // 一行有公因数就提出来、有分母就乘掉（只用常数，不改变解）
    const k = rowContent(M[i]);
    if (k && !(k.n === 1n && k.d === 1n)) push({ kind: 'scale', i, k: P(k) }, { tidy: true });
  };
  let r = 0;
  const pivots = [];
  for (let c = 0; c < n && r < M.length; c++) {
    let best = -1, score = Infinity;
    for (let i = r; i < M.length; i++) {
      const x = M[i][c];
      if (x.zero) continue;
      // 主元：±1 最好，其次小的整数，再次分数，含参数的式子最后（次数低的先）
      const s = x.isConst ? (x.constValue().d === 1n ? (x.constValue().n === 1n || x.constValue().n === -1n ? 0 : 1 + Math.min(1000, Math.abs(Number(x.constValue().n))) / 1000) : 3) : 10 + x.deg;
      if (s < score) { score = s; best = i; }
    }
    if (best < 0) continue;
    if (best !== r) push({ kind: 'swap', i: r, j: best });
    const p = M[r][c];
    if (!p.isConst) conds.push(p);
    for (let i = r + 1; i < M.length; i++) {
      const e = M[i][c];
      if (e.zero) continue;
      if (p.isConst) {
        const k = e.scale(ONE.div(p.constValue())).neg();
        if (k.isConst && !k.constValue().integer && e.isConst) {
          // 会出分数：两行都乘一下（R_i → pR_i − eR_r，再约掉公因数）
          const g = gcdQ(p.constValue(), e.constValue());
          push({ kind: 'comb', i, a: P(p.constValue().div(g)), j: r, b: P(e.constValue().div(g).neg()) });
        } else push({ kind: 'add', i, j: r, k });
      } else {
        // 主元含参数：R_i → p·R_i − e·R_r（p ≠ 0 时这样做不改变解）
        push({ kind: 'comb', i, a: p, j: r, b: e.neg() }, { cond: p });
      }
      tidy(i);
    }
    pivots.push([r, c]);
    r++;
  }
  if (mode === 'rref') {
    for (let t = pivots.length - 1; t >= 0; t--) {
      const [pr, pc] = pivots[t];
      const p = M[pr][pc];
      if (p.isConst && !(p.constValue().n === 1n && p.constValue().d === 1n)) push({ kind: 'scale', i: pr, k: P(ONE.div(p.constValue())) });
      for (let i = pr - 1; i >= 0; i--) {
        const e = M[i][pc];
        if (e.zero) continue;
        push({ kind: 'add', i, j: pr, k: e.neg() });
      }
    }
  }
  return { ops, M, conds };
}
function gcdQ(a, b) {
  // 两个整数的最大公因数（都是整数时）；不是整数就返回 1
  if (!a.integer || !b.integer) return ONE;
  let x = a.n < 0n ? -a.n : a.n, y = b.n < 0n ? -b.n : b.n;
  while (y) [x, y] = [y, x % y];
  return new Q(x || 1n);
}

/** 不含参数的矩阵：行最简形、秩、主元列 */
export function rrefQ(M0, n) {
  const { M } = autoOps(M0, n, 'rref', '');
  const pivots = [];
  M.forEach((row, i) => { const l = lead(row, n); if (l >= 0) pivots.push([i, l]); });
  return { M, pivots };
}

// 方程组的解（不含参数，M 是 [A | b] 的行最简形）
export function solution(M, n, pivots) {
  const inconsistent = M.some((row) => isZeroRow(row, n) && !row[n].zero);
  if (inconsistent) return { kind: 'none' };
  const pc = pivots.map(([, c]) => c);
  const free = Array.from({ length: n }, (_, j) => j).filter((j) => !pc.includes(j));
  const x0 = Array(n).fill(ZERO);
  for (const [i, c] of pivots) x0[c] = M[i][n].constValue();
  if (!free.length) return { kind: 'unique', x: x0 };
  const basis = free.map((f) => {
    const v = Array(n).fill(ZERO);
    v[f] = ONE;
    for (const [i, c] of pivots) v[c] = M[i][f].constValue().neg();
    return v;
  });
  return { kind: 'infinite', x0, basis, free };
}

const colTeX = (v) => `\\begin{pmatrix}${v.map((x) => x.toTeX()).join('\\\\')}\\end{pmatrix}`;
const KIND_TEXT = { none: '无解', unique: '唯一解', infinite: '无穷多解' };

export function run(input) {
  const { A, B, goal, param, mode, n } = input;
  const v = param === 'λ' ? '\\lambda' : param;
  const M0 = A.map((r, i) => [...r, ...(B ? B[i] : [])]);
  const steps = [];
  const notes = []; // 画面下方逐步累积的结论
  const view = (M, extra = {}) => ({ M: M.map((r) => r.slice()), notes: notes.slice(), ...extra });
  const intro = {
    rank: '求秩：用初等行变换化成行阶梯形，非零行的行数就是秩。',
    basis: `向量按列排成矩阵 (${(input.names || []).join(', ')})，只做初等行变换：行变换不改变列与列之间的线性关系，化成行最简形以后，各列之间的关系一眼就能读出来。`,
    solve: param ? `方程组含参数 ${param}：增广矩阵 (A | b) 用初等行变换化成阶梯形。主元是含 ${param} 的式子时，它可能等于 0，所以先不除它，最后再分情况讨论。` : '解方程组：增广矩阵 (A | b) 用初等行变换化成行最简形，再看 r(A) 和 r(A | b)。',
    inverse: '求逆：在 A 的右边拼上单位矩阵 E，对 (A | E) 做初等行变换，左边化成 E 的时候，右边就是 A⁻¹。',
    matrixeq: input.side === 'right' ? 'XA = B：两边转置得 AᵀXᵀ = Bᵀ，对 (Aᵀ | Bᵀ) 做初等行变换，左边化成 E 时右边是 Xᵀ，再转置回来。' : 'AX = B：对 (A | B) 做初等行变换，左边化成 E 的时候，右边就是 X = A⁻¹B（不用先求 A⁻¹）。',
  }[goal];
  steps.push({ view: view(M0), msg: intro });

  // —— 一步步的行变换：老师写的 ops，做完不是要的样子就自动接着做 ——
  let M = M0;
  const conds = [];
  if (input.ops) {
    for (const op of input.ops) {
      M = applyOp(M, op);
      steps.push({ view: view(M, { op: opTeX(op, v), changed: op.kind === 'swap' ? [op.i, op.j] : [op.i], src: op.j }), msg: `${opText(op)}。` });
    }
  }
  const done = () => (input.mode === 'rref' ? isRref(M, n) : isRef(M, n));
  let autoNote = '';
  if (!done()) {
    if (input.ops) autoNote = `（ops 做完还不是${input.mode === 'rref' ? '行最简形' : '行阶梯形'}，后面自动接着做）`;
    const auto = autoOps(M, n, input.mode, param);
    for (const s of auto.ops) {
      const op = s.op;
      const why = s.tidy ? `这一行${op.k.constValue().integer ? '有分母，乘掉' : '有公因数，提出来'}，数小一点好算` : s.cond ? `主元 ${s.cond.toFactorTeX(v)} 含参数，先不除它：两行交叉相乘再相减（这一步要求 ${s.cond.toFactorTeX(v)} ≠ 0，最后单独讨论它等于 0 的情况）` : op.kind === 'swap' ? '换一行当主元（±1 最好算）' : '把主元下面（或上面）的数消成 0';
      steps.push({ view: view(s.M, { op: opTeX(op, v), changed: op.kind === 'swap' ? [op.i, op.j] : [op.i], src: op.j }), msg: `${steps.length === 1 && autoNote ? autoNote : ''}${why}。` });
    }
    M = auto.M;
    conds.push(...auto.conds);
  }
  const pivots = [];
  M.forEach((row, i) => { const l = lead(row, n); if (l >= 0) pivots.push([i, l]); });
  const rankA = pivots.length;

  if (param) return paramCases(input, M, M0, steps, notes, view, v, conds);

  if (goal === 'rank') {
    notes.push(`r(A) = ${rankA}`);
    steps.push({ view: view(M, { pivots }), msg: `化成行阶梯形了：非零行有 ${rankA} 行，所以 r(A) = ${rankA}。`, ask: { tag: 'rank', kind: 'number', q: '这个矩阵的秩是多少？', answer: rankA } });
    return { steps, rank: rankA, M };
  }
  if (goal === 'basis') {
    const names = input.names;
    const pc = pivots.map(([, c]) => c);
    notes.push(`r = ${rankA}`);
    steps.push({ view: view(M, { pivots }), msg: `行最简形有 ${rankA} 个非零行：向量组的秩是 ${rankA}。`, ask: { tag: 'rank', kind: 'number', q: '向量组的秩是多少？', answer: rankA } });
    // 所有的极大无关组：任取秩那么多列，线性无关就是
    const alts = combos(n, rankA).filter((cs) => rrefQ(M0.map((r) => cs.map((c) => r[c])), cs.length).pivots.length === rankA).map((cs) => cs.map((c) => names[c]));
    notes.push(`极大无关组：${pc.map((c) => names[c]).join(', ')}`);
    steps.push({ view: view(M, { pivots, hlCols: pc }), msg: `主元在第 ${pc.map((c) => c + 1).join('、')} 列：${pc.map((c) => names[c]).join('、')} 就是一个极大无关组${alts.length > 1 ? `（不唯一：任意 ${rankA} 个线性无关的都行，比如 ${alts.slice(0, 3).map((x) => x.join('、')).join('；')}）` : ''}。`, ask: { tag: 'basis', kind: 'pick', count: rankA, q: `点出一个极大无关组（${rankA} 个向量）。`, alts } });
    const reps = [];
    for (let j = 0; j < n; j++) {
      if (pc.includes(j)) continue;
      const coef = pivots.map(([i]) => M[i][j].constValue());
      const terms = coef.map((k, t) => ({ k, name: names[pc[t]] })).filter((x) => !x.k.zero);
      const tex = terms.length ? terms.map((x, t) => `${t && x.k.n > 0n ? '+' : ''}${x.k.n === 1n && x.k.d === 1n ? '' : x.k.n === -1n && x.k.d === 1n ? '-' : x.k.toTeX()}${texName(x.name)}`).join('') : '0';
      reps.push({ j, coef, tex });
      notes.push(`${names[j]} = ${tex}`);
      steps.push({ view: view(M, { pivots, hlCols: [j] }), msg: `看最简形的第 ${j + 1} 列 (${coef.map((k) => k.toString()).join(', ')})ᵀ：$${texName(names[j])} = ${tex}$。`, ask: { tag: 'combo', kind: 'text', q: `${names[j]} 用 ${pc.map((c) => names[c]).join('、')} 表示时，系数依次是多少？（空格隔开）`, answer: coef.map((k) => k.toString()).join(' ') } });
    }
    return { steps, rank: rankA, pivots: pc, reps, M };
  }
  if (goal === 'solve') {
    const augRank = M.filter((row) => !isZeroRow(row, n + 1)).length;
    const sol = solution(M, n, pivots);
    const kind = sol.kind;
    notes.push(`r(A) = ${rankA}，r(A | b) = ${augRank}`);
    steps.push({ view: view(M, { pivots }), msg: `r(A) = ${rankA}，r(A | b) = ${augRank}，未知数 ${n} 个：${kind === 'none' ? 'r(A) < r(A | b)，最后一列冒出一个主元（0 = 非零），无解' : kind === 'unique' ? `r(A) = r(A | b) = n = ${n}，唯一解` : `r(A) = r(A | b) = ${rankA} < ${n}，无穷多解，有 ${n - rankA} 个自由未知数`}。`, ask: { tag: 'kind', kind: 'choice', q: '这个方程组的解是哪种情况？', choices: ['无解', '唯一解', '无穷多解'], answer: KIND_TEXT[kind] } });
    if (kind === 'unique') {
      notes.push(`x = ${sol.x.map((x) => x.toString()).join(', ')}`);
      steps.push({ view: view(M, { pivots }), msg: `读出唯一解：${sol.x.map((x, j) => `$${varTeX(input, j)} = ${x.toTeX()}$`).join('，')}。`, ask: { tag: 'x', kind: 'text', q: `依次写出 ${Array.from({ length: n }, (_, j) => varName(input, j)).join('、')}（空格隔开）。`, answer: sol.x.map((x) => x.toString()).join(' ') } });
    } else if (kind === 'infinite') {
      const fv = sol.free.map((j) => varName(input, j));
      steps.push({ view: view(M, { pivots, hlCols: sol.free }), msg: `不是主元列的未知数 ${fv.join('、')} 是自由未知数（${n} − ${rankA} = ${n - rankA} 个）。`, ask: { tag: 'free', kind: 'number', q: '有几个自由未知数？', answer: n - rankA } });
      notes.push(`特解 η = ${sol.x0.map((x) => x.toString()).join(', ')}`);
      steps.push({ view: view(M, { pivots }), msg: `特解：自由未知数都取 0，η = $${colTeX(sol.x0)}$。`, ask: { tag: 'particular', kind: 'text', q: `自由未知数都取 0，特解是什么？依次写出 ${Array.from({ length: n }, (_, j) => varName(input, j)).join('、')}。`, answer: sol.x0.map((x) => x.toString()).join(' ') } });
      notes.push(`基础解系 ${sol.basis.map((b, t) => `ξ${t + 1} = (${b.map((x) => x.toString()).join(', ')})`).join('，')}`);
      steps.push({ view: view(M, { pivots }), msg: `导出组 Ax = 0 的基础解系：自由未知数 ${fv.join('、')} 依次取 ${sol.free.map((_, t) => `(${sol.free.map((__, u) => (u === t ? 1 : 0)).join(', ')})`).join('、')}：${sol.basis.map((b, t) => `$\\xi_{${t + 1}} = ${colTeX(b)}$`).join('，')}。` });
      steps.push({ view: view(M, { pivots }), msg: `通解：$x = ${colTeX(sol.x0)} + ${sol.basis.map((b, t) => `k_{${t + 1}}${colTeX(b)}`).join(' + ')}$（$k_i$ 是任意常数）。` });
    }
    return { steps, rank: rankA, augRank, sol, M };
  }
  // 求逆、矩阵方程：左边化成 E 了没有
  const m = input.m;
  const square = input.A.length === n;
  const ok = square && rankA === n;
  if (!ok) {
    steps.push({ view: view(M, { pivots }), msg: `左边化不成单位矩阵：r(A) = ${rankA} < ${n}，A 不可逆${goal === 'matrixeq' ? '（方程可能无解，也可能有无穷多个解，要另外讨论）' : ''}。`, ask: { tag: 'invertible', kind: 'choice', q: 'A 可逆吗？', choices: ['可逆', '不可逆'], answer: '不可逆' } });
    return { steps, rank: rankA, M, X: null };
  }
  let X = M.map((r) => r.slice(n).map((x) => x.constValue()));
  if (goal === 'matrixeq' && input.side === 'right') X = X[0].map((_, j) => X.map((r) => r[j]));
  const XT = `\\begin{pmatrix}${X.map((r) => r.map((x) => x.toTeX()).join('&')).join('\\\\')}\\end{pmatrix}`;
  notes.push(`${goal === 'inverse' ? 'A⁻¹' : 'X'} 求出来了`);
  // 先问一个元素：挑第一个不是整数的（最容易算错），都是整数就挑第一个不是 0 的
  const flat = X.flatMap((r, i) => r.map((x, j) => ({ x, i, j })));
  const pick = flat.find((t) => !t.x.integer) || flat.find((t) => !t.x.zero) || flat[0];
  const what = goal === 'inverse' ? 'A⁻¹' : 'X';
  steps.push({
    view: view(M, { pivots, right: true }),
    msg: goal === 'inverse' ? `左边是 E 了，右边就是 $A^{-1} = ${XT}$。可以乘回去验算 $AA^{-1} = E$。` : input.side === 'right' ? `左边是 E 了，右边是 $X^{T}$，转置回来：$X = ${XT}$。` : `左边是 E 了，右边就是 $X = ${XT}$。`,
    ask: { tag: 'entry', kind: 'number', q: `${what} 第 ${pick.i + 1} 行第 ${pick.j + 1} 列是多少？（可以写分数）`, answer: pick.x.toNumber(), display: pick.x.toString() },
    asks: square ? [{ tag: 'invertible', kind: 'choice', q: 'A 可逆吗？', choices: ['可逆', '不可逆'], answer: '可逆' }] : undefined,
  });
  return { steps, rank: rankA, M, X, m };
}

const texName = (s) => String(s).replace(/^([A-Za-zα-ω]+)(\d+)$/, '$1_{$2}').replace(/α/g, '\\alpha ').replace(/β/g, '\\beta ').replace(/γ/g, '\\gamma ');
const varName = (input, j) => input.vars[j] || `x${j + 1}`;
const varTeX = (input, j) => (input.vars[j] ? texName(input.vars[j]) : `x_{${j + 1}}`);

function combos(n, k) {
  const out = [];
  const rec = (start, cur) => { if (cur.length === k) { out.push(cur.slice()); return; } for (let j = start; j < n; j++) { cur.push(j); rec(j + 1, cur); cur.pop(); } };
  rec(0, []);
  return out.slice(0, 200);
}

// —— 含参数：化成阶梯形以后，把主元（和最后一列）里含参数的式子等于 0 的值一个个拿出来讨论 ——
function paramCases(input, M, M0, steps, notes, view, v, conds) {
  const { n, goal, param } = input;
  const aug = !!input.B;
  const width = n + (aug ? 1 : 0);
  // 要讨论的式子：用过的含参数的主元、阶梯形里每一行的第一个非零数、增广列里左边全 0 的那几行
  const polys = [...conds];
  for (const row of M) {
    const l = lead(row, n);
    if (l >= 0 && !row[l].isConst) polys.push(row[l]);
    if (aug && l < 0 && !row[n].isConst) polys.push(row[n]);
    if (aug && l >= 0) { /* 主元那一列之后的不影响秩 */ }
  }
  const special = [];
  const irr = [];
  for (const p of polys) {
    const { roots, rest } = p.roots();
    for (const { root } of roots) if (!special.some((x) => x.cmp(root) === 0)) special.push(root);
    if (rest.deg >= 1) irr.push(rest);
  }
  special.sort((a, b) => a.cmp(b));
  const sv = special.map((x) => x.toString().replace(/^-/, '−'));
  const pivotsGeneric = M.map((row) => lead(row, n)).filter((l) => l >= 0).length;
  const augGeneric = aug ? M.filter((row) => !isZeroRow(row, width)).length : pivotsGeneric;
  steps.push({
    view: view(M, { pivots: M.map((row, i) => [i, lead(row, n)]).filter(([, l]) => l >= 0) }),
    msg: `阶梯形里含 ${param} 的主元${aug ? '和常数项' : ''}：${[...new Set(polys.map((p) => p.toFactorTeX(v)))].map((t) => `$${t}$`).join('、') || '（没有）'}。它们等于 0 时秩会变：${sv.length ? `要单独讨论 ${param} = ${sv.join('、')}` : '没有要单独讨论的值'}${irr.length ? `（还有 ${irr.map((p) => `$${p.toTeX(v)} = 0$`).join('、')} 的根不是有理数，这里不讨论）` : ''}。`,
    ask: sv.length ? { tag: 'special', kind: 'text', q: `${param} 取哪些值时要单独讨论？（从小到大，空格隔开）`, answer: sv.join(' ') } : undefined,
  });
  const cases = [];
  // 一般情况
  const generic = goal === 'solve' ? (augGeneric > pivotsGeneric ? 'none' : pivotsGeneric === n ? 'unique' : 'infinite') : null;
  const gname = sv.length ? `${param} ≠ ${sv.join(' 且 ' + param + ' ≠ ')}` : `${param} 取任意值`;
  cases.push({ label: gname, rankA: pivotsGeneric, rankAug: augGeneric, kind: generic });
  notes.push(`${gname}：r(A) = ${pivotsGeneric}${aug ? `，r(A | b) = ${augGeneric}` : ''}${generic ? `，${KIND_TEXT[generic]}` : ''}`);
  steps.push({ view: view(M), msg: `${gname} 时：主元都不是 0，r(A) = ${pivotsGeneric}${aug ? `，r(A | b) = ${augGeneric}` : ''}${generic ? `，${KIND_TEXT[generic]}` : ''}。`, ask: generic ? { tag: 'case', kind: 'choice', q: `${gname} 时，方程组的解是哪种情况？`, choices: ['无解', '唯一解', '无穷多解'], answer: KIND_TEXT[generic] } : { tag: 'case', kind: 'number', q: `${gname} 时，秩是多少？`, answer: pivotsGeneric } });
  // 特殊值：代回原来的矩阵重新化简
  for (const val of special) {
    const sub = M0.map((r) => r.map((p) => P(p.eval(val))));
    const { M: R2, pivots } = rrefQ(sub, n);
    const rA = pivots.length;
    const rAug = aug ? R2.filter((row) => !isZeroRow(row, width)).length : rA;
    let kind = null, sol = null;
    if (goal === 'solve') { sol = solution(R2, n, pivots); kind = sol.kind; }
    const label = `${param} = ${val.toString().replace(/^-/, '−')}`;
    cases.push({ label, rankA: rA, rankAug: rAug, kind, sol, value: val });
    let tail = '';
    if (kind === 'infinite') tail = `通解 $x = ${colTeX(sol.x0)} + ${sol.basis.map((b, t) => `k_{${t + 1}}${colTeX(b)}`).join(' + ')}$。`;
    if (kind === 'unique') tail = `解是 ${sol.x.map((x, j) => `$${varTeX(input, j)} = ${x.toTeX()}$`).join('，')}。`;
    notes.push(`${label}：r(A) = ${rA}${aug ? `，r(A | b) = ${rAug}` : ''}${kind ? `，${KIND_TEXT[kind]}` : ''}`);
    steps.push({
      view: { M: R2, notes: notes.slice(), sub: label, pivots },
      msg: `${label}：代回原来的${aug ? '增广' : ''}矩阵重新化简（上面是化好的行最简形）。r(A) = ${rA}${aug ? `，r(A | b) = ${rAug}` : ''}${kind ? `：${KIND_TEXT[kind]}。${tail}` : '。'}`,
      ask: kind ? { tag: 'case', kind: 'choice', q: `${label} 时，方程组的解是哪种情况？`, choices: ['无解', '唯一解', '无穷多解'], answer: KIND_TEXT[kind] } : { tag: 'case', kind: 'number', q: `${label} 时，秩是多少？`, answer: rA },
    });
  }
  return { steps, cases, special: sv, M };
}

// ================= 画 =================

export function view(s, input, opts = {}) {
  const tex = opts.tex || ((t) => esc(t));
  const v = input.param === 'λ' ? '\\lambda' : input.param;
  const n = input.n;
  const M = s.M;
  const cols = M[0].length;
  const aug = cols > n;
  const changed = new Set(s.changed || []);
  const piv = new Set((s.pivots || []).map(([i, j]) => `${i},${j}`));
  const hlCols = new Set(s.hlCols || []);
  let h = '';
  if (s.op) h += `<div class="el-op">${tex(s.op)}</div>`;
  if (s.sub) h += `<div class="el-op el-sub">${esc(s.sub)}</div>`;
  h += '<div class="el-mx"><table class="mx' + (aug ? ' mx-aug' : '') + '">';
  if (input.names) h += `<thead><tr>${input.names.map((nm, j) => `<th class="el-name${hlCols.has(j) ? ' hl-col' : ''}" data-pick="${esc(nm)}" data-label="${esc(nm)}" data-cmd="${j + 1}">${tex(texName(nm))}</th>`).join('')}</tr></thead>`;
  h += '<tbody>';
  M.forEach((row, i) => {
    const rc = changed.has(i) ? 'hl' : s.src === i ? 'hl-src' : '';
    h += `<tr class="${rc}">`;
    row.forEach((x, j) => {
      const cls = [j === n && aug ? 'aug' : '', piv.has(`${i},${j}`) ? 'pivot' : '', hlCols.has(j) ? 'hl-col' : '', changed.has(i) ? 'sv-new' : ''].filter(Boolean).join(' ');
      const t = x instanceof Q ? x.toTeX() : x.isConst ? x.constValue().toTeX() : x.toFactorTeX(v);
      h += `<td class="${cls}" data-i="${i}" data-j="${j}">${tex(t)}</td>`;
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  if (s.notes?.length) h += `<ul class="el-notes">${s.notes.map((t) => `<li>${opts.md ? opts.md(t, { inline: true }) : esc(t)}</li>`).join('')}</ul>`;
  return h;
}

// ================= 写结果、填表 =================

export function quiz(input, r) {
  if (input.param) return { q: `${input.param} 取哪些值时要单独讨论？（从小到大，空格隔开）`, type: 'seq', answer: r.special.join(' ') || '无' };
  if (input.goal === 'rank') return { q: '求这个矩阵的秩。', type: 'num', answer: String(r.rank) };
  if (input.goal === 'basis') return { q: `求向量组 ${input.names.join(', ')} 的秩。`, type: 'num', answer: String(r.rank) };
  if (input.goal === 'solve') return { q: '这个方程组：写「无解」「唯一解」或「无穷多解」。', type: 'seq', answer: KIND_TEXT[r.sol.kind] };
  return null;
}

export function table(input, r) {
  const num = (x) => ({ v: x.toString(), num: true });
  if (input.param) {
    return {
      q: `含参数 ${input.param}：每种情况写出 r(A)${input.B ? '、r(A | b) 和解的情况（无解 / 唯一解 / 无穷多解）' : ''}。`, qhtml: '', dir: 'row',
      head: ['r(A)', ...(input.B ? ['r(A | b)', '解的情况'] : [])],
      rows: r.cases.map((c) => ({ label: c.label, cells: [{ v: String(c.rankA), num: true }, ...(input.B ? [{ v: String(c.rankAug), num: true }, { v: [KIND_TEXT[c.kind], KIND_TEXT[c.kind].replace(/解$/, '')] }] : [])] })),
    };
  }
  if (input.goal === 'basis') {
    const pc = r.pivots;
    if (!r.reps.length) return { q: '求向量组的秩。', qhtml: '', dir: 'row', head: ['秩'], rows: [{ label: '', cells: [{ v: String(r.rank), num: true }] }] };
    return {
      q: `极大无关组取 ${pc.map((c) => input.names[c]).join('、')}，把其余的向量用它们表示：写出系数。`, qhtml: '', dir: 'row',
      head: pc.map((c) => input.names[c]), rows: r.reps.map((x) => ({ label: `${input.names[x.j]} =`, cells: x.coef.map(num) })),
      extra: [{ label: '秩', v: String(r.rank), num: true }],
    };
  }
  if (input.goal === 'solve') {
    const head = Array.from({ length: input.n }, (_, j) => varName(input, j));
    if (r.sol.kind === 'unique') return { q: '解这个方程组。', qhtml: '', dir: 'row', head, rows: [{ label: '解', cells: r.sol.x.map(num) }] };
    if (r.sol.kind === 'infinite') {
      const fv = r.sol.free.map((j) => varName(input, j));
      return { q: `写出通解：特解（自由未知数 ${fv.join('、')} 都取 0），和基础解系（${fv.join('、')} 依次取 ${r.sol.free.map((_, t) => `(${r.sol.free.map((__, u) => (u === t ? 1 : 0)).join(', ')})`).join('、')}）。`, qhtml: '', dir: 'row', head, rows: [{ label: '特解 η', cells: r.sol.x0.map(num) }, ...r.sol.basis.map((b, t) => ({ label: `ξ${t + 1}`, cells: b.map(num) }))], extra: [{ label: 'r(A)', v: String(r.rank), num: true }] };
    }
    return { q: '这个方程组无解：写出 r(A) 和 r(A | b)。', qhtml: '', dir: 'row', head: ['r(A)', 'r(A | b)'], rows: [{ label: '', cells: [{ v: String(r.rank), num: true }, { v: String(r.augRank), num: true }] }] };
  }
  if ((input.goal === 'inverse' || input.goal === 'matrixeq') && r.X) {
    return { q: input.goal === 'inverse' ? '写出 A⁻¹。' : '写出 X。', qhtml: '', dir: 'row', head: r.X[0].map((_, j) => `第 ${j + 1} 列`), rows: r.X.map((row, i) => ({ label: `第 ${i + 1} 行`, cells: row.map(num) })) };
  }
  if (input.goal === 'rank') return { q: '求秩。', qhtml: '', dir: 'row', head: ['秩'], rows: [{ label: 'r(A)', cells: [{ v: String(r.rank), num: true }] }] };
  return null;
}

export function problems(input) {
  const out = [];
  if (input.goal === 'basis' && input.names.length > input.A.length + 1) out.push(`向量有 ${input.names.length} 个、每个只有 ${input.A.length} 维：一定线性相关，矩阵很宽，一屏可能放不下`);
  return out;
}

export const elimEngine = { name: 'elim', title: '初等行变换', parse, run, view, quiz, table, problems };
