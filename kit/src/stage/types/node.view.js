// 树和图共用的画法小件（types/tree.view.js、graph.view.js 用，只在浏览器里用）：
// 沿着走的圈（遍历、查找、松弛时「现在在哪个结点」）、访问号、结点角上的小字（换数时旧的往上走、新的从下面进来）、
// 值飞过去（换值、后继顶替）、跟着结点走的线（动画进行中每一帧读结点现在的位置，边像连在结点上一样跟着动）。
import { EASE } from '../motion.js';

export const SVGNS = 'http://www.w3.org/2000/svg';
export const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
export const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
export const svg = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
export const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
export const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const RING = 16; // 圈比结点大多少

/**
 * 一种东西的样式塞一次。views.js 有 viewCss()，可样子页、学习台现在都只装了 stage.css，没人把它装上——
 * 先由画法自己在第一次 sync 时装（同一份装两次也无妨），接上 viewCss 以后可以去掉
 */
export function ensureCss(id, css) {
  if (typeof document === 'undefined' || document.getElementById(`st-css-${id}`)) return;
  const s = document.createElement('style');
  s.id = `st-css-${id}`;
  s.textContent = css;
  document.head.appendChild(s);
}

/** 结点现在的中心（动画走到一半也对）：读算出来的 transform（translate 在矩阵的最后两项，和 scale、翻牌的 rotateY 无关） */
export function liveCenter(n) {
  const b = n.__box;
  const t = getComputedStyle(n).transform;
  const m = t && t !== 'none' && t.match(/matrix(3d)?\(([^)]+)\)/);
  if (!m) return centerOf(b);
  const v = m[2].split(',').map(Number);
  const [e, f] = m[1] ? [v[12], v[13]] : [v[4], v[5]];
  return { x: e + b.w / 2, y: f + b.h / 2 };
}

/** 这一样东西的线（decor 里带 __ends 的）照两头结点现在的位置画；有一条变了就返回 true */
export function placeLines(stage, objId, live = false) {
  const m = stage.decors.get(objId);
  if (!m) return false;
  let moved = false;
  for (const line of m.values()) {
    if (!line.__ends) continue;
    const a = stage.nodes.get(line.__ends[0]), b = stage.nodes.get(line.__ends[1]);
    if (!a?.__box || !b?.__box) continue;
    const ca = live ? liveCenter(a) : centerOf(a.__box), cb = live ? liveCenter(b) : centerOf(b.__box);
    const sig = [ca.x, ca.y, cb.x, cb.y].map((v) => Math.round(v * 2)).join(',');
    if (line.__sig === sig) continue;
    line.__sig = sig;
    line.__draw(line, ca, cb);
    moved = true;
  }
  return moved;
}

