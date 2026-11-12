# 考情第 0、1 批：开工前的事和数据层、入库通路（设计）

2026-11-12。总计划 `docs/exam-plan.md`；这一份只写第 0、1 批**定下来的东西**，没写的照总计划。做的时候自己定的事记进 `2026-11-12-exam-1-rulings.md`，执行计划 `docs/superpowers/plans/2026-11-12-exam-1.md`。

## 0. 第 0 批做完的

- `meta/errors`：只有 11-05 旧版本的一条 `ResizeObserver loop…`（浏览器的无害提示，不修）。`meta/health`：英语挂着 5 节没下课的课（只记）。
- 我答的：目标南京大学**智能科学与技术学院**（也可能是人工智能学院，没定的话按智科），考 **11408**（101 政治、201 英语一、301 数学一、408）；专业代码先空着。真题、解析的 PDF 和大纲**都还没给**：第 1 批全用假数据测，从 PDF 走到数据库那一步挪到第 2 批（PDF 一到就走）。三条默认（留最近三年的卷、政治只做档案和统计、真题级没过最多七成）照总计划。
- 教研室能不能上网：同一个环境里试过，`WebSearch` 能用，`WebFetch` 打不开南大研招网（环境的网络是 limited，没列这些官网）。所以第 6 批的考情动态两条路：在环境里加上研招网、学院官网这几个地址（要我批），或者我在「管理 → 考试」里贴链接和原文。到第 6 批再问。另外教研室 11-11 那一晚没跑成（`USAGE_LIMIT_REACHED`），和这一轮无关，记一笔。
- 结构表、考法词表：没有真卷可核，先写**草稿**（rulings 里），结构表每一门带 `checked: false`，切题时对不上照样报，第 2 批拿真卷核过改成 `true`。

## 1. 文件

新目录 `kit/src/exam/`，全是纯函数（除了 `examdesk.js`、`examview.js` 碰数据库和 DOM）：

| 文件 | 做什么 |
|---|---|
| `schema.js` | `EXAM_COLLECTIONS`（`syllabus` `papers` `questions` `passages` `exam_profiles` `exam_intel` `exam_inbox` `exam_inbox_log`）、`validateExam(coll, id, data)`、`examSpaceOf(doc)`、`canWriteExam(role, coll)`。**不 import `memory/schema.js`**（那边要 import 这边，免得绕圈） |
| `structure.js` | 卷面结构表 `STRUCTURE`、`structureOf(subject, year)`、`checkPaper(paper, questions)` |
| `taxonomy.js` | 题型 `TYPES`、每门课的考法 `HOW`、`checkTags(tags, { course, syllabusIds })` |
| `reserve.js` | `latestPaperYear(today)`、`reserveYears(target, today)`、`usable(q, years)`、`scrubChunks(chunks, years)`、`scrubBooks(books, years)` |
| `ingest.js` | 真题、解析、大纲的转写格式和切法：`splitPaper` `splitAnswers` `buildPaper` `parseSyllabus` |
| `inbox.js` | 收件箱的一条记录 → 要写的文档和回执：`planInbox(rec, { have })` |
| `examdesk.js` | 首页挂着的收件箱：订阅 `exam_inbox`，照 `planInbox` 写、写回执、删记录、出错重试、屏幕常亮 |
| `load.js` | 按门课读：`courseOfBlock(block)`、`loadExamCourse(db, course)` |
| `target.js` | 考试档案：`DEFAULT_TARGET`、`targetOf(mem)`、`examDateOf(target)`、`goalOf(target)`、`targetPatch(cur, form)` |
| `examview.js` | 「管理 → 考试」那一张卡（填、改档案，改留作模考的年份） |
| `tools/exam.mjs` | `split` / `syllabus` / `check` / `apply` 四个子命令 |

## 2. 数据

### 2.1 记忆库里加两类（`memory/schema.js` 的 `COLLECTIONS`）

- `exam`：`label: '考试档案'`、`kind: 'state'`、`writers: ['chat', 'me', 'page']`、编号只认 `target`、必填 `school`、`dates: ['date']`、`enums: { degree: ['学硕', '专硕', ''] }`、`tracked: ['school', 'dept', 'major', 'code', 'degree', 'date', 'goal', 'split', 'reserve']`。
- `exam_bar`：`label: '真题级'`、`kind: 'state'`、`writers: ['page']`、编号照课程地图的块（`curriculum` 的正则）、必填 `at`、`tracked: []`。第 1 批只建类，第 5 批才写。

