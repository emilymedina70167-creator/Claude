// 核引号（project/quotes.js）：从 memory/summary.js 搬来的，笔记本和别处共用
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quotesIn, quoteFound, checkQuotes, QUOTE_MIN } from '../kit/src/project/quotes.js';

test('quotesIn：只取够长的引号，短的术语不算', () => {
  const text = '学生说过「别再一上来给我九句话」，也提过「表格」好认；板上写的是「that 引导的是同位语从句」。';
  assert.deepEqual(quotesIn(text), ['别再一上来给我九句话', 'that 引导的是同位语从句']);
  assert.equal(QUOTE_MIN, 6);
  assert.deepEqual(quotesIn(''), []);
  assert.deepEqual(quotesIn('没有引号'), []);
});

test('quotesIn：弯引号也认，套着的引号取外面那一层', () => {
  assert.deepEqual(quotesIn('学生说“这种讲法我听不懂啊”。'), ['这种讲法我听不懂啊']);
  assert.deepEqual(quotesIn('学生说「我想要『带着学』的那种课」。'), ['我想要『带着学』的那种课']);
});

test('quoteFound：照抄的过，空白、全角半角、大小写不计', () => {
  const corpus = '第 3 轮：别再一上来给我九句话，先给我结论\n第 7 轮：这里的 That 为什么不是关系代词?';
  assert.ok(quoteFound('别再一上来给我九句话', corpus));
  assert.ok(quoteFound('这里的that为什么不是关系代词？', corpus));
  assert.ok(quoteFound('别再一上来给我九句话,先给我结论', corpus));
});

test('quoteFound：改了两个字的不过', () => {
  const corpus = '第 3 轮：别再一上来给我九句话，先给我结论';
  assert.ok(!quoteFound('别再一开始给我九句话', corpus));
  assert.ok(!quoteFound('不要一上来给我九句话', corpus));
});

test('quoteFound：带省略号的按段找，先后不能乱', () => {
  const corpus = '我觉得现在基本就是回到之前了，我本来设想的是两边取长结合，你怎么看？';
  assert.ok(quoteFound('基本就是回到之前了……两边取长结合', corpus));
  assert.ok(quoteFound('基本就是回到之前了…两边取长结合', corpus));
  assert.ok(quoteFound('基本就是回到之前了...两边取长结合', corpus));
  assert.ok(!quoteFound('两边取长结合……基本就是回到之前了', corpus), '先后乱了');
  assert.ok(!quoteFound('基本就是回到之前了……两边各取所长', corpus), '后一段对不上');
});

test('checkQuotes：列出找不到的那几句；上一版摘要里本来就有的引号过', () => {
  const prev = '学生在读《王道》，把「先给结论再展开」当成自己的习惯。';
  const said = '第 3 轮：别再一上来给我九句话';
  const next = '学生的习惯是「先给结论再展开」。2026-11-16 英语课上说「别再一上来给我九句话」，还说「以后每次都要用表格讲」。';
  const r = checkQuotes({ next, corpus: `${prev}\n${said}` });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['以后每次都要用表格讲']);
  assert.deepEqual(checkQuotes({ next: prev, corpus: prev }), { ok: true, missing: [] });
  assert.deepEqual(checkQuotes({ next: '', corpus: '' }), { ok: true, missing: [] });
});
