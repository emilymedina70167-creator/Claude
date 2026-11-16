// 第十三轮第 2 批任务 1：备课的记忆材料。有记忆摘要时不再另塞旧规则和教学守则（它们会顺着教案绕回课上）
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepMemory, prepPrompt } from '../kit/src/books/plan.js';
import { memoryDigest } from '../kit/src/memory/digest.js';
import { activeLessons } from '../kit/src/memory/memo.js';
import { sharedFor } from '../kit/src/memory/space.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const TODAY = '2026-11-01';
const base = () => {
  const mem = sampleMemory(TODAY);
  mem.rules = [...mem.rules, { id: 'rule-x1', cat: '黑板', text: '每块板的重点放进重点框放在前面', since: '2026-09-01', source: '学生定的', status: 'active' },
    { id: 'rule-rec-9', cat: '细则', text: '错题只增不改：写出处、题面、错在哪一步', since: '2026-09-01', source: '学生定的', status: 'active', use: 'record' }];
  return mem;
};
const block = (m) => m.position.find((d) => d.id === 'now').block;

test('没有摘要：和以前一样，规则、守则都给', () => {
  const mem = base();
  const got = prepMemory(mem, { block: block(mem), space: 'math', today: TODAY });
  assert.equal(got.memoryText, memoryDigest(mem, { block: block(mem), budget: 24 * 1024, tools: false, today: TODAY, use: 'all' }).text);
  assert.equal(got.rulesText, sharedFor(mem.rules, 'math').filter((r) => r.status !== 'void').map((r) => `- ［${r.cat || ''}］${r.text}`).join('\n'));
  assert.equal(got.lessons, activeLessons(mem.lessons, 'math').map((l) => `- ${l.id} ${l.text}`).join('\n'));
  assert.match(got.rulesText, /每块板的重点放进重点框/);
  assert.ok(got.lessons.length > 0);
});

test('有摘要：不再另塞规则和守则；记忆那一节里是摘要和记录的制度', () => {
  const mem = { ...base(), summary: [{ id: 'math', text: '线代用张宇 30 讲，一节一节学。', v: 1, notes: [] }] };
  const got = prepMemory(mem, { block: block(mem), space: 'math', today: TODAY });
  assert.equal(got.rulesText, '');
  assert.equal(got.lessons, '');
  assert.match(got.memoryText, /线代用张宇 30 讲/);
  assert.match(got.memoryText, /记录的制度[\s\S]*错题只增不改/);
  // 整份备课的提示词里一条旧规则、守则的原文都没有
  assert.equal(got.summary, true);
  const prompt = prepPrompt({ block: { id: block(mem), title: '外积' }, memoryText: got.memoryText, rulesText: got.rulesText, lessons: got.lessons, summary: got.summary, subject: '线代' });
  assert.doesNotMatch(prompt, /每块板的重点放进重点框/);
  for (const l of activeLessons(mem.lessons, 'math')) assert.ok(!prompt.includes(l.text), `守则原文不该在：${l.text.slice(0, 20)}`);
  assert.doesNotMatch(prompt, /## 教学守则|## 学生的规则/);
  assert.match(prompt, /## 学生的记忆/);
});
