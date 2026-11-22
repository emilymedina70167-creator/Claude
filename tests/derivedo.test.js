// derive 的学生版（mode: do）：学生一行行往下写，页面逐行判
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseDeriveDo, sampleEnvs, checkLine, valueText } = await import('../kit/src/derivedo.js');
const { actionText } = await import('../kit/src/class/prompt.js');

const SRC = "id: dd-1\nmode: do\ntitle: 推 A²\nvars: a=vec(3) b=vec(3)\nlet A = a*b'\nstart: A^2\ngoal: tr(A)*A";

test('parseDeriveDo：字段、随机量、let；写错了说清楚', () => {
  const s = parseDeriveDo(SRC);
  assert.equal(s.start, 'A^2');
  assert.equal(s.goal, 'tr(A)*A');
  assert.deepEqual(s.vars.map(([n]) => n), ['a', 'b']);
  assert.equal(s.samples, 4);
  assert.throws(() => parseDeriveDo('mode: do\ngoal: x'), /start:/);
  assert.throws(() => parseDeriveDo('mode: do\nstart: x\nvars: a=vector(3)'), /vec\(3\)/);
  assert.throws(() => parseDeriveDo('mode: do\nstart: x\n随便一行'), /看不懂这一行/);
});

test('checkLine：相等的往下走；不等的说出取哪组数两边各等于什么；形状不同直接说；推到 goal 就完成', () => {
  const s = parseDeriveDo(SRC);
  const envs = sampleEnvs(s, { seed: 'dd-1' });
  assert.equal(envs.length, 4);
  assert.deepEqual(sampleEnvs(s, { seed: 'dd-1' }), envs, '同一道题每次取的数一样');
  assert.ok(checkLine(s, envs, 'A^2', "(ab')(ab')").ok);
  assert.ok(checkLine(s, envs, "(ab')(ab')", "a(b'a)b'").ok);
  assert.ok(checkLine(s, envs, "a(b'a)b'", "(b'a)ab'").ok, '1×1 当一个数往外提');
  assert.ok(checkLine(s, envs, "a(b'a)b'", 'αβᵀαβᵀ').ok, '写 α β 也认');
  const done = checkLine(s, envs, "(b'a)ab'", 'tr(A)A');
  assert.ok(done.ok && done.done);
  assert.ok(!checkLine(s, envs, "(b'a)ab'", "(b'a)A").done, '相等但还没写成 goal 的样子');
  const bad = checkLine(s, envs, 'A^2', 'A');
  assert.equal(bad.ok, false);
  assert.match(bad.why, /^取 a=\(.*\)ᵀ，b=\(.*\)ᵀ 时上一行等于 \[\[/);
  assert.match(checkLine(s, envs, 'A^2', "b'a").why, /上一行是3×3 矩阵，这一行是一个数/);
  assert.match(checkLine(s, envs, 'A^2', 'A^^').error, /./);
  assert.equal(valueText([[1, 2], [3, 4]]), '[[1, 2], [3, 4]]');
});

test('只比一组数时用 let 和整节课的量；课堂记录写清第几行、两边各等于什么', () => {
  const s = parseDeriveDo('mode: do\nstart: A*A');
  const envs = sampleEnvs(s, { base: { A: [[1, 1], [2, 2]] } });
  assert.equal(envs.length, 1);
  assert.ok(checkLine(s, envs, 'A*A', '3A').ok);
  const t = actionText({ source: 'record', type: 'derive', block: 'dd-1', step: 'b3', detail: '第 3 行', value: 'A', ok: false, attempts: 2, check: '上一行等于 5，这一行等于 4' });
  assert.match(t, /b3 里的 derive dd-1：第 3 行写了 A（和上一行不相等：上一行等于 5，这一行等于 4），这一行第 2 次/);
  assert.match(actionText({ source: 'record', type: 'derive', block: 'dd-1', final: true, ok: true, attempts: 4, value: "a(b'a)b' = tr(A)A" }), /推完了/);
});

// dr-batch4 第 3 条：derive 认单位阵 E（阶数照 vars 里的方阵），E(n) 阶数对得上才认
import { parseDeriveDo as pdd, sampleEnvs as se, checkLine as cl } from '../kit/src/derivedo.js';
test('derive 认 E、E(2)', () => {
  const sp = pdd('mode: do\nvars: A=mat(2,2)\nstart: (A-E)^2\ngoal: A^2-2A+E');
  const envs = se(sp);
  assert.equal(cl(sp, envs, '(A-E)^2', 'A^2-2A+E').ok, true);
  assert.equal(cl(sp, envs, '(A-E)^2', 'A^2-2A+E(2)').ok, true);
  assert.match(cl(sp, envs, '(A-E)^2', 'A^2-2A+E(3)').error, /阶数不一样/);
  assert.equal(cl(sp, envs, '(A-E)^2', 'A^2-2A+1').ok, false);
  const sp2 = pdd('mode: do\nlet A = [[1,2],[3,4]]\nstart: A*E');
  assert.equal(cl(sp2, se(sp2), 'A*E', 'A').ok, true);
});
