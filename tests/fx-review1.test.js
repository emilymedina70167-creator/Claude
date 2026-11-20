// 视觉交互第 1 批：独立复查查出来的问题，一条一个能重现它的测试（修之前都是红的）
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleCurve } from '../kit/src/fx/curve.js';
import { evaluate, compile } from '../kit/src/expr.js';
import { DIST } from '../kit/src/fx/special.js';
import { parseDef, makeDefs, addDef, compileWith } from '../kit/src/fx/defs.js';
import { parseGraph } from '../kit/src/graphspec.js';
import { judgePicks } from '../kit/src/graphpick.js';
import { smoothAt, autoRange } from '../kit/src/fx/graphgeom.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}（容差 ${e}）`);
const fn = (src) => { const c = compile(src); return (x) => c({ x }); };
const defsOf = (...lines) => { const d = makeDefs(); for (const l of lines) addDef(d, parseDef(l)); return d; };
// 折线在 x 附近有没有冲出去的尖刺：|y| 的最大值
const peakNear = (r, x, w = 0.2) => Math.max(...r.segs.flat().filter(([px]) => Math.abs(px - x) < w).map(([, y]) => y));
const dipNear = (r, x, w = 0.2) => Math.min(...r.segs.flat().filter(([px]) => Math.abs(px - x) < w).map(([, y]) => y));

test('1 式子处处算不出来：把原因带回来（不静默空白）；只是没定义的不算错', () => {
  const r = sampleCurve(() => { throw new Error('未定义的变量 q'); }, 0, 1, {});
  assert.deepEqual(r.segs, []);
  assert.equal(r.error, '未定义的变量 q');
  assert.equal(sampleCurve(() => NaN, 0, 1, {}).error, undefined);
  // 有的点算得出来就不报（阶乘只在整数上有）
  assert.equal(sampleCurve(fn('ln(x)'), -2, 3, { ySpan: 6 }).error, undefined);
  assert.match(sampleCurve(fn('chi2pdf(x, 0)'), 0, 5, {}).error, /自由度要是正数/);
  assert.match(sampleCurve(fn('sum(k, 1, 30000, x^k)'), 0, 1, {}).error, /最多 20000/);
});

test('5b roots：区间端点上的根也算', () => {
  const r = evaluate('roots(sin(x), x, -pi, pi)');
  assert.equal(r.length, 3);
  near(r[0], -Math.PI, 1e-8); near(r[1], 0, 1e-8); near(r[2], Math.PI, 1e-8);
  assert.deepEqual(evaluate('roots(x - 1, x, 1, 3)').map((x) => Math.round(x * 1e6) / 1e6), [1]);
  assert.deepEqual(evaluate('roots(x^2 + 1, x, -1, 1)'), []);
});

test('6a 小台阶也断开（比窗口的 8% 小得多的跳）', () => {
  const F = sampleCurve(fn('0.05*(x>=0) + 0.9*(x>=1) + 0.05*(x>=2)'), -1, 4, { ySpan: 1.2 });
  assert.deepEqual(F.jumps.map((j) => Math.round(j.x) + 0), [0, 1, 2]); // + 0：−0 也是 0
  assert.ok(F.jumps.every((j) => j.solid === 'right'));
  const B = sampleCurve(fn('binomcdf(floor(x), 10, 0.3)'), -1, 11, { ySpan: 1.2 });
  // 0～6 处的台阶都认出来（7 以后一步不到 0.01，看不出来，不强求）
  for (const k of [0, 1, 2, 3, 4, 5, 6]) assert.ok(B.jumps.some((j) => Math.abs(j.x - k) < 1e-6), `x = ${k} 的台阶没认出来`);
  // 光滑的函数不因此多出跳跃
  for (const src of ['x^3 - 3x', 'sin(5x)', 'exp(x)', 'arctan(50x)']) assert.deepEqual(sampleCurve(fn(src), -3, 3, { ySpan: 10 }).jumps, [], src);
});

