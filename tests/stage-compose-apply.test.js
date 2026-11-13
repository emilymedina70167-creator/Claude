// 第八轮：自由构图不碰 DOM 的那一半——同一个 log 排出同一个版面；pos 照原样放回
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { gridOf, typeScaleOf } from '../kit/src/stage/compose/grid.js';
import { solveLayout } from '../kit/src/stage/compose/solve.js';
import { composeInput, posLine, canvasOf } from '../kit/src/stage/compose/apply.js';

const LOG = `sentence s = "They gave justices permanent positions so they would be free."
timeline tl = 过去 过去之后 现在 将来 now=现在
array a = 3 1 2
place s main
place tl below s gap=l
place a right-of tl
say "看这里" near=s.2`;

function layout(src) {
  const sc = new Scene();
  for (const c of parseScript(src)) sc.apply(c);
  const cv = canvasOf({ w: 1180, h: 820, dockH: 80 });
  const grid = gridOf(cv), ts = typeScaleOf({ w: 1180 });
  const partBox = (ref) => { const ps = sc.parts(ref); const b = sc.partBox(ps[0]); return b; };
  const env = { ts, camS: ts, grid, boxOf: (id) => sc.objectBox(id), altsOf: () => null, partBox, extras: [{ id: 'say', w: 300, h: 80 }], lastTouched: 'a' };
  const { items, relations } = composeInput(sc, env);
  return { sc, res: solveLayout({ canvas: cv, grid, items, relations }), ts };
}

test('同一个 log 跑两次，版面一样', () => {
  const a = layout(LOG).res, b = layout(LOG).res;
  assert.deepEqual([...a.boxes], [...b.boxes]);
  assert.equal(a.unmet.length, 0, JSON.stringify(a.unmet.map((u) => u.why)) + JSON.stringify([...a.boxes]));
});

test('部件写的 near 换成跟着那样东西走的框', () => {
  const sc = new Scene();
  for (const c of parseScript(LOG)) sc.apply(c);
  const { relations } = composeInput(sc, { ts: 1, camS: 1, grid: gridOf({ w: 1000, h: 800 }), boxOf: (id) => sc.objectBox(id), partBox: (r) => sc.partBox(sc.parts(r)[0]), extras: [{ id: 'say', w: 10, h: 10 }] });
  const near = relations.find((r) => r.kind === 'near');
  assert.equal(near.b.of, 's');
  assert.ok(near.b.w > 0 && near.b.x >= 0);
});

test('pos 照写的地方放回（重放不用量）', () => {
  const { sc, res, ts } = layout(LOG);
  const moves = ['s', 'tl', 'a'].map((id) => { const B = res.boxes.get(id), est = sc.objectBox(id); return { id, x: est.x + B.x / ts - est.x, y: est.y + B.y / ts - est.y }; });
  const line = posLine(moves);
  assert.match(line, /^pos s=[\d.-]+,[\d.-]+ tl=/);
  const again = new Scene();
  for (const c of parseScript(LOG + '\n' + line)) again.apply(c);
  for (const m of moves) {
    const b = again.objectBox(m.id);
    assert.ok(Math.abs(b.x - m.x) < 0.1 && Math.abs(b.y - m.y) < 0.1, m.id);
    assert.equal(again.objects.get(m.id).placed, true);
  }
});
