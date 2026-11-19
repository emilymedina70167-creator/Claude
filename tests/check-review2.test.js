// 2026-11-19 这一批（小毛病 + retry 模板）的整体审查查出来的几处（一处一条，先红后绿）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, parseProbe, selfCheck } from '../kit/src/check/spec.js';
import { materialize } from '../kit/src/check/template.js';
import { createFlow, step } from '../kit/src/check/flow.js';
import { toRecord, absorbStale } from '../kit/src/check/record.js';
import { bankDocs, retestCheck, attachBases } from '../kit/src/check/bank.js';
import { saveInk, hasInk, sweepInk, INK_PREFIX } from '../kit/src/check/inkstore.js';

const F = '```';
const rec = (id, retry = []) => `${F}recall\nid: ${id}\nq: 写 ${id}\ntarget: T-${id}\nlevel: 核心\nmust m1: 要点\nteach default: 先乘开。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const tpl = (id, { retry = [], pick = 'pick k = int(2, 5)', extra = '' } = {}) => `${F}construct\nid: ${id}\n${pick}\n${extra}q: 造 $A^2 = \\calc{k}A$\ntarget: L2-14\nlevel: 基础\nslots: A=mat(2)\nif: A*A == k*A => 不对\nif: A != O => 零矩阵不算\nexample: A=[[k,0],[0,0]]\nteach if1: 看每一列。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const OK = { items: [{ id: 'm1', ok: true }], needsClaude: false, stop: false };
const BAD = { items: [{ id: 'm1', ok: false, why: '没写到' }], needsClaude: false, stop: false };
const seq = (xs) => { let i = 0; return () => xs[Math.min(i++, xs.length - 1)]; };
const chain = () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', rec('p1', ['p1a', 'p1b']), rec('p1a'), rec('p1b')].join('\n'));
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: BAD, at: 2 });
  s = step(s, { type: 'teachSeen', id: 'p1', at: 3 });
  s = step(s, { type: 'submit', id: 'p1a', answer: { text: 'x' }, sure: 'sure', ms: 1, machine: BAD, at: 4 });
  return s; // 在补讲 p1a，p1b 还没出
};

test('审 1：retry 链还在走的时候外部改判中间那道没过：本题不提前定成没过、不写证据、p1b 不进欠着的', () => {
  let s = chain();
  s = step(s, { type: 'ext', id: 'p1a', items: [{ id: 'm1', ok: false }], result: 'fail', at: 5 });
  assert.equal(s.results.p1.final, undefined);
  assert.ok(!toRecord(s).includes('p1'));
  assert.deepEqual(s.owed, []);
  s = step(s, { type: 'teachSeen', id: 'p1a', at: 6 });
  s = step(s, { type: 'submit', id: 'p1b', answer: { text: 'y' }, sure: 'sure', ms: 1, machine: OK, at: 7 });
  assert.equal(s.results.p1.final, 'fixed');
});

test('审 1：链还在走时外部把中间那道改判成对，后面那道又错：本题照外部的算补上', () => {
  let s = chain();
  s = step(s, { type: 'ext', id: 'p1a', items: [{ id: 'm1', ok: true }], result: 'pass', at: 5 });
  assert.equal(s.results.p1.final, undefined);
  s = step(s, { type: 'teachSeen', id: 'p1a', at: 6 });
  s = step(s, { type: 'submit', id: 'p1b', answer: { text: 'y' }, sure: 'sure', ms: 1, machine: BAD, at: 7 });
  assert.equal(s.results.p1.final, 'fixed');
});

test('审 1：链还在走时外部改判本题没过（和页面判的一样）：不提前定、不提前欠着 retry', () => {
  let s = chain();
  s = step(s, { type: 'ext', id: 'p1', items: [{ id: 'm1', ok: false }], result: 'fail', at: 5 });
  assert.equal(s.results.p1.final, undefined);
  assert.deepEqual(s.owed, []);
  s = step(s, { type: 'teachSeen', id: 'p1a', at: 6 });
  s = step(s, { type: 'submit', id: 'p1b', answer: { text: 'y' }, sure: 'sure', ms: 1, machine: OK, at: 7 });
  assert.equal(s.results.p1.final, 'fixed');
});

test('审 2：外部自己写了 p1~2 这样的 id：模板的局部 id 让开，不覆盖', () => {
  const own = rec('p1~2').replace('recall', 'construct').replace(/must m1: 要点\n/, 'slots: A=mat(2)\nif: A != O => 零矩阵不算\nexample: A=[[1,0],[0,0]]\n');
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1,p9', tpl('p1', { retry: ['p1', 'p1'] }), tpl('p9', { retry: ['p1~2', 'p1~2'] }).replace('pick k = int(2, 5)\n', 'let k = 3\n'), own].join('\n'));
  const mc = materialize(check, { rand: seq([0.1, 0.6, 0.9]) }).check;
  assert.equal(mc.probes['p1~2'].q, check.probes['p1~2'].q); // 外部写的那道原样
  assert.ok(!mc.probes.p1.retry.includes('p1~2'), JSON.stringify(mc.probes.p1.retry));
  assert.equal(new Set(mc.order).size, mc.order.length);
});

