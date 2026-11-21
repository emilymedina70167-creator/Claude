// 视觉交互第 3 批 Task 2：三维的几何（kit/src/fx/solid.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  meshGrid, meshOver, sliceLines, planeFrom, planeMeet2, planes3, splitPolygon, splitAll,
  revolveMesh, revolveVolume, revolveArea, solidBounds, columnOf, crossSection, fieldArrows3, eig3, SOLID_MAX_QUADS,
} from '../kit/src/fx/solid.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}（容差 ${e}）`);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a);
const area = (poly) => { let s = [0, 0, 0]; for (let i = 1; i + 1 < poly.length; i++) { const c = cross(poly[i].map((x, k) => x - poly[0][k]), poly[i + 1].map((x, k) => x - poly[0][k])); s = s.map((x, k) => x + c[k]); } return len(s) / 2; };

test('meshGrid：参数曲面的点和四边形；没定义的点不进四边形', () => {
  const m = meshGrid((u, v) => [u, v, u * v], [0, 1], [0, 2], { nu: 4, nv: 6 });
  assert.equal(m.pts.length, 5 * 7); assert.equal(m.quads.length, 4 * 6);
  assert.deepEqual(m.pts[0], [0, 0, 0]); assert.deepEqual(m.pts.at(-1), [1, 2, 2]);
  for (const q of m.quads) assert.equal(q.length, 4);
  const cap = meshGrid((x, y) => [x, y, Math.sqrt(1 - x * x - y * y)], [-1.5, 1.5], [-1.5, 1.5], { nu: 12, nv: 12 });
  assert.ok(cap.quads.length > 0 && cap.quads.length < 144);
  for (const q of cap.quads) for (const i of q) assert.ok(cap.pts[i] && cap.pts[i].every(Number.isFinite));
  assert.ok(cap.pts.some((p) => p === null));
  // 太密的自动减稀
  const big = meshGrid((u, v) => [u, v, 0], [0, 1], [0, 1], { nu: 200, nv: 200 });
  assert.ok(big.quads.length <= SOLID_MAX_QUADS);
});

test('meshOver：显式曲面贴着区域的边（X 型、极坐标）', () => {
  const f = (x, y) => x + y;
  const tri = meshOver(f, { shape: 'y', lo: () => 0, hi: (x) => 1 - x, a: 0, b: 1 }, { n: 8, m: 8 });
  for (const p of tri.pts) { assert.ok(p[0] >= -1e-9 && p[1] >= -1e-9 && p[0] + p[1] <= 1 + 1e-9); near(p[2], p[0] + p[1]); }
  assert.ok(tri.pts.some((p) => Math.abs(p[0] + p[1] - 1) < 1e-9 && p[0] > 0.1 && p[0] < 0.9), '斜边上有点');
  const disk = meshOver((x, y) => x * x + y * y, { shape: 'r', lo: () => 0, hi: () => 2, a: 0, b: 2 * Math.PI }, { n: 24, m: 6 });
  const rmax = Math.max(...disk.pts.map((p) => Math.hypot(p[0], p[1])));
  near(rmax, 2, 1e-9);
  for (const p of disk.pts) near(p[2], p[0] * p[0] + p[1] * p[1], 1e-9);
  const rect = meshOver(f, { rect: [0, 2, -1, 1] }, { n: 4, m: 4 });
  assert.equal(rect.pts.length, 25); assert.deepEqual(rect.pts[0], [0, -1, -1]);
});

test('sliceLines：任意方程的曲面按三族截痕画（球、双叶双曲面、锥面、柱面）', () => {
  const box = { x0: -3, x1: 3, y0: -3, y1: 3, z0: -3, z1: 3 };
  const s = sliceLines((x, y, z) => x * x + y * y + z * z - 4, box, { n: 9, grid: 48 });
  assert.equal(s.z.length, 9);
  // 中间那张（z = 0）是半径 2 的圆
  const mid = s.z[4];
  assert.ok(mid.lines.length >= 1); near(mid.at, 0, 1e-12);
  for (const l of mid.lines) for (const p of l) { near(p[2], 0, 1e-12); near(Math.hypot(p[0], p[1]), 2, 0.02); }
  // 最外面的两张（|z| = 3 > 2）没有线
  assert.equal(s.z[0].lines.length, 0); assert.equal(s.z[8].lines.length, 0);
  for (const fam of ['x', 'y', 'z']) for (const sl of s[fam]) for (const l of sl.lines) for (const p of l) near(p[0] * p[0] + p[1] * p[1] + p[2] * p[2], 4, 0.08);
  // 双叶双曲面 z² − x² − y² = 1：上下两叶都有线
  const two = sliceLines((x, y, z) => z * z - x * x - y * y - 1, box, { n: 9, grid: 48 });
  const zs = two.x.flatMap((sl) => sl.lines.flat().map((p) => p[2]));
  assert.ok(zs.some((z) => z > 1) && zs.some((z) => z < -1) && !zs.some((z) => Math.abs(z) < 0.9));
  // 柱面 x² + y² = 1：z 的每一张都是圆，x、y 的截痕是竖线
  const cyl = sliceLines((x, y) => x * x + y * y - 1, box, { n: 7, grid: 48 });
  for (const sl of cyl.z) assert.ok(sl.lines.length >= 1);
  assert.ok(cyl.x.some((sl) => sl.lines.length >= 2));
});

