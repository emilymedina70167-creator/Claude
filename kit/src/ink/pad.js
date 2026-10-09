// 手写板：嵌在页面里的一块小黑板。用 Apple Pencil 写，写完可以交给 Claude 识别。
// 见过 Pencil 之后，手指在板上只滚动页面（防手掌误触）；没用过 Pencil 时手指也能写。
import { pen, radiusOf, beginStroke, addPoint, drawStroke, drawTail, drawEnd, History, strokesToBlob, samples } from './engine.js';

export function createPad(host, { height = 220, hint = '用 Apple Pencil 在这里写', actions = [], storageKey, size = 2.4 } = {}) {
  const el = document.createElement('div');
  el.className = 'ink-pad';
  el.innerHTML = `
    <div class="pad-area" style="height:${height}px"><canvas></canvas><div class="pad-hint">${hint}</div></div>
    <div class="pad-bar">
      <button type="button" class="btn btn-sm pad-undo" disabled>撤销</button>
      <button type="button" class="btn btn-sm pad-clear" disabled>擦掉重写</button>
      <span class="pad-gap"></span>
    </div>`;
  host.appendChild(el);
  const area = el.querySelector('.pad-area');
  const canvas = el.querySelector('canvas');
  const hintEl = el.querySelector('.pad-hint');
  const bar = el.querySelector('.pad-bar');
  const ctx = canvas.getContext('2d', { desynchronized: true }) || canvas.getContext('2d');
  const strokes = load(storageKey);
  const hist = new History(strokes);
  let dpr = 1, cur = null;

  const btns = actions.map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-sm${a.primary ? ' btn-primary' : ''}`;
    b.textContent = a.label;
    b.disabled = true;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await a.onClick(api); } finally { sync(); }
    });
    bar.appendChild(b);
    return b;
  });

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = area.clientWidth, h = area.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    redraw();
  }
  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    strokes.forEach((s) => drawStroke(ctx, s));
  }
  function sync() {
    const empty = !strokes.length;
    hintEl.hidden = !empty;
    el.querySelector('.pad-undo').disabled = !hist.undoStack.length;
    el.querySelector('.pad-clear').disabled = empty;
    btns.forEach((b) => (b.disabled = empty));
    if (storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(strokes.map(({ color, pts, bbox }) => ({ color, pts, bbox })))); } catch { /* 不保存 */ } }
  }

  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const usable = (e) => e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && !pen.seen);

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') markPen();
    if (!usable(e) || cur) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成事件或不支持时忽略 */ }
    const [x, y] = local(e);
    cur = beginStroke({ color: 'white', size, x, y, r: radiusOf(e, size) });
    cur._id = e.pointerId;
    hintEl.hidden = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStroke(ctx, cur);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur || e.pointerId !== cur._id) return;
    e.preventDefault();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of samples(e)) {
      const [x, y] = local(c);
      if (addPoint(cur, x, y, radiusOf(c, size))) drawTail(ctx, cur, 0, 0);
    }
  });
  const end = (e) => {
    if (!cur || e.pointerId !== cur._id) return;
    drawEnd(ctx, cur, 0, 0);
    delete cur._id;
    hist.add(cur);
    cur = null;
    sync();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // 笔的触摸不要滚动页面
  canvas.addEventListener('touchstart', (e) => {
    if ([...e.changedTouches].some((t) => t.touchType === 'stylus')) { markPen(); e.preventDefault(); }
  }, { passive: false });

  el.querySelector('.pad-undo').addEventListener('click', () => { hist.undo(); redraw(); sync(); });
  el.querySelector('.pad-clear').addEventListener('click', () => { hist.erase(strokes.slice()); redraw(); sync(); });

  new ResizeObserver(fit).observe(area);
  fit();
  sync();

  const api = {
    el,
    get strokes() { return strokes; },
    isEmpty: () => !strokes.length,
    toBlob: () => strokesToBlob(strokes),
    clear() { strokes.length = 0; hist.undoStack = []; hist.redoStack = []; redraw(); sync(); },
    remove() { el.remove(); },
  };
  return api;
}

export function markPen() {
  if (pen.seen) return;
  pen.seen = true;
  document.documentElement.classList.add('pen-seen');
}

function load(key) {
  if (!key) return [];
  try { return JSON.parse(localStorage.getItem(key) || '[]').filter((s) => s?.pts?.length); } catch { return []; }
}
