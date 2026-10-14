// 树的演示引擎（组件 tree）：三种用法，看写了哪个字段——
//   nodes: / level: + walk:   二叉树遍历（先序、中序、后序、层序）
//   bst:  + ops:              二叉排序树：依次插入建树、插入、查找、删除（王道：两棵子树都有时用直接后继替代）
//   heap: + ops:              堆：建堆、插入（上浮）、删除堆顶（下坠）、堆排序；树和数组两种样子一起看
// 纯函数，不碰 DOM（tests/tree-engine.test.js）。画法在 treeview.js。
import { treeSvg, levelOrder } from './treeview.js';
import { arrayView, chips } from './arrayview.js';

const WALKS = { preorder: '先序', inorder: '中序', postorder: '后序', levelorder: '层序' };
const WALK_ALIAS = { pre: 'preorder', preorder: 'preorder', 先序: 'preorder', 前序: 'preorder', in: 'inorder', inorder: 'inorder', 中序: 'inorder', post: 'postorder', postorder: 'postorder', 后序: 'postorder', level: 'levelorder', levelorder: 'levelorder', 层序: 'levelorder', 层次: 'levelorder' };
const NULLS = new Set(['#', '^', 'null', 'nil', '∅', '空', '-']);
const MAX_NODES = 31;

// —— 写法 ——

/** 括号写法：A(B(D, E), C(, F))。逗号前是左子树，空着表示没有；只有一个孩子时 A(B) 是左孩子，右孩子写 A(, B) */
export function parseTree(src) {
  const s = String(src ?? '').replace(/\s+/g, '');
  if (!s) throw new Error('nodes: 不能为空，写成 A(B(D, E), C(, F)) 这样');
  const nodes = {};
  let i = 0, seq = 0;
  const key = () => {
    const m = /^[^(),]+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  const node = () => {
    const k = key();
    if (k === null || NULLS.has(k.toLowerCase())) return null;
    const id = `n${++seq}`;
    nodes[id] = { key: k, left: null, right: null };
    if (s[i] === '(') {
      i++;
      nodes[id].left = s[i] === ',' || s[i] === ')' ? null : node();
      if (s[i] === ',') { i++; nodes[id].right = s[i] === ')' ? null : node(); }
      if (s[i] !== ')') throw new Error(`nodes: 「${k}(」后面少了右括号，或者一个结点写了两个以上的孩子（二叉树最多两个）`);
      i++;
    }
    return id;
  };
  const root = node();
  if (i !== s.length) throw new Error(`nodes: 看不懂「${s.slice(i, i + 12)}」。写法：A(B(D, E), C(, F))，一个结点后面的括号里是左、右子树`);
  return check({ root, nodes });
}

/** 层序写法：A B C # D（# 是空位置），按完全二叉树的编号放：第 i 个的孩子是第 2i、2i+1 个 */
export function parseLevel(src) {
  const toks = String(src ?? '').trim().split(/[\s,，、]+/).filter(Boolean);
  if (!toks.length) throw new Error('level: 不能为空，写成 A B C # D 这样（# 是空位置）');
  const nodes = {};
  toks.forEach((t, k) => {
    if (NULLS.has(t.toLowerCase())) return;
    const i = k + 1;
    if (i > 1 && !nodes[`n${Math.floor(i / 2)}`]) throw new Error(`level: 第 ${i} 个位置（${t}）的双亲（第 ${Math.floor(i / 2)} 个）是空的`);
    nodes[`n${i}`] = { key: t, left: null, right: null };
  });
  for (const id of Object.keys(nodes)) {
    const i = Number(id.slice(1));
    if (nodes[`n${2 * i}`]) nodes[id].left = `n${2 * i}`;
    if (nodes[`n${2 * i + 1}`]) nodes[id].right = `n${2 * i + 1}`;
  }
  return check({ root: nodes.n1 ? 'n1' : null, nodes });
}

function check(tree) {
  const keys = Object.values(tree.nodes).map((n) => n.key);
  if (!keys.length) throw new Error('树是空的');
  if (keys.length > MAX_NODES) throw new Error(`结点太多了（${keys.length} 个），最多 ${MAX_NODES} 个，一屏才放得下`);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) throw new Error(`结点「${dup}」写了两次：遍历的树每个结点要有不同的名字`);
  return tree;
}

