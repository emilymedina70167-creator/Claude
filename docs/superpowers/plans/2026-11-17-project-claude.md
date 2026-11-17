# 第十四轮：学习台里的「项目 Claude」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 班主任和每节课的老师成为同一个「项目 Claude」：只读学生写的项目指令、自己写笔记本、能读能搜学习台里的一切、能建给学生看的页面；被替代、被迭代的旧功能搬进 `archive/`。

**Architecture:** 新目录 `kit/src/project/` 放纯函数（笔记本、搜索、拼说明、课后那一轮的提示）和数据库那一层，班主任（`head/`）和课堂（`class/`）都改为调用它；页面只做工具、存放、呈现。旧功能先抽出共用小件，再整目录 `git mv` 进 `archive/`（不进构建、不跑测试）。

**Tech Stack:** 原生 ES 模块、esbuild 构建（`npm run build`）、`node --test`、Playwright e2e（`npm run e2e`）、artifact 的 `window.claude.use('sample')`（工具由页面实现）。

**Spec:** `docs/superpowers/specs/2026-11-17-project-claude-design.md`（6.10 是去留清单，9 / 9.1 是开发定的事）。

## Global Constraints

- 讲课、班主任、课后那一轮、第一次整理、每周通读：只认 `claude-opus-5-5`、`effort: 'high'`；回的不是就作废，不加退路模型。
- 页面拼给 Claude 的字里提到学生不用「他」「她」；Claude 写的笔记存原样，发出去时照旧换成「学生」（`digest.js` 的 `neutral` 那一套）。
- 页面拼的那几段（身份、工具手册、下课那句、整理和通读的提示）只写事实，不写做法：不出现「你应该」「必须」「先……再……」「根本规则」「以它为准」。
- 项目指令只有学生写（`by: 'me'`），老师、班主任写不了；不设长度上限。笔记本不设单独上限，只有整份说明一个总量 `SYSTEM_MAX`（先照 160 KiB，任务 1 量完再定）。
- 后台的调用都写 `lane: 'bg'`；课上写笔记本走输出里的 `board note` 块，不走工具调用。
- 旧数据一条不删；不用 `window.confirm` / `alert` / `prompt`；界面以 iPad 为准（触控 ≥ 44px、输入框 16px）。
- 合进 `main` 前：`npm test` 全过、`npm run build` 后 `git status` 干净、`npm run e2e` 全过。

## Review Focus

- 笔记本还空着（第一次整理没做完）时学生就开课：课照常开，说明里写「笔记本还是空的，以前的记录在这些路径」，不报错。→ 任务 9 的测试。
- pin 的文件太多、整份说明放不下：说明不超总量，列出没放下的路径和大小，照 Claude 给的 `order` 先后放。→ 任务 4 的测试。
- 老师在 `board note` 里写的 `str_replace` 对不上：不改文件，下一轮第一句告诉它是哪一条、为什么。→ 任务 10 的测试。
- 课后那一轮回的不是 Opus、或出错：不写、记一次，满 2 次停，管理页看得到；下次打开首页不重复给已经成了的课。→ 任务 11 的测试。
- 从「以前的课」点开一节舞台课、一问一答、实时黑板、自学单元：只出文字（报告、记录），写明画面已停用；`meta/errors` 不多一条。→ 任务 3 的 e2e。

---

### Task 1: 测速加到 500 KB

**Files:**
- Modify: `kit/src/memory/speed.js`（`benchConds`）
- Test: `tests/memory-speed.test.js`

**Interfaces:**
- Produces: `benchConds('big')` → `[{kb:160,turns:2},{kb:300,turns:2},{kb:500,turns:2}]` 各重复 3 次（共 9 条）；「管理 → 测速」多一个按钮「量大说明」跑它，结果照旧写 `meta/speed`。

- [ ] **Step 1: 写测试** `test('量大说明：160 / 300 / 500 KB 各三次', …)`：`benchConds('big').length === 9`，`new Set(benchConds('big').map(c => c.kb))` 等于 `{160, 300, 500}`。
- [ ] **Step 2: 跑** `node --test tests/memory-speed.test.js`，看它失败。
- [ ] **Step 3: 实现** `benchConds` 的 `'big'` 分支和按钮（垫长照现有做法用组件手册重复拼到指定大小）。
- [ ] **Step 4: 跑测试通过；** `npm run build`。
- [ ] **Step 5: 提交** `git commit -m "测速：加量 160 / 300 / 500 KB 的说明"`。这一任务合进 `main` 并发布学习台（不用问），请学生在 iPad 上「管理 → 测速 → 量大说明」点一次；结果回来以后（`ArtifactData get meta/speed`）在任务 13 定 `SYSTEM_MAX`。后面的任务不等它，照 160 KiB 做。

