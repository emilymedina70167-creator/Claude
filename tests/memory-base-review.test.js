// 记忆底座的最后一轮：独立审读查出来的，
// 有记忆摘要时旧的规则、守则、关于学生、失误还能绕回模型提示词的几个口子，和几处说明里的假话。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tidyText, tidyDue, closingExtras, knowNotes } from '../kit/src/memory/memo.js';
import { classMemoryReadDoc } from '../kit/src/class/prompt.js';
import { memoryDigest } from '../kit/src/memory/digest.js';
import { quoteFound } from '../kit/src/memory/summary.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const withSummary = (mem = sampleMemory('2026-11-01')) => ({
  ...mem,
  summary: [{ id: 'shared', text: '学生在备考 2027 年考研。', v: 1, at: 1, since: 1 }, { id: 'math', text: '线代学到特征值。', v: 1, at: 1, since: 1 }],
});
const manyProfile = (mem) => ({ ...mem, profile: Array.from({ length: 34 }, (_, i) => ({ id: `P${i}`, topic: '讲法', text: `关于学生的旧记录第${i}条：讲解先给结论`, status: 'active' })) });

test('下课的整理目录：有摘要时不列「关于学生」，旧几类的条数也不再叫整理', () => {
  const mem = manyProfile(sampleMemory('2026-11-01'));
  // 没有摘要：照旧（关于学生 34 条到了上限，叫整理，目录里有原文）
  assert.match(tidyDue(mem, 'math', 'c-x'), /34 条/);
  assert.match(tidyText(mem, 'math'), /关于学生（34 条）[\s\S]*讲解先给结论/);
  const on = withSummary(mem);
  assert.doesNotMatch(tidyDue(on, 'math', 'c-x'), /34 条|规则|守则/);
  assert.doesNotMatch(tidyText(on, 'math'), /关于学生|讲解先给结论/);
});


test('课堂查记忆的工具说明：有摘要时先说 summary，旧五类写明不是规程；没有摘要逐字照旧', () => {
  const old = '查学习台的记忆库（只读）。collection 写集合名：rules、profile、curriculum、errors、weaknesses、mastery、reviews、recall、position、slips、lessons、observations、sessions、evidence。ids 写编号数组，一次取好几条的全文（比如 collection errors、ids ["L2-07","L2-31"]；同一类的放一起取）；id 取一条。sessions 写课的编号，给那节课的要点、课后报告和小结。不写 id / ids 时列出这一类（可以写 block 只要挨着这一块的）。evidence 按 block 或 session（这节课是 c-1）查最近的 30 条。每调用一次你要多等一整轮：照记忆里的目录挑准了编号，一次取够。';
  assert.equal(classMemoryReadDoc('c-1', false), old);
  const on = classMemoryReadDoc('c-1', true);
  assert.match(on, /summary/);
  assert.match(on, /不是规程|不再给你/);
  assert.doesNotMatch(on, /collection 写集合名：rules/);
  assert.match(readFileSync(new URL('../kit/src/class/classroom.js', import.meta.url), 'utf8'), /classMemoryReadDoc\(/);
});


test('记忆目录的说明：有摘要时不再叫老师「按某条规则做时去取原文」', () => {
  const on = memoryDigest(withSummary(), { block: 'L5-01', space: 'math', tools: true }).text;
  assert.doesNotMatch(on, /要按某条规则做又拿不准原文时才取/);
  const off = memoryDigest(sampleMemory('2026-11-01'), { block: 'L5-01', space: 'math', tools: true }).text;
  assert.match(off, /要按某条规则做又拿不准原文时才取/);
});

test('knowNotes：舞台课的轮次没有 say 字段，用学生那一轮的 text 当原话', () => {
  const entries = [{ kind: 'ask', attrs: { text: '画面别压着字', basis: 'say' }, line: 'ask text=画面别压着字 basis=say' }];
  const history = [{ role: 'student', seq: 3, text: '画面别压着字啊' }, { role: 'claude', seq: 4, text: '好' }];
  const r = knowNotes(entries, { on: true, history, space: 'en', session: 'c-1' });
  assert.equal(r.notes[0].quote, '画面别压着字啊');
});


test('quoteFound：用省略号拆开的每一段太短，不算找到', () => {
  const corpus = '我觉得不太懂这一段，后面也是这样，懂了再说';
  assert.ok(!quoteFound('我……不……懂', corpus));
  assert.ok(quoteFound('我觉得不太懂……懂了再说', corpus));
});
