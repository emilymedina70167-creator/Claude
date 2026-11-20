// 计划 3 验收以后的修正（dev_requests/dr-calc-fix）：外部用真实考研写法探出来的 7 处 + 两处顺手的，每条一组回归
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormula, formulaSpec, compareFormula } from '../kit/src/formula.js';
import { evaluate } from '../kit/src/expr.js';
import { parseDeriveDo, sampleEnvs, checkLine } from '../kit/src/derivedo.js';
import { parseCalc } from '../kit/src/fx/calc.js';
import { deriveDoProblems } from '../tools/ext-lint.js';

const R = { names: ['x'], real: true };
const val = (s, x = 0.7, opts = R) => evaluate(normalizeFormula(s, opts), { x });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);
const spec = (f) => formulaSpec(f.answer, f.formula, {}, { calc: f.calc, domain: f.domain });
const judge = (s, text) => compareFormula(s.expected, normalizeFormula(text, s.read), s);
function chain(src, lines) {
  const sp = parseDeriveDo(src);
  const envs = sampleEnvs(sp);
  let prev = sp.start, state = {};
  return lines.map((l) => {
    const r = checkLine(sp, envs, prev, l, state);
    if (r.ctx) state = { ctx: r.ctx };
    if (r.ok === true && !r.note) prev = l;
    return r;
  });
}

test('1. 函数的幂不带空格：sin^2x、cos^3x、tan^2x、sec^2x、cos^3 2x', () => {
  near(val('sin^2x'), Math.sin(0.7) ** 2);
  near(val('cos^3x'), Math.cos(0.7) ** 3);
  near(val('tan^2x'), Math.tan(0.7) ** 2);
  near(val('sec^2x'), 1 / Math.cos(0.7) ** 2);
  near(val('cos^3 2x'), Math.cos(1.4) ** 3);
  near(val('sin^2x+cos^2x'), 1);
  assert.equal(judge(spec({ answer: '-cos(x)+cos(x)^3/3', calc: 'antideriv of=sin(x)^3' }), '-cosx+cos^3x/3+C').ok, true);
  const rs = chain('mode: do\ncalc: limit at=0\nstart: (1-cos(x)^3)/(3*x^2)', ['(1-cos^3x)/(3x^2)']);
  assert.equal(rs[0].ok, true);
});

test('2. x^2e^x、x^3e^{2x}：指数到数字为止，后面的 e^ 是新的因子；C_1cos2x', () => {
  near(val('x^2e^x'), 0.49 * Math.exp(0.7));
  near(val('x^3e^{2x}'), 0.343 * Math.exp(1.4));
  assert.equal(judge(spec({ answer: 'x^2*e^x-2*x*e^x+2*e^x', calc: 'antideriv of=x^2*e^x' }), 'x^2e^x-2xe^x+2e^x+C').ok, true);
  const ode = spec({ answer: 'C_1*cos(2*x)+C_2*sin(2*x)', calc: "ode eq=y''+4y=0" });
  assert.equal(judge(ode, 'C_1cos2x+C_2sin2x').ok, true);
  assert.throws(() => normalizeFormula('x^2y', { names: ['x', 'y'], real: true }), /指数写不清/); // 普通变量照旧不收
  assert.throws(() => normalizeFormula('log2(x)', { names: ['x'] }), /不认识「log2」/); // 计算机课的 log2 照旧不认
});

test('3. 不收的话照学生写的说', () => {
  assert.throws(() => normalizeFormula('x^2y', { names: ['x', 'y'], real: true }), /写 x\^2·y 或 x\^\(2y\)/);
  assert.throws(() => normalizeFormula('e^-2x', R), /写 e\^\(-2x\) 或 e\^\(-2\)·x/);
  assert.throws(() => normalizeFormula('e^2x', R), /写 e\^2·x 或 e\^\(2x\)/);
});

