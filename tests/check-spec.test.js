// 检验（二类组件，dev_requests/dr-plan2）：board check 和六种探题的写法、自检（kit/src/check/spec.js）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCheck, parseProbe, selfCheck, PROBE_TYPES, FACET_OF, LEVELS } from '../kit/src/check/spec.js';

const F = '```';
const fence = (type, body) => `${F}${type}\n${body.trim()}\n${F}`;

// 设计第七节的两份样板，照 5.1 的写法写全
const C1 = fence('construct', `
id: p1
q: 造两个同型但不相等的 2 阶矩阵 $A$、$B$
target: L2-14
level: 基础
slots: A=mat(2) B=mat(2)
if: A != B => 这两个相等了，题要的是不相等
example: A=[[1, 0], [0, 0]] B=[[0, 0], [0, 1]]
teach if1: 同型只是行数、列数一样；相等还要每个元素都一样。
retry: p1a, p1b
`);
const C1a = fence('construct', `
id: p1a
q: 造两个同型但不相等的 3 阶矩阵 $A$、$B$
target: L2-14
level: 基础
slots: A=mat(3) B=mat(3)
if: A != B => 这两个相等了
example: A=[[1,0,0],[0,0,0],[0,0,0]] B=[[0,0,0],[0,0,0],[0,0,1]]
teach default: 相等要每个元素都一样。
`);
const C1b = C1a.replace('id: p1a', 'id: p1b').replace(/3 阶/g, '2×3').replace(/mat\(3\)/g, 'mat(2,3)')
  .replace('A=[[1,0,0],[0,0,0],[0,0,0]] B=[[0,0,0],[0,0,0],[0,0,1]]', 'A=[[1,0,0],[0,0,0]] B=[[0,0,0],[0,0,1]]');
const S2 = (id) => fence('solve', `
id: ${id}
q: $A$ 是 3 阶方阵，$|A|=-2$，求 $|-3A^{\\mathrm T}|$，每一步写依据
target: L2-50
level: 基础
steps:
s1 rule: |kA| = k^n |A|，n = 3
s2 rule: |A^T| = |A|
s3 calc: (-3)^3 · (-2) = 54
teach s1: 数乘要乘到每一行上，提出来是 k 的 n 次方。
retry: ${id}a, ${id}b
`);
const S2r = (id) => fence('solve', `
id: ${id}
q: $A$ 是 2 阶方阵，$|A|=3$，求 $|2A|$
target: L2-50
level: 基础
steps:
s1 rule: |kA| = k^n |A|
s2 calc: 4 · 3 = 12
teach default: 提出来的是 k 的 n 次方。
`);
const R3 = fence('recall', `
id: p3
q: 不看板书，写出 $(A+B)^2$ 的展开；什么时候等于 $A^2+2AB+B^2$，为什么
target: L2-56
level: 核心
must m1: 四项，AB、BA 分开写：A^2 + AB + BA + B^2
must m2: 条件 AB = BA
must m3: 理由是矩阵乘法不交换
wrong w1: (A+B)^2 = A^2+2AB+B^2 对所有方阵都成立
answer: $(A+B)^2=A^2+AB+BA+B^2$，$AB=BA$ 时才等于 $A^2+2AB+B^2$
teach m2: 只有 AB = BA 时 AB + BA 才能并成 2AB。
teach default: 先把 (A+B)(A+B) 乘开，四项都写出来。
retry: p3a, p3b
`);
const R3r = (id) => fence('recall', `
id: ${id}
q: 写出 $(A-B)^2$ 的展开
target: L2-56
level: 核心
must m1: A^2 - AB - BA + B^2
teach default: 乘开时 AB、BA 不能并。
`);
const K4 = fence('construct', `
id: p4
q: 造一组 2 阶 $A$、$B$，使 $(A+B)(A-B) \\ne A^2-B^2$，并写出两边差的那一项
target: AB 和 BA 先后混
level: 核心
slots: A=mat(2) B=mat(2)
if: (A+B)*(A-B) != A^2-B^2 => 这一组两边相等了：A、B 可交换
expr 两边差: (A+B)*(A-B) - (A^2-B^2)
example: A=[[0,1],[0,0]] B=[[1,0],[0,0]]
teach if1: 可交换的两个矩阵两边一定相等，换一组不可交换的。
teach e1: 乘开是 A^2 - AB + BA - B^2。
retry: p4a, p4b
`);
const K4r = (id) => K4.replace('id: p4', `id: ${id}`).replace('retry: p4a, p4b\n', '');
const L5 = fence('claim', `
id: p5
claim: $A$、$B$ 都是对称矩阵，则 $(A+B)^2 = A^2+2AB+B^2$
truth: 假
target: L2-56
level: 核心
slots: A=mat(2) B=mat(2)
if: A == A' => A 不对称
if: B == B' => B 不对称
if: (A+B)^2 != A^2+2*A*B+B^2 => 这一组两边相等了，不是反例
example: A=[[1,0],[0,0]] B=[[0,1],[1,0]]
teach truth: 对称不等于可交换。
teach default: 找两个对称但不可交换的。
retry: p5a, p5b
`);
const L5r = (id) => L5.replace('id: p5', `id: ${id}`).replace('retry: p5a, p5b\n', '');
const D7 = fence('discriminate', `
id: p7
q: $A=\\begin{bmatrix}0&1\\\\0&0\\end{bmatrix}$，求 $(E+A)^5$ 能不能直接用二项式展开？为什么？
can: 能
target: 看着可疑其实能用
level: 核心
let A = [[0,1],[0,0]]
must m1: E 和任何方阵可交换
must m2: A^2 = O，所以 (E+A)^5 = E + 5A
result: E+5*A
teach can: E 和谁都可交换，二项式定理能用。
retry: p7a, p7b
`);
const D7r = (id) => D7.replace('id: p7', `id: ${id}`).replace('retry: p7a, p7b\n', '');
const SAMPLE_HEAD = 'check id=k1 title="第二讲第一节 检验" limit=15m pause=30s';
const SAMPLE_BODY = [
  'block L2.1.1 must=p1,p2',
  'block L2.1.4 must=p3,p4,p5 optional=p7 fast=90s',
  'spare p8',
  '<<<',
  '指出错在哪，只补缺的一点。',
  '>>>',
  C1, C1a, C1b, S2('p2'), S2r('p2a'), S2r('p2b'), R3, R3r('p3a'), R3r('p3b'), K4, K4r('p4a'), K4r('p4b'), L5, L5r('p5a'), L5r('p5b'), D7, D7r('p7a'), D7r('p7b'),
  R3r('p8'),
].join('\n');

