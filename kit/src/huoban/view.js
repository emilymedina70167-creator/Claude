// 活板的画面（docs/talk-plan.md）：描述 → DOM。学生一动（拨、拖、折、填、选），整块重算，变了的地方才动。
// 画法都在这里定（坐标、颜色、字号、动画），老师写不了，所以画不难看：颜色用风格的变量（--blue、--yellow……），
// 演示过程直接用引擎现有的画面（engine.view，和演示组件一样的格子、表、树），步与步之间用 morph.js 滑过去。
// 画完量一遍（measure）：比屏幕宽的变成能横着滑，报给老师。
import { Runtime } from './runtime.js';
import { idents } from './lang.js';
import { checkBoard } from './check.js';
import { text, tex, f, isNumber, isVector, isMatrix } from './values.js';
import { mdToHtml, tex2html, escapeHtml } from '../render.js';
import { snapshot, animateFrom, settle } from '../morph.js';

const COLORS = ['var(--blue)', 'var(--yellow)', 'var(--green)', 'var(--pink)', 'var(--lav)'];
const key = (s) => String(s).replace(/\s+/g, '');
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

// 值 → 板上的样子：数、向量、矩阵用公式排（分数是 \tfrac），文字照写
function valueHtml(v) {
  // 一长串数（引用串、序列）照文字写成一行，不排成竖着的列向量
  if (isVector(v) && v.length > 3) return `<span class="hb-seq">${v.map((x) => escapeHtml(text(x))).join(' ')}</span>`;
  if (isNumber(v) || isVector(v) || isMatrix(v)) {
    try { return tex2html(isVector(v) && v.length <= 3 ? `(${v.map((x) => tex(x)).join(',\\ ')})` : tex(v)); } catch { /* 退回文字 */ }
  }
  return escapeHtml(text(v));
}

/**
 * 一块活板。opts：
 *   onAction({ text, kind, short, ok, value, misread, n })：学生的动作。kind：commit 作答（课堂里马上发给老师）、
 *     explore 在板上试（攒着）、info 页面自己做的事（找了例子）
 *   onSource(src, problems)：读完、查完以后（problems：写法错误 + 教学检查 + 画面测量）
 */
export class HuobanBoard {
  constructor(el, opts = {}) {
    this.el = el;
    this.el.classList.add('hb-board');
    this.rt = new Runtime();
    this.opts = opts;
    this.blanks = new Map();
    this.choices = new Map();
    this.goalsDone = new Map();
    this.src = '';
  }

  setSource(src, { quiet = false, check = true } = {}) {
    if (this.pending) { clearTimeout(this.pending.timer); this.settle(); }
    this.src = String(src);
    this.rt.load(this.src);
    this.render();
    if (!quiet) this.opts.onSource?.(this.src, this.problems({ check }));
  }

  /** 写法错误 + 教学检查 + 画面测量：[{ n, level, code, msg }] */
  problems({ check = true } = {}) {
    const out = this.rt.board.errors.map((e) => ({ n: e.n, level: 'error', code: 'syntax', msg: `第 ${e.n} 行：${e.msg}` }));
    if (check) { try { out.push(...checkBoard(this.rt)); } catch (e) { out.push({ n: 0, level: 'warn', code: 'check', msg: `检查没跑完：${e.message}` }); } }
    this.rt.fresh();
    out.push(...this.measure());
    return out;
  }

  render() {
    this.el.innerHTML = '';
    this.blocks = [];
    this.colors = new Map();
    this.figInfo = new Map();
    this.rt.fresh();
    const lines = this.rt.board.lines;
    this.paintColors(lines);
    // 板上有空在问这个过程（{r.faults?}）：引擎画面里的小结（「缺页 9」这类 sv-chips）先藏起来，不然等于把答案写在旁边
    this.asked = new Set();
    for (const ln of lines) for (const sg of ln.segs || []) if (sg.k === 'blank') idents(sg.ast).forEach((x) => this.asked.add(x));
    for (const ln of lines) {
      const b = this.block(ln);
      if (b) { b.el.dataset.n = ln.n; this.place(b, ln); this.blocks.push(b); }
    }
    this.update({ first: true });
  }

  place(b) { this.el.appendChild(b.el); }

