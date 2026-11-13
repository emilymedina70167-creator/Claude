// 第八轮：求解器（关系、不重叠、稳定、矛盾、放不下、at=、折行、确定性、快）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridOf } from '../kit/src/stage/compose/grid.js';
import { solveLayout } from '../kit/src/stage/compose/solve.js';

const canvas = { w: 1376, h: 900 };
const grid = gridOf(canvas);
const cell = grid.cell;

const hit = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const inside = (b, s = 1) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= canvas.w + 0.5 && b.y + b.h <= canvas.h + 0.5;
function noHits(boxes) {
  const all = [...boxes.entries()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++)
    assert.ok(!hit(all[i][1], all[j][1]), `${all[i][0]} 和 ${all[j][0]} 压着`);
  for (const [id, b] of all) assert.ok(inside(b), `${id} 出了画布`);
}
const item = (id, w, h, more = {}) => ({ id, w, h, order: more.order ?? 0, ...more });

test('right-of：b 在 a 右边，隔一格', () => {
  const r = solveLayout({ canvas, grid, items: [item('a', 400, 200, { order: 0 }), item('b', 200, 100, { order: 1 })],
    relations: [{ kind: 'right-of', a: 'b', b: 'a' }] });
  const a = r.boxes.get('a'), b = r.boxes.get('b');
  assert.ok(b.x >= a.x + a.w + cell - 1, `b.x=${b.x} a 右边=${a.x + a.w}`);
  noHits(r.boxes);
  assert.equal(r.unmet.length, 0);
});

test('不写关系的五样东西：不相交、都在画布里', () => {
  const items = [0, 1, 2, 3, 4].map(i => item('o' + i, 300 + i * 20, 150, { order: i }));
  const r = solveLayout({ canvas, grid, items, relations: [] });
  noHits(r.boxes);
  assert.equal(r.scale, 1);
});

test('稳定：再加一样东西，原来的每样挪动不超过 2 格', () => {
  const items = [item('a', 500, 200, { order: 0 }), item('b', 300, 150, { order: 1 }), item('c', 300, 150, { order: 2 })];
  const rels = [{ kind: 'right-of', a: 'b', b: 'a' }];
  const r1 = solveLayout({ canvas, grid, items, relations: rels });
  const again = items.map(it => ({ ...it, prev: { x: r1.boxes.get(it.id).x, y: r1.boxes.get(it.id).y } }));
  again.push(item('d', 400, 180, { order: 3 }));
  const r2 = solveLayout({ canvas, grid, items: again, relations: rels });
  for (const it of items) {
    const p = r1.boxes.get(it.id), q = r2.boxes.get(it.id);
    assert.ok(Math.abs(p.x - q.x) <= 2 * cell && Math.abs(p.y - q.y) <= 2 * cell, `${it.id} 挪多了`);
  }
  noHits(r2.boxes);
});

test('矛盾：照 strong 的办，weak 的写进没照办', () => {
  const r = solveLayout({ canvas, grid, items: [item('a', 300, 200, { order: 0 }), item('b', 300, 200, { order: 1 })],
    relations: [{ kind: 'right-of', a: 'b', b: 'a', weight: 'strong' }, { kind: 'right-of', a: 'a', b: 'b', weight: 'weak' }] });
  const a = r.boxes.get('a'), b = r.boxes.get('b');
  assert.ok(b.x >= a.x + a.w);
  const u = r.unmet.find(x => x.rel && x.rel.weight === 'weak');
  assert.ok(u && u.why, JSON.stringify(r.unmet));
  noHits(r.boxes);
});

test('放不下：整台缩一档，照实说', () => {
  const items = Array.from({ length: 12 }, (_, i) => item('o' + i, 400, 300, { order: i }));
  const r = solveLayout({ canvas, grid, items, relations: [] });
  noHits(r.boxes);
  assert.ok(r.scale < 1 && r.scale >= 0.8, 'scale=' + r.scale);
  assert.ok(r.unmet.some(u => /放不下/.test(u.why)));
});

test('at=：定死的框照原样，别的绕开', () => {
  const fixed = { x: 6 * cell, y: 4 * cell, w: 34 * cell, h: 8 * cell };
  const r = solveLayout({ canvas, grid, items: [item('q', fixed.w, fixed.h, { order: 0, fixed }), item('s', 600, 200, { order: 1, prev: { x: 100, y: 150 } })], relations: [] });
  const q = r.boxes.get('q');
  for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(q[k] - fixed[k]) < 0.5, k);
  noHits(r.boxes);
});

