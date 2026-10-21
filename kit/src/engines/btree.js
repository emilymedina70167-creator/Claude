// B 树、B+ 树的演示引擎（组件 btree），m 阶（order: 3）：
//   btree: 关键字…     依次插入：落到终端结点按大小放进去；满了（m 个关键字）从第 ⌈m/2⌉ 个分开，
//                      这个关键字上移到父结点，父结点满了接着分裂，根分裂树就高一层
//   ops: delete 30     王道的删除：终端结点里够（≥ ⌈m/2⌉ − 1）就直接删；不够先向兄弟借（父子换位，先看右兄弟）；
//                      兄弟都借不到就合并（先看左兄弟），父结点少了一个可能接着借、合并；
//                      不在终端结点的，用前驱（左边子树最右下的，replace: succ 改用后继）替代，转成删终端结点
//   nodes: [30]([10 20], [40 50])   直接给一棵 B 树（题目里画好的那棵），再做 ops
//   plus: true         B+ 树插入（王道的定义：结点里关键字和子树一样多，最多 m 个；分支结点里是每棵子树最大的关键字；
//                      叶结点从左到右链起来）。叶结点满了（m + 1 个）分成前 ⌈(m+1)/2⌉ 个和后面的，父结点添一个关键字
// 纯函数，不碰 DOM（tests/trees-engine.test.js）。画法也在这里：一个结点是一排格子的框，孩子连在格子的缝上（B+ 树连在格子下面）。
import { parseKeys, parseOps, cmp } from './balanced.js';
import { chips, esc } from './arrayview.js';

const MAX_KEYS = 40;
const W = { left: '左', right: '右' };
const BOOL = /^(true|yes|on|1|是)$/i;
const isNum = (t) => /^-?\d+(\.\d+)?$/.test(t);
const NONE = ['', '无', '-', '—', '不用', '没有'];
const SPLIT = ['要分裂', '不用分裂'];
const CASES = { direct: '直接删（关键字够）', borrow: '兄弟够借：父子换位', merge: '兄弟不够借：合并', replace: '不在终端结点：用前驱 / 后继替代' };
const CASE_CHOICES = Object.values(CASES);
// 填表「怎么调」一格的几种叫法（按位置换，不交叉组合）
const ACT_NAMES = { 分裂: ['分裂', '分裂', '分裂'], 替代: ['替代', '前驱替代', '后继替代'], 直接删: ['直接删', '直接删除', '直接'], 借: ['借', '向兄弟借', '兄弟够借'], 合并: ['合并', '兄弟不够借', '合并'] };
// 会走岔的错法（树从此不一样）只留第一次犯错那个操作里的先猜；不走岔的每一处都留
const DIVERGE = { cap: true, mid: true, borrow: true, minright: false };

// —— 写法 ——

function orderOf(src) {
  if (src === undefined || String(src).trim() === '') return 3;
  const m = Number(String(src).trim());
  if (!Number.isInteger(m) || m < 3 || m > 9) throw new Error(`order: 写 B 树的阶 m，3 到 9 的整数（现在是「${src}」）`);
  return m;
}

/** 直接给一棵 B 树：[30]([10 20], [40 50])——每个结点一对方括号，孩子按从左到右写在后面的圆括号里。不合 B 树定义的报出来 */
export function parseNodes(src, m) {
  const s = String(src ?? '').trim();
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const bad = (why) => new Error(`nodes: ${why}。写法：每个结点 [10 20]，孩子按从左到右写在后面的圆括号里，如 [30]([10 20], [40 50])`);
  const node = () => {
    ws();
    if (s[i] !== '[' && s[i] !== '【') throw bad(`「${s.slice(i, i + 8) || '（结尾）'}」这里应该是一个结点 [ … ]`);
    const j = s.slice(i).search(/[\]】]/);
    if (j < 0) throw bad('少了「]」');
    const toks = s.slice(i + 1, i + j).split(/[\s,，、]+/).filter(Boolean);
    i += j + 1;
    ws();
    const kids = [];
    if (s[i] === '(' || s[i] === '（') {
      i++;
      for (;;) {
        kids.push(node());
        ws();
        if (s[i] === ',' || s[i] === '，') { i++; continue; }
        if (s[i] === ')' || s[i] === '）') { i++; break; }
        throw bad(`「${s.slice(i, i + 8) || '（结尾）'}」这里应该是「,」或「)」`);
      }
    }
    return { toks, kids };
  };
  const top = node();
  ws();
  if (i < s.length) throw bad(`看不懂「${s.slice(i, i + 12)}」`);
  const all = [];
  const collect = (n) => { all.push(...n.toks); n.kids.forEach(collect); };
  collect(top);
  if (!all.length) throw bad('一个关键字都没有');
  if (all.length > MAX_KEYS) throw new Error(`nodes: 最多 ${MAX_KEYS} 个关键字（现在 ${all.length} 个），多了一屏放不下`);
  const nums = all.every(isNum);
  if (!nums && all.some(isNum)) throw bad('数和字不能混着写');
  const t = { root: null, nodes: {}, seq: 0 };
  const MIN = Math.ceil(m / 2) - 1;
  let leafDepth = -1;
  const build = (n, d, lo, hi, isRoot) => {
    const keys = n.toks.map((x) => ({ text: x, v: nums ? Number(x) : x }));
    const name = `[${n.toks.join(' ')}]`;
    if (!keys.length) throw bad('有一个空结点 []');
    for (let k = 1; k < keys.length; k++) if (cmp(keys[k - 1], keys[k]) >= 0) throw bad(`结点 ${name} 里的关键字要从小到大、不重复`);
    if (keys.length > m - 1) throw new Error(`nodes: 结点 ${name} 有 ${keys.length} 个关键字，${m} 阶 B 树每个结点最多 m − 1 = ${m - 1} 个`);
    if (!isRoot && keys.length < MIN) throw new Error(`nodes: 结点 ${name} 只有 ${keys.length} 个关键字，${m} 阶 B 树除了根，每个结点至少 ⌈m/2⌉ − 1 = ${MIN} 个`);
    if ((lo && cmp(keys[0], lo) <= 0) || (hi && cmp(keys[keys.length - 1], hi) >= 0)) throw new Error(`nodes: 结点 ${name} 放错了地方：它的关键字要在 ${lo ? lo.text : '−∞'} 和 ${hi ? hi.text : '+∞'} 之间`);
    if (n.kids.length && n.kids.length !== keys.length + 1) throw new Error(`nodes: 结点 ${name} 有 ${keys.length} 个关键字，就要有 ${keys.length + 1} 个孩子（现在写了 ${n.kids.length} 个）`);
    if (!n.kids.length) {
      if (leafDepth < 0) leafDepth = d;
      else if (leafDepth !== d) throw new Error('nodes: B 树的终端结点（最下面一层）都要在同一层');
    }
    const id = `b${++t.seq}`;
    t.nodes[id] = { keys, kids: [] };
    t.nodes[id].kids = n.kids.map((c, j) => build(c, d + 1, j === 0 ? lo : keys[j - 1], j === keys.length ? hi : keys[j], false));
    return id;
  };
  t.root = build(top, 0, null, null, true);
  return { ...t, numeric: nums };
}

