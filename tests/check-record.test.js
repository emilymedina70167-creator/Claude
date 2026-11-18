// 检验：证据、吸收、meta/state 那一行、掌握参考用的题、ext_out 的字、记错题（kit/src/check/record.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck } from '../kit/src/check/spec.js';
import { createFlow, step, absorbOf } from '../kit/src/check/flow.js';
import { bankId, fenceOf } from '../kit/src/check/bank.js';
import { evidenceOf, toRecord, absorbDoc, stateLine, checkItems, checkLine, extStart, extSummary, errorEntries, answerSummary } from '../kit/src/check/record.js';

const F = '```';
const con = (id, { retry = [], target = 'L2-14' } = {}) => `${F}construct\nid: ${id}\nq: 造 ${id}\ntarget: ${target}\nlevel: 基础\nslots: A=mat(2)\nif: A != O => 零矩阵不算\nexample: A=[[1,0],[0,0]]\nteach if1: 不要零矩阵。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const rec = (id, { retry = [] } = {}) => `${F}recall\nid: ${id}\nq: 写 ${id}\ntarget: L2-56\nlevel: 核心\nmust m1: 要点\nteach default: 先乘开。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const { check } = parseCheck('check id=k1 title="第二讲 检验" limit=15m', [
  'block L2.1.1 must=p1,p2', 'block L2.1.4 must=p3',
  con('p1', { retry: ['p1a', 'p1b'] }), con('p1a'), con('p1b'),
  con('p2', { retry: ['p2a', 'p2b'] }), con('p2a'), con('p2b'),
  rec('p3', { retry: ['p3a', 'p3b'] }), rec('p3a'), rec('p3b'),
].join('\n'));
const OK = { items: [{ id: 'if1', ok: true }], needsClaude: false, stop: false };
const BAD = { items: [{ id: 'if1', ok: false, why: '零矩阵不算' }], needsClaude: false, stop: false };
let t = 1795000000000;
const go = (s, ev) => step(s, { at: (t += 60000), ...ev });
const sub = (s, id, m, sure = 'sure') => go(s, { type: 'submit', id, answer: { slots: { A: [[0, 0], [0, 0]] } }, sure, ms: 80000, machine: m });

// p1：先错、补上；p2：很确定却错了、retry 全错；p3：一次过
function played() {
  let s = go(createFlow(check), { type: 'start' });
  s = sub(s, 'p1', BAD, 'maybe'); s = go(s, { type: 'teachSeen', id: 'p1' }); s = sub(s, 'p1a', OK);
  s = sub(s, 'p2', BAD, 'sure'); s = go(s, { type: 'teachSeen', id: 'p2' });
  s = sub(s, 'p2a', BAD); s = go(s, { type: 'teachSeen', id: 'p2a' });
  s = sub(s, 'p2b', BAD); s = go(s, { type: 'teachSeen', id: 'p2b' });
  s = go(s, { type: 'submit', id: 'p3', answer: { text: '(A+B)^2=A^2+AB+BA+B^2' }, sure: 'sure', ms: 30000, machine: { items: [], needsClaude: true, stop: false } });
  s = go(s, { type: 'verdict', id: 'p3', items: [{ id: 'm1', ok: true }], judgedBy: 'claude' });
  return s;
}
const ctx = { session: 'c-20261118-1', turn: 4 };

test('evidenceOf：字段齐', () => {
  const s = played();
  const ev = evidenceOf(s, 'p1', { ctx });
  for (const k of ['src', 'kind', 'check', 'probe', 'target', 'level', 'facet', 'items', 'outcome', 'final', 'sure', 'ms', 'msTotal', 'judgedBy', 'first', 'comp', 'session', 'block', 'tags', 'at']) assert.ok(k in ev, k);
  assert.match(ev.id, /^ev-ck-/);
  assert.equal(ev.src, 'check');
  assert.equal(ev.kind, 'construct');
  assert.equal(ev.comp, 'k1:p1');
  assert.equal(ev.outcome, 'fail');
  assert.equal(ev.final, 'fixed');
  assert.deepEqual(ev.tags, ['L2.1.1']);
  assert.equal(ev.turn, 4);
  assert.equal(ev.teach, 'if1');
  const r = evidenceOf(s, 'p1a', { ctx });
  assert.equal(r.retryOf, 'p1');
  // 复测：带 bank
  assert.equal(evidenceOf(s, 'p1', { ctx, bankOf: { p1: 'pr-aaaaaaaaaaaa' }, retest: 1 }).bank, 'pr-aaaaaaaaaaaa');
});

