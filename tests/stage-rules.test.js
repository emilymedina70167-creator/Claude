// 规则接口和裁判（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1、2 节）。
// 假种类 counter 在这里注册；每个测试文件是独立进程，不用注销。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerRules, rulesOf, predicateOf, gestureOf, done, parseMeasure, evalMeasure, measureLine } from '../kit/src/stage/rules.js';
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

test('量的写法：名字(东西或部件)', () => {
  assert.deepEqual(parseMeasure('height(t.50)'), { name: 'height', arg: 't.50' });
  assert.equal(parseMeasure('count( t )').arg, 't');
  assert.equal(parseMeasure('t.50'), null);
  assert.equal(parseMeasure('count(t) + 1'), null, '整个词是一个量才算');
});

test('量的接口：数得出给数；暂时数不了给 null；本来就没有给 undefined；数不了抛的错变成 why；名字写错当场报', () => {
  const none = Object.assign(() => undefined, { none: '不是方阵' });
  const blank = Object.assign((o) => (o.n ? o.n : null), { blank: '还空着' });
  registerRules('meter', { measures: { n: blank, half: (o) => { if (!o.ok) throw new Error(`${o.id} 没写 key`); return o.n / 2; }, sq: none } });
  const sc = (n, ok = true) => ({ objects: new Map([['m', { type: 'meter', id: 'm', n, ok }], ['z', { type: 'plain', id: 'z' }]]) });
  assert.deepEqual(evalMeasure(sc(4), 'n(m)'), { value: 4, why: null });
  assert.deepEqual(evalMeasure(sc(0), 'n(m)'), { value: null, why: 'm 还空着' });
  assert.deepEqual(evalMeasure(sc(4, false), 'half(m)'), { value: null, why: 'm 没写 key' });
  assert.deepEqual(evalMeasure(sc(4), 'sq(m)'), { value: null, why: 'm 没有 sq（不是方阵）' });
  assert.throws(() => evalMeasure(sc(4), 'size(m)'), /没有量「size」，能写：n、half、sq/);
  assert.throws(() => evalMeasure(sc(4), 'n(q)'), /舞台上没有「q」/);
  assert.throws(() => evalMeasure(sc(4), 'n(z)'), /没有量/);
  // 一行「页面算的」：本来就没有的不列；数不了的写在最后
  assert.equal(measureLine(sc(4), sc(4).objects.get('m'), ['好']), '页面算的：n(m) = 4，half(m) = 2；好');
  assert.equal(measureLine(sc(0, false), sc(0, false).objects.get('m')), '页面数不了：m 还空着；m 没写 key');
  assert.equal(measureLine(sc(4), sc(4).objects.get('z')), null, '没交量的东西没有这一行');
  assert.equal(measureLine(sc(3), sc(3).objects.get('m')), '页面算的：n(m) = 3，half(m) = 3/2', '不是整数的写成分数');
});
