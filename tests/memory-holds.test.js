// 隔天用没见过的题验：只挑合规的新题，结果按第一次作答算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_DAY, HOLD_LATE, holdState, laterOf, laterBrief } from '../kit/src/memory/holds.js';
import { parseProblems } from '../kit/src/memory/problemcheck.js';
import { COLLECTIONS } from '../kit/src/memory/schema.js';
import { createDevAI } from '../kit/src/books/devmock.js';
const s = { id: 'c-20261116-1', kind: 'class', status: 'closed', block: 'DS-L1.1.1', endedAt: Date.parse('2026-11-16T12:00:00Z'), aims: [{ id: 'a1', can: '手算排序的一趟', exam: 'Q-408-2023-01' }, { id: 'a2', can: '辨认排序的稳定性' }] };
const d = (id, extra = {}) => ({ id, src: 'exam', block: s.block, status: 'active', exam: 'Q-408-2022-01', md: '题', ...extra });
test('留题的常量', () => assert.deepEqual([HOLD_DAY, HOLD_LATE], [1, 3]));
for (const [state, session, today] of [['none', s, '2026-11-17'], ['wait', { ...s, holds: { ids: ['a'] } }, '2026-11-16'], ['due', { ...s, holds: { ids: ['a'] } }, '2026-11-17'], ['late', { ...s, holds: { ids: ['a'] } }, '2026-11-19'], ['done', { ...s, holds: { ids: ['a'] }, later: { n: 1 } }, '2026-11-17']]) test(`留题状态 ${state}`, () => assert.equal(holdState(session, today), state));
test('四道三道一次对，两道迁移对一道', () => {
  const ids = ['甲', '乙', '丙', '丁'];
  assert.deepEqual(laterOf(ids.map((id, i) => ({ id, outcome: i === 3 ? 'ok' : 'first', clean: i < 3 })), { session: { ...s, holds: { ids } }, drills: ids.map((id, i) => ({ id, far: i >= 2 })), today: '2026-11-18' }), { n: 4, right: 3, days: 2, far: { n: 2, right: 1 } });
});
test('没交的、跳过的、别的课的题不计入课后结果', () => {
  assert.deepEqual(laterOf([{ id: '甲', outcome: 'skip' }, { id: '乙', outcome: 'open' }, { id: '别课', outcome: 'first' }], { session: { ...s, holds: { ids: ['甲', '乙'] } }, today: '2026-11-17' }), { n: 0, right: 0, days: 1, far: { n: 0, right: 0 } });
});


test('隔天验哪几件：现在的加上课上被换掉的，有作答的在前，编号不撞', async () => {
  const { holdAims } = await import('../kit/src/memory/holds.js');
  const session = { aims: [{ id: 'a1', can: '写出被动谓语' }, { id: 'a2', can: '认出被动谓语' }], aimsPast: [{ id: 'a1', can: '情态动词后面写原形', until: 5 }, { id: 'a3', can: '判情态还是推测', until: 5 }] };
  const report = { aims: [{ id: 'a1', status: 'none' }, { id: 'a2', status: 'none' }], aimsPast: [{ id: 'a1', status: 'led' }, { id: 'a3', status: 'none' }] };
  const got = holdAims(session, report);
  assert.deepEqual(got.map((a) => [a.id, a.can]), [['p1', '情态动词后面写原形'], ['p2', '判情态还是推测'], ['a1', '写出被动谓语'], ['a2', '认出被动谓语']]);
  assert.ok(got.every((a) => !('status' in a) && !('until' in a)));
  assert.equal(new Set(got.map((a) => a.id)).size, 4);
  // 没换过的课：就是现在的那几件
  assert.deepEqual(holdAims({ aims: [{ id: 'a1', can: '甲' }] }).map((a) => a.id), ['a1']);
});

test('隔天验按要拿下的事分开数，只认这节课自己出的留题', () => {
  const ids = ['h1', 'h2', 'h3', 'x'];
  const drills = [{ id: 'h1', hold: s.id, aim: 'a1' }, { id: 'h2', hold: s.id, aim: 'a1' }, { id: 'h3', hold: s.id, aim: 'a2' }, { id: 'x', aim: 'a2' }];
  const rows = [{ id: 'h1', outcome: 'first' }, { id: 'h2', outcome: 'ok' }, { id: 'h3', outcome: 'first' }, { id: 'x', outcome: 'wrong' }];
  const later = laterOf(rows, { session: { ...s, holds: { ids } }, drills, today: '2026-11-17' });
  assert.deepEqual(later.aims, { a1: { n: 2, right: 1 }, a2: { n: 1, right: 1 } });
  assert.equal(later.n, 4); assert.equal(later.right, 2);
});
test('给下一节老师的隔天验：验完逐件写、没做完照实说、没留题不写', () => {
  const later = { n: 3, right: 1, days: 1, far: { n: 0, right: 0 }, aims: { a1: { n: 2, right: 0 }, a2: { n: 1, right: 1 } } };
  const text = laterBrief({ ...s, holds: { ids: ['h1', 'h2', 'h3'] }, later });
  assert.match(text, /隔 1 天做没见过的题：3 道对 1 道/);
  assert.match(text, /手算排序的一趟：2 道对 0 道/);
  assert.match(text, /辨认排序的稳定性：1 道对 1 道/);
  assert.doesNotMatch(text, /[他她]/);
  assert.match(laterBrief({ ...s, holds: { ids: ['h1', 'h2'] } }), /留了 2 道.*还没做完/);
  assert.equal(laterBrief(s), '');
  // 以前存的结果没有按件分：只写总数
  assert.equal(laterBrief({ ...s, holds: { ids: ['h1'] }, later: { n: 1, right: 1, days: 2, far: { n: 0 } } }).split('\n').length, 1);
});
test('课上被换掉的事（p1）也认得出名字', () => {
  const t = laterBrief({ ...s, aimsPast: [{ id: 'a1', can: '被换掉的那件' }], holds: { ids: ['h'] }, later: { n: 1, right: 0, days: 1, aims: { p1: { n: 1, right: 0 } } } });
  assert.match(t, /被换掉的那件：1 道对 0 道/);
});
