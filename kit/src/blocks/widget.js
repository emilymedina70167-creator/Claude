// widget：外部主讲针对这一次的教学设计的交互（需求 R5 的设计层，学习台 dev_requests/dr-ext-control）。
// 外部写一小段 JS，调用底座的 la.* 接口：画（文字、公式、矩阵）、学生的操作（拖着排、点、写）、判（顺序、式子相等、精确计算）、
// 记（每一下进证据、进 ext_out）、动画、给板书标注留的锚点。基本功都在 la.* 里，外部只写这一次的设计逻辑。
// 跑在这一段里：写错（语法错、一上来就抛错）这一段不显示、照组件写错的规矩报给外部；后来点按钮时出的错记一条动作报给外部，只坏这一段。
// 读法和写法检查在 widgetspec.js（纯函数）。
import { parseWidget, compareOrder } from '../widgetspec.js';
import { session } from '../session.js';
import { mdToHtml, tex2html, escapeHtml, calcScope } from './common.js';
import { calcValue, exactText } from '../exact.js';
import { equivalent } from '../ncalg.js';

// 文字里 $…$ 是公式：整段只有一个公式的直接排成公式，别的走 Markdown
const show = (s) => {
  const t = String(s ?? '');
  const m = t.match(/^\s*\$([^$]+)\$\s*$/);
  return m ? tex2html(m[1]) : mdToHtml(t, { inline: true });
};

