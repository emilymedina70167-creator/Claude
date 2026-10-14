// 计算机组成原理的演示引擎（纯函数，不碰 DOM；tests/co-engine.test.js）：
//   bits   数的表示：原码 / 反码 / 补码 / 移码；IEEE 754 单精度（编码、解码）；补码加减法和标志位 OF SF ZF CF
//   cache  Cache 的映射和替换（直接映射、组相联、全相联；LRU / FIFO），地址拆成标记 | 组号 | 块内地址
//   pipe   五段指令流水线（IF ID EX MEM WB）：数据相关、阻塞（有没有转发），时空图
import { bitFields, parseNum, parseSize, log2int, hex as hexOf } from './bitview.js';
import { chips, esc } from './arrayview.js';

const bin = (v, n) => (BigInt.asUintN(n, BigInt(v))).toString(2).padStart(n, '0');
const group4 = (s) => s.replace(/\B(?=(\d{4})+$)/g, ' ');

// ================= bits：数的表示 =================

// 十进制小数 → 精确的分数 n/d（BigInt）
function rational(src) {
  const m = /^([-+]?)(\d*)(?:\.(\d*))?(?:e([-+]?\d+))?$/i.exec(String(src).trim());
  if (!m || (!m[2] && !m[3])) throw new Error(`看不懂数「${src}」`);
  let n = BigInt((m[2] || '0') + (m[3] || ''));
  let d = 10n ** BigInt((m[3] || '').length);
  const e = Number(m[4] || 0);
  if (e > 0) n *= 10n ** BigInt(e); else if (e < 0) d *= 10n ** BigInt(-e);
  if (m[1] === '-') n = -n;
  return { n, d };
}

function bitsParse(fields) {
  const width = fields.width === undefined || fields.width === '' ? 8 : Number(fields.width);
  if (fields.float !== undefined) {
    const src = String(fields.float).trim();
    const decode = /^(0x[0-9a-f]+|[0-9a-f]+H)$/i.test(src);
    return { mode: 'float', src, decode, bitsVal: decode ? parseNum(src, 'float') : null, value: decode ? null : rational(src) };
  }
  if (!Number.isInteger(width) || width < 2 || width > 32) throw new Error('width: 写 2 到 32 的位数（默认 8）');
  for (const op of ['add', 'sub']) {
    if (fields[op] === undefined) continue;
    const parts = String(fields[op]).trim().match(/^(-?(?:0x[0-9a-f]+|[0-9a-f]+H|0b[01]+|\d+))\s*([+\-−])\s*(-?(?:0x[0-9a-f]+|[0-9a-f]+H|0b[01]+|\d+))$/i);
    if (!parts) throw new Error(`${op}: 写成「0x7F + 0x01」或「5 - 7」（两个数，中间 + 或 -）`);
    const val = (s) => (s.startsWith('-') ? -parseNum(s.slice(1)) : parseNum(s));
    const a = val(parts[1]), b = val(parts[3]);
    const sub = parts[2] !== '+';
    for (const x of [a, b]) if (x < -(1n << BigInt(width - 1)) || x >= 1n << BigInt(width)) throw new Error(`${x} 用 ${width} 位放不下`);
    return { mode: 'arith', a, b, sub, width, src: String(fields[op]).trim() };
  }
  if (fields.num === undefined) throw new Error('bits 要写 num:（看原码、反码、补码、移码）、float:（IEEE 754）或 add: / sub:（补码加减和标志位）');
  const s = String(fields.num).trim();
  if (!/^[-+]?\d+$/.test(s)) throw new Error('num: 写一个整数（如 -5）');
  const x = BigInt(s);
  const lim = 1n << BigInt(width - 1);
  if (x < -lim || x >= lim) throw new Error(`num: ${s} 用 ${width} 位补码放不下（范围 ${-lim} ～ ${lim - 1n}）`);
  const show = String(fields.show || '原码 反码 补码 移码').split(/[\s,，、]+/).filter(Boolean);
  for (const k of show) if (!['原码', '反码', '补码', '移码'].includes(k)) throw new Error(`show: 只能写 原码 反码 补码 移码（现在有「${k}」）`);
  return { mode: 'code', x, width, show };
}

// mistake（只在算常见错法时用）：'noPlusOne' 负数补码忘了 +1；'noFlip' 移码忘了把符号位取反；'flipSign' 反码连符号位也取反了
function codeRun({ x, width: n, show, mistake }) {
  const steps = [];
  const neg = x < 0n;
  const mag = neg ? -x : x;
  const lim = 1n << BigInt(n - 1);
  const rows = {};
  const tag = { 原码: 'orig', 反码: 'ones', 补码: 'twos', 移码: 'bias' };
  steps.push({ view: { rows: { ...rows } }, msg: `${x} 用 ${n} 位表示（最高位是符号位，0 正 1 负）。|${x}| = ${mag} = ${mag.toString(2)}B。` });
  const can = mag < lim; // 原码、反码表示不了 −2^(n−1)
  const orig = can ? (neg ? '1' : '0') + bin(mag, n - 1) : null;
  let ones = can ? (neg ? '1' + [...bin(mag, n - 1)].map((c) => (c === '1' ? '0' : '1')).join('') : orig) : null;
  let twos = bin(x, n);
  let bias = bin(x + lim, n);
  if (mistake === 'noPlusOne' && neg && ones) twos = ones;
  if (mistake === 'noFlip') bias = twos;
  if (mistake === 'flipSign' && neg && ones) ones = '0' + ones.slice(1);
  const add = (k, val, msg) => {
    if (!show.includes(k)) return;
    rows[k] = val;
    steps.push({ view: { rows: { ...rows }, cur: k }, msg, ask: val === null ? undefined : { tag: tag[k], kind: 'bin', width: n, q: `${x} 的 ${n} 位${k}是什么？`, answer: BigInt(`0b${val}`), display: group4(val) } });
  };
  add('原码', orig, can ? `原码：符号位 ${neg ? 1 : 0}，后面 ${n - 1} 位是绝对值 ${mag} 的二进制：${group4(orig)}。` : `${x} 的绝对值 ${mag} 用 ${n - 1} 位放不下：原码表示不了（${n} 位原码的范围是 ±${lim - 1n}）。`);
  add('反码', ones, !can ? `反码也表示不了 ${x}。` : neg ? `反码：负数的符号位不变、数值位按位取反：${group4(ones)}。` : `反码：正数的反码和原码一样：${group4(ones)}。`);
  add('补码', twos, neg ? (can ? `补码：负数的补码 = 反码 + 1：${group4(ones)} + 1 = ${group4(twos)}（也就是 2^${n} − ${mag} = ${(1n << BigInt(n)) - mag}）。` : `补码：${x} = −2^${n - 1}，补码是 ${group4(twos)}（只有补码能表示它）。`) : `补码：正数的补码和原码一样：${group4(twos)}。`);
  add('移码', bias, `移码 = 补码的符号位取反（也就是 ${x} + 2^${n - 1} = ${x + lim}）：${group4(bias)}。`);
  return { steps, rows };
}

