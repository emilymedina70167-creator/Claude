# 视觉交互第 2 批：平面上的二元内容（仍然在 graph 里）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `graph` 把设计第三节里要「平面上两个变量」的行做到 A：高数的参数方程和极坐标、曲率圆、柯西中值、方向场和解曲线、等高线和梯度、条件极值、二重积分的区域（换序、极坐标）、平面向量场和曲线积分；概率的几何概型、二维连续型（区域、边缘、事件的概率）、Z = X + Y / max / min、二维正态。

**Architecture:** 平面上的几何（等值线的行进方格、参数曲线、方向场、龙格—库塔、区域的多边形和网格、往曲线上投影）全放在纯函数的 `kit/src/fx/plane.js`；`fx/defs.js` 加偏导和向量实参；`expr.js` 加二重积分的特殊形式；`graphspec.js` 认新命令；`graph.js` 的画布改成每张图自己的尺寸（`equal: on` 等比例），加二维的拖点。

**Tech Stack:** 同第 1 批（原生 ES 模块、SVG、`node --test`、Playwright）。不加依赖。

**Spec:** `docs/superpowers/specs/2026-11-20-visual-design.md`（第一节标准、第三节的表、第四节第 2 批、第五节的线）

## Global Constraints

- 第 1 批的全部约束照旧（`docs/superpowers/plans/2026-11-20-visual-1-graph.md` 的 Global Constraints）。
- 第 1 批的写法和画出来的样子不变：`kit/examples/graph-demo.html` 的 30 张图、`tests/graph-docs.test.js`、`.superpowers/audit-visual/hm/v1-hands.mjs` 照旧全过。
- 一帧的预算：行进方格的网格最多 120 × 120，一张图里等值线最多 12 条；`region 条件` 的网格最多 96 × 96（边界上的格子再细分 4 × 4）；超了报写法错误，不卡画面。拖动时一帧算不完的（二重积分的读数）只在松手时重算。
- 极坐标、参数曲线的参数是弧度（和第 1 批一致；`scene` 的 `curve` 照旧角度，不动）。
- 手册里新加的写法放在 graph 一节的「完整写法」后半（精简版只加一行指路）：线代的组件说明只剩 0.3 KiB 余量。

## Review Focus

1. **等值线穿过鞍点、切着网格**（`x^2 - y^2 = 0`、`x*y = 0`）：两条相交的线都画出来，不漏一支、不连错。（Task 3）
2. **区域的边界有没定义的地方**（`region y from 0 to sqrt(1 - x^2) for x -2 2`）：只画有定义的那一段，上下限读数在没定义的 x 上写「—」不写 NaN。（Task 3、5）
3. **学生把二维的点拖到窗口外、拖到约束曲线够不着的地方**：停在窗口边上 / 留在曲线上最近的点，不飞走、不变成 NaN。（Task 5）
4. **解曲线冲向无穷**（`y' = y^2`）：画到窗口边就停，不卡住。（Task 3）
5. **二重积分里被积函数带指示函数**（`(x + y <= z)*f(x, y)`）：读数和精确值差不超过 2e-3；算不收敛时写「页面算不出来」而不是一个错的数。（Task 2）

---

### Task 1: 偏导、梯度、向量当实参

**Files:** Modify `kit/src/fx/defs.js`；Test `tests/fx-defs.test.js`（加一段）

**Interfaces（Produces）：** 定义 `f(x, y) = …` 以后，式子里能写
- `f_x(a, b)`、`f_y(a, b)`、`f_xx` `f_xy` `f_yx` `f_yy`（下划线后面每个字母是 f 的一个参数名，最多三阶；字母不是参数名时照旧当普通名字，不报错）。
- `f_grad(a, b)`：回 `[f_x, f_y]`（参数个数那么长的向量）。
- 实参给一个向量：`f(P)`、`f_x(P)`、`f_grad(P)`（定义的参数不止一个、调用只给了一个实参时，按 `el(P, 1)`、`el(P, 2)` 代进去）。
- 一元函数照旧：`f'`、`f''`；`f_x(a)` 对一元的 `f(x)` 也认（等于 `f'(a)`）。

