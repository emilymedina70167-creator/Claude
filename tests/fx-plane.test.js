// 视觉交互第 2 批 Task 3：平面上的几何（等值线、参数曲线、方向场、解曲线、区域、往曲线上投影）
import test from 'node:test';
import assert from 'node:assert/strict';
import { contourLines, paramCurve, slopeMarks, fieldArrows, flowLine, flowField, typedRegion, stripOf, whereRuns, projectTo, PLANE_MAX_GRID, PLANE_MAX_LEVELS } from '../kit/src/fx/plane.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}（容差 ${e}）`);
const box = { x0: -3, x1: 3, y0: -3, y1: 3 };
const shoelace = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
const all = (lines) => lines.flat();
const hasNear = (lines, x, y, r = 0.25) => all(lines).some(([px, py]) => Math.hypot(px - x, py - y) < r);

test('圆：一条闭合的等值线，点都在圆上', () => {
  const ls = contourLines((x, y) => x * x + y * y, 1, box);
  assert.equal(ls.length, 1);
  const l = ls[0];
  assert.ok(Math.hypot(l[0][0] - l.at(-1)[0], l[0][1] - l.at(-1)[1]) < 0.05, '没闭合');
  for (const [x, y] of l) near(Math.hypot(x, y), 1, 5e-3);
  assert.ok(l.length > 40);
});

test('鞍点：两条相交的线都画出来', () => {
  for (const F of [(x, y) => x * x - y * y, (x, y) => x * y]) {
    const ls = contourLines(F, 0, box);
    for (const [x, y] of all(ls)) assert.ok(Math.abs(F(x, y)) < 0.02, `(${x}, ${y}) 不在线上`);
  }
  const d = contourLines((x, y) => x * x - y * y, 0, box);
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) assert.ok(hasNear(d, 1.5 * sx, 1.5 * sy), `(${1.5 * sx}, ${1.5 * sy}) 那一支没画`);
  const a = contourLines((x, y) => x * y, 0, box);
  for (const [px, py] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) assert.ok(hasNear(a, px, py), `(${px}, ${py}) 那一支没画`);
});

test('双曲线：两支，不相连', () => {
  const ls = contourLines((x, y) => x * x - y * y, 1, box);
  assert.equal(ls.length, 2);
  assert.ok(ls.every((l) => l.every(([x]) => x > 0) || l.every(([x]) => x < 0)));
});

test('一部分没定义的函数：只在有定义的地方有线', () => {
  const ls = contourLines((x, y) => Math.sqrt(x) - y, 0, box);
  assert.ok(all(ls).length > 10);
  assert.ok(all(ls).every(([x]) => x >= 0));
  assert.deepEqual(contourLines(() => NaN, 0, box), []);
  assert.deepEqual(contourLines((x, y) => x + y, 100, box), []);
});

test('参数曲线：闭合的一段；没定义的点断开', () => {
  const c = paramCurve((t) => [Math.cos(t), Math.sin(t)], 0, 2 * Math.PI);
  assert.equal(c.length, 1);
  near(c[0][0][0], 1); near(c[0].at(-1)[0], 1, 1e-9);
  const h = paramCurve((t) => [t, 1 / t], -1, 1, { n: 200 });
  assert.equal(h.length, 2);
  assert.ok(h[0].every(([x]) => x < 0) && h[1].every(([x]) => x > 0));
  // 跳得太远也断开（tan 那样从 +∞ 回到 −∞）
  const t = paramCurve((s) => [s, Math.tan(s)], -3, 3, { n: 600, box });
  assert.ok(t.length >= 3);
});

test('方向场：每一小段的斜率就是那一点的 F', () => {
  const m = slopeMarks((x, y) => y, box);
  assert.equal(m.length, 17 * 11);
  for (const s of m) near(s.dy / s.dx, s.y, 1e-9);
  const g = slopeMarks((x, y) => x, box, { nx: 5, ny: 3 });
  assert.equal(g.length, 15);
  // 每一段在屏幕上一样长：不传 aspect 时按数学坐标
  const L = (s) => Math.hypot(s.dx, s.dy);
  for (const s of g) near(L(s), L(g[0]), 1e-9);
  // 没定义的格点不画
  assert.ok(slopeMarks((x, y) => 1 / (x * 0), box).length === 0);
});

