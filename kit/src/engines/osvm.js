// 操作系统的虚拟存储：mem（一次访存走的整条链：虚拟地址 → 快表 → 页表 → 缺页处理 → 物理地址 → 内存，每一段花多少时间）。
// 两种用法：
//   vaddr:（一串虚拟地址）一个个走：快表、页表、驻留集（LRU / FIFO）跟着变。2009 年统考第 46 题就是这种。
//   rate:（快表命中率、缺页率、Cache 命中率）：分几种情况算各要多久，再按概率加起来，得有效访问时间 EAT。
// 口径按 2009 年统考第 46 题（王道照它讲）：先查快表，没命中再查页表，查完把这一项放进快表（时间不计）；
// 缺页处理的时间里已经含了更新快表和页表，处理完回到这条指令重新执行（再查快表——这回命中，再访存）。
// 别的教材的约定用字段换：retry:（缺页处理完怎么接着走）、parallel:（快表和页表同时查）、levels:（几级页表）。
// 纯函数（tests/osvm-engine.test.js）。
import { esc, chips } from './arrayview.js';
import { parseSize, parseNum, log2int, bitFields, hex } from './bitview.js';
import { sizeText } from './osfile.js';

const UNIT = { ns: 1, us: 1e3, μs: 1e3, ms: 1e6, s: 1e9 };
const RETRY = {
  tlb: '回到这条指令重新执行：再查快表（缺页处理时已经放进快表，命中）、再访存',
  table: '回到这条指令重新执行：再查快表（还没命中）、再查页表、再访存',
  mem: '处理完直接访存',
  none: '缺页处理的时间里已经含了这次访存',
};
const REPLACE = { lru: 'LRU', fifo: 'FIFO' };
const BOOL = /^(true|yes|on|1|是)$/i;
// 浮点的尾巴（0.9 × 110 + 0.1 × 210 = 120.00000000000001）抹掉再比、再写
const round = (x) => Math.round(x * 1e9) / 1e9;
export const num = (x) => round(x).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 9 });
// 说明里的大数：100000000 写成 10⁸、25000000 写成 2.5×10⁷（答案、合计照原样写，和考卷上的一样）
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function big(x) {
  const r = round(x);
  if (!Number.isInteger(r) || r < 1e6) return num(r);
  const e = Math.floor(Math.log10(r));
  const m = round(r / 10 ** e);
  if (!Number.isInteger(m * 10)) return num(r);
  return `${m === 1 ? '' : `${num(m)}×`}10${[...String(e)].map((d) => SUP[d]).join('')}`;
}
const pct = (p) => num(p);
const bitLen = (v) => BigInt(v).toString(2).length;
const up4 = (b) => Math.ceil(b / 4) * 4;
const list = (src) => String(src ?? '').split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);

// 时间：100、10^8、1e8、1.5×10^8、8ms、0.2us → 换成 unit 下的数
export function parseTime(src, unit = 'ns', what = '时间') {
  const s = String(src ?? '').trim().replace(/\s+/g, '').replace(/µ/g, 'μ');
  const m = /^(?:(\d+(?:\.\d+)?)[×xX*])?(\d+(?:\.\d+)?)(?:\^(-?\d+)|[eE](-?\d+))?(ns|us|μs|ms|s)?$/.exec(s);
  if (!m) throw new Error(`${what}写成 100、10^8、1e8 或 8ms（现在是「${src}」）`);
  let v = Number(m[2]);
  if (m[3] !== undefined) v **= Number(m[3]);
  if (m[4] !== undefined) v *= 10 ** Number(m[4]);
  if (m[1] !== undefined) v *= Number(m[1]);
  return round((v * UNIT[(m[5] || unit).toLowerCase()]) / UNIT[unit]);
}

// cost: tlb=10 mem=100 fault=10^8 cache=5（单位是 unit:，默认 ns；值后面也可以自己带单位）
const COST_NAMES = { tlb: 'tlb', 快表: 'tlb', mem: 'mem', 内存: 'mem', 主存: 'mem', 访存: 'mem', fault: 'fault', 缺页: 'fault', cache: 'cache' };
function parseCost(src, unit) {
  if (src === undefined || String(src).trim() === '') return null;
  const out = {};
  const parts = [...String(src).matchAll(/([^\s=:：,，;；]+)\s*[=:：]\s*([^\s,，;；]+)/g)];
  if (!parts.length) throw new Error('cost: 写成 tlb=10 mem=100 fault=10^8（单位 ns）');
  for (const m of parts) {
    const k = COST_NAMES[m[1].toLowerCase()];
    if (!k) throw new Error(`cost: 不认识「${m[1]}」（能写 tlb、mem、fault、cache）`);
    out[k] = parseTime(m[2], unit, `cost: 的 ${m[1]} `);
  }
  if (out.mem === undefined) throw new Error('cost: 至少要写访问一次内存的时间 mem，如 cost: tlb=10 mem=100 fault=10^8');
  return out;
}

