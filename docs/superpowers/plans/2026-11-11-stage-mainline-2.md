# 舞台主线第二轮：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**：补四件老师现在做不成的事：一排格子能空着、能插入式地拖、能写数；挑战里直接写式子；字跟着拨盘变；图交给学生动手。都不判对错，只做「做不做得到」和事实。

**架构**：每件事的纯函数部分（规则文件、读写法、算量）先写 `node --test`；画面那一半照 `docs/stage-types.md` 的把手（`grips`）接通用手势层，不另写手指的代码；每件事一幕真的试演放 `evals/stage-gaps/new2/`，表 `NEW2` 在 `tools/stage-try-lib.js`。

**技术**：同第一轮。

**设计**：`docs/superpowers/specs/2026-11-11-stage-mainline-2-design.md`。

## 全局约束

- 分支 `claude/admiring-cannon-4j7szs`（现在和 `main` 一样）；不开 PR。
- 页面不判对错：这一轮的规则文件都没有 `next` / `judges` / `doneBy`。
- 重放不等于旧课：新加的当场报只看 `!c.lenient`；新加的状态变化（收拾、换读法）重放时照做。
- 新加在场景、东西上的字段，`clone()` 要带上；刷新照 log 放回要一样。
- 说明每门课 ≤ 24576 字节。发给 Claude 的话不用「他」「她」。
- 浏览器里看用副本：主目录的 `proto/stage/dist` 只在跑旧课重放的基线以后才重新构建（这一轮的基线就是 `main` 现在的构建，先存下来再动）。
- 提交说明最后两行：

```
Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014f77bBNhfQR7uQEB9NdAJp
```

## 审查要盯的

1. 旧课里的 `open a`（两格对调）、没写 `options=` 的 `dial`、没有 `{名字: …}` 的句子、`when=` 里没有 `{…}` 的挑战：行为逐字不变。
2. 空格子进了一排以后，原来假设「每格都有值」的地方（`a sorted`、`compare`、`{a.3}`、`swap`、分组染色、`hop`）不崩、不说假话。
3. 句子跟着拨盘重排以后，学生拉好的括号、`key`、折起来的段、正在等的那一问指的词，都照实（跟不了的写进现状）。
4. 能拨字的拨盘在原来只认数的地方（式子里 `{t + 1}`、`group a stride=t`、`ask value answer={t}`）当场报，不默默当成数。
5. 图上选的边在同名重造、`take` 拿掉结点、跟着拨数重造以后还对得上；有向图上判断式不说假话。

---

### Task 0：基线

- [ ] 旧课重放的基线就是第一轮最后跑的那一份「现在」（`.superpowers/baselines/try-now.json`，代码是 `4a639e1`，之后只改了重造那一句话）。拿它当这一轮的基线：`cp` 成 `try-base2.json`。
- [ ] 副本 `/home/user/Claude-wt` 重新建（`git worktree add --detach`、软链 `node_modules`）。

### Task 1：A 一排格子

**文件**：`kit/src/stage/types/array.js`、`array.view.js`、新建 `array.rules.js`、`types/index.js`、`tools/stage-try-lib.js`、`tools/stage-try.mjs`、`tools/stage-touch.mjs`；测试新建 `tests/stage-array-rules.test.js`，改 `tests/stage-scene.test.js`（第一轮 D1-6 那条里「`_` 当场报」换成能造）。

- [ ] 测试（先红）：`_` 造成空格子、现状写 □、`write a.3 _`；空格子拿不起来；`{h.1}` 跟着空格子是「还空着」；`a sorted` 有空格子判不了。
- [ ] 测试：规则的手势 `move`——放到另一张上交 `swap a#6 a#1`、放到空隙交 `move a#6 -> a.2`、放回原处报「还在原处」、分开排着跨泳道报错；`edit` 交 `write a.3 26`、不是数报错；`actOf` 把三种指令读回动作；`check` 跨泳道 `legal: false`。
- [ ] 测试：量 `inv(a)`、`inv(a.2-5)`、`blank(a)`；不全是数 `undefined`、有空格子 `null`；现状里「页面算的：inv(a) = …」。
- [ ] 测试：`open a move` 能开、和 `open a` 一起开当场报、`open a move wrong=mark` 当场报、`open a.1 a.2 edit` 只开两格。
- [ ] 实现数据和规则；画面（`grips: cell / gap`、空格子的样子、拎起来放下）照 `68ff091`。
- [ ] 试演工具的学生写法 `move` / `write`（一排格子）；`new2/A.txt`；`stage-touch.mjs` 加一段。
- [ ] 说明三行；提交。

