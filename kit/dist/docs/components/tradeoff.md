### tradeoff、calc：408 的检验题（块里的 trace、predict、construct、code 也在这一节）

只在 `board check`（第五节）里能作答；字段、引擎交的量、计数口径在完整写法里。

外壳和数学的检验题（`recall` 那一节）一样：合书、第一次作答算数、没有提示和「看答案」，错了显示你写的 teach 再出一道 retry。

共用的字段：`id`、`q`、`target`（打的哪个典型错法）、`level`（`基础` / `方法` / `核心`）、`facet`（`重建` / `能用` / `边界` / `能辨`；408 的块（`DS-` `OS-` `CO-` `CN-`）里不写时：trace、predict、code、calc 能用，construct 边界，tradeoff 重建）、`teach 键: 话`、`retry`（同一种题型的同构小题；必做题至少 2 道，至少 1 条 teach）、`family`、`let`、模板的 `pick` / `where`。teach 先按这一项自己的查找顺序找（下面各题型写着），再按编号、`tag=`，最后 `default`；都没有时页面里的 Claude 写补讲。

各题型：

- **trace**（手推）：`use: 演示组件名`，下面原样写那个组件自己的字段（`algo: shell`、`array: …`、`gaps: …`，写法见那个组件）；我填的就是它 `mode: fill` 的那张表。可选 `rows: 2`（只填前 2 行）或 `rows: 2-3`（第 1 行给出、填第 2～3 行）、`given:` `cols:`（同 `mode: fill`）、`against: 错法短名`；快排（`use: sort`、`algo: quick`）能写 `by: round`：一趟（真题说的趟，一层划分做完）一行，行名「第 k 趟」，不写是一次划分一行。组件的字段名和检验的字段撞了（sched 的 `q`、tree / thread 的 `level`、net / kmp 的 `use`、csma / mem 的 `retry`、memexp / util 的 `target`）写 `use.名字:`（`use.q: 2`）。elim、det、eig、schmidt、quad 不收（那是结果表，不是过程）。
  - 判：整张表交一次一起判，一行一项（`r1`、`r2`…，表下面的格是 `x1`…）。第一处错的那一行没过，对上了引擎的错法 `tag` 是错法短名、话后面接错法的说法；`tagFit` 是 `exact`（那一行和照错法填的一模一样）或 `partial`（只是大半像，话里写「可能像是……」：我可能做的是另一件事）。几种错法填出来一样、对得一样好：都记进 `tags`（没有 `tag`），话是「这几种错法在这组数上答案一样：……」，补讲走那一行 → `default`。直接插入、希尔、冒泡、简单选择：错的那一行后面每一行，页面拿「对的这一趟作用在我写的上一行上」再核（证据里那几项带 `carried: true`，`ok` 是对我自己的上一行而言；这道题照样没过）；后面全对、没对上错法、错的那一行和对的最多差 2 格，那一项 `tag: slip`，话是「后面按你自己的上一行推都对，第 k 趟这一处写错了」。别的引擎错行后面的不列。
  - teach 键：对上错法的先找 `tag=错法短名`，笔误先找 `slip`，再找那一行（`r2`），最后 `default`。格子没填完交不了（该空着的格写 `-`）。
