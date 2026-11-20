# 视觉交互第 4 批：概率专门的四样 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task（主控自己一件一件做，不并行）. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把设计第三节概率那张表里剩下的 B / C 行做到 A：事件的关系和运算（文氏图）、条件概率 / 全概率 / 贝叶斯（概率树 + 面积图）、二维离散型（联合分布表：边缘、条件、独立、Z = g(X, Y) 的分布）、协方差和相关系数、切比雪夫和大数定律、中心极限定理、正态总体的抽样分布、估计量的无偏 / 有效 / 一致、区间估计（都要真的抽样）。

**Architecture:** 四个新组件，各自「纯函数的规格和计算 + 一个画面文件」：

| 组件 | 纯函数 | 画面 | 管什么 |
|---|---|---|---|
| `venn` | `kit/src/prob/sets.js`（事件式子 → 原子集合；由给的概率解每一块的概率、判定「定不定得下来」） | `blocks/venn.js` | 两个 / 三个事件的文氏图：式子涂色、学生点区域、概率页面算 |
| `ptree` | `kit/src/prob/tree.js`（树的规格、乘法公式、全概率、贝叶斯） | `blocks/ptree.js` | 概率树和面积图并排：拖面积图的分界改先验 / 条件概率，后验跟着变；学生填空 |
| `joint` | `kit/src/prob/joint.js`（边缘、条件、独立、期望方差协方差、Z 的分布） | `blocks/joint.js` | 联合分布表：点一行 / 一列看条件分布，Z 相同的格子同色，学生填边缘、填 Z 的分布表 |
| `sim` | `kit/src/prob/sim.js`（带种子的随机数、各种分布的抽样、统计量、直方图分箱、置信区间） | `blocks/sim.js` | 抽样模拟：直方图 / 路径 / 一排置信区间 / 散点；抽一次、抽一百次；理论曲线叠在上面 |

`sim` 画图复用 `graph.js` 的坐标轴和曲线取样（抽成能单独调用的小函数，不改 graph 的行为）。四个都接 `session.gate` / `session.record`（照 `blocks/figures.js` 的 `tasks`），课堂里 `figure set` 能调滑块。

**Tech Stack:** 同前三批。不加依赖。随机数用自己写的带种子的生成器（mulberry32），同一张图同一个种子画出来一样（截图检查、刷新以后不变）；学生按「再抽」才换种子。

**Spec:** `docs/superpowers/specs/2026-11-20-visual-design.md`（第一节标准、第三节概率的表、第四节第 4 批、第五节的线）

## Global Constraints

- 前三批的全部约束照旧；`graph`、`space` 的写法和画面不动（各自的文档测试、真手指脚本照旧全过）。
- 这四个组件只在概率（和高数的课里讲概率时）带说明：手册里标 `<!-- 科目：概率 -->`，不进线代、408、英语的精简版。
- **页面说的每一个数都要是对的**：概率用分数能精确算的（文氏图、概率树、联合分布表）走 `exact.js` 的分数，读数写分数或小数由写法定；抽样模拟的数是模拟出来的，画面上写明「模拟 N 次」，理论值另写、标「理论」。
- 条件不够定不下来的（文氏图只给了 P(A)、P(B) 就问 P(AB)）：说「条件不够，定不下来」，不猜独立。
- 抽样的次数有上限（一次画面最多 20000 个样本点的计算，超了分帧算、进度写出来），不卡页面。
- 判对错：模拟的结果不拿来判学生（它会抖）；判学生只用理论值、精确值。「先猜再看」的题按理论值加容差判。

## Review Focus

1. **事件式子的读法**：`A ∪ B̄`、`A + B`、`AB`、`A - B`、`~(A + B)`、`A'B' ∪ C` 这些写法读出来的区域对不对（三个事件 8 块全对一遍）；学生点的区域和式子比的时候 Ω 外面那一块（都不发生）算不算。（Task 1）
2. **由给的概率解每一块**：给的条件矛盾（P(AB) > P(A)）、不够、正好够、多了但一致，各说什么；不够时问的那个量碰巧定得下来（P(A ∪ B) 只要 P(A) + P(B) − P(AB)）要算得出来。（Task 1）
3. **贝叶斯的数**：先验有 0、条件概率全是 0（P(B) = 0，后验没定义）时不除以零、不写 NaN。（Task 3）
4. **联合分布表**：概率和不是 1（写错了）要报；有 `?` 的格子由边缘推不推得出来；Z = g(X, Y) 取值相同的格子合并对不对（浮点的 0.1 + 0.2）。（Task 5）
5. **抽样**：种子固定以后每次画一样；各个分布的抽样方法对不对（均值、方差和理论值在 5 万次里对得上）；t 统计量、χ² 的自由度；置信区间的公式（σ 已知用 z，未知用 t）。（Task 7）
6. **模拟的数和理论的数**在画面上有没有可能被学生看混；「覆盖了几个」这种计数随抽样抖，页面有没有拿它判学生。（Task 8）

