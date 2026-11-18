// 非交换多项式的判定（kit/src/ncalg.js）：舞台上的式子让学生换项、合并、展开时，页面拿它判合不合法
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equivalent, expandText, splitTerms, expandTerm, likeTerms, mergedText, parse, unknownWhy, toTex } from '../kit/src/ncalg.js';

test('正例：数学上相等的', () => {
  assert.equal(equivalent('(A+B)^2', 'A^2+AB+BA+B^2'), true);
  assert.equal(equivalent('(A+B)(A+B)', 'A^2+AB+BA+B^2'), true);
  assert.equal(equivalent('AE', 'A'), true);
  assert.equal(equivalent('EA', 'AI'), true);
  assert.equal(equivalent('(kE)A', 'A(kE)'), true);
  assert.equal(equivalent('kA', 'Ak'), true);
  assert.equal(equivalent('2AB', 'AB+AB'), true);
  assert.equal(equivalent('A+B', 'B+A'), true);
  assert.equal(equivalent('(A-B)(A+B)', 'A^2+AB-BA-B^2'), true);
  assert.equal(equivalent('A^2 A', 'A^3'), true);
  assert.equal(equivalent('(a+b)^2', 'a^2+2ab+b^2'), true); // 标量交换
  assert.equal(equivalent('AO + B', 'B'), true);
  assert.equal(equivalent('1/2 A + 1/2 A', 'A'), true);
  assert.equal(equivalent('A·B', 'AB'), true);
  assert.equal(equivalent('A²+A B', 'A(A+B)'), true);
  assert.equal(equivalent('\\left(A+B\\right)^{2}', 'A^2+AB+BA+B^2'), true);
  assert.equal(equivalent('λE - A', '-(A - λE)'), true);
  assert.equal(equivalent('A_1 A_2', 'A1A2'), true);
});

test('反例：矩阵不交换的', () => {
  assert.equal(equivalent('AB+BA', '2AB'), false);
  assert.equal(equivalent('(A+B)^2', 'A^2+2AB+B^2'), false);
  assert.equal(equivalent('(A-B)(A+B)', 'A^2-B^2'), false);
  assert.equal(equivalent('AB', 'BA'), false);
  assert.equal(equivalent('A(B+C)', 'BA+CA'), false);
  assert.equal(equivalent('ABA', 'A^2B'), false);
  assert.equal(equivalent('A+B', 'A-B'), false);
});

test('判不了的：逆、转置、除以矩阵、函数、读不懂的', () => {
  assert.equal(equivalent('A^-1 A', 'E'), 'unknown');
  assert.equal(equivalent('A^{-1}A', 'E'), 'unknown');
  assert.equal(equivalent("A'B", 'B'), 'unknown');
  assert.equal(equivalent('A^T', 'A'), 'unknown');
  assert.equal(equivalent('A/B', 'A'), 'unknown');
  assert.equal(equivalent('A/k', 'A'), 'unknown');
  assert.equal(equivalent('det(A)', 'A'), 'unknown');
  assert.equal(equivalent('A^n', 'A'), 'unknown');
  assert.equal(equivalent('A +', 'A'), 'unknown');
  assert.equal(equivalent('(A+B', 'A+B'), 'unknown');
  assert.equal(equivalent('A^{99}', 'A'), 'unknown'); // 次方太大
  assert.match(unknownWhy('A^-1 A', 'E'), /逆/);
  assert.match(unknownWhy("A'", 'A'), /转置/);
  assert.equal(parse('').ok, false);
});

test('展开、拆项、展开一项（不合并）', () => {
  assert.equal(expandText('(A+B)(A-B)'), 'A^2 - AB + BA - B^2');
  assert.equal(expandText('AB+BA-AB'), 'BA');
  assert.deepEqual(splitTerms('A^2 + 2AB - BA').map((t) => [t.sign, t.text]), [[1, 'A^2'], [1, '2AB'], [-1, 'BA']]);
  assert.deepEqual(splitTerms('(A+B)(A+B)')[0].factors, ['(A + B)', '(A + B)']);
  assert.deepEqual(expandTerm('(A+B)(A+B)').map((t) => t.text), ['A^2', 'AB', 'BA', 'B^2']);
  assert.deepEqual(expandTerm('(a+b)(a+b)').map((t) => t.text), ['a^2', 'ab', 'ab', 'b^2']); // 不合并：ab 两次
  assert.deepEqual(expandTerm('(A-B)^2').map((t) => [t.sign, t.text]), [[1, 'A^2'], [-1, 'AB'], [-1, 'BA'], [1, 'B^2']]);
});

test('同类项：AB 和 BA 不是；2AB 和 -AB 是', () => {
  const x = likeTerms('AB', 'BA');
  assert.equal(x.like, false);
  assert.match(x.why, /不交换/);
  const y = likeTerms('2AB', '-AB');
  assert.equal(y.like, true);
  assert.equal(mergedText(y.sum), 'AB');
  assert.equal(mergedText(likeTerms('AB', '-AB').sum), '0');
  assert.equal(likeTerms('kA', 'Ak').like, true);
  assert.equal(likeTerms('(A+B)', 'A').like, false);
  assert.equal(likeTerms('A^-1', 'A').like, 'unknown');
});

test('写成 LaTeX', () => {
  assert.equal(toTex('A^2 + (1/2)AB'), 'A^{2} + \\tfrac{1}{2}AB');
});

// dr-ncalg-strict（2026-11-18 外部验收）：矩阵的式子里单独的数不当 kE、数 0 不当 O；loose 才宽
import { equivalent as eq2, whyNot, strictWhy, expandTerm as ex2, expandText as et2 } from '../kit/src/ncalg.js';
test('严：常数项少了 E、零矩阵写成了数 0', () => {
  assert.equal(eq2('(A-E)(A-2E)', 'A^2-3A+2'), false);
  assert.match(whyNot('(A-E)(A-2E)', 'A^2-3A+2'), /常数项少了 E/);
  assert.equal(eq2('(A-E)(A-2E)', 'A^2-3A+2E'), true);
  assert.equal(eq2('A-A', '0'), false);
  assert.match(whyNot('A-A', '0'), /零矩阵写成了数 0/);
  assert.equal(eq2('A-A', 'O'), true);
  assert.equal(eq2('A+0', 'A'), false);
  assert.match(strictWhy('A', '2'), /一边是矩阵、一边是数/);
  // 标量的式子照常
  assert.equal(eq2('(a+b)^2', 'a^2+2ab+b^2'), true);
  assert.equal(eq2('(kE)A', 'A(kE)'), true);
  assert.equal(whyNot('AB+BA', '2AB'), '展开、合并同类项以后两边不一样');
});
test('宽：loose 照以前的判法', () => {
  assert.equal(eq2('(A-E)(A-2E)', 'A^2-3A+2', { loose: true }), true);
  assert.equal(eq2('A-A', '0', { loose: true }), true);
  assert.equal(whyNot('A-A', '0', { loose: true }), null);
});
test('展开出来只剩数的项写成 kE', () => {
  assert.deepEqual(ex2('(A-E)(A-2E)').map((t) => t.text), ['A^2', '2A', 'A', '2E']);
  assert.equal(et2('(A-E)(A-2E)'), 'A^2 - 3A + 2E');
  assert.deepEqual(ex2('(a+b)(a-b)').map((t) => t.text), ['a^2', 'ab', 'ab', 'b^2']);
});