- **predict**（不推，直接写结果）：`run r: 引擎 字段=值 …`（一行一个，名字只用字母和数字；值有空格加引号：`refs="1 2 3"`）；`expect [x1] 标签: 式子`（一个要我写的结果一行，编号不写自动编 x1、x2…；式子能用 `r.faults`、`r.pass1`、`let` 和模板的量，`"2 5 8"` 是字）；`wrong [w1]: 式子 => 说明`（带 `=>` 的是错答案，挂在它上面最近的那个 `expect`）；不带 `=>` 的 `wrong` 是理由里的常见错说法；`against: 错法短名, …`；可选 `must` / `may`（理由要点，页面里的 Claude 判）、`answer:`。至少一个 expect；用到 `r.` 的量、写 `against:` 才要 run，只问字面答案的（`expect 时间复杂度: O(n log n)`、`wrong w1: O(n^2) => 那是最坏`）不写 run（这时不写 `against:`）。
  - 判：每个 expect 一项，页面比值（见「值怎么比」）。值不对时：等于某个错法算出来的（写了 `against:` 只看那几个，没写看这个引擎全部）→ `tag` 是错法短名，话是错法的说法；等于 `wrong … =>` 的式子 → 话是那条说明；对上了的带 `tagFit: exact`；都没对上 →「标签不对」。几种（错法、`wrong … =>`）在这组数上算出来一样、我写的正好是它：都记进 `tags`（没有 `tag`、`hit`），话是「这几种错法在这组数上答案一样：……」，补讲走 `x1` → `default`，不挑一种；固定的题执行前的检查报「x1 上 w1 和 opt 的答案一样」（换一组数，或 `against:` 只留一种），模板取到这种数重取。值都对了才把理由交页面里的 Claude。某组数上错法和对的算出来一样，那个错法这组数不比。
  - teach 键：`tag=错法短名` → `w1` → `x1` → `default`（几种撞在一起时 `x1` → `default`）。
- **construct**（408 的格子和量）：在数学的写法（`slots` `if` `expr` `example`，见 `recall` 那一节）上多三种格子：`seq(8)`（8 个数；不写个数最多 24 个）、`text`（一行字）、`procs(3)` / `procs(3, prio)`（3 个进程，一行一个「名字 到达时间 运行时间[ 优先级]」）；多 `run` 行（同 predict，值写格子名就换成我写的：`array=A`）；条件里用量：`r.unstable >= 1`、`P in r.flipped`（我写的这一对是 `r.flipped` 里的一对，先后不论）、`r.order == "P2 P1 P3"`。比大小 `>=` `<=` `>` `<`；比字 `==` `!=` `in`，不管空格、逗号、大小写的写法（撇号照「相同的数」：有一边没写撇号只比数）。一串（序列、字）只和格子、量、`"字"` 比，不和一个数比（`r.flipped != 0` 报写法错误，写 `r.unstable >= 1`）。不写 `against:`。teach 键 `if1`、`e1`、`run`（引擎不收我造的输入）、`default`。
- **tradeoff**（讲取舍）：写法、判法同 `recall`（`must` 每题最多 3 条、`may`、`wrong`、`answer`），页面里的 Claude 照要点判。
- **calc**（过程 + 最后的值）：写法同 `solve`（`q`、`steps:` 一行一步 `编号 setup|rule|calc|conclude: 内容`），多可选的 `run` 行和 `result: 式子`（最后的值，页面判，能用 `r.xxx`）。我写整道题的过程（打字或手写）和一行「最后的值」。步骤一律页面里的 Claude 逐步判，最后的值错了步骤照样判。teach 键 `result`、`s2`、`default`。照考试样子写的算法设计题（思想、代码、复杂度，手写）用 calc：`s1 setup: 思想…`、`s2 calc: 代码…`、`s3 conclude: 时间、空间复杂度`。
- **code**（补一两行、改错）：字段同第三节 `code`（`fn` `tests` `ref` `starter` `call` `scale` `check` `check_call`）；页面真跑测试，不调页面里的 Claude。iPad 上是软键盘，这一种用来补一两行、改一处：`starter:` 写好大半、留要补 / 要改的地方，框里还是 `starter` 原样时交不了。写了 `ref:` 页面先拿它跑一遍自己的测试；没写 `ref:` 每个测试都要写 `-> 期望`。一个测试一项（`t1`…：想要什么、得到什么，或运行出错、死循环和行号），编译不过一项 `compile`。`check:` 或 `ref` 在我的输出上自己出错 → 那一项待核。不写 `must` / `may` / `wrong`，不做模板。teach 键 `t2`、`compile`、`default`。

**引擎交的量**（`run` 的条件、`expect`、`result` 里写 `r.名字`；trace 的错法也照这张表的引擎）：

