// 第九轮第 1 批：首页补卡的顺序和提示词（kit/src/aide/fill.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillQueue, cardPrompt, crossPrompt, CARD_HEAD } from '../kit/src/aide/fill.js';
import { cardSrc } from '../kit/src/aide/card.js';

const curriculum = ['DS-L8.1.1', 'DS-L8.2.1', 'DS-L8.2.2', 'DS-L8.3.1', 'L2.1.4'].map((id) => ({ id, level: 'block' }));
const mem = {
  curriculum,
  errors: [{ id: 'DS-L8-05', block: 'DS-L8.2.2' }],
  weaknesses: [],
  mastery: [{ id: 'DS-L8.3.1', state: '讲过' }, { id: 'L2.1.4', state: '讲过' }],
  sessions: [{ id: 'c-1', block: 'DS-L8.2.1' }],
};

test('没卡的、有记录的块都在队里：下一节要用的最前，有错题的其次；数学的不进 408 的队', () => {
  const q = fillQueue(mem, [], { space: 'cs', near: ['DS-L8.2.1'] });
  assert.deepEqual(q, ['DS-L8.2.1', 'DS-L8.2.2', 'DS-L8.3.1']);
});

test('卡是新的不进队；原始记录变了的又进来', () => {
  const cards = ['DS-L8.2.1', 'DS-L8.2.2', 'DS-L8.3.1'].map((b) => ({ id: b, block: b, src: cardSrc(b, mem), at: 5 }));
  assert.deepEqual(fillQueue(mem, cards, { space: 'cs' }).filter((x) => !x.startsWith('x-')), []);
  const more = { ...mem, errors: [...mem.errors, { id: 'DS-L8-06', block: 'DS-L8.2.2' }] };
  assert.deepEqual(fillQueue(more, cards, { space: 'cs' }).filter((x) => !x.startsWith('x-')), ['DS-L8.2.2']);
});

test('跨块卡：这一科有 3 张卡以后才写，有比它新的卡就重写', () => {
  const two = ['DS-L8.2.1', 'DS-L8.2.2'].map((b) => ({ id: b, block: b, src: cardSrc(b, mem), at: 5 }));
  assert.ok(!fillQueue(mem, two, { space: 'cs' }).includes('x-cs'));
  const three = [...two, { id: 'DS-L8.3.1', block: 'DS-L8.3.1', src: cardSrc('DS-L8.3.1', mem), at: 7 }];
  assert.ok(fillQueue(mem, three, { space: 'cs' }).includes('x-cs'));
  assert.ok(!fillQueue(mem, [...three, { id: 'x-cs', space: 'cs', at: 9 }], { space: 'cs' }).includes('x-cs'));
  assert.ok(fillQueue(mem, [...three, { id: 'x-cs', space: 'cs', at: 6 }], { space: 'cs' }).includes('x-cs'));
});

test('提示词：有开头、不用他她', () => {
  const p = cardPrompt({ block: 'DS-L8.2.1', title: '直接插入排序', scope: '有序区', raw: '## 相关的错题\n- DS-L8-05', old: '' });
  assert.ok(p.startsWith(CARD_HEAD));
  assert.ok(!/[他她](?!们)/.test(p));
  const x = crossPrompt({ space: 'cs', firsts: [{ id: 'DS-L8.2.1', line: '稳定性没过关' }], old: '' });
  assert.ok(x.startsWith(CARD_HEAD));
  assert.ok(!/[他她](?!们)/.test(x));
});
