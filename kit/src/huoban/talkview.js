// 一问一答的画面（docs/talk-plan.md）：在 HuobanBoard 上按轮排——画的东西（draw）留在板中间、在原地变；
// 当前这一问在它下面、字大；前两轮缩小在上面，更早的收起来；学生的作答一句句回显在那一轮下面。
// 一轮 = 老师那一次写的几行：turns 记着每一轮写完时源码有几行（applyOps 只往后接、set 只改已有的行，所以行号就是轮次）。
import { HuobanBoard } from './view.js';
import { encValue, decValue } from './talk.js';

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
  show(src, bounds, { entering = false, quiet = false } = {}) {
    this.bounds = bounds.slice();
    // 边写边显示先画上的一轮作废了（退回去）：那一轮出现的时候也不算
    if (this.t0s.length > this.bounds.length) this.t0s.length = this.bounds.length;
    this.entering = entering;
    this.setSource(src, { quiet });
  }

  turnOf(n) { for (let i = 0; i < this.bounds.length; i++) if (n <= this.bounds[i]) return i; return Math.max(0, this.bounds.length - 1); }
  get cur() { return Math.max(0, this.bounds.length - 1); }

  render() {
    this.boxes = [];
    this.parts = { past: mk('hb-past' + (this.showAll ? ' is-all' : '')), stage: mk('hb-stage'), now: mk('hb-now') };
    super.render();
    const cur = this.cur;
    for (let i = 0; i <= cur; i++) {
      const d = this.box(i);
      if (this.meta[i]) { const m = mk('hb-tmeta'); m.textContent = this.meta[i]; d.prepend(m); }
      const e = mk('hb-echo');
      (this.echo[i] || []).forEach((t) => { const s = mk('', 'span'); s.textContent = t; e.appendChild(s); });
      d.appendChild(e);
      if (i === cur) { if (this.entering) d.classList.add('is-in'); this.parts.now.appendChild(d); } else { if (i < cur - 2) d.classList.add('is-old'); this.parts.past.appendChild(d); }
    }
    const hidden = Math.max(0, cur - 2);
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
