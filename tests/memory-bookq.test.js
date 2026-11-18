// 书上做题的记录（dr-batch4 第 2 条）：题号、一行写法、证据、错题本那一条
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNos, bookLabel, bookEvidence, bookErrorArgs, errorBlockOf, bookList, newBook } from '../kit/src/memory/bookq.js';
import { meChange } from '../kit/src/memory/memo.js';

const book = { title: '张宇 1000 题', part: '基础篇', subject: '线代', ch: 2, no: 15 };

test('题号、书单、一行写法', () => {
  assert.deepEqual(parseNos('3, 5, 7-9'), [3, 5, 7, 8, 9]);
  assert.deepEqual(parseNos('3，3、4'), [3, 4]);
  assert.throws(() => parseNos('a'), /看不懂/);
  assert.throws(() => parseNos('9-3'), /反/);
  assert.throws(() => parseNos('1-60'), /最多/);
  assert.equal(bookLabel(book), '1000 题 基础篇 线代 第 2 章 第 15 题');
  assert.equal(bookList([{ title: '李永乐 660', parts: [], subjects: ['线代'] }]).length, 2);
  assert.deepEqual(newBook({ title: '660 题', subjects: '线代，高数' }), { title: '660 题', parts: [], subjects: ['线代', '高数'] });
});

test('证据和错题本', () => {
  const ev = bookEvidence({ book, verdict: 'wrong', text: '第二步符号错', images: ['a1'] });
  assert.equal(ev.src, 'book');
  assert.equal(ev.ok, false);
  assert.equal(ev.verdict, '错');
  assert.deepEqual(ev.book, book);
  assert.equal(bookEvidence({ book, verdict: 'unsure' }).ok, null);
  assert.equal(bookEvidence({ book, verdict: 'stuck' }).giveup, true);
  assert.throws(() => bookEvidence({ book, verdict: 'x' }), /结果/);
  assert.equal(errorBlockOf({ book }), 'L2');
  assert.equal(errorBlockOf({ book: { ...book, subject: '高数' } }), 'HM-L2');
  assert.equal(errorBlockOf({ book, block: 'L2.1.4' }), 'L2.1.4');
  const args = bookErrorArgs({ book, verdict: 'wrong', text: '第二步符号错', evidence: ev.id });
  const pd = meChange('error-add', { errors: [{ id: 'L2-56' }] }, args);
  assert.equal(pd.target, 'L2-57');
  assert.equal(pd.data.book.no, 15);
  assert.match(pd.data.q, /1000 题 基础篇 线代 第 2 章 第 15 题/);
  assert.deepEqual(pd.data.evidence, [ev.id]);
  // 一次记好几道：接着编号
  assert.equal(meChange('error-add', { errors: [{ id: 'L2-56' }] }, { ...args, taken: ['L2-57'] }).target, 'L2-58');
  assert.equal(meChange('error-add', { errors: [] }, bookErrorArgs({ book: { ...book, subject: '概率', ch: 3 }, verdict: 'stuck' })).target, 'PS-L3-01');
});
