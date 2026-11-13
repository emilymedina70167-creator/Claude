// 第九轮第 1 批：首页的助手（kit/src/aide/aidedesk.js）：下课后整理、补卡、写课前档案。用 ?dev 的替身数据库和一个假的 Claude
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { fakeDb } = await import('../kit/src/live/store.js');
const { createMemOps } = await import('../kit/src/memory/memops.js');
const { createAideDesk } = await import('../kit/src/aide/aidedesk.js');
const { loadCards } = await import('../kit/src/aide/load.js');

const SID = 'c-20261114-1';
const curriculum = [{ id: 'DS-L8.1.1', level: 'block', title: '排序的基本概念' }, { id: 'DS-L8.2.1', level: 'block', title: '直接插入排序', requires: ['DS-L8.1.1'] }];
const turns = [
  { seq: 1, role: 'claude', text: 'say "稳定是什么意思？"\nask text' },
  { seq: 2, role: 'student', text: '后进先出', msg: '[学生]\n写了「后进先出」' },
];
const REPLY = `## 复盘
误解｜还在｜把稳定当成后进先出｜#2 学生写「后进先出」

## 归类
point DS-L8.2.1#stable 稳定性的定义
item 1 DS-L8.2.1#stable

## 事实
\`\`\`\`board memo
note text="#2 学生写「后进先出」，把稳定理解成栈的顺序" basis=S1
\`\`\`\`

## 卡 DS-L8.2.1
概括｜稳定性还没过关
原话｜学生写「后进先出」（${SID}#2）
`;

async function setup(reply = REPLY, model = 'claude-opus-5-5', { throws = false } = {}) {
  const db = fakeDb(`aide-desk-${Math.random()}`);
  db._clear();
  for (const c of curriculum) { const { id, ...r } = c; await db.doc(`curriculum/${id}`).set(r); }
  const session = { date: '2026-11-14', block: 'DS-L8.2.1', title: '直接插入排序', status: 'closed', startedAt: 1, endedAt: 2, space: 'cs', kind: 'stage', aide: 1, report: { at: 5, items: 1 } };
  await db.doc(`sessions/${SID}`).set(session);
  for (const t of turns) await db.doc(`sessions/${SID}/class_turns/${String(t.seq).padStart(6, '0')}`).set(t);
  await db.doc('evidence/ev-a1').set({ session: SID, comp: 'S1', block: 'DS-L8.2.1', src: 'record', ok: false, value: '后进先出', q: '稳定是什么意思', at: 3, turn: 1 });
  await db.doc(`sessions/${SID}/report/main`).set({ at: 5, items: [{ key: 'S1', comp: 'S1', q: '稳定是什么意思', seq: '×', outcome: 'wrong', tags: ['DS-L8.2.1'], evidence: ['ev-a1'] }] });
  const read = async () => { const out = { evidence: [] }; for (const c of ['sessions', 'curriculum', 'errors', 'weaknesses', 'observations', 'mastery', 'recall', 'rules', 'lessons', 'profile', 'slips', 'reviews', 'position', 'pending']) out[c] = (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() })); return out; };
  let data = await read();
  const ops = createMemOps({ db, mem: () => data });
  const calls = [];
  const ai = { call: async (p, o) => { calls.push({ p, o }); if (throws) throw new Error('网络断了'); return { text: reply, modelApplied: model }; } };
  const desk = createAideDesk({ db, getData: () => data, ops, ai: async () => ai, packs: () => ({}) });
  return { db, desk, calls, read, refresh: async () => { data = await read(); } };
}

test('回的不是 Opus：什么都不写，记一次失败', async () => {
  const { db, desk } = await setup(REPLY, 'claude-sonnet-5-5');
  await desk.afterOne(SID);
  const s = (await db.doc(`sessions/${SID}`).get()).data();
  assert.equal(s.after.fails, 1);
  assert.ok(!s.debrief && !s.skills);
  assert.equal((await db.collection('cards').get()).docs.length, 0);
});

test('调用出错：同上', async () => {
  const { db, desk } = await setup(REPLY, 'claude-opus-5-5', { throws: true });
  await desk.afterOne(SID);
  assert.equal((await db.doc(`sessions/${SID}`).get()).data().after.fails, 1);
});

test('回的对：复盘、归类、事实、卡都写上；走后台', async () => {
  const { db, desk, calls } = await setup();
  await desk.afterOne(SID);
  assert.equal(calls[0].o.lane, 'bg');
  assert.equal(calls[0].o.model, 'claude-opus-5-5');
  const s = (await db.doc(`sessions/${SID}`).get()).data();
  assert.equal(s.debrief.mis.length, 1);
  assert.equal(s.skills.items.length, 1);
  assert.ok(s.after.at);
  assert.equal(s.after.took.cards, 1);
  const obs = (await db.collection('observations').get()).docs.map((d) => d.data());
  assert.ok(obs.some((o) => o.by === 'aide' && String(o.text).includes('栈的顺序')));
  const [card] = await loadCards(db, ['DS-L8.2.1']);
  assert.match(card.text, /概括｜稳定性还没过关/);
  assert.equal(card.by, 'aide');
});

test('卡超 2 KiB：卡不写，记下丢了的', async () => {
  const big = REPLY.replace('概括｜稳定性还没过关', `概括｜${'很长'.repeat(500)}`);
  const { db, desk } = await setup(big);
  await desk.afterOne(SID);
  assert.equal((await db.collection('cards').get()).docs.length, 0);
  assert.ok((await db.doc(`sessions/${SID}`).get()).data().after.dropped >= 1);
});

test('tick：先做下课后整理，没有要整理的才补卡', async () => {
  const { desk, calls, refresh } = await setup();
  await desk.tick({ once: true });
  assert.ok(calls[0].p.startsWith('你在给一节刚上完的舞台课做课后整理'));
  await refresh();
  await desk.tick({ once: true });
  assert.ok(!calls[1] || !calls[1].p.startsWith('你在给一节刚上完的舞台课做课后整理'));
});
