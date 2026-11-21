// 视觉交互第 6 批 Task 3：线代的几处毛病，一条一个能重现的测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { elimEngine } from '../kit/src/engines/elim.js';
import { detEngine } from '../kit/src/engines/det.js';
import { eigEngine } from '../kit/src/engines/eig.js';
import { quadEngine } from '../kit/src/engines/quad.js';

const T = (t) => `<T>${t}</T>`;

test('mode: quiz 的题图用外壳给的公式画法（以前直接写出 a_{1}、\\frac 这些原文）', () => {
  const cases = [
    [elimEngine, { vectors: 'a1 = (1, -1, 2), a2 = (0, 3, 1), a3 = (1, 2, 3)' }, /<T>a_\{1\}<\/T>/],
    [detEngine, { matrix: '[[1/2, 1], [1, 3]]' }, /<T>\\t?frac\{1\}\{2\}<\/T>/],
    [eigEngine, { matrix: '[[2, 1], [1, 2]]' }, /<T>/],
    [quadEngine, { matrix: '[[1, 1], [1, 2]]' }, /<T>/],
  ];
  for (const [E, f, re] of cases) {
    const input = E.parse(f), r = E.run(input);
    const q = E.quiz(input, r, f, { tex: T });
    assert.match(q.qhtml, re, E.name);
  }
});

test('det 按行展开一步算到底：最后一步写 D = 值，不再画 D = −3|1|', () => {
  const input = detEngine.parse({ matrix: '[[1, 2, 3], [4, 5, 6], [7, 8, 10]]', ops: 'expand r1' });
  const r = detEngine.run(input);
  const html = detEngine.view(r.steps.at(-1).view, input, { tex: T });
  assert.doesNotMatch(html, /mx-det/, '没有一阶的竖线框');
  assert.match(html, /<T>D = -3<\/T>/);
});

test('老组件 vectors：vectors: [[2, 1], [-1, 2]] 读成 u、v 两个向量（以前当成一个「向量」画出来是空的）；不是数的报错', async () => {
  const { vectorsOf } = await import('../kit/src/linalg.js');
  assert.deepEqual(vectorsOf({ vectors: '[[2, 1], [-1, 2]]', target: '[3, 4]', mode: 'combo' }), { names: ['u', 'v'], vecs: [[2, 1], [-1, 2]] });
  assert.deepEqual(vectorsOf({ u: '[2, 1]', w: '[0, 3]' }), { names: ['u', 'w'], vecs: [[2, 1], [0, 3]] });
  assert.throws(() => vectorsOf({ u: '[[1, 2], [3, 4]]' }), /二维向量/);
  assert.throws(() => vectorsOf({ mode: 'sum' }), /至少写一个向量/);
});
