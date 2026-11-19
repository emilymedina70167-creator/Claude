// 检验手写板（设计 5.4）：只在检验里出现（features.js 的 handwriting 照旧关着，这块板不看它）。
// 每一笔记 t0 / t1；没有橡皮，改错用「划掉」（留痕，和真考试一样）；「撤一笔」只撤 5 秒内写的最后一笔（笔误），划掉 3 秒内能撤；
// 「下一步」记一个分步的时刻；写满了「加一页」往下加 600px。只认 Pencil 和鼠标写，手指照常滚动（照 ink/pad.js）。
// 交的时候 export()：整页图、关键时刻的快照、时间线文字（inktime.js 从数据算，不当场截图）。没交的存在这台设备上（key，inkstore.js：空的不存），交了删
import { radiusOf, beginStroke, addPoint, drawStroke, drawTail, drawEnd, hitStroke, samples, pen } from '../ink/engine.js';
import { markPen } from '../ink/pad.js';
import { linesOf, keyMoments, frameAt, timelineText, PAUSE } from './inktime.js';
import { renderFrame } from './inkrender.js';
import { saveInk, loadInk, dropInk } from './inkstore.js';

const UNDO_STROKE = 5000;
const UNDO_STRIKE = 3000;
const PAGE = 600;
const SIZE = 2.4;

