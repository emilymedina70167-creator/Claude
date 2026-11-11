# 舞台主线第四轮（照引擎走、舞台上自己练）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 老师写一行 `follow`，页面照黑板的引擎知道这个算法每一趟该是什么样、学生做得对不对；舞台课里照着走过的内容下课进题库，「练一练」里换一组新数在舞台上自己练。做完我直接开学。

**Architecture:** 一个通用件 `kit/src/stage/follow.js`（纯函数：让引擎跑、拼出正确的路和每种错法的路、拿东西现在的样子去对），经 `rules.js` 的 `rulesOf(o)` 这一个入口盖在那种东西自己的规则上面，裁判、预写、挑战、叫老师都不改。每类算法只写一份「对应关系」（`kit/src/stage/follows/*.js`）。自己练是一个黑板组件 `stage`（嵌一块没有老师的舞台），所以「练一练」的挑题、证据、掌握一行不用改。

**Tech Stack:** 现有的：ES modules、`node --test`、Playwright（试演、真手指、e2e）。不加依赖。

**Spec:** `docs/superpowers/specs/2026-11-11-stage-mainline-4-design.md`（执行的人两份都读）

## Global Constraints

- 这一轮不写任何「页面懂某个算法」的规则：`types/*.rules.js` 里不加 `next` / `check`。算法的知识只从 `kit/src/engines/` 来。
- 不新造东西的种类；老师的写法只多 `follow`。
- 每类算法的对应关系文件 ≤ 150 行（不算测试、不算空行和注释）。**超了：停下来告诉用户，不硬做。**
- 页面不做教学决定：`follow` 默认什么都不标给学生；只在老师写了 `wrong=mark / block` 时标 `right: false` 的那一下；不在路上的（`off`）永远不标。
- 发给 Claude 的文字里提到学生不用「他」「她」；不用 `window.confirm / alert / prompt`；注释、报错、提交说明用中文。
- 说明：`STAGE_TEACH + stageDoc(科目)` 每门课 ≤ 24576 字节（操作系统只剩 70，`follow` 的说明不进共用那一节，只按对应关系的 `subjects` 带）。
- 重放不等于旧课：新加的「当场报」只看 `!c.lenient`；`Scene.clone()` 带上新字段（`o.follow`）。
- 改了 `kit/src/` 要 `npm run build` 和 `node proto/stage/build.mjs` 并提交产物（`kit/dist/la-kit.js`、`kit/dist/docs/`、`proto/stage/dist/stage-demo.js`）。
- 提交用 `.superpowers/ci.sh "说明" 文件…`（自动加署名两行）；推 `git push -u origin claude/admiring-cannon-4j7szs`。
- 检查从轻：每个任务只跑自己的单元测试和自己的试演；整套检查、旧课重放、只读助手审，只在任务 9 各跑一次。不跑模拟课。

## Review Focus

没有一个任务的测试会自然碰到、又最容易咬到用的人的五种情况（每条的测试加在写明的任务里）：

1. 一排里有重复的数（49 和 49′、两个 38）：照着走时两张一样的牌换了位置，页面不能说「不在路上」。（任务 2）
2. 老师 `follow` 以后自己又 `write` 了这一排 / 学生把 `follow` 的拨盘（希尔的 d）拨了：路要从新的样子重跑，跑不了要说「照不下去了」，不能拿旧路判。（任务 1、2）
3. 学生一上来就已经在某个检查点上（数据本来就有序、第一趟没有牌要动）：不能当成「学生做完了」叫老师、演 `@a.done`。（任务 1）
4. 练一练里随机取到引擎不收或者一上来就做完的数：要换一组，12 次都不行要在页面上报出来，不能给一道空题。（任务 5）
5. 舞台题做到一半走了（下一题、回学习台）：要记成放弃，不能算没做过。（任务 6 写、任务 8 的 e2e 验）

---

### Task 1: `follow.js` 通用的那一半

