// 舞台上 ask value 的判答案（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 5 节）：
// type= 选一种现成的判法（数、含 n 的式子、矩阵、数集、方程组、序列、英文），answer 可以是 {式子}（页面照舞台现在的样子现算），也可以不写（只收不判）。
// 常见错答 wrong="3=漏了 E; 0=当成数 0"：对上了就把「漏了 E」记下来，只进给老师的那一段；学生那边只看到对或不对。
// 纯函数，不碰 DOM，有测试（tests/stage-answer.test.js）。判法本身都是黑板上已有的，这里只接线。
import { calcValue, exactText, isQ, isQVec, isQMat } from '../exact.js';
import { parseFree, formulaSpec, compareFormula, normalizeFormula, matrixCells, compareCells } from '../formula.js';
import { intervalSpec, equationSpec } from '../anstypes.js';
import { parseSeqAnswer, checkSeq } from '../textcheck.js';
import { parseAnswer, matchText } from '../entext.js';
import { toQ, parseRows } from './types/matrix.js';
import { evalLive } from './value.js';


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

const isLive = (s) => /^\{[^{}]*\}$/.test(String(s ?? '').trim());
/** answer 是 {式子} 时现算成文字（矩阵写成「1 2 / 0 1」）；不是就原样 */
function resolveAnswer(answer, scene) {
  const s = String(answer ?? '').trim();
  if (!isLive(s)) return s;
  if (!scene) throw new Error(`answer=${s} 是跟着算的，要在舞台上才算得出来`);
  return valueText(evalLive(s, scene).value);
}

// —— 矩阵：「1 2 / 3 4」——
// 和造矩阵（matrix A = 1 2 / 3 4，types/matrix.js 的 parseRows）同一套写法：两边空着的 /、;、换行分行，格用空格或逗号隔开；
// 1/3（斜线两边贴着数）是一格分数，2/ 或 /3（只贴一边）和造矩阵时一样当分行。以前见 / 就分行，带分数的答案对的也判错
function gridOf(text) {
  const words = String(text ?? '').trim().replace(/\n+/g, ' / ').split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error('还没写矩阵');
  return parseRows(words).rows.map((r) => r.map((c) => toQ(c)));
}
const sameGrid = (a, b) => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((q, j) => q.cmp(b[i][j]) === 0));
const shapeText = (g) => `${g.length}×${g[0].length}`;
// 学生写的里面斜线两边贴着数的那一块（1 2/3 4 的 2/3）：页面照写法读成了分数
const fracIn = (text) => String(text ?? '').split(/[\s,，;]+/).find((w) => /^[-+]?\(?\d+(\.\d+)?\/\d+(\.\d+)?\)?$/.test(w)) || null;

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

// 判一下的结果：ok，note 是写给老师的事实（学生写的页面读不懂、读成了别的样子）
const yes = { ok: true, note: null };
const no = (note = null) => ({ ok: false, note });
const unread = (e) => no(`页面读不懂这个写法（${e.message}）`);

/**
 * 按 type 造一个 check(写的) → { ok, note }。造的时候就查 answer 写得对不对（写错抛中文原因）。
 * ans 已经是文字（{式子} 算过了）；free 是 formula / matrix 的自变量写法
 */
function makeCheck(type, ans, { free } = {}) {
  const bool = (fn) => (g) => (fn(g) ? yes : no());
  switch (type) {
    case 'plain': return bool((g) => sameAnswer(g, ans));
    case 'num': {
      const want = numOf(ans);
      return (g) => { let q; try { q = numOf(g); } catch (e) { return unread(e); } return q.cmp(want) === 0 ? yes : no(); };
    }
    case 'formula': {
      if (!String(free ?? '').trim()) throw new Error('type=formula 要写 free=n（式子里的变量，比如 free=n，或 free=n=1..8）');
      const spec = formulaSpec(ans, free, {});
      return bool((g) => {
        try { return compareFormula(spec.expected, normalizeFormula(g, { names: spec.names }), { free: spec.free, scope: {} }).ok; } catch { return false; }
      });
    }
    case 'matrix': {
      const cells = matrixCells(ans);
      if (cells) {
        // 按格写的式子：[[2^n, n 2^(n-1)], [0, 2^n]]
        const fr = parseFree(free || '-');
        return bool((g) => {
          const mine = matrixCells(g);
          if (!mine || mine.length !== cells.length || mine[0].length !== cells[0].length) return false;
          try { return compareCells(cells, mine.map((r) => r.map((x) => normalizeFormula(x, { names: fr.map((f) => f.name) }))), { free: fr, scope: {} }).ok; } catch { return false; }
        });
      }
      const want = gridOf(ans);
      const check = (g) => {
        let mine;
        try { mine = gridOf(g); } catch (e) { return unread(e); }
        if (sameGrid(mine, want)) return yes;
        const f = mine.length !== want.length || mine[0].length !== want[0].length ? fracIn(g) : null;
        return no(f ? `页面把「${f}」读成了一格分数，读出来是 ${shapeText(mine)} 的（分行要在 / 两边各空一格）` : null);
      };
      check.grid = want;
      return check;
    }
    case 'set': { const sp = intervalSpec(ans); return bool((g) => sp.check(g).ok); }
    case 'equation': { const sp = equationSpec(ans); return bool((g) => sp.check(g).ok); }
    case 'seq': { const alts = parseSeqAnswer(ans); return bool((g) => checkSeq(g, alts).ok); }
    case 'en': { const { alts } = parseAnswer(ans); return bool((g) => matchText(g, alts).ok); }
    default: throw new Error(`没有「${type}」这种 type`);
  }
}

