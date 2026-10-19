// 行列式（组件 det，线代）：D = 系数 × |当前的行列式|，一步一个变换，系数跟着记：
//   换两行（列）→ 变号；某行加另一行的倍数 → 不变；某行提出公因数 k → 系数乘 k；按某行（列）展开 → 降一阶。
// 自动做：化成上三角（尽量不出分数），最后主对角线相乘。老师也可以自己写 ops:（考研常用的「各列加到第一列」、
// 「提出公因数」、「按第一行展开」），页面照做、检查合不合法。精确分数；纯函数（tests/det-engine.test.js）。
import { Q } from '../exact.js';
import { esc } from './arrayview.js';

const ZERO = new Q(0n), ONE = new Q(1n);
const q = (x) => (x instanceof Q ? x : Q.from(Number(x)));

function parseMatrix(src) {
  const t = String(src ?? '').trim();
  let rows;
  try { rows = JSON.parse(t.replace(/(\d+)\s*\/\s*(\d+)/g, '"$1/$2"')); } catch { throw new Error('det 要写 matrix:（方阵，如 [[1, 2], [3, 4]]）'); }
  if (!Array.isArray(rows) || !rows.length || !rows.every(Array.isArray)) throw new Error('matrix: 写成 [[1, 2], [3, 4]]');
  const n = rows.length;
  if (n < 2 || n > 6) throw new Error('det 的矩阵是 2 到 6 阶');
  if (!rows.every((r) => r.length === n)) throw new Error('行列式要是方阵（每行的个数和行数一样）');
  return rows.map((r) => r.map((x) => {
    if (typeof x === 'string' && /^-?\d+\/\d+$/.test(x)) { const [a, b] = x.split('/'); return new Q(BigInt(a), BigInt(b)); }
    if (typeof x !== 'number') throw new Error(`matrix: 「${x}」不是数`);
    return q(x);
  }));
}

/**
 * ops：r1 <-> r2、c1 <-> c3；r2 - 2r1、c2 + c1；c1 + c2 + c3 + c4（几列加到一列上）；
 *      r1 / 10（第 1 行提出公因数 10）；2r1（第 1 行乘 2）；expand r1、expand c2（按这一行 / 列展开）
 */
export function parseOps(src, n) {
  return String(src ?? '').split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean).map((t) => {
    const s = t.replace(/\s+/g, ' ').replace(/−/g, '-').trim().toLowerCase();
    const idx = (k) => { const i = Number(k) - 1; if (!(i >= 0 && i < n)) throw new Error(`ops: 「${t}」里的 ${k} 超出了 ${n} 阶`); return i; };
    let m = /^expand\s*([rc])(\d+)$/.exec(s.replace(/\s+/g, ' '));
    if (m) return { kind: 'expand', dim: m[1], i: idx(m[2]) };
    const z = s.replace(/\s+/g, '');
    m = /^([rc])(\d+)(?:<->|↔)([rc])(\d+)$/.exec(z);
    if (m) { if (m[1] !== m[3]) throw new Error(`ops: 「${t}」行和列不能交换`); return { kind: 'swap', dim: m[1], i: idx(m[2]), j: idx(m[4]) }; }
    // 几列（行）加到一列（行）上：c1 + c2 + c3
    m = /^([rc])(\d+)((?:\+\1\d+){2,})$/.exec(z);
    if (m) return { kind: 'sum', dim: m[1], i: idx(m[2]), js: [...m[3].matchAll(/\d+/g)].map((x) => idx(x[0])) };
    m = /^([rc])(\d+)([+-])(\(?[\d/.]*\)?)\*?([rc])(\d+)$/.exec(z);
    if (m) {
      if (m[1] !== m[5]) throw new Error(`ops: 「${t}」行和列不能混着加`);
      if (m[2] === m[6]) throw new Error(`ops: 「${t}」一行不能加它自己的倍数`);
      const raw = m[4].replace(/[()]/g, '');
      let k = raw === '' ? ONE : raw.includes('/') ? new Q(BigInt(raw.split('/')[0]), BigInt(raw.split('/')[1])) : q(Number(raw));
      if (m[3] === '-') k = k.neg();
      return { kind: 'add', dim: m[1], i: idx(m[2]), j: idx(m[6]), k };
    }
    m = /^([rc])(\d+)\/\(?(-?[\d.]+(?:\/\d+)?)\)?$/.exec(z);
    if (m) {
      const d = m[3].includes('/') ? new Q(BigInt(m[3].split('/')[0]), BigInt(m[3].split('/')[1])) : q(Number(m[3]));
      if (d.zero) throw new Error(`ops: 「${t}」不能除以 0`);
      return { kind: 'scale', dim: m[1], i: idx(m[2]), k: ONE.div(d), pull: d };
    }
    m = /^\(?(-?[\d.]+(?:\/\d+)?)\)?\*?([rc])(\d+)$/.exec(z);
    if (m) {
      const k = m[1].includes('/') ? new Q(BigInt(m[1].split('/')[0]), BigInt(m[1].split('/')[1])) : q(Number(m[1]));
      if (k.zero) throw new Error(`ops: 「${t}」一行乘 0 不是初等变换`);
      return { kind: 'scale', dim: m[2], i: idx(m[3]), k };
    }
    throw new Error(`ops: 看不懂「${t}」，写成 r1 <-> r2、r2 - 2r1、c1 + c2 + c3、r1 / 10、expand r1`);
  });
}

