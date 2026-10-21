// 线索二叉树（组件 thread）：n 个结点的二叉链表有 n + 1 个空指针，线索化就是把它们利用起来——
// 空的左指针（ltag = 1）指向前驱，空的右指针（rtag = 1）指向后继；前驱、后继按 order: 的次序（中序，默认；先序、后序）。
// 照王道 InThread 的走法：按遍历次序一个个访问，第一个结点的左线索、最后一个结点的右线索指向 NULL（tag 也是 1）。
// 演示时每访问一个结点，把它两边空着的指针都连上（代码里右线索是访问到后继时才连的：pre->rchild = p，说明里写了）。
// 纯函数，不碰 DOM（tests/trees2-engine.test.js）。画法在 forestview.js。
import { parseTree, parseLevel } from './tree.js';
import { treesSvg, binLayout, binEdges, miniTable, panels, binOrder } from './forestview.js';
import { chips, esc } from './arrayview.js';

const ORDER = { in: '中序', pre: '先序', post: '后序' };
const RULE = { in: '左子树 → 根 → 右子树', pre: '根 → 左子树 → 右子树', post: '左子树 → 右子树 → 根' };
const ALIAS = { in: 'in', inorder: 'in', 中序: 'in', pre: 'pre', preorder: 'pre', 先序: 'pre', 前序: 'pre', post: 'post', postorder: 'post', 后序: 'post' };
const NULL_ALTS = ['NULL', '^', '∧', 'NIL']; // 填表时指向 NULL 要写出来（空着算没填）

export function parse(fields) {
  if (fields.nodes === undefined && fields.level === undefined) throw new Error('thread 要写 nodes:（如 A(B(D, E), C)，写法同 tree）或 level:（层序，# 是空）');
  const tree = fields.nodes !== undefined ? parseTree(fields.nodes) : parseLevel(fields.level);
  if (Object.keys(tree.nodes).length > 15) throw new Error('thread 的结点最多 15 个（线索多了箭头会挤在一起）');
  const o = fields.order === undefined || String(fields.order).trim() === '' ? 'in' : ALIAS[String(fields.order).trim().toLowerCase()];
  if (!o) throw new Error(`order: 写 in（中序，默认）、pre（先序）或 post（后序）（现在是「${fields.order}」）`);
  const q = String(fields.quiz ?? '').trim().toLowerCase();
  if (q && !['succ', 'pred', '后继', '前驱'].includes(q)) throw new Error(`quiz: 写 succ（右线索指向谁，默认）或 pred（左线索指向谁）（现在是「${fields.quiz}」）`);
  return { tree, order: o, quiz: q === 'pred' || q === '前驱' ? 'pred' : 'succ' };
}

// 遍历次序（结点 id）
function seqOf(tree, order) {
  const out = [];
  const w = (id) => {
    if (id === null) return;
    const n = tree.nodes[id];
    if (order === 'pre') out.push(id);
    w(n.left);
    if (order === 'in') out.push(id);
    w(n.right);
    if (order === 'post') out.push(id);
  };
  w(tree.root);
  return out;
}

/** 每个空指针线索化以后指向谁：{ id: { l?: id | null, r?: id | null } }（null 是 NULL）。mistake 'swap'：前驱后继弄反 */
export function threadsOf(tree, order, mistake) {
  const seq = seqOf(tree, order);
  const out = {};
  seq.forEach((id, i) => {
    const n = tree.nodes[id];
    const pred = i > 0 ? seq[i - 1] : null, succ = i < seq.length - 1 ? seq[i + 1] : null;
    out[id] = {};
    if (n.left === null) out[id].l = mistake === 'swap' ? succ : pred;
    if (n.right === null) out[id].r = mistake === 'swap' ? pred : succ;
  });
  return { seq, threads: out };
}

