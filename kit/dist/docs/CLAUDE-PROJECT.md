# 学习台 · 手册

> **版本：2026-11-21**　学习台：https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo
>
> 这份手册的最新版在学习台 artifact 里（文件 `CLAUDE-PROJECT.md`）；每个组件的写法在 `components/<名字>.md`（`Artifact` 的 `action: "read"`，`path` 写 `"components/answer.md"`，`paths` 一次读好几个）。

这份手册只写学习台能做什么、写法是什么、页面会怎么做（第十五轮起，2026-11-18）。

学生在 iPad 上用学习台备考研：数学（线性代数）、408（数据结构、操作系统、组成原理、计算机网络）、英语（考研英语一）。一切都在学习台这一个 artifact 里：组件写法、每一节课、每一次作答和说的话、记忆、教材、真题。

- 第三节：组件写法（黑板上能放的东西）。
- 第四节：黑板指令的写法（`board` 块）。
- 第五节：外部的课——claude.ai 项目对话里的 Claude 在学习台的黑板上讲课（`kind: ext`）。
- 第六节：页面里调用的 Claude（练习教练、板边助教）和页面算好的事实。
- 第七节：学习台的数据（每一类的字段、编号、写法）。

以前的实时黑板、自学单元、舞台课、一问一答停用了，以前上过的在「以前的课」里能翻看。

---

## 三、组件参考

组件就是带特定语言名的代码块。块里每行写一个 `字段: 值`，下一行没有字段名就算续行。公式用 `$...$` 和 `$$...$$`。

**关卡**：`answer`、`predict`、`conjecture`、`practice`、`quiz`、`steps`、`recognize`、`findbug`、带 `goal` 的 `scene`，完成后才能继续（guided 课件）。其余组件不拦人。实时黑板里没有关卡。

**科目**：课件开头的 front matter 写 `subject:`（`线代`、`数据结构`、`操作系统`、`组成原理`、`计网`、`英语`，不写就是线代）。下面有的小节标题底下写着 `<!-- 科目：… -->`，说明这一节只给那几门课用；没写的是通用的。课堂模式里，课堂 Claude 只拿到「通用 + 这门课」的那几节（每一轮的说明有长度上限），所以计算机课的课堂一定要写 `subject:`。

### 表达式（所有组件通用）

**表达式**：数、向量 `[1, 2]`、矩阵按行写 `[[1, 2], [3, 4]]`，运算 `+ - * / ^`（`A^-1` 是逆），`A'` 是转置，`2u` 可以省略乘号。函数：`det` `inv` `T` `col(A, j)` `row(A, i)`（从 1 开始数）、`dot` `norm` `|v|` `proj(u, v)` `cross` `rot(角度)` `lerp(a, b, t)` `mat(列1, 列2, …)`（由列组成矩阵）、`I`（单位矩阵）、`sqrt` `abs` `sin` `cos` `tan`（弧度；scene、space 里角度）、`exp` `ln` `log` `floor` `min` `max` `round`，常数 `pi` `e`。比较 `<` `<=` `>` `>=` `==` 成立得 1、不成立得 0（可以写分段函数 `(x>0)*x`）。概率：`choose(n, k)` `fact(n)` `normpdf(x, μ, σ)` `normcdf(x, μ, σ)` `binompmf(k, n, p)` `poissonpmf(k, λ)` `exppdf(x, λ)` `unifpdf(x, a, b)`。矩阵：`tr`（迹）`rank`（秩）`rref`（行最简形）`diag(1, 2, 3)`（对角矩阵）、`I(3)` 也可以写成 `E(3)`（教材的记号；只写 `I`、`E` 是 2 阶）。`dec(x, 2)` 把数四舍五入写成小数（`\calc{dec(61/4)}` 写出 15.25，默认 2 位，末尾的 0 不写），只能直接写出来、不能再算。

**向量都是列向量**，转置的规则处处一样：`a'` 是 1×n 的行，`a'*b` 是一个数（内积，也可以写 `dot(a, b)`），`a*b'` 是 n×n 矩阵（外积），`A*a` 是矩阵乘列向量。两个向量直接写 `a*b` 会报错，免得分不清是内积还是外积。

计算机课还有进制、取模、位运算（见下一节）。

### 表达式（概率统计：分布的函数）

分布函数、分位数、别的分布（图、读数、`\calc`、答案里都能写，算出来是小数）：`norminv(p, μ, σ)` `binomcdf(k, n, p)` `poissoncdf(k, λ)` `geompmf(k, p)`（第 k 次才首次成功）`hyperpmf(k, N, M, n)`（N 件里 M 件次品，取 n 件，恰 k 件次品）`expcdf(x, λ)` `unifcdf(x, a, b)`；三大抽样分布 `chi2pdf(x, n)` `chi2cdf` `chi2inv(p, n)`、`tpdf(x, n)` `tcdf` `tinv(p, n)`、`fpdf(x, m, n)` `fcdf` `finv(p, m, n)`；`gamma(x)` `beta(a, b)`。`…inv` 是下侧分位数：上 α 分位点写 `chi2inv(1 - α, n)`、`norminv(1 - α)`。

### 表达式（计算机课：进制、取模、位运算）

`0x1F`、`0b1010_0011`（二进制、十六进制，可以用 `_` 分组）；`mod(a, b)`（结果和 b 同号）、`div(a, b)`（向下取整的整除）、`log2(x)`、`gcd` `lcm`；位运算 `and(a, b)` `or` `xor` `not(a, 位数)` `shl(a, k)` `shr(a, k)`（逻辑移位）`bit(a, i)`（第 i 位，从 0 数）；`signed(x, 8)`（把 8 位的位串当补码读，`signed(0xFF, 8)` 是 −1）、`unsigned(-1, 8)`（写成 8 位无符号数，255）。位运算只对非负整数，负数先用 `unsigned`。`bin(x, 8)`、`hex(x, 4)` 把数写成 8 位二进制、4 位十六进制（负数写成补码，四位一组用等宽字体），只能直接写出来（`\calc{bin(x, 8)}`），不能再拿去算。精确计算用的是大整数，64 位地址也不会丢精度。

### let：这节课的量（不显示）

```let
A = [[-1, -1, 2], [2, 2, -4], [1, 1, -2]]
a = [-1, 2, 1]
b = [1, 1, -2]
```

一行一个 `名字 = 表达式`，后面的行可以用前面的名字。定义一次，之后所有的段、组件（`answer`、`scene`、`matrix`……）和公式里的 `\calc` 都能直接用这些名字，不用每个组件再写一遍 `let`（组件自己的 `let` 同名时用自己的）。精确值（分数）保存。课堂、实时黑板里 `let` 放在哪一段都行，之后的段、别的板都认。`I`、`E`、`pi`、`e`、`step`、`t` 是保留的名字。

### 公式里的三个工具：`\calc`、`\hl`、`\chalk`

- **`\calc{表达式}`：让页面算，不要心算。**任何公式里都能写（正文、题面、提示、解析、标签、课堂里说的话），页面用精确分数算好再写进公式：`$A^2=\calc{A^2}$`、`$\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha=\calc{b'*a}$`、`$\operatorname{tr}A=\calc{tr(A)}$`。变量来自 `let` 块（组件里还有组件自己的 `let`）。矩阵写成 `bmatrix`，分数写成 $\tfrac{1}{2}$。开方、三角这类算不准的写成小数。算不出来（变量没定义、尺寸不对）会画成红框并报写法错误。**凡是要写上黑板的数，都用 `\calc` 让页面算**，改数出新题时也一样。
- **`\hl{名字}{…}`：给一项起名字**，本身不画任何东西。课堂里 `board mark term=名字` 靠它找到这一项去圈、框、划。名字只用字母、数字、`-`、`_`。
- **`\chalk{颜色}{…}`：这一项用彩色粉笔写**（静态的；颜色跟着黑板风格走，比 `\color` 好）。颜色同上面的颜色约定（`yellow` `pink` `blue`……）。

### 其他组件

- 提示框：`definition`、`theorem`、`key`（重点）、`warning`（易错）、`example`、`intuition`（直觉）、`remember`（要背）。第一行可写 `title: …`。要背的词句写 `==…==`。
- 折叠：`hint`、`solution`、`proof`。
- 记忆卡 `card`：`front:`、`back:`，点一下翻面。

### 组件一览（写法要单独读）

每个组件的写法（字段、例子、常见错法）单独放在学习台里，**要用哪个先读哪个**：`Artifact` 工具 `action: "read"`，`url` 是 https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo，`path` 写下表里的文件（比如 `"components/answer.md"`）；一次可以用 `paths` 读好几个。没读写法就写组件，页面会报写法错误。

- `scene`（线代、高数、概率）：可交互的图（描述式，不写代码） → `components/scene.md`
- `predict`（线代、高数、概率）：先猜，再揭晓 → `components/predict.md`
- `answer`：自己算、自己填，自动判分 → `components/answer.md`
- `answer`（数据结构、操作系统、组成原理、计网）：二进制、十六进制 → `components/answer.md`
- `answer`（线代）：基、特征向量、含 n 的式子 → `components/answer.md`
- `answer`（高数、概率）：函数式、导数、积分、极限、泰勒 → `components/answer.md`
- `conjecture`：说出你的发现（由页面里的 Claude 批改；`grade: off` 只记录不批改） → `components/conjecture.md`
- `practice`：程序出题、程序判分 → `components/practice.md`
- `practice` / `use`（数据结构、操作系统、组成原理、计网）：演示组件当练习题 → `components/practice.md`
- `practice`（线代）：practice 的内置题型（线代） → `components/practice.md`
- `practice`（数据结构）：practice 的内置题型（数据结构） → `components/practice.md`
- `quiz`：选择题 / 填空题 → `components/quiz.md`
- `solve`：解答题，按步骤判 → `components/solve.md`
- `recall` / `construct` / `claim` / `discriminate` / `locate`（线代、高数、概率）：检验题（二类，学完以后的吸收检验） → `components/recall.md`
- `tradeoff` / `calc`（数据结构、操作系统、组成原理、计网）：408 的检验题（块里的 trace、predict、construct、code 也在这一节） → `components/tradeoff.md`
- `rewrite`（英语）：英语的检验题（块里的 parse、translate、discriminate、errfind 也在这一节） → `components/rewrite.md`
- `context`：给页面里 Claude 的背景资料（不显示） → `components/context.md`
- `draft`：草稿区（Apple Pencil 演算） → `components/draft.md`
- `steps`：一步步揭开的例题（带着动脑） → `components/steps.md`
- `steps`（线代、高数、概率）：图跟着步骤动 → `components/steps.md`
- `matrix`（线代）：会动的矩阵 → `components/matrix.md`
- `derive`：分拍板书（一段推导一行一行写出来） → `components/derive.md`
- `sketch`：当场画的示意图（SVG） → `components/sketch.md`
- `image`：讲义原图 → `components/image.md`
- `let`：这节课的量（不显示） → `components/let.md`
- `calc` / `hl` / `chalk`：`\calc`、`\hl`、`\chalk` → `components/calc.md`
- `recognize`：认方法快练（只认方法，不计算） → `components/recognize.md`
- `findbug`：找错 → `components/findbug.md`
- `graph`（线代、高数、概率、计网）：函数图（微积分、概率分布） → `components/graph.md`
- `space`（线代、高数）：三维图（可以拖动旋转） → `components/space.md`
- `venn`（概率）：文氏图（事件的关系和运算、加法公式、条件概率） → `components/venn.md`
- `ptree`（概率）：概率树和面积图（全概率、贝叶斯） → `components/ptree.md`
- `joint`（概率）：联合分布表（二维离散型：边缘、条件、独立、Z 的分布、协方差） → `components/joint.md`
- `sim`（概率）：抽样模拟（大数定律、中心极限定理、抽样分布、置信区间） → `components/sim.md`
- `stepper`：一步步走的过程 → `components/stepper.md`
- `frames`：自己写每一步的演示（菜单上没有的过程） → `components/frames.md`
- `elim`（线代）：初等行变换（秩、极大无关组、解方程组、含参讨论、求逆、矩阵方程） → `components/elim.md`
- `det`（线代）：行列式的计算 → `components/det.md`
- `eig` / `schmidt`（线代）：特征值、相似对角化、施密特正交化 → `components/eig.md`
- `quad`（线代）：二次型 → `components/quad.md`
- `stack`（数据结构）：栈的应用（中缀转后缀、后缀求值、括号、出栈序列） → `components/stack.md`
- `cqueue`（数据结构）：循环队列 → `components/cqueue.md`
- `compress`（数据结构）：特殊矩阵的压缩存储 → `components/compress.md`
- `sort`（数据结构）：排序演示（按王道的代码走） → `components/sort.md`
- `extsort`（数据结构）：外部排序（败者树、置换-选择、最佳归并树） → `components/extsort.md`
- `tree`（数据结构）：二叉树的遍历、二叉排序树、堆 → `components/tree.md`
- `avl`（数据结构）：平衡二叉树 → `components/avl.md`
- `rbt`（数据结构）：红黑树的插入 → `components/rbt.md`
- `btree`（数据结构）：B 树、B+ 树 → `components/btree.md`
- `huffman`（数据结构）：哈夫曼树和编码 → `components/huffman.md`
- `uf`（数据结构）：并查集 → `components/uf.md`
- `buildtree`（数据结构）：由遍历序列建二叉树 → `components/buildtree.md`
- `thread`（数据结构）：线索二叉树 → `components/thread.md`
- `forest`（数据结构）：树、森林与二叉树的转换 → `components/forest.md`
- `kmp` / `hash` / `bsearch` / `blocksearch`（数据结构）：查找 → `components/kmp.md`
- `net`（数据结构）：图的算法（数据结构里的图；函数图是上面的 graph） → `components/net.md`
- `store`（数据结构）：图、树的存储结构（原图和存储并排） → `components/store.md`
- `deque`（数据结构）：双端队列（输入受限、输出受限） → `components/deque.md`
- `trace`（数据结构、操作系统、组成原理）：代码逐行跟踪（真的把 C 代码跑一遍） → `components/trace.md`
- `code`（数据结构）：写代码题（算法设计题，页面真的跑测试） → `components/code.md`
- `sched` / `paging` / `banker` / `disk`（操作系统）：操作系统的过程 → `components/sched.md`
- `alloc`（操作系统）：动态分区分配 → `components/alloc.md`
- `pagetable`（操作系统）：多级页表 → `components/pagetable.md`
- `fileidx`（操作系统）：混合索引 → `components/fileidx.md`
- `mem`（操作系统）：访存的整条链、有效访问时间 → `components/mem.md`
- `bitmap`（操作系统）：位示图 → `components/bitmap.md`
- `deadlock`（操作系统）：死锁检测（化简资源分配图） → `components/deadlock.md`
- `pv`（操作系统）：信号量 P/V → `components/pv.md`
- `addr`（操作系统）：分页存储的地址变换 → `components/addr.md`
- `bits` / `cache` / `pipe`（组成原理）：组成原理 → `components/bits.md`
- `memexp`（组成原理）：存储器扩展 → `components/memexp.md`
- `fadd`（组成原理）：浮点加减运算 → `components/fadd.md`
- `mul`（组成原理）：定点乘法 → `components/mul.md`
- `asm`（组成原理）：机器级代码（x86） → `components/asm.md`
- `div`（组成原理）：定点除法 → `components/div.md`
- `ea`（组成原理）：寻址方式 → `components/ea.md`
- `opcode`（组成原理）：扩展操作码 → `components/opcode.md`
- `layout`（组成原理）：大小端与对齐 → `components/layout.md`
- `irq`（组成原理）：中断屏蔽与处理次序 → `components/irq.md`
- `crc` / `hamming`（组成原理、计网）：校验码 → `components/crc.md`
- `encode`（计网）：编码波形 → `components/encode.md`
- `frag`（计网）：IP 分片 → `components/frag.md`
- `csma`（计网）：CSMA/CD → `components/csma.md`
- `switch`（计网）：交换机自学习 → `components/switch.md`
- `dv`（计网）：距离向量路由（RIP） → `components/dv.md`
- `util`（计网）：信道利用率 → `components/util.md`
- `rtt`（计网）：HTTP 要几个 RTT → `components/rtt.md`
- `subnet` / `tcp` / `window`（计网）：计算机网络 → `components/subnet.md`
- `array` / `shellsort` / `sortpass`（数据结构）：array / shellsort / sortpass → `components/array.md`
- `summary`：单元结尾（必放） → `components/summary.md`
- `rref` / `matmul`（线代）：线代的演示组件 → `components/rref.md`
- `cloze`（英语）：英语填空（一句或一段里几个空） → `components/cloze.md`
- `errfind`（英语）：英语改错（点出用错的词，再写改成什么） → `components/errfind.md`
- `parse`（英语）：句子成分标注（长难句，能套从句） → `components/parse.md`
- `parallel`（英语）：平行结构（并列的几项上下对齐） → `components/parallel.md`
- `shift`（英语）：句子变换（主动变被动、强调句、倒装还原……） → `components/shift.md`
- `chunk`（英语）：意群断句（长难句、翻译） → `components/chunk.md`
- `link`（英语）：连线（点一个词，再点它连着的那个词） → `components/link.md`
- `translate`（英语）：翻译（页面按要点判） → `components/translate.md`
- `gloss`（英语）：生词（点一下看意思） → `components/gloss.md`
- `drill`（英语）：句型操练（一题一题做，页面判分） → `components/drill.md`
- `stage`：在一段里嵌一块舞台：东西、交给学生的手、挑战当场判、预写的反应（外部的课里 board stage） → `components/stage.md`
- `widget`：一小段 JS 调 la.*：拖着排、按钮、输入、式子相等的判定、记作答（外部的课里 board widget） → `components/widget.md`
- **板书标注**（圈、框、大括号、下划线、波浪线、着重号、荧光笔、✓ ✗、箭头；也叫 mark、tag、highlight、圈画）：不是组件，是教具指令 `mark`（课堂里写 board mark 块，实时黑板写进 `ops`），写法见第四节「教具指令：figure、mark / unmark」 → `components/mark.md`

