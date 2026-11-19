// 检验里值怎么比（计划 4 Task 3；kit/src/check/values.js）：分数小数百分数、复杂度、序列
import test from 'node:test';
import assert from 'node:assert/strict';
import { numMatch, bigO, seqMatch, valueMatch, sameResult } from '../kit/src/check/values.js';

test('numMatch：小数按写出来的位数四舍五入、至少 2 位；分数只认一模一样', () => {
  assert.equal(numMatch('5.33', 16 / 3), true);
  assert.equal(numMatch('5.333', 16 / 3), true);
  assert.equal(numMatch('5.3', 16 / 3), false);
  assert.equal(numMatch('5', 16 / 3), false);
  assert.equal(numMatch('5.34', 16 / 3), false);
  assert.equal(numMatch('5.330', 16 / 3), false); // 写了 3 位就按 3 位比：5.333
  assert.equal(numMatch('16/3', 16 / 3), true);
  assert.equal(numMatch('16 / 3', 16 / 3), true);
  assert.equal(numMatch('5/3', 16 / 3), false);
  assert.equal(numMatch('533/100', 16 / 3), false);
});

test('numMatch：0.75、75%、3/4 不管位数都对；百分数换成小数以后数位数', () => {
  for (const s of ['0.75', '75%', '3/4', '.75', '75.0%', '75％']) assert.equal(numMatch(s, 0.75), true, s);
  assert.equal(numMatch('53.33%', 0.53333), true);
  assert.equal(numMatch('53.33%', 8 / 15), true);
  assert.equal(numMatch('53%', 8 / 15), true); // 换成小数是 0.53：2 位
  assert.equal(numMatch('53.3%', 8 / 15), true);
  assert.equal(numMatch('54%', 8 / 15), false);
  assert.equal(numMatch('0.5', 8 / 15), false);
  // 整数：10、10.0 对 10
  assert.equal(numMatch('10', 10), true);
  assert.equal(numMatch('10.0', 10), true);
  assert.equal(numMatch('9', 10), false);
  assert.equal(numMatch('-2', -2), true);
});

test('numMatch：读不懂是 null', () => {
  for (const s of ['', 'abc', '1/', '1/0', '5.3.3', 'O(n)', '1 2']) assert.equal(numMatch(s, 1), null, s);
  assert.equal(numMatch('1', NaN), null);
});

test('bigO：log 的底、lg、空格、上标、乘号都不管', () => {
  const nlogn = bigO('O(nlogn)');
  assert.equal(nlogn, 'O(nlogn)');
  for (const s of ['O(n log₂n)', 'O(nlgn)', 'O(n log n)', 'O(n*log n)', 'O(n log(n))', 'O(log n · n)', 'o(nlog2n)', 'nlogn', 'O（n log n）']) assert.equal(bigO(s), nlogn, s);
  assert.equal(bigO('O(n log₂n)'), bigO('O(nlgn)'));
  assert.equal(bigO('O(n²)'), bigO('O(n^2)'));
  assert.equal(bigO('O(n*n)'), bigO('O(n^2)'));
  assert.equal(bigO('O(n^{2})'), 'O(n^2)');
  assert.notEqual(bigO('O(n)'), bigO('O(n^2)'));
  assert.notEqual(bigO('O(nlogn)'), bigO('O(n^2)'));
  assert.equal(bigO('O(1)'), 'O(1)');
  assert.equal(bigO('O(2n)'), 'O(n)');
  assert.equal(bigO('O(n+e)'), bigO('O(e + n)'));
  assert.equal(bigO('O(|V|+|E|)'), bigO('O(e+v)'));
  assert.equal(bigO('O(log²n)'), bigO('O((log n)^2)'));
  assert.equal(bigO('O(2ⁿ)'), bigO('O(2^n)'));
  assert.equal(bigO(''), null);
  assert.equal(bigO('O(n?)'), null);
});

test('seqMatch：先后算数；set 不论先后；相同的数的撇号写法', () => {
  assert.equal(seqMatch('1, 2, 3', [1, 2, 3]), true);
  assert.equal(seqMatch('3 2 1', [1, 2, 3]), false);
  assert.equal(seqMatch('3 2 1', [1, 2, 3], { set: true }), true);
  assert.equal(seqMatch("49 49'", '49 49′'), true);
  assert.equal(seqMatch('49 49', ['49', '49′']), true);
});

test('valueMatch：按值的样子挑', () => {
  assert.equal(valueMatch('5.33', 16 / 3), true);
  assert.equal(valueMatch('x', 3), null);
  assert.equal(valueMatch('O(n log₂n)', 'O(nlogn)'), true);
  assert.equal(valueMatch('O(n^2)', 'O(nlogn)'), false);
  assert.equal(valueMatch('n??', 'O(nlogn)'), null);
  assert.equal(valueMatch('1 2 3', ['1', '2', '3']), true);
  assert.equal(valueMatch('P2 P1', 'P1 P2'), false);
  assert.equal(valueMatch('', 'P1 P2'), false);
});

test('sameResult：算出来的两个值', () => {
  assert.equal(sameResult(10, 10), true);
  assert.equal(sameResult(10, 9), false);
  assert.equal(sameResult(['1', '2'], ['1', '2']), true);
  assert.equal(sameResult('2', 2), true);
  assert.equal(sameResult([1], 1), false);
  assert.equal(sameResult('O(nlgn)', 'O(n log n)'), true);
});
