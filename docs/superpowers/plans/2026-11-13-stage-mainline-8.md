# 舞台主线第八轮：自由构图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task（我在这个会话里一件件做）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 舞台上东西放在哪、多大由老师当场定（关系、轻重，必要时精确到细网格），页面用约束求解器排出好看、不重叠、不出屏的版面，并告诉老师排成了什么样。

**Architecture:** 新增 `kit/src/stage/compose/` 一层：`grid.js`（细网格和字号档）、`solve.js`（kiwi.js 的 Cassowary 求解 + 不重叠的分开方向 + 审美弱约束）、`report.js`（版面写给老师）、`apply.js`（画面一侧：量大小、调求解器、把结果写回场景的坐标）、`sketch.js`（预览用的示意图）。场景加 `place` 指令和 `say … at=/near=` 存构图意图；`stage.js` 用 `compose()` 取代往下摞、整体缩放、话猜位置和第六轮的收放栏。底座（指令、每样东西、规则、裁判、课堂循环、分幕回看）不动。

**Tech Stack:** 原生 JS（ES modules）、kiwi.js 1.1.3（BSD-3，esbuild 打进 la-kit.js）、`node --test`、Playwright（只截图看样子）。

**Spec:** `docs/superpowers/specs/2026-11-13-stage-mainline-8-design.md`

## Global Constraints

- 底座不动：已有指令的写法和意思、`types/*` 的画法和规则、`referee.js`、`goal.js`、`loop.js` 的叫老师规则、`scene` / 回看都不改。
- 细网格横 48 列，行数按屏幕比例；老师看到、写的位置都按格子（`c0,r0-c1,r1`）。
- 整台一节课里不再每轮缩放：`typeScale` 由屏幕定一次；`camera X` 凑近照旧，`camera all` 回到原样。
- 字号四档：话 21、正文 / 贴的字 17、句子 27、标题 24（乘 `typeScale`）；间距三档 s = 半格、m = 1 格、l = 2 格。
- 求解一次在 iPad 上 30 毫秒以内（十几样东西）；不多调用 Claude（预览除外，由老师自己写）。
- 去掉第六轮的收放解析栏、左边中间的把手、宽输入挪画面底部；前几轮的话收进顶上「说过的」。
- 说明每门课 ≤ 24576 字节（数据结构现在 24290）：加的行先压别的。
- **检查从轻**（我说过）：每个任务自己的单元测试 + `npm test`；样子靠截图看；不跑旧课逐份重放、不跑全量验收表；e2e 只跑舞台课那一段，最后一次。
- 不用 `window.confirm / alert / prompt`；注释、界面文字、提交说明中文；触控目标 ≥ 44px。
- 改了 `kit/src/` 要 `npm run build` 和 `node proto/stage/build.mjs` 并提交产物；分支 `claude/lucid-ride-ozv77a`，做完快进合进 `main`、改版本号、重新发布学习台（不用问我）。

## Review Focus

1. 老师写的关系互相矛盾（`place a right-of b` 又 `place b right-of a`）：求解器不卡死、不乱跳，按 weight 取舍，`unmet` 里写清哪条没照办（Task 3）。
2. 东西太多一屏放不下：先压间距、再变窄变高，最后整台缩一档，现状照实说缩到几成；不出屏、不重叠（Task 3）。
3. 学生拖动东西（树换值、时间轴小人）时东西长大缩小：求解只挪受影响的，别的不动；拖着的时候不排（和镜头一样等松手）（Task 5）。
4. 刷新、只读翻看、回看照 log 放回：同样的 log 排出同样的版面（求解确定性：同样输入同样输出，不依赖动画时序）（Task 3、Task 5）。
5. 老师写 `place` 指着没有的东西、部件写错：当场报，进「没演上的行」，别的行照演（Task 4）。

---

## 文件