## 四、黑板指令（`board` 块）

下面这一段和页面里的老师读到的是同一份写法。外部的课（第五节）里没有的：工具（calc、component_doc、board_read、textbook_read、view_image……）、【课堂摘要】、「分钟没有动静」的提醒、页面叫你重写写错的段（外部的课里写错的报在下一份 ext_out 最前面，自己用 board replace 改）、平台核验模型。

你的每一轮输出是一段文本，页面一边收一边处理：

- **黑板一屏就是一块板。**学生眼前始终是「当前板」；旧板收进历史，学生可以翻回去看。每一轮你要么**换一块新板**（`board new`），要么**在当前板上改**（`add`、`replace`、`hide`、`figure`、`mark`），要么只说话。
- **黑板指令以外的文字，都是对学生说的话**，也写在黑板上：写在当前这块板的最上面（这一轮换了新板，就写在新板上），下一轮你再说话就把它换掉（支持 Markdown 和 $公式$，不要写 `##` 标题）。
- 学生说的话不显示在黑板上，只有你看得到。
- **要写上黑板的内容，放在语言名为 `board` 的围栏代码块里**。块的第一行是指令。你写的时候，学生看到你说的话一点点出现，写完的段可能先画出来（`hold` 藏着的不会）；整轮写完、确认是你（Opus 5.5）写的之后，页面按出现的顺序执行所有指令。
- 一轮里可以有好几个指令，按出现的顺序执行。

**外层一律用 4 个反引号**：开头一行是 4 个反引号紧跟 board 和指令，结尾单独一行 4 个反引号（见下面的例子）。块里的组件照常用 3 个反引号，这样组件的结尾不会把外层提前关掉。

下面例子里的 id（b3、b4、fig-b3、k1……）只是示范，不在黑板上；黑板上实际有什么，看「黑板现状」。

### 一块板放多少

- 板比一屏长时学生上下滑着看；学生也能自己调黑板的字号。「黑板现状」里写着学生屏幕上一块板大约多高。
- **一轮最多开一块新板**：这是页面的限制（`board new` 一轮只写一个；同一轮里多写的，页面会并到这块板上）。板可以往下长，学生上下滑着看。
- 横屏的 iPad 上，一段里正好有一张图（`scene`、`graph`、`space`）和别的内容时，页面会自动排成左图右文。

### new：擦掉黑板，换一块新板

````board new id=b3 title="Ax 落在哪"
拖动灰色的 $\mathbf x$，看黄色的 $A\mathbf x$ 跑到哪里。

```scene
id: fig-b3
title: Ax 落在哪
let A = [[1, 1], [2, 2]]
let x = [2, -0.5] drag
slider t 0 1 = 1
line [0, 0] dir [1, 2] color=yellow dashed
vector x color=gray label=x
vector lerp(x, A*x, t) color=yellow label=Ax
show $A\mathbf x = {A*x}$
```

```answer
id: q-b3
title: 算一个
q: 取 $\mathbf x = (3, -1)$，$A\mathbf x$ 等于多少？其中 $A = \begin{bmatrix}1&1\\2&2\end{bmatrix}$。
let A = [[1, 1], [2, 2]]
answer: A*[3, -1]
hint: 第一个分量是第一行和 $(3, -1)$ 的点积。
```
````

- 这一段是新板的第一段，`title="…"` 就是这块板的标题（12 个字以内，写在板头上），内容里不用再写 `##` 标题。引号用 "…" 或 “…” 都行。
- `id=` 是这一段的编号，由你来起：b1、b2、b3……按顺序往下编，同一节课里不能重复，撤回过的也不再用。「黑板现状」里会写下一个可用的编号。
- 块里的内容和课件里一节的写法完全一样：普通 Markdown、公式，加上前面组件说明里的任何组件。
- **课堂里每个组件都要写 `id:`**，整节课不重复，只用英文字母、数字和 `-`，比如 `fig-b3`、`q-b3`、`ex-2`。作答记录、`link:` 和下面的 `figure` 指令都靠这个 id 找组件。

### add：在当前板上再加一段

````board add id=b4 title="提示"
先只看括号里：$\boldsymbol\beta^{\mathrm T}\mathbf x$ 是几行几列？
````

加在当前板的最后，写法同 new（`title=` 是这一段的小标题）：在当前板上接着写。`new` 是另开一块板、当前板收进历史（学生能翻回去看）。还没有板时，add 也会开第一块板。

### replace：改写一段

````board replace id=b3 title="Ax 还在这条线上"
（b3 的完整新内容，写法同 new）
````

整段换成新内容，留在原来那块板上原来的位置；`title=` 不写就沿用原来的标题。学生在旧内容里的作答会被清掉，所以只用来修正写错的段、精简放不下的板、确实需要重画的段，或者照学生断的那一步改原来的讲解（在原来的讲解上改给学生看，不另起一段）。

### hide：擦掉一段

````board hide id=b4
````

### figure：让当前板上的图动起来

`target=` 是图的 `id:`（`scene`、`graph`、`space`、`predict`、`matrix`、`derive`、`sketch` 都行；`derive` 的 `step` 是写到第几行，`sketch` 只能 highlight）。只有当前板上和常驻栏里的图能动：以前板上的图学生看不到。这一轮先 `new` 了的话，当前板已经是新板。块里不写内容，下一行直接闭合。`predict` 里学生拖的猜测点（`guess`）不能改；标了 `after` 的东西要等学生点「确定」之后才出现，在那之前 highlight 不到。

````board figure target=fig-b3 set x=[1, 1]
````

- `set 名字=值`：改变量的值，一次可以改好几个，用空格隔开，比如 `set x=[1, 1] k=2`。等号两边不留空格。值是表达式（写法和组件里的表达式一样），可以用这张图里已有的变量，比如 `x=A*x`。能改的是 `let` 定义的变量、`slider` 滑块和可以拖的点。

````board figure target=fig-b3 play t
````

- `play 名字`：让这个变量从 0 动到 1（约 1.2 秒）。也可以写起点、终点和时长：`play t 0 1 2s`（时长写 `2s` 或 `1500ms`，只写数字按秒算）。要播放的图里先准备好这个变量，比如上面 fig-b3 的 `slider t 0 1 = 1`，再用它写过渡：`vector lerp(x, A*x, t)`、`grid lerp(I, A, t)`。图里没有这个变量，指令就不会执行。写了 `link:` 绑定 `steps` 的图自带 `t`。「黑板现状」里列出了每张图能改的变量。

````board figure target=fig-b3 highlight 4
````

- `highlight 序号`：让图里第几条命令画出来的东西闪一下，指给学生看。只数命令行（`let`、`slider`、`vector`、`point`、`line`、`grid`、`show`……），不数 `id:`、`title:`、`q:` 这类字段行，从 1 开始数。上面 fig-b3 里，第 4 条是 `line [0, 0] dir [1, 2]`（那条黄色虚线）。`let` 这类不画东西的命令闪不了。

### mark / unmark：指着讲（圈、框、划、写旁注）

在板上已有的字、公式、图上画手绘的记号（圈、框、大括号、下划线、荧光笔、箭头……），像站在黑板前的老师指着讲。标注留着，直到你撤掉，或者所在的段被 `replace` / `hide`。

````board mark target=b5 li=1-4 style=brace color=pink note="要背"
````

````board mark target=b5
text="be 动词除外" color=red note="例外"
text="谓语动词加 -s" style=highlight
````

- 画法：`brace` 大括号、`li=1-4` 一个大圈，把一组东西合成一个记号；`highlight` / `underline` 标一个词、一句；`dots` 着重号；`tick` / `cross` 对错号；`strike` 划掉；`to="…"` 画箭头连到另一处；`note=` 在旁边写一句。
- 块里每行一条，`target=` `color=` `style=` 不写沿用开头那行。`target=`：段的 id（`b5`、常驻栏 `k1`）或组件的 `id:`，只能标当前板和常驻栏。
- 标哪里（不写就是整个 target）：
  - `text="板上的字"`：任何一段字，中文英文都行（空格、全角半角不管）；长的写头尾 `text="主语是…除外"`；出现几次时 `#2`。`li=1-4` 列表第几条，`para=2` 第几段，`tr=2` 表格第几行。
  - `term=名字`：公式里 `\hl{名字}{…}` 包起来的项（`\hl` 只起名字、不画；普通文字用 `text=`，别塞进公式）。
  - `row=2` `col=3` `diag` `entry=2,3` `block=1,2`（先 `split`）：`matrix` 组件或公式里 `bmatrix` 的部位，几个矩阵时加 `of=名字`（`name=` 或 `\hl` 的名字）。
  - `step=2`：`steps` 走到的第 2 步。`label=Ax` `item=4` `at=[1, 2]`：图里标签是 Ax 的、第 4 条命令画的、坐标 (1, 2)，图动了跟着挪。
- `style=`：`circle` 圈（跨行的沿着字圈）`box` 框 `brace` 大括号 `underline` `double` 双线 `wave` 波浪线 `dots` 着重号 `highlight` 荧光笔 `strike` 划掉 `tick` ✓ `cross` ✗ `arrow` 箭头（从旁注或 `to=` 指过去）。不写时：几个字、项、元素圈，长句划线，一组列表大圈，行、列、整段框。
- `color=`：`yellow`（默认）`pink` `blue` `green` `orange` `purple` `red` `white`（✓ 默认绿、✗ 默认红）。`note="…"` 旁边写一句（短，可以有 $公式$），`side=right|left|above|below`。
- 写板时就知道是重点的，直接写进字里：`==要背的==`（粉色荧光底）、`=={yellow}关键==`（`blue` `green` `red` 也行）；公式里 `\boxed{…}` `\cancel{…}` `\chalk{pink}{…}`。讲着讲着才要指的用 mark。
- 撤：`board unmark id=m3` / `target=b5` / `all`，换讲法前撤掉不相关的。找不到要标的地方：这条不画，「[系统] 指令 mark 没执行」说原因；黑板现状里每段下面列着现有的标注。

### pin / unpin：常驻栏

````board pin id=k1 title="这节课的记号"
$A=\boldsymbol\alpha\boldsymbol\beta^{\mathrm T}$，$\boldsymbol\alpha=(1,2)^{\mathrm T}$，$\boldsymbol\beta=(1,1)^{\mathrm T}$
````

- 常驻栏在黑板旁边（横屏在右边一栏，竖屏在上面一条），换板也不擦，学生一直看得到。
- 常驻栏用另一套编号：k1、k2……；同一个 id 再 pin 一次就是改写。撤下：

````board unpin id=k1
````

### react：答案固定时页面替你接（不调用你）

````board react target=q-b3
right show=b4: 对。再来一个：乘 $(1,0)$ 呢？
done step=3: 例题看完了，下面这道你来。
````

- 调用你一次学生要等几十秒。**只预写答案固定、你当场写也一样的**：`right` 答对（一句确认，`show=` 揭开这一轮写好、`board add id=b4 hold` 藏着的下一小问）、`done` steps 看完（可加 `step=3`）。页面把话写到板顶。
- **教学不预写**：答错怎么引导、想不出来怎么提示，要看着这一次的作答当场写；页面不收 wrong / misread / giveup。要听理由、答对了也要追问的题不写 right。每条只用一次，答对整组收起，空块是撤掉。

### why：预写一步的依据

````board why target=ex-1
step=2: 因为 $\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha$ 是一个数，能挪到最前面。
````

学生能点板上任何一处问「为什么 / 没看懂 / 举个例子」。`why` 写一句这一步的依据（哪条性质、哪个定义），点「为什么」时页面当场显示、不调用你（`step=`、`term=`（`\hl` 的名字）、`all`）。

### judge：解答题一步一步判

````board judge target=p1
s1 ok
s3 wrong tag=规则用错 why="把 (A+B)² 写成 A²+2AB+B²"
s4 missing
````

- `target=` 是 `solve` 组件的 `id:`；一行一步，写参考步骤的编号和 `ok` / `wrong` / `missing`（没写这一步）/ `unsure`（看不清、拿不准对错，不猜：画成「？待外部核」，`ok` 记 null、`unsure: true`，不进错题本）；`tag=` 错法：符号、漏条件、规则用错、计算、记号、没写依据、步骤缺、别的；`why=` 一句为什么。没写的步记成没判。
- 页面把每一步的结论画在题下面（参考步骤这时才给学生看）、记一条作答（`steps: [{ id, ok, why, tag }]`）；有错或缺的步页面记一道错题（第几步、tag、why；同一道题记过的不另记）。

### 一轮输出的样子

下面只是指令格式的示范。

看 $A$ 的两列：它们一样，所以 $A$ 把整个平面压到了一条线上。

````board new id=b5 title="两列一样的矩阵"
$A=\begin{pmatrix}1&1\\2&2\end{pmatrix}$ 的两列都是 $(1,2)$，所以

$$A\begin{pmatrix}x\\y\end{pmatrix}=x\begin{pmatrix}1\\2\end{pmatrix}+y\begin{pmatrix}1\\2\end{pmatrix}=(x+y)\begin{pmatrix}1\\2\end{pmatrix}.$$

不管 $\mathbf x$ 是什么，$A\mathbf x$ 都落在 $(1,2)$ 这条直线上，落在哪只看 $x+y$。

例：$\mathbf x=(2,-1)$ 时 $x+y=\calc{2+(-1)}$，$A\mathbf x=(1,2)$。
````

````board add id=b6
```predict
id: pred-b6
title: A 把 (1, 1) 送到哪
q: 照上面的写法想，不做矩阵乘法：把紫色圆点拖到 $A\begin{pmatrix}1\\1\end{pmatrix}$ 那里。
let A = [[1, 1], [2, 2]]
vector [1, 1] color=gray dashed label=x
vector A*[1, 1] color=yellow label=Ax after
answer: A*[1, 1]
explain: $x+y=2$，$A\mathbf x = 2\cdot(1, 2) = (2, 4)$，还在 $(1, 2)$ 这条线上。
```
````

### 写的时候注意

- 你说的话（board 块以外的文字）写在当前板顶上。
- 组件只能写在 `board new` / `add` / `replace` / `pin` 里面，写在外面只会显示成一段代码。不要把 board 块套在别的代码块里，也不要在 board 块里再写 board 块。
- 围栏没闭合、指令看不懂的块，会原样当成普通文字写在板顶，黑板上什么也不会发生。
- 当前板上已经有的图能用 `figure` 改；板上已有的东西能用 `mark` 圈出来。
- **黑板上的数让页面来算**：公式里写 `\calc{表达式}`，页面用精确分数算好再写上去，比如 `$A^2=\calc{A^2}$`、`$\boldsymbol\beta^{\mathrm T}\boldsymbol\alpha=\calc{b'*a}$`。变量用 `let` 块定义的量（见组件说明）；说的话、题面、提示、解析里都能用。
- 学生在黑板上的作答，页面会自动发给你。

