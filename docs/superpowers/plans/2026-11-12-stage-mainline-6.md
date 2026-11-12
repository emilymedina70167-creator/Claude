# 舞台主线第六轮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 横屏时舞台铺满整屏——左边解析栏（挑战、这一幕说过的话、这一问、按钮和输入框），右边画面；一段一幕，讲完整块收起，顶上的幕条点开能原样翻回去看。

**Architecture:** 底座不动。版面只改「话、挑战、底下那一条摆在哪、镜头给它们让多少」：横屏时这三样装进一列 DOM（`.st-side`），镜头照现成的 `fitCamera({ left })` 只用右边那一块；栏宽由纯函数 `pickSide` 量出来。分幕是一条新指令 `scene`（进 log，和别的指令一样重放），幕的范围、标题、要点全由纯函数 `sceneSpans(log)` 从 log 推出来，不另存；回看是一个只读的 `Stage` 照 log 瞬间放到那一幕的最后一行。

**Tech Stack:** 原生 JS（ES modules）、`node --test`、Playwright（`tools/stage-try.mjs`、`tools/stage-audit.mjs`、`tools/desk-e2e.mjs`）。

**Spec:** `docs/superpowers/specs/2026-11-12-stage-mainline-6-design.md`

## Global Constraints

- 事实归页面、教学归老师：页面不做教学决定；教学不预制；发给老师的话不说假话、不静默失效、不用「他」「她」；讲课只能是 Opus 5.5 high。
- **底座不动**：已有每条指令的写法和意思不变；`types/*`、`*.rules.js`、`referee.js`、`goal.js`、`follow.js`、`follows/`、`loop.js` 的叫老师规则、`pointer.js`、`gestures.js`、`fitCamera`、`slotFor` / `placeFresh` / `columnSlot` 的摆法都不改意思。
- **只做横屏**（`view.w > view.h`）。竖屏走现在的代码，摆法一行不改。
- **不碰另一个对话框在修的那几条**（话压在句子上、句子行距、做完的挑战还挂着、贴的字离得远、小人底下的「fr」、生词注字小 / 字体不一、三个点浮在中间、晚到的提示照演）。**Task 0 之前那边必须已合进 `main`**。
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

---

## 文件

| 文件 | 负责 |
|---|---|
| `kit/src/stage/layout.js`（改） | `pickSide`：横屏栏宽挑哪一档。纯函数 |
| `kit/src/stage/scenes.js`（新） | `sceneSpans`、`sceneLine`、`autoTitle`、`lookText`：从 log 推出幕。纯函数 |
| `kit/src/stage/stage.js`（改） | `.st-side` 装挑战、话、底下那一条；`fitView` 横屏照栏宽；话按幕留；`scene` 的画面一侧；页面兜底分幕；`looking` |
| `kit/src/stage/scene.js`（改） | `case 'scene'`：收起不在 keep 里的；`stateText` 多幕那一行 |
| `kit/src/stage/script.js`（改） | `COMMANDS` 加 `scene`；认得的选项 `keep` |
| `kit/src/stage/stage.css`（改） | `.st-side` 和横屏的栏、话的大小和颜色、栏里能滑 |
| `kit/src/stage/lookback.js`（新） | 回看那一层：只读 `Stage`、照 log 放、「回到现在」 |
| `kit/src/stage/classroom.js` `class.css`（改） | 顶上的幕条、量屏幕写 `sessions.screen` |
| `kit/src/stage/events.js` `loop.js`（改） | 回看的事实写进下一条；回看时不数「很久没动」 |
| `kit/src/memory/report.js` `pages.js`（改） | 报告里「这节课的几幕」，「以前的课」里画出来 |
| `kit/src/stage/doc.js`（改） | `scene` 一行 |
| `tools/stage-audit.mjs` `stage-measure.mjs`（改） | 横屏多量三种 |
| `tools/stage-try-lib.js`、`evals/stage-gaps/new6/*.txt`（新） | 验收表 `NEW6`、学生动作 `look 2` / `unlook` |

