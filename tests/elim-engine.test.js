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

test('elim 的错法诊断：基础解系没变号、特解没放回主元的位置、逆矩阵转置 / 伴随没除、矩阵方程乘反了', async () => {
  const { misreadFill, fillSpec } = await import('../kit/src/stepperspec.js');
  const diagnose = (fields) => {
    const input = E.parse(fields);
    const right = E.run(input);
    const t = fillSpec(E.table(input, right), {}).table;
    const vs = E.variants(input).map((v) => ({ ...v, table: fillSpec(E.table(v.input, E.run(v.input)), {}).table }));
    return { input, vs, t, guess: (v) => misreadFill(t, v.table.rows.map((r) => r.cells.map((c) => String(c.v))), vs) };
  };
  // 主元在第 1、3 列：x2、x4 自由
  const a = diagnose({ matrix: '[[1, 2, 0, 1], [0, 0, 1, 3]]', b: '[4, 5]' });
  assert.deepEqual(a.vs.map((v) => v.input.mistake), ['sign', 'order']);
  for (const v of a.vs) assert.equal(a.guess(v), v.label);
  // 对的不会被认成错法；对不上任何错法也不乱认
  const ok = a.t.rows.map((r) => r.cells.map((c) => String(c.v)));
  assert.equal(misreadFill(a.t, ok, a.vs), '');
  // 求逆：|A| = −2，A⁻¹ 不对称
  const b = diagnose({ matrix: '[[1, 2], [3, 4]]', inverse: 'true' });
  assert.deepEqual(b.vs.map((v) => v.input.mistake), ['transpose', 'adjugate']);
  for (const v of b.vs) assert.equal(b.guess(v), v.label);
  assert.deepEqual(E.run(b.vs[1].input).X.map((r) => r.map(String)), [['4', '-2'], ['-3', '1']]);
  // 对称、|A| = 1 的：两种错法都和对的一样，不列
  assert.deepEqual(E.variants(E.parse({ matrix: '[[2, 1], [1, 1]]', inverse: 'true' })), []);
  // AX = B 与 XA = B
  for (const side of ['left', 'right']) {
    const c = diagnose({ matrix: '[[1, 1], [0, 1]]', rhs: '[[1, 2], [3, 4]]', side });
    assert.deepEqual(c.vs.map((v) => v.input.mistake), ['side']);
    assert.equal(c.guess(c.vs[0]), c.vs[0].label);
  }
});

