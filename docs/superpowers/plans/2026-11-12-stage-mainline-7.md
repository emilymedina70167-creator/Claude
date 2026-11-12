# 舞台主线第七轮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第一节真课（英语 时态 `c-20261112-1`）留下的六件事：晚到的提示不演、对话放不下先省早轮的舞台样子、写错一行学生没东西可动、老师能递「下课吗」、同一个空算一道题、这节课的记忆数据。

**Architecture:** 底座不动。课堂循环（`loop.js`）多记「这一次叫老师的理由」，理由没了就 `drop()` 这一轮还没演的行；发给老师的对话换成纯函数 `fitHistory`；写法容错收两种、交给学生的手没演上时照 `askfail` 的规矩马上叫老师；`ask end` 交给课堂现成的 `endClass`；每次作答多记一个指纹 `sig`，报告按它分题。

**Tech Stack:** 原生 JS（ES modules）、`node --test`、Playwright（`tools/stage-try.mjs`、`tools/stage-touch-first.mjs`、`tools/desk-e2e.mjs`）、ArtifactData（第 6 节的数据）。

**Spec:** `docs/superpowers/specs/2026-11-12-stage-mainline-7-design.md`

## Global Constraints

- 事实归页面、教学归老师；页面不做教学决定；教学不预制；发给老师的话不说假话、不静默失效、不用「他」「她」；讲课只能是 Opus 5.5 high。
- 只有第 3 节（交给学生的手没演上）多一次调用，别处不多调用。
- `STAGE_TEACH + stageDoc(科目)` 每门课 ≤ 24576 字节（现在：数据结构 23961、线代 23469、操作系统 22802、英语 21151、组成原理 20997、计网 19772）；这一轮只加 `ask end` 一行。
- 不碰第六轮的东西（设计第 7 节的表）：`stage.js` 只动 `judgeValue`、写给老师的那一句、等学生那里的 `end`、一轮演完时的 `handMissed`、`exec` 记容错。
- 不用 `window.confirm / alert / prompt`；注释、界面文字、提交说明用中文。
- 改了 `kit/src/`：`npm run build` 和 `node proto/stage/build.mjs`，提交 `kit/dist/la-kit.js`、`kit/dist/docs/`、`proto/stage/dist/stage-demo.js`。
- 分支 `claude/admiring-cannon-4j7szs`；提交用 `.superpowers/ci.sh "说明" 文件…`；合并是快进到 `main`；不开 PR。
- 检查从轻：每件自己的测试；整套检查、旧试演重放、只读审查只在 Task 8 各一次。
- 真课数据在 `.superpowers/en1/`，不进 git。

## Review Focus

1. 叫老师的理由是「g1 很久没做到」，老师那一轮演到一半时学生做到的是**另一条**挑战 g2：照旧全演（理由没有没掉）（Task 2）。
2. 停演发生在老师那一轮的 `ask` 还没演到时：学生手上不能什么都没有——停下以后页面照常把「做到了 g1」发给老师，等的那一阵学生手上有预写的那一问或者「给个提示」（Task 2）。
3. 容错的 `say`：一行全是中文、但其实是老师想写的 `label` 之类（带引号）——不能当成话（Task 3 的 `lable a.1 "x"`）。
4. 交给学生的手没演上、可学生手上还有一问可答（`ask value`、`ask tap`）：不马上叫老师，学生有事可做（Task 4）。
5. 同一个名字 `r` 先后造成两句不同的句子，两次都问「哪个是谓语」：是两道题，不能并成一道（Task 6）。

---

## 文件

