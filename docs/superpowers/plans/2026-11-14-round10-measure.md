# 第十轮「测量」第 1～3 批 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首页的「410 分的进度」从按掌握攒分的账，换成页面按证据测出来的预测分：如果今天考大约几分、80% 范围、离 410 差多少、过 410 的概率、几成是测出来的。

**Architecture:** 新目录 `kit/src/forecast/`，全是纯函数（不调用 Claude，不进课堂说明）：每块「会的程度 K」用网格后验，「记得住 R」用 FSRS-5；一张卷由真卷样本（`meta/exam.papers`）或卷面结构合成；固定种子抽卷得到分布。首页 `desk.js` 的 410 卡和面板改用它，`priority.js` 改用「还能多拿几分」。第 4 批（校准、摸底、模考、学习速度）另写计划。

**Tech Stack:** 原生 ES 模块、`node --test`、esbuild 构建（`npm run build`）、Playwright e2e（`npm run e2e`）。

**Spec:** `docs/superpowers/specs/2026-11-14-round10-measure-design.md`（执行的人两份都读）

## Global Constraints

- 测量不调用 Claude，不进发给课堂 Claude 的说明（`prompt.js` 一字不改）。
- 首页一次算完（今天考 + 考试那天 + 7 天前三次）在 iPad 上 ≤ 200 毫秒；node 里同样的数据 ≤ 120 毫秒（测试守着）。
- 同样的数据算出一模一样的数（固定种子：日期 + 数据指纹）。
- 留作模考的卷：只进卷面样本（块、分值、题型），题面、答案一律不进 `meta/exam.papers`。
- 注释、界面文字、提交说明用中文；注释写「为什么」。界面照紫藤 iOS 版式，颜色全走现有变量，触控 ≥ 44px。
- 话平实、不夸；估的数要标「估的」。
- 不用 `window.confirm / alert / prompt`。
- 合进 `main` 前：`npm test` 全过、`npm run build` 后提交 `kit/dist/`、`npm run e2e` 过。
- 提交说明末尾带：
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` 和 `Claude-Session: https://claude.ai/code/session_014f77bBwNSf5J8uTVjkpyq4`

## Review Focus

1. 记忆库几乎是空的（没有证据、课程地图只有线代几块、`meta/exam` 不存在）：预测照样出数（全是先验、范围宽），没有 NaN、没有空白卡。→ Task 7 `空记忆库也出数`。
2. 考试日期已经过了、或今天就是考试那天：「到考试那天」的天数按 0 算，不出负数天、R 不超过 1。→ Task 3 `负的天数当 0`、Task 7 `考试那天以后`。
3. 一次作答让总分跳太多：多做错一道题，总分中位数的变动不超过那一块在卷面上的期望分值。→ Task 7 `一道题动不了大局`。
4. 证据的标签指向课程地图里没有的块（旧数据、删了的块）：忽略，不崩、不算进任何科。→ Task 5 `没有的块不算`。
5. `meta/exam.papers` 里某一卷的题分加起来对不上满分（标签缺了）：缺的那部分照「还没进学习台」补齐，不缩放、不丢卷。→ Task 6 `真卷缺分补齐`。

---

## 文件

| 文件 | 管什么 |
|---|---|
| Create `kit/src/forecast/priors.js` | 全部先验和常数，每个带 `basis` 一句依据 |
| Create `kit/src/forecast/rng.js` | 固定种子的随机数 |
| Create `kit/src/forecast/fsrs.js` | FSRS-5 的遗忘曲线和稳定度更新 |
| Create `kit/src/forecast/knowledge.js` | K 的网格后验和抽样 |
| Create `kit/src/forecast/evidence.js` | 证据 → 每块的作答序列、复习序列 |
| Create `kit/src/forecast/paper.js` | 卷面：分值分到块、合成卷、真卷样本、抽卷 |
| Create `kit/src/forecast/forecast.js` | 抽卷算分布，出首页要的整张表 |
| Modify `kit/src/memory/report.js` | `itemOf` 带上 `exam` / `like` |
| Modify `kit/src/memory/mastery.js` | 导出 `cleanItem` / `failItem` |
| Modify `kit/src/exam/stats.js`、`kit/src/exam/examdesk.js` | `meta/exam.papers` 卷面样本 |
| Modify `kit/src/exam/priority.js` | 用「还能多拿几分」 |
| Modify `kit/src/memory/desk.js`、`kit/src/memory/desk.css` | 410 卡、面板、`meta/forecast` 快照 |
| Create `tools/forecast-sim.mjs`、`evals/forecast/results.md` | 模拟学生的尺子 |
| Create `docs/forecast-plan.md`、`docs/superpowers/specs/2026-11-14-round10-rulings.md` | 进度和自己定的事、资料来源 |
| Tests | `tests/forecast-*.test.js`；改 `tests/exam-priority.test.js`、`tools/desk-e2e.mjs` 的 `score` 段 |

