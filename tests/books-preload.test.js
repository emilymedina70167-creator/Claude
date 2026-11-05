// 开课时把这一块所在的整章原文放进「教材原文」（books/textbook.js 的 textbookForClass 的 room、class/bookroom.js）：
// 真课里老师 68 轮调了 21 次 textbook_read，每次多等一整轮；说明长到 160 KiB 出第一个字却不变慢，所以预算内能放多少放多少
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { textbookForClass, chapterFill, chunkText } from '../kit/src/books/textbook.js';
import { systemWithBooks, ROOM_STEP } from '../kit/src/class/bookroom.js';
import { buildSystem, packText, SYSTEM_MAX, PACK_BUDGET, CUT_NOTE, bytes } from '../kit/src/class/prompt.js';
import { componentDocs } from '../kit/build-docs.js';
import { sampleMemory } from '../kit/src/memory/sample.js';

const KiB = 1024;
const DOCS = componentDocs(readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8'));

// 一本假的书：三章，每章 20 条，每条约 3 KB（第二章是这节课的）
const books = [{ id: 'B1', title: '线代30讲', kind: 'textbook' }];
const chunks = [];
for (let ch = 1; ch <= 3; ch++) {
  for (let i = 1; i <= 20; i++) {
    const seq = (ch - 1) * 20 + i;
    chunks.push({ id: `B1-${ch}.${i}`, book: 'B1', seq, kind: i % 3 ? '说明' : '例题', title: `第${ch}讲第${i}条`, chapter: `第${ch}讲`, section: `§${Math.ceil(i / 5)}`, page: seq, text: `第${ch}讲第${i}条的原文。${'矩阵的秩等于行阶梯形非零行的个数。'.repeat(55)}` });
  }
}
const ids = (t) => [...t.textbook.matchAll(/^### (B1-[\d.]+)/gm)].map((m) => m[1]);
const size = (id) => bytes(chunkText(chunks.find((c) => c.id === id), books[0])) + 2;

test('room 是 0：和原来一样（只有点名的、取过的、接着往下的几条）', () => {
  const a = textbookForClass({ main: { chunks: ['B1-2.5', 'B1-2.6'] }, books, chunks });
  const b = textbookForClass({ main: { chunks: ['B1-2.5', 'B1-2.6'] }, books, chunks, room: 0 });
  assert.equal(a.textbook, b.textbook);
  assert.deepEqual(ids(a), ['B1-2.5', 'B1-2.6']);
  assert.doesNotMatch(a.textbook, /整章/);
  assert.deepEqual(a.fill.ids, []);
});

test('地方够：整章都放进来，点名的和取过的一定在，按书里的顺序；开头一句说「一般不用 textbook_read」', () => {
  const t = textbookForClass({ main: { chunks: ['B1-2.5', 'B1-2.6'] }, books, chunks, read: ['B1-2.8'], room: 200 * KiB, nearMax: 8 * KiB });
  const got = ids(t);
  // 取过的和接着往下的几条在前
  assert.equal(got[0], 'B1-2.8');
  for (let i = 1; i <= 20; i++) assert.ok(got.includes(`B1-2.${i}`), `第2讲第${i}条`);
  assert.ok(!got.some((id) => id.startsWith('B1-1.') && Number(id.split('.')[1]) < 15), '上一章只放末尾紧挨着的几条');
  assert.ok(got.includes('B1-1.20') && got.includes('B1-3.1'), '章外紧挨着的两头都放一点');
  // 取过的那几条后面，其余按书里的顺序
  const rest = got.slice(got.indexOf('B1-2.1'));
  const seqOf = (id) => chunks.find((c) => c.id === id).seq;
  assert.deepEqual(rest.map(seqOf), [...rest.map(seqOf)].sort((a, b) => a - b));
  assert.match(t.textbook, /「第2讲」的 20 条全在下面，一般不用 textbook_read/);
  assert.match(t.catalog, /这一章的原文都在「教材原文」里，一般不用 textbook_read/);
  assert.deepEqual(t.fill.chapters, [{ book: 'B1', chapter: '第2讲', n: 20, all: true }]);
  // 章外的不超过 nearMax
  const near = t.fill.ids.filter((id) => !id.startsWith('B1-2.'));
  assert.ok(near.reduce((n, id) => n + size(id), 0) <= 8 * KiB);
});

test('地方不够：按离点名 / 取过的条目的远近放，同样远先放后面的；不超 room，中间不留洞', () => {
  const room = 6 * size('B1-2.11') + 100;
  const t = textbookForClass({ main: { chunks: ['B1-2.10'] }, books, chunks, room });
  assert.ok(ids(t).includes('B1-2.10'));
  // 放得下 6 条：后面 3 条、前面 3 条，同样远先放后面的
  assert.deepEqual(t.fill.ids, ['B1-2.11', 'B1-2.9', 'B1-2.12', 'B1-2.8', 'B1-2.13', 'B1-2.7']);
  const added = t.fill.ids.reduce((n, id) => n + size(id), 0);
  assert.ok(added <= room, `补了 ${added} 字节`);
  assert.match(t.textbook, /放不下全部，下面是离这节课讲到的地方最近的那些/);
  assert.doesNotMatch(t.catalog, /这一章的原文都在/);
  // 点名的条目本身超了 max：它们照样在（按远近排在最前面）
  const u = textbookForClass({ main: { chunks: ['B1-2.1', 'B1-2.2', 'B1-2.3'] }, books, chunks, max: 4 * KiB, room: 8 * KiB });
  for (const id of ['B1-2.1', 'B1-2.2', 'B1-2.3']) assert.ok(ids(u).includes(id), id);
});

test('没点名、块也没挂条目、也没取过：不知道是哪一章，不补', () => {
  const t = textbookForClass({ books, chunks, room: 100 * KiB });
  assert.equal(t.textbook, '');
  // 挂着条目的块：照块补
  const b = textbookForClass({ block: { chunks: ['B1-3.2'] }, books, chunks, room: 100 * KiB });
  assert.ok(b.fill.chapters.every((x) => x.chapter === '第3讲' && x.all));
  // 只取过（上一节同一块的 prevRead）：照取过的那条所在的章补
  const r = textbookForClass({ books, chunks, read: ['B1-1.4'], room: 100 * KiB });
  assert.ok(ids(r).includes('B1-1.20'));
  assert.deepEqual(chapterFill({ chunks, anchors: [], pick: new Map(), textOf: () => '', room: 9e9 }), { ids: [], chapters: [] });
});

// 照课堂（classroom.js 的 packForPrompt）拼资料包
const packWith = (main, extra = {}) => (room) => {
  const tb = textbookForClass({ main, books, chunks, room, ...extra });
  return { main: { ...main, textbook: [main.textbook, tb.textbook].filter(Boolean).join('\n\n'), '教材目录（按需取）': tb.catalog }, problems: { items: [] } };
};

test('整份说明：补到 160 KiB 以内，资料包不被截，别的部分一个字不少', () => {
  const mem = sampleMemory('2026-11-05');
  const block = mem.curriculum?.[0]?.id;
  const main = { unit: '第2讲 秩', goal: '会求秩', chunks: ['B1-2.5', 'B1-2.6'] };
  const board = [{ id: 'b1', md: '## 秩\n\n'.padEnd(2000, '秩'), page: 1 }];
  for (const args of [
    { componentDocs: DOCS, board, subject: '线代', tools: true },
    { componentDocs: DOCS, board, subject: '线代', tools: true, memory: { mem, block, space: 'math', session: 'c-20261105-1' } },
    { componentDocs: DOCS, board, subject: '数据结构', tools: false },
    { componentDocs: DOCS, board, subject: '线代', tools: true, packBudget: PACK_BUDGET >> 1 },
  ]) {
    const base = buildSystem({ ...args, pack: packWith(main)(0) });
    const { system, room } = systemWithBooks(args, packWith(main));
    assert.ok(room > 0 && room % ROOM_STEP === 0, `room ${room}`);
    assert.ok(bytes(system) <= SYSTEM_MAX - 3 * KiB, `说明 ${bytes(system)} 字节`);
    assert.ok(bytes(system) > bytes(base));
    assert.ok(!system.includes(CUT_NOTE), '资料包没被截');
    assert.ok(bytes(packText(packWith(main)(room)).text) <= (args.packBudget ?? PACK_BUDGET));
    for (const id of ['B1-2.5', 'B1-2.6']) assert.ok(system.includes(`### ${id}［`), id);
    // 资料包前面、后面的部分和原来一字不差
    const head = (s) => s.slice(0, s.indexOf('# 三、'));
    const tail = (s) => s.slice(s.search(/# 四、/));
    assert.equal(head(system), head(base));
    assert.equal(tail(system), tail(base));
  }
});

test('说明本来就满了：不补，照原来的', () => {
  const big = { unit: 'u', textbook: '教材原文。'.repeat(300 * KiB / 15), chunks: ['B1-2.5'] };
  const args = { componentDocs: DOCS, board: [], subject: '线代', tools: true };
  const { system, room } = systemWithBooks(args, packWith(big));
  assert.equal(room, 0);
  assert.equal(system, buildSystem({ ...args, pack: packWith(big)(0) }));
  // 没有书：补过的资料包和原来是同一个，说明不再拼第二遍
  let n = 0;
  const same = { main: { unit: 'u' } };
  assert.equal(systemWithBooks(args, () => { n++; return same; }).room, 0);
  assert.equal(n, 2);
});

test('典型的一节课（量给开发看）：「教材原文」从多少变成多少、离 160 KiB 还剩多少', () => {
  const mem = sampleMemory('2026-11-05');
  const args = { componentDocs: DOCS, board: [{ id: 'b1', md: '## 秩'.padEnd(3000, '。'), page: 1 }], subject: '线代', tools: true, memory: { mem, block: mem.curriculum?.[0]?.id, space: 'math', session: 'c-20261105-1' } };
  const main = { unit: '第2讲 秩', goal: '会求秩', chunks: ['B1-2.5', 'B1-2.6', 'B1-2.7'] };
  const before = packWith(main, { read: ['B1-2.9'] })(0).main.textbook;
  const { system, room } = systemWithBooks(args, packWith(main, { read: ['B1-2.9'] }));
  const after = packWith(main, { read: ['B1-2.9'] })(room).main.textbook;
  console.log(`教材原文 ${(bytes(before) / KiB).toFixed(1)} KiB → ${(bytes(after) / KiB).toFixed(1)} KiB；整份说明 ${(bytes(system) / KiB).toFixed(1)} KiB，离 160 KiB 还剩 ${((SYSTEM_MAX - bytes(system)) / KiB).toFixed(1)} KiB`);
  assert.ok(bytes(after) > bytes(before) * 2);
});
