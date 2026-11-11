// 舞台上的一排格子（排序、查找、哈希……）：数据和指令，不碰 DOM（画法在 array.view.js）。纯函数，有测试。
// 每种东西都照这个样子写（types/index.js 注册）：
//   type / label / create（造它的指令）/ make（造出来的数据）/ parts（全部部件）/ pick（部件的写法 → 部件）/ ref（跟着它走的写法）
//   partBox / objectBox / obstacles（贴字要让开的地方）/ commands（自己的指令：(scene, c, h) → 要点）/ describe（给老师看的现状）
//   hint（写法提示，舞台上有这种东西时给老师看一次）/ doc（说明书里的一节）/ example（说明里的例子，测试照抄来演）/ drag（能不能拖）
import { CELL, GAP, ROW_GAP, SPLIT_GAP, IDX_H, PTR_H, bbox, strideGroups } from '../layout.js';
import { parseRef } from '../script.js';
// 懂排序的那一半（sort 指令写明在做哪种排序以后）：每一趟借 engines/sort.js 的引擎，规则在 array.rules.js
import { SORTS, STEP_SORTS, planOf, textsOf, sortLine } from './array.sort.js';

export const MAX_CELLS = 16;
const COLORS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };

// —— 排版（场景和画面共用）——
export const rowY = (row) => (row ? CELL + SPLIT_GAP + (row - 1) * (CELL + ROW_GAP) : 0);
export const slotBox = (o, slot) => ({ x: o.origin.x + (slot - 1) * (CELL + GAP), y: o.origin.y, w: CELL, h: CELL });
export function cellBox(o, c) {
  const s = slotBox(o, c.slot);
  return { x: s.x, y: s.y + rowY(c.row) - (c.lift ? 12 : 0), w: CELL, h: CELL };
}
export function ptrBox(o, slot, k = 0) {
  const s = slotBox(o, slot);
  return { x: s.x - 8, y: s.y + CELL + IDX_H + 2 + k * PTR_H, w: CELL + 16, h: PTR_H };
}
export function ptrBoxes(o) {
  const out = [];
  const at = new Map();
  for (const [name, slot] of o.ptrs || []) { const k = at.get(slot) || 0; at.set(slot, k + 1); out.push({ obj: o.id, name, slot, ...ptrBox(o, slot, k) }); }
  return out;
}
function objectBox(o) {
  const boxes = [];
  for (let i = 1; i <= o.cells.length; i++) { const s = slotBox(o, i); boxes.push({ ...s, h: CELL + IDX_H }); }
  for (const c of o.cells) boxes.push(cellBox(o, c));
  boxes.push(...ptrBoxes(o));
  return bbox(boxes);
}

/** 按隔 d 个重新分组：这一排原来的连线收掉，每组染一种颜色、连起来（只有一组就不染） */
export function regroup(scene, o, d) {
  o.groupD = d;
  const gone = [];
  // 只收这一排自己的格子之间的线：整样东西到整样东西的那一道（link a b）不是分组画的
  for (const [k, l] of scene.links) if (l.a.obj === o.id && !l.whole) { scene.links.delete(k); gone.push(k); }
  for (const [k, l] of scene.labels) if (l.link && gone.includes(l.link)) scene.labels.delete(k);
  const groups = strideGroups(o.cells.length, d);
  const made = [];
  groups.forEach((g, gi) => {
    const cells = g.map((s) => o.cells.find((x) => x.slot === s));
    const color = groups.length === 1 ? null : COLORS[gi % COLORS.length];
    cells.forEach((x) => { x.paint = color; });
    if (color) for (let i = 0; i + 1 < cells.length; i++) made.push({ key: scene.addLink(cells[i], cells[i + 1], color, gi) || scene.linkKey(cells[i], cells[i + 1]), group: gi });
  });
  return { id: o.id, groups: groups.length, gone, made };
}

const FLAGS = ['paint', 'glow', 'lift', 'dim', 'covered'];

