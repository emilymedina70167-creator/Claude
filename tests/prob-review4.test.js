// 视觉交互第 4 批（概率的四个组件）独立复查查出来的问题：一条一个能重现的测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEvent, parseGiven, condOf, probOf } from '../kit/src/prob/sets.js';
import { parseVenn } from '../kit/src/prob/vennspec.js';
import { parsePtree, termOf, valueOf, judgeTreeProb, blankOf } from '../kit/src/prob/treespec.js';
import { readQ, judgeNumber } from '../kit/src/prob/num.js';
import { parseJoint, distOf } from '../kit/src/prob/joint.js';
import { parseJointBlock, quantityOf, judgeQuantity, judgeCells } from '../kit/src/prob/jointspec.js';
import { parseSim, judgeSimAsk, theoryVars, guessRange } from '../kit/src/prob/simspec.js';

const S = (x) => String(x);
const ABC = ['A', 'B', 'C'];
const FACTORY = 'A1 0.5: B 0.02\nA2 0.3: B 0.01\nA3 0.2: B 0.03';

test('C1 并的右边是差：显示的式子要带括号，照显示的再读一遍是同一块', () => {
  const e = parseEvent('A ∪ (B - C)', ABC);
  assert.equal(e.tex, 'A \\cup (B - C)');
  assert.deepEqual(e.atoms, [1, 2, 3, 5, 7]);
  assert.equal(parseEvent('A ∪ B - C', ABC).tex, 'A \\cup B - C', '从左往右的那种不用括号');
  // 一批式子：显示出来的再读回去，区域不变
  const back = (t) => t.replace(/\\Omega(\{\})?/g, 'Ω').replace(/\\cup/g, '∪').replace(/\\overline\{/g, '~(').replace(/\}/g, ')').replace(/\\varnothing/g, '∅');
  for (const src of ['A ∪ (B - C)', 'A - (B ∪ C)', '(A - B) ∪ C', 'A(B ∪ C)', '~(A ∪ B)C', 'A - (B - C)', 'A ∪ ~(B - C)', '(A ∪ B)(B - C)', 'A ∪ (B - C) ∪ C', 'A - B - C', 'Ω - A', 'A ∪ ∅']) {
    const a = parseEvent(src, ABC), b = parseEvent(back(a.tex), ABC);
    assert.equal(b.mask, a.mask, `${src} 显示成 ${a.tex}`);
  }
});

test('C2 概率树：并（+、∪）两边有结果时照并算；带括号、对立整个括起来的也认', () => {
  const t = parsePtree(FACTORY).tree;
  const v = (src) => S(valueOf(termOf(src, t), t).value);
  assert.equal(v('P(A1 + B)'), '509/1000');
  assert.equal(v('P(A1 B ∪ A2 ~B)'), '307/1000');
  assert.equal(v('P(A1 + A2 B)'), '503/1000');
  assert.equal(v('P(~(A1 + A2))'), '1/5');
  assert.equal(v('P(~(A1 + A2) | B)'), '6/19');
  assert.equal(v('P(B | A1 + A2)'), '13/800');
  assert.equal(v('P(A_1 | B)'), '10/19', '页面自己显示的 A₁ 的写法也认');
  assert.equal(v('P(\\bar{B} | A2)'), '99/100');
  // 原来就对的不许坏
  assert.equal(v('P(A1 + A2 | B)'), '13/19'); assert.equal(v('P(A2 B)'), '3/1000'); assert.equal(v('P(~B)'), '981/1000');
  assert.equal(termOf('P(A1 + B)', t).tex, 'P(A_{1} \\cup B)');
  assert.equal(termOf('P(A1 | B)', t).tex, 'P(A_{1} \\mid B)');
  assert.equal(termOf('P(~B | A2)', t).tex, 'P(\\overline{B} \\mid A_{2})');
  // 认错法、能空的地方照旧
  assert.equal(judgeTreeProb(termOf('P(A1 | B)', t), t, '0.02').tag, 'cond-reversed');
  assert.equal(judgeTreeProb(termOf('P(B)', t), t, '0.06').tag, 'sum-cond');
  assert.equal(blankOf('A2:~B', t).where, 'edge:1:not'); assert.equal(blankOf('A1 B', t).where, 'leaf:0:yes'); assert.equal(blankOf('A3', t).where, 'prior:2');
  assert.throws(() => termOf('P(A1 +)', t), /读不懂|没写完/);
});

