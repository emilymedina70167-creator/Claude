// 图的演示引擎（engines/graph.js，组件 net）：和王道的例子对答案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, run, view, quiz, parseEdges, allTopo, netEngine as N } from '../kit/src/engines/graph.js';
import { misreadAnswer, misreadFill } from '../kit/src/stepperspec.js';

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

// —— 常见错法：和 stepper.js 的诊断一样比（ask 在错法的 run 里找题面、种类一样的问题；quiz 比答案；填表逐格比）——
const asksOf = (r) => r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean);
const ansText = (a) => (Array.isArray(a.alts) ? a.alts.map((z) => [].concat(z).join(' ')).join(' | ') : [].concat(a.answer).join(' '));
// only：只和这一种错法比（对的答案不该被认成它；别的错法在这一问上可能和对的一样，stepper 不会拿对的答案去比）
const pick = (input, only) => N.variants(input).filter((v) => !only || v.label === only).map((v) => ({ ...v, run: run(v.input) }));
const misAsk = (input, ask, given, only) => misreadAnswer(given, pick(input, only).map((v) => {
  const a = asksOf(v.run).find((y) => y.q === ask.q && y.kind === ask.kind);
  return a ? { label: v.label, answer: ansText(a) } : null;
}).filter(Boolean));
const misQuiz = (input, given, only) => misreadAnswer(given, pick(input, only).map((v) => ({ label: v.label, answer: String(quiz(v.input, v.run).answer) })));
const misFill = (input, values) => misreadFill(N.table(input, run(input)), values, pick(input).map((v) => ({ label: v.label, table: N.table(v.input, v.run) })).filter((x) => x.table));
const cellsOf = (t) => t.rows.map((row) => row.cells.map((c) => [].concat(c.v)[0]));
const labelLike = (input, re) => N.variants(input).find((v) => re.test(v.label))?.label;
const askQ = (r, q) => asksOf(r).find((a) => a.q === q);

test('错法：遍历的邻接点顺序（按编号 / 按 edges 写的），结果一样就不列', () => {
  let { input, r } = go({ edges: 'A-C, A-B, B-D', run: 'dfs from A' });
  const list = labelLike(input, /按 edges 写的顺序/);
  assert.ok(list);
  assert.equal(misQuiz(input, 'A C B D'), list, '按 edges 写的顺序：A 先到 C');
  assert.equal(misQuiz(input, 'A B D C', list), '');
  // 每一问的题面带第几个：第 2 个访问的，对的是 B、按 edges 的是 C
  const second = askQ(r, '下一个（第 2 个）访问的顶点是？点出来。');
  assert.equal(second.answer, 'B');
  assert.equal(misAsk(input, second, 'C'), list);
  // 题目按 edges 的顺序：反过来认「按顶点编号」
  ({ input, r } = go({ edges: 'A-C, A-B, B-D', run: 'dfs from A', order: 'list' }));
  assert.equal(misQuiz(input, 'A B D C'), labelLike(input, /按顶点编号的顺序/));
  // edges 本来就按编号写：两种顺序一样，不列
  ({ input } = go({ edges: 'A-B, A-C, B-D', run: 'bfs from A' }));
  assert.ok(!N.variants(input).some((v) => /顺序/.test(v.label)));
});

test('错法：Dijkstra 把有向图当成无向图（只对有向图）', () => {
  let { input, r } = go({ edges: DIJ, run: 'dijkstra from V1' });
  const und = labelLike(input, /有向图当成了无向图/);
  assert.equal(misQuiz(input, 'V5 V2 V4 V3'), und, 'V2→V5 也能反着走：V2 第 3 轮就确定（5 + 2）');
  assert.equal(misQuiz(input, 'V5 V4 V2 V3', und), '');
  const third = askQ(r, '第 3 轮确定的是哪个顶点？点出来。');
  assert.equal(misAsk(input, third, 'V2'), und);
  ({ input } = go({ edges: MST, run: 'dijkstra from A' }));
  assert.ok(!labelLike(input, /有向图/), '无向图不列');
});

