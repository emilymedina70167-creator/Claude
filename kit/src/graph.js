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
import { compile, isNum } from './expr.js';
import { splitMods, fillValues } from './scene.js';
import { mdToHtml, tex2html, escapeHtml } from './render.js';
import { sliderText, figureControls, dragHandles } from './plot.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 640, H = 400, ML = 52, MR = 18, MT = 18, MB = 40;
const CMDS = ['let', 'slider', 'plot', 'shade', 'bars', 'point', 'vline', 'hline', 'segment', 'text', 'show'];
const COLOR = {
  blue: 'var(--blue)', pink: 'var(--pink)', yellow: 'var(--yellow)', green: 'var(--green)', purple: 'var(--lav)',
  orange: 'var(--orange)', red: 'var(--coral)', white: 'var(--chalk)', gray: 'var(--muted)', grey: 'var(--muted)',
};

export function parseGraph(src) {
  const fields = {};
  const cmds = [];
  let last = null;
  const re = new RegExp(`^(${CMDS.join('|')})\\s+(.*)$`, 'i');
  for (const raw of String(src).split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const c = line.trim().match(re);
    if (c) { cmds.push({ ...parseCmd(c[1].toLowerCase(), c[2]), srcLine: line.trim() }); last = null; continue; }
    const f = line.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (f) { last = f[1].toLowerCase(); fields[last] = f[2]; continue; }
    if (last) fields[last] += '\n' + line;
    else throw new Error(`看不懂这一行：${line.trim()}`);
  }
  for (const k in fields) fields[k] = fields[k].trim();
  const win = (s, d) => { const m = String(s || '').trim().split(/[\s,，]+/).map(Number); return m.length === 2 && m.every(Number.isFinite) && m[1] > m[0] ? m : d; };
  return { fields, cmds, xr: win(fields.x, [-5, 5]), yr: fields.y ? win(fields.y, null) : null };
}

const num = (s) => (/^-?inf$/i.test(s) ? () => (s[0] === '-' ? -Infinity : Infinity) : compile(s));

function parseCmd(kind, rest) {
  if (kind === 'show') return { kind, text: rest.trim(), mods: {} };
  if (kind === 'text') {
    const m = rest.match(/^"([^"]*)"\s+at\s+(.*)$/) || rest.match(/^“([^”]*)”\s+at\s+(.*)$/);
    if (!m) throw new Error('text 的写法：text "文字" at [x, y]');
    const { body, mods } = splitMods(m[2]);
    return { kind, label: m[1], at: compile(body), mods };
  }
  const { body, mods } = splitMods(rest);
  if (kind === 'let') {
    const m = body.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!m) throw new Error('let 的写法：let 名字 = 表达式');
    return { kind, name: m[1], expr: compile(m[2]), mods };
  }
  if (kind === 'slider') {
    const m = body.match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)(?:\s*=\s*(\S+))?$/);
    if (!m) throw new Error('slider 的写法：slider p 0 1 = 0.5');
    const min = Number(m[2]), max = Number(m[3]);
    return { kind, name: m[1], min, max, init: m[4] !== undefined ? Number(m[4]) : min, step: Number(mods.step) || (max - min) / 100, mods };
  }
  if (kind === 'plot') return { kind, f: compile(body), mods };
  if (kind === 'shade') {
    // shade f(x) a b：x 从 a 到 b，曲线和 x 轴之间涂色（a、b 可以写 -inf / inf）
    const m = body.match(/^(.*\S)\s+(\S+)\s+(\S+)$/);
    if (!m) throw new Error('shade 的写法：shade f(x) 下限 上限');
    return { kind, f: compile(m[1]), a: num(m[2]), b: num(m[3]), mods };
  }
  if (kind === 'bars') {
    const [what, range] = body.split(/\s+for\s+/);
    const m = (range || '').trim().match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)$/);
    if (!m) throw new Error('bars 的写法：bars binompmf(k, 10, 0.3) for k 0 10');
    return { kind, f: compile(what), param: m[1], from: compile(m[2]), to: compile(m[3]), mods };
  }
  if (kind === 'vline' || kind === 'hline') return { kind, at: compile(body), mods };
  if (kind === 'point') return { kind, at: compile(body), mods };
  if (kind === 'segment') {
    const parts = body.split(/\s*,\s*(?=\[)/);
    if (parts.length !== 2) throw new Error('segment 的写法：segment [x1, y1], [x2, y2]');
    return { kind, a: compile(parts[0]), b: compile(parts[1]), mods };
  }
  throw new Error(`不认识的命令 ${kind}`);
}

