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
//   - 把主元化成 1 的倍乘；拿下面一行加到主元那一行上，把主元凑成 ±1（3 1 / 2 5 上的 r1 − r2）；
//   - 任何一行乘一个不是 0 的数（提公因数、变号：r2 / 2、−r2；elim.js 自己每消一行就这样化简一下）：倍乘弄不乱前面消好的列，
//     check 都认，acts 里只列把主元化成 1 的那一个（乘几都行，列不完）。
// 增广矩阵先只在竖线左边找主元，整行一起变。左边消完了、右边还不是阶梯形（无解的方程组：0 = 1、0 = 2 两行）时，
// 接着在右边那一列消：这样 next 走完就是 stairs（matrix.js 的 echelon 看整张），「做完」和挑战的「M stairs」是一回事。
// 已经是阶梯形以后不判（老师可能要接着化成行最简形），只有把阶梯形弄乱了才算错。
// 交出去的动作里的数写成字符串（和 matrix.js 场景里存的一样）：存进记录、发给老师时 JSON 不丢东西；收的时候 Q 和字符串都认。
import { Q, rrefOf, det } from '../../exact.js';
import { parseOps, opText, echelon, zeroRows, toQ, rowopText } from './matrix.js';

const ONE = new Q(1n);
const isOne = (q) => q.n === 1n && q.d === 1n;
const isNegOne = (q) => q.n === -1n && q.d === 1n;
const isUnit = (q) => isOne(q) || isNegOne(q);
const num = (q) => String(q).replace(/-/g, '−');
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const rowName = (i) => `r${String(i + 1).replace(/\d/g, (d) => SUBS[d])}`; // 第 i 行（从 0 数）照课本写成 r₃
const subs = (n) => String(n).replace(/\d/g, (d) => SUBS[d]);

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
  // 拿下面一行加到主元那一行上，把主元凑成 1 或 −1（主元已经是 ±1 就不用凑）
  const units = isUnit(p) ? [] : targets.flatMap((j) => [ONE, ONE.neg()].map((t) => mkAdd(r, j, t.sub(p).div(G[j][c]))));
  if (p.zero) return [...swaps, ...elims, ...units];
  return [...elims, ...swaps, ...units, ...(isOne(p) ? [] : [mkScale(r, ONE.div(p))])];
}

/** 这一步是不是可接受的下一步（按做出来的样子认：两行都乘一下的写法、写成一行字的都认） */
function acceptable(md, pl, op) {
  if (op.line !== 'r') return false;
  const { G } = md;
  const { r, c, nz } = pl;
  const i = op.i - 1, j = op.j - 1;
  if (op.kind === 'swap') return (i === r && j > r && nz.includes(j)) || (j === r && i > r && nz.includes(i));
  if (op.kind === 'scale') return i === r && !G[r][c].zero && isOne(G[r][c].mul(op.a));
  const after = G[i][c].mul(op.a).add(G[j][c].mul(op.b));
  // 凑主元：动的是主元那一行，拿下面这一列不是 0 的一行加（下面的行在消好的列上全是 0，弄不乱前面），主元成了 ±1
  if (i === r) return j > r && nz.includes(j) && !isUnit(G[r][c]) && isUnit(after);
  return i > r && nz.includes(i) && j >= r && nz.includes(j) && i !== j && after.zero;
}

// 一行乘一个不是 0 的数：「这一下做了什么」后面补一句（变号、化简、倍乘），老师一看就知道是化简不是走偏
const rowSize = (row) => row.reduce((s, q) => s + (q.n < 0n ? -q.n : q.n) + q.d, 0n);
function scaleNote(md, op, G1) {
  if (isNegOne(op.a)) return `第 ${op.i} 行变号`;
  return rowSize(G1[op.i - 1]) < rowSize(md.G[op.i - 1]) ? `化简第 ${op.i} 行` : `倍乘第 ${op.i} 行`;
}
// 判对的一步的那句补充：化 1、凑 ±1、化简（没有就是 null）
function rightNote(md, pl, op, G1) {
  if (op.kind === 'scale') return op.i - 1 === pl.r && isOne(G1[pl.r][pl.c]) ? '把主元化成 1' : scaleNote(md, op, G1);
  if (op.kind !== 'swap' && op.i - 1 === pl.r) return `把主元凑成 ${num(G1[pl.r][pl.c])}`;
  return null;
}