test('向量场：箭头的方向对、长度有上下限', () => {
  const a = fieldArrows((x, y) => -y, (x, y) => x, box, { nx: 7, ny: 7 });
  assert.equal(a.length, 49 - 1); // 原点是零向量，不画
  for (const s of a) near(s.dx * s.x + s.dy * s.y, 0, 1e-9); // 垂直于位置向量
  const step = 6 / 6, lens = a.map((s) => Math.hypot(s.dx, s.dy));
  assert.ok(Math.max(...lens) <= step * 0.85 + 1e-9 && Math.min(...lens) >= step * 0.2 - 1e-9);
});

test('解曲线：y′ = y 过 (0, 1) 是 eˣ；冲向无穷的画到窗口边就停', () => {
  const l = flowLine((x, y) => y, [0, 1], box);
  assert.ok(l.length > 20);
  for (const [x, y] of l) assert.ok(Math.abs(y - Math.exp(x)) <= 1e-4 * Math.max(1, Math.exp(x)), `(${x}, ${y})`);
  assert.ok(l[0][0] < -2.5); // 往左也走了
  const b = flowLine((x, y) => y * y, [0, 1], box);
  assert.ok(b.length < 4000);
  assert.ok(b.every(([, y]) => Number.isFinite(y) && y <= 3 + 6 * 0.2 + 1e-9));
  assert.deepEqual(flowLine(() => NaN, [0, 0], box), [[0, 0]]);
});

test('流线：沿向量场 (−y, x) 走是圆', () => {
  const l = flowField((x, y) => -y, (x, y) => x, [1, 0], box);
  assert.ok(l.length > 30);
  for (const [x, y] of l) near(Math.hypot(x, y), 1, 1e-3);
});

test('区域：X 型、极坐标、边界有没定义的地方', () => {
  const r = typedRegion('y', (x) => x * x, (x) => x, 0, 1);
  assert.equal(r.ok, true);
  near(shoelace(r.poly), 1 / 6, 1e-3);
  const y = typedRegion('x', (t) => t * t, (t) => t, 0, 1); // Y 型：同一块的镜像
  near(shoelace(y.poly), 1 / 6, 1e-3);
  assert.ok(y.poly.every(([px, py]) => px <= py + 1e-9));
  const p = typedRegion('r', () => 0, (t) => 1 + Math.cos(t), 0, 2 * Math.PI);
  near(shoelace(p.poly), (3 * Math.PI) / 2, 1e-2);
  const h = typedRegion('y', () => 0, (x) => Math.sqrt(1 - x * x), -2, 2);
  assert.equal(h.ok, false);
  assert.ok(h.poly.every(([px]) => px >= -1 - 1e-9 && px <= 1 + 1e-9));
  near(shoelace(h.poly), Math.PI / 2, 2e-2);
});

test('区域里的一条：上下限页面读', () => {
  const s = stripOf('y', (x) => x * x, (x) => x, 0.5);
  near(s.lo, 0.25); near(s.hi, 0.5);
  assert.deepEqual(s.from, [0.5, 0.25]); assert.deepEqual(s.to, [0.5, 0.5]);
  const t = stripOf('x', (y) => y * y, (y) => y, 0.5);
  assert.deepEqual(t.from, [0.25, 0.5]); assert.deepEqual(t.to, [0.5, 0.5]);
  const p = stripOf('r', () => 0, () => 2, Math.PI / 2);
  near(p.to[0], 0, 1e-12); near(p.to[1], 2);
  assert.equal(stripOf('y', () => 0, (x) => Math.sqrt(1 - x * x), 1.5), null);
});

test('条件围的区域：一行行的矩形，面积对', () => {
  const runs = whereRuns((x, y) => x + y <= 1 && x >= 0 && y >= 0, { x0: -0.2, x1: 1.2, y0: -0.2, y1: 1.2 });
  const area = runs.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
  near(area, 0.5, 5e-3);
  assert.ok(runs.length < 2000);
  assert.deepEqual(whereRuns(() => false, box), []);
  const full = whereRuns(() => true, box);
  near(full.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0), 36, 1e-9);
});

