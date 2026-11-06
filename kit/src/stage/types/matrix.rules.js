// 矩阵（消元）的规则（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1 节）：从现在的样子算消成阶梯形的下一步、
// 判一下像哪种错、挑战用的判断式、写给老师的事实、手势表，和 engines/elim.js 对拍。
// 纯函数，有测试（tests/stage-matrix-rules.test.js）；在 types/index.js 里登记。
//
// 消元的顺序照 elim.js：从左往右找主元列，主元行取当前行往下第一个不是 0 的。学生走偏几下以后也从现在的样子这样算。
// 一列「消好了」：当前行这一格不是 0、下面全是 0（这就是主元，当前行往下挪一行），或者当前行往下全是 0（这一列没有主元，跳过）。
// 第一列没消好的就是现在要做的，可接受的下一步（next 的 acts 一次全给，check 认其中任何一个）：
//   - 把主元下面一个不是 0 的格消成 0 的倍加。先消哪一格都行；拿主元那一行加，或者拿下面这一列也不是 0 的别的行加都行——
//     当前行往下的几行在前面消好的列上全是 0，加过来弄不乱前面。两行都乘一下的写法（2r2 − 3r1，免得出分数）check 也认；
//   - 换一行这一列不是 0 的上来当主元（主元那一格是 0 时只能这样）；
//   - 把主元化成 1 的倍乘。
// 增广矩阵先只在竖线左边找主元，整行一起变。左边消完了、右边还不是阶梯形（无解的方程组：0 = 1、0 = 2 两行）时，
// 接着在右边那一列消：这样 next 走完就是 stairs（matrix.js 的 echelon 看整张），「做完」和挑战的「M stairs」是一回事。
// 已经是阶梯形以后不判（老师可能要接着化成行最简形），只有把阶梯形弄乱了才算错。
// 交出去的动作里的数写成字符串（和 matrix.js 场景里存的一样）：存进记录、发给老师时 JSON 不丢东西；收的时候 Q 和字符串都认。
import { Q, rrefOf } from '../../exact.js';
import { parseOps, opText, echelon, zeroRows, toQ } from './matrix.js';

const ONE = new Q(1n);
const isOne = (q) => q.n === 1n && q.d === 1n;
const isNegOne = (q) => q.n === -1n && q.d === 1n;
const num = (q) => String(q).replace(/-/g, '−');
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const rowName = (i) => `r${String(i + 1).replace(/\d/g, (d) => SUBS[d])}`; // 第 i 行（从 0 数）照课本写成 r₃

// —— 现在的数 ——

/** 按现在的位置（从 0 数）一格一个 Q；还空着的格（乘积里没算的）是 null */
function gridOf(o) {
  const G = Array.from({ length: o.rows }, () => Array(o.cols).fill(null));
  for (const x of o.cells) G[x.r - 1][x.c - 1] = x.value === '' ? null : toQ(x.value);
  return G;
}
/** 规则这边算的东西：名字、尺寸、竖线左边几列（不是增广就是整张）、数 */
const modelOf = (o) => ({ id: o.id, rows: o.rows, cols: o.cols, ncoef: o.aug ?? o.cols, aug: o.aug ?? null, G: gridOf(o) });
const hasBlank = (G) => G.some((r) => r.some((x) => x == null));
const filled = (o) => o.cells.every((x) => x.value !== '');
const cellName = (md, i, c) => `${md.id}.${i + 1},${c + 1}`;
const cellVal = (md, i, c) => `${cellName(md, i, c)} = ${num(md.G[i][c])}`;

// —— 一步行变换 ——

