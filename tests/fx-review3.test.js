// 视觉交互第 3 批（三维图）独立复查查出来的问题：一条一个能重现的测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { eig3, sectionArea, baseDepth, tangentPlane, curveTangent, rootsAlong, frameZ, clipPolyZ, linearPlane, revolveVolume } from '../kit/src/fx/solid.js';
import { parseSpace } from '../kit/src/spacespec.js';
import { evaluate } from '../kit/src/expr.js';

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('C1 特征值挨得近（相差百分之几、万分之几）一个都不丢；对称矩阵一定是三个方向', () => {
  const vals = (A) => eig3(A).map((e) => e.value);
  const dims = (A) => eig3(A).reduce((s, e) => s + e.vectors.length, 0);
  let v = vals([[2, 0.05, 0], [0.05, 2, 0], [0, 0, 2]]);
  assert.equal(v.length, 3); assert.ok(near(v[0], 1.95) && near(v[1], 2) && near(v[2], 2.05));
  v = vals([[10, 0, 0], [0, 10.2, 0], [0, 0, 10.4]]);
  assert.deepEqual(v.map((x) => Number(x.toFixed(6))), [10, 10.2, 10.4]);
  v = vals([[60, 1, 0], [1, 60, 1], [0, 1, 60]]);
  assert.equal(v.length, 3); assert.ok(near(v[0], 60 - Math.SQRT2) && near(v[2], 60 + Math.SQRT2));
  v = vals([[2.0001, 0, 0], [0, 2, 0], [0, 0, 3]]);
  assert.equal(dims([[2.0001, 0, 0], [0, 2, 0], [0, 0, 3]]), 3);
  assert.ok(near(v[v.length - 1], 3));
  for (const t of [0.01, 0.02, 0.03, 0.04, 0.05, 0.001, 1e-5]) assert.equal(dims([[2, t, 0], [t, 2, 0], [0, 0, 2]]), 3, `t = ${t}`);
  // 不对称、三个实根挨得近
  v = vals([[2, 1, 0], [0, 2.03, 1], [0, 0, 2.06]]);
  assert.equal(v.length, 3); assert.ok(near(v[0], 2) && near(v[1], 2.03) && near(v[2], 2.06));
  // 原来就对的不许坏：转动只有转轴；若尔当块重根一个方向；重根有一个平面；数量矩阵整个空间
  assert.equal(eig3([[0, -1, 0], [1, 0, 0], [0, 0, 1]]).length, 1);
  const jordan = eig3([[2, 1, 0], [0, 2, 0], [0, 0, 3]]);
  assert.deepEqual(jordan.map((e) => [Number(e.value.toFixed(6)), e.vectors.length]), [[2, 1], [3, 1]]);
  assert.deepEqual(eig3([[2, 0, 0], [0, 2, 0], [0, 0, 3]]).map((e) => e.vectors.length), [2, 1]);
  assert.deepEqual(eig3([[5, 0, 0], [0, 5, 0], [0, 0, 5]]).map((e) => e.vectors.length), [3]);
  assert.deepEqual(eig3([[1, 1, 1], [1, 1, 1], [1, 1, 1]]).map((e) => [Number(e.value.toFixed(6)) + 0, e.vectors.length]), [[0, 2], [3, 1]]);
  // 每个特征向量真的是特征向量
  for (const A of [[[2, 0.05, 0], [0.05, 2, 0], [0, 0, 2]], [[4, 1, -2], [1, 3, 0], [-2, 0, 5]], [[2, 1, 0], [0, 2.03, 1], [0, 0, 2.06]]]) {
    for (const e of eig3(A)) for (const u of e.vectors) {
      const Au = A.map((r) => r[0] * u[0] + r[1] * u[1] + r[2] * u[2]);
      assert.ok(Au.every((x, i) => Math.abs(x - e.value * u[i]) < 1e-6), `A = ${JSON.stringify(A)}，λ = ${e.value}`);
    }
  }
});

