// 第八轮：版面写给老师
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridOf, fromCells, toCells } from '../kit/src/stage/compose/grid.js';
import { layoutLines, freeRects } from '../kit/src/stage/compose/report.js';

const grid = gridOf({ w: 1376, h: 900 });
const box = (c0, r0, c1, r1) => fromCells({ c0, r0, c1, r1 }, grid);

test('版面那一行一字不差', () => {
  const boxes = new Map([['s', box(6, 4, 40, 10)], ['say', box(2, 20, 20, 24)]]);
  const lines = layoutLines({ boxes, grid });
  assert.equal(lines[0], '版面（48 列 × 31 行）：s 6,4-40,10；话 2,20-20,24');
  assert.match(lines[1], /^空着：/);
  assert.ok(!lines.some((l) => /没照办/.test(l)));
});

test('空着的几块不和东西相交、从大到小', () => {
  const boxes = new Map([['s', box(6, 4, 40, 10)], ['t', box(0, 12, 48, 20)]]);
  const free = freeRects(boxes, grid);
  assert.ok(free.length >= 2);
  const area = (c) => (c.c1 - c.c0) * (c.r1 - c.r0);
  for (let i = 1; i < free.length; i++) assert.ok(area(free[i - 1]) >= area(free[i]));
  for (const f of free) for (const b of boxes.values()) {
    const c = toCells(b, grid);
    assert.ok(f.c1 <= c.c0 || c.c1 <= f.c0 || f.r1 <= c.r0 || c.r1 <= f.r0, '空地压着东西');
  }
});

test('没照办、放不下照实写', () => {
  const boxes = new Map([['s', box(0, 0, 40, 10)]]);
  const lines = layoutLines({ boxes, grid, unmet: [{ why: 'gl 要在 s 右边，右边只剩 5 列，放在了 s 下面' }, { why: '放不下，整台缩到 9 成' }], scale: 0.9 });
  assert.ok(lines.includes('没照办：gl 要在 s 右边，右边只剩 5 列，放在了 s 下面'));
  assert.ok(lines.includes('放不下，整台缩到 9 成'));
});