const one = (h, list, what) => {
  const ps = h.partsIn(list);
  if (!ps.length) throw new Error(`${what}要指着一格`);
  return ps[0];
};
const sameArray = (a, b, what) => { if (a.obj !== b.obj) throw new Error(`${what}的两格要在同一排格子里`); };

// 希尔的 d 跟着的拨数拨了：这一趟换成新的 d，从现在这一排起算
function redial(o, v) {
  const s = o.sort;
  if (!s) return null;
  s.d = v;
  if (!s.src) s.from = textsOf(o);
  return { id: o.id, sort: s.algo };
}
/**
 * 分开排着（split）时现状怎么说：泳道里正好是隔 groupD 个的那几组才说「每组下到自己的一排」；没分过组就 split 的、
 * 之后换了位置 / 重新分了组、泳道里的牌已经不是那几组的，照实写每条泳道现在是哪几格（以前一律说「每组下到自己的一排」）
 */
function lanesText(o) {
  const lanes = new Map();
  for (const c of o.cells) if (c.row) lanes.set(c.row, [...(lanes.get(c.row) || []), c.slot]);
  if (!lanes.size) return '';
  const key = (xs) => [...xs].sort((a, b) => a - b).join(',');
  const now = [...lanes.values()].map(key).sort().join('|');
  const groups = o.groupD ? strideGroups(o.cells.length, o.groupD).map(key).sort().join('|') : null;
  if (o.cells.every((c) => c.row) && now === groups) return '，每组下到自己的一排';
  if (!o.groupD && lanes.size === 1 && o.cells.every((c) => c.row)) return '，整排下到了下面一排（没分过组）';
  const list = [...lanes].sort(([a], [b]) => a - b).map(([r, xs]) => `第 ${r} 条是第 ${[...xs].sort((a, b) => a - b).join('、')} 格`).join('，');
  return `，分开排着 ${lanes.size} 条泳道，可泳道里已经不是${o.groupD ? `隔 ${o.groupD} 个的那几组` : '分好的组'}了：${list}`;
}