### Task 2: 先把共用的小件抽出来

**Files:**
- Create: `kit/src/class/snap.js`（从 `kit/src/stage/snap.js` 搬，内容不变）
- Create: `kit/src/project/quotes.js`（`quotesIn`、`quoteFound`、`checkQuotes` 从 `kit/src/memory/summary.js` 搬）
- Create: `kit/src/project/transcript.js`（`transcriptText` 从 `kit/src/memory/debrief.js` 搬）
- Modify: 所有引用它们的地方（`class/boardeye.js`、`memory/summary.js`、`memory/summarydesk.js`、`head/headdesk.js`、`class/classroom.js` 等，`grep -rn "snap.js\|quoteFound\|quotesIn\|transcriptText" kit/src` 找全）改 import；原文件里留 `export { … } from` 转发，等任务 3 / 12 一起搬走
- Test: `tests/project-quotes.test.js`（从 `tests/memory-summary-quotes.test.js` 把核引号的用例搬过来）、`tests/project-transcript.test.js`

**Interfaces:**
- Produces: `createSnapper(opts)`（`class/snap.js`，签名照原样）；`quotesIn(text): string[]`、`quoteFound(quote: string, corpus: string): boolean`、`checkQuotes(text, corpus): { missing: string[] }`（`project/quotes.js`）；`transcriptText(args)`（`project/transcript.js`，签名照 `debrief.js` 原样）。

- [ ] **Step 1:** 新测试文件 import 新路径，跑 `node --test tests/project-quotes.test.js tests/project-transcript.test.js`，看它失败（文件不存在）。
- [ ] **Step 2:** 搬代码、改 import、原处留转发。
- [ ] **Step 3:** `npm test` 全过；`npm run build`。
- [ ] **Step 4: 提交** `git commit -m "抽出板的截图、核引号、记录稿：舞台和摘要搬走以前，别处先改用新位置"`。

### Task 3: 舞台课、一问一答、实时黑板、自学单元搬进 archive/

**Files:**
- Create: `archive/README.md`（表：搬了什么、哪天、为什么（设计 6.10 学生的原话）、要恢复从哪个提交拿——写本任务开始前 `main` 的提交号）
- Move（`git mv`，保持原路径放在 `archive/` 下）：`kit/src/stage/`、`kit/src/huoban/`、`kit/src/blocks/huoban.js`、`kit/src/blocks/stagedrill.js`、`kit/src/stagedrillspec.js`、`kit/src/memory/stagedrills.js`、`kit/src/live/live.js` `livebar.js` `ops.js` `layout.js` `devpanel.js`、`kit/src/guided.js`、`proto/stage/`、`proto/live-lang/`、`tools/stage-*.mjs`、`tools/stage-try-examples/`、`evals/stage-gaps/`、`evals/stage-canvas/`、`kit/examples/` 里 `mode: guided` 和 `mode: live` 的页、`stagedrill-demo.html`、`live-demo.html`、`live-tools.board.json`；整个文件只测这些的 `tests/*.test.js`（`stage-*`、`huoban*`、`stagedrillspec`、`live-layout`、`live-ops`、`memory-talk`、`stage-*-lesson*` 等，`grep -lE "kit/src/(stage|huoban)/|live/(live|livebar|ops|layout|devpanel)\.js|guided\.js|stagedrill" tests` 找全）→ `archive/tests/`
- Modify: `kit/src/main.js`（去掉 `live`、`guided` 两种 mode 和舞台的样式拼接）、`kit/src/blocks/index.js`（去掉 `stagedrill`、`huoban`）、`kit/src/memory/desk.js`（去掉开舞台课、一问一答、实时黑板、自学单元的入口和 `?dev&form=`；`classForm` 只剩 `'class'`）、`kit/src/class/classroom.js` 和 `kit/src/class/prompt.js`（删 `TALK` 分支和 `buildTalkSystem`）、`kit/src/memory/report.js`（不再 import `stage/scenes.js`，舞台课报告的 `scenes` 不再算）、`kit/src/exam/bar.js`（不再 import `stage/stage.js` 的 `HELP`，把用到的那一句写在本文件）、`kit/src/memory/drills.js`（不再挑 `src: stage` 的题）、`kit/src/memory/pages.js` 和 `desk.js` 的只读翻看、混用的测试（`subject.test.js`、`memory-drills.test.js`、`class-exam.test.js`、`exam-*.test.js` 里用到搬走模块的用例删掉）、`package.json`（删 `check:stage`、`cost:stage`）、`.github/workflows/test.yml`（去掉查实时黑板页的那一步）、`tools/desk-e2e.mjs`（删 `talk` `talkfix` `stage` `stagestuck` `stagedrill` `outside` 几段，搬进 `archive/tools/desk-e2e-old.mjs`）
- Create: `kit/src/memory/oldview.js`：旧课只出文字的那一页

