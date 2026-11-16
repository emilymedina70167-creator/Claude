# 模拟课 ds-nextval（数据结构，计划块开）

## 第 1 轮 · 老师

这节课分三块：先确认 next 还记得，再讲 nextval 怎么来、为什么要那样比，最后用 aaaab 练一道、放到匹配上走一遍，走完就停。先写一个 next。

````board plan
目标：学生手算 abaabcac、aaaab 的 nextval，说清为什么 T[j]=T[next[j]] 时要继续往前退，并用到匹配上
猜：next 可能忘了 +1，或者把前后缀取到了 T[1..j] 而不是 T[1..j−1]
证实：b1 用 kmp quiz 写 abaabcac 的 next（答案 0 1 1 2 2 3 1 2），看页面的错法诊断；对了第二块直接讲 nextval
````

````board new id=b1 title="先确认 next"
**这节课要回答：** next 已经能用来匹配了，nextval 改进的是什么、怎么从 next 算出来。

<small>这节课三块：① 确认 next（这一块，就 1 题）　② nextval 的规则和来由（用 abaabcac）　③ aaaab 练一题 + 放到匹配里走一遍，走完就停</small>

口径照王道：位置**从 1 数**，==next[1] = 0==。

```kmp
id: q-next1
title: 写出 next 数组
pattern: abaabcac
show: next
mode: quiz
```
````

按你记得的算法写出 8 个数就行，这块只有这一题。

### 学生看到的

# 第 1 块板「先确认 next」

老师写在板顶的话：这节课分三块：先确认 next 还记得，再讲 nextval 怎么来、为什么要那样比，最后用 aaaab 练一道、放到匹配上走一遍，走完就停。先写一个 next。

按你记得的算法写出 8 个数就行，这块只有这一题。

## 先确认 next
**这节课要回答：** next 已经能用来匹配了，nextval 改进的是什么、怎么从 next 算出来。

<small>这节课三块：① 确认 next（这一块，就 1 题）　② nextval 的规则和来由（用 abaabcac）　③ aaaab 练一题 + 放到匹配里走一遍，走完就停</small>

口径照王道：位置**从 1 数**，==next[1] = 0==。

【演示 kmp q-next1】写出 next 数组
  输入：pattern: abaabcac
  写出模式串 abaabcac 的 next 数组（从 j = 1 开始）。
  （写出结果）


（回复一个 JSON：{"say": "…", "acts": [{"comp": "组件 id", "value": "…"}], "sure": {"组件 id": true/false}}；不会就 {"comp": "…", "giveup": true}）

## 第 2 轮 · 学生

next 是 0 1 1 2 2 3 1 2
[作答] b1 里的 kmp q-next1「写出 next 数组」：写出结果，「写出模式串 abaabcac 的 next 数组（从 j = 1 开始）。」做对了（共 1 次）
[动作] b1 里的组件 q-next1：学生标了「有把握」

## 第 3 轮 · 老师

next 对了。这一块回答：按 next 退了之后，为什么有的比较是白比的。

````board new id=b2 title="next 哪里白比了"
**这一块要回答：** 失配后按 next 退，下一次比较有时**不用比就知道一定失配**——是哪种情况、凭什么知道。

模式串还是 abaabcac，next = 0 1 1 2 2 3 1 2。主串取 abaaxabaabcac：前 4 个字符对上，第 5 个 **x** 和 T[5] = b 失配。

下面按 next 一步步走，留意 **x 失配以后连着发生的那几次比较**。

```kmp
id: fig-b2
title: 用 next 匹配
pattern: abaabcac
text: abaaxabaabcac
show: match
```

