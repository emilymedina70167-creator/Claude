# 舞台主线第一轮：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**：做一把量「老师的字里搭占多少」的尺子（静态的、读真课的），把量出来的 50 条页面毛病修掉，页面不说假话。不加新能力。

**架构**：
- 尺子是 `tools/` 下的纯函数库加两个脚本，不开浏览器、不调用 Claude；指令表从 `kit/src/stage/script.js` 的 `COMMANDS` 来。
- 50 条毛病分七个任务，按代码在哪分（判答案、提问、挑战和叫老师、写出来的字、各种东西、排版检查、排版根子）。每条先写会失败的测试：纯函数写 `node --test`，要真舞台的写一份最小的试演文件放 `evals/stage-gaps/fix1/`，在表里加一行。
- 验收靠三样：单元测试、`fix1` 的表、旧课照 log 放回和基线比。

**技术**：浏览器 ES 模块，esbuild（`npm run build`、`node proto/stage/build.mjs`），`node --test`，Playwright（`tools/playwright.mjs`）。

**设计**：`docs/superpowers/specs/2026-11-11-stage-mainline-1-design.md`。执行的人两份都读，以设计为准。每条毛病的原文、文件和行号在 `evals/stage-gaps/report3/{数据结构,线代,英语}.md` 每块「说明」里「页面的毛病」那张单子；编号「D4-1」是 D4 那张单子的第 1 条。

下面的 `$BASE` 指 `/home/user/Claude/.superpowers/baselines`（git 不收）；每个新开的终端先 `export BASE=/home/user/Claude/.superpowers/baselines`。

## 全局约束

- 分支 `claude/admiring-cannon-4j7szs`；不开 PR。
- 页面不做教学决定；事实以页面算的为准；不说假话、不静默失败。预写只收答案固定的。
- 这一轮老师的写法只多两处：`ask pick … order=on`、`span … stay` 能留几条。别的毛病不许靠加写法修。
- `STAGE_TEACH + stageDoc(科目)` 每门课 ≤ 24576 字节（`tests/stage-doc.test.js` 守着）；加一句就先看长度，超了压别的行。
- 重放旧课（`lenient`）照收不报：新加的「当场报」只对新写的行生效，旧课照以前的样子演、现状照实写。
- 发给 Claude 的话里提到学生不用「他」「她」。注释、报错、提交说明用中文；注释写为什么。
- 改了 `kit/src/`：`npm run build` 和 `node proto/stage/build.mjs`，产物（`kit/dist/`、`proto/stage/dist/`）和源码一起提交。跑试演、e2e 的时候别同时重新构建。
- 排序那个提交（`origin/claude/teaching-mode-code-review-vcz66v` 的 `68ff091`）只当参考：标了「照排序提交」的几条看它怎么改的再重做，不 cherry-pick，不带 `array.sort.js`、`array.rules.js`、`sort` 指令。
- 做的时候自己定的事记进 `docs/superpowers/specs/2026-11-11-stage-mainline-1-rulings.md`（第一次用到时建）。
- 提交说明最后两行：

```
Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014f77bBNhfQR7uQEB9NdAJp
```

## 审查要盯的

设计没写、测试也没直接碰、最容易咬到人的五处。每条的测试加在管那段代码的任务里（任务里标了「盯 N」）。

1. **旧课重放时新加的报错**：以前照演的写法（没分组的 `split`、一排里的 `_`、逆着箭头的 `walk`、式子框不认的函数）现在当场报——重放旧课（`lenient`）必须照旧演，不然我以前的舞台课翻不开。
2. **`order=on` 以外的 `ask pick` 一点不变**：没写 `order=on` 的，判法、发给老师的话、预写演不演，和基线逐字一样。
3. **刷新照 log 放回**：这一轮动了状态的（钉着的几条线、挑战的空心勾、贴字实际在哪边、重造时收掉的东西）刷新以后和刷新前一样；`clone()` 带上新加的字段。
4. **方括号的新读法碰到旧课**：一句话里同时有 `A[i]` 和 `[词]`、`fly` 写的是第几个词时，数到的词变了——旧课放回要照旧的读法。
5. **堆不判以后别把排序树也放掉**：一棵只有根、或者只有根和左孩子的树既是堆也是排序树——这时照旧按排序树判（平衡二叉树的课不能漏判）。

---

### 任务 0：准备和基线

**文件：**
- 建：`$BASE/try-4cc083f.json`（不进 git）

- [ ] **步骤 1：装依赖、构建、跑一遍全部测试**

```bash
cd /home/user/Claude && npm install && npm run build && node proto/stage/build.mjs && npm test 2>&1 | tail -5
```

要看到：`# fail 0`，`git status` 干净（产物和提交的一样）。

- [ ] **步骤 2：后台存基线**

341 个文件分四段并行（4 核会占满，这期间别跑别的试演）：

```bash
mkdir -p $BASE && cd /home/user/Claude && ls evals/stage-gaps/try/*/*.txt evals/stage-gaps/try2/*/*.txt evals/stage-gaps/try3/*/*.txt > $BASE/files.txt && split -n l/4 $BASE/files.txt $BASE/part- && for p in $BASE/part-*; do (node tools/stage-try.mjs $(cat $p) --json > $p.json 2> $p.err &); done
```

跑完（约两小时）把四份的数组拼成一份 `$BASE/try-4cc083f.json`。任务 1～3 不改 `kit/src/`，可以同时做；任务 4 以后要等基线跑完。

- [ ] **步骤 3：核基线**

```bash
node tools/stage-try-diff.mjs $BASE/try-4cc083f.json $BASE/try-4cc083f.json
```

要看到：没有不同；文件数 341。

---

### 任务 1：静态尺子

**文件：**
- 建：`tools/stage-cost-lib.js`、`tools/stage-cost.mjs`、`tests/stage-cost.test.js`
- 改：`package.json`（`"cost:stage": "node tools/stage-cost.mjs"`）

**接口：**
- 用：`parseTry(text)`（`tools/stage-try-lib.js`，把试演文件切成老师的段和学生的行）；`COMMANDS`（`kit/src/stage/script.js`；先 `import '../kit/src/stage/types/index.js'` 各种东西才注册进来）；`tokenize(line)`。
- 给后面：

