// 代码逐行跟踪（组件 trace）：把一段 C 代码真的跑一遍（cinterp.js），一行一步：左边代码高亮当前行，右边变量、数组、调用栈、输出，
// 有结构体、指针时下面再画一张堆的图：结点画成框（一个成员一格），指针画成箭头（NULL 是 ∧），链表从左往右排，二叉链表画成树。
// 纯函数，不碰 DOM（tests/cinterp.test.js）。写法：
//   call: InsertSort(A, 5)          从哪个函数开始（代码里有 main 就不用写）
//   let A = [0, 38, 49, 65, 13, 27] 给的输入（数组、数），一行一个
//   let L = list [头, 1, 2, 3]       单链表（带头结点；不写「头」就是不带）；let T = tree A(B(D), C) 二叉链表
//   pointers: i, j                  哪些变量当成下标，画在数组格子下面（不写就找 i j k low high mid 这类名字）
//   predict: 7 if i == 4 -> j       先猜：执行第 7 行（i == 4 那一次）之后 j 是多少（几个用 ; 隔开）；-> p 问 p 指向哪个结点
//   code:                           放在最后，下面全是代码
import { parseProgram, runProgram, parseExpression, CError, structMeta, circ } from '../cinterp.js';
import { parseFields } from '../parse.js';
import { arrayView, esc } from './arrayview.js';
import { parseTree, parseLevel } from './tree.js';

const AUTO_PTR = ['i', 'j', 'k', 'low', 'high', 'mid', 'left', 'right', 'l', 'r', 'p', 'q', 'front', 'rear', 'top', 'min', 'max', 'pos'];
const HEAD = /^(头|头结点|head|h)$/i;

// 字段只在 code: 前面（代码里的 default:、标号 L1: 不能当成字段）
export function head(src) {
  const lines = String(src ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*code\s*[:：]\s*$/i.test(l));
  return (at < 0 ? lines : lines.slice(0, at)).join('\n');
}

export function parse(_fields, src) {
  const lines = String(src ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*code\s*[:：]\s*$/i.test(l));
  void _fields?.code;
  if (at < 0) throw new Error('trace 要写 code:（单独一行），下面是代码；code: 放在最后');
  const head = lines.slice(0, at);
  const code = lines.slice(at + 1).join('\n').replace(/^\n+|\s+$/g, '');
  if (!code) throw new Error('code: 下面没有代码');
  const vars = {};
  const rest = [];
  for (const l of head) {
    const m = /^\s*let\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*$/.exec(l);
    if (m) { vars[m[1]] = parseValue(m[2], m[1]); continue; }
    rest.push(l);
  }
  // 自己再读一遍 let 以外的字段；读的时候也经过外壳传进来的 _fields，外壳才知道哪些字段用上了（拼写检查）
  const own = parseFields(rest.join('\n')).fields;
  const fields = new Proxy(own, { get: (t, k) => { if (_fields && typeof k === 'string') void _fields[k]; return t[k]; } });
  let program;
  try { program = parseProgram(code); } catch (e) { throw new Error(e instanceof CError ? `代码${e.message}` : e.message); }
  let entry = null;
  if (fields.call) {
    try { entry = { src: fields.call.trim(), e: parseExpression(fields.call.trim()) }; } catch (e) { throw new Error(`call: 看不懂「${fields.call}」：${e.message}`); }
    if (entry.e.t !== 'call') throw new Error('call: 要写成函数调用，比如 InsertSort(A, 5)');
    if (!program.funcs[entry.e.name]?.body) throw new Error(`call: 代码里没有函数 ${entry.e.name}`);
  } else if (!program.funcs.main) throw new Error('代码里没有 main：写 call:（从哪个函数开始，如 call: InsertSort(A, 5)），用 let 给输入');
  const pointers = fields.pointers ? fields.pointers.split(/[\s,，、]+/).filter(Boolean) : null;
  const predicts = fields.predict ? String(fields.predict).split(/[;；\n]+/).map((x) => x.trim()).filter(Boolean).map(parsePredict) : [];
  const nLines = code.split('\n').length;
  for (const p of predicts) if (p.line < 1 || p.line > nLines) throw new Error(`predict: 代码只有 ${nLines} 行，没有第 ${p.line} 行`);
  const quiz = String(fields.quiz || '').trim();
  return { code, program, entry, vars, pointers, predicts, quiz, structs: structMeta(program), nLines };
}

// let 的值：数、字符 'a'、数组 [1, 2]、二维 [[1, 2], [3, 4]]、字符串 "abc"（字符数组）、
//   链表 list [头, 1, 2, 3]（第一个写「头」是带头结点）、二叉树 tree A(B(D, E), C)（括号写法，同 tree 组件；也认层序 A B C # D）
function parseValue(src, name) {
  const s = src.trim();
  let m = /^(?:list|链表)\s*\[(.*)\]$/i.exec(s);
  if (m) {
    const items = m[1].split(/[,，\s]+/).filter(Boolean).map((x) => x.replace(/^'(.)'$/, '$1'));
    const hasHead = items.length > 0 && HEAD.test(items[0]);
    if (hasHead) items.shift();
    if (items.length > 30) throw new Error(`let ${name}：链表最多 30 个结点`);
    if (items.some((x) => HEAD.test(x))) throw new Error(`let ${name}：「头」只能写在最前面（带头结点）`);
    return { list: items, head: hasHead };
  }
  m = /^(?:tree|树)\s+(.+)$/i.exec(s);
  if (m) {
    try { return { tree: /[()]/.test(m[1]) || !/[\s,，、]/.test(m[1].trim()) ? parseTree(m[1]) : parseLevel(m[1]) }; } catch (e) { throw new Error(`let ${name} = tree …：${e.message}`); }
  }
  if (/^"(.*)"$/.test(s)) return [...s.slice(1, -1)];
  if (/^'.'$/.test(s)) return s[1];
  try {
    const v = JSON.parse(s.replace(/'(.)'/g, '"$1"'));
    const ok = (x) => typeof x === 'number' || (typeof x === 'string' && x.length === 1);
    if (ok(v) || (Array.isArray(v) && v.length && (v.every(ok) || v.every((r) => Array.isArray(r) && r.length === v[0].length && r.every(ok))))) return v;
  } catch { /* 下面报错 */ }
  throw new Error(`let ${name} = ${s}：写数、字符 'a'、数组 [1, 2, 3]、二维数组 [[1, 2], [3, 4]]、链表 list [头, 1, 2, 3] 或二叉树 tree A(B, C)`);
}

