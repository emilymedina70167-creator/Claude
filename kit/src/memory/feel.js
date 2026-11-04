// 学习台的手感（2026-11-04，照「学习台手感」那个原型做的，我在 iPad 上试过定下来的）：
// 按下去一沉、松手弹回（CSS 的 :active，desk.css）；分段控件、页面胶囊的滑块滑过去；
// 点开的东西从它原来的位置长出来，关的时候缩回去，按住顶上往下拖能关；底下推上来的面板；
// 长按一张卡托起来、背景虚化、旁边弹出小菜单；数字变了往上滚；往上滑过大标题，顶上出现毛玻璃的小标题栏；
// 换白天晚上从手指那一点圆形铺开；开课时主角卡放大铺满再进课堂。只碰画面，不碰数据
const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
// iOS 的两条曲线：弹簧（有一点点过冲）和面板（推上来，不过冲）。linear() 不认的浏览器退回 cubic-bezier
const SPRING_LINEAR = 'linear(0, 0.0419, 0.1416, 0.2692, 0.4039, 0.5325, 0.6475, 0.7452, 0.8248, 0.8871, 0.934, 0.9678, 0.991, 1.006, 1.0146, 1.0188, 1.0199, 1.0191, 1.0171, 1.0145, 1.0118, 1.0093, 1.007, 1.005, 1.0035, 1.0022, 1.0013, 1.0006, 1.0002, 0.9999, 0.9997, 0.9996, 0.9996, 0.9996, 0.9997, 0.9997, 0.9998, 1)';
export const SPRING = typeof CSS !== 'undefined' && CSS.supports?.('transition-timing-function', SPRING_LINEAR) ? SPRING_LINEAR : 'cubic-bezier(.34, 1.4, .64, 1)';
export const SHEET = 'cubic-bezier(.32, .72, 0, 1)';
const anim = (el, frames, opts) => (el.animate && !reduce() ? el.animate(frames, opts) : { finished: Promise.resolve(), cancel() {} });

// iOS Safari 只有挂了 touchstart 才会给按钮 :active（按下去一沉靠它）
let touchWired = false;
export function wireTouchActive() {
  if (touchWired || typeof document === 'undefined') return;
  touchWired = true;
  document.addEventListener('touchstart', () => {}, { passive: true });
}

// —— 分段控件、页面胶囊：选中的那一块是一个滑块，换的时候滑过去 ——
// box 里放一个 thumb（绝对定位），selected() 返回现在选中的那个按钮
export function wireThumb(box, selected, cls = 'fl-thumb') {
  let thumb = box.querySelector(`:scope > .${cls}`);
  if (!thumb) { thumb = document.createElement('span'); thumb.className = cls; thumb.setAttribute('aria-hidden', 'true'); box.prepend(thumb); }
  box.classList.add('has-thumb');
  const sync = (instant) => {
    const b = selected();
    if (!b || !b.offsetParent) { thumb.style.opacity = '0'; return; }
    const r = b.getBoundingClientRect(), br = box.getBoundingClientRect();
    if (instant) thumb.style.transition = 'none';
    thumb.style.opacity = '1';
    thumb.style.width = `${r.width}px`;
    thumb.style.height = `${r.height}px`;
    thumb.style.transform = `translate(${r.left - br.left + box.scrollLeft}px, ${r.top - br.top + box.scrollTop}px)`;
    if (instant) { void thumb.offsetWidth; thumb.style.transition = ''; }
  };
  // 按住选中的那一格：滑块微微缩一下（iOS 的分段控件就这样）
  box.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('button, a');
    if (!b || b !== selected()) return;
    box.classList.add('is-squeeze');
    const off = () => { box.classList.remove('is-squeeze'); removeEventListener('pointerup', off); removeEventListener('pointercancel', off); };
    addEventListener('pointerup', off); addEventListener('pointercancel', off);
  });
  addEventListener('resize', () => sync(true));
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => sync(true)).observe(box);
  requestAnimationFrame(() => sync(true));
  return sync;
}