| 引擎 | 量 | 错法短名（`against:`） |
|---|---|---|
| `sort` | `passes` 几趟（快排是几次划分）、`pass1` `pass2`…（第 k 趟以后的序列；快排是第 k 次划分以后）、快排另有 `rounds` 几趟、`round1` `round2`…（真题说的「第 k 趟」：一层划分做完以后的序列）、`final`、`cmp` 比较次数、`move` 移动次数（快排、归并不交）、`swap` 交换次数（只有冒泡、简单选择）、`unstable`（排完换了先后的相同数有几对）、`flipped`（那几对，「49 49′」） | 直接插入 `insertCount`；希尔 `shellBlock`；冒泡 `bubbleFront` `bubbleMin`；简单选择 `selectMax` `selectShift`；快排 `quickSwap` `quickLast`；基数 `radixMSD` `radixLIFO`；归并没有 |
| `tree`（`bst:`） | `height`（根在第 1 层）、`leaves`、`aslSucc` | `mirror`；带 `ops: delete …` 还有 `replace` |
| `tree`（`heap:`） | `cmp`（全部操作的比较）、`cmp1` `cmp2`…（第 k 个操作的）、`swaps`、`final`、`pass1`…（`ops` 里有 `sort` 时：堆排序第 k 趟以后） | `minHeap` / `maxHeap`、`insertBuild` |
| `tree`（`nodes:` + `walk:`） | 不交量 | `preorder` `postorder` `levelorder` `inorder`（写的不是的那几种） |
| `avl` | `rot`（调整几次，LR、RL 算 1 次）、`turns`（单旋几次：LL、RR 1 次，LR、RL 2 次）、`LL` `RR` `LR` `RL`、`root` | `lr2ll` `bfsign` `topmost` |
| `paging` | `faults`、`hits`、`rate`（缺页率）、`victims`（依次换出的页） | `fifo` `lru` `opt` `clock`（写的不是的那几种）、`noInitial`；`eclock` 还有 `clearFirst` |
| `sched` | `avgTurn`、`avgWait`、`avgWeighted`、`order`（CPU 上依次运行的进程） | `fcfs` `sjf` `srtf` `hrrn` `prio` `pprio`（写的不是的那几种）、RR 的 `rrOld` |
| `disk` | `dist`（移动的磁道总数）、`avg`、`order`（依次访问的磁道） | `fcfs` `sstf` `scan` `cscan` `look` `clook`（写的不是的那几种）、`reverse`、C-SCAN / C-LOOK 的 `jump`（写了 `jump: count` 时是 `noJump`） |
| `hash` | `aslSucc`、`aslFail`、`clashes`（碰到过冲突的关键字有几个） | 开放定址 `modSize` `linear` / `quadratic` `failNoEmpty` `failBySize` `failByN`；拉链 `nullCounted` `failByN` |

错法短名照这组数列：某组数上和对的算出来一样的那个错法不列。写错的名字页面报，后面列着这组数有的。别的引擎（rbt、btree、huffman、kmp、bsearch、banker、组成原理、计网）不交量，trace 照样能用（只要那个组件有 `mode: fill` 的表）。

**计数的口径**（照王道的代码数，和教材的公式对得上）：

