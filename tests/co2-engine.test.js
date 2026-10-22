// 组成原理（二）：寻址方式 ea、扩展操作码 opcode、大小端与对齐 layout、中断屏蔽 irq（kit/src/engines/coea.js、coopcode.js、colayout.js、coirq.js）
// 答案和真题 / 王道的例子对过（出处写在每个用例前面）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eaEngine as EA } from '../kit/src/engines/coea.js';
import { opcodeEngine as OP } from '../kit/src/engines/coopcode.js';
import { layoutEngine as LY } from '../kit/src/engines/colayout.js';
import { irqEngine as IQ } from '../kit/src/engines/coirq.js';
import { parseFields } from '../kit/src/parse.js';
import { checkAsk, resolveAsks, commonSpec, trackFields, fillSpec, fillOrder, checkFill } from '../kit/src/stepperspec.js';

const asks = (r, tag) => r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter((a) => a && a.tag === tag);
const mistakes = (E, input) => E.variants(input).map((v) => v.input.mistake);

// —— ea ——

test('ea：同一块内存，立即 / 直接 / 间接（Stallings 习题：20 号单元是 40……，王道 4.2 也收了）', () => {
  const input = EA.parse({ ins: '立即 20, 直接 20, 间接 20, 立即 30, 直接 30, 间接 30', mem: '20=40, 30=50, 40=60, 50=70' });
  const r = EA.run(input);
  assert.deepEqual(r.sol.map((s) => Number(s.op)), [20, 40, 60, 30, 50, 70]);
  assert.deepEqual(r.sol.map((s) => s.acc), [0, 1, 2, 0, 1, 2]);
  // 全是十进制：按十进制问
  assert.equal(asks(r, 'operand')[2].kind, 'number');
  assert.ok(checkAsk(asks(r, 'operand')[2], '60').ok);
  assert.equal(EA.quiz(input, r).answer, '20 40 60 30 50 70');
  assert.deepEqual(mistakes(EA, input), ['fetch', 'indOnce', 'immDirect']);
  // 错法：间接当直接，学生写 40 就认得出
  const v = EA.variants(input).find((x) => x.input.mistake === 'indOnce');
  assert.equal(Number(EA.run(v.input).sol[2].op), 40);
});

test('ea：变址寻址取到 4000H（2013 统考）；几种写法都算对', () => {
  const input = EA.parse({ ins: '变址 R 2000H', reg: 'R=1000H', mem: '1000H=2000H, 2000H=3000H, 3000H=4000H' });
  const r = EA.run(input);
  assert.equal(r.sol[0].ea, 0x3000n);
  assert.equal(r.sol[0].op, 0x4000n);
  const ea = asks(r, 'ea')[0];
  for (const t of ['3000H', '3000', '0x3000', '3000h']) assert.ok(checkAsk(ea, t).ok, t);
  assert.ok(!checkAsk(ea, '2000H').ok);
  assert.equal(asks(r, 'operand')[0].display, '4000H');
});

test('ea：相对寻址（2009 统考 2008H；2014 统考 44 题 bne 的目标 08048100H）', () => {
  // 2009：指令在 2000H、两个字节，取一个字节 PC + 1，位移量 06H → 2002H + 6 = 2008H
  const a = EA.parse({ ins: '相对 06H 转移', at: '2000H', len: 2 });
  const ra = EA.run(a);
  assert.equal(ra.sol[0].ea, 0x2008n);
  assert.equal(ra.sol[0].acc, 0);
  assert.deepEqual(mistakes(EA, a), ['fetch', 'pcCur']);
  // 2014：bne 在 08048114H，偏移 FFFAH（−6），按指令数（×4）：08048118H − 24 = 08048100H
  const b = EA.parse({ ins: '相对 FFFAH 转移', at: '08048114H', len: 4, scale: 4 });
  assert.equal(EA.run(b).sol[0].ea, 0x08048100n);
  assert.deepEqual(mistakes(EA, b), ['fetch', 'pcCur', 'noScale', 'unsigned']);
  // 唐朔飞的那道：PC = 2008H、两字节，位移 F7H（−9）→ 200AH − 9 = 2001H；用 reg: 的 PC 也行
  assert.equal(EA.run(EA.parse({ ins: '相对 F7H 转移', reg: 'PC=2008H', len: 2 })).sol[0].ea, 0x2001n);
});

