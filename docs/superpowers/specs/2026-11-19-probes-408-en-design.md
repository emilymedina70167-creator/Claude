# 计划 3：408、英语的检验题型 —— 设计稿（等外部和学生审）

2026-11-19 写。计划 2（`dev_requests/dr-plan2`）的任务书写着「这次只做数学；408、英语的探题类型以后单独设计，外壳要能复用」「外壳、判、记录不绑数学：408、英语以后只加探题类型」。这一份是那个「以后单独设计」。**外部同意了才动手**；外部要改的直接写在学习台 `dev_requests/dr-probes-408-en` 的 `review` 字段。

## 一、不变的

计划 2 的外壳、走法、记录全部照用，不另起一套：`board check`、合书、信心三档、第一次作答算数、没有提示和看答案、想不出来；判出没过 → 列出没过的项 → 外部写的 `teach` → retry；蒙对也出 retry；拿不准一律待核（任何时候不因为读不出来算过）；证据 `src: check`、`absorb/{块}`、题库 `probes`、1 天 7 天复测、最后没过的和很确定却错了的记错题；retry 模板（`pick` / `where`，2026-11-19 做了）。

新题型只加三样：**写法**（`spec.js` 读字段）、**作答的画面**（`probes.js`）、**判**（`judge.js`：页面能判的当场判，要点交给页面里的 Opus 5.5 high）。`teach` 的键、`items` 的样子（`{ id, ok: true | false | 'missing' | null, why, tag? }`）、证据字段名和计划 2 一样。

## 二、现在就有、直接拿来用的

- **408 的引擎**（`kit/src/engines/`，四十几个）：每个都能照输入跑出每一步（`run`）、画成 `mode: fill` 的过程表（`table`），不少带「常见错法」`variants`（换成错法跑一遍，学生填的和它对上就写「像是：用了 FIFO」）。逐格判 `stepperspec.js` 的 `checkFill`、认错法 `misreadFill`。`practice use:` 已经把演示组件当练习题用（`usespec.js`），每种有现成的取数模板。
- **408 的算式**：`exact.js` 认 `0x1F`、`mod`、位运算、`bin` / `hex`；`algofuncs.js` 有 `faults()` `victims()` `next()` `nextval()` `wpl()`（直接调引擎算）。
- **C 代码**：`codejudge.js` 跑测试、估复杂度（`code` 组件在用）。
- **英语**：`entext.js` 的成分括号写法和判 `parseBrackets` / `judgeSpans`（角色 S V O … RC ObC AdvC NF…，能套从句）、改错 `findWrong` / `parseDecoys`、意群 `parseChunk` / `judgeChunks`、填空的常见错答诊断 `parseAnswer` / `diagnose`、翻译要点 `parsePoints` / `judgeTranslation`。课上的 `parse` `errfind` `chunk` `cloze` `translate` 组件用的就是这些。
- **通用的五种已经能直接出 408、英语的题**：`recall`（默写定义、条件）、`solve`（计算题的步骤）、`discriminate`（能不能用）、`locate`（错在哪一行，C 代码也行）、`claim`（真假 + 要点）。缺的是 408、英语里页面能精确判的那一大块。

## 三、新加的题型

| 题型 | 科 | 测哪一面 | 谁判 |
|---|---|---|---|
| `fill` 过程表 | 408 | 能用（过程重建） | 页面（引擎逐格） |
| `compute` 结果 + 错法诊断 | 408（数学也能用） | 能用 | 页面（精确） |
| `construct` / `claim` 的 408 格子 | 408 | 能用 / 边界 | 页面（引擎算条件） |
| `code` 写代码 | 408 数据结构 | 能用 | 页面跑测试；思路要点给页面里的 Claude |
| `parse` 长难句结构 | 英语 | 能辨 | 页面 |
| `errfind` 改错 | 英语 | 能辨 | 页面 |
| `chunk` 意群断句 | 英语 | 能用 | 页面 |
| `rewrite` 句型转换 | 英语 | 能用 | 页面先对答案，对不上给页面里的 Claude |
| `translate` 翻译 | 英语 | 能用 | 页面里的 Claude 逐个要点 |

