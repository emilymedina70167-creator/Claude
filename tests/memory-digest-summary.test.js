import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryDigest } from '../kit/src/memory/digest.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const before = JSON.parse(readFileSync(new URL('./fixtures/digest-before.json', import.meta.url), 'utf8'));
const opts = (use) => ({ block: before.block, session: 'c-x', today: '2026-11-01', use, budget: 28 * 1024 });
const withRules = () => {
  const mem = sampleMemory('2026-11-01');
  mem.rules = [...mem.rules, { id: 'rule-rec-9', cat: '细则', text: '错题只增不改：写出处、题面、错在哪一步', since: '2026-09-01', source: '学生定的', status: 'active', use: 'record' }];
  mem.asks = [{ id: 'A-1', text: '开场复习最多两三句', status: 'active', since: '2026-11-05', quotes: [{ at: 1, text: '直接开始学新内容' }] }];
  return mem;
};
const withSummary = () => ({ ...withRules(), summary: [
  { id: 'shared', text: '学生在备考 2027 年考研。说过「直接开始学新内容」（11-05、11-12 两次）。', v: 1, notes: [] },
  { id: 'math', text: '线代用张宇 30 讲。外积那一块做过两次，第二次独立做对。', v: 1, notes: [{ text: '学生嫌例题的数太大', at: Date.UTC(2026, 10, 1), by: 'class' }] },
] });
const heads = (t) => t.split('\n').filter((l) => l.startsWith('## '));

test('没有摘要：记忆那一节和改之前逐字一样', () => {
  for (const use of ['teach', 'all']) assert.deepEqual(memoryDigest(sampleMemory('2026-11-01'), opts(use)), before.out[use], use);
});

test('有摘要：最前面是摘要全文，规则、守则、关于学生、失误、要求都不带', () => {
  const d = memoryDigest(withSummary(), opts('teach'));
  assert.equal(d.summary, true);
  assert.equal(d.rules, '');
  const hs = heads(d.text);
  assert.equal(hs[0], '## 你对这个学生的了解（记忆摘要）');
  for (const gone of ['教学守则', '学生（profile）', '还没归纳进守则的教学失误', '学生的要求', '记录的制度']) assert.ok(!hs.some((h) => h.includes(gone)), gone);
  assert.match(d.text, /### 三科共用\n\n学生在备考/);
  assert.match(d.text, /### 数学\n\n线代用张宇/);
  assert.match(d.text, /学生嫌例题的数太大/);
  assert.doesNotMatch(d.text, /每一条都要做到|开场复习最多两三句/);
  // 目录里也不列这几类
  assert.doesNotMatch(d.text, /规则（没放全文的）|关于学生（没放全文的）|教学守则（没放全文的）|还没归纳的教学失误/);
  assert.ok(d.bytes <= 28 * 1024);
});

test('有摘要：学习的账那几节和没有摘要时逐字一样', () => {
  const a = memoryDigest(withRules(), opts('teach')).text;
  const b = memoryDigest(withSummary(), opts('teach')).text;
  const sec = (t, h) => { const i = t.indexOf(`## ${h}`); if (i < 0) return ''; const j = t.indexOf('\n## ', i + 3); return t.slice(i, j < 0 ? t.length : j); };
  for (const h of ['上一节停在哪', '课程地图', '相关的弱点', '相关的错题', '掌握状态']) { assert.ok(sec(a, h), h); assert.equal(sec(b, h), sec(a, h), h); }
});

test('有摘要：下课、复现、备课那几次带「记录的制度」，平时不带', () => {
  const all = memoryDigest(withSummary(), opts('all'));
  assert.match(all.text, /## 记录的制度（学生定的[^\n]*\n\n- ［细则］错题只增不改/);
  assert.equal(all.rules, '');
  assert.doesNotMatch(memoryDigest(withSummary(), opts('teach')).text, /错题只增不改/);
});

test('只有新笔记、还没有正文的摘要也算有', () => {
  const mem = { ...withRules(), summary: [{ id: 'math', text: '', notes: [{ text: '学生说先讲结论', at: 1 }] }] };
  const d = memoryDigest(mem, opts('teach'));
  assert.equal(d.summary, true);
  assert.match(d.text, /学生说先讲结论/);
});
