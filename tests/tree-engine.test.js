// 树的演示引擎（engines/tree.js）：遍历、二叉排序树、堆；和王道的例子对答案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, run, quiz, view, parseTree, parseLevel } from '../kit/src/engines/tree.js';
import { treeSvg, layout, levelOrder } from '../kit/src/engines/treeview.js';

const go = (f) => { const input = parse(f); return { input, r: run(input) }; };
const HEAP = '53 17 78 09 45 65 87 32';

test('树的写法：括号、层序；写错的报出来', () => {
  const t = parseTree('A(B(D, E), C(, F))');
  assert.deepEqual(levelOrder(t).map((id) => t.nodes[id].key), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(t.nodes[t.nodes[t.root].right].left, null, 'C 的左孩子空着');
  const s = parseTree('A(B)');
  assert.ok(s.nodes[s.root].left && !s.nodes[s.root].right, '只写一个是左孩子');
  const l = parseLevel('A B C # D # E');
  assert.deepEqual(levelOrder(l).map((id) => l.nodes[id].key), ['A', 'B', 'C', 'D', 'E']);
  assert.throws(() => parseTree('A(B, C, D)'), /最多两个/);
  assert.throws(() => parseTree('A(B'), /右括号/);
  assert.throws(() => parseTree('A(B, B)'), /写了两次/);
  assert.throws(() => parseLevel('A # B C'), /双亲（第 2 个）是空的/);
  assert.throws(() => parse({ nodes: 'A(B, C)' }), /walk/);
  assert.throws(() => parse({ nodes: 'A(B, C)', walk: 'zigzag' }), /不认识「zigzag」/);
  assert.throws(() => parse({}), /nodes:/);
});

test('遍历：四种序列；每一步先猜的就是真访问的结点', () => {
  const want = { pre: 'ABDECF', in: 'DBEACF', post: 'DEBFCA', level: 'ABCDEF' };
  for (const [w, seq] of Object.entries(want)) {
    const { input, r } = go({ nodes: 'A(B(D, E), C(, F))', walk: w });
    assert.equal(r.passes[0].join(''), seq, w);
    assert.equal(r.steps.filter((s) => s.ask).map((s) => s.ask.answer).join(''), seq);
    assert.equal(quiz(input, r).answer, seq.split('').join(' '));
    for (const s of r.steps) assert.match(view(s.view, input), /<svg class="sv-tree"/);
  }
});

test('二叉排序树：建树、删除（叶 / 一棵子树 / 两棵子树用直接后继）、插入、查找', () => {
  let { input, r } = go({ bst: HEAP, quiz: 'pre' });
  assert.equal(quiz(input, r).answer, '53 17 09 45 32 78 65 87');
  ({ input, r } = go({ bst: HEAP, ops: 'delete 17, delete 53, insert 50, search 32' }));
  assert.equal(quiz(input, r).answer, '65 32 78 09 45 87 50', '层序');
  // 用直接前驱替代
  ({ input, r } = go({ bst: HEAP, ops: 'delete 53', replace: 'pred', quiz: 'level' }));
  assert.equal(quiz(input, r).answer, '45 17 78 09 32 65 87');
  // 删除的情况题、替代结点题
  const del = run(parse({ bst: HEAP, ops: 'delete 09, delete 78, delete 17' }));
  const cases = del.steps.filter((s) => s.ask?.tag === 'case').map((s) => s.ask.answer[0]);
  assert.deepEqual(cases, ['叶', '两', '只'], '删了 09 以后 17 只剩右子树');
  assert.deepEqual(del.steps.filter((s) => s.ask?.tag === 'replace').map((s) => s.ask.answer), ['87']);
  // 插入：先猜双亲
  const ins = run(parse({ bst: HEAP, ops: 'insert 40' }));
  assert.equal(ins.steps.find((s) => s.ask?.tag === 'insert').ask.answer, '32');
  assert.throws(() => parse({ bst: HEAP, ops: 'delete A' }), /不是一类/);
  assert.throws(() => parse({ bst: HEAP, ops: 'rotate 3' }), /不认识/);
});

test('堆：建大根堆、插入、删除堆顶、堆排序（王道例子）；小根堆', () => {
  assert.equal(go({ heap: HEAP }).r.final.join(' '), '87 45 78 32 17 65 53 09');
  assert.equal(go({ heap: HEAP, ops: 'build, insert 63' }).r.final.join(' '), '87 63 78 45 17 65 53 09 32');
  assert.equal(go({ heap: HEAP, ops: 'build, delete' }).r.final.join(' '), '78 45 65 32 17 09 53');
  const s = go({ heap: HEAP, ops: 'build, sort', pass: '1' });
  assert.equal(s.r.final.join(' '), '09 17 32 45 53 65 78 87');
  assert.equal(s.r.passes[0].join(' '), '78 45 65 32 17 09 53 87');
  assert.equal(quiz(s.input, s.r).answer, '78 45 65 32 17 09 53 87');
  assert.equal(go({ heap: HEAP, type: 'min' }).r.final.join(' '), '09 17 65 32 45 78 87 53');
  // 建堆的「先猜」答案和最后的样子一致；每次交换的猜测就是真交换的位置
  const b = go({ heap: HEAP });
  assert.equal(b.r.steps.find((x) => x.ask?.tag === 'build').ask.answer, b.r.final.join(' '));
  for (const x of b.r.steps.filter((y) => y.ask?.tag === 'swap')) assert.match(x.view.cls[x.ask.answer], /sv-cur/);
  assert.throws(() => run(parse({ heap: '1 2 3', ops: 'insert 4' })), /先写 build/);
  assert.throws(() => parse({ heap: 'A B' }), /要写数/);
  // 树和数组里同一个元素的 highlight 编号一样（都是下标）
  const html = view(b.r.steps.at(-1).view, b.input);
  assert.match(html, /<g class="sv-node[^"]*" data-pick="1" data-cmd="1" data-label="87"[^>]*>/);
  assert.match(html, /<div class="sv-cell[^"]*" data-cmd="1" data-pick="1"[^>]*>87<\/div>/);
});

test('画法：按中序排开不重叠；ghost 和标注', () => {
  const t = parseTree('B(A, C)');
  const pos = layout(t);
  const xs = Object.values(pos).map((p) => p.x).sort();
  assert.deepEqual(xs, [0, 1, 2]);
  assert.match(treeSvg(t, { note: { [t.root]: 'bf=0' } }), /sv-node-note/);
  assert.match(treeSvg({ root: null, nodes: {} }), /空树/);
});
