// 隔天用没见过的题验：只挑合规的新题，结果按第一次作答算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_MAX, HOLD_DAY, HOLD_LATE, needsHolds, pickHolds, holdBrief, holdDocs, holdState, laterOf, laterBrief } from '../kit/src/memory/holds.js';
import { parseProblems } from '../kit/src/memory/lab.js';
import { COLLECTIONS } from '../kit/src/memory/schema.js';
import { createDevAI } from '../kit/src/books/devmock.js';
const s = { id: 'c-20261116-1', kind: 'class', status: 'closed', block: 'DS-L1.1.1', endedAt: Date.parse('2026-11-16T12:00:00Z'), aims: [{ id: 'a1', can: '手算排序的一趟', exam: 'Q-408-2023-01' }, { id: 'a2', can: '辨认排序的稳定性' }] };
const d = (id, extra = {}) => ({ id, src: 'exam', block: s.block, status: 'active', exam: 'Q-408-2022-01', md: '题', ...extra });
test('留题的常量', () => assert.deepEqual([HOLD_MAX, HOLD_DAY, HOLD_LATE], [4, 1, 3]));
test('下课有目标的黑板课需要留题', () => { assert.ok(needsHolds(s)); assert.ok(needsHolds({ ...s, kind: undefined })); });
for (const [name, patch] of Object.entries({ 舞台: { kind: 'stage' }, 复现: { review: ['R1'] }, 无目标: { aims: [] }, 有留题: { holds: null }, 已试两次: { holdTries: 2 }, 没下课: { status: 'open' } })) test(`${name}不留题`, () => assert.equal(needsHolds({ ...s, ...patch }), false));
test('只挑同块没做过、非模考且不是目标原题的真题', () => {
  const drills = [d('好题'), d('做过'), d('别块', { block: 'x' }), d('模考', { exam: 'Q-408-2026-01' }), d('目标', { exam: s.aims[0].exam }), d('废题', { status: 'void' }), d('自编', { src: 'lab' })];
  assert.deepEqual(pickHolds({ session: s, drills, evidence: [{ comp: '做过', session: '别课' }], reserve: [2026] }), ['好题']);
});
test('最多四题，先覆盖不同目标', () => {
  const drills = [d('一', { aim: 'a1' }), d('二', { aim: 'a1' }), d('三', { aim: 'a2' }), ...Array.from({ length: 5 }, (_, i) => d(`余${i}`))];
  const ids = pickHolds({ session: s, drills }); assert.equal(ids.length, 4); assert.deepEqual(ids.slice(0, 2), ['一', '三']);
});
test('出题说明列目标、类型、课上原题，不用第三人称', () => {
  const text = holdBrief({ session: s, aims: s.aims, items: [{ q: '原来的题面' }], subject: '数据结构', n: 2 });
  for (const word of [...s.aims.map(a => a.can), '针对：a1', '同类', '迁移', '原来的题面', '=== 题 1']) assert.ok(text.includes(word), word);
  assert.doesNotMatch(text, /他|她/);
});
test('读出类型和目标，换组件编号，题库文档合规', () => {
  const got = parseProblems('=== 题 1\n类型：迁移\n针对：a1\n```answer\nq: 算一算\nanswer: 5\n```', { block: s.block });
  const [it] = holdDocs(got, { session: s, at: 123 });
  assert.equal(it.id, 'd-hold-c-20261116-1-1'); assert.equal(it.doc.src, 'hold'); assert.equal(it.doc.hold, s.id); assert.equal(it.doc.aim, 'a1'); assert.equal(it.doc.far, true); assert.ok(it.doc.md.includes(`id: ${it.id}`)); assert.equal(it.doc.at, 123);
  assert.ok(COLLECTIONS.drills.id.re.test(it.id));
  for (const key of COLLECTIONS.drills.required) assert.ok(it.doc[key]);
});
test('缺类型、乱写目标的不进留题，重号不覆盖', () => {
  const text = '=== 题 1\n类型：同类\n针对：a1\n```quiz\nq: 题一\nanswer: 1\n```';
  const good = parseProblems(text);
  assert.equal(holdDocs({ items: [...good.items, ...good.items] }, { session: s, at: 1 }).length, 1);
  for (const bad of [text.replace('类型：同类', ''), text.replace('针对：a1', '针对：a9')]) assert.deepEqual(holdDocs(parseProblems(bad), { session: s, at: 1 }), []);
});
test('模拟出题有两道、带同类和迁移，能转成留题', async () => {
  const res = await createDevAI().call(holdBrief({ session: s }));
  const docs = holdDocs(parseProblems(res.text), { session: s, at: 1 });
  assert.equal(docs.length, 2); assert.deepEqual(docs.map(d => d.doc.far), [false, true]);
});
for (const [state, session, today] of [['none', s, '2026-11-17'], ['wait', { ...s, holds: { ids: ['a'] } }, '2026-11-16'], ['due', { ...s, holds: { ids: ['a'] } }, '2026-11-17'], ['late', { ...s, holds: { ids: ['a'] } }, '2026-11-19'], ['done', { ...s, holds: { ids: ['a'] }, later: { n: 1 } }, '2026-11-17']]) test(`留题状态 ${state}`, () => assert.equal(holdState(session, today), state));
test('四道三道一次对，两道迁移对一道', () => {
  const ids = ['甲', '乙', '丙', '丁'];
  assert.deepEqual(laterOf(ids.map((id, i) => ({ id, outcome: i === 3 ? 'ok' : 'first', clean: i < 3 })), { session: { ...s, holds: { ids } }, drills: ids.map((id, i) => ({ id, far: i >= 2 })), today: '2026-11-18' }), { n: 4, right: 3, days: 2, far: { n: 2, right: 1 } });
});
test('没交的、跳过的、别的课的题不计入课后结果', () => {
  assert.deepEqual(laterOf([{ id: '甲', outcome: 'skip' }, { id: '乙', outcome: 'open' }, { id: '别课', outcome: 'first' }], { session: { ...s, holds: { ids: ['甲', '乙'] } }, today: '2026-11-17' }), { n: 0, right: 0, days: 1, far: { n: 0, right: 0 } });
});

test('出题说明：这节课抄进题库的原题有就列全文（报告里的题面只有开头），出的题记成页面出的', () => {
  const md = '```answer\nid: q-b3\nq: 引用串 7 0 1 2 0 3 0 4，3 个页框，LRU 缺页几次\nanswer: 6\n```';
  const text = holdBrief({ session: s, items: [{ q: '引用串 7 0 1…' }], originals: [{ id: 'd-c1-b3', md }], subject: '操作系统' });
  assert.ok(text.includes('LRU 缺页几次')); assert.ok(!text.includes('引用串 7 0 1…'));
  const [it] = holdDocs(parseProblems('=== 题 1\n类型：同类\n针对：a1\n```answer\nq: 算一算\nanswer: 5\n```', { block: s.block }), { session: s, at: 1 });
  assert.equal(it.doc.by, 'page');
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