// 收进来的一步：parseOps 的结果（数是 Q），也认数写成字符串的（next 交出去的、存过一遍的）
function asQ(x, what) {
  if (x == null || x === '') return null;
  if (x instanceof Q) return x;
  if (typeof x === 'object' && typeof x.n === 'bigint' && typeof x.d === 'bigint') return new Q(x.n, x.d);
  const q = toQ(x);
  if (!q) throw new Error(`${what}「${x}」不是数`);
  return q;
}
function norm(p) {
  const kind = p?.kind;
  const two = kind === 'add' || kind === 'comb';
  return {
    line: p?.line === 'c' ? 'c' : 'r', kind,
    i: Number(p?.i), j: p?.j == null ? null : Number(p.j),
    a: kind === 'swap' ? null : asQ(p.a, '倍数') ?? ONE,
    b: two ? asQ(p.b, '倍数') : null,
  };
}
/** 动作里的那几步（act.op 是 parseOps 的结果、一步，或者一行字 r2 - r1）；读不懂抛错 */
function opsOf(o, act) {
  const raw = typeof act.op === 'string' ? parseOps(act.op, o) : [].concat(act.op ?? []);
  if (!raw.length) throw new Error(`rowop 后面写一步行变换，比如 rowop ${o.id} r2 - 3r1`);
  return raw.map(norm);
}
/** 交出去的一步：和 parseOps 的样子一样，数写成字符串 */
const plain = (op) => ({ line: op.line, kind: op.kind, i: op.i, j: op.j ?? null, a: op.kind === 'swap' ? null : String(op.a), b: op.b ? String(op.b) : null });
const toAct = (op) => ({ type: 'rowop', op: [plain(op)] });
const mkSwap = (i, j) => ({ line: 'r', kind: 'swap', i: i + 1, j: j + 1, a: null, b: null });
const mkAdd = (i, j, k) => ({ line: 'r', kind: 'add', i: i + 1, j: j + 1, a: ONE, b: k });
const mkScale = (i, k) => ({ line: 'r', kind: 'scale', i: i + 1, j: null, a: k, b: null });

/** 这一步在这个世界里做不做得到（初等变换的定义、行号、读得到数）：做不到的说为什么，做得到是 null */
function illegal(md, op) {
  const L = op.line === 'c' ? '列' : '行';
  const n = op.line === 'c' ? md.cols : md.rows;
  if (!['swap', 'scale', 'add', 'comb'].includes(op.kind)) return '看不懂这一步行变换（写成 r2 - 3r1、r1 <-> r2、3r2）';
  const used = op.kind === 'scale' ? [op.i] : [op.i, op.j];
  for (const k of used) if (!(Number.isInteger(k) && k >= 1 && k <= n)) return `${md.id} 只有 ${n} ${L}，没有 ${op.line}${k}`;
  if (op.kind !== 'scale' && op.i === op.j) return `${op.line}${op.i} 和自己${op.kind === 'swap' ? '对调' : '相加'}不是初等变换`;
  if (op.kind !== 'swap' && op.a.zero) return `一${L}乘 0 不是初等变换（这一${L}的数全成了 0，变不回去，解也跟着变了）`;
  if (op.kind === 'scale' && isOne(op.a)) return `${op.line}${op.i} 乘 1 什么也没变`;
  if (op.kind !== 'swap' && op.kind !== 'scale' && (!op.b || op.b.zero)) return '加上 0 倍什么也没变';
  // 还空着的格读不了：倍乘读自己那一行（列），倍加还读加过来的那一行（列）
  if (op.kind !== 'swap') {
    const read = op.kind === 'scale' ? [op.i] : [op.i, op.j];
    for (const k of read) {
      const at = op.line === 'r' ? md.G[k - 1].findIndex((x) => x == null) : md.G.findIndex((r) => r[k - 1] == null);
      if (at >= 0) return `${op.line === 'r' ? cellName(md, k - 1, at) : cellName(md, at, k - 1)} 还空着`;
    }
  }
  return null;
}

const T = (G) => G[0].map((_, j) => G.map((r) => r[j]));
function applyRows(G, op) {
  const H = G.map((r) => r.slice());
  const i = op.i - 1, j = op.j - 1;
  if (op.kind === 'swap') [H[i], H[j]] = [H[j], H[i]];
  else if (op.kind === 'scale') H[i] = H[i].map((x) => x.mul(op.a));
  else H[i] = H[i].map((x, c) => x.mul(op.a).add(G[j][c].mul(op.b)));
  return H;
}
/** 做一步（不改原来的）：第 i 行 ← a·第 i 行 + b·第 j 行；列变换转过来做 */
const applyGrid = (G, op) => (op.line === 'c' ? T(applyRows(T(G), op)) : applyRows(G, op));
const withGrid = (md, G) => ({ ...md, G });

// —— 消到哪了 ——

/**
 * 从左往右一列一列看：{ pivots（消好的主元 [行, 列]，从 0 数）, r（现在的行）, c（现在的列）, nz（这一列从 r 往下不是 0 的行）,
 * right（在竖线右边） }；已经是阶梯形给 null。要先确定没有空着的格
 */
