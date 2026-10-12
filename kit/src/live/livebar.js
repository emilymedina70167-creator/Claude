// 实时黑板（外部版）底部的一条：左边翻板（pagenav.js），右边连接状态和「⋯」（板书、复制学习记录）。
// 说话在对话框里，这里没有输入框。样式和课堂模式底部那条共用（class.css 的 .class-bar / .cb-*）。
import { createPageNav } from '../class/pagenav.js';
import { VERSION } from '../version.js';

const ICON = {
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11.5" height="12" rx="2"/><path d="M15.5 8V6a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H8"/></svg>',
};

export function createLiveBar({ onNav, onCopy } = {}) {
  const el = document.createElement('div');
  el.className = 'class-bar is-board-only';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', '翻板');
  el.innerHTML = `
    <div class="cb-ctrl">
      <div class="lb-side">
        <span class="live-chip" data-state="wait"><i></i><span>连接中</span></span>
        <button type="button" class="cb-tool cb-more" aria-label="更多" aria-haspopup="menu" aria-expanded="false" title="板书、复制学习记录">${ICON.more}</button>
      </div>
      <div class="cb-menu" hidden role="menu" aria-label="黑板菜单">
        <div class="cb-dock"></div>
        <button type="button" class="cb-item cb-copy" role="menuitem">${ICON.copy}<span>复制学习记录</span></button>
        <div class="cb-ver" title="这个页面用的组件库版本（和项目说明的版本号对得上就是最新的）">组件库 ${VERSION}</div>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('class-on');
  const $ = (s) => el.querySelector(s);
  const ctrl = $('.cb-ctrl');
  const chip = $('.live-chip');
  const moreBtn = $('.cb-more');
  const menu = $('.cb-menu');
  const dock = $('.cb-dock');

  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  let menuOpen = false;
  function setMenu(v) {
    menuOpen = !!v;
    menu.hidden = !menuOpen;
    moreBtn.classList.toggle('on', menuOpen);
    moreBtn.setAttribute('aria-expanded', String(menuOpen));
  }
  const pageNav = createPageNav({ onNav, onOpen: () => setMenu(false) });
  ctrl.prepend(pageNav.nav);
  ctrl.append(pageNav.menu);
  // 「下面还有 ↓」放在翻板条右边（板 boardview.js 挂进来），不浮在黑板上挡住内容
  const moreSlot = document.createElement('span');
  moreSlot.className = 'cb-more-slot';
  pageNav.nav.after(moreSlot);
  on(moreBtn, 'click', (e) => { e.stopPropagation(); if (!menuOpen) pageNav.close(); setMenu(!menuOpen); });
  // 挂在 window 的捕获阶段：板书开着时，笔的 pointerdown 在 document 上就被板书层拦下了
  on(window, 'pointerdown', (e) => { if (menuOpen && e.target instanceof Element && !menu.contains(e.target) && !moreBtn.contains(e.target)) setMenu(false); }, { capture: true, passive: true });
  on(document, 'keydown', (e) => { if (e.key === 'Escape' && menuOpen) { setMenu(false); moreBtn.focus({ preventScroll: true }); } });
  on($('.cb-copy'), 'click', () => { setMenu(false); onCopy?.(); });
  on(dock, 'click', (e) => { if (e.target.closest('.ink-fab')) setTimeout(() => setMenu(false), 0); });

  // 「板书」本来是页面左下角的浮动按钮，会压住黑板最下面的题：收进「⋯」菜单
  let inkWatch = null, inkClass = null;
  function adoptInk() {
    const fab = document.querySelector('body > .ink-fab');
    if (!fab) return false;
    fab.setAttribute('role', 'menuitemcheckbox');
    dock.appendChild(fab);
    // 板书开着时「⋯」上亮一个小黄点：收起菜单也看得出来
    const sync = () => moreBtn.classList.toggle('has-ink', fab.classList.contains('on'));
    inkClass = new MutationObserver(sync);
    inkClass.observe(fab, { attributes: true, attributeFilter: ['class'] });
    sync();
    return true;
  }
  if (!adoptInk() && typeof MutationObserver === 'function') {
    inkWatch = new MutationObserver(() => { if (adoptInk()) { inkWatch.disconnect(); inkWatch = null; } });
    inkWatch.observe(document.body, { childList: true });
  }

  // 高度：留出底部空白，黑板最下面的组件不被挡住
  const root = document.documentElement;
  const publish = () => root.style.setProperty('--class-bar-h', Math.round(el.offsetHeight) + 'px');
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
  ro?.observe(el);
  publish();

  return {
    el,
    get height() { return el.offsetHeight; },
    setNav(state) { pageNav.setNav(state); },
    moreSlot,
    // state：wait 连接中 / on 连上了 / off 断了
    setChip(state, text) { chip.dataset.state = state; chip.querySelector('span').textContent = text; },
    destroy() {
      cleanups.forEach((f) => f());
      pageNav.destroy();
      ro?.disconnect();
      inkWatch?.disconnect();
      inkClass?.disconnect();
      const fab = dock.querySelector('.ink-fab');
      if (fab) { fab.removeAttribute('role'); document.body.appendChild(fab); }
      el.remove();
      document.body.classList.remove('class-on');
      root.style.removeProperty('--class-bar-h');
    },
  };
}