**Interfaces:**
- Produces: `oldText({ session, report, turns }): string`（纯函数，下面画面用的那段文字）；`oldKind(session): boolean`（`kind` 是 `stage` / `talk` / `live` / `unit`，或带 `aide`）；`renderOldClass(el, { session, report, turns })`：画标题、日期、「这种课的画面已经停用，下面是文字记录」、课后报告的 `reportText`、每一轮的话（`class_turns` 的 `text` / 舞台的 `say` 原文）。`#view/c-…` 和「以前的课」点进去遇到 `oldKind` 走它。

- [ ] **Step 1: 写测试** `tests/memory-oldview.test.js`：`oldKind({kind:'stage'})`、`oldKind({kind:'talk'})`、`oldKind({kind:'live'})`、`oldKind({kind:'unit'})` 为真，`oldKind({kind:'class'})`、`oldKind({})` 为假；`oldText({ session:{title:'时态'}, report:null, turns:[{role:'assistant', text:'甲'}] })`（`renderOldClass` 拆出的纯函数）含「画面已经停用」和「甲」。
- [ ] **Step 2:** 跑它，看它失败。
- [ ] **Step 3:** 写 `archive/README.md`，`git mv` 上面的文件，改引用，写 `oldview.js`。
- [ ] **Step 4:** `grep -rnE "stage/|huoban|live/(live|livebar|ops|layout|devpanel)|guided\.js|stagedrill" kit/src tests tools package.json .github` 只剩 `archive/` 外的零条（`live/store.js`、`live/sync.js` 不算）。
- [ ] **Step 5:** `npm test` 全过；`npm run build`；`npm run check:pages`。
- [ ] **Step 6:** e2e 加一段 `oldclass`：示例记忆里塞一节 `kind:'stage'` 的课和它的两轮 `class_turns`，从「以前的课」点进去，`.dk-oldclass` 里有「画面已经停用」和那两轮的话；`meta/errors` 不多。跑 `npm run e2e`。
- [ ] **Step 7: 提交** `git commit -m "舞台课、一问一答、实时黑板、自学单元搬进 archive/：被迭代掉的功能；旧课只出文字"`。

### Task 4: 笔记本的纯函数

**Files:**
- Create: `kit/src/project/notebook.js`
- Test: `tests/project-notebook.test.js`

**Interfaces:**
- Produces（全是纯函数）：
  - `NOTE_HISTORY = 20`
  - `notePath(p: string): string`：去首尾空白和开头的 `/`，连续 `/` 合一；空、含 `..`、超过 200 字符抛错。
  - `noteId(path: string): string`：path 的 UTF-8 做 base64url（`A-Za-z0-9-_`），能当 artifact 的 doc id。
  - `applyNoteOp(doc: object|null, op: {kind, path, text?, old?, new?, line?, to?, pin?, show?, order?}, { at, by }): { doc, error? , moved? }`，`kind` 是 `create` `str_replace` `insert` `delete` `rename` `set` `restore`。规则：`create` 已存在且没删就报错「已经有了，用 str_replace」；`str_replace` 的 `old` 恰好出现一次才改，否则 `error`；`insert` 在第 `line` 行后插（0 是开头）；`delete` 只标 `deleted: true`；`rename` 返回 `moved: 新 path`；每次改了 `text` 都把旧版压进 `history`（最多 `NOTE_HISTORY` 条，新的在前）、`v + 1`、写 `at` `by`。
  - `pinnedText(docs: object[], room: number): { text: string, used: number, skipped: {path, bytes}[] }`：`pin` 且没删的，按 `order`（小的先，没写的排后）再按 `at` 新的先，整份原文放进去，每个前面一行 `### 笔记：{path}`；放不下的进 `skipped`。
  - `notebookDir(docs): string`：每个没删的一行「path · N 字节 · pin / show · 日期」。
  - `parseNoteBlock(body: string): { ops: op[], errors: string[] }`：`board note` 块的写法（见下）。
  - `quoteNotes(text, corpus): string[]`：`project/quotes.js` 的 `checkQuotes` 找不到的那些。
- `board note` 块写法（写进任务 10 的工具手册，原样）：

```
create 学生/底子.md
<<<
正文……
>>>
str_replace 学生/底子.md
<<<
旧的一段
===
新的一段
>>>
insert 学生/底子.md 3
<<<
插进去的
>>>
rename 学生/底子.md 学生/背景.md
delete 草稿.md
set 学生/背景.md pin=on order=1 show=off
```

