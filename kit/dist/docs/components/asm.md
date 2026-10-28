### asm：机器级代码（x86）

```asm
id: as-1
title: 函数调用和循环
call: sum(4)
predict: 8 -> eax
code:
sum:
push ebp
mov ebp, esp
mov ecx, [ebp+8]
mov eax, 0
L1: cmp ecx, 0
jle L2
add eax, ecx
dec ecx
jmp L1
L2: pop ebp
ret
```

- `code:` 放在最后，下面是 Intel 写法的汇编（王道 / 真题照抄；反汇编的地址和机器码可以带着：`00401000  55  push ebp`）。一条指令一步：寄存器（变了的亮）、ZF SF CF OF、栈（一格一个双字，标出 esp、ebp）、写过的内存。`call: sum(4)` 从标号 sum 开始、参数从右往左压栈；`regs: ecx=3`、`mem: [0x1000]=5` 给开始的状态。`predict: 8 -> eax`：执行完第 8 行以后问 eax（也能问 `[ebp-4]`、`ZF`）。`ask: jump`：条件转移跳不跳。`mode: quiz` 写跑完的 eax（`quiz: ecx` 换一个）。

- 支持：mov、movzx / movsx、lea、add、sub、inc、dec、neg、imul（1～3 个操作数）、mul、cdq、idiv、div、and、or、xor、not、shl / sal、shr、sar、cmp、test、jmp 和各种 jxx、push、pop、call、ret（`ret 8`）、leave、nop、hlt；32 位寄存器和 al、ax 这类；操作数 `[ebx+ecx*4-8]`、`byte ptr [eax]`；数写 `10`、`0x1F`、`1Fh`。32 位、小端；cmp a, b 按 a − b 设标志；jg / jl 看 SF、OF（有符号），ja / jb 看 CF（无符号）。
- `predict: 7 if ecx == 2 -> eax`：第 7 行、执行之前 ecx 是 2 的那一次。`mode: fill` 填每执行一条以后几个寄存器的值（`watch: eax, ecx` 选哪几个，最多 30 条）。
- 写错（不认的指令、两个内存操作数、找不到的标号）会报行号；死循环（超过 2000 条）、除以 0 停在那一行。
- 错法诊断认得出：cmp 当成 b − a、lea 当成取内存、有符号转移按无符号判、shr 当成算术右移。
