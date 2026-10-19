// 组成原理的演示引擎（engines/co.js）：数的表示、IEEE 754、补码加减和标志位、Cache、流水线
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bitsEngine, cacheEngine, pipeEngine } from '../kit/src/engines/co.js';
import { checkAsk, misreadAnswer, misreadFill, cellOk } from '../kit/src/stepperspec.js';

const go = (eng, f) => { const input = eng.parse(f); return { input, r: eng.run(input) }; };

// 和 stepper.js 一样拿常见错法比（答错了才比）：先猜比题面一样的那一问，quiz 比答案，填表逐格比
const vruns = (eng, input, fields) => eng.variants(input, fields).map((v) => ({ label: v.label, input: v.input, run: eng.run(v.input) }));
const askAns = (a) => (Array.isArray(a.alts) ? a.alts.map((z) => [].concat(z).join(' ')).join(' | ') : [].concat(a.answer).join(' '));
function askDiag(eng, input, ask, given, fields = {}) {
  if (checkAsk(ask, given).ok) return '';
  return misreadAnswer(given, vruns(eng, input, fields).map((v) => { const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind); return a ? { label: v.label, answer: askAns(a) } : null; }).filter(Boolean));
}
function quizDiag(eng, input, given, fields = {}) {
  const q = eng.quiz(input, eng.run(input), fields);
  const same = q.type === 'num' ? (a, b) => cellOk({ v: a, num: true }, b) : undefined;
  if (misreadAnswer(given, [{ label: 'ok', answer: String(q.answer) }], same)) return '';
  return misreadAnswer(given, vruns(eng, input, fields).map((v) => ({ label: v.label, answer: String(eng.quiz(v.input, v.run, fields).answer) })), same);
}
const fillAs = (eng, inp, fields = {}) => eng.table(inp, eng.run(inp), fields).rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
const fillDiag = (eng, input, values, fields = {}) => misreadFill(eng.table(input, eng.run(input), fields), values, vruns(eng, input, fields).map((v) => ({ label: v.label, table: eng.table(v.input, v.run, fields) })));
const pick = (eng, input, re, fields = {}) => { const v = eng.variants(input, fields).find((x) => re.test(x.label)); assert.ok(v, `没有「${re}」这种错法`); return v; };
const askOf = (r, tag) => r.steps.find((s) => s.ask?.tag === tag).ask;

test('原码、反码、补码、移码；−2^(n−1) 只有补码和移码能表示', () => {
  assert.deepEqual(go(bitsEngine, { num: '-5' }).r.rows, { 原码: '10000101', 反码: '11111010', 补码: '11111011', 移码: '01111011' });
  assert.deepEqual(go(bitsEngine, { num: '5', width: '6' }).r.rows, { 原码: '000101', 反码: '000101', 补码: '000101', 移码: '100101' });
  assert.deepEqual(go(bitsEngine, { num: '-128' }).r.rows, { 原码: null, 反码: null, 补码: '10000000', 移码: '00000000' });
  const { r } = go(bitsEngine, { num: '-5', show: '补码' });
  assert.ok(checkAsk(r.steps.find((s) => s.ask?.tag === 'twos').ask, '1111 1011').ok);
  assert.ok(!checkAsk(r.steps.find((s) => s.ask?.tag === 'twos').ask, '1111011').ok, '要写满 8 位');
  assert.throws(() => bitsEngine.parse({ num: '200' }), /放不下/);
  assert.throws(() => bitsEngine.parse({ num: '1', show: '格雷码' }), /show/);
});

test('IEEE 754 单精度：编码（就近舍入）、解码', () => {
  const enc = (x) => go(bitsEngine, { float: x }).r.bits.toString(16).toUpperCase();
  assert.equal(enc('-0.75'), 'BF400000');
  assert.equal(enc('100.25'), '42C88000');
  assert.equal(enc('-12.375'), 'C1460000');
  assert.equal(enc('0.1'), '3DCCCCCD');
  assert.equal(enc('1'), '3F800000');
  assert.equal(enc('0'), '0');
  assert.equal(go(bitsEngine, { float: '0xC0A00000' }).r.value, -5);
  assert.equal(go(bitsEngine, { float: 'BEE00000H' }).r.value, -0.4375);
  const { input, r } = go(bitsEngine, { float: '-0.75' });
  assert.equal(bitsEngine.quiz(input, r, {}).answer, '0xbf400000');
  assert.ok(checkAsk(r.steps.find((s) => s.ask?.tag === 'hex').ask, 'BF40 0000H').ok);
});

