// 记忆底座的最后一轮（docs/superpowers/plans/2026-11-16-memory-base.md 任务 10）：独立审读查出来的，
// 有记忆摘要时旧的规则、守则、关于学生、失误还能绕回模型提示词的几个口子，和几处说明里的假话。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tidyText, tidyDue, closingExtras, knowNotes } from '../kit/src/memory/memo.js';
import { classMemoryReadDoc, buildTalkSystem } from '../kit/src/class/prompt.js';
import { LAB_VERSION } from '../kit/src/memory/lab.js';
import { prepPrompt } from '../kit/src/books/plan.js';
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

test('closingExtras：黑板课和舞台课下课共用；有摘要时不带没归纳的失误、不带旧几类的目录', () => {
  const mem = manyProfile(sampleMemory('2026-11-01'));
  mem.slips = [{ id: 'S-1', text: '一次出了两道题', status: 'open', session: 'c-20261101-1' }];
  const off = closingExtras(mem, 'math', 'c-x', { summary: false });
  assert.ok(off.tidy && /关于学生/.test(off.tidy.text));
  const on = closingExtras(withSummary(mem), 'math', 'c-x', { summary: true });
  assert.equal(on.slips, '');
  assert.ok(!on.tidy || !/关于学生|讲解先给结论/.test(on.tidy.text));
  for (const f of ['kit/src/class/classroom.js', 'kit/src/stage/classroom.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(src, /closingExtras\(/, `${f} 下课用 closingExtras`);
    assert.doesNotMatch(src, /slipsToFold\(/, `${f} 不再自己拼没归纳的失误`);
  }
  // 舞台课下课也告诉 closingPrompt 有没有摘要
  assert.match(readFileSync(new URL('../kit/src/stage/classroom.js', import.meta.url), 'utf8'), /closingPrompt\(\{\s*summary\b/);
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

test('教研室的单子换了写法：版本号升了，部署前拼好的旧单子会照新写法重拼', () => {
  assert.ok(LAB_VERSION >= 7);
});

test('备课提示词：有摘要时不再规定课的形式；没有摘要逐字照旧', () => {
  const args = { block: { id: 'L5-01', title: '特征值' }, subject: '线代', memoryText: '（记忆）', components: ['answer'], due: '- R1 秩' };
  const off = prepPrompt(args);
  assert.match(off, /照着上/);
  assert.match(off, /一步一块板/);
  assert.match(off, /按内容分步，讲透为先/);
  const on = prepPrompt({ ...args, summary: true });
  for (const w of ['照着上', '一步一块板', '先讲后练', '讲透为先', '按学生的规则', '感觉像不像', '三到六行']) assert.ok(!on.includes(w), `有摘要时备课提示词里还有「${w}」`);
  // 底线留着：题目用到的规则出题前要讲过、答案先自己算
  assert.match(on, /题目要用的规则[\s\S]{0,40}讲过/);
  assert.match(on, /答案自己先算一遍/);
  // JSON 的字段不变（页面照它读回、核依赖）
  for (const k of ['"unit"', '"goal"', '"route"', '"review"', '"methods"', '"sequence"', '"problems"', '"needs"', '"after"']) assert.ok(on.includes(k), k);
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

test('一问一答接着上：有摘要时说明里也有「这节课学生打的话」', () => {
  const sys = buildTalkSystem({ componentDocs: '', pack: {}, board: '', subject: '线代', memory: { mem: withSummary(), block: 'L5-01', space: 'math', session: 'c-1', saidNow: '第 3 轮：先给结论' } });
  assert.match(sys, /这节课学生打的话[\s\S]*第 3 轮：先给结论/);
});

test('quoteFound：用省略号拆开的每一段太短，不算找到', () => {
  const corpus = '我觉得不太懂这一段，后面也是这样，懂了再说';
  assert.ok(!quoteFound('我……不……懂', corpus));
  assert.ok(quoteFound('我觉得不太懂……懂了再说', corpus));
});
