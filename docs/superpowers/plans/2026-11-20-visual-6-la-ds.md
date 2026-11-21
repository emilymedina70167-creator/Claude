# 视觉交互第 6 批：线代、数据结构的零星

> 设计：`docs/superpowers/specs/2026-11-20-visual-design.md`（第三节线代、数据结构的表和「毛病」，第四节第 6 批）。
> 执行方式：主控自己一件一件做（superpowers:executing-plans），每件先写失败的测试；做完一次独立复查。

**Goal：** 线代表里 2 行（含参数的行列式 C、基变换的坐标 B）、数据结构表里 6 行（图的存储、树的存储、双端队列、折半插入和分块查找、静态链表、递归的调用栈）做到 A；两张表下面记的 5 处毛病修掉。

**Architecture：** 演示组件都照 `stepper.js` 的外壳 + `engines/` 里的纯函数引擎（`parse` → `run` → `view`，可选 `table` `variants` `quiz`），在 `engines/registry.js` 登记。坐标分解在 `scene.js` 加一条命令。

| 做什么 | 纯函数 | 画面 | 盖住的行 |
|---|---|---|---|
| `det` 收参数 | `engines/det.js`：`param: a`，格子是 `poly.js` 的多项式；倍加、交换、按行展开照旧，`r1 / (a+3)` 提出多项式公因式（不整除报错）；不写 `ops:` 时只在主元是非零常数时自动化，碰到含参的主元停下来报「这里要写 ops」；结果写成因式分解 | 系数 k 和格子里写多项式 | 含参数的行列式 |
| 基变换的坐标 | `scene.js` 的 `decomp v b1 b2`：沿两条基向量画两段（c₁b₁、c₂b₂ 首尾相接）和平行四边形的虚线，读数写坐标（有理数写分数）；表达式 `coords(v, b1, b2)` 给 `goal` 用 | `scene` | 基变换、坐标 |
| 图、树的存储 | 新引擎 `engines/store.js`：`graph:` 一条边一步建起来，旁边是邻接矩阵 / 邻接表 / 十字链表 / 邻接多重表；`tree:` 双亲表示 / 孩子表示 / 孩子兄弟（画成二叉树）/ 二叉树的顺序存储 | `stepper` | 图的存储、树的存储 |
| 双端队列 | 新引擎 `engines/deque.js`：`kind: in | out | both`（输入受限、输出受限、都不限），`push:` 入队的次序、`seq:` 要出的序列：一步一个操作，判得出得不出来；`ask: possible`、`quiz` 从几个序列里挑 | `stepper` | 双端队列 |
| 折半插入、分块查找 | `engines/sort.js` 加 `algo: binsert`（每一趟写出折半找位置的 low / high / mid，比较次数照王道）；`engines/search.js` 加 `blocksearch`（索引表 + 块内顺序找，先折半或顺序找块） | `stepper` | 折半插入、分块查找 |
| 静态链表 | 新引擎 `engines/slist.js`：一张数组（下标、data、next），`ops:` 插入 / 删除，备用链表；每一步改哪两格标出来，旁边按 next 连出来的链 | `stepper` | 静态链表 |
| 调用栈 | `engines/trace.js` 的 `view`：调用链画成一摞帧（栈顶在上，每帧写函数名、参数、局部变量），递归返回时弹出 | `trace` | 递归的调用栈 |

**Tech Stack：** 同前（纯函数 `node --test`；Playwright 真手指 + 截图，iPad 竖屏 820×1180、横屏 1180×820，默认 / ink / inknight 三种风格）。

## Global Constraints

- 注释、界面文字、提交说明用中文；颜色只走 CSS 变量；触控目标 ≥ 44px；输入框 16px；不用 `window.confirm / alert / prompt`。
- **组件说明的地方**：线代的精简版离 40 KiB 只剩 0.7 KiB、数据结构 0.5 KiB（2026-11-21 量）。先做 Task 0 腾地方：不常用的写法挪到 `<!-- 完整写法 -->` 后面，每门课腾出至少 3 KiB；新组件的精简版每节 ≤ 1.2 KiB。
- 老的 `det`、`sort`、`search`、`trace`、`scene` 的题一道不许变：写法照旧收，判分照旧，`la-demo.html` `408-demo.html` `ds-*.html` 的截图做之前先截一遍当基线，做完逐张对（`check:pages` 也要过）。
- 每个新引擎：照王道的例子对一遍答案；错法至少 2 种（答案和对的一样的不列）；`quiz` / `fill` 看不到演示时题面自己写出输入（`tests/engines-common.test.js` 守着）；说明里的例子照抄就能用。
- 每张要学生做的图：做到了记一条作答；做错的那一下也记；同一个答案连点检查不算新的一次（第 4 批定的）。