**Files:**
- Create: `kit/src/stage/follow.js`
- Modify: `kit/src/stage/rules.js`（`rulesOf`）
- Modify: `kit/src/stage/scene.js`（`follow` 指令、`clone()`、现状里的一行）、`kit/src/stage/script.js`（`COMMANDS` 加 `'follow'`）
- Test: `tests/stage-follow.test.js`

**Interfaces:**
- Produces（后面的任务都用）：
  - `registerFollow(name, adapter)`；`adapter = { engine, types: [东西的种类], subjects: [科目], head: 字段名 | null, fields(o, opts, scene) → 引擎的字段对象, stateOf(o, scene) → string, frames(run, spec) → [{ state: string, mark?: string, text?: string }], unit: string, doc: string, toKey?(run, o, scene) → string[][] }`
  - `followOf(name) → adapter | null`、`followNames() → string[]`
  - `traceOf(o, scene) → { path: [{ state, mark, text }], marks: [下标], variants: [{ label, path, marks }], error: string | null }`（按 `name + JSON(fields) + start` 缓存）
  - `whereOf(o, scene) → { at: number | null, passed: number, total: number, done: boolean, like: string | null, off: boolean, next: { mark, text } | null }`
  - `followRules(base, o) → 规则`：盖在 `base` 上面的 `next` / `check` / `facts` / `actOf` / `judges` / `doneBy` / `measures.pass` / `predicates.pass`、`done`、`onpath`
  - 东西上的字段：`o.follow = { name, fields, start }`（`start` 是写 `follow` 那一刻的 `stateOf`；`fields` 是老师写的那几项，不含从东西来的）
- 测试用一个假的对应关系（不依赖真引擎），在测试文件里 `registerFollow('fake', …)`，引擎用 `{ parse: (f) => f, run: (spec) => ({ steps: … }), variants: () => [{ label: '像是倒着排', input: … }] }` 临时挂进一个本文件导出的 `__setEngine(name, engine)`（只给测试用）。

- [x] **Step 1: 写会红的测试**（`tests/stage-follow.test.js`）。假的对应关系接在一排格子上：正确的路是 `['3 1 2', '1 3 2', '1 2 3']`，检查点是第 2、3 个（`mark: '第 1 趟'`、`'第 2 趟'`），一种错法的路 `['3 1 2', '3 2 1']`（检查点 `'第 1 趟'`）。断言：

```js
const s = make('array a = 3 1 2\nfollow a fake\nopen a move');
assert.deepEqual(pick(whereOf(o(s), s)), { at: 0, passed: 0, total: 2, done: false, like: null, off: false });
assert.match(s.stateText(), /a 照 fake 走：还没做完第 1 趟（共 2 趟）。第 1 趟做完该是：1 3 2/);
// 学生走到第 1 个检查点：对，算做对一步，没做完
let fx = stu(s, 'swap a#1 a#2');                 // 3 1 2 → 1 3 2
assert.equal(fx.judged.verdict.right, true);
assert.match(factsText(fx), /到了第 1 趟做完的样子（和引擎算的一样）/);
assert.deepEqual(fx.done || [], []);
// 走到错法的检查点：right false、misread 是那种错法的 label；默认 quiet 照做
const t = make('array a = 3 1 2\nfollow a fake\nopen a move');
fx = stu(t, 'swap a#1 a#3');                     // 3 1 2 → 2 1 3 不在任何路上
assert.equal(fx.judged.verdict.right, null);
assert.match(factsText(fx), /和第 1 趟做完该有的样子差 2 格：第 1 格（现在 2，该是 1）、第 2 格（现在 1，该是 3）/);
// 量、判断式、做完
assert.equal(evalMeasure(s, 'pass', 'a'), 1);
stu(s, 'swap a#1 a#3'); // → 1 2 3
assert.equal(whereOf(o(s), s).done, true);
assert.match(dryRun(s, 'goal g "x" when="a done"')[0].error, /成立/);   // 写下就已经成立的挑战不收（现有的那句话）
```

