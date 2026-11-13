// 第九轮 Task 4：老师摆过的归老师（钉住、arrange、压着 / 出了屏幕照实说）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridOf, fromCells } from '../kit/src/stage/compose/grid.js';
import { solveLayout } from '../kit/src/stage/compose/solve.js';
import { layoutLines } from '../kit/src/stage/compose/report.js';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';

const canvas = { w: 1376, h: 900 };
const grid = gridOf(canvas);
const it = (id, w, h, more = {}) => ({ id, w, h, order: more.order ?? 0, ...more });

test('钉住的照原样，新东西绕开它', () => {
  const r = solveLayout({ canvas, grid, items: [it('s', 600, 200, { pinned: true, prev: { x: 300, y: 100 } }), it('n', 400, 150, { order: 1 })], relations: [] });
  assert.deepEqual([r.boxes.get('s').x, r.boxes.get('s').y], [300, 100]);
  const s = r.boxes.get('s'), n = r.boxes.get('n');
  assert.ok(n.x >= s.x + s.w || n.x + n.w <= s.x || n.y >= s.y + s.h || n.y + n.h <= s.y);
});

test('钉住的两样压着：不挪，照实报告', () => {
  const r = solveLayout({ canvas, grid, items: [it('a', 400, 200, { pinned: true, prev: { x: 100, y: 100 } }), it('b', 400, 200, { pinned: true, prev: { x: 300, y: 150 }, order: 1 })], relations: [] });
  assert.deepEqual([r.boxes.get('b').x, r.boxes.get('b').y], [300, 150]);
  assert.equal(r.scale, 1, '有钉住的东西时页面不整台缩');
  const lines = layoutLines({ boxes: r.boxes, grid, unmet: r.unmet, scale: r.scale });
  assert.ok(lines.some((l) => l === '压着：a 和 b'), lines.join('\n'));
});

test('钉住的跑出了屏幕：不挪，照实报告', () => {
  const r = solveLayout({ canvas, grid, items: [it('a', 400, 200, { pinned: true, prev: { x: 1200, y: 100 } })], relations: [] });
  assert.equal(r.boxes.get('a').x, 1200);
  assert.ok(layoutLines({ boxes: r.boxes, grid, unmet: r.unmet, scale: r.scale }).includes('出了屏幕：a'));
});

test('release（arrange、底线 1）：这几样这一次不当钉子，重排', () => {
  const items = [it('a', 400, 200, { pinned: true, prev: { x: 100, y: 100 } }), it('b', 400, 200, { pinned: true, prev: { x: 300, y: 150 }, order: 1 })];
  const r = solveLayout({ canvas, grid, items, relations: [], release: new Set(['b']) });
  const a = r.boxes.get('a'), b = r.boxes.get('b');
  assert.deepEqual([a.x, a.y], [100, 100]);
  assert.ok(b.x >= a.x + a.w || b.y >= a.y + a.h, '放开的那一样让开了');
});

test('关系的主语钉住了：这条关系不再拉它（它已经照关系摆好、钉住了）', () => {
  const r = solveLayout({ canvas, grid, items: [it('s', 600, 200, { pinned: true, prev: { x: 300, y: 300 } }), it('g', 200, 100, { pinned: true, prev: { x: 50, y: 50 }, order: 1 })], relations: [{ kind: 'right-of', a: 'g', b: 's' }] });
  assert.deepEqual([r.boxes.get('g').x, r.boxes.get('g').y], [50, 50]);
});

test('场景：place 让主语钉住；arrange 交给画面', () => {
  const sc = new Scene();
  let fx;
  for (const c of parseScript('array a = 1 2 3\narray b = 4 5\nplace a main\nplace b below a')) fx = sc.apply(c);
  assert.equal(sc.objects.get('a').pinned, true);
  assert.equal(sc.objects.get('b').pinned, true);
  fx = sc.apply(parseScript('arrange')[0]);
  assert.equal(fx.arrange, 'all');
  fx = sc.apply(parseScript('arrange b')[0]);
  assert.deepEqual(fx.arrange, ['b']);
  assert.match(sc.check(parseScript('arrange zz')[0]), /舞台上没有「zz」/);
});
