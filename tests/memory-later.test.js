// 课后测验只记完整提交；普通练习不能提前泄露留题。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeLater } from '../kit/src/memory/holds.js';
import { classRows } from '../kit/src/memory/views.js';
import { pickDrills, drillPack, drillId } from '../kit/src/memory/drills.js';
import { warmupDrills } from '../kit/src/memory/journey.js';
import { problemsMaterial } from '../kit/src/memory/lab.js';
import { workOrder } from '../kit/src/memory/sentry.js';
const source = { id: 'c-20261116-1', title: '排序', block: 'DS-L1.1.1', status: 'closed', endedAt: Date.parse('2026-11-16T12:00:00Z'), holds: { ids: ['d-one', 'd-two'] }, aims: [{ id: 'a1', can: '判断排序稳定性' }] };
const drills = source.holds.ids.map((id, i) => ({ id, src: 'hold', block: source.block, space: 'cs', status: 'active', md: '题', far: i === 1 }));
const rows = drills.map(d => ({ id: d.id, outcome: 'first' }));
const doc = { id: 'c-20261117-1', hold: source.id };
function memory(value = { ...source }) {
  const docs = new Map(value ? [[`sessions/${source.id}`, value]] : []);
  let writes = 0;
  const db = { doc: path => ({ get: async () => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) }), update: async patch => { writes++; docs.set(path, { ...docs.get(path), ...patch }); } }) };
  return { db, docs, writes: () => writes };
}
test('课列表带出 later，旧课仍为空', () => {
  const later = { n: 2, right: 1 };
  const xs = classRows({ sessions: [{ ...source, later }, { id: '旧课', title: '旧课' }] });
  assert.deepEqual(xs.find(x => x.id === source.id).later, later); assert.equal(xs.find(x => x.id === '旧课').later, undefined);
});
test('回写只添 later，不盖别处的新字段', async () => {
  const m = memory(); m.docs.get(`sessions/${source.id}`).newField = '刚写的';
  await writeLater(m.db, doc, rows, { drills, today: '2026-11-17' });
  const s = m.docs.get(`sessions/${source.id}`);
  assert.equal(s.newField, '刚写的'); assert.deepEqual({ ...s.later, at: 0 }, { n: 2, right: 2, days: 1, far: { n: 1, right: 1 }, at: 0, drill: doc.id });
});
test('同一节只记一次', async () => { const m = memory({ ...source, later: { n: 2 } }); await writeLater(m.db, doc, rows, { drills, today: '2026-11-17' }); assert.equal(m.writes(), 0); });
test('同时结算同一节只写一次', async () => { const m = memory(); await Promise.all([writeLater(m.db, doc, rows, { drills, today: '2026-11-17' }), writeLater(m.db, doc, rows, { drills, today: '2026-11-17' })]); assert.equal(m.writes(), 1); });
test('不存在的课不抛错', async () => { const m = memory(null); await writeLater(m.db, doc, rows, { drills, today: '2026-11-17' }); assert.equal(m.writes(), 0); });
for (const [name, rs] of [['未交', []], ['只做一半', rows.slice(0, 1)], ['跳过', [{ id: 'd-one', outcome: 'first' }, { id: 'd-two', outcome: 'skip' }]]]) test(`${name}不回写`, async () => { const m = memory(); await writeLater(m.db, doc, rs, { drills, today: '2026-11-17' }); assert.equal(m.writes(), 0); });
test('未验的留题不进普通练习，验过后可挑', () => {
  const mem = { sessions: [source], drills, evidence: [] };
  assert.equal(pickDrills(mem, { space: 'cs', today: '2026-11-17' }).items.length, 0);
  mem.sessions = [{ ...source, later: { n: 2 } }]; assert.equal(pickDrills(mem, { space: 'cs', today: '2026-11-17' }).items.length, 2);
});
test('热身也保护留题', () => {
  const id = drillId(source.id, 'q1');
  const last = { ...source, skills: { items: [{ k: 'q1|题', p: 'p1' }] } };
  const mem = { sessions: [{ ...source, holds: { ids: [id] } }], drills: [{ id }] };
  assert.deepEqual(warmupDrills(mem, last, [{ p: 'p1' }]), []);
});
test('未验的题不进带着开课的资料包，也不当教研室的原题或可用新题', () => {
  const reviews = [{ id: 'R1', title: '排序', tier: 1, last: '2026-11-01', blocks: [source.block] }];
  const mem = { sessions: [source], drills: drills.map(d => ({ ...d, md: '保密题面' })), reviews };
  assert.equal(drillPack(rows.map(r => ({ ...r, outcome: 'wrong' })), drills, { mem }), null);
  assert.doesNotMatch(problemsMaterial(mem, { kind: 'newproblems', ref: 'R1' }).prompt, /保密题面/);
  assert.ok(workOrder(mem, { today: '2026-11-17' }).some(x => x.kind === 'newproblems'));
});
