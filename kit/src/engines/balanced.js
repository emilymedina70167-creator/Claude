// 平衡的二叉排序树（组件 avl、rbt）：一个个插入、删除，每一步看失衡、旋转、变色。
//   avl: + ops:  平衡二叉树（王道：平衡因子 = 左子树高 − 右子树高）。插入后从新结点往上找最小不平衡子树，
//                按 LL / RR / LR / RL 调整（插入只要调一次）；删除先按二叉排序树删，再从删掉的位置往上，
//                失衡了就转——转完这棵子树可能矮了 1，所以要接着往上看，可能一路转到根
//   rbt: + ops:  红黑树插入（王道：新结点染红；父黑不用调；叔叔红：叔父爷变色、爷爷当新结点往上；
//                叔叔黑：LL / RR 单旋 + 父爷换色，LR / RL 双旋 + 儿爷换色；根染黑）
// 纯函数，不碰 DOM（tests/trees-engine.test.js）。画法用 treeview.js：结点按中序排开，旋转时中序不变，
// 结点只上下挪，换步时同一个结点（data-key 按结点编号）从旧位置滑过去，看得出谁转上来了。
import { treeSvg, levelOrder } from './treeview.js';
import { chips, esc } from './arrayview.js';

const MAX_NODES = 31;
const W = { left: '左', right: '右' };

// —— 共用：关键字、操作、树 ——

const isNum = (t) => /^-?\d+(\.\d+)?$/.test(t);
export const cmp = (a, b) => (typeof a.v === 'number' ? a.v - b.v : a.v < b.v ? -1 : a.v > b.v ? 1 : 0);

/** 关键字：数（按大小比）或字（按字典序比），不能混着；重复的报出来（查找树里不放相同的关键字） */
export function parseKeys(src, what, max = MAX_NODES) {
  const toks = String(src ?? '').trim().replace(/^\[|\]$/g, '').split(/[\s,，、]+/).filter(Boolean);
  if (!toks.length) throw new Error(`${what}: 不能为空，写要依次插入的关键字，空格隔开`);
  if (toks.length > max) throw new Error(`${what}: 最多 ${max} 个关键字（现在 ${toks.length} 个），多了一屏放不下`);
  const nums = toks.every(isNum);
  if (!nums && toks.some(isNum)) throw new Error(`${what}: 数和字不能混着写`);
  const items = toks.map((t) => ({ text: t, v: nums ? Number(t) : t }));
  const dup = items.find((x, i) => items.findIndex((y) => cmp(x, y) === 0) !== i);
  if (dup) throw new Error(`${what}: 关键字 ${dup.text} 写了两次（查找树里不放相同的关键字）`);
  return items;
}

/** ops: insert 50, delete 7（中文「插入 50」「删除 7」也认）。一个操作一个关键字，几个操作用逗号隔开 */
export function parseOps(src, { allowed, what, numeric }) {
  const list = String(src ?? '').split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!list.length) throw new Error('ops: 写要做的操作，比如 ops: delete 7（几个用逗号隔开）');
  const alias = { 插入: 'insert', 删除: 'delete', add: 'insert', ins: 'insert', remove: 'delete', del: 'delete' };
  const eg = allowed.map((o) => `${o} 40`).join('、');
  return list.map((x) => {
    const [w, ...rest] = x.split(/\s+/);
    const op = alias[w] || w.toLowerCase();
    if (!allowed.includes(op)) throw new Error(`ops: 不认识「${x}」，${what}能写 ${eg}${allowed.includes('delete') ? '' : `（${what}只演示插入）`}`);
    if (rest.length !== 1) throw new Error(`ops: 「${x}」：${op} 后面写一个关键字，比如 ${op} 40；几个操作用逗号隔开`);
    if (numeric !== isNum(rest[0])) throw new Error(`ops: 「${x}」和树里的关键字不是一类（要${numeric ? '数' : '字'}）`);
    return { op, item: { text: rest[0], v: numeric ? Number(rest[0]) : rest[0] } };
  });
}

const WALKS = { levelorder: '层序', preorder: '先序', inorder: '中序', postorder: '后序' };
const WALK_ALIAS = { level: 'levelorder', levelorder: 'levelorder', 层序: 'levelorder', 层次: 'levelorder', pre: 'preorder', preorder: 'preorder', 先序: 'preorder', 前序: 'preorder', in: 'inorder', inorder: 'inorder', 中序: 'inorder', post: 'postorder', postorder: 'postorder', 后序: 'postorder' };
function walkOf(src, extra = {}) {
  const s = String(src ?? '').trim().toLowerCase();
  if (!s) return 'levelorder';
  const w = WALK_ALIAS[s] || extra[s];
  if (!w) throw new Error(`quiz: 写 level（层序，默认）、pre（先序）、in（中序）、post（后序）${Object.keys(extra).length ? `，或者 ${Object.keys(extra).join(' / ')}` : ''}（现在是「${src}」）`);
  return w;
}

