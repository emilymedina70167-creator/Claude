// 视觉交互第 1 批 Task 2：表达式的特殊形式（求和、连乘、最值、定积分、求根）
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compile, FORM_MAX_TERMS } from '../kit/src/expr.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}（容差 ${e}）`);

test('sum / prod：整数 k 从 a 到 b', () => {
  assert.equal(evaluate('sum(k, 1, 100, k)'), 5050);
  near(evaluate('sum(k, 1, n, 1/k^2)', { n: 2000 }), Math.PI ** 2 / 6, 1e-3);
  assert.equal(evaluate('prod(k, 1, 5, k)'), 120);
  assert.equal(evaluate('sum(k, 3, 2, k)'), 0);
  assert.equal(evaluate('prod(k, 3, 2, k)'), 1);
  assert.equal(compile('sum(k, 1, n, x^k)')({ n: 3, x: 2 }), 14);
});

test('求和用的字母不改外面的同名变量，能套着用', () => {
  assert.equal(evaluate('k + sum(k, 1, 3, k)', { k: 10 }), 16);
  assert.equal(evaluate('sum(i, 1, 3, sum(j, 1, i, 1))'), 6);
});

test('上下限不是整数、项太多：报出来', () => {
  assert.throws(() => evaluate('sum(k, 1, 2.5, k)'), /上下限要是整数/);
  assert.throws(() => evaluate('sum(k, 1, 30000, k)'), /最多 20000/);
  assert.equal(FORM_MAX_TERMS, 20000);
  assert.throws(() => evaluate('sum(2, 1, 3, k)'), /第一个参数是求和用的字母/);
});

test('maxof / minof', () => {
  assert.equal(evaluate('maxof(k, 1, 5, (k-3)^2)'), 4);
  assert.equal(evaluate('minof(k, 1, 5, (k-3)^2)'), 0);
});

test('int：数值定积分', () => {
  near(evaluate('int(cos(t), t, 0, pi/2)'), 1);
  near(evaluate('int(exp(-t), t, 0, inf)'), 1, 1e-6);
  near(evaluate('int(x*t, t, 0, 2)', { x: 3 }), 6);
  assert.throws(() => evaluate('int(1/t, t, 0, 1)'), /这个积分页面算不出来/);
});

test('maxon / minon：区间上的最值', () => {
  near(evaluate('maxon(x - x^2, x, 0, 1)'), 0.25, 1e-8);
  near(evaluate('minon((x-1)^2 + 2, x, -3, 3)'), 2, 1e-8);
  near(evaluate('maxon(abs(x^2 - 4), x, 2 - d, 2 + d)', { d: 0.5 }), 2.25, 1e-8); // 最大值在端点
});

test('roots：区间上的全部实根，极点不算', () => {
  const r = evaluate('roots(x^3 - 3x, x, -3, 3)');
  assert.equal(r.length, 3);
  near(r[0], -Math.sqrt(3), 1e-8); near(r[1], 0, 1e-8); near(r[2], Math.sqrt(3), 1e-8);
  assert.deepEqual(evaluate('roots(1/x, x, -1, 1)'), []);
  assert.deepEqual(evaluate('roots(x^2 + 1, x, -2, 2)'), []);
  assert.deepEqual(evaluate('roots(tan(x), x, 1, 2)'), []); // π/2 是极点
  const e = evaluate('roots(3x^2 - 3, x, -3, 3)');
  near(e[0], -1, 1e-8); near(e[1], 1, 1e-8);
});

test('只有 4 个参数、那个位置是字母时才是特殊形式', () => {
  assert.equal(evaluate('max(1, 5)'), 5);
  assert.equal(evaluate('min(4, 2, 3, 1)'), 1);
  assert.equal(evaluate('max(1, 2, 3, 4)'), 4);
});

test('内圈够快：sum 2000 项求值 200 次', () => {
  const f = compile('sum(k, 1, 2000, sin(k*x)/k)');
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) f({ x: i / 50 });
  assert.ok(performance.now() - t0 < 1500, `用了 ${Math.round(performance.now() - t0)} ms`);
});

test('el / len：向量的第几个分量、有几个（样本数据连乘、求和用）', () => {
  assert.equal(evaluate('el([3, 5, 8], 2)'), 5);
  assert.equal(evaluate('len([3, 5, 8])'), 3);
  near(evaluate('sum(i, 1, len(xs), el(xs, i))/len(xs)', { xs: [1, 2, 6] }), 3);
  near(evaluate('prod(i, 1, len(xs), t*exp(-t*el(xs, i)))', { xs: [1, 2], t: 0.5 }), 0.25 * Math.exp(-1.5));
  assert.throws(() => evaluate('el([1, 2], 3)'), /没有第 3 个/);
  assert.throws(() => evaluate('el([1, 2], 1.5)'), /整数/);
});
