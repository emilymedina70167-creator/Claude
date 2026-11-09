// 舞台上的挑战（docs/stage-plan.md E 段）：老师写「做到什么算做到」，学生动手试，页面每一下都当场判——
// 像游戏里的任务条件：引擎知道 AB 是不是 O、这一排排好了没有，用不着等老师看。纯函数，有测试（tests/stage-goal.test.js）。
//
//   goal g1 "改 B 里的一个数，让 AB 还是 O" when="C = O"
//   goal g2 "让 BA 不是 O" when="C = O, D != O"          逗号（或 且、and、；）连着的都要成立
//
// 两边能写：舞台上的东西（C、a）、一个部件（B.1,2、a.3、a#8）、数（3、-1/2）、拨的数的名字、O（零矩阵）、I（单位矩阵）。
// 比较：=（==）、!=（≠）、<、<=（≤）、>、>=（≥）；一排东西还能写「a sorted」「a sorted desc」。
// 每种东西自己的判断式：「名字 判断式名 [参数…]」，比如 t avl、M rank=2、s parsed（rules.js 的 predicates，参数原样交给它）。
// = / != 比一格时 49′ 和 49 是两个东西（′ 是同一个数的另一个记号，稳定性要看它们的先后；ASCII 的 ' 也当撇）；比大小、sorted 照旧按数。
// 还空着的格（乘积没算出来的）不算成立：C 还没算完，C = O 和 C != O 都不成立。
// 判断式返回 null 是「现在判不了」（乘积还空着，之后会有）；这样东西本身永远判不了（句子没写 key）判断式抛错，写下挑战时当场报。
// 量（rules.js 的 measures）写在比较的两边：count(t) = 7、height(t.107) < height(t)、verbs(s.4-14) = 1。量数不了（没写 key、矩阵还空着）
// 这一句不成立、写「判不了」，不写 ✗（学生也许已经做对了，是页面数不了）；量名写错写下挑战时当场报。

import { predicateOf, rulesOf, parseMeasure, checkMeasure, evalMeasure } from './rules.js';

const OPS = ['!=', '≠', '==', '<=', '>=', '≤', '≥', '=', '<', '>'];
const OP_RE = /^(.+?)\s*(!=|≠|==|<=|>=|≤|≥|=|<|>)\s*(.+)$/;

