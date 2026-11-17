# 外部主 Claude 的学习台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 外部主 Claude（claude.ai 项目对话）在学习台现有的黑板上讲课：一轮写一条 `ext_in`，页面照课堂原来那条路画、判、记；学生的现状写成 `ext_out` 给它读。页面里的 Claude 只做练习教练和板边助教。

**Architecture:** 新的一种课 `kind: ext`，课堂控制器 `classroom.js` 多一个外部模式：学生作答不调用模型，写 `sessions/{编号}/ext_out/{序号}`；订阅 `sessions/{编号}/ext_in/{序号}`，到了就交给现有的 `finishTurn`。纯函数放 `kit/src/class/ext.js`。第十四轮的课后那一轮、第一次整理搬进 `archive/`；页面能算的事实写 `meta/facts`。

**Tech Stack:** 现有的 ES 模块 + esbuild 打包、`node --test`、Playwright 的 e2e（`tools/desk-e2e.mjs`）。

**Spec:** `docs/superpowers/specs/2026-11-17-external-teacher-design.md` + `docs/superpowers/specs/2026-11-17-external-teacher-review.md`（**冲突以 review 为准**）。

## Global Constraints

- 开发不约束外部怎么教：给外部的只有「能做什么、写法是什么、页面会怎么做（含平台限制）」。手册、`ext_out`、`meta/catalog`、`meta/facts` 里不写「什么时候做、先做什么、该怎么教、开工先读什么、下课要写什么」。
- 外部的模型不核、不作废、不在板上标；`ext_in.model` 可选，写了照存进 `class_turns`，报告看得到。「只能是 Opus 5.5 high、不是就作废」只管页面调用的 Claude（练习教练、板边助教）。
- 一节外部课里外部一轮只需要写一条文档（`ext_in`）；开课可以和第一条 `ext_in` 同一次写（两条同时到、谁先被订阅到都要能处理）。
- 板的截图不自动存：只有外部写了 `board snap`，下一份 `ext_out` 才带截图（asset 编号）。
- 写法错误、不认的块、记忆块被守卫拦下，都进下一份 `ext_out` 最前面，写清哪一段、哪一行、为什么；板上照旧标红。
- 同一条 `ext_in` 只执行一次（写 `done`）；有 `done` 的照 `class_turns` 放回。
- 页面不拦外部写数据：格式不对照存，在 `meta/health` 里照实报。写入身份多一个 `ext`。
- 手册（`CLAUDE-PROJECT.md`）里非组件写法的部分不许有：「你应该」「必须先」「最重要」「推荐」「照做」。
- 硬性规定照旧：发给 Claude 的提示词里不用「他」「她」；不用 `window.confirm/alert/prompt`；`la-kit.js` 自包含；界面以 iPad 为准。
- 来回时间：每个 `ext_out` 写好的时刻 → 对应的 `ext_in` 到达，报告里有中位数（外部定的线：真课中位数超过 60 秒就停下来重新评估这条路）。

## Review Focus

1. 学生在外部写下一条 `ext_in` 之前又做了几道题：每次合并都写一条新的 `ext_out`，外部读 `after` 以后的全部；没有一条丢。
2. 页面没开着时外部写了两三条 `ext_in`：打开后按序号补执行，不重复执行已 `done` 的；两个标签页同时开着只执行一次。
3. `ext_in` 写的组件有错、或者 `text` 里一个 board 块都没有、或者只有话：板上照旧（错的段标红），下一份 `ext_out` 最前面写清楚，页面不报错、不卡住。
4. 学生分屏切到 claude.ai（`visibilitychange` / `blur`）时手上没写的作答、草稿立刻写掉；切回来不重复写。
5. 外部写了 `status: closed` 或 `board close` 以后页面不再把 `sessions/{编号}` 盖回 `open`。

---

### Task 1: `kind: ext` 和写入身份 `ext`

**Files:**
- Modify: `kit/src/memory/session.js`（`SESSION_KINDS` 加 `ext: '外部的课'`；`TEACH_KINDS` 加 `'ext'`；`kindOf` 认 `ext`）
- Modify: `kit/src/memory/schema.js`（`ROLES` 加 `'ext'`；`sessions.kind` 枚举加 `ext`、`sessions.writers` 加 `ext`；`observations.by`、`pending.by` 的枚举加 `ext`）
- Modify: `kit/src/memory/oldview.js`（`oldKind` 不把 `ext` 当旧课）
- Modify: `kit/src/project/notebookview.js`（`BY` 加 `ext: '外部主讲'`、`night: '夜班'`）
- Test: `tests/ext-kind.test.js`