| 文件 | 负责 |
|---|---|
| `kit/src/stage/history.js`（新） | `fitHistory`：发给老师的对话放不下时怎么省 |
| `kit/src/stage/loop.js`（改） | 叫老师的理由、停演；`handfail` |
| `kit/src/stage/events.js`（改） | `triggers` 认 `handfail`；`end`、问话那几句 |
| `kit/src/stage/script.js`（改） | `ask end`；容错的 `say` |
| `kit/src/stage/scene.js`（改） | `open … back=` 拆两行；`ask end` |
| `kit/src/stage/stage.js`（改） | `handMissed`、`exec` 记容错、`end`、`judgeValue` 认问话 |
| `kit/src/stage/answer.js`（改） | `asksBack` |
| `kit/src/stage/evidence.js`（改） | `askSig`、问话记成说的话 |
| `kit/src/stage/classroom.js`（改） | `messages` 用 `fitHistory`、`onEndAsk`、证据带 `sig` |
| `kit/src/memory/report.js`（改） | `itemKey` 认 `sig` |
| `kit/src/stage/doc.js`（改） | `ask end` 一行 |
| `tests/stage-mainline7.test.js`（新） | 这一轮的单元测试 |
| `tools/stage-touch-first.mjs`（改） | 一段 `late`：一行一行喂、中途做到挑战 |

---

### Task 0: 旧试演的基线

- [x] **Step 1**：`bash .superpowers/wt.sh`（副本换到现在的 HEAD 并构建），`bash .superpowers/replay.sh run9`，把 `.superpowers/cmp3.mjs` 的 `run8` 换成 `run9`、读的基线换成 `try-now3.json` 的同一种格式；把这一次放回的结果另存成 `.superpowers/baselines/try-base7.json`（Task 8 拿它比）。
- [x] **Step 2**：确认 282 份都有结果（`跑完的段` 八段加起来 282）。不提交。

### Task 1: 对话放不下先省早轮的舞台样子（设计第 2 节）

**Files:** Create `kit/src/stage/history.js`；Modify `kit/src/stage/classroom.js`（`messages`）；Test `tests/stage-mainline7.test.js`

**Interfaces:**
- Produces: `fitHistory(msgs, { max, sysBytes = 0, keep = 3 }) → { msgs, stripped, dropped }`。`msgs` 是 `[{ role, content }]`（一问一答交替，第一条是 user）；`max` 是整份（说明 + 对话）的字节上限。先从最早的 user 条起把 `[舞台现在]` 到末尾那一段换成 `STATE_STUB`（最近 `keep` 条 user 不换），够了就停；还不够再成对丢最早的（第一条 user 留着，和现在一样）。`stripped`、`dropped` 是省了几条、丢了几对。
- Produces: `STATE_STUB = '[舞台现在]（这一轮的舞台现在页面省略了：对话放不下）\n\n写下一轮。'`

- [x] **Step 1：写测试**
  - `放得下时一字不改`：三条短消息，`max` 很大 → `msgs` 和传进去的深相等，`stripped === 0`。
  - `先省最早的舞台样子`：读 `.superpowers/en1/sessions/c-20261112-1/class_turns`（文件不在就 `t.skip`），照 `classroom.js` 的拼法拼出对话，`sysBytes: 138306`、`max: 200 * 1024` → `dropped === 0`，条数和原来一样，最后 3 条 user 里都有 `[舞台现在]\n（句子` 这类原文，最早一条 user（如果带舞台现在）被换成了 `STATE_STUB`。
  - `还不够才丢`：每条都很长、只剩 `keep` 条也放不下 → `dropped > 0`，第一条 user 还在，role 照旧一问一答交替。
  - `[学生] 那一段留着`：被省的那一条里 `[学生]` 到 `[舞台现在]` 之前的字原样在。
- [x] **Step 2**：`node --test tests/stage-mainline7.test.js`，FAIL（没有 `history.js`）。
- [x] **Step 3**：写 `history.js`；`classroom.js` 的 `messages` 里那个 `while (msgs.length > 3 && …) msgs.splice(1, 2)` 换成 `fitHistory(msgs, { max: HISTORY_MAX, sysBytes: bytes(sys) }).msgs`。
- [x] **Step 4**：PASS；`node --test tests/stage-class.test.js` 照旧过。
- [x] **Step 5**：提交「舞台：对话放不下时先省最早几轮的舞台样子，还不够才丢轮」。

### Task 2: 晚到的提示不演（设计第 1 节）

