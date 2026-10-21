// 树、森林 ↔ 二叉树（组件 forest）：左孩子右兄弟（王道 5.4.2）。
//   正着：每个结点的左指针指向它的第一个孩子，右指针指向它右边相邻的兄弟；森林里各棵树的根也看成兄弟。
//     王道的画法：① 兄弟之间加一条线；② 每个结点只留和第一个孩子的连线，别的抹掉；③ 以第一棵树的根为轴顺时针转 45°。
//   反过来（back: true，或者直接写 binary:）：左孩子是第一个孩子，右孩子是右边的兄弟；根的右链断开就是各棵树。
// 演示按先序一个结点一个结点地接上（森林的先序 = 二叉树的先序），两张图并排：一张拆、一张长。
// 纯函数，不碰 DOM（tests/trees2-engine.test.js）。画法在 forestview.js。
import { parseTree } from './tree.js';
import { treesSvg, forestLayout, forestEdges, binLayout, binEdges, parseForest, panels, binOrder, walkOf, WALK_NAME, BOOL } from './forestview.js';
import { chips } from './arrayview.js';

// —— 写法：内部一律用结点名当 id（两张图里同一个结点对得上）——

function forestByKey(f) {
  const K = (id) => f.nodes[id].key;
  const nodes = {};
  for (const [id, n] of Object.entries(f.nodes)) nodes[K(id)] = { key: K(id), kids: n.kids.map(K) };
  return { roots: f.roots.map(K), nodes };
}
function binByKey(t) {
  const K = (id) => (id === null ? null : t.nodes[id].key);
  const nodes = {};
  for (const [id, n] of Object.entries(t.nodes)) nodes[K(id)] = { key: K(id), left: K(n.left), right: K(n.right) };
  return { root: K(t.root), nodes };
}

/** 森林 → 二叉树。mistake：'mirror'（第一个孩子放到右边、兄弟放到左边）、'reverse'（最右边的孩子当成第一个） */
export function toBinary(F, mistake) {
  const nodes = {};
  for (const k of Object.keys(F.nodes)) nodes[k] = { key: k, left: null, right: null };
  // 一串兄弟（或各棵树的根）：一个接一个挂成右孩子，每个的孩子里第一个挂成左孩子
  const kidsOf = (k) => (mistake === 'reverse' ? F.nodes[k].kids.slice().reverse() : F.nodes[k].kids);
  const link = (xs) => {
    xs.forEach((k, i) => {
      const nx = xs[i + 1] ?? null;
      if (mistake === 'mirror') nodes[k].left = nx; else nodes[k].right = nx;
      const kids = kidsOf(k);
      if (kids.length) { if (mistake === 'mirror') nodes[k].right = kids[0]; else nodes[k].left = kids[0]; link(kids); }
    });
  };
  link(F.roots);
  return { root: F.roots[0], nodes };
}

/** 二叉树 → 森林。mistake：'mirror'（右孩子当第一个孩子、左孩子当兄弟）、'keep'（右孩子也当成孩子，没还原成兄弟） */
export function toForest(B, mistake) {
  const nodes = {};
  for (const k of Object.keys(B.nodes)) nodes[k] = { key: k, kids: [] };
  if (mistake === 'keep') {
    for (const [k, n] of Object.entries(B.nodes)) nodes[k].kids = [n.left, n.right].filter((x) => x !== null);
    return { roots: [B.root], nodes };
  }
  const first = (k) => (mistake === 'mirror' ? B.nodes[k].right : B.nodes[k].left);
  const next = (k) => (mistake === 'mirror' ? B.nodes[k].left : B.nodes[k].right);
  const chain = (k) => { const out = []; for (let x = k; x !== null; x = next(x)) out.push(x); return out; };
  for (const k of Object.keys(B.nodes)) nodes[k].kids = first(k) === null ? [] : chain(first(k));
  return { roots: chain(B.root), nodes };
}

