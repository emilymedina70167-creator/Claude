// 动态分区分配（kit/src/engines/osmem.js）：王道的 640K 例题
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocEngine as A } from '../kit/src/engines/osmem.js';

const OPS = 'alloc 1 130K, alloc 2 60K, alloc 3 100K, free 2, alloc 4 200K, free 3, free 1, alloc 5 140K, alloc 6 60K, alloc 7 50K, free 6';
const holes = (r) => r.holes.map((h) => `${h.start / 1024}+${h.size / 1024}`);

test('首次适应：每次的起始地址、回收合并、最后的空闲区', () => {
  const r = A.run(A.parse({ memory: '640K', ops: OPS, algo: 'first' }));
  assert.deepEqual(r.log.filter((x) => x.op.kind === 'alloc').map((x) => x.start / 1024), [0, 130, 190, 290, 0, 140, 200]);
  assert.deepEqual(holes(r), ['140+60', '250+40', '490+150']);
  // 回收 3 时和前面的空闲区（130K～190K）合并
  const step = r.steps.find((s) => s.ask?.q?.startsWith('回收 3'));
  assert.equal(step.ask.answer, '和前面的空闲区合并');
});

test('最佳适应和错法：按首次适应找、回收没合并', () => {
  const input = A.parse({ memory: '640K', ops: OPS, algo: 'best' });
  const r = A.run(input);
  // 作业 5（140K）时空闲区只有 0～290K（290K）和 490～640K（150K）：最佳适应挑 150K 那块
  assert.equal(r.log.find((x) => x.op.name === '5').start / 1024, 490);
  const labels = A.variants(input).map((v) => v.label);
  assert.ok(labels.some((l) => /首次适应/.test(l)));
  assert.ok(labels.some((l) => /没有和相邻的空闲区合并/.test(l)));
  assert.throws(() => A.parse({ ops: 'alloc A' }), /看不懂/);
});