// —— IEEE 754 单精度 ——
function floatRun(input) {
  const steps = [];
  const BIAS = input.bias ?? 127; // 常见错法「偏置用 128」只在算错法时改
  const F = (v) => [{ name: '符号 S', bits: 1, cls: 'bv-b' }, { name: '阶码 E', bits: 8, cls: 'bv-a' }, { name: '尾数 M', bits: 23, cls: 'bv-c' }];
  if (input.decode) {
    const v = input.bitsVal;
    if (v >= 1n << 32n) throw new Error('float: 单精度是 32 位，十六进制最多 8 位');
    const S = Number(v >> 31n), E = Number((v >> 23n) & 0xffn), M = v & 0x7fffffn;
    steps.push({ view: { v, fields: F() }, msg: `${input.src} 写成 32 位二进制，按 1 | 8 | 23 拆开：符号 S = ${S}，阶码 E = ${E}（${bin(E, 8)}），尾数 M = ${bin(M, 23)}。`, ask: { tag: 'exp', kind: 'number', q: '阶码 E（十进制）是多少？', answer: E } });
    let value, text;
    if (E === 255) { text = M ? 'NaN（不是数）' : `${S ? '−' : '+'}∞`; value = null; }
    else if (E === 0) {
      value = (S ? -1 : 1) * Number(M) * 2 ** -149;
      text = M ? `非规格化数：(−1)^${S} × 0.M × 2^−126 = ${value}` : `${S ? '−' : '+'}0`;
    } else {
      const frac = 1 + Number(M) / 2 ** 23;
      value = (S ? -1 : 1) * frac * 2 ** (E - 127);
      text = `(−1)^${S} × 1.${bin(M, 23).replace(/0+$/, '') || '0'}B × 2^(${E} − 127) = ${S ? '−' : ''}${frac} × 2^${E - 127} = ${value}`;
    }
    steps.push({ view: { v, fields: F(), hi: ['阶码 E'] }, msg: E === 255 || E === 0 ? `阶码全 ${E ? 1 : 0}：特殊值。${text}。` : `规格化数：真正的指数 = E − 127 = ${E - 127}；尾数前面补上隐藏的 1：1.M。`, ask: value === null ? undefined : { tag: 'value', kind: 'number', q: `${input.src} 表示的数是多少？`, answer: value } });
    steps.push({ view: { v, fields: F() }, msg: `值 = ${text}。` });
    return { steps, value, bits: v };
  }
  const { n, d } = input.value;
  const neg = n < 0n;
  let a = neg ? -n : n;
  if (a === 0n) {
    const v = neg ? 1n << 31n : 0n;
    steps.push({ view: { v, fields: F() }, msg: `${input.src} 是 0：阶码、尾数全 0${neg ? '，符号位 1（−0）' : ''}，就是 ${hexOf(v, 32)}。` });
    return { steps, bits: v };
  }
  // 二进制：先找到最高位 1 的位置（指数 e），再取 24 位有效数字（舍入：就近、一样近取偶）
  const below = (k) => (k >= 0 ? a < d * (1n << BigInt(k)) : a * (1n << BigInt(-k)) < d); // |x| < 2^k
  let e = 0;
  while (!below(e + 1)) e++;
  while (below(e)) e--;
  // 有效数字 × 2^23：a/d / 2^e × 2^23
  const scaleNum = e >= 23 ? a : a * 2n ** BigInt(23 - e);
  const scaleDen = e >= 23 ? d * 2n ** BigInt(e - 23) : d;
  let sig = scaleNum / scaleDen;
  const rem = scaleNum - sig * scaleDen;
  const exact = rem === 0n;
  if (rem * 2n > scaleDen || (rem * 2n === scaleDen && sig % 2n === 1n)) sig += 1n;
  if (sig >= 1n << 24n) { sig >>= 1n; e += 1; }
  const E = e + BIAS;
  if (E >= 255) throw new Error(`${input.src} 太大了，单精度放不下`);
  if (E <= 0) throw new Error(`${input.src} 太小了（要用非规格化数），这里只演示规格化数`);
  const M = sig & 0x7fffffn;
  const S = neg ? 1 : 0;
  const v = (BigInt(S) << 31n) | (BigInt(E) << 23n) | M;
  const mStr = bin(M, 23);
  const binText = binaryText(a, d);
  steps.push({ view: { fields: null }, msg: `${input.src}：符号位 S = ${S}（${neg ? '负' : '正'}数）。绝对值写成二进制：${binText}${exact ? '' : '（除不尽，后面取到 24 位有效数字，就近舍入）'}。`, ask: { tag: 'sign', kind: 'number', q: '符号位 S 是多少？', answer: S } });
  steps.push({ view: { fields: null }, msg: `规格化：写成 1.${mStr.replace(/0+$/, '') || '0'}B × 2^${e}（小数点移到第一个 1 后面，移了 ${Math.abs(e)} 位，指数是 ${e}）。` });
  steps.push({ view: { v, fields: F(), hi: ['阶码 E'] }, msg: `阶码 E = 指数 + 127 = ${e} + 127 = ${E} = ${bin(E, 8)}B（移码，偏置 127）。`, ask: { tag: 'exp', kind: 'bin', width: 8, q: '阶码 E（8 位二进制）是什么？', answer: BigInt(E), display: bin(E, 8) } });
  steps.push({ view: { v, fields: F(), hi: ['尾数 M'] }, msg: `尾数 M：1.后面的 23 位（隐藏最前面的 1）：${group4(mStr)}。` });
  steps.push({ view: { v, fields: F() }, msg: `合起来：${S} ${bin(E, 8)} ${mStr} = ${hexOf(v, 32)}。`, ask: { tag: 'hex', kind: 'hex', width: 8, q: `${input.src} 的单精度表示（十六进制）是什么？`, answer: v, display: hexOf(v, 32) } });
  return { steps, bits: v, S, E, M: mStr };
}
// a/d 的二进制写法（整数部分 + 小数部分，小数最多 24 位）
function binaryText(a, d) {
  const ip = a / d;
  let r = a - ip * d;
  let fs = '';
  for (let i = 0; i < 24 && r; i++) { r *= 2n; if (r >= d) { fs += '1'; r -= d; } else fs += '0'; }
  return `${ip.toString(2)}${fs ? `.${fs}` : ''}${r ? '…' : ''}B`;
}

