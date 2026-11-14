// 第十一轮 A2：话的账的数据库这一层（kit/src/memory/saiddesk.js + memops.applySaid）：给一节课过账
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { createMemOps } = await import('../kit/src/memory/memops.js');
const { createSaid } = await import('../kit/src/memory/saiddesk.js');
const { fakeDb } = await import('../kit/src/live/store.js');

const SID = 'c-20261114-2';
const OPUS = 'claude-opus-5-5';
const rows = async (db, c) => (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

async function setup({ says = [], session = {}, asks = [] } = {}) {
  const db = fakeDb(`said-${Math.random()}`);
  db._clear();
  await db.doc(`sessions/${SID}`).set({ kind: 'stage', status: 'open', space: 'en', startedAt: 1000, date: '2026-11-14', ...session });
  for (const [id, text, at] of says) await db.doc(`evidence/${id}`).set({ session: SID, src: 'say', kind: 'say', text, at });
  for (const a of asks) { const { id, ...rest } = a; await db.doc(`asks/${id}`).set(rest); }
  await db.doc(`sessions/${SID}/class_turns/000001`).set({ seq: 1, role: 'claude', at: 1100, text: '我们先复习十二句' });
  let data = { sessions: await rows(db, 'sessions'), evidence: await rows(db, 'evidence'), asks: await rows(db, 'asks'), profile: [], lessons: [] };
  const ops = createMemOps({ db, mem: () => data });
  const calls = [];
  const reply = { fn: () => '' };
  const ai = async () => ({ call: async (prompt, opts) => { calls.push({ prompt, opts }); const r = await reply.fn(prompt, calls.length); return typeof r === 'string' ? { text: r, modelApplied: OPUS } : r; } });
  const said = createSaid({ db, getData: () => data, ops, ai });
  const refresh = async () => { data = { ...data, sessions: await rows(db, 'sessions'), evidence: await rows(db, 'evidence'), asks: await rows(db, 'asks') }; };
  return { db, said, calls, reply, refresh, data: () => data };
}

test('过一节课：建要求、记去处、水位线前进', async () => {
  const t = await setup({ says: [['ev-a', '只做2-3句就行啊，这是来学新内容还是来复习的？', 1200], ['ev-b', 'readers是读者的意思吗？', 1300]] });
  t.reply.fn = () => 'ev-a｜新要求｜text=开场复习最多两三句｜scope=all\nev-b｜不用记｜why=问词义';
  assert.equal(await t.said.runFor(SID), 'done');
  const asks = await rows(t.db, 'asks');
  assert.equal(asks.length, 1);
  assert.equal(asks[0].quotes[0].text, '只做2-3句就行啊，这是来学新内容还是来复习的？');
  const rec = (await t.db.doc(`sessions/${SID}/said/main`).get()).data();
  assert.deepEqual(Object.keys(rec.lines).sort(), ['ev-a', 'ev-b']);
  assert.equal(rec.upTo, 1300);
  const s = (await t.db.doc(`sessions/${SID}`).get()).data();
  assert.equal(s.said.upTo, 1300);
  assert.equal(s.said.fails, 0);
  assert.equal(t.calls[0].opts.lane, 'bg');
  assert.equal(t.calls[0].opts.model, OPUS);
});

test('回的不是 Opus：什么都不写、fails 加一', async () => {
  const t = await setup({ says: [['ev-a', '别重叠', 1200]] });
  t.reply.fn = () => ({ text: 'ev-a｜新要求｜text=别重叠', modelApplied: 'claude-sonnet-5-5' });
  assert.equal(await t.said.runFor(SID), 'fail');
  assert.equal((await rows(t.db, 'asks')).length, 0);
  assert.equal((await t.db.doc(`sessions/${SID}/said/main`).get()).exists, false);
  assert.equal((await t.db.doc(`sessions/${SID}`).get()).data().said.fails, 1);
});

test('缺了一句再问一次，补上了就齐', async () => {
  const t = await setup({ says: [['ev-a', '继续', 1200], ['ev-b', '你重叠这件事情要犯几次？', 1300]] });
  t.reply.fn = (p, n) => (n === 1 ? 'ev-a｜不用记｜why=继续' : 'ev-b｜新要求｜text=画面上的东西不能重叠｜scope=all｜measure=overlap');
  assert.equal(await t.said.runFor(SID), 'done');
  assert.equal(t.calls.length, 2);
  assert.ok(t.calls[1].prompt.includes('ev-b') && !t.calls[1].prompt.includes('学生打的：继续'));
  const asks = await rows(t.db, 'asks');
  assert.equal(asks[0].measure, 'overlap');
  assert.deepEqual((await t.db.doc(`sessions/${SID}/said/main`).get()).data().missing, []);
});

test('只有图：不调用，记成 photo', async () => {
  const t = await setup({ says: [['ev-p', '（在画面上用 Pencil 写了字）', 1200]] });
  assert.equal(await t.said.runFor(SID), 'none');
  assert.equal(t.calls.length, 0);
  assert.deepEqual((await t.db.doc(`sessions/${SID}/said/main`).get()).data().lines['ev-p'], [{ to: 'photo' }]);
});

test('挂着的、删着的课也要过账；练一练不用；试满两次不再试', async () => {
  const t = await setup({ says: [['ev-a', '别重叠', 1200]] });
  const base = t.data().sessions[0];
  assert.equal(t.said.needs({ ...base, status: 'open' }), true);
  assert.equal(t.said.needs({ ...base, status: 'closed', deleting: 123 }), true);
  assert.equal(t.said.needs({ ...base, kind: 'drill' }), false);
  assert.equal(t.said.needs({ ...base, said: { upTo: 1200 } }), false);
  assert.equal(t.said.needs({ ...base, said: { upTo: 0, fails: 2 } }), false);
});

test('刷新断在半路不重复建', async () => {
  const t = await setup({ says: [['ev-a', '别重叠', 1200]] });
  t.reply.fn = (p, n) => { if (n === 1) throw new Error('断了'); return 'ev-a｜新要求｜text=画面上的东西不能重叠'; };
  assert.equal(await t.said.runFor(SID), 'fail');
  assert.equal(await t.said.runFor(SID), 'done');
  assert.equal(await t.said.runFor(SID), 'none');
  assert.equal((await rows(t.db, 'asks')).length, 1);
});

test('说第二遍：那一条记一次没做到', async () => {
  const old = { id: 'A-1', text: '开场复习最多两三句', quotes: [{ ev: 'ev-old', at: 10, session: 'c-1', text: '直接学新内容' }], status: 'active', since: '2026-11-05', scope: 'all', checks: [], broken: 0, log: [] };
  const t = await setup({ says: [['ev-x', '直接进入新内容学习', 1200]], asks: [old] });
  t.reply.fn = () => 'ev-x｜又说了｜A-1｜why=没照做';
  assert.equal(await t.said.runFor(SID), 'done');
  const a = (await rows(t.db, 'asks'))[0];
  assert.equal(a.broken, 1);
  assert.equal(a.checks[0].result, 'broken');
  assert.equal(a.checks[0].session, SID);
  assert.equal(a.quotes.length, 2);
});
