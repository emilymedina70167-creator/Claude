// 舞台（docs/stage-plan.md）：一整块屏幕是一个场景，东西放在场景里不往上滚；镜头移到讲的地方；
// 老师一行一个动作（script.js 读），这里一个一个演；学生在场景里点、拖、拨，就是回答。
// 画面质量都在这里和 motion.js / layout.js：老师不写坐标、不写时长，只说做什么。
import { EASE, moveDuration, stagger, arcPoints, arcPath, revealDelays, readHold } from './motion.js';
import { rowSlots, bbox, grow, fitCamera, placeLabel, center, strideGroups } from './layout.js';
import { parseScript, parseRef, parseRich, richLength } from './script.js';

const CELL = 64, GAP = 12, ROW_GAP = 22, SPLIT_GAP = 40;
const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const svg = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;

/** 组的颜色：g1～g6（风格里定，深浅两套） */
export const GROUP_NAMES = { g1: '蓝', g2: '粉', g3: '绿', g4: '金', g5: '紫', g6: '橙' };

export class Stage {
  constructor(host, { onAct = null, speed = 1 } = {}) {
    this.host = host;
    this.onAct = onAct;
    this.speed = speed;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.objects = new Map();
    this.labels = new Map();
    this.links = new Map();
    this.vars = new Map();
    this.binds = []; // 跟着拨的数变的：{ kind: 'group', obj, v }
    this.cam = { s: 1, tx: 0, ty: 0 };
    this.focus = null; // 镜头对准的部件（换屏幕大小时重新对准）
    this.words = []; // 这一句话里能飞走的词
    this.waiting = null;
    this.build();
  }

  build() {
    const root = el('div', 'st-stage', this.host);
    this.root = root;
    this.view = el('div', 'st-view', root);
    this.world = el('div', 'st-world', this.view);
    this.ink = svg('svg', { class: 'st-ink', width: 1, height: 1 }, this.world);
    this.layer = el('div', 'st-layer', this.world);
    this.caption = el('div', 'st-caption', this.view);
    this.caption.setAttribute('aria-live', 'polite');
    this.dock = el('div', 'st-dock', this.view);
    this.flyLayer = el('div', 'st-fly', this.view);
    this.ro = new ResizeObserver(() => this.refocus(false));
    this.ro.observe(this.view);
  }

  destroy() { this.ro?.disconnect(); this.root.remove(); }

  // —— 动画：都走这一个口，速度和「减少动态」统一管 ——
  dur(ms) { return this.reduced ? 1 : Math.max(1, ms / this.speed); }
  tween(node, frames, { duration = 500, delay = 0, easing = EASE.move } = {}) {
    if (!node || !frames.length) return Promise.resolve();
    const last = frames[frames.length - 1];
    const a = node.animate(frames, { duration: this.dur(duration), delay: this.dur(delay), easing, fill: 'both' });
    return a.finished.catch(() => {}).then(() => {
      for (const [k, v] of Object.entries(last)) if (k !== 'offset' && k !== 'easing') node.style[k] = v;
      a.cancel();
    });
  }

