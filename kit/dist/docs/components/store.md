### store：图、树的存储结构（原图和存储并排）

```store
id: st-g
title: 邻接矩阵和邻接表
graph: A-B, A-C, B-D, C-D
show: matrix, list
ask: list
```

- `graph:` 图的边（写法同 `net` 的 `edges:`），或者 `tree:` 树（写法同 `forest`，几棵并排是森林）。一条边（一个结点）一步，存储跟着长。
- `show:` 一到两种。图：`matrix` 邻接矩阵、`list` 邻接表、`cross` 十字链表（有向图）、`multi` 邻接多重表（无向图）。树：`parent` 双亲表示、`child` 孩子表示、`cs` 孩子兄弟、`seq` 二叉树的顺序存储（单独用）。
- `ask:` 图 `matrix` `list` `degree`；树 `parent` `child` `cs`；顺序存储 `seq`。`mode: quiz` 写一条链表 / 双亲数组 / 顺序存储；`mode: fill` 填邻接矩阵、双亲一列或数组。

- 口径：链表默认尾插（按边的先后接在后面），`insert: head` 头插；十字链表、多重表的指针写弧 / 边的编号（按 edges 的先后从 0 数），空指针写 ∧；带权的邻接矩阵对角线 0、没边 ∞；双亲表示按层序编号、下标从 0 数，根的双亲 −1；顺序存储从 A[1] 开始，编号 i 的孩子是 2i、2i+1，空的写 #，`tree:` 写二叉树（`A(B(, D), C)`，逗号前是左子树）。
- 错法诊断认得出：无向边只存了一个方向、头插尾插弄反、双亲表示按先序编号、顺序存储下标从 0 数。

这是演示组件：先猜再揭晓（`ask`）、`mode: quiz` / `fill`、`vary:` 滑块、课堂里 `figure … set step=` 这些共用写法见 `components/stepper.md`。
