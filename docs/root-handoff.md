# 第十五轮的交接（给接着做的新对话）

2026-11-18 写。读完这一份和 `CLAUDE.md` 里「外部主 Claude 的学习台（第十五轮）」那一条就能接上。第十四轮的交接在 git 历史里。

## 一句话

**claude.ai 项目对话里的 Claude 是主讲**，在学习台的黑板上讲课；学习台负责画板、当场判分、记录、算事实；页面里的 Claude 只当练习教练、板边助教。学生的原话：「重要是学习本身质量问题，Claude 能知道多少东西，anthropic 做的记忆能力就是会让人放心」「在 ai 教学的长处，为什么不去抓住？」。

## 学生定的做法（不要再问、不要改）

1. **开发不约束外部怎么教**（学生原话：「不能有他约束你怎么去教，怎么教是你的事情……不需要他有什么使用说明」）。给外部的只有：能做什么、写法是什么、页面会怎么做（含平台限制）。往手册、`ext_out`、`meta/*` 里加一句话先问：写法 / 事实，还是做法？做法不加。
2. 外部主 Claude 审过的修改意见 `docs/superpowers/specs/2026-11-17-external-teacher-review.md` 和设计冲突时以它为准；外部要改学习台，它会写修改意见推到分支、或者写进学习台的 `dev_requests`。
3. 外部用什么模型学生自己在 claude.ai 里选：页面不核、不作废、不标。页面调用的 Claude 照旧只用 Opus 5.5 high。
4. 一步到位：做完开发就停，学生开始上课。合进 `main`、重新发布学习台不用问。
5. 以前做的和这个方向冲突，一律让路（搬进 `archive/`，数据不删）。

## 第 2 批：外部主讲的完整操控权（2026-11-18）

外部第一次上课时按学生要求写了 `dev_requests/dr-ext-control`（R1–R11）。全做了，见 `CLAUDE.md` 那一条、执行计划 `docs/superpowers/plans/2026-11-18-ext-control.md`、自己定的事 `docs/superpowers/specs/2026-11-18-ext-control-rulings.md`。外部再要什么，还是先看 `dev_requests`。

## 第 3 批：外部验收以后的第二批修改（2026-11-18）

`dev_requests/dr-ext-round2`（合并 `dr-ncalg-strict`、`dr-ext-live-fixes`），见 `CLAUDE.md` 那一条和 `docs/superpowers/plans/2026-11-18-ext-round2.md`。总表说以学生交来的 `ext-fixes-round2.md` 为准：那份文件没在仓库、分支、学习台里找到，照 `dev_requests` 三条的原文做的；那份到了再对一遍。

## 第 4、5 批：每一步都有记录、旧记录（2026-11-18）

`dev_requests/dr-learning-trail`、`dr-memcheck`（第 4 批）和外部验收第 4 批以后的 `dr-trail-fix`（第 5 批：旧记录当成没学、游标按写入时间、舞台刷新放回），见 `CLAUDE.md` 那两条和 `docs/superpowers/plans/2026-11-18-learning-trail.md`、`2026-11-18-trail-fix.md`。改 `memory/state.js` 以后照真数据跑一遍三科的 `deskState`（`ArtifactData list` 存 mastery、errors、evidence、sessions、observations、reviews、weaknesses、curriculum、coverage 到 `.superpowers/` 下），看矛盾是不是真的。

## 第 6 批：计划 1（2026-11-18）

`dev_requests/dr-batch4`（外部定稿，学生说「这部分是计划1，计划2我要专门设计组件库提升」）和 `dr-legacy-label`，见 `CLAUDE.md` 那一条和 `docs/superpowers/plans/2026-11-18-batch4.md`。**计划 2（`dr-plan2`）是草稿，学生和外部设计好、改成 open 以前不动组件库的外观和交互。**

## 第 7 批：计划 2，二类组件（学完以后的吸收检验，2026-11-18）

`dev_requests/dr-plan2`：外部写的任务书，外部审过 plan（`review` 字段的两条必改：复测里的 retry 存题库编号、最后没过的进错题本）。设计 `docs/superpowers/specs/2026-11-18-check-design.md`（第六节是自己定的事和外部同意的六条），计划 `docs/superpowers/plans/2026-11-18-check.md`。代码在 `kit/src/check/`，见 `CLAUDE.md` 那一条。开工时计划 1（`dr-batch4`）已经合进 `main`：solve、`board judge`、`STEP_TAGS`、`timing.js` 直接用真的，没做替身。

