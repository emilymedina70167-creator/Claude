### bitmap：位示图

```bitmap
id: bm-1
title: 分配和回收
map: 1111 0011 1010 0000; 0000 1111 1111 1110
ops: alloc 3, free 5, where 20, block 1 3
ask: alloc, blocks, word, bit, block
```

- `ops:` where b（盘块→字号位号）、block i j、alloc k、free b；`base: 1` 从 1 编号（默认 0），0 是空闲。`ask:` word bit block alloc（点格子）blocks。位示图存在磁盘上：`at: 32` `block: 1KB`，ask: disk word bit。

- 位示图：`map:` 一行一个字（分号隔开，空格随意）；或者 `word: 16` 加 `words: 4`、`used: 0-5, 9`（已分配的盘块）；只做换算时只写 `word:`（不画整张图，只画那一个字）。最多 32 行 × 32 位。
- 编号：`base: 0` / `1` 是字号、位号、盘块号一起，分开写 `base: word=1 bit=1 block=0`。公式写成一般的样子：i = ⌊(b − b₀) ÷ n⌋ + i₀，j = (b − b₀) mod n + j₀。`idle: 1` 换成 1 表示空闲。分配从第一个字开始一行行、从左往右找。
- 位示图存在磁盘上（`at:` 从第几号盘块开始存，`block:` 盘块大小）：一块放 block × 8 位，块内按字节数（`word:` 默认 8），`ops:` 只能用 where、free。2015 年统考：`at: 32` `block: 1KB` `ops: free 409612` → 82 号盘块、块内第 1 个字节。
- `mode: quiz` 问第一个 op（where 写「字号 位号」，磁盘上的写「盘块号 字节号」，block 写盘块号，alloc 写分到的盘块号）。`mode: fill` 填每个盘块的字号、位号、盘块号（给出的那一格不用填；磁盘上的是盘块、块内字节、位）。
- 错法诊断认得出：编号从 0 还是从 1 弄反、商和余数弄反、把另一个值当成空闲；磁盘上的再加：一块按字节数当成了位数、忘了加起始盘块号。