test('错法：Prim 用了 Dijkstra 的更新、只看刚加进来的顶点', () => {
  let { input, r } = go({ edges: MST, run: 'prim from A' });
  const dij = labelLike(input, /Dijkstra 的更新方式用在了 Prim/);
  assert.equal(misQuiz(input, '22'), dij, '最短路径树的权值和是 22');
  assert.equal(misQuiz(input, '15', dij), '');
  // 第 3 个：对的是 F（C-F 4）；按 Dijkstra 的更新 D 离 A 是 5、F 是 1 + 4 = 5，一样近按编号取 D
  // （这种错法一样近的有两个，整个顺序不唯一，「依次点出整个顺序」那一问它就不比）
  const third = askQ(r, '下一个（第 3 个）加进树里的顶点是？点出来。');
  assert.equal(third.answer, 'F');
  assert.equal(misAsk(input, third, 'D'), dij);
  assert.equal(misAsk(input, third, 'F', dij), '');
  // 只看刚加进来的 B：B-C 8，没看 A-C 2
  ({ input, r } = go({ edges: 'A-B 1, A-C 2, B-C 8', run: 'prim from A' }));
  const last = labelLike(input, /只看了刚加进来的那个顶点/);
  assert.equal(misQuiz(input, '9'), last);
  assert.equal(misQuiz(input, '3', last), '');
  assert.deepEqual(cellsOf(N.table(input, r)), [['B', '1'], ['C', '2']], '填表的边权是数（以前截成了「1：把」）');
  assert.equal(misFill(input, [['B', '1'], ['C', '8']]), last, '填表：C 那条边写了 8');
  assert.equal(misFill(input, cellsOf(N.table(input, r))), '');
  assert.ok(!labelLike(input, /Dijkstra/), '这张图按 Dijkstra 的更新结果也一样，不列');
});

test('错法：Kruskal 不判环、两头都碰过就当成环', () => {
  const { input, r } = go({ edges: MST, run: 'kruskal' });
  const noCycle = labelLike(input, /没判断会不会成环/);
  const touched = labelLike(input, /两个顶点都已经连着选中的边/);
  assert.ok(noCycle && touched);
  // (A, D) 权 5：A、C、F、D 已经连通，该不选；(C, F) 权 4：C 和 F 都碰过了，但在两个分量里，该选
  const ad = askQ(r, '(A, D) 权 5：选不选？');
  const cf = askQ(r, '(C, F) 权 4：选不选？');
  assert.equal(misAsk(input, ad, '选'), noCycle);
  assert.equal(misAsk(input, ad, '不选（会成环）', noCycle), '');
  assert.equal(misAsk(input, cf, '不选（会成环）'), touched);
  assert.equal(misAsk(input, cf, '选', touched), '');
  // 填表：行和对的一样（看到 (B, C) 为止），按「两头碰过就不选」打勾
  const tt = N.table({ ...input, mistake: 'touched' }, run({ ...input, mistake: 'touched' }));
  assert.equal(tt.rows.length, N.table(input, r).rows.length);
  assert.equal(misFill(input, cellsOf(tt)), touched);
  // 不判环的人选够 5 条就停：前 5 行都打勾、(B, C) 空着
  assert.equal(misFill(input, [['√'], ['√'], ['√'], ['√'], ['√'], ['']]), noCycle);
  assert.equal(misFill(input, cellsOf(N.table(input, r))), '');
  // quiz：不判环选最小的 n − 1 条，权值和变小
  const tri = go({ edges: 'A-B 1, B-C 2, C-A 3, C-D 4', run: 'kruskal' });
  assert.equal(misQuiz(tri.input, '6'), labelLike(tri.input, /没判断会不会成环/));
  assert.equal(misQuiz(tri.input, '7'), '');
  assert.ok(!labelLike(tri.input, /两个顶点都已经/), '这张图「两头碰过」和判环的结果一样，不列');
});