### Task 2：B 挑战里直接写式子

**文件**：`kit/src/stage/goal.js`、`scene.js`（`goal` 那一段的 `objectsIn` / `blockedByHidden`、`collectSpec`）；测试 `tests/stage-goal.test.js`。

- [ ] 测试（先红）：`when="{A B - B A} = O"` 写下时不成立照收、学生改成可交换以后做到；`when="{det(A)} = 0"`；两边都是式子；式子里的东西全藏着又没有开着的照旧拦；式子算不出来是「判不了」；现状里写式子和现在的值；`collect={A v}`。
- [ ] 实现；`new2/B.txt`；说明半行；提交。

### Task 3：C 字跟着拨盘变

**文件**：`kit/src/stage/script.js`（`parseRich` 多一种 `pick`）、`scene.js`（`dial … options=`、`set`、`checkRich`、现状、句子的跟着变）、`stage.js`（拨盘上写词、`richInto` 画 `pick`、跟着变）、`goal.js`（`t = 将来`）、`types/sentence.js`（模板、跟着拨盘 `rewrite`）、`tools/stage-try-lib.js`（`学生: dial t 将来`）；测试 `tests/stage-scene.test.js`、`tests/stage-sentence.test.js`、新建 `tests/stage-pick.test.js`。

- [ ] 测试（先红）：`pickText('{t: a | b | c}', 值)` 的纯函数（读写法、套一层、段数对不上报错、段里有 `|{}` 报错）。
- [ ] 测试：`dial t = 现在 options="过去 现在 将来"`；`set t 将来`；现状；`when="t = 将来"`；写了 `range=` 又写 `options=` 报错；能拨字的拨盘进式子报错。
- [ ] 测试：`label` / `card` / `goal` 的字里 `{t: …}` 跟着变；`say` 是说的那一刻。
- [ ] 测试：句子 `sentence s = "I {t: was holding | am holding | will be holding} it steady."` 造出来是 am holding；`set t 过去` 以后词变了、别的词的编号（`#`）不变；拨回去变回来；现状里那一句。
- [ ] 实现；`new2/C.txt`（学生拨时间、拨回去，句子跟着）；说明四行；提交。

### Task 4：D 图

**文件**：`kit/src/stage/types/graph.js`、`graph.view.js`、新建 `graph.rules.js`、`types/index.js`、`tools/stage-try-lib.js`、`tools/stage-touch.mjs`；测试新建 `tests/stage-graph-rules.test.js`。

- [ ] 测试（先红）：`choose` / `unchoose`；量 `chosen` `weight` `pieces` `visited`；判断式 `tree` `cyclic` `connected`（三角形加一条悬着的边的几种选法）；事实那一句、成圈时写出那个圈；有向图 `g tree` 报错；`take` 拿掉结点以后它的边不算选着。
- [ ] 测试：手势 `choose`（点边）、`visit`（点结点）、`tag`（点结点写数，∞）；`open g choose` 能开；`wrong=` 当场报。
- [ ] 实现数据、规则、画面（选进的边画粗金线；把手 `edge` / `node`）；试演工具 `学生: choose g.A~B`、`visit g.A`、`tag g.A 5`；`new2/D.txt`；`stage-touch.mjs` 加一段点边。
- [ ] 说明四行；提交。

### Task 5：文档

- [ ] `docs/stage-mainline.md` 加「第二轮」；`CLAUDE.md`；版本 `2026-11-11b`；`evals/stage-gaps/stage-doc.txt` 重新生成；rulings。

### Task 6：收尾

- [ ] 副本里：`check:stage`、`fix1`、`new2`、舞台两段 e2e。
- [ ] 旧课重放 282 个文件（分 8 段，副本里跑），和 `try-base2.json` 比，不同的列进 rulings。
- [ ] 派一个助手只读地审（`code.diff`，盯上面五条）；严重、要紧的修（先写测试）。
- [ ] 主目录构建、`npm test`、`check:stage`、`check:pages`、`e2e` 全过；合进 `main`；发布学习台、舞台试课。
