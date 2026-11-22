// 计划 2 整体审查留下的小毛病
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, parseProbe, selfCheck } from '../kit/src/check/spec.js';
import { createFlow, step } from '../kit/src/check/flow.js';
import { notReady } from '../kit/src/check/judge.js';
import { absorbDoc } from '../kit/src/check/record.js';
import { toFinish } from '../kit/src/check/shellkit.js';
import { judgeOp } from '../kit/src/check/judgekit.js';
import { saveInk, loadInk, hasInk, sweepInk, INK_PREFIX } from '../kit/src/check/inkstore.js';
import { bankDocs, retestCheck, attachBases } from '../kit/src/check/bank.js';
import { lintTurn } from '../tools/ext-lint.js';

const F = '```';
const con = (id, { retry = [], extra = '' } = {}) => `${F}construct\nid: ${id}\nq: 造 ${id}\ntarget: L2-14\nlevel: 基础\nslots: A=mat(2) B=mat(2)\nif: A*B != B*A => 可交换了\nexpr 两边差: (A+B)*(A-B) - (A^2-B^2)\nexample: A=[[1,0],[0,0]] B=[[0,1],[0,0]]\n${extra}teach if1: 换一个。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const rec = (id, { retry = [] } = {}) => `${F}recall\nid: ${id}\nq: 写 ${id}\ntarget: T-${id}\nlevel: 核心\nmust m1: 要点\nteach default: 先乘开。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const OK = { items: [{ id: 'm1', ok: true }], needsClaude: false, stop: false };
const BAD = { items: [{ id: 'm1', ok: false, why: '没写到' }], needsClaude: false, stop: false };
const probe = (src) => { const r = parseProbe('construct', src); if (r.error) throw new Error(r.error); return r.probe; };

test('小 1：构造题的式子框空着、格子里写了读不懂的（1/）都先拦下，说清楚哪儿', () => {
  const p = parseCheck('check id=k1', ['block L2.1.1 must=p1', con('p1', { retry: ['p1a', 'p1b'] }), con('p1a'), con('p1b')].join('\n')).check.probes.p1;
  const full = { slots: { A: [['1', '0'], ['0', '0']], B: [['0', '1'], ['0', '0']] }, exprs: { e1: 'BA-AB' } };
  assert.equal(notReady(p, full), '');
  assert.match(notReady(p, { ...full, exprs: { e1: '' } }), /两边差/);
  assert.match(notReady(p, { ...full, slots: { ...full.slots, A: [['1/', '0'], ['0', '0']] } }), /A.*读不懂/);
  assert.match(notReady(p, { ...full, slots: { ...full.slots, B: [['', '1'], ['0', '0']] } }), /1 格没填/);
  // 根号、分数、负号照认
  assert.equal(notReady(p, { ...full, slots: { A: [['√2', '-1/2'], ['0', '0']], B: full.slots.B } }), '');
});

test('小 2：外部改判中间那道 retry 没过（认同页面的判法），后面那道 retry 补上了的本题还是补上', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', rec('p1', { retry: ['p1a', 'p1b'] }), rec('p1a'), rec('p1b')].join('\n'));
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: BAD, at: 2 });
  s = step(s, { type: 'teachSeen', id: 'p1', at: 3 });
  s = step(s, { type: 'submit', id: 'p1a', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: BAD, at: 4 });
  s = step(s, { type: 'teachSeen', id: 'p1a', at: 5 });
  s = step(s, { type: 'submit', id: 'p1b', answer: { text: 'y' }, sure: 'sure', ms: 1, machine: OK, at: 6 });
  assert.equal(s.results.p1.final, 'fixed');
  s = step(s, { type: 'ext', id: 'p1a', items: [{ id: 'm1', ok: false }], result: 'fail', at: 7 });
  assert.equal(s.results.p1.final, 'fixed');
  // 把补上的那一道改判成没过：才是没吸收，剩下的 retry 欠着（这里用完了）
  s = step(s, { type: 'ext', id: 'p1b', items: [{ id: 'm1', ok: false }], result: 'fail', at: 8 });
  assert.equal(s.results.p1.final, 'fail');
});

