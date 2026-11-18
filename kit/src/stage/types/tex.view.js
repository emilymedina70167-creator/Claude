// 式子的画法（types/tex.js 的画面那一半）：每一行是一段 KaTeX；有名字的项上面盖一块透明的「项」（部件的节点：点亮、挖空、点它都在这块上），
// 染色、灰掉照到 KaTeX 里那一项的字上。专门的动作：retex / next 的变形（同名的项飞过去，像 Manim 的 TransformMatchingTex）、放大、收回放大。
// 项的位置要等 KaTeX 画出来才量得到：量好写回 o.geo（tex.js 的 geometry 读它），贴字、镜头、连线就和画面对得上
import { EASE, moveDuration, stagger, arcPoints } from '../motion.js';
import { texHtml, TEX_FONT, LINE_GAP, ZOOM, zoomBox } from './tex.js';

const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const PAD = 4; // 项的那一块比字大一圈
const paint = (n, c) => { if (!n) return; if (c) n.dataset.paint = c; else delete n.dataset.paint; };
const termIn = (n, name) => n?.querySelector(`[data-term="${CSS.escape(name)}"]`) || null;

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('st-css-tex')) return;
  const s = document.createElement('style');
  s.id = 'st-css-tex';
  s.textContent = texView.css;
  document.head.appendChild(s);
}

// KaTeX 的字体是打进页面的（data URI），第一次用时才载入：量之前等它（最多 1.5 秒，不让课卡住）
let fontsP = null, fontsOk = false;
function fontsReady() {
  if (fontsOk || typeof document === 'undefined' || !document.fonts?.load) { fontsOk = true; return Promise.resolve(); }
  fontsP ||= Promise.race([
    Promise.all(['1em KaTeX_Main', 'italic 1em KaTeX_Math', '1em KaTeX_Size1', '1em KaTeX_Size2', '1em KaTeX_AMS'].map((f) => document.fonts.load(f).catch(() => null))),
    new Promise((r) => setTimeout(r, 1500)),
  ]).then(() => { fontsOk = true; });
  return fontsP;
}

// 一行公式的节点（舞台的装饰：每一行一个）
function lineNode(stage, o, l) {
  let fresh = false;
  const n = stage.decor(o.id, `line:${l.id}`, () => {
    fresh = true;
    const n = el('div', 'tx-line', stage.layer);
    try { n.innerHTML = texHtml(l.src); } catch (e) { n.textContent = l.src; n.classList.add('is-bad'); }
    return n;
  });
  return { n, fresh };
}

// 字真正画在哪（不算 KaTeX 留的空白和撑高度的支架）：字、分数线、根号
function inkRect(node) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (r) => { if (!r || (!r.width && !r.height)) return; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); };
  const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  while (walk.nextNode()) {
    const t = walk.currentNode;
    if (!t.textContent.trim()) continue;
    range.selectNodeContents(t);
    for (const r of range.getClientRects()) add(r);
  }
  node.querySelectorAll('svg, .frac-line, .overline-line, .underline-line, .hline, .rule').forEach((e) => add(e.getBoundingClientRect()));
  if (x0 === Infinity) add(node.getBoundingClientRect());
  return x0 === Infinity ? null : { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
}

// 量一行：多宽多高、对齐点（& 或第一个等号）在哪、每一项在哪（都是这一行自己的坐标，不受镜头缩放影响）
function measure(n) {
  const r = n.getBoundingClientRect();
  const k = r.width / Math.max(1, n.offsetWidth) || 1;
  const loc = (q) => ({ x: (q.left - r.left) / k, y: (q.top - r.top) / k, w: q.width / k, h: q.height / k });
  const anchor = n.querySelector('[data-anchor]') || [...n.querySelectorAll('.mrel')].find((m) => !m.closest('.mfrac, .msupsub, .sqrt, .mtable, .mord .mord'));
  const terms = {};
  n.querySelectorAll('[data-term]').forEach((t) => { const q = inkRect(t); if (q) terms[t.dataset.term] = loc(q); });
  return { w: n.offsetWidth, h: n.offsetHeight, eq: anchor ? loc(anchor.getBoundingClientRect()).x : null, terms };
}

