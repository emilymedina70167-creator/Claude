// 照 claude.ai 的记忆（第十四轮）：对话以后后台给项目 Claude 一轮整理（课后那一轮），笔记本空着时先整理一次以前的记录。
// 页面只给机会、只写事实，做什么它定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsAfter, afterPrompt, needsOrganize, organizePrompt, AFTER_FAILS, AFTER_ROUNDS } from '../kit/src/project/after.js';
import { FORBIDDEN } from '../kit/src/project/system.js';

const since = Date.parse('2026-11-17T08:00:00Z');
const s = { id: 'c-20261118-1', kind: 'class', status: 'closed', title: '情态动词', date: '2026-11-18', endedAt: since + 3600e3 };

test('课后那一轮：下了课、在第一次整理以后结束、还没给过的才给', () => {
  assert.equal(needsAfter(s, { since }), true);
  assert.equal(needsAfter({ ...s, kind: undefined }, { since }), true, '以前的课没写 kind，是课堂');
  assert.equal(needsAfter({ ...s, status: 'open' }, { since }), false);
  assert.equal(needsAfter({ ...s, endedAt: since - 1 }, { since }), false, '第一次整理以前上的课由那一次整理读');
  assert.equal(needsAfter(s, { since: undefined }), false, '第一次整理还没做完');
  assert.equal(needsAfter({ ...s, after: { at: 1 } }, { since }), false);
  assert.equal(needsAfter({ ...s, deleting: true }, { since }), false);
  assert.equal(needsAfter({ ...s, kind: 'drill' }, { since }), false);
});
test('没成的试满几次就停；上一轮没做完的接着给（最多几轮）', () => {
  assert.equal(AFTER_FAILS, 2);
  assert.equal(needsAfter({ ...s, after: { fails: 1 } }, { since }), true);
  assert.equal(needsAfter({ ...s, after: { fails: AFTER_FAILS } }, { since }), false);
  assert.equal(needsAfter({ ...s, after: { at: 1, cont: true, rounds: 1 } }, { since }), true);
  assert.equal(needsAfter({ ...s, after: { at: 1, cont: true, rounds: AFTER_ROUNDS } }, { since }), false);
});
test('课后那一轮的提示只写事实：哪节课、东西在哪', () => {
  const t = afterPrompt(s);
  for (const x of ['情态动词', '2026-11-18', 'sessions/c-20261118-1/report/main', 'sessions/c-20261118-1/class_turns', 'evidence']) assert.ok(t.includes(x), x);
  for (const w of FORBIDDEN) assert.ok(!t.includes(w), w);
  assert.match(afterPrompt({ ...s, after: { cont: true, last: '读到第 20 轮' } }), /上一轮没做完.*读到第 20 轮/s);
});
test('第一次整理：笔记本空着、还没做过才做；提示列出以前的记录在哪、几条', () => {
  assert.equal(needsOrganize([], null), true);
  assert.equal(needsOrganize([{ path: 'a.md' }], null), false);
  assert.equal(needsOrganize([], { since: 1 }), false);
  assert.equal(needsOrganize([{ path: 'a.md', deleted: true }], null), true);
  const t = organizePrompt([{ collection: 'rules', n: 72 }, { collection: 'summary', n: 4 }]);
  assert.match(t, /笔记本还是空的/);
  assert.match(t, /rules 72 条/);
  for (const w of FORBIDDEN) assert.ok(!t.includes(w), w);
});