```js
/** 指令 → 类。类：'说问' | '交给学生' | '例子' | '指给学生看' | '老师演' | '收拾'。COMMANDS 里每一条都要在 */
export const CLASS_OF: Record<string, string>
/** 造东西的指令（例子；带 hide=on 归「藏着的辅助」，重造已有的名字归「同名重造」） */
export const MAKERS: Set<string>
export const BUILD: Set<string>   // 算「搭」的类：'藏着的辅助' '收拾' '同名重造'
/** 一轮老师的行 → 每行 { line, src, cmd, cls, build: boolean, bytes, suspect: boolean, uses: string[] }。
 *  names：到这一轮为止造过的名字（函数里往上加）。uses：这一行 {…} 里用到的函数和运算（'det' 'rank' '^-1' '乘' ……） */
export function classifyRound(lines: {line:number, src:string}[], names: Set<string>): Row[]
/** 试演文件的文字 → { rounds: Row[][] }（一轮 = 两个学生动作之间老师的行） */
export function costOfTry(text: string): { rounds: Row[][] }
/** 合计：{ rounds, lines, bytes, build: { lines, bytes }, share, byClass: { [cls]: { n, bytes } }, suspects } */
export function sumCost(rounds: Row[][]): Sum
/** 搭的写法排行榜：[{ pattern, n, bytes, examples: [{ file, line, src }]（最多 3 个） }]，按 bytes 从大到小。
 *  pattern：'收拾·unlabel'、'同名重造·matrix'、'藏着的辅助·matrix（det、^-1）'（括号里是 uses 排好序） */
export function rankBuild(files: { file: string, rounds: Row[][] }[]): Rank[]
```

归类的表（设计 2.1）：
- 说问：`say` `ask`。交给学生：`open` `close` `goal` `keep` `back` `pick` `unpick` `press`。
- `@名字 …` 的行照 `@` 后面那条指令归类（`@g1 say …` 是说问，`@g1 label …` 是指给学生看）。行首的 `&` 去掉再认。
- 收拾：`remove` `clear` `ungoal` `hide`，以及所有 `un` 开头的。
- 指给学生看：`glow` `lift` `drop` `paint` `link` `pulse` `label` `retext` `camera` `wait` `fly` `dim` `cover` `show` `compare` `dial` `set`，以及各种东西注册的标注类指令（`mark` `tag` `ptr` `bf` `hop` `group` `span`……）。
- 老师演：各种东西注册的会改值的指令（`swap` `move` `write` `insert` `delete` `rotate` `rowop` `transform` `relax` `walk`……）。
- 各种东西注册进来的指令逐条看 `types/*.js` 的 `commands` 归到上面两类之一；拿不准的归「老师演」，记进 rulings。
- 写死的数（`suspect`）：`say` / `label` / `retext` / `card` 的引号里有阿拉伯数字，而这一行没有 `{`。不进搭。

- [ ] **步骤 1：写会失败的测试** `tests/stage-cost.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../kit/src/stage/types/index.js';
import { COMMANDS } from '../kit/src/stage/script.js';
import { CLASS_OF, MAKERS, classifyRound, costOfTry, sumCost, rankBuild } from '../tools/stage-cost-lib.js';

test('每条指令都归了类（加了指令不归类这里会红）', () => {
  const missing = [...COMMANDS].filter((c) => !CLASS_OF[c] && !MAKERS.has(c));
  assert.deepEqual(missing, []);
});

test('L3 第 7 幕那一轮：五张藏着的矩阵是搭，open / say / goal 是教', () => {
  const lines = [
    'vec q a = 1 1 color=g1', 'matrix Va = {q.a} hide=on', 'matrix Wa = {J Va} hide=on',
    'matrix Dg = {Va.1,1} 0 / 0 {Va.1,1} hide=on', 'matrix R = {Dg^-1 Wa} hide=on',
    'open q.a', 'say "两边各把特征方向找全。"', 'goal g1 "找出两条" when="det(Ka) = 0" collect=R n=2', '@g1 span q a stay',
  ].map((src, i) => ({ line: i + 1, src }));
  const rows = classifyRound(lines, new Set(['q', 'J']));
  assert.deepEqual(rows.map((r) => r.cls), ['例子', '藏着的辅助', '藏着的辅助', '藏着的辅助', '藏着的辅助', '交给学生', '说问', '交给学生', '指给学生看']);
  assert.deepEqual(rows[4].uses, ['^-1', '乘']);
  const sum = sumCost([rows]);
  assert.equal(sum.build.lines, 4);
  assert.ok(sum.share > 0.3 && sum.share < 0.6);
});

test('同名重造、收拾、写死的数', () => {
  const rows = classifyRound(['array a = 3 1 2', 'unlabel n', 'array a = 1 2 3', 'label c a "逆序对 2 个"', 'label d a "逆序对 {inv(a)} 个"'].map((src, i) => ({ line: i + 1, src })), new Set());
  assert.deepEqual(rows.map((r) => r.cls), ['例子', '收拾', '同名重造', '指给学生看', '指给学生看']);
  assert.deepEqual(rows.map((r) => r.suspect), [false, false, false, true, false]);
});

test('试演文件：学生的行切开一轮一轮，注释不算；排行榜按字节排', () => {
  const text = '# 注释\nmatrix A = 1 2 / 3 4\nmatrix H = {A^-1} hide=on\nsay "看"\n学生: next\nremove H\nsay "好"\n';
  const { rounds } = costOfTry(text);
  assert.equal(rounds.length, 2);
  const rank = rankBuild([{ file: 'x.txt', rounds }]);
  assert.equal(rank[0].pattern, '藏着的辅助·matrix（^-1）');
  assert.equal(rank[1].pattern, '收拾·remove');
  assert.equal(rank[0].examples[0].line, 3);
});
```

- [ ] **步骤 2：跑，看它红** `node --test tests/stage-cost.test.js` → 找不到模块。
- [ ] **步骤 3：写 `tools/stage-cost-lib.js`**（上面的接口和表）。
- [ ] **步骤 4：跑，看它绿**。
- [ ] **步骤 5：写 `tools/stage-cost.mjs`**

`node tools/stage-cost.mjs [文件或目录…] [--json] [--top 15]`，不给就量 `evals/stage-gaps/try3/`。打印：每块一行（文件数、轮数、每轮平均字节、搭占几成）、合计、排行榜前 `--top` 条（写法、次数、字节、三处例子「文件:行」）、写死的数有几处。`--json` 打印 `{ blocks, total, rank }`。

- [ ] **步骤 6：跑真数据**

```bash
node tools/stage-cost.mjs evals/stage-gaps/try3 > /tmp/cost-try3.txt && head -40 /tmp/cost-try3.txt
```

要看到：十块各一行，L3 的搭占比明显高于别的块（那里每幕五张藏着的矩阵）；没有「没归类」。看着不对的归类改表，记进 rulings。