// —— 话 ——

function planWhy(md, pl) {
  const { r, c, nz } = pl;
  const p = md.G[r][c];
  const acts = actsOf(md, pl);
  const where = pl.right ? `竖线左边已经是阶梯形了，右边那一列（第 ${c + 1} 列）` : `第 ${c + 1} 列`;
  if (p.zero) {
    const more = `（${nz.length > 1 ? `换 ${nz.slice(1).map(rowName).join('、')} 上来也行；下面几行之间先消也行；` : ''}拿下面一行加过来凑成 ±1 也行）`;
    return `${where}：${cellName(md, r, c)} 是 0，下面 ${cellVal(md, nz[0], c)} 不是 0，先换上来：${opText(acts[0])}${more}`;
  }
  const targets = nz.filter((i) => i > r);
  const also = [
    targets.length > 1 ? '先消哪一格都行' : '',
    '换别的这一列不是 0 的行当主元也行',
    isOne(p) ? '' : isUnit(p) ? '先把主元化成 1 也行' : '先把主元化成 1、或者拿下面一行加过来凑成 ±1 也行',
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
  const said = [];
  let anyRight = false, wrongAt = null, misread = null;
  // 连着几步（r2 - r1, r3 - r1）：一步一步从做完上一步的样子判，每一步都对才对；错在哪一步，「现在正确的」就从那里算
  for (const op of ops) {
    const bad = illegal(md, op);
    if (bad) return { legal: false, right: false, misread: null, why: bad, next: nowRight(md) };
    const G1 = applyGrid(md.G, op);
    let note = null;
    if (op.line === 'r' && !hasBlank(md.G)) {
      const pl = plan(md);
      // 倍乘弄不乱前面消好的列（0 乘几都是 0）：阶梯形以前都算对
      if (pl && (acceptable(md, pl, op) || op.kind === 'scale')) { anyRight = true; note = rightNote(md, pl, op, G1); } else {
        const m = misreadOf(md, pl, op, G1);
        // 已经是阶梯形了：往下化行最简形不判，只有弄乱了才是错
        if ((pl || m) && !wrongAt) { wrongAt = md; misread = m; }
      }
    }
    said.push(note ? `${opText(op)}（${note}）` : opText(op));
    md = withGrid(md, G1);
  }
  const why = said.join('，');
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

// —— 页面算得出的（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 3.2）：读回的方程、解的样子、from=M0 猜行变换 ——
// 舞台现状（matrix.js 的 describe）每一轮写、扫拨数（scene.js 的 sweep）每个值写一次；学生写满一行时和 M0 比。不判对错，只说算出来的

const eqQ = (a, b) => a.n === b.n && a.d === b.d;
const full = (row) => !!row && row.every((x) => x != null);
const sameRow = (a, b) => a.length === b.length && a.every((x, c) => eqQ(x, b[c]));
/** 是一个方程组：增广、竖线右边正好一列（[A | E] 这种右边好几列的不读成方程） */
const isSystem = (o) => o.aug != null && o.cols - o.aug === 1;
/** 未知数的名字：vars= 写的（个数对得上才用：跟着算重新造以后可能换了尺寸），不写就是 x1、x2…… */
const varsOf = (o) => (Array.isArray(o.vars) && o.vars.length === o.aug ? o.vars : Array.from({ length: o.aug }, (_, i) => `x${i + 1}`));
/** 等号左边：系数是 0 的项不写，1 不写、分数加括号（(1/2)x2，coefSrc），负号单独拿出来写成 −；第一项是负的写 −x1，全是 0 写 0 */
function lhsText(row, names) {
  let out = '';
  row.forEach((q, i) => {
    if (q.zero) return;
    const neg = q.n < 0n;
    const term = `${coefSrc(neg ? q.neg() : q)}${names[i]}`;
    out += out ? ` ${neg ? '−' : '+'} ${term}` : `${neg ? '−' : ''}${term}`;
  });
  return out || '0';
}

/**
 * 增广矩阵每一行读回成方程：['第 1 行读回来：x1 + 2x2 − x3 = 1', '第 2 行：x2 + x3 = 2', '第 3 行：0 = −3（矛盾）']。
 * 不是方程组的是 []；还空着的行不读（写满了的行照样读：读出来的方程是真的）
 */
export function readBack(o) {
  if (!isSystem(o)) return [];
  const names = varsOf(o);
  const out = [];
  gridOf(o).forEach((row, i) => {
    if (!full(row)) return;
    const lhs = row.slice(0, o.aug), b = row[o.aug];
    const bad = lhs.every((q) => q.zero) && !b.zero;
    out.push(`第 ${i + 1} 行${out.length ? '' : '读回来'}：${lhsText(lhs, names)} = ${num(b)}${bad ? '（矛盾）' : ''}`);
  });
  return out;
}

// 方程组的秩：{ rA, rAb, free }；不是方程组、还有空着的格是 null
function solved(o) {
  if (!isSystem(o) || !filled(o)) return null;
  const G = gridOf(o);
  const rA = rrefOf(G.map((r) => r.slice(0, o.aug))).rank;
  return { rA, rAb: rrefOf(G).rank, free: o.aug - rA };
}
const shapeOf = (s) => (s.rA < s.rAb ? '无解' : s.free ? `无穷多解（${s.free} 个自由变量）` : '唯一解');

/** 解的样子：r(A) = 2，r(A | b) = 3：无解 / 唯一解 / 无穷多解（1 个自由变量）。不是方程组、有空格是 null */
export function solutionText(o) {
  const s = solved(o);
  return s ? `r(A) = ${s.rA}，r(A | b) = ${s.rAb}：${shapeOf(s)}` : null;
}

/** 扫拨数用的要点（rules.js 的 brief）：方程组写解的样子（无解带上两个秩），别的写秩；有空格是 null */
export function brief(o) {
  if (!filled(o)) return null;
  const s = solved(o);
  if (s) return s.rA < s.rAb ? `无解（r(A) = ${s.rA}，r(A | b) = ${s.rAb}）` : shapeOf(s);
  return `r = ${rrefOf(gridOf(o)).rank}`;
}

// 猜出来的一步照课本写（和舞台上的写法一样用普通数字：r2 − r1、r1 ↔ r2、(1/2)r2、−r2）
const rowRef = (i) => `r${i + 1}`;
function guessText(g) {
  if (g.kind === 'swap') return `${rowRef(g.i)} ↔ ${rowRef(g.j)}`;
  const neg = g.k.n < 0n;
  const a = coefSrc(neg ? g.k.neg() : g.k);
  return g.kind === 'scale' ? `${neg ? '−' : ''}${a}${rowRef(g.i)}` : `${rowRef(g.i)} ${neg ? '−' : '+'} ${a}${rowRef(g.j)}`;
}
const KIND_ORDER = { add: 0, scale: 1, swap: 2 };
const absQ = (q) => (q.n < 0n ? q.neg() : q);

// 变了的一行（第 i 行，从 0 数）像哪一步：试「原来这一行 + k × 另一行」「乘 k」「和另一行对调」，挑对上格子最多的；
// 一样多时倍加先于倍乘、倍乘先于对调，再挑另一行靠前、|k| 小的。对上不到一半：猜不出（guess 是 null）。
// 照猜的那一步对不上的格有这一行变了的格的一半多（列少、只改了一格时，凑一个 k 总能对上一格）：也算猜不出，不拿对不上的格硬说像哪一步
function rowGuess(G0, G1, i) {
  const want = G1[i], src = G0[i];
  const cands = [];
  G0.forEach((rj, j) => {
    if (j === i || !full(rj)) return;
    const seen = new Set();
    rj.forEach((y, c) => {
      if (y.zero) return;
      const k = want[c].sub(src[c]).div(y);
      if (k.zero || seen.has(String(k))) return; // 加 0 倍什么也没变，不是一步
      seen.add(String(k));
      cands.push({ kind: 'add', i, j, k, cand: src.map((x, cc) => x.add(k.mul(rj[cc]))) });
    });
  });
  const c0 = src.findIndex((x) => !x.zero);
  if (c0 >= 0) {
    const k = want[c0].div(src[c0]);
    if (!k.zero && !isOne(k)) cands.push({ kind: 'scale', i, j: null, k, cand: src.map((x) => x.mul(k)) });
  }
  G0.forEach((rj, j) => {
    // 对调是两行一起变：另一行也写满了，就要正好是这一行原来的样子（另一行没变、只是抄了一份过来的，不是对调）
    if (j === i || !full(rj) || !sameRow(want, rj) || (full(G1[j]) && !sameRow(G1[j], src))) return;
    cands.push({ kind: 'swap', i, j, k: null, cand: rj });
  });
  for (const x of cands) x.score = x.cand.reduce((s, q, c) => s + (eqQ(q, want[c]) ? 1 : 0), 0);
  cands.sort((a, b) => b.score - a.score || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.j ?? -1) - (b.j ?? -1) || (a.k && b.k ? absQ(a.k).cmp(absQ(b.k)) : 0));
  const best = cands[0];
  const none = { i: i + 1, guess: null, bad: [] };
  if (!best || best.score < Math.ceil(want.length / 2)) return none;
  const bad = [];
  best.cand.forEach((q, c) => { if (!eqQ(q, want[c])) bad.push({ c: c + 1, want: String(q), got: String(want[c]) }); });
  const moved = want.filter((q, c) => !eqQ(q, src[c])).length;
  if (bad.length * 2 >= moved) return none;
  const guess = { kind: best.kind, i: i + 1, ...(best.j != null ? { j: best.j + 1 } : {}), ...(best.k ? { k: String(best.k) } : {}), text: guessText(best) };
  return { i: i + 1, guess, bad };
}

/**
 * 从 G0 到 G1（Q 的二维数组，还空着的格是 null）像哪一步初等行变换：只比两边都写满了的行。
 * { rows（变了的行，从 1 数）, same（和 G0 行等价、同解；有空格说不了是 null）, guess, bad（猜的那一步该是几、写的是几：{ c, want, got }）,
 *   each（每个变了的行各自猜的）, kept（写满了、没变的行）, blank（G1 里还没写满的行）}。
 * 只变了一行就是那一行猜的；两行正好对调是那一下对调；变了好几行、凑不成一步的 guess 是 null，各行的看 each
 */
export function inferRowOp(G0, G1) {
  const n = Math.min(G0.length, G1.length);
  const changed = [], kept = [], blank = [];
  for (let i = 0; i < n; i++) {
    if (!full(G1[i])) { blank.push(i + 1); continue; }
    if (!full(G0[i])) continue;
    if (sameRow(G0[i], G1[i])) kept.push(i + 1); else changed.push(i);
  }
  const each = changed.map((i) => rowGuess(G0, G1, i));
  let guess = null, bad = [];
  if (each.length === 1) ({ guess, bad } = each[0]);
  else if (each.length === 2) {
    // 两行正好换了个位置：就是一下对调（各行单看也许像倍乘，可一下就说得通的是对调）
    const [a, b] = changed;
    if (sameRow(G1[a], G0[b]) && sameRow(G1[b], G0[a])) {
      const g = { kind: 'swap', i: a, j: b };
      guess = { kind: 'swap', i: a + 1, j: b + 1, text: guessText(g) };
    }
  }
  let same = null;
  const dims = G0.length === G1.length && G0[0]?.length === G1[0]?.length;
  if (!dims) same = false;
  else if (G0.every(full) && G1.every(full)) {
    const a = rrefOf(G0).R, b = rrefOf(G1).R;
    same = a.every((row, i) => sameRow(row, b[i]));
  }
  return { rows: changed.map((i) => i + 1), same, guess, bad, each, kept, blank };
}

const listOf = (ks) => ks.join('、');
const badText = (b) => `第 ${b.c} 格该是 ${num(b.want)}，写的是 ${num(b.got)}`;
/**
 * 造的时候写了 from=M0 的一张，学生写满一行时和 M0 比（不判对错）：
 * 「M1 第 2 行变了，像 r2 − r1；第 3 格该是 −4，写的是 4；第 1、3 行没变；和 M0 同解：否」（不是方程组的说「和 A 行等价：否」）；
 * 猜不出写「看不出是哪一种初等行变换」。
 * M0 不在了、换了尺寸：照说页面比不了
 */
export function fromFact(o, M0) {
  const name = M0?.id ?? o.from;
  if (!M0) return `${o.id} 是从 ${name} 化过来的，可舞台上已经没有 ${name} 了，页面比不了`;
  if (M0.type !== 'matrix') return `舞台上的 ${name} 已经不是矩阵了，页面比不了 ${o.id} 和它`;
  if (M0.rows !== o.rows || M0.cols !== o.cols) return `${name} 现在是 ${M0.rows}×${M0.cols} 的，和 ${o.id} 不一样大，页面比不了`;
  const r = inferRowOp(gridOf(M0), gridOf(o));
  const bits = [];
  if (!r.rows.length) bits.push(r.kept.length ? `${o.id} 写满了的第 ${listOf(r.kept)} 行都和 ${name} 一样` : `${o.id} 还没有写满的行`);
  else if (r.guess) bits.push(`${o.id} 第 ${listOf(r.rows)} 行变了，像 ${r.guess.text}`, ...r.bad.map(badText));
  else if (r.rows.length === 1) bits.push(`${o.id} 第 ${r.rows[0]} 行变了，看不出是哪一种初等行变换`);
  else {
    const one = (e) => (e.guess ? `第 ${e.i} 行像 ${e.guess.text}${e.bad.length ? `（${e.bad.map(badText).join('；')}）` : ''}` : `第 ${e.i} 行看不出是哪一种初等行变换`);
    bits.push(`${o.id} 第 ${listOf(r.rows)} 行变了，凑不成一步：${r.each.map(one).join('，')}`);
  }
  if (r.rows.length && r.kept.length) bits.push(`第 ${listOf(r.kept)} 行没变`);
  if (r.blank.length) bits.push(`第 ${listOf(r.blank)} 行还没写满`);
  // 两张都是方程组（竖线在同一处、右边一列）才说同不同解；别的矩阵说行等价不行等价（没有「解」这回事）
  const system = isSystem(o) && isSystem(M0) && o.aug === M0.aug;
  if (r.same == null) bits.push(`还有空着的格，和 ${name} ${system ? '同不同解' : '是不是行等价'}还说不了`);
  else if (!system) bits.push(`和 ${name} 行等价：${r.same ? '是' : '否'}`);
  else if (r.same) bits.push(`和 ${name} 同解：是`);
  else {
    // 不是行等价的两个方程组也可能同解：两个都无解（解都是空的）。这时不说「同解：否」，免得说错
    const a = solved(M0), b = solved(o);
    bits.push(a && b && a.rA < a.rAb && b.rA < b.rAb ? `和 ${name} 不是行等价的（两个都无解）` : `和 ${name} 同解：否`);
  }
  return bits.join('；');
}

// 学生写满一行（写完这一格，这一行没有空着的了）：造的时候写了 from= 的和 M0 比一次。没给场景找不到 M0，不写
function writeFacts(after, act, scene) {
  if (!after.from || !scene?.objects) return [];
  const row = after.cells.filter((x) => x.r === Number(act.r));
  if (!row.length || row.some((x) => x.value === '')) return [];
  return [fromFact(after, scene.objects.get(after.from) ?? null)];
}

function facts(before, after, act, scene) {
  if (!before || !after) return [];
  if (act?.type === 'write') return writeFacts(after, act, scene);
  if (act?.type !== 'rowop') return [];
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

/**
 * 一行镜头指令 → check 认的动作（actSrc 倒过来）：rowop M r2 - 2r1（几步用逗号隔开）、write M.2,3 -3/2（改一格：check 不判对错，
 * 认它是为了学生写满一行时 facts 和 from= 的那一张比）。别的给 null
 */
function lineAct(o, c, h) {
  if (c.cmd === 'write') {
    const ps = h.partsIn();
    if (ps.length !== 1 || ps[0].obj !== o.id) return null;
    const q = toQ(h.words.filter((w) => !h.scene.isRef(w)).at(-1));
    return q ? { type: 'write', r: ps[0].r, c: ps[0].c, value: q.toString() } : null;
  }
  if (c.cmd !== 'rowop' || h.words[0] !== o.id) return null;
  const op = rowopText(h).trim();
  return op ? { type: 'rowop', op } : null;
}

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

// 放下以后要不要先问倍数（gestures.js 的 askFor）：拖到另一行上（倍加）、点行号（倍乘）弹倍数框；拖到行号上是对调，不用问。
// hint 是拖着悬在那一行上时先给学生看的样子
function rowopAsk(o, { kind, from, to } = {}) {
  const ok = (k) => Number.isInteger(k) && k >= 1 && k <= o.rows;
  if (kind === 'tap') {
    const row = labelOf(from || to) ?? rowOf(from || to);
    return ok(row) ? { input: 'keypad', prompt: `${rowName(row - 1)} 乘几？`, hint: `k·${rowName(row - 1)}` } : null;
  }
  if (kind !== 'drop-on' || !to || labelOf(to) != null) return null;
  const s = rowOf(from) ?? labelOf(from), t = rowOf(to);
  if (!ok(s) || !ok(t) || s === t) return null;
  return { input: 'keypad', prompt: `${rowName(t - 1)} 加上 ${rowName(s - 1)} 的几倍？`, hint: `${rowName(t - 1)} + k·${rowName(s - 1)}` };
}

const gestures = {
  // 行的把手拖到另一行上：倍加（弹出倍数框，value 是框里写的 k，翻成 rowop M r3 + k r1）；拖到行号上：两行对调（rowop M r1 <-> r3）；
  // 点行号：倍乘（倍数框，rowop M k r2）
  rowop: { gesture: ['drop-on', 'tap'], from: 'row', to: ['row', 'label'], tap: 'label', toAct: rowopAct, ask: rowopAsk },
  // 点一格写一个数（open M edit input=keypad 时是数字键盘；能写分数、负数）
  edit: {
    gesture: 'write', on: 'cell',
    ask: (o, { to, from } = {}) => { const x = to || from; return { input: 'keypad', prompt: x?.r ? `${o.id}${subs(x.r)}${subs(x.c)} 写成几？` : '写一个数' }; },
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

// —— 量（rank(M)、rankA(M)、free(M)、det(M)；rules.js 的 measures）——
// 写整张矩阵；写部件（M.r1）没有这几个量。还有空着的格（乘积没算完）现在数不了，是 null
const wholeOnly = (f) => Object.assign((o, parts) => (parts ? undefined : !filled(o) ? null : f(o)), { none: '量写整张矩阵，比如 rank(M)', blank: '还有空着的格' });
const rankA = (o) => rrefOf(gridOf(o).map((row) => row.slice(0, o.aug ?? o.cols))).rank;
const measures = {
  // 整张的秩：增广矩阵就是 r(A | b)
  rank: wholeOnly((o) => rrefOf(gridOf(o)).rank),
  // 竖线左边（系数矩阵）的秩 r(A)；不是增广矩阵时和 rank 一样
  rankA: wholeOnly(rankA),
  // 自由变量几个：系数的列数 − r(A)
  free: wholeOnly((o) => (o.aug ?? o.cols) - rankA(o)),
  // 行列式：只有方阵、不是增广矩阵才有（别的本来就没有，不是数不了；先看形状，不是方阵的空着也是「没有」）
  det: Object.assign((o, parts) => (parts || o.aug || o.rows !== o.cols ? undefined : !filled(o) ? null : det(gridOf(o)).toNumber()), { none: '不是方阵，或者是增广矩阵', blank: '还有空着的格' }),
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
  // 秩是几（整张的秩：增广矩阵就是 r(A | b)；r(A) 写 rankA）
  // 带数字的旧写法照旧认，里面用量算（和 rank(M) = 2 是同一个数）
  rank: (o, [k] = []) => {
    if (!/^\d+$/.test(String(k ?? ''))) throw new Error('rank 要写秩是几：M rank=2');
    const v = measures.rank(o, null);
    return v == null ? null : v === Number(k);
  },
  // 系数矩阵的秩：增广矩阵只算竖线左边（r(A)，和 rank 的 r(A | b) 比有没有解）；不是增广矩阵时和 rank 一样
  rankA: (o, [k] = []) => {
    if (!/^\d+$/.test(String(k ?? ''))) throw new Error('rankA 要写系数矩阵的秩是几：M rankA=2');
    const v = measures.rankA(o, null);
    return v == null ? null : v === Number(k);
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

/** 学生走偏的那一步淡淡圈哪儿（scene.js 的 slip）：这一步改了的那一行（对调是两行），不是整张 */
function slipRefs(o, act) {
  if (act?.type !== 'rowop') return null;
  let ops;
  try { ops = opsOf(o, act); } catch { return null; }
  return [...new Set(ops.flatMap((op) => (op.kind === 'swap' ? [op.i, op.j] : [op.i]).map((k) => `${o.id}.${op.line}${k}`)))];
}

// 行变换的每一下都判（改一格不判）；做完了（成了阶梯形）只对交给了学生做行变换的矩阵算：学生只拨数的矩阵不算
// brief：跟着拨数算的矩阵，扫拨数时每个值写的要点（scene.js 的 sweep）
export const matrixRules = { next, check, predicates, measures, facts, gestures, slipRefs, brief, actOf: lineAct, judges: ['rowop'], doneBy: ['rowop'] };
