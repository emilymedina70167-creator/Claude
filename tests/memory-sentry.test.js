// 后方的复查和工作单（kit/src/memory/sentry.js）：不改任何一条，只标出来、排好要做的事
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recheck, recheckText, workOrder } from '../kit/src/memory/sentry.js';

const at = (d) => Date.parse(`${d}T10:00:00+08:00`);
const ev = (id, block, d, ok, extra = {}) => ({ id, block, at: at(d), ok, src: 'record', comp: `qz-${id}`, session: `c-${d.replace(/-/g, '')}-1`, attempts: 1, ...extra });

test('修好了的弱点之后又错、复现组记过之后又错：标出来', () => {
  const mem = {
    weaknesses: [{ id: 'W1', title: 'x', status: 'closed', level: 'L3', blocks: ['L2.2.2'], last: '2026-11-01' }, { id: 'W2', title: 'y', status: 'active', level: 'L1', blocks: ['L2.2.2'] }],
    reviews: [{ id: 'R1', title: 'r', result: '过', last: '2026-11-01', blocks: ['L2.2.2'], tier: 3 }],
    evidence: [ev('e1', 'L2.2.2', '2026-11-03', false)],
  };
  const r = recheck(mem);
  assert.deepEqual(r.stale.map((x) => [x.coll, x.id, x.code]), [['weaknesses', 'W1', 'weakness-back'], ['reviews', 'R1', 'review-back']]);
  assert.match(recheckText(r, 'math'), /弱点 W1.*又错了 1 次.*e1/s);
  assert.equal(recheckText(r, 'en'), '', '别的科没有');
});

test('复盘说「消了」的误解，后来的复盘说还在：标出来', () => {
  const mem = { sessions: [
    { id: 'c-1', space: 'en', startedAt: 1, date: '2026-11-01', debrief: { mis: [{ text: '后面那块是在补充前面就判宾补', state: '消了' }] } },
    { id: 'c-2', space: 'en', startedAt: 2, date: '2026-11-03', debrief: { mis: [{ text: '后面一块在补充前面就判成宾补', state: '还在' }] } },
  ] };
  const r = recheck(mem);
  assert.equal(r.stale[0].code, 'misconception-back');
  assert.match(r.stale[0].why, /c-2 的复盘又说它还在/);
});

test('错题之后两节课一上来就做对、没再错：可能已经会了（练一练的原题不算）', () => {
  const base = { errors: [{ id: 'L2-07', block: 'L2.2.2', date: '2026-10-01', cause: '把内积当外积' }] };
  const good = [ev('a', 'L2.2.2', '2026-10-10', true), ev('b', 'L2.2.2', '2026-10-20', true)];
  assert.equal(recheck({ ...base, evidence: good }).maybeSolved.length, 1);
  assert.equal(recheck({ ...base, evidence: [...good, ev('c', 'L2.2.2', '2026-10-25', false)] }).maybeSolved.length, 0, '之后又错过');
  assert.equal(recheck({ ...base, evidence: good.map((e) => ({ ...e, comp: 'd-20261001-1-q1' })) }).maybeSolved.length, 0, '原题不算');
  assert.equal(recheck({ ...base, evidence: [ev('a', 'L2.2.2', '2026-10-10', true), ev('b', 'L2.2.2', '2026-10-10', true, { comp: 'qz-x' })] }).maybeSolved.length, 0, '只有一节课');
});