再加四条：`follow a off` 以后 `rulesOf` 回到一排格子自己的；`clone()` 以后 `whereOf` 一样；Review Focus 第 2 条（老师 `write a.1 9` 以后假引擎不收 → 现状写「照不下去了：<引擎的话>」，`o.follow` 还在但 `whereOf` 的 `off: true`、不判）；第 3 条（`array a = 1 2 3` + `follow a fake`，引擎的路只有一个状态 → `@a.done` 的行当场报「现在就已经做完了」，`open` 以后不叫老师）。

- [x] **Step 2: 跑，确认红** `node --test tests/stage-follow.test.js`，预期「follow 不是指令」之类。

- [x] **Step 3: 实现 `follow.js`**。要点（签名和测试定不了的）：
  - 路：`frames` 去掉连着重复的 `state`；`marks` 是带 `mark` 的下标；连着几个检查点 `state` 一样的并成一个，`mark` 写成「第 2、3 趟」。
  - `whereOf`：现在的 `state` 在正确的路上找**最靠后**的一处（同一个样子可能出现两次）；找不到再在每种错法的检查点里找 → `like`；都没有 `off: true`。`passed` 是 `at` 之前（含）的检查点个数；不在路上时 `passed` 是上一次在路上时的（记在 `o.follow.passed`，学生每一下以后更新）。
  - `check(o, act, scene, ctx)`：拿场景的副本把这一行先演一遍（`const s2 = scene.clone(); s2.apply({ ...act.line, lenient: true }, { by: 'page' })`——`by` 不是 student / teacher 时 `judgeLine` 不再过裁判，不会绕回来），再 `whereOf`。`act.line` 由盖上去的 `actOf` 挂上（`base.actOf` 交了动作就带着它，没交、但这一行是这样东西自己的指令时交 `{ type: c.cmd, line: c }`）。
  - `facts(before, after, act, scene)`：先 `base.facts`，再接上面测试里的三种话。差的格数超过一半只说「差 N 格」。
  - `next(o, scene)`：`done` 是 `null`；不然 `{ acts: [], why: '第 k 趟做完该是：<text>' }`。
  - `judges` / `doneBy`：这种东西手势表里的全部动作名。
  - 一上来就做完（路只有一个状态）：`done` 照旧是真，现有的「现在就已经做完了」那条路自然走到。

- [x] **Step 4: `rules.js`**：`rulesOf(o)` 改成 `const r = REGISTRY.get(o?.type) || null; return o?.follow && r ? followRules(r, o) : r;`（`followRules` 按 `o` 缓存在 WeakMap 里，`o.follow` 换了就重拼）。`rules.js` import `follow.js`；`follow.js` 不 import `rules.js`（免得绕圈：它要的 `base` 是传进来的）。

- [x] **Step 5: `scene.js` 的 `follow` 指令**（放在 `case 'open'` 旁边，全局指令，不是哪种东西自己的）：
  - `follow a sort shell gaps="5 3 1"`：第 1 个词是东西，第 2 个是对应关系的名字，第 3 个（可选）是 `head` 字段的值，其余 `字段=值` 原样收（不查选项表：字段是引擎的，引擎自己报）。
  - 当场报（`!c.lenient` 才报，重放时照做）：没有这样东西；没有这个对应关系（列出有哪些）；这种东西接不上（`types`）；引擎跑不了（引擎自己的那句话）。
  - `follow a off`：`delete o.follow`。
  - 现状：每样照着走的东西后面加一行（见 Step 1 的断言；`like` 时写「像是：…」，`off` 时写「不在引擎走的那条路上；离第 k 趟做完差 N 格」，跑不了写「照不下去了：…」）。
  - `clone()`：`o.follow` 是普通对象，确认 `structuredClone` 带着（测试里有）。

- [x] **Step 6: 跑绿** `node --test tests/stage-follow.test.js tests/stage-rules.test.js tests/stage-scene.test.js`

- [x] **Step 7: 提交**（`follow.js`、`rules.js`、`scene.js`、`script.js`、测试）

---

### Task 2: 排序的对应关系（接在一排格子上）