## Review Focus

1. **含参数的行列式**：提公因式除不尽、主元是含参的式子、展开到二阶的多项式乘法、结果的因式分解（`(a+3)(a-1)^3`）；`mode: quiz` 学生写含参的答案怎么比（展开的、因式的都算对）。
2. **坐标分解**：基向量共线、v 是零向量、坐标是分数时读数和画的段一致；拖 v 时两段跟着变。
3. **存储结构的口径**：邻接表里边结点的次序（头插还是尾插，照王道的写法，写明）；十字链表、多重表的指针怎么画不乱；有向 / 无向、带权。
4. **双端队列**：输入受限 / 输出受限的定义别写反；出不来的序列，页面在哪一步卡住要说对。
5. **折半插入的比较次数**：和教材口径一致（相等时往右找，保证稳定）。
6. **老题不变**：`det`、`sort`、`search`、`trace` 的老写法输出和改之前逐字段一样。

---

### Task 0：腾出组件说明的地方

**Files:** Modify `CLAUDE-PROJECT.md`（线代、数据结构用得多的几节）

- [ ] **Step 1:** `npm run docs:size -- 线代`、`-- 数据结构` 列出最大的几节；把不常用的写法（错法诊断的说明、少用的字段）挪到各节的 `<!-- 完整写法 -->` 后面，不删内容。
- [ ] **Step 2:** 两门课各腾出 ≥ 3 KiB；`npm test`（`tests/subject.test.js`、`tests/engines-common.test.js`）过。
- [ ] **Step 3: 提交** `手册：线代、数据结构的精简版腾地方（视觉第 6 批）`

### Task 1：`det` 收参数

**Files:** Modify `kit/src/engines/det.js`；Create `tests/det-param.test.js`

- [ ] **Step 1: 失败的测试**：`[[a,1,1],[1,a,1],[1,1,a]]` 用 `c1 + c2 + c3; c1 / (a+2); r2 - r1; r3 - r1` 得 `(a+2)(a-1)^2`；不写 ops、主元含参时报写法错误；`c1 / (a+3)` 除不尽报错；`expand r1` 在含参时出多项式；老题（数字的）输出和改之前一样（先把 `la-demo.html` 里每道 det 的 `run` 结果存成 fixture）；quiz 判学生写的 `(a+2)(a-1)^2` 和展开式都对。
- [ ] **Step 2:** 实现 → 通过；`npm test` 全过。
- [ ] **Step 3: 提交** `线代：det 收参数（视觉第 6 批）`

### Task 2：基变换的坐标分解（`scene` 的 `decomp`）

**Files:** Modify `kit/src/scene.js`（解析在它的纯函数部分）、`kit/src/exact.js` / `expr.js`（`coords`）；Create `tests/scene-decomp.test.js`；探针 `.superpowers/audit-visual/la/v6-decomp.md/.mjs`

- [ ] **Step 1: 失败的测试**：`coords([3,1], [1,1], [1,-1]) = [2, 1]`；共线的基报错；分数坐标。
- [ ] **Step 2:** 画法：两段首尾相接、平行四边形虚线、读数；拖 v 跟着变；`goal coords(v, b1, b2) = [1, 2]` 做得到。三种风格、两种尺寸截图。
- [ ] **Step 3: 提交** `线代：scene 的坐标分解（视觉第 6 批）`

### Task 3：线代的毛病

`matrix` 的 `mark … note=` 压在上一行的数上；老组件 `vectors` 画出来是空的；`elim` 的结论里下标写成 `a_(1)`；`det` 按行展开一步到底时画成 `D = −3|1|`。每条先写能重现的测试或探针，再修。

- [ ] **Step 1–2:** 测试 → 修 → 截图对。
- [ ] **Step 3: 提交** `线代：matrix、vectors、elim、det 的几处毛病（视觉第 6 批）`

### Task 4：图、树的存储 `store`

**Files:** Create `kit/src/engines/store.js`、`tests/engines-store.test.js`；Modify `engines/registry.js`、`styles.css`

**写法：**

