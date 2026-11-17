// 课后那一轮、第一次整理的调度（审查找出的三处）：没成的续轮不能无限再试；调用之前先记「试过」（一两分钟的调用里整页刷新也不重来）；
// 写回时只改 after 那一块（调用的时候别处写的不冲掉）；回的不是 Opus 5.5 时，这一轮用 write 改的撤回去。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAfter } from '../kit/src/project/afterdesk.js';
import { needsAfter, AFTER_FAILS } from '../kit/src/project/after.js';

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const rows = (path) => [...docs.entries()].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => structuredClone(v) }));
  return {
    docs,
    doc: (path) => ({ get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }), set: async (v) => { docs.set(path, structuredClone(v)); }, delete: async () => { docs.delete(path); } }),
    collection: (path) => ({ get: async () => ({ docs: rows(path) }), where: () => ({ get: async () => ({ docs: rows(path) }) }) }),
  };
}
const s0 = { id: 'c-1', kind: 'class', status: 'closed', title: '情态', endedAt: 10 };
const make = (db, call) => createAfter({ db, ai: async () => ({ tools: true, call }), getData: () => ({}), notebook: null, system: () => '说明', now: () => 100 });

test('续轮没成的也只试到 AFTER_FAILS 次', () => {
  assert.equal(needsAfter({ ...s0, after: { at: 1, cont: true, rounds: 1, fails: AFTER_FAILS } }, { since: 0 }), false);
  assert.equal(needsAfter({ ...s0, after: { at: 1, cont: true, rounds: 1, fails: 1 } }, { since: 0 }), true);
});

test('调用之前先记一次试过；成了 fails 清零', async () => {
  const db = fakeDb({ 'sessions/c-1': { ...s0 } });
  let seen = null;
  await make(db, async () => { seen = db.docs.get('sessions/c-1').after; return { text: '好了', modelApplied: 'claude-opus-5-5' }; }).after(s0);
  assert.equal(seen?.fails, 1, '调用的时候库里已经记着这一次');
  assert.equal(db.docs.get('sessions/c-1').after.fails, 0);
  assert.equal(db.docs.get('sessions/c-1').after.at, 100);
});

test('写回只改 after：调用期间别处写进这节课的不冲掉', async () => {
  const db = fakeDb({ 'sessions/c-1': { ...s0 } });
  await make(db, async () => { db.docs.set('sessions/c-1', { ...db.docs.get('sessions/c-1'), skills: { at: 5 } }); return { text: 'x', modelApplied: 'claude-opus-5-5' }; }).after(s0);
  assert.deepEqual(db.docs.get('sessions/c-1').skills, { at: 5 });
});

test('回的不是 Opus 5.5：这一轮 write 改的撤回去', async () => {
  const db = fakeDb({ 'sessions/c-1': { ...s0 }, 'mastery/L1': { state: '未学' } });
  const r = await make(db, async (_t, opts) => {
    await opts.tools.find((t) => t.name === 'write').execute({ op: 'update', path: 'mastery/L1', data: { state: '基础题过' } });
    await opts.tools.find((t) => t.name === 'write').execute({ op: 'set', path: 'meta/today', data: { date: '2026-11-18', items: [] } });
    return { text: 'x', modelApplied: 'claude-sonnet-5-5' };
  }).after(s0);
  assert.equal(r, 'failed');
  assert.equal(db.docs.get('mastery/L1').state, '未学');
  assert.equal(db.docs.has('meta/today'), false);
});

test('第一次整理也先记试过、只合并自己的字段', async () => {
  const db = fakeDb({ 'meta/project': { other: 1 } });
  let seen = null;
  await make(db, async () => { seen = db.docs.get('meta/project'); db.docs.set('meta/project', { ...db.docs.get('meta/project'), x: 2 }); return { text: '好了', modelApplied: 'claude-opus-5-5' }; }).organize([]);
  assert.equal(seen?.fails, 1);
  const p = db.docs.get('meta/project');
  assert.equal(p.x, 2);
  assert.equal(p.other, 1);
  assert.ok(p.since);
});
