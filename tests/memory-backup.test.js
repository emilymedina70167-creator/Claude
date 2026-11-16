// 备份、恢复带着记忆摘要（清点第三节）：摘要是老师每一轮都读的那一份，丢了等于老师不认识学生了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupFile, restorePlan, restoreBatches } from '../kit/src/memory/backup.js';
import { sampleMemory } from '../kit/src/memory/sample.js';
import { SUMMARY_IDS } from '../kit/src/memory/summary.js';

const summaries = () => [
  { id: 'shared', text: '学生在备考 2027 年考研。\n\n学生说过「我说了什么，下一次都肯定会改」。', v: 3, at: 300, by: 'page', since: 100, src: 'sessions/c-20261116-1',
    notes: [{ text: '喜欢先看结论', quote: '先给我结论', session: 'c-20261116-1', by: 'class', at: 310 }],
    history: [{ text: '第一版', v: 1, at: 100, by: 'chat' }, { text: '第二版', v: 2, at: 200, by: 'me' }] },
  { id: 'math', text: '线代学到特征值。', v: 1, at: 100, by: 'chat', since: 100, notes: [], history: [] },
  { id: 'cs', text: '数据结构学到希尔排序。', v: 2, at: 250, by: 'page', since: 100, notes: [], history: [{ text: '旧的', v: 1, at: 100, by: 'chat' }] },
  { id: 'en', text: '英语一：长难句。', v: 1, at: 100, by: 'chat', since: 100, notes: [{ text: '表格比一段话好认', quote: '', session: '', by: 'head', at: 320 }], history: [] },
];
const strip = ({ id: _, ...rest }) => rest;

test('四份摘要（带新笔记、以前几版）导出再恢复，逐字一样', () => {
  const memory = { ...sampleMemory('2026-11-01'), summary: summaries() };
  const file = JSON.parse(JSON.stringify(backupFile({ memory, today: '2026-11-16' })));
  assert.equal(file.counts.summary, 4);
  const { writes } = restorePlan(file);
  for (const want of summaries()) {
    const w = writes.find((x) => x.path === `summary/${want.id}`);
    assert.ok(w, `备份里有 ${want.id}`);
    assert.deepEqual(w.data, strip(want));
  }
  assert.deepEqual(SUMMARY_IDS.map((id) => writes.some((x) => x.path === `summary/${id}`)), [true, true, true, true]);
});

test('只补缺的：不盖掉数据库里已经有的摘要；说了覆盖才盖', () => {
  const file = backupFile({ memory: { summary: summaries() }, today: '2026-11-16' });
  const have = new Set(['summary/shared', 'summary/en']);
  const keep = restorePlan(file, { have });
  assert.deepEqual(keep.writes.map((w) => w.path).sort(), ['summary/cs', 'summary/math']);
  assert.equal(keep.clash, 2);
  const over = restorePlan(file, { have, overwrite: true });
  assert.equal(over.writes.length, 4);
});

test('开发那边照 batch 恢复：四份都在，已有的带版本或跳过', () => {
  const file = backupFile({ memory: { summary: summaries() }, today: '2026-11-16' });
  const all = restoreBatches(file).flat().filter((w) => w.collection === 'summary');
  assert.equal(all.length, 4);
  const skip = restoreBatches(file, { existing: { 'summary/shared': 7 }, skipExisting: true }).flat();
  assert.ok(!skip.some((w) => w.collection === 'summary' && w.doc_id === 'shared'));
  const ver = restoreBatches(file, { existing: { 'summary/shared': 7 } }).flat().find((w) => w.doc_id === 'shared');
  assert.equal(ver.if_version, 7);
});