// 关键字：数（按大小比）或字（按字典序比），不能混着
function parseKeys(src, what) {
  const toks = String(src ?? '').trim().replace(/^\[|\]$/g, '').split(/[\s,，、]+/).filter(Boolean);
  if (!toks.length) throw new Error(`${what}: 不能为空`);
  if (toks.length > MAX_NODES) throw new Error(`${what}: 最多 ${MAX_NODES} 个（现在 ${toks.length} 个）`);
  const nums = toks.every((t) => /^-?\d+(\.\d+)?$/.test(t));
  if (!nums && toks.some((t) => /^-?\d+(\.\d+)?$/.test(t))) throw new Error(`${what}: 数和字不能混着写`);
  return toks.map((t) => ({ text: t, v: nums ? Number(t) : t }));
}
const cmp = (a, b) => (typeof a.v === 'number' ? a.v - b.v : a.v < b.v ? -1 : a.v > b.v ? 1 : 0);

function parseOps(src, kind) {
  const list = String(src ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  const ok = kind === 'bst' ? ['insert', 'search', 'delete'] : ['build', 'insert', 'delete', 'sort'];
  const alias = { 插入: 'insert', 查找: 'search', 删除: 'delete', 建堆: 'build', 堆排序: 'sort', find: 'search', remove: 'delete', pop: 'delete' };
  return list.map((x) => {
    const [w, ...rest] = x.split(/\s+/);
    const op = alias[w] || w.toLowerCase();
    if (!ok.includes(op)) throw new Error(`ops: 不认识「${x}」，${kind === 'bst' ? '二叉排序树能写 insert 40、search 40、delete 40' : '堆能写 build、insert 86、delete（删除堆顶）、sort（堆排序）'}`);
    const needArg = op === 'insert' || op === 'search' || (kind === 'bst' && op === 'delete');
    if (needArg && rest.length !== 1) throw new Error(`ops: ${op} 后面要写一个关键字，比如 ${op} 40`);
    if (!needArg && rest.length) throw new Error(`ops: ${op} 后面不用写东西`);
    return { op, arg: rest[0] };
  });
}

export function parse(fields) {
  if (fields.heap !== undefined) {
    const items = parseKeys(fields.heap, 'heap');
    if (typeof items[0].v !== 'number') throw new Error('heap: 要写数');
    const type = String(fields.type || 'max').trim().toLowerCase();
    if (!['max', 'min', '大根', '小根', '大根堆', '小根堆'].includes(type)) throw new Error('type: 写 max（大根堆，默认）或 min（小根堆）');
    const ops = fields.ops ? parseOps(fields.ops, 'heap') : [{ op: 'build' }];
    for (const o of ops) if (o.arg !== undefined && !/^-?\d+(\.\d+)?$/.test(o.arg)) throw new Error(`ops: 堆里插入的要是数（现在是「${o.arg}」）`);
    return { kind: 'heap', items, max: !/^(min|小根)/.test(type), ops, pass: passOf(fields) };
  }
  if (fields.bst !== undefined) {
    const items = parseKeys(fields.bst, 'bst');
    const ops = fields.ops ? parseOps(fields.ops, 'bst') : [];
    const numeric = typeof items[0].v === 'number';
    for (const o of ops) if (numeric !== /^-?\d+(\.\d+)?$/.test(o.arg)) throw new Error(`ops: 「${o.op} ${o.arg}」和树里的关键字不是一类（要${numeric ? '数' : '字'}）`);
    const replace = /^(pred|前驱|直接前驱)$/i.test(String(fields.replace || '').trim()) ? 'pred' : 'succ';
    return { kind: 'bst', items, ops, replace, quizWalk: walkOf(fields.quiz, 'levelorder') };
  }
  if (fields.nodes === undefined && fields.level === undefined) throw new Error('tree 要写 nodes:（如 A(B(D, E), C(, F))）、level:（层序，# 是空），或者 bst:（二叉排序树）、heap:（堆）');
  const tree = fields.nodes !== undefined ? parseTree(fields.nodes) : parseLevel(fields.level);
  if (!fields.walk) throw new Error(`tree 要写 walk:（${Object.entries(WALKS).map(([k, v]) => `${k} ${v}`).join('、')}）`);
  return { kind: 'walk', tree, walk: walkOf(fields.walk) };
}
function walkOf(src, dflt) {
  if (src === undefined || src === '') { if (dflt) return dflt; throw new Error('walk: 不能为空'); }
  const w = WALK_ALIAS[String(src).trim().toLowerCase()];
  if (!w) throw new Error(`遍历方式不认识「${src}」，写 preorder（先序）、inorder（中序）、postorder（后序）或 levelorder（层序）`);
  return w;
}
function passOf(fields) {
  if (fields.pass === undefined || fields.pass === '') return 0;
  const p = Number(fields.pass);
  if (!Number.isInteger(p) || p < 1) throw new Error(`pass: 写第几趟（从 1 数）（现在是「${fields.pass}」）`);
  return p;
}

export function run(input) {
  if (input.kind === 'walk') return walkRun(input);
  if (input.kind === 'bst') return bstRun(input);
  return heapRun(input);
}

// —— 遍历 ——

const clone = (tree) => ({ root: tree.root, nodes: Object.fromEntries(Object.entries(tree.nodes).map(([k, v]) => [k, { ...v }])) });

function walkRun({ tree, walk }) {
  const steps = [];
  const name = WALKS[walk];
  const seq = [];
  const done = new Set();
  const K = (id) => tree.nodes[id].key;
  const view = (cur, stack, queue) => {
    const cls = {};
    for (const id of done) cls[id] = 'sv-done';
    for (const id of stack || []) if (!done.has(id)) cls[id] = 'sv-path';
    if (cur) cls[cur] = 'sv-cur';
    return { tree, cls, seq: seq.slice(), stack: stack ? stack.map(K) : null, queue: queue ? queue.map(K) : null, fresh: cur ? [cur] : [] };
  };
  const rule = { preorder: '根 → 左子树 → 右子树', inorder: '左子树 → 根 → 右子树', postorder: '左子树 → 右子树 → 根', levelorder: '一层一层，每层从左往右（用一个队列）' }[walk];
  steps.push({ view: view(null, walk === 'levelorder' ? null : []), msg: `${name}遍历：${rule}。` });
  const visit = (id, stack, msg, queue) => {
    done.add(id);
    seq.push(K(id));
    steps.push({ view: view(id, stack, queue), msg, ask: { tag: 'visit', kind: 'pick', q: `${seq.length === 1 ? '第一个' : '下一个'}访问的是哪个结点？在图里点出来。`, answer: K(id) } });
  };
  const side = (id, p) => (tree.nodes[p].left === id ? '左' : '右');
  if (walk === 'levelorder') {
    const q = [tree.root];
    while (q.length) {
      const id = q.shift();
      const n = tree.nodes[id];
      const kids = [n.left, n.right].filter((c) => c !== null);
      q.push(...kids);
      visit(id, null, `队头是 ${K(id)}：出队、访问它，再把它的孩子${kids.length ? ` ${kids.map(K).join('、')} 依次入队` : '（没有）'}。`, q.slice());
    }
  } else {
    const rec = (id, stack, parent) => {
      if (id === null) return;
      const n = tree.nodes[id];
      const st = [...stack, id];
      const where = parent ? `${K(parent)} 的${side(id, parent)}孩子 ${K(id)}` : `根 ${K(id)}`;
      if (walk === 'preorder') visit(id, st, `到了${where}：先访问它，再去它的左子树${n.left === null ? '（空）' : ''}、右子树${n.right === null ? '（空）' : ''}。`);
      rec(n.left, st, id);
      if (walk === 'inorder') visit(id, st, `${K(id)} 的左子树${n.left === null ? '是空的' : '访问完了'}：访问 ${K(id)}，再去它的右子树${n.right === null ? '（空）' : ''}。`);
      rec(n.right, st, id);
      if (walk === 'postorder') visit(id, st, `${K(id)} 的左、右子树都${n.left === null && n.right === null ? '是空的（叶结点）' : '访问完了'}：最后访问 ${K(id)}。`);
    };
    rec(tree.root, [], null);
  }
  steps.push({ view: view(null, walk === 'levelorder' ? null : []), msg: `${name}序列：${seq.join(' ')}。` });
  return { steps, passes: [seq] };
}

// —— 二叉排序树 ——

function bstRun({ items, ops, replace }) {
  const tree = { root: null, nodes: {} };
  let seq = 0;
  const steps = [];
  const K = (id) => tree.nodes[id].key;
  const snap = (extra = {}) => ({ tree: clone(tree), ...extra });
  const text = (it) => it.text;
  const val = (k) => ({ text: k, v: typeof items[0].v === 'number' ? Number(k) : k });
  const keyItem = (id) => tree.nodes[id].item;

  // 从根往下比，返回 { path, found, parent, side }；every：每比一次记一步
  const descend = (x, opName, ask) => {
    const path = [];
    let id = tree.root, parent = null, side = null;
    while (id !== null) {
      const c = cmp(x, keyItem(id));
      path.push(id);
      const edge = Object.fromEntries(path.slice(1).map((p) => [p, 'sv-edge-path']));
      const cls = Object.fromEntries(path.map((p) => [p, 'sv-path']));
      cls[id] = c === 0 ? 'sv-cur sv-found' : 'sv-cur';
      const dir = c < 0 ? '左' : '右';
      const step = {
        view: snap({ cls, edge, chips: [[opName, text(x)]] }),
        msg: c === 0 ? `${text(x)} = ${K(id)}：找到了。` : `${text(x)} ${c < 0 ? '<' : '>'} ${K(id)}：往${dir}子树走${(c < 0 ? tree.nodes[id].left : tree.nodes[id].right) === null ? `，${dir}子树是空的` : ''}。`,
      };
      if (ask && c !== 0) step.ask = { tag: 'compare', kind: 'choice', q: `${text(x)} 和 ${K(id)} 比，接下来往哪边走？`, choices: ['左子树', '右子树'], answer: c < 0 ? '左子树' : '右子树' };
      steps.push(step);
      if (c === 0) return { path, found: id, parent, side };
      parent = id;
      side = c < 0 ? 'left' : 'right';
      id = tree.nodes[id][side];
    }
    return { path, found: null, parent, side };
  };

  const insert = (x, { quiet = false } = {}) => {
    if (tree.root === null) {
      const id = `n${++seq}`;
      tree.nodes[id] = { key: text(x), item: x, left: null, right: null };
      tree.root = id;
      if (!quiet) steps.push({ view: snap({ fresh: [id], chips: [['插入', text(x)]] }), msg: `树是空的：${text(x)} 成为根。` });
      return;
    }
    if (quiet) {
      let id = tree.root;
      for (;;) {
        const c = cmp(x, keyItem(id));
        if (c === 0) return;
        const s = c < 0 ? 'left' : 'right';
        if (tree.nodes[id][s] === null) { const nid = `n${++seq}`; tree.nodes[nid] = { key: text(x), item: x, left: null, right: null }; tree.nodes[id][s] = nid; return; }
        id = tree.nodes[id][s];
      }
    }
    // 先算出会插在哪（给 ask 用）
    let p = tree.root;
    for (;;) { const c = cmp(x, keyItem(p)); if (c === 0) break; const nx = tree.nodes[p][c < 0 ? 'left' : 'right']; if (nx === null) break; p = nx; }
    steps.push({ view: snap({ chips: [['插入', text(x)]] }), msg: `插入 ${text(x)}：从根开始比，小往左、大往右，走到空的位置就放下。`, ask: cmp(x, keyItem(p)) === 0 ? undefined : { tag: 'insert', kind: 'pick', q: `${text(x)} 插进来以后，是谁的孩子？在图里点出它的双亲。`, answer: K(p) } });
    const r = descend(x, '插入', true);
    if (r.found !== null) {
      steps.push({ view: snap({ cls: { [r.found]: 'sv-found' }, chips: [['插入', text(x)]] }), msg: `树里已经有 ${text(x)}，二叉排序树不放相同的关键字，不插入。` });
      return;
    }
    const id = `n${++seq}`;
    tree.nodes[id] = { key: text(x), item: x, left: null, right: null };
    tree.nodes[r.parent][r.side] = id;
    steps.push({ view: snap({ fresh: [id], cls: { [id]: 'sv-done' }, chips: [['插入', text(x)]] }), msg: `${text(x)} 成为 ${K(r.parent)} 的${r.side === 'left' ? '左' : '右'}孩子。` });
  };

  const search = (x) => {
    steps.push({ view: snap({ chips: [['查找', text(x)]] }), msg: `查找 ${text(x)}：从根开始比，相等就找到，小往左、大往右，走到空就是查找失败。` });
    const r = descend(x, '查找', true);
    steps.push({ view: snap({ cls: Object.fromEntries(r.path.map((p) => [p, r.found === p ? 'sv-found' : 'sv-path'])), chips: [['查找', text(x)], ['比较次数', r.path.length]] }), msg: r.found !== null ? `查找成功，一共比较了 ${r.path.length} 次（路径：${r.path.map(K).join(' → ')}）。` : `走到空子树：查找失败，一共比较了 ${r.path.length} 次（路径：${r.path.map(K).join(' → ')}）。` });
  };

  const remove = (x) => {
    steps.push({ view: snap({ chips: [['删除', text(x)]] }), msg: `删除 ${text(x)}：先找到它。` });
    const r = descend(x, '删除', false);
    if (r.found === null) {
      steps.push({ view: snap({ chips: [['删除', text(x)]] }), msg: `树里没有 ${text(x)}，不用删。` });
      return;
    }
    const z = r.found;
    const n = tree.nodes[z];
    const relink = (parent, side, child) => { if (parent === null) tree.root = child; else tree.nodes[parent][side] = child; };
    if (n.left === null && n.right === null) {
      steps.push({ view: snap({ cls: { [z]: 'sv-swap' }, chips: [['删除', text(x)]] }), msg: `${K(z)} 是叶结点，直接删掉。`, ask: { tag: 'case', kind: 'choice', q: `删 ${K(z)} 属于哪种情况？`, choices: CASES, answer: CASES[0] } });
      relink(r.parent, r.side, null);
      delete tree.nodes[z];
      steps.push({ view: snap({ chips: [['删除', text(x)]] }), msg: `删好了。` });
      return;
    }
    if (n.left === null || n.right === null) {
      const child = n.left ?? n.right;
      const s = n.left !== null ? '左' : '右';
      steps.push({ view: snap({ cls: { [z]: 'sv-swap', [child]: 'sv-cur' }, chips: [['删除', text(x)]] }), msg: `${K(z)} 只有${s}子树：删掉 ${K(z)}，让它的${s}子树（以 ${K(child)} 为根）直接顶上来，接到 ${K(z)} 原来的位置。`, ask: { tag: 'case', kind: 'choice', q: `删 ${K(z)} 属于哪种情况？`, choices: CASES, answer: CASES[1] } });
      relink(r.parent, r.side, child);
      delete tree.nodes[z];
      steps.push({ view: snap({ fresh: [child], chips: [['删除', text(x)]] }), msg: `删好了：${K(child)} 接到了 ${r.parent === null ? '根的位置' : `${K(r.parent)} 的${r.side === 'left' ? '左' : '右'}孩子`}。` });
      return;
    }
    // 两棵子树都有：直接后继（右子树一路往左）或直接前驱（左子树一路往右）替代
    const succ = replace === 'succ';
    let sp = z, s = succ ? n.right : n.left;
    const path = [s];
    while ((succ ? tree.nodes[s].left : tree.nodes[s].right) !== null) { sp = s; s = succ ? tree.nodes[s].left : tree.nodes[s].right; path.push(s); }
    const name = succ ? '直接后继（右子树里最小的：进右子树，一路往左走到头）' : '直接前驱（左子树里最大的：进左子树，一路往右走到头）';
    steps.push({ view: snap({ cls: { [z]: 'sv-swap' }, chips: [['删除', text(x)]] }), msg: `${K(z)} 左、右子树都有：用它的${name}来替代它。`, ask: { tag: 'case', kind: 'choice', q: `删 ${K(z)} 属于哪种情况？`, choices: CASES, answer: CASES[2] } });
    steps.push({ view: snap({ cls: { [z]: 'sv-swap', ...Object.fromEntries(path.map((p) => [p, 'sv-path'])), [s]: 'sv-cur' }, edge: Object.fromEntries(path.map((p) => [p, 'sv-edge-path'])), chips: [['删除', text(x)]] }), msg: `${succ ? '直接后继' : '直接前驱'}是 ${K(s)}（路径：${[z, ...path].map(K).join(' → ')}）。`, ask: { tag: 'replace', kind: 'pick', q: `用来替代 ${K(z)} 的是哪个结点？在图里点出来。`, answer: K(s) } });
    const sKey = tree.nodes[s].key, sItem = tree.nodes[s].item;
    const sChild = succ ? tree.nodes[s].right : tree.nodes[s].left;
    // 把 s 从原来的位置摘下（它最多只有一棵子树），再把 s 的关键字放到 z 上
    if (sp === z) tree.nodes[z][succ ? 'right' : 'left'] = sChild;
    else tree.nodes[sp][succ ? 'left' : 'right'] = sChild;
    delete tree.nodes[s];
    const old = tree.nodes[z].key;
    tree.nodes[z].key = sKey;
    tree.nodes[z].item = sItem;
    steps.push({ view: snap({ fresh: [z], cls: { [z]: 'sv-done' }, chips: [['删除', text(x)]] }), msg: `把 ${sKey} 放到 ${old} 的位置；${sKey} 原来的位置${sChild !== null ? `由它的${succ ? '右' : '左'}子树（${K(sChild)}）顶上` : '是叶结点，直接去掉'}。删好了。` });
  };

  if (!ops.length) {
    steps.push({ view: snap(), msg: `依次插入 ${items.map(text).join('、')}，建一棵二叉排序树：每个新关键字从根开始比，小往左、大往右。` });
    for (const it of items) insert(it);
    steps.push({ view: snap(), msg: `建好了。中序遍历正好从小到大：${inorderKeys(tree).join(' ')}。` });
  } else {
    for (const it of items) insert(it, { quiet: true });
    steps.push({ view: snap(), msg: `这是依次插入 ${items.map(text).join('、')} 建成的二叉排序树。` });
    for (const o of ops) {
      if (o.op === 'insert') insert(val(o.arg));
      else if (o.op === 'search') search(val(o.arg));
      else remove(val(o.arg));
    }
  }
  return { steps, final: clone(tree) };
}
const CASES = ['叶结点：直接删', '只有一棵子树：子树顶上来', '两棵子树都有：用直接后继（或前驱）替代'];

function inorderKeys(tree) {
  const out = [];
  const w = (id) => { if (id === null) return; w(tree.nodes[id].left); out.push(tree.nodes[id].key); w(tree.nodes[id].right); };
  w(tree.root);
  return out;
}

// —— 堆（数组从 1 存：A[i] 的孩子是 A[2i]、A[2i+1]）——

function heapRun({ items, max, ops }) {
  const A = [null, ...items.map((x) => ({ ...x }))];
  let len = items.length;
  const steps = [], passes = [];
  const word = max ? '大根堆' : '小根堆';
  const better = (a, b) => (max ? a.v > b.v : a.v < b.v); // a 应该在 b 上面
  const T = (x) => x.text;
  const snap = (extra = {}) => ({ A: A.slice(1), len, ...extra });
  const bad = () => { for (let i = 2; i <= len; i++) if (better(A[i], A[i >> 1])) return i; return 0; };

  // 往下调整（王道 HeadAdjust 的效果：和更「大」的孩子比，比它小就交换，一直往下）
  const siftDown = (k, label) => {
    for (;;) {
      let c = 2 * k;
      if (c > len) {
        steps.push({ view: snap({ cls: { [k]: 'sv-cur' } }), msg: `A[${k}] = ${T(A[k])} 没有孩子了，${label}到这里结束。` });
        return;
      }
      if (c + 1 <= len && better(A[c + 1], A[c])) c++;
      const pair = 2 * k + 1 <= len ? `较${max ? '大' : '小'}的孩子` : '唯一的孩子';
      if (!better(A[c], A[k])) {
        steps.push({ view: snap({ cls: { [k]: 'sv-cur', [c]: 'sv-cmp' } }), msg: `A[${k}] = ${T(A[k])} 和${pair} A[${c}] = ${T(A[c])} 比：${max ? '不小于' : '不大于'}它，不用动，${label}结束。` });
        return;
      }
      [A[k], A[c]] = [A[c], A[k]];
      steps.push({ view: snap({ cls: { [c]: 'sv-cur', [k]: 'sv-swap' }, fresh: [k, c] }), msg: `${T(A[c])} 比${pair} ${T(A[k])} ${max ? '小' : '大'}：交换，${T(A[c])} 往下坠到 A[${c}]，接着往下看。`, ask: { tag: 'swap', kind: 'pick', q: `${T(A[c])} 接下来和谁交换？在图里点出来。`, answer: String(c) } });
      k = c;
    }
  };
  const siftUp = (k) => {
    while (k > 1) {
      const p = k >> 1;
      if (!better(A[k], A[p])) {
        steps.push({ view: snap({ cls: { [k]: 'sv-cur', [p]: 'sv-cmp' } }), msg: `${T(A[k])} 和双亲 A[${p}] = ${T(A[p])} 比：${max ? '不大于' : '不小于'}它，停下。` });
        return;
      }
      [A[k], A[p]] = [A[p], A[k]];
      steps.push({ view: snap({ cls: { [p]: 'sv-cur', [k]: 'sv-swap' }, fresh: [k, p] }), msg: `${T(A[p])} 比双亲 ${T(A[k])} ${max ? '大' : '小'}：交换，往上浮到 A[${p}]。`, ask: { tag: 'swap', kind: 'pick', q: `${T(A[p])} 接下来和谁交换？在图里点出来。`, answer: String(p) } });
      k = p;
    }
    steps.push({ view: snap({ cls: { 1: 'sv-cur' } }), msg: `${T(A[1])} 浮到了堆顶，停下。` });
  };

  const build = () => {
    const after = A.slice(); // 先算一遍建好的样子给 ask 用
    { const B = after; const sd = (k) => { for (;;) { let c = 2 * k; if (c > len) return; if (c + 1 <= len && better(B[c + 1], B[c])) c++; if (!better(B[c], B[k])) return; [B[k], B[c]] = [B[c], B[k]]; k = c; } }; for (let i = len >> 1; i >= 1; i--) sd(i); }
    steps.push({ view: snap(), msg: `建${word}：序列按层序放成一棵完全二叉树（A[i] 的孩子是 A[2i]、A[2i+1]）。从最后一个非叶结点 A[⌊${len}/2⌋] = A[${len >> 1}] 开始，往前逐个往下调整。`, ask: { tag: 'build', kind: 'text', q: `建好的${word}，按 A[1]～A[${len}] 写出来是什么？`, answer: after.slice(1, len + 1).map(T).join(' ') } });
    for (let i = len >> 1; i >= 1; i--) {
      steps.push({ view: snap({ cls: { [i]: 'sv-cur' }, sub: i }), msg: `调整以 A[${i}] = ${T(A[i])} 为根的子树。` });
      siftDown(i, '这棵子树的调整');
    }
    steps.push({ view: snap({ done: true }), msg: `${word}建好了：A[1] = ${T(A[1])} 是${max ? '最大' : '最小'}的。` });
  };

  steps.push({ view: snap(), msg: `序列存在 A[1]～A[${len}] 里，看成一棵完全二叉树。` });
  for (const o of ops) {
    if (o.op === 'build') { build(); continue; }
    const b = bad();
    if (b) throw new Error(`现在还不是${word}（A[${b}] = ${T(A[b])} ${max ? '比双亲大' : '比双亲小'}）：ops 里先写 build`);
    if (o.op === 'insert') {
      const x = { text: o.arg, v: Number(o.arg) };
      if (len + 1 > MAX_NODES) throw new Error(`堆最多 ${MAX_NODES} 个元素`);
      A[++len] = x;
      steps.push({ view: snap({ cls: { [len]: 'sv-cur' }, fresh: [len] }), msg: `插入 ${T(x)}：先放在最后（A[${len}]），再和双亲比，往上浮。` });
      siftUp(len);
    } else if (o.op === 'delete') {
      if (len < 1) throw new Error('堆已经空了，不能再删');
      const top = A[1], last = A[len];
      A[1] = last;
      A[len] = null;
      len--;
      A.length = len + 1;
      steps.push({ view: snap({ cls: { 1: 'sv-cur' }, fresh: [1] }), msg: `删除堆顶 ${T(top)}：把最后一个元素 ${T(last)} 放到堆顶，元素个数减 1，再从堆顶往下调整。` });
      if (len >= 1) siftDown(1, '调整');
    } else if (o.op === 'sort') {
      const n0 = len;
      let pass = 0;
      steps.push({ view: snap(), msg: `堆排序：每一趟把堆顶（剩下的里最${max ? '大' : '小'}的）和堆里最后一个交换，它就到了最终位置；堆缩小 1，再从堆顶往下调整。一共 ${n0 - 1} 趟。` });
      while (len > 1) {
        pass++;
        const after = A.slice();
        { const B = after; [B[1], B[len]] = [B[len], B[1]]; const L = len - 1; let k = 1; for (;;) { let c = 2 * k; if (c > L) break; if (c + 1 <= L && better(B[c + 1], B[c])) c++; if (!better(B[c], B[k])) break; [B[k], B[c]] = [B[c], B[k]]; k = c; } }
        const top = A[1];
        [A[1], A[len]] = [A[len], A[1]];
        steps.push({ view: snap({ cls: { 1: 'sv-cur', [len]: 'sv-swap' }, fresh: [1, len], sorted: len }), msg: `第 ${pass} 趟：堆顶 ${T(top)} 和 A[${len}] = ${T(A[1])} 交换，${T(top)} 就位。`, ask: { tag: 'pass', kind: 'text', q: `第 ${pass} 趟结束后（${T(top)} 就位、剩下的再调整成堆），A[1]～A[${n0}] 是什么？`, answer: after.slice(1, n0 + 1).map(T).join(' ') } });
        len--;
        siftDown(1, '调整');
        passes.push(A.slice(1, n0 + 1).map(T));
      }
      len = n0;
      steps.push({ view: snap({ sorted: 1 }), msg: `排序完成：${A.slice(1).map(T).join(' ')}（${max ? '大根堆排出来是升序' : '小根堆排出来是降序'}）。` });
    }
  }
  return { steps, passes, final: A.slice(1, len + 1).map(T) };
}

// —— 画 ——

export function view(s, input) {
  if (input.kind === 'heap') return heapView(s);
  const tree = s.tree;
  let h = treeSvg(tree, { cls: s.cls, edge: s.edge, fresh: s.fresh });
  const extra = [];
  if (s.seq) extra.push(['序列', s.seq.length ? s.seq.join(' ') : '（还没有）']);
  if (s.stack && s.stack.length) extra.push(['递归栈（从根往下）', s.stack.join(' → ')]);
  if (s.queue) extra.push(['队列', s.queue.length ? s.queue.join(' ') : '（空）']);
  for (const c of s.chips || []) extra.push(c);
  return h + chips(extra);
}

function heapView(s) {
  const len = s.len;
  const nodes = {};
  for (let i = 1; i <= len; i++) nodes[String(i)] = { key: s.A[i - 1].text, left: 2 * i <= len ? String(2 * i) : null, right: 2 * i + 1 <= len ? String(2 * i + 1) : null };
  const tree = { root: len ? '1' : null, nodes };
  const cls = {};
  for (const [k, v] of Object.entries(s.cls || {})) if (Number(k) <= len) cls[k] = v;
  // 堆排序：排好的那几个在数组里标成绿色，不在树上
  const arrCls = { ...(s.cls || {}) };
  for (let i = len + 1; i <= s.A.length; i++) arrCls[i] = `${arrCls[i] || ''} sv-done`.trim();
  if (s.sorted === 1) for (let i = 1; i <= s.A.length; i++) arrCls[i] = 'sv-done';
  const tsvg = treeSvg(tree, { cls, fresh: (s.fresh || []).filter((i) => i <= len), pick: (id) => id, cmd: (id) => Number(id) });
  const arr = arrayView(s.A.map((x) => x && x.text), { cls: arrCls, fresh: s.fresh, label: '' });
  return `<div class="sv-heap">${tsvg}${arr}</div>`;
}

export function quiz(input, r) {
  if (input.kind === 'walk') {
    return { q: `写出这棵树的${WALKS[input.walk]}序列。`, qhtml: treeSvg(input.tree, { pick: () => '' }), type: 'seq', answer: r.passes[0].join(' ') };
  }
  if (input.kind === 'bst') {
    const keys = levelKeys(r.final, input.quizWalk);
    const did = input.ops.length ? `建好以后再${input.ops.map((o) => `${{ insert: '插入', search: '查找', delete: '删除' }[o.op]} ${o.arg}`).join('，')}` : '';
    return { q: `依次插入 ${input.items.map((x) => x.text).join('、')} 建一棵二叉排序树${did ? `，${did}` : ''}。写出最后这棵树的${WALKS[input.quizWalk]}序列。`, type: 'seq', answer: keys.join(' ') };
  }
  const p = input.pass;
  const sorting = input.ops.some((o) => o.op === 'sort');
  const did = input.ops.map((o) => ({ build: `建${input.max ? '大' : '小'}根堆`, insert: `插入 ${o.arg}`, delete: '删除堆顶', sort: '堆排序' }[o.op])).join('，再');
  if (sorting && p) {
    const k = Math.min(p, r.passes.length);
    return { q: `对 ${input.items.map((x) => x.text).join(' ')} ${did}。写出第 ${k} 趟结束后的序列（A[1] 起）。`, qhtml: arrayView(input.items.map((x) => x.text), { pick: false }), type: 'seq', answer: r.passes[k - 1].join(' ') };
  }
  return { q: `对 ${input.items.map((x) => x.text).join(' ')} ${did}，写出最后的序列（A[1] 起）。`, qhtml: arrayView(input.items.map((x) => x.text), { pick: false }), type: 'seq', answer: r.final.join(' ') };
}

function levelKeys(tree, walk) {
  const out = [];
  const K = (id) => tree.nodes[id].key;
  if (walk === 'levelorder') return levelOrder(tree).map(K);
  const w = (id) => {
    if (id === null) return;
    const n = tree.nodes[id];
    if (walk === 'preorder') out.push(K(id));
    w(n.left);
    if (walk === 'inorder') out.push(K(id));
    w(n.right);
    if (walk === 'postorder') out.push(K(id));
  };
  w(tree.root);
  return out;
}

export function problems(input) {
  const out = [];
  if (input.kind === 'heap' && input.pass && !input.ops.some((o) => o.op === 'sort')) out.push('pass: 只对堆排序（ops 里有 sort）有用');
  return out;
}

export const treeEngine = { name: 'tree', title: '树', parse, run, view, quiz, problems };