// rate: tlb=0.9 fault=0.0001 cache=95%
const RATE_NAMES = { tlb: 'tlb', 快表: 'tlb', fault: 'fault', 缺页: 'fault', cache: 'cache' };
function parseRate(src) {
  const out = {};
  const parts = [...String(src ?? '').matchAll(/([^\s=:：,，;；]+)\s*[=:：]\s*([^\s,，;；]+)/g)];
  if (!parts.length) throw new Error('rate: 写成 tlb=0.9 fault=0.0001（快表命中率、缺页率；可以写 90%）');
  for (const m of parts) {
    const k = RATE_NAMES[m[1].toLowerCase()];
    if (!k) throw new Error(`rate: 不认识「${m[1]}」（能写 tlb、fault、cache）`);
    const t = m[2].trim();
    const v = /%$/.test(t) ? Number(t.slice(0, -1)) / 100 : parseTime(t, 'ns', `rate: 的 ${m[1]} `);
    if (!(v >= 0 && v <= 1)) throw new Error(`rate: ${m[1]} 是概率，写 0～1 的数或百分数（现在是「${t}」）`);
    out[k] = round(v);
  }
  if (out.tlb === undefined) throw new Error('rate: 要写快表命中率 tlb=，如 rate: tlb=0.9');
  if (out.tlb + (out.fault || 0) > 1 + 1e-12) throw new Error('rate: 快表命中率加缺页率超过 1 了（缺页率是占全部访问的比例）');
  return out;
}

// 页表：0->101H, 1->-, 2->254H（- 是有效位 0：不在内存）
function parseTable(src) {
  const map = new Map();
  let hexy = false;
  for (const part of String(src ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\w+)\s*(?:->|→|:|：|=)\s*(\w+|-|—|无)$/.exec(part);
    if (!m) throw new Error(`table: 看不懂「${part}」，写成 0->101H（页 0 在第 101H 块），不在内存写 1->-`);
    const p = Number(parseNum(m[1], 'table: 的页号'));
    if (map.has(p)) throw new Error(`table: 页 ${p} 写了两次`);
    if (/^(-|—|无)$/.test(m[2])) { map.set(p, null); continue; }
    if (/h$|^0x/i.test(m[2])) hexy = true;
    map.set(p, Number(parseNum(m[2], 'table: 的块号')));
  }
  if (!map.size) throw new Error('mem 要写 table:（页表：页号->块号，不在内存写 -，如 table: 0->101H, 1->-, 2->254H）');
  return { map, hexy };
}

function parseCommon(fields) {
  const unit = String(fields.unit ?? 'ns').trim().replace(/µ/g, 'μ').toLowerCase() || 'ns';
  if (!UNIT[unit]) throw new Error('unit: 写 ns、us 或 ms（时间都按它算、按它写答案）');
  const levels = fields.levels === undefined || fields.levels === '' ? 1 : Number(fields.levels);
  if (!(Number.isInteger(levels) && levels >= 1 && levels <= 4)) throw new Error('levels: 页表有几级（1～4）：快表没命中时要访问几次内存查页表');
  const retry = String(fields.retry ?? 'tlb').trim().toLowerCase() || 'tlb';
  if (!RETRY[retry]) throw new Error('retry: 缺页处理完怎么接着走：tlb（重新执行，快表命中，默认）、table（重新执行，快表还没命中）、mem（直接访存）、none（缺页时间里含了访存）');
  const parallel = BOOL.test(String(fields.parallel ?? '').trim());
  const cost = parseCost(fields.cost, unit);
  return { unit, levels, retry, parallel, cost };
}

