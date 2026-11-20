# 视觉交互第 5 批：英语——长难句的层次、分裂结构、平行结构、句子变换

> 设计：`docs/superpowers/specs/2026-11-20-visual-design.md`（第三节「英语语法」的表、第四节第 5 批）。
> 执行方式：主控自己一件一件做（superpowers:executing-plans），每件先写失败的测试；做完一次独立复查。

**Goal：** 把英语表里 7 行 B 做到 A：强调、同位语和插入语、并列和平行结构、三大从句、倒装、嵌套结构、分裂结构。「情态、语态」那一行的「主动变被动看不到成分怎么挪」一起做掉。

**Architecture：** 英语的判分和写法在 `kit/src/entext.js`（纯函数），画面在 `kit/src/blocks/english.js`。这一批：

| 做什么 | 纯函数 | 画面 | 盖住的行 |
|---|---|---|---|
| `parse` 的层次图：括号套出来的层次画成一层层缩进的块（代替一行 `]]]`），从句的块能折起来看主干 | `entext.js`：`nestSpans(spans)` 把成分按包含关系排成树；`layerRows(tree, tokens)` 排成行 | `english.js` 的 parse：`view: layers`（套了两层以上、`mode: show` 时默认） | 三大从句、嵌套结构、同位语和插入语 |
| 分裂结构：被隔开的两段连起来 | `parseBrackets` 认 `[S~1 …] … [AppC~1 …]`（同一个 `~n` 是一家）；`judgeJoins` | 层次图上两段之间画一条弧；学生点出「哪两段本来连着」 | 分裂结构 |
| 平行结构：并列的几项上下对齐 | `parseParallel`（公共的开头 + 几项 + 连接词）、`judgeParallel`（找出每一项的起点 / 挑出不平行的那一项） | 新组件 `parallel` | 并列句、平行结构 |
| 句子变换：成分带着颜色挪到新位置，原来的位置留一个影子 | 新文件 `kit/src/enshift.js`：`parseShift`（from / to 两行括号写法，按成分配对）、`shiftPlan`（谁挪到哪、哪些词变了、哪些是新加的框架词）、`judgeOrder` | 新组件 `shift`：`mode: show` 一步步播、`mode: do` 学生自己拖 | 强调、倒装、语态 |

**Tech Stack：** 同前（纯函数 `node --test`；画面 Playwright 真手指 + 截图，iPad 竖屏 820×1180、横屏 1180×820，默认 / ink / inknight 三种风格）。

## Global Constraints

- 注释、界面文字、提交说明用中文；颜色只走 CSS 变量；触控目标 ≥ 44px；输入框 16px；不用 `window.confirm / alert / prompt`。
- **老的 `parse`、`link`、`chunk` 的题一道不许变**：写法照旧收，判分照旧，`en-demo.html` 里已有的图先截一遍当基线，做完逐张对。`view:` 没写、只套一层的 `parse` 画出来和现在一样。
- 记录的格式不变：`type: parse`、`block`、`step`、`detail`、`misread`；新组件 `parallel`、`shift` 各自的 `type`，`class/prompt.js` 加给主讲的那句。
- 手册只写写法、能力、页面行为；新的小节标「科目：英语」，精简版每节 ≤ 1.2 KiB。英语的精简版离 40 KiB 的上限还剩多少，动手前 `npm run docs:size -- 英语` 量一次写进 ledger。
- 拖动：手指拖成分时页面不跟着滚（`touch-action: none` 只放在把手上）；拖到一半松手、切后台，成分回到合法的位置，不丢。
- 每张要学生做的图：做到了记一条作答；做错的那一下也记（带页面说的那句）。

## Review Focus

1. **括号写法的边角**：套四层、标点在括号里外、`~n` 只写了一半（只有一段）、同一个 `~n` 写了三段、成分名和 `~`、`->` 连写；老写法（没有 `~`）读出来和以前逐字段一样。
2. **层次图的排版**：很长的句子（40 个词以上）在竖屏一个块里折行以后，块的边、标签、连线还对不对；折起一个从句以后主干连成一句读得通（标点怎么办）。
3. **判分的一致**：同一道 `parse` 题用老的一行视图和层次图作答，判出来一样；分步（`steps:`）和层次图一起用。
4. **拖动**：`shift` 的 `mode: do` 在真手指下拖得动、放得准（两个成分之间的缝 44px 以上才好放）；拖的过程页面不滚；放错了的提示不把答案说出来。
5. **变了的词**：主动变被动时动词的形式（`approved` → `was approved`）、新加的 `by`、强调句的框架 `It was … that` 是页面按 from / to 两行比出来的，比法在大小写、标点、缩写上会不会把没变的词当成变了。
6. **平行结构**：公共的开头怎么认（几项前面相同的那一段）；并列的项里又套并列；连接词前有没有逗号都要认。

