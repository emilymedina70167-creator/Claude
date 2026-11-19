// 检验：复测退回换数的模板（rule-rev-2）、证据 / 吸收 / meta/state 里的 renumbered、新题型的作答写成字
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck } from '../kit/src/check/spec.js';
import { createFlow, step } from '../kit/src/check/flow.js';
import { bankDocs, pickRetest, retestCheck } from '../kit/src/check/bank.js';
import { evidenceOf, stateLine, checkItems, answerSummary, errorEntries } from '../kit/src/check/record.js';
import { isOriginal, cleanItem } from '../kit/src/memory/mastery.js';

const F = '```';
const tplFence = (id, extra = '') => `${F}construct\nid: ${id}\npick k = int(2, 5)\nq: 造 $A$，$A^2=\\calc{k}A$ ${extra}\ntarget: L2-14\nlevel: 基础\nslots: A=mat(2)\nif: A*A == k*A => 不对\nexample: A=[[k,0],[0,0]]\nteach if1: 想一想。\n${F}`;
const fixFence = (id) => `${F}recall\nid: ${id}\nq: 写 ${id}\ntarget: L2-56\nlevel: 核心\nmust m1: 要点\nteach default: 先乘开。\n${F}`;
const mk = (body, tag = 'k1') => {
  const { check, errors } = parseCheck(`check id=${tag}`, body);
  assert.deepEqual(errors, []);
  return check;
};
const asBank = (docs) => docs.map(({ id, doc }) => ({ id, ...doc }));
const due = [{ block: 'L2.1.4', days: 1, due: '2026-11-19' }];

test('pickRetest：同类只剩见过的模板 → 退回它、记 renumbered，缺新题照记', () => {
  const check = mk(['block L2.1.4 must=p1', tplFence('p1')].join('\n'));
  const bank = asBank(bankDocs(check, { session: 'c-1', at: 1 }));
  bank[0].seen = [{ at: 1 }];
  const absorbs = [{ block: 'L2.1.4', check: 'k1', session: 'c-1', families: [bank[0].family], retryOwed: [] }];
  const r = pickRetest({ due, bank, absorbs });
  assert.deepEqual(r.items, [bank[0].id]);
  assert.deepEqual(r.renumbered, [bank[0].id]);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].why, '只剩换数的模板');
  // 固定题见过了：照旧缺新题、不退回
  const fixed = asBank(bankDocs(mk(['block L2.1.4 must=p1', fixFence('p1')].join('\n'), 'k2'), { session: 'c-2', at: 1 }));
  fixed[0].seen = [{ at: 1 }];
  const r2 = pickRetest({ due, bank: fixed, absorbs: [{ ...absorbs[0], families: [fixed[0].family] }] });
  assert.deepEqual(r2.items, []);
  assert.deepEqual(r2.renumbered, []);
  assert.equal(r2.missing[0].why, '题库里没有没见过的同类题');
  // 有没见过的固定题：优先它，不退回模板
  const mixed = [...bank, { ...fixed[0], family: bank[0].family, seen: [] }];
  const r3 = pickRetest({ due, bank: mixed, absorbs });
  assert.deepEqual(r3.items, [mixed[1].id]);
  assert.deepEqual(r3.renumbered, []);
  assert.deepEqual(r3.missing, []);
  // broken 的不挑
  bank[0].broken = true;
  assert.deepEqual(pickRetest({ due, bank, absorbs }).items, []);
});

test('证据和 checkItems 带 renumbered；isOriginal 认它，掌握不拿它升', () => {
  const check = mk(['block L2.1.4 must=p1', tplFence('p1')].join('\n'));
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: { slots: { A: [[2, 0], [0, 0]] } }, sure: 'sure', ms: 1000, at: 2, machine: { items: [{ id: 'if1', ok: true }], needsClaude: false, stop: false } });
  const ev = evidenceOf(s, 'p1', { ctx: { session: 'c-3' }, renumbered: true, retest: 1 });
  assert.equal(ev.renumbered, true);
  assert.equal(evidenceOf(s, 'p1', { ctx: { session: 'c-3' } }).renumbered, undefined);
  const items = checkItems([ev]);
  assert.equal(items[0].renumbered, true);
  assert.equal(isOriginal(items[0]), true);
  assert.equal(cleanItem(items[0]), false);
  assert.equal(isOriginal({ comp: 'k1:p1' }), false);
});

test('stateLine：有一次复测用了换数的题就写一句', () => {
  const a = { state: '成功', checked: false, date: '2026-11-19', facets: {}, retests: [{ days: 1, due: '2026-11-20', done: '2026-11-20', ok: true, renumbered: true }, { days: 7, due: '2026-11-26', done: null }] };
  assert.match(stateLine(a), /复测用的是换了数的同一道题/);
  a.retests[0].renumbered = false;
  assert.doesNotMatch(stateLine(a), /换了数/);
});

test('retestCheck 能拼出退回的模板题（bankOf 对得上题库编号）', () => {
  const check = mk(['block L2.1.4 must=p1', tplFence('p1')].join('\n'));
  const bank = asBank(bankDocs(check, { session: 'c-1', at: 1 }));
  const r = retestCheck({ id: 'rt', items: [bank[0].id], bank, retests: due });
  assert.deepEqual(r.dropped, []);
  assert.equal(r.bankOf.r1, bank[0].id);
});