const QUIZ = { level: 'level', levelorder: 'level', 层序: 'level', root: 'root', 根: 'root', leaf: 'leaf', leaves: 'leaf', 叶: 'leaf', 终端: 'leaf' };

export function parse(fields) {
  const plus = BOOL.test(String(fields.plus ?? '').trim());
  const m = orderOf(fields.order);
  const hasKeys = fields.btree !== undefined && String(fields.btree).trim() !== '';
  const hasNodes = fields.nodes !== undefined && String(fields.nodes).trim() !== '';
  if (hasKeys && hasNodes) throw new Error('btree: 和 nodes: 只写一个：btree: 是依次插入的关键字，nodes: 是直接给出的一棵树');
  if (!hasKeys && !hasNodes) throw new Error('btree 要写 btree:（依次插入的关键字，如 btree: 5 6 9 13 8 2 12 15）或 nodes:（直接给一棵 B 树，如 nodes: [30]([10 20], [40 50])）');
  if (hasNodes && plus) throw new Error('nodes: 只能给 B 树；B+ 树用 btree: 写依次插入的关键字');
  const items = hasKeys ? parseKeys(fields.btree, 'btree', MAX_KEYS) : [];
  const start = hasNodes ? parseNodes(fields.nodes, m) : null;
  const numeric = hasKeys ? typeof items[0].v === 'number' : start.numeric;
  const hasOps = fields.ops !== undefined && String(fields.ops).trim() !== '';
  const ops = hasOps ? parseOps(fields.ops, { allowed: plus ? ['insert'] : ['insert', 'delete'], what: plus ? 'B+ 树' : 'B 树', numeric }) : [];
  if (hasNodes && !ops.length) throw new Error('nodes: 给了一棵树，还要写 ops:（比如 ops: delete 30）');
  const total = (hasKeys ? items.length : Object.values(start.nodes).reduce((a, n) => a + n.keys.length, 0)) + ops.filter((o) => o.op === 'insert').length;
  if (total > MAX_KEYS) throw new Error(`关键字最多 ${MAX_KEYS} 个（现在 ${total} 个），多了一屏放不下`);
  const r = String(fields.replace ?? '').trim();
  if (r && !/^(pred|succ|前驱|后继)$/i.test(r)) throw new Error('replace: 写 pred（前驱，默认）或 succ（后继）');
  const q = String(fields.quiz ?? '').trim().toLowerCase();
  if (q && !QUIZ[q]) throw new Error(`quiz: 写 level（按层写出所有关键字，默认）、root（根结点的关键字）或 leaf（最下面一层的关键字）（现在是「${fields.quiz}」）`);
  return { kind: plus ? 'bplus' : 'btree', m, plus, items, start, ops, replace: /^(succ|后继)$/i.test(r) ? 'succ' : 'pred', quizWalk: QUIZ[q] || 'level' };
}

// —— 树 ——

const copyB = (t) => ({ root: t.root, seq: t.seq, nodes: Object.fromEntries(Object.entries(t.nodes).map(([k, n]) => [k, { keys: n.keys.slice(), kids: n.kids.slice() }])) });
const keyTexts = (n) => n.keys.map((k) => k.text);
function heightB(t) {
  let h = 0;
  for (let id = t.root; id !== null && id !== undefined; id = t.nodes[id].kids[0]) h++;
  return h;
}
function levelNodes(t) {
  const out = [];
  const q = t.root === null ? [] : [t.root];
  while (q.length) { const id = q.shift(); out.push(id); q.push(...t.nodes[id].kids); }
  return out;
}

