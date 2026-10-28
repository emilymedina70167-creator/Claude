### kmp / hash / bsearch：查找

```kmp
id: k-nv
title: 求 nextval
pattern: abaabc
show: nextval
ask: next, nextval
```

- **`kmp`**：`pattern:` 模式串（最长 16）。`show: next` 一步步求 next 数组（王道：从 1 数，`next[1] = 0`，`next[j]` = T[1..j−1] 最长相等前后缀的长度 + 1，画面上把前后缀标出来）；`show: nextval` 接着求 nextval。写了 `text:`（主串）就是 `show: match`：KMP 匹配，主串和模式串对齐画，失配时 i 不动、j 退到 next[j]（`use: nextval` 改用 nextval）。`ask:` 能问 `next`、`nextval`（这一格是多少）、`slide`（失配后 j 变成多少）。`mode: quiz`：写出 next / nextval 数组，或者匹配成功的位置。
- **`hash`**：`hash: 19 14 23 01 68 20 84 27 55 11 10 79`（非负整数），`p: 13`（H(key) = key % p），`probe:` 选 `linear`（线性探测，默认）、`quadratic`（平方探测：0, 1², −1², 2², −2², …）、`chain`（拉链法，新关键字接在链表末尾）；开放定址可以写 `size: 16`（表长，默认等于 p）。一个一个插入，冲突一次记一步；最后两步算 ASL成功 和 ASL失败（按王道的算法）。`ask:` 能问 `hash`（H(key) 是多少）、`place`（最后放在哪个地址，点出来）、`asl`、`aslfail`（可以写分数）。`mode: quiz`：写出整张表（空的写 #），或者 `quiz: asl` 写 ASL成功。
- **`bsearch`**：`bsearch:` 有序表（从小到大、不重复，最多 31 个），`key: 32`（要查的，几个用逗号），`tree: true` 同时画判定树（并在最后算 ASL成功、ASL失败）。位置从 1 数，mid = ⌊(low + high)/2⌋。`ask:` 能问 `mid`（下一次和哪个比，点出来）、`asl`、`aslfail`。`mode: quiz`：写出查 `key` 时依次比较的元素。

- ASL失败按王道：开放定址查失败时，和空位置的那次比较也算；拉链法和空指针的比较不算；按 H 能算出的 p 个地址平均。
- `mode: fill`：`kmp` 填每个 j 的 next、nextval（一列一个 j）；`hash` 填每个关键字的比较次数，下面写 ASL成功 和 ASL失败（可以写分数）；`bsearch` 填每一次比较的 low、high、mid、比的元素。
- 错法诊断认得出：next 按「从 0 数、next[0] = −1」算的、写成了部分匹配值 PM、nextval 照抄 next；散列按别的探测方法、把表长当成 p、查失败时空位置那次没算、ASL失败按表长平均或除以关键字个数，拉链法和空指针比也算了；折半查找 mid 向上取整、位置从 0 数、判定树失败结点那层也算了比较、ASL失败除以 n。