**Files:** Modify `kit/src/stage/loop.js`（`addEvent` 的 `stuck` / `tries`、`flush`、`teach`、`onGoal`）；Test `tests/stage-mainline7.test.js`、`tools/stage-touch-first.mjs`

**Interfaces:**
- Produces: `stuck`、`tries` 事件多 `goals: [挑战编号]`（`idleWhy().goals` 的编号；没有挑战时不写）。
- Produces: `S.flight.why`：`{ goals: Set }` 或 `null`——发出去的这一段里叫老师的事（`triggers` 为真的那几件）全是带 `goals` 的 `stuck` / `tries` 时，是它们的编号的并；有别的就是 `null`。
- Produces: `S.flight.turn`（`stage.begin()` 交出来的那一轮），`S.flight.cut`（停在第几行，没停是 `null`）。
- Produces: 停演时往 `stage.errors` 推一条 `{ line: 下一行的行号, src: 下一行的原文, error: '学生在那之前做到了 g1，这一行起没演（你这一轮是因为它很久没做到才被叫来的）' }`，跟着下一轮的「[上一轮没演的行]」发出去。

- [x] **Step 1：写测试**（假的舞台，照 `tests/stage-class.test.js` 的 `fakeClass` 再做一个 `begin()` 带 `drop` 计数、`push` 记下收到的字的版本）：
  - `理由是 g1、学生做到 g1：停`：舞台上挂一条挑战 g1；学生很久没动（直接 `addEvent` 不方便就照 `armIdle` 的路子把 `quietMs` 设成 1、等一下）→ 叫了老师；老师的 `call` 先 `onText` 两行、标 `playing`，再 `stage.onGoal(['g1'])` → `drop` 被调了一次；老师写完以后 `stage.errors` 里有一条含「学生在那之前做到了 g1」；接着又叫了一次老师（发出去的那一条里有「做到了挑战 g1」）。
  - `理由是 g1、学生做到 g2：不停`（Review Focus 1）。
  - `理由里有学生打的字：不停`：同一段里还有一条 `say` → `drop` 没被调。
  - `还没开演就做到：照旧作废整轮`（原来的 `stale` 那一条，不变）。
- [x] **Step 2**：FAIL。
- [x] **Step 3**：实现。`onGoal` 里：`S.flight?.playing && S.flight.why?.goals` 和这一下做到的编号有交集、`S.flight.cut == null` → 记 `cut`、推那条 error（行号取这一轮下一行要演的；拿不到就写「后面的行」）、`S.flight.turn.drop()`。`teach` 里 `turn.end` 照旧（`drop` 以后它会马上返回）。
- [x] **Step 4**：`tools/stage-touch-first.mjs` 加一段 `late`（照 `stream` 那一段在页面里一行一行喂，`window.LAStageDev` 有现成的 `loop` 就用它，没有就直接在页面里 `createLoop`）：挂一条挑战 g1 和预写 `@g1 say "对。"`，叫老师（理由 g1 很久没做到），老师的字一行一行到：`paint a.1 g1` / `say "操作：按住…"` / `say "提示：…"` / `ask next`；第 1 行演完时学生做到 g1（`stage.scene` 里直接满足 `when=`，再 `stage.onGoal`）。演完：画面上没有「操作：按住…」「提示：…」，有「对。」。
- [x] **Step 5**：单元测试 PASS；`node tools/stage-touch-first.mjs --only late,stream` 都对。
- [x] **Step 6**：提交「舞台：叫老师的理由没了（学生做到了那条很久没做到的挑战），那一轮剩下的不演」。

### Task 3: 两种写法容错（设计第 3 节 ①）

**Files:** Modify `kit/src/stage/scene.js`（`case 'open'` 的 `back=`）、`kit/src/stage/script.js`（`parseScript`）、`kit/src/stage/stage.js`（`exec` 记 kept）；Test `tests/stage-mainline7.test.js`

