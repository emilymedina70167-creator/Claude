// 哈夫曼树（组件 huffman）：n 个结点各自是一棵树，每次从森林里选根的权值最小的两棵（k 叉选 k 棵）合并，
// 新结点的权值是它们的和；并到只剩一棵。最后算 WPL、写编码（左 0 右 1；k 叉从左往右 0、1、2……）。
// 王道的口径：小的放左边；权值一样时先选原来就在的（新合并出的树放回森林的最后），这样画出来和教材的图一致
// （哈夫曼树本身不唯一，WPL 一定一样）。k 叉：(n − 1) mod (k − 1) ≠ 0 时先补权为 0 的虚结点。
// 纯函数，不碰 DOM（tests/trees2-engine.test.js）。画法在 forestview.js。
import { treesSvg, forestLayout, forestEdges, miniTable, panels } from './forestview.js';
import { chips } from './arrayview.js';

const MAX_LEAVES = 16;

// —— 写法 ——

/** weights: 7 5 2 4，或者带名字 a:7 b:5 c:2 d:4（也认 a=7、a(7)） */
export function parseWeights(src) {
  const toks = String(src ?? '').trim().split(/[\s,，、;；]+/).filter(Boolean);
  if (!toks.length) throw new Error('weights: 不能为空，写成 7 5 2 4，或者带上字符 a:7 b:5 c:2 d:4');
  const out = toks.map((t) => {
    let m = /^([^:：=()（）]+)\s*[:：=]\s*(.+)$/.exec(t) || /^([^:：=()（）]+)[(（](.+)[)）]$/.exec(t);
    const name = m ? m[1] : '';
    const num = m ? m[2] : t;
    if (!/^\d+(\.\d+)?$/.test(num)) throw new Error(`weights: 「${t}」里的权值要是非负的数（像 7、0.15），${m ? '' : '带名字写成 a:7'}`);
    return { name, text: num };
  });
  const named = out.filter((x) => x.name).length;
  if (named && named !== out.length) throw new Error('weights: 要么都带名字（a:7 b:5），要么都不带（7 5 2 4），不能混着写');
  if (out.length < 2) throw new Error('weights: 至少要两个权值');
  if (out.length > MAX_LEAVES) throw new Error(`weights: 最多 ${MAX_LEAVES} 个（现在 ${out.length} 个），一屏才放得下`);
  const dup = out.map((x) => x.name.toUpperCase()).find((k, i, a) => k && a.indexOf(k) !== i);
  if (dup) throw new Error(`weights: 名字「${dup}」写了两次`);
  // 小数换成整数算（乘 10 的几次方），WPL 不会有 0.30000000004 这种
  const dec = Math.max(...out.map((x) => (x.text.split('.')[1] || '').length));
  const scale = 10 ** dec;
  return { leaves: out.map((x) => ({ name: x.name, w: Math.round(Number(x.text) * scale) })), scale, dec };
}

export function parse(fields) {
  if (fields.weights === undefined) throw new Error('huffman 要写 weights:（如 7 5 2 4，或 a:7 b:5 c:2 d:4）');
  const { leaves, scale, dec } = parseWeights(fields.weights);
  const k = fields.k === undefined || String(fields.k).trim() === '' ? 2 : Number(fields.k);
  if (!Number.isInteger(k) || k < 2 || k > 5) throw new Error(`k: 写 2 到 5 的整数（几叉哈夫曼树，默认 2）（现在是「${fields.k}」）`);
  const q = String(fields.quiz ?? '').trim().toLowerCase();
  if (q && !['wpl', 'code', 'codes', '编码'].includes(q)) throw new Error(`quiz: 写 wpl（默认）或 code（写出每个字符的编码）（现在是「${fields.quiz}」）`);
  return { leaves, scale, dec, k, quiz: q && q !== 'wpl' ? 'code' : 'wpl' };
}

// 权值写回去（乘过的再除回来）
const showW = (input, w) => (input.scale === 1 ? String(w) : String(Number((w / input.scale).toFixed(input.dec))));

// —— 构造 ——

/**
 * mistake：'nopad'（k 叉不补虚结点，最后一次并剩下的几棵）、'chain'（每次拿刚合并出的树和下一个最小的并）、
 * 'allsum'（WPL 算成所有结点权值之和）——错法只拿来和学生的答案比，不演示
 */