export function run(input) {
  const { tree, order, mistake } = input;
  const { seq, threads } = threadsOf(tree, order, mistake);
  const K = (id) => (id === null ? 'NULL' : tree.nodes[id].key);
  const n = seq.length;
  const done = {}; // 已经连上的线索：{ id: { l, r } }
  const visited = [];
  const steps = [];
  const name = ORDER[order];
  const snap = (extra = {}) => ({ tree, done: JSON.parse(JSON.stringify(done)), visited: visited.slice(), ...extra });
  steps.push({ view: snap(), msg: `${n} 个结点的二叉链表有 2×${n} = ${2 * n} 个指针，用掉 ${n - 1} 个（每个结点除了根都被一个指针指着），空着 ${n + 1} 个（画成 ∧）。${name}线索化：按${name}（${RULE[order]}）一个个访问，空的左指针改成指向前驱（ltag = 1），空的右指针改成指向后继（rtag = 1）。` });
  const lAsk = (id, ans) => ({ tag: 'pred', kind: 'pick', q: `${K(id)} 的左指针空着：线索化以后它指向谁？在图上点出来（指向 NULL 就点 NULL）。`, answer: K(ans) });
  const rAsk = (id, ans) => ({ tag: 'succ', kind: 'pick', q: `${K(id)} 的右指针空着：线索化以后它指向谁？在图上点出来（指向 NULL 就点 NULL）。`, answer: K(ans) });
  seq.forEach((id, i) => {
    visited.push(id);
    const nd = tree.nodes[id];
    const t = threads[id];
    const pre = i > 0 ? K(seq[i - 1]) : 'NULL';
    const head = `访问 ${K(id)}（pre = ${pre}）`;
    const hasL = 'l' in t, hasR = 'r' in t;
    const lText = (x) => (x === null ? `${K(id)} 是${name}的第一个，没有前驱：lchild = NULL，ltag = 1` : `lchild 指向前驱 ${K(x)}，ltag = 1`);
    const rText = (x) => (x === null ? `${K(id)} 是${name}的最后一个，没有后继：rchild = NULL，rtag = 1（王道的代码在最后单独处理这一个）` : `rchild 指向后继 ${K(x)}，rtag = 1（王道的代码里这一条是访问到 ${K(x)} 时才连的：pre->rchild = p）`);
    if (hasL) {
      done[id] = { ...done[id], l: t.l };
      steps.push({ view: snap({ cur: id, fresh: [id], newT: [[id, 'l']] }), msg: `${head}：左指针空着，${lText(t.l)}。${hasR ? '' : `右边有孩子 ${K(nd.right)}，rtag = 0。`}`, ask: lAsk(id, t.l) });
    }
    if (hasR) {
      done[id] = { ...done[id], r: t.r };
      steps.push({ view: snap({ cur: id, fresh: hasL ? [] : [id], newT: [[id, 'r']] }), msg: `${hasL ? `${K(id)} 的右指针也空着` : `${head}：左边有孩子 ${K(nd.left)}（ltag = 0）；右指针空着`}，${rText(t.r)}。`, ask: rAsk(id, t.r) });
    }
    if (!hasL && !hasR) steps.push({ view: snap({ cur: id, fresh: [id] }), msg: `${head}：左右孩子都有（ltag = rtag = 0），不加线索。` });
  });
  const nulls = Object.values(threads).reduce((s, t) => s + (t.l === null ? 1 : 0) + (t.r === null ? 1 : 0), 0);
  steps.push({ view: snap({ final: true }), msg: `${name}线索化做完了：${n + 1} 个空指针都成了线索，其中 ${nulls} 个指向 NULL。${name}序列 ${seq.map(K).join(' ')}：有了线索，${order === 'in' ? '找后继：rtag = 1 直接走线索，rtag = 0 就是右子树里最左下的结点' : '不用栈就能顺着线索找后继（个别情况还要知道双亲）'}。` });
  return { steps, seq, threads };
}

// —— 画 ——

function cellsOf(tree, done, id) {
  const n = tree.nodes[id];
  const K = (x) => (x === null ? 'NULL' : tree.nodes[x].key);
  const side = (child, t, has) => (child !== null ? { tag: '0', ptr: K(child) } : has ? { tag: '1', ptr: K(t) } : { tag: '', ptr: '∧' });
  const d = done[id] || {};
  return { l: side(n.left, d.l, 'l' in d), r: side(n.right, d.r, 'r' in d) };
}

export function view(s, input) {
  const tree = s.tree;
  const pos = binLayout(tree);
  const order = binOrder(tree, 'level');
  const ids = Object.keys(tree.nodes);
  const keyToId = Object.fromEntries(ids.map((id) => [tree.nodes[id].key, id]));
  const cmdOf = (id) => order.indexOf(tree.nodes[id].key) + 1;
  const threads = [], stubs = [];
  const fresh = new Set((s.newT || []).map(([id, side]) => `${id}:${side}`));
  for (const id of ids) {
    const n = tree.nodes[id];
    const d = s.done[id] || {};
    for (const side of ['l', 'r']) {
      if ((side === 'l' ? n.left : n.right) !== null) continue;
      if (side in d) threads.push({ from: id, side, to: d[side], cls: fresh.has(`${id}:${side}`) ? 'sv-new sv-th-fresh' : '' });
      else stubs.push({ id, side });
    }
  }
  const cls = {};
  for (const id of s.visited) cls[id] = 'sv-done';
  if (s.cur) cls[s.cur] = 'sv-cur';
  const svg = treesSvg({ nodes: tree.nodes, pos, edges: binEdges(tree) }, { cls, fresh: s.fresh || [], threads, stubs, gapX: 56, level: 72, prefix: 'th', aria: '线索二叉树', pick: (id) => tree.nodes[id].key, cmd: cmdOf });
  // 指向 NULL 的线索在图上没有目标可点：放一个 NULL 格子。外壳问的时候不重画，所以一直画着，只在「在图上点」时露出来（styles.css）
  const nullPick = '<div class="sv-th-nullrow"><span class="sv-th-nullpick" data-pick="NULL">NULL</span><span class="muted">没有前驱 / 后继时点这里</span></div>';
  const legend = '<div class="sv-th-legend muted"><span class="sv-th-key sv-th-pred"></span>前驱线索（左）<span class="sv-th-key sv-th-succ"></span>后继线索（右）</div>';
  // 结点结构：lchild ltag data rtag rchild（王道的写法）
  const rows = order.map((k) => {
    const id = keyToId[k];
    const c = cellsOf(tree, s.done, id);
    const f = (side) => (fresh.has(`${id}:${side}`) ? 'sv-chg sv-new' : '');
    return [{ html: c.l.ptr === '∧' ? '<span class="muted">∧</span>' : esc(c.l.ptr), cls: f('l') }, { html: esc(c.l.tag), cls: f('l') }, { html: `<b>${esc(k)}</b>`, cls: id === s.cur ? 'sv-pickcell' : '' }, { html: esc(c.r.tag), cls: f('r') }, { html: c.r.ptr === '∧' ? '<span class="muted">∧</span>' : esc(c.r.ptr), cls: f('r') }];
  });
  const tbl = miniTable(['lchild', 'ltag', 'data', 'rtag', 'rchild'], rows, { cls: 'sv-th-tbl' });
  const seqText = s.visited.map((id) => tree.nodes[id].key).join(' ');
  return panels([['二叉树', svg + nullPick + legend], ['结点结构', tbl]]) + chips([[`${ORDER[input.order]}访问过的`, seqText || '（还没有）']]);
}

