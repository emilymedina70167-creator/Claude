# 舞台的缺口尺子：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**：量出「Claude 想做的视觉交互和判定，舞台接不接得住」，产出一张排好序、有证据的缺口单 `docs/stage-gaps.md`。

**做法**：
- 先做一个只读舞台的小工具 `tools/stage-try.mjs`：把一幕镜头指令和几步学生动作放到真的舞台上演，用的是和学习台同一份课堂循环 `createLoop`，老师那一端换成假的。输出老师会看到的全部东西。
- 再分两步开助手：10 个写理想演法，3 个拿工具对照舞台写、演。
- 最后由主会话复核，写缺口单。

**技术**：Node 22、`node --test`、esbuild（`proto/stage/build.mjs`）、Playwright + Chromium（`tools/playwright.mjs`）、`ArtifactData`（读学习台的教材和记忆）、`Agent`（后台助手）。

**设计**：`docs/superpowers/specs/2026-11-06-stage-gap-ruler-design.md`（执行的人两份都读）。

## 全局约束

- 不改 `kit/src/` 下的任何文件。每个任务提交前，`npm run build` 之后 `git status` 里不能有 `kit/dist/` 的变化。
- 注释、提交说明、输出文字都用中文。提交说明末尾带：
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014f77bEv6dHb3CuP9CXQj8f
  ```
- iPad 尺寸：竖屏 820×1180，横屏 1180×820。截图只给助手和我看，`deviceScaleFactor: 1`。
- Playwright 一律从 `tools/playwright.mjs` 取，不 `npm install playwright`。
- 助手只许写 `evals/stage-gaps/` 下面，不许改别的文件。
- 发给助手的说明里，提到学生不用「他」「她」。
- 学习台的地址是 https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo，只读，不写。
- 10 块的编号固定：
  - 线代：`L1` 块 4（可交换、方阵的幂、f(A)）、`L2` 线性方程组、`L3` 特征值和相似对角化
  - 数据结构：`D1` 希尔排序、`D2` AVL、`D3` Dijkstra 和最小生成树、`D4` 快排划分和堆排序
  - 英语：`E1` 时态、`E2` 多层从句的长难句、`E3` 非谓语动词

## 要特别查的五种情况

1. **一幕里老师的某一行写错了。** 工具照常往下演，把报错原文写进输出，不卡住、不退出。由 Task 2 的例子 `edge.txt` 守着。
2. **学生的一下让页面叫了老师，但文件后面没有老师的段了。** 工具写「这里页面叫了老师」和发过去的那一整条，然后停下，不挂住。由 `edge.txt` 守着。
3. **学生要动的东西没有交给学生（没 `open`）。** 输出写「没交给学生，学生动不了」，不抛错。由 `edge.txt` 守着。
4. **动画没走完就量、就截图。** 每一段老师的行等 `turn.armed`，每一步学生动作等 `stage.studentChain` 和 `stage.reacting`，然后再等 900 毫秒。由 Task 2 第 4 步人工看截图守着。
5. **以「接着」结尾的一轮，循环会提前要下一轮（抢跑）。** 下一段老师的指令不能被演两次，也不能被吞掉。由 `edge.txt` 守着：`ask next` 之后接 `学生: next`，再接一段老师的行，那一段只演一次。

---

### Task 1：读文件的纯函数和测试

**文件**：
- 新建：`tools/stage-try-lib.js`
- 测试：`tests/stage-try.test.js`

**接口**：
- 产出 `parseTry(text: string) → Step[]`：
  - `Step = { kind: 'teacher', src: string, line: number } | { kind: 'student', how: 'do' | 'answer', cmd: string, args: string, src: string, line: number }`。
  - 连着的老师行并成一个 `teacher` 段，`src` 是这几行原样用 `\n` 连起来，`line` 是第一行的行号（从 1 起）。
  - `学生:` 或 `学生：` 开头的一行是一个 `student` 步，`cmd` 是冒号后的第一个词。
  - `how` 的规则：`write` / `swap` / `move` / `vec` / `mul` 是 `'do'`（直接动画面）；`tap` / `drag` / `value` / `say` / `next` 是 `'answer'`（回答正在等的那一问）。别的词抛错，错误里写行号和「学生能写的：write swap move vec mul tap drag value say next」。
  - 空行和 `#` 开头的行跳过。
