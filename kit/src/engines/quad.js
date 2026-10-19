// 二次型（组件 quad，线代）：
//   写出二次型的矩阵（交叉项的系数要除以 2）；
//   配方法：含 x₁ 的项凑成一个完全平方，剩下的接着配；没有平方项、只有交叉项时先做 x₁ = y₁ + y₂、x₂ = y₁ − y₂；
//     最后写出标准形、可逆线性变换 x = Cy；
//   正交变换法：特征值就是标准形的系数（Q 由 eig 组件给）；三元的 f = 1 是什么曲面；
//   惯性指数、正定性（顺序主子式也算出来对照）。
// 精确分数；纯函数（tests/quad-engine.test.js）。
import { Q } from '../exact.js';
import { charPoly } from '../poly.js';
import { esc } from './arrayview.js';

const ZERO = new Q(0n), ONE = new Q(1n), TWO = new Q(2n);

// ================= 二次型的写法：x1^2 + 2x2^2 + 2x1x2 … 或 x^2 + y^2 + z^2 + 2xy =================

const VARS3 = ['x', 'y', 'z', 'w'];
function varIndex(name) {
  let m = /^x_?\{?(\d)\}?$/.exec(name);
  if (m) return Number(m[1]) - 1;
  const k = VARS3.indexOf(name);
  return k >= 0 ? k : -1;
}

/** f 的式子 → { n, A（对称矩阵，Q）, named（用 x y z 写的还是 x1 x2）} */
export function parseForm(src) {
  const s = String(src ?? '').replace(/\s+/g, '').replace(/−/g, '-').replace(/×|·/g, '*').replace(/²/g, '^2');
  if (!s) throw new Error('quad 要写 f:（二次型，如 x1^2 + 2x2^2 + 2x1x2）或 matrix:（对称矩阵）');
  let i = 0;
  const fail = (msg) => { throw new Error(`f: 看不懂「${src}」：${msg}`); };
  // 多项式：Map(键 = 各变量的次数, 系数)
  const key = (e) => e.join(',');
  const N = 4;
  const mono = (k, e) => new Map([[key(e), k]]);
  const addP = (a, b, sign = 1) => { const m = new Map(a); for (const [k, v] of b) { const x = (m.get(k) || ZERO).add(sign > 0 ? v : v.neg()); if (x.zero) m.delete(k); else m.set(k, x); } return m; };
  const mulP = (a, b) => { let m = new Map(); for (const [k1, v1] of a) for (const [k2, v2] of b) { const e = k1.split(',').map((x, t) => Number(x) + Number(k2.split(',')[t])); m = addP(m, mono(v1.mul(v2), e)); } return m; };
  let named = false;
  function primary() {
    if (s[i] === '(') { i++; const v = expr(); if (s[i] !== ')') fail('括号没有配对'); i++; return v; }
    let m = /^\d+(?:\.\d+)?(?:\/\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; const [a, b] = m[0].split('/'); return mono(b ? new Q(BigInt(a), BigInt(b)) : Q.from(Number(a)), [0, 0, 0, 0]); }
    m = /^(x_?\{?\d\}?|[xyzw])/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      const k = varIndex(m[0]);
      if (k < 0 || k >= N) fail(`变量 ${m[0]} 不认识（写 x1 x2 x3 x4，或 x y z）`);
      if (/^[xyzw]$/.test(m[0])) named = true;
      const e = [0, 0, 0, 0]; e[k] = 1;
      return mono(ONE, e);
    }
    return fail(`第 ${i + 1} 个字符这里少了一个数或变量`);
  }
  function power() {
    let v = primary();
    if (s[i] === '^') { i++; const m = /^\d/.exec(s.slice(i)); if (!m) fail('^ 后面写次数'); i++; let r = mono(ONE, [0, 0, 0, 0]); for (let t = 0; t < Number(m[0]); t++) r = mulP(r, v); v = r; }
    return v;
  }
  function unary() { if (s[i] === '-') { i++; return mulP(mono(ONE.neg(), [0, 0, 0, 0]), unary()); } if (s[i] === '+') { i++; return unary(); } return power(); }
  function term() {
    let v = unary();
    for (;;) {
      if (s[i] === '*') { i++; v = mulP(v, unary()); continue; }
      if (s[i] && /[(xyzw]/.test(s[i])) { v = mulP(v, power()); continue; }
      return v;
    }
  }
  function expr() { let v = term(); while (s[i] === '+' || s[i] === '-') { const op = s[i++]; v = addP(v, term(), op === '+' ? 1 : -1); } return v; }
  const poly = expr();
  if (i < s.length) fail(`多了「${s.slice(i)}」`);
  let n = 0;
  for (const k of poly.keys()) {
    const e = k.split(',').map(Number);
    if (e.reduce((a, b) => a + b, 0) !== 2) fail('二次型的每一项都要是二次的（没有一次项和常数项）');
    e.forEach((x, t) => { if (x) n = Math.max(n, t + 1); });
  }
  if (n < 2) fail('至少两个变量');
  const A = Array.from({ length: n }, () => Array(n).fill(ZERO));
  for (const [k, v] of poly) {
    const e = k.split(',').map(Number);
    const idx = e.flatMap((x, t) => Array(x).fill(t));
    const [a, b] = idx;
    if (a === b) A[a][a] = A[a][a].add(v);
    else { const h = v.div(TWO); A[a][b] = A[a][b].add(h); A[b][a] = A[b][a].add(h); }
  }
  return { n, A, named };
}

