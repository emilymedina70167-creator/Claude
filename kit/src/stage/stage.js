// 舞台的画面（docs/stage-plan.md）：照着场景（scene.js）演。一整块屏幕是一个场景，东西不往上滚；镜头移到讲的地方；
// 老师一行一个动作，这里一个一个演（能边写边演：写完一行演一行）；学生在场景里点、拖、拨、打字，就是回答。
//
// 每一行：先在场景上 check（写错了挡下、记进 errors，别的行照演）→ 场景 apply → 有专门动作的演专门的动作
// （每种东西自己的在 types/xxx.view.js 的 choreo，共用的说话、比较、飞字在这里）→ sync 把画面对齐到场景
// （每种东西的 view.sync 造 / 改自己的节点，挪动、连线、贴字、拨数这里统一演）。
// 演过的每一行记进 log（学生拖、拨造成的变化也记成一行），刷新或作废一轮时照 log 瞬间重放（replay）。
import { EASE, moveDuration, stagger, arcPoints, revealDelays, readHold, labelHold } from './motion.js';
import { bbox, grow, fitCamera, placeLabel, overlaps, linkGeom } from './layout.js';
import { parseScript, parseRich, richLength } from './script.js';
import { Scene, compareValues, COLOR_NAMES, pidOf } from './scene.js';
import { VIEWS } from './types/views.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const svg = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const CAPTION_MAX = 3; // 话最多留几句在画面上（这一轮说过的，旧的淡一点）

/**
 * 一段讲完怎么往下走（这台设备记着）：tap 停下来等学生点「接着」（默认）、auto 停一会儿自己往下。
 * 2026-11-06 第一节真课：一轮三句话、两张矩阵、一格一格算乘积、两张贴的字一口气演完，学生说像放视频，来不及看就过了
 */
export const PACES = { tap: '一段一停', auto: '自动往下' };
const PACE_KEY = 'la-stage-pace';
export function storedPace() {
  try { const v = localStorage.getItem(PACE_KEY); return PACES[v] ? v : 'tap'; } catch { return 'tap'; }
}
/** 一句写成一行指令里的字：引号挑字里没有的那一种 */
export function quoteText(t) {
  const s = String(t ?? '');
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes('」')) return `「${s}」`;
  return `"${s.replace(/"/g, '”')}"`;
}

export { COLOR_NAMES };

export class Stage {
  constructor(host, { onAct = null, onLine = null, speed = 1, input = true, pace = null } = {}) {
    this.host = host;
    this.onAct = onAct;
    this.onLine = onLine; // 每演完老师的一行（量「第一个镜头多久出来」、收起「老师在想」）
    this.speed = speed;
    this.pace = PACES[pace] ? pace : storedPace();
    this.withInput = input;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.instant = false; // 重放时：不演动画、不等学生
    this.scene = new Scene();
    this.log = []; // 演过的每一行 { src, by: 'teacher' | 'student' | 'page', turn }
    this.errors = []; // 这一轮没演的行 { line, src, error }
    this.turnNo = 0;
    this.nodes = new Map(); // 部件 'a:3' → 节点
    this.decors = new Map(); // 东西 id → Map(名字 → 节点)（虚框、序号、指针、树的边……）
    this.paths = new Map(); // 连线 key → path
    this.labelNodes = new Map(); // id → { node, box, sig, anchor }
    this.cam = { s: 1, tx: 0, ty: 0 };
    this.pending = []; // 学生在等待期间的试（拨数），跟着下一次回答一起告诉老师
    this.build();
  }