test('小 2：retry 待核、外部改判没过 → 本题没吸收，没用过的 retry 欠着（复测先出）', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', rec('p1', { retry: ['p1a', 'p1b'] }), rec('p1a'), rec('p1b')].join('\n'));
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: BAD, at: 2 });
  s = step(s, { type: 'teachSeen', id: 'p1', at: 3 });
  s = step(s, { type: 'submit', id: 'p1a', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: { items: [{ id: 'm1', ok: null }], needsClaude: false, stop: false }, at: 4 });
  assert.equal(s.results.p1.final, 'pending');
  s = step(s, { type: 'ext', id: 'p1a', items: [{ id: 'm1', ok: false }], result: 'fail', at: 5 });
  assert.equal(s.results.p1.final, 'fail');
  assert.deepEqual(s.owed, ['p1b']);
});

test('小 5：做完了还没写完吸收就刷新：找得出要补写的那几次检验', () => {
  const rows = [
    { id: 'k1', state: { phase: 'done', check: {} } },
    { id: 'k2', state: { phase: 'done', finishedAt: 5, check: {} } },
    { id: 'k3', state: { phase: 'probe', check: {} } },
    { id: 'k4', state: { phase: 'done', closed: true, check: {} } },
    { id: 'k5', state: null },
  ];
  assert.deepEqual(toFinish(rows).map((r) => r.id), ['k1', 'k4']);
});

test('小 6：改判块里写错的行不再静默丢掉，照实回报', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', rec('p1', { retry: ['p1a', 'p1b'] }), rec('p1a'), rec('p1b')].join('\n'));
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: { items: [], needsClaude: true, stop: false }, at: 2 });
  const r = judgeOp({ target: 'p1', body: 'm1 ok\nm9 wrong why="没这一项"\n这行看不懂' }, s, { at: 3 });
  assert.equal(r.error, undefined);
  assert.equal(r.state.results.p1.items.find((x) => x.id === 'm1').ok, true);
  assert.ok(r.errors.length >= 1, JSON.stringify(r.errors));
  assert.match(r.errors.join('\n'), /m9|看不懂/);
  assert.match(judgeOp({ target: 'p1a', body: 'm1 ok' }, s, { at: 3 }).error, /还没交/);
});

test('小 7：同一次检验重算吸收（外部改判、补写）时，主讲核过而且结论没变的不改回待核', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', rec('p1', { retry: ['p1a', 'p1b'] }), rec('p1a'), rec('p1b')].join('\n'));
  const result = { state: '成功', facets: { 重建: 'ok' }, probes: ['p1'], block: 'L2.1.1' };
  const first = absorbDoc(null, result, { check, session: 'c-1', today: '2026-11-19', evidence: ['ev1'] });
  assert.equal(first.checked, false);
  const verified = { ...first, checked: true, by: 'ext', log: [...first.log, { date: '2026-11-19', by: 'ext', field: 'checked', from: false, to: true }] };
  const again = absorbDoc(verified, result, { check, session: 'c-1', today: '2026-11-19', evidence: ['ev1'] });
  assert.equal(again.checked, true);
  assert.equal(again.by, 'ext');
  // 结论变了：主讲核的是旧结论，改回待核、log 记着
  const changed = absorbDoc(verified, { ...result, state: '部分' }, { check, session: 'c-1', today: '2026-11-19', evidence: ['ev1'] });
  assert.equal(changed.checked, false);
  assert.equal(changed.log.at(-1).field, 'checked');
  // 换了一次检验：照旧待核
  const next = absorbDoc(verified, result, { check: { ...check, id: 'k2' }, session: 'c-2', today: '2026-11-20', evidence: ['ev2'] });
  assert.equal(next.checked, false);
});

const fakeStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, m };
};

