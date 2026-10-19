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
