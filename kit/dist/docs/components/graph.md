### graph：函数图（一元微积分、概率分布）

式子一律弧度。导数、切线、面积由页面算；间断点自己断开（空心、实心点）。

```graph
id: g-mvt
title: 中值定理：找 ξ
x: -0.5 3.5
f(x) = x^3/4 - x
let c = 0.5 drag on=f(x)
plot f(x) color=blue label=f
secant f(x) at 0, 3 color=pink
tangent f(x) at c color=yellow
show 切线斜率 ${f'(c)}$
goal f'(c) = (f(3) - f(0))/3 msg="平行了"
```

字段：`x: 最小 最大`、`y:`（不写按曲线取）、`title`、`q`、`note`、`link`。命令：

- `f(x) = 式子`：定义函数，后面写 `f(x)`、`f'(x)`、`f''(x)`。
- `plot 式子`（`for x a b` 只画一段）、`shade 式子 a b`（到 x 轴，`-inf` `inf` 可以）、`area f, g from a to b`（两线之间）。
- `tangent 式子 at a`、`secant 式子 at a, b`、`riemann 式子 from a to b n=8`。
- `bars 式子 for k 0 10`（分布律）、`dots 式子 for n 1 30`（数列）。
- `let a = 1 drag`（可拖的竖线；`on=f(x)` 骑在曲线上）、`slider`、`show`、`vline` `hline` `point` `segment` `text`。
- `goal 左 = 右` / `goal 条件`：学生拖到、调到算做到。`pick "题目" on f(x) at 值, …`：学生在图上点出来，页面判。

命令末尾的修饰：`color=` `label=` `dashed` `thin`，`point … hollow` 空心点，`riemann … left / right / mid`，`dots … join` 连线（这几个词只在各自的命令上是修饰，别处是普通的名字），`xlabel:` `ylabel:` 坐标轴的名字。`let` 块里的量能直接用。

**算式里的几种写法**（只在函数图里；`\calc` 不认）：`sum(k, 1, n, 式子)`、`prod(k, 1, n, 式子)`（整数 k 从 1 到 n，最多 20000 项）、`maxof(k, a, b, 式子)` / `minof`；`int(式子, t, a, b)` 数值定积分（上下限能写 `inf`，算不收敛时这张图报写法错误）；`maxon(式子, x, a, b)` / `minon` 区间上的最值；`roots(式子, x, a, b)` 区间上的全部实根（一串数，含端点，极点不算）。`el(v, i)` 向量的第 i 个分量、`len(v)` 有几个。`f'` 对第一个参数求导，能求到三阶；定义里有 `sum`、`abs` 以外不会导的函数时 `f'` 报「求不了导」。

**画出来的样子**：跳跃间断点两头各一个点，函数值等于哪一边哪边实心；可去间断点一个空心点（整点、半整点、π/2 的倍数上的认得出，别处的写 `point [a, b] hollow`）；无穷间断点两边断开，不连竖线；超出窗口的部分裁掉。一点另有一个值的（`(x!=1)*(x+1) + (x==1)*4`）是空心点加那个值的实心点。`plot … dots=off` 不画这些点。分段函数的尖点处 `tangent` 不画（左右差商对不上）；`f'` 只在 `f` 有定义的地方有值。式子处处算不出来（函数名写错、变量没定义、求和超过 20000 项）时这张图报写法错误。求和项数多、一帧画得慢时，拖动中先画粗的，手停了补细的。标签互相让开，`at=0.3` 指定标签挂在横向三成处。

```graph
id: g-disc
title: 间断点
x: -3 4
y: -4 5
f(x) = (x<0)*(x+2) + (x>=0)*(x<2)*(x^2-1)/(x-1) + (x>=2)/(x-3)
plot f(x) color=blue label=f(x) at=0.3
pick "在 $x$ 轴上点出 $f$ 的全部间断点" on x at 0, 1, 2, 3 tol=0.15
```

**`pick`**：`on f(x)` 学生的点落在这条曲线上，目标写 x 的值；`on x` 点在 x 轴上；不写 `on` 是平面上随便点，目标写 `[x, y]`。目标能写式子：`at roots(f'(x), x, -3, 3)`。`tol=` 算点到了的距离（默认窗口宽的 4%）。学生点一下加一个点，点在已有的点上是去掉；按「检查」页面一对一配：配上的变绿、多的变红，说「有 1 个不在这里，还差 1 个」（不说漏的在哪）；检查三次没对出现「看答案」。每次检查记一条作答：点了哪些值、对不对、页面说的那句；看答案记 `giveup`。目标算不出来、或者学生点不到（在窗口外、曲线在那里没定义）时这张图报写法错误，「检查」不能按。

