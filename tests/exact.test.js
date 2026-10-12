import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Q, evaluateExact, calcValue, expandCalc, exactTeX, exactText, toExact, toFloat, rrefOf } from '../kit/src/exact.js';
import { evaluate } from '../kit/src/expr.js';

const text = (src, vars) => exactText(evaluateExact(src, vars));

test('精确：分数不丢精度', () => {
  assert.equal(text('1/3 + 1/6'), '1/2');
  assert.equal(text('0.1 + 0.2'), '3/10');
  assert.equal(text('2^-3'), '1/8');
  assert.equal(text('(-2/3)^3'), '-8/27');
  assert.equal(text('3^40'), '12157665459056928801'); // 浮点会丢最后几位
  assert.equal(exactTeX(evaluateExact('-3/4')), '-\\tfrac{3}{4}');
});

test('精确：矩阵运算', () => {
  const v = { A: [[-1, -1, 2], [2, 2, -4], [1, 1, -2]], a: [-1, 2, 1], b: [1, 1, -2] };
  // 例2.1：A = a b'，A² = -A，tr A = b'a = -1
  assert.equal(text("a*b'", v), '[[-1, -1, 2], [2, 2, -4], [1, 1, -2]]');
  assert.equal(text("b'*a", v), '-1');
  assert.equal(text('tr(A)', v), '-1');
  assert.equal(text('A^2 + A', v), '[[0, 0, 0], [0, 0, 0], [0, 0, 0]]');
  assert.equal(text('rank(A)', v), '1');
  assert.equal(text('A^10', v), text('-A', v));
  // 例2.2：A² = 4E，A⁹ = 256A
  const B = { B: [[1, -1, -1, -1], [-1, 1, -1, -1], [-1, -1, 1, -1], [-1, -1, -1, 1]] };
  assert.equal(text('B^2', B), text('4E(4)'));
  assert.equal(text('B^9', B), text('256B', B));
  // 例2.3：(E + N)^n 的上三角
  assert.equal(text('[[1, 1, 0], [0, 1, 1], [0, 0, 1]]^5'), '[[1, 5, 10], [0, 1, 5], [0, 0, 1]]');
  // 逆、行列式、行最简形
  assert.equal(text('inv([[2, 1], [7, 4]])'), '[[4, -1], [-7, 2]]');
  assert.equal(text('inv([[1, 2], [3, 4]])'), '[[-2, 1], [3/2, -1/2]]');
  assert.equal(text('det([[2, 0, 1], [1, 3, 2], [1, 1, 2]])'), '6');
  assert.equal(text('det([[2, 0, 1], [1, 3, 2], [1, 1, 1]])'), '0');
  assert.equal(text('det([[0, 1], [1, 0]])'), '-1'); // 要换行的
  assert.equal(text('[[1, 2], [3, 4]]^-2'), text('inv([[1, 2], [3, 4]])^2'));
  assert.equal(text('rref([[1, 2, 3], [2, 4, 7]])'), '[[1, 2, 0], [0, 0, 1]]');
  assert.throws(() => evaluateExact('inv([[1, 2], [2, 4]])'), /不可逆/);
  assert.throws(() => evaluateExact('[[1, 2], [3, 4]] + E(3)'), /尺寸不同/);
  assert.throws(() => evaluateExact('[1, 2] * [3, 4]'), /内积/);
});

test('精确：向量是列，转置是一行', () => {
  assert.equal(text("[1, 2, 3]'"), '[[1, 2, 3]]');
  assert.equal(text("[1, 2, 3]' * [1, 2, 3]"), '14');
  assert.equal(text("[1, 2] * [3, 4]'"), '[[3, 4], [6, 8]]');
  // 浮点引擎用同样的规则
  assert.equal(evaluate("[1, 2, 3]' * [1, 2, 3]"), 14);
  assert.deepEqual(evaluate("[1, 2] * [3, 4]'"), [[3, 4], [6, 8]]);
  assert.equal(evaluate('tr([[1, 2], [3, 4]])'), 5);
  assert.equal(evaluate('rank([[1, 2], [2, 4]])'), 1);
  assert.deepEqual(evaluate('E(3)'), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
});

test('精确：算不出精确值时退回小数', () => {
  const r = calcValue('sqrt(2)');
  assert.equal(r.exact, false);
  assert.equal(r.tex, '1.414');
  const s = calcValue('sqrt(9/4)');
  assert.equal(s.exact, true);
  assert.equal(s.tex, '\\tfrac{3}{2}');
  assert.equal(calcValue('norm([3, 4])').text, '5');
  assert.equal(calcValue('cos(60)').exact, false);
  assert.throws(() => calcValue('Z + 1'), /未定义的变量 Z/);
});

test('精确：浮点变量换成分数', () => {
  assert.equal(toExact(1 / 3).toString(), '1/3');
  assert.equal(toExact(0.5).toString(), '1/2');
  assert.equal(toExact(-2.75).toString(), '-11/4');
  assert.deepEqual(toFloat(toExact([[0.5, 2]])), [[0.5, 2]]);
  assert.equal(new Q(6n, -4n).toString(), '-3/2');
  const { rank, pivots } = rrefOf(toExact([[0, 2], [0, 4]]));
  assert.equal(rank, 1);
  assert.deepEqual(pivots, [[0, 1]]);
});

test('\\calc{…}：公式里的数由页面算', () => {
  const ev = (src) => calcValue(src, { A: [[1, 1], [2, 2]] }).tex;
  assert.equal(expandCalc('A^2=\\calc{A^2}', ev).tex, 'A^2={\\begin{bmatrix}3 & 3 \\\\ 6 & 6\\end{bmatrix}}');
  assert.equal(expandCalc('\\calc{ [1, 2]\' * [3, 4] } + x', ev).tex, '{11} + x');
  // 嵌套的括号、好几处
  assert.equal(expandCalc('\\calc{max(1, (2+3))} \\cdot \\calc{1/2}', ev).tex, '{5} \\cdot {\\tfrac{1}{2}}');
  const bad = expandCalc('x=\\calc{B+1}', ev);
  assert.equal(bad.tex, 'x={\\text{?}}');
  assert.match(bad.errors[0].msg, /未定义的变量 B/);
  assert.equal(expandCalc('没有 calc', ev).tex, '没有 calc');
  assert.match(expandCalc('\\calc{1+', ev).errors[0].msg, /右括号/);
});
