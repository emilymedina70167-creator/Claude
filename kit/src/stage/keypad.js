// 手势放下以后先问一个值时浮出来的一块（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）：数字键盘（倍数框、写一格），
// 一排选项（拉一段括号以后点成分）。画在舞台的屏幕那一层（stage.view，不跟着镜头缩小：按钮一直够 44px），点别处收起。
// 不用系统的输入框：iPad 上弹系统键盘会把舞台顶上去、聚焦还会放大；这块自己画的键盘能写负数、分数、小数就够了。
// 开着时也收外接键盘的键（keyOf）。padKey、keyOf 是纯函数（tests/stage-gestures.test.js）；别的碰 DOM，靠浏览器里真的点检查。
import { EASE } from './motion.js';

const MAX = 8; // 键盘最多写几个字（-123/456 够了）
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };

/**
 * 键盘上按一个键以后的字：数字往后接；减号只在最前面（再按一下去掉）；斜线一个、前面要有数字；
 * 小数点一个、前面要有数字、不在斜线后面（-3/2、0.5 都写得出，3/0.5 不收）；⌫ 退一个
 */
export function padKey(text, key) {
  const t = String(text ?? '');
  if (key === '⌫') return t.slice(0, -1);
  if (key === '−' || key === '-') return t.startsWith('-') ? t.slice(1) : t.length >= MAX ? t : `-${t}`;
  if (t.length >= MAX) return t;
  if (key === '/') return /\d$/.test(t) && !t.includes('/') ? `${t}/` : t;
  if (key === '.') return /\d$/.test(t) && !t.includes('.') && !t.includes('/') ? `${t}.` : t;
  return /^\d$/.test(key) ? t + key : t;
}

/**
 * 外接键盘（iPad 的妙控键盘、试演时的 Playwright）按的一个键 → 键盘上的哪个键：数字、- / .、退格（⌫）、回车（ok）；别的是 null（不收）。
 * 带 ⌘ / Ctrl / Option 的是系统的快捷键，不收
 */
export function keyOf(e) {
  if (!e || e.metaKey || e.ctrlKey || e.altKey) return null;
  const k = e.key;
  if (typeof k !== 'string') return null;
  if (/^\d$/.test(k) || k === '-' || k === '/' || k === '.') return k;
  if (k === '−') return '-';
  if (k === 'Backspace') return '⌫';
  if (k === 'Enter') return 'ok';
  return null;
}

// 最后一行 0、小数点、确定（确定占两格）：分数写 1/2，小数写 0.5 也行（矩阵记成精确的分数）
export const PAD_KEYS = [['7', '8', '9', '⌫'], ['4', '5', '6', '/'], ['1', '2', '3', '−'], ['0', '.', 'ok']];
const NAMES = { '⌫': '退格', '/': '分数线', '−': '负号', '.': '小数点', ok: '确定' };
const shown = (t) => String(t ?? '').replace('-', '−');

/**
 * 浮出来的一块放哪（屏幕坐标，相对 stage.view）：贴着 anchor 的下、上、右、左，挑第一个不出屏幕、不压着别的东西和 anchor 本身的；
 * 都压着就挑压得最少的
 */
