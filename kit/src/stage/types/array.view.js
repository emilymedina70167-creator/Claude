// 一排格子的画法（types/array.js 的画面那一半）：虚框和序号、格子、指针；跳格、交换、插入、改值几个专门的动作；学生拖格子。
// 每种东西的画法都照这个样子（types/views.js 注册）：
//   sync(stage, o, ctx) → 要挪的 [{ part, node, from, to }]（造 / 改节点；挪动由舞台统一演，连线先藏后画）
//   enter(stage, o)：刚造出来时怎么出场；choreo：自己指令的专门动作 (stage, c, fx, pre)；
//   drag(stage, part, peers, done)：学生拖（没有就不能拖）；rail(o, p)：连线画成横线还是拱弧
import { EASE, moveDuration, stagger, arcPoints } from '../motion.js';
import { CELL } from '../layout.js';
import { slotBox, ptrBoxes } from './array.js';

const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

export const arrayView = {
  sync(stage, o, ctx) {
    const sc = stage.scene;
    // 虚框和序号（格子挪走了它还在，看得出「原来在第几位」）
    for (let i = 1; i <= o.cells.length; i++) {
      stage.decor(o.id, `slot${i}`, () => {
        const g = el('div', 'st-slot', stage.layer);
        const s = slotBox(o, i);
        g.style.transform = tr(s.x, s.y);
        if (ctx.entering === o.id) g.style.opacity = '0';
        el('span', 'st-idx', g).textContent = String(i);
        return g;
      });
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
        c.dragged ? stage.moveNode(a, [{ transform: stage.nodeOf(a).style.transform }, { transform: tr(A2.x, A2.y) }], A2, { duration: 420, easing: EASE.spring }) : go(a, A || A2, A2, -1),
        go(b, B || B2, B2, 1),
      ]);
    },

    // 插入：这一格抬起来走弧线到新位置，中间的格子各让一格
    async move(stage, c, fx, pre) {
      const x = fx.cell;
      await stage.hideLinks([x, ...fx.moved]);
      const A = pre.boxes.get(stage.pid(x)), B = stage.scene.partBox(x);
      const others = stage.sync({ pre, only: fx.moved });
      await Promise.all([stage.moveNode(x, arcPoints(A || B, B, { dir: -1, lift: 0.35, min: 50, max: 120 }).map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), B, { duration: moveDuration(Math.abs((A?.x ?? B.x) - B.x)) + 200 }), others]);
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

  // 学生拖：按住一格左右拖，放到同一排的另一格上就换过去
  drag(stage, x, peers, done) {
    const n = stage.nodeOf(x);
    if (!n) return () => {};
    n.classList.add('is-drag');
    let start = null, base = null;
    const target = (px) => {
      let best = null, bd = Infinity;
      for (const p of peers) {
        if (p === x || p.row !== x.row || p.obj !== x.obj) continue;
        const d = Math.abs(stage.scene.partBox(p).x - px);
        if (d < bd) { bd = d; best = p; }
      }
      return bd < CELL * 0.75 ? best : null;
    };
    const down = (e) => { e.preventDefault(); n.setPointerCapture?.(e.pointerId); start = { x: e.clientX, y: e.clientY }; base = stage.scene.partBox(x); n.classList.add('is-hold'); };
    const move = (e) => {
      if (!start) return;
      const dx = (e.clientX - start.x) / stage.cam.s, dy = (e.clientY - start.y) / stage.cam.s;
      n.style.transform = `${tr(base.x + dx, base.y + dy * 0.35)} scale(1.08)`;
      const t = target(base.x + dx);
      peers.forEach((p) => stage.nodeOf(p)?.classList.toggle('is-over', p === t));
    };
    const up = (e) => {
      if (!start) return;
      const dx = (e.clientX - start.x) / stage.cam.s;
      start = null;
      n.classList.remove('is-hold');
      peers.forEach((p) => stage.nodeOf(p)?.classList.remove('is-over'));
      const t = target(base.x + dx);
      if (t) { done({ type: 'drag', a: { key: x.key, value: x.value, slot: x.slot }, b: { key: t.key, value: t.value, slot: t.slot } }, `swap ${x.obj}#${x.key} ${t.obj}#${t.key}`); return; }
      stage.tween(n, [{ transform: n.style.transform }, { transform: tr(base.x, base.y) }], { duration: 360, easing: EASE.spring });
    };
    n.addEventListener('pointerdown', down);
    n.addEventListener('pointermove', move);
    n.addEventListener('pointerup', up);
    n.addEventListener('pointercancel', up);
    return () => { n.classList.remove('is-drag', 'is-hold'); n.removeEventListener('pointerdown', down); n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up); n.removeEventListener('pointercancel', up); };
  },
};
