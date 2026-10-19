// 特征值和相似对角化（组件 eig，线代）；施密特正交化（组件 schmidt）。
//   eig：|λE − A| = 0 求特征值（有理根精确，分解写出来）→ 每个 λ 解 (λE − A)x = 0 得特征向量 →
//        几何重数和代数重数比 → 能不能对角化、P 和 Λ；实对称矩阵再把同一个特征值的特征向量施密特正交化、单位化，得正交矩阵 Q。
//   schmidt：给几个向量，一步步减去投影，再单位化。
// 单位化要开方：向量写成「整数向量 ÷ √k」精确地写，不用小数。纯函数（tests/eig-engine.test.js）。
import { Q } from '../exact.js';
import { Poly, P, charPoly } from '../poly.js';
import { rrefQ, solution } from './elim.js';
import { esc } from './arrayview.js';

const ZERO = new Q(0n), ONE = new Q(1n);
const qOf = (x) => (x instanceof Q ? x : Q.from(Number(x)));

function parseRows(src, what) {
  let rows;
  try { rows = JSON.parse(String(src ?? '').trim().replace(/(-?\d+)\s*\/\s*(\d+)/g, '"$1/$2"')); } catch { throw new Error(`${what} 写成 [[1, 2], [3, 4]]`); }
  if (!Array.isArray(rows) || !rows.length) throw new Error(`${what} 写成 [[1, 2], [3, 4]]`);
  return rows.map((r) => (Array.isArray(r) ? r : [r]).map((x) => {
    if (typeof x === 'string' && /^-?\d+\/\d+$/.test(x)) { const [a, b] = x.split('/'); return new Q(BigInt(a), BigInt(b)); }
    if (typeof x !== 'number') throw new Error(`${what}「${x}」不是数`);
    return qOf(x);
  }));
}

// —— 向量的小工具 ——
const dot = (a, b) => a.reduce((s, x, i) => s.add(x.mul(b[i])), ZERO);
const sub = (a, b) => a.map((x, i) => x.sub(b[i]));
const scale = (k, a) => a.map((x) => x.mul(k));
function gcdBig(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; }
/** 乘一个正数，变成最简的整数向量（方向不变；第一个非零分量是负的就整体变号，课本一般这么写） */
export function primitive(v) {
  const L = v.reduce((m, x) => m / gcdBig(m, x.d) * x.d, 1n);
  let w = v.map((x) => x.n * (L / x.d));
  const g = w.reduce((m, x) => gcdBig(m, x), 0n) || 1n;
  w = w.map((x) => x / g);
  return w.map((x) => new Q(x));
}
// √k 化简：k = m²·r → m√r
function surd(k) {
  let m = 1n, r = k;
  for (let p = 2n; p * p <= r; p++) while (r % (p * p) === 0n) { r /= p * p; m *= p; }
  return { m, r };
}
/** 单位化：v → { w（整数向量）, k（|w|²）}，单位向量 = w / √k */
export function unit(v) {
  const w = primitive(v);
  const k = dot(w, w);
  return { w, k: k.n };
}
const entryTeX = (x, k) => {
  // x / √k，x 是整数
  if (x.zero) return '0';
  const { m, r } = surd(k);
  const neg = x.n < 0n;
  let num = neg ? -x.n : x.n;
  let den = m;
  const g = gcdBig(num, den) || 1n;
  num /= g; den /= g;
  const sign = neg ? '-' : '';
  if (r === 1n) return den === 1n ? `${sign}${num}` : `${sign}\\frac{${num}}{${den}}`;
  return `${sign}\\frac{${num}}{${den === 1n ? '' : den}\\sqrt{${r}}}`;
};
export const unitTeX = ({ w, k }) => `\\begin{pmatrix}${w.map((x) => entryTeX(x, k)).join('\\\\')}\\end{pmatrix}`;
const colTeX = (v) => `\\begin{pmatrix}${v.map((x) => x.toTeX()).join('\\\\')}\\end{pmatrix}`;
const matTeX = (rows) => `\\begin{pmatrix}${rows.map((r) => r.join('&')).join('\\\\')}\\end{pmatrix}`;

