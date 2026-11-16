# 给 Codex 的任务队列（第十二轮）

主控是 Claude Code 那边的会话：它定设计、审你的东西、负责合并和发布。你照这里的顺序一件一件做，每件一个分支，都从 `claude/friendly-ride-l2f31n` 的最新提交开，推到写明的分支，不合并、不开 PR、不提交 `kit/dist/`、不加依赖。每件做完在分支里写一份报告。拿不准的不要猜着做，写进报告。

通用的规矩见 `docs/codex-root-holds.md` 的「必须守的规矩」。

| 顺序 | 做什么 | 说明 | 分支 |
|---|---|---|---|
| 1 | 首页「验上次学的」，结果记回那节课 | `docs/codex-root-later.md` | `codex/root-later` |
| 2 | 开课改成黑板；课堂两处不打扰；整套 e2e 跟着改（见下） | 这个文件 | `codex/root-class` |
| 3 | 测试的卫生（见下） | 这个文件 | `codex/test-hygiene` |
| 4 | 独立通读：黑板课老师的整份说明（只读，见下） | 这个文件 | `codex/review-charter` |

后面还会加（等主控把第 2 批的计划定下来）：第 2 批里自成一块的新组件。

---

## 2. 开课改成黑板；课堂两处不打扰；整套 e2e 跟着改

计划 `docs/superpowers/plans/2026-11-15-root-1.md` 的 Task 5。背景：这一轮定了黑板是课的底座，新开的课一律是黑板课（现在默认开舞台课）；学生提过一条要求——「老师一说话，页面就把我拉回板顶，打断我做题」——这一件把它修掉。行号是写计划时的，以现在的代码为准。



**Files:**
- Modify: `kit/src/memory/session.js`（`classForm` :46-52 和上面的注释）、`kit/src/memory/desk.js`（`createClass` 的默认值和 :1966 的注释）、`kit/src/class/classroom.js`（滚动 :1946-1962；`?dev` 时把整份说明挂到 `window.LAKitClassSystem`）、`kit/src/class/bar.js`（返回的对象加 `hasText()`）、`kit/src/class/boardview.js`、`kit/src/class/class.css`、`kit/src/class/ios.css`、`tools/desk-e2e.mjs`
- Modify tests: `tests/stage-class.test.js:115-121`
- Test: `tests/class-quiet.test.js`（新）

**Interfaces:**
- Produces：
  - `classForm(search)`：不带 `?dev&form=` 时返回 `'class'`；`?dev&form=stage` / `talk` / `class` 照旧认；乱写的返回 `'class'`。`createClass` 的 `kind` 默认 `'class'`。
  - `kit/src/class/quiet.js`（新，纯函数）：`shouldScroll({ writing, away }): boolean`：学生正在写（`writing`）或者翻到了别的板（`away`）时是 `false`。`writing` 由课堂算：有没发的 Pencil 笔画、当前板上有草稿、输入框里有字，三样有一样就是。
  - 老师这一轮只说了话、没写新段，而板顶的话不在屏幕里时：话在输入条上方再显示一份（`.class-talk-echo`，点它滚回板顶，学生下一次动作或者滚到板顶以后消失）。
  - `?dev` 时 `window.LAKitClassSystem` 是最近一次发给老师的整份说明（e2e 读它）。

- **Step 1: 写失败的测试**：`tests/class-quiet.test.js`（`shouldScroll` 四种组合）；`tests/stage-class.test.js:115-121` 改成新的默认值（`classForm('') === 'class'`、`'?form=stage'` 不带 dev 时是 `'class'`、`'?dev&form=stage'` 是 `'stage'`、`'?dev&form=瞎写'` 是 `'class'`）。
- **Step 2: 确认是红的。**
- **Step 3: 改 `session.js`、`desk.js`、写 `quiet.js`、改 `classroom.js` / `bar.js` / `boardview.js` 和样式**，测试转绿。
- **Step 4: 改 e2e**（`tools/desk-e2e.mjs`）：
  - `stage`、`stagestuck`、`aide` 三段改成 `openForm('stage')` 开课（它们守的是舞台课的旧代码）；`stage` 段里「首页没有形式选项」照旧查。
  - `class`、`guard` 两段不再需要 `openForm('class')`，直接从首页开。
  - `asks` 段改成开黑板课，读 `window.LAKitClassSystem` 查说明里有那条要求。
  - `prep`、`menu`、`purge`、`review` 这些直接点首页开课的段，`inClass` 的等待条件要认黑板课（先核一下黑板课开课页有没有「开始上课」，没有就加上它能等到的东西）。
  - 新加一段 `quiet`：开黑板课，在输入框里打几个字不发，让模拟老师回一轮带新段的（现成的剧本就行），页面的滚动位置不变；清掉输入框再来一轮，滚到新段。