test('C3 判一个数：四舍五入的百分数、带 Unicode 减号的小数都按小数的规矩认；截断的说一句', () => {
  const v = readQ('10/19');
  assert.equal(judgeNumber(v, '52.6%').ok, true);
  assert.equal(judgeNumber(v, '52.63%').ok, true);
  assert.equal(judgeNumber(v, '0.526').ok, true);
  assert.equal(judgeNumber(v, '53%').ok, false);
  assert.match(judgeNumber(v, '53%').text, /位数不够/);
  assert.equal(judgeNumber(v, '52.7%').ok, false);
  assert.equal(judgeNumber(readQ('2/3'), '66.7%').ok, true);
  assert.equal(judgeNumber(readQ('-1/3'), '−0.333').ok, true);
  assert.equal(judgeNumber(readQ('1/5'), '20%').ok, true);
  const cut = judgeNumber(readQ('2/3'), '0.666');
  assert.equal(cut.ok, false); assert.match(cut.text, /四舍五入/);
  assert.equal(judgeNumber(readQ('2/3'), '0.667').ok, true);
  // 抽样的题同一条规矩
  assert.equal(judgeSimAsk({ expr: 'sigma/sqrt(n)' }, '89.4%', { sigma: 2, n: 5 }).ok, true);
  assert.equal(judgeSimAsk({ expr: 'sigma/sqrt(n)' }, '0.894', { sigma: 2, n: 5 }).ok, true);
  assert.equal(judgeSimAsk({ expr: 'sigma/sqrt(n)' }, '0.89', { sigma: 2, n: 5 }).ok, false);
});

test('C4 抽样的题只能按理论值判：ask 里写了模拟出来的量、滑块撞了页面的名字，报写法错误', () => {
  const p = (src) => parseSim(src).problems.join('；');
  assert.match(p('draw: X ~ N(5, 4)\nn: 9\nask: "样本均值的方差" = var'), /ask.*var.*模拟出来的量/);
  assert.match(p('draw: X ~ N(5, 4)\nask: "盖住的比例" = cover'), /模拟出来的量/);
  assert.match(p('slider r -0.9 0.9 = 0.5\ndraw: (X, Y) ~ N2(r)\nview: scatter\nn: 50'), /滑块.*r.*换个名字/);
  assert.match(p('slider mean 0 1 = 0.5\ndraw: X ~ N(mean, 1)'), /滑块.*mean/);
  assert.deepEqual(parseSim('slider rho -0.9 0.9 = 0.5\ndraw: (X, Y) ~ N2(rho)\nview: scatter\nn: 50\nask: "协方差" = rho').problems, []);
  // 判的时候给的量里没有模拟的那些
  const s = parseSim('draw: X ~ N(5, 4)\nn: 9\nask: "样本均值的方差" = sigma^2/n');
  const tv = theoryVars(s, {});
  assert.deepEqual(Object.keys(tv).sort(), ['band', 'level', 'mu', 'n', 'sigma']);
  assert.equal(judgeSimAsk(s.asks[0], '4/9', tv).ok, true);
});

test('I4 Z 的式子有开方：不靠类的名字认「算不出精确值」（压缩以后名字没了）', () => {
  const j = parseJoint('1 2 4', '1 4', '1/6 1/6; 1/6 1/6; 1/6 1/6');
  const d = distOf(j, 'sqrt(X*Y)');
  assert.deepEqual(d.rows.map((r) => Number(Number(r.z).toFixed(3))), [1, 1.414, 2, 2.828, 4]);
  assert.doesNotMatch(readFileSync('kit/src/prob/joint.js', 'utf8'), /constructor\??\.name|\.name\s*[!=]==\s*'Inexact'/);
});

test('I5 I6 相关系数开不尽：差得远的不说「位数不够」；协方差认得出；符号反了说得出；带括号的根式读得懂', () => {
  const j = parseJointBlock('X: 0 1 2\nY: 0 1\np: 1/10 1/5; 1/5 3/10; 1/10 1/10').joint;
  const rho = quantityOf('rho', j); // −√6/21 ≈ −0.11664
  assert.equal(judgeQuantity(rho, '0.9').text, '不对。');
  assert.equal(judgeQuantity(rho, '-0.04').tag, 'cov-for-rho');
  assert.equal(judgeQuantity(rho, '-0.12').tag, 'short');
  assert.equal(judgeQuantity(rho, '0.117').tag, 'sign');
  assert.equal(judgeQuantity(rho, '0.1166').tag, 'sign');
  for (const s of ['-sqrt(6)/21', '-√6/21', '-(√6)/21', '(-√6)/21', '-√(6)/21', '-√(2/147)', '-1/√(73.5)', '-2√6/42']) assert.equal(judgeQuantity(rho, s).ok, true, s);
  assert.equal(judgeQuantity(rho, '√6/21').tag, 'sign');
  assert.equal(judgeQuantity(rho, '√(6/21').ok, null);
});

test('I7 venn：字母 U 夹在两个事件中间是并；0、Ω 贴着名字不拼成读不懂的公式', () => {
  const AB = ['A', 'B'];
  assert.deepEqual(parseEvent('A U B', AB).atoms, [1, 2, 3]);
  assert.equal(parseEvent('A U B', AB).tex, 'A \\cup B');
  assert.throws(() => parseEvent('A0', AB), /读不懂|空集/);
  assert.equal(parseEvent('ΩA', AB).tex, '\\Omega{}A');
  assert.deepEqual(parseEvent('S - A', AB).atoms, [0, 2]);
  assert.deepEqual(parseEvent('A\\B', AB).atoms, [1], '差写成 \\ 不带空格');
  assert.deepEqual(parseEvent('\\overline{A}\\,\\overline{B}', AB).atoms, [0]);
});

