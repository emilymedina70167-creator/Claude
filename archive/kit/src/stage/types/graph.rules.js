// 图的规则（接口见 rules.js、docs/stage-types.md；主线第二轮 D）。纯函数，有测试（tests/stage-graph-rules.test.js）。
//
// 图交给学生动手：点一条边选进 / 拿掉（open g choose）、点一个结点编访问号（open g visit）、点一个结点写旁边的数（open g tag）。
// 页面不判对错（没有 next / judges / doneBy）：Kruskal 该先选哪条、BFS 下一个访问谁，是老师看着判的事。这里只交
//   - 做不做得到：这条边还在、这个结点没访问过；
//   - 事实：学生每选一条边以后「现在选了几条、总权几、连成几块」，这一条让选的边成了圈就写出那个圈；
//   - 量：chosen(g) 选了几条、weight(g) 选的边权加起来、pieces(g) 选的边把结点连成几块、visited(g) 访问了几个；
//   - 判断式：g tree（选的边正好是一棵生成树）、g cyclic（选的边里有圈）、g connected（连成一块）。
// 连通、成圈都照无向的算（有向图上选的边不看箭头，事实里写明）；有向图的 g tree 当场报。
// 三项手势都写了 live：边权跟着拨数算的图（A-B:{w}）也能交给学生——选边、访问号、旁边的数都不改式子定的数
import { parseRef } from '../script.js';

const live = (o) => o.edges.filter((e) => !e.gone);
const chosenOf = (o) => live(o).filter((e) => e.chosen);
// 还在图上的结点（take 拿掉的不算）
const alive = (o) => o.nodes.filter((n) => !o.taken.includes(n.key)).map((n) => n.key);
const edgeName = (o, e) => `${e.a}${o.directed ? '→' : '–'}${e.b}`;
const num = (w) => (w == null ? null : Number(w));

/** 选的边把还在的结点连成几块（并查集） */
export function piecesOf(o, edges = chosenOf(o)) {
  const ks = alive(o);
  const up = new Map(ks.map((k) => [k, k]));
  const find = (k) => { while (up.get(k) !== k) { up.set(k, up.get(up.get(k))); k = up.get(k); } return k; };
  for (const e of edges) { if (!up.has(e.a) || !up.has(e.b)) continue; const a = find(e.a), b = find(e.b); if (a !== b) up.set(a, b); }
  return new Set(ks.map(find)).size;
}
/** 选的边里有没有圈（照无向的算）：边数比「结点数 − 块数」多就有 */
export function hasCycle(o, edges = chosenOf(o)) {
  const ks = new Set(alive(o));
  const es = edges.filter((e) => ks.has(e.a) && ks.has(e.b));
  return es.length > ks.size - piecesOf(o, es);
}
/** 在选了的边里（不算 skip 那一条）从 a 走到 b 的一条路：[a, …, b]；走不到是 null */
export function pathIn(o, a, b, skip = null) {
  const adj = new Map();
  for (const e of chosenOf(o)) { if (e === skip) continue; for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push(y); } }
  const prev = new Map([[a, null]]);
  const queue = [a];
  while (queue.length) {
    const x = queue.shift();
    if (x === b) { const out = []; for (let k = b; k != null; k = prev.get(k)) out.unshift(k); return out; }
    for (const y of adj.get(x) || []) if (!prev.has(y)) { prev.set(y, x); queue.push(y); }
  }
  return null;
}

const edgeAt = (o, x) => (x?.kind === 'edge' ? o.edges.find((e) => e.key === x.key && !e.gone) || null : null);
const nodeAt = (o, x) => (x?.kind === 'node' ? o.nodes.find((n) => n.key === x.key) || null : null);
const refOf = (o, e) => `${o.id}.${e.a}~${e.b}`;