const newTree = () => ({ root: null, nodes: {}, seq: 0 });
const copyTree = (t) => ({ root: t.root, nodes: Object.fromEntries(Object.entries(t.nodes).map(([k, v]) => [k, { ...v }])) });
function parentOf(t, id) {
  for (const [p, n] of Object.entries(t.nodes)) if (n.left === id || n.right === id) return p;
  return null;
}
function setChild(t, p, old, nu) {
  if (p === null) t.root = nu;
  else if (t.nodes[p].left === old) t.nodes[p].left = nu;
  else t.nodes[p].right = nu;
}
/** 以 a 为中心右旋（左孩子转上来）或左旋（右孩子转上来），返回转上来的结点 */
function rotate(t, a, dir) {
  const p = parentOf(t, a);
  const n = t.nodes[a];
  const inner = dir === 'right' ? 'left' : 'right', outer = dir === 'right' ? 'right' : 'left';
  const b = n[inner];
  n[inner] = t.nodes[b][outer];
  t.nodes[b][outer] = a;
  setChild(t, p, a, b);
  return b;
}
const heightOf = (t, id) => (id === null ? 0 : 1 + Math.max(heightOf(t, t.nodes[id].left), heightOf(t, t.nodes[id].right)));
const subtree = (t, id) => (id === null ? [] : [id, ...subtree(t, t.nodes[id].left), ...subtree(t, t.nodes[id].right)]);

/** 从根往下找 x：{ path（比过的结点）, found, parent, side } */
function descend(t, x) {
  const path = [];
  let id = t.root, parent = null, side = null;
  while (id !== null) {
    path.push(id);
    const c = cmp(x, t.nodes[id].item);
    if (c === 0) return { path, found: id, parent, side };
    parent = id;
    side = c < 0 ? 'left' : 'right';
    id = t.nodes[id][side];
  }
  return { path, found: null, parent, side };
}

function walkKeys(t, walk) {
  const K = (id) => t.nodes[id].key;
  if (t.root === null) return [];
  if (walk === 'levelorder') return levelOrder(t).map(K);
  const out = [];
  const w = (id) => {
    if (id === null) return;
    const n = t.nodes[id];
    if (walk === 'preorder') out.push(K(id));
    w(n.left);
    if (walk === 'inorder') out.push(K(id));
    w(n.right);
    if (walk === 'postorder') out.push(K(id));
  };
  w(t.root);
  return out;
}

const pathEdges = (ids) => Object.fromEntries(ids.map((id) => [id, 'sv-edge-path']));

/**
 * 画树，结点旁边带小字（平衡因子、父 / 叔 / 爷）。treeSvg 自己的 note 写在右上角，左孩子的右上角正好压着
 * 连向双亲的那条边，所以这里自己写：左孩子写在左上角，别的写在右上角（放在结点的 <g> 里，换步时跟着结点滑）
 */
function drawTree(tree, { note, ...opts } = {}) {
  const svg = treeSvg(tree, opts);
  if (!note || !Object.keys(note).length) return svg;
  const isLeft = (id) => { const p = parentOf(tree, id); return p !== null && tree.nodes[p].left === id; };
  return svg.replace(/data-key="n:([^"]+)"><circle cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"\/>/g, (all, id, cx, cy, r) => {
    if (note[id] === undefined || note[id] === '') return all;
    const left = isLeft(id);
    const x = Number(cx) + (left ? -1 : 1) * (Number(r) + 4), y = Number(cy) - Number(r) + 2;
    return `${all}<text class="sv-node-note${left ? ' sv-note-l' : ''}" x="${x}" y="${y}">${esc(note[id])}</text>`;
  });
}
const lastStep = (steps) => steps[steps.length - 1];
// 填表里「没有」这一格：空着、写「无」「-」都算对
const NONE = ['', '无', '-', '—', '不用', '不用调'];

// 错法那一遍只留和这种错法有关的先猜：会走岔的错法（树从此不一样了），只留第一次犯错那个操作里的；
// 不走岔的（平衡因子算反、根忘了染黑）每一处都留。别的问题题面碰巧一样、答案碰巧对上，会说错
function keepMisAsks(steps, firstMis, diverges) {
  for (const s of steps) {
    if (s.ask && !(s.ask.mis && (!diverges || s.op === firstMis))) delete s.ask;
    delete s.asks;
  }
}

// —— 平衡二叉树 ——

const ROT = { LL: 'LL（右单旋转）', RR: 'RR（左单旋转）', LR: 'LR（先左后右双旋转）', RL: 'RL（先右后左双旋转）' };
const ROT_CHOICES = Object.values(ROT);
const fmtBF = (b) => (b > 0 ? `+${b}` : b < 0 ? `−${-b}` : '0');
const BF_CHOICES = ['−2', '−1', '0', '+1', '+2'];
const DEL_CASES = ['叶结点：直接删', '只有一棵子树：子树顶上来', '两棵子树都有：用直接后继（或前驱）替代'];
const AVL_DIVERGE = { lr2ll: true, topmost: true, bfsign: false };

function parseAvl(fields) {
  const items = parseKeys(fields.avl, 'avl');
  const numeric = typeof items[0].v === 'number';
  const ops = fields.ops !== undefined && String(fields.ops).trim() ? parseOps(fields.ops, { allowed: ['insert', 'delete'], what: '平衡二叉树', numeric }) : [];
  if (items.length + ops.filter((o) => o.op === 'insert').length > MAX_NODES) throw new Error(`结点最多 ${MAX_NODES} 个，一屏才放得下`);
  const r = String(fields.replace ?? '').trim();
  if (r && !/^(pred|succ|前驱|后继|直接前驱|直接后继)$/i.test(r)) throw new Error('replace: 写 succ（直接后继，默认）或 pred（直接前驱）');
  return { kind: 'avl', items, ops, replace: /^(pred|前驱|直接前驱)$/i.test(r) ? 'pred' : 'succ', quizWalk: walkOf(fields.quiz) };
}

