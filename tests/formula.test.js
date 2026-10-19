import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormula, formulaTeX, parseFree, compareFormula, formulaSpec } from '../kit/src/formula.js';
import { parseTemplate, instantiate, checkTemplate, fillText } from '../kit/src/practicespec.js';
import { Q, toFloat } from '../kit/src/exact.js';

const names = ['n', 'A', 'alpha', 'beta'];
const norm = (t) => normalizeFormula(t, { names });
const A = [[Q.int(1), Q.int(1)], [Q.int(2), Q.int(2)]]; // 秩一，tr A = 3，A^n = 3^(n-1) A
const spec = formulaSpec('3^(n-1)*A', 'n', { A });
const cmp = (t) => compareFormula(spec.expected, norm(t), spec);

// 固定的随机数，测试可重复
function seeded(seed = 7) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

test('normalizeFormula：省略乘号、上标、希腊字母、连写的名字、转置', () => {
  assert.equal(norm('3^(n-1)A'), '3 ^ ( n - 1 ) * A');
  assert.equal(norm('3^(n-1)·A'), '3 ^ ( n - 1 ) * A');
  assert.equal(norm('3ⁿ⁻¹A'), '3 ^ ( n - 1 ) * A');
  assert.equal(norm('(-1)^(n−1)A'), '( - 1 ) ^ ( n - 1 ) * A');
  assert.equal(norm('nA'), 'n * A');
  assert.equal(norm('2n+1'), '2 * n + 1');
  assert.equal(norm('(n-1)(n+1)'), '( n - 1 ) * ( n + 1 )');
  assert.equal(norm('trA'), 'tr ( A )');
  assert.equal(norm('tr(A)^(n-1)A'), 'tr ( A ) ^ ( n - 1 ) * A');
  assert.equal(norm('αβᵀ'), "alpha * beta'");
  assert.equal(norm('β^Tα'), "beta' * alpha");
  assert.equal(norm('A²'), 'A ^ ( 2 )');
  assert.equal(norm('3**n'), '3 ^ n');
  assert.throws(() => norm(''), /还没写式子/);
  assert.throws(() => norm('3x'), /不认识「x」：式子里能用 n、A、alpha、beta/);
  assert.throws(() => norm('3^(n-1'), /式子不完整或写错了/);
  assert.throws(() => norm('3 & 4'), /看不懂「&/);
});

test('formulaTeX：写成公式给学生看', () => {
  assert.equal(formulaTeX(norm('3^(n-1)A')), '{3}^{n - 1}\\,A');
  assert.equal(formulaTeX(norm('(-1)^(n-1)A')), '{\\left(-1\\right)}^{n - 1}\\,A');
  assert.equal(formulaTeX(norm('2·3')), '2 \\cdot 3');
  assert.equal(formulaTeX(norm('n/2+1')), '\\frac{n}{2} + 1');
  assert.equal(formulaTeX(norm('αβᵀ')), '\\alpha\\,{\\beta}^{\\mathrm T}');
  assert.equal(formulaTeX(norm('trA')), '\\operatorname{tr}\\left(A\\right)');
  assert.equal(formulaTeX(norm('n-(n-1)')), 'n - \\left(n - 1\\right)');
});

test('parseFree：要代的值', () => {
  assert.deepEqual(parseFree('n'), [{ name: 'n', values: [1, 2, 3, 4, 5, 6] }]);
  assert.deepEqual(parseFree('n=0..3'), [{ name: 'n', values: [0, 1, 2, 3] }]);
  assert.deepEqual(parseFree('n, k=2..3').map((f) => f.values), [[1, 2, 3, 4, 5, 6], [2, 3]]);
  assert.throws(() => parseFree(''), /formula: 后面写/);
  assert.throws(() => parseFree('n=5..1'), /最多 30 个值/);
  assert.throws(() => parseFree('n+1'), /formula: 的写法/);
});

test('compareFormula：等价的写法都算对', () => {
  for (const t of ['3^(n-1)A', '3ⁿ⁻¹A', 'A·3^(n-1)', '3^n/3 A', 'tr(A)^(n-1)A', '(trA)^(n-1)·A', '3^(n-1)*A + 0*A']) {
    assert.equal(cmp(t).ok, true, t);
  }
});

