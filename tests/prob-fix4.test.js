// 第 4 批留下的小毛病（2026-11-21 一次修完）：一条一个能重现的测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJoint, moments, rhoLine } from '../kit/src/prob/joint.js';
import { parseJointBlock, quantityOf, answerLine } from '../kit/src/prob/jointspec.js';

const BIG = () => parseJoint('0 1', '0 1', '0.1234 0.2345; 0.3456 0.2965');

test('ρ 的根式化不开时只写一次「≈」', () => {
  const m = moments(BIG());
  const line = rhoLine(m);
  assert.equal((line.match(/approx/g) || []).length, 1, line);
  assert.doesNotMatch(line, /=\s*-?0\.\d+\s*\\approx/, line);
  const nice = rhoLine(moments(parseJoint('0 1', '0 1', '1/8 3/8; 1/4 1/4')));
  assert.equal((nice.match(/approx/g) || []).length <= 1, true, nice);
  const q = quantityOf('rho', BIG());
  const ans = answerLine(q);
  assert.equal((ans.match(/approx/g) || []).length, 1, ans);
});

import { readQ } from '../kit/src/prob/num.js';
test('「1 1/2」是带分数 3/2，不是 11/2；全角的数字、点、斜杠、百分号照认', () => {
  assert.equal(readQ('1 1/2').toString(), '3/2');
  assert.equal(readQ('-1 1/2').toString(), '-3/2');
  assert.equal(readQ('０．２５').toString(), '1/4');
  assert.equal(readQ('１／４').toString(), '1/4');
  assert.equal(readQ('２５％').toString(), '1/4');
  assert.equal(readQ('1 2 3'), null, '中间有空格的一串数读不懂');
});

test('Cov 写了两个以外的参数报错（以前多写的第三个悄悄丢了）', () => {
  const j = parseJoint('0 1', '0 1', '1/8 3/8; 1/4 1/4');
  assert.throws(() => quantityOf('Cov(X, Y, X)', j), /两个/);
  assert.throws(() => quantityOf('Cov(X)', j), /两个|Cov\(X, Y\)/);
  assert.ok(quantityOf('Cov(X, Y)', j).exact);
});

test('表写全了也核 px、py、independent 和表对不对得上（以前只在有空格时才用它们）', () => {
  const base = 'X: 0 1\nY: 0 1\np: 1/8 3/8; 1/4 1/4';
  assert.deepEqual(parseJointBlock(base).problems, []);
  assert.deepEqual(parseJointBlock(`${base}\npx: 1/2 1/2\npy: 3/8 5/8`).problems, [], '对得上的不报');
  assert.match(parseJointBlock(`${base}\npx: 1/3 2/3`).problems.join('；'), /边缘.*对不上/);
  assert.match(parseJointBlock(`${base}\npy: 1/2 1/2`).problems.join('；'), /边缘.*对不上/);
  assert.match(parseJointBlock(`${base}\nindependent: on`).problems.join('；'), /独立/);
  assert.deepEqual(parseJointBlock('X: 0 1\nY: 0 1\np: 1/8 3/8; 1/8 3/8\nindependent: on').problems, []);
});

import { parseSim } from '../kit/src/prob/simspec.js';
import { rng } from '../kit/src/prob/sim.js';
test('sim 的边角：X1 ~、(X1, X2) ~ 认；seed 写的不是整数报出来；seed: 0 和 seed: 1 不是同一组数', () => {
  assert.deepEqual(parseSim('draw: X1 ~ N(0, 1)\nn: 10').problems, []);
  assert.deepEqual(parseSim('draw: (X1, X2) ~ N2(0.5)\nn: 10\nview: scatter').problems, []);
  assert.match(parseSim('draw: X ~ N(0, 1)\nn: 10\nseed: abc').problems.join('；'), /seed/);
  assert.match(parseSim('draw: X ~ N(0, 1)\nn: 10\nseed: 1.5').problems.join('；'), /seed/);
  const a = rng(0), b = rng(1);
  assert.notEqual(a(), b());
});

import { drawChunks, SAMPLE_BUDGET } from '../kit/src/prob/sim.js';
test('一下抽很多（n 上千 × 1000 组）分成几帧抽，一帧抽的样本数不超过预算，加起来正好是要的组数', () => {
  const c = drawChunks(1000, 5000);
  assert.equal(c.reduce((a, b) => a + b, 0), 1000);
  assert.ok(c.length > 1);
  assert.ok(c.every((k) => k * 5000 <= SAMPLE_BUDGET || k === 1));
  assert.deepEqual(drawChunks(10, 30), [10], '小的一帧抽完');
  assert.deepEqual(drawChunks(3, 10 * SAMPLE_BUDGET), [1, 1, 1], '一组就超预算的一帧一组');
});

import { condHandle } from '../kit/src/prob/tree.js';
test('面积图横的把手：条件概率很小（贴着底）也整个在方块里、44px 高；窄的列也至少 32px 宽', () => {
  const top = 20, side = 300;
  const h = condHandle(100, 120, top + side - 0.01 * side, top, side);
  assert.equal(h.height, 44);
  assert.ok(h.y >= top && h.y + h.height <= top + side, JSON.stringify(h));
  assert.ok(h.y <= top + side - 0.01 * side && top + side - 0.01 * side <= h.y + h.height, '分界线在能抓的地方里');
  const n = condHandle(100, 6, top + side / 2, top, side);
  assert.ok(n.width >= 32);
  assert.ok(Math.abs(n.x + n.width / 2 - 103) < 1e-9, '窄的列把手居中');
});
