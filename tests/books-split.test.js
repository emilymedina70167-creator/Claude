// 分段存的书拼回一本、认出书页、按课程地图写的书页找原文（books/textbook.js 的 normalizeBooks / blockChunks），
// 开课时几本同时读（books/importer.js 的 loadBooks）。
// 2026-11-05：英语书分 35 段存（「英语_p013-027」，每段页码从 1 数），课程地图写「书页 010–025」、一块都没挂条目，
// 开课 8 秒没读完 35 段 → 整节课没有教材，老师要学生「把书页传进资料包」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBooks, splitOf, tocOffset, blockPages, blockChunks, readChunks, bookCatalog, textbookForClass, chunkLine } from '../kit/src/books/textbook.js';
import { loadBooks } from '../kit/src/books/importer.js';

// 一本书分三段存：p001-012（含目录）、p013-027、p028-039。书上印的第 1 页是 PDF 第 10 页
function splitBook() {
  const books = [
    { id: 'B10', title: '英语_p001-012', kind: 'textbook', space: 'en', file: '英语_p001-012.pdf' },
    { id: 'B16', title: '英语_p013-027', kind: 'textbook', space: 'en' },
    { id: 'B17', title: '英语_p028-039', kind: 'textbook', space: 'en' },
  ];
  const chunks = [];
  const add = (book, page, title, section = '', chapter = '') => {
    const seq = chunks.filter((c) => c.book === book).length + 1;
    chunks.push({ id: `${book}-${page}.${seq}`, book, seq, page, pageEnd: page, kind: '说明', title, section, chapter, text: `${title}的原文`.repeat(4) });
  };
  add('B10', 8, '目录');
  chunks.at(-1).text = [
    '第一部分　如何表达一件事——简单句 ……………… 001',
    '第一章　简单句的核心 ……………… 002',
    '第二节　简单句的核心变化——谓语动词的变化 ……………… 010',
    '二、谓语动词的情态 ……………… 026',
  ].join('\n');
  add('B10', 10, '简单句的地位', '', '第一部分 如何表达一件事——简单句');
  add('B10', 11, '第一章结构图', '', '第一章 简单句的核心');
  add('B10', 12, '1. 主谓', '第一节 简单句的核心构成');
  for (let p = 1; p <= 15; p++) add('B16', p, `第 ${p} 页`, p >= 7 ? '第二节 简单句的核心变化——谓语动词的变化' : 'Why to learn 简单句的核心构成？');
  for (let p = 1; p <= 12; p++) add('B17', p, `B17 第 ${p} 页`, p >= 8 ? '二、谓语动词的情态' : 'Why to learn 谓语动词的时态？');
  return { books, chunks };
}

test('分段存的书认得出：标题或文件名是「名字_p013-027」', () => {
  assert.deepEqual(splitOf({ title: '英语_p013-027' }), { series: '英语', from: 13, to: 27 });
  assert.deepEqual(splitOf({ title: '别的', file: '数据结构_p086-175.pdf' }), { series: '数据结构', from: 86, to: 175 });
  assert.equal(splitOf({ title: '26王道《数据结构》' }), null);
});

test('拼回一本：整本的页码、整本里的顺序；书上的目录读出书页比 PDF 少 9 页', () => {
  const nb = normalizeBooks(splitBook());
  const c = nb.chunks.find((x) => x.id === 'B16-7.7');
  assert.equal(c.vol, 'en:英语');
  assert.equal(c.pdf, 19);
  assert.equal(c.printed, 10);
  assert.match(chunkLine(c), /书页 10/);
  // 整本里的顺序：B10 的在前、B17 的在后
  const order = nb.chunks.filter((x) => x.vol === 'en:英语').sort((a, b) => a.vseq - b.vseq).map((x) => x.book);
  assert.deepEqual([...new Set(order)], ['B10', 'B16', 'B17']);
  // 前言那几页（PDF 8 页）没有书页
  assert.equal(nb.chunks.find((x) => x.id === 'B10-8.1').printed, undefined);
  // 不改原来的对象（备份照旧用原样的）
  assert.equal(splitBook().chunks[0].vol, undefined);
});

test('目录转写成表格也认得出页码（王道的目录是「| 第1章　绪论 | 1 |」「| 5.1.2 | 基本术语 | 125 |」）', () => {
  const list = [
    { id: 'T', title: '目录', pdf: 8, text: '| 条目 | 页码 |\n|---|---|\n| 第1章　绪论 | 1 |\n| 1.1　数据结构的基本概念 | 1 |\n| 5.1.2 | 基本术语 | 125 |' },
    { id: 'a', title: '本章考纲', chapter: '第1章 绪论', pdf: 13 },
    { id: 'b', title: '概念', section: '1.1 数据结构的基本概念', pdf: 13 },
    { id: 'c', title: '基本术语', section: '5.1.2 基本术语', pdf: 137 },
  ];
  assert.equal(tocOffset(list), 12);
  // 只一条对得上不算（可能碰巧）
  assert.equal(tocOffset(list.slice(0, 2)), null);
});

test('课程地图写的书页：「书页 010–025」、「王道 2026 版 p.272」；一讲一讲编页的「第1讲 P1–8」不算', () => {
  assert.deepEqual(blockPages({ scope: '《句句真研》一般、进行、完成；书页 010–025' }), [[10, 25]]);
  assert.deepEqual(blockPages({ textbook: [{ ref: '王道 2026 版 p.272' }] }), [[272, 272]]);
  assert.deepEqual(blockPages({ textbook: [{ ref: '教材第1讲 P1–8' }] }), []);
  assert.deepEqual(blockPages({ textbook: [{ ref: '教材第2讲 PDF 第7页（书页 51）' }] }), [[51, 51]]);
});