- **Step 5: `npm run build && npm run e2e` 全过**（全量，不只是新段：默认的课型换了，哪一段都可能受影响）。
- **Step 6: `npm test` 全过，提交**（不提交 `kit/dist/`）

补充（主控定的）：

- 这一件**可以改 `tools/desk-e2e.mjs`**（它是这一件的主要工作量：默认的课型换了，哪一段都可能受影响）。验收就是 `npm run build && npm run e2e` 全量全过、`npm test` 全过、`npm run check:pages` 过：三样的结果贴进报告。e2e 没过的段不许删、不许改成不查东西；真是旧行为不该再守的，写进报告由主控定。
- 舞台课、一问一答的课（`?dev&form=stage / talk` 还开得出来；以前开的还能接着上、能翻看）行为一点不变：「不打扰」的两处只在黑板课生效，一问一答（`classroom.js` 里 `TALK` 为真）照旧。发给老师的说明这一件一个字都不改（`tests/class-charter.test.js` 的 sha256 守着舞台课和一问一答的；黑板课的你也不要动）。
- `kit/src/class/classroom.js`、`boardview.js`、`class.css`、`ios.css` 主控那边同时有人在改别的地方（老师写「要拿下的事」的指令、板上方的一条）：你只改滚动那一处、加你要的那一小块，不重排、不改格式、不顺手整理。`prompt.js`、`protocol.js`、`aims.js`、`charter.js` 不要改。
- 「学生正在写」判断错了的两种后果不对称：该滚没滚，学生可能没看到老师新写的东西——所以不滚的时候必须有看得见的提示（照说明里的 `.class-talk-echo`，或者现成的「回到当前板」那种闪一下），不能悄悄不动。报告里写清每种情况学生看到什么。
- 界面以 iPad 为准（820×1180 / 1180×820），新加的那一小块用现成的变量和毛玻璃样式（`ios.css`），点的地方至少 44px。竖屏横屏各截一张图放进报告（或写明截图的命令）。
- 你上一件（`codex/root-later`）如果加了浏览器验收脚本，这一件做完以后把它并成 e2e 里的一段（`later`），照 e2e 现成各段的写法。

交付：`docs/codex-root-class-report.md`。

---

## 3. 测试的卫生

两件小事，都只动测试和工具，不动 `kit/src/`。

**(a) 计时测试在 CI 上稳定地红。** `tests/forecast-forecast.test.js` 里「够快」那一条断言一次预测在 120ms 以内；GitHub 的 Linux 机器上最好的一次也要 200ms 上下，于是 `npm test` 红，后面「打包产物和源码一致」「e2e」都被跳过——等于 CI 现在什么都不守了。先读这条测试和 `docs/smart-plan.md` 第 0 节（速度是硬杠，但这条测试守的是「算法没有退化成慢一个数量级」，不是这台机器的绝对速度）。改成在慢机器上不误报、算法真退化了还抓得到的写法，比如：同一台机器上先量一个固定的基准（一段确定的纯计算），断言预测的耗时不超过基准的若干倍；或者断言的是算法的规模（抽样次数、块数翻倍时耗时不超过若干倍）。**不许**直接删掉这条测试、不许简单把 120 改成一个很大的数、不许 `skip`。在报告里写清你选的办法、为什么它在算法退化时仍然会红（最好故意把被测函数弄慢十倍跑一次，证明它红）。