function parse(fields) {
  const common = parseCommon(fields);
  const hasV = fields.vaddr !== undefined && String(fields.vaddr).trim() !== '';
  const hasR = fields.rate !== undefined && String(fields.rate).trim() !== '';
  if (hasV && hasR) throw new Error('vaddr:（一个个地址走）和 rate:（按命中率算 EAT）只写一个');
  if (!hasV && !hasR) throw new Error('mem 要写 vaddr:（一串虚拟地址，一个个走）或 rate:（快表命中率等，算有效访问时间）');
  if (hasR) {
    const rate = parseRate(fields.rate);
    const c = common.cost;
    if (!c) throw new Error('rate: 要和 cost: 一起写（各段的时间，如 cost: tlb=10 mem=100 fault=10^8）');
    if (c.tlb === undefined) throw new Error('cost: 要写访问快表的时间 tlb=（可以是 0）');
    if (rate.fault && c.fault === undefined) throw new Error('写了缺页率，cost: 还要写缺页处理时间 fault=');
    if (rate.cache !== undefined && c.cache === undefined) throw new Error('写了 Cache 命中率，cost: 还要写访问 Cache 的时间 cache=');
    return { ...common, kind: 'eat', rate, mistake: '' };
  }
  const page = parseSize(fields.page ?? '4KB', 'page: 页面大小');
  const k = log2int(page);
  if (k === null) throw new Error('page: 页面大小要是 2 的幂（4KB、1KB……）');
  const addrs = String(fields.vaddr).split(/[,，、;；\s]+/).filter(Boolean).map((x) => ({ text: x, v: parseNum(x, 'vaddr: 虚拟地址') }));
  if (addrs.length > 8) throw new Error('vaddr: 最多 8 个');
  const { map: table, hexy } = parseTable(fields.table);
  for (const a of addrs) {
    const p = Number(a.v >> BigInt(k));
    if (!table.has(p)) throw new Error(`vaddr: ${a.text} 的页号是 ${p}，页表里没有这一页（越界）。table: 里要写上它`);
  }
  if (common.cost && common.cost.tlb === undefined) common.cost.tlb = 0;
  if (common.cost && common.cost.fault === undefined && [...table.values()].includes(null)) throw new Error('页表里有不在内存的页：cost: 还要写缺页处理时间 fault=（如 fault=10^8）');
  const valid = [...table.entries()].filter(([, f]) => f !== null).map(([p]) => p);
  // 快表：一开始有哪几页（写页号就行，写 0->101H 也认，要和页表对得上）
  const tlb = [];
  for (const t of list(fields.tlb)) {
    const m = /^(\w+)(?:->|→|:|=)(\w+)$/.exec(t);
    const p = Number(parseNum(m ? m[1] : t, 'tlb: 的页号'));
    if (table.get(p) === undefined || table.get(p) === null) throw new Error(`tlb: 页 ${p} 在页表里${table.has(p) ? '不在内存' : '没有'}，不能在快表里`);
    if (m && Number(parseNum(m[2], 'tlb: 的块号')) !== table.get(p)) throw new Error(`tlb: 页 ${p} 的块号和页表里的对不上`);
    if (!tlb.includes(p)) tlb.push(p);
  }
  const tlbsize = fields.tlbsize === undefined || fields.tlbsize === '' ? 0 : Number(fields.tlbsize);
  if (!(Number.isInteger(tlbsize) && tlbsize >= 0 && tlbsize <= 16)) throw new Error('tlbsize: 快表能放几项（1～16；不写就是放得下）');
  if (tlbsize && tlb.length > tlbsize) throw new Error(`tlb: 写了 ${tlb.length} 项，比 tlbsize: ${tlbsize} 多`);
  const free = list(fields.free).map((x) => Number(parseNum(x, 'free: 空闲的物理块号')));
  for (const f of free) if ([...table.values()].includes(f)) throw new Error(`free: 第 ${f} 块已经有页在里面了`);
  const resident = fields.resident === undefined || fields.resident === '' ? valid.length + free.length : Number(fields.resident);
  if (!(Number.isInteger(resident) && resident >= 1)) throw new Error('resident: 驻留集有几块（正整数）');
  if (resident < valid.length) throw new Error(`resident: ${resident} 比页表里已经在内存的 ${valid.length} 页还少`);
  if (resident > valid.length + free.length && [...table.values()].includes(null)) {
    // 驻留集没满就缺页，要调进空闲块：块号得给出来，不然算不出物理地址
    const need = resident - valid.length;
    if (free.length < need) throw new Error(`resident: ${resident} 块、现在只有 ${valid.length} 页在内存：缺页时要调进空闲块，写 free: 给出 ${need} 个空闲的物理块号（或者把 resident: 改小）`);
  }
  // 驻留集里的页从老到新（LRU 看最近一次访问的先后，FIFO 看调入的先后）；不写就按页号从小到大
  let order = valid.slice().sort((a, b) => a - b);
  if (fields.order !== undefined && String(fields.order).trim() !== '') {
    order = list(fields.order).map((x) => Number(parseNum(x, 'order: 页号')));
    const same = order.length === valid.length && valid.every((p) => order.includes(p));
    if (!same) throw new Error(`order: 要把现在在内存里的页（${valid.join('、')}）按从老到新全写上`);
  }
  const replace = String(fields.replace ?? 'lru').trim().toLowerCase() || 'lru';
  if (!REPLACE[replace]) throw new Error('replace: 写 lru（默认）或 fifo');
  const frames = [...[...table.values()].filter((f) => f !== null), ...free];
  const maxA = addrs.reduce((m, a) => (a.v > m ? a.v : m), 0n);
  const bits = fields.bits ? Number(fields.bits) : up4(Math.max(bitLen(maxA), k + bitLen(Math.max(...table.keys())), k + 1));
  if (!(Number.isInteger(bits) && bits > k && bits <= 64)) throw new Error(`bits: 虚拟地址的位数（比页内偏移 ${k} 位多）`);
  for (const a of addrs) if (a.v >= 1n << BigInt(bits)) throw new Error(`vaddr: ${a.text} 超出了 ${bits} 位`);
  const pbits = fields.pbits ? Number(fields.pbits) : up4(k + Math.max(1, ...frames.map((f) => bitLen(f))));
  if (!(Number.isInteger(pbits) && pbits > k && pbits <= 64)) throw new Error(`pbits: 物理地址的位数（比页内偏移 ${k} 位多）`);
  return { ...common, kind: 'trace', page, k, addrs, table, hexy, tlb, tlbsize, free, resident, order, replace, bits, pbits, mistake: '' };
}

// 块号照作者的写法：写的是 101H 就写十六进制
const frameText = (input, f) => (input.hexy ? `${f.toString(16).toUpperCase()}H` : String(f));

// mistake（只在算常见错法时用）：
//   noRetry    缺页处理完没有重新执行（少了重查快表、访存）
//   retryMiss  以为重新执行时快表还没命中（缺页处理已经把这一项放进快表）
//   noFill     查完页表没把这一项放进快表（之后再访问这一页还是没命中）
//   parallel   快表没命中时没算查快表的时间（当成了同时查）
//   oneLevel   多级页表只算了一次访存
//   mru        换出了最近刚访问过的页；fifo / lru：按另一种算法换
//   missNoData 快表没命中时只算了查页表，没算再访存取数据（EAT）
//   cacheMiss  Cache 没命中时只算了访存、没算先查 Cache 的时间（EAT）
const rules = (input) => {
  const m = input.mistake;
  return {
    L: m === 'oneLevel' ? 1 : input.levels,
    parallel: input.parallel || m === 'parallel',
    retry: m === 'noRetry' ? 'none' : m === 'retryMiss' ? 'table' : input.retry,
    replace: m === 'fifo' ? 'fifo' : m === 'lru' ? 'lru' : input.replace,
  };
};

function startText(input) {
  const { cost: c, unit } = input;
  const ptText = input.levels > 1 ? `${input.levels} 级页表（快表没命中要访问 ${input.levels} 次内存查页表）` : '页表在内存里';
  const costText = c ? `访问快表 ${num(c.tlb)} ${unit}、内存 ${num(c.mem)} ${unit}${c.fault !== undefined ? `、缺页处理 ${big(c.fault)} ${unit}` : ''}${c.cache !== undefined ? `、Cache ${num(c.cache)} ${unit}` : ''}。` : '';
  return { ptText, costText };
}

