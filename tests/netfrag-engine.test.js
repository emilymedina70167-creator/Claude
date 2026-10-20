// IP 分片（kit/src/engines/netfrag.js）：王道的 4000 字节数据报过 MTU 1500
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fragEngine as A } from '../kit/src/engines/netfrag.js';

const rows = (r) => r.frags.map((f) => [f.len + 20, f.off / 8, f.mf]);

test('4000 字节过 MTU 1500：三片，片偏移 0、185、370', () => {
  const input = A.parse({ total: 4000, mtu: 1500 });
  const r = A.run(input);
  assert.deepEqual(rows(r), [[1500, 0, 1], [1500, 185, 1], [1040, 370, 0]]);
  assert.equal(A.quiz(input, r).answer, '0 185 370');
  // 1500 − 20 = 1480 正好是 8 的倍数，「没取 8 的倍数」和对的一样，不列
  assert.deepEqual(A.variants(input).map((v) => v.input.mistake), ['byteOff', 'noHead']);
});

test('路上再过 MTU 576：已经分过的片再分，片偏移相对原数据报；DF = 1 就丢弃', () => {
  const r = A.run(A.parse({ total: 4000, mtu: '1500, 576' }));
  assert.deepEqual(r.frags.map((f) => f.off / 8), [0, 69, 138, 185, 254, 323, 370, 439]);
  assert.deepEqual(r.frags.map((f) => f.mf), [1, 1, 1, 1, 1, 1, 1, 0]);
  assert.equal(A.variants(A.parse({ total: 4000, mtu: 576 })).length, 3);
  const d = A.run(A.parse({ total: 4000, mtu: 1500, df: 1 }));
  assert.equal(d.dropped, true);
  assert.throws(() => A.parse({ total: 4000 }), /mtu:/);
});