test('ea：基址的补码偏移（2016 统考：F000 0000H + FF12H → EFFF FF12H）、先变址后间址（2017 统考 ((I)+D)）', () => {
  const a = EA.parse({ ins: '基址 FF12H', reg: 'BR=F000 0000H', signed: 'true' });
  const r = EA.run(a);
  assert.equal(r.sol[0].ea, 0xEFFFFF12n);
  assert.equal(asks(r, 'ea')[0].display, 'EFFFFF12H');
  assert.equal(asks(r, 'operand').length, 0, '主存里没给就不问操作数');
  assert.deepEqual(mistakes(EA, a), ['fetch', 'unsigned']);
  const b = EA.parse({ ins: '先变址后间址 0004H, 先间址后变址 0004H', reg: 'IX=0100H', mem: '0104H=0210H, 0004H=0020H, 0120H=7777H, 0210H=1234H' });
  const rb = EA.run(b);
  assert.equal(rb.sol[0].ea, 0x210n); // ((IX) + D)
  assert.equal(rb.sol[1].ea, 0x120n); // (D) + (IX)
  assert.deepEqual(rb.sol.map((s) => s.acc), [2, 2]);
});

test('ea：寄存器、寄存器间接、出栈、进栈；写错报原因', () => {
  const input = EA.parse({ ins: '寄存器 R1, 寄存器间接 R1, 出栈, 进栈 5', reg: 'R1=0300H, SP=0400H', mem: '0300H=00FFH, 0400H=5A5AH' });
  const r = EA.run(input);
  assert.equal(r.sol[0].eaReg, 'R1');
  assert.equal(r.sol[0].op, 0x300n);
  assert.equal(r.sol[1].op, 0xFFn);
  assert.equal(r.sol[2].op, 0x5A5An);
  assert.equal(r.sol[3].ea, 0x3FFn);
  assert.deepEqual(r.sol.map((s) => s.acc), [0, 1, 1, 1]);
  assert.ok(mistakes(EA, input).includes('regAsReg'));
  const t = EA.table(input, r);
  assert.deepEqual(t.rows[0].cells[0].v, ['R1']);
  assert.throws(() => EA.parse({ ins: '间接 20H', mem: '30H=1' }), /主存 20H 的内容没给/);
  assert.throws(() => EA.parse({ ins: '相对 06H' }), /at:/);
  assert.throws(() => EA.parse({ ins: '变址 2000H' }), /IX/);
  assert.throws(() => EA.parse({ ins: '随便 20H' }), /看不懂/);
  assert.throws(() => EA.parse({ ins: '寄存器 R9', reg: 'R1=1' }), /哪个寄存器/);
});

// —— opcode ——

test('opcode：16 位指令、4 位地址码，三地址 15、二地址 15、一地址 15、零地址 16（王道 4.1 扩展操作码）', () => {
  const input = OP.parse({ len: 16, addr: 4, need: '三地址 15, 二地址 15, 一地址 15, 零地址 16' });
  const r = OP.run(input);
  const range = asks(r, 'range').map((a) => a.answer.split('|')[0].trim());
  assert.deepEqual(range, ['0000～1110', '1111 0000～1111 1110', '1111 1111 0000～1111 1111 1110', '1111 1111 1111 0000～1111 1111 1111 1111']);
  assert.deepEqual(asks(r, 'avail').map((a) => a.answer), [16, 16, 16, 16]);
  // 范围的写法：分不分组、～ / - / 至 都认
  const a = asks(r, 'range')[1];
  for (const t of ['1111 0000～1111 1110', '11110000-11111110', '1111 0000 ~ 1111 1110', '11110000至11111110']) assert.ok(checkAsk(a, t).ok, t);
  assert.ok(!checkAsk(a, '1111 0000～1111 1111').ok);
  assert.equal(OP.quiz(input, r).answer, '0b1111111111110000');
});

