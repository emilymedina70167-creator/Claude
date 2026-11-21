### parallel：平行结构（并列的几项上下对齐）

```parallel
id: pl-odd
title: 哪一项不平行
text: She likes [reading novels], [writing letters], and [to swim].
ask: odd
answer: 3
fix: swimming
decoys: swim | to swimming
explain: 并列的三项要同一种形式：前两项是 doing，第三项也写 swimming。
```

- `text:` 里用方括号括出并列的每一项（至少两项，不套）。页面把公共的开头（She likes）放在左边，每一项另起一行上下排齐、开头的词加粗，并列连词标出来。
- 不写 `ask:` 只展示。`ask: starts`：句子先是普通的一行，我点每一项的第一个词，点对了那一项跳到对齐的位置上。`ask: odd`：我点出不平行的那一项（`answer:` 第几项），再从改法里选（`fix:` 是对的，`decoys:` 是错的，`|` 隔开）。
- 判错只说哪里不对，不说答案；两次不对能看答案。