export function parse(fields) {
  const A = parseMatrix(fields.matrix);
  const ops = fields.ops ? parseOps(fields.ops, A.length) : null;
  return { A, ops };
}

const T = (M) => M[0].map((_, j) => M.map((r) => r[j]));
// 列的操作 = 转置后的行操作
function apply(M, op) {
  if (op.dim === 'c') return T(apply(T(M), { ...op, dim: 'r' }));
  const A = M.map((r) => r.slice());
  if (op.kind === 'swap') [A[op.i], A[op.j]] = [A[op.j], A[op.i]];
  else if (op.kind === 'add') A[op.i] = A[op.i].map((x, c) => x.add(op.k.mul(A[op.j][c])));
  else if (op.kind === 'sum') A[op.i] = A[op.i].map((x, c) => op.js.reduce((s, j) => s.add(A[j][c]), x));
  else if (op.kind === 'scale') A[op.i] = A[op.i].map((x) => x.mul(op.k));
  return A;
}
const name = (dim, i) => `${dim === 'r' ? 'r' : 'c'}_{${i + 1}}`;
function opTeX(op) {
  if (op.kind === 'swap') return `${name(op.dim, op.i)} \\leftrightarrow ${name(op.dim, op.j)}`;
  if (op.kind === 'sum') return `${name(op.dim, op.i)} + ${op.js.map((j) => name(op.dim, j)).join(' + ')}`;
  if (op.kind === 'add') { const neg = op.k.n < 0n; const k = neg ? op.k.neg() : op.k; return `${name(op.dim, op.i)} ${neg ? '-' : '+'} ${k.n === 1n && k.d === 1n ? '' : k.d === 1n ? k.toTeX() : `\\left(${k.toTeX()}\\right)`}${name(op.dim, op.j)}`; }
  if (op.kind === 'scale') return op.pull ? `${name(op.dim, op.i)} \\div ${op.pull.toTeX()}` : `${op.k.toTeX()}\\,${name(op.dim, op.i)}`;
  return `\\text{按第 ${op.i + 1} ${op.dim === 'r' ? '行' : '列'}展开}`;
}
const WHAT = { r: '行', c: '列' };

// 自动：化成上三角。主元优先 ±1；会出分数时先把那一行乘一个数（系数跟着除）
function autoOps(M0) {
  const n = M0.length;
  let M = M0.map((r) => r.slice());
  const ops = [];
  const push = (op) => { M = apply(M, op); ops.push(op); };
  for (let c = 0; c < n; c++) {
    let best = -1, score = Infinity;
    for (let i = c; i < n; i++) {
      const x = M[i][c];
      if (x.zero) continue;
      const s = x.integer ? (x.n === 1n || x.n === -1n ? 0 : 1 + Math.min(999, Math.abs(Number(x.n))) / 1000) : 3;
      if (s < score) { score = s; best = i; }
    }
    if (best < 0) return { ops, M, zeroCol: c };
    if (best !== c) push({ kind: 'swap', dim: 'r', i: c, j: best });
    const p = M[c][c];
    for (let i = c + 1; i < n; i++) {
      const e = M[i][c];
      if (e.zero) continue;
      let k = e.div(p).neg();
      if (!k.integer && p.integer && e.integer) {
        // 会出分数：先把第 i 行乘上 |p| / gcd（行列式跟着变，系数记下来），再消
        const g = gcdBig(p.n, e.n);
        const m = new Q((p.n < 0n ? -p.n : p.n) / g);
        if (!(m.n === 1n)) push({ kind: 'scale', dim: 'r', i, k: m });
        k = M[i][c].div(p).neg();
      }
      push({ kind: 'add', dim: 'r', i, j: c, k });
    }
  }
  return { ops, M };
}
function gcdBig(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; }

// 行列式的值（直接算，给验算和按行展开时的余子式用）
export function detQ(M) {
  const n = M.length;
  const A = M.map((r) => r.slice());
  let d = ONE;
  for (let c = 0; c < n; c++) {
    let p = c;
    while (p < n && A[p][c].zero) p++;
    if (p === n) return ZERO;
    if (p !== c) { [A[c], A[p]] = [A[p], A[c]]; d = d.neg(); }
    d = d.mul(A[c][c]);
    for (let i = c + 1; i < n; i++) { const f = A[i][c].div(A[c][c]); A[i] = A[i].map((x, j) => x.sub(f.mul(A[c][j]))); }
  }
  return d;
}

