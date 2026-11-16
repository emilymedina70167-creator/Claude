import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMemoLines, splitKnow } from '../kit/src/memory/memo.js';
import { buildSystem, closingPrompt, deskDoc, SUMMARY_MEMO_DOC } from '../kit/src/class/prompt.js';
import { headSystem } from '../kit/src/head/context.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const lines = `know text="读了十分钟以后来了 9 句，学生叫停" basis=say
know text="术语第一次出现附英文" shared=1
pref topic=讲法 text="先看图再推公式" basis=say
ask text="开场复习最多两三句" basis=say
ask id=A-3 status=dropped why="学生说不用了"
rule cat=讲解 text="讲法自造" space=math
slip text="没看清学生写的是哪一格就判了错" lesson="判错之前先看清"
lesson id=T-3 again="b7 没讲划块就出了题"
error step="第 1 步" cause="把秩和阶数混了" basis=q-b5
position next="接着讲被动"`;

test('know 这一种读得懂', () => {
  const { entries, errors } = parseMemoLines(lines);
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 10);
});

test('有摘要：know 和旧的五种都进新笔记，作废旧条目的丢掉，学习的账照旧', () => {
  const { entries } = parseMemoLines(lines);
  const { notes, rest } = splitKnow(entries, { on: true });
  assert.deepEqual(rest.map((e) => e.kind), ['error', 'position']);
  assert.deepEqual(notes.map((n) => n.text), [
    '读了十分钟以后来了 9 句，学生叫停', '术语第一次出现附英文', '讲法：先看图再推公式', '开场复习最多两三句', '讲法自造',
    '没看清学生写的是哪一格就判了错；判错之前先看清', 'b7 没讲划块就出了题',
  ]);
  assert.deepEqual(notes.map((n) => n.say), [true, false, true, true, false, false, false]);
  assert.equal(notes[1].shared, true);
  assert.equal(notes[4].space, 'math');
});

test('没有摘要：只有 know 进新笔记，别的照旧', () => {
  const { entries } = parseMemoLines(lines);
  const { notes, rest } = splitKnow(entries, { on: false });
  assert.equal(notes.length, 2);
  assert.equal(rest.length, 8);
});

const mem = () => sampleMemory('2026-11-01');
const block = (m) => m.position.find((d) => d.id === 'now').block;
const sys = (m) => buildSystem({ componentDocs: '', pack: { main: {}, problems: {} }, board: { aims: [] }, subject: '线代', memory: { mem: m, block: block(m), session: 'c-x' } });
const noHe = (t) => assert.doesNotMatch(t.replaceAll('「他」「她」', ''), /(?<![其吉利])[他她](?![们人])/);

test('老师的说明：有摘要时记忆块只教 know 和学习的账；没有时照旧', () => {
  const m = mem();
  const plain = sys(m);
  assert.match(plain, /教学守则/);
  assert.match(plain, /ask text=/);
  assert.doesNotMatch(plain, /know text=/);
  const withSum = sys({ ...m, summary: [{ id: 'math', text: '线代用张宇 30 讲。', v: 1, notes: [] }] });
  assert.match(withSum, /## 你对这个学生的了解（记忆摘要）/);
  assert.match(withSum, /know text=/);
  assert.match(withSum, /不替学生推广成「以后每次都……」/);
  assert.doesNotMatch(withSum, /教学守则|ask text=|slip text=|学生要你以后照做的|这个学生另外定的规则/);
  assert.match(withSum, /这节课要拿下的事/); // 写 board aims 的那一段照旧
  assert.ok(withSum.length < plain.length + 400);
  noHe(SUMMARY_MEMO_DOC);
  assert.ok(Buffer.byteLength(deskDoc({ summary: true })) < Buffer.byteLength(deskDoc({})));
});

test('下课：有摘要时不归纳守则，叫老师写 know', () => {
  const a = closingPrompt({ report: '报告正文', slips: '没归纳的失误……', tidy: { why: '到了 5 节', text: '弱点目录' } });
  const b = closingPrompt({ summary: true, report: '报告正文', slips: '没归纳的失误……', tidy: { why: '到了 5 节', text: '弱点目录' } });
  assert.match(a, /归纳教学失误/);
  assert.doesNotMatch(b, /归纳教学失误|没归纳的失误|守则|关于学生的记录重复|前面「规则」里/);
  assert.match(b, /写几行 `know`/);
  assert.match(b, /position[^\n]*一定写/);
  assert.match(b, /弱点目录/);
  assert.match(b, /报告正文/);
  noHe(b);
});

test('班主任：有摘要时给四份摘要，不列要求；记忆块说明换成 know 那一份', () => {
  const asks = [{ id: 'A-1', text: '开场复习最多两三句', status: 'active', quotes: [] }];
  const a = headSystem({ asks, today: '2026-11-17' });
  assert.match(a, /## 学生的要求/);
  const b = headSystem({ asks, today: '2026-11-17', summaries: [{ id: 'shared', text: '学生目标南大。' }, { id: 'en', text: '英语按语法模块学。' }] });
  assert.doesNotMatch(b, /## 学生的要求|开场复习最多两三句|ask text=/);
  assert.match(b, /### 三科共用\n\n学生目标南大。/);
  assert.match(b, /### 英语\n\n英语按语法模块学。/);
  assert.match(b, /know text=/);
  noHe(b);
});