export function placePop(stage, pop, anchor) {
  const w = pop.offsetWidth, h = pop.offsetHeight, vw = stage.view.clientWidth || 800, vh = stage.view.clientHeight || 800;
  const a = anchor || { x: vw / 2, y: vh / 2, w: 0, h: 0 };
  const cx = a.x + a.w / 2 - w / 2, cy = a.y + a.h / 2 - h / 2;
  const cands = [{ x: cx, y: a.y + a.h + 12 }, { x: cx, y: a.y - h - 12 }, { x: a.x + a.w + 12, y: cy }, { x: a.x - w - 12, y: cy }];
  const blocks = [...stage.screenBlocks(), ...(anchor ? [{ ...anchor, heavy: true }] : [])];
  const cost = (c) => {
    let k = c.x < 8 || c.y < 8 || c.x + w > vw - 8 || c.y + h > vh - 8 ? 1e7 : 0;
    for (const q of blocks) {
      const ox = Math.min(c.x + w, q.x + q.w) - Math.max(c.x, q.x), oy = Math.min(c.y + h, q.y + q.h) - Math.max(c.y, q.y);
      if (ox > 0 && oy > 0) k += ox * oy * (q.heavy ? 20 : 1);
    }
    return k;
  };
  let best = cands[0], bc = Infinity;
  for (const c of cands) { const k = cost(c); if (k < bc) { bc = k; best = c; } if (!k) break; }
  const x = Math.max(8, Math.min(vw - w - 8, best.x)), y = Math.max(8, Math.min(vh - h - 8, best.y));
  pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

// 一块浮出来的：放好、弹出来；点舞台别处收起（按在它自己身上不算）。onKey：开着时外接键盘按的键（keydown），收起时一起摘掉
function popup(stage, cls, anchor, onClose, onKey = null) {
  const pop = el('div', `st-gpop ${cls}`, stage.view);
  let open = true;
  const away = (ev) => { if (!pop.contains(ev.target)) close(); };
  const key = (ev) => onKey?.(ev);
  const close = () => {
    if (!open) return;
    open = false;
    stage.view.removeEventListener('pointerdown', away, true);
    if (onKey) document.removeEventListener('keydown', key, true);
    pop.remove();
    onClose?.();
  };
  const show = () => {
    placePop(stage, pop, anchor);
    stage.tween(pop, [{ opacity: 0, scale: '.9' }, { opacity: 1, scale: '1' }], { duration: 220, easing: EASE.spring });
    stage.view.addEventListener('pointerdown', away, true);
    if (onKey) document.addEventListener('keydown', key, true);
  };
  return { pop, close, show, isOpen: () => open };
}
// 键按在别的输入框里（对老师说的那一行、式子框）：是在那里打字，不归键盘
const typing = (t) => !!t?.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"]');

// 写错了：说一句，晃一下
function complain(pop, msg, text) {
  msg.textContent = text;
  pop.classList.remove('is-bad');
  void pop.offsetWidth;
  pop.classList.add('is-bad');
}

/**
 * 数字键盘：prompt 是问什么（「r₃ + k·r₁：k = ?」），onOk(写的字) 返回一句错（照它说、键盘不收）或 null（收起）。
 * 返回 { close }
 */
export function openKeypad(stage, { anchor = null, prompt = '', value = '', onOk, onClose = null } = {}) {
  // 外接键盘也能写：数字、- / .、退格、回车（keyOf）；收了的键不再给页面别处（退格不让浏览器后退、回车不交别的表单）
  const onKey = (ev) => {
    const k = typing(ev.target) ? null : keyOf(ev);
    if (!k) return;
    ev.preventDefault();
    ev.stopPropagation();
    press(k);
  };
  const P = popup(stage, 'st-keypad', anchor, onClose, onKey);
  // 对老师说的那一行还聚焦着（在舞台上点一格不会把焦点拿走）：外接键盘按的键会进那一行、不进键盘。先让它失焦（iPad 的系统键盘也跟着收起）
  const was = document.activeElement;
  if (was && stage.root?.contains(was) && typing(was)) was.blur();
  const { pop } = P;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', prompt || '写一个数');
  const head = el('div', 'st-kp-head', pop);
  el('span', 'st-kp-q', head).textContent = prompt;
  const out = el('output', 'st-kp-v', head);
  const msg = el('div', 'st-kp-msg', pop);
  msg.setAttribute('aria-live', 'polite');
  const grid = el('div', 'st-kp-keys', pop);
  let text = String(value ?? '');
  let ok = null;
  const paint = () => {
    out.textContent = shown(text) || ' ';
    if (ok) ok.disabled = !/\d$/.test(text);
  };
  const press = (k) => {
    if (k !== 'ok') { text = padKey(text, k); msg.textContent = ''; paint(); return; }
    if (!/\d$/.test(text)) return;
    const err = onOk?.(text);
    if (err) complain(pop, msg, err); else P.close();
  };
  for (const row of PAD_KEYS) for (const k of row) {
    const b = el('button', `st-kp-k${k === 'ok' ? ' is-ok' : /^[\d.]$/.test(k) ? '' : ' is-fn'}`, grid);
    b.type = 'button';
    b.textContent = k === 'ok' ? '确定' : k;
    if (NAMES[k]) b.setAttribute('aria-label', NAMES[k]);
    b.addEventListener('click', () => press(k));
    if (k === 'ok') ok = b;
  }
  paint();
  P.show();
  return { close: P.close };
}

/**
 * 一排选项（拉一段括号以后点成分）：choices = [{ value, text, paint? }]，onPick(value) 返回一句错或 null（收起）。返回 { close }
 */
export function openChoices(stage, { anchor = null, prompt = '', choices = [], onPick, onClose = null } = {}) {
  const P = popup(stage, 'st-choices', anchor, onClose);
  const { pop } = P;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', prompt || '选一个');
  if (prompt) el('div', 'st-ch-q', pop).textContent = prompt;
  const msg = el('div', 'st-kp-msg', pop);
  msg.setAttribute('aria-live', 'polite');
  const row = el('div', 'st-ch-row', pop);
  for (const c of choices) {
    const b = el('button', 'st-choice', row);
    b.type = 'button';
    if (c.paint) b.dataset.paint = c.paint;
    el('span', '', b).textContent = c.text;
    if (c.sub && c.sub !== c.text) el('small', '', b).textContent = c.sub;
    b.addEventListener('click', () => { const err = onPick?.(c.value); if (err) complain(pop, msg, err); else P.close(); });
  }
  P.show();
  return { close: P.close };
}