- [ ] **步骤 7：提交** `git add tools/stage-cost-lib.js tools/stage-cost.mjs tests/stage-cost.test.js package.json && git commit -m "舞台主线：静态尺子（老师的字里搭占多少、搭的写法排行榜）"`

---

### 任务 2：读真课

**文件：**
- 改：`tools/stage-cost-lib.js`、`tests/stage-cost.test.js`
- 建：`tools/stage-lesson.mjs`

**接口：**
- 用：任务 1 的 `classifyRound`、`sumCost`；`ANSWER_TYPES`（`kit/src/stage/answer.js`）。
- 真课的数据：`<目录>/sessions/<课号>.json`（`kind: 'stage'` 的才量）、`<目录>/sessions/<课号>/class_turns/<seq>.json`。老师的一轮 `{ role: 'claude', text, log, cost: { bytes, ms, first } }`（`kit/src/stage/classroom.js` 开头的注释）；`discarded: true` 的不算。读目录照 `tools/guard-audit.mjs` 的 `readColl`。
- 给后面：

```js
/** 说明里的每一种写法：[{ name, re }]。每条 COMMANDS 一项（行首或 @… 后面是这条指令），再加：
 *  'open wrong=' 'open call=' 'open undo=' '@名字.done' '@名字.right' '@ask.right' '@挑战' '{式子}' 'hide=on' '& 一起演'
 *  'goal collect=' 'ask tap' 'ask drag' 'ask pick' 'ask next' 'ask value'，每种 type 一项（'ask value type=set'……），
 *  每个量一项（'count(' 'height(' 'tray(' 'rank(' 'rankA(' 'free(' 'det(' 'verbs(' 'left('） */
export const FEATURES: { name: string, re: RegExp }[]
/** 老师每一轮的原文 → { used: { [name]: 次数 }, unused: string[] } */
export function featureUse(texts: string[]): { used: Record<string, number>, unused: string[] }
/** 一节课的 class_turns（照 seq 排好）→
 *  { turns: [{ seq, lines, played, missed: [{ src, error }], bytes, build, ms, first, hands: boolean }],
 *    total: Sum & { missed, ms, first }, features, talkRuns: 最长连着几轮学生手上没事 }
 *  hands：这一轮老师的行里有 open、goal、或 ask tap / drag / pick / value（只有 say、ask next、ask say 是「只有话」） */
export function lessonCost(turns: object[]): Lesson
```

「没演上」：`text` 里是指令的行不在 `log` 里的；报的话从下一条学生的轮里「[上一轮没演的行]」那一段取（取不到留空）。

- [ ] **步骤 1：写会失败的测试**（加在 `tests/stage-cost.test.js`）

```js
test('一节真课：没演上的行、每轮等几秒、学生手上有没有事、一次没碰的写法', () => {
  const turns = [
    { seq: 1, role: 'claude', text: 'array a = 3 1 2\nsay "看这一排"\nask next "看清了点下面"', log: ['array a = 3 1 2', 'say "看这一排"', 'ask next "看清了点下面"'], cost: { bytes: 9000, ms: 8000, first: 2000 } },
    { seq: 2, role: 'user', text: '学生点了「接着」' },
    { seq: 3, role: 'claude', text: 'open a\ngoal g1 "排好" when="a sorted"\nlable x a "错字"', log: ['open a', 'goal g1 "排好" when="a sorted"'], cost: { bytes: 9500, ms: 6000, first: 1500 } },
    { seq: 4, role: 'user', text: '[上一轮没演的行] 第 3 行「lable x a "错字"」：不认得 lable' },
    { seq: 5, role: 'system', kind: 'stale', discarded: true, text: '…' },
  ];
  const r = lessonCost(turns);
  assert.equal(r.turns.length, 2);
  assert.deepEqual(r.turns.map((t) => t.hands), [false, true]);
  assert.equal(r.turns[1].missed[0].src, 'lable x a "错字"');
  assert.match(r.turns[1].missed[0].error, /不认得 lable/);
  assert.equal(r.total.missed, 1);
  assert.equal(r.total.ms, 14000);
  assert.equal(r.talkRuns, 1);
  assert.equal(r.features.used['open'], 1);
  assert.ok(r.features.unused.includes('@ask.right') && r.features.unused.includes('ask pick'));
});
```

- [ ] **步骤 2：跑，看它红。步骤 3：实现。步骤 4：跑，看它绿。**
- [ ] **步骤 5：写 `tools/stage-lesson.mjs`**

`node tools/stage-lesson.mjs <存数据的目录> [课号…] [--json]`：不写课号量全部舞台课。每节打印：课号、日期、科目和块、几轮、没演上几行（原文和报的话）、每轮平均字节和搭占比、每轮平均等几秒和出第一个字几秒、最长连着几轮只有话、用过的写法（按次数）、一次没碰的写法。最后一段合计：所有课一次都没碰的写法。

- [ ] **步骤 6：量现有的课**（控制者做，要 `ArtifactData`）

学习台是 `https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo`。`ArtifactData list` 把 `sessions` 存到 `$BASE/desk/sessions/`，对里面 `kind: 'stage'` 的每一节把 `sessions/{课号}/class_turns` 存到 `$BASE/desk/sessions/{课号}/class_turns/`。然后：

```bash
node tools/stage-lesson.mjs $BASE/desk > $BASE/lessons-before.txt && node tools/stage-lesson.mjs $BASE/desk --json > $BASE/lessons-before.json
```

顺手读一份 `meta/errors`、`meta/health`（`CLAUDE.md`「防错的四道」第 3 条：开工先读），有新的记下来。数据是私人的：只放 `$BASE`，不进 git；写进文档的只有数和指令行，不抄学生说的话。

- [ ] **步骤 7：提交**（库、脚本、测试）。

---

### 任务 3：`fix1` 的架子

**文件：**
- 改：`tools/stage-try-lib.js`（`MUST` 旁边加 `FIX1`、查法加「不许出现」）、`tools/stage-must.mjs`（`--table fix1`）、`tests/stage-try.test.js`
- 建：`evals/stage-gaps/fix1/README.md`

**接口（给任务 4～10）：**

```js
/** 一行：{ id: 'L3-3', files: ['L3-3.txt'], checks: [C(re, what)], nots: [C(re, what)], audit?: [C(re)], noAudit?: [C(re)] }
 *  checks：叫老师的那一条里（或最后攒着的）必须有；nots：每一步的 called.msg、pending、state 里都不许有；
 *  audit / noAudit：排版那一栏（每一步 issues 拼成的字）必须有 / 不许有。竖屏、横屏都查 */
export const FIX1: Row[]
export function mustNotHits(steps, re): { step, where: 'called' | 'pending' | 'state' }[]
export function auditHits(steps, re): number[]
```

