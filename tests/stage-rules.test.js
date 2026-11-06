// 规则接口和裁判（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1、2 节）。
// 假种类 counter 在这里注册；每个测试文件是独立进程，不用注销。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerRules, rulesOf, predicateOf, gestureOf, done } from '../kit/src/stage/rules.js';
import { judge } from '../kit/src/stage/referee.js';

registerRules('counter', {
  next: (o) => (o.n >= 3 ? null : { acts: [{ type: 'add', k: 1 }], why: '加 1' }),
  check: (o, act) => {
    if (act.k < 0) return { legal: false, right: null, why: '这里不能减' };
    if (act.k === 1) return { legal: true, right: true };
    return { legal: true, right: false, misread: '像跳了一步', why: `加 ${act.k}`, next: '加 1' };
  },
  predicates: { full: (o) => o.n >= 3, atLeast: (o, [k]) => o.n >= k, unknown: () => null },
  gestures: { tap: { gesture: 'tap', type: 'add', k: 1 } },
});

const scene = (n = 0) => ({ objects: new Map([['c', { type: 'counter', id: 'c', n }], ['z', { type: 'plain', id: 'z' }]]) });
const jump = { type: 'add', k: 2 };

test('默认 quiet：照做、不圈、不叫，事实里有像哪种错', () => {
  const r = judge(scene(), 'c', jump);
  assert.equal(r.apply, true);
  assert.equal(r.mark, false);
  assert.equal(r.call, null);
  assert.ok(r.facts.some((f) => f.includes('像跳了一步')));
  assert.equal(r.verdict.right, false);
});

test('mark：照做并圈一下', () => {
  const r = judge(scene(), 'c', jump, { wrong: 'mark' });
  assert.equal(r.apply, true);
  assert.equal(r.mark, true);
});

test('block：不让做', () => {
  const r = judge(scene(), 'c', jump, { wrong: 'block' });
  assert.equal(r.apply, false);
  assert.equal(r.mark, false);
});

test('call=wrong：走偏就叫；对的不叫', () => {
  assert.equal(judge(scene(), 'c', jump, { call: 'wrong' }).call, 'now');
  assert.equal(judge(scene(), 'c', { type: 'add', k: 1 }, { call: 'wrong' }).call, null);
});

test('不合规则永远不做', () => {
  for (const wrong of ['quiet', 'mark', 'block']) {
    const r = judge(scene(), 'c', { type: 'add', k: -1 }, { wrong });
    assert.equal(r.apply, false, wrong);
    assert.equal(r.mark, false, wrong);
  }
});

test('老师的不拦：block 也照演，不叫，核出现在正确的是什么', () => {
  const r = judge(scene(), 'c', jump, { wrong: 'block', call: 'wrong' }, { by: 'teacher' });
  assert.equal(r.apply, true);
  assert.equal(r.call, null);
  assert.ok(r.facts.some((f) => f.includes('你在') && f.includes('现在正确的是')));
});

test('老师做对了不多话；老师做不合规则的也照演', () => {
  assert.deepEqual(judge(scene(), 'c', { type: 'add', k: 1 }, {}, { by: 'teacher' }).facts, []);
  assert.equal(judge(scene(), 'c', { type: 'add', k: -1 }, {}, { by: 'teacher' }).apply, true);
});

test('做完', () => {
  assert.equal(done(scene(2), 'c'), false);
  assert.equal(done(scene(3), 'c'), true);
  assert.equal(done(scene(3), 'z'), false); // 没规则的不算做完
});

test('没有规则的东西：照旧能用，只是不判', () => {
  const sc = scene();
  assert.equal(rulesOf(sc.objects.get('z')), null);
  const r = judge(sc, 'z', jump, { wrong: 'block', call: 'wrong' });
  assert.equal(r.apply, true);
  assert.deepEqual(r.facts, []);
  assert.equal(r.call, null);
  assert.equal(judge(sc, 'nope', jump).apply, true);
});

test('缺的项给默认值', () => {
  registerRules('bare', {});
  const r = rulesOf({ type: 'bare' });
  assert.equal(r.next({}, {}), null);
  assert.deepEqual(r.check({}, {}, {}), { legal: true, right: null });
  assert.deepEqual(r.predicates, {});
  assert.deepEqual(r.facts([], [], {}), []);
});

test('predicateOf 和 gestureOf', () => {
  const sc = scene(3);
  assert.equal(predicateOf(sc, 'c', 'full')([]), true);
  assert.equal(predicateOf(sc, 'c', 'atLeast')([4]), false);
  assert.equal(predicateOf(sc, 'c', 'unknown')([]), null);
  assert.equal(predicateOf(sc, 'c', 'nope'), null);
  assert.equal(predicateOf(sc, 'z', 'full'), null);
  assert.deepEqual(gestureOf(sc.objects.get('c'), 'tap'), { gesture: 'tap', type: 'add', k: 1 });
  assert.equal(gestureOf(sc.objects.get('c'), 'drag'), null);
  assert.equal(gestureOf(sc.objects.get('z'), 'tap'), null);
});

test('交了规则但没交 next 的种类不算做完', () => {
  registerRules('checkonly', { check: () => ({ legal: true, right: true }) });
  const sc = { objects: new Map([['k', { type: 'checkonly', id: 'k' }]]) };
  assert.equal(done(sc, 'k'), false);
});
