// 分页存储的地址变换（组件 addr，操作系统）：逻辑地址拆成页号 | 页内偏移 → 查快表（可选）→ 查页表 → 物理块号 | 页内偏移。
// 可以给访存时间，算每个地址实际用了多久。纯函数，不碰 DOM（tests/addr-engine.test.js）。
import { bitFields, parseSize, parseNum, log2int, hex } from './bitview.js';
import { chips, esc } from './arrayview.js';

// 页表、快表：0->5, 1->2, 2->-（- 是不在内存）
function parseMap(src, what) {
  const map = new Map();
  for (const part of String(src ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\w+)\s*(?:->|→|:|：|=)\s*(\w+|-|—|无)$/.exec(part);
    if (!m) throw new Error(`${what}: 看不懂「${part}」，写成 0->5（页号 0 在第 5 块），不在内存写 2->-`);
    const p = Number(parseNum(m[1], `${what} 的页号`));
    const f = /^(-|—|无)$/.test(m[2]) ? null : Number(parseNum(m[2], `${what} 的块号`));
    map.set(p, f);
  }
  return map;
}

export function parse(fields) {
  if (!fields.vaddr) throw new Error('addr 要写 vaddr:（逻辑地址，几个用逗号，如 0x2A3C）');
  const addrs = String(fields.vaddr).split(/[,，、;；]+/).map((x) => x.trim()).filter(Boolean).map((x) => ({ text: x, v: parseNum(x, 'vaddr') }));
  if (addrs.length > 8) throw new Error('vaddr: 最多 8 个');
  const bits = Number(fields.bits);
  if (!Number.isInteger(bits) || bits < 4 || bits > 48) throw new Error('addr 要写 bits:（逻辑地址有几位，如 16）');
  const page = parseSize(fields.page, 'page:（页面大小）');
  const k = log2int(page);
  if (k === null) throw new Error('page: 页面大小要是 2 的整数次幂');
  if (k >= bits) throw new Error(`页面大小 2^${k} 比整个地址空间 2^${bits} 还大`);
  const table = parseMap(fields.table, 'table');
  if (!table.size) throw new Error('addr 要写 table:（页表：页号->块号，如 0->5, 1->2, 2->-）');
  const tlb = fields.tlb ? parseMap(fields.tlb, 'tlb') : null;
  if (tlb) for (const [p, f] of tlb) if (table.get(p) !== f) throw new Error(`tlb: 页 ${p} 在快表里是 ${f}，页表里是 ${table.get(p) ?? '没有'}，对不上`);
  for (const a of addrs) if (a.v >= 1n << BigInt(bits)) throw new Error(`vaddr: ${a.text} 超出了 ${bits} 位能表示的范围`);
  const pbits = fields.pbits ? Number(fields.pbits) : bits;
  if (!Number.isInteger(pbits) || pbits <= k) throw new Error('pbits: 物理地址的位数要比页内偏移多');
  let cost = null;
  if (fields.cost) {
    cost = {};
    for (const m of String(fields.cost).matchAll(/(tlb|mem|fault|快表|内存|缺页)\s*[=:：]?\s*(\d+(?:\.\d+)?)/gi)) cost[{ 快表: 'tlb', 内存: 'mem', 缺页: 'fault' }[m[1]] || m[1].toLowerCase()] = Number(m[2]);
    if (cost.mem === undefined) throw new Error('cost: 至少写访问一次内存的时间，如 cost: tlb=10 mem=100 fault=100000000（单位 ns）');
  }
  return { addrs, bits, page, k, table, tlb, pbits, cost };
}

