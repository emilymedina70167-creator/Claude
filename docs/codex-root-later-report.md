# 首页「验上次学的」交付

基线：`claude/friendly-ride-l2f31n` 的 `8f7239bacd72ce52a49346fefb61deb948f0671b`。交付到 `codex/root-later`，不合并、不开 PR、不发布，不提交 dist、不加依赖。上一件主控补过的 originals、by=page、先抄题再留题均保留。

## 实现

- 首页「今天」多 `later` 行及抽屉，按钮沿用现成样式，至少 44px；只在 due / late 时显示，列最早那节课的标题和题数，不显示编号。日期沿用 tick / schedule，数据沿用订阅 / paintRows。展开后数据变化会重画，再点开始时重新取最早那节，防止旧面板开错课。
- 开课走 openOne，按钮进入 OPENERS，写 kind=drill、items=holds.ids、hold=原课号、title=验上次学的；已有同一原课的未关闭练习会接着做，不另开一节。
- closeDrill 在关闭练习前调用 writeLater。只有全部留题都有提交结果才写；跳过、未提交、做到一半退出不记完整测验。没有 later 时首页继续保留。练习小结对未完成的留题明确写「这次交了几道，留题还没做完」。
- 以前的课列表和详情均有课后那一行；详情从报告读 aims 的四种状态，显示 can 和 STATUS_TEXT，不显示 a1 / a2。没有报告时按原始 aims 算现有证据状态。
- 班主任 headSystem 多最近五节有 aims 的课，写目标、报告的状态和 later 的事实，不宣布学会。首页按 report.at 缓存读取最近五份报告，更新时重读，不把整份报告每次发给模型。原 150 KiB 预算测试及带新材料的预算测试通过。
- lesson-audit-lib 的 auditLesson 支持 report 参数，优先取 report.aims，否则 session.aims；later 来自 session.later。文字版各加一行。命令行入口也接上读取 sessions/课号/report/main.json。

新增导出：

| 文件 | 名字及签名 | 用途 |
|---|---|---|
| holds.js | `writeLater(db, drillDoc, rows, { drills, today }): Promise<void>` | 读原课最新文档，只 update later；已有字段不重写、课不存在就返回 |
| holds.js | `laterLine(later): string` | 同一份结果文案用于页面、班主任、审计 |
| holds.js | `aimLines(session, report?): string[]` | 目标和四种状态，不带目标编号 |
| holds.js | `dueHolds(sessions, today): Session[]` | due / late 的课，最早的在前 |
| drills.js | `heldDrillIds(sessions): Set<string>` | 尚未验的留题统一保护名单 |
| holds.js | `pickHolds({ session, drills, evidence, reserve, sessions? })` | 多传 sessions，防两节课留同一道题 |

写回的字段：`later: { n, right, days, far: { n, right }, at, drill }`。right 按 outcome=first 数，far 按题库的 far 字段数。同一个数据库实例、同一原课的并发结算串行，第二次重新读取时发现已有 later 就不写。更新的是一个字段，不把读取到的整份课文档写回去。

## 选题入口核查

| 入口 | 处理 |
|---|---|
| drills.js pickDrills（普通练一练） | 用所有 sessions 的 holds.ids 排除；不限 src，真题也保护；有 later 后自动放回普通题库 |
| journey.js warmupDrills（课前热身） | 同一份排除名单；不碰数据库 |
| drillrun.js enterDrill（以前已经开出的普通练习） | 进入时现读 sessions，普通练习也不能绕过保护；专门的 hold 练习及只读回看保留原行为 |
| drills.js drillPack（带着没过的开课） | 排除仍受保护的题；closeDrill 回写 later 后刷新 mem.sessions，完成测验后可以正常带着开课 |
| sentry.js（教研室的新题、探题计数） | 排除被留着的题，不能拿它们冒充当前可用的新题 |
| lab.js problemsMaterial（教研室出题材料） | 排除被留着的题，不提前把题面交给其他出题任务 |
| holds.js pickHolds（别的课留题） | 排除已被某节未验的课留着的题，避免重复分配 |
| desk.js 普通题库的数量文案 | 排除保护题，避免明明被留着却写「最近都做对过」 |
| 原题入库 harvestDrills、历史统计、题库查重 | 保留；它们不挑题给学生，也不把留题拿去当其他任务的原题 |

普通练习、热身、带着开课、教研室材料和计数均有回归测试。新增参数从现有 mem / sessions 传入，纯函数没有读数据库。

## 验证

先写 tests/memory-later.test.js，运行先红：

```text
SyntaxError: .../holds.js does not provide an export named 'writeLater'
tests 1, pass 0, fail 1
```

实现后相关测试（later、lesson-audit、head-context、drills、journey、sentry）：58 项全过。包括保留别处新字段、已有 later 不改、并发只写一次、原课不存在、未交 / 半份 / 跳过不写、验后解除保护、报告状态、最近五节、150 KiB 预算。

最终全套：`TZ=UTC node --test --test-concurrency=2`，2390 项：2374 通过、15 失败、1 跳过。失败仍是之前报告过的 Windows URL.pathname 路径错误（no-modals 一项、teach-run-lib 十四项），本次相关用例无失败；计时测试本轮通过。队列第 3 件已经专门安排修这些测试，本分支没有提前改那一件的文件，也没有把全套说成全绿。

`pnpm run build` 通过。浏览器验证命令：

```text
pnpm run build
node tools/check-root-later.mjs <截图目录>
```

本机用已有 Chrome，设置 HOLDS_BROWSER 为 Chrome 路径，NODE_PATH 指向运行时已有 Playwright；没有安装仓库新依赖。脚本在 820×1180 和 1180×820 各走了一遍：当天无行 → 隔天出现 → 点击开始 → 两道题实际填答、判分 → 注入 `LAKitDev.failWrites(1, 'sessions')` → 结果重试成功 → 回首页行消失 → 原课 later 是 2 道一次对 2 道、迁移 1 道对 1 道 → 以前的课显示「隔 1 天做没见过的题」。截图文件名为 `820-首页.png`、`820-结果.png`、`1180-首页.png`、`1180-结果.png`。已查看竖屏首页及横屏结果截图；截图时关闭过渡动画，避免假时钟截在页面淡入中间。

## 边界及留给主控

- 任务特别强调「做到一半退出不写 later」，因此采用全部 holds.ids 都已提交的门槛，较「n>0 就写」更严格；否则半份测验会永久占掉那节课唯一一次结果。
- 主控禁止改的课堂、session.js、digest.js、memo.js、report.js、desk-e2e.mjs、CLAUDE 文档均未修改。这里单独交 tools/check-root-later.mjs，按队列安排由下一件并入 e2e 的 later 段。
- 数据库目前使用既有 get / update API：同页并发已串行、别的字段不会覆盖；没有假定平台具备未说明的事务 API。两个独立浏览器同时完成同一原课时，跨客户端的原子「仅一次」仍需平台事务或条件写能力，主控需确认；本分支不声称解决了该平台层竞争。
- 这一个分支只交 Task 7。队列后续的黑板课默认值、不打扰、测试卫生和只读审查没有混进本次改动。
