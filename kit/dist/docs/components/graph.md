### graph：函数图（概率分布、面积、函数性质）

坐标窗口可以不对称，适合画密度函数、分布律、累积概率。

```graph
title: 正态分布：拖动 a 看累积概率
x: -4 4
slider mu -2 2 = 0 label="μ"
slider s 0.5 2 = 1 label="σ"
let a = 1 drag
shade normpdf(x, mu, s) -inf a color=yellow
plot normpdf(x, mu, s) color=blue label=f(x)
plot normpdf(x) color=gray dashed thin
show $P(X \le {a}) = {normcdf(a, mu, s)}$
```

字段：`x: 最小 最大`、`y: 最小 最大`（不写则按曲线自动取）、`xlabel`、`ylabel`、`title`、`q`、`note`、`link`。这节课 `let` 块里定义的量（矩阵、向量、数）在 `graph`、`space` 里也能直接用，和 `scene` 一样。

| 命令 | 作用 |
|---|---|
| `plot f(x)` | 曲线 y = f(x)。可选 `color=` `label=` `dashed` `thin` |
| `shade f(x) a b` | x 从 a 到 b，曲线与 x 轴之间涂色（a、b 可写 `-inf` / `inf` 或变量） |
| `bars f(k) for k 0 10` | 离散分布的柱子。`highlight=k<=3` 让满足条件的柱子更亮 |
| `let a = 1 drag` | 一条可以左右拖的竖线（`snap=0.5` 设步长） |
| `vline 表达式` / `hline 表达式` | 竖 / 横参考线，可加 `label=` |
| `point [x, y]`、`segment [x1,y1], [x2,y2]`、`text "文字" at [x, y]` | 点、线段、文字 |
| `let`、`slider`、`show` | 同 `scene` |
