// 时间轴的画法（types/timeline.js 的画面那一半）：一条横轴、等距的停靠点（now 那一个一道竖线），
// 上面一层层的事件条、事件点，下面的小人。小人、条能动的那一头是把手：学生按住拖到一个停靠点上（通用手势 gesturedom.js）。
import { EASE } from '../motion.js';
import { TL, stopX, stepOf, rowsY } from './timeline.js';
import { openParts, screenOf } from '../gesturedom.js';

const tr = (x, y) => `translate(${x}px, ${y}px)`;
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

// 不属于部件的东西（轴、刻度、now 的竖线）：摆好，位置变了跟着走
function fix(stage, n, box, ctx, entering) {
  if (same(n.__box, box)) return;
  const was = n.__box;
  n.__box = { ...box };
  n.style.width = `${box.w}px`;
  n.style.height = `${box.h}px`;
  if (was && !stage.instant && !entering) ctx.jobs.push(stage.tween(n, [{ transform: tr(was.x, was.y) }, { transform: tr(box.x, box.y) }], { duration: 420, easing: EASE.move }));
  else n.style.transform = tr(box.x, box.y);
}

export const timelineView = {
  sync(stage, o, ctx) {
    const sc = stage.scene;
    const entering = ctx.entering === o.id;
    const R = rowsY(o);
    const n = o.stops.length;
    const mk = (key, cls, box, init) => {
      const d = stage.decor(o.id, key, () => { const x = el('div', cls, stage.layer); if (entering) x.style.opacity = '0'; init?.(x); return x; });
      fix(stage, d, box, ctx, entering);
      return d;
    };
    mk('axis', 'tl-axis', { x: stopX(o, 1) - 18, y: R.axis - 1.5, w: (n - 1) * stepOf(o) + 36, h: 3 });
    o.stops.forEach((name, i) => {
      const d = mk(`tick:${i + 1}`, 'tl-tick', { x: stopX(o, i + 1) - stepOf(o) / 2, y: R.axis - 7, w: stepOf(o), h: TL.AXIS + 10 }, (x) => { el('i', '', x); el('span', '', x); });
      if (d.lastChild.textContent !== name) d.lastChild.textContent = name;
      d.classList.toggle('is-now', name === o.now);
    });
    stage.dropDecor(o.id, (k) => k.startsWith('tick:') && Number(k.slice(5)) > n);
    // now 的竖线：从最上面一层条画到轴
    const nowAt = o.now ? o.stops.indexOf(o.now) + 1 : 0;
    if (nowAt) mk('now', 'tl-now', { x: stopX(o, nowAt) - 1, y: o.origin.y - 6, w: 2, h: R.axis - o.origin.y + 6 });
    else stage.dropDecor(o.id, (k) => k === 'now');
    const moves = [];
    for (const it of o.items) {
      const b = sc.partBox(it);
      let made = false;
      const node = stage.partNode(it, () => {
        made = true;
        const d = el('div', `tl-item tl-${it.kind}`, stage.layer);
        if (it.kind === 'stand') { el('i', 'tl-head', d); el('i', 'tl-body', d); el('span', 'tl-name', d); }
        if (it.kind === 'point') { el('span', 'tl-text', d); el('i', 'tl-dot', d); }
        if (it.kind === 'bar') { el('span', 'tl-text', d); if (it.startDial) el('i', 'tl-end', d).dataset.side = 'from'; if (it.endDial) el('i', 'tl-end', d).dataset.side = 'to'; }
        d.style.transform = tr(b.x, b.y);
        d.style.width = `${b.w}px`;
        d.style.height = `${b.h}px`;
        d.__box = b;
        if (entering) d.style.opacity = '0';
        else if (!stage.instant) ctx.jobs.push(stage.tween(d, [{ opacity: 0, transform: tr(b.x, b.y + 8) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 360, easing: EASE.out }));
        return d;
      });
      const text = node.querySelector('.tl-text, .tl-name');
      const want = it.kind === 'stand' ? it.name : it.label;
      if (text && text.textContent !== want) text.textContent = want;
      stage.flagPart(node, it, ctx);
      if (made || same(node.__box, b)) continue;
      // 条伸长缩短：宽度跟着变（CSS 过渡），位置照舞台的挪法
      node.style.width = `${b.w}px`;
      node.style.height = `${b.h}px`;
      moves.push({ part: it, node, from: node.__box, to: b, order: 0, duration: 420 });
    }
    return moves;
  },

  async enter(stage, o) {
    const jobs = [];
    for (const [, d] of stage.decors.get(o.id) || []) jobs.push(stage.tween(d, [{ opacity: 0 }, { opacity: 1 }], { duration: 360 }));
    await Promise.all(jobs);
  },

  // 通用手势抓哪儿（规则文件 timeline.rules.js 的手势表）：小人（按住拖）、事件条能动的那一头（按住拖）、停靠点（落点）
  grips: {
    stand: (stage, o, e) => openParts(stage, e, o.items).filter((x) => x.kind === 'stand').map((x) => ({
      key: `stand:${x.name}`,
      part: () => ({ stand: x.name }),
      node: () => stage.nodes.get(`${o.id}:${x.name}`),
    })),
    end: (stage, o, e) => openParts(stage, e, o.items).filter((x) => x.kind === 'bar').flatMap((x) => [x.startDial && 'from', x.endDial && 'to'].filter(Boolean).map((side) => ({
      key: `end:${x.name}:${side}`,
      part: () => ({ end: x.name, side }),
      node: () => stage.nodes.get(`${o.id}:${x.name}`)?.querySelector(`.tl-end[data-side="${side}"]`) || null,
      // 把手画出来只有 22 见方：手指的点区放到 44
      rect: () => { const h = stage.nodes.get(`${o.id}:${x.name}`)?.querySelector(`.tl-end[data-side="${side}"]`); const r = h && stage.screenRect(h); return r ? { x: r.x + r.w / 2 - 22, y: r.y + r.h / 2 - 22, w: 44, h: 44 } : null; },
    }))),
    // 落点：每个停靠点一竖条（从最上面一层到小人脚下）；拖着的时候那一个刻度亮起来
    stop: (stage, o) => o.stops.map((name, i) => {
      const box = () => { const R = rowsY(o); return { x: stopX(o, i + 1) - stepOf(o) / 2, y: o.origin.y - 10, w: stepOf(o), h: R.bottom - o.origin.y + 20 }; };
      return {
        key: `stop:${i + 1}`,
        part: () => ({ stop: i + 1 }),
        node: () => stage.decor(o.id, `tick:${i + 1}`),
        box,
        rect: () => screenOf(stage, box()),
      };
    }),
  },

  css: `
/* 时间轴：一条横线、等距的刻度；now 那一个粗一点、带一道竖的虚线 */
.tl-axis { position: absolute; left: 0; top: 0; border-radius: 2px; background: rgb(var(--chalk-rgb, 27 34 32) / 0.42); }
.tl-tick { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; font: 500 15px/1.2 var(--sans, sans-serif); color: var(--st-muted); }
.tl-tick > i { width: 2px; height: 12px; border-radius: 1px; background: rgb(var(--chalk-rgb, 27 34 32) / 0.42); transition: scale .15s, background-color .15s; }
.tl-tick.is-now { color: var(--st-ink); font-weight: 700; }
.tl-tick.is-now > i { background: var(--st-ink); width: 3px; }
/* 拖着的时候：能落的刻度亮一点，悬着的那一个最亮 */
.tl-tick.is-drop > i { background: var(--st-brand); scale: 1.4 1.5; }
.tl-tick.is-over { color: var(--st-brand); font-weight: 700; }
.tl-tick.is-over > i { scale: 2.2 2; }
.tl-now { position: absolute; left: 0; top: 0; background: repeating-linear-gradient(to bottom, rgb(var(--chalk-rgb, 27 34 32) / 0.5) 0 5px, transparent 5px 10px); pointer-events: none; }
.tl-item { position: absolute; left: 0; top: 0; box-sizing: border-box; transition: width .4s; }
/* 小人：一个圆头、一截身子，下面写名字 */
.tl-stand { display: flex; flex-direction: column; align-items: center; }
.tl-stand .tl-head { width: 16px; height: 16px; border-radius: 50%; background: var(--st-brand); }
.tl-stand .tl-body { width: 22px; height: 18px; margin-top: 2px; border-radius: 10px 10px 4px 4px; background: var(--st-brand); }
.tl-stand .tl-name { margin-top: 2px; font: 600 13px/1.1 var(--sans, sans-serif); color: var(--st-brand); }
.tl-stand.is-drag, .tl-stand.is-hold { cursor: grab; touch-action: none; }
.tl-stand.is-glow .tl-head, .tl-stand.is-glow .tl-body { box-shadow: 0 0 0 3px color-mix(in srgb, var(--st-gold) 60%, transparent); }
.tl-stand.is-dim { opacity: .35; }
.tl-stand.is-lifted { opacity: .3; }
/* 事件点：字在上、点在下（落在轴上方） */
.tl-point { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 3px; }
.tl-point .tl-text { white-space: nowrap; font: 600 14px/1 var(--sans, sans-serif); color: var(--c, var(--st-red)); }
.tl-point .tl-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--c, var(--st-red)); }
.tl-point.is-glow .tl-dot { box-shadow: 0 0 0 4px color-mix(in srgb, var(--st-gold) 55%, transparent); }
.tl-point.is-dim { opacity: .35; }
/* 事件条：一条圆角的色带，字在里面；能动的那一头一个圆把手 */
.tl-bar { display: flex; align-items: center; justify-content: center; padding: 0 16px; border-radius: 15px; background: color-mix(in srgb, var(--c, var(--st-g1)) 20%, var(--st-card)); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c, var(--st-g1)) 65%, transparent); }
.tl-bar .tl-text { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: 600 14px/1 var(--sans, sans-serif); color: var(--st-ink); }
.tl-bar.is-glow { box-shadow: inset 0 0 0 2px var(--st-gold), 0 0 0 5px color-mix(in srgb, var(--st-gold) 22%, transparent); }
.tl-bar.is-dim { opacity: .35; }
.tl-end { position: absolute; top: 50%; width: 22px; height: 22px; margin-top: -11px; border-radius: 50%; background: var(--st-card); box-shadow: 0 0 0 2.5px var(--c, var(--st-g1)), 0 4px 10px -4px rgb(var(--shade-rgb, 25 45 40) / 0.5); }
.tl-end[data-side="from"] { left: -1px; }
.tl-end[data-side="to"] { right: -1px; }
.tl-end.is-drag, .tl-end.is-hold { cursor: ew-resize; touch-action: none; }
.tl-end.is-press { scale: 1.15; }
`,
};
