# 外部主讲的完整操控权：执行计划（第十五轮第 2 批）

2026-11-18 写。需求原文在学习台 `dev_requests/dr-ext-control`（外部主讲第一次上课时按学生要求写的，三条补充 addenda 是学生后来定的），这里是照它拆的活和做法。需求里每一项都做；学生定的三条补充（底座从舞台恢复、不做模板库、选底座 + 判定要准）为准。

学生原话：「我需要你对学习台有完全操控能力，就算用不上，也不能没有，调用 Claude 来帮助你教学这些功能你应该得有。」

## 不变的线

- **给能力，不定用法**：手册（`CLAUDE-PROJECT.md` 第五节、`components/stage.md`、`components/widget.md`）只写能做什么、写法、页面会怎么做；`tests/manual-words.test.js` 守着。
- 页面调用的 Claude 只用 Opus 5.5 high，不是就作废、不写。
- 外部的课以外（页面里的老师、练习教练）的行为一字不变：R6 的 wrong / giveup / stuck、R7 一轮几块新板只在 `kind: ext` 的课里开（页面里的老师照旧「教学不预制」、一轮一块新板，见 `…-ext-control-rulings.md`）。
- 外部触发的每一次调用都留痕：进下一份 `ext_out`，写进记忆的记 `journal`（`by: ext-delegate`）。

## 交付顺序（需求定的）和每一项的做法

| 序 | 项 | 做法 | 落在哪 |
|---|---|---|---|
| 1 | **R11 截图入口能关** | `session.upload`（整节课的开关）+ 组件字段 `upload: on/off`；`photoPicker` 看两者；`kind: ext` 默认关；`board set upload=on/off` | `photo.js`、`session.js`、`answer.js` `thinkbox.js` `conjecture.js` `steps.js`、`protocol.js`（`set`）、`classroom.js` |
| 2 | **R3 执行完立刻回报** | 执行完一条 `ext_in` 当场在它上面写 `result`：`{ ops: [{ op, id, ok, error }], errors: [段/行/原因], notes, shot? }`；有 `board snap` 时这一条执行完马上拍、`result.shots`；`sessions/{编号}/meta/now` = `{ at, text, board（结构化） }` 每次变化覆盖写（节流 1 秒） | `ext.js`（`inResult`、`nowDoc` 纯函数）、`classroom.js` |
| 3 | **R4 在沙盒里预检** | `kit/dist/la-kit.js` 本来就提交了；`ext-check.mjs` 不用 build；`--lint`：不开浏览器，查围栏、指令、组件 id 重复、target 存不存在、`\calc` 算不算得出、`stage` / `widget` 段的写法；README 写从 clone 到截图的三条命令 | `tools/ext-lint.js`（纯函数）、`tools/ext-check.mjs`、`README.md` |
| 4 | **R5 底座 + 设计层** | ① 舞台引擎从 `archive/` 恢复进构建（`3f18ea7` 以前的样子，接上这几天改过的公共模块）；② 黑板段 `board stage id=…`：段里是舞台指令，页面嵌一块没有老师的舞台（`input`、`bare`），`goal` + `@名字` 预写当场演；外部的课里预写也收 `.wrong` / `.miss`（没做到、走偏）；叫老师的事件（`call=`、`watch`、挑战做到 / 没做到、手势被弹回）记成动作进 `ext_out`；③ 式子能操作：`tex` 多学生手势（拖项换顺序、合并同类项、展开括号），合不合法由**非交换多项式的判定**（`kit/src/ncalg.js`：AB+BA ≠ 2AB、AE = A、(kE)A = A(kE)，拿不准回「判不了」）；④ `board widget id=…`：一小段 JS，`la.*` 接口（`matrix` `expr` `drag` `animate` `goal` `record` `calc` `anchor` `say` `tex`），在这一段里跑、出错只坏这一段、报进 `ext_out`；⑤ 手册给第 1 层完整清单（`components/stage.md` 照 `stage/doc.js` 生成、`components/widget.md`）。不做模板库（补充二）；不再新做组件（补充三） | `kit/src/stage/`、`kit/src/blocks/stagebox.js`、`kit/src/blocks/widget.js`、`kit/src/widgetapi.js`、`kit/src/ncalg.js`、测试 |
| 5 | **R1 `board claude`** | 解析（`kit/src/class/delegate.js` 纯函数：`when` `see` `can` `to` `turns` `until` `id`、`claude-off`、拼给它的那一条、按 `can` 过滤它写的指令）；课堂里：`when=now` 执行时调一次，`on=submit/wrong/giveup/stuck/say/draft target=` 学生在那题上出这件事时调，`stuck=90s` 计时；Opus 5.5 high、工具和页面里的老师一样；`to=board` 照 `can` 执行（越权的不执行、报）、`to=ext` 只写进 `ext_out`、`to=db=集合/文档` 写一条（记 journal）；它回 `[交回] 原因` 时板上一句「主讲会接着讲」；每一次的全文、指令、用量进 `ext_out`（`[助手 cl1] …`）；板上「停掉助手」（输入条「⋯」和板顶小条），停了不再触发、`ext_out` 里说 | `delegate.js`、`classroom.js`、`bar.js` |
| 6 | **R2 后台活 `ext_jobs`** | 全局 `ext_jobs/{id}` 和 `sessions/{编号}/ext_jobs/{id}` = `{ prompt, see, out, tools }`；学习台开着（首页或课堂）时一件一件跑（`lane: 'bg'`、Opus 5.5 high、只读工具 read / list / search / textbook_read），结果写到 `out`（`{ text, by, at, job }`），状态 `queued → running → done / failed` 写回；`meta/facts.jobs` 写排了几件 | `kit/src/project/jobs.js`（纯函数）、`kit/src/project/jobdesk.js`、`desk.js`、`facts.js` |
| 7 | **R6 react 全开（外部的课）** | `react.js` 在 `ext: true` 时收 `wrong [match="…"]`、`giveup`、`stuck=90s`；`planLocal` 认它们；stuck 由课堂计时 | `react.js`、`classroom.js` |
| 8 | **R7 预备板 `board queue`** | 外部的课里一轮能开几块新板（最后一块是当前板）；`board queue id=b5 after=q-b4:right|done|button`：块里是那块板第一段的内容，先存好藏着，条件到了页面自己开那块板、翻过去（`button` 是板底「下一块 →」）；进 `ext_out` | `protocol.js`、`classroom.js` |
| 9 | **R9 改字不丢作答 `board edit`** | `board edit id=b3`，块里一处或几处 `<<<旧\n===\n新>>>`；只改那段的 Markdown；重画以后，原文没变的组件把旧的 DOM 节点挪回来（作答、草稿都在） | `kit/src/class/edit.js`（纯函数）、`classroom.js` |
| 10 | **R8 指以前的板** | `mark` / `figure` / `replace` / `hide` 的 target 在以前的板上也执行；学生不在那块板上时板顶出一条「主讲在第 3 块板上标了东西 →」，点了过去 | `boardtools.js`、`classroom.js` |
| 11 | **R10 叫主讲** | 输入条上一颗「叫主讲」：点了马上写一份 `ext_out`，最前面「学生在等你」 | `bar.js`、`classroom.js` |

