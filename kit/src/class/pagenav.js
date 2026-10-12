// 翻板条（课堂模式和实时黑板共用）：‹ › 一块一块翻；点「第 3 / 5 块」列出所有的板；翻回去看时「回到当前板」。
// 只管自己这几个按钮和那张单子，放在哪由调用的一方决定（放进一个 position: relative 的容器里，单子从它上沿弹出来）。

const ICON = {
  prev: '<svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg>',
};

const escapeText = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 翻板条上的字：第几块 / 一共几块
export function navLabel(view, total) {
  return total > 0 ? { n: String(Math.max(1, Math.min(view || total, total))), of: `/ ${total}` } : { n: '', of: '' };
}

/**
 * onNav(n)：要看第 n 块板；onOpen()：板的单子要打开了（调用方顺手收起自己别的弹出菜单）。
 * 返回 { nav, menu, setNav({ view, cur, items: [{ n, title }], busy }), close(), get shown, destroy() }
 */
export function createPageNav({ onNav, onOpen } = {}) {
  const nav = document.createElement('div');
  nav.className = 'cb-nav';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', '翻板');
  nav.hidden = true;
  nav.innerHTML = `
    <button type="button" class="cb-nav-btn cb-prev" aria-label="上一块板">${ICON.prev}</button>
    <button type="button" class="cb-nav-label" aria-haspopup="menu" aria-expanded="false" title="所有的板"><span class="cb-nav-word">第</span><span class="cb-nav-n"></span><span class="cb-nav-of"></span><span class="cb-nav-word">块</span></button>
    <button type="button" class="cb-nav-btn cb-next" aria-label="下一块板">${ICON.next}</button>
    <button type="button" class="cb-now" hidden>回到当前板</button>`;
  const menu = document.createElement('div');
  menu.className = 'cb-pages';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '所有的板');
  const prevBtn = nav.querySelector('.cb-prev');
  const nextBtn = nav.querySelector('.cb-next');
  const labelBtn = nav.querySelector('.cb-nav-label');
  const nowBtn = nav.querySelector('.cb-now');

  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  let state = { view: 0, cur: 0, items: [], busy: false };
  let open = false;
  function setOpen(v) {
    open = !!v && state.items.length > 0;
    menu.hidden = !open;
    labelBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    // 显示的是第几块（按顺序数），不是板号：实时黑板里板号中间可以空着
    menu.innerHTML = state.items.map((it, i) => ({ it, k: i + 1 })).reverse().map(({ it, k }) => {
      const tags = [it.n === state.cur ? '当前' : '', it.n === state.view && it.n !== state.cur ? '正在看' : ''].filter(Boolean);
      return `<button type="button" class="cb-page-item${it.n === state.view ? ' is-view' : ''}" role="menuitem" data-n="${it.n}"><b>${k}</b><span>${escapeText(it.title || '（没有标题）')}</span>${tags.length ? `<i>${tags.join(' · ')}</i>` : ''}</button>`;
    }).join('');
    menu.querySelector('.is-view')?.scrollIntoView({ block: 'nearest' });
  }
  function sync() {
    const { view, cur, items, busy } = state;
    const total = items.length;
    nav.hidden = total < 2; // 只有一块板时没什么可翻
    const idx = items.findIndex((it) => it.n === view);
    const lab = navLabel(idx >= 0 ? idx + 1 : view, total);
    labelBtn.querySelector('.cb-nav-n').textContent = lab.n;
    labelBtn.querySelector('.cb-nav-of').textContent = lab.of;
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= total - 1;
    nowBtn.hidden = !total || view === cur;
    // 翻回去看的时候，当前板上来了新东西（Claude 正在写）：「回到当前板」轻轻闪
    nowBtn.classList.toggle('is-live', !!busy);
    if (open) setOpen(true);
  }
  const step = (d) => {
    const idx = state.items.findIndex((it) => it.n === state.view);
    const to = state.items[idx + d];
    if (to) onNav?.(to.n);
  };
  on(prevBtn, 'click', () => step(-1));
  on(nextBtn, 'click', () => step(1));
  on(nowBtn, 'click', () => onNav?.(state.cur));
  on(labelBtn, 'click', (e) => { e.stopPropagation(); if (!open) onOpen?.(); setOpen(!open); });
  on(menu, 'click', (e) => {
    const b = e.target.closest('.cb-page-item');
    if (!b) return;
    setOpen(false);
    onNav?.(Number(b.dataset.n));
  });
  // 挂在 window 的捕获阶段：板书开着时，笔的 pointerdown 在 document 上就被板书层拦下了
  on(window, 'pointerdown', (e) => { if (open && e.target instanceof Element && !menu.contains(e.target) && !labelBtn.contains(e.target)) setOpen(false); }, { capture: true, passive: true });
  on(document, 'keydown', (e) => { if (e.key === 'Escape' && open) { setOpen(false); labelBtn.focus({ preventScroll: true }); } });

  return {
    nav,
    menu,
    setNav(next) {
      state = { view: Number(next?.view) || 0, cur: Number(next?.cur) || 0, items: Array.isArray(next?.items) ? next.items : [], busy: !!next?.busy };
      sync();
    },
    close() { setOpen(false); },
    get shown() { return !nav.hidden; },
    destroy() { cleanups.forEach((f) => f()); nav.remove(); menu.remove(); },
  };
}