**Files:**
- Create: `kit/src/stage/follows/sort.js`、`kit/src/stage/follows/index.js`（import 各对应关系；`types/index.js` 末尾 import 它）
- Test: `tests/stage-follow-sort.test.js`

**Interfaces:**
- Consumes: `registerFollow`（任务 1）；`ENGINES.sort`（`parse(字段) → spec`、`run(spec) → { steps: [{ view: { A: [{ v, mark, id }] } }], passes: number[][] }`、`variants(spec) → [{ label, input }]`）
- Produces: 对应关系 `'sort'`（`types: ['array']`、`subjects: ['数据结构']`、`head: 'algo'`、`unit: '趟'`；快排的 `unit` 交「次划分」——`unit` 可以是 `(fields) => string`，任务 1 的 `followRules` 两种都收）

- [x] **Step 1: 写会红的测试**。用王道的那一排（`49 38 65 97 76 13 27 49′`）：

```js
const s = make("array a = 49 38 65 97 76 13 27 49′\nfollow a sort shell gaps=\"5 3 1\"\nopen a move");
assert.match(s.stateText(), /a 照 希尔排序（增量 5 3 1）走：还没做完第 1 趟（共 3 趟）。第 1 趟做完该是：13 27 49′ 97 76 49 38 65/);
// 学生照自己的先后理三条链（和引擎的先后不一样）：中间不判，理完到检查点
stu(s, 'swap a#3 a#8'); assert.equal(last(s).verdict.right, null);   // 65 ↔ 49′：引擎先动的是 49 ↔ 13
stu(s, 'swap a#1 a#6'); stu(s, 'swap a#2 a#7');
assert.equal(last(s).verdict.right, true);
assert.equal(evalMeasure(s, 'pass', 'a'), 1);
// 引擎认得的错法：把相邻的分成一组——做成那样的第 1 趟
const t = make("array a = 49 38 65 97 76 13 27 49′\nfollow a sort shell gaps=\"5 3 1\"\nopen a move");
// linesTo：测试文件里的小帮手——拿引擎 variants[0] 跑出来的第 1 趟那一排（牌的 id），用选择排序那样的对调一行行摆成它
for (const l of linesTo(t, 'a', firstPassIds(ENGINES.sort, t, 0))) stu(t, l);
assert.equal(last(t).verdict.right, false);
assert.match(last(t).verdict.misread, /相邻的元素分成了一组/);
```

再加：直接插入 `follow a sort insert`（`49 38 65 97 76 13`：`move a#2 -> a.1` 到第 1 趟；现状写「第 2、3 趟没有牌要动」）；快排 `follow a sort quick` 现状里的 `unit` 是「次划分」；Review Focus 第 1 条（`array a = 38 49 38′ 13`，直接插入，学生把 38′ 插到第 2 格 → 在路上；插到第 1 格（两张 38 换了先后）→ 不在路上、事实里说差哪两格）；Review Focus 第 2 条（`dial d = 5 range=1-5` + `follow a sort shell gaps="{d} 1"` **不支持**：字段里写 `{…}` 当场报「字段写死的数：拨盘变了页面不会重跑」）。

- [x] **Step 2: 跑，确认红**

- [x] **Step 3: 实现 `follows/sort.js`**：
  - `fields(o, opts)`：`{ ...opts, array: 这一排的字按格的先后拿空格连起来 }`（空格子当场报「这一排还有空着的格」）。
  - `stateOf(o)`：按格的先后，每张牌的 `key`（就是一开始在第几格，和引擎的 `id + 1` 对得上）拿空格连。
  - `frames(run, spec)`：`steps` 里 `view.A` 每张牌都在（`id` 不重复、没有空）的步；`text` 是那一步的数（`mark` 为 1 的写 `49′`）；检查点：对 `run.passes` 的每一趟，路上数和它一样的**最后**一步，`mark: '第 k 趟'`（快排「第 k 次划分」）。
  - 说明 `doc`（≤ 300 字节）：`follow a sort shell gaps="5 3 1"   照引擎走：现状里有每一趟做完该是什么样，学生做到一趟页面知道对不对、像哪种错法；algo 写 insert / shell / bubble / select / quick / merge / radix`。