// —— 换页：新的一页按方向进来（往后的从右边、往前的从左边），淡入 ——
export function pageIn(el, dir) {
  if (!el || !dir) return;
  anim(el, [{ transform: `translateX(${dir * 40}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: SHEET });
}

// —— 数字变了：旧的往上滚走、新的从下面滚上来 ——
export function rollNumber(el, to) {
  if (!el) return;
  const next = String(to);
  const from = el.dataset.n ?? el.textContent.trim();
  el.dataset.n = next;
  if (from === next || reduce()) { el.textContent = next; return; }
  el.innerHTML = `<span class="fl-roll"><span>${from}</span><span>${next}</span></span>`;
  const [a, b] = el.querySelectorAll('.fl-roll > span');
  anim(a, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-100%)', opacity: 0 }], { duration: 380, easing: SHEET, fill: 'forwards' });
  anim(b, [{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, easing: SPRING }).finished.then(() => { if (el.dataset.n === next) el.textContent = next; });
}

// —— 往上滑过大标题：大标题淡下去，顶上出现一条毛玻璃的小标题栏；点它回到顶上 ——
export function wireNavMini(title, label) {
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.className = 'fl-navmini';
  bar.setAttribute('aria-label', '回到顶上');
  bar.innerHTML = `<b>${label}</b>`;
  document.body.append(bar);
  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = scrollY, k = Math.min(1, Math.max(0, y / 64));
      title.style.opacity = String(1 - k);
      title.style.transform = k ? `scale(${1 - k * 0.12})` : '';
      bar.classList.toggle('is-on', y > 58 && !document.documentElement.classList.contains('fl-locked'));
    });
  }, { passive: true });
  bar.addEventListener('click', () => scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' }));
  return bar;
}

// —— 换白天晚上：新的样子从手指那一点圆形铺开（浏览器支持 View Transitions 时）——
export function circleSwap(apply, at) {
  if (!document.startViewTransition || reduce() || !at) { apply(); return; }
  const r = at.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  const R = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const html = document.documentElement;
  html.classList.add('fl-vt-circle');
  const vt = document.startViewTransition(apply);
  vt.finished.finally(() => html.classList.remove('fl-vt-circle'));
  vt.ready.then(() => html.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${R}px at ${x}px ${y}px)`] }, { duration: 650, easing: SHEET, pseudoElement: '::view-transition-new(root)' })).catch(() => {});
}

// —— 开课：主角卡放大铺满，再进课堂（进课堂是整页刷新，放大这一下让它不像突然换了一页）——
export function zoomInto(from, then) {
  if (!from || reduce()) { then(); return; }
  const r = from.getBoundingClientRect();
  const z = document.createElement('div');
  z.className = 'fl-zoomout';
  Object.assign(z.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle(from).borderRadius });
  document.body.append(z);
  anim(z, [{ top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle(from).borderRadius },
    { top: '0px', left: '0px', width: `${innerWidth}px`, height: `${innerHeight}px`, borderRadius: '0px' }], { duration: 520, easing: SPRING, fill: 'forwards' })
    .finished.then(then, then);
}

