// 一问一答的画面（docs/talk-plan.md）：在 HuobanBoard 上按轮排——画的东西（draw）留在板中间、在原地变；
// 当前这一问在它下面、字大；前两轮缩小在上面，更早的收起来；学生的作答一句句回显在那一轮下面。
// 一轮 = 老师那一次写的几行：turns 记着每一轮写完时源码有几行（applyOps 只往后接、set 只改已有的行，所以行号就是轮次）。
import { HuobanBoard } from './view.js';

const mk = (cls, tag = 'div') => { const d = document.createElement(tag); d.className = cls; return d; };

export class TalkBoard extends HuobanBoard {
  constructor(el, opts = {}) {
    super(el, opts);
    this.el.classList.add('hb-talk');
    this.bounds = []; // 第 i 轮写完时源码有几行
    this.echo = []; // 第 i 轮下面学生的回显
    this.meta = []; // 第 i 轮的小字（等了几秒、谁写的）
    this.showAll = false;
    this.entering = false;
  }

  /** 第 i 轮的源码（整份），boundsNow：写到这一轮为止每一轮的行数 */
  show(src, bounds, { entering = false, quiet = false } = {}) {
    this.bounds = bounds.slice();
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
    if (!this.boxes[i]) { this.boxes[i] = mk('hb-turn'); this.boxes[i].dataset.t = i; }
    return this.boxes[i];
  }

  // 画的东西进中间那一栏，别的按它是第几轮写的进那一轮
  place(b, ln) {
    if (ln.kind === 'draw' || ln.kind === 'title') this.parts.stage.appendChild(b.el);
    else this.box(this.turnOf(ln.n)).appendChild(b.el);
  }

  /** 学生这一轮做了什么：回显在当前这一轮下面 */
  addEcho(text) {
    const i = this.cur;
    (this.echo[i] || (this.echo[i] = [])).push(text);
    const e = this.el.querySelector(`.hb-now .hb-turn[data-t="${i}"] .hb-echo`);
    if (e) { const s = mk('', 'span'); s.textContent = text; e.appendChild(s); }
  }

  setMeta(i, text) { this.meta[i] = text; const d = this.el.querySelector(`.hb-turn[data-t="${i}"] .hb-tmeta`); if (d) d.textContent = text; }
}
