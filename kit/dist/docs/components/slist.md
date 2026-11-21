### slist：静态链表

```slist
id: sl-1
size: 7
list: a b c
ops: insert 2 x, delete 1
ask: slot, next
```

- 照王道：`a[0]` 是头结点，`next = −1` 是表尾，`−2` 是空闲。`ops:` `insert 2 x`（插到第 2 个位置：找第一个空闲的格，先接后面再改前驱）、`delete 3`。数组和按 next 连成的链并排，改的两格标出来。`ask:` `slot` `next` `pre`；`mode: quiz` 按链的顺序写元素。

- 错法诊断认得出：插入时先改了前驱的 next（后面的链断了）。

这是演示组件：先猜再揭晓（`ask`）、`mode: quiz` / `fill`、`vary:` 滑块、课堂里 `figure … set step=` 这些共用写法见 `components/stepper.md`。
