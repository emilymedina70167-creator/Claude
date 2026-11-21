### deque：双端队列（输入受限、输出受限）

```deque
id: dq-in
title: 输入受限
kind: in
push: 1 2 3 4
seq: 4 1 3 2
ask: possible, op
```

- `kind:` `in` 输入受限（右端能进能出，左端只能出）、`out` 输出受限（右端能进能出，左端只能进）、`both`。`push:` 依次进队的元素，`seq:` 要得到的出队序列。页面找一种做法一步步走；得不到的走到卡住的那一步，说要出的是哪个、为什么出不来。
- `ask:` `possible`（得不得到）、`op`（下一步做什么）。`options: 4 1 3 2, 4 2 1 3, 4 2 3 1` 配 `mode: quiz`：挑出得到的那几个。

- 错法诊断认得出：把输入受限当成输出受限（或者反过来）。

这是演示组件：先猜再揭晓（`ask`）、`mode: quiz` / `fill`、`vary:` 滑块、课堂里 `figure … set step=` 这些共用写法见 `components/stepper.md`。