  // 图里的向量排颜色：正文里同一个式子用同一个颜色，文字和图连着
  paintColors(lines) {
    let ci = 0;
    for (const ln of lines) if (ln.kind === 'draw') for (const it of ln.items) {
      let v; try { v = this.rt.eval(it.ast); } catch { continue; }
      if (isVector(v) && v.length === 2 && !this.colors.has(key(it.src))) this.colors.set(key(it.src), COLORS[ci++ % COLORS.length]);
    }
  }

  block(ln) {
    if (ln.kind === 'title') { const h = document.createElement('h3'); h.className = 'hb-title'; h.textContent = ln.text; return { el: h, update() {} }; }
    if (ln.kind === 'let') return null;
    if (ln.kind === 'error') {
      const d = document.createElement('div');
      d.className = 'hb-err';
      d.innerHTML = `第 ${ln.n} 行：${escapeHtml(ln.msg)}<code>${escapeHtml(ln.line)}</code>`;
      return { el: d, update() {} };
    }
    if (ln.kind === 'prose') return this.prose(ln);
    if (ln.kind === 'when') {
      const b = this.prose(ln);
      b.el.classList.add('hb-when', 'is-off');
      const inner = b.update;
      b.update = (ctx) => {
        let on = false;
        try { on = !!this.rt.eval(ln.cond); } catch { on = false; }
        const was = !b.el.classList.contains('is-off');
        b.el.classList.toggle('is-off', !on);
        if (on && !was && !ctx.first && !reduceMotion()) restart(b.el, 'is-in');
        if (on) inner(ctx);
      };
      return b;
    }
    if (ln.kind === 'goal') return this.goal(ln);
    if (ln.kind === 'draw') return this.figure(ln);
    return null;
  }

  prose(ln) {
    const el = document.createElement('p');
    el.className = 'hb-p';
    const parts = [];
    ln.segs.forEach((sg, i) => {
      if (sg.k === 'text') { const s = document.createElement('span'); s.innerHTML = mdToHtml(sg.v, { inline: true }); el.appendChild(s); return; }
      const cell = sg.bare && this.rt.cells.get(sg.bare);
      if (sg.k === 'value' && cell?.input?.type === 'scrub') parts.push(this.scrub(el, cell));
      else if (sg.k === 'value') parts.push(this.value(el, sg));
      else if (sg.k === 'blank') parts.push(this.blank(el, sg, `${ln.text}#${i}`, ln.n));
      else if (sg.k === 'choice') parts.push(this.choice(el, sg, `${ln.text}#${i}`, ln.n));
    });
    return { el, update: (ctx) => parts.forEach((p) => p(ctx)) };
  }

  value(parent, sg) {
    const s = document.createElement('span');
    s.className = 'hb-v';
    s.dataset.expr = key(sg.src);
    const color = this.colors.get(key(sg.src));
    if (color) { s.classList.add('is-linked'); s.style.color = color; s.addEventListener('click', () => this.pulse(key(sg.src))); }
    parent.appendChild(s);
    let last = null;
    return (ctx) => {
      let html, plain;
      try { const v = this.rt.eval(sg.ast); html = valueHtml(v); plain = text(v); } catch (e) { html = `<span class="hb-bad">（${escapeHtml(e.message)}）</span>`; plain = ''; }
      if (html !== last) {
        s.innerHTML = html;
        s.dataset.text = plain;
        if (last !== null && !ctx.first && !reduceMotion()) restart(s, 'is-flash');
        last = html;
      }
    };
  }

