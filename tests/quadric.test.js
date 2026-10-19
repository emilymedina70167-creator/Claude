// 二次曲面、二次曲线的线框（kit/src/quadric.js）：每个点都在曲面上，类型认得对
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symEig, quadricLines, conicLines } from '../kit/src/quadric.js';

const form = (A, x) => x.reduce((s, xi, i) => s + xi * A[i].reduce((t, a, j) => t + a * x[j], 0), 0);
const onSurface = (A, c, lines) => lines.every((l) => l.every((x) => Math.abs(form(A, x) - c) < 1e-6 * Math.max(1, Math.abs(c))));

test('symEig：特征值、单位正交的特征向量，A q = λ q', () => {
  const A = [[2, 1, 0], [1, 2, 0], [0, 0, 5]];
  const { values, vectors } = symEig(A);
  assert.deepEqual(values.map((x) => Math.round(x * 1e9) / 1e9).sort((a, b) => a - b), [1, 3, 5]);
  vectors.forEach((q, k) => {
    const Aq = A.map((r) => r.reduce((s, a, j) => s + a * q[j], 0));
    Aq.forEach((x, i) => assert.ok(Math.abs(x - values[k] * q[i]) < 1e-9));
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9);
  });
  assert.throws(() => symEig([[1, 2], [3, 4]]), /对称/);
});

test('quadricLines：椭球面、单叶 / 双叶双曲面、柱面、锥面；点都在曲面上、截在范围里', () => {
  const cases = [
    [[[2, 0, 0], [0, 3, 0], [0, 0, 3]], 1, '椭球面'],
    [[[2, 0, 0], [0, 3, 2], [0, 2, 3]], 6, '椭球面'], // 特征值 2、1、5（二次型那一章的标准例子）
    [[[1, 0, 0], [0, 1, 0], [0, 0, -1]], 1, '单叶双曲面'],
    [[[1, 0, 0], [0, -1, 0], [0, 0, -1]], 1, '双叶双曲面'],
    [[[1, 0, 0], [0, -1, 0], [0, 0, -1]], -1, '单叶双曲面'], // 右边是负数：两边同乘 −1
    [[[1, 0, 0], [0, 4, 0], [0, 0, 0]], 4, '椭圆柱面'],
    [[[1, 0, 0], [0, -1, 0], [0, 0, 0]], 1, '双曲柱面'],
    [[[1, 0, 0], [0, 0, 0], [0, 0, 0]], 1, '两个平行平面'],
  ];
  for (const [A, c, kind] of cases) {
    const r = quadricLines(A, c, 3);
    assert.equal(r.kind, kind, JSON.stringify(A));
    assert.ok(r.lines.length > 4);
    assert.ok(onSurface(A, c, r.lines), `${kind}：有的点不在曲面上`);
    assert.ok(r.lines.every((l) => l.every((x) => x.every((t) => Math.abs(t) <= 3 * 1.8))), `${kind}：伸得太远`);
  }
  const cone = quadricLines([[1, 0, 0], [0, 1, 0], [0, 0, -1]], 0, 3);
  assert.equal(cone.kind, '二次锥面');
  assert.ok(onSurface([[1, 0, 0], [0, 1, 0], [0, 0, -1]], 0, cone.lines));
  const none = quadricLines([[-1, 0, 0], [0, -2, 0], [0, 0, -3]], 1, 3);
  assert.equal(none.kind, '没有实点');
  assert.deepEqual(none.lines, []);
});

test('conicLines：椭圆、双曲线（两支）、平行直线、相交直线；点都在曲线上', () => {
  const e = conicLines([[2, 1], [1, 2]], 3, 4);
  assert.equal(e.kind, '椭圆');
  assert.ok(onSurface([[2, 1], [1, 2]], 3, e.lines));
  const h = conicLines([[1, 2], [2, 1]], 3, 4);
  assert.equal(h.kind, '双曲线');
  assert.equal(h.lines.length, 2);
  assert.ok(onSurface([[1, 2], [2, 1]], 3, h.lines));
  assert.equal(conicLines([[1, 0], [0, 0]], 4).kind, '两条平行直线');
  const x = conicLines([[1, 0], [0, -4]], 0, 4);
  assert.equal(x.kind, '两条相交直线');
  assert.ok(onSurface([[1, 0], [0, -4]], 0, x.lines));
  assert.equal(conicLines([[-1, 0], [0, -1]], 1).kind, '没有实点');
});
