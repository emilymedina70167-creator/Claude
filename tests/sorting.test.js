import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArray, parseGaps, defaultGaps, shellRun, shellTrace, subtables, explainPass, fmt, SORT_GENERATORS } from '../kit/src/sorting.js';
import { check, shapeOf } from '../kit/src/check.js';
import { generate } from '../kit/src/generators.js';
import { Frac } from '../kit/src/linalg.js';

const show = (A) => A.map(fmt).join(' ');
const WD = "49 38 65 97 76 13 27 49'"; // 王道板书的例子

test('解析数组：重复元素加 \' 区分', () => {
  const a = parseArray(WD);
  assert.equal(a.length, 8);
  assert.deepEqual(a[7], { v: 49, mark: 1, id: 7 });
  assert.deepEqual(parseArray('[1, 2, 3]').map((x) => x.v), [1, 2, 3]);
  assert.throws(() => parseArray('1 x 3'), /看不懂/);
  assert.throws(() => parseGaps('4, 8', 8), /小于/);
});

test('希尔增量：n/2 每次减半到 1', () => {
  assert.deepEqual(defaultGaps(8), [4, 2, 1]);
  assert.deepEqual(defaultGaps(10), [5, 2, 1]);
  assert.deepEqual(subtables(8, 3), [[1, 4, 7], [2, 5, 8], [3, 6]]);
});

test('和板书逐趟一致：d = 4, 2, 1', () => {
  const r = shellRun(parseArray(WD), [4, 2, 1]);
  assert.deepEqual(r.states.map((s) => show(s.A)), [
    '49 13 27 49′ 76 38 65 97',
    '27 13 49 38 65 49′ 76 97',
    '13 27 38 49 49′ 65 76 97',
  ]);
});

test('和板书一致：d = 3, 1', () => {
  const r = shellRun(parseArray(WD), [3, 1]);
  assert.equal(show(r.states[0].A), '27 38 13 49 49′ 65 97 76');
  assert.equal(show(r.result), '13 27 38 49 49′ 65 76 97');
});

test('不稳定：65 49 49′ 用 d = 2, 1 排完，49′ 跑到 49 前面', () => {
  assert.equal(show(shellRun(parseArray("65 49 49'"), [2, 1]).result), '49′ 49 65');
});

test('代码顺序：i 轮流处理各子表，到 i = 6 为止', () => {
  const r = shellRun(parseArray("49 13 27 49' 76 38 65 97"), [2], { upto: 6 });
  assert.equal(show(r.result), '27 13 49 38 76 49′ 65 97');
});

test('逐步执行：A[0] 是暂存，j 会变成负数后停下', () => {
  const steps = shellTrace(parseArray(WD), [4]);
  const neg = steps.find((s) => s.kind === 'test' && s.j < 0);
  assert.ok(neg, '应该出现 j < 0 的一步（如 j = 2 - 4 = -2）');
  assert.equal(neg.ok, false);
  assert.equal(steps.filter((s) => s.kind === 'move').length, 3);
});

test('练习题：答案和逐趟结果一致，判分按位置', () => {
  for (let k = 0; k < 50; k++) {
    const p = generate('shellpass', 1);
    assert.equal(shapeOf(p.answer, 'array').kind, 'array');
    assert.equal(check(p.answer.map((x) => Frac.from(x)), p.answer, 'array').ok, true);
    const g = SORT_GENERATORS.shellgroup();
    assert.ok(g.answer.every((x, i) => i === 0 || x - g.answer[i - 1] === g.answer[1] - g.answer[0]));
  }
  const r = check([1, 2, 9].map((x) => Frac.from(x)), [1, 2, 3], 'array');
  assert.deepEqual(r.wrong, [{ i: 2, j: 0 }]);
  assert.match(r.msg, /位置/);
  assert.match(explainPass(parseArray(WD), 4), /子表 2（位置 2, 6）/);
});