function avlRun(input) {
  const { items, ops, replace, mistake } = input;
  const t = newTree();
  const steps = [], log = [];
  let live = false; // 写了 ops: 时先把 avl: 的关键字悄悄建好（不出步，也不犯错：那棵树是题目给的）
  let opNo = -1, firstMis = -1, misCount = 0;
  const push = (s) => { if (live) steps.push({ ...s, op: opNo }); };
  const flag = (a) => { a.mis = true; misCount++; if (firstMis < 0) firstMis = opNo; };
  const K = (id) => t.nodes[id].key;
  const H = (id) => heightOf(t, id);
  const BF = (id) => H(t.nodes[id].left) - H(t.nodes[id].right);
  const notes = () => Object.fromEntries(Object.keys(t.nodes).map((id) => [id, fmtBF(BF(id))]));
  const snap = (extra = {}) => ({ tree: copyTree(t), ...extra });
  const up = (id) => { const out = []; for (let x = id; x !== null && x !== undefined; x = parentOf(t, x)) out.push(x); return out; };
  const add = (x) => { const id = `n${++t.seq}`; t.nodes[id] = { key: x.text, item: x, left: null, right: null }; return id; };
  const childToward = (a, target) => { const n = t.nodes[a]; return [n.left, n.right].find((c) => c !== null && subtree(t, c).includes(target)) ?? null; };
  const tallerSide = (a, prefer) => {
    const l = H(t.nodes[a].left), r = H(t.nodes[a].right);
    if (l === r) return { side: prefer, tie: true };
    return { side: l > r ? 'left' : 'right', tie: false };
  };
  const tail = (text) => { if (live && text) lastStep(steps).msg += text; };

  // 从 from 往上看平衡因子，失衡了就转。插入转一次就好；删除转完这棵子树可能矮了 1，接着往上看
  function rebalance(from, { what, row, newId = null, lead = '' }) {
    const deleting = newId === null;
    let round = 0;
    for (;;) {
      const path = up(from);
      const bad = path.filter((id) => Math.abs(BF(id)) > 1);
      const lowest = bad[0];
      const z = live && mistake === 'topmost' && bad.length > 1 ? bad[bad.length - 1] : lowest;
      if (round === 0) {
        // 先把平衡因子都标出来：问一个结点的平衡因子（失衡了问最小不平衡子树的根，没失衡问根）
        const q = lowest ?? t.root;
        let ask;
        if (q !== null && q !== undefined) {
          const b = BF(q);
          ask = { tag: 'bf', kind: 'choice', q: `${what} 以后，${K(q)} 的平衡因子是多少？`, choices: BF_CHOICES, answer: fmtBF(live && mistake === 'bfsign' ? -b : b) };
          if (live && mistake === 'bfsign' && b !== 0) flag(ask);
        }
        const shown = lowest !== undefined ? path.slice(0, path.indexOf(lowest) + 1) : path;
        const list = shown.map((id) => `${K(id)} 是 ${fmtBF(BF(id))}`).join('，');
        const cls = Object.fromEntries(path.map((id) => [id, 'sv-path']));
        for (const id of bad) cls[id] = 'sv-swap';
        if (newId) cls[newId] = 'sv-cur';
        const head = path.length ? `从 ${K(path[0])} 往上算平衡因子（左子树高 − 右子树高）：${list}` : '';
        const msg = t.root === null ? `${lead}树空了。`
          : lowest !== undefined ? `${lead}${head}——${K(lowest)} 失衡了。`
          : `${lead}${head ? `${head}，` : ''}${path.length ? '' : '平衡因子'}都在 −1～+1 之间，不用调。`;
        push({ view: snap({ note: notes(), cls, edge: pathEdges(path.slice(0, -1)) }), msg, ask });
      }
      if (z === undefined) return;
      round++;

      // y、x：插入时是沿着新结点那条路往下的两个；删除时是更高的孩子、它更高的孩子（一样高取和 y 同一边的）
      let y = !deleting ? childToward(z, newId) : null;
      let x = y !== null && y !== newId ? childToward(y, newId) : null;
      let tie = false;
      if (y === null || x === null) {
        y = t.nodes[z][tallerSide(z, 'left').side];
        const ySide = t.nodes[z].left === y ? 'left' : 'right';
        const tx = tallerSide(y, ySide);
        x = t.nodes[y][tx.side];
        tie = tx.tie;
      }
      const yS = t.nodes[z].left === y ? 'left' : 'right';
      const xS = t.nodes[y].left === x ? 'left' : 'right';
      const type = (yS === 'left' ? 'L' : 'R') + (xS === 'left' ? 'L' : 'R');

      // 最小不平衡子树：整棵子树标出来，问根是谁
      const sub = subtree(t, z);
      const cls = Object.fromEntries(sub.map((id) => [id, 'sv-path']));
      cls[z] = 'sv-swap';
      const rootAsk = { tag: 'root', kind: 'pick', q: round === 1 ? `${what} 以后，最小不平衡子树的根是哪个结点？在图里点出来。` : `${what}：转完以后接着往上看，又失衡的是哪个结点？在图里点出来。`, answer: K(z) };
      if (live && mistake === 'topmost' && z !== lowest) flag(rootAsk);
      push({
        view: snap({ note: notes(), cls, edge: pathEdges(sub.slice(1)) }),
        msg: round === 1 ? `最小不平衡子树是以 ${K(z)} 为根的这一棵：从${deleting ? '删掉的位置' : '新结点'}往上，第一个平衡因子绝对值超过 1 的就是 ${K(z)}。` : `这棵子树转完矮了 1，再往上：${K(z)} 的平衡因子变成了 ${fmtBF(BF(z))}，又失衡了。`,
        ask: rootAsk,
      });

      // 旋转。错法 lr2ll：LR 当成 LL、RL 当成 RR，只转一次
      let doType = type;
      const rotAsk = { tag: 'rotate', kind: 'choice', q: `以 ${K(z)} 为根的这棵子树要怎么调整？`, choices: ROT_CHOICES, answer: ROT[type] };
      if (live && mistake === 'lr2ll' && (type === 'LR' || type === 'RL')) { doType = type === 'LR' ? 'LL' : 'RR'; rotAsk.answer = ROT[doType]; flag(rotAsk); }
      row.zs.push(K(z));
      row.types.push(doType);
      const why = deleting
        ? `${K(z)} 的${W[yS]}子树更高（${K(y)}），${K(y)} 的${W[xS]}子树${tie ? `和另一边一样高，取和 ${K(y)} 同一边的` : '更高'}（${K(x)}）`
        : `新结点 ${t.nodes[newId].key} 插在 ${K(z)} 的${W[yS]}孩子 ${K(y)} 的${W[xS]}子树里`;
      const zKey = K(z), yKey = K(y), xKey = K(x);
      let top;
      if (doType === 'LL' || doType === 'RR') {
        const dir = doType === 'LL' ? 'right' : 'left';
        const moved = t.nodes[y][dir]; // y 的内侧子树：转完改挂到 z 下面
        top = rotate(t, z, dir);
        push({
          view: snap({ note: notes(), fresh: [y, z], cls: { [y]: 'sv-done', [z]: 'sv-cmp' } }),
          msg: `${why}：${doType} 型，${W[dir]}单旋转——${yKey} 转上来当这棵子树的根，${zKey} 成为它的${W[dir]}孩子${moved !== null ? `；${yKey} 原来的${W[dir]}子树（${K(moved)}）改挂成 ${zKey} 的${W[dir === 'right' ? 'left' : 'right']}子树` : ''}。`,
          ask: rotAsk,
        });
      } else {
        const d1 = doType === 'LR' ? 'left' : 'right', d2 = doType === 'LR' ? 'right' : 'left';
        rotate(t, y, d1);
        push({
          view: snap({ fresh: [x, y], cls: { [x]: 'sv-cur', [z]: 'sv-swap' } }),
          msg: `${why}：${doType} 型，先${W[d1]}后${W[d2]}，转两次。第一步，以 ${yKey} 为中心${W[d1]}旋：${xKey} 转上来，成为 ${zKey} 的${W[yS]}孩子。`,
          ask: rotAsk,
        });
        top = rotate(t, z, d2);
        push({
          view: snap({ note: notes(), fresh: [x, z], cls: { [x]: 'sv-done', [z]: 'sv-cmp', [y]: 'sv-cmp' } }),
          msg: `第二步，以 ${zKey} 为中心${W[d2]}旋：${xKey} 当这棵子树的根，${K(t.nodes[x].left)}、${K(t.nodes[x].right)} 是它的左、右孩子。`,
        });
      }
      if (!deleting) { tail('这棵子树的高度回到了插入前，整棵树又平衡了。'); return; }
      from = parentOf(t, top);
      if (!up(from).some((id) => Math.abs(BF(id)) > 1)) { tail(from === null ? `${K(top)} 已经是根，删完了。` : '再往上都平衡，删完了。'); return; }
    }
  }

  function insert(x) {
    const what = `插入 ${x.text}`;
    const row = { label: what, zs: [], types: [] };
    const done = () => { row.root = t.root === null ? '' : K(t.root); if (live) log.push(row); };
    if (t.root === null) {
      const id = add(x);
      t.root = id;
      push({ view: snap({ fresh: [id], cls: { [id]: 'sv-cur' }, note: notes(), chips: [['插入', x.text]] }), msg: `${what}：树是空的，${x.text} 当根（平衡因子 0）。` });
      return done();
    }
    const d = descend(t, x);
    if (d.found !== null) {
      push({ view: snap({ cls: { [d.found]: 'sv-found' }, chips: [['插入', x.text]] }), msg: `树里已经有 ${x.text}，不插入。` });
      return done();
    }
    const id = add(x);
    t.nodes[d.parent][d.side] = id;
    push({
      view: snap({ fresh: [id], cls: { ...Object.fromEntries(d.path.map((p) => [p, 'sv-path'])), [id]: 'sv-cur' }, edge: pathEdges([...d.path.slice(1), id]), chips: [['插入', x.text]] }),
      msg: `${what}：${d.path.length > 1 ? `从根往下比（${d.path.map(K).join(' → ')}），小往左、大往右` : `和根 ${K(d.parent)} 比`}，放在 ${K(d.parent)} 的${W[d.side]}孩子。`,
      ask: { tag: 'insert', kind: 'pick', q: `${x.text} 插进来以后是谁的孩子？在图里点出它的双亲。`, answer: K(d.parent) },
    });
    rebalance(d.parent, { what, row, newId: id });
    done();
  }

  function remove(x) {
    const what = `删除 ${x.text}`;
    const row = { label: what, zs: [], types: [] };
    const done = () => { row.root = t.root === null ? '' : K(t.root); if (live) log.push(row); };
    const d = descend(t, x);
    if (d.found === null) {
      push({ view: snap({ cls: Object.fromEntries(d.path.map((p) => [p, 'sv-path'])), chips: [['删除', x.text]] }), msg: `${what}：从根往下找（${d.path.map(K).join(' → ')}），树里没有 ${x.text}，不用删。` });
      return done();
    }
    const z = d.found, n = t.nodes[z], zKey = K(z);
    const where = `从根往下找（${d.path.map(K).join(' → ')}）`;
    const caseAsk = (i) => ({ tag: 'case', kind: 'choice', q: `删 ${zKey} 属于哪种情况？`, choices: DEL_CASES, answer: DEL_CASES[i] });
    const base = { cls: { ...Object.fromEntries(d.path.map((p) => [p, 'sv-path'])), [z]: 'sv-swap' }, edge: pathEdges(d.path.slice(1)), chips: [['删除', x.text]] };
    let start, lead;
    if (n.left === null && n.right === null) {
      push({ view: snap(base), msg: `${what}：${where}，${zKey} 是叶结点，直接删。`, ask: caseAsk(0) });
      start = d.parent;
      setChild(t, d.parent, z, null);
      delete t.nodes[z];
      lead = `删掉了 ${zKey}。`;
    } else if (n.left === null || n.right === null) {
      const child = n.left ?? n.right;
      const s = n.left !== null ? 'left' : 'right';
      push({ view: snap({ ...base, cls: { ...base.cls, [child]: 'sv-cur' } }), msg: `${what}：${where}，${zKey} 只有${W[s]}子树：删掉 ${zKey}，让以 ${K(child)} 为根的${W[s]}子树顶上来。`, ask: caseAsk(1) });
      start = d.parent;
      setChild(t, d.parent, z, child);
      delete t.nodes[z];
      lead = `${K(child)} 顶到了 ${zKey} 原来的位置。`;
    } else {
      // 两棵子树都有：直接后继（右子树一路往左）或直接前驱（左子树一路往右）替代。替代的结点整个挪过去（换步时看得到它滑上来）
      const succ = replace === 'succ';
      const inner = succ ? 'left' : 'right', outer = succ ? 'right' : 'left';
      let sp = z, s = n[outer];
      const path = [s];
      while (t.nodes[s][inner] !== null) { sp = s; s = t.nodes[s][inner]; path.push(s); }
      const sKey = K(s);
      push({
        view: snap({ ...base, cls: { ...base.cls, ...Object.fromEntries(path.map((p) => [p, 'sv-path'])), [s]: 'sv-cur' }, edge: { ...base.edge, ...pathEdges(path) } }),
        msg: `${what}：${where}，${zKey} 左、右子树都有：用它的${succ ? `直接后继 ${sKey}（右子树里最小的：进右子树，一路往左走到头）` : `直接前驱 ${sKey}（左子树里最大的：进左子树，一路往右走到头）`}来替代它。`,
        ask: caseAsk(2),
      });
      const sChild = t.nodes[s][outer];
      if (sp === z) t.nodes[z][outer] = sChild;
      else t.nodes[sp][inner] = sChild;
      t.nodes[s].left = t.nodes[z].left;
      t.nodes[s].right = t.nodes[z].right;
      setChild(t, parentOf(t, z), z, s);
      delete t.nodes[z];
      start = sp === z ? s : sp;
      lead = `${sKey} 挪到了 ${zKey} 的位置；${sKey} 原来的位置${sChild !== null ? `由它的${W[outer]}子树（${K(sChild)}）顶上` : '空了'}。`;
    }
    rebalance(start, { what, row, lead });
    done();
  }

  for (const it of items) { if (ops.length) insert(it); }
  live = true;
  let startTree = copyTree(t);
  if (!ops.length) {
    push({ view: snap(), msg: `依次插入 ${items.map((x) => x.text).join('、')}，建一棵平衡二叉树。每插一个，从它往上算平衡因子（左子树高 − 右子树高），有绝对值超过 1 的，就找最小不平衡子树来转。` });
    for (const it of items) { opNo++; insert(it); }
    push({ view: snap({ note: notes() }), msg: `插完了。层序：${walkKeys(t, 'levelorder').join(' ')}；中序正好从小到大：${walkKeys(t, 'inorder').join(' ')}。` });
  } else {
    startTree = copyTree(t);
    push({ view: snap({ note: notes() }), msg: `这是依次插入 ${items.map((x) => x.text).join('、')} 建成的平衡二叉树（结点右上角的小字是平衡因子）。` });
    for (const o of ops) { opNo++; if (o.op === 'insert') insert(o.item); else remove(o.item); }
    push({ view: snap({ note: notes() }), msg: `做完了。最后这棵树的层序：${walkKeys(t, 'levelorder').join(' ') || '（空树）'}。` });
  }
  if (mistake) keepMisAsks(steps, firstMis, AVL_DIVERGE[mistake]);
  return { steps, log, final: copyTree(t), start: startTree, misApplied: misCount > 0 };
}

