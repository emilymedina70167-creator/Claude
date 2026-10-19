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

// —— 常见错法 ——
// 外壳（stepper.js）认错法的路：先猜按题面找错法那一遍里的同一个问题、mode: quiz 比答案、mode: fill 逐格比表；都只在答错时才诊断
import { treeEngine } from '../kit/src/engines/tree.js';
import { misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';

function diagnose(fields) {
  const E = treeEngine;
  const input = E.parse(fields);
  const r = E.run(input);
  // 外壳也是这样：这组数上算不了的错法（比如不是小根堆却要插入）跳过
  const vs = E.variants(input).flatMap((v) => { try { return [{ ...v, run: E.run(v.input) }]; } catch { return []; } });
  return {
    input, r, vs,
    variant: (re) => { const v = vs.find((x) => re.test(x.label)); assert.ok(v, `没有「${re.source}」这种错法：${vs.map((x) => x.label).join('；')}`); return v; },
    answerOf: (v) => E.quiz(v.input, v.run).answer,
    quiz: (given) => (given === E.quiz(input, r).answer ? '' : misreadAnswer(given, vs.map((v) => ({ label: v.label, answer: E.quiz(v.input, v.run).answer })))),
    fill: (values) => misreadFill(E.table(input, r), values, vs.map((v) => ({ label: v.label, table: E.table(v.input, v.run) })).filter((v) => v.table)),
    ask: (tag, given, k = 0) => {
      const ask = r.steps.filter((s) => s.ask?.tag === tag)[k].ask;
      if (given === ask.answer) return '';
      return misreadAnswer(given, vs.map((v) => {
        const a = v.run.steps.flatMap((x) => [x.ask, ...(x.asks || [])]).find((y) => y && y.q === ask.q && y.kind === ask.kind);
        return a ? { label: v.label, answer: [].concat(a.answer).join(' ') } : null;
      }).filter(Boolean));
    },
  };
}
const cellsOf = (t) => t.rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));

test('错法：二叉排序树删除时前驱、后继用反（只在真有两棵子树的删除时列）', () => {
  let d = diagnose({ bst: HEAP, ops: 'delete 53', quiz: 'level' });
  const pred = d.variant(/用了直接前驱/);
  assert.equal(d.answerOf(pred), '45 17 78 09 32 65 87');
  assert.equal(d.quiz('45 17 78 09 32 65 87'), pred.label);
  assert.equal(d.quiz('65 17 78 09 45 87 32'), '', '正确答案（直接后继 65 顶上）');
  assert.equal(d.quiz('65 17 78 09 32 87 45'), '', '随手写错的不乱说');
  // 先猜「用来替代 53 的是哪个结点」：点了 45
  assert.equal(d.ask('replace', '45'), pred.label);
  assert.equal(d.ask('replace', '87'), '', '点了别的不乱说');
  assert.equal(d.ask('case', CASE_ONE), '', '错法那一遍只留替代结点这一问');
  // 作者写了 replace: pred：反过来是「用了后继」
  d = diagnose({ bst: HEAP, ops: 'delete 53', replace: 'pred', quiz: 'level' });
  const succ = d.variant(/用了直接后继/);
  assert.equal(d.quiz('65 17 78 09 45 87 32'), succ.label);
  assert.equal(d.ask('replace', '65'), succ.label);
  // 只删叶结点、只有一棵子树的：两种做法一样，不列
  for (const ops of ['delete 09, delete 87', 'delete 09, delete 17', 'insert 40, search 32']) {
    assert.ok(!diagnose({ bst: HEAP, ops }).vs.some((v) => /前驱|后继/.test(v.label)), ops);
  }
  assert.ok(!diagnose({ bst: HEAP }).vs.some((v) => /前驱|后继/.test(v.label)));
});
const CASE_ONE = '只有一棵子树：子树顶上来';

test('错法：二叉排序树大的往左（写结果、先猜往哪走、填表都认得出）', () => {
  const d = diagnose({ bst: HEAP, quiz: 'pre' });
  const v = d.variant(/大的往左/);
  // 整棵树左右翻过来：53(78(87, 65), 17(45(, 32), 09))
  assert.equal(d.answerOf(v), '53 78 87 65 17 45 32 09');
  assert.equal(d.quiz('53 78 87 65 17 45 32 09'), v.label);
  assert.equal(d.quiz('53 17 09 45 32 78 65 87'), '', '正确的先序');
  // 先猜：78 和 53 比往哪走，选了左子树
  const k = d.r.steps.filter((s) => s.ask?.tag === 'compare').findIndex((s) => /^78 和 53/.test(s.ask.q));
  assert.equal(d.ask('compare', '左子树', k), v.label);
  // 填表：每个关键字的双亲和左右
  assert.equal(d.fill(cellsOf(treeEngine.table(v.input, v.run))), v.label);
  assert.equal(d.fill(cellsOf(treeEngine.table(d.input, d.r))), '');
});

test('错法：堆逐个插入建堆、大小根堆弄反（两种建法一样时不列）', () => {
  let d = diagnose({ heap: HEAP });
  const ins = d.variant(/一个个插入/);
  // 53 → 17 → 78 上浮 → 09 → 45 上浮 → 65 上浮 → 87 浮到堆顶 → 32 上浮
  assert.equal(d.answerOf(ins), '87 45 78 32 17 53 65 09');
  assert.equal(d.quiz('87 45 78 32 17 53 65 09'), ins.label);
  assert.equal(d.quiz('87 45 78 32 17 65 53 09'), '', '正确答案（从 A[4] 往前逐个往下调整）');
  assert.equal(d.quiz('87 78 45 32 17 65 53 09'), '', '随手写错的不乱说');
  assert.equal(d.ask('build', '87 45 78 32 17 53 65 09'), ins.label, '先猜「建好的大根堆是什么」');
  const flip = d.variant(/建成了小根堆/);
  assert.equal(d.quiz('09 17 65 32 45 78 87 53'), flip.label);
  assert.equal(d.fill(cellsOf(treeEngine.table(flip.input, flip.run))), flip.label);
  // 堆排序第 1 趟：从逐个插入建成的堆接着排
  d = diagnose({ heap: HEAP, ops: 'build, sort', pass: '1' });
  assert.equal(d.quiz('78 45 65 32 17 53 09 87'), d.variant(/一个个插入/).label);
  assert.equal(d.quiz('78 45 65 32 17 09 53 87'), '', '正确的第 1 趟');
  // 本来就是堆、这组数建小根堆：两种建法结果一样，不列
  assert.ok(!diagnose({ heap: '9 5 8 1 2' }).vs.some((v) => /一个个插入/.test(v.label)));
  assert.ok(!diagnose({ heap: HEAP, type: 'min' }).vs.some((v) => /一个个插入/.test(v.label)));
  assert.ok(!diagnose({ heap: '9 5 8 1 2', ops: 'insert 7' }).vs.some((v) => /一个个插入/.test(v.label)), '没有建堆');
});

test('错法：遍历次序弄混，说明里写出这里要的次序', () => {
  const d = diagnose({ nodes: 'A(B(D, E), C(, F))', walk: 'pre' });
  assert.equal(d.quiz('D B E A C F'), '像是按中序走的（先序：根 → 左子树 → 右子树）');
  assert.equal(d.quiz('A B D E C F'), '');
});