/**
 * 照 spec 把判法造好：{ ans（正确答案写成字）, check, wrongs: [{ text, why, check }] }。
 * {式子} 现算出来再照 type 造一遍（算出来的和 type 对不上就抛）；wrong= 每一条也照 type 造（矩阵的错答格数要和答案一样：
 * 写成 1 2; 3 5 的，; 把一条错答切成了两条）。strict：写下这一行的时候，错答造不出来就抛；判的时候造不出来的那一条跳过
 */
function buildJudge(type, spec, scene, { strict = false } = {}) {
  const t = type || 'plain';
  const raw = String(spec.answer).trim();
  const ans = resolveAnswer(raw, scene);
  // {式子} 算出来的照 type 造不出判法：说清楚算出来的是什么（answer={A^2} 算出来是「1 2 / 0 1」，照 type=num 判不了）
  const at = (what, value, e) => new Error(`${what} 算出来是「${value}」，照 type=${t} 判不了：${e.message}`);
  let check;
  try { check = makeCheck(t, ans, spec); } catch (e) { throw isLive(raw) ? at(`answer=${raw}`, ans, e) : e; }
  const make = (text) => {
    const v = resolveAnswer(text, scene);
    let c;
    try { c = makeCheck(t, v, spec); } catch (e) { throw isLive(text) ? at(`wrong= 的「${text}」`, v, e) : e; }
    if (check.grid && c.grid && (c.grid.length !== check.grid.length || c.grid[0].length !== check.grid[0].length)) {
      throw new Error(`wrong= 的「${text}」是 ${shapeText(c.grid)} 的，答案是 ${shapeText(check.grid)}：错答里矩阵的行用「 / 」隔开（「;」是隔开几条错答的）`);
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
  return { ans, check, wrongs };
}


/**
 * 判一个答案。spec = { type, answer, wrongs（wrong= 的原文或 parseWrongs 的结果）, free }。
 * 返回 { ok: true | false | null, misread: 常见错答的说明 | 页面看出来的写法问题 | null, shown: 正确答案写成字, failed? }。
 * ok 是 null：老师没写 answer，只收不判；或者这一下页面没判成（failed 写原因：写下时验过了，判的时候 {P^-1} 算不出来——
 * 学生把 P 拨成了不可逆——这不是学生答错）。misread 只进给老师，学生那边只看到 ok
 */
export function judgeAnswer(given, spec = {}, scene = null) {
  const type = checkType(spec.type);
  const raw = spec.answer;
  if (raw == null || String(raw).trim() === '') return { ok: null, misread: null, shown: '' };
  let j, r;
  try {
    j = buildJudge(type, spec, scene);
    r = j.check(given);
  } catch (e) {
    return { ok: null, misread: null, shown: j?.ans ?? String(raw).trim(), failed: `页面没判成：${e.message}` };
  }
  if (r.ok) return { ok: true, misread: null, shown: j.ans };
  const w = j.wrongs.find((x) => { try { return x.check(given).ok; } catch { return false; } });
  return { ok: false, misread: w ? w.why || `像是常见错答「${w.text}」` : r.note, shown: j.ans };
}

/**
 * 写 ask value 这一行时先检查：type= 认得、wrong= 读得懂；answer、每一条错答照 type 造一遍判法（{式子} 在舞台上现算一遍再造），
 * 写错当场报。strict 是假的（重放旧课）：只做以前那几样检查，当时收下的照样收下
 */
export function checkSpec(spec = {}, scene = null, { strict = true } = {}) {
  const type = checkType(spec.type);
  const raw = spec.answer;
  if (raw == null || String(raw).trim() === '') {
    const wrongs = typeof spec.wrongs === 'string' ? parseWrongs(spec.wrongs) : spec.wrongs || [];
    if (type || wrongs.length) throw new Error('ask value 写了 type= / wrong= 却没写 answer=：要判对错就写 answer=，只收不判就都不写');
    return;
  }
  const live = /\{/.test(String(raw)) || /\{/.test(String(spec.wrongs ?? ''));
  if (!strict) {
    if (typeof spec.wrongs === 'string') parseWrongs(spec.wrongs);
    if (/\{/.test(String(raw))) { if (scene) evalLive(String(raw).trim(), scene); return; }
    if (type) makeCheck(type, String(raw).trim(), spec);
    return;
  }
  // 不在舞台上（测试里单拿出来查）：算不了 {式子}，只查写死的答案
  if (live && !scene) { if (type && !isLive(raw)) makeCheck(type, String(raw).trim(), spec); return; }
  buildJudge(type, spec, scene, { strict: true });
}