function avlView(s) {
  return drawTree(s.tree, { cls: s.cls, edge: s.edge, note: s.note, fresh: s.fresh }) + chips(s.chips || []);
}

function avlDid(input) {
  return input.ops.map((o) => `${o.op === 'insert' ? '插入' : '删除'} ${o.item.text}`).join('，');
}
function avlQuiz(input, r) {
  const did = avlDid(input);
  const keys = input.items.map((x) => x.text).join('、');
  return {
    q: did ? `下面是依次插入 ${keys} 建成的平衡二叉树。${did} 以后，写出这棵树的${WALKS[input.quizWalk]}序列。` : `依次插入 ${keys}，建一棵平衡二叉树。写出最后这棵树的${WALKS[input.quizWalk]}序列。`,
    qhtml: did ? treeSvg(r.start, { pick: () => '' }) : '',
    type: 'seq',
    answer: walkKeys(r.final, input.quizWalk).join(' ') || '空',
  };
}
function avlTable(input, r) {
  const did = avlDid(input);
  const rows = r.log.map((row) => ({
    label: row.label,
    cells: [
      { v: row.zs.length ? row.zs.join(' ') : NONE, vec: true },
      { v: row.types.length ? [row.types.join(' '), row.types.map((x) => `${x}型`).join(' ')] : NONE, vec: true },
      { v: row.root || NONE },
    ],
  }));
  return {
    q: `${did ? `在下面这棵平衡二叉树上依次${did}` : `依次插入 ${input.items.map((x) => x.text).join('、')} 建一棵平衡二叉树`}。每一步写出：最小不平衡子树的根（没失衡就空着）、调整的类型（LL / RR / LR / RL）、做完以后整棵树的根。删除可能要调整好几次，按先后用空格隔开。`,
    qhtml: did ? treeSvg(r.start, { pick: () => '' }) : '',
    dir: 'row', head: ['失衡的结点', '调整', '树根'], rows,
  };
}
function avlVariants(input) {
  const out = [];
  const tryV = (mistake, label) => { const v = { ...input, mistake }; try { if (avlRun(v).misApplied) out.push({ label, input: v }); } catch { /* 这组数上这种错法走不下去 */ } };
  tryV('lr2ll', '像是把 LR 型当成 LL 型（或 RL 当成 RR）只转了一次（王道：LR 先对失衡结点的左孩子左旋、再对失衡结点右旋；RL 反过来）');
  tryV('bfsign', '像是平衡因子算成了右子树高减左子树高（王道：平衡因子 = 左子树高 − 右子树高）');
  tryV('topmost', '像是找了离根最近的失衡结点来转（王道：最小不平衡子树的根是从新结点往上第一个失衡的，离插入的结点最近）');
  return out;
}
function avlProblems(input) {
  const out = [];
  const del = input.ops.filter((o) => o.op === 'delete');
  if (input.replace === 'pred' && !del.length) out.push('replace: 只在删除左右子树都有的结点时有用（ops 里没有 delete）');
  return out;
}