test('平面：从方程来、两个平面的交线', () => {
  const p1 = planeFrom(1, 1, 1, 1), p2 = planeFrom(1, -1, 0, 0);
  near(dot(p1.n, p1.p0), 1); assert.deepEqual(p1.n, [1, 1, 1]);
  assert.equal(planeFrom(0, 0, 0, 1), null);
  const m = planeMeet2(p1, p2);
  near(len(cross(m.d, [1, 1, -2])), 0, 1e-9);
  near(dot(p1.n, m.p), 1, 1e-9); near(dot(p2.n, m.p), 0, 1e-9);
  assert.equal(planeMeet2(p1, planeFrom(2, 2, 2, 5)), null);
  assert.deepEqual(planeMeet2(p1, planeFrom(2, 2, 2, 2)), { same: true });
});

test('三个平面的八种情形：秩和说法都对', () => {
  const P = (a, b, c, d) => planeFrom(a, b, c, d);
  const cases = [
    ['point', [P(1, 0, 0, 1), P(0, 1, 0, 2), P(0, 0, 1, 3)], 3, 3],
    ['line', [P(1, 0, 0, 0), P(0, 1, 0, 0), P(1, 1, 0, 0)], 2, 2],
    ['plane', [P(1, 1, 1, 1), P(2, 2, 2, 2), P(-1, -1, -1, -1)], 1, 1],
    ['parallel', [P(0, 0, 1, 0), P(0, 0, 1, 1), P(0, 0, 1, 2)], 1, 2],
    ['two-parallel', [P(0, 0, 1, 0), P(0, 0, 1, 1), P(1, 0, 0, 0)], 2, 3],
    ['prism', [P(1, 0, 0, 0), P(0, 1, 0, 0), P(1, 1, 0, 1)], 2, 3],
    ['two-same', [P(0, 0, 1, 0), P(0, 0, 2, 0), P(1, 0, 0, 0)], 2, 2],
    ['two-same-parallel', [P(0, 0, 1, 0), P(0, 0, 2, 0), P(0, 0, 1, 1)], 1, 2],
  ];
  for (const [kind, ps, ra, rab] of cases) {
    const r = planes3(...ps);
    assert.equal(r.kind, kind, `${kind}：页面说 ${r.kind}`);
    assert.equal(r.rankA, ra); assert.equal(r.rankAb, rab);
    assert.match(r.text, /r\(A\) = \d/);
  }
  assert.deepEqual(planes3(...cases[0][1]).point.map((x) => Math.round(x * 1e9) / 1e9), [1, 2, 3]);
  const ln = planes3(...cases[1][1]).line;
  near(len(cross(ln.d, [0, 0, 1])), 0, 1e-9);
  assert.match(planes3(...cases[5][1]).text, /三棱柱/);
  assert.match(planes3(...cases[0][1]).text, /唯一解/);
  // 接近退化：差 1e-12 当成退化
  assert.equal(planes3(P(1, 0, 0, 0), P(0, 1, 0, 0), P(1, 1, 1e-12, 0)).kind, 'line');
});

