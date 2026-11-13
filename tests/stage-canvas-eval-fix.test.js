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