test('toRecord：本题定下来了、retry 判了才记；记过的不再记', () => {
  const s = played();
  assert.deepEqual(toRecord(s).sort(), ['p1', 'p1a', 'p2', 'p2a', 'p2b', 'p3'].sort());
  const s2 = step(s, { type: 'recorded', ids: ['p1', 'p1a'] });
  assert.deepEqual(toRecord(s2).sort(), ['p2', 'p2a', 'p2b', 'p3'].sort());
});

test('absorbDoc：第一次、第二次（旧的进 history、log 记变化）、history 最多 5 次', () => {
  const s = played();
  const res = absorbOf(s, 'L2.1.1');
  const d1 = absorbDoc(null, res, { check, session: 'c-1', space: 'math', at: 1, today: '2026-11-18', families: ['L2.1.1/L2-14'], owed: [], evidence: ['ev-1'] });
  assert.equal(d1.state, '未');
  assert.equal(d1.checked, false);
  assert.equal(d1.by, 'page');
  assert.equal(d1.date, '2026-11-18');
  assert.deepEqual(d1.retests.map((x) => x.due), ['2026-11-19', '2026-11-25']);
  assert.equal(d1.log.length, 1);
  assert.deepEqual(d1.history, []);
  const d2 = absorbDoc(d1, { ...res, state: '部分' }, { check, session: 'c-2', space: 'math', at: 2, today: '2026-11-20', families: [], owed: ['p1a'], evidence: [] });
  assert.equal(d2.history.length, 1);
  assert.equal(d2.history[0].state, '未');
  assert.equal(d2.log.length, 2);
  assert.deepEqual(d2.retryOwed, [bankId(fenceOf(check.probes.p1a))]);
  let d = d2;
  for (let i = 0; i < 6; i++) d = absorbDoc(d, res, { check, session: `c-${i}`, space: 'math', at: 3 + i, today: '2026-11-21', families: [], owed: [], evidence: [] });
  assert.equal(d.history.length, 5);
});

test('stateLine', () => {
  const doc = { state: '部分', checked: false, date: '2026-11-18', facets: { 重建: 'ok', 能用: 'fixed', 边界: 'fail' }, retests: [{ days: 1, due: '2026-11-19', done: null }, { days: 7, due: '2026-11-25', done: null }] };
  assert.equal(stateLine(doc), '吸收：部分（页面判，待主讲核）· 11-18 · 重建 ✓ 能用 补上 边界 ✗ · 复测 11-19、11-25');
  assert.equal(stateLine({ ...doc, checked: true }), '吸收：部分（主讲核过）· 11-18 · 重建 ✓ 能用 补上 边界 ✗ · 复测 11-19、11-25');
  const done = { ...doc, retests: [{ days: 1, due: '2026-11-19', done: '2026-11-19', ok: true }, { days: 7, due: '2026-11-25', done: '2026-11-25', ok: true }] };
  assert.equal(stateLine(done), '吸收：部分（页面判，待主讲核）· 11-18 · 重建 ✓ 能用 补上 边界 ✗ · 复测 11-19 ✓、11-25 ✓（7 天复测过了，进不进复现由外部定）');
});

test('checkItems：不要 retry、不要改判那条；蒙的当没把握', () => {
  const s = played();
  const evs = ['p1', 'p1a', 'p2', 'p3'].map((id) => evidenceOf(s, id, { ctx }));
  evs.push({ ...evidenceOf(s, 'p3', { ctx }), sure: 'guess', comp: 'k1:p9' });
  const items = checkItems(evs);
  assert.deepEqual(items.map((x) => x.outcome), ['wrong', 'wrong', 'first', 'first']);
  assert.equal(items[3].sure, false);
  assert.equal(items[2].sure, true);
  assert.deepEqual(items[0].tags, ['L2.1.1']);
  assert.ok(items.every((x) => x.key && x.session === 'c-20261118-1'));
});

