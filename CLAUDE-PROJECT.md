# 线代学习台 · 课件格式说明

我用「线代学习台」组件库学习线性代数（在 iPad 上看）。**讲课、讲例题、出练习时，请做成一个 artifact**，课件内容用 Markdown 写在 `<script type="text/markdown">` 里，组件库会把它渲染成互动课件（变换动画、可拖动向量、逐步行化简、练习题、记忆卡等）。

## 组件库在哪里

组件库是我的 artifact「线代学习台」里的文件 `la-kit.js`：

- 组件库 artifact：https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF
- 文件路径：`la-kit.js`

artifact 不能从 GitHub 或其他网站加载脚本，所以**每次发布课件 artifact 时，都要用 `files` 参数把这个文件从组件库 artifact 复制过来**（服务器端复制，不需要下载，也不要自己写或粘贴 `la-kit.js` 的内容）：

```json
{ "la-kit.js": { "artifact": "https://claude.ai/artifact/5ZUhFR5T5i1wMysQmthoAF", "path": "la-kit.js" } }
```

## 课件页面模板（必须照这个写）

```html
<title>第 3 课 · 特征值</title>
<script src="la-kit.js"></script>
<script type="text/markdown">
# 第 3 课：特征值与特征向量

正文……
</script>
```

页面就是这几行，不需要 `<!doctype>`、`<html>`、`<head>`、`<body>`。`<title>` 写简短的课名。

## 规则

1. 不要自己写 CSS、JavaScript 或 SVG，也不要从 CDN 加载任何库——样式、公式、互动全部由 `la-kit.js` 负责。你只写 `<script type="text/markdown">` 里的内容。
2. 内容第一行是 `# 标题`，用 `##` 分节。正文是普通 Markdown，不需要转义 `<`、`&`。不要在内容里写 `</script>`。
3. 公式用 `$...$`（行内）和 `$$...$$`（独立成行）。
4. 互动组件就是带特定语言名的代码块（见下方「组件一览」）。组件里每行一个 `key: value`，可以续行。矩阵写成 `[[1, 2], [3, 4]]`，可以用分数 `1/2`。
5. **不要自己手算行化简的每一步**：用 `rref` 组件，组件库会用精确分数自动算出并逐步演示，还会判断解的情况。矩阵乘法同理用 `matmul`。如果要在文字里引用结果，确保和组件算出的一致。
6. 讲一个概念的顺序：几何直觉（能画就用 `transform2d` / `vectors`）→ 定义/定理（`definition` / `theorem`）→ 例题（`example`，计算用 `rref` / `matmul`）→ 1–2 道 `quiz` 检查理解。
7. 习题解答放进 `solution`，提示放进 `hint`，让我先自己想。易错点用 `warning`。
8. 每节课结尾放 2–4 张 `card` 记忆卡，总结本节最重要的概念。
9. 中文讲解，术语第一次出现时附英文（我在美国上大学，考试是英文），例如「特征值 eigenvalue」。
10. 每节课发布成一个新的 artifact；太长时可以分成「上」「下」两个。简短的问答、闲聊照常在对话里回复，不用做 artifact。
11. 如果页面显示「组件出错」，说明某个组件写法不对，请对照下方格式修正后重新发布。如果整页只显示 Markdown 原文，说明 `la-kit.js` 没有复制成功，请检查 `files` 参数。
12. 不要修改、重新发布或删除组件库 artifact 本身。

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
