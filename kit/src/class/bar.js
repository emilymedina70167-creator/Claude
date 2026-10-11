// 课堂模式的底部输入框：黑板下面浮着的一条粉笔框，只用来对 Claude 说话。
// Claude 说的话、画的东西都写在黑板上（课堂控制器负责），这里不显示消息。
// 一行：手写 · 截图 · 输入框 · 发送（生成中变「停止」）·「⋯」菜单（板书、复制学习记录、下课、模型标记）。
// 只在需要时多出东西：附上的图（输入框上沿一排小照片）、出错 / 提示（输入框上面一条，带「重试」）、手写板。
// 「Claude 在想 / 在写」的指示（indicator）由这里更新，但放在黑板末尾（控制器把它挂上去），眼睛不用离开黑板。
import { createPad } from '../ink/pad.js';
import { FEATURES } from '../features.js';

export const QUICK = ['没懂', '想不出来', '换个说法', '继续'];
export const MAX_IMAGES = 4;
export const MODEL_TAG = 'Opus 5.5 · high';
export const CONFIRM_MS = 3000;
export const LONG_WAIT_MS = 12000; // 第一个字迟迟不来：换一句「想得细一点」的话，别让人以为卡死了
const STATUS_TEXT = { thinking: 'Claude 在想…', writing: 'Claude 正在写黑板…', error: '这一轮没成功。' };
const LONG_WAIT_TEXT = 'Claude 想得细，第一句话要等一会儿…';
const STATES = new Set(['idle', 'thinking', 'writing', 'error', 'notice']);
const MAX_SIDE = 2400;
const PLACEHOLDER = { on: '和 Claude 说点什么，黑板上的作答它也看得到', images: '和 Claude 说点什么，也可以粘贴截图', short: '和 Claude 说点什么…', off: '现在没法和 Claude 说话' };

// —— 纯函数（不碰 DOM，单元测试直接测）——

// 状态行显示什么。未知状态按 idle；没给文字时用默认文字
export function statusView(state, text) {
  const s = STATES.has(state) ? state : 'idle';
  return {
    state: s,
    text: String(text ?? '').trim() || STATUS_TEXT[s] || '',
    retry: s === 'error',
    live: s === 'thinking' || s === 'writing',
  };
}

// 回车发送，Shift+回车换行。输入法组字时的回车只是确认候选词：
// Chrome / Firefox 里 isComposing 为真；Safari 先结束组字再发 keydown，只能靠 keyCode 229 认出来
export function isSendKey(e) {
  return !!e && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229;
}

// iPad 软键盘弹出时，fixed 在底部的条在键盘后面：算出要往上抬多少
export function keyboardLift(innerHeight, vv) {
  if (!vv || !(innerHeight > 0) || !(vv.height > 0)) return 0;
  if (vv.scale > 1.01) return 0; // 双指放大时可视区变小，不是键盘
  const n = innerHeight - vv.height - (vv.offsetTop || 0);
  return n >= 1 ? Math.round(n) : 0;
}

// 黑板上获得焦点的东西要露在 [minTop, maxBottom] 之间（对话条或键盘上面、顶上进度条下面）：
// 算出页面要滚多少（正数往下滚）。太高放不下时先保证上沿看得见
export function clearScroll(r, minTop, maxBottom) {
  if (!r || !(r.bottom > r.top) || !(maxBottom > minTop)) return 0;
  let dy = r.bottom > maxBottom ? r.bottom - maxBottom : 0;
  if (r.top - dy < minTop) dy = r.top - minTop;
  return Math.abs(dy) < 1 ? 0 : Math.round(dy);
}

// 会弹出软键盘的输入框（按钮、勾选框不算）
export const FIELD = 'textarea, select, [contenteditable=""], [contenteditable="true"], input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="hidden"])';

// 预填：输入框里已经有字就不动（不覆盖学生正在写的话）
export function mergePrefill(current, text) {
  const cur = String(current ?? '');
  return cur.trim() ? cur : String(text ?? '');
}

// 两次确认：第一次点只是「上膛」，ms 毫秒内再点才算数
export function createConfirm(ms = CONFIRM_MS, now = () => Date.now()) {
  let at = -Infinity;
  return {
    tap() {
      const t = now();
      if (t - at <= ms) { at = -Infinity; return 'fire'; }
      at = t;
      return 'arm';
    },
    reset() { at = -Infinity; },
    get armed() { return now() - at <= ms; },
  };
}

