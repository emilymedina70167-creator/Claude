// 舞台的画面（docs/stage-plan.md）：照着场景（scene.js）演。一整块屏幕是一个场景，东西不往上滚；镜头移到讲的地方；
// 老师一行一个动作，这里一个一个演（能边写边演：写完一行演一行）；学生在场景里点、拖、拨、打字，就是回答。
//
// 每一行：先在场景上 check（写错了挡下、记进 errors，别的行照演）→ 场景 apply → 有专门动作的（跳格、交换、插入、比较、
// 飞字、说话）演专门的动作 → sync 把画面对齐到场景（新出现的、变了的、没了的，用默认的动作补上）。
// 演过的每一行记进 log（学生拖、拨造成的变化也记成一行），刷新或作废一轮时照 log 瞬间重放（replay）。
import { EASE, moveDuration, stagger, arcPoints, revealDelays, readHold } from './motion.js';
import { bbox, grow, fitCamera, placeLabel, overlaps, linkGeom, slotBox, CELL } from './layout.js';
import { parseScript, parseRich, richLength } from './script.js';
import { Scene, compareValues, COLOR_NAMES } from './scene.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const svg = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
const ckey = (c) => `${c.obj}#${c.key}`;

export { COLOR_NAMES };

export class Stage {
  constructor(host, { onAct = null, onLine = null, speed = 1, input = true } = {}) {
    this.host = host;
    this.onAct = onAct;
    this.onLine = onLine; // 每演完老师的一行（量「第一个镜头多久出来」、收起「老师在想」）
    this.speed = speed;
    this.withInput = input;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.instant = false; // 重放时：不演动画、不等学生
    this.scene = new Scene();
    this.log = []; // 演过的每一行 { src, by: 'teacher' | 'student', turn }
    this.errors = []; // 这一轮没演的行 { line, src, error }
    this.turnNo = 0;
    this.cells = new Map(); // 'a#3' → 节点
    this.slots = new Map(); // 'a' → [虚框节点]
    this.paths = new Map(); // 连线 key → path
    this.labelNodes = new Map(); // id → { node, box, sig }
    this.ptrNodes = new Map(); // 'a:low' → 节点
    this.cam = { s: 1, tx: 0, ty: 0 };
    this.pending = []; // 学生在等待期间的试（拨数），跟着下一次回答一起告诉老师
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
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.refocus(false)) : null;
    this.ro?.observe(this.view);
  }
  destroy() { this.ro?.disconnect(); this.root.remove(); this.cancelWait?.(); }

  // —— 动画：都走这一个口（速度、「减少动态」、重放统一管）——
  dur(ms) { return this.instant ? 0 : this.reduced ? 1 : Math.max(1, ms / this.speed); }
  wait(ms) { return this.instant ? Promise.resolve() : sleep(this.dur(ms)); }
  tween(node, frames, { duration = 500, delay = 0, easing = EASE.move } = {}) {
    if (!node || !frames.length) return Promise.resolve();
    const last = frames[frames.length - 1];
    // 动画停在最后一帧；完全不透明就不留在行内（不然盖住样式里的「灰掉」「淡」）
    const apply = () => { for (const [k, v] of Object.entries(last)) if (k !== 'offset' && k !== 'easing') node.style[k] = k === 'opacity' && String(v) === '1' ? '' : v; };
    if (this.instant || typeof node.animate !== 'function') { apply(); return Promise.resolve(); }
    const a = node.animate(frames, { duration: this.dur(duration), delay: this.dur(delay), easing, fill: 'both' });
    return a.finished.catch(() => {}).then(() => { apply(); a.cancel(); });
  }

  // —— 演一段（整段写好的） ——
  async play(src, { by = 'teacher', auto = false } = {}) {
    const t = this.begin({ by, auto });
    return t.end(src);
  }

  /**
   * 开一轮：老师边写边演。push(到现在为止写出来的全部文字) 每写完一行就演一行；end() 等这一轮演完、等到学生回答。
   * 返回 { push, end, done }；end() 的结果是 { act, errors, lines }
   */
  begin({ by = 'teacher', auto = true } = {}) {
    const turn = ++this.turnNo;
    const mark = this.log.length;
    this.errors = [];
    let taken = 0; // 已经交给队列的行数
    let chain = Promise.resolve();
    let running = null; // 正在演的那一批（& 开头的行并进去）
    let asked = null;
    let lines = 0;
    let dead = false; // 这一轮作废了（不是指定的模型）：后面的行不演
    const enqueue = (c) => {
      if (dead) return;
      if (asked) { this.errors.push({ line: c.line, src: c.src?.trim(), error: 'ask 之后的行不演（一轮以 ask 结尾）' }); return; }
      if (c.cmd === 'ask') asked = c;
      lines++;
      if (c.par && running) { running.jobs.push(this.exec(c, { by, turn })); return; }
      const batch = { jobs: [] };
      chain = chain.then(async () => {
        if (dead) return;
        running = batch;
        batch.jobs.push(this.exec(c, { by, turn }));
        // & 开头的行可能在这一批开演以后才写出来：等到这一批的活都演完（期间新并进来的也等）
        for (let k = 0; k < batch.jobs.length; k++) await batch.jobs[k];
        running = null;
      });
    };
    const feed = (text, final) => {
      const raw = String(text ?? '').replace(/^```[^\n]*\n?/gm, '');
      const all = raw.split('\n');
      const done = final ? all : all.slice(0, -1);
      const fresh = done.slice(taken);
      taken = done.length;
      if (!fresh.length) return;
      // 行号接着前面的算（报错时对得上老师写的第几行）
      const cmds = parseScript(fresh.map((l) => (l.trim() ? l : '#')).join('\n'));
      const base = taken - fresh.length;
      for (const c of cmds) enqueue({ ...c, line: c.line + base, src: c.src ?? fresh[c.line - 1] });
    };
    let last = '';
    const end = async (text) => {
      if (dead) return { act: null, errors: [], lines, mark, dead: true };
      feed(text != null ? text : last, true);
      await chain;
      // 一轮没有 ask：页面替它等一下（按钮「接着」和打字），不让课停在半空
      let act = null;
      if (!this.instant && (asked || auto)) {
        if (!asked) await this.exec({ cmd: 'ask', args: [{ t: 'word', v: 'next' }], opts: {}, line: 0, src: 'ask next' }, { by: 'page', turn });
        act = await this.waitAct();
      }
      return { act, errors: [...this.errors], lines, mark };
    };
    // 作废：后面的行不演，等正在演的那一行演完，再照 log 退回这一轮之前
    const abort = async () => { dead = true; await chain.catch(() => {}); await this.rollback(mark); };
    return { push: (text) => { if (!dead) { last = text; feed(text, false); } }, end, abort, turn, mark };
  }

  /** 作废这一轮（不是指定的模型、写坏了）：照 log 退回这一轮开始之前的样子 */
  async rollback(mark) {
    this.cancelWait?.();
    await this.replay(this.log.slice(0, mark));
  }

  /** 照记录瞬间重放（刷新后放回、作废一轮后退回）：画面直接到最后的样子，不演动画、不等学生 */
  async replay(log) {
    this.instant = true;
    this.clearAll();
    this.log = [];
    for (const row of log) {
      for (const c of parseScript(row.src)) {
        if (c.cmd === 'ask') { if (row === log[log.length - 1]) { /* 最后一问照旧等 */ } continue; }
        await this.exec(c, { by: row.by, turn: row.turn });
      }
    }
    this.instant = false;
    this.scene.waiting = null;
    await this.sync();
    await this.refocus(false);
  }
  clearAll() {
    this.scene = new Scene();
    this.cells.forEach((n) => n.remove()); this.cells.clear();
    this.slots.forEach((list) => list.forEach((n) => n.remove())); this.slots.clear();
    this.paths.forEach((p) => p.remove()); this.paths.clear();
    this.labelNodes.forEach((l) => l.node.remove()); this.labelNodes.clear();
    this.ptrNodes.forEach((n) => n.remove()); this.ptrNodes.clear();
    this.caption.replaceChildren();
    this.dock.replaceChildren();
  }

  // —— 一行 ——
  async exec(c, { by = 'teacher', turn = this.turnNo } = {}) {
    const err = this.scene.check(c);
    if (err) {
      this.errors.push({ line: c.line, src: c.src?.trim(), error: err });
      return null;
    }
    const pre = this.capture();
    const fx = this.scene.apply(c);
    this.log.push({ src: c.src?.trim() || '', by, turn });
    const choreo = this[`do_${c.cmd}`];
    if (by === 'teacher' && !this.instant) this.onLine?.(c);
    try {
      if (choreo) await choreo.call(this, c, fx, pre);
      await this.sync({ pre, cmd: c.cmd, fx });
      if (!this.instant && c.cmd !== 'camera') this.keepInView();
    } catch (e) {
      // 画面出错不能把课卡住：记下来，画面照场景重画一遍
      this.errors.push({ line: c.line, src: c.src?.trim(), error: `画面没演好：${e.message}` });
      await this.sync({ pre });
    }
    return fx;
  }

  // 演之前每一格、每个指针在哪（专门的动作从这里出发）
  capture() {
    const boxes = new Map();
    for (const [k, n] of this.cells) if (n.__box) boxes.set(k, { ...n.__box });
    return { boxes, say: this.scene.say };
  }

  // —— 专门的动作 ——
  async do_array(c, fx) {
    // 新的一排：先把镜头对好，再一格一格落下来
    await this.sync({ entering: fx.id });
    await this.refocus(false);
    const o = this.scene.objects.get(fx.id);
    const ghosts = this.slots.get(fx.id) || [];
    ghosts.forEach((g, i) => this.tween(g, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: stagger(i, { step: 40 }) }));
    await Promise.all(o.cells.map((x, i) => {
      const n = this.cells.get(ckey(x)), b = this.scene.cellBox(x);
      return this.tween(n, [{ opacity: 0, transform: tr(b.x, b.y - 26, 0.9) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 520, delay: stagger(i, { step: 45 }), easing: EASE.spring });
    }));
  }

  async do_say() { await this.say(this.scene.say); }

  async do_pulse(c, fx) { await Promise.all(fx.cells.map((x, i) => this.pulse(x, stagger(i, { step: 60 })))); }

  async do_hop(c, fx) {
    // 一个小点一格一格跳过去，头上数着 1、2、3……；落地以后 sync 画上弧（和贴在弧上的字）
    const { from, to, color } = fx;
    const o = this.scene.objects.get(from.obj);
    const top = (slot) => { const s = slotBox(o, slot); const b = this.scene.cellBox(from); return { x: s.x + CELL / 2 - 8, y: b.y - 22 }; };
    const dot = el('div', 'st-hopper', this.layer);
    dot.dataset.paint = color;
    let at = top(from.slot);
    dot.style.transform = tr(at.x, at.y);
    await this.tween(dot, [{ opacity: 0, transform: tr(at.x, at.y + 10, 0.4) }, { opacity: 1, transform: tr(at.x, at.y) }], { duration: 260, easing: EASE.spring });
    const step = to.slot > from.slot ? 1 : -1;
    let k = 0;
    for (let s = from.slot + step; step > 0 ? s <= to.slot : s >= to.slot; s += step) {
      const next = top(s);
      await this.tween(dot, arcPoints(at, next, { lift: 0.5, min: 18, max: 34 }).map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), { duration: 230, easing: 'linear' });
      k++;
      if (!this.instant) {
        const n = el('div', 'st-count', this.layer);
        n.dataset.paint = color;
        n.textContent = String(k);
        this.tween(n, [{ opacity: 0, transform: tr(next.x - 4, next.y - 16) }, { opacity: 1, transform: tr(next.x - 4, next.y - 26), offset: 0.3 }, { opacity: 0, transform: tr(next.x - 4, next.y - 34) }], { duration: 900, easing: EASE.out }).then(() => n.remove());
      }
      at = next;
    }
    await this.tween(dot, [{ opacity: 1, transform: tr(at.x, at.y) }, { opacity: 0, transform: tr(at.x, at.y + 18, 0.5) }], { duration: 220, easing: EASE.in });
    dot.remove();
  }

  // 交换：两格各走一道弧换位置（一个从上面过、一个从下面过）；学生拖过去的那一格从手放开的地方直接落位
  async do_swap(c, fx, pre) {
    const { a, b } = fx;
    await this.hideLinks([a, b]);
    const A = pre.boxes.get(ckey(a)), B = pre.boxes.get(ckey(b));
    const A2 = this.scene.cellBox(a), B2 = this.scene.cellBox(b);
    const d = moveDuration(Math.abs((A?.x ?? 0) - (B?.x ?? 0))) + 120;
    const go = (x, p0, p1, dir) => this.moveCell(x, arcPoints(p0, p1, { dir, lift: 0.42, min: 40, max: 110 }).map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), p1, { duration: d });
    const dragged = c.dragged;
    await Promise.all([
      dragged ? this.moveCell(a, [{ transform: this.cells.get(ckey(a)).style.transform }, { transform: tr(A2.x, A2.y) }], A2, { duration: 420, easing: EASE.spring }) : go(a, A || A2, A2, -1),
      go(b, B || B2, B2, 1),
    ]);
  }

  // 插入：这一格抬起来走弧线到新位置，中间的格子各让一格（sync 让它们滑过去）
  async do_move(c, fx, pre) {
    const x = fx.cell;
    await this.hideLinks([x, ...fx.moved]);
    const A = pre.boxes.get(ckey(x)), B = this.scene.cellBox(x);
    const others = this.sync({ pre, only: fx.moved });
    await Promise.all([this.moveCell(x, arcPoints(A || B, B, { dir: -1, lift: 0.35, min: 50, max: 120 }).map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), B, { duration: moveDuration(Math.abs((A?.x ?? B.x) - B.x)) + 200 }), others]);
  }

  async do_write(c, fx) {
    const n = this.cells.get(ckey(fx.cell));
    if (!n) return;
    const b = n.__box;
    await this.tween(n, [{ transform: tr(b.x, b.y) }, { transform: `${tr(b.x, b.y)} scale(0.82)`, opacity: 0.4 }], { duration: 160, easing: EASE.in });
    n.querySelector('.st-v').textContent = fx.cell.value;
    await this.tween(n, [{ transform: `${tr(b.x, b.y)} scale(0.82)`, opacity: 0.4 }, { transform: tr(b.x, b.y), opacity: 1 }], { duration: 320, easing: EASE.spring });
  }

  // 比较：两格亮一下，中间冒出「65 > 49′」，停一会儿再收起
  async do_compare(c, fx) {
    const { a, b, sign } = fx;
    const A = this.scene.cellBox(a), B = this.scene.cellBox(b);
    const badge = el('div', 'st-compare', this.layer);
    badge.innerHTML = `<span></span><b>${sign < 0 ? '<' : sign > 0 ? '>' : '='}</b><span></span>`;
    badge.children[0].textContent = a.value;
    badge.children[2].textContent = b.value;
    const w = badge.offsetWidth || 90, h = badge.offsetHeight || 34;
    const x = (A.x + B.x + CELL) / 2 - w / 2, y = Math.min(A.y, B.y) - h - 16;
    await Promise.all([this.pulse(a), this.pulse(b), this.tween(badge, [{ opacity: 0, transform: tr(x, y + 10) }, { opacity: 1, transform: tr(x, y) }], { duration: 320, easing: EASE.out })]);
    await this.wait(1100);
    await this.tween(badge, [{ opacity: 1, transform: tr(x, y) }, { opacity: 0, transform: tr(x, y - 8) }], { duration: 240, easing: EASE.in });
    badge.remove();
  }

  async do_camera() { await this.refocus(true); }
  async do_wait(c, fx) { await this.wait(fx.ms); }

  // 话里的 [词] 飞到图上：sync 先把落点算好（字先藏着），这里从那个词的位置飞过去
  async do_fly(c, fx) {
    const word = this.caption.querySelectorAll('.st-line:not(.is-out) .st-word')[fx.word];
    await this.sync({ hide: [fx.id] });
    const l = this.labelNodes.get(fx.id);
    if (!l || !word || this.instant) { if (l) l.node.style.opacity = '1'; return; }
    // 先让话让开落点（落点在图上方时话往上挪），再飞
    await this.keepInView();
    await this.wait(200);
    const r0 = word.getBoundingClientRect(), v0 = this.view.getBoundingClientRect();
    const ghost = el('span', 'st-ghost', this.flyLayer);
    ghost.textContent = word.textContent;
    const s0 = { x: r0.left - v0.left, y: r0.top - v0.top };
    const s1 = this.toScreen({ x: l.box.x, y: l.box.y });
    word.classList.add('is-flown');
    const sc = this.cam.s;
    await this.tween(ghost, arcPoints(s0, s1, { dir: -1, lift: 0.18, max: 90 }).map((q) => ({ transform: `translate(${q.x}px, ${q.y}px) scale(${1 + (sc - 1) * q.t})`, offset: q.t })), { duration: 900, easing: EASE.move });
    ghost.remove();
    l.node.style.opacity = '1';
    await this.tween(l.node, [{ transform: tr(l.box.x, l.box.y, 1.12) }, { transform: tr(l.box.x, l.box.y) }], { duration: 380, easing: EASE.spring });
  }

  async do_ask() {
    const w = this.scene.waiting;
    if (w?.prompt) await this.say(w.prompt);
  }

  // —— 把画面对齐到场景：新出现的落下来 / 淡进来，挪了的滑过去，没了的淡掉 ——
  async sync({ pre = null, only = null, entering = null, hide = [], cmd = null, fx = null } = {}) {
    const sc = this.scene;
    const jobs = [];
    // 一排排格子
    for (const o of sc.objects.values()) {
      if (!this.slots.has(o.id)) {
        this.slots.set(o.id, o.cells.map((x, i) => {
          const g = el('div', 'st-slot', this.layer);
          const s = slotBox(o, i + 1);
          g.style.transform = tr(s.x, s.y);
          if (entering === o.id) g.style.opacity = '0';
          el('span', 'st-idx', g).textContent = String(i + 1);
          return g;
        }));
      }
    }
    for (const [id, list] of this.slots) if (!sc.objects.has(id)) { list.forEach((g) => this.tween(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => g.remove())); this.slots.delete(id); }
    const live = new Set();
    const moving = [];
    for (const o of sc.objects.values()) {
      for (const x of o.cells) {
        const k = ckey(x);
        live.add(k);
        let n = this.cells.get(k);
        const b = sc.cellBox(x);
        if (!n) {
          n = el('div', 'st-cell', this.layer);
          el('span', 'st-v', n).textContent = x.value;
          n.style.transform = tr(b.x, b.y);
          n.__box = b;
          if (entering === o.id) n.style.opacity = '0';
          this.cells.set(k, n);
        }
        const v = n.querySelector('.st-v');
        if (v.textContent !== x.value) v.textContent = x.value;
        const was = n.dataset.paint || null;
        if (x.paint) n.dataset.paint = x.paint; else delete n.dataset.paint;
        n.classList.toggle('is-glow', x.glow);
        n.classList.toggle('is-lift', x.lift);
        n.classList.toggle('is-dim', x.dim);
        // 扣过去 / 翻开：像翻一张牌（转到侧面那一刻换面）
        if (!!n.__covered !== !!x.covered) {
          const on = !!x.covered;
          n.__covered = on;
          if (this.instant || !n.__box) n.classList.toggle('is-covered', on);
          else {
            const t = tr(n.__box.x, n.__box.y);
            jobs.push((async () => {
              await this.tween(n, [{ transform: `${t} rotateY(0deg)` }, { transform: `${t} rotateY(90deg)` }], { duration: 180, delay: stagger(jobs.length, { step: 60 }), easing: EASE.in });
              // 换面按场景现在的样子（同一格可能同时被扣上又翻开：& 并着演的两行）
              n.classList.toggle('is-covered', !!x.covered);
              await this.tween(n, [{ transform: `${t} rotateY(-90deg)` }, { transform: t }], { duration: 220, easing: EASE.out });
            })());
          }
        }
        if (was !== (x.paint || null) && !this.instant && cmd === 'paint') jobs.push(this.pulse(x, stagger(jobs.length, { step: 50 })));
        if (!same(n.__box, b) && (!only || only.includes(x))) moving.push({ x, n, from: n.__box, to: b });
        // 话里指着它的小块跟着变色
        this.root.querySelectorAll(`.st-chip[data-cell="${k}"]`).forEach((ch) => { if (x.paint) ch.dataset.paint = x.paint; else delete ch.dataset.paint; if (ch.textContent !== x.value) ch.textContent = x.value; });
      }
    }
    for (const [k, n] of this.cells) if (!live.has(k)) { this.cells.delete(k); this.tween(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).then(() => n.remove()); }
    // 挪了的格子：连线先藏、挪完再画；分开排 / 合回去按排错开，别的按位置错开
    if (moving.length) {
      await this.hideLinks(moving.map((m) => m.x));
      const order = (m) => (cmd === 'split' || cmd === 'merge' ? m.x.row || m.x.slot : m.x.slot);
      await Promise.all(moving.map((m) => this.moveCell(m.x, [{ transform: tr(m.from.x, m.from.y) }, { transform: tr(m.to.x, m.to.y) }], m.to, { duration: cmd === 'split' || cmd === 'merge' ? 640 : moveDuration(Math.abs(m.from.x - m.to.x)), delay: stagger(order(m), { step: 70, max: 500 }) })));
    }
    // 连线
    const tiers = new Map();
    for (const l of sc.links.values()) tiers.set(l.key, l.tier || 0);
    const linkJobs = [];
    let drawn = 0;
    for (const l of sc.links.values()) {
      const geo = this.linkGeo(l);
      let p = this.paths.get(l.key);
      if (!p) {
        p = svg('path', { class: 'st-link' }, this.ink);
        p.dataset.paint = l.color || 'g1';
        this.paths.set(l.key, p);
        p.setAttribute('d', geo.d);
        p.classList.toggle('is-rail', geo.rail);
        p.__d = geo.d;
        if (!this.instant) {
          const len = p.getTotalLength?.() || 300;
          p.style.strokeDasharray = `${len}`;
          // 重新分组时一组一组画（按组错开），别的按先后
          const delay = fx?.made ? stagger(fx.made.find((m) => m.key === l.key)?.group ?? drawn, { step: 110, max: 700 }) : stagger(drawn, { step: 90 });
          drawn++;
          linkJobs.push(this.tween(p, [{ strokeDashoffset: `${len}` }, { strokeDashoffset: '0' }], { duration: 460, delay, easing: EASE.out }).then(() => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }));
        }
        continue;
      }
      p.dataset.paint = l.color || 'g1';
      if (p.__d !== geo.d || p.__hidden) {
        p.setAttribute('d', geo.d);
        p.__d = geo.d;
        p.classList.toggle('is-rail', geo.rail);
        if (p.__hidden) { p.__hidden = false; linkJobs.push(this.tween(p, [{ opacity: 0 }, { opacity: geo.rail ? 0.3 : 0.9 }], { duration: 280 }).then(() => { p.style.opacity = ''; })); }
      }
    }
    for (const [k, p] of this.paths) if (!sc.links.has(k)) { this.paths.delete(k); linkJobs.push(this.tween(p, [{ opacity: p.__hidden ? 0 : 1 }, { opacity: 0 }], { duration: 220 }).then(() => p.remove())); }
    // 指针
    const ptrs = sc.ptrBoxes();
    const livePtr = new Set();
    for (const pb of ptrs) {
      const k = `${pb.obj}:${pb.name}`;
      livePtr.add(k);
      let n = this.ptrNodes.get(k);
      if (!n) {
        n = el('div', 'st-ptr', this.layer);
        n.innerHTML = '<i>▲</i><span></span>';
        n.querySelector('span').textContent = pb.name;
        n.style.transform = tr(pb.x, pb.y);
        n.__box = pb;
        this.ptrNodes.set(k, n);
        jobs.push(this.tween(n, [{ opacity: 0, transform: tr(pb.x, pb.y + 10) }, { opacity: 1, transform: tr(pb.x, pb.y) }], { duration: 320, easing: EASE.out }));
      } else if (!same(n.__box, pb)) {
        const from = n.__box;
        n.__box = pb;
        jobs.push(this.tween(n, [{ transform: tr(from.x, from.y) }, { transform: tr(pb.x, pb.y) }], { duration: moveDuration(Math.abs(from.x - pb.x)), easing: EASE.move }));
      }
    }
    for (const [k, n] of this.ptrNodes) if (!livePtr.has(k)) { this.ptrNodes.delete(k); jobs.push(this.tween(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => n.remove())); }
    await Promise.all(jobs);
    await Promise.all(linkJobs);
    await this.syncLabels(hide);
  }

  linkGeo(l) {
    const sc = this.scene;
    const a = sc.objects.get(l.a.obj)?.cells.find((x) => x.key === l.a.key);
    const b = sc.objects.get(l.b.obj)?.cells.find((x) => x.key === l.b.key);
    if (!a || !b) return { d: '', box: null, rail: false };
    return linkGeom(sc.cellBox(a), sc.cellBox(b), { tier: l.tier || 0, rail: !!(a.row || b.row) });
  }

  // 格子挪了：连着它的线先淡掉（挪完 sync 照新位置画，再淡进来）
  hideLinks(cells) {
    const keys = new Set(cells.map(ckey));
    const jobs = [];
    for (const l of this.scene.links.values()) {
      if (!keys.has(`${l.a.obj}#${l.a.key}`) && !keys.has(`${l.b.obj}#${l.b.key}`)) continue;
      const p = this.paths.get(l.key);
      if (!p || p.__hidden) continue;
      p.__hidden = true;
      jobs.push(this.tween(p, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 }));
    }
    return Promise.all(jobs);
  }

  moveCell(x, frames, to, { duration = 520, delay = 0, easing = EASE.move } = {}) {
    const n = this.cells.get(ckey(x));
    if (!n) return Promise.resolve();
    n.__box = { ...to };
    n.classList.add('is-moving');
    return this.tween(n, frames, { duration, delay, easing }).then(() => n.classList.remove('is-moving'));
  }

  async pulse(x, delay = 0) {
    const n = this.cells.get(ckey(x));
    if (!n?.__box) return;
    const t = tr(n.__box.x, n.__box.y);
    await this.tween(n, [{ transform: t }, { transform: `${t} scale(1.1)` }, { transform: t }], { duration: 420, delay, easing: EASE.out });
  }

  // —— 贴着的字和拨数：新的淡进来、字变了的换字、锚挪了的跟过去、没了的淡掉 ——
  obstacles(exceptId) {
    const sc = this.scene;
    const out = [];
    for (const o of sc.objects.values()) {
      for (let i = 1; i <= o.cells.length; i++) out.push({ ...slotBox(o, i), h: CELL + 22 });
      for (const x of o.cells) out.push(sc.cellBox(x));
    }
    for (const p of sc.ptrBoxes()) out.push(p);
    for (const l of sc.links.values()) { const g = this.linkGeo(l); if (g.box) out.push(g.box); }
    for (const [id, l] of this.labelNodes) if (id !== exceptId && l.box && sc.labels.has(id)) out.push(l.box);
    return out;
  }
  anchorOf(l) {
    const sc = this.scene;
    if (l.link) { const k = sc.links.get(l.link); const g = k && this.linkGeo(k); if (g?.box) return g.box; }
    const boxes = [];
    for (const r of l.refs) {
      if (sc.labels.has(r)) { const n = this.labelNodes.get(r); if (n?.box) boxes.push(n.box); continue; }
      try { boxes.push(...(sc.objects.has(r) ? [sc.objectBox(r)] : sc.cells(r).map((x) => sc.cellBox(x)))); } catch { /* 锚没了 */ }
    }
    return boxes.length ? grow(bbox(boxes), 4) : null;
  }
  async syncLabels(hide = []) {
    const sc = this.scene;
    const jobs = [];
    // 拨数先摆（别的字可能贴着它）
    const order = [...sc.labels.values()].sort((a, b) => (b.dial ? 1 : 0) - (a.dial ? 1 : 0));
    for (const l of order) {
      let cur = this.labelNodes.get(l.id);
      const sig = l.dial ? `dial:${l.dial}` : `${l.tone}|${l.text}`;
      if (cur && cur.sig !== sig) { cur.node.remove(); this.labelNodes.delete(l.id); cur = null; }
      const fresh = !cur;
      if (fresh) {
        const node = l.dial ? this.dialNode(l.dial) : el('div', `st-label${l.tone ? ` is-${l.tone}` : ''}`, this.layer);
        if (!l.dial) this.richInto(node, l.text);
        cur = { node, box: null, sig, anchor: null };
        this.labelNodes.set(l.id, cur);
      } else if (!l.dial) {
        // 字里的拨数跟着变
        cur.node.querySelectorAll('.st-var').forEach((s) => { const v = String(sc.vars.get(s.dataset.var)?.v ?? s.dataset.var); if (s.textContent !== v) s.textContent = v; });
      }
      if (l.dial) cur.node.__paint?.();
      const anchor = this.anchorOf(l) || bbox([...sc.objects.values()].map((o) => sc.objectBox(o.id))) || { x: 0, y: 0, w: 1, h: 1 };
      const size = { w: cur.node.offsetWidth || 80, h: cur.node.offsetHeight || 32 };
      const obs = this.obstacles(l.id);
      const stale = !cur.box || !cur.anchor || Math.abs(cur.anchor.x - anchor.x) > 1 || Math.abs(cur.anchor.y - anchor.y) > 1 || Math.abs(cur.anchor.w - anchor.w) > 1 || cur.box.w !== size.w || obs.some((o) => overlaps(grow(cur.box, 1), o));
      if (!stale) continue;
      const prefer = l.side ? [l.side, 'above', 'below', 'right', 'left'] : ['above', 'below', 'right', 'left'];
      const p = placeLabel(anchor, size, obs, { prefer, gap: l.dial ? 18 : 12 });
      const from = cur.box;
      cur.box = { x: p.x, y: p.y, ...size };
      cur.anchor = anchor;
      const node = cur.node;
      if (hide.includes(l.id)) { node.style.transform = tr(p.x, p.y); node.style.opacity = '0'; continue; }
      if (fresh || !from) {
        node.style.transform = tr(p.x, p.y);
        jobs.push(this.tween(node, [{ opacity: 0, transform: tr(p.x, p.y + 8) }, { opacity: 1, transform: tr(p.x, p.y) }], { duration: 380, easing: EASE.out }));
      } else {
        jobs.push(this.tween(node, [{ transform: tr(from.x, from.y) }, { transform: tr(p.x, p.y) }], { duration: 480 }));
      }
    }
    for (const [id, l] of this.labelNodes) if (!sc.labels.has(id)) { this.labelNodes.delete(id); jobs.push(this.tween(l.node, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).then(() => l.node.remove())); }
    await Promise.all(jobs);
  }

  // 话、字里的写法画出来：{a.2} 是同色同数的小块，{d} 是拨的数，$d$ 是字母
  richInto(node, text, { glyphs = null, words = null } = {}) {
    for (const p of parseRich(text)) {
      if (p.k === 'text') {
        if (glyphs) for (const ch of p.v) { const s = el('span', 'st-ch', node); s.textContent = ch; glyphs.push(s); }
        else node.appendChild(document.createTextNode(p.v));
      } else if (p.k === 'ref') { const chip = this.chip(p.v); node.appendChild(chip); glyphs?.push(chip); }
      else if (p.k === 'var') { const s = el('span', 'st-var', node); s.dataset.var = p.v; s.textContent = String(this.scene.vars.get(p.v)?.v ?? p.v); glyphs?.push(s); }
      else if (p.k === 'math') { const s = el('i', 'st-math', node); s.textContent = p.v; glyphs?.push(s); }
      else { const s = el('span', 'st-word', node); s.textContent = p.v; glyphs?.push(s); words?.push(s); }
    }
  }
  chip(ref) {
    const chip = el('button', 'st-chip');
    chip.type = 'button';
    try {
      const [x] = this.scene.cells(ref);
      chip.textContent = x.value;
      chip.dataset.cell = ckey(x);
      if (x.paint) chip.dataset.paint = x.paint;
      chip.addEventListener('click', () => this.pulse(x));
    } catch { chip.textContent = ref; chip.classList.add('is-bad'); }
    return chip;
  }

  // —— 说的话：一个字一个字写出来 ——
  async say(text) {
    [...this.caption.children].forEach((n) => {
      n.classList.add('is-out');
      this.tween(n, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-14px)' }], { duration: 260, easing: EASE.in }).then(() => n.remove());
    });
    if (!text) return;
    const line = el('p', 'st-line', this.caption);
    const glyphs = [];
    this.richInto(line, text, { glyphs, words: [] });
    if (this.instant) return;
    const delays = revealDelays(glyphs.length);
    glyphs.forEach((g, i) => { g.style.opacity = '0'; this.tween(g, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320, delay: delays[i], easing: EASE.out }); });
    this.placeCaption(this.focusBox(), true);
    await sleep(this.dur((delays.at(-1) || 0) + 320 + readHold(richLength(parseRich(text)))));
  }

  // —— 能拨的数 ——
  dialNode(name) {
    const x = this.scene.vars.get(name);
    const node = el('div', 'st-dial', this.layer);
    const dec = el('button', 'st-dial-b', node); dec.type = 'button'; dec.textContent = '‹'; dec.setAttribute('aria-label', `${name} 小一点`);
    const lab = el('span', 'st-dial-v', node);
    const inc = el('button', 'st-dial-b', node); inc.type = 'button'; inc.textContent = '›'; inc.setAttribute('aria-label', `${name} 大一点`);
    const paint = () => { const v = this.scene.vars.get(name); if (!v) return; lab.innerHTML = `<i class="st-math"></i> = <b></b>`; lab.firstChild.textContent = name; lab.lastChild.textContent = String(v.v); dec.disabled = v.v <= v.lo; inc.disabled = v.v >= v.hi; };
    node.__paint = paint;
    paint();
    const set = (v) => {
      const cur = this.scene.vars.get(name);
      const nv = Math.max(cur.lo, Math.min(cur.hi, v));
      if (nv === cur.v) return;
      this.studentDo(`set ${name} ${nv}`, { type: 'dial', name, value: nv, from: cur.v });
    };
    dec.addEventListener('click', () => set(this.scene.vars.get(name).v - 1));
    inc.addEventListener('click', () => set(this.scene.vars.get(name).v + 1));
    // 按住数字左右拖也能拨（一格 36px）
    let sx = null, sv = 0;
    lab.addEventListener('pointerdown', (e) => { sx = e.clientX; sv = this.scene.vars.get(name).v; lab.setPointerCapture?.(e.pointerId); });
    lab.addEventListener('pointermove', (e) => { if (sx != null) set(sv + Math.round((e.clientX - sx) / 36)); });
    lab.addEventListener('pointerup', () => { sx = null; });
    lab.addEventListener('pointercancel', () => { sx = null; });
    void x;
    return node;
  }

  // 学生的动作改了舞台（拨数、拖过去换位置）：照一行指令走场景（记进 log，刷新、作废都照它放回）
  studentDo(src, act) {
    const [c] = parseScript(src);
    this.studentChain = (this.studentChain || Promise.resolve()).then(() => this.exec({ ...c, dragged: act.type === 'drag' }, { by: 'student' }));
    if (act.type === 'dial') {
      const last = this.pending.findLast?.((p) => p.type === 'dial' && p.name === act.name);
      if (last) last.path.push(act.value); else this.pending.push({ ...act, path: [act.from ?? null, act.value].filter((v) => v != null) });
    }
    this.onAct?.(act);
    return this.studentChain;
  }

  // —— 镜头 ——
  viewSize() { return { w: this.view.clientWidth || 800, h: this.view.clientHeight || 600 }; }
  reserve() {
    const cap = this.caption.querySelector('.st-line:not(.is-out)');
    const ch = Math.max(84, (cap?.offsetHeight || 0) + 34);
    return { top: ch + 18, bottom: this.dock.childElementCount ? 104 : 40 };
  }
  focusBox() {
    const sc = this.scene;
    const boxes = [];
    if (!sc.focus) {
      for (const o of sc.objects.values()) boxes.push(sc.objectBox(o.id));
      for (const l of this.labelNodes.values()) if (l.box) boxes.push(l.box);
      for (const l of sc.links.values()) { const g = this.linkGeo(l); if (g.box) boxes.push(g.box); }
    } else {
      for (const r of sc.focus) { try { boxes.push(...(sc.objects.has(r) ? [sc.objectBox(r)] : sc.cells(r).map((x) => sc.cellBox(x)))); } catch { /* 没了 */ } }
      if (sc.focus.some((r) => sc.objects.has(r))) for (const l of this.labelNodes.values()) if (l.box) boxes.push(l.box);
    }
    const b = bbox(boxes);
    return b ? grow(b, 12) : null;
  }
  async camera(box, animate = true) {
    if (!box) return;
    const { top, bottom } = this.reserve();
    const next = fitCamera(box, this.viewSize(), { top, bottom, pad: 28, maxScale: 1.5, lift: 0.4 });
    const from = `translate(${this.cam.tx}px, ${this.cam.ty}px) scale(${this.cam.s})`;
    const to = `translate(${next.tx}px, ${next.ty}px) scale(${next.s})`;
    this.cam = next;
    this.placeCaption(box, animate);
    if (!animate || this.instant) { this.world.style.transform = to; return; }
    await this.tween(this.world, [{ transform: from }, { transform: to }], { duration: 760, easing: EASE.move });
  }
  refocus(animate = true) { return this.camera(this.focusBox(), animate); }
  // 新东西跑出镜头了（新贴的字、长高的弧），镜头挪一挪；不用挪也让话让开
  async keepInView() {
    const box = this.focusBox();
    if (!box) return;
    if (this.scene.focus && !this.scene.focus.some((r) => this.scene.objects.has(r))) { this.placeCaption(box, true); return; }
    const { top, bottom } = this.reserve();
    const next = fitCamera(box, this.viewSize(), { top, bottom, pad: 28, maxScale: 1.5, lift: 0.4 });
    if (Math.abs(next.s - this.cam.s) / this.cam.s > 0.03 || Math.abs(next.tx - this.cam.tx) > 14 || Math.abs(next.ty - this.cam.ty) > 14) await this.camera(box, true);
    else this.placeCaption(box, true);
  }
  // 说的话的下沿贴着镜头里那块东西的上方，镜头挪了它跟着挪
  placeCaption(box, animate) {
    if (!box) return;
    const { h } = this.viewSize();
    const topScreen = box.y * this.cam.s + this.cam.ty;
    this.caption.style.transition = animate && !this.reduced && !this.instant ? `bottom ${this.dur(760)}ms ${EASE.move}` : 'none';
    this.caption.style.bottom = `${Math.max(0, Math.round(h - topScreen + 22))}px`;
  }
  toScreen(p) { return { x: p.x * this.cam.s + this.cam.tx, y: p.y * this.cam.s + this.cam.ty }; }

  // —— 等学生：点、拖、点按钮、打字；等待期间拨数是「试」，攒着跟回答一起说 ——
  waitAct() {
    const w = this.scene.waiting;
    if (!w) return Promise.resolve(null);
    return new Promise((resolve) => {
      const offs = [];
      let over = false;
      const finish = async (act) => {
        if (over) return;
        over = true;
        offs.forEach((f) => f());
        this.dock.replaceChildren();
        this.cancelWait = null;
        this.scene.waiting = null;
        await this.studentChain;
        const tries = this.pending.splice(0);
        resolve({ ...act, tries });
      };
      this.cancelWait = () => finish({ type: 'cancel' });
      const sc = this.scene;
      const cellsOf = (refs) => (refs.length ? refs.flatMap((r) => sc.cells(r)) : [...sc.objects.values()].flatMap((o) => o.cells));
      if (w.kind === 'tap') {
        for (const x of cellsOf(w.refs)) offs.push(this.armTap(x, () => {
          const act = { type: 'tap', ref: `${x.obj}.${x.slot}`, key: x.key, slot: x.slot, value: x.value };
          if (w.expect) { const [e] = sc.cells(w.expect); act.expected = w.expect; act.right = e === x; }
          this.onAct?.(act);
          finish(act);
        }));
      }
      if (w.kind === 'drag') {
        const peers = cellsOf(w.refs);
        for (const x of peers) offs.push(this.armDrag(x, peers, async (a, b) => {
          const act = { type: 'drag', a: { key: a.key, value: a.value, slot: a.slot }, b: { key: b.key, value: b.value, slot: b.slot } };
          await this.studentDo(`swap ${a.obj}#${a.key} ${b.obj}#${b.key}`, act);
          finish(act);
        }));
      }
      if (w.kind === 'next' || w.button) {
        const b = el('button', 'st-next', this.dock);
        b.type = 'button';
        b.textContent = `${w.button || '接着'} →`;
        this.tween(b, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 360, easing: EASE.out });
        b.addEventListener('click', () => { const act = { type: 'next', button: w.button || '接着' }; this.onAct?.(act); finish(act); }, { once: true });
      }
      // 打字：一直在（学生可以不点格子，直接说「我不懂」）；ask say 时把它放到最前面
      if (this.withInput) {
        const form = el('form', 'st-say', this.dock);
        const input = el('input', '', form);
        input.type = 'text';
        input.id = 'st-say-input';
        input.placeholder = w.kind === 'say' ? '写下你的想法…' : '想说点什么也可以直接写';
        input.setAttribute('aria-label', '对老师说');
        input.enterKeyHint = 'send';
        const go = el('button', 'st-say-go', form);
        go.type = 'submit';
        go.textContent = '说';
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          const act = { type: 'say', text };
          this.onAct?.(act);
          finish(act);
        });
        if (w.kind === 'say') form.classList.add('is-main');
      }
      this.keepInView();
    });
  }

  armTap(x, done) {
    const n = this.cells.get(ckey(x));
    if (!n) return () => {};
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

  // 按住一格左右拖，放到同一排的另一格上就换过去
  armDrag(x, peers, done) {
    const n = this.cells.get(ckey(x));
    if (!n) return () => {};
    n.classList.add('is-drag');
    let start = null, base = null;
    const target = (px) => {
      let best = null, bd = Infinity;
      for (const p of peers) {
        if (p === x || p.row !== x.row || p.obj !== x.obj) continue;
        const d = Math.abs(this.scene.cellBox(p).x - px);
        if (d < bd) { bd = d; best = p; }
      }
      return bd < CELL * 0.75 ? best : null;
    };
    const down = (e) => { e.preventDefault(); n.setPointerCapture?.(e.pointerId); start = { x: e.clientX, y: e.clientY }; base = this.scene.cellBox(x); n.classList.add('is-hold'); };
    const move = (e) => {
      if (!start) return;
      const dx = (e.clientX - start.x) / this.cam.s, dy = (e.clientY - start.y) / this.cam.s;
      n.style.transform = `${tr(base.x + dx, base.y + dy * 0.35)} scale(1.08)`;
      const t = target(base.x + dx);
      peers.forEach((p) => this.cells.get(ckey(p))?.classList.toggle('is-over', p === t));
    };
    const up = (e) => {
      if (!start) return;
      const dx = (e.clientX - start.x) / this.cam.s;
      start = null;
      n.classList.remove('is-hold');
      peers.forEach((p) => this.cells.get(ckey(p))?.classList.remove('is-over'));
      const t = target(base.x + dx);
      if (t) { done(x, t); return; }
      this.tween(n, [{ transform: n.style.transform }, { transform: tr(base.x, base.y) }], { duration: 360, easing: EASE.spring });
    };
    n.addEventListener('pointerdown', down);
    n.addEventListener('pointermove', move);
    n.addEventListener('pointerup', up);
    n.addEventListener('pointercancel', up);
    return () => { n.classList.remove('is-drag', 'is-hold'); n.removeEventListener('pointerdown', down); n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up); n.removeEventListener('pointercancel', up); };
  }
}

/** 学生这一下做了什么，写给老师看（和舞台现状一起发） */
export function actText(act, scene) {
  if (!act) return '';
  const tries = (act.tries || []).filter((t) => t.type === 'dial').map((t) => `学生拨了 ${t.name}：${t.path.join(' → ')}（停在 ${t.path.at(-1)}）`);
  const main = (() => {
    if (act.type === 'tap') return `学生点了 ${act.ref}（${act.value}${act.key !== act.slot ? `，#${act.key}` : ''}）${act.expected ? `——你预期的是 ${act.expected}，${act.right ? '点对了' : '点的不是它'}` : ''}`;
    if (act.type === 'drag') return `学生把 ${act.a.value}（#${act.a.key}）拖到 ${act.b.value}（#${act.b.key}）那一格，两格换了位置（舞台已经照做了）`;
    if (act.type === 'next') return `学生点了「${act.button}」`;
    if (act.type === 'say') return `学生说：「${act.text}」`;
    if (act.type === 'cancel') return '';
    return '';
  })();
  void scene;
  return [...tries, main].filter(Boolean).join('\n');
}

export { compareValues };