test('compareFormula：不对时指出哪个 n 对不上、值是多少', () => {
  const r = cmp('3^n A');
  assert.equal(r.ok, false);
  assert.match(r.msg, /^\$n = 1\$ 时你的式子得 \$\\begin\{bmatrix\}3 & 3 \\\\ 6 & 6\\end\{bmatrix\}\$，应该是 \$\\begin\{bmatrix\}1 & 1 \\\\ 2 & 2\\end\{bmatrix\}\$。$/);
  assert.equal(r.note, '代值检查：n = 1、2、3、4 等 不对');
  const nine = cmp('9A');
  assert.match(nine.msg, /^\$n = 3\$ 时对得上；\$n = 1\$ 时你的式子得/);
  assert.equal(nine.note, '代值检查：n = 3 对，n = 1、2、4、5 等 不对');
  // 漏了 n-1 次方里的 -1：n = 1 时就不对
  const sign = compareFormula('(-1)^(n-1)*A', norm('(-1)^n A'), formulaSpec('(-1)^(n-1)*A', 'n', { A }));
  assert.equal(sign.ok, false);
  assert.match(sign.msg, /\$n = 1\$ 时你的式子得/);
  // 尺寸都不对：说算不出来
  assert.match(cmp('A + n').msg, /算不出来/);
});

test('compareFormula：没化简、直接写 A^n 的不算（不计一次）', () => {
  const r = cmp('A^n');
  assert.equal(r.ok, false);
  assert.equal(r.powerBan, true);
  assert.match(r.msg, /不能直接写矩阵的 \$n\$ 次方/);
  assert.equal(cmp('A^(n-1)·A').powerBan, true);
  // 标准答案自己就带矩阵的 n 次幂时，学生也可以写
  const B = [[Q.int(0), Q.int(1)], [Q.int(0), Q.int(0)]];
  const s2 = formulaSpec('B^(n+1)', 'n=0..3', { B });
  assert.equal(compareFormula(s2.expected, normalizeFormula('B^n*B', { names: s2.names }), s2).ok, true);
});

test('formulaSpec：答案里的量要有定义；小键盘放用到的量', () => {
  assert.deepEqual(spec.keys, ['n', 'A']);
  assert.deepEqual(spec.names, ['n', 'A']);
  assert.throws(() => formulaSpec('k^(n-1)*A', 'n', { A }), /k 没有定义/);
  assert.throws(() => formulaSpec('', 'n', { A }), /要写 answer:/);
  assert.throws(() => formulaSpec('A^(1/n)', 'n', { A }), /代不进去/);
});

const TPL = [
  'id: pr-1',
  'title: 秩一矩阵的幂',
  'type: custom',
  'count: 3',
  'pick a = int(-3, 3) nonzero',
  'pick c = int(1, 3)',
  'let A = [[c, 1], [a*c, a]]',
  'where tr(A) != 0',
  'where abs(tr(A)) <= 4',
  'q: 设 $A=\\calc{A}$，求 $A^{3}$。',
  '先看两行成什么比例。',
  'answer: A^3',
  'before: A^3 =',
  'explain: $\\operatorname{tr}A=\\calc{tr(A)}$，$A^3=\\calc{A^3}$。',
].join('\n');

test('parseTemplate：命令和字段', () => {
  const t = parseTemplate(TPL);
  assert.deepEqual(t.picks.map((p) => [p.name, p.gen, p.nums, p.nonzero]), [['a', 'int', [-3, 3], true], ['c', 'int', [1, 3], false]]);
  assert.deepEqual(t.lets.map((l) => l.name), ['A']);
  assert.equal(t.wheres.length, 2);
  assert.equal(t.fields.q, '设 $A=\\calc{A}$，求 $A^{3}$。\n先看两行成什么比例。');
  assert.equal(t.fields.answer, 'A^3');
  assert.deepEqual(parseTemplate('pick v = vec(3, -2, 2) nonzero\npick M = mat(2, 2, -1, 1)\npick k = choice(2, 1/2, -3)\nq: x\nanswer: k*M*[1, 1]').picks.map((p) => p.gen), ['vec', 'mat', 'choice']);
});

