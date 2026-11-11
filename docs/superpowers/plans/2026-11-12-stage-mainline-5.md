# 舞台主线第五轮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task（我自己在这个会话里一件件做，最后一次只读审查）. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 我第一次上希尔排序、时态、可交换和方阵的幂这三节舞台课时体验好；顺带把引擎的过程表、动词形式这两件通用件补上。

**Architecture:** 三节课各写成一幕幕试演放到真舞台上逐张截图看、当场修（不调用模型）。动词形式是纯函数 `verbs.js`，借「照拨盘挑一个」的写法 `{verb: …}` 接进 `pick.js`，句子、话、答案都自动跟上。引擎的过程表是纯函数 `enginetable.js`（引擎的 `table` / `variants` → 舞台表的格和答案），接在第三轮的表上。能动手的再接散列表、堆两类对应关系。

**Tech Stack:** 原生 JS（ES modules）、`node --test`、Playwright（`tools/stage-try.mjs`、`tools/desk-e2e.mjs`）。

**Spec:** `docs/superpowers/specs/2026-11-12-stage-mainline-5-design.md`

## Global Constraints

- 事实归页面、教学归老师：页面不做教学决定；不预制教学；发给老师的话不说假话、不静默失效、不用「他」「她」。
- 不写「页面懂某个算法」的规则文件；算法知识只从 `kit/src/engines/` 来；每类对应关系 `kit/src/stage/follows/*.js` ≤ 150 行，超了这一类跳过、记进 rulings、告诉我。
- 不为某一节课新造东西。
- `STAGE_TEACH + stageDoc(科目)` 每门课 ≤ 24576 字节（现在：数据结构 23845、操作系统 24506、组成原理 22696、计网 19912、线代 23785、英语 20634）。`node .superpowers/size.mjs` 量。
- 不用 `window.confirm / alert / prompt`；注释、报错、提交说明用中文；触控目标 ≥ 44px。
- 改了 `kit/src/`：`npm run build` 和 `node proto/stage/build.mjs`，提交 `kit/dist/la-kit.js`、`kit/dist/docs/`、`proto/stage/dist/stage-demo.js`。
- 提交用 `.superpowers/ci.sh "说明" 文件…`；推 `git push -u origin claude/admiring-cannon-4j7szs`；合并是快进 `git push origin HEAD:main`；不开 PR。
- **不跑模拟课、不调用模型**。检查从轻：每件事自己的测试和试演；发布前 `npm test`、相关验收表、e2e 相关的段；`npm run check:stage`、`npm run e2e` 全量、`npm run check:pages`、旧课重放 282 份、只读助手审，只在任务 18 各做一次。
- 自己定的事记在 `docs/superpowers/specs/2026-11-12-stage-mainline-5-rulings.md`；账本 `.superpowers/sdd/mainline5/progress.md`。

## Review Focus

设计没写、但我上课时最可能碰到的（每条的测试写在括号里那一个任务里）：

1. 老师把 `{verb: …}` 的格写成页面不认得的词（时间写 `past perfect`、主语写 `the boy`）：当场报并列出能写的，不照默认值悄悄拼（任务 7）。
2. 动词其实不规则但不在表里（`broadcast`、`overcome`）：页面会照规则拼错。现状里写明「照规则变的」；老师能自己给三种形式 `{verb: overcome/overcame/overcome | …}`；带前缀的（over- under- re- out- mis- fore- with-）先去前缀查表（任务 5、7）。
3. 引擎的表一格有几种对的写法、有小数（ASL 3.67）：舞台自己的 `sameValue` 会判错。引擎造的表用引擎那边判一格的函数（`stepperspec.js` 的 `cellRight`）（任务 12）。
4. 学生填到一半老师 `back`、同名重造表：引擎的信息要跟着（第四轮 `follow` 丢过一次）（任务 12）。
5. 10 行 12 列的表横屏时和题卡、话挤在一起，字缩到认不出：排版检查的「缩得太小」要报出来；走查时竖屏横屏都看（任务 12）。
6. 同一节课同一个引擎造了两张表：下课只抄最后一张（任务 13）。

---

## 文件

| 文件 | 负责 |
|---|---|
| `evals/stage-gaps/first/shell.txt` `tense.txt` `power.txt`（新） | 三节课的走查试演（每份几幕） |
| `tools/stage-try-lib.js`（改） | 验收表 `FIRST`、`NEW5` |
| `kit/src/stage/verbs.js`（新） | 不规则动词表、规则变化、拼谓语。纯函数 |
| `kit/src/stage/pick.js`（改） | `{verb: …}`：名字是 `verb` 的那一种「挑」 |
| `kit/src/stage/enginetable.js`（新） | 引擎的 `table` / `variants` → 舞台表。纯函数 |
| `kit/src/stage/types/table.js` `table.rules.js`（改） | `engine=` 的造法、按组比、认错法、上限 10×12 |
| `kit/src/stage/follows/hash.js` `heap.js`（新） | 散列表、堆的对应关系 |
| `kit/src/stage/types/tree.js` `tree.rules.js` `tree.view.js`（改） | 树上两个结点对调 |
| `kit/src/memory/stagedrills.js`、`kit/src/stagedrillspec.js`（改） | 引擎的表抄成舞台题 |
| `kit/src/stage/doc.js`（改） | 腾地方、新写法的行 |
| `evals/stage-gaps/new5/*.txt`（新） | 新写法的最小试演 |