  // —— 镜头 ——
  viewSize() { return { w: this.view.clientWidth || 800, h: this.view.clientHeight || 600 }; }
  reserve() {
    // 顶上留给说的话（按现在这句话有多高，至少两行），底下留给按钮
    const cap = this.caption.querySelector('.st-line:not(.is-out)');
    const ch = Math.max(84, (cap?.offsetHeight || 0) + 34);
    return { top: ch + 18, bottom: this.dock.childElementCount ? 92 : 40 };
  }
  async camera(box, animate = true) {
    if (!box) return;
    const { top, bottom } = this.reserve();
    const next = fitCamera(box, this.viewSize(), { top, bottom, pad: 28, maxScale: 1.5, lift: 0.4 });
    const from = `translate(${this.cam.tx}px, ${this.cam.ty}px) scale(${this.cam.s})`;
    const to = `translate(${next.tx}px, ${next.ty}px) scale(${next.s})`;
    this.cam = next;
    this.placeCaption(box, animate);
    if (!animate) { this.world.style.transform = to; return; }
    await this.tween(this.world, [{ transform: from }, { transform: to }], { duration: 760, easing: EASE.move });
  }
  // 说的话贴在镜头里那块东西的上方（下沿对齐），镜头挪了它跟着挪
  placeCaption(box, animate) {
    const { h } = this.viewSize();
    const topScreen = box.y * this.cam.s + this.cam.ty;
    const bottom = Math.max(0, Math.round(h - topScreen + 22));
    this.caption.style.transition = animate && !this.reduced ? `bottom ${this.dur(760)}ms ${EASE.move}` : 'none';
    this.caption.style.bottom = `${bottom}px`;
  }
  refocus(animate = true) { return this.camera(this.focusBox(), animate); }
  focusBox() {
    if (!this.focus) return this.allBox();
    const boxes = [];
    let whole = false;
    for (const r of this.focus) {
      const ref = parseRef(r);
      if (ref?.kind === 'all') { whole = true; const o = this.objects.get(ref.obj); if (o) boxes.push(o.box()); }
      else boxes.push(...this.resolve(r).map((c) => c.obj.cellBox(c)));
    }
    if (whole) {
      for (const l of this.labels.values()) boxes.push(l.box);
      // 拱起来的弧也算进镜头：话贴在弧上面，不压着弧
      for (const k of this.links.values()) { try { const b = k.path.getBBox(); if (b.width || b.height) boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height }); } catch { /* 还没画上 */ } }
    }
    return boxes.length ? grow(bbox(boxes), 12) : this.allBox();
  }
  // 新贴了字、放了拨数：跑出镜头了就把镜头挪一挪（对准整个东西的时候）
  async keepInView() {
    if (this.focus && !this.focus.some((r) => parseRef(r)?.kind === 'all')) return;
    const { top, bottom } = this.reserve();
    const next = fitCamera(this.focusBox(), this.viewSize(), { top, bottom, pad: 28, maxScale: 1.5, lift: 0.4 });
    if (Math.abs(next.s - this.cam.s) / this.cam.s > 0.03 || Math.abs(next.tx - this.cam.tx) > 14 || Math.abs(next.ty - this.cam.ty) > 14) await this.refocus(true);
    else this.placeCaption(this.focusBox(), true); // 镜头不用挪，话也要让开新贴上的字
  }
  allBox() {
    const boxes = [];
    for (const o of this.objects.values()) boxes.push(o.box());
    for (const l of this.labels.values()) boxes.push(l.box);
    return bbox(boxes);
  }
  toScreen(p) { return { x: p.x * this.cam.s + this.cam.tx, y: p.y * this.cam.s + this.cam.ty }; }

  // —— 部件 ——
  resolve(word) {
    const r = typeof word === 'string' ? parseRef(word) : word;
    if (!r) throw new Error(`「${word}」不是舞台上的东西`);
    const o = this.objects.get(r.obj);
    if (!o) throw new Error(`舞台上没有「${r.obj}」`);
    return o.pick(r);
  }
  refsOf(args) { return args.filter((a) => a.t === 'word' && parseRef(a.v) && this.objects.has(parseRef(a.v).obj)).map((a) => a.v); }
  cellsOf(args) { return this.refsOf(args).flatMap((w) => this.resolve(w)); }
  obstacles(except = null) {
    const out = [];
    for (const o of this.objects.values()) out.push(...o.boxes());
    for (const l of this.labels.values()) if (l !== except) out.push(l.box);
    // 连线的弧也算：字不压在弧上
    for (const k of this.links.values()) { try { const b = k.path.getBBox(); if (b.width || b.height) out.push({ x: b.x, y: b.y, w: b.width, h: b.height }); } catch { /* 还没画上 */ } }
    return out;
  }

  // —— 演一段 ——
  async play(src) {
    const cmds = parseScript(src);
    const bad = cmds.filter((c) => !c.cmd);
    if (bad.length) throw new Error(bad.map((b) => `第 ${b.line} 行：${b.error}`).join('\n'));
    let i = 0;
    let result = null;
    while (i < cmds.length) {
      // 和上一行一起演的（& 开头）一批一起跑
      const batch = [cmds[i]];
      while (cmds[i + batch.length]?.par) batch.push(cmds[i + batch.length]);
      const res = await Promise.all(batch.map((c) => this.exec(c)));
      result = res.find((r) => r != null) ?? result;
      i += batch.length;
    }
    return result;
  }

  async exec(c) {
    const { cmd, args, opts } = c;
    const words = args.filter((a) => a.t === 'word').map((a) => a.v);
    const str = args.find((a) => a.t === 'str')?.v;
    const fn = this[`do_${cmd}`];
    if (!fn) throw new Error(`第 ${c.line} 行：「${cmd}」还没做`);
    try {
      return await fn.call(this, { args, opts, words, str, line: c.line });
    } catch (err) {
      err.message = `第 ${c.line} 行（${c.src.trim()}）：${err.message}`;
      throw err;
    }
  }

  // array a = 49 38 …
  async do_array({ words }) {
    const [id, ...vals] = words;
    if (!id || !vals.length) throw new Error('要写成 array 名字 = 一个个数');
    this.objects.get(id)?.remove();
    const o = new ArrayObj(this, id, vals);
    this.objects.set(id, o);
    if (!this.focus) this.focus = [id];
    await this.camera(this.focusBox(), false);
    await o.enter();
  }

  async do_say({ str }) { await this.say(str ?? ''); }
  async do_glow({ args }) { this.cellsOf(args).forEach((c) => c.obj.setGlow(c, true)); await sleep(this.dur(300)); }
  async do_unglow({ args }) { this.cellsOf(args).forEach((c) => c.obj.setGlow(c, false)); }
  async do_lift({ args }) { await Promise.all(this.cellsOf(args).map((c, i) => c.obj.setLift(c, true, stagger(i, { step: 40 })))); }
  async do_drop({ args }) { await Promise.all(this.cellsOf(args).map((c) => c.obj.setLift(c, false))); }
  async do_pulse({ args }) { await Promise.all(this.cellsOf(args).map((c, i) => c.obj.pulse(c, stagger(i, { step: 60 })))); }
  async do_paint({ args, words }) {
    const color = words.find((w) => /^g\d$/.test(w)) || 'g1';
    await Promise.all(this.cellsOf(args).map((c, i) => c.obj.setPaint(c, color, stagger(i, { step: 50 }))));
  }
  async do_unpaint({ args }) { this.cellsOf(args).forEach((c) => c.obj.setPaint(c, null)); await sleep(this.dur(250)); }

  // link a.1 a.6 g1：两格之间连一道弧（跟着格子走）
  async do_link({ args, words }) {
    const color = words.find((w) => /^g\d$/.test(w)) || 'g1';
    const cells = this.cellsOf(args);
    const tasks = [];
    for (let i = 0; i + 1 < cells.length; i++) tasks.push(this.link(cells[i], cells[i + 1], color, { delay: stagger(i, { step: 90 }) }));
    await Promise.all(tasks);
    await this.keepInView();
  }
  async do_unlink({ args }) {
    const cells = args.length ? this.cellsOf(args) : null;
    const keys = cells ? new Set(cells.map((c) => `${c.obj.id}:${c.key}`)) : null;
    await Promise.all([...this.links.values()].filter((l) => !keys || keys.has(`${l.a.obj.id}:${l.a.key}`) || keys.has(`${l.b.obj.id}:${l.b.key}`)).map((l) => this.unlink(l)));
  }

  // hop a.1 -> a.6 [label="…"] [color=g1]：一个小点从一格一格跳过去，数着跳了几下，留下一道弧
  async do_hop({ args, opts, words }) {
    const ai = args.findIndex((a) => a.t === 'arrow');
    if (ai < 0) throw new Error('要写成 hop 从哪 -> 到哪');
    const [from] = this.cellsOf(args.slice(0, ai));
    const [to] = this.cellsOf(args.slice(ai + 1));
    if (!from || !to) throw new Error('hop 要两头都是格子');
    const color = opts.color || words.find((w) => /^g\d$/.test(w)) || 'g1';
    await from.obj.hop(from, to, { color, label: opts.label, count: opts.count !== 'off' });
  }

  async do_swap({ args }) {
    const cells = this.cellsOf(args);
    if (cells.length !== 2) throw new Error('swap 要正好两格');
    await cells[0].obj.swap(cells[0], cells[1]);
  }

  // group a stride=5（stride 可以写拨的数的名字，拨一下就重新分组）
  async do_group({ words, opts }) {
    const o = this.objects.get(words[0]);
    if (!o) throw new Error(`舞台上没有「${words[0]}」`);
    const v = opts.stride ?? '1';
    this.binds = this.binds.filter((b) => !(b.kind === 'group' && b.obj === o.id));
    if (!/^\d+$/.test(v)) this.binds.push({ kind: 'group', obj: o.id, v });
    await o.group(this.num(v));
    await this.replaceLabels();
    await this.keepInView();
  }
  async do_split({ words }) { const o = this.objects.get(words[0]); await o.split(); }
  async do_merge({ words }) { const o = this.objects.get(words[0]); await o.merge(); }

  // label L1 a.3 a.6 "相等，但先后换了" [side=below] [keep]：字贴在东西旁边，是舞台上的东西（能改、能挪、能拿掉）
  async do_label({ words, str, opts, args }) {
    const id = words[0];
    // 锚：舞台上的格子，或者另一块字 / 拨数（dial:d）
    const refs = args.slice(1).filter((a) => a.t === 'word' && (this.labels.has(a.v) || (parseRef(a.v) && this.objects.has(parseRef(a.v).obj)))).map((a) => a.v);
    await this.label(id, refs, str ?? '', { side: opts.side, tone: opts.tone, from: opts.from });
  }
  async do_retext({ words, str }) {
    const l = this.labels.get(words[0]);
    if (!l) throw new Error(`没有叫「${words[0]}」的字`);
    l.text = str ?? '';
    await this.renderLabel(l, true);
  }
  async do_unlabel({ words }) {
    const ids = words.length ? words : [...this.labels.keys()];
    await Promise.all(ids.map((id) => this.unlabel(id)));
  }

  // dial d = 5 range=1-5 at=a：一个能拨的数（拨了，跟着它的东西一起变）
  async do_dial({ words, opts }) {
    const [name, val] = words;
    const [lo, hi] = String(opts.range || '1-9').split('-').map(Number);
    this.vars.set(name, { v: Number(val ?? lo), lo, hi });
    await this.dial(name, opts.at || words[3] || [...this.objects.keys()][0]);
  }

  // set d 5：老师把拨的数拨到一个值（跟着它的东西一起变）
  async do_set({ words }) {
    const x = this.vars.get(words[0]);
    if (!x) throw new Error(`没有叫「${words[0]}」的数`);
    const v = Math.max(x.lo, Math.min(x.hi, Number(words[1])));
    if (v === x.v) return;
    x.v = v;
    this.labels.get(`dial:${words[0]}`)?.repaint?.();
    await this.onVar(words[0]);
    await sleep(this.dur(700));
  }

  async do_camera({ args, words }) {
    this.focus = words[0] === 'all' || !words.length ? null : this.refsOf(args);
    await this.refocus(true);
  }
  async do_wait({ words }) { await sleep(this.dur(Number(words[0]) || 600)); }
  async do_clear() {
    await Promise.all([...this.labels.keys()].map((id) => this.unlabel(id)));
    await this.say('');
  }

  // fly say.1 -> L2 a.3 a.6：话里的一个词飞到图上，变成贴在那里的字
  async do_fly({ args }) {
    const ai = args.findIndex((a) => a.t === 'arrow');
    const src = args[0]?.v || '';
    const n = Number(src.split('.')[1]) || 1;
    const word = this.words[n - 1];
    if (!word) throw new Error(`这句话里没有第 ${n} 个 [词]`);
    const id = args[ai + 1]?.v;
    const refs = this.refsOf(args.slice(ai + 2));
    await this.label(id, refs, word.textContent, { tone: 'key', from: word });
  }

  // ask tap a "…" / ask drag a.1 a.6 "…" / ask next "…" button="接着"
  async do_ask({ words, str, opts, args }) {
    const kind = words[0];
    if (str) await this.say(str);
    if (kind === 'tap') return this.askTap(this.refsOf(args.slice(1)));
    if (kind === 'drag') return this.askDrag(this.refsOf(args.slice(1)));
    if (kind === 'next') return this.askNext(opts.button || '接着');
    throw new Error(`ask 后面要写 tap / drag / next，没有「${kind}」`);
  }

  num(v) {
    if (/^-?\d+(\.\d+)?$/.test(String(v))) return Number(v);
    const x = this.vars.get(v);
    if (!x) throw new Error(`没有叫「${v}」的数`);
    return x.v;
  }

  // —— 说的话：一个字一个字写出来；{a.2} 是和图上同色的小块，[词] 能飞到图上 ——
  async say(text) {
    const old = [...this.caption.children];
    old.forEach((n) => {
      n.classList.add('is-out');
      this.tween(n, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-14px)' }], { duration: 260, easing: EASE.in }).then(() => n.remove());
    });
    this.words = [];
    if (!text) return;
    const line = el('p', 'st-line', this.caption);
    const parts = parseRich(text);
    const glyphs = [];
    for (const p of parts) {
      if (p.k === 'text') for (const ch of p.v) { const s = el('span', 'st-ch', line); s.textContent = ch; glyphs.push(s); }
      else if (p.k === 'ref') { const chip = this.chip(p.v); line.appendChild(chip); glyphs.push(chip); }
      else if (p.k === 'var') { const s = el('span', 'st-var', line); s.dataset.var = p.v; s.textContent = String(this.vars.get(p.v)?.v ?? p.v); glyphs.push(s); }
      else if (p.k === 'math') { const s = el('i', 'st-math', line); s.textContent = p.v; glyphs.push(s); }
      else { const s = el('span', 'st-word', line); s.textContent = p.v; glyphs.push(s); this.words.push(s); }
    }
    const delays = revealDelays(glyphs.length);
    glyphs.forEach((g, i) => { g.style.opacity = '0'; this.tween(g, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320, delay: delays[i], easing: EASE.out }); });
    await sleep(this.dur((delays.at(-1) || 0) + 320 + readHold(richLength(parts))));
  }

  // 话里的 {a.2}：画成那一格的样子（同色、同数），点了图上那一格闪一下
  chip(ref) {
    const chip = el('button', 'st-chip');
    chip.type = 'button';
    try {
      const [c] = this.resolve(ref);
      chip.textContent = c.value;
      chip.dataset.cell = `${c.obj.id}#${c.key}`;
      if (c.paint) chip.dataset.paint = c.paint;
      chip.addEventListener('click', () => c.obj.pulse(c));
    } catch { chip.textContent = ref; chip.classList.add('is-bad'); }
    return chip;
  }

  // —— 连线 ——
  async link(a, b, color, { delay = 0, tier = 0 } = {}) {
    const key = [`${a.obj.id}:${a.key}`, `${b.obj.id}:${b.key}`].sort().join('~');
    if (this.links.has(key)) return;
    const path = svg('path', { class: `st-link`, 'data-paint': color }, this.ink);
    const l = { key, a, b, color, path, tier };
    this.links.set(key, l);
    this.drawLink(l);
    const len = path.getTotalLength();
    path.style.strokeDasharray = `${len}`;
    await this.tween(path, [{ strokeDashoffset: `${len}` }, { strokeDashoffset: '0' }], { duration: 460, delay, easing: EASE.out });
    path.style.strokeDasharray = '';
  }
  drawLink(l) {
    const A = l.a.obj.cellBox(l.a), B = l.b.obj.cellBox(l.b);
    if (l.a.row || l.b.row) {
      // 分开排的时候：两格之间一条横线（藏在格子后面），不拱弧，免得压到上一排
      l.path.setAttribute('d', `M${A.x + A.w / 2} ${A.y + A.h / 2} L${B.x + B.w / 2} ${B.y + B.h / 2}`);
      l.path.classList.add('is-rail');
    } else {
      l.path.setAttribute('d', arcPath({ x: A.x + A.w / 2, y: A.y - 6 }, { x: B.x + B.w / 2, y: B.y - 6 }, { lift: 0.16 + 0.03 * (l.tier || 0), min: 18 + 5 * (l.tier || 0), max: 100 }));
      l.path.classList.remove('is-rail');
    }
  }
  // 格子要挪了：连线先淡掉，挪完照新位置重画再淡进来（弧线跟着动画变形太贵，淡出淡入看着也自然）
  hideLinks(objId) {
    const mine = [...this.links.values()].filter((l) => l.a.obj.id === objId);
    return Promise.all(mine.map((l) => this.tween(l.path, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 })));
  }
  showLinks(objId) {
    const mine = [...this.links.values()].filter((l) => l.a.obj.id === objId);
    mine.forEach((l) => this.drawLink(l));
    return Promise.all(mine.map((l) => this.tween(l.path, [{ opacity: 0 }, { opacity: l.path.classList.contains('is-rail') ? 0.3 : 0.9 }], { duration: 280 }).then(() => { l.path.style.opacity = ''; })));
  }
  async unlink(l) {
    this.links.delete(l.key);
    await this.tween(l.path, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
    l.path.remove();
  }

  // —— 贴着东西的字 ——
  async label(id, refs, text, { side, tone, from, anchor = null } = {}) {
    if (this.labels.has(id)) await this.unlabel(id);
    const node = el('div', `st-label${tone ? ` is-${tone}` : ''}`, this.layer);
    const l = { id, refs, text, node, side, anchor, box: { x: 0, y: 0, w: 0, h: 0 } };
    this.labels.set(id, l);
    await this.renderLabel(l, false, from);
  }
  async renderLabel(l, morph = false, from = null) {
    const node = l.node;
    const before = morph ? { w: node.offsetWidth, h: node.offsetHeight } : null;
    node.replaceChildren();
    for (const p of parseRich(l.text)) {
      if (p.k === 'ref') node.appendChild(this.chip(p.v));
      else if (p.k === 'var') { const s = el('span', 'st-var', node); s.dataset.var = p.v; s.textContent = String(this.vars.get(p.v)?.v ?? p.v); }
      else if (p.k === 'math') { const s = el('i', 'st-math', node); s.textContent = p.v; }
      else node.appendChild(document.createTextNode(p.v));
    }
    const size = { w: node.offsetWidth, h: node.offsetHeight };
    const refBox = (r) => (this.labels.has(r) && this.labels.get(r) !== l ? [this.labels.get(r).box] : this.resolve(r).map((c) => c.obj.cellBox(c)));
    const anchor = l.anchor && !morph ? l.anchor : l.refs.length ? grow(bbox(l.refs.flatMap(refBox)), 4) : this.allBox() || { x: 0, y: 0, w: 1, h: 1 };
    const prefer = l.side ? [l.side, 'above', 'below', 'right', 'left'] : ['above', 'below', 'right', 'left'];
    const p = placeLabel(anchor, size, this.obstacles(l), { prefer, gap: 12 });
    const moved = l.box.w && (Math.abs(l.box.x - p.x) > 1 || Math.abs(l.box.y - p.y) > 1);
    const old = { ...l.box };
    l.box = { x: p.x, y: p.y, ...size };
    if (from) {
      // 从话里飞过来：先在屏幕上从那个词的位置飞到这里，落地以后换成贴着的字
      node.style.transform = tr(p.x, p.y);
      node.style.opacity = '0';
      const r0 = from.getBoundingClientRect(), v0 = this.view.getBoundingClientRect();
      const ghost = el('span', 'st-ghost', this.flyLayer);
      ghost.textContent = from.textContent;
      const s0 = { x: r0.left - v0.left, y: r0.top - v0.top };
      const s1 = this.toScreen({ x: p.x, y: p.y });
      from.classList.add('is-flown');
      const pts = arcPoints(s0, s1, { dir: -1, lift: 0.18, max: 90 });
      const sc = this.cam.s;
      await this.tween(ghost, pts.map((q) => ({ transform: `translate(${q.x}px, ${q.y}px) scale(${1 + (sc - 1) * q.t})`, offset: q.t })), { duration: 900, easing: EASE.move });
      ghost.remove();
      node.style.opacity = '1';
      await Promise.all([this.tween(node, [{ transform: tr(p.x, p.y, 1.12) }, { transform: tr(p.x, p.y) }], { duration: 380, easing: EASE.spring }), this.keepInView()]);
      return;
    }
    if (morph && before) {
      // 改字：旧的宽度缩放到新的，字淡进来
      await this.tween(node, [{ transform: tr(moved ? old.x : p.x, moved ? old.y : p.y), opacity: 0.2 }, { transform: tr(p.x, p.y), opacity: 1 }], { duration: 420, easing: EASE.out });
      return;
    }
    if (moved) { await this.tween(node, [{ transform: tr(old.x, old.y) }, { transform: tr(p.x, p.y) }], { duration: 480 }); return; }
    node.style.transform = tr(p.x, p.y);
    await Promise.all([this.tween(node, [{ opacity: 0, transform: tr(p.x, p.y + 8) }, { opacity: 1, transform: tr(p.x, p.y) }], { duration: 380, easing: EASE.out }), this.keepInView()]);
  }
  async replaceLabels() { await Promise.all([...this.labels.values()].filter((l) => !l.dial).map((l) => this.renderLabel(l))); }
  async unlabel(id) {
    const l = this.labels.get(id);
    if (!l) return;
    this.labels.delete(id);
    await this.tween(l.node, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
    l.node.remove();
  }

  // —— 能拨的数 ——
  async dial(name, at) {
    const x = this.vars.get(name);
    const id = `dial:${name}`;
    this.labels.get(id)?.node.remove();
    const node = el('div', 'st-dial', this.layer);
    const dec = el('button', 'st-dial-b', node); dec.type = 'button'; dec.textContent = '‹'; dec.setAttribute('aria-label', `${name} 小一点`);
    const lab = el('span', 'st-dial-v', node);
    const inc = el('button', 'st-dial-b', node); inc.type = 'button'; inc.textContent = '›'; inc.setAttribute('aria-label', `${name} 大一点`);
    const paint = () => { lab.innerHTML = `<i class="st-math">${name}</i> = <b>${x.v}</b>`; dec.disabled = x.v <= x.lo; inc.disabled = x.v >= x.hi; };
    paint();
    const set = (v) => { const nv = Math.max(x.lo, Math.min(x.hi, v)); if (nv === x.v) return; x.v = nv; paint(); this.onVar(name); this.onAct?.({ type: 'dial', name, value: nv }); };
    dec.addEventListener('click', () => set(x.v - 1));
    inc.addEventListener('click', () => set(x.v + 1));
    // 按住数字左右拖也能拨（一格 36px）
    let sx = null, sv = 0;
    lab.addEventListener('pointerdown', (e) => { sx = e.clientX; sv = x.v; lab.setPointerCapture(e.pointerId); });
    lab.addEventListener('pointermove', (e) => { if (sx != null) set(sv + Math.round((e.clientX - sx) / 36)); });
    lab.addEventListener('pointerup', () => { sx = null; });
    lab.addEventListener('pointercancel', () => { sx = null; });
    const l = { id, refs: this.objects.has(at) ? [at] : [], text: '', node, side: 'below', box: { x: 0, y: 0, w: 0, h: 0 }, dial: true, repaint: paint };
    this.labels.set(id, l);
    const size = { w: node.offsetWidth, h: node.offsetHeight };
    const anchor = grow(this.objects.get(at)?.box() || this.allBox(), 6);
    const p = placeLabel(anchor, size, this.obstacles(l), { prefer: ['below', 'above'], gap: 18 });
    l.box = { x: p.x, y: p.y, ...size };
    node.style.transform = tr(p.x, p.y);
    await Promise.all([this.tween(node, [{ opacity: 0, transform: tr(p.x, p.y + 10) }, { opacity: 1, transform: tr(p.x, p.y) }], { duration: 420, easing: EASE.out }), this.keepInView()]);
  }
  async onVar(name) {
    const v = this.vars.get(name).v;
    this.root.querySelectorAll(`.st-var[data-var="${name}"]`).forEach((s) => { s.textContent = String(v); s.animate?.([{ transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: this.dur(300), easing: EASE.spring }); });
    for (const b of this.binds) if (b.v === name && b.kind === 'group') this.objects.get(b.obj)?.group(v).then(() => this.replaceLabels()).then(() => this.keepInView());
    for (const l of this.labels.values()) if (!l.dial && l.text.includes(`{${name}}`)) this.renderLabel(l, true);
  }

  // —— 等学生 ——
  askTap(refs) {
    const cells = refs.length ? refs.flatMap((r) => this.resolve(r)) : [...this.objects.values()].flatMap((o) => o.cells);
    return new Promise((resolve) => {
      const offs = cells.map((c) => c.obj.armTap(c, () => { offs.forEach((f) => f()); this.onAct?.({ type: 'tap', ref: `${c.obj.id}.${c.slot}`, value: c.value }); resolve({ type: 'tap', cell: c, slot: c.slot, key: c.key, value: c.value }); }));
    });
  }
  askDrag(refs) {
    const cells = refs.flatMap((r) => this.resolve(r));
    return new Promise((resolve) => {
      const offs = cells.map((c) => c.obj.armDrag(c, cells, async (a, b) => { offs.forEach((f) => f()); await a.obj.swap(a, b, { fromDrag: true }); this.onAct?.({ type: 'drag', a: a.key, b: b.key }); resolve({ type: 'drag', a, b }); }));
    });
  }
  askNext(text) {
    return new Promise((resolve) => {
      const b = el('button', 'st-next', this.dock);
      b.type = 'button';
      b.textContent = `${text} →`;
      this.tween(b, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 360, easing: EASE.out });
      b.addEventListener('click', async () => {
        b.disabled = true;
        this.onAct?.({ type: 'next' });
        await this.tween(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
        b.remove();
        resolve({ type: 'next' });
      }, { once: true });
    });
  }
}

// —— 一排格子 ——
class ArrayObj {
  constructor(stage, id, values) {
    this.stage = stage;
    this.id = id;
    this.n = values.length;
    this.slots = rowSlots(this.n, { cell: CELL, gap: GAP });
    this.group_d = null;
    this.ghosts = this.slots.map((s, i) => {
      const g = el('div', 'st-slot', stage.layer);
      g.style.transform = tr(s.x, s.y);
      const k = el('span', 'st-idx', g); k.textContent = String(i + 1);
      return g;
    });
    this.cells = values.map((v, i) => {
      const node = el('div', 'st-cell', stage.layer);
      const t = el('span', 'st-v', node);
      t.textContent = v;
      return { obj: this, key: i + 1, slot: i + 1, value: v, node, row: 0, paint: null, lift: false };
    });
  }
  remove() { this.cells.forEach((c) => c.node.remove()); this.ghosts.forEach((g) => g.remove()); }
  pick(r) {
    if (r.kind === 'all') return [...this.cells].sort((a, b) => a.slot - b.slot);
    const by = r.kind === 'slot' ? 'slot' : 'key';
    const out = this.cells.filter((c) => c[by] >= r.lo && c[by] <= r.hi).sort((a, b) => a[by] - b[by]);
    if (!out.length) throw new Error(`${this.id} 只有 ${this.n} 格，没有 ${r.lo}${r.hi !== r.lo ? `-${r.hi}` : ''}`);
    return out;
  }
  rowY(row) { return row ? CELL + SPLIT_GAP + (row - 1) * (CELL + ROW_GAP) : 0; }
  cellBox(c) { const s = this.slots[c.slot - 1]; return { x: s.x, y: s.y + this.rowY(c.row) - (c.lift ? 12 : 0), w: CELL, h: CELL }; }
  boxes() { return [...this.cells.map((c) => this.cellBox(c)), ...this.slots.map((s) => ({ ...s, h: s.h + 22 }))]; }
  box() { return bbox(this.boxes()); }
  place(c) { const b = this.cellBox(c); return tr(b.x, b.y); }

  async enter() {
    // 一格一格落下来（从左到右），序号跟着淡进来
    this.ghosts.forEach((g, i) => this.stage.tween(g, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: stagger(i, { step: 40 }) }));
    await Promise.all(this.cells.map((c, i) => {
      const b = this.cellBox(c);
      return this.stage.tween(c.node, [{ opacity: 0, transform: tr(b.x, b.y - 26, 0.9) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 520, delay: stagger(i, { step: 45 }), easing: EASE.spring });
    }));
  }
  setGlow(c, on) { c.node.classList.toggle('is-glow', on); }
  async setLift(c, on, delay = 0) {
    const from = this.place(c);
    c.lift = on;
    c.node.classList.toggle('is-lift', on);
    await this.stage.tween(c.node, [{ transform: from }, { transform: this.place(c) }], { duration: 380, delay, easing: EASE.spring });
  }
  async setPaint(c, color, delay = 0) {
    if (delay) await sleep(this.stage.dur(delay));
    c.paint = color;
    if (color) c.node.dataset.paint = color; else delete c.node.dataset.paint;
    // 话里、字里指着它的小块跟着变色
    this.stage.root.querySelectorAll(`.st-chip[data-cell="${this.id}#${c.key}"]`).forEach((ch) => { if (color) ch.dataset.paint = color; else delete ch.dataset.paint; });
    await this.pulse(c);
  }
  async pulse(c, delay = 0) {
    const t = this.place(c);
    const b = this.cellBox(c);
    await this.stage.tween(c.node, [{ transform: t }, { transform: `${tr(b.x, b.y)} scale(1.1)` }, { transform: t }], { duration: 420, delay, easing: EASE.out });
  }

  // 从一格跳到另一格：小点一格一格跳，头上数着 1、2、3……，落地后两格之间留一道弧
  async hop(from, to, { color = 'g1', label, count = true } = {}) {
    const st = this.stage;
    const dot = el('div', 'st-hopper', st.layer);
    dot.dataset.paint = color;
    const top = (slot) => { const s = this.slots[slot - 1]; const y = s.y + this.rowY(from.row); return { x: s.x + CELL / 2 - 8, y: y - 22 }; };
    const step = to.slot > from.slot ? 1 : -1;
    let at = top(from.slot);
    dot.style.transform = tr(at.x, at.y);
    await st.tween(dot, [{ opacity: 0, transform: tr(at.x, at.y + 10, 0.4) }, { opacity: 1, transform: tr(at.x, at.y) }], { duration: 260, easing: EASE.spring });
    let k = 0;
    for (let s = from.slot + step; step > 0 ? s <= to.slot : s >= to.slot; s += step) {
      const next = top(s);
      const pts = arcPoints(at, next, { lift: 0.5, min: 18, max: 34 });
      await st.tween(dot, pts.map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), { duration: 230, easing: 'linear' });
      k++;
      if (count) {
        const n = el('div', 'st-count', st.layer);
        n.dataset.paint = color;
        n.textContent = String(k);
        n.style.transform = tr(next.x - 4, next.y - 26);
        st.tween(n, [{ opacity: 0, transform: tr(next.x - 4, next.y - 16) }, { opacity: 1, transform: tr(next.x - 4, next.y - 26), offset: 0.3 }, { opacity: 0, transform: tr(next.x - 4, next.y - 34) }], { duration: 900, easing: EASE.out }).then(() => n.remove());
      }
      at = next;
    }
    await st.tween(dot, [{ opacity: 1, transform: tr(at.x, at.y) }, { opacity: 0, transform: tr(at.x, at.y + 18, 0.5) }], { duration: 220, easing: EASE.in });
    dot.remove();
    await st.link(from, to, color);
    if (label) {
      const id = `hop:${from.key}`;
      const arc = [...st.links.values()].find((l) => (l.a === from && l.b === to) || (l.a === to && l.b === from));
      let anchor = null;
      try { const b = arc.path.getBBox(); anchor = { x: b.x, y: b.y, w: b.width, h: b.height }; } catch { anchor = null; }
      await st.label(id, [`${this.id}#${from.key}`, `${this.id}#${to.key}`], label, { side: 'above', tone: 'soft', anchor });
    }
  }

  // 交换：两格各走一道弧换位置（一个从上面过、一个从下面过），连线跟着重画
  async swap(a, b, { fromDrag = false } = {}) {
    const st = this.stage;
    const A = this.cellBox(a), B = this.cellBox(b);
    [a.slot, b.slot] = [b.slot, a.slot];
    const A2 = this.cellBox(a), B2 = this.cellBox(b);
    const d = moveDuration(Math.abs(A.x - B.x)) + 120;
    const go = (c, p0, p1, dir) => st.tween(c.node, arcPoints(p0, p1, { dir, lift: 0.42, min: 40, max: 110 }).map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), { duration: fromDrag ? d * 0.7 : d, easing: EASE.move });
    a.node.classList.add('is-moving'); b.node.classList.add('is-moving');
    await st.hideLinks(this.id);
    // 学生拖过去的那一格从手放开的地方直接落位，另一格走弧线让开
    const first = fromDrag
      ? st.tween(a.node, [{ transform: a.node.style.transform }, { transform: tr(A2.x, A2.y) }], { duration: 420, easing: EASE.spring })
      : go(a, A, A2, -1);
    await Promise.all([first, go(b, B, B2, 1)]);
    a.node.classList.remove('is-moving'); b.node.classList.remove('is-moving');
    await Promise.all([st.showLinks(this.id), st.replaceLabels()]);
  }

  // 按「隔 d 个」分组：旧的连线收掉，每组染一种颜色、连起来（一组接一组）
  async group(d) {
    const st = this.stage;
    this.group_d = d;
    const gen = (this.gen = (this.gen || 0) + 1);
    const mine = [...st.links.values()].filter((l) => l.a.obj === this);
    await Promise.all(mine.map((l) => st.unlink(l)));
    const groups = strideGroups(this.n, d);
    const colors = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
    const jobs = [];
    groups.forEach((g, gi) => {
      const cells = g.map((s) => this.cells.find((c) => c.slot === s));
      const color = groups.length === 1 ? null : colors[gi % colors.length];
      jobs.push((async () => {
        await sleep(st.dur(stagger(gi, { step: 110, max: 700 })));
        if (gen !== this.gen) return;
        await Promise.all(cells.map((c) => this.setPaint(c, color)));
        for (let i = 0; i + 1 < cells.length; i++) if (color && gen === this.gen) await st.link(cells[i], cells[i + 1], color, { tier: gi });
      })());
    });
    await Promise.all(jobs);
  }

  // 分开排：每组下到自己的一排（位置的横坐标不变），原来的位置留个虚框和序号
  async split() {
    const groups = strideGroups(this.n, this.group_d || 1);
    const rowOf = new Map();
    groups.forEach((g, gi) => g.forEach((s) => rowOf.set(s, gi + 1)));
    await this.moveRows((c) => rowOf.get(c.slot));
  }
  async merge() { await this.moveRows(() => 0); }
  async moveRows(rowFor) {
    const st = this.stage;
    await st.hideLinks(this.id);
    const jobs = this.cells.map((c) => {
      const from = this.place(c);
      c.row = rowFor(c);
      const to = this.place(c);
      return st.tween(c.node, [{ transform: from }, { transform: to }], { duration: 640, delay: stagger(c.row || c.slot, { step: 80 }), easing: EASE.move });
    });
    st.focus = [this.id];
    await Promise.all([...jobs, st.refocus(true)]);
    await Promise.all([st.showLinks(this.id), st.replaceLabels()]);
  }

  // 等学生点：能点的格子一圈呼吸的光，按下去一沉
  armTap(c, done) {
    const n = c.node;
    n.classList.add('is-tap');
    let pressed = false;
    const on = (e) => { e.preventDefault(); pressed = true; n.classList.add('is-press'); };
    const up = () => { if (!pressed) return; pressed = false; n.classList.remove('is-press'); done(); };
    const leave = () => { pressed = false; n.classList.remove('is-press'); };
    n.addEventListener('pointerdown', on);
    n.addEventListener('pointerup', up);
    n.addEventListener('pointerleave', leave);
    n.addEventListener('pointercancel', leave);
    return () => { n.classList.remove('is-tap', 'is-press'); n.removeEventListener('pointerdown', on); n.removeEventListener('pointerup', up); n.removeEventListener('pointerleave', leave); n.removeEventListener('pointercancel', leave); };
  }

  // 等学生拖：按住一格左右拖，放到同一排的另一格上就换过去
  armDrag(c, peers, done) {
    const st = this.stage;
    const n = c.node;
    n.classList.add('is-drag');
    let start = null, base = null;
    const down = (e) => { e.preventDefault(); n.setPointerCapture(e.pointerId); start = { x: e.clientX, y: e.clientY }; base = this.cellBox(c); n.classList.add('is-hold'); };
    const move = (e) => {
      if (!start) return;
      const dx = (e.clientX - start.x) / st.cam.s, dy = (e.clientY - start.y) / st.cam.s;
      n.style.transform = `${tr(base.x + dx, base.y + dy * 0.35)} scale(1.08)`;
      const target = this.dropTarget(c, peers, base.x + dx);
      peers.forEach((p) => p.node.classList.toggle('is-over', p === target));
    };
    const up = (e) => {
      if (!start) return;
      const dx = (e.clientX - start.x) / st.cam.s;
      start = null;
      n.classList.remove('is-hold');
      peers.forEach((p) => p.node.classList.remove('is-over'));
      const target = this.dropTarget(c, peers, base.x + dx);
      if (target) { done(c, target); return; }
      st.tween(n, [{ transform: n.style.transform }, { transform: this.place(c) }], { duration: 360, easing: EASE.spring });
    };
    n.addEventListener('pointerdown', down);
    n.addEventListener('pointermove', move);
    n.addEventListener('pointerup', up);
    n.addEventListener('pointercancel', up);
    return () => { n.classList.remove('is-drag', 'is-hold'); n.removeEventListener('pointerdown', down); n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up); n.removeEventListener('pointercancel', up); };
  }
  dropTarget(c, peers, x) {
    let best = null, bd = Infinity;
    for (const p of peers) {
      if (p === c || p.row !== c.row) continue;
      const d = Math.abs(this.cellBox(p).x - x);
      if (d < bd) { bd = d; best = p; }
    }
    return bd < CELL * 0.75 ? best : null;
  }
}

export { center };
