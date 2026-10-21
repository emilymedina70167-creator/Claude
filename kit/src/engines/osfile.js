// 操作系统的文件物理结构：fileidx（混合索引：直接地址、一级 / 二级 / 三级间接）。
// 口径按王道：一个索引块能放 盘块大小 ÷ 地址项大小 个地址项（n）；k 级间接能指向 n^k 个块；逻辑块号从 0 数；
// 读某个字节：先算逻辑块号（字节号 ÷ 盘块大小，向下取整），看落在哪一级；inode 已经在内存里时访问磁盘 k 次（索引块）+ 1 次（数据块）。
// 纯函数（tests/osfile-engine.test.js）。
import { esc } from './arrayview.js';
import { parseSize } from './bitview.js';

const LEVELS = ['直接', '一级间接', '二级间接', '三级间接'];

// 字节数写得好看：16GB、64MB、256KB、10KB；除不尽的写 B
export function sizeText(bytes) {
  for (const [u, v] of [['GB', 1024 ** 3], ['MB', 1024 ** 2], ['KB', 1024]]) if (bytes >= v && bytes % v === 0) return `${bytes / v}${u}`;
  return `${bytes}B`;
}
const count = (src, what) => {
  const n = Number(String(src).trim());
  if (!Number.isInteger(n) || n < 0 || n > 64) throw new Error(`${what}写一个 0～64 的整数（现在是「${src}」）`);
  return n;
};
const list = (src) => String(src ?? '').split(/[,，、\s]+/).filter(Boolean);

function parse(fields) {
  const block = parseSize(fields.block ?? '1KB', 'block: 盘块大小');
  const entry = parseSize(fields.entry ?? '4B', 'entry: 地址项大小');
  if (block % entry) throw new Error(`block: ${sizeText(block)} 要是 entry: ${sizeText(entry)} 的整数倍`);
  const n = block / entry;
  const counts = [fields.direct ?? 10, fields.single ?? 1, fields.double ?? 1, fields.triple ?? 0].map((x, i) => count(x, `${['direct', 'single', 'double', 'triple'][i]}: `));
  if (!counts.some(Boolean)) throw new Error('direct: / single: / double: / triple: 至少有一个不是 0');
  // 每一级：一个地址项指向几个块、这一级一共几个块、逻辑块号从哪到哪
  let start = 0;
  const levels = counts.map((c, k) => {
    const per = n ** k;
    const lv = { k, name: LEVELS[k], count: c, per, blocks: c * per, start, end: start + c * per - 1 };
    start += lv.blocks;
    return lv;
  });
  const total = start;
  if (total > Number.MAX_SAFE_INTEGER / block) throw new Error('块太多了：把 block: 或 entry: 改小一点');
  const offsets = list(fields.offset).map((x) => ({ text: x, byte: parseSize(x, 'offset: 字节号') }));
  const blocknos = list(fields.blockno).map((x) => ({ text: x, lb: Number(x) }));
  for (const b of blocknos) if (!Number.isInteger(b.lb) || b.lb < 0) throw new Error(`blockno: 写逻辑块号（从 0 数的整数），「${b.text}」不对`);
  const reads = [...offsets.map((o) => ({ ...o, lb: Math.floor(o.byte / block) })), ...blocknos];
  if (reads.length > 4) throw new Error('offset: / blockno: 一共最多 4 个');
  for (const r of reads) if (r.lb >= total) throw new Error(`${r.byte !== undefined ? `字节 ${r.text}` : `逻辑块 ${r.text}`} 超出了最大文件长度（最多 ${total} 个块）`);
  const size = fields.size !== undefined ? parseSize(fields.size, 'size: 文件大小') : null;
  if (size !== null && Math.ceil(size / block) > total) throw new Error(`size: ${sizeText(size)} 超出了最大文件长度`);
  const inode = /^(disk|磁盘|不在内存)$/i.test(String(fields.inode ?? '').trim()) ? 'disk' : 'memory';
  return { block, entry, n, levels, total, reads, size, inode, mistake: '' };
}

// 逻辑块号 → 在哪一级、第几个地址项、每一级索引块里的第几项
export function locate(input, lb) {
  const lv = input.levels.find((l) => l.count && lb >= l.start && lb <= l.end);
  const rel = lb - lv.start;
  const ptr = Math.floor(rel / lv.per);
  const path = [];
  let r = rel % lv.per;
  for (let d = lv.k - 1; d >= 0; d--) { const p = input.n ** d; path.push(Math.floor(r / p)); r %= p; }
  return { lv, rel, ptr, path };
}

