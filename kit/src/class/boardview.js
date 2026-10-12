// 一屏一块板（课堂模式和实时黑板共用）：页面结构、板（section.class-page）、常驻栏、翻板、划动、
// 一屏放不放得下的测量（--board-h、「下面还有」、横屏时输入框靠在黑板那一栏）、宽屏左图右文。
// 板上写什么、存到哪、什么时候换板由各自的控制器决定；这里只管怎么摆、怎么翻。
import { mdToHtml } from '../render.js';

const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// 一块板超出一屏多少才算放不下（KaTeX、图的取整会差几个像素）
const FIT_SLACK = 12;
// 在这些东西上划动不算翻页：要拖的图、要选的字、要横着滚的公式
const NO_SWIPE = 'input, textarea, select, button, a, label, [contenteditable=""], [contenteditable="true"], svg, canvas, .keypad, .ink-bar, .class-pins';

/**
 * root：课件的 <article>；unitHtml：常驻栏顶上的单元名；stageExtra：黑板区里板以外的东西（欢迎牌之类）。
 * isBusy()：Claude 正在写（翻回去看时「回到当前板」闪）；seqOf(id)：段的先后（同一块板上按它排）；
 * onShow(n)：换了正在看的板；onMeasure(fit)：量过一次一屏放不放得下。底部的条（bar.setNav、bar.height、bar.el）建好后用 attachBar 接上。
 */