| 文件 | 负责 |
|---|---|
| `kit/src/stage/compose/grid.js`（新） | 细网格、格子和像素互换、`at=` 读法、`typeScale`。纯函数 |
| `kit/src/stage/compose/solve.js`（新） | `solveLayout`：关系 + 不重叠 + 审美弱约束，用 kiwi.js。纯函数 |
| `kit/src/stage/compose/report.js`（新） | 版面写给老师：每样占哪个框、最大的几块空地、没照办的。纯函数 |
| `kit/src/stage/compose/sketch.js`（新） | 预览的示意图：照框画一张 SVG（格子、名字、字的开头）。纯函数 |
| `kit/src/stage/compose/apply.js`（新） | 画面一侧：量大小、调 `solveLayout`、写回场景坐标、动画 |
| `kit/src/stage/scene.js`（改） | `case 'place'`、`case 'preview'`、`say` 的 `at= / near=`、`this.layout` 存意图、`moveObject`、`stateText` 的「版面」 |
| `kit/src/stage/script.js`（改） | `COMMANDS` 加 `place` `preview`；`OPTIONS` |
| `kit/src/stage/stage.js`（改） | `compose()` 接上；固定缩放的镜头；去掉 `setSide` / `sideToggle` / `wideDock` / `placeCaption` 的猜位置；话块、挑战块进求解；顶上「说过的」 |
| `kit/src/stage/stage.css`、`class.css`（改） | 设计规范：字号、间距、话卡、题卡、贴的字一家；去掉收放栏的样式 |
| `kit/src/stage/loop.js`（改） | `preview`：这一轮写了 `preview` 就带示意图马上再叫老师一次 |
| `kit/src/stage/doc.js`（改） | 说明里构图几行，压别的腾地方 |
| `proto/stage/compose-mock.html`（新） | 样稿：真课 4 个时刻照设计规范手摆，截图给我看 |
| `package.json`（改） | 加 `kiwi.js@1.1.3` |

---

## A · 先定样子

### Task 1: 样稿（我看了说好再往下做）

**Files:** Create `proto/stage/compose-mock.html`；Modify `kit/src/stage/stage.css`（设计规范的变量）

- [ ] **Step 1：设计规范写成 CSS 变量**，放在 `stage.css` 开头的 `.st-stage` 上：`--st-fs-talk: calc(21px * var(--ts,1))`、`--st-fs-body: calc(17px * var(--ts,1))`、`--st-fs-word: calc(27px * var(--ts,1))`、`--st-fs-title: calc(24px * var(--ts,1))`、`--st-gap-s/m/l`（半格、1 格、2 格，用 `--cell`）；话卡、题卡、贴的字共用 `.st-card-family`（毛玻璃底、0.5px 细线、圆角 16、内边距 12×16），重点卡多一条 3px 南大紫色带（左边）。颜色只用现有主题变量。
- [ ] **Step 2：样稿页** `proto/stage/compose-mock.html`：引用 `proto/stage/dist/stage-demo.js` 的样式（只取 CSS，不跑舞台），四个时刻手摆（绝对定位、按 48 列网格），内容照真课原文：
  1. 题卡（第 10 题 + 生词）+ 句子 lots of working folks… + 话两句 + 挑战一条；
  2. 句子 They gave justices… + 时间轴（事件点 gave、小人）+ 贴在小人上的 be free + 译文 + 话；
  3. 两张 3×3 矩阵并排比较 + 乘积 + 话；
  4. 一棵 7 个结点的树 + 一排格子 + 话一句贴着结点。
  每个时刻在页面上用一个 `#m1…#m4` 切换。
- [ ] **Step 3：截图** iPad 横屏 1376×1024、1180×820 各 4 张（`--deviceScaleFactor 2`），发给我看。
- [ ] **Step 4：照我的意见改**，直到我说好。定下来的样子（每种东西多大一档、话卡的样子、间距）写进 `docs/superpowers/specs/2026-11-13-stage-mainline-8-rulings.md`。
- [ ] **Step 5：提交**「舞台：自由构图的设计规范和样稿」。

## B · 求解器（纯函数）

### Task 2: 细网格和字号档