test('C2 截面正好在平的顶 / 底上：面积是那一面的面积，不是 0；球在赤道上算得出来', () => {
  const disk = { shape: 'r', lo: () => 0, hi: () => 2, a: 0, b: 2 * Math.PI };
  // 抛物面上面盖一张平面 z = 4：z₀ = 4 的截面是整个顶面
  const bowl = (x, y) => x * x + y * y, lid = () => 4;
  assert.ok(near(sectionArea(bowl, lid, disk, 4), 4 * Math.PI, 1e-3));
  assert.ok(near(sectionArea(bowl, lid, disk, 3.95), Math.PI * 3.95, 1e-3));
  assert.ok(near(sectionArea(bowl, lid, disk, 0), 0, 1e-3), '碗底那一点：面积是 0');
  assert.equal(sectionArea(bowl, lid, disk, 4.2), 0, '顶上面：截不到');
  // 四面体的底面
  const tri = { shape: 'y', lo: () => 0, hi: (x) => 1 - x, a: 0, b: 1 };
  assert.ok(near(sectionArea(() => 0, (x, y) => 1 - x - y, tri, 0), 0.5, 1e-4));
  // 球（直角坐标写的，上下两个根号）在赤道上：以前是 NaN
  const R2 = (x, y) => Math.sqrt(4 - x * x - y * y), xdisk = { shape: 'y', lo: (x) => -Math.sqrt(4 - x * x), hi: (x) => Math.sqrt(4 - x * x), a: -2, b: 2 };
  assert.ok(near(sectionArea((x, y) => -R2(x, y), R2, xdisk, 0), 4 * Math.PI, 2e-2));
  assert.ok(near(sectionArea((x, y) => -R2(x, y), R2, xdisk, 1), 3 * Math.PI, 2e-2));
  // 底写成比球大的矩形：球外面上下限没定义，那里没有立体，不是「算不出来」
  const rect = { rect: [-2, 2, -2, 2] };
  assert.ok(near(sectionArea((x, y) => -R2(x, y), R2, rect, 0), 4 * Math.PI, 5e-2));
  assert.ok(near(sectionArea((x, y) => -R2(x, y), R2, rect, 1), 3 * Math.PI, 5e-2));
});

test('C3 不可微的点上没有切平面；速度是零的点上没有切线', () => {
  const h = 1e-4;
  assert.equal(tangentPlane((x, y) => Math.hypot(x, y), 0, 0, h), null, '圆锥的顶点');
  assert.equal(tangentPlane((x, y) => -Math.abs(x) - 0.5, 0, 0.5, h), null, '棱上');
  assert.equal(tangentPlane((x, y) => Math.abs(x * y), 0, 1, h), null);
  assert.equal(tangentPlane((x, y) => Math.sqrt(1 - x * x - y * y), 2, 0, h), null, '没定义的地方');
  const t = tangentPlane((x, y) => x * x + y * y, 1, -1, h);
  assert.ok(near(t.p[2], 2) && near(t.n[0], -2, 1e-4) && near(t.n[1], 2, 1e-4) && t.n[2] === 1);
  assert.ok(tangentPlane((x, y) => Math.hypot(x, y), 0.3, 0.4, h), '圆锥上别的点照画');
  assert.ok(tangentPlane((x, y) => 40 * x * x, 0, 0, h), '弯得厉害但是光滑的：照画');
  assert.equal(curveTangent((s) => [s * s, s ** 3, 0], 0, h), null, '半立方抛物线的尖点');
  assert.equal(curveTangent((s) => [s - Math.sin(s) - 1, 0, 1 - Math.cos(s)], 0, h), null, '摆线的尖点');
  const u = curveTangent((s) => [Math.cos(s), Math.sin(s), s], 0, h);
  assert.ok(near(u[0], 0, 1e-6) && near(u[1], Math.SQRT1_2, 1e-6) && near(u[2], Math.SQRT1_2, 1e-6));
  assert.ok(curveTangent((s) => [s * s, s ** 3, 0], 0.5, h));
  assert.equal(curveTangent((s) => [Math.abs(s), s, 0], 0, h), null, '折线的拐角');
});

