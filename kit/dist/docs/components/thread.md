### thread：线索二叉树

```thread
id: th
nodes: A(B(D, E), C)
ask: pred, succ
```

- `nodes:` 写法同 tree（也可 `level:`）；`order: in`（默认）、`pre`、`post`。线索是虚线箭头（前驱蓝、后继粉），旁边是 lchild ltag data rtag rchild 表。`ask:` 能问 `pred`、`succ`（这个空指针指向谁，我点；NULL 也能点）。`mode: quiz` 写右线索（`quiz: pred` 左线索）。

- 一开始空指针画成一小截加 ∧（n 个结点有 n + 1 个）。按遍历次序一个个访问（画面下面写着 pre 是谁），空的左指针指向前驱（ltag = 1），空的右指针指向后继（rtag = 1）；第一个的左线索、最后一个的右线索指向 NULL（tag 也是 1）。说明里写了王道代码里右线索是访问到后继时才连的（pre->rchild = p）。
- 问的时候题面不说「前驱 / 后继」，只问「这个空指针线索化以后指向谁」，前驱后继弄反才看得出来。
- `quiz: succ`（默认）：右指针空着的那些结点（按层序列在题面里），线索依次指向谁；`quiz: pred` 是左指针。`mode: fill`：每个结点的 lchild、ltag、rtag、rchild（有孩子的直接给出，线索要写，指向 NULL 写 NULL）。结点最多 15 个。
- 错法诊断认得出：前驱、后继弄反；按别的次序（先序 / 中序 / 后序）线索化。
