// dr-final-fix 小的几条（5–9）和独立审查留下的两条（A、B）：
//   5. 预检：不在 scene / space 里的 sin cos tan，参数是 ≥ 7 的整数（或值是这种整数的量）提示「这里按弧度算」，只提示
//   6. arccot 认；「不认识」的提示按题换（高数列 sin ln e π，矩阵照旧 tr det）；answer / derive 的式子全角先转半角
//   7. judgeMachine 自己也查格子的格式：对不上整道题待核 ok: null「作答的格式不对」，不照判、更不判过
//   8. 预检：板上单独写了探题写法的 trace（use:）报出来；检验块里不是探题的围栏不再多报「不认识的题型「_skip」」
//   9. 自检的并列提示多一句「LRU / FIFO 的缺页次数题一般写 against: 只留要打的那一种」
//   A. predict 的 expect 对的值带撇号：预检提示「学生不写撇号也算对；考稳定性另写 …」（level: hint）
//   B. expect / result 末尾写 as=dec：只收十进制的数（十六进制、二进制、式子交之前挡、判的时候待核）
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintTurn, blockNames, radianHints } from '../tools/ext-lint.js';
import { normalizeFormula, formulaSpec, compareFormula, formulaTeX } from '../kit/src/formula.js';
import { evaluate, parse } from '../kit/src/expr.js';
import { calcValue } from '../kit/src/exact.js';
import { diffAst } from '../kit/src/fx/diff.js';
import { parseDeriveDo, sampleEnvs, checkLine } from '../kit/src/derivedo.js';
import { parseProbe, parseCheck, selfCheck } from '../kit/src/check/spec.js';
import { judgeMachine, expectProblems, resultProblem, primedExpects, slotFormat } from '../kit/src/check/judge.js';

const names = await blockNames();
const lint = (text) => lintTurn({ text, names }).problems;
const P = (type, src) => { const r = parseProbe(type, src); if (r.error) throw new Error(r.error); return r.probe; };
const HEAD = 'id: q\nq: 题\ntarget: t\nlevel: 方法\n';
const item = (r, id) => r.items.find((x) => x.id === id);
const board = (body) => `\`\`\`board new id=s1\n${body}\n\`\`\``;

// —— 5 ——

test('5. let 里 cos(th)（th = 30）、\\calc{sin(45)} 提示按弧度；scene 里的、sin(2) 不提示；只是提示', () => {
  const ps = lint(board('```let\nth = 30\nR = [[cos(th), -sin(th)], [sin(th), cos(th)]]\n```\n\n$\\calc{sin(45)}$ 和 $\\calc{sin(2)}$\n\n```scene\nlet a = sin(30)\n```'));
  const rad = ps.filter((p) => /按弧度算/.test(p.msg));
  assert.equal(rad.length, 2, JSON.stringify(ps));
  assert.ok(rad.every((p) => p.level === 'hint'));
  assert.match(rad[0].msg, /th = 30/);
  assert.match(rad[0].msg, /30° 写 pi\/6；scene 里才是角度/);
  assert.match(rad[1].msg, /sin\(45\)/);
  // 前面一轮 let 的量也认；pi/6 这种不提示
  assert.equal(radianHints('cos(a)', { a: 90 }).length, 1);
  assert.deepEqual(radianHints('cos(pi/6) + sin(x)', { x: 1 }), []);
  assert.deepEqual(radianHints('\\sin(30)'), [], 'TeX 的 \\sin 不是算的');
});

// —— 6 ——

test('6. arccot：读得懂、算得对（值在 (0, π)）、预览、求导', () => {
  const src = normalizeFormula('arccot x', { names: ['x'], real: true });
  assert.equal(src.replace(/\s+/g, ''), 'arccot(x)');
  assert.ok(Math.abs(evaluate(parse(normalizeFormula('arccot(1)', { real: true })), {}) - Math.PI / 4) < 1e-12);
  assert.ok(Math.abs(evaluate(parse('arccot(-1)'), {}) - 3 * Math.PI / 4) < 1e-12);
  assert.match(formulaTeX(src), /arccot/);
  assert.ok(Math.abs(calcValue('arccot(1)', {}).value - Math.PI / 4) < 1e-12);
  const d = diffAst(parse('arccot(x)'), 'x', 1);
  assert.ok(Math.abs(evaluate(d, { x: 2 }) + 1 / 5) < 1e-12);
  // answer: arccot(x) 的实数题：写 pi/2 - arctan x 算对
  const f = formulaSpec('arccot(x)', 'x in (-2, 2)', {});
  assert.equal(compareFormula(f.expected, normalizeFormula('pi/2 - arctan x', f.read), f).ok, true);
});