// —— 补码加减和标志位 ——
// mistake（只在算常见错法时用）：'cfRaw' 减法的 CF 直接取最高位进位（没和 Cin 异或）；'ofCarry' 把 OF 当成最高位进位
function arithRun({ a, b, sub, width: n, mistake }) {
  const steps = [];
  const mask = (1n << BigInt(n)) - 1n;
  const A = BigInt.asUintN(n, a), B = BigInt.asUintN(n, b);
  const Bin = sub ? (~B) & mask : B;
  const cin = sub ? 1n : 0n;
  // 逐位相加，记每一位的进位
  const carries = [];
  let c = cin;
  let R = 0n;
  for (let i = 0; i < n; i++) {
    const x = (A >> BigInt(i)) & 1n, y = (Bin >> BigInt(i)) & 1n;
    const s = x ^ y ^ c;
    R |= s << BigInt(i);
    c = (x & y) | (x & c) | (y & c);
    carries.push(c);
  }
  const Cn = carries[n - 1], Cn1 = carries[n - 2];
  const OF = mistake === 'ofCarry' ? Number(Cn) : Number(Cn ^ Cn1), SF = Number((R >> BigInt(n - 1)) & 1n), ZF = R === 0n ? 1 : 0, CF = mistake === 'cfRaw' ? Number(Cn) : Number(Cn ^ cin);
  const signed = (v) => BigInt.asIntN(n, v);
  const view = (extra = {}) => ({ A, B, Bin, R, carries, cin, ...extra });
  steps.push({ view: view({ stage: 0 }), msg: `${n} 位：X = ${a}（${group4(bin(A, n))}），Y = ${b}（${group4(bin(B, n))}）。${sub ? '减法在加法器里做：X − Y = X + (Y 按位取反) + 1（加法器的进位输入 Cin = 1）。' : '加法：X + Y，进位输入 Cin = 0。'}` });
  if (sub) steps.push({ view: view({ stage: 1 }), msg: `Y 按位取反：${group4(bin(Bin, n))}，再加上 Cin = 1。`, ask: { tag: 'neg', kind: 'bin', width: n, q: `Y 按位取反是什么？`, answer: Bin, display: group4(bin(Bin, n)) } });
  steps.push({ view: view({ stage: 2 }), msg: `从最低位往上逐位相加（上面一行是每一位向高位的进位）：结果 ${group4(bin(R, n))}；最高位的进位 C${n} = ${Cn}，次高位的进位 C${n - 1} = ${Cn1}。`, ask: { tag: 'result', kind: 'bin', width: n, q: '结果的二进制是什么？', answer: R, display: group4(bin(R, n)) } });
  const flags = [
    ['OF', OF, `OF（溢出）= C${n} ⊕ C${n - 1} = ${Cn} ⊕ ${Cn1} = ${OF}：${OF ? `当成有符号数，结果溢出了（真实结果 ${sub ? signed(A) - signed(B) : signed(A) + signed(B)} 超出 ${n} 位补码的范围）` : '当成有符号数没有溢出'}`],
    ['SF', SF, `SF（符号）= 结果的最高位 = ${SF}`],
    ['ZF', ZF, `ZF（零）= ${ZF}：结果${ZF ? '是' : '不是'} 0`],
    ['CF', CF, `CF（进位 / 借位）= C${n} ⊕ Cin = ${Cn} ⊕ ${cin} = ${CF}：${CF ? `当成无符号数，${sub ? '不够减，有借位' : '有进位，超出了'}` : `当成无符号数，${sub ? '够减，没有借位' : '没有进位'}`}`],
  ];
  for (const [k, v2, msg] of flags) steps.push({ view: view({ stage: 3, flag: k, flags: Object.fromEntries(flags.slice(0, flags.findIndex((f) => f[0] === k) + 1).map((f) => [f[0], f[1]])) }), msg: `${msg}（王道的定义）。`, ask: { tag: k.toLowerCase(), kind: 'number', q: `${k} 是多少？`, answer: v2 } });
  steps.push({ view: view({ stage: 3, flags: { OF, SF, ZF, CF } }), msg: `结果 ${group4(bin(R, n))}：当成无符号数是 ${R}，当成有符号数（补码）是 ${signed(R)}。标志位 OF = ${OF}，SF = ${SF}，ZF = ${ZF}，CF = ${CF}。` });
  return { steps, R, flags: { OF, SF, ZF, CF } };
}

