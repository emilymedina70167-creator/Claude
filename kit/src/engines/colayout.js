// 组成原理的数据存放：layout（结构体按边界对齐怎么排、sizeof；一个数按大端 / 小端怎么放进各个字节）。
// 口径按王道（32 位机）：char 1、short 2、int 4、long 4、float 4、double 8、指针 4 字节；
// 边界对齐：每个成员的起始偏移是它自己大小的整数倍（数组按元素的大小），整个结构体的大小凑成最大成员大小的整数倍；
// 小端：低位字节放在低地址（x86）；大端：高位字节放在低地址。按字节编址。
// 纯函数（tests/co2-engine.test.js）。
import { esc } from './arrayview.js';
import { readNum, keepDiffering } from './coea.js';

const TYPES = { char: 1, bool: 1, _bool: 1, short: 2, int: 4, long: 4, 'long long': 8, float: 4, double: 8 };

// 一行声明：unsigned short c / char s[5] / int *p / int a, b
function parseDecl(src, arch) {
  const s = String(src).trim().replace(/\s+/g, ' ').replace(/\bshort int\b/g, 'short').replace(/\blong long int\b/g, 'long long').replace(/\blong int\b/g, 'long');
  const m = /^(?:(unsigned|signed) )?(char|short|int|long long|long|float|double|bool|_Bool)?\s*(.*)$/i.exec(s);
  const base = (m[2] || (m[1] ? 'int' : '')).toLowerCase();
  if (!base || !m[3]) throw new Error(`struct: 看不懂「${src}」：写成「int a」「char s[3]」「short *p」（类型 + 名字）`);
  if (m[1] && ['float', 'double'].includes(base)) throw new Error(`struct: ${m[1]} ${base} 不是 C 的类型`);
  const out = [];
  for (const d of m[3].split(/\s*[,，]\s*/)) {
    const x = /^(\*?)\s*([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?$/.exec(d.trim());
    if (!x) throw new Error(`struct: 「${src}」里的「${d}」不是一个变量名`);
    const ptr = !!x[1];
    const elem = ptr ? (arch === 64 ? 8 : 4) : base === 'long' && arch === 64 ? 8 : TYPES[base];
    const n = x[3] ? Number(x[3]) : 1;
    if (x[3] && !(n >= 1 && n <= 64)) throw new Error(`struct: 数组 ${x[2]} 的长度写 1～64`);
    const pre = `${m[1] ? `${m[1].toLowerCase()} ` : ''}${base}`;
    out.push({ name: x[2], type: `${pre}${ptr ? ' *' : ''}${x[3] ? `[${n}]` : ''}`, decl: `${pre} ${ptr ? '*' : ''}${x[2]}${x[3] ? `[${n}]` : ''}`, base, ptr, unsigned: m[1]?.toLowerCase() === 'unsigned' || base === 'bool' || base === '_bool', elem, n, size: elem * n, float: !ptr && ['float', 'double'].includes(base) });
  }
  return out;
}

function parse(fields) {
  const arch = fields.arch === undefined || fields.arch === '' ? 32 : Number(String(fields.arch).replace(/位$/, ''));
  if (![32, 64].includes(arch)) throw new Error('arch: 写 32（默认，王道的约定）或 64（long 和指针 8 字节）');
  const endSrc = String(fields.endian ?? 'little').trim().toLowerCase();
  const big = /^(big|大端|大端方式|be)$/.test(endSrc);
  if (!big && !/^(little|小端|小端方式|le)$/.test(endSrc)) throw new Error(`endian: 写 little（小端，默认）或 big（大端）（现在是「${fields.endian}」）`);
  const atN = fields.at === undefined || fields.at === '' ? { v: 0n, bits: 16, hex: true } : readNum(fields.at, 'at: ');
  if (atN.v < 0n) throw new Error('at: 首地址不能是负数');
  const alignSrc = String(fields.align ?? '').trim().toLowerCase();
  const pack = !alignSrc || /^(natural|自然|边界对齐|对齐)$/.test(alignSrc) ? 0 : /^(none|packed|不对齐|1)$/.test(alignSrc) ? 1 : Number(alignSrc);
  if (![0, 1, 2, 4, 8].includes(pack)) throw new Error('align: 写 natural（按边界对齐，默认）、none（不对齐，紧挨着放），或者 2 / 4 / 8（#pragma pack(n)：对齐不超过 n 字节）');
  let members = [];
  const single = fields.struct === undefined || !String(fields.struct).trim();
  if (single) {
    if (fields.value === undefined || !String(fields.value).trim()) throw new Error('layout 要写 struct:（结构体的成员，分号隔开），或者 value:（一个数，看它按大端 / 小端怎么放）');
    const t = String(fields.type ?? 'int').trim();
    members = parseDecl(`${t} ${String(fields.name ?? 'x').trim()}`, arch);
    if (members[0].n > 1) throw new Error('type: 写一个类型（int、short、double……），不写数组');
  } else {
    const body = String(fields.struct).replace(/^\s*struct\s*\w*\s*\{/, '').replace(/\}\s*\w*\s*;?\s*$/, '');
    for (const part of body.split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean)) members.push(...parseDecl(part, arch));
    if (!members.length) throw new Error('struct: 至少写一个成员');
    if (members.length > 12) throw new Error('struct: 最多 12 个成员');
    const seen = new Set();
    for (const x of members) { if (seen.has(x.name)) throw new Error(`struct: 成员 ${x.name} 写了两次`); seen.add(x.name); }
  }
  // 成员的值：a = 273, c = -1, b = 'A', f = -1.5
  const values = new Map();
  const setSrc = single ? `${members[0].name} = ${fields.value}` : fields.set;
  for (const part of String(setSrc ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(part);
    if (!m) throw new Error(`set: 一项写成「成员 = 值」，比如 a = 273（现在有「${part}」）`);
    const mem = members.find((x) => x.name === m[1]);
    if (!mem) throw new Error(`set: 没有成员 ${m[1]}（有：${members.map((x) => x.name).join('、')}）`);
    if (mem.n > 1) throw new Error(`set: 数组 ${m[1]} 不能整个赋值`);
    values.set(m[1], { src: m[2].trim(), bytes: encode(mem, m[2].trim()) });
  }
  const input = { members, values, big, at: atN.v, adig: Math.max(4, Math.ceil(atN.bits / 4)), pack, arch, single, look: null, mistake: '' };
  if (fields.look !== undefined && String(fields.look).trim() !== '') {
    input.look = readNum(fields.look, 'look: ').v;
    const lay = layoutOf(input);
    const hit = lay.items.find((x) => values.has(x.name) && input.look >= input.at + BigInt(x.off) && input.look < input.at + BigInt(x.off + x.size));
    if (!hit) throw new Error(`look: ${fmtA(input.look, input)} 不在写了值的成员里（写了值的：${[...values.keys()].join('、') || '没有'}；set: 里先给它一个值）`);
  }
  return input;
}

// 值 → 从高位到低位的各个字节（BigInt 数组）
function encode(mem, src) {
  const w = mem.size;
  let v;
  if (mem.float) {
    const x = Number(src);
    if (!Number.isFinite(x)) throw new Error(`set: ${mem.name} 是 ${mem.type}，写一个小数（现在是「${src}」）`);
    const dv = new DataView(new ArrayBuffer(8));
    if (w === 4) dv.setFloat32(0, x); else dv.setFloat64(0, x);
    return Array.from({ length: w }, (_, i) => BigInt(dv.getUint8(i)));
  }
  const ch = /^'(.)'$/.exec(src);
  v = ch ? BigInt(ch[1].codePointAt(0)) : readNum(src, `set: ${mem.name} 的值`).v;
  const bits = BigInt(8 * w);
  const lo = mem.unsigned ? 0n : -(1n << (bits - 1n)), hi = (1n << bits) - 1n;
  if (v < lo || v > hi) throw new Error(`set: ${mem.name} 是 ${mem.type}（${w} 字节），放不下 ${src}`);
  const u = BigInt.asUintN(8 * w, v);
  return Array.from({ length: w }, (_, i) => (u >> BigInt(8 * (w - 1 - i))) & 0xffn);
}

const fmtA = (v, input) => `${v.toString(16).toUpperCase().padStart(input.adig, '0')}H`;
const hx2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');

/** 排成员：items [{ ...成员, off, pad（前面空了几个字节）, align }], size, maxAlign, tail（末尾补了几个） */
export function layoutOf(input) {
  const { members, pack, mistake } = input;
  const alignOf = (m) => {
    if (mistake === 'packed' || pack === 1) return 1;
    if (mistake === 'all4') return 4; // 错法：每个成员都从 4 的倍数开始
    return pack ? Math.min(m.elem, pack) : m.elem;
  };
  let off = 0;
  const items = members.map((m) => {
    const al = alignOf(m);
    const start = Math.ceil(off / al) * al;
    const it = { ...m, off: start, pad: start - off, align: al };
    off = start + m.size;
    return it;
  });
  const maxAlign = Math.max(...items.map((x) => x.align));
  const size = mistake === 'noTail' ? off : Math.ceil(off / maxAlign) * maxAlign;
  return { items, end: off, size, maxAlign, tail: size - off };
}

// 一个成员的各个字节放在哪：[{ addr, b }]，按地址从低到高
function placed(input, it) {
  const v = input.values.get(it.name);
  if (!v) return [];
  const big = input.mistake === 'swap' ? !input.big : input.big;
  const bytes = big ? v.bytes : [...v.bytes].reverse();
  return bytes.map((b, k) => ({ addr: input.at + BigInt(it.off + k), b }));
}
const bytesAlts = (list) => { const t = list.map((x) => hx2(x.b)); return [t.join(' '), t.join(''), t.map((x) => `${x}H`).join(' '), t.map((x) => `0x${x}`).join(' ')].join(' | '); };
const hexAlts = (t) => { const d = t.replace(/H$/, ''); return [t, d, `0x${d}`]; };

function run(input) {
  const lay = layoutOf(input);
  const steps = [];
  const endName = input.big ? '大端' : '小端';
  const endRule = input.big ? '大端：高位字节放在低地址' : '小端：低位字节放在低地址';
  const rule = input.pack === 1 ? '不对齐（#pragma pack(1)）：成员一个挨一个放，中间不空' : input.pack ? `#pragma pack(${input.pack})：每个成员按 min(自己的大小, ${input.pack}) 对齐，总大小凑成 min(最大成员, ${input.pack}) 的整数倍` : '按边界对齐（王道的约定）：每个成员的起始偏移是它自己大小的整数倍（数组按元素的大小），整个结构体的大小凑成最大成员大小的整数倍';
  const valueSteps = [];
  if (input.single) {
    const it = lay.items[0];
    const v = input.values.get(it.name);
    steps.push({ view: { stage: 'start' }, msg: `${it.type} ${it.name} = ${v.src}，从 ${fmtA(input.at, input)} 开始放，占 ${it.size} 个字节（${endName}）。` });
    const word = v.bytes.map(hx2).join('');
    steps.push({ view: { stage: 'code' }, msg: `先写成 ${it.size} 个字节的机器数：${v.src} → ${word}H${it.float ? `（IEEE 754 ${it.size === 4 ? '单' : '双'}精度）` : /^-/.test(v.src) ? '（补码）' : ''}，从高位到低位是 ${v.bytes.map(hx2).join(' ')}。最高位那个字节叫 MSB，最低位那个叫 LSB。`, ask: { tag: 'code', kind: 'hex', width: 2 * it.size, q: `${v.src} 的 ${it.type}（${it.size} 个字节）写成十六进制机器数是？`, answer: BigInt(`0x${word}`), display: `${word}H` } });
    valueSteps.push(it);
  } else {
    steps.push({ view: { stage: 'start', upto: -1 }, msg: `结构体有 ${lay.items.length} 个成员，首地址 ${fmtA(input.at, input)}。${rule}。` });
    lay.items.forEach((it, i) => {
      const prevEnd = i ? lay.items[i - 1].off + lay.items[i - 1].size : 0;
      const where = `${it.name} 在偏移 ${it.off}${it.size > 1 ? `～${it.off + it.size - 1}` : ''}（${fmtA(input.at + BigInt(it.off), input)}${it.size > 1 ? `～${fmtA(input.at + BigInt(it.off + it.size - 1), input)}` : ''}）`;
      const why = input.pack === 1 ? `接着放：${where}。` : it.pad ? `前面放到了偏移 ${prevEnd}，${prevEnd} 不是 ${it.align} 的倍数，空出 ${it.pad} 个字节：${where}。` : `${i ? `前面放到了偏移 ${prevEnd}，` : '从偏移 0 开始，'}${prevEnd} 是 ${it.align} 的倍数，不用空：${where}。`;
      steps.push({ view: { stage: 'member', upto: i }, msg: `${it.name}：${it.type}，${it.n > 1 ? `${it.n} 个 × ${it.elem} = ` : ''}${it.size} 字节${input.pack !== 1 ? `，起始偏移要是 ${it.align} 的倍数` : ''}。${why}`, ask: { tag: 'offset', kind: 'number', q: `${it.name} 的偏移量是多少（相对结构体首地址，字节）？`, answer: it.off }, asks: [{ tag: 'addr', kind: 'hex', q: `${it.name} 的地址是多少？`, answer: input.at + BigInt(it.off), display: fmtA(input.at + BigInt(it.off), input) }] });
    });
    steps.push({ view: { stage: 'size', upto: lay.items.length - 1 }, msg: `成员放完到了偏移 ${lay.end}。${input.pack === 1 ? `不对齐，sizeof = ${lay.size}。` : `总大小要是 ${lay.maxAlign} 的整数倍${input.pack ? '' : `（最大的成员 ${lay.maxAlign} 字节）`}：${lay.tail ? `末尾再补 ${lay.tail} 个字节，` : `${lay.end} 已经是 ${lay.maxAlign} 的倍数，不用补，`}sizeof = ${lay.size}。`}`, ask: { tag: 'size', kind: 'number', q: '这个结构体的 sizeof 是多少（字节）？', answer: lay.size } });
    valueSteps.push(...lay.items.filter((it) => input.values.has(it.name)));
  }
  for (const it of valueSteps) {
    const v = input.values.get(it.name);
    const list = placed(input, it);
    const lsb = input.big ? list.at(-1) : list[0];
    const lookIn = input.look !== null && list.some((x) => x.addr === input.look);
    const lookAt = lookIn ? input.look : list[0].addr;
    const lookByte = list.find((x) => x.addr === lookAt).b;
    const code = v.bytes.map(hx2).join('');
    const asks = [
      { tag: 'byte', kind: 'hex', q: `地址 ${fmtA(lookAt, input)} 里存的是哪个字节？`, answer: lookByte, display: hx2(lookByte) },
      { tag: 'bytes', kind: 'text', q: `${it.name} 的 ${it.size} 个字节，从低地址到高地址依次是？（十六进制，空格隔开）`, answer: bytesAlts(list) },
      { tag: 'lsb', kind: 'hex', q: `${it.name} 的最低有效字节（LSB）在哪个地址？`, answer: lsb.addr, display: fmtA(lsb.addr, input) },
    ];
    if (!input.single) asks.push({ tag: 'code', kind: 'hex', width: 2 * it.size, q: `${v.src} 的 ${it.type} 写成十六进制机器数是？`, answer: BigInt(`0x${code}`), display: `${code}H` });
    const main = lookIn || input.single ? asks.shift() : asks.splice(1, 1)[0];
    steps.push({ view: { stage: 'value', upto: lay.items.length - 1, name: it.name, look: lookAt }, msg: `${input.single ? '' : `${it.name} = ${v.src}：机器数 ${code}H，从高位到低位 ${v.bytes.map(hx2).join(' ')}。`}${endRule}：${list.map((x) => `${fmtA(x.addr, input)} 放 ${hx2(x.b)}`).join('，')}。LSB 在 ${fmtA(lsb.addr, input)}。`, ask: main, asks });
  }
  return { steps, lay };
}

function view(st, input) {
  const lay = layoutOf(input);
  const vName = st.stage === 'value' ? st.name : null;
  const showVals = new Set(input.single ? (st.stage === 'value' ? [lay.items[0].name] : []) : st.stage === 'value' ? lay.items.filter((x, i) => input.values.has(x.name) && i <= lay.items.findIndex((y) => y.name === vName)).map((x) => x.name) : []);
  let h = '';
  if (input.single) {
    const it = lay.items[0];
    const v = input.values.get(it.name);
    h += `<div class="ly-q"><code>${esc(it.type)} ${esc(it.name)} = ${esc(v.src)};</code><span class="ly-end">从 ${fmtA(input.at, input)} 开始</span><span class="ly-end">${input.big ? '大端' : '小端'}</span></div>`;
    if (st.stage !== 'start') h += `<div class="ly-word"><span class="ly-k">高位 → 低位</span>${v.bytes.map((b, k) => `<span class="ly-wb${k === 0 ? ' ly-msb' : k === v.bytes.length - 1 ? ' ly-lsb' : ''}" data-key="b${k}">${hx2(b)}</span>`).join('')}</div>`;
  } else {
    // 成员表：排到哪写到哪
    const rows = lay.items.map((it, i) => {
      const on = i <= st.upto;
      return `<tr class="${i === st.upto && st.stage === 'member' ? 'ly-on' : ''}${it.name === vName ? ' ly-on' : ''}"><th scope="row"><span class="ly-dot ly-c${i % 5}"></span>${esc(it.name)}</th><td>${esc(it.type)}</td><td>${it.size}</td><td>${on ? it.off : ''}</td><td>${on ? fmtA(input.at + BigInt(it.off), input) : ''}</td>${input.values.size ? `<td>${input.values.has(it.name) ? esc(input.values.get(it.name).src) : ''}</td>` : ''}</tr>`;
    }).join('');
    h += `<div class="ly-q"><span class="ly-end">首地址 ${fmtA(input.at, input)}</span><span class="ly-end">${input.big ? '大端' : '小端'}</span>${input.pack === 1 ? '<span class="ly-end">不对齐</span>' : input.pack ? `<span class="ly-end">pack(${input.pack})</span>` : ''}</div>`;
    h += `<table class="sv-tab ly-tab"><thead><tr><th>成员</th><th>类型</th><th>大小</th><th>偏移</th><th>地址</th>${input.values.size ? '<th>值</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (st.stage === 'start' || (input.single && st.stage === 'code')) return h;
  // 存储单元：一行 4 个字节（有 8 字节对齐的成员时一行 8 个），每格上面写属于谁，中间是内容，下面是地址
  const upto = input.single ? 0 : st.upto;
  const total = input.single ? lay.items[0].size : st.stage === 'member' ? lay.items[upto].off + lay.items[upto].size : lay.size;
  const per = Math.max(4, Math.min(8, lay.maxAlign));
  const owner = Array(total).fill(-1);
  lay.items.forEach((it, i) => { if (i <= upto) for (let k = 0; k < it.size; k++) if (it.off + k < total) owner[it.off + k] = i; });
  const byteAt = new Map();
  lay.items.forEach((it) => { if (showVals.has(it.name)) for (const x of placed(input, it)) byteAt.set(x.addr, x.b); });
  let cells = '';
  for (let r = 0; r * per < total; r++) {
    cells += `<div class="ly-row"><span class="ly-ra">${fmtA(input.at + BigInt(r * per), input)}</span>`;
    for (let c = 0; c < per; c++) {
      const off = r * per + c;
      if (off >= total) { cells += '<span class="ly-cell ly-none"></span>'; continue; }
      const i = owner[off];
      const it = lay.items[i];
      const addr = input.at + BigInt(off);
      const cur = (st.stage === 'member' && i === upto) || (it && it.name === vName);
      const cls = ['ly-cell', i < 0 ? 'ly-pad' : `ly-c${i % 5}`, cur ? 'ly-cur' : '', st.look !== undefined && addr === st.look ? 'ly-look' : ''].filter(Boolean).join(' ');
      const b = byteAt.get(addr);
      cells += `<span class="${cls}" data-cmd="${off + 1}" data-label="${esc(fmtA(addr, input))}" data-pick="${esc(fmtA(addr, input))}"><small class="ly-who">${i < 0 ? '空' : esc(it.name)}</small><b>${b !== undefined ? hx2(b) : ''}</b><small class="ly-ad">+${off}</small></span>`;
    }
    cells += '</div>';
  }
  return `${h}<div class="ly-mem">${cells}</div>`;
}

export const layoutEngine = {
  name: 'layout', title: '数据的存放', parse, run, view,
  quiz(input, r) {
    if (input.single) {
      const it = r.lay.items[0];
      const list = placed(input, it);
      return { qhtml: view({ stage: 'start' }, input), q: `${it.type} ${it.name} = ${input.values.get(it.name).src}，从 ${fmtA(input.at, input)} 开始按${input.big ? '大端' : '小端'}存放。从低地址到高地址写出这 ${it.size} 个字节（十六进制，空格隔开）。`, type: 'seq', answer: bytesAlts(list) };
    }
    return { qhtml: view({ stage: 'start', upto: -1 }, input), q: `按${input.pack === 1 ? '不对齐' : '边界对齐'}，这个结构体的 sizeof 是多少（字节）？`, type: 'num', answer: String(r.lay.size) };
  },
  table(input, r) {
    if (input.single) {
      const list = placed(input, r.lay.items[0]);
      return { q: `按${input.big ? '大端' : '小端'}，把每个地址里的字节填上（十六进制）。`, qhtml: '', qhtml: view({ stage: 'start' }, input), dir: 'row', head: ['内容'], rows: list.map((x) => ({ label: fmtA(x.addr, input), cells: [{ v: hexAlts(`${hx2(x.b)}H`) }] })) };
    }
    const extra = [{ label: 'sizeof', v: String(r.lay.size), num: true }];
    if (input.look !== null) {
      const it = r.lay.items.find((x) => placed(input, x).some((y) => y.addr === input.look));
      const b = placed(input, it).find((y) => y.addr === input.look).b;
      extra.push({ label: `${fmtA(input.look, input)} 里的字节`, v: hexAlts(`${hx2(b)}H`) });
    }
    return { q: '填每个成员的偏移量和地址（十六进制），再写 sizeof。', qhtml: view({ stage: 'start', upto: -1 }, input), dir: 'row', head: ['偏移量', '地址'], rows: r.lay.items.map((it) => ({ label: it.decl, cells: [{ v: String(it.off), num: true }, { v: hexAlts(fmtA(input.at + BigInt(it.off), input)) }] })), extra };
  },
  // 常见错法：没对齐（一个挨一个）、末尾没补齐、每个成员都按 4 对齐、大小端弄反
  variants(input) {
    const list = [
      ['packed', '像是没按边界对齐，成员一个挨一个放了'],
      ['noTail', '像是末尾没补齐（总大小要凑成最大成员大小的整数倍）'],
      ['all4', '像是每个成员都从 4 的倍数开始放（char、short 只要按自己的大小对齐）'],
      ['swap', `像是把大小端弄反了（${input.big ? '大端是高位字节放低地址' : '小端是低位字节放低地址'}）`],
    ].map(([m, label]) => ({ label, input: { ...input, mistake: m } }));
    return keepDiffering(layoutEngine, input, list);
  },
};
