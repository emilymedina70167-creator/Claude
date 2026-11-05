// 写数据库走同一个出口（kit/src/memory/writer.js）：写前看规矩、同一文档排队、一会儿就好的失败自己重试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWrite, guardDb } from '../kit/src/memory/writer.js';

test('validateWrite：缺必填、编号不对、取值不对、日期不对；不是记忆库的路径不管', () => {
  assert.deepEqual(validateWrite('recall/K3', { q: '问', a: '答', tier: 1 }), []);
  assert.match(validateWrite('recall/K3', { q: '问', tier: 1 }).join(), /缺了必填的 a/);
  assert.match(validateWrite('recall/x3', { q: '问', a: '答', tier: 1 }).join(), /编号「x3」不对/);
  assert.match(validateWrite('sessions/c-1', { date: '2026-11-5', status: 'open' }).join(), /date「2026-11-5」不是/);
  assert.match(validateWrite('sessions/c-1', { date: '2026-11-05', status: 'paused' }).join(), /status 是「paused」/);
  assert.deepEqual(validateWrite('meta/health', { anything: 1 }), []);
  assert.deepEqual(validateWrite('sessions/c-1/report/main', {}), []);
});

// 一个最小的假数据库：前 fails 次写失败
function fake({ fails = 0, code = 'unavailable', lag = 5 } = {}) {
  const all = {}, log = [];
  let left = fails;
  const doc = (path) => ({
    path,
    async set(d) { await new Promise((r) => setTimeout(r, lag)); if (left > 0) { left--; throw { code, message: '假的失败' }; } log.push([path, d.n]); all[path] = d; },
    async get() { return { exists: path in all, data: () => all[path] }; },
    async delete() { delete all[path]; },
    collection: (c) => coll(`${path}/${c}`),
  });
  const coll = (p) => ({ doc: (id) => doc(`${p}/${id}`), where() { return this; }, async get() { return { docs: [] }; } });
  return { db: { doc, collection: coll }, all, log };
}

test('guardDb：一会儿就好的失败自己重试，最后写进去', async () => {
  const f = fake({ fails: 2 });
  const db = guardDb(f.db, { waits: [1, 1] });
  await db.doc('meta/x').set({ n: 1 });
  assert.deepEqual(f.all['meta/x'], { n: 1 });
});

test('guardDb：重试也没用的（permission_denied）不重试，抛给调用的地方', async () => {
  const f = fake({ fails: 1, code: 'permission_denied' });
  const db = guardDb(f.db, { waits: [1, 1] });
  await assert.rejects(db.doc('meta/x').set({ n: 1 }));
  assert.equal(f.all['meta/x'], undefined);
});

test('guardDb：同一个文档的几次写按先后排队，后写的留下（前一次失败重试也不会盖掉后一次）', async () => {
  const f = fake({ fails: 1, lag: 3 });
  const db = guardDb(f.db, { waits: [5, 5] });
  const a = db.doc('recall/K1').set({ q: '问', a: '答', tier: 1, n: 1 });
  const b = db.doc('recall/K1').set({ q: '问', a: '答', tier: 3, n: 2 });
  await Promise.all([a, b]);
  assert.equal(f.all['recall/K1'].n, 2);
  assert.deepEqual(f.log.map((x) => x[1]), [1, 2]);
});

test('guardDb：嵌套的集合、读照旧', async () => {
  const f = fake();
  const db = guardDb(f.db, { waits: [1] });
  await db.collection('sessions').doc('c-1').collection('report').doc('main').set({ n: 7 });
  assert.equal(f.all['sessions/c-1/report/main'].n, 7);
  const s = await db.doc('sessions/c-1/report/main').get();
  assert.equal(s.data().n, 7);
  assert.equal(guardDb(db), db, '包过的不再包一层');
});

test('真的数据库是冻住的对象：包一层也不能撞 Proxy 的规矩（2026-11-05 学习台在 iPad 上一打开就报错）', async () => {
  const { guardDb } = await import('../kit/src/memory/writer.js');
  const { scopeDb, readOnlyDb } = await import('../kit/src/memory/session.js');
  const writes = [];
  const ref = (path) => Object.freeze({ id: path.split('/').pop(), path, set: async (d) => { writes.push([path, d]); }, get: async () => ({ exists: false, data: () => undefined }), onSnapshot: () => () => {}, collection: (c) => coll(`${path}/${c}`) });
  const coll = (path) => Object.freeze({ path, doc: (id) => ref(`${path}/${id}`), where: () => coll(path), get: async () => ({ docs: [] }), onSnapshot: () => () => {} });
  const db = Object.freeze({ doc: ref, collection: coll });
  const g = guardDb(db);
  await g.doc('meta/x').set({ a: 1 });
  await g.collection('evidence').where('a', '==', 1).get();
  await g.collection('notes').doc('n1').set({ b: 2 });
  await scopeDb(db, 'c-20261106-1').doc('steps/s1').set({ c: 3 });
  await readOnlyDb(db).doc('meta/y').set({ d: 4 });
  assert.equal(g.doc('meta/x').path, 'meta/x');
  assert.deepEqual(writes.map((w) => w[0]), ['meta/x', 'notes/n1', 'sessions/c-20261106-1/steps/s1']);
});