test('I1 竖直方向的对准：冲上天的曲面不把画面带走；伸出盒子的面片沿盒子裁开', () => {
  // z = 1/r²（r 从 0.2 到 2）：值从 0.25 到 25。范围写了 2：盒子贴着下面那一带
  const zs = [];
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const r = 0.2 + (1.8 * i) / 8; zs.push(1 / (r * r)); }
  const f = frameZ(zs, 2);
  assert.ok(f.zc >= 1.5 && f.zc <= 3.5, `zc = ${f.zc}`);
  // 都在盒子里放得下的：对准中间
  assert.deepEqual(frameZ([0, 1, 2, 3, 4], 3), { zc: 2, half: 2 });
  assert.deepEqual(frameZ([], 3), { zc: 0, half: 0 });
  // 没写范围：高度按去掉极端值以后的算，不被一两个冲天的点撑大
  const g = frameZ([...Array.from({ length: 60 }, (_, i) => i / 60), 500], null);
  assert.ok(g.half < 5, `half = ${g.half}`);
  // 一个四边形一半在盒子上面：裁出来的多边形都在盒子里，面积是一半
  const cut = clipPolyZ([[0, 0, 0], [1, 0, 0], [1, 0, 2], [0, 0, 2]], -1, 1);
  assert.ok(cut.every((p) => p[2] <= 1 + 1e-12 && p[2] >= -1 - 1e-12));
  assert.ok(near(Math.max(...cut.map((p) => p[2])), 1));
  assert.equal(clipPolyZ([[0, 0, 5], [1, 0, 5], [1, 1, 6]], -1, 1), null, '整个在外面');
  assert.equal(clipPolyZ([[0, 0, 0], [1, 0, 0], [1, 1, 0.5]], -1, 1).length, 3, '整个在里面：原样');
});

test('I2 极坐标的两个范围不论先后；直角坐标只认 x、y', () => {
  const base = (src) => parseSpace(src).cmds.find((c) => c.kind === 'surface' || c.kind === 'solid').base;
  assert.equal(base('surface z = x^2 + y^2 for t 0 2pi, r 0 1.5').kind, 'polar');
  assert.equal(base('surface z = x^2 + y^2 for theta 0 2pi, r 0 1.5').kind, 'polar');
  assert.equal(base('surface z = x^2 + y^2 for r 0 1.5, t 0 2pi').kind, 'polar');
  assert.equal(base('solid T = z from 0 to 1 for t 0 2pi, r 0 1').kind, 'polar');
  const b = base('surface z = x^2 + y^2 for t 0 pi, r 1 2');
  assert.ok(near(b.a({}), 0) && near(b.b({}), Math.PI) && b.lo({}) === 1 && b.hi({}) === 2);
  assert.equal(base('surface z = x*y for x 0 1, y 0 1 - x').kind, 'xy');
  assert.equal(base('surface z = x*y for y 0 1, x 0 y').kind, 'xy');
  assert.throws(() => parseSpace('surface z = x*y for a 0 1, b 0 1'), /x、y.*r、t/);
  assert.throws(() => parseSpace('surface z = x*y for x 0 1, x 0 1'), /x、y.*r、t/);
});

test('I3 pick 的目标能用变量（滑块、能拖的点）；写成一个数的照旧当场报', () => {
  const p = parseSpace('slider a -1 1 = 0.5\nlet A = [1, 0]\nsurface S = z = x for x -1 1, y -1 1\npick "点" at A, [a, 0]');
  const pick = p.cmds.find((c) => c.kind === 'pick');
  assert.deepEqual(pick.targets({ A: [1, 0], a: 0.5 }), [[1, 0], [0.5, 0]]);
  assert.throws(() => parseSpace('surface S = z = x for x -1 1, y -1 1\npick "点" at 3'), /\[x, y\]/);
});

test('I4 弧度的图里滑块像是按角度写的：软提醒', () => {
  const warn = (src) => parseSpace(src).notes || [];
  assert.match(warn('slider th 0 360 = 40 step=1\nsurface S = z = cos(th)*x for x -2 2, y -2 2').join('；'), /弧度.*th/);
  assert.match(warn('slider a 0 90 = 30\ncurve [cos(a)*t, sin(a)*t, t] for t 0 1').join('；'), /弧度/);
  assert.deepEqual(warn('slider th 0 2pi = 1\nsurface S = z = cos(th)*x for x -2 2, y -2 2'), []);
  assert.deepEqual(warn('slider k 0 360 = 40\nsurface S = z = k*x/100 for x -2 2, y -2 2'), [], '没放进三角函数里的不提');
  assert.deepEqual(warn('angle: rad\nslider th 0 360 = 40\nsurface S = z = cos(th)*x for x -2 2, y -2 2'), [], '明着写了 angle: rad 的不提');
  assert.deepEqual(warn('slider th 0 360 = 40\nvector [cos(th), sin(th), 0]'), [], '老的线代图按角度：不提');
});