- 直接插入、希尔：`if (A[i] < A[i-dk])` 和循环第一次 `A[0] < A[j]` 是同一对关键字，算一次；哨兵 `A[0]` 让循环停下的那次照算；`j > 0`、`low < high` 这种下标的比较不算。移动是元素的每一次赋值（进出 `A[0]`、`pivot` 都算；一次交换算 3 次）。直接插入最坏（倒序）比较 (n+2)(n−1)/2、移动 (n+4)(n−1)/2，最好（顺序）比较 n−1、移动 0。
- 冒泡：倒序比较 n(n−1)/2、交换 n(n−1)/2、移动 3n(n−1)/2；顺序比较 n−1、1 趟。简单选择：比较总是 n(n−1)/2。
- 快排：一次划分 m 个元素比 m−1 次（每个不是枢轴的元素和枢轴比一次）；顺序时比较 n(n−1)/2、划分 n−1 次。
- 快排的「趟」有两种：`pass#` = 第几次划分以后；`round#` / `rounds` = 真题说的「第几趟」（2019 年第 10 题的定义：对尚未确定最终位置的所有元素进行一遍处理称为一趟，也就是这一层的子表全部划分完；只剩一个、空的子表不划分）。题里说「第二趟」用 `round2`。例：`49 38 65 97 76 13 27 49′` 的 `round1` 是 `27 38 13 49 76 97 65 49′`，`round2` 是 `13 27 38 49 49′ 65 76 97`（`pass2` 是 `13 27 38 49 76 97 65 49′`：第 2 次划分只划分了左边的子表）。trace 照真题的趟填写 `by: round`。
- C-SCAN / C-LOOK 跳回去的那一段：各书不一样，有的算进移动距离、有的不算。`jump: count` 算，`jump: skip` 不算（演示组件不写时不算）。检验题（predict、construct、calc、trace）用到 `cscan` / `clook` 的 `dist` `avg`（trace 的表里有移动距离）又没写 `jump:`，执行前的检查报「写明 jump: count 或 jump: skip，题面也写清楚跳回去算不算」；run 行写 `jump=count` / `jump=skip`。
- 归并：`Merge` 里每执行一次 `B[i] <= B[j]` 算一次（下标的比较不算）；趟是段长 1、2、4……自底向上，落单的一段不比。
- 堆：向下调整时有两个孩子的一层比 2 次（两个孩子比一次、大的（小根堆是小的）和双亲比一次），只有一个孩子的一层比 1 次；向上调整（插入）一层比 1 次。建堆、删堆顶（`ops: delete`）、插入都数。
- SJF 运行时间一样的按到达先后，不算并列。

**并列**：靠「两个一样好」定下来的量——OPT 换页时有两页以上以后都不再用（`victims`）、SSTF 两个请求离磁头一样远（`order`；走法不同总距离也不同时还有 `dist` `avg`）——页面判不了。固定的题里 `expect`、条件、`result` 用到带并列的量，或者 trace 要填的行有并列，执行前的检查报写法错误（trace 的话里写着用 `rows:` 只填到哪一行）；模板取到并列就重取；我自己造的输入有并列、条件又用到那个量，那一项待核。trace 里从第一处并列起往后的行都不硬判（写了另一种对的走法是待核，不是错；空着的格照样算没填）。例子：OPT、3 个物理块、引用串 `1 2 3 4 1 2 5 1 2 3 4 5`，第 10、11 次访问换页时有并列；王道那串 `7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1` 没有并列。

**相同的数**：我写的序列里有一样的数（`49 38 49`），排序跑之前页面把后出现的记成 `49′`，作答下面写一行「页面把第二个 49 记成 49′」；`'` `’` `′` 都认，`49 49`、`49 49'`、`49 49′` 是一个意思。王道那组 `49 38 65 97 76 13 27 49` 做希尔（增量 4、2、1）是稳定的；不稳定的例子：`4 7 4 1 2 5 7 8`（增量 4、2、1，`flipped` 是「4 4′」）。`final`、`pass#`、`round#` 带撇号（简单选择排 `5 8 5′ 2 9` 的 `final` 是 `2 5′ 5 8 9`）：我一个撇号都没写只比数，写了撇号连撇号的位置一起比（写 `2 5 5′ 8 9` 不对）。trace 的表撇号写不写、写在哪都不管。

**值怎么比**：

- 不是整数的量（`avgTurn` `avgWait` `avgWeighted` `avg` `rate` `aslSucc` `aslFail`）：分数、小数、百分数都认。和对的值一模一样的（`3/4`、`0.75`、`75%`）不管写几位都对；不是一模一样的小数，要至少 2 位小数、至少 3 位有效数字，按写出来的位数四舍五入比（16/3 写 `5.33` 对、`5.3` 不对；百分数换成小数再数位数，`83.33%` 是 4 位；0.0533 写 `5%` 不对）。
- 复杂度：`O(nlogn)` `O(n log₂n)` `O(nlgn)` `O(n log n)` 一样，`O(n^2)` `O(n²)` `O(n*n)` 一样，系数不算（`O(2n)` 就是 `O(n)`）；写化简以后的样子（`O(n^2+n)` 不认）；`expect`、`wrong`、`expr` 里写了页面读不懂的 `O(…)`（`O(n/2)` 这样），自检就报。
- 数还认十六进制（`0x3A3C` `3A3CH` `3a3ch`）、二进制（`0b1011` `1011B`）和式子（`π/4` `e^2` `ln 2` `√2/2` `2^10`，照 answer 的高数读法、弧度），式子和十六进制只认一模一样（相对 1e-9）；`∞`、`1/0` 这种算出来不是有限数的不对。
- 序列、字：按先后逐个比，不管空格、逗号、大小写的写法；`→` `->` `⇒` `>` 也是分隔（`P1→P3→P2`、`150→160→184`），字的序列（进程名）还认 `-` `—`（`P1-P3-P2`）；数的序列里 `-` 是负号，`150-160` 交之前挡。撇号照上面「相同的数」。