---

### Task 1: 考试资料补齐（第 1 批，开发这边能做的）

**Files:**
- Create: `docs/superpowers/specs/2026-11-14-round10-rulings.md`
- Modify: `kit/src/exam/structure.js`（只在来源和草稿不一样时改）

- [ ] **Step 1:** 用 WebSearch（standard，几次一起发）查四门的卷面结构：408、数学一（2021 年以后）、英语一、政治，每门几题、每题几分、时长。每门至少两处独立来源（教育部考试中心、研招网、出版的大纲解析优先）。
- [ ] **Step 2:** 对照 `structure.js`，把每一段「来源 + 查的日期 + 和草稿一样 / 不一样」写进 rulings 的「卷面结构」一节；不一样的照来源改 `structure.js`，`checked` 仍是 `false`（真卷没核）。
- [ ] **Step 3:** 查南京大学智能科学与技术学院 11408 近 3～5 年的复试线（总分、单科线）、招生人数、推免人数、报录比；也查人工智能学院的作对照。写进 rulings 的「南大」一节，每条带链接和日期；查不到的照实写「没查到」。
- [ ] **Step 4:** 把核过两处来源的线写进学习台的考试档案 `exam/target` 的 `lines`（ArtifactData `update`，url 是学习台 https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo，collection `exam`、doc_id `target`）。每条 `{ year, kind: 'total' | 'single', subject?, value, src, at, checks }`，`single` 写 `subject: '101'|'201'|'301'|'408'`。写之前先 `get` 一遍，只合并 `lines`，别的字段不动。
- [ ] **Step 5:** `npm test`（`tests/exam-structure.test.js` 要过），提交。

```bash
git add docs/superpowers/specs/2026-11-14-round10-rulings.md kit/src/exam/structure.js
git commit -m "第十轮第 1 批：卷面结构核了公开来源，南大的线写进档案"
```

### Task 2: 先验和随机数

**Files:**
- Create: `kit/src/forecast/priors.js`、`kit/src/forecast/rng.js`
- Test: `tests/forecast-priors.test.js`

**Interfaces:**
- Produces:
  - `PART_PRIORS: { [part]: { mean, n, basis } }`，part 是 `score.js` `SUBJECTS[].parts[].key`（HM LA PS DS CO OS CN EN RD WR PO）
  - `TAUGHT_MIN = { mean: 0.2, basis }`：学习台讲过的块，先验均值至少这么多
  - `GUESS: { [type]: number }`，type 是 `taxonomy.js` 的 `TYPES` 的键
  - `PARTIAL: Set<type>`：按步给分的题型
  - `TAU: { math, cs, en, pol }`、`DELTA`（logit 单位）、`BLOCK_S_X`（块的稳定度倍数）、`DRAWS`、`RECENT_X`（最近五年的卷的抽中倍数）、`MEASURED_N`（一块算「测出来的」至少几道证据）
  - `rng(seed: number) => () => number`（[0,1)）、`seedOf(...parts: string[]) => number`

- [ ] **Step 1: 写测试**

