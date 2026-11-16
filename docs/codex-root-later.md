# 给 Codex 的任务：首页「验上次学的」，结果记回那节课（第十二轮第 1 批任务 7）

你上一件（留着的题，`codex/root-holds`）主控审过、合进 `claude/friendly-ride-l2f31n` 了。主控在上面补了一个提交（`holdBrief` 多一个 `originals` 参数：给模型看课上原题的全文；`fixHolds` 等课上的题抄进题库再留；题库文档的 `by` 是 `page`）。这是接着的一件。规矩和上次一样：你只做这一件事，做完推到自己的分支，不合并、不发布、不开 PR。

## 从哪开始、推到哪

- 从分支 `claude/friendly-ride-l2f31n` 的最新提交开新分支 `codex/root-later`，做完推它。
- 不提交 `kit/dist/`，不加 npm 依赖。

## 背景

设计 `docs/superpowers/specs/2026-11-15-root-design.md` 的 6.7、6.8 节。上一件做的是「下课后给这节课留几道隔天再做的题」（`sessions/{课号}.holds = { ids, at, exam, made }`）。这一件做后一半：

- 满一天，首页「今天」出现一行「验上次学的」；学生点开做完，页面把结果（几道、一次对几道、其中要迁移的几道对几道、隔了几天）记回**那节课**的文档 `sessions/{课号}.later`。
- 这个结果是这一轮最重要的一个数：「这节课教的东西，隔天没人带着、换一道没见过的题，学生还做不做得出来」。所以它必须是真的：没做完的、跳过的不能算；同一节课只记一次；写回去的时候不能盖掉那节课文档上别处刚写的字段。
- 「以前的课」那一页、班主任每一轮的说明、量真课的工具 `lesson-audit` 都要读得到这个结果和这节课要拿下的事。

## 任务原文

计划 `docs/superpowers/plans/2026-11-15-root-1.md` 的 Task 7。行号是写计划时的，以现在的代码为准。

**Files:**
- Modify: `kit/src/memory/desk.js`（首页「今天」的行 `ROWS`、`paintRows`、抽屉的模板、`OPENERS`、长按菜单）、`kit/src/memory/drillrun.js`（`closeDrill`）、`kit/src/memory/holds.js`（加 `writeLater`）、`kit/src/memory/drills.js`（见下面「一个洞」）、`kit/src/memory/views.js`（`classRows`）、`kit/src/memory/pages.js`（「以前的课」那一页）、`kit/src/memory/desk.css`、`kit/src/head/context.js`（班主任每轮的说明多一节）、`tools/lesson-audit-lib.mjs`（`later`、`aims` 两格填上）
- Modify tests: `tests/lesson-audit-lib.test.js`
- Test: `tests/memory-later.test.js`（新）

**Interfaces:**
- Consumes：`holds.js` 的 `holdState` / `laterOf` / `HOLD_*`，这节课文档上的 `holds: { ids }`；`kit/src/class/aims.js` 的 `STATUS_TEXT`、`aimsSummary`（报告里的 `aims` 每件带 `status`、`n`）。
- Produces：
  - 首页「今天」多一行，键 `later`，标题「验上次学的」：有一节课的 `holdState` 是 `due` 或 `late` 时出现，副标题写那节课的标题和几道（不写编号）。点开的面板里一个按钮「开始」，开一节 `{ kind: 'drill', items: holds.ids, hold: 课号, title: '验上次学的', … }`（照课前热身的写法，走 `openOne`：同一时间只开一节）。几节课都到了：一次只做最早的那一节。
  - `holds.js` 导出 `writeLater(db, drillDoc, rows, { drills, today })`：这节练习的文档上有 `hold` 时，算出 `laterOf(...)`，**先读那节课最新的文档**，再只把 `later` 这一个字段写上去（已经有 `later` 的不重写；`hold` 指着一节不存在的课时不抛错、什么都不写）。`closeDrill` 调它。
  - `later` 的样子：`{ n, right, days, far: { n, right }, at, drill: 这节练习的课号 }`。**`n` 是 0（一道都没交）时不写 `later`**：那一行第二天还在，学生可以再做。
  - `views.js` 的 `classRows` 每行多 `later`；「以前的课」那一页有 `later` 的课多一行：「隔 2 天做没见过的题：4 道对 3 道（要迁移的 2 道对 1 道）」（没有要迁移的题时不写括号）。有 `aims` 的课列出每件事和状态（状态的四个词用 `STATUS_TEXT`，不显示编号 a1、a2）。
  - 班主任的说明（`headSystem`）多一节「最近几节课要拿下的事和课后验的结果」：最近 5 节有 `aims` 的课，每节一两行。整份照旧 ≤ 150 KiB（现成的测试守着）。
  - `lesson-audit`：`Audit.aims` 填报告里的 `aims`（有的话，没有读课的文档上的原始几件），`Audit.later` 填课的文档上的 `later`；文字版各多一行。

