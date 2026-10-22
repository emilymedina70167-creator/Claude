// 组成原理的机器级代码：asm（x86 的 Intel 写法，一条指令一步：寄存器、标志位、栈、内存怎么变；条件转移跳不跳）。
// 王道 / 真题的口径：32 位，小端存放；push 先 esp − 4 再写；call 压返回地址；cmp a, b 按 a − b 设标志；
// jg / jl 这类看 SF、OF（有符号），ja / jb 看 CF（无符号）。纯函数（tests/coasm-engine.test.js）。写法：
//   call: sum(3, 5)          从哪个标号开始、给几个参数（从右往左压栈，再压返回地址）；不写就从第一条开始
//   regs: eax=1, ecx=0x10    开始时的寄存器（其余是 0；esp 默认 0012FF80H）
//   mem: [0x1000]=3, [0x1004]=7    开始时内存里的双字（4 字节，小端）
//   predict: 7 -> eax        先猜：执行完第 7 行（第一次）以后 eax 是多少；7 if ecx == 2 -> [ebp-4]
//   code:                    放在最后，下面全是代码（可以带反汇编的地址和机器码：00401020  55  push ebp）
import { esc } from './arrayview.js';
import { parseFields } from '../parse.js';

const R32 = ['eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'esp', 'ebp'];
// 8 / 16 位的寄存器是 32 位寄存器的一部分
const SUB = { ax: ['eax', 0, 16], bx: ['ebx', 0, 16], cx: ['ecx', 0, 16], dx: ['edx', 0, 16], si: ['esi', 0, 16], di: ['edi', 0, 16], sp: ['esp', 0, 16], bp: ['ebp', 0, 16], al: ['eax', 0, 8], ah: ['eax', 8, 8], bl: ['ebx', 0, 8], bh: ['ebx', 8, 8], cl: ['ecx', 0, 8], ch: ['ecx', 8, 8], dl: ['edx', 0, 8], dh: ['edx', 8, 8] };
const isReg = (s) => R32.includes(s) || s in SUB;
const RET_SENTINEL = 0xFFFFFFF0; // call: 进来时压的返回地址：ret 到它就是函数返回、跑完了
const RET_LINE = 0xFFFF0000; // 代码没写地址时，call 压的返回地址记成 RET_LINE + 第几条（画成「返回地址」）
const isRetMark = (v) => v >= RET_LINE && v <= RET_SENTINEL;
const u32 = (v) => (Number(BigInt.asUintN(32, BigInt(Math.trunc(v)))));
const s32 = (v) => Number(BigInt.asIntN(32, BigInt(Math.trunc(v))));
export const hex8 = (v) => `${u32(v).toString(16).toUpperCase().padStart(8, '0')}H`;
const COND = {
  je: 'ZF', jz: 'ZF', jne: '!ZF', jnz: '!ZF', jg: 'G', jnle: 'G', jge: 'GE', jnl: 'GE', jl: 'L', jnge: 'L', jle: 'LE', jng: 'LE',
  ja: 'A', jnbe: 'A', jae: 'AE', jnb: 'AE', jnc: 'AE', jb: 'B', jnae: 'B', jc: 'B', jbe: 'BE', jna: 'BE', js: 'SF', jns: '!SF', jo: 'OF', jno: '!OF',
};
// 错法 unsigned：把有符号的条件当成无符号的（jg 当 ja……）
const AS_UNSIGNED = { G: 'A', GE: 'AE', L: 'B', LE: 'BE' };
const COND_TEXT = { ZF: 'ZF = 1', '!ZF': 'ZF = 0', G: 'ZF = 0 且 SF = OF（有符号大于）', GE: 'SF = OF（有符号大于等于）', L: 'SF ≠ OF（有符号小于）', LE: 'ZF = 1 或 SF ≠ OF（有符号小于等于）', A: 'CF = 0 且 ZF = 0（无符号大于）', AE: 'CF = 0（无符号大于等于）', B: 'CF = 1（无符号小于）', BE: 'CF = 1 或 ZF = 1（无符号小于等于）', SF: 'SF = 1', '!SF': 'SF = 0', OF: 'OF = 1', '!OF': 'OF = 0' };

// —— 读代码 ——
function parseNumber(t) {
  const s = t.trim().toLowerCase();
  let m;
  if ((m = /^([+-]?)0x([0-9a-f]+)$/.exec(s))) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 16);
  if ((m = /^([+-]?)([0-9][0-9a-f]*)h$/.exec(s))) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 16);
  if ((m = /^([+-]?)(\d+)$/.exec(s))) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 10);
  return null;
}
// [ebp+8]、[ebx+ecx*4-8]、dword ptr [0x1000] → { base, index, scale, disp, size }
function parseMem(t, line) {
  const m = /^(?:(byte|word|dword)\s+ptr\s*)?\[([^\]]+)\]$/i.exec(t.trim());
  if (!m) return null;
  const size = { byte: 1, word: 2, dword: 4 }[(m[1] || 'dword').toLowerCase()];
  const mem = { base: null, index: null, scale: 1, disp: 0, size, src: t.trim() };
  const terms = m[2].replace(/\s+/g, '').replace(/-/g, '+-').split('+').filter(Boolean);
  for (const term of terms) {
    const neg = term.startsWith('-');
    const x = neg ? term.slice(1) : term;
    const k = /^([a-z]+)\*(\d)$/i.exec(x) || /^(\d)\*([a-z]+)$/i.exec(x);
    if (k) {
      const [r, sc] = /^\d$/.test(k[1]) ? [k[2], k[1]] : [k[1], k[2]];
      if (!R32.includes(r.toLowerCase()) || ![1, 2, 4, 8].includes(Number(sc)) || neg) throw new Error(`第 ${line} 行：「${t}」的变址写成 寄存器*1/2/4/8`);
      mem.index = r.toLowerCase(); mem.scale = Number(sc); continue;
    }
    if (R32.includes(x.toLowerCase()) && !neg) { if (!mem.base) mem.base = x.toLowerCase(); else if (!mem.index) mem.index = x.toLowerCase(); else throw new Error(`第 ${line} 行：「${t}」里寄存器太多了`); continue; }
    const n = parseNumber(x);
    if (n === null) throw new Error(`第 ${line} 行：看不懂地址「${t}」（写成 [ebp+8]、[ebx+ecx*4]、[0x1000]）`);
    mem.disp += neg ? -n : n;
  }
  return mem;
}
function parseOperand(t, line) {
  const s = t.trim();
  const low = s.toLowerCase();
  if (isReg(low)) return { kind: 'reg', name: low, src: s };
  const mem = parseMem(s, line);
  if (mem) return { kind: 'mem', ...mem };
  const n = parseNumber(s.replace(/^offset\s+/i, ''));
  if (n !== null) return { kind: 'imm', value: n, src: s };
  if (/^[A-Za-z_.$@?][\w.$@?]*$/.test(s)) return { kind: 'label', name: s, src: s };
  throw new Error(`第 ${line} 行：看不懂操作数「${s}」`);
}
// 一行：可以有反汇编的地址、机器码、标号，; 后面是注释
function parseLine(raw, line) {
  let s = raw.replace(/;.*$/, '').replace(/\/\/.*$/, '').trim();
  const out = { line, raw, addr: null, label: null, op: null, args: [] };
  if (!s) return out;
  let m = /^([0-9A-Fa-f]{6,8})H?:?\s+(.*)$/.exec(s);
  if (m) { out.addr = parseInt(m[1], 16); s = m[2].replace(/^(?:[0-9A-Fa-f]{2}\s+)+(?=[A-Za-z])/, '').trim(); }
  m = /^([A-Za-z_.$@?][\w.$@?]*)\s*:\s*(.*)$/.exec(s);
  if (m && !isReg(m[1].toLowerCase())) { out.label = m[1]; s = m[2].trim(); }
  if (!s) return out;
  m = /^([A-Za-z]+)\s*(.*)$/.exec(s);
  if (!m) throw new Error(`第 ${line} 行：看不懂「${raw.trim()}」`);
  out.op = m[1].toLowerCase();
  // 逗号分开的操作数（[] 里不会有逗号）
  out.args = m[2] ? m[2].split(',').map((x) => parseOperand(x, line)) : [];
  return out;
}

