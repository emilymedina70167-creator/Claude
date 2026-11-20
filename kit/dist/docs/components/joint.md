### joint：联合分布表（二维离散型：边缘、条件、独立、Z 的分布、协方差）

行是 X 的取值、列是 Y 的取值。边缘、条件分布、期望方差协方差、Z = g(X, Y) 的分布都是页面算的（分数）。

```joint
id: j-xy
X: 0 1 2
Y: 0 1
p: 1/10 1/5; 1/5 3/10; 1/10 1/10
z: X + Y
ask: margins
ask: independent
ask: Cov(X, Y)
```

- `p:` 一行是 X 的一个取值，分号或换行分行。点一行 / 一列的表头，页面写出那个条件下的分布。
- `z:` Z 的式子：取值相同的格子同一种颜色，下面一张 Z 的分布表。
- `ask:` `margins`（填边缘）、`z`（填 Z 的分布）、`independent`、`cells`、一个量（`E(X)`、`Cov(X, Y)`、`P(X + Y <= 1)`）；`show`、空着的格见完整写法。

| 字段 | 作用 |
|---|---|
| `X: 0 1 2`、`Y: 0 1` | 取值（能是负数、分数） |
| `p: …; …` | 概率表，`?` 是空着的格 |
| `px: 1/3 2/3`、`py: …`、`independent: on` | 补空着的格用的条件（X 的边缘、Y 的边缘、独立）；加上「和是 1」补不出来页面报错 |
| `show: margins, moments, independent` | 页面写出来的：边缘（写在表边上）、矩（E、D、Cov、ρ）、独立不独立（不独立时写出一格对不上的） |
| `z: max(X, Y)` | Z = g(X, Y)：`X + Y`、`X*Y`（`XY`）、`max(X, Y)`、`min(X, Y)`、`abs(X - Y)`…… |
| `ask: margins` | 我在表边的格子里填边缘，逐格判，错的格标出来 |
| `ask: cells` | 我填表里空着的格（配 `px` / `py` / `independent`） |
| `ask: z` | 我填 Z 的分布表（取值页面写好） |
| `ask: independent` | 我点「独立 / 不独立」；不独立的还要在表里点出一格（它的概率不等于两个边缘的乘积）才算完 |
| `ask: "题目" 量` | 我填一个数 |

- 能问的量：`E(X)`、`E(XY)`、`E(X^2)`、`E(2X - Y)`，`D(X)`、`D(X + Y)`，`Cov(X, Y)`，`rho`，`P(X + Y <= 1)`、`P(X = Y)`、`P(X = 1, Y = 0)`、`P(X = 1 | Y = 0)`。
- 相关系数开不尽时页面写成最简根式；我写小数（三位有效数字）或 `-sqrt(6)/21` 都认。
- 页面认的错法（`misread`）：协方差只算了 E(XY)（`exy-for-cov`）、方差只算了 E(X²)（`ex2-for-var`）、相关系数填成协方差（`cov-for-rho`）、条件概率没除（`joint-for-cond`）、符号反了（`sign`）。
- 一组格子没填完不判；检查三次没对出「看答案」。作答记成 `type: joint`。

```joint
id: j-ind
q: $X$、$Y$ 独立。
X: 0 1
Y: -1 0 1
p: 1/12 ? ?; ? 1/4 ?
px: 1/3 2/3
independent: on
ask: cells
```
