// 视觉交互第 4 批 Task 1：事件的代数（kit/src/prob/sets.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, solveAtoms, probOf, condOf, sameEvent, atomsOf, parseGiven } from '../kit/src/prob/sets.js';

const AB = ['A', 'B'], ABC = ['A', 'B', 'C'];
// 原子的编号：第 i 位是 1 表示第 i 个事件发生。两个事件：0 都不发生、1 只 A、2 只 B、3 都发生
const at = (src, names) => atomsOf(parseEvent(src, names).mask);
const fr = (x) => String(x);

test('两个事件：并、交、差、对立，各种写法', () => {
  assert.deepEqual(at('A', AB), [1, 3]);
  assert.deepEqual(at('A ∪ B', AB), [1, 2, 3]);
  assert.deepEqual(at('A + B', AB), [1, 2, 3]);
  assert.deepEqual(at('A ∩ B', AB), [3]);
  assert.deepEqual(at('AB', AB), [3]);
  assert.deepEqual(at('A*B', AB), [3]);
  assert.deepEqual(at('A - B', AB), [1]);
  assert.deepEqual(at('A \\ B', AB), [1]);
  assert.deepEqual(at('~A', AB), [0, 2]);
  assert.deepEqual(at("A'", AB), [0, 2]);
  assert.deepEqual(at('Ā', AB), [0, 2]);
  assert.deepEqual(at('!A', AB), [0, 2]);
  assert.deepEqual(at('\\overline{A}', AB), [0, 2]);
  assert.deepEqual(at('\\bar A', AB), [0, 2]);
  assert.deepEqual(at("A'B'", AB), [0]);
  assert.deepEqual(at('~(A + B)', AB), [0]);
  assert.deepEqual(at('\\overline{A \\cup B}', AB), [0]);
  assert.deepEqual(at('Ω', AB), [0, 1, 2, 3]);
  assert.deepEqual(at('∅', AB), []);
  assert.deepEqual(at('A - B ∪ B', AB), [1, 2, 3], '并和差同级，从左往右');
  assert.deepEqual(at('A ∪ B C', ['A', 'B', 'C']), [1, 3, 5, 6, 7], '交比并先算');
});

