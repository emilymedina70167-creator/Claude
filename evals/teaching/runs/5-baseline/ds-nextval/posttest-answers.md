## p1
T = a b a b a a a b

**next**：0 1 1 2 3 4 2 2

**nextval**（对每个 j，k=next[j]，T[j]≠T[k] 则取 next[j]，T[j]=T[k] 则取 nextval[k]）：
- j=1：0
- j=2：k=1，T2=b≠T1=a，取 1
- j=3：k=1，T3=a=T1，取 nextval[1]=0
- j=4：k=2，T4=b=T2，取 nextval[2]=1
- j=5：k=3，T5=a=T3，取 nextval[3]=0
- j=6：k=4，T6=a≠T4=b，取 4
- j=7：k=2，T7=a≠T2=b，取 2
- j=8：k=2，T8=b=T2，取 nextval[2]=1

nextval = 0 1 0 1 0 4 2 1

## p2
T = a a b a a b a a a

**next**：0 1 2 1 2 3 4 5 6

**nextval**：
- j=1：0
- j=2：k=1，T2=a=T1，取 nextval[1]=0
- j=3：k=2，T3=b≠T2=a，取 2
- j=4：k=1，T4=a=T1，取 0
- j=5：k=2，T5=a=T2，取 nextval[2]=0
- j=6：k=3，T6=b=T3，取 nextval[3]=2
- j=7：k=4，T7=a=T4，取 nextval[4]=0
- j=8：k=5，T8=a=T5，取 nextval[5]=0
- j=9：k=6，T9=a≠T6=b，取 6

nextval = 0 0 2 0 0 2 0 0 6

## p3
T = abab，next = 0 1 1 2，nextval = 0 1 0 1。

- 用 next：next[4]=2，下一步主串这个字符和 T[2] 比。T[2]=b，T[4]=b，而主串这个字符刚才和 b 失配，不是 b，所以这次比较一定失败，是白比。
- 用 nextval：nextval[4]=1，下一步和 T[1]=a 比。T[1]=a≠b，这次比较有可能成功（主串字符是 a 就成功）。