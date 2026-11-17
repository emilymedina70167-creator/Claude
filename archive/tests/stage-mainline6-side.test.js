// 主线第六轮 A：横屏左边解析栏多宽（layout.js 的 pickSide）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSide, fitCamera, SIDE_MIN, SIDE_MAX } from '../kit/src/stage/layout.js';

const view = { w: 1180, h: 820 };

test('又宽又矮的框（英语句子）挑最窄的一档', () => {
  assert.equal(pickSide({ x: 0, y: 0, w: 1600, h: 300 }, view, { lines: () => 2 }).w, 354);
});

test('又大又方的框：挑四档里画面最大的那一档', () => {
  const box = { x: 0, y: 0, w: 500, h: 700 };
  const r = pickSide(box, view, { lines: () => 2 });
  const all = [354, 401, 448, 480].map((w) => fitCamera(box, view, { pad: 28, left: w, maxScale: 1.5 }).s);
  assert.equal(r.s, Math.max(...all));
});

test('这一问在窄栏里超过 4 行：挑放得下的那几档', () => {
  assert.ok(pickSide({ x: 0, y: 0, w: 1600, h: 300 }, view, { lines: (w) => (w < 400 ? 6 : 3) }).w >= 400);
});

test('现在那档：别的档大不到一成不换', () => {
  // 两档差不多大（高度说了算）：留在现在那档
  const box = { x: 0, y: 0, w: 300, h: 700 };
  assert.equal(pickSide(box, view, { lines: () => 2, cur: 448 }).w, 448);
});

test('每一档夹在 300～480 之间', () => {
  for (const w of [700, 1180, 2000]) {
    const r = pickSide({ x: 0, y: 0, w: 600, h: 400 }, { w, h: 700 }, { lines: () => 1 });
    assert.ok(r.w >= SIDE_MIN && r.w <= SIDE_MAX, `${w} → ${r.w}`);
  }
});
