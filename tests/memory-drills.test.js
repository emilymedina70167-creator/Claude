// 页面自己跑的练习和混练（docs/learning-plan.md 第 3 节）
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { fencesOf, drillId, withId, harvestDrills, pickDrills, interleave, drillOutcome, reviewPendings, drillPack, drillHistory } = await import('../kit/src/memory/drills.js');
const { buildReport } = await import('../kit/src/memory/report.js');
const { toEvidence } = await import('../kit/src/memory/session.js');
const { toAnswer } = await import('../kit/src/live/sync.js');
const { checkMemory } = await import('../kit/src/memory/check.js');
const { applyPending } = await import('../kit/src/memory/memo.js');
const { COLLECTIONS } = await import('../kit/src/memory/schema.js');
const { sampleMemory } = await import('../kit/src/memory/sample.js');

const SEG = {
  id: 'b2', seq: 2, page: 1, title: '算一算', md: [
    '先看一道：',
    '```answer',
    'id: q1',
    'q: $1+1$ 等于几？',
    'answer: 2',
    '```',
    '',
    '```scene',
    'id: fig1',
    'vector a = (1, 2)',
    '```',
  ].join('\n'),
};
const LET = { id: 'b1', seq: 1, page: 1, title: '记号', md: '```let\nA = [[1,2],[3,4]]\n```' };
const rec = (comp, ok, extra = {}) => toEvidence('record', toAnswer({ type: 'answer', block: comp, q: '题 ' + comp, ok, attempts: 1, final: true, step: 'b2', ...extra }), { session: 'c-20261001-1', block: 'L2.2.1', ...extra.ctx });

test('fencesOf / withId：读出段里的组件，换成题库编号', () => {
  const fs = fencesOf(SEG.md);
  assert.deepEqual(fs.map((f) => [f.lang, f.id]), [['answer', 'q1'], ['scene', 'fig1']]);
  const id = drillId('c-20261001-1', 'q1');
  assert.equal(id, 'd-20261001-1-q1');
  assert.ok(COLLECTIONS.drills.id.re.test(id));
  assert.match(withId(fs[0], id), /^```answer\nid: d-20261001-1-q1\nq: \$1\+1\$/);
  assert.match(withId({ lang: 'quiz', body: 'q: 选一个' }, 'd-x'), /^```quiz\nid: d-x\nq: 选一个/);
});

test('harvestDrills：判得了分的组件连同 let 块抄进题库；图不抄；抄过的不再抄；挂上错题', () => {
  const evidence = [rec('q1', false, { attempts: 2, final: false }), rec('q1', true, { attempts: 2 })];
  const report = buildReport({ session: { id: 'c-20261001-1', block: 'L2.2.1' }, evidence, steps: [LET, SEG] });
  const mem = { errors: [{ id: 'L2-08', q: 'x', evidence: [evidence[0].id] }] };
  const out = harvestDrills({ session: { id: 'c-20261001-1', block: 'L2.2.1' }, steps: [SEG, LET], report, mem });
  assert.equal(out.length, 1);
  const d = out[0];
  assert.equal(d.id, 'd-20261001-1-q1');
  assert.ok(d.doc.md.startsWith('```let\nA = [[1,2],[3,4]]\n```'), 'let 块在前');
  assert.ok(d.doc.md.includes('id: d-20261001-1-q1'));
  assert.equal(d.doc.block, 'L2.2.1');
  assert.equal(d.doc.orig, 'ok');
  assert.deepEqual(d.doc.errors, ['L2-08']);
  assert.equal(d.doc.fromSession, 'c-20261001-1');
  assert.deepEqual(harvestDrills({ session: { id: 'c-20261001-1' }, steps: [SEG], report, existing: [{ id: d.id }] }), []);
  assert.deepEqual(harvestDrills({ session: { id: 'c-20261001-1', kind: 'drill' }, steps: [SEG], report }), [], '练习本身不再抄');
  // 自检：题库的文档守规矩
  const m = sampleMemory('2026-10-01');
  m.drills = [{ id: d.id, ...d.doc }];
  assert.deepEqual(checkMemory(m, { today: '2026-10-01' }).problems.filter((p) => p.coll === 'drills'), []);
});

test('pickDrills：到期的复现组、掉了的块、错过的优先；刚做对的不挑；同一块最多 3 道；挨着的尽量不同块', () => {
  const today = '2026-10-10';
  const mk = (id, block, extra = {}) => ({ id, block, md: '```quiz\nid: ' + id + '\nq: x\n- [x] a\n- [ ] b\n```', q: id, status: 'active', at: 1, ...extra });
  const mem = {
    drills: [mk('d-a1', 'L2.2.1'), mk('d-a2', 'L2.2.1'), mk('d-a3', 'L2.2.1'), mk('d-a4', 'L2.2.1'), mk('d-b1', 'L2.2.2', { orig: 'wrong' }), mk('d-c1', 'L2.3.1'), mk('d-v', 'L2.3.1', { status: 'void' }), mk('d-k', 'L2.3.1', { broken: true })],
    reviews: [{ id: 'R1', title: '外积', tier: 3, last: '2026-10-01', blocks: ['L2.2.1'], status: 'active' }],
    mastery: [{ id: 'L2.3.1', state: '掉了', basis: ['x'] }],
    evidence: [toEvidence('record', toAnswer({ type: 'quiz', block: 'd-c1', q: 'x', ok: true, attempts: 1, at: Date.parse('2026-10-10T08:00:00') }), { session: 'c-20261010-1', block: 'L2.3.1' })],
  };
  const r = pickDrills(mem, { space: 'math', today, n: 8 });
  const ids = r.items.map((x) => x.id);
  assert.ok(!ids.includes('d-v') && !ids.includes('d-k'), '作废的、坏了的不挑');
  assert.ok(!ids.includes('d-c1'), '今天刚做对');
  assert.equal(ids.filter((x) => x.startsWith('d-a')).length, 3, '同一块最多 3 道');
  assert.deepEqual(r.reviews, ['R1']);
  assert.ok(r.items.find((x) => x.id === 'd-a1').why.includes('R1'));
  for (let i = 1; i < r.items.length; i++) if (r.items[i].block === r.items[i - 1].block) assert.ok(r.items.slice(i).every((x) => x.block === r.items[i].block), '能错开就错开');
  assert.deepEqual(interleave([{ block: 'A' }, { block: 'A' }, { block: 'B' }]).map((x) => x.block), ['A', 'B', 'A']);
});