test('6b 两边都是开区间的分段：不多出竖线，窗口多高都一样', () => {
  for (const ySpan of [4, 14, 40]) {
    const r = sampleCurve(fn('(x<1)*x + (x>1)*(3-x)'), -5, 5, { ySpan });
    assert.equal(r.jumps.length, 1, `ySpan ${ySpan}`);
    near(r.jumps[0].x, 1); near(r.jumps[0].left, 1, 1e-4); near(r.jumps[0].right, 2, 1e-4);
    assert.equal(r.jumps[0].solid, 'none'); near(r.jumps[0].value, 0);
    assert.ok(dipNear(r, 1) > 0.7, `ySpan ${ySpan}：x = 1 处有往下的尖刺（最低 ${dipNear(r, 1)}）`);
  }
  const s = sampleCurve(fn('(x>0) - (x<0)'), -3, 3, { ySpan: 30 });
  assert.equal(s.jumps.length, 1);
  assert.ok(s.segs.flat().every(([, y]) => Math.abs(Math.abs(y) - 1) < 1e-9), '折线上混进了 x = 0 那一点的 0');
});

test('6c 一点另有一个值：空心点 + 那个值，不画尖刺', () => {
  for (const ySpan of [4, 12]) {
    const r = sampleCurve(fn('(x!=1)*(x+1) + (x==1)*4'), -5, 5, { ySpan });
    assert.ok(peakNear(r, 1) < 2.3, `ySpan ${ySpan}：x = 1 处有尖刺（最高 ${peakNear(r, 1)}）`);
    assert.equal(r.holes.length, 1);
    near(r.holes[0].x, 1); near(r.holes[0].y, 2, 1e-4); near(r.holes[0].value, 4);
    assert.deepEqual(r.jumps, []);
  }
});

test('7a 导数：f 没定义的地方 f′ 也没定义', () => {
  const d = defsOf('f(x) = ln(x)');
  assert.ok(Number.isNaN(compileWith("f'(x)", d)({ x: -1 })));
  near(compileWith("f'(x)", d)({ x: 2 }), 0.5);
  const s = defsOf('g(x) = sqrt(x - 1)');
  assert.ok(Number.isNaN(compileWith("g'(0)", s)({})));
});

test('7b 尖点：左右差商对不上就不算可导', () => {
  const kink = fn('(x<0)*0 + (x>=0)*x');
  assert.equal(smoothAt(kink, 0, 1, 6), false);
  assert.equal(smoothAt(kink, 1, 1, 6), true);
  assert.equal(smoothAt(kink, -1, 0, 6), true);
  assert.equal(smoothAt(fn('abs(x^2 - 1)'), 1, 2, 6), false);
  assert.equal(smoothAt(fn('x^3 - 3x'), 1, 0, 6), true);
  assert.equal(smoothAt(fn('sin(x)'), 0, 1, 6), true);
});

test('4 goal、pick 不能写 after / before（自己等自己，永远出不来）', () => {
  assert.throws(() => parseGraph('goal a = 2 after'), /goal 不能写 after/);
  assert.throws(() => parseGraph('pick "点" on x at 1 after'), /pick 不能写 after/);
});

test('9 left / right / mid / hollow / join 只在自己的命令上是修饰，别处是普通的名字', () => {
  const g = parseGraph('let mid = 1\nlet left = 0\nshade x^2 left mid\nplot x^2 for x left mid\nvline mid\nriemann x^2 from 0 to 1 n=4 mid\npoint [0, 1] hollow\ndots 1/n for n 1 5 join');
  assert.equal(g.cmds[2].kind, 'shade');
  assert.equal(g.cmds[2].b({ mid: 1 }), 1); assert.equal(g.cmds[2].a({ left: 0 }), 0);
  assert.equal(g.cmds[3].hi({ mid: 1 }), 1);
  assert.equal(g.cmds[4].at({ mid: 3 }), 3);
  assert.equal(g.cmds[5].rule, 'mid'); assert.equal(g.cmds[6].mods.hollow, true); assert.equal(g.cmds[7].mods.join, true);
});