---

### Task 1: 括号的树和分裂的记号（`entext.js`）

**Files:** Modify `kit/src/entext.js`；Create `tests/entext-nest.test.js`

**Interfaces（Produces）：**
- `parseBrackets(src)` 多认两样，老的输出字段不变：`[S~1 The rumor]`（`join: 1`）、新成分 `Par`（插入语）、`Emp`（被强调的部分）。
- `nestSpans(spans) → [{ ...span, depth, children }]`：按 from / to 的包含关系排成树（同一层按位置排）；交叉的括号报错（说是哪两个）。
- `layerRows(tree, tokens, { fold }) → [{ depth, pieces: [{ from, to, role?, folded? }] }]`：给画面的行——最外层的词一行，每个从句（`RC` `SC` `ObC` `PC` `AppC` `AdvC`）、插入语另起一个缩进的块；`fold` 里的块收成一个「…」。
- `joinsOf(spans) → [{ id, parts: [spanIndex, spanIndex] }]`、`judgeJoins(mine, joins)`。

- [ ] **Step 1: 失败的测试**：一层的句子（树就是一排）；定语从句里套宾语从句（三层）；同位语从句被谓语隔开（`~1`）；括号交叉报错；`~1` 只有一段报错；老写法的 `parseBrackets` 输出和基线（先把现在的输出存成 fixture）逐字段一样。
- [ ] **Step 2:** 实现 → 通过；`npm test` 全过。
- [ ] **Step 3: 提交** `英语：成分的括号排成树、分裂结构的记号（视觉第 5 批）`

### Task 2: `parse` 的层次图

**Files:** Modify `kit/src/blocks/english.js`、`kit/src/styles.css`；探针 `.superpowers/audit-visual/en/v5-layers.md`、真手指 `v5-layers.mjs`

**写法：** `parse` 多一个字段 `view: layers | line`（不写：套两层以上或 `mode: show` 用 `layers`，别的照旧 `line`）。

**行为：** 主干的词在最外面一行；每个从句是一个缩进的圆角块，左上角一个小标签（定语从句 / 宾语从句……），块的左边一条和成分同色的线；块里再套块。点一个从句块的标签：折起来变成「…」（主干读得通），再点展开。`mode: show` 直接画；作答的题（点词定范围、再点成分）照旧在一行的句子上做，**每标对一个从句，下面的层次图多长出一块**；全做对以后层次图完整。分裂结构的两段之间一条弧。

- [ ] **Step 1:** 先截基线：`en-demo.html` 里现有的 `parse` 每张一张（`.superpowers/audit-visual/en/before/`）。
- [ ] **Step 2:** 探针（三大从句各一、套三层、同位语、插入语、分裂、40 个词的长句）；实现；三种风格、两种尺寸看截图；老图和基线逐张对。
- [ ] **Step 3:** 真手指：标对一个从句长出一块、折起 / 展开、长句折行后点词还准。
- [ ] **Step 4: 提交** `英语：parse 的层次图（视觉第 5 批）`

### Task 3: 分裂结构——把隔开的两段连起来

**Files:** `english.js`、`entext.js`（`judgeJoins`）、探针 `v5-split.md`

**写法：** `answer:` 里写 `~1`；`ask: join` 时学生的任务是在标好成分的句子上点出本来连着的两段（先点一段、再点另一段，中间画弧）。

- [ ] **Step 1:** 测试（纯函数已在 Task 1）；真手指：点对、点错（说「这两段不是一家」不说答案）、三次不对看答案。
- [ ] **Step 2: 提交** `英语：分裂结构连线（视觉第 5 批）`

### Task 4: 平行结构 `parallel`

**Files:** Create `tests/entext-parallel.test.js`；Modify `entext.js`、`english.js`、`blocks/index.js`、`class/prompt.js`、`styles.css`

**写法：**

```parallel
text: She likes [reading novels], [writing letters], and [to swim].
ask: odd                      # odd：挑出不平行的那一项；starts：点出每一项的第一个词；不写就只展示
answer: 3
fix: swimming
```

**行为：** 公共的开头（She likes）在左边，几项上下排齐，连接词（and）标出来；每一项开头的那个词（决定形式的）加粗。`ask: starts` 时句子先是普通的一行，学生点每一项的第一个词，点对了那一项跳到对齐的位置上。`ask: odd` 点出不平行的那一项，再从几个改法里选（`fix:` 是对的，`decoys:` 是错的）。

- [ ] **Step 1: 失败的测试**（`parseParallel`、`judgeParallel`）→ 实现。
- [ ] **Step 2:** 画面、探针、真手指、截图。
- [ ] **Step 3: 提交** `英语：平行结构 parallel（视觉第 5 批）`

