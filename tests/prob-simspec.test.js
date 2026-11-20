// 视觉交互第 4 批 Task 8 的纯函数部分：抽样模拟组件的写法、读数、坐标刻度、判一个数（kit/src/prob/simspec.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSim, niceTicks, fillShow, varsOf, judgeSimAsk, chebyshev } from '../kit/src/prob/simspec.js';

const CLT = `title: 中心极限定理
draw: X ~ Exp(1)
slider n 1 60 = 5 step=1
stat: z
view: hist
curve: normpdf(x, 0, 1) label="N(0, 1)"
x: -4 4
bins: 32
seed: 7
show 模拟了 {reps} 次；这些 z 的平均 {dec(mean, 3)}、方差 {dec(var, 3)}
note: 把 n 调大再抽`;

test('写法：draw、slider、stat、view、curve（几条）、x、bins、seed、show（几条）', () => {
  const s = parseSim(CLT);
  assert.deepEqual(s.problems, []);
  assert.equal(s.fields.title, '中心极限定理');
  assert.equal(s.draw, 'X ~ Exp(1)');
  assert.deepEqual(s.sliders, [{ name: 'n', min: 1, max: 60, init: 5, step: 1, label: 'n' }]);
  assert.equal(s.stat, 'z'); assert.equal(s.view, 'hist');
  assert.deepEqual(s.curves, [{ src: 'normpdf(x, 0, 1)', label: 'N(0, 1)' }]);
  assert.deepEqual(s.x, [-4, 4]); assert.equal(s.bins, 32); assert.equal(s.seed, 7);
  assert.deepEqual(s.shows, ['模拟了 {reps} 次；这些 z 的平均 {dec(mean, 3)}、方差 {dec(var, 3)}']);
  // 默认值：view hist、stat mean、seed 1、n 30
  const d = parseSim('draw: X ~ N(0, 1)');
  assert.deepEqual([d.view, d.stat, d.seed, d.n, d.bins], ['hist', 'mean', 1, 30, 24]);
  assert.equal(parseSim('draw: X ~ N(0, 1)\nn: 12').n, 12);
});

test('写错的报出来', () => {
  const p = (src) => parseSim(src).problems.join('；');
  assert.match(p('title: 没有 draw'), /draw/);
  assert.match(p('draw: X ~ Z(1)'), /不是认得的分布/);
  assert.match(p('draw: X ~ N(0, 1)\nview: pie'), /view/);
  assert.match(p('draw: X ~ N(0, 1)\nstat: xbar +'), /统计量/);
  assert.match(p('draw: X ~ N(0, 1)\nfoo: 1'), /foo/);
  assert.match(p('draw: X ~ N(0, 1)\nslider n 5 1'), /slider/);
  assert.match(p('draw: X ~ N(0, 1)\nview: scatter'), /N2/);
  assert.match(p('draw: (X, Y) ~ N2(0.5)\nview: hist\nstat: mean'), /成对/);
  assert.match(p('draw: X ~ N(0, 1)\nn: 1\nstat: t'), /至少要 2 个/);
  assert.match(p('draw: X ~ N(0, 1)\ncurve: normpdf(x, 0'), /curve/);
  assert.match(p('draw: X ~ Exp(lam)'), /lam/, '用到了没定义的量');
  assert.deepEqual(parseSim('slider lam 0.5 3 = 1 step=0.5\ndraw: X ~ Exp(lam)').problems, []);
  assert.deepEqual(parseSim('slider rho -0.9 0.9 = 0.6 step=0.1\ndraw: (X, Y) ~ N2(rho)\nview: scatter\nn: 80').problems, []);
  assert.deepEqual(parseSim('draw: X ~ N(10, 4)\nview: intervals\nn: 8\nlevel: 0.9\nsigma: known').problems, []);
  assert.match(p('draw: X ~ N(10, 4)\nview: intervals\nlevel: 1.5'), /level/);
  assert.deepEqual(parseSim('draw: X ~ U(0, 1)\nview: path\nn: 200\nband: 0.05').problems, []);
});

