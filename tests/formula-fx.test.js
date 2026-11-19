// 计划 3（dr-calc-base）Task 2：学生写初等函数。读成的式子按值比（x = 0.7、1.3），不比字符串
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormula, formulaTeX } from '../kit/src/formula.js';
import { evaluate } from '../kit/src/expr.js';

const R = { names: ['x'], real: true };
function near(student, want, vars = [{ x: 0.7 }, { x: 1.3 }], opts = R) {
  const got = normalizeFormula(student, opts);
  for (const v of vars) {
    const a = evaluate(got, v), b = evaluate(want, v);
    if (Number.isNaN(a) && Number.isNaN(b)) continue;
    assert.ok(Math.abs(a - b) < 1e-12, `「${student}」读成 ${got}，x=${v.x} 得 ${a}，应该是 ${b}`);
  }
}

const CASES = [
  ['sinx', 'sin(x)'], ['sin x', 'sin(x)'], ['sin(x)', 'sin(x)'], ['sin 2x', 'sin(2*x)'], ['sin x^2', 'sin(x^2)'],
  ['sin πx', 'sin(pi*x)'], ['sin 2πx', 'sin(2*pi*x)'], ['sin -x', 'sin(-x)'],
  ['sinx cosx', 'sin(x)*cos(x)'], ['sinxcosx', 'sin(x)*cos(x)'], ['2sinxcosx', '2*sin(x)*cos(x)'], ['sin^2 x', 'sin(x)^2'], ['sin^2(x)', 'sin(x)^2'],
  ['sinx/x', 'sin(x)/x'], ['sin x e^x', 'sin(x)*e^x'], ['sinx·x', 'sin(x)*x'], ['sin x + 1', 'sin(x)+1'],
  ['e^{2x}', 'e^(2*x)'], ['e^(2x)', 'e^(2*x)'], ['xe^x', 'x*e^x'], ['e^-x', 'e^(-x)'], ['e^x', 'e^x'], ['e^2', 'e^2'], ['x^-1', 'x^(-1)'],
  ['ln(1+x)', 'ln(1+x)'], ['x lnx', 'x*ln(x)'], ['(x+1)lnx', '(x+1)*ln(x)'], ['ln|x|', 'ln(abs(x))'], ['arctanx', 'atan(x)'.replace('atan', 'arctan')],
  ['x^(1/2)', 'sqrt(x)'], ['√x', 'sqrt(x)'], ['√(1-x^2)', 'sqrt(1-x^2)'], ['sqrt x', 'sqrt(x)'],
  ['log_2 x', 'log(x, 2)'], ['log_2(x)', 'log(x, 2)'], ['log_{2}x', 'log(x, 2)'], ['lg x', 'lg(x)'],
  ['πx', 'pi*x'], ['|x|', 'abs(x)'], ['|x-1||x+1|', 'abs(x-1)*abs(x+1)'], ['2|x|', '2*abs(x)'], ['Φ(x)', 'Phi(x)'], ['φ(x)', 'phi(x)'],
  ['tanx - sinx', 'tan(x)-sin(x)'], ['sec^2 x', '1/cos(x)^2'], ['e^x sin x', 'e^x*sin(x)'], ['x^2sinx', 'x^2*sin(x)'],
];
test('初等函数的写法', () => { for (const [a, b] of CASES) near(a, b); });

test('n! 和 C(n,k)', () => {
  assert.equal(evaluate(normalizeFormula('n!', { names: ['n'] }), { n: 5 }), 120);
  assert.equal(evaluate(normalizeFormula('C(5,2)', { names: [] })), 10);
  assert.throws(() => normalizeFormula('C(5)', { names: [] }), /C\(n, k\)/);
});

test('读不准的不读，照实说', () => {
  assert.throws(() => normalizeFormula('log x', R), /ln x、lg x 或 log_2 x/);
  assert.throws(() => normalizeFormula('sin^-1 x', R), /arcsin/);
  assert.throws(() => normalizeFormula('e^2x', R), /指数写不清/);
  assert.throws(() => normalizeFormula('e^-2x', R), /指数写不清/);
  assert.throws(() => normalizeFormula('x^2y', { names: ['x', 'y'], real: true }), /指数写不清/);
  assert.throws(() => normalizeFormula('sin xy', { names: ['x', 'y'], real: true }), /sin\(xy\)/);
  assert.throws(() => normalizeFormula('||x|-1|', R), /嵌套/);
});
test('整数取点的题里 e^2n 照旧读（不收的只在实数题）', () => {
  assert.equal(evaluate(normalizeFormula('2^2n', { names: ['n'] }), { n: 3 }), 12);
});

test('题里定义了 e、φ 就照题里的', () => {
  assert.deepEqual(evaluate(normalizeFormula('2e', { names: ['e'] }), { e: [1, 2] }), [2, 4]);
  assert.equal(evaluate(normalizeFormula('2φ', { names: ['phi'] }), { phi: 3 }), 6);
  assert.ok(Math.abs(evaluate(normalizeFormula('2e', { names: [] })) - 2 * Math.E) < 1e-12);
});

test('无穷、不存在、发散', () => {
  assert.equal(normalizeFormula('∞', { names: [] }), 'inf');
  assert.equal(evaluate(normalizeFormula('+∞', { names: [] })), Infinity);
  assert.equal(evaluate(normalizeFormula('-∞', { names: [] })), -Infinity);
  assert.equal(normalizeFormula('不存在', { names: [] }), '__dne');
  assert.equal(normalizeFormula('DNE', { names: [] }), '__dne');
  assert.equal(normalizeFormula('发散', { names: [] }), '__div');
});

test('线代、计算机的读法不变', () => {
  const T = (s, names) => normalizeFormula(s, { names });
  assert.equal(evaluate(T('trA^2', ['A']), { A: [[1, 2], [3, 4]] }), 25); // tr(A)^2，不是 tr(A^2)
  assert.equal(evaluate(T('3^(n-1)A', ['n', 'A']), { n: 2, A: 1 }), 3);
  assert.equal(evaluate(T('n(n-1)/2', ['n']), { n: 4 }), 6);
});

test('预览：函数的参数都画括号', () => {
  const t = (s) => formulaTeX(normalizeFormula(s, R));
  assert.match(t('sin 2x'), /\\sin\\left\(2/);
  assert.match(t('e^{2x}'), /e\}?\^\{2/);
  assert.match(t('ln|x|'), /\\ln\\left\(\\left\|x\\right\|\\right\)/);
  assert.match(t('log_2 x'), /\\log_\{2\}/);
  assert.match(formulaTeX(normalizeFormula('n!', { names: ['n'] })), /n\s*!/);
  assert.match(formulaTeX(normalizeFormula('C(5,2)', { names: [] })), /\\binom\{5\}\{2\}/);
  assert.match(formulaTeX('pi*x'), /\\pi/);
  assert.match(formulaTeX('inf'), /\\infty/);
  assert.match(formulaTeX('__dne'), /不存在/);
});