`node tools/stage-must.mjs evals/stage-gaps/fix1 --table fix1`：照 `FIX1` 查；表里的文件不在、有 ✗ 退出码 1。`README.md` 写：一条毛病一个文件，文件名就是编号，写最小的一幕；能用单元测试守住的不放这里。

- [ ] **步骤 1：写会失败的测试**（`tests/stage-try.test.js`）

```js
test('fix1 的查法：不许出现的在叫老师的那条、攒着的、现状里都查', () => {
  const steps = [{ called: { msg: '学生填了「1,4」——填错了' }, state: '在等学生：打字回答' }, { pending: '做到了', state: '好' }];
  assert.deepEqual(mustNotHits(steps, /填错了/), [{ step: 0, where: 'called' }]);
  assert.deepEqual(mustNotHits(steps, /打字回答/), [{ step: 0, where: 'state' }]);
  assert.deepEqual(mustNotHits(steps, /没有的话/), []);
});
test('fix1 的表：每行有编号、文件，checks / nots / audit / noAudit 至少一样', () => {
  for (const r of FIX1) { assert.match(r.id, /^(D1|D3|D4|L3|E1)-\d+$/); assert.ok(r.files.length); assert.ok((r.checks?.length || 0) + (r.nots?.length || 0) + (r.audit?.length || 0) + (r.noAudit?.length || 0) > 0); }
});
```

- [ ] **步骤 2～4：红、实现（`FIX1` 先是空数组）、绿。**
- [ ] **步骤 5：提交。**

---

### 任务 4～8 共用的做法

每条毛病一轮：

1. 读报告里那一条的原文（文件、行号、截图名）。
2. 写会失败的测试：表里写了「单元」的写在指定的测试文件里；写了「fix1」的建 `evals/stage-gaps/fix1/{编号}.txt`（从报告指的那一幕里剪出最小的几行）并在 `FIX1` 加一行。
3. 跑，看它红（fix1：`node tools/stage-try.mjs evals/stage-gaps/fix1/{编号}.txt` 看到报告里那句假话）。
4. 改。只改这一条要的。
5. 跑，看它绿；`node --test tests/stage-*.test.js` 全绿。
6. 一条一个提交：`舞台主线：{编号} {一句话}`。

每个任务最后：`npm run build && node proto/stage/build.mjs && npm test && npm run check:stage && node tools/stage-must.mjs evals/stage-gaps/fix1 --table fix1`，产物单独提交一次。

---

### 任务 4：判答案、判对错

| 条 | 在哪 | 测试 | 改成 |
|---|---|---|---|
| L3-3 | `kit/src/stage/answer.js` `case 'set'`（379 行起）：`bare` 只补学生那边 | 单元 `tests/stage-answer.test.js`：`judgeAnswer('1,4', { type: 'set', answer: '1,4' }).ok === true`；`judgeAnswer('4, 1', { type: 'set', answer: '1,4' }).ok === true`；`judgeAnswer('1', { type: 'set', answer: '1,4' }).ok === false`；`answer: '{1, 4}'`、`answer: '(1,4)'`（区间）照旧 | 老师的 `ans` 也过 `bare` |
| D4-1 | `kit/src/stage/types/tree.rules.js` 判 `insert` 的那一段（285 行那句「这里不是二叉排序树里…」） | 单元 `tests/stage-tree-rules.test.js`：堆 `87 45 78 32 17 65 53 09` 上 `insert #4 right 63` → `legal: true`、`right: null`、`why` 对得上 `/不是二叉排序树，页面没判这一下对不对/`；排序树 `50 30 70` 上放错位置照旧 `right: false`；**盯 5**：只有根 `50`、根加左孩子 `50 30` 的树照旧按排序树判 | 这一下之前 `isBst(o)` 是假：不判对错（`right: null`，事实照写放在了谁的哪边）。`right: null` 在 `referee.js` / `events.js` 里已有「没判成」的写法，沿用，看一眼话对不对 |
| D3-8 | `kit/src/stage/script.js` `OPTIONS.ask.pick` 加 `order`；`kit/src/stage/scene.js` `pickAnswer` / `pickText`；`kit/src/stage/doc.js` | 单元 `tests/stage-scene.test.js`：`ask pick g "按 Kruskal 的先后点" expect="g.A~B g.C~D g.B~C" order=on`，学生点 `g.C~D g.A~B g.B~C` → 不算对、`pickText` 写「点的是这几个，先后不对：该是 …，点成了 …」；同一问不写 `order=on` → 和现在逐字一样（**盯 2**：断言用现在的输出原文）；`order=on` 写在 `ask tap` 上当场报 | 多一个选项；`@ask.right` 只在连先后都对时演。说明在 `ask pick` 那一行加半句「order=on 连先后一起比」 |
| D4-7 | `kit/src/stage/answer.js` `checkSpec`（`type=formula`）；`kit/src/formula.js` 88 行那句「不认识…」 | 单元 `tests/stage-answer.test.js`：`checkSpec({ type: 'formula', free: 'n', answer: 'floor(log2(n))+1' })` 抛 `/式子框不认 floor/`；`lenient` 时不抛（**盯 1**）。`tests/formula.test.js`（没有就加在现有测 `formula.js` 的文件里）：不认识的名字报错的话里那一句只出现一次 | 出题时拿学生那边的读法（`formula.js`）把答案读一遍，读不了当场报 |
| D1-9 | `kit/src/stage/stage.js` 1671、1720 行的 `'对吗'` | 单元：加一个导出的纯函数 `askButtonText({ answer }) → '对吗' | '写好了'`，单元 `tests/stage.test.js` 测它 | 没写 `answer=` 的写「写好了」 |

- [ ] 照「共用的做法」一条一条做（5 条）。
- [ ] 任务末尾的构建、全测、提交产物。

---

### 任务 5：提问的那一轮