function bitsRun(input) {
  if (input.mode === 'code') return codeRun(input);
  if (input.mode === 'float') return floatRun(input);
  return arithRun(input);
}

function bitsView(s, input) {
  if (input.mode === 'code') {
    const n = input.width;
    const rows = Object.entries(s.rows);
    if (!rows.length) return `<div class="co-num">${esc(String(input.x))}<small>用 ${n} 位表示</small></div>`;
    // 四位一组按整个位串分，符号位（最高位）用粉色
    return `<div class="co-codes">${rows.map(([k, v]) => `<div class="co-code${s.cur === k ? ' co-cur' : ''}"><span class="co-k">${k}</span>${v === null ? '<span class="muted">表示不了</span>' : `<span class="co-bits">${group4(v).replace(/^(\d)/, '<b>$1</b>')}</span>`}</div>`).join('')}</div>`;
  }
  if (input.mode === 'float') return s.fields ? bitFields(s.v, s.fields, { hi: s.hi || [] }) : `<div class="co-num">${esc(input.src)}</div>`;
  const n = input.width;
  // 每一行最左边空一格：进位那一行在那里写最高位的进位 Cn；其余进位写在它进入的那一位上面
  const row = (label, v, cls = '') => `<div class="co-row ${cls}"><span class="co-k">${label}</span><span></span>${[...bin(v, n)].map((c, i) => `<span data-cmd="${i + 1}">${c}</span>`).join('')}</div>`;
  let h = '<div class="co-add">';
  if (s.stage >= 2) {
    const into = [s.cin, ...s.carries.slice(0, n - 1)]; // 进入第 0…n−1 位的进位
    h += `<div class="co-row co-carry"><span class="co-k">进位</span><span class="co-cout">${s.carries[n - 1]}</span>${into.reverse().map((c) => `<span>${c}</span>`).join('')}</div>`;
  }
  h += row('X', s.A);
  h += row(input.sub ? (s.stage >= 1 ? '~Y' : 'Y') : 'Y', input.sub && s.stage >= 1 ? s.Bin : s.B, 'co-plus');
  if (s.stage >= 2) h += row('结果', s.R, 'co-sum');
  h += '</div>';
  if (s.flags) h += chips(Object.entries(s.flags).map(([k, v]) => [k, v]));
  return h;
}

export const bitsEngine = {
  name: 'bits',
  title: '数的表示',
  parse: bitsParse,
  run: bitsRun,
  view: bitsView,
  quiz(input, r, fields) {
    if (input.mode === 'code') {
      const k = String(fields.quiz || '补码').trim();
      if (!r.rows[k]) throw new Error(`quiz: 写 ${input.show.join(' / ')} 里的一种`);
      return { q: `写出 ${input.x} 的 ${input.width} 位${k}。`, type: 'bin', width: input.width, answer: `0b${r.rows[k]}` };
    }
    if (input.mode === 'float') {
      if (input.decode) return { q: `IEEE 754 单精度数 ${input.src} 表示的十进制数是多少？`, type: 'seq', answer: String(r.value) };
      return { q: `写出 ${input.src} 的 IEEE 754 单精度表示（十六进制）。`, type: 'hex', width: 8, answer: `0x${r.bits.toString(16)}` };
    }
    return { q: `${input.width} 位补码运算 ${input.src}：写出结果（二进制）。`, type: 'bin', width: input.width, answer: `0b${r.R.toString(2)}` };
  },
  // 考卷上那张表：各种码 / 浮点的三个字段 / 运算结果和四个标志位
  table(input, r) {
    if (input.mode === 'code') {
      return {
        q: `写出 ${input.x} 的 ${input.width} 位${input.show.join('、')}（表示不了的写「无」）。`,
        qhtml: '',
        dir: 'row',
        head: [`${input.width} 位二进制`],
        rows: input.show.map((k) => ({ label: k, cells: [{ v: r.rows[k] ?? '' }] })),
      };
    }
    if (input.mode === 'float') {
      if (input.decode) return null;
      return {
        q: `把 ${input.src} 写成 IEEE 754 单精度：符号位、阶码（8 位二进制，偏置 127）、尾数（23 位，隐藏最前面的 1）、整个数的十六进制。`,
        qhtml: '',
        dir: 'row',
        head: ['写出来'],
        rows: [
          { label: '符号 S', cells: [{ v: String(r.S) }] },
          { label: '阶码 E', cells: [{ v: bin(r.E, 8) }] },
          { label: '尾数 M', cells: [{ v: r.M }] },
          { label: '十六进制', cells: [{ v: [hexOf(r.bits, 32).replace(/H$/, ''), `0x${r.bits.toString(16).toUpperCase().padStart(8, '0')}`, hexOf(r.bits, 32)] }] },
        ],
      };
    }
    return {
      q: `${input.width} 位补码运算 ${input.src}：写出结果的二进制和四个标志位。`,
      qhtml: '',
      dir: 'row',
      head: ['写出来'],
      rows: [
        { label: '结果', cells: [{ v: bin(r.R, input.width) }] },
        ...['OF', 'SF', 'ZF', 'CF'].map((k) => ({ label: k, cells: [{ v: String(r.flags[k]) }] })),
      ],
    };
  },
  // 常见错法
  variants(input) {
    if (input.mode === 'code') return [
      { label: '像是负数的补码忘了 +1（写成了反码）', input: { ...input, mistake: 'noPlusOne' } },
      { label: '像是移码没有把符号位取反（写成了补码）', input: { ...input, mistake: 'noFlip' } },
      { label: '像是反码连符号位也取反了', input: { ...input, mistake: 'flipSign' } },
    ];
    if (input.mode === 'float') return input.decode ? [] : [{ label: '像是阶码的偏置用了 128（应该是 127）', input: { ...input, bias: 128 } }, { label: '像是阶码的偏置用了 126', input: { ...input, bias: 126 } }];
    return [
      ...(input.sub ? [{ label: '像是减法的 CF 直接取了最高位的进位（王道：CF = 进位 ⊕ Cin）', input: { ...input, mistake: 'cfRaw' } }] : []),
      { label: '像是把最高位的进位当成了溢出 OF（OF = 最高位进位 ⊕ 次高位进位）', input: { ...input, mistake: 'ofCarry' } },
    ];
  },
};

