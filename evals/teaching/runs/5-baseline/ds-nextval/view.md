# 第 5 块板「nextval 用在匹配上」

老师写在板顶的话：对：用 next 时 b 依次撞 T[3]、T[2]、T[1]，三次全是白比；nextval[4] = 0，主串直接后移。两张表的演示放在下面，想对照可以点着走。

到这里这节课的三块都讲完了。按你在板上的作答，你现在能做的是：给一个模式串，手算 next 和 nextval（王道口径）；说出 T[j] = T[next[j]] 时为什么那一次比较必然失配、为什么可以直接抄 nextval[next[j]]；匹配时用 nextval 代替 next 来退 j。下次课前用一个新模式串复现一题 nextval。

## nextval 用在匹配上
**这一块要回答：** 匹配时把 next 换成 nextval，过程哪里变了、省下了什么。

**流程一点没变**，只换了失配时查的那张表：

1. 主串字符 = T[j]：i、j 都加 1
2. 不等：==i 不动，j 退到 nextval[j]==（原来是 next[j]），再拿同一个主串字符比
3. j 退到 0：i、j 都加 1（主串指针后移，模式串从头比）

**例子：** 模式串 aaaab（next = 0 1 2 3 4，nextval = 0 0 0 0 4），主串 aaabaaaab。前 3 个 a 对上，主串第 4 个字符 **b** 和 T[4] = a 失配。

【作答题 q-b5】同一个 b 还要比几次
  主串第 4 个字符 b 和 T[4] 失配之后，到主串指针后移之前，这个 b 还要再和模式串比较几次？分别写用 next 时、用 nextval 时的次数。
  （写出答案）

## 两张表对着走一遍
左边按 next 走、下面按 nextval 走，看 b 失配后的那几步。

【演示 kmp fig-b6a】用 next 匹配
  输入：pattern: aaaab；text: aaabaaaab
  （演示，一步步看；没有要你答的）

【演示 kmp fig-b6b】用 nextval 匹配
  输入：pattern: aaaab；text: aaabaaaab；use: nextval
  （演示，一步步看；没有要你答的）


（回复一个 JSON：{"say": "…", "acts": [{"comp": "组件 id", "value": "…"}], "sure": {"组件 id": true/false}}；不会就 {"comp": "…", "giveup": true}）