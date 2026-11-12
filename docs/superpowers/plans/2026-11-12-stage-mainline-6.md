# 舞台主线第六轮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task（我在这个会话里一件件做，最后一次只读审查）。审查意见 `docs/superpowers/specs/2026-11-12-stage-mainline-6-review.md`、更改建议 `…-6-changes.md` 已经并进这一份。 Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 横屏时舞台铺满整屏——左边解析栏（挑战、这一幕说过的话、这一问、按钮和输入框），右边画面；一段一幕，讲完整块收起，顶上的幕条点开能原样翻回去看。

**Architecture:** 底座不动。版面只改「话、挑战、底下那一条摆在哪、镜头给它们让多少」：横屏时这三样装进一列 DOM（`.st-side`），镜头照现成的 `fitCamera({ left })` 只用右边那一块；栏宽由纯函数 `pickSide` 量出来。分幕是一条新指令 `scene`（进 log，和别的指令一样重放；收起走 `remove` / `ungoal` / `unlabel` 现有的内部函数），只认老师写的，页面不兜底分；幕的范围、标题、要点全由纯函数 `sceneSpans(log)` 从 log 推出来，不另存；幕条和回看由 `Stage` 自己造；回看是一个只读的 `Stage` 照 log 瞬间放到那一幕的最后一行。

**Tech Stack:** 原生 JS（ES modules）、`node --test`、Playwright（`tools/stage-try.mjs`、`tools/stage-audit.mjs`、`tools/desk-e2e.mjs`）。

**Spec:** `docs/superpowers/specs/2026-11-12-stage-mainline-6-design.md`

## Global Constraints

- 事实归页面、教学归老师：页面不做教学决定；教学不预制；发给老师的话不说假话、不静默失效、不用「他」「她」；讲课只能是 Opus 5.5 high。
- **底座不动**：已有每条指令的写法和意思不变；`types/*`、`*.rules.js`、`referee.js`、`goal.js`、`follow.js`、`follows/`、`loop.js` 的叫老师规则、`pointer.js`、`gestures.js`、`fitCamera`、`slotFor` / `placeFresh` / `columnSlot` 的摆法都不改意思。
- **只做横屏**（`view.w > view.h`）。竖屏走现在的代码，摆法一行不改。
- **截图的 8 条**：第 1～7 条是显示层，这一轮做（第 2～6 条和「做到过的挑战收起」在 Task 0b，第 1、7 条进 Task 2 的验收）；第 8 条（晚到的提示照演）归另一个对话框。
- **另一个对话框已经合进 `main` 的**（2026-11-12g）：`&` 的行边写边演（`lastBatch`）、提前想下一轮、每轮记屏幕（`class_turns` 的 `view`）等。开工前和每批合并前 `git fetch origin main && git rebase origin/main`。
- **两边各动哪些文件**：这一轮动 `stage.js` 的版面、镜头、话、底下那一条，`layout.js`，`stage.css` / `class.css`，句子和时间轴的画法，新文件 `scenes.js` / `lookback.js`；`scene.js` 只加 `case 'scene'` 和现状里的两句；`loop.js` / `events.js` 只加回看那一种动作和 `view.side`。不碰 `loop.js` 别的地方、`classroom.js` 的对话和下课、`doc.js` 的教法。谁后合谁 rebase。
- 不多调用 Claude：版面、分幕、回看全是页面算。
- `STAGE_TEACH + stageDoc(科目)` 每门课 ≤ 24576 字节（现在：数据结构 23961、线代 23469、操作系统 22802、英语 21151、组成原理 20997、计网 19772）。这一轮只加 `scene` 一行。
- 解析栏里的字不小于 17px；旧的话对比度不低于正文的七成；触控目标 ≥ 44px；不用 `window.confirm / alert / prompt`；注释、界面文字、提交说明用中文。
- 改了 `kit/src/`：`npm run build` 和 `node proto/stage/build.mjs`，提交 `kit/dist/la-kit.js`、`kit/dist/docs/`、`proto/stage/dist/stage-demo.js`。
- 分支 `claude/lucid-ride-ozv77a`；合并是快进到 `main`；不开 PR。
- 检查从轻：每件事自己的测试和试演；每批发布前 `npm test`、六张验收表加 `new6`、e2e 的 `stage` 段；`npm run check:stage` 全量、旧试演重放、真课整节放回、只读审查只在 Task 11 各一次。
- 自己定的事记在 `docs/superpowers/specs/2026-11-12-stage-mainline-6-rulings.md`。真课数据放 `.superpowers/`，不进 git。

