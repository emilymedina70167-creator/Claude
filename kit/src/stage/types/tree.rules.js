// 树（平衡二叉树）的规则（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 1 节）：从现在的样子算正确的下一步、
// 判一下像哪种错、挑战用的判断式、写给老师的事实、手势表，和 engines/balanced.js 的平衡二叉树引擎对拍。
// 纯函数，有测试（tests/stage-tree-rules.test.js）；在 types/index.js 里登记。
//
// 课本（王道）的做法：插入以后从新结点往上，第一个平衡因子绝对值超过 1 的是最小不平衡子树的根，
// 按 LL / RR / LR / RL 转；LR、RL 是两下（先在孩子那里转，再在根那里转）。学生一次转一下，所以下一步只给第一下，
// 转完再算一次就是第二下。
// 只看「最深的失衡结点」会绕圈：LR 型的新结点在孙子的左子树里时，先在孩子那里左旋以后孙子自己也失衡了（+2），
// 照最深的去转它，就把刚才那一下转回去了（RL 反过来一样）。所以几个失衡的结点各按自己的型试转一遍，
// 挑转完剩下的失衡结点最少的；一样少挑最深的——刚插完时就是课本的那一个。学生走偏几下以后也这样接着算。
// 离平衡很远的树（老师用二叉排序树的插法造的一条长链）照这样转还是可能绕回去：先照着往下试转，
// 会回到转过的样子就改成一层一层摆（shapeStep），摆法本身一定走得完；只有往上转一层会压过 8 层时那一下照课本转
// （量过几千棵到 8 层、31 个结点的随机二叉排序树，都不绕圈、每一下都转得了）。
import { imbalance, levelOrder, heightOf, depths, cmpValues, bfOf, bfText, snapshot, rotStruct, descend, traversal, treePath, MAX_DEPTH, MAX_NODES } from './tree.js';
import { avlEngine } from '../../engines/balanced.js';
import { levelOrder as engineOrder } from '../../engines/treeview.js';

const ZH = { left: '左', right: '右' };
const turn = (dir) => `${ZH[dir]}旋`;
const DIRS = { left: 'left', right: 'right' };
const KINDS = ['LL', 'RR', 'LR', 'RL'];
const DOUBLE = { LR: true, RL: true };
const READ_BACK = { LR: 'RL', RL: 'LR' }; // 从下往上读出来的型
const SETTLE_STEPS = 64; // 照课本的转法往下试转几下（31 个结点以内转平用不了这么多）

const nodeAt = (o, k) => o.nodes.find((n) => n.key === k) || null;
const parentOf = (o, k) => o.nodes.find((n) => n.left === k || n.right === k) || null;
// 话里怎么叫一个结点：值（值重复的带上 #编号，和 tree.js 的 shown 一样）
const nameOf = (o, k) => { const n = nodeAt(o, k); return !n ? `#${k}` : n.dup ? `${n.value}（#${n.key}）` : n.value; };
const unbalanced = (s) => s.nodes.filter((n) => Math.abs(bfOf(s, n.key)) >= 2).map((n) => n.key);
const isAvl = (o) => unbalanced(o).length === 0;
const sigOf = (s) => `${s.root}|${s.nodes.map((n) => `${n.key}:${n.left ?? ''},${n.right ?? ''}`).sort().join(';')}`;

// 一个失衡结点的型（王道：左边高、左孩子不右高是 LL……和 tree.js 的 imbalance 一样）和要转的几下 [[在哪个结点, 往哪边]]
const kindAt = (s, z) => { const n = nodeAt(s, z); return bfOf(s, z) > 0 ? (bfOf(s, n.left) >= 0 ? 'LL' : 'LR') : (bfOf(s, n.right) <= 0 ? 'RR' : 'RL'); };
function stepsOf(s, z, kind) {
  const n = nodeAt(s, z);
  if (!n) return null;
  if (kind === 'LL') return [[z, 'right']];
  if (kind === 'RR') return [[z, 'left']];
  if (kind === 'LR') return n.left == null ? null : [[n.left, 'left'], [z, 'right']];
  return n.right == null ? null : [[n.right, 'right'], [z, 'left']];
}
// 右旋是左孩子转上来，左旋是右孩子转上来
const upOf = (s, k, dir) => nodeAt(s, k)?.[dir === 'right' ? 'left' : 'right'] ?? null;
/** 照这几下转一遍（只动结构，不改树）；转不了的给 { fail: 第几下 }，中间哪一下超过 8 层（tree.js 的 rotate 不让做）给 deep */
function turned(o, steps) {
  const s = snapshot(o);
  let deep = false;
  for (const [i, [k, dir]] of steps.entries()) {
    if (upOf(s, k, dir) == null) return { fail: i, s, deep };
    rotStruct(s, k, dir);
    if (Math.max(0, ...depths(s).values()) >= MAX_DEPTH) deep = true;
  }
  return { s, deep };
}