test('坐标刻度：整齐的数、盖住范围、不多不少', () => {
  assert.deepEqual(niceTicks(-4, 4, 5), [-4, -2, 0, 2, 4]);
  assert.deepEqual(niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(niceTicks(0, 0.43, 4), [0, 0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(niceTicks(3, 3, 4), [3]);
  const t = niceTicks(-0.37, 12.8, 6);
  assert.ok(t.length >= 4 && t.length <= 9 && t[0] >= -0.37 && t[t.length - 1] <= 12.8);
  assert.ok(niceTicks(0, 1e-7, 4).every(Number.isFinite));
});

test('读数里能用的量：reps、mean、var、n、mu、sigma、滑块、last；{…} 填进去', () => {
  const s = parseSim(CLT);
  const v = varsOf(s, { n: 5 }, { values: [1, 2, 3, 6], last: 6 });
  assert.equal(v.reps, 4); assert.equal(v.mean, 3); assert.equal(v.var, 3.5); assert.equal(v.n, 5);
  assert.equal(v.mu, 1); assert.equal(v.sigma, 1); assert.equal(v.last, 6);
  assert.equal(fillShow('模拟了 {reps} 次；平均 {dec(mean, 2)}、方差 {var}，理论 {sigma^2/n}', v), '模拟了 4 次；平均 3、方差 3.5，理论 0.2');
  assert.equal(fillShow('$\\bar X$ 的方差 {dec(var, 2)}', v), '$\\bar X$ 的方差 3.5', '公式里的花括号不动');
  assert.equal(fillShow('{nothing + 1}', v), '?');
  // 还没抽：平均、方差写「—」
  const e = varsOf(s, { n: 5 }, { values: [] });
  assert.equal(fillShow('平均 {dec(mean, 2)}，抽了 {reps} 次', e), '平均 —，抽了 0 次');
  // 区间、路径、散点的量
  const w = varsOf(s, { n: 5 }, { values: [], miss: 3, total: 60, inband: 0.9, r: 0.58 });
  assert.equal(fillShow('{miss} / {total}，盖住的占 {dec(cover, 2)}；带子里 {inband}；r = {r}', w), '3 / 60，盖住的占 0.95；带子里 0.9；r = 0.58');
});

test('切比雪夫的界；判学生填的数（按现在滑块的值算）', () => {
  assert.equal(chebyshev(1, 100, 0.2), 0.25);
  assert.equal(chebyshev(1, 4, 0.1), 1, '界超过 1 就是 1');
  const s = parseSim(`${CLT}\nask: "按中心极限定理，$\\bar X$ 的方差是多少？" = sigma^2/n`);
  assert.deepEqual(s.problems, []);
  const a = s.asks[0];
  assert.equal(a.q, '按中心极限定理，$\\bar X$ 的方差是多少？');
  assert.equal(judgeSimAsk(a, '0.2', varsOf(s, { n: 5 }, { values: [] })).ok, true);
  assert.equal(judgeSimAsk(a, '1/5', varsOf(s, { n: 5 }, { values: [] })).ok, true);
  assert.equal(judgeSimAsk(a, '0.2', varsOf(s, { n: 10 }, { values: [] })).ok, false, '滑块变了答案跟着变');
  assert.equal(judgeSimAsk(a, '0.1', varsOf(s, { n: 10 }, { values: [] })).ok, true);
  assert.equal(judgeSimAsk(a, '', varsOf(s, { n: 5 }, { values: [] })).ok, null);
  assert.equal(judgeSimAsk(a, 'abc', varsOf(s, { n: 5 }, { values: [] })).ok, null);
  const third = parseSim('draw: X ~ U(0, 1)\nn: 4\nask: "方差" = sigma^2/n').asks[0]; // 1/48
  const vv = varsOf(parseSim('draw: X ~ U(0, 1)\nn: 4'), {}, { values: [] });
  assert.equal(judgeSimAsk(third, '1/48', vv).ok, true);
  assert.equal(judgeSimAsk(third, '0.0208', vv).ok, true);
  assert.equal(judgeSimAsk(third, '0.02', vv).ok, false);
  assert.match(parseSim('draw: X ~ N(0, 1)\nask: "方差" sigma^2/n').problems.join('；'), /ask/);
});