## Review Focus

设计没写、但上课时最可能碰到的（每条的测试放在括号里的任务里）：

1. 老师在一轮中间写 `scene`，同一轮前面已经说过话、后面又说：前面的话归上一幕，后面的归新一幕，回看两幕各是各的（Task 5）。
2. `keep=` 写了台上没有的名字、或者写了一个贴的字 / 拨盘的名字：当场报，像别的指令写错一样进「没演上的行」，不悄悄忽略（Task 5）。
3. 刷新发生在回看开着的时候、或者老师的回话正演到一半：刷新以后回看关着、幕条和当前一幕放得回来、正在演的那一轮照旧作废或接上（Task 8）。
4. 一幕里一样东西都没造（老师连写两个 `scene`）：幕条上不出一个空的幕（Task 4）。
5. 栏宽在一轮中间因为造了新东西换了一档，学生的手指正按着右边的东西：不在拖着的时候换（`this.dragging` 时推迟，和镜头一样 `camLater`）（Task 2）。
6. 老师的行是一行一行到的（边写边演），试演工具是一下子全给，量不到先后的毛病（`&` 的行抢到前面就是这样漏的）。`scene` 要在演的那条链上按先后执行，不在收到那一行时就执行；用一行一行喂的检查验（Task 5）。
7. 栏宽换档以后，`scene.view`、「字难认」、每轮记的 `view.side` 三处是不是同一个数（Task 2）。

---

## 文件

| 文件 | 负责 |
|---|---|
| `kit/src/stage/layout.js`（改） | `pickSide`：横屏栏宽挑哪一档。纯函数 |
| `kit/src/stage/scenes.js`（新） | `sceneSpans`、`sceneLine`、`swappedLine`、`lookText`：从 log 推出幕。纯函数 |
| `kit/src/stage/stage.js`（改） | `.st-side` 装挑战、话、底下那一条；`fitView` 横屏照栏宽；`scene.view` 按右边那一块；话按幕留；`.st-dock-wide`、`.st-how`；做到过的挑战收起；`scene` 的画面一侧；幕条（`scenesEl`）；`looking` |
| `kit/src/stage/scene.js`（改） | `case 'scene'`：收起不在 keep 里的；`stateText` 多幕那一行 |
| `kit/src/stage/script.js`（改） | `COMMANDS` 加 `scene`；认得的选项 `keep` |
| `kit/src/stage/stage.css`（改） | `.st-side` 和横屏的栏、话的大小和颜色、栏里能滑 |
| `kit/src/stage/lookback.js`（新） | 回看那一层：只读 `Stage`、照 log 放、「回到现在」 |
| `kit/src/stage/classroom.js` `class.css`（改） | 顶上给幕条留一个位置（`.sc-scenes-slot`） |
| `kit/src/stage/events.js` `loop.js`（改） | 回看的事实写进下一条；回看时不数「很久没动」；`view` 多记 `side` |
| `kit/src/memory/report.js` `pages.js`（改） | 报告里「这节课的几幕」，「以前的课」里画出来（不加 `REPORT_VERSION`） |
| `kit/src/stage/types/sentence.js`、`timeline.view.js`、`stage.css`（改） | 批次 0 的显示毛病 |
| `kit/src/stage/doc.js`（改） | `scene` 一行 |
| `tools/stage-audit.mjs` `stage-measure.mjs`（改） | 横屏多量三种 |
| `tools/stage-try-lib.js`、`evals/stage-gaps/new6/*.txt`（新） | 验收表 `NEW6`、学生动作 `look 2` / `unlook` |

---

## A · 版面

### Task 0: 从 main 开工、量一个基线

- [ ] **Step 1**：确认另一个对话框的修复已合进 `main`（`git log origin/main` 里看得到它的提交），`git fetch origin main && git rebase origin/main`。
- [ ] **Step 1b：读真的屏幕**。`ArtifactData list sessions`，找最近一节舞台课，取它 `class_turns` 里学生那几条的 `view`。没有（都是 2026-11-12g 以前上的）就请我横屏打开一节舞台课动一下再取。把 `w × h` 记进 rulings；后面所有「横屏」的验收都跑两种尺寸：这个真尺寸和 1180×820。
- [ ] **Step 2**：照真课取数据（ArtifactData `sessions/c-20261112-1/class_turns` 存到 `.superpowers/data/`），写 `.superpowers/replay6.mjs`：把每一轮老师的行和 log 里学生的行拼成一份试演（去掉 memo 块），用 `STAGE_TRY_VIEWS=横屏 node tools/stage-try.mjs … --json --shots .superpowers/base6/` 跑一遍，记下每一轮演完的整台缩放 `cam.s`（`window.LAStage.cam.s`，没有就在 `stage-try.mjs` 的 JSON 里加 `scale` 一项）。
- [ ] **Step 3**：把中位数和最小值写进 rulings「基线」一节。不提交 `.superpowers/`。