/** 条件的写法 → [{ l, op, r } | { l, sorted: 'asc' | 'desc' }]；写错了抛错（错误的话直接给老师看） */
export function parseGoal(text) {
  // 量的括号里的空格去掉（height( t.50 )）：不然下面按空格认判断式时会把它拆开
  const s = String(text ?? '').trim().replace(/([A-Za-z_]\w*)\(\s*([^()\s]+)\s*\)/g, '$1($2)');
  if (!s) throw new Error('when= 要写条件，比如 when="C = O, D != O"');
  // 逗号后面紧跟数字的是部件（B.1,2），不是分句
  const parts = s.split(/\s*(?:,(?!\d)|[;；，]|\s+and\s+|并且|且|&&)\s*/).map((x) => x.trim()).filter(Boolean);
  return parts.map((p) => {
    const so = p.match(/^(\S+)\s+sorted(?:\s+(asc|desc))?$/i);
    if (so) return { l: so[1], sorted: (so[2] || 'asc').toLowerCase() };
    // 名字 判断式名 [参数…]：第二个词以字母开头（C = O、a.4 > 1 的第二个词是符号，不会撞上）；rank=2 拆成 rank 和 2
    const pm = p.match(/^([^\s=!<>≠≤≥]+)\s+([A-Za-z_]\w*)(\S*)((?:\s+\S+)*)$/);
    if (pm) {
      const first = pm[3].replace(/^=/, '');
      return { l: pm[1], pred: pm[2], args: [first, ...pm[4].trim().split(/\s+/)].filter(Boolean) };
    }
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
 * 一边是什么：{ k: 'num', v } / { k: 'zero' } / { k: 'id' } / { k: 'parts', parts } / { k: 'obj', o, m }（m 是那种东西的 measure）；
 * 量（count(t)）是数，数不了是 { k: 'null', why }（比较一律不成立）。舞台上没有、读不懂的抛错
 */
// 带撇的数（49′、49'）：和不带撇的不是同一个；比一格时两种撇写法一样
const PRIMED = /^[-+]?\d+(\.\d+)?'+$/;
const primeOf = (x) => String(x).trim().replace(/'/g, '′');
export function operand(scene, w) {
  const word = String(w).trim();
  if (word.includes('′') || PRIMED.test(word)) return { k: 'num', v: primeOf(word) }; // 49′ 不是 49
  if (numOf(word) != null) return { k: 'num', v: numOf(word) };
  if (parseMeasure(word)) {
    const r = evalMeasure(scene, word);
    return r.value == null ? { k: 'null', why: r.why } : { k: 'num', v: r.value };
  }
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
  throw new Error(`「${word}」不是舞台上的东西（能写东西的名字、部件、数、O、I、量 count(t)）`);
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
  // 比一格是不是同一个：带 ′ 的和不带的不是同一个（49′ ≠ 49）；比大小照旧按数
  if ((op === '=' || op === '!=') && (/′/.test(`${a}${b}`) || PRIMED.test(String(a).trim()) || PRIMED.test(String(b).trim()))) return (primeOf(a) === primeOf(b)) === (op === '=');
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

/** 判断式写错了的话：这样东西没有它，说出能写哪些 */
function predMissing(scene, cl) {
  const o = scene.objects.get(cl.l);
  if (!o) return `「${cl.l}」不是舞台上的东西（「${cl.l} ${cl.pred}」要先有这样东西）`;
  const names = Object.keys(rulesOf(o)?.predicates || {});
  return names.length ? `${scene.type(o).label}「${cl.l}」没有判断式「${cl.pred}」，能写：${names.join('、')}` : `${scene.type(o).label}「${cl.l}」还没有判断式可写（能比的有 =、!=、sorted）`;
}
// 一句比较里写的量（两边）
const measuresIn = (cl) => (cl.pred ? [] : cl.sorted ? [cl.l] : [cl.l, cl.r]).filter((w) => parseMeasure(w));

/**
 * 写下挑战时就查：判断式名对不对；run 时再把每个判断式跑一遍（不看现在成不成立）——参数写错（t height=abc）、
 * 这样东西本身判不了（句子没写 key、key 作废了）判断式自己抛错，当场报；返回 null（乘积还空着）是之后判得了，照收。
 * 量查名字和括号里的东西（size(t)、count(q) 当场报）；run 时以后也数不了的（没写 key、增广矩阵的 det）也当场报，
 * 现在还空着的（乘积没算）照收、写「判不了」。
 * 重放旧课不跑（run 是假的）：当时收下的照样收下
 */
export function checkPreds(scene, cond, { run = false } = {}) {
  for (const cl of cond) {
    for (const w of measuresIn(cl)) checkMeasure(scene, w, { run });
    if (!cl.pred) continue;
    const fn = predicateOf(scene, cl.l, cl.pred);
    if (!fn) throw new Error(predMissing(scene, cl));
    if (run) fn(cl.args);
  }
}
/** 一句条件规范化成一个键（去掉空格），看两个挑战的条件有没有一样的句子 */
export const clauseKey = (cl) => (cl.sorted ? `${cl.l}sorted${cl.sorted}` : cl.pred ? `${cl.l}:${cl.pred}:${cl.args.join(',')}` : `${cl.l}${cl.op}${cl.r}`).replace(/\s+/g, '');

/** 一句条件成不成立（还空着的算不成立）；两边对不上（矩阵和数比）抛错 */
export function evalClause(scene, cl) {
  if (cl.pred) {
    const fn = predicateOf(scene, cl.l, cl.pred);
    if (!fn) throw new Error(predMissing(scene, cl));
    return fn(cl.args) === true; // 判不了（null）算没成立
  }
  const L = operand(scene, cl.l);
  if (cl.sorted) {
    if (L.k === 'null') return false;
    if (L.k !== 'obj' || L.m.kind !== 'list') throw new Error(`「${cl.l} sorted」只能写一排东西`);
    if (!filled(L.m)) return false;
    const vs = L.m.values.map(numOf);
    if (vs.some((v) => v == null)) return false;
    return vs.every((v, i) => !i || (cl.sorted === 'desc' ? vs[i - 1] >= v : vs[i - 1] <= v));
  }
  const R = operand(scene, cl.r);
  if (L.k === 'null' || R.k === 'null') return false; // 量数不了：不成立（写给老师的是「判不了」）
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

/** 这一句里数不了的那个量：{ k: 'null', why }；没有是 null */
function nullSide(scene, cl) {
  for (const w of measuresIn(cl)) { const x = operand(scene, w); if (x.k === 'null') return x; }
  return null;
}

/** 一句条件现在怎么样：true / false；判断式说现在判不了（乘积还空着）、量数不了（没写 key）是 null */
function clauseState(scene, cl) {
  if (!cl.pred) return nullSide(scene, cl) ? null : evalClause(scene, cl);
  const fn = predicateOf(scene, cl.l, cl.pred);
  if (!fn) throw new Error(predMissing(scene, cl));
  const r = fn(cl.args);
  return r == null ? null : r === true;
}

/** 一句条件写给老师看的样子（C = O、a sorted desc、t avl、m rank 2） */
export const clauseText = (cl) => (cl.sorted ? `${cl.l} sorted${cl.sorted === 'desc' ? ' desc' : ''}` : cl.pred ? `${cl.l} ${cl.pred}${cl.args.length ? ` ${cl.args.join(' ')}` : ''}` : `${cl.l} ${cl.op} ${cl.r}`);

/**
 * 挑战每一句现在成不成立：[{ clause, ok: true | false | null }]，不管挑战做没做到（做到了就一直算做到，可学生接着拨，
 * 这一句可能又不成立了；拨数的路每停一次都要照实标）。判不了（量数不了、乘积还空着、判断式出错）是 null
 */
export function clauseMarks(scene, g) {
  return g.cond.map((cl) => {
    let ok;
    try { ok = clauseState(scene, cl); } catch { ok = null; }
    return { clause: clauseText(cl), ok: ok == null ? null : !!ok };
  });
}

/** 写给老师看的一句：条件现在哪一句成立、哪一句还没有、哪一句页面判不了（不写成 ✗：那是假话，学生也许已经做对了） */
export function goalStatus(scene, g) {
  if (g.met) return '做到了';
  const bits = g.cond.map((cl) => {
    let mark;
    try {
      const ok = clauseState(scene, cl);
      const why = ok == null ? nullSide(scene, cl)?.why : null;
      mark = ok == null ? ` 判不了${why ? `：${why}` : ''}` : ok ? ' ✓' : ' ✗';
    } catch (err) { mark = ` 判不了：${err?.message || err}`; }
    return `${clauseText(cl)}${mark}`;
  });
  return `还没做到（${bits.join('，')}）`;
}
