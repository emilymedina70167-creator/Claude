### drill：句型操练（一题一题做，页面判分）

```drill
id: d-passive
title: 主动变被动
q: 把句子改成被动语态。
count: 3
- They built this bridge in 1990. => This bridge was built in 1990.
- People say that he is rich. => He is said to be rich. | It is said that he is rich.
- Someone has stolen my bike. => My bike has been stolen.
- They will hold the meeting tomorrow. => The meeting will be held tomorrow.
```

- 一行一题：`- 原句 => 答案`，几种都对时 `a | b`。`count:` 这次做几题（默认全做），题目默认打乱（`shuffle: off` 照原样）。
- 整句作答：句末标点可写可不写，大小写、缩写同上。错三次可以看答案，做完一题点「下一题」，最后告诉我一次就对了几题。
- 常见错答写在答案后面：`- They built it. => It was built. | !It built.=少了 be 动词`。
- 我写的和答案都不一样、又不是你列的错答时（可能只是换了说法、语序），页面会问一次 Claude 复核（几秒，一两千 token）：它说对就算对，记录里写「Claude 复核：…」。答案照样尽量列全，复核只是兜底。