  build() {
    const root = el('div', 'st-stage', this.host);
    this.root = root;
    this.view = el('div', 'st-view', root);
    this.world = el('div', 'st-world', this.view);
    this.under = svg('svg', { class: 'st-ink st-under', width: 1, height: 1 }, this.world); // 东西自己的线（树的边、坐标轴）：在格子下面
    this.layer = el('div', 'st-layer', this.world);
    this.ink = svg('svg', { class: 'st-ink', width: 1, height: 1 }, this.world); // 连线：在最上面
    this.caption = el('div', 'st-caption', this.view);
    this.caption.setAttribute('aria-live', 'polite');
    this.dock = el('div', 'st-dock', this.view);
    this.flyLayer = el('div', 'st-fly', this.view);
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestAnimationFrame(() => this.refocus(false))) : null;
    this.ro?.observe(this.view);
  }
  destroy() { this.ro?.disconnect(); this.root.remove(); this.cancelWait?.(); this.cancelBeat?.(); }
  setPace(p) {
    if (!PACES[p]) return;
    this.pace = p;
    try { localStorage.setItem(PACE_KEY, p); } catch { /* 没有存储：这一次照样用 */ }
    if (p === 'auto') this.cancelBeat?.(); // 正停着等学生：换成自动就接着往下
  }

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

  // —— 部件的节点（每种东西的 view 用）——
  pid(p) { return pidOf(p); }
  nodeOf(p) { return this.nodes.get(pidOf(p)); }
  partNode(p, create) {
    const k = pidOf(p);
    let n = this.nodes.get(k);
    if (!n) { n = create(); n.__pid = k; n.__obj = p.obj; this.nodes.set(k, n); }
    n.__live = this.syncMark;
    return n;
  }
  decor(objId, key, create) {
    let m = this.decors.get(objId);
    if (!m) { m = new Map(); this.decors.set(objId, m); }
    let n = m.get(key);
    if (!n && create) { n = create(); m.set(key, n); }
    return n;
  }
  dropDecor(objId, test = () => true) {
    const m = this.decors.get(objId);
    if (!m) return;
    for (const [k, n] of m) if (test(k)) { m.delete(k); this.tween(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => n.remove()); }
  }
  /** 拿掉一个部件的节点：从它现在的透明度淡掉（已经缩没、淡没的直接删，不会闪回来） */
  dropNode(pid) {
    const n = this.nodes.get(pid);
    if (!n) return;
    this.nodes.delete(pid);
    const op = Number(getComputedStyle(n).opacity);
    if (this.instant || !(op > 0.02)) { n.remove(); return; }
    this.tween(n, [{ opacity: op }, { opacity: 0 }], { duration: 220 }).then(() => n.remove());
  }
  // 共用的几种样子：染色、点亮、抬起、灰掉、扣过去（像翻一张牌）
  flagPart(n, x, ctx) {
    const was = n.dataset.paint || null;
    if (x.paint) n.dataset.paint = x.paint; else delete n.dataset.paint;
    n.classList.toggle('is-glow', !!x.glow);
    n.classList.toggle('is-lift', !!x.lift);
    n.classList.toggle('is-dim', !!x.dim);
    if (was !== (x.paint || null) && !this.instant && ctx?.cmd === 'paint') ctx.jobs.push(this.pulse(x, stagger(ctx.jobs.length, { step: 50 })));
    if (!!n.__covered !== !!x.covered) {
      n.__covered = !!x.covered;
      if (this.instant || !n.__box || n.tagName === 'g' || n instanceof SVGElement) n.classList.toggle('is-covered', !!x.covered);
      else {
        const t = tr(n.__box.x, n.__box.y);
        ctx?.jobs.push((async () => {
          await this.tween(n, [{ transform: `${t} rotateY(0deg)` }, { transform: `${t} rotateY(90deg)` }], { duration: 180, delay: stagger(ctx.jobs.length, { step: 60 }), easing: EASE.in });
          // 换面按场景现在的样子（同一格可能同时被扣上又翻开：& 并着演的两行）
          n.classList.toggle('is-covered', !!x.covered);
          await this.tween(n, [{ transform: `${t} rotateY(-90deg)` }, { transform: t }], { duration: 220, easing: EASE.out });
        })());
      }
    }
    // 话里、字里指着它的小块跟着变色、变值
    this.root.querySelectorAll(`.st-chip[data-cell="${CSS.escape(pidOf(x))}"]`).forEach((ch) => { if (x.paint) ch.dataset.paint = x.paint; else delete ch.dataset.paint; const t = this.chipText(x); if (ch.textContent !== t) ch.textContent = t; });
  }
  chipText(p) { return String(p.label ?? p.value ?? p.key); }

  // —— 演一段（整段写好的） ——
  async play(src, { by = 'teacher', auto = false } = {}) {
    const t = this.begin({ by, auto });
    return t.end(src);
  }

  /**
   * 开一轮：老师边写边演。push(到现在为止写出来的全部文字) 每写完一行就演一行；end() 等这一轮演完、等到学生回答。
   * 返回 { push, end, abort }；end() 的结果是 { act, errors, lines }
   */
  begin({ by = 'teacher', auto = true } = {}) {
    const turn = ++this.turnNo;
    const mark = this.log.length;
    this.errors = [];
    let taken = 0;
    let chain = Promise.resolve();
    let running = null;
    let asked = null;
    let lines = 0;
    let dead = false; // 这一轮作废了（不是指定的模型）：后面的行不演
    let said = false; // 这一轮已经开口说过：再有一句 say 就是新的一段，开演之前停下来
    let beat = null; // 正在演的这一段 { start: 开演时 log 多长, cmds }：「再看一遍」照它倒回去重演
    let armedResolve;
    const armed = new Promise((r) => { armedResolve = r; }); // 这一轮演完、在等学生了（或者作废了）
    const run = (c) => {
      const rec = { c, ok: true };
      if (by === 'teacher') (beat ||= { start: this.log.length, cmds: [] }).cmds.push(rec);
      return this.exec(c, { by, turn }).then((r) => { if (r === null) rec.ok = false; return r; });
    };
    const enqueue = (c) => {
      if (dead) return;
      if (asked) { this.errors.push({ line: c.line, src: c.src?.trim(), error: 'ask 之后的行不演（一轮以 ask 结尾）' }); return; }
      if (c.cmd === 'ask') asked = c;
      lines++;
      if (c.par && running) { running.jobs.push(run(c)); return; }
      const pause = by === 'teacher' && c.cmd === 'say' && said;
      if (c.cmd === 'say') said = true;
      const batch = { jobs: [] };
      chain = chain.then(async () => {
        if (dead) return;
        if (pause) {
          await this.beat(beat, { by, turn, alive: () => !dead });
          beat = null;
          if (dead) return;
        }
        running = batch;
        batch.jobs.push(run(c));
        // & 开头的行可能在这一批开演以后才写出来：等到这一批的活都演完（期间新并进来的也等）
        for (let k = 0; k < batch.jobs.length; k++) await batch.jobs[k];
        running = null;
      });
    };
    const feed = (text, final) => {
      const all = stageLines(text);
      const done = final ? all : all.slice(0, -1);
      const fresh = done.slice(taken);
      taken = done.length;
      if (!fresh.length) return;
      const cmds = parseScript(fresh.map((l) => (l == null || !l.trim() ? '#' : l)).join('\n'));
      const base = taken - fresh.length;
      for (const c of cmds) enqueue({ ...c, line: c.line + base, src: c.src ?? fresh[c.line - 1] });
    };
    let last = '';
    const end = async (text) => {
      if (dead) return { act: null, errors: [], lines, mark, dead: true };
      feed(text != null ? text : last, true);
      await chain;
      let act = null;
      if (!this.instant && !dead && (asked || auto)) {
        if (!this.scene.waiting) {
          // 一轮没有 ask，或者 ask 那一行写错了没演上：页面替它等，不让课停在半空。
          // 写错的那一问照样把问题留在画面上，学生用话答（第一节真课 `ask tap q#2 q#3 "哪一句说得对？"` 写错了，问题没了、也没有按钮，课就停住了）
          const q = asked ? (asked.args || []).find((a) => a.t === 'str')?.v : '';
          const src = q ? `ask say ${quoteText(q)}` : 'ask next';
          const [c] = parseScript(src);
          await this.exec({ ...c, line: 0, src }, { by: 'page', turn });
        }
        armedResolve();
        act = await this.waitAct();
      }
      armedResolve();
      return { act, errors: [...this.errors], lines, mark };
    };
    const abort = async () => { dead = true; this.cancelBeat?.(); await chain.catch(() => {}); armedResolve(); await this.rollback(mark); };
    return { push: (text) => { if (!dead) { last = text; feed(text, false); } }, end, abort, turn, mark, armed };
  }

  /**
   * 一段演完、下一段开演之前：停下来等学生点「接着」（点舞台上空的地方也行），「再看一遍」把这一段倒回去重演。
   * 自动往下时停一会儿就走。话一轮里一直留着，所以学生停多久都看得到刚才说了什么
   */
  async beat(prev, { by, turn, alive }) {
    if (this.instant) return;
    if (this.pace === 'auto') { await this.wait(1400); return; }
    for (;;) {
      const choice = await new Promise((resolve) => {
        const bar = el('div', 'st-beat', this.dock);
        const again = prev?.cmds.some((x) => x.ok) ? el('button', 'st-beat-again', bar) : null;
        if (again) { again.type = 'button'; again.textContent = '↺ 再看一遍'; }
        const go = el('button', 'st-next st-beat-go', bar);
        go.type = 'button';
        go.textContent = '接着 ›';
        this.tween(bar, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 300, easing: EASE.out });
        let over = false;
        const onView = (e) => { if (!e.target.closest?.('.st-dock, button, input, .st-chip, .st-word')) done('go'); };
        const done = (k) => {
          if (over) return;
          over = true;
          this.view.removeEventListener('pointerup', onView);
          bar.remove();
          this.cancelBeat = null;
          resolve(k);
        };
        go.addEventListener('click', () => done('go'));
        again?.addEventListener('click', () => done('again'));
        this.view.addEventListener('pointerup', onView);
        this.cancelBeat = () => done('go');
        this.keepInView();
      });
      if (choice !== 'again' || !alive()) return;
      await this.rewatch(prev, { by, turn });
      if (!alive()) return;
    }
  }
  /** 把刚演完的一段倒回去再演一遍：先瞬间退回这一段开演之前，再照原来的先后（& 的照样一起）演 */
  async rewatch(beat, { by, turn }) {
    await this.replay(this.log.slice(0, beat.start));
    let jobs = [];
    for (const { c, ok } of beat.cmds) {
      if (!ok) continue;
      if (c.par && jobs.length) { jobs.push(this.exec(c, { by, turn })); continue; }
      await Promise.all(jobs);
      jobs = [this.exec(c, { by, turn })];
    }
    await Promise.all(jobs);
  }

  /** 作废这一轮：照 log 退回这一轮开始之前的样子 */
  async rollback(mark) {
    this.cancelWait?.();
    this.cancelBeat?.();
    await this.replay(this.log.slice(0, mark));
  }

  /** 照记录瞬间重放（刷新后放回、作废一轮后退回）：画面直接到最后的样子，不演动画、不等学生 */
  async replay(log) {
    this.instant = true;
    this.clearAll();
    this.log = [];
    // ask 不重放（不等学生），可它问的那句话是画面的一部分：最后一句是 ask 问的，就照样写在上面（只读回看、刷新以后看得到问了什么）
    let asked = null;
    for (const row of log) {
      for (const c of parseScript(row.src)) {
        if (c.cmd === 'ask') {
          try { const s = this.scene.clone(); s.apply(c); asked = s.waiting?.prompt || asked; } catch { /* 这一行当时就没演 */ }
          continue;
        }
        if (c.cmd === 'say') asked = null;
        await this.exec(c, { by: row.by, turn: row.turn });
      }
    }
    if (asked) await this.say(asked, { ask: true });
    this.instant = false;
    this.scene.waiting = null;
    await this.sync();
    await this.refocus(false);
  }
  clearAll() {
    this.scene = new Scene();
    this.nodes.forEach((n) => n.remove()); this.nodes.clear();
    this.decors.forEach((m) => m.forEach((n) => n.remove())); this.decors.clear();
    this.paths.forEach((p) => p.remove()); this.paths.clear();
    this.labelNodes.forEach((l) => l.node.remove()); this.labelNodes.clear();
    this.caption.replaceChildren();
    this.captionTurn = null;
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
    this.execTurn = turn;
    this.log.push({ src: c.src?.trim() || '', by, turn });
    if (by === 'teacher' && !this.instant) this.onLine?.(c);
    try {
      const choreo = this.choreoOf(c, fx);
      if (choreo) await choreo(c, fx, pre);
      await this.sync({ pre, cmd: c.cmd, fx });
      if (!this.instant && c.cmd !== 'camera') this.keepInView();
      // 贴上去的字：读一下再演下一行（第一节真课两张接连冒出来，一张 0.4 秒就过去了）
      if (!this.instant && (c.cmd === 'label' || c.cmd === 'retext')) {
        const str = (c.args || []).find((a) => a.t === 'str')?.v || '';
        await this.wait(labelHold(richLength(parseRich(str))));
      }
    } catch (e) {
      // 画面出错不能把课卡住：记下来，画面照场景重画一遍
      this.errors.push({ line: c.line, src: c.src?.trim(), error: `画面没演好：${e.message}` });
      await this.sync({ pre });
    }
    return fx;
  }
  // 这一行的专门动作：刚造出来的东西出场；那种东西自己的（swap、insert……）；共用的（说话、比较、飞字……）
  choreoOf(c, fx) {
    if (fx?.created) {
      const o = this.scene.objects.get(fx.id);
      return async () => {
        await this.sync({ entering: fx.id });
        await this.refocus(false);
        await VIEWS[o.type]?.enter?.(this, o);
      };
    }
    const target = this.targetOf(c);
    const own = target && VIEWS[target.type]?.choreo?.[c.cmd];
    if (own) return (cc, f, pre) => own(this, cc, f, pre);
    const mine = this[`do_${c.cmd}`];
    return mine ? (cc, f, pre) => mine.call(this, cc, f, pre) : null;
  }
  targetOf(c) {
    for (const a of c.args || []) if (a.t === 'word') { const r = this.scene.isRef(a.v) && a.v.match(/^[A-Za-z_]\w*/)[0]; if (r) return this.scene.objects.get(r); }
    return null;
  }

  // 演之前每一个部件在哪（专门的动作从这里出发）
  capture() {
    const boxes = new Map();
    for (const [k, n] of this.nodes) if (n.__box) boxes.set(k, { ...n.__box });
    return { boxes, say: this.scene.say };
  }

  // —— 共用的专门动作 ——
  async do_say() { await this.say(this.scene.say); }
  async do_pulse(c, fx) { await Promise.all(fx.parts.map((x, i) => this.pulse(x, stagger(i, { step: 60 })))); }
  async do_camera() { await this.refocus(true); }
  async do_wait(c, fx) { await this.wait(fx.ms); }
  async do_ask() { const w = this.scene.waiting; if (w?.prompt) await this.say(w.prompt, { ask: true }); }

  // 比较：两个亮一下，中间冒出「65 > 49′」，停一会儿再收起
  async do_compare(c, fx) {
    const { a, b, sign } = fx;
    const A = this.scene.partBox(a), B = this.scene.partBox(b);
    const badge = el('div', 'st-compare', this.layer);
    badge.innerHTML = '<span></span><b></b><span></span>';
    badge.children[0].textContent = this.chipText(a);
    badge.children[1].textContent = sign < 0 ? '<' : sign > 0 ? '>' : '=';
    badge.children[2].textContent = this.chipText(b);
    const w = badge.offsetWidth || 90, h = badge.offsetHeight || 34;
    const x = (A.x + A.w / 2 + B.x + B.w / 2) / 2 - w / 2, y = Math.min(A.y, B.y) - h - 16;
    await Promise.all([this.pulse(a), this.pulse(b), this.tween(badge, [{ opacity: 0, transform: tr(x, y + 10) }, { opacity: 1, transform: tr(x, y) }], { duration: 320, easing: EASE.out })]);
    await this.wait(1100);
    await this.tween(badge, [{ opacity: 1, transform: tr(x, y) }, { opacity: 0, transform: tr(x, y - 8) }], { duration: 240, easing: EASE.in });
    badge.remove();
  }

  // 话里的 [词] 飞到图上：sync 先把落点算好（字先藏着），这里从那个词的位置飞过去
  async do_fly(c, fx) {
    const word = [...this.caption.querySelectorAll('.st-line:not(.is-out)[data-kind="say"]')].at(-1)?.querySelectorAll('.st-word')[fx.word];
    await this.sync({ hide: [fx.id] });
    const l = this.labelNodes.get(fx.id);
    if (!l || !word || this.instant) { if (l) l.node.style.opacity = ''; return; }
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
    l.node.style.opacity = '';
    await this.tween(l.node, [{ transform: tr(l.box.x, l.box.y, 1.12) }, { transform: tr(l.box.x, l.box.y) }], { duration: 380, easing: EASE.spring });
  }

  // —— 把画面对齐到场景：每种东西造 / 改自己的节点；挪了的滑过去、没了的淡掉；连线、贴字、拨数 ——
  async sync({ pre = null, only = null, entering = null, hide = [], cmd = null, fx = null } = {}) {
    const sc = this.scene;
    const jobs = [];
    this.syncMark = (this.syncMark || 0) + 1;
    const ctx = { pre, only, entering, cmd, fx, jobs };
    const moves = [];
    for (const o of sc.objects.values()) moves.push(...(VIEWS[o.type]?.sync(this, o, ctx) || []));
    // 没了的部件、没了的东西
    for (const [k, n] of this.nodes) if (n.__live !== this.syncMark && !only) this.dropNode(k);
    for (const id of [...this.decors.keys()]) if (!sc.objects.has(id)) { this.dropDecor(id); this.decors.delete(id); }
    // 挪了的：连线先藏、挪完再画；按各自给的先后错开
    if (moves.length) {
      await this.hideLinks(moves.map((m) => m.part));
      await Promise.all(moves.map((m) => this.moveNode(m.part, [{ transform: tr(m.from.x, m.from.y) }, { transform: tr(m.to.x, m.to.y) }], m.to, { duration: m.duration || moveDuration(Math.abs(m.from.x - m.to.x) + Math.abs(m.from.y - m.to.y)), delay: stagger(m.order ?? 0, { step: 70, max: 500 }) })));
    }
    // 连线
    const linkJobs = [];
    let drawn = 0;
    for (const l of sc.links.values()) {
      const geo = this.linkGeo(l);
      let p = this.paths.get(l.key);
      if (!p) {
        p = svg('path', { class: 'st-link' }, this.under); // 在格子下面：弧从格子顶上出发，横线藏在格子后面
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
    await Promise.all(jobs);
    await Promise.all(linkJobs);
    await this.syncLabels(hide);
  }

  linkGeo(l) {
    const sc = this.scene;
    const a = sc.partOf(l.a.obj, l.a.key), b = sc.partOf(l.b.obj, l.b.key);
    if (!a || !b) return { d: '', box: null, rail: false };
    const rail = !!(VIEWS[sc.objects.get(a.obj).type]?.rail?.(sc.objects.get(a.obj), a) || VIEWS[sc.objects.get(b.obj).type]?.rail?.(sc.objects.get(b.obj), b));
    return linkGeom(sc.partBox(a), sc.partBox(b), { tier: l.tier || 0, rail });
  }

  // 部件挪了：连着它的线先淡掉（挪完 sync 照新位置画，再淡进来）
  hideLinks(parts) {
    const keys = new Set(parts.map(pidOf));
    const jobs = [];
    for (const l of this.scene.links.values()) {
      if (!keys.has(`${l.a.obj}:${l.a.key}`) && !keys.has(`${l.b.obj}:${l.b.key}`)) continue;
      const p = this.paths.get(l.key);
      if (!p || p.__hidden) continue;
      p.__hidden = true;
      jobs.push(this.tween(p, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 }));
    }
    return Promise.all(jobs);
  }

  moveNode(x, frames, to, { duration = 520, delay = 0, easing = EASE.move } = {}) {
    const n = this.nodeOf(x);
    if (!n) return Promise.resolve();
    n.__box = { ...to };
    n.classList.add('is-moving');
    return this.tween(n, frames, { duration, delay, easing }).then(() => n.classList.remove('is-moving'));
  }
  // 旧名字
  moveCell(x, frames, to, opts) { return this.moveNode(x, frames, to, opts); }

  async pulse(x, delay = 0) {
    const n = this.nodeOf(x);
    if (!n?.__box || n instanceof SVGElement) return;
    const t = tr(n.__box.x, n.__box.y);
    await this.tween(n, [{ transform: t }, { transform: `${t} scale(1.1)` }, { transform: t }], { duration: 420, delay, easing: EASE.out });
  }

  // —— 贴着的字和拨数：新的淡进来、字变了的换字、锚挪了的跟过去、没了的淡掉 ——
  obstacles(exceptId) {
    const sc = this.scene;
    const out = [...sc.obstacles()];
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
      try { boxes.push(...(sc.objects.has(r) ? [sc.objectBox(r)] : sc.parts(r).map((x) => sc.partBox(x)))); } catch { /* 锚没了 */ }
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

  // 话、字里的写法画出来：{a.2} 是同色同数的小块，{d} 是拨的数，$d$ 是字母，[词] 能飞走
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
      const [x] = this.scene.parts(ref);
      chip.textContent = this.chipText(x);
      chip.dataset.cell = pidOf(x);
      if (x.paint) chip.dataset.paint = x.paint;
      chip.addEventListener('click', () => { const [obj, ...k] = String(chip.dataset.cell || '').split(':'); const key = k.join(':'); const p = this.scene.partOf(obj, /^\d+$/.test(key) ? Number(key) : key) || this.scene.partOf(obj, key); if (p) this.pulse(p); });
    } catch { chip.textContent = ref; chip.classList.add('is-bad'); }
    return chip;
  }

  // —— 说的话：一个字一个字写出来 ——
  // 一轮里说过的话留在画面上（旧的淡一点、小一点，最多 CAPTION_MAX 句），老师新一轮开口时才收起；
  // 第一版每句话都把上一句擦掉，等学生的时候只剩问题，前面讲了什么全没了
  async say(text, { ask = false } = {}) {
    let live = [...this.caption.querySelectorAll('.st-line:not(.is-out)')];
    const out = (n) => {
      n.classList.add('is-out');
      this.tween(n, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-14px)' }], { duration: 260, easing: EASE.in }).then(() => n.remove());
    };
    if (!text) { live.forEach(out); return; }
    if (ask && live.at(-1)?.__text === text) return; // 刷新以后重新等最后一问：这句已经在上面了
    if (!ask && this.captionTurn !== this.execTurn) { live.forEach(out); live = []; }
    this.captionTurn = this.execTurn;
    live.forEach((n) => n.classList.add('is-past'));
    live.slice(0, Math.max(0, live.length - (CAPTION_MAX - 1))).forEach(out);
    const line = el('p', 'st-line', this.caption);
    line.__text = text;
    line.dataset.kind = ask ? 'ask' : 'say';
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
    const node = el('div', 'st-dial', this.layer);
    const dec = el('button', 'st-dial-b', node); dec.type = 'button'; dec.textContent = '‹'; dec.setAttribute('aria-label', `${name} 小一点`);
    const lab = el('span', 'st-dial-v', node);
    const inc = el('button', 'st-dial-b', node); inc.type = 'button'; inc.textContent = '›'; inc.setAttribute('aria-label', `${name} 大一点`);
    const paint = () => { const v = this.scene.vars.get(name); if (!v) return; lab.innerHTML = '<i class="st-math"></i> = <b></b>'; lab.firstChild.textContent = name; lab.lastChild.textContent = String(v.v); dec.disabled = v.v <= v.lo; inc.disabled = v.v >= v.hi; };
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
    return node;
  }

  // 学生的动作改了舞台（拨数、拖过去换位置、拖动平面上的向量）：照一行指令走场景（记进 log，刷新、作废都照它放回）
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
    const ch = Math.max(84, (this.caption.offsetHeight || 0) + 34);
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
      for (const r of sc.focus) { try { boxes.push(...(sc.objects.has(r) ? [sc.objectBox(r)] : sc.parts(r).map((x) => sc.partBox(x)))); } catch { /* 没了 */ } }
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
    // 上一次镜头还在走：停在它现在的位置，从那里接着走（不然它走完会把旧镜头写回去，cam 和画面对不上）
    const cur = this.world.getAnimations?.() || [];
    const live = cur.length ? getComputedStyle(this.world).transform : null;
    cur.forEach((a) => a.cancel());
    if (!animate || this.instant) { this.world.style.transform = to; return; }
    await this.tween(this.world, [{ transform: live && live !== 'none' ? live : from }, { transform: to }], { duration: 760, easing: EASE.move });
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
  /** 屏幕上的一点 → 世界坐标（平面上拖向量用） */
  toWorld(clientX, clientY) {
    const r = this.view.getBoundingClientRect();
    return { x: (clientX - r.left - this.cam.tx) / this.cam.s, y: (clientY - r.top - this.cam.ty) / this.cam.s };
  }

  // —— 等学生：点、拖、点按钮、打字、填一个答案；等待期间拨数是「试」，攒着跟回答一起说 ——
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
      const partsOf = (refs) => (refs.length ? refs.flatMap((r) => sc.parts(r)) : sc.allParts());
      if (w.kind === 'tap') {
        for (const x of partsOf(w.refs)) offs.push(this.armTap(x, () => {
          const act = { type: 'tap', ref: sc.refOf(x), pid: pidOf(x), key: x.key, slot: x.slot, value: this.chipText(x) };
          if (x.slot != null) act.ref = `${x.obj}.${x.slot}`;
          if (w.expect) { const [e] = sc.parts(w.expect); act.expected = w.expect; act.right = e === x; }
          this.onAct?.(act);
          finish(act);
        }));
      }
      if (w.kind === 'drag') {
        const peers = partsOf(w.refs);
        for (const x of peers) {
          const v = VIEWS[sc.objects.get(x.obj).type];
          if (v?.drag) offs.push(v.drag(this, x, peers, async (act, src) => { if (src) await this.studentDo(src, act); else this.onAct?.(act); finish(act); }));
        }
      }
      if (w.kind === 'next' || w.button) {
        const b = el('button', 'st-next', this.dock);
        b.type = 'button';
        b.textContent = `${w.button || '接着'} →`;
        this.tween(b, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 360, easing: EASE.out });
        b.addEventListener('click', () => { const act = { type: 'next', button: w.button || '接着' }; this.onAct?.(act); finish(act); }, { once: true });
      }
      // 打字：一直在（学生可以不点格子，直接说「我不懂」）；ask say / ask value 时把它放到最前面
      if (this.withInput || w.kind === 'value' || w.kind === 'say') {
        const form = el('form', 'st-say', this.dock);
        const input = el('input', '', form);
        input.type = 'text';
        input.id = 'st-say-input';
        input.placeholder = w.kind === 'value' ? '写答案' : w.kind === 'say' ? '写下你的想法…' : '想说点什么也可以直接写';
        input.setAttribute('aria-label', w.kind === 'value' ? '答案' : '对老师说');
        input.enterKeyHint = 'send';
        if (w.kind === 'value') input.inputMode = 'decimal';
        const go = el('button', 'st-say-go', form);
        go.type = 'submit';
        go.textContent = w.kind === 'value' ? '对吗' : '说';
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          let act = { type: 'say', text };
          if (w.kind === 'value') {
            const right = sameAnswer(text, w.answer);
            act = { type: 'value', text, answer: w.answer, right };
            if (!right) { form.classList.remove('is-bad'); void form.offsetWidth; form.classList.add('is-bad'); }
          }
          this.onAct?.(act);
          finish(act);
        });
        if (w.kind === 'say' || w.kind === 'value') form.classList.add('is-main');
      }
      this.keepInView();
    });
  }

  armTap(x, done) {
    const n = this.nodeOf(x);
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
}