// ================= cache：映射和替换 =================

function cacheParse(fields) {
  const lines = Number(fields.lines);
  if (!Number.isInteger(lines) || lines < 1 || lines > 32 || log2int(lines) === null) throw new Error('cache 要写 lines:（Cache 有几行，2 的整数次幂，最多 32）');
  const waysSrc = String(fields.ways ?? '1').trim().toLowerCase();
  const ways = /^(full|全相联|all)$/.test(waysSrc) ? lines : Number(waysSrc);
  if (!Number.isInteger(ways) || ways < 1 || lines % ways || log2int(ways) === null) throw new Error('ways: 每组几路（1 是直接映射，lines 是全相联，也可以写 full），要是 2 的整数次幂、能整除 lines');
  const replace = String(fields.replace || 'lru').trim().toLowerCase();
  if (!['lru', 'fifo'].includes(replace)) throw new Error('replace: 写 lru 或 fifo');
  let refs, mode;
  if (fields.blocks !== undefined) {
    mode = 'block';
    refs = String(fields.blocks).trim().split(/[\s,，、]+/).filter(Boolean).map((x) => { if (!/^\d+$/.test(x)) throw new Error(`blocks: 写主存块号（非负整数），「${x}」不对`); return { text: x, block: Number(x) }; });
  } else if (fields.refs !== undefined) {
    mode = 'addr';
    const block = parseSize(fields.block, 'block:（块大小）');
    const off = log2int(block);
    if (off === null) throw new Error('block: 块大小要是 2 的整数次幂');
    const bits = Number(fields.addr);
    if (!Number.isInteger(bits) || bits < 4 || bits > 40) throw new Error('按地址访问时要写 addr:（主存地址几位）');
    refs = String(fields.refs).split(/[,，、;；]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const v = parseNum(x, 'refs'); if (v >= 1n << BigInt(bits)) throw new Error(`refs: ${x} 超出了 ${bits} 位地址`); return { text: x, v, block: Number(v >> BigInt(off)) }; });
    return { mode, refs: check(refs), lines, ways, sets: lines / ways, replace, block, off, bits };
  } else throw new Error('cache 要写 blocks:（访问的主存块号序列）或 refs:（访问的主存地址，配 block: 和 addr:）');
  return { mode, refs: check(refs), lines, ways, sets: lines / ways, replace };
  function check(r) { if (!r.length) throw new Error('访问序列是空的'); if (r.length > 24) throw new Error('访问序列最多 24 个'); return r; }
}

const MAPNAME = (ways, lines) => (ways === 1 ? '直接映射' : ways === lines ? '全相联映射' : `${ways} 路组相联映射`);