- [x] **Step 4: 跑绿**；数一下 `follows/sort.js` 的行数记进任务 4 的账。

- [x] **Step 5: 提交**

---

### Task 3: 最短路的对应关系（图、表）

**Files:**
- Create: `kit/src/stage/follows/net.js`；Modify: `kit/src/stage/follows/index.js`
- Modify: `kit/src/stage/scene.js`（`follow` 接在表上时走 `toKey`：把结果写进 `o.key`）
- Test: `tests/stage-follow-net.test.js`

**Interfaces:**
- Consumes: `registerFollow`；`ENGINES.net`（`parse({ run: 'dijkstra', edges, from })`、`run(spec).steps[].view.hist: [{ pick, dist: { 顶点: 数 | null }, final: [顶点] }]`、`variants`）；图的东西 `o.nodes[].tag`、`visited`（`open g tag` / `open g visit`）；表的 `o.key`（`string[][]`）、`o.rowNames`、`o.colNames`
- Produces: 对应关系 `'net'`（`types: ['graph', 'table']`、`subjects: ['数据结构']`、`head: 'run'`、`unit: '轮'`）

- [x] **Step 1: 写会红的测试**。图用引擎测试里那张（`1>2:10 1>5:5 2>3:1 5>2:3 5>3:9`）：
  - 图：`graph g = …`、`tag g ∞`、`tag g.1 0`、`follow g net dijkstra from=1`、`open g tag`、`open g visit`。现状：「g 照 Dijkstra（从 1 出发）走：还没做完第 1 轮（共 4 轮）。第 1 轮做完该是：确定 1；dist 1=0 2=10 3=∞ 5=5」。学生 `visit g.1`、`tag g.2 10`、`tag g.5 5` → 最后一下 `right: true`、`pass(g) = 1`。再走成错法（Prim 的更新方式：第 2 轮把 `g.2` 写成 3）到那一轮的检查点 → `misread` 含「Prim 的更新方式」。
  - 表：`table T = _ _ _ _ / _ _ _ _ / _ _ _ _ rows="2 3 5" cols="第1轮 第2轮 第3轮 第4轮"`、`follow T net dijkstra on=g from=1` → `T` 的 `key` 是 `[['10','8','8','8'],['∞','14','9','9'],['5','5','5','5']]`；之后学生 `write T.1,1 10` 的事实照第三轮的表（「和答案一样」）。行名对不上顶点（`rows="A B C"`）当场报「表的行名要是图里的顶点：2、3、5」。
  - `follow g net prim` / `kruskal` / `bfs` / `dfs`：`frames` 认得出就开、认不出当场报「net 的 prim 还没接上」——**这四种各试一次，接得上的留下，接不上的写进 rulings，不为它们加代码超过 30 行**。

- [x] **Step 2: 跑，确认红**

- [x] **Step 3: 实现**。图的 `stateOf`：按顶点名排序，每个 `名=牌子上的数或∞` 后面 `*` 表示点过（确定了）。表的 `toKey`：一行一个行名对应的顶点、一列一轮，`null` 写 `∞`；列数比轮数少当场报。`scene.js`：接在表上的 `follow` 不设 `o.follow`，只设 `o.key`，并在现状里那一行「答案：收下了」后面写「（照 net dijkstra 算的）」。

- [x] **Step 4: 跑绿**；数行数。

- [x] **Step 5: 提交**

---

### Task 4: 数一次成本（检查点，不写代码）

- [x] **Step 1:** `grep -v '^\s*\(//\|$\)' kit/src/stage/follows/sort.js | wc -l`，`net.js` 同样。两个数写进 `docs/superpowers/specs/2026-11-11-stage-mainline-4-rulings.md`（新建：这一轮做的时候定的事都记这里）。
- [x] **Step 2:** 任何一个 > 150：**停下来**，把数、多出来的是什么、有没有办法挪进通用件，告诉用户，等回话。都 ≤ 150：接着做任务 5，不用问。

---

### Task 5: 黑板组件 `stage`（舞台上自己练）

