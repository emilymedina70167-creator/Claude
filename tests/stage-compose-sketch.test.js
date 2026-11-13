// 第八轮：预览的示意图
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridOf, fromCells } from '../kit/src/stage/compose/grid.js';
import { sketchSvg } from '../kit/src/stage/compose/sketch.js';

const grid = gridOf({ w: 1376, h: 900 });

test('示意图有每样东西的名字、列号 0 和 47', () => {
  const boxes = new Map([['s', fromCells({ c0: 6, r0: 4, c1: 40, r1: 10 }, grid)], ['say', fromCells({ c0: 2, r0: 20, c1: 20, r1: 24 }, grid)]]);
  const svg = sketchSvg({ boxes, grid, items: [{ id: 's', text: 'They <gave> justices permanent positions' }] });
  assert.match(svg, /^<svg/);
  assert.match(svg, />s</);
  assert.match(svg, />话</);
  assert.match(svg, />0</);
  assert.match(svg, />47</);
  assert.match(svg, /&lt;gave/);
});

test('空的也画得出', () => {
  assert.match(sketchSvg({ boxes: new Map(), grid }), /<\/svg>$/);
});
