// 检验：页面机器判的那一半（kit/src/check/judge.js 的 judgeMachine、blankCells）
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProbe } from '../kit/src/check/spec.js';
import { judgeMachine, blankCells } from '../kit/src/check/judge.js';

const P = (type, src) => { const r = parseProbe(type, src); if (r.error) throw new Error(r.error); return r.probe; };
const HEAD = 'id: q\nq: 题\ntarget: x\nlevel: 核心\n';
const item = (r, id) => r.items.find((x) => x.id === id);

const construct = P('construct', `${HEAD}slots: A=mat(2) B=mat(2)
if: A*B != B*A => A、B 可交换了，题要的是不可交换
if: A != O => 零矩阵不算
expr 两边差: (A+B)*(A-B) - (A^2-B^2)
example: A=[[1,0],[0,0]] B=[[0,1],[0,0]]`);

test('construct：满足的每一条都是 ok', () => {
  const r = judgeMachine(construct, { slots: { A: [[1, 0], [0, 0]], B: [[0, 1], [0, 0]] }, exprs: { e1: 'B*A-A*B' } });
  assert.equal(item(r, 'if1').ok, true);
  assert.equal(item(r, 'if2').ok, true);
  assert.equal(item(r, 'e1').ok, true);
  assert.equal(r.needsClaude, false);
  assert.equal(r.stop, false);
});

test('construct：不满足的那一条用它自己的话，别的条也照样判（全部列出来）', () => {
  const E = [[1, 0], [0, 1]];
  const r = judgeMachine(construct, { slots: { A: E, B: E }, exprs: { e1: 'B*A-A*B' } });
  assert.equal(item(r, 'if1').ok, false);
  assert.equal(item(r, 'if1').why, 'A、B 可交换了，题要的是不可交换');
  assert.equal(item(r, 'if2').ok, true);
  const z = judgeMachine(construct, { slots: { A: [[0, 0], [0, 0]], B: E }, exprs: {} });
  assert.equal(item(z, 'if2').ok, false);
  assert.equal(item(z, 'if2').why, '零矩阵不算');
});

test('construct：格子里写的分数、根号照读', () => {
  const r = judgeMachine(construct, { slots: { A: [['1/2', '0'], ['0', '0']], B: [['0', '√2'], ['0', '0']] }, exprs: { e1: 'BA-AB' } });
  assert.equal(item(r, 'if1').ok, true);
  assert.equal(item(r, 'e1').ok, true);
});

test('expr：写 0 不对、读不懂的（转置）是 null', () => {
  const slots = { A: [[1, 0], [0, 0]], B: [[0, 1], [0, 0]] };
  assert.equal(item(judgeMachine(construct, { slots, exprs: { e1: '0' } }), 'e1').ok, false);
  assert.equal(item(judgeMachine(construct, { slots, exprs: { e1: "A'" } }), 'e1').ok, null);
  // 没写的：false（漏了）
  assert.equal(item(judgeMachine(construct, { slots, exprs: {} }), 'e1').ok, false);
});

const claimFalse = P('claim', `id: q\nclaim: 对称矩阵 A、B 有 (A+B)^2 = A^2+2AB+B^2\ntruth: 假\ntarget: x\nlevel: 核心
slots: A=mat(2) B=mat(2)
if: A == A' => A 不对称
if: B == B' => B 不对称
if: (A+B)^2 != A^2+2*A*B+B^2 => 两边相等了，不是反例
example: A=[[1,0],[0,0]] B=[[0,1],[1,0]]`);

test('claim：判错了真假只有 truth 一项、停下、不调 Claude', () => {
  const r = judgeMachine(claimFalse, { truth: true });
  assert.deepEqual(r.items.map((x) => x.id), ['truth']);
  assert.equal(item(r, 'truth').ok, false);
  assert.equal(r.stop, true);
  assert.equal(r.needsClaude, false);
});

test('claim：判假、反例满足 → 不调 Claude；反例不满足某一条', () => {
  const ok = judgeMachine(claimFalse, { truth: false, slots: { A: [[1, 0], [0, 0]], B: [[0, 1], [1, 0]] } });
  assert.ok(ok.items.every((x) => x.ok === true), JSON.stringify(ok.items));
  assert.equal(ok.needsClaude, false);
  const bad = judgeMachine(claimFalse, { truth: false, slots: { A: [[1, 2], [0, 0]], B: [[0, 1], [1, 0]] } });
  assert.equal(item(bad, 'if1').ok, false);
});

test('claim：判真、写要点 → 要 Claude 判', () => {
  const p = P('claim', 'id: q\nclaim: 命题\ntruth: 真\ntarget: x\nlevel: 核心\nmust m1: 要点');
  const r = judgeMachine(p, { truth: true, text: '因为……' });
  assert.equal(item(r, 'truth').ok, true);
  assert.equal(r.needsClaude, true);
});