```store
graph: 1-2, 1-3, 2-4, 3-4
directed: on
show: matrix, list
ask: list
```

`show:` 是 `matrix` `list`（邻接表）`cross`（十字链表，只有向图）`multi`（邻接多重表，只无向图）里的一到两种；`tree: A(B(D, E), C(F))` 是 `parent` `child` `cs`（孩子兄弟）`seq`（二叉树的顺序存储）。一步加一条边 / 一个结点，存储跟着长；`ask:` 问某一步以后某一格 / 某个链表的内容；`mode: fill` 填整张矩阵或表。

- [ ] **Step 1: 失败的测试**：四种图存储、四种树存储和王道的例子对；邻接表头插（写明）；有向图的入度、出度；错法：无向图只存一个方向、头插写成尾插。
- [ ] **Step 2:** 引擎 + 画面（图和存储并排，竖屏上下排）→ 探针、截图。
- [ ] **Step 3: 提交** `数据结构：图、树的存储 store（视觉第 6 批）`

### Task 5：双端队列 `deque`

**Files:** Create `kit/src/engines/deque.js`、`tests/engines-deque.test.js`；Modify `registry.js`

- [ ] **Step 1: 失败的测试**：输入受限 1234 能 / 不能得到的序列（王道的例题）；输出受限的；一步步的操作（左进、右进、左出、右出）；卡住时说是哪一步；错法：把输入受限当成输出受限。
- [ ] **Step 2:** 引擎 + 画面（一排格子两头开口、哪一头受限画成墙）→ 探针。
- [ ] **Step 3: 提交** `数据结构：双端队列 deque（视觉第 6 批）`

### Task 6：折半插入、分块查找

**Files:** Modify `kit/src/engines/sort.js`、`search.js`；Create `tests/engines-binsert.test.js`、`tests/engines-blocksearch.test.js`

- [ ] **Step 1: 失败的测试**：折半插入每一趟的 low / high / mid 和比较次数（相等往右，稳定）；分块查找：索引表的最大关键字、先折半找块再顺序找、平均查找长度公式对一遍；老的 `sort` / `search` 输出不变。
- [ ] **Step 2:** 实现 + 画面 → 探针。
- [ ] **Step 3: 提交** `数据结构：折半插入、分块查找（视觉第 6 批）`

### Task 7：静态链表 `slist`

**Files:** Create `kit/src/engines/slist.js`、`tests/engines-slist.test.js`；Modify `registry.js`

- [ ] **Step 1: 失败的测试**：建表、在第 i 个位置插入（从备用链表取结点）、删除（还回备用链表）、`next = -1` 结尾；错法：插入时先改了前驱的 next。
- [ ] **Step 2:** 引擎 + 画面（数组表 + 按 next 连成的链，改的两格标出来）→ 探针。
- [ ] **Step 3: 提交** `数据结构：静态链表 slist（视觉第 6 批）`

### Task 8：调用栈画成栈

**Files:** Modify `kit/src/engines/trace.js`（`view`）、`styles.css`；探针 `.superpowers/audit-visual/ds/v6-stack.md`

- [ ] **Step 1:** 先截 `ds-trace2-demo.html` 的基线；递归的阶乘、斐波那契、汉诺塔：栈顶在上，每帧函数名、参数、局部变量，返回时弹出、返回值写在调用它的那一帧上。
- [ ] **Step 2:** 没有递归的老题画出来和以前一样（逐张对）。
- [ ] **Step 3: 提交** `数据结构：trace 的调用栈画成栈（视觉第 6 批）`

### Task 9：舞台在石墨风格里白底白字

- [ ] 重现（默认风格里一块 `stage` 的树）、修（结点的颜色走变量）、截图对；提交。

### Task 10：示例页、手册、验收、发布

- [ ] 示例页 `kit/examples/la2-demo.html`（线代的 2 行 + 毛病）、`ds3-demo.html`（数据结构 6 行，每行至少两张）；手册新的几节标科目、精简版 ≤ 1.2 KiB；`tests/la2-docs.test.js`、`tests/ds3-docs.test.js`；`check:pages` 加上。
- [ ] 第三节的表逐行重评，不到 A 的回去改；评级写回设计文档。
- [ ] 独立复查一次（一个）；Critical / Important 一次修完，每条先有失败的测试。
- [ ] `npm test`、`npm run build`、`npm run check:pages`、`npm run e2e` 全过；版本号、`CLAUDE.md`、合进 `main`、发布学习台。
