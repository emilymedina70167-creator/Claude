// 由遍历序列建二叉树（组件 buildtree）：先序 + 中序、后序 + 中序、层序 + 中序（王道 5.3.3），
// 一步步：在先序（后序、层序）这一段里找根 → 在中序里找到根、切成左右两段 → 两段各自接着做。
// 先序 + 后序一般定不下来（只有一个孩子时分不清左右）：每个结点都有 0 或 2 个孩子时能建，否则报出是哪个结点定不下来。
// 树一个结点一个结点长出来，位置照建好的样子先定好（横坐标就是中序里的名次），已经画上的不挪。
// 纯函数，不碰 DOM（tests/trees2-engine.test.js）。画法在 forestview.js。
import { treesSvg, binLayout, binEdges, seqRow, parseSeq, binOrder, walkOf, WALK_NAME } from './forestview.js';

const MAX_NODES = 15;
const SEQ_NAME = { pre: '先序', post: '后序', level: '层序', in: '中序' };
const EMPTY = ['', '无', '空', '^', '∧', 'NULL'];

export function parse(fields) {
  const has = (k) => fields[k] !== undefined && String(fields[k]).trim() !== '';
  const given = ['pre', 'post', 'level', 'in'].filter(has);
  const seqs = {};
  for (const k of given) seqs[k] = parseSeq(fields[k], k);
  let kind;
  if (has('in')) {
    const other = given.filter((k) => k !== 'in');
    if (other.length !== 1) throw new Error(other.length ? `中序之外只写一个（现在写了 ${other.map((k) => `${k}:`).join('、')}）` : '只有中序建不出树：再写 pre:（先序）、post:（后序）或 level:（层序）');
    kind = other[0];
  } else if (has('pre') && has('post') && !has('level')) kind = 'prepost';
  else throw new Error('buildtree 要写两个序列：pre: + in:、post: + in:、level: + in:（或者 pre: + post:，但一般定不下来）');
  const pair = kind === 'prepost' ? ['pre', 'post'] : [kind, 'in'];
  const [A, B] = pair.map((k) => seqs[k]);
  if (A.length > MAX_NODES) throw new Error(`结点最多 ${MAX_NODES} 个（现在 ${A.length} 个），序列一行才放得下`);
  if (A.length !== B.length) throw new Error(`${SEQ_NAME[pair[0]]}有 ${A.length} 个结点，${SEQ_NAME[pair[1]]}有 ${B.length} 个：对不上`);
  const miss = A.filter((x) => !B.includes(x));
  if (miss.length) throw new Error(`${SEQ_NAME[pair[0]]}里的 ${miss.join('、')} 在${SEQ_NAME[pair[1]]}里没有`);
  const dflt = kind === 'pre' ? 'post' : kind === 'prepost' ? 'in' : 'pre';
  const input = { kind, other: kind === 'prepost' ? seqs.pre : A, inSeq: kind === 'prepost' ? null : seqs.in, post: kind === 'prepost' ? seqs.post : null, quizWalk: walkOf(fields.quiz, dflt) };
  build(input); // 先建一遍：对不上、定不下来的现在就报
  return input;
}

/**
 * 建树，返回 { tree, events }。events 是一步步的经过：{ type: 'root' | 'split' | 'leaf', … }。
 * mistake：'firstroot'（后序拿第一个当根）、'lastroot'（先序拿最后一个当根）、'levelaspre'（层序当先序切）、'mirror'（左右切反）。
 * 错法走不下去（根不在这一段中序里）就停在那里，不报错
 */