---

## A · 希尔排序和课的前后（做完发布，数据结构可以先上）

### Task 1: 首课走查 · 希尔排序

**Files:**
- Create: `evals/stage-gaps/first/shell.txt`
- Modify: `tools/stage-try-lib.js`（表 `FIRST`）、走查里要修的文件
- Log: `.superpowers/sdd/mainline5/first-shell.md`

- [x] **Step 1：写这一节课。** 读 `evals/stage-gaps/ideal/D1.md`（希尔排序那一份）和 `stageDoc('数据结构')`，只照说明写（不看源码里说明没写的写法）。5～7 幕：① 摆一排数、问「直接插入排序这一排要挪几次」（`ask value`，接上次课）② 引出隔 5 个一组，学生点出第一组的两个（`ask pick`）③ `follow a sort shell gaps="5 3 1"`，学生按住拖做第一趟：一次做对的、组间拖错的（把别的组的数拖进来）、拖一半放回去的 ④ 第二趟、第三趟，带 `@a.right` 预写 ⑤ 走完以后问稳定性（两个 49 的先后，`ask pick`）⑥ 换一组 gaps 再走一趟的开头（重造）。写的时候哪里绕、哪里第一遍写错，记进 log 的「写法」。
- [x] **Step 2：演。** `node tools/stage-try.mjs evals/stage-gaps/first/shell.txt --shots .superpowers/first/shell`（竖屏横屏都演）。
- [x] **Step 3：一张张看截图、一条条读发给老师的。** 每一步照设计第 1 节的五样（画面、手、节奏、老师拿到的、写法）看，问题记进 log：`第几幕第几步 ｜ 哪一样 ｜ 问题 ｜ 怎么办`。
- [x] **Step 4：真手指。** 第一趟里「按住 0.35 秒拖到另一格」「拖一半放回去」「组间拖错」三下，照 `tools/stage-touch.mjs` 的写法在 `tools/stage-touch.mjs` 里加一段 `first-shell`，只跑这一段（`tools/stage-touch.mjs` 现在没有 `--only`：先加上，再 `node tools/stage-touch.mjs --only first-shell`）。
- [x] **Step 5：修。** 每个问题：小的直接修，配一条测试（放 `tests/stage-mainline5-first.test.js`）；属于 B～E 的记到那边的任务里；要大动的记进 rulings 说清楚不做的原因。
- [x] **Step 6：重演一遍，log 里每条都有着落。** 把这一幕里「必须出现的事实」写进 `FIRST` 表（每幕 2～4 条：到一趟说对、错法说像哪种、走完叫老师、预写的那一句演了），`node tools/stage-must.mjs evals/stage-gaps/first --table first` 过。
- [x] **Step 7：提交。**

### Task 2: 课的前后走一遍（开课 → 下课 → 报告 → 练一练的舞台题）

**Files:**
- Scratch: `.superpowers/first/around.mjs`（Playwright 脚本，不进 git）
- Modify: 走查里要修的（多半是 `kit/src/blocks/stagedrill.js`、`kit/src/styles.css`、`kit/src/class/ios.css`、`kit/src/stage/classroom.js`）

- [ ] **Step 1：脚本。** `kit/examples/desk-demo.html?dev`，iPad 竖屏 820×1180、上海时区、`window.confirm = () => false`；填入示例记忆 → 数据结构 → 开课（舞台）→ dev 老师的第一轮（含一行 `follow`）→ 做一趟 → 下课 → 报告 → 回首页 → 练一练 → 做舞台题（鼠标按住拖）→ 做完。每一站截图，白天（`ink`）晚上（`inknight`）各一遍，横屏再截舞台题那一页。
- [ ] **Step 2：看。** 等第一轮时屏幕上是什么；舞台题那一页的标题、按钮（「看这一趟该是什么样」「做不出来」）、做完的反馈像不像学习台别的页；晚上的颜色；横屏。问题记进 `.superpowers/sdd/mainline5/first-around.md`。
- [ ] **Step 3：修，重截，每条有着落。** 改了流程的在 `tools/desk-e2e.mjs` 的 `stagedrill` 段里加断言。
- [ ] **Step 4：`npm run e2e -- --only stagedrill,class`，提交。**

