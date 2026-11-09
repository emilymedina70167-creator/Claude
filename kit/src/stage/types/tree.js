// 舞台上的二叉树（遍历、二叉排序树、平衡二叉树、堆）：数据和指令，不碰 DOM（画法在 tree.view.js）。纯函数，有测试（tests/stage-tree.test.js）。
// 结点是部件：key 是跟着它走的编号（造的时候层序第几个，后长出来的接着编），value 是显示的值，左右孩子记 key。
// 排版（layoutTree）两种，造的时候定下（o.layout，以后不换）：
//   inorder（造的时候是二叉排序树）：照中序名次一个结点一列（和黑板 engines/treeview.js 一样），纵坐标照层——插入时只有新结点右边的
//     往右让一列，旋转不改中序、结点只上下移，学生盯着的那几个不会左右乱跑。origin 是「第一列、根那一层」的中心，树往右、往下长；
//   compact（堆、表达式树……中序没有意思的）：照旧按子树宽度紧凑排，左右对称，根在 origin。一个结点一列要宽一倍，大一点的堆竖屏放不下。
// 老师可以写 layout=inorder / compact 自己定。放不下镜头往后退（stage.js 的 keepInView），不重排
// 部件的写法：t.40（值是 40 的那个，值唯一时）、t#3（层序第 3 个，跟着结点走：堆里换值、值有重复时用）、t.40*（40 和它整棵子树）
import { bbox } from '../layout.js';
import { parseRef } from '../script.js';

export const NODE = 56; // 结点的直径
export const SEP = 86; // 同一层两个结点的中心至少隔多远（中间留着贴角标的地方）
export const COL = SEP; // 一列多宽：中序第 k 个（从 0 数）的中心在第一列右边 k × COL
export const LEVEL = 92; // 一层多高（中心到中心）
export const MAX_NODES = 31;
export const MAX_DEPTH = 8; // 最多几层
export const TAG_ROOM = 18; // 结点左右角上的小字、下面的访问号占的地方（镜头、贴字、别的东西都让开）
export const TAG_TOP = 30; // 结点上面两个角标占的高（cornerRect：浮在结点上方一点，不压从父结点下来的树枝）
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
export const SIDES = { left: 'left', right: 'right', l: 'left', r: 'right', 左: 'left', 右: 'right', L: 'left', R: 'right' };
const KINDS = { pre: 'pre', in: 'in', post: 'post', level: 'level', preorder: 'pre', inorder: 'in', postorder: 'post', 先序: 'pre', 前序: 'pre', 中序: 'in', 后序: 'post', 层序: 'level' };
const KIND_NAMES = { pre: '先序', in: '中序', post: '后序', level: '层序' };