test('多边形被平面切开', () => {
  const sq = [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]];
  const [f, b] = splitPolygon(sq, { n: [1, 0, 0], p0: [0, 0, 0] });
  near(area(f), 2); near(area(b), 2);
  for (const p of f) assert.ok(p[0] >= -1e-12); for (const p of b) assert.ok(p[0] <= 1e-12);
  const [f2, b2] = splitPolygon(sq, { n: [1, 0, 0], p0: [5, 0, 0] });
  assert.equal(f2, null); near(area(b2), 4);
  // 和多边形同一个平面的：不切
  const [f3, b3] = splitPolygon(sq, { n: [0, 0, 1], p0: [0, 0, 0] });
  assert.ok((f3 === null) !== (b3 === null));
  // 三张坐标面互相切：每张 4 块，面积不变
  const planes = [{ n: [1, 0, 0], p0: [0, 0, 0] }, { n: [0, 1, 0], p0: [0, 0, 0] }, { n: [0, 0, 1], p0: [0, 0, 0] }];
  const polys = [
    { poly: [[0, -1, -1], [0, 1, -1], [0, 1, 1], [0, -1, 1]], of: 0 },
    { poly: [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]], of: 1 },
    { poly: sq, of: 2 },
  ];
  const out = splitAll(polys, planes);
  assert.equal(out.length, 12);
  for (const k of [0, 1, 2]) near(out.filter((o) => o.of === k).reduce((s, o) => s + area(o.poly), 0), 4);
});

test('旋转体：网格、体积（圆盘法、柱壳法）、侧面积', () => {
  const m = revolveMesh((x) => Math.sqrt(x), [0, 4], 'x', { n: 16, m: 24 });
  for (const p of m.pts) near(Math.hypot(p[1], p[2]), Math.sqrt(p[0]), 1e-9);
  const half = revolveMesh((x) => 1, [0, 1], 'x', { n: 2, m: 12, upTo: Math.PI });
  assert.ok(half.pts.every((p) => p[2] >= -1e-9), '转半圈：都在上半边');
  const y = revolveMesh((x) => x * x, [0, 1], 'y', { n: 8, m: 16 });
  for (const p of y.pts) near(p[2], (p[0] * p[0] + p[1] * p[1]), 1e-9); // 绕 y 轴（图里竖着的那根是 z）：高 = f(到轴的距离)
  near(revolveVolume((x) => Math.sqrt(x), 0, 4, 'x'), 8 * Math.PI, 1e-7);
  near(revolveVolume((x) => x * x, 0, 1, 'y'), Math.PI / 2, 1e-8);
  // 球带的侧面积 2πrh：y = sqrt(1 − x²) 在 [−0.5, 0.5]
  near(revolveArea((x) => Math.sqrt(1 - x * x), (x) => -x / Math.sqrt(1 - x * x), -0.5, 0.5), 2 * Math.PI, 1e-7);
});

test('两张曲面之间的区域：上下两张、柱、截面', () => {
  const lo = (x, y) => x * x + y * y, hi = () => 4;
  const base = { shape: 'r', lo: () => 0, hi: () => 2, a: 0, b: 2 * Math.PI };
  const s = solidBounds(lo, hi, base, { n: 16, m: 6 });
  for (const p of s.top.pts) near(p[2], 4); for (const p of s.bottom.pts) near(p[2], p[0] * p[0] + p[1] * p[1], 1e-9);
  assert.ok(s.walls.length >= 1);
  for (const w of s.walls) for (const p of w) assert.ok(p.every(Number.isFinite));
  assert.deepEqual(columnOf(lo, hi, base, 1, 0), { z0: 1, z1: 4 });
  assert.equal(columnOf(lo, hi, base, 3, 0), null, '底的外面没有柱');
  // z = 1 截出半径 1 的圆
  const cs = crossSection(lo, hi, base, 1, { grid: 64 });
  assert.ok(cs.length >= 1);
  for (const l of cs) for (const p of l) { near(p[2], 1, 1e-12); near(Math.hypot(p[0], p[1]), 1, 0.03); }
  // 球被 z = 1 截：半径 √3
  const ball = { shape: 'r', lo: () => 0, hi: () => 2, a: 0, b: 2 * Math.PI };
  const top = (x, y) => Math.sqrt(4 - x * x - y * y), bot = (x, y) => -Math.sqrt(4 - x * x - y * y);
  for (const l of crossSection(bot, top, ball, 1, { grid: 64 })) for (const p of l) near(Math.hypot(p[0], p[1]), Math.sqrt(3), 0.04);
  assert.equal(crossSection(bot, top, ball, 2.5, { grid: 64 }).length, 0);
});

test('空间向量场的箭头：零向量不画，长度有上限', () => {
  const box = { x0: -2, x1: 2, y0: -2, y1: 2, z0: -2, z1: 2 };
  const a = fieldArrows3((x) => x, (x, y) => y, (x, y, z) => z, box, 3);
  assert.equal(a.length, 26, '27 个格点里原点是零向量');
  const step = 2;
  for (const { p, d } of a) { assert.ok(len(d) <= step * 0.9 + 1e-9); near(len(cross(p, d)), 0, 1e-9); }
});

