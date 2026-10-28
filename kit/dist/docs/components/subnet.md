### subnet / tcp / window：计算机网络

```subnet
id: n-vlsm
title: 按主机数划分
split: 192.168.1.0/24
hosts: 60, 30, 10
ask: subnet
```

- **`subnet` IP 地址和子网**，四种用法：
  - `ip: 192.168.10.130/26`：32 位按「网络号 | 主机号」画出来，一步步写子网掩码、网络地址（主机号全 0）、广播地址（主机号全 1）、可用地址范围和个数（2^h − 2）。`ask:` 能问 `mask` `net` `bcast`（写点分十进制）、`hosts`。`mode: quiz` 配 `quiz: net / bcast / hosts / mask`。
  - `split: 192.168.1.0/24` 配 `into: 4`（等分成几个，借几位当子网号）或 `hosts: 60, 30, 10`（按主机数，先分要求多的，每个子网取能放下「主机数 + 2」的最小的 2 的幂，地址从小往大）。画一条地址条和每个子网的表。`ask: subnet`（这个子网的网络地址）。
  - `table: 192.168.1.0/24 -> R1, 192.168.1.128/25 -> R2, 0.0.0.0/0 -> R3` 配 `dst: 192.168.1.200`：最长前缀匹配，一项一项比，最后选前缀最长的。`ask:` 能问 `match`（这一项匹配吗）、`hop`（最后用哪一项，点出来）。`mode: quiz`：下一跳。
  - `aggregate: 172.16.0.0/24, 172.16.1.0/24, …`：路由聚合，写成二进制找最长的共同前缀。`ask: agg`；`mode: quiz`。
- **`tcp`**，四种用法：
  - `ssthresh: 16`、`rounds: 20`、`events: 3dup@12, timeout@16`（第 12 轮收到 3 个重复确认，第 16 轮超时）、`variant: reno`（默认；`tahoe`：3 个重复确认也让 cwnd 回到 1）：cwnd 每个传输轮次怎么变的折线图（ssthresh 画成虚线）。慢开始每轮翻倍但不超过 ssthresh，到了 ssthresh 拥塞避免每轮加 1；3 个重复确认：ssthresh = cwnd / 2，cwnd = ssthresh（快恢复）；超时：ssthresh = cwnd / 2，cwnd = 1。`ask: cwnd`（这一轮的 cwnd）；`mode: quiz` 配 `at: 13` 问第 13 轮的 cwnd。
  - `handshake: x=100, y=300`：三次握手的时序图，每个报文段的 SYN、ACK、seq、ack，两边的状态。`ask:` 能问 `ack`、`seq`。
  - `close: u=500, v=800, w=900`：四次挥手（FIN 消耗一个序号，TIME-WAIT 等 2MSL）。`ask: ack`。
  - `send: 70 100` 配 `last: 180`（各报文段的序号、最后一段到达后的确认号）或 `seq: 1000` 配 `lens: 200 300`：传数据的时序图，累积确认；`lost: 1` 第 1 个第一次丢了（B 暂存失序的，重传后一起确认）。`ask:` 能问 `len`、`seq`、`ack`；`mode: quiz` 依次写确认号。
- **`window` 滑动窗口**：`proto:` 选 `sw`（停止-等待）、`gbn`（后退 N 帧）、`sr`（选择重传）；`frames: 6`（发几帧，从 0 编号）、`window: 4`（发送窗口，SR 的接收窗口一样大）、`lost: 2`（这几个帧第一次发送时丢失）、`acklost: 1`（这几个帧的确认第一次丢失），可选 `delay: 2`（单程传播几个时间单位）、`timeout:`（默认 2 × delay + 2）。每个时间单位一步：画时序图（丢的线是虚线打 ✗，重传的是粉色）和发送窗口。GBN 接收方只收按序的、累积确认，超时从出错的帧起全部重传；SR 缓存失序帧、单独确认、只重传超时的。`ask:` 能问 `resend`（超时后重传哪几个，写帧号）、`total`（一共发了几帧）；`mode: quiz`：一共发了几个数据帧。

- `mode: fill`：`subnet` 填网络地址、广播地址、可用地址范围和个数（划分子网、路由聚合各有一张表）；`tcp` 每一轮一列（cwnd、ssthresh）；`window` 每一帧发了几次。
- **TCP 的轮次口径**：第 1 轮的 cwnd 就是初始值（`init:`），每过一个 RTT 是下一轮；慢开始翻倍、到 ssthresh 后加 1；超时时 ssthresh = ⌊cwnd / 2⌋（最少 2）、cwnd 回到 1；3 个重复确认（Reno）ssthresh = ⌊cwnd / 2⌋、cwnd = ssthresh（Tahoe 和超时一样）。题目的轮次从 0 数时，`init` 那一轮就是第 0 轮，自己对一下。
- 错法诊断认得出：主机数没减 2、广播地址只把最后一段写成 255、去掉了全 0 全 1 的子网号、广播地址多算 1、没先给主机多的子网分；路由表用了第一个匹配的、按整段比；聚合前缀多数 / 少数一位、没把后面的位清 0；TCP 的 Reno 和 Tahoe 弄混、慢开始翻倍越过 ssthresh、把原来的 ssthresh 减半、超时也快恢复；GBN 和 SR 弄混、GBN 只重传超时那一帧、SR 把后面的也重传、累积确认用错；停止-等待以为确认丢了不用重传。
