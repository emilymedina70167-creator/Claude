### mem：访存的整条链、有效访问时间

```mem
id: vm-1
title: 各要多久
page: 4KB
table: 0->101H, 1->-, 2->254H
vaddr: 2362H, 1565H, 25A5H
cost: tlb=10 mem=100 fault=10^8
resident: 2
ask: tlb, victim, paddr, time
```

- 快表 → 页表 → 缺页（LRU）→ 物理地址，逐段计时（2009 年第 46 题口径）。`ask:` page tlb inmem victim paddr time。`rate: tlb=0.9 fault=0.0001` 改算 EAT（ask: hit miss fault eat）。

- 一串地址（`vaddr:`，最多 8 个）：`page:` 页面大小；`table:` 页表（`页号->块号`，`-` 是有效位 0）；`cost:` 各段时间（`tlb` `mem` `fault`，单位 `unit:`，默认 ns；可写 `10^8`、`1e8`、`8ms`）；`tlb:` 快表里一开始有哪几页（默认空）、`tlbsize:` 快表几项（满了换最久没用的）；`resident:` 驻留集几块（默认 = 在内存的页数 + `free:` 给的空闲块数），没满时缺页调进 `free:` 的块，满了按 `replace:`（`lru` 默认 / `fifo`）换，`order:` 驻留的页从老到新（默认页号从小到大）；`bits:` `pbits:` 地址位数（默认按数推）。
- 口径：查完页表把这一项放进快表，不计时；缺页处理的时间含更新快表和页表。别的教材的约定：`retry:` 缺页处理完怎么走（`tlb` 默认：重新执行，快表命中，再访存；`table`：重新执行，快表还没命中，再查页表；`mem`：直接访存；`none`：缺页时间里含了访存）、`parallel: true`（快表和页表同时查，没命中不计查快表的时间）、`levels: 2`（快表没命中访问 2 次内存查页表）。
- 有效访问时间（`rate:`，不写 vaddr）：`rate: tlb=0.9 fault=0.0001 cache=0.95`（快表命中率、缺页率——占全部访问的比例、Cache 命中率，可写 90%），`cost:` 加 `cache=`；分快表命中 / 没命中（页在内存）/ 缺页三种算时间，再按概率加。有 Cache 时取一次数据 = 命中率 × Cache + (1 − 命中率) × (Cache + 内存)。`ask:` data（取一次数据）、hit、miss、fault、eat。
- `mode: quiz`：一串地址写各次时间（空格隔开；没写 cost 写物理地址），rate 写 EAT。`mode: fill`：每个地址的页号、快表命中（打 √）、缺页（打 √）、物理地址、用时；rate 填每种情况的概率、时间和 EAT。
- 错法诊断认得出：缺页处理完没重新执行、以为重新执行时快表还没命中、查完页表没放进快表、没命中时没算查快表的时间、多级页表只算了一次访存、换出了刚访问过的页、按另一种置换算法换；EAT 再加：没命中时没算访存、Cache 没命中时没算查 Cache。