### Task 3: 发布（一）

- [ ] `CLAUDE-PROJECT.md` 版本改 `2026-11-12b`；`npm run build`、`node proto/stage/build.mjs`；`npm test`；`node tools/stage-must.mjs` 跑 `fix1 new2 new3 new4 first` 五张表。
- [ ] 提交、推分支、快进 `main`；发布学习台（`kit/desk.html` + `la-kit.js` + 瘦身说明 + `components/*.md`）和舞台试课；告诉我「数据结构可以上了」和这一批修了什么。

---

## B · 动词形式和时态那一节（做完发布，英语可以上）

### Task 4: 说明腾地方

**Files:** Modify `kit/src/stage/doc.js`；Test `tests/stage-doc.test.js`

- [ ] **Step 1：** `node .superpowers/size.mjs` 记下六门课现在的字节。目标（加新行之前）：操作系统 ≤ 23900、数据结构 ≤ 23200、线代 ≤ 23200。
- [ ] **Step 2：** 先压所有科目都带的那几节里说了两遍的话、例子里可有可无的字（一处一处改，改一处量一次）；不够再把一门课最不常用的一两种写法从说明里拿掉，改成写错时的报错里带正确写法（那个报错要先有：`grep` 确认，没有就补）。不删任何「这个不能做」「这个会报」的提醒。
- [ ] **Step 3：** `tests/stage-doc.test.js` 照旧过（每个写法的例子照抄能演）；`node tools/stage-must.mjs` 四张老表过（说明改了不影响它们，但确认没误删写法）。提交。

### Task 5: 动词的各种形式

**Files:** Create `kit/src/stage/verbs.js`；Test `tests/stage-verbs.test.js`

**Interfaces — Produces:**
- `IRREGULAR: { [原形]: [过去式, 过去分词] }`（约 200 个；两种写法的取一种：`got/got`、`learned`、`dreamed`、`proved/proved`、`shown`）
- `formsOf(base) → { base, s, ing, past, part, regular: boolean }`
  - `base` 可以是短语动词（`go on`：只变第一个词，后面照接）；可以是三段式 `overcome/overcame/overcome`（老师自己给，`regular: false`）
  - 不在表里先去前缀再查：`over under re out mis fore with un up` + 表里的词（`overcome → overcame`）
  - `be` 的 `s/past` 不在这里（任务 6 管人称）

- [ ] **Step 1：写失败的测试。** 断言（逐条写成 `assert.deepEqual`）：
  - 规则：`walk → walks walking walked walked`；`study → studies studying studied`；`play → plays playing played`；`stop → stops stopping stopped`；`plan → planning planned`；`visit → visiting visited`（不双写）；`prefer → preferring preferred`；`occur → occurred`；`refer → referred`；`offer → offered`；`open → opened`；`live → lives living lived`；`lie → lies lying`（表里 `lay lain`）；`die → dying died`；`agree → agreeing agreed`；`watch → watches`；`fix → fixes fixing fixed`（x 不双写）；`go → goes`；`do → does`；`have → has`；`panic → panicking panicked`。
  - 不规则：`go → went gone`；`write → wrote written writing`；`become → became become`；`run → ran run running`；`begin → began begun beginning`；`put → put put putting`；`read → read read`；`take → took taken`；`get → got got getting`。
  - 短语和前缀：`go on → goes on / going on / went on / gone on`；`overcome → overcame overcome`；`rewrite → rewrote rewritten`；`give up → gave up`。
  - 三段式：`formsOf('broadcast/broadcast/broadcast').past === 'broadcast'`、`regular === false`。
  - 表本身：每条两种形式都非空、全小写、没有重复的键。
- [ ] **Step 2：跑，看它失败。** `node --test tests/stage-verbs.test.js`
- [ ] **Step 3：实现。** 双写的规矩：单音节「辅音 + 一个元音字母 + 一个辅音字母（不是 w x y）」双写；多音节的只认一张重读在末尾的小表（`prefer refer occur admit commit permit submit omit regret begin forget control compel expel equip transfer` 等）；`-ic` 加 k。
- [ ] **Step 4：跑过，提交。**

### Task 6: 拼谓语

**Files:** Modify `kit/src/stage/verbs.js`；Test `tests/stage-verbs.test.js`

**Interfaces — Produces:**
- `TIMES = ['过去', '现在', '将来', '过去将来']`（别名 `past present future`）；`ASPECTS = ['一般', '进行', '完成', '完成进行']`（别名 `simple progressive perfect`、`perfect progressive`）；`MODALS = ['can','could','may','might','must','should','would','will','shall','ought to']`；`SUBJECTS = ['I','you','he','she','it','we','they','单','复']`
- `conjugate(base, { time = '现在', aspect = '一般', subject = '单', passive = false, negative = false }) → string`（`time` 也可以是一个情态动词）
- 拼不了的抛 `Error`（话给老师看）：不认得的时间 / 状态 / 主语（列出能写的）；完成进行的被动、将来进行和过去将来进行的被动（「这种说法一般不用：换成完成 / 进行」）