test('parseTemplate：写错了说清楚', () => {
  assert.throws(() => parseTemplate('q: x\nanswer: 1'), /至少要一条 pick/);
  assert.throws(() => parseTemplate('pick a = int(1, 3)\nanswer: a'), /要写 q:/);
  assert.throws(() => parseTemplate('pick a = int(1, 3)\nq: x'), /要写 answer:/);
  assert.throws(() => parseTemplate('pick a = rand(1, 3)\nq: x\nanswer: a'), /pick 的右边写 int/);
  assert.throws(() => parseTemplate('pick a = int(3, 1)\nq: x\nanswer: a'), /最大值要不小于最小值/);
  assert.throws(() => parseTemplate('pick a = int(0, 0) nonzero\nq: x\nanswer: a'), /只有 0/);
  assert.throws(() => parseTemplate('pick t = int(1, 3)\nq: x\nanswer: t'), /保留的名字/);
  // n 只在 formula: n 时不能用
  assert.throws(() => parseTemplate('pick n = int(1, 3)\nq: x\nanswer: n^2\nformula: n'), /formula: n/);
  assert.equal(parseTemplate('pick n = int(1, 3)\nq: x\nanswer: n').picks[0].name, 'n');
  // int 的范围可以用前面取的量
  const t2 = parseTemplate('pick k = int(2, 4)\npick x = int(0, 2^k - 1)\nq: x\nanswer: x');
  for (let i = 0; i < 20; i++) { const { vars } = instantiate(t2, {}); assert.ok(vars.x.toNumber() <= 2 ** vars.k.toNumber() - 1); }
  assert.throws(() => parseTemplate('pick a = int(1, 3)\nwhere a >\nq: x\nanswer: a'), /「where a >」/);
  assert.throws(() => parseTemplate('pick a = int(1, 3)\nid: x\nfoo bar\nq: x\nanswer: a'), /看不懂这一行：foo bar/);
});

test('instantiate：满足 where 才出题，答案精确', () => {
  const t = parseTemplate(TPL);
  const rand = seeded(11);
  for (let k = 0; k < 30; k++) {
    const { vars, picked } = instantiate(t, { rand });
    const tr = vars.A[0][0].add(vars.A[1][1]);
    assert.ok(!tr.zero && Math.abs(tr.toNumber()) <= 4, '满足 where');
    assert.ok(!picked.a.zero, 'nonzero');
    // 秩一：A^3 = tr(A)^2 A
    const A3 = fillText('\\calc{A^3}', vars).tex;
    const want = fillText('\\calc{tr(A)^2*A}', vars).tex;
    assert.equal(A3, want);
  }
  // 条件取不到
  assert.throws(() => instantiate(parseTemplate('pick a = int(1, 3)\nwhere a > 5\nq: x\nanswer: a'), { rand }), /没满足「where a > 5」/);
  // 每次都算不出来
  assert.throws(() => instantiate(parseTemplate('pick a = int(1, 3)\nlet b = 1/(a-a)\nq: x\nanswer: b'), { rand }), /都算不出来：除以 0 了/);
  // 有时算不出来：重取就好（a = 2 时除以 0）
  const some = parseTemplate('pick a = int(1, 3)\nlet b = 1/(a-2)\nq: x\nanswer: b');
  for (let k = 0; k < 10; k++) assert.notEqual(instantiate(some, { rand }).picked.a.toString(), '2');
  // 和上一题一样的尽量换一组
  const two = parseTemplate('pick a = int(1, 2)\nq: x\nanswer: a');
  let prev = null, repeats = 0;
  for (let k = 0; k < 20; k++) { const r = instantiate(two, { rand, avoid: prev }); if (prev && r.picked.a.toString() === prev.a.toString()) repeats++; prev = r.picked; }
  assert.equal(repeats, 0);
});