export const array = {
  type: 'array',
  label: '一排格子',
  create: ['array'],
  // 认得的选项（名字=值，scene.js 的 checkOptions；造它的那一行另外都认 hide=）：写了不认得的当场报，不默默当没写
  options: { hop: ['color', 'label'], group: ['stride'], sort: ['d', 'from', 'pass'], move: ['d'] },
  remake: true, // 造它的那一行里能写 {式子}（value.js）：依赖一变，场景照新的数把这一行重新造一遍
  // 跟着算的一排上做了这几样（换位置、改值）就不再跟着算（scene.js 的 unlive）：照那一行重新造会把它们冲掉
  reshape: ['swap', 'move', 'write'],
  /** 重新造（scene.js 的 remake）：老师做过的样子按格（key）带到新造的那一份；换过位置的不会走到这里 */
  carry(old, o) {
    for (const x of o.cells) {
      const y = old.cells.find((c) => c.key === x.key);
      if (!y) continue;
      for (const f of FLAGS) x[f] = y[f];
      x.row = y.row;
    }
    o.groupD = old.groupD;
    o.ptrs = new Map([...old.ptrs].filter(([, s]) => s <= o.cells.length));
    // 写明的排序带过来；数换了，起点从新的这一排算
    if (old.sort) o.sort = old.sort.src ? { ...old.sort } : { ...old.sort, from: textsOf(o) };
  },
  drag: true,
  hint: '（一排格子：名字.k 是现在第 k 格；括号里的 #k 是「一开始在第 k 格的那一个」，写 名字#k 跟着它走）',
  make(scene, c, h, old) {
    const vals = h.words.slice(1);
    if (!h.args.some((a) => a.t === 'eq')) throw new Error('要写成 array 名字 = 一个个值');
    if (!vals.length) throw new Error('array 后面要有值');
    if (vals.length > MAX_CELLS) throw new Error(`一排最多 ${MAX_CELLS} 格（写了 ${vals.length} 格）`);
    const id = h.words[0];
    // 新的一排放在已有的东西下面，和它们居中对齐（一格的「要找的数」放在正下方，不缩在左边）
    const origin = old ? { ...old.origin } : scene.slotFor(vals.length * (CELL + GAP) - GAP);
    // _ 是空格子（值是 ''，和矩阵一样）：画成一个空位，学生能写进去（open a edit）、能把牌拖进来
    return { origin, groupD: null, ptrs: new Map(), cells: vals.map((v, i) => ({ obj: id, key: i + 1, slot: i + 1, value: v === '_' ? '' : v, row: 0, paint: null, glow: false, lift: false, dim: false, covered: false })) };
  },
  parts(o) { return [...o.cells].sort((a, b) => a.slot - b.slot); },
  /** 扣着的一格画成小块写现在在第几格（scene.js 的 coverText：不写值，换了位置跟着变） */
  coverName: (p) => `第 ${p.slot} 格`,
  /** 挑战拿来判的：按现在的先后（a sorted、a = b） */
  measure(o) { return { kind: 'list', values: [...o.cells].sort((a, b) => a.slot - b.slot).map((x) => x.value) }; },
  pick(o, mark, sel, word) {
    const r = parseRef(word);
    if (r?.lo == null) throw new Error(`「${word}」：一排格子写 ${o.id}.3（第 3 格）、${o.id}.2-5（第 2 到 5 格）或 ${o.id}#8（一开始在第 8 格的那一个）`);
    const by = r.kind === 'slot' ? 'slot' : 'key';
    const out = o.cells.filter((c) => c[by] >= r.lo && c[by] <= r.hi).sort((a, b) => a[by] - b[by]);
    if (out.length !== r.hi - r.lo + 1) throw new Error(`${o.id} 只有 ${o.cells.length} 格，没有${r.kind === 'key' ? '一开始在' : ''}第 ${r.lo}${r.hi !== r.lo ? `–${r.hi}` : ''} 格`);
    return out;
  },
  ref(p) { return `${p.obj}#${p.key}`; },
  partBox: cellBox,
  objectBox,
  obstacles(o) {
    const out = [];
    for (let i = 1; i <= o.cells.length; i++) out.push({ ...slotBox(o, i), h: CELL + 22 });
    for (const x of o.cells) out.push(cellBox(o, x));
    out.push(...ptrBoxes(o));
    return out;
  },
  onVar(scene, o, b, v) { return b.kind === 'group' ? regroup(scene, o, v) : b.kind === 'sort' ? redial(o, v) : null; },
  /** 希尔的 d 写了拨数的名字：依赖图里记一笔（舞台现状把每个能拨到的 d 扫一遍，规则的 brief） */
  depNodes(o) { return o.sort?.dv ? [{ id: `${o.id}:d`, deps: [o.sort.dv] }] : []; },
  /**
   * open 那一行的 wrong= / call=：页面判得了每一下的排序（直接插入、希尔、冒泡、简单选择）写明了才用得上，不然永远不生效，当场报。
   * 只判到一趟的（快排、归并、基数、from= 的一排）做完了页面知道：call=done 照收
   */
  canOpen(scene, o, action, h) {
    const { wrong, call } = h.opts;
    if (wrong == null && call == null) return;
    if (action !== 'drag' && action !== 'move') return; // 别的动作（edit）页面不判，scene.js 照 judges 报
    const s = o.sort;
    if (!s) throw new Error(`${o.id} 没写在做哪种排序，页面判不了对错，wrong= / call= 用不上：先 sort ${o.id} insert（或 shell d=5、bubble、select）`);
    if ((s.src || !STEP_SORTS.includes(s.algo)) && (wrong != null || call === 'wrong')) throw new Error(`${o.id} 上${s.src ? `是照 ${s.src} 该排成的样子` : SORTS[s.algo]}，页面只判到一趟、不判学生的每一下，${wrong != null ? 'wrong=' : 'call=wrong'} 用不上（做完才叫写 call=done）`);
  },
  commands: {
    // hop a.1 -> a.6 color=g1 label="隔 5 个"：小点一格一格跳过去，留一道弧
    hop(scene, c, h) {
      const { args, opts, words, arrow } = h;
      if (arrow < 0) throw new Error('要写成 hop 从哪格 -> 到哪格');
      const [from] = h.partsIn(args.slice(0, arrow)), [to] = h.partsIn(args.slice(arrow + 1));
      if (!from || !to) throw new Error('hop 要两头都是格子');
      if (from.obj !== to.obj || from.row !== to.row) throw new Error('hop 只能在同一排里跳');
      if (from === to) throw new Error('hop 的两头是同一格');
      const color = opts.color || words.find(h.isColor) || 'g1';
      if (!h.isColor(color)) throw new Error('颜色只有 g1～g6');
      const link = scene.addLink(from, to, color) || scene.linkKey(from, to);
      const id = `hop:${from.obj}${from.key}`;
      if (opts.label) scene.labels.set(id, { id, refs: [scene.refOf(from), scene.refOf(to)], text: opts.label, side: 'above', tone: 'soft', link });
      return { from, to, color, link, label: opts.label ? id : null };
    },
    swap(scene, c, h) {
      h.strayRefs();
      const cells = h.partsIn();
      if (cells.length !== 2) throw new Error(`swap 要正好两格（写了 ${cells.length} 格）`);
      const [a, b] = cells;
      sameArray(a, b, 'swap ');
      if (a === b) throw new Error('swap 的两格是同一格');
      [a.slot, b.slot] = [b.slot, a.slot];
      // 写明了排序：让了几格记一笔（和空格子换不算让位）
      const o = scene.objects.get(a.obj);
      if (o.sort && !o.sort.src && a.value !== '' && b.value !== '') o.sort.moved = (o.sort.moved || 0) + 1;
      return { a, b };
    },
    // move a#6 -> a.2：把这一格挪到第 2 格，中间的格子各让一格（插入）；d=5 是在隔 5 的链上挪：链上中间的各跳 5 格，别的不动
    move(scene, c, h) {
      const { args, arrow } = h;
      if (arrow < 0) throw new Error('要写成 move 哪格 -> 第几格');
      const [x] = h.partsIn(args.slice(0, arrow));
      const dest = args.slice(arrow + 1).find((a) => a.t === 'word' && parseRef(a.v)?.kind === 'slot');
      if (!x || !dest) throw new Error('move 要写成 move a#6 -> a.2');
      const r = parseRef(dest.v);
      const o = scene.objects.get(x.obj);
      if (r.obj !== x.obj) throw new Error('move 只能挪到同一排格子里');
      if (r.lo < 1 || r.lo > o.cells.length) throw new Error(`${o.id} 只有 ${o.cells.length} 格`);
      const from = x.slot, to = r.lo;
      const d = h.opts.d == null ? 1 : scene.num(h.opts.d);
      if (!(Number.isInteger(d) && d >= 1)) throw new Error('d= 要是正整数（隔几个的链上挪）');
      if ((from - to) % d !== 0) throw new Error(`隔 ${d} 的链上，第 ${from} 格那一张挪不到第 ${to} 格：它的链是第 ${strideGroups(o.cells.length, d)[(from - 1) % d]?.join('、')} 格`);
      const moved = [];
      for (const c2 of o.cells) {
        if (c2 === x || (c2.slot - from) % d !== 0) continue;
        if (from < to && c2.slot > from && c2.slot <= to) { c2.slot -= d; moved.push(c2); }
        if (from > to && c2.slot >= to && c2.slot < from) { c2.slot += d; moved.push(c2); }
      }
      x.slot = to;
      if (o.sort && !o.sort.src) o.sort.moved = (o.sort.moved || 0) + moved.filter((y) => y.value !== '').length;
      return { cell: x, moved };
    },
    // write a.3 99：这一格换成别的值
    write(scene, c, h) {
      const x = one(h, h.args, 'write ');
      const val = h.words.filter((w) => !scene.isRef(w)).at(-1) ?? h.str;
      if (val == null) throw new Error('要写成 write a.3 新的值');
      const before = x.value;
      x.value = val === '_' ? '' : String(val); // write a.3 _ ：空出这一格
      // 写明了排序的一排改了数：起点从改完的这一排重新算（原来那一排的每一趟已经对不上了）
      const o = scene.objects.get(x.obj);
      if (o.sort && !o.sort.src) o.sort.from = textsOf(o);
      return { cell: x, before };
    },
    // ptr low a.1：格子下面一个小箭头，同名的再写就挪过去
    ptr(scene, c, h) {
      const name = h.words[0];
      if (!name || scene.isRef(name)) throw new Error('要写成 ptr 名字 a.3');
      const x = one(h, h.args.slice(1), 'ptr ');
      for (const o of scene.objects.values()) if (o.id !== x.obj && o.ptrs) o.ptrs.delete(name);
      scene.objects.get(x.obj).ptrs.set(name, x.slot);
      return { name, cell: x };
    },
    unptr(scene, c, h) {
      const names = h.words.length ? h.words : null;
      for (const o of scene.objects.values()) if (o.ptrs) for (const n of [...o.ptrs.keys()]) if (!names || names.includes(n)) o.ptrs.delete(n);
      return {};
    },
    // group a stride=5（stride 可以写拨的数的名字，拨一下就重新分组）
    group(scene, c, h) {
      const o = scene.objects.get(h.words[0]);
      if (!o || o.type !== 'array') throw new Error(`舞台上没有叫「${h.words[0]}」的一排格子`);
      const v = h.opts.stride ?? '1';
      const d = scene.num(v);
      if (!(d >= 1)) throw new Error('stride 要是正整数');
      scene.binds = scene.binds.filter((b) => !(b.kind === 'group' && b.obj === o.id));
      if (!/^\d+$/.test(String(v))) scene.binds.push({ kind: 'group', obj: o.id, v });
      return regroup(scene, o, d);
    },
    split(scene, c, h) {
      const o = scene.objects.get(h.words[0]);
      if (!o || o.type !== 'array') throw new Error(`舞台上没有叫「${h.words[0]}」的一排格子`);
      // 没分过组：没有组可分开（以前整排掉到下面一排，现状还说「每组下到自己的一排」）。重放旧课照旧
      if (!o.groupD && !c.lenient) throw new Error(`${o.id} 还没分组，没有组可分开：先 group ${o.id} stride=5（隔 5 个一组），再 split ${o.id}`);
      const rowOf = new Map();
      strideGroups(o.cells.length, o.groupD || 1).forEach((g, gi) => g.forEach((s) => rowOf.set(s, gi + 1)));
      o.cells.forEach((x) => { x.row = rowOf.get(x.slot); });
      return { id: o.id };
    },
    merge(scene, c, h) {
      const o = scene.objects.get(h.words[0]);
      if (!o || o.type !== 'array') throw new Error(`舞台上没有叫「${h.words[0]}」的一排格子`);
      o.cells.forEach((x) => { x.row = 0; });
      return { id: o.id };
    },
    // sort a shell d=5 / sort a insert：写明这一排在做哪种排序（页面照王道的代码算每一趟、判学生的每一下，从现在这一排起）；
    // sort r shell d=5 from=a pass=1：另一排 r 该等于 a 做完第 1 趟的样子（学生一格一格写的那种）；sort a off：不判了。只是写明，页面不替老师排
    sort(scene, c, h) {
      const o = scene.objects.get(h.words[0]);
      if (!o || o.type !== 'array') throw new Error(`舞台上没有叫「${h.words[0] ?? ''}」的一排格子（要写成 sort a insert、sort a shell d=5）`);
      const algo = h.words[1];
      const drop = () => { scene.binds = scene.binds.filter((b) => !(b.kind === 'sort' && b.obj === o.id)); };
      if (algo === 'off') { drop(); delete o.sort; return { id: o.id, sort: null }; }
      if (!SORTS[algo]) throw new Error(`sort ${o.id} 后面写在做哪种排序：${Object.entries(SORTS).map(([k, v]) => `${k} ${v}`).join('、')}；不判了写 sort ${o.id} off（sort 只是写明在做什么，页面不替你排：演一趟还是你自己 swap / move）`);
      const { opts } = h;
      const n = o.cells.length;
      let d = null, dv = null;
      if (algo === 'shell') {
        if (opts.d == null) throw new Error(`希尔排序要写这一趟的增量：sort ${o.id} shell d=5（d 能写拨数的名字，跟着拨）`);
        d = scene.num(opts.d);
        if (!/^\d+$/.test(String(opts.d))) dv = String(opts.d);
        if (!(Number.isInteger(d) && d >= 1 && d < n)) throw new Error(`增量 d = ${d} 要是比格数（${n}）小的正整数`);
      } else if (opts.d != null) throw new Error(`d= 只有希尔排序用（sort ${o.id} shell d=5）`);
      let sort;
      if (opts.from != null) {
        const src = scene.objects.get(opts.from);
        if (!src || src.type !== 'array' || src === o) throw new Error(`from= 写另一排格子的名字（sort ${o.id} ${algo} from=a：${o.id} 该等于 a 做完一趟的样子）${src ? '' : `：舞台上没有「${opts.from}」`}`);
        if (src.cells.length !== n) throw new Error(`${src.id} 是 ${src.cells.length} 格，${o.id} 是 ${n} 格，对不上`);
        const pass = opts.pass == null ? 1 : Number(opts.pass);
        if (!Number.isInteger(pass) || pass < 1) throw new Error('pass= 写第几趟（从 1 数）');
        // 那一排现在就跑得了（没有空格子）：不全是数、趟数写多了当场报；还空着的等它写满
        const from = textsOf(src);
        if (!from.includes('')) {
          const total = planOf(algo, from, d).passes.length;
          if (pass > total) throw new Error(`${SORTS[algo]}从 ${src.id} 现在这一排起一共 ${total} 趟，没有第 ${pass} 趟`);
        }
        sort = { algo, d, dv, src: src.id, pass };
      } else {
        if (opts.pass != null) throw new Error(`pass= 跟着 from= 写（sort ${o.id} ${algo} from=a pass=2：${o.id} 该等于 a 做完第 2 趟的样子）`);
        const from = textsOf(o);
        if (!from.includes('')) planOf(algo, from, d); // 跑不了（不全是数、基数排序有负数）当场报
        // 让了几格接着数（希尔一趟一趟再写 sort，三趟一共让了几格是连着的）；sort a off 才归零
        sort = { algo, d, dv, from, moved: o.sort && !o.sort.src ? o.sort.moved || 0 : 0 };
      }
      drop();
      if (dv) scene.binds.push({ kind: 'sort', obj: o.id, v: dv });
      o.sort = sort;
      return { id: o.id, sort: algo };
    },
  },
  // 一句话写现在的样子（存档点 back 以后告诉老师，scene.js 的 summaryOf）：那一排数
  summary(o) { return [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => c.value).join(' '); },
  /** 舞台现状里「页面算的」那一行多交的一句：写明了排序时，对着引擎看现在什么样、正确的下一步（array.sort.js 的 sortLine） */
  pageBits(o, scene) {
    if (!o.sort) return [];
    try { return [sortLine(o, scene)].filter(Boolean); } catch (err) { return [`排序页面没算成（${err?.message || err}）`]; }
  },
  describe(o) {
    const tag = (c) => {
      const bits = [];
      if (c.key !== c.slot) bits.push(`#${c.key}`);
      if (c.paint) bits.push(COLOR_NAMES[c.paint]);
      if (c.glow) bits.push('亮');
      if (c.lift) bits.push('抬起');
      if (c.dim) bits.push('灰');
      if (c.covered) bits.push('扣着');
      return `${c.value === '' ? '□' : c.value}${bits.length ? `（${bits.join('、')}）` : ''}`;
    };
    const lines = [`一排格子 ${o.id}（${o.cells.length} 格${o.groupD ? `，按隔 ${o.groupD} 个分了 ${strideGroups(o.cells.length, o.groupD).length} 组` : ''}${lanesText(o)}）：`];
    lines.push(`  ${o.cells.length > 1 ? `第 1～${o.cells.length} 格` : '第 1 格'}：${[...o.cells].sort((a, b) => a.slot - b.slot).map(tag).join(' ')}`);
    if (o.ptrs.size) lines.push(`  指针：${[...o.ptrs].map(([n, s]) => `${n} → 第 ${s} 格`).join('，')}`);
    return lines;
  },
  doc: `一排格子（排序、查找、哈希）：
array a = 49 38 65 97 76 13 27 49′ 55 04      造一排格子（最多 16 格；同一名字再造就换掉；_ 是空格子）
写法：a 整排；a.3 现在第 3 格；a.2-5 第 2 到 5 格；a#8 一开始在第 8 格的那一个（交换、插入以后跟着它走）
hop a.1 -> a.6 color=g1 label="隔 5 个"     小点一格一格跳过去、数着跳了几下，留一道弧
swap a.1 a.6                      交换（走弧线）
move a#6 -> a.2                   插入：挪到第 2 格，中间的各让一格（加 d=5：只在隔 5 的链上挪）
write a.3 99                      改一格的值（_ 是空出来）
ptr mid a.5 / unptr mid           格子下面的指针（同名的再写就挪过去）
group a stride=5                  按「隔 5 个」分组：每组染色、连起来（stride 可以写拨的数的名字，学生一拨就重新分）
split a / merge a                 每组下到自己的一排（先 group）/ 合回一排
sort a shell d=5                  写明 a 在做哪种排序，页面从现在这一排起照王道的代码算：insert shell bubble select 学生每一下都判，quick merge radix 只判到一趟；希尔写这一趟的 d（能写拨数名），下一趟再写一次。现状里有等于第几趟、正确的下一步、像哪种错。sort a off 收掉
sort r shell d=5 from=a pass=1    另一排 r 该等于 a 做完第 1 趟的样子（学生一格格写出来的那种）
open a move                       学生按住一张拖：放到另一张上 = swap a#6 a#1；放到两张之间 = move a#6 -> a.2（希尔时沿它那条链：move a#10 -> a.4 d=3）。open a 只能对调
open h edit                       学生点一格、键盘写数 = write h.1 38
每一下都判的排序写明以后，open a、open a move 才收 wrong= call= 和 @a.right；@a.done：希尔是这一趟做完，别的是整个排好
判断式（when=）：a pass=2 等于第 2 趟做完的样子（希尔、from= 的写 a pass）；a chains=5 隔 5 的每条链都递增；a mates a.1 a.6 两格在同一条链上挨着
量：inv(a) 前大后小几对；bad(a) 隔 d 的链上坏几对、chains(a) 排好几条（d 照 sort、group）；moves(a) 写明排序以来让了几格（sort a off 归零）
ask drag a#1 a#6 "把小的拖到前面"   学生按住一格拖到同一排另一格上，两格交换`,
  // 说明里例子没有的东西（测试照抄说明里的写法时用）：一排空格子、带空格子的一排
  docSetup: `array a = 49 38 65 97 76 13 27 49′ 55 04
array r = _ _ _ _ _ _ _ _ _ _
array h = _ 49 38`,
  example: `array a = 49 38 65 97 76 13 27 49′ 55 04
hop a.1 -> a.6 color=g1
paint a.1 a.6 g1
say "从 {a.1} 往后跳 5 下，落在 {a.6}：这两个是一组。"
open a
goal g1 "把这一组排好：小的拖到前面" when="a.1 < a.6"
@g1 say "对，这一组排好了。"
@g1 ask tap a "那 {a.2} 和谁一组？"`,
};
