// 视觉交互第 4 批 Task 5：联合分布表的计算（kit/src/prob/joint.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJoint, checkJoint, completeJoint, marginals, conditional, independent, moments, distOf, expectOf } from '../kit/src/prob/joint.js';

const S = (x) => String(x);
// X 是行（0、1、2），Y 是列（0、1）
const J = () => parseJoint('0 1 2', '0 1', '1/10 1/5; 1/5 3/10; 1/10 1/10');

test('读表：行是 X、列是 Y；分号或换行分行；小数、分数、百分数', () => {
  const j = J();
  assert.deepEqual(j.xs.map(S), ['0', '1', '2']);
  assert.deepEqual(j.ys.map(S), ['0', '1']);
  assert.deepEqual(j.p.map((r) => r.map(S)), [['1/10', '1/5'], ['1/5', '3/10'], ['1/10', '1/10']]);
  assert.deepEqual(checkJoint(j), []);
  const k = parseJoint('-1 1', '0 1', '0.25 25%\n1/4 .25');
  assert.equal(S(k.xs[0]), '-1');
  assert.ok(k.p.flat().every((x) => S(x) === '1/4'));
  assert.throws(() => parseJoint('0 1 2', '0 1', '1/10 1/5; 1/5 3/10'), /3 行/);
  assert.throws(() => parseJoint('0 1', '0 1', '1/2 1/2 0; 0 0'), /2 个/);
  assert.throws(() => parseJoint('0 1', '0 1', '1/2 a; 0 0'), /读不懂/);
  assert.throws(() => parseJoint('0 0', '0 1', '1/4 1/4; 1/4 1/4'), /重了/);
});

test('检查：和不是 1、有负数', () => {
  assert.match(checkJoint(parseJoint('0 1', '0 1', '1/4 1/4; 1/4 1/8')).join('；'), /加起来是 7\/8，不是 1/);
  assert.match(checkJoint(parseJoint('0 1', '0 1', '1/2 3/4; -1/4 0')).join('；'), /负/);
});

test('边缘、条件', () => {
  const j = J(), m = marginals(j);
  assert.deepEqual(m.px.map(S), ['3/10', '1/2', '1/5']);
  assert.deepEqual(m.py.map(S), ['2/5', '3/5']);
  assert.deepEqual(conditional(j, 'Y|X', 0).map(S), ['1/3', '2/3']);
  assert.deepEqual(conditional(j, 'X|Y', 1).map(S), ['1/3', '1/2', '1/6']);
  // 条件的那个值概率是 0：没有定义
  assert.equal(conditional(parseJoint('0 1', '0 1', '0 0; 1/2 1/2'), 'Y|X', 0), null);
});

test('独立：一格一格比，说出第一格对不上的', () => {
  const no = independent(J());
  assert.equal(no.ok, false);
  assert.deepEqual(no.where, [0, 0]);
  assert.equal(S(no.product), '3/25');
  assert.equal(no.cells.length, 4, '中间那一行两格碰巧对得上，别的四格对不上');
  assert.equal(independent(parseJoint('0 1', '0 1', '1/8 3/8; 1/8 3/8')).ok, true);
});

test('矩：期望、方差、协方差是分数；相关系数开不尽写成根式', () => {
  const m = moments(J());
  assert.equal(S(m.EX), '9/10'); assert.equal(S(m.EY), '3/5'); assert.equal(S(m.EXY), '1/2');
  assert.equal(S(m.DX), '49/100'); assert.equal(S(m.DY), '6/25'); assert.equal(S(m.cov), '-1/25');
  assert.equal(S(m.rho.num), '-1/25'); assert.equal(S(m.rho.den2), '147/1250');
  assert.ok(Math.abs(m.rhoValue - (-0.04 / Math.sqrt(0.49 * 0.24))) < 1e-12);
  assert.equal(m.rhoTeX, '-\\frac{\\sqrt{6}}{21}');
  const ind = moments(parseJoint('0 1', '0 1', '1/8 3/8; 1/8 3/8'));
  assert.equal(S(ind.cov), '0'); assert.equal(S(ind.rho), '0'); assert.equal(ind.rhoValue, 0);
  const same = moments(parseJoint('0 1', '0 1', '1/2 0; 0 1/2'));
  assert.equal(S(same.rho), '1');
  const anti = moments(parseJoint('0 1', '0 1', '0 1/2; 1/2 0'));
  assert.equal(S(anti.rho), '-1');
  // 有一个是常数：相关系数没有定义
  const flat = moments(parseJoint('3', '0 1', '1/2 1/2'));
  assert.equal(flat.rho, null); assert.equal(flat.rhoValue, null);
  assert.equal(S(expectOf(J(), 'X^2 + Y')), '19/10');
});

