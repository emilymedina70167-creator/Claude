// 一排格子的画法（types/array.js 的画面那一半）：虚框和序号、格子、指针；跳格、交换、插入、改值几个专门的动作；学生拖格子。
// 每种东西的画法都照这个样子（types/views.js 注册）：
//   sync(stage, o, ctx) → 要挪的 [{ part, node, from, to }]（造 / 改节点；挪动由舞台统一演，连线先藏后画）
//   enter(stage, o)：刚造出来时怎么出场；choreo：自己指令的专门动作 (stage, c, fx, pre)；
//   dragSpec(stage, part, peers)：学生拖的时候这一格怎么跟着手、放下算什么（手指的事在 pointer.js；没有就不能拖）；rail(o, p)：连线画成横线还是拱弧
import { EASE, moveDuration, stagger, arcPoints } from '../motion.js';
import { CELL, GAP } from '../layout.js';
import { slotBox, ptrBoxes, rowY } from './array.js';
import { openParts, screenOf } from '../gesturedom.js';

const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

// —— 通用手势的把手（open a move 按住一张拖、open a edit 点一格写数；gesturedom.js 管手指；主线第二轮 A）——
// 正拎着哪一张（东西 id → key）：它紧挨着的两个空隙放下去还在原处，不当落点（不然刚拎起来就悬在上面、冒一句「还在原处」）
const HELD = new Map();
const STATE = ['is-drag', 'is-tap', 'is-press', 'is-over', 'is-drop', 'is-nodrop', 'is-slip', 'is-hold', 'is-lifted', 'is-glow', 'is-pick'];
// 拎起来：这一格复制一份跟着手走（不带 data-obj：排版不算它），原来的淡下去；放回去时恢复
function liftCell(stage, id, key) {
  const n = stage.nodes.get(`${id}:${key}`), box = n?.__box;
  if (!n || !box) return null;
  const g = n.cloneNode(true);
  g.removeAttribute('data-obj');
  g.classList.remove(...STATE);
  g.classList.add('st-g-ghost');
  g.style.transform = tr(box.x, box.y);
  g.style.opacity = '';
  stage.layer.appendChild(g);
  n.classList.add('is-lifted');
  HELD.set(id, key);
  return { el: g, box, restore: () => { if (HELD.get(id) === key) HELD.delete(id); stage.nodes.get(`${id}:${key}`)?.classList.remove('is-lifted'); } };
}
// 放下（裁判不拦的那一下）：真的那一张就停在手放开的地方，拎着的那一份拿掉；接着的 swap / move 从这里落位（choreo 看 __drop）
function landCell(stage, id, key, L) {
  const n = stage.nodes.get(`${id}:${key}`);
  if (n && L?.el) {
    n.getAnimations?.().forEach((a) => a.cancel());
    n.style.transform = String(L.el.style.transform).replace(/\s*scale\([^)]*\)/, '');
    n.__drop = true;
    n.classList.remove('is-lifted');
  }
  L?.el?.remove();
}
const dropped = (stage, x) => { const n = stage.nodeOf(x); if (!n?.__drop) return false; delete n.__drop; return true; };
// 一条线（没分开是整排；分开排着是一条泳道）上的空隙：每两张之间一个、最前最后各一个。before 是空隙后面那一格是第几格（最后是 null）
function gapGrips(stage, o) {
  const id = o.id;
  const out = [];
  const rows = [...new Set(o.cells.map((c) => c.row || 0))].sort((a, b) => a - b);
  for (const r of rows) {
    const line = o.cells.filter((c) => (c.row || 0) === r).sort((a, b) => a.slot - b.slot);
    const y = o.origin.y + rowY(r);
    for (let i = 0; i <= line.length; i++) {
      const prev = line[i - 1], next = line[i];
      const lx = prev ? slotBox(o, prev.slot).x + CELL : slotBox(o, next.slot).x - GAP - 30;
      const rx = next ? slotBox(o, next.slot).x : lx + GAP + 30;
      const box = { x: lx - 10, y, w: rx - lx + 20, h: CELL };
      const near = [prev?.key, next?.key];
      let n = null;
      out.push({
        key: `gap:${r}:${next ? next.slot : 'end'}`, cls: '',
        part: () => ({ gap: { row: r, before: next ? next.slot : null } }),
        node: () => n, box: () => box,
        // 正拎着的那一张两边的空隙：给一个空的框，手指挑落点时跳过它
        area: () => (HELD.has(id) && near.includes(HELD.get(id)) ? { x: 0, y: 0, w: 0, h: 0 } : screenOf(stage, box)),
        show(on) {
          if (on && !n) { n = el('div', 'st-gap', stage.layer); n.style.transform = tr((lx + rx) / 2 - 2, y + 6); n.style.height = `${CELL - 12}px`; } else if (!on && n) { n.remove(); n = null; }
        },
      });
    }
  }
  return out;
}

