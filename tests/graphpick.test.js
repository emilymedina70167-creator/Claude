// 视觉交互第 1 批 Task 7：学生在图上点出来的点怎么判（graphpick.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePicks, pickFeedback, snapPick } from '../kit/src/graphpick.js';

test('全对', () => {
  const r = judgePicks([-1.05, 0.96], [-1, 1], 0.2);
  assert.equal(r.ok, true);
  assert.deepEqual(r.hits, [0, 1]); assert.deepEqual(r.extra, []); assert.equal(r.missed, 0);
  assert.equal(pickFeedback(r), '全对');
});

test('点少了：只说还差几个，不说在哪', () => {
  const r = judgePicks([-1.05], [-1, 1], 0.2);
  assert.equal(r.ok, false);
  assert.deepEqual(r.extra, []); assert.equal(r.missed, 1);
  assert.equal(pickFeedback(r), '还差 1 个');
});

test('点多了：多的那个标出来', () => {
  const r = judgePicks([-1, 1, 2.5], [-1, 1], 0.2);
  assert.equal(r.ok, false);
  assert.deepEqual(r.extra, [2]); assert.equal(r.missed, 0);
  assert.equal(pickFeedback(r), '有 1 个不在这里');
});

test('又多又少', () => {
  const r = judgePicks([-1, 2.5], [-1, 1], 0.2);
  assert.deepEqual(r.extra, [1]); assert.equal(r.missed, 1);
  assert.equal(pickFeedback(r), '有 1 个不在这里，还差 1 个');
});

test('一个目标只配一个点：两个点挤在同一个目标旁边，近的那个算，另一个算多的', () => {
  const r = judgePicks([0.9, 1.05], [1], 0.2);
  assert.deepEqual(r.hits, [1]); assert.deepEqual(r.extra, [0]); assert.equal(r.missed, 0);
  assert.equal(r.ok, false);
});

test('先配最近的一对（不按点的先后）', () => {
  // 目标 0 和 1；点 0.6 离 1 近、点 0.55 离 1 也近：0.6 配 1，0.55 只能去配 0（超出容差就算多的）
  const r = judgePicks([0.55, 0.6], [0, 1], 0.56);
  assert.deepEqual(r.hits, [0, 1]);
  const s = judgePicks([0.55, 0.6], [0, 1], 0.42);
  assert.deepEqual(s.hits, [1]); assert.deepEqual(s.extra, [0]); assert.equal(s.missed, 1);
});

test('没有目标也没有点：算对；有目标一个没点：不对', () => {
  assert.equal(judgePicks([], [], 0.2).ok, true);
  assert.equal(judgePicks([], [1], 0.2).ok, false);
  assert.equal(pickFeedback(judgePicks([], [1, 2], 0.2)), '还差 2 个');
});

test('随便点的（[x, y]）：按平面上的距离', () => {
  assert.equal(judgePicks([[1.02, 0.98]], [[1, 1]], 0.1).ok, true);
  assert.equal(judgePicks([[1.2, 1]], [[1, 1]], 0.1).ok, false);
  // 横竖比例不一样的图：scale 把两个方向的距离换成同一个量纲
  assert.equal(judgePicks([[1, 1.5]], [[1, 1]], 0.1, { scale: [1, 10] }).ok, true);
});

test('snapPick：点落到曲线上、x 轴上，或者原样', () => {
  assert.equal(snapPick(2, 9, { on: 'curve', f: (x) => x * x }), 2);
  assert.equal(snapPick(2, 9, { on: 'curve', f: () => { throw new Error('x'); } }), null);
  assert.equal(snapPick(2, 9, { on: 'curve', f: () => NaN }), null);
  assert.equal(snapPick(2, 9, { on: 'axis' }), 2);
  assert.deepEqual(snapPick(2, 9, { on: 'free' }), [2, 9]);
});
