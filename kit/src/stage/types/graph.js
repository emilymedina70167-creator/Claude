// 舞台上的图（BFS / DFS、最小生成树、最短路、拓扑排序）：数据和指令，不碰 DOM（画法在 graph.view.js）。纯函数，有测试（tests/stage-graph.test.js）。
// 结点和边都是部件：结点 g.A（key 是名字），边 g.A~B（key 是造的时候写的 A~B；无向图 g.B~A 也认）。
// 自动排版（layoutGraph）是确定的：有向无环图按层从左往右摆（拓扑排序一眼看出先后）；别的用应力布局（图上的距离 ≈ 隔几条边），
// 换几个起点算，挑交叉最少、结点不压着别的边的那个，再转到边尽量横平竖直、第一个结点在左上。老师也能自己给坐标（pos=）。
import { bbox } from '../layout.js';
import { parseRef } from '../script.js';

export const GNODE = 56; // 结点的直径
export const EDGE_LEN = 150; // 一条边大约多长（像素）
export const MAX_GNODES = 16, MAX_EDGES = 40;
const MIN_GAP = GNODE + 70; // 两个结点的中心至少隔多远
const TAG_ROOM = 22; // 结点旁边的小字、访问号占的地方
const ROW_GAP = 76; // 拿掉的结点排在下面，一个隔多远
const R = GNODE / 2;
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
const NAME = /^[A-Za-z0-9]{1,4}$/;