test('常量：题型（数学六种在前，408、英语的接在后面）、每种默认测哪一面、三档', () => {
  assert.deepEqual(PROBE_TYPES, ['recall', 'construct', 'claim', 'discriminate', 'locate', 'solve',
    'trace', 'predict', 'tradeoff', 'code', 'calc', 'parse', 'translate', 'rewrite', 'errfind']);
  assert.equal(FACET_OF.recall, '重建');
  assert.equal(FACET_OF.discriminate, '能辨');
  assert.deepEqual(LEVELS, ['基础', '方法', '核心']);
});

test('parseCheck 读设计 5.1 的样子：时间、每块、备用、外部写给它的话', () => {
  const { check, errors } = parseCheck(SAMPLE_HEAD, SAMPLE_BODY);
  assert.deepEqual(errors, []);
  assert.equal(check.id, 'k1');
  assert.equal(check.title, '第二讲第一节 检验');
  assert.equal(check.limit, 900000);
  assert.equal(check.pause, 30000);
  assert.deepEqual(check.blocks[0], { block: 'L2.1.1', must: ['p1', 'p2'], optional: [], fast: 0 });
  assert.deepEqual(check.blocks[1], { block: 'L2.1.4', must: ['p3', 'p4', 'p5'], optional: ['p7'], fast: 90000 });
  assert.deepEqual(check.spare, ['p8']);
  assert.equal(check.prompt, '指出错在哪，只补缺的一点。');
  assert.equal(Object.keys(check.probes).length, 19);
  // 没写 family：块 / target
  assert.equal(check.probes.p3.family, 'L2.1.4/L2-56');
  assert.equal(check.probes.p3.block, 'L2.1.4');
  // retry 的块跟着本题
  assert.equal(check.probes.p3a.block, 'L2.1.4');
});

