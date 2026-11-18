// 平面的画法（types/plane.js 的画面那一半）：底下一层淡淡的不动的网格（看坐标用），上面一层会变的网格（线性变换时整个变过去，像 3Blue1Brown），
// 张成涂的颜色、首尾相接的虚线、向量（箭头末端标名字）和点；学生拖向量的末端（吸到格点上）。
//
// 网格和向量一起平滑地变过去，要的是「矩阵的每一项从 I 线性地走到 A」（基向量走直线），CSS 的 transform 插值会转成旋转、
// 压扁（行列式为 0）时 SVG 干脆不画，所以这里每一帧自己算（requestAnimationFrame），全部画法都从一份「画面现在的样子」（st）出发：
//   st.M 网格现在的矩阵；st.free 自由的向量和点现在画在哪；st.coef 跟着算的向量现在的系数；
// 场景变了（变换、拖、拨数、新加的向量）就从 st 滑到场景的样子；拖的时候直接改 st，跟着算的当场跟着走。
import { EASE, stagger } from '../motion.js';
import { UNIT, planeBox, toWorld, fromWorld, snap, num, nameAt, spanOf, coefNum } from './plane.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
const r1 = (v) => Math.round(v * 10) / 10;
const lerp = (a, b, e) => a + (b - a) * e;
const lerpP = (a, b, e) => ({ x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e) });
// 一帧一帧算时用的动作曲线（和 motion.js 的 EASE.move / EASE.out 差不多）
const EASE_FN = { move: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2), out: (t) => 1 - (1 - t) ** 3 };
let clipSeq = 0;

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('st-css-plane')) return;
  const s = document.createElement('style');
  s.id = 'st-css-plane';
  s.textContent = planeView.css;
  document.head.appendChild(s);
}

// —— 画面现在的样子 和 场景要的样子 ——
function goalOf(o, scene) {
  const g = { M: o.M.map((r) => r.map(num)), free: new Map(), coef: new Map(), kinds: new Map() };
  for (const it of o.items) {
    g.kinds.set(it.key, it.kind);
    if (it.expr) g.coef.set(it.key, { sig: it.expr.map((t) => t.of).join(','), c: it.expr.map((t) => coefNum(t, scene)) });
    else g.free.set(it.key, { x: num(it.x), y: num(it.y) });
  }
  return g;
}
const copyState = (st) => ({ M: st.M.map((r) => [...r]), free: new Map(st.free), coef: new Map(st.coef), drawn: new Map(st.drawn) });
const near = (a, b) => Math.abs(a - b) < 1e-6;
function sameAs(st, g) {
  if (st.blend.size || st.seq.size) return false;
  if (!st.M.every((r, i) => r.every((v, j) => near(v, g.M[i][j])))) return false;
  if (st.free.size !== g.free.size || st.coef.size !== g.coef.size) return false;
  for (const [k, p] of g.free) { const a = st.free.get(k); if (!a || !near(a.x, p.x) || !near(a.y, p.y)) return false; }
  for (const [k, p] of g.coef) { const a = st.coef.get(k); if (!a || a.sig !== p.sig || !a.c.every((v, i) => near(v, p.c[i]))) return false; }
  return true;
}
// 一帧：网格的矩阵、自由的向量、跟着算的系数都在 from 和 goal 之间取 e
function lerpState(st, from, g, e) {
  st.M = from.M.map((r, i) => r.map((v, j) => lerp(v, g.M[i][j], e)));
  for (const [k, p] of g.free) {
    const fresh = !from.free.has(k) && !from.drawn.has(k);
    // 新的向量从原点长出来；新的点在原地淡进来；本来跟着算、现在自由了的从它画着的地方滑过去
    const a = from.free.get(k) ?? from.drawn.get(k) ?? (g.kinds.get(k) === 'pt' ? p : { x: 0, y: 0 });
    st.free.set(k, lerpP(a, p, e));
    if (fresh && g.kinds.get(k) === 'pt') st.fade.set(k, e); else st.fade.delete(k);
  }
  for (const k of [...st.free.keys()]) if (!g.free.has(k)) st.free.delete(k);
  for (const [k, p] of g.coef) {
    const a = from.coef.get(k);
    if (a && a.sig === p.sig) { st.coef.set(k, { sig: p.sig, c: a.c.map((v, i) => lerp(v, p.c[i], e)) }); st.blend.delete(k); } else if (!a && !from.drawn.has(k)) st.coef.set(k, { sig: p.sig, c: p.c.map((v) => v * e) });
    else { st.coef.set(k, p); st.blend.set(k, { from: from.drawn.get(k) ?? { x: 0, y: 0 }, e }); }
  }
  for (const k of [...st.coef.keys()]) if (!g.coef.has(k)) st.coef.delete(k);
  if (e >= 1) { st.blend.clear(); st.fade.clear(); }
}