  scrub(parent, cell) {
    const w = document.createElement('span');
    w.className = 'hb-scrub';
    w.innerHTML = '<button type="button" aria-label="减一">‹</button><span class="hb-n" role="spinbutton" tabindex="0"></span><button type="button" aria-label="加一">›</button>';
    parent.appendChild(w);
    const [minus, n, plus] = w.children;
    const { lo, hi, step } = cell.input;
    const cur = () => f(this.rt.get(cell.name));
    const go = (v) => { v = Math.max(lo, Math.min(hi, Math.round(v / step) * step)); if (v !== cur()) this.scrubTo(cell.name, v); };
    minus.addEventListener('click', () => go(cur() - step));
    plus.addEventListener('click', () => go(cur() + step));
    n.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') go(cur() - step); if (e.key === 'ArrowRight' || e.key === 'ArrowUp') go(cur() + step); });
    // 按住数字左右拖：一格 26px
    n.addEventListener('pointerdown', (e) => {
      n.setPointerCapture?.(e.pointerId);
      const x0 = e.clientX, v0 = cur();
      const move = (ev) => go(v0 + Math.round((ev.clientX - x0) / 26) * step);
      const up = () => { n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up); n.removeEventListener('pointercancel', up); };
      n.addEventListener('pointermove', move);
      n.addEventListener('pointerup', up);
      n.addEventListener('pointercancel', up);
    });
    let last = null;
    return (ctx) => {
      const v = cur();
      n.textContent = text(this.rt.get(cell.name));
      minus.disabled = v <= lo; plus.disabled = v >= hi;
      if (last !== null && v !== last && !ctx.first && !reduceMotion()) restart(w, 'is-pulse');
      last = v;
    };
  }

  blank(parent, sg, id, n) {
    const w = document.createElement('span');
    w.className = 'hb-blank';
    w.innerHTML = '<input type="text" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="你的答案"><button type="button">对吗</button><span class="hb-note"></span>';
    parent.appendChild(w);
    const [input, btn, note] = w.children;
    const st = this.blanks.get(id) || { status: '', sig: null, val: '', tries: 0 };
    this.blanks.set(id, st);
    input.value = st.val;
    const submit = () => {
      const given = input.value.trim();
      if (!given || st.status === 'ok') return;
      const r = this.rt.judge(sg.ast, given);
      if (r.error) return;
      st.tries++;
      st.status = r.ok ? 'ok' : 'bad'; st.val = given; st.sig = text(r.expected);
      const why = r.misread ? `；页面看出来：${r.misread}` : '';
      this.act({ kind: 'commit', n, ok: r.ok, value: given, misread: r.misread || undefined, q: sg.src,
        text: `填空 {${sg.src}?}：写了 ${given}，${r.ok ? '对' : `不对（页面算的是 ${text(r.expected)}）`}${why}${st.tries > 1 ? `（第 ${st.tries} 次）` : ''}`,
        short: `填了 ${given}，${r.ok ? '对' : '不对'}` });
      paint(true);
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
    const paint = (fresh) => {
      w.classList.toggle('is-ok', st.status === 'ok');
      w.classList.remove('is-bad');
      if (st.status === 'bad' && fresh && !reduceMotion()) restart(w, 'is-bad');
      btn.textContent = st.status === 'ok' ? '✓' : '对吗';
      input.readOnly = st.status === 'ok';
    };
    return () => {
      // 上面的量变了、答案跟着变：空重新打开
      if (st.status === 'ok') {
        let sig; try { sig = text(this.rt.eval(sg.ast)); } catch { sig = null; }
        if (sig !== st.sig) { st.status = ''; st.val = ''; input.value = ''; note.textContent = '数变了，再算一次'; } else note.textContent = '';
      }
      paint(false);
    };
  }

  choice(parent, sg, id, n) {
    const w = document.createElement('span');
    w.className = 'hb-choice';
    parent.appendChild(w);
    const st = this.choices.get(id) || { picked: new Set(), done: false };
    this.choices.set(id, st);
    sg.choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.t;
      b.addEventListener('click', () => {
        if (st.done || st.picked.has(i)) return;
        st.picked.add(i);
        if (c.ok) st.done = true;
        const wrong = [...st.picked].filter((j) => !sg.choices[j].ok).map((j) => `「${sg.choices[j].t}」`);
        this.act({ kind: 'commit', n, ok: c.ok, value: c.t, text: `选择：选了「${c.t}」，${c.ok ? '对' : '不对'}${c.ok && wrong.length ? `（之前选过 ${wrong.join('、')}）` : ''}`, short: `选了「${c.t}」` });
        paint();
      });
      w.appendChild(b);
    });
    const paint = () => [...w.children].forEach((b, i) => {
      b.classList.toggle('is-ok', st.picked.has(i) && sg.choices[i].ok);
      b.classList.toggle('is-bad', st.picked.has(i) && !sg.choices[i].ok);
    });
    paint();
    return () => {};
  }

  goal(ln) {
    const el = document.createElement('div');
    el.className = 'hb-goal';
    el.innerHTML = '<span class="hb-dot" aria-hidden="true"></span><span class="hb-gt">目标：还没做到</span>';
    const t = el.querySelector('.hb-gt');
    const id = `${ln.src}|${ln.msg}`;
    return {
      el,
      update: (ctx) => {
        let ok = false;
        try { ok = !!this.rt.eval(ln.cond); } catch { ok = false; }
        // 做到过就一直算做到了（学生再拨走也不收回）
        if (ok && !this.goalsDone.get(id)) { this.goalsDone.set(id, true); if (!ctx.first) this.act({ kind: 'commit', n: ln.n, ok: true, text: `做到了目标：${ln.msg}`, short: '做到了' }); }
        const done = !!this.goalsDone.get(id);
        el.classList.toggle('is-done', done);
        t.textContent = done ? ln.msg : '目标：还没做到';
      },
    };
  }

  figure(ln) {
    const el = document.createElement('div');
    el.className = 'hb-fig';
    let kind = null, view = null;
    return {
      el,
      update: (ctx) => {
        const vals = ln.items.map((it) => { try { return { it, v: this.rt.eval(it.ast), k: it.at ? this.rt.eval(it.at) : null }; } catch (e) { return { it, e }; } });
        const bad = vals.find((x) => x.e);
        if (bad) { el.innerHTML = `<div class="hb-err">第 ${ln.n} 行画不出来：${escapeHtml(bad.e.message)}<code>${escapeHtml(bad.it.src)}</code></div>`; kind = null; return; }
        for (const { it, v } of vals) {
          if (isVector(v)) this.figInfo.set(key(it.src), text(v));
          else if (v?.kind === 'process') { try { this.figInfo.set(`${key(it.src)} 画到`, `第 ${this.stepOf(v, vals.find((x) => x.it === it).k)} 步`); } catch { /* 不记 */ } }
        }
        const k = figKind(vals.map((x) => x.v));
        if (k !== kind) { el.innerHTML = ''; kind = k; view = k === 'plane' ? new PlaneView(el, this) : k === 'process' ? new ProcessView(el, this) : k === 'sentence' ? new SentenceView(el, this) : new CellsView(el); }
        view.update(vals, ctx);
      },
    };
  }

  stepOf(p, k) {
    const last = p.run.steps.length - 1;
    if (k === null || k === undefined) return last;
    return Math.max(0, Math.min(last, Math.round(f(k))));
  }

  update(ctx = {}) {
    this.rt.fresh();
    for (const b of this.blocks) b.update(ctx);
    for (const x of this.rt.found.splice(0)) this.act({ kind: 'info', text: `页面替老师找了例子：${x.name} = ${text(x.value)}（试了 ${x.tries} 个，${x.ms} 毫秒）` });
  }

  // —— 学生动了：记下动作和板上跟着变的东西（老师看到的就是这一行）——
  visible() {
    const out = new Map();
    this.el.querySelectorAll('.hb-v').forEach((s) => { if (!s.closest('.is-off')) out.set(s.dataset.expr, s.dataset.text ?? s.textContent); });
    this.figInfo.forEach((v, k) => { if (!out.has(k)) out.set(k, v); });
    return out;
  }
  diff(before, skip) {
    const after = this.visible(), out = [];
    after.forEach((v, k) => { if (k !== skip && before.has(k) && before.get(k) !== v && v.length < 60) out.push(`${k}：${before.get(k)} → ${v}`); });
    return out;
  }
  scrubTo(name, v) {
    const same = this.pending?.name === name;
    const from = same ? this.pending.from : text(this.rt.get(name));
    const before = same ? this.pending.before : this.visible();
    this.rt.setInput(name, v);
    this.update({});
    clearTimeout(this.pending?.timer);
    this.pending = { name, from, before, timer: setTimeout(() => this.settle(), 700) };
  }
  settle() {
    const p = this.pending; this.pending = null;
    if (!p) return;
    const to = text(this.rt.get(p.name));
    if (to === p.from) return;
    const d = this.diff(p.before, p.name);
    this.act({ kind: 'explore', text: `拨 ${p.name}：${p.from} → ${to}${d.length ? `（板上跟着变：${d.join('，')}）` : ''}`, short: `拨到 ${to}` });
  }
  act(a) { this.opts.onAction?.(a); }

  pulse(k) {
    if (reduceMotion()) return;
    this.el.querySelectorAll(`.hb-vec[data-expr="${CSS.escape(k)}"], .hb-v[data-expr="${CSS.escape(k)}"]`).forEach((x) => restart(x, 'is-flash'));
  }

  /** 画完量一遍：比板宽的图变成横着滑（CSS 已经是 overflow-x: auto），报给老师 */
  measure() {
    const out = [];
    const W = this.el.clientWidth;
    if (!W) return out;
    this.el.querySelectorAll('.hb-fig').forEach((fig) => {
      const inner = fig.querySelector('.hb-scroll') || fig;
      const extra = inner.scrollWidth - inner.clientWidth;
      if (extra > 8) out.push({ n: Number(fig.dataset.n) || 0, level: 'info', code: 'wide', msg: `第 ${fig.dataset.n} 行的图比板宽 ${extra}px，学生要横着滑才看得全` });
    });
    return out;
  }
}