test('小 8：手写板的本地存档：空的不存（不占 key、不把题硬切到手写），过期的清掉', () => {
  const st = fakeStorage();
  const key = `${INK_PREFIX}c-1-k1-p1`;
  saveInk(st, key, { strokes: [], events: [], at: 0, h: 420 }, 1000);
  assert.equal(st.getItem(key), null);
  assert.equal(hasInk(st, key), false);
  saveInk(st, key, { strokes: [{ pts: [1, 2, 3] }], events: [], at: 5, h: 420 }, 1000);
  assert.equal(hasInk(st, key), true);
  assert.equal(loadInk(st, key).strokes.length, 1);
  // 写完又全撤了：存档也删掉
  saveInk(st, key, { strokes: [], events: [{ kind: 'undo' }], at: 9, h: 420 }, 2000);
  assert.equal(hasInk(st, key), false);
  const day = 86400000;
  saveInk(st, key, { strokes: [{ pts: [1, 2, 3] }], events: [], at: 5, h: 420 }, 1000 + 6 * day);
  st.setItem(`${INK_PREFIX}old`, JSON.stringify({ strokes: [{}], wall: 1000 }));
  st.setItem(`${INK_PREFIX}lock-c-1-k1`, JSON.stringify({ id: 'tab', at: 1 }));
  st.setItem('la-theme', 'ink');
  sweepInk(st, 1000 + 8 * day);
  assert.equal(st.getItem(`${INK_PREFIX}old`), null);
  assert.equal(hasInk(st, key), true); // 存了两天的留着
  assert.ok(st.getItem(`${INK_PREFIX}lock-c-1-k1`)); // 标签页的锁不动
  assert.equal(st.getItem('la-theme'), 'ink');
});

test('小 10：要点的自动编号和手写编号撞了：报写法错误，不静默出两个 m1', () => {
  const head = 'id: q\nq: 写\ntarget: x\nlevel: 核心\n';
  assert.match(parseProbe('recall', `${head}must: 一\nmust m1: 二`).error, /m1/);
  assert.match(parseProbe('recall', `${head}wrong w2: 一\nwrong: 二\nmust: 三`).error, /w2/);
  assert.equal(parseProbe('recall', `${head}must m1: 一\nmust: 二`).error, undefined);
  assert.deepEqual(parseProbe('recall', `${head}must m1: 一\nmust: 二`).probe.must.map((x) => x.id), ['m1', 'm2']);
});

test('小 11：题里用到课上 let 定义的量：预检带着这节课的量验 example', () => {
  const turn = [
    '````board check id=k1',
    'block L2.1.1 must=p1',
    con('p1', { retry: ['p1a', 'p1b'], extra: 'if: A*M != M*A => 和 M 可交换了\n' }),
    con('p1a'), con('p1b'),
    '````',
  ].join('\n');
  const prior = ['````board new id=s1 title="板"\n```let\nM = [[1,2],[3,4]]\n```\n````'];
  const withLet = lintTurn({ prior, text: turn });
  assert.ok(!withLet.problems.some((x) => /M|算不了|不满足/.test(x.msg)), JSON.stringify(withLet.problems));
  const without = lintTurn({ prior: [], text: turn });
  assert.ok(without.problems.some((x) => /p1/.test(x.msg)), JSON.stringify(without.problems));
});

test('小 11：复测从题库出题时带着当时课上的量（存题库时抄下题里用到的那几个）', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', con('p1', { retry: ['p1a', 'p1b'], extra: 'if: A*M != M*A => 和 M 可交换了\n' }), con('p1a'), con('p1b')].join('\n'));
  assert.deepEqual(selfCheck(check, { M: [[1, 2], [3, 4]] }), []);
  const docs = bankDocs(check, { session: 'c-1', base: { M: [[1, 2], [3, 4]], N: [[9]] } });
  const p1 = docs.find((d) => d.doc.from.as === 'probe');
  assert.deepEqual(p1.doc.lets, { M: '[[1,2],[3,4]]' });
  const bank = docs.map((d) => ({ id: d.id, ...d.doc }));
  const r = retestCheck({ items: [p1.id], bank, retests: [{ block: 'L2.1.1', days: 1 }] });
  assert.deepEqual(r.dropped, []);
  const rc = attachBases(parseCheck(r.head, r.body).check, r.bases);
  assert.deepEqual(selfCheck(rc, {}, { lenient: true }), []);
  assert.deepEqual(rc.probes.r1.base, { M: [[1, 2], [3, 4]] }); // 这道题自己带着（不是写成 let：pick 之前就要有）
});
