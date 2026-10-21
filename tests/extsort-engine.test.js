// 外部排序（engines/extsort.js）：败者树、置换-选择、最佳归并树，和王道的例子对答案；常见错法各查一个
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extsortEngine as E, tournament, adjust, replaceRuns, huffman, virtualCount } from '../kit/src/engines/extsort.js';
import { checkAsk, misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';

const go = (f) => { const input = E.parse(f); return { input, r: E.run(input) }; };
const vruns = (input) => E.variants(input).map((v) => ({ label: v.label, input: v.input, run: E.run(v.input) }));
const askOf = (r, re) => r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).find((a) => a && re.test(a.q));
function askDiag(input, ask, given) {
  if (checkAsk(ask, given).ok) return '';
  return vruns(input).find((v) => { const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind); return a && checkAsk(a, given).ok; })?.label || '';
}
const quizDiag = (input, given) => misreadAnswer(given, vruns(input).map((v) => ({ label: v.label, answer: String(E.quiz(v.input, v.run).answer) })));
const pick = (input, re) => { const v = E.variants(input).find((x) => re.test(x.label)); assert.ok(v, `没有「${re}」这种错法：${E.variants(input).map((x) => x.label).join('；')}`); return v; };

test('败者树：17 5 10 29 15 建好后 ls = 1 4 0 2 3；b1 换成 44 调整后冠军是 b2', () => {
  // ls[4]：29 vs 15 败者 b3；ls[3]：5 vs 10 败者 b2；ls[2]：15 vs 17 败者 b0；ls[1]：15 vs 5 败者 b4；ls[0] = b1
  assert.deepEqual(tournament([17, 5, 10, 29, 15]), [1, 4, 0, 2, 3]);
  assert.deepEqual(adjust([17, 44, 10, 29, 15], [1, 4, 0, 2, 3], 1), [2, 4, 0, 1, 3]);
  const { input, r } = go({ loser: '17 5 10 29 15', next: '44' });
  assert.deepEqual(r.phases, [[1, 4, 0, 2, 3], [2, 4, 0, 1, 3]]);
  assert.equal(askOf(r, /建好以后，冠军/).answer, 'b1');
  assert.ok(checkAsk(askOf(r, /第 1 次调整以后/), 'b2').ok);
  // 错法：内部结点记了胜者（ls[4] 记成 b4）
  assert.equal(askDiag(input, askOf(r, /ls\[4\] 里记谁/), 'b4（15）'), pick(input, /胜者树/).label);
  // 错法：大的当胜者（只建树）：ls[4] 记 b4、ls[3] 记 b1、ls[2] 记 b0、ls[1] 记 b2，冠军 b3（29）
  const b = go({ loser: '17 5 10 29 15' });
  assert.equal(quizDiag(b.input, '3 2 0 1 4'), pick(b.input, /大的当成了胜者/).label);
  assert.equal(quizDiag(b.input, '1 4 0 2 3'), '', '正确答案');
});

test('置换-选择：王道的 17 21 05 44 10 12 56 32 29（WA = 3）得到两段', () => {
  assert.deepEqual(replaceRuns([17, 21, 5, 44, 10, 12, 56, 32, 29], 3), [[5, 17, 21, 44, 56], [10, 12, 29, 32]]);
  // 51 94 37 92 14 63 15 99 48 56 23 60 31 17 43 8 90 166 100，WA = 3：
  // 37 51 92 94 / 14 15 48 56 63 99 / 23 31 43 60 90 166 / 8 17 100，四段
  const { input, r } = go({ replace: '51 94 37 92 14 63 15 99 48 56 23 60 31 17 43 8 90 166 100', work: '3' });
  assert.deepEqual(r.runs.map((x) => x.join(' ')), ['37 51 92 94', '14 15 48 56 63 99', '23 31 43 60 90 166', '8 17 100']);
  assert.equal(E.quiz(input, r).answer, '4');
  // 错法：每次读满 3 个排好就输出，19 个记录分成 7 段
  assert.equal(quizDiag(input, '7'), pick(input, /读满工作区/).label);
  // 错法：MINIMAX = 94 时把比它小的 14 也输出了
  const ask = askOf(r, /MINIMAX = 94/);
  assert.equal(ask.answer, '这一段结束');
  assert.equal(askDiag(input, ask, '14'), pick(input, /比 MINIMAX 小的也输出/).label);
});

test('最佳归并树：王道的 9 段 3 路归并，不用补虚段，WPL = 223，I/O = 446；8 段要补 1 个虚段', () => {
  const { input, r } = go({ merge: '9 30 12 18 3 17 2 6 24', k: '3' });
  assert.equal(r.T.wpl, 223);
  assert.equal(E.quiz(input, r).answer, '446');
  assert.equal(virtualCount(9, 3), 0);
  assert.equal(quizDiag(input, '223'), pick(input, /2 × WPL/).label);
  // 去掉 24：8 段，(8 − 1) % 2 = 1，补 1 个虚段；WPL = 5 + 20 + 47 + 97 = 169
  const e = go({ merge: '9 30 12 18 3 17 2 6', k: '3' });
  assert.equal(virtualCount(8, 3), 1);
  assert.equal(e.r.T.wpl, 169);
  assert.equal(huffman([9, 30, 12, 18, 3, 17, 2, 6], 3, 0).wpl, 205);
  const nov = pick(e.input, /没补虚段/);
  assert.equal(askDiag(e.input, askOf(e.r, /要补几个虚段/), '0'), nov.label);
  assert.equal(quizDiag(e.input, '410'), nov.label);
  const values = E.table(nov.input, E.run(nov.input)).rows.map((row) => row.cells.map((c) => c.v));
  values.extra = E.table(nov.input, E.run(nov.input)).extra.map((c) => c.v);
  assert.equal(misreadFill(E.table(e.input, e.r), values, vruns(e.input).map((v) => ({ label: v.label, table: E.table(v.input, v.run) }))), nov.label);
});