// 几行摆在哪：有等号（或 &）的按它对齐（对齐的位置定下来就不动，已经写好的不挪）；都没有就各自居中。写回 o.geo
function relayout(stage, o, ctx, { animate = true } = {}) {
  const rows = o.lines.map((l) => ({ l, n: stage.decor(o.id, `line:${l.id}`) })).filter((r) => r.n);
  if (!rows.length) return null;
  const ms = rows.map((r) => measure(r.n));
  const gap = Math.round(TEX_FONT * 0.32);
  const ax = (m) => m.eq ?? m.w + gap;
  const first = ms[0];
  const cur = o.lines[o.lines.length - 1];
  // 只有一行、换成了新的一行：两行都有等号就让等号不动（移项时看得出谁过了等号），不然重新居中
  if (o.anchor == null || (o.lines.length === 1 && o.anchorLine !== cur.id && !(o.anchorEq && first.eq != null))) {
    o.anchor = Math.round(o.origin.cx - first.w / 2 + ax(first));
    o.anchorEq = first.eq != null;
  }
  o.anchorLine = cur.id;
  const hasEq = ms.some((m) => m.eq != null);
  let y = o.origin.y;
  const geo = { rev: o.rev, lines: [] };
  rows.forEach(({ l, n }, i) => {
    const m = ms[i];
    const x = Math.round(hasEq ? o.anchor - ax(m) : o.origin.cx - m.w / 2);
    const g = { x, y: Math.round(y) };
    if (!n.__g || stage.instant || !animate) n.style.transform = tr(g.x, g.y);
    else if (Math.abs(n.__g.x - g.x) > 0.5 || Math.abs(n.__g.y - g.y) > 0.5) ctx?.jobs.push(stage.tween(n, [{ transform: tr(n.__g.x, n.__g.y) }, { transform: tr(g.x, g.y) }], { duration: moveDuration(Math.abs(n.__g.x - g.x) + Math.abs(n.__g.y - g.y)), easing: EASE.move }));
    n.__g = g;
    const terms = {};
    for (const [k, t] of Object.entries(m.terms)) terms[k] = { x: Math.round((g.x + t.x) * 10) / 10, y: Math.round((g.y + t.y) * 10) / 10, w: Math.round(t.w * 10) / 10, h: Math.round(t.h * 10) / 10 };
    geo.lines.push({ id: l.id, x: g.x, y: g.y, w: m.w, h: m.h, eq: m.eq, terms });
    y += m.h + LINE_GAP;
  });
  o.geo = geo;
  return geo;
}

// 项的那一块（透明的部件节点）摆到量好的地方；染色、灰掉、挖空照到 KaTeX 里那一项的字上
function placeParts(stage, o, ctx) {
  const cur = stage.decor(o.id, `line:${o.lines[o.lines.length - 1].id}`);
  const g = o.geo?.lines.find((l) => l.id === o.lines[o.lines.length - 1].id);
  for (const t of o.terms) {
    const n = stage.nodeOf(t);
    const b = g?.terms[t.key];
    if (!n || !b) continue;
    const box = { x: b.x - PAD, y: b.y - PAD, w: b.w + 2 * PAD, h: b.h + 2 * PAD };
    const from = n.__box;
    n.style.width = `${box.w}px`;
    n.style.height = `${box.h}px`;
    n.__box = box;
    const visible = t.glow || t.covered || n.classList.contains('is-zsrc');
    if (from && visible && !stage.instant && (Math.abs(from.x - box.x) > 0.5 || Math.abs(from.y - box.y) > 0.5)) ctx?.jobs.push(stage.tween(n, [{ transform: tr(from.x, from.y) }, { transform: tr(box.x, box.y) }], { duration: 480, easing: EASE.move }));
    else n.style.transform = tr(box.x, box.y);
    const glyph = termIn(cur, t.key);
    if (glyph) {
      paint(glyph, t.paint);
      glyph.classList.toggle('is-dim', !!t.dim);
      glyph.classList.toggle('is-lift', !!t.lift);
      glyph.classList.toggle('is-covered', !!t.covered);
    }
  }
}

