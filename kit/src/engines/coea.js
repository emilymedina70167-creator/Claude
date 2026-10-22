// 组成原理的寻址方式：ea（给寻址方式、形式地址 A、寄存器和一小块主存，一步步求有效地址 EA、操作数、访存次数）。
// 口径按王道：
//   访存次数不算取指令那一次；
//   相对寻址 EA = (PC) + A，(PC) 是取出这条指令以后的 PC：已经加了指令长度、指向下一条指令；A 是补码，可正可负；
//   n 次间接：取 EA 要访存 n 次，再取操作数一次；
//   堆栈（软堆栈，在主存里）：SP 指向栈顶元素，栈往低地址长：出栈先读 (SP) 再 SP + 1，进栈先 SP − 1 再写；
//   几条指令写在一起时各自独立，都从同一组寄存器、同一块主存开始（考卷上那种「同一块内存，几种寻址方式」的表）。
// 纯函数（tests/co2-engine.test.js）。
import { esc } from './arrayview.js';

// 一个数：2000H、0x2000、0b101、十进制（可以带负号）→ { v: BigInt, bits: 写出来的位数（十六进制一位算 4 位；十进制是 0）, hex }
export function readNum(src, what) {
  const s = String(src ?? '').trim().replace(/[_\s]/g, '').replace(/[−–—]/g, '-').replace(/ｈ/g, 'H');
  let m = /^(-?)(?:0x([0-9a-f]+)|([0-9a-f]+)H)$/i.exec(s);
  if (m) { const d = m[2] ?? m[3]; const v = BigInt(`0x${d}`); return { v: m[1] ? -v : v, bits: d.length * 4, hex: true }; }
  m = /^(-?)0b([01]+)$/i.exec(s);
  if (m) { const v = BigInt(`0b${m[2]}`); return { v: m[1] ? -v : v, bits: m[2].length, hex: true }; }
  if (/^-?\d+$/.test(s)) return { v: BigInt(s), bits: 0, hex: false };
  throw new Error(`${what}写成 2000H、0x2000 或十进制数（现在是「${src}」）`);
}
const digitsOf = (n) => (n.hex ? Math.ceil(n.bits / 4) : 0);