// 好看的刻度间隔：1、2、5 × 10^k
function niceStep(span, n = 6) {
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
const fmtTick = (v, step) => { const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)); return String(Number(v.toFixed(d))); };

export function createGraph(container, src, opts = {}) {
  const { fields, cmds, xr, yr: yrGiven } = typeof src === 'string' ? parseGraph(src) : src;
  const extra = opts.extraVars || {};
  const state = { slider: {}, drag: {}, override: {} };
  cmds.filter((c) => c.kind === 'slider').forEach((c) => (state.slider[c.name] = c.init));
  container.innerHTML = '<div class="w-plot g-plot"></div><div class="w-side"><div class="sliders"></div><div class="readout r-show"></div></div>';
  const side = container.querySelector('.w-side');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'plane graph');
  container.querySelector('.g-plot').appendChild(svg);

  const env = () => {
    const v = { ...extra, ...state.slider };
    for (const c of cmds) {
      if (c.kind !== 'let') continue;
      v[c.name] = Object.hasOwn(state.override, c.name) ? state.override[c.name]
        : c.mods.drag && Object.hasOwn(state.drag, c.name) ? state.drag[c.name] : c.expr(v);
    }
    return v;
  };
  const at = (f, v, x, name = 'x') => { const y = f({ ...v, [name]: x }); if (!isNum(y)) throw new Error('函数值要是一个数'); return y; };

  // y 的范围没写时，按曲线自动取（从 0 开始，留一点头）
  let yr = yrGiven;
  if (!yr) {
    let top = 0, bot = 0;
    try {
      const v = env();
      for (const c of cmds) {
        if (c.kind === 'plot' || c.kind === 'shade') for (let i = 0; i <= 80; i++) { const y = at(c.f, v, xr[0] + ((xr[1] - xr[0]) * i) / 80); if (Number.isFinite(y)) { top = Math.max(top, y); bot = Math.min(bot, y); } }
        if (c.kind === 'bars') for (let k = Math.ceil(c.from(v)); k <= c.to(v); k++) top = Math.max(top, at(c.f, v, k, c.param));
      }
    } catch { /* 画的时候再报错 */ }
    if (top === bot) top = bot + 1;
    yr = [bot, top * 1.15 - bot * 0.15];
  }

  const X = (x) => ML + ((x - xr[0]) / (xr[1] - xr[0])) * (W - ML - MR);
  const Y = (y) => H - MB - ((y - yr[0]) / (yr[1] - yr[0])) * (H - MT - MB);
  const clampY = (y) => Math.max(MT - 4, Math.min(H - MB + 4, Y(y)));
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
  const visible = (c) => !(c.mods.from !== undefined && !((extra.step ?? 0) >= Number(c.mods.from))) && !(c.mods.until !== undefined && !((extra.step ?? 0) <= Number(c.mods.until)));

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
  function draw() {
    svg.innerHTML = '';
    axes();
    const errs = [];
    let v = null;
    try { v = env(); } catch (e) { errs.push(e.message); }
    const top = el('g', {});
    if (v) {
      const N = 240;
      for (const [i, c] of cmds.entries()) {
        if (!visible(c)) continue;
        cur = i + 1;
        try {
          const col = color(c, 'var(--v1)');
          if (c.kind === 'plot' || c.kind === 'shade') {
            const lo = c.kind === 'shade' ? Math.max(xr[0], c.a(v)) : xr[0];
            const hi = c.kind === 'shade' ? Math.min(xr[1], c.b(v)) : xr[1];
            if (!(hi > lo)) continue;
            const pts = [];
            for (let i = 0; i <= N; i++) {
              const x = lo + ((hi - lo) * i) / N;
              const y = at(c.f, v, x);
              if (Number.isFinite(y)) pts.push(`${X(x).toFixed(1)},${clampY(y).toFixed(1)}`);
            }
            if (c.kind === 'shade') {
              const base = clampY(0);
              const pg = el('polygon', { points: `${X(lo)},${base} ${pts.join(' ')} ${X(hi)},${base}`, class: 'g-shade' });
              pg.style.fill = color(c, 'var(--yellow)');
            } else {
              const pl = el('polyline', { points: pts.join(' '), class: `g-curve${c.mods.dashed ? ' dashed' : ''}${c.mods.thin ? ' thin' : ''}` });
              pl.style.stroke = col;
              if (c.mods.label) {
                const xl = xr[0] + (xr[1] - xr[0]) * (Number(c.mods.at) || 0.82);
                const t = el('text', { x: X(xl), y: clampY(at(c.f, v, xl)) - 12, class: 'g-label', 'text-anchor': 'middle' }, top);
                t.textContent = c.mods.label;
                t.style.fill = col;
              }
            }
          } else if (c.kind === 'bars') {
            const a = Math.ceil(c.from(v)), b = Math.floor(c.to(v));
            const bw = Math.max(3, Math.min(40, ((W - ML - MR) / (xr[1] - xr[0])) * 0.62));
            for (let k = a; k <= b; k++) {
              const y = at(c.f, v, k, c.param);
              const r = el('rect', { x: X(k) - bw / 2, y: Math.min(clampY(y), clampY(0)), width: bw, height: Math.abs(clampY(0) - clampY(y)), class: `g-bar${c.mods.highlight && compile(c.mods.highlight)({ ...v, [c.param]: k }) ? ' is-hl' : ''}` });
              r.style.fill = col;
            }
          } else if (c.kind === 'vline' || c.kind === 'hline') {
            const p = c.at(v);
            const ln = c.kind === 'vline'
              ? el('line', { x1: X(p), y1: MT, x2: X(p), y2: H - MB, class: `g-ref${c.mods.dashed === undefined ? ' dashed' : ''}` })
              : el('line', { x1: ML, y1: Y(p), x2: W - MR, y2: Y(p), class: 'g-ref dashed' });
            ln.style.stroke = color(c, 'var(--muted)');
            if (c.mods.label) {
              const t = el('text', c.kind === 'vline' ? { x: X(p), y: MT + 14, class: 'g-label', 'text-anchor': 'middle' } : { x: W - MR - 4, y: Y(p) - 8, class: 'g-label', 'text-anchor': 'end' }, top);
              t.textContent = c.mods.label;
              t.style.fill = color(c, 'var(--muted)');
            }
          } else if (c.kind === 'point') {
            const [px, py] = c.at(v);
            el('circle', { cx: X(px), cy: clampY(py), r: 6, class: 'pt' }).style.fill = color(c, 'var(--chalk)');
            if (c.mods.label) { const t = el('text', { x: X(px) + 10, y: clampY(py) - 10, class: 'g-label' }, top); t.textContent = c.mods.label; t.style.fill = color(c, 'var(--chalk)'); }
          } else if (c.kind === 'segment') {
            const [a, b] = [c.a(v), c.b(v)];
            el('line', { x1: X(a[0]), y1: clampY(a[1]), x2: X(b[0]), y2: clampY(b[1]), class: 'g-ref' }).style.stroke = color(c, 'var(--muted)');
          } else if (c.kind === 'text') {
            const [px, py] = c.at(v);
            el('text', { x: X(px), y: clampY(py), class: 'g-label' }, top).textContent = c.label;
          }
        } catch (e) { errs.push(e.message); }
      }
      // 可以拖的竖线：let a = 1 drag（算在这条 let 上）
      for (const [i, c] of cmds.entries()) {
        if (c.kind !== 'let' || !c.mods.drag || !visible(c)) continue;
        cur = i + 1;
        const x = v[c.name];
        el('line', { x1: X(x), y1: MT, x2: X(x), y2: H - MB, class: 'g-drag-line' }, top);
        el('circle', { cx: X(x), cy: H - MB, r: 15, class: 'handle', 'data-handle': c.name, style: `--vc:${color(c, 'var(--yellow)')}` }, top);
        el('text', { x: X(x), y: H - MB + 4, class: 'g-handle-label', 'text-anchor': 'middle', 'pointer-events': 'none' }, top).textContent = c.mods.label || c.name;
      }
      cur = null;
      side.querySelector('.r-show').innerHTML = cmds.map((c, i) => (c.kind === 'show' && visible(c) ? `<div data-cmd="${i + 1}">${mdToHtml(fillValues(c.text, v, errs), { inline: true })}</div>` : '')).join('');
    }
    cur = null;
    svg.appendChild(top);
    const msg = errs.join('；');
    if (msg !== lastErr) {
      lastErr = msg;
      let box = container.querySelector('.scene-error');
      if (msg) { if (!box) { box = document.createElement('div'); box.className = 'block-error scene-error'; side.appendChild(box); } box.textContent = '图形描述有误：' + msg; } else box?.remove();
    }
    ctl.mark();
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
  return {
    fields, draw,
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