export function run(input) {
  const { addrs, bits, page, k, table, tlb, pbits, cost } = input;
  const steps = [];
  const pb = bits - k;
  const results = [];
  steps.push({ view: { stage: 'start' }, msg: `逻辑地址 ${bits} 位，页面大小 ${page} B = 2^${k} B：低 ${k} 位是页内偏移，高 ${pb} 位是页号。${tlb ? '先查快表，快表里没有再查页表。' : ''}` });
  for (const a of addrs) {
    const p = Number(a.v >> BigInt(k));
    const d = a.v & ((1n << BigInt(k)) - 1n);
    const base = { a, p, d };
    steps.push({ view: { stage: 'split', ...base }, msg: `${a.text} 写成二进制，高 ${pb} 位是页号 ${p}，低 ${k} 位是页内偏移 ${d}（也就是 ${a.text} ÷ ${page} 的商和余数）。`, ask: { tag: 'page', kind: 'number', q: `逻辑地址 ${a.text} 的页号是多少？`, answer: p } });
    let time = 0;
    const tlbHit = tlb ? tlb.has(p) : false;
    if (tlb) {
      time += cost?.tlb || 0;
      steps.push({ view: { stage: 'tlb', ...base, hit: tlbHit }, msg: tlbHit ? `查快表：页 ${p} 在快表里，命中，直接得到块号 ${tlb.get(p)}（不用再查页表）。` : `查快表：页 ${p} 不在快表里，去查内存里的页表。`, ask: { tag: 'tlb', kind: 'choice', q: `页 ${p} 在快表里命中了吗？`, choices: ['命中', '没命中'], answer: tlbHit ? '命中' : '没命中' } });
    }
    let f;
    if (!tlbHit) {
      if (cost) time += cost.mem;
      if (!table.has(p)) {
        steps.push({ view: { stage: 'table', ...base, missing: true }, msg: `页表里没有页 ${p}（页号超出了页表的长度）：越界中断。`, ask: { tag: 'frame', kind: 'choice', q: `页 ${p} 能找到物理块吗？`, choices: ['能', '缺页', '越界'], answer: '越界' } });
        results.push({ a: a.text, error: '越界' });
        continue;
      }
      f = table.get(p);
      if (f === null) {
        if (cost?.fault) time += cost.fault;
        steps.push({ view: { stage: 'table', ...base, fault: true }, msg: `查页表：页 ${p} 不在内存里（这一项无效）：缺页中断，要先把这一页调进内存${cost?.fault ? `（缺页处理 ${cost.fault} ns）` : ''}。`, ask: { tag: 'frame', kind: 'choice', q: `页 ${p} 在内存里吗？`, choices: ['在', '缺页', '越界'], answer: '缺页' } });
        results.push({ a: a.text, fault: true, time: cost ? time : undefined });
        continue;
      }
      steps.push({ view: { stage: 'table', ...base, f }, msg: `查页表：页 ${p} → 物理块 ${f}。`, ask: { tag: 'frame', kind: 'number', q: `页 ${p} 在第几个物理块？`, answer: f } });
    } else f = tlb.get(p);
    const pa = (BigInt(f) << BigInt(k)) | d;
    if (cost) time += cost.mem;
    results.push({ a: a.text, pa, time: cost ? time : undefined });
    const timeText = cost ? `这一次一共用时 ${tlb ? `${cost.tlb || 0}（快表）+ ` : ''}${tlbHit ? '' : `${cost.mem}（页表）+ `}${cost.mem}（取数）= ${time} ns。` : '';
    steps.push({ view: { stage: 'phys', ...base, f, pa }, msg: `物理地址 = 块号 × 页面大小 + 页内偏移 = ${f} × ${page} + ${d} = ${pa}，就是把页号换成块号、页内偏移不变：${hex(pa, pbits)}。${timeText}`, ask: { tag: 'paddr', kind: 'hex', q: `${a.text} 对应的物理地址是多少？（写十六进制）`, answer: pa, display: hex(pa, pbits) } });
  }
  return { steps, results };
}

