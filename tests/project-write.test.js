// 项目 Claude 有整个学习台的读写权（第十四轮，学生：「直接你给 Claude 所有内容的操作权限不就行了吗」）。
// 保护靠「每一次写都记下来、能撤销」（journal），不靠拦；格式不对的照写，告诉它哪里不对。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectTools } from '../kit/src/project/tools.js';
import { undoJournal } from '../kit/src/project/journal.js';

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const rows = (path) => [...docs.entries()].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => structuredClone(v) }));
  return {
    docs,
    doc: (path) => ({ get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }), set: async (v) => { docs.set(path, structuredClone(v)); }, delete: async () => { docs.delete(path); } }),
    collection: (path) => ({ get: async () => ({ docs: rows(path) }), where: () => ({ get: async () => ({ docs: rows(path) }) }) }),
  };
}
const writeTool = (db) => projectTools({ db, getData: () => ({}), by: 'head', write: true }).find((t) => t.name === 'write');
const journal = (db) => [...db.docs.entries()].filter(([k]) => k.startsWith('journal/')).map(([, v]) => v);

test('update：合并字段，记一条 journal（前后两份、谁、哪条）', async () => {
  const db = fakeDb({ 'mastery/L2.1': { status: 'learning', log: [] } });
  const r = await writeTool(db).execute({ op: 'update', path: 'mastery/L2.1', data: { status: 'basic' } });
  assert.equal(r.ok, true);
  assert.equal(db.docs.get('mastery/L2.1').status, 'basic');
  const j = journal(db);
  assert.equal(j.length, 1);
  assert.deepEqual([j[0].path, j[0].op, j[0].by, j[0].before.status, j[0].after.status], ['mastery/L2.1', 'update', 'head', 'learning', 'basic']);
});

test('撤销：写回改之前的；之前没有的就删掉', async () => {
  const db = fakeDb({ 'mastery/L2.1': { status: 'learning' } });
  const w = writeTool(db);
  await w.execute({ op: 'update', path: 'mastery/L2.1', data: { status: 'basic' } });
  await w.execute({ op: 'set', path: 'meta/today', data: { note: '今天先复现' } });
  const [j1, j2] = journal(db).sort((a, b) => a.at - b.at);
  assert.deepEqual(undoJournal(j1), { op: 'set', path: 'mastery/L2.1', data: { status: 'learning' } });
  assert.deepEqual(undoJournal(j2), { op: 'delete', path: 'meta/today' });
});

test('格式不对的照写，回 problems；学生的指令、作答也能写（所有内容）', async () => {
  const db = fakeDb();
  const w = writeTool(db);
  const r = await w.execute({ op: 'set', path: 'errors/E-x', data: { note: '缺了必填的' } });
  assert.equal(r.ok, true);
  assert.ok(r.problems?.length > 0);
  assert.ok(db.docs.has('errors/E-x'));
  assert.equal((await w.execute({ op: 'set', path: 'meta/instructions', data: { text: '新的指令' } })).ok, true);
  assert.equal((await w.execute({ op: 'update', path: 'evidence/ev-1', data: { note: '看过' } })).ok, true);
});

test('str_replace：一个字符串字段里换一段，要恰好出现一次；delete 删一条', async () => {
  const db = fakeDb({ 'meta/instructions': { text: '甲乙甲' }, 'drills/d1': { md: 'x' } });
  const w = writeTool(db);
  await assert.rejects(() => w.execute({ op: 'str_replace', path: 'meta/instructions', field: 'text', old: '甲', new: '丙' }), /2 次/);
  await w.execute({ op: 'str_replace', path: 'meta/instructions', field: 'text', old: '乙', new: '丙' });
  assert.equal(db.docs.get('meta/instructions').text, '甲丙甲');
  await w.execute({ op: 'delete', path: 'drills/d1' });
  assert.equal(db.docs.has('drills/d1'), false);
  assert.ok(journal(db).some((j) => j.op === 'delete' && j.before.md === 'x'));
});

test('只读的地方（课上）没有 write', () => {
  assert.ok(!projectTools({ db: fakeDb(), getData: () => ({}), write: false }).some((t) => t.name === 'write'));
});

test('撤销之前看一眼：那一条后来又被改过（不是这一次改完的样子）就说出来', async () => {
  const { changedSince } = await import('../kit/src/project/journal.js');
  const j = { path: 'reviews/R3', before: { tier: 3 }, after: { tier: 7 } };
  assert.equal(changedSince(j, { tier: 7 }), false);
  assert.equal(changedSince(j, { tier: 14, last: '2026-11-18' }), true);
  assert.equal(changedSince({ path: 'x/y', before: null, after: null }, null), false);
});
