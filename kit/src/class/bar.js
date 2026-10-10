// 课堂模式的底部对话条：黑板下沿的一条木制粉笔槽。
// 从上到下：消息区（默认只露最近一两句，可展开）→ 快捷按钮（Claude 在想 / 在写时换成状态）+「Opus 5.5 · high」+「下课」→ 输入行。
// 木条上挂两个小木把手：左边「板书」（整页手写，从页面右下角收进来），中间「展开」。
// 对话条只收集输入、显示消息；学生的话由课堂控制器在真正发出时再 addMessage（排队、合并动作都在控制器里）。
import { createPad } from '../ink/pad.js';

export const QUICK = ['没懂', '想不出来', '换个说法', '继续'];
export const MAX_IMAGES = 4;
export const MODEL_TAG = 'Opus 5.5 · high';
export const CONFIRM_MS = 3000;
const STATUS_TEXT = { thinking: 'Claude 在想…', writing: 'Claude 正在写黑板…', error: '这一轮没成功。' };
const STATES = new Set(['idle', 'thinking', 'writing', 'error', 'notice']);
const ROLES = new Set(['claude', 'student', 'system', 'action']);
const MAX_SIDE = 2400;
const EMPTY = '有话直接说，或者在黑板上作答——Claude 都看得到。';
const PLACEHOLDER = { on: '想说什么，打在这里', images: '说点什么，或者粘贴截图', short: '说点什么…', off: '现在没法和 Claude 说话' };

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

// 作答 / 动作的对错，只用来给小粉笔条上色
export function actionTone(text) {
  const t = String(text ?? '');
  if (/[（(]错|想不出来|没做对|看了答案|放弃/.test(t)) return 'bad';
  if (/[（(]对|做对了/.test(t)) return 'ok';
  return '';
}

// 控制器给的动作消息是用 <br> 连起来的几行「[作答] …」「[动作] …」：拆成一行一个小粉笔条
export function actionItems(html) {
  return String(html ?? '').split(/<br\s*\/?>|\n/i).map((s) => s.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^\[(作答|动作|系统)\]\s*/);
    const body = plainMath(m ? line.slice(m[0].length) : line);
    return { tag: m ? m[1] : '', html: body, tone: actionTone(body) };
  });
}

