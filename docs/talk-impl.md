# 一问一答的课：实现说明（第 1 批，接进学习台）

照 `docs/talk-plan.md`。这一份是怎么接进现有课堂的**定案**：2026-11-05 三个助手分头读了课堂、说明、学习台，一个助手挑漏，下面是裁定以后的做法（有冲突的以这里为准）。行号是当时的，改之前先对一下。

总原则：**不另写课堂**。`kit/src/class/classroom.js` 加一种形态 `const TALK = !!desk?.talk`，只认 Opus 5.5 核验、边写边显示、记忆、资料包和教材、memo 和守卫、证据、下课小结和整理单、报告、花费、刷新恢复、调用让路全部沿用。所有分叉都看 `TALK`；`TALK` 为假时行为一字不变（老测试、e2e 不动）。

## A. 学习台这一侧（kind: talk 的接线）

1. `memory/session.js`：`SESSION_KINDS` 加 `talk: '一问一答'`；导出 `isTeach = (d) => ['class', 'talk'].includes(kindOf(d))`（课堂里的 Claude 讲的课）。
2. `memory/schema.js` 的 `sessions.enums.kind` 加 `'talk'`（不加的话 guardDb 记错、e2e 判红）。
3. 写死 `'class'` 或 kind 列表的地方都换成 `isTeach` / 加 talk：`desk.js`（主角卡 opens.find、「接着上课」按钮文字、priorReads）、`debrief.js` needsDebrief、`digest.js` KIND 和 earlierClasses、`sentry.js` KINDS 和判断、`health.js` KINDS 和判断、`views.js` classRows 的列表和 handoffText、`pages.js`「接着上课 / 进去」、`memo.js` tidyDue。先 `grep -n "'class'" kit/src/memory` 全看一遍。
4. `desk.js` `createClass` 加参数 `kind = 'class'`，talk 时文档写 `kind: 'talk'`（class 照旧不写）；`newClass` / `makeClass` / 复现课 / 练一练的 openClass 都透传 kind。开课方式记在这台设备上：`classForm()` 读 localStorage `la-class-form`（try/catch，默认 `'class'`）。
5. 入口：首页主角卡「开新课」旁边一个小的分段控件「黑板 / 一问一答」（选了记进 `la-class-form`），开课、复现课、练一练「带着开课」都照它。长按菜单不用改。
6. `enterClass`：talk 也走 `renderClass`（教材、prevRead、recheck、memo、writeReport、makeReport、review、opening 全要），两处 renderClass 的 desk 参数加 `talk: kind === 'talk'`（只读回看那份也加）。
7. `guard.js` `buildCorpus`：老师那一轮除了 `t.text` 再拼上 `t.shown`（学生在板上看到的那一轮的字，见 C.9），守卫核原话时找得到。
8. 报告（`report.js`）、归类、掌握不用改代码，靠 C.6 写对证据。`mastery.js` / `report.js` 里「目标」不算对错（见 C.6）：确认一下 itemsOf 对 `ok === undefined` 的记成 open、不进掌握。

## B. 画面（kit/src/huoban/）

1. `view.js`：空、选择、目标的状态按**行号**记（`${ln.n}#${i}`），不按行的文字（两行文字一样会串）。applyOps 只往后接、set 只改 let 行，行号稳定。
2. `view.js` `blank`：`input` 事件把正在写的字存进 `st.draft`，重画时 `input.value = st.val || st.draft`；setSource 前记下焦点在哪个空（按 id），画完 focus 回去、光标放到末尾（流式、老师回话时学生正在写不丢字、不收键盘）。正在拖 / 拨的手势被重画打断时，手势结束前不重画那一块（简单做法：`this.gesture` 为真时 setSource 先存着，手势结束再画）。
3. `view.js` `blank` 里 `markDraft(w, () => st.status === 'ok' ? '' : (input.value.trim()))`，`w.dataset.key = id`（drafts.js 接上：老师看得到没交的字、下课记草稿证据、抢跑知道有草稿）。
4. 作答记录带齐（C.6 用）：`act()` 的参数加 `n`（行号）、`k`（这一行第几个控件）、`sub`（`blank` / `choice` / `goal` / `explore`）、`q`（人读得懂的题面：那一行的话，空写成 □，选择写出选项）、`expr`（源码表达式）；explore 带 `name`、`to`（刷新后放回拨的值）。info（找了例子）带 `name`、`value`。
5. `talkview.js`（已经有 `TalkBoard`）：每一轮的框写 `dataset.t0`（这一轮出现的时间，算用时）；`place`、`addEcho`、`setMeta` 照旧。加 `snapshot()` → `{ src, bounds, echo, meta, finds }`、`restoreFrom(snap)`（finds 先填进 `rt.findCache`，不再重新搜）。

