// 计划 3（dr-calc-base）Task 6：calc: 字段（任务书的验收三道 + 审的必改 1、2，必加 8、9、10）
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormula, formulaSpec, compareFormula } from '../kit/src/formula.js';
import { parseCalc, calcSelfCheck, stripTail } from '../kit/src/fx/calc.js';
import { polyCoeffs, taylorCoeffs } from '../kit/src/fx/taylor.js';
import { parse } from '../kit/src/expr.js';

// 照 answer 组件：formulaSpec(answer, formula, {}, { calc })，学生的字照输入框读好再判
const spec = (f) => formulaSpec(f.answer, f.formula, {}, { calc: f.calc, domain: f.domain });
const judge = (s, text) => compareFormula(s.expected, normalizeFormula(text, s.read), s);

const anti = spec({ answer: 'x*e^x - e^x', calc: 'antideriv of=x*e^x' });
test('验收：求 ∫ x e^x dx', () => {
  assert.equal(judge(anti, 'xe^x-e^x+C').ok, true);
  assert.equal(judge(anti, 'xe^x+e^x+C').ok, false);
  assert.equal(judge(anti, 'xe^x+e^x').ok, false);
  const r = judge(anti, 'xe^x-e^x');
  assert.equal(r.ok, false);
  assert.equal(r.msg, '少写了 +C');
  assert.equal(judge(spec({ answer: 'x*e^x - e^x', calc: 'antideriv of=x*e^x C=any' }), 'xe^x-e^x').ok, true);
  assert.equal(judge(spec({ answer: 'x*e^x - e^x', calc: 'antideriv of=x*e^x C=no' }), 'xe^x-e^x+C').ok, false);
});
test('各种 +C 都认', () => { for (const s of ['xe^x-e^x + c', 'xe^x-e^x+C_1', 'C+xe^x-e^x', '(x-1)e^x+C', 'xe^x - e^x + 5 + C']) assert.equal(judge(anti, s).ok, true, s); });
test('外部的答案写错了自检报出来', () => {
  assert.throws(() => spec({ answer: 'x*e^x + e^x', calc: 'antideriv of=x*e^x' }), /求导以后不等于/);
  assert.throws(() => spec({ answer: '1/3', calc: 'limit of=(tan(x)-sin(x))/x^3 at=0' }), /页面算这个极限得 0.5/);
  assert.throws(() => spec({ answer: 'x - x^2/2 + x^3/2', calc: 'taylor of=ln(1+x) at=0 order=3' }), /系数和页面算的不一样/);
});

const lim = spec({ answer: '1/2', calc: 'limit of=(tan(x)-sin(x))/x^3 at=0' });
test('验收：lim (tan x − sin x)/x³ = 1/2', () => {
  assert.equal(judge(lim, '1/2').ok, true);
  assert.equal(judge(lim, '0.5').ok, true);
  assert.equal(judge(lim, '0').ok, false);
  assert.equal(judge(lim, '∞').ok, false);
});

const tay = spec({ answer: 'x - x^2/2 + x^3/3', calc: 'taylor of=ln(1+x) at=0 order=3' });
test('验收：ln(1+x) 展开到 x³', () => {
  assert.equal(judge(tay, 'x-x^2/2+x^3/3').ok, true);
  assert.equal(judge(tay, 'x-x^2/2+x^3/3+o(x^3)').ok, true);
  const r = judge(tay, 'x+x^2/2+x^3/3');
  assert.equal(r.ok, false);
  assert.deepEqual(r.bad.map((b) => b.k), [2]);
  assert.match(r.msg, /系数/);
  assert.match(judge(tay, 'x-x^2/2+x^3/3-x^4/4').msg, /以上的项不判/);
  assert.equal(judge(tay, 'ln(1+x)').ok, false); // 要写成多项式
});
test('泰勒：系数不是有理数，自检说页面判不了', () => {
  assert.throws(() => spec({ answer: 'e + e*(x-1)', calc: 'taylor of=e^x at=1 order=1' }), /不是有理数/);
});
test('泰勒：在别的点展开', () => {
  const s = spec({ answer: '(x-1) - (x-1)^2/2', calc: 'taylor of=ln(x) at=1 order=2' });
  assert.equal(judge(s, '(x-1)-(x-1)^2/2').ok, true);
  assert.equal(judge(s, '-3/2 + 2x - x^2/2').ok, true); // 展开写也对
});

test('极限：无穷和不存在（审的必改 2 的表）', () => {
  const pinf = spec({ answer: '+inf', calc: 'limit of=1/x^2 at=0' });
  assert.equal(judge(pinf, '+∞').ok, true);
  const r = judge(pinf, '∞');
  assert.equal(r.ok, true);
  assert.match(r.msg, /\+∞ 更准确/);
  assert.equal(judge(pinf, '-∞').ok, false);
  const inf = spec({ answer: 'inf', calc: 'limit of=1/x at=0' });
  assert.equal(judge(inf, '∞').ok, true);
  assert.match(judge(inf, '不存在').msg, /更准确是 ∞/);
  assert.equal(judge(inf, '+∞').ok, false);
  const none = spec({ answer: '不存在', calc: 'limit of=abs(x)/x at=0' });
  assert.equal(judge(none, '不存在').ok, true);
  assert.equal(judge(none, '∞').ok, false);
  assert.equal(judge(none, '0').ok, false);
});
test('极限：x→∞ 两侧（审的必改 1）', () => {
  assert.throws(() => spec({ answer: 'pi/2', calc: 'limit of=arctan(x) at=inf' }), /不存在/);
  assert.equal(judge(spec({ answer: 'pi/2', calc: 'limit of=arctan(x) at=+inf' }), 'π/2').ok, true);
  assert.equal(judge(spec({ answer: 'e', calc: 'limit of=(1+1/x)^x at=inf' }), 'e').ok, true);
});
test('判不了的不当成对；学生的照外部的答案判', () => {
  const s = spec({ answer: '0', calc: 'limit of=x*sin(1/x) at=0' });
  assert.ok(s.hints.length);
  assert.equal(judge(s, '0').ok, true);
});

