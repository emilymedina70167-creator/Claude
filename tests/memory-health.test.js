// 体检（kit/src/memory/health.js）：只修页面自己的机械字段，Claude 写的内容只记不改
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthCheck, healthRecord, snapTier } from '../kit/src/memory/health.js';
import { sampleMemory } from '../kit/src/memory/sample.js';
import { checkMemory } from '../kit/src/memory/check.js';

const TODAY = '2026-11-05';
const NOW = Date.parse('2026-11-05T12:00:00+08:00');

test('snapTier：不是 1/3/7/14/30 的往下取最近一档', () => {
  assert.deepEqual([1, 3, 5, 7, 10, 30, 99, 0, 'x', undefined].map(snapTier), [1, 3, 3, 7, 7, 30, 30, 1, 1, 1]);
});

test('守规矩的示例记忆：体检什么都不修', () => {
  const res = healthCheck(sampleMemory(TODAY), { today: TODAY, now: NOW });
  assert.deepEqual(res.fixes, []);
});

test('下了课没有结束时间、没写科目、没写日期：按证据补上，标题和小结不动', () => {
  const started = Date.parse('2026-11-01T10:00:00+08:00');
  const mem = {
    sessions: [{ id: 'c-20261101-1', status: 'closed', block: 'DS-L2.1.1', title: '顺序表', summary: '老师写的小结', startedAt: started }],
    evidence: [{ id: 'e1', session: 'c-20261101-1', src: 'record', at: started + 20 * 60000 }],
  };
  const { fixes } = healthCheck(mem, { today: TODAY, now: NOW });
  assert.equal(fixes.length, 1);
  const d = fixes[0].doc;
  assert.equal(d.endedAt, started + 20 * 60000);
  assert.equal(d.space, 'cs');
  assert.equal(d.date, '2026-11-01');
  assert.equal(d.title, '顺序表');
  assert.equal(d.summary, '老师写的小结');
  assert.ok(!('id' in d));
});

test('记忆点档位不对：改成合法的一档并记 log（自检不报「没记 log」），问法答案空的只记不改', () => {
  const mem = { recall: [{ id: 'K1', q: '问', a: '答', tier: 5, last: '2026-11-01', status: 'active' }, { id: 'K2', q: '', a: '答', tier: 3, status: 'active' }] };
  const { fixes, notes } = healthCheck(mem, { today: TODAY, now: NOW });
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].doc.tier, 3);
  assert.equal(fixes[0].doc.q, '问');
  assert.equal(fixes[0].doc.log.at(-1).field, 'tier');
  assert.match(fixes[0].doc.log.at(-1).note, /体检/);
  assert.ok(notes.some((n) => n.id === 'K2' && /不替它写/.test(n.msg)));
  const after = { recall: [{ id: 'K1', ...fixes[0].doc }] };
  const ledger = { recall: { K1: { tier: 5, last: '2026-11-01', status: 'active' } } };
  const res = checkMemory(after, { today: TODAY, ledger });
  assert.ok(!res.problems.some((p) => p.id === 'K1' && /log 里没记/.test(p.msg)), res.problems.map((p) => p.msg).join('\n'));
});

test('Claude 写的几类（错题、弱点、守则、观察）体检从来不修', () => {
  const mem = {
    errors: [{ id: 'L2-01', q: '', session: 'c-没了' }],
    weaknesses: [{ id: 'W1', title: '', level: 'L9' }],
    lessons: [{ id: 'T-1', text: '' }],
    observations: [{ id: 'o1', kind: 'summary', text: '' }],
  };
  const { fixes } = healthCheck(mem, { today: TODAY, now: NOW });
  assert.deepEqual(fixes, []);
});

test('同一科挂着三节没下课、练习挂了几天、证据指着没有的课：只记', () => {
  const t = NOW - 5 * 86400000;
  const mem = {
    sessions: [1, 2, 3].map((i) => ({ id: `c-2026110${i}-1`, date: `2026-11-0${i}`, status: 'open', block: 'L2.1.1', space: 'math', startedAt: t })).concat([{ id: 'c-20261101-9', date: '2026-11-01', status: 'open', kind: 'drill', space: 'math', startedAt: t }]),
    evidence: [{ id: 'e', session: 'c-没有的课', at: t }],
  };
  const { fixes, notes } = healthCheck(mem, { today: TODAY, now: NOW });
  assert.deepEqual(fixes, []);
  assert.ok(notes.some((n) => /挂着 3 节/.test(n.msg)));
  assert.ok(notes.some((n) => /练习挂了 5 天/.test(n.msg)));
  assert.ok(notes.some((n) => /证据指着已经没有的课/.test(n.msg)));
});

test('healthRecord：修过的累计、最多 40 行，提醒只留这一次的', () => {
  let rec = null;
  for (let i = 0; i < 30; i++) rec = healthRecord(rec, { fixes: [{ coll: 'sessions', id: `c-${i}`, what: 'x' }, { coll: 'recall', id: `K${i}`, what: 'y' }], notes: [{ msg: `第 ${i} 次` }] }, { now: i });
  assert.equal(rec.fixed.length, 40);
  assert.equal(rec.fixed[0].id, 'c-29');
  assert.deepEqual(rec.notes, [{ msg: '第 29 次' }]);
  assert.equal(rec.runs, 30);
});

test('sameDoc：字段先后不一样、带不带 id 都算同一份；值不一样就不是', async () => {
  const { sameDoc } = await import('../kit/src/memory/health.js');
  assert.ok(sameDoc({ id: 'c-1', a: 1, b: { y: 2, x: [1, { q: 1, p: 2 }] } }, { b: { x: [1, { p: 2, q: 1 }], y: 2 }, a: 1 }));
  assert.ok(!sameDoc({ a: 1, b: 2 }, { a: 1, b: 3 }));
  assert.ok(!sameDoc({ a: [1, 2] }, { a: [2, 1] }), '数组的先后算数');
});
