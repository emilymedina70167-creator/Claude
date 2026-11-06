// 图的画法（types/graph.js 的画面那一半）：圆的结点、边（画在 stage.under：线、箭头、点亮时的金色底），权写在边中间的小牌子上
// （这个小牌子就是边这个部件的节点：点它、染它、它跟着变），结点旁边的数（dist、入度）和访问号；
// 松弛（小点带着「4 + 2」沿边过去，比 B 的小就换数）、沿边走、拓扑排序拿掉一个（它的边淡掉，它沿弧落到下面的序列里）。
import { EASE, stagger } from '../motion.js';
import { GNODE, nodeCenter, edgeGeom, edgePoints, partBox, spots, weightWidth } from './graph.js';
import { el, svg, tr, same, centerOf, ensureCss, Ring, setOrder, setTag, sizeValue, arc, NODE_CSS } from './node.view.js';

const R = GNODE / 2;
const nodeIn = (o, k) => o.nodes.find((n) => n.key === k);
const indeg = (o, k) => o.edges.filter((e) => !e.gone && (o.directed ? e.b === k : e.a === k || e.b === k)).length;

function edgeEl(stage, o, e, hidden) {
  const g = svg('g', { class: 'gr-e' }, stage.under);
  svg('path', { class: 'gr-halo' }, g);
  svg('path', { class: 'gr-line' }, g);
  if (o.directed) svg('path', { class: 'gr-arrow' }, g);
  if (hidden) g.style.opacity = '0';
  return g;
}
function shapeEdge(g, o, e) {
  const geo = edgeGeom(o, e);
  if (g.__d === geo.d) return geo;
  g.__d = geo.d;
  g.children[0].setAttribute('d', geo.d);
  g.children[1].setAttribute('d', geo.d);
  if (geo.arrow) g.children[2].setAttribute('d', geo.arrow);
  return geo;
}
function styleEdge(g, e) {
  if (e.paint) g.dataset.paint = e.paint; else delete g.dataset.paint;
  g.classList.toggle('is-glow', !!e.glow);
  g.classList.toggle('is-dim', !!e.dim);
}
// 边的部件节点：有权就是写着权的小牌子，没权就是一块看不见、点得到的地方（点着问「选哪条边」时用）
function weightEl(stage, e, b, hidden) {
  const n = el('div', e.w != null ? 'gr-w' : 'gr-hit', stage.layer);
  if (e.w != null) { el('span', 'gr-wv', n).textContent = e.w; n.style.width = `${weightWidth(e.w)}px`; }
  n.style.transform = tr(b.x, b.y);
  n.__box = b;
  if (hidden) n.style.opacity = '0';
  return n;
}
function nodeEl(stage, p, b, hidden) {
  const n = el('div', 'st-cell gr-node', stage.layer);
  const v = el('span', 'st-v', n);
  v.textContent = p.key;
  sizeValue(v, p.key);
  n.style.transform = tr(b.x, b.y);
  n.__box = b;
  if (hidden) n.style.opacity = '0';
  return n;
}
const place = (child, d) => { if (child) { child.style.left = `${R + d.dx}px`; child.style.top = `${R + d.dy}px`; } };