**Files:**
- Create: `kit/src/blocks/stagedrill.js`、`kit/src/stagedrillspec.js`（纯函数：读围栏、取数、拼指令）
- Modify: `kit/src/blocks/index.js`（`stage: stageDrill`）、`kit/src/styles.css`（`.sd-*` 几条，颜色全走变量）
- Test: `tests/stagedrillspec.test.js`

**Interfaces:**
- Consumes: `practicespec.js` 的 `parseTemplate` / `instantiate`（`pick a = seq(8, 1, 99) distinct`）；`Stage`（`new Stage(host, { input: true, onAct })`、`stage.play(src, { by: 'teacher' })`、`stage.scene`）；`whereOf`（任务 1）；`session.record` / `session.event`（黑板组件交结果的老办法，`el` 是组件的根）
- Produces:
  - `parseStageDrill(src) → { id, picks: 模板, lines: string, error? }`（`---` 上面 `id:` 和 `pick …`，下面是镜头指令）
  - `drawStageDrill(spec, { rand, tries = 12 }) → { script: string, vars } | { error }`：取数、`{名字}` 换进去；用一个不画的 `Scene` 先演一遍——有演不上的行、照着走的东西引擎跑不了、或者一上来就做完，换一组
  - 组件交的记录：`session.record({ type: 'stage', q: 那样东西照什么走的一句话, ok: boolean, step: 第几个检查点, el })` 每个检查点一条；`session.event('final' | 'revealed' | 'giveup', el)`

- [x] **Step 1: 写会红的测试**（纯函数那一半）：`parseStageDrill` 读得出三部分；`drawStageDrill` 两次取的数不一样、`script` 里没有剩下的 `{a}`；Review Focus 第 4 条——`pick a = seq(3, 5, 5)`（取出来全是 5，一上来就做完）12 次都不行 → `{ error: /取了 12 组数都不成/ }`；指令里写错一行 → `{ error: /第 2 行/ }`。

- [x] **Step 2: 跑，确认红**

- [x] **Step 3: 实现两个文件**。组件的样子：一块舞台（高 `min(70vh, 620px)`、宽照容器），下面一行两个按钮「看下一趟该是什么样」「做不出来」（44px 高、`var(--sans)`）。逻辑：
  - `onAct` 每来一下，对每样照着走的东西 `whereOf`：`passed` 涨了 → 这个检查点记 `ok: true`（这一趟里先到过错法的检查点、或者按过「看下一趟」→ 先补记一条 `ok: false` 再记 `ok: true`）；`like` 第一次变成非空 → 记下「这一趟到过错法」。
  - 「看下一趟」：把 `whereOf(...).next.text` 写在按钮下面，`session.event('revealed', el)`。
  - 全做完：`session.event('final', el)`，按钮收起，写一句「做完了：N 趟里 M 趟一次做对」。
  - `drawStageDrill` 交了 `error`：照黑板组件的规矩画 `block-error`，并 `session.problems.push`（「练一练」照旧把它标成坏题）。
  - 登记草稿不需要（没有「还没交」的输入框）。

- [x] **Step 4: 跑绿**；浏览器里看一眼：`kit/examples/` 加 `stagedrill-demo.html`（一道希尔、一道直接插入），`node tools/check-lesson.mjs kit/examples/stagedrill-demo.html --shots <草稿目录>`，看截图两种 iPad 尺寸下舞台不出框、按钮按得到。把这一页加进 `package.json` 的 `check:pages`。

- [x] **Step 5: 提交**（含 `npm run build` 的产物）

---

### Task 6: 下课进题库、练一练、新题

**Files:**
- Modify: `kit/src/memory/drills.js`（`harvestDrills` 多收 `turns`、`pickDrills` 一次最多 2 道 `kind: 'stage'`）
- Modify: `kit/src/memory/desk.js`（`harvestSession` 舞台课时读 `class_turns` 传进去）
- Modify: `kit/src/memory/mastery.js`（`markFresh`）、`kit/src/memory/drillrun.js`（`closeDrill` 的 `fresh`；`leaveItem` 认舞台题）
- Test: `tests/memory-drills.test.js`（加一段）、`tests/memory-mastery.test.js`（加一条）