```conjecture
id: q-b2
title: 不比就能知道
q: x 和 T[5] 失配后，j 退到 next[5] = 2，接着拿 x 去比 T[2]。这一次比较，其实在 x 和 T[5] 失配那一刻就能断定结果。结果是什么？凭的是哪两个已知事实？
rubric: 要点 (1) 结果：一定失配；(2) 依据：T[2] = T[5]（都是 b），而 x ≠ T[5]，所以 x ≠ T[2]。只说「x 不是 b」没点出 T[2] 和 T[5] 相同算部分正确。
answer: 一定失配。因为 T[2] 和 T[5] 都是 b，而刚刚已经知道 x ≠ T[5]，所以 x ≠ T[2]，这次比较白比。
placeholder: 结果是……，因为……
```
````

先在上面的演示里点着走过 x 那几次比较，再写下面这题。

### 学生看到的

# 第 2 块板「next 哪里白比了」

老师写在板顶的话：next 对了。这一块回答：按 next 退了之后，为什么有的比较是白比的。

先在上面的演示里点着走过 x 那几次比较，再写下面这题。

## next 哪里白比了
**这一块要回答：** 失配后按 next 退，下一次比较有时**不用比就知道一定失配**——是哪种情况、凭什么知道。

模式串还是 abaabcac，next = 0 1 1 2 2 3 1 2。主串取 abaaxabaabcac：前 4 个字符对上，第 5 个 **x** 和 T[5] = b 失配。

下面按 next 一步步走，留意 **x 失配以后连着发生的那几次比较**。

【演示 kmp fig-b2】用 next 匹配
  输入：pattern: abaabcac；text: abaaxabaabcac
  （演示，一步步看；没有要你答的）

【conjecture q-b2】
  id: q-b2
  title: 不比就能知道
  q: x 和 T[5] 失配后，j 退到 next[5] = 2，接着拿 x 去比 T[2]。这一次比较，其实在 x 和 T[5] 失配那一刻就能断定结果。结果是什么？凭的是哪两个已知事实？
  rubric: 要点 (1) 结果：一定失配；(2) 依据：T[2] = T[5]（都是 b），而 x ≠ T[5]，所以 x ≠ T[2]。只说「x 不是 b」没点出 T[2] 和 T[5] 相同算部分正确。
  placeholder: 结果是……，因为……


（回复一个 JSON：{"say": "…", "acts": [{"comp": "组件 id", "value": "…"}], "sure": {"组件 id": true/false}}；不会就 {"comp": "…", "giveup": true}）

## 第 4 轮 · 学生

T[2] 也是 b，x 跟 b 失配了，那跟 T[2] 肯定也不等吧？这样算白比？不太确定
[作答] b2 里的 conjecture q-b2「不比就能知道」：写了「一定失配。因为 T[2] 和 T[5] 都是 b，x 和 T[5] 不相等，所以 x 和 T[2] 也不相等。」
[动作] b2 里的组件 q-b2：学生标了「没把握」

## 第 5 轮 · 老师

结论和依据都对：x ≠ T[5]，T[2] = T[5]，所以 x ≠ T[2]，这次比较的结果在比之前就定了。

你标了没把握，不踏实的是哪一点？说说你是怎么想的。

### 学生看到的

# 第 2 块板「next 哪里白比了」

老师写在板顶的话：结论和依据都对：x ≠ T[5]，T[2] = T[5]，所以 x ≠ T[2]，这次比较的结果在比之前就定了。

你标了没把握，不踏实的是哪一点？说说你是怎么想的。

## next 哪里白比了
**这一块要回答：** 失配后按 next 退，下一次比较有时**不用比就知道一定失配**——是哪种情况、凭什么知道。

模式串还是 abaabcac，next = 0 1 1 2 2 3 1 2。主串取 abaaxabaabcac：前 4 个字符对上，第 5 个 **x** 和 T[5] = b 失配。

下面按 next 一步步走，留意 **x 失配以后连着发生的那几次比较**。

【演示 kmp fig-b2】用 next 匹配
  输入：pattern: abaabcac；text: abaaxabaabcac
  （演示，一步步看；没有要你答的）

