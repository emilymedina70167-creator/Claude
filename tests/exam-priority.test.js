// 下一步学什么（kit/src/exam/priority.js）：每块还能攒多少分、前置先排、到期复现和踩过的坑加权、四科的时间怎么分、这一周哪一科偏了
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priority } from '../kit/src/exam/priority.js';

const blocks = {
  'OS-L3.1.1': { points: 6, got: 0.6, title: '分页', subject: 'cs' },
  'OS-L3.1.2': { points: 4, got: 0, title: '页面置换', subject: 'cs' },
  'OS-L2.1.1': { points: 2, got: 0, title: '进程', subject: 'cs' },
  'L2.1.1': { points: 3, got: 0, title: '矩阵', subject: 'math' },
};

test('还能攒的分排前；前置没过基础题的排在它前面', () => {
  const curriculum = [{ id: 'OS-L3.1.2', requires: ['OS-L2.1.1'] }];
  const r = priority({ blocks, curriculum, mastery: [] });
  assert.deepEqual(r.top.cs.map((x) => x.id), ['OS-L3.1.1', 'OS-L2.1.1', 'OS-L3.1.2']);
  assert.match(r.top.cs[1].why, /页面置换.*要先过/);
  assert.equal(r.top.cs[0].left, 5.4);
  const passed = priority({ blocks, curriculum, mastery: [{ id: 'OS-L2.1.1', state: '基础题过' }] });
  assert.deepEqual(passed.top.cs.map((x) => x.id), ['OS-L3.1.1', 'OS-L3.1.2', 'OS-L2.1.1']);
});

test('到期复现 ×1.2、踩过坑 ×1.3；写进理由', () => {
  const r = priority({ blocks, curriculum: [], mastery: [], dueBlocks: new Set(['OS-L3.1.2']), traps: { 'OS-L3.1.2': ['G-OS-3.2#t1'] } });
  assert.equal(r.top.cs[0].id, 'OS-L3.1.2');
  assert.match(r.top.cs[0].why, /到期/);
  assert.match(r.top.cs[0].why, /踩过/);
});

test('四科的时间按还能攒的分、每科至少一成；这一周偏了的', () => {
  const sessions = [{ space: 'cs', date: '2026-11-10', report: { activeMs: 9 * 3600000 } }, { space: 'math', date: '2026-11-11', report: { activeMs: 600000 } }];
  const r = priority({ blocks, curriculum: [], mastery: [], sessions, today: '2026-11-12' });
  assert.ok(Math.abs(Object.values(r.split).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(r.split.math >= 0.1 && r.split.en >= 0.1);
  assert.ok(r.lag.some((x) => x.space === 'math'));
  assert.ok(!r.lag.some((x) => x.space === 'cs'));
});