test('不写 pause 默认 30 秒，不写 limit 不限时', () => {
  const { check } = parseCheck('check id=k2', 'block L2.1.1 must=p1\n' + C1 + C1a + C1b);
  assert.equal(check.pause, 30000);
  assert.equal(check.limit, 0);
});

test('construct：slots、if 编号和话、expr、example', () => {
  const { probe } = parseProbe('construct', K4.split('\n').slice(1, -1).join('\n'));
  assert.deepEqual(probe.slots, [{ name: 'A', kind: 'mat', r: 2, c: 2 }, { name: 'B', kind: 'mat', r: 2, c: 2 }]);
  assert.deepEqual(probe.ifs, [{ id: 'if1', text: '(A+B)*(A-B) != A^2-B^2', msg: '这一组两边相等了：A、B 可交换' }]);
  assert.deepEqual(probe.exprs, [{ id: 'e1', label: '两边差', expected: '(A+B)*(A-B) - (A^2-B^2)' }]);
  assert.deepEqual(probe.example.A, [[0, 1], [0, 0]]);
  assert.deepEqual(probe.retry, ['p4a', 'p4b']);
  assert.equal(probe.facet, '能用');
});

test('slots 的几种形状', () => {
  const { probe } = parseProbe('construct', 'id: q\nq: 造\ntarget: x\nlevel: 方法\nslots: M=mat(2,3) v=vec(3) k=num\nif: k != 0\nexample: M=[[1,2,3],[4,5,6]] v=[1, 2, 3] k=2');
  assert.deepEqual(probe.slots, [{ name: 'M', kind: 'mat', r: 2, c: 3 }, { name: 'v', kind: 'vec', n: 3 }, { name: 'k', kind: 'num' }]);
  assert.deepEqual(probe.example.v, [1, 2, 3]);
  assert.equal(probe.example.k, 2);
});

test('teach 的键：编号、tag=…、default', () => {
  const { probe } = parseProbe('solve', 'id: q\nq: 求\ntarget: x\nlevel: 方法\nsteps:\ns1 rule: …\nteach s1: 一\nteach tag=规则用错: 二\nteach default: 三');
  assert.deepEqual(probe.teach, { s1: '一', 'tag=规则用错': '二', default: '三' });
});

test('recall：要点、可选要点、错说法；不写编号自动编', () => {
  const { probe } = parseProbe('recall', 'id: q\nq: 写\ntarget: x\nlevel: 核心\nmust: 一\nmust: 二\nmay: 三\nwrong: 四');
  assert.deepEqual(probe.must.map((m) => m.id), ['m1', 'm2']);
  assert.deepEqual(probe.may.map((m) => m.id), ['m3']);
  assert.deepEqual(probe.wrong, [{ id: 'w1', text: '四' }]);
});

test('recall 写 4 条 must 报「最多 3 条」', () => {
  const r = parseProbe('recall', 'id: q\nq: 写\ntarget: x\nlevel: 核心\nmust: 一\nmust: 二\nmust: 三\nmust: 四');
  assert.match(r.error, /最多 3 条/);
});

test('claim：真假、反例的字段；判真的要写要点或 proof', () => {
  const { probe } = parseProbe('claim', L5.split('\n').slice(1, -1).join('\n'));
  assert.equal(probe.truth, false);
  assert.equal(probe.ifs.length, 3);
  const t = parseProbe('claim', 'id: q\nclaim: 命题\ntruth: 真\ntarget: x\nlevel: 核心\nproof: derive\nstart: (A+B)^2\ngoal: A^2+A*B+B*A+B^2\nvars: A=mat(2,2) B=mat(2,2)');
  assert.equal(t.probe.truth, true);
  assert.deepEqual(t.probe.proof, { start: '(A+B)^2', goal: 'A^2+A*B+B*A+B^2', vars: 'A=mat(2,2) B=mat(2,2)' });
  assert.match(parseProbe('claim', 'id: q\nclaim: 命题\ntruth: 真\ntarget: x\nlevel: 核心').error, /要点|proof/);
});