test('Z = g(X, Y) 的分布：取值相同的格子合并', () => {
  const j = J();
  const sum = distOf(j, 'X + Y');
  assert.deepEqual(sum.rows.map((r) => `${r.z}:${r.p}`), ['0:1/10', '1:2/5', '2:2/5', '3:1/10']);
  assert.deepEqual(sum.rows[1].cells, [[0, 1], [1, 0]]);
  assert.deepEqual(sum.cellZ, [[0, 1], [1, 2], [2, 3]].map((r) => r.map((k) => k)), '每一格是第几个取值');
  assert.deepEqual(distOf(j, 'max(X, Y)').rows.map((r) => `${r.z}:${r.p}`), ['0:1/10', '1:7/10', '2:1/5']);
  assert.deepEqual(distOf(j, 'X*Y').rows.map((r) => `${r.z}:${r.p}`), ['0:3/5', '1:3/10', '2:1/10']);
  assert.deepEqual(distOf(j, 'XY').rows.map((r) => `${r.z}:${r.p}`), ['0:3/5', '1:3/10', '2:1/10'], 'XY 并排写是乘');
  assert.deepEqual(distOf(j, 'min(X,Y)').rows.map((r) => `${r.z}:${r.p}`), ['0:3/5', '1:2/5']);
  // 概率是 0 的取值不进分布表
  assert.deepEqual(distOf(parseJoint('0 1', '0 1', '1/2 0; 0 1/2'), 'X - Y').rows.map((r) => `${r.z}:${r.p}`), ['0:1']);
  assert.throws(() => distOf(j, 'X +'), /Z 的式子/);
});

test('空着的格：由「和是 1」、边缘、独立补；补不出来说是哪几格', () => {
  const one = parseJoint('0 1 2', '0 1', '1/10 ?; 1/5 3/10; 1/10 1/10');
  assert.deepEqual(one.blanks, [[0, 1]]);
  const a = completeJoint(one);
  assert.equal(a.ok, true); assert.equal(S(a.joint.p[0][1]), '1/5');
  const two = parseJoint('0 1 2', '0 1', '? ?; 1/5 3/10; 1/10 1/10');
  assert.equal(completeJoint(two).ok, false);
  assert.deepEqual(completeJoint(two).missing, [[0, 0], [0, 1]]);
  const b = completeJoint(two, { colSums: '2/5 3/5' });
  assert.equal(b.ok, true); assert.deepEqual(b.joint.p[0].map(S), ['1/10', '1/5']);
  const all = parseJoint('0 1', '0 1', '? ?; ? ?');
  const c = completeJoint(all, { rowSums: '1/2 1/2', colSums: '1/4 3/4', independent: true });
  assert.equal(c.ok, true);
  assert.deepEqual(c.joint.p.map((r) => r.map(S)), [['1/8', '3/8'], ['1/8', '3/8']]);
  // 独立 + 一行边缘 + 一格：别的由比例推出来
  const d = completeJoint(parseJoint('0 1', '0 1', '1/8 ?; ? ?'), { rowSums: '1/2 1/2', independent: true });
  assert.equal(d.ok, true);
  assert.deepEqual(d.joint.p.map((r) => r.map(S)), [['1/8', '3/8'], ['1/8', '3/8']]);
  // 给的边缘和表里的数对不上
  assert.match(completeJoint(parseJoint('0 1', '0 1', '1/2 ?; 1/4 1/4'), { rowSums: '1/4 3/4' }).why, /对不上/);
});
