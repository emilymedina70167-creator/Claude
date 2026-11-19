// 计划 3（dr-calc-base）Task 4：符号求导。求出来的导数和中心差分在几个点上比
import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, evaluate } from '../kit/src/expr.js';
import { diffAst } from '../kit/src/fx/diff.js';
import { fxEval } from '../kit/src/fx/sample.js';

function numDiff(src, x, v = 'x', h = 1e-5) {
  const f = (t) => evaluate(src, { x: 0.6, y: 0.4, [v]: t });
  return (f(x + h) - f(x - h)) / (2 * h);
}
function near(ast, src, xs = [0.3, 0.7, 1.4], v = 'x') {
  for (const x of xs) {
    const a = evaluate(ast, { x: 0.6, y: 0.4, [v]: x }), b = numDiff(src, x, v);
    assert.ok(Math.abs(a - b) < 1e-5 * Math.max(1, Math.abs(b)), `${src} 在 ${v}=${x}：求出 ${a}，差分 ${b}`);
  }
}

for (const f of ['x^3', 'sin(x)*x^2', 'e^(2*x)*cos(x)', 'ln(1+x^2)', 'arctan(x)', 'x^x', 'sqrt(1+x)', 'tan(x)/x', 'abs(x)*x',
  'log(x, 2)', 'arcsin(x/2)', 'arccos(x/2)', 'cot(x)', 'sec(x)', 'csc(x)', 'lg(x)', 'exp(x^2)', 'Phi(x)', 'phi(x)', '2^x', '(x>1)*x^2', '1/(1+x)^3'])
  test(`导数：${f}`, () => near(diffAst(parse(f)), f));

test('高阶导和中心差分对得上（二阶）', () => {
  const f = 'sin(x)*e^x';
  const d2 = diffAst(f, 'x', 2);
  for (const x of [0.2, 0.9]) {
    const h = 1e-4, g = (t) => evaluate(f, { x: t });
    const num = (g(x + h) - 2 * g(x) + g(x - h)) / (h * h);
    assert.ok(Math.abs(evaluate(d2, { x }) - num) < 1e-5);
  }
});
test('三阶导不膨胀', () => { assert.ok(JSON.stringify(diffAst(parse('sin(x)*e^x'), 'x', 3)).length < 6000); });
test('偏导', () => { near(diffAst('x^2*y + sin(y)', 'y'), 'x^2*y + sin(y)', [0.3, 0.8], 'y'); });
test('int(g) 的导数是 g', () => {
  const d = diffAst('x*e^x - int(e^x)');
  for (const x of [0.5, 1.2]) assert.ok(Math.abs(evaluate(d, { x }) - x * Math.exp(x)) < 1e-12);
});
test('变限积分：莱布尼茨', () => {
  const d = diffAst('int(sin(t), t, 0, x^2)');
  for (const x of [0.5, 1.2]) assert.ok(Math.abs(evaluate(d, { x }) - 2 * x * Math.sin(x * x)) < 1e-12);
  assert.throws(() => diffAst('int(x*t, t, 0, x)'), /求不了导/);
});
test('求不了导的照实说', () => {
  assert.throws(() => diffAst('rank(x)'), /求不了导/);
  assert.equal(evaluate(diffAst('det(A)*x'), { A: [[1, 2], [3, 4]], x: 1 }), -2); // det(A) 不含 x，是常数
  assert.throws(() => diffAst('fact(x)'), /求不了导/);
});
test("实数题里 ' 是求导", () => {
  const v = fxEval(parse("(x^2*sin(x))'"), { x: 1 });
  assert.ok(Math.abs(v - (2 * Math.sin(1) + Math.cos(1))) < 1e-12);
  assert.ok(Math.abs(fxEval(parse("(t^3)''"), { t: 2 }) - 12) < 1e-12);
});
