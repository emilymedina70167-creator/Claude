// 图的对应关系（follow g net dijkstra from=1）：黑板的图引擎（engines/graph.js）接到舞台的图上；接到表上时引擎每一轮的 dist 直接当表的答案。
// 这里只写「对得上」：Dijkstra 看结点牌子上的数（dist）和点过的结点（确定了）；Prim / Kruskal 看选了哪几条边；BFS / DFS 看访问的先后。
import { registerFollow } from '../follow.js';
import { netEngine } from '../../engines/graph.js';

const NAMES = { dijkstra: 'Dijkstra', prim: 'Prim', kruskal: 'Kruskal', bfs: '广度优先遍历', dfs: '深度优先遍历' };
const kindOf = (f) => String(f.run || '').trim().toLowerCase();
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const edgesOf = (g) => g.edges.filter((e) => !e.gone);
const pair = (u, v) => [String(u), String(v)].sort(natural).join('–');
// 没写、∞、引擎的 Infinity 都是 ∞；数照数写（08 和 8 是一个数）；别的字原样（学生写了字也比得出不一样）
const dist = (t) => { const x = String(t ?? '').trim(); if (x === '' || /^(∞|inf(inity)?|无穷)$/i.test(x)) return '∞'; return Number.isFinite(Number(x)) ? String(Number(x)) : x; };
const input = (g, f) => ({
  edges: edgesOf(g).map((e) => `${e.a}${g.directed ? '->' : '-'}${e.b}${e.w != null ? ` ${e.w}` : ''}`).join(', '),
  run: `${kindOf(f)}${f.from != null ? ` ${f.from}` : ''}`,
});
// 引擎的一步 → 舞台上该有的样子（和 cellsOf 同一种写法）
function cellsAt(kind, view, names) {
  if (kind === 'dijkstra') { const h = view.hist?.at(-1); return h ? names.map((k) => dist(h.dist[k])) : null; }
  if (kind === 'prim' || kind === 'kruskal') return [(view.tree || []).map((t) => pair(...t.split('-'))).sort(natural).join(' ')];
  return [(view.seq || []).join(' ')];
}
const countAt = (kind, view) => (kind === 'dijkstra' ? view.hist?.length : kind === 'prim' || kind === 'kruskal' ? view.tree?.length : view.seq?.length) || 0;

registerFollow('net', {
  engine: netEngine,
  types: ['graph', 'table'],
  subjects: ['数据结构'],
  head: 'run',
  word: '个顶点',
  drillOpen: (f) => ({ dijkstra: 'tag', prim: 'choose', kruskal: 'choose' }[kindOf(f)] || 'visit'),
  unit: '轮',
  title: (f) => `${NAMES[kindOf(f)] || kindOf(f)}${f.from != null ? `（从 ${f.from} 出发）` : ''}`,
  fields: (g, f) => input(g, f),
  snap: (g) => g.nodes.map((n) => n.key).sort(natural),
  dataOf: (g) => edgesOf(g).map((e) => `${e.a}~${e.b}:${e.w ?? ''}`).join(','),
  cellsOf(g, scene, names) {
    const kind = kindOf(g.follow.fields);
    // 图上「点结点」和「写牌子」是同一种按法，学生一次只做得了一种：Dijkstra 只比牌子上的 dist（这一轮确定谁写在给老师看的那一句里）
    if (kind === 'dijkstra') return names.map((k) => dist(g.nodes.find((x) => x.key === k)?.tag));
    if (kind === 'prim' || kind === 'kruskal') return [edgesOf(g).filter((e) => e.chosen).map((e) => pair(e.a, e.b)).sort(natural).join(' ')];
    return [g.nodes.filter((n) => n.order != null).sort((a, b) => a.order - b.order).map((n) => n.key).join(' ')];
  },
  stateOf(g, scene, names) { return this.cellsOf(g, scene, names).join('|'); },
  nameOf: (i, names) => (names.length > 1 ? `顶点 ${names[i]}` : '这一处'),
  show(cells, names, f) {
    const kind = kindOf(f);
    if (kind === 'dijkstra') return `dist ${cells.map((c, i) => `${names[i]}=${c}`).join(' ')}`;
    return kind === 'prim' || kind === 'kruskal' ? `选了 ${cells[0] || '（还没有）'}` : `访问了 ${cells[0] || '（还没有）'}`;
  },
  frames(run, spec) {
    const kind = spec.algo, names = [...spec.names].sort(natural);
    const out = [];
    let seen = 0;
    for (const s of run.steps) {
      const cells = cellsAt(kind, s.view || {}, names);
      const n = countAt(kind, s.view || {});
      if (!cells || !n) continue;
      const pick = kind === 'dijkstra' ? s.view.hist.at(-1).pick : null;
      out.push({ state: cells.join('|'), cells, ...(pick != null ? { lead: `确定 ${pick}；` } : {}), ...(n > seen ? { mark: n } : {}) });
      seen = Math.max(seen, n);
    }
    return out;
  },
  // 接在表上：一行一个顶点、一列一轮，引擎每一轮的 dist 当答案（照第三轮表的做法逐格比，不走路）
  toKey(T, f, scene) {
    const g = scene.objects.get(f.on);
    if (!g || g.type !== 'graph') throw new Error('接在表上要写图是哪一张：follow T net dijkstra on=g from=1');
    if (kindOf(f) !== 'dijkstra') throw new Error('接在表上的只有 dijkstra（每一轮的 dist 填一列）');
    const run = netEngine.run(netEngine.parse(input(g, f)));
    const hist = run.steps.at(-1).view.hist;
    const names = g.nodes.map((n) => n.key);
    const rows = T.rowNames.map((r) => names.find((k) => r === k) ?? names.filter((k) => String(r).endsWith(k)).sort((a, b) => b.length - a.length)[0]);
    if (rows.some((k) => k == null)) throw new Error(`表的行名要是图里的顶点（${[...names].sort(natural).join('、')}）`);
    if (T.cols > hist.length) throw new Error(`这张图 Dijkstra 只有 ${hist.length} 轮，表有 ${T.cols} 列`);
    T.key = rows.map((k) => Array.from({ length: T.cols }, (_, c) => dist(hist[c].dist[k])));
    return { id: T.id, keyed: true };
  },
  doc: 'follow g net dijkstra from=1   图：dijkstra 比牌子上的 dist（open g tag），prim / kruskal 比选的边，bfs / dfs 比访问的先后；表 follow T net dijkstra on=g from=1：每一轮的 dist 当答案（一行一个顶点、一列一轮）',
});