function cacheRun(input) {
  const { refs, lines, ways, sets, replace } = input;
  const cache = Array.from({ length: sets }, () => Array.from({ length: ways }, () => null)); // { block, tag, loadAt, useAt }
  const steps = [];
  const hist = [];
  let hits = 0;
  const v = (extra = {}) => ({ cache: cache.map((s) => s.map((x) => x && { ...x })), hist: hist.slice(), ...extra });
  const setBits = log2int(sets);
  steps.push({ view: v(), msg: `Cache 共 ${lines} 行，${MAPNAME(ways, lines)}${ways > 1 && ways < lines ? `（分 ${sets} 组，每组 ${ways} 行）` : ''}，${ways > 1 ? `替换用 ${replace.toUpperCase()}` : '每个主存块只能放在固定的一行'}。${sets === 1 ? '主存块可以放在任何一行，标记就是块号。' : `主存块号 j 放在第 j mod ${sets} ${ways === 1 ? '行' : '组'}，标记 = j div ${sets}。`}` });
  refs.forEach((r, k) => {
    const set = r.block % sets, tag = Math.floor(r.block / sets);
    const where = ways === 1 ? `第 ${set} 行` : sets === 1 ? '' : `第 ${set} 组`;
    if (input.mode === 'addr') {
      steps.push({ view: v({ k, r, set, split: true }), msg: `地址 ${r.text}：块内地址是低 ${input.off} 位，块号 = ${r.block}。${sets > 1 ? `${ways === 1 ? '行号' : '组号'}是接下来的 ${setBits} 位 = ${set}，` : ''}标记是剩下的高 ${input.bits - input.off - setBits} 位 = ${tag}。`, ask: sets > 1 ? { tag: 'set', kind: 'number', q: `地址 ${r.text} 映射到 Cache 的${ways === 1 ? '哪一行' : '哪一组'}？`, answer: set } : undefined });
    }
    const row = cache[set];
    const at = row.findIndex((x) => x && x.block === r.block);
    let victim = null, slot = at;
    if (at >= 0) { hits++; row[at].useAt = k; }
    else {
      slot = row.findIndex((x) => x === null);
      if (slot < 0) {
        const key = replace === 'lru' ? 'useAt' : 'loadAt';
        slot = row.reduce((best, x, i) => (x[key] < row[best][key] ? i : best), 0);
        victim = row[slot].block;
      }
      row[slot] = { block: r.block, tag, loadAt: k, useAt: k };
    }
    hist.push({ text: r.text, hit: at >= 0 });
    const msg = at >= 0 ? `访问块 ${r.block}：${where}${where ? '里' : ''}有标记 ${tag} 的有效行，命中。` : victim === null ? `访问块 ${r.block}：${where}${where ? '里' : ''}没有它，不命中（缺失），${where || ''}还有空行，调入。` : `访问块 ${r.block}：不命中，${where || '整个 Cache'}满了，${ways === 1 ? `把原来的块 ${victim} 换掉` : `按 ${replace.toUpperCase()} 换出块 ${victim}（${replace === 'lru' ? '最久没被访问' : '最先调入'}）`}。`;
    const ask = at >= 0 || victim === null || ways === 1
      ? { tag: 'hit', kind: 'choice', q: `访问块 ${r.block}：命中还是不命中？`, choices: ['命中', '不命中'], answer: at >= 0 ? '命中' : '不命中' }
      : { tag: 'victim', kind: 'pick', q: `访问块 ${r.block} 不命中，要换出哪一块？在 Cache 里点出来。`, answer: String(victim) };
    steps.push({ view: v({ k, r, set, slot, hit: at >= 0 }), msg, ask });
  });
  const n = refs.length;
  steps.push({ view: v({ end: true }), msg: `一共访问 ${n} 次，命中 ${hits} 次，命中率 ${hits}/${n}${Number.isInteger((hits / n) * 100) ? ` = ${(hits / n) * 100}%` : ` ≈ ${Math.round((hits / n) * 1000) / 10}%`}。`, ask: { tag: 'hits', kind: 'number', q: '一共命中几次？', answer: hits } });
  return { steps, hits };
}

