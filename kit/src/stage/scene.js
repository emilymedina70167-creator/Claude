// 舞台的场景（docs/stage-plan.md）：舞台上有什么、在哪、什么颜色、连着谁、贴着什么字、拨数是几、在等学生做什么——
// 全是数据，不碰 DOM。纯函数 / 纯数据，有测试（tests/stage-scene.test.js）。
//
// 一行镜头指令先 check（写错了当场挡下，告诉老师哪里错，别的行照演），再 apply（改场景）；
// 画面（stage.js）只负责把场景的变化演出来。所以：
// - 老师边写边演时，每一行先在场景上试，不会把画面演坏；
// - 刷新、作废一轮：照记录（每一行指令，连学生拖、拨造成的变化）在新场景上重放一遍就回到原样；
// - 告诉老师「舞台上现在有什么」（stateText）是照场景写的，和画面一定对得上。
//
// 舞台上的东西分几种（一排格子、树、图、矩阵、平面、句子、式子……），每一种是 types/ 下的一个模块：
// 怎么造、部件怎么写（a.3 / t.A / m.2,3）、部件在哪、自己的指令（swap / insert / rowop……）、给老师看的现状。
// 这里只管各种东西共用的：点亮、染色、连线、贴字、拨数、镜头、说话、等学生。
import { parseScript, parseRef, parseRich, addCommands } from './script.js';
import { TYPES, typeOf, CREATE } from './types/index.js';
import { bbox } from './layout.js';

