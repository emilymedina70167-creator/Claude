# 说明草稿：trace 二期（结构体、指针、malloc / free、链表）

改 `CLAUDE-PROJECT.md` 第三节的 `### trace` 那一节：

1. 「支持：」那一条最后一句「第一期**不支持指针、结构体、`malloc`、`switch`**：写了会报出来。」改成「**不支持 `switch`、指针运算（`p++`、`p + 1`）**：写了会报出来。」
2. 在「下标越界……」那一条后面加下面的精简版（一条，475 字节，每一轮都带）。
3. 节末 `<!-- 完整写法 -->` 后面加下面的完整写法（课堂 Claude 用 `component_doc` 取）。trace 现在没有 `<!-- 完整写法 -->`，要先加这一行。

例子照抄能用的那段在 `docs/drafts/trace2-demo.md`（也在 `kit/examples/ds-trace2-demo.html` 里）。

## 精简版

- 指针、结构体：`typedef struct LNode {…} LNode, *LinkList;` 照抄，`.` `->` `*p` `&x` `NULL` `malloc(sizeof(LNode))` `free(p)` `LinkList &L` 都行。结点画成框、指针画成箭头。`let L = list [头, 1, 2]`（带头结点）、`let T = tree A(B, C)` 直接给。`predict: 9 -> p`：问 p 指哪个结点（`->` 两边空格）。空指针、野指针、free 后再用、free 两次停在那一行；没 free 又没人指着的结点提醒内存泄漏。

## 完整写法

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
