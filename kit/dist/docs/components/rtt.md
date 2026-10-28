### rtt：HTTP 要几个 RTT

```rtt
id: rt1
objects: 8
http: non
parallel: 5
ask: total
```

- `objects:` 引用几个对象；`http:` `non`（非持久，`parallel:` 并行数）、`persist`、`pipeline`；`dns: 2` 先查几次 DNS；`rtt: 20ms`（`dnsrtt:`）算总时间。
- `ask:` `base` `obj` `total` `time`。

- 按王道：不算传输时间，建 TCP 连接 1 个 RTT（第三次握手捎带 HTTP 请求），请求一个对象再收到它 1 个 RTT。非持久每个对象都要新连接（2 个 RTT），并行 M 个时 ⌈N ÷ M⌉ 批；持久非流水线每个对象 1 个 RTT；持久流水线所有对象一共 1 个 RTT。画成横着的时间条：一格一个 RTT，握手紫、基本页蓝、对象绿、DNS 黄，并行的连接一行一条；最后一步把三种方式的 RTT 数并排比一比。
- `total` 只数和 Web 服务器之间的 RTT（不算 DNS）；`time` 要写了 `rtt:`，DNS 每次按 `dnsrtt:`（不写就和 `rtt:` 一样）。
- `mode: quiz`：写一共几个 RTT（写了 `rtt:` 就写总时间）。`mode: fill`：每一段几个 RTT，下面再写总数。
- 错法诊断认得出：忘了 TCP 握手、忘了基本页面那个 RTT、流水线和非流水线弄混、并行的批数没向上取整、没管并行数的上限。