export function run(input) {
  const { leaves, k, mistake } = input;
  const all = {}; // id → { w, name, dummy, kids, label, cmd }；建好就不变，每一步只记森林里有哪些根
  const used = new Map();
  const labelOf = (text) => { const n = used.get(text.toUpperCase()) || 0; used.set(text.toUpperCase(), n + 1); return text + '′'.repeat(n); };
  let seq = 0;
  const make = (w, extra = {}) => { const id = `h${++seq}`; all[id] = { w, name: '', dummy: false, kids: [], ...extra, cmd: seq }; return id; };
  let roots = leaves.map((x) => { const id = make(x.w, { name: x.name }); all[id].label = labelOf(x.name || showW(input, x.w)); return id; });
  // 画的时候森林从左往右的次序：新树放在选中的里最左边那棵的位置（选权值一样的时候才按 roots 的先后：新的排最后），
  // 这样合并时子树只往旁边挪一点，不会横穿别的树
  let place = roots.slice();
  const W = (id) => showW(input, all[id].w);
  const desc = (id) => (all[id].name ? `${all[id].name}（${W(id)}）` : all[id].dummy ? '虚结点 0' : W(id));
  const steps = [];
  const snap = (extra = {}) => ({ all, roots: place.slice(), ...extra });
  const n = leaves.length;
  steps.push({ view: snap(), msg: `${n} 个结点各自是一棵树，组成森林。每次从森林里选根的权值最小的${k === 2 ? '两' : ` ${k} `}棵，作为一个新结点的子树（小的放左边），新结点的权值是它们的和；重复，直到只剩一棵。权值一样时先选原来就在的，后选新合并出来的。` });

  // k 叉：要补几个虚结点
  const pad = k === 2 ? 0 : (k - 1 - ((n - 1) % (k - 1))) % (k - 1);
  if (k > 2) {
    const real = mistake === 'nopad' ? 0 : pad;
    if (real) {
      const dummies = Array.from({ length: real }, () => { const id = make(0, { dummy: true }); all[id].label = labelOf('0'); return id; });
      roots = [...dummies, ...roots];
      place = [...dummies, ...place];
      steps.push({ view: snap({ fresh: dummies, cls: Object.fromEntries(dummies.map((d) => [d, 'sv-cur'])) }), msg: `${k} 叉哈夫曼树每次并 ${k} 棵，要正好并成一棵，结点数 n 要满足 (n − 1) mod (${k} − 1) = 0。现在 n = ${n}，(${n} − 1) mod ${k - 1} = ${(n - 1) % (k - 1)}：补 ${real} 个权为 0 的虚结点（画成虚线圈），它们最小，会最先被并掉。`, ask: dummyAsk(k, n, real) });
    } else {
      steps.push({ view: snap(), msg: `${k} 叉哈夫曼树每次并 ${k} 棵。n = ${n}，(${n} − 1) mod ${k - 1} = 0，正好能并成一棵，不用补虚结点。`, ask: dummyAsk(k, n, 0) });
    }
  }

  const merges = []; // 每次合并选了哪些权值、新结点的权值（填表、错法比较用）
  let newest = null;
  let round = 0;
  while (roots.length > 1) {
    round++;
    const take = Math.min(k, roots.length);
    // 按权值排，一样的保持森林里的先后（原来的在前、新的在后）
    const order = roots.map((id, i) => [id, i]).sort((a, b) => all[a[0]].w - all[b[0]].w || a[1] - b[1]).map((x) => x[0]);
    let chosen = order.slice(0, take);
    if (mistake === 'chain' && newest && roots.includes(newest)) {
      // 错法：刚合并出的那棵必选，再配上别的里最小的
      chosen = [newest, ...order.filter((x) => x !== newest).slice(0, take - 1)];
      chosen.sort((a, b) => all[a].w - all[b].w || roots.indexOf(a) - roots.indexOf(b));
    }
    const sum = chosen.reduce((s, id) => s + all[id].w, 0);
    const id = make(sum, { kids: chosen });
    all[id].label = labelOf(showW(input, sum));
    const before = roots.slice();
    roots = [...roots.filter((x) => !chosen.includes(x)), id];
    const at = Math.min(...chosen.map((x) => place.indexOf(x)));
    place = place.filter((x) => !chosen.includes(x));
    place.splice(at, 0, id);
    newest = id;
    merges.push({ ws: chosen.map((x) => all[x].w), sum });
    const alts = pickAlts(before, chosen, all);
    const ask = take >= 2 ? {
      tag: 'pick', kind: 'pick', count: take, q: `第 ${round} 次合并：选哪${take === 2 ? '两' : ` ${take} `}棵树？在图上点出它们的根。`,
      answer: chosen.map((x) => all[x].label), alts, display: chosen.map(desc).join('、'),
      explain: alts.length > 1 ? '权值一样的选哪个都对（哈夫曼树不唯一，WPL 一样）；这里照先选原来就在的画。' : '',
    } : undefined;
    steps.push({ view: snap({ cls: { ...Object.fromEntries(chosen.map((x) => [x, 'sv-cur'])), [id]: 'sv-done' }, fresh: [id] }), msg: `第 ${round} 次合并：根的权值最小的是 ${chosen.map(desc).join('、')}，合成新结点 ${chosen.map(W).join(' + ')} = ${W(id)}${take === 2 ? '（小的在左）' : '（从小到大从左往右）'}。${roots.length > 1 ? `森林里还剩 ${roots.length} 棵。` : '只剩一棵了：哈夫曼树建好了。'}${take < k ? `（只剩 ${take} 棵，凑不齐 ${k} 棵）` : ''}`, ask });
  }
  const root = roots[0];

  // 路径长度、编码
  const depth = {}, code = {};
  const walk = (id, d, c) => { depth[id] = d; code[id] = c; all[id].kids.forEach((x, i) => walk(x, d + 1, c + String(i))); };
  walk(root, 0, '');
  const real = Object.keys(all).filter((id) => !all[id].kids.length && !all[id].dummy && depth[id] !== undefined);
  const wpl = real.reduce((s, id) => s + all[id].w * depth[id], 0);
  const internal = Object.keys(all).filter((id) => all[id].kids.length && depth[id] !== undefined);
  const leafSum = real.reduce((s, id) => s + all[id].w, 0);
  const shown = mistake === 'allsum' ? wpl + leafSum : wpl;
  const S = (w) => showW(input, w);
  const terms = real.map((id) => `${S(all[id].w)}×${depth[id]}`).join(' + ');
  // 等长编码比一比（权值是次数时才有意义：都是整数）
  const fixed = k === 2 && input.scale === 1 ? Math.max(1, Math.ceil(Math.log2(n))) : 0;
  steps.push({
    view: snap({ depth, wpl: true }),
    msg: `WPL = Σ 叶结点的权值 × 路径长度（根到它有几条边）= ${terms} = ${S(wpl)}。也等于所有非叶结点的权值之和：${internal.map((id) => S(all[id].w)).join(' + ')} = ${S(wpl)}。${fixed ? `（等长编码每个字符要 ⌈log₂${n}⌉ = ${fixed} 位，一共 ${S(leafSum)} × ${fixed} = ${S(leafSum * fixed)} 位；哈夫曼编码一共 ${S(wpl)} 位。）` : ''}`,
    ask: { tag: 'wpl', kind: 'number', q: '这棵哈夫曼树的带权路径长度 WPL 是多少？', answer: S(shown) },
  });
  // 编码：问码最长的那个（一样长问先写的）
  const target = real.slice().sort((a, b) => depth[b] - depth[a] || all[a].cmd - all[b].cmd)[0];
  const tname = all[target].name ? all[target].name : `权为 ${S(all[target].w)} 的叶结点`;
  const digits = k === 2 ? '左 0 右 1' : `从左往右 0、1${k > 2 ? '、2' : ''}${k > 3 ? '……' : ''}`;
  steps.push({
    view: snap({ depth, wpl: true, codes: code }),
    msg: `编码：从根往下走，${digits}，到叶子写下来的就是它的编码。哈夫曼编码是前缀编码：没有哪个字符的编码是另一个的前缀，连着写也能唯一地拆开。`,
    ask: { tag: 'code', kind: 'text', q: `写出 ${tname} 的哈夫曼编码（${digits}）。`, answer: `${code[target]} | ${[...code[target]].join(' ')}` },
  });
  // 整棵树有几层：画布从第一步起就按这个高度留好，森林里的树都「底对齐」画（见 view）
  const levels = Math.max(...Object.values(depth)) + 1;
  for (const st of steps) st.view.levels = levels;
  return { steps, wpl, shown, code, depth, all, root, merges, real, pad };
}

