// 计划 3（dr-calc-base）Task 5：数值积分（含反常积分、二重积分）
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../kit/src/expr.js';
import { numIntegral, numIntegral2 } from '../kit/src/fx/integral.js';

const F = (src) => { const f = compile(src); return (x) => f({ x }); };
const near = (r, want, tol = 1e-8) => { assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(Math.abs(r.value - want) <= tol * Math.max(1, Math.abs(want)), `${r.value} ≠ ${want}`); };

test('定积分', () => { near(numIntegral(F('x*e^x'), 0, 1), 1); near(numIntegral(F('sin(x)'), 0, Math.PI), 2); near(numIntegral(F('x^2'), 1, 0), -1 / 3); });
test('端点可积的奇点', () => { near(numIntegral(F('1/sqrt(x)'), 0, 1), 2); near(numIntegral(F('ln(x)'), 0, 1), -1); });
test('反常积分', () => {
  near(numIntegral(F('e^(-x^2)'), -Infinity, Infinity), Math.sqrt(Math.PI));
  near(numIntegral(F('1/(1+x^2)'), 0, Infinity), Math.PI / 2);
});
test('发散、积不出来的判不了', () => {
  assert.equal(numIntegral(F('1/x'), 0, 1).ok, null);
  assert.equal(numIntegral(F('e^(-2*x)'), -Infinity, 0).ok, null);
});
test('二重积分：X、Y 独立同 E(1)，P(X<Y) = 1/2', () => {
  near(numIntegral2((x, y) => Math.exp(-x) * Math.exp(-y), [0, Infinity], [(x) => x, () => Infinity]), 0.5, 1e-7);
  near(numIntegral2((x, y) => x * y, [0, 1], [() => 0, (x) => x]), 1 / 8, 1e-9);
});