```js
test('每一部分都有先验、都写了依据', () => {
  for (const s of SUBJECTS) for (const p of s.parts) {
    const pr = PART_PRIORS[p.key];
    assert.ok(pr && pr.mean > 0 && pr.mean < 1 && pr.n > 0 && pr.basis, p.key);
  }
});
test('猜对的底：单选 0.25、七选五 1/7、大题 0', () => {
  assert.equal(GUESS.single, 0.25); assert.equal(GUESS.reading, 0.25); assert.equal(GUESS.cloze, 0.25);
  assert.ok(Math.abs(GUESS.newtype - 1 / 7) < 1e-12); assert.ok(Math.abs(GUESS.multi - 1 / 11) < 1e-12);
  for (const t of ['fill', 'answer', 'comp', 'translate', 'essay', 'analysis']) assert.equal(GUESS[t], 0, t);
});
test('同一个种子同一串数，不同种子不同', () => {
  const a = rng(seedOf('2026-11-14', 'x')), b = rng(seedOf('2026-11-14', 'x')), c = rng(seedOf('2026-11-15', 'x'));
  const xs = [a(), a(), a()]; assert.deepEqual(xs, [b(), b(), b()]); assert.notEqual(xs[0], c());
  assert.ok(xs.every((x) => x >= 0 && x < 1));
});
```

- [ ] **Step 2:** `node --test tests/forecast-priors.test.js`，FAIL（模块不存在）。
- [ ] **Step 3:** 写 `priors.js`。值（每个 basis 写清楚来源；底子那几条写「2026-11-14 我说的：…」）：

| key | mean | n | basis 要点 |
|---|---|---|---|
| HM | 0.25 | 2 | 本科学过微积分，没按考研练过 |
| LA | 0.12 | 2 | 正在学，没讲的块按学过一点 |
| PS | 0.03 | 2 | 没学过 |
| DS | 0.25 | 2 | 学过数据结构和 C |
| CO / OS / CN | 0.03 | 2 | 没学过 |
| EN | 0.15 | 2 | 英语很差、四级没过 |
| RD | 0.15 | 2 | 同上 |
| WR | 0.3 | 2 | 作文按评分档，能写出句子就有基本档 |
| PO | 0.15 | 2 | 没学过；分析题照材料写也有分 |

`GUESS`：single 0.25、multi 1/11、fill 0、answer 0、comp 0、cloze 0.25、reading 0.25、newtype 1/7、translate 0、essay 0、analysis 0。`PARTIAL = new Set(['answer','comp','translate','essay','analysis'])`。`TAU = { math: 0.9, cs: 0.9, en: 0.9, pol: 0.9 }`。`DELTA = 1.2`（课堂题比真题容易：K=0.5 的人课堂题约 0.77 对；偏大 = 宁可算低）。`BLOCK_S_X = 3`（成块的技能比孤立事实保持得久，估的）。`DRAWS = 1500`。`RECENT_X = 2`。`MEASURED_N = 2`。
`rng`：mulberry32；`seedOf`：把各段拼起来做 FNV-1a 32 位。
- [ ] **Step 4:** 测试 PASS。
- [ ] **Step 5:** 提交 `第十轮：测量的先验和固定种子`。

### Task 3: FSRS-5

**Files:**
- Create: `kit/src/forecast/fsrs.js`
- Test: `tests/forecast-fsrs.test.js`

**Interfaces:**
- Produces:
  - `W`（19 个数，ts-fsrs 4.7.1 的 `default_w`）
  - `retrievability(days: number, S: number) => number`
  - `firstState(ok: boolean) => { S, D }`（第一次学：ok → Good(3)，否则 Again(1)）
  - `review(state: {S,D}, ok: boolean, days: number) => { S, D }`
  - `memoryOf(reviews: [{ day: 'YYYY-MM-DD', ok: boolean }], { x = BLOCK_S_X } = {}) => { S, D, last } | null`（按日期走一遍；`x` 只乘在算 R 时用的 S 上，不改递推）
  - `rOn(mem: {S, last} | null, day: string, { x }) => number`（`mem` 为 null 返回 1：从没在学习台学过，遗忘已含在底子先验里）

- [ ] **Step 1: 写测试**