// 文件有 size 字节：数据块、各级用了几个索引块
function indexBlocks(input, size) {
  const data = Math.ceil(size / input.block);
  let left = data, idx = 0;
  const used = [];
  for (const lv of input.levels) {
    const take = Math.min(left, lv.blocks);
    left -= take;
    // k 级间接用 take 个数据块：每一层要的索引块数从下往上算
    let blocks = 0, need = take;
    for (let d = 0; d < lv.k; d++) { need = Math.ceil(need / input.n); blocks += need; }
    used.push({ lv, take, blocks });
    idx += blocks;
  }
  return { data, idx, used };
}

function run(input) {
  const { block, entry, n, levels, total, reads, size, mistake } = input;
  const steps = [];
  const active = levels.filter((l) => l.count);
  steps.push({ view: { stage: 0 }, msg: `盘块 ${sizeText(block)}，地址项 ${sizeText(entry)}；索引结点里有 ${active.map((l) => `${l.count} 个${l.name}地址项`).join('、')}。` });
  steps.push({ view: { stage: 1 }, msg: `一个索引块能放 ${sizeText(block)} ÷ ${sizeText(entry)} = ${n} 个地址项。`, ask: { tag: 'n', kind: 'number', q: '一个索引块能放几个地址项？', answer: n } });
  const parts = active.map((l) => `${l.name} ${l.count}${l.k ? ` × ${n}${l.k > 1 ? `^${l.k}` : ''}` : ''} = ${l.blocks} 块`);
  steps.push({ view: { stage: 2 }, msg: `每一级能指向的块：${parts.join('，')}。一共 ${total} 块，最大文件长度 ${active.map((l) => sizeText(l.blocks * block)).join(' + ')}${active.length > 1 ? ` = ${sizeText(total * block)}` : ''}。`, ask: { tag: 'max', kind: 'number', q: '一个文件最多能有几个盘块？', answer: total } });
  const results = [];
  for (const [i, r] of reads.entries()) {
    // 错法 one：逻辑块号从 1 数（直接地址管 1～10 号），按它找级别
    const where = locate(input, mistake === 'one' ? Math.max(0, r.lb - 1) : r.lb);
    const what = r.byte !== undefined ? `字节 ${r.text}` : `逻辑块 ${r.lb}`;
    if (r.byte !== undefined) steps.push({ view: { stage: 3, i, lb: r.lb }, msg: `${what}：逻辑块号 = ${r.byte} ÷ ${block}，向下取整 = ${r.lb}（从 0 数），块内偏移 ${r.byte % block}。`, ask: { tag: 'lblock', kind: 'number', q: `${what} 在第几号逻辑块？（从 0 数）`, answer: r.lb } });
    const real = locate(input, r.lb);
    const via = real.lv.k ? `：第 ${real.ptr + 1} 个${real.lv.name}地址项，${real.path.map((p, d) => `${d === 0 ? '' : '再'}在${['一', '二', '三'][d]}级索引块里是第 ${p} 项`).join('，')}` : `：第 ${r.lb - real.lv.start} 个直接地址项`;
    steps.push({ view: { stage: 4, i, lb: r.lb, where: real }, msg: `逻辑块 ${r.lb} 落在${real.lv.name}的范围（${real.lv.start}～${real.lv.end}）${via}。`, ask: { tag: 'level', kind: 'choice', q: `逻辑块 ${r.lb} 由哪一级地址项管？`, choices: active.map((l) => l.name), answer: where.lv.name } });
    const k = real.lv.k;
    const disk = (mistake === 'noData' ? k : k + 1) + (input.inode === 'disk' ? 1 : 0);
    steps.push({ view: { stage: 4, i, lb: r.lb, where: real, done: true }, msg: `读${what}：${input.inode === 'disk' ? '先读索引结点 1 次，' : '索引结点已经在内存里，'}${k ? `再读 ${k} 个索引块，` : ''}最后读数据块 1 次，一共访问磁盘 ${(k + 1) + (input.inode === 'disk' ? 1 : 0)} 次。`, ask: { tag: 'reads', kind: 'number', q: `读${what}要访问几次磁盘？${input.inode === 'disk' ? '（索引结点不在内存里）' : '（索引结点已经在内存里）'}`, answer: disk } });
    results.push({ lb: r.lb, level: real.lv.name, reads: (k + 1) + (input.inode === 'disk' ? 1 : 0) });
  }
  let used = null;
  if (size !== null) {
    used = indexBlocks(input, size);
    const parts2 = used.used.filter((u) => u.take).map((u) => `${u.lv.name}管 ${u.take} 块${u.blocks ? `，用 ${u.blocks} 个索引块` : ''}`);
    steps.push({ view: { stage: 5, used }, msg: `${sizeText(size)} 的文件：数据块 ⌈${size} ÷ ${block}⌉ = ${used.data} 个；${parts2.join('；')}。索引块一共 ${used.idx} 个。`, ask: { tag: 'idx', kind: 'number', q: `${sizeText(size)} 的文件要几个索引块（不算索引结点）？`, answer: used.idx } });
  }
  return { steps, total, results, used };
}

