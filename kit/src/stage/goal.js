// 舞台上的挑战（docs/stage-plan.md E 段）：老师写「做到什么算做到」，学生动手试，页面每一下都当场判——
// 像游戏里的任务条件：引擎知道 AB 是不是 O、这一排排好了没有，用不着等老师看。纯函数，有测试（tests/stage-goal.test.js）。
//
//   goal g1 "改 B 里的一个数，让 AB 还是 O" when="C = O"
//   goal g2 "让 BA 不是 O" when="C = O, D != O"          逗号（或 且、and、；）连着的都要成立
//
// 两边能写：舞台上的东西（C、a）、一个部件（B.1,2、a.3、a#8）、数（3、-1/2）、拨的数的名字、O（零矩阵）、I（单位矩阵）。
// 比较：=（==）、!=（≠）、<、<=（≤）、>、>=（≥）；一排东西还能写「a sorted」「a sorted desc」。
// 还空着的格（乘积没算出来的）不算成立：C 还没算完，C = O 和 C != O 都不成立。

const OPS = ['!=', '≠', '==', '<=', '>=', '≤', '≥', '=', '<', '>'];
const OP_RE = /^(.+?)\s*(!=|≠|==|<=|>=|≤|≥|=|<|>)\s*(.+)$/;

/** 条件的写法 → [{ l, op, r } | { l, sorted: 'asc' | 'desc' }]；写错了抛错（错误的话直接给老师看） */
export function parseGoal(text) {
  const s = String(text ?? '').trim();
  if (!s) throw new Error('when= 要写条件，比如 when="C = O, D != O"');
  // 逗号后面紧跟数字的是部件（B.1,2），不是分句
  const parts = s.split(/\s*(?:,(?!\d)|[;；，]|\s+and\s+|并且|且|&&)\s*/).map((x) => x.trim()).filter(Boolean);
  return parts.map((p) => {
    const so = p.match(/^(\S+)\s+sorted(?:\s+(asc|desc))?$/i);
    if (so) return { l: so[1], sorted: (so[2] || 'asc').toLowerCase() };
    const m = p.match(OP_RE);
    if (!m) throw new Error(`「${p}」看不懂：写成 C = O、D != O、B.1,2 > 0、a sorted`);
    const op = { '≠': '!=', '==': '=', '≤': '<=', '≥': '>=' }[m[2]] || m[2];
    if (!OPS.includes(m[2])) throw new Error(`「${m[2]}」不是比较`);
    return { l: m[1].trim(), op, r: m[3].trim() };
  });
}

