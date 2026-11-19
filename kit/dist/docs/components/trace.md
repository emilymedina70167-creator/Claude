### trace、predict、construct、tradeoff、code、calc：408 的检验题

只在 `board check`（第五节）里能作答；字段、引擎交的量、计数口径在完整写法里。

外壳和数学的检验题（`recall` 那一节）一样：合书、第一次作答算数、没有提示和「看答案」，错了显示你写的 teach 再出一道 retry。

共用的字段：`id`、`q`、`target`（打的哪个典型错法）、`level`（`基础` / `方法` / `核心`）、`facet`（`重建` / `能用` / `边界` / `能辨`；408 的块（`DS-` `OS-` `CO-` `CN-`）里不写时：trace、predict、code、calc 能用，construct 边界，tradeoff 重建）、`teach 键: 话`、`retry`（同一种题型的同构小题；必做题至少 2 道，至少 1 条 teach）、`family`、`let`、模板的 `pick` / `where`。teach 先按这一项自己的查找顺序找（下面各题型写着），再按编号、`tag=`，最后 `default`；都没有时页面里的 Claude 写补讲。

各题型：

- **trace**（手推）：`use: 演示组件名`，下面原样写那个组件自己的字段（`algo: shell`、`array: …`、`gaps: …`，写法见那个组件）；我填的就是它 `mode: fill` 的那张表。可选 `rows: 2`（只填前 2 行）或 `rows: 2-3`（第 1 行给出、填第 2～3 行）、`given:` `cols:`（同 `mode: fill`）、`against: 错法短名`。组件的字段名和检验的字段撞了（sched 的 `q`、tree / thread 的 `level`、net / kmp 的 `use`、csma / mem 的 `retry`、memexp / util 的 `target`）写 `use.名字:`（`use.q: 2`）。elim、det、eig、schmidt、quad 不收（那是结果表，不是过程）。
  - 判：整张表交一次一起判，一行一项（`r1`、`r2`…，表下面的格是 `x1`…）。第一处错的那一行没过，对上了引擎的错法 `tag` 是错法短名、话后面接错法的说法。直接插入、希尔、冒泡、简单选择：错的那一行后面每一行，页面拿「对的这一趟作用在我写的上一行上」再核（证据里那几项带 `carried: true`，`ok` 是对我自己的上一行而言；这道题照样没过）；后面全对、没对上错法、错的那一行和对的最多差 2 格，那一项 `tag: slip`，话是「后面按你自己的上一行推都对，第 k 趟这一处写错了」。别的引擎错行后面的不列。
  - teach 键：对上错法的先找 `tag=错法短名`，笔误先找 `slip`，再找那一行（`r2`），最后 `default`。格子没填完交不了（该空着的格写 `-`）。
- **predict**（不推，直接写结果）：`run r: 引擎 字段=值 …`（一行一个，名字只用字母和数字；值有空格加引号：`refs="1 2 3"`）；`expect [x1] 标签: 式子`（一个要我写的结果一行，编号不写自动编 x1、x2…；式子能用 `r.faults`、`r.pass1`、`let` 和模板的量，`"2 5 8"` 是字）；`wrong [w1]: 式子 => 说明`（带 `=>` 的是错答案，挂在它上面最近的那个 `expect`）；不带 `=>` 的 `wrong` 是理由里的常见错说法；`against: 错法短名, …`；可选 `must` / `may`（理由要点，页面里的 Claude 判）、`answer:`。至少一个 run、一个 expect。
  - 判：每个 expect 一项，页面比值（见「值怎么比」）。值不对时：等于某个错法算出来的（写了 `against:` 只看那几个，没写看这个引擎全部）→ `tag` 是错法短名，话是错法的说法；等于 `wrong … =>` 的式子 → 话是那条说明；都没对上 →「标签不对」。值都对了才把理由交页面里的 Claude。某组数上错法和对的算出来一样，那个错法这组数不比。
  - teach 键：`tag=错法短名` → `w1` → `x1` → `default`。
