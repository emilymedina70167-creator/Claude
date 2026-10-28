### pagetable：多级页表

```pagetable
id: pt-1
title: 多级页表
vbits: 32
page: 4KB
pte: 4B
vaddr: 0x12345678
ask: offset, per, levels, idx
```

- `vbits:` 逻辑地址位数，`page:` 页面大小，`pte:` 页表项大小。按王道：每一级页表都放进一个页面（一页 page ÷ pte 项），级数 = ⌈页号位数 ÷ 每级位数⌉，分不匀时最高一级（页目录）少几位。画出逻辑地址怎么拆。可选 `vaddr:` 拆出每一级的下标、`pbits:` 物理地址位数（算页表项至少几字节）、`levels:` 题目定了几级。`ask:` 能问 `offset`（页内偏移几位）、`per`（一页几个页表项）、`levels`、`split`（页目录号几位）、`idx`（页目录号是多少）、`ptebytes`、`mem`（没有快表时访问几次内存）。`mode: quiz` 写级数；`mode: fill` 填每个字段的位数（和下标）。

- 错法诊断认得出：一页的项数没除以页表项大小、级数向下取整、让最低一级少了几位。
