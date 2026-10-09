import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../kit/src/expr.js';

// 组件模块在加载时会挂几个页面事件；本地替身数据库用到 localStorage。这里给最小的替身
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {} };
const { parseSteps } = await import('../kit/src/blocks/steps.js');
const { parseRecognize } = await import('../kit/src/blocks/recognize.js');
const { parseFindbug } = await import('../kit/src/blocks/findbug.js');
const { parseGraph } = await import('../kit/src/graph.js');
const { parseSpace } = await import('../kit/src/space.js');
const { parseScene } = await import('../kit/src/scene.js');
const { toAnswer } = await import('../kit/src/live/sync.js');
const { fakeDb } = await import('../kit/src/live/store.js');

const STEPS = `id: ex-rank1
title: 例2.1 求 Aⁿ
q: 设 $A=\\alpha\\beta^T$，求 $A^n$。

step: 写出 $A^2$
ask: 先别算矩阵。
用 α、β 怎么写？
show: $A^2=(\\alpha\\beta^T)(\\alpha\\beta^T)$

step: 换个括号
ask: 中间哪两个可以先乘？
choices: 一个数 | 一个 3×3 矩阵 | 一个 1×3 行向量
answer: 一个数
show: 结合律

step: 推到 n 次
do: true
answer: (b·a)^(n-1) A
show: $A^n=(\\beta^T\\alpha)^{n-1}A$

step: 算一个数
do: true
answer: [1, 2]
show: 就是 (1, 2)`;

test('steps：解析题目、每一步、选项和 do', () => {
  const { fields, steps } = parseSteps(STEPS);
  assert.equal(fields.id, 'ex-rank1');
  assert.equal(steps.length, 4);
  assert.equal(steps[0].title, '写出 $A^2$');
  assert.match(steps[0].ask, /先别算矩阵。\n用 α、β 怎么写？/);
  assert.deepEqual(steps[1].choices, ['一个数', '一个 3×3 矩阵', '一个 1×3 行向量']);
  assert.equal(steps[1].answer, '一个数');
  assert.equal(steps[2].do, true);
  assert.equal(steps[2].num, null, '符号答案不走格子');
  assert.deepEqual(steps[3].num, [1, 2], '能算出数的 do 步骤用格子作答');
  assert.throws(() => parseSteps('q: x'), /至少要有一个 step/);
  assert.throws(() => parseSteps('step: a\nask: b\nchoices: 1 | 2\nanswer: 3\nshow: c'), /不在 choices 里/);
  assert.throws(() => parseSteps('step: a\nask: b'), /show/);
});

test('recognize：方法、多个可接受答案、理由和乱序', () => {
  const r = parseRecognize(`id: rec-1
methods: 秩一公式 | 试算低次幂 | 拆 kE+B 二项展开
reason: true
shuffle: true

item: $A$ 三行成比例，求 $A^{10}$
answer: 秩一公式
why: 三行成比例

item: $A=2E+N$
answer: 拆 kE+B 二项展开 | 试算低次幂`);
  assert.deepEqual(r.methods, ['秩一公式', '试算低次幂', '拆 kE+B 二项展开']);
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[1].answers, ['拆 kE+B 二项展开', '试算低次幂']);
  assert.equal(r.reason, true);
  assert.equal(r.shuffle, true);
  assert.throws(() => parseRecognize('methods: a | b\nitem: x\nanswer: c'), /不在 methods 里/);
});

test('findbug：行、错误行号、说明', () => {
  const r = parseFindbug(`q: 写出 $A^TA$
line: 第一行
line: 对角线填 1, 2, 3
line: 其余是 0
bug: 2
why: 应该是长度的平方`);
  assert.equal(r.lines.length, 3);
  assert.equal(r.bug, 2);
  assert.equal(r.fields.why, '应该是长度的平方');
  assert.throws(() => parseFindbug('line: a\nline: b\nbug: 5'), /1 到 2/);
});

test('表达式：比较、概率函数、常数 e', () => {
  assert.equal(evaluate('3 <= 3'), 1);
  assert.equal(evaluate('k > 2', { k: 1 }), 0);
  assert.equal(evaluate('(x>0)*x + 0', { x: -2 }), 0);
  assert.equal(evaluate('(x>0)*x', { x: 3 }), 3);
  assert.equal(evaluate('2 ≤ 3'), 1);
  assert.ok(Math.abs(evaluate('normcdf(1.96)') - 0.975) < 1e-4);
  assert.ok(Math.abs(evaluate('normpdf(0)') - 0.398942) < 1e-5);
  assert.equal(evaluate('binompmf(2, 4, 0.5)'), 0.375);
  assert.equal(evaluate('choose(5, 2)'), 10);
  assert.ok(Math.abs(evaluate('ln(e)') - 1) < 1e-12);
  assert.equal(evaluate('e', { e: 3 }), 3, '自己定义的变量优先');
  assert.throws(() => evaluate('[1, 2] < 3'), /只能比较两个数/);
});