export function parse(fields) {
  const back = BOOL.test(String(fields.back ?? ''));
  let F, B;
  if (fields.binary !== undefined && String(fields.binary).trim() !== '') {
    if (fields.forest !== undefined && String(fields.forest).trim() !== '') throw new Error('forest: 和 binary: 只写一个（binary: 就是从二叉树还原成森林）');
    B = binByKey(parseTree(fields.binary));
    if (Object.keys(B.nodes).length > 24) throw new Error('binary: 结点最多 24 个');
    F = toForest(B);
  } else {
    if (fields.forest === undefined) throw new Error('forest 要写 forest:（如 A(B, C, D) E(F, G)：括号里是孩子，几棵树并排写），或者 binary:（二叉树，写法同 tree，还原成森林）');
    F = forestByKey(parseForest(fields.forest, 'forest'));
    B = toBinary(F);
  }
  const dir = fields.binary !== undefined && String(fields.binary).trim() !== '' ? 'back' : back ? 'back' : 'to';
  const quizWalk = walkOf(fields.quiz, dir === 'to' ? 'post' : 'level');
  return { dir, F, B, quizWalk };
}

// 森林的先序（先根）、后根（森林的中序）、层序（一棵树一棵树地写）
export function forestOrder(F, walk) {
  const out = [];
  if (walk === 'level') {
    for (const r of F.roots) { const q = [r]; while (q.length) { const k = q.shift(); out.push(k); q.push(...F.nodes[k].kids); } }
    return out;
  }
  const w = (k) => { if (walk === 'pre') out.push(k); F.nodes[k].kids.forEach(w); if (walk !== 'pre') out.push(k); };
  F.roots.forEach(w);
  return out;
}

// 森林里每个结点的双亲（根是 null）
const parentsOf = (F) => { const p = Object.fromEntries(Object.keys(F.nodes).map((k) => [k, null])); for (const [k, n] of Object.entries(F.nodes)) for (const c of n.kids) p[c] = k; return p; };
// 二叉树里每个结点的双亲和左右
const binParents = (B) => { const p = {}; for (const [k, n] of Object.entries(B.nodes)) { if (n.left) p[n.left] = [k, '左']; if (n.right) p[n.right] = [k, '右']; } return p; };

