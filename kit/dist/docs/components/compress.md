### compress：特殊矩阵的压缩存储

```compress
id: cp1
matrix: symmetric 5
at: 3 4
ask: index
```

- `matrix:` `symmetric n` `lower n` `upper n` `tridiagonal n`，或 `sparse` 配 `data: 0 0 3; 0 5 0`。
- `at: i j` 问 a[i][j]；`base:` A 从几数（默认 1），`from:` B 从几存（默认 0），`order: col`，`store: upper`（对称存上三角）。
- `ask:` `index` `cell`（在 B 里点）`count` `line`；sparse `triple`。

- n ≤ 8 画出每个元素、一行一行放进 B（下面写下标）；n 更大（最多 200，真题的 100 阶照写）只画示意图、讲公式。写了 `at` 时第 1 步就问：先数它前面存了几个，画面把这些涂黄；后面再一行行放进去对照。`line` 问每一行第一个元素的下标。
- 下三角 / 上三角矩阵另一半是同一个常数 c，存在最后（from 0 时是 B[n(n+1)/2]）；三对角矩阵 |i − j| > 1 的是 0，不存。对称矩阵 at 在另一半时换成 a[j][i]。
- sparse：最多 8 × 8，按行优先（`order: col` 按列）扫出非零元，三元组 (行, 列, 值)；`at` 问它是三元组表的第几个。
- `mode: quiz`：at 的下标（没写 at 问 B 一共几个元素）；sparse 写整张三元组表。`mode: fill`：每一行（列）存在 B 的哪一段（n 大时只填第 1、2 行和 at 那一行），再填 B 的长度、at 的下标；sparse 填三元组表。
- 错法诊断认得出：行优先当列优先、对称矩阵另一半没换成 a[j][i]、B 的下标起点差 1、A 的下标起点差 1；sparse 按列扫、行列号起点差 1。
