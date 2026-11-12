// 留作模考的卷（kit/src/exam/reserve.js）：一个字都不出现在课堂、备课（docs/exam-plan.md 1.2、第七节）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestPaperYear, reserveYears, markYears, usable, scrubChunks, scrubBooks, readReserve } from '../kit/src/exam/reserve.js';
import { textbookForClass, searchChunks, bookCatalog, readChunks } from '../kit/src/books/textbook.js';

test('最近一张卷：2026-11-12 是 2026 卷；12 月 26 日以后算今年 12 月考过了', () => {
  assert.equal(latestPaperYear('2026-11-12'), 2026);
  assert.equal(latestPaperYear('2026-12-25'), 2026);
  assert.equal(latestPaperYear('2026-12-26'), 2027);
  assert.deepEqual(reserveYears(null, '2026-11-12'), [2024, 2025, 2026]);
  assert.deepEqual(reserveYears({ reserve: null }, '2026-11-12'), [2024, 2025, 2026]);
  assert.deepEqual(reserveYears({ reserve: [2025] }, '2026-11-12'), [2025]);
  assert.deepEqual(reserveYears({ reserve: [] }, '2026-11-12'), []);
});

test('统考标记认得这几种，只有年份不算', () => {
  for (const s of ['【2025 统考真题】', '【2025年统考真题】', '（2025 统考）', '(2025统考)', '2025 年全国硕士研究生招生考试', '2025 年考研真题', '2025年408真题', '2025 年数学一真题', '2025年数一', '2025 年英语一真题', '【2025真题】']) assert.deepEqual(markYears(s), [2025], s);
  assert.deepEqual(markYears('2025 年版王道，第 3 页'), []);
  assert.deepEqual(markYears('1945 年提出的冯诺依曼结构'), []);
  assert.deepEqual(markYears('2019 年以后的 TCP 实现'), []);
  assert.deepEqual(markYears('【2019 统考真题】……【2025 统考真题】').sort(), [2019, 2025]);
});

test('留着的卷一个字都不进课堂（教材那几处）', () => {
  const books = [{ id: 'B1', title: '王道数据结构', kind: 'textbook' }];
  const chunks = [
    { id: 'B1-1', book: 'B1', seq: 1, kind: '习题', chapter: '第6章 图', title: '1', text: '【2025 统考真题】最短路径 SECRET2025' },
    { id: 'B1-2', book: 'B1', seq: 2, kind: '习题', chapter: '第6章 图', title: '2', text: '【2019 统考真题】最短路径 OK2019' },
    { id: 'B1-3', book: 'B1', seq: 3, kind: '习题', chapter: '第6章 图', title: '【2024 统考真题】', text: '标题里带 SECRET2024' },
  ];
  const b = scrubBooks({ books, chunks, loading: false }, [2024, 2025, 2026]);
  assert.equal(b.scrubbed, 2);
  assert.equal(b.loading, false);
  const all = [JSON.stringify(textbookForClass({ books: b.books, chunks: b.chunks, block: { chunks: ['B1-1', 'B1-2', 'B1-3'] } })),
    JSON.stringify(searchChunks(b.chunks, '最短路径')), bookCatalog(b.books, b.chunks), readChunks(b.chunks, b.books, ['B1-1', 'B1-2', 'B1-3']).text].join('\n');
  assert.ok(!all.includes('SECRET2025'));
  assert.ok(!all.includes('SECRET2024'));
  assert.ok(all.includes('OK2019'));
  assert.equal(scrubChunks(chunks, []).length, 3);
});

test('usable：留着那几年的题、卷标了 reserve 的题都不能用', () => {
  assert.equal(usable({ id: 'Q-408-2025-3' }, [2025]), false);
  assert.equal(usable({ id: 'Q-408-2019-3', reserve: true }, [2025]), false);
  assert.equal(usable({ id: 'Q-408-2019-3', year: 2019 }, [2025]), true);
  assert.equal(usable({ id: 'Q-408-2019-3', year: 2025 }, [2025]), false);
});

test('readReserve：读档案；读不到、超时用默认', async () => {
  const db = (data, ms = 0) => ({ doc: () => ({ get: () => new Promise((r) => setTimeout(() => r({ exists: !!data, data: () => data }), ms)) }) });
  assert.deepEqual(await readReserve(db({ reserve: [2023] }), '2026-11-12'), [2023]);
  assert.deepEqual(await readReserve(db(null), '2026-11-12'), [2024, 2025, 2026]);
  assert.deepEqual(await readReserve({ doc: () => ({ get: () => Promise.reject(new Error('x')) }) }, '2026-11-12'), [2024, 2025, 2026]);
  assert.deepEqual(await readReserve(db({ reserve: [2023] }, 200), '2026-11-12', { ms: 20 }), [2024, 2025, 2026]);
});