- [ ] **Step 1：写失败的测试。** 一张 `write`（主语 `单`）的全表逐格断言，主动 16 格：
  - 一般：`wrote / writes / will write / would write`；进行：`was writing / is writing / will be writing / would be writing`；完成：`had written / has written / will have written / would have written`；完成进行：`had been writing / has been writing / will have been writing / would have been writing`
  - 被动（一般、进行的过去和现在、完成）：`was written / is written / will be written / would be written / was being written / is being written / had been written / has been written / will have been written / would have been written`
  - 否定：`did not write / does not write / will not write / is not writing / has not written / had not been writing / is not written / was not being written / will not have been written`
  - 人称：`I` → `write / am writing / have written / was writing / do not write`；`they / 复` → `write / are writing / have written / were writing / do not write`；`you` → `are / were`
  - `be`：`is / was / will be / has been / is being`（单），`I am / I was`，`they are / were`，否定 `is not / was not / will not be`；`be` 的被动报错
  - `have`：`has / had / is having / has had / does not have`
  - 短语：`go on` 现在完成进行单 → `has been going on`；过去一般 → `went on`；将来完成 → `will have gone on`
  - 情态：`conjugate('go', { time: 'must', aspect: '完成' }) === 'must have gone'`；`should` 进行 → `should be going`；`can` 被动 `write` → `can be written`；否定 `must not go`、`can` 否定 → `cannot go`
  - 报错三种各一条（`assert.throws`，话里有能写的词）
- [ ] **Step 2：跑，失败。**
- [ ] **Step 3：实现。** 一条链：助动词链（will/would/情态 → have → be(进行) → be(被动)）+ 主要动词的形式；第一个助动词按时间和人称变；否定的 `not` 插在第一个助动词后面，没有助动词用 `do`。
- [ ] **Step 4：跑过，提交。**

### Task 7: `{verb: …}` 接进舞台

**Files:**
- Modify: `kit/src/stage/pick.js`、`kit/src/stage/scene.js`（`dial verb` 不许起这个名字；现状里那一句）、`kit/src/stage/types/sentence.js`（现状的一句）、`kit/src/stage/doc.js`（英语多几行）
- Test: `tests/stage-verb-pick.test.js`；试演 `evals/stage-gaps/new5/verb.txt`，表 `NEW5`

**Interfaces — Consumes:** `conjugate`、`formsOf`、`TIMES` `ASPECTS` `MODALS` `SUBJECTS`（任务 5、6）。
**Produces:**
- 写法：`{verb: 原形 | 时间 | 状态 | 主语 | 被动 | 否定}`，后面的格可以不写（默认 现在、一般、单、主动、肯定）。`parsePick` 已经把它读成 `{ name: 'verb', alts }`，不改读法，只在 `checkPick` / `pickNow` / `pickDeps` 里 `name === 'verb'` 走另一条路。
- 每一格（除了原形）：是场景里一个拨盘的名字 → 取它现在的词（`varText`）；不是 → 当词用。第 5、6 格认 `被动 / 主动 / passive`、`否定 / 肯定 / not`，或者拨盘。
- `verbNow(p, vars) → { text, base, time, aspect, subject, passive, negative, regular }`（pick.js 导出；现状用）
- `pickDeps` 对 verb 返回格子里是拨盘的那几个名字。
- `checkPick` 对 verb：写下时把用到的拨盘的每一种组合都拼一遍（`dialSteps` 枚举），哪一种拼不了当场报，话里带是哪一种组合。
- 现状（句子、贴的字、题卡里有 `{verb: …}` 的）多一句：`谓语是页面拼的：go on，现在 × 完成进行，主语单数 → has been going on`；`regular` 且不在表里时后面加「（照规则变的）」。
- `dial verb = …` 当场报「verb 这个名字留给 {verb: …}，换一个」。

