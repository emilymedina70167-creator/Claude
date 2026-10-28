# 一个学习台：所有东西在一处（2026-10-29）

## 我要的

一个系统、整体的学习环境：学习台和教学环境连在一起，内部 Claude（课堂里的）和外部 Claude（对话里的）都在同一份记录上整理学习，不杂乱，不能有些东西在这边、有些在那边。只有一个 artifact 装不下的时候才分开；分开了也要连得上。

## 之前散在哪

- **组件库**是单独一个 artifact：说明书、组件写法、`la-kit.js` 放在那里，学习台从它复制程序。
- **实时黑板**（平时上课用的方式）每个单元发布一个新的 artifact：作答存在那块黑板自己的数据库里，学习台的证据里没有，课堂里的 Claude 也看不到。
- **单独的课堂 artifact**、**一次写完的课件**（guided）也都是各发布各的。
- 学习台里只有「在学习台里开的课堂」。

## 现在

学习台是唯一的 artifact（`kit/src/version.js` 的 `DESK_URL`）：

| 东西 | 在哪 |
|---|---|
| 说明书、组件写法、`la-kit.js` | 学习台的附带文件（`CLAUDE-PROJECT.md`、`components/*.md`、`la-kit.js`），随组件库更新一起发布 |
| 记忆（规则、弱点、错题、掌握、复现、位置……） | 学习台数据库的根上（第七节） |
| 每一节课 | `sessions/{编号}`，`kind`：`class` 课堂（页面开）、`live` 实时黑板（外部 Claude 开）、`unit` 自学单元（外部 Claude 开） |
| 这节课的东西 | `sessions/{编号}/…`（`memory/session.js` 的 `SESSION_SCOPED`：课堂的 `steps` `class_turns` `class_pages` `pack`；黑板的 `steps` `talk` `ops` `ops_done` `meta` `lint` `uploads`；单元的 `unit`；都有 `report`） |
| 每一次作答、动作、说的话、交的截图 | 根上的 `evidence`（带 `session`、`block`、段的 `point`），三种课一样 |

- 学习台首页「上课」卡列出所有没下课的（课堂、实时黑板、自学单元），点「进去」；`#编号` 进去，`enterClass` 按 `kind` 分给 `renderClass` / `renderLive(…, desk)` / `enterUnit`（`renderGuided`）。
- 实时黑板在学习台里：数据经 `scopeDb` 换到 `sessions/{编号}/` 下面，`createSink(store, { evidence })` 让作答只写进 `evidence`；交的截图也记一条 `say` 证据。底部「⋯」多「回学习台」「这块黑板用完了」。
- 用完了（外部 Claude 写 `status: closed`，或我点）：首页的 `fixReports` 补写课后报告，「以前的课」里能翻看（只读）。
- 启动语（`views.js` 的 `handoffText`）：说明书就在学习台里；还开着的黑板告诉外部 Claude 往哪接着写。
- 以前的组件库地址：页面换成「已并入学习台」（`kit/moved/index.html`），说明书换成一句「去学习台读」（`kit/moved/CLAUDE-PROJECT.md`），项目指令还没改时也不会走丢。

## 上限（为什么现在不用分开）

- 数据库：每个文档 ≤ 256 KiB；文档数和总大小有上限（平台没公开数字，满了报 `quota_exceeded`）。一节课几百条证据、黑板段，远不到。
- assets：一个 artifact 共 100 MB（首页「备份和用量」看得到）。截图压成 PNG 每张一两百 KB，够几百节课。
- 每个页面最多订阅 64 个查询：首页订阅十几个集合，课堂、黑板里各十来个。
- 真满了的办法：首页「导出备份」，然后清理旧课的截图和黑板（记忆、证据、报告留着）。到那时再考虑按学期分库，用启动语和 `sessions` 里记的地址把它们连起来。

## 还要我做的

1. 项目指令里那段话换成 README「设置」里的新版（说明书地址换成学习台）。
2. 看一遍旧 artifact 的清单，同意了再删（删了找不回来）。