**交之前和判不了的**：

- 数、序列、复杂度读之前先全角转半角、去掉末尾的 `。` `.` `，` `,` `；` `;`（`０.６`、`3／5`、`0.6。`、`12,`、`2 5 8。` 照常读；construct 的格子也先全角转半角）。
- 格式不对交不了、不算第一次作答，页面说哪里不对（「A：要 8 个数，写了 7 个」「P2 少一格」「「x」不是数」）；predict 的 `expect`、calc / solve 的「最后的值」照对的值的样子查：「「缺页次数」只写数（分数、小数、百分数），不写单位」（`12次`）、「「时间复杂度」写成 O(n^2) 这样」（`O(n2)`）、「「换出的页」写一串数，用空格或逗号隔开」，不说要写几个。
- 格式对了引擎不收（AVL 里有重复的数、增量比元素个数还大）判没过，那一项（`run`）写引擎的原话。交之前没挡住、判的时候还读不懂的（predict、calc、solve）那一项待核，不算我错。
- 你那边出的问题（固定的字段引擎跑不了、`expect` 算不出来、`let` 出错、`check:` 出错）那一项待核，不算我错，也不算过。

**模板**（写法同 `recall` 那一节的「换数的模板」：`pick` / `where`、`\calc{…}`，`$…$` 里的写成 TeX，公式外面的写成数）：

- 408 的字段里也能写 `\calc{…}`：`run` 行、trace 的组件字段（`array: \calc{list(v)}`）、`expect`、`wrong` 的式子、`result`、`example`。`seq(8, 10, 99) distinct` 取 8 个 10～99 里不重复的数，`list(v)` 写成一排。
- `retry: self × 2`（`×` `x` `*` 都认，N 最多 6）= 写 2 次这道题自己，每次另取一组数；能和别的一起写（`retry: self × 2, p1c`）；没有 `pick` 的题不能写 `self`。
- 取到的数分不开 `against:` 的错法、用到的量有并列，和 `where` 不满足一样重取；执行前的检查取几组数验一遍，连着取 20 组都这样才报。
- 复测：见过的模板换一组数不算新题。同一个 `family` 没有没见过的题时，复测退回见过的模板换一组数，证据和 `absorb.retests` 那一次记 `renumbered: true`，`meta/state` 那一块写「复测用的是换了数的同一道题」，掌握参考把它当原题，照样记一条「缺新题（只剩换数的模板）」。

下面是一个能照抄的 `board check`（第五节）：p1、p2 是必做题，带 `retry: self × 2`；别的写成可选题只为例子短。