test('工作单：没收尾的课、缺新题的复现组、该测的弱点（最多 6 条）、该备的课；价值高的在前', () => {
  const now = at('2026-11-05');
  const mem = {
    sessions: [
      { id: 'c-a', kind: 'class', status: 'closed', date: '2026-10-28', space: 'en', report: { items: 13, activeMs: 4e6 }, startedAt: at('2026-10-28') },
      { id: 'c-b', kind: 'class', status: 'closed', date: '2026-11-02', space: 'en', summary: 'ob-1', report: { items: 28 }, startedAt: at('2026-11-02') },
      { id: 'c-c', kind: 'class', status: 'open', date: '2026-11-05', space: 'en', report: { items: 0, activeMs: 60000 }, startedAt: now - 1000 },
    ],
    reviews: [{ id: 'R1', title: '形状族', tier: 1, last: '2026-09-20', blocks: ['L2.2.2'] }],
    drills: [{ id: 'd-1', block: 'L2.2.2', src: 'board', md: 'x' }],
    weaknesses: Array.from({ length: 9 }, (_, i) => ({ id: `W${i}`, title: `弱点${i}`, level: i < 2 ? 'L0' : 'L1', status: 'active', blocks: ['L2.2.2'] })),
    position: [{ id: 'now', block: 'L2.2.3', next: '讲外积' }],
    evidence: [],
  };
  const wo = workOrder(mem, { today: '2026-11-05', now, packs: { math: { main: null } } });
  const kinds = wo.map((x) => x.kind);
  assert.equal(kinds[0], 'backfill');
  assert.deepEqual(wo.filter((x) => x.kind === 'backfill').map((x) => x.ref), ['c-a'], '有小结的、刚开的不算');
  assert.ok(wo.some((x) => x.kind === 'newproblems' && x.ref === 'R1'));
  assert.equal(wo.filter((x) => x.kind === 'probe').length, 6);
  assert.deepEqual(wo.filter((x) => x.kind === 'probe').slice(0, 2).map((x) => x.ref), ['W0', 'W1'], 'L0 在前');
  assert.ok(wo.some((x) => x.kind === 'prep' && x.ref === 'L2.2.3'));
  // 有备好的教案就不列备课；题库有两道新题就不缺新题
  const wo2 = workOrder({ ...mem, drills: [...mem.drills, { id: 'd-2', block: 'L2.2.2', src: 'lab', md: 'x' }, { id: 'd-3', block: 'L2.2.2', src: 'lab', md: 'y' }] }, { today: '2026-11-05', now, packs: { math: { main: { unit: '外积' } } } });
  assert.ok(!wo2.some((x) => x.kind === 'prep' || x.kind === 'newproblems'));
});

test('教研室出的题：探弱点的题还没做就不再出；新题做过一次就不算新题', () => {
  const now = at('2026-11-05');
  const w = { id: 'W5', title: '弱点', level: 'L1', status: 'active', blocks: ['L2.2.2'] };
  const lab = (id, extra) => ({ id, block: 'L2.2.2', src: 'lab', md: 'x', ...extra });
  const base = { weaknesses: [w], evidence: [], sessions: [], reviews: [], drills: [] };
  assert.ok(workOrder(base, { today: '2026-11-05', now }).some((x) => x.kind === 'probe' && x.ref === 'W5'));
  const probing = { ...base, drills: [lab('d-lab-probe-W5-1', { weakness: 'W5' }), lab('d-lab-probe-W5-2', { weakness: 'W5' })] };
  assert.ok(!workOrder(probing, { today: '2026-11-05', now }).some((x) => x.kind === 'probe'), '题还没做，不再出');
  const rv = { id: 'R2', title: '组', tier: 3, last: '2026-10-20', blocks: ['L2.2.2'] };
  const withNew = { ...base, weaknesses: [], reviews: [rv], drills: [lab('d-lab-newproblems-R2-1', { review: 'R2' }), lab('d-lab-newproblems-R2-2', { review: 'R2' })] };
  assert.ok(!workOrder(withNew, { today: '2026-11-05', now }).some((x) => x.kind === 'newproblems'));
  const done = { ...withNew, evidence: [ev('x1', 'L2.2.2', '2026-10-30', true, { comp: 'd-lab-newproblems-R2-1' }), ev('x2', 'L2.2.2', '2026-10-30', true, { comp: 'd-lab-newproblems-R2-2' })] };
  assert.ok(workOrder(done, { today: '2026-11-05', now }).some((x) => x.kind === 'newproblems' && x.ref === 'R2'), '做过的新题成了原题，到期了还要再出');
});
