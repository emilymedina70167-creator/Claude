// 树、森林的画法（纯函数，返回 SVG / HTML 字符串）：huffman、uf、forest、buildtree、thread 共用。
// 和 treeview.js 用同一套样式（.sv-tree / .sv-node / .sv-edge），这里多了几样那边没有的：
//   好几棵树并排（森林、并查集、哈夫曼合并到一半）；
//   结点位置事先按「最后的样子」定好（建树时结点一个个长出来，已经画上的不跳）；
//   圆下面的小字（哈夫曼叶子的字符）、边旁边的字（0 / 1）；
//   兄弟之间的虚线、被抹掉的边（森林 ↔ 二叉树的「加线、抹线」）；
//   线索（虚线箭头，前驱一种颜色、后继一种颜色）和空指针（∧ / NULL）。
// 每个结点带 data-pick（ask 在图上点）、data-cmd（课堂 highlight / board mark item=）、data-label（mark label=）、data-key（换步时滑过去）。
import { esc } from './arrayview.js';
import { layout as binLayout } from './treeview.js';

export { binLayout };

export const R = 18;

/**
 * 一般的树、森林（孩子几个都行）：{ roots: [id], nodes: { id: { kids: [id] } } } → { id: { x, d } }。
 * 叶子从左往右一个挨一个（间距 1），双亲放在第一个和最后一个孩子正中间：每棵子树占一段连续的横坐标，不会叠。
 * 两棵树之间多空 gap
 */
export function forestLayout(f, { gap = 0.6 } = {}) {
  const pos = {};
  let x = 0;
  const walk = (id, d) => {
    const kids = f.nodes[id].kids || [];
    if (!kids.length) { pos[id] = { x, d }; x += 1; return; }
    for (const c of kids) walk(c, d + 1);
    pos[id] = { x: (pos[kids[0]].x + pos[kids[kids.length - 1]].x) / 2, d };
  };
  f.roots.forEach((r, i) => { if (i) x += gap; walk(r, 0); });
  return pos;
}

/** 二叉树 { root, nodes: { id: { left, right } } } 的边 [[双亲, 孩子, 'l' | 'r']] */
export function binEdges(bt) {
  const out = [];
  for (const [id, n] of Object.entries(bt.nodes)) {
    if (n.left !== null && n.left !== undefined) out.push([id, n.left, 'l']);
    if (n.right !== null && n.right !== undefined) out.push([id, n.right, 'r']);
  }
  return out;
}

/** 一般森林的边 [[双亲, 孩子]] */
export function forestEdges(f) {
  const out = [];
  for (const [id, n] of Object.entries(f.nodes)) for (const c of n.kids || []) out.push([id, c]);
  return out;
}

const fmt = (v) => Math.round(v * 10) / 10;

/**
 * 画。g：{ nodes: { id: { key } }, edges: [[双亲, 孩子]], pos: { id: { x, d } } }。opts：
 *   show：只画这些结点（Set）。画布大小还是按全部结点算，长出来的时候别的不挪
 *   cls：{ id: 'sv-cur' }；edge：{ 孩子 id: class }；fresh：这一步刚变的（闪一下）
 *   pick(id) / cmd(id) / key(id) / text(id)（圆里的字，默认 key）/ sub(id)（圆下面的小字）/ sub2(id)（再下面一行，更小）/ note(id)（右上角的小字）
 *   edgeText：{ 孩子 id: '0' }（写在边旁边，左边的边写在左边）
 *   sibs：[[左, 右, class]]：兄弟之间的虚线（同一层，横着连）
 *   threads：[{ from, side: 'l' | 'r', to（id；null 是 NULL）, cls }]：线索，虚线箭头
 *   stubs：[{ id, side }]：还空着的指针，画一小截、末端写 ∧
 *   gapX / level：横向间距、层距；aria：读屏念的名字；prefix：data-key 的前缀（同一个画面里有两张图时分开，不然结点会飞到另一张图里）
 */