export function run(input) {
  const { dir, F, B } = input;
  // 错法：正着转用错了规则，就是另一棵二叉树；反过来还原错了，就是另一片森林（只拿来比答案）
  const Bx = dir === 'to' && input.mistake ? toBinary(F, input.mistake) : B;
  const Fx = dir === 'back' && input.mistake ? toForest(B, input.mistake) : F;
  const steps = [];
  const pre = forestOrder(F, 'pre');
  const fp = parentsOf(F), bp = binParents(B);
  const isTree = F.roots.length === 1;
  const word = isTree ? '树' : '森林';
  const placed = [];
  const sibs = [], cut = [];
  const snap = (extra = {}) => ({ placed: placed.slice(), sibs: sibs.slice(), cut: cut.slice(), ...extra });
  // 选项：对的、几种错法的答案、和真双亲有关的说法；按字排好，对的不总在第一个
  // 错法给出的答案太少时，拿前面已经接上的结点凑到 3 个
  const choicesOf = (right, wrongs, pad = []) => { const set = [...new Set([right, ...wrongs.filter(Boolean)])].slice(0, 4); for (const x of pad) if (set.length < 3 && !set.includes(x)) set.push(x); return set.sort((a, b) => a.localeCompare(b, 'zh')); };
  const leftSib = (k) => { const p = fp[k]; const list = p === null ? F.roots : F.nodes[p].kids; const i = list.indexOf(k); return i > 0 ? list[i - 1] : null; };
  if (dir === 'to') {
    steps.push({ view: snap(), msg: `${word}转成二叉树（左孩子右兄弟）：每个结点的左指针指向它的第一个孩子，右指针指向它右边相邻的兄弟${isTree ? '' : '；各棵树的根也看成兄弟'}。王道的画法：① 兄弟之间加一条线；② 每个结点只留和第一个孩子的连线，别的抹掉；③ 以${isTree ? '根' : '第一棵树的根'}为轴顺时针转 45°。下面按先序一个个接。` });
    const mirror = toBinary(F, 'mirror'), rev = toBinary(F, 'reverse');
    const sideOf = (T, k) => { const p = binParents(T)[k]; return p ? `${p[0]} 的${p[1]}孩子` : '根'; };
    for (const k of pre) {
      placed.push(k);
      const p = fp[k];
      const s = leftSib(k);
      if (p === null && s === null) { steps.push({ view: snap({ cur: k, fresh: [k] }), msg: `${k} 是${isTree ? '树' : '第一棵树'}的根，也是二叉树的根。` }); continue; }
      const right = sideOf(Bx, k);
      let msg;
      if (s === null) msg = `${k} 是 ${p} 的第一个孩子 → 二叉树里 ${k} 是 ${p} 的左孩子（${p}–${k} 这条线留着）。`;
      else {
        sibs.push([s, k]);
        if (p !== null) cut.push(k);
        msg = p === null ? `${k} 是第 ${F.roots.indexOf(k) + 1} 棵树的根，和前一棵树的根 ${s} 看成兄弟 → ${k} 是 ${s} 的右孩子（两个根之间加一条线）。` : `${k} 是 ${s} 右边的兄弟 → 二叉树里 ${k} 是 ${s} 的右孩子（${s}–${k} 加一条线，${p}–${k} 这条线抹掉）。`;
      }
      const wrongs = [sideOf(mirror, k), sideOf(rev, k), p !== null ? `${p} 的左孩子` : '', s !== null ? `${s} 的左孩子` : p !== null ? `${p} 的右孩子` : ''];
      steps.push({ view: snap({ cur: k, fresh: [k] }), msg, ask: { tag: 'parent', kind: 'choice', q: `${k} 在二叉树里是谁的什么孩子？`, choices: choicesOf(right, wrongs.filter((x) => x !== '根'), placed.slice(0, -1).reverse().map((x) => `${x} 的右孩子`)), answer: right } });
    }
  } else {
    steps.push({ view: snap({ fullB: true }), msg: `二叉树还原成${word}：左孩子是第一个孩子，右孩子是右边相邻的兄弟。根的右链（根、根的右孩子、右孩子的右孩子……）上的是各棵树的根：把右链断开，就是${word}。下面按先序一个个还原。` });
    const fxp = parentsOf(Fx);
    const mirror = parentsOf(toForest(B, 'mirror')), keep = parentsOf(toForest(B, 'keep'));
    const ROOT = '没有：它是一棵树的根';
    const say = (p) => (p === null ? ROOT : p);
    for (const k of binOrder(B, 'pre')) {
      placed.push(k);
      const b = bp[k];
      if (!b) { steps.push({ view: snap({ cur: k, fresh: [k], fullB: true }), msg: `二叉树的根 ${k} 是第一棵树的根。` }); continue; }
      const [p, side] = b;
      let msg;
      if (side === '左') msg = `${k} 是 ${p} 的左孩子 → ${word}里 ${k} 是 ${p} 的第一个孩子。`;
      else {
        sibs.push([p, k]);
        msg = fp[k] === null ? `${k} 是 ${p} 的右孩子，${p} 是一棵树的根 → ${k} 是下一棵树的根（把这段右链断开）。` : `${k} 是 ${p} 的右孩子 → ${k} 是 ${p} 右边的兄弟，双亲都是 ${fp[k]}：${k} 接在 ${fp[k]} 下面、${p} 的右边。`;
      }
      const right = say(fxp[k]);
      steps.push({ view: snap({ cur: k, fresh: [k], fullB: true, bcur: k }), msg, ask: { tag: 'parent', kind: 'choice', q: `${k} 在${word}里的双亲是谁？`, choices: choicesOf(right, [say(fp[k]), say(mirror[k]), say(keep[k]), p, ROOT], [...placed.slice(0, -1).reverse(), ...binOrder(B, 'pre').filter((x) => x !== k)]), answer: right } });
    }
  }
  const tp = forestOrder(F, 'pre').join(' '), tpost = forestOrder(F, 'post').join(' ');
  const leavesF = Object.values(F.nodes).filter((n) => !n.kids.length).length;
  const noLeft = Object.values(B.nodes).filter((n) => n.left === null).length;
  steps.push({ view: snap({ done: true, fullB: dir === 'back' }), msg: `${dir === 'to' ? '二叉树接好了' : `${word}还原好了`}。遍历对上了：${isTree ? '树的先根' : '森林的先序'} ${tp} = 二叉树的先序；${isTree ? '树的后根' : '森林的中序（依次后根遍历每棵树）'} ${tpost} = 二叉树的中序。${word}里的叶子（${leavesF} 个）= 二叉树里左指针空着的结点数。` });
  return { steps, B: Bx, F: Fx };
}

