// 计划 3（dr-calc-base）Task 9、9b：二重积分、级数求和、微分方程通解（审的必加 11、12）
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormula, formulaSpec, compareFormula } from '../kit/src/formula.js';

const spec = (f) => formulaSpec(f.answer, f.formula, {}, { calc: f.calc, domain: f.domain });
const judge = (s, text) => compareFormula(s.expected, normalizeFormula(text, s.read), s);

test('二重积分：只核外部的答案', () => {
  const s = spec({ answer: '1/2', calc: 'integral2 of=e^(-x)*e^(-y) x=0..inf y=x..inf' });
  assert.equal(judge(s, '1/2').ok, true);
  assert.equal(judge(s, '1/3').ok, false);
  assert.throws(() => spec({ answer: '1/3', calc: 'integral2 of=e^(-x)*e^(-y) x=0..inf y=x..inf' }), /二重积分得 0.5/);
  assert.throws(() => spec({ answer: '1/6', calc: 'integral2 of=x*y x=0..1 y=0..x' }), /0.125/);
});
test('级数求和：和函数', () => {
  const s = spec({ answer: '-ln(1-x)', formula: 'x in (-0.8, 0.8)', calc: 'sum of=x^n/n n=1..inf' });
  assert.equal(judge(s, '-ln(1-x)').ok, true);
  assert.equal(judge(s, 'ln(1+x)').ok, false);
  assert.throws(() => spec({ answer: 'ln(1+x)', formula: 'x in (-0.8, 0.8)', calc: 'sum of=x^n/n n=1..inf' }), /和级数对不上/);
});
test('级数求和：数项级数', () => {
  const s = spec({ answer: 'pi^2/6', calc: 'sum of=1/n^2 n=1..inf' });
  assert.ok(s.hints.length); // 1/n² 收敛太慢，5000 项也没到 1e-14：页面核不了，提醒
  assert.equal(judge(s, 'π^2/6').ok, true);
});
test('级数求和：收敛快的数项级数核得出来', () => {
  assert.equal(spec({ answer: '2', calc: 'sum of=1/2^n n=0..inf' }).hints.length, 0);
  assert.throws(() => spec({ answer: '3', calc: 'sum of=1/2^n n=0..inf' }), /页面加这个级数得 2/);
});
test('微分方程通解（必加 12）', () => {
  const s = spec({ answer: 'C_1*e^x + C_2*e^(2*x)', calc: "ode eq=y''-3y'+2y=0" });
  assert.equal(judge(s, 'C_1 e^x + C_2 e^{2x}').ok, true);
  assert.equal(judge(s, 'C1 e^{x+1} + C2 e^{2x}').ok, true); // 常数换写法也对
  const one = judge(s, 'C_1 e^x');
  assert.equal(one.ok, false);
  assert.match(one.msg, /2 个独立常数/);
  assert.match(judge(s, 'C_1 e^x + C_2 e^x').msg, /不独立/);
  assert.match(judge(s, 'C_1 e^x + C_2 e^{3x}').msg, /不成立/);
  assert.throws(() => spec({ answer: 'C_1*e^x + C_2*e^(3*x)', calc: "ode eq=y''-3y'+2y=0" }), /不满足方程/);
});
test('微分方程：非齐次、一阶', () => {
  const s = spec({ answer: 'C*e^(-x) + x - 1', calc: "ode eq=y'+y=x" });
  assert.equal(judge(s, 'Ce^{-x} + x - 1').ok, true);
  assert.equal(judge(s, 'Ce^{-x} + x').ok, false);
});