**(b) 在 Windows 上跑不了的测试。** 你上次报告里说 `tests/no-modals.test.js`、`tests/teach-run-lib.test.js` 等 15 条用 `new URL(…).pathname` 拼路径，Windows 上变成 `C:\C:\…`。改成 `fileURLToPath`（`node:url`）。只改测试和 `tools/` 里同样写法的地方，行为在 Linux 上不变。改完你那边的全套应该只剩和这件事无关的失败，报告里列出还剩哪些。

交付：`docs/codex-test-hygiene-report.md`。

---

## 4. 独立通读：黑板课老师的整份说明（只读）

这一轮最要紧的改动是把黑板课老师（Opus）的说明从一堆「规定形式」的红线换成一份「根本规则」：每一刻只问三件事（终点 / 差距 / 动作），怎么教由老师当场判断，页面不规定形式；另有四条不许绕的保险。前面几轮开发每次都自称改了教法，结果都是换皮：形式的规定换个地方又长回来。你是另一个模型，请你当独立的审稿人把现在的整份说明从头读一遍。**只读：不改任何源码**，只交一份报告。

先读：
- 设计 `docs/superpowers/specs/2026-11-15-root-design.md` 的第 2 节（根）和 6.1、6.2 节。
- `kit/src/class/charter.js`（根本规则全文）、`kit/src/class/prompt.js`（`buildSystem`、`PROTOCOL_DOC`、`CLASS_MEMO_DOC`、`closingPrompt`、`MSG_QUICK` 那几个按钮的话）、`kit/src/class/aims.js`（要拿下的事的状态怎么算）。

怎么得到「老师真的看到的那一份」：写一个临时脚本（不提交，或放在报告里），照 `tests/class-charter.test.js`、`tests/class-prompt.test.js` 里的调法，用真的 `buildSystem` 拼出三份黑板课的整份说明——线代、操作系统、英语各一份（`componentDocs` 用 `kit/src/class/docs.js` 的真的组件手册，资料包可以用测试里的小样例，记忆用 `kit/src/memory/sample.js` 的示例记忆），再拼一份下课时的 `closingPrompt({ noForm: true, … })`。从头到尾读。

要你回答的（每条发现给出：在说明的哪一节、原文、为什么是问题、建议怎么改；找不到问题的也写「看过，没有」）：

1. **形式的规定还剩哪些。** 哪句话在规定什么时候停、一轮写多少、先问后讲还是先讲后问、一次几道题、每块板要有什么、必须用哪种组件——不管它在根本规则里、黑板指令的说明里、组件手册里、还是按钮的话里。几句话单看没问题、合起来等于一条形式规定的也算（上一轮审查抓到过三句换板的话合起来逼着老师每讲一个点停一轮）。
2. **互相打架的话。** 根本规则和别处（黑板指令说明、组件手册里教怎么用某个组件的话、记忆那一节的说明、下课提示）有没有说法相反的地方。
3. **假话。** 说明里凡是说「页面会做某事」「页面不收」「页面算」的，对着代码核：页面真的这样做吗？（上一轮抓到过：说「一科最多 20 条，到了上限页面不收新的」，代码其实照收。）重点核 `PROTOCOL_DOC` 里每条指令的说明、`CLASS_MEMO_DOC`、根本规则里那四条保险提到的东西（`\calc`、`let`、掌握由页面算、「这节课要拿下的事写着」——最后这一条现在还没接进说明，主控正在做，你只要确认这是唯一一处悬空的）。
4. **老师照这份说明上一节课，最可能在哪里教歪。** 设想一个具体的内容各走一遍开头几轮：一块要理解的（操作系统的页面置换算法）、一块要背的（TCP 首部的字段）、一道线代证明、一篇英语阅读。照说明，老师第一轮会怎么写？哪里会不知道该怎么办？哪里会被某句话带着去做一件对学生没用的事（处处停、只甩内容不让学生动笔、硬造题）？
5. **省字节。** 整份说明每一轮都发，越短回话越快。哪些话是重复的、对一个聪明的老师来说不用说的、可以删掉而不丢意思的？（根本规则那一段有字节上限，只许降不许涨。）

口径：你和主控的判断不一样时照你的写，不要因为设计里那样写了就认为它对；但每条都要有原文和理由，不要泛泛的建议。提到学生不要用「他」「她」。

交付：`docs/codex-review-charter-report.md`（就这一个文件，推到 `codex/review-charter`）。
