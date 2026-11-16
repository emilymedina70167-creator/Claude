# 记忆底座做扎实（第十三轮第 2 批）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「记忆摘要」从主干换过去做到没有漏处、验得住：旧规矩不再从任何一条路绕回课上，摘要里的原话核得上，连着重写十来次不丢事实、不长规矩。

**Architecture:** 不加新机制。照清点表（`docs/superpowers/specs/2026-11-16-memory-audit.md` 第二、三节）一处一处补：凡是给模型拼说明的地方，有摘要时一律走摘要、不再另塞旧五类；凡是模型写回来的记忆块，一律先过 `splitKnow`。新增两样：页面把这节课学生打的原话一直放在说明里（照抄证据，不调用）；重写回来的摘要里引的原话要在记录里找得到。再加一把连着重写的尺子。

**Tech Stack:** 现有的 `la-kit`、`node --test`、Playwright e2e。不加依赖。

**Spec:** `docs/superpowers/specs/2026-11-16-mirror-design.md`（方向）、`docs/superpowers/specs/2026-11-16-memory-audit.md`（清点表，本计划照它做）。

**执行方式：** 主控自己一件一件做，每件做完跑测试再做下一件。任务 8 的尺子要请真模型约 10 次（每次一份 40 KiB 上下的提示词）；任务 10 请一个没参与的助手只读地通读一遍。别的不调用模型。

## Global Constraints

- 注释、界面文字、提交说明、提示词用简体中文；发给模型的字里提到学生不用「他」「她」。
- 没有摘要时一切逐字照旧（`tests/memory-digest-summary.test.js` 的快照、`tests/class-charter.test.js` 的 sha256 一直绿）。
- 不删任何旧数据；不删旧代码（话的账、守则那几条路留着，没有摘要的记忆库还走它）。
- 往摘要、往老师的说明里加的只能是事实和学生的原话，不加规矩。
- 记忆那一节 ≤ 28 KiB、整份说明 ≤ 160 KiB；回话不变慢（不加工具轮、不在出第一个字之前多等）。
- 后台调用 `lane: 'bg'`、只认 `claude-opus-5-5`。
- 每个任务结束 `npm test` 全过；任务里不提交 `kit/dist/`，最后统一构建。私人数据放 `.superpowers/`，不进 git。

## Review Focus

1. 一节长课里学生第 10 分钟说的一句话，对话被压缩以后老师还看不看得到。（任务 4）
2. 重写时把学生的话改了几个字、或者编了一句：这一份不能写进摘要；但老师讲解的转述、书名、术语上的引号不能把正常的重写全拦下。（任务 5）
3. 教研室补收尾写回来的是老写法（`lesson` `slip` `ask`）：要进新笔记，不能再写进旧的几类，也不能丢。（任务 2）
4. 记忆库里既有摘要又有旧规则（就是我现在的库）：备课、补收尾、班主任三处的说明里一条旧规则都不能有；没有摘要的库这三处照旧。（任务 1、2、3）
5. 摘要顶到上限以后连着几节课都写不进去。（任务 8 的尺子要量到）

---

### Task 1: 备课不再另塞规则和守则

**Files:** Modify `kit/src/books/planview.js`（拼备课材料的那一段，约 :114–:126）、`kit/src/memory/lab.js`（教研室的备课单子 `prepBrief` 用的同一份材料）；Test `tests/books-plan-summary.test.js`（新）。

**Interfaces:** `planview.js` 里抽一个纯函数 `prepMemory(data, { block, space, today }) → { memoryText, rulesText, lessons }`（放 `kit/src/books/plan.js`，导出）：有摘要（`summaryOn(data)`）时 `rulesText = ''`、`lessons = ''`，`memoryText` 是 `memoryDigest(…, { use: 'all' })` 的字（里面已经是摘要 + 记录的制度）；没有摘要时和现在逐字一样。首页备课和教研室的备课单子都改成用它。

- [ ] 写测试：有摘要的库 `prepPrompt` 出来的字里没有任何一条旧规则、守则的原文，有摘要全文和「记录的制度」；没有摘要的库和改之前逐字一样（先存快照）。
- [ ] 跑，确认失败 → 实现 → `npm test` → 提交。

### Task 2: 教研室补收尾走新的下课提示和新笔记

**Files:** Modify `kit/src/memory/lab.js`（`backfillMaterial`）、`kit/src/memory/labdesk.js`（收补收尾的回答那一段）；Test `tests/memory-lab.test.js`（加）、`tests/memory-labdesk-summary.test.js`（新）。

**Interfaces:**
- `backfillMaterial(mem, …)`：`summaryOn(mem)` 时 `closingPrompt({ summary: true, … })`（不带 `slips`）、`memoDoc: SUMMARY_MEMO_DOC`。
- `createLabDesk({ …, summary })`（`desk.js` 传 `sumDesk`）：收到补收尾的整理单，先 `splitKnow(entries, { on: summary?.on() })`；`notes` 逐条 `summary.note({ text, space, session, by: 'lab' })`（`summary.js` 的 `noteOf` 认 `by: 'lab'`，管理页显示「课后补写的」）；`rest` 照旧 `applyMemo({ author: 'lab' })`。