/**
 * 老师这一轮写的字 → 要演的行（行号不变，不演的行是 null）：代码块记号那几行不演；
 * ````board memo / plan 块里的是记进记忆、写给自己的，不是镜头（课堂那边照旧读它们）
 */
export function stageLines(text) {
  let inBoard = false;
  return String(text ?? '').split('\n').map((l) => {
    const t = l.trim();
    if (/^`{3,}/.test(t)) {
      if (inBoard) { inBoard = false; return null; }
      if (/^`{3,}\s*board\b/i.test(t)) inBoard = true;
      return null;
    }
    return inBoard ? null : l;
  });
}

/** 填的答案和正确答案一样吗（数按数比：0.50 = .5 = 1/2；别的去掉空格、不分大小写） */
export function sameAnswer(text, answer) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, '').replace(/[，,]/g, ',').toLowerCase();
  const num = (s) => {
    const t = norm(s);
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    const m = t.match(/^(-?\d+)\/(\d+)$/);
    return m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  };
  const a = num(text), b = num(answer);
  if (a != null && b != null) return Math.abs(a - b) < 1e-9;
  return norm(text) === norm(answer);
}

/** 学生这一下做了什么，写给老师看（和舞台现状一起发） */
export function actText(act) {
  if (!act) return '';
  const tries = (act.tries || []).filter((t) => t.type === 'dial').map((t) => `学生拨了 ${t.name}：${t.path.join(' → ')}（停在 ${t.path.at(-1)}）`);
  const main = (() => {
    if (act.type === 'tap') return `学生点了 ${act.ref}（${act.value}${act.slot != null && act.key !== act.slot ? `，#${act.key}` : ''}）${act.expected ? `——你预期的是 ${act.expected}，${act.right ? '点对了' : '点的不是它'}` : ''}`;
    if (act.type === 'drag' && act.a && act.b) return `学生把 ${act.a.value}（#${act.a.key}）拖到 ${act.b.value}（#${act.b.key}）那一格，两格换了位置（舞台已经照做了）`;
    if (act.type === 'drag') return act.text || '学生拖了一下';
    if (act.type === 'next') return `学生点了「${act.button}」`;
    if (act.type === 'say') return `学生说：「${act.text}」`;
    if (act.type === 'value') return `学生填了「${act.text}」——正确答案是 ${act.answer}，${act.right ? '填对了' : '填错了'}`;
    return '';
  })();
  return [...tries, main].filter(Boolean).join('\n');
}

export { compareValues };