### Task 5: 句子变换的计划 `enshift.js`

**Files:** Create `kit/src/enshift.js`、`tests/enshift.test.js`

**Interfaces：**
- `parseShift({ from, to }) → { from: [chunk], to: [chunk] }`，chunk = `{ role, words, key }`；两行按 `role`（重名的按出现的次序、或者写 `S#1`）配对。
- `shiftPlan(s) → { moves: [{ key, fromIndex, toIndex }], changed: [{ key, before, after }], added: [toIndex…]（框架词：It was / that / by / did）, dropped: […] }`。
- `judgeOrder(mine, s) → { ok, firstWrong?, text }`（学生排的顺序；不说答案，只说第几个位置不对）。
- 比词：大小写（句首）、句末标点不算变。

- [ ] **Step 1: 失败的测试**：主动变被动（宾语到句首、动词变形、加 by）；强调句（It was … that 是加的，被强调的成分挪进框里）；部分倒装还原（Never have I seen → I have never seen：助动词回到主语后面）；只有顺序变没有词变；role 配不上的报错。
- [ ] **Step 2:** 实现 → 通过。
- [ ] **Step 3: 提交** `英语：句子变换的计划（视觉第 5 批）`

### Task 6: 句子变换的画面 `shift`

**Files:** Create `kit/src/blocks/shift.js`；Modify `blocks/index.js`、`class/prompt.js`、`styles.css`；探针 `v5-shift.md`、真手指 `v5-shift.mjs`

**写法：**

```shift
title: 主动变被动
from: [S The committee] [V approved] [O the plan] [A yesterday].
to: [O The plan] [V was approved] [S by the committee] [A yesterday].
mode: do                       # show：一步步播；do：学生自己拖
```

**行为：** 上面一行是原句，每个成分一个带颜色的块。`mode: show`：点「下一步」，一个成分带着颜色滑到新位置，原来的位置留一个虚线的影子；变了形式的词闪一下、旁边小字写原来是什么；新加的框架词（by、It was … that）淡入、用另一种底色。课堂里 `figure play step`。`mode: do`：下面一行是空的槽，学生把成分拖下来排顺序（也能点一个成分再点一个槽），排完点检查；顺序对了以后，变形式的词给几个选项选（对的 + 页面从原词造的错的）。

- [ ] **Step 1:** 探针（主动变被动、被动变主动、强调句三种（强调主语 / 宾语 / 状语）、部分倒装还原、完全倒装还原、there be）；实现。
- [ ] **Step 2:** 真手指：拖、点选两种放法；拖的时候页面不滚；放错的提示；记作答。截图。
- [ ] **Step 3: 提交** `英语：句子变换 shift（视觉第 5 批）`

### Task 7: 舞台上句子的括号折行（先量，再定做不做）

舞台的句子（`stage/types/sentence*.js`）括号在折行时乱、标签叠成一摞。先写两个最小的试演放在 `evals/stage-gaps/` 下量：如果改动只在 `sentence.view.js` 的排版里、不碰别的东西的规则，就改，并把试演加进 `stage-must`；要动到舞台的排版引擎的，不做，记一条 Ruling（嵌套结构那一行由 `parse` 的层次图到 A）。

- [ ] **Step 1:** 量；定；做或记。`npm run check:stage` 全过。

### Task 8: 示例页、手册

**Files:** Create `kit/examples/en2-demo.html`（按第三节英语的表，B 的 7 行每行至少两张，共 16 张以上）；Modify `CLAUDE-PROJECT.md`（`parse` 一节加 `view:`、`~n`；新的 `parallel`、`shift` 两节）、`tests/en2-docs.test.js`、`package.json` 的 `check:pages`

- [ ] **Step 1:** 测试 → 写 → 通过；`npm run docs:size -- 英语`。
- [ ] **Step 2:** `v5-demo-hands.mjs`：每张要学生做的事做得到。
- [ ] **Step 3: 提交** `英语：示例页和手册（视觉第 5 批）`

### Task 9: 逐行验收、发布

- [ ] **Step 1:** 第三节英语的表逐行重评，不到 A 的回去改；评级写回设计文档。
- [ ] **Step 2:** 独立复查一次（一个）；Critical / Important 一次修完，每条先有失败的测试。
- [ ] **Step 3:** `npm test`、`npm run build`、`npm run check:pages`、`npm run check:stage`（动了舞台才跑）、`npm run e2e` 全过；版本号、`CLAUDE.md`、合进 `main`、发布学习台。
- [ ] **Step 4:** 写第 6 批（线代、数据结构的零星）的执行计划，接着做。
