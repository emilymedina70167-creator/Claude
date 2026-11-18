// 检验里的全过程题（solve）：照计划 1 的写法读题、判步骤（board judge 的四种行）、证据的 steps 和计划 1 同一个形状
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck } from '../kit/src/check/spec.js';
import { claudeIds, parseVerdict, outcomeOf, teachFor, verdictPrompt } from '../kit/src/check/judge.js';
import { createFlow, step } from '../kit/src/check/flow.js';
import { evidenceOf } from '../kit/src/check/record.js';
import { STEP_TAGS } from '../kit/src/solvespec.js';

const F = '```';
const solve = (id, retry = []) => `${F}solve\nid: ${id}\nq: 已知 $AB=BA$，证明 $(A^2+E)(B-2E)=(B-2E)(A^2+E)$，每一步写用的是哪条\ntarget: L2-45\nlevel: 核心\nsteps:\ns1 rule: 由 AB = BA 推出 A^2 B = A(AB) = A(BA) = (AB)A = BA^2\ns2 calc: 左边乘开 = A^2 B - 2A^2 + B - 2E\ns3 calc: 右边乘开 = BA^2 + B - 2A^2 - 2E\ns4 conclude: 用 s1 两边相等\nteach s1: 先把 A^2 B 换成 BA^2：一次挪一个 A。\nteach tag=规则用错: 每一步换位置都要用到 AB = BA。\n${retry.length ? `retry: ${retry.join(', ')}\n` : ''}${F}`;
const { check } = parseCheck('check id=k1', ['block L2.1.4 must=p4', solve('p4', ['p4a', 'p4b']), solve('p4a'), solve('p4b')].join('\n'));
const p = check.probes.p4;

test('solve 照计划 1 的写法读出参考步骤', () => {
  assert.deepEqual(p.steps.map((s) => [s.id, s.kind]), [['s1', 'rule'], ['s2', 'calc'], ['s3', 'calc'], ['s4', 'conclude']]);
  assert.deepEqual(claudeIds(p), ['s1', 's2', 's3', 's4']);
  assert.match(verdictPrompt({ probe: p, answer: { text: '…' } }), new RegExp(STEP_TAGS.join('、')));
});

test('s3 wrong tag=规则用错 → 没过，补讲照 tag 找', () => {
  const v = parseVerdict('[判]\ns1 ok\ns2 ok\ns3 wrong tag=规则用错 why="把 BA^2 写成了 A^2 B"\ns4 ok', claudeIds(p), { steps: true });
  const o = outcomeOf(p, v.items);
  assert.equal(o.outcome, 'fail');
  assert.deepEqual(o.failed, ['s3']);
  assert.equal(teachFor(p, o.failed, v.items).key, 'tag=规则用错');
});

test('s2 unsure → 待核；漏写的步 missing 带「步骤缺」', () => {
  const v = parseVerdict('s1 ok\ns2 unsure why="看不清"\ns3 ok\ns4 ok', claudeIds(p), { steps: true });
  assert.equal(outcomeOf(p, v.items).outcome, 'pending');
  assert.deepEqual(v.items[1], { id: 's2', ok: null, unsure: true, why: '看不清', tag: '' });
  const m = parseVerdict('s1 missing\ns2 ok\ns3 ok\ns4 ok', claudeIds(p), { steps: true });
  assert.equal(m.items[0].tag, '步骤缺');
});

test('证据的 steps 和计划 1 的证据同一个形状（unsure 的 ok 是 null）', () => {
  let s = step(createFlow(check), { type: 'start', at: 1 });
  s = step(s, { type: 'submit', id: 'p4', answer: { text: '过程' }, sure: 'sure', ms: 1000, machine: { items: [], needsClaude: true, stop: false }, at: 2 });
  const v = parseVerdict('s1 ok\ns2 unsure why="看不清"\ns3 ok\ns4 ok', claudeIds(p), { steps: true });
  s = step(s, { type: 'verdict', id: 'p4', items: v.items, judgedBy: 'claude', at: 3 });
  const ev = evidenceOf(s, 'p4', { ctx: { session: 'c-1' } });
  assert.equal(ev.kind, 'solve');
  assert.deepEqual(ev.steps.map((x) => [x.id, x.ok]), [['s1', true], ['s2', null], ['s3', true], ['s4', true]]);
  assert.equal(ev.steps[1].unsure, true);
  assert.equal(ev.outcome, 'pending');
});