// —— 考卷 ——

export function quiz(input, r) {
  const tree = input.tree;
  const order = binOrder(tree, 'level');
  const ids = Object.fromEntries(Object.keys(tree.nodes).map((id) => [tree.nodes[id].key, id]));
  const side = input.quiz === 'pred' ? 'l' : 'r';
  const which = order.filter((k) => side in r.threads[ids[k]]);
  const K = (x) => (x === null ? 'NULL' : tree.nodes[x].key);
  const qhtml = treesSvg({ nodes: tree.nodes, pos: binLayout(tree), edges: binEdges(tree) }, { gapX: 56, level: 72, prefix: 'thq', pointers: true, stubs: Object.keys(tree.nodes).flatMap((id) => [tree.nodes[id].left === null ? { id, side: 'l' } : null, tree.nodes[id].right === null ? { id, side: 'r' } : null].filter(Boolean)), pick: () => '' });
  return { q: `对这棵二叉树做${ORDER[input.order]}线索化。${side === 'l' ? '左' : '右'}指针空着的结点（${which.join('、')}），线索化以后${side === 'l' ? '左' : '右'}指针依次指向谁？（指向 NULL 的写 NULL）`, qhtml, type: 'seq', answer: which.map((k) => K(r.threads[ids[k]][side])).join(' ') };
}

// 每个结点的 ltag、lchild、rtag、rchild（有孩子的直接给出，只填线索）
export function table(input, r) {
  const tree = input.tree;
  const order = binOrder(tree, 'level');
  const ids = Object.fromEntries(Object.keys(tree.nodes).map((id) => [tree.nodes[id].key, id]));
  const K = (x) => (x === null ? NULL_ALTS : tree.nodes[x].key);
  const rows = order.map((k) => {
    const id = ids[k], n = tree.nodes[id], t = r.threads[id];
    // 照王道的结点结构排：lchild ltag | rtag rchild
    const part = (child, side) => (child !== null ? [{ v: tree.nodes[child].key, given: true }, { v: '0', given: true }] : [{ v: K(t[side]) }, { v: '1' }]);
    const [lc, lt] = part(n.left, 'l'), [rc, rt] = part(n.right, 'r');
    return { label: k, cells: [lc, lt, rt, rc] };
  });
  return { q: `对这棵二叉树做${ORDER[input.order]}线索化，填出每个结点的 lchild、ltag、rtag、rchild（有孩子的已经给出；线索写指向的结点，指向 NULL 写 NULL）。`, qhtml: quiz({ ...input, quiz: 'succ' }, r).qhtml, dir: 'row', head: ['lchild', 'ltag', 'rtag', 'rchild'], rows };
}

// 常见错法（只给老师看）：线索和对的一样的不列
export function variants(input) {
  const right = JSON.stringify(threadsOf(input.tree, input.order).threads);
  const out = [];
  const add = (label, v) => { if (JSON.stringify(threadsOf(v.tree, v.order, v.mistake).threads) !== right) out.push({ label, input: v }); };
  add('像是前驱、后继弄反了（王道：空的左指针 lchild 指向前驱，空的右指针 rchild 指向后继）', { ...input, mistake: 'swap' });
  for (const o of Object.keys(ORDER)) if (o !== input.order) add(`像是按${ORDER[o]}线索化的（这里要${ORDER[input.order]}：${RULE[input.order]}）`, { ...input, order: o });
  return out;
}

export const threadEngine = { name: 'thread', title: '线索二叉树', parse, run, view, quiz, table, variants };
