// 视觉交互第 4 批 Task 9：示例页和手册里概率的四个组件照抄就能用；概率的课拿得到它们的写法
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVenn } from '../kit/src/prob/vennspec.js';
import { parsePtree } from '../kit/src/prob/treespec.js';
import { parseJointBlock } from '../kit/src/prob/jointspec.js';
import { parseSim } from '../kit/src/prob/simspec.js';
import { docsForSubject, componentDoc } from '../kit/src/subject.js';

const PARSE = { venn: parseVenn, ptree: parsePtree, joint: parseJointBlock, sim: parseSim };
const manual = readFileSync('CLAUDE-PROJECT.md', 'utf8');
const third = manual.slice(manual.indexOf('## 三、组件参考'), manual.indexOf('\n## 四、'));
const blocksIn = (text) => [...text.matchAll(/```(venn|ptree|joint|sim)\n([\s\S]*?)```/g)].map((m) => ({ kind: m[1], src: m[2] }));
const demo = blocksIn(readFileSync('kit/examples/prob-demo.html', 'utf8'));
const inManual = blocksIn(third);
const count = (list, kind) => list.filter((b) => b.kind === kind).length;

test('示例页：至少 24 张，四个组件每个至少 5 张，每张都没有写法错误', () => {
  assert.ok(demo.length >= 24, `只有 ${demo.length} 张`);
  for (const k of Object.keys(PARSE)) assert.ok(count(demo, k) >= 5, `${k} 只有 ${count(demo, k)} 张`);
  demo.forEach((b, i) => assert.deepEqual(PARSE[b.kind](b.src).problems, [], `prob-demo 第 ${i + 1} 张（${b.kind}）`));
  const ids = demo.map((b) => /^id:\s*(\S+)/m.exec(b.src)?.[1]);
  assert.equal(new Set(ids).size, ids.length, '编号不重');
});

test('示例页里要学生动手的占多数：有 ask 的，或者有滑块、能拖、能抽的', () => {
  const asks = demo.filter((b) => /^ask:/m.test(b.src)).length;
  assert.ok(asks >= 14, `有 ask 的只有 ${asks} 张`);
  assert.ok(demo.filter((b) => b.kind === 'ptree' && /^drag:\s*on/m.test(b.src)).length >= 2);
  assert.ok(demo.filter((b) => b.kind === 'sim' && /^slider /m.test(b.src)).length >= 5);
});

test('示例页按考纲：第三节概率表里第 4 批要盖住的每一行都有图', () => {
  const has = (kind, re) => demo.some((b) => b.kind === kind && re.test(b.src));
  assert.ok(has('venn', /^ask: (?!P\()/m), '事件的关系和运算：点区域');
  assert.ok(has('venn', /^ask: .*P\(A \| B\)/m), '条件概率');
  assert.ok(has('ptree', /^ask: .*P\(A1 \| B\)/m), '全概率、贝叶斯');
  assert.ok(has('joint', /^ask: margins/m) && has('joint', /^ask: independent/m), '二维离散：边缘、独立');
  assert.ok(has('joint', /^z: /m), 'Z = g(X, Y) 的分布');
  assert.ok(has('joint', /^ask: Cov/m) && has('sim', /^view: scatter/m), '协方差、相关系数');
  assert.ok(has('sim', /^view: path/m) && has('sim', /band:/), '切比雪夫、大数定律');
  assert.ok(has('sim', /^stat: z/m), '中心极限定理');
  assert.ok(has('sim', /^stat: chi/m) && has('sim', /^stat: t$/m), '正态总体的抽样分布');
  assert.ok(has('sim', /^stat: S2/m) && has('sim', /^stat: var/m) && has('sim', /^stat: median/m), '无偏、有效');
  assert.ok(has('sim', /^view: intervals/m), '区间估计');
});

test('手册里四个组件各有照抄就能用的例子', () => {
  for (const k of Object.keys(PARSE)) assert.ok(count(inManual, k) >= 2, `手册里 ${k} 的例子只有 ${count(inManual, k)} 个`);
  inManual.forEach((b, i) => assert.deepEqual(PARSE[b.kind](b.src).problems, [], `手册第 ${i + 1} 个例子（${b.kind}）`));
  for (const w of ['sets:', 'given:', 'shade:', 'find:', 'labels:', 'drag: on', 'blank:', 'px:', 'independent: on', 'show: margins', 'z: ', 'ask: margins', 'ask: cells', 'ask: independent', 'draw:', 'view: path', 'view: intervals', 'view: scatter', 'stat:', 'curve:', 'band:', 'level:', 'seed:', 'discrete: on', 'N(μ, σ²)']) assert.ok(third.includes(w), `手册里没写 ${w}`);
});

test('概率的课拿得到这四节；线代、计算机的课拿不到（不占它们的地方）', () => {
  const prob = docsForSubject(third, '概率');
  for (const k of ['venn', 'ptree', 'joint', 'sim']) {
    assert.match(prob, new RegExp(`### ${k}：`), `概率的精简版里有 ${k}`);
    assert.ok(componentDoc(third, k, '概率').length > 300, `${k} 的完整写法取得到`);
    assert.doesNotMatch(docsForSubject(third, '线代'), new RegExp(`### ${k}：`));
    assert.doesNotMatch(docsForSubject(third, '数据结构'), new RegExp(`### ${k}：`));
  }
  // 精简版每节不超过 1.2 KiB（每一轮都带）
  for (const k of ['venn', 'ptree', 'joint', 'sim']) {
    const at = prob.indexOf(`### ${k}：`), next = prob.indexOf('\n### ', at + 5);
    const size = Buffer.byteLength(prob.slice(at, next < 0 ? undefined : next));
    assert.ok(size <= 1229, `${k} 的精简版 ${size} 字节`);
  }
});
