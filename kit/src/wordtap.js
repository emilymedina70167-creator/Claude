// 点词查义（设计四）碰 DOM 的那一半：英语课的板上，点一个英文词，旁边出它的意思（词典 dict/en.json，第一次点时才取）。
// 不调用 Claude；查过的词记一条动作 gloss（带 dict: true），和老师写的 gloss 一样跟着下一条告诉老师；只记证据，收不收进「要记的」由主讲定。
// 老师写了 gloss 的词照旧用老师的意思（那是这一句里的意思），点了是在作答的英文组件、输入框、按钮、公式不管。
import { session } from './session.js';
import { escapeHtml } from './blocks/common.js';
import { lookupWord, lookupPhrases, wordsOf, shortMean } from './dict.js';

const SKIP = 'input, textarea, select, button, a, label, code, pre, svg, canvas, .katex, [contenteditable="true"], [contenteditable=""], .lk-gloss, .block-gloss, .lk-glossbox, .mk-layer, .pz-sent, .en-words, .ck-sent, .lk-sent, .q-opt, .st-choices, .w-actions, .keypad, .block-stage, .wt-pop';
const BLOCKY = 'p, li, td, th, h1, h2, h3, h4, blockquote, figcaption, .stage-body, div';

let dictP = null;
export function loadDict() {
  if (!dictP) {
    dictP = fetch(new URL('dict/en.json', document.baseURI).href).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    dictP.catch(() => { dictP = null; }); // 没取到：下一次点再试
  }
  return dictP;
}

// 点的位置 → 那个文字节点和第几个字
function caretAt(x, y) {
  if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null; }
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
  return null;
}

/** 点的那个词：{ word, words（这一段切好的词）, i, rect, el }；没点在英文词上是 null */
export function wordAt(x, y) {
  const c = caretAt(x, y);
  const node = c?.node;
  if (!node || node.nodeType !== 3 || !/[A-Za-z]/.test(node.data)) return null;
  const el = node.parentElement;
  if (!el || el.closest(SKIP)) return null;
  // 整段的字（词组可能跨过加粗）：算出点的那个字在整段里的位置
  const box = el.closest(BLOCKY) || el;
  let at = 0;
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t && t !== node; t = walker.nextNode()) at += t.data.length;
  at += c.offset;
  const text = box.textContent || '';
  const words = wordsOf(text);
  const i = words.findIndex((w) => at >= w.start && at <= w.end);
  if (i < 0) return null;
  // 那个词在屏幕上的位置（弹框贴着它）
  let rect = null;
  try {
    const local = wordsOf(node.data).find((w) => c.offset >= w.start && c.offset <= w.end);
    if (local) { const r = document.createRange(); r.setStart(node, local.start); r.setEnd(node, local.end); rect = r.getBoundingClientRect(); }
  } catch { /* 量不到就贴着点的地方 */ }
  return { word: words[i].word, words: words.map((w) => w.word), i, rect: rect || { left: x, right: x, top: y, bottom: y, width: 0, height: 0 }, el };
}

/**
 * 在 root 里点英文词出意思。enabled()：这一刻开不开（英语课才开）。返回 { stop }
 */
export function attachWordTap(root, { enabled = () => true } = {}) {
  if (!root) return { stop() {} };
  let pop = null;
  let lastPointer = 'mouse';
  const told = new Set();
  const close = () => { pop?.remove(); pop = null; };
  const onDown = (e) => { lastPointer = e.pointerType || 'mouse'; };
  const onClick = async (e) => {
    if (e.target?.closest?.('.wt-pop')) return;
    close();
    if (!enabled() || e.defaultPrevented || lastPointer === 'pen') return;
    if (e.target?.closest?.(SKIP)) return;
    if (String(window.getSelection?.() || '').trim()) return; // 在选字，不打扰
    const hit = wordAt(e.clientX, e.clientY);
    if (!hit) return;
    const box = document.createElement('div');
    box.className = 'wt-pop';
    box.setAttribute('role', 'dialog');
    box.innerHTML = `<div class="wt-head">${escapeHtml(hit.word)}</div><div class="wt-body muted">…</div>`;
    place(box, hit.rect);
    pop = box;
    let dict;
    try { dict = await loadDict(); } catch (err) {
      if (pop === box) box.querySelector('.wt-body').textContent = `词典没读到（${String(err?.message || err).slice(0, 60)}）`;
      return;
    }
    if (pop !== box) return; // 等词典的时候又点了别处
    const phrases = lookupPhrases(dict, hit.words, hit.i);
    const words = lookupWord(dict, hit.word);
    const rows = [...phrases, ...words];
    box.innerHTML = rows.length
      ? rows.map((r) => `<div class="wt-row"><div class="wt-head">${escapeHtml(r.head)}${r.of ? `<span class="wt-of">${escapeHtml(r.of)}</span>` : ''}</div><div class="wt-body">${escapeHtml(r.mean).replace(/\n/g, '<br>')}</div></div>`).join('')
      : `<div class="wt-head">${escapeHtml(hit.word)}</div><div class="wt-body muted">词典里没有</div>`;
    place(box, hit.rect);
    if (!rows.length) return;
    const head = rows[0].head;
    if (told.has(head)) return;
    told.add(head);
    session.event('gloss', hit.el, { word: head, gloss: shortMean(rows), dict: true });
  };
  const onScroll = () => close();
  const onOutside = (e) => { if (pop && !e.target?.closest?.('.wt-pop') && !root.contains(e.target)) close(); };
  document.addEventListener('pointerdown', onOutside, true);
  root.addEventListener('pointerdown', onDown, true);
  root.addEventListener('click', onClick);
  window.addEventListener('scroll', onScroll, true);
  return { stop() { close(); document.removeEventListener('pointerdown', onOutside, true); root.removeEventListener('pointerdown', onDown, true); root.removeEventListener('click', onClick); window.removeEventListener('scroll', onScroll, true); } };
}

// 弹框贴在词的下面（下面放不下放上面），不出屏幕左右
function place(box, r) {
  if (!box.isConnected) document.body.appendChild(box);
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(320, vw - 24);
  box.style.maxWidth = `${w}px`;
  const bw = Math.min(w, box.offsetWidth || w), bh = box.offsetHeight || 60;
  const left = Math.max(12, Math.min(vw - bw - 12, r.left));
  const below = r.bottom + 8;
  const top = below + bh < vh - 8 ? below : Math.max(8, r.top - bh - 8);
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
}