export function run(input) {
  const { m, plus, items, start, ops, replace, mistake } = input;
  const t = start ? copyB(start) : { root: null, nodes: {}, seq: 0 };
  const steps = [], log = [];
  let live = false, opNo = -1, firstMis = -1, misCount = 0;
  let row = null;
  const push = (s) => { if (live) steps.push({ ...s, op: opNo }); };
  const flag = (a) => { a.mis = true; misCount++; if (firstMis < 0) firstMis = opNo; };
  const MAX = plus ? m : m - 1, MIN = plus ? Math.ceil(m / 2) : Math.ceil(m / 2) - 1;
  // 错法 cap：B 树上限算成 m；B+ 树反过来算成 m − 1（和 B 树弄混）
  const cap = () => (live && mistake === 'cap' ? (plus ? m - 1 : m) : MAX);
  const N = (id) => t.nodes[id];
  const txt = (id) => `[${keyTexts(N(id)).join(' ')}]`;
  const mk = (keys, kids = []) => { const id = `b${++t.seq}`; t.nodes[id] = { keys, kids }; return id; };
  const parentOf = (id) => Object.keys(t.nodes).find((p) => t.nodes[p].kids.includes(id)) ?? null;
  const snap = (extra = {}) => ({ tree: copyB(t), ...extra });
  const begin = (label) => { row = { label, acts: [], ups: [] }; };
  const done = () => { row.root = t.root === null ? '' : keyTexts(N(t.root)).join(' '); if (live) log.push(row); };
  const capWord = plus ? `m = ${m}` : `m − 1 = ${m - 1}`;

  // —— B 树插入 ——
  function insertB(x) {
    const what = `插入 ${x.text}`;
    begin(what);
    if (t.root === null) {
      t.root = mk([x]);
      push({ view: snap({ fresh: [x.text], cur: [x.text] }), msg: `${what}：树是空的，新建一个根结点 [${x.text}]。` });
      return done();
    }
    const path = [];
    let id = t.root, pos = 0;
    for (;;) {
      path.push(id);
      const n = N(id);
      const i = n.keys.findIndex((k) => cmp(x, k) <= 0);
      if (i >= 0 && cmp(x, n.keys[i]) === 0) {
        push({ view: snap({ path, cur: [x.text] }), msg: `树里已经有 ${x.text}，不插入。` });
        return done();
      }
      if (!n.kids.length) { pos = i < 0 ? n.keys.length : i; break; }
      id = n.kids[i < 0 ? n.keys.length : i];
    }
    const before = txt(id);
    const where = path.length > 1 ? `从根往下找（${path.map(txt).join(' → ')}），落到终端结点` : '根结点就是终端结点';
    N(id).keys.splice(pos, 0, x);
    const count = N(id).keys.length, will = count > cap();
    const ask = { tag: 'split', kind: 'choice', q: `${x.text} 插进终端结点 ${before} 以后，这个结点要不要分裂？`, choices: SPLIT, answer: will ? SPLIT[0] : SPLIT[1] };
    if (live && mistake === 'cap' && will !== count > MAX) flag(ask);
    push({
      view: snap({ path, over: will ? [id] : [], fresh: [x.text], cur: [x.text] }),
      msg: `${what}：${where}，按大小放进去。这个结点现在有 ${count} 个关键字，${will ? `超过了 ${capWord}，要分裂。` : `不超过 ${capWord}，不用分裂。`}`,
      ask,
    });
    let node = id, incoming = x;
    while (N(node).keys.length > cap()) ({ node, incoming } = splitB(node, incoming));
    done();
  }

  function splitB(id, incoming) {
    const n = N(id);
    const len = n.keys.length, before = txt(id);
    const good = Math.ceil(len / 2) - 1; // 王道：从中间第 ⌈m/2⌉ 个分开（len = m）
    let mi = good;
    if (live && mistake === 'mid') {
      // m 是偶数：中间有两个，上移了偏右的那个；m 是奇数：上移了刚插进来的那个
      if (len % 2 === 0) mi = len / 2;
      else { const j = n.keys.indexOf(incoming); if (j >= 0) mi = j; }
    }
    const up = n.keys[mi];
    const ask = { tag: 'up', kind: 'pick', q: `结点 ${before} 有 ${len} 个关键字，要分裂：上移到父结点的是哪个关键字？在图里点出来。`, answer: up.text };
    if (mi !== good) flag(ask);
    const leaf = !n.kids.length;
    const right = mk(n.keys.slice(mi + 1), leaf ? [] : n.kids.slice(mi + 1));
    n.keys = n.keys.slice(0, mi);
    n.kids = leaf ? [] : n.kids.slice(0, mi + 1);
    let p = parentOf(id), grew = false;
    if (p === null) { p = mk([up], [id, right]); t.root = p; grew = true; }
    else { const i = N(p).kids.indexOf(id); N(p).keys.splice(i, 0, up); N(p).kids.splice(i + 1, 0, right); }
    row.acts.push('分裂');
    row.ups.push(up.text);
    const pc = N(p).keys.length, over = pc > cap();
    push({
      view: snap({ fresh: [up.text], up: [up.text], done: [id, right], over: over ? [p] : [] }),
      msg: `${before} 有 ${len} 个关键字，超过了 ${capWord}：从中间第 ⌈${m}/2⌉ = ${good + 1} 个分开——${up.text} 上移到${grew ? '新的根结点' : '父结点'}，左边 ${txt(id)} 留在原结点，右边 ${txt(right)} 放进一个新结点${leaf ? '' : '（孩子跟着分成两半）'}。${grew ? '根分裂了，树高加 1。' : over ? `父结点现在有 ${pc} 个关键字，也超了，接着分裂。` : `父结点现在有 ${pc} 个关键字，没超，插好了。`}`,
      ask,
    });
    return { node: p, incoming: up };
  }

  // —— B+ 树插入（王道的定义）——
  function insertPlus(x) {
    const what = `插入 ${x.text}`;
    begin(what);
    if (t.root === null) {
      t.root = mk([x]);
      push({ view: snap({ fresh: [x.text], cur: [x.text] }), msg: `${what}：树是空的，新建一个叶结点 [${x.text}]，它也是根。` });
      return done();
    }
    const path = [], raised = [];
    let id = t.root;
    while (N(id).kids.length) {
      path.push(id);
      const n = N(id);
      let i = n.keys.findIndex((k) => cmp(x, k) <= 0);
      if (i < 0) { i = n.keys.length - 1; raised.push(id); }
      id = n.kids[i];
    }
    path.push(id);
    const L = N(id);
    if (L.keys.some((k) => cmp(k, x) === 0)) {
      push({ view: snap({ path, cur: [x.text] }), msg: `树里已经有 ${x.text}，不插入。` });
      return done();
    }
    const before = txt(id);
    const where = path.length > 1 ? `从根往下找（${path.map(txt).join(' → ')}），落到叶结点` : '根结点就是叶结点';
    // 比路上分支结点里最大的还大：一路把最大的关键字改成 x（分支结点里存的是子树里最大的）
    const olds = raised.map((r) => N(r).keys[N(r).keys.length - 1].text);
    for (const r of raised) N(r).keys[N(r).keys.length - 1] = x;
    const pos = L.keys.findIndex((k) => cmp(x, k) < 0);
    L.keys.splice(pos < 0 ? L.keys.length : pos, 0, x);
    const count = L.keys.length, will = count > cap();
    const ask = { tag: 'split', kind: 'choice', q: `${x.text} 插进叶结点 ${before} 以后，这个结点要不要分裂？`, choices: SPLIT, answer: will ? SPLIT[0] : SPLIT[1] };
    if (live && mistake === 'cap' && will !== count > MAX) flag(ask);
    push({
      view: snap({ path, over: will ? [id] : [], fresh: [x.text], cur: [x.text] }),
      msg: `${what}：${where}，按大小放进去${raised.length ? `；${x.text} 比路上分支结点里最大的 ${[...new Set(olds)].join('、')} 还大，把${olds.length > 1 ? '它们' : '它'}改成 ${x.text}（分支结点里存的是子树里最大的关键字）` : ''}。叶结点现在有 ${count} 个关键字，${will ? `超过了 ${capWord}，要分裂。` : `不超过 ${capWord}，不用分裂。`}`,
      ask,
    });
    let node = id;
    while (N(node).keys.length > cap()) node = splitPlus(node);
    done();
  }

  function splitPlus(id) {
    const n = N(id);
    const len = n.keys.length, before = txt(id);
    const cut = Math.ceil(len / 2);
    const left = n.keys.slice(0, cut), rightKeys = n.keys.slice(cut);
    const lmax = left[left.length - 1], rmax = rightKeys[rightKeys.length - 1];
    const ask = { tag: 'up', kind: 'pick', q: `结点 ${before} 有 ${len} 个关键字，要分裂：分完以后，父结点里多出来的是哪个关键字？在图里点出来。`, answer: lmax.text };
    if (live && mistake === 'minright') { ask.answer = rightKeys[0].text; flag(ask); }
    const leaf = !n.kids.length;
    const right = mk(rightKeys, leaf ? [] : n.kids.slice(cut));
    n.keys = left;
    n.kids = leaf ? [] : n.kids.slice(0, cut);
    let p = parentOf(id), grew = false;
    // 父结点里原来指向它的是整个结点最大的（现在是右半边最大的）：前面添上左半边最大的
    if (p === null) { p = mk([lmax, rmax], [id, right]); t.root = p; grew = true; }
    else { const i = N(p).kids.indexOf(id); N(p).keys.splice(i, 0, lmax); N(p).kids.splice(i + 1, 0, right); }
    row.acts.push('分裂');
    row.ups.push(lmax.text);
    const pc = N(p).keys.length, over = pc > cap();
    push({
      view: snap({ fresh: [lmax.text], up: [lmax.text], done: [id, right], over: over ? [p] : [] }),
      msg: `${before} 有 ${len} 个关键字，超过了 ${capWord}：分成前 ${cut} 个 ${txt(id)} 和后 ${len - cut} 个 ${txt(right)}${leaf ? '，叶结点照样从左到右链着' : ''}。${grew ? `再新建一个根 ${txt(p)}（两半各自最大的关键字），树高加 1。` : `父结点里添上左半边最大的 ${lmax.text}（指向左半边），原来的 ${rmax.text} 指向右半边。${over ? `父结点现在有 ${pc} 个关键字，也超了，接着分裂。` : ''}`}`,
      ask,
    });
    return p;
  }

  // —— B 树删除 ——
  function deleteB(x) {
    const what = `删除 ${x.text}`;
    begin(what);
    const path = [];
    let id = t.root, at = -1;
    while (id !== null) {
      path.push(id);
      const n = N(id);
      const i = n.keys.findIndex((k) => cmp(x, k) <= 0);
      if (i >= 0 && cmp(x, n.keys[i]) === 0) { at = i; break; }
      if (!n.kids.length) break;
      id = n.kids[i < 0 ? n.keys.length : i];
    }
    const where = path.length > 1 ? `从根往下找（${path.map(txt).join(' → ')}）` : '先在根结点里找';
    if (at < 0) {
      push({ view: snap({ path }), msg: `${what}：${where}，树里没有 ${x.text}，不用删。` });
      return done();
    }
    const caseAsk = (key, q) => ({ tag: 'case', kind: 'choice', q, choices: CASE_CHOICES, answer: CASES[key] });
    let q1 = `删除 ${x.text} 属于哪种情况？`, gone = x.text, leaf = id;
    push({ view: snap({ path, swap: [x.text] }), msg: `${what}：${where}，${x.text} 在结点 ${txt(id)} 里——${N(id).kids.length ? '这是一个非终端结点。' : '这是终端结点（最下面一层）。'}` });
    if (N(id).kids.length) {
      const succ = replace === 'succ';
      let c = N(id).kids[succ ? at + 1 : at];
      const down = [c];
      while (N(c).kids.length) { c = succ ? N(c).kids[0] : N(c).kids[N(c).kids.length - 1]; down.push(c); }
      const j = succ ? 0 : N(c).keys.length - 1;
      const k2 = N(c).keys[j];
      N(id).keys[at] = k2;
      N(c).keys.splice(j, 1);
      row.acts.push('替代');
      push({
        view: snap({ path: [id, ...down], cur: [k2.text], fresh: [k2.text] }),
        msg: `${x.text} 不在终端结点：用它的${succ ? `后继 ${k2.text}（右边子树里最左下的关键字）` : `前驱 ${k2.text}（左边子树里最右下的关键字）`}替代它，转成在终端结点里删掉 ${k2.text}。`,
        ask: caseAsk('replace', q1),
      });
      q1 = `${x.text} 换成 ${k2.text} 以后，在终端结点里删掉 ${k2.text} 属于哪种情况？`;
      gone = k2.text;
      leaf = c;
    } else N(id).keys.splice(at, 1);
    const L = N(leaf);
    if (leaf === t.root || L.keys.length >= MIN) {
      row.acts.push('直接删');
      if (leaf === t.root && !L.keys.length) { delete t.nodes[leaf]; t.root = null; }
      push({
        view: snap({ done: t.root === null ? [] : [leaf] }),
        msg: t.root === null ? `删掉 ${gone} 以后树空了。` : `删掉 ${gone} 以后结点里还有 ${L.keys.length} 个关键字，${leaf === t.root ? '它是根（根至少 1 个就行）' : `不少于 ⌈m/2⌉ − 1 = ${MIN}`}：直接删，删完了。`,
        ask: caseAsk('direct', q1),
      });
      return done();
    }
    fixUnder(leaf, gone, (key) => caseAsk(key, q1));
    done();
  }

  // 结点 id 的关键字少于下限：先看兄弟够不够借（右兄弟优先），借不到就合并（左兄弟优先），合并后父结点少了接着看
  function fixUnder(id, gone, ask) {
    let first = true;
    for (;;) {
      const n = N(id);
      if (id === t.root || n.keys.length >= MIN) return;
      const p = parentOf(id), P = N(p), i = P.kids.indexOf(id);
      const ls = i > 0 ? P.kids[i - 1] : null, rs = i < P.kids.length - 1 ? P.kids[i + 1] : null;
      const rich = (s) => s !== null && N(s).keys.length > MIN;
      const from = rich(rs) ? 'right' : rich(ls) ? 'left' : null;
      const parts = [];
      if (rs !== null) parts.push(`右兄弟 ${txt(rs)} 有 ${N(rs).keys.length} 个${rich(rs) ? '，够借' : ''}`);
      if (from !== 'right' && ls !== null) parts.push(`左兄弟 ${txt(ls)} 有 ${N(ls).keys.length} 个${rich(ls) ? '，够借' : ''}`);
      const look = parts.join('；') + (from ? '。' : `——兄弟都只有 ⌈m/2⌉ − 1 = ${MIN} 个，借不到，要合并。`);
      const left = n.keys.length ? `只剩 ${n.keys.length} 个关键字，少于 ⌈m/2⌉ − 1 = ${MIN}` : '结点空了';
      const head = first ? `删掉 ${gone} 以后${left}` : `父结点${n.keys.length ? ` ${txt(id)}` : ''}少了一个关键字，${n.keys.length ? left : '空了'}`;
      push({ view: snap({ under: [id], sib: [ls, rs].filter((s) => s !== null), path: [p] }), msg: `${head}，不够了。${look}`, ask: first ? ask(from ? 'borrow' : 'merge') : undefined });
      first = false;
      if (from) { borrow(id, p, i, from); return; }
      merge(id, p, i);
      if (t.root === null || !t.nodes[p]) return; // 根空了，合并出来的当了新根
      id = p;
    }
  }

  function borrow(id, p, i, from) {
    const n = N(id), P = N(p);
    row.acts.push('借');
    const s = P.kids[from === 'right' ? i + 1 : i - 1], S = N(s);
    const si = from === 'right' ? i : i - 1;
    const sep = P.keys[si];
    if (live && mistake === 'borrow') {
      // 错法：直接把兄弟的关键字拿过来，没经过父结点（只拿来和学生写的比，不演示）
      misCount++;
      if (from === 'right') { n.keys.push(S.keys.shift()); if (S.kids.length) n.kids.push(S.kids.shift()); }
      else { n.keys.unshift(S.keys.pop()); if (S.kids.length) n.kids.unshift(S.kids.pop()); }
      push({ view: snap(), msg: '' });
      return;
    }
    let q, moved = null;
    if (from === 'right') {
      q = S.keys.shift();
      n.keys.push(sep);
      if (S.kids.length) { moved = S.kids.shift(); n.kids.push(moved); }
    } else {
      q = S.keys.pop();
      n.keys.unshift(sep);
      if (S.kids.length) { moved = S.kids.pop(); n.kids.unshift(moved); }
    }
    P.keys[si] = q;
    push({
      view: snap({ fresh: [sep.text, q.text], up: [q.text], cur: [sep.text], done: [id] }),
      msg: `向${W[from]}兄弟借（父子换位）：父结点里的 ${sep.text} 下来，放进这个结点；${W[from]}兄弟${from === 'right' ? '最左边' : '最右边'}的 ${q.text} 上去顶替 ${sep.text}${moved ? `，它${from === 'right' ? '左边' : '右边'}那棵子树跟着挪过来` : ''}。删完了。`,
    });
  }

  function merge(id, p, i) {
    const P = N(p);
    row.acts.push('合并');
    // 王道：和左（或右）兄弟合并——有左兄弟先和左兄弟并
    const withLeft = i > 0;
    const a = withLeft ? P.kids[i - 1] : id, b = withLeft ? id : P.kids[i + 1];
    const si = withLeft ? i - 1 : i;
    const sep = P.keys[si];
    const rest = N(id).keys.length ? ` ${txt(id)}` : '（已经空了）';
    const parts = withLeft ? `左兄弟 ${txt(a)}、父结点里夹在中间的 ${sep.text}、这个结点剩下的${rest}` : `这个结点剩下的${rest}、父结点里夹在中间的 ${sep.text}、右兄弟 ${txt(b)}`;
    const kids = N(a).kids.length > 0;
    N(a).keys = [...N(a).keys, sep, ...N(b).keys];
    N(a).kids = [...N(a).kids, ...N(b).kids];
    P.keys.splice(si, 1);
    P.kids.splice(si + 1, 1);
    delete t.nodes[b];
    let after;
    if (p === t.root && !P.keys.length) {
      delete t.nodes[p];
      t.root = a;
      after = '根结点空了：合并出来的结点当新的根，树高减 1。删完了。';
    } else if (p === t.root || P.keys.length >= MIN) after = `父结点还有 ${P.keys.length} 个关键字，${p === t.root ? '它是根，至少 1 个就行' : '够'}，删完了。`;
    else after = `父结点只剩 ${P.keys.length} 个，也不够了，接着调整父结点。`;
    push({
      view: snap({ fresh: [sep.text], cur: [sep.text], done: [a], under: t.nodes[p] && p !== t.root && P.keys.length < MIN ? [p] : [] }),
      msg: `和${withLeft ? '左' : '右'}兄弟合并：${parts}，合成一个结点 ${txt(a)}${kids ? '（两边的孩子也接到一起）' : ''}。${after}`,
    });
  }

  const insert = plus ? insertPlus : insertB;
  const name = plus ? 'B+ 树' : 'B 树';
  const rule = plus ? `${m} 阶 B+ 树：每个结点最多 ${m} 个关键字（和子树一样多），除了根至少 ⌈m/2⌉ = ${MIN} 个；分支结点里存的是每棵子树最大的关键字，叶结点从左到右链起来` : `${m} 阶 B 树：每个结点最多 m − 1 = ${m - 1} 个关键字，除了根至少 ⌈m/2⌉ − 1 = ${MIN} 个`;
  if (ops.length) for (const it of items) insert(it); // 题目给的树：悄悄建好，不出步、不犯错
  live = true;
  const startTree = copyB(t);
  if (!ops.length) {
    push({ view: snap(), msg: `依次插入 ${items.map((x) => x.text).join('、')}，建一棵 ${rule}。` });
    for (const it of items) { opNo++; insert(it); }
  } else {
    push({ view: snap(), msg: `${start ? '这是题目给的' : `这是依次插入 ${items.map((x) => x.text).join('、')} 建成的`} ${rule}。` });
    for (const o of ops) { opNo++; if (o.op === 'insert') insert(o.item); else deleteB(o.item); }
  }
  push({ view: snap(), msg: `${ops.length ? '做完了' : '插完了'}。根结点 ${t.root === null ? '（空树）' : txt(t.root)}，树高 ${heightB(t)}${plus ? '；最下面一层的叶结点从左到右正好是全部关键字，从小到大' : ''}。` });
  if (mistake) {
    for (const s of steps) {
      if (s.ask && !(s.ask.mis && (!DIVERGE[mistake] || s.op === firstMis))) delete s.ask;
    }
  }
  return { steps, log, final: copyB(t), start: startTree, name, misApplied: misCount > 0 };
}