test('drillOutcome：每道题的结果、复现组没过照记（原题都对不升档）、没过的拼成开课资料包', () => {
  const drills = [{ id: 'd-a1', block: 'L2.2.1', q: '一', md: 'x' }, { id: 'd-a2', block: 'L2.2.1', q: '二', md: 'y' }, { id: 'd-b1', block: 'L2.2.2', q: '三', md: 'z', from: { session: 'c-1', comp: 'q3' } }];
  const ev = (comp, ok, attempts = 1) => toEvidence('record', toAnswer({ type: 'answer', block: comp, q: comp, ok, attempts, final: true }), { session: 'c-20261010-1' });
  const evidence = [ev('d-a1', true), ev('d-a2', true), ev('d-b1', true, 2)];
  const mem = sampleMemory('2026-10-10');
  mem.reviews = [{ id: 'R1', title: '外积', tier: 3, last: '2026-10-01', blocks: ['L2.2.1'], status: 'active', log: [] }, { id: 'R2', title: '别的', tier: 1, blocks: ['L2.2.2'], status: 'active', log: [] }];
  const res = drillOutcome({ drills, evidence, mem, reviews: ['R1', 'R2'] });
  assert.deepEqual(res.rows.map((x) => x.outcome), ['first', 'first', 'ok']);
  assert.deepEqual(res.wrong, ['d-b1']);
  // 原题都对了：不算复现通过，档位不动（我的规则：复现要新题、不是原题换数）
  assert.equal(res.reviewResults.find((x) => x.id === 'R1'), undefined);
  assert.deepEqual(res.practiced, [{ id: 'R1', n: 2 }]);
  // 原题都没一次做对：照样记没过
  const r2 = res.reviewResults.find((x) => x.id === 'R2');
  assert.deepEqual([r2.passed, r2.tier], [false, 1]);
  const pds = reviewPendings(res.reviewResults, { session: 'c-20261010-1', date: '2026-10-10', mem });
  const pd = { id: pds[0].id, ...pds[0].doc };
  assert.equal(pd.by, 'page');
  const w = applyPending(pd, mem, { date: '2026-10-10' }).writes.find((x) => x.coll === 'reviews').doc;
  assert.deepEqual([w.result, w.tier, w.last], ['没过', 1, '2026-10-10']);
  assert.ok(w.log.some((l) => l.field === 'result' && l.by === 'page'));
  const pack = drillPack(res.rows, drills, { answers: { 'd-b1': '3x3' }, mem });
  assert.equal(pack.main.block, 'L2.2.2');
  assert.match(pack.main.student, /d-b1.*第一次错.*3x3/);
  assert.equal(pack.problems.items[0].md, 'z');
  assert.equal(drillPack(res.rows.filter((x) => x.outcome === 'first'), drills), null);
  assert.equal(drillHistory(evidence)['d-b1'].outcome, 'ok');
});

test('教研室出的新题：第一次做、都一次做对，复现组才升档；再做一次就是原题；挑题时没做过的新题优先', async () => {
  const drills = [{ id: 'd-lab-newproblems-R1-1', block: 'L2.2.1', q: '新', md: 'x', src: 'lab', review: 'R1' }, { id: 'd-a1', block: 'L2.2.1', q: '原', md: 'y' }];
  const ev = (comp, ok) => toEvidence('record', toAnswer({ type: 'answer', block: comp, q: comp, ok, attempts: 1, final: true }), { session: 'c-20261010-1' });
  const evidence = [ev('d-lab-newproblems-R1-1', true), ev('d-a1', true)];
  const mem = sampleMemory('2026-10-10');
  mem.reviews = [{ id: 'R1', title: '外积', tier: 3, last: '2026-10-01', blocks: ['L2.2.1'], status: 'active', log: [] }];
  const first = drillOutcome({ drills, evidence, mem, reviews: ['R1'], fresh: new Set(['d-lab-newproblems-R1-1']) });
  assert.deepEqual(first.reviewResults.map((x) => [x.id, x.passed, x.tier]), [['R1', true, 7]], '有没见过的新题、都对：升一档');
  const again = drillOutcome({ drills, evidence, mem, reviews: ['R1'] });
  assert.deepEqual(again.practiced, [{ id: 'R1', n: 2 }], '做过的新题是原题了');
  const picked = pickDrills({ ...mem, drills: [...drills, { id: 'd-a2', block: 'L2.2.1', q: '原二', md: 'z' }], evidence: [] }, { space: 'math', today: '2026-10-10', n: 1 });
  assert.equal(picked.items[0].id, 'd-lab-newproblems-R1-1');
  // 掌握：教研室新题第一次做的那节课不算原题
  const { markFresh, isOriginal } = await import('../kit/src/memory/mastery.js');
  const items = markFresh([{ comp: 'd-lab-x-1', session: 's1', first: 1 }, { comp: 'd-lab-x-1', session: 's2', first: 9 }, { comp: 'd-1-q', session: 's1', first: 1 }]);
  assert.deepEqual(items.map(isOriginal), [false, true, true]);
});
