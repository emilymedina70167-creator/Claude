### space：三维图（可以拖动旋转）

三维向量、张成的平面、平行六面体（体积 = 行列式）。我可以用手指或 Pencil 拖动旋转，还有「正视角」「转一转」按钮。

```space
title: 两个向量张成一个平面
let u = [1, 0, 1]
let v = [0, 1, 1]
slider a -2 2 = 1
slider b -2 2 = 1
span u, v color=blue
vector u color=blue label=u
vector v color=pink label=v
vector a*u + b*v color=yellow label=w drop
show $\mathbf w = a\mathbf u + b\mathbf v = {a*u + b*v}$
```

- `vector 表达式`（`from 点`；`drop` 加一条到地面的虚线）、`point P, …`、`segment P, Q`、`line P dir d`、`text "文字" at P`、`let`、`slider`、`show`。
- `span u, v`：过原点的平面（共线时是直线；三个向量张成全空间时注明）。`plane normal n at P`：过 P、法向量 n 的平面。`box u, v, w`：平行六面体。`grid M`：地面网格在 3×3 矩阵 M 下的像。
- `quadric A = c`：二次曲面 $\mathbf x^{\mathsf T}A\mathbf x=c$ 的线框（A 是 3×3 对称矩阵），左上角写着是什么曲面。
- 平面写方程和交线、三个平面的情形、三阶的特征方向、曲面、旋转体、积分区域、能拖的点和 `goal` / `pick`：见完整写法。

字段：`range`（坐标范围，默认自动）、`view: 方位角 仰角`（默认 `-32 22`）、`spin: true`（打开时慢慢转）、`title`、`q`、`note`、`link`。

**角度还是弧度**：图里写了函数定义（`f(x, y) = …`）或者 `surface` `curve` `section` `tangent` `revolve` `disk` `shell` `region` `solid` `column` `slice` `field` `normals` 任何一条，整张图的三角函数按弧度；别的图照旧按角度（`cos(60)`、`rot(…)`）。`angle: rad` / `angle: deg` 明着定。`z: 下 上`：竖直方向看哪一段（不写时微积分的图自动对准内容的中间）。用了下面这些写法的图是上下排的（图在上、读数在下）。

**平面、直线（空间解析几何；三个平面的位置关系）**

- `plane 2x + y - z = 3`：写方程的平面（一次式），画的是它在范围里的那一块；前面能起名 `plane p1 = …`。几张平面互相切开、按远近画。
- `line l1 = [1, 0, 0] dir [1, 1, 1]`：直线能起名。
- `meet p1, p2`：两个平面的交线（平行、重合时读数下面写一行）。`meet p1, p2, p3`：三个平面——两两的交线、公共点画出来，读数下面写是哪种情形和两个秩，如「r(A) = 2，r(A, b) = 3：无解（两两相交，三条交线互相平行，围成三棱柱）」。
- `angle p1, p2`：夹角的弧（两个平面、两条直线、直线和平面）。`foot [1, 2, 3] on p1`：点到平面 / 直线的垂线段和垂足。
- 起了名字的平面、直线在式子里是一个量：`dist(点, p1)`（点到平面、到直线、两点的距离）、`angleof(p1, p2)`（弧度）、`angledeg(p1, l1)`（度）。平面也能直接写成 `[a, b, c, d]`（$ax + by + cz = d$）。
- `eigen A`：3×3 矩阵的实特征方向（一条线；重根有两个方向时是一张平面），线上写着 λ；特征向量不够 3 个时读数下面写一行。

```space
id: sp-planes
title: 三个平面
range: 3
slider d -2 2 = 1 step=0.25 label="d"
plane p1 = y = 0
plane p2 = z = 0
plane p3 = x/2 + y + z = d
meet p1, p2, p3 color=white label=P
meet p1, p2 color=yellow label=l
angle p2, p3 label=θ
foot [1, 2, 2] on p2 label=H
show 夹角 ${dec(angledeg(p2, p3), 1)}^\circ$，点到 $\pi_2$ 的距离 ${dist([1, 2, 2], p2)}$
goal d = 0 tol=0.01 msg="三个平面都过原点"
```

