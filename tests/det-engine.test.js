import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detEngine as D, parseOps, detQ } from '../kit/src/engines/det.js';

test('行列式：自动化成上三角，系数跟着记（4 阶 = 160）', () => {
  const input = D.parse({ matrix: '[[1,2,3,4],[2,3,4,1],[3,4,1,2],[4,1,2,3]]' });
  const r = D.run(input);
  assert.equal(r.value.toString(), '160');
  const last = r.steps.at(-1);
  assert.equal(last.ask.tag, 'value');
  assert.equal(last.ask.display, '160');
  // 每一步都还是 D：系数 × 当前行列式 = 160
  for (const s of r.steps) assert.equal(s.view.coef.mul(detQ(s.view.M)).toString(), '160');
});

test('老师写的 ops：各列加到第一列、提出公因数、按第一列展开', () => {
  const input = D.parse({ matrix: '[[1,2,3,4],[2,3,4,1],[3,4,1,2],[4,1,2,3]]', ops: 'c1 + c2 + c3 + c4; c1 / 10; r2 - r1; r3 - r1; r4 - r1; expand c1' });
  const r = D.run(input);
  for (const s of r.steps) assert.equal(s.view.coef.mul(detQ(s.view.M)).toString(), '160');
  const pull = r.steps.find((s) => /div/.test(s.view.op || ''));
  assert.equal(pull.view.coef.toString(), '10');
  const ex = r.steps.find((s) => /展开/.test(s.view.op || ''));
  assert.equal(ex.view.M.length, 3);
  assert.equal(ex.ask.tag, 'sign');
  // 换行的「怎么变」
  const sw = D.run(D.parse({ matrix: '[[0,1],[1,0]]' })).steps.find((s) => s.ask?.tag === 'effect');
  assert.equal(sw.ask.answer, '变号');
});

test('写错了报出来；错法：换行忘了变号', () => {
  assert.throws(() => D.parse({ matrix: '[[1,2,3],[4,5,6]]' }), /方阵/);
  assert.throws(() => parseOps('r1 <-> c2', 3), /行和列不能交换/);
  assert.throws(() => parseOps('0r1', 3), /乘 0/);
  assert.throws(() => parseOps('r1 + r1', 3), /自己的倍数/);
  const input = D.parse({ matrix: '[[0,1,0],[1,0,0],[0,0,2]]' });
  const v = D.variants(input)[0];
  assert.equal(D.run(input).value.toString(), '-2');
  assert.equal(D.run(v.input).value.toString(), '2');
});

test('错法诊断：乘 k 后系数没跟着变、展开忘了符号；填表和 quiz 都认得出，对的不会被认成错法', async () => {
  const { misreadAnswer, misreadFill, fillSpec } = await import('../kit/src/stepperspec.js');
  const input = D.parse({ matrix: '[[3,1,1,1],[1,3,1,1],[1,1,3,1],[1,1,1,3]]', ops: 'c1 + c2 + c3 + c4; c1 / 6; r2 - r1; r3 - r1; r4 - r1' });
  const right = D.run(input);
  assert.equal(right.value.toString(), '48');
  const vs = D.variants(input);
  // 没有换行、没有展开：只剩「系数没跟着变」
  assert.deepEqual(vs.map((v) => v.input.noScale ? 'scale' : v.input.noSign ? 'sign' : 'cof'), ['scale']);
  const wrongValue = D.run(vs[0].input).value.toString();
  assert.equal(wrongValue, '8'); // 忘了乘提出的 6
  const variants = vs.map((v) => ({ label: v.label, answer: D.quiz(v.input, D.run(v.input)).answer }));
  assert.match(misreadAnswer(wrongValue, variants), /系数没跟着变/);
  assert.equal(misreadAnswer('48', variants), '');
  // 填表：按错法填的系数
  const t = fillSpec(D.table(input, right), {}).table;
  const vt = D.table(vs[0].input, D.run(vs[0].input));
  const values = vt.rows.map((r) => r.cells.map((c) => String(c.v)));
  assert.match(misreadFill(t, values, [{ label: vs[0].label, table: fillSpec(vt, {}).table }]), /系数没跟着变/);
  // 展开忘了符号：按第 1 行展开，(1,2) 位的 −号丢了
  const ex = D.parse({ matrix: '[[1,2,0],[3,4,5],[0,1,6]]', ops: 'expand r1' });
  const ev = D.variants(ex).find((v) => v.input.noCofSign);
  assert.ok(ev);
  assert.equal(D.run(ex).value.toString(), String(1 * (24 - 5) - 2 * 18));
  assert.equal(D.run(ev.input).value.toString(), String(1 * (24 - 5) + 2 * 18));
  // 符号的问题在错法 run 里题面一样、答案是 +
  const ask = (r) => r.steps.map((s) => s.ask).find((a) => a?.tag === 'sign');
  assert.equal(ask(D.run(ex)).q, ask(D.run(ev.input)).q);
  assert.equal(ask(D.run(ex)).answer, '−');
  assert.equal(ask(D.run(ev.input)).answer, '+');
});