【conjecture q-b2】
  id: q-b2
  title: 不比就能知道
  q: x 和 T[5] 失配后，j 退到 next[5] = 2，接着拿 x 去比 T[2]。这一次比较，其实在 x 和 T[5] 失配那一刻就能断定结果。结果是什么？凭的是哪两个已知事实？
  rubric: 要点 (1) 结果：一定失配；(2) 依据：T[2] = T[5]（都是 b），而 x ≠ T[5]，所以 x ≠ T[2]。只说「x 不是 b」没点出 T[2] 和 T[5] 相同算部分正确。
  placeholder: 结果是……，因为……


（回复一个 JSON：{"say": "…", "acts": [{"comp": "组件 id", "value": "…"}], "sure": {"组件 id": true/false}}；不会就 {"comp": "…", "giveup": true}）

## 第 6 轮 · 学生

我是顺着 b 推的，感觉这题只是碰巧 T[2] 和 T[5] 都是 b。不知道一般是不是都这样，还有那 nextval 到底跟 next 差在哪我也说不清，是不是就是 next 改一下？

## 第 7 轮 · 老师

不是碰巧，有一般规律；nextval 也确实是「next 改一下」，改哪几格由这个规律决定。看下面。

````board new id=b3 title="什么时候白比，白比了怎么办"
**这一块要回答：** 什么时候按 next 退了还是白比；白比了退到哪；nextval 跟 next 差在哪。

**不是碰巧。** 在 T[j] 处失配时，我们手里只有一条信息：==主串这个字符 ≠ T[j]==。按 next 退到 k = next[j]，下一次拿它去比 T[k]，只有两种情况：

| T[k] 和 T[j] | 这次比较 | abaabcac 里的例子 |
|---|---|---|
| **相同** | 一定失配，白比 | j = 5：T[5] = b，k = 2，T[2] = b |
| **不同** | 结果不知道，必须比 | j = 6：T[6] = c，k = 3，T[3] = a。主串字符 ≠ c，但可能就是 a |

**白比了就接着退**，直到不白比为止：

1. 从 k = next[j] 开始，比 T[k] 和 T[j]
2. 不同：停，答案就是 k
3. 相同：这一格白比，令 k = next[k]，回到第 1 步；k 退到 0 就停，答案是 0（0 的意思和 next 里一样：主串指针后移一位，j 从 1 重新比）

```derive
id: d-b3
title: 例：j = 5
\text{从 } k=\text{next}[5]=2:\ T[2]=\mathrm b=T[5]   // 相同，白比，接着退
\text{再退 } k=\text{next}[2]=1:\ T[1]=\mathrm a\ne \mathrm b   // 不同，停
\text{nextval}[5]=1
```

```remember
title: nextval 是什么
==nextval[j]：在 j 处失配时，跳过所有白比的位置之后真正该退到的位置。== 和 next 一样长、从 next 算出来；只在 T[j] = T[next[j]] 的那几格和 next 不同。匹配过程完全不变，只是失配时查 nextval 不查 next。
```

```kmp
id: q-b3
title: 按上面的步骤写 nextval
pattern: abaabcac
show: nextval
mode: quiz
```
````

````board mark target=b3 li=1-3 style=brace color=yellow note="照着做"
````

这块就一题：按黄括号里的三步，把 abaabcac 的 nextval 全写出来（next 是 0 1 1 2 2 3 1 2）。

### 学生看到的

# 第 3 块板「什么时候白比，白比了怎么办」

老师写在板顶的话：不是碰巧，有一般规律；nextval 也确实是「next 改一下」，改哪几格由这个规律决定。看下面。

这块就一题：按黄括号里的三步，把 abaabcac 的 nextval 全写出来（next 是 0 1 1 2 2 3 1 2）。

## 什么时候白比，白比了怎么办
**这一块要回答：** 什么时候按 next 退了还是白比；白比了退到哪；nextval 跟 next 差在哪。