```js
test('隔 S 天还记得九成；负的天数当 0', () => {
  assert.ok(Math.abs(retrievability(10, 10) - 0.9) < 1e-9);
  assert.equal(retrievability(-3, 5), 1);
  assert.ok(retrievability(30, 5) < retrievability(10, 5));
});
test('第一次学 Good 的稳定度是 W[2]=3.173', () => {
  assert.equal(W.length, 19); assert.equal(firstState(true).S, 3.173); assert.equal(firstState(false).S, 0.40255);
});
test('隔几天做对稳定度涨、做错掉，掉了不超过原来', () => {
  const s0 = firstState(true);
  assert.ok(review(s0, true, 4).S > s0.S); const f = review(s0, false, 4); assert.ok(f.S <= s0.S && f.S > 0);
  assert.ok(f.D > s0.D);
});
test('memoryOf 照日期走；没有复习返回 null；rOn 用倍数', () => {
  assert.equal(memoryOf([]), null);
  const m = memoryOf([{ day: '2026-11-01', ok: true }, { day: '2026-11-05', ok: true }]);
  assert.equal(m.last, '2026-11-05');
  assert.ok(rOn(m, '2026-12-05', { x: 3 }) > rOn(m, '2026-12-05', { x: 1 }));
  assert.equal(rOn(null, '2027-12-21'), 1);
});
```

- [ ] **Step 2:** FAIL。
- [ ] **Step 3:** 实现（FSRS-5，不开短期）：
  - `W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621]`
  - `R = (1 + (19/81) · t / S) ^ (−0.5)`，t < 0 当 0
  - `S0(G) = W[G−1]`；`D0(G) = W4 − e^{W5·(G−1)} + 1`，D 夹在 [1, 10]
  - 更新 D：`D'' = D − W6·(G−3)·(10−D)/9`；`D' = W7·D0(4) + (1−W7)·D''`
  - 做对（G=3）：`S' = S·(e^{W8}·(11−D)·S^{−W9}·(e^{W10·(1−R)} − 1) + 1)`
  - 做错（G=1）：`S' = min(S, W11·D^{−W12}·((S+1)^{W13} − 1)·e^{W14·(1−R)})`
  - 注释写明来源：ts-fsrs 4.7.1（FSRS-5）的公开算法和默认参数。
- [ ] **Step 4:** PASS。
- [ ] **Step 5:** 提交 `第十轮：FSRS-5 遗忘模型`。

### Task 4: K 的网格后验

**Files:**
- Create: `kit/src/forecast/knowledge.js`
- Test: `tests/forecast-knowledge.test.js`

**Interfaces:**
- Produces:
  - `GRID`：41 个点，`0.0125 + i·0.975/40`（不含 0 和 1）
  - `priorGrid(mean, n) => Float64Array`（Beta(mean·n, (1−mean)·n) 在 GRID 上的密度，归一）
  - `posterior(prior, obs: [{ ok, level: 'exam'|'class', r, g }], { delta = DELTA } = {}) => Float64Array`；一次的似然 `p = g + (1−g)·r·f(K)`，`f(K) = K`（exam）或 `σ(logit K + delta)`（class）；ok 乘 p，否则乘 1−p；每步归一
  - `meanOf(post) => number`
  - `sampleK(post, u: number) => number`（逆 CDF，u ∈ [0,1)）

- [ ] **Step 1: 写测试**

```js
test('先验的均值对得上', () => { assert.ok(Math.abs(meanOf(priorGrid(0.25, 2)) - 0.25) < 0.02); });
test('真题做对一道比课堂题做对一道往上推得多', () => {
  const p = priorGrid(0.2, 2);
  const e = meanOf(posterior(p, [{ ok: true, level: 'exam', r: 1, g: 0 }]));
  const c = meanOf(posterior(p, [{ ok: true, level: 'class', r: 1, g: 0 }]));
  assert.ok(e > c && c > meanOf(p));
});
test('隔久了做错（r 低）比刚学完做错往下拉得少：遗忘不扣两次', () => {
  const p = priorGrid(0.5, 2);
  const fresh = meanOf(posterior(p, [{ ok: false, level: 'exam', r: 1, g: 0 }]));
  const stale = meanOf(posterior(p, [{ ok: false, level: 'exam', r: 0.3, g: 0 }]));
  assert.ok(stale > fresh);
});
test('课堂题做得再多也换算回真题难度：20 道全对的均值低于 20 道真题全对', () => {
  const p = priorGrid(0.2, 2); const many = (level) => Array.from({ length: 20 }, () => ({ ok: true, level, r: 1, g: 0 }));
  assert.ok(meanOf(posterior(p, many('class'))) < meanOf(posterior(p, many('exam'))));
});
test('抽样在网格上、u 越大 K 越大', () => {
  const p = priorGrid(0.4, 4); assert.ok(sampleK(p, 0.1) < sampleK(p, 0.9)); assert.ok(GRID.includes(sampleK(p, 0.5)));
});
```