**Interfaces:**
- Produces: `parseScript` 对「开头不是指令、整行没有 `"` 也没有 `=`、中文字占一半以上」的一行返回 `{ cmd: 'say', args: [{ t: 'str', v: 这一行 }], opts: {}, forgiven: 'say', line, src }`；别的不认得的照旧 `{ cmd: null, error }`。
- Produces: `scene.js` 的 `open X 动作 … back="名字"` 不再抛错：照两行演（先 `open X 动作 …` 去掉 `back`，再 `open X back="名字"`），返回的 fx 带 `forgiven: 'open-back'`；拆出来的哪一行出错照常抛那一行的错。
- Produces: `stage.js` 的 `exec` 遇到 `c.forgiven` 或 fx 的 `forgiven`，往 `this.errors` 推 `{ line, src, kept: true, error }`：`say` 是「这一行没写 say，页面当成话照演了；下次写 say "…"」，`open-back` 是「back= 自己是一项：页面拆成两行 open 照演了；下次分开写」。

- [x] **Step 1：写测试**
  - `一整句中文当成话`：`parseScript('would 选对了：搬家在说话之后。但 would 后面要用原形 move，不能写 moved。')[0]` → `cmd === 'say'`、`forgiven === 'say'`；在 Scene 上 apply 以后 `scene.say` 就是那一句。
  - `拼错的指令照旧报错`（Review Focus 3）：`parseScript('lable a.1 "主语"')[0].cmd === null`；`parseScript('pnt s.2 g1')[0].cmd === null`（没有中文）。
  - `open … back= 拆成两行`：`array a = 3 1 2` / `keep a "原样"` / `open a move undo=on back="原样"` → 不抛；`scene.opens` 里有 `a:move` 那一项（带 undo）和 `a:back:原样`；fx 的 `forgiven === 'open-back'`。
  - `拆出来的一行错了照报`：`open a move back="没存过"` → 抛「没存过」那一句（`unsavedError`）。
- [x] **Step 2**：FAIL。
- [x] **Step 3**：实现。
- [x] **Step 4**：PASS；`node tools/stage-must.mjs evals/stage-gaps/fix1 --table fix1` 照旧都 ✓。
- [x] **Step 5**：提交「舞台：收两种写法容错（open … back= 拆两行、没写 say 的一句中文当成话），照演并告诉老师」。

### Task 4: 交给学生的手没演上，马上叫老师（设计第 3 节 ②）

**Files:** Modify `kit/src/stage/stage.js`（一轮演完那里，和 `askMissed` 同一处）、`kit/src/stage/loop.js`（`teach` 末尾）、`kit/src/stage/events.js`（`triggers`、那一句）；Test `tests/stage-mainline7.test.js`

**Interfaces:**
- Produces: `stage.handMissed`（布尔）：这一轮老师写了 `open`、一条 `open` 都没演上、演完 `scene.opens.size === 0`，并且学生手上也没有一问可答（`scene.waiting` 是空的，或者 `kind === 'next'`）。老师写了 `open` 就是要交给学生一只手，不猜话的意思。
- Produces: 事件 `{ kind: 'handfail', at }`；`triggers` 认它；`eventsText` 写「你这一轮交给学生的手（open）没演上，学生手上没有能动的：页面马上叫了你，重写那几行」。
- 规矩照 `askfail`：`S.askRetried` 那个开关两种共用（连着两轮都没演上就不再自动叫）。

- [x] **Step 1：写测试**
  - `open 没演上、手上没东西、只有按钮：马上叫`：用 `tests/stage-class.test.js` 那种假的课堂循环，假舞台演完时 `handMissed = true` → 叫了老师一次，发出去的那一条有那一句；下一轮还是 `handMissed` → 不再叫。
  - `学生手上还有一问：不叫`（Review Focus 4）：真的 Scene 演 `array a = 1 2` / `open zz move`（没有 zz）/ `ask tap a "点大的" expect=a.2` → `handMissed === false`；`没写 open 的轮：不叫`：`say "看一看"` / `ask next "看清了"` → `false`。
  - `有别的手开着：不叫`：`open a` 演上了、`open zz move` 没演上 → `handMissed === false`。
  - `课上那一下`：`sentence r = "Each year researchers publish papers."` / `keep r "原句"` / `open r move undo=on back="原句" wrong=zz`（拆了以后 `wrong=zz` 让 move 那一行照样出错，back 那一行演上了——back 按钮算不算「能动的」：不算，它只是回去）/ `ask next "拖好点下面" button="就这样"` → `handMissed === true`。实现时 `opens` 里只有 `action === 'back'` 的那几项当成空。
