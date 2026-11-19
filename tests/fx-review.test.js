// 计划 3（dr-calc-base）整体审查查出来的十条：每条照审查报告里的输入写一条，不许回来
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormula, formulaSpec, compareFormula, compareCells, matrixCells } from '../kit/src/formula.js';
import { compile } from '../kit/src/expr.js';
import { calcValue, Q } from '../kit/src/exact.js';
import { numLimit } from '../kit/src/fx/limit.js';

const spec = (f, scope = {}) => formulaSpec(f.answer, f.formula, scope, { calc: f.calc, domain: f.domain });
const judge = (s, text) => compareFormula(s.expected, normalizeFormula(text, s.read), s);

test('1. 题里 let 的常数不当成自变量', () => {
  const s = spec({ answer: '6*x', calc: 'deriv of=a*x^2' }, { a: Q.int(3) });
  assert.equal(judge(s, '6x').ok, true);
  const k = spec({ answer: 'x^2', calc: 'antideriv of=k*x' }, { k: Q.int(2) });
  assert.equal(judge(k, 'x^2+C').ok, true);
});
test("2. 学生把题目抄一遍加一撇不算对", () => {
  assert.equal(judge(spec({ answer: '3*x^2', calc: 'deriv of=x^3' }), "(x^3)'").ok, false);
  assert.equal(judge(spec({ answer: '3*x^2', formula: 'x' }), "(x^3)'").ok, false);
});
test('3. 计算机课的 formula: x 照旧（fact、mod、choose 整数取点；实数取不到点退回整数）', () => {
  assert.doesNotThrow(() => spec({ answer: 'fact(x)', formula: 'x' }));
  assert.doesNotThrow(() => spec({ answer: 'mod(x, 3)', formula: 'x' }));
  const c = spec({ answer: 'choose(x, 2)', formula: 'x' });
  assert.equal(compareFormula(c.expected, normalizeFormula('x(x-1)/2', c.read), c).ok, true);
  const l = spec({ answer: 'ln(x-3)', formula: 'x' }); // (−3, 3) 上没定义：退回整数 1…6
  assert.equal(l.real, undefined);
});
test('4. 整数取点：一组都对不上时不说「别的取值都对得上」，照旧判错', () => {
  const s = spec({ answer: 'n', formula: 'n' });
  assert.equal(compareFormula(s.expected, normalizeFormula('sqrt(-n)', s.read), s).ok, false);
});
test('5. 泰勒：学生写阶乘照样对', () => {
  const s = spec({ answer: 'x - x^3/6', calc: 'taylor of=sin(x) at=0 order=3' });
  assert.equal(judge(s, 'x - x^3/3! + o(x^3)').ok, true);
  const e = spec({ answer: '1 + x + x^2/2', calc: 'taylor of=e^x at=0 order=2' });
  assert.equal(judge(e, '1+x+x^2/2!').ok, true);
});
test('6. 老师写 ∞、页面算出来是 +∞：学生写 +∞ 也对', () => {
  const s = spec({ answer: 'inf', calc: 'limit of=1/x^2 at=0' });
  assert.equal(judge(s, '+∞').ok, true);
  assert.equal(judge(s, '∞').ok, true);
  assert.equal(judge(spec({ answer: 'inf', calc: 'limit of=1/x at=0' }), '+∞').ok, false); // 真的是无符号的 ∞
});
test('7. 按格的矩阵答案配实数范围：不报英文错误', () => {
  const s = spec({ answer: '[[x, x^2], [1, sin(x)]]', formula: 'x in (0, 1)' });
  const cells = matrixCells(s.expected);
  const given = [['x', 'x^2'], ['1', 'sin(x)']].map((r) => r.map((t) => normalizeFormula(t, s.read)));
  assert.equal(compareCells(cells, given, s).ok, true);
  given[1][1] = normalizeFormula('cos(x)', s.read);
  assert.equal(compareCells(cells, given, s).ok, false);
});
test('8. 趋向一个大的有限数不当成无穷', () => {
  const f = compile('1500*(x-5)/x');
  const r = numLimit((x) => f({ x }), '+inf');
  assert.equal(r.kind, 'finite');
  assert.ok(Math.abs(r.value - 1500) < 1e-6);
  assert.doesNotThrow(() => spec({ answer: '1500', calc: 'limit of=1500*(x-5)/x at=+inf' }));
  // 真的无穷照旧认得出
  assert.equal(numLimit((x) => 1 / x, 0).kind, 'inf');
  assert.equal(numLimit((x) => Math.exp(1 / x), 0, { side: '+' }).kind, '+inf');
});
test('9. deriv at=（不配 order=n）：这一点的导数是一个数', () => {
  const s = spec({ answer: '12', calc: 'deriv of=x^3 at=2' });
  assert.equal(judge(s, '12').ok, true);
  assert.equal(judge(s, '8').ok, false);
  assert.throws(() => spec({ answer: '8', calc: 'deriv of=x^3 at=2' }), /这一点的导数得 12/);
});
test('10. 双阶乘不读成两次阶乘', () => {
  assert.throws(() => normalizeFormula('(2n-1)!!', { names: ['n'] }), /双阶乘/);
});
test('附带：精确计算里 |x| 写在数上是绝对值', () => {
  assert.equal(calcValue('norm(-3)').text, '3');
});