---

### Task 1: 事件的代数 `prob/sets.js`

**Files:** Create `kit/src/prob/sets.js`、`tests/prob-sets.test.js`

**Interfaces（Produces）：**
- `parseEvent(src, names) → { atoms: Set<number>, tex }`：事件式子 → 它包含哪些原子（n 个事件有 2ⁿ 个原子，第 k 位是 1 表示第 k 个事件发生）。认 `∪` `+` `|`（并）、`∩` `*` 和并排 `AB`（交）、`-` `\`（差）、`~A` `A'` `Ā`（上划线的组合字符）、`!A`（对立）、括号、`Ω` `S`（全集）、`∅` `0`（空集）。读不懂抛（带位置和正确写法）。
- `solveAtoms(givens, n) → { status: 'unique' | 'under' | 'conflict', p?: Fraction[], why? }`：`givens` 是 `[{ atoms, value }]`（P(式子) = 值，值是分数），加上总和是 1、每块 ≥ 0，解 2ⁿ 个原子的概率（有理数的高斯消元）。
- `probOf(expr, givens, n) → { status: 'ok' | 'under' | 'conflict', value? }`：某个式子的概率定不定得下来（它的指示向量在给的条件张成的行空间里就定得下来），条件概率 `P(A | B)` 另有 `condOf`（分母是 0 回 `undefined`）。
- `sameEvent(a, b)`、`regionsOf(atoms, n)`（给画面：哪几块要涂）。

- [ ] **Step 1: 失败的测试**：两事件 4 块、三事件 8 块逐个式子对；德摩根两边 `sameEvent`；`AB` 并排、`A'B'`、`Ā`；读不懂的 `A ∪` 抛；`solveAtoms`：P(A) = 1/2、P(B) = 2/5、P(AB) = 1/5 唯一（四块是 3/10、1/5、1/5、3/10）；只给 P(A)、P(B) 是 `under`，但 `probOf('A ∪ B')` 也 `under`、`probOf('A') = 1/2` 是 `ok`；P(AB) = 3/5 > P(B) 是 `conflict`；`condOf`。
- [ ] **Step 2:** 实现 → 通过。
- [ ] **Step 3: 提交** `概率：事件的代数——式子读成区域、由给的概率解每一块（视觉第 4 批）`

### Task 2: 文氏图 `venn`

**Files:** Create `kit/src/blocks/venn.js`、样式进 `styles.css`；Modify `blocks/index.js`、`class/prompt.js`（作答的那句话）

**写法：**

```venn
sets: A B C                      # 两个或三个事件
given: P(A) = 0.5, P(B) = 0.4, P(AB) = 0.2
shade: A - B                     # 画面上涂出来的（可以几行，各一种颜色）
ask: 点出 $\overline{A \cup B}$ = ~(A + B)     # 学生点区域，页面按式子判；可以几条，一条一条做
find: P(A + B), P(A | B)         # 读数：页面算（定不下来就写「条件不够」）
```

**行为：** 圆是画好的固定位置（两个圆 / 三个圆对称摆），每一块是一个能点的区域（44px 以上；最小的那块 A∩B∩C 也点得到）；外面的矩形是 Ω，圆外面那一块也能点。`ask` 没做完时点区域是选 / 不选，按「检查」判：全对过；不对时说多了几块、少了几块（不说是哪几块），三次不对出「看答案」。给了概率时每一块里写它的概率（定得下来的）。`find` 的读数随 `given` 算。课堂里 `figure set` 不适用（没有变量），`board mark` 能指区域（`item=A-B`）。

- [ ] **Step 1:** 探针 `.superpowers/audit-visual/ps/v4-venn.md`（两事件、三事件、有概率、条件不够、几条 ask）；真手指 `v4-venn.mjs`（点对、点错、看答案、记作答）。
- [ ] **Step 2:** 实现；三种风格、两种尺寸看截图。
- [ ] **Step 3: 提交** `概率：文氏图 venn（视觉第 4 批）`

### Task 3: 概率树 `prob/tree.js`

**Files:** Create `kit/src/prob/tree.js`、`tests/prob-tree.test.js`

**Interfaces：** `parseTree(src) → { causes: [{ name, p }], effect: 名字, cond: [P(B | Aᵢ)], blanks }`；`treeNumbers(t) → { joint: [P(AᵢB)], total: P(B), post: [P(Aᵢ | B)], postNot: [P(Aᵢ | B̄)] }`（全是分数；P(B) = 0 时 `post` 是 `null`）；`checkTree(t)`（先验的和不是 1、有负数、大于 1 报）。两层以上的树（不放回地摸两次）：`parseTree` 认缩进的多层，`leaves(t)` 给每条路径的概率。