// predict: 7 if i == 4 -> j
// 问号前后的分隔：→、=>，或者两边有空格的 ->（p->next 里的 -> 是 C 的成员运算，不能当分隔）
function splitPredict(src) {
  const at = (re) => { const m = re.exec(src); return m ? [src.slice(0, m.index), src.slice(m.index + m[0].length)] : null; };
  return at(/\s*(?:→|=>)\s*/) || at(/\s+->\s+/) || at(/\s*->\s*/);
}
function parsePredict(src) {
  const parts = splitPredict(src);
  const h = parts && /^(\d+)\s*(?:if\s+(.+?))?\s*$/i.exec(parts[0]);
  const m = h && parts[1].trim() ? [null, h[1], h[2], parts[1].trim()] : null;
  if (!m) throw new Error(`predict: 看不懂「${src}」，写成「7 if i == 4 -> j」（执行第 7 行、i == 4 的那一次之后，问 j；问指针写 9 -> p->next，-> 两边留空格）`);
  const side = (e, what) => {
    let ast;
    try { ast = parseExpression(e); } catch (x) { throw new Error(`predict: ${what}「${e}」写错了：${x.message}`); }
    const bad = (x) => x && typeof x === 'object' && (['assign', 'incdec', 'call'].includes(x.t) || Object.values(x).some((v) => (Array.isArray(v) ? v.some(bad) : bad(v))));
    if (bad(ast)) throw new Error(`predict: ${what}「${e}」里不能有赋值、自增或函数调用`);
    return ast;
  };
  return { line: Number(m[1]), condSrc: m[2]?.trim() || '', cond: m[2] ? side(m[2], '条件') : null, takeSrc: m[3].trim(), take: side(m[3], '要问的') };
}

// 先猜问的是指针：写它指向的结点的 data（头结点写「头」），空指针写 NULL
function pointerAsk(w, q0) {
  const p = w.ptr;
  const field = p.field || 'data';
  const hint = `写那个结点的 ${field}${p.tree ? '' : '，指向头结点写「头」'}，空指针写 NULL`;
  const q = `${q0}，${w.w.takeSrc} 指向哪个结点？（${hint}）`;
  if (p.null) return { tag: 'predict', kind: 'text', q, answer: 'NULL|∧|空|null|空指针', display: 'NULL（空指针）' };
  if (p.id) {
    if (p.key === undefined) return { tag: 'predict', kind: 'text', q, answer: '头|头结点|head', display: `头结点${circ(p.id)}` };
    const k = /^'.'$/.test(p.key) ? p.key.slice(1, -1) : p.key;
    return { tag: 'predict', kind: 'text', q, answer: k === p.key ? k : `${k}|${p.key}`, display: `${field} 是 ${k} 的结点${circ(p.id)}` };
  }
  return { tag: 'predict', kind: 'text', q: `${q0}，${w.w.takeSrc} 指向谁？`, answer: `${p.other.replace(/^&/, '')}|${p.other}`, display: p.other };
}

export function run(input) {
  const watchers = input.predicts.map((p) => ({ ...p }));
  const r = runProgram(input.program, { entry: input.entry, vars: input.vars, watchers });
  // 还没走第一步就出错（let 给的链表对不上代码里的结构体）：是写法问题，报给作者
  if (!r.steps.length && r.error) throw new Error(r.error.message);
  const steps = [];
  let prev = null;
  for (const s of r.steps) {
    const changed = diff(prev, s);
    const st = { view: { ...s, changed }, msg: s.line ? `第 ${s.line} 行：${s.msg}` : s.msg };
    const w = s.asks?.[0];
    if (w && w.value !== undefined && !w.whole) {
      const q0 = `执行第 ${w.w.line} 行${w.w.condSrc ? `（${w.w.condSrc} 的那一次）` : ''}之后`;
      if (w.ptr) st.ask = pointerAsk(w, q0);
      else {
        const isChar = /^'.'$/.test(w.value);
        st.ask = { tag: 'predict', kind: isChar ? 'text' : 'number', q: `${q0}，${w.w.takeSrc} 是多少？`, answer: isChar ? w.value.slice(1, -1) : Number(w.value), display: w.value };
      }
    } else if (s.line && s.kind === 'cond') {
      st.ask = { tag: 'cond', kind: 'choice', q: `第 ${s.line} 行的条件这次成立吗？`, choices: ['成立', '不成立'], answer: s.cond ? '成立' : '不成立' };
    } else if (s.line) {
      st.ask = { tag: 'line', kind: 'number', q: '接下来执行第几行？', answer: s.line };
    }
    steps.push(st);
    prev = s;
  }
  // 出错的那一步：画面停在出错前，红的是出错的那一行（不是上一步那一行）
  if (r.error) steps.push({ view: { ...(prev || {}), line: r.error.line || prev?.line, changed: [], error: true }, msg: `运行出错：${r.error.message}` });
  const asked = r.steps.flatMap((s) => s.asks || []);
  const unasked = watchers.filter((w) => !asked.some((a) => a.w === w));
  const badAsks = asked.filter((a) => a.value === undefined || a.whole);
  return { steps, out: r.out, error: r.error, arrays: r.arrays, unasked, badAsks, leaks: r.leaks || [], final: r.steps.at(-1) };
}