- **construct**（408 的格子和量）：在数学的写法（`slots` `if` `expr` `example`，见 `recall` 那一节）上多三种格子：`seq(8)`（8 个数；不写个数最多 24 个）、`text`（一行字）、`procs(3)` / `procs(3, prio)`（3 个进程，一行一个「名字 到达时间 运行时间[ 优先级]」）；多 `run` 行（同 predict，值写格子名就换成我写的：`array=A`）；条件里用量：`r.unstable >= 1`、`P in r.flipped`（我写的这一对是 `r.flipped` 里的一对，先后不论）、`r.order == "P2 P1 P3"`。比大小 `>=` `<=` `>` `<`；比字 `==` `!=` `in`，不管空格、逗号、大小写、撇号的写法。一串（序列、字）只和格子、量、`"字"` 比，不和一个数比（`r.flipped != 0` 报写法错误，写 `r.unstable >= 1`）。不写 `against:`。teach 键 `if1`、`e1`、`run`（引擎不收我造的输入）、`default`。
- **tradeoff**（讲取舍）：写法、判法同 `recall`（`must` 每题最多 3 条、`may`、`wrong`、`answer`），页面里的 Claude 照要点判。
- **calc**（过程 + 最后的值）：写法同 `solve`（`q`、`steps:` 一行一步 `编号 setup|rule|calc|conclude: 内容`），多可选的 `run` 行和 `result: 式子`（最后的值，页面判，能用 `r.xxx`）。我写整道题的过程（打字或手写）和一行「最后的值」。步骤一律页面里的 Claude 逐步判，最后的值错了步骤照样判。teach 键 `result`、`s2`、`default`。照考试样子写的算法设计题（思想、代码、复杂度，手写）用 calc：`s1 setup: 思想…`、`s2 calc: 代码…`、`s3 conclude: 时间、空间复杂度`。
- **code**（补一两行、改错）：字段同第三节 `code`（`fn` `tests` `ref` `starter` `call` `scale` `check` `check_call`）；页面真跑测试，不调页面里的 Claude。iPad 上是软键盘，这一种用来补一两行、改一处：`starter:` 写好大半、留要补 / 要改的地方，框里还是 `starter` 原样时交不了。写了 `ref:` 页面先拿它跑一遍自己的测试；没写 `ref:` 每个测试都要写 `-> 期望`。一个测试一项（`t1`…：想要什么、得到什么，或运行出错、死循环和行号），编译不过一项 `compile`。`check:` 或 `ref` 在我的输出上自己出错 → 那一项待核。不写 `must` / `may` / `wrong`，不做模板。teach 键 `t2`、`compile`、`default`。

**引擎交的量**（`run` 的条件、`expect`、`result` 里写 `r.名字`；trace 的错法也照这张表的引擎）：