- [ ] **Step 1: 失败的测试**：三个厂的次品率那道题（1/2、3/10、1/5；2%、1%、3%）：P(B) = 19/1000，后验 10/19、3/19、6/19；先验和不是 1 报；P(B) = 0；两层的树四条路径的概率和是 1。
- [ ] **Step 2:** 实现 → 通过。
- [ ] **Step 3: 提交** `概率：概率树的计算（视觉第 4 批）`

### Task 4: 概率树的画面 `ptree`

**Files:** Create `kit/src/blocks/ptree.js`；样式；`blocks/index.js`、`class/prompt.js`

**写法：**

```ptree
A1 0.5: B 0.02
A2 0.3: B 0.01
A3 0.2: B 0.03
labels: A1=甲厂 A2=乙厂 A3=丙厂 B=次品
drag: on                         # 面积图的分界能拖（改先验、改条件概率）
ask: P(B) = ? ; P(A1 | B) = ?    # 学生填，页面按精确值判（分数、小数都认）
blank: A2:B                      # 树上这一处先空着让学生填
```

**行为：** 左边是树（每条边上写概率，叶子上写乘出来的联合概率）；右边是面积图（单位正方形：横向按先验分成几列，每列里竖向按条件概率分出 B 的那一块，B 的几块同色）；下面一条是后验（把 B 的几块抽出来排成一条，各占多少）。拖面积图的分界：先验 / 条件概率跟着变，树上的数、后验那一条当场变。`ask` 的空按精确值判。

- [ ] **Step 1:** 探针 `v4-tree.md`、真手指 `v4-tree.mjs`（拖分界后三处的数一致、填对填错、P(B) = 0 时后验那一条写「没有定义」）。
- [ ] **Step 2:** 实现；截图。
- [ ] **Step 3: 提交** `概率：概率树和面积图 ptree（视觉第 4 批）`

### Task 5: 联合分布 `prob/joint.js`

**Files:** Create `kit/src/prob/joint.js`、`tests/prob-joint.test.js`

**Interfaces：** `parseJoint(src) → { xs, ys, p[i][j]（分数或 null）, blanks }`；`completeJoint(j, { rowSums?, colSums?, independent? })`（由边缘、由独立补出空着的格，补不出来说哪几格）；`marginals(j)`、`conditional(j, 'Y|X', i)`、`independent(j) → { ok, where? }`、`moments(j) → { EX, EY, DX, DY, cov, rho }`（ρ 带根号时回 `{ num, den2 }`，画面写成根式）、`distOf(j, expr) → [{ z, p, cells }]`（Z = g(X, Y)，取值相同的合并；浮点比较用分数）。

- [ ] **Step 1: 失败的测试**：一张 3 × 2 的表：边缘、条件、独立（独立的和不独立的各一张）、矩、Z = X + Y、Z = max(X, Y)、Z = XY；概率和不是 1 报；有空的格由边缘补。
- [ ] **Step 2:** 实现 → 通过。
- [ ] **Step 3: 提交** `概率：联合分布表的计算（视觉第 4 批）`

### Task 6: 联合分布表的画面 `joint`

**Files:** Create `kit/src/blocks/joint.js`；样式；`blocks/index.js`、`class/prompt.js`

**写法：**

```joint
X: 0 1 2
Y: 0 1
p: 1/10 1/5 1/10 / 1/5 3/10 1/10     # 一行是 Y 的一个值（/ 分行）；? 是让学生填的
show: margins, moments               # 页面写出来的：边缘、矩
z: X + Y                             # Z 的分布：相同取值的格子同色，下面一张 Z 的分布表
ask: margins                         # 学生填：margins（边缘）/ z（Z 的分布表）/ independent（独立吗，点是 / 否，再点出一个说明不独立的格子）
```

**行为：** 表格每格 ≥ 44px；点一行 / 一列的表头：那一行 / 列高亮，旁边写条件分布（每格除以边缘）；`z:` 时 Z 取值相同的格子同一种底色，点 Z 的分布表里的一格，联合表里对应的格子亮。`ask` 的空用数字键盘（分数、小数都认），逐格判。

- [ ] **Step 1:** 探针 `v4-joint.md`、真手指 `v4-joint.mjs`。
- [ ] **Step 2:** 实现；截图。
- [ ] **Step 3: 提交** `概率：联合分布表 joint（视觉第 4 批）`

### Task 7: 抽样 `prob/sim.js`

**Files:** Create `kit/src/prob/sim.js`、`tests/prob-sim.test.js`