function plan(md) {
  const { G } = md;
  const pivots = [];
  let r = 0;
  for (let c = 0; c < md.cols && r < md.rows; c++) {
    const nz = [];
    for (let i = r; i < md.rows; i++) if (!G[i][c].zero) nz.push(i);
    if (!nz.length) continue;
    if (nz.length === 1 && nz[0] === r) { pivots.push([r, c]); r++; continue; }
    return { pivots, r, c, nz, right: c >= md.ncoef };
  }
  return null;
}
// 消到第几列了（阶梯形是无穷远）：一步以后这个数变小了，就是把前面消好的列弄乱了
const reach = (pl) => (pl ? pl.c : Infinity);

/** 所有可接受的下一步（先是页面挑的那一下：主元那一格不是 0 就消下面第一格，是 0 就换第一个不是 0 的上来） */
function actsOf(md, pl) {
  const { G } = md;
  const { r, c, nz } = pl;
  const p = G[r][c];
  const swaps = nz.filter((i) => i !== r).map((i) => mkSwap(r, i));
  const targets = nz.filter((i) => i > r);
  const sources = p.zero ? nz : [r, ...nz.filter((i) => i !== r)]; // 拿主元那一行加的在前
  const elims = [];
  for (const j of sources) for (const i of targets) if (i !== j) elims.push(mkAdd(i, j, G[i][c].div(G[j][c]).neg()));
  if (p.zero) return [...swaps, ...elims];
  return [...elims, ...swaps, ...(isOne(p) ? [] : [mkScale(r, ONE.div(p))])];
}

/** 这一步是不是可接受的下一步（按做出来的样子认：两行都乘一下的写法、写成一行字的都认） */
function acceptable(md, pl, op) {
  if (op.line !== 'r') return false;
  const { G } = md;
  const { r, c, nz } = pl;
  const i = op.i - 1, j = op.j - 1;
  if (op.kind === 'swap') return (i === r && j > r && nz.includes(j)) || (j === r && i > r && nz.includes(i));
  if (op.kind === 'scale') return i === r && !G[r][c].zero && isOne(G[r][c].mul(op.a));
  return i > r && nz.includes(i) && j >= r && nz.includes(j) && i !== j && G[i][c].mul(op.a).add(G[j][c].mul(op.b)).zero;
}

// —— 话 ——

function planWhy(md, pl) {
  const { r, c, nz } = pl;
  const p = md.G[r][c];
  const acts = actsOf(md, pl);
  const where = pl.right ? `竖线左边已经是阶梯形了，右边那一列（第 ${c + 1} 列）` : `第 ${c + 1} 列`;
  if (p.zero) {
    const more = nz.length > 1 ? `（换 ${nz.slice(1).map(rowName).join('、')} 上来也行；下面几行之间先消也行）` : '';
    return `${where}：${cellName(md, r, c)} 是 0，下面 ${cellVal(md, nz[0], c)} 不是 0，先换上来：${opText(acts[0])}${more}`;
  }
  const targets = nz.filter((i) => i > r);
  const also = [
    targets.length > 1 ? '先消哪一格都行' : '',
    '换别的这一列不是 0 的行当主元也行',
    isOne(p) ? '' : '先把主元化成 1 也行',
  ].filter(Boolean);
  return `${where}：主元是 ${cellVal(md, r, c)}，下面的 ${targets.map((i) => cellVal(md, i, c)).join('、')} 要消成 0；先 ${opText(acts[0])}（${also.join('；')}）`;
}

/** check 的 next：「现在正确的是……」（裁判拼「你在 …，现在正确的是 …」） */
function nowRight(md) {
  if (hasBlank(md.G)) return { why: '还有空着的格，页面算不了下一步', acts: [] };
  const pl = plan(md);
  if (!pl) return { why: '已经是阶梯形了', acts: [] };
  return { why: planWhy(md, pl), acts: actsOf(md, pl).map(toAct) };
}

function next(o) {
  const md = modelOf(o);
  if (hasBlank(md.G)) return null; // 乘积还没算完：没有消元这回事
  const pl = plan(md);
  return pl ? { acts: actsOf(md, pl).map(toAct), why: planWhy(md, pl) } : null;
}

/** 弄乱了哪一列：那一列原来是 0、现在不是 0 的格 */
function messText(md, G1, col) {
  const moved = [];
  for (let i = 0; i < md.rows; i++) if (md.G[i][col].zero && !G1[i][col].zero) moved.push(`${cellName(md, i, col)} 从 0 变成了 ${num(G1[i][col])}`);
  return `把已经消好的那一列又弄乱了：第 ${col + 1} 列${moved.length ? `的 ${moved.join('、')}` : '的主元被换走了'}`;
}