export const avlEngine = {
  name: 'avl', title: '平衡二叉树',
  parse: parseAvl, run: avlRun, view: avlView, quiz: avlQuiz, table: avlTable, variants: avlVariants, problems: avlProblems,
};

// —— 红黑树（插入）——

const RB = { root: '是根：染黑', black: '父黑：不用调', red: '叔红：变色', LL: 'LL：右旋', RR: 'RR：左旋', LR: 'LR：左右双旋', RL: 'RL：右左双旋' };
const RB_CHOICES = Object.values(RB);
const RB_DIVERGE = { redrotate: true, rootred: false };

function parseRbt(fields) {
  const items = parseKeys(fields.rbt, 'rbt');
  const numeric = typeof items[0].v === 'number';
  const ops = fields.ops !== undefined && String(fields.ops).trim() ? parseOps(fields.ops, { allowed: ['insert'], what: '红黑树', numeric }) : [];
  if (items.length + ops.length > MAX_NODES) throw new Error(`结点最多 ${MAX_NODES} 个，一屏才放得下`);
  return { kind: 'rbt', items, ops, quizWalk: walkOf(fields.quiz, { red: 'red', black: 'black', 红: 'red', 黑: 'black' }) };
}

function rbtRun(input) {
  const { items, ops, mistake } = input;
  const t = newTree();
  const steps = [], log = [];
  let live = false, opNo = -1, firstMis = -1, misCount = 0;
  const push = (s) => { if (live) steps.push({ ...s, op: opNo }); };
  const flag = (a) => { a.mis = true; misCount++; if (firstMis < 0) firstMis = opNo; };
  const K = (id) => t.nodes[id].key;
  const red = (id) => id !== null && t.nodes[id].red;
  const add = (x) => { const id = `n${++t.seq}`; t.nodes[id] = { key: x.text, item: x, left: null, right: null, red: true }; return id; };
  // 每个结点都带红 / 黑的 class，高亮叠在后面（样式里高亮只换描边，不盖住颜色）
  const snap = ({ hl = {}, ...extra } = {}) => ({ tree: copyTree(t), cls: Object.fromEntries(Object.keys(t.nodes).map((id) => [id, [t.nodes[id].red ? 'sv-rb-red' : 'sv-rb-black', hl[id] || ''].filter(Boolean).join(' ')])), ...extra });
  const redKeys = (leftRed) => Object.keys(t.nodes).filter((id) => t.nodes[id].red || (leftRed && id === t.root)).map((id) => t.nodes[id].item).sort(cmp).map((x) => x.text);

  function insert(x) {
    const what = `插入 ${x.text}`;
    const row = { label: what, acts: [], leftRed: false };
    const d = t.root === null ? null : descend(t, x);
    if (d && d.found !== null) {
      push({ view: snap({ hl: { [d.found]: 'sv-cur' }, chips: [['插入', x.text]] }), msg: `树里已经有 ${x.text}，不插入。` });
      row.root = K(t.root); row.reds = redKeys(false); if (live) log.push(row);
      return;
    }
    const id = add(x);
    if (d) t.nodes[d.parent][d.side] = id; else t.root = id;
    // 颜色题挂在放进去那一步上（学生看着插入前的树猜），答案等调整完才知道
    const colorAsk = { tag: 'color', kind: 'choice', q: '', choices: ['红', '黑'], answer: '' };
    push({
      view: snap({ fresh: [id], hl: { ...Object.fromEntries((d?.path || []).map((p) => [p, 'sv-path'])), [id]: 'sv-cur' }, edge: pathEdges([...(d?.path.slice(1) || []), id]), chips: [['插入', x.text]] }),
      msg: d ? `${what}：按二叉排序树往下比（${d.path.map(K).join(' → ')}），放在 ${K(d.parent)} 的${W[d.side]}孩子；新结点染成红色。` : `${what}：树是空的，${x.text} 当根（新结点先染成红色）。`,
      ask: colorAsk,
    });
    let z = id, first = true, target = null, prio = 0;
    const pick = (node, p) => { if (p > prio) { target = node; prio = p; } };
    for (;;) {
      const p = parentOf(t, z);
      const caseAsk = (key) => ({ tag: 'case', kind: 'choice', q: first ? `${what} 以后，属于哪种情况？` : `${K(z)} 当成新结点往上看，属于哪种情况？`, choices: RB_CHOICES, answer: RB[key] });
      if (p === null) {
        const ask = caseAsk('root');
        if (t.nodes[z].red) {
          t.nodes[z].red = false;
          // 错法 rootred：忘了把根染黑（树照对的走，只是这一次报出来的根是红的）
          if (live && mistake === 'rootred') { row.leftRed = true; }
        }
        push({ view: snap({ hl: { [z]: 'sv-cur' }, fresh: [z] }), msg: `${K(z)} 是根：染黑（根结点是黑的）。`, ask });
        break;
      }
      if (!t.nodes[p].red) {
        push({ view: snap({ hl: { [z]: 'sv-cur', [p]: 'sv-cmp' }, note: { [z]: '新', [p]: '父' } }), msg: `${K(z)} 的父结点 ${K(p)} 是黑的：没有红红相连，不用调。`, ask: caseAsk('black') });
        break;
      }
      const g = parentOf(t, p);
      if (g === null) {
        // 只在错法那一遍里会有（根是红的）：没有爷爷，停下
        push({ view: snap({ hl: { [z]: 'sv-cur' } }), msg: `父结点 ${K(p)} 是红的根。` });
        break;
      }
      const u = t.nodes[g].left === p ? t.nodes[g].right : t.nodes[g].left;
      const note = { [z]: '新', [p]: '父', [g]: '爷', ...(u !== null ? { [u]: '叔' } : {}) };
      const type = (t.nodes[g].left === p ? 'L' : 'R') + (t.nodes[p].left === z ? 'L' : 'R');
      const conflict = `${K(z)} 和父结点 ${K(p)} 都是红的（红红相连）`;
      if (red(u) && !(live && mistake === 'redrotate')) {
        t.nodes[p].red = false;
        t.nodes[u].red = false;
        t.nodes[g].red = true;
        row.acts.push('变色');
        pick(g, 1);
        push({ view: snap({ hl: { [g]: 'sv-cur' }, note, fresh: [p, u, g] }), msg: `${conflict}，叔叔 ${K(u)} 也是红的：叔父爷变色——${K(p)}、${K(u)} 染黑，${K(g)} 染红；${K(g)} 当成新插入的结点，接着往上看。`, ask: caseAsk('red') });
        z = g;
        first = false;
        continue;
      }
      const ask = caseAsk(type);
      if (red(u)) flag(ask); // 错法 redrotate：叔叔是红的也去旋转
      row.acts.push(type);
      const uncle = u === null ? '叔叔是空的（空结点算黑）' : `叔叔 ${K(u)} 是黑的`;
      if (type === 'LL' || type === 'RR') {
        const dir = type === 'LL' ? 'right' : 'left';
        rotate(t, g, dir);
        t.nodes[p].red = false;
        t.nodes[g].red = true;
        pick(p, 2);
        push({ view: snap({ hl: { [p]: 'sv-done', [g]: 'sv-cmp' }, note, fresh: [p, g] }), msg: `${conflict}，${uncle}。${type} 型：以爷爷 ${K(g)} 为中心${W[dir]}旋，${K(p)} 转上来；父爷换色——${K(p)} 染黑，${K(g)} 染红。调整完了。`, ask });
      } else {
        const d1 = type === 'LR' ? 'left' : 'right', d2 = type === 'LR' ? 'right' : 'left';
        rotate(t, p, d1);
        push({ view: snap({ hl: { [z]: 'sv-cur', [p]: 'sv-cmp' }, note, fresh: [z, p] }), msg: `${conflict}，${uncle}。${type} 型，转两次：先以父结点 ${K(p)} 为中心${W[d1]}旋，${K(z)} 转上来。`, ask });
        rotate(t, g, d2);
        t.nodes[z].red = false;
        t.nodes[g].red = true;
        pick(z, 3);
        push({ view: snap({ hl: { [z]: 'sv-done', [g]: 'sv-cmp' }, note, fresh: [z, g] }), msg: `再以爷爷 ${K(g)} 为中心${W[d2]}旋，${K(z)} 当这棵子树的根；儿爷换色——${K(z)} 染黑，${K(g)} 染红。调整完了。` });
      }
      break;
    }
    // 颜色题问这一次变得最多的结点：双旋的那个儿子 > 单旋的父结点 > 变色的爷爷 > 新结点自己
    const tg = target ?? id;
    const leftRed = row.leftRed && tg === t.root;
    colorAsk.q = `${what}、调整完以后，${K(tg)} 是什么颜色？`;
    colorAsk.answer = t.nodes[tg].red || leftRed ? '红' : '黑';
    if (leftRed) flag(colorAsk);
    row.root = K(t.root);
    row.reds = redKeys(row.leftRed);
    if (live) log.push(row);
  }

  for (const it of items) { if (ops.length) insert(it); }
  live = true;
  const startTree = copyTree(t);
  const all = (leftRed) => `红结点：${redKeys(leftRed).join('、') || '（没有）'}`;
  if (!ops.length) {
    push({ view: snap(), msg: `依次插入 ${items.map((x) => x.text).join('、')}，建一棵红黑树。新结点先染红；父结点黑就不用调；父红叔红：叔父爷变色，爷爷当新结点往上看；父红叔黑：按 LL / RR / LR / RL 旋转、换色。` });
    for (const it of items) { opNo++; insert(it); }
  } else {
    push({ view: snap(), msg: `这是依次插入 ${items.map((x) => x.text).join('、')} 建成的红黑树。` });
    for (const o of ops) { opNo++; insert(o.item); }
  }
  const leftRed = !!log[log.length - 1]?.leftRed;
  push({ view: snap({ chips: [['根', K(t.root)], ['黑高', blackHeight(t)]] }), msg: `插完了。根 ${K(t.root)} 是黑的，${all(false)}；没有红红相连，从根到每个空叶结点的路上黑结点一样多。` });
  if (mistake) keepMisAsks(steps, firstMis, RB_DIVERGE[mistake]);
  return { steps, log, final: copyTree(t), start: startTree, leftRed, misApplied: misCount > 0 || log.some((r) => r.leftRed) };
}