### Task 0b: 时态课截图的显示毛病（第 2～6 条）和做到过的挑战

**Files:** Modify `kit/src/stage/types/sentence.js`、`kit/src/stage/types/timeline.view.js`、`kit/src/stage/stage.js`（贴的字摆哪、挑战那一列）、`kit/src/stage/stage.css`；Test `evals/stage-gaps/new6/fix-*.txt`、`tools/stage-try-lib.js`（`NEW6`）

- [ ] **Step 1：试演**，一条毛病一个最小的，照真课那两段写（`fix-rows.txt` 句子行距、`fix-label.txt` 贴的字、`fix-name.txt` 小人底下的名字、`fix-note.txt` 生词注的字、`fix-goal.txt` 做到过的挑战）。`NEW6` 加：
  - 两行的句子（没有标签）占的高不超过字高的 2.6 倍 × 行数（现在约 3.4 倍）；给一个词贴标签以后，这一句下面的东西挪动不超过一次；
  - 贴在小人上的字和小人的距离不超过 60px，不和别的贴的字相交；事件点的字不被事件条压着（排版检查不报「字溢出了格子」）；
  - 画面上没有老师起的名字（小人底下不写 `fr`）；
  - 生词注那张卡的字在屏幕上不小于 15px；重点卡和别的卡同一种字体；
  - 做到过、`when=` 里的东西都不在台上的挑战：画面上不显示，现状里还写着「做到过」。
- [ ] **Step 2**：跑表，✗。
- [ ] **Step 3**：先量句子（设计第 6 节批次 0 的说明），定一种，写进 rulings；再逐条改。
- [ ] **Step 4**：表 ✓；六张旧表 ✓；`node tools/stage-audit.mjs` 过。
- [ ] **Step 5**：提交「舞台：句子行距、贴的字、小人的名字、生词注的字；做到过的挑战不一直挂着」。

### Task 1: `pickSide` 栏宽

**Files:** Modify `kit/src/stage/layout.js`；Test `tests/stage-mainline6-side.test.js`

**Interfaces:**
- Produces: `pickSide(box, view, { top, bottom, lines, cur = null, pad }) → { w, s }`。`lines(w)` 是调用方给的函数：栏宽 w 时这一问折成几行。候选 `SIDE_SHARES = [0.30, 0.34, 0.38, 0.42]`，每档夹在 `[SIDE_MIN = 300, SIDE_MAX = 480]`。挑 `lines(w) <= 4` 里 `fitCamera(box, view, { left: w, top, bottom, pad }).s` 最大的；都超过 4 行取最宽那档。`cur` 是现在那档的 w：新的那档的 s 不比 `cur` 那档大一成（`≥ 1.1 ×`）就留在 `cur`。

- [ ] **Step 1: 写测试** `tests/stage-mainline6-side.test.js`：
  - 又宽又矮的框（`{ x:0, y:0, w:1600, h:300 }`，view `1180×820`，`lines = () => 2`）→ `w === 354`（0.30 档）。
  - 又大又方的框（`{ w:500, h:700 }`）→ 选到的 `s` 等于四档里最大的那个；
  - `lines = (w) => (w < 400 ? 6 : 3)` → `w >= 400`；
  - `cur: 354` 而别的档只大 5% → 返回 `w === 354`；
  - 每档都在 300～480 之间（view 宽 2000 时 0.42 档是 480）。
- [ ] **Step 2**：`node --test tests/stage-mainline6-side.test.js`，FAIL（`pickSide` 没有）。
- [ ] **Step 3**：在 `layout.js` 写 `pickSide`、导出 `SIDE_SHARES` `SIDE_MIN` `SIDE_MAX`。
- [ ] **Step 4**：测试 PASS。
- [ ] **Step 5**：提交「舞台：横屏解析栏的宽度照画面量（pickSide）」。

### Task 2: 横屏的解析栏（挑战、话、底下那一条进栏）

**Files:** Modify `kit/src/stage/stage.js`（`build`、`reserve`、`fitView`、`placeCaption`、`keepInView`、`camera`）、`kit/src/stage/stage.css`；Test `tests/stage-mainline6-side.test.js`（纯函数那一半）、`evals/stage-gaps/new6/side-*.txt`

