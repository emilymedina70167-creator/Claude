// 计划 3（dr-calc-base）Task 5：数值极限、阶（审的必改 1、2 和经典极限回归）
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../kit/src/expr.js';
import { numLimit, orderAt, LIMIT_EVALS } from '../kit/src/fx/limit.js';

const F = (src) => { const f = compile(src); return (x) => f({ x }); };
const near = (r, want, tol = 1e-6) => {
  assert.equal(r.kind, 'finite', JSON.stringify(r));
  assert.ok(Math.abs(r.value - want) <= tol * Math.max(1, Math.abs(want)), `${r.value} ≠ ${want}`);
};

// 必须算出来的（幂级数型）
const MUST = [
  ['(tan(x)-sin(x))/x^3', 0, 0.5], ['(x-sin(x))/x^3', 0, 1 / 6], ['(1-cos(x))/x^2', 0, 0.5], ['(e^x-1-x)/x^2', 0, 0.5],
  ['(ln(1+x)-x)/x^2', 0, -0.5], ['(arcsin(x)-x)/x^3', 0, 1 / 6], ['(x-arctan(x))/x^3', 0, 1 / 3], ['(1+x)^(1/x)', 0, Math.E],
  ['((1+x)^(1/x)-e)/x', 0, -Math.E / 2], ['(1+1/x)^x', '+inf', Math.E],
  ['sin(x)/x', 0, 1], ['(e^x-1-x-x^2/2)/x^3', 0, 1 / 6],
];
for (const [f, a, v] of MUST) test(`经典极限：${f}，x→${a}`, () => near(numLimit(F(f), a), v));

// 允许判不了（不是 h 的幂级数），但判出来了就得对
for (const [f, a, side, v] of [['x*ln(x)', 0, '+', 0], ['x^x', 0, '+', 1], ['x^(1/x)', '+inf', null, 1]]) {
  test(`允许判不了：${f}`, () => {
    const r = numLimit(F(f), a, side ? { side } : {});
    if (r.kind !== null) near(r, v, 1e-4);
  });
}

test('x→∞ 是两侧（审的必改 1）', () => {
  assert.equal(numLimit(F('arctan(x)'), 'inf').kind, 'none');
  near(numLimit(F('arctan(x)'), '+inf'), Math.PI / 2);
  near(numLimit(F('arctan(x)'), '-inf'), -Math.PI / 2);
  assert.equal(numLimit(F('e^x'), 'inf').kind, 'none');
  near(numLimit(F('(1+1/x)^x'), 'inf'), Math.E);
  assert.equal(numLimit(F('x^3'), 'inf').kind, 'inf');
  assert.equal(numLimit(F('x^2'), 'inf').kind, '+inf');
});
test('无符号的 ∞ 和不存在（审的必改 2）', () => {
  assert.equal(numLimit(F('1/x'), 0).kind, 'inf');
  assert.equal(numLimit(F('1/x^2'), 0).kind, '+inf');
  assert.equal(numLimit(F('-1/x^2'), 0).kind, '-inf');
  assert.equal(numLimit(F('abs(x)/x'), 0).kind, 'none');
  assert.equal(numLimit(F('1/x'), 0, { side: '+' }).kind, '+inf');
});
test('振荡的极限报判不了且不超过 30 次求值', () => {
  let n = 0;
  const r = numLimit((x) => { n++; return Math.sin(1 / x); }, 0, { side: '+' });
  assert.equal(r.kind, null);
  assert.ok(n <= 30 && LIMIT_EVALS <= 30);
});
test('两条步长对不上就判不了', () => {
  // cos(π/x)：h = 0.2·2^-k 上（k ≥ 1）恒为 1，0.2·3^-k 上恒为 −1：只用一条会被骗成「极限是 1」
  assert.equal(numLimit(F('cos(pi/x)'), 0, { side: '+' }).kind, null);
});
test('阶（可以是分数）', () => {
  const r = orderAt(F('tan(x)-sin(x)'), 0);
  assert.ok(r.ok && Math.abs(r.k - 3) < 0.05);
  const s = orderAt(F('x^(3/2)+x^2'), 0);
  assert.ok(s.ok && Math.abs(s.k - 1.5) < 0.05);
});