// 两步之间哪些变量、数组格子、结点的成员变了（画面上闪一下）；新出现的结点记成 h编号
function diff(a, b) {
  if (!a) return [];
  const out = [];
  const flat = (s) => {
    const m = new Map();
    s.globals.forEach((v) => put(m, 'g', v));
    s.frames.forEach((f, i) => f.vars.forEach((v) => put(m, `f${i}`, v)));
    (s.heap || []).forEach((n) => { m.set(`h${n.id}`, n.freed ? 'freed' : 'node'); (n.fields || []).forEach((f) => put(m, `h${n.id}`, f, '.')); });
    return m;
  };
  const put = (m, where, v, sep = ':') => {
    if (v.data) v.data.forEach((x, i) => m.set(`#${v.arr}[${i}]`, x));
    if (v.elems) v.elems.forEach((fs, i) => (fs || []).forEach((f) => { if (!f.data && !f.fields) m.set(`#${v.arr}[${i}].${f.name}`, f.value); }));
    else if (v.fields) v.fields.forEach((f) => put(m, `${where}${sep}${v.name}`, f, '.'));
    else if (!v.arr) m.set(`${where}${sep}${v.name}`, v.value);
  };
  const A = flat(a), B = flat(b);
  for (const [k, v] of B) if (A.has(k) ? A.get(k) !== v : /^h\d+$/.test(k)) out.push(k);
  return out;
}

// —— 画 ——

// 堆的图：尺寸（SVG 的单位，和屏幕上的 px 一样大，放不下时整张缩小）
const NH = 30; // 结点框的高
const GAPX = 30; // 链表里相邻两个结点之间（放箭头）
const LABEL = 26; // 结点上面写指针名字
const ROWH = LABEL + NH + 30; // 一行链表：名字 + 框 + 下面的编号和空隙
const ROW_W = 560; // 一行最宽多少，超了就换行
const PAD = 10;
const TREE_GAP = 10; // 树里中序相邻的两个结点之间
const TREE_LEVEL = NH + 44; // 树的层距

const textW = (t) => [...String(t)].reduce((s, c) => s + (/[⺀-￿]/.test(c) ? 14 : 8.6), 0);

// 每种结点的格子：二叉链表 [lchild | data | rchild]，双链表 [prior | data | next]，单链表 [data | next]（王道的画法）
function cellOrder(meta) {
  const names = meta.fields.filter((f) => !f.arr).map((f) => f.name);
  const sh = meta.shape;
  const first = [sh.left, sh.prior].filter(Boolean);
  const last = [sh.right, sh.next].filter(Boolean);
  return [...first, ...names.filter((n) => !first.includes(n) && !last.includes(n)), ...last];
}

// 指针变量（当前这一层、全局；结构体变量里的指针成员写成 Q.front）→ 它指着的结点。changed 里的键用来标「这一步变了」
function anchorsOf(s) {
  const frames = s.frames || [];
  const top = frames.length - 1;
  const seen = new Map();
  const add = (v, where) => {
    if (seen.has(v.name)) return;
    const list = [];
    if (v.ptr && typeof v.to === 'number') list.push({ name: v.name, to: v.to, key: `${where}:${v.name}`, dangling: !!v.dangling });
    for (const f of v.fields || []) if (f.ptr && typeof f.to === 'number') list.push({ name: `${v.name}.${f.name}`, to: f.to, key: `${where}:${v.name}.${f.name}`, dangling: !!f.dangling });
    seen.set(v.name, list);
  };
  if (top >= 0) [...frames[top].vars].reverse().forEach((v) => add(v, `f${top}`)); // 里层的同名变量挡住外层的
  (s.globals || []).forEach((v) => add(v, 'g'));
  const order = top >= 0 ? frames[top].vars.map((v) => v.name) : [];
  const names = [...new Set([...order, ...(s.globals || []).map((v) => v.name)])];
  return names.flatMap((n) => seen.get(n) || []);
}

// 结构体数组里有指针成员的（邻接表的顶点表 G.vertices、VNode v[N]）：画在堆的图的最左边一列。
// 当前这一层和全局的变量里找；只画到最后一个有值的元素
function tablesOf(s, structs) {
  const frames = s.frames || [];
  const top = frames.length - 1;
  const out = [];
  const seen = new Set();
  const add = (name, v) => {
    if (!v.elems || seen.has(name) || !structs[v.tag]?.fields.some((f) => f.ptr !== null)) return;
    seen.add(name);
    let last = -1;
    v.elems.forEach((fs, i) => { if (fs?.some((f) => f.value !== '?')) last = i; });
    if (last >= 0) out.push({ name, tag: v.tag, arr: v.arr, elems: v.elems.slice(0, last + 1) });
  };
  const look = (v) => { add(v.name, v); for (const f of v.fields || []) add(`${v.name}.${f.name}`, f); };
  if (top >= 0) [...frames[top].vars].reverse().forEach(look);
  (s.globals || []).forEach(look);
  return out;
}

/**
 * 堆上结点的位置：{ pos: Map(编号 → { x, y, w, cells: [{ name, x, w }], tree }), W, H, rows }。
 * tables（tablesOf）：顶点表的每个元素当成一个「行首」（编号写成 T表.下标），它指着的那条链接在同一行
 */
