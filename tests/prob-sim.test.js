// 视觉交互第 4 批 Task 7：带种子的抽样、统计量、直方图、置信区间（kit/src/prob/sim.js，纯函数）
import test from 'node:test';
import assert from 'node:assert/strict';
import { rng, parseDist, sampler, theory, statOf, simulate, histogram, runningMean, interval, STATS } from '../kit/src/prob/sim.js';

const meanOf = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const varOf = (a) => { const m = meanOf(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length; };

test('同一个种子两次一样，换个种子不一样', () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const xs = Array.from({ length: 5 }, () => a()), ys = Array.from({ length: 5 }, () => b()), zs = Array.from({ length: 5 }, () => c());
  assert.deepEqual(xs, ys);
  assert.notDeepEqual(xs, zs);
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const s1 = simulate({ dist: 'Exp(1)', n: 5, stat: 'mean', reps: 50, seed: 3 });
  const s2 = simulate({ dist: 'Exp(1)', n: 5, stat: 'mean', reps: 50, seed: 3 });
  assert.deepEqual([...s1], [...s2]);
});

test('分布的写法照教材：N(μ, σ²)、Exp(λ)、Geo(p) 从 1 数；读不懂的说有哪些', () => {
  assert.deepEqual(theory('N(1, 4)'), { mean: 1, var: 4 });
  assert.deepEqual(theory('U(0, 6)'), { mean: 3, var: 3 });
  assert.deepEqual(theory('Exp(2)'), { mean: 0.5, var: 0.25 });
  assert.deepEqual(theory('B(10, 0.3)'), { mean: 3, var: 10 * 0.3 * 0.7 });
  assert.deepEqual(theory('P(2.5)'), { mean: 2.5, var: 2.5 });
  assert.deepEqual(theory('Geo(0.25)'), { mean: 4, var: 12 });
  assert.deepEqual(theory('chi2(3)'), { mean: 3, var: 6 });
  assert.deepEqual(theory('χ²(3)'), { mean: 3, var: 6 });
  assert.deepEqual(theory('t(5)'), { mean: 0, var: 5 / 3 });
  assert.equal(theory('t(2)').var, Infinity);
  const d = theory('{0: 0.5, 1: 0.3, 4: 0.2}');
  assert.ok(Math.abs(d.mean - 1.1) < 1e-12 && Math.abs(d.var - (0.3 + 3.2 - 1.21)) < 1e-12);
  assert.equal(parseDist('X ~ N(0, 1)').kind, 'N');
  assert.equal(parseDist('(X, Y) ~ N2(0.6)').pair, true);
  assert.throws(() => parseDist('Z(1)'), /N\(μ, σ²\)/);
  assert.throws(() => parseDist('N(0, -1)'), /方差要是正数/);
  assert.throws(() => parseDist('B(10, 1.3)'), /0 到 1/);
  assert.throws(() => parseDist('{0: 0.5, 1: 0.3}'), /加起来/);
  assert.throws(() => parseDist('N2(1.2)'), /相关系数/);
});

test('每种分布 5 万个样本：均值、方差和理论值差不过 4 个标准误', () => {
  for (const src of ['N(1, 4)', 'U(-1, 3)', 'Exp(2)', 'B(12, 0.3)', 'P(3.5)', 'P(40)', 'Geo(0.25)', 'chi2(4)', 't(9)', '{0: 0.5, 1: 0.3, 4: 0.2}']) {
    const draw = sampler(src), r = rng(11), N = 50000;
    const xs = Float64Array.from({ length: N }, () => draw(r));
    const th = theory(src);
    const se = Math.sqrt(th.var / N);
    assert.ok(Math.abs(meanOf(xs) - th.mean) < 4 * se, `${src} 的均值 ${meanOf(xs)} 对 ${th.mean}`);
    assert.ok(Math.abs(varOf(xs) - th.var) < 0.06 * th.var + 0.01, `${src} 的方差 ${varOf(xs)} 对 ${th.var}`);
  }
  // 离散的只取到写了的值；二项、几何的范围
  const d = sampler('{0: 0.5, 1: 0.3, 4: 0.2}'), r = rng(2);
  assert.ok(Array.from({ length: 200 }, () => d(r)).every((x) => [0, 1, 4].includes(x)));
  const g = sampler('Geo(0.25)');
  assert.ok(Array.from({ length: 200 }, () => g(r)).every((x) => Number.isInteger(x) && x >= 1));
});

test('二维正态：一次回一对，样本相关系数接近 ρ', () => {
  const draw = sampler('N2(0.6)'), r = rng(5);
  const pts = Array.from({ length: 20000 }, () => draw(r));
  assert.equal(pts[0].length, 2);
  const rr = STATS.r.run(pts);
  assert.ok(Math.abs(rr - 0.6) < 0.02, `r = ${rr}`);
  assert.ok(Math.abs(STATS.r.run([[1, 2], [2, 4], [3, 6]]) - 1) < 1e-12);
});

