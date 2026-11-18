# 每一步都有记录、每一条都被分析：执行计划（第十五轮第 4 批）

2026-11-18 写。需求在学习台 `dev_requests`：总单 `dr-learning-trail`（T1–T6）和 `dr-memcheck`（1–4），外部主讲整理记忆时查出来的。总单说「以学生交给你的 ext-fixes-round3.md 为准」：那份文件不在仓库、分支、学习台里，照两条 `dev_requests` 的原文做；那份到了再对一遍。`dr-ext-round2` 上一批已经做完。

学生原话：「要做到我学一步，每走一步，都有清晰的记录，而且每一步记录都被你分析，进入到下一次分析，就是不会出现丢内容」「你现在去思考，现在是不是已经做到记忆系统化，不管是在后续跌打更新都没问题」。

目标：每一步都进记录；每一条记录都被外部分析过；「学过没有」和「会不会」不会判错。页面只记、只算、只报，不替外部下结论（矛盾一律报，不自动改）。

## 顺序和做法

| 序 | 项 | 做法 | 落在哪 |
|---|---|---|---|
| 1 | **T1 对话里的每一句都进记录** | `ext_in.said` 收数组 `[{ text, at, images }]`（还认以前的一个字符串）；每一条记成证据 `src: say, via: chat`（`at` 照写的，图是外部 `upload_asset` 传的 asset 编号），进课后报告 | `class/ext.js`（`saidItems`）、`classroom.js`、`memory/session.js` 的 `sayEvidence` |
| 2 | **T2 外部的判断记成没有** | `ext_in.result.memo = [{ line, ok, id, error }]`：这一轮 memo 块每一行写进去了没有、写成了哪一条、没写成为什么（守卫拒、写法不对） | `classroom.js` 的 `runMemo` 回结果、`ext.js` 的 `inResult` |
| 3 | **T3 分析游标** | 外部写 `meta/cursor-{math\|cs\|en}` = `{ at, by: "ext", note }`；页面写 `meta/since-analysis-{科}`：游标以后这一科的全部证据（课堂、外部的课、复现课、练一练、页面里的老师、助手、补记、要记的），按先后一条一行，一次 get 读完；开场简报最前面一行「上次分析（几号）以后还有 N 条证据没分析」。和 `sessions/{编号}/meta/since`（一节外部的课里，上一条 `ext_in` 以后）是一套：前者按课、后者按科 | `kit/src/project/trail.js`（纯函数）、`desk.js` |
| 4 | **T4 讲过和会了分开** | 新集合 `coverage/{块或知识点}`：板上的段带 `block=` / `point=`（段不写就是这节课的块），画上了就记「讲过」（哪几节课、第一次、最近一次、几段）；掌握状态页面只认核得上的：`mastery` 的最近一条 log 要有 `basis`、编号在证据里找得到、基础题过 / 复现通过要有做对的证据，核不上的在 `meta/state-{科}` 里写「依据核不上（不算）」，页面算的事实（`meta/facts`、410 分）也不算它；`meta/state-{科}` 每块一行：讲过没有、掌握状态（核没核上）、最近 3 条证据、最近一次失手、下次复现日 | `protocol.js`（段的 `block=`）、`classroom.js`、`kit/src/memory/state.js`（纯函数）、`desk.js` |
| 5 | **T5 矛盾一律报** | `meta/state-{科}.conflicts` 和开场简报：掌握写着过了但之后同块错了；写着未学 / 讲过但已有隔天新题一次对；弱点 L1+ 之后又有挂它的错题；复现组判过但依据不合通过标准（只有原题、或不是一次做对）；没讲过却有掌握状态。只报，不改 | `state.js` |
| 6 | **T6 页面里的 Claude 说的话也进记录** | 外部叫来的助手（`board claude`）、板边助教、练习教练和复现课里页面里的老师：说的每句话、执行的每条判断记成证据 `src: helper`（`role: helper / coach / teacher`），进 `since-analysis` | `classroom.js` |
| 7 | **memcheck 1 删课以后自检不再报** | 删课时把删掉的编号记进 `meta/deleted`（`{ keys: { "observations/ob-…": { at, session } } }`）；自检认它，不再报「被删掉了」，以前报着的也收起来；这一次的 15 条补记进去 | `memory/check.js`、`desk.js` 的 `runPurge` |
| 8 | **memcheck 2 log 的 by** | 课堂助手（第九轮，已收进 archive）写的 log 是 `by: "aide"`，不在 `ROLES` 里：写入方照「事后写的」记 `by: "lab"`（`memo.js` 的 `logMeta`，`ext` 也收进去）；`W43` 第 4、5 条、`K23–K26` 第 1–3 条照实际来源改成 `lab`，每条记 journal | `memory/memo.js`、学习台数据 |
| 9 | **memcheck 3 快照的提醒** | `meta/brief*` 最前面一行：笔记本「现状/总览.md」是几天前写的，超过 7 天写「该重写了」，没有就写没有 | `views.js` 的 `deskBrief`、`desk.js` |
| 10 | **memcheck 4 ok** | 自检的 `ok` 只在硬错误时为 false：「只增不改」的提醒（改了、删了，留 7 天）算软的 | `memory/check.js` |

## 收尾

单元测试（纯函数）、e2e（`extctl` 加 said 数组、result.memo、助手的证据；新加 `trail` 一段：游标、since-analysis、coverage、state、矛盾、删课以后自检）、手册第五节和第七节写上新的集合和写法，版本 2026-11-18d，合进 `main`、重新发布学习台，数据修正（memcheck 2 的 7 条、memcheck 1 的 15 条 tombstone）、两条 `dev_requests` 写 `status: done`。