test('mode: do：学生自己写行变换，页面做；到了目标就算完；能撤回、能要提示；自己算的那一行逐个核对', async () => {
  const { doStart, doParse, doApply, doUndo, doStatus, doHint, doAutoCount, doOpText, doChanged, doCheckRow } = await import('../kit/src/engines/elim.js');
  // 求逆：目标是左边化成 E
  const inv = E.parse({ matrix: '[[1, 2], [3, 4]]', inverse: 'true' });
  let st = doStart(inv);
  assert.equal(st.target, 'E');
  assert.equal(doStatus(st).done, false);
  for (const t of ['r2 - 3r1', 'r2 / -2', 'r1 - 2r2']) st = doApply(st, doParse(st, t)[0]).state;
  assert.equal(doStatus(st).done, true);
  assert.deepEqual(st.M.map((r) => r.slice(2).map((x) => x.constValue().toString())), [['-2', '1'], ['3/2', '-1/2']]);
  // 写成文字再读回来是同一步（刷新后照记录重放用的就是这几个字）
  for (const h of st.history) assert.equal(doOpText(doParse(st, doOpText(h.op))[0]), doOpText(h.op));
  assert.deepEqual(st.history.map((h) => doOpText(h.op)), ['r2 − 3r1', 'r2 / −2', 'r1 − 2r2']);
  // 撤回
  const back = doUndo(st);
  assert.equal(back.history.length, 2);
  assert.equal(doStatus(back).done, false);
  // 求秩：目标是阶梯形；默认的提示是页面自己会做的下一步
  const rk = E.parse({ matrix: '[[2, 4, 6], [1, 1, 1]]' });
  const s0 = doStart(rk);
  assert.equal(s0.target, 'ref');
  assert.equal(doOpText(doHint(s0)), 'r1 ↔ r2');
  assert.equal(doAutoCount(rk), 2);
  // 解方程组要最简形；target: ref 只要阶梯形
  assert.equal(doStart(E.parse({ matrix: '[[1, 2], [3, 4]]', b: '[1, 1]' })).target, 'rref');
  assert.equal(doStart(E.parse({ matrix: '[[1, 2], [3, 4]]', b: '[1, 1]' }), { target: 'ref' }).target, 'ref');
  // 已经是阶梯形、还不是最简形：说清楚还差什么
  const half = doStart(E.parse({ matrix: '[[1, 2], [0, 3]]', b: '[1, 1]' }));
  assert.match(doStatus(half).text, /已经是行阶梯形了；行最简形还要/);
  // 没改变矩阵、倍加出了分数：提醒一句
  assert.match(doApply(s0, doParse(s0, '1r1')[0]).note, /没有改变矩阵/);
  assert.match(doApply(s0, doParse(s0, 'r2 - (1/3)r1')[0]).note, /出了分数/);
  // 写错了报出来（不带 ops: 前缀）
  assert.throws(() => doParse(s0, 'r5 - r1'), /^Error: 「r5 - r1」里的第 5 行不存在（一共 2 行）$/);
  assert.throws(() => doParse(s0, ''), /写一步行变换/);
  assert.throws(() => doStart(E.parse({ matrix: '[[1, a], [1, 1]]', param: 'a' })), /不能含参数/);
  // write: rows：交换不用写；倍加要写出新的那一行，逐个数核对（分数、整数写法都认）
  const [op] = doParse(s0, 'r2 - (1/2)r1');
  assert.deepEqual(doChanged(op), [1]);
  assert.deepEqual(doChanged(doParse(s0, 'r1 <-> r2')[0]), []);
  assert.deepEqual(doCheckRow(s0, op, ['0', '-1', '-2']), []);
  assert.deepEqual(doCheckRow(s0, op, ['0', '1', '-4/2']), [1]);
  assert.deepEqual(doCheckRow(s0, op, ['0', 'x', '']), [1, 2]);
  // 化不成 E：左边出现零行，说 A 不可逆
  let sg = doStart(E.parse({ matrix: '[[1, 2], [2, 4]]', inverse: 'true' }));
  sg = doApply(sg, doParse(sg, 'r2 - 2r1')[0]).state;
  assert.equal(doStatus(sg).done, true);
  assert.match(doStatus(sg).text, /不可逆/);
});

test('elim 的错法诊断（秩、向量组）：没化简就数非零行、表示系数取反、以为线性无关', async () => {
  const { misreadFill, fillSpec } = await import('../kit/src/stepperspec.js');
  const rk = E.parse({ matrix: '[[1, 2, 3], [2, 4, 6], [1, 0, 1]]' });
  const rv = E.variants(rk);
  assert.deepEqual(rv.map((v) => v.input.mistake), ['rows']);
  assert.equal(E.quiz(rv[0].input, E.run(rv[0].input)).answer, '3');
  assert.equal(E.quiz(rk, E.run(rk)).answer, '2');
  // 满秩：数原矩阵的非零行也对，不列
  assert.deepEqual(E.variants(E.parse({ matrix: '[[1, 2], [3, 4]]' })), []);
  const vg = E.parse({ vectors: 'a1 = (1, 2, 3), a2 = (2, 4, 6), a3 = (1, 0, 1), a4 = (3, 4, 7)' });
  const vv = E.variants(vg);
  assert.deepEqual(vv.map((v) => v.input.mistake), ['comboNeg', 'allIndep']);
  const t = fillSpec(E.table(vg, E.run(vg)), {}).table;
  const tables = vv.map((v) => ({ label: v.label, table: fillSpec(E.table(v.input, E.run(v.input)), {}).table }));
  const neg = tables[0].table.rows.map((r) => r.cells.map((c) => String(c.v)));
  assert.equal(misreadFill(t, neg, tables), vv[0].label);
  // 只把下面的「秩」写成了向量个数：也认得出
  const ok = t.rows.map((r) => r.cells.map((c) => String(c.v)));
  assert.equal(misreadFill(t, Object.assign(ok, { extra: ['4'] }), tables), vv[1].label);
});
