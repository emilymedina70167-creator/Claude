# 舞台的底座：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**：给舞台加一层所有东西共用的底座，内容见下面的「架构」，并用树（AVL）、矩阵（消元）、句子（拆成分）三个样板把它逼出来。

**架构**：
- 纯函数各放一个模块，用 `node --test` 测：
  - 规则接口 `rules.js`；
  - 裁判 `referee.js`；
  - 跟着算的量 `value.js`；
  - 判答案 `answer.js`；
  - 三个样板的规则 `types/*.rules.js`。
- 场景 `scene.js` 和课堂循环 `loop.js` / `events.js` 接上这些模块。
- 画面那一层 `stage.js` / `pointer.js` / `types/*.view.js` 只加通用手势和三个样板的画面。

**技术**：浏览器 ES 模块，esbuild 打包（`npm run build`、`node proto/stage/build.mjs`），`node --test`，Playwright（`tools/playwright.mjs`）。

**设计**：`docs/superpowers/specs/2026-11-06-stage-base-design.md`。执行的人两份都读，以设计为准。

## 全局约束

- **文字**：注释、提交说明、给老师的话、报错都用中文。注释写「为什么」，密度和 `kit/src/stage/` 现有代码一致。
- **提交说明末尾**带：
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014f77bEv6dHb3CuP9CXQj8f
  ```
- **改了 `kit/src/` 的任务**：提交前跑 `npm run build`，连同 `kit/dist/` 一起提交；`npm run build` 之后 `git status` 要干净。改了舞台画面的任务，还要跑 `node proto/stage/build.mjs`，提交 `proto/stage/dist/`。
- **提示词里提到学生**只写「学生」，不写「他」「她」（有测试守着）。
- **预写只认** `@名字.done`、`@名字.right` 和原有的 `@挑战`。写 `@名字.wrong` 当场报错，原文是：「走偏以后怎么讲要等你看着学生写，不能预写」。
- **`wrong=` 的默认值**是 `quiet`（照做、只记）。页面不做教学决定。
- **旧写法意思不变**：`product C = A B`、`vec p w = 2u - v`、`open B edit`、`open a`、`open p.u drag`、`@g1`。旧课照 log 重放的结果不变。
- **发给老师的 [学生] 一块**不超过 2 KB（按 UTF-8 字节算）。
- **说明总长**不超过 `STAGE_SYSTEM_MAX`（150 KiB），`tests/stage-doc.test.js` 守着。
- **界面**以 iPad 为准：触控目标至少 44px，输入框字号 16px，不用 `window.confirm` / `alert` / `prompt`。
- **`window.LAStageDev` 要给检查脚本**加的东西，只加在 `proto/stage/main.js` 的 `?dev` 那一行。

## 要特别查的五种情况

1. **学生走偏以后再走正确的一步**：裁判要从走偏以后的样子重新算，判成「对」。不能因为和最初的标准过程对不上就判错。守在 Task 5、6 的测试「走偏以后接着判」。
2. **`{式子}` 依赖成环，或算不出来**（不可逆、维数不对）：报给老师，原来的值不动，不崩。守在 Task 1 的测试「环」「不可逆」。
3. **旧课 log 里没有新写法**：重放出来和改之前一模一样。守在 Task 8 的测试「旧 log 照放」，以及 e2e 的 `stage` 一段。
4. **老师自己做的一步让挑战成立，或者走偏了**：不能报成「学生做到了」或「学生走偏了」。守在 Task 4 的测试「老师做到的挑战」、Task 8 的「老师的几步核过」。
5. **学生在老师正在想的时候做了好多下**：[学生] 一块超过 2 KB 时并成一句，而不是整段发出去。守在 Task 8 的测试「长度上限」。

---

### Task 1：跟着算的量 `value.js`，接进场景

**文件**：
- 新建：`kit/src/stage/value.js`
- 修改：`kit/src/stage/scene.js`
  - 造东西的那一段（`applyOne` 里 `CREATE[cmd]`）；
  - `derive()`；
  - `stateText()` 里写出哪些东西是跟着算的。
- 修改：`kit/src/stage/types/matrix.js`：格里能写 `{式子}`，整个矩阵能写 `= {式子}`。
- 修改：`kit/src/stage/types/plane.js`：`vec p w = {A v}`。
- 测试：`tests/stage-value.test.js`

**接口**：
- 产出 `parseLive(text) → { parts: [{ k: 'text', v } | { k: 'expr', v }] }`：把一行里的 `{…}` 拆出来。
  - 说话里的 `{a.3}`、`{d}` 不在这里管：`say` / `label` / `goal` 的字不走 `parseLive`。
- 产出 `evalLive(src, scene) → { value, deps: string[] }`：用 `kit/src/exact.js` 的 `evaluateExact` 算。
  - `vars` 由场景给：拨数的值、舞台上每样东西的值（矩阵是 Q 的二维数组，向量是列向量，格子是数）。
  - `deps` 是用到的名字：拨数名、东西的 id、部件写法。
  - 算不出来时抛错，错误里写原式子。
- 产出 `liveOrder(nodes) → string[]`：按依赖排先后。成环时抛错，错误里列出环上的名字。
- **场景的约定**：用了 `{…}` 的东西，在 `o.live = { line: 原文, deps }`；`scene.derive()` 先重算 `o.live` 的东西，再跑原有各种东西的 `derive`。
  - 重算后值有变化的，写进 `fx.derived`：`{ id, changed: [{ ref, from, to }] }`。
  - 矩阵在原地改格（`setValue`）。
  - 别的东西重新 `make`，`id` 不变。
  - 学生不能直接动跟着算的东西：`open` 它时抛错「{id} 是跟着算的，学生动不了」。
- **拨数**：`set k 3` 之后要触发重算（`onVar` 里调 `derive`）。

**步骤**：

- [ ] **Step 0：先存一份改之前的基线**（Task 13 的回归要用）：`node proto/stage/build.mjs && node tools/stage-try.mjs evals/stage-gaps/try/*/*.txt --json > /tmp/claude-0/-home-user-Claude/86eb5d01-d579-517d-b19f-fa1d2f75338d/scratchpad/try-baseline.json`。也把当时的 `git rev-parse HEAD` 记进执行记录。
- [ ] **Step 1：写失败的测试**。`tests/stage-value.test.js` 里至少这几条：
  - 「格里的 {k} 跟着拨数变」：
    - 造 `dial k = 1 range=-3..3` 和 `matrix M = 1 {k} / 0 1`；
    - `set k 3` 之后 `M.1,2` 是 `'3'`；
    - `fx.derived` 里有 `{ ref: 'M.1,2', from: '1', to: '3' }`。
  - 「整个矩阵 {A + B}」：`matrix S = {A + B}`，A、B 是 2×2，改 `A.1,1` 之后 `S` 跟着变。
  - 「{P^-1}」：P = (2 1; 1 1)，P2 是 (1 −1; −1 2)。
  - 「{A v}」：`vec p w = {A v}`，A = (2 0; 0 1)、v = (1 1)，w 是 (2, 1)。改 `vec p v = 2 0` 之后 w 是 (4, 0)。
  - 「环」：`matrix X = {Y}`、`matrix Y = {X}`，第二行抛错，错误里有「X」和「Y」。
  - 「不可逆」：`matrix Q = {P^-1}`，P 是 (1 1; 1 1)，抛错，错误里有「不可逆」或 `exact.js` 原来的说法。已有的东西不动。
  - 「跟着算的不能 open」：`open S edit` 抛错，错误里有「跟着算的」。
  - 「旧写法不变」：`product C = A B`、`vec p w = 2u - v` 的结果和改之前一样（拿现有 `tests/stage-matrix.test.js` 的例子）。
- [ ] **Step 2：跑，确认失败**。`node --test tests/stage-value.test.js`，预期 FAIL：找不到 `value.js`。
- [ ] **Step 3：实现 `value.js`，接进 `scene.js`、`matrix.js`、`plane.js`**。式子里的名字到值的换算放在 `value.js` 的 `scopeOf(scene) → vars`，场景和测试都用它。
- [ ] **Step 4：跑通**。先 `node --test tests/stage-value.test.js` 全过；再 `npm test` 全过，现有的 stage 测试一条不坏。
- [ ] **Step 5：提交**，说明写「舞台：跟着算的量 {式子}（拨数、矩阵运算、A v）」。

### Task 2：判答案 `answer.js`，接进 `ask value`

**文件**：
- 新建：`kit/src/stage/answer.js`
- 修改：`kit/src/stage/scene.js` 的 `case 'ask'`：`ask value` 的 `answer=` 可选、`type=`、`wrong=`。
- 修改：`kit/src/stage/stage.js` 的 `waitAct` 里 `value` 那一段：用 `judgeAnswer` 代替 `sameAnswer`；`sameAnswer` 留着给旧调用。
- 测试：`tests/stage-answer.test.js`

**接口**：
- 产出 `judgeAnswer(given, spec, scene) → { ok: true | false | null, misread: string | null, shown: string }`：
  - `spec = { type, answer, wrongs }`；
  - `ok: null` 是只收不判（没写 answer）；
  - `answer` 是 `{式子}` 时用 Task 1 的 `evalLive` 现算。
- `type` 只认这几种，别的写法当场报错并列出能写的：

  | type | 判法 |
  |---|---|
  | `num` | `exact.js` |
  | `formula` | `formula.js` 的 `compareFormula`，自变量写 `free=n` |
  | `matrix` | `formula.js` 的 `matrixCells` / `compareCells` |
  | `set` | `anstypes.js` 的 `intervalSpec` |
  | `equation` | `anstypes.js` 的 `equationSpec` |
  | `seq` | `textcheck.js` 的 `checkSeq` |
  | `en` | `entext.js` 的 `parseAnswer` / `matchText` |

- `wrongs`：照 `entext.js` 的 `!x=提示` 写法解析，`wrong="3=漏了 E"`。
  - 对上时 `misread` 是「漏了 E」，**只进给老师的事实**；
  - 学生那边只看到对或不对，`ok: null` 时什么都不判。
- `stage.js` 的 value 动作改成 `{ type: 'value', text, answer, right, misread }`。`right` 是 `null` 时，`actText` 写「学生填了「…」（这一问只收不判）」。

**步骤**：

- [ ] **Step 1：写失败的测试**：
  - 「分数」：`judgeAnswer('0.5', { type: 'num', answer: '1/2' })` 的 `ok` 是 true。
  - 「式子」：`judgeAnswer('2^n', { type: 'formula', answer: '2^n', free: 'n' })` 的 `ok` 是 true；`'2n'` 的 `ok` 是 false。
  - 「矩阵」：`{type:'matrix', answer:'1 2 / 3 4'}`，`'1 2 / 3 4'` 对，`'1 2 / 3 5'` 不对。
  - 「{A^2}」：answer 是 `{A^2}`，A = (1 1; 0 1)，`'1 2 / 0 1'` 对。
  - 「只收不判」：没写 answer，`ok` 是 null。
  - 「常见错答只给老师」：`wrongs: '3=漏了 E'`，给 `'3'`，`ok` 是 false，`misread` 是「漏了 E」。
  - 「不认得的 type」：抛错，错误里有 `num formula matrix set equation seq en`。
  - 「ask value 不写 answer 不再报错」：在场景里写 `ask value "猜一个"` 不抛错。
- [ ] **Step 2：确认失败**。`node --test tests/stage-answer.test.js`，预期 FAIL。
- [ ] **Step 3：实现**。
- [ ] **Step 4：跑通**。`node --test tests/stage-answer.test.js` 全过，`npm test` 全过。
- [ ] **Step 5：提交**，说明写「舞台：ask value 的 type= 接上现成的判法，answer 可以是 {式子}、可以不写」。

### Task 3：规则接口 `rules.js` 和裁判 `referee.js`

**文件**：
- 新建：`kit/src/stage/rules.js`
- 新建：`kit/src/stage/referee.js`
- 测试：`tests/stage-rules.test.js`

**接口**：
- **`rules.js`**：
  - `registerRules(type, rules)`；
  - `rulesOf(o) → rules | null`；
  - `predicateOf(scene, objId, name) → (args) => boolean | null`；
  - `gestureOf(o, action) → { gesture, ... } | null`。

  `rules` 的形状照设计第 1 节：`next`、`check`、`predicates`、`facts`、`gestures`、`standard`。缺的项给默认值：
  - `next` → `null`；
  - `check` → `{ legal: true, right: null }`；
  - `predicates` → `{}`；
  - `facts` → `[]`。

  没有规则的东西照旧能用，只是不判。
- **`referee.js`**：`judge(scene, objId, act, policy, { by }) → { verdict, apply, call, facts, mark }`：
  - `policy = { wrong: 'quiet' | 'mark' | 'block', call: 'wrong' | 'done' | null }`，来自 `open` 那一行；
  - `verdict = { legal, right, misread, why, next }`，来自 `check`；
  - `apply`：要不要真的演这一下。`legal === false` 或 `wrong=block` 且 `right === false` 时为 false；
  - `call`：`'now'` 或 `null`；
  - `mark`：要不要在那一处淡淡圈一下（`wrong=mark` 且 `right === false`）；
  - `facts`：写给老师的几行。
  - `by === 'teacher'` 时：`apply` 永远是 true，`call` 永远是 null；`right === false` 时多一行「你在 … ，现在正确的是 …」，放进 `facts`，由 Task 8 收到「[页面核过你上一轮的几步]」里。
- **`done(scene, objId) → boolean`**：`rulesOf(o).next(o, scene) === null`，而且这种东西的规则交出了 `next`。

**步骤**：

- [ ] **Step 1：写失败的测试**（用一个假种类「counter」：`next` 是「加到 3」，`check` 判「加 1 对，加 2 不对、像跳了一步」）：
  - 「默认 quiet」：`judge` 不给 policy，加 2，`apply` 是 true、`mark` 是 false、`call` 是 null，`facts` 里有「像跳了一步」；
  - 「mark」：`apply` 是 true、`mark` 是 true；
  - 「block」：`apply` 是 false；
  - 「call=wrong」：`call` 是 `'now'`；
  - 「不合规则永远不做」：`legal: false` 时，三种 policy 都是 `apply: false`；
  - 「老师的不拦」：`by: 'teacher'`，block 也 `apply: true`，`facts` 里有「现在正确的是」；
  - 「做完」：加到 3 以后 `done` 是 true；
  - 「没有规则的东西」：`rulesOf` 是 null，`judge` 返回 `apply: true`、`facts: []`。
- [ ] **Step 2：确认失败**：`node --test tests/stage-rules.test.js`。
- [ ] **Step 3：实现**。
- [ ] **Step 4：跑通**：测试全过，`npm test` 全过。
- [ ] **Step 5：提交**，说明写「舞台：规则接口和裁判（照做 / 标 / 拦、叫不叫老师、老师的几步核过）」。

### Task 4：挑战的判断式，49′，老师做到的挑战

**文件**：
- 修改：`kit/src/stage/goal.js`
  - `parseGoal` 认 `名字 判断式 参数…`（比如 `t avl`、`M rank=2`、`s parsed`）；
  - `evalClause` 调 Task 3 的 `predicateOf`；
  - `=` / `!=` 比一格时保留 ′。
- 修改：`kit/src/stage/loop.js` 的 `onGoal`：看 `by`。
- 修改：`kit/src/stage/events.js`：新的事件 `kind: 'goal-by-teacher'`，写给老师的那句。
- 测试：`tests/stage-goal.test.js`（加几条）、`tests/stage-events.test.js`（加几条）

**接口**：
- 消费 Task 3 的 `predicateOf(scene, objId, name) → fn | null`。测试里判断式用一个假的种类，经 `registerRules` 注册。
- `onGoal(ids, { by, instant, reacted })`：
  - `by === 'student'`：照旧；
  - 其他：不叫老师，攒一件 `{ kind: 'goal-by-teacher', ids }` 跟着下一条发。`eventsText` 写「你这一轮让挑战 g1「…」成立了（不是学生做到的）」。

**步骤**：

- [ ] **Step 1：写失败的测试**：
  - 「49′ 不等于 49」：`a.4 = 49`，`a.4` 是 `49′`，判不成立；
  - 「sorted 照旧按数」：`a sorted`，`a` 是 `13 49 49′ 65`，成立；
  - 「判断式」：注册一个假种类，交出判断式 `even`，`when="x even"` 能判；
  - 「判断式写错」：报出这种东西能写的判断式；
  - 「老师做到的挑战」：`eventsText` 对 `kind: 'goal-by-teacher'` 写出「不是学生做到的」；`triggers` 对它是 false。
- [ ] **Step 2：确认失败**：`node --test tests/stage-goal.test.js tests/stage-events.test.js`。
- [ ] **Step 3：实现**。
- [ ] **Step 4：跑通**：上面两个测试文件全过，`npm test` 全过。
- [ ] **Step 5：提交**，说明写「舞台：挑战能写每种东西的判断式；49′ 不再当成 49；老师做到的挑战不报成学生做到」。

### Task 5：树（AVL）的规则 `types/tree.rules.js`

**文件**：
- 新建：`kit/src/stage/types/tree.rules.js`，在 `types/index.js` 里 `registerRules('tree', …)`。
- 测试：`tests/stage-tree-rules.test.js`

**接口**：
- 消费：`tree.js` 已有的 `imbalance(o)`、`levelOrder`、`heightOf`、`depths`、`cmpValues`、`serialize`。
- **托盘**：`o.tray: string[]`，待插的数，`tree t = … tray="47 10"`。
- **`next(o)`**：
  - 有失衡：`{ acts: [{ type: 'rotate', at: 结点 key, kind }], why: '最小不平衡子树的根是 50，LR 型' }`。LR / RL 先给第一步（在孩子处转），转了一步以后再算一次，就得到第二步。
  - 没失衡、托盘里还有数：`{ acts: [{ type: 'insert', value }] }`。
  - 都没有：`null`。
- **`check(o, act)`**：
  - `act.type === 'rotate'`，`{ at, dir }`：
    - 转不了（没有那一边的孩子）是 `legal: false`；
    - 和 `next` 的第一步一样是 `right: true`；
    - 否则 `right: false`，`misread` 按下面的规则认：

    | 学生的做法 | misread |
    |---|---|
    | 在不平衡的结点上，转了和正确第一步相反的方向 | 型从下往上读了 |
    | 在不平衡的结点上，按 LL / RR 一步转（该先转孩子） | 只看了离新结点最近的两步 |
    | 转的是离根更近的失衡结点 | 修了离根近的那个，不是最小不平衡子树 |
    | 没有失衡时还在转 | 树已经平衡了，不用转 |

  - `act.type === 'insert'`，`{ value, parent?, side? }`：没给位置时页面自己落，`right: true`；给了位置时，和二叉排序树该落的位置比，不一样是 `right: false`，`misread` 是「这里不是二叉排序树里 47 该在的位置（该在 45 的右边）」。
- **`predicates`**：
  - `avl`：每个结点 |平衡因子| ≤ 1；
  - `bst`：中序递增，用 `cmpValues`，相等算递增；
  - `height`：`height=4`。
- **`facts(before, after, act)`**：
  - 旋转以后：谁升谁降、哪棵子树换了父亲、现在还有没有失衡；
  - 插入以后：路径。
- **`gestures`**：
  - `rotate`：`drop-on`，从一个结点拖到它的父亲上，翻成 `rotate t#k right|left`（往左上拖是右旋，往右上拖是左旋）；
  - `insert`：`drop-at`，托盘的数拖进树，翻成 `insert t 47`；
  - `place`：`drop-at`，数拖到某个空位，翻成 `insert t#k left|right 47`。
- **`standard(o)`**：用 `kit/src/engines/balanced.js` 的 `avlEngine`，`parse({ insert: … })` → `run`，给出整段的旋转序列。

**步骤**：

- [ ] **Step 1：写失败的测试**：
  - 「王道综合题 03」：从空树依次插 34 23 15 98 115 28 107，每次插完照 `next` 一路做到平衡。每次的型和 `avlEngine` 跑同样输入的结果一样，最后的层序也一样。用测试里的循环对拍，不写死答案。
  - 「LR 的第一步」：50、30、40 插完，`next` 给出在 30 左旋。
  - 「型读反」：同一棵树，学生在 50 左旋，`misread` 有「从下往上读」。
  - 「只看两步」：学生在 50 右旋，`misread` 有「最近的两步」。
  - 「走偏以后接着判」：学生先在 50 右旋（错），之后的 `next` 从转错以后的样子重新算出一个可行的下一步，照它做是 `right: true`，最后能到 `avl` 成立。
  - 「换值弄坏 bst」：`swap t.30 t.50` 以后 `bst` 是 false。
  - 「插错位置」：47 摆到 50 的左边，`misread` 有「该在」。
- [ ] **Step 2：确认失败**：`node --test tests/stage-tree-rules.test.js`。
- [ ] **Step 3：实现**。
- [ ] **Step 4：跑通**：测试全过，`npm test` 全过。
- [ ] **Step 5：提交**，说明写「舞台：树（AVL）的规则：下一步、判型和四种错法、平衡 / 二叉排序树的判断式，和平衡二叉树引擎对拍」。

### Task 6：矩阵（消元）的规则 `types/matrix.rules.js`

**文件**：
- 新建：`kit/src/stage/types/matrix.rules.js`，在 `types/index.js` 注册。
- 测试：`tests/stage-matrix-rules.test.js`

**接口**：
- 消费：
  - `matrix.js` 的 `parseOps`、`echelon`、`zeroRows`、`toQ`；
  - `kit/src/engines/elim.js` 的 `doStart` / `doApply` / `doStatus` / `rrefQ` / `solution`；
  - `kit/src/exact.js` 的 `rrefOf`。
- **`next(o)`**：还不是阶梯形时，按 `elim.js` 的顺序（从左往右找主元列，主元行选第一个非零的），给出下一个该消的位置和一条可接受的行变换。`acts` 里放所有能把那一格消成 0、又不破坏前面已经消好的列的倍加。已经是阶梯形时返回 `null`。
- **`check(o, act)`**，`act = { type: 'rowop', op }`，`op` 是 `parseOps` 的结果：
  - 倍乘 0 是 `legal: false`；
  - 能让这一格消成 0、不破坏前面的列，就是 `right: true`；
  - 其余 `right: false`，`misread` 按下面的规则认：

    | 学生的做法 | misread |
    |---|---|
    | k 的符号反了，比如该 −3 写了 +3 | 符号反了 |
    | k 不对，而且不是符号的问题 | 倍数不对，这一格消不成 0 |
    | 动的是已经消好的行，破坏了前面的列 | 把已经消好的那一列又弄乱了 |

- **`predicates`**：
  - `stairs`：阶梯形，用 `echelon(o)`；
  - `rref`：行最简形；
  - `rank`：`rank=2`；
  - `same`：`same B`，和 B 行等价，比 `rrefOf` 的结果。
- **`facts`**：这一步做了什么、哪一行变了、变成什么、现在离阶梯形还差哪几格。
- **`gestures`**：
  - `rowop`：`drop-on`，行把手拖到另一行上，弹出倍数框，翻成 `rowop M r3 + k r1`；把手拖到行号上，翻成 `rowop M r1 <-> r3`；
  - `rowop`：`tap`，点行号，弹出倍数框，翻成 `rowop M k r2`；
  - `edit`：`write`，`input=keypad` 时用数字键盘，翻成 `write M.2,3 5`。

**步骤**：

- [ ] **Step 1：写失败的测试**：
  - 「教材例题对拍」：拿 `evals/stage-gaps/ideal/L2.md` 主线第 4 幕用的增广矩阵 (1 2 0 | 2; 2 2 −4 | 2; 0 0 −2 | −2)，或 `elim.js` 测试里的例子。照 `next` 一路做到 `stairs`，结果和 `elim.js` 的 `rrefQ` 行等价，用 `same` 判断式比。
  - 「符号反了」：该 `r2 - 2r1` 写成 `r2 + 2r1`，`misread` 有「符号」。
  - 「弄乱已经消好的列」：`misread` 有「弄乱」。
  - 「走偏以后接着判」：先做一步不必要的倍加（`right: false`），之后照 `next` 照样能到 `stairs`。
  - 「倍乘 0」：`legal: false`。
  - 「判断式」：`rank=2`、`stairs` 各一条。
- [ ] **Step 2：确认失败**：`node --test tests/stage-matrix-rules.test.js`。
- [ ] **Step 3：实现**。
- [ ] **Step 4：跑通**：测试全过，`npm test` 全过。
- [ ] **Step 5：提交**，说明写「舞台：矩阵（消元）的规则：下一步、三种错法、阶梯形 / 秩 / 同解的判断式」。

### Task 7：句子（拆成分）的规则 `types/sentence.rules.js`

**文件**：
- 修改：`kit/src/stage/types/sentence.js`：造句子时认 `key="…"`，照 `entext.js` 的 `parseBrackets` 读成正确拆法，存在 `o.key`。key 里的词和句子对不上时当场报错。
- 新建：`kit/src/stage/types/sentence.rules.js`，在 `types/index.js` 注册。
- 测试：`tests/stage-sentence-rules.test.js`

**接口**：
- 消费：`entext.js` 的 `parseBrackets`、`judgeSpans`、`ROLES`；`sentence.js` 的 `mark` 指令已有的成分写法。
- **成分名**：舞台上写的成分名和 `entext.js` 的 `ROLES` 对上，一张对照表放在 `sentence.rules.js`：

  | 舞台上的写法 | 成分 |
  |---|---|
  | `V` / `谓语` | 谓语 |
  | `S` / `主语` | 主语 |
  | `O` / `宾语` | 宾语 |
  | `RC` / `定语从句` | 定语从句 |
  | 其余 | 照 `ROLES` 的写法 |

- **`check(o, act)`**，`act = { type: 'mark', from, to, role }`：
  - 和 `o.key` 里同一段同一成分是 `right: true`；
  - 否则 `right: false`，`misread` 按下面的规则认：

    | 学生的做法 | misread |
    |---|---|
    | 谓语只圈了一半：key 是 be/have + 分词，学生只圈了 be 或 have | 谓语只圈了一半（be/have 和后面的分词合起来是一个谓语） |
    | 把非谓语当成谓语：圈的是 to do / doing / done，key 里它不是谓语 | 把非谓语当成了谓语 |
    | 断早或断晚：一段的边界和 key 差一两个词 | 从句断早了 / 断晚了 |
    | 段对了，成分不对 | 成分标错了：这一段是 …，不是 … |

  - `o.key` 没写时：`check` 返回 `{ legal: true, right: null }`，不判。
- **`next(o)`**：key 里还没拉对的第一段，从外到里。都对了返回 `null`。
- **`predicates`**：
  - `parsed`：全对；
  - `main`：主干的几段（S、V、O / 表语）对了；
  - `span`：`span s.2-5 = V`。
- **`gestures`**：
  - `mark`：`span`，从一个词拉到另一个词，再点成分标签，翻成 `mark s.2-5 V`；
  - `fold`：`tap`，点一段，翻成 `fold s.3-6`。

**步骤**：

- [ ] **Step 1：写失败的测试**：
  - 「全对」：`The man who lives next door is a doctor.` 配 key `[S The man [RC who lives next door]] [V is] a doctor.`，照 key 拉三段以后 `parsed` 成立。
  - 「谓语只圈一半」：`He has been running.`，key 是 `[S He] [V has been running].`，学生 `mark s.2-2 V`，`misread` 有「只圈了一半」。
  - 「非谓语当谓语」：从 `evals/stage-gaps/ideal/E3.md` 取一句含 to do 的，`misread` 有「非谓语」。
  - 「断晚」：`misread` 有「断晚」。
  - 「key 对不上句子」：造句子时抛错。
  - 「没写 key 不判」：`right` 是 null。
- [ ] **Step 2：确认失败**：`node --test tests/stage-sentence-rules.test.js`。
- [ ] **Step 3：实现**。
- [ ] **Step 4：跑通**：测试全过，`npm test` 全过。
- [ ] **Step 5：提交**，说明写「舞台：句子（拆成分）的规则：老师给正确拆法，页面逐词比、认四种错法」。

### Task 8：接进场景和课堂循环

**文件**：
- 修改：`kit/src/stage/scene.js`
  - `case 'open'`：`wrong=` / `call=` / `undo=`，存进 `opens` 的那一项 `e.policy`；动作名可以是手势表里的名字（`rotate`、`insert`、`place`、`rowop`、`mark`、`fold`）。
  - `stash` 认 `@名字.done` / `@名字.right`，存进 `this.reactions` 的键 `名字.done` / `名字.right`。
  - `apply` 之后：规则层说某样东西做完了，交出 `名字.done` 的预写行。
- 修改：`kit/src/stage/stage.js`
  - `studentDo` / `openDone`：学生的每一下先过 `referee.judge`。`apply` 为 false 就不演，弹回。`mark` 为 true 时，在那一处加一个淡圈装饰（`decor`），下一次那样东西变了就收掉。裁判的结论挂在动作上：`act.verdict`。
  - `exec`（老师那一轮的行）：对属于有规则的东西的动作行，调 `judge(…, { by: 'teacher' })`，把核过的 `facts` 攒在 `stage.teacherAudit`。
- 修改：`kit/src/stage/loop.js`
  - `onAct`：`act.verdict` 带 `call === 'now'` 时，这一件事当 trigger。
  - 新的 trigger：`done`，规则层说做完了，又没有 `@名字.done`。
  - `finalize` 时把 `stage.teacherAudit` 交给 `turnMessage`，然后清掉。
- 修改：`kit/src/stage/events.js`
  - `eventsText`：每一下动作后面跟裁判的结论；
  - 新的一块 [跟着变的]，来自 Task 1 的 `fx.derived`；
  - [学生] 一块的长度上限：超过 2 KB 时，前面的并成「之前又试了 N 下……」。
- 修改：`kit/src/stage/doc.js` 的 `turnMessage`：加两块，「[页面核过你上一轮的几步]」和「[跟着变的]」，只在有内容时出现。
- 测试：`tests/stage-events.test.js`、`tests/stage-scene.test.js`、`tests/stage-class.test.js` 各加几条

**接口**：
- 消费：Task 1 的 `fx.derived`；Task 3 的 `judge` / `done`；Task 5～7 注册好的规则。
- 产出（Task 9、11 要用）：
  - `opens` 的一项是 `{ obj, action, refs, lo, hi, policy: { wrong, call, undo }, gesture }`；
  - 动作 `act.verdict = { legal, right, misread, why, next }`。

**步骤**：

- [ ] **Step 1：写失败的测试**：
  - 「open 的写法」：`open t rotate wrong=mark call=wrong undo=on` 存成那样的 policy；`wrong=maybe` 报错，列出 `quiet mark block`。
  - 「@t.wrong 报错」：报错原文是「走偏以后怎么讲要等你看着学生写，不能预写」。
  - 「@t.done」：插完、转平以后交出预写的行。
  - 「eventsText 带裁判结论」：一件 `try` 事件带 `verdict: { right: false, misread: '型从下往上读了', next: '在 30 左旋' }`，写出「不是正确的下一步，像是型从下往上读了；正确的是在 30 左旋」。
  - 「长度上限」：30 件 try，[学生] 一块不超过 2048 字节，里面有「之前又试了」。
  - 「老师的几步核过」：`turnMessage({ audit: ['你在 50 右旋，现在正确的是先在 30 左旋（LR 型）'] })` 出现「[页面核过你上一轮的几步]」。
  - 「跟着变的」：`turnMessage({ derived: [...] })` 出现「[跟着变的]」和「从 0 变成 1」。
  - 「旧 log 照放」：拿 `tests/stage-class.test.js` 里现有的一节课的 log，`replay` 以后的 `stateText()` 和改之前一样。改之前先存一份期望值进测试里。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现**。
- [ ] **Step 4：跑通**：`npm test` 全过；`node proto/stage/build.mjs && node tools/stage-try-selftest.mjs` 全过（旧例子照旧）。
- [ ] **Step 5：提交**，说明写「舞台：裁判接进学生和老师的每一下；open 的 wrong= / call= / undo=；@名字.done / .right；给老师的那一段带裁判结论、跟着变的、长度上限」。

### Task 9：通用手势和三个样板的画面

**文件**：
- 新建：`kit/src/stage/gestures.js`：五种手势的纯函数部分。
  - 从按下的部件、松手处的部件或空位，加上手势表，算出 `{ act, src }`；
  - 撤一步的「去掉最后一行学生指令」。
- 修改：`kit/src/stage/stage.js` 的 `armOpen`：按 `e.gesture` 分派到 `pointer.js`。
  - `drop-on` / `drop-at`：拖着部件的节点走，松手时用 `layout.js` 的 `pickTarget` 找落点；
  - `span`：从一个部件拉到另一个，画一道临时的线或括号；
  - `tap`；
  - `write`：数字键盘。新建 `kit/src/stage/keypad.js`，画面上的一块：0–9、`−`、`/`、退格、确定，按钮至少 44px。
- 修改：
  - `kit/src/stage/types/tree.view.js`：托盘、结点拖向父亲时的提示；
  - `matrix.view.js`：每行左边的把手、倍数框（用 keypad）；
  - `sentence.view.js`：拉出的临时括号、成分标签的一排小按钮。
- 修改：`kit/src/stage/stage.css`：手势的临时画面、淡圈、托盘、把手。颜色只用已有的变量。
- 测试：`tests/stage-gestures.test.js`（纯函数部分）；画面那部分靠 Task 11 的试演自检和 Task 12 的样子页。

**接口**：
- 消费：Task 3 的 `gestureOf`、Task 8 的 `opens[].gesture` / `policy`。
- 产出 `gestureAct(scene, e, { from, to, value }) → { act, src } | { error }`：
  - `from` / `to` 是部件或 `{ slot }`；
  - `value` 是 write 写的值。

**步骤**：

- [ ] **Step 1：写失败的测试**（`tests/stage-gestures.test.js`）：
  - 「树：拖到父亲上」：t#4（30）拖到它的父亲 t#1（50）上，往左上拖，得到 `src: 'rotate t#4 right'`；拖到不是父亲的结点上，得到 `{ error }`。
  - 「矩阵：行拖到行上」：r1 拖到 r3 上、k = −2，得到 `rowop M r3 - 2r1`；拖到行号上，得到 `rowop M r1 <-> r3`。
  - 「句子：拉一段」：从 s.2 拉到 s.4，标签 V，得到 `mark s.2-4 V`。
  - 「写一格」：`write M.2,3`、值 `-3/2`，得到 `write M.2,3 -3/2`。
  - 「撤一步」：`undoLines(lines) →` 去掉最后一条 `by: 'student'`。
- [ ] **Step 2：确认失败**。
- [ ] **Step 3：实现纯函数部分，再接画面**。画面接好以后，用 Playwright 在 iPad 竖屏 820×1180 的样子页（`?dev&blank`）上：
  - 真的触摸拖一次树、一次矩阵、一次句子（照 `tools/stage-touch.mjs` 的 CDP 触摸），截图看；
  - 截图只给自己看，`deviceScaleFactor: 1`。
- [ ] **Step 4：跑通**：
  - `npm test` 全过；
  - `node proto/stage/build.mjs && node tools/stage-audit.mjs` 不比改之前多出问题；
  - `node tools/stage-touch.mjs` 照旧全过。
- [ ] **Step 5：提交**，说明写「舞台：通用手势（点、拖到上面、拖到空处、拉一段、写一个值）和撤一步；三个样板的画面：拎结点、行把手和倍数框、拉括号和成分标签、数字键盘」。

### Task 10：给 Claude 的说明

**文件**：
- 修改：`kit/src/stage/doc.js`：`STAGE_TEACH`、`STAGE_COMMON`。
- 修改：`types/tree.js`、`matrix.js`、`sentence.js` 的 `doc` / `example`。
- 测试：`tests/stage-doc.test.js`（现有的「说明里每条写法照抄能演」会自动覆盖新写法）

**要写进去的**（设计第 2～5 节的写法，照抄能用）：
- `open 东西 动作 wrong= call= undo=`；
- `@名字.done` / `@名字.right`，以及「走偏不能预写」这一句；
- `when=` 的判断式，每种东西列出自己的；
- `{式子}`；
- `ask value … type= answer= wrong=`；
- 三个样板的手势表，各一行写清学生怎么动、翻成什么。

**顺手改掉缺口单里「说明写得不清楚」的 10 条**（`docs/stage-gaps.md` 那一节），逐条对上。

**步骤**：

- [ ] **Step 1：先在 `tests/stage-doc.test.js` 加一条「说明不清楚的 10 条都写明了」**，逐条查说明里有这些字：
  - `ask value` 那一行写明 `answer=` 可以不写；
  - `tag` 写明「最多 8 个字」；
  - `when=` 写明「部件比部件」和判断式；
  - `expect=` 写明只能写一个部件；
  - 拨数写明「能写进 {式子} 里驱动任何量」；
  - `retex` 和 `next` 写明区别；
  - `@` 预写写明「写下时就在今天的舞台上试一遍」；
  - 题卡写明矩阵里不能写 `$x$`；
  - `relax` 前写明 `tag g ∞`；
  - 贴字跟着部件消失、要用 `unlabel`。

  句子留空位的写法属于第 3 个子项目，这里写明「现在没有」。
- [ ] **Step 2：确认失败**：`node --test tests/stage-doc.test.js`。
- [ ] **Step 3：改说明**。
- [ ] **Step 4：跑通**：`node --test tests/stage-doc.test.js` 全过（照抄能演、长度不超），`npm test` 全过。
- [ ] **Step 5：重新生成** `evals/stage-gaps/stage-doc.txt`（命令在 `evals/stage-gaps/README.md`），一起提交，说明写「舞台的说明：open 的动作和裁判规则、判断式、{式子}、type=；改掉缺口单里说明写得不清楚的 10 条」。

### Task 11：试演工具跟上

**文件**：
- 修改：`tools/stage-try-lib.js`：`parseTry` 认新的学生写法 `rotate`、`insert`、`rowop`、`mark`、`fold`、`undo`、`dial`，都是 `how: 'do'`；学生能写的列表跟着改。
- 修改：`tools/stage-try.mjs`：学生的这几种写法走 Task 9 的 `gestureAct` 和真的 `openDone`；`dial k 3` 照真页面拨数器的 `studentDo('set k 3', { type: 'dial' … })`。
- 新建：`tools/stage-try-examples/avl.txt`、`elim.txt`、`parse.txt`
- 修改：`tools/stage-try-selftest.mjs`
- 修改：`tests/stage-try.test.js`

**步骤**：

- [ ] **Step 1：写失败的测试**：
  - `tests/stage-try.test.js` 加「新的学生写法」：`学生: rotate t.30 left` 解析成 `how: 'do'`；
  - 自检加这几条：
    - `avl.txt` 里学生在 50 左旋（型读反），「攒着」里有「从下往上读」；
    - 转平以后预写的 `@t.done` 演了、没叫老师；
    - `wrong=block` 时学生错的那一下没演上；
    - `elim.txt` 里 `学生: dial k 3` 之后「[跟着变的]」里有 M 的那一格；
    - `parse.txt` 里 `学生: mark s.2-2 V`，有「只圈了一半」；
    - `学生: undo` 以后那一下没了。
- [ ] **Step 2：确认失败**：`node --test tests/stage-try.test.js` 和 `node proto/stage/build.mjs && node tools/stage-try-selftest.mjs`。
- [ ] **Step 3：实现**。
- [ ] **Step 4：跑通**：两个都全过。
- [ ] **Step 5：提交**，说明写「试演工具：新的学生写法（旋转、插入、行变换、拉括号、折、撤一步、拨数）和自检」。

### Task 12：样子页里三个样板的试手感演示

**文件**：
- 修改：`proto/stage/main.js`：菜单多三项「试手感：平衡二叉树 / 消元 / 拆句子」。
- 新建：`proto/stage/feel.js`：三段镜头指令，开好 `open`，带挑战和 `@….done`。不调用 Claude；学生的每一下照真的裁判走，结论显示在画面角上一小块，只在这一页有，给我看裁判判成什么。
- 修改：`proto/stage/dist/`：`node proto/stage/build.mjs` 生成。

**内容**：
- **平衡二叉树**：托盘 47；插进去以后失衡，学生拎结点转平；`wrong=mark`。
- **消元**：(1 2 0 | 2; 2 2 −4 | 2; 0 0 −2 | −2)，学生拖行把手消成阶梯形；`when="M stairs"`。
- **拆句子**：`The man who lives next door is a doctor.` 配 key，学生拉括号、点成分；`when="s parsed"`。

**步骤**：

- [ ] **Step 1**：写 `feel.js` 和菜单。
- [ ] **Step 2**：用 Playwright 在 iPad 竖屏、横屏各打开三段，照 `tools/stage-touch.mjs` 的触摸各走完一遍。确认：
  - 挑战打勾；
  - 预写的「平了」演出来；
  - 页面没有报错。
- [ ] **Step 3**：`node proto/stage/build.mjs`，提交，说明写「样子页：三个样板的试手感演示（不调用 Claude）」。

### Task 13：用缺口单重新量

**文件**：
- 新建：`evals/stage-gaps/try2/{块}/…`、`evals/stage-gaps/report2/{科目}.md`
- 修改：`docs/stage-gaps.md`：文末加一节「底座做完以后重新量」。
- 修改：`evals/stage-gaps/README.md`

**步骤**：

- [ ] **Step 1：回归**。用新的试演工具，把 `evals/stage-gaps/try/` 下全部旧文件重跑一遍：`node tools/stage-try.mjs --json`，结果存到 scratchpad。和 Task 1 第 0 步存的基线 `try-baseline.json` 比：原来演得上的行，现在全都演得上。有不一样的，修到一样，或者在记录里写明为什么变了（比如 49′ 那条是有意改的）。
- [ ] **Step 2：开 3 个助手重新对照**（`general-purpose`，后台，同时）：
  - 一个做 D2；
  - 一个做 L1 和 L2：L1 用到 `{A + B}` 这类的几幕，L2 第 3～6 幕不靠三维的部分；
  - 一个做 E2 和 E3 拆成分的几幕。

  提示词照 `evals/stage-gaps/brief-try.md`，多两句：
  - 舞台说明用新生成的 `stage-doc.txt`；
  - 指令写到 `try2/`，报告写到 `report2/`，格式和上次一样。
- [ ] **Step 3**：用 `tools/stage-gaps-check.mjs` 的同一套检查查 `report2/`，把检查的目录加一个参数。
- [ ] **Step 4：对比**。这几幕「动」「页面当场」「事实」「分支·页面要提供什么」四项，上次和这次的 ✅ / ⚠️ / ❌ 数并排列出来。仍是 ❌ 的逐条看：
  - 是不是只因为第 3 个子项目的东西（三维、时间轴、词形）。不是的，记进缺口单当成底座没做到的。
  - 写进 `docs/stage-gaps.md` 末尾一节。
- [ ] **Step 5：提交**，说明写「缺口尺子：底座做完以后重新量三个样板相关的几幕」。

### Task 14：收尾：e2e、说明、合并、发布

**文件**：
- 修改：`CLAUDE.md`：舞台那一条后面加底座：规则接口、裁判、手势、`{式子}`、判答案、三个样板，各一句，指向设计。
- 修改：`docs/stage-plan.md` 的进度：加一条。
- 修改：`CLAUDE-PROJECT.md` 开头的版本号：改成新的一版，同一天再发加字母，现在是 2026-11-06e，下一个是 2026-11-06f。

**步骤**：

- [ ] **Step 1**：`npm test && npm run build && node proto/stage/build.mjs && npm run check:stage`，全过，`git status` 只剩要提交的。
- [ ] **Step 2**：`npm run e2e`，全过，特别是 `stage`、`stagestuck` 两段。没过的那段截图在 `.e2e-fail/`，修到过。
- [ ] **Step 3**：改上面三个文件，`npm run build`（版本号打进 `la-kit.js`），提交。
- [ ] **Step 4**：整条分支审一遍，照 executing-plans 或 subagent-driven-development 的最后一步。修完 Critical 和 Important。
- [ ] **Step 5**：合进 `main`：快进，推 `origin main`。
- [ ] **Step 6**：发布学习台，照 `CLAUDE.md`「发布」一节：
  - 页面 `kit/desk.html`；
  - `la-kit.js` 来自 `kit/dist/la-kit.js`；
  - `CLAUDE-PROJECT.md` 来自 `kit/dist/docs/CLAUDE-PROJECT.md`；
  - `components/*.md` 来自 `kit/dist/docs/components/`；
  - `pdf/*` 不用重传；
  - `capabilities` 不传；
  - url 是 https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo。
- [ ] **Step 7**：样子页 `proto/stage/dist/index.html` 也发布成一个 artifact，带 `stage-demo.js`。发布前先 `Artifact list` 看有没有已有的舞台样子页，有就更新那一个。把链接给我。
