// 操作系统的文件存储空间管理：bitmap（位示图：盘块号 ↔ 字号、位号；分配前 k 个空闲块、回收；位示图存在磁盘上时在哪一块的哪个字节）。
// 口径按王道：一个二进制位对应一个盘块，0 表示空闲、1 表示已分配（idle: 1 换过来）；从第一个字开始一行行、每行从左往右扫。
// 编号从 0 还是从 1 数按题目来（base:），公式都写成一般的样子：
//   i = ⌊(b − b₀) ÷ n⌋ + i₀，j = (b − b₀) mod n + j₀；b = n × (i − i₀) + (j − j₀) + b₀（n 是一个字几位）。
//   全从 1 数就是王道 / 汤小丹书上的 b = n(i − 1) + j；全从 0 数是 b = n × i + j。
// 位示图存在磁盘上（at: 从第几号盘块开始存，block: 盘块大小）：一块放 block × 8 位，先找在第几块，再找块内第几个字节（字）、第几位。
// 2015 年统考选择题就是这种（盘块号 409612 → 第 82 号盘块、块内第 1 个字节）。纯函数（tests/osbitmap-engine.test.js）。
import { esc, chips } from './arrayview.js';
import { parseSize } from './bitview.js';
import { sizeText } from './osfile.js';

const nat = (src, what) => {
  const n = Number(String(src ?? '').trim());
  if (!Number.isInteger(n) || n < 0) throw new Error(`${what}写一个不小于 0 的整数（现在是「${src}」）`);
  return n;
};

// base: 0 / 1（字号、位号、盘块号都从几数），或者分开写 base: word=1 bit=1 block=0
function parseBase(src) {
  const s = String(src ?? '').trim();
  if (s === '' || s === '0') return { word: 0, bit: 0, block: 0 };
  if (s === '1') return { word: 1, bit: 1, block: 1 };
  const out = { word: 0, bit: 0, block: 0 };
  const NAMES = { word: 'word', 字: 'word', 字号: 'word', 行: 'word', bit: 'bit', 位: 'bit', 位号: 'bit', 列: 'bit', block: 'block', 块: 'block', 盘块: 'block', 盘块号: 'block' };
  const parts = [...s.matchAll(/([^\s=:：,，;；]+)\s*[=:：]\s*([01])/g)];
  if (!parts.length) throw new Error('base: 写 0（字号、位号、盘块号都从 0 数）、1（都从 1 数），或者分开写 base: word=1 bit=1 block=1');
  for (const m of parts) {
    const k = NAMES[m[1].toLowerCase()];
    if (!k) throw new Error(`base: 不认识「${m[1]}」（能写 word、bit、block）`);
    out[k] = Number(m[2]);
  }
  return out;
}

function parseOps(src) {
  const out = [];
  for (const t of String(src ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean)) {
    let m = /^(?:where|find|查|定位)\s+(\d+)$/i.exec(t);
    if (m) { out.push({ kind: 'where', b: Number(m[1]) }); continue; }
    m = /^(?:block|which|盘块号?|块号)\s+(\d+)\s+(\d+)$/i.exec(t);
    if (m) { out.push({ kind: 'which', i: Number(m[1]), j: Number(m[2]) }); continue; }
    m = /^(?:alloc|分配|申请)\s+(\d+)$/i.exec(t);
    if (m) { out.push({ kind: 'alloc', k: Number(m[1]) }); continue; }
    m = /^(?:free|回收|释放)\s+([\d\s]+)$/i.exec(t);
    if (m) { for (const b of m[1].trim().split(/\s+/)) out.push({ kind: 'free', b: Number(b) }); continue; }
    throw new Error(`ops: 看不懂「${t}」，写成 where 37（盘块号 → 字号、位号）、block 2 5（字号 位号 → 盘块号）、alloc 3（分配 3 块）、free 17（回收）`);
  }
  if (!out.length) throw new Error('bitmap 要写 ops:（比如 ops: where 37, alloc 3, free 17）');
  if (out.length > 8) throw new Error('ops: 最多 8 个');
  return out;
}

