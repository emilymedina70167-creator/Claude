// 视觉交互第 6 批 Task 6：折半插入排序（sort 的 algo: binsert），照王道的代码：每趟都折半找位置，相等往右（稳定）
import test from 'node:test';
import assert from 'node:assert/strict';
import { sortEngine as E } from '../kit/src/engines/sort.js';

const runOf = (f) => { const input = E.parse(f); return { input, r: E.run(input) }; };

test('每一趟的结果和直接插入一样；比较次数按 while 走了几次算', () => {
  const a = runOf({ algo: 'binsert', array: '49 38 65 97 76 13 27' }).r;
  const b = runOf({ algo: 'insert', array: '49 38 65 97 76 13 27' }).r;
  assert.deepEqual(a.passes.map((p) => p.join(' ')), b.passes.map((p) => p.join(' ')));
  // 插 38：low=1,high=1，比 1 次；插 65：low=1,high=2，mid=1（38≤65→low=2），mid=2（49≤65→low=3），比 2 次
  assert.deepEqual(a.cmps.slice(0, 3), [1, 2, 2]);
});

test('相等往右：49 和 49′ 的先后不变（稳定）', () => {
  const { r } = runOf({ algo: 'binsert', array: "49 38 49' 13" });
  const last = r.passes.at(-1).items.map((x) => (x.mark ? `${x.v}'` : String(x.v)));
  assert.deepEqual(last, ['13', '38', '49', "49'"]);
});

test('每次折半一步：low、high、mid 写在格子下面；能问下一次和谁比（mid）、这一趟的结果', () => {
  const { r } = runOf({ algo: 'binsert', array: '5 2 4 6 1' });
  const mids = r.steps.filter((s) => s.ask?.tag === 'mid');
  assert.ok(mids.length >= 4);
  assert.ok(r.steps.some((s) => s.view.ptr && Object.values(s.view.ptr).some((t) => /low/.test(t)) && Object.values(s.view.ptr).some((t) => /high/.test(t))));
  assert.ok(r.steps.some((s) => s.ask?.tag === 'pass'));
  assert.equal(E.quiz(E.parse({ algo: 'binsert', array: '5 2 4 6 1', pass: 2 }), r).answer, '2 4 5 6 1');
});