- [x] **Step 2**：FAIL。
- [x] **Step 3**：实现。`stage.js` 算 `handMissed` 只用这一轮的 `errors` 里 `cmd` 是 `open` 的行（`parseScript(e.src)[0]?.cmd`）和演完的 `scene`；`loop.js` 在 `askMissed` 那几行旁边照样写一组。
- [x] **Step 4**：PASS；`node --test tests/stage-class.test.js` 照旧过。
- [x] **Step 5**：提交「舞台：交给学生的手没演上、学生手上没东西可动时，马上叫老师重写」。

### Task 5: `ask end`（设计第 4 节）

**Files:** Modify `kit/src/stage/script.js`、`kit/src/stage/scene.js`（`case 'ask'`）、`kit/src/stage/stage.js`（等学生那里）、`kit/src/stage/classroom.js`（`endClass`、`stage.onEndAsk`）、`kit/src/stage/events.js`、`kit/src/stage/doc.js`；Test `tests/stage-mainline7.test.js`、`tools/desk-e2e.mjs` 的 `stage` 段

**Interfaces:**
- Produces: `ask end "话"`：`script.js` 的 `ask.end` 认 `button`；`scene.waiting = { kind: 'end', … }`。
- Produces: `stage.onEndAsk`（可选，`async (w) → boolean`，下了课是 `true`）。等学生时 `w.kind === 'end'`：有 `onEndAsk` 就调它，`true` 交 `{ type: 'end' }`，`false` 交 `{ type: 'next', button: '接着上' }`；没有就画一个按钮（`w.button || '下课'`），点了交 `{ type: 'end' }`。
- Produces: `classroom.js` 的 `endClass({ asked = false } = {}) → boolean`（下了课是 `true`）；`stage.onEndAsk = () => endClass({ asked: true })`。`asked` 时不再查 `loop.flight`（这一问是老师这一轮演完才挂的）。
- Produces: 写给老师的那一句：`end` →「学生点了「下课」」；`next` 带 `接着上` 照现在的写法（「学生点了「接着上」」）。课堂循环收到 `end` 不叫老师。
- Produces: `doc.js` 每门课一行：`ask end "今天先到这里？"   学生说要下课时写：页面弹出下课的确认，学生点了才下课（你自己下不了课）`。

- [x] **Step 1：写测试**
  - `ask end 写得进去`：Scene 上 `ask end "今天先到这里？"` → `waiting.kind === 'end'`；`ask end "x" expect=a` → 抛「ask end 认得的选项」那种报错（`checkOptions` 现成的）。
  - `说明里有那一行、不超字节`：六门课的 `STAGE_TEACH + stageDoc(科目)` 都含 `ask end "今天先到这里？"`、都 ≤ 24576。
  - `接着上`：`eventsText` 对 `{ type: 'next', button: '接着上' }` 写「学生点了「接着上」」；对 `{ type: 'end' }` 写「学生点了「下课」」，`triggers` 对它为假。
- [x] **Step 2**：FAIL。
- [x] **Step 3**：实现。
- [x] **Step 4**：e2e 的 `stage` 段加几步（`?dev` 的模拟老师加一句暗号「测试:下课」：写 `say "那今天就到这里。"` / `ask end "今天先到这里？"`）：输入框打「测试:下课」→ 弹出「下课吗？」确认框 → 点「接着上」→ 课还在、下一轮老师那里收到「学生点了「接着上」」；再打一次、点「下课」→ 走到下课小结。
- [x] **Step 5**：PASS；`node tools/desk-e2e.mjs --only stage` 过；`node .superpowers/size.mjs` 每门课 ≤ 24576。
- [x] **Step 6**：提交「舞台：老师能把「下课吗？」递给学生（ask end：弹出和顶上下课按钮同一个确认）」。