// 盘块号写法：37、37-40（一段）
function parseBlocks(src) {
  const out = [];
  for (const t of String(src ?? '').split(/[,，、;；\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:[-~～](\d+))?$/.exec(t);
    if (!m) throw new Error(`used: 写已分配的盘块号，几个用逗号、一段写 0-5（「${t}」不对）`);
    const a = Number(m[1]), b = m[2] !== undefined ? Number(m[2]) : a;
    if (b < a) throw new Error(`used: 「${t}」前面的数要小`);
    for (let x = a; x <= b; x++) out.push(x);
  }
  return out;
}

function parse(fields) {
  const base = parseBase(fields.base);
  const idleSrc = String(fields.idle ?? '0').trim() || '0';
  if (!/^[01]$/.test(idleSrc)) throw new Error('idle: 空闲的盘块用哪个位表示（0 或 1，默认 0）');
  const idle = Number(idleSrc);
  const ops = parseOps(fields.ops);
  const at = fields.at !== undefined && String(fields.at).trim() !== '' ? nat(fields.at, 'at: 位示图从第几号盘块开始存，') : null;
  let n = fields.word !== undefined && String(fields.word).trim() !== '' ? nat(fields.word, 'word: 一个字几位，') : null;
  let grid = null;
  if (at !== null) {
    // 位示图存在磁盘上：一块放 block × 8 位，块内按字节（或字）数
    const block = parseSize(fields.block ?? '', 'block: 盘块大小');
    if (n === null) n = 8;
    if (!(n >= 1 && n <= 64) || (block * 8) % n) throw new Error(`word: 一个字的位数要能整除一个盘块的位数（${block * 8}）`);
    for (const op of ops) if (op.kind === 'which' || op.kind === 'alloc') throw new Error('写了 at:（位示图存在磁盘上）时 ops: 只能用 where、free');
    for (const op of ops) if (op.b < base.block) throw new Error(`ops: 盘块号从 ${base.block} 数，${op.b} 不对`);
    return { base, idle, ops, at, block, n, grid, words: 0, mistake: '' };
  }
  if (fields.map !== undefined && String(fields.map).trim() !== '') {
    grid = String(fields.map).split(/[;；\n]+/).map((r) => r.replace(/[\s,，]+/g, '')).filter(Boolean).map((r, i) => {
      if (!/^[01]+$/.test(r)) throw new Error(`map: 第 ${i + 1} 行只能写 0 和 1（现在是「${r}」）`);
      return [...r].map(Number);
    });
    if (n === null) n = grid[0].length;
    for (const [i, r] of grid.entries()) if (r.length !== n) throw new Error(`map: 第 ${i + 1} 行有 ${r.length} 位，一个字是 ${n} 位：每行一样长`);
    if (fields.words !== undefined || fields.used !== undefined) throw new Error('写了 map: 就不用写 words:、used:');
  } else if (fields.words !== undefined && String(fields.words).trim() !== '') {
    const rows = nat(fields.words, 'words: 位示图有几个字（几行），');
    if (n === null) throw new Error('words: 要和 word:（一个字几位）一起写');
    if (rows < 1) throw new Error('words: 至少 1 行');
    grid = Array.from({ length: rows }, () => Array(n).fill(idle));
    for (const b of parseBlocks(fields.used)) {
      const x = b - base.block;
      if (x < 0 || x >= rows * n) throw new Error(`used: 盘块 ${b} 不在位示图里（盘块号从 ${base.block} 到 ${base.block + rows * n - 1}）`);
      grid[Math.floor(x / n)][x % n] = 1 - idle;
    }
  } else if (fields.used !== undefined) throw new Error('used: 要和 words:（位示图几行）一起写');
  if (n === null) throw new Error('bitmap 要写 word:（一个字几位，如 16），或者写 map: 直接给出位示图');
  if (n < 1 || n > 64) throw new Error('word: 写 1～64');
  if (grid && (grid.length > 32 || n > 32)) throw new Error('map: 位示图最多画 32 行 × 32 位（大的不用画：只写 word:，ops 照样能算）');
  const total = grid ? grid.length * n : Infinity;
  for (const op of ops) {
    if (op.kind === 'where' || op.kind === 'free') {
      if (op.b < base.block || op.b - base.block >= total) throw new Error(`ops: 盘块 ${op.b} 不在位示图里（盘块号从 ${base.block}${grid ? ` 到 ${base.block + total - 1}` : ' 数'}）`);
    } else if (op.kind === 'which') {
      if (op.i < base.word || (grid && op.i - base.word >= grid.length)) throw new Error(`ops: 字号 ${op.i} 不对（字号从 ${base.word} 数${grid ? `，一共 ${grid.length} 个字` : ''}）`);
      if (op.j < base.bit || op.j - base.bit >= n) throw new Error(`ops: 位号 ${op.j} 不对（一个字 ${n} 位，位号从 ${base.bit} 到 ${base.bit + n - 1}）`);
    } else if (op.kind === 'alloc') {
      if (!grid) throw new Error('ops: alloc 要先有位示图：写 map:，或者 words: 加 used:');
      if (op.k < 1 || op.k > 16) throw new Error('ops: alloc 写分配几块（1～16）');
    }
  }
  return { base, idle, ops, at: null, block: null, n, grid, words: grid ? grid.length : 0, mistake: '' };
}

// mistake（只在算常见错法时用）：
//   base     编号从 0 还是从 1 弄反了（三个一起换）
//   swap     商和余数弄反了（字号拿了余数、位号拿了商）
//   flip     把另一个值当成了空闲
//   byteBits 一个盘块按字节数当成了位数（忘了 × 8）
//   noAt     忘了加上位示图起始的盘块号
const rulesOf = (input) => {
  const m = input.mistake;
  const B = m === 'base' ? { word: 1 - input.base.word, bit: 1 - input.base.bit, block: 1 - input.base.block } : input.base;
  return { B, idle: m === 'flip' ? 1 - input.idle : input.idle, swap: m === 'swap' };
};

const noun = (input) => (input.at !== null && input.n === 8 ? '字节' : '字');

// 盘块号 → 第几字（块内第几字节）、第几位；at: 时再算在第几号盘块
export function locate(input, b) {
  const { B, swap } = rulesOf(input);
  const x = b - B.block;
  if (x < 0) throw new Error(`盘块号 ${b} 比起始编号 ${B.block} 小`);
  if (input.at !== null) {
    const bpb = input.mistake === 'byteBits' ? input.block : input.block * 8;
    const q = Math.floor(x / bpb), r = x % bpb;
    return { x, q, r, bpb, disk: (input.mistake === 'noAt' ? 0 : input.at) + q, i: Math.floor(r / input.n) + B.word, j: (r % input.n) + B.bit, row: null, col: r % input.n };
  }
  const n = input.n;
  const row = Math.floor(x / n), col = x % n;
  return { x, row, col, i: (swap ? col : row) + B.word, j: (swap ? row : col) + B.bit };
}

const formulaI = (input, b, w) => {
  const { B } = rulesOf(input);
  const n = input.n;
  return B.block === 0 && B.word === 0 ? `字号 i = ⌊${b} ÷ ${n}⌋ = ${w.i}` : `字号 i = ⌊(${b} − ${B.block}) ÷ ${n}⌋ + ${B.word} = ${w.i}`;
};
const formulaJ = (input, b, w) => {
  const { B } = rulesOf(input);
  const n = input.n;
  return B.block === 0 && B.bit === 0 ? `位号 j = ${b} mod ${n} = ${w.j}` : `位号 j = (${b} − ${B.block}) mod ${n} + ${B.bit} = ${w.j}`;
};

function run(input) {
  const { n, mistake } = input;
  const { B, idle } = rulesOf(input);
  const used = 1 - idle;
  const grid = input.grid ? input.grid.map((r) => r.slice()) : null;
  const steps = [];
  const log = [];
  const snap = (extra = {}) => ({ grid: grid ? grid.map((r) => r.slice()) : null, ...extra });
  const numText = `字号从 ${input.base.word}、位号从 ${input.base.bit}、盘块号从 ${input.base.block} 数`;
  const intro = input.at !== null
    ? `位示图存在磁盘上，从第 ${input.at} 号盘块开始存；一个盘块 ${sizeText(input.block)} = ${input.block * 8} 位，块内按${noun(input)}（${n} 位）编号；${numText}。${input.idle} 表示空闲。`
    : `位示图一个字 ${n} 位，一位对应一个盘块：${input.idle} 表示空闲，${1 - input.idle} 表示已分配；${numText}。${input.base.word === 1 && input.base.bit === 1 && input.base.block === 1 ? '盘块号 b = n(i − 1) + j。' : input.base.word === 0 && input.base.bit === 0 && input.base.block === 0 ? '盘块号 b = n × i + j。' : `盘块号 b = n × (i − ${input.base.word}) + (j − ${input.base.bit}) + ${input.base.block}。`}`;
  steps.push({ view: snap({ stage: 'start' }), msg: intro });
  const findSteps = (op, verb) => {
    const b = op.b;
    const w = locate(input, b);
    const what = verb === 'free' ? `回收盘块 ${b}` : `盘块 ${b}`;
    if (input.at !== null) {
      steps.push({ view: snap({ stage: 'disk', b, w }), msg: `${what}：一个盘块放 ${w.bpb} 位。${B.block ? `${b} − ${B.block} = ${w.x}，` : ''}${w.x} ÷ ${w.bpb} = ${w.q} 余 ${w.r}：在位示图的第 ${w.q} 块（从 0 数）。位示图从第 ${input.at} 号盘块开始存，所以是第 ${input.at} + ${w.q} = ${w.disk} 号盘块。`, ask: { tag: 'disk', kind: 'number', q: `${what} 对应的那一位，存在第几号盘块？`, answer: w.disk } });
      steps.push({ view: snap({ stage: 'word', b, w }), msg: `块内第 ${w.r} 位（从 0 数）：${w.r} ÷ ${n} = ${Math.floor(w.r / n)} 余 ${w.r % n}，是块内第 ${w.i} 个${noun(input)}${B.word ? '（从 1 数）' : '（从 0 数）'}。`, ask: { tag: 'word', kind: 'number', q: `${what}：在这个盘块里的第几个${noun(input)}？`, answer: w.i } });
      steps.push({ view: snap({ stage: 'bit', b, w }), msg: `${noun(input)}里的第 ${w.j} 位${B.bit ? '（从 1 数）' : '（从 0 数）'}：${w.r} mod ${n} = ${w.r % n}${B.bit ? ` + ${B.bit}` : ''}。${verb === 'free' ? `回收就是把这一位改成 ${idle}。` : ''}`, ask: { tag: 'bit', kind: 'number', q: `${what}：是这个${noun(input)}的第几位？`, answer: w.j } });
      return w;
    }
    steps.push({ view: snap({ stage: 'word', b, w }), msg: `${what}：${formulaI(input, b, w)}${mistake === 'swap' || (!B.block && !B.word) ? '' : `（${b - B.block} ÷ ${n} 的商${B.word ? '，再加 1' : ''}）`}。`, ask: { tag: 'word', kind: 'number', q: `${what} 在第几个字？（字号${input.base.word ? '从 1 数' : '从 0 数'}）`, answer: w.i } });
    let changed = null;
    if (verb === 'free' && grid && w.row < grid.length) {
      if (grid[w.row][w.col] === idle && !mistake) throw new Error(`ops: 盘块 ${b} 本来就是空闲的，不用回收`);
      grid[w.row][w.col] = idle;
      changed = [b];
    }
    steps.push({ view: snap({ stage: 'bit', b, w, changed }), msg: `${formulaJ(input, b, w)}${B.block || B.bit ? `（余数${B.bit ? '加 1' : ''}）` : ''}。${verb === 'free' ? `回收：把第 ${w.i} 字第 ${w.j} 位从 ${used} 改成 ${idle}。` : `盘块 ${b} 就是第 ${w.i} 字的第 ${w.j} 位。`}`, ask: { tag: 'bit', kind: 'number', q: `${what} 是这个字的第几位？（位号${input.base.bit ? '从 1 数' : '从 0 数'}）`, answer: w.j } });
    return w;
  };
  for (const op of input.ops) {
    if (op.kind === 'where' || op.kind === 'free') {
      const w = findSteps(op, op.kind);
      log.push({ op, w });
    } else if (op.kind === 'which') {
      const row = op.i - input.base.word, col = op.j - input.base.bit;
      const b = mistake === 'swap' ? n * col + row + B.block : n * (op.i - B.word) + (op.j - B.bit) + B.block;
      const f = B.block === 0 && B.word === 0 && B.bit === 0 ? `b = ${n} × ${op.i} + ${op.j} = ${b}` : `b = ${n} × (${op.i} − ${B.word}) + (${op.j} − ${B.bit}) + ${B.block} = ${b}`;
      steps.push({ view: snap({ stage: 'which', row, col, b }), msg: `第 ${op.i} 字第 ${op.j} 位：前面有 ${op.i - input.base.word} 个整字（每个 ${n} 位），再往后数 ${op.j - input.base.bit} 位。${f}。`, ask: { tag: 'block', kind: 'number', q: `第 ${op.i} 字第 ${op.j} 位对应哪个盘块？`, answer: b } });
      log.push({ op, b });
    } else {
      // 分配：从第一个字开始一行行扫，每行从左往右，找值是「空闲」的位
      const found = [];
      for (let r = 0; r < grid.length && found.length < op.k; r++) for (let c = 0; c < n && found.length < op.k; c++) if (grid[r][c] === idle) found.push({ r, c });
      if (found.length < op.k) {
        steps.push({ view: snap({ stage: 'alloc' }), msg: `要分配 ${op.k} 块，位示图里值是 ${idle} 的位只有 ${found.length} 个：不够分。` });
        log.push({ op, blocks: null });
        continue;
      }
      const blocks = found.map(({ r, c }) => n * r + c + input.base.block);
      const shown = found.map(({ r, c }) => n * (r + input.base.word - B.word) + (c + input.base.bit - B.bit) + B.block);
      for (const { r, c } of found) grid[r][c] = used;
      const pos = found.map(({ r, c }) => `第 ${r + input.base.word} 字第 ${c + input.base.bit} 位`);
      steps.push({ view: snap({ stage: 'alloc', changed: blocks }), msg: `分配 ${op.k} 块：从第一个字开始顺序扫，找值是 ${idle} 的位——${pos.join('、')}，把它们改成 ${used}。`, ask: { tag: 'alloc', kind: 'pick', q: `分配 ${op.k} 块：从头顺序扫，哪${op.k > 1 ? '几' : '一'}位会从 ${input.idle} 改成 ${1 - input.idle}？在位示图里点出来。`, ...(op.k > 1 ? { count: op.k, alts: [blocks.map(String)] } : { answer: String(blocks[0]) }) } });
      steps.push({ view: snap({ stage: 'blocks', marked: blocks }), msg: `换成盘块号：${found.map(({ r, c }, k) => `第 ${r + input.base.word} 字第 ${c + input.base.bit} 位 → ${shown[k]}`).join('，')}。`, ask: { tag: 'blocks', kind: 'text', q: `分到的盘块号依次是？（空格隔开）`, answer: shown.join(' ') } });
      log.push({ op, blocks: shown, found });
    }
  }
  return { steps, log };
}

// ================= 画面 =================
function gridView(s, input) {
  const { n, base } = input;
  const g = s.grid;
  const ch = new Set((s.changed || []).map(String));
  const mk = new Set((s.marked || []).map(String));
  let cmd = 0;
  let h = `<div class="sv-gtbl-wrap"><table class="sv-gtbl sv-tab bmp-grid${n > 16 ? ' bmp-dense' : ''}"><thead><tr><th class="bmp-corner">字＼位</th>${Array.from({ length: n }, (_, c) => `<th class="${(s.w && s.stage === 'bit' && s.w.col === c) || (s.stage === 'which' && s.col === c) ? 'bmp-hcur' : ''}">${c + base.bit}</th>`).join('')}</tr></thead><tbody>`;
  g.forEach((row, r) => {
    const rowOn = (s.w && (s.stage === 'word' || s.stage === 'bit') && s.w.row === r) || (s.stage === 'which' && s.row === r);
    h += `<tr><th class="${rowOn ? 'bmp-hcur' : ''}">${r + base.word}</th>`;
    row.forEach((v, c) => {
      const b = n * r + c + base.block;
      const cur = (s.w && s.stage === 'bit' && s.w.row === r && s.w.col === c) || (s.stage === 'which' && s.row === r && s.col === c);
      const cls = ['bmp-c', v === input.idle ? 'bmp-free' : 'bmp-used', cur ? 'bmp-cur' : '', ch.has(String(b)) ? 'bmp-chg sv-new' : '', mk.has(String(b)) ? 'bmp-chg' : '', rowOn && !cur ? 'bmp-row' : ''].filter(Boolean).join(' ');
      h += `<td class="${cls}" data-pick="${b}" data-cmd="${++cmd}" data-label="${b}" title="盘块 ${b}">${v}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table></div>';
}

// 没画整张位示图时：只画要找的那一个字（位的值不知道，写 ·；找到的那一位写 ?）。找到第几位以后才标出来
function wordStrip(s, input, { col, label }) {
  const { n, base } = input;
  const on = (c) => (s.stage === 'bit' || s.stage === 'which') && c === col;
  return `<div class="bmp-strip${n > 16 ? ' bmp-dense' : ''}"><div class="bmp-strip-h">${esc(label)}</div><div class="bmp-strip-row" style="--n:${n}">${Array.from({ length: n }, (_, c) => `<span class="bmp-c${on(c) ? ' bmp-cur' : ''}" data-cmd="${c + 1}" data-label="位${c + base.bit}">${on(c) ? '?' : '·'}</span>`).join('')}</div><div class="bmp-strip-row bmp-strip-idx" style="--n:${n}">${Array.from({ length: n }, (_, c) => `<span>${c + base.bit}</span>`).join('')}</div></div>`;
}

function view(s, input) {
  const { n } = input;
  let h = chips([['一个字', `${n} 位`], ['空闲', String(input.idle)], ['编号', input.base.word === input.base.bit && input.base.bit === input.base.block ? `都从 ${input.base.word} 数` : `字从 ${input.base.word}、位从 ${input.base.bit}、块从 ${input.base.block}`]]);
  if (input.at !== null) {
    // 位示图在磁盘上：起始块 → 第几号盘块 → 块内第几字节 → 第几位
    const w = s.w;
    const st = ['disk', 'word', 'bit'].indexOf(s.stage);
    const box = (k, name, small, i) => `<span class="bmp-box${st === k ? ' bmp-on' : st > k ? ' bmp-ok' : ''}" data-cmd="${i}" data-label="${esc(name)}">${esc(name)}<small>${esc(small)}</small></span>`;
    h += `<div class="bmp-path">${[
      box(-1, '位示图', `从盘块 ${input.at} 开始`, 1),
      box(0, w && st >= 0 ? `第 ${w.disk} 号盘块` : '哪一块？', w && st >= 0 ? `位示图的第 ${w.q} 块` : `一块 ${input.block * 8} 位`, 2),
      box(1, w && st >= 1 ? `第 ${w.i} 个${noun(input)}` : `哪个${noun(input)}？`, w && st >= 1 ? `块内第 ${w.r} 位所在` : `一个${noun(input)} ${n} 位`, 3),
      box(2, w && st >= 2 ? `第 ${w.j} 位` : '哪一位？', w ? `盘块 ${s.b}` : '', 4),
    ].join('<span class="bmp-arr" aria-hidden="true">→</span>')}</div>`;
    if (w && st >= 1) h += wordStrip(s, input, { col: w.col, label: `第 ${w.disk} 号盘块的第 ${w.i} 个${noun(input)}` });
    return h;
  }
  if (s.grid) return h + gridView(s, input);
  if (s.w) return h + wordStrip(s, input, { col: s.w.col, label: `第 ${s.w.i} 字（${n} 位）` });
  if (s.stage === 'which') return h + wordStrip(s, input, { col: s.col, label: `第 ${s.row + input.base.word} 字` });
  return h;
}

// 一个 run 里学生能答的（ask、quiz、填表）：错法算出来和对的一样就不列
function answersOf(input, r) {
  const asks = r.steps.map((s) => s.ask).filter(Boolean).map((a) => [a.q, String(a.alts ?? a.answer)]);
  let t = null;
  try { t = bitmapEngine.table(input, r); } catch { /* */ }
  return JSON.stringify([asks, t && t.rows.map((row) => row.cells.map((x) => x.v))]);
}

const baseText = (input) => (input.base.word === input.base.bit && input.base.bit === input.base.block ? `字号、位号、盘块号都从 ${input.base.word} 开始编号` : `字号从 ${input.base.word}、位号从 ${input.base.bit}、盘块号从 ${input.base.block} 开始编号`);

export const bitmapEngine = {
  name: 'bitmap', title: '位示图', parse, run, view,
  quiz(input, r) {
    const first = r.log[0];
    const op = first.op;
    const given = input.at !== null
      ? `位示图存在磁盘上，从第 ${input.at} 号盘块开始存，盘块大小 ${sizeText(input.block)}，${baseText(input)}（块内的${noun(input)}也是）。`
      : `位示图的字长是 ${input.n} 位，${input.idle} 表示空闲，${baseText(input)}。`;
    const qhtml = input.grid ? view(r.steps[0].view, input) : '';
    if (op.kind === 'which') return { q: `${given}第 ${op.i} 字第 ${op.j} 位对应的盘块号是多少？`, qhtml, type: 'num', answer: String(first.b) };
    if (op.kind === 'alloc') return { q: `${given}照下面的位示图分配 ${op.k} 个盘块，分到的盘块号依次是？（空格隔开${first.blocks ? '' : '；不够分写「不够」'}）`, qhtml, type: 'seq', answer: first.blocks ? first.blocks.join(' ') : '不够' };
    if (input.at !== null) return { q: `${given}${op.kind === 'free' ? '要释放' : ''}盘块 ${op.b} 在位示图里对应的位，在第几号盘块、块内第几个${noun(input)}？写成「盘块号 ${noun(input)}号」。`, type: 'seq', answer: `${first.w.disk} ${first.w.i}` };
    return { q: `${given}盘块 ${op.b} 对应第几字第几位？写成「字号 位号」。`, qhtml, type: 'seq', answer: `${first.w.i} ${first.w.j}` };
  },
  // 考卷上那张表：每个盘块的字号、位号、盘块号（给出的直接写上）；位示图在磁盘上时是盘块、块内第几字节、第几位
  table(input, r) {
    const rows = [];
    for (const x of r.log) {
      const op = x.op;
      if (input.at !== null) { rows.push({ label: `${op.kind === 'free' ? '回收' : '盘块'} ${op.b}`, cells: [{ v: String(x.w.disk), num: true }, { v: String(x.w.i), num: true }, { v: String(x.w.j), num: true }] }); continue; }
      if (op.kind === 'where' || op.kind === 'free') rows.push({ label: `${op.kind === 'free' ? '回收' : '盘块'} ${op.b}`, cells: [{ v: String(x.w.i), num: true }, { v: String(x.w.j), num: true }, { v: String(op.b), given: true }] });
      else if (op.kind === 'which') rows.push({ label: `第 ${op.i} 字第 ${op.j} 位`, cells: [{ v: String(op.i), given: true }, { v: String(op.j), given: true }, { v: String(x.b), num: true }] });
      else if (x.blocks) x.found.forEach(({ r: rr, c }, k) => rows.push({ label: `分配的第 ${k + 1} 块`, cells: [{ v: String(rr + input.base.word), num: true }, { v: String(c + input.base.bit), num: true }, { v: String(x.blocks[k]), num: true }] }));
    }
    if (!rows.length) return null;
    return {
      q: input.at !== null ? `写出每个盘块对应的位在第几号盘块、块内第几个${noun(input)}、第几位。` : '写出每一行的字号、位号和盘块号（给出的那一格不用填）。分配的按扫描的先后写。',
      qhtml: input.grid ? view(r.steps[0].view, input) : '', dir: 'row',
      head: input.at !== null ? ['盘块号', `块内${noun(input)}号`, '位号'] : ['字号', '位号', '盘块号'],
      rows,
    };
  },
  // 常见错法：编号从 0 还是从 1 弄反、商和余数弄反、把另一个值当成空闲；位示图在磁盘上时一块按字节数当成位数、忘了加起始盘块号
  variants(input) {
    const b = input.base;
    const all0 = !b.word && !b.bit && !b.block, all1 = b.word && b.bit && b.block;
    const list = [{ label: all0 ? '像是按从 1 编号的公式算了（这题字号、位号、盘块号都从 0 编号：b = n × i + j）' : all1 ? '像是按从 0 编号算了（这题都从 1 编号：b = n(i − 1) + j）' : '像是把从 0 还是从 1 编号弄错了', input: { ...input, mistake: 'base' } }];
    if (input.at !== null) {
      list.push({ label: `像是一个盘块按 ${input.block} 位算了（${sizeText(input.block)} = ${input.block} 字节 = ${input.block * 8} 位）`, input: { ...input, mistake: 'byteBits' } });
      list.push({ label: `像是忘了加上位示图起始的盘块号 ${input.at}`, input: { ...input, mistake: 'noAt' } });
    } else {
      list.push({ label: '像是把商和余数弄反了（字号是 (b − b₀) ÷ 每字位数的商，位号是余数）', input: { ...input, mistake: 'swap' } });
      if (input.ops.some((o) => o.kind === 'alloc')) list.push({ label: `像是把 ${1 - input.idle} 当成了空闲（这题 ${input.idle} 表示空闲）`, input: { ...input, mistake: 'flip' } });
    }
    let base;
    try { base = answersOf(input, run(input)); } catch { return []; }
    return list.filter((v) => { try { return answersOf(v.input, run(v.input)) !== base; } catch { return false; } });
  },
};
