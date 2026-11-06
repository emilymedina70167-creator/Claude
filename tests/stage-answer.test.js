// 舞台 ask value 的判答案（kit/src/stage/answer.js）：type= 接现成的判法，answer 可以是 {式子}、可以不写，常见错答只给老师
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../kit/src/stage/scene.js';
import { parseScript } from '../kit/src/stage/script.js';
import { judgeAnswer } from '../kit/src/stage/answer.js';
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
  assert.throws(() => judgeAnswer('2^n', { type: 'formula', answer: '2^n' }), /free=/);
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
