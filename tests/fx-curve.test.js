// 视觉交互第 1 批 Task 4：曲线的采样——间断点断开、跳跃点（哪头实心）、可去间断点、没定义的一段不连
import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleCurve, labelSpot, CURVE_MAX_POINTS } from '../kit/src/fx/curve.js';
import { compile } from '../kit/src/expr.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}（容差 ${e}）`);
const fn = (src) => { const c = compile(src); return (x) => c({ x }); };
const pts = (r) => r.segs.reduce((s, g) => s + g.length, 0);
const connected = (r) => r.segs.every((g) => g.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));

test('光滑的函数：一段，没有跳跃', () => {
  const r = sampleCurve(fn('x^2'), -2, 2, { ySpan: 4 });
  assert.equal(r.segs.length, 1);
  assert.deepEqual(r.jumps, []);
  assert.deepEqual(r.holes, []);
  near(r.segs[0][0][0], -2); near(r.segs[0].at(-1)[0], 2);
  assert.ok(connected(r));
});

test('跳跃间断点：断开，左右极限，哪头等于函数值哪头实心', () => {
  const r = sampleCurve(fn('(x<0)*(x+1) + (x>=0)*(x^2-1)'), -3, 3, { ySpan: 5 });
  assert.equal(r.segs.length, 2);
  assert.equal(r.jumps.length, 1);
  const j = r.jumps[0];
  near(j.x, 0); near(j.left, 1, 1e-4); near(j.right, -1, 1e-4);
  assert.equal(j.solid, 'right');
  // 两段分别停在断点两边，不连过去
  assert.ok(r.segs[0].at(-1)[0] <= 1e-6 && r.segs[1][0][0] >= -1e-6);
  near(r.segs[0].at(-1)[1], 1, 1e-3);
  near(r.segs[1][0][1], -1, 1e-3);
});

test('左连续的跳跃：实心在左边', () => {
  const r = sampleCurve((x) => (x <= 1 ? 2 : 0), 0, 2, { ySpan: 2 });
  assert.equal(r.jumps.length, 1);
  near(r.jumps[0].x, 1);
  assert.equal(r.jumps[0].solid, 'left');
});

test('跳跃点上函数另有一个值：两头都空心，带上那个值', () => {
  const r = sampleCurve((x) => (x < 1 ? 0 : x > 1 ? 2 : 1), 0, 2, { ySpan: 2 });
  assert.equal(r.jumps.length, 1);
  assert.equal(r.jumps[0].solid, 'none');
  near(r.jumps[0].value, 1);
});

test('无穷间断点：断开，不记成跳跃', () => {
  const r = sampleCurve(fn('1/(x-1)'), -3, 4, { ySpan: 12 });
  assert.equal(r.segs.length, 2);
  assert.deepEqual(r.jumps, []);
  assert.ok(r.segs[0].at(-1)[0] < 1 && r.segs[1][0][0] > 1);
  assert.ok(Math.max(...r.segs[0].map((p) => Math.abs(p[1]))) > 20);
  assert.ok(Math.max(...r.segs[1].map((p) => Math.abs(p[1]))) > 20);
});

test('tan x：每个极点都断开', () => {
  const r = sampleCurve(fn('tan(x)'), -5, 5, { ySpan: 10 });
  assert.equal(r.segs.length, 5);
  assert.deepEqual(r.jumps, []);
});

test('可去间断点：空心点', () => {
  const r = sampleCurve(fn('sin(x)/x'), -8, 8, { ySpan: 2 });
  assert.equal(r.holes.length, 1);
  near(r.holes[0].x, 0); near(r.holes[0].y, 1, 1e-4);
  assert.equal(r.segs.length, 2);
  // 采样点碰不上的可去间断点（x = 1 不在 240 等分点上）
  const s = sampleCurve(fn('(x^2-1)/(x-1)'), -1.3, 2.9, { ySpan: 5 });
  assert.equal(s.holes.length, 1);
  near(s.holes[0].x, 1); near(s.holes[0].y, 2, 1e-4);
});

test('只在一部分有定义：只画有定义的那几段，画到边界', () => {
  const a = sampleCurve(fn('ln(x)'), -2, 3, { ySpan: 6 });
  assert.equal(a.segs.length, 1);
  assert.ok(a.segs[0][0][0] > 0 && a.segs[0][0][0] < 1e-3);
  const b = sampleCurve(fn('sqrt(1 - x^2)'), -2, 2, { ySpan: 2 });
  assert.equal(b.segs.length, 1);
  near(b.segs[0][0][0], -1, 1e-6); near(b.segs[0].at(-1)[0], 1, 1e-6);
  near(b.segs[0][0][1], 0, 1e-2);
  assert.deepEqual(b.jumps, []); assert.deepEqual(b.holes, []);
});

test('阶梯函数：每个跳都认出来', () => {
  const r = sampleCurve(fn('floor(x)'), 0, 4, { ySpan: 4 });
  assert.deepEqual(r.jumps.map((j) => Math.round(j.x)), [1, 2, 3]);
  assert.ok(r.jumps.every((j) => j.solid === 'right'));
  const F = sampleCurve(fn('0.2*(x>=0) + 0.5*(x>=1) + 0.3*(x>=2)'), -1, 4, { ySpan: 1.1 });
  assert.equal(F.jumps.length, 3);
  assert.ok(F.jumps.every((j) => j.solid === 'right'));
  near(F.jumps[1].left, 0.2, 1e-6); near(F.jumps[1].right, 0.7, 1e-6);
});

test('很陡但连续：不断开', () => {
  const r = sampleCurve(fn('arctan(50x)'), -1, 1, { ySpan: 3.2 });
  assert.equal(r.segs.length, 1);
  assert.deepEqual(r.jumps, []);
});

test('振荡：加密采样，不乱报跳跃和空心点', () => {
  const r = sampleCurve(fn('sin(1/x)'), -0.5, 0.5, { ySpan: 3 });
  assert.ok(pts(r) > 1500, `只有 ${pts(r)} 个点`);
  assert.ok(pts(r) <= CURVE_MAX_POINTS);
  assert.deepEqual(r.holes, []);
  assert.deepEqual(r.jumps, []);
});

test('算不出来的函数：空的，不抛', () => {
  const r = sampleCurve(() => { throw new Error('x'); }, 0, 1, {});
  assert.deepEqual(r.segs, []);
  assert.deepEqual(sampleCurve((x) => x, 1, 1, {}).segs, []);
});

test('ySpan 不给时按取到的值估', () => {
  const r = sampleCurve((x) => (x < 0 ? 0 : 100), -1, 1);
  assert.equal(r.jumps.length, 1);
});

test('labelSpot：横向几成处曲线上的点；那里没定义就找最近的', () => {
  const r = sampleCurve(fn('ln(x)'), -2, 3, { ySpan: 6 });
  const [x, y] = labelSpot(r.segs, 0.9, { x0: -2, x1: 3 });
  near(x, 2.5, 0.05); near(y, Math.log(x), 1e-9);
  const [x2] = labelSpot(r.segs, 0.1, { x0: -2, x1: 3 }); // −1.5 处没定义
  assert.ok(x2 > 0 && x2 < 0.2);
  assert.equal(labelSpot([], 0.5, { x0: 0, x1: 1 }), null);
});

test('够快', () => {
  const f = fn('x^3 - 3x');
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) sampleCurve(f, -3, 3, { ySpan: 10 });
  assert.ok(performance.now() - t0 < 1500, `${Math.round(performance.now() - t0)} ms`);
});
