# 验收：1-phase5

- 一次写对（两种 iPad 尺寸都没有「错」）：100%（29/29）
- 把报错发回去改一次后改对：—

## 操作系统

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 2 |
| os-alloc.board.json | ✓ |  | 0 | 1 |
| os-bitmap.board.json | ✓ |  | 0 | 0 |
| os-eclock.board.json | ✓ |  | 0 | 0 |
| os-mem.board.json | ✓ |  | 0 | 1 |
| os-pc.board.json | ✓ |  | 0 | 0 |

### class.class.json

- 注意：放不下（820×1180）：第 2 轮：板「访问页 5：先扫一圈」一屏放不下
- 注意：放不下（1180×820）：第 2 轮：板「访问页 5：先扫一圈」一屏放不下

### os-alloc.board.json

- 注意：放不下（1180×820）：第 4 块板：板「碎片从哪来」一屏放不下

### os-mem.board.json

- 注意：放不下（1180×820）：第 6 块板：板「换一组：自己填」一屏放不下

## 数据结构

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 1 |
| ds-btree.board.json | ✓ |  | 0 | 2 |
| ds-huffman.board.json | ✓ |  | 0 | 1 |
| ds-nextval.board.json | ✓ |  | 0 | 0 |
| ds-postfix.board.json | ✓ |  | 0 | 1 |
| ds-reverse.board.json | ✓ |  | 0 | 1 |

### class.class.json

- 注意：stack：infix: 只有 + − 、没有括号：专门讲同级的从左往右出栈可以不管；要讲优先级和括号就换一个带 * / 或括号的

### ds-btree.board.json

- 注意：draft：这个组件没写 id:，暂时按 s4-1 记。请加一行 id:（同一个单元里不重复）
- 注意：放不下（1180×820）：第 5 块板：板「换成 5 阶」一屏放不下

### ds-huffman.board.json

- 注意：draft：这个组件没写 id:，暂时按 s6-1 记。请加一行 id:（同一个单元里不重复）

### ds-postfix.board.json

- 注意：stack：infix: 只有 + − 、没有括号：专门讲同级的从左往右出栈可以不管；要讲优先级和括号就换一个带 * / 或括号的

### ds-reverse.board.json

- 注意：trace：代码里有结点没 free、也没有指针指着了（内存泄漏：③④⑤），学生会在那一步和最后一步看到提醒；如果不是有意的，检查一下删除结点的地方

## 线代

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 2 |
| la-posdef.board.json | ✓ |  | 0 | 1 |
| la-power.board.json | ✓ |  | 0 | 0 |
| la-schmidt.board.json | ✓ |  | 0 | 0 |
| la-sim.board.json | ✓ |  | 0 | 0 |

### class.class.json

- 注意：放不下（1180×820）：第 1 轮：板「Aⁿ 怎么拆」一屏放不下
- 注意：放不下（1180×820）：第 3 轮：板「能不能换顺序」一屏放不下

### la-posdef.board.json

- 注意：字叠在一起：第 3 块板：graph 「D₂、D₃ 随 t 变」 里「D3」和「a」叠在一起

## 组成原理

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 1 |
| co-align.board.json | ✓ |  | 0 | 2 |
| co-booth.board.json | ✓ |  | 0 | 0 |
| co-div.board.json | ✓ |  | 0 | 0 |
| co-fadd.board.json | ✓ |  | 0 | 0 |
| co-hamming.board.json | ✓ |  | 0 | 1 |

### class.class.json

- 注意：放不下（1180×820）：第 2 轮：板「看哪两位」一屏放不下

### co-align.board.json

- 注意：放不下（820×1180）：第 4 块板：板「换一个结构体」一屏放不下
- 注意：放不下（1180×820）：第 4 块板：板「换一个结构体」一屏放不下

### co-hamming.board.json

- 注意：放不下（1180×820）：第 5 块板：板「换着数练」一屏放不下

## 计网

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 2 |
| cn-csma.board.json | ✓ |  | 0 | 0 |
| cn-encode.board.json | ✓ |  | 0 | 0 |
| cn-frag.board.json | ✓ |  | 0 | 0 |
| cn-sw.board.json | ✓ |  | 0 | 0 |
| cn-tcpseq.board.json | ✓ |  | 0 | 0 |

### class.class.json

- 注意：放不下（820×1180）：第 2 轮：板「第一段有多长」一屏放不下
- 注意：放不下（1180×820）：第 2 轮：板「第一段有多长」一屏放不下
