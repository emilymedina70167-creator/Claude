// 第八轮：细网格和字号档
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, GAPS, gridOf, typeScaleOf, toCells, fromCells, cellText, parseAt } from '../kit/src/stage/compose/grid.js';

test('细网格：48 列，行按屏幕比例', () => {
  const g = gridOf({ w: 1376, h: 900 });
  assert.equal(COLS, 48);
  assert.equal(g.cols, 48);
  assert.ok(Math.abs(g.cell - 28.67) < 0.01);
  assert.equal(g.rows, 31);
});

test('字号档：照屏幕宽挑一档', () => {
  assert.ok(Math.abs(typeScaleOf({ w: 1376 }) - 1.11) < 0.001);
  assert.equal(typeScaleOf({ w: 1180 }), 0.96);
  assert.equal(typeScaleOf({ w: 2000 }), 1.11);
});

test('at= 的读法', () => {
  assert.deepEqual(parseAt('6,4-40,12'), { c0: 6, r0: 4, c1: 40, r1: 12 });
  assert.equal(parseAt('40,4-6,12'), null);
  assert.equal(parseAt('6,4'), null);
  assert.equal(parseAt('0,0-49,2'), null);
  assert.equal(parseAt(''), null);
  assert.equal(cellText({ c0: 6, r0: 4, c1: 40, r1: 12 }), '6,4-40,12');
});

test('格子和像素来回', () => {
  const g = gridOf({ w: 1376, h: 900 });
  const cells = { c0: 6, r0: 4, c1: 40, r1: 12 };
  assert.deepEqual(toCells(fromCells(cells, g), g), cells);
  // 不整的框：盖到的格子都算
  const c = toCells({ x: g.cell * 2.5, y: 1, w: g.cell, h: g.cell }, g);
  assert.deepEqual(c, { c0: 2, r0: 0, c1: 4, r1: 2 });
  assert.deepEqual(GAPS, { s: 0.5, m: 1, l: 2 });
});