function cacheView(s, input) {
  const { sets, ways } = input;
  let h = '';
  if (s.split && s.r?.v !== undefined) {
    const setBits = log2int(sets);
    const fields = [{ name: '标记', bits: input.bits - input.off - setBits, cls: 'bv-a' }, ...(setBits ? [{ name: ways === 1 ? '行号' : '组号', bits: setBits, cls: 'bv-b' }] : []), { name: '块内地址', bits: input.off, cls: 'bv-c' }];
    h += bitFields(s.r.v, fields, { hi: [ways === 1 ? '行号' : '组号'] });
  }
  const head = [sets > 1 ? (ways === 1 ? '行' : '组') : '', ...(ways > 1 && sets > 1 ? ['路'] : []), '有效', '标记', '主存块'];
  const rows = [];
  s.cache.forEach((set, si) => set.forEach((x, wi) => {
    const cur = s.set === si && (s.slot === undefined ? true : s.slot === wi);
    const cls = s.set === si ? (cur && s.slot !== undefined ? (s.hit ? 'co-hit' : 'co-miss') : 'co-set') : '';
    rows.push([
      ...(sets > 1 ? [wi === 0 ? { html: `<b>${si}</b>`, attrs: ways > 1 ? ` rowspan="${ways}"` : '' } : null] : [{ html: String(wi), cls }]),
      ...(ways > 1 && sets > 1 ? [{ html: String(wi), cls }] : []),
      { html: x ? '1' : '0', cls }, { html: x ? String(x.tag) : '', cls },
      { html: x ? String(x.block) : '', cls, attrs: x ? ` data-pick="${x.block}" data-label="${x.block}" data-cmd="${si * ways + wi + 1}"` : '' },
    ].filter((c) => c !== null));
  }));
  h += `<div class="sv-gtbl-wrap"><table class="sv-gtbl co-cache"><thead><tr>${head.filter(Boolean).map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td class="${c.cls || ''}"${c.attrs || ''}>${c.html}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  h += `<div class="co-hist">${input.refs.map((r, k) => { const x = s.hist[k]; return `<span class="${x ? (x.hit ? 'co-h' : 'co-m') : ''}${s.k === k ? ' co-now' : ''}">${esc(r.text)}<small>${x ? (x.hit ? '命中' : '缺失') : ''}</small></span>`; }).join('')}</div>`;
  return h;
}

export const cacheEngine = {
  name: 'cache',
  title: 'Cache',
  parse: cacheParse,
  run: cacheRun,
  view: cacheView,
  quiz(input, r) {
    return { q: `Cache 共 ${input.lines} 行，${MAPNAME(input.ways, input.lines)}${input.ways > 1 ? `，${input.replace.toUpperCase()} 替换` : ''}，一开始是空的。依次访问${input.mode === 'block' ? '主存块' : '地址'} ${input.refs.map((x) => x.text).join(' ')}${input.mode === 'addr' ? `（块大小 ${input.block} B）` : ''}，一共命中几次？`, type: 'num', answer: String(r.hits) };
  },
  // 考卷上那张表：每次访问的${'组号'}、标记、命中没有、换出的块
  table(input, r) {
    const where = input.ways === 1 ? '行号' : '组号';
    const showSet = input.sets > 1;
    const head = [...(showSet ? [where] : []), '标记', '命中', '换出的块'];
    const rows = [];
    for (const x of r.steps) {
      if (x.view.hit === undefined) continue;
      const ref = x.view.r;
      const set = ref.block % input.sets, tag = Math.floor(ref.block / input.sets);
      const victim = x.ask?.tag === 'victim' ? x.ask.answer : (() => { const before = r.steps[r.steps.indexOf(x) - 1]?.view.cache?.[set] || []; const after = x.view.cache[set]; const gone = before.filter((b) => b && !after.some((a) => a && a.block === b.block)); return gone.length ? String(gone[0].block) : ''; })();
      rows.push({ label: ref.text, cells: [...(showSet ? [{ v: String(set), num: true }] : []), { v: String(tag), num: true }, { v: x.view.hit ? '√' : '', mark: true }, { v: victim }] });
    }
    return {
      q: `Cache 共 ${input.lines} 行，${MAPNAME(input.ways, input.lines)}${input.ways > 1 ? `，${input.replace.toUpperCase()} 替换` : ''}，一开始是空的。${input.mode === 'addr' ? `主存地址 ${input.bits} 位，按字节编址，块大小 ${input.block} B。` : ''}依次访问${input.mode === 'block' ? '主存块' : '地址'} ${input.refs.map((x) => x.text).join(' ')}：写出每次访问的${showSet ? `${where}、` : ''}标记（十进制），命中打 √，被换出的主存块号。`,
      qhtml: '',
      dir: 'row',
      head,
      rows,
    };
  },
  // 常见错法：映射方式弄错（直接映射 / 全相联）、替换算法弄反
  variants(input) {
    const out = [];
    if (input.ways !== 1) out.push({ label: '像是按直接映射算的（组号用了 块号 mod 行数）', input: { ...input, ways: 1, sets: input.lines } });
    if (input.ways !== input.lines) out.push({ label: '像是按全相联算的', input: { ...input, ways: input.lines, sets: 1 } });
    if (input.ways > 1) out.push({ label: `像是按 ${input.replace === 'lru' ? 'FIFO' : 'LRU'} 替换的`, input: { ...input, replace: input.replace === 'lru' ? 'fifo' : 'lru' } });
    return out;
  },
};

// ================= pipe：五段流水线 =================

const NO_DEST = new Set(['sw', 'sb', 'sh', 'beq', 'bne', 'bgt', 'blt', 'j', 'jmp', 'nop', 'store', 'b', 'cmp']);
const LOADS = new Set(['lw', 'lb', 'lh', 'load', 'ld']);

function pipeParse(fields) {
  const src = String(fields.instrs ?? fields.code ?? '').split(/\n|;|；/).map((x) => x.trim()).filter(Boolean);
  if (!src.length) throw new Error('pipe 要写 instrs:（一行一条指令，如 add r1, r2, r3；也可以用分号隔开）');
  if (src.length > 10) throw new Error('instrs: 最多 10 条');
  const instrs = src.map((line, i) => {
    const m = /^(?:(\w+)\s*[:：]\s*)?([A-Za-z]+)\s*(.*)$/.exec(line);
    if (!m) throw new Error(`instrs: 看不懂「${line}」`);
    const name = m[1] || `I${i + 1}`;
    const op = m[2].toLowerCase();
    const regs = [...m[3].matchAll(/\b([rR]\d+|\$\w+|[xX]\d+)\b/g)].map((x) => x[1].toLowerCase());
    const dest = NO_DEST.has(op) || !regs.length ? null : regs[0];
    const srcs = dest ? regs.slice(1) : regs;
    return { name, op, text: line.replace(/^\w+\s*[:：]\s*/, ''), dest, srcs, load: LOADS.has(op) };
  });
  const forward = /^(yes|true|1|是|有)$/i.test(String(fields.forward || 'no').trim());
  const split = !/^(no|false|0|否|没有)$/i.test(String(fields.split || 'yes').trim());
  return { instrs, forward, split };
}

function pipeRun({ instrs, forward, split }) {
  const steps = [];
  const sched = []; // { IF, IDin, ID（离开 ID 的那个周期）, EX, MEM, WB, stall, why }
  const rule = forward ? '有转发（旁路）：运算结果在 EX 段结束就能送给下一条的 EX；取数（load）的结果要到 MEM 段结束，紧跟着用它的指令要停 1 个周期'
    : `没有转发，只能阻塞：要用前面指令结果的指令，ID 段（读寄存器）${split ? '最早和那条指令的 WB 段在同一个周期（寄存器前半周期写、后半周期读）' : '要等那条指令的 WB 段结束以后'}`;
  steps.push({ view: { sched: [] }, msg: `五段流水线：IF 取指、ID 译码读寄存器、EX 执行、MEM 访存、WB 写回。${rule}。` });
  instrs.forEach((ins, i) => {
    const prev = sched[i - 1];
    const IF = prev ? prev.IF + 1 : 1;
    const IDin = prev ? Math.max(IF + 1, prev.ID + 1) : IF + 1;
    let need = IDin;
    const why = [];
    for (const r of ins.srcs) {
      let p = -1;
      for (let j = i - 1; j >= 0; j--) if (instrs[j].dest === r) { p = j; break; }
      if (p < 0) continue;
      const P = sched[p];
      const req = forward ? (instrs[p].load ? P.MEM : P.EX) : split ? P.WB : P.WB + 1;
      // 有转发时要求的是 EX ≥ req + 1，也就是 ID 结束 ≥ req
      if (req > need) need = req;
      why.push(`用到 ${instrs[p].name} 写的 ${r}（${instrs[p].name} 的 ${forward ? (instrs[p].load ? 'MEM' : 'EX') : 'WB'} 在第 ${req - (!forward && !split ? 1 : 0)} 周期）`);
    }
    const ID = need;
    const s = { IF, IDin, ID, EX: ID + 1, MEM: ID + 2, WB: ID + 3, stall: ID - IDin, waitIF: IDin - IF - 1 };
    sched.push(s);
    const stallMsg = s.stall ? `要停 ${s.stall} 个周期（在 ID 段等），第 ${s.EX} 周期才进 EX。` : why.length ? '不用停。' : '';
    steps.push({ view: { sched: sched.slice(), cur: i }, msg: `${ins.name}：${ins.text}。${why.length ? why.join('；') + '，' : '和前面的指令没有数据相关，'}${stallMsg}${s.waitIF ? `（前一条在 ID 段停着，它在 IF 段多等了 ${s.waitIF} 个周期。）` : ''}`, ask: { tag: 'stall', kind: 'number', q: `${ins.name}（${ins.text}）要停几个周期？`, answer: s.stall } });
  });
  const total = sched.at(-1).WB;
  steps.push({ view: { sched: sched.slice() }, msg: `${instrs.length} 条指令一共用 ${total} 个周期（没有阻塞的话是 ${instrs.length + 4} 个），一共阻塞 ${sched.reduce((a, s) => a + s.stall, 0)} 个周期。`, ask: { tag: 'cycles', kind: 'number', q: '这几条指令一共要多少个周期？', answer: total } });
  return { steps, total, sched };
}

function pipeView(s, input) {
  const T = Math.max(input.instrs.length + 4, ...(s.sched.length ? [s.sched.at(-1).WB] : [5]));
  const head = ['指令', ...Array.from({ length: T }, (_, t) => `${t + 1}`)];
  const rows = s.sched.map((x, i) => {
    const ins = input.instrs[i];
    const cells = Array.from({ length: T }, (_, t) => {
      const c = t + 1;
      if (c === x.IF) return { html: 'IF', cls: 'co-st co-if' };
      if (c > x.IF && c < x.IDin) return { html: 'IF', cls: 'co-st co-wait' };
      if (c >= x.IDin && c < x.ID) return { html: 'ID', cls: 'co-st co-stall' };
      if (c === x.ID) return { html: 'ID', cls: 'co-st co-id' };
      const k = ['EX', 'MEM', 'WB'].findIndex((st) => x[st] === c);
      return k >= 0 ? { html: ['EX', 'MEM', 'WB'][k], cls: `co-st co-${['ex', 'mem', 'wb'][k]}` } : '';
    });
    return [{ html: `<b>${esc(ins.name)}</b> <span class="muted">${esc(ins.text)}</span>`, cls: s.cur === i ? 'sv-pickcell' : '', attrs: ` data-cmd="${i + 1}" data-label="${esc(ins.name)}"` }, ...cells];
  });
  return `<div class="sv-gtbl-wrap"><table class="sv-gtbl co-pipe"><thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => (c && typeof c === 'object' ? `<td class="${c.cls || ''}"${c.attrs || ''}>${c.html}</td>` : '<td></td>')).join('')}</tr>`).join('')}</tbody></table></div>${chips([['转发', input.forward ? '有' : '没有'], ...(input.forward ? [] : [['寄存器', input.split ? '前半周期写、后半周期读' : '写完才能读']])])}`;
}

