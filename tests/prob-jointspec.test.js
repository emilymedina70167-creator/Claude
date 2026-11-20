// 视觉交互第 4 批 Task 6 的纯函数部分：联合分布表组件的写法、问的量、判法（kit/src/prob/jointspec.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJointBlock, probWhere, quantityOf, judgeQuantity, judgeCells } from '../kit/src/prob/jointspec.js';

const S = (x) => String(x);
const BASE = `title: 二维离散型
X: 0 1 2
Y: 0 1
p: 1/10 1/5; 1/5 3/10; 1/10 1/10`;

test('写法：X、Y、p；show、z、ask（几条）', () => {
  const b = parseJointBlock(`${BASE}\nshow: margins, moments\nz: X + Y\nask: margins\nask: "X、Y 独立吗？" independent\nask: E(X)\nask: P(X + Y <= 1)\nnote: 行是 X`);
  assert.deepEqual(b.problems, []);
  assert.equal(b.fields.title, '二维离散型');
  assert.deepEqual([...b.show].sort(), ['margins', 'moments']);
  assert.deepEqual(b.z.rows.map((r) => `${r.z}:${r.p}`), ['0:1/10', '1:2/5', '2:2/5', '3:1/10']);
  assert.deepEqual(b.asks.map((a) => a.kind), ['margins', 'independent', 'value', 'value']);
  assert.equal(b.asks[1].q, 'X、Y 独立吗？');
  assert.equal(b.asks[1].answer, false);
  assert.equal(S(b.asks[2].value), '9/10');
  assert.equal(b.asks[2].q, '$E(X)$ 是多少？');
  assert.equal(S(b.asks[3].value), '1/2');
});

test('空着的格：给了边缘 / 独立就补上，能当题（ask: cells）；补不出来报错', () => {
  const b = parseJointBlock('X: 0 1\nY: 0 1\np: 1/8 ?; ? ?\npx: 1/2 1/2\nindependent: on\nask: cells');
  assert.deepEqual(b.problems, []);
  assert.deepEqual(b.joint.p.map((r) => r.map(S)), [['1/8', '3/8'], ['1/8', '3/8']]);
  assert.deepEqual(b.asks[0].cells, [[0, 1], [1, 0], [1, 1]]);
  assert.match(parseJointBlock('X: 0 1\nY: 0 1\np: 1/8 ?; ? ?').problems.join('；'), /补不出来/);
  assert.match(parseJointBlock('X: 0 1\nY: 0 1\np: 1/2 1/4; 1/4 1/4').problems.join('；'), /加起来是 5\/4/);
  assert.match(parseJointBlock('X: 0 1\nY: 0 1\np: 1/4 1/4; 1/4 1/4\nask: cells').problems.join('；'), /没有空着的格/);
  assert.match(parseJointBlock('X: 0 1\np: 1/2 1/2').problems.join('；'), /Y/);
  assert.match(parseJointBlock(`${BASE}\nfoo: 1`).problems.join('；'), /foo/);
  assert.match(parseJointBlock(`${BASE}\nz: X +`).problems.join('；'), /z.*式子/);
  assert.match(parseJointBlock(`${BASE}\nask: E(X`).problems.join('；'), /ask/);
});

test('问的量：期望、方差、协方差、相关系数、事件的概率、条件概率', () => {
  const j = parseJointBlock(BASE).joint;
  const v = (src) => { const q = quantityOf(src, j); return q.exact ? S(q.value) : Number(q.approx.toFixed(6)); };
  assert.equal(v('E(X)'), '9/10'); assert.equal(v('EX'), '9/10'); assert.equal(v('E(Y)'), '3/5');
  assert.equal(v('E(XY)'), '1/2'); assert.equal(v('E(X^2)'), '13/10'); assert.equal(v('E(2X - Y)'), '6/5');
  assert.equal(v('D(X)'), '49/100'); assert.equal(v('DX'), '49/100'); assert.equal(v('Var(Y)'), '6/25');
  assert.equal(v('D(X + Y)'), '13/20', 'D(X + Y) = DX + DY + 2Cov');
  assert.equal(v('Cov(X, Y)'), '-1/25'); assert.equal(v('cov'), '-1/25');
  assert.equal(v('rho'), Number((-Math.sqrt(6) / 21).toFixed(6)));
  assert.equal(v('ρ'), Number((-Math.sqrt(6) / 21).toFixed(6)));
  assert.equal(v('P(X + Y <= 1)'), '1/2');
  assert.equal(v('P(X = Y)'), '2/5');
  assert.equal(v('P(X > Y)'), '2/5');
  assert.equal(v('P(X = 1 | Y = 0)'), '1/2');
  assert.equal(v('P(Y = 1 | X >= 1)'), '4/7');
  assert.equal(v('P(X = 1, Y = 1)'), '3/10');
  assert.equal(v('P(X = 2)'), '1/5');
  assert.equal(quantityOf('Cov(X, Y)', j).tex, '\\operatorname{Cov}(X, Y)');
  assert.equal(quantityOf('P(X = 1 | Y = 0)', j).tex, 'P(X = 1 \\mid Y = 0)');
  assert.throws(() => quantityOf('P(X = 1 | Y = 5)', j), /概率是 0/);
  assert.throws(() => quantityOf('Q(X)', j), /E\(X\)/);
  assert.equal(S(probWhere(j, 'X + Y >= 2')), '1/2');
});

test('判一个数：精确的按分数比；相关系数这种开不尽的认小数和式子', () => {
  const j = parseJointBlock(BASE).joint;
  const cov = quantityOf('Cov(X, Y)', j), rho = quantityOf('rho', j), ex = quantityOf('E(X)', j);
  assert.equal(judgeQuantity(cov, '-1/25').ok, true);
  assert.equal(judgeQuantity(cov, '-0.04').ok, true);
  assert.equal(judgeQuantity(cov, '1/25').ok, false);
  assert.match(judgeQuantity(cov, '1/25').text, /符号/);
  assert.equal(judgeQuantity(cov, '1/2').tag, 'exy-for-cov', '只算了 E(XY)，没减 EX·EY');
  assert.equal(judgeQuantity(rho, '-0.1166').ok, true);
  assert.equal(judgeQuantity(rho, '-sqrt(6)/21').ok, true);
  assert.equal(judgeQuantity(rho, '-0.12').ok, false);
  assert.equal(judgeQuantity(rho, '0.1166').ok, false);
  assert.equal(judgeQuantity(ex, '0.9').ok, true);
  assert.equal(judgeQuantity(ex, 'abc').ok, null);
  assert.equal(judgeQuantity(quantityOf('D(X)', j), '1.3').tag, 'ex2-for-var', '只算了 E(X²)，没减 (EX)²');
});

test('判一组格子（边缘、Z 的分布、空着的格）：逐格对，说错了几格', () => {
  const r = judgeCells(['3/10', '1/2', '1/5'].map((x) => parseJointBlock(BASE) && x), ['0.3', '1/2', '0.3']);
  assert.deepEqual(r.marks, [true, true, false]);
  assert.equal(r.ok, false);
  assert.match(r.text, /错了 1 格/);
  const all = judgeCells(['3/10', '1/2', '1/5'], ['3/10', '0.5', '20%']);
  assert.equal(all.ok, true);
  const blank = judgeCells(['3/10', '1/2'], ['3/10', '']);
  assert.equal(blank.ok, null, '没填完不判');
  assert.match(blank.text, /还有 1 格没填/);
  assert.equal(judgeCells(['3/10'], ['x']).ok, null);
});