// —— 面板：从原来那张卡长出来（kind: 'zoom'），或者从底下推上来（'sheet'）——
// shell 是整页内容（打开时它往后退一点、变暗、四角变圆），layer 是放面板的地方（不跟着缩）
export function createPanels({ shell, layer }) {
  const html = document.documentElement;
  const scrim = document.createElement('div');
  scrim.className = 'fl-scrim';
  layer.append(scrim);
  let open = null;
  const fadeScrim = (to, dur) => {
    const from = getComputedStyle(scrim).opacity;
    scrim.getAnimations?.().forEach((a) => a.cancel());
    scrim.style.opacity = String(to);
    anim(scrim, [{ opacity: from }, { opacity: to }], { duration: dur, easing: SHEET });
  };
  const target = (kind) => {
    const w = Math.min(innerWidth - 32, 720);
    const top = kind === 'sheet' ? Math.max(80, innerHeight * 0.3) : 30;
    return { top, left: (innerWidth - w) / 2, width: w, height: innerHeight - top + 30 };
  };
  const rectOf = (el) => (el?.isConnected && el.offsetParent ? el.getBoundingClientRect() : null);

  /** opts：kind、title、mount(body)（往面板里放东西）、unmount()（关上之后把东西放回去）、onClose、
   *  find()（面板开着时原来那张卡被重画了：找到新画的那张，关的时候缩回它） */
  function openPanel(src, opts = {}) {
    if (open) return null;
    const kind = opts.kind || 'zoom';
    const s = rectOf(src), t = target(kind);
    const z = document.createElement('div');
    z.className = `fl-panel is-${kind}`;
    z.setAttribute('role', 'dialog');
    z.setAttribute('aria-modal', 'true');
    if (opts.title) z.setAttribute('aria-label', opts.title);
    z.innerHTML = `<div class="fl-panel-in" style="width:${t.width}px;height:${t.height}px"><div class="fl-grab"><span></span><span class="fl-handle"></span><button type="button" class="fl-close" aria-label="关上"></button></div><div class="fl-body"></div></div>`;
    Object.assign(z.style, { top: `${t.top}px`, left: `${t.left}px`, width: `${t.width}px`, height: `${t.height}px` });
    layer.append(z);
    const body = z.querySelector('.fl-body');
    opts.mount?.(body);
    html.classList.add('fl-locked');
    shell?.classList.add('fl-behind');
    scrim.style.pointerEvents = 'auto';
    const zoom = kind === 'zoom' && s;
    const r0 = zoom ? getComputedStyle(src).borderRadius || '16px' : '24px';
    const from = zoom ? { top: `${s.top}px`, left: `${s.left}px`, width: `${s.width}px`, height: `${s.height}px`, borderRadius: r0 }
      : { top: `${innerHeight}px`, left: `${t.left}px`, width: `${t.width}px`, height: `${t.height}px`, borderRadius: '24px' };
    const to = { top: `${t.top}px`, left: `${t.left}px`, width: `${t.width}px`, height: `${t.height}px`, borderRadius: '24px' };
    if (zoom) src.style.visibility = 'hidden';
    const dur = kind === 'sheet' ? 520 : 560;
    fadeScrim(1, dur);
    anim(z, [from, to], { duration: dur, easing: zoom ? SPRING : SHEET });
    if (zoom) anim(z.querySelector('.fl-panel-in'), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: dur * 0.3, easing: 'ease-out', fill: 'backwards' });
    open = { z, src: zoom ? src : null, kind, opts };
    wireDrag(z);
    z.querySelector('.fl-close').addEventListener('click', () => closePanel());
    return body;
  }
  function closePanel() {
    if (!open || open.closing) return Promise.resolve();
    open.closing = true;
    const { z, opts } = open;
    resync();
    const src = open.src;
    const cur = z.getBoundingClientRect();
    z.style.transform = '';
    const s = rectOf(src);
    const to = s ? { top: `${s.top}px`, left: `${s.left}px`, width: `${s.width}px`, height: `${s.height}px`, borderRadius: getComputedStyle(src).borderRadius }
      : { top: `${innerHeight}px`, left: `${cur.left}px`, width: `${cur.width}px`, height: `${cur.height}px`, borderRadius: '24px' };
    shell?.classList.remove('fl-behind');
    anim(z.querySelector('.fl-panel-in'), [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    fadeScrim(0, 440);
    return anim(z, [{ top: `${cur.top}px`, left: `${cur.left}px`, width: `${cur.width}px`, height: `${cur.height}px`, borderRadius: '24px' }, to], { duration: 440, easing: SHEET, fill: 'forwards' }).finished.then(() => {
      if (src) { src.style.visibility = ''; anim(src, [{ transform: 'scale(.98)' }, { transform: 'none' }], { duration: 420, easing: SPRING }); }
      opts.unmount?.();
      z.remove();
      scrim.style.pointerEvents = 'none';
      html.classList.remove('fl-locked');
      open = null;
      opts.onClose?.();
    });
  }
  // 往下拖：面板跟着手指走，后面慢慢亮回来；拖得够远或甩得够快就关，不然弹回去
  function wireDrag(z) {
    const g = z.querySelector('.fl-grab');
    let y0 = 0, dy = 0, last = 0, lastT = 0, v = 0;
    g.addEventListener('pointerdown', (e) => { if (e.target.closest('.fl-close')) return; g.setPointerCapture(e.pointerId); y0 = last = e.clientY; dy = 0; lastT = performance.now(); });
    g.addEventListener('pointermove', (e) => {
      if (!g.hasPointerCapture(e.pointerId)) return;
      const d = e.clientY - y0;
      dy = d > 0 ? d : d * 0.15;
      const now = performance.now();
      v = (e.clientY - last) / Math.max(1, now - lastT); last = e.clientY; lastT = now;
      z.style.transform = `translateY(${dy}px)`;
      scrim.getAnimations?.().forEach((a) => a.cancel());
      scrim.style.opacity = String(Math.max(0, 1 - dy / 500));
    });
    const up = (e) => {
      if (!g.hasPointerCapture(e.pointerId)) return;
      g.releasePointerCapture(e.pointerId);
      if (dy > 140 || v > 0.7) { closePanel(); return; }
      anim(z, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 500, easing: SPRING });
      z.style.transform = '';
      fadeScrim(1, 400);
    };
    g.addEventListener('pointerup', up);
    g.addEventListener('pointercancel', up);
  }
  scrim.addEventListener('click', () => closePanel());
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  // 首页的数据一变就重画那几行、主角卡：面板开着时原来那张卡换成了新画的一张（看得见、关的时候找不到）。
  // 重画以后调一下：新的那张也藏起来，关的时候缩回它
  function resync() {
    if (!open || open.kind !== 'zoom' || !open.opts.find || open.src?.isConnected) return;
    const el = open.opts.find();
    open.src = el || null;
    if (el) el.style.visibility = 'hidden';
  }
  return { open: openPanel, close: closePanel, resync, get isOpen() { return !!open; } };
}

