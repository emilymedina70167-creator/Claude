// 舞台上的矩阵（线代：初等行变换、消元求秩和解方程组、矩阵乘法「行乘列」）：数据和指令，不碰 DOM（画法在 matrix.view.js）。
// 纯函数，有测试（tests/stage-matrix.test.js）。照 array.js 的样子写（docs/stage-types.md）。
//
// 数都是精确分数（exact.js 的 Q）：场景里存成字符串（'-3/2'；'' 是乘积里还空着的格），副本（structuredClone）不丢东西，算的时候再变回 Q。
// 一格（部件）的 key 是造它时的位置（'2.3'），交换两行时格子带着数走过去（r、c 跟着变）；m.2,3 永远指「现在」第 2 行第 3 列。
// 跟着算的（value.js）：格里写算成一个数的式子（{k}、{A.1,2}、{l - 1}），或者整个矩阵写 = {A + B}、{P^-1}；依赖一变场景叫 relive，在原地改格。
// 格里写 _ 是空着的一格（matrix D = _ _ / _ _：等学生填的空牌，填满以前判断式、量都判不了）。
// 整张当把手（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 2.3）：收集用的矩阵（matrix Sum = collect）学生把矩阵放进来就跟着算
// {AA + AB}（put）；两张同一个矩阵的倍数并成一项（merge，只认 数 × 矩阵，value.js 的 termOf）；拖去逐格比（compare，scene.js 照 compareWhole）。
import { Q, isQ, isQVec, isQMat } from '../../exact.js';
// 规则那边算的读回方程、解的样子（舞台现状里写）。两个模块互相 import：都只在函数里用对方的东西，加载的先后不碍事
import { readBack, solutionText } from './matrix.rules.js';
// 整张写成一句、同类项（value.js 也 import 这里：同样只在函数里用）
import { gridText, termOf, mergeTerms, evalHoles } from '../value.js';

export const MAX_ROWS = 6, MAX_COLS = 8;
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
const ZERO = new Q(0n), ONE = new Q(1n);

/**
 * 排版（场景和画面共用，画面的 CSS 也是这个尺寸）：一行多高、一格最窄、两列之间、括号到格子、上下留白、
 * 增广的竖线多占的宽、乘积前面的「=」、乘法里 A 和 B 之间、乘积下面留给算式的一条
 */
export const MX = { CH: 52, MINW: 52, GAP: 6, PAD: 22, VPAD: 6, AUG: 20, EQ: 56, AB: 22, BAND: 66, BESIDE: 48 };

// —— 数 ——
const NUM_RE = /^([-+]?)(\d+(?:\.\d+)?|\.\d+)(?:\/(\d+(?:\.\d+)?))?$/;
/** 一个数的写法 → Q（3、-2、1/2、-1/2、0.5、(1/2)、−3）；不是数给 null */
export function toQ(w) {
  const s = String(w ?? '').trim().replace(/[−–]/g, '-').replace(/^\((.*)\)$/, '$1');
  const m = s.match(NUM_RE);
  if (!m) return null;
  let q = Q.from(Number(m[2]));
  if (m[3] != null) {
    const d = Q.from(Number(m[3]));
    if (d.zero) return null;
    q = q.div(d);
  }
  return m[1] === '-' ? q.neg() : q;
}
const numOr = (w, what = '') => {
  const q = toQ(w);
  if (!q) throw new Error(`${what}「${w}」不是数（写成 3、-2、1/2、0.5）`);
  return q;
};
const qOf = (o, x) => {
  if (x.value === '') throw new Error(`${o.id}.${x.r},${x.c} 还空着`);
  return toQ(x.value);
};

/**
 * 矩阵的写法 → { rows（每行一串精确的数，字符串）, aug（竖线在第几列后面，没有是 null） }。
 * 认 1 2 3 / 4 5 6（/ 分行）、1 2; 3 4、[[1 2][3 4]]；写 | 是增广矩阵的竖线（每行写在同一个位置，或者只在第一行写）。
 * slot(词, 第几行, 第几列)：不是数的词先问它（格里的 {k} 换成的占位），给了字就用它。
 * cap：查舞台上能放多大（判答案时不查：答案不上舞台）；blank：_ 是空着的一格（造矩阵时认，判答案时不认：空着的不是答案）
 */
export function parseRows(words, slot, { cap = true, blank = false } = {}) {
  const s = words.join(' ').replace(/\]\s*,?\s*\[/g, ' / ').replace(/[[\]]/g, ' ').replace(/[;；]/g, ' / ').replace(/[,，]/g, ' ');
  const rows = [[]];
  const bars = [null];
  for (let t of s.split(/\s+/).filter(Boolean)) {
    if (t === '/') { rows.push([]); bars.push(null); continue; }
    if (t === '|') { bars[bars.length - 1] = rows.at(-1).length; continue; }
    // 「/3」「2/」：斜线贴着数写的也当分行
    let after = false;
    if (/^\/./.test(t)) { rows.push([]); bars.push(null); t = t.slice(1); }
    if (/.\/$/.test(t)) { after = true; t = t.slice(0, -1); }
    rows.at(-1).push(slot?.(t, rows.length, rows.at(-1).length + 1) ?? (blank && t === '_' ? '' : numOr(t).toString()));
    if (after) { rows.push([]); bars.push(null); }
  }
  while (rows.length > 1 && !rows.at(-1).length) { rows.pop(); bars.pop(); }
  if (!rows[0].length) throw new Error('矩阵要有数：写成 matrix m = 1 2 / 3 4（/ 分行）');
  rows.forEach((r, i) => { if (!r.length) throw new Error(`第 ${i + 1} 行是空的（两个 / 中间要有数）`); });
  rows.forEach((r, i) => { if (r.length !== rows[0].length) throw new Error(`第 ${i + 1} 行有 ${r.length} 个数，第 1 行有 ${rows[0].length} 个（每行要一样多）`); });
  if (cap && (rows.length > MAX_ROWS || rows[0].length > MAX_COLS)) throw new Error(`舞台上的矩阵最多 ${MAX_ROWS} 行 ${MAX_COLS} 列（写了 ${rows.length}×${rows[0].length}）`);
  const set = [...new Set(bars.filter((b) => b != null))];
  if (set.length > 1) throw new Error('增广矩阵的竖线 | 每行要写在同一个位置');
  const aug = set.length ? set[0] : null;
  if (aug != null && (aug < 1 || aug >= rows[0].length)) throw new Error('竖线 | 要写在两个数中间');
  return { rows, aug };
}

// —— 排版 ——
/** 一个数画出来大约多宽（像素）：分数上下叠着，按长的那一半算 */
export function textWidth(v) {
  const s = String(v ?? '');
  if (!s) return 24;
  const m = s.match(/^(-?)(\d+)\/(\d+)$/);
  if (m) return (m[1] ? 15 : 0) + Math.max(m[2].length, m[3].length) * 11 + 6;
  return s.length * 14.6;
}
/** 收集用的、还没放进东西（画成一个写着「放进来」的空格） */
export const emptyCollect = (o) => !!o.collect && !o.collect.terms.length;
/** 每一列多宽（从 1 数）：这一列最长的那个数定 */
export function colWidths(o) {
  const w = Array(o.cols + 1).fill(MX.MINW);
  w[0] = 0;
  for (const x of o.cells) w[x.c] = Math.max(w[x.c], Math.ceil(textWidth(x.value) + 22));
  // 收集用的还空着：那一格写着「放进来」，宽一点（放进第一张以后照那一张的大小）
  if (emptyCollect(o)) w[1] = Math.max(w[1], 96);
  return w;
}
/** 整个矩阵的排版：每列的左边、每行的上边、括号里面的外框、增广竖线在哪 */
export function layout(o) {
  const cw = colWidths(o);
  const colX = [0];
  let x = o.origin.x + MX.PAD;
  for (let c = 1; c <= o.cols; c++) {
    if (o.aug && c === o.aug + 1) x += MX.AUG;
    colX[c] = x;
    x += cw[c] + MX.GAP;
  }
  const w = x - MX.GAP + MX.PAD - o.origin.x;
  const h = o.rows * MX.CH + 2 * MX.VPAD;
  const rowY = (r) => o.origin.y + MX.VPAD + (r - 1) * MX.CH;
  return { cw, colX, rowY, box: { x: o.origin.x, y: o.origin.y, w, h }, barX: o.aug ? colX[o.aug + 1] - (MX.AUG + MX.GAP) / 2 : null };
}
export const sizeOf = (o) => layout({ ...o, origin: { x: 0, y: 0 } }).box;
export function cellBox(o, x, L = layout(o)) { return { x: L.colX[x.c], y: L.rowY(x.r), w: L.cw[x.c], h: MX.CH }; }
/**
 * 乘积下面写算式的那一条在哪：存的是相对乘积自己左上角的位置（o.band），乘积被推下去、整排挪了它跟着走
 * （以前存的是造出来那一刻的绝对位置，乘积挪走了它还留在原地，乘积占的地方就被拉成从原地到新地的一大块）
 */
