### cqueue：循环队列

```cqueue
id: cq1
size: 6
ops: enqueue a b c d e, dequeue 2, enqueue f g h
ask: rear, full
```

- `size:` MaxSize；`ops:` 入队 `enqueue a b`、出队 `dequeue`（`dequeue 2` 出两个），一个元素一步。
- `full:` `spare`（牺牲一个单元，默认）、`count`（增设 size）、`tag`（增设 tag）。
- `ask:` `front` `rear` `len`、`full`（入队前满了吗）、`empty`。

- 按王道：front 指队头元素，rear 指队尾元素的下一个位置；入队放进 Q[rear]，rear = (rear + 1) % MaxSize。画成一圈（下标在里圈，front / rear 的箭头在外圈）；`draw: row` 画成一排，size 大于 12 自动一排。
- 一开始 front = rear = 0；`front: 3`、`rear: 0` 换起点（中间原来就有的元素画成 ·），对应「当前 rear = 0、front = 3，删一个再加两个」这类题。入队失败（满）、出队失败（空）也算一步，指针不动。
- `mode: quiz`：做完以后的 front、rear、长度（三个数）。`mode: fill`：每一步之后的 front、rear、长度。
- 错法诊断认得出：长度公式没先加 MaxSize（rear 绕回来以后得负数）、把 rear == front 当队满（牺牲的那格也放了）、指针加 1 以后没取模、增设 size / tag 以后还按牺牲一个单元判满。
