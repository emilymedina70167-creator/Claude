// 笔记本存进学习台的数据库（project/notebookdesk.js，第十四轮）：同一个文件的写排队、留版本、改名、引号核只记不拦；记忆库多一类 notebook
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotebook } from '../kit/src/project/notebookdesk.js';
import { noteId } from '../kit/src/project/notebook.js';
import { canWrite, MEMORY_COLLECTIONS } from '../kit/src/memory/schema.js';
import { backupFile } from '../kit/src/memory/backup.js';

function fakeDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const sleep = () => new Promise((r) => setTimeout(r, 1));
  const docRef = (path) => ({
    get: async () => { await sleep(); return { exists: docs.has(path), data: () => structuredClone(docs.get(path)), id: path.split('/').pop() }; },
    set: async (v) => { await sleep(); docs.set(path, structuredClone(v)); },
  });
  return { docs, doc: docRef };
}
const at = (p) => `notebook/${noteId(p)}`;

test('create 写进 notebook/{编号}，带作者和第几版', async () => {
  const db = fakeDb();
  const nb = createNotebook({ db, corpus: () => '' });
  const r = await nb.run({ kind: 'create', path: 'a.md', text: 'x' }, { by: 'head' });
  assert.equal(r.ok, true);
  const d = db.docs.get(at('a.md'));
  assert.deepEqual([d.path, d.text, d.by, d.v], ['a.md', 'x', 'head', 1]);
});

test('同一个文件两次改同时发：排队，后一次在前一次的基础上改', async () => {
  const db = fakeDb();
  const nb = createNotebook({ db, corpus: () => '' });
  await nb.run({ kind: 'create', path: 'a.md', text: '甲 乙' }, { by: 'head' });
  const [r1, r2] = await Promise.all([
    nb.run({ kind: 'str_replace', path: 'a.md', old: '甲', new: '丙' }, { by: 'head' }),
    nb.run({ kind: 'str_replace', path: 'a.md', old: '乙', new: '丁' }, { by: 'class' }),
  ]);
  assert.equal(r1.ok && r2.ok, true);
  assert.equal(db.docs.get(at('a.md')).text, '丙 丁');
});

test('对不上的不写，返回原因', async () => {
  const db = fakeDb();
  const nb = createNotebook({ db, corpus: () => '' });
  await nb.run({ kind: 'create', path: 'a.md', text: 'x' }, { by: 'head' });
  const r = await nb.run({ kind: 'str_replace', path: 'a.md', old: 'y', new: 'z' }, { by: 'head' });
  assert.equal(r.ok, false);
  assert.match(r.error, /没找到/);
  assert.equal(db.docs.get(at('a.md')).v, 1);
});

test('改名：新路径有一份，旧的标删除并记挪到哪', async () => {
  const db = fakeDb();
  const nb = createNotebook({ db, corpus: () => '' });
  await nb.run({ kind: 'create', path: 'a.md', text: 'x' }, { by: 'head' });
  await nb.run({ kind: 'set', path: 'a.md', pin: true }, { by: 'head' });
  const r = await nb.run({ kind: 'rename', path: 'a.md', to: 'b/a.md' }, { by: 'head' });
  assert.equal(r.ok, true);
  assert.deepEqual([db.docs.get(at('b/a.md')).text, db.docs.get(at('b/a.md')).pin], ['x', true]);
  assert.deepEqual([db.docs.get(at('a.md')).deleted, db.docs.get(at('a.md')).movedTo], [true, 'b/a.md']);
});

test('引号在记录里找不到：照写，那一版记下是哪几句', async () => {
  const db = fakeDb();
  const nb = createNotebook({ db, corpus: () => '学生说：别再一上来给我九句话' });
  await nb.run({ kind: 'create', path: 'a.md', text: '「别再一上来给我九句话」；「以后每次都要用表格讲」' }, { by: 'head' });
  assert.deepEqual(db.docs.get(at('a.md')).quotes, ['以后每次都要用表格讲']);
});

test('记忆库多一类 notebook：老师、班主任、页面、我都能写；备份带上它和项目指令', () => {
  assert.ok(MEMORY_COLLECTIONS.includes('notebook'));
  for (const r of ['class', 'head', 'page', 'me']) assert.equal(canWrite(r, 'notebook'), true, r);
  const file = backupFile({ memory: { notebook: [{ id: noteId('a.md'), path: 'a.md', text: 'x' }] }, instructions: { text: '我的指令', at: 1, by: 'me' } });
  assert.ok(file.docs.some((d) => d.collection === 'notebook' && d.data.text === 'x'));
  assert.ok(file.docs.some((d) => d.collection === 'meta' && d.doc_id === 'instructions' && d.data.text === '我的指令'));
});