const ARITY = { mov: 2, movzx: 2, movsx: 2, lea: 2, add: 2, sub: 2, and: 2, or: 2, xor: 2, cmp: 2, test: 2, shl: 2, sal: 2, shr: 2, sar: 2, inc: 1, dec: 1, neg: 1, not: 1, push: 1, pop: 1, jmp: 1, call: 1, idiv: 1, div: 1, mul: 1, cdq: 0, leave: 0, nop: 0, hlt: 0 };

export function head(src) {
  const lines = String(src ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*code\s*[:：]\s*$/i.test(l));
  return (at < 0 ? lines : lines.slice(0, at)).join('\n');
}

function parse(_fields, src) {
  const lines = String(src ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*code\s*[:：]\s*$/i.test(l));
  if (at < 0) throw new Error('asm 要写 code:（单独一行），下面是汇编代码；code: 放在最后');
  const fields = new Proxy(parseFields(lines.slice(0, at).join('\n')).fields, { get: (t, k) => { if (_fields && typeof k === 'string') void _fields[k]; return t[k]; } });
  const codeLines = lines.slice(at + 1);
  while (codeLines.length && !codeLines.at(-1).trim()) codeLines.pop();
  while (codeLines.length && !codeLines[0].trim()) codeLines.shift();
  if (!codeLines.length) throw new Error('code: 下面没有代码');
  if (codeLines.length > 60) throw new Error('代码最多 60 行');
  const prog = codeLines.map((l, i) => parseLine(l, i + 1));
  const labels = {}, addrs = {};
  prog.forEach((p, i) => { if (p.label) { if (p.label in labels) throw new Error(`标号 ${p.label} 写了两次`); labels[p.label] = i; } if (p.addr !== null) addrs[p.addr] = i; });
  for (const p of prog) {
    if (!p.op) continue;
    const nargs = p.args.length;
    if (p.op === 'imul') { if (nargs < 1 || nargs > 3) throw new Error(`第 ${p.line} 行：imul 写 1～3 个操作数`); }
    else if (p.op === 'ret') { if (nargs > 1) throw new Error(`第 ${p.line} 行：ret 最多一个操作数（ret 8）`); }
    else if (COND[p.op]) { if (nargs !== 1) throw new Error(`第 ${p.line} 行：${p.op} 写一个目标（标号或地址）`); }
    else if (ARITY[p.op] === undefined) throw new Error(`第 ${p.line} 行：不认识指令 ${p.op}（支持 mov、lea、add、sub、imul、idiv、cmp、test、jxx、push、pop、call、ret、leave、位运算和移位）`);
    else if (nargs !== ARITY[p.op]) throw new Error(`第 ${p.line} 行：${p.op} 要 ${ARITY[p.op]} 个操作数，这里写了 ${nargs} 个`);
    if (p.args.filter((a) => a.kind === 'mem').length > 1) throw new Error(`第 ${p.line} 行：x86 一条指令里不能两个操作数都是内存`);
    if ((p.op.startsWith('j') || p.op === 'call') && p.args[0]) {
      const a = p.args[0];
      // 反汇编里的目标地址写成 00401010（不带 H）：6～8 位的当十六进制
      const asHex = a.kind === 'imm' && /^[0-9a-f]{6,8}h?$/i.test(a.src) ? parseInt(a.src.replace(/h$/i, ''), 16) : null;
      const target = a.kind === 'label' ? labels[a.name] : a.kind === 'imm' ? (addrs[asHex] ?? addrs[u32(a.value)]) : undefined;
      if (target === undefined) throw new Error(`第 ${p.line} 行：${p.op} 的目标「${a.src}」在代码里找不到（写标号，或者反汇编里有的地址）`);
      p.target = target;
    }
    if (['mov', 'add', 'sub', 'and', 'or', 'xor', 'lea', 'movzx', 'movsx', 'pop', 'inc', 'dec', 'neg', 'not', 'shl', 'sal', 'shr', 'sar'].includes(p.op) && p.args[0].kind === 'imm') throw new Error(`第 ${p.line} 行：${p.op} 的目的操作数不能是立即数`);
  }
  // 开始的状态
  const regs = Object.fromEntries(R32.map((r) => [r, 0]));
  regs.esp = 0x0012FF80;
  for (const part of String(fields.regs ?? '').split(/[,，;；]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([a-z]+)\s*=\s*(.+)$/i.exec(part);
    const n = m && parseNumber(m[2]);
    if (!m || !R32.includes(m[1].toLowerCase()) || n === null) throw new Error(`regs: 写成 eax=1, ecx=0x10（32 位寄存器 = 数），「${part}」不对`);
    regs[m[1].toLowerCase()] = u32(n);
  }
  const mem = [];
  for (const part of String(fields.mem ?? '').split(/[,，;；]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^\[([^\]]+)\]\s*=\s*(.+)$/.exec(part);
    const a = m && parseNumber(m[1]), v = m && parseNumber(m[2]);
    if (a === null || v === null || !m) throw new Error(`mem: 写成 [0x1000]=3（地址 = 双字的值），「${part}」不对`);
    mem.push([u32(a), v]);
  }
  let entry = null;
  if (fields.call) {
    const m = /^([A-Za-z_.$@?][\w.$@?]*)\s*\(([^)]*)\)$/.exec(String(fields.call).trim());
    if (!m) throw new Error('call: 写成 sum(3, 5)（标号和参数）');
    if (!(m[1] in labels)) throw new Error(`call: 代码里没有标号 ${m[1]}`);
    const args = m[2].split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const n = parseNumber(x); if (n === null) throw new Error(`call: 参数写数，「${x}」不对`); return n; });
    entry = { name: m[1], at: labels[m[1]], args };
  }
  const predicts = String(fields.predict ?? '').split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => parsePredict(x, prog.length));
  const quiz = String(fields.quiz ?? 'eax').trim().toLowerCase();
  if (!R32.includes(quiz)) throw new Error('quiz: 写跑完以后问哪个 32 位寄存器（默认 eax）');
  const watch = fields.watch ? String(fields.watch).split(/[\s,，、]+/).filter(Boolean).map((x) => x.toLowerCase()) : null;
  if (watch && watch.some((w) => !R32.includes(w))) throw new Error('watch: 写填表时要填的 32 位寄存器，如 watch: eax, ecx');
  return { prog, labels, regs, mem, entry, predicts, quiz, watch, mistake: '' };
}

