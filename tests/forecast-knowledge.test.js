// 会的程度 K 的网格后验（spec 6.2）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, priorGrid, posterior, meanOf, sampleK } from '../kit/src/forecast/knowledge.js';

test('网格 41 个点、不含 0 和 1；先验的均值对得上', () => {
  assert.equal(GRID.length, 41);
  assert.ok(GRID[0] > 0 && GRID.at(-1) < 1);
  assert.ok(Math.abs(meanOf(priorGrid(0.25, 2)) - 0.25) < 0.02);
  assert.ok(Math.abs(meanOf(priorGrid(0.03, 2)) - 0.03) < 0.02);
});

test('真题做对一道比课堂题做对一道往上推得多', () => {
  const p = priorGrid(0.2, 2);
  const e = meanOf(posterior(p, [{ ok: true, level: 'exam', r: 1, g: 0 }]));
  const c = meanOf(posterior(p, [{ ok: true, level: 'class', r: 1, g: 0 }]));
  assert.ok(e > c && c > meanOf(p));
});

test('隔久了做错（r 低）比刚学完做错往下拉得少：遗忘不扣两次', () => {
  const p = priorGrid(0.5, 2);
  const fresh = meanOf(posterior(p, [{ ok: false, level: 'exam', r: 1, g: 0 }]));
  const stale = meanOf(posterior(p, [{ ok: false, level: 'exam', r: 0.3, g: 0 }]));
  assert.ok(stale > fresh);
});

test('能蒙对的题做对，往上推得少', () => {
  const p = priorGrid(0.3, 2);
  assert.ok(meanOf(posterior(p, [{ ok: true, level: 'exam', r: 1, g: 0.25 }])) < meanOf(posterior(p, [{ ok: true, level: 'exam', r: 1, g: 0 }])));
});

test('课堂题做得再多也换算回真题难度：20 道全对的均值低于 20 道真题全对', () => {
  const p = priorGrid(0.2, 2);
  const many = (level) => Array.from({ length: 20 }, () => ({ ok: true, level, r: 1, g: 0 }));
  assert.ok(meanOf(posterior(p, many('class'))) < meanOf(posterior(p, many('exam'))));
});

test('抽样在网格上、u 越大 K 越大', () => {
  const p = priorGrid(0.4, 4);
  assert.ok(sampleK(p, 0.1) < sampleK(p, 0.9));
  assert.ok(GRID.includes(sampleK(p, 0.5)));
  assert.ok(sampleK(p, 0.999999) <= GRID.at(-1) && sampleK(p, 0) >= GRID[0]);
});