const vname = (input, k, letter = 'x') => (input.named && letter === 'x' ? VARS3[k] : `${letter}_{${k + 1}}`);

/** 二次型 → TeX（按 x1²、x1x2、… 的顺序） */
function formTeX(A, names, only = null) {
  const n = A.length;
  const terms = [];
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
    if (only && (!only.includes(i) || !only.includes(j))) continue;
    const c = i === j ? A[i][i] : A[i][j].mul(TWO);
    if (c.zero) continue;
    terms.push({ c, m: i === j ? `${names[i]}^{2}` : `${names[i]}${names[j]}` });
  }
  if (!terms.length) return '0';
  return terms.map(({ c, m }, t) => `${c.n < 0n ? '-' : t ? '+' : ''}${c.n === 1n && c.d === 1n || c.n === -1n && c.d === 1n ? '' : (c.n < 0n ? c.neg() : c).toTeX()}${m}`).join(' ');
}
const linTeX = (coef, names) => {
  const t = coef.map((c, k) => ({ c, k })).filter((x) => !x.c.zero);
  return t.map(({ c, k }, idx) => `${c.n < 0n ? '-' : idx ? '+' : ''}${c.n === 1n && c.d === 1n || c.n === -1n && c.d === 1n ? '' : (c.n < 0n ? c.neg() : c).toTeX()}${names[k]}`).join(' ') || '0';
};

// ================= 配方法 =================

function matMul(A, B) { return A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s.add(x.mul(B[k][j])), ZERO))); }
const Tr = (A) => A[0].map((_, j) => A.map((r) => r[j]));
function inverse(M) {
  const n = M.length;
  const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? ONE : ZERO))]);
  for (let c = 0; c < n; c++) {
    let p = c; while (p < n && A[p][c].zero) p++;
    if (p === n) throw new Error('变换矩阵不可逆');
    [A[c], A[p]] = [A[p], A[c]];
    const k = A[c][c]; A[c] = A[c].map((x) => x.div(k));
    for (let i = 0; i < n; i++) if (i !== c && !A[i][c].zero) { const f = A[i][c]; A[i] = A[i].map((x, j) => x.sub(f.mul(A[c][j]))); }
  }
  return A.map((r) => r.slice(n));
}
function det(M) {
  const n = M.length;
  if (!n) return ONE;
  const A = M.map((r) => r.slice());
  let d = ONE;
  for (let c = 0; c < n; c++) {
    let p = c; while (p < n && A[p][c].zero) p++;
    if (p === n) return ZERO;
    if (p !== c) { [A[c], A[p]] = [A[p], A[c]]; d = d.neg(); }
    d = d.mul(A[c][c]);
    for (let i = c + 1; i < n; i++) { const f = A[i][c].div(A[c][c]); A[i] = A[i].map((x, j) => x.sub(f.mul(A[c][j]))); }
  }
  return d;
}