test('补码加减法和标志位（王道：OF = Cn ⊕ Cn−1，CF = Cout ⊕ Cin）', () => {
  const f = (op, e) => go(bitsEngine, { [op]: e }).r;
  assert.deepEqual(f('add', '0x7F + 0x01').flags, { OF: 1, SF: 1, ZF: 0, CF: 0 });
  assert.deepEqual(f('sub', '5 - 7').flags, { OF: 0, SF: 1, ZF: 0, CF: 1 });
  assert.deepEqual(f('sub', '7 - 5').flags, { OF: 0, SF: 0, ZF: 0, CF: 0 });
  assert.deepEqual(f('sub', '0x80 - 1').flags, { OF: 1, SF: 0, ZF: 0, CF: 0 });
  assert.deepEqual(f('add', '0xFF + 1').flags, { OF: 0, SF: 0, ZF: 1, CF: 1 });
  assert.equal(f('sub', '5 - 7').R, 0xfen);
  const { input, r } = go(bitsEngine, { add: '-3 + 5', width: '4' });
  assert.equal(r.R, 2n);
  for (const s of r.steps) assert.match(bitsEngine.view(s.view, input), /co-add/);
  assert.throws(() => bitsEngine.parse({ add: '1 * 2' }), /写成/);
});

test('Cache：直接映射、组相联、全相联（LRU）；按地址拆标记 | 组号 | 块内地址', () => {
  const B = '0 4 8 2 0 6 8 6 4 8';
  assert.equal(go(cacheEngine, { lines: '4', blocks: B }).r.hits, 1);
  assert.equal(go(cacheEngine, { lines: '4', ways: '2', blocks: B }).r.hits, 1);
  assert.equal(go(cacheEngine, { lines: '4', ways: 'full', blocks: B }).r.hits, 4);
  assert.equal(go(cacheEngine, { lines: '4', ways: 'full', blocks: B, replace: 'fifo' }).r.hits, 5);
  const a = go(cacheEngine, { lines: '8', ways: '2', block: '16B', addr: '16', refs: '0x0010, 0x0124, 0x0010' });
  assert.equal(a.r.hits, 1);
  assert.deepEqual(a.r.steps.filter((s) => s.ask?.tag === 'set').map((s) => s.ask.answer), [1, 2, 1]);
  for (const s of a.r.steps) assert.match(cacheEngine.view(s.view, a.input), /co-cache/);
  assert.throws(() => cacheEngine.parse({ lines: '6', blocks: B }), /2 的整数次幂/);
  assert.throws(() => cacheEngine.parse({ lines: '4', ways: '3', blocks: B }), /ways/);
});

test('流水线：数据相关的阻塞（没有转发 / 有转发 / load-use）', () => {
  const code = 'add r1, r2, r3\nsub r4, r1, r5\nand r6, r1, r7\nor r8, r2, r9';
  const p = (extra) => go(pipeEngine, { instrs: code, ...extra }).r;
  assert.equal(p({}).total, 10);
  assert.deepEqual(p({}).sched.map((s) => s.stall), [0, 2, 0, 0]);
  assert.equal(p({ split: 'no' }).total, 11);
  assert.equal(p({ forward: 'yes' }).total, 8);
  const lu = go(pipeEngine, { instrs: 'lw r1, 0(r2); add r3, r1, r4', forward: 'yes' });
  assert.deepEqual(lu.r.sched.map((s) => s.stall), [0, 1]);
  assert.equal(pipeEngine.quiz(lu.input, lu.r).answer, '7');
  for (const s of lu.r.steps) assert.match(pipeEngine.view(s.view, lu.input), /co-pipe/);
  // sw、beq 不写寄存器
  assert.deepEqual(go(pipeEngine, { instrs: 'sw r1, 0(r2)\nadd r3, r1, r4' }).r.sched.map((s) => s.stall), [0, 0]);
});