test('把点投到曲线上', () => {
  const G = (x, y) => x * x + y * y - 4;
  const p = projectTo(G, [3, 0.1]);
  assert.ok(Math.abs(G(...p)) < 1e-8);
  assert.ok(p[0] > 1.9);
  near(p[1] / p[0], 0.1 / 3, 1e-3); // 沿半径投回去
  assert.equal(projectTo(() => 1, [0, 0]), null);
  assert.equal(projectTo(G, [0, 0]), null); // 梯度是零，没有方向
});

test('上限和速度', () => {
  assert.equal(PLANE_MAX_GRID, 120); assert.equal(PLANE_MAX_LEVELS, 12);
  // 网格不超过上限
  const ls = contourLines((x, y) => x * x + y * y, 1, box, { nx: 5000, ny: 5000 });
  assert.ok(all(ls).length < 4 * 120 * 4);
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) contourLines((x, y) => x * x + 2 * y * y, 1 + i * 0.1, box);
  assert.ok(performance.now() - t0 < 1200, `${Math.round(performance.now() - t0)} ms`);
});

test('等值线沿着网格线、在格点上相交（xy = 0）：两条轴都走到原点，不在原点旁边切角', () => {
  const ls = contourLines((x, y) => x * y, 0, { x0: -3, x1: 3, y0: -3, y1: 3 }, { nx: 96, ny: 96 });
  let throughOrigin = 0;
  for (const l of ls) {
    for (let i = 1; i < l.length; i++) {
      const dx = Math.abs(l[i][0] - l[i - 1][0]), dy = Math.abs(l[i][1] - l[i - 1][1]);
      assert.ok(dx < 1e-9 || dy < 1e-9, `斜着切了一刀：${JSON.stringify(l[i - 1])} → ${JSON.stringify(l[i])}`);
    }
    if (l.some(([x, y]) => Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9)) throughOrigin++;
  }
  assert.ok(throughOrigin >= 1, '没有一条线过原点');
  // 四个方向都画到了
  const far = (px, py) => ls.some((l) => l.some(([x, y]) => Math.abs(x - px) < 0.05 && Math.abs(y - py) < 0.05));
  assert.ok(far(2.9, 0) && far(-2.9, 0) && far(0, 2.9) && far(0, -2.9));
});

test('区域的边界只在一段上有定义：画到定义域的边上（二分找边），陡的地方加密', () => {
  const E = Math.sqrt(1.1);
  const r = typedRegion('y', () => 0, (x) => Math.sqrt(1.1 - x * x), -2, 2);
  assert.equal(r.polys.length, 1);
  const xs = r.poly.map((p) => p[0]);
  assert.ok(Math.abs(Math.min(...xs) + E) < 1e-4, `左边到 ${Math.min(...xs)}`);
  assert.ok(Math.abs(Math.max(...xs) - E) < 1e-4, `右边到 ${Math.max(...xs)}`);
  assert.equal(r.ok, false);
  // 上边界（多边形的后一半）相邻两点的高差不大：圆在两头是竖的，均匀采样第一段就跳 0.26
  const top = r.poly.filter((p) => p[1] > 1e-9 || Math.abs(Math.abs(p[0]) - E) < 1e-3);
  for (let i = 1; i < top.length; i++) assert.ok(Math.abs(top[i][1] - top[i - 1][1]) < 0.08, `跳了 ${Math.abs(top[i][1] - top[i - 1][1])}`);
});

test('区域的边界在中间一段没定义：分成两块，不连成一块', () => {
  const r = typedRegion('y', () => 0, (x) => Math.sqrt(x * x - 1), -2, 2);
  assert.equal(r.polys.length, 2);
  assert.ok(r.polys[0].every((p) => p[0] <= -1 + 1e-4) && r.polys[1].every((p) => p[0] >= 1 - 1e-4));
});