test('三阶矩阵的实特征方向', () => {
  const r = eig3([[2, 0, 0], [0, 3, 4], [0, 4, 9]]);
  assert.deepEqual(r.map((e) => Math.round(e.value * 1e9) / 1e9), [1, 2, 11]);
  for (const e of r) for (const v of e.vectors) { near(len(v), 1); const Av = [[2, 0, 0], [0, 3, 4], [0, 4, 9]].map((row) => dot(row, v)); near(len(cross(Av, v)), 0, 1e-8); }
  // 绕 z 轴转 90°：只有一个实特征值 1，方向是 z 轴
  const rot = eig3([[0, -1, 0], [1, 0, 0], [0, 0, 1]]);
  assert.equal(rot.length, 1); near(rot[0].value, 1); near(Math.abs(rot[0].vectors[0][2]), 1, 1e-9);
  // 重根有两个方向（一个平面）
  const dbl = eig3([[2, 0, 0], [0, 2, 0], [0, 0, 5]]);
  assert.equal(dbl.length, 2); assert.equal(dbl.find((e) => Math.abs(e.value - 2) < 1e-9).vectors.length, 2);
  // 重根只有一个方向（不可对角化）
  const jord = eig3([[2, 1, 0], [0, 2, 0], [0, 0, 3]]);
  assert.equal(jord.find((e) => Math.abs(e.value - 2) < 1e-9).vectors.length, 1);
  // 数量矩阵：整个空间
  assert.equal(eig3([[2, 0, 0], [0, 2, 0], [0, 0, 2]])[0].vectors.length, 3);
});

test('表达式里的 dist / angleof / angledeg：点、平面 [a, b, c, d]、直线 [[点], [方向]]', async () => {
  const { evaluate } = await import('../kit/src/expr.js');
  const v = { A: [1, 2, 3], p1: [0, 0, 1, 1], p2: [1, 0, 0, 0], l1: [[0, 0, 0], [1, 1, 0]], l2: [[0, 0, 5], [1, 0, 0]] };
  near(evaluate('dist(A, p1)', v), 2);
  near(evaluate('dist(p1, A)', v), 2);
  near(evaluate('dist(A, [1, 2, 0])', v), 3);
  near(evaluate('dist(A, l1)', v), Math.hypot(3, Math.SQRT1_2));
  near(evaluate('angleof(p1, p2)', v), Math.PI / 2);
  near(evaluate('angledeg(l1, l2)', v), 45);
  near(evaluate('angledeg(l1, p2)', v), 45);
  near(evaluate('angledeg([1, 0, 0], [-1, 0, 0])', v), 180);
  near(evaluate('angledeg(p1, [0, 0, 2, 5])', v), 0);
  assert.throws(() => evaluate('dist(1, 2)', v), /dist/);
  assert.throws(() => evaluate('angleof(A, p1)', v), /angleof/);
});

test('截面的面积、平面在盒子里的那一块', async () => {
  const { sectionArea, planeInBox } = await import('../kit/src/fx/solid.js');
  const base = { shape: 'r', lo: () => 0, hi: () => 2, a: 0, b: 2 * Math.PI };
  near(sectionArea((x, y) => x * x + y * y, () => 4, base, 1), Math.PI, 5e-3);
  near(sectionArea((x, y) => -Math.sqrt(4 - x * x - y * y), (x, y) => Math.sqrt(4 - x * x - y * y), base, 1), 3 * Math.PI, 2e-2);
  assert.equal(sectionArea((x, y) => x * x + y * y, () => 4, base, 5), 0);
  const box = { x0: -1, x1: 1, y0: -1, y1: 1, z0: -1, z1: 1 };
  const sq = planeInBox({ n: [0, 0, 1], p0: [0, 0, 0.5] }, box);
  assert.equal(sq.length, 4); near(area(sq), 4); for (const p of sq) near(p[2], 0.5);
  const hex = planeInBox({ n: [1, 1, 1], p0: [0, 0, 0] }, box);
  assert.equal(hex.length, 6); for (const p of hex) near(p[0] + p[1] + p[2], 0, 1e-9);
  assert.equal(planeInBox({ n: [0, 0, 1], p0: [0, 0, 5] }, box), null);
});
