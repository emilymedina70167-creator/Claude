// 一问一答的课发给老师的说明（kit/src/huoban/doc.js）：不称呼学生他她；写法里的例子都能过活板的读法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEACH_TALK, LANG_TALK } from '../kit/src/huoban/doc.js';
import { parseBoard, parseExpr } from '../kit/src/huoban/lang.js';

test('说明里不称呼学生「他」「她」', () => {
  assert.ok(!/[他她]/.test(TEACH_TALK + LANG_TALK));
});

test('说明里写的例子能读', () => {
  for (const s of ['let f = 3 拨 1..6', 'let x = [1, 0] 拖 吸附 0.5', 'let v = find s in 序列(15, 1..6) where faults(s, 4, fifo) > faults(s, 3, fifo)', 'let r = paging(refs=[7, 0, 1, 2, 0, 3], frames=3, algo=lru)']) {
    assert.deepEqual(parseBoard(s).errors, [], s);
  }
  for (const e of ['r.victim.2', 'procs', 'par(u, v)', 'lam(A, x)']) parseExpr(e);
  assert.ok(new TextEncoder().encode(TEACH_TALK + LANG_TALK).length < 6000);
});