export function treesSvg(g, opts = {}) {
  const { cls = {}, edge = {}, fresh = [], edgeText = {}, sibs = [], threads = [], stubs = [], show = null, gapX = 46, level = 62, prefix = 'n', aria = '树' } = opts;
  const ids = Object.keys(g.pos);
  if (!ids.length) return '<div class="sv-tree-empty muted">（空）</div>';
  const vis = (id) => !show || show.has(id);
  const pickOf = opts.pick || ((id) => g.nodes[id].key);
  const cmdOf = opts.cmd || (() => '');
  const keyOf = opts.key || ((id) => id);
  const textOf = opts.text || ((id) => g.nodes[id].key);
  const subOf = opts.sub || (() => '');
  const noteOf = opts.note || (() => '');
  const sub2Of = opts.sub2 || (() => '');
  const hasSub = ids.some((id) => subOf(id));
  const hasSub2 = ids.some((id) => sub2Of(id));
  const pointers = threads.length || stubs.length || opts.pointers;
  // 线索、空指针会伸到结点外面：左右、下面多留一点
  const pad = pointers ? 34 : 0;
  const minX = Math.min(...ids.map((id) => g.pos[id].x));
  const maxX = Math.max(...ids.map((id) => g.pos[id].x));
  const maxD = Math.max(...ids.map((id) => g.pos[id].d));
  const cx = (id) => pad + (g.pos[id].x - minX + 1) * gapX;
  const cy = (id) => g.pos[id].d * level + R + 8;
  const W = 2 * pad + (maxX - minX + 2) * gapX;
  const H = maxD * level + 2 * R + 22 + (hasSub ? 16 : 0) + (hasSub2 ? 16 : 0) + (pointers ? 34 : 0);
  const freshSet = new Set(fresh.map(String));
  let back = '', lines = '', circles = '', front = '';
  for (const [p, c] of g.edges) {
    if (!vis(p) || !vis(c)) continue;
    lines += `<line class="sv-edge ${edge[c] || ''}" data-key="${esc(prefix)}e:${esc(keyOf(c))}" x1="${fmt(cx(p))}" y1="${fmt(cy(p))}" x2="${fmt(cx(c))}" y2="${fmt(cy(c))}"/>`;
    const t = edgeText[c];
    if (t !== undefined && t !== '') {
      const left = cx(c) < cx(p) - 0.5;
      const mx = (cx(p) + cx(c)) / 2 + (left ? -9 : 9), my = (cy(p) + cy(c)) / 2 - 3;
      front += `<text class="sv-edge-lbl" x="${fmt(mx)}" y="${fmt(my)}">${esc(t)}</text>`;
    }
  }
  for (const [a, b, c] of sibs) {
    if (!vis(a) || !vis(b)) continue;
    back += `<line class="sv-sibline ${c || ''}" x1="${fmt(cx(a) + R)}" y1="${fmt(cy(a))}" x2="${fmt(cx(b) - R)}" y2="${fmt(cy(b))}"/>`;
  }
  // 指针从结点的左下 / 右下伸出去（和二叉链表里 lchild、rchild 的位置一样）
  const out = (id, side) => { const s = side === 'l' ? -1 : 1; return { x: cx(id) + s * R * 0.72, y: cy(id) + R * 0.72, dx: s * 0.7071, dy: 0.7071 }; };
  for (const st of stubs) {
    if (!vis(st.id)) continue;
    const o = out(st.id, st.side);
    const ex = o.x + o.dx * 13, ey = o.y + o.dy * 13;
    front += `<g class="sv-stub"><line x1="${fmt(o.x)}" y1="${fmt(o.y)}" x2="${fmt(ex)}" y2="${fmt(ey)}"/><text x="${fmt(ex + o.dx * 7)}" y="${fmt(ey + 7)}">∧</text></g>`;
  }
  for (const th of threads) {
    if (!vis(th.from) || (th.to !== null && !vis(th.to))) continue;
    front += threadPath(th, out(th.from, th.side), th.to === null ? null : { x: cx(th.to), y: cy(th.to) });
  }
  // 每个结点底下垫一个不透明的圆：结点的底色是半透明的（当前、做完的），不垫的话边会从圆里透出来
  for (const id of ids) {
    if (!vis(id)) continue;
    const c = ['sv-node', cls[id] || '', freshSet.has(String(id)) ? 'sv-new' : ''].filter(Boolean).join(' ');
    const text = String(textOf(id));
    const small = [...text].length > 2 ? ' sv-small' : '';
    const sub = subOf(id), sub2 = sub2Of(id), note = noteOf(id), cmd = cmdOf(id), pick = pickOf(id);
    circles += `<g class="${c}"${pick !== '' && pick !== null ? ` data-pick="${esc(pick)}"` : ''}${cmd !== '' ? ` data-cmd="${esc(cmd)}"` : ''} data-label="${esc(sub || text)}" data-key="${esc(prefix)}:${esc(keyOf(id))}"><circle class="sv-node-bg" cx="${fmt(cx(id))}" cy="${fmt(cy(id))}" r="${R}"/><circle cx="${fmt(cx(id))}" cy="${fmt(cy(id))}" r="${R}"/><text class="${small}" x="${fmt(cx(id))}" y="${fmt(cy(id))}">${esc(text)}</text>${sub ? `<text class="sv-node-sub" x="${fmt(cx(id))}" y="${fmt(cy(id) + R + 13)}">${esc(sub)}</text>` : ''}${sub2 ? `<text class="sv-node-sub2" x="${fmt(cx(id))}" y="${fmt(cy(id) + R + (sub ? 29 : 13))}">${esc(sub2)}</text>` : ''}${note ? `<text class="sv-node-note" x="${fmt(cx(id) + R + 3)}" y="${fmt(cy(id) - R + 2)}">${esc(note)}</text>` : ''}</g>`;
  }
  return `<svg class="sv-tree sv-trees" viewBox="0 0 ${fmt(W)} ${fmt(H)}" width="${fmt(W)}" style="max-width:100%" role="img" aria-label="${esc(aria)}">${back}${lines}${circles}${front}</svg>`;
}