**Files:** Create `kit/src/stage/compose/grid.js`；Modify `package.json`（`npm install kiwi.js@1.1.3 --save`）；Test `tests/stage-compose-grid.test.js`

**Interfaces:**
- Produces: `COLS = 48`；`gridOf({ w, h }) → { cols, rows, cell }`（`cell = w / 48`，`rows = Math.floor(h / cell)`）；`typeScaleOf({ w }) → number`（`clamp(w / 1240, 0.96, 1.11)`）；`toCells(box, grid) → { c0, r0, c1, r1 }`（框盖到的格子，c1/r1 不含）；`fromCells(cells, grid) → { x, y, w, h }`；`cellText(cells) → "c0,r0-c1,r1"`；`parseAt(text) → cells | null`（`"6,4-40,12"`，写错返回 null）；`GAPS = { s: 0.5, m: 1, l: 2 }`（格）。

- [ ] **Step 1：测试**：`gridOf({ w: 1376, h: 900 })` → `cols 48`、`cell ≈ 28.67`、`rows 31`；`typeScaleOf({ w: 1376 }) ≈ 1.11`、`({ w: 1180 }) = 0.96`；`parseAt('6,4-40,12')` → `{ c0: 6, r0: 4, c1: 40, r1: 12 }`；`parseAt('40,4-6,12')`、`parseAt('6,4')`、`parseAt('0,0-49,2')` → `null`；`fromCells` 和 `toCells` 互为来回（整格的框来回一样）。
- [ ] **Step 2**：`node --test tests/stage-compose-grid.test.js` FAIL。
- [ ] **Step 3**：写 `grid.js`。
- [ ] **Step 4**：PASS。
- [ ] **Step 5**：提交「舞台：自由构图的细网格（48 列）和字号档」。

### Task 3: 求解器

**Files:** Create `kit/src/stage/compose/solve.js`；Test `tests/stage-compose-solve.test.js`

**Interfaces:**
- Consumes: Task 2 的 `gridOf` `GAPS`。
- Produces: `solveLayout({ canvas: { w, h }, grid, items, relations }) → { boxes: Map<id, { x, y, w, h }>, unmet: [{ rel, why }], scale }`。
  - `items: [{ id, w, h, alts?: [{ w, h }], prev?: { x, y }, order, fixed?: box }]`：`alts` 是能折行的东西的几种大小（含 `w,h` 本身），`order` 是先后（阅读顺序），`fixed` 是 `at=` 定死的框。
  - `relations: [{ kind, a, b?, align?, gap?, weight? }]`，`kind` ∈ `main | right-of | left-of | above | below | near | row | col | at`；`row` / `col` 的 `a` 是 id 数组；`near` 的 `b` 可以是一个框 `{ x, y, w, h }`（部件的框）；`weight` ∈ `strong | medium | weak`（默认 medium）；`gap` ∈ `s | m | l`（默认 m）。
  - 做法：kiwi 的 `Solver`，每样东西 x、y 两个变量；**必须**：在画布里；**按 weight**：老师的关系；**weak**：和 `prev` 一样（稳定）、`main` 的中心靠近画布中心偏上、没写关系的新东西挨着前一样（`order` 前一个的下面、左对齐）。不重叠：解完找相交的每一对，按两者中心的相对位置取分开方向（横向差大就左右、否则上下；有 `prev` 照 `prev` 的相对位置），加成 strong 约束再解，最多 6 轮。能折行的：每样最多试 3 种 `alts`，挑「没照办的权重和 + 挪动总量」最小的那一套（组合超过 27 种时一样一样挑）。还放不下：间距降一档，再不行 `scale` 从 1 每次乘 0.9，最低 0.8，`unmet` 里写「放不下，整台缩到 9 成」。最后把 x、y 吸到半格上，吸完再查一遍不重叠（吸坏了退回不吸）。