| 条 | 在哪 | 测试 | 改成 |
|---|---|---|---|
| D3-3、D4-5 | `kit/src/stage/stage.js` `enqueue`（265 行：`ask` 一进队就 `asked = c`） | fix1 `D3-3.txt`：一轮里 `ask drag k.1 g.B~C "…"`（图不能拖）后面跟 `say "…"`、`ask tap c "点「修」"`；`FIX1` 查：`nots` `/ask 之后的行不演/`、`/在等学生：打字回答/`，`checks` `/图不能拖/`、现状里是「在等学生：点 c」。fix1 `D4-5.txt`：一轮只有一个写错的 `ask pick A B "…"`：`checks` `/这一轮的提问没演上/`，`nots` `/在等学生：打字回答/`，并且那一步 `called` 不是空的（页面马上叫了老师） | `asked` 等这一条真演上了才记；没演上的 `ask` 后面的行照演。一轮演完一个 `ask` 都没演上、又写过 `ask`：现状写「这一轮的提问没演上」，`kit/src/stage/loop.js` 当成「学生手上没事」马上带着没演的行叫老师（同一轮只自动叫一次，免得来回） |
| D4-6 | `kit/src/stage/scene.js` 1268 行（`ask pick` 的 `refs` 是空的那句） | 单元 `tests/stage-scene.test.js`：`ask pick lay "点出空着的格子" expect="lay.6"`（没有 `lay`）抛 `/舞台上没有 lay/` | 先看写的名字在不在舞台上 |
| D3-7（第二句） | `kit/src/stage/scene.js` 的 `expect=`（`ask tap` / `ask drag`） | 单元：`ask tap g "…" expect="g.B~D g.C~D"` 抛 `/点一个的预期只能写一个部件.*ask pick/` | 报清楚，指到 `ask pick` |
| E1-3 | 学生点了一下交给课堂的那一行（`kit/src/stage/stage.js` 里 `ask tap` 的回答；编号现在取的是提问时记下的） | fix1 `E1-3.txt`：照 `try3/E1/幕2.txt` 第 38–44 行剪：提问 → 预写的 `rewrite` 换句子 → 学生点 holding；`checks` `/学生点了 s\.3（holding）/`，`nots` `/s\.4（holding）/` | 照点的那一刻的句子算编号 |
| D1-15 | `kit/src/stage/scene.js` 2185 行 `pickDiffText` 的调用处 | 单元 `tests/stage-scene.test.js`：`ask pick a "…"`（没写 `reveal=on`）→ 学生点两个 → 老师 `swap a.4 a.7`：发给老师的那段里没有 `/这一下以后变了的/`；写了 `reveal=on` 的照旧有 | 没写 `reveal=on` 不发 |

- [ ] 照「共用的做法」做（6 条）。
- [ ] 任务末尾的构建、全测、`npm run e2e -- --only stage,stagestuck`、提交产物。

---

### 任务 6：挑战和叫老师

| 条 | 在哪 | 测试 | 改成 |
|---|---|---|---|
| D4-4 | `kit/src/stage/goal.js` `goalStatus`（279 行「做到过；现在不成立」）；挑战那一条的画法在 `kit/src/stage/stage.js`（找画 ✓ 的地方）、`stage.css` | 单元 `tests/stage-goal.test.js`：做到过、现在不成立 → 画法用的状态是 `'was'`（新导出 `goalMark(goal, scene) → 'met' | 'was' | 'open'`）；东西拿掉以后 `stateText()` 里这条挑战只有一行 `/判不了：t 拿掉了/`，不是每个子句一遍。fix1 `D4-4.txt`：做到 → 拨走，截图里是空心的勾（`FIX1` 查现状「做到过；现在不成立」，画面由 `tools/stage-audit.mjs` 加一条：现状不成立时不许有实心勾的类名） | `'was'` 画空心的勾（类名 `is-was`）；刷新照 log 放回一样（**盯 3**） |
| D1-2 | `kit/src/stage/loop.js` 230、296 行（`reacts.filter(…)` 数的是哪一组） | 单元 `tests/stage-events.test.js` 或 `tests/stage-class.test.js`（看 `onGoal` 现在在哪测）：两条挑战同一下做到，g5 预写 1 行、g6 预写 2 行 → 写给老师的是各自的 1 行、2 行，不是都写 3 行 | 每条挑战数自己的预写行 |
| D1-3 | `kit/src/stage/scene.js` 663 行（`on=` 的按钮不在手上的这一问里） | 单元 `tests/stage-scene.test.js`：`goal g3 "…" when="a sorted" on="排好了"`、`ask next "…" button="排好了"` → 学生按过、换了下一问以后，`errors` 里不再有 `/没有「排好了」这个按钮/` | 这条挑战的按钮按过了就不再报 |
| D4-11 | `kit/src/stage/events.js` `eventsText`（368 行） | 单元 `tests/stage-events.test.js`：事件照 `at` 是「做到 g2 → 点了 a.3 → 做到 g3 → 六下拖动和撤回」→ 写出来的先后一样；超过 `STUDENT_MAX` 被压的时候，留下的几条也照 `at` 排 | 排版只按 `at`；要紧程度只决定留哪些，不决定先后 |
| E1-6 | `kit/src/stage/events.js` `hasWork`（41 行） | 单元 `tests/stage-events.test.js`：老师这一轮自己写的 `ask next "…" button="拨好了"` 还没按、学生做到了最后一个挑战 → `hasWork(scene) === true`（不叫老师）；预写里出的 `ask next` 照旧是 `true`；`ask say`（打字）不算手上有事，照旧 | 没按的 `ask next` 不分是谁写的 |
| L3-4 | `kit/src/stage/scene.js` 的 `hiddenError`（1438 行那一处：`goal` 的 `when=` 里有藏着的东西） | 单元 `tests/stage-scene.test.js`：`matrix J = 2 1 / 0 2 hide=on`、`plane q`、`vec q a = 1 1`、`matrix Ka = {q.a} … hide=on`、`open q.a`、`goal g1 "…" when="det(Ka) = 0"` → 收下；`when=` 里的东西全藏着、又没有一样开着的东西能改到它 → 照旧报 | 挑战里的量顺着「跟着算」往上找得到一样开着给学生的东西，就不拦 |

- [ ] 照「共用的做法」做（6 条）。
- [ ] 任务末尾的构建、全测、`npm run e2e -- --only stage,stagestuck`、提交产物。

---

### 任务 7：写出来的字、跟着算的数

