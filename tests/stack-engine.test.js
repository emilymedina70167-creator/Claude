// 栈的应用（engines/stack.js）：和王道 3.3 的例子对答案；常见错法各查一个
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stackEngine as E, simulateLegal, catalan, allPopSeqs } from '../kit/src/engines/stack.js';
import { checkAsk, misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';

const go = (f) => { const input = E.parse(f); return { input, r: E.run(input) }; };
// 和 stepper.js 一样拿常见错法比（答错了才比）：先猜比题面一样的那一问，quiz 比答案，填表逐格比
const vruns = (input) => E.variants(input).map((v) => ({ label: v.label, input: v.input, run: E.run(v.input) }));
const askOf = (r, re) => r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).find((a) => a && re.test(a.q));
function askDiag(input, ask, given) {
  if (checkAsk(ask, given).ok) return '';
  return vruns(input).find((v) => { const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind); return a && checkAsk(a, given).ok; })?.label || '';
}
const quizDiag = (input, given) => misreadAnswer(given, vruns(input).map((v) => ({ label: v.label, q: E.quiz(v.input, v.run) })).filter((v) => v.q).map((v) => ({ label: v.label, answer: String(v.q.answer) })));
const fillAs = (inp) => E.table(inp, E.run(inp)).rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
const fillDiag = (input, values) => misreadFill(E.table(input, E.run(input)), values, vruns(input).map((v) => ({ label: v.label, table: E.table(v.input, v.run) })));
const pick = (input, re) => { const v = E.variants(input).find((x) => re.test(x.label)); assert.ok(v, `没有「${re}」这种错法`); return v; };

test('中缀转后缀：王道的 A+B*(C-D)-E/F → ABCD-*+EF/-，每读一个符号一步', () => {
  const { input, r } = go({ infix: 'A+B*(C-D)-E/F' });
  assert.equal(E.quiz(input, r).answer, 'A B C D - * + E F / -');
  assert.equal(r.steps.length, 1 + 13 + 1);
  // 读到第二个「-」：栈里的 * 和 + 都弹出（优先级 ≥ -），再入栈
  assert.equal(askOf(r, /第 10 个符号「-」.*弹出哪些/).answer, '弹出 *、+');
  assert.equal(askOf(r, /读完第 10 个符号「-」之后/).answer, 'A B C D - * +');
  // 填表：读完 ) 时栈里是 +*，后缀是 ABCD-
  const t = E.table(input, r);
  assert.deepEqual(t.rows[8].cells.map((c) => c.v), ['+*', 'ABCD-']);
  assert.ok(checkAsk(askOf(r, /最后的后缀表达式/), 'ABCD-*+EF/-').ok, '不写空格也认');
  assert.throws(() => E.parse({ infix: 'a + * b' }), /少了操作数/);
  assert.throws(() => E.parse({ infix: '(a + b' }), /没有配对/);
});

test('中缀转后缀的错法：同优先级没弹栈、把左括号也写进后缀', () => {
  const { input, r } = go({ infix: 'a + b * (c - d) / e' });
  assert.equal(E.quiz(input, r).answer, 'a b c d - * e / +');
  // 读到 / 时 * 和它同级，要先弹出；忘了弹就成了 a b c d - e / * +
  const eq = pick(input, /同优先级/);
  assert.equal(quizDiag(input, 'a b c d - e / * +'), eq.label);
  assert.equal(askDiag(input, askOf(r, /读到第 10 个符号「\/」.*弹出哪些/), '不弹出'), eq.label);
  // 左括号写进后缀：只有填表看得出（序列题会把括号当分隔符去掉）
  const paren = pick(input, /左括号/);
  assert.equal(fillDiag(input, fillAs(paren.input)), paren.label);
  assert.equal(fillDiag(input, fillAs(input)), '');
});

test('后缀表达式求值：1 2 3 * + 4 - = 3；错法：减法的操作数弄反、算完没压回栈', () => {
  const { input, r } = go({ postfix: '1 2 3 * + 4 -' });
  assert.equal(E.quiz(input, r).answer, '3');
  assert.deepEqual(r.steps.filter((s) => s.ask?.tag === 'top').map((s) => s.ask.display), ['6', '7', '3']);
  const swap = pick(input, /弄反/);
  assert.equal(quizDiag(input, '-3'), swap.label);
  assert.equal(askDiag(input, askOf(r, /第 7 个符号「-」/), '-3'), swap.label);
  const noPush = pick(input, /压回栈/);
  // 读到 * 时弹出 3、2，忘了压回 6：栈顶成了 1
  assert.equal(askDiag(input, askOf(r, /第 4 个符号「\*」/), '1'), noPush.label);
  // 除不尽的写分数：8 3 / → 8/3
  const d = go({ postfix: '8 3 /' });
  assert.ok(checkAsk(askOf(d.r, /值是多少/), '8/3').ok);
  assert.throws(() => E.parse({ postfix: '1 +' }), /不到两个数/);
});

test('括号匹配：{[()()]} 匹配，([)] 不匹配；错法：只数个数、读完没看栈空', () => {
  assert.equal(go({ brackets: '{[()()]}' }).r.ok, true);
  const { input, r } = go({ brackets: '([)]' });
  assert.equal(E.quiz(input, r).answer, '不匹配');
  const blind = pick(input, /种类/);
  assert.equal(quizDiag(input, '匹配'), blind.label);
  assert.equal(askDiag(input, askOf(r, /第 3 个字符「\)」/), '配得上，弹出栈顶'), blind.label);
  const left = go({ brackets: '(()' });
  assert.equal(left.r.ok, false);
  assert.equal(quizDiag(left.input, '匹配'), pick(left.input, /栈空/).label);
});

test('出栈序列：1 2 3 4 入栈，3 2 4 1 合法、4 1 2 3 不合法；n = 4 有 14 种（卡特兰数）', () => {
  assert.equal(simulateLegal(['1', '2', '3', '4'], ['3', '2', '4', '1']), true);
  assert.equal(simulateLegal(['1', '2', '3', '4'], ['4', '1', '2', '3']), false);
  const { input, r } = go({ push: '1 2 3 4', pop: '3 2 4 1' });
  assert.equal(E.quiz(input, r).answer, '合法');
  assert.equal(r.steps[1].ask.tag, 'legal');
  const rev = pick(input, /倒过来/);
  assert.equal(askDiag(input, r.steps[1].ask, '不合法'), rev.label);
  // 填表：3 出栈前要先入栈 1 2 3，出栈后剩 1 2
  assert.deepEqual(E.table(input, r).rows[0].cells.map((c) => c.v[0]), ['1 2 3', '1 2']);
  assert.equal(catalan(4), 14);
  assert.equal(allPopSeqs(4).length, 14);
  const c = go({ count: '4' });
  assert.equal(E.quiz(c.input, c.r).answer, '14');
  assert.equal(quizDiag(c.input, '70'), pick(c.input, /除以 n\+1/).label);
  assert.equal(quizDiag(c.input, '24'), pick(c.input, /全排列/).label);
});