### 你会收到的消息

- 学生打的字，原样给你。「没懂。」「想不出来。」「换个说法讲讲？」「继续。」这四句是学生点底下的快捷按钮发来的。
- 「[指着问] …——为什么？（那一处的标法：mark target=ex-1 step=2）」：学生点着板上那一处问的，括号里是那一处在板上怎么 mark。
- 以「[作答]」「[动作]」开头的行，是学生在黑板上的操作记录，页面自动生成，一行一条，比如：
  - [作答] b3 里的 answer q-b3「算一个」：填了 (4, 2)（错，第 1 次），用时 31 秒
  - [动作] b2 里的 steps ex-1 第 2 步：想不出来，直接揭开了
  - 「（对）」「（错）」是程序判的；没写对错的是自由作答，要你来看。注明「手写转写」「截图转写」的文字是从手写认出来的，可能有认错的字。
  - 学生拖图、揭开中间的步骤，跟着下一条一起到。
- 以「[草稿]」开头的行，是学生在黑板上写了、**还没点「检查」「提交」**的内容（填了一半的格子、打了字的理由框、勾了还没提交的选项），跟着学生下一条说的话或作答一起到，比如：
  - [草稿] b4 里的 answer q-b4「算一个」：写着 (3, □)，还没提交
  - 草稿是学生还没提交的，页面不判对错。黑板现状里每个组件下面也列着它现在的草稿。
- 附了图片时，是学生的手写或截图（白底黑字），就在这一轮里。
- 以「[板书]」开头的行：学生用 Apple Pencil 直接在黑板上写了东西（演算、圈画、批注），导出成图附在这一轮（白底黑字，只有学生的笔迹，排列和黑板上一样；写在哪一段旁边那行会说）。
- 「[动作] 学生在当前板上 … 分钟没有动静」：题还没做，学生却很久没点、没写、没打字。学生可以在「⋯」里关掉这个提醒。
- 以「[系统]」开头的是页面发的消息。「[系统] … 写法错误」：那一段没显示，`board replace`（id 不变；或者 `board add` 同一个 id）重写它；页面叫你重写的那一轮说的话不上黑板；同一段最多重写 2 次，还不对就显示「这段没画出来」，课堂继续。`new` / `add` 撞了已有的 id 不会覆盖，换个新 id 再写。「[系统] 指令 … 没执行」多半是 `target=`、变量名写错或图不在当前板上，对照「黑板现状」；「看不懂」「没闭合」的块已当文字写在板顶。
- 「【到目前为止的课堂摘要】」是更早的对话压缩成的摘要，摘要之前的原文已经不在了。
- 能用工具时，`calc` 工具可以精确地算一个式子。每用一次多等一整轮；写上黑板的数也可以用 `\calc{…}`（页面算）。

### 在学习台里上课

- 学生在黑板上的每个动作（作答、预测、拖动、揭开、放弃）、在输入框里说的话、附的图，页面都自动记成证据（evidence）。
- **笔记本**也能在这一轮的输出里写（不多跑一轮），用 `note` 块，一行一个操作，正文写在 `<<<` 和 `>>>` 之间；页面在这一轮讲完以后执行，没改成的下一轮告诉你：

  ````board note
  create 学生/底子.md
  <<<
  正文
  >>>
  str_replace 学生/底子.md
  <<<
  旧的一段（要恰好出现一次）
  ===
  新的一段
  >>>
  insert 学生/底子.md 3
  <<<
  插在第 3 行后面
  >>>
  rename 学生/底子.md 学生/背景.md
  delete 草稿.md
  set 学生/背景.md pin=on order=1 show=off
  ````

  `pin=on` 的文件每一轮整份放进你的说明；`show=on` 的出现在学生的「笔记」页（照课件画，组件能作答）。
- **学习的账**用 `memo` 块写，一行一条；首页的复现、错题本、要记的、下一节从哪接就是读这些：

  ````board memo
  error step="第 1 步换括号" cause="把 βᵀα 当成矩阵" weakness=W19 basis=q-b5
  weakness id=W19 level=L0 basis=q-b5,q-b7
  review id=R3 result=过 basis=q-b9
  position next="先收 L2-08 的同类题，再推 Aⁿ" debts="例 2.3；例 2.4"
  todo text="学生问了相似对角化的几何意义，资料包里没有"
  recall q="外积 αβᵀ 的秩是多少" a="1：每一列都是 α 的倍数"
  block id=EN-L1.1.1
  ````

  `error` 新错题（不写 `id` 页面自动编号，题面和学生的答案没写时页面从依据里那次作答补）；`weakness` 写 `id=` 是改已有的弱点、不写是新弱点（`title scope level`）；`review` 复现组判 `result=过 / 没过`（页面照它记下这一次的日期和档位）、或者新的一组（`title family content`）；`position` 下一节从哪接；`todo` 待办；`recall` 一条要背的（页面每天让学生在首页先写再看答案，按 1 → 3 → 7 → 14 → 30 天排）；`block` 这节课讲的换成课程地图里的另一块（之后的作答按那一块记）。`basis=` 是依据：组件 id、段 id、`say`（学生刚说的那句）、记忆里的编号、证据 id。memo 块不收 mastery；页面按作答算的掌握参考在 meta/mastery-calc，mastery 本身用 write 改（课上没有 write）。写错的页面不记，下一轮告诉你原因。
- **这节课要拿下的事**（可用可不用）：写一个 `aims` 块，一行一件，格子用全角「｜」隔开：编号 ｜ 学生要能做的事 ｜ 什么算做到 ｜ `exam=` 对着的真题题号（后两格可以不写）：

  ````board aims
  a1 ｜ 给一个引用串，手算 LRU 的缺页次数 ｜ 独立做一道没见过的同类题 ｜ exam=Q-408-2023-45
  ````

  写了的话：板的上方显示给学生、黑板现状最前面列着；题那一段写 `aim=a1`，那一段的作答算到这一件上，页面按作答算每件的状态（还没证据 / 带着做到 / 独立做到 / 做了没到，只看最后一次失手以后的）；下课后页面留几道隔天做的题，结果记在这节课的 `later`。再写一次就整份换掉。

### 教具指令：figure、mark / unmark

外部的课和页面里的老师都写在 board 块里：块的第一行是指令（`board` 后面那部分），块里的行是 mark 的另外几条。下面只写指令本身。

**figure：让当前板上的图动起来。**`target=` 是图的 `id:`（`scene`、`graph`、`space`、`predict`、`matrix`、`derive`、演示组件都行；`sketch` 只能 highlight）。

- `figure target=fig-3 set x=[1, 1] k=2`：改变量的值，一次可以改好几个，用空格隔开，等号两边不留空格。值是表达式（写法同组件里的表达式），可以用这张图里已有的变量，比如 `x=A*x`。能改的是 `let` 定义的变量、`slider` 滑块和可以拖的点；演示组件的 `step` 是走到第几步，`derive` 的 `step` 是写到第几行。
- `figure target=fig-3 play t`：让这个变量从 0 动到 1（约 1.2 秒）。也可以写起点、终点和时长：`play t 0 1 2s`、`play k 1 4 3s`（时长写 `2s` 或 `1500ms`）。要播放的图里先准备好这个变量（比如 `slider t 0 1 = 1`，再用它写过渡 `vector lerp(x, A*x, t)`）；图里没有这个变量，指令不执行。
- `figure target=fig-3 highlight 4`：图里第 4 条命令画出来的东西闪一下（只数命令行，不数 `id:`、`title:` 这类字段行，从 1 数；`let` 这类不画东西的命令闪不了）。演示组件里是第 4 个格子 / 结点，`derive` 里是第 4 行。
- `predict` 里学生拖的猜测点（`guess`）不能改。

**mark：指着讲（圈、框、划、写旁注）。**对板上**已经有的东西**做标注，留在板上直到撤掉，或者它所在的段被改写、撤回。

- 画法和效果：一组（几条规则、一张清单）可以用**一个**大括号（`mark target=b5 li=1-4 style=brace color=pink note="要背"`）或一个大圈（`mark target=b5 li=1-4`）把整组圈在一起；一句里的关键词、结论 `highlight`（荧光笔，涂在字下面）或 `underline`；例外、易错圈红加旁注（`mark target=b5 text="be 动词除外" color=red note="例外"`）；着重的几个字 `dots`（着重号）；要理解的说明 `wave`；正误例句 `tick` / `cross`；约掉的项 `strike`；两处的关系画箭头（`mark target=b5 text="The boy" to="walks" note="主语 → 谓语"`）。
- 一条：`mark target=b5 term=mid note="1×1：一个数"`。好几条：第一行写 `mark target=m-b6`，块里每行一条（`row 1 note="×(−1)"`、`row 2 note="×2" color=pink`），`target=`、`color=`、`style=` 不写就沿用第一行的。
- `target=`：段的 id，或者组件的 `id:`。只能标当前板和常驻栏上的东西。
- 标哪里（不写就是整个 target）：
  - `text="板上的字"`：板上任何一段字，中文英文都行（不管空格、大小写、全角半角）；长的写头尾，中间用「…」：`text="主语是…除外"`；出现几次时 `text="例外#2"`（不写就标第一次，黑板现状里提醒你）。跨几行的半句话，圈会沿着字的形状圈。
  - `li=1-4`（列表的第 1–4 条，一组画一个形状，大圈连序号一起圈）、`para=2`（第 2 段）、`tr=2`（Markdown 表格的第 2 行）。
  - `term=名字`：公式里用 `\hl{名字}{…}` 包起来的那一项（写公式时就给以后要指的项起好名字；`\hl` 本身不画任何东西）。普通文字直接用 `text=`，不要塞进公式起名字。
  - `row=2`、`col=3`、`diag`（主对角线）、`entry=2,3`、`block=1,2`（子块，要先在 `matrix` 组件里 `split`）：矩阵的部位。`matrix` 组件和公式里的 `bmatrix` 都能标；一处有好几个矩阵时加 `of=名字`（`matrix` 的 `name=`，或者公式里用 `\hl{名字}{…}` 包起来的矩阵）。
  - `step=2`：`steps` 的第 2 步（学生已经走到的）。
  - `label=Ax`、`item=4`：图里标签是 Ax 的东西、第 4 条命令画的东西（演示组件里是第 4 个格子 / 结点）；`at=[1, 2]`：`scene` 里坐标 (1, 2) 那个点。图被拖动、`figure set` 之后，标注跟着挪。
  - `word=3`（第 3 个英文词）、`words=4-7`（第 4 到 7 个词）、`phrase="who lives next door"`（这几个词；出现几次时 `phrase="that#2"`）、`blank=2`（`cloze` 的第 2 个空）：英语句子里按词数。target 是英语组件时数的是那句英文，target 是一段时数的是整段的英文。phrase 里可以带标点（`phrase=", which"`、只圈逗号 `phrase=",#2"`）。
  - `part=2`、`part=2-4`：这一段的第 2 部分、第 2 到 4 部分（一个段落、一个列表、一张表、一个框、一个组件各算一部分，标题不算），默认框起来，框在字外面。要背的一大块一个框圈住，不要一项一项去圈。
- `style=`：`circle` 圈（宽的、几行的是一个圆角长圈，留白躲开旁边的字）、`box` 框、`brace` 大括号（右边，`side=left` 在左边，旁注写在括号尖外面）、`underline` 下划线、`double` 双下划线、`wave` 波浪线、`dots` 着重号、`highlight` 荧光笔、`strike` 划掉、`tick` ✓、`cross` ✗（写在句子后面）、`arrow` 箭头（从旁注指过去；写了 `to="…"` 就从这里指到那里，同一行的从上面或下面拱过去）。不写时：几个字、项、元素、点用圈，长句划线，一组列表大圈，行、列、子块、整段用框，对角线用斜着的长圈。
- `color=`：`yellow`（默认）`pink` `blue` `green` `orange` `purple` `red` `white`（`tick` 默认绿、`cross` 默认红）。`note="…"`：旁边写一句（要短，最多 80 个字，可以有 `$公式$`）；`side=right|left|above|below` 指定写在哪边。`id=` 不写时页面自动编 m1、m2……
- 写板时就知道是重点的，直接写进字里：`==只有这四类==` 是要背的（粉色荧光底，不压字），`=={yellow}谓语动词加 -s==` 换一种颜色标关键说明（`yellow` `blue` `green` `red`）；公式里 `\boxed{…}`、`\cancel{…}`、彩色粉笔 `\chalk{pink}{…}`。讲着讲着才要指的，用 mark。

**unmark：撤掉标注。**`unmark id=m3`（一条）、`unmark target=b5`（这个目标上的全部）、`unmark all`。


---

## 五、外部的课（`kind: ext`）

外部（claude.ai 项目对话里的 Claude）在学习台的黑板上讲课：学习台画板、当场判分、记作答；页面里的 Claude 只在外部开了的地方当助教（第六节）。

**开一节**：写 `sessions/{编号}` = `{ "date": "YYYY-MM-DD"（上海时间）, "kind": "ext", "status": "open", "block": "L2.1.4", "title": "…", "space": "math" | "cs" | "en", "startedAt": 毫秒 }`。编号 `c-YYYYMMDD-n`（那一天第几节，用没用过的）。可以和第一条 `ext_in` 同一次写；资料包可选（`sessions/{编号}/pack/main`）。页面第一次打开这节课时补上 `subject`、`aims: []`。学生在首页「上课」那一行看到它，点进去是黑板。

**一轮**：写 `sessions/{编号}/ext_in/{三位数序号}` = `{ "seq": 1, "text": "…", "after": 0, "said": "…", "model": "…", "at": 毫秒 }`：

- `text`：说的话 + `board` 块，写法见第四节（话写在板顶，块里是板的内容和指令）。
- `after`：读过的最后一份 `ext_out` 的序号（页面拿它算来回时间）。
- `said`（可选）：学生在对话里说的原话，页面记成学生说的话（证据 `src: say, via: "chat"`）。一个字符串，或者每一句一条 `[{ "text": "…", "at": 毫秒, "images": ["asset 编号"] }]`（`at` 照写进证据，图是外部用 `upload_asset` 传的）；都进课后报告。
- `model`（可选）：照存进这一轮的记录，报告里看得到；板上不标。
- 页面按序号执行，执行完在那一条上写 `done: { at }` 和 `got`（收到的时刻）；同一条只执行一次，刷新、开两个标签页都不重复。

**只在外部的课里有用的指令**（board 块的第一行；下面三条，加上后面几节的 `queue`、`edit`、`claude`、`claude-off`、`set`）：

- `board snap`：下一份 `ext_out` 带这块板的截图（`shots`：asset 编号，用读图的工具取）。不写不拍。
- `board close`：这一轮画完就下课（不调用 Claude、不写小结）：页面写 `status: closed`、`closedBy: "ext"`，算课后报告 `sessions/{编号}/report/main`（里面 `ext: { n, median, p90 }` 是来回的毫秒数）。学生在页面上点「下课」也一样。
- `board coach target=题的 id upto=…`：开这一题的板边助教（第六节）。不写就没有。

**执行完当场回报**（不用等学生动一下）：

- 页面执行完一条 `ext_in`，在那一条上写 `result` = `{ at, ok, summary, ops: [{ op, id, target, ok, error, page }], errors: [写错没显示的段和原因], notes: [别的提醒], memo: [{ line, ok, id, error }], shots: [asset 编号], shotNote }`。`memo` 是这一轮 `board memo` 块的每一行：写进去了的 `ok: true`、`id` 是写成的那一条（`errors/L2-60`、`sessions/{编号}.block`、`summary（新笔记）`），没写成的 `ok: false`、`error` 是为什么（读不懂、守卫拒了、超了条数）。这一轮写了 `board snap` 时，页面先等这块板画好（字体载完、段的淡入和别的动画走完、舞台演完、板上 0.35 秒不再变，最多等 6 秒）再拍，整块板拍成一张长图（比 4800 像素还高才切，`shotNote` 写切成几张、各是哪一段；等满 6 秒还在变也写一句）；下一份 `ext_out` 也带同几张。
- `sessions/{编号}/meta/now` = `{ at, text, board }`：黑板现状，`board` 是结构化的（每块板、每段、组件 id、每张图能改的变量、标注、草稿、作答、舞台现状、预备板、助手、屏幕）。板一变就覆盖写（最多一秒一次；写 `ext_out` 的那一刻也跟着写一份）；学生没动也读得到。
- `sessions/{编号}/meta/since` = `{ at, from（外部上一条执行完的 ext_in 的编号）, fromAt, outs: [序号], shots, text }`：那一条执行完以后写的全部 `ext_out` 按先后拼成一份，一次 get 读完；下一条 `ext_in` 执行完时从头攒。
- 屏幕照这个页面真有的地方报（`visualViewport`）：分屏时写「横屏 860×734（分屏：这个页面只占屏幕的一部分，整个屏幕 1180×820）」，`meta/now.board.screen` 里是 `{ w, h, landscape, split, full }`。

