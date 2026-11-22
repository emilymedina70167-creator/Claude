// 检验接进学习台的记录（Task 12）：meta/state 的吸收行、检验 / 练习分开、掌握参考有检验就只看检验、首页「今天」的复测、
// meta/facts 的复测、课后报告的检验一节
import test from 'node:test';
import assert from 'node:assert/strict';
import { deskState } from '../kit/src/memory/state.js';
import { masteryProposals } from '../kit/src/memory/mastery.js';
import { todayRows, todayFacts, TODAY_KINDS } from '../kit/src/project/today.js';
import { factsDoc } from '../kit/src/project/facts.js';
import { buildReport } from '../kit/src/memory/report.js';

const DAY = (d, h = 10) => new Date(`2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+08:00`).getTime();
const curriculum = [{ id: 'L2.1.1', title: '矩阵与线性运算', level: 'block' }, { id: 'L2.1.4', title: '可交换', level: 'block' }];
const sessions = [{ id: 'c-20261118-1', kind: 'ext', block: 'L2.1.4', space: 'math', startedAt: DAY(18), date: '2026-11-18', status: 'closed' }];
// 一条检验证据（record.js 的 evidenceOf 的样子）
const ck = (probe, outcome, { block = 'L2.1.4', at = DAY(18, 11), sure = 'sure', retryOf = null, session = 'c-20261118-1', final = outcome === 'pass' ? 'pass' : 'fail' } = {}) => ({
  id: `ev-ck-${probe}-${at}`, src: 'check', kind: 'recall', comp: `k1:${probe}`, session, block, tags: [block], check: 'k1', probe, target: 'L2-56', level: '核心', facet: '重建',
  first: '写的', items: [{ id: 'm1', ok: outcome === 'pass' }], outcome, final: retryOf ? null : final, sure, ms: 60000, at, ...(retryOf ? { retryOf } : {}),
});
const practice = (comp, ok, at, block = 'L2.1.4') => ({ id: `ev-${comp}-${at}`, src: 'record', kind: 'answer', comp, session: 'c-20261118-1', block, tags: [block], ok, attempts: 1, at });
const absorb = { id: 'L2.1.4', block: 'L2.1.4', space: 'math', state: '部分', checked: false, date: '2026-11-18', facets: { 重建: 'ok', 能用: 'fixed' }, retests: [{ days: 1, due: '2026-11-19', done: null }, { days: 7, due: '2026-11-25', done: null }], families: ['L2.1.4/L2-56'], check: 'k1', session: 'c-20261118-1' };

test('deskState：有吸收的那一块多一行吸收；最近的作答分检验、练习；只做过这一块检验的课也算讲过', () => {
  const mem = { curriculum, sessions: [...sessions, { id: 'c-20261118-2', kind: 'ext', block: 'L2.1.1', space: 'math', startedAt: DAY(18, 12), status: 'closed' }], absorb: [absorb], evidence: [practice('q1', true, DAY(18, 10)), ck('p3', 'pass'), ck('p1', 'fail', { block: 'L2.1.1', session: 'c-20261118-2' })] };
  const st = deskState({ mem, space: 'math', today: '2026-11-18' });
  const row = st.rows.find((r) => r.block === 'L2.1.4');
  assert.equal(row.absorb, '吸收：部分（页面判，待主讲核）· 11-18 · 重建 ✓ 能用 补上 · 复测 11-19、11-25');
  assert.equal(row.checks.length, 1);
  assert.match(row.checks[0], /检验 k1 · recall p3/);
  assert.equal(row.recent.length, 1);
  assert.match(st.text, /吸收：部分/);
  const r1 = st.rows.find((r) => r.block === 'L2.1.1');
  assert.ok(r1.taught, 'L2.1.1 做过检验，算讲过');
  assert.equal(r1.absorb, null);
  assert.match(st.text, /L2\.1\.1「矩阵与线性运算」：讲过[^\n]*没检验过|L2\.1\.1[^\n]*吸收：还没写/);
});

test('deskState：7 天复测过了写一句', () => {
  const done = { ...absorb, retests: [{ days: 1, due: '2026-11-19', done: '2026-11-19', ok: true }, { days: 7, due: '2026-11-25', done: '2026-11-25', ok: true }] };
  const st = deskState({ mem: { curriculum, sessions, absorb: [done], evidence: [ck('p3', 'pass')] }, space: 'math', today: '2026-11-26' });
  assert.match(st.rows.find((r) => r.block === 'L2.1.4').absorb, /7 天复测过了，进不进复现由外部定/);
});

