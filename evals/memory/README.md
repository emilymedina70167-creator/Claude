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
