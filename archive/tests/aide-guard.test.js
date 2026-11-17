// 第九轮第 1 批：守卫和记忆块认作者 aide（课后助手）：对不上的直接不收、不挂起；只写事实
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem0 = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem0.has(k) ? mem0.get(k) : null), setItem: (k, v) => mem0.set(k, String(v)), removeItem: (k) => mem0.delete(k), key: () => null, length: 0 };
globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { parseMemoLines } = await import('../kit/src/memory/memo.js');
const { createMemOps, AIDE_KINDS } = await import('../kit/src/memory/memops.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { fakeDb } = await import('../kit/src/live/store.js');
const { guardCandidate, buildCorpus } = await import('../kit/src/memory/guard.js');

const TODAY = '2026-11-05';
const SID = 'c-20261105-1';
const turns = [
  { seq: 3, role: 'student', say: '我觉得 βᵀα 是一个矩阵' },
  { seq: 4, role: 'claude', text: '````board new id=b2 title="内积"\n```quiz\nid: qz-b2\nq: βᵀα 是\n```\n````' },
];
const evidence = [{ id: 'ev-g1', session: SID, comp: 'qz-b2', src: 'record', ok: false, value: '一个矩阵', q: 'βᵀα 是', at: 1, block: 'L2.2.2' }];

async function setup() {
  const db = fakeDb(`aide-guard-${Math.random()}`);
  db._clear();
  for (const [c, docs] of Object.entries(sampleMemory(TODAY))) for (const d of docs) { const { id, ...rest } = d; await db.doc(`${c}/${id}`).set(rest); }
  for (const e of evidence) { const { id, ...rest } = e; await db.doc(`evidence/${id}`).set(rest); }
  const read = async () => { const out = {}; for (const c of ['errors', 'weaknesses', 'observations', 'slips', 'reviews', 'profile', 'rules', 'lessons', 'recall', 'mastery', 'position', 'curriculum', 'pending', 'sessions', 'evidence']) out[c] = (await db.collection(c).get()).docs.map((d) => ({ id: d.id, ...d.data() })); return out; };
  const mem = await read();
  return { db, ops: createMemOps({ db, mem: () => mem }), read };
}

test('守卫：助手引的原话找不到就不收（不暂存），找得到就收', () => {
  const corpus = buildCorpus({ turns });
  const bad = guardCandidate({ coll: 'observations', id: 'ob-x', doc: { kind: 'note', text: '#3 学生说「我早就会了」', session: SID, by: 'aide', backfill: true, at: 1 }, author: 'aide', session: SID }, { mem: {}, corpus });
  assert.equal(bad.verdict, 'reject');
  const ok = guardCandidate({ coll: 'observations', id: 'ob-y', doc: { kind: 'note', text: '#3 学生原话「我觉得 βᵀα 是一个矩阵」', session: SID, by: 'aide', backfill: true, at: 1 }, author: 'aide', session: SID }, { mem: {}, corpus });
  assert.equal(ok.verdict, 'accept');
});

test('守卫：助手不能改课堂当场写的话', () => {
  const g = guardCandidate({ coll: 'observations', id: 'ob-z', doc: { kind: 'note', text: '改过的话', session: SID }, before: { kind: 'note', text: '课上写的话', session: SID, by: 'class' }, author: 'aide', session: SID }, { mem: {}, corpus: buildCorpus({ turns }) });
  assert.equal(g.verdict, 'reject');
  assert.ok(g.checks.some((c) => c.code === 'not-yours'));
});

test('记忆块：助手只写事实那几种，守则、待办、下一节进 rejected', async () => {
  const { ops } = await setup();
  assert.deepEqual([...AIDE_KINDS].sort(), ['error', 'note', 'recall', 'slip', 'weakness']);
  const { entries } = parseMemoLines('lesson id=T-1 again="没等学生答"\ntodo text="补讲外积"');
  const r = await ops.applyMemo(entries, { session: SID, block: 'L2.2.2', turns, author: 'aide' });
  assert.equal(r.pds.length, 0);
  assert.equal(r.rejected.length, 2);
  assert.ok(r.rejected.every((x) => /助手只写事实/.test(x.error)));
});

test('记忆块：助手写对得上的事实照收，记成 aide 写的、标事后补写', async () => {
  const { ops, read } = await setup();
  const { entries } = parseMemoLines('note text="#3 学生原话「我觉得 βᵀα 是一个矩阵」，内积和外积还没分开" basis=qz-b2');
  const r = await ops.applyMemo(entries, { session: SID, block: 'L2.2.2', turns, author: 'aide' });
  assert.equal(r.pds.length, 1, JSON.stringify(r.rejected));
  const m = await read();
  const ob = m.observations.find((o) => String(o.text).includes('内积和外积还没分开') && o.session === SID);
  assert.equal(ob.by, 'aide');
  assert.equal(ob.backfill, true);
  assert.ok(!m.pending.some((p) => p.status === 'held'));
});
