// 410 分按真题的期望分值分到块（kit/src/exam/weights.js 接 memory/score.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockWeights } from '../kit/src/exam/weights.js';
import { scoreMap, scoreBoard } from '../kit/src/memory/score.js';

test('份额：0.3 平分 + 0.7 按期望分值，加起来是 1；没考过的也有平均那份的三成', () => {
  const w = blockWeights({ blocks: ['a', 'b', 'c'], expected: { a: 6, b: 2 } });
  assert.ok(Math.abs(w.a + w.b + w.c - 1) < 1e-12);
  assert.ok(Math.abs(w.a - (0.1 + 0.7 * 0.75)) < 1e-12);
  assert.ok(Math.abs(w.c - 0.1) < 1e-12);
  assert.deepEqual(blockWeights({ blocks: ['a', 'b'], expected: {} }), { a: 0.5, b: 0.5 });
});

const curriculum = [
  { id: 'OS-L3', level: 'lecture', title: '第3章 内存' }, { id: 'OS-L3.1', level: 'section', title: '§1' },
  { id: 'OS-L3.1.1', level: 'block', title: '分页' }, { id: 'OS-L3.1.2', level: 'block', title: '页面置换' }, { id: 'OS-L3.1.3', level: 'block', title: '没考过' },
];

test('scoreMap：章里的块照真题权重分；没有真题时和以前一样平分', () => {
  const flat = scoreMap(curriculum).blocks;
  assert.ok(Math.abs(flat['OS-L3.1.1'].points - flat['OS-L3.1.3'].points) < 1e-12);
  const m = scoreMap(curriculum, null, { weights: { 'OS-L3.1.2': 3, 'OS-L3.1.1': 1 } }).blocks;
  const total = ['OS-L3.1.1', 'OS-L3.1.2', 'OS-L3.1.3'].reduce((s, id) => s + m[id].points, 0);
  assert.ok(Math.abs(total - flat['OS-L3.1.1'].points * 3) < 1e-9, '一章的总分不变');
  assert.ok(m['OS-L3.1.2'].points > m['OS-L3.1.1'].points && m['OS-L3.1.1'].points > m['OS-L3.1.3'].points);
  const b = scoreBoard({ curriculum }, { today: '2026-11-12', exam: { 'OS-L3.1.2': 3 } });
  assert.ok(b.subjects.find((s) => s.key === 'cs').parts.find((p) => p.key === 'OS').chapters[0].points > 0);
});
