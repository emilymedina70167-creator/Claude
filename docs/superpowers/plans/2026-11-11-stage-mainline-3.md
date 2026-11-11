# 舞台主线第三轮：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**目标**：表、时间轴两种新东西；底座留下的 8 条；排版留下的 4 条。设计 `docs/superpowers/specs/2026-11-11-stage-mainline-3-design.md`。

**全局约束**：同第二轮（分支 `claude/admiring-cannon-4j7szs`；页面不判对错，老师给了 `key=` 的照它比是事实；重放不等于旧课；新字段 `clone()` 要带；说明每门课 ≤ 24576；发给 Claude 的话不用「他」「她」；提交说明最后两行署名）。浏览器里看：主目录构建；跑旧课重放时用副本 `/home/user/Claude-wt`（`.superpowers/wt.sh`）。

**加一种东西照 `docs/stage-types.md`**：`types/名字.js`（数据、指令、describe、doc、example）、`名字.view.js`（sync、enter、choreo、grips、css）、`名字.rules.js`，在 `types/index.js`、`types/views.js` 登记；`doc.js` 的 `SUBJECT_TYPES`；`tools/stage-cost-lib.js` 的指令归类；`gestures.js` 的 `ARMED_GRIPS`（把手的名字）。

### Task 0：说明腾地方
- [x] 测试：拼出来的说明里没有三个以上连着的空格；每门课字节数比现在少；例子照抄还能演。
- [x] `doc.js` 拼的时候压；`evals/stage-gaps/stage-doc.txt` 重新生成；提交。

### Task 1：表（数据和规则）
- [x] 测试（先红）：造（数、∞、词、短语、空格；只写 rows/cols；行名列名；大小上限；行列数对不上报错）；部件 `T.2,3` `T.r2` `T.c3`；`write`、`tick`/`cross`/`untick`、`addrow`；现状。
- [x] 测试：`key=`（形状对不上报错；数按数比、字不管空格大小写全角）；手势 `edit`（键盘 / `input=text` / `choices=`；给定的格写不了）；学生的一下过裁判（事实、`right`、默认不标）；量 `blank` `wrong`；判断式 `full` `right`；写满算做完。
- [x] 实现 `types/table.js`、`table.rules.js`；登记；指令归类。

### Task 2：表（画面、手指、试演）
- [x] `table.view.js`：格子、行名列名、给定 / 空 / 学生写的三种样子、勾和叉；把手 `cell`；文字输入的浮框（`keypad.js` 加 `openText`，16px、系统键盘）；选项用 `openChoices`。
- [x] 试演工具 `学生: write T.2,3 7`（表）；`new3/A.txt`；表 `NEW3`、`--table new3`；`stage-touch.mjs` 一段；排版检查认得表。
- [x] 说明（`SUBJECT_TYPES` 六门都带）；提交。

### Task 3：时间轴
- [x] 测试（先红）：造（停靠点、`now=`）；`stand` 造出拨词的拨盘（`set me 现在`、`{me}`、句子跟着、`when="me = 现在"`）；`point`、`bar`（`start=` `end=`）；拨词的拨盘比先后（`<` `>`，不是同一条轴当场报）；现状里条和小人的关系；手势 `move`、`stretch` 交 `set`；同名重造、`remove tl` 以后拨盘跟着没了。
- [x] 实现 `types/timeline.js`、`.rules.js`、`.view.js`；`goal.js` 的 `wordDial` 比先后；试演 `new3/B.txt`；真手指一段；说明（英语）；提交。

### Task 4：合并发布一次
- [x] 全量测试、`check:stage`、`fix1` `new2` `new3`、e2e；旧课重放（副本里八段并行）；只读助手审；修；合进 `main`；发布。

### Task 5：底座留下的 8 条
- [x] 一条一个测试（先红）再做，顺序：7（`watch`）→ 2（弹回的那一下）→ 3（`compare`）→ 4（阶梯形）→ 9（两个式子）→ 8（大小写）→ 5（收下的看得见）→ 1（`tally`）。每条提交一次。

### Task 6：排版留下的 4 条
- [x] 每条：先让 `tools/stage-measure.mjs` 报得出（最小的试演放 `evals/stage-gaps/fix1/`、表 `FIX1` 加一行），再修根子。

### Task 7：文档、合并发布
- [x] `docs/stage-mainline.md` 加「第三轮」；`CLAUDE.md`；`docs/stage-gaps.md` 留下的条目标上做了；rulings；版本号；重放；审；合并；发布。