- [ ] **Step 2:** FAIL。**Step 3:** 实现。**Step 4:** PASS。
- [ ] **Step 5:** 提交 `第十轮：会的程度 K 的网格后验`。

### Task 5: 证据 → 每块的序列

**Files:**
- Modify: `kit/src/memory/report.js`（`itemOf` 的返回里加 `exam: head?.exam ?? null, like: head?.like ?? null`，找第一条带它的 record）
- Modify: `kit/src/memory/mastery.js`（`export const cleanItem = CLEAN; export const failItem = FAIL;`）
- Create: `kit/src/forecast/evidence.js`
- Test: `tests/forecast-evidence.test.js`

**Interfaces:**
- Consumes: `itemsOf(evs, new Map(), { bySession: true })`、`retagEvidence`、`markFresh`、`isOriginal`、`cleanItem`、`failItem`
- Produces: `blockEvidence(mem, { asOf = null } = {}) => Map<block, { obs: [{ day, ok, level, g }], reviews: [{ day, ok }], taught: boolean }>`
  - 只看课程地图里有的块（`level === 'block'` 或三段编号）；标签 `块#点` 归到块
  - 一道题（`same(key)`，去掉 `session§`）只取第一次碰到的那一次；原题再做（`isOriginal`）跳过
  - `cleanItem` → ok:true、`failItem` → ok:false，别的跳过
  - `level`：`it.exam` 有、或 `it.like` 有且 `comp` 以 `d-lab-` 开头、或 `comp` 以 `d-q-` 开头 → `'exam'`；否则 `'class'`
  - `reviews`：按课分组，这一块每节课第一道判得出的题（ok 照上）一条；同一天的两节课只留第一节
  - `g`：判得出猜没猜的单选（`it.kind === 'quiz'`）0.25，别的 0（似然里的猜对底，spec 6.2）
  - `taught`：有这一块的课（`sessions[].block` 是它）或有任何一条 obs
  - `asOf`（毫秒）：只看 `at` ≤ asOf 的证据

- [ ] **Step 1: 写测试**（用 `tests/memory-mastery.test.js` 里造证据的写法）：
  - `每道题只算第一次`：同一 comp 在两节课做，第二次不进 obs
  - `真题级认得出`：`exam: 'Q-408-2015-01'` 的 record → level exam；`like` + `comp: 'd-lab-x'` → exam；普通 → class
  - `复习一天一条`：三节课（11-01、11-01、11-05）→ reviews 两条
  - `没有的块不算`：标签 `L9.9.9` 不在课程地图 → Map 里没有它
  - `asOf 截断`：asOf 在第二节课以前 → 只有第一节的
- [ ] **Step 2:** FAIL。**Step 3:** 实现。**Step 4:** PASS；`npm test` 全过（report、mastery 的旧测试不能红）。
- [ ] **Step 5:** 提交 `第十轮：证据按块排成作答和复习的序列`。

### Task 6: 卷面

**Files:**
- Create: `kit/src/forecast/paper.js`
- Modify: `kit/src/memory/score.js`（导出 `chapterWeight`，别的不动）
- Modify: `kit/src/exam/stats.js`（新 `paperSkeletons(questions, syllabus, course)`，`statsCache` 返回里加 `papers`）、`kit/src/exam/examdesk.js`（`refreshStats` 把各门课的 `papers` 按科目代码合并进 `meta/exam.papers`）
- Test: `tests/forecast-paper.test.js`、`tests/exam-stats.test.js`（加一条）