export const pipeEngine = {
  name: 'pipe',
  title: '指令流水线',
  parse: pipeParse,
  run: pipeRun,
  view: pipeView,
  quiz(input, r) {
    return { q: `五段流水线（${input.forward ? '有转发' : '没有转发，只能阻塞'}${input.forward ? '' : input.split ? '，寄存器前半周期写、后半周期读' : ''}）执行下面的指令，一共要多少个周期？\n\n${input.instrs.map((x) => `- ${x.name}：\`${x.text}\``).join('\n')}`, type: 'num', answer: String(r.total) };
  },
  // 考卷上那张表：每条指令停几个周期、EX 和 WB 在第几个周期
  table(input, r) {
    return {
      q: `五段流水线（${input.forward ? '有转发' : '没有转发，只能阻塞'}${input.forward ? '' : input.split ? '，寄存器前半周期写、后半周期读' : '，寄存器写完才能读'}），第 1 条指令第 1 个周期取指。先在纸上画时空图，再填每条指令要停几个周期、EX 段和 WB 段在第几个周期。`,
      qhtml: `<ol class="co-instrs">${input.instrs.map((x) => `<li><b>${esc(x.name)}</b>　<code>${esc(x.text)}</code></li>`).join('')}</ol>`,
      dir: 'row',
      head: ['停几个周期', 'EX 在第几周期', 'WB 在第几周期'],
      rows: r.sched.map((x, i) => ({ label: input.instrs[i].name, cells: [{ v: String(x.stall), num: true }, { v: String(x.EX), num: true }, { v: String(x.WB), num: true }] })),
    };
  },
  // 常见错法：有没有转发弄反；寄存器「前半周期写、后半周期读」用没用上
  variants(input) {
    const out = [{ label: input.forward ? '像是按没有转发算的' : '像是按有转发算的', input: { ...input, forward: !input.forward } }];
    if (!input.forward) out.push({ label: input.split ? '像是没用上「前半周期写、后半周期读」（多停了一个周期）' : '像是按「前半周期写、后半周期读」算的', input: { ...input, split: !input.split } });
    return out;
  },
};
