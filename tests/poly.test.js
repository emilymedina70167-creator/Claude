import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Poly, P, charPoly, polyDet, polyGcd } from '../kit/src/poly.js';
import { Q } from '../kit/src/exact.js';

const q = (n, d = 1) => new Q(BigInt(n), BigInt(d));
const M = (rows) => rows.map((r) => r.map((x) => q(x)));

test('多项式：加减乘除、求值、展开和分解的写法', () => {
  const x = Poly.x();
  const p = x.sub(2).mul(x.sub(2)).mul(x.sub(6)); // (x−2)²(x−6)
  assert.equal(p.toTeX(), '\\lambda^{3} - 10\\lambda^{2} + 28\\lambda - 24');
  assert.equal(p.toFactorTeX(), '(\\lambda - 2)^{2}(\\lambda - 6)');
  assert.equal(p.eval(2).toString(), '0');
  const { q: qq, r } = p.divmod(x.sub(6));
  assert.ok(r.zero);
  assert.equal(qq.toTeX('x'), 'x^{2} - 4x + 4');
  const { roots, rest } = p.roots();
  assert.deepEqual(roots.map((z) => [z.root.toString(), z.mult]), [['2', 2], ['6', 1]]);
  assert.equal(rest.deg, 0);
  // 有理根和没有有理根的部分：(2x − 1)(x² + 1)
  const s = x.scale(2).sub(1).mul(x.mul(x).add(1));
  const sr = s.roots();
  assert.deepEqual(sr.roots.map((z) => z.root.toString()), ['1/2']);
  assert.equal(sr.rest.deg, 2);
  assert.equal(s.toFactorTeX('x'), '2(x - \\tfrac{1}{2})(x^{2} + 1)');
  assert.equal(x.mul(x).toFactorTeX(), '\\lambda^{2}');
  assert.equal(P(3).toFactorTeX(), '3');
  // 首项是负的
  assert.equal(P(1).sub(x).mul(x.add(2)).toFactorTeX(), '-(\\lambda + 2)(\\lambda - 1)');
});

test('特征多项式和行列式（考研题的数）', () => {
  // A = [[1,−1,1],[2,4,−2],[−3,−3,5]]：(λ−2)²(λ−6)
  const f = charPoly(M([[1, -1, 1], [2, 4, -2], [-3, -3, 5]]));
  assert.equal(f.toFactorTeX(), '(\\lambda - 2)^{2}(\\lambda - 6)');
  // 实对称 [[0,1,1],[1,0,1],[1,1,0]]：(λ+1)²(λ−2)
  assert.equal(charPoly(M([[0, 1, 1], [1, 0, 1], [1, 1, 0]])).toFactorTeX(), '(\\lambda + 1)^{2}(\\lambda - 2)');
  // 二次型 [[2,0,0],[0,3,2],[0,2,3]]：1, 2, 5
  assert.deepEqual(charPoly(M([[2, 0, 0], [0, 3, 2], [0, 2, 3]])).roots().roots.map((z) => z.root.toString()), ['1', '2', '5']);
  // 4 阶行列式 160
  assert.equal(polyDet(M([[1, 2, 3, 4], [2, 3, 4, 1], [3, 4, 1, 2], [4, 1, 2, 3]])).constValue().toString(), '160');
  assert.equal(polyGcd(Poly.x().sub(1).mul(Poly.x().add(2)), Poly.x().sub(1).mul(Poly.x().sub(5))).toTeX('x'), 'x - 1');
});
