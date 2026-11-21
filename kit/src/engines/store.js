// 图、树的存储结构（组件 store，数据结构，视觉第 6 批）：原图和存储并排，一条边（一个结点）一步，存储跟着长。
//   图：graph: A-B, A->C 4（写法同 net 的 edges）。show: 里挑一到两种——
//     matrix 邻接矩阵（无权 0 / 1；带权的对角线 0、没边 ∞）、list 邻接表、cross 十字链表（只有向图）、multi 邻接多重表（只无向图）。
//     链表的结点按 edges 的先后接在后面（尾插）；insert: head 是头插（王道建表的代码每次插在边表的最前面）。
//     十字链表、多重表的指针写成弧 / 边的编号（第几条，从 0 数，就是 edges 里的先后），空指针写 ∧。
//   树：tree: A(B(D, E), C(F))（写法同 forest；多棵并排是森林）。show: 里挑——
//     parent 双亲表示（按层序编号，根的双亲 −1）、child 孩子表示（每个结点一串孩子的下标）、cs 孩子兄弟（firstchild、nextsibling，画成二叉树）、
//     seq 二叉树的顺序存储（tree: 写二叉树：A(B(, D), C)，逗号前是左子树；编号 i 的孩子是 2i、2i+1，空着写 #；单独用）。
// 纯函数，不碰 DOM（tests/engines-store.test.js）。
import { parseEdges, graphSvg } from './graph.js';
import { parseForest, forestLayout, forestEdges, binLayout, binEdges, treesSvg, miniTable, panels, seqRow } from './forestview.js';
import { toBinary } from './forest.js';
import { parseTree } from './tree.js';
import { esc } from './arrayview.js';

const GRAPH_SHOW = { matrix: '邻接矩阵', list: '邻接表', cross: '十字链表', multi: '邻接多重表' };
const TREE_SHOW = { parent: '双亲表示', child: '孩子表示', cs: '孩子兄弟表示', seq: '顺序存储' };
const NIL = '∧';

const natural = (a, b) => {
  const pa = /^(\D*)(\d*)$/.exec(a), pb = /^(\D*)(\d*)$/.exec(b);
  if (pa && pb && pa[1] === pb[1] && pa[2] && pb[2]) return Number(pa[2]) - Number(pb[2]);
  return a < b ? -1 : a > b ? 1 : 0;
};