function figKind(vs) {
  if (vs.every((v) => v && v.kind === 'process')) return 'process';
  if (vs.length === 1 && vs[0]?.kind === 'sentence') return 'sentence';
  if (vs.every((v) => (isVector(v) && v.length === 2) || (isMatrix(v) && v.length === 2 && v[0].length === 2))) return 'plane';
  return 'cells';
}

// —— 演示过程：用引擎现有的画面（和演示组件一样），画到第几步；换步时滑过去 ——
class ProcessView {
  constructor(el, board) { this.board = board; this.el = document.createElement('div'); this.el.className = 'hb-procs'; el.appendChild(this.el); this.parts = []; }
  update(vals, ctx) {
    if (this.parts.length !== vals.length) {
      this.el.innerHTML = '';
      this.parts = vals.map(() => {
        const box = document.createElement('div');
        box.className = 'hb-proc sv-widget';
        box.innerHTML = '<div class="hb-proc-name"></div><div class="hb-scroll"><div class="sv-stage"></div></div><div class="hb-proc-msg sv-msg"></div>';
        this.el.appendChild(box);
        return { box, stage: box.querySelector('.sv-stage'), name: box.querySelector('.hb-proc-name'), msg: box.querySelector('.hb-proc-msg'), sig: null };
      });
    }
    vals.forEach(({ it, v, k }, i) => {
      const part = this.parts[i];
      const at = this.board.stepOf(v, k);
      const sig = `${v.src}|${at}`;
      if (sig === part.sig) return;
      const step = v.run.steps[at];
      const glide = part.sig && !ctx.first && !reduceMotion() && part.sig.split('|')[0] === v.src;
      let snap = null;
      if (glide) { settle(part.stage); snap = snapshot(part.stage); }
      part.stage.innerHTML = v.engine.view(step.view, v.input, { k: at, md: (s) => mdToHtml(s), tex: (t) => tex2html(t), blank: () => '' });
      const asked = [...this.board.asked].some((n) => idents(it.ast).has(n));
      part.stage.querySelectorAll('.sv-chips').forEach((c) => { c.hidden = asked; });
      if (snap) animateFrom(part.stage, snap, { ms: 320 });
      part.name.textContent = it.label || `${v.engine.title || v.name}${k !== null && k !== undefined ? ` · 第 ${at} 步` : ''}`;
      // 画到最后一步时不放引擎的说明（说明里常常直接写着答案，比如「一共缺页 9 次」）；画到中间某一步时放
      const showMsg = k !== null && k !== undefined && at < v.run.steps.length - 1 && step.msg;
      part.msg.hidden = !showMsg;
      if (showMsg) part.msg.innerHTML = mdToHtml(step.msg, { inline: true });
      part.sig = sig;
    });
  }
}