---

## A · 版面

### Task 0: 从 main 开工、量一个基线

- [ ] **Step 1**：确认另一个对话框的修复已合进 `main`（`git log origin/main` 里看得到它的提交），`git fetch origin main && git rebase origin/main`。
- [ ] **Step 2**：照真课取数据（ArtifactData `sessions/c-20261112-1/class_turns` 存到 `.superpowers/data/`），写 `.superpowers/replay6.mjs`：把每一轮老师的行和 log 里学生的行拼成一份试演（去掉 memo 块），用 `STAGE_TRY_VIEWS=横屏 node tools/stage-try.mjs … --json --shots .superpowers/base6/` 跑一遍，记下每一轮演完的整台缩放 `cam.s`（`window.LAStage.cam.s`，没有就在 `stage-try.mjs` 的 JSON 里加 `scale` 一项）。
- [ ] **Step 3**：把中位数和最小值写进 rulings「基线」一节。不提交 `.superpowers/`。

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

- [ ] **Step 1：试演** `evals/stage-gaps/new6/side-sentence.txt`（时态课第 62/64 轮原样：句子 + 时间轴 + 两张贴的字 + 三句话 + 一问）和 `side-matrix.txt`（一张 3×3 矩阵 + 一张乘积 + 两句话 + `ask value`）。在 `tools/stage-try-lib.js` 加表 `NEW6` 的头两条：横屏时 `.st-side` 和画面里所有 `data-obj` 的框不相交；栏里没有字小于 17px；这一问整句在栏里看得见。
- [ ] **Step 2**：`node tools/stage-must.mjs evals/stage-gaps/new6 --table new6`，这两条 ✗。
- [ ] **Step 3：实现**：
  - `build` 多一个 `.st-side`；`noteView`（屏幕大小变了）时按 `view.w > view.h` 把 `goalsEl` `caption` `dock` 搬进 / 搬出它（`landscape` 跟着设）。
  - 横屏的 `reserve()` 返回 `{ top: 12, bottom: 12 }`（话和底下那一条不再占画面上下）；`fitView` 横屏时直接 `fitCamera(box, view, { top, bottom, left: this.sideW, … })`，竖屏照旧走现在的代码（含 `camSide`）。
  - `sideW` 在三个时候重算（`pickSide`，`cur: this.sideW`）：一轮开头（`execTurn` 变了的第一行）、造了新东西、`scene`。`this.dragging` 时不算，记 `sideLater`，松手时和 `camLater` 一起补。`lines(w)` 用一个藏着的量字节点量这一问在宽 w 时的高度 ÷ 行高。
  - 横屏的 `placeCaption` 不写 `bottom`（话在栏里，不跟着画面）；`keepInView` 不为话让地方。
  - CSS：`.st-side` 绝对定位在左边，宽 `var(--side-w)`，竖着排（挑战、话（`flex: 1; overflow-y: auto`）、底下那一条），右边一道 0.5px 细线；横屏的 `.st-line` 宽 100%。
- [ ] **Step 4**：`NEW6` 那两条 ✓；`fix1` `new2` `new3` `new4` `new5` `first` 照旧全 ✓（竖屏的截图和改之前一样）。
- [ ] **Step 5**：提交「舞台：横屏左边解析栏、右边画面（挑战、话、底下那一条进栏）」。

### Task 3: 话按幕留着、栏里能滑、量屏幕

**Files:** Modify `kit/src/stage/stage.js`（`say`）、`stage.css`、`kit/src/stage/classroom.js`；Test `evals/stage-gaps/new6/side-long.txt`、`tests/stage-mainline6-side.test.js`