test('claim：proof: derive 逐行核', () => {
  const p = P('claim', 'id: q\nclaim: (A+B)^2 = A^2+AB+BA+B^2\ntruth: 真\ntarget: x\nlevel: 核心\nproof: derive\nstart: (A+B)^2\ngoal: A^2+A*B+B*A+B^2\nvars: A=mat(2,2) B=mat(2,2)');
  const good = judgeMachine(p, { truth: true, proof: ['(A+B)(A+B)', 'A(A+B)+B(A+B)', 'A^2+AB+BA+B^2'] });
  assert.equal(item(good, 'proof').ok, true);
  assert.equal(good.needsClaude, false);
  const bad = judgeMachine(p, { truth: true, proof: ['(A+B)(A+B)', 'A^2+2AB+B^2'] });
  assert.equal(item(bad, 'proof').ok, false);
  assert.match(item(bad, 'proof').why, /上一行等于/);
  const short = judgeMachine(p, { truth: true, proof: ['(A+B)(A+B)'] });
  assert.equal(item(short, 'proof').ok, false);
  assert.match(item(short, 'proof').why, /没推到/);
});

const disc = P('discriminate', `id: q\nq: 能不能用\ncan: 能\ntarget: x\nlevel: 核心\nlet A = [[0,1],[0,0]]\nmust m1: E 和任何方阵可交换\nresult: E+5*A`);

test('discriminate：能不能判错 → 停下；判对、result 照省乘号的写法判', () => {
  const no = judgeMachine(disc, { can: false });
  assert.equal(no.stop, true);
  assert.equal(item(no, 'can').ok, false);
  const yes = judgeMachine(disc, { can: true, text: '……', result: 'E+5A' });
  assert.equal(item(yes, 'can').ok, true);
  assert.equal(item(yes, 'result').ok, true);
  assert.equal(yes.needsClaude, true);
  assert.equal(item(judgeMachine(disc, { can: true, text: '…', result: 'E+A' }), 'result').ok, false);
});

test('locate：点错了行 → 停下；点对了、fix 判', () => {
  const p = P('locate', 'id: q\nq: 错在哪\ntarget: x\nlevel: 方法\nline: 一\nline: 二\nline: 三\nbug: 2\nmust m1: 为什么\nfix: 4');
  const wrong = judgeMachine(p, { line: 3 });
  assert.equal(wrong.stop, true);
  assert.equal(item(wrong, 'line').ok, false);
  const right = judgeMachine(p, { line: 2, text: '…', fix: '2^2' });
  assert.equal(item(right, 'line').ok, true);
  assert.equal(item(right, 'fix').ok, true);
  assert.equal(right.needsClaude, true);
});

test('recall 全交给 Claude', () => {
  const p = P('recall', `${HEAD}must m1: 一`);
  const r = judgeMachine(p, { text: '……' });
  assert.deepEqual(r.items, []);
  assert.equal(r.needsClaude, true);
});

test('blankCells 数空的格', () => {
  assert.equal(blankCells([[1, ''], ['', 2]]), 2);
  assert.equal(blankCells([' ', 1, 2]), 1);
  assert.equal(blankCells(3), 0);
  assert.equal(blankCells(''), 1);
});

// 计划 3（dr-calc-base Task 8）：检验题的式子能写高数的函数式
test('discriminate 的 result、locate 的 fix、construct 的式子能写函数式', () => {
  const d = P('discriminate', 'id: q\nq: 能不能用\ncan: 能\ntarget: x\nlevel: 核心\nmust m1: 分部积分\nresult: x*e^x - e^x');
  assert.equal(item(judgeMachine(d, { can: true, result: '(x-1)e^x' }), 'result').ok, true);
  assert.equal(item(judgeMachine(d, { can: true, result: 'xe^x' }), 'result').ok, false);
  const l = P('locate', 'id: q\nq: 错在哪\ntarget: x\nlevel: 方法\nline: 一\nline: 二\nbug: 2\nmust m1: 为什么\nfix: 2*sin(x)*cos(x)');
  assert.equal(item(judgeMachine(l, { line: 2, fix: 'sin 2x' }), 'fix').ok, true);
  const c = P('construct', `${HEAD}slots: a=num\nif: a != 0 => 不能是 0\nexpr 化简: sin(2*x)\nexample: a=1`);
  assert.equal(item(judgeMachine(c, { slots: { a: '1' }, exprs: { e1: '2sinxcosx' } }), 'e1').ok, true);
});
test('线代的式子照旧走非交换的判法', () => {
  const r = judgeMachine(construct, { slots: { A: [[1, 0], [0, 0]], B: [[0, 1], [0, 0]] }, exprs: { e1: 'B*A-A*B' } });
  assert.equal(item(r, 'e1').ok, true);
});