// —— 排序演示引擎（engines/sort.js）的常见错法 ——
// 外壳（stepper.js）认错法的三条路：先猜按题面找错法那一遍里的同一个问题、mode: quiz 比答案、mode: fill 逐格比表
import { sortEngine } from '../kit/src/engines/sort.js';
import { misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';

function diagnose(fields) {
  const E = sortEngine;
  const input = E.parse(fields);
  const r = E.run(input);
  const vs = E.variants(input).map((v) => ({ ...v, run: E.run(v.input) }));
  return {
    input, r, vs,
    variant: (re) => { const v = vs.find((x) => re.test(x.label)); assert.ok(v, `没有「${re.source}」这种错法：${vs.map((x) => x.label).join('；')}`); return v; },
    answerOf: (v) => E.quiz(v.input, v.run).answer,
    // 外壳只在答错时才诊断（错法某一趟碰巧和正确的一样时，答对的不会被说成错法）
    quiz: (given) => (given === E.quiz(input, r).answer ? '' : misreadAnswer(given, vs.map((v) => ({ label: v.label, answer: E.quiz(v.input, v.run).answer })))),
    fill: (values) => misreadFill(E.table(input, r), values, vs.map((v) => ({ label: v.label, table: E.table(v.input, v.run) }))),
    ask: (ask, given) => (given === ask.answer ? '' : misreadAnswer(given, vs.map((v) => {
      const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind);
      return a ? { label: v.label, answer: [].concat(a.answer).join(' ') } : null;
    }).filter(Boolean))),
    passAsk: (k) => r.steps.filter((s) => ['pass', 'partition'].includes(s.ask?.tag))[k - 1].ask,
  };
}
const cellsOf = (t) => t.rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
const tableOf = (v) => sortEngine.table(v.input, v.run);

test('排序错法：快排用交换法划分（Hoare 式）、取最后一个当枢轴', () => {
  const d = diagnose({ algo: 'quick', array: WD });
  // 交换法：枢轴取 A[low]，i 从 low+1 往右找比枢轴大的、j 从 high 往左找比枢轴小的（和枢轴相等的两边都跳过），
  // 找到就对换；i、j 交错后枢轴和 A[j] 交换。王道的填坑法第一次划分是 27 38 13 49 76 97 65 49′
  const swap = d.variant(/交换法/);
  assert.equal(d.answerOf(swap), '13 38 27 49 76 97 65 49');
  assert.equal(d.quiz('13 38 27 49 76 97 65 49'), swap.label);
  assert.equal(d.quiz('27 38 13 49 76 97 65 49'), '', '正确答案不认成错法');
  assert.equal(d.quiz('27 38 13 49 76 97 49 65'), '', '随手写错的不乱说');
  // 先猜第一次划分：题面和正确的一样，外壳找得到
  assert.equal(d.ask(d.passAsk(1), '13 38 27 49 76 97 65 49'), swap.label);
  // 填表：整张表按交换法填
  assert.equal(d.fill(cellsOf(tableOf(swap))), swap.label);
  assert.equal(d.fill(cellsOf(sortEngine.table(d.input, d.r))), '');
  // 原有的：取最后一个当枢轴（先猜的题面写明了枢轴，问不到）
  const last = d.variant(/最后一个当枢轴/);
  assert.equal(d.quiz(d.answerOf(last)), last.label);
  assert.equal(d.fill(cellsOf(tableOf(last))), last.label);
});

test('排序错法：直接插入把第 1 个元素也算一趟', () => {
  const d = diagnose({ algo: 'insert', array: WD, pass: '5' });
  const v = d.variant(/也算成了一趟/);
  // 学生的第 5 趟是正确的第 4 趟
  assert.equal(d.answerOf(v), d.r.passes[3].join(' '));
  assert.equal(d.quiz('38 49 65 76 97 13 27 49'), v.label);
  assert.equal(d.quiz('13 38 49 65 76 97 27 49'), '', '正确的第 5 趟');
  assert.equal(d.quiz('13 38 49 65 76 97 49 27'), '', '随手写错的不乱说');
  // 填表：第 1 行写原样，后面每行都晚一趟
  const rows = [WD.replace("'", '').split(' '), ...d.r.passes.slice(0, -1).map((p) => p.map(String))];
  assert.equal(d.fill(rows), v.label);
  assert.equal(d.fill(cellsOf(sortEngine.table(d.input, d.r))), '');
});

test('排序错法：简单选择排序把中间的往后挪（不是交换）、选最大的', () => {
  const d = diagnose({ algo: 'select', array: WD, pass: '1' });
  const v = d.variant(/往后挪了一格/);
  assert.equal(d.answerOf(v), '13 49 38 65 97 76 27 49');
  assert.equal(d.quiz('13 49 38 65 97 76 27 49'), v.label);
  assert.equal(d.quiz('13 38 65 97 76 49 27 49'), '', '正确答案');
  // 先猜第 2 趟：学生看着的是正确的第 1 趟（13 38 65 97 76 49 27 49′），把 27 拿到第 2 个、中间的往后挪
  assert.equal(d.ask(d.passAsk(2), '13 27 38 65 97 76 49 49'), v.label);
  assert.equal(d.ask(d.passAsk(2), '13 27 65 97 76 49 38 49'), '', '正确的第 2 趟');
  assert.equal(d.fill(cellsOf(tableOf(v))), v.label);
  const max = d.variant(/选最大的/);
  assert.equal(d.quiz(d.answerOf(max)), max.label);
  assert.equal(d.ask(d.passAsk(1), d.answerOf(max)), max.label, '选最大的：第 1 趟的先猜认得出');
});