test('三个事件：8 块逐个对；德摩根；分配律', () => {
  assert.deepEqual(at('ABC', ABC), [7]);
  assert.deepEqual(at("A B' C'", ABC), [1]);
  assert.deepEqual(at("A'B'C'", ABC), [0]);
  assert.deepEqual(at('A ∪ B ∪ C', ABC), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(at('(A ∪ B) C', ABC), [5, 6, 7]);
  assert.deepEqual(at("AB ∪ C'", ABC), [0, 1, 2, 3, 7]);
  assert.ok(sameEvent(parseEvent('~(A ∪ B)', ABC), parseEvent("A'B'", ABC)));
  assert.ok(sameEvent(parseEvent('~(AB)', ABC), parseEvent("A' ∪ B'", ABC)));
  assert.ok(sameEvent(parseEvent('A(B ∪ C)', ABC), parseEvent('AB ∪ AC', ABC)));
  assert.ok(!sameEvent(parseEvent('A ∪ BC', ABC), parseEvent('(A ∪ B)C', ABC)));
  // 恰好一个发生、至少两个发生
  assert.deepEqual(at("AB'C' ∪ A'BC' ∪ A'B'C", ABC), [1, 2, 4]);
  assert.deepEqual(at('AB ∪ BC ∪ AC', ABC), [3, 5, 6, 7]);
});

test('读不懂的说哪里、怎么写；写成公式', () => {
  assert.throws(() => parseEvent('A ∪', AB), /事件的式子/);
  assert.throws(() => parseEvent('A ∪ D', AB), /没有叫 D 的事件/);
  assert.throws(() => parseEvent('(A ∪ B', AB), /括号/);
  assert.throws(() => parseEvent('', AB), /事件的式子/);
  assert.equal(parseEvent('~(A + B)', AB).tex, '\\overline{A \\cup B}');
  assert.equal(parseEvent("A'B", AB).tex, '\\overline{A}B');
  assert.equal(parseEvent('A - B', AB).tex, 'A - B');
  assert.equal(parseEvent('(A ∪ B)C', ABC).tex, '(A \\cup B)C');
});

test('由给的概率解每一块：正好够', () => {
  const g = parseGiven('P(A) = 0.5, P(B) = 2/5, P(AB) = 0.2', AB);
  const s = solveAtoms(g, 2);
  assert.equal(s.status, 'unique');
  assert.deepEqual(s.p.map(fr), ['3/10', '3/10', '1/5', '1/5']);
  assert.equal(fr(probOf(parseEvent('A ∪ B', AB).mask, g, 2).value), '7/10');
  assert.equal(fr(probOf(parseEvent("A'B'", AB).mask, g, 2).value), '3/10');
  assert.equal(fr(condOf(parseEvent('A', AB).mask, parseEvent('B', AB).mask, g, 2).value), '1/2');
  assert.equal(fr(condOf(parseEvent('B', AB).mask, parseEvent('A ∪ B', AB).mask, g, 2).value), '4/7');
});

test('条件不够：定得下来的照算，定不下来的说范围，不猜独立', () => {
  const g = parseGiven('P(A) = 0.5, P(B) = 0.4', AB);
  assert.equal(solveAtoms(g, 2).status, 'under');
  const a = probOf(parseEvent('A', AB).mask, g, 2);
  assert.equal(a.status, 'ok'); assert.equal(fr(a.value), '1/2');
  const u = probOf(parseEvent('A ∪ B', AB).mask, g, 2);
  assert.equal(u.status, 'under'); assert.equal(fr(u.min), '1/2'); assert.equal(fr(u.max), '9/10');
  const i = probOf(parseEvent('AB', AB).mask, g, 2);
  assert.equal(i.status, 'under'); assert.equal(fr(i.min), '0'); assert.equal(fr(i.max), '2/5');
  assert.equal(condOf(parseEvent('A', AB).mask, parseEvent('B', AB).mask, g, 2).status, 'under');
  // 用上「大于等于 0」才定得下来的：P(A) = 0 时 P(AB) 一定是 0
  const z = parseGiven('P(A) = 0, P(B) = 0.3', AB);
  assert.equal(fr(probOf(parseEvent('AB', AB).mask, z, 2).value), '0');
  // 给的条件能写式子：P(A ∪ B)、P(A − B)
  const h = parseGiven('P(A ∪ B) = 0.7, P(A - B) = 0.3, P(A) = 0.5', AB);
  assert.equal(fr(probOf(parseEvent('B', AB).mask, h, 2).value), '2/5');
  assert.equal(fr(probOf(parseEvent('AB', AB).mask, h, 2).value), '1/5');
  // 三条里有一条是多余的（A ∪ B = (A − B) ∪ B）：P(AB) 还是定不下来
  const red = parseGiven('P(A ∪ B) = 0.7, P(A - B) = 0.3, P(B) = 0.4', AB);
  assert.equal(probOf(parseEvent('AB', AB).mask, red, 2).status, 'under');
  // 多给了一条但不矛盾：照算；条件概率当条件给
  const more = parseGiven('P(A) = 0.5, P(B) = 0.4, P(AB) = 0.2, P(A ∪ B) = 0.7', AB);
  assert.equal(solveAtoms(more, 2).status, 'unique');
  const c = parseGiven('P(A) = 0.5, P(B | A) = 40%, P(B) = 0.4', AB);
  assert.equal(fr(probOf(parseEvent('AB', AB).mask, c, 2).value), '1/5');
  assert.equal(fr(condOf(parseEvent('A', AB).mask, parseEvent('B', AB).mask, c, 2).value), '1/2');
});

test('给的条件自相矛盾；条件概率的分母是 0', () => {
  const bad = parseGiven('P(A) = 0.5, P(B) = 0.4, P(AB) = 0.6', AB);
  assert.equal(solveAtoms(bad, 2).status, 'conflict');
  assert.equal(probOf(parseEvent('A', AB).mask, bad, 2).status, 'conflict');
  assert.equal(solveAtoms(parseGiven('P(A) = 1.2', AB), 2).status, 'conflict');
  const g = parseGiven('P(A) = 0.5, P(B) = 0, P(AB) = 0', AB);
  assert.equal(condOf(parseEvent('A', AB).mask, parseEvent('B', AB).mask, g, 2).status, 'undefined');
  assert.throws(() => parseGiven('P(A) = x', AB), /概率要是一个数/);
  assert.throws(() => parseGiven('A = 0.5', AB), /given 的写法/);
});

test('三个事件：给七个量正好够', () => {
  const g = parseGiven('P(A) = 1/2, P(B) = 1/2, P(C) = 1/2, P(AB) = 1/4, P(AC) = 1/4, P(BC) = 1/4, P(ABC) = 1/8', ABC);
  const s = solveAtoms(g, 3);
  assert.equal(s.status, 'unique');
  assert.ok(s.p.every((x) => fr(x) === '1/8'));
  assert.equal(fr(probOf(parseEvent('A ∪ B ∪ C', ABC).mask, g, 3).value), '7/8');
});