const gestures = {
  // 点一条边：没选的选进，选着的拿掉
  choose: {
    gesture: 'tap', on: 'edge', live: true, makes: ['choose', 'unchoose'], brief: '点一条边选进，再点一下拿掉',
    toAct(o, { from } = {}) {
      const e = edgeAt(o, from);
      if (!e) return { error: '点一条边（边上的数、边的中间），把它选进来' };
      return e.chosen ? { act: { type: 'unchoose', key: e.key }, src: `unchoose ${refOf(o, e)}` } : { act: { type: 'choose', key: e.key }, src: `choose ${refOf(o, e)}` };
    },
  },
  // 点一个结点：编上访问号（第几个访问的）。访问的先后是事实，再点不取消（要撤走「撤一步」）
  visit: {
    gesture: 'tap', on: 'node', live: true, brief: '点一个结点，编上访问号',
    toAct(o, { from } = {}) {
      const n = nodeAt(o, from);
      if (!n) return { error: '点一个结点，把它记成访问过' };
      if (o.taken.includes(n.key)) return { error: `${n.key} 已经拿掉了` };
      if (n.order != null) return { error: `${n.key} 已经访问过了（第 ${n.order} 个）` };
      return { act: { type: 'visit', key: n.key }, src: `visit ${o.id}.${n.key}` };
    },
  },
  // 点一个结点，键盘写它旁边的数（dist、lowcost；键盘上多一个 ∞）
  tag: {
    gesture: 'write', on: 'node', live: true, brief: '点一个结点，键盘写它旁边的数',
    ask: (o, { to, from } = {}) => { const n = nodeAt(o, to || from); return { input: 'keypad', prompt: n ? `${n.key} 旁边写几？` : '写一个数', extra: '∞' }; },
    toAct(o, { to, from, value } = {}) {
      const n = nodeAt(o, to || from);
      if (!n) return { error: '点一个结点再写数' };
      const v = String(value ?? '').trim().replace(/[−–]/g, '-');
      if (v !== '∞' && !/^-?\d+(\.\d+)?$/.test(v)) return { error: `「${v}」不是数（写成 7、0.5，或者 ∞）` };
      return { act: { type: 'tag', key: n.key, value: v }, src: `tag ${o.id}.${n.key} ${v}` };
    },
  },
};

