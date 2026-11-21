### practice：程序出题、程序判分

```practice
type: matvec, columns
count: 4
level: 1
```

`count` 是需要答对的题数，答够才能继续，之后也可以一直练下去。`level: 2` 出更大的数。内置题型见下面两小节（每门课各有几种）；更常用的是自定义题型。

**自定义题型 `type: custom`：你写出题模板，页面一直随机出新题、精确判分。**练熟一个方法时用它，不用自己一道道出题：

```practice
id: pr-rank1
title: 秩一矩阵的幂
type: custom
count: 3
pick a = int(-3, 3) nonzero
pick c = int(1, 3)
let A = [[c, 1], [a*c, a]]
where tr(A) != 0
where abs(tr(A)) <= 4
q: 设 $A=\calc{A}$，求 $A^{3}$。
answer: A^3
before: A^3 =
hint: 两行成比例，$A$ 的秩是 1：$A^3=(\operatorname{tr}A)^2A$。
explain: $\operatorname{tr}A=\calc{tr(A)}$，所以 $A^3=\calc{A^3}$。
```

- `pick 名字 = int(最小, 最大)`：随机取整数，后面加 `nonzero` 不取 0；还有 `choice` `vec` `mat`（见完整写法）。
- `let 名字 = 表达式`：由取到的数算出来的量。`where 条件`：一行一个，不满足就重取（比如 `where det(A) != 0`、`where abs(tr(A)) <= 4`），用来保证数字干净、题目有意义。
- `q:`、`hint:`、`explain:`、`before:` 里用 `\calc{…}` 写出这一题的数；`answer:` 是答案的表达式，可以是数、向量、矩阵，也可以配 `formula: n` 让我写式子。`check: basis` / `check: eigvec` / `check: bin` / `check: hex`（配 `width:`）同 `answer` 的 `type`。

- 发布时页面先取十几组数试一遍：算不出来、条件取不到都会报出来。

需要新的内置题型时告诉我，我会去 GitHub 上让人加。
- 取数的其他写法：`choice(2, 1/2, -3)`（从几个值里挑）、`vec(3, -2, 2)`（3 维随机整数向量，分量在 −2 到 2）、`mat(2, 2, -3, 3)`（2×2 随机整数矩阵，元素在 −3 到 3）。
- `int()` 的上下界可以用前面取过的数：`pick b = int(a + 1, 9)`。`n`、`E`、`I` 都是普通的名字，可以 `pick n = int(3, 6)`、`let E = …`（阶码；单独写 `E` 就是它，`E(3)` 照样是单位矩阵）；只有配了 `formula: n`（答案是含 n 的式子）时不能再取一个叫 n 的数。


### practice 的 use：演示组件当练习题

**演示组件当练习题 `use: 组件名`**：页面每一题换一组数，判分、错法诊断用那个演示组件。只写 `use: hamming`（还有 `crc` `mul` `div` `fadd` `frag` `kmp` `huffman` `sort` `paging` `sched` `subnet` `bsearch`）用内置的出题，`level: 2` 更难；同名字段照你写的（`use: paging` 配 `algo: lru`）。别的组件、别的出法：照自定义题型写 `pick`，下面接组件的字段，用 `\calc{…}` 写取到的数：

```practice
use: avl
pick v = seq(6, 1, 30) distinct
avl: \calc{list(v)}
ask: rotate
```

- `use:` 的细节：没写 `mode:` 也没写 `ask:` 就是 `mode: quiz`；`mode: fill`、`ask:` 照组件的写法（`mode: do` 不行）。这一组数正好问不到（插了几个数都没失衡，就没有 `rotate`）时页面自己换一组。作答记录照那个组件的写，题目后面带着这一题取的数（`（v=7 3 12 …）`）。`frames` 没有可以换的数，用 `type: custom`。
- 计算机课的取数：`bits(4)`（一串 0/1，`nonzero` 不全是 0，写出来就是 `1011`）、`seq(8, 0, 5)`（8 个数，`distinct` 不重复）、`word(fifo, lru, opt)`（挑一个词：算法名、方向）、`str(7, ab)`（用 a、b 拼 7 个字母：KMP 的模式串）。写进字段：向量用 `\calc{list(v)}`（写成 `7 0 1 2`），带正负号的二进制真值用 `\calc{sbin(x, 4)}`（`sbin(-13/16, 4)` 是 `-0.1101`，`sbin(-3, 3)` 是 `-011`），`bin(g)` 是不带符号的。向量的小工具：`el(v, 2)`（第 2 个，从 1 数）、`sort(v)`、`sum(v)`、`cumsum(v)`（前缀和：到达时间）。
- **算法函数**（用演示组件的引擎算，和画面一样）：`next(p)`、`nextval(p)`（模式串）、`faults(v, 3, lru)`、`victims(v, 3, fifo)`（页面引用串、块数、算法）、`wpl(w)`（哈夫曼）；`same(a, b)` 一样是 1。最有用的是 `where`：只出**能分开对错两种想法**的题，比如 `where same(victims(v, 3, lru), victims(v, 3, fifo)) == 0`（LRU 和 FIFO 换出的不一样，按 FIFO 做一定对不上）、`where same(next(p), nextval(p)) == 0`（照抄 next 一定错）。内置的 `paging`、`kmp`（level 2）已经这样取数。`\calc{list(nextval(p))}` 也能写在题面、解析里。

### practice 的内置题型（线代）

两组，组内可以混着出（`type: det3, inverse, eigen`），两组不能写在同一个 `practice` 里：

- `matvec` `columns` `combo` `det2` `matmul` `nullspace`
- `det3` `inverse` `rank` `eigen` `eigvec` `quadform`（考研口径的「好算的数」，`level: 2` 更难）

- `matvec`（计算 $A\mathbf x$）、`columns`（已知基向量的去向，写出矩阵）、`combo`（已知 $A\mathbf x$ 是列的某个组合，求 $\mathbf x$）、`det2`（2×2 行列式）、`matmul`（矩阵乘法）、`nullspace`（3×3 矩阵零空间的一组基）。
- `det3`（三阶行列式，`level: 2` 四阶）、`inverse`（二阶逆矩阵，`level: 2` 三阶、逆是整数）、`rank`（秩，`level: 2` 是 4×5）、`eigen`（特征值，都是整数，从小到大写）、`eigvec`（给出特征值求特征向量，差倍数也对）、`quadform`（写出二次型的矩阵，交叉项要除以 2；`level: 2` 四元）。

### practice 的内置题型（数据结构）

`shellpass`（给增量 $d$，写出一趟希尔排序后的序列，`level: 2` 更长）、`shellgroup`（给表长、增量和一个位置，写出它所在子表的全部位置）。