- [ ] 写测试：有摘要时补收尾的单子里没有「归纳教学失误」「教学守则」，有 `know`；回答里写 `lesson` `slip` `ask` `know` 各一条 → 四条都进了那一科摘要的新笔记、`lessons` `slips` `asks` 三类一条没多；`error` `position` 照旧写进去。没有摘要时照旧。（Review Focus 3、4）
- [ ] 跑，确认失败 → 实现 → `npm test` → 提交。

### Task 3: 班主任的简报不列旧五类

**Files:** Modify `kit/src/memory/views.js`（`deskBrief`）、`kit/src/memory/digest.js`（导出 `SUMMARY_DROPS`）、`kit/src/head/headdesk.js`（`memory_read` 工具的说明：有摘要时不再点名 rules、profile、asks、lessons、slips，多一类 `summary`）；Test `tests/memory-brief-summary.test.js`（新）。

**Interfaces:** `deskBrief(mem, opts)`：`summaryOn(mem)` 时 `memoryCatalog(view, { …, skip: SUMMARY_DROPS })`。给外部 Claude 的那一份（不是 `forHead`）也一样。

- [ ] 写测试：有摘要时简报里没有「规则」「教学守则」「关于学生」那几节，弱点、错题、复现组、课程地图照旧；没有摘要时逐字照旧。
- [ ] 跑，确认失败 → 实现 → `npm test` → 提交。

### Task 4: 这节课学生打的原话一直在说明里

**Files:** Modify `kit/src/memory/summary.js`（纯函数）、`kit/src/memory/digest.js`（`memoryDigest` 多一个参数）、`kit/src/class/prompt.js`（`buildSystem` 透传）、`kit/src/class/classroom.js`（`memoryArg`）；Test `tests/memory-said-now.test.js`（新）。

**Interfaces:**
- `saidNow(turns, { max = 1536 }): string`（`summary.js`）：从这节课的轮次里取学生自己打的话（`role: 'student'` 的 `say`，去掉页面的快捷回答「继续。」「开始上课。」），一行一句「第 N 轮：原话」，新的在后；超过 `max` 字节从最早的丢（最后 6 句一定留），丢了写一句「更早的 k 句省略了」。没有返回 `''`。
- `memoryDigest(mem, { …, saidNow: string })`：有摘要而且 `saidNow` 不空时，在摘要后面放一节 `## 这节课学生打的话（原话，页面照抄的；这些是当面说的）`；有摘要时原来那节「这节课学生说的（只管这节课）」不再带（它是话的账写的，已经停了）。
- `classroom.js` 的 `memoryArg()`：`saidNow: saidNow(history.filter((t) => !t.discarded))`。只在有摘要时算。抢跑的指纹里它本来就在说明里，两边一样，不用另处理。

- [ ] 写测试：学生打了三句、中间夹着「继续。」→ 三句原话都在、快捷回答不在；四十句长话 → 不超 1536 字节、最后 6 句都在、写了省略几句；对话历史被压缩成摘要以后（传压缩过的 `turns` 给 `fitTurns`，但 `saidNow` 用的是完整的 `history`）早先那句仍在说明里。（Review Focus 1）
- [ ] 跑，确认失败 → 实现 → `npm test` → 提交。

### Task 5: 摘要里引的原话要在记录里找得到

**Files:** Modify `kit/src/memory/summary.js`、`kit/src/memory/summarydesk.js`；Test `tests/memory-summary-quotes.test.js`（新）。

**Interfaces（`summary.js`）:**
- `quotesIn(text): string[]`：正文里「…」括起来、去掉空白以后不短于 `QUOTE_MIN`（6）个字的每一段。
- `quoteFound(q, corpus: string): boolean`：两边都去空白、全角半角和大小写归一以后，`q` 整段在 `corpus` 里；或者 `q` 里有「…」「……」时每一段都在、先后不乱。
- `checkQuotes({ next, corpus }): { ok: boolean, missing: string[] }`：`next` 里每一段引号都 `quoteFound`。
- `summarydesk.js` 的 `rewrite()`：`corpus` = 上一版两份摘要全文 + 新笔记的 `text` 和 `quote` + 这节课的记录稿 + 学生打的每一句。两份里有找不到的引号 → 和「写长了」合成同一次重来：把它写的那一版还给它，列出找不到的那几句，「是原话就照记录抄，不是原话就去掉引号换成你自己的转述」；重来一次还有找不到的 → 这一份不收（`fail`），记进出错记录写明是哪几句。

- [ ] 写测试：照抄的原话过；改了两个字的不过；带「……」省略的按段过；书名、术语这种上一版摘要里本来就有的引号过；重来一次改好了就收、改不好不收而且上一版原样在。（Review Focus 2）
- [ ] 拿已有的真模型输出验：`rewrite/out.txt`（任务外的材料，在草稿目录）跑 `checkQuotes`，记下一共多少段引号、找不到几段、各是什么——看这条线会不会把正常的重写拦下。找不到的若是正常的转述，把 `QUOTE_MIN` 或归一的办法调到不误拦，再把调的理由写进注释。
- [ ] `npm test` → 提交。

