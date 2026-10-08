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