test('掌握参考：一块有了检验以后只看检验（练习错了也不算）；没检验的块和以前一样', () => {
  const ev = [
    practice('q1', false, DAY(17, 10)), practice('q2', false, DAY(17, 11)), practice('q3', false, DAY(17, 12)),
    ck('p3', 'pass', { at: DAY(18, 11) }), ck('p4', 'pass', { at: DAY(18, 12) }),
    practice('a1', true, DAY(18, 9), 'L2.1.1'), practice('a2', true, DAY(18, 10), 'L2.1.1'),
  ];
  const mem = { curriculum, sessions: [...sessions, { id: 'c-20261117-1', kind: 'ext', block: 'L2.1.4', space: 'math', startedAt: DAY(17), status: 'closed' }], evidence: ev.map((e) => (e.at < DAY(18) ? { ...e, session: 'c-20261117-1' } : e)), mastery: [] };
  const props = masteryProposals(mem);
  const p14 = props.find((p) => p.target === 'L2.1.4');
  assert.equal((p14.patch || p14.data).state, '基础题过', JSON.stringify(p14));
  assert.ok(p14.basis.every((b) => /^ev-ck-/.test(b)), `依据只是检验：${p14.basis}`);
  // 只有练习的块：照旧（两道一次对 → 基础题过）
  const p11 = props.find((p) => p.target === 'L2.1.1');
  assert.equal((p11.patch || p11.data).state, '基础题过');
  // 以前检验里点过「蒙的」：自己说的一句话不算数（2026-11-22），做对了就是做对了
  const guessed = masteryProposals({ ...mem, evidence: [ck('p3', 'pass', { sure: 'guess' }), ck('p4', 'pass', { sure: 'guess', at: DAY(18, 12) })] });
  assert.ok(guessed.find((p) => p.target === 'L2.1.4' && (p.patch || p.data).state === '基础题过'));
  // retry 不算一道题
  const retry = masteryProposals({ ...mem, evidence: [ck('p3', 'pass'), ck('p3a', 'pass', { retryOf: 'p3', at: DAY(18, 12) })] });
  assert.ok(!retry.find((p) => p.target === 'L2.1.4' && (p.patch || p.data).state === '基础题过'));
});

test('首页「今天」：到期的复测一行，挑不到题写缺新题；meta/today 能排 retest', () => {
  assert.ok(TODAY_KINDS.includes('retest'));
  const data = { absorb: [absorb], probes: [], curriculum };
  const rows = todayRows(null, data, '2026-11-19');
  assert.ok(rows.some((r) => r.kind === 'fact' && r.text === '复测：L2.1.4（隔 1 天）' && r.row === 'retest'), JSON.stringify(rows));
  assert.ok(rows.some((r) => r.kind === 'fact' && /缺新题：L2\.1\.4 的 L2-56 那一类/.test(r.text)));
  assert.ok(!todayRows(null, data, '2026-11-18').some((r) => /复测/.test(r.text || '')));
  const mine = todayRows({ date: '2026-11-19', items: [{ kind: 'retest', why: '隔一天' }] }, data, '2026-11-19');
  assert.ok(mine.some((r) => r.kind === 'retest' && r.label === '复测'));
  assert.match(todayFacts(data, '2026-11-19'), /复测 1 块到期/);
});

test('meta/facts：每科到期的复测、缺新题', () => {
  const f = factsDoc({ absorb: [absorb], probes: [], sessions: [] }, '2026-11-19');
  assert.deepEqual(f.spaces.math.retest, [{ block: 'L2.1.4', days: 1, due: '2026-11-19' }]);
  assert.equal(f.spaces.math.missing[0].family, 'L2.1.4/L2-56');
});

test('课后报告：有检验证据多一节 checks', () => {
  const r = buildReport({ session: sessions[0], evidence: [ck('p3', 'pass'), practice('q1', true, DAY(18, 10))] });
  assert.equal(r.checks.length, 1);
  assert.match(r.checks[0], /检验 k1 · recall p3/);
  const none = buildReport({ session: sessions[0], evidence: [practice('q1', true, DAY(18, 10))] });
  assert.equal(none.checks, undefined);
});