test('统计量：S² 无偏、除以 n 的偏小；z、t、χ² 的抽样分布', () => {
  const run = (stat, n = 5, dist = 'N(2, 9)') => simulate({ dist, n, stat, reps: 20000, seed: 21 });
  assert.ok(Math.abs(meanOf(run('S2')) - 9) < 0.2);
  assert.ok(Math.abs(meanOf(run('var')) - 9 * 4 / 5) < 0.2);
  assert.ok(Math.abs(meanOf(run('mean')) - 2) < 0.05);
  assert.ok(Math.abs(varOf(run('mean')) - 9 / 5) < 0.08);
  assert.ok(Math.abs(meanOf(run('sum')) - 10) < 0.2);
  const z = run('z');
  assert.ok(Math.abs(meanOf(z)) < 0.03 && Math.abs(varOf(z) - 1) < 0.04);
  const chi = run('chi');
  assert.ok(Math.abs(meanOf(chi) - 4) < 0.08 && Math.abs(varOf(chi) - 8) < 0.5, 'χ²(n − 1)');
  const t = run('t', 6);
  assert.ok(Math.abs(varOf(t) - 5 / 3) < 0.15, 't(5) 的方差是 5/3');
  const mx = run('max', 3, 'U(0, 1)');
  assert.ok(Math.abs(meanOf(mx) - 3 / 4) < 0.01, 'max 的期望 n/(n + 1)');
  assert.ok(Math.abs(meanOf(run('min', 3, 'U(0, 1)')) - 1 / 4) < 0.01);
  assert.equal(statOf('median').run([3, 1, 2]), 2);
  assert.equal(statOf('median').run([4, 1, 2, 3]), 2.5);
  assert.equal(statOf('S').run([1, 2, 3]), 1);
  // 自己写的式子：xbar、S、S2、var、n、mu、sigma、total、max、min
  const own = statOf('n*var/sigma^2', { mu: 2, sigma: 3 });
  assert.ok(Math.abs(own.run([1, 2, 6]) - (14 / 9)) < 1e-12);
  assert.throws(() => statOf('xbar +'), /统计量/);
  assert.throws(() => simulate({ dist: 'N(0, 1)', n: 1, stat: 't', reps: 1, seed: 1 }), /至少要 2 个/);
});

test('直方图：面积是 1；范围外面的不丢总数；离散的按取值数', () => {
  const vals = simulate({ dist: 'N(0, 1)', n: 1, stat: 'mean', reps: 4000, seed: 9 });
  const h = histogram(vals, { bins: 24, range: [-6, 6] });
  assert.equal(h.density.length, 24);
  const area = h.density.reduce((s, d, i) => s + d * (h.edges[i + 1] - h.edges[i]), 0);
  assert.ok(Math.abs(area - 1) < 1e-12);
  const cut = histogram(vals, { bins: 10, range: [0, 6] });
  const half = cut.density.reduce((s, d, i) => s + d * (cut.edges[i + 1] - cut.edges[i]), 0);
  assert.ok(Math.abs(half - 0.5) < 0.03 && cut.outside > 1500, '只画右半边：面积约一半');
  const disc = histogram([0, 1, 1, 2, 2, 2], { discrete: true });
  assert.deepEqual(disc.values, [0, 1, 2]);
  assert.deepEqual(disc.freq, [1 / 6, 2 / 6, 3 / 6]);
  assert.deepEqual(histogram([], { bins: 4, range: [0, 1] }).density, [0, 0, 0, 0]);
  // 没给范围：按数据定，最大值落在最后一格里
  const auto = histogram([1, 2, 3, 4], { bins: 3 });
  assert.equal(auto.counts.reduce((s, x) => s + x, 0), 4);
});

test('样本均值的路径；置信区间的覆盖率', () => {
  assert.deepEqual([...runningMean([2, 4, 6])], [2, 3, 4]);
  const draw = sampler('N(10, 4)'), r = rng(31);
  let coverZ = 0, coverT = 0;
  for (let k = 0; k < 1000; k++) {
    const xs = Array.from({ length: 8 }, () => draw(r));
    const [a, b] = interval({ xs, level: 0.95, sigma: 2 });
    if (a <= 10 && 10 <= b) coverZ++;
    const [c, d] = interval({ xs, level: 0.95 });
    if (c <= 10 && 10 <= d) coverT++;
  }
  assert.ok(coverZ >= 930 && coverZ <= 970, `σ 已知：盖住 ${coverZ}`);
  assert.ok(coverT >= 930 && coverT <= 970, `σ 未知：盖住 ${coverT}`);
  const [lo, hi] = interval({ xs: [1, 2, 3, 4, 5], level: 0.95, sigma: 1 });
  assert.ok(Math.abs((hi - lo) / 2 - 1.959964 / Math.sqrt(5)) < 1e-4);
  const [lo2, hi2] = interval({ xs: [1, 2, 3, 4, 5], level: 0.95 });
  assert.ok(Math.abs((hi2 - lo2) / 2 - 2.776445 * Math.sqrt(2.5 / 5)) < 1e-3, 't(4) 的 0.975 分位点 2.7764');
});