/** 每个向量、点现在画在哪（数学坐标，浮点）：自由的看 st.free，跟着算的照现在的系数和别的向量现在的位置算 */
function positions(o, st) {
  const by = new Map(o.items.map((i) => [i.key, i]));
  const P = new Map();
  const get = (k, depth = 0) => {
    if (P.has(k)) return P.get(k);
    const it = by.get(k);
    if (!it || depth > 24) return { x: 0, y: 0 };
    let p;
    if (st.drag?.key === k) p = st.drag.p;
    else if (!it.expr) p = st.free.get(k) ?? { x: num(it.x), y: num(it.y) };
    else {
      const cs = st.coef.get(k)?.c ?? [];
      p = { x: 0, y: 0 };
      it.expr.forEach((t, i) => { const r = get(t.of, depth + 1); p.x += (cs[i] ?? 0) * r.x; p.y += (cs[i] ?? 0) * r.y; });
      const b = st.blend.get(k);
      if (b) p = lerpP(b.from, p, b.e);
      const s = st.seq.get(k);
      if (s) p = { x: p.x * s.grow, y: p.y * s.grow };
    }
    P.set(k, p);
    return p;
  };
  for (const it of o.items) get(it.key);
  return P;
}

// —— 画 ——
function build(stage, o, entering) {
  const root = svg('g', { class: 'pl' }, stage.under);
  const id = `pl-clip-${o.id}-${++clipSeq}`;
  const clip = svg('clipPath', { id }, svg('defs', {}, root));
  root.__clipRect = svg('rect', {}, clip);
  root.__bg = svg('g', { class: 'pl-bg' }, root);
  root.__spans = svg('g', { class: 'pl-spans', 'clip-path': `url(#${id})` }, root);
  root.__grid = svg('g', { class: 'pl-grid', 'clip-path': `url(#${id})` }, root);
  root.__gl = svg('path', { class: 'pl-gl' }, root.__grid);
  root.__gax = svg('path', { class: 'pl-gax' }, root.__grid);
  root.__guides = svg('g', { class: 'pl-guides' }, root);
  root.__items = svg('g', { class: 'pl-items' }, root);
  root.__st = { M: [[1, 0], [0, 1]], free: new Map(), coef: new Map(), drawn: new Map(), blend: new Map(), fade: new Map(), seq: new Map(), anim: null, drag: null };
  if (entering) { root.__bg.style.opacity = '0'; root.__grid.style.opacity = '0'; }
  return root;
}

// 不动的底：每一格一条淡线、两条坐标轴、刻度的数、x 和 y（平面换了范围就重画）
function drawStatic(root, o) {
  const sig = `${o.origin.x},${o.origin.y},${o.xlo},${o.xhi},${o.ylo},${o.yhi}`;
  if (root.__sig === sig) return;
  root.__sig = sig;
  root.__mkey = null;
  const b = planeBox(o);
  for (const [k, v] of Object.entries({ x: b.x, y: b.y, width: b.w, height: b.h })) root.__clipRect.setAttribute(k, v);
  const bg = root.__bg;
  bg.replaceChildren();
  let d = '';
  for (let x = o.xlo; x <= o.xhi; x++) { const a = toWorld(o, x, o.ylo), z = toWorld(o, x, o.yhi); d += `M${a.x} ${a.y}V${z.y}`; }
  for (let y = o.ylo; y <= o.yhi; y++) { const a = toWorld(o, o.xlo, y), z = toWorld(o, o.xhi, y); d += `M${a.x} ${a.y}H${z.x}`; }
  svg('path', { class: 'pl-bgline', d }, bg);
  const O = toWorld(o, 0, 0);
  svg('path', { class: 'pl-bgaxis', d: `M${b.x} ${O.y}H${b.x + b.w + 10}M${O.x} ${b.y + b.h}V${b.y - 10}` }, bg);
  svg('path', { class: 'pl-bgarrow', d: `M${b.x + b.w + 14} ${O.y}l-8 -4.5v9zM${O.x} ${b.y - 14}l-4.5 8h9z` }, bg);
  const t = (x, y, s, cls = 'pl-tick', anchor = 'middle') => { const n = svg('text', { class: cls, x, y, 'text-anchor': anchor }, bg); n.textContent = s; };
  for (let x = o.xlo; x <= o.xhi; x++) if (x) { const p = toWorld(o, x, 0); t(p.x, p.y + 17, String(x).replace('-', '−')); }
  for (let y = o.ylo; y <= o.yhi; y++) if (y) { const p = toWorld(o, 0, y); t(p.x - 8, p.y + 4.5, String(y).replace('-', '−'), 'pl-tick', 'end'); }
  t(O.x - 8, O.y + 17, '0', 'pl-tick', 'end');
  t(b.x + b.w + 20, O.y + 20, 'x', 'pl-axname');
  t(O.x + 14, b.y - 8, 'y', 'pl-axname', 'start');
}

