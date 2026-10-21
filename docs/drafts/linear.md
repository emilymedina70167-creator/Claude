# 说明草稿：栈、循环队列、特殊矩阵、外部排序、希尔排序

给 `CLAUDE-PROJECT.md` 第三节的草稿（还没放进去）。每个组件一节：`<!-- 完整写法 -->` 以前是精简版（每一轮都带进课堂，≤ 500 字节），以后是不常用的写法和错法诊断。「我」指学生。例子都能照抄（`tests/linear-common.test.js` 守着）。

### stack：栈的应用（中缀转后缀、后缀求值、括号、出栈序列）

<!-- 科目：数据结构 -->

```stack
id: st1
infix: a + b * (c - d) / e
ask: pop, out
```

- 写一种：`infix:`；`postfix: 1 2 3 * + 4 -`（求值）；`brackets: {[()]}`；`push: 1 2 3 4` 配 `pop: 3 2 4 1`（合法吗）；`count: 4`（几种出栈序列）。
- `ask:` infix `out` `top` `pop`；postfix `top` `value`；brackets `match` `result`；push `legal` `op`；count `count`。

<!-- 完整写法 -->

- 每读一个符号一步：竖着的栈（栈底在下）、读到哪儿、写出来的后缀。按王道：运算符先弹出栈里优先级**高于或等于**它的（碰到 `(` 或栈空停）再入栈；`)` 弹到 `(` 为止，括号不写进后缀。`out` 是读完这个符号后缀写到哪（我写整串，不写空格也认），`top` 是栈顶（选），`pop` 是这次弹出哪些（选，只在运算符那一步问）。
- 后缀求值：数之间用空格隔开；先弹出的是右操作数；除不尽的是分数（`8/3`，我写 2.67 也算对）。
- 出栈序列：照着出栈序列模拟，要出的不在栈顶就接着入栈，被压在下面就不合法。`legal` 在第 1 步先问，`op` 是每一步「入栈还是出栈」。元素不能重复，最多 10 个。`count:` 是卡特兰数 $\frac{1}{n+1}C_{2n}^{n}$，n ≤ 5 时列出全部序列。
- `mode: quiz`：写出后缀式 / 值 / 匹配吗 / 合法吗 / 几种。`mode: fill`：王道那张表，每读一个符号之后栈里有什么（底→顶）、后缀写到哪（infix）；栈里的数（postfix）；栈里的括号（brackets，配不上就停，后面空着）；每个元素出栈前先入栈的、出栈后剩下的（push / pop）。
- 错法诊断认得出：同优先级的没弹栈、把 `(` 写进了后缀（只有 fill 看得出：序列题把括号当分隔符）；减法 / 除法的操作数弄反、算完没压回栈；只看括号个数不看种类、读完没检查栈空；以为只能倒过来出、当成先进先出；卡特兰数忘了除以 n+1、当成 n!。

### cqueue：循环队列

<!-- 科目：数据结构 -->

```cqueue
id: cq1
size: 6
ops: enqueue a b c d e, dequeue 2, enqueue f g h
ask: rear, full
```

- `size:` MaxSize；`ops:` 入队 `enqueue a b`、出队 `dequeue`（`dequeue 2` 出两个），一个元素一步。
- `full:` `spare`（牺牲一个单元，默认）、`count`（增设 size）、`tag`（增设 tag）。
- `ask:` `front` `rear` `len`、`full`（入队前满了吗）、`empty`。

<!-- 完整写法 -->

- 按王道：front 指队头元素，rear 指队尾元素的下一个位置；入队放进 Q[rear]，rear = (rear + 1) % MaxSize。画成一圈（下标在里圈，front / rear 的箭头在外圈）；`draw: row` 画成一排，size 大于 12 自动一排。
- 一开始 front = rear = 0；`front: 3`、`rear: 0` 换起点（中间原来就有的元素画成 ·），对应「当前 rear = 0、front = 3，删一个再加两个」这类题。入队失败（满）、出队失败（空）也算一步，指针不动。
- `mode: quiz`：做完以后的 front、rear、长度（三个数）。`mode: fill`：每一步之后的 front、rear、长度。
- 错法诊断认得出：长度公式没先加 MaxSize（rear 绕回来以后得负数）、把 rear == front 当队满（牺牲的那格也放了）、指针加 1 以后没取模、增设 size / tag 以后还按牺牲一个单元判满。

### compress：特殊矩阵的压缩存储

<!-- 科目：数据结构 -->

```compress
id: cp1
matrix: symmetric 5
at: 3 4
ask: index
```

