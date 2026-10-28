### layout：大小端与对齐

```layout
id: ly-1
struct: int a; char b; short c
at: 0xC008
set: a = 273
ask: offset, size, byte
```

- `struct:` 成员（分号隔开）、`at:` 首地址、`set:` 成员的值、`endian: big`（默认小端）；一个数写 `value:`、`type:`。
- `ask:` `offset` `addr` `size` `byte` `bytes` `lsb` `code`。

- 按王道（32 位）：char 1、short 2、int / long / float / 指针 4、double 8；按边界对齐：每个成员从自己大小的整数倍开始（数组按元素），总大小凑成最大成员的整数倍。`align: none` 不对齐，`align: 4` 是 #pragma pack(4)；`arch: 64` 时 long 和指针 8 字节。
- 值：整数（十进制、`0x`、负数按补码）、`'A'`、float / double 的小数（IEEE 754）。`look: 0xC008` 问这个地址里是哪个字节（`byte`，不写就问这个成员最低地址的那个）；`bytes` 从低地址到高地址写出各字节，`lsb` 最低有效字节的地址，`code` 机器数，`addr` 成员的地址。一个数：`value: -64`、`type: int`、`name: i`、`at: 8000H`。
- 画面：成员表（类型、大小、偏移、地址），下面一行 4（有 double 时 8）个字节，一个成员一种颜色，空出来的字节画斜线。
- `mode: quiz`：结构体写 sizeof，一个数写各字节（从低地址起）；`mode: fill`：每个成员填偏移量和地址，再写 sizeof（有 `look:` 时再写那个字节）；一个数时每个地址填字节。
- 错法诊断认得出：没对齐（一个挨一个放）、末尾没补齐、每个成员都按 4 对齐、大小端弄反。
