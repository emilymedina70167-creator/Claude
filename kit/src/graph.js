// 函数图：y = f(x) 的曲线、曲线下的面积、离散分布的柱子、可以拖的竖线。
// 给概率统计（密度、分布律、累积概率）和微积分式的直观用；坐标窗口可以不对称。
//
//   x: -4 4
//   y: 0 0.5
//   slider mu -2 2 = 0
//   let a = 1 drag
//   plot normpdf(x, mu, 1) color=blue label=f(x)
//   shade normpdf(x, mu, 1) -inf a color=yellow
//   bars binompmf(k, 10, 0.3) for k 0 10 color=pink
//   vline a color=yellow label=a
//   show $P(X\le a) = {normcdf(a, mu, 1)}$
import { isNum } from './expr.js';
import { parseGraph } from './graphspec.js';
import { compileWith } from './fx/defs.js';
import { sampleCurve, labelSpot } from './fx/curve.js';
import { riemannRects, betweenArea, areaBetween, placeLabels, smoothAt, autoRange } from './fx/graphgeom.js';
import { splitMods, fillValues } from './scene.js';
import { mdToHtml, tex2html, escapeHtml } from './render.js';
import { sliderText, figureControls, dragHandles } from './plot.js';
import { judgePicks, pickFeedback, snapPick } from './graphpick.js';
import { close } from './scene.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 640, H = 400, ML = 52, MR = 18, MT = 18, MB = 40;
const COLOR = {
  blue: 'var(--blue)', pink: 'var(--pink)', yellow: 'var(--yellow)', green: 'var(--green)', purple: 'var(--lav)',
  orange: 'var(--orange)', red: 'var(--coral)', white: 'var(--chalk)', gray: 'var(--muted)', grey: 'var(--muted)',
};

export { parseGraph };

// 好看的刻度间隔：1、2、5 × 10^k
function niceStep(span, n = 6) {
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const fmtTick = (v, step) => { const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)); return String(Number(v.toFixed(d))); };

let clipSeq = 0;
// 一帧里曲线一共最多采多少个点：曲线多、滑块拖得快时，后面的曲线少采一点（不卡手）
const FRAME_POINTS = 30000;
// 像素坐标别太离谱：冲出窗口很远的点压到这里，再由裁剪框裁掉（斜率差不了多少，极点附近的点本来就很密）
const FAR = 4000;
// 标签的大小粗估（手写体 23px）：中文一个字 23，别的 12
const labelSize = (s) => ({ w: [...String(s)].reduce((w, ch) => w + (/[⺀-鿿＀-￯]/.test(ch) ? 23 : 12), 0) + 6, h: 26 });