| 引擎 | 量 | 错法短名（`against:`） |
|---|---|---|
| `sort` | `passes` 几趟（快排是几次划分）、`pass1` `pass2`…（第 k 趟以后的序列）、`final`、`cmp` 比较次数、`move` 移动次数（快排、归并不交）、`swap` 交换次数（只有冒泡、简单选择）、`unstable`（排完换了先后的相同数有几对）、`flipped`（那几对，「49 49′」） | 直接插入 `insertCount`；希尔 `shellBlock`；冒泡 `bubbleFront` `bubbleMin`；简单选择 `selectMax` `selectShift`；快排 `quickSwap` `quickLast`；基数 `radixMSD` `radixLIFO`；归并没有 |
| `tree`（`bst:`） | `height`（根在第 1 层）、`leaves`、`aslSucc` | `mirror`；带 `ops: delete …` 还有 `replace` |
| `tree`（`heap:`） | `cmp`（全部操作的比较）、`cmp1` `cmp2`…（第 k 个操作的）、`swaps`、`final`、`pass1`…（`ops` 里有 `sort` 时：堆排序第 k 趟以后） | `minHeap` / `maxHeap`、`insertBuild` |
| `tree`（`nodes:` + `walk:`） | 不交量 | `preorder` `postorder` `levelorder` `inorder`（写的不是的那几种） |
| `avl` | `rot`（调整几次，LR、RL 算 1 次）、`turns`（单旋几次：LL、RR 1 次，LR、RL 2 次）、`LL` `RR` `LR` `RL`、`root` | `lr2ll` `bfsign` `topmost` |
| `paging` | `faults`、`hits`、`rate`（缺页率）、`victims`（依次换出的页） | `fifo` `lru` `opt` `clock`（写的不是的那几种）、`noInitial`；`eclock` 还有 `clearFirst` |
| `sched` | `avgTurn`、`avgWait`、`avgWeighted`、`order`（CPU 上依次运行的进程） | `fcfs` `sjf` `srtf` `hrrn` `prio` `pprio`（写的不是的那几种）、RR 的 `rrOld` |
| `disk` | `dist`（移动的磁道总数）、`avg`、`order`（依次访问的磁道） | `fcfs` `sstf` `scan` `cscan` `look` `clook`（写的不是的那几种）、`reverse`、C-SCAN / C-LOOK 的 `jump` |
| `hash` | `aslSucc`、`aslFail`、`clashes`（碰到过冲突的关键字有几个） | 开放定址 `modSize` `linear` / `quadratic` `failNoEmpty` `failBySize` `failByN`；拉链 `nullCounted` `failByN` |

错法短名照这组数列：某组数上和对的算出来一样的那个错法不列。写错的名字页面报，后面列着这组数有的。别的引擎（rbt、btree、huffman、kmp、bsearch、banker、组成原理、计网）不交量，trace 照样能用（只要那个组件有 `mode: fill` 的表）。

**计数的口径**（照王道的代码数，和教材的公式对得上）：

- 直接插入、希尔：`if (A[i] < A[i-dk])` 和循环第一次 `A[0] < A[j]` 是同一对关键字，算一次；哨兵 `A[0]` 让循环停下的那次照算；`j > 0`、`low < high` 这种下标的比较不算。移动是元素的每一次赋值（进出 `A[0]`、`pivot` 都算；一次交换算 3 次）。直接插入最坏（倒序）比较 (n+2)(n−1)/2、移动 (n+4)(n−1)/2，最好（顺序）比较 n−1、移动 0。
- 冒泡：倒序比较 n(n−1)/2、交换 n(n−1)/2、移动 3n(n−1)/2；顺序比较 n−1、1 趟。简单选择：比较总是 n(n−1)/2。
- 快排：一次划分 m 个元素比 m−1 次（每个不是枢轴的元素和枢轴比一次）；顺序时比较 n(n−1)/2、划分 n−1 次。
- 归并：`Merge` 里每执行一次 `B[i] <= B[j]` 算一次（下标的比较不算）；趟是段长 1、2、4……自底向上，落单的一段不比。
- 堆：向下调整时有两个孩子的一层比 2 次（两个孩子比一次、大的（小根堆是小的）和双亲比一次），只有一个孩子的一层比 1 次；向上调整（插入）一层比 1 次。建堆、删堆顶（`ops: delete`）、插入都数。
- SJF 运行时间一样的按到达先后，不算并列。

**并列**：靠「两个一样好」定下来的量——OPT 换页时有两页以上以后都不再用（`victims`）、SSTF 两个请求离磁头一样远（`order`；走法不同总距离也不同时还有 `dist` `avg`）——页面判不了。固定的题里 `expect`、条件、`result` 用到带并列的量，或者 trace 要填的行有并列，执行前的检查报写法错误（trace 的话里写着用 `rows:` 只填到哪一行）；模板取到并列就重取；我自己造的输入有并列、条件又用到那个量，那一项待核。trace 里从第一处并列起往后的行都不硬判（写了另一种对的走法是待核，不是错；空着的格照样算没填）。例子：OPT、3 个物理块、引用串 `1 2 3 4 1 2 5 1 2 3 4 5`，第 10、11 次访问换页时有并列；王道那串 `7 0 1 2 0 3 0 4 2 3 0 3 2 1 2 0 1 7 0 1` 没有并列。