/** 拉格朗日配方：返回每一步和最后的 d、C（x = C y） */
export function complete(A0) {
  const n = A0.length;
  let B = A0.map((r) => r.slice()); // 当前变量 u 下的矩阵
  let T = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? ONE : ZERO))); // x = T u
  const done = [];
  const squares = []; // { d, l（u 坐标下的系数）, at（这一步的变量名标记）}
  const log = [];
  let letter = 'x';
  let guard = 0;
  while (guard++ < 20) {
    const left = Array.from({ length: n }, (_, i) => i).filter((i) => !done.includes(i));
    const i = left.find((k) => !B[k][k].zero);
    if (i !== undefined) {
      const d = B[i][i];
      const l = Array.from({ length: n }, (_, j) => (done.includes(j) ? ZERO : B[i][j].div(d)));
      squares.push({ d, l, letter, i });
      // B ← B − d·l·lᵀ
      B = B.map((r, a) => r.map((x, b) => x.sub(d.mul(l[a]).mul(l[b]))));
      done.push(i);
      log.push({ kind: 'square', d, l, i, letter, rest: B.map((r) => r.slice()), left: left.filter((k) => k !== i) });
      continue;
    }
    // 没有平方项：找一对交叉项 u_i u_j，令 u_i = v_i + v_j，u_j = v_i − v_j
    let pair = null;
    for (const a of left) for (const b of left) if (a < b && !B[a][b].zero && !pair) pair = [a, b];
    if (!pair) break;
    const [a, b] = pair;
    const S = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r === c ? ONE : ZERO)));
    S[a][b] = ONE; S[b][a] = ONE; S[b][b] = ONE.neg();
    B = matMul(matMul(Tr(S), B), S);
    T = matMul(T, S);
    const from = letter;
    letter = letter === 'x' ? 'y' : letter === 'y' ? 'z' : 'w';
    log.push({ kind: 'subst', a, b, from, to: letter, B: B.map((r) => r.slice()) });
    // 已经配好的平方项不受影响（它们只含已完成的变量……这里只在开头没有平方项时发生，done 一般是空的）
  }
  // 补上没配到的变量（系数 0），凑成可逆的 L：z = L u
  const L = [];
  const d = [];
  for (const sq of squares) { L.push(sq.l); d.push(sq.d); }
  for (let k = 0; k < n; k++) if (!done.includes(k)) { L.push(Array.from({ length: n }, (_, j) => (j === k ? ONE : ZERO))); d.push(ZERO); }
  const C = matMul(T, inverse(L)); // x = T u，u = L⁻¹ z
  return { squares, d, C, log, finalLetter: letter };
}

// ================= 解析、跑 =================

export function parse(fields) {
  let A, n, named = false;
  if (fields.f !== undefined) ({ A, n, named } = parseForm(fields.f));
  else if (fields.matrix !== undefined) {
    let rows;
    try { rows = JSON.parse(String(fields.matrix).replace(/(-?\d+)\s*\/\s*(\d+)/g, '"$1/$2"')); } catch { throw new Error('matrix: 写成 [[1, 1], [1, 2]]'); }
    A = rows.map((r) => r.map((x) => (typeof x === 'string' ? new Q(BigInt(x.split('/')[0]), BigInt(x.split('/')[1])) : Q.from(x))));
    n = A.length;
    if (!A.every((r, i) => r.length === n && r.every((x, j) => x.cmp(A[j][i]) === 0))) throw new Error('二次型的矩阵要是对称矩阵');
  } else throw new Error('quad 要写 f:（二次型的式子）或 matrix:（对称矩阵）');
  if (n > 4) throw new Error('二次型最多 4 个变量');
  const method = String(fields.method || 'complete').trim().toLowerCase();
  if (!['complete', 'orth', '配方', '正交'].includes(method)) throw new Error('method: 写 complete（配方法，默认）或 orth（正交变换法）');
  return { A, n, named, method: /^(orth|正交)$/.test(method) ? 'orth' : 'complete', halfMistake: false };
}