// 一条线索：从指针伸出的方向先弯出去，再拐到目标结点；箭头头自己画（不用 marker：同一页好几张图的 id 会撞，藏起来的那张还会让箭头消失）
function threadPath(th, o, t) {
  const kind = th.side === 'l' ? 'sv-th-pred' : 'sv-th-succ';
  const c = `sv-thread ${kind} ${th.cls || ''}`.trim();
  if (!t) {
    // 指向 NULL：短短一截箭头，末端写 NULL
    const ex = o.x + o.dx * 22, ey = o.y + o.dy * 22;
    const tx = ex + o.dx * 4, ty = ey + 12;
    return `<g class="${c}"><path d="M ${fmt(o.x)} ${fmt(o.y)} L ${fmt(ex)} ${fmt(ey)}"/>${head(ex, ey, o.dx, o.dy)}<text class="sv-th-null" x="${fmt(tx)}" y="${fmt(ty)}" text-anchor="${o.dx < 0 ? 'end' : 'start'}">NULL</text></g>`;
  }
  const dist = Math.hypot(t.x - o.x, t.y - o.y);
  // 前驱、后继弯得不一样深：一对互相指着的线索（D → E、E → D）才不会叠成一条
  const L = Math.max(34, Math.min(96, dist * (th.side === 'l' ? 0.8 : 0.45)));
  const qx = o.x + o.dx * L, qy = o.y + o.dy * L;
  const s = Math.sign(o.dx);
  if (s * (t.x - o.x) < -4) {
    // 目标在另一边（左指针指向右上方的双亲）：二次曲线会折回来穿过自己，改成三次曲线从这一边绕过去，从目标的这一侧进去
    let ax = s, ay = 0.35;
    const al = Math.hypot(ax, ay);
    ax /= al; ay /= al;
    const ex = t.x + ax * (R + 3), ey = t.y + ay * (R + 3);
    const c2x = ex + ax * 62, c2y = ey + ay * 62;
    return `<g class="${c}"><path d="M ${fmt(o.x)} ${fmt(o.y)} C ${fmt(qx)} ${fmt(qy)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(ex)} ${fmt(ey)}"/>${head(ex, ey, -ax, -ay)}</g>`;
  }
  // 终点在目标的圆周上，朝着控制点那一侧
  let ux = qx - t.x, uy = qy - t.y;
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const ex = t.x + ux * (R + 3), ey = t.y + uy * (R + 3);
  const dx = ex - qx, dy = ey - qy, dl = Math.hypot(dx, dy) || 1;
  return `<g class="${c}"><path d="M ${fmt(o.x)} ${fmt(o.y)} Q ${fmt(qx)} ${fmt(qy)} ${fmt(ex)} ${fmt(ey)}"/>${head(ex, ey, dx / dl, dy / dl)}</g>`;
}
function head(x, y, ux, uy) {
  const bx = x - ux * 9, by = y - uy * 9, nx = -uy * 4.5, ny = ux * 4.5;
  return `<polygon class="sv-th-head" points="${fmt(x)},${fmt(y)} ${fmt(bx + nx)},${fmt(by + ny)} ${fmt(bx - nx)},${fmt(by - ny)}"/>`;
}