- [ ] **Step 1：写失败的测试。**
  - `fillPicks('It {verb: go on | 现在 | 完成进行} for years.', new Map()) === 'It has been going on for years.'`
  - 场景里 `dial t = 现在 options="过去 现在 将来"`、`dial z = 一般 options="一般 进行 完成"`、`sentence s = "She {verb: write | t | z} a letter."`：现在的词是 `She writes a letter .`；学生拨 `t` 到过去 → `wrote`；再拨 `z` 到完成 → `had written`，没变的词（She、a、letter）留着原来的编号（`rewrite` 的规矩）；现状里有「谓语是页面拼的：write，过去 × 完成，主语单数 → had written」。
  - 套在一层里：`{who: He | They}` 和 `{verb: write | t | 一般 | {who: 单 | 复}}` 不支持（格子里不再套）：写了当场报「格子里写词或者拨盘的名字」。主语跟着拨盘走的写法是给主语一个拨盘 `dial who = he options="he they"`，`{verb: write | t | 一般 | who}`：测 `he → writes`、`they → write`。
  - Review Focus 1：`{verb: go | past perfect}` 报错，话里列出 `过去 / 现在 / 将来 / 过去将来`；主语写 `the boy` 报错，话里有 `单 / 复`。拨盘 `z` 的词里有页面不认得的（`options="一般 完了"`）在写下那一行时报。
  - Review Focus 2：`{verb: broadcast | 过去}` 的现状带「（照规则变的）」；`{verb: broadcast/broadcast/broadcast | 过去}` → `broadcast`，不带。
  - 答案：`ask value "写出谓语" answer="{verb: go on | 现在 | 完成进行}" type=en`，学生写 `has been going on` 算对、`have been going on` 算错（走现成的 `en` 比法）。
  - `dial verb = 1 range=1..3` 报错。
  - 时间轴：`timeline tl = 过去 现在 将来 now=现在` 上的小人 `stand`（带 `owner` 的拨词拨盘）拖到「过去」，写了 `{verb: write | 小人的拨盘名}` 的句子跟着变（走现成的 `onPick`）。
- [ ] **Step 2：跑，失败。**
- [ ] **Step 3：实现**（pick.js 里三处分支 + scene 的两处）。
- [ ] **Step 4：说明。** `doc.js` 英语那一节加（先量字节）：写法一行、能写的词一行、「页面只管拼得对；该用哪种是你教」、三段式一行、不做的（疑问句倒装）一句。`tests/stage-doc.test.js` 的「例子照抄能演」跟着多一条。
- [ ] **Step 5：试演。** `evals/stage-gaps/new5/verb.txt`（一句、两个拨盘、学生拨两下、一问），`NEW5` 表里写必须出现的三条事实；`node tools/stage-must.mjs evals/stage-gaps/new5 --table new5`。
- [ ] **Step 6：跑过，build，提交。**

### Task 8: 首课走查 · 时态

**Files:** Create `evals/stage-gaps/first/tense.txt`；Log `.superpowers/sdd/mainline5/first-tense.md`

- [ ] 照任务 1 的七步做。这一节的幕（读 `evals/stage-gaps/ideal/E1.md`）：① 一句真题里的句子，问谓语是哪几个词（`ask pick`）② 时间轴 + 小人，学生拖小人到「过去」，句子跟着变 ③ 状态的拨盘，学生自己拨出「过去完成」，问「哪件事先发生」（时间轴上两个事件点）④ 挑战：把句子拨成和时间轴上这根事件条对得上的样子（`goal`，`when=` 写拨盘）⑤ 一问：这个句子现在完成进行怎么写（`ask value … answer="{verb: …}"`，学生写对的、漏了 been 的）⑥ 被动和否定各拨一下。真手指那一段：拖小人、拨拨盘、点词。
- [ ] `FIRST` 表加这一节的必须出现；提交。

### Task 9: 发布（二）

- [ ] 版本 `2026-11-12c`；同任务 3 的检查（表多 `new5`）；合并、发布；告诉我「英语可以上了」。

---

## C · 矩阵那一节

### Task 10: 首课走查 · 可交换、方阵的幂、f(A)

**Files:** Create `evals/stage-gaps/first/power.txt`；Log `.superpowers/sdd/mainline5/first-power.md`

- [ ] 照任务 1 的七步做。幕（读 `evals/stage-gaps/ideal/L1.md`）：① 两张 2×2，学生把 A 整张拖去和 B 乘（`whole` → `merge`），再反过来，`compare` 两个结果：不相等 ② 换一对可交换的（对角 / 数量矩阵），学生自己写一格使它们可交换（`open … edit`，`goal when={A*B} == {B*A}` 这一类）③ A 的幂：拨盘 k，`{A^k}` 跟着算，学生猜 Aⁿ 的一格（`ask value type=formula`）④ 秩 1 矩阵 αβᵀ 的幂 ⑤ f(A)：`ask value type=matrix`，学生写对的、把常数项漏了乘 E 的。真手指那一段：整张拖去乘、点一格写数、拨拨盘。
- [ ] 发现的问题照规矩修；`FIRST` 表加这一节；提交（不单独发布，跟着下一次）。

---

## D · 引擎的过程表上舞台

### Task 11: 引擎的表 → 舞台表（纯函数）

**Files:** Create `kit/src/stage/enginetable.js`；Modify `kit/src/stepperspec.js`（导出判一格的函数，名字 `cellRight(cell, text)`，现在是文件里 190 行上下没导出的那个）；Test `tests/stage-enginetable.test.js`

