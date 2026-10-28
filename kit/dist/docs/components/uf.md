### uf：并查集

```uf
id: uf
n: 8
ops: union 1 2, union 3 4, find 4
ask: root, parent
```

- 元素 0～n−1（`from: 1` 从 1 起），S 是双亲数组，根存 −1。`union a b`：先找两个根，S[Root2] = Root1。`rank: true` 小树并大树（根存 −结点数），`compress: true` 路径压缩。`ask:` 问 `root`（Find 的结果，我点）、`parent`（某个 S[i]）、`array`（整个 S）。`mode: quiz` 写最后的 S。

- 画面是森林加 S 数组，下标对得上（`highlight 3`、`board mark … item=3` 树上的 3 和 S[3] 一起标）；Find 时把往上走的路径标黄。
- 照王道的代码：`rank: true` 时 `if (S[Root2] > S[Root1])` Root2 挂到 Root1 下，否则 Root1 挂到 Root2 下——一样大时走 else（第一个的根挂到第二个的根下），页面会写出来。`rank: height` 按树高合并（一样高同样走 else）。`size: true` 不按大小合并也让根存 −结点数（王道那张 S = −4 −3 −3 2 1 2 0 0 0 1 的图）；`rank: true` 时默认就是。
- `compress: true`：Find 时把路径上每个结点都直接挂到根下，union 里的两次 Find 也压缩；压缩单独一步（`ask: parent` 问离根最近的被改的那个）。
- `ops:` 也认 `Union(1, 2)`、`Find(4)`、`合并 1 2`、`查找 4`，最多 24 个。`init: -1 0 0 -1 …` 从给定的 S 开始（不能有环）。`quiz: find` 改成写每次 Find 的结果。
- `mode: fill`：每做完一个操作写一行 S 数组（有「照抄」），有 Find 的再写结果。n 最多 16。
- 错法诊断认得出：根接反（第一个的根挂到了第二个下）/ 大树挂到小树下、路径压缩只改了第一个结点、没先找根直接把元素挂上去、根里没存 −结点数。