`MEMORY_COLLECTIONS` 跟着多两类：首页订阅、自检、备份、`memory_read`、课堂的 `MEMORY_FOR_CLASS` 都自动带上。两类都只有一两条 / 每块一条，不撑 ledger。

### 2.2 考试的资料（`EXAM_COLLECTIONS`）

每一类 `{ label, writers, id: { re, eg }, required, enums }`，角色只有 `page`、`chat`（收件箱 `exam_inbox` 另加开发那边写入用的 `chat`；`exam_inbox_log` 只 `page`）。编号：

| 集合 | 正则 | 必填 |
|---|---|---|
| `syllabus` | `^G-(LA\|HM\|PS\|DS\|CO\|OS\|CN\|EN\|PO)-\d+(\.\d+){0,3}$` | `course` `space` `title` `year` |
| `papers` | `^X-(101\|201\|301\|408)-\d{4}$` | `subject` `year` `space` `total` `count` |
| `questions` | `^Q-(101\|201\|301\|408)-\d{4}-\d{1,2}$` | `paper` `n` `type` `points` `stem` `space` `course` |
| `passages` | `^PA-(101\|201\|301\|408)-\d{4}-[A-Za-z0-9]+$` | `paper` `text` `space` `course` |
| `exam_profiles` | 和 `syllabus` 同号 | `course` `space` |
| `exam_intel` | `^ix-[A-Za-z0-9_-]+$` | `kind` `text` `at` |

取值：`space` ∈ `math cs en pol`；`syllabus.level` ∈ `了解 理解 掌握 会用 ''`；`questions.type` ∈ `taxonomy.js` 的 `TYPES` 的键；`questions.verified.how` ∈ `engine exact double book none`；`exam_intel.kind` ∈ `brochure catalog line syllabus ratio other`。

**门课**（`course`）：`LA HM PS DS CO OS CN EN PO`；科目代码（`subject`）`101 201 301 408`。`examSpaceOf(doc)`：先看 `space` 字段，没有按 `course`（`LA HM PS` → math，`DS CO OS CN` → cs，`EN` → en，`PO` → pol），再没有按编号里的科目代码（`301` → math，`408` → cs，`201` → en，`101` → pol）。

408 一卷四门课：卷子 `subject: '408'`，每道题的 `course` 是它主考点的门课；切题时还没打标签，先照结构表里那一年的「题号 → 门课」草稿填（`structure.js` 的 `courseHint`），`check` 时主考点的门课和 `course` 对不上就报。

`writer.js` 的 `validateWrite`：两段的路径先看记忆库，不在记忆库再看 `EXAM_COLLECTIONS`（`validateExam`），同样只记不拦。`memory/schema.js` 的 `canWrite`：不在 `COLLECTIONS` 但在 `EXAM_COLLECTIONS` 的，照 `canWriteExam` 判；两边都不在的照旧放行。

### 2.3 考试档案 `exam/target`

```js
{ school: '南京大学', code: '10284', dept: '智能科学与技术学院', alt: ['人工智能学院'], major: '', majorCode: '', degree: '',
  subjects: ['101', '201', '301', '408'], full: { 101: 100, 201: 100, 301: 150, 408: 150 },
  goal: 410, split: { math: 130, cs: 135, en: 75, pol: 70 }, date: '2027-12-21',
  reserve: null,            // null：照默认滚动（最近三年）；写了数组就用数组
  lines: [],                // 历年复试线等：{ year, kind, value, src: { url | book, at, checks } }，第 6 批才写
  by: 'page', at, log: [] }
```

`DEFAULT_TARGET` 就是上面这份（`at` 不算）。首页订阅到 `exam` 是空的、读到了（不是失败），页面以 `page` 写一份默认档案（只写一次：有了就不动）。我在「管理 → 考试」改的以 `me` 写，按 `applyChange` 记 log（`by: me`）。

`goalOf(target)` → `{ goal, split }`：`split` 四项加起来不等于 `goal` 时照旧用（页面上提醒一句「四科加起来是 N，不是目标的 M」），不替我改。`examDateOf(target)`：不是合法日期就回退 `'2027-12-21'`。

`score.js`：`scoreBoard(mem, { today, days })` 的目标和四科的 `target` 从 `goalOf(targetOf(mem))` 读；返回里 `goal` 照旧有；`GOAL`、`SUBJECTS` 留着当没有档案时的默认（测试和别处还在用）。`scoreLine(b)` 用 `b.goal`。`journey.js` 的 `daysLeft` / `countdownText` 签名不变（第二个参数本来就是考试日期），`desk.js` 调用时传 `examDateOf(targetOf(data))`；首页签条的 aria 写档案里的学校。

