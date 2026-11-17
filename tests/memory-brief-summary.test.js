// 第十三轮第 2 批任务 3：开场简报（班主任每一轮带三科的；外部 Claude 开场读一份）。有记忆摘要时目录里不再列规则、守则、关于学生
import test from 'node:test';
import assert from 'node:assert/strict';
import { deskBrief } from '../kit/src/memory/views.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const TODAY = '2026-11-01';
const withAsk = () => ({ ...sampleMemory(TODAY), asks: [{ id: 'A-1', text: '开场复习最多两三句', status: 'active', since: TODAY, quotes: [] }] });

test('没有摘要：简报照旧列规则、关于学生、守则', () => {
  for (const forHead of [true, false]) {
    const t = deskBrief(withAsk(), { space: 'math', today: TODAY, forHead }).text;
    assert.match(t, /\*\*规则\*\*/);
    assert.match(t, /\*\*关于学生\*\*/);
    assert.match(t, /\*\*教学守则\*\*/);
  }
});

test('有摘要：简报里不列规则、守则、关于学生、失误；学习的账照旧', () => {
  const mem = { ...withAsk(), summary: [{ id: 'math', text: '线代用张宇 30 讲。', v: 1, notes: [] }] };
  for (const forHead of [true, false]) {
    const t = deskBrief(mem, { space: 'math', today: TODAY, forHead }).text;
    assert.doesNotMatch(t, /\*\*规则\*\*|\*\*关于学生\*\*|\*\*教学守则\*\*|还没归纳的教学失误/);
    const old = deskBrief(withAsk(), { space: 'math', today: TODAY, forHead }).text;
    for (const head of ['**弱点', '**错题', '**课程地图']) assert.equal(t.includes(head), old.includes(head), head);
    assert.ok(t.includes('**弱点') || t.includes('**错题'), '学习的账还在');
  }
});

