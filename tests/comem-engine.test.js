// 存储器扩展（kit/src/engines/comem.js）：王道的 2K×4 → 8K×8
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memexpEngine as M, parseCap } from '../kit/src/engines/comem.js';

const hexr = (r) => r.ranges.map((x) => `${x.lo.toString(16)}-${x.hi.toString(16)}`);

test('字位同时扩展：片数、片内地址线、片选、每组地址范围', () => {
  const input = M.parse({ chip: '2K×4', target: '8K×8' });
  const r = M.run(input);
  assert.equal(r.total, 8);
  assert.equal(r.lines, 11);
  assert.equal(r.csBits, 2);
  assert.deepEqual(hexr(r), ['0-7ff', '800-fff', '1000-17ff', '1800-1fff']);
  assert.equal(r.kind, '字位同时扩展');
  // 第 2 组的范围：几种写法都算对
  const ask = r.steps.find((s) => s.ask?.tag === 'range').ask;
  assert.match(ask.answer, /0800H～0FFFH/);
  const labels = M.variants(input).map((v) => v.label);
  assert.equal(labels.length, 3);
});

test('有固定高位：16 根地址线、从 6000H 开始；容量的几种写法', () => {
  const r = M.run(M.parse({ chip: '2K×4', target: '8K×8', addr: 16, base: '6000H' }));
  assert.deepEqual(hexr(r), ['6000-67ff', '6800-6fff', '7000-77ff', '7800-7fff']);
  assert.match(r.steps.at(-1).msg, /A15～A13）固定为 011/);
  assert.deepEqual(parseCap('16K x 8 位'), { words: 16384, bits: 8, text: '16K×8' });
  // 位扩展：只有一组，不问片选
  const b = M.run(M.parse({ chip: '1K×4', target: '1K×8' }));
  assert.equal(b.kind, '位扩展');
  assert.ok(!b.steps.some((s) => s.ask?.tag === 'cs'));
  assert.throws(() => M.parse({ chip: '2K×4', target: '3K×8' }), /整数倍|2 的幂/);
  assert.throws(() => M.parse({ chip: '2K×4', target: '8K×8', base: '1000H' }), /整数倍/);
});