test('IEEE 754 的常见错法：编码把隐藏的 1 写进尾数；解码阶码减 128、没补隐藏的 1', () => {
  // 编码 −0.75 = −1.1B × 2^−1：尾数写成 1100…（带上了隐藏的 1）就是 BF600000
  const e = go(bitsEngine, { float: '-0.75' });
  const hidden = pick(bitsEngine, e.input, /隐藏的 1 也写进去了/);
  assert.equal(quizDiag(bitsEngine, e.input, '0xBF600000'), hidden.label);
  assert.equal(quizDiag(bitsEngine, e.input, '0xBF400000'), '');
  assert.equal(fillDiag(bitsEngine, e.input, fillAs(bitsEngine, hidden.input)), hidden.label);
  assert.equal(fillDiag(bitsEngine, e.input, fillAs(bitsEngine, e.input)), '');
  // 先猜的十六进制、阶码（bin / hex 的问题）：学生写的位串也认得出错法
  assert.equal(askDiag(bitsEngine, e.input, askOf(e.r, 'hex'), 'BF60 0000H'), hidden.label);
  assert.equal(askDiag(bitsEngine, e.input, askOf(e.r, 'exp'), '01111111'), pick(bitsEngine, e.input, /偏置用了 128/).label);
  assert.equal(askDiag(bitsEngine, e.input, askOf(e.r, 'hex'), 'BF400000H'), '');
  // 解码 0xC0A00000 = −1.25 × 2^2 = −5：减 128 得 −2.5，不补 1 得 −0.25 × 4 = −1
  const d = go(bitsEngine, { float: '0xC0A00000' });
  const b128 = pick(bitsEngine, d.input, /阶码减了 128/), noOne = pick(bitsEngine, d.input, /没补隐藏的 1/);
  const val = askOf(d.r, 'value');
  assert.equal(askDiag(bitsEngine, d.input, val, '-2.5'), b128.label);
  assert.equal(askDiag(bitsEngine, d.input, val, '-5/2'), b128.label, '写成分数也认得出');
  assert.equal(askDiag(bitsEngine, d.input, val, '-1'), noOne.label);
  assert.equal(askDiag(bitsEngine, d.input, val, '-5'), '');
  assert.equal(quizDiag(bitsEngine, d.input, '-2.5'), b128.label);
  assert.equal(quizDiag(bitsEngine, d.input, '-1'), noOne.label);
  assert.equal(quizDiag(bitsEngine, d.input, '-5'), '');
  // 特殊值（阶码全 1）没有这些错法
  assert.deepEqual(bitsEngine.variants(go(bitsEngine, { float: '0x7F800000' }).input, {}), []);
});

test('数的表示、补码加减的常见错法：正数也取反；SF 按真实结果的正负写', () => {
  // +5：正数的反码、补码和原码一样；也按负数那样取反就是 01111010、01111011
  const p = go(bitsEngine, { num: '5' });
  const flip = pick(bitsEngine, p.input, /正数也按位取反/);
  assert.equal(askDiag(bitsEngine, p.input, askOf(p.r, 'twos'), '0111 1011'), flip.label);
  assert.equal(askDiag(bitsEngine, p.input, askOf(p.r, 'twos'), '0000 0101'), '');
  assert.equal(fillDiag(bitsEngine, p.input, fillAs(bitsEngine, flip.input)), flip.label);
  assert.ok(!bitsEngine.variants(p.input, {}).some((v) => /补码忘了 \+1/.test(v.label)), '正数没有「忘了 +1」');
  // 原有的错法在先猜里也认得出（位串写法放进了 alts）
  const n = go(bitsEngine, { num: '-5' });
  assert.equal(askDiag(bitsEngine, n.input, askOf(n.r, 'twos'), '1111 1010'), '像是负数的补码忘了 +1（写成了反码）');
  // 0x7F + 1 溢出：结果最高位是 1，SF = 1；按真实结果 128 是正数写 SF = 0 就是这种错法
  const a = go(bitsEngine, { add: '0x7F + 0x01' });
  const sf = pick(bitsEngine, a.input, /SF 按真实结果/);
  assert.equal(askDiag(bitsEngine, a.input, askOf(a.r, 'sf'), '0'), sf.label);
  assert.equal(askDiag(bitsEngine, a.input, askOf(a.r, 'sf'), '1'), '');
  assert.equal(fillDiag(bitsEngine, a.input, fillAs(bitsEngine, sf.input)), sf.label);
  assert.equal(fillDiag(bitsEngine, a.input, fillAs(bitsEngine, a.input)), '');
  // 没进位也没溢出：标志位怎么错都和对的一样，一种错法都不列
  assert.deepEqual(bitsEngine.variants(go(bitsEngine, { add: '3 + 4' }).input, {}), []);
});

test('流水线的常见错法：有转发时以为 load-use 也不用停', () => {
  const lu = go(pipeEngine, { instrs: 'lw r1, 0(r2); add r3, r1, r4', forward: 'yes' });
  const free = pick(pipeEngine, lu.input, /load-use/);
  assert.equal(quizDiag(pipeEngine, lu.input, '6'), free.label);
  assert.equal(quizDiag(pipeEngine, lu.input, '8'), '像是按没有转发算的');
  assert.equal(quizDiag(pipeEngine, lu.input, '7'), '');
  const stall = lu.r.steps.filter((s) => s.ask?.tag === 'stall')[1].ask;
  assert.equal(askDiag(pipeEngine, lu.input, stall, '0'), free.label);
  assert.equal(fillDiag(pipeEngine, lu.input, fillAs(pipeEngine, free.input)), free.label);
  // 没有 load 的相关：这种错法和对的一样，不列
  assert.ok(!pipeEngine.variants(go(pipeEngine, { instrs: 'add r1, r2, r3\nsub r4, r1, r5', forward: 'yes' }).input, {}).some((v) => /load-use/.test(v.label)));
});
