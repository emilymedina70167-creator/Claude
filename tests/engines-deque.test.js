// 视觉交互第 6 批 Task 5：双端队列（组件 deque）。输入受限：一端能进能出、另一端只能出；输出受限：一端能进能出、另一端只能进
import test from 'node:test';
import assert from 'node:assert/strict';
import { dequeEngine as E, feasible, allOutputs } from '../kit/src/engines/deque.js';

const perms = (xs) => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
const bad = (kind) => perms(['1', '2', '3', '4']).filter((p) => !feasible(kind, ['1', '2', '3', '4'], p)).map((p) => p.join(''));

test('1 2 3 4 依次进：输入受限得不到 4213、4231；输出受限得不到 4132、4231；普通双端队列都得到', () => {
  assert.deepEqual(bad('in').sort(), ['4213', '4231']);
  assert.deepEqual(bad('out').sort(), ['4132', '4231']);
  assert.deepEqual(bad('both'), []);
  assert.equal(allOutputs('in', ['1', '2', '3']).length, 6);
});

test('得得到的：一步一个操作，最后输出的就是要的序列', () => {
  const input = E.parse({ kind: 'in', push: '1 2 3 4', seq: '4 1 3 2' });
  const r = E.run(input);
  assert.equal(r.ok, true);
  const fin = r.steps.at(-1).view;
  assert.deepEqual(fin.out, ['4', '1', '3', '2']);
  assert.ok(r.steps.every((s, i) => i === 0 || /进|出/.test(s.msg)));
  // 输入受限：只从右端进
  assert.ok(r.ops.every((o) => o.op !== 'push' || o.end === 'R'));
});

test('得不到的：走到卡住的那一步，说清楚要出的是哪个、为什么出不来', () => {
  const r = E.run(E.parse({ kind: 'out', push: '1 2 3 4', seq: '4 1 3 2' }));
  assert.equal(r.ok, false);
  assert.match(r.steps.at(-1).msg, /得不到/);
  assert.match(r.steps.at(-1).msg, /要出 1|要出 3/);
});

test('写法错误：kind 写错、序列不是 push 的排列', () => {
  assert.throws(() => E.parse({ kind: 'left', push: '1 2', seq: '2 1' }), /kind/);
  assert.throws(() => E.parse({ kind: 'in', push: '1 2 3', seq: '1 2 4' }), /seq/);
});

test('提问、测验、错法：先问得不得到；quiz 从几个里挑得到的；把输入受限当成输出受限', () => {
  const input = E.parse({ kind: 'in', push: '1 2 3 4', seq: '4 2 1 3', ask: 'possible' });
  const r = E.run(input);
  assert.equal(r.steps[1].ask?.tag, 'possible', '单独一步，在操作之前');
  assert.equal(r.steps[1].ask.answer, '得不到');
  const q = E.quiz(E.parse({ kind: 'in', push: '1 2 3 4', options: '4 1 3 2, 4 2 1 3, 4 2 3 1, 1 2 3 4' }), null);
  assert.equal(q.answer, '4132 1234');
  assert.match(E.variants(E.parse({ kind: 'in', push: '1 2 3 4', options: '4 1 3 2, 4 2 1 3, 4 2 3 1' })).map((v) => v.label).join('｜'), /输出受限/);
});
