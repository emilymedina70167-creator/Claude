// 舞台上的一排格子（排序、查找、哈希……）：数据和指令，不碰 DOM（画法在 array.view.js）。纯函数，有测试。
// 每种东西都照这个样子写（types/index.js 注册）：
//   type / label / create（造它的指令）/ make（造出来的数据）/ parts（全部部件）/ pick（部件的写法 → 部件）/ ref（跟着它走的写法）
//   partBox / objectBox / obstacles（贴字要让开的地方）/ commands（自己的指令：(scene, c, h) → 要点）/ describe（给老师看的现状）
//   hint（写法提示，舞台上有这种东西时给老师看一次）/ doc（说明书里的一节）/ example（说明里的例子，测试照抄来演）/ drag（能不能拖）
import { CELL, GAP, ROW_GAP, SPLIT_GAP, IDX_H, PTR_H, bbox, strideGroups } from '../layout.js';
import { parseRef } from '../script.js';

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

export const array = {
  type: 'array',
  label: '一排格子',
  create: ['array'],
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
    return { origin, groupD: null, ptrs: new Map(), cells: vals.map((v, i) => ({ obj: id, key: i + 1, slot: i + 1, value: v, row: 0, paint: null, glow: false, lift: false, dim: false, covered: false })) };
  },
  parts(o) { return [...o.cells].sort((a, b) => a.slot - b.slot); },
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
  onVar(scene, o, b, v) { return b.kind === 'group' ? regroup(scene, o, v) : null; },
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
      return { a, b };
    },
    // move a#6 -> a.2：把这一格挪到第 2 格，中间的格子各让一格（插入）
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
      const moved = [];
      for (const c2 of o.cells) {
        if (c2 === x) continue;
        if (from < to && c2.slot > from && c2.slot <= to) { c2.slot--; moved.push(c2); }
        if (from > to && c2.slot >= to && c2.slot < from) { c2.slot++; moved.push(c2); }
      }
      x.slot = to;
      return { cell: x, moved };
    },
    // write a.3 99：这一格换成别的值
    write(scene, c, h) {
      const x = one(h, h.args, 'write ');
      const val = h.words.filter((w) => !scene.isRef(w)).at(-1) ?? h.str;
      if (val == null) throw new Error('要写成 write a.3 新的值');
      const before = x.value;
      x.value = String(val);
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
  },
  // 一句话写现在的样子（存档点 back 以后告诉老师，scene.js 的 summaryOf）：那一排数
  summary(o) { return [...o.cells].sort((a, b) => a.slot - b.slot).map((c) => c.value).join(' '); },
  describe(o) {
    const tag = (c) => {
      const bits = [];
      if (c.key !== c.slot) bits.push(`#${c.key}`);
      if (c.paint) bits.push(COLOR_NAMES[c.paint]);
      if (c.glow) bits.push('亮');
      if (c.lift) bits.push('抬起');
      if (c.dim) bits.push('灰');
      if (c.covered) bits.push('扣着');
      return `${c.value}${bits.length ? `（${bits.join('、')}）` : ''}`;
    };
    const split = o.cells.some((c) => c.row);
    const lines = [`一排格子 ${o.id}（${o.cells.length} 格${o.groupD ? `，按隔 ${o.groupD} 个分了 ${strideGroups(o.cells.length, o.groupD).length} 组` : ''}${split ? '，每组下到自己的一排' : ''}）：`];
    lines.push(`  ${o.cells.length > 1 ? `第 1～${o.cells.length} 格` : '第 1 格'}：${[...o.cells].sort((a, b) => a.slot - b.slot).map(tag).join(' ')}`);
    if (o.ptrs.size) lines.push(`  指针：${[...o.ptrs].map(([n, s]) => `${n} → 第 ${s} 格`).join('，')}`);
    return lines;
  },
  doc: `一排格子（排序、查找、哈希）：
array a = 49 38 65 97 76 13 27 49′ 55 04      造一排格子（最多 16 格；同一名字再造就换掉）
写法：a 整排；a.3 现在第 3 格；a.2-5 第 2 到 5 格；a#8 一开始在第 8 格的那一个（交换、插入以后跟着它走）
hop a.1 -> a.6 color=g1 label="隔 5 个"     小点一格一格跳过去、数着跳了几下，留一道弧
swap a.1 a.6                      交换（走弧线）
move a#6 -> a.2                   插入：挪到第 2 格，中间的各让一格
write a.3 99                      改一格的值
ptr mid a.5 / unptr mid           格子下面的指针（同名的再写就挪过去）
group a stride=5                  按「隔 5 个」分组：每组染色、连起来（stride 可以写拨的数的名字，学生一拨就重新分）
split a / merge a                 每组下到自己的一排 / 合回一排
ask drag a#1 a#6 "把小的拖到前面"   学生按住一格拖到同一排另一格上，两格交换（页面照做，再告诉你）`,
  example: `array a = 49 38 65 97 76 13 27 49′ 55 04
hop a.1 -> a.6 color=g1
paint a.1 a.6 g1
say "从 {a.1} 往后跳 5 下，落在 {a.6}：这两个是一组。"
open a
goal g1 "把这一组排好：小的拖到前面" when="a.1 < a.6"
@g1 say "对，这一组排好了。"
@g1 ask tap a "那 {a.2} 和谁一组？"`,
};