const DEF = ['正定', '半正定', '负定', '半负定', '不定'];
function definiteness(p, q, n) { return p === n ? '正定' : q === n ? '负定' : q === 0 ? '半正定' : p === 0 ? '半负定' : '不定'; }
function surfaceOf(signs, n) {
  const pos = signs.filter((x) => x > 0).length, neg = signs.filter((x) => x < 0).length;
  if (n === 2) return pos === 2 ? '椭圆' : pos === 1 && neg === 1 ? '双曲线' : pos === 1 ? '两条平行直线' : '不是曲线（没有实点）';
  if (n !== 3) return '';
  if (pos === 3) return '椭球面';
  if (pos === 2 && neg === 1) return '单叶双曲面';
  if (pos === 1 && neg === 2) return '双叶双曲面';
  if (pos === 2 && neg === 0) return '椭圆柱面';
  if (pos === 1 && neg === 1) return '双曲柱面';
  if (pos === 1) return '两个平行平面';
  return '不是曲面（没有实点）';
}

export function run(input) {
  const A = input.halfMistake ? input.A.map((r, i) => r.map((x, j) => (i === j ? x : x.mul(TWO)))) : input.A;
  const n = input.n;
  const steps = [];
  const notes = [];
  const names = Array.from({ length: n }, (_, k) => vname(input, k));
  const view = (extra = {}) => ({ notes: notes.slice(), ...extra });
  const AT = A.map((r) => r.map((x) => x.toTeX()));
  // 矩阵：问第一个不是 0 的交叉项
  let cross = null;
  for (let i = 0; i < n && !cross; i++) for (let j = i + 1; j < n && !cross; j++) if (!A[i][j].zero) cross = [i, j];
  steps.push({ view: view({ lines: [`f = ${formTeX(input.A, names)}`] }), msg: '二次型 f = xᵀAx：A 是对称矩阵，主对角线上是平方项的系数，交叉项 xᵢxⱼ 的系数要平分给 aᵢⱼ 和 aⱼᵢ（各一半）。' });
  steps.push({
    view: view({ lines: [`f = ${formTeX(input.A, names)}`], mx: AT, label: 'A' }),
    msg: cross ? `${names[cross[0]]}${names[cross[1]]} 的系数是 ${A[cross[0]][cross[1]].mul(TWO).toString()}，所以 a${cross[0] + 1}${cross[1] + 1} = a${cross[1] + 1}${cross[0] + 1} = ${A[cross[0]][cross[1]].toString()}。` : '没有交叉项：A 是对角矩阵。',
    ask: cross ? { tag: 'matrix', kind: 'number', q: `二次型的矩阵里 a${cross[0] + 1}${cross[1] + 1} 是多少？`, answer: A[cross[0]][cross[1]].toNumber(), display: A[cross[0]][cross[1]].toString() } : undefined,
  });
  notes.push('A 写出来了');
  let d, signs;
  let finalLines = [];
  if (input.method === 'complete') {
    const c = complete(A);
    d = c.d;
    const shown = [];
    let curNames = names;
    for (const st of c.log) {
      if (st.kind === 'subst') {
        const yn = Array.from({ length: n }, (_, k) => `${st.to}_{${k + 1}}`);
        const xn = Array.from({ length: n }, (_, k) => `${st.from}_{${k + 1}}`);
        const sub = Array.from({ length: n }, (_, k) => (k === st.a ? `${xn[k]} = ${yn[st.a]} + ${yn[st.b]}` : k === st.b ? `${xn[k]} = ${yn[st.a]} - ${yn[st.b]}` : `${xn[k]} = ${yn[k]}`));
        curNames = yn;
        shown.push(`\\text{令 } ${sub.join(',\\ ')}`, `f = ${formTeX(st.B, yn)}`);
        steps.push({ view: view({ lines: shown.slice() }), msg: '没有平方项（只有交叉项），配不了方：先做一个可逆变换，把交叉项变出平方项来。' });
        continue;
      }
      const lin = linTeX(st.l, curNames);
      const restTeX = formTeX(st.rest, curNames, st.left);
      const k = shown.filter((x) => x.startsWith('f =')).length;
      shown.push(`f = ${st.d.n === 1n && st.d.d === 1n ? '' : st.d.toTeX()}\\left(${lin}\\right)^{2} ${restTeX === '0' ? '' : `+ ${restTeX}`}`.replace(/\+ -/g, '- '));
      steps.push({ view: view({ lines: shown.slice() }), msg: `把含 ${curNames[st.i]} 的项凑成完全平方：${st.d.toString() === '1' ? '' : `提出 ${st.d.toString()}，`}剩下的${st.left.length ? `只含 ${st.left.map((t) => curNames[t]).join('、')}，接着配` : '没有了'}。`, ask: { tag: 'square', kind: 'number', q: `配方以后第 ${squaresSoFar(c.log, st)} 个平方项前面的系数是多少？`, answer: st.d.toNumber(), display: st.d.toString() } });
      void k;
    }
    const ys = Array.from({ length: n }, (_, k) => `y_{${k + 1}}`);
    const std = d.map((x, k) => ({ x, k })).filter((t) => !t.x.zero).map(({ x, k }, idx) => `${x.n < 0n ? '-' : idx ? '+' : ''}${x.n === 1n && x.d === 1n || x.n === -1n && x.d === 1n ? '' : (x.n < 0n ? x.neg() : x).toTeX()}${ys[k]}^{2}`).join(' ') || '0';
    const CT = c.C.map((r) => r.map((x) => x.toTeX()));
    notes.push(`标准形 $f = ${std}$`);
    finalLines = [...shown, `\\text{令括号里的分别是 } y_1, y_2, \\dots \\text{，标准形 } f = ${std}`];
    steps.push({ view: view({ lines: finalLines, mx: CT, label: 'x = Cy,\\ C' }), msg: `可逆线性变换 x = Cy（C 的行列式是 ${det(c.C).toString()}，不是 0），标准形 f = $${std}$。标准形不唯一（换一种配法系数会变），但正、负系数的个数不变（惯性定理）。` });
    signs = d.map((x) => (x.zero ? 0 : x.n > 0n ? 1 : -1));
  } else {
    const f = charPoly(A);
    const { roots, rest } = f.roots();
    if (rest.deg >= 1) throw new Error('特征值不全是有理数，正交变换法这里演示不了（用配方法：method: complete）');
    const vals = roots.flatMap(({ root, mult }) => Array(mult).fill(root));
    d = vals;
    const std = vals.map((x, k) => `${x.n < 0n ? '-' : k ? '+' : ''}${x.n === 1n && x.d === 1n || x.n === -1n && x.d === 1n ? '' : (x.n < 0n ? x.neg() : x).toTeX()}y_{${k + 1}}^{2}`).join(' ');
    notes.push(`特征值 ${vals.map(String).join(', ')}`);
    steps.push({ view: view({ lines: [`|\\lambda E - A| = ${f.toFactorTeX()}`] }), msg: `正交变换 x = Qy 把 f 化成 λ₁y₁² + λ₂y₂² + …，系数就是 A 的特征值：${vals.map(String).join('、')}。（Q 是把 A 正交相似对角化的那个正交矩阵，用 eig 组件求。）`, ask: { tag: 'values', kind: 'text', q: '标准形的系数（A 的特征值）是哪几个？（从小到大，空格隔开）', answer: vals.map(String).join(' ') } });
    finalLines = [`|\\lambda E - A| = ${f.toFactorTeX()}`, `f = ${std}`];
    steps.push({ view: view({ lines: finalLines }), msg: `标准形 f = $${std}$。正交变换只是转了坐标轴，图形的形状不变。` });
    signs = vals.map((x) => (x.zero ? 0 : x.n > 0n ? 1 : -1));
    if (n === 2 || n === 3) {
      const shape = surfaceOf(signs, n);
      const choices = n === 3 ? ['椭球面', '单叶双曲面', '双叶双曲面', '椭圆柱面', '双曲柱面'] : ['椭圆', '双曲线', '两条平行直线'];
      steps.push({ view: view({ lines: [`f = ${std} = 1`] }), msg: `f = 1 是${shape}。`, ask: choices.includes(shape) ? { tag: 'surface', kind: 'choice', q: `f = 1 是什么${n === 3 ? '曲面' : '曲线'}？`, choices, answer: shape } : undefined });
    }
  }
  const p = signs.filter((x) => x > 0).length, q = signs.filter((x) => x < 0).length;
  const kind = definiteness(p, q, n);
  // 顺序主子式（对照正定的判定）
  const minors = Array.from({ length: n }, (_, k) => det(A.slice(0, k + 1).map((r) => r.slice(0, k + 1))));
  notes.push(`正惯性指数 ${p}，负惯性指数 ${q}，${kind}`);
  steps.push({ view: view({ lines: [...finalLines, `\\Delta_1, \\dots, \\Delta_${n} = ${minors.map((x) => x.toTeX()).join(',\\ ')}`] }), msg: `标准形里正的系数 ${p} 个、负的 ${q} 个：正惯性指数 ${p}，负惯性指数 ${q}，秩 ${p + q}。${kind}${kind === '正定' ? '（顺序主子式都大于 0，对得上）' : minors.every((x) => x.n > 0n) ? '' : '（顺序主子式不全大于 0，所以不是正定）'}。`, ask: { tag: 'definite', kind: 'choice', q: '这个二次型是？', choices: DEF, answer: kind } });
  return { steps, d, p, q, kind, minors, A };
}
function squaresSoFar(log, st) { return log.filter((x) => x.kind === 'square').indexOf(st) + 1; }