- [ ] **Step 1: 写测试**（每条一个 `test`）：`notePath(' /学生//底子.md ') === '学生/底子.md'`；`notePath('../x')` 抛错；`noteId` 只含 `[A-Za-z0-9_-]` 且同一 path 两次相同；`str_replace` 的 old 出现两次 → `error` 含「出现了 2 次」且 `doc.text` 没变；改 21 次后 `history.length === 20`；`delete` 后 `doc.deleted === true`、`text` 还在，`restore` 回来；`pinnedText` 两个 pin 文件 room 只够一个时 `order=1` 的进 `text`、另一个进 `skipped`；`parseNoteBlock` 解析上面那段写法得到 6 个 op、`errors` 空；缺 `>>>` 的报错；`quoteNotes('学生说「换一个高效点的测验」', '……换一个高效点的测验……')` 是空数组，引号不在 corpus 里的返回那一句。
- [ ] **Step 2:** 跑 `node --test tests/project-notebook.test.js`，看它失败。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 跑测试通过。
- [ ] **Step 5: 提交** `git commit -m "笔记本的纯函数：路径、操作、版本、pin 的装法、块的写法"`。

### Task 5: 笔记本的数据库那一层，记忆库多两类

**Files:**
- Create: `kit/src/project/notebookdesk.js`
- Modify: `kit/src/memory/schema.js`（`COLLECTIONS` 加 `notebook`、`notebook_review`；角色 `class` `head` `page` `me` 能写 `notebook`（`by` 取 `class` `head` `after` `organize` `me`；课后那一轮和整理以 `head` 的身份过 `assertWrite`），`page` 能写 `notebook_review`；`meta/instructions` 只有 `me` 能写——照 `assertWrite` 现有的写法加）、`kit/src/memory/backup.js`（备份带这两类和 `meta/instructions`）
- Test: `tests/project-notebookdesk.test.js`（用现有测试里的内存假数据库写法，`grep -l "fakeDb\|memDb" tests` 照抄）、`tests/memory-backup.test.js` 加一条

**Interfaces:**
- Consumes: 任务 4 的 `applyNoteOp`、`noteId`、`quoteNotes`；`memory/writer.js` 的 `guardDb`。
- Produces: `createNotebook({ db, getDocs: () => object[], corpus: () => string }) → { run(op, { by }): Promise<{ ok, error?, path }>, runAll(ops, { by }): Promise<result[]>, docs(): object[] }`。同一个 path 的写排队；`rename` 写新 id、旧 id 标 `deleted` 并记 `movedTo`；每次写完把 `quoteNotes` 的结果存在那一版的 `quotes`（只记不拦）。

- [ ] **Step 1: 写测试**：`run({kind:'create', path:'a.md', text:'x'}, {by:'head'})` 后假库里 `notebook/{noteId('a.md')}` 有 `text:'x', by:'head', v:1`；两个 `str_replace` 同时发（`Promise.all`），第二个基于第一个的结果，最后的 `text` 两处都改了；`assertWrite('page', 'meta', …instructions…)` 抛错、`me` 不抛；备份 JSON 里有 `notebook`。
- [ ] **Step 2:** 跑，看它失败。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 跑通过；`npm test`。
- [ ] **Step 5: 提交** `git commit -m "笔记本存进记忆库：排队写、留版本、核引号只记"`。

### Task 6: 读和搜的工具（班主任、老师、后台那几轮共用）

**Files:**
- Create: `kit/src/project/search.js`（纯函数）、`kit/src/project/tools.js`
- Modify: `kit/src/head/headdesk.js`（`read`、`list`、`search_chats` 换成 `projectTools` 给的；`memory_read` 留着）
- Test: `tests/project-search.test.js`、`tests/project-tools.test.js`

**Interfaces:**
- Consumes: 任务 5 的 `createNotebook`。
- Produces:
  - `searchDocs(sources: {path, text}[], q: string, { limit = 30 }): {path, snippet, score}[]`：q 按空白切词，大小写、全半角不分（照 `textfind.js` 的规范化）；每个词命中加 1、整句命中再加 2；`snippet` 是第一个命中前后各 60 字。
  - `READ_MAX = 32 * 1024`；`projectTools({ db, getData, notebook, chats, turnsOf, write: boolean, used: object[] }): tool[]`，工具名和输入：`read { path, offset? }`（超 `READ_MAX` 给前一段和 `{ more: 剩多少字节, next: offset }`）、`list { collection, field?, value?, cursor? }`（一页 50 条，`next` 游标）、`search { q, in? }`（`in` 取 `books` `exam` `evidence` `turns` `chats` `notebook` `old` 中的几个，默认全部；`old` 是旧记忆的 rules lessons asks profile slips observations summary）、`notebook { op… }`（`write` 为假时只认 `view`）。工具的 `description` 只写做什么、读一次要多一轮（事实）。

