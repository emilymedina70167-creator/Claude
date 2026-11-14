// 第十一轮 A1：老师的 memo 多一种 ask（学生要老师以后照做的单独记进「我的要求」asks，原话页面从证据抄）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { parseMemoLines } = await import('../kit/src/memory/memo.js');
const { createMemOps } = await import('../kit/src/memory/memops.js');
const { fakeDb } = await import('../kit/src/live/store.js');

const SID = 'c-20261114-2';
const SAY = '只做2-3句就行啊，这是来学新内容还是来复习的？';
async function setup(extra = {}) {
  const db = fakeDb(`memo-ask-${Math.random()}`);
  db._clear();
  await db.doc('evidence/ev-s1').set({ session: SID, src: 'say', kind: 'say', text: SAY, at: 10 });
  await db.doc('evidence/ev-r1').set({ session: SID, src: 'record', comp: 'S12', ok: true, at: 20 });
  for (const [c, docs] of Object.entries(extra)) for (const d of docs) { const { id, ...rest } = d; await db.doc(`${c}/${id}`).set(rest); }
  const read = async () => { const out = {}; for (const c of ['asks', 'profile', 'evidence', 'pending']) out[c] = (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() })); return out; };
  let mem = await read();
  return { ops: createMemOps({ db, mem: () => mem }), read };
}

test('ask 建一条要求，原话是证据里的', async () => {
  const { ops, read } = await setup();
  const { entries } = parseMemoLines('ask text="开场复习最多两三句，主要时间给新内容" basis=say');
  const r = await ops.applyMemo(entries, { session: SID });
  assert.deepEqual(r.rejected, []);
  const asks = (await read()).asks;
  assert.equal(asks.length, 1);
  assert.equal(asks[0].id, 'A-1');
  assert.equal(asks[0].quotes[0].text, SAY);
  assert.equal(asks[0].quotes[0].ev, 'ev-s1');
  assert.equal(asks[0].status, 'active');
});

test('没挂学生的话不收', async () => {
  const { ops } = await setup();
  const { entries } = parseMemoLines('ask text="开场复习最多两三句" basis=ev-r1');
  const r = await ops.applyMemo(entries, { session: SID });
  assert.equal(r.rejected.length, 1);
  assert.ok(r.rejected[0].error.includes('say'));
});

test('几乎一样的不收，提示已有的那条', async () => {
  const have = { id: 'A-1', text: '开场复习最多两三句，主要时间给新内容', quotes: [{ ev: 'ev-x', at: 1, session: 'c-1', text: '直接学新内容' }], status: 'active', since: '2026-11-05', scope: 'all', checks: [], broken: 0 };
  const { ops } = await setup({ asks: [have] });
  const { entries } = parseMemoLines('ask text="开场复习最多两三句，主要时间给新内容" basis=say');
  const r = await ops.applyMemo(entries, { session: SID });
  assert.equal(r.rejected.length, 1);
  assert.ok(r.rejected[0].error.includes('A-1'));
});

test('助手不能写 ask', async () => {
  const { ops } = await setup();
  const { entries } = parseMemoLines('ask text="开场复习最多两三句" basis=say');
  const r = await ops.applyMemo(entries, { session: SID, author: 'aide' });
  assert.equal(r.rejected.length, 1);
});