// 两个值比大小（和 scene.js 的 compareValues 一样：49′ 和 49 一样大；数比数，别的按字）。不从 scene.js 拿：那边 import 这里，会绕成圈
const prime = (v) => String(v).replace(/[′']/g, '');
const numOf = (v) => (/^-?\d+(\.\d+)?$/.test(prime(v)) ? Number(prime(v)) : null);
export function cmpValues(a, b) {
  const x = numOf(a), y = numOf(b);
  if (x != null && y != null) return x < y ? -1 : x > y ? 1 : 0;
  const s = prime(a), t = prime(b);
  return s < t ? -1 : s > t ? 1 : 0;
}

const FLAGS = ['paint', 'glow', 'lift', 'dim', 'covered'];
const nodeAt = (o, k) => o.nodes.find((n) => n.key === k) || null;
const parentOf = (o, k) => o.nodes.find((n) => n.left === k || n.right === k) || null;
const isNull = (v) => v === '_' || v === 'null' || v === '∅';

/** 按层序的值 → 结点（下标从 0，孩子记下标）。先按「空的下面不用再写」读（LeetCode 那样），读不通再按顺序存储（空位的孩子也写 _）读 */
export function buildLevel(vals) {
  const toks = vals.map((v) => (isNull(v) ? null : String(v)));
  if (toks.every((t) => t == null)) return [];
  if (toks[0] == null) throw new Error('层序的第一个是根，不能是 _（空树写 tree t = _）');
  const compact = () => {
    const nodes = [{ value: toks[0], left: null, right: null }];
    let k = 1, head = 0;
    while (k < toks.length) {
      if (head >= nodes.length) return toks.slice(k).every((t) => t == null) ? nodes : null; // 多出来的值没地方挂
      const p = nodes[head++];
      for (const side of ['left', 'right']) {
        if (k >= toks.length) break;
        const t = toks[k++];
        if (t != null) { p[side] = nodes.length; nodes.push({ value: t, left: null, right: null }); }
      }
    }
    return nodes;
  };
  const stored = () => {
    // 顺序存储：第 i 个的孩子是第 2i、2i+1 个（从 1 数）
    const at = new Map();
    const nodes = [];
    for (let q = 1; q <= toks.length; q++) {
      if (toks[q - 1] == null) continue;
      if (q > 1 && !at.has(Math.floor(q / 2))) return null;
      at.set(q, nodes.length);
      nodes.push({ value: toks[q - 1], left: null, right: null });
      if (q > 1) nodes[at.get(Math.floor(q / 2))][q % 2 ? 'right' : 'left'] = at.get(q);
    }
    return nodes;
  };
  const out = compact() || stored();
  if (!out) throw new Error('层序里有的值没地方挂：按层从左往右写，_ 是空，空的下面不用再写（比如 50 30 70 _ 40 _ 80）');
  return out;
}

/** 整棵树按层序（结点数组） */
export function levelOrder(o, start = o.root) {
  const out = [];
  if (start == null) return out;
  const q = [start];
  while (q.length) {
    const n = nodeAt(o, q.shift());
    if (!n) continue;
    out.push(n);
    if (n.left != null) q.push(n.left);
    if (n.right != null) q.push(n.right);
  }
  return out;
}

/** 写回层序（造树的那种写法，结尾的 _ 去掉）：给老师看的现状里用，照抄就能再造一棵一样的 */
export function serialize(o) {
  if (o.root == null) return '_';
  const out = [];
  const q = [o.root];
  while (q.length) {
    const k = q.shift();
    if (k == null) { out.push('_'); continue; }
    const n = nodeAt(o, k);
    out.push(n.value);
    q.push(n.left, n.right);
  }
  while (out.at(-1) === '_') out.pop();
  return out.join(' ');
}

export function heightOf(o, k) {
  if (k == null) return 0;
  const n = nodeAt(o, k);
  return n ? 1 + Math.max(heightOf(o, n.left), heightOf(o, n.right)) : 0;
}
/** 平衡因子：左子树高 − 右子树高（王道的口径） */
export const bfOf = (o, k) => { const n = nodeAt(o, k); return heightOf(o, n.left) - heightOf(o, n.right); };
export const bfText = (v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

/** 每个结点在第几层（根是 0） */
export function depths(o) {
  const out = new Map();
  const go = (k, d) => { if (k == null) return; const n = nodeAt(o, k); if (!n) return; out.set(k, d); go(n.left, d + 1); go(n.right, d + 1); };
  go(o.root, 0);
  return out;
}

// —— 排版 ——
export const LAYOUTS = ['inorder', 'compact'];
const LAYOUT_CACHE = new Map();
/**
 * 每个结点的中心（y 往下一层 LEVEL，根在 y = 0）。struct 是 { root, nodes: [{ key, left, right }] }（树本身也行：照它的 o.layout）；
 * mode 是排法（结构快照没有 layout，要传树的）。返回 Map(key → { x, y, depth, side, col })，side 是 'root' / 'left' / 'right'，
 * col 是中序名次（从 0 数）。
 * inorder：x 是中序名次 × COL，第一列在 x = 0。一个结点一列，不会重叠，二叉排序树从左到右正好从小到大；同一层的两个结点中间至少隔着一列
 *   （中序挨着的两个总是一个是另一个的祖先，不在同一层），角标贴在两边碰不到邻居。
 * compact：根在 x = 0，左子树整个在 −SEP/2 往左、右子树整个在 +SEP/2 往右，两个孩子对称摆开，距离按两边子树要的宽度取大的（第一轮的排法）
 */
export function layoutTree(struct, mode = struct.layout || 'inorder') {
  const sig = `${mode}|${struct.root}|${struct.nodes.map((n) => `${n.key}:${n.left ?? ''},${n.right ?? ''}`).join(';')}`;
  const hit = LAYOUT_CACHE.get(sig);
  if (hit) return hit;
  const by = new Map(struct.nodes.map((n) => [n.key, n]));
  const pos = new Map();
  let col = 0;
  // 中序走一遍：先左子树、再自己、再右子树（最多 8 层，递归不深）
  const walk = (k, depth, side) => {
    const n = by.get(k);
    if (!n || pos.has(k)) return;
    if (n.left != null) walk(n.left, depth + 1, 'left');
    pos.set(k, { x: col * COL, y: depth * LEVEL, depth, side, col });
    col++;
    if (n.right != null) walk(n.right, depth + 1, 'right');
  };
  if (struct.root != null) walk(struct.root, 0, 'root');
  if (mode === 'compact' && pos.size) compactX(by, struct.root, pos);
  if (LAYOUT_CACHE.size > 400) LAYOUT_CACHE.clear();
  LAYOUT_CACHE.set(sig, pos);
  return pos;
}
// 紧凑排的横坐标（相对根）：先算每棵子树每一层的左右边，两个孩子按两边要的宽度对称摆开，再从根往下放
function compactX(by, root, pos) {
  const off = new Map();
  const half = SEP / 2;
  const shape = (k) => {
    const n = by.get(k);
    const L = n.left != null && by.has(n.left) ? shape(n.left) : null;
    const R = n.right != null && by.has(n.right) ? shape(n.right) : null;
    let d = half;
    for (const c of L || []) d = Math.max(d, c.r + half);
    for (const c of R || []) d = Math.max(d, half - c.l);
    if (L) off.set(n.left, -d);
    if (R) off.set(n.right, d);
    const out = [{ l: 0, r: 0 }];
    for (let i = 0; i < Math.max(L?.length || 0, R?.length || 0); i++) {
      const a = L?.[i], b = R?.[i];
      out.push({ l: Math.min(a ? a.l - d : Infinity, b ? b.l + d : Infinity), r: Math.max(a ? a.r - d : -Infinity, b ? b.r + d : -Infinity) });
    }
    return out;
  };
  shape(root);
  const place = (k, x) => {
    const n = by.get(k);
    pos.get(k).x = x;
    if (n.left != null && by.has(n.left)) place(n.left, x + off.get(n.left));
    if (n.right != null && by.has(n.right)) place(n.right, x + off.get(n.right));
  };
  place(root, 0);
}
/** 这棵树照它自己的排法、某个结构（旋转的中间一步）排 */
const posOf = (o, struct = o) => layoutTree(struct, o.layout || 'inorder');

/**
 * 一次旋转里换了父亲的那棵子树的根（右旋 a：a 的左孩子 b 转上来，b 原来的右子树挂到 a 的左边——就是它）；
 * 没有这棵子树（b 那一边是空的）、或者 before → after 不是一次旋转，给 null。画面拿它描一道橙色（tree.view.js）
 */
export function movedSubtree(before, after) {
  const parents = (s) => {
    const m = new Map();
    for (const n of s.nodes) for (const c of [n.left, n.right]) if (c != null) m.set(c, n.key);
    return m;
  };
  const P0 = parents(before), P1 = parents(after);
  const keys = new Set([...before.nodes, ...after.nodes].map((n) => n.key));
  const changed = [...keys].filter((k) => (P0.get(k) ?? null) !== (P1.get(k) ?? null));
  // 转的两个：原来 a 是 b 的父亲，转完 b 是 a 的父亲
  const pivots = new Set();
  for (const k of changed) { const p = P0.get(k); if (p != null && P1.get(p) === k) { pivots.add(k); pivots.add(p); } }
  if (pivots.size !== 2) return null;
  const rest = changed.filter((k) => !pivots.has(k));
  return rest.length === 1 ? rest[0] : null;
}

/**
 * 结点角上的小字贴在哪（相对结点框的左上角；w 是小字多宽）：老师写的 tag 左上、平衡因子右上、子树高右下，访问号在正下方。
 * 三样分开贴，一起开着也不叠、不压结点里的值。上面两个浮在结点上方、各占半边（左上的往左长、右上的往右长）：
 * 照中序排，父结点在左上或右上隔几列，树枝往上翘的角度从 47° 到很平，贴在圆的斜角上就压着进来的那根树枝；
 * 往上提到正上方两侧，任何一根都碰不到（tests/stage-tree.test.js 量过）。右下那个让开正下方的访问号。画面的 CSS（tree.view.js）照这里的数写
 */
export const CORNER_H = 22;
const CORNER_MID = 2; // 上面两个离结点竖着的中线多远（中间留一道缝）
const CORNER_LOW = 12; // 右下那个、访问号低出结点多少
const ORDER_W = 24, ORDER_H = 24;
export function cornerRect(kind, w = 24) {
  const top = -(TAG_TOP - 2); // 上面两个的上沿（下沿离圆顶 6）
  if (kind === 'tag') return { x: NODE / 2 - CORNER_MID - w, y: top, w, h: CORNER_H };
  if (kind === 'bf') return { x: NODE / 2 + CORNER_MID, y: top, w, h: CORNER_H };
  if (kind === 'height') return { x: NODE - 10, y: NODE + CORNER_LOW - CORNER_H, w, h: CORNER_H };
  if (kind === 'order') return { x: NODE / 2 - ORDER_W / 2, y: NODE + CORNER_LOW - ORDER_H, w: Math.max(ORDER_W, w), h: ORDER_H };
  throw new Error(`角上没有「${kind}」`);
}

/** 照某个结构（旋转的中间一步）每个结点的框；不传就是树现在的样子 */
export function boxesFor(o, struct = o) {
  const pos = posOf(o, struct);
  const out = new Map();
  for (const n of o.nodes) {
    const p = pos.get(n.key);
    if (!p) continue;
    out.set(n.key, { x: o.origin.x + p.x - NODE / 2, y: o.origin.y + p.y - NODE / 2 - (n.lift ? 10 : 0), w: NODE, h: NODE });
  }
  return out;
}
export function nodeBox(o, p) {
  const pos = posOf(o).get(p.key) || { x: 0, y: 0 };
  return { x: o.origin.x + pos.x - NODE / 2, y: o.origin.y + pos.y - NODE / 2 - (p.lift ? 10 : 0), w: NODE, h: NODE };
}
/** 空树时根的位置（画一个虚圈，插进来就长在这里） */
export const rootSpot = (o) => ({ x: o.origin.x - NODE / 2, y: o.origin.y - NODE / 2, w: NODE, h: NODE });
const roomy = (b) => ({ x: b.x - TAG_ROOM, y: b.y - TAG_TOP, w: b.w + 2 * TAG_ROOM, h: b.h + TAG_TOP + 12 });
/** 结点（连角标）占的地方，不算托盘：拖托盘里的数进树时，落在这一块里就是插进树里 */
export const treeArea = (o) => bbox(o.nodes.length ? o.nodes.map((n) => roomy(nodeBox(o, n))) : [roomy(rootSpot(o))]);
const nodesArea = treeArea;

export const TRAY_GAP = 20; // 托盘里两个数之间（能拖时外面一圈呼吸的光，挨太近就叠在一起）
const TRAY_TOP = 22; // 托盘离树最下面一层多远
const TRAY_PAD = 10; // 托盘的底板比里面的数宽出去多少
/**
 * 托盘（待插的数）画在哪：树下面一排圆，和结点一样大（世界坐标）。按中序排的正中对着树的正中（根不在正中），紧凑排的照旧对着根。
 * 没有托盘是 []
 */
export function trayBoxes(o) {
  const vals = o.tray || [];
  if (!vals.length) return [];
  const b = nodesArea(o);
  const w = vals.length * NODE + (vals.length - 1) * TRAY_GAP;
  const mid = o.layout === 'compact' ? o.origin.x : b.x + b.w / 2;
  const x0 = mid - w / 2, y = b.y + b.h + TRAY_TOP;
  return vals.map((value, i) => ({ value, x: x0 + i * (NODE + TRAY_GAP), y, w: NODE, h: NODE }));
}
/** 托盘的底板（包着那一排数）；没有托盘是 null */
export function trayArea(o) {
  const bs = trayBoxes(o);
  if (!bs.length) return null;
  const b = bbox(bs);
  return { x: b.x - TRAY_PAD, y: b.y - TRAY_PAD, w: b.w + 2 * TRAY_PAD, h: b.h + 2 * TRAY_PAD };
}
/**
 * 能放新结点的空位（open t place：学生把托盘的数拖到某个结点下面）：每个结点缺孩子的那一边、空树的根。
 * 按中序排：放进去的结点会落在它和中序的邻居中间，空位就画在半列的地方、下一层（左边空着是它左边半列，右边空着是右边半列）；
 * 那里上下挨着的两列都不在这一层（缺左孩子的，中序前一个是它的祖先），不会压着别的结点。
 * 紧凑排（照旧）：一个孩子都没有的，空位离它半个间距；另一边有孩子的，和那个孩子对称。再长会超过最多那几层（MAX_DEPTH）的不给。
 * 返回 [{ parent（结点的 key，空树是 null）, side, box（世界坐标）}]
 */
export function slotSpots(o) {
  if (o.root == null) return [{ parent: null, side: null, box: rootSpot(o) }];
  const pos = posOf(o), d = depths(o), out = [];
  for (const n of levelOrder(o)) {
    const p = pos.get(n.key);
    if (!p || (d.get(n.key) || 0) + 1 >= MAX_DEPTH) continue;
    for (const side of ['left', 'right']) {
      if (n[side] != null) continue;
      const sib = n[side === 'left' ? 'right' : 'left'];
      const dx = o.layout === 'compact' && sib != null && pos.get(sib) ? p.x - pos.get(sib).x : side === 'left' ? -COL / 2 : COL / 2;
      out.push({ parent: n.key, side, box: { x: o.origin.x + p.x + dx - NODE / 2, y: o.origin.y + p.y + LEVEL - NODE / 2, w: NODE, h: NODE } });
    }
  }
  return out;
}

/** 结构（旋转前后、动画的中间一步用）：{ root, nodes: [{ key, left, right }] } */
export const snapshot = (o) => ({ root: o.root, nodes: o.nodes.map((n) => ({ key: n.key, left: n.left, right: n.right })) });
/** 树里的边（父 → 子）：[[父 key, 子 key]] */
export const edgesOf = (struct) => struct.nodes.flatMap((n) => [n.left, n.right].filter((k) => k != null).map((k) => [n.key, k]));

/** 两个结点之间沿着树枝走的路（含两头）：先往上走到最近的公共祖先，再往下 */
export function treePath(o, a, b) {
  const up = (k) => { const out = []; for (let x = k; x != null; x = parentOf(o, x)?.key ?? null) out.push(x); return out; };
  const A = up(a), B = up(b);
  const inB = new Set(B);
  const meet = A.find((k) => inB.has(k));
  return [...A.slice(0, A.indexOf(meet) + 1), ...B.slice(0, B.indexOf(meet)).reverse()];
}

/** 遍历：顺序（结点 key）、一个圈沿树枝走的路（先序 / 中序 / 后序是同一趟，只是第几次经过时记下），记下时圈在路上的第几步 */
export function traversal(o, start, kind) {
  const order = [], at = [];
  if (start == null) return { order, tour: kind === 'level' ? null : [], at };
  if (kind === 'level') { for (const n of levelOrder(o, start)) order.push(n.key); return { order, tour: null, at: null }; }
  const tour = [];
  const mark = (k) => { order.push(k); at.push(tour.length - 1); };
  const go = (k) => {
    const n = nodeAt(o, k);
    tour.push(k);
    if (kind === 'pre') mark(k);
    if (n.left != null) { go(n.left); tour.push(k); }
    if (kind === 'in') mark(k);
    if (n.right != null) { go(n.right); tour.push(k); }
    if (kind === 'post') mark(k);
  };
  go(start);
  return { order, tour, at };
}

/** 还是二叉排序树：中序递增（一样大的算递增：49′ 和 49 比起来一样大）。挑战的 t bst 和舞台现状里「bst 是」是同一个 */
export function isBst(o) {
  const vs = traversal(o, o.root, 'in').order.map((k) => nodeAt(o, k).value);
  return vs.every((v, i) => !i || cmpValues(vs[i - 1], v) <= 0);
}

/** 最小不平衡子树的根（最深的 |平衡因子| ≥ 2 的结点）和王道的四种型 */
export function imbalance(o) {
  const d = depths(o);
  let best = null;
  for (const n of o.nodes) {
    const b = bfOf(o, n.key);
    if (Math.abs(b) < 2) continue;
    if (!best || d.get(n.key) > d.get(best.key)) best = { key: n.key, bf: b };
  }
  if (!best) return null;
  const n = nodeAt(o, best.key);
  const kind = best.bf > 0 ? (bfOf(o, n.left) >= 0 ? 'LL' : 'LR') : (bfOf(o, n.right) <= 0 ? 'RR' : 'RL');
  return { ...best, kind };
}

// 值有重复的结点在话里、记录里写 t#3（不然 t.40 指不清）；值里带 * # 的也是
function refreshDup(o) {
  const count = new Map();
  for (const n of o.nodes) count.set(n.value, (count.get(n.value) || 0) + 1);
  for (const n of o.nodes) n.dup = count.get(n.value) > 1 || /[*#]/.test(n.value);
}
const newNode = (obj, key, value) => ({ obj, key, value: String(value), left: null, right: null, order: null, tag: null, dup: false, paint: null, glow: false, lift: false, dim: false, covered: false });
const shown = (n) => (n.dup ? `${n.value}（#${n.key}）` : n.value);
const subtree = (o, k) => levelOrder(o, k);

// 一行里指着的那棵树（第一个部件所在的那一样东西；scene.ownerOf 已经按它把指令交过来了）
function treeIn(scene, h, cmd) {
  const w = h.refsIn()[0];
  if (!w) {
    // 写了名字、舞台上却没有：照场景的话说（「舞台上没有 t（有的是……）」）
    const first = h.words.find((x) => parseRef(x));
    if (first) h.scene.parts(first);
    throw new Error(`${cmd} 要写对哪棵树做`);
  }
  const o = scene.objects.get(parseRef(w).obj);
  for (const r of h.refsIn()) if (parseRef(r).obj !== o.id) throw new Error(`${cmd} 一行只能对一棵树做`);
  return { o, word: w, whole: !parseRef(w).mark };
}
const nonRefs = (scene, h) => h.words.filter((w) => !scene.isRef(w));
const valueIn = (scene, h, cmd, example, sides = false) => {
  const vals = nonRefs(scene, h).filter((w) => !sides || !SIDES[w]);
  if (vals.length > 1) throw new Error(`${cmd} 一次一个值（好几个就写好几行）`);
  const v = vals[0] ?? h.str;
  if (v == null || v === '') throw new Error(`要写成 ${example}`);
  if (isNull(v)) throw new Error('值不能是 _');
  return String(v);
};
// 托盘（tray="47 10"）：待插的数，按顺序；插进去一个就拿掉一个（tree.rules.js 的下一步从这里取）
function readTray(text, nodes) {
  const vals = String(text).split(/[\s,，、]+/).filter(Boolean);
  if (!vals.length) throw new Error('tray= 写待插的数，空格隔开：tray="47 10"');
  for (const [i, v] of vals.entries()) {
    if (isNull(v)) throw new Error('托盘里不能有 _（写待插的数）');
    if (nodes.some((n) => cmpValues(n.value, v) === 0)) throw new Error(`托盘里的 ${v} 已经在树里了（二叉排序树里不放一样的值）`);
    if (vals.findIndex((w) => cmpValues(w, v) === 0) !== i) throw new Error(`托盘里 ${v} 写了两次`);
  }
  if (nodes.length + vals.length > MAX_NODES) throw new Error(`一棵树最多 ${MAX_NODES} 个结点：树上 ${nodes.length} 个，托盘里 ${vals.length} 个，插完放不下`);
  return vals;
}
const checkDepth = (o, depth) => { if (depth >= MAX_DEPTH) throw new Error(`树最多 ${MAX_DEPTH} 层，再长就放不下了`); };
const checkSize = (o) => { if (o.nodes.length >= MAX_NODES) throw new Error(`一棵树最多 ${MAX_NODES} 个结点`); };

// 二叉排序树从根比下去：走过的结点、每一步比出来的大小、最后停在谁下面哪一边（找到了就是那个结点）
export function descend(o, value) {
  const path = [], cmps = [];
  let cur = o.root, parent = null, side = null;
  while (cur != null) {
    const n = nodeAt(o, cur);
    const s = cmpValues(value, n.value);
    path.push(cur);
    cmps.push(s);
    if (s === 0) return { path, cmps, found: cur, parent, side };
    parent = cur;
    side = s < 0 ? 'left' : 'right';
    cur = s < 0 ? n.left : n.right;
  }
  return { path, cmps, found: null, parent, side };
}

function grow(scene, o, parent, side, value, extra) {
  const key = o.next++;
  o.nodes.push(newNode(o.id, key, value));
  if (parent == null) o.root = key; else nodeAt(o, parent)[side] = key;
  refreshDup(o);
  // 托盘里有这个数：插进来了就从托盘拿掉（插的是托盘以外的数，托盘不动）
  const t = o.tray?.indexOf(String(value)) ?? -1;
  if (t >= 0) o.tray.splice(t, 1);
  return { id: o.id, key, value: String(value), parent, side, ...extra };
}

// 删掉结点以后：连着它的连线收掉；贴着它、再也找不到的字也拿掉（不然字飘在半空）
function tidy(scene, o, gone) {
  for (const [k, l] of scene.links) if ([l.a, l.b].some((x) => x.obj === o.id && gone.includes(x.key))) scene.links.delete(k);
  for (const [k, l] of scene.labels) {
    if (!l.refs.length || l.dial) continue;
    const ok = l.refs.some((r) => { if (scene.labels.has(r)) return true; try { return scene.parts(r).length > 0; } catch { return false; } });
    if (!ok) scene.labels.delete(k);
  }
  if (gone.includes(o.last)) o.last = null;
}

// 旋转（只动结构 { root, nodes }）：右旋 a——a 的左孩子 b 上来，b 的右子树挂到 a 的左边
export function rotStruct(s, aKey, dir) {
  const by = new Map(s.nodes.map((n) => [n.key, n]));
  const a = by.get(aKey);
  const bKey = dir === 'right' ? a.left : a.right;
  const b = by.get(bKey);
  if (dir === 'right') { a.left = b.right; b.right = aKey; } else { a.right = b.left; b.left = aKey; }
  const p = s.nodes.find((n) => n !== b && (n.left === aKey || n.right === aKey));
  if (!p) s.root = bKey; else if (p.left === aKey) p.left = bKey; else p.right = bKey;
  return bKey;
}
/** rotate 后面写的那个词 → right / left / LL / RR / LR / RL（tree.rules.js 的 actOf 照它读老师、学生写的行） */
export const rotKind = (raw) => {
  if (!raw) return null;
  const w = String(raw);
  if (/^(ll|rr|lr|rl)$/i.test(w)) return w.toUpperCase();
  return { right: 'right', left: 'left', 右: 'right', 左: 'left', 右旋: 'right', 左旋: 'left' }[w.toLowerCase()] || null;
};
const ROT = {
  right: [['right', '']], left: [['left', '']],
  LL: [['right', '']], RR: [['left', '']], LR: [['left', 'left'], ['right', '']], RL: [['right', 'right'], ['left', '']],
};

export const tree = {
  type: 'tree',
  label: '树',
  create: ['tree'],
  remake: true, // 造它的那一行里能写 {式子}（value.js）：依赖一变，场景照新的数把这一行重新造一遍
  // 跟着算的树上做了这几样（插、删、换值、改值、转）就不再跟着算（scene.js 的 unlive）：照那一行重新造会把它们冲掉
  reshape: ['insert', 'append', 'delete', 'swap', 'write', 'rotate'],
  /** 重新造（scene.js 的 remake）：角上的小字、访问号、样子按结点（层序编号 key）带过去；结构没变过（变了就不再跟着算） */
  carry(old, o) {
    for (const n of o.nodes) {
      const m = nodeAt(old, n.key);
      if (!m) continue;
      for (const f of FLAGS) n[f] = m[f];
      n.tag = m.tag;
      n.order = m.order;
    }
    o.visits = old.visits;
    o.last = nodeAt(o, old.last) ? old.last : null;
    o.bf = old.bf;
    if (old.heights) o.heights = true;
  },
  drag: true,
  hint: '（树：名字.40 是值为 40 的结点；名字#3 是层序第 3 个结点，跟着结点走（值重复、换值以后用它）；名字.40* 是 40 和它下面整棵子树）',
  make(scene, c, h, old) {
    if (!h.args.some((a) => a.t === 'eq')) throw new Error('要写成 tree 名字 = 按层序的值（_ 是空），比如 tree t = 50 30 70 20 40 _ 80');
    const id = h.words[0];
    const vals = h.words.slice(1);
    if (!vals.length) throw new Error('tree 后面要有值（按层序写，_ 是空；空树写 tree t = _）');
    const built = buildLevel(vals);
    if (built.length > MAX_NODES) throw new Error(`一棵树最多 ${MAX_NODES} 个结点（写了 ${built.length} 个）`);
    const nodes = built.map((b, i) => ({ ...newNode(id, i + 1, b.value), left: b.left != null ? b.left + 1 : null, right: b.right != null ? b.right + 1 : null }));
    const o = { origin: { x: 0, y: 0 }, root: nodes.length ? 1 : null, next: nodes.length + 1, nodes, bf: false, visits: 0, last: null };
    if (Math.max(0, ...depths(o).values()) >= MAX_DEPTH) throw new Error(`树最多 ${MAX_DEPTH} 层`);
    if (h.opts.tray != null) o.tray = readTray(h.opts.tray, nodes);
    refreshDup(o);
    // 排法造的时候定下，以后不换（换值、插、删、跟着算的重新造都不重排）：写了 layout= 照写的；同名重造不写照旧（和 hide= 一样）；
    // 新造的照这一刻是不是二叉排序树（中序有意思才一个结点一列）
    if (h.opts.layout != null) {
      if (!LAYOUTS.includes(h.opts.layout)) throw new Error(`layout= 只能写 inorder（照中序一个结点一列）或 compact（紧凑、左右对称），没有「${h.opts.layout}」`);
      o.layout = h.opts.layout;
    } else o.layout = old?.type === 'tree' && old.layout ? old.layout : isBst(o) ? 'inorder' : 'compact';
    if (old?.type === 'tree' && old.layout === o.layout) o.origin = { ...old.origin };
    else if (old?.type === 'tree') {
      // 同名重造换了排法：两种 origin 的意思不一样（第一列 / 根），照原来那一棵的左边对齐，还在原处
      const was = treeArea(old);
      o.origin = { x: 0, y: old.origin.y };
      o.origin.x = was.x - treeArea(o).x;
    } else {
      // 摆在已有的东西下面、居中；按中序排的 origin 是第一列、紧凑排的是根，都在根那一层（定下了就不动：长宽了镜头往后退）
      const xs = [0, ...[...posOf(o).values()].map((p) => p.x)];
      const lo = Math.min(...xs), hi = Math.max(...xs);
      const s = scene.slotFor(hi - lo + NODE + 2 * TAG_ROOM);
      o.origin = { x: s.x + TAG_ROOM + NODE / 2 - lo, y: s.y + TAG_TOP + NODE / 2 };
    }
    return o;
  },
  parts(o) { return levelOrder(o); },
  /** 扣着的结点画成小块不写值（scene.js 的 coverText）：树的结点没有不带值的位置写法（t.40 名字里就是值） */
  coverName: (p, o) => `${o.id} 里扣着的一个结点`,
  pick(o, mark, sel, word) {
    const how = `树的结点写 ${o.id}.40（值是 40 的那个）、${o.id}#3（层序第 3 个）或 ${o.id}.40*（40 和它整棵子树）`;
    const sub = sel.endsWith('*');
    const s = sub ? sel.slice(0, -1) : sel;
    if (mark === '#') {
      if (!/^\d+$/.test(s)) throw new Error(`「${word}」：${how}`);
      const n = nodeAt(o, Number(s));
      if (!n) throw new Error(`${o.id} 没有 #${s} 这个结点（现在有 ${o.nodes.map((x) => `#${x.key}`).join(' ') || '空的'}）`);
      return sub ? subtree(o, n.key) : [n];
    }
    if (!s) throw new Error(`「${word}」：${how}`);
    const hits = o.nodes.filter((n) => n.value === s);
    if (!hits.length) {
      const near = o.nodes.filter((n) => prime(n.value) === prime(s));
      if (near.length === 1) return sub ? subtree(o, near[0].key) : near;
      throw new Error(`${o.id} 里没有值是 ${s} 的结点（有：${levelOrder(o).map((n) => n.value).join(' ') || '空的'}）${/^\d+$/.test(s) && Number(s) <= o.nodes.length ? `；要层序第 ${s} 个写 ${o.id}#${s}` : ''}`);
    }
    if (hits.length > 1) throw new Error(`${o.id} 里有 ${hits.length} 个 ${s}（${hits.map((n) => `#${n.key}`).join('、')}），写 ${o.id}#${hits[0].key} 指定是哪一个`);
    return sub ? subtree(o, hits[0].key) : hits;
  },
  ref(p) { return p.dup ? `${p.obj}#${p.key}` : `${p.obj}.${p.value}`; },
  partBox: nodeBox,
  // 托盘也是树的地方：镜头框进来，别的东西、贴的字让开
  objectBox(o) {
    const tray = trayArea(o);
    return tray ? bbox([nodesArea(o), tray]) : nodesArea(o);
  },
  // 贴字让开：结点（连角标）、每条边上隔一小段取一点、托盘。照中序排，靠近根的树枝常常横跨好几列（两三百像素长），
  // 只取三点时字会落在两点中间、压着树枝：按长短取，点和点隔不到 36 像素
  obstacles(o) {
    const B = boxesFor(o);
    const out = [...B.values()].map(roomy);
    if (!out.length) out.push(roomy(rootSpot(o)));
    const tray = trayArea(o);
    if (tray) out.push(tray);
    for (const [a, b] of edgesOf(o)) {
      const A = B.get(a), C = B.get(b);
      if (!A || !C) continue;
      const len = Math.hypot(C.x - A.x, C.y - A.y);
      const n = Math.max(3, Math.ceil((len - NODE) / 36));
      for (let i = 1; i <= n; i++) {
        const t = (NODE / 2 + (len - NODE) * i / (n + 1)) / (len || 1);
        out.push({ x: A.x + (C.x - A.x) * t + NODE / 2 - 7, y: A.y + (C.y - A.y) * t + NODE / 2 - 7, w: 14, h: 14 });
      }
    }
    return out;
  },
  commands: {
    // insert t 35：二叉排序树的插入（从根比下去，在空位长出来）；insert t.70 left 65：直接长在 70 的左边
    insert(scene, c, h) {
      h.strayRefs();
      const { o, word, whole } = treeIn(scene, h, 'insert');
      const value = valueIn(scene, h, 'insert', whole ? 'insert t 35' : 'insert t.70 left 65', true);
      checkSize(o);
      const sideWord = nonRefs(scene, h).find((w) => SIDES[w]);
      if (!whole) {
        const ps = scene.parts(word);
        if (ps.length !== 1) throw new Error('insert 要指着一个结点：insert t.70 left 65');
        const p = ps[0];
        if (!sideWord) throw new Error(`要写长在哪边：insert ${word} left ${value}（left 左边、right 右边）`);
        const side = SIDES[sideWord];
        if (p[side] != null) throw new Error(`${shown(p)} 的${side === 'left' ? '左' : '右'}边已经有 ${nodeAt(o, p[side]).value} 了`);
        checkDepth(o, depths(o).get(p.key) + 1);
        return grow(scene, o, p.key, side, value, { mode: 'at', path: [], cmps: [] });
      }
      if (sideWord) throw new Error(`insert ${o.id} ${value} 是按二叉排序树的规矩找位置；要指定位置写 insert ${o.id}.某个结点 ${sideWord} ${value}`);
      const d = descend(o, value);
      if (d.found != null) throw new Error(`${value} 已经在树里了（二叉排序树里不放一样的值）`);
      checkDepth(o, d.path.length);
      return grow(scene, o, d.parent, d.side, value, { mode: 'bst', path: d.path, cmps: d.cmps });
    },
    // append t 15：接在层序最后（完全二叉树的下一个空位：堆的插入）
    append(scene, c, h) {
      h.strayRefs();
      const { o, whole } = treeIn(scene, h, 'append');
      if (!whole) throw new Error('append 写整棵树：append t 15（接在层序的最后）');
      const value = valueIn(scene, h, 'append', 'append t 15');
      checkSize(o);
      const at = levelOrder(o).find((n) => n.left == null || n.right == null);
      if (at) checkDepth(o, depths(o).get(at.key) + 1);
      return grow(scene, o, at ? at.key : null, at ? (at.left == null ? 'left' : 'right') : null, value, { mode: 'append', path: [], cmps: [] });
    },
    // delete t.30：二叉排序树的删法——叶子直接拿掉；一个孩子就让孩子顶上；两个孩子用中序后继（by=pred 用前驱）的值顶上，再删掉那个
    delete(scene, c, h) {
      h.strayRefs();
      const { o } = treeIn(scene, h, 'delete');
      const ps = h.partsIn();
      if (ps.length !== 1) throw new Error(`delete 一次删一个结点（写了 ${ps.length} 个）：delete t.30`);
      const x = ps[0];
      const by = h.opts.by || 'succ';
      if (!['succ', 'pred'].includes(by)) throw new Error('by 写 succ（中序后继，默认）或 pred（中序前驱）');
      const before = x.value;
      const drop = (k) => { o.nodes = o.nodes.filter((n) => n.key !== k); };
      let fx;
      if (x.left == null || x.right == null) {
        const child = x.left ?? x.right;
        const p = parentOf(o, x.key);
        if (!p) o.root = child; else p[p.left === x.key ? 'left' : 'right'] = child;
        drop(x.key);
        fx = { id: o.id, case: child == null ? 'leaf' : 'one', key: x.key, before, child, removed: x.key };
      } else {
        const path = [];
        let k = by === 'succ' ? x.right : x.left;
        for (;;) { path.push(k); const n = nodeAt(o, k); const nx = by === 'succ' ? n.left : n.right; if (nx == null) break; k = nx; }
        const s = nodeAt(o, k);
        const child = by === 'succ' ? s.right : s.left;
        const p = parentOf(o, s.key);
        p[p.left === s.key ? 'left' : 'right'] = child;
        x.value = s.value;
        drop(s.key);
        fx = { id: o.id, case: 'two', key: x.key, before, value: s.value, succ: s.key, path, child, by, removed: s.key };
      }
      refreshDup(o);
      tidy(scene, o, [fx.removed]);
      return fx;
    },
    // search t 40：二叉排序树查找（从根比下去，找到了亮一下，找不到落在空位）
    search(scene, c, h) {
      h.strayRefs();
      const { o, whole } = treeIn(scene, h, 'search');
      if (!whole) throw new Error('search 写整棵树：search t 40');
      const value = valueIn(scene, h, 'search', 'search t 40');
      if (o.root == null) throw new Error(`${o.id} 是空树`);
      return { id: o.id, value, ...descend(o, value) };
    },
    // swap t.40 t.80：两个结点换值（堆的上滤、下滤）；结点不动，值沿着弧换过去
    swap(scene, c, h) {
      h.strayRefs();
      const { o } = treeIn(scene, h, 'swap');
      const ps = h.partsIn();
      if (ps.length !== 2) throw new Error(`swap 要正好两个结点（写了 ${ps.length} 个）`);
      const [a, b] = ps;
      if (a === b) throw new Error('swap 的两个是同一个结点');
      [a.value, b.value] = [b.value, a.value];
      refreshDup(o);
      return { id: o.id, a, b };
    },
    // write t.40 45：改一个结点的值
    write(scene, c, h) {
      h.strayRefs();
      const { o } = treeIn(scene, h, 'write');
      const ps = h.partsIn();
      if (ps.length !== 1) throw new Error('write 一次改一个结点：write t.40 45');
      const value = valueIn(scene, h, 'write', 'write t.40 45');
      const before = ps[0].value;
      ps[0].value = value;
      refreshDup(o);
      return { id: o.id, part: ps[0], before };
    },
    // rotate t.50 right / left；王道的四种：LL（右旋）RR（左旋）LR（先左旋它的左孩子、再右旋它）RL
    rotate(scene, c, h) {
      h.strayRefs();
      const { o } = treeIn(scene, h, 'rotate');
      const ps = h.partsIn();
      if (ps.length !== 1) throw new Error('rotate 要指着一个结点：rotate t.50 right');
      const kind = rotKind(nonRefs(scene, h)[0]);
      if (!kind) throw new Error('rotate 后面写 right（右旋）或 left（左旋），也可以写王道的 LL / RR / LR / RL');
      const a = ps[0];
      const s = snapshot(o);
      const steps = [];
      for (const [dir, at] of ROT[kind]) {
        const was = structuredClone(s);
        const by = new Map(s.nodes.map((n) => [n.key, n]));
        const pivot = at ? by.get(a.key)[at] : a.key;
        const pn = pivot != null ? by.get(pivot) : null;
        const need = dir === 'right' ? 'left' : 'right';
        const zh = (side) => (side === 'left' ? '左' : '右');
        if (!pn) throw new Error(`${kind} 型要 ${shown(a)} 有${zh(at)}孩子`);
        if (pn[need] == null) {
          const who = at ? `${shown(a)} 的${zh(at)}孩子 ${shown(nodeAt(o, pn.key))}` : shown(a);
          throw new Error(`${ROT[kind].length > 1 ? `${kind} 型：` : ''}${who} 没有${zh(need)}孩子，${dir === 'right' ? '右旋' : '左旋'}转不了（${dir === 'right' ? '右旋是左孩子转上来' : '左旋是右孩子转上来'}）`);
        }
        const b = rotStruct(s, pivot, dir);
        // moved：换了父亲的那棵子树（画面描一道橙色）；横坐标不变，它也不挪——是新父亲转下来接住它
        steps.push({ dir, a: pivot, b, snap: structuredClone(s), moved: movedSubtree(was, s) });
      }
      const deep = Math.max(0, ...depths({ ...o, ...s, nodes: s.nodes }).values());
      checkDepth(o, deep);
      o.root = s.root;
      for (const n of s.nodes) { const x = nodeAt(o, n.key); x.left = n.left; x.right = n.right; }
      return { id: o.id, kind, steps };
    },
    // walk t.50 t.30 t.40：一个圈沿着树枝走过这几个（不相邻的经过中间的结点）
    walk(scene, c, h) {
      h.strayRefs();
      const { o } = treeIn(scene, h, 'walk');
      const ps = h.partsIn();
      if (!ps.length) throw new Error('walk 后面写要走过的结点：walk t.50 t.30 t.40');
      const stops = ps.map((p) => p.key);
      const path = [stops[0]];
      for (let i = 1; i < stops.length; i++) path.push(...treePath(o, stops[i - 1], stops[i]).slice(1));
      return { id: o.id, path, stops };
    },
    // visit t.50 t.30：按顺序编上访问号（和上一个访问的相邻，圈就沿树枝走过去）
    visit(scene, c, h) {
      h.strayRefs();
      const { o } = treeIn(scene, h, 'visit');
      const ps = h.partsIn();
      if (!ps.length) throw new Error('visit 后面写访问了哪几个：visit t.50 t.30');
      const seen = new Set();
      for (const p of ps) {
        if (p.order != null) throw new Error(`${shown(p)} 已经访问过了（第 ${p.order} 个）；重来先写 unvisit ${o.id}`);
        if (seen.has(p.key)) throw new Error(`${shown(p)} 写了两次`);
        seen.add(p.key);
      }
      const from = o.last;
      for (const p of ps) p.order = ++o.visits;
      o.last = ps.at(-1).key;
      return { id: o.id, keys: ps.map((p) => p.key), from };
    },
    unvisit(scene, c, h) {
      h.strayRefs();
      const { o, whole } = treeIn(scene, h, 'unvisit');
      const ps = whole ? o.nodes : h.partsIn();
      for (const p of ps) p.order = null;
      o.visits = Math.max(0, ...o.nodes.map((n) => n.order || 0));
      if (whole || ps.some((p) => p.key === o.last)) o.last = null;
      return { id: o.id };
    },
    // traverse t in：整趟遍历（pre 先序 / in 中序 / post 后序 / level 层序）；upto=3 只走到记下第 3 个；traverse t.30 in 只走这棵子树
    traverse(scene, c, h) {
      h.strayRefs();
      const { o, word, whole } = treeIn(scene, h, 'traverse');
      const raw = nonRefs(scene, h)[0];
      const kind = KINDS[raw] || KINDS[String(raw).toLowerCase()];
      if (!kind) throw new Error('traverse 后面写 pre（先序）/ in（中序）/ post（后序）/ level（层序）');
      let start = o.root;
      if (!whole) { const ps = scene.parts(word); if (ps.length !== 1) throw new Error('traverse 指着一个结点时只走它那棵子树：traverse t.30 in'); start = ps[0].key; }
      if (start == null) throw new Error(`${o.id} 是空树`);
      const t = traversal(o, start, kind);
      let k = t.order.length;
      if (h.opts.upto != null) {
        k = Number(h.opts.upto);
        if (!Number.isInteger(k) || k < 1 || k > t.order.length) throw new Error(`upto 写 1～${t.order.length}（记下几个就停）`);
      }
      for (const n of o.nodes) n.order = null;
      t.order.slice(0, k).forEach((key, i) => { nodeAt(o, key).order = i + 1; });
      o.visits = k;
      o.last = t.order[k - 1];
      return { id: o.id, kind, order: t.order.slice(0, k), tour: t.tour ? t.tour.slice(0, t.at[k - 1] + 1) : null, at: t.at ? t.at.slice(0, k) : null };
    },
    // tag t.50 "+2"：结点角上写个小字（高度、平衡因子、下标……）；tag t 0 每个都写
    tag(scene, c, h) {
      h.strayRefs();
      const { o, whole } = treeIn(scene, h, 'tag');
      const ps = whole ? o.nodes : h.partsIn();
      const text = h.str ?? nonRefs(scene, h).at(-1);
      if (text == null || text === '') throw new Error('要写成 tag t.50 "+2"（小字写在引号里，或者直接写一个数）');
      if ([...String(text)].length > 8) throw new Error('tag 的字要短（最多 8 个字；长的用 label）');
      for (const p of ps) p.tag = String(text);
      return { id: o.id, parts: ps };
    },
    untag(scene, c, h) {
      h.strayRefs();
      const { o, whole } = treeIn(scene, h, 'untag');
      for (const p of whole ? o.nodes : h.partsIn()) p.tag = null;
      return { id: o.id };
    },
    // bf t：每个结点角上标平衡因子（页面算，树变了跟着变）；unbf t 收起
    bf(scene, c, h) { const { o } = treeIn(scene, h, 'bf'); o.bf = true; return { id: o.id }; },
    unbf(scene, c, h) { const { o } = treeIn(scene, h, 'unbf'); o.bf = false; return { id: o.id }; },
    // heights t：每个结点角上标子树高（页面算，树变了跟着变；舞台现状里每一轮写出来）；unheights t 收起。挂不挂老师定
    heights(scene, c, h) { const { o } = treeIn(scene, h, 'heights'); o.heights = true; return { id: o.id }; },
    unheights(scene, c, h) { const { o } = treeIn(scene, h, 'unheights'); o.heights = false; return { id: o.id }; },
  },
  // 舞台现状里「页面算的」那一行后半句（rules.js 的 measureLine）：判断式 avl / bst 现在是不是，失衡的说出是谁、哪一型
  pageBits(o) {
    const bad = imbalance(o);
    return [`avl ${bad ? `否（最小不平衡子树的根是 ${shown(nodeAt(o, bad.key))}，${bad.kind} 型）` : '是'}`, `bst ${isBst(o) ? '是' : '否'}`];
  },
  // 一句话写现在的样子（存档点 back 以后告诉老师「回到了……的样子」，scene.js 的 summaryOf）
  summary(o) { return `层序 ${serialize(o)}`; },
  describe(o) {
    const ns = levelOrder(o);
    const lines = [`树 ${o.id}（${ns.length ? `${ns.length} 个结点，${heightOf(o, o.root)} 层` : '空树'}）：层序 ${serialize(o)}`];
    const kids = ns.filter((n) => n.left != null || n.right != null).map((n) => `${shown(n)}：${[n.left != null ? `左 ${shown(nodeAt(o, n.left))}` : '', n.right != null ? `右 ${shown(nodeAt(o, n.right))}` : ''].filter(Boolean).join('，')}`);
    if (kids.length) lines.push(`  ${kids.join('；')}`);
    // 样子：按种类归在一起（「蓝：30 20；亮：40」）
    const groups = new Map();
    const put = (k, n) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(shown(n)); };
    for (const n of ns) {
      if (n.paint) put(COLOR_NAMES[n.paint], n);
      if (n.glow) put('亮', n);
      if (n.lift) put('抬起', n);
      if (n.dim) put('灰', n);
      if (n.covered) put('扣着', n);
    }
    if (groups.size) lines.push(`  ${[...groups].map(([k, v]) => `${k}：${v.join(' ')}`).join('；')}`);
    const visited = ns.filter((n) => n.order != null).sort((a, b) => a.order - b.order);
    if (visited.length) lines.push(`  访问顺序：${visited.map(shown).join(' ')}`);
    const tags = ns.filter((n) => n.tag != null);
    if (tags.length) lines.push(`  角上的小字：${tags.map((n) => `${shown(n)}「${n.tag}」`).join(' ')}`);
    if (o.tray?.length) lines.push(`  托盘（待插）：${o.tray.join(' ')}`);
    if (o.bf && ns.length) {
      const bad = imbalance(o);
      lines.push(`  平衡因子：${ns.map((n) => `${shown(n)} ${bfText(bfOf(o, n.key))}`).join('，')}${bad ? `（失衡：最小不平衡子树的根是 ${shown(nodeAt(o, bad.key))}，${bad.kind} 型）` : '（都平衡）'}`);
    }
    if (o.heights && ns.length) lines.push(`  子树高：${ns.map((n) => `${shown(n)} ${heightOf(o, n.key)}`).join('，')}`);
    return lines;
  },
  doc: `树（二叉树遍历、二叉排序树、平衡二叉树、堆）：
tree t = 50 30 70 20 40 _ 80      按层序造（_ 是空，空的下面不用再写；最多 31 个结点）
写法：t.40 值是 40 的结点；t#3 层序第 3 个（跟着结点走：值重复、换过值以后用）；t.30* 30 和它整棵子树
insert t 35                       二叉排序树插入：从根一路比下去，在空位长出来
insert t.80 left 75               直接长在 80 的左边（right 右边）
append t 15                       接在层序最后（堆的插入）
delete t.30                       删掉（叶子直接拿掉；一个孩子就顶上来；两个孩子用中序后继顶上，by=pred 用前驱）
search t 40                       二叉排序树查找：从根比下去，找到亮一下，找不到落在空位
swap t.20 t.40                    两个结点换值（堆的调整）；write t.20 25 改值
rotate t.50 right                 右旋（left 左旋）；也能写 LL / RR / LR / RL（t.50 是最小不平衡子树的根）
walk t.50 t.30 t.40               一个圈沿着树枝走过这几个（查找路径）
visit t.50 t.30 / unvisit t       按顺序编访问号（遍历一步一步来）
traverse t in upto=3              整趟遍历：pre / in / post / level，upto 走到第几个停（不写走完）
tag t.50 "h=3" / untag t          结点左上角写个小字（最多 8 个字）
bf t / unbf t                     每个结点右上角标平衡因子（跟着树变；舞台现状里写出失衡的是谁、哪一型）
heights t / unheights t           每个结点右下角标子树高（跟着树变；和 tag、bf 一起开着不挡）
ask drag t "把它往上换"             学生把一个结点的值拖到另一个结点上，两个换值（页面照做，再告诉你）
tree t = 50 30 70 tray="20 40 80"   带托盘：待插的数按顺序摆在树下面，插进去一个拿掉一个
tree h = 90 80 70 layout=compact    排法造的时候定：二叉排序树照中序一个结点一列（插入只挪右边、旋转只上下移），别的（堆……）紧凑排；layout=inorder 或 compact 自己定；堆从一两个结点长起来（那时也算二叉排序树）写 layout=compact
扣着的结点（cover t.40）话里的小块分不出是哪一个：要学生指着它，用 ask pick 或者说位置
学生自己转、自己插（页面判每一下）：
open t rotate wrong=mark undo=on    学生把一个结点拖到它的父亲上 = 在父亲那里转（左孩子拖上去 = rotate t#1 right）
open t insert                       学生把托盘里的数拖进树 = insert t 47（页面从根比下去）
open t place                        学生把托盘里的数拖到一个空位 = insert t#2 right 47（摆在 #2 的右边：学生自己摆；和 insert 一次开一种）
open t pluck                        学生点一片叶子 = delete t#4（点里面的结点：只能摘叶子）
open t delete                       学生点哪个删哪个 = delete t.30（照上面 delete 的删法）
@t.done say "插完了，也平了。"         t 做完了马上演（做完 = 平衡了、托盘插完了；只开 insert / place 的是托盘插完了）
判断式（goal 的 when=）：t avl（平衡了）、t bst（还是二叉排序树）、t height=4（有几层）；量：count(t) 结点数、height(t) 层数（写 t.50 是以它为根的那棵子树）、tray(t) 托盘还剩几个`,
  example: `tree t = 50 30 70 20 40 _ 80
say "这是一棵二叉排序树：左边都比根小，右边都比根大。"
insert t 35
search t 65
bf t
insert t 33
rotate t.40 right
traverse t in upto=3
ask tap t "中序遍历的下一个是谁？点它。" expect=t.35`,
};