| 条 | 在哪 | 测试 | 改成 |
|---|---|---|---|
| D1-4、L3-8 | `kit/src/stage/script.js` `parseRich`（189 行） | 单元 `tests/stage-scene.test.js`（`parseRich` 已在那里测）：`parseRich('A[j+dk]=A[j];')` 没有能飞的词、文字原样；`'再填：A[____]=A[j]'`、`'f(x)[0]'` 一样；`'把 [枢轴] 放好'` 照旧一个能飞的词；`'P = [p1 p2]'`：先看能飞的词现在带不带空格（看 `fly` 的用法和旧试演文件），不带就原样画，定了记进 rulings。**盯 4**：`lenient` 时照旧的读法（`parseRich(text, { lenient: true })`），测一条 `'A[i] 和 [词]'` 旧读法数到两个 | 照排序提交 rulings 第 67 行的读法 |
| L3-2 | `kit/src/stage/types/tex.js` `prepTex`（53 行） | 单元 `tests/stage-tex.test.js`：`prepTex('\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}')` 里 `&` 还是 2 个；`prepTex('x &= 1')` 照旧第一个 `&` 换成对齐点；环境外一个对齐点加环境里的 `&` 各管各的 | `\begin{…matrix / array / cases / aligned}` 到 `\end` 之间的 `&` 不动 |
| D4-3 | `kit/src/stage/value.js` `numText`（292 行）和它的调用处（324 行） | 单元 `tests/stage-value.test.js`：跟着算的格子 `{t#8}`（那个结点写的是 `09`）→ 写出 `09`；`{a.8}`（`49′`）→ `49′`；`{t#8 + 1}` → `10`；`{a.8 + 0}` → `49` | 式子只是原样取一个部件时，写那个部件的字 |
| D4-2 | `kit/src/stage/scene.js` 1983 行（`rec.error` 时「停在上一次算出来的数」）；画法在跟着算的格子那里（各 `types/*.view.js` 的格子 / `stage.js`） | fix1 `D4-2.txt`：照 `try3/D4/幕8.txt` 第 17–23 行剪；`checks`：现状里那一排的那一格写「?」、`/现在算不出来/`；单元 `tests/stage-scene.test.js`：算不出来的格子值是 `'?'`，上游又算得出来以后回到数 | 算不出来的格子画成「?」（已有的先例：比较运算碰到空格子画「?」，提交 `74cb8c0`），现状写「现在算不出来：…」，不再说「停在上一次算出来的数」 |
| D3-1 | `kit/src/stage/types/graph.view.js` `weightEl`（35 行）和 89 行 `partNode` | fix1 `D3-1.txt`：`graph g = A-B:{k} …`、`dial k = 5`、`set k 4`、同名重造一次；`tools/stage-try.mjs` 的每一步已经存画面上的字？没有就在 `tools/stage-measure.mjs` 的量里加「每个部件画出来的字」，`FIX1` 多一种查法 `shown: [{ part: 'g.A~B', text: '4' }]`。单元 `tests/stage-graph.test.js` 测「权的字从 `e.w` 现在的值来」的那个纯函数 | 每次画都照现在的权写字、算宽 |
| D3-2 | `kit/src/stage/scene.js` 1217–1221 行（`dial … at=`） | 单元 `tests/stage-scene.test.js`：`graph g = 1-2:3`、`dial w = 3 range=-6..3 at=g.1~2` → 拨盘的 `refs` 是 `['g.1~2']`，`dialAt` 里没有它，现状里没有 `/还没造/`；`at=zz`（没有的名字）照旧记着等 | `at=` 是已有东西的部件就挂在部件上（贴的字本来就能贴部件） |
| D1-6 | `kit/src/stage/types/array.js` 造一排的那一行；`kit/src/stage/scene.js` 话里 `{…}` 的检查（241 行附近 `loose`） | 单元 `tests/stage-scene.test.js`：`array h = _ 49 38` 抛 `/一排格子里不能有空格子/`，`lenient` 照旧画（**盯 1**）；`label c a "前大后小 {inv(a)} 对"` 抛 `/不认得 inv 这个量/`；`{moves(a)}` 照旧报 | 当场报 |
| D1-5 | `kit/src/stage/scene.js` `unlabel dial:名字` | 单元：`dial d = 5 at=a`、`label dl dial:d "{d} 条链"`、`unlabel dial:d` → `labels` 里 `dl` 也没了，现状里没有它 | 贴在被收掉的东西上的字一起收 |
| D3-7（第一、三句） | `kit/src/stage/value.js`（式子里读到 `~`）；`kit/src/stage/types/matrix.js` 353 行 | 单元 `tests/stage-value.test.js`：`{g.5 + g.5~2}` 的报错对得上 `/边上的权进不了式子.*结点的牌子可以/`；`tests/stage-matrix.test.js`：`matrix S = {6 + bd + de}` 的报错对得上 `/要一个跟着算的数.*label/` | 报清楚 |
| E1-4 | `key=` 的检查（`kit/src/stage/types/sentence.js` 或 `sentence.rules.js`，找「里面没有词」的来源：可能在 `kit/src/entext.js`） | 单元 `tests/stage-sentence.test.js`：句子是中文、`key="[S GDP及其有效性的问题] [V 一直困扰着]"` 抛 `/key 只认英文的词/` | 句子里有不是英文的词又写了 `key=`，先报这一句 |

- [ ] 照「共用的做法」做（10 行、12 条）。
- [ ] 任务末尾的构建、全测、提交产物。

---

### 任务 8：一排格子、图、平面、同名重造、说明

| 条 | 在哪 | 测试 | 改成 |
|---|---|---|---|
| D1-1 | 一排格子学生拖的那一段（`kit/src/stage/types/array.js` 的手势 / `gestures.js` 的 `gestureAct`） | 单元 `tests/stage-scene.test.js` 或 `tests/stage-gestures.test.js`：`group a stride=5`、`split a` 以后，学生 `swap` 两张不在同一条泳道的 → 做不到（舞台不动，`why` 对得上 `/不在同一条泳道/`），挑战不打勾；同一条泳道里的照旧 | 照排序提交：分开排着时只在自己那条泳道里 |
| D1-8 | `kit/src/stage/types/array.js` `split`；现状那一行 | 单元：没 `group` 就 `split a` 抛 `/先 group/`，`lenient` 照旧演、现状写「整排下到了下面一排（没分过组）」（**盯 1**）；分过组、老师跨泳道 `swap` 以后，现状写每条泳道现在是哪几格，不再写「按隔 5 个分了 5 组」 | 照排序提交 rulings 第 71 行 |
| D1-12 | `kit/src/stage/types/array.js` `hop`（123 行）、`array.view.js` 画弧 | 单元：`hop a.10 -> a.1 label="让 9 格"`、`move a#10 -> a.1` 以后，弧的两头还是第 10 格、第 1 格的格位（弧记 `slot`，不记牌）；fix1 不用 | 弧钉在格位上 |
| D1-13 | `kit/src/stage/types/graph.js` `walk`（599 行 `adjacent`） | 单元 `tests/stage-graph.test.js`：有向图 `6>7` 上 `walk L.7 L.6` 抛 `/7 到 6 没有这个方向的边/`；`walk L.6 L.7` 照旧；无向图两个方向都行；`lenient` 照旧演（**盯 1**） | 有向图照箭头 |
| D4-10 | `kit/src/stage/scene.js` 同名重造一样东西的地方 | 单元 `tests/stage-scene.test.js`：`array a = …`、`label s a.1 "站定"`、`keep a "站定时"`、`open a`、再 `array a = …` → `labels` 里没有 `s`，存档点没有「站定时」，`a` 没开着；现状里有一行 `/重造了 a：原来贴的字、存档点、交给学生的动作都收了/`（只在真收了东西时写） | 照说明收干净、说出来 |
| L3-5 | `kit/src/stage/types/plane.js` `span`（399–410 行） | 单元 `tests/stage-plane.test.js`：`span p v stay` 两次（v 中间变过）→ `o.spans` 里两条钉着的；不带 `stay` 的 `span p v` 照旧只有一条跟着的；`unspan p` 全收；`clone()` 以后两条都在（**盯 3**） | `stay` 的往上加（最多 6 条，再多当场报），说明那一行改成「写 stay 就钉住这时的样子，能钉几条」 |
| D1-14 | `kit/src/stage/types/matrix.js` 的 `doc`、`compare` 的说明（`kit/src/stage/doc.js` / `types/array.js` 的 `doc`） | `tests/stage-doc.test.js` 已守长度；加一条：`stageDoc('线性代数')` 对得上 `/最多 6 行 8 列/`，`compare` 那一行写了「正好两个」 | 补两处；超长就压别的行，压了哪句记进 rulings |