`````
````board check id=k408 title="希尔排序、LRU" limit=20m
block DS-L8.2.3 must=p1 optional=p3,p4,p6,p7
block OS-L3.2.2 must=p2 optional=p5
```trace
id: p1
pick v = seq(8, 10, 99) distinct
q: 对 \calc{list(v)} 做希尔排序（增量 4、2、1），写出每一趟以后的序列
target: 希尔排序分组
level: 方法
use: sort
algo: shell
array: \calc{list(v)}
gaps: 4 2 1
against: shellBlock
teach tag=shellBlock: 相隔 d 的元素才是一组：第 1、1+d、1+2d……个，不是连着的一段。
teach slip: 后面几趟照你写的上一行推都对，是这一处写错了：再对一遍这一趟。
teach default: 一组一组地做直接插入：d = 4 时第 1、5 个一组，第 2、6 个一组……
retry: self × 2
```
```predict
id: p2
pick v = seq(12, 1, 5)
q: 3 个物理块，引用串 \calc{list(v)}，LRU 置换。不画表，写缺页几次、依次换出哪几页，再写一句理由
target: LRU 当成了 FIFO
level: 方法
run r: paging algo=lru frames=3 refs="\calc{list(v)}"
expect x1 缺页次数: r.faults
wrong w1: r.faults - 3 => 一开始调入的 3 次没算缺页
expect x2 换出的页: r.victims
against: fifo
must m1: 换出的是往前看最久没被访问的那一页，不是最早调入的
teach tag=fifo: LRU 往前看谁最久没被访问，不看谁先进来。
teach w1: 一开始物理块是空的，调入的那几次也是缺页。
teach default: 每次缺页往前数：块里最久没访问的那一页换出。
retry: self × 2
```
```construct
id: p3
q: 造一个 8 个数的序列，使希尔排序（增量 4、2、1）不稳定；再写出换了先后的那两个相同的数（比如 49 49）
target: 希尔排序不稳定
level: 核心
slots: A=seq(8) P=seq(2)
run r: sort algo=shell gaps="4 2 1" array=A
if: r.unstable >= 1 => 这一组排完，相同的数先后没变（还是稳定的）
if: P in r.flipped => 写的这一对没有换先后
example: A=4 7 4 1 2 5 7 8 P=4 4'
teach if1: 让两个相同的数分在不同的组里，后面那个所在的组把它往前挪过前面那个。
teach if2: 排完看相同的两个数谁在前：先后反过来的那一对才是。
```
```tradeoff
id: p4
q: 为什么希尔排序先做几趟大间隔的，会比直接插入快？为什么链表上不适合做希尔排序？
target: 希尔排序的取舍
level: 核心
must m1: 大间隔的几趟让元素一次跨好几位，序列先基本有序；最后 d = 1 的直接插入每个元素只挪很少几步
must m2: 要按下标隔 d 取元素（随机访问），链表只能从头顺着走
wrong w1: 希尔排序是稳定的
```
```calc
id: p5
q: 4 个物理块，引用串 1 2 3 4 1 2 5 1 2 3 4 5，FIFO 置换。写出过程，最后写缺页率
target: 缺页率的分母
level: 方法
run r: paging algo=fifo frames=4 refs="1 2 3 4 1 2 5 1 2 3 4 5"
result: r.rate
steps:
s1 setup: 画出每次访问以后 4 个物理块里的页，缺页打勾
s2 calc: 数出缺页 10 次，访问 12 次
s3 conclude: 缺页率 10/12 = 5/6 ≈ 83.33%
```
```calc
id: p6
q: 设计算法，判断带头结点的单链表 L 是否递增有序。（1）思想（2）用 C 写出算法（3）时间、空间复杂度
target: 相邻比较漏了尾结点
level: 核心
steps:
s1 setup: 思想：p 从第一个结点起，依次比较 p 和 p->next 的值，有一处 p->data > p->next->data 就不是递增
s2 calc: 代码：for (p = L->next; p && p->next; p = p->next) if (p->data > p->next->data) return 0; return 1;
s3 conclude: 时间复杂度 O(n)，空间复杂度 O(1)
```
```code
id: p7
q: 下面的 Reverse 想把数组原地逆置，跑完数组没变。改一处让它对
target: 循环走到 n 又换回来
level: 基础
fn: void Reverse(int A[], int n)
starter:
void Reverse(int A[], int n) {
    int i, t;
    for (i = 0; i < n; i++) {
        t = A[i]; A[i] = A[n - 1 - i]; A[n - 1 - i] = t;
    }
}
tests:
A = [1, 2, 3, 4, 5], n = 5 -> A = [5, 4, 3, 2, 1]
A = [7, 8], n = 2 -> A = [8, 7]
A = [9], n = 1 -> A = [9]
teach default: 走到一半就停：再往后换，前面换好的又换回去了。
```
````
`````