export function createBoardView({ root, unitHtml = '', stageExtra = '', isBusy = () => false, seqOf = () => Infinity, onShow, onMeasure } = {}) {
  // 常驻栏（横屏在右边一栏，竖屏在顶上一条）+ 黑板。黑板里一块板一个 section，只显示正在看的那块
  root.innerHTML = `
    <div class="class-app">
      <aside class="class-pins" hidden aria-label="常驻栏"><div class="class-pins-head"><span class="class-unit">${unitHtml}</span></div><div class="class-pins-body"></div></aside>
      <main class="class-stage" aria-label="黑板">
        <div class="class-pages"></div>
        ${stageExtra}
      </main>
    </div>`;
  const board = root.querySelector('.class-app');
  const stage = root.querySelector('.class-stage');
  const pagesBox = root.querySelector('.class-pages');
  const pinsBox = root.querySelector('.class-pins');
  const pinsBody = root.querySelector('.class-pins-body');

  const pages = new Map(); // 板号 → { n, title, talk, lead, kind, body, sec, head, titleEl, talkEl, bodyEl }
  let pageSeq = 0; // 开过几块板（板号从 1 编）
  let curPage = 0; // 当前板：最新的那块
  let viewPage = 0; // 正在看的板：翻回去看历史时和 curPage 不同
  let lastFit = null; // 当前板放不放得下一屏：{ fits, need, avail, w }
  let fitRaf = 0;
  let bar = null;

  // 当前板超出一屏、下面还有内容没露出来时，底部条上方给一个「下面还有」
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'class-more';
  more.hidden = true;
  more.textContent = '下面还有 ↓';
  more.addEventListener('click', () => window.scrollBy({ top: Math.round(window.innerHeight * 0.6), behavior: reduceMotion() ? 'auto' : 'smooth' }));
  document.body.appendChild(more);

  function ensurePage(n) {
    let p = pages.get(n);
    if (p) return p;
    const sec = document.createElement('section');
    sec.className = 'class-page';
    sec.dataset.page = String(n);
    sec.hidden = true;
    sec.setAttribute('aria-label', `第 ${n} 块板`);
    // 板书：写在板头、板顶那句话上的笔迹挂在这块板上（翻走就藏起来）；「清空」清的是整块板
    sec.dataset.inkAnchor = `p${n}`;
    sec.dataset.inkGroup = '';
    sec.innerHTML = '<header class="class-page-head" hidden><h2 class="class-page-title"></h2></header><div class="class-talk" hidden></div><div class="class-page-body"></div>';
    p = { n, title: '', talk: '', lead: '', kind: '', body: '', sec, head: sec.querySelector('.class-page-head'), titleEl: sec.querySelector('.class-page-title'), talkEl: sec.querySelector('.class-talk'), bodyEl: sec.querySelector('.class-page-body') };
    pages.set(n, p);
    // 按板号插：恢复时板号可能不是按顺序来的
    const after = [...pagesBox.children].find((c) => Number(c.dataset.page) > n);
    pagesBox.insertBefore(sec, after || null);
    pageSeq = Math.max(pageSeq, n);
    return p;
  }

  // 拿掉一块板（实时黑板里一块板上的段都撤回了）。正在看它就回到当前板
  function removePage(n) {
    const p = pages.get(n);
    if (!p) return;
    p.sec.remove();
    pages.delete(n);
    if (viewPage === n) show(curPage, { scroll: false });
    else syncNav();
  }

  // 擦掉黑板，开一块新板（成为当前板）。存不存由调用方管
  function addPage(fields = {}) {
    const p = ensurePage(pageSeq + 1);
    Object.assign(p, fields);
    curPage = p.n;
    paint(p);
    return p;
  }

  // 板的标题、板顶的话、小结正文画出来
  function paint(p) {
    p.titleEl.innerHTML = p.title ? mdToHtml(p.title, { inline: true }) : '';
    p.head.hidden = !p.title;
    p.talkEl.innerHTML = p.talk ? mdToHtml(p.talk) : '';
    p.talkEl.hidden = !p.talk;
    p.sec.classList.toggle('is-closing', p.kind === 'closing');
    let closing = p.bodyEl.querySelector(':scope > .class-closing');
    if (p.kind === 'closing') {
      if (!closing) { closing = document.createElement('div'); closing.className = 'class-closing'; p.bodyEl.prepend(closing); }
      closing.innerHTML = mdToHtml(p.body || '');
    } else closing?.remove();
  }

  // 只显示一块板。scroll：回到页面顶上（换了板，从板的开头看）
  function show(n, { scroll = true, animate = false } = {}) {
    const target = pages.has(n) ? n : curPage;
    const changed = target !== viewPage;
    viewPage = target;
    for (const p of pages.values()) p.sec.hidden = p.n !== viewPage;
    const shown = pages.get(viewPage);
    if (changed && animate && shown && !reduceMotion()) {
      shown.sec.classList.remove('is-enter');
      void shown.sec.offsetWidth; // 重新播一次进场
      shown.sec.classList.add('is-enter');
    }
    if (changed && scroll) window.scrollTo({ top: 0, behavior: 'auto' });
    // 板书挂在段上：翻走的板上的笔迹不画，翻出来的板上的笔迹画回来
    if (changed) window.LAKit?.ink?.redraw?.();
    syncNav();
    scheduleFit();
    if (changed) onShow?.(viewPage);
  }

  function go(n) {
    if (!pages.size) return;
    const target = Math.max(1, Math.min(pageSeq, Number(n) || curPage));
    if (target === viewPage) return;
    show(target, { animate: true });
  }

  // 往前 / 往后翻一块（划动、方向键）：按实际有的板走，板号中间缺了一块（那块没存上）也不会卡住
  function step(d) {
    const ns = [...pages.keys()].sort((a, b) => a - b);
    const to = ns[ns.indexOf(viewPage) + d];
    if (to !== undefined) go(to);
  }

  function syncNav() {
    bar?.setNav({
      view: viewPage, cur: curPage,
      items: [...pages.values()].sort((a, b) => a.n - b.n).map((p) => ({ n: p.n, title: p.title || (p.kind === 'closing' ? '这节课的小结' : '') })),
      busy: isBusy(),
    });
  }

  // 常驻栏里有看得见的卡才露出来；横屏时它占右边一栏
  function syncPins() {
    const pinned = [...pinsBody.children].some((c) => !c.hidden);
    pinsBox.hidden = !pinned;
    board.classList.toggle('has-pins', pinned);
    return pinned;
  }

  // —— 一屏放不放得下：黑板可用的高度给 CSS（--board-h），当前板的内容高度报给讲课的 Claude ——
  function scheduleFit() {
    if (fitRaf) return;
    fitRaf = requestAnimationFrame(() => { fitRaf = 0; measureFit(); });
  }
  function measureFit() {
    const sr = stage.getBoundingClientRect();
    // 横屏时常驻栏在右边一栏：底部的条只放在黑板那一栏下面（CSS 用 --cb-l / --cb-r 当左右边距）
    const docked = !pinsBox.hidden && pinsBox.getBoundingClientRect().left >= sr.right - 1;
    document.body.classList.toggle('class-docked', docked);
    if (docked) {
      document.body.style.setProperty('--cb-l', `${Math.round(sr.left)}px`);
      document.body.style.setProperty('--cb-r', `${Math.max(0, Math.round(document.documentElement.clientWidth - sr.right))}px`);
    }
    // 竖屏常驻栏是一条：放不下的卡底下渐隐，点开看全部
    for (const card of pinsBody.children) card.classList.toggle('is-clipped', !card.classList.contains('is-open') && card.scrollHeight > card.clientHeight + 2);
    const top = sr.top + window.scrollY;
    const avail = Math.max(240, Math.round(window.innerHeight - (bar?.height || 0) - top - 10));
    board.style.setProperty('--board-h', `${avail}px`);
    const p = pages.get(curPage);
    if (p && !p.sec.hidden) {
      const r = p.sec.getBoundingClientRect();
      const last = [...p.sec.querySelectorAll(':scope > *, :scope > .class-page-body > *')].filter((el) => !el.hidden && el.offsetParent !== null).at(-1);
      const need = Math.round(last ? last.getBoundingClientRect().bottom - r.top : 0);
      lastFit = { fits: need <= avail + FIT_SLACK, need, avail, w: Math.round(r.width) };
      p.sec.classList.toggle('is-overflow', !lastFit.fits);
    }
    syncMoreHint();
    onMeasure?.(lastFit);
    return lastFit;
  }
  function syncMoreHint() {
    const p = pages.get(viewPage);
    if (!p || p.sec.hidden) { if (!more.hidden) { more.hidden = true; bar?.syncCtrl?.(); } return; }
    const bottom = p.sec.getBoundingClientRect().bottom;
    const hide = !(bottom > window.innerHeight - (bar?.height || 0) + 24);
    if (more.hidden !== hide) { more.hidden = hide; bar?.syncCtrl?.(); }
  }
  window.addEventListener('resize', scheduleFit, { passive: true });
  window.addEventListener('orientationchange', scheduleFit, { passive: true });
  window.addEventListener('scroll', syncMoreHint, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleFit) : null;
  ro?.observe(pagesBox);
  ro?.observe(pinsBox);

  // —— 左右划动翻板（只认手指；在图、输入框、按钮上划不算；屏幕边缘留给系统的返回手势）——
  let swipe = null;
  const scrollsSideways = (el) => {
    for (let n = el; n && n !== stage; n = n.parentElement) if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
    return false;
  };
  stage.addEventListener('touchstart', (e) => {
    swipe = null;
    if (e.touches.length !== 1 || pages.size < 2) return;
    if (document.body.classList.contains('ink-on') || document.body.classList.contains('has-keypad')) return;
    const t = e.touches[0];
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest(NO_SWIPE) || scrollsSideways(target)) return;
    if (t.clientX < 28 || t.clientX > window.innerWidth - 28) return;
    swipe = { x: t.clientX, y: t.clientY, t: performance.now(), sy: window.scrollY };
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y, dt = performance.now() - swipe.t;
    const scrolled = Math.abs(window.scrollY - swipe.sy) > 12;
    swipe = null;
    if (scrolled || dt > 700 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.5) return;
    step(dx < 0 ? 1 : -1);
  }, { passive: true });
  stage.addEventListener('touchcancel', () => { swipe = null; }, { passive: true });
  // 外接键盘：← → 翻板（在输入框里打字时不算）
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .keypad, .cb-menu, .cb-pages')) return;
    step(e.key === 'ArrowRight' ? 1 : -1);
  });

  // 竖屏时常驻栏是横着的一条，长的卡片先收着：点一下展开 / 收起
  pinsBody.addEventListener('click', (e) => {
    const card = e.target.closest('.class-pin');
    if (!card || e.target.closest('button, a, input, textarea, svg, .keypad')) return;
    if (!card.classList.contains('is-clipped') && !card.classList.contains('is-open')) return;
    card.classList.toggle('is-open');
    scheduleFit();
  });

  // 一段里正好有一张图（scene / graph / space，不是绑定了 steps 的那种）和别的内容：宽屏时排成左图右文。
  // 只记下图要占几行，排版交给 CSS 的容器查询（窄屏照原来的顺序上下排）
  // 图占左栏、跨过右栏所有的行，最后一行是 1fr：图比右栏高时多出来的高度都给最后一行，右栏的内容之间不被拉开
  function splitFigure(body) {
    const kids = [...body.children];
    const figs = kids.filter((el) => el.matches('.block-scene, .block-graph, .block-space') && !el.dataset.link);
    if (figs.length !== 1 || body.querySelector(':scope > .steps-pair')) return;
    const heads = kids.filter((el) => el.tagName === 'H2');
    if (heads.length > 1 || (heads.length && kids[0] !== heads[0])) return; // 小标题不在开头：照原样排
    const text = kids.filter((el) => el !== figs[0] && el.tagName !== 'H2');
    if (!text.length) return;
    const head = heads.length ? 1 : 0;
    body.classList.add('seg-split');
    figs[0].classList.add('split-fig');
    body.style.setProperty('--split-rows', `${head ? 'auto ' : ''}repeat(${text.length}, auto) 1fr`);
    figs[0].style.setProperty('--fig-row', `${1 + head} / span ${text.length + 1}`);
  }

  // 把一段放进它那块板（同一块板上按先后排）或常驻栏；替换时放在原位置。
  // seg：{ id, sec, page, place: 'board' | 'pin' }
  function place(seg, sec) {
    if (seg.sec?.isConnected && seg.sec !== sec) { seg.sec.after(sec); return; }
    const host = seg.place === 'pin' ? pinsBody : ensurePage(seg.page || curPage || 1).bodyEl;
    const mine = seg.seq ?? seqOf(seg.id);
    const after = [...host.children].find((c) => c !== sec && (seqOf(c.dataset.step) ?? Infinity) > mine);
    host.insertBefore(sec, after || null);
  }

  return {
    board, stage, pagesBox, pinsBox, pinsBody, pages, more,
    get cur() { return curPage; },
    set cur(n) { curPage = n; },
    get view() { return viewPage; },
    get seq() { return pageSeq; },
    get fit() { return lastFit; },
    attachBar(b) {
      bar = b;
      if (bar?.el) ro?.observe(bar.el);
      // 底部的条给了位置：「下面还有」挂进去，跟翻板条排在一起
      if (bar?.moreSlot) { bar.moreSlot.appendChild(more); more.classList.add('in-bar'); }
      syncNav();
      scheduleFit();
    },
    ensurePage, addPage, removePage, paint, show, go, step, syncNav, syncPins, scheduleFit, measureFit, splitFigure, place,
  };
}