// ================= 一串地址一个个走 =================
function runTrace(input) {
  const { addrs, k, page, unit, pbits } = input;
  const c = input.cost;
  const R = rules(input);
  const table = new Map(input.table);
  let tlb = input.tlb.slice(); // 快表里的页（最久没用的在前：tlbsize 满了换它）
  let recent = input.order.slice(); // 驻留集：最近一次访问从早到晚
  let loaded = input.order.slice(); // 驻留集：调入从早到晚
  const free = input.free.slice();
  const steps = [];
  const results = [];
  const fr = (f) => frameText(input, f);
  const snap = (extra = {}) => ({ table: [...table.entries()], tlb: tlb.slice(), recent: recent.slice(), loaded: loaded.slice(), done: results.slice(), ...extra });
  const tlbPut = (p) => { tlb = tlb.filter((x) => x !== p); if (input.tlbsize && tlb.length >= input.tlbsize) tlb.shift(); tlb.push(p); };
  const touch = (p) => { recent = recent.filter((x) => x !== p); recent.push(p); };
  const { ptText, costText } = startText(input);
  steps.push({ view: snap({ stage: 'start' }), msg: `页面 ${sizeText(page)} = 2^${k} B：虚拟地址的低 ${k} 位是页内偏移，高位是页号。${ptText}；快表${input.tlb.length ? `里一开始有页 ${input.tlb.join('、')}` : '一开始是空的'}。驻留集 ${input.resident} 块，缺页时按 ${REPLACE[input.replace]} 换。${costText}缺页处理完：${RETRY[input.retry]}。` });
  for (const [i, a] of addrs.entries()) {
    const p = Number(a.v >> BigInt(k));
    const d = a.v & ((1n << BigInt(k)) - 1n);
    const parts = [];
    const add = (t, what) => { if (c && t !== undefined) parts.push({ t, what }); };
    const base = { i, a: a.text, v: a.v, p, d };
    // 这一次访问走到哪、查到了什么：一路攒着（后面的步还要画出前面查到的块号、换出的页）
    const acc = { ...base };
    const cur = (stage, extra = {}) => { Object.assign(acc, extra); return snap({ stage, cur: { ...acc }, parts: parts.slice() }); };
    steps.push({ view: cur('split'), msg: `${a.text}：低 ${k} 位是页内偏移 ${hex(d, k)}，剩下的高位是页号 ${p}（就是 ${a.text} ÷ ${sizeText(page)} 的商和余数）。`, ask: { tag: 'page', kind: 'number', q: `虚拟地址 ${a.text} 的页号是多少？`, answer: p } });
    const tlbAsk = (hit) => ({ tag: 'tlb', kind: 'choice', q: `访问 ${a.text}：页 ${p} 在快表里命中吗？`, choices: ['命中', '没命中'], answer: hit ? '命中' : '没命中' });
    const hit = tlb.includes(p);
    let f, fault = false, victim = null;
    if (hit) {
      f = table.get(p);
      add(c?.tlb, '查快表');
      tlbPut(p);
      steps.push({ view: cur('tlb', { hit: true, f }), msg: `查快表：页 ${p} 在快表里，命中，直接拿到块号 ${fr(f)}，不用查页表。`, ask: tlbAsk(true) });
    } else {
      if (!R.parallel) add(c?.tlb, '查快表');
      steps.push({ view: cur('tlb', { hit: false }), msg: `查快表：没有页 ${p}，没命中${R.parallel ? '（快表和页表是同时查的，查快表的时间不另算）' : ''}，去查内存里的页表。`, ask: tlbAsk(false) });
      add(c ? R.L * c.mem : undefined, R.L > 1 ? `查 ${R.L} 级页表` : '查页表');
      f = table.get(p);
      const inAsk = (yes) => ({ tag: 'inmem', kind: 'choice', q: `查页表：页 ${p} 在内存里吗？`, choices: ['在内存', '不在：缺页'], answer: yes ? '在内存' : '不在：缺页' });
      if (f !== null) {
        if (input.mistake !== 'noFill') tlbPut(p);
        steps.push({ view: cur('table', { f }), msg: `查页表（访问内存 ${R.L} 次）：页 ${p} 有效位是 1，在第 ${fr(f)} 块。把这一项放进快表（时间不计）。`, ask: inAsk(true) });
      } else {
        fault = true;
        steps.push({ view: cur('table', { fault: true }), msg: `查页表（访问内存 ${R.L} 次）：页 ${p} 有效位是 0，不在内存，产生缺页中断。`, ask: inAsk(false) });
        let how, ask;
        if (recent.length < input.resident) {
          f = free.shift();
          how = `驻留集还没满（${input.resident} 块，用了 ${recent.length} 块）：把页 ${p} 调进空闲的第 ${fr(f)} 块`;
        } else {
          const rule = R.replace === 'fifo' ? loaded : recent;
          victim = input.mistake === 'mru' ? recent.at(-1) : rule[0];
          f = table.get(victim);
          table.set(victim, null);
          tlb = tlb.filter((x) => x !== victim);
          recent = recent.filter((x) => x !== victim);
          loaded = loaded.filter((x) => x !== victim);
          const why = input.replace === 'fifo' ? `最早调入的是页 ${victim}` : `最久没访问的是页 ${victim}（最近一次访问从早到晚：${[victim, ...recent].join('、')}）`;
          how = `驻留集 ${input.resident} 块已经满了，按 ${REPLACE[input.replace]} 换：${why}。换出页 ${victim}（页表里它的有效位改成 0${input.tlb.length || i ? '，快表里有它的话也作废' : ''}），把页 ${p} 调进它腾出来的第 ${fr(f)} 块`;
          ask = { tag: 'victim', kind: 'pick', q: `页 ${p} 缺页，驻留集已满：按 ${REPLACE[input.replace]} 要换出哪一页？在页表里点出来。`, answer: String(victim) };
        }
        table.set(p, f);
        loaded.push(p);
        if (R.retry !== 'table') tlbPut(p);
        add(c?.fault, '缺页处理');
        steps.push({ view: cur('fault', { f, victim }), msg: `缺页处理${c ? `（${big(c.fault)} ${unit}，已经含了更新页表${R.retry !== 'table' ? '和快表' : ''}）` : ''}：${how}。`, ...(ask ? { ask } : {}) });
        if (R.retry === 'tlb') {
          add(c?.tlb, '重新查快表');
          steps.push({ view: cur('retry', { f, fault: true }), msg: `缺页处理完，回到这条指令重新执行：再查快表——这回命中了（缺页处理时已经放进快表），拿到块号 ${fr(f)}。` });
        } else if (R.retry === 'table') {
          if (!R.parallel) add(c?.tlb, '重新查快表');
          add(c ? R.L * c.mem : undefined, '再查页表');
          tlbPut(p);
          steps.push({ view: cur('retry', { f, fault: true }), msg: `缺页处理完，回到这条指令重新执行：再查快表——还没命中（缺页处理只改了页表），再查页表拿到块号 ${fr(f)}，放进快表。` });
        }
      }
    }
    touch(p);
    const pa = (BigInt(f) << BigInt(k)) | d;
    const data = !(fault && R.retry === 'none');
    if (data) add(c?.mem, '访存');
    steps.push({ view: cur('phys', { f, pa, hit, fault }), msg: `物理地址 = 块号 ${fr(f)} 拼上页内偏移 ${hex(d, k)}：${hex(pa, pbits)}。${data ? '按它访问内存，取到数据。' : '（缺页处理的时间里已经含了这次访存。）'}`, ask: { tag: 'paddr', kind: 'hex', q: `${a.text} 的物理地址是多少？（写十六进制）`, answer: pa, display: hex(pa, pbits) } });
    const time = round(parts.reduce((s, x) => s + x.t, 0));
    results.push({ a: a.text, p, hit, fault, victim, f, pa, time: c ? time : undefined });
    if (c) steps.push({ view: cur('time', { f, pa, hit, fault, total: time }), msg: `访问 ${a.text} 一共：${parts.map((x) => `${big(x.t)}（${x.what}）`).join(' + ')} = ${num(time)} ${unit}。`, ask: { tag: 'time', kind: 'number', q: `访问 ${a.text} 一共要多少 ${unit}？`, answer: time } });
  }
  const faults = results.filter((x) => x.fault).length;
  steps.push({ view: snap({ stage: 'end' }), msg: `${results.map((x) => `${x.a} → ${hex(x.pa, pbits)}${c ? `，${num(x.time)} ${unit}` : ''}`).join('；')}。一共缺页 ${faults} 次。` });
  return { steps, results };
}