test('6. 「不认识」的提示按题换：高数列 sin ln e π，矩阵的题照旧 tr det', () => {
  const fx = formulaSpec('pi/4', '-', {});
  assert.throws(() => normalizeFormula('Pi/4', fx.read), (e) => /sin、cos、ln/.test(e.message) && /e、π/.test(e.message) && !/det/.test(e.message));
  const real = formulaSpec('sin(x)', 'x in (-1, 1)', {});
  assert.throws(() => normalizeFormula('Pi*x', real.read), (e) => /sin/.test(e.message) && !/rank/.test(e.message));
  assert.throws(() => normalizeFormula('Pi', { names: ['n', 'A'] }), (e) => /tr、det、rank、inv/.test(e.message));
});

test('6. answer / derive 的式子全角先转半角（２ｘ）；上标、转置照旧', () => {
  const f = formulaSpec('2*x+1', 'x in (-2, 2)', {});
  assert.equal(compareFormula(f.expected, normalizeFormula('２ｘ＋１', f.read), f).ok, true);
  assert.equal(normalizeFormula('ｓｉｎ（ｘ）', { names: ['x'], real: true }).replace(/\s+/g, ''), 'sin(x)');
  assert.equal(normalizeFormula('A²', { names: ['A'] }).replace(/\s+/g, ''), 'A^(2)');
  assert.equal(normalizeFormula('Aᵀ', { names: ['A'] }).replace(/\s+/g, ''), "A'");
  // 线代的 derive
  const spec = parseDeriveDo('mode: do\nvars: A=mat(2,2)\nstart: (A+E)^2\ngoal: A^2+2A+E');
  const envs = sampleEnvs(spec);
  assert.equal(checkLine(spec, envs, '(A+E)^2', 'A^2+２A+E').ok, true);
  // 高数的 derive
  const lim = parseDeriveDo('mode: do\ncalc: limit at=0\nstart: lim sin(2x)/x\ngoal: 2');
  assert.equal(checkLine(lim, sampleEnvs(lim), 'lim sin(2x)/x', 'ｌｉｍ ２ｃｏｓ（２ｘ）').ok, true);
});

// —— 7 ——

test('7. judgeMachine 也查格式：mat(2) 写成一个字、seq(8) 交 7 个数 → 待核「作答的格式不对」，不照判', () => {
  const m = P('construct', `${HEAD}slots: A=mat(2) B=mat(2)\nif: A != B => 相等了\nexample: A=[[1,0],[0,0]] B=[[0,0],[0,1]]`);
  const r = judgeMachine(m, { slots: { A: '2', B: '6' } });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].ok, null);
  assert.match(r.items[0].why, /作答的格式不对/);
  assert.equal(r.stop, true);
  // 格式对的照判
  assert.equal(item(judgeMachine(m, { slots: { A: [['1', '0'], ['0', '0']], B: [['0', '0'], ['0', '1']] } }), 'if1').ok, true);
  assert.equal(item(judgeMachine(m, { slots: { A: [['1', '0'], ['0', '0']], B: [['1', '0'], ['0', '0']] } }), 'if1').ok, false);
  // 格子少一行、格子里写的不是数、少一格
  for (const A of [[['1', '0']], [['1', 'x'], ['0', '0']], [['1', ''], ['0', '0']], undefined]) {
    assert.equal(judgeMachine(m, { slots: { A, B: [['0', '0'], ['0', '1']] } }).items[0].ok, null, JSON.stringify(A));
  }
  const s = P('construct', `${HEAD}slots: A=seq(8)\nrun r: sort algo=shell gaps="4 2 1" array=A\nif: r.unstable >= 1 => 稳定\nexample: A=4 7 4 1 2 5 7 8`);
  const rs = judgeMachine(s, { slots: { A: '4 7 4 1 2 5 7' } });
  assert.equal(rs.items[0].ok, null);
  assert.match(rs.items[0].why, /作答的格式不对.*8 个数/);
  assert.equal(item(judgeMachine(s, { slots: { A: '4 7 4 1 2 5 7 8' } }), 'if1').ok, true);
  assert.match(slotFormat(s, { A: 7 }), /A/);
  // 判假的反例也一样
  const c = P('claim', `${HEAD}claim: AB = BA\ntruth: 假\nslots: A=mat(2) B=mat(2)\nif: A*B != B*A => 这一对可交换\nexample: A=[[0,1],[0,0]] B=[[1,0],[0,0]]`);
  const rc = judgeMachine(c, { truth: false, slots: { A: '2', B: '6' } });
  assert.equal(item(rc, 'truth').ok, true);
  assert.equal(item(rc, 'if1').ok, null);
  assert.ok(!rc.items.some((x) => x.ok === true && x.id !== 'truth'));
});

// —— 8 ——

test('8. 板上单独的 trace 写了 use:（探题写法）报出来；检验块里不是探题的围栏只报一句', () => {
  const ps = lint(board('```trace\nid: t1\nuse: sort\nalgo: shell\narray: 3 1 2\n```'));
  assert.ok(ps.some((p) => /trace 写了 use:.*board check/.test(p.msg) && p.level !== 'hint'), JSON.stringify(ps));
  // 走 C 代码的 trace 照旧不报
  assert.ok(!lint(board('```trace\ncode: |\n  int x = 1;\n```')).some((p) => /use:/.test(p.msg)));
  const { errors } = parseCheck('check id=k1', 'block L2.1.1 must=q\n```quiz\nq: x\n```');
  assert.ok(errors.some((e) => /「quiz」不是探题/.test(e)));
  assert.ok(!errors.some((e) => /_skip/.test(e)), errors.join('\n'));
});