// 会变的网格：比平面大几倍（变换以后网格外圈也铺满），裁到平面那一块里
function drawGrid(root, o, M) {
  const key = M.flat().map((v) => v.toFixed(4)).join(',');
  if (root.__mkey === key) return;
  root.__mkey = key;
  const N = Math.min(30, 3 * Math.max(-o.xlo, o.xhi, -o.ylo, o.yhi));
  const W = (x, y) => toWorld(o, M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y);
  let d = '';
  for (let i = -N; i <= N; i++) {
    if (!i) continue;
    const a = W(i, -N), b = W(i, N), c = W(-N, i), e = W(N, i);
    d += `M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}M${r1(c.x)} ${r1(c.y)}L${r1(e.x)} ${r1(e.y)}`;
  }
  root.__gl.setAttribute('d', d);
  const a = W(-N, 0), b = W(N, 0), c = W(0, -N), e = W(0, N);
  root.__gax.setAttribute('d', `M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}M${r1(c.x)} ${r1(c.y)}L${r1(e.x)} ${r1(e.y)}`);
}

// 一根箭头：杆 + 尖（尖的大小跟着长短，短的向量也看得出方向）
function arrowD(A, T) {
  const dx = T.x - A.x, dy = T.y - A.y, d = Math.hypot(dx, dy);
  if (d < 1.5) return { shaft: '', head: '' };
  const ux = dx / d, uy = dy / d, L = Math.min(17, d * 0.5), w = L * 0.58;
  const bx = T.x - ux * L, by = T.y - uy * L;
  return {
    shaft: `M${r1(A.x)} ${r1(A.y)}L${r1(bx + ux * 1.5)} ${r1(by + uy * 1.5)}`,
    head: `M${r1(T.x)} ${r1(T.y)}L${r1(bx - uy * w)} ${r1(by + ux * w)}L${r1(bx + uy * w)} ${r1(by - ux * w)}Z`,
  };
}

