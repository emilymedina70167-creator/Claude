// 舞台上 ask value 的判答案（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 5 节，第二轮第 10 节）：
// type= 选一种现成的判法（数、含 n 的式子、矩阵、数集、方程组、序列、英文），answer 可以是 {式子}（页面照舞台现在的样子现算），也可以不写（只收不判）。
// 常见错答 wrong="3=漏了 E; 0=当成数 0"：对上了就把「漏了 E」记下来，只进给老师的那一段；学生那边只看到对或不对。
// answer 是 {A B}、{A^2}、{3 A}、{A^-1}、{A'} 这五种时，页面自己照固定的改法现算几条常见错答（autoWrongs），也只告诉老师。
// type=matrix 写了 free=n：每格是含 n 的式子，学生那边一格一个式子框，逐格代 n 判（formulaRows、gridAnswerText）。
// 纯函数，不碰 DOM，有测试（tests/stage-answer.test.js）。判法本身都是黑板上已有的，这里只接线。
import { calcValue, exactText, isQ, isQVec, isQMat, Q, mul, det, inv, rrefOf } from '../exact.js';
import { parseFree, formulaSpec, compareFormula, normalizeFormula, matrixCells, compareCells, FORMULA_FUNCS } from '../formula.js';
import { intervalSpec, equationSpec } from '../anstypes.js';
import { parseSeqAnswer, checkSeq } from '../textcheck.js';
import { parseAnswer, matchText } from '../entext.js';
import { splitPicks, fillPicks, checkPick, verbNow, VERB } from './pick.js';
import { toQ, parseRows } from './types/matrix.js';
import { evalLive, numText } from './value.js';


/** 填的答案和正确答案一样吗（数按数比：0.50 = .5 = 1/2；别的去掉空格、不分大小写） */
export function sameAnswer(text, answer) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[，,]/g, ',').toLowerCase();
  const num = (s) => {
    const t = norm(s);
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    const m = t.match(/^(-?\d+)\/(\d+)$/);
    return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  };
  const a = num(text), b = num(answer);
  if (a != null && b != null) return Math.abs(a - b) < 1e-9;
  return norm(text) === norm(answer);
}


export const ANSWER_TYPES = ['num', 'formula', 'matrix', 'set', 'equation', 'seq', 'en'];

/** type= 的写法检查：不认得的当场报错并列出能写的（没写 type 照旧：答案是数就按数，不然按英文比） */
export function checkType(type) {
  if (type == null || type === '') return null;
  const t = String(type).trim().toLowerCase();
  if (!ANSWER_TYPES.includes(t)) throw new Error(`ask value 的 type= 写 ${ANSWER_TYPES.join(' ')} 里的一个，没有「${type}」`);
  return t;
}

/**
 * wrong="3=漏了 E; 0=当成数 0" → [{ text, why }]；没有 = 的整条当错答、提示空。
 * accept(错答的字) → 读不读得懂：方程（x + y = 5）、数集（x>=1）的错答自己带 =，照 type 找第一处切得出一个读得懂的错答的那个 =
 * （一处都不行就整条当错答，再不行照第一个 = 切，造判法时报出来）；不给 accept 照第一个 = 切（旧的样子）
 */
export function parseWrongs(src, accept = null) {
  if (src == null || src === '') return [];
  return String(src).split(/[;；]/).map((x) => x.trim()).filter(Boolean).map((part) => {
    const cuts = [...part.matchAll(/=/g)].map((m) => m.index);
    let i = cuts.length ? cuts[0] : -1;
    if (accept && cuts.length) {
      const ok = (k) => { const t = (k < 0 ? part : part.slice(0, k)).trim(); return !!t && accept(t); };
      const hit = [...cuts, -1].find(ok);
      if (hit !== undefined) i = hit;
    }
    const text = (i < 0 ? part : part.slice(0, i)).trim();
    const why = i < 0 ? '' : part.slice(i + 1).trim();
    if (!text) throw new Error(`wrong= 的「${part}」：= 前面写常见的错答，后面写它说明了什么（wrong="3=漏了 E; 0=当成数 0"）`);
    return { text, why };
  });
}

// —— 答案的值 → 文字 ——
const cellText = (q) => q.toString();
function valueText(v) {
  if (isQ(v)) return cellText(v);
  if (isQMat(v)) return v.map((r) => r.map(cellText).join(' ')).join(' / ');
  if (isQVec(v)) return v.map(cellText).join(' / ');
  return exactText(v);
}

// answer 里的 {verb: go on | 现在 | 完成进行}：页面拼出谓语当标准答案（pick.js、verbs.js），不是要现算的式子
const hasVerb = (s) => splitPicks(s).some((p) => p.k === 'pick' && p.name === VERB);
const verbFilled = (s, scene) => (hasVerb(s) ? fillPicks(s, scene?.vars || new Map()) : s);
const isLive = (s) => /^\{[^{}]*\}$/.test(String(s ?? '').trim());
// type=set 的 {1, 5}：大括号里只有数、逗号、空格，是数集的写法（几个值），不是要页面现算的式子（第一轮这样写会报一句看不懂的错）
const SET_BRACES = /^\{[\s\d.,，、/+\-−]*\}$/;
const liveIn = (s, type) => isLive(s) && !(type === 'set' && SET_BRACES.test(String(s).trim()));
/**
 * answer 是 {式子} 时现算成文字（矩阵写成「1 2 / 0 1」）；不是就原样。
 * lenient（重放旧课）：算不出来就照字面——第一轮以前的课里 answer={…} 可能就是字面写的，不是式子
 */