### Task 6: 接着上的舞台课、一问一答也走新笔记

**Files:** Modify `kit/src/stage/classroom.js`（执行记忆块的那一处）；Test `tests/stage-memo-summary.test.js`（新）。一问一答走的是 `class/classroom.js` 的 `runMemo`，已经接了：加一条测试守着。

**Interfaces:** 舞台课收到记忆块的条目以后同样 `splitKnow(entries, { on: desk.summary?.on() })`，`notes` 进 `desk.summary.note(…)`。说明文字一个字不动（sha256）。

- [ ] 写测试 → 实现 → `npm test`（`tests/class-charter.test.js` 的 sha256 要绿）→ 提交。

### Task 7: 备份、恢复带着摘要

**Files:** Test `tests/memory-backup.test.js`（加一条）；有问题才改 `kit/src/memory/backup.js`。

- [ ] 写测试：有四份摘要（带 `notes`、`history`）的库导出再恢复，四份逐字一样；「只补缺的」不盖掉已有的摘要。
- [ ] 跑；不过就修 → 提交。

### Task 8: 连着重写的尺子

**Files:** Create `tools/summary-ruler.mjs`、`evals/memory/summary-facts.json`、`tests/summary-ruler.test.js`；Modify `evals/memory/README.md`、`evals/memory/results.md`。

**Interfaces:**
- `node tools/summary-ruler.mjs next <存数据的目录> --state <目录>`：照课的先后取下一节没并的课，用真的 `rewritePrompt`（第一节带 `legacyText`）拼出提示词写进 `<state>/NN.prompt.txt`，打印这是第几节、哪一科。
- `node tools/summary-ruler.mjs apply <state> NN <模型的回答文件>`：照页面同一套读回、核长度、核引号（任务 5），收下就更新 `<state>/summary.json`，不收照实记；每一步记一行：两份各多少字节、收没收、为什么、引号找不到几段。
- `node tools/summary-ruler.mjs score <state>`：出一张表——每一步的字节数；`summary-facts.json` 里每条事实从它该出现的那一节起每一步还在不在（一条事实 = 一个说明 + 一个正则 + 从哪节课起）；全文里「必须」「每次都」「一律」「务必」「以后都」各出现几次、出现在哪一句；有几步没收。
- `summary-facts.json`：不放私人原话，只放能公开的事实的正则（教材是哪本、考哪几门、用什么设备写、哪一科的哪类错反复出现……约 20 条）；带原话的那几条放 `.superpowers/` 下面的私有清单，`score` 两份都读。

**跑法（要请真模型，约 10 次）：** `ArtifactData list` 把十节真课的 `class_turns` 和证据存到 `.superpowers/`；从空的摘要开始，一节一节 `next` → 请一个不知情的 Opus 照提示词作答 → `apply`；最后 `score`。

**算数的标准：** 事实清单每一条从出现起一直在（丢一条就改提示词重跑那一段）；规矩词 0 处（引学生原话里的不算）；没有一步因为超长连着两次不收；引号找不到的 0 段。结果和这张表写进 `evals/memory/results.md`。

- [ ] 写工具和它的测试（用假的回答）→ `npm test` → 提交。
- [ ] 取数据、跑十步、`score`；不达标就改 `rewritePrompt`（只改措辞，不加规矩）重跑不达标的那一段；达标后把结果写进 `results.md` → 提交。

### Task 9: 整条流程的自动测试补三处

**Files:** Modify `tools/desk-e2e.mjs`（`summary` 一段后面加，或另起 `summary2`）。

- [ ] 有摘要的库：点「让 Claude 备课」→ 发给模型的字里没有旧规则原文；教研室交回一份补收尾（带 `lesson` 和 `know`）→ 新笔记多两条、守则没多；进「班主任」发一句 → 说明里没有「规则（」那一节；课上打两句话再多聊几轮 → 说明里「这节课学生打的话」两句都在。
- [ ] `npm run build`、`npm run e2e` 全过 → 提交。

### Task 10: 独立通读、发布

- [ ] 把四份带摘要时的完整说明各存一份到草稿目录：黑板课老师（一轮中间、下课那一次）、班主任、备课、教研室补收尾。
- [ ] 请一个没参与的助手只读地通读这四份，只找三样：旧规矩残留（哪一句是规则 / 守则 / 要求的原文或改写）、互相打架的话、页面对老师或对学生说的假话。它只交清单，不改代码。
- [ ] 清单里属实的逐条修（每条先写一条会失败的测试）；不属实的写一句为什么。
- [ ] 更新 `CLAUDE-PROJECT.md` 第七节（写明上课的老师不再读规则、守则、要求、关于我、失误；版本号）、`CLAUDE.md`、`docs/root-handoff.md`、清点表（每条标「做完」）。
- [ ] `npm run build`、`npm test`、`npm run e2e`、`npm run check:pages` 全过 → 合进 `main` → 发布 → 读一遍 `meta/errors`。