**Interfaces — Produces:**
```js
engineTable(name, rawFields) → {
  name, title,            // 'sort'、给老师看的名字
  rowNames, colNames,     // string[]
  grid,                   // string[][]：给定的格是值，等学生填的是 ''
  cells,                  // 引擎的格 [r][c]（判一格时交给 cellRight；转过以后的位置）
  key,                    // string[][]：每格第一种对的写法
  groups,                 // [[ [r,c], … ], …] 先后不论的几格
  marks,                  // [[r,c], …] 打勾的格（舞台上 choices="√ ×"）
  lines,                  // [[ [r,c], … ], …] 引擎的一行一行（转过以后是一列一列），认错法按它
  variants,               // [{ label, key: string[][] }]（和对的一样的不列）
  extra,                  // [{ label, v }]
}
```
- 引擎 `dir: 'col'` 的表转置（引擎的 `head` 当行名、每行的 `label` 当列名）。
- 抛错（话给老师）：没有这个引擎（列出这门课有的）；这个引擎没有表；引擎自己的 `parse` 报的错原样；`trackFields` 说没用上的字段（「sort 不认得 gap：是不是 gaps」照它现成的话）；转完超过 `MAX_TROWS × MAX_TCOLS`（「这张表有 N 行 M 列，舞台上放不下（最多 10 行 12 列）：把输入写短一点」）；一格超过 24 个字。

- [ ] **Step 1：写失败的测试。**
  - `engineTable('sort', { algo: 'shell', array: '49 38 65 97 76 13 27 49', gaps: '5 3 1' })`：行数 = 趟数、列数 8，`key` 的最后一行是 `13 27 38 49 49 65 76 97`（撇照引擎的写法），`grid` 全空或只有引擎给定的格。
  - `engineTable('paging', { algo: 'fifo', frames: '3', refs: '7 0 1 2 0 3 0 4' })`：`dir: 'col'` 转过来，列名是访问串，`groups` 非空，缺页那一行在 `marks` 里。
  - `engineTable('net', { … dijkstra … })`：和第四轮 `toKey` 给同一张图的答案逐格一样（防两条路算出两个答案）。
  - `variants`：希尔那张至少一种错法，`label` 非空，`key` 和对的不全等。
  - 报错五种各一条。
  - 61 个引擎扫一遍（`engines/registry.js`，用每个引擎说明里的例子字段——`tests/engines-common.test.js` 里现成的取法）：有表的要么造得出、要么报的是「放不下」，不许抛别的错。
- [ ] **Step 2：跑，失败。** **Step 3：实现。** **Step 4：跑过，提交。**

### Task 12: `table T engine=…`

**Files:** Modify `kit/src/stage/types/table.js`（`MAX_TROWS = 10, MAX_TCOLS = 12`；`engine=` 的造法；`wrongCells` 认组和 `cellRight`）、`table.rules.js`（事实里「像是：…」）、`table.view.js`（打勾的格）、`kit/src/stage/scene.js`（`optionNames` 对 `table … engine=` 放行引擎的字段；同名重造、`back` 带着 `o.engine`）、`kit/src/stage/follow.js`（`known` 换成 `trackFields`，对应关系里的 `known` 删掉）；Test `tests/stage-table-engine.test.js`；试演 `evals/stage-gaps/new5/etable.txt`

**Interfaces — Consumes:** `engineTable`（任务 11）、`cellRight`、`misreadFill` 的比法（直接比 `variants[].key`，不调黑板那个函数：它的入参是黑板表的形状）。
**Produces:**
- 写法 `table T engine=sort algo=shell array="…" gaps="5 3 1"`；`on=a` 时 `array` 从那一排格子来（用 `followOf` 那一类对应关系的 `fields`；这个引擎没有对应关系报「on= 只有 … 能写」）。不能同时写 `key=`、`rows=`、`cols=`（报错）。
- `o.engine = { name, fields, cells, groups, marks, lines, variants, extra }`；`o.key` 照旧。
- 事实（只给老师）：学生把引擎的一行（`lines` 的一条）填完、或者填满时，这一行（整张）和某种错法的同一行全等、和对的不等 → 现状和学生那一下后面加 `像是：{label}`。同一行只说一次，改了以后重新看。
- 量 `T.wrong`、判断式 `T right` 照组、照 `cellRight`。
- 现状里表下面多一行 `表外的答案（学生看不到）：ASL成功 = 1.67`（有 `extra` 时）。