// 不是可接受的下一步：像哪种错（docs/superpowers/plans/2026-11-06-stage-base.md 第 6 个任务的表；认不出来的给 null）
function misreadOf(md, pl, op, G1) {
  const after = plan(withGrid(md, G1));
  if (reach(after) < reach(pl)) return messText(md, G1, after.c);
  if (!pl || op.line !== 'r' || (op.kind !== 'add' && op.kind !== 'comb')) return null;
  const { r, c, nz } = pl;
  const i = op.i - 1, j = op.j - 1;
  // 拿一行这一列不是 0 的去消下面一格不是 0 的：配对是对的，倍数不对
  if (!(i > r && nz.includes(i) && j >= r && nz.includes(j) && i !== j)) return null;
  const x = md.G[i][c], y = md.G[j][c];
  const want = { ...op, b: x.mul(op.a).div(y).neg() };
  const aim = `要把 ${cellVal(md, i, c)} 消成 0，是 ${opText(want)}`;
  if (x.mul(op.a).sub(y.mul(op.b)).zero) return `符号反了：${aim}，不是 ${opText(op)}`;
  return `倍数不对，这一格消不成 0：${opText(op)} 以后 ${cellName(md, i, c)} 是 ${num(G1[i][c])}；${aim}`;
}

// —— 判一下 ——

function check(o, act) {
  if (act?.type !== 'rowop') return { legal: true, right: null }; // 改一格（write）这些不判
  let md = modelOf(o);
  let ops;
  try {
    ops = opsOf(o, act);
  } catch (e) {
    return { legal: false, right: false, misread: null, why: e.message, next: nowRight(md) };
  }
  const why = ops.map((op) => opText(op)).join('，');
  let anyRight = false, wrongAt = null, misread = null;
  // 连着几步（r2 - r1, r3 - r1）：一步一步从做完上一步的样子判，每一步都对才对；错在哪一步，「现在正确的」就从那里算
  for (const op of ops) {
    const bad = illegal(md, op);
    if (bad) return { legal: false, right: false, misread: null, why: bad, next: nowRight(md) };
    const G1 = applyGrid(md.G, op);
    if (op.line === 'r' && !hasBlank(md.G)) {
      const pl = plan(md);
      if (pl && acceptable(md, pl, op)) anyRight = true;
      else {
        const m = misreadOf(md, pl, op, G1);
        // 已经是阶梯形了：往下化行最简形不判，只有弄乱了才是错
        if ((pl || m) && !wrongAt) { wrongAt = md; misread = m; }
      }
    }
    md = withGrid(md, G1);
  }
  if (wrongAt) return { legal: true, right: false, misread, why, next: nowRight(wrongAt) };
  return { legal: true, right: anyRight ? true : null, misread: null, why, next: null };
}

// —— 写给老师的事实 ——

/** 一行（列）写出来：(0 −2 −4 | −2)；列写成 (…)ᵀ */
function lineText(md, op, G1) {
  if (op.line === 'c') return `(${G1.map((r) => num(r[op.i - 1])).join(' ')})ᵀ`;
  const row = G1[op.i - 1].map(num);
  return `(${md.aug ? `${row.slice(0, md.aug).join(' ')} | ${row.slice(md.aug).join(' ')}` : row.join(' ')})`;
}
function stepFact(md, op, G1) {
  const L = op.line === 'c' ? '列' : '行';
  const t = opText(op);
  if (op.kind === 'swap') return `${t}：第 ${op.i}、${op.j} ${L}对调`;
  const shown = lineText(md, op, G1);
  if (op.kind === 'scale') return `${t}：第 ${op.i} ${L}乘 ${num(op.a)}，变成 ${shown}`;
  const times = isOne(op.a) ? '' : `乘 ${num(op.a)}、再`;
  return `${t}：第 ${op.i} ${L}${times}加上第 ${op.j} ${L}的 ${num(op.b)} 倍，变成 ${shown}`;
}
/** 现在离阶梯形还差什么（是阶梯形了就说非零行几行、主元在哪、哪几行全是 0） */
function statusFact(o, md, pl) {
  if (!pl) {
    const piv = echelon(o);
    const zero = zeroRows(o);
    return `现在是阶梯形了：非零行 ${piv.length} 行（主元 ${piv.map((p) => `${o.id}.${p.r},${p.c}`).join('、') || '没有'}）${zero.length ? `；全为 0 的行：第 ${zero.join('、')} 行` : ''}`;
  }
  const { r, c, nz } = pl;
  const where = pl.right ? `竖线左边已经是阶梯形了，右边那一列（第 ${c + 1} 列）` : `第 ${c + 1} 列`;
  if (md.G[r][c].zero) return `还不是阶梯形：${where}的 ${cellName(md, r, c)} 是 0，要先把下面不是 0 的一行换上来（${nz.map((i) => cellVal(md, i, c)).join('、')}）`;
  return `还不是阶梯形：${where}主元 ${cellVal(md, r, c)} 下面还有 ${nz.filter((i) => i > r).map((i) => cellVal(md, i, c)).join('、')} 要消成 0`;
}

