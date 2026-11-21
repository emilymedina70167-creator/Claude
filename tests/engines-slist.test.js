// 视觉交互第 6 批 Task 7：静态链表（组件 slist）。王道：a[0] 是头结点，next = −1 是表尾，next = −2 是空闲的格
import test from 'node:test';
import assert from 'node:assert/strict';
import { slistEngine as E } from '../kit/src/engines/slist.js';

const runOf = (f) => { const input = E.parse(f); return { input, r: E.run(input) }; };
const tbl = (v) => v.a.map((c) => [c.data, c.next]);

test('建表：元素依次放在 1、2、3……，a[0] 指第一个，最后一个 next = −1，其余空闲 −2', () => {
  const { r } = runOf({ size: 6, list: 'a b c' });
  assert.deepEqual(tbl(r.steps[0].view), [['', 1], ['a', 2], ['b', 3], ['c', -1], ['', -2], ['', -2]]);
});

test('插入：找第一个空闲的格，先让新结点指向前驱的后继，再改前驱；删除：前驱跳过它，它变回空闲', () => {
  const { r } = runOf({ size: 6, list: 'a b c', ops: 'insert 2 x, delete 1' });
  const afterIns = r.steps.find((s) => /插入/.test(s.msg) && s.view.done).view;
  assert.deepEqual(tbl(afterIns), [['', 1], ['a', 4], ['b', 3], ['c', -1], ['x', 2], ['', -2]]);
  assert.deepEqual(afterIns.changed, [4, 1]);
  const fin = r.steps.at(-1).view;
  assert.deepEqual(tbl(fin), [['', 4], ['a', -2], ['b', 3], ['c', -1], ['x', 2], ['', -2]]);
  assert.deepEqual(r.order, ['x', 'b', 'c']);
});

test('写法错误：位置越界、没有空闲的格、删除不存在的位置', () => {
  assert.throws(() => E.parse({ size: 3, list: 'a b c' }), /size/);
  assert.throws(() => E.run(E.parse({ size: 4, list: 'a b c', ops: 'insert 1 x' })), /空闲/);
  assert.throws(() => E.run(E.parse({ size: 6, list: 'a b', ops: 'insert 5 x' })), /位置/);
  assert.throws(() => E.run(E.parse({ size: 6, list: 'a b', ops: 'delete 3' })), /位置/);
});

test('提问、测验、错法：新结点放在哪一格、前驱的 next 改成几；按链的顺序写；先改了前驱的 next', () => {
  const { input, r } = runOf({ size: 6, list: 'a b c', ops: 'insert 2 x', ask: 'slot, next' });
  assert.ok(r.steps.some((s) => s.ask?.tag === 'slot' && s.ask.answer === 4));
  assert.ok(r.steps.some((s) => (s.ask?.tag === 'next' || s.asks?.some((a) => a.tag === 'next'))));
  assert.equal(E.quiz(input, r).answer, 'a x b c');
  assert.match(E.variants(input).map((v) => v.label).join('｜'), /先改了前驱/);
});