// —— 9 ——

test('9. 并列的自检提示里多一句 LRU / FIFO 的出路（还是写法错误）', () => {
  const { check } = parseCheck('check id=k1', 'block L2.1.1 must=q\n```predict\nid: q\nq: 题\ntarget: t\nlevel: 方法\nrun r: paging algo=lru frames=3 refs="1 2 3 1 4 1 2"\nexpect 缺页: r.faults\nteach default: 一\nretry: q, q\n```');
  const hit = selfCheck(check).find((m) => /fifo 和 clock 的答案一样/.test(m));
  assert.ok(hit);
  assert.match(hit, /LRU \/ FIFO 的缺页次数题一般写 against: 只留要打的那一种/);
});

// —— A ——

test('A. expect 的对的值带撇号：预检提示考稳定性另写；没有相同的数不提示', () => {
  const p = P('predict', `${HEAD}run r: sort algo=select array="5 8 5 2 9"\nexpect 排完: r.final\nexpect 换了几次: r.unstable`);
  assert.deepEqual(primedExpects(p), ['排完']);
  assert.deepEqual(primedExpects(P('predict', `${HEAD}run r: sort algo=select array="5 8 6 2 9"\nexpect 排完: r.final`)), []);
  const text = '```board check id=c1\nblock L2.1.4 must=p1\n```predict\nid: p1\nq: 排完\ntarget: t\nlevel: 方法\nrun r: sort algo=select array="5 8 5 2 9"\nexpect 排完: r.final\nteach default: 看\n```\n```';
  const ps = lint(text);
  const h = ps.find((x) => /撇号/.test(x.msg));
  assert.ok(h, JSON.stringify(ps));
  assert.equal(h.level, 'hint');
  assert.match(h.msg, /学生不写撇号也算对；考稳定性另写 expect: r\.unstable 或 P in r\.flipped/);
  // 不是 selfCheck 的错
  const { check } = parseCheck('check id=c1', text.split('\n').slice(1, -1).join('\n'));
  assert.ok(!selfCheck(check).some((m) => /撇号也算对/.test(m)));
});

// —— B ——

test('B. result: 0x3A3C as=dec：十进制的数对，0x3A3C、3A3CH、式子交之前挡、判的时候待核', () => {
  const c = P('calc', `${HEAD}steps:\ns1 calc: 换算\nresult: 0x3A3C as=dec`);
  assert.equal(c.result, '0x3A3C');
  assert.equal(c.resultAs, 'dec');
  assert.equal(resultProblem(c, '14908'), '');
  assert.equal(item(judgeMachine(c, { result: '14908' }), 'result').ok, true);
  assert.equal(item(judgeMachine(c, { result: '14909' }), 'result').ok, false);
  for (const s of ['0x3A3C', '3A3CH', '3a3ch', '0b11101000111100', '14900+8']) {
    assert.match(resultProblem(c, s), /十进制/, s);
    assert.equal(item(judgeMachine(c, { result: s }), 'result').ok, null, s);
  }
  // 不写 as=dec 照旧认十六进制
  const h = P('calc', `${HEAD}steps:\ns1 calc: 换算\nresult: 0x3A3C`);
  assert.equal(item(judgeMachine(h, { result: '3A3CH' }), 'result').ok, true);
  // predict 的 expect
  const p = P('predict', `${HEAD}expect 十进制: 0x3A3C as=dec\nexpect 照旧: 0x10`);
  assert.deepEqual(expectProblems(p, { x1: '14908', x2: '0x10' }), []);
  assert.equal(expectProblems(p, { x1: '0x3A3C', x2: '0x10' }).length, 1);
  const r = judgeMachine(p, { expects: { x1: '0x3A3C', x2: '10H' } });
  assert.equal(item(r, 'x1').ok, null);
  assert.equal(item(r, 'x2').ok, true);
  // 分数、百分数照收
  const q = P('predict', `${HEAD}expect 命中率: 0.85 as=dec`);
  for (const s of ['85%', '17/20', '0.85']) assert.equal(item(judgeMachine(q, { expects: { x1: s } }), 'x1').ok, true, s);
  // 对的值不是数时写 as=dec：自检报
  const { check } = parseCheck('check id=k1', 'block L2.1.1 must=q\n```predict\nid: q\nq: 题\ntarget: t\nlevel: 方法\nrun r: paging algo=fifo frames=3 refs="7 0 1 2"\nexpect 换出: r.victims as=dec\nteach default: 一\nretry: q, q\n```');
  assert.ok(selfCheck(check).some((m) => /as=dec/.test(m)));
});