function facts(before, after, act) {
  if (!before || !after || act?.type !== 'rowop') return [];
  let ops;
  try { ops = opsOf(before, act); } catch { return []; }
  const md0 = modelOf(before);
  const out = [];
  let md = md0;
  for (const op of ops) {
    if (illegal(md, op)) return out;
    const G1 = applyGrid(md.G, op);
    out.push(stepFact(md, op, G1));
    md = withGrid(md, G1);
  }
  // 现在的样子照场景里真的那一张算
  const now = modelOf(after);
  if (hasBlank(md0.G) || hasBlank(now.G)) return out;
  const p0 = plan(md0), p1 = plan(now);
  if (reach(p1) < reach(p0)) out.push(messText(md0, now.G, p1.c));
  out.push(statusFact(after, now, p1));
  return out;
}

// —— 手势表（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）——

// 一步写成舞台上的写法（matrix.js 的 parseOps、elim.js 的 parseOps 都读得懂）：r3 - 2r1、r2 + (1/2)r1、r1 <-> r3、-3r2、r2 / 2、(-1/2)r2、2r2 - 3r1
const coefSrc = (q) => (isOne(q) ? '' : q.integer ? `${q}` : `(${q})`);
function opSrc(op) {
  const at = (k) => `${op.line}${k}`;
  if (op.kind === 'swap') return `${at(op.i)} <-> ${at(op.j)}`;
  const a = op.a;
  if (op.kind === 'scale') {
    if (isNegOne(a)) return `-${at(op.i)}`;
    if (a.n === 1n && a.d > 1n) return `${at(op.i)} / ${a.d}`;
    return `${a.integer ? a : `(${a})`}${at(op.i)}`;
  }
  const neg = op.b.n < 0n;
  const lead = isOne(a) ? '' : isNegOne(a) ? '-' : a.integer ? `${a}` : `(${a})`;
  return `${lead}${at(op.i)} ${neg ? '-' : '+'} ${coefSrc(neg ? op.b.neg() : op.b)}${at(op.j)}`;
}

/** 一个动作 → 学生那一行镜头指令 */
export function actSrc(o, act) {
  if (act.type === 'rowop') {
    const ops = typeof act.op === 'string' ? parseOps(act.op, o) : [].concat(act.op);
    return `rowop ${o.id} ${ops.map((p) => opSrc(norm(p))).join(', ')}`;
  }
  if (act.type === 'write') return `write ${o.id}.${act.r},${act.c} ${act.value}`;
  throw new Error(`矩阵没有「${act.type}」这个动作`);
}
const made = (o, op) => { const act = toAct(op); return { act, src: actSrc(o, act) }; };

// 手势里的部件：一行（行左边的把手、那一行本身，或者那一行的一格）写 { row: 3 }（一格 { r: 3, c: 1 } 也算第 3 行）；行号写 { label: 3 }
const rowOf = (x) => (x?.row ?? x?.r ?? null);
const labelOf = (x) => x?.label ?? null;
const blank = (v) => v == null || String(v).trim() === '';

