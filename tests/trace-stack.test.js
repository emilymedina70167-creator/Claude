// 视觉交互第 6 批 Task 8：trace 的调用链画成一摞帧（栈顶在上），每帧写函数、参数、这一层的变量；返回时写返回值
import test from 'node:test';
import assert from 'node:assert/strict';
import { traceEngine as E, stackFrames } from '../kit/src/engines/trace.js';

const P = (call, code) => { const src = `${call ? `call: ${call}\n` : ''}code:\n${code}`; return E.parse({}, src); };
const FACT = `int fact(int n){
    if(n<=1) return 1;
    return n*fact(n-1);
}`;

test('递归：最深的那一步有四帧，栈顶是 fact(1)，下面依次 fact(2)、fact(3)、fact(4)', () => {
  const input = P('fact(4)', FACT);
  const r = E.run(input);
  const deepest = r.steps.map((s) => stackFrames(s.view)).reduce((a, b) => (b.length > a.length ? b : a), []);
  assert.equal(deepest.length, 4);
  assert.deepEqual(deepest.map((f) => f.label), ['fact(n = 1)', 'fact(n = 2)', 'fact(n = 3)', 'fact(n = 4)']);
  assert.equal(deepest[0].top, true);
  assert.ok(!deepest[1].vars.some((v) => /n = 2/.test(v)), '参数写在括号里，不再写一遍');
});

test('返回的那一步：栈顶那一帧写着返回值', () => {
  const r = E.run(P('fact(3)', FACT));
  const ret = r.steps.map((s) => stackFrames(s.view)).find((fs) => fs[0]?.ret === '1');
  assert.ok(ret, '有一步栈顶写着返回 1');
});

test('只有一层的时候照旧一行（老题的画面不变）', () => {
  const input = P('', 'int main(){ int a = 1; a = a + 1; return 0; }');
  const r = E.run(input);
  assert.ok(r.steps.every((s) => stackFrames(s.view).length <= 1));
  assert.doesNotMatch(E.view(r.steps[1].view, input), /tr-frames/);
  const fr = E.run(P('fact(3)', FACT));
  const deep = fr.steps.find((s) => stackFrames(s.view).length >= 2);
  assert.match(E.view(deep.view, P('fact(3)', FACT)), /tr-frames/);
});