// ================= 按命中率算有效访问时间 =================
// 三种情况：快表命中、快表没命中（页在内存）、缺页。每种的时间一段段加起来，再按概率加权
export function eatCases(input) {
  const c = input.cost, rt = input.rate;
  const R = rules(input);
  const m = input.mistake;
  const parts = { data: [] };
  // 访问数据本身：有 Cache 时先查 Cache，没命中再访存
  let D = c.mem, dText = `${num(c.mem)}`;
  if (rt.cache !== undefined) {
    const miss = m === 'cacheMiss' ? c.mem : c.cache + c.mem;
    D = round(rt.cache * c.cache + (1 - rt.cache) * miss);
    dText = `${num(D)}`;
    parts.data = [`${pct(rt.cache)} × ${num(c.cache)}（Cache 命中）`, `${pct(round(1 - rt.cache))} × ${m === 'cacheMiss' ? num(c.mem) : `(${num(c.cache)} + ${num(c.mem)})`}（没命中，再访存）`];
  }
  const dataName = rt.cache !== undefined ? '取数据' : '访存';
  const tlbT = (miss) => (miss && R.parallel ? [] : [[c.tlb, '查快表']]);
  const ptT = [[R.L * c.mem, R.L > 1 ? `查 ${R.L} 级页表` : '查页表']];
  const hit = [[c.tlb, '查快表'], [D, dataName]];
  const miss = [...tlbT(true), ...ptT, ...(m === 'missNoData' ? [] : [[D, dataName]])];
  const out = [{ key: 'hit', name: '快表命中', p: rt.tlb, parts: hit }, { key: 'miss', name: rt.fault ? '快表没命中，页在内存' : '快表没命中', p: round(1 - rt.tlb - (rt.fault || 0)), parts: miss }];
  if (rt.fault) {
    const again = R.retry === 'tlb' ? [[c.tlb, '重新查快表'], [D, dataName]] : R.retry === 'table' ? [...tlbT(true).map(([t]) => [t, '重新查快表']), ...ptT.map(([t]) => [t, '再查页表']), [D, dataName]] : R.retry === 'mem' ? [[D, dataName]] : [];
    out.push({ key: 'fault', name: '缺页', p: rt.fault, parts: [...tlbT(true), ...ptT, [c.fault, '缺页处理'], ...again] });
  }
  for (const x of out) x.t = round(x.parts.reduce((s, [t]) => s + t, 0));
  const eat = round(out.reduce((s, x) => s + x.p * x.t, 0));
  return { cases: out, D, dText, dataParts: parts.data, eat };
}