- [ ] **Step 1: 失败的测试**：`h(x, y) = x^2*y + y^3`：`h_x(2, 3) = 12`、`h_y(2, 3) = 4 + 27`、`h_xy(2, 3) = 4`、`h_yy(1, 2) = 12`、`h_grad(2, 3)` 是 `[12, 31]`、`h(P)` 在 `{P: [2, 3]}` 是 39、`h_grad(P)` 同上、`h_x(P)` 是 12；`f(x) = x^3`：`f_x(2) = 12`；名字里带下划线的普通变量不受影响：`compileWith('a_x + 1', defs)({ a_x: 2 }) = 3`；`h_z(1, 2)` 抛「h 没有参数 z」；`h(1, 2, 3)` 抛「h 要 2 个参数」。
- [ ] **Step 2:** 看到失败 → 实现（`primesToCalls` 旁边加 `partialsToCalls`，内部名字 `__p_xy_h`、`__g_h`）→ 通过。
- [ ] **Step 3: 提交** `函数图：偏导 f_x、f_xy，梯度 f_grad，向量当实参（视觉第 2 批）`

### Task 2: 二重积分的特殊形式、二维正态的密度

**Files:** Modify `kit/src/expr.js`、`kit/src/fx/special.js`、`kit/src/exact.js`（`FLOAT_ONLY`）；Test `tests/expr-forms.test.js`、`tests/fx-special.test.js`

**Interfaces（Produces）：**
- `int2(式子, x, a, b, y, c, d)`：$\int_a^b dx \int_c^d 式子\,dy$，`c`、`d` 可以含 x；7 个参数、第 2 和第 5 个是字母时才是特殊形式。用 `fx/integral.js` 的 `numIntegral2`；`ok !== true` 时：值有限而且两种网格（内层 100 段、200 段）差不到 2e-3 就用，否则抛「这个二重积分页面算不出来」。
- `binormpdf(x, y, mx = 0, my = 0, sx = 1, sy = 1, rho = 0)`：二维正态的密度；`|rho| ≥ 1`、`sx ≤ 0` 抛中文的原因。

- [ ] **Step 1: 失败的测试**：`int2(x*y, x, 0, 1, y, 0, x) = 1/8`（1e-8）；`int2(1, x, 0, 1, y, x^2, x) = 1/6`；`int2((x + y <= 1)*2, x, 0, 1, y, 0, 1)`（单位正方形上密度 2 的一半 … 即 1）和 1 差 < 2e-3；`int2(binormpdf(x, y, 0, 0, 1, 1, 0.5), x, -8, 8, y, -8, 8)` ≈ 1（1e-4）；`int2(1/(x*y), x, 0, 1, y, 0, 1)` 抛；`binormpdf(0, 0) = 1/(2π)`；`binormpdf(0, 0, 0, 0, 1, 1, 1)` 抛「相关系数」。
- [ ] **Step 2:** 失败 → 实现 → 通过；`npm test` 里表达式有关的照旧过。
- [ ] **Step 3: 提交** `表达式：int2 二重积分、binormpdf（视觉第 2 批）`

### Task 3: 平面上的几何 `fx/plane.js`

**Files:** Create `kit/src/fx/plane.js`；Test `tests/fx-plane.test.js`