export function layoutHeap(nodes, structs, anchors = [], tables = []) {
  const heads = tables.flatMap((t, k) => t.elems.map((fs, i) => ({ id: `T${k}.${i}`, tag: t.tag, fields: fs || [], trow: { k, i } })));
  const all = [...heads, ...nodes.filter((n) => !n.block)];
  const byId = new Map(all.map((n) => [n.id, n]));
  const metaOf = (n) => structs[n.tag] || { fields: (n.fields || []).map((f) => ({ name: f.name, ptr: f.ptr ? '' : null })), shape: {} };
  const rank = new Map();
  anchors.forEach((a, i) => { if (!rank.has(a.to)) rank.set(a.to, i); });
  const order = (x, y) => (rank.has(x.id) ? rank.get(x.id) : 1e4 + x.id) - (rank.has(y.id) ? rank.get(y.id) : 1e4 + y.id);
  const ptrTo = (n, field) => { const f = field && n.fields.find((x) => x.name === field); return f && typeof f.to === 'number' && byId.has(f.to) ? f.to : null; };
  // 格子宽：放得下这一步里同一种结点最长的值
  const widths = {};
  for (const n of all) {
    const m = metaOf(n);
    const w = (widths[n.tag] ||= Object.fromEntries(cellOrder(m).map((c) => [c, m.fields.find((f) => f.name === c)?.ptr !== null ? 26 : 34])));
    for (const f of n.fields) if (!f.ptr && w[f.name] !== undefined) w[f.name] = Math.max(w[f.name], Math.ceil(textW(String(f.value ?? '').replace(/^'(.)'$/, '$1')) + 14));
  }
  const pos = new Map();
  const place = (n, x, y, tree = false) => {
    const cells = [];
    let cx = x;
    for (const c of cellOrder(metaOf(n))) { cells.push({ name: c, x: cx, w: widths[n.tag][c] }); cx += widths[n.tag][c]; }
    pos.set(n.id, { x, y, w: cx - x, cells, tree });
  };
  const nodeW = (n) => Object.values(widths[n.tag]).reduce((a, b) => a + b, 0);
  let y = PAD;
  let W = 0;
  const live = nodes.filter((n) => !n.block);
  const lset = new Set(live.map((n) => n.id));
  const used = new Set();
  const rows = [];
  const nxt = (n) => { const t = ptrTo(n, metaOf(n).shape.next); return t !== null && lset.has(t) && !pos.has(t) ? t : null; };
  const follow = (id) => { const c = []; while (id !== null && !used.has(id) && !pos.has(id)) { used.add(id); c.push(id); id = nxt(byId.get(id)); } return c; };
  // 0. 顶点表：表名、每个元素一行，元素的第一个指针成员指着的链接在后面
  const tableAt = [];
  for (const [k, t] of tables.entries()) {
    y += 14; // 表名
    const tx = PAD + 20; // 左边写下标
    const tw = Math.max(...heads.filter((h) => h.trow.k === k).map(nodeW));
    tableAt.push({ x: tx, y: y + LABEL - 6, name: t.name });
    for (const h of heads.filter((x) => x.trow.k === k)) {
      place(h, tx, y + LABEL);
      const first = metaOf(h).fields.find((f) => f.ptr !== null && !f.arr)?.name;
      const head = ptrTo(h, first);
      const chain = head !== null && lset.has(head) ? follow(head) : [];
      let x = tx + tw + GAPX + 6;
      for (const id of chain) { const n = byId.get(id); place(n, x, y + LABEL); x += nodeW(n) + GAPX; }
      W = Math.max(W, x - GAPX + 14, tx + tw + 14);
      rows.push({ ids: [h.id, ...chain], wrapNext: false, table: k, y: y + LABEL });
      y += LABEL + NH + 8;
    }
    y += 10;
  }
  // 1. 二叉链表：每棵树中序排横坐标、按层排纵坐标
  const treeNodes = live.filter((n) => !pos.has(n.id) && metaOf(n).shape.tree);
  if (treeNodes.length) {
    const tset = new Set(treeNodes.map((n) => n.id));
    // 线索二叉树：ltag / rtag 是 1 的那边是线索，不是孩子
    const thread = (n, side) => n.fields.find((f) => f.name === side)?.value === '1';
    const kids = (n) => { const sh = metaOf(n).shape; return [thread(n, 'ltag') ? null : ptrTo(n, sh.left), thread(n, 'rtag') ? null : ptrTo(n, sh.right)].map((c) => (c !== null && tset.has(c) ? c : null)); };
    const incoming = new Set(treeNodes.flatMap((n) => kids(n).filter((c) => c !== null)));
    const roots = [...treeNodes.filter((n) => !incoming.has(n.id)).sort(order), ...treeNodes.filter((n) => incoming.has(n.id)).sort(order)];
    const done = new Set();
    for (const r of roots) {
      if (done.has(r.id)) continue;
      const items = [];
      const walk = (id, d) => {
        if (id === null || done.has(id)) return;
        done.add(id);
        const n = byId.get(id);
        const [l, rr] = kids(n);
        walk(l, d + 1);
        items.push({ n, d });
        walk(rr, d + 1);
      };
      walk(r.id, 0);
      const step = Math.max(...items.map((it) => nodeW(it.n))) + TREE_GAP;
      const maxD = Math.max(...items.map((it) => it.d));
      const left = PAD + 22; // 左边留出写指针名字的地方
      items.forEach((it, i) => place(it.n, left + i * step + (step - TREE_GAP - nodeW(it.n)) / 2, y + LABEL + it.d * TREE_LEVEL, true));
      W = Math.max(W, left + items.length * step);
      y += LABEL + maxD * TREE_LEVEL + NH + 24;
    }
  }
  // 2. 链表：顺着 next 串成一条条链，一条链一行（长了换行，接着的行往右缩一点，留出绕过来的线）；有指针指着的链排在前面
  const rest = live.filter((n) => !pos.has(n.id) && !used.has(n.id));
  const inc = new Set(rest.map(nxt).filter((t) => t !== null));
  const chains = [];
  for (const n of rest.filter((x) => !inc.has(x.id)).sort(order)) if (!used.has(n.id)) chains.push(follow(n.id));
  for (const n of [...rest].sort(order)) if (!used.has(n.id)) chains.push(follow(n.id)); // 环（循环链表）
  // 单个的、不是链表的结点（别的结构体）凑一行
  const loners = chains.filter((c) => c.length === 1 && !metaOf(byId.get(c[0])).shape.next).flat();
  const own = [];
  for (const c of chains) {
    if (c.length === 1 && loners.includes(c[0])) continue;
    let row = [];
    let w = 0;
    let indent = 0;
    for (const id of c) {
      const nw = nodeW(byId.get(id)) + GAPX;
      if (row.length && indent + w + nw > ROW_W + GAPX) { own.push({ ids: row, wrapNext: true, indent }); row = []; w = 0; indent = 18; }
      row.push(id);
      w += nw;
    }
    own.push({ ids: row, wrapNext: false, indent });
  }
  if (loners.length) own.push({ ids: loners, wrapNext: false, indent: 0 });
  for (const r of own) {
    let x = PAD + r.indent;
    for (const id of r.ids) { const n = byId.get(id); place(n, x, y + LABEL); x += nodeW(n) + GAPX; }
    W = Math.max(W, x - GAPX + 14);
    r.y = y + LABEL;
    rows.push(r);
    y += ROWH;
  }
  return { pos, W: Math.max(W + PAD, 120), H: y + 4, rows, heads, tableAt };
}

