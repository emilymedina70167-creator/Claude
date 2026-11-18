// 书上做题的记录（dr-batch4 第 2 条）：学生大部分练习在纸上做张宇 1000 题，记进学习台——每题一条证据（src: book），
// 错的、没做出的同时进错题本（学生自己记的，me 写，带书名和题号）。页面不需要书的内容，只要题号结构
// （书的 PDF 在 claude.ai 项目里，外部自己读）。纯函数，tests/memory-bookq.test.js；画面在 bookqview.js。
import { evidenceTags } from './session.js';
import { prefixOf } from './space.js';

// 默认的书（「加一本」存进 meta/problem-books 的 books，和这几本接在一起）
export const DEFAULT_BOOKS = [{ title: '张宇 1000 题', parts: ['基础篇', '强化篇'], subjects: ['高数', '线代', '概率'] }];
// 每题的结果：对 / 错 / 拿不准 / 没做出
export const BOOK_VERDICTS = { right: { label: '对', ok: true }, wrong: { label: '错', ok: false }, unsure: { label: '拿不准', ok: null }, stuck: { label: '没做出', ok: false } };
// 进错题本的：错了、没做出（失手了）；拿不准的只进证据
export const TO_ERRORS = new Set(['wrong', 'stuck']);
const SUBJECT_COURSE = { 线代: 'LA', 高数: 'HM', 概率: 'PS' };
export const NO_MAX = 40;

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** 书单：默认的 + 学生加的（同名的不重复） */
export function bookList(extra = []) {
  const out = [...DEFAULT_BOOKS];
  for (const b of extra || []) if (b?.title && !out.some((x) => x.title === b.title)) out.push({ title: cut(b.title, 40), parts: (b.parts || []).map((x) => cut(x, 20)).filter(Boolean), subjects: (b.subjects || []).map((x) => cut(x, 20)).filter(Boolean) });
  return out;
}

/** 「加一本」：书名、篇（逗号隔开，可空）、科（可空） → 一本书；书名空的抛错 */
export function newBook({ title = '', parts = '', subjects = '' } = {}) {
  const t = cut(title, 40);
  if (!t) throw new Error('写书名');
  const split = (v) => String(v || '').split(/[,，、\s]+/).map((x) => cut(x, 20)).filter(Boolean);
  return { title: t, parts: split(parts), subjects: split(subjects) };
}

/** 题号：「3, 5, 7-9」→ [3, 5, 7, 8, 9]；看不懂、太多的抛错 */
export function parseNos(text) {
  const out = [];
  for (const part of String(text ?? '').split(/[,，、\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d{1,4})(?:[-~～—–到](\d{1,4}))?$/);
    if (!m) throw new Error(`题号「${part}」看不懂：写 3、5、7-9 这样`);
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (b < a) throw new Error(`「${part}」写反了`);
    for (let n = a; n <= b; n++) if (!out.includes(n)) out.push(n);
    if (out.length > NO_MAX) throw new Error(`一次最多记 ${NO_MAX} 道`);
  }
  if (!out.length) throw new Error('写题号');
  return out;
}

/** 一道书上的题写成一行：「1000 题 基础篇 线代 第 2 章 第 15 题」 */
export function bookLabel(book = {}) {
  const title = String(book.title || '').replace(/^张宇\s*/, '');
  return [title, book.part, book.subject, book.ch ? `第 ${book.ch} 章` : '', book.no ? `第 ${book.no} 题` : ''].filter(Boolean).join(' ');
}

/**
 * 一题一条证据：{ id, src: 'book', kind: 'book', book, verdict（对 / 错 / 拿不准 / 没做出）, ok, text, images, block, … }。
 * block：学生选了就写，不选等外部归块
 */
export function bookEvidence({ book, verdict, text = '', images = [], block = null, at = Date.now() } = {}) {
  const v = BOOK_VERDICTS[verdict];
  if (!v) throw new Error('每道题点一个结果：对 / 错 / 拿不准 / 没做出');
  if (!book?.title || !book?.no) throw new Error('书和题号要写');
  return {
    id: `ev-${newId()}`, src: 'book', kind: 'book', book: { ...book }, verdict: v.label, ok: v.ok,
    ...(verdict === 'stuck' ? { giveup: true } : {}), ...(verdict === 'unsure' ? { sure: false } : {}),
    text: cut(text, 2000), images: (images || []).map(String), comp: null, session: null, block: block || null, tags: evidenceTags({ block }), at,
  };
}

/** 错题的编号挂在哪：选了块按块；没选按「门课 + 章」（线代第 2 章 → L2，高数 → HM-L2，概率 → PS-L2） */
export function errorBlockOf({ block = null, book = {} } = {}) {
  if (block) return block;
  const course = SUBJECT_COURSE[book.subject] || 'LA';
  return `${prefixOf(course)}L${Number(book.ch) || 0}`;
}

/** 错题本里那一条要写的（meChange('error-add') 收）：题面是书名和题号，学生写的话当「我写的」和原因 */
export function bookErrorArgs({ book, verdict, text = '', block = null, evidence = '' } = {}) {
  const label = bookLabel(book);
  const v = BOOK_VERDICTS[verdict]?.label || '错';
  return {
    q: `${label}（题面在书上）`,
    mine: text ? cut(text, 400) : verdict === 'stuck' ? '没做出来' : '做错了（学生在纸上做的，没写哪里错）',
    step: verdict === 'stuck' ? '没做出（卡在哪没写）' : '书上的题，学生自己记的：错',
    cause: text ? cut(text, 300) : `学生自己记的：${v}`,
    source: label,
    book: { ...book },
    ...(block ? { block } : {}),
    idBlock: errorBlockOf({ block, book }),
    evidence: evidence ? [evidence] : [],
  };
}
