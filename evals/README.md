# 验收（evals）

用「扮演老师」的方式量这套教学环境好不好用：子代理只拿老师能拿到的说明（`CLAUDE-PROJECT.md`、课堂每一轮的整份说明），
针对题库里的真题写实时黑板课和课堂输出，再报告「想做但做不到」的地方；页面检查脚本替它看渲染结果。
标准和计划见 `docs/quality-plan.md`。

- `tasks/`：题库，每门课一个文件（线代 8 题，408 每门 6 题），题面的数都核对过。
- `tasks/2/`：第二批（和第一批不重，线代 4 题、408 每门 5 题），阶段 5 以后重跑用：照着第一批改的组件，换一批题才看得出是不是真的好用。答案用组件的引擎算过一遍。
- `teacher-prompt.md`：给扮演老师的子代理的说明（每一轮都用同一份，结果才能比）。
- `runs/<轮>/`：每一轮的输出。
  - `system-<科目>.md`：那一轮课堂里的 Claude 拿到的整份说明（`node tools/eval-system.mjs runs/<轮>` 生成）。
  - `<科目>/<题号>.board.json`：实时黑板课；`<科目>/class.class.json`：课堂的三轮输出；`<科目>/friction.md`：摩擦报告。
  - `<科目>/<题号>.v2.board.json`：把页面检查报出的问题发回去，改一次之后的版本。
  - `score.md`、`score.json`：打分（`node tools/eval-score.mjs evals/runs/<轮>`）。
- `results.md`：每一轮的汇总，和基线比。

## 跑一轮

1. `npm run build`，`node tools/eval-system.mjs evals/runs/<轮>`。
2. 每门课开一个子代理，给它 `teacher-prompt.md`（把 `{RUN}`、`{SUBJECT}`、`{TASKS}` 换掉）。
3. `node tools/eval-score.mjs evals/runs/<轮>`，看 `score.md`。
4. 把每个文件的「错」发回给写它的子代理，改一次写成 `.v2.` 文件，再打一次分。
5. 汇总写进 `results.md`；摩擦报告里的「想做但做不到」并进 `docs/quality-plan.md`。

页面检查脚本单独用：`node tools/check-lesson.mjs 文件…`（`.md` 课件、`.html` 示例页、`.board.json`、`.class.json`），
`npm run check:pages` 检查全部示例页。要预装的 Playwright 和 Chromium（云端会话里有）。
