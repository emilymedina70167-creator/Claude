// 舞台 ask value 的判答案（kit/src/stage/answer.js）：type= 接现成的判法，answer 可以是 {式子}、可以不写，常见错答只给老师
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { judgeAnswer, checkSpec } from '../kit/src/stage/answer.js';
import { sameAnswer } from '../kit/src/stage/stage.js';
import { actText } from '../kit/src/stage/stage.js';

const run = (scene, src) => { for (const c of parseScript(src)) scene.apply(c); return scene; };

test('分数：0.5 和 1/2 一样', () => {
  assert.equal(judgeAnswer('0.5', { type: 'num', answer: '1/2' }).ok, true);
  assert.equal(judgeAnswer('1/3', { type: 'num', answer: '1/2' }).ok, false);
});

test('式子：2^n 对，2n 不对', () => {
  const spec = { type: 'formula', answer: '2^n', free: 'n' };
  assert.equal(judgeAnswer('2^n', spec).ok, true);
  assert.equal(judgeAnswer('2n', spec).ok, false);
  // 没写 free=：写下这一行时当场报；万一到了判的时候才发现，页面没判成（ok 是 null），不当学生答错
  assert.throws(() => checkSpec({ type: 'formula', answer: '2^n' }), /free=/);
  const r = judgeAnswer('2^n', { type: 'formula', answer: '2^n' });
  assert.equal(r.ok, null);
  assert.match(r.failed, /页面没判成.*free=/);
});

test('矩阵：一格不一样就不对', () => {
  const spec = { type: 'matrix', answer: '1 2 / 3 4' };
  assert.equal(judgeAnswer('1 2 / 3 4', spec).ok, true);
  assert.equal(judgeAnswer('1 2 / 3 5', spec).ok, false);
});

test('{A^2}：答案照舞台现在的矩阵现算', () => {
  const sc = run(new Scene(), 'matrix A = 1 1 / 0 1');
  const spec = { type: 'matrix', answer: '{A^2}' };
  const r = judgeAnswer('1 2 / 0 1', spec, sc);
  assert.equal(r.ok, true);
  assert.equal(r.shown, '1 2 / 0 1');
  assert.equal(judgeAnswer('1 1 / 0 1', spec, sc).ok, false);
});

test('没写 answer：只收不判', () => {
  assert.equal(judgeAnswer('随便', {}).ok, null);
  assert.equal(judgeAnswer('随便', { type: 'num' }).ok, null);
});

test('常见错答：不对，misread 是说明；对上的不带 misread，没对上的也没有', () => {
  const spec = { type: 'num', answer: '2', wrongs: '3=漏了 E; 0=当成数 0' };
  const r = judgeAnswer('3', spec);
  assert.equal(r.ok, false);
  assert.equal(r.misread, '漏了 E');
  assert.equal(judgeAnswer('0', spec).misread, '当成数 0');
  assert.equal(judgeAnswer('5', spec).misread, null);
  assert.equal(judgeAnswer('2', spec).misread, null);
});

test('别的 type：数集、方程、序列、英文', () => {
  assert.equal(judgeAnswer('x>1', { type: 'set', answer: '(1, +∞)' }).ok, true);
  assert.equal(judgeAnswer('x=2', { type: 'equation', answer: 'x = 2' }).ok, true);
  assert.equal(judgeAnswer('A C B', { type: 'seq', answer: 'A C B' }).ok, true);
  assert.equal(judgeAnswer('B A C', { type: 'seq', answer: 'A C B' }).ok, false);
  assert.equal(judgeAnswer('Had Started', { type: 'en', answer: 'had started' }).ok, true);
});

test('不认得的 type：报错并列出能写的', () => {
  assert.throws(() => judgeAnswer('1', { type: 'foo', answer: '1' }), /num formula matrix set equation seq en/);
});

test('ask value 不写 answer 不再报错；写错 type 当场报', () => {
  const sc = run(new Scene(), 'matrix A = 1 1 / 0 1');
  assert.doesNotThrow(() => sc.apply(parseScript('ask value "猜一个"')[0]));
  const s2 = new Scene();
  assert.match(s2.check(parseScript('ask value "?" answer=2 type=foo')[0]), /num formula matrix/);
  assert.doesNotThrow(() => sc.apply(parseScript('ask value "A 的平方" answer={A^2} type=matrix wrong="1 1 / 0 1=忘了乘"')[0]));
  assert.equal(sc.waiting.type, 'matrix');
});

test('actText：只收不判、错答说明只进给老师的话', () => {
  assert.match(actText({ type: 'value', text: '7', answer: '', right: null, misread: null }), /学生填了「7」（这一问只收不判）/);
  const t = actText({ type: 'value', text: '3', answer: '2', right: false, misread: '漏了 E' });
  assert.match(t, /填错了/);
  assert.match(t, /漏了 E/);
});

test('旧写法（没写 type）：答案不是数、填法带空格，对错和 sameAnswer 一样', () => {
  const pairs = [['1, 2', '1,2'], ['(1,2)', '(1, 2)'], ['x = 2', 'x=2'], ['A B', 'AB'], ['x^2', 'x ^ 2'], ['x+1', 'x + 1'], ['X+1', 'x + 1'], ['x+1', 'x+2'], ['0.50', '1/2']];
  for (const [given, answer] of pairs) {
    assert.equal(judgeAnswer(given, { answer }).ok, sameAnswer(given, answer), `${given} / ${answer}`);
    assert.equal(judgeAnswer(answer, { answer: given }).ok, sameAnswer(answer, given), `${answer} / ${given}`);
  }
  assert.equal(judgeAnswer('1, 2', { answer: '1,2' }).ok, true);
});

