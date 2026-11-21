// 视觉交互第 6 批 Task 10：线代、数据结构的示例页和手册照抄就能用；覆盖的每一行至少两张图
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENGINES } from '../kit/src/engines/registry.js';
import { parseFields } from '../kit/src/parse.js';
import { vectorsOf } from '../kit/src/linalg.js';

globalThis.document ??= { addEventListener() {}, compatMode: 'CSS1Compat' };
const { parseScene } = await import('../kit/src/scene.js');

const blocksIn = (text) => [...text.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((m) => ({ kind: m[1], src: m[2] }));
// 照页面的读法读一遍、跑一遍：读不懂、跑不动就抛错
function check(b) {
  if (b.kind === 'scene') { parseScene(b.src); return; }
  if (b.kind === 'vectors') { vectorsOf(parseFields(b.src).fields); return; }
  const e = ENGINES[b.kind];
  assert.ok(e, `不认识的组件 ${b.kind}`);
  const { fields } = parseFields(e.head ? e.head(b.src) : b.src);
  const input = e.parse(fields, b.src);
  const r = e.run(input);
  if (/^mode:\s*quiz/m.test(b.src)) assert.ok(e.quiz(input, r, fields, {}).answer !== undefined);
  if (/^mode:\s*fill/m.test(b.src)) assert.ok(e.table(input, r));
}

const la = blocksIn(readFileSync('kit/examples/la2-demo.html', 'utf8'));
const ds = blocksIn(readFileSync('kit/examples/ds3-demo.html', 'utf8'));

test('两张示例页：每张都读得懂、跑得动，编号不重', () => {
  for (const b of [...la, ...ds]) assert.doesNotThrow(() => check(b), `${b.kind}: ${b.src.slice(0, 40)}`);
  const ids = [...la, ...ds].map((b) => /^id:\s*(\S+)/m.exec(b.src)?.[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('按考纲：这一批盖住的每一行至少两张', () => {
  const n = (list, pred) => list.filter(pred).length;
  assert.ok(n(la, (b) => b.kind === 'det' && /^param:/m.test(b.src)) >= 2, '含参数的行列式');
  assert.ok(n(la, (b) => b.kind === 'scene' && /decomp/.test(b.src)) >= 2, '基变换、坐标');
  assert.ok(n(ds, (b) => b.kind === 'store' && /^graph:/m.test(b.src)) >= 2, '图的存储');
  assert.ok(n(ds, (b) => b.kind === 'store' && /^tree:/m.test(b.src)) >= 2, '树的存储');
  assert.ok(n(ds, (b) => b.kind === 'deque') >= 2, '双端队列');
  assert.ok(n(ds, (b) => (b.kind === 'sort' && /binsert/.test(b.src)) || b.kind === 'blocksearch') >= 2, '折半插入、分块查找');
  assert.ok(n(ds, (b) => b.kind === 'slist') >= 2, '静态链表');
  assert.ok(n(ds, (b) => b.kind === 'trace' && /fact\(n-1\)|hanoi\(n-1/.test(b.src)) >= 2, '递归的调用栈');
});

test('手册写到了新写法，例子照抄就能用', () => {
  const manual = readFileSync('CLAUDE-PROJECT.md', 'utf8');
  for (const w of ['param: a', 'c1 / (a+2)', 'decomp v, b1, b2', 'coords(v, b1, b2)', '### store：', 'show:', 'insert: head', '### deque：', 'kind:', 'options:', '`binsert`', 'blocksearch', 'find: binary', '### slist：']) assert.ok(manual.includes(w), `手册里没写 ${w}`);
  const third = manual.slice(manual.indexOf('## 三、组件参考'), manual.indexOf('\n## 四、'));
  for (const b of blocksIn(third).filter((x) => ['store', 'deque', 'slist', 'blocksearch'].includes(x.kind))) assert.doesNotThrow(() => check(b), `手册 ${b.kind}`);
});
