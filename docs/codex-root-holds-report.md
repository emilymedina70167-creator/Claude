# 留着的题：交付给主控审查

基于 `claude/friendly-ride-l2f31n` 的 `018e2b2caaac1551b48df0228dd42006bcc2feae`，交付分支 `codex/root-holds`。只做第十二轮第 1 批 Task 6，不合并、不发布、不开 PR、不提交 `kit/dist/`，没有新增依赖。

## 做了什么

`kit/src/memory/holds.js` 是纯函数，不碰 DOM、不读系统时间：

- `HOLD_MAX = 4`、`HOLD_DAY = 1`、`HOLD_LATE = 3`。
- `needsHolds(session): boolean`：已下课、有目标的黑板课，排除复现、已有 holds、试满两次的课。
- `pickHolds({ session, drills, evidence, reserve }): string[]`：同块、活跃、没做过、非模考、不是目标原题的真题，最多四道；有明确 aim 对应时先覆盖不同目标。
- `holdBrief({ session, aims, items, subject, n, docs? }): string`：目标、课上题面、组件说明、同类和迁移的格式；多的可选 docs 用来带实际组件手册。
- `holdDocs(parsed, { session, at }): Array<{ id, doc }>`：编号、组件内 id 一起换成 `d-hold-课号-题序`；保存 hold、aim、far；缺类型、目标不存在、重复题序的不收。
- `holdState(session, today): 'none' | 'wait' | 'due' | 'late' | 'done'`。
- `laterOf(rows, { session, drills, today }): { n, right, days, far: { n, right } }`：只算本课留题、已交的结果，一次就对按 outcome=first 数。

`labdesk.js` 导出 `checkProblems(text, ctx): Promise<{ ok, bad }>`（不写库），以及 `renderCheck(md): Promise<string[]>`。ctx 包含 parseProblems 的参数、subject、existing。原 takeProblems 改成调用它再写库，原回执的题序保留。藏着渲染串行执行，结束恢复变量、场景和写法错误列表，避免两处后台验题互相污染。

`lab.js` 的 problemsBrief 多 hold 材料；parseProblems 识别「类型：同类 / 迁移」，保留为解析条目的 far，不改变原题库文档。`devmock.js` 回两道能实际渲染的模拟留题。

`desk.js` 的 `fixHolds()` 接在首页 sessions、drills、evidence 的订阅后台回圈：延后 500ms、一次一节、一次打开最多四节；报告正式写好才处理。先选真题，不够才用指定的 Opus 5.5 high、bg、cache=false 出题；旧接口不能指定模型的不调用，返回模型不是指定模型不收。先记尝试次数，防刷新中断后无限重试；检查通过才写 drills，重读最新课文档后用 update 补 holds，不盖别的字段。只有成功存下的题才进 ids，空手失败不写 holds。

## 核过的事及与原文不同的地方

- **schema 无需改**：drills 的编号正则是 `/^d-[A-Za-z0-9_-]+$/`，必填只有 md；`d-hold-c-20261116-1-1` 通过，有测试。
- 模考过滤直接复用 `exam/reserve.js` 的 `usable`，年份由首页 `readReserve` 读考试档案，和 drills.js 的过滤同一套；额外尊重题自身 reserve 标记。
- `mastery.js` 的 markFresh 加 hold；**另改 drillrun.js 一行**，让实际练习结算的 src 白名单也认 hold，否则只有 markFresh 认编号、练习结算仍当原题。浏览器测试确认首次 fresh=true、别课做过后 fresh=false。
- 任务未列出的 `tools/check-root-holds.mjs` 是可复跑的浏览器验收脚本，无新依赖，没有改被禁止的 `tools/desk-e2e.mjs`。
- **目标最多五件、题最多四道有冲突**：严格遵守四道上限，尽量覆盖不同目标，不伪造「每件已有一道」。
- 真题练习目前通常没有 aim 字段；仅凭 block 无法可靠推断目标对应的考点。显式 aim 时先覆盖，没有时只按同块补齐，不编造映射。后续若要保证逐目标覆盖，需要主控补明确映射。
- 在报告写好后处理；实际调用只在 fixHolds，一般材料缺失、权限不够、模型不对时保留已有真题，没题则只有 holdTries。题没凑齐但至少一道时如实保存数量，不显示虚假的完成数。
- 设计 6.7 的教案 hold、不能自动判的过程题留到下一节、首页「验上次学的」和写 sessions.later 是后续任务，本次没有越界实现。

## 验证

先红：创建 `tests/memory-holds.test.js` 后运行，得到：

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../kit/src/memory/holds.js'
tests 1, pass 0, fail 1
```

实现后针对性测试（holds、mastery、lab）转绿：

```text
tests 37
pass 37
fail 0
```

真实 Chrome 跑 `node tools/check-root-holds.mjs`：

```text
通过：生成，exam=0，made=2（同类和迁移各一道）
通过：真题，exam=2，made=0
通过：失败，holds=null
通过：错模型，holds=null
```

还验了刷新不重出、坏组件被拒、验题后恢复组件变量、练习结算首次新题。这是替身数据库和模拟模型的流程验证，没有调用生产 Claude。

本地 `pnpm run build` 通过；生成物没有加入提交。`git diff --check` 通过。

Windows 全套 `node --test` 第二轮结果：2372 项，2355 通过、16 失败、1 跳过。15 项来自原有 Windows 路径写法（no-modals.test.js 和 teach-run-lib.test.js 使用 URL.pathname，出现 `C:\C:\...`），未改这些不在本任务范围内的测试/工具。另一项 forecast 的「够快」在并发时 629ms 超时；按任务说明单独重跑全部 9 项通过，计时 279ms。时间相关用例按 UTC / Asia/Shanghai 运行，避免宿主纽约时区让既有日期断言偏一天。最终完整测试和 GitHub Linux 检查结果在交付时另行核对，不把本地全套说成全绿。

最终代码的 Windows 完整复跑（`TZ=UTC node --test --test-concurrency=2`）：2375 项，2359 通过、15 项上述路径失败、1 跳过；计时测试这次也通过。

GitHub Linux 的 [运行 43835048421](https://github.com/emilymedina70167-creator/Claude/actions/runs/43835048421)（代码提交 `9d6a963`）已经完成 `npm test`：2375 项，2373 通过、1 失败、1 跳过；唯一失败是任务已注明的 forecast「够快」（CPU 最小值约 202ms，大于原断言的 120ms）。本任务 37 项相关测试均通过，未修改该计时断言。该次构建成功，端到端流程仍在运行；由于前一步计时失败，「打包产物和源码一致」实际被跳过，不能把它写成已通过。

## 留给主控

根本规则、aims、report、memo、digest、课堂代码和发布文档均未改。请主控按 Task 7 接首页和 later，统一构建后合并发布。此分支刻意不提交 dist，所以现有 CI 的「打包产物和源码一致」一步预期会红；这与交接里的禁止提交 dist 一致，不能据此声称已发布。