test('没挂条目的块按书页找到原文；挂了的照旧用挂的', () => {
  const nb = normalizeBooks(splitBook());
  // 书页 16–20 跨两段：B16 的第 13–15 页（PDF 25–27）、B17 的第 1–2 页（PDF 28–29）
  const block = { id: 'EN-L1.2.1', scope: '书页 016–020' };
  const mine = blockChunks(block, nb.chunks);
  assert.deepEqual(mine.map((c) => c.printed), [16, 17, 18, 19, 20]);
  assert.deepEqual(mine.map((c) => c.book), ['B16', 'B16', 'B16', 'B17', 'B17']);
  assert.deepEqual(blockChunks({ chunks: ['B10-12.4'], scope: '书页 010–016' }, nb.chunks).map((c) => c.id), ['B10-12.4']);
  // 认不出书页的书不按页猜（页码不是一套）
  const raw = splitBook();
  raw.chunks.find((c) => c.title === '目录').text = '';
  assert.deepEqual(blockChunks(block, normalizeBooks(raw).chunks), []);
});

test('同一本书以前另转过一份不全的：取对上条数最多的那一本', () => {
  const sb = splitBook();
  // 一份整本的旧转写，只转了书页 10 那一页
  sb.books.push({ id: 'B1', title: '句句真研', kind: 'textbook', space: 'en' });
  sb.chunks.push({ id: 'B1-8.1', book: 'B1', seq: 1, page: 8, kind: '说明', title: '目录', text: sb.chunks[0].text });
  sb.chunks.push({ id: 'B1-11.1', book: 'B1', seq: 2, page: 11, kind: '说明', title: '第一章', chapter: '第一章 简单句的核心' });
  sb.chunks.push({ id: 'B1-19.1', book: 'B1', seq: 3, page: 19, kind: '说明', title: '谓语动词', section: '第二节 简单句的核心变化——谓语动词的变化' });
  const nb = normalizeBooks(sb);
  assert.equal(nb.chunks.find((c) => c.id === 'B1-19.1').printed, 10);
  assert.ok(blockChunks({ scope: '书页 010–016' }, nb.chunks).every((c) => c.vol === 'en:英语'));
});

test('textbook_read 的 pages 按书页取，范围按整本的顺序（不串到别的书）', () => {
  const nb = normalizeBooks(splitBook());
  assert.deepEqual(readChunks(nb.chunks, nb.books, [], { pages: '10-11' }).ids, ['B16-7.7', 'B16-8.8']);
  // 跨两段的范围
  const r = readChunks(nb.chunks, nb.books, ['B16-14.14~B17-1.1']);
  assert.deepEqual(r.ids, ['B16-14.14', 'B16-15.15', 'B17-1.1']);
});

test('开课时放进「教材原文」，开头说明这就是学生传的教材；目录把分段的当一本列', () => {
  const nb = normalizeBooks(splitBook());
  const tb = textbookForClass({ block: { id: 'EN-L1.2.1', scope: '书页 010–016' }, books: nb.books, chunks: nb.chunks, room: 64 * 1024 });
  assert.match(tb.textbook, /书页 10–16：页面按书页找到了这几页的 7 条原文/);
  assert.match(tb.textbook, /不要再让学生传/);
  assert.ok(tb.textbook.includes('### B16-7.7'));
  // 整本那一圈也放进来了（离这几页最近的先放）
  assert.ok(tb.fill.ids.length > 0);
  const cat = bookCatalog(nb.books, nb.chunks);
  assert.match(cat, /B10～B17《英语》（一本书分 3 段存的）/);
});

// 假的数据库：一本书的条目读一次要 ms 毫秒；fail 里的书第一次读失败
function fakeDb({ n = 12, ms = 40, fail = {} } = {}) {
  let inflight = 0, peak = 0;
  const tries = {};
  const snap = (docs) => ({ docs: docs.map((d) => ({ id: d.id, data: () => d })) });
  return {
    get peak() { return peak; },
    collection(path) {
      return {
        async get() {
          if (path === 'books') return snap(Array.from({ length: n }, (_, i) => ({ id: `B${i + 1}`, title: `书${i + 1}`, space: 'en' })));
          const id = path.split('/')[1];
          inflight++; peak = Math.max(peak, inflight);
          await new Promise((r) => setTimeout(r, ms));
          inflight--;
          tries[id] = (tries[id] || 0) + 1;
          if (fail[id] && tries[id] <= fail[id]) throw new Error('网络抖了');
          return snap([{ id: `${id}-1.1`, seq: 1, page: 1, title: 't', text: 'x' }]);
        },
      };
    },
  };
}

test('几本同时读：12 本、每本 40 毫秒，不再是一本接一本（以前 35 段要十几秒）', async () => {
  const db = fakeDb({ n: 12, ms: 40 });
  const t0 = Date.now();
  const r = await loadBooks(db, 'en');
  assert.equal(r.chunks.length, 12);
  assert.ok(db.peak > 1 && db.peak <= 6, `同时读了 ${db.peak} 本`);
  assert.ok(Date.now() - t0 < 12 * 40, '比一本接一本快');
});

test('一本读不到再试一次；还不行跳过这一本、记下来，别的照样读到', async () => {
  const r = await loadBooks(fakeDb({ n: 4, ms: 5, fail: { B2: 1, B3: 5 } }), 'en');
  assert.deepEqual(r.chunks.map((c) => c.book).sort(), ['B1', 'B2', 'B4']);
  assert.deepEqual(r.failed, ['B3']);
});