function itemNode(root, it) {
  const g = svg('g', { class: it.kind === 'vec' ? 'pl-vec' : 'pl-pt' }, root.__items);
  g.__kind = it.kind;
  if (it.kind === 'vec') {
    g.__halo = svg('path', { class: 'pl-halo' }, g);
    g.__shaft = svg('path', { class: 'pl-shaft' }, g);
    g.__head = svg('path', { class: 'pl-head' }, g);
    g.__hitline = svg('path', { class: 'pl-hitline' }, g);
  } else g.__dot = svg('circle', { class: 'pl-dot', r: 6.5 }, g);
  g.__snap = svg('circle', { class: 'pl-snap', r: 9 }, g);
  g.__ring = svg('circle', { class: 'pl-ring', r: 21 }, g);
  g.__hit = svg('circle', { class: 'pl-hit', r: 26 }, g);
  g.__name = svg('text', { class: 'pl-name', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, g);
  g.__coord = svg('text', { class: 'pl-coord', 'text-anchor': 'middle' }, g);
  return g;
}

function drawItem(o, n, it, p, st) {
  const O = toWorld(o, 0, 0), T = toWorld(o, p.x, p.y);
  if (it.kind === 'vec') {
    const a = arrowD(O, T);
    n.__shaft.setAttribute('d', a.shaft);
    n.__head.setAttribute('d', a.head);
    n.__halo.setAttribute('d', `${a.shaft}${a.head}`);
    n.__hitline.setAttribute('d', a.shaft);
  } else {
    n.__dot.setAttribute('cx', r1(T.x));
    n.__dot.setAttribute('cy', r1(T.y));
    const f = st.fade.get(it.key);
    n.__dot.setAttribute('r', f == null ? 6.5 : r1(6.5 * f));
  }
  for (const c of [n.__ring, n.__hit]) { c.setAttribute('cx', r1(T.x)); c.setAttribute('cy', r1(T.y)); }
  const nm = nameAt(o, p.x, p.y, it.kind);
  n.__name.setAttribute('x', r1(nm.x));
  n.__name.setAttribute('y', r1(nm.y));
  if (n.__name.textContent !== it.label) n.__name.textContent = it.label;
  n.__name.style.opacity = it.kind === 'vec' && Math.hypot(T.x - O.x, T.y - O.y) < 6 ? '0' : '';
}

// 张成：一条线（过原点、铺满平面）或整个平面，淡淡涂上
function drawSpans(stage, root, o, P) {
  const live = new Set();
  const b = planeBox(o), O = toWorld(o, 0, 0), far = Math.hypot(b.w, b.h) * 2;
  for (const s of o.spans) {
    live.add(s.id);
    let n = root.__spans.querySelector(`[data-span="${CSS.escape(s.id)}"]`);
    if (!n) {
      n = svg('path', { class: 'pl-span' }, root.__spans);
      n.dataset.span = s.id;
      if (!stage.instant) stage.tween(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 520, easing: EASE.out });
    }
    n.dataset.paint = s.color;
    // 张成照向量现在画着的样子（拖的时候、变换的时候跟着变）；stay 的照画的那时候
    const vs = s.at ? s.at.map(([x, y]) => ({ x: num(x), y: num(y) })) : s.of.map((k) => P.get(k) || { x: 0, y: 0 });
    const nz = vs.filter((v) => Math.hypot(v.x, v.y) > 1e-6);
    const cross = nz.length === 2 ? nz[0].x * nz[1].y - nz[0].y * nz[1].x : 0;
    const kind = !nz.length ? 'point' : Math.abs(cross) > 1e-6 ? 'plane' : 'line';
    n.classList.toggle('is-plane', kind === 'plane');
    n.classList.toggle('is-point', kind === 'point');
    if (kind === 'plane') n.setAttribute('d', `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`);
    else if (kind === 'point') n.setAttribute('d', `M${O.x - 0.1} ${O.y}h0.2`);
    else {
      const T = toWorld(o, nz[0].x, nz[0].y), dx = T.x - O.x, dy = T.y - O.y, d = Math.hypot(dx, dy);
      n.setAttribute('d', `M${r1(O.x - (dx / d) * far)} ${r1(O.y - (dy / d) * far)}L${r1(O.x + (dx / d) * far)} ${r1(O.y + (dy / d) * far)}`);
    }
  }
  for (const n of [...root.__spans.children]) if (!live.has(n.dataset.span)) n.remove();
}