/** 课本的转法：{ root, kind, steps, left（转完还剩几个失衡）, deepest（是不是最小不平衡子树）, bad（失衡的结点，深的在前）} | null（都平衡） */
function fixPlan(o) {
  const bad = unbalanced(o);
  if (!bad.length) return null;
  const d = depths(o);
  bad.sort((a, b) => d.get(b) - d.get(a));
  let best = null;
  for (const z of bad) {
    const kind = kindAt(o, z);
    const steps = stepsOf(o, z, kind);
    const r = turned(o, steps);
    // 在最深的那个转不会让它那棵子树变高（孩子都平衡），一定转得了；别的转完超过 8 层的不要
    const left = r.fail != null || r.deep ? Infinity : unbalanced(r.s).length;
    if (!best || left < best.left) best = { root: z, kind, steps, left };
  }
  return { ...best, deepest: best.root === bad[0], bad };
}

// 照课本的转法一下一下转下去，转得平、不绕回转过的样子
function settles(o) {
  const s = snapshot(o);
  const seen = new Set();
  for (let i = 0; i < SETTLE_STEPS; i++) {
    const p = fixPlan(s);
    if (!p) return true;
    const sig = sigOf(s);
    if (seen.has(sig)) return false;
    seen.add(sig);
    rotStruct(s, ...p.steps[0]);
  }
  return false;
}

// 一层一层摆（中序不变）：每棵子树的根该是它中间的那个（两个中间的，现在的根是其中一个就留着），从上往下找第一处不对的，
// 把该在那里的结点往上转一层。摆好的上面几层不再动，该在那里的结点每一下近一层，一定走得完；摆完每个结点左右差不过一个，是平衡的
function shapeStep(o) {
  const ins = traversal(o, o.root, 'in').order;
  const go = (k, lo, hi) => {
    if (k == null || lo > hi) return null;
    const mids = [(lo + hi) >> 1, (lo + hi + 1) >> 1];
    const i = ins.indexOf(k);
    const m = mids.includes(i) ? i : mids[0];
    const want = ins[m];
    if (want !== k) {
      const p = parentOf(o, want);
      return { at: p.key, dir: p.left === want ? 'right' : 'left', root: k, want };
    }
    const n = nodeAt(o, k);
    return go(n.left, lo, m - 1) || go(n.right, m + 1, hi);
  };
  return go(o.root, 0, ins.length - 1);
}

/** 现在该怎么转（null 是都平衡了）：{ fix: 课本的转法, first } 或 { shape: 一层一层摆的这一下, first }；first 是 [在哪个结点, 往哪边] */
function plan(o) {
  const p = fixPlan(o);
  if (!p) return null;
  if (settles(o)) return { fix: p, first: p.steps[0] };
  const sh = shapeStep(o);
  // 往上转一层会把旁边的结点压过 8 层（老师造的很深的树）：这一下先照课本转，树先矮下来
  if (turned(o, [[sh.at, sh.dir]]).deep) return { fix: p, first: p.steps[0] };
  return { shape: sh, bad: p.bad, first: [sh.at, sh.dir] };
}

// —— 下一步 ——

const procOf = (o, p) => (p.steps.length === 2
  ? `先在 ${nameOf(o, p.steps[0][0])} ${turn(p.steps[0][1])}，再在 ${nameOf(o, p.root)} ${turn(p.steps[1][1])}`
  : `在 ${nameOf(o, p.root)} ${turn(p.steps[0][1])}`);
