// dr-learning-trail T3、T4、T5：分析游标、讲过和会了分开、矛盾一律报
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.TZ = 'Asia/Shanghai';
import { deskState, verifyMastery } from '../kit/src/memory/state.js';
import { sinceAnalysis, cursorLine, spaceOfEvidence, snapshotLine } from '../kit/src/project/trail.js';

const D = (s) => Date.parse(`${s}T10:00:00+08:00`);
const ev = [
  { id: 'e1', src: 'record', kind: 'answer', block: 'L2.1.4', comp: 'q1', q: 'AB=BA?', ok: false, attempts: 1, at: D('2026-11-10'), session: 'c1' },
  { id: 'e2', src: 'record', kind: 'answer', block: 'L2.1.4', comp: 'q2', ok: true, attempts: 1, at: D('2026-11-10'), session: 'c1' },
  { id: 'e3', src: 'record', kind: 'answer', block: 'L2.1.4', comp: 'q3', ok: false, attempts: 2, at: D('2026-11-15'), session: 'c2' },
  { id: 'e4', src: 'say', text: '我懂了', via: 'chat', block: 'L2.1.4', at: D('2026-11-15'), session: 'c2' },
  { id: 'e5', src: 'record', kind: 'answer', block: 'EN-L1.1.1', ok: true, attempts: 1, at: D('2026-11-15'), session: 'c3' },
  { id: 'e6', src: 'record', kind: 'answer', block: 'L2.2.1', ok: true, attempts: 1, fresh: true, at: D('2026-11-16'), session: 'c4' },
  { id: 'e7', src: 'helper', role: 'coach', text: '看乘法顺序', block: 'L2.1.4', at: D('2026-11-16'), session: 'c2' },
];
const mem = {
  evidence: ev,
  sessions: [{ id: 'c1', kind: 'class', block: 'L2.1.4', startedAt: D('2026-11-10') }, { id: 'c2', kind: 'ext', block: 'L2.1.4', startedAt: D('2026-11-15') }, { id: 'c4', kind: 'drill', block: 'L2.2.1', startedAt: D('2026-11-16') }],
  curriculum: [{ id: 'L2.1.4', title: '可交换' }],
  mastery: [
    { id: 'L2.1.4', state: '基础题过', log: [{ date: '2026-11-11', by: 'page', field: 'state', to: '基础题过', basis: ['e2'] }] },
    { id: 'L2.2.1', state: '讲过', log: [{ date: '2026-11-12', by: 'ext', field: 'state', to: '讲过', basis: [] }] },
    { id: 'L2.3.1', state: '基础题过', log: [{ date: '2026-11-12', by: 'ext', field: 'state', to: '基础题过', basis: ['nope'] }] },
  ],
  weaknesses: [{ id: 'W1', title: '矩阵和数混', level: 'L1', status: 'active', space: 'math', blocks: ['L2.1.4'], log: [{ date: '2026-11-12', field: 'level', to: 'L1' }] }],
  errors: [{ id: 'L2-60', weakness: 'W1', date: '2026-11-15' }],
  reviews: [{ id: 'R1', title: '交换性族', tier: 3, status: 'active', blocks: ['L2.1.4'], log: [{ date: '2026-11-14', field: 'result', to: '过', basis: ['e3'] }] }],
};
const coverage = [{ id: 'L2.2.1', kind: 'block', block: 'L2.2.1', sessions: ['c9'], first: D('2026-11-12'), last: D('2026-11-12') }];

test('掌握只认核得上的依据', () => {
  const byId = new Map(ev.map((e) => [e.id, e]));
  assert.equal(verifyMastery(mem.mastery[0], byId).ok, true);
  assert.match(verifyMastery(mem.mastery[2], byId).why, /找不到/);
  assert.match(verifyMastery({ state: '基础题过', log: [{ field: 'state', basis: ['e1'] }] }, byId).why, /没有做对/);
  assert.match(verifyMastery({ state: '讲过' }, byId).why, /没写依据/);
});

test('每块一行 + 矛盾五种', () => {
  const s = deskState({ mem, coverage, space: 'math', today: '2026-11-18' });
  const kinds = s.conflicts.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['maybeKnown', 'review', 'slipped', 'unverified', 'unverified', 'untaught', 'weakness'].sort());
  const r = s.rows.find((x) => x.block === 'L2.1.4');
  assert.equal(r.taught.sessions, 2);
  assert.equal(r.mastery.state, '基础题过');
  assert.match(r.lastSlip, /q3/);
  assert.match(s.text, /可交换/);
  assert.ok(!s.rows.some((x) => x.block.startsWith('EN-')));
});

test('分析游标以后的证据（按科）', () => {
  const r = sinceAnalysis({ evidence: ev, sessions: mem.sessions, cursor: { at: D('2026-11-12') }, space: 'math' });
  assert.equal(r.n, 4);
  assert.match(r.text, /e3　/);
  assert.match(r.text, /学生在对话里说：我懂了/);
  assert.match(r.text, /板边助教/);
  assert.doesNotMatch(r.text, /e5　/);
  assert.equal(sinceAnalysis({ evidence: ev, space: 'en' }).n, 1);
  const small = sinceAnalysis({ evidence: ev, space: 'math', max: 120 });
  assert.ok(small.more > 0);
  assert.match(cursorLine({ cursor: { at: D('2026-11-12') }, n: 4, space: 'math' }), /还有 4 条证据没分析/);
  assert.match(cursorLine({ n: 3, space: 'cs' }), /还没有/);
  assert.equal(spaceOfEvidence({ session: 'c3' }, new Map([['c3', { space: 'en' }]])), 'en');
});

test('现状快照几天前写的', () => {
  assert.match(snapshotLine([{ path: '现状/总览.md', at: D('2026-11-01') }], '2026-11-18'), /17 天前.*该重写了/);
  assert.match(snapshotLine([{ path: '现状/总览.md', at: D('2026-11-15') }], '2026-11-18'), /3 天前（2026-11-15）写的。$/);
  assert.match(snapshotLine([], '2026-11-18'), /还没有/);
});

// dr-memcheck 1、2、4
import { checkMemory } from '../kit/src/memory/check.js';
test('删课记下的编号自检不再报；只增不改的提醒算软的', () => {
  const ledger = { hist: { 'observations/ob-x': 'fp', 'observations/ob-y': 'fp' }, state: {}, flags: [{ key: 'observations/ob-z', msg: 'observations/ob-z 被删掉了', date: '2026-11-17' }] };
  const r = checkMemory({}, { today: '2026-11-18', ledger, deleted: { keys: { 'observations/ob-x': { at: 1 }, 'observations/ob-z': { at: 1 } } } });
  const msgs = r.problems.map((p) => p.msg).join('\n');
  assert.doesNotMatch(msgs, /ob-x|ob-z/);
  assert.match(msgs, /ob-y 被删掉了/);
  assert.ok(r.problems.filter((p) => /被删掉了/.test(p.msg)).every((p) => p.soft));
});
