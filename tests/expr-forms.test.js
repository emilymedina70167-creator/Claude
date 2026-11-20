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

// —— 视觉交互第 2 批 Task 2：二重积分 ——
test('int2：二重积分，内层的上下限可以含外层的变量', () => {
  near(evaluate('int2(x*y, x, 0, 1, y, 0, x)'), 1 / 8, 1e-8);
  near(evaluate('int2(1, x, 0, 1, y, x^2, x)'), 1 / 6, 1e-8);
  near(evaluate('int2(k*x, x, 0, 1, y, 0, 2)', { k: 3 }), 3, 1e-8);
  // 被积函数带指示函数（事件的概率）：差不超过 2e-3
  near(evaluate('int2((x + y <= 1)*2, x, 0, 1, y, 0, 1)'), 1, 2e-3);
  near(evaluate('int2(binormpdf(x, y, 0, 0, 1, 1, 0.5), x, -8, 8, y, -8, 8)'), 1, 1e-4);
  assert.throws(() => evaluate('int2(1/(x*y), x, 0, 1, y, 0, 1)'), /这个二重积分页面算不出来/);
  assert.throws(() => evaluate('int2(1, 2, 0, 1, y, 0, 1)'), /没有函数 int2|自变量/);
});

test('lineint：沿参数曲线的第二类曲线积分 ∫ P dx + Q dy（页面自己求 x′、y′）', () => {
  const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
  near(evaluate('lineint(-y, x, cos(t), sin(t), t, 0, 2pi)'), 2 * Math.PI);
  // 有势场：只看两头，∫ y dx + x dy = xy 从 (0,0) 到 (1,1)
  near(evaluate('lineint(y, x, t, t^2, t, 0, 1)'), 1);
  near(evaluate('lineint(y, x, t^3, t, t, 0, 1)'), 1);
  near(evaluate('lineint(x^2, 0, t, t, t, 0, 2)'), 8 / 3);
  // 外面的量照用；自变量换个名字
  near(evaluate('lineint(a*x, 0, s, 0, s, 0, 1)', { a: 2 }), 1);
  // 反着走变号
  near(evaluate('lineint(-y, x, cos(t), sin(t), t, 2pi, 0)'), -2 * Math.PI);
  assert.throws(() => evaluate('lineint(-y, x, cos(t), sin(t), 0, 2pi)'), /lineint/);
  assert.throws(() => evaluate('lineint(1/x, 0, t, 0, t, -1, 1)'), /算不出来|不收敛|发散/);
});

test('int3：三重积分（内层的上下限能含外层的变量；柱面、球面坐标自己乘雅可比）', () => {
  const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
  near(evaluate('int3(1, x, 0, 1, y, 0, 1 - x, z, 0, 1 - x - y)'), 1 / 6);
  near(evaluate('int3(x*y*z, x, 0, 1, y, 0, 2, z, 0, 3)'), 0.5 * 2 * 4.5);
  near(evaluate('int3(rho^2*sin(phi), t, 0, 2pi, phi, 0, pi, rho, 0, 1)'), (4 * Math.PI) / 3);
  // 柱面坐标：抛物面 z = r² 和 z = 4 之间
  near(evaluate('int3(r, t, 0, 2pi, r, 0, 2, z, r^2, 4)'), 8 * Math.PI, 1e-5);
  near(evaluate('int3(a, x, 0, 1, y, 0, 1, z, 0, 1)', { a: 2.5 }), 2.5);
  assert.throws(() => evaluate('int3(1/z, x, 0, 1, y, 0, 1, z, -1, 1)'), /算不出来/);
  assert.throws(() => evaluate('int3(1, x, 0, 1, y, 0, 1, 3, 0, 1)'), /int3/);
});

test('flux：通量 ∬ F·(r_u × r_v) du dv；lineint3：空间曲线上的第二类曲线积分', () => {
  const near = (a, b, e = 1e-5) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
  // 单位球面朝外（u 是 φ、v 是 θ），F = (x, y, z)：4π
  near(evaluate('flux(x, y, z, sin(u)*cos(v), sin(u)*sin(v), cos(u), u, 0, pi, v, 0, 2pi)'), 4 * Math.PI);
  // 换一下 u、v 的次序朝里：变号
  near(evaluate('flux(x, y, z, sin(v)*cos(u), sin(v)*sin(u), cos(v), u, 0, 2pi, v, 0, pi)'), -4 * Math.PI);
  // 平面片 z = 1 − x − y（x、y 从 0 到 1 的三角形）朝上，F = (0, 0, 1)：面积的投影 1/2
  near(evaluate('flux(0, 0, 1, u, v*(1 - u), 1 - u - v*(1 - u), u, 0, 1, v, 0, 1)'), 0.5);
  near(evaluate('lineint3(-y, x, 0, cos(t), sin(t), t, t, 0, 2pi)'), 2 * Math.PI);
  near(evaluate('lineint3(y*z, x*z, x*y, t, t^2, t^3, t, 0, 1)'), 1); // 有势场 xyz：只看两头
  near(evaluate('lineint3(0, 0, k, 0, 0, s, s, 0, 2)', { k: 3 }), 6);
});