**Interfaces:**
- Produces: 横屏时 `say` 不再「新一轮开口就收起」、不受 `CAPTION_MAX`：一幕里的话都留着（Task 5 的 `scene` 调 `stage.clearSide()` 收整栏）；`stage.clearSide()`；竖屏的 `say` 一字不改。

- [ ] **Step 1：试演** `side-long.txt`：一幕里四轮、每轮两三句话（共 11 句）。`NEW6` 加：11 句都在栏里（`.st-line:not(.is-out)` 数到 11）；前几轮的有 `is-past`、字号 ≥ 17px；栏滚到底；最后一问看得见。
- [ ] **Step 2**：跑表，✗。
- [ ] **Step 3**：`say` 横屏分支：旧的一轮加 `is-past`，不 `out`；新的一句来了栏滚到底，学生往上滑过（`scrollTop` 离底 > 40px）就不滚、栏底出「回到最新 ↓」（44px 高，点了滚到底）。`clearSide()` 把整栏的 `.st-line` 淡出。CSS：横屏 `.st-line.is-past` 17px、颜色 `rgb(var(--chalk-rgb) / 0.7)`（深色白天两种都看一遍）。
- [ ] **Step 4**：`classroom.js` 开课时把 `{ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }` 写进 `desk.updateSession({ screen })`，`resize` 后变了再写一次（同一节课最多写 5 次）。只读的课不写。
- [ ] **Step 5**：表 ✓、六张旧表 ✓；`npm run e2e -- --only stage` 过。
- [ ] **Step 6**：提交「舞台：横屏时一幕的话都留在栏里；记下 iPad 的屏幕大小」。
- [ ] **Step 7：发布一次**（A 批）：`npm test`、`npm run build`、`node proto/stage/build.mjs`，合进 `main`，重新发布学习台（`CLAUDE.md`「发布」），版本号加一档。截两张横屏图（1180×820、1366×1024）给我。

## B · 一段一幕

### Task 4: `scenes.js`：从 log 推出幕

**Files:** Create `kit/src/stage/scenes.js`；Test `tests/stage-scenes.test.js`

**Interfaces:**
- Consumes: `stage.log` 的行 `{ src, by, turn, … }`；`parseScript`（`script.js`）。
- Produces:
  - `sceneSpans(log, { title = '开头' } = {}) → [{ n, title, start, end, auto, keep: [], keys: [] }]`：`start` 是这一幕第一行在 log 里的下标（第一幕 0），`end` 是最后一行（含）；`scene` 那一行算新一幕的第一行；`auto` 是页面兜底分的（那一行 `by: 'page'`、src 带 `auto=on`）；`keys` 是这一幕里 `label … tone=key` 的字（同一个 id 改写过取最后一次，`unlabel` 过的照样留：要点是讲过的，不是还贴着的）。一样东西都没造的幕（只有 `scene` 一行，或只有 say）并进后一幕，不单列。
  - `sceneLine(spans) → string`：舞台现状那一行，`第 4 幕「过去完成时」（前面：① 一般时 ② 进行时 ③ 现在完成时）`；只有一幕返回 `''`。
  - `autoTitle(text) → string`：话的前 12 个字（去掉 `{…}` 小牌的花括号、末尾标点），空的返回 `'新的一段'`。
  - `lookText(looks) → string`：`[{ n, title, ms }]` → `学生翻回去看了第 2 幕「进行时」（40 秒）；第 1 幕「开头」（8 秒）`。

