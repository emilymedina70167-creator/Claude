import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elimEngine as E, parsePolyExpr, parseOps } from '../kit/src/engines/elim.js';

const last = (r) => r.steps.at(-1);
const tex = (x) => x;

test('写法：含参数的式子、ops', () => {
  assert.equal(parsePolyExpr('a^2 - 1', 'a').toFactorTeX('a'), '(a + 1)(a - 1)');
  assert.equal(parsePolyExpr('2a(a+1)', 'a').toTeX('a'), '2a^{2} + 2a');
  assert.equal(parsePolyExpr('1/2', '').constValue().toString(), '1/2');
  assert.throws(() => parsePolyExpr('a', ''), /param/);
  assert.throws(() => parsePolyExpr('1/a', 'a'), /不能除以含参数/);
  const ops = parseOps('r1 <-> r3; r2 - 2r1; r3 + (1/2)r1; 2r2; r3 / 3; -r1', 3);
  assert.deepEqual(ops.map((o) => o.kind), ['swap', 'add', 'add', 'scale', 'scale', 'scale']);
  assert.throws(() => parseOps('r4 - r1', 3), /第 4 行不存在/);
  assert.throws(() => parseOps('0r1', 3), /乘 0/);
});

test('向量组的秩、极大无关组、表示（同济的例子）', () => {
  const input = E.parse({ vectors: 'a1 = (1,-1,2,4), a2 = (0,3,1,2), a3 = (3,0,7,14), a4 = (1,-1,2,0), a5 = (2,1,5,6)' });
  const r = E.run(input);
  assert.equal(r.rank, 3);
  assert.deepEqual(r.pivots, [0, 1, 3]);
  assert.deepEqual(r.reps.map((x) => [x.j, x.coef.map(String)]), [[2, ['3', '1', '0']], [4, ['1', '1', '1']]]);
  const basisAsk = r.steps.find((s) => s.ask?.tag === 'basis').ask;
  assert.ok(basisAsk.alts.some((a) => a.join() === 'a1,a2,a4'));
  assert.ok(!basisAsk.alts.some((a) => a.join() === 'a1,a2,a3')); // a3 = 3a1 + a2，不是无关的
  const t = E.table(input, r);
  assert.deepEqual(t.rows.map((x) => x.cells.map((c) => c.v)), [['3', '1', '0'], ['1', '1', '1']]);
  const html = E.view(last(r).view, input, { tex });
  assert.match(html, /data-pick="a1"/);
});

test('解方程组：唯一解 / 无穷多解（通解）/ 无解', () => {
  let r = E.run(E.parse({ matrix: '[[1,1,1],[1,-1,2],[2,1,-1]]', b: '[6, 5, 1]' }));
  assert.equal(r.sol.kind, 'unique');
  assert.deepEqual(r.sol.x.map(String), ['1', '2', '3']);
  r = E.run(E.parse({ matrix: '[[1,1,1],[2,2,2]]', b: '[1, 2]' }));
  assert.equal(r.sol.kind, 'infinite');
  assert.deepEqual(r.sol.x0.map(String), ['1', '0', '0']);
  assert.deepEqual(r.sol.basis.map((b) => b.map(String)), [['-1', '1', '0'], ['-1', '0', '1']]);
  r = E.run(E.parse({ matrix: '[[1,1],[2,2]]', b: '[1, 3]' }));
  assert.equal(r.sol.kind, 'none');
  // 一步步都是初等行变换：最后一步的矩阵就是行最简形
  assert.ok(r.steps.length > 2);
});

test('含参数的方程组：λ = 1、−2 单独讨论（考研真题的数）', () => {
  const input = E.parse({ param: 'λ', matrix: '[[λ,1,1],[1,λ,1],[1,1,λ]]', b: '[1, λ, λ^2]' });
  const r = E.run(input);
  assert.deepEqual(r.special, ['−2', '1']);
  const byLabel = Object.fromEntries(r.cases.map((c) => [c.label, c]));
  assert.equal(byLabel['λ ≠ −2 且 λ ≠ 1'].kind, 'unique');
  assert.equal(byLabel['λ = −2'].kind, 'none');
  assert.equal(byLabel['λ = 1'].kind, 'infinite');
  assert.deepEqual(byLabel['λ = 1'].sol.x0.map(String), ['1', '0', '0']);
  assert.deepEqual(byLabel['λ = 1'].sol.basis.map((b) => b.map(String)), [['-1', '1', '0'], ['-1', '0', '1']]);
  const t = E.table(input, r);
  assert.equal(t.rows.length, 3);
  assert.ok(r.steps.find((s) => s.ask?.tag === 'special'));
});

test('求逆、矩阵方程 AX = A + 2X 化成 (A − 2E)X = A', () => {
  let r = E.run(E.parse({ matrix: '[[1,2],[3,4]]', inverse: 'true' }));
  assert.deepEqual(r.X.map((row) => row.map(String)), [['-2', '1'], ['3/2', '-1/2']]);
  r = E.run(E.parse({ matrix: '[[2,2,3],[1,-1,0],[-1,2,1]]', rhs: '[[4,2,3],[1,1,0],[-1,2,3]]' }));
  assert.deepEqual(r.X.map((row) => row.map(String)), [['3', '-8', '-6'], ['2', '-9', '-6'], ['-2', '12', '9']]);
  r = E.run(E.parse({ matrix: '[[1,2],[2,4]]', inverse: 'true' }));
  assert.equal(r.X, null);
  // XA = B
  r = E.run(E.parse({ matrix: '[[1,2],[3,4]]', rhs: '[[1,0],[0,1]]', side: 'right' }));
  assert.deepEqual(r.X.map((row) => row.map(String)), [['-2', '1'], ['3/2', '-1/2']]);
});

test('老师自己写 ops：照做；做完不是最简形就自动接着做', () => {
  const r = E.run(E.parse({ matrix: '[[2,4],[1,3]]', ops: 'r1 <-> r2', goal: 'rank' }));
  assert.equal(r.rank, 2);
  assert.match(r.steps[1].view.op, /leftrightarrow/);
  assert.throws(() => E.parse({ matrix: '[[1,a],[a,1]]' }), /param/);
  assert.throws(() => E.parse({ matrix: '[[1,2],[3,4]]', param: 'a' }), /矩阵里却没有 a/);
});