export function view(s, input, opts = {}) {
  const tex = opts.tex || ((t) => esc(t));
  let h = '';
  if (s.lines) h += s.lines.map((l) => `<div class="eg-line">${tex(l)}</div>`).join('');
  if (s.mx) h += `<div class="eg-row"><span class="eg-lbl">${tex(`${s.label} =`)}</span><table class="mx"><tbody>${s.mx.map((r) => `<tr>${r.map((x) => `<td>${tex(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  if (s.notes?.length) h += `<ul class="el-notes">${s.notes.map((t) => `<li>${opts.md ? opts.md(t, { inline: true }) : esc(t)}</li>`).join('')}</ul>`;
  return h;
}

export function quiz(input, r) {
  return { q: '这个二次型的正惯性指数、负惯性指数各是多少？（空格隔开）', qhtml: '', type: 'seq', answer: `${r.p} ${r.q}` };
}

export function table(input, r) {
  const n = input.n;
  return {
    q: input.method === 'orth' ? '写出二次型的矩阵；正交变换后标准形的系数（特征值，从小到大）；惯性指数和正定性。' : '写出二次型的矩阵；按 x₁、x₂、… 的顺序配方，写出标准形的系数；惯性指数和正定性。',
    qhtml: '', dir: 'row',
    head: Array.from({ length: n }, (_, j) => `第 ${j + 1} 列`),
    rows: [...r.A.map((row, i) => ({ label: `A 的第 ${i + 1} 行`, cells: row.map((x) => ({ v: x.toString(), num: true })) })), { label: '标准形的系数', cells: r.d.map((x) => ({ v: x.toString(), num: true })) }],
    extra: [{ label: '正惯性指数', v: String(r.p), num: true }, { label: '负惯性指数', v: String(r.q), num: true }, { label: '正定 / 半正定 / 负定 / 半负定 / 不定', v: r.kind }],
  };
}

// 常见错法：交叉项的系数没除以 2
export function variants(input) {
  return [{ label: '像是交叉项的系数没有除以 2（aᵢⱼ 应该是 xᵢxⱼ 系数的一半）', input: { ...input, halfMistake: true } }];
}

export const quadEngine = { name: 'quad', title: '二次型', parse, run, view, quiz, table, variants };