- [ ] **Step 1：写测试** `tests/stage-scenes.test.js`：
  - 没有 `scene` 的 log → 一幕，`title: '开头'`，`start 0`、`end = log.length - 1`。
  - `say` `sentence s = …` `scene "进行时"` `say` → 两幕，第二幕 `start` 是 `scene` 那一行。
  - 连写两个 `scene "a"` `scene "b"` 中间没东西 → 没有叫 a 的空幕。
  - `label k s "重点：…" tone=key` 两次改写 → `keys` 只有最后那句；`unlabel k` 以后 `keys` 还在。
  - `scene "x" keep=tl` → `keep: ['tl']`。
  - 页面那一行 `{ by: 'page', src: 'scene "新的一段" auto=on' }` → `auto: true`。
  - `sceneLine` 一幕时 `''`；三幕时正好是上面那句的格式。
  - `autoTitle('新的一段：发生在过去某件事之前的事，谓语怎么写？')` → `'新的一段：发生在过去某件'`（前 12 个字）；`autoTitle('对。')` → `'对'`（去掉末尾标点）；`autoTitle('')` → `'新的一段'`。调用方传进来的是小牌已经换成词的那句（`stage.js` 用 `chipText` 换好，`{s.had}` → `had`）。
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

- [ ] **Step 1：写测试**（纯 Scene，不碰 DOM）：一台上有 `s`（贴着 `gl`）、`tl`（拨盘 `e`、贴着 `lf`）、挑战 `g1`、等着的一问、预写 `@g1`。`apply(scene "过去完成时" keep=tl)` 以后：`objects` 只剩 `tl`；`labels` 只剩 `lf`；`vars` 里 `e` 还在；`goals` 空；`waiting` 是 null；`reactions` 空。`keep=zz`（没有）→ `check()` 返回「舞台上没有「zz」」那样的一句。`keep=gl`（是贴的字）→ 报「keep 只能写舞台上的东西」。
- [ ] **Step 2：试演** `scene-keep.txt`、`scene-mid.txt`（Review Focus 1：一轮里 say → scene → say）。`NEW6` 加：`scene` 以后台上、栏里、挑战都干净；keep 的东西和贴在它上面的字在；`scene-mid` 回看第一幕时栏里是前一句、第二幕是后一句；现状里有幕的那一行。
- [ ] **Step 3**：FAIL。
- [ ] **Step 4：实现**：`script.js` 加 `scene`、选项 `keep`（和 `auto`，只给页面自己写）。`scene.js` 的 `case 'scene'` 照 `remove` 的路子拿掉不在 keep 里的（它们的贴的字、拨盘一起），清 `goals` `reactions` `waiting` `say`；`stateText` 在最前面加 `sceneLine(sceneSpans(log, { title }))`（log 和课名由 stage 传进来：`stateText({ log, title })`，和幕条同一个第一幕的名字；没传就不写）。`stage.js` 的 `exec` 遇到 `scene`：`clearSide()`、栏顶写标题（`.st-side-title`，宋体 `var(--display)`）、重算栏宽、`refocus`。`doc.js` 的镜头那一节加一行：`scene "过去完成时" [keep=tl]   开新的一幕：上一幕整块收起（学生能翻回去看），keep 的带过来`。
- [ ] **Step 5**：表 ✓；`node -e` 量六门课的说明都 ≤ 24576；`tests/stage-doc.test.js` 过（说明里的例子照抄能演）。
- [ ] **Step 6**：提交「舞台：scene 开新的一幕（上一幕整块收起、keep 带过来）」。

### Task 6: 页面兜底分幕

**Files:** Modify `kit/src/stage/stage.js`（老师那一轮的 `exec`）；Test `evals/stage-gaps/new6/auto-*.txt`

**Interfaces:**
- Consumes: Task 4 的 `autoTitle`；Task 5 的 `scene` 指令。
- Produces: 老师的一轮里，台上的东西被 `remove` 光了（`scene.objects.size === 0`，这一轮之前不是 0），接着这一轮又造了新东西：页面在造的那一行**之前**往 log 里插一行 `{ by: 'page', src: 'scene "<autoTitle(这一轮下一句 say)>" auto=on' }` 并执行它；`stage.errors` 不记，现状里那一行后面加「（页面在这里分了一幕，下次可以写 scene "标题"）」，只说一次。