/**
 * 一排格子（遍历序列、S 数组）：和 arrayView 同样的格子，但 data-pick 写的是格子里的名字（点序列里的 B 和点树上的 B 一样）。
 * items：[{ text, cls?, pick?, cmd?, sub? }]；label：左边写这一排是什么；idx：下面一行的小字（下标）
 */
export function seqRow(label, items, { idx = null, fresh = [] } = {}) {
  const n = items.length;
  const freshSet = new Set(fresh);
  let h = `<div class="sv-arr sv-has-label sv-seqrow${n > 12 ? ' sv-dense' : ''}" style="--cols:${n}"><div class="sv-row"><div class="sv-row-h">${esc(label)}</div>`;
  items.forEach((x, i) => {
    const c = ['sv-cell', x.cls || '', freshSet.has(i) ? 'sv-new' : ''].filter(Boolean).join(' ');
    h += `<div class="${c}"${x.pick !== undefined && x.pick !== '' ? ` data-pick="${esc(x.pick)}"` : ''}${x.cmd !== undefined && x.cmd !== '' ? ` data-cmd="${esc(x.cmd)}"` : ''} data-label="${esc(x.text)}">${esc(x.text)}</div>`;
  });
  h += '</div>';
  if (idx) h += `<div class="sv-row sv-idx"><div class="sv-row-h">${esc(idx.label || '')}</div>${idx.cells.map((t) => `<div>${esc(t)}</div>`).join('')}</div>`;
  return h + '</div>';
}