**分析游标和这一科没分析的证据**（证据一条都不丢、每一条都被分析过）：

- `meta/cursor-{math|cs|en}` = `{ "at": 毫秒, "by": "ext", "note": "…" }`：外部写，分析到这一刻为止。比的是证据**写进学习台的时刻**（证据上的 `wroteAt`，以前的证据没有就按 `at`），不是事件时间：`said` 写的是学生说话的时候，常常早于写进来。
- `meta/since-analysis-{科}` = `{ at, from, n, shown, more, upTo, text }`：页面写。游标以后写进来的这一科的全部证据（课堂、外部的课、复现课、练一练、页面里的老师和助手、补记、要记的），按事件时间一条一行（开头是证据编号；事件和写入差一分钟以上的那一行末尾标「写入 hh:mm」），一次 get 读完；太长（200 KiB）先放早写进来的，照实写还有几条。`upTo` 是放下的这些里最晚写进来的那一刻：分析完把游标的 `at` 写成它，没放下的下一次照样在。
- 开场简报 `meta/brief*` 最前面两行：笔记本「现状/总览.md」是几天前写的（超过 7 天写「该重写了」）、上次分析以后这一科还有几条证据没分析。
- 和 `sessions/{编号}/meta/since`（一节外部的课里，上一条 `ext_in` 以后的 `ext_out`）是一套：一个按课，一个按科。

**讲过和会了**：

- 板上的段写 `block=L2.1.4`（课程地图的编号）就是这一段讲的块，不写是这节课的块；段画上了页面就记 `coverage/{编号}`（`#` 换成 `~`）= `{ id, kind: block | point, block, space, sessions, first, last, segs }`，有 `point=` 的另记一条知识点。一节课里做过这一块的题（证据、那节课记的错题、掌握的依据是那节课的作答）也算那节课讲过。
- 学习台以前讲的（claude.ai 对话里的课，没有原始作答）记 `coverage/legacy-{编号}` = `{ id, kind: "legacy", block, space, first, last, sessions: [], source, by, note }`：外部写的照用；有错题、掌握的依据是旧记录、可这一块一条 legacy 都没有的，页面照错题本的日期、依据文字里的日期（「09-28」）补一条（`by: "page"`，`source` 写照什么补的）。掌握明写着「未学」的、学习台里的课记的错题不补。
- 掌握状态（`mastery`）的依据：最近一条改 `state` 的 log 的 `basis`，编号在 `evidence`、`errors`（含 T 编号的检验记录）、`observations`、`sessions` 里找。全在证据里的是原始作答：`基础题过` / `复现通过` 还要依据里有做对的作答。依据里有错题本、观察、课的编号，或「旧记录：…」开头的文字，是**旧记录**（没有原始作答）：状态照算，`meta/state-{科}` 里写「（旧记录：错题本 L1-T01，没有原始作答）」。哪里都找不到、也不是「旧记录」开头的，照存，写「依据核不上，不算」。
- `meta/state-{科}` = `{ text, rows: [{ block, title, taught: { first, last, sessions, legacy: { first, last, months, source } }, mastery: { state, ok, legacy, from, why, note }, recent（最近 3 条作答，含错题本里的旧错题、检验记录）, lastSlip（最近一次失手；检验记录写「不计」的不算）, nextReview }], conflicts: [{ kind, block, text }] }`：页面写，每块一行，讲过写「讲过（9 月，旧记录）」「讲过（9 月旧记录；学习台里 2026-11-18，1 节）」。`conflicts` 是记录之间对不上的，只报不改：`slipped`（掌握写着过了，之后同块做错了，或错题本里之后又记了错题）、`maybeKnown`（写着未学 / 讲过，隔天的新题一次做对了）、`weakness`（弱点 L1 以上以后又有挂它的错题）、`review`（复现组判过，依据里没有一次做对的作答）、`untaught`（没讲过却写了掌握）、`unverified`（掌握的依据核不上）。

**页面里的 Claude 说的话**也记成证据 `src: "helper"`（`role`：`helper` 外部叫来的助手、`coach` 板边助教、`teacher` 练习教练和复现课里页面里的老师；`text` 说的话，`did` 执行了哪些，`target` 哪一题），进 `since-analysis`。

**整节课的设置**：`board set upload=on|off`——组件下面的「截图」入口（`answer` 的截图作答、写理由的框里的「截图」）。外部的课默认 `off`；一个组件单独写 `upload: on` / `upload: off` 盖过整节课的。之后画的段照新的设置，刷新以后照旧。

**一轮几块新板、预备板**：

- 一轮里 `board new` 可以写几次，每次开一块新板，最后一块是当前板。
- `board queue id=b5 title="…" after=…`：块里是那块板第一段的内容。先存着、不显示；`after=q-b4:right`（q-b4 答对）、`q-b4:done`（steps 揭开最后一步）、`q-b4:submit`（交了作答）、`button`（板上方出「下一块 →」，学生点）几个用 `|` 连着写，哪个先到就开。开的时候页面照 `board new` 画、翻过去，写进下一份 `ext_out`（`[页面] 预备板 b5 开了`）。没开的列在黑板现状「外部的课里页面记着的」。
- `board react` 的 `target` 可以是还没开的预备板里的组件：先存着（`result` 里写「挂在预备板 b5 的组件上：开板时挂上」），开板时挂上。
- `board unqueue id=b5`：没开的预备板丢掉，挂在它上面的预案一起丢，「下一块 →」跟着收；开过的报「已经开了」（要撤板上的段用 `board hide`）。

**指以前的板**：`mark`、`figure`、`replace`、`edit`、`hide` 的目标在以前的板上也执行；学生不在那块板上时，板上方出一条「主讲在第 N 块板上标了东西 →」，学生点了翻过去。

**改字不丢作答**：`board edit id=b3`，块里写一处或几处

```
<<<
原来的字
===
新的字
>>>
```

旧字要在那一段里正好出现一次。只改那段的文字；改完以后原文一字没变的组件（按 `id:` 对）留着学生的作答、草稿、拖过的图。改到了的组件照 `replace` 重画。

**预案**（`board react`，写法见第四节）：外部的课里除了 `right`、`done`，还收：

- `wrong: …`：答错；`wrong match="x=3": …` 学生的答案里有这一段（不管空格、大小写、全角半角）才用这一条，`match="/正则/"` 照正则；同一题先找对得上 `match` 的，再用没写 `match` 的。
- `misread "错法": …`（页面认出来的错法）、`giveup: …`（想不出来、看了答案）。
- `stuck=90s: …`：那一题这么久没有作答（至少 10s）。只算那题在学生屏幕上的时间：学生翻到别的板、切到别的程序、锁屏的时间不算（`board claude … stuck=` 也一样）。
- 每条只用一次；页面接了不调用，写进下一份 `ext_out`（`（预案当场接了：…）`）。

**叫页面里的 Claude 来接：`board claude`**（Opus 5.5 high；平台回的不是它，那一次作废、不写）：

````
````board claude id=cl1 on=wrong target=q1 to=board turns=2
see: target, board, evidence=last3
can: say, mark
<<<
（写给它的话，任意长）
>>>
````
````

- 什么时候叫：不写 `on=` 就是执行这一轮时马上叫一次；`on=` 写学生在 `target` 那题上的事，几件用 `|` 连：`submit`（交了）、`wrong`（答错）、`right`（答对）、`giveup`（想不出来 / 看了答案）、`draft`（写着还没交，写的变了就算一次）、`say`（学生在输入框打了字，不用 `target`）；`stuck=90s`（那题这么久没动静）。
- `see:` 给它看的（不写就是 `target`）：`target`（那道题在板上的原文和学生在上面的全部作答）、`board`（黑板现状）、`evidence=last3`（学生最近几次作答和动作）、`ext`（这节课外部写过的每一段）、`memory=集合/编号,集合/编号`（学习台里那几条，原样）、`books=条目范围`（告诉它用 `textbook_read` 取）。学生这一次的作答总是带着。
- `can:` 它这一次能做的（不写就是 `say`）：`say`（说的话写在板顶）、`add`、`replace`、`hide`、`mark`、`figure`、`react`、`new`、`stage`、`widget`、`memo`、`note`、`judge`（解答题一步一步判，写 `board judge`；`target` 是 `solve` 时学生交的照片原图一起交给它，参考步骤也在它的材料里）。不在里面的指令页面不执行，写进 `ext_out` 的「没执行（越权）」；`pin`、`aims`、`close`、`claude` 这些它一律不能写。
- `to=`：`board`（默认，照 `can` 执行到板上）、`ext`（不上板，全文只写进 `ext_out`）、`db:集合/文档`（全文存进那一条的 `text`，不上板，记一条 `journal`，`by: "ext-delegate"`）。
- `turns=`：这一条最多被叫几次（`on=` 的默认 3，马上叫的默认 1，最多 20）；`until=right`（学生答对那题以后不再叫）/ `turns`（默认，次数用完）/ `me`（外部收回为止）。`board claude-off id=cl1` 收回一条，`board claude-off all` 全收。同一个 `id` 再写一次就换成新的那条（次数从 0 数）。
- 它能用的工具和页面里的老师一样（`calc`、`board_read`、`get_answers`、`view_handwriting`、`textbook_read`、`component_doc`……）。它判断超出了外部给的范围时，最后写一行 `[交回] 原因`：不回学生，板顶写「主讲会接着讲。」，原因进 `ext_out`。
- 每叫一次，下一份 `ext_out` 里有 `[助手 cl1]（wrong q1） 回了：` 加它的全文、执行了哪些、越权没执行的、用量（发出多少、等了几秒、调了几次工具）。黑板现状里列着每一条助手叫过几次、收起没有。
- 学生这边：板上方一直有「叫主讲」；有开着的助手时多一颗「停掉助手」。学生点了以后页面不再叫助手（写进 `ext_out`，这节课记着 `helperOff`），外部再写一条 `board claude` 就重新打开。

**后台的活：`ext_jobs`**：写 `ext_jobs/{id}`（全局）或 `sessions/{编号}/ext_jobs/{id}` = `{ "prompt": "…", "see": ["books/B43/chunks/B43-1", …], "out": "集合/文档", "tools": ["read", "list", "search"], "at": 毫秒 }`：

- 学习台开着时跑：首页开着跑全局的；进了课堂跑全局的和这节课的。一件一件跑（等讲课的调用跑完再发），Opus 5.5 high；`see` 里的几条（最多 12 条）先读好放进给它的话；`tools` 是只读的 `read`、`list`、`search`（不写就三个都给）。
- 状态写回那一件：`queued` → `running`（`startedAt`）→ `done`（`endedAt`、`ms`）或 `failed`（`error`）。`running` 了 10 分钟没写完（页面关了）的下次重跑。
- 结果存进 `out` = `{ text, job, by: "ext-delegate", model, at, from }`，记一条 `journal`（能撤销）。`meta/facts.jobs` 是 `{ queued, running, done, failed }`。
- `board add id=b5 from=集合/文档`（`new`、`replace`、`pin` 也行）：执行前页面把那一条的 `text`（没有就 `md`）换进块里；块里原来写的字留在前面。读不到的那一块照原样执行、`ext_out` 里说一句。

**检验（二类）：`board check`**（学完以后的吸收检验；页面里的老师的课也能写）：

````
````board check id=k1 title="第二讲第一节" limit=15m pause=30s
block L2.1.1 must=p1,p2
block L2.1.4 must=p3,p4,p5 optional=p7 fast=90s
spare p8,p9
<<<
（可选）外部没写到的错法时，给页面里的 Claude 的话
>>>
```construct
id: p1
…
```
（题、它们的 retry、spare 都写在这个块里；题的写法见第三节「检验题」）
````
````

- 块里每个围栏的名字就是探题的题型：`recall` `construct` `claim` `discriminate` `locate` `solve`，408 的 `trace` `predict` `construct` `tradeoff` `code` `calc`，英语的 `parse` `translate` `rewrite` `discriminate` `errfind` `recall`（写法见第三节「检验题」「408 的检验题」「英语的检验题」）。`trace` `predict` `code` `parse` `translate` `errfind` `solve` 单独写在板上是一类组件（第三节同名的那一节）；别的单独写在板上只画预览。
- 检验题的写法：数学的见 `recall` 那一份，408 的见 `tradeoff` 那一份，英语的见 `rewrite` 那一份（`components/recall.md`、`components/tradeoff.md`、`components/rewrite.md`）。
- `block 块 must=… optional=… [fast=]`：一块一行，按写的先后做，块里先必做再可选；`spare`：不出现，只存进题库给复测；没排进任何一行、也不是谁的 `retry` 的题报写法错误。`limit=` 第一次作答一共多久（不写不限时），`pause=` 手写停多久算停顿（默认 30s）。
- 执行时页面先查一遍（写法、每道题的 `example` 代进条件（带着这节课 `let` 过的量；模板先取几组数）、必做题 retry 至少 2 道、至少 1 条 teach、retry 是同一种题型），不过的不开，原因写在 `ext_in.result`；`node tools/ext-check.mjs --next … --lint` 查的是同一份。过了就画一张开始卡，题全部存进题库 `probes`。
- 学生点开始：板、常驻栏、翻板条、整页板书收起来（合书），做完放回来；这时来的 `ext_in` 照常执行，画好的板做完检验才看得到。一道题：作答 → 点「很确定 / 大概 / 蒙的」→ 交；没有提示和「看答案」，「想不出来」一直在。
- 判：构造的每一条、式子、真假、能不能、哪一行、逐行证明、result、fix，408 的表、结果、测试，英语的成分、has / not、选哪个、点的词和改法页面当场判；要点、证明要点、理由、solve 的步骤每交一次调一次页面里的 Opus 5.5 high（给它题、你写的要点或参考步骤、学生交的；手写的带整页图，转写和判同一次），回的不是 Opus、读不出来、超过 90 秒都算拿不准。要它判的题交了学生马上做下一道，判回来没过的在当前这道做完时插进来。
- 判出没过：列出没过的每一项（构造是那一条自己的话，要点是「没写到：要点原文」）→ 你写的 teach → 下一道 retry；做对算补上，又错接着下一道，retry 用完记没吸收。「蒙的」做对也出一道 retry 确认。拿不准的（`unsure`、超时、作废）不补讲、不出 retry，待你核。没有对上的 teach 时叫一次页面里的 Claude 写补讲：给它题、要点、你写的 teach、学生交的、没过的项和 `<<< >>>` 里你写的话；没写 `<<< >>>` 时默认的话是「指出错在哪、只补缺的那一点（不给整段答案）。」（你在任务书里写的那句）。它的话原样显示，记成证据 `src: helper, role: check`。
- 可选题：这一块必做都一次过、都「很确定」、没有在判的（写了 `fast=` 的还要第一次作答都在时间里）就跳过。限时只数第一次作答（题在屏幕上、页面在前台的时间）；过了 `limit` 交的记 `late`，做对最多算补上。
- 刷新、熄屏、切走回来照存着的进度接着做（`sessions/{编号}/check/{检验 id}`），看过没交的照旧算第一次（证据记 `resumed`）；「先停下」板放回来，那一块变成一条「接着做」；下课时还开着照「先停下」存着。没做完的块不写吸收。
- `ext_out`：开始一份「[页面] 检验 k1「…」开始（2 块、5 道必做、限时 15 分钟）」，做完一份：每块的吸收、每道题一行（第一次的作答、没过的项、retry、信心、用时）、手写的整页图和快照的 asset 编号和时间线、待你核的题、记没记错题。中途不一道一道写。
- 改判：任何一轮 `board judge target=题的 id`，块里一行一项（`m1 ok` / `m2 missing` / `if1 wrong why="…"` / `s3 wrong tag=…` / `m3 unsure`），加一行 `result=pass | fail` 改整道题。页面追加一条改判的证据（`rejudged: true`），重算那一块的吸收；待核的判成没过算「未」，它没用上的 retry 记进 `absorb.retryOwed`，复测先出。也可以直接写 `absorb/{块}`（第七节）。
- 做完的那一刻（不等学生点「回到黑板」）：每块写 `absorb/{块}`（第七节），排 1 天、7 天两次复测；最后没过的、「很确定却错了」的题各记一道错题（同一个 `target` 一次检验一道，能撤销）。

