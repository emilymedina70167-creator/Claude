// 笔记本（project/notebook.js，第十四轮）：项目 Claude 自己的记忆，照 Anthropic 记忆工具的做法——一个文件夹，它自己管。
// 页面只做机械的事：路径、改一段要对得上、留版本、删了能恢复、每一轮带哪些（pin）、块的写法、引号核了只记不拦。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_HISTORY, notePath, noteId, applyNoteOp, pinnedText, notebookDir, parseNoteBlock, quoteNotes } from '../kit/src/project/notebook.js';

const by = { at: 1000, by: 'head' };

test('路径：去掉首尾空白和开头的斜杠，连续斜杠合一', () => {
  assert.equal(notePath(' /学生//底子.md '), '学生/底子.md');
  assert.throws(() => notePath('../x'), /\.\./);
  assert.throws(() => notePath('  '), /空/);
  assert.throws(() => notePath('a'.repeat(201)), /200/);
});

test('编号：只含能当文档编号的字，同一个路径两次一样，不同路径不一样', () => {
  const a = noteId('学生/底子.md');
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.equal(noteId('学生/底子.md'), a);
  assert.notEqual(noteId('学生/背景.md'), a);
});

test('create：新建；已经有了就报错，叫它用 str_replace', () => {
  const { doc } = applyNoteOp(null, { kind: 'create', path: 'a.md', text: 'x' }, by);
  assert.deepEqual([doc.path, doc.text, doc.v, doc.by, doc.at], ['a.md', 'x', 1, 'head', 1000]);
  const again = applyNoteOp(doc, { kind: 'create', path: 'a.md', text: 'y' }, by);
  assert.match(again.error, /已经有了/);
  assert.equal(again.doc.text, 'x');
});

test('str_replace：恰好出现一次才改；两次、零次都不改，说清楚', () => {
  const doc = { path: 'a.md', text: '甲乙甲', v: 1, history: [] };
  const two = applyNoteOp(doc, { kind: 'str_replace', path: 'a.md', old: '甲', new: '丙' }, by);
  assert.match(two.error, /出现了 2 次/);
  assert.equal(two.doc.text, '甲乙甲');
  const none = applyNoteOp(doc, { kind: 'str_replace', path: 'a.md', old: '丁', new: '丙' }, by);
  assert.match(none.error, /没找到/);
  const ok = applyNoteOp(doc, { kind: 'str_replace', path: 'a.md', old: '乙', new: '丙' }, by);
  assert.equal(ok.doc.text, '甲丙甲');
  assert.equal(ok.doc.v, 2);
});

test('insert：在第几行后面插，0 是开头', () => {
  const doc = { path: 'a.md', text: '一\n二', v: 1, history: [] };
  assert.equal(applyNoteOp(doc, { kind: 'insert', path: 'a.md', line: 0, text: '零' }, by).doc.text, '零\n一\n二');
  assert.equal(applyNoteOp(doc, { kind: 'insert', path: 'a.md', line: 1, text: '半' }, by).doc.text, '一\n半\n二');
});

test('每改一次旧版进 history，最多 NOTE_HISTORY 版，新的在前', () => {
  let doc = applyNoteOp(null, { kind: 'create', path: 'a.md', text: 't0' }, by).doc;
  for (let i = 1; i <= 21; i++) doc = applyNoteOp(doc, { kind: 'str_replace', path: 'a.md', old: `t${i - 1}`, new: `t${i}` }, { at: 1000 + i, by: 'class' }).doc;
  assert.equal(NOTE_HISTORY, 20);
  assert.equal(doc.history.length, 20);
  assert.equal(doc.text, 't21');
  assert.equal(doc.history[0].text, 't20');
});

test('history 新的在前：最近一版是上一次的正文', () => {
  let doc = applyNoteOp(null, { kind: 'create', path: 'a.md', text: '一' }, by).doc;
  doc = applyNoteOp(doc, { kind: 'str_replace', path: 'a.md', old: '一', new: '二' }, by).doc;
  doc = applyNoteOp(doc, { kind: 'str_replace', path: 'a.md', old: '二', new: '三' }, by).doc;
  assert.deepEqual(doc.history.map((h) => h.text), ['二', '一']);
});