**Interfaces:**
- Consumes: Task 1 的 `pickSide`。
- Produces: `stage.side`（`.st-side` 节点，横屏时 `goalsEl`、`caption`、`dock` 是它的孩子；竖屏时这三样搬回 `view`，和现在一样）；`stage.sideW`（现在的栏宽，竖屏是 0）；`stage.landscape`（布尔）。

- [ ] **Step 1：试演** `evals/stage-gaps/new6/side-wide.txt`（`ask value type=matrix` 答案 3×3、四个长选项的 `choices=`）、`evals/stage-gaps/new6/side-sentence.txt`（时态课第 62/64 轮原样：句子 + 时间轴 + 两张贴的字 + 三句话 + 一问）和 `side-matrix.txt`（一张 3×3 矩阵 + 一张乘积 + 两句话 + `ask value`）。在 `tools/stage-try-lib.js` 加表 `NEW6` 的头两条：横屏时 `.st-side` 和画面里所有 `data-obj` 的框不相交；栏里没有字小于 17px；这一问整句在栏里看得见；话不压在画面里任何一样东西上（截图第 1 条）；等回话的三个点在栏里（截图第 7 条）；宽的输入不压着画面里的东西、每一格不小于 44px。
- [ ] **Step 2**：`node tools/stage-must.mjs evals/stage-gaps/new6 --table new6`，这两条 ✗。
- [ ] **Step 3：实现**：
  - `build` 多一个 `.st-side`；`noteView`（屏幕大小变了）时按 `view.w > view.h` 把 `goalsEl` `caption` `dock` 搬进 / 搬出它（`landscape` 跟着设）。
  - 横屏的 `reserve()` 返回 `{ top: 12, bottom: 12 }`（话和底下那一条不再占画面上下）；`fitView` 横屏时直接 `fitCamera(box, view, { top, bottom, left: this.sideW, … })`，竖屏照旧走现在的代码（含 `camSide`）。
  - `sideW` 在三个时候重算（`pickSide`，`cur: this.sideW`）：一轮开头（`execTurn` 变了的第一行）、造了新东西、`scene`。`this.dragging` 时不算，记 `sideLater`，松手时和 `camLater` 一起补。`lines(w)` 用一个藏着的量字节点量这一问在宽 w 时的高度 ÷ 行高。
  - 横屏的 `placeCaption` 不写 `bottom`（话在栏里，不跟着画面）；`keepInView` 不为话让地方。
  - 横屏时 `noteView` 给 `scene.view` 的是 `{ w: 整屏宽 − sideW, h }`；`noteClipped` 的「缩到几成」照同一块算；`sideW` 换档时重写 `scene.view`。`loop.js` 的 `view` 多记 `side: stage.sideW`。
  - 等回话的三个点（`.sc-wait`）横屏时放进栏里这一问的位置。
  - 这一问的输入放不下栏（设计 2.9 的量法）：输入那一部分放进 `.st-dock-wide`（右边画面底部正中），`reserve()` 的 `bottom` 加上它的高。
  - CSS：`.st-side` 绝对定位在左边，宽 `var(--side-w)`，竖着排（挑战、话（`flex: 1; overflow-y: auto`）、底下那一条），右边一道 0.5px 细线；横屏的 `.st-line` 宽 100%。
- [ ] **Step 4**：`NEW6` 那两条 ✓；`fix1` `new2` `new3` `new4` `new5` `first` 照旧全 ✓（竖屏的截图和改之前一样）。
- [ ] **Step 5**：提交「舞台：横屏左边解析栏、右边画面（挑战、话、底下那一条进栏）」。

### Task 3: 话按幕留着、栏里能滑、手怎么动的一句

**Files:** Modify `kit/src/stage/stage.js`（`say`）、`stage.css`、`kit/src/stage/classroom.js`；Test `evals/stage-gaps/new6/side-long.txt`、`tests/stage-mainline6-side.test.js`

**Interfaces:**
- Produces: 横屏时 `say` 不再「新一轮开口就收起」、不受 `CAPTION_MAX`：一幕里的话都留着（Task 5 的 `scene` 调 `stage.clearSide()` 收整栏）；`stage.clearSide()`；竖屏的 `say` 一字不改。