**Interfaces:**
- Consumes: `parseScript`（`kit/src/stage/script.js`）、`followOf`；舞台课的轮 `{ role: 'claude', text, discarded? }`
- Produces:
  - `stageDrillsOf({ session, turns, existing, now }) → [{ id, doc }]`（`harvestDrills` 在 `session.kind === 'stage'` 时调它）：编号 `d-stage-{块}-{对应关系}-{字段的指纹}`（指纹 = 字段按名字排序后 `名=值` 连起来，非字母数字换成 `_`）；`doc = { block, kind: 'stage', md: 一个 stage 围栏, q: '照 <算法> 走一遍', src: 'stage', fromSession, space, status: 'active', at, random: boolean }`
  - `random`：一排格子的题是 `true`（`pick a = seq(那一排的格数, 那一排最小的数, 最大的数) distinct`，范围太窄取不出不重复的就放宽到 `1–99`）；图的题是 `false`（照原样的边，不取数）

- [x] **Step 1: 写会红的测试**：
  - 一节舞台课的三轮里有 `array a = 49 38 65 97 76 13 27 49′` / `follow a sort shell gaps="5 3 1"` / `open a move` → 抄出一道，`md` 用 `parseStageDrill` 读得回、`drawStageDrill` 取得出；同一节课再抄一遍、另一节课同样的 `follow` 再抄，都是同一个编号、不重复。`discarded` 的轮不看；`follow a off` 掉的也照抄（老师教过）。
  - `pickDrills`：题库里 5 道舞台题全到期，挑出来的里最多 2 道 `kind: 'stage'`。
  - `markFresh`：`comp` 是 `d-stage-…`、题库里 `random: true` → 每一节都 `fresh`；`random: false` 的只有第一次（和 `d-lab-` 一样）。`markFresh(items, { drills })` 多收一个题库（现有的调用处补上）。
  - Review Focus 第 5 条在 `drillrun.js`：这是 DOM，放任务 8 的 e2e 里验。

- [x] **Step 2: 跑，确认红**

- [x] **Step 3: 实现**。`desk.js` 的 `harvestSession`：`kindOf(doc) === 'stage'` 时 `scoped.collection('class_turns').get()` 传 `turns`，并且**不要求 `report.items` 非空**（舞台课的报告里可以一道题都没有）。以前上过的舞台课首页打开时补抄：`fixReports` 里现有的「`sessions.drills` 没写过就补抄」那条路已经会走到（确认；没走到就在同一处加 `kind === 'stage'`）。`drillrun.js` 的 `leaveItem`：舞台题没 `final` 就走 → `session.event('giveup', …)`（现有的判断是找 `.is-wrong`，舞台题另加一个「组件根上有 `data-sd-open`」的判断，组件做完时去掉这个属性）。

- [x] **Step 4: 跑绿** `node --test tests/memory-drills.test.js tests/memory-mastery.test.js tests/memory-*.test.js`

- [x] **Step 5: 提交**

---

### Task 7: 说明、试演、`new4`

**Files:**
- Modify: `kit/src/stage/doc.js`（`stageDoc` 末尾按科目加「照引擎走」一小节）、`tests/stage-doc.test.js`
- Modify: `tools/stage-try-lib.js`（`NEW4` 表）、`tools/stage-must.mjs`（`--table new4`）、`tools/stage-cost-lib.js`（`follow` 归「搭」）
- Create: `evals/stage-gaps/new4/sort.txt`、`net.txt`
- Regenerate: `evals/stage-gaps/stage-doc.txt`