test('排序错法：冒泡只把最小的挪到最前、从前往后冒', () => {
  const d = diagnose({ algo: 'bubble', array: WD, pass: '3' });
  const v = d.variant(/只把最小的那个挪到了最前面/);
  // 这组数前两趟碰巧和正确的一样（答案一样，不会说错），第 3 趟起看得出来：沿途 49′ 那一对没换
  assert.equal(d.answerOf(v), '13 27 38 49 65 97 76 49');
  assert.equal(d.quiz('13 27 38 49 65 97 76 49'), v.label);
  assert.equal(d.quiz('13 27 38 49 49 65 97 76'), '', '正确的第 3 趟');
  // 先猜第 3 趟：在正确的第 2 趟（13 27 49 38 65 97 76 49′）上只把 38 挪到第 3 个
  assert.equal(d.ask(d.passAsk(3), '13 27 38 49 65 97 76 49'), v.label);
  assert.equal(d.fill(cellsOf(tableOf(v))), v.label);
  const front = d.variant(/从前往后冒泡/);
  assert.equal(d.quiz(d.answerOf(front)), front.label);
  assert.equal(d.fill(cellsOf(tableOf(front))), front.label);
  // 答案和正确的完全一样的错法不列（2 1 3：哪种做法都是一趟排好）
  assert.deepEqual(sortEngine.variants(sortEngine.parse({ algo: 'bubble', array: '2 1 3' })), []);
});

test('排序错法：归并把落单的一段并进前一组（只在元素个数不是 2 的幂时）', () => {
  const d = diagnose({ algo: 'merge', array: '49 38 65 97 76 13 27', pass: '1' }); // 王道的 7 个数
  const v = d.variant(/落单/);
  assert.equal(d.answerOf(v), '38 49 65 97 13 27 76');
  assert.equal(d.quiz('38 49 65 97 13 27 76'), v.label);
  assert.equal(d.quiz('38 49 65 97 13 76 27'), '', '正确答案：27 落单，原样留着');
  assert.equal(d.quiz('38 49 65 97 76 13 27'), '', '随手写错的不乱说');
  assert.equal(d.ask(d.passAsk(1), '38 49 65 97 13 27 76'), v.label);
  assert.equal(d.fill(cellsOf(tableOf(v))), v.label);
  // 8 个数每一趟都正好配成对：这种错法不会出现，不列
  assert.ok(!sortEngine.variants(sortEngine.parse({ algo: 'merge', array: WD })).some((x) => /落单/.test(x.label)));
});

test('排序错法：基数排序先按最高位分配、同一个队列后进先出', () => {
  let d = diagnose({ algo: 'radix', array: WD, pass: '2' });
  const msd = d.variant(/最高位/);
  // 先按十位（13 27 38 49 49′ 65 76 97），再按个位
  assert.equal(d.answerOf(msd), '13 65 76 27 97 38 49 49');
  assert.equal(d.quiz('13 65 76 27 97 38 49 49'), msd.label);
  assert.equal(d.quiz('13 27 38 49 49 65 76 97'), '', '正确的第 2 趟');
  assert.equal(d.fill(cellsOf(tableOf(msd))), msd.label);
  d = diagnose({ algo: 'radix', array: WD, pass: '1' });
  const lifo = d.variant(/后放进去的先收集/);
  // 7 号队列里先放 97、后放 27：后进先出就收成 27 97
  assert.equal(d.answerOf(lifo), '13 65 76 27 97 38 49 49');
  assert.equal(d.quiz('13 65 76 27 97 38 49 49'), lifo.label);
  assert.equal(d.quiz('13 65 76 97 27 38 49 49'), '', '正确的第 1 趟');
  assert.equal(d.quiz('13 65 76 97 38 27 49 49'), '', '随手写错的不乱说');
  assert.equal(d.ask(d.passAsk(1), '13 65 76 27 97 38 49 49'), lifo.label);
  assert.equal(d.fill(cellsOf(tableOf(lifo))), lifo.label);
  // 一位数：哪种错法都和正确的一样，不列
  assert.deepEqual(sortEngine.variants(sortEngine.parse({ algo: 'radix', array: '3 1 2 1' })), []);
});