**不是碰巧。** 在 T[j] 处失配时，我们手里只有一条信息：==主串这个字符 ≠ T[j]==。按 next 退到 k = next[j]，下一次拿它去比 T[k]，只有两种情况：

| T[k] 和 T[j] | 这次比较 | abaabcac 里的例子 |
|---|---|---|
| **相同** | 一定失配，白比 | j = 5：T[5] = b，k = 2，T[2] = b |
| **不同** | 结果不知道，必须比 | j = 6：T[6] = c，k = 3，T[3] = a。主串字符 ≠ c，但可能就是 a |

**白比了就接着退**，直到不白比为止：

1. 从 k = next[j] 开始，比 T[k] 和 T[j]
2. 不同：停，答案就是 k
3. 相同：这一格白比，令 k = next[k]，回到第 1 步；k 退到 0 就停，答案是 0（0 的意思和 next 里一样：主串指针后移一位，j 从 1 重新比）

【derive d-b3】
  id: d-b3
  title: 例：j = 5
  \text{从 } k=\text{next}[5]=2:\ T[2]=\mathrm b=T[5]   // 相同，白比，接着退
  \text{再退 } k=\text{next}[2]=1:\ T[1]=\mathrm a\ne \mathrm b   // 不同，停
  \text{nextval}[5]=1

【remember （没写 id）】
  title: nextval 是什么
  ==nextval[j]：在 j 处失配时，跳过所有白比的位置之后真正该退到的位置。== 和 next 一样长、从 next 算出来；只在 T[j] = T[next[j]] 的那几格和 next 不同。匹配过程完全不变，只是失配时查 nextval 不查 next。

【演示 kmp q-b3】按上面的步骤写 nextval
  输入：pattern: abaabcac
  写出模式串 abaabcac 的 nextval 数组（从 j = 1 开始）。
  （写出结果）


（回复一个 JSON：{"say": "…", "acts": [{"comp": "组件 id", "value": "…"}], "sure": {"组件 id": true/false}}；不会就 {"comp": "…", "giveup": true}）

## 第 8 轮 · 学生

按三步走了一遍，j=3、j=7 是 a 跟 T[1] 相同，退到 0；j=5 退到 1。
[作答] b3 里的 kmp q-b3「按上面的步骤写 nextval」：写出结果，「写出模式串 abaabcac 的 nextval 数组（从 j = 1 开始）。」做对了（共 1 次）
[动作] b3 里的组件 q-b3：学生标了「有把握」

## 第 9 轮 · 老师

对，0 1 0 2 1 3 0 2。下面把你走的那条链缩成一步查表，这就是王道写的公式。

````board new id=b4 title="链缩成一步：公式"
**这一块要回答：** 相等时不用一格格往前退，为什么直接抄 nextval[next[j]] 就行。

设 k = next[j]，且 T[j] = T[k]。你接着退的那条链，每一步都在「拿 T[j] 去比」：

```derive
id: d-b4
title: 为什么等于 nextval[k]
\text{从 } j \text{ 往前退：比 } T[j] \text{ 和 } T[\text{next}[k]],\ T[\text{next}[\text{next}[k]]],\ \dots   // 你刚才走的链
T[j]=T[k] \Rightarrow \text{每一步换成 “比 } T[k]\text{” 结果一样}   // 字符相同，比谁都一样
\text{这正是从 } k \text{ 往前退算 nextval}[k] \text{ 的那条链}   // 同一条链
\text{nextval}[j]=\text{nextval}[k]   // 从左往右算，nextval[k] 已经算好了
```

例：abaabcac 的 j = 7，T[7] = a，k = next[7] = 1，T[1] = a 相同，所以 nextval[7] = nextval[1] = 0，一步查到，不用再走链。

```remember
title: nextval 的算法（王道）
nextval[1] = 0；j 从 2 往右，设 k = next[j]：
- ==T[j] ≠ T[k]：nextval[j] = next[j]==
- ==T[j] = T[k]：nextval[j] = nextval[k]==（抄前面已经算好的 nextval，不是 next）
```