- 产出 `formatReport(r: TryResult) → string`：
  - `TryResult = { file, views: [{ tag, steps: [{ step, played, errors: [{ line, src, error }], state, goals: [{ id, text, status }], called: null | { why, msg }, pending: string, untouched: string | null, issues: [{ what, a, b }], shot }] }] }`。
  - 每个视口一节（`## 竖屏` / `## 横屏`），每一步一小节（`### 第 N 步：老师 第 L 行起` / `### 第 N 步：学生 第 L 行 write B.1,1 2`），下面依次是：
    - `没演上的行：`（没有就不写）
    - `舞台现在：`
    - `挑战：`
    - `页面叫了老师（原因）：` 加整条 `msg`；没叫就写 `还没叫老师，攒着：` 加 `pending`
    - `没交给学生：`（有才写）
    - `排版：`
    - `截图：`

- [ ] **Step 1：写失败的测试** `tests/stage-try.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTry, formatReport } from '../tools/stage-try-lib.js';

test('老师的行并成一段，学生的一行一步', () => {
  const s = parseTry('matrix A = 1 1 / -1 -1\n\nsay "看"\n学生: write A.1,1 2\n学生：next\nmul C');
  assert.deepEqual(s.map((x) => x.kind), ['teacher', 'student', 'student', 'teacher']);
  assert.equal(s[0].src, 'matrix A = 1 1 / -1 -1\nsay "看"');
  assert.equal(s[0].line, 1);
  assert.deepEqual([s[1].how, s[1].cmd, s[1].args], ['do', 'write', 'A.1,1 2']);
  assert.deepEqual([s[2].how, s[2].cmd], ['answer', 'next']);
  assert.equal(s[3].line, 6);
});
test('学生写了不认得的动作：报行号和能写的', () => {
  assert.throws(() => parseTry('array a = 1 2\n学生: fly a.1'), /第 2 行.*write swap move vec mul tap drag value say next/);
});
test('报告里有舞台现在、挑战、叫没叫老师、没交给学生', () => {
  const out = formatReport({ file: 'x.txt', views: [{ tag: '竖屏', steps: [{ step: { kind: 'student', how: 'do', cmd: 'write', args: 'B.1,1 2', src: '学生: write B.1,1 2', line: 4 }, played: 1, errors: [], state: '矩阵 B …', goals: [{ id: 'g1', text: '让 C = O', status: '做到了' }], called: { why: '做到了挑战', msg: '[学生]\n学生做到了挑战 g1' }, pending: '', untouched: null, issues: [], shot: 'a.png' }] }] });
  for (const k of ['## 竖屏', '第 1 步：学生 第 4 行 write B.1,1 2', '舞台现在：', 'g1', '做到了', '页面叫了老师（做到了挑战）', 'a.png']) assert.ok(out.includes(k), k);
});
```

- [ ] **Step 2：确认它失败**

先 `npm install`：云端会话里没有 `node_modules`，`katex` 找不到。再跑：

`node --test tests/stage-try.test.js`

预期：FAIL，找不到 `../tools/stage-try-lib.js`。

- [ ] **Step 3：在 `tools/stage-try-lib.js` 里实现 `parseTry` 和 `formatReport`**

纯函数，不碰 DOM、不 import 浏览器的东西。

- [ ] **Step 4：确认通过**

先跑 `node --test tests/stage-try.test.js`，预期 3 个 pass。再跑 `npm test`，预期全过。

- [ ] **Step 5：提交**

```bash
git add tools/stage-try-lib.js tests/stage-try.test.js
git commit -m "舞台试演工具：读一幕的文件、写报告（纯函数）"
```

### Task 2：试演工具 `tools/stage-try.mjs`

**文件**：
- 新建：`tools/stage-measure.mjs`。从 `tools/stage-audit.mjs` 里把 `measure` 原样搬过来，`export function measure(visual = false)`。
- 修改：`tools/stage-audit.mjs`，删掉自己的 `measure`，改成 `import { measure } from './stage-measure.mjs'`。
- 修改：`proto/stage/main.js` 第 26 行。`window.LAStageDev` 多给 `createLoop`（`kit/src/stage/loop.js`）、`eventsText`（`events.js`）、`goalStatus`（`goal.js`）、`HELP`（`stage.js`）。
- 重新生成：`proto/stage/dist/`（`node proto/stage/build.mjs`）。
- 新建：`tools/stage-try.mjs`。
- 新建：`tools/stage-try-examples/matrix.txt`、`tools/stage-try-examples/edge.txt`。

