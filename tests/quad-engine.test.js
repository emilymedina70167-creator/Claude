import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quadEngine as G, parseForm, complete } from '../kit/src/engines/quad.js';
import { Q } from '../kit/src/exact.js';

const S = (M) => M.map((r) => r.map(String));

test('二次型的矩阵：交叉项系数平分', () => {
  const { n, A } = parseForm('x1^2 + 2x2^2 + 5x3^2 + 2x1x2 + 2x1x3 + 6x2x3');
  assert.equal(n, 3);
  assert.deepEqual(S(A), [['1', '1', '1'], ['1', '2', '3'], ['1', '3', '5']]);
  assert.deepEqual(S(parseForm('x^2 - y^2 + 4xy').A), [['1', '2'], ['2', '-1']]);
  assert.throws(() => parseForm('x1^2 + x2'), /二次的/);
  assert.throws(() => parseForm('x1^2 + q'), /少了/);
});

test('配方法：(x1+x2+x3)² + (x2+2x3)²，半正定（同济的例子）', () => {
  const input = G.parse({ f: 'x1^2 + 2x2^2 + 5x3^2 + 2x1x2 + 2x1x3 + 6x2x3' });
  const r = G.run(input);
  assert.deepEqual(r.d.map(String), ['1', '1', '0']);
  assert.equal(r.p, 2);
  assert.equal(r.q, 0);
  assert.equal(r.kind, '半正定');
  const c = complete(input.A);
  assert.deepEqual(S(c.C), [['1', '-1', '1'], ['0', '1', '-2'], ['0', '0', '1']]);
  // 交叉项没除以 2 的错法：a12 那一问的答案变成 2
  const v = G.variants(input)[0];
  assert.equal(G.run(v.input).steps.find((s) => s.ask?.tag === 'matrix').ask.answer, 2);
  assert.equal(r.steps.find((s) => s.ask?.tag === 'matrix').ask.answer, 1);
});

test('只有交叉项：先令 x1 = y1 + y2、x2 = y1 − y2', () => {
  const input = G.parse({ f: '2x1x2 + 2x1x3 - 6x2x3' });
  const r = G.run(input);
  assert.deepEqual(r.d.map(String), ['2', '-2', '6']);
  assert.equal(r.kind, '不定');
  // x = Cy 代回去：Cᵀ A C = diag(d)
  const c = complete(input.A);
  const T = (M) => M[0].map((_, j) => M.map((row) => row[j]));
  const mul = (X, Y) => X.map((row) => Y[0].map((_, j) => row.reduce((s, x, k) => s.add(x.mul(Y[k][j])), new Q(0n))));
  const D = mul(mul(T(c.C), input.A), c.C);
  assert.deepEqual(D.map((row, i) => row[i].toString()), ['2', '-2', '6']);
  D.forEach((row, i) => row.forEach((x, j) => { if (i !== j) assert.ok(x.zero); }));
});

test('正交变换法：特征值 1, 2, 5，f = 1 是椭球面，正定', () => {
  const r = G.run(G.parse({ f: '2x1^2 + 3x2^2 + 3x3^2 + 4x2x3', method: 'orth' }));
  assert.deepEqual(r.d.map(String), ['1', '2', '5']);
  assert.equal(r.kind, '正定');
  assert.equal(r.steps.find((s) => s.ask?.tag === 'surface').ask.answer, '椭球面');
  assert.deepEqual(r.minors.map(String), ['2', '6', '10']);
});