// —— 平面：向量画成箭头，2×2 矩阵画成变换后的网格；能拖的向量按住箭头尖拖 ——
class PlaneView {
  constructor(el, board) {
    this.board = board;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 400 400');
    this.svg.setAttribute('class', 'hb-plane');
    el.appendChild(this.svg);
    this.cap = document.createElement('div');
    this.cap.className = 'hb-cap';
    el.appendChild(this.cap);
    this.R = null; this.shown = null; this.anim = 0; this.drag = null; this.items = [];
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
  }
  pt(e) { const r = this.svg.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 400, ((e.clientY - r.top) / r.height) * 400]; }
  toW([px, py]) { const s = 180 / this.R; return [(px - 200) / s, -(py - 200) / s]; }
  toS([x, y]) { const s = 180 / this.R; return [200 + x * s, 200 - y * s]; }
  dragItems() { return this.items.filter((x) => this.board.rt.cells.get(x.it.src)?.input?.type === 'drag'); }
  down(e) {
    const p = this.pt(e);
    let best = null, bd = 40;
    for (const x of this.dragItems()) { const [sx, sy] = this.toS(f(x.v)); const d = Math.hypot(sx - p[0], sy - p[1]); if (d < bd) { bd = d; best = x; } }
    if (!best) { const g = e.target.closest?.('.hb-vec'); if (g) this.board.pulse(g.dataset.expr); return; }
    e.preventDefault();
    this.svg.setPointerCapture?.(e.pointerId);
    const name = best.it.src, snap = this.board.rt.cells.get(name).input.snap;
    const from = text(this.board.rt.get(name));
    const before = this.board.visible();
    this.drag = name;
    this.svg.classList.add('is-dragging');
    const move = (ev) => {
      const w = this.toW(this.pt(ev)).map((c) => Math.max(-this.R, Math.min(this.R, Math.round(c / snap) * snap)));
      const cur = f(this.board.rt.get(name));
      if (w[0] !== cur[0] || w[1] !== cur[1]) { this.board.rt.setInput(name, w); this.board.update({ drag: true }); }
    };
    const up = () => {
      this.svg.removeEventListener('pointermove', move); this.svg.removeEventListener('pointerup', up); this.svg.removeEventListener('pointercancel', up);
      this.drag = null; this.svg.classList.remove('is-dragging');
      const to = text(this.board.rt.get(name));
      if (to !== from) { const d = this.board.diff(before, name); this.board.act({ kind: 'explore', text: `拖 ${name}：${from} → ${to}${d.length ? `（${d.join('，')}）` : ''}`, short: `把 ${name} 拖到 ${to}` }); }
      this.board.update({});
    };
    this.svg.addEventListener('pointermove', move); this.svg.addEventListener('pointerup', up); this.svg.addEventListener('pointercancel', up);
  }
  update(vals, ctx) {
    this.items = vals;
    const fv = vals.map((x) => f(x.v));
    // 范围：拖的时候不变（不然手指下的点会跑），松手后再看要不要放大
    if (!this.drag) {
      let m = 2;
      for (const v of fv) (isMatrix(v) ? v.flat() : v).forEach((c) => (m = Math.max(m, Math.abs(c))));
      const R = Math.ceil(m * 1.25 + 0.5);
      if (this.R === null || R > this.R || R < this.R - 2) this.R = R;
    }
    // 不是手指拖出来的变化（老师 set、换了矩阵）：滑过去
    if (this.shown && !ctx.drag && !ctx.first && !reduceMotion() && sameShape(this.shown, fv)) {
      const from = this.shown, t0 = performance.now(), id = ++this.anim;
      const lerp = (a, b, t) => (Array.isArray(a) ? a.map((x, i) => lerp(x, b[i], t)) : a + (b - a) * t);
      const step = (now) => {
        if (id !== this.anim) return;
        const t = Math.min(1, (now - t0) / 520), e = 1 - Math.pow(1 - t, 3);
        this.draw(lerp(from, fv, e));
        if (t < 1) requestAnimationFrame(step); else this.shown = fv;
      };
      requestAnimationFrame(step);
    } else { this.anim++; this.draw(fv); this.shown = fv; }
  }
  draw(vs) {
    const R = this.R, s = 180 / R;
    const S = ([x, y]) => [200 + x * s, 200 - y * s];
    let h = '';
    for (let k = -R; k <= R; k++) { const a = 200 + k * s; h += `<line x1="${a}" y1="0" x2="${a}" y2="400" class="hb-grid"/><line x1="0" y1="${a}" x2="400" y2="${a}" class="hb-grid"/>`; }
    h += '<line x1="0" y1="200" x2="400" y2="200" class="hb-axis"/><line x1="200" y1="0" x2="200" y2="400" class="hb-axis"/>';
    const L = R * 4;
    vs.forEach((v) => {
      if (!isMatrix(v)) return;
      const A = (p) => [v[0][0] * p[0] + v[0][1] * p[1], v[1][0] * p[0] + v[1][1] * p[1]];
      let g = '';
      for (let k = -L; k <= L; k++) {
        const [a1, b1, a2, b2] = [S(A([k, -L])), S(A([k, L])), S(A([-L, k])), S(A([L, k]))];
        g += `<line x1="${a1[0]}" y1="${a1[1]}" x2="${b1[0]}" y2="${b1[1]}"/><line x1="${a2[0]}" y1="${a2[1]}" x2="${b2[0]}" y2="${b2[1]}"/>`;
      }
      const flat = Math.abs(v[0][0] * v[1][1] - v[0][1] * v[1][0]) < 1e-9;
      h += `<g class="hb-mgrid${flat ? ' is-flat' : ''}">${g}</g>`;
    });
    const drags = new Set(this.dragItems().map((x) => x.it.src));
    vs.forEach((v, i) => {
      if (isMatrix(v)) return;
      const it = this.items[i].it;
      const color = this.board.colors.get(key(it.src)) || 'var(--chalk)';
      const [x2, y2] = S(v);
      const len = Math.hypot(x2 - 200, y2 - 200);
      const ux = len > 1 ? (x2 - 200) / len : 0, uy = len > 1 ? (y2 - 200) / len : 0;
      const hx = x2 - ux * 13, hy = y2 - uy * 13;
      const head = len > 6 ? `<polygon points="${x2},${y2} ${hx - uy * 6.5},${hy + ux * 6.5} ${hx + uy * 6.5},${hy - ux * 6.5}" fill="${color}"/>` : '';
      const lab = it.label || it.src.replace(/\*/g, '').replace(/\s+/g, '');
      const lx = x2 + (ux || 0.7) * 16 + 4, ly = y2 + (uy || -0.7) * 16 + 5;
      h += `<g class="hb-vec" data-expr="${escapeHtml(key(it.src))}"><line x1="200" y1="200" x2="${len > 6 ? hx : x2}" y2="${len > 6 ? hy : y2}" stroke="${color}" stroke-width="3.2" stroke-linecap="round"/>${head}<text class="hb-lbl" x="${lx}" y="${ly}" fill="${color}" text-anchor="middle">${escapeHtml(lab)}</text>`;
      if (drags.has(it.src)) h += `<circle class="hb-handle" cx="${x2}" cy="${y2}" r="${this.drag === it.src ? 11 : 8}" fill="${color}"/><circle class="hb-hit" cx="${x2}" cy="${y2}" r="26" fill="transparent"/>`;
      h += '</g>';
    });
    this.svg.innerHTML = h;
    this.cap.textContent = drags.size ? '按住彩色的圆点拖' : '';
  }
}
const sameShape = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => sameShape(x, b[i])) : typeof a === typeof b);