// predict: 7 -> eax；7 if ecx == 2 -> [ebp-4]；也能问 ZF
function parsePredict(src, n) {
  const m = /^(\d+)\s*(?:if\s+([a-z]+)\s*(==|!=|<=|>=|<|>)\s*(\S+)\s*)?(?:->|→|=>)\s*(.+)$/i.exec(src);
  if (!m) throw new Error(`predict: 看不懂「${src}」，写成「7 -> eax」或「7 if ecx == 2 -> [ebp-4]」（执行完第 7 行以后问）`);
  const line = Number(m[1]);
  if (line < 1 || line > n) throw new Error(`predict: 代码只有 ${n} 行，没有第 ${line} 行`);
  const what = m[5].trim();
  const low = what.toLowerCase();
  let target;
  if (R32.includes(low) || low in SUB) target = { kind: 'reg', name: low };
  else if (/^(zf|sf|cf|of)$/.test(low)) target = { kind: 'flag', name: low.toUpperCase() };
  else target = { kind: 'mem', ...parseMem(what, line) };
  if (target.kind === 'mem' && !target.src) throw new Error(`predict: 问的「${what}」写成寄存器、[ebp-4] 或 ZF`);
  const cond = m[2] ? { reg: m[2].toLowerCase(), op: m[3], value: parseNumber(m[4]) } : null;
  if (cond && (!R32.includes(cond.reg) || cond.value === null)) throw new Error(`predict: 条件写成「ecx == 2」（32 位寄存器和数比）`);
  return { line, cond, target, src };
}