**Interfaces:**
- Produces:
  - `SUBJECT_CODE = { math: '301', cs: '408', en: '201', pol: '101' }`
  - `units(curriculum, subjectKey) => [{ id, part, points }]`：这一科**卷面满分**（不按 410 缩放）分到块。部分的分照 `SUBJECTS.parts`；部分里按章平分（`chapterWeight` 同 `score.js`，挪成 `score.js` 导出），章里平分到块；没块的章是一个单位 `章编号:*`；学习台里没有的部分是一个单位 `部分键:*`（如 `HM:*`）。所有单位的 points 加起来 = 满分
  - `synthPaper(subjectKey, units, structure) => [{ unit: null, pool: units, type, points }]`：照 `structureOf(code, 2026)` 的每一题（points 为 null 的照那一段 `sum` 平分），`pool` 表示抽卷时按 points 比例抽一个单位
  - `realPapers(skeletons, units) => [{ year, items: [{ unit, type, points }] }]`：一卷的题 points 和不到满分时补一题 `{ unit: '部分键:*' 里分最大的那个, type: 'answer', points: 差额 }`；单位不在 `units` 里的题按它的部分归到 `部分键:*`
  - `pickPaper(rng, papers) => items`：最近五年的卷抽中倍数 `RECENT_X`；`papers` 为空返回 null
  - `paperSkeletons(...) => { [year]: [[block, points, type]] }`：主考点的块拿全分；有次考点挂别的块时主块 0.5、其余平分 0.5（照 `stats.js` 的一半规则）；没挂块的考点不出现（`realPapers` 会补）。不带题面、答案

- [ ] **Step 1: 写测试**
  - `单位加起来是满分`：四科各算一遍，`Σ points == full`（150/150/100/100）
  - `合成卷照结构`：408 合成卷 47 题、前 40 题 single 2 分、后 7 题加起来 70
  - `真卷缺分补齐`：一卷只有 100 分的题 → 补一题 50 分，归到最大的 `*` 单位
  - `近几年抽得多`：同一 rng 抽 2000 次，最近五年占比 > 均匀时的占比
  - `exam-stats`：两道题（一道主次考点挂两块）→ skeleton 的分值对得上、不带 `q` / `answer` 字段
- [ ] **Step 2:** FAIL。**Step 3:** 实现。**Step 4:** PASS。
- [ ] **Step 5:** 提交 `第十轮：卷面——分值分到块、合成卷、真卷样本`。

### Task 7: 抽卷算分布

**Files:**
- Create: `kit/src/forecast/forecast.js`
- Test: `tests/forecast-forecast.test.js`

**Interfaces:**
- Consumes: Task 2～6 的全部
- Produces:
  - `forecast(mem, { day, exam = null, asOf = null, examDay, draws = DRAWS, seed }) => { subjects: [{ key, label, full, target, median, lo, hi }], total: { median, lo, hi }, pGoal, pLines, measured, units: { [id]: { subject, part, title, points, p, k, n, r, measured } } }`
    - `day`：R 按这一天算（今天考 = 今天；到考试那天 = examDay）；`asOf`：证据截到哪一刻
    - 每块：`K` 后验 = `posterior(priorGrid(先验), obs 带 r = rOn(这一天以前的复习算的 memory, 作答那天)，g 用 obs 自己的)`；先验均值是 `PART_PRIORS[part].mean`，讲过的块取 `max(那个, TAUGHT_MIN.mean)`；`*` 单位只有先验
    - 每次抽：`pickPaper` 或合成卷 → 每个单位抽一次 K（同一次抽里同一单位共用）→ 每题 `P = g + (1−g)·K·R·τ`；不按步给分的题按 P 抽对错；`PARTIAL` 的题得分 `= points × Binomial(2·points, K·R·τ) / (2·points)`
    - 80% 范围 = 第 10、90 百分位；`pGoal` = 总分 ≥ 档案目标的比例；`pLines` = 档案 `lines` 有最近一年的总分线和单科线时，「总分 ≥ 410 且每科 ≥ 单科线」的比例，否则 null
    - `measured` = Σ(obs 数 ≥ `MEASURED_N` 的单位的 points) / 满分合计
    - `units[id].p` = 这一块一道 2 分单选的 P（给面板和 priority 用）
  - `forecastBoard(mem, { today, exam }) => { goal, now: forecast(今天), exam: forecast(考试那天), week: { delta, then }, measured, gain: [{ id, title, subject, gain }] }`
    - 三次用同一个种子 `seedOf(today, 指纹)`；指纹 = 证据条数 + 最后一条的 `at` + 课程地图条数
    - `week.then` = `forecast(mem, { day: 7 天前, asOf: 7 天前 23:59:59 })`；`delta = now.total.median − then.total.median`
    - `gain`：`points × (1 − p)`，每科排好

