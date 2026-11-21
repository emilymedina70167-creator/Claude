// 第 3 批留下的小毛病（2026-11-21 一次修完）：一条一个能重现的测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSpace } from '../kit/src/spacespec.js';

test('tangent … color=yellow plane：修饰写在 plane 前面也认；region … color=… hide 同样', () => {
  const s = parseSpace('curve C = [cos(t), sin(t), t] for t 0 6\ntangent C at 1 color=yellow plane');
  const t = s.cmds.find((c) => c.kind === 'tangent');
  assert.equal(t.mods.plane, true);
  assert.equal(t.mods.color, 'yellow');
  assert.equal(t.at({}), 1);
});
test('revolve y = sqrt(x) …：y = 是曲线的写法，不是给体积起名叫 y', () => {
  const s = parseSpace('revolve y = sqrt(x) for x 0 4 about x');
  const r = s.cmds.find((c) => c.kind === 'revolve');
  assert.equal(r.name, undefined);
  assert.equal(r.f({ x: 4 }), 2);
  const v = parseSpace('revolve V = sqrt(x) for x 0 4 about x').cmds.find((c) => c.kind === 'revolve');
  assert.equal(v.name, 'V');
});

import { sliceLines } from '../kit/src/fx/solid.js';
test('写方程的小曲面夹在两刀之间（半径 0.15 的球、刀距 0.5）也画得出来', () => {
  const box = { x0: -2, x1: 2, y0: -2, y1: 2, z0: -2, z1: 2 };
  const F = (x, y, z) => (x - 0.3) ** 2 + (y - 0.3) ** 2 + (z - 0.3) ** 2 - 0.15 ** 2;
  const r = sliceLines(F, box, { n: 9, grid: 40 });
  const count = ['x', 'y', 'z'].reduce((s, k) => s + r[k].reduce((t, c) => t + c.lines.length, 0), 0);
  assert.ok(count >= 3, `画出 ${count} 条线`);
  // 线都在球上
  for (const k of ['x', 'y', 'z']) for (const c of r[k]) for (const l of c.lines) for (const p of l) assert.ok(Math.abs(F(...p)) < 0.02, JSON.stringify(p));
  // 根本没有曲面的照旧什么都不画
  const none = sliceLines((x, y, z) => x * x + y * y + z * z + 1, box, { n: 9, grid: 40 });
  assert.equal(['x', 'y', 'z'].reduce((s, k) => s + none[k].reduce((t, c) => t + c.lines.length, 0), 0), 0);
});

test('let … drag 的静默处：on= 写了没有的曲面、拖的是三维的点，都报出来', () => {
  assert.throws(() => parseSpace('surface S = z = x^2 + y^2 for x -1 1, y -1 1\nlet P = [0.5, 0.5] drag on=T'), /没有叫 T 的曲面/);
  assert.throws(() => parseSpace('let P = [1, 2, 3] drag'), /地面上的点/);
  assert.doesNotThrow(() => parseSpace('surface S = z = x^2 + y^2 for x -1 1, y -1 1\nlet P = [0.5, 0.5] drag on=S'));
});

import { subdivideQuad } from '../kit/src/fx/solid.js';
test('切平面切成小块各自排远近（以前整张一个深度、固定往前偏，从上面看碗时压在碗沿上）', () => {
  const q = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]];
  const parts = subdivideQuad(q, 4);
  assert.equal(parts.length, 16);
  const area = parts.reduce((s, p) => s + Math.abs((p[1][0] - p[0][0]) * (p[3][1] - p[0][1])), 0);
  assert.ok(Math.abs(area - 4) < 1e-12);
  assert.deepEqual(parts[0][0], [0, 0, 0]);
  assert.deepEqual(parts.at(-1)[2], [2, 2, 0]);
});