- [ ] **Step 1：试演**：`auto-cut.txt`（时态课第 28→29 轮那样：remove 光了再造句子 → 分）、`auto-no.txt`（只 remove 一句、留着时间轴再造一句 → 不分）、`auto-written.txt`（老师自己写了 `scene` 再 remove 光 → 不重复分）。`NEW6` 加这三条。
- [ ] **Step 2**：FAIL。
- [ ] **Step 3**：实现。插的那一行进 log，刷新照 log 重放出同一幕（重放时 `replay: true` 不再兜底，免得插两次）。
- [ ] **Step 4**：表 ✓。
- [ ] **Step 5**：提交「舞台：老师拿光了再造，页面兜底分一幕」。

### Task 7: 幕条和回看

**Files:** Create `kit/src/stage/lookback.js`；Modify `kit/src/stage/classroom.js`（顶上一条）、`kit/src/stage/class.css`、`kit/src/stage/stage.css`；Test `evals/stage-gaps/new6/look-*.txt`、`tools/stage-try-lib.js`（学生动作 `look 2` / `unlook`）

**Interfaces:**
- Consumes: Task 4 的 `sceneSpans`；`Stage` 构造（`input: false`）和 `replay(log)`。
- Produces:
  - `openLook(host, { log, span, title, onClose }) → { close() }`（`lookback.js`）：整屏盖一层 `.sc-look`，里面 `new Stage(el, { input: false })`，`await stage.replay(log.slice(0, span.end + 1))`（瞬间放），顶上「回看 · 第 n 幕 标题」和「回到现在 →」（44px），从左往右滑 80px 以上也关。同一幕放好的 Stage 留着，下次直接显示；整节课最多留 4 个，多了丢最早的。
  - 回看层的左栏顶上列 `span.keys`（这一幕的要点）。
  - `classroom.js` 顶上 `.sc-scenes`：`sceneSpans(stage.log, { title: 课名 })`（第一幕叫这节课的课名，设计 3.2）多于一幕时显示，一幕一个胶囊（`① 一般时`），现在这一幕 `is-now`；每次 `stage.onLine` 以后重画（变了才动 DOM）；长按 0.45 秒弹要点（`feel.js` 的 `showMenu` 那种小框，只读）。
  - 回看开着时 `stage.looking = { n, since }`；关上时 `stage.onAct({ type: 'look', n, title, ms })`。老师的回话照常演在底下的舞台；回看开着时「回到现在」上加一个点（`.has-new`）。

- [ ] **Step 1：试演** `look-basic.txt`：两幕，第一幕学生把小人拖到「过去之后」，第二幕开始后 `学生: look 1`。`NEW6` 加：回看层里小人在「过去之后」（照 `data-obj` 的位置比，和第一幕最后一刻的截图里的位置差 < 2px）；回看层里拖小人没反应（`input: false`）；`学生: unlook` 以后回到第二幕、画面和打开前一样。
- [ ] **Step 2**：`stage-try-lib.js` 的 `STUDENT_FORMS` 加 `look n`（点幕条第 n 个）、`unlook`（点「回到现在」）。FAIL。
- [ ] **Step 3**：实现 `lookback.js` 和幕条。
- [ ] **Step 4**：`node tools/stage-touch.mjs` 加一段：幕条的胶囊、「回到现在」手指点得到（≥ 44px，不被别的东西盖着）。PASS；表 ✓。
- [ ] **Step 5**：提交「舞台：顶上的幕条，点开原样回看那一幕」。

### Task 8: 回看时的课堂循环、刷新

**Files:** Modify `kit/src/stage/events.js`、`kit/src/stage/loop.js`；Test `tests/stage-events.test.js`（加几项）、`evals/stage-gaps/new6/look-idle.txt`

**Interfaces:**
- Consumes: Task 7 的 `look` 动作和 `stage.looking`；Task 4 的 `lookText`。
- Produces: `look` 动作是不叫老师的那一类（和拨数的「试」一样攒着，跟着下一条走）；[学生] 里多一行 `lookText(…)`；`loop.js` 数「很久没动」时 `stage.looking` 为真就不数，关上回看时从 0 重新数。