- [ ] **Step 1：测试**（画布 1376×900，网格照 Task 2）：
  - `right-of`：`[a 400×200, b 200×100]`、`{kind:'right-of', a:'b', b:'a'}` → `b.x ≥ a.x + a.w + 1 格`，两者不相交。
  - 不重叠：5 样东西都没写关系 → 两两不相交、都在画布里。
  - 稳定：同一组 items 第二次带上第一次的结果当 `prev`、再加一样新东西 → 原来几样每样挪动 ≤ 2 格。
  - 矛盾：`b right-of a`（strong）和 `a right-of b`（weak）→ 照 strong 的办，`unmet` 里有那条 weak 的、`why` 不空。
  - 放不下：12 样 400×300 的东西 → 都在画布里、不相交，`scale < 1`，`unmet` 有「放不下」那一句。
  - `at=`：`fixed` 的框照原样、别的绕开它。
  - 折行：句子 `alts` 有 800×120 和 500×200，`right-of` 题卡只剩 520 宽 → 选 500×200。
  - 确定性：同样输入跑两次，`boxes` 一样。
  - 快：15 样东西 + 10 条关系，跑 20 次取中位数 < 30 毫秒（node 里）。
- [ ] **Step 2**：FAIL。
- [ ] **Step 3**：写 `solve.js`（`import { Solver, Variable, Expression, Constraint, Operator, Strength } from 'kiwi.js'`）。
- [ ] **Step 4**：PASS。
- [ ] **Step 5**：提交「舞台：自由构图的求解器（kiwi.js 解关系、不重叠、稳定、折行、放不下缩一档）」。

### Task 4: 构图意图（`place`、`say at=`）

**Files:** Modify `kit/src/stage/script.js`（`COMMANDS` 加 `place` `preview`；`OPTIONS.place = ['align','gap','weight','at']`、`OPTIONS.say` 加 `at` `near`）、`kit/src/stage/scene.js`；Test `tests/stage-compose-intent.test.js`

**Interfaces:**
- Produces: `scene.layout`：`Map<id, rel[]>`（rel 的形状同 Task 3 的 `relations`；`id` 也可以是 `'say'`、`'goals'`）；`scene.applyOne` 的 `case 'place'`：`place <名字…> main | right-of X | left-of X | above X | below X | near X | row | col` 加 `align= gap= weight= at=`；同一样东西再写 `place` 就换掉它的关系（`row` / `col` 存在第一个名字上）；`dropObject` 时一起删掉指着它的关系；`case 'preview'` 返回 `{ preview: true }`；`say` 写了 `at=` / `near=` 时 `scene.layout.set('say', …)`。
- `scene.check` 报错：名字不是舞台上的东西或部件（「place 写的「zz」舞台上没有」）、`at=` 写错（「at= 写成 6,4-40,12：第几列第几行到第几列第几行」）、两样以上的 `right-of` 等（「right-of 前面写一样东西」）。

- [ ] **Step 1：测试**：`place gl right-of s align=top` 存成 `[{ kind:'right-of', a:'gl', b:'s', align:'top' }]`；再写 `place gl below s` 换掉；`place A B row gap=l` 存在 `A` 上 `{ kind:'row', a:['A','B'], gap:'l' }`；`remove s` 以后指着 s 的关系没了；`place zz main` → check 报那一句；`place q at=40,4-6,12` → 报 at 那一句；`say "看这里" near=s.had` → `layout.get('say')` 是 `near` 指着 `s.had`；`preview` 演得上、返回 `preview: true`。
- [ ] **Step 2**：FAIL。
- [ ] **Step 3**：实现（关系的检查和存放写在 scene.js 里一个小函数 `placeRel(words, opts)`）。
- [ ] **Step 4**：PASS；`npm test` 全过（`tests/stage-cost.test.js` 要求新指令归类：`place` 归「搭」、`preview` 归「搭」，加进 `tools/stage-cost-lib.js`；`tests/stage-scene.test.js` 的选项全覆盖那条在补的那一行加一条 `place b right-of a gap=s`）。
- [ ] **Step 5**：提交「舞台：构图意图 place / say at= near= / preview」。

## C · 接到画面上

### Task 5: `compose()`：量、解、摆