export function bandOf(o) {
  const r = o.band;
  if (!r) return null;
  return { x: o.origin.x + r.dx, y: o.origin.y + r.dy, w: r.w, h: r.h };
}
/** 乘积前面那一块多宽：「=」，另起一行的写「BA =」 */
export const eqWidth = (o) => (o.prefix ? 104 : MX.EQ);
function objectBox(o) {
  const b = layout(o).box;
  if (!o.product) return b;
  // 乘积：前面的「=」和整排下面那条算式也算它的地方（镜头要把算式框进来）
  const eq = { x: b.x - eqWidth(o), y: b.y, w: b.w + eqWidth(o), h: b.h };
  const band = bandOf(o);
  if (!band) return { ...eq, h: b.h + MX.BAND };
  const x = Math.min(eq.x, band.x), y = Math.min(eq.y, band.y);
  return { x, y, w: Math.max(eq.x + eq.w, band.x + band.w) - x, h: Math.max(eq.y + eq.h, band.y + band.h) - y };
}
/** 括号、竖线、「=」占的地方（贴字时让开） */
export function decorBoxes(o) {
  const b = layout(o).box;
  const out = [{ x: b.x, y: b.y, w: 16, h: b.h }, { x: b.x + b.w - 16, y: b.y, w: 16, h: b.h }];
  if (o.product) out.push({ x: b.x - eqWidth(o), y: b.y + b.h / 2 - 20, w: eqWidth(o), h: 40 });
  return out;
}
/** 阶梯线经过的点（世界坐标）：每个非零行的主元左边竖下来，再沿这一行的下沿走到下一行的主元。不是阶梯形给 null */
export function stairsPoints(o) {
  let piv;
  try { piv = echelon(o); } catch { return null; }
  if (!piv.length) return null;
  const L = layout(o);
  const xl = (c) => L.colX[c] - MX.GAP / 2 - 2;
  const yb = (r) => L.rowY(r) + MX.CH;
  const pts = [{ x: xl(piv[0].c), y: L.rowY(1) + 6 }];
  piv.forEach((p, i) => {
    pts.push({ x: xl(p.c), y: yb(p.r) });
    const next = piv[i + 1];
    pts.push({ x: next ? xl(next.c) : L.colX[o.cols] + L.cw[o.cols] + 4, y: yb(p.r) });
  });
  return pts;
}

// —— 部件 ——
const sortRC = (a, b) => a.r - b.r || a.c - b.c;
const lineOf = (o, kind, k) => o.cells.filter((x) => (kind === 'r' ? x.r : x.c) === k).sort(sortRC);
export const rowCells = (o, r) => lineOf(o, 'r', r);
export const colCells = (o, c) => lineOf(o, 'c', c);
const cellAt = (o, r, c) => o.cells.find((x) => x.r === r && x.c === c);
function setValue(x, v) { x.value = v; x.label = v === '' ? '?' : null; }
const newCell = (id, r, c, v) => ({ obj: id, key: `${r}.${c}`, r, c, value: v, label: v === '' ? '?' : null, paint: null, glow: false, lift: false, dim: false, covered: false, pivot: false });

/** 舞台上叫这个名字的矩阵；没有就说清楚怎么写 */
function matrixOf(scene, id, cmd) {
  const o = id && scene.objects.get(id);
  if (!o) throw new Error(`${cmd} 后面先写矩阵的名字（比如 ${cmd} m …）${id ? `：舞台上没有「${id}」` : ''}`);
  if (o.type !== 'matrix') throw new Error(`「${id}」不是矩阵`);
  return o;
}

/** 新的一样东西放在 beside= 那样东西的右边（上下居中）；没写就照舞台的规矩放在已有东西下面 */
export function placeFor(scene, size, opts) {
  if (opts?.beside) {
    const t = scene.objects.get(opts.beside);
    if (!t) throw new Error(`beside=${opts.beside}：舞台上没有「${opts.beside}」`);
    const b = scene.objectBox(opts.beside);
    return { x: Math.round(b.x + b.w + MX.BESIDE), y: Math.round(b.y + b.h / 2 - size.h / 2) };
  }
  return scene.slotFor(size.w);
}

// —— 行变换 ——
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n) => String(n).replace(/\d/g, (d) => SUBS[d]);
const minus = (s) => String(s).replace(/-/g, '−');
const isOne = (q) => q.n === 1n && q.d === 1n;
const isNegOne = (q) => q.n === -1n && q.d === 1n;
// 系数写在 r 前面：1 不写、−1 写成 −、分数加括号（课本的写法）
const coefText = (q) => (isOne(q) ? '' : isNegOne(q) ? '−' : q.integer ? minus(q) : `(${minus(q)})`);
/** 一步行变换照课本的样子写出来：r₂ − 3r₁、r₁ ↔ r₃、3r₂、r₂ ÷ 3、2r₂ − 3r₁ */
export function opText(op) {
  const L = (k) => `${op.line}${sub(k)}`;
  if (op.kind === 'swap') return `${L(op.i)} ↔ ${L(op.j)}`;
  const { a, b } = op;
  if (!b) return (a.n === 1n || a.n === -1n) && a.d > 1n ? `${L(op.i)} ÷ ${a.n < 0n ? `(−${a.d})` : a.d}` : `${coefText(a)}${L(op.i)}`;
  const neg = b.n < 0n;
  return `${coefText(a)}${L(op.i)} ${neg ? '−' : '+'} ${coefText(neg ? b.neg() : b)}${L(op.j)}`;
}

// 一个式子拆成项：r2 - 3r1 → [{ line: r, k: 2, q: 1 }, { line: r, k: 1, q: -3 }]；系数能写 3、1/2、(1/2)、(-1/2)，也能写在后面 r2*3、r2/3
function termsOf(rhs, bad) {
  const out = [];
  let i = 0;
  const rest = () => rhs.slice(i);
  while (i < rhs.length) {
    let sign = 1;
    if (rhs[i] === '+' || rhs[i] === '-') { if (rhs[i] === '-') sign = -1; i++; } else if (out.length) throw bad();
    let q = ONE;
    const m = /^\(([^()]+)\)\*?/.exec(rest()) || /^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?)\*?/.exec(rest());
    if (m && /^[rc]\d/.test(rhs.slice(i + m[0].length))) {
      q = toQ(m[1]);
      if (!q) throw bad();
      i += m[0].length;
    }
    const v = /^([rc])(\d+)/.exec(rest());
    if (!v) throw bad();
    i += v[0].length;
    const post = /^([*/])(\(([^()]+)\)|-?\d+(?:\.\d+)?(?:\/\d+)?)/.exec(rest());
    if (post) {
      const k = toQ(post[3] ?? post[2]);
      if (!k) throw bad();
      if (post[1] === '/') { if (k.zero) throw new Error('不能除以 0'); q = q.div(k); } else q = q.mul(k);
      i += post[0].length;
    }
    out.push({ line: v[1], k: Number(v[2]), q: sign < 0 ? q.neg() : q });
  }
  if (!out.length) throw bad();
  return out;
}

/**
 * 一行行变换的写法 → 一步步（照课本：r2 - 3r1、r2 = r2 - 3r1、r3 + 1/2 r1、r1 <-> r3、3r2、-r1、r2 / 3、2r2 - 3r1；
 * 逗号隔开是连着做的几步：r2 - 4r1, r3 - 7r1；列变换把 r 换成 c）。
 * 返回 [{ line: 'r' | 'c', kind: 'swap' | 'scale' | 'add' | 'comb', i, j, a, b }]（a、b 是 Q：第 i 行 ← a·第 i 行 + b·第 j 行）
 */
/** rowop 那一行里写的行变换（名字后面的部分）原样拼回来：r2=r2-3r1 连着写时被读成了 key=value，也拼回来（matrix.rules.js 的 actOf 也用它） */
export function rowopText(h) {
  const opt = Object.entries(h.opts).filter(([k]) => /^[rRcC]\d+$/.test(k)).map(([k, v]) => `${k}=${v}`);
  const rest = h.args.slice(1).map((a) => (a.t === 'word' ? a.v : a.t === 'eq' ? '=' : a.t === 'arrow' ? '->' : '')).join(' ');
  return [...opt, rest].join(' ');
}