**Interfaces:**
- Produces: `kindOf({ kind: 'ext' }) === 'ext'`；`isTeach({ kind: 'ext' }) === true`；`ROLES.includes('ext')`

- [ ] **Step 1: 写测试**：`kindOf({kind:'ext'})` 是 `'ext'`；`isTeach` 为真；`validateWrite('sessions/c-20261118-1', { date:'2026-11-18', kind:'ext', status:'open' })` 是 `[]`；`validateWrite('observations/o-1', {..., by:'ext'})` 不报 `by`；`oldKind({kind:'ext'})` 为假；`check.js` 对 `log` 里 `by: 'ext'` 不报。
- [ ] **Step 2: 跑** `node --test tests/ext-kind.test.js`，Expected：FAIL。
- [ ] **Step 3: 改上面几处**。
- [ ] **Step 4: 跑** `npm test`，Expected：全过。
- [ ] **Step 5: 提交** `git commit -m "外部的课 kind: ext、写入身份 ext"`

### Task 2: 外部课的纯函数 `kit/src/class/ext.js` 和三条新指令

**Files:**
- Create: `kit/src/class/ext.js`
- Modify: `kit/src/class/protocol.js`（`parseCommand` 认 `snap`、`close`、`coach`；`OP_LIST` 跟着加）
- Test: `tests/class-ext.test.js`

**Interfaces:**
- Produces:
  - `pendingIns(docs: {id, seq, done?}[]): doc[]`——没 `done` 的按 `seq` 升序（`seq` 缺时按 id 的数字）
  - `outText({ head: string[], message: string, state: string }): string`——`head`（写法错误、没执行的、被拦的）在最前，一条一行；再 `message`（这一批的作答行、草稿、学生说的话，就是 `flush` 拼给页面里老师的那一段）；最后 `state`（`boardStateText(boardState())`）。三段之间空一行，空的段不写
  - `outSeq(docs): number`——下一个 `ext_out` 序号（现有最大 + 1，没有是 1）；`seqId(n) = String(n).padStart(3, '0')`
  - `latency(outs: {seq, at}[], ins: {after, got}[]): { n, median, p90 } | null`——每条 `ext_in` 配 `seq === after` 的那条 `ext_out`，`got - at`（毫秒）
  - `parseCoach(head: string): { target, upto } | { error }`——`board coach target=题号 upto=第几步或一句话`
  - protocol：`board snap` → `{ op: 'snap' }`；`board close` → `{ op: 'close' }`；`board coach target=q1 upto=2` → `{ op: 'coach', target: 'q1', upto: '2' }`

- [ ] **Step 1: 写测试**：`pendingIns([{id:'002',seq:2},{id:'001',seq:1,done:{at:1}},{id:'003',seq:3}])` 回 seq 2、3；`outText({head:['b4 写错：看不懂这一行'], message:'[作答] …', state:'板 1 …'})` 以 `b4 写错` 开头、三段按序；`outSeq([])===1`、`outSeq([{seq:4}])===5`；`latency([{seq:1,at:0},{seq:2,at:100}],[{after:1,got:30000},{after:2,got:70100}])` 回 `{n:2, median:…}`（两个数 30000、70000 的中位数 50000）；`parseCommand('board snap')` 等三条；`board coach` 不写 target 回 error。
- [ ] **Step 2: 跑** `node --test tests/class-ext.test.js`，Expected：FAIL。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 跑** `npm test`，Expected：全过。
- [ ] **Step 5: 提交** `git commit -m "外部课的纯函数：ext_in 待执行、ext_out 拼法、来回时间、snap / close / coach"`

### Task 3: 课堂的外部模式

**Files:**
- Modify: `kit/src/class/classroom.js`
- Modify: `kit/src/memory/desk.js`（`enterClass` 对 `kind: ext` 传 `ext`；补字段；`updateSession` 合并）
- Modify: `kit/src/memory/report.js`（报告多 `ext: latency(...)`）
- Modify: `tools/desk-e2e.mjs`（加 `ext` 一段）

**Interfaces:**
- Consumes: Task 2 的 `pendingIns`、`outText`、`outSeq`、`seqId`、`latency`、新指令
- Produces: `renderClass(root, meta, { ..., ext: { db } })`——`ext` 在时课堂进外部模式；数据：
  - `sessions/{编号}/ext_in/{seqId}` = `{ seq, text, model?, said?, after?, at, done?: { at } }`（外部写；`done` 页面写）
  - `sessions/{编号}/ext_out/{seqId}` = `{ seq, text, shots?: string[], at }`（页面写）

