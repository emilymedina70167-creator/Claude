// 去限制设计第 4 步漏掉的一处：外部的课里黑板现状（meta/now 的那段字）不截学生的作答、草稿、板顶的话，换行留着；
// 页面里的老师照旧压成一行、截短
import test from 'node:test';
import assert from 'node:assert/strict';
import { boardStateText, useFullText } from '../kit/src/class/prompt.js';

const long = '第一行 ' + '很长的推导'.repeat(120) + '\n第二行 结论';
const board = {
  cur: 1,
  pages: [{ n: 1, title: '板', talk: '老师的话'.repeat(80) }],
  segs: [{ id: 'b1', page: 1, summary: '摘要'.repeat(120), blocks: [{ id: 'q1', kind: 'answer', results: [`[作答] q1：写了「${long}」`], draft: long, stage: Array.from({ length: 60 }, (_, i) => `行${i}`).join('\n') }] }],
};

test('外部的课：板现状不截、换行留着', () => {
  useFullText(true);
  try {
    const t = boardStateText(board);
    assert.ok(t.includes('很长的推导'.repeat(120)), '作答原文全在');
    assert.ok(t.includes('第二行 结论'));
    assert.ok(/\n\s+第二行 结论/.test(t), '换行留着');
    assert.ok(t.includes('老师的话'.repeat(80)), '板顶那句话不截');
    assert.ok(t.includes('行59'), '舞台现状不只前 40 行');
  } finally { useFullText(false); }
});

test('页面里的老师：照旧截短', () => {
  const t = boardStateText(board);
  assert.ok(!t.includes('很长的推导'.repeat(120)));
  assert.ok(!t.includes('行59'));
});