**一个洞（主控审上一件时发现的，这一件里补上）：** 现在「练一练」（`drills.js` 的 `pickDrills`）、课前热身会从题库里挑题，留着还没做的题（某节课 `holds.ids` 里、而那节课还没有 `later` 的题：包括被挑中的真题和 `src: 'hold'` 的题）可能当晚就被练一练挑走做掉，隔天要验的时候就不是「没见过」了。要求：这些题在那节课有 `later` 之前，不许被「验上次学的」以外的任何入口挑中；有了 `later` 以后照普通题进题库。你先找全所有从 `drills` 里挑题的入口（`pickDrills`、课前热身、带着开课、教研室的探题 / 新题计数 `sentry.js` 等），每个入口怎么处理写进报告；`pickDrills` 那一处要有测试。纯函数里拿不到 `sessions` 的，用参数传进去，不要在纯函数里读数据库。

**Steps:**
1. 写失败的测试 `tests/memory-later.test.js`：
   - `classRows` 给有 `later` 的课带出 `later`，没有的是 `undefined` 或 `null`，别的字段不变。
   - `writeLater`，用内存里的假数据库测：写上了 `later`；那节课同时被别处多写了一个字段（先改假数据库里的文档再调用），两个都在；已经有 `later` 时不重写；`hold` 指着一节不存在的课时不抛错；`n` 是 0 时不写。
   - `pickDrills`：留着还没做的题不被挑；那节课有了 `later` 以后可以被挑。
   - `tests/lesson-audit-lib.test.js` 加：课的文档上有 `later`、`aims` 时 `Audit` 里带出来。
2. 确认是红的。
3. 实现，测试转绿。
4. 浏览器里走一遍（照你上次的 `tools/check-root-holds.mjs` 的办法，扩它或另写一个脚本）：有一节带 `holds` 的课 → 当天首页没有这一行 → 把日子拨到第二天 → 这一行出现 → 点开做完 → 这一行消失 → 「以前的课」里那节课写着「隔 1 天做没见过的题」→ `sessions/{课号}` 上有 `later`。中间让写数据库失败一次（`window.LAKitDev.failWrites(1, 'sessions')`）：重试以后结果还在。**`tools/desk-e2e.mjs` 这次还是不要改**（主控那边在改；整条流程的 e2e 段主控来加）。
5. `npm test` 全过，提交。

## 必须守的规矩

和上次那份 `docs/codex-root-holds.md` 的「必须守的规矩」完全一样（中文注释和提交说明；发给模型的文字里提到学生不用「他」「她」；不用 `window.confirm` / `alert` / `prompt`；按 `schema.js` 的规矩写数据库；`git add <具体文件>`），另外：

1. **不要改这些文件**：`kit/src/class/` 下的任何文件、`kit/src/memory/digest.js`、`kit/src/memory/memo.js`、`kit/src/memory/report.js`、`kit/src/memory/session.js`、`tools/desk-e2e.mjs`、`CLAUDE.md`、`CLAUDE-PROJECT.md`。
2. `desk.js` 主控那边也在改（开课、进课堂那几处）：你只加自己的行、面板和接线，不重排、不改格式。
3. 界面以 iPad 为准：能点的地方至少 44px 高，这一行的样子照「今天」里现成的几行（复现、要想起来的、练一练、补记）做，不另造样式；给学生看的地方不显示编号（课号、a1、题库编号），用标题。
4. 首页上的数要跟着日子和数据变：这一行走现成的 `paint` / 订阅（看 CLAUDE.md「首页自己跟着日子换」那一段），不要只在打开时算一次。
5. 页面对学生说的话要是真的：「4 道对 3 道」只数交了的题；练习做到一半退出的不写 `later`。
6. 班主任说明里那一节是给模型看的：只写页面算的事实（哪件事什么状态、隔几天几道对几道），不替老师下「学会了」的结论。

## 交付

推完分支，在分支里加 `docs/codex-root-later-report.md`：做了什么（导出的名字和签名、`later` 的样子）；挑题的入口你找到了哪几个、各自怎么处理的；和任务原文不一样的地方及原因；测试先红后绿；拿不准、没做的地方（不要猜着做，写下来）。