function runEat(input) {
  const { unit } = input;
  const c = input.cost, rt = input.rate;
  const { cases, D, dataParts, eat } = eatCases(input);
  const steps = [];
  const { ptText, costText } = startText(input);
  steps.push({ view: { stage: 'start', upto: 0 }, msg: `快表命中率 ${pct(rt.tlb)}${rt.fault ? `，缺页率 ${pct(rt.fault)}` : ''}${rt.cache !== undefined ? `，Cache 命中率 ${pct(rt.cache)}` : ''}；${ptText}。${costText}先分情况算每种要多久，再按概率加起来。${rt.fault ? `缺页处理完：${RETRY[input.retry]}。` : ''}` });
  if (rt.cache !== undefined) steps.push({ view: { stage: 'data', upto: 0 }, msg: `先算取一次数据要多久：先查 Cache，没命中再访存。${dataParts.join(' + ')} = ${num(D)} ${unit}。`, ask: { tag: 'data', kind: 'number', q: `取一次数据（先查 Cache，没命中再访存）平均要多少 ${unit}？`, answer: D } });
  const say = (x) => `${x.parts.map(([t, w]) => `${big(t)}（${w}）`).join(' + ')} = ${num(x.t)} ${unit}`;
  const why = { hit: '', miss: '查完页表把这一项放进快表，时间不计。', fault: '' };
  cases.forEach((x, i) => {
    steps.push({ view: { stage: x.key, upto: i + 1, cur: i }, msg: `${x.name}（概率 ${pct(x.p)}）：${say(x)}。${why[x.key]}`, ask: { tag: x.key, kind: 'number', q: `${x.name}时，一次访问要多少 ${unit}？`, answer: x.t } });
  });
  steps.push({ view: { stage: 'eat', upto: cases.length, eat }, msg: `EAT = ${cases.map((x) => `${pct(x.p)} × ${num(x.t)}`).join(' + ')} = ${num(eat)} ${unit}。`, ask: { tag: 'eat', kind: 'number', q: `有效访问时间 EAT 是多少 ${unit}？`, answer: eat } });
  return { steps, cases, eat, D };
}

const run = (input) => (input.kind === 'eat' ? runEat(input) : runTrace(input));

// ================= 画面 =================
const ORDER = ['start', 'split', 'tlb', 'table', 'fault', 'retry', 'phys', 'time', 'end'];
const at = (s) => ORDER.indexOf(s);

function chain(s, input) {
  const cur = s.cur;
  const st = at(s.stage);
  if (!cur) return '';
  // 每一站：现在在这儿（on）、走过了（ok / bad：没命中、缺页）、这一次用不上（skip）、还没到（空）
  const node = (key, name, small, cls) => `<span class="vm-node ${cls}" data-label="${esc(name)}">${esc(name)}${small ? `<small>${esc(small)}</small>` : ''}</span>`;
  const passed = (stage) => st > at(stage);
  const here = (stage) => s.stage === stage;
  const tlbCls = here('tlb') ? (cur.hit ? 'vm-on vm-ok' : 'vm-on vm-bad') : here('retry') ? 'vm-on vm-ok' : passed('tlb') ? (cur.hit ? 'vm-ok' : 'vm-bad') : '';
  const tableCls = cur.hit && passed('tlb') ? 'vm-skip' : here('table') ? (cur.fault ? 'vm-on vm-bad' : 'vm-on vm-ok') : passed('table') ? (cur.fault ? 'vm-bad' : 'vm-ok') : '';
  const faultCls = (cur.hit && passed('tlb')) || (!cur.fault && passed('table')) ? 'vm-skip' : here('fault') ? 'vm-on' : passed('fault') ? 'vm-ok' : '';
  const paCls = here('phys') ? 'vm-on' : passed('phys') ? 'vm-ok' : '';
  const nodes = [
    node('va', '虚拟地址', cur.a, here('split') ? 'vm-on' : 'vm-ok'),
    node('tlb', '快表', passed('split') ? (here('retry') ? '重查：命中' : cur.hit ? '命中' : '没命中') : '', tlbCls),
    node('table', input.levels > 1 ? `页表 ×${input.levels}` : '页表', passed('tlb') && !cur.hit ? (cur.fault ? '有效位 0' : `块 ${frameText(input, cur.f)}`) : '', tableCls),
    node('fault', '缺页处理', faultCls.includes('skip') || !passed('table') ? '' : cur.victim !== null && cur.victim !== undefined ? `换出页 ${cur.victim}` : cur.f !== undefined ? `调入块 ${frameText(input, cur.f)}` : '', faultCls),
    node('pa', '物理地址', cur.pa !== undefined ? hex(cur.pa, input.pbits) : '', paCls),
    node('mem', '内存', '', paCls),
  ];
  return `<div class="vm-chain">${nodes.map((x, i) => x.replace('<span class="vm-node', `<span data-cmd="${i + 1}" class="vm-node`)).join('<span class="vm-arr" aria-hidden="true">→</span>')}</div>`;
}