- [ ] **Step 1：写测试**：`events.js` 收到 `{ type: 'look', n: 2, title: '进行时', ms: 40000 }` → 不触发叫老师（`triggers` 为假）；下一条学生的消息里有 `学生翻回去看了第 2 幕「进行时」（40 秒）`；同一节里看了两次第 2 幕合成一句、秒数加起来。
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
- Produces: 报告多 `scenes: [{ n, title, keys }]`；`REPORT_VERSION` 加一（以前的舞台课首页打开时照 `fixReports` 补算）；「以前的课」点进一节舞台课多一段「这节课的几幕」：一幕一行标题，下面它的要点。

- [ ] **Step 1：写测试**：一节两幕的舞台课的 turns → `buildReport(…).scenes` 是两项、第二项的 `keys` 有那张重点卡的字；黑板课、一问一答的课没有 `scenes`。
- [ ] **Step 2**：FAIL → 实现 → PASS。
- [ ] **Step 3**：e2e 的 `stage` 段：下课以后「以前的课」里看得到两幕的标题。
- [ ] **Step 4**：提交「学习台：舞台课的报告和以前的课里列出这节课的几幕」。
- [ ] **Step 5：发布一次**（B 批），同 Task 3 Step 7。

## C · 收尾

### Task 10: 排版检查横屏多量三种

**Files:** Modify `tools/stage-measure.mjs`、`tools/stage-audit.mjs`

- [ ] **Step 1**：`measure` 横屏时多报：`解析栏压着画面`（`.st-side` 的框和任一 `data-obj` 相交 > 24px²）、`栏里的字太小`（`.st-side` 里可见文字的 `font-size` < 17px）、`这一问看不见`（最后一个 `.st-line[data-kind="ask"]` 不在 `.st-side` 的可见范围里）。
- [ ] **Step 2**：`node tools/stage-audit.mjs` 内置的一批横屏全过；故意把 `.st-line.is-past` 写成 14px 跑一次，报得出来，再改回去。
- [ ] **Step 3**：提交「排版检查：横屏的解析栏多量三种」。

### Task 11: 真课整节放回、全量检查、审查、文档

- [ ] **Step 1：真课放回**：用 Task 0 的 `.superpowers/replay6.mjs` 再跑一遍时态课，横屏每一轮截一张，**逐张看**（压不压、字大不大、栏里是不是这一幕的话）。整台缩放的中位数比基线大，没有一轮比基线小两成以上；页面兜底分出来的幕列出来，和课记录里人分的段比。数字和分错的写进 rulings。
- [ ] **Step 2**：`npm test`、`npm run check:stage`、`npm run check:pages`、`npm run e2e` 全量；七张表 `fix1` `new2` `new3` `new4` `new5` `first` `new6` 全 ✓。
- [ ] **Step 3：旧试演重放**：`node tools/stage-try-diff.mjs`（282 份），发给老师的东西除了现状里多出的幕那一行以外一字不差；有别的不同逐条查，写进 rulings。
- [ ] **Step 4：只读审查**（一个新的助手，只读）：页面有没有替老师做教学决定；兜底分幕会不会分错；回看时课堂循环有没有漏叫或多叫老师；竖屏是不是一行没变。查出的照修，一条一个测试（`tests/stage-mainline6-review.test.js`）。
- [ ] **Step 5：文档**：`docs/stage-mainline.md` 加第六轮一节；`docs/stage-plan.md` 进度；`CLAUDE.md` 舞台那一条补「横屏左边解析栏」「scene 一幕、幕条回看」和 `new6` 的验收命令；rulings 收尾。
- [ ] **Step 6：发布**：版本号、`npm run build`、`node proto/stage/build.mjs`，合进 `main`，重新发布学习台；截横屏两种尺寸给我看。
