// 操作系统的内存管理：alloc（动态分区分配：首次 / 最佳 / 最坏 / 邻近适应，回收时和相邻的空闲区合并）。
// 口径按王道：在空闲区里从低地址开始分；最佳适应按空闲区从小到大找、最坏适应从大到小、邻近适应从上次分配的位置接着往后找（循环）。
// 回收时四种情况：和上邻接、和下邻接、上下都邻接（三块合成一块）、都不邻接（新的一块）。纯函数（tests/osmem-engine.test.js）。
import { esc } from './arrayview.js';
import { parseSize } from './bitview.js';

const ALGO = { first: '首次适应', best: '最佳适应', worst: '最坏适应', next: '邻近适应' };
const K = 1024;
const fmt = (b) => (b % K === 0 ? `${b / K}K` : `${b}B`);

function parse(fields) {
  const algo = String(fields.algo || 'first').trim().toLowerCase().replace(/[-_ ]?fit$/, '');
  if (!ALGO[algo]) throw new Error('algo: 写 first（首次适应）、best（最佳适应）、worst（最坏适应）或 next（邻近适应）');
  const total = parseSize(fields.memory ?? fields.size ?? '640K', 'memory: ');
  // 一开始的样子：不写就是整块空闲；used: OS 0 40K 表示 0 开始 40K 已经被 OS 占了
  const used = [];
  for (const part of String(fields.used ?? '').split(/[,，;；]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^(\S+)\s+(\S+)\s+(\S+)$/.exec(part);
    if (!m) throw new Error(`used: 写成「名字 起始地址 大小」，比如 used: OS 0 40K（现在是「${part}」）`);
    used.push({ name: m[1], start: parseSize(m[2], 'used: 起始地址'), size: parseSize(m[3], 'used: 大小') });
  }
  const ops = String(fields.ops ?? '').split(/[,，;；\n]/).map((x) => x.trim()).filter(Boolean).map((t) => {
    let m = /^(?:alloc|分配|申请)\s+(\S+)\s+(\S+)$/i.exec(t);
    if (m) return { kind: 'alloc', name: m[1], size: parseSize(m[2], `ops:「${t}」的大小`) };
    m = /^(?:free|释放|回收)\s+(\S+)$/i.exec(t);
    if (m) return { kind: 'free', name: m[1] };
    throw new Error(`ops: 看不懂「${t}」，写成 alloc A 130K、free A`);
  });
  if (!ops.length) throw new Error('alloc 要写 ops:（比如 ops: alloc A 130K, alloc B 60K, free A）');
  return { algo, total, used, ops, noMerge: false };
}

// 内存：按地址排好的一段段 { start, size, name（空闲的是 null） }
function initial(input) {
  const segs = [];
  let at = 0;
  for (const u of [...input.used].sort((a, b) => a.start - b.start)) {
    if (u.start > at) segs.push({ start: at, size: u.start - at, name: null });
    segs.push({ start: u.start, size: u.size, name: u.name, fixed: true });
    at = u.start + u.size;
  }
  if (at < input.total) segs.push({ start: at, size: input.total - at, name: null });
  return segs;
}
const holesOf = (segs) => segs.filter((s) => !s.name);

// 按算法挑空闲区：返回空闲区在 segs 里的下标（没有放得下的返回 -1）；同样大小的按地址小的先
function choose(segs, size, algo, nextFrom) {
  const holes = segs.map((s, i) => ({ s, i })).filter((x) => !x.s.name && x.s.size >= size);
  if (!holes.length) return -1;
  if (algo === 'best') return holes.sort((a, b) => a.s.size - b.s.size || a.s.start - b.s.start)[0].i;
  if (algo === 'worst') return holes.sort((a, b) => b.s.size - a.s.size || a.s.start - b.s.start)[0].i;
  if (algo === 'next') {
    const after = holes.find((x) => x.s.start >= nextFrom);
    return (after || holes[0]).i;
  }
  return holes[0].i;
}

function run(input) {
  let segs = initial(input);
  const steps = [];
  let nextFrom = 0;
  const log = [];
  const snap = (extra = {}) => ({ segs: segs.map((s) => ({ ...s })), ...extra });
  steps.push({ view: snap(), msg: `内存 ${fmt(input.total)}，用${ALGO[input.algo]}算法。空闲分区按${input.algo === 'best' ? '容量从小到大' : input.algo === 'worst' ? '容量从大到小' : '地址从低到高'}排：${holesOf(segs).map((h) => `${fmt(h.start)} 起 ${fmt(h.size)}`).join('；') || '没有'}。` });
  for (const op of input.ops) {
    if (op.kind === 'alloc') {
      if (segs.some((s) => s.name === op.name)) throw new Error(`ops: ${op.name} 已经分配过了，名字要不一样`);
      const i = choose(segs, op.size, input.algo, nextFrom);
      const order = holesOf(segs).filter((h) => h.size >= op.size);
      if (i < 0) {
        log.push({ op, start: null });
        steps.push({ view: snap({ cur: op.name }), msg: `${op.name} 要 ${fmt(op.size)}：没有放得下的空闲区，分配失败（等着，或者要紧凑）。`, ask: { tag: 'where', kind: 'choice', q: `${op.name} 申请 ${fmt(op.size)}：能分配吗？`, choices: ['能', '不能'], answer: '不能' } });
        continue;
      }
      const h = segs[i];
      const put = { start: h.start, size: op.size, name: op.name };
      const rest = h.size - op.size;
      const pickVal = String(h.start);
      segs.splice(i, 1, put, ...(rest ? [{ start: h.start + op.size, size: rest, name: null }] : []));
      nextFrom = put.start + put.size;
      log.push({ op, start: put.start });
      const why = input.algo === 'first' ? '从低地址找第一个放得下的' : input.algo === 'best' ? `放得下的里最小的（${order.map((x) => fmt(x.size)).join('、')} 里挑 ${fmt(h.size)}）` : input.algo === 'worst' ? `最大的空闲区（${fmt(h.size)}）` : '从上次分配结束的地方接着往后找第一个放得下的';
      steps.push({
        view: snap({ cur: op.name, chose: put.start }),
        msg: `${op.name} 要 ${fmt(op.size)}：${why}，就是 ${fmt(h.start)} 起的 ${fmt(h.size)}。从它的低地址分出 ${fmt(op.size)}（${fmt(put.start)}～${fmt(put.start + put.size)}）${rest ? `，剩下 ${fmt(rest)} 还是空闲区` : '，正好用完'}。`,
        ask: { tag: 'where', kind: 'pick', q: `${op.name} 申请 ${fmt(op.size)}：分在哪个空闲区？（点出来）`, answer: pickVal },
        asks: [{ tag: 'start', kind: 'text', q: `${op.name} 的起始地址是多少？`, answer: [fmt(put.start), String(put.start / K) + 'K', String(put.start)].join(' | ') }],
      });
    } else {
      const i = segs.findIndex((s) => s.name === op.name);
      if (i < 0) throw new Error(`ops: 「free ${op.name}」：${op.name} 没有分配过（或者分配失败了）`);
      const s = segs[i];
      const up = segs[i - 1] && !segs[i - 1].name, down = segs[i + 1] && !segs[i + 1].name;
      let kind;
      if (input.noMerge) { segs[i] = { ...s, name: null }; kind = '（没合并）'; } else if (up && down) {
        segs.splice(i - 1, 3, { start: segs[i - 1].start, size: segs[i - 1].size + s.size + segs[i + 1].size, name: null });
        kind = '上下都是空闲区：三块合成一块';
      } else if (up) {
        segs.splice(i - 1, 2, { start: segs[i - 1].start, size: segs[i - 1].size + s.size, name: null });
        kind = '前面（低地址）挨着空闲区：并进前面那块，起始地址不变、容量变大';
      } else if (down) {
        segs.splice(i, 2, { start: s.start, size: s.size + segs[i + 1].size, name: null });
        kind = '后面（高地址）挨着空闲区：和后面那块合并，起始地址改成回收区的';
      } else { segs[i] = { ...s, name: null }; kind = '前后都不是空闲区：自己成为一个新的空闲区'; }
      log.push({ op });
      const cnt = holesOf(segs).length;
      steps.push({
        view: snap({ freed: s.start }),
        msg: `回收 ${op.name}（${fmt(s.start)} 起 ${fmt(s.size)}）：${kind}。现在有 ${cnt} 个空闲区。`,
        ask: { tag: 'merge', kind: 'choice', q: `回收 ${op.name}：属于哪种情况？`, choices: ['和前面的空闲区合并', '和后面的空闲区合并', '和前后的空闲区合成一块', '不和别的合并'], answer: up && down ? '和前后的空闲区合成一块' : up ? '和前面的空闲区合并' : down ? '和后面的空闲区合并' : '不和别的合并' },
        asks: [{ tag: 'holes', kind: 'number', q: `回收 ${op.name} 以后有几个空闲区？`, answer: cnt }],
      });
    }
  }
  const holes = holesOf(segs);
  steps.push({ view: snap({ done: true }), msg: `最后的空闲分区：${holes.map((h) => `${fmt(h.start)} 起 ${fmt(h.size)}`).join('；') || '没有'}。最大的空闲区 ${holes.length ? fmt(Math.max(...holes.map((h) => h.size))) : '0'}。`, ask: { tag: 'max', kind: 'text', q: '最后最大的空闲区有多大？', answer: holes.length ? [fmt(Math.max(...holes.map((h) => h.size))), String(Math.max(...holes.map((h) => h.size)))].join(' | ') : '0' } });
  return { steps, log, holes };
}

// 一条横着的内存条：每段按大小占宽度（太小的也留最小宽度），占用的写名字、空闲的写容量；下面是空闲分区表
function view(s, input) {
  const total = input.total;
  const segs = s.segs;
  let h = '<div class="om-bar">';
  segs.forEach((g, i) => {
    const w = Math.max(6, (g.size / total) * 100);
    const cls = ['om-seg', g.name ? (g.fixed ? 'om-os' : 'om-used') : 'om-free', g.name && g.name === s.cur ? 'om-cur' : '', s.chose === g.start && g.name ? 'om-new' : '', s.freed !== undefined && !g.name && g.start <= s.freed && s.freed < g.start + g.size ? 'om-freed' : ''].filter(Boolean).join(' ');
    const pick = g.name ? '' : ` data-pick="${g.start}"`;
    h += `<div class="${cls}" style="flex: ${w} 1 0"${pick} data-cmd="${i + 1}" data-key="m${g.start}-${g.name || 'free'}"><span class="om-name">${esc(g.name || '空闲')}</span><span class="om-size">${fmt(g.size)}</span><span class="om-at">${fmt(g.start)}</span></div>`;
  });
  h += '</div>';
  const holes = holesOf(segs).slice();
  if (input.algo === 'best') holes.sort((a, b) => a.size - b.size || a.start - b.start);
  if (input.algo === 'worst') holes.sort((a, b) => b.size - a.size || a.start - b.start);
  h += `<table class="om-tab sv-tab"><thead><tr><th>空闲分区</th><th>起始地址</th><th>容量</th></tr></thead><tbody>${holes.map((x, k) => `<tr><td>${k + 1}</td><td>${fmt(x.start)}</td><td>${fmt(x.size)}</td></tr>`).join('') || '<tr><td colspan="3">没有空闲区</td></tr>'}</tbody></table>`;
  return h;
}

export const allocEngine = {
  name: 'alloc', title: '动态分区分配', parse, run, view,
  quiz(input, r) {
    return { q: '每次分配的起始地址依次是多少？（失败的写 ×，空格隔开）', type: 'seq', answer: r.log.filter((x) => x.op.kind === 'alloc').map((x) => (x.start === null ? '×' : fmt(x.start))).join(' ') };
  },
  table(input, r) {
    const rows = r.log.filter((x) => x.op.kind === 'alloc').map((x) => ({ label: `${x.op.name}（${fmt(x.op.size)}）`, cells: [{ v: x.start === null ? ['×', '失败', '不能'] : [fmt(x.start), String(x.start)] }] }));
    return { q: '每个作业分到的起始地址（分不到写 ×）。', qhtml: '', dir: 'row', head: ['起始地址'], rows };
  },
  // 常见错法：按别的算法找、回收时没和相邻的空闲区合并
  variants(input) {
    const sig = (r) => JSON.stringify([r.log.map((x) => x.start ?? 'x'), r.holes.map((h) => [h.start, h.size])]);
    const right = sig(run(input));
    const out = [];
    for (const a of Object.keys(ALGO)) if (a !== input.algo) { const v = { ...input, algo: a }; try { if (sig(run(v)) !== right) out.push({ label: `像是按${ALGO[a]}算法找的（这题是${ALGO[input.algo]}）`, input: v }); } catch { /* */ } }
    const nm = { ...input, noMerge: true };
    try { if (sig(run(nm)) !== right) out.push({ label: '像是回收时没有和相邻的空闲区合并（王道：上邻、下邻、上下都邻接都要合成一块）', input: nm }); } catch { /* */ }
    return out;
  },
};
