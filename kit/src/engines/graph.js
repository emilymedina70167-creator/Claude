// 图的演示引擎（组件 net；和函数图 graph 不是一回事）：
//   bfs / dfs（广度、深度优先遍历）、prim / kruskal（最小生成树）、dijkstra / floyd（最短路径）、
//   topo（拓扑排序）、critical（AOE 网的关键路径）。一律按王道的做法，教材里「有好几种都对」的地方写清楚按什么规则走。
// 纯函数，不碰 DOM（tests/graph-engine.test.js）。
import { chips, esc } from './arrayview.js';

const ALGOS = { bfs: '广度优先遍历', dfs: '深度优先遍历', prim: 'Prim 算法', kruskal: 'Kruskal 算法', dijkstra: 'Dijkstra 算法', floyd: 'Floyd 算法', topo: '拓扑排序', critical: '关键路径' };
const ALIAS = { bfs: 'bfs', 广度: 'bfs', 广度优先: 'bfs', dfs: 'dfs', 深度: 'dfs', 深度优先: 'dfs', prim: 'prim', kruskal: 'kruskal', dijkstra: 'dijkstra', 迪杰斯特拉: 'dijkstra', floyd: 'floyd', 弗洛伊德: 'floyd', topo: 'topo', topological: 'topo', 拓扑: 'topo', 拓扑排序: 'topo', critical: 'critical', 关键路径: 'critical', aoe: 'critical' };
const INF = Infinity;
const inf = (x) => (x === INF ? '∞' : String(x));
const MAX_V = 14;

// —— 写法 ——

/** edges: A-B 4, A-C 2, B->C 1（- 是无向边，-> 是有向边，权值可以不写） */
export function parseEdges(src) {
  const parts = String(src ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) throw new Error('net 要写 edges:（如 A-B 4, A-C 2, B->D 5；- 是无向边，-> 是有向边）');
  const edges = [];
  let dir = null;
  for (const p of parts) {
    const m = /^([\w一-龥']+)\s*(->|→|-|—|–)\s*([\w一-龥']+)(?:\s*[:：=]?\s*(-?\d+(?:\.\d+)?))?$/.exec(p);
    if (!m) throw new Error(`edges: 看不懂「${p}」，写成 A-B 4（无向边，权 4）或 A->B 4（有向边）`);
    const d = m[2] === '->' || m[2] === '→';
    if (dir !== null && dir !== d) throw new Error('edges: 有向边（->）和无向边（-）不能混着写');
    dir = d;
    if (m[1] === m[3]) throw new Error(`edges: 「${p}」是自环，这里不画`);
    edges.push({ u: m[1], v: m[3], w: m[4] === undefined ? null : Number(m[4]), k: edges.length });
  }
  const weighted = edges.some((e) => e.w !== null);
  if (weighted && edges.some((e) => e.w === null)) throw new Error('edges: 有的边写了权值、有的没写：要么都写，要么都不写');
  const seen = new Set();
  for (const e of edges) {
    const key = dir ? `${e.u}>${e.v}` : [e.u, e.v].sort().join('-');
    if (seen.has(key)) throw new Error(`edges: ${e.u}${dir ? '->' : '-'}${e.v} 写了两次`);
    seen.add(key);
  }
  return { edges, directed: !!dir, weighted };
}

export function parse(fields) {
  const g = parseEdges(fields.edges);
  const names = [];
  const add = (x) => { if (!names.includes(x)) names.push(x); };
  if (fields.nodes) for (const x of String(fields.nodes).trim().split(/[\s,，、]+/).filter(Boolean)) add(x);
  for (const e of g.edges) { add(e.u); add(e.v); }
  if (fields.nodes) {
    const listed = new Set(String(fields.nodes).trim().split(/[\s,，、]+/).filter(Boolean));
    const extra = names.filter((x) => !listed.has(x));
    if (extra.length) throw new Error(`edges 里的顶点 ${extra.join('、')} 没写在 nodes: 里`);
  }
  // 没写 nodes: 时按名字排（1 < 2 < 10，A < B，V2 < V10），这就是「顶点编号」的顺序
  if (!fields.nodes) names.sort(natural);
  if (names.length > MAX_V) throw new Error(`顶点最多 ${MAX_V} 个（现在 ${names.length} 个）`);
  const runSrc = String(fields.run || '').trim();
  const m = /^(\S+)(?:\s+(?:from\s+)?(\S+))?$/i.exec(runSrc);
  if (!runSrc || !m) throw new Error(`net 要写 run:（${Object.entries(ALGOS).map(([k, v]) => `${k} ${v}`).join('、')}；bfs、dfs、prim、dijkstra 后面写起点：run: dijkstra from A）`);
  const algo = ALIAS[m[1].toLowerCase()];
  if (!algo) throw new Error(`run: 不认识「${m[1]}」，可以写 ${Object.keys(ALGOS).join('、')}`);
  let start = m[2];
  const needStart = ['bfs', 'dfs', 'prim', 'dijkstra'].includes(algo);
  if (needStart && !start) start = names[0];
  if (start && !names.includes(start)) throw new Error(`run: 起点 ${start} 不在图里`);
  if (['prim', 'kruskal'].includes(algo) && g.directed) throw new Error(`${ALGOS[algo]}是对无向图的，edges 要写成 A-B`);
  if (['prim', 'kruskal', 'dijkstra', 'floyd', 'critical'].includes(algo) && !g.weighted) throw new Error(`${ALGOS[algo]}要带权的图：edges 写成 A-B 4`);
  if (['topo', 'critical'].includes(algo) && !g.directed) throw new Error(`${ALGOS[algo]}是对有向图的，edges 要写成 A->B`);
  if (algo === 'dijkstra' && g.edges.some((e) => e.w < 0)) throw new Error('Dijkstra 不能有负权的边');
  const order = String(fields.order || 'vertex').trim().toLowerCase();
  if (!['vertex', 'list'].includes(order)) throw new Error('order: 写 vertex（邻接点按顶点编号的顺序，默认）或 list（按 edges 里写的顺序，就是邻接表的顺序）');
  const pos = fields.pos ? parsePos(fields.pos, names) : null;
  const use = String(fields.use || '').trim().toLowerCase();
  return { ...g, names, algo, start, order, pos, use, pair: fields.pair };
}

