// 舞台上 ask value 的判答案（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 5 节）：
// type= 选一种现成的判法（数、含 n 的式子、矩阵、数集、方程组、序列、英文），answer 可以是 {式子}（页面照舞台现在的样子现算），也可以不写（只收不判）。
// 常见错答 wrong="3=漏了 E; 0=当成数 0"：对上了就把「漏了 E」记下来，只进给老师的那一段；学生那边只看到对或不对。
// 纯函数，不碰 DOM，有测试（tests/stage-answer.test.js）。判法本身都是黑板上已有的，这里只接线。
import { calcValue, exactText, isQ, isQVec, isQMat } from '../exact.js';
import { parseFree, formulaSpec, compareFormula, normalizeFormula, matrixCells, compareCells } from '../formula.js';
import { intervalSpec, equationSpec } from '../anstypes.js';
import { parseSeqAnswer, checkSeq } from '../textcheck.js';
import { parseAnswer, matchText } from '../entext.js';
import { toQ } from './types/matrix.js';
import { evalLive } from './value.js';

export const ANSWER_TYPES = ['num', 'formula', 'matrix', 'set', 'equation', 'seq', 'en'];

/** type= 的写法检查：不认得的当场报错并列出能写的（没写 type 照旧：答案是数就按数，不然按英文比） */
export function checkType(type) {
  if (type == null || type === '') return null;
  const t = String(type).trim().toLowerCase();
  if (!ANSWER_TYPES.includes(t)) throw new Error(`ask value 的 type= 写 ${ANSWER_TYPES.join(' ')} 里的一个，没有「${type}」`);
  return t;
}

