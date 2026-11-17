// 守卫接到写记忆的入口（memops.js 的 applyMemo、guard.js 的 guardDebrief）：真的数据库一层（?dev 的替身），从 memo 块到写进去
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { parseMemoLines } = await import('../kit/src/memory/memo.js');
const { createMemOps } = await import('../kit/src/memory/memops.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { fakeDb } = await import('../kit/src/live/store.js');
const { guardDebrief, buildCorpus } = await import('../kit/src/memory/guard.js');

const TODAY = '2026-11-05';
const SID = 'c-20261105-1';
const turns = [
  { seq: 3, role: 'student', say: '我觉得 βᵀα 是一个矩阵' },
  { seq: 4, role: 'claude', text: '````board new id=b2 title="内积"\n```quiz\nid: qz-b2\nq: βᵀα 是\n```\n````' },
];
const evidence = [{ id: 'ev-g1', session: SID, comp: 'qz-b2', src: 'record', ok: false, value: '一个矩阵', q: 'βᵀα 是', at: 1, block: 'L2.2.2' }];

async function setup() {
  const db = fakeDb(`guard-ops-${Math.random()}`);
  db._clear();
  for (const [c, docs] of Object.entries(sampleMemory(TODAY))) for (const d of docs) { const { id, ...rest } = d; await db.doc(`${c}/${id}`).set(rest); }
  for (const e of evidence) { const { id, ...rest } = e; await db.doc(`evidence/${id}`).set(rest); }
  const read = async () => { const out = {}; for (const c of ['errors', 'weaknesses', 'observations', 'slips', 'reviews', 'profile', 'rules', 'lessons', 'recall', 'mastery', 'position', 'curriculum', 'pending', 'sessions', 'evidence']) out[c] = (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() })); return out; };
  let mem = await read();
  const ops = createMemOps({ db, mem: () => mem });
  return { db, ops, read, setMem: async () => { mem = await read(); } };
}




test('下课整理单被拒的：记进 meta/guard 的 carry（下一节开课带着）', async () => {
  const { db, ops } = await setup();
  const { entries } = parseMemoLines('weakness id=W19 level=L9 basis=qz-b2');
  await ops.applyMemo(entries, { session: SID, block: 'L2.2.2', turns, closing: true });
  const g = (await db.doc('meta/guard').get()).data();
  assert.equal(g.carry.math.length, 1);
  assert.match(g.carry.math[0].error, /level/);
});

test('guardDebrief：引的原话对不上的那几条挪进 held，别的照用，话不改', () => {
  const corpus = buildCorpus({ turns, evidence });
  const d = { mis: [{ text: '内积外积分不清', state: '还在', basis: '#3 学生原话「我觉得 βᵀα 是一个矩阵」' }, { text: '乱猜', state: '还在', basis: '#3 学生说「我都是蒙的」' }], advice: ['下一节先考内积'], pace: [], habit: [] };
  const { debrief, held } = guardDebrief(d, { session: SID, mem: { evidence }, corpus });
  assert.equal(held, 1);
  assert.equal(debrief.mis.length, 1);
  assert.equal(debrief.mis[0].text, '内积外积分不清');
  assert.equal(debrief.held[0].item.text, '乱猜');
  assert.deepEqual(debrief.advice, ['下一节先考内积']);
  assert.equal(debrief.guard.held, 1);
});