/** 一张小表（编码表、线索表）：head 是表头，rows 是 [[格…]]，格可以是 { html, cls } */
export function miniTable(head, rows, { cls = '' } = {}) {
  const cell = (c, tag) => (c && typeof c === 'object' ? `<${tag} class="${c.cls || ''}">${c.html}</${tag}>` : `<${tag}>${esc(c ?? '')}</${tag}>`);
  // sv-tab：不吃课件里 Markdown 表格的样式（手写体黄表头、display: block）
  return `<div class="sv-gtbl-wrap"><table class="sv-gtbl sv-tab ${cls}"><thead><tr>${head.map((h) => cell(h, 'th')).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => cell(c, 'td')).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** 两张图并排（放不下就上下排），每张上面一行小标题 */
export function panels(list) {
  return `<div class="sv-panels">${list.map(([title, html]) => `<div class="sv-panel">${title ? `<div class="sv-panel-h">${esc(title)}</div>` : ''}${html}</div>`).join('')}</div>`;
}

// —— 写法（几个组件共用）——

const NULLS = new Set(['#', '^', 'null', 'nil', '∅', '空', '-', '∧']);

/**
 * 森林的写法：A(B, C, D) E(F, G)：一个结点后面括号里是它的孩子（从左往右，几个都行），
 * 好几棵树并排写（空格或逗号隔开）。返回 { roots, nodes: { id: { key, kids } } }
 */
export function parseForest(src, what = 'forest') {
  const s = String(src ?? '').trim();
  if (!s) throw new Error(`${what}: 不能为空，写成 A(B, C, D) E(F, G) 这样（括号里是孩子，几棵树并排写）`);
  const nodes = {};
  let i = 0, seq = 0;
  const skip = () => { while (i < s.length && /[\s]/.test(s[i])) i++; };
  const name = () => {
    skip();
    const m = /^[^(),，\s]+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  const node = () => {
    const k = name();
    if (k === null) throw new Error(`${what}: 「${s.slice(Math.max(0, i - 6), i + 8)}」这里少了结点名`);
    if (NULLS.has(k.toLowerCase())) throw new Error(`${what}: 树和森林不用写空结点（「${k}」），孩子有几个写几个`);
    const id = `t${++seq}`;
    nodes[id] = { key: k, kids: [] };
    skip();
    if (s[i] === '(') {
      i++;
      for (;;) {
        skip();
        if (s[i] === ')') { i++; break; }
        nodes[id].kids.push(node());
        skip();
        if (s[i] === ',' || s[i] === '，') { i++; continue; }
        if (s[i] === ')') { i++; break; }
        if (i >= s.length) throw new Error(`${what}: 「${k}(」后面少了右括号`);
      }
    }
    return id;
  };
  const roots = [];
  for (;;) {
    skip();
    if (s[i] === ',' || s[i] === '，') { i++; continue; }
    if (i >= s.length) break;
    if (s[i] === ')' || s[i] === '(') throw new Error(`${what}: 看不懂「${s.slice(i, i + 12)}」：括号不配对`);
    roots.push(node());
  }
  const keys = Object.values(nodes).map((n) => n.key);
  if (keys.length > 24) throw new Error(`${what}: 结点太多了（${keys.length} 个），最多 24 个，一屏才放得下`);
  const dup = keys.find((k, j) => keys.indexOf(k) !== j);
  if (dup) throw new Error(`${what}: 结点「${dup}」写了两次：每个结点要有不同的名字`);
  return { roots, nodes };
}

/** 序列：A B C D（空格、逗号隔开），或者全是单个字的连着写 ABCD */
export function parseSeq(src, what) {
  const s = String(src ?? '').trim();
  if (!s) throw new Error(`${what}: 不能为空`);
  let toks = s.split(/[\s,，、]+/).filter(Boolean);
  if (toks.length === 1 && [...toks[0]].length > 1 && /^[A-Za-z0-9]+$/.test(toks[0])) toks = [...toks[0]];
  const dup = toks.find((k, j) => toks.indexOf(k) !== j);
  if (dup) throw new Error(`${what}: 「${dup}」出现了两次：每个结点名字要不同`);
  return toks;
}

/** 二叉树的先序、中序、后序、层序（结点名） */
export function binOrder(bt, walk) {
  const out = [];
  const K = (id) => bt.nodes[id].key;
  if (walk === 'level') {
    const q = bt.root === null || bt.root === undefined ? [] : [bt.root];
    while (q.length) { const id = q.shift(); out.push(id); const n = bt.nodes[id]; if (n.left) q.push(n.left); if (n.right) q.push(n.right); }
    return out.map(K);
  }
  const w = (id) => {
    if (id === null || id === undefined) return;
    const n = bt.nodes[id];
    if (walk === 'pre') out.push(id);
    w(n.left);
    if (walk === 'in') out.push(id);
    w(n.right);
    if (walk === 'post') out.push(id);
  };
  w(bt.root);
  return out.map(K);
}
export const WALK_NAME = { pre: '先序', in: '中序', post: '后序', level: '层序' };
const WALK_ALIAS = { pre: 'pre', preorder: 'pre', 先序: 'pre', 前序: 'pre', 先根: 'pre', in: 'in', inorder: 'in', 中序: 'in', post: 'post', postorder: 'post', 后序: 'post', 后根: 'post', level: 'level', levelorder: 'level', 层序: 'level', 层次: 'level' };
export function walkOf(src, dflt, what = 'quiz') {
  if (src === undefined || String(src).trim() === '') return dflt;
  const w = WALK_ALIAS[String(src).trim().toLowerCase()];
  if (!w) throw new Error(`${what}: 写 pre（先序）、in（中序）、post（后序）或 level（层序）（现在是「${src}」）`);
  return w;
}

export const BOOL = /^(true|yes|on|1|是)$/i;