test('discriminate、locate 的字段', () => {
  const d = parseProbe('discriminate', D7.split('\n').slice(1, -1).join('\n')).probe;
  assert.equal(d.can, true);
  assert.equal(d.result, 'E+5*A');
  assert.deepEqual(d.lets, [{ name: 'A', src: '[[0,1],[0,0]]' }]);
  const l = parseProbe('locate', 'id: q\nq: 错在哪\ntarget: x\nlevel: 方法\nline: 第一行\nline: 第二行\nline: 第三行\nbug: 2\nmust m1: 为什么\nfix: 1');
  assert.deepEqual(l.probe.lines, ['第一行', '第二行', '第三行']);
  assert.equal(l.probe.bug, 2);
  assert.equal(l.probe.fix, '1');
});

test('缺 target、level 不认识、id 不合法：报', () => {
  assert.match(parseProbe('recall', 'id: q\nq: 写\nlevel: 核心\nmust: 一').error, /target/);
  assert.match(parseProbe('recall', 'id: q\nq: 写\ntarget: x\nlevel: 难\nmust: 一').error, /level/);
  assert.match(parseProbe('recall', 'id: q 1\nq: 写\ntarget: x\nlevel: 核心\nmust: 一').error, /id/);
});

test('块里写了不认识的题型、没有 block 行：报', () => {
  assert.ok(parseCheck('check id=k1', 'block L2.1.1 must=p1\n' + fence('quiz', 'id: p1')).errors.some((e) => /quiz/.test(e)));
  assert.ok(parseCheck('check id=k1', C1).errors.some((e) => /block/.test(e)));
});

test('两份样板 selfCheck 是空的', () => {
  const { check } = parseCheck(SAMPLE_HEAD, SAMPLE_BODY);
  assert.deepEqual(selfCheck(check), []);
});

const errsOf = (body) => { const { check, errors } = parseCheck('check id=k1', body); return [...errors, ...(check ? selfCheck(check) : [])]; };

test('selfCheck：example 不满足某一条', () => {
  const bad = C1.replace('example: A=[[1, 0], [0, 0]] B=[[0, 0], [0, 1]]', 'example: A=[[1, 0], [0, 0]] B=[[1, 0], [0, 0]]');
  const errs = errsOf(['block L2.1.1 must=p1', bad, C1a, C1b].join('\n'));
  assert.ok(errs.some((e) => /p1/.test(e) && /if1/.test(e)), errs.join('\n'));
});

test('selfCheck：必做题的 retry 少于 2 道', () => {
  const one = C1.replace('retry: p1a, p1b', 'retry: p1a');
  const errs = errsOf(['block L2.1.1 must=p1', one, C1a].join('\n'));
  assert.ok(errs.some((e) => /p1/.test(e) && /至少 2 道/.test(e)), errs.join('\n'));
});

test('selfCheck：retry 指到没有的题、指到别的题型', () => {
  const errs = errsOf(['block L2.1.1 must=p1', C1.replace('retry: p1a, p1b', 'retry: p1a, p9'), C1a].join('\n'));
  assert.ok(errs.some((e) => /p9/.test(e)), errs.join('\n'));
  const errs2 = errsOf(['block L2.1.1 must=p1', C1, C1a, R3r('p1b')].join('\n'));
  assert.ok(errs2.some((e) => /p1b/.test(e) && /题型/.test(e)), errs2.join('\n'));
});

test('selfCheck：没排进任何一块的题', () => {
  const errs = errsOf(['block L2.1.1 must=p1', C1, C1a, C1b, R3r('p9')].join('\n'));
  assert.ok(errs.some((e) => /p9/.test(e) && /没排进任何一块/.test(e)), errs.join('\n'));
});

test('selfCheck：同一个 id 写了两次', () => {
  const errs = errsOf(['block L2.1.1 must=p1', C1, C1a, C1b, C1a].join('\n'));
  assert.ok(errs.some((e) => /p1a/.test(e) && /两次/.test(e)), errs.join('\n'));
});

test('selfCheck：必做题一条 teach 都没有', () => {
  const none = C1.replace('teach if1: 同型只是行数、列数一样；相等还要每个元素都一样。\n', '');
  const errs = errsOf(['block L2.1.1 must=p1', none, C1a, C1b].join('\n'));
  assert.ok(errs.some((e) => /p1/.test(e) && /teach/.test(e)), errs.join('\n'));
});

test('selfCheck：block 行里的题没写', () => {
  const errs = errsOf(['block L2.1.1 must=p1,p6', C1, C1a, C1b].join('\n'));
  assert.ok(errs.some((e) => /p6/.test(e)), errs.join('\n'));
});
