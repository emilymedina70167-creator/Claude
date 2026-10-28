### 排序（数据结构）：array / shellsort / sortpass

老的三个：`array`（一排格子的静态示意，`gap: d` 按子表着色）、`shellsort`（希尔排序回放，`mode: code` 按代码逐行走）、`sortpass`（我写一趟的结果，自动判分）。一般用 `sort`，要它们时用 `component_doc` 取写法。

数组画成一排格子（下标从 1 开始；重复的数后面加 `'`，画成带下划线的那个，比如 `49'`），最多 16 个元素。排序的过程、每一趟的结果都由组件算，不用自己算好再填。

```array
array: 49 38 65 97 76 13 27 49'
gap: 4
split: true
note: 同色的是同一个子表。
```

`array`：静态示意。`gap: d` 按增量给子表着色（同一子表同色），`split: true` 按子表分行，`zero: true` 画出 0 号暂存位置。

```shellsort
title: 回放：d = 4, 2, 1
array: 49 38 65 97 76 13 27 49'
gaps: 4, 2, 1
```

`shellsort`：可以一步步点、也可以自动播放的希尔排序演示。`gaps` 不写就用 $\lfloor n/2 \rfloor$ 每次减半。`mode: code` 按王道的 `ShellSort` 代码逐行走（高亮当前行，显示 d、i、j、A[0] 和后移次数），`mode: pass`（默认）按趟看。`goal: end` 要点到最后一步才算完成。

```sortpass
id: q-d4
title: 第一趟：d = 4
array: 49 38 65 97 76 13 27 49'
gap: 4
hint: 4 个子表各只有 2 个元素，每个子表里小的放前面。
```

`sortpass`：我自己写出结果，自动判分。`gap: d` 写一趟后的序列；`gaps: 4, 2` 写几趟之后的序列；`upto: 6` 是「按代码执行到 i = 6 为止」时的序列。不写 `q` 会自动出题面，不写 `explain` 会自动生成每个子表怎么排的解析。每一次「检查」都会记录（答错的也记）。
