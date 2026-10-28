### net：图的算法（数据结构里的图；函数图是上面的 graph）

```net
id: g-dij
title: Dijkstra
edges: V1->V2 10, V1->V5 5, V2->V3 1, V2->V5 2, V3->V4 4, V4->V1 7, V4->V3 6, V5->V2 3, V5->V3 9, V5->V4 2
run: dijkstra from V1
ask: next
```

- `edges:` 边，逗号隔开：`A-B 4` 是无向边（权 4），`A->B 4` 是有向边；权可以都不写。顶点按名字排（1 < 2 < 10，V2 < V10），这就是「按顶点编号」的顺序；要别的顺序或者有孤立的顶点，写 `nodes: A B C D`。最多 14 个顶点。
- 位置不写时自动摆；要和教材的图对上写 `pos: A(0,0) B(2,1)`（y 往上）。
- `run:` 选算法：
  - `bfs from A` / `dfs from A`：广度 / 深度优先遍历。邻接点按顶点编号的顺序（`order: list` 按 edges 写的顺序，即邻接表）。`ask: visit`：下一个访问谁（点顶点）。
  - `prim from A` / `kruskal`：最小生成树（无向带权图）。Prim 的 `ask: next`：下一个加进来的顶点（点出来）；Kruskal 的 `ask: take`：这条边选不选（会不会成环）。
  - `dijkstra from A`：王道那张表（每一轮一列）。`ask: next`：这一轮确定哪个顶点。
  - `floyd`：一轮一个矩阵 A⁽⁻¹⁾、A⁽⁰⁾……，变小的格子标出来。
  - `topo`：拓扑排序。每次选入度为 0、编号最小的（`ask: next` 时任何一个入度为 0 的都算对；`use: stack` 用栈）。
  - `critical`：关键路径（有向带权图，边是活动）。算 ve、vl，再列出每个活动的 e、l、l − e。`ask:` 能问 `ve`、`vl`（这个事件的值）、`length`（关键路径长度）。
- `mode: quiz`：bfs / dfs 写遍历序列；prim / kruskal 写权值之和；dijkstra 写各顶点被确定的顺序；topo 写一个拓扑序列（任何一个对的都算）；critical 写关键路径长度。floyd 没有 quiz。

- 自动摆的位置：圆上；拓扑排序、关键路径从左往右分层。有向图里一对反向的边画成两条弧。BFS / DFS 不连通时接着从下一个没访问的顶点开始；`order: list` 时邻接表画在下面。
- Dijkstra 的表：每一轮一列，dist 和确定的顶点 ✓，下面是集合 S，还有 dist、path；不能有负权。拓扑排序图上标着每个顶点现在的入度，有回路会说出来。关键路径一步一个事件算 ve（拓扑序）、vl（逆拓扑序），关键活动标绿。
- `mode: fill`：bfs / dfs / topo 填序列；dijkstra 每一轮一列（各顶点的 dist、这一轮确定谁）；prim / kruskal 填依次选的边；critical 填每个事件的 ve、vl，每个活动的 e、l、l − e，最后是关键路径长度。
- `ask: order`：bfs / dfs / topo / dijkstra / prim 在第 1 步之前让我在图上依次点出顶点（拓扑序列任何一个对的都算）。
- 错法诊断认得出：BFS 和 DFS 弄反、邻接点按 edges 顺序（或按编号）走反了；Dijkstra 用了 Prim 的更新、有向图当无向图；Prim 用了 Dijkstra 的更新、只看刚加进来的顶点；Kruskal 不判环、判环判错；拓扑排序选了出度为 0 的、栈和队列弄混；关键路径 ve 取最小、vl 取最大、活动的 e 用了终点的 ve。
