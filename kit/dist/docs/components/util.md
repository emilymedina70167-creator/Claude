### util：信道利用率

```util
id: ut1
proto: gbn
window: 1000
frame: 1000B
rate: 100Mb/s
delay: 50ms
ask: u, thru
```

- `proto:` `sw` / `gbn` / `sr`；`window:` 或 `seqbits:`；`ack:` 确认帧长（`same` 等长）；`data:` 有效数据；`target: 80%` 求最小窗口、序号位数，不写 `frame:` 求最短帧长。
- `ask:` `tframe` `cycle` `u` `thru` `wmin` `seqbits` `lmin`。

- 按王道：发送时延 = 帧长 ÷ 数据率；一个周期 = 发送时延 + RTT（2 × 单程传播时延，`delay:`；或 `dist:` 配 `v:`）+ 确认帧的发送时延（给了 `ack:` 才算）；U = 窗口 × 发送时延 ÷ 周期，最大 100%；吞吐率 = U × 数据率（给了 `data:` 就是有效数据传输速率）。画成一个周期的时间线：数据帧是斜着的带子，确认是绿线（或绿带），左边实线是在发、虚线是空等。
- `target:`：GBN / SR 求窗口至少多大（⌈target × 周期 ÷ 发送时延⌉）和帧序号至少几位（GBN 窗口 ≤ 2^n − 1，SR ≤ 2^(n−1)）；GBN / SR 没写窗口时默认 `target: 100%`。停止-等待写了 `frame:` 和 `target:` 就问能不能达到（`ask: reach`）；不写 `frame:` 就反过来求帧长至少多少比特。`seqbits: 3` 先算最大窗口（`ask: window`）。帧长是一个范围的题（128～512B）写最短的那个。
- `mode: quiz`：只写一个数，`want:` 挑（`u` `thru` `cycle` `tframe` `wmin` `seqbits` `lmin`），不写就是：求帧长 / 序号位数时写它，有 `data:` 写有效数据传输速率，不然写利用率（百分数里的数）。`mode: fill`：每个量一行，单位写在行名里；除不尽的写到两位小数。
- 错法诊断认得出：周期里只算单程传播时延、忘了发送时延、忘了确认帧的时延、利用率超过 100%、GBN 和 SR 的序号公式弄混。
