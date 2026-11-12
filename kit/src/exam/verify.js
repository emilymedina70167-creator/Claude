// 验算真题的答案（docs/exam-plan.md 第二节第 3 步）：答案从解析册取；能算的再算一遍，对不上的不进库、列出来给我看。
// 题上写 check: { expr, vars }（转写的时候照题面写：引用串、权值、模式串……），用 exact.js 的精确计算算，
// 能用黑板引擎注册的函数（algofuncs.js：faults victims next nextval wpl）——用了引擎函数的记 engine，没用的记 exact。
// 单选题算出来的和正确选项的文字比，别的题和答案比。纯函数，有测试（tests/exam-verify.test.js）。
import '../algofuncs.js';
import { calcValue } from '../exact.js';

const ENGINE_FN = /\b(?:faults|victims|next|nextval|wpl)\s*\(/;

/** 答案的比法：去掉两头空白、全角半角、大小写一样，逗号顿号和空格一样 */
export function normAnswer(s) {
  return String(s ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、,;；]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** 一道题验一遍：{ how, ok（true / false；没法比是 null）, got（算出来的）, why（算不出来的原因）} */
export function verifyQuestion(q = {}) {
  const expr = q.check?.expr;
  if (!expr) return { how: 'book', ok: null, got: '', why: '' };
  let got;
  try { got = calcValue(String(expr), q.check.vars || {}).text; } catch (e) { return { how: 'none', ok: null, got: '', why: String(e?.message || e) }; }
  const how = ENGINE_FN.test(expr) ? 'engine' : 'exact';
  const want = q.type === 'single' || q.type === 'multi'
    ? String(q.answer || '').split('').map((k) => q.options?.[k] ?? '').join(' ')
    : q.answer;
  return { how, ok: normAnswer(got) === normAnswer(want), got: String(got), why: '' };
}

/** 一卷的题都验一遍：返回 { questions（verified 换上新的，不改原来的）, mismatched: [{ id, got, answer }] } */
export function applyVerify(questions = []) {
  const mismatched = [];
  const out = questions.map((q) => {
    const r = verifyQuestion(q);
    if (r.how === 'book') return q;
    if (r.ok === false) mismatched.push({ id: q.id, got: r.got, answer: q.answer });
    const verified = r.how === 'none' ? { how: 'none', why: r.why } : r.ok ? { how: r.how, ok: true } : { how: r.how, ok: false, got: r.got };
    return { ...q, verified };
  });
  return { questions: out, mismatched };
}