- [ ] **Step 1：试演** `side-long.txt`：一幕里四轮、每轮两三句话（共 11 句）。`NEW6` 加：11 句都在栏里（`.st-line:not(.is-out)` 数到 11）；前几轮的有 `is-past`、字号 ≥ 17px；栏滚到底；最后一问看得见。
- [ ] **Step 2**：跑表，✗。
- [ ] **Step 3**：`say` 横屏分支：旧的一轮加 `is-past`，不 `out`；新的一句来了栏滚到底，学生往上滑过（`scrollTop` 离底 > 40px）就不滚、栏底出「回到最新 ↓」（44px 高，点了滚到底）。`clearSide()` 把整栏的 `.st-line` 淡出。CSS：横屏 `.st-line.is-past` 17px、颜色 `rgb(var(--chalk-rgb) / 0.7)`（深色白天两种都看一遍）。
- [ ] **Step 4：手怎么动**（设计 2.10）。老师这一轮新 `open` 的动作，在栏里这一问下面写 `rulesOf(o).gestures[动作].brief`（`.st-how`，一种动作一句，最多两句；这一幕里写过的不再写，`clearSide()` 时清掉记着的）。`NEW6` 加：`open r mark` 以后栏里有那一句；同一幕第二次 `open r mark` 不重复；发给老师的那一条里没有多出东西。
- [ ] **Step 5**：表 ✓、六张旧表 ✓；`npm run e2e -- --only stage` 过。
- [ ] **Step 6**：提交「舞台：横屏时一幕的话都留在栏里；新交给学生的手写一句怎么动」。
- [ ] **Step 7：发布一次**（A 批）：`npm test`、`npm run build`、`node proto/stage/build.mjs`，合进 `main`，重新发布学习台（`CLAUDE.md`「发布」），版本号加一档。截两张横屏图（1180×820、1366×1024）给我。

## B · 一段一幕

### Task 4: `scenes.js`：从 log 推出幕

**Files:** Create `kit/src/stage/scenes.js`；Test `tests/stage-scenes.test.js`

**Interfaces:**
- Consumes: `stage.log` 的行 `{ src, by, turn, … }`；`parseScript`（`script.js`）。
- Produces:
  - `sceneSpans(log, { title = '开头' } = {}) → [{ n, title, start, end, keep: [], keys: [] }]`：`start` 是这一幕第一行在 log 里的下标（第一幕 0），`end` 是最后一行（含）；`scene` 那一行算新一幕的第一行；`keys` 是这一幕里 `label … tone=key` 的字（同一个 id 改写过取最后一次，`unlabel` 过的照样留：要点是讲过的，不是还贴着的）。一样东西都没造的幕（只有 `scene` 一行，或只有 say）并进后一幕，不单列。
  - `sceneLine(spans) → string`：舞台现状那一行，`第 4 幕「过去完成时」（前面：① 一般时 ② 进行时 ③ 现在完成时）`；只有一幕返回 `''`。
  - `swappedLine(before, after, wroteScene) → string`：老师这一轮演完，`before`（这一轮开头台上东西的 id 数组）非空、`after` 非空、两者没有交集、`wroteScene` 为假时返回「台上的东西这一轮全换了（没写 scene：是新的一段就写 scene \"标题\"，学生才翻得回去）」，别的返回 `''`。
  - `lookText(looks) → string`：`[{ n, title, ms }]` → `学生翻回去看了第 2 幕「进行时」（40 秒）；第 1 幕「开头」（8 秒）`。

- [ ] **Step 1：写测试** `tests/stage-scenes.test.js`：
  - 没有 `scene` 的 log → 一幕，`title: '开头'`，`start 0`、`end = log.length - 1`。
  - `say` `sentence s = …` `scene "进行时"` `say` → 两幕，第二幕 `start` 是 `scene` 那一行。
  - 连写两个 `scene "a"` `scene "b"` 中间没东西 → 没有叫 a 的空幕。
  - `label k s "重点：…" tone=key` 两次改写 → `keys` 只有最后那句；`unlabel k` 以后 `keys` 还在。
  - `scene "x" keep=tl` → `keep: ['tl']`。
  - `sceneLine` 一幕时 `''`；三幕时正好是上面那句的格式。
  - `swappedLine(['s','tl'], ['d'], false)` 是那一句；`(['s'], ['s','d'], false)`、`(['s'], ['d'], true)`、`([], ['d'], false)` 都是 `''`。
  - `lookText([{ n: 2, title: '进行时', ms: 40000 }])` → `'学生翻回去看了第 2 幕「进行时」（40 秒）'`；不用「他」「她」。
- [ ] **Step 2**：FAIL。
- [ ] **Step 3**：写 `scenes.js`。
- [ ] **Step 4**：PASS。
- [ ] **Step 5**：提交「舞台：从 log 推出这节课的几幕（scenes.js）」。

