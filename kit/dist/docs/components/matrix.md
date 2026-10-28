### matrix：会动的矩阵

几个矩阵和公式排成一行。变量变了（拖滑块、绑定的 `steps` 揭开一步、课堂里的 `figure set` / `play`），值变了的格子会闪一下，挪了位置的数会飞过去。适合演示「一步步变」的过程：幂次、分块、乘积是怎么来的。

```matrix
id: m-pow
title: B 的幂：1 往右上角退
let B = [[0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1], [0, 0, 0, 0]]
slider k 1 4 = 1 step=1 label="k" play
matrix B^k label="B^{\calc{k}} ="
```

字段：`id`、`title`、`q`（上方说明）、`note`（下方备注）、`link`（绑定 `steps`，用法同 `scene`）。命令一行一条，按顺序从左到右排：

| 命令 | 作用 |
|---|---|
| `let 名字 = 表达式` | 定义变量（同 `scene`） |
| `slider 名字 最小 最大 = 初值` | 滑块，默认 `step=1`（值取整，`B^k` 可以拖着看）。可选 `label="k"`、`play` |
| `matrix 表达式` | 画出它的值：矩阵、向量（画成一列）、数（不带括号）。一律精确分数。可选 `label="A ="`（左边的 TeX）、`name=A`（给 `mark`、`split` 认；表达式就是一个变量名时默认用它）、`from=k` / `until=k` |
| `tex 公式` | 两个矩阵之间的一段公式：`tex =`、`tex \times`、`tex +` |
| `split rows=2 cols=1` | 分块虚线：第 2 行下面、第 1 列右边各画一条（几条用逗号：`rows=1,3`）。管前面最近的那个矩阵，或者写 `of=名字` |
| `mark row 2 note="×2"` | 画好就带着的标注：`row` / `col` / `diag` / `entry=2,3` / `block=1,2`，可加 `note=`、`color=`、`style=`、`of=`、`from=k` / `until=k`（写法同课堂的 `board mark`） |
| `product A B` | 画出 $A\times B=AB$；我点结果里的任意一个数，就亮出 $A$ 的那一行、$B$ 的那一列，下面写出对应相乘再相加。可选 `name=C`（结果的名字） |

- 标签和 `tex` 里可以写 `\calc{…}`，跟着变量变：上例滑到 3 时标签是 $B^{3}=$。
- 写错（表达式算不出来、尺寸对不上、`mark` 的行号超出矩阵、`split` 的位置不对）：组件下面红字报出来，自检也会报。
