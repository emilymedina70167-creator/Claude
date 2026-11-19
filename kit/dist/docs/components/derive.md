### derive：分拍板书（一段推导一行一行写出来）

```derive
id: d-a2
title: 推 A²
A^2 = (\boldsymbol\alpha\boldsymbol\beta^{\mathrm T})(\boldsymbol\alpha\boldsymbol\beta^{\mathrm T})
    = \boldsymbol\alpha(\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)\boldsymbol\beta^{\mathrm T}   // 结合律：中间先乘
    = (\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha)\,\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}   // $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是一个数
    = (\operatorname{tr}A)\,A
```

- 每行一段 TeX（**不写 `$`**），`//` 后面是写在右边的旁注（Markdown，可以有 `$公式$`）。第一个 `=`（或 `\le`、`\Rightarrow` 这类关系符）前后分两栏，等号自动对齐；以 `=` 开头的行接着上一行。
- 一开始只写第一行，我点「下一行」往下写（「全部写出来」一次写完）。`auto: 1.5`：出现在屏幕上以后每 1.5 秒自动写一行；`start: all`：一开始就全写出来。
- 新的一行从左往右「写」出来。课堂里：`figure target=d-a2 play step 1 4 4s`（4 秒里写完 4 行，跟着你说的话写）、`set step=3`（写到第 3 行）、`highlight 2`（第 2 行闪一下）、`board mark target=d-a2 item=2`（圈第 2 行）；行里写了 `\hl{名字}{…}` 的，`board mark term=名字` 圈那一项。
- 字段：`id`、`title`、`q`、`note`、`auto`、`start`、`link`（绑定 `steps`：揭开第 k 步时至少写到第 k 行）。
- 要我自己一行行推、页面逐行判：`mode: do`（写法在下面「更多写法」）。

**`mode: do`：我自己一行行往下推。**你给出发的式子（`start:`），我在输入框里一行一行写（`a(b'a)b'`、`αβᵀαβᵀ`、`tr(A)A` 都认：省略乘号、`'` / `ᵀ` 转置、希腊字母、上标），页面查每一行和上一行是不是相等；不相等就告诉我「取哪组数时上一行等于什么、这一行等于什么」，我改。写到 `goal:` 那个样子就推完了（没写 `goal:` 就由我点「推完了」）。

```derive
id: dd-a2
mode: do
title: 推 A²
q: $A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$（3 维列向量），从 $A^2$ 推到只含 $\operatorname{tr}A$ 和 $A$ 的式子
vars: a=vec(3) b=vec(3)
let A = a*b'
start: A^2
goal: tr(A)*A
```

- `vars:`：一般的式子要随机取几组数来比（只拿一组数，碰巧相等的错式子也会判对）：`vec(3)` 随机整数列向量、`mat(2,3)`、`int(1,5)`、`num`，空格隔开。默认比 4 组（`samples:` 改）。不写 `vars:` 就用 `let` 和整节课的量，只比一组（具体数字的计算）。
- `let 名字 = 式子`：每组数接着算。式子写法和组件里的表达式一样（`a*b'`、`tr(A)`、`det`、`inv`）。
- 只能判「相等」：矩阵、向量、数的恒等变形、计算。证明、文字推理照旧手写。

**高数：一行行求极限、求导、求积分。**

```derive
id: dd-lim
mode: do
title: 求极限
calc: limit at=0
start: (tan(x) - sin(x))/x^3
goal: 1/2
```

- `calc: limit at=0`（`at=inf` 是两侧，`+inf`、`-inf`，`side=+`）：每一行写要求极限的那个式子（前面写不写 `lim x->0`、`lim_{x→0}` 都行，一行里几个 `lim` 都去掉），最后一行是数。和上一行恒等直接过；不恒等就比两行的极限，一样也过（说「和上一行的极限一样」，记录里带两行原文）；不一样（有限、+∞、−∞、∞ 都算）就是这一行错了：「这一行的极限是 0，上一行是 1/2」。差得很小（$10^{-6}$ 到 $10^{-4}$）或者算不出极限的那一行是「页面判不了」，能接着写。一行可以换变量：写 `lim t→0 …`，或者先写一行 `令 t = 1/x`（说明行，不判）。
- `calc: antideriv`：每一行是一族原函数，可以带没积完的 `∫ e^x dx`、凑微分 `∫ sin(x)^2 d(sin x)`、变限 `∫_0^x … dt`；页面比两行的导数，`+C` 去掉。换元先写一行 `令 x = sin t`（或 `令 t = sqrt(x)`，可带 `, t in (0, 1)`；t 不写范围取 $(0.1, 1.2)$），之后的行可以是 t 的式子；没写「令」就换了变量的行是「页面判不了」。
- 不写 `calc:`、`vars: x=real(-2, 2)`：判恒等，求导写 `'`：`(x^2 sin x)'`。`domain: x in (0, 1)` 给范围。
- 记录里有每一行写的什么、和上一行相不相等、不等时两边各等于什么、每行试了几次；最后一条是推完了还是想不出来。