export function view(s, input) {
  const { bits, k, table, tlb, pbits } = input;
  const pb = bits - k;
  let h = '';
  if (s.a) h += `<div class="ad-row"><span class="ad-h">逻辑地址 ${esc(s.a.text)}</span>${bitFields((BigInt(s.p) << BigInt(k)) | s.d, [{ name: '页号', bits: pb, cls: 'bv-a' }, { name: '页内偏移', bits: k, cls: 'bv-c' }], { hi: s.stage === 'split' ? ['页号', '页内偏移'] : ['页号'] })}</div>`;
  const tblRows = [...table.entries()].sort((x, y) => x[0] - y[0]);
  const t = (title, rows, curP, cls) => `<div class="ad-tbl"><div class="ad-h">${title}</div><table class="sv-gtbl"><thead><tr><th>页号</th><th>块号</th></tr></thead><tbody>${rows.map(([p, f], i) => `<tr class="${p === curP ? cls : ''}"><td data-cmd="${i + 1}" data-pick="${p}">${p}</td><td>${f ?? '—（不在内存）'}</td></tr>`).join('')}</tbody></table></div>`;
  const showTlb = tlb && s.stage && s.stage !== 'start' && s.stage !== 'split';
  const showTable = s.stage === 'table' || s.stage === 'phys' || s.stage === 'start';
  h += '<div class="ad-tables">';
  if (tlb) h += t('快表', [...tlb.entries()], showTlb ? s.p : null, s.hit ? 'ad-hit' : 'ad-miss');
  h += t('页表', tblRows, showTable && !s.hit ? s.p : null, s.fault || s.missing ? 'ad-miss' : 'ad-hit');
  h += '</div>';
  if (s.stage === 'phys') h += `<div class="ad-row"><span class="ad-h">物理地址 ${hex(s.pa, pbits)}</span>${bitFields(s.pa, [{ name: '块号', bits: pbits - k, cls: 'bv-b' }, { name: '页内偏移', bits: k, cls: 'bv-c' }], { hi: ['块号'] })}</div>`;
  return h + chips(s.a ? [['页号', s.p], ['页内偏移', String(s.d)], ...(s.f !== undefined ? [['块号', s.f]] : [])] : []);
}

export const addrEngine = {
  name: 'addr',
  title: '地址变换',
  parse,
  run,
  view,
  quiz(input, r) {
    const a = r.results[0];
    const q = `逻辑地址 ${input.bits} 位，页面大小 ${input.page} B，页表是 ${[...input.table.entries()].map(([p, f]) => `${p}→${f ?? '不在内存'}`).join('，')}。逻辑地址 ${a.a} 对应的物理地址是多少？（写十六进制；缺页写「缺页」，越界写「越界」）`;
    if (a.pa === undefined) return { q, type: 'seq', answer: a.fault ? '缺页' : '越界' };
    return { q, type: 'hex', answer: `0x${a.pa.toString(16)}` };
  },
  // 考卷上那张表：每个逻辑地址的页号、页内偏移、物理块号、物理地址（十六进制；缺页、越界照写）
  table(input, r) {
    const hx = (v, w) => { const t = v.toString(16).toUpperCase(); return [t, `0x${t}`, `${t}H`, `0x${t.padStart(Math.ceil(w / 4), '0')}`, `${t.padStart(Math.ceil(w / 4), '0')}H`, t.padStart(Math.ceil(w / 4), '0')]; };
    return {
      q: `逻辑地址 ${input.bits} 位，页面大小 ${input.page} B。${input.tlb ? '快表、' : ''}页表见上面。写出每个逻辑地址的页号、页内偏移（十进制或十六进制都行）、物理块号和物理地址（十六进制；缺页写「缺页」，越界写「越界」）。`,
      qhtml: view({ stage: 'start' }, input),
      dir: 'row',
      head: ['页号', '页内偏移', '物理块号', '物理地址'],
      rows: input.addrs.map((a, i) => {
        const p = Number(a.v >> BigInt(input.k)), d = a.v & ((1n << BigInt(input.k)) - 1n);
        const res = r.results[i] || {};
        const f = res.pa !== undefined ? Number(res.pa >> BigInt(input.k)) : null;
        return { label: a.text, cells: [{ v: String(p), num: true }, { v: [String(d), ...hx(d, input.k)] }, { v: f === null ? (res.fault ? ['缺页', '-'] : ['越界', '-']) : String(f) }, { v: res.pa !== undefined ? hx(res.pa, input.pbits) : res.fault ? '缺页' : '越界' }] };
      }),
    };
  },
  // 常见错法：页面大小看错一档（页内偏移多拆 / 少拆了一位）
  variants(input) {
    const out = [];
    for (const dk of [1, -1]) {
      const k = input.k + dk;
      if (k < 1 || k >= input.bits) continue;
      out.push({ label: dk > 0 ? '像是页内偏移多拆了一位（页面大小看大了一倍）' : '像是页内偏移少拆了一位（页面大小看小了一半）', input: { ...input, k, page: 2 ** k } });
    }
    return out;
  },
};