/** wrong="3=漏了 E; 0=当成数 0" → [{ text, why }]；没有 = 的整条当错答、提示空 */
export function parseWrongs(src) {
  if (src == null || src === '') return [];
  return String(src).split(/[;；]/).map((x) => x.trim()).filter(Boolean).map((part) => {
    const i = part.indexOf('=');
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

/** answer 是 {式子} 时现算成文字（矩阵写成「1 2 / 0 1」）；不是就原样 */
function resolveAnswer(answer, scene) {
  const s = String(answer ?? '').trim();
  if (!/^\{[^{}]*\}$/.test(s)) return s;
  if (!scene) throw new Error(`answer=${s} 是跟着算的，要在舞台上才算得出来`);
  return valueText(evalLive(s, scene).value);
}

// —— 矩阵：「1 2 / 3 4」（行用 / ; 换行隔开，格用空格或逗号隔开）——
function gridOf(text) {
  const rows = String(text ?? '').trim().replace(/[，]/g, ',').split(/\s*[/;\n]\s*/).map((r) => r.split(/[\s,]+/).filter(Boolean)).filter((r) => r.length);
  if (!rows.length) throw new Error('还没写矩阵');
  if (rows.some((r) => r.length !== rows[0].length)) throw new Error('每一行的格数要一样');
  return rows.map((r) => r.map((c) => { const q = toQ(c); if (!q) throw new Error(`「${c}」不是数`); return q; }));
}
const sameGrid = (a, b) => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((q, j) => q.cmp(b[i][j]) === 0));

/** 一个数：0.5、1/2、2^3 都认，按精确值比 */
function numOf(text) {
  const t = String(text ?? '').trim();
  const q = toQ(t);
  if (q) return q;
  const v = calcValue(t.replace(/[−–]/g, '-'), {}).value;
  if (!isQ(v)) throw new Error('要写一个数');
  return v;
}

/**
 * 按 type 造一个 check(写的) → boolean。造的时候就查 answer 写得对不对（写错抛中文原因）。
 * ans 已经是文字（{式子} 算过了）；free 是 formula / matrix 的自变量写法
 */
function makeCheck(type, ans, { free } = {}) {
  switch (type) {
    case 'num': {
      const want = numOf(ans);
      return (g) => { try { return numOf(g).cmp(want) === 0; } catch { return false; } };
    }
    case 'formula': {
      if (!String(free ?? '').trim()) throw new Error('type=formula 要写 free=n（式子里的变量，比如 free=n，或 free=n=1..8）');
      const spec = formulaSpec(ans, free, {});
      return (g) => {
        try { return compareFormula(spec.expected, normalizeFormula(g, { names: spec.names }), { free: spec.free, scope: {} }).ok; } catch { return false; }
      };
    }
    case 'matrix': {
      const cells = matrixCells(ans);
      if (cells) {
        // 按格写的式子：[[2^n, n 2^(n-1)], [0, 2^n]]
        const fr = parseFree(free || '-');
        return (g) => {
          const mine = matrixCells(g);
          if (!mine || mine.length !== cells.length || mine[0].length !== cells[0].length) return false;
          try { return compareCells(cells, mine.map((r) => r.map((x) => normalizeFormula(x, { names: fr.map((f) => f.name) }))), { free: fr, scope: {} }).ok; } catch { return false; }
        };
      }
      const want = gridOf(ans);
      return (g) => { try { return sameGrid(gridOf(g), want); } catch { return false; } };
    }
    case 'set': { const sp = intervalSpec(ans); return (g) => sp.check(g).ok; }
    case 'equation': { const sp = equationSpec(ans); return (g) => sp.check(g).ok; }
    case 'seq': { const alts = parseSeqAnswer(ans); return (g) => checkSeq(g, alts).ok; }
    case 'en': { const { alts } = parseAnswer(ans); return (g) => matchText(g, alts).ok; }
    default: throw new Error(`没有「${type}」这种 type`);
  }
}

// 没写 type：答案是数就按数比（0.5 = 1/2），不然按英文比（不分大小写、空格）
const guessType = (ans) => (toQ(ans) ? 'num' : 'en');

/**
 * 判一个答案。spec = { type, answer, wrongs（wrong= 的原文或 parseWrongs 的结果）, free }。
 * 返回 { ok: true | false | null, misread: 常见错答的说明 | null, shown: 正确答案写成字 }。
 * ok 是 null：老师没写 answer，只收不判。misread 只进给老师，学生那边只看到 ok
 */
export function judgeAnswer(given, spec = {}, scene = null) {
  const type = checkType(spec.type);
  const raw = spec.answer;
  if (raw == null || String(raw).trim() === '') return { ok: null, misread: null, shown: '' };
  const ans = resolveAnswer(raw, scene);
  const t = type || guessType(ans);
  const check = makeCheck(t, ans, spec);
  if (check(given)) return { ok: true, misread: null, shown: ans };
  const wrongs = typeof spec.wrongs === 'string' ? parseWrongs(spec.wrongs) : spec.wrongs || [];
  let misread = null;
  for (const w of wrongs) {
    let hit = false;
    try { hit = makeCheck(t, resolveAnswer(w.text, scene), spec)(given); } catch { /* 这条错答自己写得不对，不当它对上了 */ }
    if (hit) { misread = w.why || `像是常见错答「${w.text}」`; break; }
  }
  return { ok: false, misread, shown: ans };
}

/** 写 ask value 这一行时先检查：type= 认得、wrong= 读得懂、答案不用算的话现在就造一遍判法（写错当场报） */
export function checkSpec(spec = {}, scene = null) {
  const type = checkType(spec.type);
  const wrongs = typeof spec.wrongs === 'string' ? parseWrongs(spec.wrongs) : spec.wrongs || [];
  const raw = spec.answer;
  if (raw == null || String(raw).trim() === '') {
    if (type || wrongs.length) throw new Error('ask value 写了 type= / wrong= 却没写 answer=：要判对错就写 answer=，只收不判就都不写');
    return;
  }
  if (/\{/.test(String(raw))) { if (scene) evalLive(String(raw).trim(), scene); return; }
  makeCheck(type || guessType(String(raw).trim()), String(raw).trim(), spec);
}