export const arrayView = {
  sync(stage, o, ctx) {
    const sc = stage.scene;
    // 虚框和序号（格子挪走了它还在，看得出「原来在第几位」）
    for (let i = 1; i <= o.cells.length; i++) {
      const s = slotBox(o, i);
      const g = stage.decor(o.id, `slot${i}`, () => {
        const g = el('div', 'st-slot', stage.layer);
        g.style.transform = tr(s.x, s.y);
        g.__box = s;
        if (ctx.entering === o.id) g.style.opacity = '0';
        el('span', 'st-idx', g).textContent = String(i);
        return g;
      });
      // 整排被推走了（下面的东西让地方、上面贴了一行字），虚框和序号跟着走。以前只在造出来时摆一次：牌下去了它们留在原地，
      // 画面量出来这一排「占」到了原来那里，又被往下推，一遍遍推出屏幕（主线第一轮 D1-10：split 以后整台缩成一小块也是它）
      if (!same(g.__box, s)) {
        const from = g.__box;
        g.__box = s;
        g.style.transform = tr(s.x, s.y);
        if (from && !stage.instant) stage.tween(g, [{ transform: tr(from.x, from.y) }, { transform: tr(s.x, s.y) }], { duration: 480 });
      }
    }
    const moves = [];
    for (const x of o.cells) {
      const b = sc.partBox(x);
      const n = stage.partNode(x, () => {
        const n = el('div', 'st-cell', stage.layer);
        el('span', 'st-v', n).textContent = x.value;
        n.style.transform = tr(b.x, b.y);
        n.__box = b;
        if (ctx.entering === o.id) n.style.opacity = '0';
        return n;
      });
      const v = n.querySelector('.st-v');
      if (v.textContent !== x.value) v.textContent = x.value;
      n.classList.toggle('is-blank', x.value === ''); // 空格子（_）：一个空位，没有牌
      stage.flagPart(n, x, ctx);
      if (!same(n.__box, b) && (!ctx.only || ctx.only.includes(x))) moves.push({ part: x, node: n, from: n.__box, to: b, order: ctx.cmd === 'split' || ctx.cmd === 'merge' ? x.row || x.slot : x.slot, duration: ctx.cmd === 'split' || ctx.cmd === 'merge' ? 640 : null });
    }
    // 指针：格子下面一个小箭头和名字
    const live = new Set();
    for (const pb of ptrBoxes(o)) {
      const k = `ptr:${pb.name}`;
      live.add(k);
      const n = stage.decor(o.id, k, () => {
        const n = el('div', 'st-ptr', stage.layer);
        n.innerHTML = '<i>▲</i><span></span>';
        n.querySelector('span').textContent = pb.name;
        n.style.transform = tr(pb.x, pb.y);
        n.__box = pb;
        ctx.jobs.push(stage.tween(n, [{ opacity: 0, transform: tr(pb.x, pb.y + 10) }, { opacity: 1, transform: tr(pb.x, pb.y) }], { duration: 320, easing: EASE.out }));
        return n;
      });
      if (!same(n.__box, pb)) {
        const from = n.__box;
        n.__box = pb;
        ctx.jobs.push(stage.tween(n, [{ transform: tr(from.x, from.y) }, { transform: tr(pb.x, pb.y) }], { duration: moveDuration(Math.abs(from.x - pb.x)), easing: EASE.move }));
      }
    }
    stage.dropDecor(o.id, (k) => k.startsWith('ptr:') && !live.has(k));
    return moves;
  },

  rail(o, p) { return !!p.row; },

  // 一格一格落下来（从左到右），序号跟着淡进来
  async enter(stage, o) {
    const ghosts = o.cells.map((_, i) => stage.decor(o.id, `slot${i + 1}`));
    ghosts.forEach((g, i) => g && stage.tween(g, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: stagger(i, { step: 40 }) }));
    await Promise.all(o.cells.map((x, i) => {
      const n = stage.nodeOf(x), b = stage.scene.partBox(x);
      return stage.tween(n, [{ opacity: 0, transform: tr(b.x, b.y - 26, 0.9) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 520, delay: stagger(i, { step: 45 }), easing: EASE.spring });
    }));
  },

  choreo: {
    // 一个小点一格一格跳过去，头上数着 1、2、3……；落地以后舞台画上弧（和贴在弧上的字）
    async hop(stage, c, fx) {
      const { from, to, color } = fx;
      const o = stage.scene.objects.get(from.obj);
      const top = (slot) => { const s = slotBox(o, slot); const b = stage.scene.partBox(from); return { x: s.x + CELL / 2 - 8, y: b.y - 22 }; };
      const dot = el('div', 'st-hopper', stage.layer);
      dot.dataset.paint = color;
      let at = top(from.slot);
      dot.style.transform = tr(at.x, at.y);
      await stage.tween(dot, [{ opacity: 0, transform: tr(at.x, at.y + 10, 0.4) }, { opacity: 1, transform: tr(at.x, at.y) }], { duration: 260, easing: EASE.spring });
      const step = to.slot > from.slot ? 1 : -1;
      let k = 0;
      for (let s = from.slot + step; step > 0 ? s <= to.slot : s >= to.slot; s += step) {
        const next = top(s);
        await stage.tween(dot, arcPoints(at, next, { lift: 0.5, min: 18, max: 34 }).map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), { duration: 230, easing: 'linear' });
        k++;
        if (!stage.instant) {
          const n = el('div', 'st-count', stage.layer);
          n.dataset.paint = color;
          n.textContent = String(k);
          stage.tween(n, [{ opacity: 0, transform: tr(next.x - 4, next.y - 16) }, { opacity: 1, transform: tr(next.x - 4, next.y - 26), offset: 0.3 }, { opacity: 0, transform: tr(next.x - 4, next.y - 34) }], { duration: 900, easing: EASE.out }).then(() => n.remove());
        }
        at = next;
      }
      await stage.tween(dot, [{ opacity: 1, transform: tr(at.x, at.y) }, { opacity: 0, transform: tr(at.x, at.y + 18, 0.5) }], { duration: 220, easing: EASE.in });
      dot.remove();
    },

    // 交换：两格各走一道弧换位置（一个从上面过、一个从下面过）；学生拖过去的那一格从手放开的地方直接落位
    async swap(stage, c, fx, pre) {
      const { a, b } = fx;
      await stage.hideLinks([a, b]);
      const A = pre.boxes.get(stage.pid(a)), B = pre.boxes.get(stage.pid(b));
      const A2 = stage.scene.partBox(a), B2 = stage.scene.partBox(b);
      const d = moveDuration(Math.abs((A?.x ?? 0) - (B?.x ?? 0))) + 120;
      const go = (x, p0, p1, dir) => stage.moveNode(x, arcPoints(p0, p1, { dir, lift: 0.42, min: 40, max: 110 }).map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), p1, { duration: d });
      await Promise.all([
        c.dragged || dropped(stage, a) ? stage.moveNode(a, [{ transform: stage.nodeOf(a).style.transform }, { transform: tr(A2.x, A2.y) }], A2, { duration: 420, easing: EASE.spring }) : go(a, A || A2, A2, -1),
        go(b, B || B2, B2, 1),
      ]);
    },

    // 插入：这一格抬起来走弧线到新位置，中间的格子各让一格
    async move(stage, c, fx, pre) {
      const x = fx.cell;
      await stage.hideLinks([x, ...fx.moved]);
      const A = pre.boxes.get(stage.pid(x)), B = stage.scene.partBox(x);
      const others = stage.sync({ pre, only: fx.moved });
      // 学生拖过去的（open a move 放在两张之间）：从手放开的地方直接落位；老师演的走弧线
      const mine = dropped(stage, x)
        ? stage.moveNode(x, [{ transform: stage.nodeOf(x).style.transform }, { transform: tr(B.x, B.y) }], B, { duration: 420, easing: EASE.spring })
        : stage.moveNode(x, arcPoints(A || B, B, { dir: -1, lift: 0.35, min: 50, max: 120 }).map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), B, { duration: moveDuration(Math.abs((A?.x ?? B.x) - B.x)) + 200 });
      await Promise.all([mine, others]);
    },

    async write(stage, c, fx) {
      const n = stage.nodeOf(fx.cell);
      if (!n?.__box) return;
      const b = n.__box;
      await stage.tween(n, [{ transform: tr(b.x, b.y) }, { transform: `${tr(b.x, b.y)} scale(0.82)`, opacity: 0.4 }], { duration: 160, easing: EASE.in });
      n.querySelector('.st-v').textContent = fx.cell.value;
      await stage.tween(n, [{ transform: `${tr(b.x, b.y)} scale(0.82)`, opacity: 0.4 }, { transform: tr(b.x, b.y), opacity: 1 }], { duration: 320, easing: EASE.spring });
    },
  },

  // 学生拖（手指的事在 pointer.js）：按住一格跟着手走（左右跟着、上下只跟一点，看得出还在这一排），
  // 靠近哪一格就吸到哪一格（亮一圈），放下就和它换；哪一格都不靠近就滑回原处。
  // 部件、节点都按 key 现取：拖之前舞台可能刚重放过、换过位置
  dragSpec(stage, x, peers) {
    const id = x.obj, key = x.key, row = x.row;
    const keys = peers.filter((p) => p.obj === id && p.key !== key).map((p) => p.key);
    const node = (k = key) => stage.nodes.get(`${id}:${k}`);
    const part = (k = key) => stage.scene.partOf(id, k);
    let base = null, grab = null, over = null;
    const near = (cx) => {
      let best = null, bd = Infinity;
      for (const k of keys) {
        const p = part(k);
        if (!p || p.row !== part()?.row) continue;
        const b = stage.scene.partBox(p);
        const d = Math.abs(b.x + b.w / 2 - cx);
        if (d < bd) { bd = d; best = k; }
      }
      return bd < CELL * 0.8 ? best : null;
    };
    const light = (k) => { if (over === k) return; if (over != null) node(over)?.classList.remove('is-over'); over = k; if (k != null) node(k)?.classList.add('is-over'); };
    return {
      // 空格子拿不起来（没有牌）：不给手指按的地方；别的牌照旧能拖进来（和它对调）
      rect() { return part()?.value === '' ? { x: 0, y: 0, w: 0, h: 0 } : stage.screenRect(node()); },
      start(w) {
        const p = part(), n = node();
        if (!p || !n) throw new Error('这一格不在了');
        base = stage.scene.partBox(p);
        grab = { x: w.x - base.x, y: w.y - base.y };
        n.getAnimations?.().forEach((a) => a.cancel());
        n.classList.add('is-hold');
      },
      move(w) {
        const n = node();
        if (!n || !base) return;
        const x0 = w.x - grab.x, y0 = base.y + (w.y - grab.y - base.y) * 0.35;
        n.style.transform = `${tr(x0, y0)} scale(1.08)`;
        light(near(x0 + base.w / 2));
      },
      drop(w) {
        const t = over;
        light(null);
        node()?.classList.remove('is-hold');
        if (t == null) return null;
        const a = part(), b = part(t);
        if (!a || !b) return null;
        void w; void row;
        return { act: { type: 'drag', a: { key: a.key, value: a.value, slot: a.slot }, b: { key: b.key, value: b.value, slot: b.slot } }, src: `swap ${id}#${a.key} ${id}#${b.key}` };
      },
      cancel() {
        light(null);
        const n = node();
        if (!n || !base) return;
        n.classList.remove('is-hold');
        stage.tween(n, [{ transform: n.style.transform }, { transform: tr(base.x, base.y) }], { duration: 360, easing: EASE.spring });
      },
    };
  },
  // 通用手势抓哪儿（规则文件 array.rules.js 的手势表）：一格（move 按住拖起来、当落点；edit 点它写数）、两格之间的空隙（move 的落点）
  grips: {
    cell: (stage, o, e, { role } = {}) => openParts(stage, e, [...o.cells].sort((a, b) => a.slot - b.slot))
      // 空格子拿不起来；当落点、点它写数都行
      .filter((x) => x.value !== '' || role === 'to' || e.action === 'edit')
      .map((x) => ({
        key: `cell:${x.key}`,
        part: () => stage.scene.partOf(o.id, x.key),
        node: () => stage.nodes.get(`${o.id}:${x.key}`),
        lift: () => liftCell(stage, o.id, x.key),
        land: (L) => landCell(stage, o.id, x.key, L),
      })),
    gap: (stage, o) => gapGrips(stage, o),
  },

  css: `
/* 空格子（array h = _ 49 38）：一个空位。开了 edit 的点它写数，开了 move 的把牌拖进来 */
.st-cell.is-blank { box-sizing: border-box; background: transparent; border: 1.5px dashed rgb(var(--chalk-rgb, 27 34 32) / 0.24); }
.st-cell.is-blank:not(.is-glow):not(.is-over) { box-shadow: none; }
.st-cell.is-blank[data-paint] { border-color: var(--c); background: color-mix(in srgb, var(--c) 8%, transparent); }
.st-cell.is-editing { box-shadow: 0 0 0 2px var(--st-brand), 0 0 0 7px color-mix(in srgb, var(--st-brand) 14%, transparent); }
/* 两格之间的空隙（open a move 拖着的时候才画）：能放的一道淡淡的竖线，悬上去变实、变粗 */
.st-gap { position: absolute; left: 0; top: 0; width: 4px; border-radius: 2px; background: var(--st-brand); opacity: 0; pointer-events: none; transition: opacity .15s, scale .15s; }
.st-gap.is-drop { opacity: .2; }
.st-gap.is-over { opacity: 1; scale: 1.6 1; }
.st-gap.is-nodrop { opacity: .45; background: var(--st-red); }
`,
};