export function parseOps(text, o) {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error(`rowop 后面写一步行变换，比如 rowop ${o.id} r2 - 3r1`);
  const s = raw.replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/[RC]/g, (ch) => ch.toLowerCase())
    .replace(/[₀-₉]/g, (d) => String(SUBS.indexOf(d))).replace(/_/g, '').replace(/<->|<=>|<>|↔|⇄|⟷/g, '~');
  const ops = s.split(/[,，;；]/).filter(Boolean).map((part) => {
    const bad = () => new Error(`看不懂「${part.replace(/~/g, ' <-> ')}」：行变换写成 r2 - 3r1、r1 <-> r2、3r2、r2 / 3（列变换把 r 换成 c）`);
    const size = (line) => (line === 'r' ? o.rows : o.cols);
    const check = (line, k) => { if (!(k >= 1 && k <= size(line))) throw new Error(`${o.id} 只有 ${size(line)} ${line === 'r' ? '行' : '列'}，没有 ${line}${k}`); };
    let m = /^([rc])(\d+)~([rc])(\d+)$/.exec(part);
    if (m) {
      if (m[1] !== m[3]) throw new Error('行和列不能互换：r1 <-> r2 或 c1 <-> c2');
      const i = Number(m[2]), j = Number(m[4]);
      check(m[1], i); check(m[1], j);
      if (i === j) throw new Error(`「${part}」：两行是同一行`);
      return { line: m[1], kind: 'swap', i, j };
    }
    if (part.includes('~')) throw bad();
    let target = null, rhs = part;
    m = /^([rc])(\d+)=(.+)$/.exec(part);
    if (m) { target = { line: m[1], k: Number(m[2]) }; rhs = m[3]; } else if (part.includes('=')) throw bad();
    const terms = termsOf(rhs, bad);
    target ||= terms[0];
    const line = target.line;
    if (terms.some((t) => t.line !== line)) throw new Error(`「${part}」：一步里行和列不能混着写`);
    terms.forEach((t) => check(line, t.k));
    const coef = new Map();
    for (const t of terms) coef.set(t.k, (coef.get(t.k) || ZERO).add(t.q));
    const a = coef.get(target.k);
    if (!a) throw new Error(`「${part}」：${line}${target.k} 自己要在式子里（比如 ${line}${target.k} - 3${line}${target.k === 1 ? 2 : 1}）`);
    if (a.zero) throw new Error(`「${part}」：${line}${target.k} 前面的系数不能是 0（那不是初等变换）`);
    const others = [...coef].filter(([k, q]) => k !== target.k && !q.zero);
    if (others.length > 1) throw new Error(`「${part}」：一步只能加上一${line === 'r' ? '行' : '列'}的倍数，分成两步用逗号隔开（比如 r3 - r1, r3 + r2）`);
    if (!others.length) {
      if (isOne(a)) throw new Error(`「${part}」什么也没变`);
      return { line, kind: 'scale', i: target.k, a, b: null, j: null };
    }
    const [[j, b]] = others;
    return { line, kind: isOne(a) ? 'add' : 'comb', i: target.k, j, a, b };
  });
  const lines = new Set(ops.map((x) => x.line));
  if (lines.size > 1) throw new Error('一行里行变换和列变换不要混着写，分成两行');
  return ops;
}

// 做一步，记下画面要的：目标那一行（列）每格的 key、原来的数、做完的数；从哪一行加过来、那一行的数、乘过系数的数
function applyOp(o, op) {
  const T = lineOf(o, op.line, op.i);
  const fx = { line: op.line, kind: op.kind, i: op.i, j: op.j, a: op.a?.toString() ?? null, b: op.b?.toString() ?? null, text: opText(op), keys: T.map((x) => x.key), before: T.map((x) => x.value) };
  if (op.kind === 'swap') {
    const S = lineOf(o, op.line, op.j);
    const f = op.line === 'r' ? 'r' : 'c';
    T.forEach((x) => { x[f] = op.j; });
    S.forEach((x) => { x[f] = op.i; });
    fx.other = S.map((x) => x.key);
    return fx;
  }
  const S = op.j ? lineOf(o, op.line, op.j) : null;
  const t = T.map((x) => qOf(o, x));
  const s = S ? S.map((x) => qOf(o, x)) : null;
  const mid = t.map((v) => v.mul(op.a));
  const scaled = s ? s.map((v) => v.mul(op.b)) : null;
  const after = mid.map((v, k) => (scaled ? v.add(scaled[k]) : v));
  T.forEach((x, k) => setValue(x, after[k].toString()));
  Object.assign(fx, { mid: mid.map(String), after: after.map(String), src: S?.map((x) => x.key) ?? null, srcVals: s?.map(String) ?? null, scaled: scaled?.map(String) ?? null });
  return fx;
}

/** 阶梯形的主元：每个非零行第一个不为 0 的数 [{ r, c }]；不是阶梯形抛错（说清楚哪一行不对） */
export function echelon(o) {
  const lead = [];
  for (let r = 1; r <= o.rows; r++) {
    const row = rowCells(o, r);
    const k = row.findIndex((x) => !qOf(o, x).zero);
    lead.push(k < 0 ? null : row[k].c);
  }
  let prev = 0, zero = false;
  lead.forEach((c, i) => {
    if (c == null) { zero = true; return; }
    if (zero) throw new Error(`${o.id} 还不是阶梯形：全为 0 的行下面，第 ${i + 1} 行不全为 0`);
    if (c <= prev) throw new Error(`${o.id} 还不是阶梯形：第 ${i + 1} 行第一个不为 0 的数没有在第 ${i} 行那个的右边`);
    prev = c;
  });
  return lead.map((c, i) => (c ? { r: i + 1, c } : null)).filter(Boolean);
}
/** 全为 0 的行（行号） */
export function zeroRows(o) {
  const out = [];
  for (let r = 1; r <= o.rows; r++) if (rowCells(o, r).every((x) => x.value !== '' && toQ(x.value).zero)) out.push(r);
  return out;
}

// —— 跟着算的（{…}，value.js）——
const unionDeps = (list) => [...new Set(list.flatMap((k) => k.deps))];
/**
 * 算出来的值 → 每一行的数（字符串）：矩阵照写，向量是一列；一个数不行。trial：用到了空格子，v 是试算时页面顶上的数——
 * 报错里不写它（「{rankA(D)} 算出来是数 0」的 0 是页面顶上的，D 填满以后不一定是 0：复审 N4）
 */
function rowsOfValue(v, src, { trial = false } = {}) {
  if (isQ(v)) throw new Error(`「{${src}}」算出来是${trial ? '一个数' : `数 ${v}`}，不是矩阵。要一个跟着算的数，贴一行字就行：label n 东西 "… {${src}}"（数跟着变）；要矩阵里的一格跟着算，写 matrix M = 1 {k} / 0 1`);
  const rows = isQMat(v) ? v.map((r) => r.map(String)) : isQVec(v) ? v.map((x) => [String(x)]) : null;
  if (!rows) throw new Error(`「{${src}}」算出来的不是矩阵`);
  if (rows.length > MAX_ROWS || rows[0].length > MAX_COLS) throw new Error(`「{${src}}」算出来是 ${rows.length}×${rows[0].length}，舞台上的矩阵最多 ${MAX_ROWS} 行 ${MAX_COLS} 列`);
  return rows;
}
// 格里的 {…} 写算成一个数的式子（{k}、{A.1,2}、{l - 1}、{2 k}、{det(A)}）：一格里是一个数；算出来是矩阵、向量照实说
// （第一轮只认拨数的名字或一格；放宽以后旧写法一个不少，旧课照样放回）
const notNumber = (v) => (isQMat(v) ? '矩阵' : isQVec(v) ? '向量' : '别的');
// 用到的有空格子（{A D}、D 还是 _ _ / _ _；格里的 {D.1,1 + 1}）：先挂上，跟着空格子变的格空着（''，画成「?」），
// 空格子填上了跟着重算（value.js 的 evalHoles；以前一算就报「还空着」，整行不演）
function cellLive(h, src) {
  const { value, deps, holes } = evalHoles(src, h.scene);
  if (!isQ(value)) throw new Error(`「{${src}}」算出来是${notNumber(value)}，格里要一个数`);
  return { value: holes ? '' : value.toString(), deps };
}
/** 整张跟着算的那几行：跟着空格子变的格空着 */
function wholeRows(scene, src) {
  const { value, deps, holes } = evalHoles(src, scene);
  const rows = rowsOfValue(value, src, { trial: !!holes });
  if (holes) {
    const hole = isQMat(value) ? (i, j) => holes[i][j] : (i) => holes[i];
    rows.forEach((r, i) => r.forEach((_, j) => { if (hole(i, j)) r[j] = ''; }));
  }
  return { rows, deps };
}
/**
 * 写了 {…} 的矩阵：整个 = {A + B} 是 { rows, live: { whole, deps } }；格里的 {k} 是 { rows, aug, live: { cells: [{ key, expr, deps }], deps } }
 */
