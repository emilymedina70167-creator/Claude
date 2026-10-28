### alloc：动态分区分配

```alloc
id: om-1
title: 首次适应
memory: 640K
algo: first
ops: alloc 1 130K, alloc 2 60K, alloc 3 100K, free 2, alloc 4 200K
ask: where, merge
```

- `memory:` 内存大小，`algo:` 选 `first`（首次适应）、`best`（最佳适应）、`worst`（最坏适应）、`next`（邻近适应）；`ops:` 依次 `alloc 名字 大小`、`free 名字`；`used: OS 0 40K` 给开始时已经占了的。按王道：从空闲区的低地址分；回收时和上邻 / 下邻 / 上下的空闲区合并。画成按容量占宽度的内存条 + 空闲分区表。`ask:` 能问 `where`（分在哪个空闲区，在条上点）、`start`（起始地址）、`merge`（回收属于哪种情况）、`holes`（回收后几个空闲区）、`max`（最后最大的空闲区）。`mode: quiz` 写每次的起始地址；`mode: fill` 填每个作业的起始地址。

- 分不到时那一步写「分配失败」（`where` 问的是「能分配吗」），quiz 和填表里写 ×。
- 错法诊断认得出：按别的算法找、回收时没和相邻的空闲区合并。