test('opcode：最多几条（二地址 15、一地址 34 → 零地址最多 1920；三 15、二 15、零 16 → 一地址最多 15）', () => {
  // 王道 4.1 习题：16 位、地址码 6 位，二地址 15 条、一地址 34 条，零地址最多 (64 − 34) × 64 = 1920 条
  const a = OP.parse({ len: 16, addr: 6, need: '二地址 15, 一地址 34, 零地址 ?' });
  const ra = OP.run(a);
  assert.equal(ra.max, 1920);
  assert.equal(asks(ra, 'range').at(-1).answer.split('|')[0].trim(), '1111 100010 000000～1111 111111 111111');
  assert.deepEqual(mistakes(OP, a), ['noMul', 'lastReserve']);
  assert.equal(OP.run(OP.variants(a)[0].input).max, 64);
  assert.equal(OP.run(OP.variants(a)[1].input).max, 1919);
  // 中间那一类问最多几条：要给零地址的 16 条留 1 个前缀
  const b = OP.parse({ len: 16, addr: 4, need: '三地址 15, 二地址 15, 一地址 ?, 零地址 16' });
  assert.equal(OP.run(b).max, 15);
  assert.deepEqual(mistakes(OP, b), ['noReserve']);
  assert.equal(OP.run(OP.variants(b)[0].input).max, 16);
  assert.throws(() => OP.parse({ len: 16, addr: 4, need: '三地址 16, 二地址 1' }), /放不下/);
  assert.throws(() => OP.parse({ len: 16, addr: 4, need: '三地址 ?, 二地址 ?' }), /一次只能问一类/);
});

test('opcode：指令字长至少几位（2017 统考：三地址 29、二地址 107、地址码 6 位、按字节编址 → 24 位）', () => {
  const input = OP.parse({ len: '?', addr: 6, need: '三地址 29, 二地址 107', unit: 8 });
  const r = OP.run(input);
  assert.equal(r.L, 24);
  assert.deepEqual(r.tries.map((t) => [t.k, t.ok]), [[4, false], [5, true]]);
  assert.equal(asks(r, 'len').at(-1).answer, 24);
  assert.deepEqual(mistakes(OP, input), ['noMul', 'noRound']);
  assert.equal(OP.run(OP.variants(input)[1].input).L, 23);
  // 不凑整：23 位
  assert.equal(OP.run(OP.parse({ len: '?', addr: 6, need: '三地址 29, 二地址 107' })).L, 23);
});

// —— layout ——

test('layout：struct { int a; char b; short c; }，首地址 0xC008、小端、a = 273（2012 统考：0xC008 里是 0x11，c 在 0xC00E）', () => {
  const input = LY.parse({ struct: 'int a; char b; short c', at: '0xC008', set: 'a = 273', look: '0xC008' });
  const r = LY.run(input);
  assert.deepEqual(r.lay.items.map((x) => x.off), [0, 4, 6]);
  assert.equal(r.lay.size, 8);
  assert.equal(asks(r, 'addr')[2].display, 'C00EH');
  const b = asks(r, 'byte')[0];
  assert.equal(b.answer, 0x11n);
  assert.ok(checkAsk(b, '11H').ok && checkAsk(b, '0x11').ok);
  assert.ok(checkAsk(asks(r, 'bytes')[0], '11 01 00 00').ok);
  assert.deepEqual(mistakes(LY, input), ['packed', 'all4', 'swap']);
  // 错法：没对齐时 c 在偏移 5；大小端弄反时 0xC008 里是 00
  assert.equal(LY.run(LY.variants(input)[0].input).lay.items[2].off, 5);
  assert.equal(asks(LY.run(LY.variants(input)[2].input), 'byte')[0].answer, 0n);
});

test('layout：sizeof 和末尾补齐；不对齐、pack(4)、64 位', () => {
  const s = (f) => LY.run(LY.parse(f)).lay.size;
  assert.equal(s({ struct: 'char a; double b; int c' }), 24);
  assert.equal(s({ struct: 'double b; int c; char a' }), 16);
  assert.equal(s({ struct: 'char a; double b; int c', align: 'none' }), 13);
  assert.equal(s({ struct: 'char a; double b; int c', align: '4' }), 16);
  assert.equal(s({ struct: 'char a; char *p', arch: 64 }), 16);
  assert.equal(s({ struct: 'char s[5]; short x; int y' }), 12);
  const input = LY.parse({ struct: 'char a; double b; int c' });
  assert.deepEqual(mistakes(LY, input), ['packed', 'noTail', 'all4']);
  assert.equal(LY.run(LY.variants(input)[1].input).lay.size, 20);
  assert.throws(() => LY.parse({ struct: 'int a', set: 'b = 1' }), /没有成员 b/);
  assert.throws(() => LY.parse({ struct: 'char a', set: 'a = 300' }), /放不下/);
  assert.throws(() => LY.parse({ struct: 'int a; char b', set: 'a = 1', look: '0x10' }), /不在写了值的成员里/);
});