function view(s, input) {
  const { n, levels, block } = input;
  const active = levels.filter((l) => l.count);
  let h = `<table class="fi-tab sv-tab"><thead><tr><th>地址项</th><th>个数</th>${s.stage >= 2 ? '<th>能指向的块</th><th>逻辑块号</th>' : ''}</tr></thead><tbody>`;
  for (const l of active) {
    const on = s.where && s.where.lv.k === l.k ? ' class="fi-on"' : '';
    h += `<tr${on} data-cmd="${l.k + 1}" data-label="${l.name}"><td>${l.name}</td><td>${l.count}</td>${s.stage >= 2 ? `<td>${l.count}${l.k ? ` × ${n}${l.k > 1 ? `<sup>${l.k}</sup>` : ''}` : ''} = ${l.blocks}（${sizeText(l.blocks * block)}）</td><td>${l.start}～${l.end}</td>` : ''}</tr>`;
  }
  h += '</tbody></table>';
  if (s.stage >= 1) h += `<div class="fi-n">一个索引块 ${n} 项</div>`;
  if (s.where) {
    // 从索引结点一路指到数据块
    const w = s.where;
    const chain = [`<span class="fi-box">索引结点<small>${w.lv.k ? `第 ${w.ptr + 1} 个${w.lv.name}项` : `第 ${s.lb - w.lv.start} 个直接项`}</small></span>`];
    w.path.forEach((p, d) => chain.push(`<span class="fi-box fi-idx">${['一', '二', '三'][d]}级索引块<small>第 ${p} 项</small></span>`));
    chain.push(`<span class="fi-box fi-data">数据块<small>逻辑块 ${s.lb}</small></span>`);
    h += `<div class="fi-chain">${chain.join('<span class="fi-arr">→</span>')}</div>`;
  }
  if (s.used) h += `<div class="fi-n">数据块 ${s.used.data} 个，索引块 ${s.used.idx} 个</div>`;
  return h;
}

export const fileidxEngine = {
  name: 'fileidx', title: '混合索引', parse, run, view,
  quiz(input, r) {
    if (r.results.length) { const x = input.reads[0]; return { q: `盘块 ${sizeText(input.block)}，地址项 ${sizeText(input.entry)}，${input.levels.filter((l) => l.count).map((l) => `${l.count} 个${l.name}地址项`).join('、')}，索引结点${input.inode === 'disk' ? '不在' : '已经在'}内存里。读${x.byte !== undefined ? `字节 ${x.text}` : `逻辑块 ${x.lb}`}要访问几次磁盘？`, type: 'num', answer: String(r.results[0].reads) }; }
    return { q: `盘块 ${sizeText(input.block)}，地址项 ${sizeText(input.entry)}，${input.levels.filter((l) => l.count).map((l) => `${l.count} 个${l.name}地址项`).join('、')}。一个文件最多能有几个盘块？`, type: 'num', answer: String(r.total) };
  },
  // 考卷上那张表：每一级能指向几个块、逻辑块号范围；读的那几个字节在哪一级、访问几次磁盘
  table(input, r) {
    const active = input.levels.filter((l) => l.count);
    return {
      q: '把每一级地址项能指向的块数、管的逻辑块号范围填进表里。', qhtml: '', dir: 'row',
      head: ['能指向的块', '起始逻辑块号', '结束逻辑块号'],
      rows: active.map((l) => ({ label: l.name, cells: [{ v: String(l.blocks), num: true }, { v: String(l.start), num: true }, { v: String(l.end), num: true }] })),
      extra: [
        { label: '一个索引块几项', v: String(input.n), num: true },
        { label: '最多几个盘块', v: String(r.total), num: true },
        ...r.results.flatMap((x, i) => [{ label: `第 ${i + 1} 个：哪一级`, v: [x.level, x.level.replace('间接', '')] }, { label: `第 ${i + 1} 个：访问几次磁盘`, v: String(x.reads), num: true }]),
      ],
    };
  },
  // 常见错法：逻辑块号从 1 数（直接地址管 1～10）、访问次数没算最后读数据块那一次（和对的一样时不列）
  variants(input) {
    const sig = (r) => JSON.stringify(r.steps.map((s) => String(s.ask?.answer ?? '')));
    const right = sig(run(input));
    const out = [];
    for (const [m, label] of [['one', '像是逻辑块号从 1 数了（逻辑块号从 0 数：直接地址管 0～直接项数 − 1）'], ['noData', '像是只数了索引块，没算最后读数据块那一次']]) {
      const v = { ...input, mistake: m };
      try { if (sig(run(v)) !== right) out.push({ label, input: v }); } catch { /* */ }
    }
    return out;
  },
};