// 王道：结点的黑高是从它出发（不含它）到空叶结点的路上黑结点的个数（空叶结点算黑）；根是黑的，所以就是这条路上黑的内部结点数
function blackHeight(t) {
  let h = 0;
  for (let id = t.root; id !== null; id = t.nodes[id].left) if (!t.nodes[id].red) h++;
  return h;
}

function rbtView(s) {
  return drawTree(s.tree, { cls: s.cls, edge: s.edge, note: s.note, fresh: s.fresh }) + chips(s.chips || []);
}
const rbClsOf = (t) => Object.fromEntries(Object.keys(t.nodes).map((id) => [id, t.nodes[id].red ? 'sv-rb-red' : 'sv-rb-black']));

function rbtQuiz(input, r) {
  const keys = input.items.map((x) => x.text).join('、');
  const did = input.ops.map((o) => o.item.text).join('、');
  const w = input.quizWalk;
  const reds = Object.keys(r.final.nodes).filter((id) => r.final.nodes[id].red || (r.leftRed && id === r.final.root)).map((id) => r.final.nodes[id].item).sort(cmp).map((x) => x.text);
  const blacks = Object.keys(r.final.nodes).filter((id) => !reds.includes(r.final.nodes[id].key)).map((id) => r.final.nodes[id].item).sort(cmp).map((x) => x.text);
  const ask = w === 'red' ? '写出红色的结点（从小到大）' : w === 'black' ? '写出黑色的结点（从小到大）' : `写出这棵树的${WALKS[w]}序列`;
  return {
    q: did ? `下面是依次插入 ${keys} 建成的红黑树。再依次插入 ${did} 以后，${ask}。` : `依次插入 ${keys}，建一棵红黑树。${ask}。`,
    qhtml: did ? treeSvg(r.start, { pick: () => '', cls: rbClsOf(r.start) }) : '',
    type: 'seq',
    answer: (w === 'red' ? reds : w === 'black' ? blacks : walkKeys(r.final, w)).join(' ') || '无',
  };
}
function rbtTable(input, r) {
  const did = input.ops.map((o) => o.item.text).join('、');
  const rows = r.log.map((row) => ({
    label: row.label,
    cells: [
      { v: row.acts.length ? [row.acts.join(' '), row.acts.map((a) => (a === '变色' ? '叔红' : a)).join(' '), row.acts.map((a) => (a === '变色' ? '染色' : `${a}型`)).join(' ')] : NONE, vec: true },
      { v: row.root },
      { v: row.reds.length ? row.reds.join(' ') : NONE, vec: true },
    ],
  }));
  return {
    q: `${did ? `在下面这棵红黑树上依次插入 ${did}` : `依次插入 ${input.items.map((x) => x.text).join('、')} 建一棵红黑树`}。每插一个写出：做了哪些调整（叔叔红写「变色」，叔叔黑写 LL / RR / LR / RL，几次就按先后写几个，用空格隔开；不用调就空着）、整棵树的根、所有红结点（从小到大）。`,
    qhtml: did ? treeSvg(r.start, { pick: () => '', cls: rbClsOf(r.start) }) : '',
    dir: 'row', head: ['调整', '树根', '红结点'], rows,
  };
}
function rbtVariants(input) {
  const out = [];
  const tryV = (mistake, label) => { const v = { ...input, mistake }; try { if (rbtRun(v).misApplied) out.push({ label, input: v }); } catch { /* 这组数上这种错法走不下去 */ } };
  tryV('redrotate', '像是叔叔是红的也去旋转了（王道：叔叔红只变色——父、叔染黑，爷爷染红，爷爷当新结点往上看；叔叔黑才旋转）');
  tryV('rootred', '像是忘了把根染黑（王道：根结点是黑的——新结点当根、或者变色变到了根，都要把根染黑）');
  return out;
}

export const rbtEngine = {
  name: 'rbt', title: '红黑树',
  parse: parseRbt, run: rbtRun, view: rbtView, quiz: rbtQuiz, table: rbtTable, variants: rbtVariants,
};