test('折行：右边只剩 520 宽，句子选 500×200 那种', () => {
  const card = item('card', 820, 200, { order: 0 });
  const sent = item('s', 800, 120, { order: 1, alts: [{ w: 800, h: 120 }, { w: 500, h: 200 }] });
  const r = solveLayout({ canvas, grid, items: [card, sent], relations: [{ kind: 'right-of', a: 's', b: 'card' }] });
  const s = r.boxes.get('s'), c = r.boxes.get('card');
  assert.equal(s.w, 500);
  assert.ok(s.x >= c.x + c.w);
  noHits(r.boxes);
});

test('右边放不下：放在下面，写清楚为什么', () => {
  const r = solveLayout({ canvas, grid, items: [item('s', 1100, 200, { order: 0 }), item('gl', 400, 150, { order: 1 })],
    relations: [{ kind: 'right-of', a: 'gl', b: 's' }] });
  const s = r.boxes.get('s'), g = r.boxes.get('gl');
  assert.ok(g.y >= s.y + s.h - 1);
  assert.ok(r.unmet.some(u => /gl 要在 s 右边.*放在了 s 下面/.test(u.why)), JSON.stringify(r.unmet));
});

test('row：几样排一行，顶对齐、间距一样', () => {
  const r = solveLayout({ canvas, grid, items: [item('A', 200, 200, { order: 0 }), item('B', 200, 200, { order: 1 }), item('C', 200, 160, { order: 2 })],
    relations: [{ kind: 'row', a: ['A', 'B', 'C'], gap: 'l' }] });
  const [A, B, C] = ['A', 'B', 'C'].map(k => r.boxes.get(k));
  assert.ok(Math.abs(A.y - B.y) < 1 && Math.abs(B.y - C.y) < 1);
  const g1 = B.x - (A.x + A.w), g2 = C.x - (B.x + B.w);
  assert.ok(Math.abs(g1 - g2) < cell * 0.6 && g1 >= cell * 1.5, `${g1} ${g2}`);
});

test('near：贴着一个部件的框', () => {
  const r = solveLayout({ canvas, grid, items: [item('s', 900, 120, { order: 0, prev: { x: 100, y: 200 } }), item('k', 200, 60, { order: 1 })],
    relations: [{ kind: 'near', a: 'k', b: { of: 's', x: 300, y: 20, w: 80, h: 60 } }] });
  const s = r.boxes.get('s'), k = r.boxes.get('k');
  const part = { x: s.x + 300, y: s.y + 20, w: 80, h: 60 };
  const dx = Math.max(0, part.x - (k.x + k.w), k.x - (part.x + part.w));
  const dy = Math.max(0, part.y - (k.y + k.h), k.y - (part.y + part.h));
  assert.ok(Math.hypot(dx, dy) < 3 * cell, `离部件 ${dx},${dy}`);
  noHits(r.boxes);
});

test('main：主角在视线中心', () => {
  const r = solveLayout({ canvas, grid, items: [item('s', 600, 200, { order: 0 })], relations: [{ kind: 'main', a: 's' }] });
  const s = r.boxes.get('s');
  assert.ok(Math.abs(s.x + s.w / 2 - canvas.w / 2) < cell);
});

test('确定性：同样输入同样输出', () => {
  const mk = () => ({ canvas, grid, items: [0, 1, 2, 3, 4, 5].map(i => item('o' + i, 250 + 30 * i, 120 + 10 * i, { order: i, alts: i % 2 ? [{ w: 250 + 30 * i, h: 120 + 10 * i }, { w: 200, h: 200 }] : undefined })),
    relations: [{ kind: 'right-of', a: 'o1', b: 'o0' }, { kind: 'below', a: 'o2', b: 'o0' }, { kind: 'row', a: ['o3', 'o4'] }] });
  const a = solveLayout(mk()), b = solveLayout(mk());
  assert.deepEqual([...a.boxes.entries()], [...b.boxes.entries()]);
});

test('快：15 样东西 + 10 条关系，中位数 < 30 毫秒', () => {
  const items = Array.from({ length: 15 }, (_, i) => item('o' + i, 120 + (i * 37) % 200, 60 + (i * 23) % 90, { order: i, alts: i % 4 === 0 ? [{ w: 120 + (i * 37) % 200, h: 60 + (i * 23) % 90 }, { w: 100, h: 140 }] : undefined }));
  const kinds = ['right-of', 'below', 'left-of', 'above', 'near'];
  const relations = Array.from({ length: 10 }, (_, i) => ({ kind: kinds[i % 5], a: 'o' + (i + 1), b: 'o' + i }));
  const ts = [];
  for (let k = 0; k < 20; k++) { const t = performance.now(); solveLayout({ canvas, grid, items, relations }); ts.push(performance.now() - t); }
  ts.sort((x, y) => x - y);
  assert.ok(ts[10] < 30, '中位数 ' + ts[10].toFixed(1) + ' 毫秒');
});