### Task 6: 同一个空算一道题、答案框里的问话（设计第 5 节）

**Files:** Modify `kit/src/stage/answer.js`、`kit/src/stage/stage.js`（`judgeValue`、写给老师的那一句）、`kit/src/stage/evidence.js`、`kit/src/stage/classroom.js`、`kit/src/memory/report.js`；Test `tests/stage-mainline7.test.js`

**Interfaces:**
- Produces: `asksBack(text, spec) → boolean`（`answer.js`，纯函数）：交上来的字（去掉首尾空白）以 `?` `？` 结尾，或者含中文而 `spec.answer` 里没有中文。
- Produces: `judgeValue` 里 `asksBack` 为真：返回 `{ type: 'value', text, asks: true, right: null, answer: 显示的答案 }`（不判、不晃红框）；写给老师：`学生在答案框里打了一句问话：「${text}」（不算一次作答）`。
- Produces: `askSig(w, scene) → string | null`（`evidence.js`）：
  - `value`：`value|${w.type || ''}|${String(w.answer ?? '').trim()}`；
  - `tap` / `pick`：`${kind}|${[].concat(w.expect).join(' ')}|${objText}`，`objText` 是预期那几处所在的东西现在的字（句子的词照 slot 排、一排格子的值、树的结点值；别的种类用 `o.type:o.id`），截到 200 字；
  - 挑战（`goalSig(g)`）：`goal|${g.id}|${g.text}|${g.when || ''}`。
- Produces: `actEvidence(a, { comp, q, goalText, sig })`：每条 record 多带 `sig`（给了才带）；`a.type === 'value' && a.asks` → 不出 record，出 `say: a.text`。按钮判的挑战没做到那一条用 `goalSig`（`goalText` 旁边再传 `goalSig: (id) => …`）。
- Produces: `classroom.js` 的 `evidence.goal` 和 `evidence.act` 把 `sig` 传进去。
- Produces: `report.js` 的 `itemKey(ev)`：`ev.type === 'stage' && ev.sig` → `` `${ev.sig}|舞台` ``，别的照旧。

- [x] **Step 1：写测试**
  - `asksBack`：`asksBack('simply什么意思', { answer: 'would happen' }) === true`；`asksBack('would happen', { answer: 'would happen' }) === false`；`asksBack('过去', { answer: '过去' }) === false`；`asksBack('is it would?', { answer: 'would happen' }) === true`。
  - `同一个空问两次、先错后对：一道「改对了」`：两条 record（`comp: 'S41'`、`'S43'`，`q` 不一样，`sig` 一样，`ok: false` / `true`）→ `itemsOf` 一项，`outcome === 'ok'`。
  - `同一个名字造成两句不同的句子：两道`（Review Focus 5）：`sentence r = "A b c."` 时的 `askSig({ kind: 'tap', expect: 'r.2' }, scene)` 和重造成 `sentence r = "X y z."` 以后的不一样。
  - `问话记成说的话`：`actEvidence({ type: 'value', text: 'simply什么意思', asks: true, right: null }, { comp: 'S39' })` → `records` 空、`say === 'simply什么意思'`。
  - `以前的证据照旧分`：没有 `sig` 的两条 record（`comp` 不同）→ 两项。
- [x] **Step 2**：FAIL。
- [x] **Step 3**：实现。
- [x] **Step 4**：PASS；`node --test tests/memory-*.test.js tests/stage-lesson-en1.test.js` 照旧过。
- [x] **Step 5**：提交「报告：舞台上同一个空算一道题（作答带这一问的指纹）；答案框里打的问话不算作答」。
- [x] **Step 6：发布一次**：版本号加一档（`CLAUDE-PROJECT.md` 第 3 行），`npm test`、`npm run build`、`node proto/stage/build.mjs`、`node tools/desk-e2e.mjs --only stage,stagestuck,stagedrill` 过，提交、推分支、快进 `main`，发布学习台和舞台试课（`CLAUDE.md`「发布」）。

### Task 7: 这节课的记忆数据（设计第 6 节）

**Files:** Create `.superpowers/en1/fix7.mjs`（不进 git）