function resolveAnswer(answer, scene, { type = null, lenient = false } = {}) {
  const s = verbFilled(String(answer ?? '').trim(), scene);
  if (!liveIn(s, type)) return s;
  if (!scene) {
    if (lenient) return s;
    throw new Error(`answer=${s} 是跟着算的，要在舞台上才算得出来`);
  }
  try { return valueText(evalLive(s, scene).value); } catch (e) {
    if (lenient) return s;
    // 数集想写几个值却写了别的（{1, a}）：照实说页面把它当成了式子，不只报一句式子算不出来
    if (type === 'set') throw new Error(`answer=「${s}」被当成了式子（{…} 是页面照舞台现算的）：${e.message}；数集的几个值写成 {1, 5}，大括号里只写数和逗号`);
    throw e;
  }
}

// —— 矩阵：「1 2 / 3 4」——
// 和造矩阵（matrix A = 1 2 / 3 4，types/matrix.js 的 parseRows）同一套写法：两边空着的 /、;、换行分行，格用空格或逗号隔开；
// 1/3（斜线两边贴着数）是一格分数，2/ 或 /3（只贴一边）和造矩阵时一样当分行。以前见 / 就分行，带分数的答案对的也判错
function gridOf(text) {
  const words = String(text ?? '').trim().replace(/\n+/g, ' / ').split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('还没写矩阵');
  // 不受舞台上矩阵的大小上限管：{A'} 这种答案可能比舞台上能放的大（6×8 的 A 转过来是 8×6），判起来不碍事
  return parseRows(words, null, { cap: false }).rows.map((r) => r.map((c) => toQ(c)));
}
const sameGrid = (a, b) => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((q, j) => q.cmp(b[i][j]) === 0));
const shapeText = (g) => `${g.length}×${g[0].length}`;
// 学生写的里面斜线两边贴着数的那一块（1 2/3 4 的 2/3）：页面照写法读成了分数
const fracIn = (text) => String(text ?? '').split(/[\s,，;]+/).find((w) => /^[-+]?\(?\d+(\.\d+)?\/\d+(\.\d+)?\)?$/.test(w)) || null;

// —— 按格的式子：「1 n n(n-1)/2 / 0 1 n / 0 0 1」——
/**
 * 一行字 → 每一格的式子（string[][]）。和老师写 answer=、造矩阵一样：括号外面两边空着的 /（还有 ;、换行）分行，
 * 只贴着一边的 / 也当分行；两边都贴着的 / 是除（n(n-1)/2 是一格）。格用空格或逗号隔开，括号里的空格、逗号不算
 */
export function formulaRows(text) {
  const s = String(text ?? '').trim().replace(/\s*\n\s*/g, ' / ');
  const rows = [[]];
  let cur = '', depth = 0;
  const cell = () => { if (cur) rows.at(-1).push(cur); cur = ''; };
  const row = () => { cell(); rows.push([]); };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (depth === 0) {
      if (/\s/.test(ch) || ch === ',' || ch === '，') { cell(); continue; }
      if (ch === ';' || ch === '；') { row(); continue; }
      if (ch === '/' && !(/\S/.test(s[i - 1] ?? '') && /\S/.test(s[i + 1] ?? ''))) { row(); continue; }
    }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    cur += ch;
  }
  cell();
  while (rows.length > 1 && !rows.at(-1).length) rows.pop();
  return rows;
}

// 一格里的空格：运算符、括号两边的不改意思，去掉；两个字母数字中间的是省掉的乘号，写成 ·（2 n → 2·n，函数名后面的直接贴上：tr A → trA）。
// 这样一格写成一行字以后还是一格（格之间用空格隔开）
function tidyCell(c) {
  let t = String(c ?? '').trim();
  if (!t) return '_';
  t = t.replace(/([\p{L}\p{N}_.']+)\s+(?=[\p{L}\p{N}_.])/gu, (m, w) => (FORMULA_FUNCS.includes(w) ? w : `${w}·`)).replace(/\s+/g, '');
  // 括号外面还有逗号、分号（写错了的一格）：整格括起来，读回来不被切开
  let depth = 0;
  for (const ch of t) { if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--; else if (depth === 0 && /[,，;；]/.test(ch)) return `(${t})`; }
  return t;
}
/** 按格交的答案写成一行字（formulaRows 反过来）：一行里的格用空格隔开，行之间「 / 」，和老师写 answer= 一样；空格子写 _ */
export function gridAnswerText(rows) {
  return (rows || []).map((r) => (r || []).map(tidyCell).join(' ')).join(' / ');
}

/** 一格一格的式子：交来的 string[][]，或一行字（[[…]] 也认）；每行一样多，不然抛中文原因 */
function cellGrid(src) {
  const rows = Array.isArray(src) ? src.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : [])) : matrixCells(src) || formulaRows(src);
  if (!rows.length || !rows[0].length) throw new Error('还没写矩阵');
  rows.forEach((r, i) => { if (!r.length) throw new Error(`第 ${i + 1} 行是空的（两个 / 中间要有式子）`); });
  rows.forEach((r, i) => { if (r.length !== rows[0].length) throw new Error(`第 ${i + 1} 行有 ${r.length} 格，第 1 行有 ${rows[0].length} 格（每行要一样多）`); });
  return rows;
}

// 黑板（formula.js）的报错说的是课件的写法（formula:、answer:、在 let 里给出）：换成舞台的写法再说
const stageWords = (msg) => String(msg).replace(/formula:/g, 'free=').replace(/answer:\s*/g, 'answer=').replace(/在 let 里给出它的值/g, '舞台上的式子只能用 free= 写的变量');
/** 老师写的一个式子（answer=、wrong= 的一格）→ 读懂以后的表达式：和学生写的走同一个 normalizeFormula（2n、n(n-1)/2 都认） */
function teacherFormula(text, names, what) {
  try { return normalizeFormula(text, { names }); } catch (e) {
    const hint = /^不认识/.test(e.message) ? `；式子里的变量写在 free= 里（现在是 ${names.length ? names.join('、') : '没有'}）` : '';
    throw new Error(`${what}「${text}」读不懂：${e.message}${hint}`);
  }
}
// 写给老师的式子：上标写成上标（n^2/2 → n²/2），别的照学生写的
const SUPER = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '-': '⁻' };
const prettyFormula = (t) => String(t ?? '').trim().replace(/\s+/g, ' ').replace(/\^(?:\((-?\d+)\)|(-?\d+))/g, (m, a, b) => [...(a ?? b)].map((c) => SUPER[c]).join(''));
// 代进去算出来的一个值写给老师：整数、有限小数照写（4.5），别的写分数；负号写 −
function valueWord(v) {
  if (isQ(v)) return numText(v).replace(/^-/, '−');
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v * 1e6) / 1e6).replace(/^-/, '−');
  return '？';
}
/** 一格对不上写给老师：第 1 行第 3 格不对：学生写 n²/2，代 n = 3 是 4.5，该是 3（挑 n ≥ 2、学生的式子算得出来的那一组） */
function cellNote(first, raw) {
  const where = `第 ${first.r + 1} 行第 ${first.c + 1} 格不对：学生写 ${prettyFormula(raw)}`;
  const bad = first.bad || [];
  const big = (b) => Object.values(b.at).every((v) => v >= 2);
  const b = bad.find((x) => !x.err && big(x)) || bad.find((x) => !x.err) || bad[0];
  if (!b) return where;
  const at = Object.entries(b.at).map(([k, v]) => `${k} = ${v}`).join('，');
  const got = b.err ? `算不出来（${b.err}）` : `是 ${valueWord(b.got)}`;
  return `${where}，${at ? `代 ${at} ` : '算出来'}${got}，该是 ${valueWord(b.want)}`;
}

