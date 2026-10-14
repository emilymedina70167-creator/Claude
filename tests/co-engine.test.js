// 组成原理的演示引擎（engines/co.js）：数的表示、IEEE 754、补码加减和标志位、Cache、流水线
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitsEngine, cacheEngine, pipeEngine } from '../kit/src/engines/co.js';
import { checkAsk } from '../kit/src/stepperspec.js';

const go = (eng, f) => { const input = eng.parse(f); return { input, r: eng.run(input) }; };

test('原码、反码、补码、移码；−2^(n−1) 只有补码和移码能表示', () => {
  assert.deepEqual(go(bitsEngine, { num: '-5' }).r.rows, { 原码: '10000101', 反码: '11111010', 补码: '11111011', 移码: '01111011' });
  assert.deepEqual(go(bitsEngine, { num: '5', width: '6' }).r.rows, { 原码: '000101', 反码: '000101', 补码: '000101', 移码: '100101' });
  assert.deepEqual(go(bitsEngine, { num: '-128' }).r.rows, { 原码: null, 反码: null, 补码: '10000000', 移码: '00000000' });
  const { r } = go(bitsEngine, { num: '-5', show: '补码' });
  assert.ok(checkAsk(r.steps.find((s) => s.ask?.tag === 'twos').ask, '1111 1011').ok);
  assert.ok(!checkAsk(r.steps.find((s) => s.ask?.tag === 'twos').ask, '1111011').ok, '要写满 8 位');
  assert.throws(() => bitsEngine.parse({ num: '200' }), /放不下/);
  assert.throws(() => bitsEngine.parse({ num: '1', show: '格雷码' }), /show/);
});

test('IEEE 754 单精度：编码（就近舍入）、解码', () => {
  const enc = (x) => go(bitsEngine, { float: x }).r.bits.toString(16).toUpperCase();
  assert.equal(enc('-0.75'), 'BF400000');
  assert.equal(enc('100.25'), '42C88000');
  assert.equal(enc('-12.375'), 'C1460000');
  assert.equal(enc('0.1'), '3DCCCCCD');
  assert.equal(enc('1'), '3F800000');
  assert.equal(enc('0'), '0');
  assert.equal(go(bitsEngine, { float: '0xC0A00000' }).r.value, -5);
  assert.equal(go(bitsEngine, { float: 'BEE00000H' }).r.value, -0.4375);
  const { input, r } = go(bitsEngine, { float: '-0.75' });
  assert.equal(bitsEngine.quiz(input, r, {}).answer, '0xbf400000');
  assert.ok(checkAsk(r.steps.find((s) => s.ask?.tag === 'hex').ask, 'BF40 0000H').ok);
});

test('补码加减法和标志位（王道：OF = Cn ⊕ Cn−1，CF = Cout ⊕ Cin）', () => {
  const f = (op, e) => go(bitsEngine, { [op]: e }).r;
  assert.deepEqual(f('add', '0x7F + 0x01').flags, { OF: 1, SF: 1, ZF: 0, CF: 0 });
  assert.deepEqual(f('sub', '5 - 7').flags, { OF: 0, SF: 1, ZF: 0, CF: 1 });
  assert.deepEqual(f('sub', '7 - 5').flags, { OF: 0, SF: 0, ZF: 0, CF: 0 });
  assert.deepEqual(f('sub', '0x80 - 1').flags, { OF: 1, SF: 0, ZF: 0, CF: 0 });
  assert.deepEqual(f('add', '0xFF + 1').flags, { OF: 0, SF: 0, ZF: 1, CF: 1 });
  assert.equal(f('sub', '5 - 7').R, 0xfen);
  const { input, r } = go(bitsEngine, { add: '-3 + 5', width: '4' });
  assert.equal(r.R, 2n);
  for (const s of r.steps) assert.match(bitsEngine.view(s.view, input), /co-add/);
  assert.throws(() => bitsEngine.parse({ add: '1 * 2' }), /写成/);
});

test('Cache：直接映射、组相联、全相联（LRU）；按地址拆标记 | 组号 | 块内地址', () => {
  const B = '0 4 8 2 0 6 8 6 4 8';
  assert.equal(go(cacheEngine, { lines: '4', blocks: B }).r.hits, 1);
  assert.equal(go(cacheEngine, { lines: '4', ways: '2', blocks: B }).r.hits, 1);
  assert.equal(go(cacheEngine, { lines: '4', ways: 'full', blocks: B }).r.hits, 4);
  assert.equal(go(cacheEngine, { lines: '4', ways: 'full', blocks: B, replace: 'fifo' }).r.hits, 5);
  const a = go(cacheEngine, { lines: '8', ways: '2', block: '16B', addr: '16', refs: '0x0010, 0x0124, 0x0010' });
  assert.equal(a.r.hits, 1);
  assert.deepEqual(a.r.steps.filter((s) => s.ask?.tag === 'set').map((s) => s.ask.answer), [1, 2, 1]);
  for (const s of a.r.steps) assert.match(cacheEngine.view(s.view, a.input), /co-cache/);
  assert.throws(() => cacheEngine.parse({ lines: '6', blocks: B }), /2 的整数次幂/);
  assert.throws(() => cacheEngine.parse({ lines: '4', ways: '3', blocks: B }), /ways/);
});

test('流水线：数据相关的阻塞（没有转发 / 有转发 / load-use）', () => {
  const code = 'add r1, r2, r3\nsub r4, r1, r5\nand r6, r1, r7\nor r8, r2, r9';
  const p = (extra) => go(pipeEngine, { instrs: code, ...extra }).r;
  assert.equal(p({}).total, 10);
  assert.deepEqual(p({}).sched.map((s) => s.stall), [0, 2, 0, 0]);
  assert.equal(p({ split: 'no' }).total, 11);
  assert.equal(p({ forward: 'yes' }).total, 8);
  const lu = go(pipeEngine, { instrs: 'lw r1, 0(r2); add r3, r1, r4', forward: 'yes' });
  assert.deepEqual(lu.r.sched.map((s) => s.stall), [0, 1]);
  assert.equal(pipeEngine.quiz(lu.input, lu.r).answer, '7');
  for (const s of lu.r.steps) assert.match(pipeEngine.view(s.view, lu.input), /co-pipe/);
  // sw、beq 不写寄存器
  assert.deepEqual(go(pipeEngine, { instrs: 'sw r1, 0(r2)\nadd r3, r1, r4' }).r.sched.map((s) => s.stall), [0, 0]);
});