```kmp
id: q-b4
title: 求 aaaab 的 nextval
pattern: aaaab
show: nextval
mode: quiz
```
````

这块一题：用公式写 aaaab 的 nextval（它的 next 是 0 1 2 3 4）。做完这块，最后一块把 nextval 放到匹配里走一遍就收。

### 学生看到的

# 第 4 块板「链缩成一步：公式」

老师写在板顶的话：对，0 1 0 2 1 3 0 2。下面把你走的那条链缩成一步查表，这就是王道写的公式。

这块一题：用公式写 aaaab 的 nextval（它的 next 是 0 1 2 3 4）。做完这块，最后一块把 nextval 放到匹配里走一遍就收。

## 链缩成一步：公式
**这一块要回答：** 相等时不用一格格往前退，为什么直接抄 nextval[next[j]] 就行。

设 k = next[j]，且 T[j] = T[k]。你接着退的那条链，每一步都在「拿 T[j] 去比」：

【derive d-b4】
  id: d-b4
  title: 为什么等于 nextval[k]
  \text{从 } j \text{ 往前退：比 } T[j] \text{ 和 } T[\text{next}[k]],\ T[\text{next}[\text{next}[k]]],\ \dots   // 你刚才走的链
  T[j]=T[k] \Rightarrow \text{每一步换成 “比 } T[k]\text{” 结果一样}   // 字符相同，比谁都一样
  \text{这正是从 } k \text{ 往前退算 nextval}[k] \text{ 的那条链}   // 同一条链
  \text{nextval}[j]=\text{nextval}[k]   // 从左往右算，nextval[k] 已经算好了

例：abaabcac 的 j = 7，T[7] = a，k = next[7] = 1，T[1] = a 相同，所以 nextval[7] = nextval[1] = 0，一步查到，不用再走链。

【remember （没写 id）】
  title: nextval 的算法（王道）
  nextval[1] = 0；j 从 2 往右，设 k = next[j]：
  - ==T[j] ≠ T[k]：nextval[j] = next[j]==
  - ==T[j] = T[k]：nextval[j] = nextval[k]==（抄前面已经算好的 nextval，不是 next）

【演示 kmp q-b4】求 aaaab 的 nextval
  输入：pattern: aaaab
  写出模式串 aaaab 的 nextval 数组（从 j = 1 开始）。
  （写出结果）


（回复一个 JSON：{"say": "…", "acts": [{"comp": "组件 id", "value": "…"}], "sure": {"组件 id": true/false}}；不会就 {"comp": "…", "giveup": true}）

## 第 10 轮 · 学生

j=2、3、4 都是 a 跟前面的 a 相同，一路抄 0；j=5 是 b，跟 T[4]=a 不同，就是 next[5]=4。
[作答] b4 里的 kmp q-b4「求 aaaab 的 nextval」：写出结果，「写出模式串 aaaab 的 nextval 数组（从 j = 1 开始）。」做对了（共 1 次）
[动作] b4 里的组件 q-b4：学生标了「有把握」

## 第 11 轮 · 老师

对，0 0 0 0 4。最后一块：nextval 放进匹配里，到底省了什么。

````board new id=b5 title="nextval 用在匹配上"
**这一块要回答：** 匹配时把 next 换成 nextval，过程哪里变了、省下了什么。

**流程一点没变**，只换了失配时查的那张表：

1. 主串字符 = T[j]：i、j 都加 1
2. 不等：==i 不动，j 退到 nextval[j]==（原来是 next[j]），再拿同一个主串字符比
3. j 退到 0：i、j 都加 1（主串指针后移，模式串从头比）

**例子：** 模式串 aaaab（next = 0 1 2 3 4，nextval = 0 0 0 0 4），主串 aaabaaaab。前 3 个 a 对上，主串第 4 个字符 **b** 和 T[4] = a 失配。

