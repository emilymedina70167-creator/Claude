// 一问一答的画面（docs/talk-plan.md）：在 HuobanBoard 上按轮排——画的东西（draw）留在板中间、在原地变；
// 当前这一问在它下面、字大；前两轮缩小在上面，更早的收起来；学生的作答一句句回显在那一轮下面。
// 一轮 = 老师那一次写的几行：turns 记着每一轮写完时源码有几行（applyOps 只往后接、set 只改已有的行，所以行号就是轮次）。
import { HuobanBoard } from './view.js';
import { encValue, decValue } from './talk.js';
import { idents } from './lang.js';

const mk = (cls, tag = 'div') => { const d = document.createElement(tag); d.className = cls; return d; };

export class TalkBoard extends HuobanBoard {
  constructor(el, opts = {}) {
    super(el, opts);
    this.el.classList.add('hb-talk');
    this.bounds = []; // 第 i 轮写完时源码有几行
    this.echo = []; // 第 i 轮下面学生的回显
    this.meta = []; // 第 i 轮的小字（等了几秒、谁写的）
    this.t0s = []; // 第 i 轮出现在板上的时候（作答记录按它算用时：session.record 找最近的 data-t0）
    this.showAll = false;
    this.entering = false;
  }

  /** 第 i 轮的源码（整份），boundsNow：写到这一轮为止每一轮的行数 */
  show(src, bounds, { entering = false, quiet = false, preview = false, force = false } = {}) {
    this.bounds = bounds.slice();
    // 边写边显示先画上的一轮作废了（退回去）：那一轮出现的时候、下面的回显也不算
    if (this.t0s.length > this.bounds.length) this.t0s.length = this.bounds.length;
    if (this.echo.length > this.bounds.length) this.echo.length = this.bounds.length;
    this.entering = entering;
    this.setSource(src, { quiet, preview, force });
  }

  /**
   * 第 i 轮学生在板上看到的字（按源码拼，和作答记录的题面同一套：活的值写成现在的值、空写成 □）。
   * 不从 DOM 取：手势中没重画时 DOM 还是上一轮的，KaTeX 的字会重复三遍，还混着小字和回显
   */
  turnText(i = this.cur) {
    const lo = i > 0 ? this.bounds[i - 1] || 0 : 0, hi = this.bounds[i] ?? Infinity;
    const rt = this.rt;
    rt.fresh();
    const out = [];
    for (const ln of rt.board.lines) {
      if (ln.n <= lo || ln.n > hi) continue;
      if (ln.kind === 'title') out.push(ln.text);
      else if (ln.kind === 'goal') out.push(`目标：${ln.msg}`);
      else if (ln.kind === 'prose' || ln.kind === 'when') {
        if (ln.kind === 'when') { let on = false; try { on = !!rt.eval(ln.cond); } catch { on = false; } if (!on) continue; }
        try { out.push(this.lineQ(ln)); } catch { out.push(ln.text); }
      }
    }
    return out.join('\n');
  }

  // 舞台上的图（draw）用到的量，连着 let 一层层往上找：能拨这些量的那一轮不能折起来（图一直看得见，拨的地方也要看得见）
  stageNames() {
    const seen = new Set(), stack = [];
    for (const ln of this.rt.board.lines) if (ln.kind === 'draw') for (const it of ln.items) { idents(it.ast).forEach((x) => stack.push(x)); if (it.at) idents(it.at).forEach((x) => stack.push(x)); }
    while (stack.length) {
      const x = stack.pop();
      if (seen.has(x)) continue;
      seen.add(x);
      const c = this.rt.cells.get(x);
      if (c?.ast) idents(c.ast).forEach((y) => stack.push(y));
      if (c?.find) idents(c.find).forEach((y) => stack.push(y));
    }
    return seen;
  }

  // 不折起来的轮：有重新打开、还没答对的空（老师知道它重开了，会要学生再答），或者有能拨舞台上那张图的拨数
  keepTurns() {
    const keep = new Set();
    for (const [k, st] of this.blanks) if (st.reopened && st.status !== 'ok') keep.add(this.turnOf(Number(String(k).split('#')[0])));
    const used = this.stageNames();
    for (const ln of this.rt.board.lines) {
      if (ln.kind !== 'prose' && ln.kind !== 'when') continue;
      if (ln.segs.some((sg) => sg.k === 'value' && sg.bare && used.has(sg.bare) && this.rt.cells.get(sg.bare)?.input?.type === 'scrub')) keep.add(this.turnOf(ln.n));
    }
    return keep;
  }