```space
id: sp-eig
title: 特征方向
range: 3
let A = [[2, 0, 0], [0, 3, 4], [0, 4, 9]]
slider th 0 360 = 40 step=1 label="θ"
let v = [cos(th), sin(th), 0.5]
eigen A
vector v color=blue label=v
vector A*v/5 color=pink label="Av/5"
```

**曲面、空间曲线（多元函数、二次曲面）**

- `surface z = f(x, y)`：显式曲面。`for x a b, y c d` 给范围（`y` 的上下限能含 `x`；下限是一个不带空格的式子）；`for r 0 2, t 0 2pi` 是极坐标的底；`over D` 贴着一个 `region`；不写就是整个范围。
- `surface [x(u, v), y(u, v), z(u, v)] for u a b, v c d`：参数曲面。`surface x^2 + y^2 - z^2 = 1`：任意方程的曲面，按三族平面的截痕画线框（柱面、锥面、抛物面、双曲面都行）。前面能起名 `surface S = …`。
- `curve [cos(t), sin(t), t/3] for t 0 4pi`：空间曲线，能起名。
- `section x = a of S`（或 `y = b`、`z = c`）：曲面 S 被这张平面截出来的曲线（显式曲面和写方程的曲面）。
- `tangent S at [a, b]`：曲面在这一点的切平面和法向量（参数曲面写 `[u, v]`，写方程的曲面写曲面上的点 `[x, y, z]`）；`tangent C at t0`：曲线的切线，末尾加 `plane` 画法平面。导数是页面求的。
- `normals S n=5`：曲面上的法向量（参数曲面朝 $r_u \times r_v$ 那一侧）。`field [P, Q, R] n=4`：空间向量场。

```space
id: sp-surf
title: 曲面、截痕、切平面
range: 2.5
f(x, y) = 3 - x^2/2 - y^2/3
let P = [1, 0.5] drag on=S snap=0.05
slider b -2 2 = 0.8 step=0.05 label="y₀"
surface S = z = f(x, y) for x -2.2 2.2, y -2.2 2.2 color=blue
section y = b of S color=pink
tangent S at P color=yellow
show $f_x = {dec(f_x(P), 3)}$，$f_y = {dec(f_y(P), 3)}$
goal norm(f_grad(P)) < 0.12 msg="切平面水平：驻点"
```

```space
id: sp-quad
title: 写方程的曲面、参数曲面、空间曲线
range: 2.5
slider c -1 1 = 0.6 step=0.05 label="c"
surface x^2 + y^2 - z^2 = c color=blue
surface T = [0.5sin(v)*cos(u), 0.5sin(v)*sin(u), 0.5cos(v)] for v 0 pi, u 0 2pi color=pink
normals T n=3 color=yellow
curve C = [2cos(t), 2sin(t), t/3 - 2] for t 0 4pi color=green
tangent C at 2 plane color=yellow
field [0, 0, 0.3z] n=3 color=gray
```

**能拖的点、点一点**：`let P = [1, 0.5] drag`（`snap=`）是地面（xy 平面）上能拖的点；`drag on=S` 时曲面上对应的那一点也是把手，手指指到曲面上哪点就到哪。按在把手上是拖点，别处是转视角；视线和地面的夹角小于 8° 时地面上的点拖不动。`pick "题目" at [x, y], …`：学生在地面上点；`pick "题目" on S at [x, y], …`：点在曲面 S 上（记的是它下面的 `[x, y]`；被前面的曲面挡住的地方要转一下才点得到）。`goal`、`after` / `before` 和 graph 一样。

