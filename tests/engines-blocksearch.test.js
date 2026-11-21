// 视觉交互第 6 批 Task 6：分块查找（组件 blocksearch）。索引表是每块的最大关键字和起始位置；先找块（顺序或折半），再在块里顺序找
import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksearchEngine as E } from '../kit/src/engines/search.js';

const BLOCKS = '22 12 13 8 9 20 | 33 42 44 38 24 48 | 60 58 74 57 86 53';
const runOf = (f) => { const input = E.parse(f); return { input, r: E.run(input) }; };

test('索引表：每块的最大关键字、起始位置；块和块之间要有序', () => {
  const input = E.parse({ blocks: BLOCKS, key: '38' });
  assert.deepEqual(input.index.map((b) => [b.max, b.start]), [[22, 1], [48, 7], [86, 13]]);
  assert.throws(() => E.parse({ blocks: '22 50 | 33 42', key: '33' }), /块和块之间/);
});

test('顺序找块：38 依次和 22、48 比，在第 2 块；块里依次和 33 42 44 38 比，在第 10 个', () => {
  const { r } = runOf({ blocks: BLOCKS, key: '38' });
  assert.deepEqual(r.passes[0], ['22', '48', '33', '42', '44', '38']);
  assert.equal(r.found, 10);
});

test('折半找块（find: binary）：找第一个最大关键字 ≥ key 的块', () => {
  const { r } = runOf({ blocks: BLOCKS, key: '57', find: 'binary' });
  // 索引 22 48 86：low=1 high=3，mid=2：57>48 → low=3；mid=3：57≤86 → high=2；在第 3 块
  assert.deepEqual(r.passes[0].slice(0, 2), ['48', '86']);
  assert.equal(r.found, 16);
});

test('查不到：块里找完了；比最大的还大：索引表就找不到块', () => {
  assert.equal(runOf({ blocks: BLOCKS, key: '40' }).r.found, null);
  assert.equal(runOf({ blocks: BLOCKS, key: '99' }).r.found, null);
});

test('ASL：每块一样长时按公式（顺序找块 (b+1)/2 + (s+1)/2；折半 ⌈log₂(b+1)⌉ + (s+1)/2）', () => {
  const seq = runOf({ blocks: BLOCKS, key: '38', asl: 'on' }).r;
  assert.equal(seq.asl, '2 + 7/2 = 11/2');
  const bin = runOf({ blocks: BLOCKS, key: '38', asl: 'on', find: 'binary' }).r;
  assert.equal(bin.asl, '2 + 7/2 = 11/2');
  assert.ok(seq.steps.some((s) => s.ask?.tag === 'asl'));
});

test('测验和错法：依次比较的关键字；顺序找块当成了折半', () => {
  const { input, r } = runOf({ blocks: BLOCKS, key: '57' });
  assert.equal(E.quiz(input, r).answer, '22 48 86 60 58 74 57');
  assert.match(E.variants(input).map((v) => v.label).join('｜'), /折半/);
});