/** 一个数：0.5、1/2、2^3 都认，按精确值比 */
function numOf(text) {
  const t = String(text ?? '').trim();
  const q = toQ(t);
  if (q) return q;
  let v = null;
  try { v = calcValue(t.replace(/[−–]/g, '-'), {}).value; } catch { v = null; } // 算式读不懂（「1 2 / 0 1」）和不是数一样说
  if (!isQ(v)) throw new Error(`要写一个数（「${t}」不是）`);
  return v;
}

// 判一下的结果：ok，note 是写给老师的事实（学生写的页面读不懂、读成了别的样子）；ok 是 null：页面判不了（不当学生答错）
const yes = { ok: true, note: null };
const no = (note = null) => ({ ok: false, note });
const unread = (e) => no(`页面读不懂这个写法（${e.message}）`);
const cannot = (note) => ({ ok: null, note: `页面判不了：${note}` });

// —— 按格写的通解（第三次量 L2 第 6 幕）：一列（或一行）、每格是 free= 变量的一次式 = 一个仿射集合（点 + 几个方向张成的），
// 换了参数、换了特解、方向乘了倍数都是同一条线 / 同一个平面。逐格比式子把它们判成错（对的判成错，是假话），所以这种答案按集合判 ——
// 学生用的参数名不一定是 free= 写的（写 t 也是同一条线）：读不懂时再照这些单个字母读一遍（e、i 留着不认）
const PARAM_NAMES = 'abcdfghjklmnopqrstuvwxyz'.split('');
const QV = (x) => (typeof x === 'number' ? Q.int(x) : x);
// 一次式验算用的几个点（0、1 拿来取点和方向；别的拿来核是不是一次式：避开小整数，免得高次式凑巧对上）
const PROBES = [2, -3, 7, 13, -11].map(Q.int).concat([Q.int(7).div(Q.int(2)), Q.int(-5).div(Q.int(3))]);
/**
 * 每格的表达式（normalizeFormula 之后的）→ { p（点，Q[]）, d（方向，Q[][]，一个参数一个）} ；不是这些名字的一次式（k²、1/k、abs）、
 * 算出来不是数：null
 */
function affineOf(exprs, names) {
  const at = (vals) => {
    const out = [];
    for (const e of exprs) {
      let v;
      try { v = calcValue(e, Object.fromEntries(names.map((n, i) => [n, vals[i]]))).value; } catch { return null; }
      if (!isQ(v)) return null;
      out.push(v);
    }
    return out;
  };
  const zero = names.map(() => Q.int(0));
  const p = at(zero);
  if (!p) return null;
  const d = [];
  for (let i = 0; i < names.length; i++) {
    const v = at(zero.map((z, j) => (j === i ? Q.int(1) : z)));
    if (!v) return null;
    d.push(v.map((x, r) => x.sub(p[r])));
  }
  // 核一下真是一次式：几组值（每个参数轮着取 PROBES 里的数）都等于 p + Σ x_i d_i
  for (let t = 0; t < PROBES.length; t++) {
    const xs = names.map((_, i) => QV(PROBES[(t + i * 3) % PROBES.length]));
    const v = at(xs);
    if (!v) return null;
    const lin = p.map((x, r) => xs.reduce((acc, xi, i) => acc.add(xi.mul(d[i][r])), x));
    if (v.some((x, r) => x.cmp(lin[r]) !== 0)) return null;
  }
  return { p, d };
}
// 几个向量（Q[]，一样长）张成的维数
const rankOf = (vecs, n) => (vecs.length ? rrefOf(Array.from({ length: n }, (_, r) => vecs.map((v) => v[r]))).rank : 0);
// 式子里用到的名字（函数名不算）
const namesIn = (e) => [...new Set(String(e).match(/[A-Za-z_]\w*/g) || [])].filter((w) => !FORMULA_FUNCS.includes(w));
const dimWord = (k) => (k === 0 ? '一个点（不含参数）' : k === 1 ? '一条线（1 个方向）' : k === 2 ? '一个平面（2 个方向）' : `${k} 维的（${k} 个方向）`);
const vecWord = (v) => `(${v.map((x) => numText(x).replace(/^-/, '−')).join(', ')})`;
/**
 * 学生按格写的 cells（string[][]，一列或一行）和答案的仿射集合 aff 比：同一个集合 → yes；不是 → no（说为什么：维数不一样、方向不对、
 * 方向对点不在上面）；学生写的读不懂、不是一次式 → 页面判不了（cannot）
 */
