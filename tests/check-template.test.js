// 检验的 retry 写成模板（外部 review 的可选那条：复用 practice custom 的 pick / where，一道写成模板，每次用都取新数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, parseProbe, selfCheck, drawProbe } from '../kit/src/check/spec.js';
import { materialize } from '../kit/src/check/template.js';
import { judgeMachine } from '../kit/src/check/judge.js';
import { createFlow, step, view } from '../kit/src/check/flow.js';
import { evidenceOf, extSummary } from '../kit/src/check/record.js';
import { bankDocs, bankId, fenceOf, retestCheck } from '../kit/src/check/bank.js';

const F = '```';
// 构造：A^2 = kA，A 不是 kE、不是 O；k 每次取新的
const tpl = (id, { retry = [], extra = '' } = {}) => `${F}construct
id: ${id}
pick k = int(2, 5)
q: 造一个 2 阶矩阵 $A$，使 $A^2 = \\calc{k}A$，而且 $A \\ne \\calc{k}E$、$A \\ne O$
target: L2-14
level: 基础
slots: A=mat(2)
if: A*A == k*A => $A^2$ 不等于 \\calc{k}$A$
if: A != k*E => 写成了 $\\calc{k}E$
if: A != O => 零矩阵不算
example: A=[[k,0],[0,0]]
${extra}teach if1: 先想 $A$ 的列满足什么。
${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const seq = (xs) => { let i = 0; return () => xs[i++ % xs.length]; };
const BAD = { items: [{ id: 'if1', ok: false, why: '不对' }], needsClaude: false, stop: false };

test('读：pick / where 认成模板；example 等取了数再算；只有 where 没有 pick 报错', () => {
  const r = parseProbe('construct', tpl('t1').split('\n').slice(1, -1).join('\n'));
  assert.equal(r.error, undefined);
  assert.equal(r.probe.tpl.picks[0].name, 'k');
  assert.equal(r.probe.example, null);
  assert.match(r.probe.exampleSrc, /k/);
  const bad = parseProbe('recall', 'id: q\nq: 写\ntarget: x\nlevel: 核心\nmust: 一\nwhere k > 1');
  assert.match(bad.error, /where.*pick/);
});

test('取一组数：题面的 \\calc 换成数、example 照取到的算、判分用取到的数', () => {
  const p = parseProbe('construct', tpl('t1').split('\n').slice(1, -1).join('\n')).probe;
  const { probe: inst, picked } = drawProbe(p, { rand: seq([0.99]) }); // int(2,5) 取到 5
  assert.equal(picked, 'k=5');
  assert.match(inst.q, /A\^2 = \{5\}A/); // 公式里的加 {}（和 practice 一样）
  assert.match(inst.ifs[0].msg, /不等于 5\$A\$/); // 公式外面的不加
  assert.ok(!inst.q.includes('\\calc'));
  assert.deepEqual(inst.example.A, [[5, 0], [0, 0]]);
  assert.equal(inst.vals.k, 5);
  assert.match(inst.ifs[0].msg, /5/);
  const ok = judgeMachine(inst, { slots: { A: [['5', '0'], ['0', '0']] } });
  assert.ok(ok.items.every((x) => x.ok === true), JSON.stringify(ok.items));
  const no = judgeMachine(inst, { slots: { A: [['2', '0'], ['0', '0']] } });
  assert.equal(no.items[0].ok, false);
  // 题库认的还是模板那一道（见过一次就算见过：换数不算新题，rule-rev-2）
  assert.equal(bankId(fenceOf(inst)), bankId(fenceOf(p)));
});

test('retry 写模板自己两次：每次用都另取一组数，局部 id p1~2、p1~3；照常走补讲、retry', () => {
  const { check, errors } = parseCheck('check id=k1', ['block L2.1.1 must=p1', tpl('p1', { retry: ['p1', 'p1'] })].join('\n'));
  assert.deepEqual(errors, []);
  assert.deepEqual(selfCheck(check), []);
  const m = materialize(check, { rand: seq([0.1, 0.6, 0.9, 0.3]) });
  assert.deepEqual(m.errors, []);
  const mc = m.check;
  assert.deepEqual(mc.probes.p1.retry, ['p1~2', 'p1~3']);
  assert.deepEqual(mc.order, ['p1', 'p1~2', 'p1~3']);
  assert.notEqual(mc.probes.p1.picked, mc.probes['p1~2'].picked);
  assert.notEqual(mc.probes['p1~2'].picked, mc.probes['p1~3'].picked);
  assert.deepEqual(mc.probes['p1~2'].retry, []);
  assert.deepEqual(selfCheck(mc), []);
  let s = step(createFlow(mc), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p1', answer: {}, sure: 'sure', ms: 1, machine: BAD, at: 2 });
  s = step(s, { type: 'teachSeen', id: 'p1', at: 3 });
  assert.equal(view(s).id, 'p1~2');
  const ev = evidenceOf(s, 'p1', { ctx: { session: 'c-1' } });
  assert.equal(ev.picked, mc.probes.p1.picked);
  assert.equal(ev.template, 'p1');
  assert.match(extSummary(s, mc, {}), new RegExp(`取 ${mc.probes.p1.picked}`));
});

test('别的题的 retry 写同一个模板两次；模板只当 retry 用', () => {
  const plain = `${F}recall\nid: p2\nq: 写\ntarget: T-1\nlevel: 核心\nmust m1: 要点\nteach default: 先乘开。\nretry: t1, t1\n${F}`;
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p2', plain, tpl('t1').replace('construct', 'recall').replace(/slots[\s\S]*?example: .*\n/, 'must m1: 要点\n')].join('\n'));
  assert.deepEqual(selfCheck(check), []);
  const mc = materialize(check, { rand: seq([0.1, 0.9]) }).check;
  assert.deepEqual(mc.probes.p2.retry, ['t1', 't1~2']);
  assert.notEqual(mc.probes.t1.picked, mc.probes['t1~2'].picked);
});

test('自检：不是模板的题在 retry 里写两次、where 太严、某一组数下 example 不满足，都报', () => {
  const rec = (id, retry) => `${F}recall\nid: ${id}\nq: 写\ntarget: T-${id}\nlevel: 核心\nmust m1: 要点\nteach default: 先乘开。\n${retry ? `retry: ${retry}\n` : ''}${F}`;
  const twice = parseCheck('check id=k1', ['block L2.1.1 must=p1', rec('p1', 'p1a, p1a'), rec('p1a')].join('\n')).check;
  assert.ok(selfCheck(twice).some((e) => /p1a/.test(e) && /两次/.test(e)), selfCheck(twice).join('\n'));
  const strict = parseCheck('check id=k1', ['block L2.1.1 must=p1', tpl('p1', { retry: ['p1', 'p1'], extra: 'where k > 10\n' })].join('\n')).check;
  assert.ok(selfCheck(strict).some((e) => /p1/.test(e) && /where|没满足/.test(e)), selfCheck(strict).join('\n'));
  // example 写死了数（k=2 时才对）：取到别的 k 就不满足
  const fixed = parseCheck('check id=k1', ['block L2.1.1 must=p1', tpl('p1', { retry: ['p1', 'p1'] }).replace('example: A=[[k,0],[0,0]]', 'example: A=[[2,0],[0,0]]')].join('\n')).check;
  assert.ok(selfCheck(fixed).some((e) => /p1/.test(e) && /取 k=/.test(e) && /example/.test(e)), selfCheck(fixed).join('\n'));
});

test('题库：模板连 retry 一起存；复测从题库拼出来照样是模板、每次取新数', () => {
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', tpl('p1', { retry: ['p1', 'p1'] })].join('\n'));
  const docs = bankDocs(check, { session: 'c-1' });
  assert.equal(docs.length, 1);
  assert.deepEqual(docs[0].doc.retryBank, [docs[0].id, docs[0].id]);
  const bank = docs.map((d) => ({ id: d.id, ...d.doc }));
  const r = retestCheck({ items: [docs[0].id], bank, retests: [{ block: 'L2.1.1', days: 1 }] });
  assert.deepEqual(r.dropped, []);
  const rc = parseCheck(r.head, r.body).check;
  assert.deepEqual(rc.order, ['r1', 'r1a', 'r1b']);
  const mc = materialize(rc, { rand: seq([0.1, 0.5, 0.9]) }).check;
  assert.ok(mc.probes.r1.picked && mc.probes.r1a.picked);
  assert.ok(!mc.probes.r1a.q.includes('\\calc'));
});

test('解答题、判断题也能写成模板：步骤、命题里的 \\calc 换成数', () => {
  const solve = `${F}solve\nid: s1\npick a = int(2, 4)\nq: 求 $\\calc{a}^2$\ntarget: x\nlevel: 核心\nsteps:\ns1 calc: $\\calc{a}^2 = \\calc{a^2}$\n${F}`;
  const p = parseCheck('check id=k1', ['block L2.1.1 must=s1', solve].join('\n')).check.probes.s1;
  const inst = drawProbe(p, { rand: seq([0]) }).probe;
  assert.match(inst.q, /\{2\}\^2/);
  assert.match(inst.steps[0].text, /\{2\}\^2 = \{4\}/);
  const claim = `${F}claim\nid: c1\npick a = int(2, 4)\nclaim: $\\calc{a}$ 阶单位矩阵和任何同阶方阵可交换\ntruth: 真\ntarget: x\nlevel: 核心\nmust m1: E 乘谁都不变\n${F}`;
  const c = parseCheck('check id=k1', ['block L2.1.1 must=c1', claim].join('\n')).check.probes.c1;
  assert.match(drawProbe(c, { rand: seq([0.99]) }).probe.claim, /^\$\{4\}\$ 阶/);
});

test('模板用到课上的量：带着这节课的量取数、算 example', () => {
  const src = tpl('p1', { retry: ['p1', 'p1'] }).replace('if: A != O => 零矩阵不算', 'if: A != O => 零矩阵不算\nif: A*M == M*A => 和 M 不可交换');
  const { check } = parseCheck('check id=k1', ['block L2.1.1 must=p1', src].join('\n'));
  // M = E：什么都和它可交换
  assert.deepEqual(selfCheck(check, { M: [[1, 0], [0, 1]] }), []);
  const mc = materialize(check, { base: { M: [[1, 0], [0, 1]] }, rand: seq([0.2, 0.7, 0.4]) }).check;
  assert.equal(mc.probes['p1~3'].vals.k >= 2, true);
});