// 一项的字单独拿出来（飞过去的那一份、放大的那一份）：套上 KaTeX 的外壳，字号和式子一样
function cloneTerm(stage, glyph, size = TEX_FONT) {
  const w = el('div', 'tx-fly', stage.layer);
  w.style.fontSize = `${size}px`;
  const k = el('span', 'katex', w), h = el('span', 'katex-html', k), b = el('span', 'base', h);
  const c = glyph.cloneNode(true);
  c.classList.remove('is-covered', 'is-hidden');
  b.appendChild(c);
  // 字在这一份里的哪儿（摆的时候让字对准要去的框）
  w.style.transform = 'translate(0px, 0px)';
  const r = w.getBoundingClientRect(), q = inkRect(c) || r;
  const kk = r.width / Math.max(1, w.offsetWidth) || 1;
  w.__ink = { x: (q.left - r.left) / kk, y: (q.top - r.top) / kk, w: q.width / kk, h: q.height / kk };
  return w;
}
// 让这一份的字落在世界坐标的框 B 里（按高缩放）
const fit = (fly, B, size = 1) => { const i = fly.__ink; const s = (B.h / Math.max(1, i.h)) * size; return { x: B.x - i.x * s, y: B.y - i.y * s, s }; };

function placeExtras(stage, o, ctx, live) {
  const g = o.geo?.lines.find((l) => l.id === o.lines[o.lines.length - 1].id);
  if (!g) return;
  // 划掉：一道斜线从左下到右上
  for (const t of o.terms) {
    if (!t.struck || !g.terms[t.key]) continue;
    const b = g.terms[t.key];
    const key = `strike:${t.key}`;
    live.add(key);
    const len = Math.hypot(b.w + 8, b.h), ang = -Math.atan2(b.h, b.w + 8) * 180 / Math.PI;
    let fresh = false;
    const n = stage.decor(o.id, key, () => { fresh = true; return el('div', 'tx-strike', stage.layer); });
    n.style.width = `${len}px`;
    n.style.transform = `translate(${b.x - 4}px, ${b.y + b.h}px) rotate(${ang}deg)`;
    if (fresh && !stage.instant && ctx.entering !== o.id) ctx.jobs.push(stage.tween(n, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 340, easing: EASE.out }).then(() => { n.style.clipPath = ''; }));
  }
  // 放大：那一项的字单独一份，放大写在式子下面
  const z = zoomBox(o, o.geo);
  if (z) {
    const key = `zoom:${o.zoom}`;
    live.add(key);
    const src = termIn(stage.decor(o.id, `line:${o.lines[o.lines.length - 1].id}`), o.zoom);
    let fresh = false;
    const n = stage.decor(o.id, key, () => { fresh = true; const f = cloneTerm(stage, src); f.classList.add('tx-zoom'); return f; });
    const end = fit(n, z);
    const t = g.terms[o.zoom];
    if (fresh && !stage.instant && t) {
      const start = fit(n, t);
      ctx.jobs.push(stage.tween(n, [{ transform: tr(start.x, start.y, start.s), opacity: 0.4 }, { transform: tr(end.x, end.y, end.s), opacity: 1 }], { duration: 620, easing: EASE.spring }));
    } else n.style.transform = tr(end.x, end.y, end.s);
    n.__end = end;
  }
  for (const t of o.terms) stage.nodeOf(t)?.classList.toggle('is-zsrc', o.zoom === t.key);
}