- [ ] 照「共用的做法」做（7 条）。
- [ ] 任务末尾的构建、全测、`npm run e2e -- --only stage,stagestuck`、提交产物。

---

### 任务 9：排版检查说真话

**文件：**
- 改：`tools/stage-measure.mjs`（`measure`）、`tools/stage-audit.mjs`、`kit/src/stage/stage.js`（贴字那一段 1293 行：记下实际在哪边；「画面上看不全」那一行）、`kit/src/stage/scene.js`（`stateText`）
- 测：`tests/stage.test.js`（纯函数的部分）、fix1

**接口：**
- `placeLabel(…)` 已经返回 `{ x, y, side }`。贴字的记录多一个 `placed`（实际在哪边）；老师写了 `side=` 而 `placed` 不一样时，现状那一行写「贴在 b（写的是上面，放不下，在下面）」。
- `measure()` 的 `issues` 多四种 `what`：`'字比格子宽'`（`a` 是部件）、`'边上的数叠在一起'`（`a`、`b` 是两条边）、`'贴的字没在写的那一边'`（`a` 是贴字的 id）、`'缩得太小'`（整台的缩放小于 `MIN_SCALE = 0.6`；常量放 `kit/src/stage/layout.js` 导出，页面和工具同一个）。
- 舞台现状「画面上看不全：…」那一行跟着多「字难认：整台缩到了 N 成」。

| 条 | 测试 |
|---|---|
| L3-7、D4-9 | fix1 `L3-7.txt`（`array s = 看特征值是不是都是单根 重根数n−r够不够 看是不是实对称`）、`D4-9.txt`（`tree t = 49 [27·38·13] [76·97·65·49′]`）：`FIX1` 的 `audit` `/字比格子宽/` |
| D3-5 | fix1 `D3-5.txt`（`try3/D3/幕10.txt` 第 22 行那张图）：`audit` `/边上的数叠在一起/` |
| D1-7、D3-4、E1-5 | fix1 `side-1.txt`（三处各剪一行）：任务 9 做完时 `audit` `/贴的字没在写的那一边/`（任务 10 修好以后这一行改成 `noAudit`） |
| E1-8 | fix1 `E1-8.txt`（`try3/E1/幕1.txt` 第 42 行 rewrite 成 8 个词）：`audit` `/缩得太小/` |

- [ ] **步骤 1**：四个 fix1 文件和 `FIX1` 的四行；跑，看它红（排版那一栏是「没压着、没出屏幕」）。
- [ ] **步骤 2**：`measure()` 加四种；贴字记 `placed`；现状多那两句。单元测试：`placed` 和 `side=` 不一样时 `stateText()` 的那一句；`MIN_SCALE` 的判断是纯函数 `tooSmall(scale)`。
- [ ] **步骤 3**：跑，看它绿。`npm run check:stage`：现有的样子页、例子里新报出来的每一处，要么是真毛病（记进任务 10 的单子），要么是量错了（改量法）；不许为了让检查过把阈值放松到 fix1 的四条报不出来。
- [ ] **步骤 4**：构建、全测、提交。

---

### 任务 10：排版的根子

**文件：** `kit/src/stage/layout.js`、`kit/src/stage/stage.js`（摆东西、贴字、整台缩放的那几段）、`kit/src/stage/types/array.view.js`、`types/plane.view.js`；测：fix1、`npm run check:stage`

**必修四处**（每处：先用任务 9 的检查重现，再找根子，记进 rulings）：

| 条 | fix1 | 过的标准 |
|---|---|---|
| D1-7、D3-4、E1-5 贴字不照 `side=` | `side-1.txt` 改成 `noAudit` `/贴的字没在写的那一边/`；再加 `side-2.txt`：那一边真放不下的一例，`checks` `/写的是.*放不下，在/` | 写了 `side=` 的先只试那一边（躲开别的东西可以沿边挪），真放不下才换边、并说出来 |
| L3-1 第二块平面加箭头就缩 | `L3-1.txt`（`try3/L3/幕7e.txt`）：`noAudit` `/出了屏幕|缩得太小/` | 两块平面各带三根箭头，竖屏、横屏都排得下 |
| E1-2 先造句子再造平面 | `E1-2.txt`（`try3/E1/幕4b.txt` 第 31–36 行）：`noAudit` `/出了屏幕|画到了自己的地方外面|压着/` | 和先造平面的画面一样 |
| D1-10 `split` 以后整台缩小 | `D1-10.txt`（`try3/D1/幕3.txt` 到第 13 行）：`noAudit` `/出了屏幕|压着|缩得太小/` | 照排序提交 rulings 第 73 行：虚框和序号每次对齐都照现在的位置摆 |

**先查根子的六处**（D1-11、D4-8、L3-6、E1-1、E1-7、D3-6）：每处各建 fix1 文件重现。上面四处修完以后再跑：
- 已经好了的：`FIX1` 加 `noAudit` 守住。
- 根子在这四处附近、半天之内改得动的：修，加 `noAudit`。
- 要动排版算法的：不修。`docs/stage-mainline.md` 的「留到 ④」里记一行：现象、根子在哪、排版检查现在报不报得出（报不出的写明）。

- [ ] **步骤 1**：四处必修，一处一个提交（先红后绿）。
- [ ] **步骤 2**：六处逐个定，结果记进 rulings。
- [ ] **步骤 3**：`npm run check:stage`、`npm run e2e -- --only stage,stagestuck`；构建、提交产物。

