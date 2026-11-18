// 题卡的画法（types/card.js 的画面那一半）：一张白卡，一行一个部件；扣着的行是一条带「?」的横条，翻开时像翻牌
import { EASE, stagger } from '../motion.js';
import { cardW, lineH } from './card.js';

const tr = (x, y) => `translate(${x}px, ${y}px)`;
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

export const cardView = {
  sync(stage, o, ctx) {
    const sc = stage.scene;
    const box = sc.objectBox(o.id);
    const bg = stage.decor(o.id, 'card', () => {
      const n = el('div', 'st-card', stage.layer);
      n.style.transform = tr(box.x, box.y);
      if (ctx.entering === o.id) n.style.opacity = '0';
      return n;
    });
    bg.style.width = `${box.w}px`; // 求解器给题卡挑了窄一点的宽（第九轮）：卡跟着变
    bg.style.height = `${box.h}px`;
    // 题卡整张挪了（下面的东西被推下去、上面的东西长高了）：底卡跟着走（以前只在造出来时摆一次，留在原地，压到别的东西上）
    if (!same(bg.__box, box)) {
      const was = bg.__box;
      bg.__box = { ...box };
      if (was && !stage.instant && ctx.entering !== o.id) ctx.jobs.push(stage.tween(bg, [{ transform: tr(was.x, was.y) }, { transform: tr(box.x, box.y) }], { duration: 520, easing: EASE.move }));
      else bg.style.transform = tr(box.x, box.y);
    }
    const moves = [];
    for (const l of o.lines) {
      const b = sc.partBox(l);
      const n = stage.partNode(l, () => {
        const n = el('div', 'st-cline', stage.layer);
        n.style.width = `${b.w}px`;
        n.style.transform = tr(b.x, b.y);
        n.__box = b;
        if (ctx.entering === o.id) n.style.opacity = '0';
        else if (!stage.instant) ctx.jobs.push(stage.tween(n, [{ opacity: 0, transform: tr(b.x, b.y + 8) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 380, easing: EASE.out }));
        return n;
      });
      if (n.__w !== b.w) { n.style.width = `${b.w}px`; n.__w = b.w; }
      if (n.__text !== l.text) { n.replaceChildren(); stage.richInto(n, l.text); n.__text = l.text; }
      // 量这一行画出来多高，写回场景（估的按字数，折行、公式、小块都会让它更高）：量的和用的差得多就再排一遍
      const real = n.offsetHeight;
      if (real && Math.abs(real - lineH(l, cardW(o))) > 2) { l.mh = real; l.mw = cardW(o); stage.relayout(); }
      stage.flagPart(n, l, ctx);
      if (!same(n.__box, b)) moves.push({ part: l, node: n, from: n.__box, to: b, order: l.key });
    }
    return moves;
  },

  async enter(stage, o) {
    const bg = stage.decor(o.id, 'card');
    const box = stage.scene.objectBox(o.id);
    await stage.tween(bg, [{ opacity: 0, transform: `${tr(box.x, box.y + 12)}` }, { opacity: 1, transform: tr(box.x, box.y) }], { duration: 420, easing: EASE.out });
    await Promise.all(o.lines.map((l, i) => {
      const n = stage.nodeOf(l), b = stage.scene.partBox(l);
      return stage.tween(n, [{ opacity: 0, transform: tr(b.x, b.y + 8) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 380, delay: stagger(i, { step: 90 }), easing: EASE.out });
    }));
  },

  css: `
/* 题卡：白卡、一行一句；扣着的行是带「?」的横条 */
.st-card { position: absolute; left: 0; top: 0; border-radius: 18px; background: var(--st-card); box-shadow: 0 0 0 1px var(--st-line), 0 12px 28px -18px rgb(var(--shade-rgb, 25 45 40) / 0.45); }
.st-cline { position: absolute; left: 0; top: 0; box-sizing: border-box; padding: 6px 10px; border-radius: 10px; font: 18px/30px var(--sans, sans-serif); color: var(--st-ink); transition: background-color .3s, opacity .3s; }
.st-cline[data-paint] { background: color-mix(in srgb, var(--c) 12%, transparent); box-shadow: inset 3px 0 0 var(--c); }
.st-cline.is-glow { background: color-mix(in srgb, var(--st-gold) 14%, transparent); }
.st-cline.is-dim { opacity: .38; }
.st-cline.is-covered { color: transparent; background: color-mix(in srgb, var(--st-brand) 10%, var(--st-card)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--st-brand) 25%, transparent); }
.st-cline.is-covered > * { visibility: hidden; }
.st-cline.is-covered::before { content: "? 先想一想，到时候翻开"; position: absolute; inset: 0; display: flex; align-items: center; padding: 0 12px; color: color-mix(in srgb, var(--st-brand) 70%, transparent); font-size: 15px; }
.st-cline.is-tap { cursor: pointer; outline: 2px solid color-mix(in srgb, var(--st-brand) 40%, transparent); }
`,
};
