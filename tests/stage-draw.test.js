// 第九轮 Task 7：draw / erase（箭头、圈、框、括号、下划线、字、任意 SVG，跟着东西走）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import '../kit/src/stage/types/index.js';
import { drawGeometry } from '../kit/src/stage/draw.js';
import { gridOf } from '../kit/src/stage/compose/grid.js';

const BASE = `sentence s = "The company must make a quick decision."
timeline tl = 过去 现在 将来 now=现在
stand tl fr = 现在`;
const run = (src, sc = new Scene()) => { let fx; for (const c of parseScript(src)) fx = sc.apply(c); return { sc, fx }; };
const err = (sc, line) => sc.check(parseScript(line)[0]);
const boxOf = (sc) => (ref) => { const ps = sc.parts(ref); const bs = ps.map((p) => sc.worldPartBox(p)); const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)); return { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 }; };
const grid = gridOf({ w: 1376, h: 900 });

test('每一种都画得出，框在那几个部件附近', () => {
  const { sc } = run(BASE + `
draw d1 arrow from=s.3 to=tl.fr color=g2
draw d2 circle on=s.3-4 color=brand
draw d3 box on=s.5
draw d4 brace under=s.3-4 "谓语"
draw d5 underline on=s.6 color=red
draw d6 text at=4,2-20,4 "先看主干"
draw d7 svg at=30,4-44,16 "<path d='M0 80 Q 50 0 100 80' />"`);
  for (const name of ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']) {
    const g = drawGeometry(sc.drawings.get(name), boxOf(sc), { grid, s: 1 });
    assert.ok(g.strokes.length || g.texts.length || g.markup, `${name} 什么都没画`);
    assert.ok(g.bbox && g.bbox.w > 0, `${name} 没有框`);
  }
  const g2 = drawGeometry(sc.drawings.get('d2'), boxOf(sc), { grid, s: 1 });
  const p = boxOf(sc)('s.3-4');
  assert.ok(g2.bbox.x <= p.x && g2.bbox.x + g2.bbox.w >= p.x + p.w, '圈把那两个词圈住');
  assert.match(sc.stateText(), /画的：d1 箭头 s\.3→tl\.fr；d2 圈 s\.3-4/);
});

test('写错当场报；svg 里的脚本去掉', () => {
  const { sc } = run(BASE);
  assert.match(err(sc, 'draw d1 arrow from=s.3'), /arrow 要写 from= 和 to=/);
  assert.match(err(sc, 'draw d1 blob on=s.3'), /画法只有/);
  assert.match(err(sc, 'draw d1 circle on=zz.3'), /zz/);
  assert.match(err(sc, 'draw d1 text at=40,4-6,12 "x"'), /at= 写成/);
  assert.match(err(sc, 'draw d1 svg at=1,1-9,9 "<script>alert(1)</script><path d=\'M0 0 L9 9\'/>"'), /script/);
  assert.equal(err(sc, 'draw d1 circle on=s.3 color=g2'), null);
});

test('erase；东西拿掉了画在它上面的跟着没；同一个 log 画两次一样', () => {
  const { sc } = run(BASE + '\ndraw d1 arrow from=s.3 to=tl.fr\ndraw d2 circle on=s.3\ndraw d6 text at=4,2-20,4 "字"');
  const a = drawGeometry(sc.drawings.get('d1'), boxOf(sc), { grid, s: 1 });
  const b = drawGeometry(run(BASE + '\ndraw d1 arrow from=s.3 to=tl.fr').sc.drawings.get('d1'), boxOf(sc), { grid, s: 1 });
  assert.deepEqual(a.strokes, b.strokes);
  run('erase d2', sc);
  assert.equal(sc.drawings.has('d2'), false);
  run('remove s', sc);
  assert.equal(sc.drawings.has('d1'), false);
  assert.ok(sc.drawings.has('d6'), '画在格子上的不跟东西走');
  assert.equal(sc.clone().drawings.size, 1);
});