function dummyAsk(k, n, pad) {
  return { tag: 'dummy', kind: 'number', q: `${n} 个叶结点建 ${k} 叉哈夫曼树，要补几个权为 0 的虚结点？`, answer: String(pad) };
}

// 选法不唯一时（权值一样），哪几组都算对：权值小于最大那个的必选，最大那个权值的在并列的里随便挑
function pickAlts(roots, chosen, all) {
  const ws = chosen.map((x) => all[x].w);
  const top = Math.max(...ws);
  const must = roots.filter((x) => all[x].w < top);
  const tie = roots.filter((x) => all[x].w === top);
  const need = chosen.length - must.length;
  const out = [];
  const pick = (from, k, acc) => {
    if (out.length > 200) return;
    if (k === 0) { out.push([...must, ...acc].map((x) => all[x].label)); return; }
    for (let i = from; i <= tie.length - k; i++) pick(i + 1, k - 1, [...acc, tie[i]]);
  };
  if (must.length + tie.length >= chosen.length && need >= 0) pick(0, need, []);
  const mine = chosen.map((x) => all[x].label);
  const key = (a) => a.map((x) => x.toUpperCase()).sort().join('|');
  return [mine, ...out.filter((a) => key(a) !== key(mine))];
}

// —— 画 ——

export function view(s, input) {
  const all = s.all;
  const nodes = {};
  const walk = (id) => { nodes[id] = { key: all[id].label, kids: all[id].kids }; all[id].kids.forEach(walk); };
  s.roots.forEach(walk);
  const f = { roots: s.roots, nodes };
  // 合并到一半时每棵树按「最下面一层对齐到画布底」画：合并时高的那棵子树不用往下挪，新的根长在上面，
  // 树是一层层往上长出来的；最后只剩一棵时就是平常从上往下的样子
  const pos = forestLayout(f, { gap: 0.5 });
  const height = (id) => 1 + Math.max(0, ...all[id].kids.map(height));
  const levels = s.levels || Math.max(...s.roots.map(height));
  const shift = {};
  const mark = (id, k) => { shift[id] = k; all[id].kids.forEach((c) => mark(c, k)); };
  for (const r of s.roots) mark(r, levels - height(r));
  for (const id of Object.keys(pos)) pos[id] = { x: pos[id].x, d: pos[id].d + shift[id] };
  const cls = { ...(s.cls || {}) };
  for (const id of Object.keys(nodes)) if (all[id].dummy) cls[id] = `${cls[id] || ''} sv-dummy`.trim();
  const edgeText = {};
  if (s.codes) for (const id of Object.keys(nodes)) all[id].kids.forEach((c, i) => { edgeText[c] = String(i); });
  const svg = treesSvg({ nodes, pos, edges: forestEdges(f) }, {
    cls, fresh: s.fresh || [], edgeText, prefix: 'hf', aria: '哈夫曼树', gapX: 54,
    text: (id) => showW(input, all[id].w),
    sub: (id) => (all[id].kids.length ? '' : all[id].dummy ? '虚' : all[id].name),
    // 路径长度写在叶子下面（写在右上角会压到旁边的边和 0 / 1）
    sub2: (id) => (s.wpl && !all[id].kids.length && !all[id].dummy ? `×${s.depth[id]}` : ''),
    pick: (id) => all[id].label, cmd: (id) => all[id].cmd, key: (id) => id,
  });
  let h = svg;
  const S = (w) => showW(input, w);
  if (s.wpl) {
    // 表放在树旁边（放不下就到下面）：算 WPL 那一步填到「权 × 长」，编码那一步再填上编码（码长就是路径长度）。
    // 两步用同一张表、编码那一列先留着宽度：表一样宽，换步时树不挪（挪了的话新出现的 0 / 1 会和还在滑的字叠在一起）。
    // 没写字符名的不要「字符」那一列
    const leaves = Object.keys(all).filter((id) => !all[id].kids.length && !all[id].dummy).sort((a, b) => all[a].cmd - all[b].cmd);
    const named = input.leaves.some((x) => x.name);
    const tbl = miniTable([...(named ? ['字符'] : []), '权值', '路径长度', '权 × 长', { html: '编码', cls: 'sv-code' }], leaves.map((id) => [...(named ? [all[id].name] : []), S(all[id].w), s.depth[id], S(all[id].w * s.depth[id]), { html: s.codes ? `<b>${s.codes[id]}</b>` : '', cls: 'sv-code' }]));
    h = panels([['', svg], ['', tbl]]);
  }
  const pairs = [];
  if (s.roots.length > 1) pairs.push(['森林里的根', s.roots.map((id) => S(all[id].w)).join(' ')]);
  if (s.wpl) pairs.push(['WPL', S(Object.keys(all).filter((id) => !all[id].kids.length && !all[id].dummy).reduce((t, id) => t + all[id].w * s.depth[id], 0))]);
  return h + chips(pairs);
}