- [x] **Step 1**：重新取这几样的现在版本：`errors/EN-L1-02`、`errors`（这节课的，看最大的编号）、`weaknesses/W40`、`weaknesses/W43`、`sessions/c-20261112-1`。
- [x] **Step 2**：写 `fix7.mjs`：拼出要写的四份（`EN-L1-02` 的更正；三条新错题，编号接着这一门课最大的往下排），每份过 `kit/src/memory/writer.js` 的 `validateWrite`（角色 `chat`），弱点挂错题照 `memo.js` 的写法（错题写 `weakness`；弱点的 `errors` 加上新错题的编号，不改 `level`，弱点是状态类：只改 `errors`、`last`，不碰 tracked 的字段就不用记 log）。原话照这节课 `class_turns` 里老师那几行（第 35、77、84 轮的 memo 块）逐字抄，题目照那一轮的 `ask`，证据：
  - `EN-L1-02`：`q`「写出整句的中文翻译」、`mine`「每年研究人员发表数百万的论文在3万多种期刊上」、`evidence: ['ev-mwd5qyub-76byq']`，加 `fix: { by: 'chat', date: '2026-11-12', note: '原来挂在找谓语那一问上，改成翻译那一问（课上页面的编号对不上）' }`。
  - would moved：证据 `ev-mwd609nl-4c67t`，题目第 33 轮的 `ask say`。
  - has nearly：证据 `ev-mwd75fba-gsqa9`，题目第 75 轮的 `ask pick`，`weakness: 'W40'`。
  - natural sciences：证据 `ev-mwd7f0yo-09qt2`，题目第 82 轮的 `ask say`，`weakness: 'W43'`。
- [x] **Step 3**：先只打印要写的 batch（不写），自己核一遍原话和编号。
- [x] **Step 4**：`ArtifactData batch` 写进去，每条钉 `if_version`（新建的不钉）。
- [x] **Step 5**：再读一遍这几条，确认写进去的就是打印的那份；学习台首页打开一次（`meta/memcheck` 会跟着更新）以后读 `meta/memcheck`，只多「历史类改了」那一条提醒。不提交（数据不进 git）。

### Task 8: 收尾

- [x] **Step 1**：`npm test`；`npm run check:stage`；`npm run check:pages`；`npm run e2e` 全量；六张表 `fix1` `new2` `new3` `new4` `new5` `first`；`node tools/stage-touch-first.mjs`；`node .superpowers/size.mjs`。
- [x] **Step 2：旧试演重放**：`bash .superpowers/wt.sh`、`bash .superpowers/replay.sh run10`，和 Task 0 的 `try-base7.json` 比。不同的只许是：以前报没演上、现在照容错演上了的行（`open … back=`、没写 say 的中文）。逐条列进 rulings。
- [x] **Step 3：真课放回**：时态课第 18、35 轮那两段写成一幕试演（`.superpowers/en1/`），`node tools/stage-try.mjs`：`open r move … back=` 演上了、那句纠正学生看得到；发给老师的有 kept 的那两句。
- [x] **Step 4：只读助手审一次**（一个 general-purpose 助手，只读）：给它设计、计划、`git diff` 这一轮的改动。问：第 1 节停演、第 3 节容错、第 4 节 `ask end` 有没有页面替老师做教学决定；第 5 节的指纹会不会把不同的两道题并成一道、或者把同一道分成两道；`fitHistory` 有没有让老师拿到假的东西。要紧的修，一条一个测试；不修的记进 rulings。
- [x] **Step 5：文档**：`docs/stage-mainline.md` 加「第七轮」一节（把「第一节真的舞台课以后」里那几条「等我定」改成做了什么）；`CLAUDE.md` 舞台那一条接一句；做的时候自己定的事写成 `docs/superpowers/specs/2026-11-12-stage-mainline-7-rulings.md`；计划的勾打完。
- [x] **Step 6：发布**：版本号加一档，build 两处，提交、推、快进 `main`，发布学习台和舞台试课。告诉我：每件做成了什么、哪些没做为什么、上课时请留意的两三处。