// 首尾相接：第 k 项的箭头从前面几项加起来的地方出发（虚线）；u + v 时把平行四边形的另一半和淡淡的面补上
function drawGuides(root, o, P, st) {
  const used = new Set();
  const take = (key, tag, cls) => {
    used.add(key);
    let n = root.__guides.querySelector(`[data-g="${CSS.escape(key)}"]`);
    if (!n) { n = svg(tag, { class: cls }, root.__guides); n.dataset.g = key; }
    return n;
  };
  const by = new Map(o.items.map((i) => [i.key, i]));
  for (const it of o.items) {
    if (!it.guide || !it.expr) continue;
    const s = st.seq.get(it.key) || { slide: 1, para: 1 };
    const cs = st.coef.get(it.key)?.c ?? it.expr.map(() => 0);
    let base = { x: 0, y: 0 };
    const W = P.get(it.key);
    const unit = it.expr.length === 2 && cs.every((c) => Math.abs(c - 1) < 1e-9);
    if (unit && s.para > 0) {
      const u = P.get(it.expr[0].of), v = P.get(it.expr[1].of);
      const f = take(`${it.key}:fill`, 'path', 'pl-para');
      if (it.paint) f.dataset.paint = it.paint; else delete f.dataset.paint;
      const pts = [{ x: 0, y: 0 }, u, W, v].map((q) => toWorld(o, q.x, q.y));
      f.setAttribute('d', `M${pts.map((q) => `${r1(q.x)} ${r1(q.y)}`).join('L')}Z`);
      f.style.opacity = String(s.para);
      // 另一半：v 先走、再接 u
      const seg = take(`${it.key}:alt`, 'path', 'pl-guide');
      const paint = by.get(it.expr[0].of)?.paint;
      if (paint) seg.dataset.paint = paint; else delete seg.dataset.paint;
      const A = toWorld(o, v.x, v.y), Z = toWorld(o, W.x, W.y);
      seg.setAttribute('d', `M${r1(A.x)} ${r1(A.y)}L${r1(Z.x)} ${r1(Z.y)}`);
      seg.style.opacity = String(s.para);
    }
    it.expr.forEach((t, k) => {
      const r = P.get(t.of) || { x: 0, y: 0 };
      const step = { x: cs[k] * r.x, y: cs[k] * r.y };
      const from = k ? lerpP({ x: 0, y: 0 }, base, s.slide) : base;
      base = { x: base.x + step.x, y: base.y + step.y };
      // 第一项系数是 1 时和那个向量自己重合，不画
      if (!k && Math.abs(cs[0] - 1) < 1e-9) return;
      const A = toWorld(o, from.x, from.y), Z = toWorld(o, from.x + step.x, from.y + step.y);
      const a = arrowD(A, Z);
      const sh = take(`${it.key}:${k}`, 'path', 'pl-guide');
      const hd = take(`${it.key}:${k}h`, 'path', 'pl-ghead');
      const paint = by.get(t.of)?.paint;
      for (const n of [sh, hd]) { if (paint) n.dataset.paint = paint; else delete n.dataset.paint; }
      sh.setAttribute('d', a.shaft);
      // 最后一段的尖和和向量的尖重合：和画出来以后就不画它（还没长出来时留着，看得出往哪走）
      hd.setAttribute('d', k === it.expr.length - 1 && (s.grow ?? 1) >= 1 ? '' : a.head);
    });
  }
  for (const n of [...root.__guides.children]) if (!used.has(n.dataset.g)) n.remove();
}

function render(stage, o, root) {
  const st = root.__st;
  drawStatic(root, o);
  drawGrid(root, o, st.M);
  const P = positions(o, st);
  for (const it of o.items) { const n = stage.nodeOf(it); if (n?.__kind === it.kind) drawItem(o, n, it, P.get(it.key), st); }
  drawSpans(stage, root, o, P);
  drawGuides(root, o, P, st);
  st.drawn = P;
  return P;
}

/**
 * 从画面现在的样子滑到 goal（一帧一帧算）。正在演的那一段停在半路，从现在的样子接着演（不跳）。
 * step(e) 可以顺带改别的（sum 的几段）；页面在后台时 rAF 不走，到点直接跳到最后
 */
function animate(stage, o, root, { goal = null, ms = 560, ease = EASE_FN.move, step = null } = {}) {
  const st = root.__st;
  st.anim?.stop();
  const from = copyState(st);
  const frame = (k) => { const e = ease(k); if (goal) lerpState(st, from, goal, e); step?.(e); render(stage, o, root); };
  const d = stage.dur(ms);
  if (stage.instant || d <= 1 || typeof requestAnimationFrame !== 'function') { frame(1); st.anim = null; return Promise.resolve(); }
  return new Promise((resolve) => {
    let done = false, t0 = null;
    const end = (last) => { if (done) return; done = true; if (last) frame(1); if (st.anim === me) st.anim = null; resolve(); };
    const me = { stop: () => end(false) };
    st.anim = me;
    const tick = (now) => {
      if (done) return;
      t0 ??= now;
      const k = Math.min(1, (now - t0) / d);
      if (k >= 1) { end(true); return; }
      frame(k);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => end(true), d + 500);
  });
}

const rootOf = (stage, o) => stage.decor(o.id, 'root');

