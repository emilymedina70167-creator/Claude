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

// dr-trail-fix 1：学了当成没学——旧记录（学习台以前的课）照算、标出来
import { legacyCoverage, datesIn, basisIndex, sessionOfError } from '../kit/src/memory/state.js';
test('旧记录：依据在错题本、旧记录的文字都认，状态照算、标旧记录', () => {
  const m = {
    errors: [
      { id: 'L1-T01', block: 'L1.1.1', date: '2026-09-27', result: '没过', mine: '萨吕得 0' },
      { id: 'L1-18', block: 'L1.1.1', date: '2026-09-27', mine: '没认出' },
      { id: 'L2-T16', block: 'L2.1.1', date: '2026-10-26', result: '不计（机制过）' },
      { id: 'L2-60', block: 'L2.1.1', date: '2026-11-10', mine: '又写成数' },
      { id: 'EN-L1-07', block: 'EN-L1.2.2', date: '2026-11-16', source: '课堂 c-20261116-1' },
      { id: 'DS-L7-T07', block: 'DS-L7.4.1', date: '2026-09-19' },
    ],
    mastery: [
      { id: 'L1.1.1', state: '掉了', log: [{ field: 'state', date: '2026-10-27', by: 'chat', to: '掉了', basis: ['L1-T01'] }] },
      { id: 'L1.1.2', state: '基础题过', log: [{ field: 'state', date: '2026-10-27', by: 'chat', to: '基础题过', basis: ['旧记录：第1讲复习对话 块1（09-28 当堂题对）'] }] },
      { id: 'L2.1.1', state: '基础题过', log: [{ field: 'state', date: '2026-10-27', by: 'chat', to: '基础题过', basis: ['L2-T16'] }] },
      { id: 'DS-L7.4.1', state: '未学', log: [] },
    ],
    sessions: [{ id: 'c-20261116-1', kind: 'class', block: 'EN-L1.2.3', startedAt: D('2026-11-16') }],
  };
  const idx = basisIndex(m);
  const v = verifyMastery(m.mastery[0], idx);
  assert.equal(v.ok, true);
  assert.equal(v.legacy, true);
  assert.deepEqual(v.from, ['错题本 L1-T01']);
  assert.equal(verifyMastery(m.mastery[1], idx).legacy, true);
  assert.equal(verifyMastery({ state: '讲过', log: [{ field: 'state', basis: ['随便写的'] }] }, idx).ok, false);
  assert.deepEqual(datesIn('09-28 当堂题、2026-10-08 复习', '2026-10-27'), ['2026-10-08', '2026-09-28']);
  assert.deepEqual(datesIn('12-30 讲的', '2026-01-05'), ['2025-12-30']);
  assert.equal(sessionOfError(m.errors[4]), 'c-20261116-1');
  // 页面补的旧的讲过：错题本的日期、依据文字里的日期；学习台里的课记的错题、写着未学的块不补；外部补过的不动
  const lc = legacyCoverage({ mem: m, coverage: [{ id: 'legacy-L2.1.1', kind: 'legacy', block: 'L2.1.1', first: D('2026-09-18'), last: D('2026-09-21'), sessions: [], segs: [], source: '外部补的' }], space: 'math' });
  assert.deepEqual(lc.map((c) => c.block), ['L1.1.1', 'L1.1.2']);
  assert.equal(lc[0].by, 'page');
  assert.equal(toDay(lc[1].first), '2026-09-28');
  assert.equal(legacyCoverage({ mem: m, space: 'cs' }).length, 0);
  assert.equal(legacyCoverage({ mem: m, space: 'en' }).length, 0);
  // 每块一行：讲过（9 月，旧记录）、掌握标旧记录；之后错题本又记了错——真的矛盾照报
  const s = deskState({ mem: m, coverage: [{ id: 'legacy-L2.1.1', kind: 'legacy', block: 'L2.1.1', first: D('2026-09-18'), last: D('2026-10-26'), sessions: [], segs: [], source: '外部补的' }, ...lc], space: 'math', today: '2026-11-18' });
  assert.match(s.text, /L1\.1\.1：讲过（9 月，旧记录）；掌握 掉了（旧记录：错题本 L1-T01，没有原始作答）/);
  assert.match(s.text, /L1\.1\.2：讲过（9 月，旧记录）；掌握 基础题过（旧记录：旧记录的文字 1 条/);
  assert.match(s.text, /L2\.1\.1：讲过（9–10 月，旧记录）/);
  assert.deepEqual(s.conflicts.map((c) => `${c.kind} ${c.block}`), ['slipped L2.1.1']);
  assert.match(s.conflicts[0].text, /L2-60/);
  assert.ok(!/没讲过/.test(s.text.split('每一块：')[1]));
  // 「不计」的检验记录不算失手
  assert.doesNotMatch(s.rows.find((r) => r.block === 'L2.1.1').lastSlip || '', /L2-T16/);
  // 学习台里的课记的错题：那一块那节课讲过（不是旧记录）
  const en = deskState({ mem: m, space: 'en', today: '2026-11-18' });
  assert.match(en.text, /EN-L1\.2\.2：讲过（2026-11-16，1 节）/);
});
const toDay = (t) => new Date(t + 8 * 3600e3).toISOString().slice(0, 10);