**Interfaces：** `rng(seed)`（mulberry32）；`sampler(dist) → (r) => 数`：`N(μ, σ)`、`U(a, b)`、`Exp(λ)`、`B(n, p)`、`P(λ)`、`Geo(p)`、`chi2(n)`、`t(n)`、离散的 `{值: 概率}`；二维正态 `N2(ρ)` 回一对；`statOf(name | 式子)`：`mean` `sum` `var`（除以 n）`S2`（除以 n − 1）`S` `max` `min` `median` `z`（(x̄ − μ)/(σ/√n)）`t`（(x̄ − μ)/(S/√n)）`chi`（(n − 1)S²/σ²）`r`（样本相关系数），或者用 `xs`、`n` 写的式子；`simulate({ dist, n, stat, reps, seed }) → Float64Array`；`histogram(values, { bins, range })`（面积是 1）；`runningMean(values)`；`interval({ xs, level, sigma? }) → [lo, hi]`（σ 给了用 z，没给用 t）；`theory(dist)` → `{ mean, var }`。

- [ ] **Step 1: 失败的测试**：同一个种子两次一样；每种分布 5 万个样本的均值、方差和理论值差不过 3 个标准误；`S2` 的均值 ≈ σ²、`var` 的均值 ≈ (n − 1)σ²/n；`chi` 的均值 ≈ n − 1；1000 个 95% 区间的覆盖率在 93%～97%；直方图的面积是 1。
- [ ] **Step 2:** 实现 → 通过。
- [ ] **Step 3: 提交** `概率：带种子的抽样、统计量、直方图、置信区间（视觉第 4 批）`

### Task 8: 抽样模拟的画面 `sim`

**Files:** Create `kit/src/blocks/sim.js`；样式；`blocks/index.js`、`class/prompt.js`

**写法：**

```sim
title: 中心极限定理
draw: X ~ Exp(1)
slider n 1 60 = 5 step=1          # 样本量
stat: z                           # 画哪个统计量的分布
view: hist                        # hist 直方图 / path 样本均值随 n 的路径 / intervals 一排置信区间 / scatter 散点
curve: normpdf(x, 0, 1) label="N(0, 1)"       # 叠一条理论曲线（式子和 graph 的一样）
x: -4 4
guess: "n 多大以后直方图和钟形曲线差不多？" …   # 先猜再看（可选）
show 模拟 {reps} 次；这些 z 的平均 {dec(mean(vals), 3)}、方差 {dec(var(vals), 3)}（理论：0、1）
```

按钮：「抽一次」（那一次的 n 个样本点落下来、算出统计量、落进直方图）、「抽 100 次」、「再抽 1000 次」、「清空」。`view: intervals` 画一排区间，不含真值的标红，写「100 个里 N 个没盖住（模拟）；理论上平均 5 个」。`view: scatter` 配 `draw: (X, Y) ~ N2(ρ)`、`slider rho`，写样本相关系数和理论的 ρ。`view: path` 画 x̄ₙ 随 n 的几条路径和 ±ε 的带子（大数定律、切比雪夫的界）。

- [ ] **Step 1:** 探针 `v4-sim.md`（大数定律、切比雪夫、中心极限、χ² 和 t 的抽样分布、无偏性、置信区间、相关系数各一张）；真手指 `v4-sim.mjs`（按钮、滑块、数对得上、种子固定、抽 1000 次不卡）。
- [ ] **Step 2:** 实现；截图。
- [ ] **Step 3: 提交** `概率：抽样模拟 sim（视觉第 4 批）`

### Task 9: 示例页、手册

**Files:** Create `kit/examples/prob-demo.html`（按第三节概率的行，一行至少一张，16 张以上）；Modify `CLAUDE-PROJECT.md`（四个组件各一节，标「科目：概率」；精简版每个 ≤ 1 KiB）、`tests/prob-docs.test.js`、`package.json` 的 `check:pages`、`subject.js` 的核心组件表如有需要

- [ ] **Step 1:** 改测试 → 失败 → 写 → 通过；`npm run docs:size`（概率的精简版离 40 KiB 还剩多少写进 ledger）。
- [ ] **Step 2:** 真手指 `v4-demo-hands.mjs`：每张要学生做的事做得到。
- [ ] **Step 3: 提交** `概率：示例页和手册（视觉第 4 批）`

### Task 10: 逐行验收、发布

- [ ] **Step 1:** 第三节概率的表逐行重评，不到 A 的回去改；评级写回设计文档。
- [ ] **Step 2:** 独立复查一次（一个）；Critical / Important 一次修完，每条先有失败的测试。
- [ ] **Step 3:** `npm test`、`npm run build`、`npm run check:pages`、`npm run e2e` 全过；版本号、`CLAUDE.md`、合进 `main`（先看 `origin/main` 动没动）、发布学习台（发布前先 `read` 一次线上的版本）。
- [ ] **Step 4:** 写第 5 批（英语：长难句的层次图、句子变换、平行结构）的执行计划，接着做。