// —— 画 ——

export function view(s, input) {
  const { F, B, dir } = input;
  const pre = forestOrder(F, 'pre');
  const cmdOf = (k) => pre.indexOf(k) + 1;
  const placed = new Set(s.placed);
  const fcls = {}, bcls = {};
  for (const k of placed) { fcls[k] = 'sv-done'; bcls[k] = 'sv-done'; }
  if (s.cur) { fcls[s.cur] = 'sv-cur'; bcls[s.cur] = 'sv-cur'; }
  // 二叉树里右孩子的边是「兄弟」那条线变的：换个颜色
  const bedge = {};
  for (const n of Object.values(B.nodes)) if (n.right) bedge[n.right] = 'sv-edge-sib';
  const fedge = {};
  for (const k of s.cut) fedge[k] = 'sv-edge-cut';
  const sibs = s.sibs.map(([a, b]) => [a, b, '']);
  const showF = dir === 'to' || s.done ? null : placed;
  const showB = dir === 'back' ? null : placed;
  const fsvg = treesSvg({ nodes: F.nodes, pos: forestLayout(F, { gap: 0.6 }), edges: forestEdges(F) }, { show: showF, cls: dir === 'to' ? fcls : (s.done ? {} : fcls), edge: dir === 'to' ? fedge : {}, sibs: dir === 'to' ? sibs : [], fresh: dir === 'back' ? s.fresh || [] : [], prefix: 'ff', aria: F.roots.length === 1 ? '树' : '森林', pick: (k) => k, cmd: cmdOf, gapX: 52 });
  const bsvg = treesSvg({ nodes: B.nodes, pos: binLayout(B), edges: binEdges(B) }, { show: showB, cls: dir === 'back' ? (s.done ? {} : bcls) : bcls, edge: bedge, fresh: dir === 'to' ? s.fresh || [] : [], prefix: 'fb', aria: '二叉树', pick: (k) => k, cmd: cmdOf, gapX: 42 });
  const word = F.roots.length === 1 ? '树' : '森林';
  const list = dir === 'to' ? [[word, fsvg], ['二叉树（左孩子右兄弟）', bsvg]] : [['二叉树', bsvg], [word, fsvg]];
  const legend = '<div class="sv-fo-legend muted"><span class="sv-fo-key sv-fo-child"></span>孩子（左）<span class="sv-fo-key sv-fo-sib"></span>兄弟（右）</div>';
  const pairs = s.done ? [['先序', binOrder(B, 'pre').join(' ')], ['中序', binOrder(B, 'in').join(' ')]] : [];
  return panels(list) + legend + chips(pairs);
}

// —— 考卷 ——