function affineJudge(aff, cells, free) {
  const flat = cells.flat();
  const read = [];
  for (let i = 0; i < flat.length; i++) {
    let e = null;
    try { e = normalizeFormula(flat[i], { names: free }); } catch { try { e = normalizeFormula(flat[i], { names: [...new Set([...free, ...PARAM_NAMES])] }); } catch (err) { return cannot(`第 ${i + 1} 格读不懂（${err.message}）`); } }
    read.push(e);
  }
  const names = [...new Set(read.flatMap(namesIn))];
  const mine = affineOf(read, names);
  if (!mine) return cannot(`学生写的不是参数的一次式（${flat.map(prettyFormula).join('，')}），页面比不了是不是同一个集合`);
  const n = aff.p.length;
  const ra = rankOf(aff.d, n), rs = rankOf(mine.d, n);
  if (rs !== ra) return no(`学生写的是${dimWord(rs)}，答案是${dimWord(ra)}`);
  if (rankOf([...aff.d, ...mine.d], n) !== ra) {
    const bad = mine.d.find((v) => rankOf([...aff.d, v], n) !== ra);
    const line = aff.d.find((v) => v.some((x) => !x.zero));
    return no(`方向不对：学生的方向 ${vecWord(bad)} 不在答案的方向${ra > 1 ? '张成的平面' : ` ${vecWord(line)} 那条线`}里`);
  }
  const gap = mine.p.map((x, r) => x.sub(aff.p[r]));
  if (rankOf([...aff.d, gap], n) !== ra) return no(ra ? `方向对，可学生写的点 ${vecWord(mine.p)}（参数都取 0 时）不在答案上` : `学生写的点 ${vecWord(mine.p)} 不是答案的 ${vecWord(aff.p)}`);
  return yes;
}

// 按集合判出来是同一个集合（只是参数、特解换了）时写给老师的那一句（不写 solve=on 时不判对：最后一审 I2）
const sameSetWord = (k) => (k === 0 ? '同一个点' : k === 1 ? '同一条线' : k === 2 ? '同一个平面' : `同一个 ${k} 维的集合`);
/**
 * 按格写的式子的判法：answer 是 [[…]] 或「1 n n(n-1)/2 / 0 1 n / 0 0 1」，free 是 free= 的原文（[[…]] 不写 free= 时格里只有数）。
 * 每一格照学生的读法（normalizeFormula）读懂，造的时候每格代一遍、算不出来当场报；判的时候逐格代值比（compareCells）。
 * solve（老师写了 solve=on）：一列（一行）的通解按集合判（affineJudge）。不写时照旧逐格判——Aⁿv = (n, 1) 这种一列的「函数」答案，
 * 按集合判会把 (2n, 1) 判对（最后一审 I2）；逐格对不上、按集合是同一个集合的，不判对也不判错（ok: null），告诉老师写 solve=on。
 * lenient（重放旧课）：照字面逐格判（A 批以前没有集合判）
 */
function cellsCheck(ans, free, { solve = false, lenient = false } = {}) {
  let fr;
  try { fr = parseFree(String(free ?? '').trim() ? free : '-'); } catch (e) { throw new Error(stageWords(e.message)); }
  const names = fr.map((f) => f.name);
  const rows = cellGrid(ans);
  const want = rows.map((r, i) => r.map((c, j) => teacherFormula(c, names, `第 ${i + 1} 行第 ${j + 1} 格`)));
  for (let i = 0; i < want.length; i++) for (let j = 0; j < want[i].length; j++) {
    try { compareFormula(want[i][j], want[i][j], { free: fr, scope: {} }); } catch (e) { throw new Error(`第 ${i + 1} 行第 ${j + 1} 格「${rows[i][j]}」代不进去：${stageWords(e.message)}`); }
  }
  // 一列（或一行）、每格是 free= 变量的一次式：通解，写了 solve=on 按集合判（affineJudge）。方阵（Aⁿ）、不是一次式的只能逐格比：那里 n 是有意思的
  const vec = names.length && (want.length === 1 || want[0].length === 1) && want.flat().length >= 2;
  const aff = vec && !lenient ? affineOf(want.flat(), names) : null;
  if (solve && !aff && !lenient) throw new Error('solve=on 只用在一列（或一行）、每格是 free= 变量一次式的通解上（比如 free=k solve=on answer="-2+4k / 1-k / k"）');
  const check = (g) => {
    let mine;
    try { mine = cellGrid(g); } catch (e) { return unread(e); }
    if (mine.length !== want.length || mine[0].length !== want[0].length) return no(`学生写的是 ${shapeText(mine)} 的，答案是 ${shapeText(want)} 的`);
    const read = [];
    let other = null; // 第一格照 free= 的名字读不懂的（学生换了参数名，通解里也是对的）：逐格判时照它说
    for (let i = 0; i < mine.length; i++) {
      read.push([]);
      for (let j = 0; j < mine[i].length; j++) {
        if (!mine[i][j] || mine[i][j] === '_') return no(`第 ${i + 1} 行第 ${j + 1} 格还空着`);
        const unread = (e) => `第 ${i + 1} 行第 ${j + 1} 格页面读不懂（${e.message}）`;
        try { read[i].push(normalizeFormula(mine[i][j], { names })); } catch (e) { if (aff) { other ||= unread(e); continue; } return no(unread(e)); }
      }
    }
    // 标准答案写下时代过了：这里再抛（某一格所有取值都算不出来）是页面没判成，交给 judgeAnswer 记 ok: null
    let res = null;
    if (!other) {
      res = compareCells(want, read, { free: fr, scope: {} });
      if (res.ok) return yes;
      if (!aff) return no(cellNote(res.first, mine[res.first.r][res.first.c]));
    }
    if (solve) return affineJudge(aff, mine, names);
    // 不写 solve=on：照旧逐格判错；只有按集合是同一个集合时不说错（换了参数、特解的通解是对的，Aⁿv 换了参数是错的，页面分不清）
    if (affineJudge(aff, mine, names).ok === true) return cannot(`学生写的和答案是${sameSetWord(rankOf(aff.d, aff.p.length))}，只是参数或特解换了（要按集合判，在 ask 那一行写 solve=on）`);
    return no(other || cellNote(res.first, mine[res.first.r][res.first.c]));
  };
  check.shape = [want.length, want[0].length];
  check.cells = true; // 收 string[][]（按格的式子框交的）
  return check;
}