**接口**：
- 用 Task 1 的 `parseTry`、`formatReport`、`TryResult`。
- 命令行：`node tools/stage-try.mjs 文件.txt … [--shots 目录] [--json]`。
  - 不给文件就跑 `tools/stage-try-examples/` 下的全部。
  - 每个文件打印 `formatReport` 的结果；`--json` 时打印 `TryResult` 的 JSON。
  - 截图名：`{文件名}-{竖屏|横屏}-{步号}.png`。
  - 页面报错或工具自己出错，退出码 2；否则 0。没演上的行、排版问题都只写进报告，不改退出码：这是量东西的工具，不是检查。

**在页面里怎么跑**（每个视口开一个新页面：`proto/stage/dist/local.html?dev&blank`，`hasTouch: true`）：

1. **建循环**：`createLoop(host)`，host 是假的。
   - `quietMs: 1e9`，不触发 45 秒没动。
   - `messages({ next })` 返回 `[{ role: 'user', content: next ? 'SPEC' : 'TURN' }]`。
   - `call(input, { onText })`：取队列里**下一段还没演的老师段**的 `src`，只看不拿走。先 `onText({ text: src })`，再返回 `{ text: src, modelApplied: 'claude-opus-5-5' }`。如果队列空了，返回一个永远不 resolve 的 Promise。
   - `addTurn(row)`：`row.role === 'claude'` 时，这一段算演过了，从队列里拿走。这样抢跑先取走的那一份和真叫的那一份是同一段，只演一次。
   - `putTurn(row)`：`row.role === 'student' && !row.pending` 时，记下 `called = { why, msg: row.msg }`。`why` 取 `row.events` 里最后一件会叫老师的事：
     - `answer` → 答了
     - `goal` → 做到了挑战
     - `help` → 点了提示
     - `stuck` → 很久没动
     - `tries` → 试了好多下
   - 一步之后有了 `called`、老师段的队列又是空的，工具就停：后面的步不跑，报告里写「后面的步没跑：页面在等老师」。
   - 其余（`thinking`、`note`、`cost`、`runMemo`、`evidence`）给空函数。

2. **老师段**：
   - 文件第一段：工具调 `loop.teach('turn')`。
   - 后面的老师段：只有循环自己叫老师时才会被取走。如果走到一个老师段时循环没有叫老师，工具写一条「这一段前面学生的动作没有让页面叫老师」，再自己调 `loop.teach('turn')` 接着演。
   - 演完，记下：
     - `played`：这一段演了几行；
     - `errors`：`stage.errors`；
     - `state`：`scene.stateText()`；
     - `goals`：每个挑战的 `goalStatus`。

3. **学生步**：
   - **`how: 'do'`**：
     - 在 `stage.scene.opens` 里找这个东西交给学生、动作也对得上的那一项（`write` 要 `edit`，`mul` 要 `explain`，`swap` / `move` / `vec` 要 `drag`），没有就记 `untouched`：「{东西} 没有交给学生 {动作}，学生动不了」。
     - 照各自画法里的写法造出动作，调 `stage.openDone(e, act, src)`：
       - `write` → `{ type: 'edit', ref, from, to }`，见 `matrix.view.js:330`；
       - `mul` → `{ type: 'explain', ref, value }`，见 `:364`；
       - `swap`：一排格子照 `array.view.js:187`，树照 `tree.view.js:345`；
       - `move` → `sentence.view.js:376`；
       - `vec` → `plane.view.js:461`。
   - **`how: 'answer'`**：照真的手指答正在等的那一问。
     - `tap`、`drag`：照 `tools/stage-touch.mjs` 用 CDP `Input.dispatchTouchEvent`，位置取 `stage.screenRect(stage.nodes.get(pid))` 的中心。
     - `next`：点 `.st-next`。
     - `value`、`say`：填 `#st-say-input` 再提交。
   - 每一步之后等 `stage.studentChain`、`stage.reacting`，再等 900 毫秒。记下：
     - `goals`；
     - `called`（这一步叫了老师才有）；
     - 没叫老师时的 `pending`：`eventsText(loop.pending?.events || [], { goals: scene.goals })`。