**外部设计的交互：`board stage`、`board widget`**（底座的完整清单在 `components/stage.md`、`components/widget.md`）：

- `board stage id=s1 title="…"`：块里是舞台的镜头指令（东西、交给学生的手、挑战、预写的反应），页面包成 `stage` 组件画在当前板上（一段一块舞台，没有老师、不调用）。学生每一下、挑战做到没做到、叫老师的事都记成作答 / 动作进 `ext_out`。外部的课里预写的反应除了 `@名字` / `.done` / `.right`，还收 `.wrong`（交了 / 动了但没做到）、`.miss`（走偏：被裁判判成错法、手势被弹回）；`.miss` 能按手势分（`@e.miss merge` / `expand` / `reorder`）、按原因分（`@e.miss why=noncommute` / `noparen` / `notlike` …），先找原因对得上的、再找手势、最后用不分的。没写 `height:` 的舞台照演完以后东西实际占的高。学生动过的舞台刷新以后放回刷新前的样子（页面把舞台的记录存在 `sessions/{编号}/stage_logs/{段 id}`，还在等的那一问照样挂着）；段的镜头指令改过（`board replace`、`board edit` 改了指令）就从头演，下面照旧列「刷新前的作答」。
- 判式子相等（`la.same`、舞台上 `tex … alg=on` 的合并 / 展开 / `equals=`）默认严：矩阵的式子里单独写的数不当 `kE`（`(A-E)(A-2E)` 和 `A^2-3A+2` 不相等，`A^2-3A+2E` 才相等），数 `0` 不当零矩阵 `O`；宽的判法自己开：`la.same(a, b, { loose: true })`、`tex e = "…" alg=loose`。展开出来只剩数的项写成 `2E`。
- `board widget id=w1 title="…"`：块里是一小段 JS，调用 `la.*`（画文字公式矩阵、拖着排、按钮、输入、精确计算、式子相等的判定、记作答、动画、给标注留锚点）。在这一段里跑：一上来就跑不起来（语法错、抛错）这一段不显示、像组件写错一样报；点按钮以后出的错记一条动作 `widget-error` 进 `ext_out`，只坏这一段。
- 两种都是一段：`replace`、`hide`、`edit`、`mark target=s1` 照常用；组件的 `id` 就是段的 `id`。

**学生这边**：页面写 `sessions/{编号}/ext_out/{三位数序号}` = `{ "seq": 1, "text": "…", "shots": ["asset 编号"], "at": 毫秒 }`：

- 什么时候写：学生作答、打字、用 Pencil 写字以后 1.5 秒合并写一条；页面切到后台（分屏切到 claude.ai）时马上写掉手上的。选择题判完（答对或放弃）才记一条，前面点错的选项写在那一条里。
- `text` 只写这一批新发生的：最前面是页面要报的（写错没显示的段和原因、没执行的指令、memo / note 没记成的、截图的说明）；然后是这一批的作答、草稿、学生打的字、助教和助手写的话；末尾一句指向 `meta/now`、`meta/since`。黑板现状不在 `ext_out` 里（在 `meta/now`）。
- 每一份只写到它那一刻为止；外部上一条 `ext_in` 以后的全部在 `meta/since`。

**解答题**（第三节 `solve`）：学生交了整道题，下一份 `ext_out` 里是 `[作答] … 交了整道题：打字：「…」；照片 2 张（asset …，用 read_asset 看）；等你一步一步判`。外部写 `board judge target=p1`（第四节），页面画出逐步的结论、记作答、有错的步记一道错题，`ext_out` 里接着一行 `[页面] 解答题 p1：错题本记了 L2-57（第 3 步（规则用错）…）` 或没记的原因。照片入口照 `board set upload=on`。

**写错了**：写错的那一段不显示，板上原样，下一份 `ext_out` 最前面写清是哪一段、哪一行、为什么；`board replace id=…` 改那一段。

**预检工具**（仓库 `emilymedina70167-creator/Claude` 里，给外部在自己的沙盒里用；`kit/dist/la-kit.js` 提交在仓库里，就是学习台发布的那一份，不用 build）：

```bash
git clone https://github.com/emilymedina70167-creator/Claude && cd Claude && npm install
node tools/ext-check.mjs --next 这一轮.txt --lint
node tools/ext-check.mjs --next 这一轮.txt --shots 截图目录
```

- `--lint`：不开浏览器，一秒以内只查写法——board 块的围栏和指令、组件名、组件 id 重复、指令的 `target` 存不存在（预备板里的组件也认）、`\calc` 算不算得出、`stage` / `widget` 段的写法、`derive` 的 `mode: do` 的 `start` / `goal` / `let` 读不读得懂、算不算得出（`E(2)` 这一类也查）、`solve` 的写法。
- `--lint` 还打出**出题提示**（只是提醒，不算写错、不影响退出码）：页面判得了对错的题没写预案（`react` 的 wrong / stuck / giveup）也没挂 `board claude`（「学生答错要等你」）；`quiz` 的正确选项比别的长得多、原样写在题干或这一段别的组件里；同一段里一道 `quiz` 的题干或选项原样写着前面那道要学生自己得出的答案（「这题能绕过前面那步」，只查原样出现）。
- 不带 `--lint`：用和学习台同一份组件库在真的浏览器里跑一遍，出 iPad 竖屏、横屏的截图和问题列表；这一轮的预备板（`board queue`）也照 `board new` 画一遍。开头打出组件库的版本号，和学习台底部的版本号对得上才是同一版。Playwright、Chromium 用沙盒里预装的。
- 都可以加 `--session 存数据的目录 [--sid 课号]`：这节课已有的 `ext_in` / `ext_out`（`ArtifactData` 的 `out_dir` 存下来的目录），认得已有的段和组件 id。`--session` 也可以是一个文件：每行一条 `{ "id": "sessions/{编号}/ext_in/001", "data": {…} }`，或者整个文件一个这样的数组（`id` 不是路径时写 `"coll": "ext_in"` / `"ext_out"`，或者照字段认：有 `done` / `after` 的是 `ext_in`）。

**平台的事实**（2026-11-17 实测）：外部每一轮第一次写学习台会弹一次「Allow once」，没有「一直允许」；同一轮里后面的写没再弹。删除要带 `shared_live: "deletes_rows"`。这一轮的记忆改动可以写在同一条 `ext_in` 的 `memo` / `note` 块里，页面拆出来执行。学习台叫不醒外部：claude.ai 的对话只在学生发消息时才跑，页面没有办法通知它（「叫主讲」只是让 `ext_out` 最前面写「学生在等你」，外部醒来一眼看到）；`board claude`、预案、预备板是页面当场接的办法。「Allow once」是 claude.ai 的权限设置，学习台改不了。

**改别的数据**（`meta/today`、`reviews`、`drills`、`notebook`……）：直接写，格式见第七节；写的时候在同一次写里多写一条 `journal/j-{毫秒时间戳的 36 进制}-{5 位随机}` = `{ "at", "by": "ext", "path", "op", "before", "after" }`，学生在「管理 → Claude 改过的」里看得到、能撤销。页面不拦外部的写，格式不对照存、在 `meta/health` 里照实报。

---

## 六、页面里的 Claude 和页面算的事实

页面调用的 Claude 只用 Opus 5.5（effort high）：平台回的模型不是它，那一次作废、不写。

- **练习教练**：`meta/today` 里 `kind: "coach"` 的一项（`{ "kind": "coach", "block", "why", "focus", "ids" }`）在首页画成一行，学生点开是一节页面里的老师带的课（`kind: class`），资料包里「主讲写的」那一节原样放着 `why`、`focus`、题号。
- **板边助教**：外部写了 `board coach target=… upto=…` 的那一题，学生被页面判错时，页面叫页面里的 Claude 写一句（中文，不超过 60 个字），接在当前板的最后，标「助教」。给它的只有：这道题在板上的原文、外部写的 `upto`、学生这次的作答。那一句进下一份 `ext_out`（`[助教] 在 q1 下面写了：…`）。
- **页面算的事实**（不调用 Claude，变了就重写）：`meta/facts` = `{ today, spaces: { math | cs | en: { due（到期的复现组 [{ id, title, days }]）, recall（要记的到期几条）, open（挂着没下课的课）, minutes7（这 7 天学了几分钟）, last（上一节） } }, health（体检拿不准的几条） }`；`meta/catalog` = `{ text }`（学习台里有什么）；`meta/mastery-calc`（按作答算的掌握参考）。

---

## 七、学习台：数据

学习台是**唯一的** artifact：说明书、组件写法、我的学习记忆（规则、弱点、错题、掌握、复现、当前位置……）、每一节课（实时黑板、课堂、自学单元）都在它里面。记忆放在它的数据库里：分好类，每一类有明确的负责人，结论都挂证据。你用 `ArtifactData` 读写它；页面打开时自己算复现到期、自检你写的东西守不守规矩，结果写回给你。

学习台现在有：记忆库（下面各类）；外部的课（第五节）；页面里的老师上的课（`kind: class`，练习教练开的也是它）；每节课的作答、说的话都进证据（`evidence`），下课后页面算课后报告；练一练（`drills`）；要记的（`recall`）；教材、真题；笔记本（`notebook`）和项目指令（`meta/instructions`）。

### 学习台本身（你不用发布）

- 地址：https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo 。**整个学习过程只有这一个**，项目记忆里记着它。
- 页面（`mode: desk`）、`la-kit.js`、这份说明书、`components/*.md` 由开发那边维护：每次组件库更新，同一个地址重新发布一次，数据库、assets 都不动。**你不要发布、也不要重新发布它，更不要另外发布新的学习台、课件、黑板、课堂。**
- 它声明的能力：`sample`（课堂里的 Claude）、`db`（记忆和每节课）、`assets`（教材页、截图、板书原图）、`downloads`（首页「导出备份」）。
- 页面上我看得到：首页有**上课**（这一科到哪、开新课、没下课的课）、**今天**（照 `meta/today` 画；没写时只列到期的复现、要记的、留着的题）、**要记的**、**练一练**、**这一周**、**补记**、**笔记**页（`show` 的笔记）；「管理」页有项目指令、笔记本、Claude 改过的（能撤销）、给开发的、备份、自检。
- **复现课**：首页「今天复现」不分科列出每门课到期的复现组，按我的规则先挑 3 组（从没复现过 > 上次没过 > 过期久），点「复现这 3 组」（或者排着的某一组「只复现这一组」）：页面自己拼这节课的资料包（`sessions/{编号}/pack/main` 的 `review` 是复现组编号的数组，带着每组的内容、盯的弱点、相关错题原文、以前同一块的题和那几节课的一页），不用你备课。`sessions/{编号}` 也记着 `review`。下课整理单里课堂里的 Claude 每组写一行 `review id=… result=过 / 没过`，档位跟着变（不对我能撤销）。
- **要记的**：首页一张卡，各科到期的记忆点（`recall`）混在一起，一次最多 20 条，先写再看答案、我自己点想没想起来，不调用 Claude（见第七节「复现和要记的」）。

### 规矩（照这个写，页面会查）

- **一类一个集合，不混放。**一个事实只写在它所属的那一类，别处用 id 指过去，不重抄。
- **每一类只有一个写入方**（2026-11-03 起，「你」指开发那边修数据；平时都是课堂里的 Claude 写）：

| 集合 | 装什么 | 谁写 |
|---|---|---|
| `rules` | 规则：项目指令全文（红线、掌握的定义、检验题三条、来源分工、讲解交付）、执行细则、教法偏好、黑板写法 | 课堂里的 Claude 在我定下或改了规则时直接写（要有依据：我说的那句话），能撤销 |
| `profile` | 和教学有关的我（目标、术语附英文、用 iPad 和 Notability……），不放生活信息 | 课堂里的 Claude（新的、改说法、并掉重复的）；我在学习台上能改文字 |
| `asks` | 我的要求：我说过要老师以后怎样的（要求、纠正、期望），原话页面从证据抄，删课也不丢 | 有记忆摘要以后不再往里写（话的账停了；老师写的 `ask` 记成摘要的新笔记）。以前：话的账、课堂里的 Claude（memo 的 `ask`） |
| `notebook` | **笔记本**（2026-11-17 起，第十四轮）：项目 Claude 自己的长期记忆，一个文件一条（`path`、`text`、`pin` 每一轮整份放进它的说明、`show` 出现在学生的「笔记」页、`order`、`v`、`history` 最近 20 版、`quotes` 引号在记录里没找到的几句）。写什么、怎么分由它定 | 外部主 Claude（`ext`）、页面里的老师（课上的 `board note` 块）、夜班；我在「管理 → 笔记本」里看、改、退回 |
| `dev_requests` | **给开发的**（第十四轮）：学生让改、要改页面代码才做得到的事，一件一条（`at`、`by`、`text`、学生的原话 `quote`、`status` 只能是 `open` / `design` / `done`；`design` 是还没定的设计稿或任务书草稿，审过改成 `open` 开发才做）。开发那边每次开工先读 | 项目 Claude（课堂老师、班主任、课后那一轮）；我在「管理 → 给开发的」里看、删 |
| `journal` | **Claude 改过的**（第十四轮）：项目 Claude 的每一次写一条（`at`、`by`：`ext`（外部主 Claude）/ `class` / `head` / `night` / `me` / `page`（以前还有 `after`、`organize`）、`path`、`op`、`before`、`after`），编号 `j-{毫秒时间戳 36 进制}-{5 位随机}`；撤销就是把 `before` 写回去 | 页面（`write` 工具、`board note`）；每晚的那一次自己写；我在「管理 → Claude 改过的」里撤销 |
| `meta/instructions` · `meta/today` · `meta/mastery-calc` | 我写的项目指令（`text`）；首页「今天」照着画的那一份（`{ date, note, items: [{ kind: class / review / drill / recall / later / coach, why, label, block, ids, reviews, focus }] }`，`date` 不是今天时只列事实）；页面按作答算的掌握参考（`{ at, rule, items: [{ target, state, tier, reason, basis }] }`，`mastery` 本身页面不改）。复现组（`reviews`）写了 `due`（YYYY-MM-DD）首页按它算到期，那天以后做过了（`last` 不早于 `due`）照 `last` + `tier` | 指令我写；`today` 外部主 Claude 写（夜班照它的计划也写）；`mastery-calc` 页面算 |
| `summary` | **记忆摘要**（2026-11-16 起，照 claude.ai 项目的记忆）：老师对我的了解是一份会重写的摘要，四条：`shared` 三科共用、`math`、`cs`、`en`。上课的老师每一轮带着共用的和那一科的，当背景，不是规矩。**有了它，上面的规则、关于我、要求和下面的守则、失误不再发给上课的老师**（数据都留着） | 页面每节课后在后台把这节课并进去、整份重写；课堂里的 Claude 当场记新笔记（memo 的 `know`）；我在「管理 → 记忆摘要」里看全文、直接改、退回上一版 |
| `curriculum` | 课程地图：讲 → 节 → 块，每一块的范围、详略、考试口径、文稿要点、原文段落、教材页、依赖 | 你，备课时 |
| `evidence` | 证据：我在板上的每一个动作（作答、预测、拖动、揭开、放弃），在课堂输入框里说的话、附的图，下课时没交的草稿，首页补记的 | 页面自动写，只增不改 |
| `observations` | 课堂里的 Claude 当堂的观察、提议、下课小结 | 课堂里的 Claude（页面替它写进来） |
| `errors` | 错题档案 | 课堂里的 Claude 直接写，只增不改（同一道题不记两次）；我能撤销、标「已解决」（加一条更正） |
| `weaknesses` | 弱点表 | 课堂里的 Claude 直接写（新弱点、证据级、合并重复的）；我能撤销 |
| `mastery` | 每一块、每个知识点的掌握状态 | 页面按证据算了直接写（`by: page`），能撤销。**课堂不能宣布掌握** |
| `reviews` | 复现组 | 课堂里的 Claude 直接写（判结果、加题、新组、合并）；我能暂停、撤销；到期日页面算 |
| `position` | 当前位置：学到哪、欠账、下一节从哪接 | 课堂里的 Claude，下课时写；我能撤销 |
| `slips` | 教学失误（一次次的经过） | 课堂里的 Claude 记它自己的（以前对话里的 Claude 记的也在） |
| `lessons` | 教学守则：失误归纳出来的「下次照着做」，一件事一条，可以改写、合并 | 课堂里的 Claude（上课时记「又犯一次」，下课时把这节课的失误并进来）；我能改 |
| `sessions` | 每节课（课堂、实时黑板、自学单元）：日期、哪一种、哪一块、开课时的资料包、核验了几轮、小结 | 课堂：页面（我点「开新课」时开，上课、下课时更新）；实时黑板、自学单元：你开、你写「用完了」（我点「用完了」时页面写） |
| `recall` | 记忆点：要背的一条（定义原文、结论、表里的一格、句型……），一条一条按 1 → 3 → 7 → 14 → 30 天排，我每天在首页自己想一遍（见下文「要记的」） | 课堂里的 Claude 直接写（memo 的 `recall`）；我能自己加、停掉；每天想的结果页面写 |
| `drills` | 题库：以前课上页面判得了分的题，练一练用（见下文「练一练和题库」） | 页面（下课时抄）；你备课时也可以写；我能标作废 |
| `absorb` | 吸收：每块一条，学完以后的检验（`board check`，第四节）判出来的「吸收成功 / 部分 / 未 / 待核」，和掌握分开记（见下文「检验：`absorb`、`probes`」） | 页面照最新一次检验写（`checked: false`，待你核）；你核过写 `checked: true` |
| `probes` | 检验题库：`board check` 里的每道题（含 retry、spare），复测从没见过的同类题里挑 | 页面（执行 `board check` 时存）；你和夜班也能直接写题 |
| `pending` | 改动单：课堂里的 Claude 每一条要改记忆的、我在学习台上自己改的，都先记一张（见下文「改动单」） | 页面（替课堂里的 Claude 和我写），只读 |