const natural = (a, b) => {
  const pa = /^(\D*)(\d*)$/.exec(a), pb = /^(\D*)(\d*)$/.exec(b);
  if (pa && pb && pa[1] === pb[1] && pa[2] && pb[2]) return Number(pa[2]) - Number(pb[2]);
  return a < b ? -1 : a > b ? 1 : 0;
};

function parsePos(src, names) {
  const pos = {};
  const re = /([\w一-龥']+)\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g;
  let m;
  while ((m = re.exec(String(src)))) pos[m[1]] = [Number(m[2]), Number(m[3])];
  const miss = names.filter((x) => !pos[x]);
  if (miss.length) throw new Error(`pos: 要给每个顶点写位置，${miss.join('、')} 没写（写法：A(0,0) B(2,1)，y 往上）`);
  return pos;
}

// 邻接点：order: vertex 按顶点编号，order: list 按 edges 里写的顺序
function adjacency({ names, edges, directed, order }) {
  const adj = Object.fromEntries(names.map((x) => [x, []]));
  for (const e of edges) {
    adj[e.u].push({ to: e.v, w: e.w, e });
    if (!directed) adj[e.v].push({ to: e.u, w: e.w, e });
  }
  if (order === 'vertex') for (const x of names) adj[x].sort((a, b) => names.indexOf(a.to) - names.indexOf(b.to));
  return adj;
}
const ekey = (e, directed) => (directed ? `${e.u}->${e.v}` : [e.u, e.v].join('-'));

export function run(input) {
  const r = { bfs: bfs, dfs: dfs, prim, kruskal, dijkstra, floyd, topo, critical }[input.algo](input);
  addOrderAsk(input, r);
  return r;
}

// 整个序列「先别往下看，按顺序在图上点出来」：挂在第 1 步上（ask: order）。
// 答案不唯一的（拓扑排序有好几种、Dijkstra / Prim 有一样近的）把每一种都算对；太多了就不问
const ORDER_Q = {
  bfs: '先别往下看：按广度优先的顺序，在图上依次点出所有顶点。',
  dfs: '先别往下看：按深度优先的顺序，在图上依次点出所有顶点。',
  topo: '先别往下看：在图上依次点出一个拓扑序列。',
  dijkstra: '先别往下看：在图上依次点出顶点加入集合 S 的顺序（从起点开始）。',
  prim: '先别往下看：在图上依次点出顶点加进树里的顺序（从起点开始）。',
};
function addOrderAsk(input, r) {
  const q = ORDER_Q[input.algo];
  if (!q || r.steps.length < 2) return;
  let answer = '';
  if (input.algo === 'bfs' || input.algo === 'dfs') answer = r.passes[0].join(' ');
  else if (input.algo === 'topo') {
    if (!r.ok) return;
    if (input.use === 'stack') answer = r.passes[0].join(' ');
    else { const all = allTopo(input, 31); if (all.length > 30) return; answer = all.map((x) => x.join(' ')).join(' | '); }
  } else if (input.algo === 'dijkstra') {
    if (r.tie || !r.order?.length) return;
    answer = [input.start, ...r.order.filter((x) => x !== input.start)].join(' ');
  } else if (input.algo === 'prim') {
    if (r.tie || !r.order?.length) return;
    answer = r.order.join(' ');
  }
  if (!answer) return;
  r.steps[1].asks = [...(r.steps[1].asks || []), { tag: 'order', kind: 'order', q, answer }];
}

// —— 遍历 ——
function bfs(g) {
  const adj = adjacency(g);
  const steps = [];
  const seen = new Set(), order = [];
  const tree = new Set();
  const v = (extra = {}) => ({ done: [...seen], tree: [...tree], seq: order.slice(), ...extra });
  steps.push({ view: v({ queue: [] }), msg: `从 ${g.start} 出发广度优先：访问一个顶点后，把它没访问过的邻接点都访问、依次入队；再从队头取下一个。邻接点${g.order === 'list' ? '按邻接表（edges 写的顺序）' : '按顶点编号'}的顺序。` });
  const roots = [g.start, ...g.names.filter((x) => x !== g.start)];
  for (const r of roots) {
    if (seen.has(r)) continue;
    if (r !== g.start) steps.push({ view: v({ queue: [] }), msg: `还有没访问到的顶点（图不连通）：从 ${r} 再开始一次。` });
    seen.add(r); order.push(r);
    const q = [r];
    steps.push({ view: v({ cur: r, queue: q.slice(), fresh: [r] }), msg: `访问 ${r}，入队。`, ask: { tag: 'visit', kind: 'pick', q: `${order.length === 1 ? '第一个' : '下一个'}访问的顶点是？点出来。`, answer: r } });
    while (q.length) {
      const x = q.shift();
      steps.push({ view: v({ cur: x, queue: q.slice() }), msg: `队头 ${x} 出队，看它的邻接点：${adj[x].map((a) => `${a.to}${seen.has(a.to) ? '（已访问）' : ''}`).join('、') || '没有'}。` });
      for (const a of adj[x]) {
        if (seen.has(a.to)) continue;
        seen.add(a.to); order.push(a.to); q.push(a.to);
        tree.add(ekey(a.e, g.directed));
        steps.push({ view: v({ cur: a.to, from: x, queue: q.slice(), fresh: [a.to], edge: ekey(a.e, g.directed) }), msg: `访问 ${x} 的邻接点 ${a.to}，入队。`, ask: { tag: 'visit', kind: 'pick', q: '下一个访问的顶点是？点出来。', answer: a.to } });
      }
    }
  }
  steps.push({ view: v({}), msg: `广度优先遍历序列：${order.join(' ')}。` });
  return { steps, passes: [order] };
}

function dfs(g) {
  const adj = adjacency(g);
  const steps = [];
  const seen = new Set(), order = [], tree = new Set();
  const v = (extra = {}) => ({ done: [...seen], tree: [...tree], seq: order.slice(), ...extra });
  steps.push({ view: v({ stack: [] }), msg: `从 ${g.start} 出发深度优先：访问一个顶点，接着访问它第一个没访问过的邻接点，一直往深处走；走不动了就退回上一个顶点。邻接点${g.order === 'list' ? '按邻接表（edges 写的顺序）' : '按顶点编号'}的顺序。` });
  const rec = (x, stack, from, e) => {
    seen.add(x); order.push(x);
    if (e) tree.add(ekey(e, g.directed));
    const st = [...stack, x];
    steps.push({ view: v({ cur: x, stack: st, fresh: [x], edge: e ? ekey(e, g.directed) : null }), msg: from ? `${from} 的下一个没访问过的邻接点是 ${x}：访问它，往深处走。` : `访问 ${x}。`, ask: { tag: 'visit', kind: 'pick', q: `${order.length === 1 ? '第一个' : '下一个'}访问的顶点是？点出来。`, answer: x } });
    for (const a of adj[x]) if (!seen.has(a.to)) rec(a.to, st, x, a.e);
    steps.push({ view: v({ cur: x, stack: st }), msg: `${x} 的邻接点都访问过了，${stack.length ? `退回 ${stack.at(-1)}` : '这一次的遍历结束'}。` });
  };
  for (const r of [g.start, ...g.names.filter((x) => x !== g.start)]) {
    if (seen.has(r)) continue;
    if (r !== g.start) steps.push({ view: v({ stack: [] }), msg: `还有没访问到的顶点（图不连通）：从 ${r} 再开始一次。` });
    rec(r, [], null, null);
  }
  steps.push({ view: v({}), msg: `深度优先遍历序列：${order.join(' ')}。` });
  return { steps, passes: [order] };
}

// —— 最小生成树 ——
function prim(g) {
  const adj = adjacency({ ...g, order: 'vertex' });
  const n = g.names.length;
  const inT = new Set([g.start]);
  const tree = new Set();
  const steps = [];
  let total = 0;
  const v = (extra = {}) => ({ done: [...inT], tree: [...tree], total, ...extra });
  steps.push({ view: v({ cur: g.start }), msg: `Prim：从 ${g.start} 开始，每次在「一头在树里、一头在树外」的边里挑权最小的，把树外那头加进来，直到 ${n} 个顶点都进来。` });
  const order = [g.start];
  let tie = false;
  while (inT.size < n) {
    let best = null;
    for (const x of g.names) {
      if (!inT.has(x)) continue;
      for (const a of adj[x]) if (!inT.has(a.to) && (!best || a.w < best.w || (a.w === best.w && g.names.indexOf(a.to) < g.names.indexOf(best.to)))) best = { from: x, to: a.to, w: a.w, e: a.e };
    }
    // 一样小的边通向别的顶点：加进来的顺序就不唯一
    if (best) for (const x of inT) for (const a of adj[x]) if (!inT.has(a.to) && a.w === best.w && a.to !== best.to) tie = true;
    if (best) order.push(best.to);
    if (!best) { steps.push({ view: v(), msg: '图不连通：剩下的顶点连不进来，没有生成树。' }); break; }
    const cands = [];
    for (const x of inT) for (const a of adj[x]) if (!inT.has(a.to)) cands.push(ekey(a.e, false));
    inT.add(best.to);
    tree.add(ekey(best.e, false));
    total += best.w;
    steps.push({ view: v({ cur: best.to, cand: cands, edge: ekey(best.e, false), fresh: [best.to] }), msg: `横跨树内外的边里最小的是 (${best.from}, ${best.to})，权 ${best.w}：把 ${best.to} 加进来。`, ask: { tag: 'next', kind: 'pick', q: '下一个加进树里的顶点是？点出来。', answer: best.to } });
  }
  steps.push({ view: v(), msg: `最小生成树的权值之和是 ${total}。` });
  return { steps, passes: [[total]], total, order, tie };
}

function kruskal(g) {
  const parent = Object.fromEntries(g.names.map((x) => [x, x]));
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const sorted = g.edges.slice().sort((a, b) => a.w - b.w || a.k - b.k);
  const tree = new Set(), rej = new Set();
  const steps = [];
  let total = 0, count = 0;
  const n = g.names.length;
  const comps = () => { const m = {}; for (const x of g.names) (m[find(x)] ||= []).push(x); return Object.values(m).map((c) => c.join('')).join(' | '); };
  const v = (extra = {}) => ({ tree: [...tree], rej: [...rej], total, comps: comps(), ...extra });
  steps.push({ view: v(), msg: `Kruskal：把边按权从小到大排（${sorted.map((e) => `(${e.u},${e.v})${e.w}`).join(' ')}），依次看：两头不在同一个连通分量里就选，在同一个分量里（会成环）就不要。` });
  for (const e of sorted) {
    if (count === n - 1) break;
    const a = find(e.u), b = find(e.v);
    const take = a !== b;
    const k = ekey(e, false);
    if (take) { parent[a] = b; tree.add(k); total += e.w; count++; } else rej.add(k);
    steps.push({ view: v({ edge: k, cur2: [e.u, e.v] }), msg: take ? `(${e.u}, ${e.v}) 权 ${e.w}：两头在不同的连通分量里，选它。` : `(${e.u}, ${e.v}) 权 ${e.w}：${e.u} 和 ${e.v} 已经连通了，选它会成环，不要。`, ask: { tag: 'take', kind: 'choice', q: `(${e.u}, ${e.v}) 权 ${e.w}：选不选？`, choices: ['选', '不选（会成环）'], answer: take ? '选' : '不选（会成环）' } });
  }
  steps.push({ view: v(), msg: count === n - 1 ? `选够了 ${n - 1} 条边，最小生成树的权值之和是 ${total}。` : '边看完了还没连通所有顶点：图不连通。' });
  return { steps, passes: [[total]], total };
}

// —— 最短路径 ——
function dijkstra(g) {
  const adj = adjacency({ ...g, order: 'vertex' });
  const N = g.names;
  const dist = Object.fromEntries(N.map((x) => [x, INF]));
  const path = Object.fromEntries(N.map((x) => [x, null]));
  const fin = new Set();
  dist[g.start] = 0;
  const hist = []; // 每一轮：{ pick, dist: {...} }
  let tie = false; // 有一轮出现一样近的：加入 S 的顺序不唯一
  const steps = [];
  const snapT = () => ({ dist: { ...dist }, path: { ...path }, final: [...fin] });
  const treeEdges = () => N.filter((x) => path[x] !== null && fin.has(x)).map((x) => findKey(g, path[x], x));
  steps.push({ view: { table: snapT(), hist: [], done: [], tree: [] }, msg: `Dijkstra：dist 记从 ${g.start} 出发、目前知道的最短距离（∞ 是还到不了），path 记最短路径上的前驱。每一轮在还没确定的顶点里挑 dist 最小的确定下来，再用它去更新邻接点的 dist。` });
  for (let round = 1; round <= N.length; round++) {
    let u = null;
    for (const x of N) if (!fin.has(x) && dist[x] !== INF && (u === null || dist[x] < dist[u])) u = x;
    if (u === null) { steps.push({ view: { table: snapT(), hist: hist.slice(), done: [...fin], tree: treeEdges() }, msg: '剩下的顶点都到不了（dist 是 ∞），结束。' }); break; }
    const ties = N.filter((x) => !fin.has(x) && dist[x] === dist[u]);
    if (ties.length > 1) tie = true;
    fin.add(u);
    const changed = [];
    for (const a of adj[u]) {
      if (fin.has(a.to)) continue;
      const nd = g.primLike ? a.w : dist[u] + a.w; // primLike：常见错法，只看边权
      if (nd < dist[a.to]) { dist[a.to] = nd; path[a.to] = u; changed.push(a.to); }
    }
    hist.push({ pick: u, dist: { ...dist }, final: [...fin] });
    steps.push({
      view: { table: snapT(), hist: hist.slice(), cur: u, done: [...fin], tree: treeEdges(), changed },
      msg: `第 ${round} 轮：没确定的顶点里 dist 最小的是 ${u}（${dist[u]}），确定它。${changed.length ? `经过 ${u} 更近了的：${changed.map((x) => `${x} → ${dist[x]}`).join('、')}。` : '它的邻接点都没有变近。'}`,
      ask: { tag: 'next', kind: 'pick', q: `第 ${round} 轮确定的是哪个顶点？点出来。`, alts: ties },
    });
  }
  const routes = N.filter((x) => x !== g.start).map((x) => `${x}：${dist[x] === INF ? '到不了' : `${dist[x]}（${routeOf(path, g.start, x).join('→')}）`}`);
  steps.push({ view: { table: snapT(), hist: hist.slice(), done: [...fin], tree: treeEdges() }, msg: `从 ${g.start} 到各顶点的最短路径：${routes.join('；')}。` });
  return { steps, passes: [N.map((x) => inf(dist[x]))], dist, path, order: hist.map((h) => h.pick), tie };
}
function findKey(g, a, b) {
  const e = g.edges.find((x) => (x.u === a && x.v === b) || (!g.directed && x.u === b && x.v === a));
  return e ? ekey(e, g.directed) : '';
}
function routeOf(path, s, x) { const r = [x]; while (r[0] !== s && path[r[0]] !== null) r.unshift(path[r[0]]); return r; }

function floyd(g) {
  const N = g.names, n = N.length;
  const A = N.map((x, i) => N.map((y, j) => (i === j ? 0 : INF)));
  for (const e of g.edges) {
    const i = N.indexOf(e.u), j = N.indexOf(e.v);
    A[i][j] = e.w;
    if (!g.directed) A[j][i] = e.w;
  }
  const steps = [];
  steps.push({ view: { mat: A.map((r) => r.slice()), k: -1 }, msg: `Floyd：A⁽⁻¹⁾ 是邻接矩阵（没有边是 ∞）。第 k 轮允许经过顶点 ${N[0]}…（第 k 个顶点）中转：A[i][j] = min(A[i][j], A[i][k] + A[k][j])。` });
  for (let k = 0; k < n; k++) {
    const changed = [];
    const B = A.map((r) => r.slice());
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (A[i][k] + A[k][j] < A[i][j]) { B[i][j] = A[i][k] + A[k][j]; changed.push([i, j]); }
    for (let i = 0; i < n; i++) A[i] = B[i];
    steps.push({ view: { mat: A.map((r) => r.slice()), k, changed }, msg: `A⁽${k}⁾：允许经过 ${N[k]} 中转。${changed.length ? `变小了的：${changed.map(([i, j]) => `${N[i]}→${N[j]} = ${A[i][j]}`).join('、')}。` : '没有变小的。'}` });
  }
  return { steps, passes: [A.flat().map(inf)], mat: A };
}

// —— 拓扑排序、关键路径 ——
function indegrees(g) {
  const d = Object.fromEntries(g.names.map((x) => [x, 0]));
  for (const e of g.edges) d[e.v]++;
  return d;
}
// 所有拓扑序列（最多 limit 个；quiz 里几种都算对）
export function allTopo(g, limit = 400) {
  const adj = adjacency({ ...g, order: 'vertex' });
  const deg = indegrees(g);
  const out = [], cur = [], used = new Set();
  const rec = () => {
    if (out.length >= limit) return;
    if (cur.length === g.names.length) { out.push(cur.slice()); return; }
    for (const x of g.names) {
      if (used.has(x) || deg[x] !== 0) continue;
      used.add(x); cur.push(x);
      for (const a of adj[x]) deg[a.to]--;
      rec();
      for (const a of adj[x]) deg[a.to]++;
      used.delete(x); cur.pop();
    }
  };
  rec();
  return out;
}

function topo(g) {
  const adj = adjacency({ ...g, order: 'vertex' });
  const deg = indegrees(g);
  const done = [];
  const steps = [];
  const stackMode = g.use === 'stack';
  const st = stackMode ? g.names.filter((x) => deg[x] === 0) : null;
  const v = (extra = {}) => ({ deg: { ...deg }, done: done.slice(), seq: done.slice(), stack: st ? st.slice() : null, ...extra });
  steps.push({ view: v(), msg: stackMode ? '拓扑排序（王道的代码，用栈）：入度为 0 的顶点先都入栈；每次出栈一个、输出，把它的出边删掉，入度变成 0 的顶点入栈。' : '拓扑排序：每次选一个入度为 0 的顶点输出（有好几个时这里按顶点编号选最小的；选别的也对），删掉它和它的出边，再找下一个。' });
  while (done.length < g.names.length) {
    const zero = g.names.filter((x) => !done.includes(x) && deg[x] === 0);
    let x;
    if (stackMode) { if (!st.length) break; x = st.pop(); } else { if (!zero.length) break; x = zero[0]; }
    done.push(x);
    const freed = [];
    for (const a of adj[x]) { deg[a.to]--; if (deg[a.to] === 0) { freed.push(a.to); if (stackMode) st.push(a.to); } }
    steps.push({ view: v({ cur: x, fresh: [x], cut: x }), msg: `${stackMode ? '出栈' : '入度为 0 的有'}${stackMode ? ` ${x}` : `：${zero.join('、')}，选 ${x}`}，输出。删掉它的出边${adj[x].length ? `（${adj[x].map((a) => a.to).join('、')} 的入度各减 1）` : ''}${freed.length ? `，${freed.join('、')} 的入度变成 0${stackMode ? '，入栈' : ''}` : ''}。`, ask: { tag: 'next', kind: 'pick', q: '下一个输出的顶点是？点出来。', alts: stackMode ? [x] : zero } });
  }
  const ok = done.length === g.names.length;
  steps.push({ view: v(), msg: ok ? `拓扑序列：${done.join(' ')}。` : `还剩 ${g.names.length - done.length} 个顶点，入度都不是 0：图里有回路，没有拓扑序列。` });
  return { steps, passes: [done], ok };
}

function critical(g) {
  const N = g.names;
  const adj = adjacency({ ...g, order: 'vertex' });
  const radj = Object.fromEntries(N.map((x) => [x, []]));
  for (const e of g.edges) radj[e.v].push({ from: e.u, w: e.w, e });
  const t = allTopo(g, 1)[0];
  if (!t) throw new Error('图里有回路，没有关键路径');
  const steps = [];
  const ve = {}, vl = {};
  const v = (extra = {}) => ({ ve: { ...ve }, vl: { ...vl }, ...extra });
  steps.push({ view: v(), msg: `关键路径：先按拓扑序（${t.join(' ')}）从前往后求每个事件的最早发生时间 ve，再从后往前求最迟发生时间 vl；活动的最早开始 e = ve(起点)，最迟开始 l = vl(终点) − 权，l − e = 0 的是关键活动。` });
  for (const x of t) {
    const ins = radj[x];
    ve[x] = ins.length ? Math.max(...ins.map((a) => ve[a.from] + a.w)) : 0;
    steps.push({ view: v({ cur: x }), msg: ins.length ? `ve(${x}) = max{ ${ins.map((a) => `ve(${a.from}) + ${a.w} = ${ve[a.from] + a.w}`).join('，')} } = ${ve[x]}。` : `${x} 是源点：ve(${x}) = 0。`, ask: { tag: 've', kind: 'number', q: `ve(${x}) 是多少？`, answer: ve[x] } });
  }
  const sink = t[t.length - 1];
  for (const x of t.slice().reverse()) {
    const outs = adj[x];
    vl[x] = outs.length ? Math.min(...outs.map((a) => vl[a.to] - a.w)) : ve[sink];
    steps.push({ view: v({ cur: x }), msg: outs.length ? `vl(${x}) = min{ ${outs.map((a) => `vl(${a.to}) − ${a.w} = ${vl[a.to] - a.w}`).join('，')} } = ${vl[x]}。` : `${x} 是汇点：vl(${x}) = ve(${x}) = ${vl[x]}。`, ask: { tag: 'vl', kind: 'number', q: `vl(${x}) 是多少？`, answer: vl[x] } });
  }
  const acts = g.edges.map((e) => ({ e, key: ekey(e, true), early: ve[e.u], late: vl[e.v] - e.w }));
  const crit = acts.filter((a) => a.late === a.early);
  steps.push({ view: v({ acts, crit: crit.map((a) => a.key) }), msg: `每个活动：e = ve(起点)，l = vl(终点) − 权，l − e 是时间余量。余量为 0 的是关键活动：${crit.map((a) => `<${a.e.u},${a.e.v}>`).join('、')}。关键路径长度 ${ve[sink]}。` , ask: { tag: 'length', kind: 'number', q: '关键路径的长度（整个工程最短要多久）是多少？', answer: ve[sink] } });
  return { steps, passes: [[ve[sink]]], length: ve[sink], crit: crit.map((a) => a.key), ve, vl, acts };
}

// —— 画 ——

function layoutOf(input) {
  const N = input.names;
  if (input.pos) return Object.fromEntries(N.map((x) => [x, [input.pos[x][0], -input.pos[x][1]]]));
  if (input.directed && ['topo', 'critical'].includes(input.algo)) {
    // 有向无环图：按最长路径分层，从左往右
    const t = allTopo(input, 1)[0];
    if (t) {
      const lvl = Object.fromEntries(N.map((x) => [x, 0]));
      for (const x of t) for (const e of input.edges) if (e.u === x) lvl[e.v] = Math.max(lvl[e.v], lvl[x] + 1);
      const cols = {};
      for (const x of t) (cols[lvl[x]] ||= []).push(x);
      const pos = {};
      for (const [l, xs] of Object.entries(cols)) xs.forEach((x, i) => { pos[x] = [Number(l) * 1.6, (i - (xs.length - 1) / 2) * 1.3]; });
      return pos;
    }
  }
  // 其余：放在一个圆上（第一个在最上面，顺时针）
  const n = N.length;
  return Object.fromEntries(N.map((x, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [x, [Math.cos(a) * (n <= 4 ? 1.3 : 1.8), Math.sin(a) * (n <= 4 ? 1.3 : 1.8)]]; }));
}

const R = 17;
export function graphSvg(input, s = {}) {
  const P = layoutOf(input);
  const xs = Object.values(P).map((p) => p[0]), ys = Object.values(P).map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = 78;
  const pad = 34;
  const W = (maxX - minX) * scale + 2 * pad, H = (maxY - minY) * scale + 2 * pad;
  const X = (x) => (P[x][0] - minX) * scale + pad, Y = (x) => (P[x][1] - minY) * scale + pad;
  const done = new Set(s.done || []), tree = new Set(s.tree || []), rej = new Set(s.rej || []), cand = new Set(s.cand || []), crit = new Set(s.crit || []), changed = new Set(s.changed || []);
  let lines = '', labels = '', nodes = '';
  // 权的位置：沿着边挑一个离顶点、离别的权最远的地方（边交叉时几个数字不叠在一起）
  const placed = Object.keys(P).map((x) => [X(x), Y(x), R + 6]);
  const spot = (pts) => {
    let best = null;
    for (const [px, py] of pts) {
      const d = Math.min(...placed.map(([qx, qy, r]) => Math.hypot(px - qx, py - qy) - r));
      if (!best || d > best.d + 0.5) best = { x: px, y: py, d };
    }
    placed.push([best.x, best.y, 10]);
    return best;
  };
  const has = new Set(input.edges.map((e) => `${e.u}>${e.v}`));
  for (const e of input.edges) {
    const k = ekey(e, input.directed);
    const x1 = X(e.u), y1 = Y(e.u), x2 = X(e.v), y2 = Y(e.v);
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    // 有向图里一对反向的边：各自往右手边弯一点，画成两条弧
    const bend = input.directed && has.has(`${e.v}>${e.u}`) ? 22 : 0;
    const cx = (x1 + x2) / 2 - uy * bend, cy = (y1 + y2) / 2 + ux * bend;
    // 终点停在圆边上（有向边的箭头不钻进圆里）
    const tx = x2 - cx, ty = y2 - cy, tl = Math.hypot(tx, ty) || 1;
    const ex = input.directed ? x2 - (tx / tl) * (R + 3) : x2, ey = input.directed ? y2 - (ty / tl) * (R + 3) : y2;
    const d = bend ? `M ${x1} ${y1} Q ${cx} ${cy} ${ex} ${ey}` : `M ${x1} ${y1} L ${ex} ${ey}`;
    const cls = ['sv-gedge', tree.has(k) || crit.has(k) ? 'sv-edge-tree' : '', rej.has(k) ? 'sv-edge-rej' : '', s.edge === k ? 'sv-edge-cur' : '', cand.has(k) && !tree.has(k) ? 'sv-edge-cand' : ''].filter(Boolean).join(' ');
    lines += `<g class="${cls}" data-pick="${esc(k)}"><path class="sv-ghit" d="${d}"/><path d="${d}"${input.directed ? ' marker-end="url(#sv-arrow)"' : ''}/></g>`;
    if (e.w !== null) {
      // 曲线（或直线）上 t 处的点，往法线方向挪开一点，不压线
      const at = (t) => {
        const qx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2, qy = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
        const side = bend ? 9 : 11;
        return [qx - uy * side, qy + ux * side];
      };
      const p = spot([0.5, 0.4, 0.6, 0.32, 0.68, 0.25, 0.75].map(at));
      labels += `<text class="sv-gw" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}">${esc(e.w)}</text>`;
    }
  }
  input.names.forEach((x, i) => {
    const cls = ['sv-node', done.has(x) ? 'sv-done' : '', s.cur === x || (s.cur2 || []).includes(x) ? 'sv-cur' : '', (s.fresh || []).includes(x) ? 'sv-new' : '', changed.has(x) ? 'sv-cmp' : ''].filter(Boolean).join(' ');
    nodes += `<g class="${cls}" data-pick="${esc(x)}" data-cmd="${i + 1}" data-label="${esc(x)}"><circle cx="${X(x)}" cy="${Y(x)}" r="${R}"/><text x="${X(x)}" y="${Y(x)}">${esc(x)}</text>${s.deg ? `<text class="sv-node-note" x="${X(x) + R}" y="${Y(x) - R}">${s.done?.includes(x) ? '' : `入${s.deg[x]}`}</text>` : ''}</g>`;
  });
  const defs = input.directed ? '<defs><marker id="sv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" class="sv-arrowhead"/></marker></defs>' : '';
  return `<svg class="sv-tree sv-net" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="图">${defs}${lines}${labels}${nodes}</svg>`;
}

function table(head, rows) {
  return `<div class="sv-gtbl-wrap"><table class="sv-gtbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => (typeof c === 'object' && c ? `<td class="${c.cls || ''}">${c.html}</td>` : `<td>${c ?? ''}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function view(s, input) {
  const N = input.names;
  if (input.algo === 'floyd') {
    const ch = new Set((s.changed || []).map(([i, j]) => `${i},${j}`));
    const name = s.k < 0 ? 'A⁽⁻¹⁾' : `A⁽${s.k}⁾`;
    return graphSvg(input, { cur: s.k >= 0 ? N[s.k] : null }) + table([name, ...N.map(esc)], s.mat.map((r, i) => [`<b>${esc(N[i])}</b>`, ...r.map((x, j) => ({ html: inf(x), cls: [ch.has(`${i},${j}`) ? 'sv-new sv-chg' : '', s.k >= 0 && (i === s.k || j === s.k) ? 'sv-kline' : ''].join(' ') }))]));
  }
  let h = graphSvg(input, s);
  if (input.algo === 'dijkstra') {
    // 王道那种表：每一轮一列，写 dist（和前驱），确定了的打勾
    const head = ['顶点', ...s.hist.map((x, i) => `第 ${i + 1} 轮`)];
    const rows = N.filter((x) => x !== input.start).map((x) => [`<b>${esc(x)}</b>`, ...s.hist.map((hh, r) => {
      const pickedAt = s.hist.findIndex((q) => q.pick === x);
      if (pickedAt >= 0 && r > pickedAt) return '';
      const d = hh.dist[x];
      return { html: `${inf(d)}${pickedAt === r ? ' ✓' : ''}`, cls: pickedAt === r ? 'sv-pickcell' : '' };
    })]);
    rows.push(['<b>集合 S</b>', ...s.hist.map((hh) => esc(`{${hh.final.join(',')}}`))]);
    if (s.hist.length) h += table(head, rows);
    h += chips([['dist', N.map((x) => `${x}:${inf(s.table.dist[x])}`).join(' ')], ['path', N.map((x) => `${x}:${s.table.path[x] ?? '−'}`).join(' ')]]);
    return h;
  }
  if (input.algo === 'critical') {
    h += table(['事件', ...N.map(esc)], [['ve', ...N.map((x) => (s.ve[x] ?? ''))], ['vl', ...N.map((x) => (s.vl[x] ?? ''))]]);
    if (s.acts) h += table(['活动', 'e', 'l', 'l − e'], s.acts.map((a) => [{ html: esc(`<${a.e.u},${a.e.v}>`), cls: a.late === a.early ? 'sv-pickcell' : '' }, a.early, a.late, a.late - a.early]));
    return h;
  }
  const extra = [];
  if (s.seq) extra.push(['序列', s.seq.length ? s.seq.join(' ') : '（还没有）']);
  if (s.queue) extra.push(['队列', s.queue.length ? s.queue.join(' ') : '（空）']);
  if (s.stack) extra.push([input.algo === 'topo' ? '栈' : '递归栈', s.stack.length ? s.stack.join(' → ') : '（空）']);
  if (s.total !== undefined) extra.push(['权值和', s.total]);
  if (s.comps) extra.push(['连通分量', s.comps]);
  if (input.order === 'list' && ['bfs', 'dfs'].includes(input.algo)) {
    const adj = adjacency(input);
    h += `<div class="sv-adjlist">${N.map((x) => `<div><b>${esc(x)}</b>${adj[x].map((a) => ` → ${esc(a.to)}`).join('')}</div>`).join('')}</div>`;
  }
  return h + chips(extra);
}

export function quiz(input, r) {
  const a = input.algo;
  if (a === 'bfs' || a === 'dfs') return { q: `从 ${input.start} 出发，写出${ALGOS[a]}序列（邻接点${input.order === 'list' ? '按 edges 写的顺序' : '按顶点编号顺序'}）。`, qhtml: graphSvg(input), type: 'seq', answer: r.passes[0].join(' ') };
  if (a === 'prim' || a === 'kruskal') return { q: '写出最小生成树的权值之和。', qhtml: graphSvg(input), type: 'seq', answer: String(r.total) };
  if (a === 'dijkstra') return { q: `用 Dijkstra 算法求 ${input.start} 到其余各顶点的最短路径，写出各顶点被确定（加入集合 S）的顺序（不含 ${input.start}）。`, qhtml: graphSvg(input), type: 'seq', answer: r.order.filter((x) => x !== input.start).join(' ') };
  if (a === 'topo') {
    const alts = allTopo(input);
    return { q: '写出一个拓扑序列。', qhtml: graphSvg(input), type: 'seq', answer: alts.length ? alts.map((x) => x.join(' ')).join(' | ') : '无' };
  }
  if (a === 'critical') return { q: '关键路径的长度是多少？', qhtml: graphSvg(input), type: 'seq', answer: String(r.length) };
  throw new Error('floyd 没有 quiz 模式（矩阵太大，不适合整个写出来）；可以用 ask 或者 answer 组件问其中一格');
}

export function problems(input) {
  const out = [];
  if (input.use && !(input.use === 'stack' && input.algo === 'topo')) out.push('use: stack 只对 topo 有用');
  if (input.order === 'list' && !['bfs', 'dfs'].includes(input.algo)) out.push('order: list 只对 bfs / dfs 有用');
  return out;
}

// 考卷上那张表（mode: fill）
export function fillTable(input, r) {
  const a = input.algo;
  if (a === 'bfs' || a === 'dfs') {
    const seq = r.passes[0];
    return { q: `从 ${input.start} 出发${a === 'bfs' ? '广度' : '深度'}优先遍历（邻接点${input.order === 'list' ? '按 edges 写的顺序' : '按顶点编号从小到大'}），写出遍历序列（一格一个顶点）。`, dir: 'row', head: seq.map((_, i) => `${i + 1}`), rows: [{ label: '序列', cells: seq.map((x) => ({ v: x })) }] };
  }
  if (a === 'topo') {
    if (!r.ok) return null;
    const all = input.use === 'stack' ? [r.passes[0]] : allTopo(input, 31);
    if (all.length > 30) return null;
    return { q: `写出一个拓扑序列${input.use === 'stack' ? '（按王道的代码：入度为 0 的入栈）' : ''}（顶点用空格隔开）。`, dir: 'row', head: ['拓扑序列'], rows: [{ label: '', cells: [{ v: all.map((x) => x.join(' ')) }] }] };
  }
  if (a === 'dijkstra') {
    // 教材那张表：第 i 轮开始时各顶点的 dist（已经确定的空着），和这一轮确定的顶点
    const others = input.names.filter((x) => x !== input.start);
    const hist = r.steps.filter((x) => x.view.hist && x.view.cur !== undefined).map((x) => x.view);
    const rows = [];
    for (let i = 1; i < hist.length; i++) {
      const before = hist[i - 1];
      const fin = new Set(before.done);
      const pick = hist[i].cur;
      const ties = others.filter((x) => !fin.has(x) && before.table.dist[x] === before.table.dist[pick]);
      rows.push({ label: `第 ${i} 轮`, cells: [...others.map((x) => (fin.has(x) ? { v: '', given: true } : { v: inf(before.table.dist[x]), num: true })), { v: ties }] });
    }
    return { q: `从 ${input.start} 出发用 Dijkstra 求最短路径。每一轮写出还没确定的各顶点的 dist（到不了写 ∞），和这一轮确定的顶点。`, dir: 'col', head: [...others.map((x) => `dist[${x}]`), '确定'], rows };
  }
  if (a === 'kruskal') {
    const rows = r.steps.filter((x) => x.ask?.tag === 'take').map((x) => ({ label: x.ask.q.split('：')[0], cells: [{ v: x.ask.answer === '选' ? '√' : '', mark: true }] }));
    return { q: 'Kruskal：边按权从小到大排好了，逐条看选不选（会成环的不选），选的打 √。', dir: 'row', head: ['选'], rows };
  }
  if (a === 'prim') {
    if (r.tie) return null;
    const rows = r.steps.filter((x) => x.ask?.tag === 'next').map((x, k) => { const m = /\((\S+), (\S+)\)，权 (\S+)/.exec(x.msg) || []; return { label: `第 ${k + 1} 次`, cells: [{ v: x.ask.answer }, { v: m[3] || '', num: true }] }; });
    return { q: `从 ${input.start} 开始用 Prim 求最小生成树：每次写出加进来的顶点和那条边的权。`, dir: 'row', head: ['加进来的顶点', '边的权'], rows, extra: [{ label: '权值之和', v: String(r.total), num: true }] };
  }
  if (a === 'critical') {
    const rows = [];
    const ve = r.ve || {}, vl = r.vl || {};
    for (const x of input.names) rows.push({ label: x, cells: [{ v: String(ve[x]), num: true }, { v: String(vl[x]), num: true }, { v: '', given: true }] });
    for (const act of r.acts || []) rows.push({ label: `<${act.e.u},${act.e.v}>`, cells: [{ v: String(act.early), num: true }, { v: String(act.late), num: true }, { v: String(act.late - act.early), num: true }] });
    return { q: '求关键路径：先写每个事件（顶点）的 ve、vl，再写每个活动（边）的 e、l 和时间余量 l − e。', dir: 'row', head: ['ve / e', 'vl / l', 'l − e'], rows, extra: [{ label: '关键路径长度', v: String(r.length ?? ''), num: true }] };
  }
  return null;
}

// 常见错法
export function variants(input) {
  const a = input.algo;
  if (a === 'bfs') return [{ label: '像是按深度优先走的', input: { ...input, algo: 'dfs' } }];
  if (a === 'dfs') return [{ label: '像是按广度优先走的', input: { ...input, algo: 'bfs' } }];
  if (a === 'dijkstra') return [{ label: '像是把 Prim 的更新方式用在了 Dijkstra 上（dist 只比了边权，没加上到前一个顶点的距离）', input: { ...input, primLike: true } }];
  return [];
}

export const netEngine = { name: 'net', title: '图', parse, run, view, quiz, problems, table: fillTable, variants };
