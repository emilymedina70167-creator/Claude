### sim：抽样模拟（大数定律、中心极限定理、抽样分布、置信区间）

从一个分布里一次次抽 n 个，看统计量长什么样。随机数带种子：同一张图每次打开是同一组数。按钮「抽一次 / 抽 100 次 / 抽 1000 次 / 清空」。

```sim
id: s-clt
draw: X ~ Exp(1)
slider n 1 60 = 2 step=1
stat: z
curve: normpdf(x, 0, 1) label="N(0, 1)"
x: -4 4
show 模拟了 {reps} 次；平均 {dec(mean, 3)}、方差 {dec(var, 3)}
```

- `draw:` 分布照教材写：`N(μ, σ²)`（第二个是方差）、`U(a, b)`、`Exp(λ)`、`B(n, p)`、`P(λ)`、`Geo(p)`。
- `stat:` 画哪个统计量：`mean` `sum` `S2` `var`（除以 n）`z` `t` `chi` `max` `min` `median`。
- `view:` `hist`（直方图）/ `path`（样本均值的路径）/ `intervals`（一排置信区间）/ `scatter`（散点）；别的字段见完整写法。

| 字段 | 作用 |
|---|---|
| `draw: X ~ 分布` | `N(μ, σ²)`、`U(a, b)`、`Exp(λ)`（均值 1/λ）、`B(n, p)`、`P(λ)`、`Geo(p)`（第几次才成功，从 1 数）、`chi2(n)`、`t(n)`、`{0: 0.5, 1: 0.3, 4: 0.2}`（离散）；成对的 `(X, Y) ~ N2(ρ)`（标准二维正态）。参数能写滑块的名字 |
| `n: 30` 或 `slider n 1 60 = 5 step=1` | 每次抽几个。滑块一动就清空重来 |
| `slider 名字 小 大 = 初值 step= label=` | 别的滑块（分布的参数） |
| `stat:` | `mean` `sum` `var`（除以 n）`S2`（除以 n − 1）`S` `max` `min` `median`；`z` = $(\bar X-\mu)/(\sigma/\sqrt n)$、`t` = $(\bar X-\mu)/(S/\sqrt n)$、`chi` = $(n-1)S^2/\sigma^2$（μ、σ 是这个分布的理论值）；或者用 `xbar` `S` `S2` `var` `n` `mu` `sigma` `total` `max` `min` 写的式子 |
| `view: hist` | 统计量的直方图（面积按全部次数算）。`bins:`、`x: 左 右`、`y:`；`discrete: on` 时一个取值一根（和、次数） |
| `curve: 式子 label="…"` | 叠在直方图上的理论曲线（x 的函数，能用 `n` `mu` `sigma` 和滑块；`discrete: on` 时在整数上画点）。能写几条 |
| `view: path` | 一次画一条：抽 n 个的过程里样本均值怎么走。`band: 0.05` 画 μ ± ε 的带子 |
| `view: intervals` | 一次一个均值的置信区间，没盖住 μ 的标红。`level: 0.95`、`sigma: known / unknown`（已知用正态的分位点，未知用 t 和 S） |
| `view: scatter` | 配 `N2(ρ)`：一次抽 n 个点 |
| `seed: 7` | 种子（不写是 1） |
| `show 文字 {式子}` | 读数：`reps`（抽了几次）、`mean` `var`（这些统计量的平均、方差）、`last`、`n` `mu` `sigma`、滑块；路径的 `inband`（最后落在带子里的占比）；区间的 `total` `miss` `cover`；散点的 `r` |
| `ask: "题目" = 式子` | 我填一个数，按式子现在的值判（理论值，不是模拟出来的） |

- 模拟出来的数只拿来看；判对错用的是式子算的值。
- 一张图最多攒 20000 次；抽 1000 次约 0.2 秒。路径只画最近 24 条、区间只画最近 40 个，计数是全部的。
- 切比雪夫的界写在读数里：`{dec(1 - sigma^2/(n*band^2), 3)}`。
- 作答记成 `type: sim`；拖滑块记一个动作。

```sim
id: s-ci
draw: X ~ N(10, 4)
n: 8
view: intervals
level: 0.95
sigma: unknown
seed: 5
show {total} 个区间里 {miss} 个没盖住 $\mu$
```