- [ ] **Step 1: 写测试**：`searchDocs([{path:'a',text:'希尔排序的增量'},{path:'b',text:'冒泡'}], '希尔 增量')[0].path === 'a'`；全角「ＡＢ」能搜到「ab」；`read` 一条 40 KiB 的文档返回 `more > 0` 和 `next`，带 `offset: next` 再读拿到剩下的；`notebook` 工具在 `write:false` 时 `create` 返回错误「这里只能 view」；`used` 里记了每次调用。
- [ ] **Step 2:** 跑，看它失败。
- [ ] **Step 3:** 实现；班主任改用它。
- [ ] **Step 4:** `npm test`；`npm run e2e -- --only chat`。
- [ ] **Step 5: 提交** `git commit -m "项目 Claude 的读和搜：任何一条、任何一类、按字找全学习台"`。

### Task 7: 项目指令和笔记本的画面

**Files:**
- Create: `kit/src/project/notebookview.js`
- Modify: `kit/src/memory/desk.js`（「管理」加「项目指令」「笔记本」两段；导航加一页「笔记」`#notes`）、`kit/src/memory/desk.css`
- Test: `tests/project-instructions.test.js`；e2e 加一段 `project`

**Interfaces:**
- Consumes: 任务 5。`render.js` 的 `renderLesson`（画 show 的文件，组件照常）；`live/sync.js` 的 `createSink(store, { evidence })`（作答记成证据，`session: 'note'`）；`class/charter.js` 的 `CHARTER` 全文（只读给学生看、可复制）。
- Produces: `instructionsDraft(quotes: {text, at}[]): string`（纯函数：一行一句「YYYY-MM-DD：原话」，草稿不存）；`meta/instructions = { text, at, by:'me', history }`（`history` 最近 20 版）。

- [ ] **Step 1: 写测试** `instructionsDraft([{text:'老师把内容讲透，我来学', at: Date.parse('2026-11-16')}])` 含「2026-11-16：老师把内容讲透，我来学」，不含「必须」。
- [ ] **Step 2:** 跑，看它失败。
- [ ] **Step 3:** 实现画面：项目指令一个文本框（16px）+「存」「看以前的版本」，下面收起的「以前的根本规则（开发写的，想要哪句自己抄）」；笔记本目录（每行 path、大小、pin/show、日期）→ 点开全文可改（存成 `by:'me'`）、以前的版本、退回、恢复删掉的、引号没找到的那几句标出来；「笔记」页列 show 的文件，点开照课件画；「管理 → 笔记本」底下一个开关「每周换一个 Claude 通读一次」（存 `meta/project.review: true|false`，默认开，任务 11 读它）和最近几份通读的结果。草稿的原话由开发在任务 13 里填进 `instructionsDraft` 的调用处（取学生第十二～十四轮设计文档里引的原话）。
- [ ] **Step 4:** e2e `project` 段的前半：管理页写项目指令、存、刷新还在；假数据里放一个 `show:true` 的文件（含一个 `quiz`），「笔记」页打开能作答，`evidence` 多一条 `session:'note'`。
- [ ] **Step 5: 提交** `git commit -m "管理页：项目指令、笔记本；导航多一页「笔记」"`。

### Task 8: 拼说明的纯函数

**Files:**
- Create: `kit/src/project/system.js`
- Test: `tests/project-system.test.js`

**Interfaces:**
- Consumes: 任务 4 的 `pinnedText`、`notebookDir`。
- Produces: `projectSystem({ facts: { today, version, examDays, target }, instructions: string, notes: object[], toolsDoc: string, sections: { title, text }[], max: number }): { text, sizes: { total, instructions, pinned, sections }, skipped }`。顺序：身份事实一段（「你是学生学习台里的 Claude。学生在准备……，还有 N 天。今天……；学习台版本……」）→ `# 学生写的项目指令`（原样；空就写「（学生还没写）」）→ `# 你的笔记本`（pin 的原文、目录、`notebook_review` 最近一份的路径、一行用量「这一轮说明一共 X KB：项目指令 a、笔记 b、其余 c；上限 SYSTEM_MAX」）→ `# 工具` → 传进来的 `sections`。pin 的 room = `max` − 其余各段。笔记本为空时那一段写「笔记本还是空的，以前的记录在：…」（列旧的那几类和条数，`getData` 给）。发出去前对页面拼的那几段做 `neutral`。
- `FORBIDDEN = ['你应该', '必须', '根本规则', '以它为准', '照做']`（只查页面拼的那几段，不查学生的指令、笔记、`sections`）。

