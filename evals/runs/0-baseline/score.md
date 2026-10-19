# 验收：0-baseline

- 一次写对（两种 iPad 尺寸都没有「错」）：76%（28/37）
- 把报错发回去改一次后改对：—

## 操作系统

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 4 |
| os-addr2.board.json | ✓ |  | 0 | 0 |
| os-banker.board.json | ✗ |  | 1 | 2 |
| os-file.board.json | ✓ |  | 0 | 0 |
| os-page.board.json | ✓ |  | 0 | 0 |
| os-pv.board.json | ✓ |  | 0 | 1 |
| os-sched.board.json | ✓ |  | 0 | 0 |

### class.class.json

- 注意：放不下（820×1180）：第 2 轮：板「先来先服务」一屏放不下
- 注意：放不下（1180×820）：第 1 轮：板「先来先服务」一屏放不下
- 注意：放不下（1180×820）：第 2 轮：板「先来先服务」一屏放不下
- 注意：放不下（1180×820）：第 3 轮：板「从到达开始掐表」一屏放不下

### os-banker.board.json

- 错：quiz：\calc{av'+row(A, 2)} 算不出来：尺寸不同，不能相加（单位矩阵按需要写 E(3)、E(4)）
- 注意：放不下（820×1180）：第 5 块板：板「自己判：P4 请求」一屏放不下
- 注意：放不下（1180×820）：第 5 块板：板「自己判：P4 请求」一屏放不下

### os-pv.board.json

- 注意：要横着滑（820×1180）：第 3 块板：trace 「一种交替顺序」 里有一块要横着滑（387/372px）

## 数据结构

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 2 |
| ds-avl.board.json | ✓ |  | 0 | 0 |
| ds-build.board.json | ✓ |  | 0 | 2 |
| ds-dijkstra.board.json | ✓ |  | 0 | 2 |
| ds-hash.board.json | ✓ |  | 0 | 4 |
| ds-list.board.json | ✓ |  | 0 | 1 |
| ds-quick.board.json | ✓ |  | 0 | 3 |

### class.class.json

- 注意：放不下（1180×820）：第 2 轮：板「填坑：第一步」一屏放不下
- 注意：放不下（1180×820）：第 3 轮：板「坑该填谁」一屏放不下

### ds-build.board.json

- 注意：draft：这个组件没写 id:，暂时按 s3-1 记。请加一行 id:（同一个单元里不重复）
- 注意：放不下（1180×820）：第 5 块板：板「先序加后序行吗」一屏放不下

### ds-dijkstra.board.json

- 注意：放不下（820×1180）：第 5 块板：板「负权边为什么不行」一屏放不下
- 注意：放不下（1180×820）：第 5 块板：板「负权边为什么不行」一屏放不下

### ds-hash.board.json

- 注意：draft：这个组件没写 id:，暂时按 s2-1 记。请加一行 id:（同一个单元里不重复）
- 注意：draft：这个组件没写 id:，暂时按 s3-1 记。请加一行 id:（同一个单元里不重复）
- 注意：draft：这个组件没写 id:，暂时按 s5-1 记。请加一行 id:（同一个单元里不重复）
- 注意：放不下（1180×820）：第 5 块板：板「查找失败的 ASL」一屏放不下

### ds-list.board.json

- 注意：放不下（1180×820）：第 6 块板：板「写答卷」一屏放不下

### ds-quick.board.json

- 注意：draft：这个组件没写 id:，暂时按 s2-1 记。请加一行 id:（同一个单元里不重复）
- 注意：draft：这个组件没写 id:，暂时按 s7-1 记。请加一行 id:（同一个单元里不重复）
- 注意：放不下（1180×820）：第 6 块板：板「再练一组」一屏放不下

## 线代

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 3 |
| la-det.board.json | ✓ |  | 0 | 0 |
| la-diag.board.json | ✗ |  | 1 | 0 |
| la-geo.board.json | ✓ |  | 0 | 0 |
| la-inv.board.json | ✓ |  | 0 | 0 |
| la-orth.board.json | ✗ |  | 2 | 0 |
| la-param.board.json | ✗ |  | 1 | 2 |
| la-quad.board.json | ✓ |  | 0 | 0 |
| la-rank.board.json | ✓ |  | 0 | 0 |

### class.class.json

- 注意：放不下（820×1180）：第 2 轮：板「先整理方程」一屏放不下
- 注意：放不下（1180×820）：第 2 轮：板「先整理方程」一屏放不下
- 注意：放不下（1180×820）：第 3 轮：板「X 只能从右边提」一屏放不下

### la-diag.board.json

- 错：graph：图形描述有误：未定义的变量 A；未定义的变量 A

### la-orth.board.json

- 错：space：图形描述有误：未定义的变量 x1；未定义的变量 x2；未定义的变量 x3
- 错：space：图形描述有误：未定义的变量 x2；未定义的变量 x3

### la-param.board.json

- 错：space：图形描述有误：未定义的变量 eta；未定义的变量 eta；未定义的变量 xi1；未定义的变量 xi2；未定义的变量 xi1；未定义的变量 eta；未定义的变量 eta；未定义的变量 eta
- 注意：放不下（820×1180）：第 6 块板：板「通解长什么样」一屏放不下
- 注意：放不下（1180×820）：第 6 块板：板「通解长什么样」一屏放不下

## 组成原理

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 4 |
| co-arith.board.json | ✓ |  | 0 | 0 |
| co-asm.board.json | ✗ |  | 1 | 0 |
| co-cache.board.json | ✗ |  | 1 | 1 |
| co-float.board.json | ✗ |  | 3 | 1 |
| co-mem.board.json | ✗ |  | 1 | 0 |
| co-pipe.board.json | ✓ |  | 0 | 0 |

### class.class.json

- 注意：放不下（820×1180）：第 2 轮：板「地址拆成三段」一屏放不下
- 注意：放不下（820×1180）：第 3 轮：板「组号只管选组」一屏放不下
- 注意：放不下（1180×820）：第 2 轮：板「地址拆成三段」一屏放不下
- 注意：放不下（1180×820）：第 3 轮：板「组号只管选组」一屏放不下

### co-asm.board.json

- 错：practice：「pick n = int(0, 12)」：n 是保留的名字，换一个

### co-cache.board.json

- 错：practice：「pick n = choice(8, 16, 32, 64)」：n 是保留的名字，换一个
- 注意：放不下（1180×820）：第 6 块板：板「换着数拆地址」一屏放不下

### co-float.board.json

- 错：bits：ask: 没有「sign」这种问题（这个演示能问的：exp、hex）
- 错：bits：ask: 没有「exp」这种问题（这个演示能问的：value）
- 错：practice：「pick n = int(1, 20)」：n 是保留的名字，换一个
- 注意：放不下（1180×820）：第 6 块板：板「换个数自己写」一屏放不下

### co-mem.board.json

- 错：practice：「pick x = int(0, g*2^k - 1)」：int(…) 里写整数（看不懂「g*2^k - 1」）

## 计网

| 文件 | 第一次 | 改过 | 错 | 注意 |
|---|---|---|---|---|
| class.class.json | ✓ |  | 0 | 3 |
| cn-crc.board.json | ✓ |  | 0 | 0 |
| cn-cwnd.board.json | ✓ |  | 0 | 1 |
| cn-dv.board.json | ✓ |  | 0 | 0 |
| cn-gbn.board.json | ✗ |  | 1 | 2 |
| cn-subnet.board.json | ✓ |  | 0 | 0 |
| cn-web.board.json | ✓ |  | 0 | 0 |

### class.class.json

- 注意：放不下（820×1180）：第 1 轮：板「丢了 2 号帧」一屏放不下
- 注意：放不下（1180×820）：第 1 轮：板「丢了 2 号帧」一屏放不下
- 注意：放不下（1180×820）：第 2 轮：板「乙只等一个号」一屏放不下

### cn-cwnd.board.json

- 注意：放不下（1180×820）：第 5 块板：板「换一组数」一屏放不下

### cn-gbn.board.json

- 错：practice：「pick n = int(2, 7)」：n 是保留的名字，换一个
- 注意：放不下（820×1180）：第 6 块板：板「自己来」一屏放不下
- 注意：放不下（1180×820）：第 6 块板：板「自己来」一屏放不下