test('导数：二阶、偏导（必加 8）', () => {
  assert.equal(judge(spec({ answer: '-sin(x)', calc: 'deriv of=sin(x) order=2' }), '-sinx').ok, true);
  const p = spec({ answer: 'x^2', calc: 'deriv of=x^2*y + sin(x) wrt=y' });
  assert.equal(judge(p, 'x^2').ok, true);
  assert.equal(judge(p, '2xy+cosx').ok, false); // 这是对 x 的偏导
  assert.throws(() => spec({ answer: '2*x*y', calc: 'deriv of=x^2*y + sin(x) wrt=y' }), /导数对不上/);
  assert.equal(judge(spec({ answer: '2*x', calc: 'deriv of=x^2*y wrt=x,y' }), '2x').ok, true);
});
test('n 阶导的通式（必加 9）', () => {
  const s = spec({ answer: '(-1)^(n-1)*fact(n-1)/(1+x)^n', calc: 'deriv of=ln(1+x) order=n' });
  assert.equal(judge(s, '(-1)^(n-1)(n-1)!/(1+x)^n').ok, true);
  assert.equal(judge(s, '(-1)^n(n-1)!/(1+x)^n').ok, false);
  const at0 = spec({ answer: '(-1)^(n-1)*fact(n-1)', calc: 'deriv of=ln(1+x) order=n at=0' });
  assert.equal(judge(at0, '(-1)^(n-1)(n-1)!').ok, true);
});
test('阶：可以是分数（必加 10）', () => {
  assert.equal(judge(spec({ answer: '3', calc: 'order of=tan(x)-sin(x) at=0' }), '3').ok, true);
  assert.equal(judge(spec({ answer: '3/2', calc: 'order of=x^(3/2)+x^2 at=0' }), '3/2').ok, true);
  assert.throws(() => spec({ answer: '2', calc: 'order of=tan(x)-sin(x) at=0' }), /3 阶/);
});
test('等价无穷小', () => {
  const s = spec({ answer: 'x^3/2', calc: 'equiv of=tan(x)-sin(x) at=0' });
  assert.equal(judge(s, 'x^3/2').ok, true);
  assert.equal(judge(s, 'sin(x)^3/2').ok, true);
  assert.equal(judge(s, 'x^3').ok, false);
});
test('定积分、反常积分', () => {
  assert.equal(judge(spec({ answer: 'sqrt(pi)', calc: 'integral of=e^(-x^2) from=-inf to=inf' }), '√π').ok, true);
  assert.equal(judge(spec({ answer: '1', calc: 'integral of=x*e^x from=0 to=1' }), '1').ok, true);
  assert.throws(() => spec({ answer: '2', calc: 'integral of=x*e^x from=0 to=1' }), /页面算这个积分得 1/);
  const div = spec({ answer: '发散', calc: 'integral of=1/x from=0 to=1' });
  assert.equal(judge(div, '发散').ok, true);
  assert.equal(judge(div, '0').ok, false);
});
test('只写 calc: 就够（第五节第 2 条）', () => {
  assert.equal(spec({ answer: 'cos(x)', calc: 'deriv of=sin(x)' }).real, true);
  assert.equal(spec({ answer: '1/2', calc: 'limit of=(1-cos(x))/x^2 at=0' }).free.length, 0);
});
test('数列极限', () => {
  assert.equal(judge(spec({ answer: 'e', calc: 'limit of=(1+1/n)^n at=inf' }), 'e').ok, true);
  assert.ok(spec({ answer: '0', calc: 'limit of=fact(n)/n^n at=inf' }).hints.join().includes('数列极限'));
});
test('calc: 写错照实说', () => {
  assert.throws(() => parseCalc('lmit of=x at=0'), /calc: 能写/);
  assert.throws(() => parseCalc('limit of=x'), /要写 at=/);
  assert.throws(() => parseCalc('antideriv of=x C=maybe'), /C=/);
});
test('stripTail 和多项式系数', () => {
  assert.equal(stripTail(parse('x + C'), { kind: 'antideriv' }).hadC, true);
  assert.equal(stripTail(parse('x + C'), { kind: 'antideriv', scope: { C: 1 } }).hadC, false);
  assert.deepEqual(polyCoeffs('x - x^2/2').map(String), ['0', '1', '-1/2']);
  assert.deepEqual(taylorCoeffs('sin(x)/x', 'x', 0, 2).map(String), ['1', '0', '-1/6']);
});
test('自检有时间上限', () => {
  const s = spec({ answer: '1/2', calc: 'limit of=(tan(x)-sin(x))/x^3 at=0' });
  assert.ok(calcSelfCheck(s, { budget: 2000 }).errors.length === 0);
});