/** 施密特正交化：β1 = α1，βk = αk − Σ (αk, βi)/(βi, βi) βi（每一步记下内积），返回每一步 */
// mistake（错法，给 variants 用）：useAlpha 往前面的 α 上投影（应该是 β）；noDenom 投影系数忘了除以 (β, β)
export function schmidt(vs, { mistake = '' } = {}) {
  const betas = [];
  const log = [];
  for (const [k, a] of vs.entries()) {
    let b = a.slice();
    const terms = [];
    for (const [i, p0] of betas.entries()) {
      const p = mistake === 'useAlpha' ? vs[i] : p0;
      const num = dot(a, p), den = mistake === 'noDenom' ? ONE : dot(p, p);
      terms.push({ num, den, p });
      if (!num.zero) b = sub(b, scale(num.div(den), p));
    }
    if (mistake && k > 0 && b.every((x) => x.zero)) { betas.push(b); log.push({ a, b, terms }); continue; }
    if (b.every((x) => x.zero)) throw new Error('这几个向量线性相关，施密特正交化做不下去（有一个减完是零向量）');
    betas.push(b);
    log.push({ a, b, terms });
  }
  return { betas, log };
}

// 重数的多重集合的所有排列（答案按什么顺序写都算对）
function perms(list) {
  const out = new Set();
  const rec = (rest, cur) => { if (!rest.length) { out.add(cur.join(' ')); return; } rest.forEach((x, i) => rec([...rest.slice(0, i), ...rest.slice(i + 1)], [...cur, x])); };
  rec(list, []);
  return [...out].slice(0, 120);
}

// ================= eig =================

export function parse(fields) {
  const A = parseRows(fields.matrix, 'matrix:');
  const n = A.length;
  if (n < 2 || n > 4) throw new Error('eig 的矩阵是 2 到 4 阶');
  if (!A.every((r) => r.length === n)) throw new Error('eig 要方阵');
  const symmetric = A.every((r, i) => r.every((x, j) => x.cmp(A[j][i]) === 0));
  const goal = String(fields.goal || (symmetric ? 'orth' : 'diag')).trim().toLowerCase();
  if (!['eig', 'diag', 'orth'].includes(goal)) throw new Error('goal: 写 eig（只求特征值和特征向量）、diag（相似对角化）或 orth（实对称矩阵正交相似对角化）');
  if (goal === 'orth' && !symmetric) throw new Error('goal: orth 要实对称矩阵（A 的转置等于 A）');
  return { A, n, symmetric, goal };
}