import { planeFrom, planes3 } from '../kit/src/fx/solid.js';
test('三个平面接近退化（系数差 1e-9）：几种情形和画出来的交线用同一把尺子', () => {
  const cases = [
    [[2, 0, 2, -1], [2, 0, 2, 1], [4.000000003728389, -5.59258332844696e-9, 4, 0]],
    [[-1, 3, -1, 0], [-1, 3, -1, -3], [-2.0000000041796224, 5.999999995820378, -1.9999999979101888, -2.9999999958203776]],
    [[2, 2, 0, -3], [-1, -1, 0, -2], [1.0000000004027956, 0.999999999194409, -1.2083864820783951e-9, -5.000000000402795]],
    [[0, 0, -2, 2], [0, 0, -2, -2], [3.7062522451435494e-9, 1.8531261225717747e-9, -4.0000000018531265, 0]],
  ];
  const want = { point: 3, line: 1, 'two-same': 1, prism: 3, 'two-parallel': 2, plane: 0, 'two-same-parallel': 0, parallel: 0 };
  for (const rows of cases) {
    const r = planes3(...rows.map((x) => planeFrom(...x)));
    const lines = r.meets.filter(Boolean).length;
    assert.equal(lines, want[r.kind], `${r.kind}：画了 ${lines} 条（${JSON.stringify(rows)}）`);
  }
  // 好好的三张：照旧
  const ok = planes3(planeFrom(1, 0, 0, 1), planeFrom(0, 1, 0, 2), planeFrom(0, 0, 1, 3));
  assert.equal(ok.kind, 'point'); assert.equal(ok.meets.filter(Boolean).length, 3);
});

import { evaluate } from '../kit/src/expr.js';
test('写了 if(…)：说分段函数怎么写（以前只说「没有函数 if()」，看不出是写法问题）', () => {
  assert.throws(() => evaluate('if(x < 0, 1, 2)', { x: 1 }), /分段.*\(x < 0\)/);
});

import { sectionArea } from '../kit/src/fx/solid.js';
test('截面面积：球的截面（两头是根号）准到 1e-6（以前等分 160 段只准到约 1e-4），底比球大也一样', () => {
  const s = (x, y) => Math.sqrt(1 - x * x - y * y);
  for (const [z0, base] of [[0.5, { rect: [-2, 2, -2, 2] }], [0, { rect: [-1, 1, -1, 1] }], [0.9, { rect: [-1.5, 1.5, -1.5, 1.5] }], [0.3, { shape: 'y', a: -1, b: 1, lo: (x) => -Math.sqrt(1 - x * x), hi: (x) => Math.sqrt(1 - x * x) }]]) {
    const want = Math.PI * (1 - z0 * z0), v = sectionArea((x, y) => -s(x, y), s, base, z0);
    assert.ok(Math.abs(v - want) / want < 1e-6, `z = ${z0}：${v} 和 ${want} 差 ${((v - want) / want).toExponential(1)}`);
  }
  // 截面的边有折的（方块和圆的交）照旧准
  const sq = sectionArea(() => -1, () => 1, { rect: [-1, 1, -1, 1] }, 0);
  assert.ok(Math.abs(sq - 4) < 1e-9, String(sq));
});

import { meshOver } from '../kit/src/fx/solid.js';
test('球写在比它大的矩形底上：边上的格子沿着圆裁开（以前整格丢掉、赤道一圈是锯齿）', () => {
  const m = meshOver((x, y) => Math.sqrt(1 - x * x - y * y), { rect: [-2, 2, -2, 2] }, { n: 24, m: 24 });
  const area2 = (ps) => Math.abs(ps.reduce((s, p, i) => { const q = ps[(i + 1) % ps.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  const quadArea = m.quads.reduce((s, q) => s + area2(q.map((k) => m.pts[k])), 0);
  const edgeArea = (m.edge || []).reduce((s, ps) => s + area2(ps), 0);
  assert.ok(Math.abs(quadArea + edgeArea - Math.PI) / Math.PI < 0.01, `铺出来的投影面积 ${(quadArea + edgeArea).toFixed(4)}（只有整格 ${quadArea.toFixed(4)}）`);
  // 边上的点都在圆上（不出去）
  for (const ps of m.edge) for (const p of ps) assert.ok(p[0] ** 2 + p[1] ** 2 <= 1 + 1e-6);
});