- [ ] **Step 1: e2e 先写**（`ext` 段）：用 `plant` 写一节 `kind: ext` 的课和 `ext_in/001`（一块板、一道 `quiz`，`said: "我们从可交换开始"`）→ 进课堂，板上出现那道题；点一个选项 → 1.5 秒后有 `ext_out/001`，`text` 里有那一行作答；页面切到后台（`page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))` 加 `visibilityState` 打桩）以后草稿也写进去；再写 `ext_in/002`（`after: 1`，一段写错的组件 + `board snap`）→ `ext_out/002` 第一行说那段写错、带 `shots`；写 `ext_in/003` 带 `board close` → `sessions` 的 `status` 是 `closed`、有报告、报告里 `ext.n === 2`；刷新进课堂只放回不重复执行（`class_turns` 条数不变）；`say` 证据里有那句 `said`。
- [ ] **Step 2: 跑** `npm run build && node tools/desk-e2e.mjs --only ext`，Expected：FAIL。
- [ ] **Step 3: 实现 classroom.js 的外部模式**（`const EXT = !!desk?.ext`）：
  - `flush`：照旧拼 `text`、`addTurn`、记证据；然后不调 `converse`，写一条 `ext_out`（`outText({ head: 待报的错误, message: text, state: boardStateText(boardState()) })`，`shots` 是 `pendingSnap` 时用 `eye` 拍的、上传的 asset 编号）；不进 `busy`。
  - 订阅 `ext_in`：`pendingIns` 一条一条在 `exclusive` 里跑 `finishTurn({ text, modelApplied: model || '' })`；`out.retry` / `out.notes` / 守卫拦下的记进「待报的错误」；`said` 记成 say 证据（`sayEvidence(said, …)`）；写 `done: { at }`、`got`；已 `done` 的跳过（刷新时照 `class_turns` 放回，这条路现有）。
  - `snap` → 下一次写 `ext_out` 时拍；`close` → `endClass` 的直接下课那条路（不调用模型、不写小结）；`coach` → 存规则给 Task 4。
  - `visibilitychange`（`hidden`）、`blur`：有排着的就马上 `flush`。
  - 外部模式下不开：抢跑（`specSoon` / `startSpec`）、对话压缩（`compactLater` / `compact`）、停久了提醒（`stuck`）、重试按钮、开课页的「开始上课」调用；底部输入框收起（学生在 claude.ai 里说话）。
  - 写进 `class_turns` 的外部那一轮带 `by: 'ext'`、`model`。
- [ ] **Step 4: 实现 desk.js**：`kindOf(doc) === 'ext'` 时 `renderClass(..., { ext: { db: scopeDb(db, sid) } })`；第一次打开补 `createClass` 平时写的字段（`subject`、`aims: []` 没有才补）；`updateSession` 写之前读一次最新的再合并（外部写的 `status: closed` 不被盖）。首页「上课」那一行列 `kind: ext` 的课（`SESSION_KINDS` 已有名字）。
- [ ] **Step 5: 实现 report.js**：`buildReport` 能拿到这节课的 `ext_out` / `ext_in` 时写 `ext: latency(outs, ins)`（`writeReport` 读这两类传进去）。
- [ ] **Step 6: 跑** `npm test && npm run build && node tools/desk-e2e.mjs --only ext,class,root`，Expected：全过。
- [ ] **Step 7: 提交** `git commit -m "课堂的外部模式：ext_in 画上板、ext_out 写现状、snap / close、来回时间"`

### Task 4: 板边助教

**Files:**
- Create: `kit/src/class/coach.js`（纯函数）
- Modify: `kit/src/class/classroom.js`（外部模式里：`coach` 规则；学生在开了助教的题上判错 → 调用页面里的 Claude 一次）
- Test: `tests/class-coach.test.js`；e2e 的 `ext` 段加一步

**Interfaces:**
- Consumes: Task 2 的 `parseCoach`
- Produces:
  - `coachPrompt({ segment: string, upto: string, answer: string }): string`——只写事实：这一题的原文、外部写的 `upto`、学生这次的作答；要一句话
  - `coachSegment(id: string, line: string): string`——`board add id=coach-{id}-{n} after={id}` 的块文字，正文是「> 助教：{line}」
- 调用：`{ model: 'claude-opus-5-5', effort: 'high', modelTier: 'complex', cache: false }`，回的不是 Opus 5.5 就扔掉；写板只用 `coachSegment` 拼好的块走 `finishTurn`（助教没有写板的指令）；那一行进下一份 `ext_out`

