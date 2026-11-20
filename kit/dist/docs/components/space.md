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