- [x] **Step 1: 测试**：`stageDoc('数据结构')` 里有 `follow a sort shell` 和 `follow g net dijkstra`；`stageDoc('操作系统')` 里没有 `follow`；六门课都 ≤ 24576（现有的测试会查，数据结构现在 23086，这一小节 ≤ 600 字节）。
- [x] **Step 2: 实现**：小节的字：一行通用形 + 每个对应关系的 `doc` + 两句（「现状里写着每一趟做完该是什么样；学生到了一趟页面当场知道对不对、像哪种错法」「量 pass(a)，判断式 a pass=2 / a done；`@a.right` 每到一趟演一次、`@a.done` 全做完演」）。
- [x] **Step 3: 两幕试演**：`sort.txt`（希尔三趟：学生做对第一趟、第二趟做成错法、老师的下一轮、做完；`@a.right say`、`@a.done say`）、`net.txt`（图上两轮 + 表上填一列）。`NEW4` 每幕 4～6 条必须出现的话（上面测试里那几句）+ `noAudit: [压着, 出了屏幕]`。
- [x] **Step 4: 跑** `node tools/stage-must.mjs evals/stage-gaps/new4 --table new4`，都 ✓。
- [x] **Step 5: 提交**（含重新生成的 `stage-doc.txt`、构建产物）

---

### Task 8: 学习台里走通（e2e）

**Files:**
- Modify: `tools/desk-e2e.mjs`（加一段 `stagedrill`）、`kit/src/memory/sample.js`（示例记忆里加一道 `d-stage-…` 的题和它挂的复现组）

- [x] **Step 1: e2e 的一段**：填示例记忆 → 首页「练一练」→ 挑到那道舞台题 → 用真的触摸把一趟做对（照 `tools/stage-touch.mjs` 里一排格子那一段的拖法）→ 做完 → 结果页 → 回首页：证据里有 `type: 'stage'` 的几条、报告里这道题是 `first`、复现组升了一档（换数的是新题）。再来一次：做到一半点「下一题」→ 证据里有 `giveup`（Review Focus 第 5 条）。页面报错、`meta/errors` 多一条都算没过（现有的规矩）。
- [x] **Step 2: 跑** `npm run build && npm run e2e -- --only stagedrill,drill`，过。
- [x] **Step 3: 提交**

---

### Task 9: 收尾：整套检查、文档、合并、发布

- [x] **Step 1: 整套检查各一次**（主目录）：`npm test`；`npm run check:stage`；`node tools/stage-must.mjs evals/stage-gaps/{fix1,new2,new3,new4} --table {fix1,new2,new3,new4}`（四次）；`npm run e2e`；`npm run check:pages`。红了的修，修完只重跑红的那一项。
- [x] **Step 2: 旧课重放一次**：`.superpowers/wt.sh` → 后台 `.superpowers/replay.sh run6` → `node .superpowers/cmp3.mjs`（先把里面的 `run5` 改成 `run6`）。不同的逐条看：有意的写进 rulings，不是有意的修。
- [x] **Step 3: 只读助手审一次**：范围 `kit/src/stage/follow.js`、`follows/`、`blocks/stagedrill.js`、`stagedrillspec.js`、`drills.js` / `mastery.js` / `drillrun.js` / `desk.js` 改过的函数。严重、要紧的修，一条一个测试；小的记进 rulings。
- [x] **Step 4: 文档**：`docs/stage-mainline.md` 加「第四轮」（做了什么、每类多少行、怎么再接一类算法——三步：写对应关系、登记、加一幕试演）；`CLAUDE.md` 舞台主线那一条接一句；`docs/stage-types.md` 加一节「接一类算法」；rulings 收尾；`CLAUDE-PROJECT.md` 版本改成发布那天的日期。
- [x] **Step 5: 构建、提交、合并**：`npm run build && node proto/stage/build.mjs`，`git status` 干净；推分支；`git fetch origin main`，能快进就 `git push origin HEAD:main`。
- [x] **Step 6: 发布**：先 `Artifact read` 两个，再发学习台（`kit/desk.html` + `la-kit.js` + `CLAUDE-PROJECT.md`）和舞台试课（`proto/stage/dist/index.html` + `stage-demo.js`）。
- [x] **Step 7: 告诉用户可以开学了**：三节课各自现在是什么样、新东西怎么用（一句话）、上完说一声我来量。