function liveRows(h, text) {
  const { parts } = h.parseLive(text);
  const exprs = parts.filter((p) => p.k === 'expr');
  if (exprs.length === 1 && parts.every((p) => p.k === 'expr' || !p.v.trim())) {
    const src = exprs[0].v;
    const { rows, deps } = wholeRows(h.scene, src);
    return { rows, aug: null, live: { line: h.line, whole: src, deps } };
  }
  // 每个 {…} 换成一个占位的词，照原来的写法读行列，读到占位时算那一格
  const slots = [];
  const marked = parts.map((p) => (p.k === 'text' ? p.v : ` §${slots.push(p.v) - 1} `)).join('');
  const cells = [];
  const { rows, aug } = parseRows([marked], (t, r, c) => {
    const m = t.match(/^§(\d+)$/);
    if (!m) return null;
    const v = cellLive(h, slots[m[1]]);
    cells.push({ key: `${r}.${c}`, expr: slots[m[1]], deps: v.deps });
    return v.value;
  }, { blank: true });
  return { rows, aug, live: { line: h.line, cells, deps: unionDeps(cells) } };
}

/**
 * 造矩阵时另外记下的（matrix.rules.js 读）：vars="x y z" 读回方程用的未知数（不写就是 x1、x2……）；from=M0 这一张是从 M0
 * 化过来的（学生写满一行就和 M0 比，猜是哪一种行变换）。写下时查得出来的错当场报
 */
function readExtras(scene, o, id, opts) {
  if (opts.vars != null) {
    const names = String(opts.vars).split(/[\s,，]+/).filter(Boolean);
    const want = o.aug ?? o.cols;
    if (names.length !== want) throw new Error(`vars= 写了 ${names.length} 个未知数，${id} ${o.aug ? '竖线左边' : ''}有 ${want} 列（一列一个，比如 vars="x y z"）`);
    if (new Set(names).size !== names.length) throw new Error(`vars= 里的未知数重名了：${opts.vars}`);
    o.vars = names;
  }
  if (opts.from != null) {
    const src = String(opts.from);
    const M0 = scene.objects.get(src);
    if (!M0) throw new Error(`from=${src}：舞台上没有「${src}」`);
    if (M0.type !== 'matrix') throw new Error(`from=${src}：「${src}」不是矩阵`);
    if (src === id) throw new Error(`from= 写上一张矩阵的名字，不能写 ${id} 自己`);
    if (M0.rows !== o.rows || M0.cols !== o.cols) throw new Error(`from=${src}：${src} 是 ${M0.rows}×${M0.cols} 的，${id} 是 ${o.rows}×${o.cols} 的（化过来的要一样大）`);
    o.from = src;
  }
}

// —— 收集用的矩阵、并同类项（整张当把手）——
const SIGN_TEXT = { '+': '加起来', '-': '第一张减后面的' };
/** 收集用的式子：加起来是 AA + AB，减的是第一张减后面的 AB - BA */
const collectSrc = (sign, terms) => terms.join(sign === '-' ? ' - ' : ' + ');

// matrix Sum = collect（放进来的加起来）/ matrix Dd = collect -（第一张减后面的）：空着时是一个空格，学生把矩阵拖进来（put）才有数
function makeCollect(scene, id, rest, opts, old) {
  const sign = !rest.length || (rest.length === 1 && rest[0] === '+') ? '+' : rest.length === 1 && /^[-−]$/.test(rest[0]) ? '-' : null;
  if (!sign) throw new Error('收集用的矩阵写成 matrix Sum = collect（放进来的加起来）或 matrix Dd = collect -（第一张减后面的）');
  for (const k of ['vars', 'from']) if (opts[k] != null) throw new Error(`收集用的矩阵不写 ${k}=（数照放进来的那几张算）`);
  const o = { origin: { x: 0, y: 0 }, rows: 1, cols: 1, aug: null, cells: [newCell(id, 1, 1, '')], stairs: false, product: null, collect: { sign, terms: [] } };
  o.origin = old && !opts.beside ? { ...old.origin } : placeFor(scene, sizeOf(o), opts);
  return o;
}

/**
 * put AB Sum 做不做得到（学生的一下：裁判照它判 legal；老师的一行：照它报错）：{ error } | { A, S, terms, whole, deps }。
 * Sum 要是收集用的；AB 不能还有空着的格；Sum 里已经有东西了，AB 要和它一样大；放进去不能转着圈（AB 跟着 Sum 算）
 */
export function putPlan(scene, an, sn) {
  if (!an || !sn) return { error: '要写成 put AB Sum（把 AB 放进收集用的 Sum）' };
  for (const n of [an, sn]) {
    const x = scene.objects.get(n);
    if (!x) return { error: `舞台上没有「${n}」` };
    if (x.type !== 'matrix') return { error: `「${n}」不是矩阵` };
  }
  const A = scene.objects.get(an), S = scene.objects.get(sn);
  if (!S.collect) return { error: `${sn} 不是收集用的矩阵（写 matrix ${sn} = collect）` };
  if (an === sn) return { error: `${sn} 不能放进它自己` };
  const blank = A.cells.filter((x) => x.value === '').sort(sortRC)[0];
  if (blank) return { error: `${an}.${blank.r},${blank.c} 还空着，${an} 放不进去` };
  if (S.collect.terms.length && (S.rows !== A.rows || S.cols !== A.cols)) return { error: `${sn} 是 ${S.rows}×${S.cols} 的，${an} 是 ${A.rows}×${A.cols}，放不进去` };
  const terms = [...S.collect.terms, an];
  const whole = collectSrc(S.collect.sign, terms);
  let deps;
  try {
    ({ deps } = scene.liveValue(whole));
    scene.liveCheck([{ id: sn, obj: sn, deps, live: true }], sn);
  } catch (err) { return { error: err.message }; }
  return { A, S, terms, whole, deps };
}

// 跟着算的整张（没有手写的格）：认得出是 数 × 矩阵 才是一项
const liveTerm = (o, scene) => (o.live?.whole && !o.live.fixed?.length ? termOf(o.live.whole, { matrix: (n) => scene.objects.get(n)?.type === 'matrix' }) : null);
/**
 * merge X Y 做不做得到：{ error } | { X, Y, from, into, to, whole }（from / into 是 X、Y 原来的那一项，to 是并好的，whole 是 Y 的新式子）。
 * 只认 数 × 同一个矩阵（或同一串乘积）：认不出的说页面看不出，不说「不是同类项」；还有东西跟着 X 算，X 拿不下来
 */
export function mergePlan(scene, xn, yn) {
  if (!xn || !yn) return { error: '要写成 merge X Y（把 X 并进 Y：同一个矩阵的倍数并成一项）' };
  for (const n of [xn, yn]) {
    const x = scene.objects.get(n);
    if (!x) return { error: `舞台上没有「${n}」` };
    if (x.type !== 'matrix') return { error: `「${n}」不是矩阵` };
  }
  if (xn === yn) return { error: `${xn} 并到自己身上什么也没变（拖到另一张上）` };
  const X = scene.objects.get(xn), Y = scene.objects.get(yn);
  const from = liveTerm(X, scene), into = liveTerm(Y, scene);
  const to = mergeTerms(from, into, { x: xn, y: yn });
  if (to.error) return { error: to.error };
  // X 拿下舞台以后跟着它算的就算不出来了（别的跟着算的、乘积、收集用的里放着它）
  const head = (d) => String(d).match(/^[A-Za-z_]\w*/)?.[0];
  const users = [...new Set(scene.liveNodes().filter((n) => n.obj !== xn && (n.deps || []).some((d) => head(d) === xn)).map((n) => n.obj))];
  if (users.length) return { error: `${users.join('、')} 跟着 ${xn} 算，${xn} 拿不下来，并不了` };
  return { X, Y, from, into, to, whole: mergedSrc(to) };
}
/**
 * 并好的那一项写成 Y 的式子：1 倍写 A、−1 倍写 -A、0 倍写 0 A（还跟着 A 的大小，现状里写 O）、别的写 (k) A。
 * 都是 termOf 认得的写法：再并一张照样并
 */