### 2.4 留作模考

- `latestPaperYear(today)`：最近一次考过的那张卷的年份（卷按招生年份叫：2025 年 12 月考的叫 2026 卷）。12 月 26 日以后算今年 12 月那次考过了：`month === 12 && day >= 26 ? year + 1 : year`。
- `reserveYears(target, today)`：档案里 `reserve` 是数组就用它；否则 `[latest - 2, latest - 1, latest]`。
- `usable(q, years)`：题的 `year`（没有就从编号取）在 `years` 里，或者它的卷 `reserve: true`（`q.reserve` 由 `load.js` 并进来）就是不能用。
- `scrubChunks(chunks, years)`：条目的标题或正文里有留着那几年的统考标记就整条剔掉。认的写法（年份前后可以有空格、全角括号）：`【2025 统考真题】`、`【2025 年统考真题】`、`(2025 统考)`、`2025 年全国硕士研究生招生考试`、`2025 年考研真题`、`2025 年 408 真题`、`2025 年数学一真题`、`2025 年英语一真题`、`2025 年数一`。只有年份、没有「统考 / 考研 / 真题 / 全国硕士」字样的不算（教材里年份很多）。
- `scrubBooks({ books, chunks, ... }, years)`：返回同样的对象，`chunks` 换成剔过的，多一个 `scrubbed: 剔掉几条`。

接在 `desk.js` 的 `enterClass`（`books.ready` 那一条，`normalizeBooks` 之后、写进 `books` 之前）和 `planview.js`（备课读书那一处）。年份从 `exam/target` 读（课堂里 `mem.exam` 不一定已经订阅到，直接 `db.doc('exam/target').get()`，3 秒读不到用默认）。这样 `textbookForClass`、`textbook_search`、`textbook_read`、`bookCatalog`、备课全都拿不到留着的那几年——不用在四处各接一次。

### 2.5 转写格式（真题、解析、大纲）

转写的人（Claude Code 的转写助手）照这个写；`ingest.js` 照这个读。和教材的 `=== 第 N 页` 同一个风格，不加进教材的 `KINDS`。

**真题卷**（一卷一个文件）：

```
=== 第 3 页
--- 题 23 | 单选 | 2
已知……（题面，公式写 LaTeX）
A. ……
B. ……
C. ……
D. ……
--- 题 41 | 综合 | 10
（题面，可以跨页：下一页开头不写新的「--- 题」就接在上一题后面）
--- 篇 T1 | 阅读
（英语的一篇文章原文；后面的题写「--- 题 21 | 阅读 | 2 | 篇 T1」）
```

**解析册**（一卷一个文件）：

```
--- 答 23
答案：C
（解析原文）
--- 答 41
（综合题没有字母答案：「答案：」那一行可以没有，整段都是解析）
```

**大纲**（一门课一个文件，`--course DS --year 2026`）：

```
# 一、线性表
## （一）线性表的基本概念
## （二）线性表的实现
### 1. 顺序存储
- 掌握：……（大纲原文的一句；开头是「了解 / 理解 / 掌握 / 会用」之一时记进 level）
```

`#` 一层是 `G-DS-1`，`##` 是 `G-DS-1.1`，`###` 是 `G-DS-1.1.1`；`-` 开头的行是上一节点的大纲原文（`text`），第一句的要求词记成 `level`。

`splitPaper(text)` → `{ questions: [{ n, type, points, stem, options, pages, passage }], passages: [{ key, kind, text, pages }], problems: [] }`；`type` 写中文（单选、多选、填空、解答、综合、完形、阅读、新题型、翻译、作文、分析），`TYPES` 里有中文到键的对照。`splitAnswers(text)` → `Map<n, { answer, analysis }>`。`buildPaper({ subject, year, questions, passages, answers, source })` → `{ paper, questions, passages, problems }`：编号、`space`、`course`（408 用 `courseHint`）、`year`、`answer`、`analysis`、`verified: { how: 'book' }`（只照书；引擎验算第 2 批加），再跑 `checkPaper`。有 `problems` 的卷 `tools/exam.mjs check` 不放行。

### 2.6 收件箱 `exam_inbox`

一条记录一种东西：

```js
{ kind: 'paper', paper: {…}, questions: [{…}], passages: [{…}], by: 'dev', at }
{ kind: 'syllabus', course: 'DS', year: 2026, nodes: [{…}], by: 'dev', at }
{ kind: 'tags', tags: { 'Q-408-2019-23': { syl: [...], how: '...', ... } }, by: 'dev', at }
```