test('scene：curve、eigen、from/until 修饰', () => {
  const { cmds } = parseScene('let A = [[2, 1], [1, 2]]\ncurve A*[cos(s), sin(s)] for s 0 360 color=yellow\neigen A\nvector A*[1, 0] from=2 until=3\nvector [1,1] from [0,1] color=pink');
  const curve = cmds.find((c) => c.kind === 'curve');
  assert.equal(curve.param, 's');
  assert.deepEqual(curve.expr({ A: [[2, 1], [1, 2]], s: 0 }), [2, 1]);
  assert.ok(cmds.some((c) => c.kind === 'eigen'));
  const v = cmds.filter((c) => c.kind === 'vector');
  assert.equal(v[0].mods.from, '2');
  assert.equal(v[0].mods.until, '3');
  assert.ok(v[1].from, '「from 点」仍然是起点');
});

test('graph 和 space：命令与窗口', () => {
  const g = parseGraph('x: -4 4\ny: 0 0.5\nslider mu -1 1 = 0\nlet a = 1 drag\nplot normpdf(x, mu, 1) color=blue\nshade normpdf(x) -inf a\nbars binompmf(k, 10, 0.3) for k 0 10 highlight=k<=3\nvline a label=a');
  assert.deepEqual(g.xr, [-4, 4]);
  assert.deepEqual(g.yr, [0, 0.5]);
  assert.deepEqual(g.cmds.map((c) => c.kind), ['slider', 'let', 'plot', 'shade', 'bars', 'vline']);
  assert.equal(g.cmds[3].a({}), -Infinity);
  assert.throws(() => parseGraph('bars f(k)'), /bars 的写法/);
  const s = parseSpace('let u = [1, 0, 1]\nspan u, [0, 1, 1] color=blue\nplane normal [0, 0, 1] at [0, 0, 1]\nbox u, [0,1,0], [0,0,1]\nvector u label=u drop');
  assert.deepEqual(s.cmds.map((c) => c.kind), ['let', 'span', 'plane', 'box', 'vector']);
  assert.deepEqual(s.cmds[2].at({}), [0, 0, 1]);
  assert.equal(s.cmds[4].mods.drop, true);
});

test('live：作答记录转成数据库里的一条', () => {
  const a = toAnswer({ type: 'conjecture', title: '发现', q: '为什么', answer: '因为……', verdict: '已交', step: 's1', block: 'cj', at: 5 }, ['img1']);
  assert.equal(a.kind, 'conjecture');
  assert.equal(a.text, '因为……');
  assert.equal(a.ok, null);
  assert.deepEqual(a.images, ['img1']);
  assert.equal(a.step, 's1');
  const ask = toAnswer({ type: 'ask', question: '这一步为什么？', answer: '先想想……', block: 'tutor' });
  assert.equal(ask.text, '这一步为什么？');
  assert.equal(ask.aiFeedback, '先想想……');
  const t = toAnswer({ type: 'answer-try', value: '(1, 2)', ok: false, work: '过程' });
  assert.equal(t.kind, 'answer');
  assert.equal(t.transcript, '过程');
  assert.equal(t.ok, false);
});

test('live：本地替身数据库（文档、集合、查询、订阅）', async () => {
  const db = fakeDb('t');
  await db.doc('steps/s1').set({ seq: 2, md: 'b' });
  await db.doc('steps/s0').set({ seq: 1, md: 'a' });
  await db.doc('steps/s1').update({ hidden: true });
  assert.deepEqual((await db.doc('steps/s1').get()).data(), { seq: 2, md: 'b', hidden: true });
  await assert.rejects(db.doc('steps/zz').update({ a: 1 }));
  const q = await db.collection('steps').orderBy('seq').get();
  assert.deepEqual(q.docs.map((d) => d.id), ['s0', 's1']);
  assert.equal((await db.collection('steps').where('hidden', '==', true).get()).size, 1);
  assert.throws(() => db.doc('steps'), TypeError);
  const seen = [];
  const un = db.collection('answers').onSnapshot((s) => seen.push(s.docChanges().map((c) => c.type)));
  await new Promise((r) => setTimeout(r, 5));
  await db.collection('answers').add({ kind: 'answer' });
  await new Promise((r) => setTimeout(r, 5));
  un();
  assert.deepEqual(seen, [[], ['added']]);
  assert.ok(mem.get('t'), '写进了 localStorage');
});
