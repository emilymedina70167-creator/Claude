// 第十五轮：外部的预检工具。把这节课已有的 ext_in / ext_out 和这一轮要写的拼成 check-lesson.mjs 认的 .class.json，
// 外部写进学习台之前在自己的沙盒里跑一遍（和页面同一个解析、同一份组件库）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extClass } from '../tools/ext-class.js';

test('extClass：每条 ext_in 是老师的一轮，它读过的那份 ext_out 是学生的那一句；next 接在最后', () => {
  const spec = extClass({
    ins: [{ seq: 2, text: '第二轮', after: 1 }, { seq: 1, text: '第一轮' }],
    outs: [{ seq: 1, text: '[作答] q1 对' }, { seq: 2, text: '[作答] q2 错' }],
    next: '这一轮要写的', unit: '可交换', subject: '线代',
  });
  assert.equal(spec.unit, '可交换');
  assert.deepEqual(spec.turns.map((t) => t.teacher), ['第一轮', '第二轮', '这一轮要写的']);
  assert.deepEqual(spec.turns.map((t) => t.student), ['开始上课。', '[作答] q1 对', '[作答] q2 错']);
});

test('没有以前的轮：只有 next', () => {
  const spec = extClass({ next: 'x' });
  assert.deepEqual(spec.turns, [{ student: '开始上课。', teacher: 'x' }]);
});

import { sessionFromFile } from '../tools/ext-class.js';
test('--session 一个文件：JSON Lines 或数组，按路径 / 字段分 ext_in、ext_out', () => {
  const lines = [
    JSON.stringify({ id: 'sessions/c-20261118-1/ext_in/001', data: { seq: 1, text: '````board new id=b1\nx\n````', done: { at: 1 } } }),
    JSON.stringify({ id: 'sessions/c-20261118-1/ext_out/001', data: { seq: 1, text: '[作答] q1 对' } }),
    'not json',
    JSON.stringify({ id: '002', data: { seq: 2, text: 'y', after: 1 } }),
  ].join('\n');
  const r = sessionFromFile(lines);
  assert.equal(r.id, 'c-20261118-1');
  assert.deepEqual(r.ins.map((x) => x.id), ['001', '002']);
  assert.deepEqual(r.outs.map((x) => x.id), ['001']);
  assert.deepEqual(r.bad, [3]);
  const a = sessionFromFile(JSON.stringify([{ id: 'x', coll: 'ext_out', data: { seq: 1, text: 'z' } }]));
  assert.equal(a.outs.length, 1);
});