**`goal`**：`goal f'(c) = 0 tol=0.05 msg="…"`（差不到 `tol` 算做到，默认 0.05），或者一个条件 `goal maxon(abs(f(x) - 3), x, 2 - d, 2 + d) < eps`。学生自己拖、自己调到才算；图一画出来就成立的、用 `figure set / play` 摆上去的不算（学生挪开再放回才算）。式子算不出来时这张图报写法错误。做到了侧栏写 `msg`，记一条作答。

**`after` / `before`**：写在命令或 `show` 的末尾，图里的 `goal`、`pick` 全做到（或看了答案）以后才显示 / 之前才显示（`goal`、`pick` 自己不能写）。

```graph
id: g-ext
title: 极值点
x: -2.5 2.5
y: -4 4
f(x) = x^3 - 3x
plot f(x) color=blue label=f
pick "点出 $f$ 的全部极值点" on f(x) at roots(f'(x), x, -2.5, 2.5) tol=0.15
plot f'(x) color=pink dashed label="f′" after
```

**起名字**：`riemann S = f(x) from 0 to 1 n=n mid`、`area A = f(x), g(x) from -1 to 2`，后面的 `show`、`goal` 里 `S`（黎曼和）、`A`（面积 $\int|f-g|$）是一个数。

```graph
id: g-riemann
title: 黎曼和
x: -0.2 1.3
y: 0 1.3
f(x) = x^2
slider n 1 60 = 5 step=1 label="n"
plot f(x) color=blue label="y = x²"
riemann S = f(x) from 0 to 1 n=n mid color=yellow
show $S_n = {dec(S, 5)}$，$\displaystyle\int_0^1 x^2\,dx = {int(f(t), t, 0, 1)}$
```

```graph
id: g-area
title: 两条曲线围成的面积
x: -1.6 2.6
y: -0.6 4.6
area A = x + 2, x^2 from -1 to 2 color=yellow
plot x + 2 color=pink label="y = x + 2" at=0.7
plot x^2 color=blue label="y = x²" at=0.95
show 面积 ${A}$
```

```graph
id: g-series
title: 数列的点、级数的部分和、泰勒多项式
x: 0 31
y: 0 2.2
slider m 0 6 = 1 step=1 label="m"
dots sum(k, 1, n, 1/k^2) for n 1 30 color=blue join label="Sn"
hline pi^2/6 color=pink label="π²/6"
show $\sin 2 \approx {dec(sum(k, 0, m, (-1)^k*2^(2k+1)/(2k+1)!), 5)}$
```

**概率**：密度、分布律、分布函数直接写函数名（见「表达式」）。几组 `bars` 并排画。

```graph
id: g-norm
title: 正态分布：拖动 a 看累积概率
x: -4 4
slider mu -2 2 = 0 label="μ"
slider s 0.5 2 = 1 label="σ"
let a = 1 drag
shade normpdf(x, mu, s) -inf a color=yellow
plot normpdf(x, mu, s) color=blue label=f(x)
bars binompmf(k, 6, 0.5)/4 for k 0 3 color=pink
show $P(X \le {a}) = {normcdf(a, mu, s)}$
```

```graph
id: g-chi2
title: χ²(n) 的上 α 分位点
x: 0 30
y: 0 0.26
slider n 1 15 = 4 step=1 label="n"
let c = 4 drag snap=0.01
shade chi2pdf(x, n) c inf color=yellow
plot chi2pdf(x, n) color=blue label="χ²(n)" at=0.6
show 右边的面积 ${dec(1 - chi2cdf(c, n), 4)}$
goal 1 - chi2cdf(c, n) = 0.05 tol=0.002 msg="这里是 $\chi^2_{0.05}(n)$"
show $\chi^2_{0.05}(n) = {dec(chi2inv(0.95, n), 3)}$ after
```

- 上下限、`for` 的范围里能写式子（括号里的空格不拆）：`shade chi2pdf(x, n) chi2inv(1 - al, n) inf`。
- `bars … highlight=k<=3`、`dots … highlight=n>N`：条件成立的更亮。
- 课堂里：`figure target=g-mvt set c=1.7` / `play h 1.5 0.01 4s` / `highlight 3`（第 3 条命令闪一下），`board mark target=g-mvt at=[2, 1]`。
