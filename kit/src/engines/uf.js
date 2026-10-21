// 并查集（组件 uf）：双亲表示的森林，S[i] 是 i 的双亲，根的 S 是负数（−1；size: true 时存 −结点数）。
// 照王道的代码：
//   Find(x)：从 x 一路往上走到 S 是负数的那个；compress: true 时再把路径上的每个结点都直接挂到根下面（路径压缩）。
//   Union(a, b)：先 Find 出两个根 Root1、Root2，再 S[Root2] = Root1（第二个的根挂到第一个的根下面）。
//   rank: true（小树并到大树）：if (S[Root2] > S[Root1]) Root2 挂到 Root1 下，else Root1 挂到 Root2 下——一样大时走 else。
//   rank: height 按树高合并（矮的挂到高的下面，一样高同样走 else，Root2 那棵高度加 1）。
// 纯函数，不碰 DOM（tests/trees2-engine.test.js）。画法在 forestview.js。
import { treesSvg, forestLayout, forestEdges, BOOL } from './forestview.js';
import { arrayView, chips } from './arrayview.js';

const MAX_N = 16;
const MAX_OPS = 24;
const neg = (v) => (v < 0 ? `−${-v}` : String(v)); // 画面上的负号用 −

// —— 写法 ——

/** union 1 2, find 4（也认 Union(1, 2)、合并 1 2、查找 4） */
function parseOps(src, lo, hi, from) {
  // Union(1, 2) 里的逗号不是分隔符：先换成空格
  const s = String(src ?? '')
    .replace(/([A-Za-z一-龥]+)\s*[(（]\s*([^,，()（）]+?)\s*[,，]\s*([^,，()（）]+?)\s*[)）]/g, '$1 $2 $3')
    .replace(/([A-Za-z一-龥]+)\s*[(（]\s*([^,，()（）]+?)\s*[)）]/g, '$1 $2');
  const list = s.split(/[,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  if (list.length > MAX_OPS) throw new Error(`ops: 最多 ${MAX_OPS} 个操作（现在 ${list.length} 个）`);
  const alias = { union: 'union', u: 'union', 合并: 'union', 并: 'union', find: 'find', f: 'find', 查找: 'find', 查: 'find' };
  return list.map((x) => {
    const [w, ...rest] = x.split(/\s+/);
    const op = alias[w.toLowerCase()];
    if (!op) throw new Error(`ops: 不认识「${x}」，写 union 1 2（合并 1 和 2 所在的集合）或 find 4（查 4 的根）`);
    const need = op === 'union' ? 2 : 1;
    if (rest.length !== need) throw new Error(`ops: ${op} 后面要写 ${need} 个元素（「${x}」）`);
    const args = rest.map((t) => {
      if (!/^\d+$/.test(t)) throw new Error(`ops: 「${x}」里的元素要写编号（整数）`);
      const v = Number(t);
      if (v < lo || v > hi) throw new Error(`ops: 「${x}」里的 ${v} 不在 ${lo}～${hi} 里${from === 0 && v === hi + 1 ? '（元素从 0 编号；要从 1 编号写 from: 1）' : ''}`);
      return v;
    });
    return { op, args, text: `${op} ${args.join(' ')}` };
  });
}

export function parse(fields) {
  const from = fields.from === undefined || String(fields.from).trim() === '' ? 0 : Number(fields.from);
  if (from !== 0 && from !== 1) throw new Error(`from: 写 0（元素是 0～n−1，王道代码的写法，默认）或 1（1～n）（现在是「${fields.from}」）`);
  let init = null;
  if (fields.init !== undefined && String(fields.init).trim() !== '') {
    init = String(fields.init).trim().replace(/^\[|\]$/g, '').split(/[\s,，、]+/).filter(Boolean).map((t) => {
      const v = Number(t.replace(/[−–—]/g, '-'));
      if (!Number.isInteger(v)) throw new Error(`init: 「${t}」要是整数（根写负数，别的写双亲的编号）`);
      return v;
    });
  }
  let n = fields.n === undefined || String(fields.n).trim() === '' ? (init ? init.length : NaN) : Number(fields.n);
  if (!Number.isInteger(n) || n < 2 || n > MAX_N) throw new Error(`n: 写元素个数（2 到 ${MAX_N} 的整数）（现在是「${fields.n ?? ''}」）`);
  if (init && init.length !== n) throw new Error(`init: 写了 ${init.length} 个数，n 是 ${n}`);
  const lo = from, hi = from + n - 1;
  if (init) {
    init.forEach((v, i) => { if (v >= 0 && (v < lo || v > hi)) throw new Error(`init: S[${i + from}] = ${v} 不是 ${lo}～${hi} 里的编号`); if (v === i + from) throw new Error(`init: S[${v}] = ${v} 指向自己：根要写负数`); });
    // 不能有环：每个元素往上走都要走到根
    for (let i = 0; i < n; i++) {
      let x = i + from, k = 0;
      while (init[x - from] >= 0) { x = init[x - from]; if (++k > n) throw new Error(`init: 从 ${i + from} 往上走转圈了，不是一片森林`); }
    }
  }
  const r = String(fields.rank ?? '').trim().toLowerCase();
  const rank = !r || /^(false|no|off|0|否|none)$/.test(r) ? '' : /^(height|高|高度|树高)$/.test(r) ? 'height' : BOOL.test(r) || /^(size|大小|结点数)$/.test(r) ? 'size' : null;
  if (rank === null) throw new Error(`rank: 写 true（小树并到大树，王道的写法）或 height（按树高）（现在是「${fields.rank}」）`);
  const size = fields.size === undefined || String(fields.size).trim() === '' ? rank === 'size' : BOOL.test(String(fields.size));
  const compress = BOOL.test(String(fields.compress ?? ''));
  if (fields.ops === undefined || !String(fields.ops).trim()) throw new Error('uf 要写 ops:，比如 union 1 2, union 3 4, find 4');
  const ops = parseOps(fields.ops, lo, hi, from);
  const q = String(fields.quiz ?? '').trim().toLowerCase();
  if (q && !['array', 's', 'find'].includes(q)) throw new Error(`quiz: 写 array（最后的 S 数组，默认）或 find（每次 find 的结果）（现在是「${fields.quiz}」）`);
  if (q === 'find' && !ops.some((o) => o.op === 'find')) throw new Error('quiz: find 要 ops 里有 find');
  return { n, from, init, rank, size, compress, ops, quiz: q === 'find' ? 'find' : 'array' };
}

// —— 演示 ——

/**
 * mistake：'flip'（根接反 / 大树挂到小树下）、'firstonly'（路径压缩只改了第一个）、'noroot'（没找根，直接 S[b] = a）、
 * 'nosize'（根里还写 −1）——错法只拿来和学生的答案比
 */
export function run(input) {
  const { n, from, rank, compress, ops, mistake } = input;
  const size = input.size && mistake !== 'nosize';
  const S = input.init ? input.init.slice() : Array(n).fill(-1);
  const at = (x) => x - from;
  const get = (x) => S[at(x)];
  const set = (x, v) => { S[at(x)] = v; };
  // 每棵树的结点数、高度（S 里不一定存着，合并要用）
  const rootOf = (x) => { while (get(x) >= 0) x = get(x); return x; };
  const count = (r) => S.filter((_, i) => rootOf(i + from) === r).length;
  const height = (r) => { let h = 0; for (let i = 0; i < n; i++) { let x = i + from, d = 1; if (rootOf(x) !== r) continue; while (get(x) >= 0) { x = get(x); d++; } h = Math.max(h, d); } return h; };
  if (size && input.init) for (let i = 0; i < n; i++) if (S[i] < 0) S[i] = -count(i + from);
  const steps = [];
  const finds = [];
  const snap = (extra = {}) => ({ S: S.slice(), ...extra });
  const pathOf = (x) => { const p = [x]; while (get(x) >= 0) { x = get(x); p.push(x); } return p; };
  const arrText = () => S.join(' ');
  const arrAsk = (q) => ({ tag: 'array', kind: 'text', q, answer: arrText() });
  const rootWord = size ? '根的 S 存 −结点数' : '根的 S 是 −1';
  steps.push({ view: snap(), msg: input.init ? `一开始的 S 数组（双亲表示：S[i] 是 i 的双亲；${rootWord}）。` : `${n} 个元素各自一个集合：S[i] = −1（双亲表示：S[i] 是 i 的双亲，根的 S 是负数${size ? '，存 −结点数' : ''}）。` });

  // 路径压缩：路径上不直接挂在根下面的，都改成直接挂到根下面
  const compressPath = (p) => {
    const root = p[p.length - 1];
    let changed = p.slice(0, -2);
    if (mistake === 'firstonly') changed = changed.slice(0, 1);
    for (const x of changed) set(x, root);
    return changed;
  };
  const pathCls = (paths, root) => {
    const cls = {}, edge = {};
    for (const p of paths) { p.forEach((x) => { cls[x] = 'sv-path'; }); p.slice(0, -1).forEach((x) => { edge[x] = 'sv-edge-path'; }); }
    for (const r of [].concat(root)) cls[r] = 'sv-found';
    return { cls, edge };
  };
  const walkText = (p) => (p.length === 1 ? `${p[0]} 本身就是根` : `${p.join(' → ')}，S[${p.at(-1)}] < 0，${p.at(-1)} 是根`);

  for (const o of ops) {
    if (o.op === 'find') {
      const [x] = o.args;
      const p = pathOf(x);
      const root = p.at(-1);
      finds.push(root);
      steps.push({ view: snap({ ...pathCls([p], root), op: o.text, arr: { [x]: 'sv-cur', [root]: 'sv-found' } }), msg: `Find(${x})：从 ${x} 往上走：${walkText(p)}。结果是 ${root}（往上走了 ${p.length - 1} 步）。`, ask: { tag: 'root', kind: 'pick', q: `Find(${x}) 的结果是哪个？在图上点出 ${x} 所在集合的根。`, answer: String(root) } });
      if (compress && p.length >= 3) {
        const changed = compressPath(p);
        // 问路径上离根最近、被改了的那个（只改了第一个的错法在它身上看得出来）；题面按对的路径定，错法那一遍也问同一个
        const y = p.length >= 4 ? p[p.length - 3] : x;
        steps.push({ view: snap({ cls: { [root]: 'sv-found', ...Object.fromEntries(changed.map((c) => [c, 'sv-cur'])) }, fresh: changed, op: o.text, arr: Object.fromEntries(changed.map((c) => [c, 'sv-cur'])) }), msg: `路径压缩：路径上的 ${p.slice(0, -2).join('、')} 都直接挂到根 ${root} 下面（${p.slice(0, -2).map((c) => `S[${c}] = ${root}`).join('，')}）。以后再查它们，一步就到根。`, ask: { tag: 'parent', kind: 'number', q: `Find(${x}) 做完路径压缩以后，S[${y}] 是多少？`, answer: String(get(y)) }, asks: [arrAsk(`Find(${x}) 做完路径压缩以后，S 数组是什么？（S[${from}] 起，空格隔开）`)] });
      }
      continue;
    }
    const [a, b] = o.args;
    const pa = pathOf(a), pb = pathOf(b);
    const ra = pa.at(-1), rb = pb.at(-1);
    if (mistake === 'noroot') {
      // 错法：不找根，直接把 b 挂到 a 下面
      if (a !== b && rootOf(a) !== rootOf(b)) set(b, a);
      steps.push({ view: snap(), msg: '', ask: { tag: 'parent', kind: 'number', q: `Union(${a}, ${b}) 以后，S[${rb}] 是多少？`, answer: String(get(rb)) }, asks: [arrAsk(`Union(${a}, ${b}) 以后，S 数组是什么？（S[${from}] 起，空格隔开）`)] });
      continue;
    }
    steps.push({ view: snap({ ...pathCls([pa, pb], [ra, rb]), op: o.text, arr: { [ra]: 'sv-found', [rb]: 'sv-found' } }), msg: `Union(${a}, ${b})：先找两个根。Find(${a})：${walkText(pa)}；Find(${b})：${walkText(pb)}。` });
    if (compress && (pa.length >= 3 || pb.length >= 3)) {
      const ch = [...(pa.length >= 3 ? compressPath(pa) : []), ...(pb.length >= 3 ? compressPath(pb) : [])];
      const touched = [...pa.slice(0, -2), ...pb.slice(0, -2)];
      steps.push({ view: snap({ cls: { [ra]: 'sv-found', [rb]: 'sv-found', ...Object.fromEntries(ch.map((c) => [c, 'sv-cur'])) }, fresh: ch, op: o.text, arr: Object.fromEntries(ch.map((c) => [c, 'sv-cur'])) }), msg: `两次 Find 顺带做了路径压缩：${touched.map((c) => `S[${c}] = ${rootOf(c)}`).join('，')}。` });
    }
    if (ra === rb) {
      steps.push({ view: snap({ cls: { [ra]: 'sv-found' }, op: o.text }), msg: `两个根都是 ${ra}：${a}、${b} 已经在同一个集合里，不用合并。` });
      continue;
    }
    // 照王道的 Union(S, Root1, Root2)：Root1 = ra，Root2 = rb
    let child = rb, parent = ra, why;
    if (rank === 'size') {
      const s1 = count(ra), s2 = count(rb);
      if (s2 < s1) why = `${rb} 那棵 ${s2} 个结点，比 ${ra} 那棵（${s1} 个）少：小树并到大树，${rb} 挂到 ${ra} 下面`;
      else { child = ra; parent = rb; why = s1 === s2 ? `两棵一样大（各 ${s1} 个）：照王道的代码走 else，Root1 = ${ra} 挂到 Root2 = ${rb} 下面` : `${ra} 那棵 ${s1} 个结点，比 ${rb} 那棵（${s2} 个）少：小树并到大树，${ra} 挂到 ${rb} 下面`; }
    } else if (rank === 'height') {
      const h1 = height(ra), h2 = height(rb);
      if (h2 < h1) why = `${rb} 那棵高 ${h2}，比 ${ra} 那棵（高 ${h1}）矮：矮的挂到高的下面，${rb} 挂到 ${ra} 下`;
      else { child = ra; parent = rb; why = h1 === h2 ? `两棵一样高（都是 ${h1}）：照王道的代码走 else，Root1 = ${ra} 挂到 Root2 = ${rb} 下面，${rb} 那棵高度变成 ${h1 + 1}` : `${ra} 那棵高 ${h1}，比 ${rb} 那棵（高 ${h2}）矮：${ra} 挂到 ${rb} 下面`; }
    } else why = `把第二个的根挂到第一个的根下面（王道 Union(S, Root1, Root2)：S[Root2] = Root1），${rb} 挂到 ${ra} 下面`;
    if (mistake === 'flip') [child, parent] = [parent, child];
    if (size) set(parent, get(parent) + get(child));
    set(child, parent);
    steps.push({
      view: snap({ cls: { [parent]: 'sv-found', [child]: 'sv-cur' }, fresh: [child], edge: { [child]: 'sv-edge-path' }, op: o.text, arr: { [child]: 'sv-cur', ...(size ? { [parent]: 'sv-cur' } : {}) } }),
      msg: `${why}。${size ? `S[${parent}] = ${neg(get(parent))}（结点数加起来），` : ''}S[${child}] = ${parent}。`,
      ask: { tag: 'parent', kind: 'number', q: `Union(${a}, ${b}) 以后，S[${rb}] 是多少？`, answer: String(get(rb)) },
      asks: [arrAsk(`Union(${a}, ${b}) 以后，S 数组是什么？（S[${from}] 起，空格隔开）`)],
    });
  }
  const sets = setsOf(S, from);
  steps.push({ view: snap({ done: true }), msg: `做完了：一共 ${sets.length} 个集合 ${sets.map((x) => `{${x.join(', ')}}`).join(' ')}。S = ${S.map(neg).join(' ')}。` });
  return { steps, S: S.slice(), finds };
}

function setsOf(S, from) {
  const rootOf = (x) => { while (S[x - from] >= 0) x = S[x - from]; return x; };
  const m = new Map();
  S.forEach((_, i) => { const r = rootOf(i + from); if (!m.has(r)) m.set(r, []); m.get(r).push(i + from); });
  return [...m.values()];
}

// —— 画 ——

export function view(s, input) {
  const { from, n } = input;
  const nodes = {};
  for (let i = 0; i < n; i++) nodes[String(i + from)] = { key: String(i + from), kids: [] };
  const roots = [];
  for (let i = 0; i < n; i++) { const v = s.S[i]; if (v < 0) roots.push(String(i + from)); else nodes[String(v)].kids.push(String(i + from)); }
  const f = { roots, nodes };
  const svg = treesSvg({ nodes, pos: forestLayout(f, { gap: 0.5 }), edges: forestEdges(f) }, {
    cls: s.cls || {}, edge: s.edge || {}, fresh: (s.fresh || []).map(String), prefix: 'uf', aria: '并查集的森林', gapX: 52,
    pick: (id) => id, cmd: (id) => Number(id) - from + 1,
  });
  const arr = arrayView(s.S.map(neg), { base: from, cls: s.arr || {}, fresh: (s.fresh || []).map(Number), label: 'S' });
  const sets = setsOf(s.S, from);
  return `<div class="sv-uf">${svg}${arr}</div>${chips([['操作', s.op], ['集合', sets.map((x) => `{${x.join(',')}}`).join(' ')]])}`;
}

// —— 考卷 ——

const opsText = (input) => input.ops.map((o) => (o.op === 'union' ? `Union(${o.args.join(', ')})` : `Find(${o.args[0]})`)).join('、');
const ruleText = (input) => [input.rank === 'size' ? '小树并到大树，一样大时照王道的代码把第一个的根挂到第二个的根下' : input.rank === 'height' ? '按树高合并，一样高时第一个的根挂到第二个的根下' : '', input.compress ? 'Find 时做路径压缩' : '', input.size ? '根的 S 存 −结点数' : ''].filter(Boolean).join('，');

export function quiz(input, r) {
  const start = input.init ? `S 一开始是 ${input.init.map(neg).join(' ')}` : `${input.n} 个元素（${input.from}～${input.from + input.n - 1}）一开始各自一个集合`;
  const rule = ruleText(input);
  if (input.quiz === 'find') return { q: `${start}，依次执行 ${opsText(input)}${rule ? `（${rule}）` : ''}。依次写出每次 Find 的结果。`, type: 'seq', answer: r.finds.join(' ') };
  return { q: `${start}，依次执行 ${opsText(input)}${rule ? `（${rule}）` : ''}。写出最后的 S 数组（S[${input.from}] 起）。`, type: 'seq', answer: r.S.join(' ') };
}

// 每个操作做完以后的 S 数组（一行一个操作）；有 find 的再写结果
export function table(input) {
  const rows = [];
  const hasFind = input.ops.some((o) => o.op === 'find');
  input.ops.forEach((o, i) => {
    const r = run({ ...input, ops: input.ops.slice(0, i + 1) });
    const cells = r.S.map((v) => ({ v: String(v), num: true }));
    if (hasFind) cells.push(o.op === 'find' ? { v: String(r.finds.at(-1)), num: true } : { v: '', given: true });
    rows.push({ label: o.op === 'union' ? `Union(${o.args.join(', ')})` : `Find(${o.args[0]})`, cells });
  });
  const head = Array.from({ length: input.n }, (_, i) => `S[${i + input.from}]`);
  if (hasFind) head.push('Find 结果');
  const rule = ruleText(input);
  return { q: `依次执行下面的操作${rule ? `（${rule}）` : ''}，写出每做完一个以后的 S 数组${hasFind ? '，Find 再写出结果' : ''}。根写负数。`, qhtml: view(run({ ...input, ops: [] }).steps[0].view, input), dir: 'row', head, rows, copy: true };
}

export function problems(input) {
  const out = [];
  if (input.compress && !input.ops.some((o) => o.op === 'find') && !input.ops.some((o) => o.op === 'union')) out.push('compress: true 只在 Find 时起作用');
  return out;
}

// 常见错法（只给老师看）：最后的 S、每次 Find 的结果和对的一样的不列
export function variants(input) {
  const right = run(input);
  const same = (v) => { try { const r = run(v); return r.S.join() === right.S.join() && r.finds.join() === right.finds.join() && askAnswers(r) === askAnswers(right); } catch { return true; } };
  const out = [];
  const add = (label, v) => { if (!same(v)) out.push({ label, input: v }); };
  add(input.rank ? '像是大树挂到了小树下面（王道：小树并到大树，树才不会越来越高）' : '像是根接反了：把第一个的根挂到了第二个的根下面（王道 Union(S, Root1, Root2)：S[Root2] = Root1）', { ...input, mistake: 'flip' });
  if (input.compress) add('像是路径压缩只改了第一个结点（王道：从 x 到根这条路上的每个结点都直接挂到根下面）', { ...input, mistake: 'firstonly' });
  if (!input.rank) add('像是没先找根，直接把第二个元素挂到了第一个下面（王道：Union 先 Find 出两个根，再把根挂到根下面）', { ...input, mistake: 'noroot' });
  if (input.size) add('像是根里还写 −1，没存 −结点数（这里根的 S 存 −结点数，合并时加起来）', { ...input, mistake: 'nosize' });
  return out;
}
const askAnswers = (r) => r.steps.map((s) => (s.ask ? `${s.ask.q}=${s.ask.answer}` : '')).join('|');

export const ufEngine = { name: 'uf', title: '并查集', parse, run, view, quiz, table, problems, variants };
