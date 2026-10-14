// 图的演示引擎（engines/graph.js，组件 net）：和王道的例子对答案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, run, view, quiz, parseEdges, allTopo } from '../kit/src/engines/graph.js';

const go = (f) => { const input = parse(f); return { input, r: run(input) }; };
const G8 = '1-2, 1-5, 2-6, 6-3, 6-7, 3-4, 3-7, 7-4, 7-8, 4-8';
const MST = 'A-B 6, A-C 1, A-D 5, B-C 5, C-D 5, B-E 3, C-E 6, C-F 4, D-F 2, E-F 6';
const DIJ = 'V1->V2 10, V1->V5 5, V2->V3 1, V2->V5 2, V3->V4 4, V4->V1 7, V4->V3 6, V5->V2 3, V5->V3 9, V5->V4 2';
const AOE = 'V1->V2 3, V1->V3 2, V2->V4 2, V2->V5 3, V3->V4 4, V3->V6 3, V4->V6 2, V5->V6 1';

test('边的写法、顶点的顺序、报错', () => {
  const g = parseEdges('A-B 4, A-C 2');
  assert.equal(g.directed, false);
  assert.equal(g.weighted, true);
  assert.throws(() => parseEdges('A-B, A->C'), /不能混着写/);
  assert.throws(() => parseEdges('A-B 1, B-C'), /都写/);
  assert.throws(() => parseEdges('A-B, B-A'), /写了两次/);
  assert.throws(() => parseEdges('A=B'), /看不懂/);
  assert.deepEqual(parse({ edges: 'V10-V2, V1-V10', run: 'bfs' }).names, ['V1', 'V2', 'V10'], '按编号排');
  assert.deepEqual(parse({ edges: 'C-A, A-B', nodes: 'C A B', run: 'bfs' }).names, ['C', 'A', 'B'], 'nodes: 写了就按它');
  assert.throws(() => parse({ edges: 'A-B', run: 'prim' }), /带权/);
  assert.throws(() => parse({ edges: 'A->B 1', run: 'kruskal' }), /无向图/);
  assert.throws(() => parse({ edges: 'A-B 1', run: 'topo' }), /有向图/);
  assert.throws(() => parse({ edges: 'A->B -1', run: 'dijkstra' }), /负权/);
  assert.throws(() => parse({ edges: 'A-B', run: 'bfs from Z' }), /不在图里/);
  assert.throws(() => parse({ edges: 'A-B', run: 'astar' }), /不认识/);
});

test('遍历：王道 8 个顶点的例子', () => {
  assert.equal(go({ edges: G8, run: 'bfs from 1' }).r.passes[0].join(' '), '1 2 5 6 3 7 4 8');
  assert.equal(go({ edges: G8, run: 'dfs from 1' }).r.passes[0].join(' '), '1 2 6 3 4 7 8 5');
  // 邻接表的顺序（edges 写的顺序）不一样，序列就可能不一样
  assert.equal(go({ edges: 'A-C, A-B, B-D', run: 'dfs from A', order: 'list' }).r.passes[0].join(' '), 'A C B D');
  assert.equal(go({ edges: 'A-C, A-B, B-D', run: 'dfs from A' }).r.passes[0].join(' '), 'A B D C');
  const { input, r } = go({ edges: G8, run: 'bfs from 1' });
  assert.deepEqual(r.steps.filter((s) => s.ask).map((s) => s.ask.answer), r.passes[0]);
  assert.equal(quiz(input, r).answer, '1 2 5 6 3 7 4 8');
  // 不连通：再从没访问的开始
  assert.equal(go({ edges: 'A-B, C-D', run: 'bfs from A' }).r.passes[0].join(' '), 'A B C D');
});

test('最小生成树：Prim、Kruskal 权值和一样', () => {
  assert.equal(go({ edges: MST, run: 'prim from A' }).r.total, 15);
  const k = go({ edges: MST, run: 'kruskal' });
  assert.equal(k.r.total, 15);
  const takes = k.r.steps.filter((s) => s.ask?.tag === 'take').map((s) => s.ask.answer === '选');
  assert.equal(takes.filter(Boolean).length, 5);
  assert.equal(quiz(k.input, k.r).answer, '15');
});

test('最短路径：Dijkstra（王道的例子）、Floyd', () => {
  const { input, r } = go({ edges: DIJ, run: 'dijkstra from V1' });
  assert.deepEqual(r.order, ['V1', 'V5', 'V4', 'V2', 'V3']);
  assert.deepEqual(r.dist, { V1: 0, V2: 8, V3: 9, V4: 7, V5: 5 });
  assert.equal(quiz(input, r).answer, 'V5 V4 V2 V3');
  assert.match(r.steps.at(-1).msg, /V3：9（V1→V5→V2→V3）/);
  for (const s of r.steps) assert.match(view(s.view, input), /sv-net/);
  const f = go({ edges: 'A->B 6, A->C 13, B->A 10, B->C 4, C->A 5', run: 'floyd' });
  assert.deepEqual(f.r.mat, [[0, 6, 10], [9, 0, 4], [5, 11, 0]]);
  assert.throws(() => quiz(f.input, f.r), /floyd 没有 quiz/);
});

test('拓扑排序、关键路径（王道 AOE 网的例子）', () => {
  const t = go({ edges: 'A->B, A->C, B->D, C->D, D->E', run: 'topo' });
  assert.equal(t.r.passes[0].join(' '), 'A B C D E');
  assert.equal(quiz(t.input, t.r).answer, 'A B C D E | A C B D E', '几种拓扑序列都算对');
  assert.deepEqual(allTopo(parse({ edges: 'A->B, B->C, C->A', run: 'topo' })), [], '有回路');
  assert.match(go({ edges: 'A->B, B->C, C->B', run: 'topo' }).r.steps.at(-1).msg, /有回路/);
  const s = go({ edges: 'A->C, B->C', run: 'topo', use: 'stack' });
  assert.equal(s.r.passes[0].join(' '), 'B A C', '王道的代码用栈：A、B 先入栈，B 先出来');
  const c = go({ edges: AOE, run: 'critical' });
  assert.equal(c.r.length, 8);
  assert.deepEqual(c.r.crit, ['V1->V3', 'V3->V4', 'V4->V6']);
  assert.deepEqual(c.r.steps.filter((x) => x.ask?.tag === 've').map((x) => x.ask.answer), [0, 3, 2, 6, 6, 8]);
  for (const x of c.r.steps) assert.match(view(x.view, c.input), /sv-net/);
});
