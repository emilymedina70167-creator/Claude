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

test('memo 块：原话找得到的照收；编的原话、编的证据编号照收但挂提醒（课堂当场写的不拦）；重复的拒收', async () => {
  const { db, ops, read } = await setup();
  const { entries } = parseMemoLines([
    'note text="#3 学生原话「我觉得 βᵀα 是一个矩阵」，内积和外积还没分开" basis=qz-b2',
    'slip text="#3 学生说「我早就会了」，我没追问" basis=qz-b2',
    'note text="学生在 qz-b2 选的是一个矩阵，形状没想" basis=ev-notreal',
    'note text="#3 学生原话「我觉得 βᵀα 是一个矩阵」，内积和外积还没分开。" basis=qz-b2',
  ].join('\n'));
  const r = await ops.applyMemo(entries, { session: SID, block: 'L2.2.2', turn: 5, turns });
  assert.equal(r.pds.length, 3);
  assert.equal(r.rejected.length, 1, '最后一条和第一条几乎一样');
  const m = await read();
  const ok = m.observations.find((o) => String(o.text).includes('还没分开'));
  assert.ok(ok && !ok.guard, '对得上的不挂提醒');
  const flagged = m.slips.find((s) => String(s.text).includes('我早就会了'));
  assert.equal(flagged.guard.verdict, 'flag');
  assert.equal(flagged.guard.checks[0].code, 'quote-miss');
  assert.equal(flagged.text, '#3 学生说「我早就会了」，我没追问', 'Claude 写的话一个字没改');
  const fakeBasis = m.observations.find((o) => String(o.text).includes('形状没想'));
  assert.equal(fakeBasis.guard.checks[0].code, 'basis-dropped');
  const logs = (await db.collection('guard_log').get()).docs.map((d) => d.data());
  assert.ok(logs.filter((l) => l.verdict === 'flag').length >= 2);
});

test('事后写的（lab）对不上：先暂存；我在管理里放行就写进去', async () => {
  const { db, ops, read, setMem } = await setup();
  const { entries } = parseMemoLines('note text="#3 学生说「我早就会了」" basis=qz-b2');
  const r = await ops.applyMemo(entries, { session: SID, block: 'L2.2.2', turns, author: 'lab' });
  assert.equal(r.pds.length, 0);
  assert.ok(r.rejected[0].held);
  let m = await read();
  const held = m.pending.find((p) => p.status === 'held');
  assert.ok(held?.guard?.checks?.length);
  assert.ok(!m.observations.some((o) => String(o.text).includes('早就会了')), '暂存的还没写进去');
  await setMem();
  await ops.release(held);
  m = await read();
  assert.ok(m.observations.some((o) => String(o.text).includes('早就会了')), '放行以后写进去了');
  assert.equal(m.pending.find((p) => p.id === held.id).status, 'done');
});

test('教研室（lab）写对得上的：照收，新加的标「事后补写」、记成 lab 写的；改课堂写的话拒收', async () => {
  const { ops, read, setMem } = await setup();
  // 先有一个课堂当场写的弱点
  const c = await ops.applyMemo(parseMemoLines('weakness title="矩阵乘法时不先看维数能不能乘" scope=局部 level=L1 blocks=L2.2.2 basis=qz-b2').entries, { session: SID, block: 'L2.2.2', turns });
  assert.ok(c.pds.length, JSON.stringify(c.rejected));
  const wid = c.pds[0].target;
  await setMem();
  const { entries } = parseMemoLines([
    'note text="#3 学生原话「我觉得 βᵀα 是一个矩阵」，下一节先换数再测" basis=qz-b2',
    `weakness id=${wid} title="完全换了一个说法" basis=qz-b2`,
  ].join('\n'));
  const r = await ops.applyMemo(entries, { session: SID, block: 'L2.2.2', turns, author: 'lab' });
  assert.equal(r.pds.length, 1);
  assert.equal(r.pds[0].by, 'lab');
  const m = await read();
  const ob = m.observations.find((o) => String(o.text).includes('下一节先换数再测'));
  assert.equal(ob.by, 'lab');
  assert.equal(ob.backfill, true);
  assert.ok(!ob.guard);
  assert.ok(r.rejected.some((x) => /不能改它的话/.test(x.error)), '课堂写的弱点，事后写的不能改它的标题');
});

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
