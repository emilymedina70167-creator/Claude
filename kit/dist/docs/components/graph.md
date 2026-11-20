### graph：函数图（微积分、概率分布）

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
- 平面上的（`equal: on`、`param` `polar` `contour` `slope` `field` `region`、二维的拖点）见完整写法。

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

```graph
id: g-osc
title: 曲率圆
equal: on
x: -3 3
y: -0.5 4.5
f(x) = x^2
let a = 0.7 drag on=f(x) snap=0.05
plot f(x) color=blue
osc K = f(x) at a color=yellow label=曲率中心
show $K = {dec(K, 3)}$，$R = {dec(1/K, 3)}$
goal a = 0 tol=0.03 msg="顶点处曲率最大"
```

**起名字**：`riemann S = f(x) from 0 to 1 n=n mid`、`area A = f(x), g(x) from -1 to 2`，后面的 `show`、`goal` 里 `S`（黎曼和）、`A`（面积 $\int|f-g|$）是一个数。`osc K = f(x) at a`：曲线在 a 处的曲率圆（圆、圆心、到切点的半径），`K` 是曲率；$f'' = 0$ 的地方没有圆、`K` 是 0。

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

**平面上的东西**（两个变量）。`equal: on`：两个方向每单位一样长（写了 `y:` 时画布的高跟着范围变）。参数、极角都是弧度。

- `f(x, y) = 式子`：二元函数。偏导 `f_x(…)` `f_y(…)` `f_xx` `f_xy` `f_yy`，梯度 `f_grad(…)`（一个向量）；实参能给一个点：`f(P)`、`f_grad(P)`。
- `param [x(t), y(t)] for t a b`：参数曲线；`polar r(t) for t a b`：极坐标曲线。末尾 `fill` 涂面（`polar … fill` 是从极点扫过的那一块）。
- `implicit 左 = 右`：隐函数的曲线。`contour 式子 at 值, 值, …`：等高线（一条命令最多 12 条，每条上写着它的值；值能写式子，如 `at f(P)`）。过鞍点的那一条两支交在一起。
- `slope 式子`：$y' = $ 式子的方向场（斜率无穷的地方画竖的）；`flow 式子 from 点`：过这一点的解曲线（画到窗口边）。`field [P, Q]`：向量场的箭头；`flow [P, Q] from 点`：流线。`n=` 一排几个。
- `vector 向量 from 点`：一个箭头（不写 `from` 从原点出发）。`lineint(P, Q, x(t), y(t), t, a, b)`：$\int_L P\,dx + Q\,dy$，$L$ 是参数曲线、$t$ 从 a 到 b（P、Q 里的 x、y 是曲线上的点，$x'$、$y'$ 页面求）。
- `region D = y from 下 to 上 for x a b`（X 型）、`region x from 左 to 右 for y c d`（Y 型）、`region r from 内 to 外 for t α β`（极坐标）；边界没定义的地方不画。`region 条件, 条件, … in D`：条件都成立的地方（`in D` 限在区域 D 里，事件 ∩ 样本空间）。`region … hide` 只起名字不画。
- `strip D at 式子 lo=y1 hi=y2`：区域 D 里的那一条（竖条 / 横条 / 射线上的一段），`y1` `y2` 是页面读出来的上下限，后面的 `show`、`goal`、`int(…)` 里能用；那里区域没定义时读数写「—」。
- `let P = [1, 2] drag`：平面上能拖的点（`snap=0.25`）；`drag on="x + y = 3"` 只能沿这条曲线拖（一开始不在线上的先投上去）。拖不出窗口。
- `int2(式子, x, a, b, y, 下, 上)`：二重积分（先对后一个变量积，下、上能含前一个变量；极坐标自己乘 r）。式子里能写条件：`int2((x + y <= z)*f(x, y), x, 0, 1, y, 0, 1)`。`binormpdf(x, y, μ1, μ2, σ1, σ2, ρ)` 二维正态的密度。拖动中含 `int2` 的读数先留着上一次的数，手停了再算。
- `pick "题目" at [x, y], …` 不写 `on`：学生在平面上点，页面按屏幕上的距离配。

```graph
id: g-polar
title: 极坐标曲线扫过的面积
equal: on
x: -1 2.6
y: -1.6 1.6
slider th 0 6.28 = 1.2 step=0.02 label="θ"
polar 1 + cos(t) for t 0 2pi color=blue label="r = 1 + cos θ" at=0.6
polar 1 + cos(t) for t 0 th color=yellow fill
param [0.3cos(s), 0.3sin(s)] for s 0 th color=pink thin
vector (1 + cos(th))*[cos(th), sin(th)] color=yellow label=r
show 扫过的面积 ${dec(int((1 + cos(t))^2/2, t, 0, th), 4)}$
goal th = pi tol=0.03 msg="上半个"
```

```graph
id: g-lagrange
title: 条件极值
equal: on
x: -1 4
y: -1 4
f(x, y) = x^2 + 2y^2
let P = [0.5, 2.5] drag on="x + y = 3"
implicit x + y = 3 color=pink label="x + y = 3" at=0.25
contour f(x, y) at 2, 12, 20 color=gray
contour f(x, y) at f(P) color=yellow
vector f_grad(P)/8 from P color=yellow label=∇f
vector [1, 1] from P color=pink label=∇g
show $f(P) = {dec(f(P), 3)}$，$f_x = {f_x(P)}$，$f_y = {f_y(P)}$
goal f(P) < 6.02 msg="相切：最小值 6"
```

```graph
id: g-ode
title: 方向场和过一点的解
x: -3 3
y: -4 6
let P = [0, 2] drag snap=0.1
slope y - x
flow y - x from P color=yellow label="过 P 的解"
goal el(P, 2) = el(P, 1) + 1 tol=0.06 msg="这条解是直线 $y = x + 1$"
```

```graph
id: g-field
title: 向量场和沿曲线的积分
equal: on
x: -2.4 2.4
y: -2.1 2.1
slider th 0 6.28 = 1 step=0.02 label="θ"
P(x, y) = -y
Q(x, y) = x
field [P(x, y), Q(x, y)]
param [cos(s), sin(s)] for s 0 th color=yellow
show $\displaystyle\int_L P\,dx + Q\,dy = {dec(lineint(P(x, y), Q(x, y), cos(s), sin(s), s, 0, th), 3)}$，$Q_x - P_y = {Q_x(0, 0) - P_y(0, 0)}$
```

```graph
id: g-region
title: 积分区域里的竖条；事件的概率
equal: on
x: -0.3 1.5
y: -0.3 1.3
f(x, y) = 8x*y
slider a 0.02 0.98 = 0.3 step=0.01 label="x"
slider z 0 2 = 1 step=0.02 label="z"
region D = y from x to 1 for x 0 1 color=blue
region x + y <= z in D color=yellow
strip D at a lo=y1 hi=y2 color=pink
show 竖条上 $y$ 从 ${dec(y1, 2)}$ 到 ${dec(y2, 2)}$，$f_X = {dec(int(f(a, y), y, y1, y2), 3)}$
show $P(X + Y \le z) = {dec(int2((x + y <= z)*f(x, y), x, 0, 1, y, x, 1), 3)}$
```

- 上下限、`for` 的范围里能写式子（括号里的空格不拆）：`shade chi2pdf(x, n) chi2inv(1 - al, n) inf`。
- `bars … highlight=k<=3`、`dots … highlight=n>N`：条件成立的更亮。
- 课堂里：`figure target=g-mvt set c=1.7` / `play h 1.5 0.01 4s` / `highlight 3`（第 3 条命令闪一下），`board mark target=g-mvt at=[2, 1]`。
