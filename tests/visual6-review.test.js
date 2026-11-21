// 视觉交互第 6 批独立复查以后一次修完的：一条一个能重现的测试（画面上的另有 .superpowers/audit-visual/ds/v6-rev.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import { dequeEngine } from '../kit/src/engines/deque.js';
import { slistEngine } from '../kit/src/engines/slist.js';
import { storeEngine } from '../kit/src/engines/store.js';
import { detEngine } from '../kit/src/engines/det.js';
import { traceEngine, stackFrames } from '../kit/src/engines/trace.js';
import { resolveAsks, parseAskField } from '../kit/src/stepperspec.js';

const asksOf = (s) => [s.ask, ...(s.asks || [])].filter(Boolean);
const placed = (E, f) => { const input = E.parse(f); const r = E.run(input); return { input, r, res: resolveAsks(parseAskField(f.ask), r.steps) }; };

test('C1 deque 的 op：每一种还走得通的做法都算对（空队列里左进右进一样）', () => {
  const { r } = placed(dequeEngine, { kind: 'out', push: '1 2 3 4', seq: '2 1 3 4', ask: 'op' });
  const first = r.steps.flatMap(asksOf).find((a) => a.tag === 'op');
  assert.ok(first.alts.includes('右端进') && first.alts.includes('左端进'), JSON.stringify(first.alts));
  const both = placed(dequeEngine, { kind: 'both', push: '1 2 3', seq: '1 2 3', ask: 'op' }).r.steps.flatMap(asksOf).filter((a) => a.tag === 'op');
  assert.ok(both.some((a) => a.alts.length > 1));
});

test('C2 slist：问前驱的那一步在说出前驱之前；slot、pre、next 各在自己的一步，都问得到', () => {
  const { r, res } = placed(slistEngine, { size: 7, list: 'a b c', ops: 'insert 2 x', ask: 'slot, pre, next' });
  assert.deepEqual(res.errors, []);
  const tags = [...res.which.values()].map((a) => a.tag);
  assert.deepEqual(tags.sort(), ['next', 'pre', 'slot']);
  const k = [...res.which.entries()].find(([, a]) => a.tag === 'pre')[0];
  assert.doesNotMatch(r.steps.slice(0, k).map((s) => s.msg).join(''), /前驱是 a\[|找到前驱/);
});

test('I4 一步只问一个：写了的问题都要问得到——store 的 list + degree、matrix + list，deque 的 possible + op', () => {
  for (const [E, f, want] of [
    [storeEngine, { graph: 'A-B, A-C, B-D, C-D', show: 'matrix, list', ask: 'list, degree' }, ['degree', 'list']],
    [storeEngine, { graph: 'A-B, A-C, B-D, C-D', show: 'matrix, list', ask: 'matrix, list' }, ['list', 'matrix']],
    [dequeEngine, { kind: 'in', push: '1 2 3 4', seq: '4 1 3 2', ask: 'possible, op' }, ['op', 'possible']],
  ]) {
    const { res } = placed(E, f);
    assert.deepEqual(res.errors, [], f.ask);
    assert.deepEqual([...new Set([...res.which.values()].map((a) => a.tag))].sort(), want, f.ask);
  }
  // 外壳：写了的问题一次都问不到（和别的问题挤在同一步）时报出来
  const steps = [{}, { ask: { tag: 'x', kind: 'number', q: 'x', answer: 1 }, asks: [{ tag: 'y', kind: 'number', q: 'y', answer: 2 }] }];
  const r2 = resolveAsks(parseAskField('x, y'), steps);
  assert.match(r2.errors.join(''), /y.*同一步/);
});

test('I3 希腊字母的参数：倍数和 r_{1} 中间有空，KaTeX 认得', () => {
  const input = detEngine.parse({ matrix: '[[λ, 1], [1, λ]]', param: 'λ', ops: 'r1 <-> r2; r2 - λ r1' });
  const r = detEngine.run(input);
  const ops = r.steps.map((s) => s.view.op || '').join(' ') + r.steps.map((s) => s.ask?.q || '').join(' ');
  assert.doesNotMatch(ops, /\\lambda[a-z]/);
  assert.match(ops, /\\lambda[ \\]/);
  // 映射以外的希腊字母照它自己写，不写成 λ
  const w = detEngine.run(detEngine.parse({ matrix: '[[ω, 1], [1, ω]]', param: 'ω', ops: 'expand r1' }));
  assert.match(w.valueTeX, /\\omega/);
});

test('I5 双亲表示的错法：按先序编号时，问的还是同一个结点的双亲', () => {
  const f = { tree: 'A(B(D, E), C(F))', show: 'parent', ask: 'parent' };
  const input = storeEngine.parse(f);
  const wrong = storeEngine.run({ ...input, mistake: 'pre' });
  const askF = wrong.steps.flatMap(asksOf).find((a) => a.tag === 'parent' && /^F /.test(a.q));
  // 先序：A0 B1 D2 E3 C4 F5，F 的双亲 C 是 4
  assert.equal(askF.answer, 4);
  const askC = wrong.steps.flatMap(asksOf).find((a) => a.tag === 'parent' && /^C /.test(a.q));
  assert.equal(askC.answer, 0);
});

test('另外：帧里的变量不因为是参数的子串被藏起来；展开到一阶以后还写了 ops 报错', () => {
  const src = 'call: f(10)\ncode:\nint f(int n){\n    n = n / 10;\n    if(n<1) return 0;\n    return f(n);\n}';
  const input = traceEngine.parse({}, src);
  const r = traceEngine.run(input);
  const frames = r.steps.map((s) => stackFrames(s.view)).filter((fs) => fs.length >= 2);
  const shown = frames.some((fs) => fs.some((f) => f.label === 'f(n = 10)' && f.vars.includes('n = 1')));
  assert.ok(shown, '第一层 n 已经变成 1：要写出来');
  assert.throws(() => detEngine.run(detEngine.parse({ matrix: '[[1, 2], [3, 4]]', ops: 'expand r1; r1 <-> r2' })), /展开到一阶|已经算出/);
});
