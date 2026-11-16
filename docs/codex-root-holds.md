# 给 Codex 的任务：留着的题（第十二轮第 1 批任务 6）

你是这次开发的第二个助手。主控是 Claude Code 那边的会话：它定设计、审你的代码、负责合并。你只做这一件事，做完推到自己的分支，不要合并、不要发布。

## 从哪开始、推到哪

- 仓库：这个仓库。从分支 `claude/friendly-ride-l2f31n` 的最新提交开一个新分支 `codex/root-holds`。
- 做完推 `codex/root-holds`。不要推 `claude/friendly-ride-l2f31n`、不要推 `main`、不要开 PR。
- 不要提交 `kit/dist/`（主控统一 build）。不要加 npm 依赖。

## 背景（读这些就够，不用通读仓库）

「学习台」：Claude 在网页里给一个考研学生一对一上课。这一轮让每节课从「考试要学生做到什么」出发：

- 每节课有 2～5 件「要拿下的事」（`aims`），代码在 `kit/src/class/aims.js`（已经做完，读它的文件头和导出）。这节课的文档 `sessions/{编号}` 上有 `aims` 数组（每件 `{ id, can, proof?, exam? }`）；课后报告（`kit/src/memory/report.js` 的 `buildReport`）里有 `aims`（每件带 `status`、`n`）和 `items`（每道题带 `aim`）。
- 设计：`docs/superpowers/specs/2026-11-15-root-design.md` 的 6.7 节（留着的题、「验上次学的」、`sessions.later`）。只读这一节和第 2 节「根」。
- 你要做的是 6.7 的前一半：**一节课下课以后，给它留几道隔天再做的题**。有没做过的真题就用真题，不够的由首页在后台请模型出，出的题过了检查才进题库。后一半（首页那一行、做完把结果记回那节课）是下一个任务，不归你。

## 任务原文

下面是计划里这个任务的全文（`docs/superpowers/plans/2026-11-15-root-1.md` 的 Task 6），照它的步骤做，先写失败的测试。行号是写计划时的，以现在的代码为准。

### Task 6: 留着的题（挑、出、存）

**Files:**
- Create: `kit/src/memory/holds.js`、`tests/memory-holds.test.js`
- Modify: `kit/src/memory/labdesk.js`（把 `takeProblems` 拆成「核」和「写」，`renderCheck` 能被首页用）、`kit/src/memory/lab.js`（出题的材料多一种）、`kit/src/memory/desk.js`（首页后台的那一圈里加 `fixHolds`）、`kit/src/memory/mastery.js`（`markFresh` 认 `d-hold-`）、`kit/src/books/devmock.js`（`?dev` 的模拟 Claude 会回留着的题）

**Interfaces:**
- Consumes：这节课的文档上的 `aims`、报告里的 `aims` 和题；`lab.js` 的 `parseProblems` / `problemLint` / `twinOf`。
- Produces（`kit/src/memory/holds.js`，纯函数，不碰 DOM、不读系统时间）：
  - `HOLD_MAX = 4`（一节课最多留几道）、`HOLD_DAY = 1`（满几天出现）、`HOLD_LATE = 3`。
  - `needsHolds(session): boolean`：黑板课（`kind` 是 `class` 或没写）、下了课、有 `aims`、不是复现课、还没有 `holds` 字段、`holdTries`（试过几次）< 2。
  - `pickHolds({ session, drills, evidence, reserve }): string[]`：题库里现成能用的：`src === 'exam'`、`block === session.block`、`status === 'active'`、题号不是留作模考的（照 `drills.js` 里 `usable` 的做法）、这道题在任何一节课都没作答过（证据里没有 `comp === 题库编号` 的）、这节课要拿下的事里写的那道真题（`aim.exam`）不要。最多 `HOLD_MAX` 道，每件要拿下的事尽量有一道。
  - `holdBrief({ session, aims, items, subject, n }): string`：给模型出题的说明。每件事出一道，写明哪一件（`针对：a1`）；一半同类换数、一半要迁移（题的第二行写 `类型：同类` 或 `类型：迁移`）；只出页面判得了的组件（`quiz`、`answer`、演示组件的 `mode: quiz`）；不许是课上出过的题（把课上的题面列给它）；回答的格式和 `lab.js` 的 `problemsBrief` 一样（`=== 题 1` 起头），这样 `parseProblems` 读得懂。
  - `holdDocs(parsed, { session, at }): Array<{ id, doc }>`：把 `parseProblems` 读出来的题改成留着的题：编号 `d-hold-{课号}-{n}`，`doc` 多 `src: 'hold'`、`hold: 课号`、`aim`、`far: true|false`。
  - `holdState(session, today): 'none' | 'wait' | 'due' | 'late' | 'done'`：没有留着的题 / 没满一天 / 该做了 / 满三天还没做 / 做过了（有 `later`）。
  - `laterOf(rows, { session, drills, today }): { n, right, days, far: { n, right } }`：`rows` 是 `drills.js` 的 `drillOutcome` 的 `rows`；`right` 是一次就对的道数。
