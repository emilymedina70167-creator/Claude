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
import { imbalance, levelOrder, heightOf, depths, bfOf, bfText, snapshot, rotStruct, descend, traversal, treePath, MAX_DEPTH, MAX_NODES, rotKind, SIDES, isBst } from './tree.js';
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

// 照课本的转法一下一下转下去，转得平、不绕回转过的样子（avoid：也不许回到这个样子——试一下别的转法时，不许绕回转之前）
function settles(o, avoid = null) {
  const s = snapshot(o);
  const seen = new Set(avoid ? [avoid] : []);
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

// 走偏以后挑的不一定是最小不平衡子树（最深的那个）：学生照王道转最深的那个，只要转完照着往下转得平、不绕回转之前，也算对。
// LR 转完第一下孙子自己 +2 的时候，照课本转它就是转回去，这里排除掉
function textbookAlt(o, first, bad) {
  const z = bad[0];
  const kind = kindAt(o, z);
  const steps = stepsOf(o, z, kind);
  if (steps[0][0] === first[0] && steps[0][1] === first[1]) return null;
  const r = turned(o, [steps[0]]);
  if (r.fail != null || r.deep || !settles(r.s, sigOf(o))) return null;
  return { root: z, kind, steps, first: steps[0] };
}

/**
 * 现在该怎么转（null 是都平衡了）：{ fix: 课本的转法 } 或 { shape: 一层一层摆的这一下 }，
 * first 是 [在哪个结点, 往哪边]；alt 是另一个也算对的（照课本转最小不平衡子树），没有是 null
 */
function plan(o) {
  const p = fixPlan(o);
  if (!p) return null;
  const pick = () => {
    if (settles(o)) return { fix: p, first: p.steps[0] };
    const sh = shapeStep(o);
    // 往上转一层会把旁边的结点压过 8 层（老师造的很深的树）：这一下先照课本转，树先矮下来
    if (turned(o, [[sh.at, sh.dir]]).deep) return { fix: p, first: p.steps[0] };
    return { shape: sh, first: [sh.at, sh.dir] };
  };
  const pl = { ...pick(), bad: p.bad };
  pl.alt = textbookAlt(o, pl.first, p.bad);
  return pl;
}

// —— 下一步 ——

const procOf = (o, p) => (p.steps.length === 2
  ? `先在 ${nameOf(o, p.steps[0][0])} ${turn(p.steps[0][1])}，再在 ${nameOf(o, p.root)} ${turn(p.steps[1][1])}`
  : `在 ${nameOf(o, p.root)} ${turn(p.steps[0][1])}`);
const shapeProc = (o, sh) => `以 ${nameOf(o, sh.root)} 为根的这棵子树，根该是中间的 ${nameOf(o, sh.want)}：在 ${nameOf(o, sh.at)} ${turn(sh.dir)}，把 ${nameOf(o, sh.want)} 往上转一层`;
const altWhy = (o, a) => `照课本先转最小不平衡子树 ${nameOf(o, a.root)}（${a.kind} 型：${procOf(o, a)}）也行`;
function planWhy(o, pl) {
  const also = pl.alt ? `；${altWhy(o, pl.alt)}` : '';
  if (pl.shape) return `离平衡还远（${pl.bad.map((k) => nameOf(o, k)).join('、')} 都失衡），照课本的转法会转回去，一层一层摆：${shapeProc(o, pl.shape)}${also}`;
  const p = pl.fix;
  return p.deepest
    ? `最小不平衡子树的根是 ${nameOf(o, p.root)}，${p.kind} 型：${procOf(o, p)}`
    : `${p.bad.map((k) => nameOf(o, k)).join('、')} 都失衡；按 ${nameOf(o, p.root)} 的 ${p.kind} 型转${p.left === 0 ? '能一起转平' : ''}：${procOf(o, p)}${also}`;
}
const landing = (o, v) => { const d = descend(o, v); return d.parent == null ? `树是空的，${v} 当根` : `从根比下去，落在 ${nameOf(o, d.parent)} 的${ZH[d.side]}边`; };
// 托盘里下一个能插的（已经在树里的插不了，跳过）
const nextTray = (o) => (o.tray || []).find((v) => descend(o, v).found == null) ?? null;

// 可接受的几下：先是页面挑的那一下，再是照课本转最小不平衡子树（走偏以后才可能不一样）
function rotateActs(pl) {
  const [at, dir] = pl.first;
  const out = [pl.fix ? { type: 'rotate', at, dir, kind: pl.fix.kind, root: pl.fix.root } : { type: 'rotate', at, dir }];
  if (pl.alt) out.push({ type: 'rotate', at: pl.alt.first[0], dir: pl.alt.first[1], kind: pl.alt.kind, root: pl.alt.root });
  return out;
}

// scene：这棵树在哪个舞台上。二叉排序树的插入课（交给学生 insert / place、没交 rotate）树本来就可以不平衡：不排旋转，
// 下一步只看托盘，托盘插完了就是做完（和 checkInsert 的口径一样）。不给 scene、没交给学生插的，照旧按平衡二叉树算
const bstLesson = (o, scene) => !!scene?.opens && !scene.opens.has(`${o.id}:rotate`) && (scene.opens.has(`${o.id}:insert`) || scene.opens.has(`${o.id}:place`));
function next(o, scene) {
  const avl = !bstLesson(o, scene);
  const pl = avl ? plan(o) : null;
  if (pl) return { acts: rotateActs(pl), why: planWhy(o, pl) };
  const v = nextTray(o);
  if (v != null) return { acts: [{ type: 'insert', value: v }], why: `托盘里下一个是 ${v}：${landing(o, v)}` };
  return null;
}

/** check 的 next：「现在正确的是……」（裁判拼「你在 50 右旋，现在正确的是先在 30 左旋（…）」） */
function nowRight(o, pl = plan(o)) {
  const also = pl?.alt ? `；${altWhy(o, pl.alt)}` : '';
  if (pl?.shape) return { why: `在 ${nameOf(o, pl.first[0])} ${turn(pl.first[1])}（一层一层摆：${nameOf(o, pl.shape.want)} 该是以 ${nameOf(o, pl.shape.root)} 为根的这棵子树的根）${also}`, acts: rotateActs(pl) };
  if (pl) {
    const p = pl.fix;
    const [at, dir] = pl.first;
    const tag = p.deepest ? `最小不平衡子树的根是 ${nameOf(o, p.root)}，${p.kind} 型` : `${p.kind} 型`;
    return { why: `${p.steps.length === 2 ? '先' : ''}在 ${nameOf(o, at)} ${turn(dir)}（${tag}）${also}`, acts: rotateActs(pl) };
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
  // next 给的哪一下都算对（页面挑的那一下、照课本转最小不平衡子树）；老师写整个型时比根和型。
  // 一层一层摆的时候（离平衡还远）不套课本的错法
  const same = (f) => z === f[0] && dir === f[1];
  const sameKind = (q) => !!q && z === q.root && kind === q.kind;
  let right = false;
  if (pl) right = kind ? sameKind(pl.fix) || sameKind(pl.alt) : same(pl.first) || (!!pl.alt && same(pl.alt.first));
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

// insert { value, parent?, side? }：没给位置时页面从根比下去落；给了位置（学生自己摆）和二叉排序树该落的地方比。
// 「还没转平就插」只在平衡二叉树的课上算错（这棵树 open 了 rotate）；二叉排序树的插入课上树本来就可以不平衡。
// 学生往空位上摆（open t place，ctx.open）只看摆完还是不是二叉排序树：不按托盘的先后、不管转没转平（第三次量 D2 第 5 幕：
// 摆调完的树时 34 当根是对的，以前照托盘的先后说「该先插 15」、淡淡圈了 34）。挑战（w avl）照老师写的判；托盘的先后只管拖进树（insert）
function checkInsert(o, act, scene, ctx = {}) {
  const placing = ctx?.open === 'place';
  const v = act.value == null ? '' : String(act.value);
  const at = act.parent != null;
  const why = at ? `${v} 放在 ${nameOf(o, act.parent)} 的${ZH[act.side] || ''}边` : `插入 ${v}`;
  const pl = !placing && scene?.opens?.has(`${o.id}:rotate`) ? plan(o) : null;
  // 现在正确的是：平衡二叉树的课上还失衡就是转；不然是插托盘里下一个（没有托盘就是这个数）落在哪
  const now = () => {
    if (pl) return nowRight(o, pl);
    const nv = nextTray(o) ?? (descend(o, v).found == null ? v : null);
    return nv == null ? { why: '已经插完了', acts: [] } : { why: `插入 ${nv}（${landing(o, nv)}）`, acts: [{ type: 'insert', value: nv }] };
  };
  const no = (w) => ({ legal: false, right: false, misread: null, why: w, next: now() });
  if (!v || v === '_') return no('插入要写一个数');
  // 这棵树现在不是二叉排序树（堆、随手摆的二叉树）时，学生往空位上放没有「排序树里该在的位置」可比：不判对错，只说放在了哪
  // （主线第一轮 D4-1：堆里把 63 放到第 9 个位置是对的，以前照排序树说「不是正确的下一步」、wrong=mark 还把它圈出来）。
  // 只有根、根加左孩子的树还是排序树，照旧判
  const loose = at && !isBst(o);
  const d = descend(o, v);
  if (!loose && d.found != null) return no(`${v} 已经在树里了（二叉排序树里不放一样的值）`);
  if (o.nodes.length >= MAX_NODES) return no(`一棵树最多 ${MAX_NODES} 个结点`);
  if (at) {
    const p = nodeAt(o, act.parent);
    if (!p) return no(`树里没有 #${act.parent} 这个结点`);
    if (!DIRS[act.side]) return no('要写放在左边还是右边');
    if (p[act.side] != null) return no(`${nameOf(o, p.key)} 的${ZH[act.side]}边已经有 ${nameOf(o, p[act.side])} 了`);
    if (depths(o).get(p.key) + 1 >= MAX_DEPTH) return no(`树最多 ${MAX_DEPTH} 层，再长就放不下了`);
  } else if (d.path.length >= MAX_DEPTH) return no(`树最多 ${MAX_DEPTH} 层，再长就放不下了`);
  if (loose) return { legal: true, right: null, misread: null, why: `${why}；这棵不是二叉排序树，页面没判这一下对不对`, next: null };
  const wrong = (misread) => ({ legal: true, right: false, misread, why, next: now() });
  // 平衡二叉树的课上正确的下一步是转（还失衡）时插数不对；托盘按顺序插（插的先后不同，长出来的树不同）
  if (pl) return wrong(`还没转平就插了下一个数：${planWhy(o, pl)}`);
  if (at && (d.parent !== act.parent || d.side !== act.side)) {
    return wrong(`这里不是二叉排序树里 ${v} 该在的位置（${d.parent == null ? '树是空的，该当根' : `该在 ${nameOf(o, d.parent)} 的${ZH[d.side]}边`}）`);
  }
  const first = placing ? null : nextTray(o);
  if (first != null && first !== v && o.tray.includes(v)) return wrong(`托盘里的数按顺序插：该先插 ${first}`);
  return { legal: true, right: true, misread: null, why, next: null };
}

// delete { at, by? }：摘叶子（open t pluck）、点哪个删哪个（open t delete）不判对错，只说删了哪个、谁顶上来（第三次量 D2 第 6 幕、
// 分支 3：以前叫老师那一条里只有光秃秃的「学生 delete s#7」）。删完的样子在 facts 里写
function checkDelete(o, act, ctx = {}) {
  const n = nodeAt(o, act.at);
  if (!n) return { legal: true, right: null }; // 没有这个结点：树自己的指令会把错说清楚
  const name = nameOf(o, n.key);
  if (n.left == null && n.right == null) return { legal: true, right: null, misread: null, why: `${ctx?.open === 'pluck' ? '摘了叶子' : '删了叶子'} ${name}`, next: null };
  if (n.left == null || n.right == null) return { legal: true, right: null, misread: null, why: `删了 ${name}（只有一个孩子：${nameOf(o, n.left ?? n.right)} 顶上来）`, next: null };
  // 两个孩子：中序后继（by=pred 是前驱）的值顶上来，和 tree.js 的 delete 一样走
  const pred = act.by === 'pred';
  let k = pred ? n.left : n.right;
  for (let m = nodeAt(o, k); m && (pred ? m.right : m.left) != null; m = nodeAt(o, k)) k = pred ? m.right : m.left;
  return { legal: true, right: null, misread: null, why: `删了 ${name}（两个孩子：中序${pred ? '前驱' : '后继'} ${nameOf(o, k)} 的值顶上来）`, next: null };
}

function check(o, act, scene, ctx) {
  if (act?.type === 'rotate') return checkRotate(o, act);
  if (act?.type === 'insert') return checkInsert(o, act, scene, ctx);
  if (act?.type === 'delete') return checkDelete(o, act, ctx);
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
  out.push(sizeFact(after));
  return out;
}
// 插、转以后树多大（页面数的，老师不用自己数）
const sizeFact = (o) => `现在 ${levelOrder(o).length} 个结点、${heightOf(o, o.root)} 层`;

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
  out.push(sizeFact(after));
  return out;
}

// 删完的样子：失衡了写最小不平衡子树的根和型（摘叶子摘到根红了，老师要知道），再写几个结点、几层
function deleteFacts(before, after) {
  if (after.nodes.length >= before.nodes.length) return [];
  const out = [];
  const bad = imbalance(after);
  if (bad) out.push(`删完失衡：最小不平衡子树的根是 ${nameOf(after, bad.key)}（${bfText(bad.bf)}），${bad.kind} 型`);
  out.push(sizeFact(after));
  return out;
}

function facts(before, after, act) {
  if (!before || !after) return [];
  if (act?.type === 'rotate') return rotateFacts(before, after, act);
  if (act?.type === 'insert') return insertFacts(before, after, act);
  if (act?.type === 'delete') return deleteFacts(before, after);
  return [];
}

/**
 * 这一下改了哪些结点（ask pick 交了以后和真变了的比，rules.js 的 changedKeys）：前后都在、平衡因子 / 父亲 / 哪一边 / 第几层 / 值
 * 变了的（层序）。新长出来的不算——问的是「已经在树上的哪几个会变」；转一下整棵挪了层的都算变了
 */
function changed(before, after) {
  if (!before || !after) return [];
  const had = new Map(before.nodes.map((n) => [n.key, n]));
  const d0 = depths(before), d1 = depths(after);
  const up = (s, k) => { const p = parentOf(s, k); return p ? `${p.key}${p.left === k ? 'L' : 'R'}` : ''; };
  return levelOrder(after).filter((n) => {
    const m = had.get(n.key);
    return !!m && (m.value !== n.value || bfOf(before, n.key) !== bfOf(after, n.key) || up(before, n.key) !== up(after, n.key) || d0.get(n.key) !== d1.get(n.key));
  }).map((n) => n.key);
}

// —— 手势表（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）——

/** 一个动作 → 学生那一行镜头指令（结点用 #编号：跟着结点走，值重复也指得清） */
export function actSrc(o, act) {
  if (act.type === 'rotate') { const w = rotWay(act); return `rotate ${o.id}#${act.at} ${w.dir || w.kind}`; }
  if (act.type === 'insert') return act.parent != null ? `insert ${o.id}#${act.parent} ${act.side} ${act.value}` : `insert ${o.id} ${act.value}`;
  throw new Error(`树没有「${act.type}」这个动作`);
}
const made = (o, act) => ({ act, src: actSrc(o, act) });

/**
 * 一行镜头指令 → check 认的动作（actSrc 倒过来）：rotate t#3 right / rotate t.50 LR、insert t 35 / insert t.70 left 65。
 * 别的指令（换值、删、遍历……）不判，给 null；写得读不懂的也给 null（树自己的指令会把错说清楚）
 */
function lineAct(o, c, h) {
  const own = (w) => String(w).match(/^[A-Za-z_]\w*/)?.[0] === o.id;
  const refs = h.refsIn().filter(own);
  const rest = h.words.filter((w) => !h.scene.isRef(w));
  if (c.cmd === 'rotate') {
    const ps = refs.filter((r) => r !== o.id).flatMap((r) => h.scene.parts(r));
    const k = rotKind(rest[0]);
    if (ps.length !== 1 || !k) return null;
    return k === 'left' || k === 'right' ? { type: 'rotate', at: ps[0].key, dir: k } : { type: 'rotate', at: ps[0].key, kind: k };
  }
  if (c.cmd === 'insert') {
    const side = rest.find((w) => SIDES[w]);
    const vals = rest.filter((w) => !SIDES[w]);
    const value = vals.length === 1 ? vals[0] : vals.length ? null : h.str;
    if (value == null || !refs.length) return null;
    if (refs[0] === o.id) return side ? null : { type: 'insert', value: String(value) };
    const ps = h.scene.parts(refs[0]);
    if (ps.length !== 1 || !side) return null;
    return { type: 'insert', value: String(value), parent: ps[0].key, side: SIDES[side] };
  }
  // delete t.30 / delete t#7（by=pred 用前驱）：不判对错，只写删了哪个（checkDelete）
  if (c.cmd === 'delete') {
    if (refs.length !== 1 || refs[0] === o.id) return null;
    const ps = h.scene.parts(refs[0]);
    if (ps.length !== 1) return null;
    return { type: 'delete', at: ps[0].key, ...(h.opts.by === 'pred' ? { by: 'pred' } : {}) };
  }
  return null;
}

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
  // 点一片叶子摘下来（open t pluck）：只摘叶子是这个动作本身的意思，点里面的结点晃一下（要删里面的，老师开 delete）。
  // 写 t#k：跟着结点走（值重复也指得准）
  pluck: {
    gesture: 'tap', on: 'node',
    toAct(o, { from } = {}) {
      const n = from?.key != null ? nodeAt(o, from.key) : null;
      if (!n) return { error: '点一片叶子，把它摘下来' };
      if (n.left != null || n.right != null) return { error: `只能摘叶子（${nameOf(o, n.key)} 下面还有结点）` };
      return { act: { type: 'delete', at: n.key }, src: `delete ${o.id}#${n.key}` };
    },
  },
  // 点哪个删哪个（open t delete）：二叉排序树的删法（tree.js 的 delete：叶子拿掉、一个孩子顶上、两个孩子用中序后继顶上）。
  // 写法和老师写的一样（delete t.30；值重复的写 t#k）
  delete: {
    gesture: 'tap', on: 'node',
    toAct(o, { from } = {}) {
      const n = from?.key != null ? nodeAt(o, from.key) : null;
      if (!n) return { error: '点一个结点，把它删掉' };
      return { act: { type: 'delete', at: n.key }, src: `delete ${n.dup ? `${o.id}#${n.key}` : `${o.id}.${n.value}`}` };
    },
  },
  // 托盘的数拖到某个空位（open t place）：学生自己摆。交的是 insert（makes：学生手上还有没有事看下一步做不做得了，events.js 的 undoneOf）
  place: {
    gesture: 'drop-at', from: 'tray', to: 'slot', makes: 'insert',
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

// —— 量（count(t)、height(t.50)、tray(t)；rules.js 的 measures）——
// 写部件（t.50、t.50*）是以它为根的那棵子树：height(t.107) 是那棵子树几层、count(t.107) 是那棵子树几个结点
const rootsOf = (o, parts) => parts.map((p) => p.key);
const measures = {
  count: (o, parts) => (parts ? new Set(rootsOf(o, parts).flatMap((k) => levelOrder(o, k).map((n) => n.key))).size : levelOrder(o).length),
  height: (o, parts) => (parts ? Math.max(0, ...rootsOf(o, parts).map((k) => heightOf(o, k))) : heightOf(o, o.root)),
  // 托盘是整棵树的：写部件的没有这个量
  tray: Object.assign((o, parts) => (parts ? undefined : (o.tray || []).length), { none: '托盘是整棵树的，写树的名字' }),
};

// —— 挑战用的判断式（when="t avl, t bst, t height=4"）——

const predicates = {
  avl: (o) => isAvl(o),
  bst: (o) => isBst(o),
  // 带数字的旧写法照旧认，里面用量算（和 height(t) = 4 是同一个数）
  height: (o, [h] = []) => {
    if (!/^\d+$/.test(String(h ?? ''))) throw new Error('height 要写树有几层：t height=4');
    return measures.height(o, null) === Number(h);
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
  if (!tray.length || !isAvl(o) || !isBst(o)) return null;
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

// 转、插的每一下都判；做完了（平衡了、托盘也插完了；只交了插入的课是托盘插完了）只对交给了学生转、插的树算
/**
 * 平了的树，学生开着的动作还能不能把它改回没平（@t.done 写在平了的树上，删完再修平时演：第三次量 D2/分支 3）：
 * 开着删、摘（delete / pluck），或者开着插（insert / place）、托盘里还有没插的数
 */
function reopen(o, scene) {
  const on = (a) => !!scene?.opens?.has(`${o.id}:${a}`);
  if (on('delete') || on('pluck')) return true;
  return (on('insert') || on('place')) && (o.tray || []).some((v) => descend(o, v).found == null);
}

export const treeRules = { next, check, predicates, measures, facts, changed, gestures, standard, reopen, actOf: lineAct, judges: ['rotate', 'insert', 'place'], doneBy: ['rotate', 'insert', 'place'] };