- [ ] **Step 1：写失败的测试。**
  - 造表：行名列名、空格数对；`open T edit` 以后学生填对一格 `wrong` 是 0。
  - 组：页面置换同一列的三个物理块先后调换着填，`T.wrong === 0`。
  - Review Focus 3：`engine=hash … ` 的 ASL 不在表里（在 `extra`），现状有「表外的答案」；表里是小数的格（找一个：`rtt` 或 `util`）写两位小数算对。
  - 错法：希尔第一趟照「直接当成相邻比较」那种错法的那一行填完 → 发给老师的那一条里有 `像是：`；填对的那一行没有。
  - Review Focus 4：填两格 → `keep k1` → 再填 → `back k1` → `T.wrong`、`o.engine` 都在；同名重造 `table T engine=…`（换输入）答案跟着换。
  - 字段写错：`table T engine=sort algo=shell array="…" gap="5 3 1"` 当场报，话里有 `gaps`；`follow a sort shell gap="5 3 1"` 也报（`known` 换掉以后不退步）。
  - 放不下：13 个数的希尔报「放不下」。
  - 写了 `engine=` 又写 `key=` 报错。
- [ ] **Step 2：跑，失败。** **Step 3：实现。**
- [ ] **Step 4：试演和排版。** `evals/stage-gaps/new5/etable.txt`：10 行 12 列的一张（页面置换 12 次访问）加一张题卡和一句话，竖屏横屏。Review Focus 5：看截图字认不认得；`tools/stage-measure.mjs` 报「缩得太小」时把上限降回认得的大小（行数优先保 10，列数可以退到 11），记进 rulings。`NEW5` 表加三条。
- [ ] **Step 5：跑过（含 `tests/stage-follow*.test.js`、`new3 new4` 两张表），build，提交。**

### Task 13: 引擎的表抄成舞台题

**Files:** Modify `kit/src/memory/stagedrills.js`、`kit/src/stagedrillspec.js`、`kit/src/blocks/stagedrill.js`；Test `tests/stagedrillspec.test.js`、`tests/memory-drills.test.js`

**Interfaces — Produces:**
- `stageDrillsOf` 多认 `table … engine=`：编号 `d-stage-{块}-table-{引擎}-{字段指纹}`；同一块同一个引擎只留最后一张（Review Focus 6）；`usespec.js` 的 `BUILTIN_USE[引擎]` 有随机取数的就用它的 `pick` 行换数，没有照原样。
- `trackTableDrill(scene, id) → { after() → { records, done }, giveup() }`：填满才判；满了全对记一条 `ok: true`；满了有错记一次错（只记一次）、学生能接着改，改对了算做完；「看答案」把答案填进去、记放弃。
- 舞台题的按钮：表的题只有「做不出来」（没有「看这一趟」）。

- [ ] **Step 1：测试**（一节课两张 `engine=sort` 的表只抄最后一张；换数以后引擎造得出；填满全对一条 ok；填错一次再改对：一条 `ok: false` 带 `wrong`、`done`；`markFresh` 不把它当新题）。
- [ ] **Step 2～4：失败、实现、跑过。** `kit/examples/stagedrill-demo.html` 加一道表的题，`node tools/check-lesson.mjs kit/examples/stagedrill-demo.html`。提交。

### Task 14: 过程表的说明

**Files:** Modify `kit/src/stage/doc.js`；Test `tests/stage-doc.test.js`

- [ ] 表那一节加一行通用形（所有计算机课带）；每门课一行「这门课能造表的：sort(algo array gaps) hash(hash p) …」——名字和必写的字段从 `registry.js` 和各引擎的 `head` 现取，不手抄；每门课最多列 12 个（按这门课引擎的先后），别的写「别的引擎写错了页面会告诉你字段」。量字节：六门课都 ≤ 24576。测试：每门课列出来的每一个，照说明里的字段加引擎例子的值能造出表或者报「放不下」。build，提交。

---

## E · 能动手的再接两类

### Task 15: 散列表接一排格子

**Files:** Create `kit/src/stage/follows/hash.js`（≤ 150 行）；Modify `follows/index.js`；Test `tests/stage-follow-hash.test.js`；试演 `evals/stage-gaps/new5/hash.txt`

**Interfaces — Consumes:** 第四轮的对应关系接口（`docs/stage-types.md`「接一类算法」）。
- 写法：`array h = _ _ _ _ _ _ _ _ _ _ _ _ _`（槽）、`follow h hash keys="19 14 23 1 68 20" p=13`（`probe=` 照引擎的字段）、`open h edit`。
- 检查点：每放进一个关键字（引擎的每个 key 放定的那一步）。状态 = 槽里的数（空的 `_`）。错法从引擎的 `variants` 来。
- 一排格子的格数 ≠ 引擎的表长：`fields` 把 `size` 设成格数；引擎不收就报引擎的话。

- [ ] 测试（走对三个关键字到三个检查点；冲突时放回原位认成引擎的那种错法；格数不够当场报）→ 失败 → 实现 → 过 → 试演一幕、`NEW5` 加两条 → 说明里数据结构加一行（量字节）→ 提交。