// —— 排版（纯函数）——
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hops(n, E) {
  const adj = Array.from({ length: n }, () => []);
  for (const [a, b] of E) { adj[a].push(b); adj[b].push(a); }
  const D = Array.from({ length: n }, () => Array(n).fill(Infinity));
  for (let s = 0; s < n; s++) {
    D[s][s] = 0;
    const q = [s];
    while (q.length) { const u = q.shift(); for (const v of adj[u]) if (D[s][v] === Infinity) { D[s][v] = D[s][u] + 1; q.push(v); } }
  }
  const far = Math.max(1, ...D.flat().filter(Number.isFinite)) + 1;
  return D.map((row) => row.map((d) => (Number.isFinite(d) ? d : far)));
}
function orientation(p, q, r) { return Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)); }
/** 两条线段交叉了没有（共用一头的不算） */
export function crosses(a, b, c, d) {
  return orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;
}
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t, fx: a.x + t * dx, fy: a.y + t * dy };
}
/** 一个排版好不好：交叉几处、几个结点贴着别的边、几对结点挤在一起 */
export function layoutFaults(P, E, { near = 0.3, close = 0.62 } = {}) {
  let cross = 0, touch = 0, crowd = 0;
  for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
    const [a, b] = E[i], [c, d] = E[j];
    if (a === c || a === d || b === c || b === d) continue;
    if (crosses(P[a], P[b], P[c], P[d])) cross++;
  }
  for (const [a, b] of E) for (let w = 0; w < P.length; w++) if (w !== a && w !== b && segDist(P[w], P[a], P[b]).d < near) touch++;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) < close) crowd++;
  return { cross, touch, crowd };
}
function stress(P, D, iters, fixX) {
  const n = P.length;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sw = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const w = 1 / (D[i][j] * D[i][j]);
        sx += w * (P[j].x + (D[i][j] * dx) / d);
        sy += w * (P[j].y + (D[i][j] * dy) / d);
        sw += w;
      }
      if (!fixX) P[i].x = sx / sw;
      P[i].y = sy / sw;
    }
  }
}
function stressValue(P, D) {
  let s = 0;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const d = Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y); s += ((d - D[i][j]) ** 2) / (D[i][j] ** 2); }
  return s;
}
// 结点别压在别的边上、别挤在一起：推开一点（按层摆的只上下推）
function clearance(P, E, fixX) {
  for (let it = 0; it < 60; it++) {
    let moved = false;
    for (const [a, b] of E) for (let w = 0; w < P.length; w++) {
      if (w === a || w === b) continue;
      const s = segDist(P[w], P[a], P[b]);
      if (s.d >= 0.34 || s.t <= 0.02 || s.t >= 0.98) continue;
      let nx = P[w].x - s.fx, ny = P[w].y - s.fy, L = Math.hypot(nx, ny);
      if (L < 1e-6) { nx = -(P[b].y - P[a].y); ny = P[b].x - P[a].x; L = Math.hypot(nx, ny) || 1; }
      const k = ((0.34 - s.d) * 0.6) / L;
      if (!fixX) P[w].x += nx * k;
      P[w].y += (fixX && Math.abs(ny) < 1e-6 ? 1 : ny) * k;
      moved = true;
    }
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d = Math.hypot(dx, dy);
      if (d >= 0.7) continue;
      const ux = d > 1e-6 ? dx / d : 0, uy = d > 1e-6 ? dy / d : 1, k = (0.7 - d) / 2;
      if (fixX) { if (Math.abs(dx) < 0.5) { const s = dy >= 0 ? 1 : -1; P[i].y -= s * k; P[j].y += s * k; moved = true; } continue; }
      P[i].x -= ux * k; P[i].y -= uy * k; P[j].x += ux * k; P[j].y += uy * k;
      moved = true;
    }
    if (!moved) break;
  }
}
// 有向图有没有环；没环时每个结点在第几层（最长路，从没有前驱的开始）
function dagLayers(n, E) {
  const indeg = Array(n).fill(0), out = Array.from({ length: n }, () => []);
  for (const [a, b] of E) { indeg[b]++; out[a].push(b); }
  const layer = Array(n).fill(0), q = [];
  for (let i = 0; i < n; i++) if (!indeg[i]) q.push(i);
  let seen = 0;
  while (q.length) {
    const u = q.shift();
    seen++;
    for (const v of out[u]) { layer[v] = Math.max(layer[v], layer[u] + 1); if (!--indeg[v]) q.push(v); }
  }
  return seen === n ? layer : null;
}
// 无向连通图从第一个结点往外一层一层（层号 = 隔几条边）；不连通、只有两层以下的不用
function bfsTiers(n, E) {
  const D = hops(n, E)[0];
  const top = Math.max(...D);
  if (top < 2 || D.some((d) => d >= n)) return null;
  return D;
}
// 按层摆（有向无环图）：跨层的边在中间层占一个空位，按前后层的重心排几遍，挑交叉最少的顺序
function layered(n, E, layer) {
  const top = Math.max(...layer);
  const rows = Array.from({ length: top + 1 }, () => []);
  for (let i = 0; i < n; i++) rows[layer[i]].push(i);
  const segs = [];
  let id = n;
  for (const [a, b] of E) {
    let prev = a;
    for (let l = layer[a] + 1; l < layer[b]; l++) { rows[l].push(id); segs.push([prev, id]); prev = id++; }
    segs.push([prev, b]);
  }
  const rowOf = new Map();
  rows.forEach((r, l) => r.forEach((v) => rowOf.set(v, l)));
  const at = () => { const m = new Map(); rows.forEach((r) => r.forEach((v, i) => m.set(v, i))); return m; };
  const crossings = () => {
    const m = at();
    let c = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i], [x, y] = segs[j];
      if (rowOf.get(a) !== rowOf.get(x)) continue;
      if ((m.get(a) - m.get(x)) * (m.get(b) - m.get(y)) < 0) c++;
    }
    return c;
  };
  let best = { c: crossings(), rows: rows.map((r) => [...r]) };
  for (let sweep = 0; sweep < 8; sweep++) {
    const down = sweep % 2 === 0;
    const order = down ? rows.map((_, l) => l).slice(1) : rows.map((_, l) => l).reverse().slice(1);
    for (const l of order) {
      const m = at();
      const nb = (v) => segs.filter(([a, b]) => (down ? b === v && rowOf.get(a) === l - 1 : a === v && rowOf.get(b) === l + 1)).map(([a, b]) => m.get(down ? a : b));
      const key = new Map(rows[l].map((v, i) => { const s = nb(v); return [v, s.length ? s.reduce((x, y) => x + y, 0) / s.length : i]; }));
      rows[l].sort((u, v) => key.get(u) - key.get(v) || m.get(u) - m.get(v));
    }
    const c = crossings();
    if (c < best.c) best = { c, rows: rows.map((r) => [...r]) };
  }
  const P = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  best.rows.forEach((r, l) => r.forEach((v, i) => { if (v < n) P[v] = { x: l * 1.3, y: (i - (r.length - 1) / 2) * 0.95 }; }));
  return P;
}
// 转一转：边尽量横平竖直、横着比竖着宽；再翻到第一个结点在左上
function orient(P, E) {
  const c = { x: P.reduce((s, p) => s + p.x, 0) / P.length, y: P.reduce((s, p) => s + p.y, 0) / P.length };
  let best = null;
  for (let deg = 0; deg < 180; deg += 3) {
    const a = (deg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    const Q = P.map((p) => ({ x: (p.x - c.x) * cos - (p.y - c.y) * sin, y: (p.x - c.x) * sin + (p.y - c.y) * cos }));
    let s = 0;
    for (const [i, j] of E) { const ang = Math.abs(Math.atan2(Q[j].y - Q[i].y, Q[j].x - Q[i].x)) % (Math.PI / 2); s += Math.min(ang, Math.PI / 2 - ang); }
    const w = Math.max(...Q.map((q) => q.x)) - Math.min(...Q.map((q) => q.x)), h = Math.max(...Q.map((q) => q.y)) - Math.min(...Q.map((q) => q.y));
    s = s / Math.max(1, E.length) + (h > w * 1.05 ? (h / Math.max(w, 1e-6) - 1) * 0.8 : 0);
    if (!best || s < best.s - 1e-9) best = { s, Q };
  }
  let Q = best.Q;
  if (Q[0].x > 1e-6) Q = Q.map((q) => ({ x: -q.x, y: q.y }));
  if (Q[0].y > 1e-6) Q = Q.map((q) => ({ x: q.x, y: -q.y }));
  return Q;
}

/**
 * 自动排版：names 结点名字，edges [{ a, b }]。返回 { 名字: { x, y } }（像素，结点中心，左上角那个结点贴着 0, 0）。
 * 同样的图每次排得一样（随机起点用固定的种子）
 */
export function layoutGraph(names, edges, { directed = false, weighted = false } = {}) {
  const n = names.length;
  if (!n) return {};
  const idx = new Map(names.map((k, i) => [k, i]));
  const pairs = new Map();
  for (const e of edges) { const a = idx.get(e.a), b = idx.get(e.b); pairs.set(a < b ? `${a},${b}` : `${b},${a}`, [a, b]); }
  const E = [...pairs.values()];
  let P = null;
  const layer = directed && n > 1 ? dagLayers(n, edges.map((e) => [idx.get(e.a), idx.get(e.b)])) : null;
  if (n === 1) P = [{ x: 0, y: 0 }];
  else if (layer) {
    P = layered(n, edges.map((e) => [idx.get(e.a), idx.get(e.b)]), layer);
    clearance(P, E, true);
    if (P[0].y > 1e-6 && n > 1) { const m = P.reduce((s, p) => s + p.y, 0) / n; if (P[0].y > m) P = P.map((p) => ({ x: p.x, y: 2 * m - p.y })); }
  } else {
    // 无向图先试按层摆：从第一个结点（多半是出发点）一层一层往下（王道画 BFS 的样子）；干净、又不太瘦长就用它
    const tiers = bfsTiers(n, E);
    if (tiers) {
      const Q = layered(n, E.map(([a, b]) => (tiers[a] <= tiers[b] ? [a, b] : [b, a])).filter(([a, b]) => tiers[a] < tiers[b]), tiers).map((p) => ({ x: p.y * 1.15, y: p.x / 1.3 }));
      const f = layoutFaults(Q, E);
      const w = Math.max(...Q.map((q) => q.x)) - Math.min(...Q.map((q) => q.x)), h = Math.max(...Q.map((q) => q.y)) - Math.min(...Q.map((q) => q.y));
      if (!f.cross && !f.touch && !f.crowd && h <= Math.max(w, 1) * 1.8) P = Q;
    }
  }
  if (!P) {
    const D = hops(n, E);
    const inits = [];
    const circle = (order) => { const out = Array(n); order.forEach((v, i) => { const a = (2 * Math.PI * i) / n - Math.PI / 2; out[v] = { x: Math.cos(a) * n * 0.22 + 0.5, y: Math.sin(a) * n * 0.22 }; }); return out; };
    inits.push(circle(names.map((_, i) => i)));
    const bfs = [0], seen = new Set([0]);
    for (let k = 0; k < bfs.length; k++) for (const [a, b] of E) for (const [u, v] of [[a, b], [b, a]]) if (u === bfs[k] && !seen.has(v)) { seen.add(v); bfs.push(v); }
    for (let i = 0; i < n; i++) if (!seen.has(i)) bfs.push(i);
    inits.push(circle(bfs));
    for (let s = 1; s <= 8; s++) { const rnd = mulberry32(s * 7919); inits.push(Array.from({ length: n }, () => ({ x: (rnd() - 0.5) * n, y: (rnd() - 0.5) * n }))); }
    let best = null;
    for (const init of inits) {
      const Q = init.map((p) => ({ ...p }));
      stress(Q, D, 220, false);
      clearance(Q, E, false);
      const f = layoutFaults(Q, E);
      const s = f.cross * 10 + f.touch * 6 + f.crowd * 6 + stressValue(Q, D) / n;
      if (!best || s < best.s - 1e-9) best = { s, Q };
    }
    P = orient(best.Q, E);
  }
  if (!P[0]) P = [{ x: 0, y: 0 }];
  // 单位 → 像素：一条边大约 EDGE_LEN，结点之间至少隔 MIN_GAP（边上要写权、结点旁边要写数）
  const lens = E.map(([a, b]) => Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y)).sort((x, y) => x - y);
  // 带权的边中间要放写着权的牌子、边多的结点旁边挤：都放宽一点
  const want = EDGE_LEN * (weighted ? 1.12 : 1) * (1 + 0.08 * Math.max(0, (2 * E.length) / n - 2.5));
  const gap = MIN_GAP * (weighted ? 1.12 : 1);
  let s = lens.length ? want / lens[Math.floor(lens.length / 2)] : want;
  let minD = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) minD = Math.min(minD, Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y));
  if (Number.isFinite(minD) && minD * s < gap) s = gap / minD;
  const x0 = Math.min(...P.map((p) => p.x)), y0 = Math.min(...P.map((p) => p.y));
  const out = {};
  names.forEach((k, i) => { out[k] = { x: Math.round((P[i].x - x0) * s), y: Math.round((P[i].y - y0) * s) }; });
  return out;
}