**相同的数**：我写的序列里有一样的数（`49 38 49`），排序跑之前页面把后出现的记成 `49′`，作答下面写一行「页面把第二个 49 记成 49′」；`'` `’` `′` 都认，`49 49`、`49 49'`、`49 49′` 是一个意思。王道那组 `49 38 65 97 76 13 27 49` 做希尔（增量 4、2、1）是稳定的；不稳定的例子：`4 7 4 1 2 5 7 8`（增量 4、2、1，`flipped` 是「4 4′」）。

**值怎么比**：

- 不是整数的量（`avgTurn` `avgWait` `avgWeighted` `avg` `rate` `aslSucc` `aslFail`）：分数、小数、百分数都认。和对的值一模一样的（`3/4`、`0.75`、`75%`）不管写几位都对；不是一模一样的小数，要至少 2 位小数、至少 3 位有效数字，按写出来的位数四舍五入比（16/3 写 `5.33` 对、`5.3` 不对；百分数换成小数再数位数，`83.33%` 是 4 位；0.0533 写 `5%` 不对）。
- 复杂度：`O(nlogn)` `O(n log₂n)` `O(nlgn)` `O(n log n)` 一样，`O(n^2)` `O(n²)` `O(n*n)` 一样，系数不算（`O(2n)` 就是 `O(n)`）；写化简以后的样子（`O(n^2+n)` 不认）。
- 序列、字：按先后逐个比，不管空格、逗号、大小写、撇号的写法。

**交之前和判不了的**：

- 格式不对交不了、不算第一次作答，页面说哪里不对（「A：要 8 个数，写了 7 个」「P2 少一格」「「x」不是数」）。
- 格式对了引擎不收（AVL 里有重复的数、增量比元素个数还大）判没过，那一项（`run`）写引擎的原话。
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


### trace：代码逐行跟踪（真的把 C 代码跑一遍）

```trace
id: tr-ins
title: 直接插入排序（带哨兵）
call: InsertSort(A, 5)
let A = [0, 38, 49, 65, 13, 27]
predict: 7 if i == 4 -> j
code:
void InsertSort(ElemType A[], int n){
    int i, j;
    for(i=2;i<=n;i++)
        if(A[i]<A[i-1]){
            A[0]=A[i];
            for(j=i-1;A[0]<A[j];--j)
                A[j+1]=A[j];
            A[j+1]=A[0];
        }
}
```

- 页面里有一个 C 的解释器，**每执行一行记一步**：左边代码高亮这一行，右边是调用栈、这一层的变量（这一步变了的亮一下）、数组（`i`、`j`、`low`、`high`、`mid` 这类下标变量画在格子下面；`pointers: i, j` 自己指定）、二维数组的表、输出。说明里写着这一行做了什么（哪个变量从几变成几、条件成立没有、调用、返回）。
- `code:` **单独一行、放在最后**，下面全是代码（王道的写法照抄）。代码里有 `main` 就从 `main` 跑；没有就写 `call: 函数(参数)`，用 `let A = [0, 38, 49]`、`let n = 5` 给输入（一行一个，数组的下标从 0 数）。
- 支持 C 的常用写法（数组、函数、递归、引用参数、结构体、指针）；**不支持 `switch`、指针运算（`p++`）**：写了会报出来。
- 指针、结构体：`typedef struct LNode {…} LNode, *LinkList;` 照抄，`.` `->` `*p` `&x` `NULL` `malloc(sizeof(LNode))` `free(p)` `LinkList &L` 都行。结点画成框、指针画成箭头。`let L = list [头, 1, 2]`（带头结点）、`let T = tree A(B, C)` 直接给。`predict: 9 -> p`：问 p 指哪个结点（`->` 两边空格）。出错（空指针、越界、死循环……）都停在那一行说清楚。
- `predict: 7 if i == 4 -> j`：先猜。走到第 7 行（`i == 4` 的那一次）先停下，问我「执行完这一行，j 是多少」，答了才往下走。几个用 `;` 隔开；`if` 可以不写（第一次走到就问）。写了 `predict` 就自动问；没走到的 predict 自检会提醒。
- `mode: quiz`：只给代码，我写出结果：`quiz: output` 写输出（有 printf 时默认就是它），`quiz: A` 写运行完数组 A 的内容。