// —— 画 ——

const CH = 40, LEVEL = 86, M = 10;

/**
 * 画一棵 B / B+ 树（SVG 字符串）。s：这一步的标注——
 *   结点（id）：path（找的路上）、over（超了要分裂）、under（不够）、sib（兄弟）、done（刚调好）
 *   关键字（写的字）：cur、up（上移的）、swap（要删的）、fresh（刚变的，闪一下）
 * 结点带 data-cmd（层序第几个，课堂 highlight / board mark item=）、data-label（结点里的关键字）；
 * 每个关键字格子带 data-pick（ask 在图上点）和 data-key（换步时同一个关键字滑到新位置，分裂时看得到它上移）
 */
export function btreeSvg(t, s = {}, plus = false) {
  if (t.root === null || t.root === undefined) return '<div class="sv-tree-empty muted">（空树）</div>';
  const maxLen = Math.max(1, ...Object.values(t.nodes).flatMap((n) => n.keys.map((k) => String(k.text).length)));
  const CW = Math.max(42, maxLen * 11 + 14);
  const GAP = plus ? 30 : 18;
  const w = (id) => Math.max(1, t.nodes[id].keys.length) * CW;
  const slot = {}, kidsW = {};
  const measure = (id) => {
    const n = t.nodes[id];
    kidsW[id] = n.kids.length ? n.kids.reduce((a, k) => a + measure(k), 0) + GAP * (n.kids.length - 1) : 0;
    slot[id] = Math.max(w(id), kidsW[id]);
    return slot[id];
  };
  measure(t.root);
  // 每个结点占一段「位置」（不小于它自己、也不小于孩子们加起来），孩子在里面排开、结点放在孩子正上方：同一层不会叠
  const pos = {};
  const place = (id, x0, d) => {
    const n = t.nodes[id];
    let cx = x0 + slot[id] / 2;
    if (n.kids.length) {
      let x = x0 + (slot[id] - kidsW[id]) / 2;
      for (const k of n.kids) { place(k, x, d + 1); x += slot[k] + GAP; }
      cx = (pos[n.kids[0]].cx + pos[n.kids[n.kids.length - 1]].cx) / 2;
      cx = Math.min(Math.max(cx, x0 + w(id) / 2), x0 + slot[id] - w(id) / 2);
    }
    pos[id] = { cx, d, x: cx - w(id) / 2, y: M + d * LEVEL };
  };
  place(t.root, M, 0);
  const depth = Math.max(...Object.values(pos).map((p) => p.d));
  const Wd = slot[t.root] + 2 * M, Ht = 2 * M + depth * LEVEL + CH;
  const order = levelNodes(t);
  const set = (xs) => new Set((xs || []).map(String));
  const path = set(s.path), over = set(s.over), under = set(s.under), sib = set(s.sib), done = set(s.done);
  const cur = set(s.cur), up = set(s.up), swap = set(s.swap), fresh = set(s.fresh);
  let lines = '', boxes = '';
  for (const id of order) {
    const n = t.nodes[id], P = pos[id];
    n.kids.forEach((k, j) => {
      const px = plus ? P.x + (j + 0.5) * CW : P.x + j * CW;
      const on = path.has(id) && path.has(k);
      lines += `<line class="sv-bedge${on ? ' sv-edge-path' : ''}" data-key="be:${esc(k)}" x1="${px}" y1="${P.y + CH}" x2="${pos[k].cx}" y2="${pos[k].y}"/>`;
    });
  }
  if (plus) {
    // 叶结点链：从左到右一个指一个
    const leaves = order.filter((id) => !t.nodes[id].kids.length).sort((a, b) => pos[a].x - pos[b].x);
    for (let j = 0; j + 1 < leaves.length; j++) {
      const a = pos[leaves[j]], b = pos[leaves[j + 1]];
      const x1 = a.x + w(leaves[j]) + 3, x2 = b.x - 3, ym = a.y + CH / 2;
      lines += `<g class="sv-blink"><line x1="${x1}" y1="${ym}" x2="${x2}" y2="${ym}"/><path d="M${x2 - 6} ${ym - 4} L${x2} ${ym} L${x2 - 6} ${ym + 4}"/></g>`;
    }
  }
  const lvl = (id) => depth - pos[id].d; // B+ 树里同一个关键字在好几层都有：按「从下往上第几层」区分身份
  for (const id of order) {
    const n = t.nodes[id], P = pos[id];
    const cls = ['sv-bnode', path.has(id) ? 'sv-path' : '', over.has(id) ? 'sv-over' : '', under.has(id) ? 'sv-under' : '', sib.has(id) ? 'sv-sib' : '', done.has(id) ? 'sv-done' : '', n.keys.length ? '' : 'sv-bempty'].filter(Boolean).join(' ');
    let cells = `<rect class="sv-bframe" x="${P.x}" y="${P.y}" width="${w(id)}" height="${CH}" rx="6"/>`;
    n.keys.forEach((k, j) => {
      const tx = String(k.text);
      const kc = ['sv-bkey', cur.has(tx) ? 'sv-cur' : '', up.has(tx) ? 'sv-up' : '', swap.has(tx) ? 'sv-swap' : '', fresh.has(tx) ? 'sv-new' : ''].filter(Boolean).join(' ');
      const x = P.x + j * CW;
      cells += `<g class="${kc}" data-pick="${esc(tx)}" data-key="${plus ? `bk:${esc(tx)}:${lvl(id)}` : `bk:${esc(tx)}`}"><rect x="${x}" y="${P.y}" width="${CW}" height="${CH}" rx="${j === 0 || j === n.keys.length - 1 ? 6 : 0}"/><text x="${x + CW / 2}" y="${P.y + CH / 2}">${esc(tx)}</text></g>`;
    });
    boxes += `<g class="${cls}" data-cmd="${order.indexOf(id) + 1}" data-label="${esc(keyTexts(n).join(' '))}">${cells}</g>`;
  }
  return `<svg class="sv-mway${plus ? ' sv-bplus' : ''}" viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" style="max-width:100%" role="img" aria-label="${plus ? 'B+ 树' : 'B 树'}">${lines}${boxes}</svg>`;
}

