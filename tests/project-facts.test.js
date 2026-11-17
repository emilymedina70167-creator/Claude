// 第十五轮：页面能算的事实写进 meta/facts（不调用 Claude）：到期的复现组、要记的到期几条、挂着没下课的课、这 7 天学了几分钟、上一节、体检几条
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsDoc } from '../kit/src/project/facts.js';

const today = '2026-11-18';
const data = {
  reviews: [
    { id: 'R3', title: '秩', tier: 3, last: '2026-11-10', status: 'active', blocks: ['L3.2.1'] },
    { id: 'R9', title: '页面置换', tier: 1, last: '2026-11-16', status: 'active', blocks: ['OS-L3.2.1'] },
    { id: 'R4', title: '乘法', tier: 7, last: '2026-11-17', status: 'active', blocks: ['L2.1.1'] },
  ],
  recall: [{ id: 'K1', q: 'x', a: 'y', tier: 1, last: '2026-11-10', status: 'active', block: 'EN-L1.1.1' }],
  sessions: [
    { id: 'c-20261117-1', date: '2026-11-17', space: 'math', status: 'closed', endedAt: 5, title: '可交换', report: { activeMs: 30 * 60000 } },
    { id: 'c-20261110-1', date: '2026-11-10', space: 'math', status: 'closed', endedAt: 1, title: '旧', report: { activeMs: 90 * 60000 } },
    { id: 'c-20261118-1', date: '2026-11-18', space: 'en', status: 'open', title: '时态', block: 'EN-L1.2.1' },
  ],
};

test('factsDoc：按科列出到期、要记的、挂着的、这 7 天几分钟、上一节', () => {
  const f = factsDoc(data, today, { health: 2 });
  assert.equal(f.today, today);
  assert.deepEqual(f.spaces.math.due.map((d) => d.id), ['R3']);
  assert.equal(f.spaces.math.due[0].days, -5);
  assert.deepEqual(f.spaces.cs.due.map((d) => d.id), ['R9']);
  assert.equal(f.spaces.en.recall, 1);
  assert.deepEqual(f.spaces.en.open.map((x) => x.id), ['c-20261118-1']);
  assert.equal(f.spaces.math.minutes7, 30, '11-10 那节不在这 7 天里');
  assert.equal(f.spaces.math.last.id, 'c-20261117-1');
  assert.equal(f.health, 2);
});