export function timedPad(host, { key = '', pause = PAUSE, now = () => Date.now(), height = 420 } = {}) {
  const store = (() => { try { return localStorage; } catch { return null; } })();
  const saved = loadInk(store, key);
  const strokes = saved?.strokes || [];
  const events = saved?.events || [];
  // 时间接着上一次（刷新、熄屏回来）：从存着的最后一刻往后数
  const base = now() - (saved?.at || 0);
  const t = () => now() - base;
  let h = Math.max(height, saved?.h || 0);
  let mode = 'pen'; // pen | strike
  let cur = null, strikePath = null, dpr = 1;
  const actions = []; // { kind: 'stroke' | 'strike', at, ids }

  const el = document.createElement('div');
  el.className = 'ck-pad';
  el.innerHTML = `<div class="ck-pad-bar">
      <button type="button" class="btn btn-sm ck-pad-pen is-on">写</button><button type="button" class="btn btn-sm ck-pad-strike">划掉</button>
      <button type="button" class="btn btn-sm ck-pad-undo" disabled>撤一下</button><button type="button" class="btn btn-sm ck-pad-step">下一步</button>
      <span class="ck-pad-gap"></span><button type="button" class="btn btn-sm ck-pad-more">加一页</button></div>
    <div class="ck-pad-area"><canvas></canvas><div class="ck-pad-hint">用 Apple Pencil 在这里写；写错了用「划掉」</div></div>`;
  host.appendChild(el);
  const area = el.querySelector('.ck-pad-area');
  const canvas = el.querySelector('canvas');
  const hint = el.querySelector('.ck-pad-hint');
  const ctx = canvas.getContext('2d', { desynchronized: true }) || canvas.getContext('2d');
  const color = () => getComputedStyle(document.documentElement).getPropertyValue('--ink-white').trim() || '#eae8e3';

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    area.style.height = `${h}px`;
    const w = area.clientWidth;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    redraw();
  }
  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of strokes) {
      const struck = s.struck !== undefined && s.struck !== null;
      ctx.globalAlpha = struck ? 0.35 : 1;
      drawStroke(ctx, s, 0, 0, color());
      ctx.globalAlpha = 1;
      if (struck) { const y = (s.bbox[1] + s.bbox[3]) / 2; ctx.strokeStyle = 'rgba(220, 80, 70, 0.8)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(s.bbox[0], y); ctx.lineTo(s.bbox[2], y); ctx.stroke(); }
    }
    sync();
  }
  function sync() {
    hint.hidden = strokes.length > 0;
    const last = actions.at(-1);
    el.querySelector('.ck-pad-undo').disabled = !last || now() - last.at > (last.kind === 'stroke' ? UNDO_STROKE : UNDO_STRIKE);
    el.querySelector('.ck-pad-pen').classList.toggle('is-on', mode === 'pen');
    el.querySelector('.ck-pad-strike').classList.toggle('is-on', mode === 'strike');
    save();
  }
  function save() { saveInk(store, key, { strokes, events, at: t(), h }); }

  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const usable = (e) => e.pointerType === 'pen' || e.pointerType === 'mouse' || (e.pointerType === 'touch' && !pen.seen);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') markPen();
    if (!usable(e) || cur || strikePath) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
    const [x, y] = local(e);
    if (mode === 'strike') { strikePath = { id: e.pointerId, pts: [[x, y]] }; return; }
    cur = beginStroke({ color: 'white', size: SIZE, x, y, r: radiusOf(e, SIZE) });
    cur._id = e.pointerId;
    cur.t0 = t();
    hint.hidden = true;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStroke(ctx, cur, 0, 0, color());
  });
  canvas.addEventListener('pointermove', (e) => {
    if (strikePath && e.pointerId === strikePath.id) { for (const c of samples(e)) strikePath.pts.push(local(c)); return; }
    if (!cur || e.pointerId !== cur._id) return;
    e.preventDefault();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of samples(e)) { const [x, y] = local(c); if (addPoint(cur, x, y, radiusOf(c, SIZE))) drawTail(ctx, cur, 0, 0); }
  });
  const end = (e) => {
    if (strikePath && e.pointerId === strikePath.id) {
      const at = t();
      const ids = strokes.map((s, i) => i).filter((i) => (strokes[i].struck === undefined || strokes[i].struck === null) && strikePath.pts.some(([x, y]) => hitStroke(strokes[i], x, y, 6)));
      strikePath = null;
      if (ids.length) { for (const i of ids) strokes[i].struck = at; events.push({ t: at, kind: 'strike', ids }); actions.push({ kind: 'strike', at: now(), ids }); }
      redraw();
      return;
    }
    if (!cur || e.pointerId !== cur._id) return;
    drawEnd(ctx, cur, 0, 0);
    delete cur._id;
    cur.t1 = t();
    strokes.push(cur);
    actions.push({ kind: 'stroke', at: now(), ids: [strokes.length - 1] });
    cur = null;
    sync();
    host.dispatchEvent(new Event('input', { bubbles: true }));
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('touchstart', (e) => { if ([...e.changedTouches].some((x) => x.touchType === 'stylus')) { markPen(); e.preventDefault(); } }, { passive: false });

  el.querySelector('.ck-pad-pen').addEventListener('click', () => { mode = 'pen'; sync(); });
  el.querySelector('.ck-pad-strike').addEventListener('click', () => { mode = 'strike'; sync(); });
  el.querySelector('.ck-pad-step').addEventListener('click', () => { events.push({ t: t(), kind: 'step', ids: [] }); sync(); });
  el.querySelector('.ck-pad-more').addEventListener('click', () => { h += PAGE; fit(); });
  el.querySelector('.ck-pad-undo').addEventListener('click', () => {
    const last = actions.pop();
    if (!last) return;
    if (last.kind === 'stroke') { strokes.splice(last.ids[0], 1); events.push({ t: t(), kind: 'undo', ids: last.ids }); }
    else { for (const i of last.ids) delete strokes[i].struck; events.push({ t: t(), kind: 'unstrike', ids: last.ids }); }
    redraw();
    host.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const ro = new ResizeObserver(fit);
  ro.observe(area);
  fit();
  const tick = setInterval(sync, 1000); // 撤一下按钮过了时限变灰

  return {
    el,
    get strokes() { return strokes; },
    get events() { return events; },
    isEmpty: () => !strokes.some((s) => s.struck === undefined || s.struck === null),
    /** 交：整页图、快照（每张是那一刻纸上的样子，和整页同一个范围）、时间线 */
    async export() {
      const lines = linesOf(strokes);
      const moments = keyMoments(strokes, events, { pause });
      const box = strokes.reduce((a, s) => [Math.min(a[0], s.bbox[0]), Math.min(a[1], s.bbox[1]), Math.max(a[2], s.bbox[2]), Math.max(a[3], s.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
      const final = await renderFrame(strokes, { lines, box });
      const shots = [];
      for (const m of moments) shots.push({ t: m.t, why: m.why, blob: await renderFrame(frameAt(strokes, m.t), { lines, box }) });
      return { final, shots, timeline: timelineText(strokes, events, lines, moments, { pause }), lines, strokes: strokes.map((s) => ({ ...s })), events: events.map((x) => ({ ...x })) };
    },
    clear() { dropInk(store, key); },
    destroy() { clearInterval(tick); ro.disconnect(); el.remove(); },
  };
}

