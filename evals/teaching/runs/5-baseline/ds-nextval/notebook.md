## 第 2 轮
第1块：写了 abaabcac 的 next = 0 1 1 2 2 3 1 2。

## 第 4 轮
第2块：abaabcac 里 x 和 T[5]=b 失配，退到 next[5]=2 再比 T[2]=b，T[2]=T[5]，所以一定失配，是白比。

## 第 8 轮
第3块：nextval[j]：k=next[j]，若 T[k]=T[j] 就白比，令 k=next[k] 继续退（到0停），T[k]≠T[j] 停，答案是 k。abaabcac 的 nextval = 0 1 0 2 1 3 0 2。

## 第 10 轮
第4块：公式：nextval[1]=0；k=next[j]，T[j]≠T[k] 则 nextval[j]=next[j]；T[j]=T[k] 则 nextval[j]=nextval[k]（抄已算好的 nextval）。aaaab 的 nextval = 0 0 0 0 4。

## 第 12 轮
第5块：匹配流程不变，失配时查 nextval。aaaab 对主串 aaabaaaab，第4个 b 失配后，用 next 还要多比3次(T[3]、T[2]、T[1])，用 nextval 0次，因为 nextval[4]=0 直接后移。

