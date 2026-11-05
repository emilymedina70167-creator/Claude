// 舞台的场景（docs/stage-plan.md）：舞台上有什么、在哪、什么颜色、连着谁、贴着什么字、拨数是几、在等学生做什么——
// 全是数据，不碰 DOM。纯函数 / 纯数据，有测试（tests/stage-scene.test.js）。
//
// 一行镜头指令先 check（写错了当场挡下，告诉老师哪里错，别的行照演），再 apply（改场景）；
// 画面（stage.js）只负责把场景的变化演出来。所以：
// - 老师边写边演时，每一行先在场景上试，不会把画面演坏；
// - 刷新、作废一轮：照记录（每一行指令，连学生拖、拨造成的变化）在新场景上重放一遍就回到原样；
// - 告诉老师「舞台上现在有什么」（stateText）是照场景写的，和画面一定对得上。
import { parseScript, parseRef, parseRich, COMMANDS } from './script.js';
import { strideGroups, cellBox, objectBox, ptrBox, ARRAY_GAP } from './layout.js';

export const COLORS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
export const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
export const MAX_CELLS = 16;
const isColor = (w) => COLORS.includes(w);
const prime = (v) => String(v).replace(/[′']/g, '');
const numOf = (v) => (/^-?\d+(\.\d+)?$/.test(prime(v)) ? Number(prime(v)) : null);

/** 两个值比大小（49′ 和 49 一样大）：-1 / 0 / 1；数比数，别的按字 */
export function compareValues(a, b) {
  const x = numOf(a), y = numOf(b);
  if (x != null && y != null) return x < y ? -1 : x > y ? 1 : 0;
  const s = prime(a), t = prime(b);
  return s < t ? -1 : s > t ? 1 : 0;
}

export class Scene {
  constructor() {
    this.objects = new Map(); // id → { type: 'array', id, cells, origin, groupD, ptrs }
    this.links = new Map(); // key → { key, a: { obj, key }, b: { obj, key }, color, tier }
    this.labels = new Map(); // id → { id, refs, text, side, tone, link }
    this.vars = new Map(); // name → { v, lo, hi, at }
    this.binds = []; // { kind: 'group', obj, v }
    this.focus = null; // null = 全部；或者部件的写法
    this.say = '';
    this.words = []; // 这一句话里能飞走的 [词]
    this.waiting = null; // { kind, refs, prompt, button }
  }

  clone() {
    const s = new Scene();
    for (const [k, o] of this.objects) s.objects.set(k, { ...o, cells: o.cells.map((c) => ({ ...c })), origin: { ...o.origin }, ptrs: new Map(o.ptrs) });
    for (const [k, l] of this.links) s.links.set(k, { ...l, a: { ...l.a }, b: { ...l.b } });
    for (const [k, l] of this.labels) s.labels.set(k, { ...l, refs: [...l.refs] });
    for (const [k, v] of this.vars) s.vars.set(k, { ...v });
    s.binds = this.binds.map((b) => ({ ...b }));
    s.focus = this.focus ? [...this.focus] : null;
    s.say = this.say;
    s.words = [...this.words];
    s.waiting = this.waiting ? { ...this.waiting } : null;
    return s;
  }

  // —— 部件 ——
  /** 部件的写法 → 格子（按位置排好）；写错了抛错（错误的话直接给老师看） */
  cells(word) {
    const r = typeof word === 'string' ? parseRef(word) : word;
    if (!r) throw new Error(`「${word}」不是舞台上的东西`);
    const o = this.objects.get(r.obj);
    if (!o) throw new Error(`舞台上没有「${r.obj}」${this.objects.size ? `（有的是：${[...this.objects.keys()].join('、')}）` : '（先用 array 造一个）'}`);
    if (r.kind === 'all') return [...o.cells].sort((a, b) => a.slot - b.slot);
    const by = r.kind === 'slot' ? 'slot' : 'key';
    const out = o.cells.filter((c) => c[by] >= r.lo && c[by] <= r.hi).sort((a, b) => a[by] - b[by]);
    if (out.length !== r.hi - r.lo + 1) throw new Error(`${o.id} 只有 ${o.cells.length} 格，没有${r.kind === 'key' ? '一开始在' : ''}第 ${r.lo}${r.hi !== r.lo ? `–${r.hi}` : ''} 格`);
    return out;
  }
  isRef(word) { const r = parseRef(word); return !!(r && this.objects.has(r.obj)); }
  refOf(c) { return `${c.obj}#${c.key}`; }
  cellBox(c) { return cellBox(this.objects.get(c.obj), c); }
  objectBox(id) { return objectBox(this.objects.get(id)); }
  ptrBoxes() {
    const out = [];
    for (const o of this.objects.values()) {
      const at = new Map();
      for (const [name, slot] of o.ptrs) { const k = at.get(slot) || 0; at.set(slot, k + 1); out.push({ obj: o.id, name, slot, ...ptrBox(o, slot, k) }); }
    }
    return out;
  }
  groups(id) {
    const o = this.objects.get(id);
    return o.groupD ? strideGroups(o.cells.length, o.groupD) : [o.cells.map((c) => c.slot).sort((a, b) => a - b)];
  }
  num(v) {
    if (/^-?\d+(\.\d+)?$/.test(String(v))) return Number(v);
    const x = this.vars.get(v);
    if (!x) throw new Error(`没有叫「${v}」的数（先用 dial 造一个）`);
    return x.v;
  }

  // —— 检查一行：写错了返回一句话（给老师看），没错返回 null ——
  check(c) {
    if (!c.cmd) return c.error || '看不懂这一行';
    try {
      this.clone().apply(c);
      return null;
    } catch (err) {
      return err.message;
    }
  }

  // —— 一行指令改场景（画面怎么演由 stage.js 管）。返回这一行的要点（画面用），写错了抛错 ——
  apply(c) {
    if (!c.cmd || !COMMANDS.has(c.cmd)) throw new Error(c.error || `没有「${c.cmd}」这个指令`);
    const { cmd, args, opts } = c;
    const words = args.filter((a) => a.t === 'word').map((a) => a.v);
    const str = args.find((a) => a.t === 'str')?.v;
    const arrow = args.findIndex((a) => a.t === 'arrow');
    const refsIn = (list) => list.filter((a) => a.t === 'word' && this.isRef(a.v)).map((a) => a.v);
    const cellsIn = (list) => refsIn(list).flatMap((w) => this.cells(w));
    // 写了部件却不是部件的词（多半是写错了名字）：提醒出来，不默默忽略
    const strayRefs = (list, allow = []) => {
      for (const a of list) if (a.t === 'word' && !this.isRef(a.v) && !allow.includes(a.v) && parseRef(a.v)?.kind !== 'all' && /[.#]/.test(a.v)) throw new Error(`「${a.v}」不是舞台上的东西`);
    };
    switch (cmd) {
      case 'array': {
        const [id, ...vals] = words;
        if (!id || !/^[A-Za-z_]\w*$/.test(id)) throw new Error('要写成 array 名字 = 一个个值（名字用英文字母）');
        if (!args.some((a) => a.t === 'eq')) throw new Error('要写成 array 名字 = 一个个值');
        if (!vals.length) throw new Error('array 后面要有值');
        if (vals.length > MAX_CELLS) throw new Error(`一排最多 ${MAX_CELLS} 格（写了 ${vals.length} 格）`);
        const old = this.objects.get(id);
        if (old) this.dropObject(id);
        // 新的一排放在已有的东西下面
        let y = 0;
        for (const o of this.objects.values()) { const b = objectBox(o); y = Math.max(y, b.y + b.h + ARRAY_GAP); }
        this.objects.set(id, { type: 'array', id, origin: { x: 0, y: old ? old.origin.y : y }, groupD: null, ptrs: new Map(), cells: vals.map((v, i) => ({ obj: id, key: i + 1, slot: i + 1, value: v, row: 0, paint: null, glow: false, lift: false, dim: false })) });
        if (!this.focus) this.focus = null;
        return { id };
      }
      case 'say': {
        const text = str ?? '';
        for (const p of parseRich(text)) if (p.k === 'ref') this.cells(p.v); // 话里指着的东西要真有
        this.say = text;
        this.words = parseRich(text).filter((p) => p.k === 'word').map((p) => p.v);
        return {};
      }
      case 'glow': case 'unglow': case 'lift': case 'drop': case 'dim': case 'undim': {
        strayRefs(args);
        const cells = refsIn(args).length ? cellsIn(args) : (cmd.startsWith('un') || cmd === 'drop') ? [...this.objects.values()].flatMap((o) => o.cells) : null;
        if (!cells) throw new Error(`${cmd} 后面要写哪几格`);
        const field = { glow: 'glow', unglow: 'glow', lift: 'lift', drop: 'lift', dim: 'dim', undim: 'dim' }[cmd];
        const on = !cmd.startsWith('un') && cmd !== 'drop';
        cells.forEach((x) => { x[field] = on; });
        return { cells };
      }
      case 'pulse': {
        strayRefs(args);
        const cells = cellsIn(args);
        if (!cells.length) throw new Error('pulse 后面要写哪几格');
        return { cells };
      }
      case 'paint': case 'unpaint': {
        strayRefs(args);
        const cells = cellsIn(args);
        if (!cells.length) throw new Error(`${cmd} 后面要写哪几格`);
        const color = cmd === 'paint' ? words.find(isColor) || 'g1' : null;
        const bad = words.find((w) => /^g\d+$/.test(w) && !isColor(w));
        if (bad) throw new Error(`颜色只有 g1～g6（${COLORS.map((k) => `${k} ${COLOR_NAMES[k]}`).join('、')}）`);
        cells.forEach((x) => { x.paint = color; });
        return { cells, color };
      }
      case 'link': {
        strayRefs(args);
        const cells = cellsIn(args);
        if (cells.length < 2) throw new Error('link 要至少两格');
        const color = words.find(isColor) || 'g1';
        const made = [];
        for (let i = 0; i + 1 < cells.length; i++) made.push(this.addLink(cells[i], cells[i + 1], color));
        return { links: made.filter(Boolean) };
      }
      case 'unlink': {
        strayRefs(args);
        const cells = refsIn(args).length ? cellsIn(args) : null;
        const ids = cells ? new Set(cells.map((x) => this.refOf(x))) : null;
        const gone = [];
        for (const [k, l] of this.links) if (!ids || ids.has(`${l.a.obj}#${l.a.key}`) || ids.has(`${l.b.obj}#${l.b.key}`)) { this.links.delete(k); gone.push(k); }
        // 跳格留下的字跟着弧走
        for (const [k, l] of this.labels) if (l.link && gone.includes(l.link)) this.labels.delete(k);
        return { gone };
      }
      case 'hop': {
        if (arrow < 0) throw new Error('要写成 hop 从哪格 -> 到哪格');
        const [from] = cellsIn(args.slice(0, arrow)), [to] = cellsIn(args.slice(arrow + 1));
        if (!from || !to) throw new Error('hop 要两头都是格子');
        if (from.obj !== to.obj || from.row !== to.row) throw new Error('hop 只能在同一排里跳');
        if (from === to) throw new Error('hop 的两头是同一格');
        const color = opts.color || words.find(isColor) || 'g1';
        if (!isColor(color)) throw new Error('颜色只有 g1～g6');
        const link = this.addLink(from, to, color) || this.linkKey(from, to);
        if (opts.label) this.labels.set(`hop:${from.obj}${from.key}`, { id: `hop:${from.obj}${from.key}`, refs: [this.refOf(from), this.refOf(to)], text: opts.label, side: 'above', tone: 'soft', link });
        return { from, to, color, link, label: opts.label ? `hop:${from.obj}${from.key}` : null };
      }
      case 'swap': {
        strayRefs(args);
        const cells = cellsIn(args);
        if (cells.length !== 2) throw new Error(`swap 要正好两格（写了 ${cells.length} 格）`);
        const [a, b] = cells;
        if (a.obj !== b.obj) throw new Error('swap 的两格要在同一排格子里');
        if (a === b) throw new Error('swap 的两格是同一格');
        [a.slot, b.slot] = [b.slot, a.slot];
        return { a, b };
      }
      case 'move': {
        // move a#6 -> a.2：把这一格挪到第 2 格，中间的格子各让一格（插入）
        if (arrow < 0) throw new Error('要写成 move 哪格 -> 第几格');
        const [x] = cellsIn(args.slice(0, arrow));
        const dest = args.slice(arrow + 1).find((a) => a.t === 'word' && parseRef(a.v)?.kind === 'slot');
        if (!x || !dest) throw new Error('move 要写成 move a#6 -> a.2');
        const r = parseRef(dest.v);
        const o = this.objects.get(x.obj);
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
      }
      case 'write': {
        // write a.3 99：这一格换成别的值
        const [x] = cellsIn(args);
        const val = words.filter((w) => !this.isRef(w)).at(-1) ?? str;
        if (!x || val == null) throw new Error('要写成 write a.3 新的值');
        const before = x.value;
        x.value = String(val);
        return { cell: x, before };
      }
      case 'compare': {
        strayRefs(args);
        const cells = cellsIn(args);
        if (cells.length !== 2) throw new Error('compare 要正好两格');
        return { a: cells[0], b: cells[1], sign: compareValues(cells[0].value, cells[1].value) };
      }
      case 'ptr': {
        // ptr low a.1 [label="low"]：格子下面一个小箭头，同名的再写就挪过去
        const name = words[0];
        if (!name || this.isRef(name)) throw new Error('要写成 ptr 名字 a.3');
        const [x] = cellsIn(args.slice(1));
        if (!x) throw new Error('ptr 要指着一格');
        for (const o of this.objects.values()) if (o.id !== x.obj) o.ptrs.delete(name);
        this.objects.get(x.obj).ptrs.set(name, x.slot);
        return { name, cell: x };
      }
      case 'unptr': {
        const names = words.length ? words : null;
        for (const o of this.objects.values()) for (const n of [...o.ptrs.keys()]) if (!names || names.includes(n)) o.ptrs.delete(n);
        return {};
      }
      case 'group': {
        const id = words[0];
        const o = this.objects.get(id);
        if (!o) throw new Error(`舞台上没有「${id}」`);
        const v = opts.stride ?? '1';
        const d = this.num(v);
        if (!(d >= 1)) throw new Error('stride 要是正整数');
        this.binds = this.binds.filter((b) => !(b.kind === 'group' && b.obj === id));
        if (!/^\d+$/.test(String(v))) this.binds.push({ kind: 'group', obj: id, v });
        return this.regroup(id, d);
      }
      case 'split': case 'merge': {
        const o = this.objects.get(words[0]);
        if (!o) throw new Error(`舞台上没有「${words[0]}」`);
        if (cmd === 'split') {
          const rowOf = new Map();
          strideGroups(o.cells.length, o.groupD || 1).forEach((g, gi) => g.forEach((s) => rowOf.set(s, gi + 1)));
          o.cells.forEach((x) => { x.row = rowOf.get(x.slot); });
        } else o.cells.forEach((x) => { x.row = 0; });
        return { id: o.id };
      }
      case 'label': {
        const id = words[0];
        if (!id || this.isRef(id)) throw new Error('要写成 label 名字 贴在哪 "字"');
        const refs = args.slice(1).filter((a) => a.t === 'word' && (this.labels.has(a.v) || this.isRef(a.v))).map((a) => a.v);
        for (const r of refs) if (!this.labels.has(r)) this.cells(r);
        if (str == null) throw new Error('label 要有字（写在引号里）');
        this.labels.set(id, { id, refs, text: str, side: opts.side || null, tone: opts.tone || null, link: null });
        return { id };
      }
      case 'retext': {
        const l = this.labels.get(words[0]);
        if (!l) throw new Error(`没有叫「${words[0]}」的字${this.labels.size ? `（有的是：${[...this.labels.keys()].join('、')}）` : ''}`);
        l.text = str ?? '';
        return { id: l.id };
      }
      case 'unlabel': {
        const ids = words.length ? words : [...this.labels.keys()].filter((k) => !k.startsWith('dial:'));
        for (const k of ids) { this.labels.delete(k); if (k.startsWith('dial:')) this.vars.get(k.slice(5)) && (this.vars.get(k.slice(5)).shown = false); }
        return { ids };
      }
      case 'dial': {
        // dial d = 5 range=1-5 at=a
        const [name, val] = words;
        if (!name || !/^[A-Za-z_]\w*$/.test(name)) throw new Error('要写成 dial 名字 = 值 range=1-9');
        const [lo, hi] = String(opts.range || '1-9').split('-').map(Number);
        if (!(lo <= hi)) throw new Error('range 要写成 小-大，比如 range=1-5');
        const v = Number(val ?? lo);
        const at = opts.at || [...this.objects.keys()][0] || null;
        this.vars.set(name, { v: Math.max(lo, Math.min(hi, v)), lo, hi, at, shown: true });
        this.labels.set(`dial:${name}`, { id: `dial:${name}`, refs: at && this.objects.has(at) ? [at] : [], text: '', side: 'below', tone: 'dial', link: null, dial: name });
        return { name };
      }
      case 'set': {
        const x = this.vars.get(words[0]);
        if (!x) throw new Error(`没有叫「${words[0]}」的数`);
        const v = Number(words[1]);
        if (!Number.isFinite(v)) throw new Error('要写成 set 名字 值');
        x.v = Math.max(x.lo, Math.min(x.hi, v));
        return this.onVar(words[0]);
      }
      case 'camera': {
        strayRefs(args);
        this.focus = words[0] === 'all' || !words.length ? null : refsIn(args);
        if (this.focus) for (const r of this.focus) this.cells(r);
        return {};
      }
      case 'wait': {
        const ms = Number(words[0] || 600);
        if (!(ms >= 0)) throw new Error('wait 后面写毫秒数');
        return { ms: Math.min(ms, 3000) };
      }
      case 'fly': {
        const n = Number(String(args[0]?.v || '').split('.')[1]) || 1;
        if (!this.words[n - 1]) throw new Error(`上一句话里没有第 ${n} 个 [词]`);
        const id = args[arrow + 1]?.v;
        if (arrow < 0 || !id) throw new Error('要写成 fly say.1 -> 名字 贴在哪');
        const refs = refsIn(args.slice(arrow + 2));
        refs.forEach((r) => this.cells(r));
        this.labels.set(id, { id, refs, text: this.words[n - 1], side: opts.side || null, tone: 'key', link: null });
        return { id, word: n - 1 };
      }
      case 'ask': {
        const kind = words[0];
        if (!['tap', 'drag', 'next', 'say'].includes(kind)) throw new Error(`ask 后面写 tap / drag / next / say，没有「${kind}」`);
        if (str) for (const p of parseRich(str)) if (p.k === 'ref') this.cells(p.v);
        const refs = refsIn(args.slice(1));
        refs.forEach((r) => this.cells(r));
        if (kind === 'drag' && refs.flatMap((r) => this.cells(r)).length < 2) throw new Error('ask drag 要写能拖的几格（至少两格）');
        if (str != null) { this.say = str; this.words = parseRich(str).filter((p) => p.k === 'word').map((p) => p.v); }
        this.waiting = { kind, refs, prompt: str ?? '', button: opts.button || null, expect: opts.expect || null };
        if (opts.expect) this.cells(opts.expect);
        return { kind };
      }
      case 'clear': {
        this.labels.clear();
        this.say = '';
        this.words = [];
        for (const v of this.vars.values()) v.shown = false;
        return {};
      }
      default:
        throw new Error(`「${cmd}」还没做`);
    }
  }

  linkKey(a, b) { return [`${a.obj}#${a.key}`, `${b.obj}#${b.key}`].sort().join('~'); }
  addLink(a, b, color, tier = 0) {
    const key = this.linkKey(a, b);
    if (this.links.has(key)) { const l = this.links.get(key); l.color = color; return null; }
    this.links.set(key, { key, a: { obj: a.obj, key: a.key }, b: { obj: b.obj, key: b.key }, color, tier });
    return key;
  }
  dropObject(id) {
    this.objects.delete(id);
    for (const [k, l] of this.links) if (l.a.obj === id) this.links.delete(k);
    for (const [k, l] of this.labels) if (l.refs.some((r) => parseRef(r)?.obj === id)) this.labels.delete(k);
  }
  // 按隔 d 个重新分组：这一排原来的连线收掉，每组染一种颜色、连起来（只有一组就不染）
  regroup(id, d) {
    const o = this.objects.get(id);
    o.groupD = d;
    const gone = [];
    for (const [k, l] of this.links) if (l.a.obj === id) { this.links.delete(k); gone.push(k); }
    for (const [k, l] of this.labels) if (l.link && gone.includes(l.link)) this.labels.delete(k);
    const groups = strideGroups(o.cells.length, d);
    const made = [];
    groups.forEach((g, gi) => {
      const cells = g.map((s) => o.cells.find((x) => x.slot === s));
      const color = groups.length === 1 ? null : COLORS[gi % COLORS.length];
      cells.forEach((x) => { x.paint = color; });
      if (color) for (let i = 0; i + 1 < cells.length; i++) made.push({ key: this.addLink(cells[i], cells[i + 1], color, gi) || this.linkKey(cells[i], cells[i + 1]), group: gi });
    });
    return { id, groups: groups.length, gone, made };
  }
  // 拨的数变了：跟着它的分组重新分
  onVar(name) {
    const out = { name, regroup: [] };
    for (const b of this.binds) if (b.v === name && b.kind === 'group' && this.objects.has(b.obj)) out.regroup.push(this.regroup(b.obj, this.vars.get(name).v));
    return out;
  }

  /** 给老师看的「舞台上现在有什么」：和画面一定对得上（照场景写） */
  stateText() {
    const lines = [];
    if (!this.objects.size) lines.push('舞台上还是空的。');
    for (const o of this.objects.values()) {
      const cells = [...o.cells].sort((a, b) => a.row - b.row || a.slot - b.slot);
      const tag = (c) => {
        const bits = [];
        if (c.key !== c.slot) bits.push(`#${c.key}`);
        if (c.paint) bits.push(COLOR_NAMES[c.paint]);
        if (c.glow) bits.push('亮');
        if (c.lift) bits.push('抬起');
        if (c.dim) bits.push('灰');
        return `${c.value}${bits.length ? `（${bits.join('、')}）` : ''}`;
      };
      const split = cells.some((c) => c.row);
      lines.push(`一排格子 ${o.id}（${o.cells.length} 格${o.groupD ? `，按隔 ${o.groupD} 个分了 ${strideGroups(o.cells.length, o.groupD).length} 组` : ''}${split ? '，每组下到自己的一排' : ''}）：`);
      lines.push(`  第 1～${o.cells.length} 格：${[...o.cells].sort((a, b) => a.slot - b.slot).map(tag).join(' ')}`);
      lines.push('  （#k 是「一开始在第 k 格的那一个」，写 a#k 跟着它走；a.k 是现在第 k 格）');
      if (o.ptrs.size) lines.push(`  指针：${[...o.ptrs].map(([n, s]) => `${n} → 第 ${s} 格`).join('，')}`);
    }
    const ls = [...this.links.values()];
    if (ls.length) lines.push(`连线：${ls.map((l) => `${l.a.obj}#${l.a.key}–${l.b.obj}#${l.b.key}${l.color ? ` ${COLOR_NAMES[l.color]}` : ''}`).join('，')}`);
    const labels = [...this.labels.values()].filter((l) => !l.dial);
    if (labels.length) lines.push(`贴着的字：${labels.map((l) => `${l.id}「${l.text}」${l.refs.length ? `（贴在 ${l.refs.join(' ')}）` : ''}`).join('；')}`);
    const dials = [...this.vars].filter(([, v]) => v.shown);
    if (dials.length) lines.push(`能拨的数：${dials.map(([n, v]) => `${n} = ${v.v}（${v.lo}～${v.hi}）`).join('，')}`);
    if (this.say) lines.push(`最后说的话：${this.say}`);
    if (this.waiting) lines.push(`在等学生：${{ tap: '点', drag: '拖', next: '点按钮', say: '打字回答' }[this.waiting.kind]}${this.waiting.refs.length ? ` ${this.waiting.refs.join(' ')}` : ''}`);
    return lines.join('\n');
  }
}

/**
 * 一整段镜头指令先在场景的副本上走一遍：哪几行写错了、错在哪（不动真的场景）。
 * 老师写完一轮以后页面用它查（也给测试、检查脚本用）。返回 [{ line, src, error }]
 */
export function dryRun(scene, src) {
  const s = scene.clone();
  const out = [];
  for (const c of parseScript(src)) {
    try { s.apply(c); } catch (err) { out.push({ line: c.line, src: c.src?.trim(), error: err.message }); }
  }
  return out;
}