/** 一行镜头指令 → check 认的动作。只认学生从 open g choose / visit / tag 做的那一下（老师自己演的照旧不过裁判） */
function actOf(o, c, h, { by = null, open = null } = {}) {
  if (by !== 'student' || !gestures[open]) return null;
  let ps;
  try { ps = h.partsIn(); } catch { return null; }
  if (ps.length !== 1 || ps[0].obj !== o.id) return null;
  const p = ps[0];
  if ((c.cmd === 'choose' || c.cmd === 'unchoose') && p.kind === 'edge') return { type: c.cmd, key: p.key };
  if (c.cmd === 'visit' && p.kind === 'node') return { type: 'visit', key: p.key };
  if (c.cmd === 'tag' && p.kind === 'node') { const v = h.str ?? h.words.filter((w) => !parseRef(w) || !/[.#]/.test(w)).at(-1); return v == null ? null : { type: 'tag', key: p.key, value: String(v) }; }
  return null;
}

// 只判这个世界做不做得到，不判对错（right 永远是 null）。why 写这一下做了什么
function check(o, act) {
  const no = (why) => ({ legal: false, right: null, misread: null, why, next: null });
  const ok = (why) => ({ legal: true, right: null, misread: null, why, next: null });
  if (act.type === 'choose' || act.type === 'unchoose') {
    const e = o.edges.find((x) => x.key === act.key);
    if (!e || e.gone) return no('这条边不在图上了');
    const w = e.w != null ? `（权 ${e.w}）` : '';
    if (act.type === 'choose') return e.chosen ? no(`${edgeName(o, e)} 已经选了`) : ok(`选了 ${edgeName(o, e)}${w}`);
    return e.chosen ? ok(`拿掉了 ${edgeName(o, e)}${w}`) : no(`${edgeName(o, e)} 没有选`);
  }
  if (act.type === 'visit') {
    const n = o.nodes.find((x) => x.key === act.key);
    if (!n) return ok(null);
    if (n.order != null) return no(`${n.key} 已经访问过了（第 ${n.order} 个）`);
    return ok(`访问了 ${n.key}（第 ${o.visits + 1} 个）`);
  }
  if (act.type === 'tag') {
    const n = o.nodes.find((x) => x.key === act.key);
    if (!n) return ok(null);
    return ok(`${n.key} 旁边写了 ${act.value}${n.tag != null && n.tag !== act.value ? `（原来是 ${n.tag}）` : ''}`);
  }
  return ok(null);
}

const sumW = (o) => chosenOf(o).reduce((s, e) => s + (num(e.w) || 0), 0);
const round = (v) => Math.round(v * 1000) / 1000;
/** 学生这一下以后写给老师的事实：选边 / 拿掉以后选了几条、总权、连成几块；这一条让选的边成了圈，写出那个圈 */
function facts(before, after, act) {
  const out = [];
  if (act.type !== 'choose' && act.type !== 'unchoose') return out;
  if (act.type === 'choose') {
    const e = after.edges.find((x) => x.key === act.key);
    const path = e ? pathIn(after, e.b, e.a, e) : null;
    // 有向图：连通、成圈照无向的算，写明是不看箭头（A→B、A→C、B→C 不看箭头是个圈，照箭头不是）
    if (path) out.push(`${after.directed ? '不看箭头的话' : ''}成圈了：${[e.a, ...path].join('–')}`);
  }
  const n = chosenOf(after).length;
  out.push(`现在选了 ${n} 条${after.weighted ? `、总权 ${round(sumW(after))}` : ''}、连成 ${piecesOf(after)} 块${after.directed ? '（不看箭头）' : n && !hasCycle(after) && piecesOf(after) === 1 ? '（是一棵生成树）' : ''}`);
  return out;
}

// 现状里列不列：有选了的边、或者把选边交给了学生（没选边的旧课一字不多）
const opened = (o, scene, action) => [...(scene?.opens?.values?.() || [])].some((e) => e.obj === o.id && e.action === action);
const choosing = (o, scene) => o.edges.some((e) => e.chosen && !e.gone) || opened(o, scene, 'choose');
const measures = {
  // 选了几条边
  chosen: Object.assign((o) => chosenOf(o).length, { listed: choosing }),
  // 选的边权加起来（不带权的图没有）
  weight: Object.assign((o) => (o.weighted ? round(sumW(o)) : undefined), { none: '不带权的图', listed: choosing }),
  // 选的边把还在的结点连成几块（一条都没选时就是结点数）
  pieces: Object.assign((o) => piecesOf(o), { listed: choosing }),
  // 访问了几个结点（现状里另有「访问顺序」那一行，这里不再列）
  visited: Object.assign((o) => o.nodes.filter((n) => n.order != null).length, { listed: () => false }),
};

const predicates = {
  // 选的边正好是一棵生成树：没有圈、把还在的结点连成一块
  tree: (o) => { if (o.directed) throw new Error('有向图页面不判生成树（g tree 只用在无向图上；g cyclic、g connected 照无向的算）'); return !hasCycle(o) && piecesOf(o) === 1 && alive(o).length > 0; },
  // 选的边里有圈
  cyclic: (o) => hasCycle(o),
  // 选的边把还在的结点连成一块
  connected: (o) => piecesOf(o) === 1 && alive(o).length > 0,
};

/** 这一下改了哪几个部件（ask pick 交了以后和真变了的比）：选没选变了的边、访问号 / 旁边的数变了的结点 */
function changed(before, after) {
  if (!before || !after) return [];
  const out = [];
  for (const e of after.edges) { const q = before.edges.find((x) => x.key === e.key); if (q && (!!q.chosen !== !!e.chosen || !!q.gone !== !!e.gone)) out.push(e.key); }
  for (const n of after.nodes) { const q = before.nodes.find((x) => x.key === n.key); if (q && (q.order !== n.order || q.tag !== n.tag)) out.push(n.key); }
  return out;
}

export const graphRules = { check, facts, measures, predicates, gestures, changed, actOf };