// dr-trail-fix 2：游标按写入时间比，事件时间早于写入的那一条不漏
test('分析游标按写入时间 wroteAt', () => {
  const evs = [
    { id: 'a', src: 'say', text: '早说的话', block: 'L2.1.4', at: D('2026-11-17'), wroteAt: D('2026-11-18') + 3600e3 },
    { id: 'b', src: 'record', kind: 'answer', block: 'L2.1.4', ok: true, at: D('2026-11-18'), wroteAt: D('2026-11-18') },
    { id: 'c', src: 'record', kind: 'answer', block: 'L2.1.4', ok: true, at: D('2026-11-16') },
  ];
  const r = sinceAnalysis({ evidence: evs, cursor: { at: D('2026-11-18') - 1000 }, space: 'math' });
  assert.equal(r.n, 2);
  assert.equal(r.upTo, D('2026-11-18') + 3600e3);
  // 显示照事件时间：a（11-17 说的）在 b 前面，标了写入
  assert.ok(r.text.indexOf('a　') < r.text.indexOf('b　'));
  assert.match(r.text, /早说的话.*（写入 2026-11-18 11:00）/);
  assert.match(r.text, new RegExp(`at 写成 ${D('2026-11-18') + 3600e3}`));
  // 游标挪到 upTo：都分析过了
  assert.equal(sinceAnalysis({ evidence: evs, cursor: { at: r.upTo }, space: 'math' }).n, 0);
  // 放不下时先放早写进来的，upTo 只到放下的
  const small = sinceAnalysis({ evidence: evs, cursor: { at: D('2026-11-18') - 1000 }, space: 'math', max: 90 });
  assert.equal(small.shown, 1);
  assert.equal(small.upTo, D('2026-11-18'));
});

// dr-legacy-label：学习台建好以后记的错题（日期在这一科第一节课之后、或来源写着外部黑板）不叫「旧记录」
test('错题本的来源：旧记录 / 错题本（没有原始作答）', () => {
  const m = {
    sessions: [{ id: 'c-20261105-1', kind: 'class', block: 'L2.1.4', startedAt: D('2026-11-05') }],
    errors: [
      { id: 'L2-01', block: 'L2.1.4', date: '2026-09-20', source: '9 月对话', mine: '旧的' },
      { id: 'L2-60', block: 'L2.1.4', date: '2026-11-05', source: '课上', mine: '新的' },
      { id: 'L2-61', block: 'L2.1.4', date: '2026-10-26', source: '第2讲重讲（外部黑板）', mine: '黑板课' },
    ],
    mastery: [{ id: 'L2.1.4', state: '讲过', log: [{ field: 'state', date: '2026-11-06', by: 'ext', to: '讲过', basis: ['L2-60'] }] }],
  };
  const s = deskState({ mem: m, space: 'math', today: '2026-11-18' });
  assert.match(s.text, /L2-01[^\n]*旧记录）/);
  assert.match(s.text, /L2-60[^\n]*错题本（没有原始作答），c-20261105-1）/);
  assert.match(s.text, /L2-61[^\n]*错题本（没有原始作答））/);
  assert.match(s.text, /掌握 讲过（依据在错题本 L2-60，没有原始作答）/);
});