- [ ] **Step 1: 写测试**：`coachPrompt` 含题的原文、`upto`、作答，不含 `FORBIDDEN`、不含「他」「她」；`coachSegment('q1','先看 AB 和 BA')` 解析出来是一条 `add`、`after=q1`。e2e：`ext_in` 里写 `board coach target=q1 upto=1`，选错 → 板上 q1 下面出现「助教：」一行（`?dev` 模拟模型回一句），`ext_out` 里有它；没写 coach 的题选错不出现。
- [ ] **Step 2: 跑**，Expected：FAIL。
- [ ] **Step 3: 实现**（dev 的模拟回答在 `kit/src/books/devmock.js` 认 `coachPrompt` 的开头）。
- [ ] **Step 4: 跑** `npm test && npm run build && node tools/desk-e2e.mjs --only ext`，Expected：全过。
- [ ] **Step 5: 提交** `git commit -m "板边助教：外部开了的题，学生做错当场一句"`

### Task 5: 练习教练（`meta/today` 的 `coach`）

**Files:**
- Modify: `kit/src/project/today.js`（`TODAY_KINDS` 加 `coach`；`coach` 项要 `block`，带 `why`、`focus`、`ids`）
- Modify: `kit/src/memory/desk.js`（点 coach 那一行开一节页面里老师带的课，资料包 `main.coach = { why, focus, ids, by: '主讲' }`）
- Modify: `kit/src/class/prompt.js`（`PACK_FIELDS` 加 `['coach', '主讲写的（外部主 Claude）']`，原样放 `why`、`focus`、题号）
- Test: `tests/project-today.test.js` 加；e2e 加 `coach` 段

**Interfaces:**
- Consumes: `todayRows`（现有）
- Produces: `todayRows` 的 `coach` 行 `{ kind:'coach', block, why, focus, ids, label }`

- [ ] **Step 1: 写测试**：`todayRows({date, items:[{kind:'coach', block:'L2.1.4', why:'到期', focus:'把 AB 写成 BA'}]}, …)` 出一行 `coach`；没 `block` 的不画；`buildSystem` 的资料包里出现「主讲写的」和 `focus` 原文。e2e：`meta/today` 写一项 `coach` → 首页有这一行 → 点开进课堂，资料包里有 `coach`。
- [ ] **Step 2～4:** 跑失败 → 实现 → `npm test && npm run build && node tools/desk-e2e.mjs --only coach`。
- [ ] **Step 5: 提交** `git commit -m "练习教练：主讲在今天里排的，页面里的老师带着练"`

### Task 6: 页面算的事实 `meta/facts` 和 `meta/catalog`

**Files:**
- Create: `kit/src/project/facts.js`
- Modify: `kit/src/memory/desk.js`（变了才写 `meta/facts`、`meta/catalog`）
- Test: `tests/project-facts.test.js`

**Interfaces:**
- Produces: `factsDoc(data, today: string): { today, spaces: { [space]: { due: {id,title,days}[], recall: number, open: {id,title,date}[], minutes7: number, last: {id,title,date}|null } }, health: number }`——到期的复现组、要记的到期条数、挂着没下课的课、这 7 天学了几分钟（按报告的 `activeMs`）、上一节、体检 `notes` 条数。`meta/catalog` = `{ text: catalogText(...), at }`

- [ ] **Step 1: 写测试**：给两科的 sessions、reviews、recall，`factsDoc` 各项对；不含 `FORBIDDEN`（文字字段）。
- [ ] **Step 2～4:** 跑失败 → 实现 → `npm test`。
- [ ] **Step 5: 提交** `git commit -m "页面算的事实写进 meta/facts，学习台里有什么写进 meta/catalog"`

### Task 7: 收掉第十四轮里冲突的

**Files:**
- Move to `archive/`: `kit/src/project/after.js`、`afterdesk.js`、`tests/project-after.test.js`、`tests/project-afterdesk.test.js`（`archive/README.md` 加一行）
- Modify: `kit/src/memory/desk.js`（去掉 `backTick` 的课后那一轮和第一次整理、`meta/project` 的订阅；导航里「班主任」换成一行「在 claude.ai 对话里找主讲」，`#chat` 的旧对话在「以前的课」旁边还能翻看）
- Modify: `docs/lab-prompt.md`（夜班：只做笔记本 `计划/夜班.md` 写的事，没写就结束；事实在 `meta/facts`；写法和 journal 照手册；上海时间；notebook 的 doc_id）
- Modify: `tests/project-night.test.js`（提示词说「照 `计划/夜班.md`」、提到 `meta/facts`；仍不含 `FORBIDDEN`）
- Modify: `tools/desk-e2e.mjs`（去掉 `after` 段；`project` 段里班主任那几步换成看得到那一行说明）