## C. 课堂（kit/src/class/classroom.js 和 prompt.js）

1. **活板就是一段 steps**：id 固定 `hb`，md 是整份源码（四个反引号的 `huoban` 围栏包住），另存 `bounds`、`echo`、`meta`、`finds`。**只在第一轮核验通过以后**在 finishTurn 里建（之前照常是欢迎牌和「开始上课」，开课抢跑的指纹才对得上）；建一次、以后只改 md 和那几个字段（saveSeg）。所在的板号记成 `hbPage`，talk 的写入都用它；下课以后学生再说话，先回到 hbPage。
2. `blocks/huoban.js`：`session.talk`（或段上标了 talk）时画 `TalkBoard`，并 `el._hb = board`；控制器从 `seg.sec.querySelector('.block-huoban')._hb` 拿实例，之后一律 `hb.show(src, bounds, { quiet: true })`，不再 renderSeg 这一段（重画会丢学生拨的值、填的空）。onSource 不往 session.problems 推（控制器用 `hb.problems()` 自己取）。
3. **finishTurn 的 TALK 分支**：`parseOutput(res.text, { final: true })` 以后——
   - 活板的几行 = speech 的文字（去掉 rejected / unclosed 的 board 块原文那几行）；`res.truncated` 时去掉最后一行，notes 记一句。
   - board 块只执行 memo 和 plan；别的（new / add / mark …）不执行，notes 记「一问一答里不写 board 块，写活板的行」。
   - `base` = 上一次成功的源码；`next = applyOps(base, 这几行)`；`hb.show(next, [...bounds, 行数], { quiet: true, entering: true })`。
   - 这一轮新出的写法错误 = `hb.problems()` 里 level 为 error、且 base 里没有的（按「行文字 + msg」比），**加上** DOM 里新冒出的 `.hb-bad`、`.hb-err`、`.katex-error`（按所在行和 base 比）。有就：回退到 base（`hb.show(base, bounds)`），走现有的 failures → retry（`whole: true`：提醒写成「这一轮有 N 行看不懂：「行」原因；…把这一轮整轮重写，只写这一轮的几行」，不附 lintDocs），rewrites 计数、MAX_ROUNDS 照旧。
   - 没错：saveSeg（md、bounds、echo、meta、finds）；`setMeta(i, 'Opus 5.5 · 3.2 秒')`；不调 setTalk（板顶空着）；滚到 hb 的最后一轮；check 的 warn / info（`checkText`）记成一条 system note 跟着下一轮给老师；find 找到的例子也写进 note（`页面替你找了例子：v = …`）。
   - addTurn 的 claude 轮多存 `shown`：这一轮框的 `textContent`（截到 2000 字），给守卫（A.7）。
4. **边写边显示**（drawDraft，不是下课那次）：TALK 时不在板顶预览话；每多写完**一整行**才更新一次：`hb.show(applyOps(base, 写完的行), [...bounds, 行数], { quiet: true, check: false })`；第一次时存 `stream.hbBase = base`。`dropPreviews({ rollback })`：rollback 就 `hb.show(stream.hbBase, bounds)`。草稿框和「Claude 在想 / 在写」插在 hb 的最后（`.hb-now` 后面），不放板顶。
5. **说明（prompt.js `buildSystem`）** 加参数 `talk`（buildInput、endClass 那次、systemWithBooks 透传）：
   - 第一节：`talkRole(subject)` + `TEACH_TALK`（huoban/doc.js）+ (`custom` || 学生的 rules || 红线)；资料包写了 rules 时只替换红线那部分，talk 的开场和「怎么教」永远在前。各科教法只带「本质」的几条（例子要挑、口径照资料包、术语附英文……），不带讲组件、讲板的。
   - 第二节：`LANG_TALK` + 「活板对象」（`talkObjectDocs(subject)`：有 `kit/src/huoban/objdocs.js` 打包好的对象说明就用它，按科目过滤；没有时退回组件手册 `systemDocs` 里演示组件那几节当字段参考）。不带 PROTOCOL_DOC / CANVAS_DOC；「你会收到的消息」那几条（[作答] / [动作] / [系统] / 摘要）抽成小常量两边共用。
   - 开头那句换成一问一答的说法；DESK_DOC 去掉 `point=` 那条；MEMO_DOC 的 basis 例子换成 talk 的编号（`basis=L12` 指第 12 行那一问的作答、`basis=say`）；工具：talk 里不给 `board_read`、`component_doc`（对象说明齐了以后），其余照旧（一般用不到）。
   - 第五节黑板现状：新纯函数 `talkStateText(state)`（放 `huoban/` 或 prompt.js，配测试）：整份源码带行号、标「第 i 轮写的」；能拨 / 能拖的量现在的值和初值；每个空的状态（写着什么没交、交过几次、最后对不对、现在页面算的答案，数变了重开的注明）；选择选过哪些；目标做到没有；find 找到的值；还没告诉过老师的检查提醒；屏幕一行。**永远不为空**（没有活板时写「活板还是空的：这一轮写的就是第一问」，开课抢跑的指纹两种情况一样）。
   - `packText` 加 talk：sequence 的标题改「推进顺序」，去掉 components，题目前面加「这些是题的内容，在活板上用 {x?} / {? …} 重新出，不要照抄围栏」。