### Task 16: 树上对调，堆接树

**Files:** Modify `kit/src/stage/types/tree.js`（行 `swap t.a t.b`：两个结点的值对调，形状、编号不动）、`tree.rules.js`（手势 `swap`：按住一个结点拖到另一个结点上；`ARMED_GRIPS` 里登记；`check` 只查两个都在）、`tree.view.js`（值滑过去）、`kit/src/stage/gestures.js`；Create `kit/src/stage/follows/heap.js`（≤ 150 行）；Test `tests/stage-tree-swap.test.js`、`tests/stage-follow-heap.test.js`；`tools/stage-touch.mjs` 加一段真手指

- [ ] **Step 0：先看能不能做。** 读 `tree.rules.js` 的 `gestures` 和 `referee.js`：树上「拖结点」现在是不是已经被 `rotate` / `place` 占了、同一处能不能再开一种拖。**要动 `referee.js` 的判法、或者和旋转的手分不开：这一类跳过**——记进 rulings（写清楚卡在哪），堆用任务 12 的过程表（确认 `table T engine=tree heap="…"` 造得出），直接到任务 17。
- [ ] **Step 1：`swap` 的测试**（老师的行、学生的手势、对调以后 `count()` `height()` 不变、撤一步回得去、和 `open t rotate` 同时开着时拖到别的结点上是对调、拖到空位不是）→ 实现 → 真手指一段。
- [ ] **Step 2：堆的对应关系。** `follow t heap ops="build"`（`ops` 照引擎：`build`、`insert 5`、`pop`、`sort`）、`open t swap`。状态 = 层序的值；检查点 = 引擎里每一次调整（一个结点下坠 / 上浮到位）做完；错法从引擎来。超 150 行：跳过（同 Step 0 的办法）。
- [ ] **Step 3：** 测试、试演 `new5/heap.txt`、`NEW5` 两条、说明一行、build、提交。

---

## F · 收尾

### Task 17: 第四轮留下的 5 条

**Files:** `kit/src/stage/follow.js`、`follows/net.js`、`kit/src/blocks/stagedrill.js`、`kit/src/memory/stagedrills.js`、`kit/src/stage/classroom.js`；Test `tests/stage-mainline5-leftover.test.js`

每条一个先失败的测试，再修：

- [ ] 同时 `open a edit` 和 `follow a sort …`：学生把数直接写成有序的，`whereOf(o).done` 是 false、现状写「数被改写了：不在引擎走的那条路上」，不演 `@a.done`。
- [ ] 舞台题点「做不出来」：`session.record` 只多一条（`giveup: true`），报告里这道题是一道。
- [ ] `stageDrillId('DS-L8.2.3', '希尔', …)` 和 `stageDrillId('DS-L8.2.3', '快排', …)` 不一样（中文名进指纹，不被去成空）。
- [ ] Dijkstra 某一轮 dist 都没变：检查点还是并成一个，但 `lead` 写「确定 3、5；」（两轮确定的都写）。
- [ ] 下课那一刻最后一轮才写的 `follow`：`harvestSession` 用课堂交过来的轮次（`desk.makeReport` 的参数里带 `turns`），没有再读数据库；测 `harvestDrills({ turns })` 含最后一轮时抄得到。

### Task 18: 整套检查、审查、文档、发布（三）

- [ ] **整套检查各一次：** `npm test`；`npm run check:stage`（慢，耐心等，不要误杀）；`npm run e2e`；`npm run check:pages`；六张表 `fix1 new2 new3 new4 new5 first`；旧课重放 282 份（`.superpowers/wt.sh`、`.superpowers/replay.sh run7`、`node .superpowers/cmp3.mjs`——表的上限、`known` 换了以后预期 0 处不同，有不同逐条看是不是该变的）；`node .superpowers/size.mjs`。
- [ ] **只读助手审一次**（一个 `general-purpose` 助手，不改文件）：给它设计、计划、rulings、`git diff 71fd73a..HEAD -- kit/src tools tests`，问三件事：发给老师的话里有没有假话或者会静默失效的；有没有哪里页面替老师做了教学决定；Review Focus 六条各自的测试是不是真的测到了。要紧的修，一条一个测试；不修的记进 rulings。
- [ ] **文档：** `docs/stage-mainline.md` 加「第五轮」；`docs/stage-types.md`（`{verb}`、`engine=`、树上对调）；`CLAUDE.md` 接一句；rulings 写全；计划里的勾打完。
- [ ] **发布：** 版本 `2026-11-12d`（跨了天就用当天的日期）；build 两处；提交、推、快进 `main`；发布学习台和舞台试课。
- [ ] **告诉我：** 三节课各走查出几条、修了几条、哪几条没修为什么；跳过的（堆要是跳了）；上课时请我留意的两三处。
