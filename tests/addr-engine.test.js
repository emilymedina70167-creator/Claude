// 地址变换（engines/addr.js）和位字段的画法（engines/bitview.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addrEngine } from '../kit/src/engines/addr.js';
import { parseSize, parseNum, bitFields, hex } from '../kit/src/engines/bitview.js';
import { checkAsk } from '../kit/src/stepperspec.js';

test('大小、地址的写法', () => {
  assert.equal(parseSize('1K'), 1024);
  assert.equal(parseSize('4KB'), 4096);
  assert.equal(parseSize('2^12'), 4096);
  assert.equal(parseSize('2M'), 2 * 1024 * 1024);
  assert.throws(() => parseSize('abc'), /1KB/);
  assert.equal(parseNum('0x0A5C'), 0xa5cn);
  assert.equal(parseNum('125CH'), 0x125cn);
  assert.equal(parseNum('0b1010'), 10n);
  assert.equal(hex(0x125cn, 16), '125CH');
  const h = bitFields(0xa5cn, [{ name: '页号', bits: 6 }, { name: '页内偏移', bits: 10 }]);
  assert.match(h, /页号<small>6 位<\/small>/);
  assert.match(h, /<span data-cmd="5" class="bv-gap">/, "16 位：第 5、9、13 位前面空开（每组正好一位十六进制）");
  assert.match(h, /<span data-cmd="9" class="bv-gap">/);
});

test('分页地址变换：王道的例子 0A5CH → 125CH；快表、缺页、越界、访存时间', () => {
  const f = { vaddr: '0x0A5C, 0x0D2B, 0x2F00', bits: '16', page: '1KB', table: '0->5, 1->10, 2->4, 3->7, 4->-' };
  const input = addrEngine.parse(f);
  const r = addrEngine.run(input);
  assert.equal(r.results[0].pa, 0x125cn);
  assert.equal(r.results[1].pa, (7n << 10n) | 0x12bn, '0x0D2B 是第 3 页，在第 7 块');
  assert.equal(r.results[2].error, '越界', '0x2F00 是第 11 页，页表里没有');
  for (const s of r.steps) assert.ok(addrEngine.view(s.view, input).length > 0);
  const asks = r.steps.filter((s) => s.ask).map((s) => [s.ask.tag, String(s.ask.answer)]);
  assert.deepEqual(asks.slice(0, 3), [['page', '2'], ['frame', '4'], ['paddr', String(0x125cn)]]);
  assert.ok(checkAsk(r.steps.find((s) => s.ask?.tag === 'paddr').ask, '125CH').ok);
  assert.ok(checkAsk(r.steps.find((s) => s.ask?.tag === 'paddr').ask, '0x125c').ok);
  assert.ok(!checkAsk(r.steps.find((s) => s.ask?.tag === 'paddr').ask, '125D').ok);
  assert.equal(addrEngine.quiz(input, r).answer, '0x125c');
  // 快表 + 访存时间；缺页
  const t = addrEngine.run(addrEngine.parse({ ...f, vaddr: '0x0A5C, 0x0400, 0x1000', tlb: '2->4', cost: 'tlb=20 mem=100 fault=1000' }));
  assert.deepEqual(t.results.map((x) => x.time), [120, 220, 1120]);
  assert.equal(t.results[2].fault, true);
  assert.throws(() => addrEngine.parse({ ...f, tlb: '2->5' }), /对不上/);
  assert.throws(() => addrEngine.parse({ ...f, page: '1000' }), /2 的整数次幂/);
  assert.throws(() => addrEngine.parse({ ...f, vaddr: '0x1FFFF' }), /超出/);
});