// 一个结点（或顶点表的一行）的格子：值写在格子里，指针格子里 NULL 写 ∧、没赋值写 ?（有箭头的格子由箭头画起点的圆点）
function cellsSvg(n, p, { changedKey, fresh, keyName, cmd, pos }) {
  let g = '';
  p.cells.forEach((c, i) => {
    const f = n.fields.find((x) => x.name === c.name);
    if (changedKey(c.name) && !fresh) g += `<rect class="tr-hchg" x="${c.x + 1}" y="${p.y + 1}" width="${c.w - 2}" height="${NH - 2}"/>`;
    if (i) g += `<line class="tr-div" x1="${c.x}" y1="${p.y}" x2="${c.x}" y2="${p.y + NH}"/>`;
    const cx = c.x + c.w / 2, cy = p.y + NH / 2;
    if (!f) return;
    if (f.ptr) {
      if (f.wild) g += `<text class="tr-cv tr-unset" x="${cx}" y="${cy}">?</text>`;
      else if (f.to === null) g += `<text class="tr-cv tr-null" x="${cx}" y="${cy + 1}">∧</text>`;
      else if (!(typeof f.to === 'number' && pos.has(f.to))) g += `<text class="tr-cv tr-unset" x="${cx}" y="${cy}">•</text>`;
    } else {
      // 结点里的字符不带引号（王道的图里写 A，不写 'A'）
      const v = String(f.value ?? '').replace(/^'(.)'$/, '$1');
      const lab = c.name === keyName && cmd ? ` data-cmd="${cmd}" data-label="${esc(v)}"` : '';
      g += `<text class="tr-cv${f.value === '?' ? ' tr-unset' : ''}${textW(v) > c.w - 6 ? ' tr-small' : ''}"${lab} x="${cx}" y="${cy}">${esc(f.fields ? '{…}' : v)}</text>`;
    }
  });
  return g;
}