export function build(input) {
  const { kind, mistake } = input;
  const nodes = {};
  const events = [];
  const strict = !mistake;
  const fail = (msg) => { if (strict) throw new Error(msg); return null; };
  const otherName = kind === 'prepost' ? '先序' : SEQ_NAME[kind];

  if (kind === 'prepost') {
    const pre = input.other, post = input.post;
    const rec = (p, q, parent, side) => {
      // p：先序这一段，q：后序这一段（同样的结点）
      if (!p.length) return null;
      const r = p[0];
      if (q[q.length - 1] !== r) return fail(`先序这一段的第一个是 ${r}，后序这一段的最后一个却是 ${q[q.length - 1]}：两个序列对不上`);
      nodes[r] = { key: r, left: null, right: null };
      events.push({ type: p.length === 1 ? 'leaf' : 'root', node: r, parent, side, other: p.slice(), post: q.slice() });
      if (p.length === 1) return r;
      const lr = p[1];
      const m = q.indexOf(lr);
      if (m < 0) return fail(`先序里 ${r} 后面的 ${lr} 不在后序的这一段里：两个序列对不上`);
      const L = m + 1;
      if (L === p.length - 1) return fail(`先序 + 后序定不下来：${r} 只有一个孩子 ${lr}，它是左孩子还是右孩子，从先序、后序都看不出来（先序和后序只能唯一确定每个结点都有 0 个或 2 个孩子的二叉树）。要唯一确定，得有中序。`);
      const lp = p.slice(1, 1 + L), rp = p.slice(1 + L), lq = q.slice(0, L), rq = q.slice(L, -1);
      if (lp.some((x) => !lq.includes(x)) || rp.some((x) => !rq.includes(x))) return fail(`切开 ${r} 的两棵子树时，先序和后序里的结点对不上`);
      const [ls, rs] = mistake === 'mirror' ? [[rp, rq], [lp, lq]] : [[lp, lq], [rp, rq]];
      events.push({ type: 'split', node: r, L: ls[0].length, R: rs[0].length, left: ls[0], right: rs[0], lq: ls[1], rq: rs[1] });
      nodes[r].left = rec(ls[0], ls[1], r, 'left');
      nodes[r].right = rec(rs[0], rs[1], r, 'right');
      return r;
    };
    const root = rec(pre, post, null, null);
    return { tree: { root, nodes }, events };
  }

  const ino = input.inSeq;
  const inPos = Object.fromEntries(ino.map((x, i) => [x, i]));
  const rec = (names, lo, hi, parent, side) => {
    // names：先序 / 后序 / 层序里属于这棵子树的结点（按原来的顺序）；lo..hi：中序里的这一段
    if (lo > hi) return null;
    if (!names.length) return fail('序列对不上');
    let r = kind === 'post' ? names[names.length - 1] : names[0];
    if (mistake === 'firstroot') r = names[0];
    if (mistake === 'lastroot') r = names[names.length - 1];
    const k = inPos[r];
    if (k === undefined || k < lo || k > hi) return fail(`${otherName}这一段的根 ${r} 不在中序对应的这一段（${ino.slice(lo, hi + 1).join(' ')}）里：两个序列对不上`);
    const seg = ino.slice(lo, hi + 1);
    if (strict && (names.length !== seg.length || names.some((x) => !seg.includes(x)))) return fail(`${otherName}和中序对不上：${otherName}里 ${names.join(' ')} 这一段，中序里对应的是 ${seg.join(' ')}`);
    nodes[r] = { key: r, left: null, right: null };
    events.push({ type: lo === hi ? 'leaf' : 'root', node: r, parent, side, other: names.slice(), lo, hi });
    if (lo === hi) return r;
    const L = k - lo;
    const leftIn = ino.slice(lo, k), rightIn = ino.slice(k + 1, hi + 1);
    let ln, rn;
    if (kind === 'level' && mistake !== 'levelaspre') { ln = names.filter((x) => leftIn.includes(x)); rn = names.filter((x) => rightIn.includes(x)); }
    else if ((kind === 'post' && mistake !== 'firstroot') || mistake === 'lastroot') { ln = names.slice(0, L); rn = names.slice(L, -1); }
    else { ln = names.slice(1, 1 + L); rn = names.slice(1 + L); }
    let parts = [[ln, lo, k - 1], [rn, k + 1, hi]];
    if (mistake === 'mirror') parts = [parts[1], parts[0]];
    events.push({ type: 'split', node: r, L: parts[0][2] - parts[0][1] + 1, R: parts[1][2] - parts[1][1] + 1, left: parts[0][0], right: parts[1][0], leftIn: ino.slice(parts[0][1], parts[0][2] + 1), rightIn: ino.slice(parts[1][1], parts[1][2] + 1) });
    nodes[r].left = rec(parts[0][0], parts[0][1], parts[0][2], r, 'left');
    nodes[r].right = rec(parts[1][0], parts[1][1], parts[1][2], r, 'right');
    return r;
  };
  const root = rec(input.other, 0, ino.length - 1, null, null);
  return { tree: { root, nodes }, events };
}