test('I5 参数式在端点导数无穷的曲线、曲面：线积分、通量照样准', () => {
  assert.ok(near(evaluate('lineint3(0, x, 0, t, sqrt(1 - t^2), 0, t, -1, 1)'), -Math.PI / 2, 2e-5));
  assert.ok(near(evaluate('lineint3(0, 0, 1, 0, 0, sqrt(t), t, 0, 1)'), 1, 2e-5));
  assert.ok(near(evaluate('lineint3(0, 0, 1, 0, 0, t^(1/3), t, 0, 1)'), 1, 1e-4));
  assert.ok(near(evaluate('lineint(0, x, t, sqrt(1 - t^2), t, -1, 1)'), -Math.PI / 2, 2e-5));
  assert.ok(near(evaluate('flux(0, 0, 1, sqrt(u), v, 0, u, 0, 1, v, 0, 1)'), 1, 2e-5));
  // 原来就对的不许坏
  assert.ok(near(evaluate('lineint3(-y, x, 0, cos(t), sin(t), 0, t, 0, 2pi)'), 2 * Math.PI, 1e-7));
  assert.ok(near(evaluate('lineint(-y, x, cos(t), sin(t), t, 0, 2pi)'), 2 * Math.PI, 1e-7));
  assert.ok(near(evaluate('flux(x, y, z, sin(u)*cos(v), sin(u)*sin(v), cos(u), u, 0, pi, v, 0, 2pi)'), 4 * Math.PI, 1e-5));
});

test('I6 视线和曲面碰好几次：每一处都找得到（画面取最前面的；点在背面时画成空心、说一声）', () => {
  // 沿视线的高度差 g(d) = 0.5 − sin(d)：0 到 10 之间有四个根
  const hits = rootsAlong((d) => 0.5 - Math.sin(d), 0, 10, 240);
  assert.equal(hits.length, 4);
  [Math.PI / 6, (5 * Math.PI) / 6, (13 * Math.PI) / 6, (17 * Math.PI) / 6].forEach((x, i) => assert.ok(near(hits[i], x, 1e-6)));
  assert.deepEqual(rootsAlong(() => 1, 0, 10, 50), []);
  // 中间有没定义的一段：两边的不连成一个假根
  assert.equal(rootsAlong((d) => (d > 4 && d < 6 ? NaN : d - 5), 0, 10, 100).length, 0);
});

test('I7 区域的两条线交叉以后：在不在里面、截面面积、画的是同一块（两条线之间）', () => {
  const base = { shape: 'y', lo: (x) => x * x, hi: (x) => 0.5 * x, a: 0, b: 1 };
  assert.ok(baseDepth(base, 0.25, 0.1) > 0, '交点左边：x² < y < x/2');
  assert.ok(baseDepth(base, 0.8, 0.5) > 0, '交点右边：x/2 < y < x²，也算在两条线之间');
  assert.ok(baseDepth(base, 0.8, 0.9) < 0);
  // ∫₀¹ |x/2 − x²| dx = 1/8
  assert.ok(near(sectionArea(() => 0, () => 1, base, 0.5), 0.125, 1e-4));
});

test('别的：不是一次式的 plane 不当成平面；旋转绕 y 轴时 x 跨过 0 照实说', () => {
  assert.deepEqual(linearPlane((x, y, z) => 2 * x - y + 3 * z - 6), [2, -1, 3, -6]);
  assert.equal(linearPlane((x, y) => x * x + y - 1), null);
  assert.equal(linearPlane((x, y, z) => Math.abs(x) + z - 1), null);
  assert.equal(linearPlane((x, y, z) => x * y + z), null);
  assert.ok(near(revolveVolume((x) => x * x, 0, 1, 'y'), Math.PI / 2));
  assert.ok(Number.isNaN(revolveVolume((x) => x * x, -1, 1, 'y')), 'x 跨过 0：左右两半转出来是同一个立体，体积不能两边都算');
});
