// 视觉交互第 2 批：独立复查查出来的问题，一条一个能重现的测试（先看到它失败，再改）。
// 编号照复查的报告：C = 画错 / 算错却不报，I = 看得见的毛病、带坏了以前的东西。
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, compile } from '../kit/src/expr.js';
import { makeDefs, addDef, parseDef, compileWith } from '../kit/src/fx/defs.js';
import { contourLines, flowLine, inTyped, typedRegion, stripOf, nearestOn } from '../kit/src/fx/plane.js';
import { numIntegral2, cubature2 } from '../kit/src/fx/integral.js';
import { formulaSpec } from '../kit/src/formula.js';

const near = (a, b, e) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}（容差 ${e}）`);
const defsOf = (...lines) => { const d = makeDefs(); for (const l of lines) addDef(d, parseDef(l)); return d; };

// —— C1：定义里的 int2 / lineint 绑定的字母不许抓走调用处的同名变量 ——
test('C1 定义里有 int2：F(x) 的实参 x 不被积分变量 x 抓走', () => {
  const d = defsOf('F(z) = int2(x + y <= z, x, 0, 1, y, 0, 1)', 'A(c) = int2(c, x, 0, 1, y, 0, 1)');
  near(compileWith('F(x)', d)({ x: 0.5 }), 0.125, 2e-3);
  near(compileWith('F(y)', d)({ y: 1 }), 0.5, 2e-3);
  near(compileWith('A(x)', d)({ x: 3 }), 3, 1e-6);
  near(compileWith('A(x + y)', d)({ x: 3, y: 1 }), 4, 1e-6);
});

test('C1 定义里有 lineint：实参里的 t、x、y 不被抓走', () => {
  const d = defsOf('W(a) = lineint(-a*y, a*x, cos(t), sin(t), t, 0, 2pi)');
  near(compileWith('W(t)', d)({ t: 2 }), 4 * Math.PI, 1e-5);
  near(compileWith('W(x)', d)({ x: 3 }), 6 * Math.PI, 1e-5);
  near(compileWith('W(y)', d)({ y: 0.5 }), Math.PI, 1e-5);
});

// —— C2 / I1：带条件的二重积分 ——
test('C2 条件 × 密度：支撑只占积分范围的一小块时也算对', () => {
  near(evaluate('int2(2*(x + y <= 1)*(x >= 0)*(y >= 0), x, -1, 2, y, -1, 2)'), 1, 2e-3);
  near(evaluate('int2(e^(-x-y)*(x > 0)*(y > 0)*(x + y < 1), x, -1, 3, y, -1, 3)'), 1 - 2 / Math.E, 1e-3);
  // 一条很窄的带子：|x − y| ≤ 0.1 在 60 × 60 上，面积 2·0.1·60 − 0.01 = 11.99
  near(evaluate('int2(abs(x - y) <= 0.1, x, 0, 60, y, 0, 60)'), 11.99, 0.12);
});

test('I1 会面问题：t 从 0 到 60 每一档都算得出来，和 3600·(1 − (1 − t/60)²) 对得上', () => {
  const f = compile('int2(abs(x - y) <= t, x, 0, 60, y, 0, 60)/3600');
  for (let t = 0; t <= 60; t++) near(f({ t }), 1 - (1 - t / 60) ** 2, 2e-3);
});

test('I1 复查列的几个：都算得出来、都对', () => {
  near(evaluate('int2((y <= x)*6x, x, 0, 1, y, 0, 1)'), 2, 4e-3);
  near(evaluate('int2((x + y <= 1)*6x, x, 0, 1, y, 0, 1)'), 1, 2e-3);
  near(evaluate('int2((y < x)*e^(-x-y), x, 0, inf, y, 0, inf)'), 0.5, 2e-3);
  near(evaluate('int2(binormpdf(x, y, 0, 0, 1, 1, 0.5)*(x + y <= 1), x, -8, 8, y, -8, 8)'), 0.7181, 2e-3); // Φ(1/√3)
  near(evaluate('int2(max(x, y) <= 0.5, x, 0, 1, y, 0, 1)'), 0.25, 1e-3);
  near(evaluate('int2((x^2 + y^2 <= 1)*1, x, -2, 2, y, -2, 2)'), Math.PI, 6e-3);
});

test('C2 发散的、奇点太强的：说算不出来，不给一个数', () => {
  assert.throws(() => evaluate('int2(1/x, x, -1, 1, y, 0, 1)'), /算不出来/);
  assert.throws(() => evaluate('int2((y > 0)/x, x, -1, 1, y, -1, 1)'), /算不出来/);
  // 可积的奇点页面核不准时宁可不说：不许回一个差了 1% 的数
  let v = null;
  try { v = evaluate('int2(1/sqrt(x^2 + y^2), x, -1, 1, y, -1, 1)'); } catch { v = null; }
  if (v !== null) near(v, 7.0509886, 2e-3);
});

test('C2 一元的 int 也一样：窄的支撑不漏', () => {
  near(evaluate('int((x > 0.9)*(x < 0.95)*4, x, -1, 2)'), 0.2, 1e-6);
  near(evaluate('int((x >= 0)*(x <= 0.2), x, -3, 3)'), 0.2, 1e-6);
  near(evaluate('int(floor(x), x, 0, 3)'), 3, 1e-6);
});

test('I7 同样的量再算一遍不重算（滑块动的是别的量时）', () => {
  let reads = 0;
  const vars = { get z() { reads++; return 0.7; } };
  const f = compile('int2((x + y <= z)*1, x, 0, 1, y, 0, 1)');
  near(f(vars), 0.245, 2e-3);
  const first = reads;
  assert.ok(first > 200, `第一次读了 ${first} 次 z`);
  f(vars);
  assert.ok(reads - first < 10, `第二次又读了 ${reads - first} 次 z`);
});

test('I2 numIntegral2 的默认精度没变：计划 3 的 calc: integral2 照旧', () => {
  // 光滑的照旧准到 1e-9
  near(numIntegral2((x, y) => x * y, [0, 1], [() => 0, (x) => x]).value, 1 / 8, 1e-10);
  // 带指示函数的：对的答案不许被判错（页面核不准就只给提示）
  for (const of of ['(y<=x^2)', '(x+y<=1)*(x+y)']) {
    const s = formulaSpec('1/3', undefined, {}, { calc: `integral2 of=${of} x=0..1 y=0..1` });
    assert.deepEqual(s.errors || [], [], `${of}：${(s.errors || []).join('；')}`);
  }
});

test('cubature2：光滑的格子高斯求积、有断口的格子细分；回 ok / 误差', () => {
  const r = cubature2((x, y) => (x + y <= 1 ? 2 : 0), [0, 1], [() => 0, () => 1], { marks: [(x, y) => 1 - x - y] });
  assert.equal(r.ok, true); near(r.value, 1, 1e-3);
  const s = cubature2((x, y) => Math.exp(-x - y), [0, Infinity], [() => 0, () => Infinity], { marks: [] });
  assert.equal(s.ok, true); near(s.value, 1, 1e-4);
  const bad = cubature2((x) => 1 / x, [-1, 1], [() => 0, () => 1], { marks: [] });
  assert.notEqual(bad.ok, true);
});

// —— C3：极点、跳跃的地方不画假的线 ——
const segsOf = (lines) => lines.flatMap((l) => l.slice(1).map((p, i) => [l[i], p]));
test('C3 y = tan x：渐近线上不画竖线', () => {
  const ls = contourLines((x, y) => y - Math.tan(x), 0, { x0: -5, x1: 5, y0: -5, y1: 5 }, { nx: 96, ny: 96 });
  for (const [a, b] of segsOf(ls)) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    assert.ok(Math.abs(my - Math.tan(mx)) < 0.6, `(${mx.toFixed(3)}, ${my.toFixed(3)}) 不在 y = tan x 上`);
  }
  assert.ok(ls.length >= 3, '三支都在');
});

test('C3 y = 1/x、y/x = c：x = 0 上不画线；floor(x) + y = 0 不画竖的台阶', () => {
  const box = { x0: -1, x1: 4, y0: -2, y1: 3 };
  for (const [F, lv] of [[(x, y) => y - 1 / x, 0], [(x, y) => y / x, 1], [(x, y) => y / x, -1]]) {
    for (const [a, b] of segsOf(contourLines(F, lv, box, { nx: 96, ny: 96 }))) assert.ok(!(Math.abs(a[0]) < 0.03 && Math.abs(b[0]) < 0.03 && Math.abs(a[1] - b[1]) > 0.03), `x = 0 上有一段竖线 ${JSON.stringify([a, b])}`);
  }
  for (const [a, b] of segsOf(contourLines((x, y) => Math.floor(x) + y, 0, { x0: -3.3, x1: 3.3, y0: -3.1, y1: 3.1 }, { nx: 96, ny: 96 }))) assert.ok(Math.abs(a[1] - b[1]) < 0.2, `竖的台阶 ${JSON.stringify([a, b])}`);
});

// —— C4：解到头了就停 ——
test('C4 y′ = −x/y 过 (0, 1)：画到 y = 0（竖直切线）就停，不沿 x 轴接着画', () => {
  const box = { x0: -3, x1: 3, y0: -3, y1: 3 };
  const line = flowLine((x, y) => -x / y, [0, 1], box);
  assert.ok(line.length < 3000, `走了 ${line.length} 个点`);
  for (const [x, y] of line) { assert.ok(Math.abs(x * x + y * y - 1) < 0.03, `(${x}, ${y}) 不在单位圆上`); assert.ok(y > -0.03); }
  const xs = line.map((p) => p[0]);
  assert.ok(Math.min(...xs) < -0.97 && Math.max(...xs) > 0.97, '左右两头都走到了');
});

test('C4 y′ = 1/(2y) 过 (1, 1)：停在顶点；y′ = y/x 过 (1, 1)：不穿过原点', () => {
  const box = { x0: -3, x1: 3, y0: -3, y1: 3 };
  for (const [x, y] of flowLine((x, y) => 1 / (2 * y), [1, 1], box)) assert.ok(x > -0.03 && Math.abs(x - y * y) < 0.03, `(${x}, ${y})`);
  const l2 = flowLine((x, y) => y / x, [1, 1], box);
  for (const [x, y] of l2) assert.ok(x > -0.02 && y > -0.02, `穿过了原点：(${x}, ${y})`);
  assert.ok(Math.max(...l2.map((p) => p[0])) > 2.9, '往右照样画到窗口边');
});

test('C4 平常的解不受影响：y′ = y、y′ = y − x 照旧画到窗口边', () => {
  const box = { x0: -3, x1: 3, y0: -4, y1: 6 };
  const a = flowLine((x, y) => y, [0, 1], box);
  assert.ok(Math.min(...a.map((p) => p[0])) < -2.9);
  for (const [x, y] of a) if (y < 6 && y > -4) assert.ok(Math.abs(y - Math.exp(x)) < 0.02 * Math.max(1, Math.exp(x)));
  const b = flowLine((x, y) => y - x, [0, 2], box);
  assert.ok(Math.min(...b.map((p) => p[0])) < -2.9 && Math.max(...b.map((p) => p[1])) > 5.9);
});

// —— C6：in D 和画出来的 D 一致 ——
test('C6 极坐标的 r 是负的（四叶玫瑰线）：画出来的每一瓣里面的点都算在区域里', () => {
  const lo = () => 0, hi = (t) => Math.cos(2 * t);
  const D = inTyped('r', lo, hi, 0, 2 * Math.PI);
  assert.equal(D(0.5, 0), true); assert.equal(D(-0.5, 0), true);
  assert.equal(D(0, 0.5), true, '上面那一瓣'); assert.equal(D(0, -0.5), true, '下面那一瓣');
  assert.equal(D(0.5, 0.5), false);
});

test('C6 范围写反了（for x 1 0）：画的和判的一样', () => {
  const lo = (x) => x * x, hi = (x) => x;
  assert.equal(inTyped('y', lo, hi, 1, 0)(0.5, 0.3), true);
  const r = typedRegion('y', lo, hi, 1, 0);
  assert.ok(r.poly.length > 10);
  assert.ok(stripOf('y', lo, hi, 0.5, [1, 0]));
});

// —— C7：区域的范围以外没有「一条」 ——
test('C7 strip 在区域的 for 范围以外：没有', () => {
  const lo = (x) => x * x, hi = (x) => x;
  assert.equal(stripOf('y', lo, hi, 1.5, [0, 1]), null);
  assert.equal(stripOf('y', lo, hi, -0.2, [0, 1]), null);
  assert.ok(stripOf('y', lo, hi, 0.5, [0, 1]));
  assert.ok(stripOf('y', lo, hi, 1, [0, 1]), '端点上有');
});

// —— I4：沿约束拖，取离手指最近的点 ——
test('I4 约束有两支（y = 1/x）：手指在左下那一支旁边，点不跳到右上那一支', () => {
  const G = (x, y) => y - 1 / x, box = { x0: -4, x1: 4, y0: -4, y1: 4 };
  for (const p of [[-0.5, -3.7], [-0.6, -3.9], [-0.3, -3.5], [-2, -0.2], [-3.5, -0.6]]) {
    const q = nearestOn(G, p, box);
    assert.ok(q, `${p} 没投上`);
    assert.ok(q[0] < 0 && q[1] < 0, `${p} → ${q} 跳到了另一支`);
    near(q[1], 1 / q[0], 1e-6);
    assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.2, `${p} → ${q} 太远`);
  }
});

test('I4 三次曲线 y = x³ − 3x：投到的点离手指不比曲线上的取样点远', () => {
  const G = (x, y) => y - (x ** 3 - 3 * x), box = { x0: -3, x1: 3, y0: -4, y1: 4 };
  for (const p of [[-1, -3.9], [-0.8, -3.9], [1, 3.9], [0.3, 1], [2.2, -1]]) {
    const q = nearestOn(G, p, box);
    let best = Infinity;
    for (let x = -3; x <= 3; x += 0.001) { const y = x ** 3 - 3 * x; if (y >= -4 && y <= 4) best = Math.min(best, Math.hypot(x - p[0], y - p[1])); }
    assert.ok(Math.hypot(q[0] - p[0], q[1] - p[1]) <= best + 0.02, `${p} → ${q}（最近的是 ${best}）`);
  }
});

test('I4 窗口里没有这条曲线：回 null', () => {
  assert.equal(nearestOn((x, y) => x * x + y * y + 1, [0, 0], { x0: -2, x1: 2, y0: -2, y1: 2 }), null);
});
