// 浮点加减运算（kit/src/engines/cofloat.js）：唐朔飞 / 王道的例题
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faddEngine as A, mText, eCode } from '../kit/src/engines/cofloat.js';
import { checkAsk } from '../kit/src/stepperspec.js';

const ask = (r, tag) => r.steps.find((s) => s.ask?.tag === tag)?.ask;

test('x = 2^010 × 0.11011011，y = 2^100 × (−0.10101100)，求 x + y', () => {
  const input = A.parse({ x: '2^010 × 0.11011011', y: '2^100 × (-0.10101100)' });
  const r = A.run(input);
  // 对阶：ΔE = −2，x 右移 2 位 → 00.00110110(11)；相加 11.10001010(11)；左规 1 位 11.00010101(1)，阶码 00,011；0 舍 1 入 11.00010110
  assert.equal(mText(r.mid.mA, 8, 2), '00.00110110(11)');
  assert.equal(mText(r.mid.sum, 8, 2), '11.10001010(11)');
  assert.equal(r.norm, '左规');
  assert.equal(eCode(r.e, 3), '00,011');
  assert.equal(mText(r.m, 8), '11.00010110');
  assert.equal(r.of, '没有溢出');
  assert.match(r.steps.at(-1).msg, /2\^\{011\}\\times\(-0\.11101010\) = -7\.3125/);
  // 写法：小数点、括号写不写都算对
  assert.ok(checkAsk(ask(r, 'sum'), '11.10001010(11)').ok);
  assert.ok(checkAsk(ask(r, 'sum'), '1110001010 11').ok);
  assert.ok(checkAsk(ask(r, 'round'), '11.00010110').ok);
  assert.ok(checkAsk(ask(r, 'code'), '11.01010100').ok);
  assert.equal(ask(r, 'shift').answer, 2);
  // 错法：没舍入、把 11.1×× 当成规格化的、大阶向小阶看齐
  const labels = A.variants(input).map((v) => v.label);
  assert.equal(labels.length, 3);
});

test('减法、右规、溢出', () => {
  // x − y：两个正数相减后加上 [−My]补
  const r = A.run(A.parse({ x: '2^01 × 0.1101', y: '2^01 × 0.1011', op: '-' }));
  assert.equal(mText(r.mid.sum, 4), '00.0010');
  assert.equal(r.norm, '左规');
  assert.equal(r.k, 2);
  assert.equal(eCode(r.e, 2), '11,11');
  // 尾数溢出要右规；阶码已经最大时上溢
  const o = A.run(A.parse({ x: '2^11 × 0.1101', y: '2^11 × 0.1011' }));
  assert.equal(o.norm, '右规');
  assert.equal(o.of, '上溢');
  assert.equal(A.run(A.parse({ x: '2^01 × 0.1101', y: '2^01 × 0.1101', op: '-' })).zero, true);
  assert.throws(() => A.parse({ x: '0.1101', y: '2^01 × 0.1' }), /2\^阶码 × 尾数/);
});