- Produces（数据库这一层）：
  - `labdesk.js` 导出 `checkProblems(text, ctx): Promise<{ ok: Array<{ id, doc }>, bad: string[] }>`（读、`problemLint`、`twinOf`、藏着画一遍，不写库），`takeProblems` 改成先 `checkProblems` 再写，行为不变。
  - `desk.js` 的 `fixHolds()`：首页后台那一圈里，对 `needsHolds` 的课一次做一节：先 `pickHolds`；不够每件事一道、而且能调用模型时，`holdBrief` → `ai.call(…, { model: 'claude-opus-5-5', effort: 'high', lane: 'bg', cache: false })` → `checkProblems` → `holdDocs` → 写进 `drills`。然后先读这节课最新的文档再写 `holds: { ids, at, exam: n, made: n }`；一道都没凑出来就写 `holdTries` 加一，不写 `holds`。
  - `markFresh`：`d-hold-` 的题第一次做的那节算新题（和 `d-lab-` 一样）。

- Step 1: 写失败的测试 `tests/memory-holds.test.js`，用现造的数据，一个行为一个测试：
  - `needsHolds`：下了课有 aims 的黑板课是 `true`；舞台课、复现课、没有 aims、已经有 `holds`、`holdTries: 2` 都是 `false`。
  - `pickHolds`：同一块、没做过、不是留作模考的真题练习被挑中；做过的、别的块的、留作模考的、`aim.exam` 写着的那道不挑；最多 4 道。
  - `holdBrief`：里面有每件事的 `can`、有「针对：a1」这样的格式说明、有「同类」「迁移」、列着课上的题面、没有「他」「她」。
  - `holdDocs`：编号是 `d-hold-c-20261116-1-1` 这样，`src: 'hold'`、`hold` 是课号、`far` 照「类型：迁移」。
  - `holdState`：五种各一个；日期用 `today` 参数，不读系统时间。
  - `laterOf`：四道里三道一次对、其中两道迁移题对一道 → `{ n: 4, right: 3, days: 2, far: { n: 2, right: 1 } }`。
  - `markFresh` 认 `d-hold-`（加在 `tests/memory-mastery.test.js`）。
- Step 2: 确认是红的。
- Step 3: 写 `holds.js`、改 `mastery.js`，测试转绿。
- Step 4: 拆 `labdesk.js` 的 `takeProblems`；`tests/memory-lab.test.js` 照样过。
- Step 5: `desk.js` 的 `fixHolds`，接在首页后台现成的那一圈里（看 `fixSkills`、`fixDebriefs` 是怎么排的：一次一件、让路给讲课的调用）。`devmock.js` 认出 `holdBrief` 的提示词时回两道合规的题。
- Step 6: `npm test` 全过，提交。

## 必须守的规矩（仓库的硬性规定，违反的主控会退回）

1. 注释、提交说明、界面文字都用简体中文；注释写「为什么」，密度和旁边的代码一样。
2. 发给模型的文字（`holdBrief`）里提到学生不用「他」「她」，写「学生」。
3. 调用模型只在 `fixHolds` 那一处，必须 `model: 'claude-opus-5-5'`、`lane: 'bg'`（后台调用要给讲课让路）；不加别的模型当退路。
4. 不用 `window.confirm` / `alert` / `prompt`。
5. 写数据库之前按 `kit/src/memory/schema.js` 的规矩（`drills` 这一类的必填字段、编号的写法——**`d-hold-…` 这个编号过不过 `drills` 的编号正则，你要核；不过就照 `d-lab-` 当初的做法加**）。
6. **不要改这些文件**：`kit/src/class/` 下的任何文件、`kit/src/memory/digest.js`、`kit/src/memory/memo.js`、`kit/src/memory/report.js`、`tools/desk-e2e.mjs`、`CLAUDE.md`、`CLAUDE-PROJECT.md`。主控那边正在改它们。你觉得非改不可，就不改、写进报告。
7. `desk.js`、`lab.js`、`labdesk.js` 主控那边也有小改动：你只加自己的函数和接线，不重排、不改格式、不顺手整理别的代码，这样好合并。
8. 页面对学生说的话要是真的：留着的题一道都没凑出来，就不能记成有（照上面写 `holdTries`）。
9. `npm test` 里 `tests/forecast-forecast.test.js` 有一条「够快」的计时测试，机器忙时偶尔红，单独重跑能过就不算你的问题。别的必须全过。
10. 提交用 `git add <具体文件>`，不要 `git add -A`。

## 交付

推完分支以后，在分支里加一个文件 `docs/codex-root-holds-report.md`（一起提交），写：

- 做了什么：导出的每个名字和签名。
- 和上面的任务原文不一样的地方，各自为什么。
- 你核过的事：`d-hold-` 编号过不过 schema、`pickHolds` 里「留作模考」是照哪个函数判的、`fixHolds` 接在后台那一圈的哪个位置。
- 测试的结果（先红后绿各贴几行）。
- 你拿不准、没做、或者觉得计划写错了的地方。**拿不准的不要猜着做，写下来。**
