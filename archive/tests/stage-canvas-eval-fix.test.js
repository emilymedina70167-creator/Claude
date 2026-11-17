// 第九轮设计要求单复评没过的几条（r14～r16、r30）：话摆过的留着、题卡能折窄
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { card, rowsOf, lineH, CARD_WIDTHS } from '../kit/src/stage/types/card.js';
import '../kit/src/stage/types/index.js';

const run = (sc, src) => { for (const c of parseScript(src)) sc.apply(c); };

test('place say at= 以后再说一句：话还在老师摆的地方（不回到默认贴着讲的东西）', () => {
  const sc = new Scene();
  run(sc, 'array a = 1 2 3\nplace say at=1,8-16,16\nsay "第一句"\nsay "第二句"');
  assert.ok(sc.layout.has('say'));
  assert.equal(sc.layout.get('say')[0].kind, 'at');
  // say … near= 照新写的换掉
  run(sc, 'say "贴着" near=a.2');
  assert.equal(sc.layout.get('say')[0].kind, 'near');
  // 只写 say（没 place 过）：照旧不留
  run(sc, 'say "再一句"');
  assert.ok(!sc.layout.has('say'));
});

test('题卡能折窄：窄了更高，部件跟着卡的宽', () => {
  const sc = new Scene();
  run(sc, 'card q = "这段要回答：谓语前面加上 must、can 这类词，谓语会怎么变？" "must 必须｜can 能够｜should 应该｜may 可能"');
  const o = sc.objects.get('q');
  const wide = card.objectBox(o);
  assert.equal(wide.w, CARD_WIDTHS[0]);
  sc.moveObject('q', wide.x, wide.y, 360);
  const narrow = card.objectBox(o);
  assert.equal(narrow.w, 360);
  assert.ok(narrow.h > wide.h);
  assert.ok(card.partBox(o, o.lines[0]).w < 360);
  assert.ok(rowsOf('一'.repeat(40), 360) > rowsOf('一'.repeat(40), 560));
  // 量过的高只在量的那个宽下用
  const l = { text: '短', mh: 99, mw: 560 };
  assert.equal(lineH(l, 560), 99);
  assert.notEqual(lineH(l, 360), 99);
});

import { gridOf } from '../kit/src/stage/compose/grid.js';
import { solveLayout } from '../kit/src/stage/compose/solve.js';

test('主角在正中、右边不够：挪得动就往左让，照办「在它右边」，不换到下面', () => {
  const canvas = { w: 1180, h: 700 }, grid = gridOf(canvas);
  const r = solveLayout({ canvas, grid, items: [{ id: 't', w: 600, h: 300, order: 0 }, { id: 'a', w: 500, h: 100, order: 1 }],
    relations: [{ kind: 'main', a: 't' }, { kind: 'right-of', a: 'a', b: 't', align: 'top', gap: 's' }] });
  const t = r.boxes.get('t'), a = r.boxes.get('a');
  assert.ok(a.x >= t.x + t.w - 2, JSON.stringify([t, a]));
  assert.ok(!r.unmet.some((u) => u.rel?.kind === 'right-of'), JSON.stringify(r.unmet));
});

import { layoutLines } from '../kit/src/stage/compose/report.js';

test('最后不到一行的那一截也在画布里：落在那里不算出了屏幕（r24、r25 的假报）', () => {
  const grid = gridOf({ w: 1148, h: 690 }); // 28 行是 669 像素，画布还有 21 像素
  const lines = layoutLines({ boxes: new Map([['AB', { x: 300, y: 500, w: 200, h: 185 }]]), grid });
  assert.ok(!lines.some((l) => l.startsWith('出了屏幕')), lines.join('\n'));
  const out = layoutLines({ boxes: new Map([['AB', { x: 300, y: 520, w: 200, h: 185 }]]), grid });
  assert.ok(out.some((l) => l.startsWith('出了屏幕')));
});

import { drawGeometry } from '../kit/src/stage/draw.js';

test('圈矩阵的一格：圈不比格子宽，挨着的两格各圈各的（r24）', () => {
  const boxOf = () => ({ x: 100, y: 100, w: 56, h: 56 });
  const g = drawGeometry({ name: 'd1', kind: 'circle', on: 'AB.1,1' }, boxOf, { s: 1 });
  assert.ok(g.bbox.w <= 60 && g.bbox.h <= 60, JSON.stringify(g.bbox));
});

test('一组新摆的东西居中：挑战条定在左上角也照样居中（自由排版试验：矩阵排在下半屏）', () => {
  const canvas = { w: 1148, h: 692 }, grid = gridOf(canvas);
  const items = [{ id: 'A', w: 300, h: 300, order: 0 }, { id: 'goals', w: 256, h: 42, order: 1, rigid: true, fixed: { x: 0, y: 0, w: 256, h: 42 } }];
  const r = solveLayout({ canvas, grid, items, relations: [] });
  const A = r.boxes.get('A');
  assert.ok(Math.abs(A.x + A.w / 2 - canvas.w / 2) < 40, JSON.stringify(A));
  assert.ok(Math.abs(A.y + A.h / 2 - canvas.h * 0.42) < 60, JSON.stringify(A));
});

test('话躲开老师横跨两样东西画的那一块（ghost），东西不躲', () => {
  const canvas = { w: 1148, h: 692 }, grid = gridOf(canvas);
  const ghost = { x: 300, y: 200, w: 60, h: 200 };
  const items = [
    { id: 's', w: 500, h: 100, order: 0, prev: { x: 250, y: 100 } },
    { id: 'o', w: 500, h: 100, order: 1, prev: { x: 250, y: 400 } },
    { id: 'keep:d1', w: ghost.w, h: ghost.h, order: 2, rigid: true, ghost: true, fixed: ghost },
    { id: 'say', w: 300, h: 60, order: 3, rigid: true, prev: { x: 250, y: 260 } },
  ];
  const r = solveLayout({ canvas, grid, items, relations: [] });
  const say = r.boxes.get('say');
  const hit = say.x < ghost.x + ghost.w && ghost.x < say.x + say.w && say.y < ghost.y + ghost.h && ghost.y < say.y + say.h;
  assert.ok(!hit, JSON.stringify(say));
  // 东西照上一次的位置（吸到半格，差不到半格）
  assert.ok(Math.abs(r.boxes.get('s').y - 100) < 15 && Math.abs(r.boxes.get('o').y - 400) < 15, JSON.stringify([...r.boxes]));
});

test('link 两头各写一处、一头是一段：整段当一头，只连一道（不拆成一串）', () => {
  const sc = new Scene();
  run(sc, 'sentence s = "they would be free"\ntimeline tl = 过去 现在 now=现在\nstand tl fr = 现在\nlink s.2-4 tl.fr g2');
  const ls = [...sc.links.values()];
  assert.equal(ls.length, 1);
  assert.deepEqual(ls[0].a.span || ls[0].b.span, ['2', '3', '4'].map((k) => (typeof ls[0].a.key === 'number' ? Number(k) : k)).length ? (ls[0].a.span || ls[0].b.span) : null);
  assert.equal((ls[0].a.span || ls[0].b.span).length, 3);
});
