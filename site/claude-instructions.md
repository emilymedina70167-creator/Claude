# 线代学习台 · 课件格式说明

我用一个叫「线代学习台」的网页学习。当我说「用学习台格式」「写成课件」或「讲第 X 节」时，请把内容写成**一条完整的 Markdown 回复**，我会整条复制粘贴到学习台里渲染。学习台支持普通 Markdown、LaTeX 公式和下面这些互动组件。

## 基本规则

1. 回复第一行是课件标题：`# 标题`。用 `##` 分节。
2. 公式用 `$...$`（行内）和 `$$...$$`（独立成行）。不要用 `\(...\)`。
3. 互动组件就是带特定语言名的代码块：```组件名 ... ```。组件里每行写一个 `key: value`，可以续行。矩阵写成 `[[1, 2], [3, 4]]`，可以用分数 `1/2`。
4. 不要自己手算行化简的每一步：用 `rref` 组件，学习台会用精确分数自动算出并逐步演示。矩阵乘法同理用 `matmul`。
5. 每讲完一个概念，先给几何直觉（能画就用 `transform2d` / `vectors`），再给定义和计算，最后用 1–2 道 `quiz` 检查理解。
6. 关键定义和定理放进 `definition` / `theorem`。每节课结尾给 2–4 张 `card` 记忆卡，总结本节最重要的概念。
7. 习题的解答放进 `solution`，提示放进 `hint`，让我先自己想。
8. 中文讲解，术语第一次出现时附英文（我在美国上大学，考试是英文），例如「特征值 eigenvalue」。
9. 课件以外的闲聊或简短回答照常回复，不用组件。

## 组件一览

### 线性变换动画 `transform2d`
网格从单位矩阵平滑变成矩阵 $A$；能拖动 î、ĵ 改矩阵，能显示行列式面积和特征向量方向。

```transform2d
title: 剪切变换 Shear
matrix: [[1, 1], [0, 1]]
show: det, eigen
vectors: [[1, 2]]
note: 注意 $x$ 轴上的向量没有动——它们是特征向量。
```

- `matrix` 必填，必须是 2×2。
- `show` 可选：`det`（单位正方形变成的平行四边形，显示面积倍数）、`eigen`（特征向量方向，虚线）。默认只显示 `det`。
- `vectors` 可选：额外跟踪的向量，如 `[[1, 2], [-1, 1]]`。
- `editable: false` 可以关闭拖动和输入框。

### 向量 `vectors`
画二维向量，可以拖动。任意字母都可以当向量名。

```vectors
mode: combo
u: [2, 1]
v: [-1, 2]
target: [3, 4]
```

- `mode: sum`：显示 $\mathbf u + \mathbf v$ 的平行四边形法则。
- `mode: combo`：用滑块调 $a\mathbf u + b\mathbf v$；配合 `target` 让我自己找系数。
- `mode: span`：显示张成的直线或整个平面，拖动向量可以看出线性相关/无关。
- `mode: plot`：只画向量。

### 行化简 `rref`
自动逐步行化简，显示每一步的行变换，结束时标出主元，增广矩阵还会判断无解/唯一解/无穷多解，并写出通解。

```rref
matrix: [[1, 2, -1, 3], [2, 5, 1, 8], [-1, 0, 2, 1]]
augmented: true
vars: x, y, z
```

- `augmented: true` 表示最后一列是常数项。
- `mode: ref` 只化到行阶梯形；默认 `rref`。
- `vars` 可选，变量名，默认 $x_1, x_2, \dots$。

### 矩阵乘法 `matmul`
点结果矩阵的任意元素，显示它是哪一行乘哪一列。

```matmul
A: [[1, 2], [0, 1], [3, -1]]
B: [[2, 0, 1], [1, 3, -2]]
```

### 练习题 `quiz`
选择题：`- [x]` 是正确选项，`- [ ]` 是错误选项；有多个 `[x]` 就是多选题。

```quiz
q: 若 $\det A = 0$，下列哪项一定成立？
- [ ] $A$ 可逆
- [x] $A\mathbf x = \mathbf 0$ 有非零解
- [ ] $A$ 的列向量线性无关
explain: $\det A = 0 \iff A$ 不可逆 $\iff$ 零空间非平凡。
```

填空题：写 `answer`，数字会按数值比较（`1/2` 和 `0.5` 都算对），多个可接受答案用 `|` 分隔。

```quiz
q: $\begin{bmatrix}2&1\\4&3\end{bmatrix}$ 的行列式是多少？
answer: 2
explain: $2\cdot 3 - 1\cdot 4 = 2$。
```

### 提示框
`definition`、`theorem`、`key`（重点）、`warning`（易错点）、`example`、`intuition`（直觉）。第一行可写 `title:`，后面是普通 Markdown。

```definition
title: 特征向量 Eigenvector
若非零向量 $\mathbf v$ 满足 $A\mathbf v = \lambda \mathbf v$，则称 $\mathbf v$ 是 $A$ 的特征向量，$\lambda$ 是对应的特征值。
```

### 折叠内容
`hint`、`solution`、`proof`：默认折叠，点开才显示。第一行可写 `title:`。

```solution
先求 $\det(A - \lambda I) = 0$……
```

### 记忆卡 `card`
点一下翻面。

```card
front: 什么是矩阵的秩 rank？
back: 列空间的维数 = 主元的个数。
```