`planInbox(rec, { have })`（`have`：`'集合/编号' → 现在那条`）→ `{ writes: [{ path, data }], log: { kind, at, ok, counts, problems, rejected } }`：

- 每一条先 `validateExam`；`paper` 再跑 `checkPaper`。**整条记录要么全收、要么全不收**（一卷里有一题不对，整卷不收，回执写哪一题哪里不对）。
- 已经有的题再来一遍：题面、答案这些照新的盖；`tags` 和原来不一样时往这一条的 `tagLog` 里加一条 `{ at, by, from, to }`（不走 ledger）。
- 已经有的卷 `reserve` 不被收件箱盖掉（那是我在页面上定的）。
- `tags` 那种记录：题不在库里的列进 `rejected`，其余照上面合进去。

`examdesk.js` 的 `createExamInbox({ db })`：照 `bookview.js` 的 `takeInbox` 的做法（订阅、正在做时来了新快照接着做、出错 10 秒后重读、屏幕常亮），一条一条：读要碰的那几条现在的样子 → `planInbox` → 写（一次最多 20 条同时写，`retry` 五次）→ 回执 `exam_inbox_log/{同号}`（带 `at`，留最近 40 份，多了删最旧的）→ 删这条记录。挂在首页（`renderDesk`），课堂里不挂。

### 2.7 按门课读（`load.js`）

- `courseOfBlock(block)`：课程地图块的编号 → 门课（`DS-L2.1` → `DS`，不带前缀 → `LA`；`HM-` `PS-` 认得，第 2 批 `space.js` 加门课以后两边一致）。
- `loadExamCourse(db, course)` → `{ course, syllabus, profiles, questions, passages, papers }`：`syllabus` / `exam_profiles` / `questions` / `passages` 各 `where('course', '==', course)` 读一次，`papers` 按科目代码 `where('subject', '==', 门课所在的科目)` 读一次；题带上卷的 `reserve`。任何一处失败那一类就是空的、`failed` 里记上。
- 接在 `enterClass`：开舞台课时**不等它**（课堂这一批还不用），`desk.exam = loadExamCourse(...)` 的 Promise 交给 `renderStageClass`（第 4 批才用）。首页不读这几类（只订阅 `exam_inbox`）。

### 2.8 「管理 → 考试」

管理页最上面「样子」后面加一张卡 `dk-exam`：学校、院系（下面一行小字写「也在考虑：人工智能学院」）、专业、专业代码、学硕 / 专硕、考试日期、目标总分、四科各多少、留作模考（「最近三年（现在是 2024、2025、2026）」或自己写几个年份）。点「存」才写；没改的不写。存的时候 `assertWrite('me', 'exam')`，`applyChange(cur, patch, { by: 'me', note: '管理 → 考试' })`。下面一行小字：库里有几套卷、几道题、几个考点（读 `meta/exam` 的计数：收件箱每并一条，`examdesk.js` 照回执加减写一份；首页不为了计数去读整类）。

### 2.9 备份

`backupFile` 多一个参数 `exam: { syllabus: [...], papers: [...], ... }`，照集合名原样加进 `docs`（`exam_inbox` 和 `_log` 不带）。首页「导出备份」时现读这几类（`get()`，一次）。恢复照旧按路径写回，不用改。

### 2.10 `tools/exam.mjs`

```
node tools/exam.mjs split --subject 408 --year 2019 --paper 真题.txt --answers 解析.txt --out 目录 [--source 私有仓库里的路径]
  → 目录/X-408-2019.json：{ paper, questions, passages, problems }；有 problems 打印出来、退出码 1
node tools/exam.mjs syllabus --course DS --year 2026 --text 大纲.txt --out 目录
  → 目录/syllabus-DS-2026.json：{ course, year, nodes, problems }
node tools/exam.mjs check 目录
  → 每个文件过 validateExam、checkPaper、标签（有 tags 时 checkTags）；打印每卷几题、几分、对不上的地方
node tools/exam.mjs apply 目录 --out inbox目录 [--by dev]
  → 每个文件一条收件箱记录 inbox目录/*.json，打印 ArtifactData batch 的 writes（一批 ≤ 50 条、≤ 900 KiB）
```

## 3. 不做的（这两批）

- 不读真 PDF、不转写、不打标签（第 2 批）。不算统计、不画考情页（第 3 批）。舞台课不接（第 4 批）。
- `exam_bar` 只建类。`space.js` 不加 `HM` / `PS`（第 2 批）；`load.js` 的 `courseOfBlock` 先自己认 `HM-` `PS-`。
- 不往发给课堂 Claude 的说明里加任何东西；不加调用。
