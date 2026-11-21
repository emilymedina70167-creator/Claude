// 抽样模拟 sim（概率第 4 批）：从一个分布里一次次抽样，看统计量的分布长什么样。
// 四种画面：hist 统计量的直方图（叠理论曲线）、path 样本均值随 n 的路径（大数定律、切比雪夫的带子）、
// intervals 一排置信区间（没盖住真值的标红）、scatter 二维正态的散点（样本相关系数）。
// 随机数带种子：同一张图每次打开、每个人看到的是同一组。写法在 prob/simspec.js，抽样在 prob/sim.js（都是纯函数）。
// 模拟出来的数只拿来看；判对错（ask）用的是理论值。
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { markDraft } from '../drafts.js';
import { compile } from '../expr.js';
import { parseSim, niceTicks, fillShow, varsOf, theoryVars, guessRange, judgeSimAsk } from '../prob/simspec.js';
import { parseDist, sampler, rng, simulator, histogram, interval, STATS } from '../prob/sim.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const W = 560, H = 320, L = 48, R = 14, T = 14, Bm = 36;
const MAX_REPS = 20000, KEEP_PATHS = 24, KEEP_INTERVALS = 40, TRIES = 3;
const tickText = (v) => String(Number(v.toPrecision(6)));

export function sim(el, src) {
  const spec = parseSim(src);
  const title = spec.fields.title || '抽样模拟 Sim';
  const body = widget(el, { cls: 'sim', title });
  for (const msg of spec.problems) session.problem(el, 'sim', msg);
  if (!spec.draw || spec.problems.some((m) => /^draw|要写 draw|成对|至少要|统计量/.test(m))) { body.innerHTML = `<div class="block-error">抽样模拟画不出来：${escapeHtml(spec.problems[0] || '')}</div>`; return; }
  const md = (s) => mdToHtml(s, { inline: true });
  const scatter = spec.view === 'scatter';

  body.innerHTML = `
    ${spec.fields.q ? `<div class="w-q">${mdToHtml(spec.fields.q)}</div>` : ''}
    <div class="sm-plot"></div>
    <div class="sm-ctl">
      ${spec.sliders.map((s, i) => `<label class="sm-slider"><span class="sm-sname">${md(s.label)}</span><input type="range" data-i="${i}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.init}"><span class="sm-sval">${tickText(s.init)}</span></label>`).join('')}
      <div class="sm-btns">
        ${scatter ? '<button type="button" class="btn btn-primary sm-go" data-k="1">再抽一组</button>' : '<button type="button" class="btn btn-primary sm-go" data-k="1">抽一次</button><button type="button" class="btn sm-go" data-k="100">抽 100 次</button><button type="button" class="btn sm-go" data-k="1000">抽 1000 次</button>'}
        <button type="button" class="btn sm-clear">清空</button>
      </div>
    </div>
    <div class="sm-shows"></div>
    <div class="sm-ask" hidden></div>
    ${spec.fields.note ? `<div class="w-note">${mdToHtml(spec.fields.note)}</div>` : ''}`;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sm-svg', role: 'img', 'aria-label': title }, body.querySelector('.sm-plot'));
  const showsBox = body.querySelector('.sm-shows'), askBox = body.querySelector('.sm-ask');

  const sl = Object.fromEntries(spec.sliders.map((s) => [s.name, s.init]));
  const data = { values: [], last: NaN, paths: [], nPaths: 0, inPaths: 0, intervals: [], total: 0, miss: 0, pts: [], r: NaN };
  let machine = null, draw1 = null, gen = null, range = null, err = '';
  const nNow = () => Math.max(1, Math.round(sl.n ?? spec.n));
  const vars = () => varsOf(spec, sl, { values: data.values, last: data.last, total: data.total, miss: data.miss, inband: data.nPaths ? data.inPaths / data.nPaths : NaN, r: data.r });

  // 滑块一动、点了清空：从头来（同一个种子，同一组随机数）
  function reset() {
    Object.assign(data, { values: [], last: NaN, paths: [], nPaths: 0, inPaths: 0, intervals: [], total: 0, miss: 0, pts: [], r: NaN });
    range = null; err = '';
    try {
      const dist = parseDist(spec.draw, sl);
      gen = rng(spec.seed); draw1 = sampler(dist);
      machine = spec.view === 'hist' ? simulator({ dist: spec.draw, n: nNow(), stat: spec.stat, seed: spec.seed, vars: sl }) : null;
    } catch (e) { err = e.message; machine = null; draw1 = null; }
  }
  function go(k) {
    if (err || !draw1) return;
    const n = nNow(), v = vars();
    // 抽的过程里出的错（σ 未知的区间样本不到两个……）写在图上，不让它成了没接住的页面错误
    try { drawMany(k, n, v); } catch (e) { err = e.message; }
    paint();
  }
  function drawMany(k, n, v) {
    for (let i = 0; i < k; i++) {
      if (spec.view === 'hist') {
        if (data.values.length >= MAX_REPS) break;
        const one = machine.next();
        if (Number.isFinite(one.value)) { data.values.push(one.value); data.last = one.value; }
      } else if (spec.view === 'path') {
        if (data.nPaths >= MAX_REPS) break;
        const path = new Float64Array(n); let s = 0;
        for (let j = 0; j < n; j++) { s += draw1(gen); path[j] = s / (j + 1); }
        data.nPaths++; data.last = path[n - 1]; data.values.push(path[n - 1]);
        if (spec.band && Math.abs(path[n - 1] - v.mu) < spec.band) data.inPaths++;
        data.paths.push(path); if (data.paths.length > KEEP_PATHS) data.paths.shift();
      } else if (spec.view === 'intervals') {
        if (data.total >= MAX_REPS) break;
        const xs = Array.from({ length: n }, () => draw1(gen));
        const [lo, hi] = interval({ xs, level: spec.level, sigma: spec.sigmaKnown ? v.sigma : undefined });
        const hit = lo <= v.mu && v.mu <= hi;
        data.total++; if (!hit) data.miss++;
        data.intervals.push({ lo, hi, hit }); if (data.intervals.length > KEEP_INTERVALS) data.intervals.shift();
        data.last = (lo + hi) / 2; data.values.push(data.last);
      } else {
        data.pts = Array.from({ length: n }, () => draw1(gen));
        data.r = n >= 2 ? STATS.r.run(data.pts) : NaN;
        data.values.push(data.r); data.last = data.r;
      }
    }
  }

  // —— 画 ——
  const X0 = L, X1 = W - R, Y0 = H - Bm, Y1 = T;
  function axes(xr, yr, { yTicks = true, xLabel = '' } = {}) {
    const sx = (x) => X0 + ((x - xr[0]) / (xr[1] - xr[0])) * (X1 - X0), sy = (y) => Y0 - ((y - yr[0]) / (yr[1] - yr[0])) * (Y0 - Y1);
    svgEl('line', { x1: X0, y1: Y0, x2: X1, y2: Y0, class: 'sm-axis' }, svg);
    svgEl('line', { x1: X0, y1: Y0, x2: X0, y2: Y1, class: 'sm-axis' }, svg);
    for (const t of niceTicks(xr[0], xr[1], 6)) { const x = sx(t); svgEl('line', { x1: x, y1: Y0, x2: x, y2: Y0 + 5, class: 'sm-axis' }, svg); svgEl('text', { x, y: Y0 + 18, class: 'sm-tick' }, svg).textContent = tickText(t); }
    if (yTicks) for (const t of niceTicks(yr[0], yr[1], 4)) { const y = sy(t); svgEl('line', { x1: X0 - 5, y1: y, x2: X0, y2: y, class: 'sm-axis' }, svg); svgEl('text', { x: X0 - 8, y, class: 'sm-tick is-y' }, svg).textContent = tickText(t); }
    if (xLabel) svgEl('text', { x: X1, y: Y0 + 32, class: 'sm-tick is-end' }, svg).textContent = xLabel;
    return { sx, sy };
  }
  const curveFns = spec.curves.map((c) => { try { return compile(c.src); } catch { return null; } });
  function drawCurves(sx, sy, xr, yTop, v) {
    spec.curves.forEach((c, i) => {
      const f = curveFns[i]; if (!f) return;
      const s = Object.create(v), pts = [];
      const val = (x) => { s.x = x; try { const y = f(s); return typeof y === 'number' && Number.isFinite(y) ? y : NaN; } catch { return NaN; } };
      if (spec.discrete) {
        for (let k = Math.ceil(xr[0]); k <= xr[1]; k++) { const y = val(k); if (Number.isNaN(y)) continue; svgEl('line', { x1: sx(k), y1: sy(0), x2: sx(k), y2: sy(Math.min(y, yTop)), class: `sm-stem c${i % 3}` }, svg); svgEl('circle', { cx: sx(k), cy: sy(Math.min(y, yTop)), r: 4, class: `sm-dot c${i % 3}` }, svg); }
      } else {
        let d = '', pen = false, best = null;
        for (let k = 0; k <= 240; k++) { const x = xr[0] + ((xr[1] - xr[0]) * k) / 240, y = val(x); if (Number.isNaN(y) || y > yTop * 1.5) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(Math.min(y, yTop)).toFixed(1)}`; pen = true; if (!best || y > best[1]) best = [x, y]; pts.push(1); }
        if (d) svgEl('path', { d, class: `sm-curve c${i % 3}` }, svg);
        if (c.label && best) svgEl('text', { x: Math.min(X1 - 40, Math.max(X0 + 40, sx(best[0]) + 46)), y: Math.max(Y1 + 12, sy(Math.min(best[1], yTop)) + 4), class: `sm-clabel c${i % 3}` }, svg).textContent = c.label;
      }
    });
  }
  function paintPlot() {
    svg.textContent = '';
    const v = vars(), n = nNow();
    if (err) { svgEl('text', { x: W / 2, y: H / 2, class: 'sm-empty' }, svg).textContent = err; return; }
    if (spec.view === 'hist') {
      // 横轴的范围：写了 x: 用它；没写的先按理论的 μ ± 4σ，攒够 30 个以后按数据定下来（之后不再跳）
      if (!spec.x && !range && data.values.length >= 30) { const a = [...data.values].sort((p, q) => p - q), lo = a[Math.floor(a.length * 0.01)], hi = a[Math.ceil(a.length * 0.99) - 1], pad = (hi - lo) * 0.35 || 1; range = [lo - pad, hi + pad]; }
      // 还没攒够时先按这个统计量理论上的中心和散布猜一个（和、均值、标准化的、χ²、S² 各不一样：prob/simspec.js 的 guessRange）
      let xr = spec.x || range || guessRange(spec.stat, v, n);
      if (!xr.every(Number.isFinite) || !(xr[1] > xr[0])) xr = [-4, 4];
      const h = spec.discrete ? histogram(data.values, { discrete: true }) : histogram(data.values, { bins: spec.bins, range: xr });
      const heights = spec.discrete ? h.freq : h.density;
      let top = Math.max(0, ...heights);
      const s = Object.create(v);
      for (const f of curveFns) { if (!f) continue; for (let k = 0; k <= 120; k++) { s.x = spec.discrete ? Math.round(xr[0] + ((xr[1] - xr[0]) * k) / 120) : xr[0] + ((xr[1] - xr[0]) * k) / 120; try { const y = f(s); if (typeof y === 'number' && Number.isFinite(y)) top = Math.max(top, Math.min(y, 50)); } catch { /* 没定义的点 */ } } }
      const yr = spec.y || [0, (top || 1) * 1.12];
      const { sx, sy } = axes(xr, yr);
      if (spec.discrete) h.values.forEach((x, i) => { if (x < xr[0] || x > xr[1]) return; const w = Math.min(28, (sx(1) - sx(0)) * 0.7); svgEl('rect', { x: sx(x) - w / 2, y: sy(Math.min(h.freq[i], yr[1])), width: w, height: Math.max(0, sy(0) - sy(Math.min(h.freq[i], yr[1]))), class: 'sm-bar' }, svg); });
      else h.density.forEach((d, i) => { if (!d) return; const xa = sx(h.edges[i]), xb = sx(h.edges[i + 1]), y = sy(Math.min(d, yr[1])); svgEl('rect', { x: xa + 0.5, y, width: Math.max(0, xb - xa - 1), height: Math.max(0, sy(0) - y), class: 'sm-bar' }, svg); });
      drawCurves(sx, sy, xr, yr[1], v);
      if (Number.isFinite(data.last) && data.values.length) svgEl('path', { d: `M${sx(Math.max(xr[0], Math.min(xr[1], data.last)))} ${Y0 + 2}l-5 9h10z`, class: 'sm-last' }, svg);
      if (!data.values.length) svgEl('text', { x: (X0 + X1) / 2, y: (Y0 + Y1) / 2, class: 'sm-empty' }, svg).textContent = '点「抽一次」开始';
    } else if (spec.view === 'path') {
      const half = spec.y ? null : Math.max(2.2 * v.sigma, (spec.band || 0) * 2.5) || 1;
      const yr = spec.y || [v.mu - half, v.mu + half];
      const { sx, sy } = axes([1, Math.max(2, n)], yr, { xLabel: '抽了几个' });
      if (spec.band) svgEl('rect', { x: X0, y: sy(Math.min(yr[1], v.mu + spec.band)), width: X1 - X0, height: Math.max(0, sy(Math.max(yr[0], v.mu - spec.band)) - sy(Math.min(yr[1], v.mu + spec.band))), class: 'sm-band' }, svg);
      svgEl('line', { x1: X0, y1: sy(v.mu), x2: X1, y2: sy(v.mu), class: 'sm-mu' }, svg);
      svgEl('text', { x: X1 - 4, y: sy(v.mu) - 7, class: 'sm-tick is-end' }, svg).textContent = `μ = ${tickText(v.mu)}`;
      data.paths.forEach((p, idx) => {
        const step = Math.max(1, Math.floor(p.length / 400)); let d = '';
        for (let j = 0; j < p.length; j += step) d += `${d ? 'L' : 'M'}${sx(j + 1).toFixed(1)} ${sy(Math.max(yr[0], Math.min(yr[1], p[j]))).toFixed(1)}`;
        svgEl('path', { d, class: `sm-path${idx === data.paths.length - 1 ? ' is-new' : ''}` }, svg);
      });
      if (!data.paths.length) svgEl('text', { x: (X0 + X1) / 2, y: Y1 + 26, class: 'sm-empty' }, svg).textContent = '点「抽一次」：一条线是抽 n 个的过程里样本均值怎么走';
    } else if (spec.view === 'intervals') {
      const se = v.sigma / Math.sqrt(n);
      const xr = spec.x || [v.mu - 5 * se, v.mu + 5 * se];
      const { sx } = axes(xr, [0, 1], { yTicks: false });
      svgEl('line', { x1: sx(v.mu), y1: Y0, x2: sx(v.mu), y2: Y1, class: 'sm-mu' }, svg);
      svgEl('text', { x: sx(v.mu) + 6, y: Y1 + 10, class: 'sm-tick is-start' }, svg).textContent = `μ = ${tickText(v.mu)}`;
      const rowH = (Y0 - Y1 - 16) / KEEP_INTERVALS;
      data.intervals.forEach((it, i) => {
        const y = Y1 + 18 + i * rowH, a = sx(Math.max(xr[0], it.lo)), bx = sx(Math.min(xr[1], it.hi));
        svgEl('line', { x1: a, y1: y, x2: bx, y2: y, class: `sm-ci${it.hit ? '' : ' is-miss'}` }, svg);
        svgEl('circle', { cx: sx(Math.max(xr[0], Math.min(xr[1], (it.lo + it.hi) / 2))), cy: y, r: 2.2, class: `sm-cidot${it.hit ? '' : ' is-miss'}` }, svg);
      });
      if (!data.total) svgEl('text', { x: (X0 + X1) / 2, y: (Y0 + Y1) / 2, class: 'sm-empty' }, svg).textContent = '点「抽一次」：一条横线是一个置信区间';
    } else {
      const xr = spec.x || [-3.6, 3.6], yr = spec.y || [-3.6, 3.6];
      const { sx, sy } = axes(xr, yr);
      svgEl('line', { x1: sx(0), y1: Y0, x2: sx(0), y2: Y1, class: 'sm-grid' }, svg); svgEl('line', { x1: X0, y1: sy(0), x2: X1, y2: sy(0), class: 'sm-grid' }, svg);
      for (const [x, y] of data.pts) { if (x < xr[0] || x > xr[1] || y < yr[0] || y > yr[1]) continue; svgEl('circle', { cx: sx(x), cy: sy(y), r: 3, class: 'sm-pt' }, svg); }
      if (!data.pts.length) svgEl('text', { x: (X0 + X1) / 2, y: (Y0 + Y1) / 2, class: 'sm-empty' }, svg).textContent = '点「再抽一组」';
    }
  }
  function paintShows() {
    const v = vars();
    const auto = spec.shows.length ? [] : [spec.view === 'intervals' ? `抽了 ${data.total} 个区间，${data.miss} 个没盖住 $\\mu$` : spec.view === 'path' ? `画了 ${data.nPaths} 条路径` : spec.view === 'scatter' ? (data.pts.length ? `样本相关系数 $r = ${Number(data.r.toPrecision(3))}$` : '') : `抽了 ${data.values.length} 次`];
    showsBox.innerHTML = [...spec.shows.map((t) => fillShow(t, v)), ...auto].filter(Boolean).map((t) => `<div class="sm-show">${md(t)}</div>`).join('');
  }
  function paint() { paintPlot(); paintShows(); }

  // —— 滑块、按钮 ——
  body.querySelectorAll('.sm-slider input').forEach((inp) => {
    const s = spec.sliders[Number(inp.dataset.i)];
    inp.addEventListener('input', () => { sl[s.name] = Number(inp.value); inp.parentElement.querySelector('.sm-sval').textContent = tickText(sl[s.name]); reset(); paint(); });
    inp.addEventListener('change', () => session.event('drag', el, { name: s.name, value: tickText(sl[s.name]) }));
  });
  body.querySelectorAll('.sm-go').forEach((btn) => btn.addEventListener('click', () => go(Number(btn.dataset.k))));
  body.querySelector('.sm-clear').addEventListener('click', () => { reset(); paint(); });

  // —— 问一个数（按理论值判，滑块现在的值）——
  const state = { i: 0, tries: 0, checked: '' };
  const gateDone = spec.asks.length ? session.gate(el, title) : null;
  const cur = () => (state.i < spec.asks.length ? spec.asks[state.i] : null);
  function paintAsk() {
    const a = cur();
    delete askBox.dataset.settled;
    if (!a) { if (!state.lastShown) askBox.hidden = true; return; }
    askBox.hidden = false;
    askBox.innerHTML = `<div class="sm-q">${spec.asks.length > 1 ? `<span class="sm-count">${state.i + 1} / ${spec.asks.length}</span>` : ''}${md(a.q)}</div>
      <div class="sm-fill"><input class="sm-input" inputmode="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="分数或小数" aria-label="填答案"></div>
      <div class="sm-actions"><button type="button" class="btn btn-primary sm-check">检查</button></div><div class="sm-fb" aria-live="polite"></div>`;
    const fbEl = askBox.querySelector('.sm-fb'), input = askBox.querySelector('.sm-input');
    const settle = (html, cls) => {
      const last = state.i >= spec.asks.length - 1;
      fbEl.className = `sm-fb ${cls}`; fbEl.innerHTML = html; input.setAttribute('disabled', ''); askBox.dataset.settled = '1';
      askBox.querySelector('.sm-actions').innerHTML = last ? '' : '<button type="button" class="btn btn-primary sm-next">下一问 ›</button>';
      if (last) { state.i = spec.asks.length; state.lastShown = true; gateDone?.(); }
      askBox.querySelector('.sm-next')?.addEventListener('click', () => { state.i++; state.tries = 0; state.checked = ''; paintAsk(); });
    };
    // 判对错、看答案只用理论上的量（滑块现在的值、n、mu、sigma）：模拟出来的数会抖，不拿来判
    const want = () => fillShow(`{${a.expr}}`, theoryVars(spec, sl));
    const check = () => {
      if (askBox.dataset.settled) return;
      const r = judgeSimAsk(a, input.value, theoryVars(spec, sl));
      if (r.ok === null) { fbEl.className = 'sm-fb is-hint'; fbEl.textContent = r.text; return; }
      if (input.value.trim() === state.checked) return; // 同一个答案又点了一次检查：不算一次新的尝试
      state.tries++; state.checked = input.value.trim();
      session.record({ type: 'sim', title, q: a.q.replace(/\s+/g, ' ').slice(0, 120), ok: r.ok, value: input.value.trim(), detail: r.text, attempts: state.tries, el });
      if (r.ok) { settle('✓ 对。', 'is-ok'); return; }
      fbEl.className = 'sm-fb is-bad';
      fbEl.innerHTML = `✗ ${escapeHtml(r.text)}${state.tries >= TRIES ? ' <button type="button" class="link-btn sm-reveal">看答案</button>' : ''}`;
      fbEl.querySelector('.sm-reveal')?.addEventListener('click', () => { session.record({ type: 'sim', title, q: a.q.replace(/\s+/g, ' ').slice(0, 120), ok: false, value: input.value.trim(), giveup: true, expected: want(), attempts: state.tries, el }); settle(`答案：${escapeHtml(want())}`, 'is-reveal'); });
    };
    askBox.querySelector('.sm-check').addEventListener('click', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  }
  markDraft(body, () => { if (!cur() || askBox.dataset.settled) return ''; const v = askBox.querySelector('.sm-input')?.value.trim() || ''; return v && v !== state.checked ? v : ''; });

  reset();
  paint();
  paintAsk();
}