export function run(input) {
  const { tree, events } = build(input);
  const kind = input.kind;
  const otherName = kind === 'prepost' ? '先序' : SEQ_NAME[kind];
  const placed = [];
  const steps = [];
  const sideWord = (s) => (s === 'left' ? '左' : '右');
  const rule = { pre: '先序的第一个是根', post: '后序的最后一个是根', level: '层序里最先出现的是根', prepost: '先序的第一个（也是后序的最后一个）是根' }[kind];
  const snap = (extra = {}) => ({ tree, placed: placed.slice(), ...extra });
  steps.push({ view: snap({ focus: input.other.slice() }), msg: `${otherName} + ${kind === 'prepost' ? '后序' : '中序'}建二叉树：${rule}；${kind === 'prepost' ? '先序的第二个是左子树的根，在后序里找到它，就知道左子树有几个结点' : '在中序里找到根，左边的是左子树、右边的是右子树'}。每棵子树照样再做一遍。` });
  const whose = (e) => (e.parent ? `${e.parent} 的${sideWord(e.side)}子树` : '整棵树');
  for (const e of events) {
    if (e.type === 'root' || e.type === 'leaf') {
      placed.push(e.node);
      const where = e.parent ? `，接成 ${e.parent} 的${sideWord(e.side)}孩子` : '';
      const segText = e.other.join(' ');
      if (e.type === 'leaf') {
        steps.push({ view: snap({ cur: e.node, focus: [e.node], fresh: [e.node] }), msg: `${whose(e)}只有 ${e.node} 一个结点：它是叶子${where}。` });
      } else {
        steps.push({
          view: snap({ cur: e.node, focus: e.other, fresh: [e.node] }),
          msg: `${whose(e)}：${otherName}这一段是 ${segText}，${{ pre: '第一个', post: '最后一个', level: '最先出现的', prepost: '第一个' }[kind]} ${e.node} 是根${where}。`,
          ask: { tag: 'root', kind: 'pick', q: `${whose(e)}${e.parent ? `（${otherName}里是 ${segText}）` : ''}的根是哪个？在序列里点出来。`, answer: e.node },
        });
      }
    } else {
      const both = e.L && e.R ? '' : e.L ? '（右子树是空的）' : '（左子树是空的）';
      const msg = kind === 'prepost'
        ? `先序里 ${e.node} 后面的 ${e.left[0] ?? e.right[0]} 是一棵子树的根；后序里它前面（连它）一共 ${e.L || e.R} 个：左子树 ${e.left.join(' ') || '（空）'}，右子树 ${e.right.join(' ') || '（空）'}。`
        : `在中序里找到 ${e.node}：左边 ${e.L} 个（${e.leftIn.join(' ') || '空'}）是左子树，右边 ${e.R} 个（${e.rightIn.join(' ') || '空'}）是右子树${both}。${otherName}里对应的是：左 ${e.left.join(' ') || '（空）'}，右 ${e.right.join(' ') || '（空）'}。`;
      steps.push({
        view: snap({ cur: e.node, focus: [...e.left, e.node, ...e.right], left: [...e.left], right: [...e.right] }),
        msg,
        ask: { tag: 'split', kind: 'number', q: `${e.node} 的左子树有几个结点？`, answer: String(e.L) },
      });
    }
  }
  const tail = binOrder(tree, input.quizWalk);
  steps.push({ view: snap({ done: true }), msg: `建好了。${WALK_NAME[input.quizWalk]}序列：${tail.join(' ')}。` });
  return { steps, tree, events };
}

// —— 画 ——