// —— 画法要的几何（纯函数，画面和场景共用）——
const nodeOf = (o, k) => o.nodes.find((n) => n.key === k) || null;
const liveEdges = (o) => o.edges.filter((e) => !e.gone);
const rowIndex = (o, k) => o.taken.indexOf(k);
/** 结点中心：拿掉的排在图下面一排（按拿的先后） */
export function nodeCenter(o, k) {
  const i = rowIndex(o, k);
  if (i >= 0) {
    const g = graphArea(o);
    return { x: g.x + R + i * ROW_GAP, y: g.y + g.h + 40 + R };
  }
  const p = o.pos[k];
  return { x: o.origin.x + p.x, y: o.origin.y + p.y };
}
/** 图本身（不算拿掉的那一排）占的地方：结点中心外加半个结点和小字的地方 */
export function graphArea(o) {
  const xs = Object.values(o.pos).map((p) => p.x), ys = Object.values(o.pos).map((p) => p.y);
  const x = o.origin.x + Math.min(...xs) - R, y = o.origin.y + Math.min(...ys) - R;
  return { x, y, w: Math.max(...xs) - Math.min(...xs) + GNODE, h: Math.max(...ys) - Math.min(...ys) + GNODE };
}
export const weightWidth = (w) => Math.max(30, 16 + 9 * [...String(w)].length);
/**
 * 一条边怎么画：两头从结点边上出发；有向图里一对来回的边各往自己的右手边弯一点（两条都看得见）。
 * 返回 { d（SVG 路径）, arrow（箭头，有向才有）, mid（权写在这里）, box, a, b, c（两头和控制点） }
 */