- [ ] **Step 1: 写测试**
  - `空记忆库也出数`：`forecast({}, {...})` 四科都有 median、lo ≤ median ≤ hi、不是 NaN，`measured === 0`
  - `同样的数据一样的数`：算两次 deepEqual
  - `真题做对的块涨分`：给 DS 的一块加 3 道 `exam` 级全对 → DS 中位数涨、`measured > 0`
  - `一道题动不了大局`：多一道错的 → 总分中位数变动 ≤ 那一块 `units[id].points`
  - `到考试那天不高于今天`：有复习记录的数据 → `exam.total.median ≤ now.total.median`
  - `考试那天以后`：`day` 在考试日期以后 → 不报错，R ≤ 1
  - `够快`：200 块、2000 条证据的造数据，`forecastBoard` 用时 < 120 毫秒（`performance.now()`）
- [ ] **Step 2:** FAIL。**Step 3:** 实现；太慢就减 `DRAWS`，不减到 800 以下（范围会抖），并在 rulings 记一笔。**Step 4:** PASS。
- [ ] **Step 5:** 提交 `第十轮：抽卷算分布、首页要的整张表`。

### Task 8: 模拟学生的尺子

**Files:**
- Create: `tools/forecast-sim.mjs`、`evals/forecast/results.md`
- Test: `tests/forecast-sim.test.js`（只跑小规模：50 个学生，确认脚本能跑、输出结构对）

**Interfaces:**
- Consumes: `forecast`
- Produces: `node tools/forecast-sim.mjs [--students 400] [--json]`，输出每种设定的覆盖率、中位数平均偏差（正 = 算高）、范围宽度

- [ ] **Step 1:** 写脚本。生成一边**不用测量的模型**：遗忘用指数衰减 `R = e^{−t/τ}`，τ 取三组（FSRS 默认 S×3 的等效值、慢一倍、快一半）；课堂题和真题难度差取 δ 的 0.5 倍和 2 倍；底子分好和零；每块有 5% 粗心率。每个学生按学习台的规则模拟 13 个月：每周学几块（讲 → 当堂几道课堂题 → 按 1/3/7/14/30 复现）；考试那天按同一张卷面真实抽一次分。在 4 个时点（第 0、3、8、13 个月）用测量算，比。
- [ ] **Step 2:** 跑 `node tools/forecast-sim.mjs --students 400`。合格线（spec 6.7）：
  - 数据够了（每科 ≥ 20 道真题级作答的时点）：80% 范围覆盖 75%～85%
  - 数据几乎为零（第 0 个月）：覆盖 ≥ 80%，中位数平均偏差 ≤ 0（不算高）
  - 数据越多范围越窄
  - 不合格：只调 `priors.js` 的数（每改一个在 rulings 记原因），不改算法结构；调不过就停下来报告。
- [ ] **Step 3:** 结果写进 `evals/forecast/results.md`（每种设定一行），`node --test tests/forecast-sim.test.js` PASS。
- [ ] **Step 4:** 提交 `第十轮：模拟学生的尺子`。

### Task 9: 接进首页

**Files:**
- Modify: `kit/src/memory/desk.js`（`paintScore`、`fillScore`、`openScore`、`nextPlan`；导入 `forecastBoard`）、`kit/src/memory/desk.css`（410 卡那几节）、`kit/src/exam/priority.js`
- Modify: `tools/desk-e2e.mjs`（`score` 段）、`tests/exam-priority.test.js`