const mergedSrc = (t) => (t.k.zero ? `0 ${t.base}` : t.k.n === 1n && t.k.d === 1n ? t.base : t.k.n === -1n && t.k.d === 1n ? `-${t.base}` : `(${t.k}) ${t.base}`);
/** 并同类项并成了 0、格也真的全是 0（老师后来改了一格就不算） */
const cancelledNow = (o) => !!o.cancelled && o.cells.every((x) => x.value !== '' && toQ(x.value).zero);

// product C = A B：A、B 排成一行（A 留在原处、B 挪到 A 右边），后面「= C」，三个上下居中；C 的格先空着。
// old：同名重造（product P = B A 把 AB 翻成 BA）时原来那一个乘积
function makeProduct(scene, c, h, old) {
  if (!h.args.some((a) => a.t === 'eq')) throw new Error('要写成 product C = A B');
  const [id, an, bn, ...more] = h.words;
  if (more.length || !an || !bn) throw new Error('要写成 product C = A B（两个舞台上的矩阵）');
  const A = scene.objects.get(an), B = scene.objects.get(bn);
  for (const [n, x] of [[an, A], [bn, B]]) if (!x || x.type !== 'matrix') throw new Error(`product 要两个舞台上的矩阵：「${n}」${x ? '不是矩阵' : '舞台上没有'}`);
  if (an === id || bn === id) throw new Error('乘积换一个名字（不能和 A、B 同名）');
  if (A.aug || B.aug) throw new Error('增广矩阵不能拿来乘');
  if (A.cols !== B.rows) throw new Error(`${an} 是 ${A.rows}×${A.cols}，${bn} 是 ${B.rows}×${B.cols}：${an} 的列数要等于 ${bn} 的行数才能乘`);
  const cells = [];
  for (let r = 1; r <= A.rows; r++) for (let k = 1; k <= B.cols; k++) cells.push(newCell(id, r, k, ''));
  // calc：算出来的那几格（key）。A、B 变了，这几格跟着重算（derive）；还空着的格照旧空着，等老师或学生算
  const o = { origin: { x: 0, y: 0 }, rows: A.rows, cols: B.cols, aug: null, cells, stairs: false, product: { a: an, b: bn }, calc: [] };
  const sa = sizeOf(A), sb = sizeOf(B), sc = sizeOf(o);
  // A 或 B 已经排在别的乘积里（先 AB 再 BA，讲「换了顺序」时最常见）：挪它们会把那一排拆散。
  // 不挪，这个乘积另起一行，前面写「BA =」；算一格时照样从 A、B 现在的地方飞过来
  const busy = [...scene.objects.values()].some((x) => x.type === 'matrix' && x.product && x.id !== id && [x.product.a, x.product.b].some((f) => f === an || f === bn));
  if (busy) {
    o.prefix = `${an}${bn}`;
    const eqw = eqWidth(o);
    const slot = scene.slotFor(eqw + sc.w);
    o.origin = { x: slot.x + eqw, y: slot.y };
    o.band = { dx: -eqw, dy: sc.h + 8, w: eqw + sc.w, h: MX.BAND - 8 };
    return o;
  }
  const ba = layout(A).box;
  const total = sa.w + MX.AB + sb.w + MX.EQ + sc.w;
  const cx = ba.x + sa.w / 2;
  let cy = ba.y + Math.max(sa.h, sb.h) / 2, left = Math.round(cx - total / 2);
  // 同名重造一个排成一排的乘积（product P = B A 把 AB 翻成 BA）：翻在原来那一排上——从原来那一排的左边起、上下照原来那一排居中，
  // 两个因子换槽、乘积留在原处（scene.js 照 sameRow 留着它在 objects 里的先后）。以前照新的第一个因子重新居中，整排往右挪了半排，
  // 乘积又排到最后，reflow 把「= P」推到后造的东西下面，那一排散了（第三次量 L1 第 1 幕）
  const row = old?.product && !old.prefix && old.band ? { left: old.origin.x + old.band.dx, cy: old.origin.y + sizeOf(old).h / 2 } : null;
  if (row) { left = Math.round(row.left); cy = row.cy; o.sameRow = true; }
  A.origin = { x: left, y: Math.round(cy - sa.h / 2) };
  B.origin = { x: left + sa.w + MX.AB, y: Math.round(cy - sb.h / 2) };
  o.origin = { x: B.origin.x + sb.w + MX.EQ, y: Math.round(cy - sc.h / 2) };
  // 算一格时那条算式写在整排（A B = C）下面：镜头要把这一条框进来
  const bottom = Math.max(A.origin.y + sa.h, B.origin.y + sb.h, o.origin.y + sc.h);
  o.band = { dx: left - o.origin.x, dy: bottom + 8 - o.origin.y, w: total, h: MX.BAND - 8 };
  return o;
}

// 一格乘积：A 的第 r 行和 B 的第 c 列逐对相乘再相加
function productTerms(A, B, r, c) {
  const row = rowCells(A, r), col = colCells(B, c);
  const terms = row.map((x, k) => ({ a: x.key, b: col[k].key, av: qOf(A, x).toString(), bv: qOf(B, col[k]).toString(), p: qOf(A, x).mul(qOf(B, col[k])).toString() }));
  const sum = terms.reduce((s, t) => s.add(toQ(t.p)), ZERO).toString();
  return { terms, sum };
}

/** 整张当把手的三种动作（手势表里 from: 'whole'）：跟着算的也能开（数照旧由式子定，学生拨不乱） */
export const WHOLE_ACTS = ['compare', 'put', 'merge'];