test('checkLine', () => {
  const s = played();
  const line = checkLine(evidenceOf(s, 'p1', { ctx }));
  assert.match(line, /^检验 k1 · construct p1（L2\.1\.1，打 L2-14）/);
  assert.match(line, /第一次没过 → 补上/);
  assert.match(line, /if1 不满足：零矩阵不算/);
  assert.match(line, /补讲 if1/);
  assert.match(line, /大概/);
  assert.match(line, /1 分 20 秒/);
  assert.match(checkLine(evidenceOf(s, 'p1a', { ctx })), /retry p1a（p1 的同构题）对/);
});

test('extStart、extSummary', () => {
  assert.equal(extStart(check), '[页面] 检验 k1「第二讲 检验」开始（2 块、3 道必做、限时 15 分钟）');
  const s = played();
  const absorbs = { 'L2.1.1': absorbOf(s, 'L2.1.1'), 'L2.1.4': absorbOf(s, 'L2.1.4') };
  const text = extSummary(s, check, absorbs);
  assert.match(text, /L2\.1\.1：吸收 未（页面判，待主讲核）/);
  assert.match(text, /L2\.1\.4：吸收 成功/);
  assert.match(text, /p2.*很确定却错了/);
});

test('errorEntries：最后没过的、很确定却错了的各一条；补上的、待核的不记；同一个 target 一道', () => {
  const s = played();
  const evidence = { p1: 'ev-1', p2: 'ev-2', p3: 'ev-3' };
  const es = errorEntries(s, check, { evidence });
  // p2 最后没过（也是很确定却错了）；p1 补上了、信心是大概 → 不记；p3 过了
  assert.equal(es.length, 1);
  assert.equal(es[0].kind, 'error');
  assert.equal(es[0].attrs.probe, 'p2');
  assert.equal(es[0].attrs.check, 'k1');
  assert.equal(es[0].attrs.target, 'L2-14');
  assert.equal(es[0].attrs.cause, 'L2-14');
  assert.deepEqual(es[0].attrs.basis, ['ev-2']);
  assert.equal(es[0].attrs.mine, answerSummary(check.probes.p2, s.results.p2.answer, s.results.p2));
  assert.equal(es[0].attrs.mine, evidenceOf(s, 'p2', { ctx }).first);
  assert.match(es[0].attrs.step, /if1 不满足：零矩阵不算/);
  assert.equal(es[0].attrs.block, 'L2.1.1');
  // p1 很确定却错了、后来补上 → 记一条；p2 同一个 target → 只留第一道
  let s2 = go(createFlow(check), { type: 'start' });
  s2 = sub(s2, 'p1', BAD, 'sure'); s2 = go(s2, { type: 'teachSeen', id: 'p1' }); s2 = sub(s2, 'p1a', OK);
  s2 = sub(s2, 'p2', BAD, 'sure'); s2 = go(s2, { type: 'teachSeen', id: 'p2' }); s2 = sub(s2, 'p2a', BAD); s2 = go(s2, { type: 'teachSeen', id: 'p2a' }); s2 = sub(s2, 'p2b', BAD); s2 = go(s2, { type: 'teachSeen', id: 'p2b' });
  const es2 = errorEntries(s2, check, { evidence });
  assert.equal(es2.length, 1);
  assert.equal(es2[0].attrs.probe, 'p1');
  // 待核的不记
  let s3 = go(createFlow(check), { type: 'start' });
  s3 = sub(s3, 'p1', OK); s3 = sub(s3, 'p2', OK);
  s3 = go(s3, { type: 'submit', id: 'p3', answer: { text: '…' }, sure: 'sure', ms: 1, machine: { items: [], needsClaude: true, stop: false } });
  s3 = go(s3, { type: 'timeout', id: 'p3' });
  assert.deepEqual(errorEntries(s3, check, { evidence }), []);
});
