// 校验码：crc、hamming（kit/src/engines/codes.js），和王道的例题对一遍
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crcEngine as C, hammingEngine as H, parseGen, mod2div } from '../kit/src/engines/codes.js';

test('CRC：补 r 个 0、模 2 除法、余数和发送的帧；接收方检错；错法', () => {
  assert.equal(parseGen('x^4 + x + 1'), '10011');
  assert.equal(parseGen('x^3+x^2+1'), '1101');
  // 王道：M = 101001，G = 1101 → 余数 001，发送 101001001
  const a = C.run(C.parse({ data: '101001', gen: 'x^3 + x^2 + 1' }));
  assert.equal(a.rem, '001');
  assert.equal(a.frame, '101001001');
  // 经典例子：M = 1101011011，G = 10011 → 余数 1110
  const b = C.run(C.parse({ data: '1101011011', gen: '10011' }));
  assert.equal(b.rem, '1110');
  assert.equal(mod2div('11010110111110', '10011').rem, '0000');
  assert.equal(C.run(C.parse({ recv: '11010110111110', gen: '10011' })).ok, true);
  assert.equal(C.run(C.parse({ recv: '11010110101110', gen: '10011' })).ok, false);
  const input = C.parse({ data: '101001', gen: '1101' });
  const vs = C.variants(input);
  assert.equal(vs.length, 2);
  assert.ok(vs.every((v) => C.run(v.input).rem !== '001'));
  assert.throws(() => C.parse({ data: '1012', gen: '1101' }), /一串 0 和 1/);
});

test('海明码：校验位个数、每个 P、海明码；收到的码找出错的位并改正；错法', () => {
  // 王道：信息 1010 → k = 3，海明码 1010010
  const r = H.run(H.parse({ data: '1010' }));
  assert.equal(r.k, 3);
  assert.deepEqual(r.P, [0, 1, 0]);
  assert.equal(r.code, '1010010');
  // 第 5 位翻了：S = 101 = 5
  const c = H.run(H.parse({ recv: '1000010' }));
  assert.equal(c.pos, 5);
  assert.equal(c.fixed, '1010010');
  assert.equal(H.run(H.parse({ recv: '1010010' })).pos, 0);
  const vs = H.variants(H.parse({ data: '1010' }));
  assert.equal(vs.length, 2);
  assert.ok(vs.every((v) => H.run(v.input).code !== '1010010'));
});