/**
 * 按 type 造一个 check(写的) → { ok, note }。造的时候就查 answer 写得对不对（写错抛中文原因）。
 * ans 已经是文字（{式子} 算过了）；free 是 formula / matrix 的自变量写法
 */
function makeCheck(type, ans, { free, solve, lenient } = {}) {
  const bool = (fn) => (g) => (fn(g) ? yes : no());
  switch (type) {
    case 'plain': return bool((g) => sameAnswer(g, ans));
    case 'num': {
      const want = numOf(ans);
      return (g) => { let q; try { q = numOf(g); } catch (e) { return unread(e); } return q.cmp(want) === 0 ? yes : no(); };
    }
    case 'formula': {
      if (!String(free ?? '').trim()) throw new Error('type=formula 要写 free=n（式子里的变量，比如 free=n，或 free=n=1..8）');
      let fr;
      try { fr = parseFree(free); } catch (e) { throw new Error(stageWords(e.message)); }
      const names = fr.map((f) => f.name);
      // 老师写的和学生写的走同一种读法（2n、n(n-1)/2：以前 n(…) 被当成函数，写下就报算不出来）；
      // 照这种读法读不了、黑板原来的读法读得了的照旧收（以前收下的写法不变）
      let src = null, err = null;
      try { src = teacherFormula(ans, names, 'answer='); } catch (e) { err = e; }
      let spec;
      try { spec = formulaSpec(src ?? ans, free, {}); } catch (e) { throw err || new Error(stageWords(e.message)); }
      // 老师的答案学生的式子框也得写得出：答案里有式子框不认的函数（floor、log2）时，学生怎么填都判不对
      // （主线第一轮 D4-7：以前照黑板的读法收下，学生填 log2(n)+1 交不上去）。重放旧课照旧收
      const alien = String(err?.message || '').match(/读不懂：不认识「([^」]+)」/)?.[1];
      if (alien && !lenient) throw new Error(`answer= 里的 ${alien} 学生写不出：式子框不认 ${alien}（认 ${names.join('、')} 和 ${FORMULA_FUNCS.filter((f) => f !== 'T').slice(0, 5).join('、')} 这些函数），学生怎么填都判不对。换一种问法（比如 type=num 问一个具体的 n），或者不写 type= 只收不判`);
      return (g) => {
        let mine;
        try { mine = normalizeFormula(g, { names: spec.names }); } catch (e) { return unread(e); }
        try { return compareFormula(spec.expected, mine, { free: spec.free, scope: {} }).ok ? yes : no(); } catch { return no(); }
      };
    }
    case 'matrix': {
      // 按格写的式子：[[2^n, n 2^(n-1)], [0, 2^n]]，或者写了 free= 的「1 n n(n-1)/2 / 0 1 n / 0 0 1」
      if (matrixCells(ans) || String(free ?? '').trim()) return cellsCheck(ans, free, { solve: solve === 'on', lenient: !!lenient });
      const want = gridOf(ans);
      const check = (g) => {
        let mine;
        try { mine = gridOf(g); } catch (e) { return unread(e); }
        if (sameGrid(mine, want)) return yes;
        const f = mine.length !== want.length || mine[0].length !== want[0].length ? fracIn(g) : null;
        return no(f ? `页面把「${f}」读成了一格分数，读出来是 ${shapeText(mine)} 的（分行要在 / 两边各空一格）` : null);
      };
      check.shape = [want.length, want[0].length];
      return check;
    }
    case 'set': {
      // 「、」和逗号一样（数集的写法里都是「且」；大括号里只认逗号隔开几个值）
      const comma = (x) => String(x ?? '').replace(/、/g, ',');
      // 只写了几个数、用逗号隔开（1, 5）：就是这几个值。数集的写法里逗号是「且」，1, 5 读成「是 1 又是 5」，对的也判错。
      // 老师的 answer= 也这样读（主线第一轮 L3-3：以前只补学生那边，老师写 answer="1,4"、学生填一模一样的也判错）
      const bare = (g) => (/^\s*[-−+]?[\d.]+(\/\d+)?(\s*[,，]\s*[-−+]?[\d.]+(\/\d+)?)+\s*$/.test(g) ? `{${g}}` : g);
      const sp = intervalSpec(bare(comma(ans)));
      return bool((g) => sp.check(bare(comma(g))).ok);
    }
    case 'equation': { const sp = equationSpec(ans); return bool((g) => sp.check(g).ok); }
    case 'seq': { const alts = parseSeqAnswer(ans); return bool((g) => checkSeq(g, alts).ok); }
    case 'en': { const { alts } = parseAnswer(ans); return bool((g) => matchText(g, alts).ok); }
    default: throw new Error(`没有「${type}」这种 type`);
  }
}