export function view(s, input) {
  const m = input.m;
  const rule = input.plus ? `最多 ${m} 个，非根至少 ${Math.ceil(m / 2)} 个` : `最多 ${m - 1} 个，非根至少 ${Math.ceil(m / 2) - 1} 个`;
  return btreeSvg(s.tree, s, input.plus) + chips([['阶', `m = ${m}`], ['每个结点的关键字', rule], ['树高', heightB(s.tree)], ...(s.chips || [])]);
}

// —— 考卷 ——

function didText(input) {
  const keys = input.items.map((x) => x.text).join('、');
  const ops = input.ops.map((o) => `${o.op === 'insert' ? '插入' : '删除'} ${o.item.text}`).join('，');
  const name = `${input.m} 阶 ${input.plus ? 'B+ 树' : 'B 树'}`;
  if (!ops) return { lead: `依次插入 ${keys}，建一棵 ${name}。`, pic: false };
  return { lead: `${input.start ? `下面是一棵 ${name}` : `下面是依次插入 ${keys} 建成的 ${name}`}。依次${ops} 以后，`, pic: true };
}

export function quiz(input, r) {
  const { lead, pic } = didText(input);
  const t = r.final, w = input.quizWalk;
  const K = (id) => keyTexts(t.nodes[id]);
  const answer = t.root === null ? '空'
    : w === 'root' ? K(t.root).join(' ')
    : w === 'leaf' ? levelNodes(t).filter((id) => !t.nodes[id].kids.length).flatMap(K).join(' ')
    : levelNodes(t).flatMap(K).join(' ');
  const ask = w === 'root' ? '写出根结点里的关键字' : w === 'leaf' ? '写出最下面一层（终端结点）从左到右的所有关键字' : '按层从上往下、每层从左往右，写出所有结点的关键字（一个结点可以用方括号括起来，如 [30] [10 20] [40 50]）';
  return { q: `${lead}${ask}。`, qhtml: pic ? btreeSvg(r.start, {}, input.plus).replace(/ data-pick="[^"]*"/g, '') : '', type: 'seq', answer };
}

const actAlts = (acts) => (acts.length ? [0, 1, 2].map((j) => acts.map((a) => (ACT_NAMES[a] || [a])[j] || a).join(' ')) : NONE);

export function table(input, r) {
  const { lead, pic } = didText(input);
  const hasDel = input.ops.some((o) => o.op === 'delete');
  const rootCell = (row) => ({ v: row.root || NONE, vec: true });
  let head, rows, how;
  if (input.plus) {
    head = ['分裂', '根结点'];
    rows = r.log.map((row) => ({ label: row.label, cells: [{ v: row.acts.length ? '√' : '', mark: true }, rootCell(row)] }));
    how = '这个关键字插进来以后有没有分裂（有就点一下打勾）、根结点里有哪些关键字（从小到大，空格隔开）';
  } else if (hasDel) {
    head = ['怎么调', '根结点'];
    rows = r.log.map((row) => ({ label: row.label, cells: [{ v: actAlts(row.acts), vec: true }, rootCell(row)] }));
    how = '做了哪些调整（分裂、替代、直接删、借、合并，几次就按先后写几个，空格隔开）、做完以后根结点里有哪些关键字';
  } else {
    head = ['上移的关键字', '根结点'];
    rows = r.log.map((row) => ({ label: row.label, cells: [{ v: row.ups.length ? row.ups.join(' ') : NONE, vec: true }, rootCell(row)] }));
    how = '分裂时上移的关键字（没分裂就空着；分裂了好几次按先后写，空格隔开）、插完以后根结点里有哪些关键字（从小到大）';
  }
  return { q: `${lead.replace(/ 以后，$/, '。')}每一步写出：${how}。`, qhtml: pic ? btreeSvg(r.start, {}, input.plus).replace(/ data-pick="[^"]*"/g, '') : '', dir: 'row', head, rows };
}

export function variants(input) {
  const out = [];
  const tryV = (mistake, label) => { const v = { ...input, mistake }; try { if (run(v).misApplied) out.push({ label, input: v }); } catch { /* 这组数上这种错法走不下去 */ } };
  const m = input.m;
  if (input.plus) {
    tryV('cap', `像是把 B+ 树结点最多的关键字个数算成了 m − 1（王道：m 阶 B+ 树结点里关键字和子树一样多，最多 m = ${m} 个，到 ${m + 1} 个才分裂）`);
    tryV('minright', '像是把右半边最小的关键字当成了父结点里新添的关键字（王道的 B+ 树：分支结点里存的是每个子结点里最大的关键字，新添的是左半边最大的）');
    return out;
  }
  tryV('cap', `像是把每个结点最多的关键字个数算成了 m（王道：${m} 阶 B 树每个结点最多 m − 1 = ${m - 1} 个关键字，到 ${m} 个就要分裂）`);
  tryV('mid', m % 2 === 0
    ? `像是分裂时上移了中间偏右的那个（王道：从第 ⌈m/2⌉ = ${Math.ceil(m / 2)} 个分开，上移的是它）`
    : `像是分裂时把刚插进来的关键字上移了（王道：上移的是正中间第 ⌈m/2⌉ = ${Math.ceil(m / 2)} 个）`);
  if (input.ops.some((o) => o.op === 'delete')) tryV('borrow', '像是向兄弟借时直接把兄弟的关键字拿了过来（王道：父子换位——父结点里的关键字下来，兄弟的关键字上去顶替它）');
  return out;
}

export function problems(input) {
  const out = [];
  if (input.replace === 'succ' && !input.ops.some((o) => o.op === 'delete')) out.push('replace: 只在删除非终端结点里的关键字时有用（ops 里没有 delete）');
  return out;
}

export const btreeEngine = { name: 'btree', title: 'B 树', parse, run, view, quiz, table, variants, problems };