// ——作答写成字
const P = (type, extra) => ({ type, ...extra });
test('answerSummary：新题型的作答都写成读得懂的字', () => {
  const trace = P('trace', { use: 'sort', fields: { algo: 'shell', array: '49 38 65 97 76 13 27 49', gaps: '4 2 1' }, fill: { rows: { from: 1, to: 2 } }, against: [] });
  const t = answerSummary(trace, { cells: [[], [] ] });
  assert.equal(typeof t, 'string');
  const pr = P('predict', { expects: [{ id: 'x1', label: '缺页次数' }, { id: 'x2', label: '缺页率' }] });
  assert.equal(answerSummary(pr, { expects: { x1: '10', x2: '0.5' } }), '缺页次数：10；缺页率：0.5');
  assert.match(answerSummary(P('code', {}), { code: 'int f(){'.padEnd(500, 'x') }), /^int f\(\)\{x+…?$/);
  assert.ok(answerSummary(P('code', {}), { code: 'x'.repeat(500) }).length <= 301);
  const parse = P('parse', { tokens: [{ w: 'They' }, { w: 'were' }, { w: 'surrounded' }] });
  assert.match(answerSummary(parse, { spans: [{ role: 'S', from: 0, to: 0 }, { role: 'V', from: 1, to: 2 }] }), /\[S They\] \[V were surrounded\]/);
  const ef = P('errfind', { text: 'He go to school .', options: undefined });
  assert.match(answerSummary(ef, { word: 1, fix: 'goes' }), /点了 go，改成 goes/);
  const dis = P('discriminate', { options: ['谓语', '非谓语'] });
  assert.equal(answerSummary(dis, { pick: '非谓语', text: '因为前面有 and' }), '非谓语；因为前面有 and');
  assert.equal(answerSummary(P('discriminate', {}), { can: true }), '能用');
  assert.equal(answerSummary(P('rewrite', {}), { text: 'He goes.' }), 'He goes.');
  assert.equal(answerSummary(P('calc', {}), { text: '算了', result: '12' }), '算了；结果：12');
  assert.equal(answerSummary(P('construct', {}), { slots: { S: 'a b', T: 'x' } }), 'S=a b T=x');
});

test('trace：写错的那一行进 first；错题本 mine 和证据 first 一字不差；通过的串联行不算失败项', () => {
  const body = ['block L2.1.4 must=p1', `${F}trace\nid: p1\nuse: sort\nalgo: shell\narray: 49 38 65 97 76 13 27 49\ngaps: 4 2 1\nq: 填表\ntarget: DS-sort\nlevel: 基础\nrows: 2\n${F}`].join('\n');
  const check = mk(body);
  let s = step(createFlow(check), { type: 'start', at: 1 });
  const machine = { items: [{ id: 'r1', ok: false, why: '第 1 趟不对' }, { id: 'r2', ok: true, carried: true, why: '' }], needsClaude: false, stop: true };
  s = step(s, { type: 'submit', id: 'p1', answer: { cells: [[], []] }, sure: 'sure', ms: 1000, at: 2, machine, giveup: false });
  const ev = evidenceOf(s, 'p1', { ctx: { session: 'c-4' } });
  assert.equal(typeof ev.first, 'string');
  const s2 = { ...s, results: { ...s.results, p1: { ...s.results.p1, final: 'fail', outcome: 'fail' } } };
  const es = errorEntries(s2, check, { evidence: { p1: ev.id } });
  if (es.length) {
    assert.equal(es[0].attrs.mine, ev.first);
    assert.doesNotMatch(es[0].attrs.step, /r2/);
  }
});

test('errfind 没点词也写了改法；predict 全没填不留空段', () => {
  const ef = P('errfind', { text: 'He go to school .' });
  assert.equal(answerSummary(ef, { word: 99, fix: 'goes' }), '没点词，改成 goes');
  const pr = P('predict', { expects: [] });
  assert.equal(answerSummary(pr, { expects: {}, text: '想想' }), '想想');
});

test('掌握：换了数的复测通过不算新题通过，同样的证据不带 renumbered 就算', async () => {
  const { masteryProposals } = await import('../kit/src/memory/mastery.js');
  const ev = (n, extra = {}) => ({ id: `ev-ck-${n}`, src: 'check', kind: 'recall', comp: `k1:p${n}`, session: 'c-9', block: 'L2.1.4', tags: ['L2.1.4'], outcome: 'pass', final: 'pass', sure: 'sure', bank: `pr-${n}`, at: 1000 + n, ...extra });
  const mem = (r) => ({ curriculum: [{ id: 'L2.1.4', level: 'block' }], mastery: [], evidence: [ev(1, r), ev(2, r)], sessions: [] });
  const plain = masteryProposals(mem({}));
  const ren = masteryProposals(mem({ renumbered: true }));
  assert.ok(plain.length > 0, '没 renumbered 的有提议');
  assert.equal(ren.filter((p) => (p.patch || p.data || {}).state === '基础题过').length, 0);
});
