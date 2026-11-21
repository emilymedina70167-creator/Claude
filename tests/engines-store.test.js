// 视觉交互第 6 批 Task 4：图、树的存储结构（组件 store）。例子是手算的，口径写在 engines/store.js 开头
import test from 'node:test';
import assert from 'node:assert/strict';
import { storeEngine as E } from '../kit/src/engines/store.js';

const runOf = (f) => { const input = E.parse(f); return { input, r: E.run(input) }; };
const last = (r) => r.steps.at(-1).view;

test('无向图：邻接矩阵对称；邻接表按 edges 的先后尾插（insert: head 头插）', () => {
  const { r } = runOf({ graph: 'A-B, A-C, B-D, C-D', show: 'matrix, list' });
  const v = last(r);
  assert.deepEqual(v.matrix, [[0, 1, 1, 0], [1, 0, 0, 1], [1, 0, 0, 1], [0, 1, 1, 0]]);
  assert.deepEqual(v.list, { A: ['B', 'C'], B: ['A', 'D'], C: ['A', 'D'], D: ['B', 'C'] });
  const h = last(runOf({ graph: 'A-B, A-C, B-D, C-D', show: 'list', insert: 'head' }).r);
  assert.deepEqual(h.list, { A: ['C', 'B'], B: ['D', 'A'], C: ['D', 'A'], D: ['C', 'B'] });
  assert.equal(r.steps.length, 5, '一开始只有顶点，一条边一步');
});

test('有向带权图：矩阵没边的是 ∞、对角线 0；出度入度', () => {
  const { r } = runOf({ graph: 'A->B 3, A->C 5, C->A 2, B->D 4', show: 'matrix' });
  const v = last(r);
  assert.deepEqual(v.matrix, [[0, 3, 5, '∞'], ['∞', 0, '∞', 4], [2, '∞', 0, '∞'], ['∞', '∞', '∞', 0]]);
  assert.deepEqual(v.deg, { A: { out: 2, in: 1 }, B: { out: 1, in: 1 }, C: { out: 1, in: 1 }, D: { out: 0, in: 1 } });
});

test('十字链表（有向图）：firstout、firstin，弧结点的 tlink（同弧尾的下一条）、hlink（同弧头的下一条）', () => {
  const { r } = runOf({ graph: 'A->B, A->C, C->A, B->D, C->B', show: 'cross' });
  const c = last(r).cross;
  // 弧编号按 edges 的先后：0 A->B、1 A->C、2 C->A、3 B->D、4 C->B；尾插
  assert.deepEqual(c.firstout, { A: 0, B: 3, C: 2, D: null });
  assert.deepEqual(c.firstin, { A: 2, B: 0, C: 1, D: 3 });
  assert.deepEqual(c.arcs.map((a) => [a.tail, a.head, a.tlink, a.hlink]), [['A', 'B', 1, 4], ['A', 'C', null, null], ['C', 'A', 4, null], ['B', 'D', null, null], ['C', 'B', null, null]]);
  assert.throws(() => E.parse({ graph: 'A-B', show: 'cross' }), /十字链表.*有向/);
});

test('邻接多重表（无向图）：firstedge，边结点的 ilink（ivex 的下一条）、jlink（jvex 的下一条）', () => {
  const { r } = runOf({ graph: 'A-B, A-C, B-D, C-D', show: 'multi' });
  const m = last(r).multi;
  assert.deepEqual(m.firstedge, { A: 0, B: 0, C: 1, D: 2 });
  assert.deepEqual(m.edges.map((e) => [e.ivex, e.ilink, e.jvex, e.jlink]), [['A', 1, 'B', 2], ['A', null, 'C', 3], ['B', null, 'D', 3], ['C', null, 'D', null]]);
  assert.throws(() => E.parse({ graph: 'A->B', show: 'multi' }), /多重表.*无向/);
});

test('树：双亲表示（按层序编号）、孩子表示、孩子兄弟', () => {
  const v = last(runOf({ tree: 'A(B(D, E), C(F))', show: 'parent, child' }).r);
  assert.deepEqual(v.parent, [['A', -1], ['B', 0], ['C', 0], ['D', 1], ['E', 1], ['F', 2]]);
  assert.deepEqual(v.child, { A: [1, 2], B: [3, 4], C: [5], D: [], E: [], F: [] });
  assert.throws(() => E.parse({ tree: 'A(B)', show: 'parent, child, cs' }), /最多两种/);
  assert.deepEqual(last(runOf({ tree: 'A(B(D, E), C(F))', show: 'cs' }).r).cs, { A: ['B', null], B: ['D', 'C'], C: ['F', null], D: [null, 'E'], E: [null, null], F: [null, null] });
});

test('二叉树的顺序存储：编号 i 的孩子是 2i、2i+1，空的位置写 #', () => {
  const { r } = runOf({ tree: 'A(B(, D), C)', show: 'seq' });
  assert.deepEqual(last(r).seq, ['A', 'B', 'C', '#', 'D']);
  assert.throws(() => E.parse({ tree: 'A(B, C)', show: 'seq, parent' }), /seq/);
});

test('提问、测验、填表、错法', () => {
  const g = runOf({ graph: 'B-A, C-A, B-D, C-D', show: 'matrix, list', ask: 'list' });
  assert.ok(g.r.steps.some((s) => s.ask?.tag === 'list'));
  const q = E.quiz(g.input, g.r);
  assert.equal(q.type, 'seq');
  assert.equal(q.answer, 'B C', '顶点 A 的边表（尾插：B 先、C 后）');
  const t = E.table(g.input, g.r);
  assert.equal(t.rows.length, 4);
  assert.deepEqual(t.rows[0].cells.map((c) => c.v), ['0', '1', '1', '0']);
  assert.equal(E.quiz({ ...g.input, mistake: 'oneway' }, E.run({ ...g.input, mistake: 'oneway' })).q, q.q, '错法问的是同一个顶点');
  const labels = E.variants(g.input).map((v) => v.label).join('｜');
  assert.match(labels, /只存了一个方向/);
  assert.match(labels, /头插/);
  const tq = runOf({ tree: 'A(B(D, E), C(F))', show: 'parent' });
  assert.equal(E.quiz(tq.input, tq.r).answer, '-1 0 0 1 1 2');
  assert.match(E.variants(tq.input).map((v) => v.label).join('｜'), /先序/);
});