// 动作条只有一行小字，放不下 KaTeX：题目标题里的 TeX（A\mathbf x、\boldsymbol\beta^{\mathrm T}）换成能直接读的字符
const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', lambda: 'λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω',
};
const SYMBOL = {
  cdot: '·', times: '×', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', to: '→', rightarrow: '→', infty: '∞',
  pm: '±', approx: '≈', in: '∈', ldots: '…', cdots: '⋯', dots: '…', quad: ' ', qquad: ' ', perp: '⊥', sqrt: '√',
  tr: 'tr', det: 'det', rank: 'rank', dim: 'dim', sin: 'sin', cos: 'cos', ln: 'ln', log: 'log', left: '', right: '',
};
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', n: 'ⁿ', k: 'ᵏ', T: 'ᵀ', '-': '⁻', '+': '⁺' };
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', i: 'ᵢ', j: 'ⱼ', n: 'ₙ', k: 'ₖ' };
const script = (map) => (m, a, b) => {
  const s = a ?? b;
  return [...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join('') : m;
};
export function plainMath(s) {
  return String(s ?? '')
    .replace(/\$+/g, '')
    .replace(/\\(?:mathrm|text|operatorname)\s*\{\s*T\s*\}/g, 'T')
    .replace(/\\(?:mathbf|boldsymbol|bm|mathrm|mathit|text|operatorname|vec)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\(?:mathbf|boldsymbol|bm|mathrm|mathit|vec)\s*(\\[A-Za-z]+|[A-Za-z0-9])/g, '$1')
    .replace(/\\([A-Za-z]+)/g, (m, w) => GREEK[w] ?? SYMBOL[w] ?? m)
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\^\{([^{}]{1,4})\}|\^([0-9nkT])/g, script(SUP))
    .replace(/_\{([^{}]{1,3})\}|_([0-9ijnk])/g, script(SUB))
    .replace(/[{}]/g, '');
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

// —— 对话条 ——

export function createClassBar({ onSend, onQuick, onStop, onRetry, onEnd, images = false } = {}) {
  const el = document.createElement('div');
  el.className = 'class-bar';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', '课堂对话');
  el.innerHTML = `
    <div class="cb-slate" hidden role="dialog" aria-label="手写板">
      <div class="cb-slate-head"><strong>手写</strong><span>写完点「附上」，和下一句话一起发给 Claude</span><button type="button" class="cb-slate-x" aria-label="收起手写板">收起</button></div>
      <div class="cb-slate-pad"></div>
    </div>
    <div class="cb-ledge" aria-hidden="true"><i class="cb-stick s1"></i><i class="cb-stick s2"></i><i class="cb-stick s3"></i><i class="cb-eraser"></i></div>
    <div class="cb-dock"></div>
    <button type="button" class="cb-toggle" hidden aria-expanded="false">展开 ▴</button>
    <div class="cb-inner">
      <div class="cb-log">
        <div class="cb-msgs" role="log" aria-live="polite" aria-label="课堂对话记录">
          <p class="cb-empty">${EMPTY}</p>
        </div>
      </div>
      <div class="cb-meta">
        <div class="cb-quick" role="group" aria-label="快捷回答">${QUICK.map((q) => `<button type="button" class="cb-pill" data-q="${q}">${q}</button>`).join('')}</div>
        <div class="cb-status" data-state="idle">
          <span class="cb-ind" aria-hidden="true"><i class="cb-dot"></i><i class="cb-dot"></i><i class="cb-dot"></i><svg class="cb-scribble" viewBox="0 0 30 14"><path d="M2 9.5c3-6 5.5 2.5 8.5-2.5s4.5 4 8-1 5 3.5 9.5-.5"/></svg></span>
          <span class="cb-status-text" role="status"></span>
          <span class="cb-elapsed"></span>
          <button type="button" class="cb-retry" hidden>重试</button>
        </div>
        <div class="cb-side">
          <span class="cb-model" title="课堂里的 Claude 固定用 Opus 5.5，effort 为 high">${MODEL_TAG}</span>
          <button type="button" class="cb-end">下课</button>
        </div>
      </div>
      <div class="cb-attach" hidden></div>
      <form class="cb-form">
        <button type="button" class="cb-tool cb-pen" aria-label="手写" title="用 Apple Pencil 手写"><svg viewBox="0 0 24 24"><path d="M4 20l1.2-4.6L15.8 4.8a2 2 0 0 1 2.9 0l.5.5a2 2 0 0 1 0 2.9L8.6 18.8z"/><path d="M13.8 6.8l3.4 3.4"/></svg><span>手写</span></button>
        <button type="button" class="cb-tool cb-shot" aria-label="截图" title="选一张截图或照片"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l4.5-4.2 3 2.7 3-3.3L19.5 16"/></svg><span>截图</span></button>
        <div class="cb-field"><textarea rows="1" enterkeyhint="send" aria-label="对 Claude 说"></textarea></div>
        <button type="submit" class="btn btn-primary cb-send">发送</button>
        <input type="file" class="cb-file" accept="image/*" multiple hidden>
      </form>
    </div>`;
  document.body.appendChild(el);
  document.body.classList.add('class-on');

  const $ = (s) => el.querySelector(s);
  const log = $('.cb-log');
  const msgs = $('.cb-msgs');
  const toggle = $('.cb-toggle');
  const statusEl = $('.cb-status');
  const statusText = $('.cb-status-text');
  const elapsedEl = $('.cb-elapsed');
  const retryBtn = $('.cb-retry');
  const endBtn = $('.cb-end');
  const pills = [...el.querySelectorAll('.cb-pill')];
  const form = $('.cb-form');
  const ta = $('textarea');
  const send = $('.cb-send');
  const penBtn = $('.cb-pen');
  const shotBtn = $('.cb-shot');
  const fileInput = $('.cb-file');
  const attachBox = $('.cb-attach');
  const slate = $('.cb-slate');
  const dock = $('.cb-dock');

  let open = false;      // 消息区展开
  let pinned = true;     // 展开时学生没往上翻：新内容来了跟到底
  let busy = false;
  let enabled = true;
  let attached = [];     // [{ blob, url }]
  let pad = null;
  let status = statusView('idle');
  let thinkingSince = 0;
  let tick = 0;
  let swappedAt = -1e9;  // 草稿刚撤下的时刻：紧接着换上的正式消息不再播一遍出场动画
  const confirmEnd = createConfirm(CONFIRM_MS);
  let endTimer = 0;
  const cleanups = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };
  const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const focusVisible = (t) => { try { return t.matches(':focus-visible'); } catch { return true; } }; // 老 Safari 不认这个选择器

  msgs.id = `cb-log-${Math.random().toString(36).slice(2, 8)}`;
  toggle.setAttribute('aria-controls', msgs.id);
  el.classList.toggle('no-images', !images);
  penBtn.hidden = !images;
  shotBtn.hidden = !images;

  // —— 消息区 ——
  const items = () => [...msgs.querySelectorAll('.cb-msg')];
  const count = () => msgs.querySelectorAll('.cb-msg').length;
  const nearBottom = () => msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 28;

  // 消息内容本身有多高（不受消息区当前高度影响：scrollHeight 至少等于容器高，收不回来）
  function contentHeight() {
    const kids = msgs.children;
    if (!kids.length) return 0;
    const first = kids[0], last = kids[kids.length - 1];
    const cs = getComputedStyle(msgs);
    return last.offsetTop + last.offsetHeight - first.offsetTop + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  }

  // 收起时露哪几条：最近两条都整条放得下就露两条，否则只露最后一条。
  // 不露半截的气泡（看起来像排版坏了），宁可少露一条，展开能看全部
  function pickPeek(list) {
    if (list.length < 2) return list;
    log.classList.add('is-measuring');
    const cs = getComputedStyle(msgs);
    const room = msgs.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    const gap = parseFloat(cs.rowGap) || 0;
    const tail = list.slice(-2);
    const [a, b] = tail.map((m) => m.offsetHeight);
    log.classList.remove('is-measuring');
    return a + gap + b <= room + 1 ? tail : tail.slice(-1);
  }

  function layoutLog({ follow = false } = {}) {
    const list = items();
    log.classList.toggle('is-empty', !list.length);
    let hidden = 0, clip = '';
    if (open) {
      // 展开：高度贴合内容，最多半屏，并且留出顶上的进度条（键盘弹出时按剩下的可视高度算）
      const vh = window.visualViewport?.height || window.innerHeight;
      const rest = el.offsetHeight - log.offsetHeight;
      const max = Math.max(120, Math.min(vh * 0.5, vh - rest - 76));
      log.style.height = Math.ceil(Math.min(Math.max(contentHeight(), 40), max)) + 'px';
      list.forEach((m) => m.classList.remove('is-peek', 'is-lead'));
      if (follow || pinned) msgs.scrollTop = msgs.scrollHeight;
      if (msgs.scrollTop > 2) clip = 'top';
    } else {
      log.style.height = '';
      const peek = pickPeek(list);
      hidden = list.length - peek.length;
      list.forEach((m) => { m.classList.toggle('is-peek', peek.includes(m)); m.classList.remove('is-lead'); });
      peek[0]?.classList.add('is-lead');
      const last = list[list.length - 1];
      if (msgs.scrollHeight > msgs.clientHeight + 2) {
        // 一条就放不下：正在写的草稿跟着最新的字走；写完的长话先露开头，剩下的展开看
        if (last?.classList.contains('is-draft')) { msgs.scrollTop = msgs.scrollHeight; clip = 'top'; } else { msgs.scrollTop = 0; clip = 'bottom'; }
      } else {
        msgs.scrollTop = 0;
      }
    }
    toggle.hidden = !open && !hidden && !clip;
    log.classList.toggle('is-clip-top', clip === 'top');
    log.classList.toggle('is-clip-bottom', clip === 'bottom');
    log.classList.toggle('can-open', !open && !toggle.hidden);
  }

  function setOpen(v) {
    open = !!v && count() > 0;
    pinned = true;
    log.classList.toggle('is-open', open);
    el.classList.toggle('log-open', open);
    toggle.textContent = open ? '收起 ▾' : '展开 ▴';
    toggle.setAttribute('aria-expanded', String(open));
    layoutLog({ follow: true });
  }

  on(toggle, 'click', (e) => { e.stopPropagation(); setOpen(!open); });
  // 收起时点消息区也能展开（iPad 上比找那个小按钮顺手）
  on(log, 'click', (e) => { if (!open && !toggle.hidden && !e.target.closest('a, button')) setOpen(true); });
  on(msgs, 'scroll', () => {
    if (!open) return;
    pinned = nearBottom();
    log.classList.toggle('is-clip-top', msgs.scrollTop > 2);
  }, { passive: true });
  // Esc 收起（焦点不一定在对话条里，所以挂在 document 上；只在展开时才管）
  on(document, 'keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });

  function renderBody(m, role, html) {
    if (role === 'action') {
      m.body.innerHTML = actionItems(html).map((a) => `<span class="cb-chip"${a.tone ? ` data-tone="${a.tone}"` : ''}>${a.tag ? `<b>${a.tag}</b>` : ''}<span>${a.html}</span></span>`).join('');
      m.body.querySelectorAll('.cb-chip > span').forEach((s) => (s.parentElement.title = s.textContent));
    } else {
      m.body.innerHTML = html || '';
    }
  }

  function addMessage({ role = 'claude', html = '', draft = false } = {}) {
    const r = ROLES.has(role) ? role : 'system';
    msgs.querySelector('.cb-empty')?.remove();
    const node = document.createElement('div');
    node.className = `cb-msg cb-${r}`;
    if (r === 'claude') node.innerHTML = '<span class="cb-who">Claude</span><div class="cb-body"></div><span class="cb-draft-tag">草稿</span>';
    else node.innerHTML = '<div class="cb-body"></div>';
    const m = { el: node, body: node.querySelector('.cb-body') };
    renderBody(m, r, html);
    if (r === 'claude' && msgs.lastElementChild?.classList.contains('cb-claude')) node.classList.add('is-cont');
    // 草稿确认后由控制器撤下、换成正式的同一段话：原地换掉，不再淡入一次（否则每轮结尾都闪一下）
    if (r === 'claude' && !draft && performance.now() - swappedAt < 400) node.classList.add('no-anim');
    msgs.appendChild(node);
    const handle = {
      el: node,
      setHtml(h) {
        const follow = !open || pinned || nearBottom();
        renderBody(m, r, h);
        layoutLog({ follow });
      },
      setDraft(v) {
        node.classList.toggle('is-draft', !!v);
        msgs.setAttribute('aria-busy', String(!!msgs.querySelector('.is-draft')));
        layoutLog();
      },
      remove() {
        if (!node.isConnected) return;
        if (node.classList.contains('is-draft')) swappedAt = performance.now();
        node.remove();
        msgs.setAttribute('aria-busy', String(!!msgs.querySelector('.is-draft')));
        layoutLog();
        // 撤下的是最后一条：等这一轮的正式消息（同一个任务里紧接着加）没来，再显示空白提示
        queueMicrotask(() => {
          if (count() || msgs.querySelector('.cb-empty')) return;
          setOpen(false);
          msgs.innerHTML = `<p class="cb-empty">${EMPTY}</p>`;
          layoutLog();
        });
      },
    };
    node.classList.toggle('is-draft', !!draft);
    msgs.setAttribute('aria-busy', String(!!msgs.querySelector('.is-draft')));
    pinned = true;
    layoutLog({ follow: true });
    return handle;
  }

  // —— 状态行 ——
  function setStatus(state, text) {
    const next = statusView(state, text);
    if (next.state === 'thinking' && status.state !== 'thinking') thinkingSince = Date.now();
    status = next;
    statusEl.dataset.state = next.state;
    el.dataset.state = next.state;
    // 在想 / 在写时快捷按钮反正点不了：那一格换成状态，不多占一行
    el.classList.toggle('is-live', next.live);
    statusText.textContent = next.text;
    retryBtn.hidden = !next.retry;
    clearInterval(tick);
    elapsedEl.textContent = '';
    if (next.state === 'thinking') {
      const upd = () => { elapsedEl.textContent = elapsedText(Date.now() - thinkingSince); };
      upd();
      tick = setInterval(upd, 1000);
    }
  }
  on(retryBtn, 'click', () => onRetry?.());

  // —— 下课：第一次点变「确定下课？」，3 秒内再点才算 ——
  function disarmEnd() {
    clearTimeout(endTimer);
    confirmEnd.reset();
    endBtn.classList.remove('is-armed');
    endBtn.textContent = '下课';
  }
  on(endBtn, 'click', () => {
    if (confirmEnd.tap() === 'fire') { disarmEnd(); onEnd?.(); return; }
    endBtn.classList.add('is-armed');
    endBtn.textContent = '确定下课？';
    clearTimeout(endTimer);
    endTimer = setTimeout(disarmEnd, CONFIRM_MS);
  });

  // —— 快捷按钮、发送 / 停止 ——
  function syncControls() {
    pills.forEach((b) => (b.disabled = busy || !enabled));
    ta.disabled = !enabled;
    // 手机竖屏输入框窄，长的占位文字放不下
    const narrow = window.innerWidth < 560;
    ta.placeholder = !enabled ? PLACEHOLDER.off : narrow ? PLACEHOLDER.short : images ? PLACEHOLDER.images : PLACEHOLDER.on;
    endBtn.disabled = !enabled;
    const full = attached.length >= MAX_IMAGES;
    penBtn.disabled = !enabled || full;
    shotBtn.disabled = !enabled || full;
    send.disabled = !enabled && !busy;
    send.classList.toggle('is-stop', busy);
    send.textContent = busy ? '停止' : '发送';
    send.setAttribute('aria-label', busy ? '停止这一轮' : '发送');
    send.classList.toggle('is-empty', !busy && !ta.value.trim() && !attached.length);
    el.classList.toggle('is-busy', busy);
    el.classList.toggle('is-disabled', !enabled);
  }
  pills.forEach((b) => on(b, 'click', () => { if (!busy && enabled) onQuick?.(b.dataset.q); }));

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
    if (!images) return;
    const imgs = dataImages(e.clipboardData);
    if (!imgs.length) return; // 粘贴文字照常
    e.preventDefault();
    takeFiles(imgs);
  });
  on(el, 'dragover', (e) => { if (images && enabled && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); el.classList.add('is-drop'); } });
  on(el, 'dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('is-drop'); });
  on(el, 'drop', (e) => {
    el.classList.remove('is-drop');
    if (!images || !enabled) return;
    const imgs = dataImages(e.dataTransfer);
    if (!imgs.length) return;
    e.preventDefault();
    takeFiles(imgs);
  });

  // 手写板：像一块小石板从粉笔槽上弹起来
  function openSlate(v) {
    const show = !!v && images && enabled;
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
    if (show) { setOpen(false); ta.blur(); }
    slate.hidden = !show;
    el.classList.toggle('slate-open', show);
    penBtn.classList.toggle('on', show);
    penBtn.setAttribute('aria-expanded', String(show));
  }
  on(penBtn, 'click', () => openSlate(slate.hidden));
  on($('.cb-slate-x'), 'click', () => openSlate(false));

  // —— 高度：留出底部空白，黑板最下面的组件不被挡住 ——
  const root = document.documentElement;
  let lastH = -1;
  function publishHeight() {
    const h = Math.round(el.offsetHeight);
    if (h === lastH) return;
    lastH = h;
    root.style.setProperty('--class-bar-h', h + 'px');
  }
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => publishHeight());
    ro.observe(el);
  }
  publishHeight();

  // —— iPad 软键盘：在对话条里打字时把它抬到键盘上面；在黑板上的输入框里打字时让开 ——
  // 键盘只留下小半个屏幕：对话条再抬上来，正在填的那一格就被盖住了。所以那时对话条收到键盘后面去，
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
    // 键盘盖住的高度也留成页面底部空白：黑板最下面的输入框才滚得到键盘上面
    if (n > 0) root.style.setProperty('--class-kb', n + 'px'); else root.style.removeProperty('--class-kb');
    if (open) layoutLog();
    if (away) setTimeout(() => keepClear(document.activeElement), 60);
  }
  if (vv) { on(vv, 'resize', lift); on(vv, 'scroll', lift); }
  on(window, 'resize', () => { lift(); syncControls(); layoutLog(); });
  lift();

  // 黑板上获得焦点的输入框、按钮（键盘切换焦点时）不能藏在对话条后面：滚到对话条上面、顶上进度条下面。
  // 用鼠标或手指点的按钮本来就在眼前，不去动页面
  function keepClear(t) {
    if (!(t instanceof Element) || !t.isConnected || document.activeElement !== t || el.contains(t)) return;
    if (t.closest('.keypad, .dev-panel, .ink-bar, .record-fallback') || t.classList.contains('mi-cell')) return; // 数字小键盘自己会滚
    if (!boardField(t) && !focusVisible(t)) return;
    const top0 = vv?.offsetTop || 0;
    const head = document.querySelector('.g-bar')?.getBoundingClientRect();
    const minTop = Math.max(top0, head && head.bottom > 0 ? head.bottom : 0) + 10;
    const covered = !el.classList.contains('is-away') && !document.body.classList.contains('has-keypad');
    const maxBottom = Math.min(top0 + (vv?.height || window.innerHeight), covered ? el.getBoundingClientRect().top : Infinity) - 14;
    const dy = clearScroll(t.getBoundingClientRect(), minTop, maxBottom);
    if (dy) window.scrollBy({ top: dy, behavior: reduceMotion() ? 'auto' : 'smooth' });
  }
  on(document, 'focusin', (e) => {
    lift();
    // 等浏览器自己的「滚到焦点」和键盘弹出先做完，再补一下
    const t = e.target;
    setTimeout(() => keepClear(t), 120);
  });
  on(document, 'focusout', () => setTimeout(lift, 0));

  // —— 「板书」：本来是页面左下角的浮动按钮，会压住黑板最下面的题。挂到木条左边当一个小把手 ——
  function adoptInk() {
    const fab = document.querySelector('body > .ink-fab');
    if (!fab) return false;
    dock.appendChild(fab);
    return true;
  }
  let inkWatch = null;
  if (!adoptInk() && typeof MutationObserver === 'function') {
    inkWatch = new MutationObserver(() => { if (adoptInk()) { inkWatch.disconnect(); inkWatch = null; } });
    inkWatch.observe(document.body, { childList: true });
  }

  setStatus('idle');
  syncControls();
  grow();

  return {
    el,
    addMessage,
    setStatus,
    setBusy(v) { busy = !!v; syncControls(); },
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
      syncControls();
    },
    get height() { return el.offsetHeight; },
    // 测试和热重载用：撤掉对话条和它挂的监听
    destroy() {
      cleanups.forEach((f) => f());
      ro?.disconnect();
      inkWatch?.disconnect();
      clearInterval(tick);
      clearTimeout(endTimer);
      const fab = dock.querySelector('.ink-fab');
      if (fab) document.body.appendChild(fab); // 板书按钮还给页面
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
