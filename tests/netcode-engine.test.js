// 编码波形（kit/src/engines/netcode.js）：NRZ、NRZI、曼彻斯特、差分曼彻斯特，编码和读波形
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEngine as A, encodeBits, decodeLevels } from '../kit/src/engines/netcode.js';

const B = [1, 0, 1, 1, 0, 0, 1, 0];
const s = (h) => h.map((x) => x.join('')).join(' ');

test('编码：曼彻斯特 1 前高后低；差分曼彻斯特 0 在位开始处跳；NRZI 0 翻转', () => {
  assert.equal(s(encodeBits(B, 'manchester')), '10 01 10 10 01 01 10 01');
  assert.equal(s(encodeBits(B, 'manchester', { up: true })), '01 10 01 01 10 10 01 10');
  // 开始前低电平：1 不跳 → 前低；0 跳 → 前低（上一位后半是高）……
  assert.equal(s(encodeBits(B, 'diffman')), '01 01 10 01 01 01 10 10');
  assert.equal(s(encodeBits(B, 'nrzi')), '00 11 11 11 00 11 11 00');
  assert.equal(s(encodeBits(B, 'nrz')), '11 00 11 11 00 00 11 00');
  // 编了再读回来
  for (const c of ['nrz', 'nrzi', 'manchester', 'diffman']) assert.deepEqual(decodeLevels(encodeBits(B, c, { start: 1 }), c, { start: 1 }), B, c);
});

test('组件：读波形、码元速率、错法', () => {
  const input = A.parse({ levels: '10 01 10 10 01 01 10 01', code: 'manchester' });
  const r = A.run(input);
  assert.deepEqual(r.bits, B);
  assert.equal(A.quiz(input, r).answer, '0b10110010');
  const e = A.parse({ bits: '10110010', code: 'diffman', rate: '10Mb/s' });
  const re = A.run(e);
  assert.equal(re.baud, '20MBaud');
  assert.deepEqual(A.variants(e).map((v) => v.input.mistake), ['diffInvert', 'baud1']);
  assert.ok(A.variants(A.parse({ levels: '01 01 10 10', code: 'diffman' })).some((v) => v.input.mistake === 'asMan'));
  assert.throws(() => A.parse({ levels: '11 01', code: 'manchester' }), /中间没有跳变/);
  assert.throws(() => A.parse({ bits: '102' }), /bits:/);
});