// 跟着结点走的线：动画进行中每一帧重画；结点停下来几帧（且至少过了 min 毫秒，舞台的挪动可能晚一点才开始）就收
const LOOPS = new WeakMap();
export function follow(stage, objId, { min = 300, max = 4500 } = {}) {
  if (stage.instant || typeof requestAnimationFrame !== 'function') { placeLines(stage, objId); return Promise.resolve(); }
  let m = LOOPS.get(stage);
  if (!m) LOOPS.set(stage, (m = new Map()));
  const cur = m.get(objId);
  if (cur) { cur.t0 = performance.now(); cur.quiet = 0; return cur.done; }
  const st = { t0: performance.now(), quiet: 0, start: performance.now() };
  st.done = new Promise((resolve) => {
    const tick = () => {
      const moved = placeLines(stage, objId, true);
      st.quiet = moved ? 0 : st.quiet + 1;
      const now = performance.now();
      if ((now - st.t0 > min && st.quiet > 3) || now - st.start > max) { m.delete(objId); placeLines(stage, objId); resolve(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  m.set(objId, st);
  return st.done;
}

/**
 * 部件的节点自己演完离场（缩没了、飞走了）以后直接拿下舞台：
 * 不等舞台的 sync 再淡一次（它从不透明开始淡，已经缩没的会闪回来一下）
 */
export function vanish(stage, pid) {
  const n = stage.nodes.get(pid);
  if (!n) return;
  stage.nodes.delete(pid);
  n.remove();
}

/** 沿着走的圈：套在结点外面，从一个结点滑到下一个（沿着两点的连线，也就是沿着那条边） */
export class Ring {
  constructor(stage, box, color = null) {
    this.stage = stage;
    this.n = el('div', 'nv-ring', stage.layer);
    if (color) this.n.dataset.paint = color;
    this.box = box;
    this.n.style.opacity = '0';
    this.n.style.transform = this.at(box);
  }
  at(b, s = 1) { return tr(b.x - RING / 2, b.y - RING / 2, s); }
  async show() {
    await this.stage.tween(this.n, [{ opacity: 0, transform: this.at(this.box, 1.3) }, { opacity: 1, transform: this.at(this.box) }], { duration: 280, easing: EASE.out });
  }
  async to(b, { duration = null } = {}) {
    const a = this.box;
    this.box = b;
    const d = duration ?? Math.min(560, 260 + Math.hypot(b.x - a.x, b.y - a.y) * 0.5);
    await this.stage.tween(this.n, [{ transform: this.at(a) }, { transform: this.at(b) }], { duration: d, easing: EASE.move });
  }
  /** 沿着一串点走（弯的边也贴着走）：pts 是中心点 { x, y, t } */
  async along(pts, { duration = null } = {}) {
    const z = pts.at(-1);
    const len = pts.reduce((s, p, i) => (i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
    this.box = { ...this.box, x: z.x - this.box.w / 2, y: z.y - this.box.h / 2 };
    await this.stage.tween(this.n, pts.map((p) => ({ transform: this.at({ ...this.box, x: p.x - this.box.w / 2, y: p.y - this.box.h / 2 }), offset: p.t })), { duration: duration ?? Math.min(640, 280 + len * 0.5), easing: EASE.move });
  }
  /** 往一边探一下（插进去 / 查不到时，指一指那个空位在哪边） */
  async dip(dx, dy) {
    const b = { ...this.box, x: this.box.x + dx, y: this.box.y + dy };
    await this.stage.tween(this.n, [{ transform: this.at(this.box), opacity: 1 }, { transform: this.at(b, 0.7), opacity: 0 }], { duration: 340, easing: EASE.in });
    this.n.remove();
  }
  async out() {
    await this.stage.tween(this.n, [{ opacity: 1, transform: this.at(this.box) }, { opacity: 0, transform: this.at(this.box, 0.85) }], { duration: 220, easing: EASE.in });
    this.n.remove();
  }
}

/** 一个比大小的小牌子（「35 < 50」），贴在结点上方；返回收起它的函数 */
export function cmpBadge(stage, box, left, sign, right) {
  const n = el('div', 'st-compare nv-cmp', stage.layer);
  n.innerHTML = '<span></span><b></b><span></span>';
  n.children[0].textContent = left;
  n.children[1].textContent = sign < 0 ? '<' : sign > 0 ? '>' : '=';
  n.children[2].textContent = right;
  const w = n.offsetWidth || 90, h = n.offsetHeight || 34;
  const x = box.x + box.w / 2 - w / 2, y = box.y - h - 12;
  const shown = stage.tween(n, [{ opacity: 0, transform: tr(x, y + 8) }, { opacity: 1, transform: tr(x, y) }], { duration: 240, easing: EASE.out });
  return { shown, hide: async () => { await stage.tween(n, [{ opacity: 1, transform: tr(x, y) }, { opacity: 0, transform: tr(x, y - 6) }], { duration: 180, easing: EASE.in }); n.remove(); } };
}

/** 一个值从 a 飞到 b（中心点），走一道弧；返回飞到以后（影子已经拿掉） */
export async function flyText(stage, text, a, b, { dir = -1, cls = '' } = {}) {
  const g = el('div', `nv-fly ${cls}`, stage.layer);
  g.textContent = text;
  const w = 56, h = 56;
  const pts = arc(a, b, dir);
  await stage.tween(g, pts.map((p) => ({ transform: tr(p.x - w / 2, p.y - h / 2), offset: p.t })), { duration: Math.min(820, 420 + Math.hypot(b.x - a.x, b.y - a.y) * 0.8), easing: EASE.move });
  g.remove();
}
// 两点之间一道弧（往连线的一侧拱，dir 换另一侧），16 段
export function arc(a, b, dir = -1, lift = 0.28) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
  const k = Math.max(18, Math.min(70, d * lift)) * dir;
  const cx = (a.x + b.x) / 2 + (-dy / d) * k, cy = (a.y + b.y) / 2 + (dx / d) * k;
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y, t };
  });
}

/** 结点里的值换掉：缩一下、换字、弹回来（write、后继顶替都用） */
export async function swapValue(stage, n, text) {
  const v = n.querySelector('.st-v');
  if (!n.__box || !v) { if (v) v.textContent = text; return; }
  const b = n.__box;
  await stage.tween(n, [{ transform: tr(b.x, b.y) }, { transform: tr(b.x, b.y, 0.8), opacity: 0.45 }], { duration: 160, easing: EASE.in });
  v.textContent = text;
  await stage.tween(n, [{ transform: tr(b.x, b.y, 0.8), opacity: 0.45 }, { transform: tr(b.x, b.y), opacity: 1 }], { duration: 340, easing: EASE.spring });
}

/** 访问号：结点上一个实心小圆；pop 时弹出来 */
export function setOrder(stage, n, num, { pop = false } = {}) {
  let b = n.querySelector(':scope > .nv-ord:not(.is-gone)');
  if (num == null) {
    if (!b) return null;
    b.classList.add('is-gone');
    if (stage.instant) { b.remove(); return null; }
    return stage.tween(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => b.remove());
  }
  const text = String(num);
  const fresh = !b;
  if (!b) b = el('span', 'nv-ord', n);
  if (b.textContent === text && !fresh) return null;
  b.textContent = text;
  if (!pop || stage.instant) return null;
  return stage.tween(b, [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.25)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], { duration: 420, easing: EASE.out });
}

/** 角上的小字：新的弹出来；换数时旧的往上淡走、新的从下面进来；null 收起 */
export function setTag(stage, n, text, { animate = true, bad = false, auto = false } = {}) {
  let t = n.querySelector(':scope > .nv-tag:not(.is-gone)');
  if (text == null) {
    if (!t) return null;
    t.classList.add('is-gone');
    if (stage.instant || !animate) { t.remove(); return null; }
    return stage.tween(t, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => t.remove());
  }
  const s = String(text);
  t?.classList.toggle('is-bad', bad);
  t?.classList.toggle('is-auto', auto);
  if (!t) {
    t = el('span', 'nv-tag', n);
    t.textContent = s;
    t.classList.toggle('is-bad', bad);
    t.classList.toggle('is-auto', auto);
    if (stage.instant || !animate) return null;
    return stage.tween(t, [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, easing: EASE.spring });
  }
  if (t.textContent === s) return null;
  if (stage.instant || !animate) { t.textContent = s; return null; }
  return (async () => {
    await stage.tween(t, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-8px)' }], { duration: 150, easing: EASE.in });
    t.textContent = s;
    t.classList.add('is-new');
    await stage.tween(t, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: EASE.out });
    setTimeout(() => t.classList.remove('is-new'), 700);
  })();
}

/** 圆形结点的值太长时字小一号 */
export function sizeValue(v, text) {
  const n = [...String(text)].length;
  v.classList.toggle('is-mid', n === 3);
  v.classList.toggle('is-long', n >= 4);
}

export const NODE_CSS = `
.nv-ring { position: absolute; left: 0; top: 0; width: 72px; height: 72px; box-sizing: border-box; border-radius: 50%; border: 3px solid var(--c, var(--st-brand)); box-shadow: 0 0 0 5px color-mix(in srgb, var(--c, var(--st-brand)) 16%, transparent); pointer-events: none; z-index: 4; }
.nv-cmp { z-index: 6; pointer-events: none; }
.nv-fly { position: absolute; left: 0; top: 0; width: 56px; height: 56px; display: grid; place-items: center; font: 600 24px/1 var(--sans, sans-serif); font-variant-numeric: tabular-nums; color: var(--st-brand); z-index: 6; pointer-events: none; text-shadow: 0 0 6px var(--st-card), 0 0 2px var(--st-card); }
.nv-tag { position: absolute; z-index: 1; min-width: 24px; height: 22px; padding: 0 7px; box-sizing: border-box; border-radius: 11px; display: grid; place-items: center; white-space: nowrap; font: 600 13px/1 var(--sans, sans-serif); font-variant-numeric: tabular-nums; letter-spacing: 0; color: var(--st-ink); background: var(--st-card); box-shadow: 0 0 0 1px var(--st-line), 0 4px 10px -6px rgb(var(--shade-rgb, 25 45 40) / 0.45); pointer-events: none; transition: color .3s, box-shadow .3s; }
.nv-tag { color: var(--st-brand); background: color-mix(in srgb, var(--st-brand) 9%, var(--st-card)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--st-brand) 28%, transparent), 0 4px 10px -6px rgb(var(--shade-rgb, 25 45 40) / 0.45); }
.nv-tag.is-auto { color: var(--st-muted); background: var(--st-card); box-shadow: 0 0 0 1px var(--st-line), 0 4px 10px -6px rgb(var(--shade-rgb, 25 45 40) / 0.45); }
.nv-tag.is-bad { color: var(--st-red); box-shadow: 0 0 0 1.5px var(--st-red), 0 4px 10px -6px rgb(var(--shade-rgb, 25 45 40) / 0.45); }
.nv-tag.is-new { color: var(--st-brand); box-shadow: 0 0 0 2px var(--st-brand), 0 0 0 6px color-mix(in srgb, var(--st-brand) 14%, transparent); }
.nv-ord { position: absolute; z-index: 1; min-width: 24px; height: 24px; padding: 0 5px; box-sizing: border-box; border-radius: 12px; background: var(--st-brand); color: var(--st-brand-ink); font: 700 13px/24px var(--sans, sans-serif); font-variant-numeric: tabular-nums; text-align: center; box-shadow: 0 0 0 2px var(--st-card); pointer-events: none; }
.st-cell > .st-v.is-mid { font-size: 20px; }
.st-cell > .st-v.is-long { font-size: 16px; letter-spacing: -.02em; }
`;