// —— 页面自己认的常见错答（第二轮第 10 节）：answer 整个是下面五种之一时，照固定的改法现算 ——
const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const NUM = '[-+]?\\d+(?:\\.\\d+)?(?:\\/\\d+)?';
const SUP_IN = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
const RE = {
  two: new RegExp(`^(${NAME})(?:\\s*\\*\\s*|\\s+)(${NAME})$`), // A B、A*B、k A
  scale: new RegExp(`^\\(?\\s*(${NUM})\\s*\\)?\\s*\\*?\\s*(${NAME})$`), // 3 A、3A、(-1/2) A
  power: new RegExp(`^(${NAME})\\s*\\^\\s*(?:\\(\\s*(\\d+)\\s*\\)|(\\d+))$`), // A^2、A^(3)、A²
  inverse: new RegExp(`^(?:(${NAME})\\s*\\^\\s*(?:\\(\\s*-\\s*1\\s*\\)|-\\s*1)|inv\\s*\\(\\s*(${NAME})\\s*\\))$`), // A^-1、A⁻¹、inv(A)
  transpose: new RegExp(`^(?:(${NAME})\\s*'|T\\s*\\(\\s*(${NAME})\\s*\\))$`), // A'、Aᵀ、T(A)
};
const powQ = (q, k) => { let r = Q.int(1); for (let i = 0; i < k; i++) r = r.mul(q); return r; };

/**
 * answer 是 {X Y}、{X^k}（k ≥ 2）、{k X}、{X^-1}、{X'} 时，照舞台现在的样子现算常见错答：[{ text（写成「1 2 / 3 4」）, why }]。
 * 乘反了（Y X）、每格各自 k 次方、只乘了第一行 / 只乘了 (1,1) 一格、每格取倒数 / 伴随矩阵没除以行列式（det × X⁻¹）、没转置（X 本身）。
 * 现算出来和正确答案一样的那条不要（对称矩阵没转置也对、对角矩阵逐格平方也对）；算不出来的那条（有一格是 0 取不了倒数、B A 乘不了）跳过。
 * 只做这五种，不做通用的错法生成：别的错靠老师写 wrong=
 */
