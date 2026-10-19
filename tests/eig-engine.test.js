import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eigEngine as E, schmidtEngine as S, unit, unitTeX, schmidt, primitive } from '../kit/src/engines/eig.js';
import { Q } from '../kit/src/exact.js';

const q = (n, d = 1) => new Q(BigInt(n), BigInt(d));

test('特征值、特征向量、能对角化（考研的数：2, 2, 6）', () => {
  const input = E.parse({ matrix: '[[1,-1,1],[2,4,-2],[-3,-3,5]]' });
  assert.equal(input.goal, 'diag');
  const r = E.run(input);
  assert.deepEqual(r.values, ['2', '2', '6']);
  assert.equal(r.diagonalizable, true);
  const two = r.spaces.find((s) => s.root.toString() === '2');
  assert.equal(two.geo, 2);
  // 每个特征向量都满足 Av = λv
  for (const s of r.spaces) for (const v of s.basis) {
    const Av = input.A.map((row) => row.reduce((a, x, j) => a.add(x.mul(v[j])), q(0)));
    assert.deepEqual(Av.map(String), v.map((x) => x.mul(s.root).toString()));
  }
  const ask = r.steps.find((s) => s.ask?.tag === 'values').ask;
  assert.ok(ask.answer.split('|').map((x) => x.trim()).includes('6 2 2'));
  const t = E.table(input, r);
  assert.equal(t.extra[0].v, '能');
});

test('不能对角化：几何重数比代数重数少', () => {
  const r = E.run(E.parse({ matrix: '[[1,1],[0,1]]' }));
  assert.equal(r.diagonalizable, false);
  assert.equal(r.spaces[0].mult, 2);
  assert.equal(r.spaces[0].geo, 1);
});

test('实对称矩阵正交相似对角化：λ = −1 的两个特征向量施密特正交化，再单位化', () => {
  const input = E.parse({ matrix: '[[0,1,1],[1,0,1],[1,1,0]]' });
  assert.equal(input.goal, 'orth');
  const r = E.run(input);
  assert.deepEqual(r.values, ['-1', '-1', '2']);
  assert.equal(r.Q.length, 3);
  // Q 的列两两正交、长度 1（整数向量 w，|w|² = k）
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const a = r.Q[i].u, b = r.Q[j].u;
    const d = a.w.reduce((s, x, t) => s.add(x.mul(b.w[t])), q(0));
    if (i === j) assert.equal(d.toString(), String(a.k)); else assert.equal(d.toString(), '0');
  }
  assert.ok(r.steps.some((s) => s.ask?.tag === 'schmidt'));
});

test('施密特正交化、单位化的写法', () => {
  const { betas } = schmidt([[q(1), q(1), q(0)], [q(1), q(0), q(1)]]);
  assert.deepEqual(betas[1].map(String), ['1/2', '-1/2', '1']);
  assert.deepEqual(primitive(betas[1]).map(String), ['1', '-1', '2']);
  assert.equal(unitTeX(unit([q(1), q(1), q(0)])), '\\begin{pmatrix}\\frac{1}{\\sqrt{2}}\\\\\\frac{1}{\\sqrt{2}}\\\\0\\end{pmatrix}');
  assert.equal(unitTeX(unit([q(2), q(0), q(0)])), '\\begin{pmatrix}1\\\\0\\\\0\\end{pmatrix}');
  const si = S.parse({ vectors: '(1, 1, 0), (1, 0, 1)' });
  const sr = S.run(si);
  assert.equal(sr.steps.find((s) => s.ask?.tag === 'dot').ask.answer, 1);
  assert.throws(() => schmidt([[q(1), q(2)], [q(2), q(4)]]), /线性相关/);
  assert.throws(() => E.parse({ matrix: '[[1,2],[3,4]]', goal: 'orth' }), /实对称/);
});

test('eig 的错法诊断：对角元当特征值、秩当几何重数、有重根就不能对角化', async () => {
  const { misreadAnswer, misreadFill, fillSpec } = await import('../kit/src/stepperspec.js');
  // 特征值 −7, 2, 2（对称，2 是二重根，能对角化）
  const input = E.parse({ matrix: '[[1,-2,2],[-2,-2,4],[2,4,-2]]' });
  const vs = E.variants(input);
  const labels = vs.map((v) => v.input.mistake);
  assert.deepEqual(labels, ['diagValues', 'repeatNo', 'geoRank']);
  const quizzes = vs.map((v) => ({ label: v.label, answer: E.quiz(v.input, E.run(v.input)).answer }));
  assert.match(misreadAnswer('1 -2 -2', quizzes), /主对角线/);
  assert.equal(misreadAnswer('1 2 3', quizzes), '', '对不上任何错法的错答案不乱认');
  // 先猜：「能相似对角化吗」答「不能」→ 有重根就不能
  const askOf = (r, tag) => r.steps.map((s) => s.ask).find((a) => a?.tag === tag);
  const right = E.run(input);
  const diagAsk = askOf(right, 'diag');
  const asks = vs.map((v) => { const a = askOf(E.run(v.input), 'diag'); return a && a.q === diagAsk.q ? { label: v.label, answer: a.answer } : null; }).filter(Boolean);
  assert.match(misreadAnswer('不能', asks), /有重根就不能/);
  // 填表：几何重数写成了秩
  const t = fillSpec(E.table(input, right), {}).table;
  const gv = vs.find((v) => v.input.mistake === 'geoRank');
  const vt = E.table(gv.input, E.run(gv.input));
  const values = vt.rows.map((r) => r.cells.map((c) => String(c.v)));
  assert.match(misreadFill(t, values, [{ label: gv.label, table: fillSpec(vt, {}).table }]), /秩当成了/);
  // 三角矩阵：对角元就是特征值，不提这个错法
  assert.ok(!E.variants(E.parse({ matrix: '[[2,1],[0,3]]' })).some((v) => v.input.mistake === 'diagValues'));
});

test('schmidt 的错法诊断：往 α 上投影、忘了除以 (β, β)', async () => {
  const { misreadFill, fillSpec } = await import('../kit/src/stepperspec.js');
  const input = S.parse({ vectors: '(1, 1, 0), (1, 0, 1), (0, 1, 1)' });
  const right = S.run(input);
  const vs = S.variants(input);
  assert.deepEqual(vs.map((v) => v.input.mistake), ['useAlpha', 'noDenom']);
  const t = fillSpec(S.table(input, right), {}).table;
  const tables = vs.map((v) => ({ label: v.label, table: fillSpec(S.table(v.input, S.run(v.input)), {}).table }));
  for (const v of vs) {
    const vt = S.table(v.input, S.run(v.input));
    const values = vt.rows.map((r) => r.cells.map((c) => String(c.v)));
    assert.equal(misreadFill(t, values, tables), v.label);
  }
  // β₃ 往 α 上投影：减去 (α3,α1)/(α1,α1)·α1 和 (α3,α2)/(α2,α2)·α2
  const wrong = S.run(vs[0].input).betas[2].map(String);
  assert.deepEqual(wrong, ['-1', '1/2', '1/2']);
  assert.deepEqual(right.betas[2].map(String), ['-2/3', '2/3', '2/3']);
  // 两个向量本来就正交：怎么错都一样，不列
  assert.deepEqual(S.variants(S.parse({ vectors: '(1, 0), (0, 1)' })), []);
});
