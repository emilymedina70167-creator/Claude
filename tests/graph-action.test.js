// 视觉交互第 1 批 Task 7：学生在函数图上做的事怎么告诉主讲（actionText）
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionText } from '../kit/src/class/prompt.js';

const base = { type: 'graph', step: 's3', block: 'g1', title: '极值点' };

test('达成了图里的目标', () => {
  assert.match(actionText({ ...base, ok: true }), /^\[作答\] .*图.*：达成了图里的目标$/);
});

test('在图上点出来：点了什么、对不对、页面说了什么', () => {
  const t = actionText({ ...base, q: '点出全部极值点', ok: false, value: '-1.02, 0.4', detail: '有 1 个不在这里，还差 1 个', attempts: 1 });
  assert.match(t, /「点出全部极值点」/);
  assert.match(t, /在图上点了 -1\.02, 0\.4/);
  assert.match(t, /有 1 个不在这里，还差 1 个/);
  assert.match(actionText({ ...base, q: '点出全部极值点', ok: true, value: '-1, 1', detail: '全对', attempts: 2 }), /在图上点了 -1, 1（对，第 2 次）/);
});

test('点了几次没对，看了答案', () => {
  const t = actionText({ ...base, q: '点出全部极值点', ok: false, giveup: true, value: '0.4', attempts: 3, expected: '-1, 1' });
  assert.match(t, /试了 3 次没点对，看了答案（-1, 1）/);
});

test('一个都没点就检查', () => {
  assert.match(actionText({ ...base, q: '点出间断点', ok: false, value: '', detail: '还差 2 个', attempts: 1 }), /一个都没点/);
});
