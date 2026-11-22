# 真题入库手册（Claude Code 照这个做）

转写格式在文末；工具 `tools/exam.mjs`（文件开头有每个子命令的用法）。我说「入库 408 的 2015–2026」时照下面一步步做。**真题、解析的 PDF 不进这个公开的开发仓库，也不存成学习台的书**（存成书会被当成教材带进课堂）：我在学习台「管理 → 考试」里传（见第 0 节）。

## 0. 资料在哪

我没有私有仓库，资料传在学习台里：「管理 → 考试 → 放考试资料」传的 PDF 存在学习台的 assets，每份记一条 `exam_uploads/{up-…}`（`name`、`kind`：paper 真题卷 / answers 解析 / syllabus 大纲 / other、`asset`、我补的一句 `note`、猜的 `subject` `year`、`status: waiting`）。取法：`ArtifactData list exam_uploads`，每条用 Artifact 的 `read`（`path` 写 `asset` 那个 id）把 PDF 存到本地（`.superpowers/exam/`，不进 git），再照下面画页、转写。入完的那条改成 `status: done`（`ArtifactData update`，开发那边是 `chat`，能写）。以后我要是有了私有仓库，PDF 也可以放那里，步骤一样。

## 0.5 开工前

- 读学习台的 `meta/errors`、`meta/health`（照 CLAUDE.md）。
- `ArtifactData list` 存到本地（`.superpowers/exam/`，私人数据不进 git）：`curriculum`、`syllabus`、`exam/target`、`papers`（有的话）。
- 结构表（`kit/src/exam/structure.js`）那一科还是 `checked: false` 时：先拿一年的真卷核一遍题数、每题几分、合计，对了改成 `checked: true`，对不上照真卷改表，告诉我改了什么。

## 1. 大纲 → 考点树

1. 照教材那一套画页（`node tools/books.mjs render …`），转写助手看图写成「大纲.txt」（`#` 章、`##` 节、`###` 小节，`-` 开头是大纲原文）。
2. `node tools/exam.mjs syllabus --course DS --year 2026 --text 大纲.txt --out 目录`。一门课一个文件。
3. 课程地图缺章：`node tools/exam.mjs skeleton 目录 --course CO --curriculum 课程地图.json`，照打印的 writes 用 `ArtifactData batch` 写（课程地图只有开发那边能写）。
   **考点要落到块上**（统计、410 分的预测、老师每一轮的「这一块在考试里」都按块算；考点没挂块等于这门课在考试里是空的）：`node tools/exam.mjs blocks 考点目录 --curriculum 课程地图.json --out 目录 [--chapters 章对照.json] [--manual 手工挂.json] [--add 手工补的.json]`。课程地图里没有块的章照考点树排节和块（`from` 记着考点、`by: dev`），已经有块的章按标题挂，挂不上的打印出来——写进 `--manual` 再跑，直到 0 个。先照 `curriculum-batches.json` 一批批写课程地图，再把目录里带 `blocks`、`mapSig` 的考点记录写进 `exam_inbox`（指纹按写好以后的课程地图算，顺序反了页面会报映射过时）。

## 2. 真卷 → 一道一道

1. 画页、转写：每卷一个「真题.txt」（`=== 第 N 页`、`--- 题 N | 题型 | 分值`、英语 `--- 篇 T1 | 阅读`），解析册一个「解析.txt」（`--- 答 N`、`答案：`）。**能算的题在题面里写验算式**：`【check: faults(r, 3, lru) | r = 7 0 1 2 0 3 0 4】`（精确计算 + 引擎函数 `faults victims next nextval wpl`，`list(…)` 是序列）。
2. `node tools/exam.mjs split --subject 408 --year 2019 --paper 真题.txt --answers 解析.txt --out 目录 --source 私有仓库里的路径`。题数、分值和结构表对不上、验算对不上的会报出来、退出码 1：对照原页改转写，不改答案去凑。

## 3. 打标签（两个互不知道的助手）

1. `node tools/exam.mjs tagprep 目录 --syllabus 考点目录 --course DS --curriculum 课程地图.json --out 打标签目录`（408 四门课各跑一次）。
2. 每批 `bNNN.prompt.txt` 交给**两个**新开的助手（互相看不到），各写 `bNNN.a.txt`、`bNNN.b.txt`。
3. `node tools/exam.mjs tagmerge 打标签目录`：主考点一致率每批 ≥ 90% 才合格；不合格先改说明、改词表（`taxonomy.js`）再重打。冲突交第三个助手（`conflicts.prompt.txt` → `conflicts.out.txt`）。
4. `node tools/exam.mjs tagapply 打标签目录 目录`：标签写回，门课照主考点改。
5. 能用引擎重算的过程题，在标签里补 `engine`（组件本来收的那组字段，比如 `{ "name": "paging", "algo": "lru", "frames": 3, "refs": "…" }`）。
6. **抽查**：`node tools/exam.mjs sample 目录 --n 20`，把 20 行发给我。我说不对的改了以后，整批同类的再查一遍。

## 4. 做成练习、检查、写进去

1. `npm run build`，再 `node tools/exam.mjs drills 目录`：能做成练习的每道画一遍，有写法错误的不收。留作模考的卷一道都不做。
2. `node tools/exam.mjs check 目录`：全对才往下。
3. `node tools/exam.mjs apply 目录 --out 收件箱目录`：照 `batches.json` 一批批 `ArtifactData batch` 写进 `exam_inbox`。
4. 我打开学习台时页面并进去；回执在 `exam_inbox_log/{同号}`，`ok: false` 的照 `problems` 改了重来。

## 5. 入库质量

每批做完汇报给我：结构表核过几年、答案核对等级的分布（engine / exact / double / book / none 各几道，`check` 会打印）、双人打标签的一致率、我抽查的 20 道对了几道。

## 附：转写格式（真题、解析、大纲）


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
