// 二叉树的画法（纯函数，返回 SVG 字符串）：横坐标按中序的名次排（不会重叠，二叉排序树正好从小到大），纵坐标按层。
// 树：{ root, nodes: { id: { key, left, right } } }（left / right 是孩子的 id，没有是 null）。
// 每个结点带 data-pick（ask 里在图上点）、data-cmd（课堂 highlight / board mark item=）、data-label（board mark label=）。
import { esc } from './arrayview.js';

const GAP = 46; // 相邻两个结点的横向间距
const LEVEL = 62; // 层距
const R = 18;

/** 中序名次和层数：{ id: { x（第几个，从 0 数）, d（第几层，从 0 数）} } */
export function layout(tree) {
  const pos = {};
  let x = 0;
  const walk = (id, d) => {
    if (id === null || id === undefined) return;
    const n = tree.nodes[id];
    walk(n.left, d + 1);
    pos[id] = { x: x++, d };
    walk(n.right, d + 1);
  };
  walk(tree.root, 0);
  return pos;
}

/** 层序（从根开始一层一层、每层从左往右）的 id */
export function levelOrder(tree) {
  const out = [];
  const q = tree.root === null || tree.root === undefined ? [] : [tree.root];
  while (q.length) {
    const id = q.shift();
    out.push(id);
    const n = tree.nodes[id];
    if (n.left !== null && n.left !== undefined) q.push(n.left);
    if (n.right !== null && n.right !== undefined) q.push(n.right);
  }
  return out;
}

/**
 * 画树。opts：
 *   cls：{ id: 'sv-cur' 这类 class }；edge：{ 孩子的 id: class }（连到这个孩子的那条边）
 *   pick(id) → data-pick 的值；cmd(id) → data-cmd 的值（默认层序第几个）；note：{ id: 结点旁边的小字 }
 *   ghost：{ parent, side: 'left' | 'right', key }：画一个虚线的「将要插进来」的结点
 *   fresh：这一步刚变的结点（闪一下）
 */
export function treeSvg(tree, opts = {}) {
  const { cls = {}, edge = {}, note = {}, fresh = [], ghost = null } = opts;
  if (tree.root === null || tree.root === undefined) return '<div class="sv-tree-empty muted">（空树）</div>';
  const pos = layout(tree);
  const order = levelOrder(tree);
  const cmdOf = opts.cmd || ((id) => order.indexOf(id) + 1);
  const pickOf = opts.pick || ((id) => tree.nodes[id].key);
  const ids = Object.keys(pos);
  const maxX = Math.max(...ids.map((id) => pos[id].x));
  const maxD = Math.max(...ids.map((id) => pos[id].d)) + (ghost ? 1 : 0);
  const cx = (id) => (pos[id].x + 1) * GAP;
  const cy = (id) => pos[id].d * LEVEL + R + 6;
  const W = (maxX + 2) * GAP;
  const H = maxD * LEVEL + 2 * R + 30;
  const freshSet = new Set(fresh.map(String));
  let lines = '', circles = '';
  for (const id of ids) {
    const n = tree.nodes[id];
    for (const c of [n.left, n.right]) {
      if (c === null || c === undefined) continue;
      lines += `<line class="sv-edge ${edge[c] || ''}" x1="${cx(id)}" y1="${cy(id)}" x2="${cx(c)}" y2="${cy(c)}"/>`;
    }
  }
  if (ghost) {
    const p = ghost.parent;
    const gx = cx(p) + (ghost.side === 'left' ? -GAP / 2 : GAP / 2);
    const gy = cy(p) + LEVEL;
    lines += `<line class="sv-edge sv-edge-ghost" x1="${cx(p)}" y1="${cy(p)}" x2="${gx}" y2="${gy}"/>`;
    circles += `<g class="sv-node sv-ghost"><circle cx="${gx}" cy="${gy}" r="${R}"/><text x="${gx}" y="${gy}">${esc(ghost.key)}</text></g>`;
  }
  for (const id of ids) {
    const n = tree.nodes[id];
    const c = ['sv-node', cls[id] || '', freshSet.has(String(id)) ? 'sv-new' : ''].filter(Boolean).join(' ');
    const key = String(n.key);
    const small = key.length > 2 ? ' sv-small' : '';
    circles += `<g class="${c}" data-pick="${esc(pickOf(id))}" data-cmd="${cmdOf(id)}" data-label="${esc(key)}"><circle cx="${cx(id)}" cy="${cy(id)}" r="${R}"/><text class="${small}" x="${cx(id)}" y="${cy(id)}">${esc(key)}</text>${note[id] ? `<text class="sv-node-note" x="${cx(id) + R + 4}" y="${cy(id) - R + 2}">${esc(note[id])}</text>` : ''}</g>`;
  }
  return `<svg class="sv-tree" viewBox="0 0 ${W} ${H}" width="${W}" style="max-width:100%" role="img" aria-label="二叉树">${lines}${circles}</svg>`;
}
