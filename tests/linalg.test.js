import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Frac, parseArray, asMatrix, rrefSteps, classify, matmul, eigen2 } from '../kit/src/linalg.js';
import { parseFields } from '../kit/src/parse.js';

const S = (M) => M.map((r) => r.map(String));

test('分数运算与约分', () => {
  assert.equal(String(new Frac(6, -8)), '-3/4');
  assert.equal(String(Frac.from('1/2').add('1/3')), '5/6');
  assert.equal(String(Frac.from(0.25)), '1/4');
  assert.equal(Frac.from('-3/4').toTeX(), '-\\tfrac{3}{4}');
});

test('宽松的矩阵写法', () => {
  assert.deepEqual(S(parseArray('[[1, 2], [3, 4]]')), [['1', '2'], ['3', '4']]);
  assert.deepEqual(S(parseArray('[1 2; 3 1/2]')), [['1', '2'], ['3', '1/2']]);
  assert.deepEqual(parseArray('[2, -1.5]').map(String), ['2', '-3/2']);
  assert.deepEqual(S(asMatrix(parseArray('[[1, 2, 3]]'))), [['1', '2', '3']]);
});

test('唯一解', () => {
  const run = rrefSteps(parseArray('[[1,2,-1,3],[2,5,1,8],[-1,0,2,1]]'), { augmented: true });
  const info = classify(run);
  assert.equal(info.type, 'unique');
  assert.deepEqual(info.x.map(String), ['-1', '2', '0']);
});

test('无穷多解与无解', () => {
  const inf = classify(rrefSteps(parseArray('[[1,2,1,4],[2,4,3,9]]'), { augmented: true }));
  assert.equal(inf.type, 'infinite');
  assert.deepEqual(inf.free, [1]);
  const none = classify(rrefSteps(parseArray('[[1,1,2],[2,2,5]]'), { augmented: true }));
  assert.equal(none.type, 'none');
});

test('需要分数的 RREF', () => {
  const run = rrefSteps(parseArray('[[2,3],[4,1]]'));
  assert.deepEqual(S(run.result), [['1', '0'], ['0', '1']]);
  assert.ok(run.steps.some((s) => s.op && s.op.includes('tfrac')));
});

test('REF 模式不消去主元上方', () => {
  const run = rrefSteps(parseArray('[[1,2],[3,4]]'), { mode: 'ref' });
  assert.equal(String(run.result[0][1]), '2');
  assert.equal(String(run.result[1][0]), '0');
});

test('矩阵乘法', () => {
  const C = matmul(parseArray('[[1,2],[0,1],[3,-1]]'), parseArray('[[2,0,1],[1,3,-2]]'));
  assert.deepEqual(S(C), [['4', '6', '-3'], ['1', '3', '-2'], ['5', '-3', '5']]);
  assert.throws(() => matmul(parseArray('[[1,2]]'), parseArray('[[1,2]]')));
});

test('2×2 特征值', () => {
  const e = eigen2([[2, 1], [1, 2]]);
  assert.deepEqual(e.pairs.map((p) => p.value), [3, 1]);
  assert.equal(eigen2([[0, -1], [1, 0]]).complex, true);
  assert.equal(eigen2([[2, 0], [0, 2]]).scalar, true);
});

test('组件参数：续行与选项', () => {
  const { fields, lines } = parseFields('q: 第一行\n第二行\n- [x] 对\n- [ ] 错\nexplain: 因为');
  assert.equal(fields.q, '第一行\n第二行');
  assert.equal(fields.explain, '因为');
  assert.equal(lines.length, 2);
});