test('审 3：复测带的课上的量不盖掉 pick 的名字；pick 的范围用课上的量也取得出来', () => {
  // (a) 课上也有 k：不抄成 let k（不然复测永远是课上那个数）
  const a = parseCheck('check id=k1', ['block L2.1.1 must=p1', tpl('p1', { retry: ['p1', 'p1'] })].join('\n')).check;
  assert.equal(bankDocs(a, { base: { k: 3 } })[0].doc.lets, undefined);
  // (b) pick k = int(2, n)，n 是课上的量
  const b = parseCheck('check id=k1', ['block L2.1.1 must=p1', tpl('p1', { retry: ['p1', 'p1'], pick: 'pick k = int(2, n)' })].join('\n')).check;
  assert.deepEqual(selfCheck(b, { n: 5 }), []);
  const docs = bankDocs(b, { base: { n: 5 } });
  assert.deepEqual(docs[0].doc.lets, { n: '5' });
  const bank = docs.map((d) => ({ id: d.id, ...d.doc }));
  const r = retestCheck({ items: [docs[0].id], bank, retests: [{ block: 'L2.1.1', days: 1 }] });
  assert.deepEqual(r.dropped, []);
  const rc = attachBases(parseCheck(r.head, r.body).check, r.bases);
  assert.deepEqual(rc.probes.r1.base, { n: 5 });
  assert.deepEqual(selfCheck(rc, {}, { lenient: true }), []);
  const m = materialize(rc, { rand: seq([0.99, 0.1, 0.5]) });
  assert.deepEqual(m.errors, []);
  assert.equal(m.check.probes.r1.vals.k, 5);
});

test('审 4：上一版存的、没有 wall 的手写不当过期清掉（补上时间，从现在算 7 天）', () => {
  const m = new Map();
  const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  const key = `${INK_PREFIX}c-1-k1-p1`;
  st.setItem(key, JSON.stringify({ strokes: [{ pts: [1, 2, 3] }], events: [], at: 5, h: 420 }));
  sweepInk(st, 10 * 86400000);
  assert.equal(hasInk(st, key), true);
  sweepInk(st, 18 * 86400000);
  assert.equal(hasInk(st, key), false);
  saveInk(st, key, { strokes: [] });
});

test('审 5：要点、题面续行里以 Where / pick 开头的英文不当成模板的命令', () => {
  const head = 'id: q\ntarget: x\nlevel: 核心\nmust m1: 一\n';
  const r = parseProbe('recall', `${head}q: 翻译下面这句\nWhere did you go yesterday?`);
  assert.equal(r.error, undefined);
  assert.match(r.probe.q, /Where did you go/);
  assert.equal(r.probe.tpl, null);
  const r2 = parseProbe('recall', `${head}q: 译\nwhere the river meets the sea`);
  assert.equal(r2.error, undefined);
  // 真的命令照认
  const r3 = parseProbe('recall', `${head}q: 写 $\\calc{k}$\npick k = int(1, 3)\nwhere k != 2`);
  assert.equal(r3.error, undefined);
  assert.equal(r3.probe.tpl.wheres.length, 1);
});

test('审 6：同一个模板的几次（课上、复测里拆成几道的）都不取一样的数', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', tpl('p1', { retry: ['p1', 'p1'] })].join('\n'));
  // 课上：p1、p1~2、p1~3 两两不同（以前只躲上一次）
  const mc = materialize(check, { rand: seq([0.1, 0.6, 0.1, 0.1, 0.9]) }).check;
  const picks = mc.order.map((id) => mc.probes[id].picked);
  assert.equal(new Set(picks).size, 3, picks.join(' '));
  // 复测：r1、r1a、r1b 是三道（同一份原文）
  const docs = bankDocs(check, {});
  const bank = docs.map((d) => ({ id: d.id, ...d.doc }));
  const r = retestCheck({ items: [docs[0].id], bank, retests: [{ block: 'L2.1.1', days: 1 }] });
  const rc = parseCheck(r.head, r.body).check;
  const m2 = materialize(rc, { rand: seq([0.1, 0.1, 0.1, 0.6, 0.6, 0.9]) }).check;
  const p2 = m2.order.map((id) => m2.probes[id].picked);
  assert.equal(new Set(p2).size, 3, p2.join(' '));
});

test('审 7：补写以前做完的检验时，那一块已经有更新的检验写的吸收：不盖回去', () => {
  assert.equal(absorbStale({ check: 'k2', session: 'c-2', at: 500 }, { check: 'k1', session: 'c-1', endedAt: 100 }), true);
  assert.equal(absorbStale({ check: 'k0', session: 'c-0', at: 50 }, { check: 'k1', session: 'c-1', endedAt: 100 }), false);
  assert.equal(absorbStale({ check: 'k1', session: 'c-1', at: 500 }, { check: 'k1', session: 'c-1', endedAt: 100 }), false);
  assert.equal(absorbStale(null, { check: 'k1', session: 'c-1', endedAt: 100 }), false);
});

test('审 8：模板的自检按检验 id 和题 id 取数：预检和页面开检验时结论一样', () => {
  // 只有 k=2 时 example 才满足：有的几组数取不到 2 就过、取到别的就不过——不能一次过一次不过
  const src = ['block L2.1.1 must=p1', tpl('p1', { retry: ['p1', 'p1'], pick: 'pick k = int(2, 9)' }).replace('example: A=[[k,0],[0,0]]', 'example: A=[[2,0],[0,0]]')].join('\n');
  const runs = Array.from({ length: 6 }, () => selfCheck(parseCheck('check id=k1', src).check).join('|'));
  assert.equal(new Set(runs).size, 1, runs.join('\n'));
});