```answer
id: q-b5
title: 同一个 b 还要比几次
q: 主串第 4 个字符 b 和 T[4] 失配之后，到主串指针后移之前，这个 b 还要再和模式串比较几次？分别写用 next 时、用 nextval 时的次数。
answer: [3, 0]
before: (\text{用 next},\ \text{用 nextval}) =
```
````

````board add id=b6 hold title="两张表对着走一遍"
左边按 next 走、下面按 nextval 走，看 b 失配后的那几步。

```kmp
id: fig-b6a
title: 用 next 匹配
pattern: aaaab
text: aaabaaaab
show: match
```

```kmp
id: fig-b6b
title: 用 nextval 匹配
pattern: aaaab
text: aaabaaaab
show: match
use: nextval
```
````

````board react target=q-b5
right show=b6: 对。用 next 时 b 依次撞 T[3]、T[2]、T[1] 三个 a，全是白比；nextval[4] = 0 直接让主串后移。下面两个演示可以对着走一遍看。
````

````board mark target=b5 li=1-3 style=brace color=yellow note="匹配流程"
````

这块一题，填两个数。

### 学生看到的

# 第 5 块板「nextval 用在匹配上」

老师写在板顶的话：对，0 0 0 0 4。最后一块：nextval 放进匹配里，到底省了什么。

这块一题，填两个数。

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


（回复一个 JSON：{"say": "…", "acts": [{"comp": "组件 id", "value": "…"}], "sure": {"组件 id": true/false}}；不会就 {"comp": "…", "giveup": true}）

## 第 12 轮 · 学生

用 next：4→3→2→1，b 还要比 T[3]、T[2]、T[1] 三次，都失配，然后 j 到 0。用 nextval：nextval[4]=0，直接到 0，不用再比。
[作答] b5 里的 answer q-b5「同一个 b 还要比几次」：填了 用 next 还要比 3 次（T[3]、T[2]、T[1]）；用 nextval 0 次，直接 j=0、主串指针后移。（第 1 次）
[动作] b5 里的组件 q-b5：学生标了「有把握」

## 第 13 轮 · 老师

对：用 next 时 b 依次撞 T[3]、T[2]、T[1]，三次全是白比；nextval[4] = 0，主串直接后移。两张表的演示放在下面，想对照可以点着走。

到这里这节课的三块都讲完了。按你在板上的作答，你现在能做的是：给一个模式串，手算 next 和 nextval（王道口径）；说出 T[j] = T[next[j]] 时为什么那一次比较必然失配、为什么可以直接抄 nextval[next[j]]；匹配时用 nextval 代替 next 来退 j。下次课前用一个新模式串复现一题 nextval。

````board show id=b6
````

````board react target=q-b5
````

````board memo
recall q="nextval[j] 怎么由 next 算（王道口径，k = next[j]）" a="nextval[1] = 0；T[j] ≠ T[k] 时 nextval[j] = next[j]；T[j] = T[k] 时 nextval[j] = nextval[k]（抄前面已算好的 nextval，不是 next）"
recall q="为什么 T[j] = T[next[j]] 时按 next 退的那次比较一定失配" a="失配说明主串字符 ≠ T[j]；T[next[j]] 和 T[j] 是同一个字符，所以主串字符也 ≠ T[next[j]]，这次比较是白比"
review title="KMP next / nextval" family=串的模式匹配 content="手算 next、nextval（王道口径，从 1 数）；相等时为什么退到 nextval[k]；匹配时失配后 j 退到 nextval[j]" basis=q-next1,q-b3,q-b4,q-b5
position next="KMP nextval 讲完；下次课前复现一题：换一个新模式串（如 ababaaab）求 next 和 nextval，并问一处相等格为什么抄 nextval[k]"
````

### 学生看到的

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

## 第 14 轮 · 学生

懂了。nextval 就是把白比的格子跳掉。