- **历史类只增不改**（`evidence`、`errors`、`observations`、`slips`）：写错了就追加一条更正（新编号，`corrects` 指向原条），原条不改、不删。页面记着每条的指纹，改了、删了会在自检里报。
- **状态类**（`weaknesses`、`mastery`、`reviews`、`recall`、`position`、`lessons`，还有 `rules`）可以改，但**每次改都在这条的 `log` 里追加一条**：`{ "date": "2026-10-27", "by": "chat", "field": "level", "from": "L1", "to": "L0", "basis": ["ev-…", "L2-07"], "note": "…" }`。`by` 是 `chat`（你）、`class`（课堂里的 Claude；我点「确认」写进去的也记 `class`，`note` 写「我确认于 …」）、`page`（页面）或 `me`（我在学习台上改的、撤销的）。改了 `level`、`state`、`tier` 这类字段却没记 log，自检会一直报，直到补上一条 `to` 是新值的 log。
- **结论必须挂证据。**掌握状态（`未学` 以外）写 `basis`，弱点挂 `errors`（或 `basis`）；改证据级、改掌握状态的那条 log 也写 `basis`。依据是证据、错题、检验记录的 id；从旧记录迁移来的写成文字，比如 `"旧记录：第2讲检验记录 T3"`。没有依据的结论不写。
- **日期一律 `YYYY-MM-DD`**（我这边的日期）。
- 写法：一次的改动用一次 `batch`（我只点一次允许）。新的一条 `set`；改已有的一条先 `get` 拿到 `version`，再带 `if_version` 用 `update`（`log` 是数组：读出来、在末尾加一条、整个写回去）。
- **写完让我打开学习台**（开着就不用），页面自检后读 `collection: "meta"`，`doc_id: "memcheck"`（见下文）。有错就改，改完再读一次。

### 每一类的字段

下面的例子照抄就能用（字段名、取值都是页面认的）。可选的字段不写就是没有。

**`rules`**：`doc_id` 像 `rule-01`、`rule-redline-3`。`cat` 分类（红线 / 掌握 / 检验 / 来源 / 讲解 / 细则 / 教法 / 黑板）、`text` 正文、`since` 定下的日期、`source` 来源（我哪天说的）、`status`：`active` 或 `void`（作废的不删，写 `voidedBy` 指向取代它的那条，或者 `note` 写为什么）。
- `for`（给谁看）：`class` 只给课堂里的 Claude、`chat` 只给你（备课、写记录、读材料这类，课堂里用不上）、`both` 两个都要（不写就是 `both`）。课堂里的 Claude **每一轮都带着全部 `class` 和 `both` 的规则全文**，每一条都要额度，所以只给你的规则标上 `chat`。拿不准的不标。
- `space`（只管一科时写）：`math` / `cs` / `en`。不写就是全科共用；408、英语的课不带只写了 `math` 的规则。
- `use`（什么时候带，可以不写）：`teach` 讲课的每一轮都带（不写就是 `teach`）；`record` 是管记录和复现的规则（错题怎么记、复现怎么算这类），讲新课时用不上——黑板课的老师只在下课那一次和复现课里带着，备课、事后补写时也带。拿不准的不标。

```json
{ "rules": { "id": "rule-01", "cat": "红线", "text": "课堂不能宣布我掌握了：掌握由页面按证据算、我确认。", "since": "2026-10-20", "source": "我 2026-10-20 在对话里定的", "status": "active" } }
```

**`profile`**：`doc_id` 像 `p-goal`。`topic`、`text`、`since`、`status`：`active` / `merged`（并进了别的一条，写 `into`：关于我的另一条，或我的要求 `A-…`）/ `void`。只记关于我的事实（设备、底子、目标、什么讲法对我有用）；对老师的要求写进 `asks`。只关于一科的（408 的讲法、英语的基础）写 `space`，或者编号带科目：`p-cs-…`、`p-en-…`（`p-math-…`）。课堂只带这一科的和不分科的。

**以前一条条存的记忆**（`rules`、`lessons`、`asks`、`profile`、`slips`、第十三轮的记忆摘要 `summary`）：数据都留着，页面不再往里写、也不再重写摘要；要查以前定过什么就读它们。

**`summary`**（记忆摘要）：`doc_id` 是 `shared` / `math` / `cs` / `en`。`text`（摘要全文，Markdown；`shared` 最多 4096 字节，每科 8192 字节）、`v`（第几版）、`at`、`by`（`page` 课后重写的 / `me` 我改的 / `chat` 开发写的 / `lab` 教研室补收尾时记的新笔记）、`notes`（还没并进摘要的新笔记 `[{ text, quote, at, by, session }]`，下一次重写并进去）、`history`（以前的版本，最近 8 版）。写的是事实、我的原话（带日期和当时的情形）、有证据的经验；**不把我的一句话推广成规矩**。开发那边要改，照这个格式整条写（先读最新的，`v` 加一，旧的 `text` 放进 `history` 头上）。

**`asks`**（我的要求）：`doc_id` 像 `A-1`。`text`（一句话写清要求）、`quotes`（我的原话 `[{ ev, at, session, text }]`，页面从证据抄，不重打）、`scope`：`all` / `math` / `cs` / `en`、`measure`（页面能直接量的：`overlap` 画面重叠）、`status`：`active` / `replaced`（被改口换掉，写 `into`）/ `dropped`（我说不用了，写 `why`）/ `void`、`since`、`checks`（之后每节守没守）、`broken`（犯过几次）。对话里的 Claude 不直接写这一类：照我的原话记要求是页面的话的账在做。

```json
{ "profile": { "id": "p-lang", "topic": "术语", "text": "在美国读大学：术语第一次出现时附英文。", "since": "2026-10-20" } }
```

**`curriculum`**：编号就是层级：`L2`（讲）、`L2.2`（第 2 讲第 2 节）、`L2.2.1`（这一节的第 1 块）。`level`：`lecture` / `section` / `block`（和编号的层数对得上），`title`，`parent`（上一级），块还写 `scope` 范围、`depth` 详略、`exam` 考试口径、`points` 文稿要点（按视频顺序的数组）、`transcript` 文稿原文段落、`textbook`（`[{ "ref": "教材 p.35", "text": "原文", "image": "asset id" }]`）、`boards` 板书截图的 asset id、`requires` 准入依赖（块的编号）。

```json
{ "curriculum": { "id": "L2", "level": "lecture", "title": "第2讲 矩阵" } }
```

```json
{ "curriculum": { "id": "L2.2", "level": "section", "title": "§2 秩一方阵", "parent": "L2" } }
```

```json
{ "curriculum": { "id": "L2.2.1", "level": "block", "title": "行成比例 → 秩一", "parent": "L2.2", "scope": "认出秩一方阵，写成 αβᵀ", "depth": "重点，例题两道", "exam": "小题：直接写出 Aⁿ", "points": ["先看行成比例", "拆成 αβᵀ"], "requires": [] } }
```

**`errors`**：编号沿用 `L2-07`、`L2-T03`（第几讲 - 第几题，T 是检验题）。`source` 出处、`q` 题面、`mine` 我怎么答的、`step` 错在哪一步、`cause` 根因、`weakness` 挂哪个弱点、`block`、`evidence` 证据 id（数组）、`date`。解答题判出来的还有 `steps`（全部逐步结论）、`tag`（错法）；书上的题还有 `book`（同证据里的写法），编号照块，没选块照门课和章（线代第 2 章 `L2-nn`、高数 `HM-L2-nn`、概率 `PS-L2-nn`）。`drills` 也收 `book`：外部出题写上就能对上同一道书题。`meta/state` 的作答行里，学习台建好以后记的、没有原始作答的错题写「错题本（没有原始作答）」（那天有这一科的课的挂上课号），学习台以前的写「旧记录」。更正：新的一条，`corrects` 写原来的编号。

```json
{ "errors": { "id": "L2-07", "source": "第2讲例2.1", "q": "求 A²，A = αβᵀ", "mine": "写成 ααᵀββᵀ", "step": "第 1 步：换括号", "cause": "没看出 βᵀα 是一个数", "weakness": "W19", "block": "L2.2.1", "date": "2026-10-21" } }
```

**`weaknesses`**：编号 `W19`。`title` 错了哪一类、`scope` 影响面：`通用` / `链条` / `局部`、`level` 证据级：`L0` / `L1` / `L2` / `L3`、`last` 最近一次、`errors` 挂的错题、`blocks` 相关的块、`status`：`active` / `closed` / `merged`（并进了别的一条，写 `into`，摘要和页面都不再带）、`log`。

```json
{ "weaknesses": { "id": "W19", "title": "内积和外积分不清", "scope": "链条", "level": "L1", "last": "2026-10-21", "errors": ["L2-07"], "blocks": ["L2.2.1"], "status": "active", "log": [{ "date": "2026-10-21", "by": "chat", "field": "level", "from": null, "to": "L1", "basis": ["L2-07"] }] } }
```

**`mastery`**：编号是块（`L2.2.1`），或者块里的一个知识点（`L2.2.1#tr`）。`state`：`未学` / `讲过` / `基础题过` / `复现通过` / `掉了`；`复现通过` 时 `tier` 写到了第几档；`basis` 依据；`log`。

```json
{ "mastery": { "id": "L2.2.1", "state": "基础题过", "basis": ["旧记录：第2讲检验记录 T1"], "log": [{ "date": "2026-10-21", "by": "chat", "field": "state", "from": "讲过", "to": "基础题过", "basis": ["旧记录：第2讲检验记录 T1"] }] } }
```

**`reviews`**：编号 `R3`。`title`、`family` 机制族、`content` 组内容、`weaknesses` 盯哪些弱点、`blocks`、`tier` 档位（天）、`last` 上次做的日期、`result` 上次的结果、`status`（停掉写 `done`，并进别的一组写 `merged` 和 `into`）、`log`。**不写到期日**（见下文）。

```json
{ "reviews": { "id": "R3", "title": "秩一：拆 αβᵀ、求 Aⁿ", "family": "结合律换括号", "weaknesses": ["W19"], "tier": 3, "last": "2026-10-24", "result": "过", "log": [{ "date": "2026-10-24", "by": "chat", "field": "tier", "from": 1, "to": 3, "basis": ["旧记录：复现 R3 第 2 次"] }] } }
```

**`recall`**：编号 `K12`（页面编）。`q` 问法（一条只问一件事）、`a` 标准答案（写成我能对着检查的样子）、`block` 挂哪一块、`space`、`tier` 档位（天）、`last` 上次想的日期、`result` 上次的结果（`got` 想起来了 / `vague` 模糊 / `miss` 没想起）、`lapses` 没想起过几次、`status`（`active`；隔 30 天还想得起来页面改成 `done`，记牢了；不用记了 `void`）、`session` 哪节课记的、`log`。**不写到期日**（和复现组一样，`last` + `tier`）。

```json
{ "recall": { "id": "K3", "q": "直接插入排序稳定吗？", "a": "稳定：相等的元素不往前插", "block": "L2.2.1", "space": "math", "tier": 3, "last": "2026-10-24", "result": "got", "lapses": 0, "status": "active", "log": [{ "date": "2026-10-24", "by": "page", "field": "tier", "from": 1, "to": 3, "basis": [], "note": "我自己想了一遍：想起来了" }] } }
```

**`position`**：只有一条，`doc_id` 是 `now`。`block` 学到哪一块、`next` 下一节从哪接、`debts` 欠账（数组）、`first` 下一节先收的题（数组）、`log`。

```json
{ "position": { "id": "now", "block": "L2.2.1", "next": "先收 L2-07 的同类题，再推 Aⁿ", "debts": ["§2 的检验题第 3 题没做"], "first": ["L2-07 同类题"], "log": [] } }
```

**`slips`**：编号 `S-` 开头（比如 `S-1027-1`；只关于一科的写 `space`，或者编号带科目：`S-0922-ds1`、`S-0828-en1`）。`by`：`chat`（你的）/ `class`（课堂里的 Claude 的）/ `lab`（每晚的教研室事后补的）/ `aide`（课后助手对着整节课的记录写的）/ `head`（学习台首页上的班主任写的）、`date`、`text` 失误、`lesson` 以后怎么做、`session`（哪节课，第 2 批起有）。

```json
{ "slips": { "id": "S-1027-1", "by": "chat", "date": "2026-10-27", "text": "一次写了五块板，没等我答就往下讲。", "lesson": "一块板一件事，等作答再写下一块。" } }
```

**`lessons`**（教学守则）：失误不再一条条往上堆，而是归纳成守则，课堂里的 Claude 每一轮带着**守则**和**还没归纳的失误**，已经归纳进守则的失误不再带。编号 `T-` 加数字（`T-3`，页面自动编；只关于一科的写 `space`）。`text`：下次照着就能做的动作，带上判断的时机（「出一组题之前，逐题列出要用到的规则，没讲过的先讲完」），不写「注意」「小心」；`why` 根因；`topic`（可选：出题、讲解、板面、判分……）；`slips`：归纳进来的失误编号；`hits` 犯过几次；`recent` 最近几次又犯的经过；`since`、`last`；`status`：`active` / `retired`（并进了别的一条写 `into`，不用了写 `retiredWhy`）/ `void`；`log`（改 `text`、`status` 要记）。
- 课堂里的 Claude：又犯了一条写 `lesson id=T-3 again="…"`（不另记失误），新的失误才记 `slips`；下课时整理单最后把还没归纳的失误全部并进守则（并进已有的一条时把它改写得更能照着做；意思重复的合并），**一科最多 20 条**，到了上限页面不收新的，要先合并；和已有的一条几乎一样的新守则页面也不收。
- 你整理时一样：新失误先看能不能并进已有的守则，改写那条（`text` 改了记 log），`slips` 里加上失误编号，`hits` 加上。

```json
{ "lessons": { "id": "T-1", "text": "出一组练习之前，逐题列出每道题要用到的规则，没讲过的先讲完；讲不了的那道不出。", "why": "边讲边出题，题目用到了没讲的规则，学生撞墙后才补", "topic": "出题", "slips": ["S-1027-1"], "hits": 1, "since": "2026-11-02", "last": "2026-11-02", "status": "active", "log": [] } }
```