6. **作答记录**：控制器接 TalkBoard 的 onAction，调 `session.record`：
   - commit 的空 / 选择：`type: 'huoban'`、`block: 'L' + n`（同一行第二个控件 `L12.2`）、`q`（题面）、`expr`、`value`、`ok`、`misread`、`sub`、`ms`（这一问出现到作答，用轮框的 t0）、`el`（那一轮的框）。set 改数后同一个空重开再答，block 加后缀 `#2` 算新的一道。
   - 目标：`sub: 'goal'`、不带 `ok`（不算对错，不进掌握）。
   - explore：`liveOnly: true`、`explore: true`、**不给 block**（不成为一道题）、带 `name`、`to`；info：转成 system note。
   - 回显：`hb.addEcho(a.short)`。
   - `prompt.js` `actionTrigger`：`huoban` 且 `explore` → `'later'`（攒着跟下一条一起发）；commit 照旧 soon。
   - `class/bar.js`：加 `actionsPending` 回调（和 inkPending 一样），有排着的 later 动作时发送键亮、文字「就这样 →」；文字为空也能发（flush 已经能处理只有动作的一批）。
   - `recordText` 的 `huoban`：位置写「第 n 行」。
7. **草稿**：TALK 时 toldDrafts / loggedDrafts 按草稿元素的 `data-key` 记（TalkBoard 每轮重建 DOM，按元素记会每轮重报）。
8. **刷新恢复**：restore 里 TALK 时，hb 那一段用段文档的 md / bounds / echo / meta / finds 画回 TalkBoard（`restoreFrom`）；studentWork 的记录按 `block`（L12…）放回 blanks / choices / goalsDone，explore 按 `name` / `to` 放回 rt.inputs；replayStudentWork 跳过 hb。
9. **抢跑**：开课页「开始上课。」照抢；开课以后 TALK 不抢「继续。」（每轮都以一问结尾）。
10. **关掉的**（第一批）：TALK 里点着问（askhere）先不挂；Pencil 板书先不挂（锚点会跟着版式乱跑）；信心「有把握吗」先不开；拍子本来就关（stream 开着）。
11. **下课**：endClass 照旧（buildSystem 带 talk）；小结不走活板的流式；小结板照旧 newPage(closing)；学生之后再说话回到 hbPage。
12. **出错**：TALK 分支里 setSource / applyOps 的 try/catch 调 `errlog.js` 的 `reportError(err, { what: '活板', path: 'sessions/' + sid })`。

## D. 验证

1. `class/devteacher.js` 加 talk 的剧本（`?dev` 不调用 Claude）：第一轮一个置换表 + 一个空；学生答了以后 set 改块数 + 一个选择；再一轮 goal。
2. `tools/desk-e2e.mjs` 加 `talk` 一段：首页选「一问一答」→ 开课（连点两下只开一节）→ 「开始上课」→ 等 `.hb-board` 里出现空 → 填错一次、填对一次 → 等 evidence 里有 `src: record`、`comp` 是 `L…` 的两条 → 拨一下（不触发调用）→ 点「就这样」→ 第二轮 → 刷新，空的状态、拨的值都在 → 直接下课 → 报告里有这几道题 → 「以前的课」能翻看（只读不调用）。
3. 纯函数（talkStateText、记录的编号、错误比对）配 `node --test`；`npm test`、`npm run build`（提交产物）、`npm run e2e` 全过。
