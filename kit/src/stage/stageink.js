// 舞台上用 Apple Pencil 直接写（2026-11-14 我要的：以前要先点「板书」才能写、还弹提示；现在 Pencil 一碰画面就是写，
// 手指照常拖、点舞台上的东西）。字写在画面最上面一层（一张 canvas，盖在东西上、在底下那一条下面），
// 每一轮发给老师的画面图（snap.js 拍整块舞台）就带着它——学生写完点「给老师看」，老师直接看图读手写，不用学生截图。
// 写过的留在画面上（我选的：老师讲的时候还能指着），学生自己「撤一笔」「擦掉」，换一幕（scene）整个收起。
// 笔迹的样子用板书那一套（ink/engine.js：压力、倾斜、圆润的曲线）；坐标是舞台画面（.st-view）里的屏幕像素
import { radiusOf, beginStroke, addPoint, drawStroke, drawTail, drawEnd, samples } from '../ink/engine.js';

// Pencil 落在这些上面不写字（照常按按钮、点输入框、拨拨盘、开浮层）
export const INK_PASS = '.st-dock, .st-dock-wide, button, input, textarea, select, a, [contenteditable], .st-ink-bar, .st-talk-pop, .st-undo-box, .st-scenes, .st-dial, .st-keypad, .fi-keys';

/** 这一下是不是要写字：只认 Pencil，落在按钮、输入框这些上面的不算（纯函数，testable：target 给一个有 closest 的对象） */
export function inkStarts(e) {
  if (!e || e.pointerType !== 'pen' || e.button > 0) return false;
  return !e.target?.closest?.(INK_PASS);
}

const el = (tag, cls, parent) => { const n = document.createElement(tag); if (cls) n.className = cls; if (parent) parent.appendChild(n); return n; };

/**
 * stage：舞台（用它的 view、root）。onChange()：笔画多了、少了（画面图要重拍、发送按钮要换字）。
 * 返回 { count(), unsent()（上一次交给老师以后新写的几笔）, markSent(), undo(), clear(), destroy() }
 */
export function createStageInk(stage, { onChange = () => {} } = {}) {
  const view = stage.view;
  const canvas = el('canvas', 'st-ink-canvas', view);
  const ctx = canvas.getContext('2d');
  const bar = el('div', 'st-ink-bar', view);
  bar.hidden = true;
  const undoBtn = el('button', 'st-ink-undo', bar);
  undoBtn.type = 'button';
  undoBtn.textContent = '撤一笔';
  const clearBtn = el('button', 'st-ink-clear', bar);
  clearBtn.type = 'button';
  clearBtn.textContent = '擦掉';
  const strokes = [];
  let sent = 0; // 前 sent 笔已经交给老师看过了
  let cur = null, curId = null, dpr = 1;
  const color = () => {
    try { return getComputedStyle(view).getPropertyValue('--st-brand').trim() || '#5b2a6e'; } catch { return '#5b2a6e'; }
  };
  let ink = color();

  function fit() {
    const w = view.clientWidth, h = view.clientHeight;
    dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    redraw();
  }
  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of strokes) drawStroke(ctx, s, 0, 0, ink);
  }
  function changed() {
    bar.hidden = !strokes.length;
    onChange();
  }
  const local = (e) => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const base = () => Math.max(1.4, Math.min(2.6, view.clientWidth / 520)); // 字的粗细跟着屏幕大小走一点

  // 在舞台自己的手指处理（pointer.js 挂在 view 上）之前接住 Pencil：捕获阶段、停掉往下传
  function down(e) {
    if (!inkStarts(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (cur) return;
    ink = color();
    const p = local(e);
    cur = beginStroke({ color: ink, size: 'mid', x: p.x, y: p.y, r: radiusOf(e, base()) });
    curId = e.pointerId;
    try { view.setPointerCapture?.(e.pointerId); } catch { /* 有的浏览器不让 */ }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function move(e) {
    if (!cur || e.pointerId !== curId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    for (const q of samples(e)) {
      const p = local(q);
      if (addPoint(cur, p.x, p.y, radiusOf(q, base()))) drawTail(ctx, { ...cur, color: ink }, 0, 0);
    }
  }
  function up(e) {
    if (!cur || e.pointerId !== curId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    drawEnd(ctx, { ...cur, color: ink }, 0, 0);
    strokes.push(cur);
    cur = null;
    curId = null;
    changed();
  }
  view.addEventListener('pointerdown', down, true);
  view.addEventListener('pointermove', move, true);
  view.addEventListener('pointerup', up, true);
  view.addEventListener('pointercancel', up, true);
  // Pencil 在画面上按着的时候 Safari 别拿它去选字、弹放大镜
  const noTouch = (e) => { if (cur && e.cancelable) e.preventDefault(); };
  view.addEventListener('touchmove', noTouch, { passive: false });

  undoBtn.addEventListener('click', () => { if (!strokes.length) return; strokes.pop(); sent = Math.min(sent, strokes.length); redraw(); changed(); });
  clearBtn.addEventListener('click', () => api.clear());

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  ro?.observe(view);
  fit();

  const api = {
    count: () => strokes.length,
    unsent: () => strokes.length - sent,
    markSent() { sent = strokes.length; },
    clear() { if (!strokes.length) return; strokes.length = 0; sent = 0; redraw(); changed(); },
    undo() { undoBtn.click(); },
    destroy() {
      ro?.disconnect();
      view.removeEventListener('pointerdown', down, true);
      view.removeEventListener('pointermove', move, true);
      view.removeEventListener('pointerup', up, true);
      view.removeEventListener('pointercancel', up, true);
      view.removeEventListener('touchmove', noTouch);
      canvas.remove();
      bar.remove();
    },
  };
  return api;
}
