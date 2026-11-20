// dr-final-fix 第 1 条：学生写 ∞（inf、1/0、10^400、1e999），任何数值答案都判对——几处「差不多相等」有一边是 Infinity 时
// 容差也是 Infinity。规矩：有一边不是有限数就不相等（NaN 也一样）；只有 calc: limit / derive 极限按种类比 ∞ 的那条路认 ∞
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFormula, compareFormula, formulaSpec } from '../kit/src/formula.js';
import { parseDeriveDo, sampleEnvs, checkLine } from '../kit/src/derivedo.js';
import { parseConditions, checkConditions } from '../kit/src/anscheck.js';
import { parseProbe } from '../kit/src/check/spec.js';
import { judgeMachine, notReady } from '../kit/src/check/judge.js';
import { numMatch, sameResult } from '../kit/src/check/values.js';
import { Q } from '../kit/src/exact.js';

const P = (type, src) => { const r = parseProbe(type, src); if (r.error) throw new Error(r.error); return r.probe; };
const item = (r, id) => r.items.find((x) => x.id === id);

test('answer 1/2 + formula: -：写 ∞、1/0、10^400 判错，写 1/2 照旧对', () => {
  const f = formulaSpec('1/2', '-', {});
  const read = (x) => normalizeFormula(x, { names: f.names });
  assert.equal(compareFormula(f.expected, read('1/2'), f).ok, true);
  for (const g of ['∞', 'inf', '1/0', '10^400', '-∞']) assert.equal(compareFormula(f.expected, read(g), f).ok, false, g);
});

test('answer 3^(n-1)*A + formula: n（线代）：写 ∞ 判错', () => {
  const A = [[Q.int(1), Q.int(1)], [Q.int(2), Q.int(2)]];
  const f = formulaSpec('3^(n-1)*A', 'n', { A });
  const read = (x) => normalizeFormula(x, { names: ['n', 'A'] });
  assert.equal(compareFormula(f.expected, read('3^(n-1)A'), f).ok, true);
  for (const g of ['∞', 'inf', '∞A', 'inf*A']) assert.equal(compareFormula(f.expected, read(g), f).ok, false, g);
});

test('derive（线代）：inf*A、1/0*A 不等于上一行', () => {
  const s = parseDeriveDo('mode: do\nvars: A=mat(2,2)\nstart: 2*A\ngoal: A+A');
  const envs = sampleEnvs(s, { seed: 'inf' });
  assert.equal(checkLine(s, envs, '2*A', 'A+A').ok, true);
  for (const g of ['inf*A', '1/0*A', '∞A']) assert.notEqual(checkLine(s, envs, '2*A', g).ok, true, g);
});

test('answer 的 check: 条件：ans 是 Infinity 不满足 ==', () => {
  const c = parseConditions('ans == 2');
  assert.equal(checkConditions(c, 2, {}).ok, true);
  assert.equal(checkConditions(c, Infinity, {}).ok, false);
  assert.equal(checkConditions(c, NaN, {}).ok, false);
});

test('检验 discriminate 的 result: 6：写 ∞、-∞、1/0、10^400 判错', () => {
  const d = P('discriminate', 'id: q\nq: 能不能用\ncan: 能\ntarget: x\nlevel: 核心\nmust m1: 理由\nresult: 6');
  assert.equal(item(judgeMachine(d, { can: true, text: '…', result: '6' }), 'result').ok, true);
  for (const g of ['∞', '-∞', '1/0', '10^400', 'inf']) assert.notEqual(item(judgeMachine(d, { can: true, text: '…', result: g }), 'result').ok, true, g);
});

test('检验 locate 的 fix: 3：写 ∞ 判错', () => {
  const p = P('locate', 'id: q\nq: 错在哪\ntarget: x\nlevel: 方法\nline: 一\nline: 二\nbug: 2\nmust m1: 为什么\nfix: 3');
  assert.equal(item(judgeMachine(p, { line: 2, text: '…', fix: '3' }), 'fix').ok, true);
  for (const g of ['∞', '1/0', 'inf']) assert.notEqual(item(judgeMachine(p, { line: 2, text: '…', fix: g }), 'fix').ok, true, g);
});

test('检验 construct 的格子：1e999 算「写的不是数」，交之前就挡住', () => {
  const c = P('construct', 'id: q\nq: 题\ntarget: x\nlevel: 核心\nslots: A=mat(2)\nif: A != O\nexample: A=[[1,0],[0,0]]');
  const slots = { A: [['1e999', '0'], ['0', '0']] };
  assert.match(notReady(c, { slots }), /读不懂/);
  const r = judgeMachine(c, { slots });
  assert.ok(r.items.every((x) => x.ok !== true), JSON.stringify(r.items));
});

test('values.js：numMatch、sameResult 不把 ∞ 当成和数一样', () => {
  assert.equal(numMatch('6', Infinity), null);
  assert.equal(sameResult(Infinity, 6), false);
  assert.equal(sameResult(Infinity, Infinity), false);
  assert.equal(sameResult(6, 6), true);
});

test('calc: limit 那条路照旧按种类认 ∞', () => {
  const f = formulaSpec('inf', '', {}, { calc: 'limit of=1/x^2 at=0' });
  const read = (x) => normalizeFormula(x, { names: f.names, real: true });
  assert.equal(compareFormula(f.expected, read('∞'), f).ok, true);
  assert.equal(compareFormula(f.expected, read('+∞'), f).ok, true);
});
