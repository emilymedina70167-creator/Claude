// 信心标定、页面按证据算掌握（docs/learning-plan.md 第 2 节）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { walk, masteryProposals, masteryPendingWrites, MASTERY_RULE } = await import('../kit/src/memory/mastery.js');
const { buildReport, itemKey } = await import('../kit/src/memory/report.js');
const { applyPending, pendingTitle, undoPending, voidedIds } = await import('../kit/src/memory/memo.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');
const { toEvidence } = await import('../kit/src/memory/session.js');
const { toAnswer } = await import('../kit/src/live/sync.js');
const { sureKey, wantsSure } = await import('../kit/src/confidence.js');
const { actionText, actionTrigger, reportable } = await import('../kit/src/class/prompt.js');

const DAY = 86400000;
const T0 = Date.parse('2026-10-01T10:00:00');
const at = (d, min = 0) => T0 + d * DAY + min * 60000;

// 一次作答 → 证据（和页面上的写法一样：session.record → toAnswer → toEvidence）
function rec({ comp, q = '题', ok, attempts = 1, final = true, d = 0, min = 0, session = 'c-20261001-1', block = 'L2.2.1', point = '', revealed }) {
  return toEvidence('record', toAnswer({ type: 'answer', block: comp, q, ok, attempts, final, revealed, at: at(d, min) }), { session, block, point });
}
function sure({ comp, q = '题', sure: s, ok = true, d = 0, min = 1, session = 'c-20261001-1', block = 'L2.2.1' }) {
  const key = sureKey({ block: comp, q, type: 'answer' });
  return toEvidence('event', { type: 'sure', block: comp, detail: { sure: s, key, ok }, at: at(d, min) }, { session, block });
}

test('sureKey 和课后报告里那道题的键对得上；一道题只问一次', () => {
  const r = toAnswer({ type: 'answer', block: 'q1', q: '求 $A^2$ 的第一行', ok: true, attempts: 1 });
  const ev = toEvidence('record', r, { session: 's', block: 'L1.1.1' });
  assert.equal(sureKey({ type: 'answer', block: 'q1', q: '求 $A^2$ 的第一行' }), itemKey(ev));
  const st = { type: 'stepper', block: 'p1', q: '下一步换哪一页', detail: '第 3 步', ok: false };
  assert.equal(sureKey(st), 'p1|第 3 步');
  const asked = new Set();
  assert.ok(wantsSure(st, asked));
  asked.add(sureKey(st));
  assert.ok(!wantsSure(st, asked), '问过了');
  assert.ok(!wantsSure({ ...st, detail: '第 4 步', revealed: true }, asked), '看了答案不问');
  assert.ok(!wantsSure({ type: 'conjecture', block: 'c1', ok: true }, asked), '猜想不问');
  assert.ok(!wantsSure({ type: 'answer', block: 'q9' }, asked), '没判出对错不问');
});

test('报告：每道题带 sure，reportText 写出没把握', () => {
  const evs = [rec({ comp: 'q1', ok: true }), sure({ comp: 'q1', sure: false })];
  const r = buildReport({ session: { id: 'c-20261001-1' }, evidence: evs });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].sure, false);
  assert.equal(r.totals.unsure, 1);
});

test('walk：两道干净 → 基础题过；隔够 1 天 → 复现通过 1；失手 → 掉了；没把握不算干净', () => {
  const it = (key, outcome, d, s = null) => ({ key, outcome, first: at(d), sure: s, evidence: [`ev-${key}-${d}`] });
  assert.equal(walk([it('a', 'first', 0)]).state, '未学');
  assert.equal(walk([it('a', 'first', 0), it('a', 'first', 0)]).state, '未学', '同一道题两遍不算两道');
  assert.equal(walk([it('a', 'first', 0), it('b', 'first', 0, false)]).state, '未学', '没把握不算');
  const b = walk([it('a', 'first', 0), it('b', 'first', 0)]);
  assert.equal(b.state, '基础题过');
  assert.deepEqual(b.basis, ['ev-a-0', 'ev-b-0']);
  assert.equal(walk([it('a', 'first', 0), it('b', 'first', 0), it('c', 'first', 0)]).state, '基础题过', '同一天不算复现');
  const r1 = walk([it('a', 'first', 0), it('b', 'first', 0), it('c', 'first', 1)]);
  assert.deepEqual([r1.state, r1.tier], ['复现通过', 1]);
  const r3 = walk([it('a', 'first', 0), it('b', 'first', 0), it('c', 'first', 1), it('d', 'first', 3)]);
  assert.deepEqual([r3.state, r3.tier], ['复现通过', 1], '1 天那档之后要隔够 3 天');
  const r3b = walk([it('a', 'first', 0), it('b', 'first', 0), it('c', 'first', 1), it('d', 'first', 4)]);
  assert.deepEqual([r3b.state, r3b.tier], ['复现通过', 3]);
  const lost = walk([it('a', 'first', 0), it('b', 'first', 0), it('c', 'ok', 2)]);
  assert.equal(lost.state, '掉了', '第一次错后来改对也算失手');
  assert.equal(walk([it('a', 'first', 0), it('x', 'wrong', 0), it('b', 'first', 0)]).state, '未学', '中间错了重新数');
  // 从现有状态出发
  const from = walk([it('c', 'first', 16)], { state: '复现通过', tier: 7, last: '2026-10-02' });
  assert.deepEqual([from.state, from.tier], ['复现通过', 14]);
  assert.ok(MASTERY_RULE.text.includes('基础题过'));
});