test('错法：拓扑排序用栈 / 编号最小 / 队列弄混、求成了逆拓扑序列', () => {
  // 王道的代码用栈：A、B 入栈，B 先出来 → B C A D；编号最小：A B C D；队列：A B D C
  let { input, r } = go({ edges: 'A->D, B->C', run: 'topo', use: 'stack' });
  assert.equal(r.passes[0].join(' '), 'B C A D');
  const min = labelLike(input, /没按栈走/);
  const fifo = labelLike(input, /用了队列/);
  const rev = labelLike(input, /逆拓扑序列/);
  const order = asksOf(r).find((a) => a.kind === 'order');
  assert.equal(misAsk(input, order, 'A B C D'), min);
  assert.equal(misAsk(input, order, 'A B D C'), fifo);
  assert.equal(misAsk(input, order, 'D A C B'), rev);
  assert.equal(misAsk(input, order, 'B C A D'), '');
  assert.equal(misAsk(input, askQ(r, '第一个输出的顶点是？点出来。'), 'A'), min);
  assert.equal(misFill(input, [['A B D C']]), fifo);
  assert.equal(misFill(input, [['B C A D']]), '');
  // 默认（入度为 0 的都行）：按栈走也对，不列栈 / 队列；写成逆拓扑序列认得出来
  ({ input, r } = go({ edges: 'A->B, A->C, B->D, C->D, D->E', run: 'topo' }));
  const rev2 = labelLike(input, /逆拓扑序列/);
  assert.deepEqual(N.variants(input).map((v) => v.label), [rev2]);
  assert.equal(misQuiz(input, 'E D C B A'), rev2);
  assert.equal(misQuiz(input, 'A C B D E'), '', '几种拓扑序列都不认成错法');
  assert.equal(misAsk(input, askQ(r, '第一个输出的顶点是？点出来。'), 'E'), rev2);
  // 一条链：栈、队列、编号最小走出来都一样，不列
  ({ input } = go({ edges: 'A->B, B->C', run: 'topo', use: 'stack' }));
  assert.deepEqual(N.variants(input).map((v) => v.label), [labelLike(input, /逆拓扑序列/)]);
});

test('错法：关键路径的 ve 取了最小、vl 取了最大、活动的 e 用了终点的 ve', () => {
  const { input, r } = go({ edges: AOE, run: 'critical' });
  const veMin = labelLike(input, /ve 取了最小值/);
  const vlMax = labelLike(input, /vl 取了最大值/);
  const eEnd = labelLike(input, /e 用了终点事件的 ve/);
  assert.ok(veMin && vlMax && eEnd);
  // ve(V4) = max{3 + 2, 2 + 4} = 6，取最小是 5；关键路径长度跟着变成 5
  assert.equal(misAsk(input, askQ(r, 've(V4) 是多少？'), '5'), veMin);
  assert.equal(misAsk(input, askQ(r, 've(V4) 是多少？'), '6', veMin), '');
  assert.equal(misQuiz(input, '5'), veMin);
  // vl(V3) = min{6 − 4, 8 − 3} = 2，取最大是 5
  assert.equal(misAsk(input, askQ(r, 'vl(V3) 是多少？'), '5'), vlMax);
  assert.equal(misAsk(input, askQ(r, 'vl(V3) 是多少？'), '2', vlMax), '');
  // 填表：活动的 e 一列按终点的 ve 写；vl 按取最大写
  const et = N.table({ ...input, mistake: 'eByEnd' }, run({ ...input, mistake: 'eByEnd' }));
  assert.equal(misFill(input, cellsOf(et)), eEnd);
  const vt = N.table({ ...input, mistake: 'vlMax' }, run({ ...input, mistake: 'vlMax' }));
  assert.equal(misFill(input, cellsOf(vt)), vlMax);
  assert.equal(misFill(input, cellsOf(N.table(input, r))), '');
});