export function edgeGeom(o, e) {
  const A = nodeCenter(o, e.a), B = nodeCenter(o, e.b);
  const back = o.directed && o.edges.some((f) => f !== e && !f.gone && f.a === e.b && f.b === e.a);
  const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
  const bend = back ? 22 : 0;
  const nx = -dy / L, ny = dx / L; // 往前走时的右手边（屏幕 y 朝下）
  const c = { x: (A.x + B.x) / 2 + nx * bend * 2, y: (A.y + B.y) / 2 + ny * bend * 2 };
  const toward = (P, Q, r) => { const ux = Q.x - P.x, uy = Q.y - P.y, d = Math.hypot(ux, uy) || 1; return { x: P.x + (ux / d) * r, y: P.y + (uy / d) * r }; };
  const s = toward(A, c, R + 2);
  const tip = toward(B, c, R + 2);
  const arrowLen = o.directed ? 13 : 0;
  const t = toward(tip, c, arrowLen); // 线画到箭头的底
  const r = (v) => Math.round(v * 10) / 10;
  const end = o.directed ? t : tip;
  const d = `M${r(s.x)} ${r(s.y)} Q${r(c.x)} ${r(c.y)} ${r(end.x)} ${r(end.y)}`;
  let arrow = null;
  if (o.directed) {
    const ux = tip.x - t.x, uy = tip.y - t.y, ul = Math.hypot(ux, uy) || 1;
    const px = -uy / ul * 6.5, py = ux / ul * 6.5;
    arrow = `M${r(tip.x)} ${r(tip.y)} L${r(t.x + px)} ${r(t.y + py)} L${r(t.x - px)} ${r(t.y - py)} Z`;
  }
  const mid = { x: 0.25 * s.x + 0.5 * c.x + 0.25 * tip.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * tip.y };
  return { d, arrow, mid, a: s, b: tip, c, box: bbox([{ x: Math.min(s.x, tip.x, c.x), y: Math.min(s.y, tip.y, c.y), w: Math.abs(s.x - tip.x) || 1, h: Math.abs(s.y - tip.y) || 1 }]) };
}
/** 沿着一条边从 from 那头走到另一头的点（小点沿边走、带着数过去用） */
export function edgePoints(o, e, from, n = 16) {
  const g = edgeGeom(o, e);
  const A = nodeCenter(o, e.a), B = nodeCenter(o, e.b);
  const pts = Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return { x: u * u * A.x + 2 * u * t * g.c.x + t * t * B.x, y: u * u * A.y + 2 * u * t * g.c.y + t * t * B.y, t }; });
  return from === e.a ? pts : pts.reverse().map((p, i) => ({ ...p, t: i / n }));
}
function edgeBox(o, e) {
  const m = edgeGeom(o, e).mid;
  const w = e.w != null ? weightWidth(e.w) : 30, h = e.w != null ? 26 : 30;
  return { x: m.x - w / 2, y: m.y - h / 2, w, h };
}
export function partBox(o, p) {
  if (p.kind === 'edge') return edgeBox(o, p);
  const c = nodeCenter(o, p.key);
  return { x: c.x - R, y: c.y - R - (p.lift ? 10 : 0), w: GNODE, h: GNODE };
}
/**
 * 结点旁边的小字、访问号放在哪个方向：离连着它的边最远的方向（小字取最空的，访问号取离小字够远的次空的）。
 * 返回 { tag: { dx, dy }, ord: { dx, dy } }，相对结点中心
 */