export function view(s, input) {
  const tree = s.tree;
  const placed = new Set(s.placed);
  // 位置照建好的样子：横坐标是中序名次。错法建出来的树可能缺结点，只画建出来的
  const pos = binLayout(tree);
  const order = binOrder(tree, 'level');
  const cmdOf = (k) => order.indexOf(k) + 1 || '';
  const cls = {};
  for (const k of placed) cls[k] = 'sv-done';
  if (s.cur) cls[s.cur] = 'sv-cur';
  const svg = treesSvg({ nodes: tree.nodes, pos, edges: binEdges(tree) }, { show: placed, cls, fresh: s.fresh || [], prefix: 'bt', aria: '建出来的二叉树', pick: (k) => k, cmd: cmdOf });
  const focus = new Set(s.focus || []);
  const L = new Set(s.left || []), Rt = new Set(s.right || []);
  const cell = (k) => {
    let c = '';
    if (L.has(k)) c = 'sv-g1';
    else if (Rt.has(k)) c = 'sv-g2';
    if (k === s.cur) c = 'sv-cur';
    else if (!s.done && !focus.has(k)) c = placed.has(k) ? 'sv-done sv-out' : 'sv-out';
    return { text: k, cls: c, pick: k, cmd: cmdOf(k) };
  };
  const rows = [seqRow(input.kind === 'prepost' ? '先序' : SEQ_NAME[input.kind], input.other.map(cell))];
  rows.push(seqRow(input.kind === 'prepost' ? '后序' : '中序', (input.kind === 'prepost' ? input.post : input.inSeq).map(cell)));
  const legend = s.left || s.right ? '<div class="sv-bt-legend muted"><span class="sv-key sv-g1"></span>左子树 <span class="sv-key sv-g2"></span>右子树</div>' : '';
  return `<div class="sv-bt">${svg}<div class="sv-bt-seqs">${rows.join('')}${legend}</div></div>`;
}

// —— 考卷 ——

const givenText = (input) => (input.kind === 'prepost' ? `先序 ${input.other.join(' ')}、后序 ${input.post.join(' ')}` : `${SEQ_NAME[input.kind]} ${input.other.join(' ')}、中序 ${input.inSeq.join(' ')}`);
const seqsHtml = (input) => `<div class="sv-bt-seqs">${seqRow(input.kind === 'prepost' ? '先序' : SEQ_NAME[input.kind], input.other.map((k) => ({ text: k })))}${seqRow(input.kind === 'prepost' ? '后序' : '中序', (input.kind === 'prepost' ? input.post : input.inSeq).map((k) => ({ text: k })))}</div>`;

export function quiz(input, r) {
  return { q: `一棵二叉树的${givenText(input)}。写出它的${WALK_NAME[input.quizWalk]}序列。`, qhtml: seqsHtml(input), type: 'seq', answer: binOrder(r.tree, input.quizWalk).join(' ') };
}

// 每个结点的左孩子、右孩子（行按给的第一个序列排）
export function table(input, r) {
  const t = r.tree.nodes;
  const rows = input.other.map((k) => ({ label: k, cells: [t[k]?.left ? { v: t[k].left } : { v: EMPTY }, t[k]?.right ? { v: t[k].right } : { v: EMPTY }] }));
  return { q: `一棵二叉树的${givenText(input)}。写出每个结点的左孩子、右孩子（没有就空着）。`, qhtml: seqsHtml(input), dir: 'row', head: ['左孩子', '右孩子'], rows };
}

// 常见错法（只给老师看）：建出来的树和对的一样的不列
export function variants(input) {
  const right = shape(build(input).tree);
  const list = {
    pre: [['mirror', '像是左右子树切反了（中序里根左边的是左子树，右边的是右子树）'], ['lastroot', '像是把先序的最后一个当成了根（先序：根 → 左 → 右，第一个才是根；后序才是最后一个）']],
    post: [['firstroot', '像是把后序的第一个当成了根（王道：后序是左 → 右 → 根，最后一个才是根）'], ['mirror', '像是左右子树切反了（中序里根左边的是左子树，右边的是右子树）']],
    level: [['levelaspre', '像是把层序当先序用了，左子树直接取根后面紧跟着的几个（层序里属于左子树的结点是散开的，要按中序挑出来、保持原来的顺序）'], ['mirror', '像是左右子树切反了（中序里根左边的是左子树，右边的是右子树）']],
    prepost: [['mirror', '像是把先序第二个结点那棵当成了右子树（先序 根 → 左 → 右：根后面紧跟着的是左子树的根）']],
  }[input.kind];
  const out = [];
  for (const [m, label] of list) {
    const v = { ...input, mistake: m };
    try { if (shape(build(v).tree) !== right) out.push({ label, input: v }); } catch { /* 走不下去 */ }
  }
  return out;
}
const shape = (t) => { const w = (id) => (id ? `${t.nodes[id].key}(${w(t.nodes[id].left)},${w(t.nodes[id].right)})` : ''); return w(t.root); };

export const buildtreeEngine = { name: 'buildtree', title: '由遍历序列建二叉树', parse, run, view, quiz, table, variants };