function heapSvg(s, input, changed) {
  const nodes = (s.heap || []).filter((n) => !n.block);
  const structs = input.structs || {};
  const tables = tablesOf(s, structs);
  if (!nodes.length && !tables.length) return { html: '', drawn: new Set() };
  const anchors = anchorsOf(s);
  const { pos, W, H, rows, heads, tableAt } = layoutHeap(nodes, structs, anchors, tables);
  const byId = new Map([...heads, ...nodes].map((n) => [n.id, n]));
  const cmd = (id) => (input.nLines || 0) + id;
  const rowOf = new Map();
  rows.forEach((r, i) => r.ids.forEach((id, k) => rowOf.set(id, { row: i, k })));
  // 这一步变了的成员：堆上的结点是 h编号.成员，顶点表的元素是 #数组[下标].成员（diff 里的键）
  const keyOf = (n, field) => (n.trow ? `#${tables[n.trow.k].arr}[${n.trow.i}].${field}` : `h${n.id}.${field}`);
  let edges = '', boxes = '', labels = '';
  // 顶点表
  for (const t of tableAt) boxes += `<text class="tr-tname" x="${t.x}" y="${t.y - LABEL + 14}">${esc(t.name)}</text>`;
  for (const h of heads) {
    const p = pos.get(h.id);
    boxes += `<g class="tr-trow" data-key="t:${esc(tables[h.trow.k].name)}[${h.trow.i}]"><text class="tr-tidx" x="${p.x - 6}" y="${p.y + NH / 2}">${h.trow.i}</text><rect class="tr-box" x="${p.x}" y="${p.y}" width="${p.w}" height="${NH}" rx="3"/>${cellsSvg(h, p, { changedKey: (f) => changed.has(keyOf(h, f)), fresh: false, keyName: null, pos })}</g>`;
  }
  // 结点
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const fresh = changed.has(`h${n.id}`) && !n.freed;
    const cls = ['tr-node', fresh ? 'sv-new' : '', n.freed ? 'tr-freed' : '', n.leaked ? 'tr-leak' : ''].filter(Boolean).join(' ');
    let g = `<g class="${cls}" data-key="h${n.id}" data-cmd="${cmd(n.id)}" data-label="${circ(n.id)}"><rect class="tr-box" x="${p.x}" y="${p.y}" width="${p.w}" height="${NH}" rx="3"/>`;
    g += cellsSvg(n, p, { changedKey: (f) => changed.has(keyOf(n, f)), fresh, keyName: structs[n.tag]?.shape.key, cmd: cmd(n.id), pos });
    // 编号（malloc 的先后）：链表写在框的左下，树写在右上（左下有边）；释放了、泄漏了的写在那里
    const tag = n.freed ? '已释放' : n.leaked ? '泄漏' : '';
    g += p.tree
      ? `<text class="tr-nid" x="${p.x + p.w}" y="${p.y - 4}" text-anchor="end">${circ(n.id)}${tag ? ` ${tag}` : ''}</text>`
      : `<text class="tr-nid" x="${p.x + 1}" y="${p.y + NH + 13}">${circ(n.id)}${tag ? ` ${tag}` : ''}</text>`;
    boxes += `${g}</g>`;
  }
  // 箭头：从指针格子的中心出发，指到结点的框
  const sh = (n) => structs[n.tag]?.shape || {};
  for (const n of [...heads, ...nodes]) {
    const p = pos.get(n.id);
    if (!p) continue;
    const s0 = sh(n);
    for (const c of p.cells) {
      const f = n.fields.find((x) => x.name === c.name);
      if (!f?.ptr || typeof f.to !== 'number' || !pos.has(f.to)) continue;
      const t = pos.get(f.to);
      const tn = byId.get(f.to);
      const ck = changed.has(keyOf(n, c.name));
      // 已释放的结点里的指针不能再用：画成淡的虚线
      const cls = `tr-arrow${ck ? ' tr-arrow-new' : ''}${tn.freed ? ' tr-arrow-bad' : ''}${n.freed ? ' tr-arrow-dead' : ''}`;
      const mk = tn.freed ? 'tr-ah-bad' : ck ? 'tr-ah-new' : 'tr-ah';
      const sx = c.x + c.w / 2;
      const dy = s0.prior ? (c.name === s0.prior ? 5 : c.name === s0.next ? -5 : 0) : 0;
      const sy = p.y + NH / 2 + dy;
      const a = rowOf.get(n.id), b = rowOf.get(f.to);
      let path = null, line = null;
      if (p.tree && t.tree) {
        line = [sx, sy, t.x + t.w / 2, t.y - 1];
      } else if (a && b && a.row === b.row && b.k === a.k + 1) {
        line = [sx, sy, t.x - 1, t.y + NH / 2 + dy];
      } else if (a && b && a.row === b.row && b.k === a.k - 1 && c.name === s0.prior) {
        line = [sx, sy, t.x + t.w + 1, t.y + NH / 2 + dy];
      } else if (a && b && b.row === a.row + 1 && b.k === 0 && rows[a.row].wrapNext && c.name === s0.next) {
        // 换行：从行尾绕下来接到下一行的开头
        const midY = p.y + NH + 20;
        path = `M${sx} ${sy}H${p.x + p.w + 12}V${midY}H${t.x - 12}V${t.y + NH / 2}H${t.x - 1}`;
      } else if (a && b && a.row === b.row) {
        // 同一行不挨着（循环链表的尾指回头、跳过几个）：从下面绕过去
        const bx = t.x + t.w / 2, by = t.y + NH + 1;
        const dip = Math.max(p.y, t.y) + NH + 22;
        path = `M${sx} ${sy}C${sx} ${dip} ${bx} ${dip} ${bx} ${by}`;
      } else {
        // 别的行：指到框的上边或下边（下边靠右一点，左下角写着编号）
        const below = t.y > p.y;
        line = [sx, sy, below ? t.x + t.w / 2 : t.x + t.w * 0.65, below ? t.y - 1 : t.y + NH + 1];
      }
      edges += `<circle class="tr-dot" cx="${sx}" cy="${sy}" r="3"/>`;
      if (line) edges += `<line class="${cls}" data-key="e${n.id}.${c.name}" x1="${line[0]}" y1="${line[1]}" x2="${line[2]}" y2="${line[3]}" marker-end="url(#${mk})"/>`;
      else edges += `<path class="${cls}" d="${path}" marker-end="url(#${mk})"/>`;
    }
  }
  // 指针变量的名字：链表写在结点上面、箭头朝下；树写在结点左边
  const groups = new Map();
  for (const a of anchors) if (pos.has(a.to)) (groups.get(a.to) || groups.set(a.to, []).get(a.to)).push(a);
  for (const [id, list] of groups) {
    const p = pos.get(id);
    const ws = list.map((a) => textW(a.name) + 14);
    if (p.tree) {
      // 树：名字从框的左边往左排（上面有连到双亲的边）
      let x = p.x - 5;
      list.slice().reverse().forEach((a, k) => {
        labels += plabel(a, x, p.y + NH / 2 + 5, 'end', null, changed, cmd(id));
        x -= ws[list.length - 1 - k];
      });
      continue;
    }
    const total = ws.reduce((x, y) => x + y, 0);
    let x = p.x + p.w / 2 - total / 2;
    list.forEach((a, k) => {
      const cx = x + ws[k] / 2;
      const tx = Math.min(Math.max(cx, p.x + 6), p.x + p.w - 6);
      labels += plabel(a, cx, p.y - 14, 'middle', [cx, p.y - 11, tx, p.y - 2], changed, cmd(id));
      x += ws[k];
    });
  }
  const defs = '<defs>'
    + ['tr-ah', 'tr-ah-new', 'tr-ah-bad', 'tr-ah-ptr'].map((id) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" class="${id}"/></marker>`).join('')
    + '</defs>';
  const tags = [...new Set([...tables.map((t) => t.tag), ...nodes.map((n) => n.tag)])].filter((t) => structs[t]);
  const cap = tags.map((t) => `${esc(structs[t].name)}：${cellOrder(structs[t]).map(esc).join(' | ')}`).join('；');
  const html = `<div class="tr-heap"><svg class="tr-heap-svg" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" width="${Math.ceil(W)}" style="max-width:100%" role="img" aria-label="堆上的结点">${defs}${boxes}${edges}${labels}</svg><div class="tr-heap-cap">${cap}　∧ 是 NULL，? 是还没赋值${nodes.length ? '，①②③ 是 malloc 的先后' : ''}</div></div>`;
  return { html, drawn: new Set(tables.map((t) => t.name)) };
}
// 一个指针变量的名字（和它指着的结点同一个 data-cmd：课堂里 label=p 标的就是 p 指着的结点）
function plabel(a, x, y, anchor, arrow, changed, cmd) {
  const cls = `tr-plabel${changed.has(a.key) ? ' tr-plabel-new' : ''}${a.dangling ? ' tr-plabel-bad' : ''}`;
  const mk = a.dangling ? 'tr-ah-bad' : changed.has(a.key) ? 'tr-ah-new' : 'tr-ah-ptr';
  return `<g class="${cls}" data-key="v:${esc(a.name)}" data-cmd="${cmd}" data-label="${esc(a.name)}"><text x="${x}" y="${y}" text-anchor="${anchor}">${esc(a.name)}</text>${arrow ? `<line x1="${arrow[0]}" y1="${arrow[1]}" x2="${arrow[2]}" y2="${arrow[3]}" marker-end="url(#${mk})"/>` : ''}</g>`;
}