### 3.1 `fill`：过程表（408）

```fill
id: q1
use: paging
refs: 7 0 1 2 0 3 0 4 2 3 0 3
frames: 3
algo: lru
rows: 8
target: OS-12
level: 方法
teach variant=fifo: 换出的是最久没用的，不是最早进来的。
teach row=4: 第 4 次访问 2 不在内存里：缺页，换出最久没用的那一页。
teach default: 每一次访问先看在不在内存里。
retry: q1, q1
```

- `use:` 写演示组件的名字（和 `practice use:` 同一张表），下面照那个组件的字段写输入；`given:` `rows:` `cols:` 照 `mode: fill`（前几行给出、只填前几行、只填几列）。可以写 `pick`（retry 模板，现成的取数模板照抄就能用）。
- 画面：组件的那张过程表，空着的格子我填（照 `mode: fill` 的输入：∞、`-`、「✓ / 缺页」点一下切换、「照抄」上一列）。交之前空格要填完。
- 判：整张表一次判（不是一行判一行，免得变成边做边看答案）；`items` 一行一项 `r1`…`rn`（错在哪一格写在 `why`），另加一项 `variant`：学生填的和某个常见错法对上了，`why` 是「像是：…」、`tag` 是错法的名字。补讲照 `variant=名字` → `row=第几行` → `default` 找。
- 不调 Claude。错法认出来是一项事实，外部在 ext_out 里看得到「像是用了 FIFO」。
- 先接：页面置换、进程调度、银行家、磁盘调度、Cache 映射、流水线、子网、TCP 窗口、排序某几趟、二叉树遍历、AVL / B 树插入、哈夫曼、KMP 的 next、散列、Dijkstra / Prim / Kruskal / 拓扑排序（有 fill 表的引擎都能接，先接这些是按 408 真题的分值；入库的真题统计在 `exam/stats.js`）。

### 3.2 `compute`：结果 + 错法诊断

```compute
id: q2
pick v = seq(12, 0, 5)
q: 引用串 $\calc{v}$，3 个物理块，LRU，缺页几次？
where same(victims(v, 3, lru), victims(v, 3, fifo)) == 0
answer: faults(v, 3, lru)
wrong w1: faults(v, 3, fifo) => 用成了 FIFO
wrong w2: faults(v, 3, lru) - 3 => 没算开头装进去的那 3 次
type: num
target: OS-12
level: 基础
teach w1: LRU 看的是最近一次用的时间。
teach default: 开头 3 页装进空块也算缺页。
retry: q2, q2
```

- `answer:` 是式子（精确算，能用 `pick` / `let` 的名字和 `faults()` 这些；算法名照 practice 写不带引号：`faults(v, 3, lru)`）；`type: num | seq | bin | hex | text`（判法照 `answer` 组件的 `type:`）。
- `wrong w1: 式子 => 说明`：错法也写成式子，每取一组数页面都算一遍；学生写的不对、又正好等于某个错法算出来的，那一项写「像是：用成了 FIFO」，补讲按 `w1` 找。错法算出来和答案一样的那一组数，这一条不用（取数时 `where` 可以避开）。
- 不是选择题：学生自己算、自己写。它只测「能不能算对」，所以建议配一道 `fill` 或 `solve` 测过程（外部定）。
- 数学也能用：`answer: det(A)`、`wrong w1: -det(A) => 交换两行忘了变号`。

### 3.3 `construct` / `claim` 的 408 格子

`slots:` 多四种：`seq(n)`（一串数，空格隔开）、`bits(n)`（0/1 串）、`int`、`str(n)`（字符串）。条件 `if:` 遇到这几种格子时用精确的算式（`exact.js`，认 `faults()` `nextval()`、位运算、`mod`），其余照旧。

