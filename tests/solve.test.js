// 解答题按步骤判（dr-batch4 第 1 条）：写法、判定、汇总（solvespec.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSolve, parseJudge, allRight, judgedLine, errorOfJudged, submittedLine } from '../kit/src/solvespec.js';
import { blockCommand } from '../kit/src/class/protocol.js';

const SRC = `id: p1
title: 求 A^n
q: 设 $A=E+B$，求 $A^n$。
steps:
s1 setup: 写成 A = E + B
s2 rule: B² = O，E 和 B 可交换，用二项式定理
s3 calc: A^n = E + nB
s4 conclude: A^n = [[1,n],[0,1]]`;

test('读写法：参考步骤、judge 的默认', () => {
  const r = parseSolve(SRC, { ext: true });
  assert.deepEqual(r.problems, []);
  assert.equal(r.steps.length, 4);
  assert.deepEqual(r.steps[1], { id: 's2', kind: 'rule', text: 'B² = O，E 和 B 可交换，用二项式定理' });
  assert.equal(r.judge, 'ext');
  assert.equal(parseSolve(SRC).judge, 'claude');
  const j = parseSolve('q: 题\nsteps: [{"id":"a","kind":"calc","text":"算"}]');
  assert.equal(j.steps[0].id, 'a');
  assert.match(parseSolve('q: 题\nsteps:\ns1 guess: 猜').problems.join(), /看不懂|kind/);
  assert.match(parseSolve('steps:\ns1 calc: x').problems.join(), /q:/);
  assert.match(parseSolve(`${SRC}\njudge: maybe`).problems.join(), /judge/);
});

test('读判定：一行一步，没判的记成没判', () => {
  const { steps } = parseSolve(SRC);
  const r = parseJudge('s1 ok\ns2 ok\ns3 wrong tag=规则用错 why="把 (E+B)^n 写成 E^n+B^n"\ns4 missing', steps);
  assert.deepEqual(r.errors, []);
  assert.equal(r.steps[2].ok, false);
  assert.equal(r.steps[2].tag, '规则用错');
  assert.equal(r.steps[3].ok, 'missing');
  assert.equal(r.steps[3].tag, '步骤缺');
  assert.equal(allRight(r.steps), false);
  assert.match(judgedLine(r.steps), /^第 3 步 规则用错：把 \(E\+B\)\^n 写成 E\^n\+B\^n；第 4 步 缺$/);
  const e = errorOfJudged(r.steps, steps);
  assert.match(e.step, /^第 3 步（规则用错）：应为「A\^n = E \+ nB」/);
  assert.equal(e.tag, '规则用错');
  const part = parseJudge('s1 ok', steps);
  assert.equal(part.steps[1].ok, null);
  assert.match(part.notes.join(), /没判的步：s2、s3、s4/);
  assert.match(parseJudge('s9 ok', steps).errors.join(), /没有 s9/);
  assert.match(parseJudge('s3 wrong tag=瞎写', steps).notes.join(), /不在常用/);
  assert.equal(allRight(parseJudge('s1 ok\ns2 ok\ns3 对\ns4 ✓', steps).steps), true);
  assert.equal(errorOfJudged(parseJudge('s1 ok\ns2 ok\ns3 ok\ns4 ok', steps).steps, steps), null);
  assert.match(submittedLine({ text: '一\n二', images: ['a1', 'a2'] }), /^打字：一 二；照片 2 张（a1、a2）$/);
});

test('board judge / unqueue 指令', () => {
  const j = blockCommand('judge target=p1', 's1 ok\ns3 wrong tag=计算');
  assert.equal(j.op, 'judge');
  assert.equal(j.target, 'p1');
  assert.match(j.body, /s3 wrong/);
  assert.ok(blockCommand('judge target=p1', '').error);
  assert.ok(blockCommand('judge', 'x').error);
  assert.deepEqual(blockCommand('unqueue id=b9', ''), { op: 'unqueue', id: 'b9' });
});

// 外部审 plan 时加的：拿不准的步 unsure → 待核，ok 记 null、不进错题本
test('unsure：待核', () => {
  const { steps } = parseSolve(SRC);
  const r = parseJudge('s1 ok\ns2 unsure why="照片里看不清"\ns3 ok\ns4 ok', steps);
  assert.deepEqual(r.steps[1], { id: 's2', ok: null, unsure: true, why: '照片里看不清', tag: '' });
  assert.equal(allRight(r.steps), false);
  assert.equal(judgedLine(r.steps), '第 2 步 待核：照片里看不清');
  assert.equal(errorOfJudged(r.steps, steps), null);
  const r2 = parseJudge('s1 ok\ns2 unsure\ns3 wrong tag=计算\ns4 ok', steps);
  assert.match(errorOfJudged(r2.steps, steps).step, /^第 3 步（计算）/);
});