另外顺手修：`meta/errors` 里班主任那一页的 `(papers||[]).map is not a function`（考试档案的 `papers` 不是数组时）。

## 每做完一项

1. 单元测试（纯函数），`npm test` 全过。
2. 手册第五节写上写法和最小例子；`ext-check --lint` 认新写法。
3. e2e 的 `ext` 一段加这一项的操作（`tools/desk-e2e.mjs`），`npm run build && npm run e2e -- --only ext,…` 过。
4. 在 `dev_requests/dr-ext-control` 的 `progress` 里写做到哪了。

全部做完：版本号改新、build、`npm test`、`npm run e2e`、`npm run check:pages`，合进 `main`，重新发布学习台，`dev_requests` 那一条写 `status: done`。

## 验收（需求里写的）

- R1：`when=on=wrong target=q1 can=say,mark turns=2`，学生在 q1 答错，3 秒内板上开始出现助手的话；`ext_out` 里有完整记录；越权写 `new` 不执行并报错；点「停掉助手」后不再触发。（e2e 用 `?dev` 的模拟 Claude）
- R5：不超过 40 行写出「把 $(A+B)(A+B)$ 拆开的四项拖进格子、按左右顺序排对才算做到」，作答进 `ext_out`；换成 $(A-B)^2$ 只改参数（不做模板库：改那几行）。
- R2：外部写一件改编题的活，学生打开学习台后完成，结果文档能被 `board add` 引用。
- R3：外部写一轮后学生什么都不做，`ext_in/{seq}.result` 里有执行结果和截图。
- R4：干净的沙盒里照 README 三条命令出截图和问题列表。