// 变量的小牌子：指针写「p → ③」/「p NULL」，没赋值的指针写「p ?」
function chipValue(v) {
  if (v.ptr) {
    if (v.wild) return '<span class="tr-wild">?</span>';
    if (v.to === null) return '<span class="tr-nullv">NULL</span>';
    if (typeof v.to === 'number') return `→ ${circ(v.to)}${v.dangling ? '<small class="tr-bad">（已释放）</small>' : ''}`;
    return `→ ${esc(v.target || '')}`;
  }
  return esc(v.value);
}

// 结构体数组（没画进堆的图的）：一行一个元素，一列一个成员
function structTable(label, a, changed) {
  const cols = a.elems.find(Boolean)?.map((f) => f.name) || [];
  let t = `<table class="sv-gtbl sv-tab tr-2d"><thead><tr><th>${esc(label)}</th>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`;
  a.elems.forEach((fs, i) => { t += `<tr><th>${i}</th>${(fs || []).map((f) => `<td class="${changed.has(`#${a.arr}[${i}].${f.name}`) ? 'sv-chg' : ''}">${f.data ? '[…]' : f.fields ? '{…}' : chipValue(f)}</td>`).join('')}</tr>`; });
  return `<div class="tr-arr">${t}</tbody></table></div>`;
}

// 结构体变量（SqList L、LinkQueue Q）：一张小卡片，成员一个个写；数组成员画成一排格子，top / front / rear 画在格子下面
function structCard(v, where, changed, ptrNames, drawn) {
  const scal = v.fields.filter((f) => !f.data);
  const chips = scal.map((f) => `<span class="tr-var${changed.has(`${where}:${v.name}.${f.name}`) ? ' sv-new tr-chg' : ''}"><b>${esc(f.name)}</b> ${f.fields ? '{…}' : chipValue(f)}</span>`).join('');
  let arrs = '';
  for (const f of v.fields.filter((x) => x.data)) {
    if (f.elems) { if (!drawn.has(`${v.name}.${f.name}`)) arrs += structTable(f.name, f, changed); continue; }
    const ptr = {};
    for (const s2 of scal) {
      if (!ptrNames.includes(s2.name) || s2.ptr) continue;
      const k = Number(s2.value);
      if (Number.isInteger(k) && k >= 0 && k < f.data.length) ptr[k] = ptr[k] ? `${ptr[k]},${s2.name}` : s2.name;
    }
    const fresh = f.data.map((_, i) => i).filter((i) => changed.has(`#${f.arr}[${i}]`));
    arrs += `<div class="tr-arr"><div class="tr-arr-name">${esc(f.name)}</div>${f.dims.length === 1 ? arrayView(f.data.map((x) => (x === '?' ? null : x)), { base: 0, ptr, fresh, cls: Object.fromEntries(fresh.map((i) => [i, 'sv-cmp'])), pick: false }) : `<div class="muted">${esc(f.name)}[…]</div>`}</div>`;
  }
  return `<div class="tr-st"><div class="tr-st-h"><b>${esc(v.name)}</b>${v.ref ? '<small>&amp;</small>' : ''} <span>${esc(v.struct)}</span></div>${chips ? `<div class="tr-vars">${chips}</div>` : ''}${arrs}</div>`;
}

