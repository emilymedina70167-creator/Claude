# 废弃的东西（第十四轮，2026-11-17 起）

学生定的（2026-11-17）：「按照有没有必要留，是被代替的功能，被迭代的功能，就舍弃，哪些可以供教学的内容就留着，像舞台，一问一答都是被迭代的。」以前做的只要和「学习台里的项目 Claude」冲突，一律让路。

这里的代码**不进构建、不跑测试、不被任何代码引用**。原来在哪，就放在 `archive/` 下面同样的路径。怎么清理由学生以后决定。数据（学习台数据库里的 sessions、class_turns、evidence、旧记忆……）一条没删，项目 Claude 读得到；以前上过的这几种课在「以前的课」里只出文字（`kit/src/memory/oldview.js`）。

要恢复：从下表「搬走前的提交」检出原文件。

| 搬了什么 | 原来是什么 | 为什么 | 哪天 | 搬走前的提交 |
|---|---|---|---|---|
| `kit/src/stage/`、`proto/stage/`、`tools/stage-*`、`tools/stage-try-examples/`、`evals/stage-gaps/`、`evals/stage-canvas/`、对应的测试 | 舞台课（用画面讲课） | 被黑板课迭代掉 | 2026-11-17 | `3f18ea7` |
| `kit/src/blocks/stagedrill.js`、`kit/src/stagedrillspec.js`、`kit/src/memory/stagedrills.js`、`kit/examples/stagedrill-demo.html` | 舞台题（练一练里嵌一块舞台） | 随舞台课 | 2026-11-17 | `3f18ea7` |
| `kit/src/huoban/`、`kit/src/blocks/huoban.js`、`proto/live-lang/`、课堂里的 `TALK` 分支和 `buildTalkSystem` | 一问一答（活板） | 被黑板课迭代掉 | 2026-11-17 | `3f18ea7` |
| `kit/src/live/live.js` `livebar.js` `ops.js` `layout.js` `devpanel.js`、`kit/examples/live-demo.html`、`live-tools.board.json` | 实时黑板（对话里的 Claude 一段段写） | 被学习台里的课堂替代 | 2026-11-17 | `3f18ea7` |
| `kit/src/guided.js`、`kit/examples/unit-matrix-vector.html` | 自学单元（引导模式） | 被课堂和项目 Claude 自己建的页面替代 | 2026-11-17 | `3f18ea7` |
| `kit/src/memory/said.js` `saiddesk.js`、`tools/memory-ruler.mjs` | 话的账（每一句都过一遍、记成要求） | 被项目 Claude 自己记笔记替代 | 2026-11-17 | `6b5983c` |
| `kit/src/memory/summarydesk.js` `summaryview.js`、`tools/summary-ruler*.mjs` | 记忆摘要的课后重写和管理页 | 被笔记本和课后那一轮替代（`summary` 数据留着，项目 Claude 读得到） | 2026-11-17 | `6b5983c` |
| `kit/src/memory/debrief.js`（整份） | 下课后的复盘（固定岗位） | 被课后那一轮替代；`kit/src/memory/debrief.js` 只留读旧复盘的两个函数 | 2026-11-17 | `6b5983c` |
| `kit/src/aide/`（`schema.js` 以外） | 课堂助手：学生卡、课前档案、课后助手、旁听、讲法打分 | 被项目 Claude 替代 | 2026-11-17 | `6b5983c` |
| `kit/src/memory/lab.js` `labdesk.js` `sentry.js`、`tools/lab.mjs`、`tools/aide-audit.mjs` | 云端教研室的单子、后方的工作单 | 每晚的教研室换成项目 Claude（提示词 `docs/lab-prompt.md`）；验题的几个函数搬到 `memory/problemcheck.js`、`problemrender.js` | 2026-11-17 | `6b5983c` |
| `kit/src/memory/holds.js`（整份） | 下课后页面自动挑真题、请 Opus 出留题 | 留不留、留什么由项目 Claude 定；`holds.js` 只留到期和算结果 | 2026-11-17 | `6b5983c` |
| `kit/src/books/rehearse.js` | 课前预演 | 被替代 | 2026-11-17 | `6b5983c` |
| `kit/src/books/plan.js` 的备课部分（`prepPrompt` `prepMemory` `parsePrep` `checkPrep` `openTodos` `suggestBlock` `parsePages`）、`kit/src/books/planview.js` 的备课画面、`tests/books-plan-summary.test.js` 和别的测试里的备课用例（`archive/tests/books-prep.test.js`） | 首页「让 Claude 备课」 | 备课学生跟项目 Claude 说；`archive/kit/src/books/` 里是搬走前的整份 | 2026-11-17 | `914a6f6` |
| `kit/src/project/after.js` `afterdesk.js`、`tests/project-after*.test.js` | 第十四轮的「课后那一轮」「第一次整理」（下课后页面里的 Claude 写笔记本） | 第十五轮外部主 Claude 是唯一写笔记本、下判断的（外部主 Claude 的修改意见第 2 节，学生授权） | 2026-11-18 | `4f232bb` |
| `tools/desk-e2e-old.mjs` | 搬走以前的整条流程测试（含舞台、一问一答、实时黑板、助手几段） | 留着对照 | 2026-11-17 | `3f18ea7` |

留在原处的：`kit/src/live/store.js`、`sync.js`（整个学习台的数据库和证据）；`kit/examples/en-demo.html`、`ds-8.2.3-shell-sort.html`（组件示范页，去掉了 `mode: guided`）。