export function run(input) {
  const { A, n, goal } = input;
  const steps = [];
  const notes = [];
  const f = charPoly(A);
  const { roots, rest } = f.roots();
  const view = (extra = {}) => ({ notes: notes.slice(), ...extra });
  const lamE = A.map((r, i) => r.map((a, j) => (i === j ? `\\lambda ${a.n < 0n ? '+' : '-'} ${(a.n < 0n ? a.neg() : a).toTeX()}`.replace(/\\lambda - 0$/, '\\lambda') : a.neg().toTeX())));
  steps.push({ view: view({ mx: A.map((r) => r.map((x) => x.toTeX())), label: 'A' }), msg: '求特征值：解特征方程 |λE − A| = 0。' });
  const ftex = f.toFactorTeX();
  notes.push(`$|\\lambda E - A| = ${ftex}$`);
  // 错法 diagValues：把主对角线上的数当成特征值（三角矩阵才对）——只影响「特征值是哪几个」的答案
  const values = input.mistake === 'diagValues' ? A.map((r, i) => r[i].toString()) : roots.flatMap(({ root, mult }) => Array(mult).fill(root.toString()));
  steps.push({
    view: view({ mx: lamE, label: '\\lambda E - A', poly: `|\\lambda E - A| = ${f.toTeX()} = ${ftex}` }),
    msg: rest.deg >= 1 ? `|λE − A| = $${ftex}$：还有 $${rest.toTeX()} = 0$ 的根不是有理数，这里只往下讲有理的特征值。` : `|λE − A| = $${ftex}$，特征值是 ${roots.map(({ root, mult }) => `λ = ${root.toString()}${mult > 1 ? `（${mult} 重）` : ''}`).join('，')}。`,
    ask: rest.deg >= 1 ? undefined : { tag: 'values', kind: 'text', q: '特征值是哪几个？（重根写几遍，空格隔开）', answer: perms(values).join(' | '), display: values.join(' ') },
  });
  if (rest.deg >= 1) return { steps, f, roots, values, diagonalizable: null };
  // 每个特征值：(λE − A)x = 0 的基础解系
  const spaces = [];
  for (const { root, mult } of roots) {
    const M = A.map((r, i) => r.map((a, j) => P((i === j ? root : ZERO).sub(a))));
    const { M: R, pivots } = rrefQ(M.map((r) => [...r, P(0)]), n);
    const sol = solution(R, n, pivots);
    const basis = sol.kind === 'infinite' ? sol.basis.map(primitive) : [];
    // 错法 geoRank：把 λE − A 的秩当成了线性无关的特征向量的个数（应该是 n − 秩）
    const geo = input.mistake === 'geoRank' ? n - basis.length : basis.length;
    spaces.push({ root, mult, basis, geo });
    notes.push(`λ = ${root.toString()}：${geo} 个线性无关的特征向量${geo < mult ? `（比重数 ${mult} 少）` : ''}`);
    steps.push({
      view: view({ mx: R.map((r) => r.slice(0, n).map((x) => x.constValue().toTeX())), label: `${root.toTeX()}E - A \\to`, vecs: basis.map(colTeX) }),
      msg: `λ = ${root.toString()}：解 (${root.toString()}E − A)x = 0，化成行最简形，秩是 ${n - geo}，基础解系有 ${n} − ${n - geo} = ${geo} 个向量：${basis.map((b, t) => `$\\xi = ${colTeX(b)}$`).join('，')}。${mult > 1 ? `λ = ${root.toString()} 是 ${mult} 重根，${geo === mult ? '线性无关的特征向量正好也是 ' + mult + ' 个' : `却只有 ${geo} 个线性无关的特征向量`}。` : ''}`,
      ask: { tag: 'geo', kind: 'number', q: `λ = ${root.toString()} 对应的线性无关的特征向量有几个？`, answer: geo },
    });
  }
  // 错法 repeatNo：以为有重根就不能对角化（要看几何重数是不是等于代数重数）
  const diagonalizable = input.mistake === 'repeatNo' ? roots.every((x) => x.mult === 1) : spaces.every((s) => s.geo === s.mult);
  if (goal === 'eig') return { steps, f, roots, values, spaces, diagonalizable };
  steps.push({
    view: view(),
    msg: diagonalizable ? `每个特征值的线性无关的特征向量个数都等于它的重数（一共 ${n} 个）：A 能相似对角化。` : `有特征值的线性无关的特征向量比重数少，凑不齐 ${n} 个线性无关的特征向量：A 不能相似对角化。`,
    ask: { tag: 'diag', kind: 'choice', q: 'A 能相似对角化吗？', choices: ['能', '不能'], answer: diagonalizable ? '能' : '不能' },
  });
  if (!diagonalizable) return { steps, f, roots, values, spaces, diagonalizable };
  const cols = spaces.flatMap((s) => s.basis.map((b) => ({ b, root: s.root })));
  const Pm = Array.from({ length: n }, (_, i) => cols.map((c) => c.b[i].toTeX()));
  const lam = cols.map((c) => c.root.toTeX());
  notes.push('P、Λ 写出来了');
  steps.push({ view: view({ mx: Pm, label: 'P', lam }), msg: `把特征向量按列排成 P，Λ 的对角线上按同样的顺序写对应的特征值：$P^{-1}AP = \\Lambda = \\mathrm{diag}(${lam.join(', ')})$。P 的列换了顺序，Λ 的对角元也要跟着换。` });
  if (goal !== 'orth') return { steps, f, roots, values, spaces, diagonalizable, P: cols };
  // 实对称：不同特征值的特征向量已经正交；同一个特征值的要施密特正交化
  const qcols = [];
  for (const s of spaces) {
    if (s.basis.length > 1) {
      const { betas, log } = schmidt(s.basis);
      const lines = log.map((x, t) => (t === 0 ? `\\beta_1 = \\xi_1 = ${colTeX(x.b)}` : `\\beta_{${t + 1}} = \\xi_{${t + 1}} ${x.terms.map((u) => `- \\frac{${u.num.toTeX()}}{${u.den.toTeX()}}\\beta_{${x.terms.indexOf(u) + 1}}`).join(' ')} = ${colTeX(x.b)}`));
      steps.push({ view: view({ lines }), msg: `λ = ${s.root.toString()} 有 ${s.basis.length} 个特征向量，它们不一定正交：施密特正交化。`, ask: { tag: 'schmidt', kind: 'choice', q: '不同特征值的特征向量要不要再正交化？', choices: ['不用：实对称矩阵不同特征值的特征向量已经正交', '要，全部一起正交化'], answer: '不用：实对称矩阵不同特征值的特征向量已经正交' } });
      betas.forEach((b) => qcols.push({ u: unit(b), root: s.root }));
    } else s.basis.forEach((b) => qcols.push({ u: unit(b), root: s.root }));
  }
  const Qm = Array.from({ length: n }, (_, i) => qcols.map((c) => entryTeX(c.u.w[i], c.u.k)));
  const qlam = qcols.map((c) => c.root.toTeX());
  steps.push({ view: view({ mx: Qm, label: 'Q', lam: qlam }), msg: `每个向量除以它的长度（单位化），按列排成正交矩阵 Q：$Q^{T}AQ = Q^{-1}AQ = \\mathrm{diag}(${qlam.join(', ')})$。验算：Q 的列两两正交、长度都是 1，所以 $Q^{T}Q = E$。` });
  return { steps, f, roots, values, spaces, diagonalizable, Q: qcols };
}