export function view(s, input) {
  const lines = input.code.split('\n');
  const cur = s.line;
  const code = `<pre class="tr-code">${lines.map((l, i) => `<span class="tr-line${i + 1 === cur ? ' tr-cur' : ''}${s.error && i + 1 === cur ? ' tr-err' : ''}" data-cmd="${i + 1}" data-pick="${i + 1}" data-label=""><i>${i + 1}</i>${esc(l) || ' '}</span>`).join('')}</pre>`;
  const changed = new Set(s.changed || []);
  const frames = s.frames || [];
  const top = frames.length - 1;
  // 数组：自己定义的（有 data 的）都画；下标变量画在格子下面
  const arrays = [];
  const seen = new Set();
  const collect = (vars) => vars.forEach((v) => { if (v.data && !seen.has(v.arr)) { seen.add(v.arr); arrays.push(v); } });
  collect(s.globals || []);
  frames.forEach((f) => collect(f.vars));
  // malloc 来的一串（malloc(sizeof(int) * n)）：也画成数组，名字写成 ③
  for (const b of (s.heap || []).filter((n) => n.block && !seen.has(n.arr))) { seen.add(b.arr); arrays.push({ name: circ(b.id), arr: b.arr, dims: [b.data.length], data: b.data, block: b }); }
  // 当前这一层的引用名：InsertSort 里的 A 指向全局的 A；指向 malloc 来的那一串的指针写在名字后面
  const alias = {};
  if (top >= 0) for (const v of frames[top].vars) if (v.ref && v.arr) (alias[v.arr] ||= []).push(v.name);
  const topVars = top >= 0 ? frames[top].vars : [];
  for (const a of anchorsOf({ ...s, heap: [] })) { const b = (s.heap || []).find((n) => n.block && n.id === a.to); if (b) (alias[b.arr] ||= []).push(a.name); }
  const ptrNames = input.pointers || AUTO_PTR;
  const heap = heapSvg(s, input, changed);
  let arrHtml = '';
  for (const a of arrays) {
    const label = a.block ? `${circ(a.block.id)}（malloc 的）${(alias[a.arr] || []).length ? ` ← ${alias[a.arr].join('、')}` : ''}` : [a.name, ...(alias[a.arr] || []).filter((x) => x !== a.name)].join(' = ');
    if (a.elems) {
      // 结构体数组：有指针成员的（邻接表的顶点表）画在堆的图里，别的画成表
      if (!heap.drawn.has(a.name)) arrHtml += structTable(label, a, changed);
    } else if (a.dims.length === 1) {
      const ptr = {};
      for (const v of topVars) {
        if (!ptrNames.includes(v.name) || v.data || v.arr || v.ptr) continue;
        const k = Number(v.value);
        if (Number.isInteger(k) && k >= 0 && k < a.dims[0]) ptr[k] = ptr[k] ? `${ptr[k]},${v.name}` : v.name;
      }
      const fresh = a.data.map((_, i) => i).filter((i) => changed.has(`#${a.arr}[${i}]`));
      arrHtml += `<div class="tr-arr"><div class="tr-arr-name">${esc(label)}</div>${arrayView(a.data.map((x) => (x === '?' ? null : x)), { base: 0, ptr, fresh, cls: Object.fromEntries(fresh.map((i) => [i, 'sv-cmp'])), pick: false })}</div>`;
    } else {
      const [R, C] = a.dims;
      let t = `<table class="sv-gtbl sv-tab tr-2d"><thead><tr><th>${esc(label)}</th>${Array.from({ length: C }, (_, j) => `<th>${j}</th>`).join('')}</tr></thead><tbody>`;
      for (let i = 0; i < R; i++) t += `<tr><th>${i}</th>${Array.from({ length: C }, (_, j) => { const k = i * C + j; return `<td class="${changed.has(`#${a.arr}[${k}]`) ? 'sv-chg' : ''}">${esc(a.data[k])}</td>`; }).join('')}</tr>`;
      arrHtml += `<div class="tr-arr">${t}</tbody></table></div>`;
    }
  }
  // 变量：当前这一层的（数组、引用的数组不再写；结构体变量画成卡片），下面一行写调用栈
  const cards = [];
  const scal = (vars, where) => vars.filter((v) => !v.data && !(v.ref && v.arr)).map((v) => {
    if (v.fields) { cards.push(structCard(v, where, changed, ptrNames, heap.drawn)); return ''; }
    return `<span class="tr-var${v.ptr ? ' tr-ptrv' : ''}${changed.has(`${where}:${v.name}`) ? ' sv-new tr-chg' : ''}"><b>${esc(v.name)}</b>${v.ref ? '<small>&amp;</small>' : ''} ${chipValue(v)}</span>`;
  }).join('');
  const vars = top >= 0 ? scal(frames[top].vars, `f${top}`) : '';
  const glob = scal(s.globals || [], 'g');
  const stack = frames.length ? `<div class="tr-stack">${frames.map((f, i) => `<span class="${i === top ? 'tr-top' : ''}">${esc(f.fn)}${f.args ? `(${esc(f.args)})` : '()'}</span>`).join('<i>→</i>')}</div>` : '';
  const out = s.out ? `<div class="tr-out"><div class="tr-out-h">输出</div><pre>${esc(s.out)}</pre></div>` : '';
  // 代码里有结构体就一直用有堆的图的排版（第一次 malloc 时版面不跳）
  const heapy = !!heap.html || Object.keys(input.structs || {}).length > 0;
  const wrap = `<div class="tr-wrap${heapy ? ' tr-heapy' : ''}">${code}<div class="tr-state">${stack}${vars ? `<div class="tr-vars">${vars}</div>` : ''}${glob ? `<div class="tr-vars tr-glob"><span class="tr-vars-h">全局</span>${glob}</div>` : ''}${cards.join('')}${arrHtml}${out}</div>${heap.html}</div>`;
  // 有堆的图时套一层，按组件自己的宽度排版（styles.css 的容器查询）
  return heapy ? `<div class="tr-cq">${wrap}</div>` : wrap;
}

export function quiz(input, r) {
  const what = input.quiz || (r.out ? 'output' : '');
  if (what === 'output') {
    if (!r.out) throw new Error('quiz: output，但这段代码没有输出');
    return { q: '这段代码运行后输出什么？（按顺序写出输出的内容，用空格隔开）', qhtml: `<pre class="tr-code tr-code-q">${esc(input.code)}</pre>`, type: 'seq', answer: r.out.trim().split(/\s+/).join(' ') };
  }
  const name = what || Object.keys(input.vars).find((k) => Array.isArray(input.vars[k]));
  if (!name) throw new Error('quiz: 写 output（问输出）或者一个数组的名字（问运行结束后这个数组的内容）');
  const v = [...(r.final?.globals || []), ...(r.final?.frames || []).flatMap((f) => f.vars)].find((x) => x.name === name && x.data);
  if (!v) throw new Error(`quiz: 运行结束时找不到数组 ${name}（只能问全局的或者 let 给的数组；链表的题用 quiz: output，代码里把链表输出出来）`);
  const call = input.entry ? `执行 ${input.entry.src}` : '运行';
  return { q: `${call}之后，数组 ${name} 是什么？（从下标 0 开始，用空格隔开）`, qhtml: `<pre class="tr-code tr-code-q">${esc(input.code)}</pre>`, type: 'seq', answer: v.data.join(' ') };
}

export function problems(input, r) {
  const out = [];
  if (r.error) out.push(`代码运行出错了：${r.error.message}（学生会看到出错的那一行；如果不是有意的，改一下代码或输入）`);
  for (const w of r.unasked) out.push(`predict: 「${w.line}${w.condSrc ? ` if ${w.condSrc}` : ''} -> ${w.takeSrc}」一直没走到（条件没成立过），这个问题不会出现`);
  for (const a of r.badAsks || []) {
    const w = a.w;
    const what = `predict: 「${w.line}${w.condSrc ? ` if ${w.condSrc}` : ''} -> ${w.takeSrc}」`;
    if (a.whole) out.push(`${what}问的是整个结构体或数组，学生没法写：问一个成员（-> p->data）、一个元素，或者指针本身（-> p，答它指向哪个结点）`);
    else out.push(`${what}那一次取不到值（${w.error || '算不出来'}），这个问题不会出现${/NULL/.test(w.error || '') ? '；想问它是不是空，写 -> p（学生答 NULL）' : ''}`);
  }
  if (r.leaks?.length && !r.error) out.push(`代码里有结点没 free、也没有指针指着了（内存泄漏：${r.leaks.map(circ).join('')}），学生会在那一步和最后一步看到提醒；如果不是有意的，检查一下删除结点的地方`);
  return out;
}

export const traceEngine = { name: 'trace', title: '代码跟踪', head, parse, run, view, quiz, problems, defaultAsk: (input) => (input.predicts.length ? 'predict' : '') };
