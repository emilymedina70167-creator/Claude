### shift：句子变换（主动变被动、强调句、倒装还原……）

```shift
id: sh-pass
title: 主动变被动
from: [S The committee] [V approved] [O the plan] [A yesterday].
to: [O=S The plan] [V was approved] [S=A by the committee] [A yesterday].
mode: do
decoys: V = approved | has approved
```

- `from:` 原句、`to:` 变换以后，都用 `[成分 词…]` 括出成分（不套）；两行按成分名一一对上，同名的第二个写 `A#2`；成分变了写 `[O=S The plan]`（和原句的 O 配对，这里是主语）。新加的词（`It was` `that`、there）写在括号外面，页面认成新加的、去掉的；句首的大小写、标点不算词变了。
- `mode: show`（默认）：点「下一步」，一个成分带着颜色挪到新位置，原处留一个淡的影子；挪完标出哪些词变了（原来是什么）、新加和去掉的词。课堂里 `figure set step=2` / `figure play step 0 4 4s`（step 是挪了几个）。
- `mode: do`：我自己排顺序，再选变了的词的形式（`decoys:`）。

- `mode: do` 细说：我把上面的成分点下来（或者拖到某个空位上）排顺序，放好的能拖着对调、点一下拿回去；放错只说第几个位置不对。顺序对了以后，`decoys:` 里写了的成分（一行一个：`V = 错的 | 错的`）再让我选它在新句子里的形式；没写 `decoys:` 的不问。