// —— 跑：一条指令一步 ——
function run(input) {
  const { prog, mistake } = input;
  const regs = { ...input.regs };
  const bytes = new Map();
  const wr = (a, v, size = 4) => { for (let i = 0; i < size; i++) bytes.set(u32(a + i), Number((BigInt(u32(v)) >> BigInt(8 * i)) & 0xFFn)); };
  const rd = (a, size = 4) => { let v = 0n; for (let i = size - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes.get(u32(a + i)) ?? 0); return Number(v); };
  for (const [a, v] of input.mem) wr(a, v);
  const flags = { ZF: 0, SF: 0, CF: 0, OF: 0 };
  const getR = (n) => { if (R32.includes(n)) return regs[n]; const [r, sh, w] = SUB[n]; return (regs[r] >>> sh) & (2 ** w - 1); };
  const setR = (n, v) => { if (R32.includes(n)) { regs[n] = u32(v); return; } const [r, sh, w] = SUB[n]; const mask = (2 ** w - 1) * 2 ** sh; regs[r] = u32((regs[r] & ~mask) | ((u32(v) & (2 ** w - 1)) * 2 ** sh)); };
  const sizeOf = (o) => (o.kind === 'reg' ? (R32.includes(o.name) ? 4 : SUB[o.name][2] / 8) : o.kind === 'mem' ? o.size : 4);
  const ea = (o) => u32((o.base ? regs[o.base] : 0) + (o.index ? regs[o.index] * o.scale : 0) + o.disp);
  const val = (o) => (o.kind === 'reg' ? getR(o.name) : o.kind === 'mem' ? rd(ea(o), o.size) : u32(o.value));
  const put = (o, v) => (o.kind === 'reg' ? setR(o.name, v) : wr(ea(o), v, o.size));
  const bitsOf = (n) => 8 * n;
  const setZS = (r, n) => { const w = bitsOf(n); const m = BigInt.asUintN(w, BigInt(r)); flags.ZF = m === 0n ? 1 : 0; flags.SF = Number((m >> BigInt(w - 1)) & 1n); };
  const signed = (v, n) => Number(BigInt.asIntN(bitsOf(n), BigInt(v)));
  const unsigned = (v, n) => Number(BigInt.asUintN(bitsOf(n), BigInt(v)));
  // a − b（sub、cmp）、a + b（add）的四个标志
  const arith = (a, b, n, isSub) => {
    const ua = unsigned(a, n), ub = unsigned(b, n);
    const r = isSub ? ua - ub : ua + ub;
    flags.CF = isSub ? (ua < ub ? 1 : 0) : (r >= 2 ** bitsOf(n) ? 1 : 0);
    const sa = signed(a, n), sb = signed(b, n), sr = isSub ? sa - sb : sa + sb;
    flags.OF = sr > 2 ** (bitsOf(n) - 1) - 1 || sr < -(2 ** (bitsOf(n) - 1)) ? 1 : 0;
    setZS(r, n);
    return unsigned(r, n);
  };
  const logic = (r, n) => { flags.CF = 0; flags.OF = 0; setZS(r, n); return unsigned(r, n); };
  const test = (c) => {
    const k = mistake === 'unsigned' && AS_UNSIGNED[c] ? AS_UNSIGNED[c] : c;
    const { ZF, SF, CF, OF } = flags;
    return { ZF: ZF === 1, '!ZF': ZF === 0, G: ZF === 0 && SF === OF, GE: SF === OF, L: SF !== OF, LE: ZF === 1 || SF !== OF, A: CF === 0 && ZF === 0, AE: CF === 0, B: CF === 1, BE: CF === 1 || ZF === 1, SF: SF === 1, '!SF': SF === 0, OF: OF === 1, '!OF': OF === 0 }[k];
  };
  const push = (v) => { regs.esp = u32(regs.esp - 4); wr(regs.esp, v); };
  const pop = () => { const v = rd(regs.esp); regs.esp = u32(regs.esp + 4); return v; };

  const steps = [];
  const esp0 = regs.esp;
  let pc = 0;
  if (input.entry) {
    for (const a of [...input.entry.args].reverse()) push(a);
    push(RET_SENTINEL);
    pc = input.entry.at;
  }
  const snap = (extra = {}) => ({ regs: { ...regs }, flags: { ...flags }, stack: stackWindow(regs, esp0, rd), memw: [...bytes.keys()].length ? dataWrites(bytes, regs, esp0, rd) : [], ...extra });
  steps.push({ view: snap({ line: null }), msg: `${input.entry ? `调用 ${input.entry.name}(${input.entry.args.join(', ')})：参数从右往左压栈，再压返回地址，esp = ${hex8(regs.esp)}。` : `从第 1 条指令开始，esp = ${hex8(regs.esp)}。`}一条指令一步；Intel 写法：目的操作数在前。` });
  const watchers = input.predicts.map((p) => ({ ...p, done: false }));
  const asked = [];
  let count = 0, done = false, error = null;
  const trace = []; // 每执行一条：{ line, regs }
  while (!done) {
    while (pc < prog.length && !prog[pc].op) pc++;
    if (pc >= prog.length) { done = true; break; }
    if (++count > 2000) { error = `执行了 2000 条指令还没完：可能是死循环（第 ${prog[pc].line} 行附近）`; break; }
    const p = prog[pc];
    const before = { ...regs };
    const flagsBefore = { ...flags };
    let next = pc + 1, msg = '', ask;
    const A = p.args[0], B = p.args[1];
    const n = A ? sizeOf(A.kind === 'imm' && B ? B : A) : 4;
    try {
      switch (p.op) {
        case 'mov': { const v = val(B); put(A, v); msg = `${A.src} ← ${B.kind === 'mem' ? `${B.src} = ` : ''}${shown(v, sizeOf(A))}`; break; }
        case 'movzx': case 'movsx': { const v = val(B); const w = p.op === 'movsx' ? signed(v, sizeOf(B)) : v; put(A, w); msg = `${A.src} ← ${B.src} ${p.op === 'movsx' ? '符号' : '零'}扩展 = ${shown(w, 4)}`; break; }
        case 'lea': { if (B.kind !== 'mem') throw new Error('lea 的第二个操作数要写成 [地址]'); const v = mistake === 'leaMem' ? val(B) : ea(B); put(A, v); msg = `${A.src} ← ${B.src} 这个地址本身 = ${hex8(ea(B))}（lea 只算地址，不访问内存）`; break; }
        case 'add': case 'sub': { const a = val(A), b = val(B); const r = arith(a, b, n, p.op === 'sub'); put(A, r); msg = `${A.src} ← ${shown(a, n)} ${p.op === 'add' ? '+' : '−'} ${shown(b, n)} = ${shown(r, n)}`; break; }
        case 'cmp': { const [a, b] = mistake === 'cmpRev' ? [val(B), val(A)] : [val(A), val(B)]; arith(a, b, n, true); msg = `比较 ${A.src} − ${B.src}（${shown(val(A), n)} − ${shown(val(B), n)}），只设标志位不保存结果`; break; }
        case 'test': { logic(val(A) & val(B), n); msg = `${A.src} & ${B.src}，只设标志位`; break; }
        case 'and': case 'or': case 'xor': { const a = val(A), b = val(B); const r = logic(p.op === 'and' ? a & b : p.op === 'or' ? a | b : a ^ b, n); put(A, r); msg = `${A.src} ← ${shown(a, n)} ${p.op} ${shown(b, n)} = ${shown(r, n)}`; break; }
        case 'inc': case 'dec': { const cf = flags.CF; const a = val(A); const r = arith(a, 1, n, p.op === 'dec'); flags.CF = cf; put(A, r); msg = `${A.src} ← ${shown(a, n)} ${p.op === 'inc' ? '+' : '−'} 1 = ${shown(r, n)}（不改 CF）`; break; }
        case 'neg': { const a = val(A); const r = arith(0, a, n, true); put(A, r); msg = `${A.src} ← −${shown(a, n)} = ${shown(r, n)}`; break; }
        case 'not': { put(A, ~val(A)); msg = `${A.src} 按位取反（不改标志位）`; break; }
        case 'shl': case 'sal': case 'shr': case 'sar': {
          const k = val(B) & 31; const a = unsigned(val(A), n); const w = bitsOf(n);
          let r;
          if (p.op === 'shl' || p.op === 'sal') { r = unsigned(a * 2 ** k, n); if (k) flags.CF = Number((BigInt(a) >> BigInt(w - k)) & 1n); }
          else if (p.op === 'shr' && mistake !== 'shrArith') { r = Math.floor(a / 2 ** k); if (k) flags.CF = Number((BigInt(a) >> BigInt(k - 1)) & 1n); }
          else { r = unsigned(Math.floor(signed(a, n) / 2 ** k), n); if (k) flags.CF = Number((BigInt(a) >> BigInt(k - 1)) & 1n); }
          if (k) setZS(r, n);
          put(A, r);
          msg = `${A.src} ${p.op === 'shl' || p.op === 'sal' ? '左移' : p.op === 'shr' ? '逻辑右移（高位补 0）' : '算术右移（高位补符号位）'} ${k} 位：${shown(a, n)} → ${shown(r, n)}`;
          break;
        }
        case 'imul': {
          if (p.args.length === 1) { const r = BigInt(signed(regs.eax, 4)) * BigInt(signed(val(A), 4)); regs.eax = u32(Number(BigInt.asUintN(32, r))); regs.edx = u32(Number(BigInt.asUintN(32, r >> 32n))); flags.CF = flags.OF = r === BigInt.asIntN(32, r) ? 0 : 1; msg = `edx:eax ← eax × ${A.src} = ${r}`; break; }
          const a = p.args.length === 3 ? val(B) : val(A), b = p.args.length === 3 ? val(p.args[2]) : val(B);
          const r = BigInt(signed(a, 4)) * BigInt(signed(b, 4));
          flags.CF = flags.OF = r === BigInt.asIntN(32, r) ? 0 : 1;
          put(A, Number(BigInt.asUintN(32, r)));
          msg = `${A.src} ← ${s32(a)} × ${s32(b)} = ${s32(Number(BigInt.asUintN(32, r)))}${flags.OF ? '（溢出，OF = CF = 1）' : ''}`;
          break;
        }
        case 'cdq': regs.edx = regs.eax & 0x80000000 ? 0xFFFFFFFF : 0; msg = `edx ← eax 的符号位扩展（${regs.edx ? 'FFFFFFFFH' : '0'}），为 idiv 准备 edx:eax`; break;
        case 'idiv': case 'div': {
          const d = p.op === 'idiv' ? BigInt(signed(val(A), 4)) : BigInt(u32(val(A)));
          if (d === 0n) throw new Error('除以 0');
          const big = p.op === 'idiv' ? BigInt.asIntN(64, (BigInt(regs.edx) << 32n) | BigInt(regs.eax)) : (BigInt(regs.edx) << 32n) | BigInt(regs.eax);
          const q = big / d, rem = big % d;
          regs.eax = u32(Number(BigInt.asUintN(32, q))); regs.edx = u32(Number(BigInt.asUintN(32, rem)));
          msg = `edx:eax ÷ ${A.src}：商 eax = ${q}，余数 edx = ${rem}`;
          break;
        }
        case 'mul': { const r = BigInt(u32(regs.eax)) * BigInt(u32(val(A))); regs.eax = u32(Number(BigInt.asUintN(32, r))); regs.edx = u32(Number(r >> 32n)); flags.CF = flags.OF = regs.edx ? 1 : 0; msg = `edx:eax ← eax × ${A.src}（无符号）`; break; }
        case 'push': { const v = val(A); push(v); msg = `push ${A.src}：esp ← esp − 4 = ${hex8(regs.esp)}，[esp] ← ${shown(v, 4)}`; break; }
        case 'pop': { const v = pop(); put(A, v); msg = `pop ${A.src}：${A.src} ← [esp] = ${shown(v, 4)}，esp ← esp + 4 = ${hex8(regs.esp)}`; break; }
        case 'leave': regs.esp = regs.ebp; regs.ebp = pop(); msg = `leave：esp ← ebp，再 pop ebp（ebp = ${hex8(regs.ebp)}），撤掉这一层栈帧`; break;
        case 'call': { const hasAddr = prog[next]?.addr != null; const ret = hasAddr ? prog[next].addr : RET_LINE + next; push(ret); next = p.target; msg = `call ${A.src}：压返回地址 ${hasAddr ? hex8(ret) : `（下一条，第 ${prog[pc + 1]?.line ?? '?'} 行）`}，跳到 ${A.src}`; break; }
        case 'ret': {
          const ra = pop();
          if (A) regs.esp = u32(regs.esp + val(A));
          if (ra === RET_SENTINEL) { done = true; msg = `ret：返回调用者，函数结束；返回值在 eax = ${s32(regs.eax)}`; break; }
          const back = isRetMark(ra) ? ra - RET_LINE : prog.findIndex((x) => x.addr === ra);
          next = back;
          if (!(next >= 0 && next < prog.length)) { done = true; msg = 'ret：返回到代码外面，结束'; break; }
          msg = `ret：弹出返回地址，回到第 ${prog[next].line} 行`;
          break;
        }
        case 'jmp': next = p.target; msg = `无条件跳到 ${A.src}`; break;
        case 'nop': msg = '什么也不做'; break;
        case 'hlt': done = true; msg = '停机'; break;
        default: {
          const c = COND[p.op];
          const real = { ZF: flags.ZF === 1, '!ZF': flags.ZF === 0, G: flags.ZF === 0 && flags.SF === flags.OF, GE: flags.SF === flags.OF, L: flags.SF !== flags.OF, LE: flags.ZF === 1 || flags.SF !== flags.OF, A: flags.CF === 0 && flags.ZF === 0, AE: flags.CF === 0, B: flags.CF === 1, BE: flags.CF === 1 || flags.ZF === 1, SF: flags.SF === 1, '!SF': flags.SF === 0, OF: flags.OF === 1, '!OF': flags.OF === 0 }[c];
          const go = test(c);
          if (go) next = p.target;
          msg = `${p.op}：条件是 ${COND_TEXT[c]}；现在 ZF = ${flags.ZF}、SF = ${flags.SF}、CF = ${flags.CF}、OF = ${flags.OF}，${real ? `成立，跳到 ${A.src}` : '不成立，接着往下'}`;
          ask = { tag: 'jump', kind: 'choice', q: `第 ${p.line} 行 ${p.op} ${A.src}：跳不跳？`, choices: ['跳转', '不跳转'], answer: go ? '跳转' : '不跳转' };
        }
      }
    } catch (e) { error = `第 ${p.line} 行：${e.message}`; steps.push({ view: snap({ line: pc, err: true }), msg: error }); break; }
    // 先猜：执行完这一行（条件成立的那一次）以后问
    for (const w of watchers) {
      if (w.done || w.line !== p.line) continue;
      if (w.cond && !cmpOk(regsBeforeOrAfter(before, regs, w.cond.reg), w.cond.op, w.cond.value)) continue;
      w.done = true;
      const v = w.target.kind === 'reg' ? getR(w.target.name) : w.target.kind === 'flag' ? flags[w.target.name] : rd(ea(w.target), w.target.size);
      ask = { tag: 'predict', kind: 'number', q: `执行完第 ${p.line} 行（${p.raw.trim()}）以后，${w.target.kind === 'mem' ? w.target.src : w.target.name} 是多少？（十进制，负数写负号）`, answer: w.target.kind === 'flag' ? v : s32(v), display: w.target.kind === 'flag' ? String(v) : `${s32(v)}（${hex8(v)}）` };
      asked.push(w);
    }
    const changed = R32.filter((r) => regs[r] !== before[r]);
    const fchg = Object.keys(flags).filter((f) => flags[f] !== flagsBefore[f]);
    trace.push({ line: p.line, regs: { ...regs } });
    steps.push({ view: snap({ line: pc, changed, fchg }), msg: `第 ${p.line} 行 ${p.raw.replace(/;.*$/, '').trim().replace(/^[0-9A-Fa-f]{6,8}H?:?\s+(?:[0-9A-Fa-f]{2}\s+)*/, '')}：${msg}。`, ask });
    pc = next;
  }
  if (!error) steps.push({ view: snap({ line: null, done: true }), msg: `执行完了：eax = ${s32(regs.eax)}（${hex8(regs.eax)}），一共执行了 ${count} 条指令。` });
  return { steps, regs, flags, error, unasked: watchers.filter((w) => !w.done), trace, count };
}
const cmpOk = (a, op, b) => ({ '==': a === b, '!=': a !== b, '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b }[op]);
// predict 的条件看执行这一行之前的值（和 trace 一样：「i == 4 的那一次」）
const regsBeforeOrAfter = (before, _after, r) => s32(before[r]);
const shown = (v, n) => { const s = Number(BigInt.asIntN(8 * n, BigInt(u32(v)))); return s < 0 || Math.abs(s) < 4096 ? String(s) : `${hex8(v)}`; };

// 栈：从 esp 到开始时的栈顶下面那一格（call: 压的参数、返回地址都在这里面），一格一个双字；开始时栈顶以上是调用者的，不画
function stackWindow(regs, esp0, rd) {
  const hi = esp0 - 4, lo = Math.min(regs.esp, hi);
  const out = [];
  for (let a = lo; a <= hi && out.length < 16; a += 4) out.push({ a: u32(a), v: rd(a) });
  return out;
}
// 栈以外写过的内存（全局变量、数组）
function dataWrites(bytes, regs, esp0, rd) {
  const lo = Math.min(regs.esp, esp0) - 64, hi = esp0 + 4096;
  const words = new Set([...bytes.keys()].filter((a) => a < lo || a > hi).map((a) => a - (a % 4)));
  return [...words].sort((x, y) => x - y).slice(0, 12).map((a) => ({ a, v: rd(a) }));
}

function view(s, input) {
  const code = input.prog.map((p, i) => `<span class="tr-line${s.line === i ? (s.err ? ' tr-err' : ' tr-cur') : ''}" data-cmd="${i + 1}" data-label=""><i>${p.line}</i>${esc(p.raw.replace(/\s+$/, ''))}</span>`).join('');
  const regs = R32.map((r) => `<span class="tr-var${s.changed?.includes(r) ? ' tr-chg' : ''}" data-label="${r}"><b>${r}</b> ${esc(regText(s.regs[r], r))}</span>`).join('');
  const flags = Object.entries(s.flags).map(([f, v]) => `<span class="as-flag${v ? ' as-on' : ''}${s.fchg?.includes(f) ? ' as-chg' : ''}">${f} ${v}</span>`).join('');
  const stack = s.stack.map((x) => `<div class="as-cell${x.a === s.regs.esp ? ' as-esp' : ''}${x.a === s.regs.ebp ? ' as-ebp' : ''}" data-key="m${x.a}"><span class="as-addr">${hex8(x.a)}</span><span class="as-val">${isRetMark(x.v) ? '返回地址' : esc(regText(x.v))}</span><span class="as-ptr">${[x.a === s.regs.esp ? 'esp' : '', x.a === s.regs.ebp ? 'ebp' : ''].filter(Boolean).map((n) => `← ${n}`).join('　')}</span></div>`).reverse().join('');
  const data = s.memw.length ? `<div class="as-data"><div class="tr-out-h">内存</div>${s.memw.map((x) => `<span class="as-m">[${hex8(x.a)}] = ${esc(regText(x.v))}</span>`).join('')}</div>` : '';
  return `<div class="tr-wrap"><pre class="tr-code">${code}</pre><div class="tr-state"><div class="tr-vars">${regs}</div><div class="as-flags">${flags}</div><div class="as-stack"><div class="tr-out-h">栈（高地址在上）</div>${stack || '<span class="muted">（还没有压栈）</span>'}</div>${data}</div></div>`;
}
// 寄存器的值：小的写十进制，像地址的写十六进制
const regText = (v, r) => (r === 'esp' || r === 'ebp' || u32(v) >= 0x10000 && s32(v) >= 0x10000 ? hex8(v) : String(s32(v)));

export const asmEngine = {
  name: 'asm', title: '机器级代码', head, parse, run, view,
  defaultAsk: (input) => (input.predicts.length ? 'predict' : ''),
  quiz(input, r) {
    if (r.error) throw new Error('代码运行出错，没有 quiz');
    return { q: `执行完这段代码${input.entry ? `（调用 ${input.entry.name}(${input.entry.args.join(', ')})）` : ''}以后，${input.quiz} 是多少？（十进制）`, type: 'num', answer: String(s32(r.regs[input.quiz])) };
  },
  // 考卷上那张表：每执行一条指令以后，几个寄存器的值（最多 30 条）
  table(input, r) {
    if (r.error) throw new Error('代码运行出错，没有表可填');
    const watch = input.watch || R32.filter((x) => x !== 'esp' && x !== 'ebp' && r.trace.some((t) => t.regs[x] !== input.regs[x])).slice(0, 3);
    if (!watch.length) throw new Error('这段代码没有改通用寄存器：写 watch: 选要填的寄存器');
    if (r.trace.length > 30) throw new Error(`一共执行了 ${r.trace.length} 条指令，填表太长：最多 30 条（改短一点，或者用 predict 只问几处）`);
    return {
      q: `每执行一条指令以后，${watch.join('、')} 是多少（十进制）？`, qhtml: '', dir: 'row', head: watch,
      rows: r.trace.map((t, i) => ({ label: `${i + 1}. 第 ${t.line} 行`, cells: watch.map((w) => ({ v: [String(s32(t.regs[w])), hex8(t.regs[w]), hex8(t.regs[w]).slice(0, -1).replace(/^0+(?=.)/, '') + 'H'], num: false })) })),
    };
  },
  problems(input, r) {
    const out = [];
    for (const w of r.unasked) out.push(`predict: 「${w.src}」一直没走到（条件没成立过），这个问题不会出现`);
    if (r.error) out.push(`asm：代码运行出错了：${r.error}（学生会看到出错的那一行；如果不是有意的，改一下代码或输入）`);
    return out;
  },
  // 常见错法：cmp 当成 b − a 比、lea 当成取内存里的数、有符号的条件转移按无符号判、shr 当成算术右移（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify([r.error, r.regs, r.steps.map((s) => String(s.ask?.answer ?? ''))]);
    let right;
    try { right = sig(run(input)); } catch { return []; }
    const has = (ops) => input.prog.some((p) => ops.includes(p.op));
    const list = [
      ...(has(['cmp']) ? [['cmpRev', '像是把 cmp a, b 当成了 b − a（Intel 写法按 a − b 设标志）']] : []),
      ...(has(['lea']) ? [['leaMem', '像是把 lea 当成了从内存取数（lea 只算地址，不访问内存）']] : []),
      ...(has(['jg', 'jge', 'jl', 'jle', 'jnle', 'jnl', 'jnge', 'jng']) ? [['unsigned', '像是把有符号的条件转移按无符号判了（jg / jl 看 SF、OF，ja / jb 才看 CF）']] : []),
      ...(has(['shr']) ? [['shrArith', '像是把 shr 当成了算术右移（shr 高位补 0，sar 才补符号位）']] : []),
    ];
    const out = [];
    for (const [m, label] of list) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};
