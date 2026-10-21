// 操作系统的多级页表：pagetable（页内偏移几位、一页能放几个页表项、要几级、逻辑地址怎么拆、某个地址每一级的下标）。
// 口径按王道：每一级页表都要能放进一个页面（页面大小 ÷ 页表项大小 个项）；级数 = ⌈页号位数 ÷ 每级的位数⌉，
// 位数分不匀时最高一级（页目录）少几位。纯函数（tests/ospt-engine.test.js）。
import { esc } from './arrayview.js';
import { parseSize, parseNum, log2int, bitFields, hex } from './bitview.js';
import { sizeText } from './osfile.js';

function parse(fields) {
  const vbits = Number(fields.vbits ?? fields.bits);
  if (!Number.isInteger(vbits) || vbits < 8 || vbits > 64) throw new Error('vbits: 逻辑地址的位数（8～64）');
  const page = parseSize(fields.page ?? '4KB', 'page: 页面大小');
  const pte = parseSize(fields.pte ?? '4B', 'pte: 页表项大小');
  const off = log2int(page), lp = log2int(pte);
  if (off === null || lp === null) throw new Error('page: 和 pte: 都要是 2 的幂（4KB、4B……）');
  if (pte >= page) throw new Error('pte: 页表项要比页面小');
  if (off >= vbits) throw new Error(`页面 ${sizeText(page)} 要 ${off} 位偏移，逻辑地址只有 ${vbits} 位`);
  const vaddr = fields.vaddr !== undefined ? parseNum(fields.vaddr, 'vaddr: 逻辑地址') : null;
  if (vaddr !== null && vaddr >= 1n << BigInt(vbits)) throw new Error(`vaddr: ${fields.vaddr} 超出了 ${vbits} 位`);
  const pbits = fields.pbits !== undefined ? Number(fields.pbits) : null;
  if (pbits !== null && !(Number.isInteger(pbits) && pbits > off && pbits <= 64)) throw new Error(`pbits: 物理地址的位数（比页内偏移 ${off} 位多）`);
  const levels = fields.levels !== undefined ? Number(fields.levels) : null;
  if (levels !== null && !(Number.isInteger(levels) && levels >= 1 && levels <= 6)) throw new Error('levels: 写 1～6（不写就按「每级放进一页」算）');
  return { vbits, page, pte, off, per: off - lp, vaddr, pbits, levels, mistake: '' };
}