// —— 考卷 ——

export function quiz(input, r) {
  const ws = input.leaves.map((x) => (x.name ? `${x.name}:${showW(input, x.w)}` : showW(input, x.w))).join(' ');
  const kk = input.k === 2 ? '' : ` ${input.k} 叉`;
  if (input.quiz === 'code') {
    const leaves = r.real.slice().sort((a, b) => r.all[a].cmd - r.all[b].cmd);
    const names = leaves.map((id) => r.all[id].name || showW(input, r.all[id].w));
    return { q: `对 ${ws} 构造${kk}哈夫曼树（小的放左边，权值一样先选原来就在的），按 ${names.join(' ')} 的顺序写出它们的编码（${input.k === 2 ? '左 0 右 1' : '从左往右 0、1、2……'}）。`, type: 'seq', answer: leaves.map((id) => r.code[id]).join(' ') };
  }
  return { q: `对 ${ws} 构造${kk}哈夫曼树，它的带权路径长度 WPL 是多少？`, type: 'num', answer: showW(input, r.shown) };
}

// 每次合并选了哪几个权值（不管先后）、新结点的权值；表下面写 WPL
export function table(input, r) {
  const k = input.k;
  const rows = r.merges.map((m, i) => ({ label: `第 ${i + 1} 次`, cells: [...Array.from({ length: k }, (_, j) => (j < m.ws.length ? { v: showW(input, m.ws[j]), group: 'f' } : { v: '', given: true })), { v: showW(input, m.sum), num: true }] }));
  return {
    q: `对 ${input.leaves.map((x) => showW(input, x.w)).join(' ')} 构造${k === 2 ? '' : ` ${k} 叉`}哈夫曼树：写出每次合并选的${k === 2 ? '两' : ` ${k} `}个根的权值（不管先后）和新结点的权值，再写 WPL。`,
    qhtml: '', dir: 'row', head: [...Array.from({ length: k }, (_, j) => `选的 ${j + 1}`), '新结点'], rows,
    extra: [{ label: 'WPL', v: showW(input, r.shown), num: true }],
  };
}

