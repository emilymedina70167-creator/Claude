// 板书层：打开后用 Apple Pencil 直接在整页课件上写写画画。
// 笔写字，手指照常滚动和点按；笔迹跟着所在小节走，自动保存在这台设备上。
import { INK_COLORS, pen, radiusOf, beginStroke, addPoint, drawStroke, drawTail, drawEnd, hitStroke, History, samples } from './engine.js';
import { session } from '../session.js';
import { toast } from '../record.js';

const SIZES = { fine: 1.6, mid: 2.6, bold: 4.2 };
const ERASER_R = 14;
// 这些地方的点按始终交给界面本身（工具栏、进度条、助教、键盘……）
const CHROME = '.ink-bar, .ink-fab, .g-bar, .tutor, .tutor-fab, .keypad, .record-fallback, .ink-pad, .class-bar, .dev-panel';

const icon = {
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20l1.2-4.4L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.4 18.8z"/><path d="M13.8 7l3.2 3.2"/></svg>',
  eraser: '<svg viewBox="0 0 24 24"><path d="M8.5 19.5h11"/><path d="M4.6 15.4l8.8-8.8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8l-7.4 7.4H8.4z"/><path d="M9.2 10.8l5 5"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="M15 7l4.5 4.5L15 16"/><path d="M19 11.5h-9a5 5 0 0 0 0 10h2"/></svg>',
  clear: '<svg viewBox="0 0 24 24"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

export function initBoardInk(article) {
  const key = 'la-ink:' + session.title;
  const strokes = load(key);
  const hist = new History(strokes);
  const st = { on: false, tool: 'pen', color: 'white', size: 'mid', drawing: null, lastUp: 0, eraseBatch: null };

  // —— 画布：铺满可视区域，滚动时重画可见部分 ——
  const canvas = document.createElement('canvas');
  canvas.className = 'ink-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d', { desynchronized: true }) || canvas.getContext('2d');
  let dpr = 1;
  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    redraw();
  }

  // 锚点：引导模式下每节一个，否则整篇课件一个
  const anchors = () => {
    const ss = [...article.querySelectorAll('.stage')];
    return ss.length ? ss : [article];
  };
  // 笔画记在哪一节：实时黑板按段的 id（段会陆续加进来），其他按序号
  const keyOf = (el, i) => el.dataset?.step || i;
  const anchorEl = (k) => { const as = anchors(); return as.find((a, i) => keyOf(a, i) === k) || as[0]; };
  function anchorAt(clientY) {
    const as = anchors();
    for (let i = as.length - 1; i >= 0; i--) {
      if (as[i].hidden) continue;
      if (as[i].getBoundingClientRect().top <= clientY) return keyOf(as[i], i);
    }
    return keyOf(as[0], 0);
  }

  let queued = false;
  function redraw() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (st.hidden) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const as = anchors();
      const rects = new Map(as.map((a, i) => [keyOf(a, i), a.hidden ? null : a.getBoundingClientRect()]));
      for (const s of strokes) {
        const r = rects.has(s.a) ? rects.get(s.a) : rects.get(keyOf(as[0], 0));
        if (!r) continue;
        const b = s.bbox;
        if (b[3] + r.top < 0 || b[1] + r.top > innerHeight) continue;
        drawStroke(ctx, s, r.left, r.top);
      }
      if (st.drawing) drawStroke(ctx, st.drawing, st.drawing._ox, st.drawing._oy);
    });
  }

  // —— 工具栏 ——
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'ink-fab';
  fab.innerHTML = `${icon.pen}<span>板书</span>`;
  fab.setAttribute('aria-pressed', 'false');
  fab.title = '用 Apple Pencil 在课件上写字';
  document.body.appendChild(fab);

  const bar = document.createElement('div');
  bar.className = 'ink-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '板书工具');
  bar.innerHTML = `
    <button type="button" data-tool="pen" title="粉笔" aria-label="粉笔">${icon.pen}</button>
    <button type="button" data-tool="eraser" title="橡皮（擦掉整笔）" aria-label="橡皮">${icon.eraser}</button>
    <span class="ink-sep"></span>
    ${Object.entries(INK_COLORS).map(([k, c]) => `<button type="button" class="ink-color" data-color="${k}" style="--c:${c}" title="${{ white: '白', yellow: '黄', pink: '粉', blue: '蓝' }[k]}色粉笔" aria-label="${k}"><i></i></button>`).join('')}
    <span class="ink-sep"></span>
    ${Object.keys(SIZES).map((k) => `<button type="button" class="ink-size" data-size="${k}" title="${{ fine: '细', mid: '中', bold: '粗' }[k]}" aria-label="${k}"><i style="--d:${SIZES[k] * 2 + 2}px"></i></button>`).join('')}
    <span class="ink-sep"></span>
    <button type="button" data-act="undo" title="撤销（两指轻点）" aria-label="撤销">${icon.undo}</button>
    <button type="button" data-act="redo" title="重做（三指轻点）" aria-label="重做">${icon.redo}</button>
    <button type="button" data-act="clear" title="清空这一节的板书" aria-label="清空">${icon.clear}</button>
    <button type="button" data-act="close" title="收起板书" aria-label="收起">${icon.close}</button>`;
  document.body.appendChild(bar);

  const cursor = document.createElement('div');
  cursor.className = 'ink-cursor';
  cursor.hidden = true;
  document.body.appendChild(cursor);

  function syncBar() {
    bar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === st.tool));
    bar.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === st.color && st.tool === 'pen'));
    bar.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('on', b.dataset.size === st.size));
    bar.querySelector('[data-act="undo"]').disabled = !hist.undoStack.length;
    bar.querySelector('[data-act="redo"]').disabled = !hist.redoStack.length;
  }

  function setOn(on) {
    st.on = on;
    bar.hidden = !on;
    fab.classList.toggle('on', on);
    fab.setAttribute('aria-pressed', String(on));
    fab.querySelector('span').textContent = on ? '板书中' : '板书';
    document.body.classList.toggle('ink-on', on);
    if (on && !pen.seen) toast('用 Apple Pencil 在页面任意位置写字；手指照常滚动');
    syncBar();
  }

  fab.addEventListener('click', () => setOn(!st.on));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tool) st.tool = b.dataset.tool;
    if (b.dataset.color) { st.color = b.dataset.color; st.tool = 'pen'; }
    if (b.dataset.size) st.size = b.dataset.size;
    if (b.dataset.act === 'undo') undo();
    if (b.dataset.act === 'redo') redo();
    if (b.dataset.act === 'clear') clearStage(b);
    if (b.dataset.act === 'close') setOn(false);
    syncBar();
  });

  function undo() { if (hist.undo()) { redraw(); save(); syncBar(); } }
  function redo() { if (hist.redo()) { redraw(); save(); syncBar(); } }
  function clearStage(btn) {
    // 清空当前屏幕所在小节：第一次点只是确认
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      toast('再点一次，清空这一节的板书');
      setTimeout(() => btn.classList.remove('armed'), 2500);
      return;
    }
    btn.classList.remove('armed');
    const a = anchorAt(innerHeight / 2);
    hist.erase(strokes.filter((s) => s.a === a));
    redraw(); save();
  }

  // —— 书写 ——
  const inChrome = (t) => !!t?.closest?.(CHROME);
  const canDraw = (e) => st.on && (e.pointerType === 'pen' || e.pointerType === 'mouse') && !inChrome(e.target);

  function toLocal(e, s) { return [e.clientX - s._ox, e.clientY - s._oy]; }

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') pen.seen = true;
    if (!canDraw(e)) return;
    e.preventDefault();
    e.stopPropagation();
    try { document.documentElement.setPointerCapture(e.pointerId); } catch { /* 部分浏览器不支持 */ }
    cursor.hidden = true;
    const a = anchorAt(e.clientY);
    const r = anchorEl(a).getBoundingClientRect();
    if (st.tool === 'eraser') {
      st.drawing = null;
      st.eraseBatch = [];
      st.eraserId = e.pointerId;
      lastErase = null;
      eraseAt(e);
      return;
    }
    const s = beginStroke({ color: st.color, size: st.size, x: e.clientX - r.left, y: e.clientY - r.top, r: radiusOf(e, SIZES[st.size]) });
    s.a = a; s._ox = r.left; s._oy = r.top; s._id = e.pointerId;
    st.drawing = s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStroke(ctx, s, s._ox, s._oy);
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (st.on && e.pointerType === 'pen' && !e.buttons && !st.drawing) return hover(e);
    if (st.eraseBatch && e.pointerId === st.eraserId) { e.preventDefault(); e.stopPropagation(); for (const c of samples(e)) eraseAt(c); return; }
    const s = st.drawing;
    if (!s || e.pointerId !== s._id) return;
    e.preventDefault();
    e.stopPropagation();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of samples(e)) {
      const [x, y] = toLocal(c, s);
      if (addPoint(s, x, y, radiusOf(c, SIZES[s.size]))) drawTail(ctx, s, s._ox, s._oy);
    }
  }, true);

  function finish(e) {
    if (st.eraseBatch && e.pointerId === st.eraserId) {
      hist.recordErase(st.eraseBatch);
      st.eraseBatch = null;
      st.lastUp = performance.now();
      redraw(); save(); syncBar();
      return;
    }
    const s = st.drawing;
    if (!s || e.pointerId !== s._id) return;
    e.stopPropagation();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawEnd(ctx, s, s._ox, s._oy);
    st.drawing = null;
    delete s._ox; delete s._oy; delete s._id;
    hist.add(s);
    st.lastUp = performance.now();
    save(); syncBar();
  }
  document.addEventListener('pointerup', finish, true);
  document.addEventListener('pointercancel', finish, true);

  // 写完一笔后浏览器还可能补发 click，别让它点到下面的按钮
  document.addEventListener('click', (e) => {
    if (st.on && performance.now() - st.lastUp < 350 && !inChrome(e.target)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // 橡皮沿移动路径每隔几个像素检查一次，快速划过也不漏
  let lastErase = null;
  function eraseAt(e) {
    const prev = lastErase;
    lastErase = [e.clientX, e.clientY];
    if (prev) {
      const d = Math.hypot(e.clientX - prev[0], e.clientY - prev[1]);
      for (let t = 6; t < d; t += 6) eraseOne(prev[0] + ((e.clientX - prev[0]) * t) / d, prev[1] + ((e.clientY - prev[1]) * t) / d);
    }
    eraseOne(e.clientX, e.clientY);
  }
  function eraseOne(cx, cy) {
    const e = { clientX: cx, clientY: cy };
    const a = anchorAt(e.clientY);
    const r = anchorEl(a).getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = strokes.filter((s) => s.a === a && hitStroke(s, x, y, ERASER_R));
    if (!hit.length) return;
    // 碰到的整笔立刻消失；抬笔时合并成一次撤销
    hit.forEach((s) => { strokes.splice(strokes.indexOf(s), 1); st.eraseBatch.push(s); });
    redraw();
  }

  // —— 悬停预览：笔尖还没碰到屏幕时，显示落笔位置和粗细 ——
  let hoverTimer = 0;
  function hover(e) {
    if (inChrome(e.target)) { cursor.hidden = true; return; }
    const d = st.tool === 'eraser' ? ERASER_R * 2 : SIZES[st.size] * 2.6;
    cursor.hidden = false;
    cursor.className = `ink-cursor ${st.tool}`;
    cursor.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;width:${d}px;height:${d}px;--c:${INK_COLORS[st.color]}`;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => (cursor.hidden = true), 600);
  }
  document.addEventListener('pointerleave', () => (cursor.hidden = true));

  // —— 触摸：笔的触摸不触发滚动；手指两指轻点撤销、三指轻点重做 ——
  let tap = null;
  document.addEventListener('touchstart', (e) => {
    if (!st.on) return;
    const stylus = [...e.changedTouches].some((t) => t.touchType === 'stylus');
    if (stylus) { pen.seen = true; if (!inChrome(e.target)) e.preventDefault(); return; }
    if (e.touches.length >= 2) {
      tap = { n: e.touches.length, t: performance.now(), pts: [...e.touches].map((t) => [t.clientX, t.clientY]) };
    }
  }, { capture: true, passive: false });
  document.addEventListener('touchmove', (e) => {
    if (!tap) return;
    const moved = [...e.touches].some((t, i) => tap.pts[i] && Math.hypot(t.clientX - tap.pts[i][0], t.clientY - tap.pts[i][1]) > 12);
    if (moved) tap = null;
  }, { capture: true, passive: true });
  document.addEventListener('touchend', (e) => {
    if (!tap || e.touches.length) return;
    const quick = performance.now() - tap.t < 320;
    if (quick && tap.n === 2) { undo(); toast('已撤销'); }
    if (quick && tap.n === 3) { redo(); toast('已重做'); }
    tap = null;
  }, { capture: true, passive: true });

  // —— 保存 ——
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(key, JSON.stringify(strokes.map(({ color, size, pts, bbox, a }) => ({ color, size, pts, bbox, a })))); } catch { /* 存不下就算了 */ }
    }, 400);
  }

  addEventListener('scroll', redraw, { passive: true });
  addEventListener('resize', fit);
  new ResizeObserver(redraw).observe(article);
  fit();
  syncBar();

  return { setOn, get strokes() { return strokes; }, undo, redo };
}

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]').filter((s) => s && s.pts?.length); } catch { return []; }
}