### Task 5: `scene` 指令和 `keep=`

**Files:** Modify `kit/src/stage/script.js`（`COMMANDS`、认得的选项）、`kit/src/stage/scene.js`（`case 'scene'`、`stateText`）、`kit/src/stage/stage.js`（`exec` 里 `scene` 的画面一侧）、`kit/src/stage/doc.js`；Test `tests/stage-scenes.test.js`、`evals/stage-gaps/new6/scene-*.txt`

**Interfaces:**
- Consumes: Task 4 的 `sceneSpans` `sceneLine`；Task 3 的 `stage.clearSide()`。
- Produces: `scene.apply({ cmd: 'scene', … })` 返回 `{ scene: title, keep, dropped: [ids] }`；`stage.sceneNo`（现在第几幕）。

- [ ] **Step 1：写测试**（纯 Scene，不碰 DOM，`tests/stage-scenes.test.js`）：一台上有 `s`（贴着 `gl`）、`tl`（拨盘 `e`、贴着 `lf`，学生开着 `open tl.fr move`）、挑战 `g1`（带 `@g1` 预写）、`watch w1`、一个存档点 `keep s "x"`、等着的一问（带 `@ask.right`）、`@s.done`、学生点着的圈、一排格子 `a` 上 `follow a sort shell`。两份 clone：一份 `apply(scene "x" keep=tl)`，一份 apply 等价的一串（`remove s` `remove a` `ungoal g1` `unlabel gl` …、收掉等着的一问）。两份的 `stateText()` 去掉幕那一行以后一字不差，而且 `objects` 只剩 `tl`、`labels` 只剩 `lf`、`vars` 里 `e` 在。`keep=zz`（没有）→ `check()` 返回「舞台上没有「zz」」那样的一句；`keep=gl`（是贴的字）→ 报「keep 只能写舞台上的东西」。
- [ ] **Step 2：试演** `scene-keep.txt`、`scene-mid.txt`（Review Focus 1：一轮里 say → scene → say）。`NEW6` 加：`scene` 以后台上、栏里、挑战都干净；老师全换了东西没写 `scene` 时现状里有 `swappedLine` 那一句、台上没被动过；keep 的东西和贴在它上面的字在；`scene-mid` 回看第一幕时栏里是前一句、第二幕是后一句；现状里有幕的那一行。
- [ ] **Step 3**：FAIL。
- [ ] **Step 4：实现**：`script.js` 加 `scene`、选项只加 `keep`。`scene.js` 的 `case 'scene'` 逐样调 `remove` / `ungoal` / `unlabel` / 换问时收旧问的内部函数（设计 3.2），不直接清表；`stateText` 在最前面加 `sceneLine(sceneSpans(log, { title }))`（log 和课名由 stage 传进来：`stateText({ log, title })`，和幕条同一个第一幕的名字；没传就不写）。`stage.js` 的 `exec` 遇到 `scene`：`clearSide()`、栏顶写标题（`.st-side-title`，宋体 `var(--display)`）、重算栏宽、`refocus`。`doc.js` 的镜头那一节加一行：`scene "过去完成时" [keep=tl]   开新的一幕：上一幕整块收起（学生能翻回去看），keep 的带过来`。
- [ ] **Step 4b：一行一行喂**。`tools/stage-touch-first.mjs` 加一段 `scene`（照 `stream` 那一段：每 30 毫秒喂一行）：`sentence a …` / `say …` / `scene "二"` / `sentence b …` / `& paint b.1 g1` / `ask next`。演完台上只有 b、b.1 染上了、没有没演上的行。
- [ ] **Step 4c：现状里的那一句**。老师这一轮把台上全换了又没写 `scene`：`stateText` 里有 `swappedLine` 的那一句；写了 `scene` 的、只换了一部分的没有。
- [ ] **Step 5**：表 ✓；`node -e` 量六门课的说明都 ≤ 24576；`tests/stage-doc.test.js` 过（说明里的例子照抄能演）。
- [ ] **Step 6**：提交「舞台：scene 开新的一幕（上一幕整块收起、keep 带过来）」。

### Task 6:（删掉：页面不兜底分幕，见设计 3.3；做到过的挑战在 Task 0b）

### Task 7: 幕条和回看

**Files:** Create `kit/src/stage/lookback.js`；Modify `kit/src/stage/stage.js`（幕条 `scenesEl`）、`kit/src/stage/classroom.js`（顶上留位置）、`kit/src/stage/class.css`、`kit/src/stage/stage.css`；Test `evals/stage-gaps/new6/look-*.txt`、`tools/stage-try-lib.js`（学生动作 `look 2` / `unlook`）