- 第一次真检验以后：读 `sessions/{编号}/check/{检验 id}`（进度）、`evidence` 里 `src: check` 的、`absorb/*`、`probes/*`，看判分等了多久（`judgedBy: timeout` 多不多）、待核的多不多、补讲是外部写的还是页面里的 Claude 写的；照真数据跑一遍 `deskState`。
- 2026-11-19 补齐：审查留下的小毛病、retry 模板（`check/template.js`），见 `CLAUDE.md` 第 8 批那一条。
- 没做的：408、英语的探题类型——设计稿在 `docs/superpowers/specs/2026-11-19-probes-408-en-design.md` 和学习台 `dev_requests/dr-probes-408-en`（`status: design`），等外部在 `review` 字段写意见、改成 `open` 再做。同一个模板在两节课里配了不同的课上的量，题库只记第一次的 `lets`（编号照原文算，见 `bank.js` 的 `lessonLets`）；复测时它们挂在题上（`probe.base`，`attachBases`）。

## 第 9 批：计划 3，高数、概率的式子底座（2026-11-19）

`dev_requests/dr-calc-base`：外部写的任务书，外部审过（`review`：有条件通过，必改 1–6、必加 7–12，改完直接开工），我的回复在 `reviewReply`（三处歧义我的理解）。执行计划 `docs/superpowers/plans/2026-11-19-calc-base.md`，第六节那张表是照审改的、以它为准。分两次合进 `main`：

- 第一次（做完、已发布）：弧度默认、学生的读法、实数取点、符号求导、数值极限 / 积分、`calc:` 字段、小键盘、预检、手册、示例页。见 `CLAUDE.md` 第 9 批那一条。
- 第二次（没做）：Task 7（derive 推极限、换元积分，必改 5、6）、7b（变限积分的学生写法 `∫_0^x … dt`，必加 7）、Task 8（检验题的式子，`check/judge.js` 两处——计划 4 改得多就改成在 `dr-plan4` 上留 `compareFx` 的接口）、Task 9（`integral2`、`sum`）、9b（微分方程通解 `ode`）、数列极限的手册。
- 判错要比判对更有把握（计划第五节第 1 条）：改 `fx/limit.js`、`fx/sample.js` 的阈值以前先跑 `tests/fx-limit.test.js` 的经典极限。
- 弧度：新加调用 `compile` / `evaluate` / `calcValue` 的文件要在 `tests/expr-rad.test.js` 里归类。

## 现在做到哪

全部做完、已发布（版本见 `CLAUDE-PROJECT.md` 开头）。下一步是学生用外部上一节真课。

- 外部的线：真课里一个来回（`ext_out` 写好 → 对应的 `ext_in` 到）的中位数超过 60 秒，就停下来重新评估这条路，不靠加功能补。课后报告的 `ext.median` 就是这个数。
- 每晚的定时任务（「学习台教研室」）的提示词要换成 `docs/lab-prompt.md`（夜班）：学生看过才 `update_trigger`。

## 读一节外部的课

1. `ArtifactData get meta/errors`、`meta/health`、`list dev_requests`：有新的先处理。
2. 存下来（私人数据，放 `.superpowers/` 下，不进 git）：`sessions/{编号}`、`sessions/{编号}/ext_in`、`ext_out`、`class_turns`、`report/main`。
3. 看：来回时间（`report.ext`）；`ext_out` 最前面报过哪些写错；外部有没有用 `snap`、`coach`；学生在 `ext_out` 里的作答和外部下一轮接得上没有。
4. 外部的预检工具：`node tools/ext-check.mjs --next 一轮.txt --session <存数据的目录> --shots <目录>`，能重放外部写过的任何一轮。

## 踩过的坑

- 选择题判完了才记一条（先错后对的那一条带着错的选项）：只点错一次不会写 `ext_out`。
- `scopeDb` 只把 `SESSION_SCOPED` 里的集合换到 `sessions/{编号}/` 下面：新加课堂自己的集合要加进去（这一轮加了 `ext_in`、`ext_out`）。
- `desk.js` 是带 DOM 的大文件，单元测试抓不到它的语法错：改完一定 `npm run build` 再跑 e2e。
- `CLAUDE-PROJECT.md` 第三节的标题 `## 三、组件参考` 和第四节开头 `## 四、` 不能改（`kit/build-docs.js`、`kit/build-split.js` 认它们）；第四节那一行标记发布时换成黑板指令。
- `tests/forecast-forecast.test.js` 的「够快」是计时的测试，机器忙时偶尔超时，重跑就过。