test('layout：一个数的各个字节（2018 统考 int i = −64 → C0 FF FF FF；2016 统考大端 1234 FF00H 的 LSB 在 EFFF FF15H）', () => {
  const a = LY.parse({ value: '-64', type: 'int', name: 'i', at: '8000H' });
  const r = LY.run(a);
  assert.ok(checkAsk(asks(r, 'code')[0], 'FFFFFFC0').ok);
  assert.ok(checkAsk(asks(r, 'bytes')[0], 'C0 FF FF FF').ok);
  assert.equal(LY.quiz(a, r).answer.split('|')[0].trim(), 'C0 FF FF FF');
  assert.deepEqual(mistakes(LY, a), ['swap']);
  const b = LY.run(LY.parse({ value: '0x1234FF00', at: 'EFFFFF12H', endian: 'big' }));
  assert.equal(asks(b, 'lsb')[0].answer, 0xEFFFFF15n);
  assert.equal(asks(b, 'byte')[0].answer, 0x12n);
  // float：−1.5 = BFC00000H
  assert.ok(checkAsk(asks(LY.run(LY.parse({ value: '-1.5', type: 'float' })), 'code')[0], 'BFC00000').ok);
});

// —— irq ——

test('irq：A > B > C > D 改成 D > A > C > B 的屏蔽字（唐朔飞 8.4 / 王道 7.4）和一条时间线（手算对过）', () => {
  const input = IQ.parse({ prio: 'A > B > C > D', order: 'D > A > C > B', req: 'B@10, A@20, C@30, D@40', time: '20μs' });
  const r = IQ.run(input);
  assert.deepEqual(asks(r, 'mask').map((a) => a.display), ['1110', '0100', '0110', '1111']);
  assert.ok(checkAsk(asks(r, 'mask')[0], '1110').ok);
  // B 先运行；A 打断 B；C 被 A 屏蔽；A 做完时 D 也来了：硬件排队先响应 C，C 刚开中断 D 就打断它
  assert.deepEqual(asks(r, 'next').map((a) => a.answer), ['B', 'A', 'A', 'C', 'D', 'C', 'B', '主程序']);
  assert.deepEqual(r.sim.finish, ['A', 'D', 'C', 'B']);
  assert.deepEqual(r.sim.done, { A: 40, D: 60, C: 80, B: 90 });
  assert.ok(checkAsk(asks(r, 'finish')[0], 'A D C B').ok && checkAsk(asks(r, 'finish')[0], 'ADCB').ok);
  assert.deepEqual(mistakes(IQ, input), ['hw', 'noSelf', 'rev', 'noNest']);
  // 照硬件优先级（没改屏蔽字）：B、A、C、D 依次来，处理完的是 A、B、C、D
  assert.deepEqual(IQ.run(IQ.variants(input)[0].input).sim.finish, ['A', 'B', 'C', 'D']);
  const t = IQ.table(input, r);
  assert.deepEqual(t.rows.map((x) => x.cells.map((c) => c.v)), [['1110', '20', '40'], ['0100', '10', '90'], ['0110', '40', '80'], ['1111', '40', '60']]);
});

test('irq：5 级中断同时请求，处理次序改成 L1 > L3 > L0 > L4 > L2（王道 7.4 综合题）', () => {
  const input = IQ.parse({ prio: 'L0 > L1 > L2 > L3 > L4', order: 'L1 > L3 > L0 > L4 > L2', req: 'all@0', time: '10' });
  const r = IQ.run(input);
  assert.deepEqual(asks(r, 'mask').map((a) => a.display), ['10101', '11111', '00100', '10111', '00101']);
  // 先响应 L0（硬件排队），L1 马上打断它；L1 完回 L0，L3 打断；L0 做完回主程序，响应 L2，L4 马上打断
  assert.deepEqual(asks(r, 'next').map((a) => a.answer), ['L0', 'L1', 'L3', 'L0', 'L2', 'L4', 'L2', '主程序']);
  assert.deepEqual(r.sim.finish, ['L1', 'L3', 'L0', 'L4', 'L2']);
});

