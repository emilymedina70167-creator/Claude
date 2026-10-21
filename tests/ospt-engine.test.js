// 多级页表（kit/src/engines/ospt.js）：王道的 32 位逻辑地址、4KB 页、4B 页表项
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagetableEngine as A } from '../kit/src/engines/ospt.js';

test('32 位、4KB、4B：两级，10 | 10 | 12；地址拆开每一级的下标', () => {
  const input = A.parse({ vbits: 32, page: '4KB', pte: '4B', vaddr: '0x12345678', pbits: 32 });
  const r = A.run(input);
  assert.equal(r.levels, 2);
  assert.deepEqual(r.widths, [10, 10]);
  // 0x12345678：页目录号 0x048 = 72，第 2 级 0x345 = 837，偏移 0x678
  assert.deepEqual(r.idx, [72, 837]);
  assert.equal(r.steps.find((s) => s.ask?.tag === 'ptebytes').ask.answer, 3);
  assert.equal(r.steps.at(-1).ask.answer, 3);
});

test('分不匀时页目录少几位；指定级数；错法', () => {
  // 48 位、4KB、8B：每级 9 位，36 位页号正好 4 级
  assert.deepEqual(A.run(A.parse({ vbits: 48, page: '4KB', pte: '8B' })).widths, [9, 9, 9, 9]);
  // 32 位、4KB、8B：20 位页号、每级 9 位 → 3 级，2 | 9 | 9
  const input = A.parse({ vbits: 32, page: '4KB', pte: '8B' });
  assert.deepEqual(A.run(input).widths, [2, 9, 9]);
  assert.deepEqual(A.variants(input).map((v) => v.input.mistake), ['noPte', 'floor', 'topFull']);
  // 题目定了一级：页号全给它
  assert.deepEqual(A.run(A.parse({ vbits: 32, page: '4KB', levels: 1 })).widths, [20]);
  assert.throws(() => A.parse({ vbits: 32, page: '3KB' }), /2 的幂/);
});
