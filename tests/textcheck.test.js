// 文字型答案：序列（type: seq）、二进制 / 十六进制（type: bin / hex）的读法和判分（kit/src/textcheck.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeqAnswer, splitSeq, checkSeq, radixAnswer, readRadix, checkRadix, groupDigits } from '../kit/src/textcheck.js';
import { evaluate } from '../kit/src/expr.js';

test('序列的写法：空格、逗号、顿号、箭头都能分；单字符可以连着写；全角和大小写不管', () => {
  assert.deepEqual(splitSeq('A B D E C'), ['A', 'B', 'D', 'E', 'C']);
  assert.deepEqual(splitSeq('A,B，D、E→C'), ['A', 'B', 'D', 'E', 'C']);
  assert.deepEqual(splitSeq('A -> B => C'), ['A', 'B', 'C']);
  assert.deepEqual(splitSeq('ABDEC', { single: true }), ['A', 'B', 'D', 'E', 'C']);
  assert.deepEqual(splitSeq('ABDEC'), ['ABDEC'], '答案不是单字符时不拆');
  assert.deepEqual(splitSeq('(P1, P3, P2)'), ['P1', 'P3', 'P2']);
  assert.ok(checkSeq('ａｂｄｅｃ', parseSeqAnswer('A B D E C')).ok, '全角小写也算');
  assert.ok(checkSeq('abdec', parseSeqAnswer('A B D E C')).ok);
});

test('序列判分：说前几个对、哪几个位置不对，不说应该是什么；几种都对时挑最接近的那种指错', () => {
  const ans = parseSeqAnswer('A B D E C');
  let r = checkSeq('A B E D C', ans);
  assert.equal(r.ok, false);
  assert.deepEqual(r.wrong, [2, 3]);
  assert.match(r.msg, /前 2 个是对的，从第 3 个开始不对/);
  assert.doesNotMatch(r.msg, /应该是 D/);
  r = checkSeq('A B D', ans);
  assert.match(r.msg, /你写了 3 个，应该是 5 个。前 3 个是对的/);
  r = checkSeq('C B D E A', ans);
  assert.match(r.msg, /第 1 个就不对/);
  // 拓扑序列这类几种都对的
  const topo = parseSeqAnswer('1 2 3 4 | 1 3 2 4');
  assert.ok(checkSeq('1 3 2 4', topo).ok);
  assert.match(checkSeq('1 3 2 4', topo).msg, /也是一种正确的顺序/);
  r = checkSeq('1 3 4 2', topo);
  assert.deepEqual(r.wrong, [2, 3], '按第二种（前两个对上）指错');
  assert.throws(() => parseSeqAnswer('  | '), /要写出序列/);
  // 多位数的序列：连着写不拆，个数对不上
  r = checkSeq('7012', parseSeqAnswer('7 0 1 2'));
  assert.ok(r.ok, '答案全是单个字符时，7012 也能拆');
  r = checkSeq('1215', parseSeqAnswer('12 15'));
  assert.equal(r.ok, false);
});

test('位串：标准答案的位数、补码；读学生写的（前缀、后缀、分组）', () => {
  assert.deepEqual(radixAnswer(5, 2), { digits: '101', base: 2, width: 0 });
  assert.deepEqual(radixAnswer(5, 2, 8), { digits: '00000101', base: 2, width: 8 });
  assert.deepEqual(radixAnswer(-5, 2, 8), { digits: '11111011', base: 2, width: 8 });
  assert.deepEqual(radixAnswer(-1, 16, 4), { digits: 'FFFF', base: 16, width: 4 });
  assert.deepEqual(radixAnswer(2n ** 64n - 1n, 16), { digits: 'FFFFFFFFFFFFFFFF', base: 16, width: 0 });
  assert.deepEqual(radixAnswer(evaluate('bin(6, 8)'), 2), { digits: '00000110', base: 2, width: 8 }, 'bin() 补足的前导 0 算位数要求');
  assert.throws(() => radixAnswer(evaluate('bin(6, 8)'), 16), /type 却写了 hex/);
  assert.throws(() => radixAnswer(-5, 2), /bits/);
  assert.throws(() => radixAnswer(300, 2, 8), /比 bits: 8 长/);
  assert.throws(() => radixAnswer(1.5, 2), /整数/);
  assert.equal(readRadix('0b1111_1011', 2), '11111011');
  assert.equal(readRadix('1111 1011B', 2), '11111011');
  assert.equal(readRadix('0x8000 0000', 16), '80000000');
  assert.equal(readRadix('3fh', 16), '3F');
  assert.throws(() => readRadix('1021', 2), /只能写 0 和 1（这里有「2」）/);
  assert.throws(() => readRadix('3G', 16), /0–9 和 A–F/);
  assert.equal(groupDigits('11111011'), '1111 1011');
  assert.equal(groupDigits('101111'), '10 1111');
});

test('位串判分：要求位数时逐位比、指出第几位；不要求时比数值（前导 0 不管）', () => {
  const comp = radixAnswer(-5, 2, 8);
  assert.ok(checkRadix('1111 1011', comp).ok);
  let r = checkRadix('1111 1010', comp);
  assert.deepEqual(r.wrong, [7]);
  assert.match(r.msg, /有 1 位不对.*第 8 位/);
  r = checkRadix('111 1011', comp);
  assert.match(r.msg, /要写 8 位，你写了 7 位/);
  const v = radixAnswer(0x3f, 16);
  assert.ok(checkRadix('003F', v).ok, '没要求位数：前导 0 不管');
  assert.ok(checkRadix('0x3f', v).ok);
  r = checkRadix('3E', v);
  assert.deepEqual(r.wrong, [1]);
  r = checkRadix('0x13E', v);
  assert.match(r.msg, /位数不对/);
  r = checkRadix('12', radixAnswer(1, 2));
  assert.equal(r.bad, true, '写了不认识的字符');
});
