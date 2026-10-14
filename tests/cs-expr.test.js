// 计算机课用的表达式：进制字面量、整数函数、位运算、bin / hex（expr.js 浮点，exact.js 精确，两边写法一样）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, valueTeX } from '../kit/src/expr.js';
import { calcValue, expandCalc } from '../kit/src/exact.js';

const exact = (s, v) => calcValue(s, v).text;

test('进制字面量：0x、0b，可以用 _ 分组；精确计算不丢 64 位', () => {
  assert.equal(evaluate('0x1F'), 31);
  assert.equal(evaluate('0b1010_0011'), 163);
  assert.equal(evaluate('2 * 0x10'), 32);
  assert.equal(exact('0xFFFF_FFFF_FFFF_FFFF + 1'), '18446744073709551616');
  assert.equal(exact('2^32 / 2^12'), '1048576');
  // 原来的写法不受影响：0 后面跟变量还是乘法
  assert.equal(evaluate('0x', { x: 3 }), 0);
});

test('整数函数：mod 的结果和模同号、div 向下取整、log2、gcd / lcm', () => {
  for (const [e, v] of [['mod(-7, 3)', 2], ['mod(7, 3)', 1], ['div(-7, 2)', -4], ['div(7, 2)', 3], ['log2(1024)', 10], ['gcd(12, 18)', 6], ['lcm(4, 6)', 12]]) {
    assert.equal(evaluate(e), v, e);
    assert.equal(exact(e), String(v), e);
  }
  assert.equal(exact('log2(1/8)'), '-3');
  assert.equal(calcValue('log2(3)').exact, false, '不是 2 的整数次幂：退回小数');
  assert.throws(() => evaluate('mod(1.5, 2)'), /整数/);
  assert.throws(() => calcValue('mod(3, 0)'), /不能是 0/);
});

test('位运算：与或异或、取反要位数、移位、取某一位；有符号和无符号互换', () => {
  for (const [e, v] of [
    ['and(0xF0, 0b10101010)', 160], ['or(0b1100, 0b1010)', 14], ['xor(0b1100, 0b1010)', 6],
    ['not(0b1010, 4)', 5], ['shl(1, 10)', 1024], ['shr(0x80, 3)', 16], ['bit(0b100, 2)', 1], ['bit(0b100, 1)', 0],
    ['signed(0xFF, 8)', -1], ['signed(0x7F, 8)', 127], ['unsigned(-1, 8)', 255], ['unsigned(-128, 8)', 128],
  ]) {
    assert.equal(evaluate(e), v, e);
    assert.equal(exact(e), String(v), e);
  }
  assert.equal(exact('shl(1, 40)'), '1099511627776');
  assert.throws(() => calcValue('shr(-1, 1)'), /unsigned/);
  assert.throws(() => evaluate('not(5)'), /位数/);
  assert.throws(() => calcValue('signed(256, 8)'), /放不下/);
  assert.throws(() => calcValue('unsigned(-129, 8)'), /放不下/);
});

test('bin / hex：写成文字，四位一组；负数写成补码；不能再算', () => {
  assert.equal(exact('bin(-5, 8)'), '11111011');
  assert.equal(calcValue('bin(-5, 8)').tex, '\\texttt{1111\\,1011}');
  assert.equal(exact('hex(255)'), 'FF');
  assert.equal(calcValue('hex(0x8000_0000, 8)').tex, '\\texttt{8000\\,0000}');
  assert.equal(exact('hex(-1, 4)'), 'FFFF');
  assert.equal(exact('bin(5)'), '101');
  assert.equal(exact('bin(5, 8)'), '00000101');
  assert.equal(valueTeX(evaluate('bin(10, 4)')), '\\texttt{1010}');
  assert.throws(() => calcValue('bin(5, 4) + 1'), /不能再算/);
  assert.throws(() => calcValue('bin(300, 8)'), /比 8 位长/);
  assert.throws(() => calcValue('bin(-5)'), /补码/);
  // 公式里的 \calc 照常展开
  const { tex, errors } = expandCalc('x = \\calc{bin(x, 8)}', (e) => calcValue(e, { x: 6 }).tex);
  assert.deepEqual(errors, []);
  assert.equal(tex, 'x = {\\texttt{0000\\,0110}}');
});