// 附图：最多 max 张，多出来的不要
export function addImages(list, blobs, max = MAX_IMAGES) {
  const room = Math.max(0, max - list.length);
  const add = [...(blobs || [])].filter(Boolean);
  return { list: [...list, ...add.slice(0, room)], dropped: Math.max(0, add.length - room) };
}

// 剪贴板 / 拖放里的图片文件（iOS 上 files 常为空，图在 items 里）
export function clipboardImages(dt) {
  const out = [];
  for (const it of dt?.items || []) {
    if (it.kind === 'file' && /^image\//.test(it.type || '')) { const f = it.getAsFile?.(); if (f) out.push(f); }
  }
  if (!out.length) for (const f of dt?.files || []) if (/^image\//.test(f.type || '')) out.push(f);
  return out;
}

// 有的应用拷贝出来的图只在 text/html 里（一个 <img>），取出它的地址
export function htmlImageSrcs(html) {
  return [...String(html ?? '').matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)]
    .map((m) => (m[1] || m[2]).replace(/&amp;/g, '&'))
    .filter((src) => /^(data:image\/|blob:|https?:)/i.test(src));
}

// 多行输入框自动增高：最多 maxLines 行，再多就在框里滚动
export function growHeight({ scrollHeight, lineHeight, padding = 0, maxLines = 4 }) {
  const max = Math.round(lineHeight * maxLines + padding);
  const min = Math.round(lineHeight + padding);
  return { height: Math.max(min, Math.min(scrollHeight, max)), scroll: scrollHeight > max + 1 };
}

// 「Claude 在想…」等太久时，显示已经等了多久（高 effort 第一个字可能要几十秒，免得以为卡死了）
export function elapsedText(ms) {
  const s = Math.floor((ms || 0) / 1000);
  if (s < 6) return '';
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

// 在想的时候指示上写什么：等太久、而且写的还是默认那句时，换成「想得细」的说法（别的说法，比如「在整理前面的内容」，照原样）
export function waitText(text, ms) {
  const t = String(text ?? '').trim() || STATUS_TEXT.thinking;
  return ms >= LONG_WAIT_MS && t === STATUS_TEXT.thinking ? LONG_WAIT_TEXT : t;
}

// 占位文字：窄屏放不下长的
export function placeholderFor({ enabled = true, narrow = false, images = false } = {}) {
  if (!enabled) return PLACEHOLDER.off;
  if (narrow) return PLACEHOLDER.short;
  return images ? PLACEHOLDER.images : PLACEHOLDER.on;
}


// —— 输入框 ——

const ICON = {
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20l1.2-4.6L15.8 4.8a2 2 0 0 1 2.9 0l.5.5a2 2 0 0 1 0 2.9L8.6 18.8z"/><path d="M13.8 6.8l3.4 3.4"/></svg>',
  shot: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l4.5-4.2 3 2.7 3-3.3L19.5 16"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5.5"/><path d="M6 11l6-6 6 6"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11.5" height="12" rx="2"/><path d="M15.5 8V6a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H8"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M5 19.5h14"/><path d="M7 19.5V11a5 5 0 0 1 10 0v8.5"/><path d="M12 3.5V6"/></svg>',
};

export function createClassBar({ onSend, onStop, onRetry, onEnd, onCopy, images = false, tag = MODEL_TAG } = {}) {
  const el = document.createElement('div');
  el.className = 'class-bar';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', '和 Claude 说话');
  el.innerHTML = `
    <div class="cb-slate" hidden role="dialog" aria-label="手写板">
      <div class="cb-slate-head"><strong>手写</strong><span>写完点「附上」，和下一句话一起发给 Claude</span><button type="button" class="cb-slate-x" aria-label="收起手写板">收起</button></div>
      <div class="cb-slate-pad"></div>
    </div>
    <div class="cb-status" data-state="idle" hidden>
      <i class="cb-dot" aria-hidden="true"></i>
      <span class="cb-status-text" role="status"></span>
      <button type="button" class="cb-retry" hidden>重试</button>
    </div>
    <div class="cb-pill">
      <div class="cb-menu" hidden role="menu" aria-label="课堂菜单">
        <div class="cb-dock"></div>
        <button type="button" class="cb-item cb-copy" role="menuitem">${ICON.copy}<span>复制学习记录</span></button>
        <button type="button" class="cb-item cb-end" role="menuitem">${ICON.bell}<span>下课</span></button>
        <div class="cb-tag" title="课堂里的 Claude 固定用 Opus 5.5，effort 为 high">${tag}</div>
      </div>
      <div class="cb-attach" hidden></div>
      <form class="cb-form">
        <button type="button" class="cb-tool cb-pen" aria-label="手写" title="用 Apple Pencil 手写，附在下一句话里">${ICON.pen}</button>
        <button type="button" class="cb-tool cb-shot" aria-label="截图" title="附一张截图或照片">${ICON.shot}</button>
        <div class="cb-field"><textarea rows="1" enterkeyhint="send" aria-label="对 Claude 说"></textarea></div>
        <button type="submit" class="cb-send" aria-label="发送">${ICON.send}</button>
        <button type="button" class="cb-tool cb-more" aria-label="更多" aria-haspopup="menu" aria-expanded="false" title="板书、复制学习记录、下课">${ICON.more}</button>
        <input type="file" class="cb-file" accept="image/*" multiple hidden>
      </form>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('class-on');

  // 「Claude 在想 / 在写」：放在黑板末尾（控制器挂上去），这里只更新它
  const indicator = document.createElement('div');
  indicator.className = 'class-thinking';
  indicator.hidden = true;
  indicator.innerHTML = `<span class="ct-ind" aria-hidden="true"><i></i><i></i><i></i><svg class="ct-scribble" viewBox="0 0 30 14"><path d="M2 9.5c3-6 5.5 2.5 8.5-2.5s4.5 4 8-1 5 3.5 9.5-.5"/></svg></span><span class="ct-text" role="status"></span><span class="ct-elapsed"></span>`;
  const indText = indicator.querySelector('.ct-text');
  const indElapsed = indicator.querySelector('.ct-elapsed');

  const $ = (s) => el.querySelector(s);
  const statusEl = $('.cb-status');
  const statusText = $('.cb-status-text');
  const retryBtn = $('.cb-retry');
  const pill = $('.cb-pill');
  const menu = $('.cb-menu');
  const moreBtn = $('.cb-more');
  const copyBtn = $('.cb-copy');
  const endBtn = $('.cb-end');
  const endText = endBtn.querySelector('span');
  const form = $('.cb-form');
  const ta = $('textarea');
  const send = $('.cb-send');
  const penBtn = $('.cb-pen');
  const shotBtn = $('.cb-shot');
  const fileInput = $('.cb-file');
  const attachBox = $('.cb-attach');
  const slate = $('.cb-slate');
  const dock = $('.cb-dock');

  let busy = false;
  let enabled = true;
  let attached = [];     // [{ blob, url }]
  let pad = null;
  let status = statusView('idle');
  let thinkingSince = 0;
  let tick = 0;
  const confirmEnd = createConfirm(CONFIRM_MS);
  let endTimer = 0;
  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  // 手写板、截图（含粘贴、拖进来）各有一个开关：查看方式能发图，并且功能没被暂时关掉（features.js）
  const canPen = () => images && FEATURES.handwriting;
  const canPhoto = () => images && FEATURES.photo;
  const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const focusVisible = (t) => { try { return t.matches(':focus-visible'); } catch { return true; } }; // 老 Safari 不认这个选择器

  // —— 状态：在想 / 在写写在黑板末尾的指示上；出错 / 提示是输入框上面的一条 ——
  function paintWait() {
    const ms = Date.now() - thinkingSince;
    indText.textContent = waitText(status.text, ms);
    indElapsed.textContent = elapsedText(ms);
    el.classList.toggle('is-long-wait', ms >= LONG_WAIT_MS);
  }
  function setStatus(state, text) {
    const next = statusView(state, text);
    if (next.state === 'thinking' && status.state !== 'thinking') thinkingSince = Date.now();
    status = next;
    el.dataset.state = next.state;
    el.classList.toggle('is-live', next.live);
    indicator.hidden = !next.live;
    indicator.dataset.state = next.state;
    clearInterval(tick);
    indElapsed.textContent = '';
    el.classList.remove('is-long-wait');
    if (next.state === 'thinking') {
      paintWait();
      tick = setInterval(paintWait, 1000);
    } else {
      indText.textContent = next.live ? next.text : '';
    }
    const strip = next.state === 'error' || next.state === 'notice';
    statusEl.hidden = !strip;
    statusEl.dataset.state = next.state;
    statusText.textContent = strip ? next.text : '';
    // 输入框整个停用时（没有 Claude 可用），点重试也没用：不给这个按钮
    retryBtn.hidden = !next.retry || !enabled;
  }
  on(retryBtn, 'click', () => onRetry?.());

  // —— 「⋯」菜单：板书、复制学习记录、下课，最下面一行模型标记 ——
  let menuOpen = false;
  function setMenu(v) {
    menuOpen = !!v;
    menu.hidden = !menuOpen;
    moreBtn.classList.toggle('on', menuOpen);
    moreBtn.setAttribute('aria-expanded', String(menuOpen));
    if (!menuOpen) disarmEnd();
  }
  on(moreBtn, 'click', (e) => {
    e.stopPropagation();
    if (!menuOpen) openSlate(false);
    setMenu(!menuOpen);
  });
  // 挂在 window 的捕获阶段：板书开着时，笔在黑板上的 pointerdown 会被板书层在 document 上拦下（stopPropagation），冒泡阶段收不到
  on(window, 'pointerdown', (e) => { if (menuOpen && e.target instanceof Element && !menu.contains(e.target) && !moreBtn.contains(e.target)) setMenu(false); }, { capture: true, passive: true });
  on(document, 'keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuOpen) { setMenu(false); moreBtn.focus({ preventScroll: true }); } else if (!slate.hidden) openSlate(false);
  });
  on(copyBtn, 'click', () => { setMenu(false); onCopy?.(); });
  // 板书按钮（板书层自己管开关）：点了就收起菜单，让开黑板
  on(dock, 'click', (e) => { if (e.target.closest('.ink-fab')) setTimeout(() => setMenu(false), 0); });

  // —— 下课：第一次点变「确定下课？」，3 秒内再点才算 ——
  function disarmEnd() {
    clearTimeout(endTimer);
    confirmEnd.reset();
    endBtn.classList.remove('is-armed');
    endText.textContent = '下课';
  }
  on(endBtn, 'click', () => {
    if (confirmEnd.tap() === 'fire') { disarmEnd(); setMenu(false); onEnd?.(); return; }
    endBtn.classList.add('is-armed');
    endText.textContent = '确定下课？再点一下';
    clearTimeout(endTimer);
    endTimer = setTimeout(disarmEnd, CONFIRM_MS);
  });

  // —— 发送 / 停止 ——
  function syncControls() {
    ta.disabled = !enabled;
    ta.placeholder = placeholderFor({ enabled, narrow: window.innerWidth < 560, images: canPhoto() });
    endBtn.disabled = !enabled;
    const full = attached.length >= MAX_IMAGES;
    penBtn.disabled = !enabled || full;
    shotBtn.disabled = !enabled || full;
    send.disabled = !enabled && !busy;
    // 图标只在「发送 ↔ 停止」切换时换：每打一个字都换一遍的话，正好按在图标上的那一下会被吞掉
    //（按下时的节点被换掉，松开就不算点击；iPad 上点发送时提交候选词、随手写都会触发 input）
    if (send.dataset.busy !== String(busy)) {
      send.dataset.busy = String(busy);
      send.classList.toggle('is-stop', busy);
      send.innerHTML = busy ? ICON.stop : ICON.send;
      send.setAttribute('aria-label', busy ? '停止这一轮' : '发送');
      send.title = busy ? '停止这一轮' : '发送（回车）';
    }
    send.classList.toggle('is-empty', !busy && !ta.value.trim() && !attached.length);
    el.classList.toggle('is-busy', busy);
    el.classList.toggle('is-disabled', !enabled);
  }

  function submit() {
    if (busy) { onStop?.(); return; }
    if (!enabled) return;
    const text = ta.value.trim();
    if (!text && !attached.length) { ta.focus({ preventScroll: true }); return; }
    const imgs = attached.map((a) => a.blob);
    ta.value = '';
    clearAttach();
    grow();
    syncControls();
    onSend?.({ text, images: imgs });
  }
  on(form, 'submit', (e) => { e.preventDefault(); submit(); });
  // 生成中按回车既不发送也不停止（免得误停）：字留在框里，这一轮说完再发
  on(ta, 'keydown', (e) => {
    if (!isSendKey(e)) return;
    e.preventDefault();
    if (!busy) submit();
  });

  // 输入框自动增高（最多 4 行）
  function grow() {
    const cs = getComputedStyle(ta);
    const lh = parseFloat(cs.lineHeight) || 25;
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    ta.style.height = 'auto';
    const g = growHeight({ scrollHeight: ta.value ? ta.scrollHeight : 0, lineHeight: lh, padding: padY, maxLines: 4 });
    ta.style.height = g.height + 'px';
    ta.style.overflowY = g.scroll ? 'auto' : 'hidden';
  }
  on(ta, 'input', () => { grow(); syncControls(); });
  on(ta, 'focus', () => setMenu(false));

  // —— 附图：手写板、截图、粘贴、拖进来 ——
  function renderAttach() {
    attachBox.hidden = !attached.length;
    attachBox.innerHTML = attached.map((a, i) => `<figure class="cb-thumb"><img src="${a.url}" alt="附上的第 ${i + 1} 张图"><button type="button" class="cb-unattach" data-i="${i}" aria-label="去掉第 ${i + 1} 张图">×</button></figure>`).join('')
      + `<span class="cb-attach-note">${attached.length}/${MAX_IMAGES} 张，随下一句话发出</span>`;
    syncControls();
  }
  function attachBlobs(blobs) {
    if (!images) return 0;
    const r = addImages(attached.map((a) => a.blob), blobs, MAX_IMAGES);
    const added = r.list.slice(attached.length);
    attached = [...attached, ...added.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))];
    renderAttach();
    if (r.dropped) flashNote(`最多附 ${MAX_IMAGES} 张图`);
    return added.length;
  }
  function clearAttach() {
    attached.forEach((a) => setTimeout(() => URL.revokeObjectURL(a.url), 1000));
    attached = [];
    renderAttach();
  }
  on(attachBox, 'click', (e) => {
    const b = e.target.closest('.cb-unattach');
    if (!b) return;
    const [gone] = attached.splice(Number(b.dataset.i), 1);
    if (gone) URL.revokeObjectURL(gone.url);
    renderAttach();
  });
  function flashNote(msg) {
    const n = attachBox.querySelector('.cb-attach-note');
    if (!n) return;
    n.textContent = msg;
    n.classList.add('is-warn');
  }

  // 截图 / 照片 / 粘贴来的图一律画到白底上转成 PNG：透明底在 Claude 那边可能变成黑底，HEIC / TIFF 也不收
  async function takeFiles(files) {
    const all = [...files].filter(Boolean);
    const room = MAX_IMAGES - attached.length;
    if (!all.length) return 0;
    if (room <= 0) { flashNote(`最多附 ${MAX_IMAGES} 张图`); return 0; }
    const out = [];
    for (const f of all.slice(0, room)) {
      try { out.push(await (typeof f === 'string' ? srcToPng(f) : toPng(f))); } catch { /* 读不出来的跳过 */ }
    }
    if (!out.length) { showNote('这张图读不出来，换一张截图试试'); return 0; }
    const n = attachBlobs(out);
    if (all.length > room) flashNote(`最多附 ${MAX_IMAGES} 张图`);
    return n;
  }
  function showNote(msg) {
    attachBox.hidden = false;
    if (!attachBox.querySelector('.cb-attach-note')) attachBox.insertAdjacentHTML('beforeend', '<span class="cb-attach-note"></span>');
    flashNote(msg);
  }
  on(shotBtn, 'click', () => fileInput.click());
  on(fileInput, 'change', async () => { await takeFiles(fileInput.files || []); fileInput.value = ''; });
  // 剪贴板 / 拖进来的东西里的图：文件优先，没有文件再看 html 里的 <img>
  const dataImages = (dt) => {
    const files = clipboardImages(dt);
    return files.length ? files : htmlImageSrcs(dt?.getData?.('text/html'));
  };
  on(ta, 'paste', (e) => {
    if (!canPhoto()) return;
    const imgs = dataImages(e.clipboardData);
    if (!imgs.length) return; // 粘贴文字照常
    e.preventDefault();
    takeFiles(imgs);
  });
  on(pill, 'dragover', (e) => { if (canPhoto() && enabled && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('is-drop'); } });
  on(pill, 'dragleave', (e) => { if (!pill.contains(e.relatedTarget)) el.classList.remove('is-drop'); });
  on(pill, 'drop', (e) => {
    el.classList.remove('is-drop');
    if (!canPhoto() || !enabled) return;
    const imgs = dataImages(e.dataTransfer);
    if (!imgs.length) return;
    e.preventDefault();
    takeFiles(imgs);
  });

  // 手写板：从输入框上面弹起来的一小块石板
  function openSlate(v) {
    const show = !!v && canPen() && enabled;
    if (show && !pad) {
      pad = createPad($('.cb-slate-pad'), {
        height: 220,
        hint: '用 Apple Pencil 写下算式或想法',
        actions: [{
          label: '附上', primary: true,
          onClick: async (p) => {
            const blob = await p.toBlob();
            if (blob) attachBlobs([blob]);
            p.clear();
            openSlate(false);
          },
        }],
      });
    }
    if (show) { setMenu(false); ta.blur(); }
    slate.hidden = !show;
    el.classList.toggle('slate-open', show);
    penBtn.classList.toggle('on', show);
    penBtn.setAttribute('aria-expanded', String(show));
  }
  on(penBtn, 'click', () => openSlate(slate.hidden));
  on($('.cb-slate-x'), 'click', () => openSlate(false));

  // —— 能不能发图：这个查看方式发不了图片时（images_unavailable），手写、截图两个按钮都收起来 ——
  // （草稿区「拿给 Claude 看」这类从外面附进来的图不受这两个按钮的开关管，只看能不能发图）
  // 还没发出去的附图也发不出去了，一起撤掉（免得学生以为会随下一句话发出）
  function setImages(v) {
    images = !!v;
    el.classList.toggle('no-images', !canPen() && !canPhoto());
    penBtn.hidden = !canPen();
    shotBtn.hidden = !canPhoto();
    if (!images) {
      openSlate(false);
      if (attached.length) clearAttach();
    }
    syncControls();
  }

  // —— 高度：留出底部空白，黑板最下面的组件不被挡住 ——
  const root = document.documentElement;
  let lastH = -1;
  function publishHeight() {
    const h = Math.round(el.offsetHeight);
    if (h === lastH) return;
    // 本来就看着黑板末尾（快捷回答那一行）时，输入框变高（多出出错提示、附图）要跟着往下滚，不然末尾被盖住
    const se = document.scrollingElement || root;
    const atEnd = lastH > 0 && h > lastH && se.scrollTop + window.innerHeight >= se.scrollHeight - 48;
    const grew = h - lastH;
    lastH = h;
    root.style.setProperty('--class-bar-h', h + 'px');
    if (atEnd) window.scrollBy({ top: grew, behavior: 'auto' });
  }
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => publishHeight());
    ro.observe(el);
  }
  publishHeight();

  // —— iPad 软键盘：在输入框里打字时把它抬到键盘上面；在黑板上的输入框里打字时让开 ——
  // 键盘只留下小半个屏幕：输入框再抬上来，正在填的那一格就被盖住了。所以那时输入框收到键盘后面去，
  // 键盘收起再回来（和黑板上的数字小键盘一样）
  const vv = window.visualViewport;
  let lastLift = -1, lastAway = false;
  const boardField = (t) => t instanceof Element && !el.contains(t) && t.matches(FIELD) && t.getAttribute('inputmode') !== 'none';
  function lift() {
    const n = keyboardLift(window.innerHeight, vv);
    const away = n > 0 && boardField(document.activeElement);
    if (n === lastLift && away === lastAway) return; // iPad 上滚动时 scroll 事件很密，没变就不碰样式
    lastLift = n;
    lastAway = away;
    el.style.setProperty('--cb-lift', (away ? 0 : n) + 'px');
    el.classList.toggle('is-lifted', n > 0 && !away);
    el.classList.toggle('is-away', away);
    if (away) setMenu(false);
    // 键盘盖住的高度也留成页面底部空白：黑板最下面的输入框才滚得到键盘上面
    if (n > 0) root.style.setProperty('--class-kb', n + 'px'); else root.style.removeProperty('--class-kb');
    if (away) setTimeout(() => keepClear(document.activeElement), 60);
  }
  if (vv) { on(vv, 'resize', lift); on(vv, 'scroll', lift); }
  on(window, 'resize', () => { lift(); syncControls(); });
  lift();

  // 黑板上获得焦点的输入框、按钮（键盘切换焦点时）不能藏在输入框后面：滚到输入框上面。
  // 用鼠标或手指点的按钮本来就在眼前，不去动页面
  function keepClear(t) {
    if (!(t instanceof Element) || !t.isConnected || document.activeElement !== t || el.contains(t)) return;
    if (t.closest('.keypad, .dev-panel, .ink-bar, .record-fallback') || t.classList.contains('mi-cell')) return; // 数字小键盘自己会滚
    if (!boardField(t) && !focusVisible(t)) return;
    const top0 = vv?.offsetTop || 0;
    const minTop = top0 + 10;
    const covered = !el.classList.contains('is-away') && !document.body.classList.contains('has-keypad');
    const maxBottom = Math.min(top0 + (vv?.height || window.innerHeight), covered ? pill.getBoundingClientRect().top : Infinity) - 14;
    const dy = clearScroll(t.getBoundingClientRect(), minTop, maxBottom);
    if (dy) window.scrollBy({ top: dy, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  on(document, 'focusin', (e) => {
    const t = e.target;
    lift();
    // 等浏览器自己的「滚到焦点」和键盘弹出先做完，再补一下
    setTimeout(() => keepClear(t), 120);
  });
  on(document, 'focusout', () => setTimeout(lift, 0));

  // —— 「板书」：本来是页面左下角的浮动按钮，会压住黑板最下面的题。收进「⋯」菜单 ——
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
  let inkWatch = null, inkClass = null;
  if (!adoptInk() && typeof MutationObserver === 'function') {
    inkWatch = new MutationObserver(() => { if (adoptInk()) { inkWatch.disconnect(); inkWatch = null; } });
    inkWatch.observe(document.body, { childList: true });
  }

  setImages(images);
  setStatus('idle');
  grow();

  return {
    el,
    indicator,
    setStatus,
    get state() { return status.state; },
    setBusy(v) { busy = !!v; syncControls(); },
    setImages,
    setTag(text) { $('.cb-tag').textContent = text || MODEL_TAG; },
    // 外部附上的图（草稿区「拿给 Claude 看」等）：PNG 直接用，其他格式先转成白底 PNG
    async attach(blob) {
      if (!blob || !images) return false;
      if (blob.type === 'image/png') return attachBlobs([blob]) > 0;
      return (await takeFiles([blob])) > 0;
    },
    prefill(text) {
      if (!text) return;
      const v = mergePrefill(ta.value, text);
      if (v === ta.value) return;
      ta.value = v;
      grow();
      syncControls();
    },
    focus() {
      if (!enabled) return;
      ta.focus({ preventScroll: true });
      const n = ta.value.length;
      try { ta.setSelectionRange(n, n); } catch { /* 有的输入框不支持 */ }
    },
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) { openSlate(false); disarmEnd(); }
      retryBtn.hidden = !status.retry || !enabled;
      syncControls();
    },
    get height() { return el.offsetHeight; },
    // 测试和热重载用：撤掉输入框和它挂的监听
    destroy() {
      cleanups.forEach((f) => f());
      ro?.disconnect();
      inkWatch?.disconnect();
      inkClass?.disconnect();
      clearInterval(tick);
      clearTimeout(endTimer);
      const fab = dock.querySelector('.ink-fab');
      if (fab) { fab.removeAttribute('role'); document.body.appendChild(fab); } // 板书按钮还给页面
      indicator.remove();
      el.remove();
      document.body.classList.remove('class-on');
      root.style.removeProperty('--class-bar-h');
      root.style.removeProperty('--class-kb');
    },
  };
}

// 用浏览器解码图片（iPad 的 Safari 能解 PNG、JPEG、HEIC、TIFF），画到白底画布上导出 PNG，太大的按比例缩小
async function toPng(file) {
  const url = URL.createObjectURL(file);
  try { return await srcToPng(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function srcToPng(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (/^https?:/i.test(src)) im.crossOrigin = 'anonymous'; // 别的网站的图：没有跨域许可就画不出来，下面会报错
    im.onload = () => {
      try {
        const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
        if (!w || !h) throw new Error('empty image');
        const k = Math.min(1, MAX_SIDE / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.round(w * k);
        c.height = Math.round(h * k);
        const g = c.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(im, 0, 0, c.width, c.height);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
      } catch (e) { reject(e); }
    };
    im.onerror = () => reject(new Error('decode failed'));
    im.src = src;
  });
}