export const texView = {
  sync(stage, o, ctx) {
    ensureCss();
    const cur = o.lines[o.lines.length - 1];
    const live = new Set();
    for (const l of o.lines) {
      live.add(`line:${l.id}`);
      const { n, fresh } = lineNode(stage, o, l);
      if (fresh) {
        if (ctx.entering === o.id) n.style.opacity = '0';
        else if (!stage.instant) { n.style.opacity = '0'; ctx.jobs.push(stage.tween(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 120 })); }
      }
      n.classList.toggle('is-old', l !== cur);
    }
    // 项的那一块：现在这一行的每一项一块（换了行，舞台把旧的收掉）
    for (const t of o.terms) {
      const n = stage.partNode(t, () => { const n = el('div', 'tx-hit', stage.layer); el('span', 'tx-q', n).textContent = '?'; return n; });
      stage.flagPart(n, t, ctx);
    }
    // 量和摆：KaTeX 的字体到了才量得准
    const go = () => {
      relayout(stage, o, ctx);
      placeParts(stage, o, ctx);
      placeExtras(stage, o, ctx, live);
      stage.dropDecor(o.id, (k) => !live.has(k) && !k.startsWith('keep:'));
    };
    // 重放（刷新以后）时字体可能还没到：先不量（位置按估的），重放完那一次正常的 sync 等字体到了再量
    if (fontsOk) go();
    else if (stage.instant) { fontsReady(); stage.dropDecor(o.id, (k) => k.startsWith('line:') && !live.has(k)); }
    else ctx.jobs.push(fontsReady().then(go));
    return [];
  },

  // 出场：一行字从左往右写出来
  async enter(stage, o) {
    const rows = o.lines.map((l) => stage.decor(o.id, `line:${l.id}`)).filter(Boolean);
    await Promise.all(rows.map((n, i) => stage.tween(n, [{ opacity: 1, clipPath: 'inset(-20% 100% -20% 0)' }, { opacity: 1, clipPath: 'inset(-20% 0% -20% 0)' }], { duration: 640, delay: i * 120, easing: EASE.out }).then(() => { n.style.clipPath = ''; n.style.opacity = ''; })));
  },

  choreo: {
    retex(stage, c, fx, pre) { return morph(stage, fx); },
    next(stage, c, fx, pre) { return morph(stage, fx); },
    // 收回放大：那一份缩回到那一项上，淡掉
    async unmagnify(stage, c, fx) {
      const o = stage.scene.objects.get(fx.id);
      const m = stage.decors.get(o.id);
      const key = fx.term && `zoom:${fx.term}`;
      const n = key && m?.get(key);
      const t = o.geo?.lines.at(-1)?.terms[fx.term];
      if (!n || !t || stage.instant) return;
      m.delete(key);
      const s0 = n.__end, s1 = fit(n, t);
      await stage.tween(n, [{ transform: tr(s0.x, s0.y, s0.s), opacity: 1 }, { transform: tr(s1.x, s1.y, s1.s), opacity: 0 }], { duration: 420, easing: EASE.in });
      n.remove();
    },
    // 闪一下：项本身没有外框，闪的是它后面那一块淡光
    async pulse(stage, c, fx) {
      await Promise.all(fx.parts.map((x, i) => {
        const n = stage.nodeOf(x);
        if (!n) return null;
        if (!n.classList.contains('tx-hit')) return stage.pulse(x, stagger(i, { step: 60 }));
        n.classList.remove('is-flash');
        void n.offsetWidth;
        n.classList.add('is-flash');
        return stage.wait(700).then(() => n.classList.remove('is-flash'));
      }));
    },
  },

  css: `
/* 式子（types/tex.view.js）：KaTeX 写的一行一行；有名字的项后面有一块透明的「项」（点亮、挖空、点它都在这块上） */
.tx-line { position: absolute; left: 0; top: 0; z-index: 1; white-space: nowrap; font-size: ${TEX_FONT}px; line-height: 1.2; color: var(--st-ink); transition: opacity .45s; will-change: transform; pointer-events: none; }
.tx-line .katex { font-size: 1.21em; }
.tx-line.is-old { opacity: .4; }
.tx-line.is-bad { color: var(--st-red); font: 16px/1.4 ui-monospace, monospace; }
.tx-line [data-term] { transition: color .35s, opacity .35s, top .3s; }
.tx-line [data-term][data-paint] { color: var(--c); }
.tx-line [data-term].is-dim { opacity: .28; }
.tx-line [data-term].is-lift { position: relative; top: -.14em; }
.tx-line [data-term].is-covered, .tx-line [data-term].is-hidden { visibility: hidden; }
.tx-fly { position: absolute; left: 0; top: 0; z-index: 4; white-space: nowrap; line-height: 1.2; color: var(--st-ink); transform-origin: 0 0; pointer-events: none; }
.tx-fly .katex { font-size: 1.21em; }
.tx-fly [data-term][data-paint] { color: var(--c); }
.tx-zoom { z-index: 2; }
.tx-hit { position: absolute; left: 0; top: 0; z-index: 0; box-sizing: border-box; border-radius: 9px; pointer-events: none; transition: background-color .3s, box-shadow .3s; }
.tx-q { display: none; }
.tx-hit.is-glow { background: color-mix(in srgb, var(--st-gold) 20%, transparent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--st-gold) 70%, transparent); }
.tx-hit.is-zsrc { box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--st-brand) 45%, transparent); }
.tx-hit.is-covered { z-index: 2; background: color-mix(in srgb, var(--st-brand) 12%, var(--st-card)); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--st-brand) 34%, transparent); }
.tx-hit.is-covered .tx-q { display: grid; place-items: center; position: absolute; inset: 0; color: color-mix(in srgb, var(--st-brand) 62%, transparent); font: 600 22px/1 var(--sans, sans-serif); }
.tx-hit.is-tap { z-index: 3; pointer-events: auto; cursor: pointer; touch-action: none; }
.tx-hit.is-tap::before { content: ""; position: absolute; inset: min(0px, calc((100% - 44px) / 2)); }
.tx-hit.is-tap::after { content: ""; position: absolute; inset: -5px; border-radius: 13px; border: 2px solid var(--st-brand); opacity: 0; animation: tx-breathe 1.8s ease-in-out infinite; pointer-events: none; }
.tx-hit.is-press { background: color-mix(in srgb, var(--st-brand) 14%, transparent); }
.tx-hit.is-flash { animation: tx-flash .7s ease-out; }
@keyframes tx-breathe { 0%, 100% { opacity: 0; } 50% { opacity: .55; } }
@keyframes tx-flash { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--st-gold) 70%, transparent); background: color-mix(in srgb, var(--st-gold) 26%, transparent); } 100% { box-shadow: 0 0 0 14px transparent; background: transparent; } }
@media (prefers-reduced-motion: reduce) { .tx-hit.is-tap::after { animation: none; opacity: .5; } }
/* 划掉：一道斜线 */
.tx-strike { position: absolute; left: 0; top: 0; z-index: 2; height: 3px; margin-top: -1.5px; border-radius: 2px; background: var(--st-red); transform-origin: 0 50%; pointer-events: none; }
`,
};

