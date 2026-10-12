// 实时黑板（外部版）底部的一条：左边翻板（pagenav.js），右边「交截图」、连接状态和「⋯」（板书、复制学习记录）。
// 说话在对话框里，这里没有输入框。样式和课堂模式底部那条共用（class.css 的 .class-bar / .cb-*）。
// 「交截图」：在笔记软件里写好，截图贴进来交给对话里的 Claude（存进 assets，记在 uploads，黑板现状里列出来）。
import { createPageNav } from '../class/pagenav.js';
import { clipboardImages, htmlImageSrcs, toPng, srcToPng } from '../class/bar.js';
import { VERSION } from '../version.js';

const ICON = {
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11.5" height="12" rx="2"/><path d="M15.5 8V6a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H8"/></svg>',
  shot: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-4.5-4.5-7.5 8"/></svg>',
};
const MAX_UP = 4; // 一次最多交几张


/** onUpload(blobs, note)：交截图，返回 Promise（失败时抛出带说明的错误）；不传就没有「交截图」 */
export function createLiveBar({ onNav, onCopy, onUpload } = {}) {
  const el = document.createElement('div');
  el.className = 'class-bar is-board-only';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', '翻板');
  el.innerHTML = `
    <div class="cb-paste lb-up" hidden role="dialog" aria-label="交截图">
      <div class="cb-slate-head"><strong>交截图给 Claude</strong><span>长按下面的框选「粘贴」：Notability 圈选拷贝、系统截图都行</span><button type="button" class="cb-paste-x" aria-label="收起">收起</button></div>
      <div class="cb-paste-row">
        <div class="cb-paste-zone" contenteditable="true" role="textbox" aria-label="在这里粘贴图片" data-hint="长按这里，选「粘贴」" spellcheck="false" autocorrect="off" autocapitalize="off"></div>
        <button type="button" class="btn cb-pick">从相册选</button>
      </div>
      <div class="cb-attach lb-thumbs" hidden></div>
      <div class="lb-up-row">
        <input type="text" class="lb-note" maxlength="200" enterkeyhint="send" placeholder="一句话说明（可不写），比如：第二题的过程" aria-label="给 Claude 的说明">
        <button type="button" class="btn btn-primary lb-send" disabled>交给 Claude</button>
      </div>
      <input type="file" class="lb-file" accept="image/*" multiple hidden>
    </div>
    <div class="cb-ctrl">
      <div class="lb-side">
        <button type="button" class="cb-tool lb-shot" aria-label="交截图" aria-expanded="false" title="把笔记软件里写的截图交给 Claude" hidden>${ICON.shot}<span>交截图</span></button>
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

  // —— 交截图：和课堂模式的「附图」一样，iPad 的 Safari 只往可编辑的框里插 Notability 圈选拷贝的图 ——
  const up = $('.lb-up');
  const zone = $('.cb-paste-zone');
  const thumbs = $('.lb-thumbs');
  const note = $('.lb-note');
  const sendBtn = $('.lb-send');
  const shotBtn = $('.lb-shot');
  const fileInput = $('.lb-file');
  let picked = []; // { blob, url }
  let sending = false;
  shotBtn.hidden = !onUpload;
  function openUp(v) {
    up.hidden = !v;
    shotBtn.classList.toggle('on', !!v);
    shotBtn.setAttribute('aria-expanded', String(!!v));
    if (v) { setMenu(false); pageNav.close(); }
  }
  function say(msg, warn) {
    thumbs.hidden = false;
    let n = thumbs.querySelector('.cb-attach-note');
    if (!n) { n = document.createElement('span'); n.className = 'cb-attach-note'; thumbs.appendChild(n); }
    n.textContent = msg;
    n.classList.toggle('is-warn', !!warn);
  }
  function renderPicked() {
    thumbs.hidden = !picked.length;
    thumbs.innerHTML = picked.map((p, i) => `<figure class="cb-thumb"><img src="${p.url}" alt="第 ${i + 1} 张"><button type="button" class="cb-unattach" data-i="${i}" aria-label="去掉第 ${i + 1} 张">×</button></figure>`).join('')
      + (picked.length ? `<span class="cb-attach-note">${picked.length}/${MAX_UP} 张</span>` : '');
    sendBtn.disabled = !picked.length || sending;
  }
  async function takeImages(list) {
    const room = MAX_UP - picked.length;
    if (room <= 0) { say(`一次最多交 ${MAX_UP} 张`, true); return; }
    const out = [];
    for (const f of [...list].slice(0, room)) {
      try { out.push(await (typeof f === 'string' ? srcToPng(f) : toPng(f))); } catch { /* 读不出来的跳过 */ }
    }
    if (!out.length) { say('这张图读不出来，换成系统截图「拷贝并删除」再粘贴试试', true); return; }
    picked = [...picked, ...out.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))];
    renderPicked();
  }
  on(shotBtn, 'click', (e) => { e.stopPropagation(); openUp(up.hidden); });
  on($('.lb-up .cb-paste-x'), 'click', () => openUp(false));
  on($('.lb-up .cb-pick'), 'click', () => fileInput.click());
  on(fileInput, 'change', async () => { await takeImages(fileInput.files || []); fileInput.value = ''; });
  // 剪贴板里有图片文件（系统截图）就直接拿；没有就不拦，等浏览器把图插进框里再从框里取
  on(zone, 'paste', (e) => {
    const files = clipboardImages(e.clipboardData);
    const srcs = files.length ? [] : htmlImageSrcs(e.clipboardData?.getData?.('text/html'));
    if (!files.length && !srcs.length) return;
    e.preventDefault();
    takeImages(files.length ? files : srcs);
  });
  on(zone, 'beforeinput', (e) => { if (!/^insertFrom(Paste|Drop)/.test(e.inputType || '')) e.preventDefault(); }); // 只收图，不让打字
  on(zone, 'input', async () => {
    const srcs = [...zone.querySelectorAll('img')].map((n) => n.src).filter(Boolean);
    const jobs = srcs.slice(0, Math.max(0, MAX_UP - picked.length)).map((src) => srcToPng(src).catch(() => null));
    const typed = !srcs.length && zone.textContent.trim();
    zone.innerHTML = '';
    if (!srcs.length) { if (typed) say('这个框只收图片，说明写在下面那一行', true); return; }
    const blobs = (await Promise.all(jobs)).filter(Boolean);
    if (!blobs.length) { say('框里出现了图片，但读不出来。换成系统截图「拷贝并删除」再粘贴试试', true); return; }
    picked = [...picked, ...blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))];
    renderPicked();
  });
  on(thumbs, 'click', (e) => {
    const b = e.target.closest('.cb-unattach');
    if (!b) return;
    const [gone] = picked.splice(Number(b.dataset.i), 1);
    if (gone) URL.revokeObjectURL(gone.url);
    renderPicked();
  });
  async function send() {
    if (!picked.length || sending) return;
    sending = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '正在交…';
    try {
      await onUpload(picked.map((p) => p.blob), note.value.trim());
      picked.forEach((p) => setTimeout(() => URL.revokeObjectURL(p.url), 1000));
      picked = [];
      note.value = '';
      renderPicked();
      openUp(false);
    } catch (err) {
      say(err?.message || '没交上，再试一次', true);
    } finally {
      sending = false;
      sendBtn.textContent = '交给 Claude';
      sendBtn.disabled = !picked.length;
    }
  }
  on(sendBtn, 'click', send);
  on(note, 'keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } });
  on(document, 'keydown', (e) => { if (e.key === 'Escape' && !up.hidden) openUp(false); });

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
      picked.forEach((p) => URL.revokeObjectURL(p.url));
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
