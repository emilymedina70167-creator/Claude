# 记忆的尺子

第十一轮（`docs/superpowers/specs/2026-11-14-round11-design.md` 第九节）：学习台的记忆有没有追上 claude.ai，不靠说，拿我的真课量。

## 话的账：我说的每一句都有去处

`tools/memory-ruler.mjs` 用页面同一套函数（`kit/src/memory/said.js`）把 8 节真课里我打的 90 句按真实的先后一批批过账，和开发标的标准答案比。

1. 存真数据（私人数据，不进 git）：`ArtifactData list` 把 `evidence`、`lessons`、每节课的 `sessions/{课}/class_turns` 存到 `.superpowers/audit/`。
2. 标准答案 `.superpowers/memory-ruler/gold.json`：每句 `cls`（`ask` 一定要记成要求、`not` 不该记、`either` 都行）和要求名（同一件事同一个名）；`required` 是一件都不能漏的；`merge` 是说了几遍、要并成一条的。我可以改，改了就照改过的重跑。
3. 一批批跑：`node tools/memory-ruler.mjs next .superpowers/audit --out .superpowers/memory-ruler/runN` 写出下一批的提示词，交一个互不知道的 Opus 助手写回答（`bNN.out.txt`）；缺句的再写一份只问缺的（`bNN.re.*`）。直到它说都答完了。
4. 打分：`node tools/memory-ruler.mjs score .superpowers/audit --out .superpowers/memory-ruler/runN --note "改了什么"`，结果追加进 `results.md`。

**合格线**：每句有去处 100%；`required` 一件不漏；不是要求记成要求 ≤ 2 句；`merge` 里每一件落在 1 条在用的要求上。不合格改话的账的提示词（`saidPrompt`），不改标准答案。

以后还要量（A3、A4 那一份计划）：「它眼里的你」（全新的 Claude 只读给老师的那一份记忆描述我，我看了说像才算过）；每节真课我说了第二遍的次数、犯了的要求、过账漏的句子；改完以后每轮出第一个字的时间不变慢。

## 记忆摘要：连着重写（第十三轮）

话的账停了以后，上面那把尺子量的东西不在线上了。摘要的尺子量的是另一件事：**一节课一节课重写下去**，摘要会不会丢事实、长出规矩、越写越长、把学生的话改了字。

```bash
node tools/summary-ruler.mjs next  <存数据的目录> --state <工作目录>          # 写出下一步的提示词 NN.prompt.txt
# 请一个不知情的 Opus 只看这份提示词作答，写到 NN.out.txt
node tools/summary-ruler.mjs apply <存数据的目录> --state <工作目录> NN NN.out.txt
node tools/summary-ruler.mjs score <存数据的目录> --state <工作目录>
```

- 从空的摘要开始，照开课的先后一节一步。提示词、读回、核长度、核引号用的是页面同一套函数（`summarydesk.js` 的 `classPrompt`，`summary.js` 的 `judgeRewrite` / `retryPrompt`）：量的就是线上的那一份。
- 和页面一样：只是写长了、引号里的话在记录里找不到，给一次重来（`apply` 写出 `NN.retry.prompt.txt`）；重来还不行这一步不收，摘要原样。
- 事实清单 `summary-facts.json`：一条 = 一个说明 + 一个正则 + 在哪一份里 + 从哪节课起该在。只放能公开的；带学生原话的另放在 `<存数据的目录>/facts-private.json`，`score` 两份都读（表里私有的只写编号）。
- 算数的标准：事实从出现起每一步都在；规矩词（必须、每次都、一律、务必、以后都；引的原话里的不算）0 处；没有一步连着两次超长；最后也没对上的引号 0 段。
- 存数据的目录：`ArtifactData list` 存下来的 `evidence/`、`sessions/*.json`、`sessions/{课}/class_turns/`、`sessions/{课}/report/main.json`，加上第一次重写当原料的 `rules/` `lessons/` `asks/` `profile/`。私人数据，放 `.superpowers/` 下面。