// —— 句子：虚线框是能折起的一段 ——
class SentenceView {
  constructor(el, board) { this.board = board; this.el = document.createElement('div'); this.el.className = 'hb-sent'; el.appendChild(this.el); this.sig = null; }
  update(vals) {
    const s = vals[0].v;
    if (s.text !== this.sig) {
      this.sig = s.text;
      this.el.innerHTML = '';
      for (const p of s.parts) {
        if (!p.fold) { if (p.t.trim()) { const w = document.createElement('span'); w.className = 'hb-w'; w.textContent = p.t.trim(); this.el.appendChild(w); } continue; }
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'hb-fold'; b.textContent = p.t.trim(); b.dataset.i = p.i;
        b.addEventListener('click', () => {
          const before = this.board.visible();
          const shut = this.board.rt.toggleFold(s.cell, p.i);
          this.board.update({});
          const d = this.board.diff(before);
          this.board.act({ kind: 'explore', text: `${shut ? '折起' : '展开'}「${p.t.trim()}」${d.length ? `（${d.join('，')}）` : ''}`, short: `${shut ? '折起' : '展开'}「${p.t.trim()}」` });
        });
        this.el.appendChild(b);
      }
    }
    this.el.querySelectorAll('.hb-fold').forEach((b) => { const shut = s.folded.has(Number(b.dataset.i)); b.classList.toggle('is-shut', shut); b.setAttribute('aria-label', `${shut ? '展开' : '折起'}：${b.textContent}`); });
  }
}

class CellsView {
  constructor(el) { this.el = document.createElement('div'); this.el.className = 'hb-cells'; el.appendChild(this.el); }
  update(vals) { this.el.innerHTML = vals.map(({ v }) => (Array.isArray(v) ? v : [v]).map((x) => `<span>${escapeHtml(text(x))}</span>`).join('')).join('<i></i>'); }
}
