import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, valueTeX, numTeX } from '../kit/src/expr.js';
import { check, shapeOf, rank } from '../kit/src/check.js';
import { GENERATORS } from '../kit/src/generators.js';
import { Frac } from '../kit/src/linalg.js';

const F = (a) => (Array.isArray(a) ? a.map(F) : Frac.from(a));

test('表达式：矩阵、向量、函数', () => {
  const v = { A: [[2, -1], [1, 3]], x: [1, 1] };
  assert.deepEqual(evaluate('A*x', v), [1, 4]);
  assert.deepEqual(evaluate('2x - [1, 0]', v), [1, 2]);
  assert.deepEqual(evaluate('col(A, 2)', v), [-1, 3]);
  assert.equal(evaluate('det(A)', v), 7);
  assert.deepEqual(evaluate('A^2', v), [[3, -5], [5, 8]]);
  assert.deepEqual(evaluate('lerp(I, A, 1)', v), [[2, -1], [1, 3]]);
  assert.deepEqual(evaluate('mat([1, 2], [3, 4])'), [[1, 3], [2, 4]]);
  assert.equal(evaluate('|[3, 4]|'), 5);
  assert.throws(() => evaluate('A*[1, 2, 3]', v), /不能相乘/);
  assert.throws(() => evaluate('B', v), /未定义/);
});

test('数值转 TeX 时写成分数', () => {
  assert.equal(numTeX(0.5), '\\tfrac{1}{2}');
  assert.equal(numTeX(-1 / 3), '-\\tfrac{1}{3}');
  assert.equal(valueTeX([1, 2]), '\\begin{bmatrix}1 \\\\ 2\\end{bmatrix}');
});

test('判分：向量逐分量，标出错的位置', () => {
  const r = check(F([1, 5]), [1, 4]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.wrong, [{ i: 1, j: 0 }]);
  assert.equal(check(F(['1/2', '0.25']), [0.5, 0.25]).ok, true);
});

test('判分：基——写法不同但张成同一空间也算对', () => {
  const ref = [[1, 2, 1], [1, 0, -1]];
  assert.equal(check(F([[1, 1, 0], [0, 1, 1]]), ref, 'basis').ok, true);
  assert.match(check(F([[1, 1, 0]]), ref, 'basis').msg, /2 维/);
  assert.match(check(F([[1, 1, 0], [2, 2, 0]]), ref, 'basis').msg, /线性相关/);
  assert.match(check(F([[1, 0, 0], [0, 1, 0]]), ref, 'basis').msg, /不在/);
});

test('判分：特征向量差一个倍数也对', () => {
  assert.equal(check(F([-3, -6]), [1, 2], 'eigvec').ok, true);
  assert.equal(check(F([0, 0]), [1, 2], 'eigvec').ok, false);
  assert.equal(check(F([2, 1]), [1, 2], 'eigvec').ok, false);
});

test('作答形状推断', () => {
  assert.deepEqual(shapeOf(3), { kind: 'number' });
  assert.deepEqual(shapeOf([1, 2]), { kind: 'vector', n: 2 });
  assert.deepEqual(shapeOf([[1, 2], [3, 4]]), { kind: 'matrix', r: 2, c: 2 });
  assert.deepEqual(shapeOf([[1, 2, 1]], 'basis'), { kind: 'vectors', n: 3, count: 1 });
  assert.equal(rank([[1, 2], [2, 4]]), 1);
});

test('出题器：答案和题目一致', () => {
  for (let k = 0; k < 200; k++) {
    for (const [name, g] of Object.entries(GENERATORS)) {
      const p = g(k % 2 ? 2 : 1);
      assert.ok(p.q && p.answer !== undefined, name);
      if (name === 'nullspace') {
        // 答案向量确实在零空间里
        const A = JSON.parse(p.q.match(/\\begin\{bmatrix\}(.*?)\\end\{bmatrix\}/)[1].split(' \\\\ ').map((r) => `[${r.split(' & ').join(',')}]`).join(',').replace(/^/, '[').replace(/$/, ']'));
        A.forEach((row) => assert.equal(row.reduce((s, a, j) => s + a * p.answer[0][j], 0), 0));
        assert.equal(rank(A), 2);
      }
    }
  }
});