function rowopAct(o, { from, to, value } = {}) {
  const ok = (k) => Number.isInteger(k) && k >= 1 && k <= o.rows;
  const k = blank(value) ? null : toQ(value);
  const notNum = () => ({ error: `倍数「${value}」不是数（写成 3、-2、1/2）` });
  if (from && to) {
    const src = rowOf(from) ?? labelOf(from);
    if (!ok(src)) return { error: '从一行左边的把手拖起' };
    const lab = labelOf(to);
    if (lab != null) {
      if (!ok(lab)) return { error: `${o.id} 只有 ${o.rows} 行` };
      if (lab === src) return { error: '拖到另一行的行号上，两行对调' };
      return made(o, mkSwap(src - 1, lab - 1));
    }
    const tgt = rowOf(to);
    if (!ok(tgt)) return { error: '拖到另一行上是倍加，拖到行号上是两行对调' };
    if (tgt === src) return { error: `拖到另一行上：r${src} 加到自己身上不是初等变换` };
    if (blank(value)) return { error: `r${src} 加到 r${tgt} 上：要写倍数 k（r${tgt} + k·r${src}）` };
    if (!k) return notNum();
    if (k.zero) return { error: '加 0 倍什么也没变' };
    return made(o, mkAdd(tgt - 1, src - 1, k));
  }
  // 点行号：倍乘（乘 0 也交出去：裁判判 legal: false，这个世界的物理，记一笔给老师）
  const x = from || to;
  const row = labelOf(x) ?? rowOf(x);
  if (!ok(row)) return { error: '点一行的行号，再写乘几' };
  if (blank(value)) return { error: `r${row} 乘几？要写倍数` };
  if (!k) return notNum();
  if (isOne(k)) return { error: `r${row} 乘 1 什么也没变` };
  return made(o, mkScale(row - 1, k));
}

const gestures = {
  // 行的把手拖到另一行上：倍加（弹出倍数框，value 是框里写的 k，翻成 rowop M r3 + k r1）；拖到行号上：两行对调（rowop M r1 <-> r3）；
  // 点行号：倍乘（倍数框，rowop M k r2）
  rowop: { gesture: ['drop-on', 'tap'], from: 'row', to: ['row', 'label'], tap: 'label', toAct: rowopAct },
  // 点一格写一个数（open M edit input=keypad 时是数字键盘；能写分数、负数）
  edit: {
    gesture: 'write', on: 'cell',
    toAct(o, { to, from, value } = {}) {
      const x = to || from;
      const r = x?.r, c = x?.c;
      if (!(Number.isInteger(r) && r >= 1 && r <= o.rows && Number.isInteger(c) && c >= 1 && c <= o.cols)) return { error: `点 ${o.id} 的一格再写数（${o.id} 是 ${o.rows}×${o.cols} 的）` };
      const q = toQ(value);
      if (!q) return { error: `「${value ?? ''}」不是数（写成 3、-2、1/2、0.5）` };
      const act = { type: 'write', r, c, value: q.toString() };
      return { act, src: actSrc(o, act) };
    },
  },
};

// —— 挑战用的判断式（when="M stairs, M rank=2, M same B"）——

const predicates = {
  // 阶梯形（整张看，增广的右边也算）
  stairs: (o) => {
    if (!filled(o)) return null;
    try { echelon(o); return true; } catch { return false; }
  },
  // 行最简形：阶梯形，主元都是 1，主元所在的列别的格都是 0
  rref: (o) => {
    if (!filled(o)) return null;
    let piv;
    try { piv = echelon(o); } catch { return false; }
    const G = gridOf(o);
    return piv.every(({ r, c }) => isOne(G[r - 1][c - 1]) && G.every((row, i) => i === r - 1 || row[c - 1].zero));
  },
  // 秩是几（整张的秩：增广矩阵就是 r(A | b)）
  rank: (o, [k] = []) => {
    if (!/^\d+$/.test(String(k ?? ''))) throw new Error('rank 要写秩是几：M rank=2');
    if (!filled(o)) return null;
    return rrefOf(gridOf(o)).rank === Number(k);
  },
  // 和舞台上的 B 行等价（化成行最简形一样，解也一样）
  same: (o, [id] = [], scene) => {
    if (!id) throw new Error('same 后面写舞台上的另一个矩阵：M same B（和 B 行等价）');
    const B = scene?.objects?.get(id);
    if (!B) throw new Error(`same ${id}：舞台上没有「${id}」`);
    if (B.type !== 'matrix') throw new Error(`same ${id}：「${id}」不是矩阵`);
    if (!filled(o) || !filled(B)) return null;
    if (o.rows !== B.rows || o.cols !== B.cols) return false;
    const a = rrefOf(gridOf(o)).R, b = rrefOf(gridOf(B)).R;
    return a.every((row, i) => row.every((x, j) => x.sub(b[i][j]).zero));
  },
};

export const matrixRules = { next, check, predicates, facts, gestures };