- `matrix:` `symmetric n` `lower n` `upper n` `tridiagonal n`，或 `sparse` 配 `data: 0 0 3; 0 5 0`。
- `at: i j` 问 a[i][j]；`base:` A 从几数（默认 1），`from:` B 从几存（默认 0），`order: col`，`store: upper`（对称存上三角）。
- `ask:` `index` `cell`（在 B 里点）`count` `line`；sparse `triple`。

<!-- 完整写法 -->

- n ≤ 8 画出每个元素、一行一行放进 B（下面写下标）；n 更大（最多 200，真题的 100 阶照写）只画示意图、讲公式。写了 `at` 时第 1 步就问：先数它前面存了几个，画面把这些涂黄；后面再一行行放进去对照。`line` 问每一行第一个元素的下标。
- 下三角 / 上三角矩阵另一半是同一个常数 c，存在最后（from 0 时是 B[n(n+1)/2]）；三对角矩阵 |i − j| > 1 的是 0，不存。对称矩阵 at 在另一半时换成 a[j][i]。
- sparse：最多 8 × 8，按行优先（`order: col` 按列）扫出非零元，三元组 (行, 列, 值)；`at` 问它是三元组表的第几个。
- `mode: quiz`：at 的下标（没写 at 问 B 一共几个元素）；sparse 写整张三元组表。`mode: fill`：每一行（列）存在 B 的哪一段（n 大时只填第 1、2 行和 at 那一行），再填 B 的长度、at 的下标；sparse 填三元组表。
- 错法诊断认得出：行优先当列优先、对称矩阵另一半没换成 a[j][i]、B 的下标起点差 1、A 的下标起点差 1；sparse 按列扫、行列号起点差 1。

### extsort：外部排序（败者树、置换-选择、最佳归并树）

<!-- 科目：数据结构 -->

```extsort
id: ex1
loser: 17 5 10 29 15
next: 44 12
ask: loser
```

- 写一种：`loser:`（各段当前的关键字，`next:` 依次补进来的）；`replace: 51 94 37 …` 配 `work: 3`；`merge: 9 30 12 …` 配 `k: 3`。
- `ask:` loser `loser` `winner`；replace `out` `runs`；merge `virtual` `merge`（点出合哪几段）`wpl` `io`。

<!-- 完整写法 -->

- 败者树（k = 2～8）：叶子 b0～b(k−1)，内部结点 ls[1]～ls[k−1] 记败者的段号，ls[0] 记冠军，关键字小的胜。建树从 ls[k−1] 往上一场场比；输出冠军后那一段补进 `next:` 的下一个（写 `∞` 是这一段读完了），只和从它的叶子到根路上的败者比。`loser` 问这一场结点里记谁（选），`winner` 在叶子上点出冠军。
- 置换-选择（最多 30 个记录）：先读满 WA；每次从比 MINIMAX 大的里选最小的输出，再从 FI 补一个；选不出来这一段结束（画面里比 MINIMAX 小的标「下一段」）。`out` 问下一步输出谁（选，含「这一段结束」），`runs` 在第 1 步先猜一共几段。
- 最佳归并树（最多 15 段，k = 2～6）：(n − 1) % (k − 1) = u ≠ 0 时补 k − 1 − u 个长度为 0 的虚段；每次合最短的 k 段；WPL = 所有非叶结点之和，I/O 次数 = 2 × WPL（每个记录占一个物理块）。
- `mode: quiz`：loser 写最后的 ls[0]～ls[k−1]；replace 写几个归并段；merge 写 I/O 次数。`mode: fill`：loser 每次建好 / 调整后的 ls（一次一列）；replace 每一段；merge 每次合哪几段（不管先后）、合成多少，再填虚段数、WPL、I/O。
- 错法诊断认得出：内部结点记了胜者（成了胜者树）、把大的当胜者；比 MINIMAX 小的也输出、每次读满工作区排好就输出一段；没补虚段、用 n % (k − 1) 算虚段、I/O 只算了一遍 WPL。

### sort 的补充：希尔排序（加在 `### sort` 那一节）

精简版里 `algo:` 那一条加上：

- `shell`（希尔排序，`gaps: 5 3 1`，不写就是 ⌊n/2⌋ 每次减半；相隔 d 的一组、同组同色，一组一步做直接插入）。

`ask:` 那一条里 `pass` 照旧适用于 shell。「希尔排序用下面的 `shellsort` / `sortpass`」一句改成：希尔排序也可以用下面的 `shellsort`（按王道代码逐行走）/ `sortpass`（写一趟的结果）。

完整写法的错法诊断加上：希尔排序按连续的段分组（相邻的几个当成一组）。

```sort
id: s-shell
algo: shell
array: 49 38 65 97 76 13 27 49' 55 04
gaps: 5 3 1
ask: pass
```