const shapeProc = (o, sh) => `以 ${nameOf(o, sh.root)} 为根的这棵子树，根该是中间的 ${nameOf(o, sh.want)}：在 ${nameOf(o, sh.at)} ${turn(sh.dir)}，把 ${nameOf(o, sh.want)} 往上转一层`;
function planWhy(o, pl) {
  if (pl.shape) return `离平衡还远（${pl.bad.map((k) => nameOf(o, k)).join('、')} 都失衡），照课本的转法会转回去，一层一层摆：${shapeProc(o, pl.shape)}`;
  const p = pl.fix;
  return p.deepest
    ? `最小不平衡子树的根是 ${nameOf(o, p.root)}，${p.kind} 型：${procOf(o, p)}`
    : `${p.bad.map((k) => nameOf(o, k)).join('、')} 都失衡；按 ${nameOf(o, p.root)} 的 ${p.kind} 型转${p.left === 0 ? '能一起转平' : ''}：${procOf(o, p)}`;
}
const landing = (o, v) => { const d = descend(o, v); return d.parent == null ? `树是空的，${v} 当根` : `从根比下去，落在 ${nameOf(o, d.parent)} 的${ZH[d.side]}边`; };
// 托盘里下一个能插的（已经在树里的插不了，跳过）
const nextTray = (o) => (o.tray || []).find((v) => descend(o, v).found == null) ?? null;

function rotateAct(pl) {
  const [at, dir] = pl.first;
  return pl.fix ? { type: 'rotate', at, dir, kind: pl.fix.kind, root: pl.fix.root } : { type: 'rotate', at, dir };
}

function next(o) {
  const pl = plan(o);
  if (pl) return { acts: [rotateAct(pl)], why: planWhy(o, pl) };
  const v = nextTray(o);
  if (v != null) return { acts: [{ type: 'insert', value: v }], why: `托盘里下一个是 ${v}：${landing(o, v)}` };
  return null;
}

/** check 的 next：「现在正确的是……」（裁判拼「你在 50 右旋，现在正确的是先在 30 左旋（…）」） */
function nowRight(o, pl = plan(o)) {
  if (pl?.shape) return { why: `在 ${nameOf(o, pl.first[0])} ${turn(pl.first[1])}（一层一层摆：${nameOf(o, pl.shape.want)} 该是以 ${nameOf(o, pl.shape.root)} 为根的这棵子树的根）`, acts: [rotateAct(pl)] };
  if (pl) {
    const p = pl.fix;
    const [at, dir] = pl.first;
    const tag = p.deepest ? `最小不平衡子树的根是 ${nameOf(o, p.root)}，${p.kind} 型` : `${p.kind} 型`;
    return { why: `${p.steps.length === 2 ? '先' : ''}在 ${nameOf(o, at)} ${turn(dir)}（${tag}）`, acts: [rotateAct(pl)] };
  }
  const nx = next(o);
  if (nx) return { why: `插入 ${nx.acts[0].value}（${landing(o, nx.acts[0].value)}）`, acts: nx.acts };
  return { why: '已经平衡了，不用再动', acts: [] };
}

// —— 判一下 ——

// 一次转一下（dir）或老师一行写整个型（kind：rotate t.50 LR）。写了 dir 就是一下（next 给的那一下也带着 kind，只是说明）
const rotWay = (act) => { const dir = DIRS[act.dir] || null; return { dir, kind: !dir && KINDS.includes(act.kind) ? act.kind : null }; };
function checkRotate(o, act) {
  const z = act.at;
  const { dir, kind } = rotWay(act);
  const pl = plan(o);
  const now = () => nowRight(o, pl);
  if (!nodeAt(o, z)) return { legal: false, right: false, misread: null, why: `树里没有 #${z} 这个结点`, next: now() };
  if (!kind && !dir) return { legal: false, right: false, misread: null, why: 'rotate 要写往哪边转（left / right）或者哪一型（LL / RR / LR / RL）', next: now() };
  const why = kind ? `${nameOf(o, z)} 做 ${kind} 型调整` : `${nameOf(o, z)} ${turn(dir)}`;
  const steps = kind ? stepsOf(o, z, kind) : [[z, dir]];
  // 这个世界的物理：转不了（没有那一边的孩子）、转完太深放不下
  let cant = null;
  if (!steps) cant = `${kind} 型要 ${nameOf(o, z)} 有${kind === 'LR' ? '左' : '右'}孩子`;
  else {
    const r = turned(o, steps);
    if (r.fail != null) {
      const [k, d] = steps[r.fail];
      cant = `${nameOf(o, k)} 没有${ZH[d === 'right' ? 'left' : 'right']}孩子，${turn(d)}转不了（${d === 'right' ? '右旋是左孩子转上来' : '左旋是右孩子转上来'}）`;
    } else if (Math.max(0, ...depths(r.s).values()) >= MAX_DEPTH) cant = `转完树超过 ${MAX_DEPTH} 层，放不下`;
  }
  // 一层一层摆的时候（离平衡还远）只认那一下，不套课本的错法
  let right = false;
  if (pl?.fix) right = kind ? z === pl.fix.root && kind === pl.fix.kind : z === pl.first[0] && dir === pl.first[1];
  else if (pl) right = !kind && z === pl.first[0] && dir === pl.first[1];
  const misread = () => (!pl ? '树已经平衡了，不用转' : pl.fix ? misreadOf(o, pl.fix, z, dir, kind) : null);
  if (cant) return { legal: false, right: false, misread: misread(), why: cant, next: now() };
  if (right) return { legal: true, right: true, misread: null, why, next: null };
  return { legal: true, right: false, misread: misread(), why, next: now() };
}

