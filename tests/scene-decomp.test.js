// 视觉交互第 6 批 Task 2：基变换的坐标分解——coords(v, b1, b2) 和 scene 的 decomp 命令
import test from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../kit/src/expr.js';
// scene.js 连着画面的模块：照 class-figure.test.js 给一个最小的 document
globalThis.document ??= { addEventListener() {}, compatMode: 'CSS1Compat' };
const { parseScene, decompParts } = await import('../kit/src/scene.js');

const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

test('coords：v 在基 b1、b2 下的坐标', () => {
  const f = compile('coords(v, b1, b2)');
  assert.ok(near(f({ v: [3, 1], b1: [1, 1], b2: [1, -1] }), [2, 1]));
  assert.ok(near(f({ v: [1, 0], b1: [1, 1], b2: [1, -1] }), [0.5, 0.5]), '分数坐标');
  assert.ok(near(f({ v: [0, 0], b1: [2, 1], b2: [1, 3] }), [0, 0]), '零向量');
  assert.throws(() => f({ v: [1, 2], b1: [1, 2], b2: [2, 4] }), /共线/);
});

test('decomp 的写法：三个量；少了报错', () => {
  const { cmds } = parseScene('let v = [3, 1] drag\ndecomp v, [1, 1], [1, -1] color=yellow');
  const d = cmds.find((c) => c.kind === 'decomp');
  assert.ok(d && d.exprs.length === 3);
  assert.throws(() => parseScene('decomp v, [1, 1]'), /decomp/);
});

test('decompParts：两段首尾相接（c1·b1 再接 c2·b2 到 v），平行四边形的另外两条边', () => {
  const p = decompParts([3, 1], [1, 1], [1, -1]);
  assert.ok(near(p.c, [2, 1]));
  assert.ok(near(p.legs[0][0], [0, 0]) && near(p.legs[0][1], [2, 2]));
  assert.ok(near(p.legs[1][0], [2, 2]) && near(p.legs[1][1], [3, 1]));
  assert.ok(near(p.guides[0][0], [0, 0]) && near(p.guides[0][1], [1, -1]));
  assert.ok(near(p.guides[1][0], [1, -1]) && near(p.guides[1][1], [3, 1]));
  assert.equal(decompParts([1, 2], [1, 2], [2, 4]), null, '共线：画不出分解');
});
