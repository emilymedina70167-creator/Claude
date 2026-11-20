// 视觉交互第 1 批 Task 1：概率的特殊函数（Γ、B，χ² / t / F 的密度、分布函数、分位点，几何、超几何）
import test from 'node:test';
import assert from 'node:assert/strict';
import { gamma, lgamma, beta, gammaP, betaI, DIST } from '../kit/src/fx/special.js';
import { numIntegral } from '../kit/src/fx/integral.js';
import { evaluate } from '../kit/src/expr.js';
import { calcValue } from '../kit/src/exact.js';

const near = (a, b, e = 5e-4) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}（容差 ${e}）`);
const { chi2pdf, chi2cdf, chi2inv, tpdf, tcdf, tinv, fpdf, fcdf, finv, norminv, binomcdf, poissoncdf, geompmf, hyperpmf, expcdf, unifcdf } = DIST;

test('Γ 和 B', () => {
  near(gamma(5), 24, 1e-9);
  near(gamma(0.5), Math.sqrt(Math.PI), 1e-10);
  near(gamma(1), 1, 1e-12);
  near(beta(2, 3), 1 / 12, 1e-12);
  near(lgamma(10), Math.log(362880), 1e-9);
  near(gammaP(1, 2), 1 - Math.exp(-2), 1e-10);
  near(betaI(0.5, 1, 1), 0.5, 1e-12);
});

test('教材附表的分位点', () => {
  near(chi2inv(0.95, 10), 18.307);
  near(chi2inv(0.05, 10), 3.940);
  near(tinv(0.975, 10), 2.2281);
  near(finv(0.95, 3, 10), 3.708);
  near(norminv(0.975), 1.95996, 1e-5);
  near(norminv(0.95), 1.64485, 1e-5);
  near(norminv(0.975, 10, 2), 10 + 2 * 1.95996, 1e-4);
});

test('分布函数和分位点互逆', () => {
  for (const n of [1, 2, 3, 7, 30]) for (const p of [0.01, 0.5, 0.99]) {
    near(chi2cdf(chi2inv(p, n), n), p, 1e-8);
    near(tcdf(tinv(p, n), n), p, 1e-8);
    near(fcdf(finv(p, 3, n), 3, n), p, 1e-8);
  }
});

test('密度积分是 1', () => {
  const tot = (f, a, b) => numIntegral(f, a, b).value;
  assert.ok(tot((x) => chi2pdf(x, 3), 0, 60) >= 0.995);
  assert.ok(tot((x) => tpdf(x, 2), -200, 200) >= 0.995);
  assert.ok(tot((x) => fpdf(x, 4, 6), 0, 400) >= 0.995);
});

test('t 分布的几个精确值', () => {
  for (const n of [1, 4, 25]) assert.equal(tcdf(0, n), 0.5);
  near(tpdf(1.3, 1), 1 / (Math.PI * (1 + 1.69)), 1e-12);
  assert.equal(tinv(0.5, 7), 0);
});

test('离散分布', () => {
  const b = (k) => evaluate(`binompmf(${k}, 10, 0.3)`);
  near(binomcdf(3, 10, 0.3), b(0) + b(1) + b(2) + b(3), 1e-12);
  assert.equal(binomcdf(-1, 10, 0.3), 0);
  near(binomcdf(10, 10, 0.3), 1, 1e-12);
  near(poissoncdf(2, 2), 5 * Math.exp(-2), 1e-12);
  near(geompmf(3, 0.5), 0.125, 1e-12);
  assert.equal(geompmf(0, 0.5), 0);
  near(hyperpmf(1, 10, 3, 4), (3 * 35) / 210, 1e-12);
  assert.equal(hyperpmf(4, 10, 3, 4), 0);
  near(expcdf(1, 2), 1 - Math.exp(-2), 1e-12);
  assert.equal(expcdf(-1, 2), 0);
  near(unifcdf(0.3), 0.3, 1e-12);
  assert.equal(unifcdf(5, 0, 2), 1);
});

test('边界：不回 NaN', () => {
  assert.equal(chi2inv(0, 5), 0);
  assert.equal(chi2inv(1, 5), Infinity);
  assert.equal(norminv(0), -Infinity);
  assert.equal(norminv(1), Infinity);
  assert.equal(norminv(0.5), 0);
  assert.equal(tinv(1, 3), Infinity);
  assert.equal(finv(0, 2, 3), 0);
  assert.equal(chi2pdf(-1, 3), 0);
  assert.equal(chi2cdf(-1, 3), 0);
  assert.equal(fpdf(-1, 2, 3), 0);
  assert.throws(() => chi2pdf(1, 0), /自由度要是正数/);
  assert.throws(() => tinv(0.5, -1), /自由度要是正数/);
  assert.throws(() => norminv(1.2), /概率要在 0 和 1 之间/);
  assert.throws(() => chi2inv(-0.1, 3), /概率要在 0 和 1 之间/);
});

test('表达式里能用', () => {
  near(evaluate('chi2inv(0.95, 10)'), 18.307);
  near(evaluate('1 - tcdf(2.2281, 10)'), 0.025, 1e-5);
  near(evaluate('gamma(5) + beta(2, 3)'), 24 + 1 / 12, 1e-9);
  near(calcValue('tinv(0.975, 10)').float, 2.2281);
});

test('二维正态的密度', () => {
  const { binormpdf } = DIST;
  near(binormpdf(0, 0), 1 / (2 * Math.PI), 1e-12);
  near(binormpdf(1, 2, 1, 2, 2, 3, 0), 1 / (2 * Math.PI * 6), 1e-12);
  near(binormpdf(0.3, -0.2, 0, 0, 1, 1, 0.6), Math.exp(-(0.09 + 0.072 + 0.04) / (2 * 0.64)) / (2 * Math.PI * 0.8), 1e-12);
  assert.throws(() => binormpdf(0, 0, 0, 0, 1, 1, 1), /相关系数/);
  assert.throws(() => binormpdf(0, 0, 0, 0, 0, 1, 0), /标准差要是正数/);
});
