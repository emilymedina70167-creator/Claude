// 第九轮收尾的几处（审查留下的小问题 + 自己查出来的）：每条先看测试失败再修
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { checkCardLines } = await import('../kit/src/aide/card.js');
const { createWatcher } = await import('../kit/src/aide/watcher.js');
const { judgmentsOnly } = await import('../kit/src/aide/after.js');
const { fakeDb } = await import('../kit/src/live/store.js');
const { createAideDesk } = await import('../kit/src/aide/aidedesk.js');
const { createMemOps } = await import('../kit/src/memory/memops.js');

const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));

test('卡上写寄存器 R1、R7（不在括号里的出处）：不当成记忆编号删掉；括号里引的 R99 照样核', () => {
  const mem = { reviews: [{ id: 'R1' }], curriculum: [{ id: 'CO-L5.1.1' }] };
  const r = checkCardLines([
    { sec: '误解', text: '把 R7 ← (R1) 当成把 R7 的值送进 R1' },
    { sec: '误解', text: '寄存器间接寻址没分清（R99）' },
  ], { mem });
  assert.equal(r.keep.length, 1);
  assert.match(r.keep[0].text, /R7 ←/);
});

test('旁听：两次开头至少隔 WATCH_GAP（学生一直在拖，不是每拖一下就再叫一个 Opus）', async () => {
  let n = 0;
  let t = 0;
  const w = createWatcher({ call: () => { n++; return Promise.resolve({ text: '', modelApplied: 'claude-opus-5-5' }); }, material: () => 'p', check: () => ({ lines: [] }), now: () => t, gapMs: 15000 });
  w.kick({ canPlay: true, upTo: 1, pending: 'a' });
  await wait(); await wait();
  t = 5000;
  w.kick({ canPlay: true, upTo: 1, pending: 'b' });
  assert.equal(n, 1, '隔得太近不开');
  t = 16000;
  w.kick({ canPlay: true, upTo: 1, pending: 'c' });
  assert.equal(n, 2);
  t = 17000;
  w.kick({ canPlay: true, upTo: 2, pending: 'c' });
  await wait(); await wait();
  assert.equal(n, 2, '老师写了新的一轮也要隔够');
});

test('补收尾写进带 aide 的课：整理单只收判断，事实留给课后助手（不两个作者写同一件事）', () => {
  const entries = [{ kind: 'error' }, { kind: 'lesson' }, { kind: 'note' }, { kind: 'position' }, { kind: 'todo' }];
  assert.deepEqual(judgmentsOnly(entries).map((e) => e.kind), ['lesson', 'position', 'todo']);
});

async function deskWith(reply, model = 'claude-opus-5-5', wrap = (db) => db) {
  const db = fakeDb(`aide-polish-${Math.random()}`);
  db._clear();
  const SID = 'c-20261114-1';
  await db.doc('curriculum/DS-L8.2.1').set({ level: 'block', title: '直接插入排序' });
  await db.doc(`sessions/${SID}`).set({ block: 'DS-L8.2.1', status: 'closed', space: 'cs', kind: 'stage', aide: 1, report: { at: 5, items: 0 }, startedAt: 1 });
  await db.doc(`sessions/${SID}/class_turns/000001`).set({ seq: 1, role: 'student', text: '后进先出' });
  await db.doc(`sessions/${SID}/report/main`).set({ at: 5, items: [] });
  const read = async () => { const out = { evidence: [] }; for (const c of ['sessions', 'curriculum', 'errors', 'weaknesses', 'observations', 'mastery', 'recall', 'rules', 'lessons', 'profile', 'slips', 'reviews', 'position', 'pending']) out[c] = (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() })); return out; };
  let data = await read();
  const ai = { call: async () => ({ text: reply, ...(model ? { modelApplied: model } : {}) }) };
  return { db, SID, desk: createAideDesk({ db: wrap(db), getData: () => data, ops: createMemOps({ db, mem: () => data }), ai: async () => ai }), refresh: async () => { data = await read(); } };
}

test('回的没写是哪个模型：当作不是 Opus，不写', async () => {
  const { db, SID, desk } = await deskWith('## 复盘\n开场｜先测｜题', null);
  await desk.afterOne(SID);
  const s = (await db.doc(`sessions/${SID}`).get()).data();
  assert.equal(s.after.fails, 1);
  assert.ok(!s.debrief);
});

test('事实写完以后中途出错：再做一次不再写一遍事实', async () => {
  const reply = '## 复盘\n开场｜先测｜题\n\n## 事实\n````board memo\nnote text="学生先自己试了几下才答"\n````\n\n## 卡 DS-L8.2.1\n概括｜x';
  // 写卡的时候数据库坏一次：整次算没成
  let broke = false;
  const wrap = (db) => ({ collection: (p) => db.collection(p), doc: (p) => { const r = db.doc(p); if (p.startsWith('cards/') && !broke) { broke = true; return { get: () => r.get(), set: async () => { throw new Error('坏了一次'); } }; } return r; } });
  const { db, SID, desk, refresh } = await deskWith(reply, 'claude-opus-5-5', wrap);
  await desk.afterOne(SID);
  await refresh();
  const s1 = (await db.doc(`sessions/${SID}`).get()).data();
  assert.ok(s1.after.factsAt, '事实写进去了就先记一笔');
  await desk.afterOne(SID);
  const notes = (await db.collection('observations').get()).docs.map((d) => d.data()).filter((o) => /先自己试了几下/.test(o.text));
  assert.equal(notes.length, 1);
});

test('工作单要的卡：还没读过时 cards() 是 null，ensureCards 读一次', async () => {
  const { db, desk } = await deskWith('');
  await db.doc('cards/DS-L8.2.1').set({ block: 'DS-L8.2.1', text: '概括｜x', at: 1, src: 'a' });
  assert.equal(desk.cards(), null);
  const all = await desk.ensureCards();
  assert.equal(all.length, 1);
  assert.equal(desk.cards().length, 1);
});

test('复现课几块：档案的提示词带上这几组复现组', async () => {
  const db = fakeDb(`aide-polish-rv-${Math.random()}`);
  db._clear();
  await db.doc('cards/L2.2.2').set({ block: 'L2.2.2', text: '概括｜外积', at: 1, src: 'a' });
  const data = { curriculum: [{ id: 'L2.2.2', level: 'block' }, { id: 'L1.1.1', level: 'block' }], reviews: [{ id: 'R5', title: '内积是数、外积是矩阵', blocks: ['L2.2.2'], result: '过' }], sessions: [], position: [], rules: [] };
  let prompt = '';
  const ai = { call: async (p) => { prompt = p; return { text: '要点｜先测外积（R5）', modelApplied: 'claude-opus-5-5' }; } };
  const desk = createAideDesk({ db, getData: () => data, ops: createMemOps({ db, mem: () => data }), ai: async () => ai });
  await desk.briefFor('math', ['L2.2.2', 'L1.1.1']);
  assert.match(prompt, /## 这节课要复现的\n- R5 内积是数、外积是矩阵/);
});