// 寻址方式的写法（先长后短：「寄存器间接」要先于「寄存器」，「间接变址」要先于「间接」）
const MODES = [
  { k: 'pop', re: /^(出栈|弹栈|pop)/i },
  { k: 'push', re: /^(进栈|入栈|压栈|push)/i },
  { k: 'idxind', re: /^(先变址后间址|变址间接|变址间址)/ },
  { k: 'indidx', re: /^(先间址后变址|间接变址|间址变址)/ },
  { k: 'regind', re: /^(寄存器间接|寄存器间址|regind)/i },
  { k: 'reg', re: /^(寄存器直接|寄存器|reg(?:ister)?)(?![a-z])/i },
  { k: 'imm', re: /^(立即数|立即|imm(?:ediate)?(?![a-z])|#)/i },
  { k: 'dir', re: /^(直接|dir(?:ect)?(?![a-z]))/i },
  { k: 'base', re: /^(基址|base(?![a-z]))/i },
  { k: 'index', re: /^(变址|index(?![a-z])|idx(?![a-z]))/i },
  { k: 'ind', re: /^(?:([一二两三四1-4])次)?(间接|间址|ind(?:irect)?(?![a-z])|@)/i },
  { k: 'rel', re: /^(PC相对|相对|rel(?:ative)?(?![a-z]))/i },
];
const NAME = { imm: '立即寻址', dir: '直接寻址', ind: '间接寻址', reg: '寄存器寻址', regind: '寄存器间接寻址', base: '基址寻址', index: '变址寻址', rel: '相对寻址', idxind: '先变址后间址', indidx: '先间址后变址', pop: '堆栈寻址（出栈）', push: '堆栈寻址（进栈）' };
const CN = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4 };

function parseIns(src, regs) {
  const text = String(src).trim();
  const compact = text.replace(/寻址/g, '').replace(/\s+/g, ' ').trim().replace(/^PC\s+相对/i, 'PC相对');
  const mode = MODES.find((x) => x.re.test(compact));
  if (!mode) throw new Error(`ins: 看不懂「${text}」：先写寻址方式（立即、直接、间接、寄存器、寄存器间接、基址、变址、相对、先变址后间址、先间址后变址、出栈、进栈），再写形式地址，比如「变址 2000H」`);
  const head = mode.re.exec(compact);
  let times = head[1] && mode.k === 'ind' ? (CN[head[1]] ?? Number(head[1])) : 1;
  const toks = compact.slice(head[0].length).trim().split(/\s+/).filter(Boolean);
  let reg = null, jump = false;
  const rest = [];
  for (const t of toks) {
    let m;
    if ((m = /^(?:[×xX*]([1-4])|([1-4])次)$/.exec(t)) && mode.k === 'ind') times = Number(m[1] ?? m[2]);
    else if (/^(转移|跳转|jmp|jump)$/i.test(t)) jump = true;
    else if (regs.has(t.toUpperCase()) && reg === null && !rest.length) reg = t.toUpperCase();
    else if (/^[(（][A-Za-z]\w*[)）]$/.test(t) && regs.has(t.slice(1, -1).toUpperCase())) reg = t.slice(1, -1).toUpperCase();
    else rest.push(t);
  }
  const k = mode.k;
  const ins = { text, k, times, reg, jump, a: null };
  if (jump && k !== 'rel') throw new Error(`ins: 「${text}」：转移只能跟相对寻址一起写（相对 06H 转移）`);
  if (['reg', 'regind'].includes(k)) {
    if (!reg) throw new Error(`ins: 「${text}」要写哪个寄存器（reg: 里先写上它的值，比如 reg: R1=0400H）`);
    if (rest.length) throw new Error(`ins: 「${text}」：${NAME[k]}只写寄存器，不写形式地址`);
    return ins;
  }
  if (k === 'pop' || k === 'push') {
    if (!regs.has('SP')) throw new Error(`ins: 「${text}」：堆栈寻址要在 reg: 里写 SP=…`);
    if (k === 'pop' && rest.length) throw new Error(`ins: 「${text}」：出栈后面不写东西`);
    if (k === 'push' && rest.length) ins.a = readNum(rest.join(''), `ins: 「${text}」进栈的数`);
    return ins;
  }
  if (!rest.length) throw new Error(`ins: 「${text}」少了形式地址 A（比如「${NAME[k].replace('寻址', '')} 2000H」）`);
  ins.a = readNum(rest.join(''), `ins: 「${text}」的形式地址`);
  if (['base', 'index', 'idxind', 'indidx'].includes(k)) {
    const want = k === 'base' ? 'BR' : 'IX';
    if (!reg) reg = regs.has(want) ? want : null;
    if (!reg) throw new Error(`ins: 「${text}」：${NAME[k]}要用${k === 'base' ? '基址' : '变址'}寄存器：reg: 里写 ${want}=…，或者指令里写寄存器名（${NAME[k].replace('寻址', '')} R1 ${rest.join('')}）`);
    ins.reg = reg;
  }
  if (k === 'imm' && reg) throw new Error(`ins: 「${text}」：立即寻址不用寄存器`);
  return ins;
}

// 地址=内容（逗号、分号或换行隔开）
function parsePairs(src, what, keyRe) {
  const out = [];
  for (const part of String(src ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*[=＝]\s*(.+)$/.exec(part);
    if (!m) throw new Error(`${what}一项写成「名字=值」，比如 ${what === 'mem: ' ? '2000H=3000H' : 'IX=1000H'}（现在有「${part}」）`);
    const key = m[1].trim();
    if (keyRe && !keyRe.test(key)) throw new Error(`${what}「${key}」不是寄存器名（写 R1、IX、BR、PC、SP 这样的）`);
    out.push([key, m[2].trim()]);
  }
  return out;
}

function parse(fields) {
  if (fields.ins === undefined || !String(fields.ins).trim()) throw new Error('ea 要写 ins:（寻址方式 + 形式地址，几条用逗号隔开），比如 ins: 变址 2000H');
  const regs = new Map();
  for (const [k, v] of parsePairs(fields.reg, 'reg: ', /^[A-Za-z]{1,4}\d{0,2}$/)) regs.set(k.toUpperCase(), readNum(v, `reg: ${k} 的值`));
  const mem = new Map();
  const memList = [];
  for (const [k, v] of parsePairs(fields.mem, 'mem: ')) {
    const a = readNum(k, 'mem: 的地址'), d = readNum(v, `mem: ${k} 的内容`);
    if (a.v < 0n) throw new Error(`mem: 地址不能是负数（${k}）`);
    if (mem.has(a.v)) throw new Error(`mem: 地址 ${k} 写了两次`);
    mem.set(a.v, d.v);
    memList.push({ a: a.v, d: d.v, an: a, dn: d });
  }
  const list = String(fields.ins).split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  if (list.length > 8) throw new Error('ins: 最多 8 条（多了一屏放不下）');
  const ins = list.map((x) => parseIns(x, regs));
  // 这条指令的地址：at:，或者 reg: 里的 PC（「当前 PC 的内容为 2003H」：还没取这条指令时的 PC）
  const at = fields.at !== undefined && String(fields.at).trim() !== '' ? readNum(fields.at, 'at: ') : regs.get('PC') ?? null;
  const len = fields.len === undefined || fields.len === '' ? 1 : Number(fields.len);
  if (!(Number.isInteger(len) && len >= 1 && len <= 16)) throw new Error('len: 指令占几个编址单位（按字节编址时两字节的指令写 2），1～16');
  const scale = fields.scale === undefined || fields.scale === '' ? 1 : Number(fields.scale);
  if (!(Number.isInteger(scale) && scale >= 1 && scale <= 16)) throw new Error('scale: 相对寻址的偏移量以几个编址单位为一个（MIPS 的 bne 偏移按指令数，写 4），1～16');
  if (ins.some((x) => x.k === 'rel') && !at) throw new Error('相对寻址要知道这条指令在哪：写 at: 2000H（这条指令的地址），或者 reg: 里写 PC=2000H');
  const dbits = fields.dbits === undefined || fields.dbits === '' ? 0 : Number(fields.dbits);
  if (dbits && !(Number.isInteger(dbits) && dbits >= 4 && dbits <= 32)) throw new Error('dbits: 形式地址字段的位数，4～32');
  const signed = /^(true|yes|on|1|是|补码)$/i.test(String(fields.signed ?? '').trim());
  // 十六进制写的就按十六进制答；全是十进制（课本上「20 号单元里是 40」）就按十进制答
  const nums = [...regs.values(), ...memList.flatMap((x) => [x.an, x.dn]), ...ins.map((x) => x.a).filter(Boolean), ...(at ? [at] : [])];
  const hexMode = nums.some((n) => n.hex);
  const adig = Math.max(2, ...memList.map((x) => digitsOf(x.an)), ...[...regs.values()].map(digitsOf), ...(at ? [digitsOf(at)] : []));
  const ddig = Math.max(2, ...memList.map((x) => digitsOf(x.dn)));
  const width = fields.width !== undefined && fields.width !== '' ? Number(fields.width) : Math.max(16, Math.ceil((adig * 4) / 8) * 8);
  if (!(Number.isInteger(width) && width >= 8 && width <= 64)) throw new Error('width: 地址的位数，8～64');
  const input = { ins, regs, mem, memList, at: at?.v ?? null, len, scale, dbits, signed, hexMode, adig, ddig, width, mistake: '' };
  ins.forEach((x) => solve(x, input)); // 主存里缺了要用的单元：现在就报
  return input;
}

const sg = (v) => (v < 0n ? `−${-v}` : String(v));
const MOD = (v, w) => { const M = 1n << BigInt(w); return ((v % M) + M) % M; };
function fmtA(v, input) { return input.hexMode ? `${MOD(v, input.width).toString(16).toUpperCase().padStart(input.adig, '0')}H` : String(v); }
function fmtD(v, input, dig = input.ddig) { if (!input.hexMode) return String(v); if (v < 0n) return `−${fmtD(-v, input, dig)}`; return `${v.toString(16).toUpperCase().padStart(dig, '0')}H`; }

// 形式地址 A 的值：相对寻址一定是补码；基址、变址写了 signed: true 才按补码（「形式地址用补码表示」）
function dispOf(ins, input) {
  const n = ins.a;
  const bits = input.dbits || n.bits;
  const signedHere = (ins.k === 'rel' || (input.signed && ['base', 'index', 'idxind', 'indidx'].includes(ins.k))) && input.mistake !== 'unsigned';
  if (signedHere && n.hex && bits && n.v >= 0n && (n.v >> BigInt(bits - 1)) & 1n) return { v: n.v - (1n << BigInt(bits)), neg: true, bits };
  return { v: n.v, neg: n.v < 0n, bits };
}

/**
 * 一条指令怎么取操作数：{ ea（主存地址，BigInt；立即、寄存器寻址是 null）, eaReg（寄存器寻址：寄存器名）, op（操作数；主存里没给是 null）,
 *   acc（访存次数，不算取指）, reads: [{ a, d, why }]（按先后访问的主存单元）, eaReads（其中算 EA 用的几次）, lines: [算 EA 的式子], regs: [用到的寄存器] }
 */
export function solve(ins, input) {
  const { mem, mistake } = input;
  const reads = [];
  const rd = (a, why, must = true) => {
    const x = MOD(a, input.width);
    if (!mem.has(x)) { if (must) throw new Error(`主存 ${fmtA(x, input)} 的内容没给（「${ins.text}」要用到它：mem: 里加上 ${fmtA(x, input)}=…）`); return null; }
    reads.push({ a: x, d: mem.get(x), why });
    return mem.get(x);
  };
  const R = (name) => input.regs.get(name).v;
  const out = { ea: null, eaReg: null, op: null, acc: 0, reads, eaReads: 0, lines: [], regs: [], jump: ins.jump, pc: null, sp: null, kind: ins.k };
  const A = ins.a ? dispOf(ins, input) : null;
  let k = ins.k;
  if (mistake === 'immDirect' && k === 'imm') k = 'dir';
  if (mistake === 'regAsReg' && k === 'regind') k = 'reg';
  out.kind = k; // 按错法算时走的是另一种方式（run 照它出步骤）
  switch (k) {
    case 'imm':
      out.op = A.v;
      break;
    case 'dir':
      out.ea = A.v;
      out.lines.push(`EA = A = ${fmtA(A.v, input)}`);
      break;
    case 'ind': {
      // 错法 indOnce：少间接了一次（一次间接就当成了直接）
      const n = mistake === 'indOnce' ? ins.times - 1 : ins.times;
      let x = A.v;
      const chain = [];
      for (let i = 0; i < n; i++) { const nx = rd(x, i === n - 1 ? 'EA' : '间址'); chain.push(`(${fmtA(x, input)}) = ${fmtA(nx, input)}`); x = nx; }
      out.ea = MOD(x, input.width);
      out.eaReads = n;
      out.lines.push(n ? `EA = ${'('.repeat(n)}A${')'.repeat(n)}：${chain.join('，')}` : `EA = A = ${fmtA(A.v, input)}`);
      break;
    }
    case 'reg':
      out.eaReg = ins.reg;
      out.op = R(ins.reg);
      out.regs.push(ins.reg);
      break;
    case 'regind':
      out.ea = MOD(R(ins.reg), input.width);
      out.regs.push(ins.reg);
      out.lines.push(`EA = (${ins.reg}) = ${fmtA(out.ea, input)}`);
      break;
    case 'base': case 'index': {
      const r = R(ins.reg);
      out.ea = MOD(r + A.v, input.width);
      out.regs.push(ins.reg);
      out.lines.push(`EA = (${ins.reg}) + A = ${fmtA(r, input)} + ${A.neg ? `(${sg(A.v)})` : fmtA(A.v, input)} = ${fmtA(out.ea, input)}`);
      break;
    }
    case 'idxind': {
      const t = MOD(R(ins.reg) + A.v, input.width);
      out.regs.push(ins.reg);
      if (mistake === 'indOnce') { out.ea = t; out.lines.push(`EA = (${ins.reg}) + A = ${fmtA(t, input)}`); break; }
      const e = rd(t, 'EA');
      out.ea = MOD(e, input.width);
      out.eaReads = 1;
      out.lines.push(`先变址：(${ins.reg}) + A = ${fmtA(R(ins.reg), input)} + ${fmtA(A.v, input)} = ${fmtA(t, input)}`, `再间址：EA = (${fmtA(t, input)}) = ${fmtA(out.ea, input)}`);
      break;
    }
    case 'indidx': {
      out.regs.push(ins.reg);
      const t = mistake === 'indOnce' ? A.v : rd(A.v, '间址');
      out.eaReads = mistake === 'indOnce' ? 0 : 1;
      out.ea = MOD(t + R(ins.reg), input.width);
      out.lines.push(mistake === 'indOnce' ? `EA = A + (${ins.reg}) = ${fmtA(out.ea, input)}` : `先间址：(A) = (${fmtA(A.v, input)}) = ${fmtA(t, input)}`, `再变址：EA = ${fmtA(t, input)} + (${ins.reg}) = ${fmtA(t, input)} + ${fmtA(R(ins.reg), input)} = ${fmtA(out.ea, input)}`);
      if (mistake === 'indOnce') out.lines.pop();
      break;
    }
    case 'rel': {
      // 错法 pcCur：用的是这条指令自己的地址（PC 还没加指令长度）；noScale：偏移量忘了乘单位
      const pc = mistake === 'pcCur' ? input.at : input.at + BigInt(input.len);
      const sc = mistake === 'noScale' ? 1 : input.scale;
      out.pc = pc;
      out.ea = MOD(pc + A.v * BigInt(sc), input.width);
      out.lines.push(`(PC) = ${fmtA(input.at, input)} + ${input.len} = ${fmtA(pc, input)}（取出这条指令以后）`, `EA = (PC) + A${sc > 1 ? ` × ${sc}` : ''} = ${fmtA(pc, input)} + ${A.neg ? `(${sg(A.v)})` : fmtD(A.v, input)}${sc > 1 ? ` × ${sc}` : ''} = ${fmtA(out.ea, input)}`);
      if (mistake === 'pcCur') out.lines[0] = `(PC) = ${fmtA(pc, input)}`;
      break;
    }
    case 'pop': {
      const sp = R('SP');
      out.ea = MOD(sp, input.width);
      out.regs.push('SP');
      out.sp = sp + 1n;
      out.lines.push(`EA = (SP) = ${fmtA(sp, input)}`);
      break;
    }
    case 'push': {
      const sp = R('SP') - 1n;
      out.ea = MOD(sp, input.width);
      out.regs.push('SP');
      out.sp = sp;
      out.lines.push(`(SP) − 1 → SP = ${fmtA(sp, input)}，EA = ${fmtA(sp, input)}`);
      if (ins.a) out.op = ins.a.v;
      break;
    }
    default: break;
  }
  if (out.ea !== null && !out.jump && k !== 'push') {
    out.op = rd(out.ea, '操作数', false);
    out.opRead = out.op !== null;
  }
  // 访存次数（不算取指）：取 EA 的几次 + 取（或写）操作数一次；转移指令只改 PC，不访存
  out.acc = out.jump ? 0 : out.eaReads + (out.ea !== null ? 1 : 0);
  if (mistake === 'fetch') out.acc += 1;
  return out;
}

const askKind = (input) => (input.hexMode ? 'hex' : 'number');
const ansOf = (v, input) => (input.hexMode ? v : Number(v));

function run(input) {
  const { ins } = input;
  const many = ins.length > 1;
  const sol = ins.map((x) => solve(x, input));
  const steps = [];
  const regText = [...input.regs].map(([k, v]) => `${k} = ${fmtD(v.v, input, Math.max(2, digitsOf(v)))}`).join('，');
  steps.push({ view: { i: -1, stage: '', upto: 0 }, msg: many
    ? `同一组寄存器、同一块主存，${ins.length} 条指令各用一种寻址方式（各自独立，互不影响）。${regText ? `寄存器：${regText}。` : ''}访存次数不算取指令那一次。`
    : `指令：${ins[0].text}（${NAME[ins[0].k]}）。${regText ? `寄存器：${regText}。` : ''}访存次数不算取指令那一次。` });
  ins.forEach((x, i) => {
    const s = sol[i];
    const pre = many ? `第 ${i + 1} 条「${x.text}」：` : '';
    const v = (stage) => ({ i, stage, upto: i });
    const kind = askKind(input);
    const kk = s.kind;
    // 第一拍：EA（立即、寄存器寻址没有主存地址，这一拍直接给操作数）
    if (kk === 'imm') {
      steps.push({ view: v('op'), msg: `${pre}立即寻址：操作数就在指令里，A 就是操作数 ${fmtD(s.op, input, Math.max(2, digitsOf(x.a)))}，没有 EA，也不用访存。`, ask: { tag: 'operand', kind, q: `${pre}操作数是多少？`, answer: ansOf(s.op, input), display: fmtD(s.op, input, Math.max(2, digitsOf(x.a))) } });
    } else if (kk === 'reg') {
      steps.push({ view: v('op'), msg: `${pre}寄存器寻址：操作数在寄存器 ${x.reg} 里，EA = ${x.reg}（寄存器编号，不是主存地址）。操作数 = (${x.reg}) = ${fmtD(s.op, input)}，不用访存。`, ask: { tag: 'operand', kind, q: `${pre}操作数是多少？`, answer: ansOf(s.op, input), display: fmtD(s.op, input) } });
    } else {
      const why = {
        dir: () => '直接寻址：形式地址就是有效地址。',
        ind: () => x.times > 1 ? `${x.times} 次间接：A 指向的单元里放的是地址，再拿它去取，${x.times} 次以后才是 EA。` : '间接寻址：A 指向的单元里放的才是 EA（要先访存一次）。',
        regind: () => `寄存器间接：寄存器 ${x.reg} 里放的是 EA。`,
        base: () => `基址寻址：EA = 基址寄存器 ${x.reg} 的内容 + 形式地址${dispOf(x, input).neg && x.a.hex ? `（A = ${fmtD(x.a.v, input, Math.ceil(x.a.bits / 4))} 是补码，等于 ${sg(dispOf(x, input).v)}，先符号扩展）` : ''}。`,
        index: () => `变址寻址：EA = 变址寄存器 ${x.reg} 的内容 + 形式地址${dispOf(x, input).neg && x.a.hex ? `（A = ${fmtD(x.a.v, input, Math.ceil(x.a.bits / 4))} 是补码，等于 ${sg(dispOf(x, input).v)}）` : ''}。`,
        rel: () => `相对寻址：EA = (PC) + A。按王道的约定，(PC) 是取出这条指令以后的 PC：已经加了指令长度 ${input.len}，指向下一条指令；A 是补码${dispOf(x, input).neg && x.a.hex ? `（${fmtD(x.a.v, input, Math.ceil(x.a.bits / 4))} = ${sg(dispOf(x, input).v)}）` : ''}${input.scale > 1 ? `，以 ${input.scale} 个编址单位为一个` : ''}。`,
        idxind: () => '先变址后间址：先算 (变址寄存器) + A，再到这个单元里取 EA。',
        indidx: () => '先间址后变址：先到 A 单元里取一个地址，再加上变址寄存器的内容。',
        pop: () => '出栈（堆栈寻址）：操作数在栈顶，SP 指向栈顶元素（王道的约定：栈往低地址长）。',
        push: () => '进栈（堆栈寻址）：SP 指向栈顶元素，先 SP − 1 再写进去。',
      }[kk]();
      steps.push({ view: v('ea'), msg: `${pre}${why}${s.lines.join('；')}。${x.jump ? `这是转移指令：EA 就是转移的目标地址，执行完 PC = ${fmtA(s.ea, input)}。` : ''}`, ask: { tag: 'ea', kind, q: `${pre}${x.jump ? '转移的目标地址（EA）' : '有效地址 EA'}是多少？`, answer: ansOf(s.ea, input), display: fmtA(s.ea, input) } });
      if (!x.jump && x.k !== 'push') {
        steps.push({ view: v('op'), msg: s.op === null ? `${pre}操作数在主存 ${fmtA(s.ea, input)} 里（题目没给它的内容）。` : `${pre}操作数 = (EA) = (${fmtA(s.ea, input)}) = ${fmtD(s.op, input)}。${x.k === 'pop' ? `读完以后 (SP) + 1 → SP = ${fmtA(s.sp, input)}。` : ''}`, ask: s.op === null ? undefined : { tag: 'operand', kind, q: `${pre}操作数是多少？`, answer: ansOf(s.op, input), display: fmtD(s.op, input) } });
      } else if (x.k === 'push') {
        steps.push({ view: v('op'), msg: `${pre}${s.op !== null ? `把 ${fmtD(s.op, input)} 写进` : '写进'}主存 ${fmtA(s.ea, input)}，现在 SP = ${fmtA(s.sp, input)}，指向新的栈顶。` });
      }
    }
    // 第三拍：访存几次
    const parts = [];
    if (s.eaReads) parts.push(`取 EA 访存 ${s.eaReads} 次`);
    if (s.ea !== null && !x.jump) parts.push(x.k === 'push' ? '写操作数 1 次' : '取操作数 1 次');
    const accText = s.acc === 0 ? (x.jump ? '转移指令只是把 EA 送进 PC，不访存' : `${kk === 'imm' ? '操作数在指令里' : '操作数在寄存器里'}，不访存`) : parts.join('，');
    steps.push({ view: v('acc'), msg: `${pre}访存 ${s.acc} 次（不算取指令）：${accText}。`, ask: { tag: 'access', kind: 'number', q: `${pre}取操作数一共要访存几次（不算取指令）？`, answer: s.acc } });
  });
  if (many) steps.push({ view: { i: -1, stage: '', upto: ins.length }, msg: `${ins.length} 条指令都做完了：${ins.map((x, i) => `「${x.text}」取到 ${opText(sol[i], input)}`).join('，')}。` });
  return { steps, sol };
}
const opText = (s, input) => (s.op === null ? (s.jump ? `目标地址 ${fmtA(s.ea, input)}` : '（主存里没给）') : fmtD(s.op, input));
const eaText = (s, input) => (s.eaReg ? s.eaReg : s.ea === null ? '—' : fmtA(s.ea, input));

function view(st, input) {
  const { ins } = input;
  const sol = ins.map((x) => solve(x, input));
  const cur = st.i >= 0 ? sol[st.i] : null;
  const shown = (i, what) => i < st.upto || (i === st.i && ({ ea: 1, op: 2, acc: 3 }[st.stage] || 0) >= what);
  let cmd = 0;
  // 指令表：一行一条，算到哪写到哪
  const rows = ins.map((x, i) => {
    const s = sol[i];
    const on = i === st.i;
    const eaCell = shown(i, x.k === 'imm' || x.k === 'reg' ? 2 : 1) ? esc(eaText(s, input)) : '';
    const opCell = shown(i, 2) ? esc(x.jump ? '—' : opText(s, input)) : '';
    const accCell = shown(i, 3) ? String(s.acc) : '';
    return `<tr class="${on ? 'ea-on' : ''}" data-cmd="${++cmd}" data-label="${esc(x.text)}"><th scope="row">${esc(x.text)}<small>${esc(NAME[x.k])}</small></th><td class="ea-c">${eaCell}</td><td class="ea-c">${opCell}</td><td class="ea-c">${accCell}</td></tr>`;
  }).join('');
  // st.given：只画题目给的（寄存器、主存），quiz 和填表的题面用
  let h = '<div class="ea-wrap">';
  if (!st.given) {
    h += `<div class="ea-main"><table class="sv-tab ea-tab"><thead><tr><th>指令</th><th>EA</th><th>操作数</th><th>访存</th></tr></thead><tbody>${rows}</tbody></table>`;
    if (cur && st.stage !== 'acc' && cur.lines.length && st.stage) h += `<div class="ea-f">${cur.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
    h += '</div>';
  }
  h += '<div class="ea-side">';
  // 寄存器
  const pcNow = cur?.pc;
  const regList = [...input.regs].map(([k, v]) => ({ k, text: fmtD(v.v, input, Math.max(2, digitsOf(v))) }));
  if (ins.some((x) => x.k === 'rel')) {
    if (input.at !== null && !input.regs.has('PC')) regList.push({ k: '指令地址', text: fmtA(input.at, input) });
    regList.push({ k: '指令长度', text: String(input.len) });
    if (input.scale > 1) regList.push({ k: '偏移单位', text: `×${input.scale}` });
  }
  if (regList.length) {
    h += `<div class="ea-regs">${regList.map((r) => `<span class="ea-reg${cur?.regs.includes(r.k) && st.stage ? ' ea-use' : ''}" data-cmd="${++cmd}" data-label="${esc(r.k)}"><b>${esc(r.k)}</b>${esc(r.text)}</span>`).join('')}${pcNow !== null && pcNow !== undefined && st.stage ? `<span class="ea-reg ea-use"><b>取指后 PC</b>${esc(fmtA(pcNow, input))}</span>` : ''}</div>`;
  }
  // 主存：这条指令访问过的单元标上 ①②，EA 那一格描边
  if (input.memList.length) {
    const lvl = { ea: 1, op: 2, acc: 3 }[st.stage] || 0;
    const reads = cur ? cur.reads.filter((r, j) => (lvl >= 2 ? true : j < cur.eaReads)) : [];
    const rowsM = [...input.memList].sort((a, b) => (a.a < b.a ? -1 : 1)).map((m) => {
      const hits = reads.map((r, j) => (r.a === m.a ? j : -1)).filter((j) => j >= 0);
      const isEa = cur && lvl >= 1 && cur.ea !== null && MOD(cur.ea, input.width) === m.a;
      const isOp = isEa && lvl >= 2 && !cur.jump;
      const cls = [hits.length ? 'ea-hit' : '', isEa ? 'ea-ea' : '', isOp ? 'ea-op' : ''].filter(Boolean).join(' ');
      return `<tr class="${cls}" data-cmd="${++cmd}" data-label="${esc(fmtA(m.a, input))}" data-pick="${esc(fmtA(m.a, input))}"><td>${esc(fmtA(m.a, input))}${hits.map((j) => `<span class="ea-n">${'①②③④⑤⑥'[j] || j + 1}</span>`).join('')}</td><td>${esc(fmtD(m.d, input))}</td></tr>`;
    }).join('');
    h += `<table class="sv-tab ea-mem"><thead><tr><th>地址</th><th>内容</th></tr></thead><tbody>${rowsM}</tbody></table>`;
  }
  return `${h}</div></div>`;
}

// 题目给的数（quiz、填表的题面）：寄存器和主存；什么都没给时不画
const given = (input) => (input.regs.size || input.memList.length || input.ins.some((x) => x.k === 'rel') ? view({ i: -1, stage: '', upto: 0, given: true }, input) : '');
const hexAlts = (t) => { const d = t.replace(/H$/, ''); return t.endsWith('H') ? [t, d, `0x${d}`] : [t]; };

// 错法算出来和对的完全一样就不列（列着也认不出什么）
export function keepDiffering(engine, input, list, fields = {}) {
  const sig = (inp) => {
    const r = engine.run(inp);
    const asks = r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean).map((a) => [a.q, String(a.alts ?? a.answer)]);
    let t = null, q = null;
    try { t = engine.table?.(inp, r, fields)?.rows.map((row) => row.cells.map((c) => c.v)); } catch { /* */ }
    try { q = engine.quiz?.(inp, r, fields)?.answer ?? null; } catch { /* */ }
    return JSON.stringify([asks, t, String(q)], (k, v) => (typeof v === 'bigint' ? `${v}n` : v));
  };
  let base;
  try { base = sig(input); } catch { return []; }
  return list.filter((v) => { try { return sig(v.input) !== base; } catch { return false; } });
}

export const eaEngine = {
  name: 'ea', title: '寻址方式', parse, run, view,
  quiz(input, r) {
    if (input.ins.length === 1) {
      const s = r.sol[0];
      if (s.op === null) return { qhtml: given(input), q: `「${input.ins[0].text}」的有效地址 EA 是多少？`, type: input.hexMode ? 'hex' : 'num', answer: input.hexMode ? `0x${MOD(s.ea, input.width).toString(16)}` : String(s.ea) };
      return { qhtml: given(input), q: `「${input.ins[0].text}」取到的操作数是多少？`, type: input.hexMode ? 'hex' : 'num', answer: input.hexMode ? `0x${s.op.toString(16)}` : String(s.op) };
    }
    const forms = (f) => r.sol.map((s) => (s.op === null ? '?' : f(s.op))).join(' ');
    const hx = (v) => v.toString(16).toUpperCase();
    return { qhtml: given(input), q: `按顺序写出这 ${input.ins.length} 条指令取到的操作数（空格隔开）：${input.ins.map((x) => `「${x.text}」`).join('、')}。`, type: 'seq', answer: input.hexMode ? [forms((v) => `${hx(v)}H`), forms(hx), forms((v) => `0x${hx(v)}`)].join(' | ') : forms(String) };
  },
  table(input, r) {
    return {
      q: '把每条指令的有效地址 EA、操作数、访存次数（不算取指令）填上。立即寻址没有 EA，空着；寄存器寻址的 EA 写寄存器名。', qhtml: given(input), dir: 'row',
      head: ['EA', '操作数', '访存次数'],
      rows: input.ins.map((x, i) => {
        const s = r.sol[i];
        const ea = s.eaReg ? { v: [s.eaReg] } : s.ea === null ? { v: '' } : { v: hexAlts(fmtA(s.ea, input)) };
        const op = s.op === null ? { v: x.jump ? '' : '?', given: true } : { v: hexAlts(fmtD(s.op, input)) };
        return { label: x.text, cells: [ea, op, { v: String(s.acc), num: true }] };
      }),
    };
  },
  variants(input) {
    const has = (k) => input.ins.some((x) => x.k === k || (k === 'ind' && ['idxind', 'indidx'].includes(x.k)));
    const list = [
      ['fetch', '像是把取指令那一次也算进了访存次数（王道的访存次数不算取指）'],
      ['pcCur', '像是相对寻址用了这条指令自己的地址（取指以后 PC 已经加了指令长度，指向下一条）', 'rel'],
      ['noScale', '像是相对寻址的偏移量忘了乘单位（偏移按指令数算时要乘指令长度）', 'rel'],
      ['indOnce', '像是少间接了一次（间接寻址时 A 单元里放的是地址，不是操作数）', 'ind'],
      ['immDirect', '像是把立即数当成了地址去取（立即寻址的 A 就是操作数）', 'imm'],
      ['regAsReg', '像是把寄存器间接当成了寄存器寻址（寄存器里放的是地址，还要访存一次）', 'regind'],
      ['unsigned', '像是形式地址没按补码（负的偏移量要先符号扩展）'],
    ].filter(([, , k]) => !k || has(k)).map(([m, label]) => ({ label, input: { ...input, mistake: m } }));
    return keepDiffering(eaEngine, input, list);
  },
};