**Interfaces:**
- Consumes: Task 4 的 `sceneSpans`；`Stage` 构造（`input: false`）和 `replay(log)`。
- Produces:
  - `openLook(host, { log, span, title, onClose }) → { close() }`（`lookback.js`）：整屏盖一层 `.sc-look`，里面 `new Stage(el, { input: false, bare: true })`（不传 `onAct`、不记证据、不写库、不占 `window.LAStage`、不挂全局监听；关上不销毁，留着下次用，最多 4 个），`await stage.replay(log.slice(0, span.end + 1))`（瞬间放），顶上「回看 · 第 n 幕 标题」和「回到现在 →」（44px），从左往右滑 80px 以上也关。同一幕放好的 Stage 留着，下次直接显示；整节课最多留 4 个，多了丢最早的。
  - 回看层的左栏顶上列 `span.keys`（这一幕的要点）。
  - 幕条由 `Stage` 造：`stage.scenesEl`，`new Stage(el, { scenesHost })` 给了位置就放进去，没给放在自己顶上；课堂在顶上那一条里留一个 `.sc-scenes-slot` 传给它。`sceneSpans(stage.log, { title: 课名 })`（第一幕叫这节课的课名，设计 3.2）多于一幕时显示，一幕一个胶囊（`① 一般时`），现在这一幕 `is-now`；每次演完一行以后重画（变了才动 DOM）；长按 0.45 秒弹要点（只读的小框）。
  - 回看开着时 `stage.looking = { n, since }`；关上时 `stage.onAct({ type: 'look', n, title, ms })`。老师的回话照常演在底下的舞台；回看开着时「回到现在」上加一个点（`.has-new`）；回到现在时，回看期间演过老师的一轮就出「再看一遍」（现成的 `RETRY`）。

- [ ] **Step 1：试演** `look-basic.txt`：两幕，第一幕学生把小人拖到「过去之后」，第二幕开始后 `学生: look 1`。`NEW6` 加：回看那个 `Stage` 的 `scene.stateText()` 和第一幕最后一刻记下的现状一字不差（去掉在等学生、学生能直接动的那几行）；回看层里拖小人没反应（`input: false`）；`学生: unlook` 以后回到第二幕、画面和打开前一样。
- [ ] **Step 2**：`stage-try-lib.js` 的 `STUDENT_FORMS` 加 `look n`（点幕条第 n 个）、`unlook`（点「回到现在」）。FAIL。
- [ ] **Step 3**：实现 `lookback.js` 和幕条。
- [ ] **Step 4**：`node tools/stage-touch.mjs` 加一段：幕条的胶囊、「回到现在」手指点得到（≥ 44px，不被别的东西盖着）。PASS；表 ✓。
- [ ] **Step 5**：提交「舞台：顶上的幕条，点开原样回看那一幕」。

### Task 8: 回看时的课堂循环、刷新

**Files:** Modify `kit/src/stage/events.js`、`kit/src/stage/loop.js`；Test `tests/stage-events.test.js`（加几项）、`evals/stage-gaps/new6/look-idle.txt`

**Interfaces:**
- Consumes: Task 7 的 `look` 动作和 `stage.looking`；Task 4 的 `lookText`。
- Produces: `look` 动作是不叫老师的那一类（和拨数的「试」一样攒着，跟着下一条走）；[学生] 里多一行 `lookText(…)`；`loop.js` 数「很久没动」时 `stage.looking` 为真就不数，关上回看时从 0 重新数。

- [ ] **Step 1：写测试**：提前想好的下一轮（`loop.js` 的 `maybeSpec`）：学生回看过以后发出去的那一条多了回看的一句，对不上是对的，不为它改提前想的规则；确认这种时候记的是「没用上」，不报错。`events.js` 收到 `{ type: 'look', n: 2, title: '进行时', ms: 40000 }` → 不触发叫老师（`triggers` 为假）；下一条学生的消息里有 `学生翻回去看了第 2 幕「进行时」（40 秒）`；同一节里看了两次第 2 幕合成一句、秒数加起来。
- [ ] **Step 2：试演** `look-idle.txt`：挑战没做到，学生 `look 1` 停 90 秒（试演工具 `wait 90000` 用假时钟），再 `unlook`。`NEW6` 加：开着回看的那 90 秒没叫老师；关上以后重新数。
- [ ] **Step 3**：FAIL。
- [ ] **Step 4**：实现。
- [ ] **Step 5：刷新**（Review Focus 3）：e2e 的 `stage` 段加：开课 → 老师写两幕 → 点开第 1 幕 → 刷新 → 回看是关着的、幕条两幕都在、第 2 幕是当前；再点开第 1 幕，画面对。
- [ ] **Step 6**：PASS；`npm run e2e -- --only stage` 过。
- [ ] **Step 7**：提交「舞台：回看时不算很久没动，看过哪几幕告诉老师」。