**Interfaces（Produces，全是纯函数；`F` 是 `(x, y) => 数`，算不出来当 NaN）：**
- `contourLines(F, level, box, { nx = 96, ny = 96 }) → Array<Array<[x, y]>>`：等值线 F = level 的折线（行进方格；格子边上线性插值；鞍点的格子按格子中心的值决定怎么连；线段首尾接成尽量长的折线）。`box = { x0, x1, y0, y1 }`。有 NaN 角的格子跳过。
- `paramCurve(P, a, b, { n = 400 }) → Array<Array<[x, y]>>`：`P` 是 `(t) => [x, y]`；没定义的点把曲线断开；相邻两点在屏幕上跳得太远（超过 `box` 对角线的 1/4，`box` 可选）也断开。
- `slopeMarks(F, box, { nx = 17, ny = 11 }) → Array<{ x, y, dx, dy }>`：方向场，每个格点一小段（长度是格距的 0.38 倍，方向 (1, F) 归一化；`aspect` 选项：屏幕上横竖每单位的像素比，归一化在屏幕上做）。
- `fieldArrows(P, Q, box, { nx = 15, ny = 10 }) → Array<{ x, y, dx, dy, mag }>`：向量场，箭头长度按 `mag` 相对最大值开平方缩放到格距的 0.2～0.85 倍。
- `flowLine(F, [x0, y0], box, { h, max = 4000 }) → Array<[x, y]>`：过 (x0, y0) 的解曲线（RK4，往两边走，出了 `box` 上下各 20% 的边、值不是有限的、走满步数就停）。`F` 回一个数是 y′ = F(x, y)；`flowField(P, Q, …)` 是沿向量场的流线（按弧长走）。
- `typedRegion(kind, lo, hi, a, b, { n = 120 }) → { poly: Array<[x, y]>, ok }`：`kind: 'y'`（x 从 a 到 b，y 从 lo(x) 到 hi(x)）、`'x'`（y 从 a 到 b，x 从 lo(y) 到 hi(y)）、`'r'`（θ 从 a 到 b，r 从 lo(θ) 到 hi(θ)）；没定义的那几个取样点跳过（`ok: false`）。
- `stripOf(kind, lo, hi, t) → { from: [x, y], to: [x, y], lo, hi } | null`：区域在参数 t 处的那一条（竖条 / 横条 / 射线上的一段）。
- `whereRuns(C, box, { nx = 96, ny = 96, fine = 4 }) → Array<{ x0, x1, y0, y1 }>`：条件 `C(x, y)` 成立的地方，合并成一行行的矩形（边界上的格子细分 `fine` × `fine`）。
- `projectTo(G, [x, y], { tol = 1e-9, max = 30 }) → [x, y] | null`：把点投到 G = 0 上（数值梯度的牛顿法；不收敛回 `null`）。
- `PLANE_MAX_GRID = 120`、`PLANE_MAX_LEVELS = 12`。

- [ ] **Step 1: 失败的测试**（每条给了判据）：
  - 圆 `x² + y² = 1`：`contourLines` 一条闭合的线（首尾相距 < 0.05），每个点到原点的距离和 1 差 < 5e-3。
  - `x² − y² = 0`、`x*y = 0`（Review Focus 1）：线上的点都满足 |F| < 0.02；(±1.5, ±1.5) 四个方向（或四条半轴）附近都有线上的点。
  - `x² − y² = 1`：两条线，不相连。
  - `sin(x) = y` 在有 NaN 的函数上（`sqrt(x) - y`，x < 0 没定义）：只在 x ≥ 0 有线。
  - `paramCurve(t => [cos t, sin t], 0, 2π)` 一段、闭合；`t => [t, 1/t]` 在 (−1, 1) 断成两段。
  - `slopeMarks((x, y) => y, box)`：每一段的 dy/dx 等于那一点的 y（1e-9），个数 17 × 11。
  - `flowLine((x, y) => y, [0, 1], box)`：线上的点满足 y ≈ eˣ（相对 1e-4）；`(x, y) => y²` 从 [0, 1] 出发（Review Focus 4）：有限步内停、最后一点的 y 不超过 `box.y1` 的 1.2 倍多。
  - `typedRegion('y', x => x², x => x, 0, 1)`：多边形的面积（鞋带公式）≈ 1/6（1e-3）。`typedRegion('r', () => 0, t => 1 + cos t, 0, 2π)` 面积 ≈ 3π/2（1e-2）。`typedRegion('y', () => 0, x => sqrt(1 − x²), −2, 2)`（Review Focus 2）：`ok: false`，多边形的 x 都在 [−1, 1]，面积 ≈ π/2（2e-2）。
  - `stripOf('y', x => x², x => x, 0.5)`：`lo = 0.25`、`hi = 0.5`、`from = [0.5, 0.25]`；`stripOf('y', () => 0, x => sqrt(1 − x²), 1.5)` 是 `null`。
  - `whereRuns((x, y) => x + y <= 1 && x >= 0 && y >= 0, 单位正方形外扩一点)`：矩形的面积和 ≈ 1/2（5e-3）。
  - `projectTo((x, y) => x² + y² − 4, [3, 0.1])` 落在圆上（|G| < 1e-8）、离 (3, 0.1) 最近的那一带（x > 1.9）；`projectTo(() => 1, [0, 0])` 是 `null`。
  - 够快：96 × 96 的 `contourLines` 对二次函数 50 次 < 400 ms。