- [ ] **Step 1: 写测试**：项目指令出现在身份段之后、笔记之前，原样（含一个「必须」也照留）；页面拼的部分不含 `FORBIDDEN` 任何一个；`max` 很小时 `skipped` 非空、`text` 字节数 ≤ `max`；没有 pin 时用量那一行 `pinned 0`；笔记本空时含「笔记本还是空的」；身份段不含「他」「她」。
- [ ] **Step 2:** 跑，看它失败。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 跑通过。
- [ ] **Step 5: 提交** `git commit -m "项目 Claude 每一轮的说明：事实、学生的指令、它的笔记本、工具"`。

### Task 9: 班主任换成项目 Claude

**Files:**
- Modify: `kit/src/head/context.js`（删 `WHO`、`HOW`、`MEMO_HEAD`、`MEMO_HEAD_SUMMARY`、三科简报、预测分、下一步、这一周那几段；`headSystem` 改成调 `projectSystem`，`sections` 只放「怎么记学习的账（memo 块写法，手册）」）、`kit/src/head/headdesk.js`（工具 `projectTools({ write: true })` + `memory_read`；写笔记本走工具）、`kit/src/memory/desk.js`（`headCtx` 传 `instructions`、`notes`、`facts`）
- Test: `tests/head-context.test.js`（改）、e2e `chat` 段

**Interfaces:**
- Consumes: 任务 6、8。
- Produces: `headSystem({ facts, instructions, notes, getOld })` → `projectSystem(…)` 的 `text`。

- [ ] **Step 1: 改测试**：说明里有学生写的指令、pin 的笔记；没有「班主任」的身份段、没有「学生的要求」「三科简报」；笔记本空时含「笔记本还是空的」（Review Focus 第 1 条）。
- [ ] **Step 2:** 跑，看它失败。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** `npm test`；`npm run e2e -- --only chat,project`（e2e `project` 段加：模拟班主任（`?dev` 的 `books/devmock.js` 认暗号「测试:笔记」）用工具建一个 pin 的文件，下一轮说明里有它）。
- [ ] **Step 5: 提交** `git commit -m "班主任就是项目 Claude：学生的指令、它的笔记本、读搜写工具"`。

### Task 10: 课堂的老师换成项目 Claude

**Files:**
- Modify: `kit/src/class/prompt.js`（有学习台时 `buildSystem` 走 `projectSystem`：`sections` = 组件写法和黑板指令、这节课的资料（`packText`，标来源）、这一块在考试里、黑板现状；删「角色和根本规则」「你对学生的了解」「在学习台里上课」里的记忆块说明；`PROTOCOL_DOC` / `EYE_DOC` / `CANVAS_DOC` / `AIMS_DOC` / `MSG_*` 逐句过：讲做法的删（至少「板顶的话只是一两句招呼」、常驻栏「要短，一条两三行；不放题」、卡住「只轻轻问一句……不讲答案、不换板」）；`AIMS_DOC` 改成「可以用」的写法；`board plan` 和 `PLAN_DOC` 删；工具手册加 `board note` 块写法（任务 4）和学习的账的 memo 写法；`closingPrompt` 换成 `closingFacts({ review, opening }): string`）、`kit/src/class/protocol.js`（认 `board note` 块：op 类型 `note`，`body` 原样）、`kit/src/class/classroom.js`（一轮讲完后 `notebook.runAll(parseNoteBlock(body).ops, { by: 'class' })`；失败的照 memo 被拒那样下一轮告诉它；`TEACH` 照旧；第一次调用没 `board aims` 不提醒）、`kit/src/class/stuck.js`（提醒的话只写事实「学生在当前板上 N 分钟没有动静，题还没做」）、`kit/src/memory/desk.js`（开课时把 `instructions`、`notes` 交给课堂）、`kit/src/class/charter.js`（不再被课堂 import，只给管理页显示）
- Test: `tests/class-project.test.js`（新）、`tests/class-charter.test.js`（搬进 `archive/tests/`）、受影响的课堂测试照新说明改

**Interfaces:**
- Consumes: 任务 4、5、8。
- Produces: `closingFacts({ review: {id,title}[] , opening: {id,title}[] }): string`（「学生点了下课。」+ 有复现时「这节课复现的组：…；复现结果写 `review id=… result=…` 页面才会记。」）。