test('delete 只标删除、正文还在；restore 回来', () => {
  const doc = { path: 'a.md', text: 'x', v: 1, history: [] };
  const del = applyNoteOp(doc, { kind: 'delete', path: 'a.md' }, by).doc;
  assert.equal(del.deleted, true);
  assert.equal(del.text, 'x');
  assert.equal(applyNoteOp(del, { kind: 'restore', path: 'a.md' }, by).doc.deleted, false);
});

test('rename：告诉调用的地方挪到哪；set 改 pin / show / order', () => {
  const doc = { path: 'a.md', text: 'x', v: 1, history: [] };
  assert.equal(applyNoteOp(doc, { kind: 'rename', path: 'a.md', to: 'b/a.md' }, by).moved, 'b/a.md');
  const s = applyNoteOp(doc, { kind: 'set', path: 'a.md', pin: true, show: false, order: 1 }, by).doc;
  assert.deepEqual([s.pin, s.show, s.order], [true, false, 1]);
});

test('pin 的放进说明：按 order 先后，放不下的列出来；删掉的不放', () => {
  const docs = [
    { path: 'b.md', text: 'B'.repeat(60), pin: true, order: 2, at: 5 },
    { path: 'a.md', text: 'A'.repeat(60), pin: true, order: 1, at: 1 },
    { path: 'c.md', text: 'C', pin: true, deleted: true },
    { path: 'd.md', text: 'D', pin: false },
  ];
  const r = pinnedText(docs, 100);
  assert.match(r.text, /### 笔记：a\.md\nA{60}/);
  assert.doesNotMatch(r.text, /b\.md|c\.md|d\.md/);
  assert.deepEqual(r.skipped.map((x) => x.path), ['b.md']);
  assert.ok(r.used <= 100);
});

test('目录：每个没删的一行，路径、大小、pin / show', () => {
  const t = notebookDir([{ path: 'a.md', text: '一二三', pin: true, at: Date.parse('2026-11-17') }, { path: 'x.md', text: '', deleted: true }]);
  assert.match(t, /a\.md · 9 字节 · pin/);
  assert.doesNotMatch(t, /x\.md/);
});

test('board note 块的写法', () => {
  const body = [
    'create 学生/底子.md', '<<<', '正文第一行', '第二行', '>>>',
    'str_replace 学生/底子.md', '<<<', '第二行', '===', '第 2 行', '>>>',
    'insert 学生/底子.md 1', '<<<', '插进去的', '>>>',
    'rename 学生/底子.md 学生/背景.md',
    'delete 草稿.md',
    'set 学生/背景.md pin=on order=1 show=off',
  ].join('\n');
  const { ops, errors } = parseNoteBlock(body);
  assert.deepEqual(errors, []);
  assert.deepEqual(ops.map((o) => o.kind), ['create', 'str_replace', 'insert', 'rename', 'delete', 'set']);
  assert.equal(ops[0].text, '正文第一行\n第二行');
  assert.deepEqual([ops[1].old, ops[1].new], ['第二行', '第 2 行']);
  assert.equal(ops[2].line, 1);
  assert.equal(ops[3].to, '学生/背景.md');
  assert.deepEqual([ops[5].pin, ops[5].order, ops[5].show], [true, 1, false]);
  assert.match(parseNoteBlock('create a.md\n<<<\n没收尾').errors[0], />>>/);
});

test('引号核：找得到的不报，找不到的列出来（只记不拦）', () => {
  assert.deepEqual(quoteNotes('学生说「换一个高效点的测验」', '……换一个高效点的测验……'), []);
  assert.deepEqual(quoteNotes('学生说「以后每次都要用表格讲」', '别的话'), ['以后每次都要用表格讲']);
});