test('10 pick 的配对：存在全配上的配法就不说错', () => {
  const r = judgePicks([0.15, -0.2], [0, 0.314], 0.24);
  assert.equal(r.ok, true);
  assert.equal(judgePicks([0.9, 1.05], [1], 0.2).ok, false);
  assert.deepEqual(judgePicks([0.9, 1.05], [1], 0.2).hits, [1]); // 一个目标只配一个点，近的那个
  assert.equal(judgePicks([-1.05, 0.96], [-1, 1], 0.2).ok, true);
  assert.equal(judgePicks([5], [-1, 1], 0.2).missed, 2);
});

test('12 自动的 y 范围：极点、爆掉的值不把窗口撑到几十万', () => {
  const ys = []; for (let i = 0; i <= 80; i++) { const x = -3 + (6 * i) / 80; const y = Math.exp(1 / x); if (Number.isFinite(y)) ys.push(y); }
  const [lo, hi] = autoRange(ys);
  assert.ok(hi < 60 && hi > 2, `上沿 ${hi}`);
  assert.ok(lo <= 0);
  // 规矩的函数和以前一样：从 0 起、上面留 15%
  const p = autoRange([0, 0.1, 0.4, 0.2]);
  near(p[0], 0); near(p[1], 0.46, 1e-9);
  assert.deepEqual(autoRange([]), [0, 1]);
  const neg = autoRange([-2, 3]);
  assert.ok(neg[0] < -2 && neg[1] > 3);
});

test('13 分布函数的边角：大的 n 不回 NaN，参数不对的报出来', () => {
  const { binomcdf, hyperpmf, poissoncdf, fcdf, expcdf, chi2cdf, tcdf } = DIST;
  near(binomcdf(1500, 2000, 0.5), 1, 1e-9);
  near(binomcdf(1000, 2000, 0.5), 0.50892, 1e-4);
  near(binomcdf(3, 10, 0.3), 0.6496107184, 1e-9);
  near(poissoncdf(1000, 800), 1, 1e-9);
  near(poissoncdf(800, 800), 0.50940, 1e-4);
  assert.equal(fcdf(Infinity, 3, 4), 1);
  assert.equal(chi2cdf(Infinity, 3), 1);
  assert.equal(tcdf(Infinity, 3), 1); assert.equal(tcdf(-Infinity, 3), 0);
  assert.throws(() => expcdf(1, -1), /λ 要是正数/);
  assert.throws(() => hyperpmf(1, 10, 3, 20), /取的件数/);
  assert.throws(() => binomcdf(1, 10, 1.5), /概率要在 0 和 1 之间/);
});

test('14 零碎：Unicode 的撇号、求和的字母不抓走定义里的量、不认识的名字报中文', () => {
  const d = defsOf('f(x) = x^3');
  assert.equal(compileWith('f′(2)', d)({}), 12);
  assert.equal(compileWith('f″(2)', d)({}), 12);
  assert.equal(compileWith('f′′(2)', d)({}), 12);
  const p = defsOf('p(x) = a*x');
  assert.equal(compileWith('sum(a, 1, 3, p(2))', p)({ a: 10 }), 60); // 定义里的 a 是外面的 a = 10，不是求和的字母
  assert.equal(compileWith('sum(a, 1, 3, a*p(1))', p)({ a: 10 }), 60); // 自己写的 a 才是求和的字母
  assert.throws(() => evaluate('constructor(1, 2, 3, 4)'), /没有函数 constructor/);
  assert.throws(() => evaluate('toString(1)'), /没有函数 toString/);
});

test('8 大数的阶乘不拖慢：超出双精度的直接是无穷', () => {
  assert.equal(evaluate('200!'), Infinity);
  assert.equal(evaluate('170!') > 1e306, true);
  const f = compile('sum(k, 0, n, (-1)^k*x^(2k+1)/(2k+1)!)');
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) f({ n: 1999, x: 1 + i / 20 });
  assert.ok(performance.now() - t0 < 400, `${Math.round(performance.now() - t0)} ms`);
});
