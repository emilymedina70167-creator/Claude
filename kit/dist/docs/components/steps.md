### steps：一步步揭开的例题（带着动脑，最推荐）

我不看一整道写好的例题，而是**每一步揭开前，先写下下一步要做什么、为什么**（打字，或者粘贴手写截图），然后才看到真实的一步。我的想法留在原处，和真实步骤并排对照。

```steps
id: ex-rank1
title: 例2.1 求 Aⁿ
q: 设 $\boldsymbol\alpha=[1,2]^{\mathrm T}$，$\boldsymbol\beta=[1,1]^{\mathrm T}$，$A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$，求 $A^n$。

step: 写出 $A^2$
ask: 先别算矩阵。$A^2$ 用 $\boldsymbol\alpha$、$\boldsymbol\beta$ 怎么写？
show: $A^2=(\boldsymbol\alpha\boldsymbol\beta^{\mathrm T})(\boldsymbol\alpha\boldsymbol\beta^{\mathrm T})$

step: 换个括号
ask: 中间哪两个可以先乘？乘出来是什么形状？
choices: 一个数 | 一个 2×2 矩阵 | 一个 1×2 行向量
answer: 一个数
show: 结合律：$=\boldsymbol\alpha(\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)\boldsymbol\beta^{\mathrm T}$，$\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是一个数。

step: 推到 n 次
do: true
answer: $(\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)^{n-1}A$
show: $A^n=(\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)^{n-1}A$
```

- 开头的 `id:`（必写，同一单元不重复）、`title:`、`q:`（题目，一直显示）。
- 每个 `step:` 开始一步（后面是小标题）。`ask:` 是揭开前问我的问题：我先交一次想法（或点「想不出来」，记一条「放弃」）才能揭开。
- `choices:` 用 `|` 分隔，变成选项按钮；`answer:` 是正确选项，选完立刻显示对错，不管对错都能揭开。
- `show:` 是揭开后显示的真实步骤。
- `do: true`：这一步不揭开，我自己做出来（`answer:` 能算出数 / 向量 / 矩阵时页面判对错，`formula: n` 判含 n 的式子）。同一种题逐步撤脚手架：第一道全揭开，第二道最后一步 `do: true`，第三道全部 `do: true`。

- `do: true` 的判法：`answer:` 能算出数 / 向量 / 矩阵时（如 `answer: [1, 2]`），我在格子里填、程序判对错；加了 `formula: n` 时，`answer:` 是含 $n$ 的式子（如 `3^(n-1)*A`），我写式子、页面代值判对错（同 `answer` 组件）；其余情况我自由作答，再对照 `answer` / `show`。做完可以「对照答案」。


### steps 联动：图跟着步骤动

`scene`（以及下面的 `graph`、`space`）写 `link: steps 的 id`，图就固定在这道题旁边（宽屏在右侧，窄屏在上方吸顶），并且：

- 表达式里可以用 `step`（已经揭开的步数：开始是 0，揭开第 1 步后是 1）。
- 命令后加 `from=k` / `until=k`：揭开到第 k 步起 / 为止才显示。
- 每揭开一步，变量 `t` 从 0 动到 1（约 0.8 秒），做过渡动画，比如 `grid lerp(I, A, t) from=1`。

```scene
title: 秩一矩阵把平面压成一条线
link: ex-rank1
let A = [[1, 1], [2, 2]]
let x = [2, -0.5] drag
line [0, 0] dir [1, 2] color=yellow from=1
grid lerp(I, A, t) faint from=1
vector x color=blue label=x
vector A*x color=pink label=Ax from=1
vector A*A*x color=yellow label=A²x from=2
```