// 不是正确的那一下：像哪种错（docs/superpowers/plans/2026-11-06-stage-base.md 第 5 个任务的表；认不出来的给 null）
function misreadOf(o, p, at, dir, kind) {
  const z = p.root, K = p.kind, zN = nameOf(o, z);
  const fin = K[0] === 'L' ? 'right' : 'left'; // 在根那里那一下：左边高右旋，右边高左旋
  const readBack = () => `型从下往上读了：从 ${zN} 往下看是 ${K} 型（${procOf(o, p)}），像是读成了 ${READ_BACK[K]}`;
  const twoSteps = () => `只看了离新结点最近的两步，当成 ${K[0]}${K[0]} 型一下转了：${K} 型要${procOf(o, p)}`;
  const nameAsDir = () => `把型的名字当成了转的方向：${K} 型是${ZH[K[0] === 'L' ? 'left' : 'right']}边高了，要${procOf(o, p)}`;
  if (at === z) {
    if (kind) {
      if (DOUBLE[K] && kind === READ_BACK[K]) return readBack();
      if (DOUBLE[K] && kind === `${K[0]}${K[0]}`) return twoSteps();
      if (!DOUBLE[K] && !DOUBLE[kind] && kind !== K) return nameAsDir();
    } else if (DOUBLE[K]) return dir === fin ? twoSteps() : readBack();
    else return nameAsDir();
  }
  // 照读反的型先转孩子（LR 读成 RL：在左孩子那里右旋）
  if (!kind && DOUBLE[K] && at === p.steps[0][0] && dir !== p.steps[0][1]) return readBack();
  const d = depths(o);
  if (at !== z && p.bad.includes(at) && d.get(at) < d.get(z)) return `修了离根近的那个，不是最小不平衡子树（该转的是 ${zN}，${K} 型）`;
  return null;
}

// insert { value, parent?, side? }：没给位置时页面从根比下去落；给了位置（学生自己摆）和二叉排序树该落的地方比
function checkInsert(o, act) {
  const v = act.value == null ? '' : String(act.value);
  const at = act.parent != null;
  const why = at ? `${v} 放在 ${nameOf(o, act.parent)} 的${ZH[act.side] || ''}边` : `插入 ${v}`;
  const no = (w) => ({ legal: false, right: false, misread: null, why: w, next: nowRight(o) });
  if (!v || v === '_') return no('插入要写一个数');
  const d = descend(o, v);
  if (d.found != null) return no(`${v} 已经在树里了（二叉排序树里不放一样的值）`);
  if (o.nodes.length >= MAX_NODES) return no(`一棵树最多 ${MAX_NODES} 个结点`);
  if (at) {
    const p = nodeAt(o, act.parent);
    if (!p) return no(`树里没有 #${act.parent} 这个结点`);
    if (!DIRS[act.side]) return no('要写放在左边还是右边');
    if (p[act.side] != null) return no(`${nameOf(o, p.key)} 的${ZH[act.side]}边已经有 ${nameOf(o, p[act.side])} 了`);
    if (depths(o).get(p.key) + 1 >= MAX_DEPTH) return no(`树最多 ${MAX_DEPTH} 层，再长就放不下了`);
  } else if (d.path.length >= MAX_DEPTH) return no(`树最多 ${MAX_DEPTH} 层，再长就放不下了`);
  const pl = plan(o);
  const wrong = (misread) => ({ legal: true, right: false, misread, why, next: nowRight(o, pl) });
  // 正确的下一步是转（还失衡）时插数不对；托盘按顺序插（平衡二叉树插的先后不同，长出来的树不同）
  if (pl) return wrong(`还没转平就插了下一个数：${planWhy(o, pl)}`);
  if (at && (d.parent !== act.parent || d.side !== act.side)) {
    return wrong(`这里不是二叉排序树里 ${v} 该在的位置（${d.parent == null ? '树是空的，该当根' : `该在 ${nameOf(o, d.parent)} 的${ZH[d.side]}边`}）`);
  }
  const first = nextTray(o);
  if (first != null && first !== v && o.tray.includes(v)) return wrong(`托盘里的数按顺序插：该先插 ${first}`);
  return { legal: true, right: true, misread: null, why, next: null };
}