export function parse(fields) {
  const hasG = String(fields.graph ?? '').trim(), hasT = String(fields.tree ?? '').trim();
  if (!hasG === !hasT) throw new Error('store 写 graph:（图的边，如 A-B, A->C 4）或 tree:（树，如 A(B(D, E), C)），只写一个');
  const showSrc = String(fields.show ?? '').split(/[,，\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const TABLE = hasG ? GRAPH_SHOW : TREE_SHOW;
  const show = showSrc.length ? showSrc : hasG ? ['matrix', 'list'] : ['parent'];
  for (const k of show) if (!TABLE[k]) throw new Error(`show: 不认识「${k}」，${hasG ? '图' : '树'}能写 ${Object.keys(TABLE).join('、')}`);
  if (show.length > 2) throw new Error('show: 一次最多两种（一屏放得下）');
  const insert = String(fields.insert ?? 'tail').trim().toLowerCase();
  if (!['tail', 'head'].includes(insert)) throw new Error('insert: 写 tail（接在后面，默认）或 head（头插）');
  const ask = String(fields.ask ?? '').split(/[,，\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (hasG) {
    const g = parseEdges(fields.graph);
    if (show.includes('cross') && !g.directed) throw new Error('十字链表是有向图的存储：graph: 写成 A->B');
    if (show.includes('multi') && g.directed) throw new Error('邻接多重表是无向图的存储：graph: 写成 A-B');
    const names = [];
    const add = (x) => { if (!names.includes(x)) names.push(x); };
    if (fields.nodes) for (const x of String(fields.nodes).trim().split(/[\s,，、]+/).filter(Boolean)) add(x);
    for (const e of g.edges) { add(e.u); add(e.v); }
    if (!fields.nodes) names.sort(natural);
    if (names.length > 10) throw new Error(`顶点最多 10 个（现在 ${names.length} 个）：存储的表放得下`);
    for (const a of ask) if (!['matrix', 'list', 'degree'].includes(a)) throw new Error(`ask: 图能问 matrix（新加的那一格）、list（边表）、degree（度），没有「${a}」`);
    return { kind: 'graph', ...g, names, show, insert, ask, algo: '' };
  }
  if (show.includes('seq')) {
    if (show.length > 1) throw new Error('show: seq（二叉树的顺序存储）单独用：tree: 要写成二叉树 A(B(, D), C)');
    const B = parseTree(fields.tree);
    for (const a of ask) if (a !== 'seq') throw new Error(`ask: 顺序存储能问 seq（放在第几个位置），没有「${a}」`);
    return { kind: 'bin', B, show, ask, insert };
  }
  const F = parseForest(fields.tree, 'tree');
  for (const a of ask) if (!['parent', 'child', 'cs'].includes(a)) throw new Error(`ask: 树能问 parent（双亲的下标）、child（孩子的下标）、cs（firstchild、nextsibling），没有「${a}」`);
  return { kind: 'tree', F, show, ask, insert };
}

// ================= 图 =================

// 存储的样子（照着边的前 k 条算）。mistake：'oneway' 无向边只存了一个方向；'flip' 头插尾插弄反了
function graphStore(input, k, mistake) {
  const { names, edges, directed, weighted } = input;
  const ins = mistake === 'flip' ? (input.insert === 'head' ? 'tail' : 'head') : input.insert;
  const put = (list, x) => (ins === 'head' ? list.unshift(x) : list.push(x));
  const idx = (x) => names.indexOf(x);
  const n = names.length;
  const matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (weighted ? (i === j ? 0 : '∞') : 0)));
  const list = Object.fromEntries(names.map((x) => [x, []]));
  const deg = Object.fromEntries(names.map((x) => [x, directed ? { out: 0, in: 0 } : 0]));
  const firstout = Object.fromEntries(names.map((x) => [x, null])), firstin = { ...firstout };
  const arcs = [];
  const firstedge = Object.fromEntries(names.map((x) => [x, null]));
  const medges = [];
  edges.slice(0, k).forEach((e, id) => {
    const w = weighted ? e.w : 1;
    matrix[idx(e.u)][idx(e.v)] = w;
    if (!directed && mistake !== 'oneway') matrix[idx(e.v)][idx(e.u)] = w;
    put(list[e.u], e.v);
    if (!directed && mistake !== 'oneway') put(list[e.v], e.u);
    if (directed) { deg[e.u].out++; deg[e.v].in++; } else { deg[e.u]++; deg[e.v]++; }
    if (directed) {
      // 十字链表：弧结点 (tailvex, headvex, hlink, tlink)。尾插：接在弧尾的出弧链、弧头的入弧链最后；头插：插在最前面
      const arc = { id, tail: e.u, head: e.v, w: e.w, tlink: null, hlink: null };
      arcs.push(arc);
      if (ins === 'head') { arc.tlink = firstout[e.u]; firstout[e.u] = id; arc.hlink = firstin[e.v]; firstin[e.v] = id; }
      else {
        if (firstout[e.u] === null) firstout[e.u] = id; else { let a = arcs[firstout[e.u]]; while (a.tlink !== null) a = arcs[a.tlink]; a.tlink = id; }
        if (firstin[e.v] === null) firstin[e.v] = id; else { let a = arcs[firstin[e.v]]; while (a.hlink !== null) a = arcs[a.hlink]; a.hlink = id; }
      }
    } else {
      // 邻接多重表：边结点 (ivex, ilink, jvex, jlink)；ilink 是依附 ivex 的下一条边，jlink 是依附 jvex 的下一条
      const ed = { id, ivex: e.u, jvex: e.v, w: e.w, ilink: null, jlink: null };
      medges.push(ed);
      const nextOf = (edge, x) => (edge.ivex === x ? 'ilink' : 'jlink');
      for (const x of [e.u, e.v]) {
        const mine = nextOf(ed, x);
        if (ins === 'head') { ed[mine] = firstedge[x]; firstedge[x] = id; }
        else if (firstedge[x] === null) firstedge[x] = id;
        else { let cur = medges[firstedge[x]]; while (cur[nextOf(cur, x)] !== null) cur = medges[cur[nextOf(cur, x)]]; cur[nextOf(cur, x)] = id; }
      }
    }
  });
  return { matrix, list, deg, cross: { firstout, firstin, arcs }, multi: { firstedge, edges: medges } };
}

const ekey = (e, directed) => (directed ? `${e.u}->${e.v}` : [e.u, e.v].join('-'));

function runGraph(input) {
  const { names, edges, directed, show } = input;
  const steps = [];
  const view = (k, extra = {}) => ({ k, ...graphStore(input, k, input.mistake), ...extra });
  const what = show.map((x) => GRAPH_SHOW[x]).join('、');
  steps.push({ view: view(0), msg: `${directed ? '有向' : '无向'}图，${names.length} 个顶点（按${input.insert === 'head' ? '头插' : '尾插'}建链表）。一条边一步，右边的${what}跟着长。${input.weighted ? '带权：邻接矩阵里对角线写 0，没有边的写 ∞。' : ''}` });
  edges.forEach((e, k) => {
    const v = view(k + 1, { cur: k });
    const i = names.indexOf(e.u), j = names.indexOf(e.v);
    const parts = [];
    if (show.includes('matrix')) parts.push(`A[${e.u}][${e.v}]${directed ? '' : ` 和 A[${e.v}][${e.u}]`} = ${input.weighted ? e.w : 1}`);
    if (show.includes('list')) parts.push(`${e.v} ${input.insert === 'head' ? '插到' : '接在'} ${e.u} 的边表${input.insert === 'head' ? '最前面' : '后面'}${directed ? '' : `，${e.u} 也${input.insert === 'head' ? '插到' : '接在'} ${e.v} 的边表里`}`);
    if (show.includes('cross')) parts.push(`弧 ${k}（${e.u}→${e.v}）挂进 ${e.u} 的出弧链和 ${e.v} 的入弧链`);
    if (show.includes('multi')) parts.push(`边 ${k}（${e.u}—${e.v}）同时挂进 ${e.u}、${e.v} 两条链`);
    // 外壳一步只问一个：matrix、list 都写了时一条边问一种（轮着来）
    const asks = [];
    const both = input.ask.includes('matrix') && input.ask.includes('list');
    if (input.ask.includes('matrix') && (!both || k % 2 === 0)) asks.push({ tag: 'matrix', kind: 'number', q: `加上 ${e.u}${directed ? '→' : '—'}${e.v} 以后，A[${e.u}][${e.v}] 是多少？`, answer: Number(v.matrix[i][j]) });
    if (input.ask.includes('list') && (!both || k % 2 === 1)) asks.push({ tag: 'list', kind: 'text', q: `加上这条边以后，${e.u} 的边表依次是？（顶点名，空格隔开）`, answer: v.list[e.u].join(' ') });
    steps.push({ view: v, msg: `加上边 ${e.u}${directed ? '→' : '—'}${e.v}${input.weighted ? `（权 ${e.w}）` : ''}：${parts.join('；')}。`, ...(asks.length ? { ask: asks[0], asks: asks.slice(1) } : {}) });
  });
  if (input.ask.includes('degree')) {
    // 度单独一步（外壳一步只问一个）：边都加完了再问
    const fin = graphStore(input, edges.length, input.mistake);
    const tot = (y) => (directed ? fin.deg[y].out + fin.deg[y].in : fin.deg[y]);
    const x = names.reduce((b, y) => (tot(y) > tot(b) ? y : b), names[0]);
    const hint = input.show.includes('matrix') ? `（数邻接矩阵第 ${x} 行不是 0 / ∞ 的格）` : input.show.includes('list') ? `（数 ${x} 的边表有几个结点）` : '';
    const right = graphStore(input, edges.length, null);
    steps.push({ view: view(edges.length), msg: directed ? `顶点 ${x} 的出度是 ${right.deg[x].out}、入度是 ${right.deg[x].in}。` : `顶点 ${x} 的度是 ${right.deg[x]}。`, ask: directed ? { tag: 'degree', kind: 'number', q: `顶点 ${x} 的出度是多少？${hint}`, answer: fin.deg[x].out } : { tag: 'degree', kind: 'number', q: `顶点 ${x} 的度是多少？`, answer: fin.deg[x] } });
  }
  return { steps, store: graphStore(input, edges.length, input.mistake) };
}

function graphView(s, input) {
  const { names, edges, directed } = input;
  const done = new Set(edges.slice(0, s.k).map((e) => ekey(e, directed)));
  let svg = graphSvg(input, { tree: [...done], edge: s.cur !== undefined ? ekey(edges[s.cur], directed) : null });
  // 还没加上的边：淡淡地画着（图的样子不跟着变）
  for (const e of edges) if (!done.has(ekey(e, directed))) svg = svg.replace(`class="sv-gedge" data-pick="${esc(ekey(e, directed))}"`, `class="sv-gedge sv-edge-later" data-pick="${esc(ekey(e, directed))}"`);
  const cur = s.cur !== undefined ? edges[s.cur] : null;
  const out = [['图', svg]];
  for (const k of input.show) {
    if (k === 'matrix') {
      const rows = names.map((x, i) => [{ html: esc(x), cls: 'sto-h' }, ...s.matrix[i].map((c, j) => ({ html: esc(c), cls: cur && ((names[i] === cur.u && names[j] === cur.v) || (!directed && names[i] === cur.v && names[j] === cur.u)) ? 'sv-new sto-hit' : '' }))]);
      out.push([GRAPH_SHOW.matrix, miniTable(['', ...names], rows, { cls: 'sto-mx' })]);
    }
    if (k === 'list') {
      const rows = names.map((x, i) => {
        const nodes = s.list[x].map((y) => `<span class="sto-node${cur && ((x === cur.u && y === cur.v) || (!directed && x === cur.v && y === cur.u)) ? ' sv-new' : ''}">${esc(names.indexOf(y))}<small>${esc(y)}</small></span>`).join('<span class="sto-arrow">→</span>');
        return `<div class="sto-list-row"><span class="sto-idx">${i}</span><span class="sto-head">${esc(x)}</span><span class="sto-arrow">→</span>${nodes || ''}<span class="sto-nil">${NIL}</span></div>`;
      }).join('');
      out.push([`${GRAPH_SHOW.list}（边结点写顶点的下标）`, `<div class="sto-list">${rows}</div>`]);
    }
    if (k === 'cross') {
      const p = (x) => (x === null ? NIL : `弧${x}`);
      const vt = miniTable(['顶点', 'firstin', 'firstout'], names.map((x) => [x, p(s.cross.firstin[x]), p(s.cross.firstout[x])]));
      const at = miniTable(['弧', 'tailvex', 'headvex', 'hlink', 'tlink'], s.cross.arcs.map((a) => [{ html: `弧${a.id}`, cls: s.cur === a.id ? 'sv-new' : '' }, `${names.indexOf(a.tail)}（${a.tail}）`, `${names.indexOf(a.head)}（${a.head}）`, p(a.hlink), p(a.tlink)]));
      out.push([`${GRAPH_SHOW.cross}（hlink：同一个弧头的下一条；tlink：同一个弧尾的下一条）`, vt + at]);
    }
    if (k === 'multi') {
      const p = (x) => (x === null ? NIL : `边${x}`);
      const vt = miniTable(['顶点', 'firstedge'], names.map((x) => [x, p(s.multi.firstedge[x])]));
      const et = miniTable(['边', 'ivex', 'ilink', 'jvex', 'jlink'], s.multi.edges.map((e) => [{ html: `边${e.id}`, cls: s.cur === e.id ? 'sv-new' : '' }, `${names.indexOf(e.ivex)}（${e.ivex}）`, p(e.ilink), `${names.indexOf(e.jvex)}（${e.jvex}）`, p(e.jlink)]));
      out.push([`${GRAPH_SHOW.multi}（ilink：依附 ivex 的下一条；jlink：依附 jvex 的下一条）`, vt + et]);
    }
  }
  return panels(out);
}

// ================= 树 =================

// 层序（双亲表示的编号）；mistake 'pre'：按先序编号
function treeOrder(F, mistake) {
  if (mistake === 'pre') {
    const out = [];
    const walk = (id) => { out.push(id); F.nodes[id].kids.forEach(walk); };
    F.roots.forEach(walk);
    return out;
  }
  const out = [], q = [...F.roots];
  while (q.length) { const id = q.shift(); out.push(id); q.push(...F.nodes[id].kids); }
  return out;
}

function treeStore(input, k, mistake) {
  const F = input.F;
  const order = treeOrder(F, mistake);
  const parentOf = {};
  for (const [id, n] of Object.entries(F.nodes)) for (const c of n.kids) parentOf[c] = id;
  const placed = order.slice(0, k);
  const key = (id) => F.nodes[id].key;
  const parent = placed.map((id) => [key(id), parentOf[id] === undefined ? -1 : order.indexOf(parentOf[id])]);
  const child = Object.fromEntries(placed.map((id) => [key(id), F.nodes[id].kids.filter((c) => placed.includes(c)).map((c) => order.indexOf(c))]));
  const cs = {};
  for (const id of placed) {
    const kids = F.nodes[id].kids;
    const sibs = parentOf[id] === undefined ? F.roots : F.nodes[parentOf[id]].kids;
    const nx = sibs[sibs.indexOf(id) + 1];
    cs[key(id)] = [kids[0] !== undefined && placed.includes(kids[0]) ? key(kids[0]) : null, nx !== undefined && placed.includes(nx) ? key(nx) : null];
  }
  return { parent, child, cs, order: order.map(key), placed };
}

function runTree(input) {
  const F = input.F, n = Object.keys(F.nodes).length;
  const order = treeOrder(F, null);
  const steps = [];
  const parentOf = {};
  for (const [id, nd] of Object.entries(F.nodes)) for (const c of nd.kids) parentOf[c] = id;
  const view = (k, extra = {}) => ({ k, ...treeStore(input, k, input.mistake), ...extra });
  steps.push({ view: view(0), msg: `${F.roots.length > 1 ? '森林' : '树'}，${n} 个结点。按层序（一层一层、每层从左往右）一个一个放进去，下标从 0 数。` });
  order.forEach((id, k) => {
    const key = F.nodes[id].key, v = view(k + 1, { cur: key });
    const p = parentOf[id];
    const wrong = treeStore(input, k + 1, input.mistake);
    const parts = [];
    if (input.show.includes('parent')) parts.push(`下标 ${k}，双亲${p === undefined ? '没有（根），写 −1' : `是 ${F.nodes[p].key}（下标 ${order.indexOf(p)}）`}`);
    if (input.show.includes('child') && p !== undefined) parts.push(`接进 ${F.nodes[p].key} 的孩子链`);
    if (input.show.includes('cs')) {
      const sibs = p === undefined ? F.roots : F.nodes[p].kids, i = sibs.indexOf(id);
      parts.push(i === 0 ? (p === undefined ? '是第一棵树的根' : `是 ${F.nodes[p].key} 的第一个孩子：${F.nodes[p].key} 的 firstchild 指它`) : `是 ${F.nodes[sibs[i - 1]].key} 右边的兄弟：${F.nodes[sibs[i - 1]].key} 的 nextsibling 指它`);
    }
    const asks = [];
    // 错法（按先序编号）也问同一个结点：它的双亲在那种编号里是第几个
    const orderM = treeOrder(F, input.mistake);
    const mine = p === undefined ? -1 : orderM.indexOf(p);
    if (input.ask.includes('parent')) asks.push({ tag: 'parent', kind: 'number', q: `${key} 放在下标 ${k}，它的双亲下标是多少？（根写 −1）`, answer: mine });
    if (input.ask.includes('cs') && p !== undefined) {
      const sibs = F.nodes[p].kids, i = sibs.indexOf(id);
      asks.push({ tag: 'cs', kind: 'choice', q: `${key} 挂在哪个指针上？`, choices: [`${F.nodes[p].key} 的 firstchild`, i > 0 ? `${F.nodes[sibs[i - 1]].key} 的 nextsibling` : `${F.nodes[p].key} 的 nextsibling`], answer: i === 0 ? `${F.nodes[p].key} 的 firstchild` : `${F.nodes[sibs[i - 1]].key} 的 nextsibling` });
    }
    if (input.ask.includes('child') && p !== undefined) asks.push({ tag: 'child', kind: 'text', q: `放完 ${key}，${F.nodes[p].key} 的孩子链是哪几个下标？（空格隔开）`, answer: wrong.child[F.nodes[p].key].join(' ') });
    steps.push({ view: v, msg: `放 ${key}：${parts.join('；')}。`, ...(asks.length ? { ask: asks[0], asks: asks.slice(1) } : {}) });
  });
  return { steps, store: treeStore(input, n, input.mistake) };
}

function treeView(s, input) {
  const F = input.F;
  const show = new Set(s.placed);
  const cls = s.cur ? Object.fromEntries(Object.entries(F.nodes).filter(([, nd]) => nd.key === s.cur).map(([id]) => [id, 'sv-cur'])) : {};
  const out = [[F.roots.length > 1 ? '森林' : '树', treesSvg({ nodes: F.nodes, pos: forestLayout(F, { gap: 0.6 }), edges: forestEdges(F) }, { cls, prefix: 'sf', pick: (id) => F.nodes[id].key })]];
  for (const k of input.show) {
    if (k === 'parent') out.push([TREE_SHOW.parent, miniTable(['下标', 'data', 'parent'], s.parent.map(([d, p], i) => [i, { html: esc(d), cls: d === s.cur ? 'sv-new' : '' }, p]))]);
    if (k === 'child') {
      const rows = s.parent.map(([d], i) => `<div class="sto-list-row"><span class="sto-idx">${i}</span><span class="sto-head">${esc(d)}</span><span class="sto-arrow">→</span>${s.child[d].map((c) => `<span class="sto-node">${c}</span>`).join('<span class="sto-arrow">→</span>')}<span class="sto-nil">${NIL}</span></div>`).join('');
      out.push([`${TREE_SHOW.child}（孩子链写下标）`, `<div class="sto-list">${rows}</div>`]);
    }
    if (k === 'cs') {
      // 先换成按结点名索引的森林（forest.js 的 toBinary 要这样的），再转成左孩子右兄弟的二叉树
      const K = (id) => F.nodes[id].key;
      const FK = { roots: F.roots.map(K), nodes: Object.fromEntries(Object.values(F.nodes).map((nd) => [nd.key, { key: nd.key, kids: nd.kids.map(K) }])) };
      const B = toBinary(FK);
      const placedKeys = new Set(s.parent.map(([d]) => d));
      const bsvg = treesSvg({ nodes: B.nodes, pos: binLayout(B), edges: binEdges(B) }, { show: placedKeys, cls: s.cur ? { [s.cur]: 'sv-cur' } : {}, prefix: 'sb', aria: '孩子兄弟（二叉树）', pick: (x) => x, edge: Object.fromEntries(Object.values(B.nodes).filter((nd) => nd.right).map((nd) => [nd.right, 'sv-edge-sib'])) });
      const tab = miniTable(['data', 'firstchild', 'nextsibling'], s.parent.map(([d]) => [{ html: esc(d), cls: d === s.cur ? 'sv-new' : '' }, s.cs[d][0] ?? NIL, s.cs[d][1] ?? NIL]));
      out.push([`${TREE_SHOW.cs}（左指针 firstchild，右指针 nextsibling）`, bsvg + tab]);
    }
  }
  return panels(out);
}

// ================= 二叉树的顺序存储 =================

function binSeq(B, k, mistake) {
  // 层序放结点（编号小的先放）；mistake 'zero'：下标从 0 数，孩子是 2i+1、2i+2——写出来的数组和从 1 数的一样，位置号差 1
  const pos = {};
  const walk = (id, i) => { if (id === null) return; pos[id] = i; walk(B.nodes[id].left, 2 * i); walk(B.nodes[id].right, 2 * i + 1); };
  walk(B.root, 1);
  const byPos = Object.entries(pos).sort((a, b) => a[1] - b[1]);
  const size = Math.max(...Object.values(pos));
  const arr = Array(size).fill('#');
  byPos.slice(0, k).forEach(([id, i]) => { arr[i - 1] = B.nodes[id].key; });
  return { seq: arr, pos: Object.fromEntries(byPos.map(([id, i]) => [B.nodes[id].key, mistake === 'zero' ? i - 1 : i])), order: byPos.map(([id]) => B.nodes[id].key) };
}

function runBin(input) {
  const B = input.B;
  const all = binSeq(B, Infinity, null);
  const steps = [{ view: { k: 0, ...binSeq(B, 0, null) }, msg: `二叉树的顺序存储：按完全二叉树编号，根是 1，编号 i 的左孩子 2i、右孩子 2i + 1，没有结点的位置空着（写 #）。一共要 ${all.seq.length} 个位置。` }];
  all.order.forEach((key, k) => {
    const v = { k: k + 1, ...binSeq(B, k + 1, null), cur: key };
    const i = all.pos[key];
    const mine = binSeq(B, Infinity, input.mistake).pos[key];
    steps.push({ view: v, msg: `${key} 编号 ${i}${i > 1 ? `（双亲编号 ${Math.floor(i / 2)}，是它的${i % 2 ? '右' : '左'}孩子）` : '（根）'}，放在 A[${i}]。`, ...(input.ask.includes('seq') ? { ask: { tag: 'seq', kind: 'number', q: `${key} 放在第几个位置？（根是 1）`, answer: mine } } : {}) });
  });
  return { steps, store: all };
}

function binView(s, input) {
  const B = input.B;
  const placed = new Set(s.order.slice(0, s.k));
  const svg = treesSvg({ nodes: B.nodes, pos: binLayout(B), edges: binEdges(B) }, { show: new Set(Object.keys(B.nodes).filter((id) => placed.has(B.nodes[id].key))), cls: Object.fromEntries(Object.keys(B.nodes).filter((id) => B.nodes[id].key === s.cur).map((id) => [id, 'sv-cur'])), prefix: 'sq', pick: (id) => B.nodes[id].key });
  const row = seqRow('A', s.seq.map((x) => ({ text: x, cls: x === '#' ? 'sv-empty' : x === s.cur ? 'sv-cur' : '' })), { idx: { label: '下标', cells: s.seq.map((_, i) => String(i + 1)) } });
  return panels([['二叉树', svg], [TREE_SHOW.seq, row]]);
}

// ================= 外壳要的几样 =================

export function run(input) {
  return input.kind === 'graph' ? runGraph(input) : input.kind === 'tree' ? runTree(input) : runBin(input);
}

export function view(s, input) {
  return input.kind === 'graph' ? graphView(s, input) : input.kind === 'tree' ? treeView(s, input) : binView(s, input);
}

// 题图（quiz、fill 看不到演示）：原来的图 / 树，整个画出来
function pictureOf(input) {
  if (input.kind === 'graph') return graphSvg(input, {});
  if (input.kind === 'bin') return treesSvg({ nodes: input.B.nodes, pos: binLayout(input.B), edges: binEdges(input.B) }, { prefix: 'sqq', pick: () => '' });
  return treesSvg({ nodes: input.F.nodes, pos: forestLayout(input.F, { gap: 0.6 }), edges: forestEdges(input.F) }, { prefix: 'sfq', pick: () => '' });
}

export function quiz(input, r) {
  return { ...quiz0(input, r), qhtml: pictureOf(input) };
}
function quiz0(input, r) {
  const st = r.store;
  if (input.kind === 'graph') {
    // 问哪个顶点按对的存储挑（错法也问同一个顶点，答案才比得上）
    const right = graphStore(input, input.edges.length, null);
    const x = input.names.find((y) => right.list[y].length >= 2) || input.names[0];
    const first = input.show[0];
    if (first === 'cross') return { q: `画出这个有向图的十字链表，写出顶点 ${x} 的出弧依次指向哪些顶点。`, type: 'seq', answer: outArcs(st.cross, x).join(' ') };
    if (first === 'multi') return { q: `画出这个无向图的邻接多重表，写出依附顶点 ${x} 的边依次连着哪些顶点。`, type: 'seq', answer: st.list[x].join(' ') };
    return { q: `按${input.insert === 'head' ? '头插' : '尾插'}建邻接表，写出顶点 ${x} 的边表（依次是哪些顶点）。`, type: 'seq', answer: st.list[x].join(' ') };
  }
  if (input.kind === 'bin') return { q: '写出这棵二叉树的顺序存储（从 A[1] 开始，空的位置写 #）。', type: 'seq', answer: st.seq.join(' ') };
  return { q: '按层序编号（下标从 0 数），写出双亲表示法里每个结点的 parent（根写 −1）。', type: 'seq', answer: st.parent.map(([, p]) => p).join(' ') };
}
function outArcs(cross, x) {
  const out = [];
  for (let a = cross.firstout[x]; a !== null; a = cross.arcs[a].tlink) out.push(cross.arcs[a].head);
  return out;
}

export function table(input, r) {
  const t = table0(input, r);
  return t && { ...t, qhtml: pictureOf(input) };
}
function table0(input, r) {
  const st = r.store;
  if (input.kind === 'graph' && input.show.includes('matrix')) {
    return { q: '把这个图的邻接矩阵填完整。', dir: 'row', head: input.names, rows: input.names.map((x, i) => ({ label: x, cells: st.matrix[i].map((c) => ({ v: String(c), num: c !== '∞' })) })) };
  }
  if (input.kind === 'tree' && input.show.includes('parent')) {
    return { q: '按层序编号（下标从 0 数），填出双亲表示法的 parent 一列（根写 −1）。', dir: 'row', head: ['parent'], rows: st.parent.map(([d, p], i) => ({ label: `${i} ${d}`, cells: [{ v: String(p), num: true }] })) };
  }
  if (input.kind === 'bin') return { q: '把这棵二叉树按顺序存储填进数组（从 A[1] 开始，空的写 #）。', dir: 'row', head: st.seq.map((_, i) => `${i + 1}`), rows: [{ label: 'A', cells: st.seq.map((x) => ({ v: x })) }] };
  return null;
}

// 常见错法（只给老师看）：只列答案和对的不一样的
export function variants(input) {
  const all = input.kind === 'graph'
    ? [
      ...(!input.directed ? [{ label: '像是无向边只存了一个方向（邻接矩阵不对称、另一头的边表里少了它）', input: { ...input, mistake: 'oneway' } }] : []),
      ...(input.show.some((k) => k !== 'matrix') ? [{ label: input.insert === 'head' ? '像是按尾插建的链表（题里是头插：后来的边在最前面）' : '像是按头插建的链表（题里是尾插：按边的先后接在后面）', input: { ...input, mistake: 'flip' } }] : []),
    ]
    : input.kind === 'tree'
      ? [{ label: '像是按先序给结点编号了（双亲表示法按层序编号）', input: { ...input, mistake: 'pre' } }]
      : [{ label: '像是下标从 0 数了（根放在 A[0]，孩子是 2i+1、2i+2）', input: { ...input, mistake: 'zero' } }];
  const right = JSON.stringify(quiz(input, run(input)).answer);
  return all.filter((v) => JSON.stringify(quiz(v.input, run(v.input)).answer) !== right || input.kind === 'bin');
}

export const storeEngine = { name: 'store', title: '存储结构', parse, run, view, quiz, table, variants };