- 下标越界、变量没赋值就用、死循环（超过 1 万步）、递归没出口，都会停在那一行说清楚（如果是有意的，正好给我看错在哪）。
- 空指针、野指针、free 后再用、free 两次停在那一行；没 free 又没人指着的结点提醒内存泄漏。

- 支持的写法：`int` `long` `char` `double` `float` `bool`（`ElemType` 默认是 int，也可以 `typedef`），`#define` 常量，一维、二维数组和 `{…}` 初始化，函数、递归、引用参数 `int &a`，`if` / `for` / `while` / `do-while` / `break` / `continue` / `return`，各种运算符，`printf`、`putchar`、`puts`，没写的 `swap(a, b)` 当成交换两个变量。**不支持 `switch`、指针运算（`p++`、`p + 1`）**：写了会报出来。
- `ask: cond`（这次条件成立吗）、`ask: line`（接下来执行第几行）可以练控制流。
- 课堂里：`figure target=tr-ins set step=20`、`play step 0 40 20s`；`highlight 7` / `board mark target=tr-ins item=7` 指第 7 行代码。
- **结构体**：王道的写法都认：`typedef struct LNode { ElemType data; struct LNode *next; } LNode, *LinkList;`、`typedef struct { ElemType data[MaxSize]; int length; } SqList;`（成员可以是数组）、`typedef struct VNode {…} VNode, AdjList[MaxVertexNum];`（数组类型）、`struct LNode *p`。结构体变量、结构体数组（`G.vertices[i].first`）、`SqList L = {{3, 5, 8}, 3};` 按成员顺序初始化、整个赋值（`*p = *q`、`L2 = L`）、按值传参（拷贝一份）。
- **指针**：`*p`、`&x`、`p = q`、`p == NULL`、`p != q`、`!p`、`if (p)`、`while (p && p->data != x)`；指针参数（`void f(int *a)` 配 `f(&x)`）、返回指针（`LNode *GetElem(LinkList L, int i)`）、指针的引用 `LinkList &L`、`BiTree &T`（`CreateBiTree(T->lchild)` 这种递归也行）。数组能传给指针参数（`int *a` 接 `A`），`p[i]` 只能用在指向数组的指针上。
- **malloc / free**：`(LNode *)malloc(sizeof(LNode))`、`(LinkList)malloc(sizeof(LNode))`、不写转换也行；`malloc(sizeof(int) * n)` 分配一串（动态顺序表的 `L.data`），画成一排格子。新结点的成员一开始没有值（画成 ?），用之前要赋值。`free(p)` 以后结点画成虚线框、标「已释放」，还指着它的指针在说明里点名（悬空指针）；`free(NULL)` 什么也不做。最多 malloc 200 次。
- **`let` 给链表、二叉树**：`let L = list [头, 1, 2, 3]`（第一个写「头」就带头结点，头结点的 data 不用；不写就是不带，`list []` 是 NULL）、`let T = tree A(B(D, E), C(, F))`（括号写法同 `tree` 组件，也认层序 `A B C # D`），结点按先序编号。结点类型看 `call:` 里把它传给了哪个形参（`LinkList L` → LNode）；代码里只有一种链表结点（有 next）或二叉链表结点（有 lchild、rchild）时也认得出。有 `prior` 成员的建成双链表。data 是 char 时写字母，是 int 时写数。
- **`visit(T)`**：代码里没写 `visit` 时，输出结点的 data 和一个空格（先序遍历 `visit(T)` 直接能跑）。
- **画面**：堆上的结点画成框，一个成员一格：单链表 [data | next]、双链表 [prior | data | next]、二叉链表 [lchild | data | rchild]；指针从格子中间的圆点画箭头指到结点，NULL 写 ∧。链表顺着 next 从左往右排，一条链一行（长了换行，绕回来接上）；二叉链表画成树（线索二叉树 ltag / rtag 是 1 的那边不当孩子）；结构体数组里有指针的（邻接表的顶点表）画在最左边一列，每个顶点的边表接在同一行。指针变量的名字写在它指着的结点上面（树写在左边），结构体变量里的指针成员写成 `Q.front`、`Q.rear`。结点下面的 ①②③ 是 malloc 的先后，说明里也这么叫（「①.next：NULL → ②」）。这一步新建的结点闪一下，改了的格子、箭头、指针名字是黄的；换步时结点和名字滑到新位置。变量区里指针写成「p → ③」「p NULL」，结构体变量（SqList L、LinkQueue Q）画成卡片，里面的数组画成格子，`top` / `front` / `rear` 画在格子下面。
- **先猜问指针**：`predict: 11 if p->data == 3 -> p->next`。分隔的 `->` 两边要有空格（或者写 `→`、`=>`），不然会和 C 的 `->` 混。要问的是指针时问「指向哪个结点」，我写那个结点的 data（头结点写「头」，空指针写 NULL 或 ∧）；问 `p->data` 这种是数。那一次取不到值（比如 p 是 NULL 还问 `p->data`）、问整个结构体，自检会提醒。
- **出错，停在那一行说清楚**：
  - 空指针：「q 是 NULL（空指针），不能用 q->next」。
  - 野指针：「p 还没赋值就用了（野指针：还没让它指向任何结点）」，malloc 来的结点的成员没赋值就用也是（「s->next 还没赋值……」）。
  - 用了已经 free 的结点：「p 指向的结点①已经 free 了，不能再用 p->data（悬空指针）」。
  - free 两次：「q 指向的结点①已经 free 过了，这里又 free 了一次」；free 的不是 malloc 来的：「free 只能释放 malloc 来的空间」。
  - 类型对不上：「BiTNode * 不能指向 LNode」；指针当数用、`p.next` 写成点（「p 是指针：要写 p->next」）、结构体写成 `L->length`。
  - 不支持的：指针运算 `p++`、`p + 1`（「链表往后走写 p = p->next」）、指针的指针 `**p`、`new` / `delete`（写 malloc / free）、`calloc`、`union` / `enum`。
- **内存泄漏**（不停）：结点既没 free、又没有任何指针指着了（顺着变量、结构体、数组里的指针都走不到），那一步的说明后面提醒「③ 现在没有指针指着了，又没有 free：内存泄漏」，最后一步再总结一次；自检也提醒作者。main 结束时局部变量都没了，那时不算。
- **课堂里**：`board mark target=tr-rev label=p` 标 p 指着的结点（连同名字），`label=3` 标 data 是 3 的结点，`label=③` 标 ③ 号结点。`highlight 7` 还是第 7 行代码。
- `mode: quiz` 链表的题用 `quiz: output`：代码最后把链表输出出来（`for (p = L->next; p; p = p->next) printf("%d ", p->data);`）。
这是演示组件：先猜再揭晓（`ask`）、`mode: quiz` / `fill`、`vary:` 滑块、课堂里 `figure … set step=` 这些共用写法见 `components/stepper.md`。
