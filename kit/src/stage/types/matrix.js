// 舞台上的矩阵（线代：初等行变换、消元求秩和解方程组、矩阵乘法「行乘列」）：数据和指令，不碰 DOM（画法在 matrix.view.js）。
// 纯函数，有测试（tests/stage-matrix.test.js）。照 array.js 的样子写（docs/stage-types.md）。
//
// 数都是精确分数（exact.js 的 Q）：场景里存成字符串（'-3/2'；'' 是乘积里还空着的格），副本（structuredClone）不丢东西，算的时候再变回 Q。
// 一格（部件）的 key 是造它时的位置（'2.3'），交换两行时格子带着数走过去（r、c 跟着变）；m.2,3 永远指「现在」第 2 行第 3 列。
// 跟着算的（value.js）：格里写算成一个数的式子（{k}、{A.1,2}、{l - 1}），或者整个矩阵写 = {A + B}、{P^-1}；依赖一变场景叫 relive，在原地改格。
// 格里写 _ 是空着的一格（matrix D = _ _ / _ _：等学生填的空牌，填满以前判断式、量都判不了）。
import { Q, isQ, isQVec, isQMat } from '../../exact.js';

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
/** 每一列多宽（从 1 数）：这一列最长的那个数定 */
export function colWidths(o) {
  const w = Array(o.cols + 1).fill(MX.MINW);
  w[0] = 0;
  for (const x of o.cells) w[x.c] = Math.max(w[x.c], Math.ceil(textWidth(x.value) + 22));
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
/** 算出来的值 → 每一行的数（字符串）：矩阵照写，向量是一列；一个数不行 */
function rowsOfValue(v, src) {
  if (isQ(v)) throw new Error(`「{${src}}」算出来是数 ${v}，不是矩阵（要一格跟着算，写 matrix M = 1 {k} / 0 1）`);
  const rows = isQMat(v) ? v.map((r) => r.map(String)) : isQVec(v) ? v.map((x) => [String(x)]) : null;
  if (!rows) throw new Error(`「{${src}}」算出来的不是矩阵`);
  if (rows.length > MAX_ROWS || rows[0].length > MAX_COLS) throw new Error(`「{${src}}」算出来是 ${rows.length}×${rows[0].length}，舞台上的矩阵最多 ${MAX_ROWS} 行 ${MAX_COLS} 列`);
  return rows;
}
// 格里的 {…} 写算成一个数的式子（{k}、{A.1,2}、{l - 1}、{2 k}、{det(A)}）：一格里是一个数；算出来是矩阵、向量照实说
// （第一轮只认拨数的名字或一格；放宽以后旧写法一个不少，旧课照样放回）
const notNumber = (v) => (isQMat(v) ? '矩阵' : isQVec(v) ? '向量' : '别的');
function cellLive(h, src) {
  const { value, deps } = h.liveValue(src);
  if (!isQ(value)) throw new Error(`「{${src}}」算出来是${notNumber(value)}，格里要一个数`);
  return { value: value.toString(), deps };
}
/**
 * 写了 {…} 的矩阵：整个 = {A + B} 是 { rows, live: { whole, deps } }；格里的 {k} 是 { rows, aug, live: { cells: [{ key, expr, deps }], deps } }
 */
function liveRows(h, text) {
  const { parts } = h.parseLive(text);
  const exprs = parts.filter((p) => p.k === 'expr');
  if (exprs.length === 1 && parts.every((p) => p.k === 'expr' || !p.v.trim())) {
    const src = exprs[0].v;
    const { value, deps } = h.liveValue(src);
    return { rows: rowsOfValue(value, src), aug: null, live: { line: h.line, whole: src, deps } };
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

// product C = A B：A、B 排成一行（A 留在原处、B 挪到 A 右边），后面「= C」，三个上下居中；C 的格先空着
function makeProduct(scene, c, h) {
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
  const cx = ba.x + sa.w / 2, cy = ba.y + Math.max(sa.h, sb.h) / 2;
  const left = Math.round(cx - total / 2);
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

export const matrix = {
  type: 'matrix',
  label: '矩阵',
  create: ['matrix', 'product'],
  drag: false,
  hint: '（矩阵：名字.2,3 是第 2 行第 3 列，名字.r2 是第 2 行，名字.c3 是第 3 列；交换两行时数跟着走，名字.2,3 指的总是现在的第 2 行第 3 列）',
  make(scene, c, h, old) {
    if (c.cmd === 'product') {
      if (h.words.some((w) => /[{}]/.test(w))) throw new Error('product 里不写 {…}：要跟着算就写 matrix C = {A B}');
      return makeProduct(scene, c, h);
    }
    if (!h.args.some((a) => a.t === 'eq')) throw new Error('要写成 matrix 名字 = 1 2 / 3 4（/ 分行）');
    const id = h.words[0];
    const words = h.words.slice(1);
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
      const items = ps.filter((x) => x.obj === o.id).map((x) => {
        const { terms, sum } = productTerms(A, B, x.r, x.c);
        setValue(x, sum);
        if (!o.calc.includes(x.key)) o.calc.push(x.key);
        return { key: x.key, r: x.r, c: x.c, terms, sum };
      });
      return { id: o.id, a: A.id, b: B.id, items };
    },
  },
  // —— 活的舞台：学生能直接动的、跟着算的、拿来判挑战的 ——
  affords: { edit: '点一格，拨里面的数', explain: '点乘积的一格，看它怎么一行乘一列算出来' },
  canOpen(scene, o, action) {
    if (action === 'edit' && o.product) throw new Error(`${o.id} 是乘积，数是算出来的：开放 ${o.product.a}、${o.product.b} 的数让学生拨（open ${o.product.b} edit）`);
    if (action === 'explain' && !o.product) throw new Error(`${o.id} 不是乘积：open … explain 写在乘积上（open C explain）`);
    // 乘积的数跟着 A、B 算：学生做一步行变换，同一下就被算回去了
    if (action === 'rowop' && o.product) throw new Error(`${o.id} 是乘积，数跟着 ${o.product.a}、${o.product.b} 算，学生做了行变换也会被算回去：要学生消元就造一个普通的矩阵（matrix M = …）再 open M rowop`);
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
      const { value, deps } = scene.liveValue(L.whole);
      const rows = rowsOfValue(value, L.whole);
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
        const r = scene.liveValue(k.expr);
        if (!isQ(r.value)) throw new Error(`「{${k.expr}}」算出来是${notNumber(r.value)}，格里要一个数`);
        k.deps = r.deps;
        return [o.cells.find((y) => y.key === k.key), r.value.toString()];
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
    const lines = [`矩阵 ${o.id}${o.product ? ` = ${o.product.a} ${o.product.b}` : ''}（${o.rows}×${o.cols}${o.aug ? `，增广矩阵：竖线在第 ${o.aug} 列后面` : ''}${o.calc?.length ? `；算出来的 ${o.calc.length} 格跟着 ${o.product.a}、${o.product.b} 自动重算` : ''}）：`];
    for (let r = 1; r <= o.rows; r++) lines.push(`  第 ${r} 行：${rowCells(o, r).map(tag).join('  ')}${zero.has(r) ? '（全为 0）' : ''}`);
    if (o.stairs) lines.push(`  画着阶梯线：非零行 ${o.rows - zero.size} 行`);
    const blank = o.cells.filter((x) => x.value === '').sort(sortRC);
    if (blank.length) lines.push(`  还空着：${blank.map((x) => `${o.id}.${x.r},${x.c}`).join(' ')}`);
    return lines;
  },
  doc: `矩阵（线代：行变换、消元、秩、乘法）：
matrix m = 1 2 3 / 4 5 6 / 7 8 10   造矩阵（/ 分行；数能写 -3、1/2；| 是增广矩阵的竖线；beside=p 放在 p 右边）
写法：m.2,3 第 2 行第 3 列；m.r2 第 2 行；m.c3 第 3 列
matrix N = 1 {k} / 0 1              格里的 {…} 写算成一个数的式子（{k}、{A.1,2}、{l - 1}），跟着它变；整张就算跟着算的，学生 open 不了
matrix S = {A + B}                  整个矩阵跟着算（{A B}、{2A}、{k A}、{A^-1}、{A'}）；跟着算的学生动不了
rowop m r2 - 3r1                  行变换：r1 的副本乘 -3 飘到 r2 上加进去（也能写 r2 = r2 - 3r1、r3 + 1/2 r1；连着几步用逗号：r2 - 4r1, r3 - 7r1）
rowop m r1 <-> r3                 交换两行（走弧线）
rowop m 3r2                       一行乘倍数（-r1、r2 / 3）；列变换把 r 换成 c
write m.2,3 5                     改一个数
pivot m.1,1 / unpivot m           主元框起来
stairs m / unstairs m             画阶梯线（已经是阶梯形才行），全零行淡下去
product C = A B                   A、B 排成一行，后面「= C」（C 先空着）
mul C.1,2                         A 的第 1 行、B 的第 2 列一起亮，逐对相乘再相加，写进 C.1,2（mul C 一格格全算）；算出来的格以后跟着 A、B 自动重算
open B edit range=-3..3           学生点 B 的一格用 ± 拨里面的数（AB、BA 当场跟着变）
open C explain                    学生点乘积的一格，页面当场演它怎么一行乘一列算出来（还空着的就当场算上）
学生自己消元（rowop 页面判每一下；乘积不能 open rowop）：
open m rowop wrong=mark call=wrong    学生把一行左边的把手拖到另一行上 = 倍加（弹倍数框写 -3：rowop m r2 - 3r1）；拖到行号上 = 对调（rowop m r1 <-> r2）；点行号 = 倍乘（rowop m (-1/2)r1）
open m edit input=keypad          学生点一格用数字键盘写（能写 -3/2；写了 range= 才限范围）= write m.2,3 -3/2（页面不判，告诉你的就是这一行）
判断式（when=）：m stairs（阶梯形）、m rref（行最简形）、m rank=2（整张的秩，增广的是 r(A | b)）、m rankA=2（竖线左边的秩 r(A)）、m same B（和 B 行等价）
做完了 = 成了阶梯形（@m.done 这时演）；往上化成行最简形页面不判对错，要的话写 goal … when="m rref"
ask value "A² 是？" type=matrix answer={A^2} wrong="1 1 / 1 1=逐格平方了"     学生写一张矩阵（行用「 / 」或 ; 隔开，1/3 是一格分数），页面照 A 现算答案`,
  // 测试用（tests/stage-doc.test.js）：说明里 stairs 那一行要一个已经是阶梯形的矩阵
  docSetup: 'matrix m = 1 2 3 / 0 1 4 / 0 0 1',
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