export const matrix = {
  type: 'matrix',
  label: '矩阵',
  create: ['matrix', 'product'],
  // 认得的选项（名字=值，scene.js 的 checkOptions；造它的那一行另外都认 hide=）；rowop M r2=r2-3r1 连着写被读成了选项，照收
  options: { matrix: ['beside', 'vars', 'from'], rowop: [/^[rRcC]\d+$/] },
  drag: false,
  hint: '（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）',
  make(scene, c, h, old) {
    if (c.cmd === 'product') {
      if (h.words.some((w) => /[{}]/.test(w))) throw new Error('product 里不写 {…}：要跟着算就写 matrix C = {A B}');
      return makeProduct(scene, c, h, old);
    }
    if (!h.args.some((a) => a.t === 'eq')) throw new Error('要写成 matrix 名字 = 1 2 / 3 4（/ 分行）');
    const id = h.words[0];
    const words = h.words.slice(1);
    if (words[0] === 'collect') return makeCollect(scene, id, words.slice(1), h.opts, old);
    const live = words.some((w) => /[{}]/.test(w)) ? liveRows(h, words.join(' ')) : null;
    const { rows, aug } = live || parseRows(words, null, { blank: true });
    const cells = [];
    rows.forEach((row, i) => row.forEach((v, k) => cells.push(newCell(id, i + 1, k + 1, v))));
    const o = { origin: { x: 0, y: 0 }, rows: rows.length, cols: rows[0].length, aug, cells, stairs: false, product: null };
    readExtras(scene, o, id, h.opts);
    // 式子里没用到舞台上的东西（{[[1, 2], [3, 4]]}）就只是一次算好的数
    if (live?.live.deps.length) o.live = live.live;
    o.origin = old && !h.opts.beside ? { ...old.origin } : placeFor(scene, sizeOf(o), h.opts);
    return o;
  },
  parts(o) { return [...o.cells].sort(sortRC); },
  /** 扣着的一格画成小块写它在第几行第几列（scene.js 的 coverText：不写值） */
  coverName: (p, o) => `${o.id} 第 ${p.r} 行第 ${p.c} 列`,
  pick(o, mark, sel, word) {
    const bad = () => new Error(`「${word}」：矩阵写 ${o.id}.2,3（第 2 行第 3 列）、${o.id}.r2（第 2 行）或 ${o.id}.c3（第 3 列）`);
    if (mark !== '.') throw bad();
    const size = `${o.id} 是 ${o.rows}×${o.cols} 的`;
    let m = String(sel).match(/^(\d+)[,，](\d+)$/);
    if (m) {
      const r = Number(m[1]), c = Number(m[2]);
      if (r < 1 || r > o.rows) throw new Error(`${size}，没有第 ${r} 行`);
      if (c < 1 || c > o.cols) throw new Error(`${size}，没有第 ${c} 列`);
      return [cellAt(o, r, c)];
    }
    m = String(sel).match(/^([rc])(\d+)(?:-(\d+))?$/);
    if (m) {
      const lo = Math.min(Number(m[2]), Number(m[3] ?? m[2])), hi = Math.max(Number(m[2]), Number(m[3] ?? m[2]));
      const n = m[1] === 'r' ? o.rows : o.cols;
      if (lo < 1 || hi > n) throw new Error(`${size}，没有第 ${hi > n ? hi : lo} ${m[1] === 'r' ? '行' : '列'}`);
      return o.cells.filter((x) => { const k = m[1] === 'r' ? x.r : x.c; return k >= lo && k <= hi; }).sort(sortRC);
    }
    throw bad();
  },
  ref(p) { return `${p.obj}.${p.r},${p.c}`; },
  partBox(o, p) { return cellBox(o, p); },
  objectBox,
  obstacles(o) {
    const L = layout(o);
    // 乘积下面那一条（算一格时写算式的地方）也挡着：不然贴的字摆进去，一算就压上
    return [...o.cells.map((x) => cellBox(o, x, L)), ...decorBoxes(o), ...(o.band ? [bandOf(o)] : [])];
  },
  commands: {
    // rowop m r2 - 3r1：一步（或逗号隔开的几步）初等行变换；每一步的写法贴在它改的那一行右边（op:m、op:m:2……，下一次行变换换掉）
    rowop(scene, c, h) {
      const o = matrixOf(scene, h.words[0], 'rowop');
      const ops = parseOps(rowopText(h), o);
      const done = ops.map((op) => applyOp(o, op));
      o.stairs = false; // 数变了，阶梯线收起（要的话再画一次）
      scene.unlive(o, c.src?.trim() || ''); // 跟着算的做了行变换：就是一个普通的矩阵了（不然依赖一变又算回去，行变换白做），舞台现状里说一声
      delete o.collect; // 收集用的也一样：再放进来会照放过的那几张重算，行变换白做
      delete o.cancelled;
      const id = `op:${o.id}`;
      for (const k of [...scene.labels.keys()]) if (k === id || k.startsWith(`${id}:`)) scene.labels.delete(k);
      const labels = done.map((d, n) => {
        const lid = n ? `${id}:${n + 1}` : id;
        const refs = (d.kind === 'swap' ? [d.i, d.j] : [d.i]).map((k) => `${o.id}.${d.line}${k}`);
        scene.labels.set(lid, { id: lid, refs, text: d.text, side: d.line === 'r' ? 'right' : 'below', tone: 'op', link: null });
        return lid;
      });
      return { id: o.id, ops: done, labels };
    },
    // write m.2,3 5：改一个数
    write(scene, c, h) {
      h.strayRefs();
      const ps = h.partsIn();
      if (ps.length !== 1) throw new Error(`write 一次改一格（写成 write ${ps[0]?.obj || 'm'}.2,3 5）`);
      const x = ps[0];
      const o = scene.objects.get(x.obj);
      const val = h.words.filter((w) => !scene.isRef(w)).at(-1);
      if (val == null) throw new Error('要写成 write m.2,3 新的数');
      const before = x.value;
      setValue(x, numOr(val, 'write ').toString());
      o.stairs = false;
      // 乘积里手写的一格：不再跟着 A、B 重算（老师故意写一个错的给学生找）
      if (o.calc) o.calc = o.calc.filter((k) => k !== x.key);
      // 跟着算的矩阵里手写的一格也一样：这一格不再跟着算
      if (o.live?.whole) o.live.fixed = [...new Set([...(o.live.fixed || []), x.key])];
      else if (o.live?.cells) {
        o.live.cells = o.live.cells.filter((k) => k.key !== x.key);
        if (o.live.cells.length) o.live.deps = unionDeps(o.live.cells); else delete o.live;
      }
      return { cell: x, before };
    },
    // pivot m.1,1：主元框起来（跟着那个数走：交换两行时框也跟过去）
    pivot(scene, c, h) {
      h.strayRefs();
      const ps = h.partsIn();
      if (!ps.length) throw new Error('pivot 后面写要框起来的那一格，比如 pivot m.1,1');
      ps.forEach((x) => { x.pivot = true; });
      return { parts: ps };
    },
    unpivot(scene, c, h) {
      h.strayRefs();
      const ps = h.refsIn().length ? h.partsIn() : [...scene.objects.values()].filter((o) => o.type === 'matrix').flatMap((o) => o.cells);
      ps.forEach((x) => { x.pivot = false; });
      return { parts: ps };
    },
    // stairs m：画阶梯线（要已经是阶梯形）；全为 0 的行跟着淡下去
    stairs(scene, c, h) {
      const o = matrixOf(scene, h.words[0], 'stairs');
      const piv = echelon(o);
      o.stairs = true;
      return { id: o.id, pivots: piv };
    },
    unstairs(scene, c, h) {
      const ids = h.words.length ? [matrixOf(scene, h.words[0], 'unstairs').id] : [...scene.objects.values()].filter((o) => o.type === 'matrix').map((o) => o.id);
      ids.forEach((id) => { scene.objects.get(id).stairs = false; });
      return { ids };
    },
    // mul C.1,2：A 的第 1 行和 B 的第 2 列逐对相乘再相加，写进 C.1,2（mul C.r1、mul C：一格一格算）
    mul(scene, c, h) {
      h.strayRefs();
      const ps = h.partsIn();
      if (!ps.length) throw new Error('mul 后面写算乘积的哪一格（比如 mul C.1,2；mul C 一格一格全算）');
      const o = scene.objects.get(ps[0].obj);
      if (o.type !== 'matrix' || !o.product) throw new Error(`${o.id} 不是乘积（先写 product ${o.id} = A B）`);
      const A = scene.objects.get(o.product.a), B = scene.objects.get(o.product.b);
      if (!A || !B || A.type !== 'matrix' || B.type !== 'matrix') throw new Error(`${o.product.a} 或 ${o.product.b} 已经不在舞台上了`);
      if (A.cols !== B.rows || A.rows !== o.rows || B.cols !== o.cols) throw new Error(`${o.product.a}、${o.product.b} 的尺寸变了，乘不出 ${o.rows}×${o.cols} 的 ${o.id}（重新 product 一次）`);
      // 扣着的格（学生要先猜的）在这一格的算式里：画面把它演成「?」（matrix.view.js 的 mulOne），写给老师的照实说是几、扣着（hidden）
      const hidden = [];
      const note = (m, x) => {
        if (!x?.covered) return;
        const ref = `${m.id}.${x.r},${x.c}`;
        if (!hidden.some((h) => h.ref === ref)) hidden.push({ ref, value: x.value });
      };
      const items = ps.filter((x) => x.obj === o.id).map((x) => {
        const { terms, sum } = productTerms(A, B, x.r, x.c);
        setValue(x, sum);
        if (!o.calc.includes(x.key)) o.calc.push(x.key);
        note(o, x);
        for (const y of rowCells(A, x.r)) note(A, y);
        for (const y of colCells(B, x.c)) note(B, y);
        return { key: x.key, r: x.r, c: x.c, terms, sum };
      });
      return { id: o.id, a: A.id, b: B.id, items, ...(hidden.length ? { hidden } : {}) };
    },
    // put AB Sum：AB 放进收集用的 Sum，Sum 跟着算 {AA + AB}（第一张放进来时 Sum 照它的大小）；学生把 AB 整张拖到 Sum 上就是这一行
    put(scene, c, h) {
      h.strayRefs();
      const [an, sn, ...more] = h.words;
      if (more.length) throw new Error('要写成 put AB Sum（一次放一张）');
      const p = putPlan(scene, an, sn);
      if (p.error) throw new Error(p.error);
      const S = p.S;
      S.collect.terms = p.terms;
      S.live = { line: `matrix ${S.id} = {${p.whole}}`, whole: p.whole, deps: p.deps };
      delete S.cancelled;
      const r = matrix.relive(scene, S);
      // 变了的格交出来（画面闪一下，[跟着变的] 写给老师）
      return { id: S.id, put: { from: an, into: S.id, whole: p.whole }, ...(r.changed.length ? { derived: [{ id: S.id, changed: r.changed, parts: r.parts }] } : {}) };
    },
    // merge X Y：X 并进 Y（同一个矩阵的倍数：{-2 A} 和 {-A} 并成 {(-3) A}），X 拿下舞台（连存档一起清，scene.js 的 dropObject）；并成 0 是 O
    merge(scene, c, h) {
      h.strayRefs();
      const [xn, yn, ...more] = h.words;
      if (more.length) throw new Error('要写成 merge X Y（一次并两张）');
      const p = mergePlan(scene, xn, yn);
      if (p.error) throw new Error(p.error);
      const { X, Y, from, into, to } = p;
      scene.dropObject(X.id);
      Y.live = { line: `matrix ${Y.id} = {${p.whole}}`, whole: p.whole, deps: Y.live.deps };
      const r = matrix.relive(scene, Y);
      if (to.k.zero) Y.cancelled = true; else delete Y.cancelled;
      return { id: Y.id, removed: true, merge: { x: X.id, y: Y.id, from, into, to }, ...(r.changed.length ? { derived: [{ id: Y.id, changed: r.changed, parts: r.parts }] } : {}) };
    },
  },
  // —— 活的舞台：学生能直接动的、跟着算的、拿来判挑战的 ——
  affords: { edit: '点一格，拨里面的数', explain: '点乘积的一格，看它怎么一行乘一列算出来' },
  canOpen(scene, o, action, h) {
    if (action === 'edit' && o.product) throw new Error(`${o.id} 是乘积，数是算出来的：开放 ${o.product.a}、${o.product.b} 的数让学生拨（open ${o.product.b} edit）`);
    if (action === 'explain' && !o.product) throw new Error(`${o.id} 不是乘积：open … explain 写在乘积上（open C explain）`);
    // 乘积的数跟着 A、B 算：学生做一步行变换，同一下就被算回去了
    if (action === 'rowop' && o.product) throw new Error(`${o.id} 是乘积，数跟着 ${o.product.a}、${o.product.b} 算，学生做了行变换也会被算回去：要学生消元就造一个普通的矩阵（matrix M = …）再 open M rowop`);
    // 整张拖（compare / put / merge）：拖的是一整张，写部件没有意义
    if (WHOLE_ACTS.includes(action) && /[.#]/.test(String(h?.words?.[0] ?? ''))) throw new Error(`open … ${action} 写整张矩阵的名字（open ${o.id} ${action}）：学生拖的是一整张`);
    // 收集用的：学生只能往里放（还空着时它也不是跟着算的，这里挡一下）
    if (o.collect && (action === 'edit' || action === 'rowop')) throw new Error(`${o.id} 是收集用的矩阵：学生只能往里放（open AB put，学生把 AB 拖进 ${o.id}）`);
    // 并完 X 连同它上面开着的这一项一起拿下舞台：撤一步的按钮会没声没息地没了，写下时就说
    if (action === 'merge' && h?.opts?.undo === 'on') throw new Error(`merge 会把 ${o.id} 拿下舞台，撤不了：不要写 undo=on`);
  },
  /**
   * 两张整张逐格比（scene.js 的 compare：两头都是整张矩阵）：{ whole, a, b, diff: [{ r, c, a, b }], total, shape }；
   * 不一样大逐格比不了，diff、total 是 null（compareFact 照 shape 说）
   */
  compareWhole(A, B) {
    const shape = { a: [A.rows, A.cols], b: [B.rows, B.cols] };
    if (A.rows !== B.rows || A.cols !== B.cols) return { whole: true, a: A.id, b: B.id, diff: null, total: null, shape };
    const diff = [];
    for (const x of [...A.cells].sort(sortRC)) {
      const y = cellAt(B, x.r, x.c);
      if (String(x.value) !== String(y?.value)) diff.push({ r: x.r, c: x.c, a: x.value, b: y?.value ?? '' });
    }
    return { whole: true, a: A.id, b: B.id, diff, total: A.cells.length, shape };
  },
  /** 算出来的格跟着 A、B 重算：变了的交出来（画面让它闪一下） */
  derive(scene, o) {
    if (!o.product || !o.calc?.length) return [];
    const A = scene.objects.get(o.product.a), B = scene.objects.get(o.product.b);
    if (!A || !B || A.type !== 'matrix' || B.type !== 'matrix' || A.cols !== B.rows || A.rows !== o.rows || B.cols !== o.cols) return [];
    const out = [];
    for (const k of o.calc) {
      const x = o.cells.find((y) => y.key === k);
      if (!x) continue;
      let sum;
      try { ({ sum } = productTerms(A, B, x.r, x.c)); } catch { continue; }
      if (x.value !== sum) { const before = x.value; setValue(x, sum); out.push({ part: x, before, after: sum }); }
    }
    return out;
  },
  /** 依赖图里的结（场景拿来排先后、查环）：乘积跟着它的两个因子 */
  depNodes(o) { return o.product ? [{ id: o.id, deps: [o.product.a, o.product.b] }] : []; },
  /**
   * 跟着算的重算（场景按依赖的先后叫）：在原地改格（画面闪变了的格）；依赖换了尺寸（A、B 重新造成 3×3）就跟着换尺寸。
   * 先全算好再改，算不出来抛错（场景记下来告诉老师，原来的数不动）
   */
  relive(scene, o) {
    const L = o.live;
    const changed = [], parts = [];
    const put = (x, v) => {
      if (x.value === v) return;
      changed.push({ ref: `${o.id}.${x.r},${x.c}`, from: x.value, to: v });
      setValue(x, v);
      parts.push(x);
    };
    if (L.whole) {
      const { rows, deps } = wholeRows(scene, L.whole);
      L.deps = deps;
      if (rows.length !== o.rows || rows[0].length !== o.cols) {
        const was = new Map(o.cells.map((x) => [`${x.r}.${x.c}`, x.value]));
        Object.assign(o, { rows: rows.length, cols: rows[0].length, aug: null, cells: [] });
        L.fixed = [];
        rows.forEach((row, i) => row.forEach((v, k) => {
          const x = newCell(o.id, i + 1, k + 1, v);
          o.cells.push(x);
          if (was.get(x.key) !== v) { changed.push({ ref: `${o.id}.${x.r},${x.c}`, from: was.get(x.key) ?? '', to: v }); parts.push(x); }
        }));
      } else {
        const fixed = new Set(L.fixed || []);
        for (const x of o.cells) if (!fixed.has(x.key)) put(x, rows[x.r - 1][x.c - 1]);
      }
    } else {
      const next = L.cells.map((k) => {
        const r = evalHoles(k.expr, scene);
        if (!isQ(r.value)) throw new Error(`「{${k.expr}}」算出来是${notNumber(r.value)}，格里要一个数`);
        k.deps = r.deps;
        return [o.cells.find((y) => y.key === k.key), r.holes ? '' : r.value.toString()];
      });
      L.deps = unionDeps(L.cells);
      for (const [x, v] of next) if (x) put(x, v);
    }
    if (changed.length) o.stairs = false;
    return { changed, parts };
  },
  /** 舞台现状里写它跟着什么算：S = {A + B}；M.1,2 = {k} */
  liveText(o) {
    const L = o.live;
    const at = (key) => { const x = o.cells.find((y) => y.key === key); return x ? `${o.id}.${x.r},${x.c}` : null; };
    if (L.whole) {
      if (cancelledNow(o)) return `${o.id} = O（并同类项抵消了）`;
      const fixed = (L.fixed || []).map(at).filter(Boolean);
      return `${o.id} = {${L.whole}}${fixed.length ? `（${fixed.join(' ')} 是手写的，不跟着算）` : ''}`;
    }
    return L.cells.map((k) => `${at(k.key)} = {${k.expr}}`).join('，');
  },
  /** 排版时和谁是一体的（reflow 不拿它们比上下）：和 A、B 排成一行的乘积 */
  anchors(o) { return o.product && !o.prefix ? [o.product.a, o.product.b] : []; },
  measure(o) {
    const rows = [];
    for (let r = 1; r <= o.rows; r++) rows.push(rowCells(o, r).map((x) => x.value));
    return { kind: 'matrix', rows };
  },
  // 一句话写现在的样子（存档点 back 以后告诉老师，scene.js 的 summaryOf）：整张 (1 −2; 3 4)，空格子写 _
  summary(o) {
    const rows = [];
    for (let r = 1; r <= o.rows; r++) rows.push(o.cells.filter((x) => x.r === r).sort((a, b) => a.c - b.c).map((x) => String(x.value ?? '')));
    return gridText(rows);
  },
  describe(o) {
    const tag = (x) => {
      const bits = [];
      if (x.paint) bits.push(COLOR_NAMES[x.paint]);
      if (x.glow) bits.push('亮');
      if (x.lift) bits.push('抬起');
      if (x.dim) bits.push('灰');
      if (x.pivot) bits.push('主元框着');
      if (x.covered) bits.push('扣着');
      return `${x.value === '' ? '□' : x.value}${bits.length ? `（${bits.join('、')}）` : ''}`;
    };
    const zero = new Set(zeroRows(o));
    const empty = emptyCollect(o);
    // 收集用的还空着：不写 1×1（那只是一个等着放的空格），写放进第一张以后照它的大小
    const size = empty ? `收集用的，${SIGN_TEXT[o.collect.sign]}；还空着，放进第一张以后照那一张的大小` : `${o.rows}×${o.cols}`;
    const lines = [`矩阵 ${o.id}${o.product ? ` = ${o.product.a} ${o.product.b}` : ''}（${size}${o.aug ? `，增广矩阵：竖线在第 ${o.aug} 列后面` : ''}${o.calc?.length ? `；算出来的 ${o.calc.length} 格跟着 ${o.product.a}、${o.product.b} 自动重算` : ''}）：`];
    for (let r = 1; r <= o.rows; r++) lines.push(`  第 ${r} 行：${rowCells(o, r).map(tag).join('  ')}${zero.has(r) ? '（全为 0）' : ''}`);
    if (o.stairs) lines.push(`  画着阶梯线：非零行 ${o.rows - zero.size} 行`);
    const blank = o.cells.filter((x) => x.value === '').sort(sortRC);
    // 跟着算的空着的格：是用到的东西还有空格子（{A D}、D 还空着），填上了跟着算出来；填上以后算不出来（D 不可逆）的照实说
    const why = o.live?.error ? '（跟着算的：现在算不出来，见下面「跟着算的」那一行）' : '（跟着算的：用到的还有空格子，填上了跟着算出来）';
    if (blank.length && !empty) lines.push(`  还空着：${blank.map((x) => `${o.id}.${x.r},${x.c}`).join(' ')}${o.live ? why : ''}`);
    if (o.collect && !empty) lines.push(`  收集用的（${SIGN_TEXT[o.collect.sign]}）：${o.id} = ${collectSrc(o.collect.sign, o.collect.terms)}；学生只能往里放`);
    // 并同类项并成了 0：整张都是 0 才这样写（老师之后改了一格就不是了）
    if (cancelledNow(o)) lines.push(`  ${o.id} = O（抵消了）`);
    // 方程组（增广、右边一列）：解的样子、每一行读回成方程（矛盾行标出来），老师不用自己数秩、自己读
    const sol = solutionText(o);
    if (sol) lines.push(`  ${sol}`);
    const back = readBack(o);
    if (back.length) lines.push(`  ${back.join('；')}`);
    return lines;
  },
  doc: `矩阵（线代：行变换、消元、秩、乘法）：
matrix m = 1 2 3 / 4 5 6 / 7 8 10   造矩阵（/ 分行；数能写 -3、1/2；| 是增广矩阵的竖线；beside=p 放在 p 右边）
写法：m.2,3 第 2 行第 3 列；m.r2 第 2 行；m.c3 第 3 列
matrix M1 = _ _ | _ / _ _ | _ from=M0 vars="x y"   _ 是空格子（填满以前判断式、量都判不了；跟着它算的 {A M1} 照样挂得上，跟着空格子变的格空着、填上了跟着算）；from=M0：学生每写满一行（配 open M1 edit input=keypad），页面和 M0 比（像哪一步行变换、哪一格不对、同不同解；不判对错）；vars= 未知数的名字（增广矩阵每行在现状里读回成方程，不写是 x1 x2…）
matrix N = 1 {k} / 0 1              格里的 {…} 写算成一个数的式子（{k}、{A.1,2}、{l - 1}），跟着它变；整张就算跟着算的，学生拨不了，只能 open compare / put / merge
matrix S = {A + B}                  整个矩阵跟着算（{A B}、{2A}、{k A}、{A^-1}、{A'}；coef(M) 是增广矩阵竖线左边、rhs(M) 右边一列：{coef(M) P - rhs(M)}）；跟着算的学生拨不了，只能 open compare / put / merge
matrix Sum = collect                收集用的（collect - 是第一张减后面的）：空着是一个空格，put AB Sum 放进一张（学生拖、你写都行）就跟着算 {AA + AB}
rowop m r2 - 3r1                  行变换：r1 的副本乘 -3 飘到 r2 上加进去（也能写 r2 = r2 - 3r1、r3 + 1/2 r1；连着几步用逗号：r2 - 4r1, r3 - 7r1）
rowop m r1 <-> r3                 交换两行（走弧线）
rowop m 3r2                       一行乘倍数（-r1、r2 / 3）；列变换把 r 换成 c
write m.2,3 5                     改一个数
pivot m.1,1 / unpivot m           主元框起来
stairs m / unstairs m             画阶梯线（已经是阶梯形才行），全零行淡下去
product C = A B                   A、B 排成一行，后面「= C」（C 先空着；再写 product C = B A 就在原处换槽翻成 BA）
mul C.1,2                         A 的第 1 行、B 的第 2 列一起亮，逐对相乘再相加，写进 C.1,2（mul C 一格格全算）；算出来的格以后跟着 A、B 自动重算
open B edit range=-3..3           学生点 B 的一格用 ± 拨里面的数（AB、BA 当场跟着变）
open C explain                    学生点乘积的一格，页面当场演它怎么一行乘一列算出来（还空着的就当场算上）
open AB compare                   学生把 AB 整张拖到另一张上 = compare AB BA（逐格比，两张都不变）
open AB put                       学生把 AB 拖进收集用的 Sum = put AB Sum（大小不一样放不进去）
open X merge                      学生把 X 拖到 Y 上并同类项 = merge X Y（只认 数 × 同一个矩阵：{-2 A} 并 {-A} 成 {-3 A}，X 拿下舞台，撤不了、不写 undo=on；并成 0 是 O）；三种都不判对错，同一张只开一种；学生按整张哪儿都拎得起来（格上开着 edit 时按括号）
学生自己消元（rowop 页面判每一下；乘积不能 open rowop）：
open m rowop wrong=mark call=wrong    学生把一行左边的把手拖到另一行上 = 倍加（弹倍数框写 -3：rowop m r2 - 3r1）；拖到行号上 = 对调（rowop m r1 <-> r2）；点行号 = 倍乘（rowop m (-1/2)r1）
open m edit input=keypad          学生点一格用数字键盘写（能写 -3/2；写了 range= 才限范围）= write m.2,3 -3/2（页面不判，告诉你的就是这一行；空格子 _ 都写满了算做完，学生手上没事了就叫你）
判断式（when=）：m stairs（阶梯形）、m rref（行最简形）、m rank=2（整张的秩，增广的是 r(A | b)）、m rankA=2（竖线左边的秩 r(A)）、m same B（和 B 行等价）；量：rank(m)、rankA(m)、free(m)（自由变量几个）、det(m)（方阵）；现状里还写解的样子，跟着拨数的把每个能拨的值扫一遍
做完了 = 成了阶梯形（@m.done 这时演）；往上化成行最简形页面不判对错，要的话写 goal … when="m rref"
ask value "A² 是？" type=matrix answer={A^2} wrong="1 1 / 1 1=逐格平方了"     学生写一张矩阵（行用「 / 」或 ; 隔开，1/3 是一格分数），页面照 A 现算答案
ask value "Aⁿ 是？" type=matrix free=n answer="1 n n(n-1)/2 / 0 1 n / 0 0 1"     每格是含 n 的式子：学生一格一个式子框，页面逐格代 n 判，哪一格不对告诉你（学生只看到整张对不对）；一列（一行）的通解加 solve=on（free=k solve=on answer="-2+4k / 1-k / k"）按集合判：换了参数、特解的同一条线也对
answer={A B}、{A^2}、{3 A}、{A^-1}、{A'} 时页面自己认乘反、逐格乘方、只乘一行或一格、逐格取倒数或没除以行列式、没转置，对上了告诉你（你写的 wrong= 先比）`,
  // 测试用（tests/stage-doc.test.js）：说明里 stairs 那一行要一个已经是阶梯形的矩阵；from= 那一行要 M0；整张拖的三行要 AB、BA、Sum、X、Y
  docSetup: 'matrix m = 1 2 3 / 0 1 4 / 0 0 1\nmatrix M0 = 1 2 | 3 / 2 4 | 7\nmatrix A = 1 2 / 3 4\nmatrix B = 0 1 / 1 0\nmatrix AB = {A B}\nmatrix BA = {B A}\nmatrix Sum = collect\nmatrix X = {-2 A}\nmatrix Y = {-A}',
  example: `matrix A = 1 1 / -1 -1
matrix B = 1 -1 / -1 1 beside=A
product C = A B
mul C.1,1
say "{C.1,1} 是 A 的第 1 行乘 B 的第 1 列。剩下三格你来：点一格，看它怎么算出来。"
open C explain
goal g1 "点出 AB 剩下的三格" when="C = O"
@g1 say "A、B 都不是 O，乘出来却是 O。"
@g1 open B edit range=-3..3
@g1 goal g2 "改 B 里的一个数，让 AB 不再是 O" when="C != O"
`,
};

export { setValue, matrixOf, lineOf };
