// 被迭代掉的几种课（舞台、一问一答、实时黑板、自学单元）搬进 archive/ 以后，以前上过的只出文字（第十四轮）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oldKind, oldText } from '../kit/src/memory/oldview.js';

test('哪些是旧的几种课', () => {
  for (const kind of ['stage', 'talk', 'live', 'unit']) assert.equal(oldKind({ kind }), true, kind);
  assert.equal(oldKind({ kind: 'class', aide: 1 }), true, '带 aide 的也是舞台那一批');
  assert.equal(oldKind({ kind: 'class' }), false);
  assert.equal(oldKind({ kind: 'drill' }), false);
  assert.equal(oldKind({}), false, '没写 kind 的是以前的黑板课');
});

test('文字记录：写明画面停用了，有报告就带，每一轮的话照写', () => {
  const t = oldText({ session: { title: '时态', date: '2026-11-12', kind: 'stage' }, report: null, turns: [{ seq: 2, role: 'claude', text: '乙' }, { seq: 1, role: 'student', text: '甲' }] });
  assert.match(t, /画面已经停用/);
  assert.match(t, /时态/);
  assert.ok(t.indexOf('甲') < t.indexOf('乙'), '按轮次排');
  assert.match(oldText({ session: { title: 'x' }, report: { items: [] }, turns: [] }), /课后报告/);
});