4. **每一步之后**：调 `measure()` 记 `issues`，截图记 `shot`。

- [ ] **Step 1：搬 `measure`，确认排版检查没变**

`node proto/stage/build.mjs && node tools/stage-audit.mjs`

预期：和搬之前一样的输出和退出码。搬之前先跑一次记下来。

- [ ] **Step 2：改 `proto/stage/main.js` 第 26 行，重新构建**

`node proto/stage/build.mjs`

预期：`proto/stage/dist/stage-demo.js` 重新生成，没有报错。

- [ ] **Step 3：写两个例子**

`matrix.txt`：用 `matrix.js` 的 `example` 那一轮原文（`kit/src/stage/types/matrix.js:561-570`），后面接：

```
学生: mul C.1,2
学生: mul C.2,1
学生: mul C.2,2
学生: write B.1,1 2
```

- 三格点开以后，`C = O`，`g1` 做到了。`@g1` 的预写里又给了 `open B edit` 和挑战 `g2`，所以这一步不叫老师，报告里是「攒着」。
- 把 `B.1,1` 拨到 2 以后，`C.1,1 = 1·2 + 1·(−1) = 1`，`g2` 做到了。这时页面叫老师，文件后面没有老师段了，工具停在这里。

`edge.txt` 覆盖「要特别查的五种情况」的 1、2、3、5：

```
array a = 3 1 2
open a
say "排一排"
swap a.9 a.1
ask next "看好了点下面"
学生: next
say "来，拖"
goal g1 "排好" when="a sorted"
学生: swap a#1 a#2
学生: write a.1 5
学生: swap a#1 a#3
```

两次 swap 之后从 3 1 2 变成 1 2 3：第一次以后是 1 3 2，`#1` 是 3、`#3` 是 2。

- `swap a.9 a.1` 是故意写错的行：没有第 9 格。
- `ask next` 之后 `学生: next`，再接一段老师的行：查抢跑只演一次。
- `学生: write a.1 5`：一排格子没有交给学生拨数，要记 `untouched`。
- 最后一步排好以后做到挑战，页面叫老师，但后面没有老师段了：要停在这里，写出叫老师的那一条。

- [ ] **Step 4：写 `tools/stage-try.mjs`，跑两个例子**

`node tools/stage-try.mjs --shots /tmp/claude-0/-home-user-Claude/86eb5d01-d579-517d-b19f-fa1d2f75338d/scratchpad/try`

预期：
- 退出码 0；
- `matrix.txt` 两个视口都有「舞台现在：」。第 3 个学生步：`g1` 做到了、「还没叫老师，攒着」。第 4 个学生步：`g2` 做到了、「页面叫了老师（做到了挑战）」，程序正常结束；
- `edge.txt` 里：`swap a.9 a.1` 出现在「没演上的行」；「来，拖」那一段只演了一次；`write a.1 5` 出现在「没交给学生」；最后一步有「页面叫了老师（做到了挑战）」，程序正常结束。

打开 `edge.txt` 第 1 步和最后一步的竖屏截图看：东西都画全了、没有停在动画半路。

- [ ] **Step 5：确认没碰到组件库**

`npm test && npm run build && git status --short`

预期：测试全过；`git status` 里没有 `kit/` 下的文件。

- [ ] **Step 6：提交**

```bash
git add tools/stage-measure.mjs tools/stage-audit.mjs proto/stage/main.js proto/stage/dist tools/stage-try.mjs tools/stage-try-examples
git commit -m "舞台试演工具：一幕指令和学生动作放上真的舞台演，输出老师看到的、挑战、叫没叫老师、排版和截图"
```

### Task 3：两份说明和格式检查

**文件**：
- 新建：`evals/stage-gaps/README.md`：这把尺子是什么、目录里每样东西是什么、怎么重跑。指向设计和本计划。
- 新建：`evals/stage-gaps/brief-ideal.md`：写理想演法的助手读的说明。
- 新建：`evals/stage-gaps/brief-try.md`：对照舞台的助手读的说明。
- 新建：`tools/stage-gaps-lib.js`：`checkIdeal(md)`、`checkReport(md, idealMds)`，纯函数。
- 新建：`tools/stage-gaps-check.mjs`：命令行，`node tools/stage-gaps-check.mjs ideal|report`。
- 测试：`tests/stage-gaps.test.js`。