export function problems(input, r) {
  const out = [];
  if (input.quiz === 'code' && r.steps.some((s) => s.ask?.tag === 'pick' && s.ask.alts.length > 1)) out.push('权值有一样的，选法不唯一，学生画的树可能和页面的不一样，编码也就不一样：quiz: code 可能把对的判错，换成 quiz: wpl（WPL 是唯一的）');
  return out;
}

// 常见错法（只给老师看）：答案和对的一样的不列
export function variants(input) {
  const right = run(input);
  const out = [{ label: '像是把所有结点的权值都加起来了，或者路径长度按层数算、多算了一层（王道：WPL = Σ 叶结点权值 × 路径长度（根到它的边数），也等于所有非叶结点的权值之和）', input: { ...input, mistake: 'allsum' } }];
  if (input.k > 2 && right.pad > 0) out.push({ label: `像是 ${input.k} 叉没补虚结点，最后一次凑不齐 ${input.k} 棵（王道：(n − 1) mod (k − 1) ≠ 0 时先补 ${right.pad} 个权为 0 的虚结点，每次都并 ${input.k} 棵）`, input: { ...input, mistake: 'nopad' } });
  const chain = { ...input, mistake: 'chain' };
  try {
    const c = run(chain);
    if (c.wpl !== right.wpl || c.merges.map((m) => m.sum).join() !== right.merges.map((m) => m.sum).join()) out.push({ label: '像是每次都拿刚合并出的树去和下一个最小的并（王道：新树放回森林，每次在整个森林里选根权值最小的）', input: chain });
  } catch { /* 这组数上算不了 */ }
  return out;
}

export const huffmanEngine = { name: 'huffman', title: '哈夫曼树', parse, run, view, quiz, table, problems, variants };