### Task 9: 报告和「以前的课」里的几幕

**Files:** Modify `kit/src/memory/report.js`（`buildReport` 舞台课那一支）、`kit/src/memory/pages.js`；Test `tests/memory-report.test.js`（加一项）

**Interfaces:**
- Consumes: Task 4 的 `sceneSpans`（log 从 `class_turns` 的 `log` 拼起来，和刷新时同一个拼法）。
- Produces: 报告多 `scenes: [{ n, title, keys }]`；`REPORT_VERSION` **不加**（只给新下课的课写）；「以前的课」点进一节舞台课多一段「这节课的几幕」：一幕一行标题，下面它的要点。

- [ ] **Step 1：写测试**：一节两幕的舞台课的 turns → `buildReport(…).scenes` 是两项、第二项的 `keys` 有那张重点卡的字；黑板课、一问一答的课没有 `scenes`；旧版本号的报告不因为这一轮被重算。
- [ ] **Step 2**：FAIL → 实现 → PASS。
- [ ] **Step 3**：e2e 的 `stage` 段：下课以后「以前的课」里看得到两幕的标题。
- [ ] **Step 4**：提交「学习台：舞台课的报告和以前的课里列出这节课的几幕」。
- [ ] **Step 5：发布一次**（B 批），同 Task 3 Step 7。

## C · 收尾

### Task 10: 排版检查横屏多量三种

**Files:** Modify `tools/stage-measure.mjs`、`tools/stage-audit.mjs`

- [ ] **Step 1**：`measure` 横屏时多报：`解析栏压着画面`（`.st-side` 的框和任一 `data-obj` 相交 > 24px²）、`栏里的字太小`（`.st-side` 里可见文字的 `font-size` < 17px）、`宽输入压着东西`（`.st-dock-wide` 的框和画面里任一 `data-obj` 相交）、`这一问看不见`（最后一个 `.st-line[data-kind="ask"]` 不在 `.st-side` 的可见范围里）。
- [ ] **Step 2**：`node tools/stage-audit.mjs` 内置的一批横屏全过；故意把 `.st-line.is-past` 写成 14px 跑一次，报得出来，再改回去。
- [ ] **Step 3**：提交「排版检查：横屏的解析栏多量三种」。

### Task 11: 真课整节放回、全量检查、审查、文档

- [ ] **Step 1：真课放回**：用 Task 0 的 `.superpowers/replay6.mjs` 再跑一遍时态课，横屏（真屏幕和 1180×820 两种）每一轮截一张，**逐张看**（压不压、字大不大、栏里是不是这一幕的话）。整台缩放的中位数比基线大，没有一轮比基线小两成以上。数字写进 rulings。
- [ ] **Step 2**：`npm test`、`npm run check:stage`、`npm run check:pages`、`npm run e2e` 全量；七张表 `fix1` `new2` `new3` `new4` `new5` `first` `new6` 全 ✓。
- [ ] **Step 3：旧试演重放**：`node tools/stage-try-diff.mjs`（282 份），发给老师的东西一字不差（旧试演里没有 `scene`）；横屏下「字难认」那一句可能不同（改成按右边那一块算了），逐条列出来写进 rulings。
- [ ] **Step 4：只读审查**（一个新的助手，只读）：页面有没有替老师做教学决定（重点看 `scene` 有没有清掉老师没让清的、手怎么动那一句有没有变成解题提示）；`scene` 和等价的一串 `remove` 有没有不一样的地方；回看时课堂循环有没有漏叫或多叫老师；竖屏是不是一行没变。查出的照修，一条一个测试（`tests/stage-mainline6-review.test.js`）。
- [ ] **Step 5：文档**：`docs/stage-mainline.md` 加第六轮一节；`docs/stage-plan.md` 进度；`CLAUDE.md` 舞台那一条补「横屏左边解析栏」「scene 一幕、幕条回看」和 `new6` 的验收命令；rulings 收尾。
- [ ] **Step 6：发布**：版本号、`npm run build`、`node proto/stage/build.mjs`，合进 `main`，重新发布学习台；截横屏两种尺寸给我看。
