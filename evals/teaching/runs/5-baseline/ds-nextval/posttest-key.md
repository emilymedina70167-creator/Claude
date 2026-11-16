# 课后测验标准答案（只给评卷人）

## p1（near）
题面：求模式串 ababaaab 的 next 数组和 nextval 数组（王道口径，从 1 数，next[1] = 0）。
答案：next = 0 1 1 2 3 4 2 2；nextval = 0 1 0 1 0 4 2 1。（j=3：T3=a=T1，取 nextval[1]=0；j=4：T4=b=T2，取 nextval[2]=1；j=5：T5=a=T3，取 nextval[3]=0；j=6：T6=a≠T4=b，取 next=4；j=7：T7=a≠T2=b，取 2；j=8：T8=b=T2，取 nextval[2]=1）
考的是：手算模式串的 nextval（王道口径）：nextval[1] = 0；T[j] 和 T[next[j]] 不相等时 nextval[j] = next[j]，相等时 nextval[j] = nextval[next[j]]（怎样算会：一个没见过的模式串，学生自己写出 next 和 nextval，每一格都对）

## p2（near）
题面：求模式串 aabaabaaa 的 next 数组和 nextval 数组（王道口径）。
答案：next = 0 1 2 1 2 3 4 5 6；nextval = 0 0 2 0 0 2 0 0 6。（j=2：T2=a=T1，取 nextval[1]=0；j=3：b≠T2=a，取 2；j=4：a=T1，取 0；j=5：a=T2，取 nextval[2]=0；j=6：b=T3，取 nextval[3]=2；j=7：a=T4，取 nextval[4]=0；j=8：a=T5，取 nextval[5]=0；j=9：a≠T6=b，取 next=6）
考的是：手算模式串的 nextval（王道口径）：nextval[1] = 0；T[j] 和 T[next[j]] 不相等时 nextval[j] = next[j]，相等时 nextval[j] = nextval[next[j]]（怎样算会：一个没见过的模式串，学生自己写出 next 和 nextval，每一格都对）

## p3（far）
题面：模式串 T = abab（王道口径从 1 数）。匹配时主串的某个字符和 T[4] 比较失配了（那个字符不是 b）。用 next 数组，下一步主串的这个字符和 T 的第几位比较？这次比较有可能成功吗？用 nextval 数组呢？
答案：next = 0 1 1 2，nextval = 0 1 0 1。用 next：next[4] = 2，下一步和 T[2] = b 比较；那个字符不是 b，T[2] 也是 b，所以一定失配，这次比较白做。用 nextval：nextval[4] = 1，直接和 T[1] = a 比较，主串那个字符是 a 时就能成功。
考的是：说清 nextval 为什么要比较 T[j] 和 T[next[j]]：失配的主串字符不等于 T[j]，若 T[next[j]] = T[j]，退过去必然再失配，这次比较白做，所以直接再往前退（怎样算会：学生对一处具体的失配说出：用 next 下一次和谁比、这次比较可能不可能成功；用 nextval 又和谁比）