function run(input) {
  const { vbits, page, pte, off, vaddr, pbits, mistake } = input;
  const per = mistake === 'noPte' ? off : input.per; // 错法：一页能放的项数没除以页表项大小
  const vpn = vbits - off;
  const need = Math.ceil(vpn / per);
  const L = input.levels ?? (mistake === 'floor' ? Math.max(1, Math.floor(vpn / per)) : need);
  // 每一级的位数：从最低一级往上，每级 per 位，剩下的给最高一级（错法 topFull：最高一级给满，剩下的给最低一级）
  let widths;
  if (input.levels && input.levels !== need) {
    // 作者指定了级数：均分，余下的给最高一级
    const base = Math.floor(vpn / L);
    widths = Array(L).fill(base); widths[0] += vpn - base * L;
  } else {
    widths = Array(L).fill(per);
    const extra = vpn - per * L; // ≤ 0：最高一级少几位
    if (mistake === 'topFull') widths[L - 1] += extra; else widths[0] += extra;
    if (widths.some((w) => w <= 0)) widths = Array(L).fill(per).map((w, i) => (i === 0 ? vpn - per * (L - 1) : w));
  }
  const steps = [];
  const fields = () => [...widths.map((w, i) => ({ name: L === 1 ? '页号' : `${i === 0 && L > 1 ? '页目录号' : `第 ${i + 1} 级页号`}`, bits: w, cls: ['bv-a', 'bv-b', 'bv-d', 'bv-e', 'bv-a', 'bv-b'][i] })), { name: '页内偏移', bits: off, cls: 'bv-c' }];
  steps.push({ view: { stage: 0 }, msg: `逻辑地址 ${vbits} 位，页面 ${sizeText(page)}，页表项 ${sizeText(pte)}。` });
  steps.push({ view: { stage: 1 }, msg: `页面 ${sizeText(page)} = 2^${off} B：页内偏移 ${off} 位，剩下 ${vbits} − ${off} = ${vpn} 位是页号（一共 2^${vpn} 页）。`, ask: { tag: 'offset', kind: 'number', q: '页内偏移有几位？', answer: off } });
  const single = 2 ** vpn * pte;
  steps.push({ view: { stage: 2 }, msg: `一页能放 ${sizeText(page)} ÷ ${sizeText(pte)} = ${page / pte} = 2^${input.per} 个页表项，所以一级页表只能管 ${input.per} 位页号。只用一级页表要 2^${vpn} × ${sizeText(pte)} = ${sizeText(single)}，要连续占 ${single / page} 页，放不进一页。`, ask: { tag: 'per', kind: 'number', q: '一个页面能放几个页表项？', answer: mistake === 'noPte' ? page : page / pte } });
  if (input.levels) steps.push({ view: { stage: 3, widths, fields: fields() }, msg: `题目定了 ${L} 级页表：页号 ${vpn} 位分成 ${widths.join(' + ')}${L > need ? '' : ''}。${widths[0] > input.per ? `最高一级 ${widths[0]} 位，一页放不下（只能放 ${input.per} 位），要占 2^${widths[0] - input.per} 页。` : ''}`, ask: { tag: 'split', kind: 'number', q: '最高一级（页目录）的页号有几位？', answer: widths[0] } });
  else {
    steps.push({ view: { stage: 3, widths, fields: fields() }, msg: `每级 ${input.per} 位，${vpn} 位页号要 ⌈${vpn} ÷ ${input.per}⌉ = ${need} 级页表${need > 1 && vpn % input.per ? `；分不匀，最高一级（页目录）只有 ${vpn - input.per * (need - 1)} 位，其余每级 ${input.per} 位` : ''}。`, ask: { tag: 'levels', kind: 'number', q: '至少要几级页表？', answer: L } });
    if (L > 1) steps.push({ view: { stage: 3, widths, fields: fields(), hiTop: true }, msg: `逻辑地址从高到低：${fields().map((f) => `${f.name} ${f.bits} 位`).join(' | ')}。`, ask: { tag: 'split', kind: 'number', q: '最高一级（页目录号）有几位？', answer: widths[0] } });
  }
  let idx = null;
  if (vaddr !== null) {
    idx = [];
    let rest = vaddr >> BigInt(off);
    for (let i = L - 1; i >= 0; i--) { idx.unshift(Number(rest & ((1n << BigInt(widths[i])) - 1n))); rest >>= BigInt(widths[i]); }
    const d = vaddr & ((1n << BigInt(off)) - 1n);
    steps.push({ view: { stage: 4, widths, fields: fields(), idx, d }, msg: `逻辑地址 ${hex(vaddr, vbits)} 写成二进制按字段拆开：${fields().slice(0, -1).map((f, i) => `${f.name} ${idx[i]}`).join('，')}，页内偏移 ${d}（${hex(d, off)}）。`, ask: { tag: 'idx', kind: 'number', q: `${hex(vaddr, vbits)} 的${fields()[0].name}是多少？（十进制）`, answer: idx[0] } });
  }
  if (pbits !== null) {
    const fb = pbits - off;
    const minB = Math.ceil(fb / 8);
    steps.push({ view: { stage: 5, widths, fields: fields(), idx }, msg: `物理地址 ${pbits} 位，块号 ${pbits} − ${off} = ${fb} 位；页表项至少要放下块号：⌈${fb} ÷ 8⌉ = ${minB} 字节${minB <= pte ? `，${sizeText(pte)} 够用（多出来的位放有效位、保护位等）` : `，比 ${sizeText(pte)} 大，页表项放不下`}。`, ask: { tag: 'ptebytes', kind: 'number', q: '页表项至少要几个字节？', answer: minB } });
  }
  steps.push({ view: { stage: 6, widths, fields: fields(), idx, done: true }, msg: `${L} 级页表；逻辑地址 ${fields().map((f) => `${f.name} ${f.bits} 位`).join(' | ')}。访问一次内存里的数据，要先访问 ${L} 次内存查页表（没有快表时），一共 ${L + 1} 次。`, ask: { tag: 'mem', kind: 'number', q: '没有快表时，访问一次数据一共要访问几次内存？', answer: L + 1 } });
  return { steps, levels: L, widths, idx, vpn };
}