**`observations`**（课堂里的 Claude 写，页面替它存）：`kind`：`note` 观察 / `summary` 下课小结 / `proposal` 提议 / `todo` 待办（课上被问到教案以外的内容，`status`：`open` / `done`，备课时补上就标 `done`）、`text`、`about`（相关的编号）、`block`、`session`、`turn`（第几轮记的）、`at`。下课小结还有 `verify`（这节课平台核验是 Opus 5.5 的轮数、作废的轮数）。**`evidence`**、**`sessions`** 由页面写，你只读（见下文）。

**`exam`**（考试档案，只有一条 `target`；页面第一次打开时写一份默认，我在「管理 → 考试」改，你修数据时也能写）：`school` 学校、`code` 学校代码、`dept` 院系、`alt` 也在考虑的院系、`major` 专业、`majorCode` 专业代码、`degree`：`学硕` / `专硕`（没定写空的）、`subjects` 考哪几门（`["101", "201", "301", "408"]`）、`full` 每门满分、`goal` 总分目标、`split` 四科各给多少（`{ "math": 130, "cs": 135, "en": 75, "pol": 70 }`）、`date` 初试第一天、`reserve` 留作模考的卷的年份（`null` 是默认的最近三年）、`lines` 历年分数线（每条带 `src`）、`log`。410 分的进度、距考研天数都读它。

**`exam_bar`**（真题级，页面算的，每块一条，编号就是块的编号）：这一块做过哪几道真题、对没对、过没过、踩过哪些坑，`at` 算的时间。你只读。

### 教材和资料：`books`（页面写，你读）

我的教材 PDF（扫描版也行）、截图、视频课文稿（Word）、讲义（PowerPoint）在学习台「教材」页导入：页面只存原页图（扫描页的转写在外面做：你、Claude Code 或 Codex 转好写回来，见下面「帮我转教材」），文稿和讲义里的字页面自己取，都切成一条一条存着（docs/textbook-plan.md）。**以后要教材原文先来这里找**，不用再读项目知识库里的 PDF。

- `books/{B1}`：一本资料（`title`、`kind`：`textbook` / `transcript` / `slides` / `notes`、`space`、`status`、`toc` 章节目录、`chunks` 条数）。
- `books/{B1}/chunks/{B1-23.1}`（`collection: "books/B1/chunks"`）：一条（`kind` 定义 / 定理 / 例题 / 说明……、`title`、`chapter`、`section`、`page`、`text` 原文（Markdown + LaTeX）、`img` 原页图的 asset id、`checked` 我核对过）。编号是「从第几页开始的第几条」。
- 课程地图的块用 `chunks` 字段挂条目编号（`["B1-23.1", "B1-24.1"]`）：我在学习台上「挂到课程地图」（页面让 Claude 提、我确认）；你备课时也可以写。
- 首页的备课（「让 Claude 备课」）第十四轮拿掉了。资料包 `pack/main`、`pack/problems` 的字段照旧（页面里的老师开课时读这一科的 `pack/main`；练习教练的课页面自己拼，见第六节）。
- 课堂里的 Claude 取教材一次取够：`textbook_read` 能写编号范围（`B1-10.1~B1-17.3`）或书页（`pages: "10-17"`）。

#### 帮我转教材（我说「转 B3 第 82–91 页」）

学习台里的 Claude 不转写扫描页，我会让你转：项目知识库里有这本书的 PDF。

1. **先确认你真的看得到那几页的原图**：说一句第 82 页开头写的是什么。如果你拿到的只是知识库检索出来的零碎文字、看不到整页，直接告诉我，**不要凭印象补**，我换别的办法转。
2. **照原页逐页转写**，规矩：忠实（不总结、不改写、不补充、不纠正原书；每个数字、符号、上下标照原页；看不清写【看不清】，不猜）；公式 LaTeX（行内 `$…$`、单独成行 `$$…$$`，正文的字不放进 `$`），代码照原样保留缩进；按内容切成条，类型只能是定义、定理、性质、推论、公式、例题、习题、方法、说明、图表（例题连解答、定理连证明在一条，一段讲解一条「说明」）；章节标题单独一行，类型写「标题1 / 标题2 / 标题3」；名字照书上的编号（「例2.1」「01.【解答】」），说明写十个字以内讲什么；跨页那条下一页开头写同一个名字，行末 `| 接上页`；图写「图表」一两句话说画了什么，表格用 Markdown 表格；页眉、页脚、页码、水印不要；空白页只写 `=== 第 N 页`。「第 N 页」是 **PDF 的第几页**，不是书上印的页码。
3. **写进学习台的收件箱**，一次最多 10 页一条：`collection: "book_inbox"`，`doc_id: "B3-082-chat1"`（书号-起始页-随便一个后缀，每次不一样），`data: { "book": "B3", "by": "chat", "text": "=== 第 82 页\n--- 标题2 | 2.3 线性表的链式表示\n--- 定义 | 单链表\n线性表的链式存储……\n=== 第 83 页\n--- 定义 | 单链表 | 接上页\n……" }`。学习台里还没有这本书时加 `"info": { "title": "书名", "kind": "textbook", "space": "cs", "subject": "数据结构", "pages": 总页数 }`。
4. 我打开学习台时页面读懂、并进各页、拼成条目（还没有原图的页以后我「存进学习台」时补图），回执写在 `book_inbox_log/{同一个 doc_id}`：`pages` 读到了哪几页、`gaps` 中间缺的页、`unclear` 有【看不清】的页、`error` 没读懂。下一批之前先 get 一下回执，有缺的补上。
5. 一次对话转一二十页就换新对话接着转（转得越多，这个对话每一轮越贵、越慢）。

### 考试的资料：真题、考点（页面写，你读）

不在记忆库里（四门课十五年的题太多，开课时页面只按门课读，docs/exam-plan.md）：`syllabus/{G-DS-6.4}` 考点（大纲的一节）、`papers/{X-408-2019}` 一套真卷（`reserve: true` 是留作模考）、`questions/{Q-408-2019-23}` 一道真题（`tags` 标签、`verified` 答案怎么核过的）、`passages/{PA-201-2020-T1}` 英语的一篇、`exam_profiles/{G-DS-6.4}` 考点的画像、`exam_intel/{ix-…}` 考情动态。都由页面写（开发那边用 `tools/exam.mjs` 切好写进收件箱 `exam_inbox`，页面查过再并进来，回执在 `exam_inbox_log`）。**留作模考的卷**：题面、答案不出现在课堂、备课、练一练里，教材里带着那几年统考标记的条目页面也剔掉了，你也别拿它们出题。

### 分科：数学 / 408 / 英语

学习台里分三个空间：**数学**（`math`，现在是线代）、**408**（`cs`：数据结构、操作系统、组成原理、计网）、**英语**（`en`，考研英语一的语法）。我在学习台顶上切换，每科有自己的课程地图、下一节从哪接、资料包、错题本这些页面；「关于我」（`profile`）、规则（`rules`）、两个 Claude 的教学失误（`slips`）、统计、备份全科共用。

- **课程编号带门课的前缀**：线代不带（`L2.2.1`，以前写的都是线代，不用改）；数据结构 `DS-`、操作系统 `OS-`、组成原理 `CO-`、计网 `CN-`、英语 `EN-`，比如 `DS-L2.1.1`、`EN-L1.1.1`、掌握状态 `EN-L1.1.1#past`。错题跟着前缀：`DS-L2-03`、`EN-L1-02`（编号照旧是「第几讲 - 第几题」，各门课各编各的）。页面按前缀认是哪一科、哪门课。
- **弱点、复现组**的编号全科共用一套（`W19`、`R3`）；页面按它挂的块、错题看是哪一科。分不清时写上 `space`：`math` / `cs` / `en`。
- **下一节从哪接**每科一条：`position` 的 `now`（数学）、`now-cs`（408）、`now-en`（英语）。
- **资料包**每科一份：数学是 `pack/main`、`pack/problems`，408 是 `pack/main-cs`、`pack/problems-cs`，英语是 `pack/main-en`、`pack/problems-en`。备哪一科的课就写哪一份，`block` 写这节课的块（带前缀），我在那一科的首页点「开新课」。
- **课堂按块的门课上**：`block` 是 `DS-…` 的课，课堂里的 Claude 带数据结构的组件说明和计算机的教法；`EN-…` 的带英语组件（`cloze`、`errfind`、`parse`、`drill`）和英语的教法。`sessions/{编号}` 记着 `space` 和 `subject`。
- **英语的课程地图**照我给你的语法书和视频课的章节建（`EN-L1` 第 1 章，`EN-L1.1` 第 1 节，`EN-L1.1.1` 一块），块的 `scope` 写这块的语法点和考研英语一的考法，`points` 写要点，`textbook` 放书里的规则原文和例句。

### 每节课和证据（证据页面写，你读）

- **`sessions`**：编号 `c-20261027-1`（日期 - 当天第几节，三种课共用一套编号）。`kind`：`class` 课堂（黑板课，不写 kind 就是它；页面开，2026-11-16 起新开的课都是它。这种课有 `aims`：这节课要拿下的 2～5 件事 `[{ id, can, proof?, exam? }]`，老师课上定、页面按我的作答算每件到了没有，状态在课后报告的 `aims` 里；下课后页面留几道隔天做的题 `holds: { ids, at, exam, made }`，我隔天在首页「验上次学的」做完以后记 `later: { n, right, days, far }`——这三个字段都是页面写的，你不要改）、`stage` 舞台课（2026-11-06 到 11-15 新开的课是它：用画面讲课，每一轮的 `class_turns` 带 `log`，作答的组件 id 是 `S5` 这种；不再新开）和 `talk` 一问一答（更早的课，不再新开）、`ext` 外部的课（外部主 Claude 开、讲，第五节；`sessions/{编号}/ext_in`、`ext_out`）、`live` 实时黑板、`unit` 自学单元（停用了，以前的能翻看）。`date`、`block`（这节课的块）、`space`、`title`、`status`（`open` 还在上 / `closed` 下课了、用完了）、`startedAt`、`endedAt`、`pack`（开课时资料包的 `unit`、`goal`）、`verify`（核验了几轮、作废了几轮）、`summary`（下课小结那条观察的 id）、`usage`（这节课调用 Claude 花了多少：每一轮的 `cost` 在 `class_turns` 上）、`report`（课后报告的要点：`line` 一行字、`items` 做了几题、`first` 一次对几题、`at`、`v`、`provisional`）、`skills`（知识点归类，第七节「课后报告」后面）。这节课的东西都在 `sessions/{编号}/` 下面（课堂：`steps`、`class_turns`、`class_pages`、`pack`；实时黑板：`steps`、`talk`、`ops`、`ops_done`、`meta`、`lint`、`uploads`；自学单元：`unit`；三种都有课后报告 `report`）。
- **`evidence`**：编号 `ev-…`，页面自动编。每条都有 `session`、`block`（这节课的块）、`tags`（知识点标签：`["L2.2.1", "L2.2.1#tr"]`，后一个来自课堂里的 Claude 给那一段标的 `point=`）、`kind`、`src`、`at`：
  - `src: "record"`：一次作答。`kind` 是组件（`answer`、`practice`、`quiz`、`predict`、`steps`、`conjecture`……），`comp` 是组件的 id，`step` 是黑板上的段，`q` 题面，`text` / `value` 我写的、选的，`ok` 程序判的对错（判不了是 null），`attempts` 第几次，`ms` 用时（课堂里：这题出现在我屏幕上到第一次交，切走、锁屏、翻到别的板、滚出屏幕的时间不算），`msTotal`（到这一次交，同样扣掉不在屏幕上的），`giveup` 想不出来，`final` 这道题的最终结果，`images` 手写原图，`transcript` 转写。解答题（`kind: "solve"`）：交的那一条 `value` 是打的字、`photos` 是照片的 asset id；判了的那一条 `judged: true`、`by`（`ext` / `helper` / `teacher`）、`steps: [{ id, ok: true | false | "missing" | null, unsure, why, tag }]`（`unsure: true`：判的人拿不准，待核，不进错题本）。
  - `src: "event"`：一个动作。`kind` 是 `reveal`（揭开一步）、`giveup`、`drag`（拖动，`detail` 里是变量、松手时的值、`from` 从哪拖起、`path` 中途停过 0.5 秒以上的点（最多 8 个）、`ms` 拖了多久）、`guess-drag`（`predict` 里拖猜测点，还没点「确定」，同样带过程）、`sure`（我点的「有把握 / 没把握」，`detail.sure` 是 true / false，`detail.key` 是课后报告里那道题的键，`detail.ok` 那题判的对错）、`open`（打开）、`end`（下课）等。
  - `src: "say"`：我在课堂输入框里说的话（`kind: "say"`，`text`），在实时黑板上「交截图」交的图和那句说明，附的图（`kind: "photo"`，`images` 是 asset id，用 `Artifact` 工具 `action: "read"`、`path` 填 id 看原图；`ink: 2` 表示最后 2 张是我在黑板上用 Pencil 写的板书导出的图）。`turn` 是课堂第几轮。
  - `src: "draft"`（`kind: "draft"`）：点「下课」那一刻我在黑板上写了、还没交的草稿：`comp` 组件 id、`compKind` 组件、`step` 段、`label` 第几步、`text` 写着什么。
  - `src: "manual"`（`kind: "manual"`）：我在学习台首页「补记」的，学习台外面做的（纸上、Notability、和你的对话里）：`text`、`images`（截图）、`block`（挂到哪一块，可能没有）、`verdict`：`对` / `错` / `不会`（没标就没有；`ok` 跟着是 true / false / null，`不会` 还有 `giveup: true`）。没有 `session`；下一节课的课后报告的 `manual` 里会列出来。
  - `src: "book"`（`kind: "book"`）：我在首页「记书上的题」记的纸上做的题，一题一条：`book: { title, part, subject, ch, no }`（「张宇 1000 题 / 基础篇 / 线代 / 第 2 章 / 第 15 题」）、`verdict`：`对` / `错` / `拿不准` / `没做出`（`ok` 跟着是 true / false / null / false，`没做出` 还有 `giveup: true`，`拿不准` 还有 `sure: false`）、`text` 一句话、`images` 照片（附在错的、没做出的那几道上）、`block`（我选了才有，没选的等你归块）。错的、没做出的同时进错题本（见 `errors`）。书单是默认的「张宇 1000 题」（基础篇 / 强化篇 × 高数 / 线代 / 概率）加上 `meta/problem-books` = `{ books: [{ title, parts, subjects }] }` 里我加的。
  - 作答、动作、草稿的 `turn` 是它发生时课堂进行到第几轮（那时最新一轮的 `seq`），对照 `class_turns` 就知道它跟着哪一条发给了课堂里的 Claude。
  - 判断过没过、记错题时，`basis` 里写这些证据的 id。

### 课后报告：`sessions/{编号}/report/main`（页面写，你读）

我点「下课」、小结写好以后，页面用代码把这节课整理成一份（不调用 Claude，同样的证据算出同样的报告）。下课时没写成的（或者旧版下的课），我下次打开学习台首页时补写。读 `collection: "sessions/c-20261027-1/report"`，`doc_id: "main"`：

- `time`：`wallMs` 开课到下课、`activeMs` 去掉超过 10 分钟没动静的空档后的时长、`gaps` 几段空档。
- `totals`：`items` 做了几题，`first` 一次对、`ok` 改了几次后对、`wrong` 最后还错、`giveup` 想不出来、`revealed` 看了答案、`open` 程序判不了对错（猜想、自由写的）；`says` 说了几句、`photos` 附图几次、`drafts` 没交的草稿、`turns` 几轮。
- `items`：每道题一条（一个组件里分步的按步分开）：`comp`、`kind`、`q` 题面（截短）、`seg` 段、`page` 第几块板、`segTitle`、`tags`、`seq` 每次的对错（`✗✗✓`）、`attempts`、`outcome`（上面那几种）、`sure`（我点的有没有把握：true / false / null 没点；`totals.unsure` 是标了没把握的题数。**错了但有把握**多半是误解，**对了但没把握**不能算过）、`ms` 用时、`last` 最后写的、`expected`、`images` 手写原图、`turn`、`evidence`（这道题的证据 id，看原文用）。
- `byTag`：按块、按知识点（`L2.2.1#tr`）汇总，字段同 `totals`，`ms` 是总用时。
- `unfinished`：错了还没改对、也没看答案的题（`items` 的 `key`）；`drafts`：没交的草稿；`says`：我说的话（原文）和附的图；`manual`：上一节下课以后我补记的。
- `notes`：课堂里的 Claude 这节课的观察、提议、小结（id、`kind`、开头一段）；`summary` 小结的 id；`slips` 它记的失误。
- `usage`：这节课花了多少（同 `sessions/{编号}.usage`）；`verify`：核验了几轮、作废了几轮。
- 太长时（几百道题）文字会缩短、最早的条目截掉，`more` 里写着各截掉了几条。
- `items[].guess: true`：单选题把选项差不多试遍了才对（三个选项第二次、四个选项第三次），`totals.guess` 是几道。这种「改对」证明不了会。
- 挂着没下课、几个小时没动静的课，页面先按现有的证据算一份**暂时的**报告（`sessions/{编号}.report.provisional: true`），课照旧能接着上。`report.v` 是算法的版本，旧版算的首页打开时重算。