function viewTrace(s, input) {
  const { k, bits, pbits } = input;
  const cur = s.cur;
  let h = chain(s, input);
  if (cur) {
    h += `<div class="vm-bits">${bitFields(cur.v, [{ name: '页号', bits: bits - k, cls: 'bv-a' }, { name: '页内偏移', bits: k, cls: 'bv-c' }], { hi: s.stage === 'split' ? ['页号', '页内偏移'] : ['页号'] })}`;
    if (cur.pa !== undefined) h += `<span class="vm-to" aria-hidden="true">⇒</span>${bitFields(cur.pa, [{ name: '块号', bits: pbits - k, cls: 'bv-b' }, { name: '页内偏移', bits: k, cls: 'bv-c' }], { hi: ['块号'] })}`;
    h += '</div>';
  }
  // 快表、页表、驻留集
  const p = cur?.p;
  const st = at(s.stage);
  const tlbRow = (q, i) => {
    const on = cur && q === p && (s.stage === 'tlb' || s.stage === 'retry' || (cur.hit && st > at('tlb')));
    return `<tr class="${on ? 'vm-hit' : ''}" data-cmd="${7 + i}" data-label="快表 页${q}"><td>${q}</td><td>${frameText(input, s.table.find(([x]) => x === q)[1])}</td></tr>`;
  };
  const tlbBody = s.tlb.length ? s.tlb.map(tlbRow).join('') : '<tr><td colspan="2" class="vm-none">空</td></tr>';
  const rows = s.table.slice().sort((a, b) => a[0] - b[0]);
  const ptRow = ([q, f], i) => {
    const look = cur && q === p && !cur.hit && st >= at('table');
    const cls = [look ? (s.stage === 'table' && cur.fault ? 'vm-miss' : 'vm-hit') : '', cur && q === cur.victim && st >= at('fault') ? 'vm-out' : '', cur && q === p && cur.fault && s.stage === 'fault' ? 'sv-new' : ''].filter(Boolean).join(' ');
    return `<tr class="${cls}" data-pick="${q}" data-cmd="${7 + s.tlb.length + i}" data-label="页${q}"><td>${q}</td><td>${f === null ? '—' : frameText(input, f)}</td><td>${f === null ? 0 : 1}</td></tr>`;
  };
  h += '<div class="vm-tabs">';
  h += `<div class="vm-tbl"><div class="vm-h">快表${input.tlbsize ? `（${input.tlbsize} 项）` : ''}</div><table class="sv-gtbl sv-tab vm-tab"><thead><tr><th>页号</th><th>块号</th></tr></thead><tbody>${tlbBody}</tbody></table></div>`;
  h += `<div class="vm-tbl"><div class="vm-h">页表</div><table class="sv-gtbl sv-tab vm-tab"><thead><tr><th>页号</th><th>块号</th><th>有效位</th></tr></thead><tbody>${rows.map(ptRow).join('')}</tbody></table></div>`;
  const rs = input.replace === 'fifo' ? s.loaded : s.recent;
  h += `<div class="vm-tbl"><div class="vm-h">驻留集（${input.resident} 块，${REPLACE[input.replace]}）</div><div class="vm-rs">${rs.map((q) => `<span class="vm-pg">页 ${q}</span>`).join('<i>→</i>') || '<span class="vm-none">空</span>'}</div><div class="vm-rs-n">${input.replace === 'fifo' ? '最早调入 → 最晚调入' : '最久没访问 → 最近访问'}</div></div>`;
  h += '</div>';
  // 这一次访问到现在花的时间
  if (input.cost && s.parts && s.parts.length) {
    const sum = round(s.parts.reduce((a, x) => a + x.t, 0));
    h += `<div class="vm-cost">${s.parts.map((x) => `<span class="vm-c"><b>${big(x.t)}</b><small>${esc(x.what)}</small></span>`).join('<i>+</i>')}${s.stage === 'time' ? `<i>=</i><span class="vm-c vm-sum"><b>${num(sum)}</b><small>${esc(input.unit)}</small></span>` : ''}</div>`;
  }
  if (s.done.length && (s.stage === 'end' || s.stage === 'split' || s.stage === 'start')) {
    h += `<table class="sv-gtbl sv-tab vm-tab vm-done"><thead><tr><th>虚拟地址</th><th>页号</th><th>快表</th><th>缺页</th><th>物理地址</th>${input.cost ? '<th>用时</th>' : ''}</tr></thead><tbody>${s.done.map((x) => `<tr><td>${esc(x.a)}</td><td>${x.p}</td><td>${x.hit ? '命中' : '没命中'}</td><td>${x.fault ? `缺页${x.victim !== null ? `，换出页 ${x.victim}` : ''}` : '—'}</td><td>${hex(x.pa, pbits)}</td>${input.cost ? `<td>${num(x.time)} ${esc(input.unit)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
  return h;
}

function viewEat(s, input) {
  const { cases, D, eat } = eatCases(input);
  const c = input.cost;
  let h = '';
  if (input.rate.cache !== undefined) h += chips([['取一次数据', s.stage !== 'start' ? `${num(D)} ${input.unit}` : '?'], ['Cache', `${num(c.cache)} ${input.unit}，命中率 ${pct(input.rate.cache)}`]]);
  h += `<table class="sv-gtbl sv-tab vm-tab vm-eat"><thead><tr><th>情况</th><th>概率</th><th>一次要多久</th></tr></thead><tbody>${cases.map((x, i) => `<tr class="${s.cur === i ? 'vm-curcase' : ''}" data-cmd="${i + 1}" data-label="${esc(x.name)}"><td>${esc(x.name)}</td><td>${pct(x.p)}</td><td>${i < s.upto ? `${x.parts.map(([t]) => big(t)).join(' + ')} = <b>${num(x.t)}</b>` : '?'}</td></tr>`).join('')}</tbody></table>`;
  h += `<div class="vm-eatline">EAT = ${cases.map((x, i) => `${pct(x.p)} × ${i < s.upto ? num(x.t) : '?'}`).join(' + ')}${s.stage === 'eat' ? ` = <b>${num(eat)}</b> ${esc(input.unit)}` : ''}</div>`;
  return h;
}

const view = (s, input) => (input.kind === 'eat' ? viewEat(s, input) : viewTrace(s, input));

// 一个 run 里学生能答的（ask、quiz、填表）：错法算出来和对的一样就不列
function answersOf(input, r) {
  const asks = r.steps.map((s) => s.ask).filter(Boolean).map((a) => [a.q, String(a.answer)]);
  let t = null;
  try { t = memEngine.table(input, r); } catch { /* */ }
  return JSON.stringify([asks, t && t.rows.map((row) => row.cells.map((x) => x.v)), t?.extra?.map((x) => x.v)]);
}

const hexAlts = (v, w) => { const t = v.toString(16).toUpperCase(); const p = t.padStart(Math.ceil(w / 4), '0'); return [...new Set([`${p}H`, p, `0x${p}`, `${t}H`, t, `0x${t}`])]; };

export const memEngine = {
  name: 'mem', title: '地址变换和访存时间', parse, run, view,
  quiz(input, r) {
    if (input.kind === 'eat') return { q: `${r.steps[0].msg.replace('先分情况算每种要多久，再按概率加起来。', '')}有效访问时间 EAT 是多少 ${input.unit}？`, type: 'num', answer: num(r.eat) };
    const qhtml = viewTrace(r.steps[0].view, input);
    const given = r.steps[0].msg;
    if (input.cost) return { q: `${given}依次访问 ${input.addrs.map((a) => a.text).join('、')}，各要多少 ${input.unit}？按顺序写，用空格隔开。`, qhtml, type: 'seq', answer: r.results.map((x) => num(x.time)).join(' ') };
    const alts = [0, 1, 2].map((j) => r.results.map((x) => hexAlts(x.pa, input.pbits)[j]).join(' '));
    return { q: `${given}依次访问 ${input.addrs.map((a) => a.text).join('、')}，物理地址各是多少？（十六进制，按顺序写，空格隔开）`, qhtml, type: 'seq', answer: alts.join(' | ') };
  },
  // 考卷上那张表：每个地址的页号、快表命中没有、缺页没有、物理地址、用时；EAT 是每种情况的概率和时间
  table(input, r) {
    if (input.kind === 'eat') {
      return {
        q: '分情况写出每种情况的概率和一次访问要多久，再写有效访问时间 EAT。', qhtml: '', dir: 'row', head: ['概率', `用时（${input.unit}）`],
        rows: r.cases.map((x) => ({ label: x.name, cells: [{ v: pct(x.p), num: true }, { v: num(x.t), num: true }] })),
        extra: [...(input.rate.cache !== undefined ? [{ label: `取一次数据（${input.unit}）`, v: num(r.D), num: true }] : []), { label: `EAT（${input.unit}）`, v: num(r.eat), num: true }],
      };
    }
    return {
      q: `依次访问这几个虚拟地址：写出页号、快表命中没有（命中打 √）、缺页没有（缺页打 √）、物理地址（十六进制）${input.cost ? `和这次访问用的时间（${input.unit}）` : ''}。`,
      qhtml: viewTrace(r.steps[0].view, input), dir: 'row',
      head: ['页号', '快表命中', '缺页', '物理地址', ...(input.cost ? ['用时'] : [])],
      rows: r.results.map((x) => ({ label: x.a, cells: [{ v: String(x.p), num: true }, { v: x.hit ? '√' : '', mark: true }, { v: x.fault ? '√' : '', mark: true }, { v: hexAlts(x.pa, input.pbits) }, ...(input.cost ? [{ v: num(x.time), num: true }] : [])] })),
    };
  },
  // 常见错法：缺页处理完没重新执行 / 以为重新执行时快表还没命中、查完页表没放进快表、没命中时没算查快表的时间、
  // 多级页表只算一次、换出了刚访问过的页（或按另一种置换算法换）；EAT 的再加：没命中时没算访存、Cache 没命中时没算查 Cache
  variants(input) {
    const list = [];
    const add = (mistake, label) => list.push({ label, input: { ...input, mistake } });
    const faults = input.kind === 'eat' ? !!input.rate.fault : [...input.table.values()].includes(null);
    if (faults && input.retry !== 'none') add('noRetry', '像是缺页处理完没有重新执行这条指令（要回到这条指令，再查快表、再访存）');
    if (faults && input.retry === 'tlb') add('retryMiss', '像是以为重新执行时快表还没命中（缺页处理时已经把这一项放进快表了）');
    if (input.kind === 'trace') add('noFill', '像是查完页表没把这一项放进快表（之后再访问这一页，快表就命中了）');
    if (!input.parallel) add('parallel', '像是快表没命中时没算查快表的时间（先查快表、没命中再查页表，两段时间都要算）');
    if (input.levels > 1) add('oneLevel', `像是查页表只算了一次访存（${input.levels} 级页表要访问 ${input.levels} 次内存）`);
    if (input.kind === 'trace') {
      add('mru', '像是换出了最近刚访问过的页（LRU 换出的是最久没访问的那一页，前面几次访问也要算进先后）');
      add(input.replace === 'lru' ? 'fifo' : 'lru', input.replace === 'lru' ? '像是按 FIFO（最早调入的）换的，这题是 LRU' : '像是按 LRU（最久没访问的）换的，这题是 FIFO');
    } else {
      add('missNoData', '像是快表没命中时只算了查页表，没算拿到块号以后再访存取数据');
      if (input.rate.cache !== undefined) add('cacheMiss', '像是 Cache 没命中时只算了访存，没算先查 Cache 的那一段');
    }
    let base;
    try { base = answersOf(input, run(input)); } catch { return []; }
    return list.filter((v) => { try { return answersOf(v.input, run(v.input)) !== base; } catch { return false; } });
  },
  problems(input, r) {
    if (input.kind === 'trace' && !r.results.some((x) => x.fault) && [...input.table.values()].includes(null)) return ['vaddr: 里的地址都没缺页：页表里写了不在内存的页却用不上'];
    return [];
  },
};