function check(o, act) {
  if (act?.type === 'rotate') return checkRotate(o, act);
  if (act?.type === 'insert') return checkInsert(o, act);
  return { legal: true, right: null }; // 别的动作（换值、删……）不判
}

// —— 写给老师的事实 ——

function rotateFacts(before, after, act) {
  const way = rotWay(act);
  const steps = way.kind ? stepsOf(before, act.at, way.kind) : way.dir ? [[act.at, way.dir]] : null;
  if (!steps) return [];
  const out = [];
  const s = snapshot(before);
  for (const [k, dir] of steps) {
    const up = upOf(s, k, dir);
    if (up == null) return out;
    const moved = nodeAt(s, up)[dir]; // 转上来的那个结点里侧的子树：改挂到降下去的那个下面
    rotStruct(s, k, dir);
    out.push(`${nameOf(before, k)} ${turn(dir)}：${nameOf(before, up)} 转上来，${nameOf(before, k)} 降下去当 ${nameOf(before, up)} 的${ZH[dir]}孩子`
      + (moved != null ? `；${nameOf(before, moved)} 那棵子树从 ${nameOf(before, up)} 下面改挂到 ${nameOf(before, k)} 的${ZH[dir === 'right' ? 'left' : 'right']}边` : ''));
  }
  if (after.root !== before.root && after.root != null) out.push(`${nameOf(after, after.root)} 成了整棵树的根`);
  const bad = unbalanced(after);
  out.push(bad.length ? `还失衡：${bad.map((k) => `${nameOf(after, k)}（${bfText(bfOf(after, k))}）`).join('、')}` : '现在每个结点都平衡了');
  return out;
}

function insertFacts(before, after, act) {
  const had = new Set(before.nodes.map((n) => n.key));
  const fresh = after.nodes.find((n) => !had.has(n.key));
  if (!fresh) return [];
  const path = treePath(after, after.root, fresh.key).slice(0, -1);
  const out = [path.length
    ? `插入 ${fresh.value}：${path.map((k) => nameOf(after, k)).join(' → ')}，落在 ${nameOf(after, path.at(-1))} 的${ZH[nodeAt(after, path.at(-1)).left === fresh.key ? 'left' : 'right']}边`
    : `插入 ${fresh.value}：树是空的，${fresh.value} 当根`];
  const bad = imbalance(after);
  if (bad) out.push(`插完失衡：最小不平衡子树的根是 ${nameOf(after, bad.key)}（${bfText(bad.bf)}），${bad.kind} 型`);
  return out;
}

function facts(before, after, act) {
  if (!before || !after) return [];
  if (act?.type === 'rotate') return rotateFacts(before, after, act);
  if (act?.type === 'insert') return insertFacts(before, after, act);
  return [];
}

// —— 手势表（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）——

/** 一个动作 → 学生那一行镜头指令（结点用 #编号：跟着结点走，值重复也指得清） */
export function actSrc(o, act) {
  if (act.type === 'rotate') { const w = rotWay(act); return `rotate ${o.id}#${act.at} ${w.dir || w.kind}`; }
  if (act.type === 'insert') return act.parent != null ? `insert ${o.id}#${act.parent} ${act.side} ${act.value}` : `insert ${o.id} ${act.value}`;
  throw new Error(`树没有「${act.type}」这个动作`);
}
const made = (o, act) => ({ act, src: actSrc(o, act) });
const trayValue = (value) => (value == null || value === '' ? null : String(value));