  turnOf(n) { for (let i = 0; i < this.bounds.length; i++) if (n <= this.bounds[i]) return i; return Math.max(0, this.bounds.length - 1); }
  get cur() { return Math.max(0, this.bounds.length - 1); }

  render() {
    this.boxes = [];
    this.parts = { past: mk('hb-past' + (this.showAll ? ' is-all' : '')), stage: mk('hb-stage'), now: mk('hb-now') };
    super.render();
    const cur = this.cur;
    const keep = cur > 2 ? this.keepTurns() : new Set();
    let hidden = 0;
    for (let i = 0; i <= cur; i++) {
      const d = this.box(i);
      if (this.meta[i]) { const m = mk('hb-tmeta'); m.textContent = this.meta[i]; d.prepend(m); }
      const e = mk('hb-echo');
      (this.echo[i] || []).forEach((t) => { const s = mk('', 'span'); s.textContent = t; e.appendChild(s); });
      d.appendChild(e);
      if (i === cur) { if (this.entering) d.classList.add('is-in'); this.parts.now.appendChild(d); } else { if (i < cur - 2 && !keep.has(i)) { d.classList.add('is-old'); hidden++; } this.parts.past.appendChild(d); }
    }
    if (hidden && !this.showAll) {
      const more = mk('hb-more', 'button');
      more.type = 'button';
      more.textContent = `前面还有 ${hidden} 轮`;
      more.addEventListener('click', () => { this.showAll = true; this.parts.past.classList.add('is-all'); more.remove(); });
      this.parts.past.prepend(more);
    }
    this.el.append(this.parts.past, this.parts.stage, this.parts.now);
    this.entering = false;
  }

  box(i) {
    if (!this.boxes[i]) {
      this.boxes[i] = mk('hb-turn');
      this.boxes[i].dataset.t = i;
      this.t0s[i] ||= Date.now();
      this.boxes[i].dataset.t0 = this.t0s[i];
    }
    return this.boxes[i];
  }

  // 画的东西进中间那一栏，别的按它是第几轮写的进那一轮
  place(b, ln) {
    if (ln.kind === 'draw' || ln.kind === 'title') this.parts.stage.appendChild(b.el);
    else this.box(this.turnOf(ln.n)).appendChild(b.el);
  }

  /** 学生这一轮做了什么：回显在那一轮下面（i 不写就是当前这一轮） */
  addEcho(text, i = this.cur) {
    (this.echo[i] || (this.echo[i] = [])).push(text);
    const e = this.el.querySelector(`.hb-turn[data-t="${i}"] .hb-echo`);
    if (e) { const s = mk('', 'span'); s.textContent = text; e.appendChild(s); }
  }

  setMeta(i, text) { this.meta[i] = text; const d = this.el.querySelector(`.hb-turn[data-t="${i}"] .hb-tmeta`); if (d) d.textContent = text; else this.el.querySelector(`.hb-turn[data-t="${i}"]`)?.prepend(Object.assign(mk('hb-tmeta'), { textContent: text })); }

  /** 存进数据库的样子（课堂把它存在活板那一段上）：找到的例子也存着，刷新后不再重新搜（搜一次几百毫秒，结果也可能不一样） */
  snapshot() {
    const finds = [];
    for (const [k, v] of this.rt.findCache) if (v && 'value' in v) finds.push([k, encValue(v.value)]);
    return { src: this.src, bounds: this.bounds.slice(), echo: this.echo.map((x) => (x || []).slice()), meta: this.meta.slice(), finds, t0s: this.t0s.slice() };
  }

  /** 刷新后画回去：snap 是 snapshot() 存的，recs 是这块活板的作答记录（空、选择、目标、拨的值放回去） */
  restoreFrom(snap = {}, recs = []) {
    this.bounds = Array.isArray(snap.bounds) ? snap.bounds.map(Number) : [];
    this.echo = Array.isArray(snap.echo) ? snap.echo.map((x) => (Array.isArray(x) ? x.map(String) : [])) : [];
    this.meta = Array.isArray(snap.meta) ? snap.meta.map((x) => String(x ?? '')) : [];
    this.t0s = Array.isArray(snap.t0s) ? snap.t0s.map(Number) : [];
    for (const [k, v] of Array.isArray(snap.finds) ? snap.finds : []) if (typeof k === 'string') this.rt.findCache.set(k, { value: decValue(v) });
    this.src = String(snap.src ?? '');
    this.rt.load(this.src);
    this.restoreWork(recs);
    this.render();
  }
}
