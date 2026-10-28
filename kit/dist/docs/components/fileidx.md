### fileidx：混合索引

```fileidx
id: fi-1
title: 混合索引
block: 1KB
entry: 4B
direct: 10
single: 1
double: 1
triple: 1
offset: 10240, 300000
ask: n, max, level, reads
```

- `block:` 盘块大小、`entry:` 地址项大小（一个索引块放 block ÷ entry 个地址项），`direct:` `single:` `double:` `triple:` 直接 / 一级 / 二级 / 三级间接地址项各几个（默认 10、1、1、0）。画每一级能指向几个块、管哪段逻辑块号（从 0 数）、最大文件长度。`offset:` 要读的字节号（最多 4 个；或者 `blockno:` 直接给逻辑块号）：一步步算逻辑块号、在哪一级、从索引结点一路指到数据块、访问几次磁盘（默认索引结点已经在内存里；`inode: disk` 再加 1 次）。`size: 1MB` 再算这么大的文件要几个索引块。`ask:` 能问 `n`、`max`（最多几个盘块）、`lblock`（第几号逻辑块）、`level`（哪一级）、`reads`（访问几次磁盘）、`idx`（几个索引块）。`mode: quiz`：有 offset 时问第一个要访问几次磁盘，没有时问最多几个盘块；`mode: fill` 填每一级的块数和逻辑块号范围。

- 错法诊断认得出：逻辑块号从 1 数了、访问次数没算最后读数据块那一次。