**`brief-ideal.md` 的内容**（照设计第 2 节）：
- 怎么教：设计第 0 节的三条原则，加上「Claude 实时判断怎么教，不预制；画面是主力，先做后说，学生动手；学生能自己发现的不说破；像游戏不像动画」。
- 唯一的限制：iPad 网页做得到的（二维、三维的图、动画、点、拖、拨、写字、Apple Pencil；不要视频、语音、AR）。
- 不提舞台、不提现有的东西。
- 材料在 `evals/stage-gaps/materials/{块}.md`。
- 产出写到 `evals/stage-gaps/ideal/{块}.md`，格式固定：

```
# {块} {标题}
## 主线
### 第 1 幕：{一句话}
- 画面：…
- 动：…
- 老师说：…
- 学生做：…
- 页面当场：…
- 事实：…
- 老师凭什么接：…
## 分支 1：{哪种错法}
- 学生会怎么做：…
- 老师想演什么：…
- 页面要提供什么：…
```

主线至少 3 幕，分支 2～3 个；每一项都写具体的数、矩阵、句子。

**`brief-try.md` 的内容**（照设计第 3 节）：
- 舞台说明从 `node -e` 打出 `STAGE_TEACH` 和 `stageDoc()`（不带科目，8 种全带），存成 `evals/stage-gaps/stage-doc.txt` 一并给。
- 工具用法：Task 2 的命令行和 `学生:` 的写法。
- 两条纪律：不改理想，不改代码。
- 指令文件写到 `evals/stage-gaps/try/{块}/{幕或分支}.txt`，截图写到 `evals/stage-gaps/try/{块}/shots/`。
- 产出写到 `evals/stage-gaps/report/{线代|数据结构|英语}.md`，格式固定：每块一节 `## {块}`，每一幕或分支的每一项一行：

```
- ✅ 第 1 幕·画面：一句话
- ⚠️ 第 2 幕·事实：一句话
  - 要的：…
  - 指令：`try/L1/幕2.txt` 第 3–5 行（或原样贴）
  - 结果：…（报错原文、舞台现在里缺了什么，或截图路径）
```

主线每一幕标五项：画面、动、学生做、页面当场、事实。「老师说」只查话里指着画面的 `{…}` 写不写得出来，标成「老师说」。分支标「页面要提供什么」这一项。

**接口**：
- `checkIdeal(md) → string[]`：问题列表，空就是合格。规则：
  - 有 `## 主线`，下面至少 3 个 `### 第 N 幕`；
  - 每幕七个标签都在，而且后面不是空的；
  - `## 分支` 有 2～3 个，每个三个标签都在。
- `checkReport(md, idealMds) → string[]`：规则：
  - 每块理想里的每一幕和分支，都有对应的标了 ✅ / ⚠️ / ❌ 的行（幕号和项名对得上）；
  - 每个 ⚠️ 和 ❌ 下面都有「要的」「指令」「结果」三行。
- 命令行：读 `evals/stage-gaps/ideal/*.md`（加 `report` 时再读 `report/*.md`），打印问题，有问题退出码 1。

- [ ] **Step 1：写失败的测试** `tests/stage-gaps.test.js`
  - 一份合格的理想（3 幕、2 分支、项都全）→ `[]`；
  - 去掉第 2 幕的「事实：」→ 结果里有「第 2 幕」和「事实」；
  - 只有 1 个分支 → 结果里有「分支」；
  - 一份报告漏了第 3 幕的「动」→ 有「第 3 幕」「动」；
  - 一个 ❌ 没有「结果」行 → 有「结果」。
- [ ] **Step 2：确认它失败**：`node --test tests/stage-gaps.test.js`，预期 FAIL。
- [ ] **Step 3：实现 `tools/stage-gaps-lib.js` 和 `tools/stage-gaps-check.mjs`**
- [ ] **Step 4：确认通过**：`node --test tests/stage-gaps.test.js` 全过，`npm test` 全过。
- [ ] **Step 5：写三份说明和 `stage-doc.txt`**。照上面的内容写。说明里提到学生只用「学生」。
- [ ] **Step 6：提交**

