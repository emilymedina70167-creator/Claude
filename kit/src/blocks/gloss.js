// gloss：这一段的生词。一行一个「英文词 = 中文意思」，本身只显示一行小字；
// 页面在这一段的英文里找到这些词画一道虚线，点一下当场在旁边显示意思，不调用 Claude（以前问一个词就是一整轮，要等几十秒）。
// 点过的词记一条动作（gloss），课堂 Claude 跟着下一条消息知道（不单独调用），记成证据（kind: gloss）；收不收进「要记的」由主讲定，页面不自己收。
// 段里能点的英文组件（parse 的词、errfind 的词、chunk、link）不画虚线（点它们是在作答），这些词在小字那一行点开看。
import { session } from '../session.js';
import { escapeHtml } from './common.js';
import { parseGloss, glossMatches } from '../entext.js';

// 不往里面画虚线的地方：输入、按钮、公式、代码，和点了是在作答的英文组件
const SKIP = 'input, textarea, select, button, a, code, pre, script, style, svg, .katex, [contenteditable], .lk-gloss, .block-gloss, .mk-layer, .pz-sent, .en-words, .ck-sent, .lk-sent, .q-opt, .ask-menu, .ask-note';
const seen = new WeakMap(); // 段 → 这一页里已经记过的词（点第二次不再记）

export function gloss(el, src) {
  const { items, problems, showAll } = parseGloss(src);
  if (problems.length) throw new Error(problems.join('；'));
  el.innerHTML = `<div class="lk-glossbox"><button type="button" class="lk-glossall" aria-expanded="${showAll ? 'true' : 'false'}">生词 ${items.length} 个</button>${showAll ? '' : '<span class="muted">：点带虚线的词看意思</span>'}<div class="lk-glosslist"${showAll ? '' : ' hidden'}>${items.map((it, i) => `<button type="button" class="lk-gchip${showAll ? ' is-open' : ''}" data-i="${i}">${escapeHtml(it.word)}<span class="lk-gmean"${showAll ? '' : ' hidden'}>　${escapeHtml(it.gloss)}</span></button>`).join('')}</div></div>`;
  const box = el.querySelector('.lk-glossbox');
  // show: all（主讲写的）：这张表直接摊开、意思都露着，不用一个一个点。摊开的不算「点开过」，不记动作
  const open = (it) => {
    const root = scopeOf(el);
    const got = seen.get(root) || new Set();
    seen.set(root, got);
    const key = it.word.toLowerCase();
    if (got.has(key)) return;
    got.add(key);
    session.event('gloss', el, { word: it.word, gloss: it.gloss });
  };
  box.querySelector('.lk-glossall').addEventListener('click', (e) => {
    const list = box.querySelector('.lk-glosslist');
    list.hidden = !list.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!list.hidden));
  });
  // 小字那一行：词先只露英文，点一个看一个（一下全露出来就不知道哪个真的不认识）
  box.querySelectorAll('.lk-gchip').forEach((b) => b.addEventListener('click', () => {
    if (showAll) return;
    const it = items[Number(b.dataset.i)];
    b.querySelector('.lk-gmean').hidden = false;
    b.classList.add('is-open');
    open(it);
  }));
  // 段里别的组件同一轮画好；以后重画（揭开一步、换一题）再补
  const apply = () => { if (el.isConnected) wrap(scopeOf(el), items, open); };
  requestAnimationFrame(apply);
  setTimeout(apply, 300);
  const root = scopeOf(el);
  if (typeof MutationObserver === 'function' && root) {
    let t = 0;
    const mo = new MutationObserver(() => {
      if (!el.isConnected) { mo.disconnect(); return; }
      clearTimeout(t);
      t = setTimeout(apply, 120);
    });
    mo.observe(root, { childList: true, subtree: true });
  }
}

// 这个 gloss 管哪一块：黑板上的一段、自学单元的一节；都不是就是它的上一层
const scopeOf = (el) => el.closest('.class-seg, .stage, .la-section') || el.parentElement || el;

function wrap(root, items, open) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!/[A-Za-z]/.test(n.nodeValue || '') || n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  for (let n; (n = walker.nextNode());) nodes.push(n);
  for (const node of nodes) {
    const ms = glossMatches(node.nodeValue, items);
    if (!ms.length) continue;
    const frag = document.createDocumentFragment();
    let at = 0;
    const text = node.nodeValue;
    for (const m of ms) {
      if (m.index > at) frag.append(text.slice(at, m.index));
      const w = document.createElement('span');
      w.className = 'lk-gloss';
      w.tabIndex = 0;
      w.setAttribute('role', 'button');
      w.dataset.gloss = m.item.gloss;
      w.textContent = text.slice(m.index, m.index + m.length);
      w.addEventListener('click', (e) => { e.stopPropagation(); show(w, m.item); open(m.item); });
      frag.append(w);
      at = m.index + m.length;
    }
    if (at < text.length) frag.append(text.slice(at));
    node.replaceWith(frag);
  }
}

// 点开的意思：词下面一个小气泡，点别处收起
let bubble = null;
function show(w, it) {
  bubble?.remove();
  const b = document.createElement('div');
  b.className = 'lk-gbubble';
  b.innerHTML = `<b>${escapeHtml(it.word)}</b>　${escapeHtml(it.gloss)}`;
  document.body.append(b);
  const r = w.getBoundingClientRect();
  const bw = b.offsetWidth;
  b.style.left = `${Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + window.scrollX + r.width / 2 - bw / 2))}px`;
  b.style.top = `${r.bottom + window.scrollY + 6}px`;
  bubble = b;
  w.classList.add('is-seen');
  const off = (e) => { if (e.target === w) return; b.remove(); if (bubble === b) bubble = null; document.removeEventListener('pointerdown', off, true); };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}