test('walk：练一练的原题（d-…）做对不算干净、不升档；做错照样掉了', () => {
  const it = (key, outcome, d, comp = key) => ({ key, comp, outcome, first: at(d), sure: null, evidence: [`ev-${key}-${d}`] });
  assert.equal(walk([it('d-1', 'first', 0), it('d-2', 'first', 0)]).state, '未学', '原题两道对了不算基础题过');
  const base = { state: '基础题过', last: '2026-10-01' };
  assert.equal(walk([it('d-1', 'first', 5)], base).state, '基础题过', '隔够天数做对原题也不算复现通过');
  assert.deepEqual([walk([it('c', 'first', 5)], base).state], ['复现通过'], '新题照样算');
  assert.equal(walk([it('d-1', 'wrong', 5)], base).state, '掉了', '原题都错了：掉了');
});

test('masteryProposals：按块和知识点出提议；记忆里已经定下的只看那以后的；改动单不重复', () => {
  const mem = sampleMemory('2026-10-01');
  mem.mastery = (mem.mastery || []).filter((m) => !String(m.id).startsWith('L2.2.1'));
  mem.pending = [];
  mem.evidence = [
    rec({ comp: 'q1', q: '题一', ok: true, point: 'tr' }),
    rec({ comp: 'q2', q: '题二', ok: true, min: 5, point: 'tr' }),
    rec({ comp: 'q3', q: '题三', ok: true, min: 9 }), sure({ comp: 'q3', q: '题三', sure: false, min: 10 }),
  ];
  const ps = masteryProposals(mem);
  const byT = Object.fromEntries(ps.map((p) => [p.target, p]));
  assert.equal(byT['L2.2.1'].data.state, '基础题过', '块：q1、q2 干净（q3 没把握）');
  assert.equal(byT['L2.2.1#tr'].data.state, '基础题过');
  assert.equal(byT['L2.2.1'].op, 'add');
  assert.ok(byT['L2.2.1'].reason.includes('页面按证据算的'));
  assert.equal(byT['L2.2.1'].data.block, 'L2.2.1');
  assert.ok(byT['L2.2.1'].basis.length >= 2);

  const writes = masteryPendingWrites(ps, mem.pending);
  assert.equal(writes.length, 2);
  const pd = { id: writes[0].id, ...writes[0].doc };
  assert.equal(pd.by, 'page');
  assert.equal(pd.tier, 'direct'); // 页面算了直接写（2026-11-03），能撤销
  assert.match(pendingTitle(pd), /掌握：L2\.2\.1.*基础题过/);
  // 同样的提议已经开着：不再写
  assert.equal(masteryPendingWrites(ps, [pd]).filter((w) => w.doc.target === pd.target).length, 0);
  // 我点过不要：同样的依据不再提
  assert.equal(masteryPendingWrites(ps, [{ ...pd, status: 'rejected' }]).filter((w) => w.doc.target === pd.target).length, 0);

  // 直接写：以 page 的身份写进 mastery，log 记着改动单；自检照样过
  const r = applyPending(pd, mem);
  const doc = r.writes.find((w) => w.coll === 'mastery').doc;
  assert.equal(doc.state, '基础题过');
  assert.equal(doc.log[0].by, 'page');
  assert.equal(doc.log[0].ref, pd.id);
  mem.mastery = [...mem.mastery, { id: pd.target, ...doc }];
  mem.pending = [r.pd];
  const probs = checkMemory(mem, { today: '2026-10-01' }).problems.filter((p) => p.coll === 'mastery' && p.id === pd.target);
  assert.deepEqual(probs, []);
  // 确认以后：同样的证据不再提（只看那以后的）
  assert.ok(!masteryProposals(mem).some((p) => p.target === pd.target));
  // 撤销：新加的一条作废
  const u = undoPending(r.pd, mem, { date: '2026-10-01' });
  const gone = u.writes.find((w) => w.coll === 'mastery').doc;
  assert.equal(gone.status, 'void');
  mem.mastery = mem.mastery.map((m) => (m.id === pd.target ? { id: pd.target, ...gone } : m));
  assert.ok(voidedIds(mem).has(`mastery/${pd.target}`));
});

test('课堂：没把握的动作告诉课堂 Claude；答对了却没把握马上说，别的跟着下一条', () => {
  const a = { source: 'event', type: 'sure', sure: false, ok: true, block: 'q1', step: 'b3' };
  assert.ok(reportable(a));
  assert.equal(actionTrigger(a), 'soon');
  assert.equal(actionTrigger({ ...a, sure: true }), 'later');
  assert.equal(actionTrigger({ ...a, ok: false }), 'later');
  assert.match(actionText(a), /b3 里的组件 q1：学生标了「没把握」——这题答对了.*红线 5/);
  assert.match(actionText({ ...a, sure: true, ok: false }), /有把握.*误解/);
});

test('换数的舞台题（d-stage-…、题库里 random）每次都是新题；不换数的（图）只有第一次是', async () => {
  const { markFresh, isOriginal } = await import('../kit/src/memory/mastery.js');
  const drills = [{ id: 'd-stage-a', random: true }, { id: 'd-stage-g', random: false }];
  const items = [
    { comp: 'd-stage-a', session: 'c-1', first: 1 }, { comp: 'd-stage-a', session: 'c-2', first: 2 },
    { comp: 'd-stage-g', session: 'c-1', first: 1 }, { comp: 'd-stage-g', session: 'c-2', first: 2 },
    { comp: 'd-20261027-1-q3', session: 'c-1', first: 1 },
  ];
  markFresh(items, drills);
  assert.deepEqual(items.map((it) => isOriginal(it)), [false, false, false, true, true]);
});
