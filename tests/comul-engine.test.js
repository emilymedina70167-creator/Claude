// 定点乘法（kit/src/engines/comul.js）：王道的 x = −0.1101、y = 0.1011
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulEngine as A } from '../kit/src/engines/comul.js';
import { checkAsk } from '../kit/src/stepperspec.js';

test('Booth：[x·y]补 = 1.01110001；每次看 y_n y_{n+1}', () => {
  const input = A.parse({ x: '-0.1101', y: '0.1011', algo: 'booth' });
  const r = A.run(input);
  assert.equal(r.prodText, '1.01110001');
  // [y]补 = 0.1011 | 0：10 → +[−x]补，11 → +0，01 → +[x]补，10 → +[−x]补，01 → +[x]补（第 5 次只加不移）
  assert.deepEqual(r.steps.filter((s) => s.ask?.tag === 'op').map((s) => s.ask.answer), ['+[−x]补', '+0', '+[x]补', '+[−x]补', '+[x]补']);
  assert.equal(r.rows.filter((x) => x.kind === 'shift').length, 4);
  assert.ok(checkAsk(r.steps.at(-1).ask, '1.01110001').ok);
  assert.ok(checkAsk(r.steps[1].ask, '00.1101').ok);
  assert.equal(A.variants(input).length, 3);
  // 两个负数、和真值对一下
  for (const [x, y] of [['-0.1101', '-0.1011'], ['0.111', '-0.101'], ['-0.11', '0.01']]) {
    const q = A.run(A.parse({ x, y, algo: 'booth' }));
    const v = (s) => (s.startsWith('-') ? -1 : 1) * parseInt(s.replace('-', '').slice(2), 2) / 2 ** (s.replace('-', '').length - 2);
    const n = Math.max(x.replace('-', '').length, y.replace('-', '').length) - 2;
    assert.equal(Number(q.P) / 2 ** (2 * n), v(x) * v(y), `${x} × ${y}`);
  }
});

test('原码一位乘：[x·y]原 = 1.10001111', () => {
  const input = A.parse({ x: '-0.1101', y: '0.1011', algo: 'orig' });
  const r = A.run(input);
  assert.equal(r.prodText, '1.10001111');
  assert.deepEqual(r.steps.filter((s) => s.ask?.tag === 'op').map((s) => s.ask.answer), ['+|x|', '+|x|', '+0', '+|x|']);
  assert.deepEqual(A.variants(input).map((v) => v.input.mistake), ['arith']);
  assert.throws(() => A.parse({ x: '1.01', y: '0.1' }), /定点小数/);
});
