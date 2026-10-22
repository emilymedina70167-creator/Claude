// 机器级代码（kit/src/engines/coasm.js）：栈帧、循环、有符号 / 无符号转移、反汇编格式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asmEngine as A } from '../kit/src/engines/coasm.js';

const go = (src) => { const input = A.parse({}, src); return { input, r: A.run(input) }; };

test('函数调用：参数在 [ebp+8]、[ebp+12]，返回值在 eax；栈帧建立和撤掉', () => {
  const { r } = go(`call: sum(3, 5)
predict: 4 -> eax
code:
sum:
push ebp
mov ebp, esp
mov eax, [ebp+8]
add eax, [ebp+12]
pop ebp
ret`);
  assert.equal(r.error, null);
  assert.equal(r.regs.eax, 8);
  assert.equal(r.regs.esp, 0x0012FF80 - 8); // 两个参数还在栈上（调用者负责清）
  assert.equal(r.steps.find((s) => s.ask?.tag === 'predict').ask.answer, 3);
});

test('循环：cmp / jg；有符号和无符号的转移；错法', () => {
  const { input, r } = go(`code:
mov ecx, 1
mov eax, 0
L1: cmp ecx, 5
jg L2
add eax, ecx
inc ecx
jmp L1
L2: nop`);
  assert.equal(r.regs.eax, 15);
  // 小的正数按有符号、无符号比一样：只有 cmp 反过来看得出
  assert.deepEqual(A.variants(input).map((v) => v.input.mistake), ['cmpRev']);
  // −1 和 1 比：jl 跳（有符号），jb 不跳（无符号 0xFFFFFFFF 大）
  const s = go(`code:
mov eax, -1
cmp eax, 1
jl L
mov ebx, 1
L: cmp eax, 1
jb M
mov ecx, 1
M: nop`).r;
  assert.deepEqual([s.regs.ebx, s.regs.ecx], [0, 1]);
  assert.deepEqual(s.steps.filter((x) => x.ask?.tag === 'jump').map((x) => x.ask.answer), ['跳转', '不跳转']);
});

test('反汇编格式：地址、机器码、按地址 call；lea、shr / sar、小端', () => {
  const { r } = go(`regs: ebx=0x1000
mem: [0x1000]=0x12345678
code:
00401000  E8 0B 00 00 00   call 00401010
00401005  8D 04 9D 00 00 00 00   lea eax, [ebx*4]
0040100C  F4               hlt
00401010  0F B6 0B         movzx ecx, byte ptr [ebx]
00401013  C3               ret`);
  assert.equal(r.error, null);
  assert.equal(r.regs.ecx, 0x78); // 小端：最低地址放最低字节
  assert.equal(r.regs.eax, 0x4000);
  const sh = go(`code:
mov eax, -8
mov ebx, eax
shr eax, 1
sar ebx, 1`).r;
  assert.equal(sh.regs.eax, 0x7FFFFFFC);
  assert.equal(sh.regs.ebx | 0, -4);
  assert.throws(() => A.parse({}, 'code:\nfoo eax'), /不认识指令 foo/);
  assert.throws(() => A.parse({}, 'code:\nmov [eax], [ebx]'), /两个操作数都是内存/);
  assert.throws(() => A.parse({}, 'code:\njmp L9'), /找不到/);
});
