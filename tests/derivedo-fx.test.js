// 计划 3（dr-calc-base）Task 7：derive 推高数（审的必改 5、6，必加 7）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeriveDo, sampleEnvs, checkLine } from '../kit/src/derivedo.js';
import { formulaSpec, normalizeFormula, compareFormula } from '../kit/src/formula.js';

// 照 blocks/derivedo.js 走一串：每一行接上一行（说明行不算上一行），带着 ctx
function chain(src, lines) {
  const spec = parseDeriveDo(src);
  const envs = sampleEnvs(spec);
  let prev = spec.start, state = {};
  return lines.map((l) => {
    const r = checkLine(spec, envs, prev, l, state);
    if (r.ctx) state = { ctx: r.ctx };
    if (r.ok === true && !r.note) prev = l;
    return r;
  });
}
const L = 'mode: do\ncalc: limit at=0\nstart: (tan(x) - sin(x))/x^3\ngoal: 1/2';

test('加减里乱用等价替换被指出来（任务书验收）', () => {
  const [r] = chain(L, ['(x - x)/x^3']);
  assert.equal(r.ok, false);
  assert.match(r.why, /这一行的极限是 0.*上一行是 1\/2/);
});
test('对的一串都过，推到 goal', () => {
  const rs = chain(L, ['lim x->0 tan(x)(1-cos(x))/x^3', 'x*(x^2/2)/x^3', '1/2']);
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true]);
  assert.equal(rs[1].same, 'limit'); // 只是极限一样（等价替换），不恒等
  assert.equal(rs[2].done, true);
});
test('替换错了、结果变成无穷大的也判错（必改 5）', () => {
  const [r] = chain('mode: do\ncalc: limit at=0\nstart: (tan(x)-sin(x))/x^3', ['(x - sin(x))/x^4']);
  assert.equal(r.ok, false);
  assert.match(r.why, /∞/);
});
test('一行里几个 lim 都去掉', () => {
  const rs = chain(L, ['lim tan(x)/x * lim (1-cos(x))/x^2']);
  assert.equal(rs[0].ok, true);
});
test('一行换变量：令 t = 1/x 是说明，下一行写自己的 lim（必改 5）', () => {
  const rs = chain('mode: do\ncalc: limit at=inf\nstart: x(e^{1/x}-1)', ['令 t=1/x', 'lim t→0 (e^t-1)/t', '1']);
  assert.equal(rs[0].note, true);
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true]);
});
test('换变量没写 lim 也没写令：判不了，不判错', () => {
  const [r] = chain('mode: do\ncalc: limit at=0\nstart: sin(x)/x', ['sin(t)/t']);
  assert.equal(r.ok, null);
});
test('差得很小不判错', () => {
  const [r] = chain('mode: do\ncalc: limit at=0\nstart: sin(x)/x', ['(1+10^(-6))*sin(x)/x']);
  assert.notEqual(r.ok, false);
});
test('极限算不出来的那一行是 null', () => {
  const [r] = chain('mode: do\ncalc: limit at=0\nstart: x*sin(1/x)', ['x*sin(1/x) + x^2']); // 不恒等、两行的极限页面都算不出来
  assert.equal(r.ok, null);
});

const A = 'mode: do\ncalc: antideriv\nstart: ∫ x e^x dx';
test('分部积分', () => {
  assert.deepEqual(chain(A, ['x e^x - ∫ e^x dx', 'xe^x - e^x + C']).map((r) => r.ok), [true, true]);
  assert.equal(chain(A, ['x e^x + ∫ e^x dx'])[0].ok, false);
});
test('换元：令 x = sin t（必改 6）', () => {
  const rs = chain('mode: do\ncalc: antideriv\nstart: ∫ sqrt(1-x^2) dx', ['令 x = sin t', '∫ cos(t)^2 dt', 't/2 + sin(2t)/4 + C', 'arcsin(x)/2 + x sqrt(1-x^2)/2 + C']);
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true, true]);
});
test('凑微分 ∫ g d(h)', () => {
  const rs = chain('mode: do\ncalc: antideriv\nstart: ∫ sin(x)^2 cos(x) dx', ['∫ sin(x)^2 d(sin x)', 'sin(x)^3/3 + C']);
  assert.deepEqual(rs.map((r) => r.ok), [true, true]);
});
test('没写令就换了变量：null，绝不判错', () => {
  const [r] = chain('mode: do\ncalc: antideriv\nstart: ∫ sqrt(1-x^2) dx', ['∫ cos(t)^2 dt']);
  assert.equal(r.ok, null);
  assert.match(r.why, /令/);
});
test("求导写 '", () => {
  const rs = chain("mode: do\nvars: x=real(-2,2)\nstart: (x^2 sin(x))'", ['2x sinx + x^2 cosx']);
  assert.equal(rs[0].ok, true);
  assert.equal(chain("mode: do\nvars: x=real(-2,2)\nstart: (x^2 sin(x))'", ['2x cosx'])[0].ok, false);
});

// 必加 7：变限积分
test('变限积分：calc: limit 自检得 1/3', () => {
  const s = formulaSpec('1/3', undefined, {}, { calc: 'limit of=int(sin(t^2),t,0,x)/x^3 at=0' });
  assert.equal(compareFormula(s.expected, normalizeFormula('1/3', s.read), s).ok, true);
});
test('变限积分：求导', () => {
  const s = formulaSpec('2*x*sin(x^2)', undefined, {}, { calc: 'deriv of=int(sin(t),t,0,x^2)' });
  assert.equal(compareFormula(s.expected, normalizeFormula('2x sin(x^2)', s.read), s).ok, true);
});
test('变限积分：derive 里一行行求极限', () => {
  const rs = chain('mode: do\ncalc: limit at=0\nstart: ∫_0^x sin(t^2) dt / x^3', ['sin(x^2)/(3x^2)', '1/3']);
  assert.deepEqual(rs.map((r) => r.ok), [true, true]);
});
test('线代的 derive 不变', () => {
  const spec = parseDeriveDo("mode: do\nvars: a=vec(3) b=vec(3)\nlet A = a*b'\nstart: A^2\ngoal: tr(A)*A");
  assert.equal(spec.fx, undefined);
  const envs = sampleEnvs(spec);
  assert.equal(checkLine(spec, envs, 'A^2', "a(b'a)b'").ok, true);
});
