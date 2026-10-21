// 外部排序（组件 extsort）：败者树的建立和调整、置换-选择排序生成初始归并段、最佳归并树（k 叉哈夫曼树，补虚段）。
// 按王道 8.7 的口径：败者树的内部结点 ls[1]～ls[k−1] 记败者的段号，ls[0] 记冠军；关键字小的胜。
// 置换-选择：每次从工作区里比 MINIMAX 大的记录中选最小的输出，选不出来这一段就结束。
// 最佳归并树：(n − 1) % (k − 1) = u，u ≠ 0 时补 k − 1 − u 个长度为 0 的虚段；I/O 次数 = 2 × WPL。
// 纯函数，不碰 DOM（tests/extsort-engine.test.js）。
import { esc, chips } from './arrayview.js';
import { seqView } from './linearview.js';

const nums = (src, name, { inf = false } = {}) => {
  const t = String(src ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (!t.length) throw new Error(`${name}: 写一串整数，空格隔开`);
  return t.map((x) => {
    if (inf && /^(∞|inf|max|oo|无穷)$/i.test(x)) return Infinity;
    if (!/^-?\d+$/.test(x)) throw new Error(`${name}: 看不懂「${x}」（写整数${inf ? '，段读完了写 ∞' : ''}）`);
    return Number(x);
  });
};

export function parse(fields) {
  const has = (k) => fields[k] !== undefined && String(fields[k]).trim() !== '';
  const modes = ['loser', 'replace', 'merge'].filter(has);
  if (!modes.length) throw new Error('extsort 要写 loser:（败者树：各段当前的关键字）、replace:（置换-选择排序：输入文件）或 merge:（最佳归并树：各初始归并段的长度）中的一个');
  if (modes.length > 1) throw new Error(`extsort 一次演示一种，现在写了 ${modes.map((k) => `${k}:`).join('、')}`);
  const mode = modes[0];
  if (mode === 'loser') {
    const keys = nums(fields.loser, 'loser');
    if (keys.length < 2 || keys.length > 8) throw new Error('loser: 写 2～8 个关键字（k 路归并，每段当前的第一个）');
    const next = has('next') ? nums(fields.next, 'next', { inf: true }) : [];
    if (next.length > 8) throw new Error('next: 最多 8 个（调整 8 次）');
    return { mode, keys, next };
  }
  if (mode === 'replace') {
    const fi = nums(fields.replace, 'replace');
    if (fi.length > 30) throw new Error('replace: 最多 30 个记录');
    const w = Number(String(fields.work ?? '').trim());
    if (!Number.isInteger(w) || w < 2 || w > 8) throw new Error(`replace 要配 work:（工作区能放几个记录，2～8），现在是「${fields.work ?? ''}」`);
    if (w >= fi.length) throw new Error(`work: ${w} 不比记录数（${fi.length}）少，一次全装进工作区就只有一段了`);
    return { mode, fi, w };
  }
  const lens = nums(fields.merge, 'merge');
  if (lens.some((x) => x < 1)) throw new Error('merge: 归并段的长度要是正整数');
  if (lens.length < 2 || lens.length > 15) throw new Error('merge: 写 2～15 个初始归并段的长度');
  const k = has('k') ? Number(String(fields.k).trim()) : 2;
  if (!Number.isInteger(k) || k < 2 || k > 6) throw new Error(`k: 写几路归并（2～6），现在是「${fields.k}」`);
  return { mode, lens, k };
}

// ================= 败者树 =================
// 结点按位置编号：内部结点 1～k−1，叶子 b_i 在位置 k + i；位置 p 的孩子是 2p、2p+1，叶子 b_s 的双亲是 (s + k) / 2
// mistake：storeWinner 内部结点记了胜者（成了胜者树）；maxWins 把大的当成胜者
const kv = (b, i) => (b[i] === Infinity ? '∞' : String(b[i]));
const lab = (b, i) => `b${i}（${kv(b, i)}）`;
const beats = (b, x, y, mistake) => (mistake === 'maxWins' ? b[x] > b[y] || (b[x] === b[y] && x < y) : b[x] < b[y] || (b[x] === b[y] && x < y));

// 整棵树按比赛重新算一遍（建树；错法的「整棵树」也用它）：返回 ls（ls[0] 是冠军）
export function tournament(b, mistake) {
  const k = b.length;
  const win = {};
  const ls = Array(k).fill(null);
  const winOf = (p) => (p >= k ? p - k : win[p]);
  for (let t = k - 1; t >= 1; t--) {
    const x = winOf(2 * t), y = winOf(2 * t + 1);
    const w = beats(b, x, y, mistake) ? x : y, l = w === x ? y : x;
    win[t] = w;
    ls[t] = mistake === 'storeWinner' ? w : l;
  }
  ls[0] = win[1];
  return ls;
}

// 严蔚敏 / 王道的 Adjust(s)：从叶子 b_s 往上，和每个结点里的败者比，败者留下、胜者往上
export function adjust(b, ls, s) {
  const k = b.length;
  ls = ls.slice();
  for (let t = Math.floor((s + k) / 2); t > 0; t = Math.floor(t / 2)) if (beats(b, ls[t], s)) [s, ls[t]] = [ls[t], s];
  ls[0] = s;
  return ls;
}

function runLoser(input) {
  const { keys, next, mistake } = input;
  const k = keys.length;
  const steps = [];
  let b = keys.slice();
  let ls = Array(k).fill(null);
  const out = [];
  const phases = []; // 每建好 / 调整完一次的 ls（填表用）
  const v = (extra = {}) => ({ b: b.slice(), ls: ls.slice(), out: out.slice(), ...extra });
  steps.push({ view: v(), msg: `${k} 路归并的败者树：叶子 b0～b${k - 1} 是 ${k} 个归并段当前的第一个关键字。两两比赛，**关键字小的胜**：内部结点 ls[1]～ls[${k - 1}] 记下这一场的**败者**（段号），胜者往上接着比；最后的冠军记在 ls[0]。` });
  // —— 建树：从 ls[k−1] 往上 ——
  const win = {};
  const winOf = (p) => (p >= k ? p - k : win[p]);
  for (let t = k - 1; t >= 1; t--) {
    const x = winOf(2 * t), y = winOf(2 * t + 1);
    const w = beats(b, x, y, null) ? x : y, l = w === x ? y : x;
    // 按错法这一场记谁（学生看着的是正确的画面）
    const mw = beats(b, x, y, mistake === 'maxWins' ? 'maxWins' : null) ? x : y;
    const mine = mistake === 'storeWinner' ? w : mistake === 'maxWins' ? (mw === x ? y : x) : l;
    win[t] = w;
    ls[t] = l;
    steps.push({
      view: v({ cmp: [x, y], node: t, win: w }),
      msg: `ls[${t}]：${lab(b, x)}和${lab(b, y)}比，${kv(b, w)} 小，b${w} 胜出往上走；ls[${t}] 记下败者 **b${l}**。`,
      ask: { tag: 'loser', kind: 'choice', q: `建树：${lab(b, x)}和${lab(b, y)}比，ls[${t}] 里记谁？`, choices: [lab(b, x), lab(b, y)], answer: lab(b, mine) },
    });
  }
  ls[0] = win[1];
  phases.push(ls.slice());
  const champAsk = (q) => {
    const m = mistake === 'maxWins' ? b.reduce((a, x, i) => (b[i] > b[a] ? i : a), 0) : ls[0];
    return { tag: 'winner', kind: 'pick', q, answer: `b${m}`, display: lab(b, m) };
  };
  steps.push({ view: v({ champ: true }), msg: `建好了：冠军 b${ls[0]}（${kv(b, ls[0])}）记在 ls[0]，就是 ${k} 个关键字里最小的。`, ask: champAsk('建好以后，冠军（ls[0]）是哪一段？在叶子里点出来。') });
  // —— 调整：输出冠军，那一段换上下一个关键字，从它的叶子往上和败者比 ——
  next.forEach((nv, m) => {
    const s0 = ls[0];
    out.push(kv(b, s0));
    b[s0] = nv;
    steps.push({ view: v({ changed: s0 }), msg: `第 ${m + 1} 次：输出冠军 ${out.at(-1)}（段 ${s0}），b${s0} 换成这一段的下一个关键字 ${kv(b, s0)}${nv === Infinity ? '（这一段读完了，记成 ∞）' : ''}。从 b${s0} 往上，只和路上每个结点里的败者比。` });
    let s = s0;
    for (let t = Math.floor((s + k) / 2); t > 0; t = Math.floor(t / 2)) {
      const l0 = ls[t];
      const swap = beats(b, l0, s, null);
      const w = swap ? l0 : s, l = swap ? s : l0;
      const mw = beats(b, s, l0, mistake === 'maxWins' ? 'maxWins' : null) ? s : l0;
      const mine = mistake === 'storeWinner' ? w : mistake === 'maxWins' ? (mw === s ? l0 : s) : l;
      ls[t] = l;
      steps.push({
        view: v({ cmp: [s, l0], node: t, win: w }),
        msg: `ls[${t}]：b${s}（${kv(b, s)}）和 ls[${t}] 里的败者 b${l0}（${kv(b, l0)}）比，${kv(b, w)} 小：${swap ? `b${s} 输了留在 ls[${t}]，b${l0} 往上走` : `b${s} 赢了接着往上，ls[${t}] 还是 b${l0}`}。`,
        ask: { tag: 'loser', kind: 'choice', q: `第 ${m + 1} 次调整：b${s}（${kv(b, s)}）和 ls[${t}] 里的 b${l0}（${kv(b, l0)}）比，比完 ls[${t}] 记谁？`, choices: [lab(b, s), lab(b, l0)], answer: lab(b, mine) },
      });
      s = w;
    }
    ls[0] = s;
    phases.push(ls.slice());
    steps.push({ view: v({ champ: true }), msg: `新的冠军 b${s}（${kv(b, s)}）记在 ls[0]。这一次只比了 ${pathLen(s0, k)} 次：只走从 b${s0} 到根的那一条路，别的结点不用动。`, ask: champAsk(`第 ${m + 1} 次调整以后，新的冠军是哪一段？在叶子里点出来。`) });
  });
  // 整个过程按错法做出来的（填表、quiz 比这个）
  let mb = keys.slice();
  const mphases = [tournament(mb, mistake)];
  next.forEach((nv) => { const s0 = mphases.at(-1)[0]; mb = mb.slice(); mb[s0] = nv; mphases.push(mistake ? tournament(mb, mistake) : adjust(mb, mphases.at(-1), s0)); });
  return { steps, phases: mistake ? mphases : phases };
}
const pathLen = (s, k) => { let c = 0; for (let t = Math.floor((s + k) / 2); t > 0; t = Math.floor(t / 2)) c++; return c; };

// 画法：按中序排横坐标、按层排纵坐标；ls[0] 画在 ls[1] 正上方
function loserSvg(s, input) {
  const k = input.keys.length;
  const GAP = 44, LEVEL = 66, TOP = 54;
  const order = [];
  const walk = (p) => { if (p >= 2 * k) return; if (p < k) walk(2 * p); order.push(p); if (p < k) walk(2 * p + 1); };
  walk(1);
  const X = {}; order.forEach((p, i) => { X[p] = (i + 1) * GAP; });
  const depth = (p) => Math.floor(Math.log2(p));
  const Y = (p) => TOP + depth(p) * LEVEL + 22;
  const maxD = Math.max(...order.map(depth));
  const W = (order.length + 1) * GAP, H = TOP + maxD * LEVEL + 22 + 46;
  const cmp = new Set((s.cmp || []).map((x) => `b${x}`));
  const cls = (base, extra) => [base, ...extra].filter(Boolean).join(' ');
  let edges = `<line class="sv-edge" x1="${X[1]}" y1="${22}" x2="${X[1]}" y2="${Y(1)}"/>`;
  for (let t = 1; t < k; t++) for (const c of [2 * t, 2 * t + 1]) edges += `<line class="sv-edge" x1="${X[t]}" y1="${Y(t)}" x2="${X[c]}" y2="${Y(c)}"/>`;
  let nodes = '';
  // 内部结点：方块，上面一行小字 ls[t]，下面是记的段号和它的关键字
  const inner = (t, seg, x, y, extra) => {
    const has = seg !== null && seg !== undefined;
    return `<g class="${cls('ln-tn', extra)}" data-cmd="${k + t + 1}" data-label="ls[${t}]" data-key="ls${t}"><rect x="${x - 25}" y="${y - 19}" width="50" height="38" rx="8"/><text class="ln-tn-h" x="${x}" y="${y - 8}">ls[${t}]</text><text class="ln-tn-v" x="${x}" y="${y + 9}">${has ? `b${seg} · ${kv(s.b, seg)}` : '?'}</text></g>`;
  };
  nodes += inner(0, s.ls[0], X[1], 22, ['ln-champ', s.champ ? 'sv-new' : '']);
  for (let t = 1; t < k; t++) nodes += inner(t, s.ls[t], X[t], Y(t), [s.node === t ? 'sv-cmp' : '', s.node === t && s.ls[t] !== null ? 'sv-new' : '']);
  for (let i = 0; i < k; i++) {
    const p = k + i, x = X[p], y = Y(p);
    const on = cmp.has(`b${i}`), isWin = s.win === i, champ = s.champ && s.ls[0] === i;
    nodes += `<g class="${cls('ln-leaf', [on ? 'sv-cmp' : '', isWin ? 'ln-win' : '', champ ? 'ln-win' : '', s.changed === i ? 'sv-new' : ''])}" data-pick="b${i}" data-cmd="${i + 1}" data-label="b${i}" data-key="leaf${i}"><rect x="${x - 20}" y="${y - 15}" width="40" height="30" rx="6"/><text class="ln-leaf-v" x="${x}" y="${y}">${esc(kv(s.b, i))}</text><text class="ln-leaf-n" x="${x}" y="${y + 28}">b${i}</text></g>`;
  }
  return `<svg class="sv-tree ln-loser" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="败者树">${edges}${nodes}</svg>`;
}

// ================= 置换-选择排序 =================
// mistake：outSmaller 比 MINIMAX 小的也输出了（每次都输出工作区里最小的）；chunk 当成每次读满工作区、排好输出一段
function runReplace(input) {
  const { fi, w, mistake } = input;
  const steps = [];
  let p = 0; // FI 读到第几个
  const wa = Array(w).fill(null); // { v, i }
  const runs = [[]];
  let minimax = null;
  const v = (extra = {}) => ({ p, wa: wa.slice(), runs: runs.map((r) => r.slice()), minimax, ...extra });
  steps.push({ view: v(), msg: `输入文件 FI 有 ${fi.length} 个记录，工作区 WA 能放 ${w} 个。置换-选择：先读 ${w} 个进 WA；从 WA 里选出**比 MINIMAX 大的记录中最小的**，作为新的 MINIMAX 输出到当前归并段，再从 FI 读一个补进 WA；选不出来（WA 里都比 MINIMAX 小），这一段就结束，开始下一段。` });
  for (let s = 0; s < w; s++) wa[s] = { v: fi[p], i: p++ };
  const allRuns = replaceRuns(fi, w, null);
  const mineRuns = mistake ? (mistake === 'chunk' ? chunkRuns(fi, w) : replaceRuns(fi, w, mistake)) : allRuns;
  steps.push({ view: v({ fresh: wa.map((x) => x.i) }), msg: `从 FI 读 ${w} 个记录进 WA：${wa.map((x) => x.v).join('、')}。`, ask: { tag: 'runs', kind: 'number', q: '先猜：一共会得到几个初始归并段？', answer: mineRuns.length } });
  const choicesOf = () => [...new Set(wa.filter(Boolean).map((x) => x.v))].sort((a, b) => a - b).map(String).concat(['这一段结束']);
  while (wa.some(Boolean)) {
    const live = wa.map((x, s) => (x && (minimax === null || x.v >= minimax) ? s : -1)).filter((s) => s >= 0);
    const choices = choicesOf();
    // 按错法这一步会怎么做（在正确的画面上）
    const mineOut = mistake === 'outSmaller' ? String(Math.min(...wa.filter(Boolean).map((x) => x.v))) : null;
    const q = `${minimax === null ? `开始第 ${runs.length} 段` : `MINIMAX = ${minimax}`}：工作区里是 ${wa.filter(Boolean).map((x) => x.v).join('、')}，下一步输出谁？`;
    if (!live.length) {
      steps.push({ view: v({ frozen: true }), msg: `WA 里的 ${wa.filter(Boolean).map((x) => x.v).join('、')} 都比 MINIMAX = ${minimax} 小，选不出来：**第 ${runs.length} 段结束**（${runs.at(-1).map((y) => y.v).join(' ')}）。开始第 ${runs.length + 1} 段，MINIMAX 清空。`, ...(mistake === 'chunk' ? {} : { ask: { tag: 'out', kind: 'choice', q, choices, answer: mineOut ?? '这一段结束' } }) });
      runs.push([]);
      minimax = null;
      continue;
    }
    const s = live.reduce((a, x) => (wa[x].v < wa[a].v ? x : a), live[0]);
    const x = wa[s];
    const smaller = wa.filter((y) => y && minimax !== null && y.v < minimax).map((y) => y.v);
    minimax = x.v;
    runs.at(-1).push(x);
    const read = p < fi.length ? { v: fi[p], i: p++ } : null;
    wa[s] = read;
    steps.push({
      view: v({ out: x.i, fresh: read ? [read.i] : [] }),
      msg: `${smaller.length ? `${smaller.join('、')} 比 MINIMAX 小，留给下一段；` : ''}比 MINIMAX 大的里面最小的是 ${x.v}：MINIMAX = ${x.v}，输出到第 ${runs.length} 段。${read ? `从 FI 读入 ${read.v} 补进 WA。` : 'FI 已经读完了，不再补。'}`,
      ...(mistake === 'chunk' ? {} : { ask: { tag: 'out', kind: 'choice', q, choices, answer: mineOut ?? String(x.v) } }),
    });
  }
  steps.push({ view: v({ done: true }), msg: `FI 读完、WA 也空了：一共 **${runs.length}** 个初始归并段。${runs.map((r, k) => `第 ${k + 1} 段长 ${r.length}`).join('，')}（平均比工作区大，所以归并段少、归并趟数少）。` });
  return { steps, runs: mineRuns };
}
// 只算出各段（错法、quiz 用）
export function replaceRuns(fi, w, mistake) {
  const wa = fi.slice(0, w), runs = [[]];
  let p = w, minimax = null;
  while (wa.length) {
    const live = mistake === 'outSmaller' ? wa.slice() : wa.filter((x) => minimax === null || x >= minimax);
    if (!live.length) { runs.push([]); minimax = null; continue; }
    const x = Math.min(...live);
    wa.splice(wa.indexOf(x), 1);
    minimax = x;
    runs.at(-1).push(x);
    if (p < fi.length) wa.push(fi[p++]);
  }
  return runs;
}
const chunkRuns = (fi, w) => { const out = []; for (let i = 0; i < fi.length; i += w) out.push(fi.slice(i, i + w).sort((a, b) => a - b)); return out; };

function replaceView(s, input) {
  const { fi } = input;
  const rest = fi.slice(s.p).map((x, k) => ({ text: String(x), key: `r${s.p + k}`, cls: 'ln-in' }));
  const fresh = new Set(s.fresh || []);
  const wa = s.wa.map((x, k) => (x ? `<div class="ln-cell${s.minimax !== null && x.v < s.minimax ? ' ln-frozen' : ''}${fresh.has(x.i) ? ' sv-new' : ''}" data-key="r${x.i}" data-cmd="${k + 1}" data-label="${x.v}">${x.v}</div>` : `<div class="ln-cell ln-hole" data-cmd="${k + 1}"></div>`)).join('');
  const runsHtml = s.runs.map((r, k) => seqView(r.map((x) => ({ text: String(x.v), key: `r${x.i}`, cls: s.out === x.i ? 'sv-new ln-ok' : '' })), { label: `第 ${k + 1} 段`, empty: '（还没有）', cls: k === s.runs.length - 1 && !s.done ? 'ln-cur' : '' })).join('');
  return `${seqView(rest, { label: 'FI（输入）', empty: '（读完了）' })}
    <div class="ln-seq"><div class="ln-h">WA（工作区）</div><div class="ln-seq-row ln-wa">${wa}</div></div>
    ${chips([['MINIMAX', s.minimax ?? '—'], ...(s.frozen ? [['这一段', '结束']] : [])])}
    <div class="ln-fo"><div class="ln-h ln-fo-h">FO（输出的归并段）</div>${runsHtml}</div>`;
}

// ================= 最佳归并树 =================
// mistake：noVirtual 没补虚段；virtualN 用 n % (k − 1) 算虚段数；ioOnce I/O 次数只算了一遍 WPL
export function virtualCount(n, k, mistake) {
  if (mistake === 'noVirtual') return 0;
  const u = mistake === 'virtualN' ? n % (k - 1) : (n - 1) % (k - 1);
  return u === 0 ? 0 : k - 1 - u;
}
// k 叉哈夫曼：每次合并最小的 k 个（一样长时虚段先合、再按编号）；最后一次不够 k 个时就合剩下的（只有没补虚段时才会）。
// 画面上的顺序（order）尽量不动：一开始按长度从小到大排，合成的新结点放在被合的那几个里最左边的位置，
// 孩子也按画面上的先后排——这样换步时只有被合的那几棵往一起挪，别的树不跳来跳去
export function huffman(lens, k, virt) {
  const nodes = [];
  lens.forEach((v, i) => nodes.push({ id: i, v, kids: [], leaf: true }));
  for (let i = 0; i < virt; i++) nodes.push({ id: nodes.length, v: 0, kids: [], leaf: true, virtual: true });
  const key = (id) => [nodes[id].v, nodes[id].virtual ? 0 : 1, id];
  const cmp = (a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  let order = nodes.map((x) => x.id).sort(cmp);
  const start = order.slice();
  const merges = [];
  while (order.length > 1) {
    const take = order.slice().sort(cmp).slice(0, Math.min(k, order.length));
    const kids = order.filter((x) => take.includes(x));
    const id = nodes.length;
    nodes.push({ id, v: take.reduce((s, x) => s + nodes[x].v, 0), kids, leaf: false });
    const before = order.slice();
    const at = order.indexOf(kids[0]);
    order = order.filter((x) => !take.includes(x));
    order.splice(at, 0, id);
    merges.push({ take: kids, id, before, after: order.slice() });
  }
  const wpl = nodes.filter((x) => !x.leaf).reduce((s, x) => s + x.v, 0);
  const height = (id) => (nodes[id].kids.length ? 1 + Math.max(...nodes[id].kids.map(height)) : 0);
  return { nodes, merges, wpl, root: order[0], start, R: height(order[0]) };
}

function runMerge(input) {
  const { lens, k, mistake } = input;
  const n = lens.length;
  const virt = virtualCount(n, k, null);
  const T = huffman(lens, k, virt);
  const mv = virtualCount(n, k, mistake);
  const M = mistake && mistake !== 'ioOnce' ? huffman(lens, k, mv) : T;
  const io = mistake === 'ioOnce' ? M.wpl : 2 * M.wpl;
  const steps = [];
  const leafIds = T.start.filter((x) => !T.nodes[x].virtual);
  const u = (n - 1) % (k - 1);
  steps.push({ view: { roots: leafIds, nodes: T.nodes, R: T.R }, msg: `${n} 个初始归并段，长度（记录数）是 ${lens.join('、')}，做 ${k} 路归并。最佳归并树就是 ${k} 叉哈夫曼树：每次把最短的 ${k} 段归并成一段，让长的段少参加几趟归并。` });
  steps.push({
    view: { roots: T.start, nodes: T.nodes, R: T.R, fresh: Array.from({ length: virt }, (_, i) => n + i) },
    msg: `先看要不要补虚段：严格 ${k} 叉树要求 (n − 1) % (k − 1) = 0。这里 (${n} − 1) % (${k} − 1) = ${u}，${u === 0 ? '正好为 0，不用补。' : `不为 0，要补 ${k} − 1 − ${u} = **${virt}** 个长度为 0 的虚段（虚线框），它们最先被合并。`}`,
    ask: { tag: 'virtual', kind: 'number', q: `${n} 个初始归并段做 ${k} 路归并，要补几个虚段？`, answer: mv },
  });
  T.merges.forEach((m, j) => {
    const after = m.after;
    const combos = pickAlts(m.before, m.take, T.nodes);
    steps.push({
      view: { roots: after, nodes: T.nodes, R: T.R, took: m.take, fresh: [m.id] },
      msg: `第 ${j + 1} 次：最短的 ${m.take.length} 段是 ${m.take.map((x) => T.nodes[x].v).sort((a, b) => a - b).join('、')}，归并成长 ${T.nodes[m.id].v} 的一段。`,
      // 选哪几段：错法的那一遍也照正确的画面问（答案一样，认不出错法；少了这一问，「答案和对的完全一样」的错法就筛不掉）
      ask: { tag: 'merge', kind: 'pick', count: m.take.length, q: `第 ${j + 1} 次归并：选哪 ${m.take.length} 段？在图上点出来（点每棵树的根）。`, answer: m.take.map((x) => `n${x}`), alts: combos, display: m.take.map((x) => T.nodes[x].v).sort((a, b) => a - b).join('、') },
    });
  });
  const inner = T.nodes.filter((x) => !x.leaf).map((x) => x.v);
  steps.push({
    view: { roots: [T.root], nodes: T.nodes, R: T.R, done: true },
    msg: `最佳归并树建好了。WPL = 所有非叶结点的值加起来 = ${inner.join(' + ')} = **${T.wpl}**（也就是每段的长度 × 它参加归并的趟数）。每个记录每参加一趟归并要读一次、写一次，所以 I/O 次数 = 2 × WPL = **${2 * T.wpl}**。`,
    ask: { tag: 'io', kind: 'number', q: '归并过程中的读写（I/O）次数是多少？（每个记录占一个物理块）', answer: io },
    asks: [{ tag: 'wpl', kind: 'number', q: '这棵最佳归并树的 WPL 是多少？', answer: M.wpl }],
  });
  return { steps, T, M, virt: mv, io };
}
// 有一样长的段时，选哪几个都对：必选的（比第 k 小的那个还小）加上「一样长」的任意几个
function pickAlts(before, take, nodes) {
  const vals = take.map((x) => nodes[x].v);
  const edge = Math.max(...vals);
  const must = before.filter((x) => nodes[x].v < edge);
  const tie = before.filter((x) => nodes[x].v === edge);
  const need = take.length - must.length;
  const out = [];
  const rec = (start, pick) => {
    if (out.length >= 40) return;
    if (pick.length === need) { out.push([...must, ...pick].map((x) => `n${x}`)); return; }
    for (let i = start; i < tie.length; i++) rec(i + 1, [...pick, tie[i]]);
  };
  rec(0, []);
  return out;
}

// 画法：每棵树的叶子占一格，内部结点在孩子的正中间。纵向按「离最终那棵树的底有多高」排：
// 一棵高 h 的树，根画在第 R − h 层（R 是最终归并树的高度），各结点在根下面按深度排。这样合并时
// 最高的那棵子树不用动、新结点出现在它们上面，矮的子树往上靠；最后一步正好是平常的画法（根在最上面）
function forestSvg(s) {
  const { nodes } = s;
  const roots = s.roots;
  const GAP = 46, LEVEL = 60, TOP = 26;
  const height = (id) => (nodes[id].kids.length ? 1 + Math.max(...nodes[id].kids.map(height)) : 0);
  const R = s.R ?? Math.max(...roots.map(height));
  const X = {}, D = {};
  let slot = 0;
  const lay = (id, d) => {
    D[id] = d;
    const x = nodes[id];
    if (!x.kids.length) { X[id] = (++slot) * GAP; return; }
    x.kids.forEach((c) => lay(c, d + 1));
    X[id] = (X[x.kids[0]] + X[x.kids.at(-1)]) / 2;
  };
  roots.forEach((r) => lay(r, R - height(r)));
  const W = (slot + 1) * GAP, H = TOP + R * LEVEL + 40;
  const took = new Set(s.took || []), fresh = new Set(s.fresh || []);
  const rootSet = new Set(roots);
  let edges = '', ns = '';
  const Y = (id) => TOP + D[id] * LEVEL;
  for (const id of Object.keys(X).map(Number)) {
    for (const c of nodes[id].kids) edges += `<line class="sv-edge" data-key="e${c}" x1="${X[id]}" y1="${Y(id)}" x2="${X[c]}" y2="${Y(c)}"/>`;
    const x = nodes[id];
    const cls = ['ln-fnode', x.leaf ? 'ln-leaf' : 'ln-tn', x.virtual ? 'ln-virtual' : '', took.has(id) ? 'sv-cmp' : '', fresh.has(id) ? 'sv-new ln-win' : ''].filter(Boolean).join(' ');
    const pick = rootSet.has(id) ? ` data-pick="n${id}"` : '';
    const shape = x.leaf ? `<rect x="${X[id] - 19}" y="${Y(id) - 15}" width="38" height="30" rx="6"/>` : `<circle cx="${X[id]}" cy="${Y(id)}" r="19"/>`;
    ns += `<g class="${cls}"${pick} data-cmd="${id + 1}" data-label="${x.v}" data-key="f${id}">${shape}<text class="ln-leaf-v" x="${X[id]}" y="${Y(id)}">${x.v}</text></g>`;
  }
  return `<svg class="sv-tree ln-forest" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="归并树">${edges}${ns}</svg>`;
}

// ================= 公共 =================
export function run(input) {
  if (input.mode === 'loser') return runLoser(input);
  if (input.mode === 'replace') return runReplace(input);
  return runMerge(input);
}

export function view(s, input) {
  if (input.mode === 'loser') {
    return `${loserSvg(s, input)}${s.out.length ? chips([['已输出', s.out.join(' ')]]) : ''}`;
  }
  if (input.mode === 'replace') return replaceView(s, input);
  const wpl = s.done ? s.nodes.filter((x) => !x.leaf).reduce((a, x) => a + x.v, 0) : null;
  return `${forestSvg(s)}${s.done ? chips([['WPL', wpl], ['I/O 次数', 2 * wpl]]) : ''}`;
}

export function quiz(input, r) {
  if (input.mode === 'loser') {
    const last = r.phases.at(-1);
    return { q: `${input.keys.length} 路归并，各段当前的关键字是 ${input.keys.join('、')}（b0～b${input.keys.length - 1}）。${input.next.length ? `建好败者树以后，依次输出冠军并读入 ${input.next.map((x) => (x === Infinity ? '∞' : x)).join('、')}（每次补进刚输出的那一段）。最后` : '建好败者树以后，'}ls[0]～ls[${input.keys.length - 1}] 里各记的是哪一段？依次写出段号，空格隔开。`, type: 'seq', answer: `${last.join(' ')} | ${last.map((x) => `b${x}`).join(' ')}` };
  }
  if (input.mode === 'replace') return { q: `输入文件有 ${input.fi.length} 个记录：${input.fi.join(' ')}，工作区能放 ${input.w} 个。用置换-选择排序，一共得到几个初始归并段？`, type: 'seq', answer: String(r.runs.length) };
  return { q: `${input.lens.length} 个初始归并段的长度是 ${input.lens.join('、')}，做 ${input.k} 路归并，按最佳归并树归并。每个记录占一个物理块，归并过程中的读写（I/O）次数是多少？`, type: 'seq', answer: String(r.io) };
}

export function table(input, r) {
  if (input.mode === 'loser') {
    const k = input.keys.length;
    return {
      q: `${k} 路归并，各段当前的关键字是 ${input.keys.join('、')}（b0～b${k - 1}）。${input.next.length ? `建好败者树以后，依次输出冠军、把那一段的下一个关键字补进来：${input.next.map((x) => (x === Infinity ? '∞' : x)).join('、')}。` : ''}写出建好${input.next.length ? '、每次调整' : ''}以后 ls[0]～ls[${k - 1}] 里记的段号（写 3 或 b3 都行）。`,
      dir: 'col', head: Array.from({ length: k }, (_, t) => `ls[${t}]`),
      rows: r.phases.map((ls, m) => ({ label: m === 0 ? '建好' : `调整 ${m}`, cells: ls.map((x) => ({ v: [`b${x}`, String(x)] })) })),
    };
  }
  if (input.mode === 'replace') {
    return {
      q: `输入文件：${input.fi.join(' ')}，工作区能放 ${input.w} 个。用置换-选择排序，写出每个初始归并段（空格隔开）。`,
      dir: 'row', head: ['归并段'],
      rows: r.runs.map((x, k) => ({ label: `第 ${k + 1} 段`, cells: [{ v: x.join(' '), vec: true }] })),
    };
  }
  const k = input.k;
  const M = r.M;
  return {
    q: `${input.lens.length} 个初始归并段的长度：${input.lens.join('、')}，做 ${k} 路归并。先补虚段（长度写 0），再按最佳归并树一次次合并：每一行写这次合并的几段（不管先后）和合成的新段；最后写虚段个数、WPL 和 I/O 次数。`,
    dir: 'row', head: [...Array.from({ length: k }, (_, i) => `第 ${i + 1} 段`), '合成'],
    rows: M.merges.map((m, j) => ({ label: `第 ${j + 1} 次`, cells: [...Array.from({ length: k }, (_, i) => ({ v: m.take[i] !== undefined ? String(M.nodes[m.take[i]].v) : '', group: 'm' })), { v: String(M.nodes[m.id].v), num: true }] })),
    extra: [{ label: '虚段个数', v: String(r.virt), num: true }, { label: 'WPL', v: String(M.wpl), num: true }, { label: 'I/O 次数', v: String(r.io), num: true }],
  };
}

export function problems(input, r) {
  const out = [];
  if (input.mode === 'loser' && new Set(input.keys).size < input.keys.length) out.push('loser: 有相同的关键字，比赛时一样大的按段号小的胜；换成都不同的更清楚');
  if (input.mode === 'replace' && r.runs.length < 2) out.push('replace: 这组数只出来一段（本来就差不多有序），看不出段是怎么断开的');
  if (input.mode === 'merge' && input.lens.length <= input.k) out.push(`merge: 只有 ${input.lens.length} 段，${input.k} 路一次就并完了，看不出最佳归并树`);
  return out;
}

const VARIANTS = {
  loser: [
    ['storeWinner', '像是内部结点记了胜者，做成了胜者树（王道：败者树的内部结点记败者，胜者往上接着比）'],
    ['maxWins', '像是把关键字大的当成了胜者（王道：归并要升序输出，关键字小的胜，ls[0] 是最小的那段）'],
  ],
  replace: [
    ['outSmaller', '像是比 MINIMAX 小的也输出到了当前段（王道：只能从比 MINIMAX 大的里面选最小的，选不出来这一段就结束）'],
    ['chunk', '像是每次读满工作区、排好就输出一段，归并段只有工作区那么长（王道：置换-选择边输出边读入，得到的段一般比工作区长）'],
  ],
  merge: [
    ['noVirtual', '像是没补虚段（王道：(n − 1) % (k − 1) = u ≠ 0 时要补 k − 1 − u 个长度为 0 的虚段）'],
    ['virtualN', '像是用 n % (k − 1) 算的虚段个数（王道：看的是 (n − 1) % (k − 1)）'],
    ['ioOnce', '像是 I/O 次数只算了一遍 WPL（王道：每个记录每趟要读一次、写一次，I/O 次数 = 2 × WPL）'],
  ],
};
const answersOf = (input, r) => {
  let t = null;
  try { t = table(input, r).rows.map((x) => x.cells.map((c) => c.v)).concat([(table(input, r).extra || []).map((x) => x.v)]); } catch { /* 没有 */ }
  return JSON.stringify([r.steps.flatMap((s) => [s.ask, ...(s.asks || [])]).filter(Boolean).map((a) => [a.q, a.answer]), quiz(input, r).answer, t]);
};
export function variants(input) {
  const base = answersOf(input, run(input));
  return (VARIANTS[input.mode] || []).map(([mistake, label]) => ({ label, input: { ...input, mistake } })).filter((v) => { try { return answersOf(v.input, run(v.input)) !== base; } catch { return false; } });
}

export const extsortEngine = { name: 'extsort', title: '外部排序', parse, run, view, quiz, table, problems, variants };