```bash
git add evals/stage-gaps tools/stage-gaps-lib.js tools/stage-gaps-check.mjs tests/stage-gaps.test.js
git commit -m "缺口尺子：给助手的两份说明、理想演法和对照报告的格式检查"
```

### Task 4：取材料（主会话做，不开助手）

**文件**：新建 `evals/stage-gaps/materials/{L1,L2,L3,D1,D2,D3,D4,E1,E2,E3}.md`，每份三节：
- `## 教材原文`
- `## 学生在这一块的错题和弱点`
- `## 学生现在在哪`（从 `position` 抄下一节和欠账里和这一块有关的）

**做法**：
1. **存到本地**：
   - 教材：用 `ArtifactData list` 把下面几本的 `books/{B}/chunks` 存到 scratchpad 的 `desk/chunks/`（加 `out_dir`）。
     - 线代：B11–B15，再加 B43 和 B44 里对应的题；
     - 数据结构：B4、B6–B9；
     - 英语：B10、B16–B42 里时态、从句、非谓语的那几本。先读 `books/{B}.json` 的目录挑，不全存。
   - 记忆：`errors`、`weaknesses`、`curriculum` 三个集合也存下来。
2. **挑教材**：按条目标题和书页找到这一块的条目，原文照抄进 `## 教材原文`，每份不超过约 30 KB。太长的只留讲概念和例题的几条，在节首写一行「省略了：…」。
3. **挑错题和弱点**：挂在这一块或同一章的抄进来，原文照抄，把称呼学生的「他」「她」换成「学生」。一条都没有就写「记忆里没有，用教材常见错法」。

- [ ] **Step 1**：存数据。预期：scratchpad 里有 `desk/chunks/books/B11/chunks/*.json` 这样的文件。
- [ ] **Step 2**：写 10 份材料。预期：`ls evals/stage-gaps/materials | wc -l` 是 10，每份三节都在，`grep -L "## 教材原文" evals/stage-gaps/materials/*.md` 没有输出。
- [ ] **Step 3**：提交

```bash
git add evals/stage-gaps/materials
git commit -m "缺口尺子：十块的材料（教材原文、错题弱点、现在在哪）"
```

### Task 5：写理想演法（10 个助手，后台同时跑）

**文件**：新建 `evals/stage-gaps/ideal/{块}.md`，10 份。

**怎么开**：`Agent`，`subagent_type: general-purpose`，`run_in_background: true`，一块一个，同一条消息里一起发。提示词只有这几样：
- 读 `evals/stage-gaps/brief-ideal.md` 和 `evals/stage-gaps/materials/{块}.md`；
- 产出写到 `evals/stage-gaps/ideal/{块}.md`；
- 写完跑 `node tools/stage-gaps-check.mjs ideal`，自己这一块没问题再交；
- 不许读 `kit/src/stage/`、`docs/stage-*.md`、`proto/stage/`；不许改别的文件。

**交回以后**：

- [ ] **Step 1**：等 10 个都完成。
- [ ] **Step 2**：`node tools/stage-gaps-check.mjs ideal`。预期退出码 0。有问题的那一块，用 `SendMessage` 让原来那个助手补，不重开。
- [ ] **Step 3**：主会话每份读一遍，查有没有违反设计第 0 节三条原则（页面自己决定给提示、预制讲解）。有就记进 scratchpad 的 `principle-notes.md`，Task 7 用。不改它的文件。
- [ ] **Step 4**：提交

```bash
git add evals/stage-gaps/ideal
git commit -m "缺口尺子：十块的理想演法（主线 + 分支）"
```

### Task 6：对照舞台写、演（3 个助手，后台同时跑）

**文件**：
- 新建：`evals/stage-gaps/report/{线代,数据结构,英语}.md`
- 新建：`evals/stage-gaps/try/{块}/…`

**怎么开**：`Agent`，`general-purpose`，后台，按科目三个，同一条消息里发。
- 线代：L1–L3；数据结构：D1–D4；英语：E1–E3。
- 提示词：
  - 读 `evals/stage-gaps/brief-try.md`、`evals/stage-gaps/stage-doc.txt`、这一科的 `ideal/*.md`；
  - 工具先 `node proto/stage/build.mjs` 一次；
  - 写完跑 `node tools/stage-gaps-check.mjs report`，自己这一科没问题再交；
  - 不许改 `evals/stage-gaps/` 以外的文件。

**交回以后**：