- [ ] **Step 1: 写测试**（`tests/class-project.test.js`）：有学习台时整份说明有学生的指令、pin 的笔记、组件说明、黑板现状；不含 `CHARTER` 的第一句、不含「你对学生的了解」、不含上面三句做法；`buildSystem` 结果 ≤ `SYSTEM_MAX`；`parseBlocks` 认 `board note` 块；`closingFacts({review:[{id:'R3',title:'特征值'}]})` 含「R3」和「review id=」、不含「小结」「整理单」；`board note` 里 `str_replace` 对不上时下一轮发出去的第一条含「笔记没改成」和那个 path（Review Focus 第 3 条）。
- [ ] **Step 2:** 跑，看它失败。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** `npm test`（没有学习台的单独课堂说明那几条 sha256 测试照旧过）；`npm run e2e -- --only class,aims,root,quiet,classexam,project`（`project` 段加：开课，模拟老师用「测试:笔记」写 `board note` 建一个 pin 文件，下一轮说明里有它；说明里没有根本规则）。
- [ ] **Step 5:** 开发通读一份用 `kit/examples/desk-demo.html?dev` 的示例记忆拼出来的完整说明（`window.LAKitDevAI` 里最近一次），把还在讲做法的句子列出来删掉，删完再跑一遍。
- [ ] **Step 6: 提交** `git commit -m "课堂的老师就是项目 Claude：学生的指令和它的笔记本；开发写的做法拿掉"`。

### Task 11: 课后那一轮、第一次整理、每周通读

**Files:**
- Create: `kit/src/project/after.js`（纯函数）、`kit/src/project/afterdesk.js`
- Modify: `kit/src/memory/desk.js`（`backTick` 改成：第一次整理 → 课后那一轮（早的先）→ 每周通读；摘要重写、话的账、`aideDesk`、`fixDebriefs` 不再调度）、`kit/src/memory/lab.js` 和 `kit/src/books/plan.js`（`prepMemory`、补收尾：笔记本不空时带 `pinnedText`，空时照旧）
- Test: `tests/project-after.test.js`；e2e `project` 段后半、`idle` 段

**Interfaces:**
- Consumes: 任务 5、6、8；`ai.call(input, { model: 'claude-opus-5-5', effort: 'high', lane: 'bg', tools })`。
- Produces（`after.js`）：
  - `AFTER_FAILS = 2`；`REVIEW_DAYS = 7`
  - `needsAfter(session, { since: number }): boolean`：`kind` 是 class（或没写）、`status: 'closed'`、`endedAt > since`、没 `deleting`、`after?.at` 没有、`(after?.fails || 0) < AFTER_FAILS`。`since` 是 `meta/project.since`（第一次整理做完的时间；没做完就是无穷大，课后那一轮不跑）。
  - `afterPrompt(session): string`：只写事实——「这节课（{title}，{date}）结束了。课后报告在 sessions/{id}/report/main，每一轮在 sessions/{id}/class_turns，作答在 evidence（session = {id}）。」
  - `needsOrganize(notes, meta): boolean`：笔记本里没有没删的文件且 `meta/project.since` 没有。
  - `organizePrompt(counts: {collection, n}[]): string`：「笔记本还是空的。学习台以前的记录在这些地方：…（每类几条）。」
  - `reviewDue(lastAt, now, on = true): boolean`：开关开着、笔记本不空且距上次 ≥ `REVIEW_DAYS` 天。
  - `reviewPrompt(): string`：「你没有对话历史。请读笔记本和原始记录，回一份：哪些过时了、哪些互相矛盾、哪些可能是从一句话推广出来的、哪些原话在记录里找不到。不要改笔记本。」（这是给通读那一轮的任务本身，按设计 6.5，不算替老师定做法。）
- `afterdesk.js`：`createAfter({ db, ai, tools, system })` → `{ organize(), after(sid), review() }`；回的不是 Opus 就作废、`sessions/{id}.after = { fails + 1 }`；成了写 `{ at, model }`；整理成了写 `meta/project.since = Date.now()`；通读写 `notebook_review/{YYYY-MM-DD}` = `{ text, at, model }`。三种调用都用 `projectSystem`（没有对话历史，用户消息就是 `*Prompt()` 的那一句）。

- [ ] **Step 1: 写测试**：`needsAfter` 下了课、`endedAt` 在 since 之后 → 真；`after.at` 有了 → 假；`fails: 2` → 假（Review Focus 第 4 条）；`since` 没有 → 假；`afterPrompt` 含课号和三个路径、不含 `FORBIDDEN`；`needsOrganize([], {})` 真、有一个文件时假；`reviewDue(Date.now() - 8 * 864e5, Date.now())` 真、6 天假、`on=false` 时假。
- [ ] **Step 2:** 跑，看它失败。
- [ ] **Step 3:** 实现；`?dev` 的模拟模型对这三种提示各回一段并用工具建一个文件（`books/devmock.js`）。
- [ ] **Step 4:** `npm test`；e2e `project` 段后半：开首页 → 后台整理建了文件、`meta/project.since` 有了 → 上一节课下课 → 回首页，`sessions/{id}.after.at` 有了 → 模拟时间过 8 天，`notebook_review` 多一份；`idle` 段：挂 12 小时的课下课后也有 `after`。跑 `npm run e2e`。
- [ ] **Step 5: 提交** `git commit -m "课后那一轮、第一次整理、每周通读：页面只给机会，做什么由项目 Claude 定"`。