---

### 任务 11：文档

**文件：**
- 建：`docs/stage-mainline.md`
- 改：`CLAUDE.md`、`docs/stage-gaps.md`、`CLAUDE-PROJECT.md`（版本号）、`evals/stage-gaps/stage-doc.txt`（重新生成）

- [ ] **步骤 1：`docs/stage-mainline.md`**，这几节：
  1. 终点和那条线（抄设计第 0 节，不改写）。
  2. 四个子项目和现在到哪。
  3. 第一轮的数：`node tools/stage-cost.mjs evals/stage-gaps/try3` 的每块一行和排行榜前 15 条；真课基线（`$BASE/lessons-before.txt` 里的数：几节、每轮平均字节、搭占比、等几秒、没演上率、一次没碰的写法）；读了那几节课以后的几句话（哪里该让学生动手却讲掉了——只写指令和现象，不抄学生的话）。
  4. 50 条的结果：修了几条、留到 ④ 的几条（各一行）。
  5. ③ ④ 建议的顺序：照排行榜排，每项写它能省掉哪种搭、大概多少字节。
- [ ] **步骤 2：`CLAUDE.md`**「舞台的底座」那一条末尾「③ 三科铺开（下一步）」改成：「③ 主线（`docs/stage-mainline.md`：事实归页面、教学归老师；第一轮 2026-11-11：量搭的尺子 `npm run cost:stage`、读真课 `tools/stage-lesson.mjs`、50 条页面毛病、`fix1` 的表 `node tools/stage-must.mjs evals/stage-gaps/fix1 --table fix1`）」。命令那一节加两行工具的用法。
- [ ] **步骤 3：`docs/stage-gaps.md`**「三科铺开分四轮」标题下加一行：「2026-11-11：这个安排不作数了，主线见 `docs/stage-mainline.md`。」
- [ ] **步骤 4：说明**。这一轮动了 `doc.js` 和各种东西的 `doc`（`order=on`、`span … stay`、矩阵上限、`compare`）：`CLAUDE-PROJECT.md` 版本号改成当天的（同一天发过就加字母，看学习台现在的版本）；重新生成 `evals/stage-gaps/stage-doc.txt`（看 `evals/stage-gaps/README.md` 里怎么生成的）；`node --test tests/stage-doc.test.js` 绿。
- [ ] **步骤 5**：`npm run build && node proto/stage/build.mjs`，`git status` 只有预期的文件；提交。

---

### 任务 12：收尾、合并、发布

- [ ] **步骤 1：旧课重放**（别的都停下，4 核全给它）

```bash
cd /home/user/Claude && for p in $BASE/part-??; do (node tools/stage-try.mjs $(cat $p) --json > $p.now.json 2> $p.now.err &); done
```

跑完拼成 `$BASE/try-now.json`，`node tools/stage-try-diff.mjs $BASE/try-4cc083f.json $BASE/try-now.json > $BASE/diff.txt`。

过的标准：`try/`、`try2/` 的 154 个文件没有一处不同；`try3/` 的每一处不同在 rulings 的「旧课重放的有意不同」里有一行（文件、第几步、对的是哪一条毛病）。对不上的是回归：修，再跑那几个文件。

- [ ] **步骤 2：只读找 bug**。派一个助手（不许改文件），给它：设计、这一份计划、`git diff 4cc083f..HEAD -- kit/src tools`。要它盯「审查要盯的」五条，再加：不说假话、不静默失效、`clone()` 带没带新字段、刷新照 log 放回。每条发现要有文件行号和能重现的脚本。发现的逐条核：真的就修（先写测试），不是的写一句为什么。
- [ ] **步骤 3：全部检查**

```bash
npm run build && node proto/stage/build.mjs && git status --short && npm test 2>&1 | tail -3 && npm run check:stage && npm run check:pages && npm run e2e && node tools/stage-must.mjs evals/stage-gaps/fix1 --table fix1 && node tools/stage-must.mjs evals/stage-gaps/try3
```

要看到：`git status` 干净、`# fail 0`、每个脚本退出码 0。

- [ ] **步骤 4：合进 `main`**

```bash
git fetch origin main && git checkout main && git merge --ff-only claude/admiring-cannon-4j7szs && git push -u origin main && git checkout claude/admiring-cannon-4j7szs
```

`main` 这期间有新提交就先把它合进分支、重跑步骤 3。

- [ ] **步骤 5：发布**（照 `CLAUDE.md`「发布」）。学习台 `https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo`：先 `Artifact read`，再发 `kit/desk.html`，附 `la-kit.js`（`kit/dist/la-kit.js`）、`CLAUDE-PROJECT.md`（`kit/dist/docs/CLAUDE-PROJECT.md`）、`components/*.md`（`kit/dist/docs/components/`）；`pdf/*` 不用重传；`capabilities` 不传。舞台试课：`Artifact list` 找到它，`read` 以后照 `proto/stage/` 的发布办法发（`docs/stage-plan.md` 里写着）。发完打开学习台看版本号是当天的。
- [ ] **步骤 6：告诉用户**：修了什么（几句人话，不列编号）、尺子量出来的三个数（搭占几成、真课没演上率、每轮等几秒）、排行榜前五、③ ④ 建议先做什么；请用户上一节课以后说一声，再量。

---

## 自查记录

- 设计第 2.1、2.2 节 → 任务 1、2；第 3.1 节 16 条 → 任务 4（L3-3、D4-1、D3-8、D1-9）、5（E1-3、D1-15）、6（D4-4、D1-2、D4-11、E1-6）、7（D4-3、D4-2、D3-1）、8（D1-1、D1-8、D1-12）；第 3.2 节 12 条 → 任务 5（D3-3、D4-5）、7（D1-4、L3-8、L3-2、D3-2、D1-6、D1-5）、4（D4-7）、8（D4-10、L3-5、D1-13）；第 3.3 节 6 条 → 任务 6（D1-3、L3-4）、5（D4-6、D3-7 第二句）、7（D3-7 另两句、E1-4）、8（D1-14）；第 3.4 节 16 条 → 任务 9、10；第 1 节文档 → 任务 11；第 4 节验收 → 任务 0、12。
- 「审查要盯的」五条：盯 1 在任务 4（D4-7）、7（D1-6）、8（D1-8、D1-13）；盯 2 在任务 4（D3-8）；盯 3 在任务 6（D4-4）、8（L3-5）；盯 4 在任务 7（D1-4）；盯 5 在任务 4（D4-1）。