**Files:** Create `kit/src/stage/compose/apply.js`；Modify `kit/src/stage/stage.js`、`kit/src/stage/scene.js`（`moveObject(id, x, y)`：把一样东西整个挪到左上角 (x, y)，走现有的 `shiftObject`）、`kit/src/stage/stage.css`、`kit/src/stage/class.css`

**Interfaces:**
- Consumes: Task 2、3、4。
- Produces: `compose(stage, { animate }) → { boxes, unmet, scale }`（`apply.js`）；`stage.compose()` 包一层（拖着的时候记 `composeLater`，松手补）；`stage.layoutState`（最近一次的 `{ boxes, unmet, scale, grid }`，现状和预览用）。
- 做法：
  - 画布 = `.st-view` 扣掉顶上一条（挑战块之外的界面）和底下的输入条（`dock` 的实际高）。镜头固定：`cam = { s: typeScale * scale, tx: 画布左, ty: 画布上 }`，`root` 上写 `--ts`；老师 `camera X`（`scene.focus` 有东西）时照旧 `fitCamera` 凑近，`camera all` 回到固定镜头。
  - items：每样摆着的东西 `objectBox` × 镜头缩放（加 `o.ext`）；句子给 `alts`（世界坐标里 `wrap = 800 / 600 / 450` 各量一次；`sentence.js` 的 `WRAP` 改成读 `o.wrap ?? WRAP`）；话块（`.st-caption`，这一轮的几句）、挑战块（`.st-goals`）各当一样，`alts` 是宽 12 / 18 / 24 格量出来的高；贴的字照旧由 `placeLabel` 贴在它的东西旁边，但它们的框并进它那样东西（求解时当一体）。
  - `prev` 是上一次的框；`order` 是造出来的先后（话块排在这一轮讲的那样东西后面）。
  - 解完：东西 `moveObject` 到格子对应的世界坐标（有动画，走现有的 sync / moves），话块、挑战块设 `left / top / width`。
  - 调用的时机：老师的一行演完造了、删了、`place` 了东西，或者 `settle` 量出大小变了；学生的一下只在大小变了时。
  - 去掉：`setSide` / `sideToggle` / `toggleSide` / `wideDock` / `fitDock` / `placeWait` 的栏、`pickSide` 的调用、`placeCaption` 的猜位置、`reserve()` 里给话留的高、`fitView` 的横屏两种摆法；`scene.slotFor` / `placeFresh` 只给出一个初始位置（求解器会覆盖），`reflow` 不再调。`say()` 的话照旧写进 `.st-caption`，一轮清一次；前几轮的话收进顶上「说过的」按钮（`stage.scenesEl` 旁边，点开一张浮层列出 `sceneTalk`）。
- [ ] **Step 1：截图对照**：用 Task 1 的四个时刻写成 `evals/stage-gaps/new8/m1.txt … m4.txt`（老师的行照真课，加几条 `place`），`STAGE_TRY_VIEWS=横屏 node tools/stage-try.mjs evals/stage-gaps/new8/*.txt --shots <scratchpad>`，一张张看和样稿像不像；`node tools/stage-audit.mjs` 横屏不报压着、出了屏幕。
- [ ] **Step 2**：确定性：`tests/stage-compose-apply.test.js` 里用 `Scene` + `solveLayout`（不碰 DOM 的那一半：`itemsOf(scene, measure)` 拿一个假的 `measure`）同一个 log 跑两次框一样。
- [ ] **Step 3**：`npm test` 全过；提交「舞台：自由构图接到画面上（固定字号档、求解器摆、话块和挑战块进求解、去掉收放栏）」。

### Task 6: 版面写给老师

**Files:** Create `kit/src/stage/compose/report.js`；Modify `kit/src/stage/scene.js`（`stateText` 在第几幕那一行后面写「版面」几行）；Test `tests/stage-compose-report.test.js`

