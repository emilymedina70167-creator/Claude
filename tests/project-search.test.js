// 项目 Claude 的读和搜（project/search.js、project/tools.js，第十四轮）：学习台里任何一条能读、任何一类能列、按字能找
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchDocs } from '../kit/src/project/search.js';
import { projectTools, READ_MAX } from '../kit/src/project/tools.js';

test('按字找：空格分开的几个词，命中多的排前面', () => {
  const r = searchDocs([{ path: 'a', text: '希尔排序的增量' }, { path: 'b', text: '冒泡' }], '希尔 增量');
  assert.equal(r[0].path, 'a');
  assert.equal(r.length, 1);
});
test('中文不用空格：按相邻两个字的片段也找得到', () => {
  const r = searchDocs([{ path: 'b', text: '冒泡排序' }, { path: 'a', text: '希尔排序的增量序列' }], '排序增量');
  assert.equal(r[0].path, 'a');
});
test('大小写、全角半角不分；片段带上命中处前后的字', () => {
  const r = searchDocs([{ path: 'x', text: '前面一段话 ab 后面' }], 'ＡＢ');
  assert.equal(r[0].path, 'x');
  assert.match(r[0].snippet, /ab/);
});
test('最多 limit 条', () => {
  const src = Array.from({ length: 50 }, (_, i) => ({ path: `p${i}`, text: '同样的字' }));
  assert.equal(searchDocs(src, '同样', { limit: 30 }).length, 30);
});

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const rows = (path) => [...docs.entries()].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(([k, v]) => ({ id: k.split('/').pop(), data: () => structuredClone(v) }));
  return {
    docs,
    doc: (path) => ({ get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }), set: async (v) => { docs.set(path, structuredClone(v)); } }),
    collection: (path) => ({
      get: async () => ({ docs: rows(path) }),
      where: (f, _op, val) => ({ get: async () => ({ docs: rows(path).filter((d) => d.data()[f] === val) }) }),
    }),
  };
}
const byName = (tools, n) => tools.find((t) => t.name === n);

test('read：任何一条按路径读；太长分段读', async () => {
  const big = '字'.repeat(15000); // 45 KB
  const db = fakeDb({ 'meta/forecast': { total: 300 }, 'sessions/c-1/report/main': { text: big } });
  const used = [];
  const t = projectTools({ db, getData: () => ({}), used });
  const r1 = await byName(t, 'read').execute({ path: 'meta/forecast' });
  assert.equal(r1.doc.total, 300);
  const p1 = await byName(t, 'read').execute({ path: 'sessions/c-1/report/main' });
  assert.ok(p1.more > 0 && p1.next > 0);
  assert.ok(new TextEncoder().encode(p1.text).length <= READ_MAX);
  const p2 = await byName(t, 'read').execute({ path: 'sessions/c-1/report/main', offset: p1.next });
  assert.ok(p2.text.length > 0);
  assert.equal(used.length, 3);
});

test('list：按字段筛，一页 50 条，有下一页的游标', async () => {
  const seed = {};
  for (let i = 0; i < 60; i++) seed[`questions/q${String(i).padStart(2, '0')}`] = { course: i % 2 ? 'OS' : 'DS' };
  const t = projectTools({ db: fakeDb(seed), getData: () => ({}) });
  const r = await byName(t, 'list').execute({ collection: 'questions' });
  assert.equal(r.items.length, 50);
  assert.equal(r.count, 60);
  const r2 = await byName(t, 'list').execute({ collection: 'questions', cursor: r.next });
  assert.equal(r2.items.length, 10);
  const os = await byName(t, 'list').execute({ collection: 'questions', field: 'course', value: 'OS' });
  assert.equal(os.count, 30);
});

test('search：在笔记本、旧记忆、作答里找；不传范围就全找', async () => {
  const data = { notebook: [{ id: 'n1', path: '学生/底子.md', text: '学生的词汇是瓶颈' }], rules: [{ id: 'r1', text: '练习固定两步' }], evidence: [{ id: 'e1', text: '换一个高效点的测验' }] };
  const t = projectTools({ db: fakeDb(), getData: () => data });
  const r = await byName(t, 'search').execute({ q: '高效 测验' });
  assert.equal(r.hits[0].path, 'evidence/e1');
  const n = await byName(t, 'search').execute({ q: '词汇', in: ['notebook'] });
  assert.equal(n.hits[0].path, 'notebook/n1');
});

test('notebook 工具：view 列目录、写文件', async () => {
  const db = fakeDb();
  const runs = [];
  const notebook = { run: async (op, o) => { runs.push([op.kind, o.by]); return { ok: true, path: op.path }; } };
  const t = projectTools({ db, getData: () => ({ notebook: [{ path: 'a.md', text: 'x', pin: true }] }), notebook, by: 'head' });
  const v = await byName(t, 'notebook').execute({ op: 'view' });
  assert.match(v.dir, /a\.md/);
  const f = await byName(t, 'notebook').execute({ op: 'view', path: 'a.md' });
  assert.equal(f.text, 'x');
  await byName(t, 'notebook').execute({ op: 'create', path: 'b.md', text: 'y' });
  assert.deepEqual(runs, [['create', 'head']]);
});