// —— 长按：那张卡被托起来、背景虚化，旁边弹出一个小菜单；点外面放回去 ——
// root 里带 data-menu 的元素按住 0.45 秒不动就弹；items(el) 返回 [{ text, icon, warn, run }]
const ICON = {
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
export function wireLongPress(root, items, { layer = document.body } = {}) {
  let swallow = false;
  let menu = null;
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-menu]');
    if (!el || menu || document.documentElement.classList.contains('fl-locked') || e.button > 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    const t = setTimeout(() => { off(); const list = items(el); if (list.length) { swallow = true; openMenu(el, list); } }, 450);
    const mv = (m) => { if (Math.hypot(m.clientX - x0, m.clientY - y0) > 10) off(); };
    const off = () => { clearTimeout(t); removeEventListener('pointerup', off); removeEventListener('pointercancel', off); removeEventListener('pointermove', mv); };
    addEventListener('pointerup', off); addEventListener('pointercancel', off); addEventListener('pointermove', mv, { passive: true });
  });
  // 长按以后松手那一下 click 不算（不然又点开了）；也不要系统的放大镜、拷贝菜单
  root.addEventListener('click', (e) => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-menu]')) e.preventDefault(); });
  function openMenu(el, list) {
    const r = el.getBoundingClientRect();
    const veil = document.createElement('div'); veil.className = 'fl-ctx';
    const lift = el.cloneNode(true);
    lift.classList.add('fl-lift'); lift.removeAttribute('data-menu'); lift.setAttribute('aria-hidden', 'true');
    lift.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    const rad = getComputedStyle(el).borderRadius;
    Object.assign(lift.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: rad === '0px' ? '16px' : rad });
    const m = document.createElement('div'); m.className = 'fl-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = list.map((x, i) => `<button type="button" role="menuitem" data-i="${i}"${x.warn ? ' class="is-warn"' : ''}>${x.text}${ICON[x.icon] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[x.icon]}</svg>` : ''}</button>`).join('');
    layer.append(veil, lift, m);
    const mh = m.offsetHeight, mw = m.offsetWidth, gap = 12;
    const below = r.bottom + gap + mh < innerHeight - 12;
    const top = below ? r.bottom + gap : Math.max(12, r.top - gap - mh);
    const left = Math.min(Math.max(12, r.left), innerWidth - mw - 12);
    Object.assign(m.style, { top: `${top}px`, left: `${left}px`, transformOrigin: `${below ? 'top' : 'bottom'} ${r.left - left < mw / 2 ? 'left' : 'right'}` });
    el.style.visibility = 'hidden';
    const big = r.width > 500 ? 1.015 : 1.04;
    anim(veil, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    anim(lift, [{ transform: 'scale(1)' }, { transform: `scale(${big})` }], { duration: 480, easing: SPRING, fill: 'forwards' });
    anim(m, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: SPRING });
    menu = { el };
    const close = (then) => {
      if (!menu) return;
      menu = null;
      anim(m, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.6)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' });
      anim(veil, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
      anim(lift, [{ transform: `scale(${big})` }, { transform: 'scale(1)' }], { duration: 300, easing: SHEET, fill: 'forwards' }).finished.then(() => { el.style.visibility = ''; veil.remove(); lift.remove(); m.remove(); then?.(); });
    };
    veil.addEventListener('click', () => close());
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) close(() => list[Number(b.dataset.i)].run()); });
    m.querySelector('button')?.focus({ preventScroll: true });
  }
}