- [ ] **Step 2:** 失败 → 实现 → 通过。
- [ ] **Step 3: 提交** `函数图：平面上的几何——等值线、参数曲线、方向场、解曲线、区域（视觉第 2 批）`

### Task 4: graphspec 认新命令

**Files:** Modify `kit/src/graphspec.js`；Test `tests/graphspec.test.js`

**Interfaces（Produces）：** 字段 `equal: on`。新命令（都进 `CMDS`）：

| 写法 | kind 和字段 |
|---|---|
| `param [x(t), y(t)] for t a b [fill]` | `param`：`p`（`(vars) => [x, y]`）、`param`（字母）、`from` `to`、`mods.fill` |
| `polar r(t) for t a b [fill]` | `polar`：`r`、`param`、`from` `to` |
| `implicit 左 = 右` | `implicit`：`F`（左 − 右，自变量 x、y） |
| `contour 式子 at c1, c2, …` | `contour`：`F`、`levels`（`(vars) => 数组`，一个式子回向量就摊开；最多 12 个） |
| `slope 式子` | `slope`：`F`（y′ = F(x, y)） |
| `field [P, Q]` | `field`：`P` `Q` |
| `flow 式子 from 点` / `flow [P, Q] from 点` | `flow`：`F` 或 `P` `Q`、`from` |
| `vector [u, v] from 点` | `vector`：`v`、`from`（不写是原点） |
| `region [D =] y from g1 to g2 for x a b`（`x from … for y …`、`r from … for t …`） | `region`：`shape: 'y' | 'x' | 'r'`、`lo` `hi`、`param`、`a` `b`、`name` |
| `region 条件` | `region`：`shape: 'where'`、`cond` |
| `strip D at 式子 [lo=名字] [hi=名字]` | `strip`：`of`（区域的名字）、`at`、`loName` `hiName` |
| `let P = [1, 2] drag [on="x + y = 3"]` | `let`：值是二维时 `mods.drag` 是二维的拖点；`on` 里有 `=`（或式子里有 y）时 `onG`（左 − 右，自变量 x、y） |

写错的报法各带一个例子。`let … drag on=f(x)`（第 1 批：把手骑在 y = f(x) 上）不变：区分法是初值是数还是二维向量。

- [ ] **Step 1: 失败的测试**：每种命令一条（字段求值对），加：`region D = y from x^2 to x for x 0 1` 的 `lo({x: 0.5}) = 0.25`；`strip D at a lo=y1 hi=y2` 的 `of: 'D'`；`strip E at 1` 在没有叫 E 的区域时 `parseGraph` 抛「没有叫 E 的区域」；`contour` 写了 13 个值抛「最多 12 条」；`equal: on` → `fields.equal`；第 1 批的 `let a = 1 drag on=f(x)` 照旧有 `onF`、没有 `onG`。
- [ ] **Step 2:** 失败 → 实现 → 通过；`tests/graph-docs.test.js` 照旧过。
- [ ] **Step 3: 提交** `函数图：认 param / polar / implicit / contour / slope / field / flow / vector / region / strip、二维的拖点（视觉第 2 批）`