// —— 数：整数、小数、分数（-3/4），′ 和真的减号也认 ——
export function numOf(v) {
  const t = String(v ?? '').replace(/[′']/g, '').replace(/[−–]/g, '-').trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(/^(-?\d+)\/(\d+)$/);
  return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
}
const sameNum = (a, b) => Math.abs(a - b) < 1e-9;

/**
 * 一边是什么：{ k: 'num', v } / { k: 'zero' } / { k: 'id' } / { k: 'parts', parts } / { k: 'obj', o, m }（m 是那种东西的 measure）。
 * 舞台上没有、读不懂的抛错
 */
export function operand(scene, w) {
  const word = String(w).trim();
  if (numOf(word) != null) return { k: 'num', v: numOf(word) };
  if (scene.objects.has(word)) {
    const o = scene.objects.get(word);
    const t = scene.type(o);
    if (!t.measure) throw new Error(`${t.label}「${word}」还不能整个拿来比（写它的一个部件，比如 ${word}.1）`);
    return { k: 'obj', o, m: t.measure(o) };
  }
  if (word === 'O') return { k: 'zero' };
  if (word === 'I') return { k: 'id' };
  if (scene.vars?.has(word)) return { k: 'num', v: scene.vars.get(word).v };
  if (scene.isRef(word)) return { k: 'parts', parts: scene.parts(word) };
  throw new Error(`「${word}」不是舞台上的东西（能写东西的名字、部件、数、O、I）`);
}

// 一个 measure 里的数全填上了没有；矩阵 { kind: 'matrix', rows: [[值]] }，一排 { kind: 'list', values }
const cellsOf = (m) => (m.kind === 'matrix' ? m.rows.flat() : m.values || []);
const filled = (m) => cellsOf(m).every((v) => v !== '' && v != null);
function isZero(m) {
  if (!filled(m)) return null;
  return cellsOf(m).every((v) => { const n = numOf(v); return n != null && sameNum(n, 0); });
}
function isIdentity(m) {
  if (m.kind !== 'matrix' || !filled(m)) return null;
  if (m.rows.length !== m.rows[0].length) return false;
  return m.rows.every((row, i) => row.every((v, j) => { const n = numOf(v); return n != null && sameNum(n, i === j ? 1 : 0); }));
}
function sameMeasure(a, b) {
  if (!filled(a) || !filled(b)) return null;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'matrix' && (a.rows.length !== b.rows.length || a.rows[0].length !== b.rows[0].length)) return false;
  const x = cellsOf(a), y = cellsOf(b);
  if (x.length !== y.length) return false;
  return x.every((v, i) => { const p = numOf(v), q = numOf(y[i]); return p != null && q != null ? sameNum(p, q) : String(v).trim() === String(y[i]).trim(); });
}
function cmpScalar(a, b, op) {
  if (a === '' || b === '' || a == null || b == null) return false;
  const p = numOf(a), q = numOf(b);
  if (p == null || q == null) {
    const s = String(a).trim(), t = String(b).trim();
    if (op === '=') return s === t;
    if (op === '!=') return s !== t;
    return false;
  }
  return { '=': sameNum(p, q), '!=': !sameNum(p, q), '<': p < q && !sameNum(p, q), '<=': p < q || sameNum(p, q), '>': p > q && !sameNum(p, q), '>=': p > q || sameNum(p, q) }[op];
}
const scalarOf = (x) => (x.k === 'num' ? [x.v] : x.k === 'parts' ? x.parts.map((p) => p.value) : null);

/** 一句条件成不成立（还空着的算不成立）；两边对不上（矩阵和数比）抛错 */
export function evalClause(scene, cl) {
  const L = operand(scene, cl.l);
  if (cl.sorted) {
    if (L.k !== 'obj' || L.m.kind !== 'list') throw new Error(`「${cl.l} sorted」只能写一排东西`);
    if (!filled(L.m)) return false;
    const vs = L.m.values.map(numOf);
    if (vs.some((v) => v == null)) return false;
    return vs.every((v, i) => !i || (cl.sorted === 'desc' ? vs[i - 1] >= v : vs[i - 1] <= v));
  }
  const R = operand(scene, cl.r);
  const { op } = cl;
  const whole = (x) => x.k === 'obj' || x.k === 'zero' || x.k === 'id';
  if (whole(L) || whole(R)) {
    if (!(op === '=' || op === '!=')) throw new Error(`整个东西只能比一样不一样（= / !=），「${cl.l} ${op} ${cl.r}」不行`);
    const [a, b] = L.k === 'obj' ? [L, R] : [R, L];
    if (a.k !== 'obj') throw new Error(`「${cl.l} ${op} ${cl.r}」：两边至少要有一样是舞台上的东西`);
    if (b.k !== 'obj' && b.k !== 'zero' && b.k !== 'id') throw new Error(`「${cl.l} ${op} ${cl.r}」：整个东西不能和一个数比（要比一格就写 ${a.o.id}.1,1 这样的部件）`);
    if (b.k === 'id' && a.m.kind !== 'matrix') throw new Error('I 是单位矩阵，只能和矩阵比');
    const eq = b.k === 'zero' ? isZero(a.m) : b.k === 'id' ? isIdentity(a.m) : sameMeasure(a.m, b.m);
    if (eq == null) return false; // 还没填满
    return op === '=' ? eq : !eq;
  }
  const xs = scalarOf(L), ys = scalarOf(R);
  // 一组部件：每一个都要成立（a.1-3 > 0）；两边都是一组时一一对着比
  if (xs.length > 1 && ys.length > 1) {
    if (xs.length !== ys.length) throw new Error(`「${cl.l}」和「${cl.r}」个数不一样，没法一一对着比`);
    return xs.every((x, i) => cmpScalar(x, ys[i], op));
  }
  return xs.every((x) => ys.every((y) => cmpScalar(x, y, op)));
}

/** 整个条件（每一句都成立才算） */
export function evalGoal(scene, cond) {
  return cond.every((cl) => evalClause(scene, cl));
}

/** 写给老师看的一句：条件现在哪一句成立、哪一句还没有 */
export function goalStatus(scene, g) {
  if (g.met) return '做到了';
  const bits = g.cond.map((cl) => {
    let ok = false;
    try { ok = evalClause(scene, cl); } catch { ok = false; }
    return `${cl.sorted ? `${cl.l} sorted${cl.sorted === 'desc' ? ' desc' : ''}` : `${cl.l} ${cl.op} ${cl.r}`}${ok ? ' ✓' : ' ✗'}`;
  });
  return `还没做到（${bits.join('，')}）`;
}