test('irq：给了屏蔽字读处理次序；写错报原因', () => {
  const input = IQ.parse({ prio: 'A B C D', mask: 'A=1110, B=0100, C=0110, D=1111' });
  const r = IQ.run(input);
  assert.equal(asks(r, 'rank')[0].answer.split('|')[0].trim(), 'D A C B');
  assert.equal(IQ.quiz(input, r).answer, '1110 0100 0110 1111');
  assert.deepEqual(mistakes(IQ, input), ['hw', 'noSelf', 'rev']);
  // 排不出处理次序的屏蔽字：照着模拟，提醒一句，不问 rank
  const loose = IQ.parse({ prio: 'A B', mask: 'A=01, B=10' });
  assert.equal(IQ.problems(loose).length, 1);
  assert.equal(asks(IQ.run(loose), 'rank').length, 0);
  assert.throws(() => IQ.parse({ prio: 'A B', order: 'A B', mask: 'A=11, B=01' }), /只写一个/);
  assert.throws(() => IQ.parse({ prio: 'A B C', req: 'A@0' }), /time:/);
  assert.throws(() => IQ.parse({ prio: 'A B C', req: 'E@0', time: 5 }), /没有中断源「E」/);
  assert.throws(() => IQ.parse({ prio: 'A B C', req: 'A@0, A@5', time: 5 }), /请求了两次/);
});

// —— 说明草稿和示例页里的例子：照抄就能用（解析得了、ask 的种类都问得到、没有用不上的字段；第 0 步不问；填表的表形状对） ——
const ENGINES = { ea: EA, opcode: OP, layout: LY, irq: IQ };
test('手册（CLAUDE-PROJECT.md）和 co2-demo.html 里的例子都能用', () => {
  const found = [];
  for (const f of ['../CLAUDE-PROJECT.md', '../kit/examples/co2-demo.html']) {
    const md = readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const m of md.matchAll(/^(`{3,})(\w+)\n([\s\S]*?)^\1\s*$/gm)) if (ENGINES[m[2]]) found.push([m[2], m[3]]);
  }
  assert.ok(found.length >= 20, `只找到 ${found.length} 个例子`);
  for (const [name, src] of found) {
    const e = ENGINES[name];
    const where = `${name}（${src.split('\n').find((l) => /^id:/.test(l)) || src.split('\n')[0]}）`;
    const tracked = trackFields(parseFields(src).fields);
    const { fields } = tracked;
    const input = e.parse(fields, src);
    const r = e.run(input);
    assert.ok(r.steps.length >= 2 && !r.steps[0].ask && !r.steps[0].asks, `${where}：第 0 步挂了问题`);
    const spec = commonSpec(fields);
    assert.deepEqual(resolveAsks(spec.ask, r.steps).errors, [], `${where}：ask 写的问不到`);
    assert.deepEqual(e.problems?.(input, r) || [], [], `${where}：自检有提醒`);
    assert.ok(e.quiz(input, r, fields), `${where}：没有 quiz`);
    const t = e.table(input, r, fields);
    for (const row of t.rows) assert.equal(row.cells.length, t.head.length, `${where}：表的一行格子数和表头不一样`);
    const ft = fillSpec(t, fields);
    assert.deepEqual(ft.errors, [], `${where}：填表的字段写错了`);
    // 照答案填，整张表判对
    const values = ft.table.rows.map((row) => row.cells.map((c) => String([].concat(c.v)[0] ?? '')));
    values.extra = (ft.table.extra || []).map((c) => String([].concat(c.v)[0]));
    assert.ok(fillOrder(ft.table).length + (ft.table.extra || []).length > 0, `${where}：表里没有要填的格子`);
    assert.ok(checkFill(ft.table, values).ok, `${where}：照答案填的表判错了`);
    assert.deepEqual(tracked.unknown(), [], `${where}：例子里有用不上的字段`);
    // 每一步都画得出来
    for (const s of r.steps) assert.equal(typeof e.view(s.view, input, { k: 0 }), 'string');
  }
});

test('手册里这四节：精简版不超过 500 字节，写了 mode: quiz、mode: fill 和错法诊断', () => {
  const md = readFileSync(new URL('../CLAUDE-PROJECT.md', import.meta.url), 'utf8');
  for (const name of Object.keys(ENGINES)) {
    const at = md.indexOf(`### ${name}：`);
    assert.ok(at >= 0, `没有 ${name} 这一节`);
    const end = md.indexOf('\n### ', at + 1);
    const sec = md.slice(at, end < 0 ? md.length : end);
    const compact = sec.slice(0, sec.indexOf('<!-- 完整写法 -->'));
    assert.ok(Buffer.byteLength(compact) <= 500, `${name} 的精简版 ${Buffer.byteLength(compact)} 字节`);
    for (const w of ['mode: quiz', 'mode: fill', '错法诊断']) assert.ok(sec.includes(w), `${name} 没写 ${w}`);
    assert.ok(!/[他她]/.test(sec), `${name} 的说明里用了他 / 她`);
  }
});