### Task 5: graph 画出来、二维的拖点

**Files:** Modify `kit/src/graph.js`、`kit/src/styles.css`

**行为：**
- 画布的尺寸每张图自己算：`equal: on` 时视口是 640 × 600，x、y 每单位的像素一样（`y:` 没写就以 0 为中心按 x 的比例取；写了就在画图区里居中、多出来的一边留白）；不写 `equal` 和第 1 批一模一样。
- `param` / `polar`：折线（`fill` 时再垫一层淡的面；`polar … fill` 是从原点扫过的扇形面）。`implicit` / `contour`：等值线；`contour` 每条线上挂它的值（小字，挂在线的中段，互相让开）。`slope`：一排排小线段（淡）。`field`：小箭头。`flow`：解曲线（粗细同 `plot`）。`vector`：箭头（和 scene 的箭头同一种画法）。
- `region`：淡淡的面 + 边界；`strip`：区域里的那一条（粗线、两头两个点），`lo=` `hi=` 起的名字进变量（那里区域没定义时是 NaN，读数写「—」）。
- 二维的拖点：圆点把手（44px 的触控区），拖到哪跟到哪，`snap=`；出不了窗口；`on=` 的拖完投回曲线上（投不回去就留在上一个位置）。`figure set P=[1, 2]` 照旧能设。松手发 `dragend`（值是二维的）。
- `pick` 不写 `on` 的（平面上随便点）在 `equal: on` 的图里按屏幕距离判（已经是）。
- 一帧的预算：见 Global Constraints；拖动中 `int2` 的读数先写「…」，松手再算（`show` 里用到 `int2` 的那一条）。

- [ ] **Step 1:** 写探针 `.superpowers/audit-visual/hm/v2-draw.md`（每种命令至少一张，共 14 张以上）和 `v2-hands.mjs`（真手指：拖二维的点到目标、沿约束拖、拖出窗口外、`strip` 跟着滑块走）。
- [ ] **Step 2:** 实现；`npm run build`；渲染探针，默认 / `ink` / `inknight` 各看一遍截图；`v2-hands.mjs` 全过；第 1 批的 `v1-hands.mjs` 照旧全过。
- [ ] **Step 3:** `npm test` 全过。**提交** `函数图：等比例、参数和极坐标曲线、等高线、方向场、解曲线、区域和竖条、二维的拖点（视觉第 2 批）`

### Task 6: 示例页、手册

**Files:** Modify `kit/examples/graph-demo.html`（加「平面」一段：按设计第三节这一批的行，一行一张，14 张以上）、`CLAUDE-PROJECT.md`（graph 一节完整写法里加「平面上的东西」；精简版只加一行指路；版本号）、`tests/graph-docs.test.js`（新命令每样在手册里至少一个例子；示例页 ≥ 44 张）

- [ ] **Step 1:** 改测试 → 失败 → 写示例页和手册 → 通过；`npm run docs:size` 线代不超。
- [ ] **Step 2:** `npm run build`；`node tools/check-lesson.mjs` 查示例页（两种尺寸、三种风格看截图）。
- [ ] **Step 3: 提交** `函数图：平面内容的示例页和手册（视觉第 2 批）`

### Task 7: 逐行验收、发布

- [ ] **Step 1:** 设计第三节这一批盖住的行（高数 9 行、概率 5 行）逐行对着示例页和五条标准评，不到 A 的回去改；评级写回设计文档。
- [ ] **Step 2:** `npm test`、`npm run build`（`git status` 干净）、`npm run check:pages`、`npm run e2e` 全过。
- [ ] **Step 3:** 版本号、`CLAUDE.md` 记一条、提交、合进 `main`、发布学习台。
- [ ] **Step 4:** 写第 3 批（三维图）的执行计划，接着做。
