// 视觉交互第 1 批 Task 6：函数图的几何（黎曼和的矩形、两线之间的面积、标签让位）
import test from 'node:test';
import assert from 'node:assert/strict';
import { riemannRects, betweenArea, placeLabels, areaBetween } from '../kit/src/fx/graphgeom.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}（容差 ${e}）`);
const sq = (x) => x * x;

test('黎曼和：左、右、中点', () => {
  const l = riemannRects(sq, 0, 1, 4, 'left');
  assert.equal(l.rects.length, 4);
  near(l.sum, 0.21875);
  assert.deepEqual(l.rects[1], { x0: 0.25, x1: 0.5, y: 0.0625, xs: 0.25 });
  near(riemannRects(sq, 0, 1, 4, 'right').sum, 0.46875);
  near(riemannRects(sq, 0, 1, 4, 'mid').sum, 0.328125);
  near(riemannRects(sq, 0, 1, 4, 'mid').rects[0].xs, 0.125);
});

test('n 取整、限制在 1～500', () => {
  assert.equal(riemannRects(sq, 0, 1, 0, 'left').rects.length, 1);
  assert.equal(riemannRects(sq, 0, 1, 9999, 'left').rects.length, 500);
  assert.equal(riemannRects(sq, 0, 1, 3.6, 'left').rects.length, 4);
  assert.equal(riemannRects(sq, 0, 1, NaN, 'left').rects.length, 1);
});

test('下限比上限大：和是负的（和定积分一致）', () => {
  near(riemannRects(sq, 1, 0, 4, 'mid').sum, -0.328125);
});

test('取样点没定义：那一块不画，和是 NaN', () => {
  const r = riemannRects((x) => 1 / x, 0, 1, 4, 'left');
  assert.equal(r.rects.length, 3);
  assert.ok(Number.isNaN(r.sum));
});

test('两条曲线之间：面积是 ∫|f − g|', () => {
  const r = betweenArea((x) => x, sq, 0, 1);
  near(r.area, 1 / 6, 1e-4);
  assert.equal(r.poly[0][0], r.poly.at(-1)[0]); // 沿 f 去、沿 g 回，回到出发的那条竖线
  near(betweenArea(Math.sin, Math.cos, 0, Math.PI).area, 2 * Math.SQRT2, 1e-3);
  assert.ok(Number.isNaN(betweenArea((x) => 1 / x, sq, -1, 1, 4).area)); // 中间有没定义的点：面积不给数
});

test('areaBetween：读数用的面积要准（能认成 1/6）', () => {
  near(areaBetween((x) => x, sq, 0, 1), 1 / 6, 1e-9);
  near(areaBetween(Math.sin, Math.cos, 0, Math.PI), 2 * Math.SQRT2, 1e-7);
  assert.ok(Number.isNaN(areaBetween((x) => 1 / x, sq, -1, 1)));
});

test('标签互相让开，不出框', () => {
  const box = { x0: 0, y0: 0, x1: 300, y1: 200 };
  const out = placeLabels([{ x: 100, y: 100, w: 60, h: 20 }, { x: 100, y: 100, w: 60, h: 20 }, { x: 105, y: 102, w: 60, h: 20 }], box);
  const rect = ([x, y], i) => ({ l: x - 30, r: x + 30, t: y - 10, b: y + 10, i });
  const rs = out.map(rect);
  for (const p of rs) for (const q of rs) if (p.i < q.i) assert.ok(p.r <= q.l || q.r <= p.l || p.b <= q.t || q.b <= p.t, `第 ${p.i}、${q.i} 个还叠着`);
  for (const p of rs) assert.ok(p.l >= 0 && p.r <= 300 && p.t >= 0 && p.b <= 200);
  // 不叠的不动
  assert.deepEqual(placeLabels([{ x: 50, y: 50, w: 20, h: 10 }, { x: 200, y: 150, w: 20, h: 10 }], box), [[50, 50], [200, 150]]);
  // 贴着边的拉回框里
  assert.deepEqual(placeLabels([{ x: 295, y: 5, w: 40, h: 20 }], box), [[280, 10]]);
});