const gestures = {
  // 结点拖到它的父亲上：在父亲那里转，拖的结点转上来——左孩子转上来是右旋，右孩子转上来是左旋
  rotate: {
    gesture: 'drop-on', from: 'node', to: 'parent',
    toAct(o, { from, to } = {}) {
      const p = to?.key != null ? nodeAt(o, to.key) : null;
      if (from?.key == null || !p) return { error: '把一个结点拖到它的父亲上，就是在父亲那里转' };
      if (p.left !== from.key && p.right !== from.key) return { error: `${nameOf(o, from.key)} 不是 ${nameOf(o, p.key)} 的孩子：拖到它的父亲上才是旋转` };
      return made(o, { type: 'rotate', at: p.key, dir: p.left === from.key ? 'right' : 'left' });
    },
  },
  // 托盘的数拖进树：页面从根比下去落
  insert: {
    gesture: 'drop-at', from: 'tray', to: 'tree',
    toAct(o, { value } = {}) {
      const v = trayValue(value);
      return v == null ? { error: '要拖一个数进树' } : made(o, { type: 'insert', value: v });
    },
  },
  // 托盘的数拖到某个空位（open t place）：学生自己摆
  place: {
    gesture: 'drop-at', from: 'tray', to: 'slot',
    toAct(o, { value, to } = {}) {
      const v = trayValue(value);
      if (v == null) return { error: '要拖一个数到空位上' };
      const slot = to?.slot;
      if (!slot || slot.parent == null) return o.root == null ? made(o, { type: 'insert', value: v }) : { error: '要拖到某个结点下面的空位上' };
      const p = nodeAt(o, slot.parent);
      if (!p || !DIRS[slot.side]) return { error: '要拖到某个结点下面的空位上' };
      if (p[slot.side] != null) return { error: `${nameOf(o, p.key)} 的${ZH[slot.side]}边已经有结点了` };
      return made(o, { type: 'insert', value: v, parent: p.key, side: slot.side });
    },
  },
};

// —— 挑战用的判断式（when="t avl, t bst, t height=4"）——

const predicates = {
  avl: (o) => isAvl(o),
  // 中序递增（一样大的算递增：49′ 和 49 比起来一样大）
  bst: (o) => {
    const vs = traversal(o, o.root, 'in').order.map((k) => nodeAt(o, k).value);
    return vs.every((v, i) => !i || cmpValues(vs[i - 1], v) <= 0);
  },
  height: (o, [h] = []) => {
    if (!/^\d+$/.test(String(h ?? ''))) throw new Error('height 要写树有几层：t height=4');
    return heightOf(o, o.root) === Number(h);
  },
};

// —— 整段标准过程：借 engines/balanced.js ——

/**
 * 从现在的样子把托盘里的数依次插完：引擎的每一步、每插一个转了哪几下、最后的层序、常见错法。
 * 引擎从一棵平衡的二叉排序树起步（把现在的树按层序悄悄插一遍，平衡的树这样插回来还是它）：
 * 现在还失衡、不是二叉排序树、托盘空的、数和字混着，引擎接不住，给 null
 */
function standard(o) {
  const tray = o.tray || [];
  if (!tray.length || !isAvl(o) || !predicates.bst(o)) return null;
  const vals = levelOrder(o).map((n) => n.value);
  const fields = vals.length ? { avl: vals.join(' '), ops: tray.map((v) => `insert ${v}`).join(', ') } : { avl: tray.join(' ') };
  let input, run;
  try {
    input = avlEngine.parse(fields);
    run = avlEngine.run(input);
  } catch {
    return null;
  }
  const keys = (t) => engineOrder(t).map((id) => t.nodes[id].key);
  if (vals.length && keys(run.start).join(' ') !== vals.join(' ')) return null;
  const rotations = run.log.flatMap((row) => row.zs.map((z, i) => ({ op: row.label, root: z, kind: row.types[i] })));
  return { input, steps: run.steps, log: run.log, rotations, final: keys(run.final), variants: avlEngine.variants(input) };
}

export const treeRules = { next, check, predicates, facts, gestures, standard };