```construct
id: q3
q: 给一个引用串（12 个页号，1～5），让 FIFO 4 个物理块比 3 个物理块缺页还多
slots: r=seq(12)
if: faults(r, 4, fifo) > faults(r, 3, fifo) => 4 块的没比 3 块的多：没出现 Belady 异常
example: r=1 2 3 4 1 2 5 1 2 3 4 5
target: OS-12
level: 核心
teach if1: 先找一串 3 块时一直缺页的。
retry: q3a, q3b
```

`claim` 判假时的反例一样（「FIFO 块数越多缺页越少」判假，给一个反例串）。

### 3.4 `code`：写代码（数据结构的算法题）

```code
id: q4
q: 写 `void reverse(LinkList L)`，原地逆置带头结点的单链表
signature: void reverse(LinkList L)
tests: …（照 code 组件的写法）
must m1: 头插法：从第一个结点起一个个摘下来插到头结点后面
must m2: 时间 O(n)、空间 O(1)
target: DS-31
level: 核心
retry: q4a, q4b
```

- 页面跑测试（`codejudge.js`），一个测试一项 `t1`…；复杂度估出来和要求不符一项 `big`。`must` 的思路要点给页面里的 Claude 判（和 recall 一样）；测试全过、要点没过 = 没过。
- 只能打字（代码手写转写容易错，判不准）。这一种工作量最大，放最后一批，外部觉得不值可以不做。

### 3.5 `parse`：长难句的结构（英语）

```parse
id: e1
q: 标出这句的主干，从句标出来是什么从句
answer: [SC What the students found most surprising] [V was] [PC that the professor, [RC who had never taught before,] explained it so clearly].
roles: S V O P SC PC RC ObC AdvC
target: EN-长难句-主语从句
level: 核心
teach role=SC: what 引导的从句整个当主语，后面的 was 才是主句的谓语。
teach default: 先找主句的谓语动词。
retry: e1a, e1b
```

- 写法和画面照课上的 `parse`（句子从 `answer:` 的括号里取）：选一段字、点一个角色；能一层一层套。
- 判：`judgeSpans` 逐个成分比（边界、角色），`items` 一个成分一项（`S`、`V`、`SC`…，同一种第二个是 `RC2`），漏标、标错、多标分开写。补讲照 `role=…` → 编号 → `default`。
- 不调 Claude。

### 3.6 `errfind`：改错（英语）

```errfind
id: e2
text: The number of students who has applied this year is larger than last year.
wrong: has
fix: have
decoys: is, larger
target: EN-主谓一致
level: 方法
teach decoy=is: 主句的主语是 the number，is 是对的；错的在从句里。
teach fix: who 指 students，从句的动词跟 students 走。
retry: e2a, e2b
```

- 写法照课上的 `errfind`（`text` `wrong` `fix` `decoys`）。我先点错的那个词，再写改成什么（`fix: 删掉` 是多了一个词）。判：点对了没有一项 `word`、改得对不对一项 `fix`；点了 `decoys` 里的词，`tag` 写是哪个（补讲 `decoy=词`）。不调 Claude。

### 3.7 `chunk`：意群断句（英语）

照课上的 `chunk` 写法（`|` 是必断、`¦` 是可断）：我在词之间点着断开。判：必断的每一处一项、断在不该断的地方一项（`judgeChunks`）。可以加 `translate: on` 按意群写译文，那一半照 3.9 交给页面里的 Claude。

### 3.8 `rewrite`：句型转换（英语）

```rewrite
id: e3
q: 用 whom 把两句并成一句：The man is my teacher. You met him yesterday.
answer: The man whom you met yesterday is my teacher.
answer: The man you met yesterday is my teacher.
wrong w1: The man whom you met him yesterday is my teacher. => 从句里多了 him
must m1: whom 在从句里当宾语，从句里不再有 him
target: EN-定语从句-宾格
level: 方法
retry: e3a, e3b
```

