// 改进型 CLOCK（kit/src/engines/os.js 的 paging algo: eclock）：init: 给开始时的页和（访问位, 修改位）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagingEngine as P } from '../kit/src/engines/os.js';

test('第 1 轮找 (0,0) 不改位，第 2 轮找 (0,1) 扫过的清 0；写访问置修改位', () => {
  const input = P.parse({ algo: 'eclock', init: '1 1 0, 2 1 1, 3 0 1, 4 1 0', ptr: 1, refs: '5 2w 6' });
  const r = P.run(input);
  assert.deepEqual(r.victims, ['3', '1']);
  assert.equal(r.faults, 2);
  const step = r.steps.find((s) => s.ask?.tag === 'victim');
  assert.match(step.msg, /第 2 轮找 \(0,1\)，扫过的访问位清 0：块 1 \(1,0\)→\(0,0\)、块 2 \(1,1\)→\(0,1\)、块 3 是 \(0,1\)/);
  const last = r.steps.at(-2).view.cols.at(-1);
  assert.deepEqual([last.use, last.mod], [[1, 1, 1, 1], [0, 1, 0, 0]]);
  // 错法：第 1 轮就清访问位 → 先换出 2
  const v = P.variants(input).find((x) => x.input.mistake === 'clearFirst');
  assert.deepEqual(P.run(v.input).victims[0], '2');
  assert.throws(() => P.parse({ algo: 'eclock', init: '1 1, 2 1 1', refs: '3' }), /页 访问位 修改位/);
  // 简单 CLOCK 也能给 init
  assert.deepEqual(P.run(P.parse({ algo: 'clock', init: '1 1, 2 0, 3 1', ptr: 1, refs: '4' })).victims, ['2']);
});