**Interfaces:**
- Consumes: `stage.layoutState`（Task 5）、Task 2 的 `toCells` `cellText`。
- Produces: `layoutLines({ boxes, grid, unmet, scale }) → string[]`：`版面（48 列 × 31 行）：s 6,4-40,10；tl 6,12-40,18；话 2,20-20,24`、`空着：40,2-48,18；2,26-48,31`（最大的三块，`freeRects`）、`没照办：gl 要在 s 右边，右边只剩 5 列，放在了 s 下面`、`放不下，整台缩到 9 成`。`freeRects(boxes, grid, max = 3) → cells[]`（面积最大的空矩形，贪心）。
- [ ] **Step 1：测试**：两样东西的版面那一行一字不差；空着的三块不和东西相交、按面积从大到小；`unmet` 写成那一句；没有 `unmet` 不写「没照办」。
- [ ] **Step 2**：FAIL → 实现 → PASS。
- [ ] **Step 3**：提交「舞台：版面写进舞台现状（每样的格子框、空地、没照办的）」。

### Task 7: 预览

**Files:** Create `kit/src/stage/compose/sketch.js`；Modify `kit/src/stage/loop.js`（老师这一轮写了 `preview`：演完不等学生，带示意图马上再叫一次，`why: 'preview'`）、`kit/src/stage/stage.js`（这一轮有 `preview` 时画面盖一层「老师在排版…」，下一轮开演时撤掉）；Test `tests/stage-compose-sketch.test.js`

**Interfaces:**
- Consumes: `stage.layoutState`、`layoutLines`。
- Produces: `sketchSvg({ boxes, grid, items }) → string`：格子线（每 4 格一道，边上标列号行号）、每样东西一个圆角框 + 名字 + 前 20 个字；`sketchPng(svg) → Promise<Blob>`（浏览器里 SVG → Image → canvas）；`loop.js` 发给老师的那一条：`[预览] 这一轮排成这样（图在附件）` + `layoutLines` + 图。一节课预览最多 6 次，超了不再画、照常等学生，现状里说一句。
- [ ] **Step 1：测试**：`sketchSvg` 输出里有每样东西的名字、列号 0 和 47；空的 boxes 也出得来。
- [ ] **Step 2**：FAIL → 实现 → PASS。
- [ ] **Step 3**：`?dev` 的模拟老师认「测试:预览」（`devteacher.js` 写一行 `preview`），e2e 的舞台课一段加：说「测试:预览」以后老师被再叫一次、那一条带图（只看 `class_turns` 里有 `why: 'preview'`）。
- [ ] **Step 4**：提交「舞台：预览（老师写 preview，页面画示意图马上交回）」。

## D · 说明、收尾、发布

### Task 8: 说明、文档、发布

**Files:** Modify `kit/src/stage/doc.js`、`CLAUDE-PROJECT.md`（版本号）、`docs/stage-mainline.md`、`CLAUDE.md`、rulings

- [ ] **Step 1：说明**：镜头那一节换成构图几行（总共 ≤ 400 字节）：
  ```
  place s main / place gl right-of s align=top / place A B row   构图：谁是主角、挨着谁、排一行；页面排、不重叠，排成什么样看现状「版面」（48 列网格）
  place q at=6,4-30,12          精确到格子（兜底用）；gap=s/m/l、weight=strong/weak
  say "…" near=s.had            话贴着一处；不写贴着你这一轮讲的那样
  preview                       复杂的新构图先看一眼：页面排好把示意图交回你（多等一轮）
  ```
  第六轮的 `scene` 那一行压短到 80 字节以内；`node -e` 量六门课都 ≤ 24576，超了压别的行。
- [ ] **Step 2：文档**：`docs/stage-mainline.md` 加第八轮一节；`CLAUDE.md` 舞台那一条补一句（compose/、place、preview、48 列、去掉收放栏）；rulings 收尾。
- [ ] **Step 3：检查（从轻）**：`npm test`；`node tools/desk-e2e.mjs --only stage`；四个时刻横屏截图发给我。
- [ ] **Step 4：发布**：版本号加一档、`npm run build`、`node proto/stage/build.mjs`、提交、快进合进 `main`、重新发布学习台（`la-kit.js`、`CLAUDE-PROJECT.md`、`components/*`）。