export function autoWrongs(raw, scene) {
  const s = String(raw ?? '').trim();
  if (!scene || !isLive(s)) return [];
  let right;
  try { right = evalLive(s, scene).value; } catch { return []; }
  if (!isQMat(right)) return [];
  const body = s.slice(1, -1).replace(/[−–]/g, '-').replace(/[·×]/g, '*').replace(/ᵀ/g, "'")
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^(${[...m].map((c) => SUP_IN[c]).join('')})`).trim();
  const valueOf = (w) => evalLive(`{${w}}`, scene).value;
  const matOf = (w) => { const v = valueOf(w); if (!isQMat(v)) throw new Error(`${w} 不是矩阵`); return v; };
  const cands = [];
  const scaleWrongs = (k, X) => {
    cands.push({ why: '像是只乘了第一行', fn: () => X.map((r, i) => (i === 0 ? r.map((q) => k.mul(q)) : r.slice())) });
    cands.push({ why: '像是只乘了一格', fn: () => X.map((r, i) => r.map((q, j) => (i === 0 && j === 0 ? k.mul(q) : q))) });
  };
  let m;
  try {
    if ((m = body.match(RE.two))) {
      const [, x, y] = m;
      const a = valueOf(x);
      if (isQMat(a)) cands.push({ why: `像是乘反了（算成了 ${y} ${x}）`, fn: () => mul(matOf(y), a) });
      else if (isQ(a)) scaleWrongs(a, matOf(y));
    } else if ((m = body.match(RE.scale))) scaleWrongs(toQ(m[1]), matOf(m[2]));
    else if ((m = body.match(RE.power)) && Number(m[2] ?? m[3]) >= 2) {
      const k = Number(m[2] ?? m[3]), X = matOf(m[1]);
      cands.push({ why: `像是每一格各自 ${k} 次方了`, fn: () => X.map((r) => r.map((q) => powQ(q, k))) });
    } else if ((m = body.match(RE.inverse))) {
      const X = matOf(m[1] ?? m[2]);
      cands.push({ why: '像是每一格取了倒数', fn: () => X.map((r) => r.map((q) => Q.int(1).div(q))) });
      cands.push({ why: '像是伴随矩阵没除以行列式', fn: () => mul(det(X), inv(X)) });
    } else if ((m = body.match(RE.transpose))) {
      const X = matOf(m[1] ?? m[2]);
      cands.push({ why: '像是没转置', fn: () => X });
    }
  } catch { return []; } // 名字不是舞台上的矩阵、拨数：不是这五种
  const out = [];
  for (const c of cands) {
    let v;
    try { v = c.fn(); } catch { continue; }
    if (!isQMat(v) || sameGrid(v, right)) continue;
    const text = valueText(v);
    if (out.some((w) => w.text === text)) continue; // 两条算出来一样（只有一行时只乘第一行 = 只乘一格）：留前面那条
    out.push({ text, why: c.why });
  }
  return out;
}

/** 一个数的错答：学生写的（一行字；按格交的写成一行字）就是这一个数才对上。text 不是一个数：null */
function numberWrong(text) {
  let want;
  try { want = numOf(text); } catch { return null; }
  if (!/^\s*[-−+]?[\d.]+(\/\d+)?\s*$/.test(String(text))) return null; // 2^3 这种算式不算「一个数」的错答
  return (g) => {
    let q;
    try { q = numOf(Array.isArray(g) ? gridAnswerText(g) : g); } catch { return no(); }
    return q.cmp(want) === 0 ? yes : no();
  };
}

/**
 * 照 spec 把判法造好：{ ans（正确答案写成字）, check, wrongs: [{ text, why, check }], autos() }。
 * {式子} 现算出来再照 type 造一遍（算出来的和 type 对不上就抛）；wrong= 每一条也照 type 造（矩阵的错答格数要和答案一样：
 * 写成 1 2; 3 5 的，; 把一条错答切成了两条）。strict：写下这一行的时候，错答造不出来就抛；判的时候造不出来的那一条跳过。
 * lenient（重放旧课）：{…} 算不出来照字面比，照 type 造不出判法就按字比
 */
function buildJudge(type, spec, scene, { strict = false, lenient = false } = {}) {
  const t = type || 'plain';
  const raw = String(spec.answer).trim();
  const ans = resolveAnswer(raw, scene, { type: t, lenient });
  const literal = liveIn(raw, t) && ans === raw; // 重放旧课、算不出来：照字面
  // {式子} 算出来的照 type 造不出判法：说清楚算出来的是什么（answer={A^2} 算出来是「1 2 / 0 1」，照 type=num 判不了）
  const at = (what, value, e) => new Error(`${what} 算出来是「${value}」，照 type=${t} 判不了：${e.message}`);
  let check;
  try { check = makeCheck(t, ans, spec); } catch (e) {
    if (literal) check = makeCheck('plain', ans, spec);
    else throw isLive(raw) && liveIn(raw, t) ? at(`answer=${raw}`, ans, e) : e;
  }
  // 错答不带 solve 造判法（逐格比）：solve=on 说的是答案按集合判；错答常常不是一次式（「k^2 / 1 / k=平方了」），带着 solve 造
  // 会报「solve=on 只用在…通解上」，话不对题（复审 N7）。学生照错答的字写才对上；换了参数的错答由答案那边按集合判出来的话说
  const plain = { ...spec, solve: undefined };
  const make = (text) => {
    const v = resolveAnswer(text, scene, { type: t, lenient });
    // 一个数的错答（矩阵答案的「0=写成数字 0」、方程的「3=只写了数」）：学生写的就是这一个数时对上（第一轮能写；Task 13 加了矩阵错答
    // 要和答案一样大，把它也挡掉了）。照矩阵、方程的读法造不出来、或者大小对不上时才走这里，别的错答照旧
    const single = () => (['matrix', 'equation'].includes(t) && !liveIn(text, t) ? numberWrong(v) : null);
    let c;
    try { c = makeCheck(t, v, plain); } catch (e) { const n = single(); if (n) return n; throw liveIn(text, t) ? at(`wrong= 的「${text}」`, v, e) : e; }
    if (check.shape && c.shape && (c.shape[0] !== check.shape[0] || c.shape[1] !== check.shape[1])) {
      const n = single();
      if (n) return n;
      throw new Error(`wrong= 的「${text}」是 ${c.shape.join('×')} 的，答案是 ${check.shape.join('×')}：错答里矩阵的行用「 / 」隔开（「;」是隔开几条错答的）`);
    }
    return c;
  };
  const accept = t === 'plain' ? null : (text) => { try { make(text); return true; } catch { return false; } };
  const list = typeof spec.wrongs === 'string' ? parseWrongs(spec.wrongs, accept) : spec.wrongs || [];
  const wrongs = [];
  for (const w of list) {
    let c;
    try { c = make(w.text); } catch (e) {
      if (strict) throw new Error(/^wrong= /.test(e.message) ? e.message : `wrong= 的「${w.text}」照 type=${t} 读不成：${e.message}`);
      continue; // 判的时候这一条算不出来（{式子} 现在算不了）：只是对不上，不碍着判对错
    }
    wrongs.push({ ...w, check: c });
  }
  // 页面现算的常见错答：判错了、老师的 wrong= 都没对上才算（不和格数比：没转置的那张大小可能就不一样）
  const autos = () => (literal ? [] : autoWrongs(raw, scene).flatMap((w) => { try { return [{ ...w, check: makeCheck(t, w.text, plain) }]; } catch { return []; } }));
  return { ans, check, wrongs, autos };
}


/**
 * 判一个答案。given 是学生写的一行字，或者按格的式子框交的 string[][]；spec = { type, answer, wrongs（wrong= 的原文或
 * parseWrongs 的结果）, free, lenient（重放旧课的那一问） }。
 * 返回 { ok: true | false | null, misread: 常见错答的说明 | 页面看出来的写法问题、哪一格不对 | null, shown: 正确答案写成字, failed? }。
 * ok 是 null：老师没写 answer，只收不判；或者这一下页面没判成（failed 写原因：写下时验过了，判的时候 {P^-1} 算不出来——
 * 学生把 P 拨成了不可逆——这不是学生答错）。misread 只进给老师，学生那边只看到 ok
 */
export function judgeAnswer(given, spec = {}, scene = null) {
  const type = checkType(spec.type);
  const raw = spec.answer;
  if (raw == null || String(raw).trim() === '') return { ok: null, misread: null, shown: '' };
  let j, r, g = given;
  try {
    j = buildJudge(type, spec, scene, { lenient: !!spec.lenient });
    // 按格交的给不是按格判的（一行字的判法）：写成一行字再判
    const flat = (c) => (Array.isArray(given) && !c.cells ? gridAnswerText(given) : given);
    g = flat(j.check);
    r = j.check(g);
    const hit = (x) => { try { return x.check(flat(x.check)).ok === true; } catch { return false; } };
    if (r.ok) return { ok: true, misread: null, shown: j.ans };
    // 老师的 wrong= 先比，再比页面现算的
    const w = j.wrongs.find(hit) || j.autos().find(hit);
    if (w) return { ok: false, misread: w.why || `像是常见错答「${w.text}」`, shown: j.ans };
    // 页面判不了（按集合判的通解，学生写的不是一次式）：不当学生答错，照实告诉老师；不是页面出错（undecided，不进出错记录）
    if (r.ok === null) return { ok: null, misread: null, shown: j.ans, failed: r.note, undecided: true };
    return { ok: false, misread: r.note, shown: j.ans };
  } catch (e) {
    return { ok: null, misread: null, shown: j?.ans ?? String(raw).trim(), failed: `页面没判成：${e.message}` };
  }
}

/**
 * 按格的式子框画多大：type=matrix 写了 free= 时 { rows, cols, names（式子里的变量） }，不然 null（一个输入框）。
 * 太大的（超过 4×4）也是 null：一格一个框在 iPad 上摆不下，照旧一行字写
 */
/**
 * 学生在答案框里打的是一句问话（主线第七轮：第一节真课「simply什么意思」被判成一次填错，报告里多一道错题）：
 * 以 ? ？ 结尾，或者有中文而老师的答案里没有中文。是问话就不判、不算一次作答，记成学生说的话交给老师
 */
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
export function asksBack(text, spec = {}) {
  const t = String(text ?? '').trim();
  if (!t) return false;
  if (/[?？]$/.test(t)) return true;
  return CJK_RE.test(t) && !CJK_RE.test(String(spec.answer ?? ''));
}

export function gridShape(spec = {}, scene = null) {
  if (String(spec.type ?? '').trim().toLowerCase() !== 'matrix') return null;
  if (String(spec.grid ?? '') === 'off') return null; // 老师关了格子（想看学生自己写成什么形状）
  try {
    // 没写 free=（全是数）也按格写：格子里写数、分数，没有字母键。形状算不出来（舞台上现在算不了）、太大：回到一个输入框
    const names = String(spec.free ?? '').trim() ? parseFree(spec.free).map((f) => f.name) : [];
    const rows = cellGrid(resolveAnswer(spec.answer, scene, { type: 'matrix', lenient: !!spec.lenient }));
    if (rows.length > 4 || rows[0].length > 4) return null;
    return { rows: rows.length, cols: rows[0].length, names };
  } catch { return null; }
}

/**
 * 学生那边用什么写这一问的答案（第一轮所有 ask value 都是数字键盘，英文、方程、数集、式子在 iPad 上几乎打不进去）：
 *   { kind: 'grid', rows, cols, names }  按格的式子框（type=matrix 写了 free=）
 *   { kind: 'formula', names }           一个式子框，配符号小键盘（type=formula）：n、^、括号一下就点到
 *   { kind: 'decimal' }                  数字键盘：type=num、不写 free= 的 matrix（全是数），没写 type 而答案是一个数（不写 type 时数按数比）
 *   { kind: 'text' }                     普通键盘：en、seq、equation、set、没写 type 的字、只收不判
 */
export function answerInput(spec = {}, scene = null) {
  const grid = gridShape(spec, scene);
  if (grid) return { kind: 'grid', ...grid };
  const t = String(spec.type ?? '').trim().toLowerCase();
  const free = String(spec.free ?? '').trim();
  if (t === 'formula') { try { return { kind: 'formula', names: parseFree(free).map((f) => f.name) }; } catch { return { kind: 'text' }; } }
  if (t === 'num' || (t === 'matrix' && !free)) return { kind: 'decimal' };
  if (!t && String(spec.answer ?? '').trim()) {
    let ans = '';
    try { ans = resolveAnswer(spec.answer, scene, { lenient: !!spec.lenient }); } catch { /* 现在算不出来：照普通键盘 */ }
    if (/^[-−+]?\d+(\.\d+)?(\/\d+)?$/.test(ans.trim())) return { kind: 'decimal' };
  }
  return { kind: 'text' };
}

/**
 * 写 ask value 这一行时先检查：type= 认得、wrong= 读得懂；answer、每一条错答照 type 造一遍判法（{式子} 在舞台上现算一遍再造），
 * 写错当场报。strict 是假的（预写的行、重放旧课）：只做以前那几样检查，当时收下的照样收下；
 * lenient（重放旧课）：{…} 算不出来（第一轮以前字面写的 answer={…}）、照 type 造不出判法都不报，判的时候照字面比、没判成照实说
 */
export function checkSpec(spec = {}, scene = null, { strict = true, lenient = false } = {}) {
  const type = checkType(spec.type);
  // solve=on：一列（一行）的通解按集合判（最后一审 I2：不写时逐格判）。写错、用错地方当场报，不默默照逐格判
  if (spec.solve != null && !lenient) {
    if (spec.solve !== 'on' && spec.solve !== 'off') throw new Error(`solve= 只能写 on（一列的通解按集合判：换了参数、特解的同一条线也对）或 off，没有「${spec.solve}」`);
    if (spec.solve === 'on' && (type !== 'matrix' || !String(spec.free ?? '').trim())) throw new Error('solve=on 只用在 type=matrix free=… 的一列（或一行）通解上（比如 free=k solve=on answer="-2+4k / 1-k / k"）');
  }
  const raw = spec.answer;
  if (raw == null || String(raw).trim() === '') {
    const wrongs = typeof spec.wrongs === 'string' ? parseWrongs(spec.wrongs) : spec.wrongs || [];
    if (type || wrongs.length) throw new Error('ask value 写了 type= / wrong= 却没写 answer=：要判对错就写 answer=，只收不判就都不写');
    return;
  }
  // {verb: …} 先拼成字（写下时每一种拨法都拼一遍，拼不了当场报）
  if (hasVerb(String(raw)) && strict) for (const p of splitPicks(String(raw))) if (p.k === 'pick' && p.name === VERB) { checkPick(p, scene?.vars || new Map()); const v = verbNow(p, scene?.vars || new Map()); if (v.unsayable) throw new Error(`answer 里的 ${p.raw}：${v.unsayable}`); }
  const s = verbFilled(String(raw).trim(), scene);
  const setLit = type === 'set' && SET_BRACES.test(s);
  const live = (/\{/.test(s) && !setLit) || /\{/.test(String(spec.wrongs ?? ''));
  if (!strict) {
    if (typeof spec.wrongs === 'string') parseWrongs(spec.wrongs);
    const quiet = (fn) => { try { fn(); } catch (e) { if (!lenient) throw e; } };
    if (/\{/.test(s) && !setLit) { if (scene) quiet(() => evalLive(s, scene)); return; }
    if (type) quiet(() => makeCheck(type, s, spec));
    return;
  }
  // 不在舞台上（测试里单拿出来查）：算不了 {式子}，只查写死的答案
  if (live && !scene) { if (type && !liveIn(s, type)) makeCheck(type, s, spec); return; }
  buildJudge(type, spec, scene, { strict: true });
}