const minor = (M, i, j) => M.filter((_, r) => r !== i).map((row) => row.filter((_, c) => c !== j));
const effectChoices = ['不变', '变号', '乘 k（这一行提出 k 的话 D = k·新的）'];

export function run(input) {
  const steps = [];
  let M = input.A.map((r) => r.slice());
  let coef = ONE;
  const n0 = M.length;
  const value = detQ(M);
  const view = (extra = {}) => ({ M: M.map((r) => r.slice()), coef, ...extra });
  steps.push({ view: view(), msg: `D 是 ${n0} 阶行列式。一步一个变换，左边的系数跟着记：换两行（列）变号，某行加另一行的倍数不变，某行提出公因数 k 时系数乘 k。` });
  let swaps = 0;
  const doOp = (op, why = '') => {
    if (op.kind === 'expand') return expand(op);
    const before = coef;
    M = apply(M, op);
    let eff;
    if (op.kind === 'swap') { coef = coef.neg(); swaps++; eff = '变号'; }
    else if (op.kind === 'scale') { coef = coef.div(op.k); eff = op.pull ? `提出公因数 ${op.pull.toString()}，系数乘 ${op.pull.toString()}` : `这一${WHAT[op.dim]}乘了 ${op.k.toString()}，系数要除以 ${op.k.toString()}`; }
    else eff = '不变';
    const ask = { tag: 'effect', kind: 'choice', q: `做 ${opText(op)}，行列式的值怎么变？`, choices: effectChoices, answer: op.kind === 'swap' ? '变号' : op.kind === 'scale' ? effectChoices[2] : '不变' };
    steps.push({ view: view({ op: opTeX(op), changed: op.dim === 'r' ? (op.kind === 'swap' ? [op.i, op.j] : [op.i]) : [], changedCols: op.dim === 'c' ? (op.kind === 'swap' ? [op.i, op.j] : [op.i]) : [], before }), msg: `${why}${eff === '不变' ? '某行（列）加上另一行（列）的倍数：行列式不变' : eff === '变号' ? `交换两${WHAT[op.dim]}：行列式变号` : eff}。`, ask });
  };
  const expand = (op) => {
    const n = M.length;
    const line = op.dim === 'r' ? M[op.i] : M.map((r) => r[op.i]);
    const nz = line.map((x, k) => ({ x, k })).filter((t) => !t.x.zero);
    if (nz.length === 1 && n > 1) {
      const { x, k } = nz[0];
      const [i, j] = op.dim === 'r' ? [op.i, k] : [k, op.i];
      const sign = (i + j) % 2 ? -1 : 1;
      const before = coef;
      coef = coef.mul(x).mul(new Q(BigInt(sign)));
      M = minor(M, i, j);
      steps.push({ view: view({ op: opTeX(op), before }), msg: `第 ${op.i + 1} ${WHAT[op.dim]}只有一个数不是 0（第 ${i + 1} 行第 ${j + 1} 列的 ${x.toString()}）：按它展开，D = ${x.toString()} × (−1)^{${i + 1}+${j + 1}} × 余子式，降成 ${n - 1} 阶。`, ask: { tag: 'sign', kind: 'choice', q: `按第 ${i + 1} 行第 ${j + 1} 列的元素展开，代数余子式前面的符号是？`, choices: ['+', '−'], answer: sign > 0 ? '+' : '−' } });
      return;
    }
    // 几个不是 0：写成几个余子式之和，每个直接算出来
    const parts = nz.map(({ x, k }) => { const [i, j] = op.dim === 'r' ? [op.i, k] : [k, op.i]; const s = (i + j) % 2 ? -1 : 1; return { x, i, j, s, m: detQ(minor(M, i, j)) }; });
    const total = parts.reduce((a, p) => a.add(p.x.mul(p.m).mul(new Q(BigInt(p.s)))), ZERO);
    const before = coef;
    coef = coef.mul(total);
    const terms = parts.map((p) => `${p.s < 0 ? '−' : '+'}${p.x.toString()}×${p.m.toString()}`).join(' ').replace(/^\+/, '');
    M = [[ONE]];
    steps.push({ view: view({ op: opTeX(op), before, done: true }), msg: `按第 ${op.i + 1} ${WHAT[op.dim]}展开：每个元素乘它的代数余子式（余子式直接算出来）：${terms} = ${total.toString()}。` });
  };
  if (input.ops) for (const op of input.ops) { if (M.length === 1) break; doOp(op); }
  // 还没化成上三角：自动接着化
  const upper = () => M.every((r, i) => r.slice(0, i).every((x) => x.zero));
  if (M.length > 1 && !upper()) {
    const auto = autoOps(M);
    for (const op of auto.ops) doOp(op, op.kind === 'swap' ? '换一行当主元（±1 最好算）：' : op.kind === 'scale' ? '先乘一下，免得出分数：' : '');
    if (auto.zeroCol !== undefined) {
      steps.push({ view: view({ zero: true }), msg: `第 ${auto.zeroCol + 1} 列从对角线往下全是 0：上三角的这个对角元是 0，D = 0。`, ask: { tag: 'value', kind: 'number', q: 'D 等于多少？', answer: 0 } });
      return { steps, value, swaps };
    }
  }
  if (M.length > 1) {
    const diag = M.map((r, i) => r[i]);
    const prod = diag.reduce((a, x) => a.mul(x), ONE);
    steps.push({ view: view({ diag: true }), msg: `上三角了：行列式 = 主对角线相乘 = ${diag.map((x) => x.toString()).join(' × ')} = ${prod.toString()}。所以 D = ${coef.toString()} × ${prod.toString()} = ${coef.mul(prod).toString()}。`, ask: { tag: 'value', kind: 'number', q: 'D 等于多少？', answer: Number(coef.mul(prod).toNumber()), display: coef.mul(prod).toString() } });
  } else {
    const v = coef.mul(M[0][0]);
    steps.push({ view: view({ diag: true }), msg: `D = ${v.toString()}。`, ask: { tag: 'value', kind: 'number', q: 'D 等于多少？', answer: v.toNumber(), display: v.toString() } });
  }
  return { steps, value, swaps };
}
function opText(op) {
  if (op.kind === 'swap') return `交换第 ${op.i + 1}、${op.j + 1} ${WHAT[op.dim]}`;
  if (op.kind === 'sum') return `把第 ${op.js.map((j) => j + 1).join('、')} ${WHAT[op.dim]}都加到第 ${op.i + 1} ${WHAT[op.dim]}`;
  if (op.kind === 'add') return `第 ${op.i + 1} ${WHAT[op.dim]}加上第 ${op.j + 1} ${WHAT[op.dim]}的 ${op.k.toString()} 倍`;
  if (op.kind === 'scale') return op.pull ? `第 ${op.i + 1} ${WHAT[op.dim]}提出公因数 ${op.pull.toString()}` : `第 ${op.i + 1} ${WHAT[op.dim]}乘 ${op.k.toString()}`;
  return '';
}