function view(s, input) {
  const { vbits, off } = input;
  if (s.stage === 0) return `<div class="pt-head">逻辑地址 ${vbits} 位</div>`;
  const f = s.fields ?? [{ name: s.stage >= 1 ? '页号' : '', bits: vbits - off, cls: 'bv-a' }, { name: '页内偏移', bits: off, cls: 'bv-c' }];
  if (input.vaddr !== null && s.stage >= 4) return `<div class="pt-head">逻辑地址 ${hex(input.vaddr, vbits)}</div>${bitFields(input.vaddr, f, { hi: [f[0].name] })}`;
  // 没给地址：按位数画一条（宽度按位数）
  return `<div class="pt-split">${f.map((x, i) => `<div class="pt-seg ${x.cls}${s.hiTop && i === 0 ? ' pt-hi' : ''}" style="flex:${x.bits}" data-cmd="${i + 1}" data-label="${esc(x.name)}"><b>${esc(x.name)}</b><small>${x.bits} 位</small></div>`).join('')}</div>${s.stage >= 2 ? `<div class="pt-note">一页放 ${input.page / input.pte} 个页表项（${input.per} 位）</div>` : ''}`;
}

export const pagetableEngine = {
  name: 'pagetable', title: '多级页表', parse, run, view,
  quiz(input, r) {
    return { q: `逻辑地址 ${input.vbits} 位，页面 ${sizeText(input.page)}，页表项 ${sizeText(input.pte)}，每一级页表都放进一个页面。至少要几级页表？`, type: 'num', answer: String(r.levels) };
  },
  // 考卷上那张表：逻辑地址每个字段几位（有地址时还有每一级的下标）
  table(input, r) {
    const names = r.widths.map((_, i) => (r.levels === 1 ? '页号' : i === 0 ? '页目录号' : `第 ${i + 1} 级页号`));
    return {
      q: '把逻辑地址每个字段的位数填进表里（给了地址的，再填它在这一级的下标）。', qhtml: '', dir: 'row',
      head: input.vaddr !== null ? ['位数', '下标'] : ['位数'],
      rows: [...names.map((n, i) => ({ label: n, cells: [{ v: String(r.widths[i]), num: true }, ...(input.vaddr !== null ? [{ v: String(r.idx[i]), num: true }] : [])] })), { label: '页内偏移', cells: [{ v: String(input.off), num: true }, ...(input.vaddr !== null ? [{ v: String(Number(input.vaddr & ((1n << BigInt(input.off)) - 1n))), num: true }] : [])] }],
      extra: [{ label: '几级页表', v: String(r.levels), num: true }],
    };
  },
  // 常见错法：一页的项数没除以页表项大小、级数向下取整、位数分不匀时让最低一级少几位（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify(r.steps.map((s) => String(s.ask?.answer ?? '')));
    const right = sig(run(input));
    const out = [];
    for (const [m, label] of [['noPte', '像是一页能放的页表项数没除以页表项大小（页面大小 ÷ 页表项大小）'], ['floor', '像是级数向下取整了（要能放下全部页号位：向上取整）'], ['topFull', '像是让最低一级少了几位（王道：位数分不匀时最高一级、页目录少几位）']]) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};