test('4. 参数是 √ 或另一个函数：sin√x、arcsin√x、ln ln x', () => {
  near(val('sin√x'), Math.sin(Math.sqrt(0.7)));
  near(val('arcsin√x'), Math.asin(Math.sqrt(0.7)));
  near(val('ln ln x', 2.5), Math.log(Math.log(2.5)));
  near(val('sinx cosx'), Math.sin(0.7) * Math.cos(0.7)); // 两个函数各吃各的照旧
  near(val('e^√x'), Math.exp(Math.sqrt(0.7)));
});

test('5. derive 极限：最后一行写 ∞ / 不存在，goal 也能写', () => {
  const rs = chain('mode: do\ncalc: limit at=0\nstart: (1-cos(x))/x^3\ngoal: ∞', ['(x^2/2)/x^3', '1/(2x)', '∞']);
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true]);
  assert.equal(rs[2].done, true);
  assert.equal(chain('mode: do\ncalc: limit at=0\nstart: 1/x^2', ['+∞'])[0].ok, true);
  assert.equal(chain('mode: do\ncalc: limit at=0\nstart: 1/x^2', ['-∞'])[0].ok, false);
  assert.equal(chain('mode: do\ncalc: limit at=0\nstart: abs(x)/x', ['不存在'])[0].ok, true);
  assert.equal(chain('mode: do\ncalc: limit at=0\nstart: sin(x)/x', ['∞'])[0].ok, false);
});

test('6. 单侧写 at=0+、at=0-、at=0^+', () => {
  assert.equal(parseCalc('limit of=x^x at=0+').side, '+');
  assert.equal(parseCalc('limit of=x at=0-').side, '-');
  assert.equal(parseCalc('limit of=x at=0^+').side, '+');
  assert.equal(parseCalc('limit of=x at=0^+').at, '0');
  assert.equal(judge(spec({ answer: '1', calc: 'limit of=x^x at=0+' }), '1').ok, true);
  assert.equal(judge(spec({ answer: '+inf', calc: 'limit of=1/x at=0+' }), '+∞').ok, true);
  const rs = chain('mode: do\ncalc: limit at=0+\nstart: abs(x)/x', ['1']);
  assert.equal(rs[0].ok, true);
});

test('7. 预检：derive 的 goal 和 start 不相等要报（极限、整数 / 矩阵都是）', () => {
  assert.ok(deriveDoProblems('mode: do\ncalc: limit at=0\nstart: (tan(x)-sin(x))/x^3\ngoal: 1/3').some((m) => /goal/.test(m)));
  assert.deepEqual(deriveDoProblems('mode: do\ncalc: limit at=0\nstart: (tan(x)-sin(x))/x^3\ngoal: 1/2'), []);
  assert.ok(deriveDoProblems("mode: do\nvars: a=vec(3) b=vec(3)\nlet A = a*b'\nstart: A^2\ngoal: 2*A").some((m) => /goal/.test(m)));
  assert.deepEqual(deriveDoProblems("mode: do\nvars: a=vec(3) b=vec(3)\nlet A = a*b'\nstart: A^2\ngoal: tr(A)*A"), []);
});

test('顺手：输入框的示例字按题换', () => {
  assert.match(spec({ answer: '1/2', calc: 'limit of=(1-cos(x))/x^2 at=0' }).placeholder, /1\/2、e\^2、∞/);
  assert.match(spec({ answer: 'x*e^x - e^x', calc: 'antideriv of=x*e^x' }).placeholder, /x e\^x/);
  assert.match(formulaSpec('ln(1+x)', 'x').placeholder, /x e\^x/);
  assert.equal(formulaSpec('3^(n-1)', 'n').placeholder, undefined); // 线代照旧
});

test('顺手：判错时写学生自己的式子，不写算出来的小数', () => {
  const s = spec({ answer: '1/2', calc: 'limit of=(1-cos(x))/x^2 at=0' });
  const r = judge(s, 'π/2');
  assert.equal(r.ok, false);
  assert.match(r.msg, /\\frac\{\\pi\}\{2\}|\\pi/);
  assert.doesNotMatch(r.msg, /1\.571/);
});