**Interfaces:**
- Consumes: `forecastBoard(data, { today, exam: examMeta })`
- `priority({ blocks })` 的 `blocks` 改成 `{ [id]: { points, got, title, subject } }` 里 `got = points × p`（`forecastBoard` 的 `now.units` 转一下；`*` 单位不进），priority.js 本身的算法不动，只把注释改成「还能多拿几分」
- `exampage.js` 的 `getBoard` 继续用 `scoreBoard`（它只读结构），不改

- [ ] **Step 1:** 改 `paintScore`：卡上「如果今天考」、大数字中位数、`范围 lo–hi · 离 {goal} 差 {goal − median}`、这 7 天 `signed(week.delta)`（四舍五入到整数是 0 时不显示）、四科分段条（每段 flex 是 target，实的一截 median/target，淡的一截到 hi/target）、四科中位数、`约 x 成是测出来的`（`Math.round(measured*10)`；0 写「现在全是估的」）。
- [ ] **Step 2:** 改 `fillScore`：大数字和范围、过 {goal} 的概率（`pLines` 有时另一行「每科也过单科线的概率」）、两个时刻（今天考 / 不再学到考试那天，后一个写一句「只算遗忘，是下限」）、每科每部分每块（期望得分 / 值的分、K 的均值和「几道题算的」、到考试那天还记得几成、测的 / 估的；块按 gain 从大到小，部分里先列五块其余收起）、模考记录一行「还没做过模考」、「怎么算的」（平实地写 spec 第六节，先验那张表照 `PART_PRIORS` 的 basis 画）。去掉 `LADDER` 的表和「已经攒下」。
- [ ] **Step 3:** `meta/forecast`：`paintScore` 里，本周一（`addDays` 到周一）还没有快照就写一份 `{ weeks: [...旧的, { date, total, subjects: [{key, median, lo, hi}], measured }].slice(-80) }`；读不到 / 写失败不影响画卡（`reportError`）。备份（`backup.js`）把 `meta/forecast` 带上（看它是不是已经整份带 `meta/*`，是就不改）。
- [ ] **Step 4:** 改 e2e 的 `score` 段：不再用「掌握写成复现通过」，改成往替身数据库放 3 条某一块的 `exam=` 级全对证据，刷新后中位数涨；面板里有「怎么算的」和「测出来的」；关得上。`tests/exam-priority.test.js` 跟着改输入。
- [ ] **Step 5:** `npm test`、`npm run build`、`npm run e2e -- --only score`，都过。
- [ ] **Step 6:** Playwright 截竖屏 820×1180、横屏 1180×820 的首页和面板（deviceScaleFactor 1，自己看）：没溢出、字没叠、白天晚上两种（水墨、墨夜）都看一眼。
- [ ] **Step 7:** 提交 `第十轮：首页 410 卡换成测出来的预测分`。

### Task 10: 文档、版本、合并、发布

**Files:**
- Create: `docs/forecast-plan.md`（照 `docs/score-plan.md` 的写法：怎么算、画面、以后接着做第 4 批、验收）
- Modify: `docs/score-plan.md`（开头一句：第十轮起首页换成测量，见 forecast-plan）、`CLAUDE.md`（文档列表加第十轮一条，和第八、九轮同样的写法）、`CLAUDE-PROJECT.md`（版本号改成 `2026-11-14c` 或当天下一个字母）

- [ ] **Step 1:** 写文档。
- [ ] **Step 2:** `npm test`、`npm run build`、`npm run e2e`（全量）、`npm run check:pages`，都过；`git status` 干净（构建产物已提交）。
- [ ] **Step 3:** 提交，推到 `claude/brave-cannon-cca3qv`，合进 `main`（`git checkout main && git merge --no-ff claude/brave-cannon-cca3qv && git push origin main`）。
- [ ] **Step 4:** 重新发布学习台（CLAUDE.md「发布」一节：页面 `kit/desk.html`，`la-kit.js`、`CLAUDE-PROJECT.md`、`components/*.md` 照那一节的来源；pdf 不用重传）。
- [ ] **Step 5:** 打开学习台看一眼首页的 410 卡（真数据），把看到的数和「几成是测出来的」告诉我。