// —— 变形：同名的项从旧的位置飞到新的位置（retex 是旧的一行换成新的，next 是旧的一行留着、新的一行写在下面）——
async function morph(stage, fx) {
  if (stage.instant) return; // 重放：直接到最后的样子（sync 画）
  ensureCss();
  await fontsReady();
  const o = stage.scene.objects.get(fx.id);
  const oldN = stage.decor(o.id, `line:${fx.fromLine}`);
  const newL = o.lines.find((l) => l.id === fx.toLine);
  if (!oldN || !newL) return;
  // 旧的一行里每一项现在在哪（世界坐标）
  const og = oldN.__g || { x: 0, y: 0 };
  const om = measure(oldN);
  const oldBox = (name) => { const t = om.terms[name]; return t && { x: og.x + t.x, y: og.y + t.y, w: t.w, h: t.h }; };
  // 新的一行：先画好藏着，量出位置（retex 时旧的一行不算进排版，原地不动等着淡掉）
  if (fx.mode === 'retex') { const m = stage.decors.get(o.id); m.delete(`line:${fx.fromLine}`); m.set(`keep:${fx.fromLine}`, oldN); }
  // 写满了：最上面那一行先淡掉，别的往上挪
  if (fx.dropped != null) { const m = stage.decors.get(o.id); const d = m?.get(`line:${fx.dropped}`); if (d) { m.delete(`line:${fx.dropped}`); stage.tween(d, [{ opacity: 0.4 }, { opacity: 0 }], { duration: 260 }).then(() => d.remove()); } }
  const { n: newN } = lineNode(stage, o, newL);
  newN.style.opacity = '0';
  const jobs = [];
  relayout(stage, o, { jobs });
  const ng = o.geo.lines.find((l) => l.id === newL.id);
  stage.keepInView(); // 新的一行可能在镜头外：镜头一边挪，项一边飞
  // 飞的那几份
  const flights = [];
  fx.pairs.forEach(([to, from], i) => {
    const A = oldBox(from), B = ng.terms[to];
    const src = termIn(oldN, from), dst = termIn(newN, to);
    if (!A || !B || !src || !dst) return;
    dst.classList.add('is-hidden');
    if (fx.mode === 'retex') src.classList.add('is-hidden');
    const t = o.terms.find((x) => x.key === to);
    const one = (glyph, fadeIn, fadeOut) => {
      const f = cloneTerm(stage, glyph);
      paint(f.querySelector('[data-term]'), t?.paint);
      const p0 = fit(f, A), p1 = fit(f, B);
      const pts = arcPoints({ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }, { dir: B.x >= A.x ? -1 : 1, lift: 0.18, min: 6, max: 56 });
      const frames = pts.map((q) => ({ transform: tr(q.x, q.y, p0.s + (p1.s - p0.s) * q.t), opacity: fadeIn ? Math.min(1, q.t * 2) : fadeOut ? Math.max(0, 1 - q.t * 2) : 1, offset: q.t }));
      f.style.transform = frames[0].transform;
      return stage.tween(f, frames, { duration: moveDuration(Math.abs(A.x - B.x) + Math.abs(A.y - B.y)) + 260, delay: stagger(i, { step: 55, max: 360 }), easing: EASE.move }).then(() => f.remove());
    };
    // 字一样就飞一份；不一样（a 从 x 变成了 2x）就新旧两份交叉淡过去
    if (src.innerHTML === dst.innerHTML) flights.push(one(src));
    else flights.push(one(src, false, true), one(dst, true, false));
  });
  // 没名字的、新冒出来的：旧的一行淡掉（next 时变淡留着），新的一行淡进来
  const old = fx.mode === 'retex' ? stage.tween(oldN, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: EASE.in }) : null;
  if (fx.mode === 'next') oldN.classList.add('is-old');
  const fresh = stage.tween(newN, [{ opacity: 0, transform: tr(ng.x, ng.y + 8) }, { opacity: 1, transform: tr(ng.x, ng.y) }], { duration: 420, delay: 240, easing: EASE.out });
  await Promise.all([...flights, old, fresh, ...jobs]);
  newN.querySelectorAll('.is-hidden').forEach((n) => n.classList.remove('is-hidden'));
  if (fx.mode === 'retex') { stage.decors.get(o.id)?.delete(`keep:${fx.fromLine}`); oldN.remove(); }
}