- [ ] **Step 1:** 改测试（`project-night`）和 e2e；跑，Expected：FAIL。
- [ ] **Step 2:** 搬、改。
- [ ] **Step 3:** `npm test && npm run build && npm run e2e`，Expected：全过。
- [ ] **Step 4: 提交** `git commit -m "收掉课后那一轮、第一次整理、首页班主任；夜班只照主讲的计划做"`

### Task 8: 外部的预检工具

**Files:**
- Create: `tools/ext-check.mjs`
- Create: `tools/ext-class.js`（纯函数，转换）
- Test: `tests/ext-class.test.js`

**Interfaces:**
- Produces:
  - `extClass({ ins: {seq,text}[], outs: {seq,text}[], next: string, unit, subject }): object`——拼成 `check-lesson.mjs` 认的 `.class.json`（`turns: [{ student, teacher }]`：每条 `ext_in` 是 teacher，它前面那条 `ext_out` 是 student；`next` 是最后一个 teacher）
  - 命令：`node tools/ext-check.mjs --session <ArtifactData 存下来的目录> --next 一轮.txt [--shots 目录]`：读 `sessions/{编号}/ext_in`、`ext_out` 的 JSON，写临时 `.class.json`，跑 `check-lesson.mjs` 的 `checkClass`，开头打印 `kit/dist/la-kit.js` 的版本号（`LAKit.version`）
  - 不要求 `npm install` 以外的东西（Playwright、Chromium 照现在预装的）

- [ ] **Step 1: 写测试**：两条 `ext_in`、一条 `ext_out`、`next` → `turns` 有三条、最后一条 teacher 是 `next`、student 是对应的 `ext_out.text`。
- [ ] **Step 2～4:** 跑失败 → 实现 → `npm test`；手动跑一次：`node tools/ext-check.mjs --session <e2e 留下的一节> --next <写错一个组件的一轮> --shots /tmp/x`，Expected：报出那个写法错误、出两张截图，说法和页面写进 `ext_out` 的一致。
- [ ] **Step 5: 提交** `git commit -m "外部的预检工具：一轮写进学习台之前在自己的沙盒里跑一遍"`

### Task 9: 手册改成纯参考、文档、发布

**Files:**
- Modify: `CLAUDE-PROJECT.md`：删开头讲教法的那段、第一节、第二节、第五节、第三节组件说明里的教法句（「最推荐」「先……再……讲」「一般先……」）；第六节的黑板指令写法留写法、删做法句，补 `snap` / `close` / `coach`；第七节补 `ext`、`ext_in`、`ext_out`、`meta/today`（含 `coach`）、`meta/facts`、`meta/catalog`、`notebook` 的 doc_id（path 的 base64url）、`journal`、上海时间；新加一节「外部的课」：写法、页面会怎么做、平台事实（每一轮第一次写弹一次「Allow once」、没有一直允许、删除带 `shared_live: deletes_rows`）、预检工具怎么跑。版本号 `2026-11-18`。`## 三、组件参考` 这个标题不能改（`kit/build-docs.js` 认它）。
- Create: `tests/manual-words.test.js`：非组件写法部分不含「你应该」「必须先」「最重要」「推荐」「照做」
- Modify: `CLAUDE.md`（第十五轮一条：外部主 Claude；硬性规定里 Opus 那条写明只管页面调用的）、`docs/root-handoff.md`（换成这一轮）
- Data（ArtifactData，发布后）：`c-20261117-1`、`-2`、`-3` 照直接下课收掉（`status: closed`、`endedAt`、`closedBy: 'me'`，报告由首页补）；删 `meta/project`

- [ ] **Step 1: 写** `tests/manual-words.test.js`；跑，Expected：FAIL。
- [ ] **Step 2: 改手册**；`npm run build`（`build-split.js` 照常拆出 `kit/dist/docs/`）。
- [ ] **Step 3:** `npm test && npm run e2e`，Expected：全过；`git status` 只剩这次改的。
- [ ] **Step 4: 提交、推、合进 main、发布学习台**（`kit/desk.html` + `la-kit.js` + `CLAUDE-PROJECT.md` + 变了的 `components/*.md`）。
- [ ] **Step 5: 数据**：收掉三节课、删 `meta/project`；定时任务的提示词给学生看过再 `update_trigger`。
