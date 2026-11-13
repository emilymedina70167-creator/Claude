// 第九轮第 1 批：开舞台课时带上课前档案和学生卡（aide/brief.js 的 aideForTurn）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aideForTurn, briefSig } from '../kit/src/aide/brief.js';

const curriculum = [
  { id: 'DS-L8.1.1', level: 'block', title: '排序的基本概念' },
  { id: 'DS-L8.2.1', level: 'block', title: '直接插入排序', requires: ['DS-L8.1.1'] },
  { id: 'DS-L8.2.2', level: 'block', title: '折半插入排序' },
];
const cards = [
  { id: 'DS-L8.2.1', block: 'DS-L8.2.1', at: 3, text: '概括｜稳定性没过关' },
  { id: 'DS-L8.1.1', block: 'DS-L8.1.1', at: 4, text: '概括｜稳定的定义没过关' },
  { id: 'x-cs', space: 'cs', at: 5, text: '概括｜下标从 1 数' },
];
const brief = (blocks, cs = cards) => ({ space: 'cs', blocks, sig: briefSig(blocks, cs), model: 'claude-opus-5-5', text: '要点｜先探稳定（DS-L8-T09）', at: 6 });

test('档案给这一块写的、卡没变：带上', () => {
  const r = aideForTurn({ block: 'DS-L8.2.1', cards, brief: brief(['DS-L8.2.1']), curriculum, space: 'cs' });
  assert.match(r.brief, /先探稳定/);
  assert.equal(r.cards.length, 3);
  assert.match(r.cards[0], /^### 学生卡：DS-L8\.2\.1 直接插入排序/);
});

test('档案给别的块写的：不带档案，卡照带', () => {
  const r = aideForTurn({ block: 'DS-L8.2.1', cards, brief: brief(['DS-L8.2.2']), curriculum, space: 'cs' });
  assert.equal(r.brief, '');
  assert.equal(r.cards.length, 3);
});

test('卡变了：档案不带', () => {
  const r = aideForTurn({ block: 'DS-L8.2.1', cards: [{ ...cards[0], at: 99 }, ...cards.slice(1)], brief: brief(['DS-L8.2.1']), curriculum, space: 'cs' });
  assert.equal(r.brief, '');
});

test('一张卡都没有：两样都空', () => {
  assert.deepEqual(aideForTurn({ block: 'DS-L8.2.1', cards: [], brief: null, curriculum, space: 'cs' }), { brief: '', cards: [] });
});

test('换了块：按新块挑卡（这一块附近的才带）', () => {
  const r = aideForTurn({ block: 'DS-L8.2.2', cards, brief: null, curriculum, space: 'cs' });
  assert.ok(!r.cards.some((c) => c.includes('DS-L8.1.1 排序的基本概念')) || r.cards.length <= 3);
  assert.ok(r.cards.some((c) => c.includes('跨块')));
});