- [ ] **Step 1**：等 3 个都完成。
- [ ] **Step 2**：`node tools/stage-gaps-check.mjs report`。预期退出码 0。有问题让原来的助手补。
- [ ] **Step 3**：截图只留报告里引用到的：`git add` 时只加被引用的 png，没引用的不提交。
- [ ] **Step 4**：提交

```bash
git add evals/stage-gaps/report evals/stage-gaps/try
git commit -m "缺口尺子：三科对照舞台的报告、试演的指令和截图"
```

### Task 7：复核，写缺口单（主会话做）

**文件**：新建 `docs/stage-gaps.md`。

**做法**（照设计第 5 节）：
1. **每个 ⚠️ 和 ❌**：用 `node tools/stage-try.mjs evals/stage-gaps/try/{块}/{…}.txt` 重跑，自己看输出。
   - 确认是舞台做不到 → 留着；
   - 是助手写错了指令（照 `stage-doc.txt` 能写对）→ 挪进「说明写得不清楚」，附上对的写法和它写错的地方。
2. **✅ 抽查**：每科按顺序每三条抽一条重跑，看是不是其实是 ⚠️。改了的写进复核记录。
3. **违反原则的**：Task 5 记下的条目，写进「理想本身有问题」。
4. **合并成缺口**：同一件事在几块、几幕里出现的并成一条。每条按设计第 5 节写：缺什么、哪一层、在哪几块（主线 / 分支）、能复用现有的什么、证据。
   - 复用那一项必须写到文件和函数名，例如 `kit/src/engines/balanced.js`、`kit/src/huoban/objects.js` 的引擎适配器、`kit/src/entext.js` 的 `diagnose`、`kit/src/anscheck.js`。每一条都打开文件看过才写。
5. **排序**：
   - 先按出现的块数从多到少；
   - 块数一样，主线要用的在前；
   - 再一样，按层：判定和事实 → 表达力 → 学生动手 → 联动 → 和老师的配合 → 画面质量。
6. **文首写一段总数**：多少幕、多少项，✅ / ⚠️ / ❌ 各多少，每层几条缺口。

**`docs/stage-gaps.md` 的骨架**：

```
# 舞台的缺口单（2026-11-0X）
总数：…
## 缺口（排好序）
### 1. {缺什么}
- 层：…
- 出现在：L1 主线第 2 幕、D2 分支 1、…
- 能复用：…
- 证据：evals/stage-gaps/report/线代.md「L1」第 2 幕·事实
## 说明写得不清楚（第 3 条，先只记）
## 理想本身有问题
## 复核记录（抽查改了的、挪走的）
```

- [ ] **Step 1**：重跑全部 ⚠️、❌ 和抽查的 ✅。预期：每一条都有复核结论。
- [ ] **Step 2**：写 `docs/stage-gaps.md`。预期：每条缺口六项齐全，`grep -c "^### " docs/stage-gaps.md` 和总数里的缺口条数一样。
- [ ] **Step 3**：提交

```bash
git add docs/stage-gaps.md
git commit -m "舞台的缺口单：十块理想演法对照舞台，复核后去重、分层、排序"
```

### Task 8：记进仓库的说明，交给我看

**文件**：
- 修改：`CLAUDE.md`。在「舞台」那一条后面加一句：缺口尺子在 `evals/stage-gaps/`、缺口单 `docs/stage-gaps.md`、试演工具 `node tools/stage-try.mjs`。在「命令」里加 `tools/stage-try.mjs` 的一行用法。
- 修改：`docs/stage-plan.md` 的「进度」。加一条 2026-11-0X：缺口尺子做完，指向缺口单。

- [ ] **Step 1**：改两份文档。
- [ ] **Step 2**：`npm test && npm run build && git status --short`。预期：测试全过，`kit/` 下没有变化。
- [ ] **Step 3**：提交并推送

```bash
git add CLAUDE.md docs/stage-plan.md
git commit -m "说明里记上缺口尺子、试演工具和缺口单"
git push -u origin claude/teaching-mode-code-review-vcz66v
```

- [ ] **Step 4**：给我看。在对话里写：
  - 缺口单的总数；
  - 排在最前的十条，一条一句；
  - 「说明写得不清楚」和「理想本身有问题」各几条；
  - 问我认不认可。

  我认可了，第 1 个子项目结束。