export function view(s, input, opts = {}) {
  const tex = opts.tex || ((t) => esc(t));
  const M = s.M;
  const ch = new Set(s.changed || []), chc = new Set(s.changedCols || []);
  const coefTeX = s.coef.n === 1n && s.coef.d === 1n ? '' : s.coef.n === -1n && s.coef.d === 1n ? '-' : s.coef.toTeX();
  let h = '';
  if (s.op) h += `<div class="el-op">${tex(s.op)}</div>`;
  h += `<div class="dt-row"><span class="dt-lhs">${tex(`D = ${coefTeX}`)}</span><table class="mx mx-det"><tbody>`;
  M.forEach((row, i) => {
    h += `<tr class="${ch.has(i) ? 'hl' : ''}">`;
    row.forEach((x, j) => { h += `<td class="${[chc.has(j) ? 'hl-cell' : '', s.diag && i === j ? 'pivot' : '', ch.has(i) || chc.has(j) ? 'sv-new' : ''].filter(Boolean).join(' ')}" data-cmd="${i * M.length + j + 1}">${tex(x.toTeX())}</td>`; });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  return h;
}

export function quiz(input, r) {
  return { q: '求这个行列式的值。', qhtml: '', type: 'num', answer: r.value.toString() };
}

// 填表：每一步之后 D = 系数 × |…| 的系数
export function table(input, r) {
  const rows = r.steps.filter((s) => s.view.op).map((s, k) => ({ label: `第 ${k + 1} 步`, cells: [{ v: s.view.coef.toString(), num: true }] }));
  if (!rows.length) return null;
  return { q: '每做一步，写出 D = 系数 × |新的行列式| 里的系数；最后写出 D。', qhtml: '', dir: 'col', head: ['系数'], rows, extra: [{ label: 'D', v: r.value.toString(), num: true }] };
}

// 常见错法：换行（列）忘了变号
export function variants(input) {
  return [{ label: '像是交换两行（列）时忘了变号', input: { ...input, noSign: true } }];
}

// 错法的输入：值按「换行不变号」算
const baseRun = run;
function runWithMistakes(input) {
  const r = baseRun(input);
  if (input.noSign && r.swaps % 2) r.value = r.value.neg();
  return r;
}

export const detEngine = { name: 'det', title: '行列式', parse, run: runWithMistakes, view, quiz, table, variants };
