// 视觉交互第 6 批 Task 1：det 收参数（param: a），格子是多项式；数字的老题输出一字不变
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detEngine } from '../kit/src/engines/det.js';
import { parseFields } from '../kit/src/parse.js';
import { formulaSpec, compareFormula, normalizeFormula } from '../kit/src/formula.js';
import { Poly, polyDet } from '../kit/src/poly.js';

const runOf = (fields) => { const input = detEngine.parse(fields); return { input, r: detEngine.run(input) }; };
const last = (r) => r.steps.at(-1);

test('三阶 [[a,1,1],[1,a,1],[1,1,a]]：各列加到第一列、提出 (a+2)、消元 → (a+2)(a-1)²', () => {
  const { r } = runOf({ matrix: '[[a, 1, 1], [1, a, 1], [1, 1, a]]', param: 'a', ops: 'c1 + c2 + c3; c1 / (a+2); r2 - r1; r3 - r1' });
  assert.equal(r.valueTeX, '(a + 2)(a - 1)^{2}');
  // 值和直接展开的一样
  const A = [[Poly.x(), Poly.const(1), Poly.const(1)], [Poly.const(1), Poly.x(), Poly.const(1)], [Poly.const(1), Poly.const(1), Poly.x()]];
  assert.ok(r.value.equals(polyDet(A)));
  // 提公因式那一步：系数乘 (a+2)，第一列全是 1
  const pull = r.steps.find((s) => /提出公因式 \$/.test(s.msg));
  assert.ok(pull, '有提公因式的一步');
  assert.deepEqual(pull.view.M.map((row) => row[0].toTeX('a')), ['1', '1', '1']);
  assert.ok(last(r).msg.includes('(a + 2)(a - 1)^{2}'), last(r).msg);
});

test('不写 ops：主元是非零常数时页面自己化；碰到含参的主元报写法错误，让写 ops', () => {
  const { r } = runOf({ matrix: '[[a, 1], [1, a]]', param: 'a' });
  assert.ok(r.value.equals(Poly.x().mul(Poly.x()).sub(Poly.const(1))), 'a² − 1');
  assert.throws(() => runOf({ matrix: '[[a, 1], [a, 2]]', param: 'a' }), /ops/);
});

test('提公因式除不尽报错；按行展开出多项式', () => {
  assert.throws(() => runOf({ matrix: '[[a, 1], [1, a]]', param: 'a', ops: 'r1 / (a+3)' }), /提不出|不是.*倍数/);
  const { r } = runOf({ matrix: '[[a, 1, 0], [1, a, 1], [0, 1, a]]', param: 'a', ops: 'expand r1' });
  const want = polyDet([[Poly.x(), Poly.const(1), Poly.const(0)], [Poly.const(1), Poly.x(), Poly.const(1)], [Poly.const(0), Poly.const(1), Poly.x()]]);
  assert.ok(r.value.equals(want));
});

test('写了 param 矩阵里没有、矩阵里有字母没写 param：报错', () => {
  assert.throws(() => runOf({ matrix: '[[1, 2], [3, 4]]', param: 'a' }), /param/);
  assert.throws(() => runOf({ matrix: '[[a, 2], [3, 4]]' }), /param/);
});

test('mode: quiz 判含参的答案：展开的、因式的都算对，差一项算错', () => {
  const { input, r } = runOf({ matrix: '[[a, 1, 1], [1, a, 1], [1, 1, a]]', param: 'a', ops: 'c1 + c2 + c3; c1 / (a+2); r2 - r1; r3 - r1' });
  const qz = detEngine.quiz(input, r);
  assert.equal(qz.type, 'formula');
  const spec = formulaSpec(qz.answer, qz.free);
  const judge = (t) => compareFormula(spec.expected, normalizeFormula(t, { names: spec.names }), spec).ok;
  assert.equal(judge('(a+2)(a-1)^2'), true);
  assert.equal(judge('a^3 - 3a + 2'), true);
  assert.equal(judge('a^3 - 3a'), false);
});

test('含参数时没有 fill 的表、不问 value；effect、sign 照样问', () => {
  const { input, r } = runOf({ matrix: '[[a, 1], [1, a]]', param: 'a', ops: 'r1 <-> r2; r2 - a r1' });
  assert.equal(detEngine.table(input, r), null);
  assert.ok(!r.steps.some((s) => s.ask?.tag === 'value'));
  assert.ok(r.steps.some((s) => s.ask?.tag === 'effect'));
});

test('数字的老题：每一步、值、错法、quiz、fill 和改之前一字不差', () => {
  const before = JSON.parse(readFileSync('tests/fixtures/det-before.json', 'utf8'));
  for (const b of before) {
    const { fields } = parseFields(b.src);
    const input = detEngine.parse(fields), r = detEngine.run(input);
    const now = { value: r.value.toString(), steps: r.steps.map((s) => ({ msg: s.msg, coef: s.view.coef.toString(), M: s.view.M.map((row) => row.map((x) => x.toString())), op: s.view.op || null, ask: s.ask || null })), variants: (detEngine.variants(input) || []).map((v) => v.label), quiz: detEngine.quiz(input, r), table: detEngine.table(input, r) };
    assert.deepEqual(JSON.parse(JSON.stringify(now)), { value: b.value, steps: b.steps, variants: b.variants, quiz: b.quiz, table: b.table }, b.src.slice(0, 60));
  }
});