export function view(s, input, opts = {}) {
  const tex = opts.tex || ((t) => esc(t));
  let h = '';
  if (s.mx) h += `<div class="eg-row">${s.label ? `<span class="eg-lbl">${tex(`${s.label} =`)}</span>` : ''}<table class="mx"><tbody>${s.mx.map((r, i) => `<tr>${r.map((x, j) => `<td data-cmd="${i * r.length + j + 1}">${tex(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>${s.lam ? `<span class="eg-lbl">${tex(`\\Lambda = \\mathrm{diag}(${s.lam.join(', ')})`)}</span>` : ''}</div>`;
  if (s.poly) h += `<div class="eg-line">${tex(s.poly)}</div>`;
  if (s.vecs?.length) h += `<div class="eg-line">${s.vecs.map((v, i) => tex(`\\xi_{${i + 1}} = ${v}`)).join('　')}</div>`;
  if (s.lines) h += s.lines.map((l) => `<div class="eg-line">${tex(l)}</div>`).join('');
  if (s.notes?.length) h += `<ul class="el-notes">${s.notes.map((t) => `<li>${opts.md ? opts.md(t, { inline: true }) : esc(t)}</li>`).join('')}</ul>`;
  return h || '<div class="muted">（开始）</div>';
}

export function quiz(input, r) {
  return { q: '求 A 的全部特征值（重根写几遍，空格隔开）。', qhtml: '', type: 'seq', answer: perms(r.values).join(' | ') };
}

export function table(input, r) {
  if (!r.spaces) return null;
  return {
    q: '每个特征值写出代数重数（是几重根）和几何重数（线性无关的特征向量有几个）；最后判断能不能相似对角化。', qhtml: '', dir: 'row',
    head: ['代数重数', '几何重数'],
    rows: r.spaces.map((s) => ({ label: `λ = ${s.root.toString()}`, cells: [{ v: String(s.mult), num: true }, { v: String(s.geo), num: true }] })),
    extra: [{ label: '能对角化吗（能 / 不能）', v: r.diagonalizable ? '能' : '不能' }],
  };
}

// 常见错法：只列会答得不一样的（三角矩阵的对角元就是特征值，就不提 diagValues）。
// 先后有讲究：「能对角化吗」答「不能」时两种都说得通，有重根就不能这种更常见，排在前面
export function variants(input) {
  const right = run(input);
  const out = [];
  const bag = (xs) => xs.slice().sort().join(' ');
  const diag = input.A.map((r, i) => r[i].toString());
  if (right.values && bag(diag) !== bag(right.values)) out.push({ label: '像是把主对角线上的数当成了特征值（只有三角矩阵才是；要解 |λE − A| = 0）', input: { ...input, mistake: 'diagValues' } });
  if (right.diagonalizable && right.roots?.some((x) => x.mult > 1)) out.push({ label: '像是以为有重根就不能对角化（要看每个特征值的几何重数是否等于代数重数）', input: { ...input, mistake: 'repeatNo' } });
  if (right.spaces?.some((x) => x.geo !== input.n - x.geo)) out.push({ label: '像是把 λE − A 的秩当成了线性无关的特征向量个数（应该是 n − r(λE − A)）', input: { ...input, mistake: 'geoRank' } });
  return out;
}

export const eigEngine = { name: 'eig', title: '特征值与对角化', parse, run, view, quiz, table, variants };

// ================= schmidt =================

function sParse(fields) {
  const parts = String(fields.vectors ?? '').match(/\(([^()]*)\)/g);
  if (!parts || parts.length < 2) throw new Error('schmidt 要写 vectors:（至少两个向量，如 (1, 1, 0), (1, 0, 1)）');
  const vs = parts.map((p) => p.slice(1, -1).split(/[,，\s]+/).filter(Boolean).map((x) => { if (!/^-?\d+(\/\d+)?$/.test(x)) throw new Error(`vectors: 「${x}」不是数`); const [a, b = '1'] = x.split('/'); return new Q(BigInt(a), BigInt(b)); }));
  const n = vs[0].length;
  if (!vs.every((v) => v.length === n)) throw new Error('vectors: 每个向量的分量个数要一样');
  if (vs.length > n) throw new Error(`vectors: ${n} 维空间里最多 ${n} 个线性无关的向量`);
  const normalize = !/^(no|false|0|不)$/i.test(String(fields.normalize || 'yes').trim());
  return { vs, normalize };
}
function sRun(input) {
  const { betas, log } = schmidt(input.vs, { mistake: input.mistake });
  const steps = [{ view: { lines: input.vs.map((v, i) => `\\alpha_{${i + 1}} = ${colTeX(v)}`) }, msg: '施密特正交化：β₁ = α₁；后面每个 α 减去它在前面每个 β 上的投影 (α, β)/(β, β)·β。' }];
  const lines = [];
  log.forEach((x, t) => {
    const l = t === 0 ? `\\beta_1 = \\alpha_1 = ${colTeX(x.b)}` : `\\beta_{${t + 1}} = \\alpha_{${t + 1}} ${x.terms.map((u, i) => `- \\frac{${u.num.toTeX()}}{${u.den.toTeX()}}\\beta_{${i + 1}}`).join(' ')} = ${colTeX(x.b)}`;
    lines.push(l);
    steps.push({
      view: { lines: lines.slice() },
      msg: t === 0 ? 'β₁ 就是 α₁。' : `${x.terms.map((u, i) => `(α${t + 1}, β${i + 1}) = ${u.num.toString()}，(β${i + 1}, β${i + 1}) = ${u.den.toString()}`).join('；')}。`,
      ask: t === 0 ? undefined : { tag: 'dot', kind: 'number', q: `(α${t + 1}, β1) 是多少？`, answer: x.terms[0].num.toNumber(), display: x.terms[0].num.toString() },
    });
  });
  if (input.normalize && !input.mistake) {
    const us = betas.map(unit);
    lines.push(us.map((u, i) => `e_{${i + 1}} = ${unitTeX(u)}`).join(',\\ '));
    steps.push({ view: { lines: lines.slice() }, msg: '再单位化：每个 β 除以它的长度（长度 = √(β, β)）。' });
  }
  return { steps, betas };
}
function sView(s, input, opts = {}) {
  const tex = opts.tex || ((t) => esc(t));
  return (s.lines || []).map((l) => `<div class="eg-line">${tex(l)}</div>`).join('');
}
export const schmidtEngine = {
  name: 'schmidt', title: '施密特正交化', parse: sParse, run: sRun, view: sView,
  // 常见错法：往 α 上投影、忘了除以 (β, β)；只列会算出不一样的 β 的
  variants(input) {
    const right = schmidt(input.vs).betas.map((b) => b.join(','));
    const out = [];
    for (const [mistake, label] of [['useAlpha', '像是往前面的 α 上投影了（应该减去在已经求出的 β 上的投影）'], ['noDenom', '像是投影的系数忘了除以 (β, β)（系数是 (α, β)/(β, β)）']]) {
      const w = schmidt(input.vs, { mistake }).betas.map((b) => b.join(','));
      if (w.some((x, i) => x !== right[i])) out.push({ label, input: { ...input, mistake } });
    }
    return out;
  },
  table(input, r) {
    return { q: '写出正交化以后的每个 β（还没单位化，按公式算出来的，不要约分乘整）。', qhtml: '', dir: 'row', head: input.vs[0].map((_, i) => `第 ${i + 1} 个分量`), rows: r.betas.map((b, t) => ({ label: `β${t + 1}`, cells: b.map((x) => ({ v: x.toString(), num: true })) })) };
  },
};