### Task 12: 记忆的旧流程搬进 archive/，学习的账只记不拦

**Files:**
- Move（`git mv` 到 `archive/` 同路径）：`kit/src/memory/said.js` `saiddesk.js` `summarydesk.js` `summaryview.js` `debrief.js`、`kit/src/aide/`（`aide/schema.js` 留着：备份和读旧数据要认它）、相应测试（`memory-said*`、`memory-summarydesk`、`memory-debrief`、`aide-*`、`memory-asks`、`stage-memo-*` 已搬、`exam-debrief`、`memory-idle-after`、`memory-base-review` 里属于这些的用例）、e2e 的 `asks` `aide` `summary` `membase` 段
- Modify: `kit/src/memory/summary.js`（只留读旧摘要用得到的 `summaryText`；重写的函数搬走）、`kit/src/memory/digest.js`（课堂不再用；`lab.js` / `prepMemory` 笔记本空时还用它，留着）、`kit/src/memory/memops.js` 和 `memo.js`（守卫判 `reject` / `hold`、相似度判「同一件事」的，改成照写并在那一条记 `guard`，`guard_log` 照记）、`kit/src/memory/sentry.js` `labdesk.js`（不再开 `said`、`after`、`card` 单子）、`archive/README.md`（表上加这一批）
- Test: `tests/memory-memo.test.js` 等受影响的照新行为改

**Interfaces:**
- Produces: 无新接口。`applyMemo` 的返回里被拒的那一栏只剩格式写不进去的（编号、必填）；原来因为守卫或相似度不收的现在在 `flagged` 里。

- [ ] **Step 1: 改测试**：以前「几乎照抄已有的不收」的用例改成「收下、`flagged` 里有、那一条带 `guard`」。
- [ ] **Step 2:** 跑，看它失败。
- [ ] **Step 3:** 搬文件、改引用、改行为；`grep -rnE "said(desk)?\.js|summarydesk|summaryview|debrief\.js|kit/src/aide/(after|card|brief|watch|watcher|moves|fill|aidedesk|load)" kit/src tests tools` 在 `archive/` 外为零。
- [ ] **Step 4:** `npm test`；`npm run build`；`npm run e2e`。
- [ ] **Step 5: 提交** `git commit -m "记忆的旧流程搬进 archive/：话的账、摘要重写、复盘、课后助手；学习的账只记不拦"`。

### Task 13: 定总量、写文档、发布

**Files:**
- Modify: `kit/src/class/prompt.js`（`SYSTEM_MAX` 照 `meta/speed` 量出来的定：大说明出第一个字比 160 KB 多不到 1 秒就取量过的最大那档，否则留 160 KiB；注释写量的日期和数）、`tests/subject.test.js`（资料包至少留多少跟着新总量算）、`CLAUDE.md`（加第十四轮一条：做了什么、`archive/` 里有什么；舞台、一问一答、实时黑板、自学单元、话的账、摘要、助手那几条标「已搬进 archive/」）、`CLAUDE-PROJECT.md`（第一节自学单元、第五节实时黑板删成一句「已停用」；第七节写笔记本、项目指令、谁读什么；版本号 `2026-11-17b`）、`docs/root-handoff.md`（换成这一轮的交接）、`docs/superpowers/specs/2026-11-17-project-claude-design.md`（9.1 第 8 条写上量出来的数）、`kit/src/project/notebookview.js` 里 `instructionsDraft` 的原话清单
- Test: 全部

- [ ] **Step 1:** `ArtifactData get meta/speed` 读学生跑的结果，定 `SYSTEM_MAX`；没跑就留 160 KiB 并在交接里写明。
- [ ] **Step 2:** 改文档和版本号；`npm test`；`npm run build`；`git status` 只剩这次改的；`npm run e2e` 全过。
- [ ] **Step 3: 提交并推** `git commit -m "第十四轮：项目 Claude（版本 2026-11-17b）"`，`git push -u origin claude/determined-newton-dz9hrz`，再 `git push origin HEAD:main`（快进）。
- [ ] **Step 4: 发布学习台**：`Artifact` publish `kit/desk.html` 到学习台的 URL，`files`：`la-kit.js` ← `kit/dist/la-kit.js`、`CLAUDE-PROJECT.md` ← `kit/dist/docs/CLAUDE-PROJECT.md`、`components/*.md` ← `kit/dist/docs/components/`（变了的才传）；`capabilities` 不传。
- [ ] **Step 5:** 告诉学生：去「管理 → 项目指令」看开发列的原话草稿，删改后存；第一次整理会在打开首页后在后台做；然后上一节真课。开发读那节课、课后那一轮写的笔记、`notebook_review`。