export function spots(o, k) {
  if (rowIndex(o, k) >= 0) return { tag: { dx: 0, dy: R + 16 }, ord: { dx: R - 4, dy: -R + 4 } };
  const c = nodeCenter(o, k);
  const dirs = [];
  for (const e of liveEdges(o)) {
    if (e.a !== k && e.b !== k) continue;
    const g = edgeGeom(o, e);
    dirs.push(Math.atan2(g.c.y - c.y, g.c.x - c.x)); // 弯的边从控制点那个方向出去
  }
  for (const n of o.nodes) {
    if (n.key === k || rowIndex(o, n.key) >= 0) continue;
    const q = nodeCenter(o, n.key);
    if (Math.hypot(q.x - c.x, q.y - c.y) < 150) dirs.push(Math.atan2(q.y - c.y, q.x - c.x));
  }
  const gap = (a) => (dirs.length ? Math.min(...dirs.map((d) => { const x = Math.abs(((a - d + Math.PI * 3) % (Math.PI * 2)) - Math.PI); return x; })) : Math.PI);
  const cands = Array.from({ length: 24 }, (_, i) => (i * Math.PI) / 12 - Math.PI);
  // 一样空时偏爱右上（小字）
  const pref = (a, want) => gap(a) - 0.04 * Math.abs(((a - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const t = cands.reduce((b, a) => (pref(a, -Math.PI / 4) > pref(b, -Math.PI / 4) ? a : b));
  const far = cands.filter((a) => Math.abs(((a - t + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > Math.PI / 2.4);
  const od = far.reduce((b, a) => (pref(a, (3 * Math.PI) / 4) > pref(b, (3 * Math.PI) / 4) ? a : b), far[0]);
  const at = (a, r) => ({ dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r) });
  return { tag: at(t, R + 18), ord: at(od, R - 2) };
}

// —— 几样常用的 ——
const shownEdge = (o, e) => `${e.a}${o.directed ? '→' : '–'}${e.b}`;
const num = (v) => (v == null || v === '∞' || /^inf/i.test(v) ? Infinity : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : NaN);
const fmt = (v) => (v === Infinity ? '∞' : String(Math.round(v * 1000) / 1000));
function findEdge(o, x, y, word) {
  const exact = o.edges.find((e) => e.a === x && e.b === y);
  const rev = o.edges.find((e) => e.a === y && e.b === x);
  const e = exact || rev;
  if (!e) {
    if (!nodeOf(o, x) || !nodeOf(o, y)) throw new Error(`「${word}」：图 ${o.id} 没有结点 ${!nodeOf(o, x) ? x : y}（有：${o.nodes.map((n) => n.key).join(' ')}）`);
    const near = o.edges.filter((f) => f.a === x || f.b === x).map((f) => `${o.id}.${f.a}~${f.b}`);
    throw new Error(`${o.id} 里 ${x} 和 ${y} 之间没有边${near.length ? `（${x} 连着的：${near.join(' ')}）` : ''}`);
  }
  if (e.gone) throw new Error(`${shownEdge(o, e)} 这条边跟着拿掉的结点一起没了`);
  return e;
}
const indeg = (o, k) => liveEdges(o).filter((e) => (o.directed ? e.b === k : e.a === k || e.b === k)).length;
function graphIn(scene, h, cmd) {
  const w = h.refsIn()[0];
  if (!w) {
    const first = h.words.find((x) => parseRef(x));
    if (first) h.scene.parts(first);
    throw new Error(`${cmd} 要写对哪张图做`);
  }
  const o = scene.objects.get(parseRef(w).obj);
  for (const r of h.refsIn()) if (parseRef(r).obj !== o.id) throw new Error(`${cmd} 一行只能对一张图做`);
  return { o, whole: !parseRef(w).mark };
}
const nodesIn = (h, cmd, example) => {
  const ps = h.partsIn();
  if (!ps.length) throw new Error(`要写成 ${example}`);
  for (const p of ps) if (p.kind !== 'node') throw new Error(`${cmd} 对结点做（写的 ${p.label} 是边）`);
  return ps;
};
const FLAGS = ['paint', 'glow', 'lift', 'dim', 'covered'];
const adjacent = (o, a, b) => liveEdges(o).some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));

export const graph = {
  type: 'graph',
  label: '图',
  create: ['graph'],
  // 认得的选项（名字=值，scene.js 的 checkOptions；造它的那一行另外都认 hide=）；边权写成 A-B=4 的照收，交给 make 报「用冒号」
  options: { graph: ['pos', /[-~>]/] },
  remake: true, // 造它的那一行里能写 {式子}（value.js）：依赖一变，场景照新的数把这一行重新造一遍
  /**
   * 重新造（scene.js 的 remake：拨了一条边的权）：老师这几轮做的按结点名、边带到新造的那一份——旁边的数（tag、relax 改的）、
   * 访问号、拿掉的结点和边、标度、样子。以前全丢了，老师只听说「{w} 从 4 变成 6」
   */
  carry(old, o) {
    for (const n of o.nodes) {
      const m = old.nodes.find((x) => x.key === n.key);
      if (!m) continue;
      for (const f of FLAGS) n[f] = m[f];
      n.tag = m.tag;
      n.value = m.tag ?? n.key;
      n.order = m.order;
    }
    for (const e of o.edges) {
      const m = old.edges.find((x) => x.key === e.key);
      if (!m) continue;
      for (const f of FLAGS) e[f] = m[f];
      e.gone = m.gone;
    }
    const has = (k) => o.nodes.some((n) => n.key === k);
    o.taken = old.taken.filter(has);
    o.visits = Math.max(0, ...o.nodes.map((n) => n.order || 0));
    o.last = has(old.last) ? old.last : null;
    o.deg = old.deg;
  },
  hint: '（图：名字.A 是结点，名字.A~B 是边（paint、glow、dim 对边也行），名字.nodes 全部结点，名字.edges 全部边）',
  make(scene, c, h, old) {
    const eq = h.args.findIndex((a) => a.t === 'eq');
    if (eq < 0) throw new Error('要写成 graph 名字 = A-B:4 A-C:2 B-D（有向写 A>B，:4 是权，可以不写）');
    const id = h.words[0];
    for (const k of Object.keys(h.opts)) if (/[-~>]/.test(k)) throw new Error(`权写成 ${k}:${h.opts[k]}（用冒号，不用等号）`);
    // 等号后面：A-B:4、A>B、单独的 E；A -> B 分开写也认
    const toks = h.args.slice(eq + 1);
    const specs = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'arrow') throw new Error('箭头两边要有结点：A>B 或 A -> B');
      if (t.t !== 'word') throw new Error('graph 的等号后面写边（A-B:4、A>B）或单独的结点');
      if (toks[i + 1]?.t === 'arrow' && toks[i + 2]?.t === 'word') { specs.push(`${t.v}>${toks[i + 2].v}`); i += 2; continue; }
      specs.push(t.v);
    }
    if (!specs.length) throw new Error('graph 后面要有边，比如 graph g = A-B:4 A-C:2');
    const names = [], edges = [];
    const addName = (k) => {
      if (!NAME.test(k)) throw new Error(`结点的名字用字母或数字（最多 4 个），「${k}」不行`);
      if (!names.includes(k)) names.push(k);
    };
    const kinds = new Set();
    for (const s of specs) {
      const m = s.match(/^([^-~>—–:]+)\s*([-~>—–])\s*([^-~>—–:]+)(?::(.+))?$/);
      if (!m) { if (s.includes(':')) throw new Error(`「${s}」看不懂：边写 A-B:4（有向 A>B:4）`); addName(s); continue; }
      const [, a, op, b, w] = m;
      addName(a); addName(b);
      if (a === b) throw new Error(`${a} 连到自己的边（自环）画不了`);
      kinds.add(op === '>' ? '>' : '-');
      if (w != null && !/^-?\d+(\.\d+)?$/.test(w)) throw new Error(`「${s}」的权要是数`);
      edges.push({ a, b, w: w ?? null, dir: op === '>' });
    }
    if (kinds.size > 1) throw new Error('一张图里的边要么都是 A-B（无向），要么都是 A>B（有向）');
    const directed = kinds.has('>');
    const weighted = edges.some((e) => e.w != null);
    const bare = edges.filter((e) => e.w == null);
    if (weighted && bare.length) throw new Error(`有的边写了权、有的没写（${bare.map((e) => `${e.a}${directed ? '>' : '-'}${e.b}`).join('、')} 没写）`);
    const seen = new Set();
    for (const e of edges) {
      const k = directed ? `${e.a}>${e.b}` : [e.a, e.b].sort().join('-');
      if (seen.has(k)) throw new Error(`${e.a}${directed ? '→' : '–'}${e.b} 写了两次`);
      seen.add(k);
    }
    if (names.length > MAX_GNODES) throw new Error(`一张图最多 ${MAX_GNODES} 个结点（写了 ${names.length} 个）`);
    if (edges.length > MAX_EDGES) throw new Error(`一张图最多 ${MAX_EDGES} 条边`);
    // 老师给的坐标：pos="A=0,0 B=2,0"（一个单位大约一条边长，x 往右、y 往下）
    let pos;
    if (h.opts.pos != null) {
      pos = {};
      for (const item of String(h.opts.pos).split(/[\s;]+/).filter(Boolean)) {
        const m = item.match(/^([A-Za-z0-9]+)[=:](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
        if (!m) throw new Error(`pos 写成 pos="A=0,0 B=2,0"（「${item}」看不懂）`);
        if (!names.includes(m[1])) throw new Error(`pos 里的 ${m[1]} 不是图里的结点`);
        pos[m[1]] = { x: Number(m[2]) * EDGE_LEN, y: Number(m[3]) * EDGE_LEN };
      }
      const miss = names.filter((k) => !pos[k]);
      if (miss.length) throw new Error(`pos 要给每个结点（${miss.join(' ')} 没给）`);
      const x0 = Math.min(...Object.values(pos).map((p) => p.x)), y0 = Math.min(...Object.values(pos).map((p) => p.y));
      for (const k of names) pos[k] = { x: pos[k].x - x0, y: pos[k].y - y0 };
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        if (Math.hypot(pos[names[i]].x - pos[names[j]].x, pos[names[i]].y - pos[names[j]].y) < GNODE + 10) throw new Error(`pos 里 ${names[i]} 和 ${names[j]} 挨得太近了`);
      }
    } else pos = layoutGraph(names, edges, { directed, weighted: edges.some((e) => e.w != null) });
    const flags = () => ({ paint: null, glow: false, lift: false, dim: false, covered: false });
    const o = {
      origin: { x: 0, y: 0 }, directed, weighted, pos, taken: [], visits: 0, last: null, deg: false,
      nodes: names.map((k) => ({ obj: id, key: k, kind: 'node', label: k, value: k, tag: null, order: null, ...flags() })),
      edges: edges.map((e) => ({ obj: id, key: `${e.a}~${e.b}`, kind: 'edge', a: e.a, b: e.b, w: e.w, label: `${e.a}${directed ? '→' : '–'}${e.b}`, value: e.w ?? `${e.a}${directed ? '→' : '–'}${e.b}`, gone: false, ...flags() })),
    };
    if (old?.type === 'graph') o.origin = { ...old.origin };
    else {
      const xs = Object.values(pos).map((p) => p.x), ys = Object.values(pos).map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs) + GNODE + 2 * TAG_ROOM;
      const s = scene.slotFor(w);
      o.origin = { x: s.x + TAG_ROOM + R - Math.min(...xs), y: s.y + TAG_ROOM + R - Math.min(...ys) };
    }
    return o;
  },
  parts(o) { return [...o.nodes, ...liveEdges(o)]; },
  /** 扣着的边画成小块写两头（A–B，不写权）；扣着的结点不写名字（scene.js 的 coverText） */
  coverName: (p, o) => (p.kind === 'edge' ? p.label : `${o.id} 里扣着的一个结点`),
  pick(o, mark, sel, word) {
    const how = `图的部件写 ${o.id}.A（结点）或 ${o.id}.A~B（边）`;
    if (mark === '#') throw new Error(`「${word}」：${how}`);
    if (sel === 'nodes') return [...o.nodes];
    if (sel === 'edges') return liveEdges(o);
    const m = sel.match(/^([A-Za-z0-9]+)[~>—–-]([A-Za-z0-9]+)$/);
    if (m) return [findEdge(o, m[1], m[2], word)];
    const n = nodeOf(o, sel) || (() => { const hits = o.nodes.filter((x) => x.key.toLowerCase() === sel.toLowerCase()); return hits.length === 1 ? hits[0] : null; })();
    if (!n) throw new Error(`图 ${o.id} 没有结点 ${sel}（有：${o.nodes.map((x) => x.key).join(' ')}；边写 ${o.id}.A~B）`);
    return [n];
  },
  ref(p) { return p.kind === 'edge' ? `${p.obj}.${p.a}~${p.b}` : `${p.obj}.${p.key}`; },
  partBox,
  objectBox(o) {
    const g = graphArea(o);
    const boxes = [{ x: g.x - TAG_ROOM, y: g.y - TAG_ROOM, w: g.w + 2 * TAG_ROOM, h: g.h + 2 * TAG_ROOM }];
    for (const k of o.taken) boxes.push(partBox(o, nodeOf(o, k)));
    for (const e of liveEdges(o)) boxes.push(edgeBox(o, e));
    return bbox(boxes);
  },
  obstacles(o) {
    const out = [];
    for (const n of o.nodes) { const b = partBox(o, n); out.push({ x: b.x - 16, y: b.y - 16, w: b.w + 32, h: b.h + 32 }); }
    for (const e of liveEdges(o)) {
      out.push(edgeBox(o, e));
      const pts = edgePoints(o, e, e.a, 8);
      for (const p of pts.slice(2, -2)) out.push({ x: p.x - 7, y: p.y - 7, w: 14, h: 14 });
    }
    return out;
  },
  commands: {
    // tag g.B 7：结点旁边写个数（Dijkstra 的 dist、Prim 的 lowcost……）；tag g ∞ 每个都写；改了数字会换一下
    tag(scene, c, h) {
      h.strayRefs();
      const { o, whole } = graphIn(scene, h, 'tag');
      const ps = whole ? o.nodes : nodesIn(h, 'tag', 'tag g.B 7');
      const text = h.str ?? h.words.filter((w) => !scene.isRef(w)).at(-1);
      if (text == null || text === '') throw new Error('要写成 tag g.B 7（∞ 也行）');
      if ([...String(text)].length > 8) throw new Error('tag 的字要短（最多 8 个字；长的用 label）');
      for (const p of ps) { p.tag = String(text); p.value = p.tag; }
      return { id: o.id, parts: ps };
    },
    untag(scene, c, h) {
      h.strayRefs();
      const { o, whole } = graphIn(scene, h, 'untag');
      for (const p of whole ? o.nodes : nodesIn(h, 'untag', 'untag g.B')) { p.tag = null; p.value = p.key; }
      return { id: o.id };
    },
    // relax g.A -> g.B：松弛——A 的数 + 边权 比 B 的小，就把 B 改成它（Dijkstra 的一步）
    relax(scene, c, h) {
      h.strayRefs();
      const { o } = graphIn(scene, h, 'relax');
      const ps = h.partsIn();
      let from, to, e;
      if (ps.length === 1 && ps[0].kind === 'edge') { e = ps[0]; const r = parseRef(h.refsIn()[0]).sel.split(/[~>—–-]/); [from, to] = r[0] === e.a ? [e.a, e.b] : [e.b, e.a]; }
      else if (ps.length === 2 && ps.every((p) => p.kind === 'node')) { [from, to] = ps.map((p) => p.key); e = findEdge(o, from, to, `${o.id}.${from}~${to}`); }
      else throw new Error('要写成 relax g.A -> g.B（从 A 松弛到 B）');
      if (o.directed && !(e.a === from && e.b === to)) throw new Error(`有向图里只有 ${e.a}→${e.b}，不能从 ${from} 到 ${to}`);
      const A = nodeOf(o, from), B = nodeOf(o, to);
      const dA = num(A.tag), dB = num(B.tag);
      if (!Number.isFinite(dA)) throw new Error(`${from} 还没有距离（先写 tag ${o.id}.${from} 0）${A.tag === '∞' ? '：它还是 ∞，不能从它松弛' : ''}`);
      if (Number.isNaN(dB)) throw new Error(`${to} 旁边写的「${B.tag}」不是数`);
      const w = e.w == null ? 1 : Number(e.w);
      const alt = dA + w;
      const improved = alt < dB;
      const before = B.tag ?? '∞';
      if (improved) { B.tag = fmt(alt); B.value = B.tag; }
      return { id: o.id, from, to, edge: e, dA: fmt(dA), w: fmt(w), alt: fmt(alt), before, improved };
    },
    // visit g.A g.C：编访问号（和上一个访问的有边，圈就沿边走过去）
    visit(scene, c, h) {
      h.strayRefs();
      const { o } = graphIn(scene, h, 'visit');
      const ps = nodesIn(h, 'visit', 'visit g.A g.C');
      const seen = new Set();
      for (const p of ps) {
        if (p.order != null) throw new Error(`${p.key} 已经访问过了（第 ${p.order} 个）；重来先写 unvisit ${o.id}`);
        if (seen.has(p.key)) throw new Error(`${p.key} 写了两次`);
        seen.add(p.key);
      }
      const from = o.last;
      for (const p of ps) p.order = ++o.visits;
      o.last = ps.at(-1).key;
      return { id: o.id, keys: ps.map((p) => p.key), from };
    },
    unvisit(scene, c, h) {
      h.strayRefs();
      const { o, whole } = graphIn(scene, h, 'unvisit');
      const ps = whole ? o.nodes : nodesIn(h, 'unvisit', 'unvisit g');
      for (const p of ps) p.order = null;
      o.visits = Math.max(0, ...o.nodes.map((n) => n.order || 0));
      if (whole || ps.some((p) => p.key === o.last)) o.last = null;
      return { id: o.id };
    },
    // walk g.A g.B g.D：一个圈沿着边走过这几个（相邻的才能走）
    walk(scene, c, h) {
      h.strayRefs();
      const { o } = graphIn(scene, h, 'walk');
      const ps = nodesIn(h, 'walk', 'walk g.A g.B g.D');
      for (const p of ps) if (rowIndex(o, p.key) >= 0) throw new Error(`${p.key} 已经拿掉了`);
      for (let i = 1; i < ps.length; i++) if (!adjacent(o, ps[i - 1].key, ps[i].key)) throw new Error(`${ps[i - 1].key} 和 ${ps[i].key} 之间没有边（walk 要沿着边走）`);
      return { id: o.id, path: ps.map((p) => p.key) };
    },
    // take g.A：拓扑排序的一步——拿掉 A 和它连着的边，A 排到下面的序列里
    take(scene, c, h) {
      h.strayRefs();
      const { o } = graphIn(scene, h, 'take');
      const ps = nodesIn(h, 'take', 'take g.A');
      if (ps.length !== 1) throw new Error('take 一次拿一个结点（好几个就写好几行）');
      const k = ps[0].key;
      if (rowIndex(o, k) >= 0) throw new Error(`${k} 已经拿掉了`);
      const gone = liveEdges(o).filter((e) => e.a === k || e.b === k);
      const before = o.directed ? indeg(o, k) : 0;
      for (const e of gone) e.gone = true;
      o.taken.push(k);
      for (const [key, l] of scene.links) if ([l.a, l.b].some((x) => x.obj === o.id && gone.some((e) => e.key === x.key))) scene.links.delete(key);
      return { id: o.id, key: k, edges: gone.map((e) => e.key), indeg: before };
    },
    // deg g：每个结点旁边标入度（无向图标度），拿掉结点跟着变；undeg g 收起
    deg(scene, c, h) { const { o } = graphIn(scene, h, 'deg'); o.deg = true; return { id: o.id }; },
    undeg(scene, c, h) { const { o } = graphIn(scene, h, 'undeg'); o.deg = false; return { id: o.id }; },
  },
  describe(o) {
    const es = liveEdges(o);
    const lines = [`图 ${o.id}（${o.directed ? '有向' : '无向'}${o.weighted ? '、带权' : ''}，${o.nodes.length} 个结点、${es.length} 条边）：`];
    lines.push(`  边：${es.length ? es.map((e) => `${shownEdge(o, e)}${e.w != null ? ` ${e.w}` : ''}`).join('、') : '没有了'}`);
    const groups = new Map();
    const put = (k, s) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); };
    for (const p of [...o.nodes, ...es]) {
      const s = p.kind === 'edge' ? shownEdge(o, p) : p.key;
      if (p.paint) put(COLOR_NAMES[p.paint], s);
      if (p.glow) put('亮', s);
      if (p.lift) put('抬起', s);
      if (p.dim) put('灰', s);
      if (p.covered) put('扣着', s);
    }
    if (groups.size) lines.push(`  样子：${[...groups].map(([k, v]) => `${k} ${v.join(' ')}`).join('；')}`);
    const tags = o.nodes.filter((n) => n.tag != null);
    if (tags.length) lines.push(`  旁边的数：${tags.map((n) => `${n.key} ${n.tag}`).join('，')}`);
    const vis = o.nodes.filter((n) => n.order != null).sort((a, b) => a.order - b.order);
    if (vis.length) lines.push(`  访问顺序：${vis.map((n) => n.key).join(' ')}`);
    if (o.taken.length) lines.push(`  拿掉的（按先后排在下面）：${o.taken.join(' ')}`);
    if (o.deg) {
      const rest = o.nodes.filter((n) => rowIndex(o, n.key) < 0);
      lines.push(`  ${o.directed ? '入度' : '度'}：${rest.map((n) => `${n.key} ${indeg(o, n.key)}`).join('，') || '都拿掉了'}`);
    }
    return lines;
  },
  doc: `图（BFS / DFS、最小生成树、最短路、拓扑排序）：
graph g = A-B:4 A-C:2 B-C:1 B-D:5 C-D:8 D-E:3    造一张无向图（:4 是权，可以不写，也能写 {式子}：A-B:{k}；有向写 A>B；单独的结点写 E；最多 16 个；自动排好）
graph h = A-B B-C A-C pos="A=0,0 B=2,0 C=1,1"     自己给坐标（每个结点都给，一个单位约一条边长，y 往下）
写法：g.A 结点；g.A~B 边（paint、glow、dim 对边也行：Kruskal 选进来的染色、成环的灰掉）；g.nodes 全部结点；g.edges 全部边
tag g.A 0 / tag g ∞ / untag g     结点旁边写个数（dist、lowcost……，最多 8 个字），改了会换一下
relax g.A -> g.B                  松弛：A 的数 + 边权 比 B 的小就改成它（小点带着数沿边过去）；只认数，先 tag g ∞ 再 tag g.A 0（写 ? 会报不是数）
visit g.A g.C / unvisit g         编访问号（和上一个访问的有边，圈就沿边走过去）
walk g.A g.B g.D                  一个圈沿着边走过这几个（要相邻）
take g.A                          拓扑排序：拿掉 A 和它的边，A 排到下面的序列里
deg g / undeg g                   每个结点旁边标入度（无向图是度），拿掉结点跟着变`,
  example: `graph g = A-B:4 A-C:2 B-C:1 B-D:5 C-D:8 D-E:3
tag g ∞
tag g.A 0
say "从 {g.A} 出发，先看它的两条边。"
glow g.A~B g.A~C
relax g.A -> g.B
relax g.A -> g.C
paint g.A g3
ask tap g.nodes "下一个该定下来的是谁？" expect=g.C`,
};
