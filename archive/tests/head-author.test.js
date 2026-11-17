// 第十一轮 B1：班主任（页面上的总 Claude）写记忆的作者 head：改动单记 by: head、能撤销、守卫照旧
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { parseMemoLines } = await import('../kit/src/memory/memo.js');
const { createMemOps } = await import('../kit/src/memory/memops.js');
const { fakeDb } = await import('../kit/src/live/store.js');
const { ROLES, COLLECTIONS } = await import('../kit/src/memory/schema.js');
const { AUTHORS } = await import('../kit/src/memory/guard.js');
const { validateWrite } = await import('../kit/src/memory/writer.js');

test('head 是一种角色、守卫认得、改动单和失误能记 by: head', () => {
  assert.ok(ROLES.includes('head'));
  assert.equal(AUTHORS.head.strict, false);
  assert.ok(COLLECTIONS.pending.enums.by.includes('head'));
  assert.ok(COLLECTIONS.slips.enums.by.includes('head'));
});

test('班主任的 memo：写进去、改动单记 by: head', async () => {
  const db = fakeDb(`head-${Math.random()}`);
  db._clear();
  await db.doc('evidence/ev-h1').set({ chat: 'h-20261115-1', session: null, src: 'say', kind: 'say', text: '下个月期末，只有周末有空', at: 5 });
  let mem = { evidence: [{ id: 'ev-h1', chat: 'h-20261115-1', src: 'say', text: '下个月期末，只有周末有空', at: 5 }], profile: [] };
  const ops = createMemOps({ db, mem: () => mem });
  const { entries } = parseMemoLines('pref topic=时间 text="下个月期末，只有周末有空" basis=ev-h1');
  const r = await ops.applyMemo(entries, { author: 'head', evidence: mem.evidence });
  assert.deepEqual(r.rejected, []);
  assert.equal(r.pds[0].by, 'head');
  const pend = (await db.collection('pending').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  assert.equal(pend[0].by, 'head');
  assert.deepEqual(validateWrite(`pending/${pend[0].id}`, pend[0]), []);
});