**知识点归类**（`sessions/{编号}.skills`，页面写，你读）：报告写好以后，页面调用一次 Claude 把每道题归到一个具体的知识点（`块#短名`，例如 `EN-L1.1.1#dobj-oc`「双宾和宾补的区分」），做错了而且正是某个弱点说的那件事的挂上弱点。字段：`items`（`k` 报告里那道题的 `key`、`p` 知识点、`w` 弱点）、`points`（这节课新起的知识点和标题）、`sum`（每个知识点 `n` 几道、`first` 一次对、`fail` 失手、`end` 最后一道 `clean` / `fail`、`w` 挂上的弱点）。用处：掌握按知识点、按真正讲的块算（证据上记的块不一定对：课上可能改讲了别的块）；弱点表写着每个弱点出现过几次、最近哪天、之后做对过几道；「以前的课」和首页写着这节课会了的、还不稳的、下次先测的。课堂里的 Claude 的记忆摘要里带着上一节的「下次先测」。你写掌握、弱点时可以照这份看。

**删课**：测试开的、不要的课，我在「以前的课」点进去「删掉这节课」（首页没下课的那一行也有「删掉」）：这节课的黑板、对话、报告、证据、观察、失误、改动单、抄进题库的题、错题一起删；守则用到的失误、弱点挂着的错题留着（失误去掉课号，记 `wasSession`）。你不用替我删。

### 检验：`absorb`、`probes`（页面写，你核）

一次检验（`board check`）里每道题的作答是一条证据 `src: "check"`：`kind`（题型）、`comp`（`检验 id:题 id`）、`check`、`probe`、`retryOf`、`target`、`level`、`facet`、`q`、`text`（我交的，写成字）、`answer`（原样）、`items`（每一项 `{ id, ok: true | false | "missing" | null, why, tag, carried }`：`tag` 是对上的错法短名或 `slip`，`carried` 是 trace 按我自己的上一行核的那几行）、`outcome`、`final`、`retries`、`sure`、`late`、`giveup`、`ms`、`msTotal`、`teach`、`judgedBy`（`page` / `claude` / `ext` / `timeout`）、`picked` / `template`（模板）、`retest` / `bank` / `renumbered`（复测）。做完以后每块写一条吸收：

- `absorb/{块}`（知识点 `#` 换 `~`）= `{ block, space, state: "成功" | "部分" | "未" | "待核", facets: { "重建" | "能用" | "边界" | "能辨": "ok" | "fixed" | "fail" | "pending" }, by: "page", checked: false, check（检验 id）, session, at, date, probes: [证据编号], confidentWrong: [题 id], debt: [target…], families, retests: [{ days: 1, due, done, ok, renumbered }, { days: 7, … }], retryOwed: [题库编号], history: [以前几次（最多 5 次）], log }`。状态类：`state`、`checked` 改了在 `log` 里记一条（`{ date, by, field, from, to, basis, note }`）。
- 页面怎么判：这一块必做和做了的可选都一次过、不是「蒙的」、不超时 → `成功`；有补上的（retry 做对、蒙对了再确认、超时以后做对）→ `部分`；有 retry 用完、想不出来又没补上的 → `未`；没有「未」但有拿不准的 → `待核`。没做完的块不写。
- 你核：直接写 `state`、`checked: true`、`by: "ext"`，`log` 加一条。再做一次同一块的检验：`state` 照最新的一次，前几次进 `history`，复测重新排。
- 复测：检验那天以后 1 天、7 天（`retests`），到期的写进 `meta/facts` 和首页「今天」的事实（「复测：L2.1.4（隔 1 天）」），`meta/today` 的 `kind` 能写 `retest`。学生点了开一节 `kind: "check"` 的课（`sessions/{编号}`：`{ kind: "check", retest: [{ block, days }], items: [题库编号], … }`），没有主讲；题从 `probes` 里每个 `family` 挑一道没见过的（不挑那次检验里的 retry），挑不到写「缺新题」。复测的证据带 `retest: 1 | 7`、`bank`（题库编号），进掌握的参考，不改吸收。同一个 `family` 只剩见过的模板（带 `pick` 的题）时，复测退回它、换一组数做：那一条证据和 `absorb.retests` 那一次记 `renumbered: true`，`meta/state` 那一块写「复测用的是换了数的同一道题」，掌握参考把它当原题，同时照样记「缺新题」（只剩换数的模板）。
- 检验里最后没过的（retry 用完、想不出来又没补上）和「很确定却错了」的题，页面各记一道错题（`errors`，带 `check`、`probe`、`target`、`items`；同一个 `target` 一次检验一道），能在「管理 → 最近记下的」撤销；补上了的、待核的不记。

`probes/{pr-…}` = `{ fence（题的围栏原文）, type: "recall" | "construct" | "claim" | "discriminate" | "locate" | "solve" | "trace" | "predict" | "tradeoff" | "code" | "calc" | "parse" | "translate" | "rewrite" | "errfind", block, target, level: "基础" | "方法" | "核心", facet, family, retryBank: [题库编号], lets: { 名字: "值" }（题里用到的这节课 let 的量，浮点；复测时当这道题自己带的量，`pick` 之前就有）, src: "ext" | "lab", from: { session, check, as: "probe" | "retry" | "spare" }, seen: [{ at, session, as }], at }`。同一道题（去掉 `id:`、`retry:` 两行以后原文一样）一个编号；`retry:` 写的局部 id 存成 `retryBank`（题库编号）。你写新题：`fence` 照 `board check` 里的一道写，编号照 `pr-` 加 12 位十六进制随便取一个没用过的。

### 练一练和题库：`drills`（页面写，你也可以写）

**练一练**：学习台首页的一张卡。页面从题库里挑 6～8 道（到期的复现组挂的块和错题、掉了的块、该复现的块、最近错过的优先；刚做对过的不挑），不同块混在一起，一次一道、页面判分，**不调用 Claude**。题目上不写是哪一块（先认出该用什么方法），判出对错以后才告诉我。练习是一节 `kind: "drill"` 的课（`sessions/{编号}`：`items` 题库编号、`reviews` 练到的到期复现组、`drill` 结果的要点），作答照常进 `evidence`（`comp` 是题库编号，`block`、`tags` 是那道题的块和知识点），课后报告照常写，掌握照常算。做完以后：练到的复现组有一道没一次做对，页面直接记没过（`kind: "review"`、`by: "page"`，回到 1 天，能撤销）；**都对了不算复现通过**（原题，档位不动，要在复现课里做新题才算）；没一次做对的几道可以「带着没过的开课」：页面把原题和我的作答拼成资料包开一节课。

**`drills`**：编号 `d-{课}-{组件}`（`d-20261027-1-q3`），页面编。字段：`md`（照抄就能用的组件原文，前面带着那节课的 `let` 块，组件 `id` 换成了题库编号）、`block`、`point`（知识点）、`kind`（组件）、`q` 题面、`title`、`src`（`board` 从课上抄的 / `chat` 你写的）、`from`（`session`、`seg`、`comp`：原来在哪节课的哪个组件）、`fromSession`、`orig`（课上那次的结果，`first` / `ok` / `wrong` / `giveup` / `revealed`）、`errors`（挂的错题，按证据对上的）、`space`、`status`（`active` / `void` 不再练）、`broken`（练习时渲染出错了，页面标的，`brokenWhy`）、`at`。

- 页面在每节课下课写报告时抄（课堂、实时黑板、自学单元都抄；图、猜想、代码题、示意图不抄），以前的课首页打开时补抄（`sessions/{编号}.drills` 记抄了几道）。
- 你备课时可以写几道练习题进来（`src: "chat"`，`md` 照组件写法写一个能判分的组件，`id` 写成题库编号；`practice` 的自定义题型每次换数，最适合）。同一个 `md` 会被反复练，所以题要经得起做第二遍。

### 改动单：`pending`（页面写，你读）

课堂里的 Claude 改记忆、我在学习台上改记忆，每一条都先记一张改动单。编号 `pd-…`。字段：`kind`（`pref` 偏好 / `slip` 失误 / `note` 观察 / `propose` 提议 / `error` 错题 / `weakness` 弱点 / `review` 复现组 / `recall` 记忆点 / `position` 下一节 / `mastery` 掌握（页面按证据算的提议）；练习做完页面出的复现组结果也是 `review`，`by` 是 `page`）、`tier`（`direct` 直接写的 / `confirm` 要我确认的 / `me` 我自己改的）、`by`（`class` / `me` / `page` 页面按证据算的）、`coll`、`target`（改哪一条）、`op`（`add` 新加 / `update` 改）、`data`（新加的内容）或 `patch`（改的字段）、`reason`、`basis`（依据：证据 id、记忆里的编号）、`session`、`turn`、`status`、`at`、`log`。

- `status`：`open` 等我确认、`done` 写进去了（`doneAt`；改的写在 `applied`：每个字段的 `from`、`to`；我在「改」里改过的在 `edited`）、`rejected` 我点了「不要」、`undone` 我撤销了（`undoneAt`）、`held` 守卫先暂存了（引的原话、轮次对不上这类，`guard` 里写着看出了什么；我在「管理 → 自检 → 守卫」里放行或者不要）。被守卫拒收、暂存的条目不会写进记忆；写进去但挂了提醒的，那一条上有 `guard` 字段（`verdict: flag`、`checks`）。带 `by: "lab"`、`backfill: true` 的是**云端教研室**事后补写的（每晚在云端照学习台出的单子 `lab_brief` 做，回答进 `lab_inbox`，学习台过了守卫才并进来，回执在 `lab_inbox_log`）：`lab_brief`、`lab_inbox`、`lab_inbox_log` 由学习台和教研室管，你不要写。
- **撤销**：写进去 7 天内我能撤。状态类（弱点、复现组、位置、偏好）退回旧值（也记一条 `by: "me"` 的 log）；新加的偏好、弱点、复现组改成 `status: "void"`（复现组的 `status` 还有 `active` / `paused` 我暂停了 / `done` 停掉了 / `void`）。历史类（错题、失误、观察）原条不动，追加一条作废的更正：`corrects` 指向原条、`void: true`、`note` 写为什么。**读记忆时 `void` 的、被作废更正指向的都当没有**；错题有一条 `resolved: true` 的更正指向它，就是我标了已解决。
- **掌握的提议（`kind: "mastery"`、`by: "page"`）**：页面按证据算的（不调用 Claude）：两道不同的题一次对、没标没把握 → 基础题过；之后隔够 1 / 3 / 7 / 14 / 30 天又一次对（新题；练一练里的原题做对不算）→ 复现通过到那一档；过了以后第一次就错、想不出来、看了答案 → 掉了。从记忆里现有的状态出发，只看那以后的证据。算出来直接写进 `mastery`（log 的 `by` 是 `page`，`ref` 是改动单）。你写的掌握状态照旧直接写，页面以你写的为起点往后算。
- `status: "open"` 的是以前留下的（那时还要我确认）：学习台打开时页面会直接写进去。

### 备份和恢复

- **导出**：我在学习台首页「备份和用量」点「导出备份」，存成一个 JSON 文件（`学习台备份-20261027.json`）。可选带不带证据、带不带各节课的黑板和课堂记录；每节课的资料包、课后报告总是带上。
- 文件的样子：`{ "format": "la-desk-backup", "v": 1, "kit", "at", "today", "include": { "evidence", "boards" }, "counts", "docs": [{ "collection", "doc_id", "data" }] }`。`docs` 里每一条就是 `ArtifactData` batch 要的样子（`collection` 可能是 `"sessions/c-20261027-1/report"` 这样的子集合）。
- **恢复**（我把文件交给你、说「从备份恢复」时）：
  1. 先确认往哪个学习台写（一般就是原来那个；万一要换新的学习台，由开发那边发布，你只往里写数据），把文件存到本地读出来，`format` 不是 `la-desk-backup` 的不要写。
  2. 学习台不是空的：先按集合 `list`（`limit: 1000`）看哪些文档已经有了。已经有的默认**跳过**（备份比现在旧）；我明确说「用备份覆盖」时，写那一条要带上读到的 `version` 作 `if_version`。
  3. 按 `docs` 的顺序，每 50 条（整批不过 1 MiB）一次 `batch`，每条 `{ "op": "set", "collection", "doc_id", "data" }`。条目大的可以先存成本地 JSON 文件，用 `file_path` 代替 `data`。
  4. 写完让我打开学习台，读 `meta/memcheck`：自检的指纹会重新记一遍，第一次可能有「被改了」的提醒，看一眼没问题就行。告诉我写了几条、跳过几条。

### 复现和要记的：两条线

- **会不会做**（方法、机制）归复现组 `reviews`：隔几天出一道**新题**（不是原题换数）、不贴标签、不给提示，写出依据才算过。首页「今天复现」不分科列出每门课到期几组，按我的规则（从没复现过 > 上次没过 > 过期久）先挑 3 组，点一下开一节复现课（`sessions` 的 `review` 是这几组的编号数组），课堂里的 Claude 下课时每组判一次。备课写的「开头复现」记在 `sessions` 的 `opening`，下课时做了的那几组照样判。
- **记不记得**（要背的）归记忆点 `recall`：首页「要记的」，各科到期的混在一起，一次最多 20 条；先写再看答案，我自己点结果（想起来了升一档，30 天那档也想起来了就算记牢了；模糊档位不动；没想起回 1 天）。每想一次记一条证据（`src: "recall"`，带我写的什么），**不进掌握**。
- 「练一练」的题是课上的原题：都做对了不算复现通过、档位不动，掌握也不往上升；做错了照样记没过、算失手。

### 复现组什么时候到期

- 档位是 **1 → 3 → 7 → 14 → 30** 天。**到期日 = `last` + `tier` 天**，页面算，你不写；还没做过（没有 `last`）就是今天到期。
- 复现结果由课堂里的 Claude 在下课整理单里判（`review id=… result=…`），练一练由页面判；开发那边手工修数据时照这个改：过了升一档（30 天那档过了还是 30），没过回到 1 天；`last` 改成这次的日期，`result` 写结果，`log` 里记 `tier`、`last`、`result` 各改成了什么、依据哪几条证据。
- 今天哪些到期：看 `meta/memcheck` 的 `due`，或者自己按上面的公式算。

### 删掉的课：`meta/deleted`（页面写，你读）

学生用「删掉这节课」删课时，连带删掉的历史类（错题、观察、失误）编号记在 `meta/deleted.keys`（`{ "observations/ob-…": { at, session } }`），自检认它，不报「被删掉了」。

### 自检结果：`meta/memcheck`

页面打开时、数据库一有变化就查一遍，写进 `collection: "meta"`，`doc_id: "memcheck"`：

（同一个页面还写开场简报 `meta/brief`、`meta/brief-cs`、`meta/brief-en`，见下文「平时怎么用」。）

- `ok`：有没有硬的错；`problems`：一条一行，比如 `weaknesses/W19：level 从「L1」改成了「L0」，log 里没记：补一条 { date, by, field: "level", from, to, basis }`、`errors/L2-07：错题档案只增不改，L2-07 的内容被改了……`。开头写着「[提醒]」的不算错（比如课程地图还空着时指向块的 id；历史类被改了、被删了的提醒留 7 天，也算提醒）。log 的 `by` 只能是 `chat` / `class` / `page` / `me` / `lab` / `head` / `ext`。
- `counts`：每一类有几条；`due`：复现组的到期日（`days` 是离今天几天，负数是过期了几天）；`today`：页面那边的日期；`kit`：组件库版本；`at`：查的时间。
- 我没打开学习台，它就不会更新（看 `at`）。
