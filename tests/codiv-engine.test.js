// 定点除法（kit/src/engines/codiv.js）：唐朔飞 / 王道的原码加减交替法例题；补码加减交替法和真值比
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { divEngine as D } from '../kit/src/engines/codiv.js';

test('原码加减交替法：x = −0.1011，y = −0.1101 → 商 0.1101，余数 −0.0111 × 2^−4', () => {
  const input = D.parse({ x: '-0.1011', y: '-0.1101', algo: 'orig' });
  const r = D.run(input);
  assert.equal(r.quotient, '0.1101');
  assert.equal(r.rem, -7n);
  assert.deepEqual(r.steps.filter((s) => s.ask?.tag === 'q').map((s) => s.ask.answer), ['0', '1', '1', '0', '1']);
  // 这道商是正的、余数是负的：余数的符号跟了商看得出来
  assert.ok(D.variants(input).some((x) => x.input.mistake === 'remSign'));
  assert.throws(() => D.parse({ x: '0.1101', y: '0.1011' }), /\|x\| < \|y\|/);
});

test('补码加减交替法：商的末位恒置 1，和真值差不到 2^−n', () => {
  const v = (s) => (s.startsWith('-') ? -1 : 1) * parseInt(s.replace('-', '').slice(2), 2) / 16;
  for (const [x, y] of [['0.1000', '0.1101'], ['-0.1000', '0.1101'], ['0.1001', '-0.1011'], ['-0.0110', '-0.1110']]) {
    const r = D.run(D.parse({ x, y, algo: 'comp' }));
    assert.ok(r.quotient.endsWith('1'), `${x} ÷ ${y}：末位恒置 1`);
    assert.ok(Math.abs(Number(r.q) / 16 - v(x) / v(y)) <= 1 / 16 + 1e-9, `${x} ÷ ${y} = ${r.quotient}`);
  }
  assert.equal(D.run(D.parse({ x: '0.1000', y: '0.1101', algo: 'comp' })).quotient, '0.1001');
  // 除数是负的：第一步都减、只看余数正负上商这两种错法看得出来（两个正数相除时和对的一样）
  const input = D.parse({ x: '0.1001', y: '-0.1011', algo: 'comp' });
  assert.deepEqual(D.variants(input).map((x) => x.input.mistake).slice(0, 2), ['firstSub', 'signOnly']);
});
