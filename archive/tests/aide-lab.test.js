// 第九轮第 1 批：教研室每晚按章合并学生卡；下课后的整理连着没成的交给教研室
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workOrder } from '../kit/src/memory/sentry.js';
import { LAB_CAPS, LAB_VERSION, srcOf, BRIEF_MAX } from '../kit/src/memory/lab.js';
import { cardWork, cardBrief, parseCardReply, chapterOf } from '../kit/src/aide/fill.js';

const card = (id, at, labAt = 0) => ({ id, block: id, at, labAt, text: `概括｜${id} 的情况` });

test('章：块编号去掉最后两段', () => {
  assert.equal(chapterOf('DS-L8.2.1'), 'DS-L8');
  assert.equal(chapterOf('L2.1.4'), 'L2');
});

test('一章有 3 张卡、有一张在上次合并以后又写过：出一项；都合并过了不出', () => {
  const cards = [card('DS-L8.1.1', 10, 20), card('DS-L8.2.1', 30, 20), card('DS-L8.2.2', 15, 20), card('DS-L7.1.1', 5)];
  const items = cardWork(cards);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'card');
  assert.equal(items[0].ref, 'cs-DS-L8');
  assert.ok(items[0].key);
  assert.deepEqual(cardWork(cards.map((c) => ({ ...c, labAt: 40 }))), []);
});

test('工作单：带上卡的那几项；下课后整理连着没成三次的出 after', () => {
  const cards = [card('DS-L8.1.1', 10), card('DS-L8.2.1', 30), card('DS-L8.2.2', 15)];
  const sessions = [{ id: 'c-20261114-1', kind: 'stage', aide: 1, status: 'closed', summary: 'ob-1', block: 'DS-L8.2.1', space: 'cs', after: { fails: 3 }, report: { at: 1, items: 2 } }];
  const items = workOrder({ sessions, observations: [{ id: 'ob-1', session: 'c-20261114-1', kind: 'summary' }] }, { cards });
  assert.ok(items.some((x) => x.kind === 'card' && x.ref === 'cs-DS-L8'));
  assert.ok(items.some((x) => x.kind === 'after' && x.ref === 'c-20261114-1'));
  assert.ok(LAB_CAPS.card > 0 && LAB_CAPS.after > 0);
  assert.ok(LAB_VERSION >= 5);
  assert.equal(srcOf({ kind: 'card', key: 'k1' }), 'k1');
});

test('单子不超大、不用他她；读回只收给了的卡', () => {
  const b = cardBrief({ head: '你是学习台的教研室', space: 'cs', chapter: 'DS-L8', cards: [{ id: 'DS-L8.2.1', text: '概括｜x', raw: '原文'.repeat(100) }] });
  assert.ok(new TextEncoder().encode(b).length <= BRIEF_MAX);
  assert.ok(!/[他她](?!们)/.test(b));
  const r = parseCardReply('## 卡 DS-L8.2.1\n概括｜新的\n\n## 卡 DS-L9.1.1\n概括｜不该写', { ids: new Set(['DS-L8.2.1']) });
  assert.deepEqual(Object.keys(r.cards), ['DS-L8.2.1']);
  assert.equal(r.cards['DS-L8.2.1'].lines[0].text, '新的');
  assert.equal(r.problems.length, 1);
});
