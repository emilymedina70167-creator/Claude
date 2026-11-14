// 第十一轮 A2：「学生的要求」每次调用都在记忆那一节最前面、全文（docs/superpowers/specs/2026-11-14-round11-design.md 6.3、6.4）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { memoryDigest } = await import('../kit/src/memory/digest.js');
const { MEMORY_BUDGET } = await import('../kit/src/class/prompt.js');

const filler = (n) => '这是一条很长的通用规则，讲怎么讲课、怎么出题、怎么记录，'.repeat(n);
const ask = (id, text, extra = {}) => ({ id, text, quotes: [{ ev: `ev-${id}`, at: 1, session: 'c-1', text: `原话 ${id}` }], status: 'active', since: '2026-11-05', scope: 'all', checks: [], broken: 0, ...extra });
function mem() {
  return {
    rules: Array.from({ length: 70 }, (_, i) => ({ id: `rule-g-${i}`, cat: '讲解', text: `第 ${i} 条：${filler(3)}`, since: '2026-10-01', source: '我', status: 'active' })),
    errors: Array.from({ length: 12 }, (_, i) => ({ id: `EN-L1-${10 + i}`, block: 'EN-L1.2.1', date: '2026-11-01', q: `题面 ${i}：${filler(2)}`, mine: 'x', cause: filler(2) })),
    curriculum: [{ id: 'EN-L1.2.1', title: '时态', level: 'block' }],
    asks: [
      ask('A-1', '开场复习最多两三句，主要时间给新内容', { quotes: [{ ev: 'e1', at: 1, session: 'c-1', text: '直接开始学新内容' }, { ev: 'e2', at: 2, session: 'c-2', text: '只做2-3句就行啊' }], broken: 2 }),
      ask('A-2', '画面上任何两样东西都不能重叠'),
      ask('A-3', '矩阵乘法先讲几何意义', { scope: 'math' }),
      ask('A-4', '旧的那条', { status: 'replaced', into: 'A-2' }),
      ask('A-5', '话框放中间', { quotes: [{ ev: 'e9', at: 9, session: 'c-now', text: '话框是主要内容' }] }),
    ],
    saidOnce: [{ text: '这节课先不做阅读', ev: 'e8' }],
  };
}

test('要求全文排在最前，挤不掉', () => {
  const d = memoryDigest(mem(), { block: 'EN-L1.2.1', session: 'c-now', budget: MEMORY_BUDGET });
  const at = d.text.indexOf('## 学生的要求');
  assert.ok(at >= 0 && at < 600, '紧跟开头那一段');
  for (const t of ['开场复习最多两三句，主要时间给新内容', '画面上任何两样东西都不能重叠', '话框放中间']) assert.ok(d.text.includes(t), t);
  assert.ok(d.text.includes('只做2-3句就行啊'), '最近一次原话');
  assert.ok(d.text.includes('说过 2 次'));
  assert.ok(d.text.includes('犯过 2 次'));
  assert.ok(d.bytes <= MEMORY_BUDGET);
});

test('别科的、被换掉的不带', () => {
  const d = memoryDigest(mem(), { block: 'EN-L1.2.1', session: 'c-now', budget: MEMORY_BUDGET });
  assert.ok(!d.text.includes('矩阵乘法先讲几何意义'));
  assert.ok(!d.text.includes('旧的那条'));
});

test('这节课刚说的有标记、这一次的只在这节课', () => {
  const d = memoryDigest(mem(), { block: 'EN-L1.2.1', session: 'c-now', budget: MEMORY_BUDGET });
  assert.match(d.text, /话框放中间[^\n]*这节课刚说的/);
  assert.ok(d.text.includes('## 这节课学生说的'));
  assert.ok(d.text.includes('这节课先不做阅读'));
});

test('没有他她', () => {
  const m = mem();
  m.asks[1].text = '他说画面上任何两样东西都不能重叠';
  const d = memoryDigest(m, { block: 'EN-L1.2.1', session: 'c-now', budget: MEMORY_BUDGET });
  const sec = d.text.slice(d.text.indexOf('## 学生的要求'), d.text.indexOf('## 学生的要求') + 800);
  assert.ok(!/[他她]/.test(sec));
});