export const COLORS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
export const COLOR_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };
export const OBJECT_GAP = 70; // 两样东西上下摆开隔多远
const isColor = (w) => COLORS.includes(w);
const prime = (v) => String(v).replace(/[′']/g, '');
const numOf = (v) => (/^-?\d+(\.\d+)?$/.test(prime(v)) ? Number(prime(v)) : null);

// 每种东西自己的指令也认（script.js 读一行时按这个判断是不是指令）
addCommands([...Object.keys(CREATE), ...Object.values(TYPES).flatMap((t) => Object.keys(t.commands || {}))]);

/** 两个值比大小（49′ 和 49 一样大）：-1 / 0 / 1；数比数，别的按字 */
export function compareValues(a, b) {
  const x = numOf(a), y = numOf(b);
  if (x != null && y != null) return x < y ? -1 : x > y ? 1 : 0;
  const s = prime(a), t = prime(b);
  return s < t ? -1 : s > t ? 1 : 0;
}

/** 一个部件在场景里的编号（画面用它找节点、话里的小块用它找部件）：'a:3'、't:A' */
export const pidOf = (p) => `${p.obj}:${p.key}`;

export class Scene {
  constructor() {
    this.objects = new Map(); // id → { type, id, origin, …（各种东西自己的数据） }
    this.links = new Map(); // key → { key, a: { obj, key }, b: { obj, key }, color, tier }
    this.labels = new Map(); // id → { id, refs, text, side, tone, link }
    this.vars = new Map(); // name → { v, lo, hi, at, shown }
    this.binds = []; // { kind, obj, v }：跟着拨的数变的
    this.focus = null; // null = 全部；或者部件的写法
    this.say = '';
    this.words = []; // 这一句话里能飞走的 [词]
    this.waiting = null; // { kind, refs, prompt, button, expect, answer }
  }

  clone() {
    const s = new Scene();
    for (const [k, o] of this.objects) s.objects.set(k, structuredClone(o));
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
  type(o) { return typeOf(o); }
  /** 部件的写法 → 部件（按那种东西自己的顺序排好）；写错了抛错（错误的话直接给老师看） */
  parts(word) {
    const r = typeof word === 'string' ? parseRef(word) : word;
    if (!r) throw new Error(`「${word}」不是舞台上的东西`);
    const o = this.objects.get(r.obj);
    if (!o) throw new Error(`舞台上没有「${r.obj}」${this.objects.size ? `（有的是：${[...this.objects.keys()].join('、')}）` : `（先造一个：${Object.keys(CREATE).join(' / ')}）`}`);
    const t = typeOf(o);
    if (!r.mark) return t.parts(o);
    return t.pick(o, r.mark, r.sel, typeof word === 'string' ? word : `${r.obj}${r.mark}${r.sel}`);
  }
  /** 旧名字（只有一排格子的时候叫 cells） */
  cells(word) { return this.parts(word); }
  isRef(word) { const r = parseRef(word); return !!(r && this.objects.has(r.obj)); }
  /** 跟着它走的写法（a#3、t.A）：话里的小块、记录、给老师看都用它 */
  refOf(p) { return typeOf(this.objects.get(p.obj)).ref(p); }
  partBox(p) { const o = this.objects.get(p.obj); return typeOf(o).partBox(o, p); }
  cellBox(p) { return this.partBox(p); }
  objectBox(id) { const o = this.objects.get(id); return typeOf(o).objectBox(o); }
  allParts() { return [...this.objects.values()].flatMap((o) => typeOf(o).parts(o)); }
  /** 各种东西挡着的地方（贴字时让开）：格子、序号、指针、树的边…… */
  obstacles() { return [...this.objects.values()].flatMap((o) => (typeOf(o).obstacles ? typeOf(o).obstacles(o) : typeOf(o).parts(o).map((p) => typeOf(o).partBox(o, p)))); }
  num(v) {
    if (/^-?\d+(\.\d+)?$/.test(String(v))) return Number(v);
    const x = this.vars.get(v);
    if (!x) throw new Error(`没有叫「${v}」的数（先用 dial 造一个）`);
    return x.v;
  }
  /** 新的一样东西放哪：已有东西的下面，和它们居中对齐 */
  slotFor(w) {
    if (!this.objects.size) return { x: 0, y: 0 };
    const b = bbox([...this.objects.values()].map((o) => typeOf(o).objectBox(o)));
    return { x: Math.round(b.x + b.w / 2 - w / 2), y: b.y + b.h + OBJECT_GAP };
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

  // 一行里常用的几样（各种东西的指令也拿它用）
  helpers(c) {
    const { args, opts } = c;
    const words = args.filter((a) => a.t === 'word').map((a) => a.v);
    const str = args.find((a) => a.t === 'str')?.v;
    const strs = args.filter((a) => a.t === 'str').map((a) => a.v);
    const arrow = args.findIndex((a) => a.t === 'arrow');
    const refsIn = (list = args) => list.filter((a) => a.t === 'word' && this.isRef(a.v)).map((a) => a.v);
    const partsIn = (list = args) => refsIn(list).flatMap((w) => this.parts(w));
    // 写了部件却不是部件的词（多半是写错了名字）：提醒出来，不默默忽略
    const strayRefs = (list = args, allow = []) => {
      for (const a of list) if (a.t === 'word' && !this.isRef(a.v) && !allow.includes(a.v) && /^[A-Za-z_]\w*[.#]./.test(a.v)) throw new Error(`「${a.v}」不是舞台上的东西`);
    };
    return { args, opts, words, str, strs, arrow, refsIn, partsIn, cellsIn: partsIn, strayRefs, scene: this, isColor, COLORS };
  }

  // —— 一行指令改场景（画面怎么演由 stage.js 管）。返回这一行的要点（画面用），写错了抛错 ——
  apply(c) {
    if (!c.cmd) throw new Error(c.error || '看不懂这一行');
    const h = this.helpers(c);
    const { cmd } = c;
    const { args, opts, words, str, arrow, refsIn, partsIn, strayRefs } = h;
    // 造一样东西（array / tree / matrix……）
    if (CREATE[cmd]) {
      const t = CREATE[cmd];
      const id = words[0];
      if (!id || !/^[A-Za-z_]\w*$/.test(id)) throw new Error(`要写成 ${cmd} 名字 = …（名字用英文字母开头）`);
      if (id === 'say' || id.startsWith('dial')) throw new Error(`「${id}」这个名字留着别的用，换一个`);
      const old = this.objects.get(id);
      const o = t.make(this, c, h, old);
      if (old) this.dropObject(id, { keepLabels: true });
      o.type = t.type;
      o.id = id;
      this.objects.set(id, o);
      return { id, created: true };
    }
    // 各种东西自己的指令：按第一个部件是哪种东西找（swap 给格子、rowop 给矩阵……）
    const own = this.ownerOf(c, h);
    if (own) return own(this, c, h);
    switch (cmd) {
      case 'say': {
        const text = str ?? '';
        for (const p of parseRich(text)) if (p.k === 'ref') this.parts(p.v); // 话里指着的东西要真有
        this.say = text;
        this.words = parseRich(text).filter((p) => p.k === 'word').map((p) => p.v);
        return {};
      }
      case 'glow': case 'unglow': case 'lift': case 'drop': case 'dim': case 'undim': case 'cover': case 'uncover': {
        strayRefs();
        const parts = refsIn().length ? partsIn() : (cmd.startsWith('un') || cmd === 'drop') ? this.allParts() : null;
        if (!parts) throw new Error(`${cmd} 后面要写对哪几个做`);
        const field = { glow: 'glow', unglow: 'glow', lift: 'lift', drop: 'lift', dim: 'dim', undim: 'dim', cover: 'covered', uncover: 'covered' }[cmd];
        const on = !cmd.startsWith('un') && cmd !== 'drop';
        parts.forEach((x) => { x[field] = on; });
        return { cells: parts, parts };
      }
      case 'pulse': {
        strayRefs();
        const parts = partsIn();
        if (!parts.length) throw new Error('pulse 后面要写哪几个');
        return { cells: parts, parts };
      }
      case 'paint': case 'unpaint': {
        strayRefs();
        const parts = partsIn();
        if (!parts.length) throw new Error(`${cmd} 后面要写哪几个`);
        const color = cmd === 'paint' ? words.find(isColor) || 'g1' : null;
        const bad = words.find((w) => /^g\d+$/.test(w) && !isColor(w));
        if (bad) throw new Error(`颜色只有 g1～g6（${COLORS.map((k) => `${k} ${COLOR_NAMES[k]}`).join('、')}）`);
        parts.forEach((x) => { x.paint = color; });
        return { cells: parts, parts, color };
      }
      case 'compare': {
        strayRefs();
        const parts = partsIn();
        if (parts.length !== 2) throw new Error('compare 要正好两个（比如 compare a.3 a.8）');
        return { a: parts[0], b: parts[1], sign: compareValues(parts[0].value, parts[1].value) };
      }
      case 'link': {
        strayRefs();
        const parts = partsIn();
        if (parts.length < 2) throw new Error('link 要至少两个');
        const color = words.find(isColor) || 'g1';
        const made = [];
        for (let i = 0; i + 1 < parts.length; i++) made.push(this.addLink(parts[i], parts[i + 1], color));
        return { links: made.filter(Boolean) };
      }
      case 'unlink': {
        strayRefs();
        const parts = refsIn().length ? partsIn() : null;
        const ids = parts ? new Set(parts.map(pidOf)) : null;
        const gone = [];
        for (const [k, l] of this.links) if (!ids || ids.has(`${l.a.obj}:${l.a.key}`) || ids.has(`${l.b.obj}:${l.b.key}`)) { this.links.delete(k); gone.push(k); }
        // 跳格留下的字跟着弧走
        for (const [k, l] of this.labels) if (l.link && gone.includes(l.link)) this.labels.delete(k);
        return { gone };
      }
      case 'label': {
        const id = words[0];
        if (!id || this.isRef(id)) throw new Error('要写成 label 名字 贴在哪 "字"');
        const refs = args.slice(1).filter((a) => a.t === 'word' && (this.labels.has(a.v) || this.isRef(a.v))).map((a) => a.v);
        for (const r of refs) if (!this.labels.has(r)) this.parts(r);
        if (str == null) throw new Error('label 要有字（写在引号里）');
        for (const p of parseRich(str)) if (p.k === 'ref') this.parts(p.v);
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
        for (const k of ids) { this.labels.delete(k); if (k.startsWith('dial:') && this.vars.get(k.slice(5))) this.vars.get(k.slice(5)).shown = false; }
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
        strayRefs();
        this.focus = words[0] === 'all' || !words.length ? null : refsIn();
        if (this.focus) for (const r of this.focus) this.parts(r);
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
        refs.forEach((r) => this.parts(r));
        this.labels.set(id, { id, refs, text: this.words[n - 1], side: opts.side || null, tone: 'key', link: null });
        return { id, word: n - 1 };
      }
      case 'ask': {
        const kind = words[0];
        if (!['tap', 'drag', 'next', 'say', 'value'].includes(kind)) throw new Error(`ask 后面写 tap / drag / next / say / value，没有「${kind}」`);
        if (str) for (const p of parseRich(str)) if (p.k === 'ref') this.parts(p.v);
        const refs = refsIn(args.slice(1));
        refs.forEach((r) => this.parts(r));
        if (kind === 'drag') {
          const ps = refs.flatMap((r) => this.parts(r));
          if (ps.length < 1) throw new Error('ask drag 要写能拖的东西');
          for (const o of new Set(ps.map((p) => p.obj))) if (!typeOf(this.objects.get(o)).drag) throw new Error(`${typeOf(this.objects.get(o)).label}不能拖`);
        }
        if (kind === 'value' && opts.answer == null) throw new Error('ask value 要写 answer=正确答案（页面当场判）');
        if (str != null) { this.say = str; this.words = parseRich(str).filter((p) => p.k === 'word').map((p) => p.v); }
        this.waiting = { kind, refs, prompt: str ?? '', button: opts.button || null, expect: opts.expect || null, answer: opts.answer ?? null };
        if (opts.expect) this.parts(opts.expect);
        return { kind };
      }
      case 'clear': {
        this.labels.clear();
        this.say = '';
        this.words = [];
        for (const v of this.vars.values()) v.shown = false;
        return {};
      }
      case 'remove': {
        // remove a：把一样东西拿下舞台
        const id = words[0];
        if (!this.objects.has(id)) throw new Error(`舞台上没有「${id}」`);
        this.dropObject(id);
        return { id, removed: true };
      }
      default:
        throw new Error(`没有「${cmd}」这个指令`);
    }
  }

  // 这一行是不是某种东西自己的指令：第一个部件（或者第一个词是东西的名字）是哪种东西，就问那种东西
  ownerOf(c, h) {
    const { cmd } = c;
    const owners = Object.values(TYPES).filter((t) => t.commands?.[cmd]);
    if (!owners.length) return null;
    let target = null;
    for (const a of c.args) {
      if (a.t !== 'word') continue;
      const r = parseRef(a.v);
      if (r && this.objects.has(r.obj)) { target = this.objects.get(r.obj); break; }
    }
    if (!target) {
      // 指令只有一种东西有：交给它（它自己报「舞台上没有……」）
      if (owners.length === 1) return owners[0].commands[cmd];
      throw new Error(`${cmd} 要写对哪一样东西做`);
    }
    const t = typeOf(target);
    if (!t.commands?.[cmd]) throw new Error(`${t.label}没有「${cmd}」（${owners.map((x) => x.label).join('、')}才有）`);
    void h;
    return t.commands[cmd];
  }

  linkKey(a, b) { return [pidOf(a), pidOf(b)].sort().join('~'); }
  addLink(a, b, color, tier = 0) {
    const key = this.linkKey(a, b);
    if (this.links.has(key)) { const l = this.links.get(key); l.color = color; return null; }
    this.links.set(key, { key, a: { obj: a.obj, key: a.key }, b: { obj: b.obj, key: b.key }, color, tier });
    return key;
  }
  dropObject(id, { keepLabels = false } = {}) {
    this.objects.delete(id);
    for (const [k, l] of this.links) if (l.a.obj === id || l.b.obj === id) this.links.delete(k);
    if (!keepLabels) for (const [k, l] of this.labels) if (l.refs.some((r) => parseRef(r)?.obj === id)) this.labels.delete(k);
    this.binds = this.binds.filter((b) => b.obj !== id);
  }
  // 拨的数变了：跟着它的东西（分组、平面上的变换……）重新算
  onVar(name) {
    const out = { name, regroup: [], binds: [] };
    for (const b of this.binds) {
      if (b.v !== name || !this.objects.has(b.obj)) continue;
      const o = this.objects.get(b.obj);
      const t = typeOf(o);
      const r = t.onVar?.(this, o, b, this.vars.get(name).v);
      if (r) { out.binds.push(r); if (b.kind === 'group') out.regroup.push(r); }
    }
    return out;
  }
  /** 一部件找回来（跟着它走的写法） */
  partOf(obj, key) {
    const o = this.objects.get(obj);
    return o ? typeOf(o).parts(o).find((p) => p.key === key) || null : null;
  }

  /** 给老师看的「舞台上现在有什么」：和画面一定对得上（照场景写） */
  stateText() {
    const lines = [];
    if (!this.objects.size) lines.push('舞台上还是空的。');
    const hints = new Set();
    for (const o of this.objects.values()) { const t = typeOf(o); if (t.hint) hints.add(t.hint); }
    for (const h of hints) lines.push(h);
    for (const o of this.objects.values()) lines.push(...typeOf(o).describe(o, this));
    const ls = [...this.links.values()];
    if (ls.length) lines.push(`连线：${ls.map((l) => `${this.refOfKey(l.a)}–${this.refOfKey(l.b)}${l.color ? ` ${COLOR_NAMES[l.color]}` : ''}`).join('，')}`);
    const labels = [...this.labels.values()].filter((l) => !l.dial);
    if (labels.length) lines.push(`贴着的字：${labels.map((l) => `${l.id}「${l.text}」${l.refs.length ? `（贴在 ${l.refs.join(' ')}）` : ''}`).join('；')}`);
    const dials = [...this.vars].filter(([, v]) => v.shown);
    if (dials.length) lines.push(`能拨的数：${dials.map(([n, v]) => `${n} = ${v.v}（${v.lo}～${v.hi}）`).join('，')}`);
    if (this.say) lines.push(`最后说的话：${this.say}`);
    if (this.waiting) lines.push(`在等学生：${{ tap: '点', drag: '拖', next: '点按钮', say: '打字回答', value: '填一个答案' }[this.waiting.kind]}${this.waiting.refs.length ? ` ${this.waiting.refs.join(' ')}` : ''}`);
    return lines.join('\n');
  }
  refOfKey(k) { const p = this.partOf(k.obj, k.key); return p ? this.refOf(p) : `${k.obj}:${k.key}`; }
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