export const graphView = {
  sync(stage, o, ctx) {
    ensureCss('graph', graphView.css);
    const sc = stage.scene;
    const entering = ctx.entering === o.id;
    const animate = !entering && ctx.cmd !== 'visit' && ctx.cmd !== 'relax';
    const moves = [];
    for (const p of o.nodes) {
      const b = sc.partBox(p);
      let made = false;
      const n = stage.partNode(p, () => { made = true; return nodeEl(stage, p, b, entering); });
      stage.flagPart(n, p, ctx);
      const taken = o.taken.includes(p.key);
      n.classList.toggle('is-taken', taken);
      // 旁边的数：自己写的优先；开着 deg 就是入度（拿掉的不标）
      const tag = p.tag ?? (o.deg && !taken ? `${o.directed ? '入' : '度'} ${indeg(o, p.key)}` : null);
      const j1 = setTag(stage, n, tag, { animate: animate && !made, auto: p.tag == null });
      const j2 = setOrder(stage, n, p.order, { pop: animate && !made });
      if (j1) ctx.jobs.push(j1);
      if (j2) ctx.jobs.push(j2);
      const sp = spots(o, p.key);
      place(n.querySelector(':scope > .nv-tag:not(.is-gone)'), sp.tag);
      place(n.querySelector(':scope > .nv-ord:not(.is-gone)'), sp.ord);
      if (!made && !same(n.__box, b)) moves.push({ part: p, node: n, from: n.__box, to: b, order: 0, duration: 700 });
    }
    const want = new Set();
    for (const e of o.edges) {
      if (e.gone) continue;
      const k = `e:${e.key}`;
      want.add(k);
      const g = stage.decor(o.id, k, () => edgeEl(stage, o, e, entering));
      shapeEdge(g, o, e);
      styleEdge(g, e);
      const b = sc.partBox(e);
      const w = stage.partNode(e, () => weightEl(stage, e, b, entering));
      stage.flagPart(w, e, ctx);
      if (!same(w.__box, b)) { w.__box = b; w.style.transform = tr(b.x, b.y); }
    }
    stage.dropDecor(o.id, (k) => k.startsWith('e:') && !want.has(k));
    // 拿掉的结点排在下面：一道浅浅的槽托着它们
    if (o.taken.length) {
      const row = stage.decor(o.id, 'row', () => {
        const r = el('div', 'gr-row');
        stage.layer.prepend(r);
        if (!stage.instant) ctx.jobs.push(stage.tween(r, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 500 }));
        return r;
      });
      const first = nodeCenter(o, o.taken[0]), last = nodeCenter(o, o.taken.at(-1));
      row.style.transform = tr(first.x - R - 10, first.y - R - 10);
      row.style.width = `${last.x - first.x + GNODE + 20}px`;
    } else stage.dropDecor(o.id, (k) => k === 'row');
    return moves;
  },

  // 结点一个个弹出来，边从一头画到另一头，权的牌子最后淡进来
  async enter(stage, o) {
    const jobs = [];
    const at = new Map(o.nodes.map((n, i) => [n.key, i]));
    o.nodes.forEach((p, i) => {
      const n = stage.nodeOf(p), b = n?.__box;
      if (!n) return;
      jobs.push(stage.tween(n, [{ opacity: 0, transform: tr(b.x, b.y, 0.4) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 480, delay: stagger(i, { step: 70, max: 700 }), easing: EASE.spring }));
    });
    const base = Math.min(700, o.nodes.length * 70) + 120;
    o.edges.forEach((e, i) => {
      const g = stage.decor(o.id, `e:${e.key}`);
      if (!g) return;
      const line = g.children[1], halo = g.children[0];
      const len = line.getTotalLength?.() || 200;
      const delay = Math.max(at.get(e.a), at.get(e.b)) * 40 + base + stagger(i, { step: 50, max: 600 });
      g.style.opacity = '';
      for (const p of [line, halo]) { p.style.strokeDasharray = `${len}`; p.style.strokeDashoffset = `${len}`; }
      const arrow = g.children[2];
      if (arrow) arrow.style.opacity = '0';
      jobs.push(stage.tween(line, [{ strokeDashoffset: `${len}` }, { strokeDashoffset: '0' }], { duration: 420, delay, easing: EASE.out }).then(() => {
        for (const p of [line, halo]) { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }
        return arrow && stage.tween(arrow, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      }));
      const w = stage.nodeOf(e);
      if (w) jobs.push(stage.tween(w, [{ opacity: 0, transform: tr(w.__box.x, w.__box.y, 0.6) }, { opacity: 1, transform: tr(w.__box.x, w.__box.y) }], { duration: 320, delay: delay + 300, easing: EASE.out }));
    });
    await Promise.all(jobs);
  },

  choreo: {
    // 松弛：边亮起来，一个小牌子带着「A 的数 + 权」从 A 沿边走到 B；比 B 的小，B 旁边的数换成它；不比它小，牌子上写「≥」淡掉
    async relax(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      const g = stage.decor(o.id, `e:${fx.edge.key}`);
      g?.classList.add('is-hot');
      // 牌子贴着边走：从 A 的边上出发，停在 B 跟前（不压着 B 和它旁边的数）
      const all = edgePoints(o, fx.edge, fx.from, 32);
      const pts = all.filter((p) => p.t >= 0.2 && p.t <= 0.68).map((p, i, a) => ({ ...p, t: i / (a.length - 1) }));
      const pill = el('div', 'gr-carry', stage.layer);
      pill.textContent = `${fx.dA} + ${fx.w}`;
      let w = pill.offsetWidth || 70, h = pill.offsetHeight || 30;
      const at = (p, s = 1) => tr(p.x - w / 2, p.y - h / 2, s);
      await stage.tween(pill, [{ opacity: 0, transform: at(pts[0], 0.6) }, { opacity: 1, transform: at(pts[0]) }], { duration: 260, easing: EASE.out });
      await stage.wait(260);
      await stage.tween(pill, pts.map((p) => ({ transform: at(p), offset: p.t })), { duration: 900, easing: EASE.move });
      const B = stage.nodes.get(`${o.id}:${fx.to}`);
      pill.textContent = `${fx.alt} ${fx.improved ? '<' : '≥'} ${fx.before}`;
      w = pill.offsetWidth || w;
      pill.classList.toggle('is-good', fx.improved);
      pill.classList.toggle('is-bad', !fx.improved);
      const end = pts.at(-1);
      if (fx.improved) {
        await stage.tween(pill, [{ transform: at(end, 1.12) }, { transform: at(end) }], { duration: 300, easing: EASE.spring });
        await stage.wait(420);
        if (B) { const j = setTag(stage, B, nodeIn(o, fx.to).tag, { animate: true }); place(B.querySelector(':scope > .nv-tag:not(.is-gone)'), spots(o, fx.to).tag); await j; }
        stage.pulse(nodeIn(o, fx.to));
      } else {
        await stage.tween(pill, [{ transform: at(end) }, { transform: `${at(end)} translateX(-6px)` }, { transform: `${at(end)} translateX(6px)` }, { transform: at(end) }], { duration: 360 });
        await stage.wait(500);
      }
      await stage.tween(pill, [{ opacity: 1, transform: at(end) }, { opacity: 0, transform: at({ ...end, y: end.y - 8 }) }], { duration: 240, easing: EASE.in });
      pill.remove();
      g?.classList.remove('is-hot');
    },
    // 访问：和上一个访问的有边，圈沿边走过去；不相邻（BFS 一层一层）就在这个结点上亮起来；号码弹出来
    async visit(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      const box = (k) => stage.nodes.get(`${o.id}:${k}`)?.__box;
      const edgeOf = (a, b) => o.edges.find((e) => !e.gone && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
      let ring = null, prev = fx.from;
      for (const k of fx.keys) {
        const e = prev != null && edgeOf(prev, k);
        if (e) {
          if (!ring) { ring = new Ring(stage, box(prev)); await ring.show(); }
          await ring.along(edgePoints(o, e, prev));
        } else { if (ring) ring.out(); ring = new Ring(stage, box(k)); await ring.show(); }
        const n = stage.nodes.get(`${o.id}:${k}`);
        const j = setOrder(stage, n, nodeIn(o, k).order, { pop: true });
        place(n.querySelector(':scope > .nv-ord:not(.is-gone)'), spots(o, k).ord);
        await j;
        prev = k;
      }
      await stage.wait(240);
      await ring?.out();
    },
    async walk(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      const edgeOf = (a, b) => o.edges.find((e) => !e.gone && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
      const ring = new Ring(stage, stage.nodes.get(`${o.id}:${fx.path[0]}`).__box);
      await ring.show();
      for (let i = 1; i < fx.path.length; i++) {
        const e = edgeOf(fx.path[i - 1], fx.path[i]);
        const eg = stage.decor(o.id, `e:${e.key}`);
        eg?.classList.add('is-hot');
        await ring.along(edgePoints(o, e, fx.path[i - 1]));
        eg?.classList.remove('is-hot');
        await stage.pulse(nodeIn(o, fx.path[i]));
      }
      await stage.wait(200);
      await ring.out();
    },
    // 拿掉一个结点：它连着的边和权一起淡掉，它自己沿一道弧落到下面的序列里
    async take(stage, c, fx, pre) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      const p = nodeIn(o, fx.key);
      const n = stage.nodeOf(p);
      await stage.pulse(p);
      const from = pre.boxes.get(`${o.id}:${fx.key}`) || n.__box, to = partBox(o, p);
      const pts = arc(centerOf(from), centerOf(to), from.x <= to.x ? 1 : -1, 0.22);
      const fly = stage.moveNode(p, pts.map((q) => ({ transform: tr(q.x - R, q.y - R), offset: q.t })), to, { duration: 900, easing: EASE.move });
      await Promise.all([fly, stage.sync({ pre, cmd: 'take', fx })]);
    },
    // 闪一下：边的线也跟着亮一下
    async pulse(stage, c, fx) {
      const o = fx.parts[0] && stage.scene.objects.get(fx.parts[0].obj);
      for (const p of fx.parts) if (p.kind === 'edge') { const g = stage.decor(o.id, `e:${p.key}`); if (g && !stage.instant) { g.classList.add('is-hot'); setTimeout(() => g.classList.remove('is-hot'), stage.dur(520)); } }
      await Promise.all(fx.parts.map((x, i) => stage.pulse(x, stagger(i, { step: 60 }))));
    },
    // 比较：结点比旁边的数（「B 4 < C 7」），边比权（「A–C 2 < A–B 4」）
    async compare(stage, c, fx) {
      if (stage.instant) return;
      const text = (p) => (p.kind === 'edge' ? `${p.label}${p.w != null ? ` ${p.w}` : ''}` : `${p.key}${p.tag != null ? ` ${p.tag}` : ''}`);
      const A = stage.scene.partBox(fx.a), B = stage.scene.partBox(fx.b);
      const badge = el('div', 'st-compare nv-cmp', stage.layer);
      badge.innerHTML = '<span></span><b></b><span></span>';
      badge.children[0].textContent = text(fx.a);
      badge.children[1].textContent = fx.sign < 0 ? '<' : fx.sign > 0 ? '>' : '=';
      badge.children[2].textContent = text(fx.b);
      const w = badge.offsetWidth || 120, h = badge.offsetHeight || 34;
      const x = (A.x + A.w / 2 + B.x + B.w / 2) / 2 - w / 2, y = Math.min(A.y, B.y) - h - 16;
      await Promise.all([stage.pulse(fx.a), stage.pulse(fx.b), stage.tween(badge, [{ opacity: 0, transform: tr(x, y + 10) }, { opacity: 1, transform: tr(x, y) }], { duration: 320, easing: EASE.out })]);
      await stage.wait(1100);
      await stage.tween(badge, [{ opacity: 1, transform: tr(x, y) }, { opacity: 0, transform: tr(x, y - 8) }], { duration: 240, easing: EASE.in });
      badge.remove();
    },
  },

  css: `${NODE_CSS}
.st-cell.gr-node { width: ${GNODE}px; height: ${GNODE}px; border-radius: 50%; }
.st-cell.gr-node.is-tap::after, .st-cell.gr-node.is-drag::after { border-radius: 50%; }
.gr-node > .nv-tag, .gr-node > .nv-ord { translate: -50% -50%; }
.gr-e .gr-line { fill: none; stroke: rgb(var(--chalk-rgb, 27 34 32) / 0.36); stroke-width: 2.5; stroke-linecap: round; transition: stroke .35s, stroke-width .35s; }
.gr-e .gr-arrow { fill: rgb(var(--chalk-rgb, 27 34 32) / 0.5); transition: fill .35s; }
.gr-e .gr-halo { fill: none; stroke: var(--st-gold); stroke-width: 12; stroke-linecap: round; opacity: 0; transition: opacity .35s; }
.gr-e[data-paint] .gr-line { stroke: var(--c); stroke-width: 5; }
.gr-e[data-paint] .gr-arrow { fill: var(--c); }
.gr-e.is-glow .gr-halo { opacity: .32; }
.gr-e.is-hot .gr-halo { opacity: .45; stroke: var(--st-brand); }
.gr-e.is-dim { opacity: .22; transition: opacity .35s; }
.gr-e { transition: opacity .35s; }
.gr-w { position: absolute; left: 0; top: 0; height: 26px; box-sizing: border-box; border-radius: 13px; display: grid; place-items: center; background: var(--st-card); color: var(--st-ink); box-shadow: 0 0 0 1px var(--st-line), 0 4px 10px -7px rgb(var(--shade-rgb, 25 45 40) / 0.45); font: 600 15px/1 var(--sans, sans-serif); font-variant-numeric: tabular-nums; transition: box-shadow .35s, background-color .35s, opacity .35s; }
.gr-w::before, .gr-hit::before { content: ""; position: absolute; inset: -10px; }
.gr-hit { position: absolute; left: 0; top: 0; width: 30px; height: 30px; border-radius: 50%; }
.gr-w[data-paint] { background: color-mix(in srgb, var(--c) 16%, var(--st-card)); box-shadow: 0 0 0 2px var(--c); }
.gr-w.is-glow { box-shadow: 0 0 0 2px var(--st-gold), 0 0 0 6px color-mix(in srgb, var(--st-gold) 22%, transparent); }
.gr-w.is-dim, .gr-hit.is-dim { opacity: .3; }
.gr-w.is-covered .gr-wv { visibility: hidden; }
.gr-w.is-covered::after { content: "?"; position: absolute; inset: 0; display: grid; place-items: center; color: var(--st-brand); font: 600 15px/1 var(--sans, sans-serif); }
.gr-w.is-tap, .gr-hit.is-tap { cursor: pointer; touch-action: none; }
.gr-w.is-tap::after, .gr-hit.is-tap::after { content: ""; position: absolute; inset: -6px; border-radius: 999px; border: 2px solid var(--st-brand); opacity: 0; animation: st-breathe 1.8s ease-in-out infinite; pointer-events: none; }
.gr-w.is-press, .gr-hit.is-press { scale: .94; transition: scale .12s; }
.gr-carry { position: absolute; left: 0; top: 0; z-index: 6; padding: 6px 12px; border-radius: 12px; white-space: nowrap; background: var(--st-card); color: var(--st-brand); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--st-brand) 50%, transparent), 0 10px 22px -14px rgb(var(--shade-rgb, 25 45 40) / 0.5); font: 600 17px/1 var(--sans, sans-serif); font-variant-numeric: tabular-nums; pointer-events: none; }
.gr-carry.is-good { color: var(--st-g3); box-shadow: 0 0 0 2px var(--st-g3), 0 10px 22px -14px rgb(var(--shade-rgb, 25 45 40) / 0.5); }
.gr-carry.is-bad { color: var(--st-muted); }
.gr-row { position: absolute; left: 0; top: 0; height: ${GNODE + 20}px; border-radius: ${(GNODE + 20) / 2}px; background: rgb(var(--chalk-rgb, 27 34 32) / 0.05); box-shadow: inset 0 0 0 1.5px rgb(var(--chalk-rgb, 27 34 32) / 0.1); transition: width .5s; }
`,
};