// —— 整条分支的最终审查（C1、I1、M3）——

test('C1 矩阵里的分数：1/3 是一格，行按「 / 」、; 、换行分（和造矩阵的写法一样）', () => {
  const sc = run(new Scene(), 'dial k = 3 range=1..5\nmatrix P = 1 0 / 0 {k}');
  const spec = { type: 'matrix', answer: '{P^-1}' };
  const r = judgeAnswer('1 0 / 0 1/3', spec, sc);
  assert.equal(r.ok, true);
  assert.equal(r.shown, '1 0 / 0 1/3');
  assert.equal(judgeAnswer('1 0; 0 1/3', spec, sc).ok, true);
  assert.equal(judgeAnswer('1 0\n0 1/3', spec, sc).ok, true);
  assert.equal(judgeAnswer('1 0 / 0 1/2', spec, sc).ok, false);
  // 字面写的答案也一样（以前是当场报「每一行的格数要一样」，写不了）
  const lit = { type: 'matrix', answer: '1 0 / 0 -1/3' };
  assert.equal(judgeAnswer('1 0 / 0 -1/3', lit).ok, true);
  // 斜线只贴着一边（2/ 3）和造矩阵时一样当分行
  assert.equal(judgeAnswer('1 0/ 0 -1/3', lit).ok, true);
});

test('C1 学生写的矩阵页面读不懂（2/0）：判不对，告诉老师是写法读不懂；1/3 读成分数格数对不上也说一声', () => {
  const spec = { type: 'matrix', answer: '1 2 / 0 1' };
  const a = judgeAnswer('1 2/0 1', spec);
  assert.equal(a.ok, false);
  assert.match(a.misread, /读不懂/);
  assert.match(a.misread, /2\/0/);
  const b = judgeAnswer('1 2/3 4', { type: 'matrix', answer: '1 2 / 3 4' });
  assert.equal(b.ok, false);
  assert.match(b.misread, /2\/3.*分数/);
});

test('I1 {式子} 答案写下时就照 type 验一遍：和 type 对不上当场报', () => {
  const sc = run(new Scene(), 'dial k = 3 range=1..5\nmatrix A = 1 1 / 0 1');
  assert.match(sc.check(parseScript('ask value "k 是几" type=formula answer={k}')[0]) || '', /free=/);
  assert.match(sc.check(parseScript('ask value "A²" type=num answer={A^2}')[0]) || '', /type=num/);
  assert.match(sc.check(parseScript('ask value "A²" type=equation answer={A^2}')[0]) || '', /type=equation/);
  assert.equal(sc.check(parseScript('ask value "A²" type=matrix answer={A^2}')[0]), null);
  assert.equal(sc.check(parseScript('ask value "k" type=num answer={k}')[0]), null);
});

test('I1 判的时候算不出来（学生把 P 拨成不可逆）：ok 是 null，告诉老师「页面没判成」，不当学生答错', () => {
  const sc = run(new Scene(), 'dial k = 3 range=0..5\nmatrix P = 1 0 / 0 {k}');
  const spec = { type: 'matrix', answer: '{P^-1}' };
  run(sc, 'set k 0');
  const r = judgeAnswer('1 0 / 0 1', spec, sc);
  assert.equal(r.ok, null);
  assert.ok(r.failed, '带着出错的原因（stage.js 记进出错记录）');
  const t = actText({ type: 'value', text: '1 0 / 0 1', answer: r.shown, right: r.ok, misread: r.misread, failed: r.failed });
  assert.match(t, /页面没判成/);
  assert.doesNotMatch(t, /填错了|只收不判/);
});

test('M3 wrong= 每条照 type 验：方程的错答带 =、矩阵的错答用 ; 分行都当场报或者对得上', () => {
  // 方程：错答本身带 =，照 type 找到能读成方程的那一处切开
  const eq = { type: 'equation', answer: 'x + y = 3', wrongs: 'x + y = 5=把常数抄错了' };
  assert.doesNotThrow(() => checkSpec(eq));
  const r = judgeAnswer('x + y = 5', eq);
  assert.equal(r.ok, false);
  assert.equal(r.misread, '把常数抄错了');
  // 矩阵：错答里用 ; 分行（; 是隔开几条错答的）：拆出来的格数和答案对不上，当场报
  assert.throws(() => checkSpec({ type: 'matrix', answer: '1 2 / 3 4', wrongs: '1 2; 3 5=抄错了' }), /wrong=.*「 \/ 」/);
  // 错答照 type 读不成（type=num 写了一个矩阵）当场报
  assert.throws(() => checkSpec({ type: 'num', answer: '2', wrongs: '1 2 / 3 4=写成矩阵了' }), /wrong=/);
  // {式子} 的错答在舞台上照 type 验
  const sc = run(new Scene(), 'matrix A = 1 1 / 0 1');
  assert.equal(sc.check(parseScript('ask value "A²" type=matrix answer={A^2} wrong="{A}=只乘了一次"')[0]), null);
  assert.equal(judgeAnswer('1 1 / 0 1', { type: 'matrix', answer: '{A^2}', wrongs: '{A}=只乘了一次' }, sc).misread, '只乘了一次');
});