- 判：和 `answer` 里的某一句一样（`normText`：大小写、弯引号、缩写、句末标点都不算错）→ 过；和 `wrong` 的某一句一样 → 没过，那一条的话当原因、补讲按 `w1` 找；都对不上 → 交给页面里的 Claude 照 `must` 判（读不出来待核）。**只有「和写好的答案一样」页面才判过**，别的写法一律给 Claude 或待核，不按关键词放过。

### 3.9 `translate`：翻译（英语）

```translate
id: e4
sentence: It is not until you lose your health that you realize how important it is.
must m1: 「直到……才……」的强调句译出来
must m2: how important it is 译成「它有多重要」
wrong w1: 译成「直到你失去健康，你意识到……」（没有「才」）
target: EN-强调句
level: 核心
retry: e4a, e4b
```

- 我打字或手写中文。**要点全给页面里的 Claude 判**（和 recall 一样，转写和判同一次）；页面先用 `judgeTranslation` 的关键词比一遍，结果只写进给 Claude 的那一条当事实（「页面按关键词：m1 找到『才』」），不拿它直接判过——关键词对上不等于意思对，计划 2 定的「判宽是最坏的失败」。

## 四、外壳里要改的几处（不绑数学）

- `discriminate` 的 `result` 输入框现在写死认 `A B E n` 这几个名字：改成照题里的 `let` / `pick` / 这节课的量。
- `construct` 的条件：格子里有 408 那四种时走精确算式（3.3）。
- 第三节「检验题」现在整节标「科目：线代」：拆成通用的一小节（写法、走法）+ 每科的题型各一小节（`<!-- 科目：数据结构 操作系统 组成原理 计网 -->`、`<!-- 科目：英语 -->`），课堂里只带这一科的。数据结构的组件说明离 40 KiB 上限只剩 0.8 KiB：新写的都放在完整写法里，精简版只加一行。
- 预检（`ext-check --lint`）、复测、题库照新题型走一遍：`fenceOf` / `bankId` 不用改。
- `?dev` 的暗号「测试:检验408」「测试:检验英语」各一条样子，e2e 多两段。

## 五、要外部定的

1. `compute` 只测结果，算不算吸收的证据？我的看法：能，但一块里不能只有它（至少配一道 `fill` / `solve` / `construct`）；要不要页面在自检里拦「这一块的必做题全是 compute」？
2. `fill` 一次交整张表（不一行一判）：同意吗？一行一判更像考场上的草稿，但每判一行就露出那一行的对错，后面几行等于看着答案做。
3. `translate` 全交给页面里的 Claude（每道一次调用、等十来秒）：同意吗？还是关键词全对上就先算过、只把对不上的交给 Claude（快，但会判宽）？
4. `code` 做不做、放第几批。
5. 408 先接哪几个引擎（上面列的是按真题分值排的）。
6. 英语 `parse` 的角色就用课上那一套（`entext.js` 的 `ROLES`）？

## 六、分批和验收

- **第 1 批（外壳去数学化 + 408）**：第四节那几处；`fill`、`compute`、408 格子（`construct` / `claim`）；手册第三节拆科目；`测试:检验408`、e2e 一段。
- **第 2 批（英语）**：`parse`、`errfind`、`chunk`、`rewrite`、`translate`；`测试:检验英语`、e2e 一段。
- **第 3 批（可选）**：`code`。
- 验收和计划 2 一样：每种题型的判（含错法诊断、待核）配 `node --test`；e2e 从开检验到吸收、错题、复测走一遍；每批发布以后学生用外部上一次真的检验，读 `sessions/{编号}/check/*` 看判得准不准、待核多不多、补讲是谁写的。

## 七、不做

- 选择题、演示动画、防作弊（同计划 2）。
- 页面或页面里的 Claude 自己出题（缺新题照实报；retry 模板是外部写的题，页面只换数）。
- 政治、数学二三：考试资料没入库。