```space
id: sp-pk
title: 在曲面上点出驻点
range: 2.5
view: 20 60
f(x, y) = (x^3 - 3x + y^2)/2
surface S = z = f(x, y) for x -2.2 2.2, y -2 2 color=blue
pick "在曲面上点出两个驻点" on S at [1, 0], [-1, 0] tol=0.35
tangent S at [1, 0] color=yellow after
```

**旋转体、积分区域**

- `revolve V = sqrt(x) for x 0 4 about x`：$y = f(x)$ 绕 x 轴转出来的面（`about y` 绕 y 轴，图里竖着的那根轴）；`upto=角` 转到哪。起了名字的 `V` 是体积（转到 `upto` 的那一部分）；`area=S` 把侧面积 $2\pi\int|f|\sqrt{1 + f'^2}\,dx$ 记成 `S`（绕 x 轴的）。`disk V at x0`：一片圆盘（绕 x 轴的）；`shell V at x0`：一层柱壳（绕 y 轴的）。
- `region D = r from 0 to 2 for t 0 2pi`：地面上的区域（写法和 graph 的一样；`hide` 只起名字）。
- `solid T = z from 下 to 上 over D`（或 `for x a b, y c d`）：两张曲面之间的区域，画底、顶和侧面。`solid K = rho from 0 to 2 for phi 0 pi/4, t 0 2pi`：球面坐标的区域。
- `column T at P lo=z1 hi=z2`：区域里过地面上的点 P 竖着的一根（先一后二），`z1` `z2` 是页面读的上下限；P 在底的外面时读数写「—」。`slice T at z0 area=A`：平面 $z = z_0$ 截出来的那一块（截面法），`A` 是页面积出来的面积。
- 式子里的积分：`int3(式子, x, a, b, y, c, d, z, e, f)` 三重积分（后面的上下限能含前面的变量；柱面、球面坐标把雅可比写进式子）；`flux(P, Q, R, x(u, v), y(u, v), z(u, v), u, a, b, v, c, d)` 通量 $\iint_\Sigma \mathbf F\cdot d\mathbf S$（朝 $r_u \times r_v$ 那一侧）；`lineint3(P, Q, R, x(t), y(t), z(t), t, a, b)` 空间曲线上的 $\int_L P\,dx + Q\,dy + R\,dz$。算不出来（发散、核不准）报「页面算不出来」。

```space
id: sp-rev
title: 旋转体
range: 4
slider th 0 6.2832 = 4 step=0.02 label="转到" play
revolve V = sqrt(x) for x 0 4 about x upto=th color=blue
disk V at 2.5 color=yellow
show 体积 ${dec(V, 3)}$
```

```space
id: sp-shl
title: 柱壳
range: 2.2
slider x0 0.1 1.9 = 0.6 step=0.02 label="x₀"
revolve W = x*(2 - x) for x 0 2 about y color=blue
shell W at x0 color=yellow
show $V = {dec(W, 4)}$
```

```space
id: sp-sol
title: 区域：先一后二、截面法
range: 2.5
let P = [1, 0.5] drag snap=0.05
slider h 0.1 4 = 3 step=0.05 label="z₀"
region D = r from 0 to 2 for t 0 2pi color=gray
solid T = z from x^2 + y^2 to 4 over D color=blue
column T at P lo=z1 hi=z2 color=pink
slice T at h area=A color=yellow
show $z$ 从 ${dec(z1, 2)}$ 到 ${dec(z2, 2)}$，$A(z_0) = {dec(A, 3)}$，$V = {dec(int3(r, t, 0, 2pi, r, 0, 2, z, r^2, 4), 3)}$
show 球面上的通量 ${dec(flux(x, y, z, sin(v)*cos(u), sin(v)*sin(u), cos(v), v, 0, pi, u, 0, 2pi), 3)}$，环流 ${dec(lineint3(-y, x, 0, cos(t), sin(t), 0, t, 0, 2pi), 3)}$
```