export function createGraph(container, src, opts = {}) {
  const { fields, cmds, defs, xr, yr: yrGiven } = typeof src === 'string' ? parseGraph(src) : src;
  // 读数、highlight= 里的式子：和曲线同一套（弧度、认 f(x) 的定义）
  const compile = (s) => compileWith(s, defs);
  const extra = opts.extraVars || {};
  const base = opts.baseVars || {};
  // goalsHit：做到了的 goal（命令的下标）；picks：每条 pick 学生点了哪些、判了没有
  const state = { slider: {}, drag: {}, override: {}, goalsHit: new Set(), picks: new Map() };
  cmds.filter((c) => c.kind === 'slider').forEach((c) => (state.slider[c.name] = c.init));
  const goalIdx = cmds.map((c, i) => (c.kind === 'goal' ? i : -1)).filter((i) => i >= 0);
  const pickIdx = cmds.map((c, i) => (c.kind === 'pick' ? i : -1)).filter((i) => i >= 0);
  pickIdx.forEach((i) => state.picks.set(i, { pts: [], tries: 0, done: false, giveup: false, res: null, msg: '' }));
  const hasTasks = goalIdx.length + pickIdx.length > 0;
  // 学生要做的都做到了（或者看了答案）：after 的东西这时才显示
  const revealed = () => hasTasks && goalIdx.every((i) => state.goalsHit.has(i)) && pickIdx.every((i) => state.picks.get(i).done);
  container.innerHTML = '<div class="w-plot g-plot"></div><div class="w-side"><div class="sliders"></div><div class="readout r-show"></div><div class="goal-msg" hidden></div></div>';
  const side = container.querySelector('.w-side');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'plane graph');
  container.querySelector('.g-plot').appendChild(svg);
  const clipId = `g-clip-${++clipSeq}`;

  // 一元函数：把自变量放进一层派生的变量里（不每个点拷贝一遍全部变量）
  const fnOf = (f, v, name = 'x') => { const vx = Object.create(v); return (x) => { vx[name] = x; const y = f(vx); if (!isNum(y)) throw new Error('函数值要是一个数'); return y; }; };
  const at = (f, v, x, name = 'x') => fnOf(f, v, name)(x);
  const quiet = (g) => (x) => { try { const y = g(x); return Number.isFinite(y) ? y : NaN; } catch { return NaN; } };

  const env = () => {
    const v = { ...base, ...extra, ...state.slider };
    for (const c of cmds) {
      if (c.kind === 'let') {
        v[c.name] = Object.hasOwn(state.override, c.name) ? state.override[c.name]
          : c.mods.drag && Object.hasOwn(state.drag, c.name) ? state.drag[c.name] : c.expr(v);
      } else if (c.name && c.kind === 'area') {
        // 起了名字的面积、黎曼和：后面的命令、读数、目标里是一个数
        v[c.name] = areaBetween(fnOf(c.f, v), fnOf(c.g, v), c.a(v), c.b(v));
      } else if (c.name && c.kind === 'riemann') {
        v[c.name] = riemannRects(fnOf(c.f, v), c.a(v), c.b(v), c.n(v), c.rule).sum;
      }
    }
    return v;
  };

  // y 的范围没写时，按曲线自动取（从 0 开始，留一点头；有极点时不被撑到几万，见 fx/graphgeom.js 的 autoRange）
  let yr = yrGiven;
  if (!yr) {
    const ys = [0];
    try {
      const v = env();
      const take = (f, lo, hi, name) => { const g = quiet(fnOf(f, v, name)); for (let i = 0; i <= 80; i++) { const y = g(lo + ((hi - lo) * i) / 80); if (!Number.isNaN(y)) ys.push(y); } };
      for (const c of cmds) {
        if (['plot', 'shade', 'tangent', 'secant', 'riemann'].includes(c.kind)) take(c.f, xr[0], xr[1]);
        if (c.kind === 'area') { take(c.f, xr[0], xr[1]); take(c.g, xr[0], xr[1]); }
        if (c.kind === 'bars' || c.kind === 'dots') { const g = quiet(fnOf(c.f, v, c.param)); for (let k = Math.ceil(c.from(v)); k <= Math.min(c.to(v), c.from(v) + 2000); k++) { const y = g(k); if (!Number.isNaN(y)) ys.push(y); } }
      }
    } catch { /* 画的时候再报错 */ }
    yr = autoRange(ys);
  }

  const X = (x) => ML + ((x - xr[0]) / (xr[1] - xr[0])) * (W - ML - MR);
  const Y = (y) => H - MB - ((y - yr[0]) / (yr[1] - yr[0])) * (H - MT - MB);
  const clampY = (y) => Math.max(MT - 4, Math.min(H - MB + 4, Y(y)));
  const farY = (y) => Math.max(-FAR, Math.min(H + FAR, Y(y)));
  const inside = (x, y) => x >= xr[0] - 1e-9 && x <= xr[1] + 1e-9 && y >= yr[0] - 1e-9 && y <= yr[1] + 1e-9;
  // cur：正在画第几条命令。这期间画出的元素带 data-cmd，课堂里 highlight 靠它找
  let cur = null;
  const el = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (cur != null) e.setAttribute('data-cmd', cur);
    parent.appendChild(e);
    return e;
  };
  const color = (c, d) => COLOR[String(c.mods.color || '').toLowerCase()] || d;
  const visible = (c) => !(c.mods.from !== undefined && !((extra.step ?? 0) >= Number(c.mods.from))) && !(c.mods.until !== undefined && !((extra.step ?? 0) <= Number(c.mods.until)))
    // after / before：配 goal、pick 用（做到以后才显示 / 做到以前显示）；图里没有要学生做的事时不管用
    && !(hasTasks && c.mods.after && !revealed()) && !(hasTasks && c.mods.before && revealed());

  function axes() {
    const sx = niceStep(xr[1] - xr[0], 8), sy = niceStep(yr[1] - yr[0], 5);
    for (let x = Math.ceil(xr[0] / sx) * sx; x <= xr[1] + 1e-9; x += sx) {
      el('line', { x1: X(x), y1: MT, x2: X(x), y2: H - MB, class: 'grid' });
      el('text', { x: X(x), y: H - MB + 24, class: 'tick', 'text-anchor': 'middle' }).textContent = fmtTick(x, sx);
    }
    for (let y = Math.ceil(yr[0] / sy) * sy; y <= yr[1] + 1e-9; y += sy) {
      el('line', { x1: ML, y1: Y(y), x2: W - MR, y2: Y(y), class: 'grid' });
      el('text', { x: ML - 8, y: Y(y) + 5, class: 'tick', 'text-anchor': 'end' }).textContent = fmtTick(y, sy);
    }
    const y0 = yr[0] <= 0 && yr[1] >= 0 ? Y(0) : H - MB;
    const x0 = xr[0] <= 0 && xr[1] >= 0 ? X(0) : ML;
    el('line', { x1: ML, y1: y0, x2: W - MR, y2: y0, class: 'axis' });
    el('line', { x1: x0, y1: MT, x2: x0, y2: H - MB, class: 'axis' });
    if (fields.xlabel) el('text', { x: W - MR, y: y0 - 8, class: 'axis-label', 'text-anchor': 'end' }).textContent = fields.xlabel;
    if (fields.ylabel) el('text', { x: x0 + 8, y: MT + 14, class: 'axis-label' }).textContent = fields.ylabel;
  }

  let lastErr = '';
  // 一帧画得慢（几千项的求和）时：正在拖、正在播的那几帧先画粗的（点少、不加密），手停了 0.2 秒再补一张细的
  let slow = false, lastEnd = 0, fineTimer = 0, firstDraw = true;
  const nowMs = () => (globalThis.performance?.now?.() ?? Date.now());
  // 式子抛错的原因（函数名写错、变量没定义……）：只是那一点没定义（NaN）不算
  const whyThrows = (fn, x) => { try { fn(x); return null; } catch (e) { return String(e?.message || e); } };
  function draw({ fine = false } = {}) {
    const t0 = nowMs();
    const coarse = !fine && slow && t0 - lastEnd < 400;
    clearTimeout(fineTimer);
    svg.innerHTML = '';
    cur = null;
    const clip = el('clipPath', { id: clipId }, el('defs', {}));
    el('rect', { x: ML, y: MT, width: W - ML - MR, height: H - MT - MB }, clip);
    axes();
    const errs = [];
    let v = null;
    try { v = env(); } catch (e) { errs.push(e.message); }
    // 曲线、涂色、矩形裁在坐标框里（冲出窗口的不压平）；点、标签在上面一层
    const plotG = el('g', { 'clip-path': `url(#${clipId})` });
    const top = el('g', {});
    const labels = []; // { x, y, text, fill, cmd }：先攒着，最后一起让位
    const want = (x, y, text, fill, dx = 0, dy = 0) => { if (text) labels.push({ x: X(x) + dx, y: clampY(y) + dy, text: String(text), fill, cmd: cur }); };
    const dot = (x, y, fill, hollow, r = 5.5) => {
      if (!inside(x, y)) return;
      const c = el('circle', { cx: X(x), cy: Y(y), r, class: `g-dot${hollow ? ' is-hollow' : ''}` }, top);
      if (hollow) c.style.stroke = fill; else c.style.fill = fill;
    };
    // 过 (x0, y0)、斜率 k 的直线，画满窗口
    const lineThrough = (x0, y0, k, col, cls) => {
      const ln = el('line', { x1: X(xr[0]), y1: farY(y0 + k * (xr[0] - x0)), x2: X(xr[1]), y2: farY(y0 + k * (xr[1] - x0)), class: cls }, plotG);
      ln.style.stroke = col;
      // 标签放在直线在窗口里的那一段的七成处
      const xs = []; for (let i = 0; i <= 40; i++) { const x = xr[0] + ((xr[1] - xr[0]) * i) / 40; if (inside(x, y0 + k * (x - x0))) xs.push(x); }
      return xs.length ? xs[Math.floor(xs.length * 0.7)] : null;
    };
    let spent = 0;
    const sample = (g, lo, hi) => {
      const r = sampleCurve(g, lo, hi, coarse ? { ySpan: yr[1] - yr[0], n: 80, maxPoints: 0 } : { ySpan: yr[1] - yr[0], n: spent > FRAME_POINTS ? 120 : 240, maxPoints: Math.max(400, FRAME_POINTS - spent) });
      for (const s of r.segs) spent += s.length;
      // 整条曲线一个点都算不出来、而且是抛了错：式子写错了，报出来（不静默画成空白）
      if (r.error) errs.push(r.error);
      return r;
    };
    const path = (seg) => seg.map(([x, y]) => `${X(x).toFixed(1)},${farY(y).toFixed(1)}`).join(' ');
    if (v) {
      const nBars = cmds.filter((c) => c.kind === 'bars' && visible(c)).length;
      let barAt = 0;
      for (const [i, c] of cmds.entries()) {
        if (!visible(c)) continue;
        cur = i + 1;
        try {
          const col = color(c, 'var(--v1)');
          if (c.kind === 'plot' || c.kind === 'shade') {
            const lo = Math.max(xr[0], c.kind === 'shade' ? c.a(v) : c.lo ? c.lo(v) : xr[0]);
            const hi = Math.min(xr[1], c.kind === 'shade' ? c.b(v) : c.hi ? c.hi(v) : xr[1]);
            if (!(hi > lo)) continue;
            const r = sample(fnOf(c.f, v), lo, hi);
            if (c.kind === 'shade') {
              const y0 = farY(0);
              for (const seg of r.segs) {
                const pg = el('polygon', { points: `${X(seg[0][0]).toFixed(1)},${y0} ${path(seg)} ${X(seg.at(-1)[0]).toFixed(1)},${y0}`, class: 'g-shade' }, plotG);
                pg.style.fill = color(c, 'var(--yellow)');
              }
              continue;
            }
            for (const seg of r.segs) {
              const pl = el('polyline', { points: path(seg), class: `g-curve${c.mods.dashed ? ' dashed' : ''}${c.mods.thin ? ' thin' : ''}` }, plotG);
              pl.style.stroke = col;
            }
            // 间断点：函数值在哪一边，那边实心、另一边空心；可去间断点空心（dots=off 不画）
            if (String(c.mods.dots).toLowerCase() !== 'off') {
              for (const j of r.jumps) {
                dot(j.x, j.left, col, j.solid !== 'left');
                dot(j.x, j.right, col, j.solid !== 'right');
                if (j.value !== undefined) dot(j.x, j.value, col, false);
              }
              for (const h of r.holes) { dot(h.x, h.y, col, true); if (h.value !== undefined) dot(h.x, h.value, col, false); }
            }
            if (c.mods.label) {
              // 标签挂在曲线上看得见的地方：写了 at= 用它，那里在窗口外就换一处
              const fr = [Number(c.mods.at) || 0.82, 0.7, 0.9, 0.55, 0.4, 0.25, 0.1].map((t) => labelSpot(r.segs, t, { x0: xr[0], x1: xr[1] })).find((p) => p && inside(p[0], p[1]));
              if (fr) want(fr[0], fr[1], c.mods.label, col, 0, -18);
            }
          } else if (c.kind === 'area') {
            const lo = Math.max(xr[0], c.a(v)), hi = Math.min(xr[1], c.b(v));
            if (!(hi > lo)) continue;
            const r = betweenArea(fnOf(c.f, v), fnOf(c.g, v), lo, hi);
            if (r.poly.length >= 3) el('polygon', { points: path(r.poly), class: 'g-shade' }, plotG).style.fill = color(c, 'var(--yellow)');
            else { const why = whyThrows(fnOf(c.f, v), (lo + hi) / 2) || whyThrows(fnOf(c.g, v), (lo + hi) / 2); if (why) errs.push(why); }
          } else if (c.kind === 'riemann') {
            const r = riemannRects(fnOf(c.f, v), c.a(v), c.b(v), c.n(v), c.rule);
            if (!r.rects.length) { const why = whyThrows(fnOf(c.f, v), (c.a(v) + c.b(v)) / 2); if (why) errs.push(why); }
            const rc = color(c, 'var(--yellow)');
            for (const q of r.rects) {
              const x0 = Math.min(q.x0, q.x1), x1 = Math.max(q.x0, q.x1);
              const rect = el('rect', { x: X(x0), y: Math.min(farY(q.y), farY(0)), width: Math.max(0.5, X(x1) - X(x0)), height: Math.abs(farY(0) - farY(q.y)), class: 'g-rect' }, plotG);
              rect.style.fill = rc; rect.style.stroke = rc;
              if (r.rects.length <= 40) el('circle', { cx: X(q.xs), cy: farY(q.y), r: 3, class: 'g-rdot' }, plotG).style.fill = rc;
            }
          } else if (c.kind === 'tangent') {
            const a = c.at(v), g = quiet(fnOf(c.f, v)), y0 = g(a), k = quiet(fnOf(c.df, v))(a);
            if (Number.isNaN(y0) || Number.isNaN(k)) { const why = whyThrows(fnOf(c.f, v), a) || whyThrows(fnOf(c.df, v), a); if (why) errs.push(why); continue; } // 那一点没定义、不可导：不画（式子写错了才报）
            if (!smoothAt(g, a, k, xr[1] - xr[0])) continue; // 尖点：左右导数不一样，没有切线
            const tc = color(c, 'var(--yellow)');
            const lx = lineThrough(a, y0, k, tc, `g-line${c.mods.dashed ? ' dashed' : ''}`);
            dot(a, y0, tc, false);
            if (c.mods.label && lx !== null) want(lx, y0 + k * (lx - a), c.mods.label, tc, 0, -18);
          } else if (c.kind === 'secant') {
            const a = c.a(v), b = c.b(v), g = quiet(fnOf(c.f, v)), ya = g(a), yb = g(b);
            if (Number.isNaN(ya) || Number.isNaN(yb) || Math.abs(b - a) < 1e-12) { const why = whyThrows(fnOf(c.f, v), a) || whyThrows(fnOf(c.f, v), b); if (why) errs.push(why); continue; }
            const sc = color(c, 'var(--pink)');
            const lx = lineThrough(a, ya, (yb - ya) / (b - a), sc, `g-line${c.mods.dashed ? ' dashed' : ''}`);
            dot(a, ya, sc, false); dot(b, yb, sc, false);
            if (c.mods.label && lx !== null) want(lx, ya + ((yb - ya) / (b - a)) * (lx - a), c.mods.label, sc, 0, -18);
          } else if (c.kind === 'bars') {
            const a = Math.ceil(c.from(v)), b = Math.floor(c.to(v));
            const full = Math.max(3, Math.min(40, ((W - ML - MR) / (xr[1] - xr[0])) * 0.62));
            // 一张图里几组柱子：并排，不叠着
            const bw = full / Math.max(1, nBars), off = -full / 2 + bw * barAt;
            barAt++;
            const g = fnOf(c.f, v, c.param), hl = c.mods.highlight ? fnOf(compile(c.mods.highlight), v, c.param) : null;
            for (let k = a; k <= b; k++) {
              const y = g(k);
              const r = el('rect', { x: X(k) + off, y: Math.min(farY(y), farY(0)), width: bw, height: Math.abs(farY(0) - farY(y)), class: `g-bar${hl && hl(k) ? ' is-hl' : ''}` }, plotG);
              r.style.fill = col;
            }
          } else if (c.kind === 'dots') {
            const a = Math.ceil(c.from(v)), b = Math.min(Math.floor(c.to(v)), a + 4000);
            const g = quiet(fnOf(c.f, v, c.param)), hl = c.mods.highlight ? fnOf(compile(c.mods.highlight), v, c.param) : null;
            const ps = [];
            for (let k = a; k <= b; k++) { const y = g(k); if (!Number.isNaN(y)) ps.push([k, y]); }
            if (!ps.length && b >= a) { const why = whyThrows(fnOf(c.f, v, c.param), a); if (why) errs.push(why); }
            if (c.mods.join && ps.length > 1) el('polyline', { points: path(ps), class: 'g-curve thin g-join' }, plotG).style.stroke = col;
            const r = ps.length > 120 ? 2.5 : ps.length > 40 ? 3.5 : 5;
            for (const [k, y] of ps) el('circle', { cx: X(k), cy: farY(y), r, class: `g-seq${hl ? (hl(k) ? ' is-hl' : ' is-dim') : ''}` }, plotG).style.fill = col;
            if (c.mods.label && ps.length) { const p = ps[Math.min(ps.length - 1, Math.floor(ps.length * 0.8))]; want(p[0], p[1], c.mods.label, col, 0, -18); }
          } else if (c.kind === 'vline' || c.kind === 'hline') {
            const p = c.at(v);
            const ln = c.kind === 'vline'
              ? el('line', { x1: X(p), y1: MT, x2: X(p), y2: H - MB, class: `g-ref${c.mods.dashed === undefined ? ' dashed' : ''}` })
              : el('line', { x1: ML, y1: Y(p), x2: W - MR, y2: Y(p), class: 'g-ref dashed' });
            ln.style.stroke = color(c, 'var(--muted)');
            if (c.mods.label) {
              if (c.kind === 'vline') labels.push({ x: X(p), y: MT + 14, text: c.mods.label, fill: color(c, 'var(--muted)'), cmd: cur });
              else labels.push({ x: W - MR - 4 - labelSize(c.mods.label).w / 2, y: Y(p) - 14, text: c.mods.label, fill: color(c, 'var(--muted)'), cmd: cur });
            }
          } else if (c.kind === 'point') {
            const [px, py] = c.at(v);
            const pc = color(c, 'var(--chalk)');
            if (c.mods.hollow) el('circle', { cx: X(px), cy: clampY(py), r: 6, class: 'g-dot is-hollow' }, top).style.stroke = pc;
            else el('circle', { cx: X(px), cy: clampY(py), r: 6, class: 'pt' }, top).style.fill = pc;
            if (c.mods.label) want(px, py, c.mods.label, pc, 12 + labelSize(c.mods.label).w / 2, -14);
          } else if (c.kind === 'segment') {
            const [a, b] = [c.a(v), c.b(v)];
            el('line', { x1: X(a[0]), y1: clampY(a[1]), x2: X(b[0]), y2: clampY(b[1]), class: 'g-ref' }).style.stroke = color(c, 'var(--muted)');
          } else if (c.kind === 'text') {
            const [px, py] = c.at(v);
            const t = el('text', { x: X(px), y: clampY(py), class: 'g-label' }, top);
            t.textContent = c.label;
            t.style.fill = color(c, 'var(--chalk)');
          }
        } catch (e) { errs.push(e.message); }
      }
      // 标签一起让位：谁也不压谁，不出坐标框
      const spots = placeLabels(labels.map((l) => ({ x: l.x, y: l.y, ...labelSize(l.text) })), { x0: ML, y0: MT, x1: W - MR, y1: H - MB });
      labels.forEach((l, i) => {
        cur = l.cmd;
        const t = el('text', { x: spots[i][0].toFixed(1), y: (spots[i][1] + 8).toFixed(1), class: 'g-label', 'text-anchor': 'middle' }, top);
        t.textContent = l.text;
        t.style.fill = l.fill;
      });
      // 可以拖的竖线：let a = 1 drag（算在这条 let 上）
      for (const [i, c] of cmds.entries()) {
        if (c.kind !== 'let' || !c.mods.drag || !visible(c)) continue;
        cur = i + 1;
        const x = v[c.name];
        // on= 的把手骑在曲线上：(a, f(a)) 一个圆点，往下一条细线落到 x 轴；那里曲线没定义、在窗口外就退回 x 轴上
        const hy = c.onF ? quiet(fnOf(c.onF, v))(x) : NaN;
        if (c.onF && !Number.isNaN(hy) && inside(x, hy)) {
          el('line', { x1: X(x), y1: Y(hy), x2: X(x), y2: yr[0] <= 0 && yr[1] >= 0 ? Y(0) : H - MB, class: 'g-drag-line' }, top);
          el('circle', { cx: X(x), cy: Y(hy), r: 5, class: 'g-dot' }, top).style.fill = color(c, 'var(--yellow)');
          el('circle', { cx: X(x), cy: Y(hy), r: 22, class: 'handle', 'data-handle': c.name, style: `--vc:${color(c, 'var(--yellow)')}` }, top);
          continue;
        }
        el('line', { x1: X(x), y1: MT, x2: X(x), y2: H - MB, class: 'g-drag-line' }, top);
        el('circle', { cx: X(x), cy: H - MB, r: 15, class: 'handle', 'data-handle': c.name, style: `--vc:${color(c, 'var(--yellow)')}` }, top);
        el('text', { x: X(x), y: H - MB + 4, class: 'g-handle-label', 'text-anchor': 'middle', 'pointer-events': 'none' }, top).textContent = c.mods.label || c.name;
      }
      // 学生点出来的点（紫色：「你的猜测」）；检查以后配上的变绿、多的变红；做完了画出目标（黄的实心点）
      for (const i of pickIdx) {
        const c = cmds[i], st = state.picks.get(i);
        cur = i + 1;
        const where = (p) => (c.on === 'free' ? p : c.on === 'axis' ? [p, yr[0] <= 0 && yr[1] >= 0 ? 0 : yr[0]] : [p, quiet(fnOf(c.onF, v))(p)]);
        st.pts.forEach((p, k) => {
          const [px, py] = where(p);
          if (Number.isNaN(py)) return;
          const cls = st.res ? (st.res.hits.includes(k) ? ' is-hit' : st.res.extra.includes(k) ? ' is-miss' : '') : '';
          el('circle', { cx: X(px), cy: clampY(py), r: 9, class: `g-pickpt${cls}` }, top);
        });
        if (st.done) {
          let ts = [];
          try { ts = c.targets(v); } catch { ts = []; }
          for (const t of ts) { const [px, py] = where(t); if (!Number.isNaN(py)) el('circle', { cx: X(px), cy: clampY(py), r: 5, class: 'g-dot g-target' }, top); }
        }
      }
      cur = null;
      side.querySelector('.r-show').innerHTML = cmds.map((c, i) => (c.kind === 'show' && visible(c) ? `<div data-cmd="${i + 1}">${mdToHtml(fillValues(c.text, v, errs, compile), { inline: true })}</div>` : '')).join('');
    }
    cur = null;
    // 第一次画（还没人动过）就成立的目标不算学生做到：和主讲摆上去的一样，学生挪开再回来才算
    if (v) checkGoals(v, ctl.quiet || firstDraw, errs);
    // 目标算不出来的（式子写错了、目标在窗口外点不到）：报出来
    for (const i of pickIdx) { const ts = targetsOf(cmds[i], v); if (ts instanceof Error) errs.push(ts.message); }
    firstDraw = false;
    const msg = [...new Set(errs)].join('；');
    if (msg !== lastErr) {
      lastErr = msg;
      let box = container.querySelector('.scene-error');
      if (msg) { if (!box) { box = document.createElement('div'); box.className = 'block-error scene-error'; side.appendChild(box); } box.textContent = '图形描述有误：' + msg; } else box?.remove();
    }
    ctl.mark();
    lastEnd = nowMs();
    if (coarse) fineTimer = setTimeout(() => draw({ fine: true }), 220);
    else slow = lastEnd - t0 > 45;
  }

  // goal：学生拖到、调到了算做到。主讲用 set / play 摆上去的（quiet）不算：记下来，学生挪开、再自己放回去才算（和 scene 一样）
  const placedByTeacher = new Set();
  function checkGoals(v, quiet, errs = []) {
    for (const i of goalIdx) {
      const c = cmds[i];
      if (state.goalsHit.has(i) || !visible(c)) continue;
      let ok = false;
      // 目标的式子算不出来（变量没定义、函数名写错）：报写法错误——不然这一关永远过不了，也没人知道为什么
      try { ok = c.cond ? !!c.cond(v) : close(c.lhs(v), c.rhs(v), Number(c.mods.tol) || 0.05); } catch (e) { ok = false; errs.push(`goal 算不出来：${e?.message || e}`); }
      if (quiet || !ok) { if (quiet && ok) placedByTeacher.add(i); else placedByTeacher.delete(i); continue; }
      if (placedByTeacher.has(i)) continue;
      state.goalsHit.add(i);
      const box = side.querySelector('.goal-msg');
      box.hidden = false;
      box.innerHTML = mdToHtml(c.mods.msg || '做到了！', { inline: true });
      ctl.emit('goal', i, c);
      // after 的东西这一下才该出来：再画一遍（goalsHit 已经记了，不会绕回来）
      if (revealed()) setTimeout(() => draw(), 0);
    }
  }

  // pick：图下面一条——题目、点了几个、检查。同时只有第一条没做完的在收点
  const plotBox = container.querySelector('.g-plot');
  const activePick = () => pickIdx.find((i) => !state.picks.get(i).done);
  const fmt = (p) => (Array.isArray(p) ? `(${p.map((x) => Number(x.toFixed(2))).join(', ')})` : String(Number(p.toFixed(2))));
  const tolOf = (c) => c.tol ?? (xr[1] - xr[0]) * 0.04;
  // 目标算不出来（式子写错了）：报写法错误，不让学生白点
  // 学生点不到的目标也算写错：在窗口外、或者曲线在那里没定义 / 冲出了窗口——不然学生怎么点都是「还差 1 个」
  const targetsOf = (c, v0) => {
    try {
      const v = v0 || env(), ts = c.targets(v);
      const g = c.on === 'curve' ? quiet(fnOf(c.onF, v)) : null;
      for (const t of ts) {
        const [px, py] = c.on === 'free' ? t : [t, c.on === 'curve' ? g(t) : yr[0]];
        if (!(px >= xr[0] && px <= xr[1]) || Number.isNaN(py) || !(py >= yr[0] && py <= yr[1])) return new Error(`pick 的目标 ${fmt(t)} 学生点不到（${Number.isNaN(py) ? '曲线在那里没有定义' : '不在窗口里'}）：改 x: / y: 的范围，或者改目标`);
      }
      return ts;
    } catch (e) { return e instanceof Error ? e : new Error(String(e)); }
  };
  function syncPicks() {
    const act = activePick();
    for (const i of pickIdx) {
      const c = cmds[i], st = state.picks.get(i), row = plotBox.querySelector(`.g-pick[data-pick="${i}"]`);
      const bad = targetsOf(c) instanceof Error;
      row.classList.toggle('is-done', st.done);
      row.classList.toggle('is-idle', !st.done && i !== act);
      row.querySelector('.g-pick-count').textContent = st.done ? '' : st.pts.length ? `点了 ${st.pts.length} 个` : c.on === 'curve' ? '在曲线上点出来' : c.on === 'axis' ? '在 x 轴上点出来' : '在图上点出来';
      row.querySelector('.g-pick-check').disabled = st.done || i !== act || bad;
      row.querySelector('.g-pick-clear').hidden = st.done || !st.pts.length;
      row.querySelector('.g-pick-show').hidden = st.done || st.tries < 3;
      const m = row.querySelector('.g-pick-msg');
      m.textContent = bad ? `图形描述有误：${targetsOf(c).message}` : st.msg;
      m.className = `g-pick-msg${bad ? ' is-bad' : st.done && !st.giveup ? ' is-ok' : st.res && !st.res.ok ? ' is-bad' : ''}`;
    }
  }
  function finishPick(i, giveup) {
    const c = cmds[i], st = state.picks.get(i);
    const ts = targetsOf(c);
    st.done = true; st.giveup = giveup;
    if (giveup) st.msg = '答案画在图上了（黄点）';
    ctl.emit('pick', i, { q: c.q, ok: !giveup, done: true, ...(giveup ? { giveup: true, expected: Array.isArray(ts) ? ts.map(fmt).join(', ') : '' } : {}), attempts: st.tries, value: st.pts.map(fmt).join(', '), text: st.msg });
    draw(); syncPicks();
  }
  for (const i of pickIdx) {
    const c = cmds[i], st = state.picks.get(i);
    const row = document.createElement('div');
    row.className = 'g-pick';
    row.dataset.pick = i;
    row.innerHTML = `<div class="g-pick-q">${mdToHtml(c.q, { inline: true })}</div><div class="g-pick-row"><span class="g-pick-count"></span><button type="button" class="btn btn-sm g-pick-clear" hidden>清空</button><button type="button" class="btn btn-primary g-pick-check">检查</button><button type="button" class="btn btn-sm g-pick-show" hidden>看答案</button></div><div class="g-pick-msg" aria-live="polite"></div>`;
    row.querySelector('.g-pick-clear').addEventListener('click', () => { st.pts = []; st.res = null; st.msg = ''; draw(); syncPicks(); });
    row.querySelector('.g-pick-show').addEventListener('click', () => finishPick(i, true));
    row.querySelector('.g-pick-check').addEventListener('click', () => {
      const ts = targetsOf(c);
      if (ts instanceof Error) return;
      st.tries++;
      // 随便点的：横竖比例不一样，按屏幕上的远近算（两个方向各除以窗口的宽高，再乘回横向的宽）
      const scale = c.on === 'free' ? [1, (yr[1] - yr[0]) / (xr[1] - xr[0])] : [1, 1];
      st.res = judgePicks(st.pts, ts, tolOf(c), { scale });
      st.msg = pickFeedback(st.res);
      if (st.res.ok) { finishPick(i, false); return; }
      ctl.emit('pick', i, { q: c.q, ok: false, done: false, attempts: st.tries, value: st.pts.map(fmt).join(', '), text: st.msg });
      draw(); syncPicks();
    });
    plotBox.appendChild(row);
  }
  // 点图：加一个点；点在已有的点上（22px 内）是去掉它。把手、拖动不算点
  let handleTap = false;
  if (pickIdx.length) {
    svg.addEventListener('pointerdown', (e) => { handleTap = !!e.target.getAttribute?.('data-handle'); }, true);
    svg.addEventListener('click', (e) => {
      const i = activePick();
      // 这一下是按在把手上的（按下时指针被 svg 接管，click 的目标是 svg 自己，认不出把手）：不算点图
      if (handleTap) { handleTap = false; return; }
      if (i === undefined || e.target.getAttribute?.('data-handle') || svg.classList.contains('dragging')) return;
      const c = cmds[i], st = state.picks.get(i);
      const r = svg.getBoundingClientRect(), k = W / r.width;
      const sx = (e.clientX - r.left) * k, sy = (e.clientY - r.top) * k;
      if (sx < ML - 6 || sx > W - MR + 6 || sy < MT - 6 || sy > H - MB + 6) return;
      const mx = xr[0] + ((sx - ML) / (W - ML - MR)) * (xr[1] - xr[0]), my = yr[0] + ((H - MB - sy) / (H - MT - MB)) * (yr[1] - yr[0]);
      let v;
      try { v = env(); } catch { return; }
      const g = c.on === 'curve' ? quiet(fnOf(c.onF, v)) : null;
      const screen = (p) => (c.on === 'free' ? [X(p[0]), Y(p[1])] : c.on === 'axis' ? [X(p), sy] : [X(p), Y(g(p))]);
      const near = st.pts.findIndex((p) => { const [px, py] = screen(p); return Math.hypot(px - sx, (c.on === 'free' ? py - sy : 0)) <= 22 * k; });
      st.res = null; st.msg = '';
      if (near >= 0) st.pts.splice(near, 1);
      else {
        const p = snapPick(Number(mx.toFixed(3)), Number(my.toFixed(3)), { on: c.on, f: g });
        if (p === null) st.msg = '这里曲线没有定义';
        else if (st.pts.length >= 12) st.msg = '最多点 12 个：点一下已有的点去掉它';
        else st.pts.push(p);
      }
      draw(); syncPicks();
    });
  }

  // 课堂操作（play / set / highlight / vars / dragend）：见 plot.js 的 figureControls
  const ctl = figureControls({
    root: container, cmds, state, extra, env, draw: () => draw(),
    // 可拖的竖线只有横坐标；设到窗口外就停在边上（和手拖一样）
    dragValue: (name, x) => {
      const n = Array.isArray(x) && x.length === 1 ? x[0] : x;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`${name} 是可以拖的竖线，要设成一个数`);
      return Math.max(xr[0], Math.min(xr[1], n));
    },
  });

  // 滑块（行上记下命令序号：highlight 这条 slider 时让这一行闪）
  for (const [i, c] of cmds.entries()) {
    if (c.kind !== 'slider') continue;
    const row = document.createElement('div');
    row.className = 'coef';
    row.dataset.cmd = i + 1;
    row.innerHTML = `${c.mods.play ? '<button type="button" class="btn btn-sm btn-play">▶</button>' : ''}<span class="coef-name">${c.mods.label ? escapeHtml(c.mods.label) : tex2html(c.name)}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.init}" aria-label="${escapeHtml(c.name)}"><output></output>`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    const sync = (moving = false) => { input.value = state.slider[c.name]; out.textContent = sliderText(state.slider[c.name], moving); };
    // 学生自己拖滑块时，停下正在播放的动画；拖着的时候读数写小数，松手再写成分数
    input.addEventListener('input', () => { ctl.stop(c.name); state.slider[c.name] = Number(input.value); sync(true); draw(); });
    input.addEventListener('change', () => sync(false));
    row.querySelector('.btn-play')?.addEventListener('click', () => ctl.animate(c.name, c.min, c.max, 1600));
    c.sync = sync;
    sync();
    side.querySelector('.sliders').appendChild(row);
  }

  // 拖竖线：按下时停掉这条线上的动画，记住手指和线的偏移（线不会一按就跳到指尖）；
  // 只点一下（没拖出几像素）不挪线；松手时线真的挪了才发 dragend
  const toX = (e) => { const r = svg.getBoundingClientRect(); return xr[0] + (((e.clientX - r.left) / r.width) * W - ML) / (W - ML - MR) * (xr[1] - xr[0]); };
  let dragFrom = null, grab = 0;
  dragHandles(svg, toX, (name, x, phase, moved) => {
    const c = cmds.find((k) => k.kind === 'let' && k.name === name);
    if (!c) return;
    if (phase === 'start') {
      ctl.stop(name);
      dragFrom = (() => { try { return env()[name]; } catch { return state.drag[name]; } })();
      grab = typeof dragFrom === 'number' && Number.isFinite(x) ? dragFrom - x : 0;
      return;
    }
    if (moved && Number.isFinite(x)) {
      const step = Number(c.mods.snap) || niceStep(xr[1] - xr[0], 8) / 10;
      // 按步长取整后再修掉浮点尾巴（0.7000000000000001 → 0.7）
      state.drag[name] = Math.max(xr[0], Math.min(xr[1], Number((Math.round((x + grab) / step) * step).toFixed(10))));
      draw();
    }
    if (phase === 'end') {
      const to = Object.hasOwn(state.drag, name) ? state.drag[name] : dragFrom;
      if (moved && typeof to === 'number' && !(Math.abs(to - dragFrom) < 1e-9)) ctl.emit('dragend', name, to);
      dragFrom = null;
    }
  });

  draw();
  syncPicks();
  return {
    fields, draw,
    // 学生要做的事有几件（blocks/figures.js 据此当关卡、记作答）
    goals: goalIdx.length,
    picks: pickIdx.length,
    // after 要配 goal / pick：没有要做的事时一直显示，自检提一句
    get lonelyAfter() { return !hasTasks && cmds.some((c) => c.mods.after || c.mods.before); },
    // 现在做到哪了：黑板现状、板边助教读
    tasks() { return { goals: `${state.goalsHit.size}/${goalIdx.length}`, picks: pickIdx.map((i) => { const st = state.picks.get(i); return { q: cmds[i].q, picked: st.pts.map(fmt), tries: st.tries, done: st.done, ...(st.giveup ? { giveup: true } : {}) }; }) }; },
    animate: ctl.animate,
    on: ctl.on,
    snapshot() { return ctl.withTargets(() => { try { const v = env(); const o = {}; for (const c of cmds) if (c.kind === 'let' || c.kind === 'slider') o[c.name] = v[c.name]; return o; } catch { return {}; } }); },
    // 课堂操作：set / play / highlight / vars（scene、graph、space 一样）
    set: ctl.set,
    play: ctl.play,
    highlight: ctl.highlight,
    vars: ctl.vars,
    get error() { return lastErr; },
  };
}