test('checkTemplate：先取几组数试一遍，题面、解析、答案都要算得出来', () => {
  assert.deepEqual(checkTemplate(parseTemplate(TPL), { rand: seeded(3) }), []);
  const bad = checkTemplate(parseTemplate('pick a = int(1, 3)\nq: $\\calc{a*zz}$\nanswer: a'), { rand: seeded(3) });
  assert.match(bad[0], /^取 a=\d 时，q: 里的 \\calc\{a\*zz\} 算不出来：未定义的变量 zz$/);
  const bad2 = checkTemplate(parseTemplate('pick a = int(1, 3)\nq: x\nanswer: [1, 2]*[3, 4]'), { rand: seeded(3) });
  assert.match(bad2[0], /answer: 算不出来/);
  // 答案是式子时由调用方检查
  const f = parseTemplate('pick c = int(2, 3)\nlet A = [[c, 0], [0, 0]]\nq: x\nanswer: c^(n-1)*A\nformula: n');
  assert.deepEqual(checkTemplate(f, { rand: seeded(3), formulaCheck: (vars) => formulaSpec(f.fields.answer, f.fields.formula, vars) }), []);
  assert.equal(toFloat(instantiate(f, { rand: seeded(5) }).vars.A[1][1]), 0);
});

test('practice 里可以用 E、I 当名字（阶码 E）；E(3) 仍是单位矩阵', async () => {
  const t = parseTemplate('type: custom\npick n = int(1, 20)\nlet E = (n >= 2) + (n >= 4) + (n >= 8) + (n >= 16)\nlet M = E(2) * E\nq: x\nanswer: E');
  assert.deepEqual(checkTemplate(t), []);
  const { vars } = instantiate(t, { rand: () => 0.5 });
  assert.equal(vars.E.toString(), '3'); // n = 11
  assert.deepEqual(vars.M.map((r) => r.map(String)), [['3', '0'], ['0', '3']]);
});

test('formula: λ（特征多项式）：作者写希腊字母、省略乘号都行；学生写 λ 判分', async () => {
  const { formulaSpec, compareFormula, normalizeFormula, formulaTeX } = await import('../kit/src/formula.js');
  const s = formulaSpec('(λ-1)(λ-2)^2', 'λ', {});
  assert.equal(s.free[0].name, 'lambda');
  assert.equal(s.display, '(λ-1)(λ-2)^2');
  const read = (t) => normalizeFormula(t, { names: s.names });
  assert.ok(compareFormula(s.expected, read('λ^3 - 5λ^2 + 8λ - 4'), { free: s.free, scope: s.scope }).ok);
  assert.ok(compareFormula(s.expected, read('(λ-2)²(λ-1)'), { free: s.free, scope: s.scope }).ok);
  assert.equal(compareFormula(s.expected, read('(λ-1)^2(λ-2)'), { free: s.free, scope: s.scope }).ok, false);
  assert.match(formulaTeX(s.expected), /lambda/);
});

test('practice 的内置线代题型：每种、每个难度取 20 组数都算得出、条件取得到；数是「好算」的', async () => {
  const { BUILTIN_TEMPLATES, builtinTemplate, instantiate } = await import('../kit/src/practicespec.js');
  const { calcValue } = await import('../kit/src/exact.js');
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const name of Object.keys(BUILTIN_TEMPLATES)) {
    for (const level of [1, 2]) {
      const t = builtinTemplate(name, level);
      assert.deepEqual(checkTemplate(t, { rand, rounds: 20 }), [], `${name} level ${level}`);
    }
  }
  // 逆矩阵（level 2）是整数；特征值是从小到大的整数；二次型的矩阵对称、交叉项是一半
  for (let k = 0; k < 10; k++) {
    const inv = instantiate(builtinTemplate('inverse', 2), { rand }).vars;
    assert.ok(calcValue('inv(A)', inv).value.flat().every((x) => x.integer));
    const eg = instantiate(builtinTemplate('eigen', 1), { rand }).vars;
    assert.ok(eg.a.cmp(eg.b) < 0);
    const qf = instantiate(builtinTemplate('quadform', 1), { rand }).vars;
    assert.ok(qf.A.every((r, i) => r.every((x, j) => x.cmp(qf.A[j][i]) === 0)));
  }
  assert.equal(builtinTemplate('nope'), null);
  assert.equal(builtinTemplate('det3', 5).fields.q.includes('四阶'), true, '难度超过了就用最难的');
});