export function quiz(input, r) {
  const word = input.F.roots.length === 1 ? '树' : '森林';
  if (input.dir === 'to') return { q: `把这个${word}转成二叉树（左孩子右兄弟），写出二叉树的${WALK_NAME[input.quizWalk]}序列。`, qhtml: treesSvg({ nodes: input.F.nodes, pos: forestLayout(input.F), edges: forestEdges(input.F) }, { prefix: 'fq', pick: () => '' }), type: 'seq', answer: binOrder(r.B, input.quizWalk).join(' ') };
  const w = input.quizWalk === 'in' ? 'post' : input.quizWalk;
  const name = { pre: '先序（先根）', post: '后根（森林的中序）', level: '层序（一棵树写完再写下一棵，每棵一层一层从左往右）' }[w];
  return { q: `把这棵二叉树还原成森林（左孩子是第一个孩子，右孩子是右兄弟），写出森林的${name}序列。`, qhtml: treesSvg({ nodes: input.B.nodes, pos: binLayout(input.B), edges: binEdges(input.B) }, { prefix: 'fq', pick: () => '' }), type: 'seq', answer: forestOrder(r.F, w).join(' ') };
}

export function table(input, r) {
  if (input.dir === 'to') {
    const bp = binParents(r.B);
    const rows = forestOrder(input.F, 'pre').filter((k) => k !== input.F.roots[0]).map((k) => ({ label: k, cells: [{ v: bp[k]?.[0] ?? '' }, { v: bp[k] ? (bp[k][1] === '左' ? ['左', '左孩子', 'L'] : ['右', '右孩子', 'R']) : '' }] }));
    return { q: '把它转成二叉树（左孩子右兄弟）：写出每个结点在二叉树里的双亲、是左孩子还是右孩子。', qhtml: treesSvg({ nodes: input.F.nodes, pos: forestLayout(input.F), edges: forestEdges(input.F) }, { prefix: 'fq', pick: () => '' }), dir: 'row', head: ['双亲', '左 / 右'], rows };
  }
  const fp = parentsOf(r.F);
  const rows = binOrder(input.B, 'pre').map((k) => ({ label: k, cells: [{ v: fp[k] === null ? ['', '无', '根', '没有'] : fp[k] }] }));
  return { q: '把这棵二叉树还原成森林：写出每个结点在森林里的双亲（是一棵树的根就空着）。', qhtml: treesSvg({ nodes: input.B.nodes, pos: binLayout(input.B), edges: binEdges(input.B) }, { prefix: 'fq', pick: () => '' }), dir: 'row', head: ['森林里的双亲'], rows };
}

// 常见错法（只给老师看）：结果和对的一样的不列
export function variants(input) {
  const shapeB = (T) => JSON.stringify(Object.entries(T.nodes).sort().map(([k, n]) => [k, n.left, n.right]));
  const shapeF = (G) => JSON.stringify([G.roots, Object.entries(G.nodes).sort().map(([k, n]) => [k, n.kids])]);
  const out = [];
  if (input.dir === 'to') {
    const right = shapeB(input.B);
    const add = (m, label) => { if (shapeB(toBinary(input.F, m)) !== right) out.push({ label, input: { ...input, mistake: m } }); };
    add('mirror', '像是第一个孩子放到了右边、兄弟放到了左边（王道：左孩子右兄弟——左指针指第一个孩子，右指针指右边的兄弟）');
    add('reverse', '像是把最右边的孩子当成了第一个孩子（孩子从左往右数，最左边的那个才是第一个）');
  } else {
    const right = shapeF(input.F);
    const add = (m, label) => { if (shapeF(toForest(input.B, m)) !== right) out.push({ label, input: { ...input, mistake: m } }); };
    // keep 放前面：右孩子的双亲两种错法答案一样，更常见的是这一种
    add('keep', '像是右孩子也当成了孩子，没还原成兄弟（二叉树里的右孩子是森林里右边的兄弟，双亲和它左边那个一样）');
    add('mirror', '像是把右孩子当成了第一个孩子、左孩子当成了兄弟（左孩子右兄弟：左孩子才是第一个孩子）');
  }
  return out;
}

export const forestEngine = { name: 'forest', title: '树、森林与二叉树', parse, run, view, quiz, table, variants };