export const planeView = {
  sync(stage, o, ctx) {
    ensureCss();
    const entering = ctx.entering === o.id;
    const root = stage.decor(o.id, 'root', () => build(stage, o, entering));
    for (const it of o.items) {
      let n = stage.partNode(it, () => itemNode(root, it));
      // 同名的东西换了种类（重造了平面）：节点换掉
      if (n.__kind !== it.kind) { n.remove(); stage.nodes.delete(stage.pid(it)); n = stage.partNode(it, () => itemNode(root, it)); }
      stage.flagPart(n, it, ctx);
    }
    const g = goalOf(o, stage.scene);
    const st = root.__st;
    if (stage.instant || entering) { animate(stage, o, root, { goal: g, ms: 0 }); return []; }
    if (!sameAs(st, g)) ctx.jobs.push(animate(stage, o, root, { goal: g, ms: 600 }));
    else render(stage, o, root);
    return [];
  },

  // 网格淡进来（不动的那层先、会变的那层跟着）
  async enter(stage, o) {
    const root = rootOf(stage, o);
    if (!root) return;
    await Promise.all([
      stage.tween(root.__bg, [{ opacity: 0 }, { opacity: 1 }], { duration: 480, easing: EASE.out }),
      stage.tween(root.__grid, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 160, easing: EASE.out }),
    ]);
  },

  choreo: {
    // 线性变换：网格的矩阵从现在的样子线性地走到 A·M，向量跟着走（像 3Blue1Brown 那样慢慢变过去）
    async transform(stage, c, fx) {
      const o = stage.scene.objects.get(fx.id), root = o && rootOf(stage, o);
      if (!root) return;
      const m = fx.by && stage.scene.objects.get(fx.by);
      if (m && !stage.instant) m.cells.forEach((x, i) => stage.pulse(x, stagger(i, { step: 50 })));
      await animate(stage, o, root, { goal: goalOf(o, stage.scene), ms: 1700 });
    },
    async untransform(stage, c, fx) {
      const o = stage.scene.objects.get(fx.id), root = o && rootOf(stage, o);
      if (!root) return;
      await animate(stage, o, root, { goal: goalOf(o, stage.scene), ms: 1300 });
    },
    // 首尾相接：后面每一项的副本从原点滑到前面那一项的尖上，再从原点长出和，最后补上平行四边形的另一半
    async sum(stage, c, fx) {
      const o = stage.scene.objects.get(fx.id), root = o && rootOf(stage, o);
      if (!root || stage.instant) return;
      const it = o.items.find((i) => i.key === fx.key);
      const st = root.__st;
      const n = stage.partNode(it, () => itemNode(root, it));
      stage.flagPart(n, it, { jobs: [] });
      const g = goalOf(o, stage.scene);
      st.anim?.stop();
      st.coef.set(it.key, g.coef.get(it.key));
      st.blend.delete(it.key);
      const s = { slide: 0, grow: fx.fresh ? 0 : 1, para: 0 };
      st.seq.set(it.key, s);
      render(stage, o, root);
      await stage.wait(160);
      await animate(stage, o, root, { ms: 760, step: (e) => { s.slide = e; } });
      if (fx.fresh) await animate(stage, o, root, { ms: 620, ease: EASE_FN.out, step: (e) => { s.grow = e; } });
      await animate(stage, o, root, { ms: 420, step: (e) => { s.para = e; } });
      st.seq.delete(it.key);
      render(stage, o, root);
    },
  },

  // 学生拖（手指的事在 pointer.js）：按住箭头尖（或点）拖，箭头跟着手，松手吸到最近的格点上；跟着它算的（u + v……）当场跟着走。
  // 拿的地方每次按下时按箭头「现在」画在哪算（以前另挂一块透明手柄，拖完一次、吸格点的动画没走完它就停在半路，下一次按不到）
  dragSpec(stage, it0) {
    const id = it0.obj, key = it0.key;
    const ctx = () => {
      const o = stage.scene.objects.get(id), root = o && rootOf(stage, o);
      const it = o?.items.find((x) => x.key === key);
      return o && root && it ? { o, root, st: root.__st, it, n: stage.nodes.get(`${id}:${key}`) } : null;
    };
    const tip = (c) => c.st.drawn.get(key) || { x: num(c.it.x), y: num(c.it.y) };
    let off = null, p = null;
    const show = (c, s) => {
      const S = toWorld(c.o, s.x, s.y), T = toWorld(c.o, p.x, p.y);
      c.n.__snap.setAttribute('cx', r1(S.x));
      c.n.__snap.setAttribute('cy', r1(S.y));
      c.n.__coord.setAttribute('x', r1(T.x));
      c.n.__coord.setAttribute('y', r1(T.y - 30));
      c.n.__coord.textContent = `(${String(s.x).replace('-', '−')}, ${String(s.y).replace('-', '−')})`;
    };
    return {
      // 手指能按到的地方：箭头尖四周一块（屏幕上 52px，镜头缩小了也够手指按）
      rect() {
        const c = ctx();
        if (!c) return null;
        const a = tip(c), S = stage.toScreenLive(toWorld(c.o, a.x, a.y));
        return { x: S.x - 26, y: S.y - 26, w: 52, h: 52 };
      },
      start(w) {
        const c = ctx();
        if (!c?.n) throw new Error('这个向量不在了');
        c.st.anim?.stop();
        const f = fromWorld(c.o, w), a = tip(c);
        off = { x: a.x - f.x, y: a.y - f.y };
        p = { ...a };
        c.st.drag = { key, p };
        c.n.classList.add('is-hold');
        show(c, snap(c.o, p));
      },
      move(w) {
        const c = ctx();
        if (!c || !off) return;
        const f = fromWorld(c.o, w);
        p = { x: Math.max(c.o.xlo, Math.min(c.o.xhi, f.x + off.x)), y: Math.max(c.o.ylo, Math.min(c.o.yhi, f.y + off.y)) };
        c.st.drag = { key, p };
        render(stage, c.o, c.root);
        show(c, snap(c.o, p));
      },
      drop() {
        const c = ctx();
        if (!c || !off || !p) return null;
        off = null;
        c.n.classList.remove('is-hold');
        // 手放开的地方交给画面（再滑到格点上），场景照「vec p u = 3 1」改
        c.st.drag = null;
        c.st.free.set(key, p);
        const s = snap(c.o, p);
        const same = !c.it.expr && num(c.it.x) === s.x && num(c.it.y) === s.y;
        if (same) { animate(stage, c.o, c.root, { goal: goalOf(c.o, stage.scene), ms: 360 }); return null; }
        const what = c.it.kind === 'vec' ? '向量' : '点';
        const was = `(${c.it.x}, ${c.it.y})`;
        return {
          act: { type: 'drag', ref: `${c.o.id}.${c.it.name}`, from: [c.it.x, c.it.y], to: [String(s.x), String(s.y)], text: `学生把${what} ${c.o.id}.${c.it.name}${c.it.kind === 'vec' ? ' 的末端' : ''}拖到了 (${s.x}, ${s.y})（原来在 ${was}），舞台已经照做了` },
          src: `${c.it.kind === 'vec' ? 'vec' : 'point'} ${c.o.id} ${c.it.name} = ${s.x} ${s.y}`,
        };
      },
      cancel() {
        const c = ctx();
        off = null;
        if (!c) return;
        c.n?.classList.remove('is-hold');
        c.st.drag = null;
        animate(stage, c.o, c.root, { goal: goalOf(c.o, stage.scene), ms: 360 });
      },
    };
  },

  css: `
.pl-bgline { fill: none; stroke: rgb(var(--chalk-rgb, 27 34 32) / 0.075); stroke-width: 1; }
.pl-bgaxis { fill: none; stroke: rgb(var(--chalk-rgb, 27 34 32) / 0.3); stroke-width: 1.4; }
.pl-bgarrow { fill: rgb(var(--chalk-rgb, 27 34 32) / 0.3); }
.pl-tick { font: 500 13px var(--sans, -apple-system, sans-serif); fill: var(--st-muted); font-variant-numeric: tabular-nums; }
.pl-axname { font: italic 500 18px "Latin Modern Math", "Cambria Math", "Times New Roman", serif; fill: var(--st-muted); }
.pl-gl { fill: none; stroke: color-mix(in srgb, var(--st-g1) 40%, transparent); stroke-width: 1.2; }
.pl-gax { fill: none; stroke: color-mix(in srgb, var(--st-g1) 75%, transparent); stroke-width: 2; }
.pl-vec:not([data-paint]), .pl-pt:not([data-paint]) { --c: var(--st-ink); }
.pl-shaft { fill: none; stroke: var(--c); stroke-width: 4; stroke-linecap: round; }
.pl-head { fill: var(--c); stroke: var(--c); stroke-width: 1; stroke-linejoin: round; }
.pl-halo { fill: none; stroke: var(--st-gold); stroke-width: 14; stroke-linecap: round; stroke-linejoin: round; opacity: 0; transition: opacity .3s; }
.pl-vec.is-glow .pl-halo { opacity: .3; }
.pl-dot { fill: var(--c); stroke: var(--st-card); stroke-width: 2.5; }
.pl-pt.is-glow .pl-dot { stroke: var(--st-gold); stroke-width: 4; }
.pl-name { font: italic 600 22px "Latin Modern Math", "Cambria Math", "Times New Roman", serif; fill: var(--c);
  paint-order: stroke; stroke: color-mix(in srgb, var(--st-card) 88%, transparent); stroke-width: 5px; stroke-linejoin: round; }
.pl-vec.is-dim, .pl-pt.is-dim { opacity: .3; }
.pl-vec.is-covered, .pl-pt.is-covered { opacity: .18; }
.pl-vec.is-lift .pl-shaft { stroke-width: 5; }
.pl-span { fill: none; stroke: var(--c, var(--st-g1)); stroke-width: 18; stroke-linecap: butt; opacity: .17; }
.pl-span.is-plane { fill: var(--c, var(--st-g1)); stroke: none; opacity: .1; }
.pl-span.is-point { stroke-width: 16; stroke-linecap: round; opacity: .35; }
.pl-guide { fill: none; stroke: var(--c, var(--st-ink)); stroke-width: 2.6; stroke-dasharray: 7 6; stroke-linecap: round; opacity: .8; }
.pl-ghead { fill: var(--c, var(--st-ink)); opacity: .8; }
.pl-para { fill: var(--c, var(--st-ink)); stroke: none; fill-opacity: .09; }
.pl-hit, .pl-hitline { fill: transparent; stroke: transparent; pointer-events: none; }
.pl-hitline { fill: none; stroke-width: 26; }
.is-tap > .pl-hit { pointer-events: all; cursor: pointer; }
.is-tap > .pl-hitline { pointer-events: stroke; cursor: pointer; }
.pl-ring { fill: none; stroke: var(--st-brand); stroke-width: 2.5; opacity: 0; pointer-events: none; }
.is-tap > .pl-ring, .is-drag > .pl-ring { animation: pl-breathe 1.8s ease-in-out infinite; }
.is-hold > .pl-ring { animation: none; opacity: .9; }
@keyframes pl-breathe { 0%, 100% { opacity: 0; } 50% { opacity: .6; } }
/* 不拖的时候不占地方（display: none）：它平时停在世界原点，量这块平面占多大时会把它算进去——第二块平面被它「撑」到第一块那里，
   页面就一遍遍把第二块往下推，整台缩成一小块（主线第一轮 L3-1）。拖着的时候（is-hold）才出来，那时已经摆到了箭头尖上 */
.pl-snap { fill: none; stroke: var(--st-brand); stroke-width: 2; stroke-dasharray: 3 3; display: none; pointer-events: none; }
.is-hold > .pl-snap { display: inline; opacity: .85; }
.pl-coord { font: 600 16px var(--sans, sans-serif); fill: var(--st-brand); font-variant-numeric: tabular-nums; display: none; pointer-events: none;
  paint-order: stroke; stroke: color-mix(in srgb, var(--st-card) 90%, transparent); stroke-width: 5px; stroke-linejoin: round; }
.is-hold > .pl-coord { display: inline; opacity: 1; }
@media (prefers-reduced-motion: reduce) { .is-tap > .pl-ring, .is-drag > .pl-ring { animation: none; opacity: .5; } }
/* 一次点几样（ask pick）：点了的、交了的那一圈常亮（平面上是 SVG，stage.css 的 outline 画不出来）；reveal=on 以后没变的虚线淡掉 */
.pl-items .is-picking > .pl-ring, .pl-items .is-pick > .pl-ring { animation: none; opacity: 1; stroke-width: 3; }
.pl-items .is-pick-same > .pl-ring { stroke-dasharray: 5 4; opacity: .38; }
`,
};