test('I8 条件概率当条件给的时候：比值处处一样就是定得下来', () => {
  const AB = ['A', 'B'];
  const g = parseGiven('P(B | A) = 0.4, P(A | B) = 0.5', AB);
  const a = parseEvent('A', AB).mask, b = parseEvent('B', AB).mask, u = parseEvent('A + B', AB).mask;
  assert.deepEqual([condOf(b, a, g, 2).status, S(condOf(b, a, g, 2).value)], ['ok', '2/5']);
  assert.deepEqual([condOf(a, u, g, 2).status, S(condOf(a, u, g, 2).value)], ['ok', '5/7']);
  assert.equal(probOf(a, g, 2).status, 'under', 'P(A) 本身还是定不下来');
  assert.deepEqual(parseVenn('sets: A B\ngiven: P(B | A) = 0.4, P(A | B) = 0.5\nask: P(A | A + B)').problems, []);
  // 真的定不下来的还是 under；条件的概率一定是 0 的还是没有定义
  assert.equal(condOf(a, b, parseGiven('P(A) = 0.5, P(B) = 0.4', AB), 2).status, 'under');
  assert.equal(condOf(a, b, parseGiven('P(B) = 0', AB), 2).status, 'undefined');
  assert.match(parseVenn('sets: A B\ngiven: P(A) = 0, P(B | A) = 0.4').problems.join('；'), /条件.*概率是 0/);
});

test('I9 I10 抽样：ask 的式子算不出有限的数、σ 未知的区间样本不到两个，写的时候就报', () => {
  const p = (src) => parseSim(src).problems.join('；');
  assert.match(p('draw: X ~ t(1)\nn: 5\nask: "期望" = mu'), /ask.*算不出/);
  assert.match(p('draw: X ~ N(5, 4)\nview: intervals\nsigma: unknown\nn: 1'), /至少要 2 个/);
  assert.match(p('draw: X ~ N(5, 4)\nview: intervals\nsigma: unknown\nslider n 1 30 = 5 step=1'), /滑块.*从 2 起/);
  assert.deepEqual(parseSim('draw: X ~ N(5, 4)\nview: intervals\nsigma: known\nn: 1').problems, []);
});

test('I11 抽样：还没攒够数据时，横轴按这个统计量理论上在哪猜（χ²、S² 不按原分布的 μ ± 4σ）', () => {
  const v = { mu: 0, sigma: 1 };
  const chi = guessRange('chi', v, 10);
  assert.ok(chi[0] === 0 && chi[1] > 20 && chi[1] < 40, `chi: ${chi}`);
  const s2 = guessRange('S2', { mu: 0, sigma: 2 }, 5);
  assert.ok(s2[0] === 0 && s2[1] > 8 && s2[1] < 30, `S2: ${s2}`);
  assert.deepEqual(guessRange('z', v, 10), [-4, 4]);
  assert.deepEqual(guessRange('sum', { mu: 1, sigma: 1 }, 4), [-4, 12]);
  assert.deepEqual(guessRange('mean', { mu: 1, sigma: 2 }, 4), [-3, 5]);
  const mx = guessRange('max', v, 10);
  assert.ok(mx[0] < 0 && mx[1] >= 4);
});

test('I12 一组格子：位数不够的小数标错的时候说原因', () => {
  const r = judgeCells(['1/3', '2/3'], ['0.33', '0.67']);
  assert.equal(r.ok, false);
  assert.match(r.text, /位数不够/);
  assert.equal(judgeCells(['1/3', '2/3'], ['0.333', '0.667']).ok, true);
  assert.doesNotMatch(judgeCells(['1/3', '2/3'], ['0.5', '0.667']).text, /位数不够/);
});

test('别的：P( ) 里没有比较的不当成事件；条件期望、连着的不等号', () => {
  const j = parseJointBlock('X: 0 1 2\nY: 0 1\np: 1/10 1/5; 1/5 3/10; 1/10 1/10').joint;
  assert.throws(() => quantityOf('P(X)', j), /比较/);
  assert.throws(() => quantityOf('P(X - Y)', j), /比较/);
  assert.equal(S(quantityOf('E(X | Y = 0)', j).value), '1');
  assert.equal(quantityOf('E(X | Y = 0)', j).tex, 'E(X \\mid Y = 0)');
  assert.equal(S(quantityOf('E(Y | X >= 1)', j).value), '4/7');
  assert.equal(S(quantityOf('P(0 < X <= 2)', j).value), '7/10');
  assert.equal(S(quantityOf('P(0 <= X + Y < 2)', j).value), '1/2');
  assert.throws(() => quantityOf('E(X | Y = 5)', j), /概率是 0/);
});
