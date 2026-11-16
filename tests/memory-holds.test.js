// 隔天用没见过的题验：只挑合规的新题，结果按第一次作答算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOLD_MAX, HOLD_DAY, HOLD_LATE, needsHolds, pickHolds, holdBrief, holdDocs, holdState, laterOf } from '../kit/src/memory/holds.js';
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
