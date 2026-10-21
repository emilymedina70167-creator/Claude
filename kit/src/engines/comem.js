// 组成原理的存储器扩展：memexp（位扩展、字扩展、字位同时扩展：要几片、片内地址线、片选、每组的地址范围）。
// 口径按王道：容量写成「字数 × 位数」（2K×4 位）；字扩展的组数 = 目标字数 / 芯片字数，位扩展每组片数 = 目标位数 / 芯片位数；
// 片内地址是低位，片选用紧挨着的高几位（译码器），再往上的地址线是固定的（由 base: 定）。纯函数（tests/comem-engine.test.js）。
import { esc } from './arrayview.js';

// 2K×4、8K×8 位、64K x 1、16Kx8bit → { words, bits }
export function parseCap(src, what) {
  const s = String(src ?? '').trim().replace(/\s+/g, '').replace(/[xX*]/g, '×').replace(/位|bit|b$/gi, '');
  const m = /^(\d+)([KMG]?)×(\d+)$/i.exec(s);
  if (!m) throw new Error(`${what}写成「字数 × 位数」，比如 2K×4、8K×8（现在是「${src}」）`);
  const words = Number(m[1]) * { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[m[2].toUpperCase()];
  return { words, bits: Number(m[3]), text: `${m[1]}${m[2].toUpperCase()}×${m[3]}` };
}
const lg = (n) => { const k = Math.log2(n); return Number.isInteger(k) ? k : null; };
const hex = (v, w) => `${v.toString(16).toUpperCase().padStart(Math.ceil(w / 4), '0')}H`;

function parse(fields) {
  const chip = parseCap(fields.chip, 'chip: ');
  const target = parseCap(fields.target ?? fields.memory, 'target: ');
  if (target.words % chip.words || target.bits % chip.bits) throw new Error(`target: ${target.text} 要是 chip: ${chip.text} 的整数倍（字数、位数各自整除）`);
  const lw = lg(chip.words), lt = lg(target.words);
  if (lw === null || lt === null) throw new Error('字数要是 2 的幂（1K、2K、4K……）');
  const start = fields.base !== undefined ? parseInt(String(fields.base).replace(/H$/i, ''), /H$/i.test(String(fields.base)) || /^0x/i.test(String(fields.base)) ? 16 : 10) : 0;
  const addr = fields.addr !== undefined ? Number(fields.addr) : lt;
  if (!(addr >= lt && addr <= 32)) throw new Error(`addr: CPU 的地址线条数，至少 ${lt}（目标 ${target.text} 要 ${lt} 位地址）`);
  if (start % target.words) throw new Error(`base: 起始地址要是 ${target.words} 的整数倍（按整块对齐），现在是 ${hex(start, addr)}`);
  return { chip, target, lw, lt, start, addr, groups: target.words / chip.words, per: target.bits / chip.bits, mistake: '' };
}

function run(input) {
  const { chip, target, lw, lt, groups, per, start, addr } = input;
  const steps = [];
  const total = groups * per;
  const kind = groups > 1 && per > 1 ? '字位同时扩展' : groups > 1 ? '字扩展' : per > 1 ? '位扩展' : '不用扩展';
  steps.push({ view: { stage: 0 }, msg: `用 ${chip.text} 位的芯片组成 ${target.text} 位的存储器。` });
  steps.push({ view: { stage: 1 }, msg: `字数：${target.words / 1024}K ÷ ${chip.words / 1024}K = ${groups}（要 ${groups} 组）；位数：${target.bits} ÷ ${chip.bits} = ${per}（每组 ${per} 片并在一起）。这是${kind}，一共 ${groups} × ${per} = ${groups * per} 片。`, ask: { tag: 'count', kind: 'number', q: '一共要几片芯片？', answer: total } });
  // 错法：片选按线选法数（一组一根线）；片内地址线写成了整个存储器的地址位数
  const csBits = input.mistake === 'cs' ? groups : lt - lw;
  const lines = input.mistake === 'lines' ? lt : lw;
  steps.push({ view: { stage: 2 }, msg: `每片 ${chip.words / 1024}K 个字：片内地址 ${lw} 位（A${lw - 1}～A0），各片的地址线、读写线都并在一起。`, ask: { tag: 'lines', kind: 'number', q: '片内地址线有几条？', answer: lines } });
  if (groups > 1) steps.push({ view: { stage: 3 }, msg: `${groups} 组要片选：用紧挨着的高 ${lt - lw} 位 A${lt - 1}～A${lw}，接一个 ${lt - lw}-${groups} 译码器，每个输出选一组。`, ask: { tag: 'cs', kind: 'number', q: '片选要用几位地址？', answer: csBits } });
  // 每组的地址范围（字地址）
  const ranges = Array.from({ length: groups }, (_, g) => {
    const lo = start + g * chip.words;
    const hi = lo + chip.words - (input.mistake === 'end' ? 0 : 1); // 错法：结束地址写成了下一组的起始
    return { g, lo, hi };
  });
  steps.push({ view: { stage: 4, ranges }, msg: `每组的地址范围：${ranges.map((r) => `第 ${r.g + 1} 组 ${hex(r.lo, addr)}～${hex(r.hi, addr)}`).join('，')}。${addr > lt ? `CPU 有 ${addr} 条地址线，最高的 ${addr - lt} 位（A${addr - 1}～A${lt}）固定为 ${(start >> lt).toString(2).padStart(addr - lt, '0')}，要和译码器的使能端接在一起。` : ''}`, ask: groups > 1 ? { tag: 'range', kind: 'text', q: `第 2 组的地址范围是？（写成「起始H～结束H」）`, answer: rangeAlts(ranges[1], addr) } : undefined });
  return { steps, total, ranges, csBits, lines, kind };
}
const rangeAlts = (r, addr) => {
  const a = hex(r.lo, addr), b = hex(r.hi, addr);
  return [`${a}～${b}`, `${a}~${b}`, `${a}-${b}`, `${a.slice(0, -1)}～${b.slice(0, -1)}`, `${a.slice(0, -1)}-${b.slice(0, -1)}`, `0x${a.slice(0, -1)}-0x${b.slice(0, -1)}`].join(' | ');
};

function view(s, input) {
  const { chip, target, lw, lt, groups, per, addr, start } = input;
  let h = `<div class="me-head"><span class="me-cap">${esc(chip.text)} 位 芯片</span><span class="me-arrow">→</span><span class="me-cap me-t">${esc(target.text)} 位 存储器</span></div>`;
  if (s.stage >= 1) {
    // 芯片阵列：一行一组（字扩展），一行里几片并排（位扩展）
    h += '<div class="me-grid">';
    for (let g = 0; g < groups; g++) {
      const r = s.ranges?.[g];
      h += `<div class="me-grp" data-cmd="${g + 1}" data-label="第 ${g + 1} 组">${s.stage >= 3 && groups > 1 ? `<span class="me-cs">Y${g}</span>` : ''}<div class="me-chips">${Array.from({ length: per }, (_, k) => `<div class="me-chip" data-key="c${g}-${k}"><b>${esc(chip.text)}</b><small>D${(k + 1) * chip.bits - 1}～D${k * chip.bits}</small></div>`).join('')}</div>${r ? `<span class="me-range">${hex(r.lo, addr)}～${hex(r.hi, addr)}</span>` : ''}</div>`;
    }
    h += '</div>';
  }
  if (s.stage >= 2) {
    const parts = [];
    if (addr > lt) parts.push({ name: '固定', from: addr - 1, to: lt, cls: 'me-fix', val: (start >> lt).toString(2).padStart(addr - lt, '0') });
    if (lt > lw) parts.push({ name: '片选', from: lt - 1, to: lw, cls: 'me-sel' });
    parts.push({ name: '片内', from: lw - 1, to: 0, cls: 'me-in' });
    h += `<div class="me-addr">${parts.map((p) => `<div class="me-a ${p.cls}"><span class="me-an">${p.name}</span><span class="me-ab">A${p.from}～A${p.to}</span><span class="me-av">${p.from - p.to + 1} 位${p.val ? `＝${p.val}` : ''}</span></div>`).join('')}</div>`;
  }
  return h;
}

export const memexpEngine = {
  name: 'memexp', title: '存储器扩展', parse, run, view,
  quiz(input, r) { return { q: '一共要几片芯片？', type: 'num', answer: String(r.total) }; },
  table(input, r) {
    return {
      q: '写出要几片、片内地址线几条、片选几位，和每组的地址范围（起始、结束，十六进制）。', qhtml: '', dir: 'row',
      head: ['起始地址', '结束地址'],
      rows: r.ranges.map((x) => ({ label: `第 ${x.g + 1} 组`, cells: [{ v: [hex(x.lo, input.addr), hex(x.lo, input.addr).slice(0, -1)] }, { v: [hex(x.hi, input.addr), hex(x.hi, input.addr).slice(0, -1)] }] })),
      extra: [{ label: '芯片数', v: String(r.total), num: true }, { label: '片内地址线', v: String(r.lines), num: true }, { label: '片选位数', v: String(r.csBits), num: true }],
    };
  },
  // 常见错法：片内地址线写成总地址位数；片选按线选法数；结束地址多了 1（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify([r.total, r.csBits, r.ranges.map((x) => [x.lo, x.hi]), r.steps.map((s) => s.ask?.answer)]);
    const right = sig(run(input));
    const out = [];
    for (const [m, label] of [['lines', '像是把整个存储器的地址位数当成了片内地址线（片内只看一片的字数：log₂(芯片字数)）'], ['cs', '像是按线选法数的片选（一组一根线）；用译码器只要 log₂(组数) 位'], ['end', '像是把结束地址写成了下一组的起始地址（结束地址 = 起始 + 芯片字数 − 1）']]) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};