export function widgetBlock(el, src) {
  const w = parseWidget(src);
  if (w.error) { session.problem(el, 'widget', w.error); el.innerHTML = `<div class="block-error">${escapeHtml(w.error)}</div>`; return; }
  const id = el.dataset.bid;
  el.classList.add('block-widget');
  el.innerHTML = `${w.title ? `<div class="w-title">${mdToHtml(w.title, { inline: true })}</div>` : ''}<div class="wg-body"></div><div class="wg-say" aria-live="polite" hidden></div>`;
  const body = el.querySelector('.wg-body');
  const sayEl = el.querySelector('.wg-say');
  const fail = (e, where) => {
    const msg = `${where}：${e?.message || e}`;
    console.error(e);
    session.event('widget-error', el, { text: msg.slice(0, 300) });
  };
  // 学生点了、拖了以后跑的代码（外部写的回调）：出错只记下来，不让整页出错
  const guard = (fn, where) => (...a) => { try { return fn?.(...a); } catch (e) { fail(e, where); return undefined; } };
  const add = (node, parent = body) => { parent.appendChild(node); return node; };
  const make = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
  let anchors = 0;

  const la = {
    el: body,
    /** 一段文字（Markdown，$…$ 是公式）；返回那个元素 */
    md: (text, parent) => add(make('div', 'wg-md', mdToHtml(String(text ?? ''))), parent),
    /** 一个公式（TeX，可以写 \calc{…}、\chalk{颜色}{…}） */
    tex: (src, parent) => add(make('div', 'wg-tex', tex2html(String(src ?? ''), true)), parent),
    /** 矩阵：二维数组（数或 TeX），name 写在左边 */
    matrix: (rows, { name = '', parent } = {}) => add(make('div', 'wg-tex', tex2html(`${name ? `${name}=` : ''}\\begin{bmatrix}${(rows || []).map((r) => (r || []).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`, true)), parent),
    /** 一行，里面的东西横着排（窄屏自动折行） */
    row: (...nodes) => { const r = add(make('div', 'wg-row')); for (const n of nodes) if (n) r.appendChild(n); return r; },
    /** 按钮（至少 44px 高）：点了跑 fn */
    button: (label, fn, { primary = false, parent } = {}) => { const b = add(make('button', `btn${primary ? ' btn-primary' : ''} wg-btn`, show(label)), parent); b.type = 'button'; b.addEventListener('click', guard(fn, `点「${b.textContent}」`)); return b; },
    /** 输入框（16px，iPad 不放大）：回车或失焦时跑 onEnter(值)；返回 { el, value() } */
    input: ({ placeholder = '', onEnter, parent } = {}) => {
      const i = add(make('input', 'wg-input'), parent);
      i.type = 'text'; i.placeholder = placeholder; i.autocapitalize = 'off'; i.autocomplete = 'off'; i.spellcheck = false;
      const go = guard(() => onEnter?.(i.value), '写完以后');
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      return { el: i, value: () => i.value };
    },
    /**
     * 拖着排：items 是一张张卡（文字或 $公式$），slots 是几个空格（数，或每格的小标题）。
     * 手指拖卡进格子，也能先点卡再点格子；格子里的卡拖回下面或拖到别的格子。返回 { order()（每格里的卡，空格是 null）, reset() }
     */
    drag: ({ items = [], slots = items.length, shuffle = true, onChange, parent } = {}) => {
      const box = add(make('div', 'wg-drag'), parent);
      const labels = Array.isArray(slots) ? slots : Array.from({ length: Number(slots) || 0 }, () => '');
      const slotRow = add(make('div', 'wg-slots'), box);
      const tray = add(make('div', 'wg-tray'), box);
      const slotEls = labels.map((lab, i) => { const s = add(make('div', 'wg-slot'), slotRow); s.dataset.i = i; if (lab) s.dataset.label = String(lab); return s; });
      const order0 = items.map((_, i) => i);
      if (shuffle) for (let i = order0.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order0[i], order0[j]] = [order0[j], order0[i]]; }
      const chips = order0.map((k) => { const c = make('div', 'wg-chip', show(items[k])); c.dataset.k = k; c.tabIndex = 0; return c; });
      chips.forEach((c) => tray.appendChild(c));
      let picked = null;
      const order = () => slotEls.map((s) => { const c = s.querySelector('.wg-chip'); return c ? String(items[Number(c.dataset.k)]) : null; });
      const changed = guard(() => onChange?.(order()), '拖了以后');
      const place = (chip, slot) => {
        if (slot) { const had = slot.querySelector('.wg-chip'); if (had && had !== chip) { const from = chip.parentElement; (from?.classList.contains('wg-slot') ? from : tray).appendChild(had); } slot.appendChild(chip); } else tray.appendChild(chip);
        picked?.classList.remove('is-picked'); picked = null;
        changed();
      };
      // 点：先点卡、再点格子（拖不动的时候也能用）
      box.addEventListener('click', (e) => {
        if (box.dataset.dragged) { delete box.dataset.dragged; return; }
        const chip = e.target.closest('.wg-chip'); const slot = e.target.closest('.wg-slot');
        if (chip && (!picked || chip !== picked)) { if (!picked || !slot) { picked?.classList.remove('is-picked'); picked = chip; chip.classList.add('is-picked'); return; } }
        if (picked && slot) place(picked, slot);
        else if (picked && e.target.closest('.wg-tray')) place(picked, null);
      });
      // 拖：按住卡跟着手指走，松手落在哪个格子就放哪
      box.addEventListener('pointerdown', (e) => {
        const chip = e.target.closest('.wg-chip');
        if (!chip || e.button > 0) return;
        const r = chip.getBoundingClientRect();
        const dx = e.clientX - r.left, dy = e.clientY - r.top;
        let moved = false;
        const ghost = chip.cloneNode(true);
        const move = (ev) => {
          if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
          if (!moved) { moved = true; ghost.className = 'wg-chip wg-ghost'; Object.assign(ghost.style, { width: `${r.width}px` }); document.body.appendChild(ghost); chip.classList.add('is-lifted'); }
          ev.preventDefault();
          ghost.style.transform = `translate(${ev.clientX - dx}px, ${ev.clientY - dy}px)`;
        };
        const up = (ev) => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
          if (!moved) return;
          ghost.remove(); chip.classList.remove('is-lifted');
          box.dataset.dragged = '1';
          const under = document.elementFromPoint(ev.clientX, ev.clientY);
          const slot = under?.closest?.('.wg-slot');
          place(chip, slot && box.contains(slot) ? slot : under?.closest?.('.wg-tray') === tray ? null : chip.parentElement?.classList.contains('wg-slot') ? chip.parentElement : null);
        };
        window.addEventListener('pointermove', move, { passive: false });
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
      return { el: box, order, reset: () => { chips.forEach((c) => tray.appendChild(c)); changed(); } };
    },
    /** 精确计算（和 \calc 同一套，整节课 let 的量也能用）：{ tex, text } */
    calc: (src) => { const r = calcValue(String(src), calcScope()); return { tex: r.tex, text: r.text ?? exactText(r.value) }; },
    /** 两个式子是不是相等（矩阵不交换、标量交换、E 是单位矩阵）：true / false / 'unknown'（判不了） */
    same: (a, b) => equivalent(String(a), String(b)),
    /** 比顺序：{ ok, right, n, first（第一处不对的格，从 0 数） } */
    compare: (got, want) => compareOrder(got, want),
    /** 一件事做到没有：记一条作答（进证据、进 ext_out），板上显示 ✓ / ✗ 和一句话。返回 ok */
    goal: (q, ok, { value, text, say } = {}) => {
      session.record({ type: 'widget', q: String(q), ok: !!ok, el, ...(value !== undefined ? { value: Array.isArray(value) ? value.join(' ') : String(value) } : {}), ...(text ? { text: String(text) } : {}) });
      la.say(say ?? (ok ? '✓ 做到了' : '✗ 还不对'), ok ? 'ok' : 'bad');
      return !!ok;
    },
    /** 记一条作答（不显示）：{ q, value, ok, text } */
    record: ({ q = '', value, ok = null, text } = {}) => session.record({ type: 'widget', q: String(q), ok, el, ...(value !== undefined ? { value: String(value) } : {}), ...(text ? { text: String(text) } : {}) }),
    /** 记一条动作（学生做了什么，一句话），进 ext_out */
    event: (text) => session.event('widget', el, { text: String(text ?? '').slice(0, 400) }),
    /** 板上这一段下面的一句话（ok / bad / 普通） */
    say: (text, kind = '') => { sayEl.hidden = !text; sayEl.className = `wg-say${kind ? ` is-${kind}` : ''}`; sayEl.innerHTML = text ? mdToHtml(String(text), { inline: true }) : ''; },
    /** 动画：el.animate 的简写，返回结束的 Promise */
    animate: (node, keyframes, ms = 500) => node?.animate?.(keyframes, { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' })?.finished?.catch(() => {}) ?? Promise.resolve(),
    /** 给板书标注留的锚点：之后 board mark target=<组件 id>-<名字> 能指到这个元素 */
    anchor: (name, node) => { if (node) { node.dataset.bid = `${id}-${String(name || ++anchors)}`; } return node; },
  };
  try {
    new Function('la', w.code)(la);
  } catch (e) {
    // 一上来就跑不起来（语法错、调用写错）：照组件写错的规矩报，这一段不显示，外部改
    session.problem(el, 'widget', `代码跑不起来：${e?.message || e}`);
  }
}
