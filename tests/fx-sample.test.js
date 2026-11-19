// 计划 3（dr-calc-base）Task 3：实数取点判函数式相等
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormula, formulaSpec, compareFormula } from '../kit/src/formula.js';
import { parseDomain, samplePoints, compareFx } from '../kit/src/fx/sample.js';

// answer 组件判一道题的样子：formulaSpec → 照输入框读学生的字 → compareFormula
function cmp(answer, student, domain = '', free = 'x') {
  const spec = formulaSpec(answer, free, {}, { domain });
  return compareFormula(spec.expected, normalizeFormula(student, spec.read), spec);
}

test('等价的写法都对', () => {
  assert.equal(cmp('2*sin(x)*cos(x)', 'sin 2x').ok, true);
  assert.equal(cmp('ln(1+x)', 'ln(x+1)').ok, true);
  assert.equal(cmp('x*e^x - e^x', '(x-1)e^x').ok, true);
  assert.equal(cmp('1/(1+x^2)', '1/(x^2+1)').ok, true);
  assert.equal(cmp('x*e^x - e^x', 'xe^x').ok, false);
});

test('定义域：外部写的范围为准', () => {
  const r = cmp('ln(abs(x))', 'ln x');
  assert.equal(r.ok, false);
  assert.match(r.msg, /没有定义/);
  assert.equal(cmp('ln(abs(x))', 'ln x', 'x in (0, 3)').ok, true);
  assert.equal(cmp('x', 'sqrt(x^2)').ok, false);
  assert.equal(cmp('x', 'sqrt(x^2)', 'x in (0, 3)').ok, true);
});

test('取到 16 个有效点：只在一部分有定义的答案照样判得出（审的必改 3）', () => {
  for (const [ans, right, wrong] of [['ln(x)', 'ln x', 'ln(x+1)'], ['arcsin(x)', 'arcsin x', 'arccos x'], ['sqrt(1-x^2)', '√(1-x^2)', '1-x^2']]) {
    assert.equal(cmp(ans, right).ok, true, ans);
    assert.equal(cmp(ans, wrong).ok, false, `${ans} 对 ${wrong}`);
  }
  const spec = formulaSpec('arcsin(x)', 'x');
  assert.equal(compareFx(spec.expected, 'arcsin(x)', spec).checked, 16);
});

test('跳过两边都没定义的点', () => { assert.equal(cmp('sin(x)/x', 'sinx/x').ok, true); });
test('大数按相对误差', () => { assert.equal(compareFx('e^(5*x)', 'e^(5*x)*(1+10^(-12))', { domain: parseDomain('x in (0, 3)') }).ok, true); });
test('靠近奇点的点跳过', () => { assert.equal(cmp('tan(x)', 'sin x/cos x', 'x in (1.5, 1.6)').ok, true); });
test('取不到 6 个点就判不了，不当成对', () => {
  const r = compareFx('sqrt(x-2.999)', 'sqrt(x-2.999)', { domain: parseDomain('x in (-3, 3)') });
  assert.equal(r.ok, null);
});
test('同一道题每次取一样的点', () => {
  const d = parseDomain('x in (0,1)');
  assert.deepEqual(samplePoints(d, { seed: 'q1' }), samplePoints(d, { seed: 'q1' }));
  assert.notDeepEqual(samplePoints(d, { seed: 'q1' }), samplePoints(d, { seed: 'q2' }));
});
test('奇数次方根取实数', () => { assert.equal(cmp('-(abs(x))^(1/3)', 'x^(1/3)', 'x in (-9, -1)').ok, true); });
test('无穷区间', () => {
  const d = parseDomain('x in (0, inf)');
  const { points } = samplePoints(d, { seed: 's' });
  assert.ok(points.every((p) => p.x > 0) && points.some((p) => p.x > 3));
  assert.equal(cmp('ln(x)', 'ln x', 'x in (0, inf)').ok, true);
  assert.throws(() => parseDomain('x in (1, 0)'), /写反/);
});
test('几个变量', () => {
  assert.equal(cmp('x*y', 'xy', '', 'x, y').ok, true);
  assert.equal(cmp('a*x', 'ax', '', 'x in (0, 1), a in (1, 3)').ok, true);
});
test('formula: n 照旧整数；x 按实数；题里有矩阵的 x 照旧整数', () => {
  assert.equal(formulaSpec('3^(n-1)', 'n').real, undefined);
  assert.equal(formulaSpec('ln(1+x)', 'x').real, true);
  assert.equal(formulaSpec('-3*x', 'x', { A: [[1, 0], [0, 1]] }).real, undefined);
  assert.equal(formulaSpec('det([[2,0],[0,x]])', 'x').real, undefined);
  assert.equal(formulaSpec('x^2', 'x=1..5').real, undefined);
});
test('整数取点时对不上全是因为没定义：判不了；有值对不上照旧判错', () => {
  const s = formulaSpec('ln(n)', 'n=1..4');
  assert.equal(compareFormula(s.expected, normalizeFormula('ln(n-1)+ln(n)-ln(n-1)', { names: ['n'] }), s).ok, null);
  assert.equal(compareFormula(s.expected, normalizeFormula('ln(n-1)', { names: ['n'] }), s).ok, false);
});
test('学生实数题里写 e^2x 读不了（读法在输入框那一步就说）', () => {
  const spec = formulaSpec('e^(2*x)', 'x');
  assert.throws(() => normalizeFormula('e^2x', spec.read), /指数写不清/);
});
