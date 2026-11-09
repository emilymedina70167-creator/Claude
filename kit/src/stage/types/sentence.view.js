// 一句英文的画法（types/sentence.js 的画面那一半）：词、标点、括号和括号下的字、词上的小标签、斜线、折起来的小方块、箭头；
// 折起来、展开、挪词、改写几个专门的动作；学生按住一个词拖到别处。
// 位置全由 sentence.js 的 layout 算（这里只照着画、照着动），所以画面和给老师看的现状、贴字让开的地方一定对得上
import { EASE, moveDuration, stagger, arcPoints } from '../motion.js';
import { layout, setMeasure, FONTS, WORD_H, shownPunct } from './sentence.js';
import { openParts, atLeast, screenOf } from '../gesturedom.js';

const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; };
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs((a.w ?? 0) - (b.w ?? 0)) < 0.5 && Math.abs((a.h ?? 0) - (b.h ?? 0)) < 0.5;
const ordered = (o) => [...o.words].sort((a, b) => a.slot - b.slot);
const paint = (n, c) => { if (c) n.dataset.paint = c; else delete n.dataset.paint; };

// 字多宽：和画出来的同一种字体量（canvas），排版就和画面一样宽。页面上第一次画句子时换上，之后不再换
let measuring = false;
function ensureMeasure(stage) {
  if (measuring) return;
  measuring = true;
  const fam = getComputedStyle(stage.root).fontFamily || 'sans-serif';
  const cv = document.createElement('canvas').getContext('2d');
  if (!cv) return;
  const cache = new Map();
  setMeasure((text, kind) => {
    const k = `${kind}|${text}`;
    let w = cache.get(k);
    if (w == null) {
      const f = FONTS[kind] || FONTS.word;
      cv.font = `${f.weight} ${f.size}px ${fam}`;
      w = cv.measureText(text).width;
      cache.set(k, w);
    }
    return w;
  });
}
// 自己的样式只放一次（舞台的 stage.css 之外的）
function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('st-css-sentence')) return;
  const s = document.createElement('style');
  s.id = 'st-css-sentence';
  s.textContent = sentenceView.css;
  document.head.appendChild(s);
}

// 一样画在词旁边的东西（括号、字、标签、斜线、小方块）：新的出场，挪了的跟着滑过去，没了的舞台收掉
function placeDecor(stage, o, ctx, live, key, g, create, appear) {
  live.add(key);
  let fresh = false;
  const n = stage.decor(o.id, key, () => { fresh = true; return create(); });
  const set = () => { n.style.transform = tr(g.x, g.y); if (g.w != null) n.style.width = `${g.w}px`; if (g.h != null) n.style.height = `${g.h}px`; };
  if (fresh) {
    set();
    n.__g = g;
    if (ctx.entering === o.id) n.style.opacity = '0';
    else if (!stage.instant && appear) ctx.jobs.push(appear(n));
    return n;
  }
  if (!same(n.__g, g)) {
    const from = n.__g;
    n.__g = g;
    if (stage.instant || !from) set();
    else {
      const f0 = { transform: tr(from.x, from.y) }, f1 = { transform: tr(g.x, g.y) };
      if (g.w != null) { f0.width = `${from.w}px`; f1.width = `${g.w}px`; }
      if (g.h != null) { f0.height = `${from.h}px`; f1.height = `${g.h}px`; }
      ctx.jobs.push(stage.tween(n, [f0, f1], { duration: moveDuration(Math.abs(from.x - g.x) + Math.abs(from.y - g.y)), easing: EASE.move }));
    }
  }
  return n;
}

// 拉一段（open s mark）时跟着手的临时括号：拉过的词淡淡上一层底，词下面一道主色的线（跨行的一行一段）；不带 data-obj，排版不算它
function spanPreview(stage, o0) {
  const id = o0.id;
  const segs = [];
  let lit = [];
  const clear = () => { segs.splice(0).forEach((n) => n.remove()); lit.forEach((n) => n.classList.remove('is-span')); lit = []; };
  return {
    set(a, b) {
      clear();
      const o = stage.scene.objects.get(id);
      if (!o || a?.slot == null || b?.slot == null) return;
      const lo = Math.min(a.slot, b.slot), hi = Math.max(a.slot, b.slot);
      const rows = new Map();
      for (const w of ordered(o)) {
        if (w.slot < lo || w.slot > hi) continue;
        const n = stage.nodeOf(w);
        if (n) { n.classList.add('is-span'); lit.push(n); }
        const bx = stage.scene.partBox(w);
        const k = Math.round(bx.y);
        if (!rows.has(k)) rows.set(k, []);
        rows.get(k).push(bx);
      }
      for (const bs of rows.values()) {
        const x = Math.min(...bs.map((q) => q.x)), r = Math.max(...bs.map((q) => q.x + q.w)), y = Math.max(...bs.map((q) => q.y + q.h));
        const n = el('div', 'sn-span', stage.layer);
        n.style.transform = tr(x - 2, y + 3);
        n.style.width = `${r - x + 4}px`;
        segs.push(n);
      }
    },
    // 拉好的那一段在屏幕上的框（成分标签那一排贴着它）
    rect() {
      const rs = [...lit, ...segs].map((n) => stage.screenRect(n)).filter(Boolean);
      if (!rs.length) return null;
      const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
      return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
    },
    remove: clear,
  };
}

// —— 学生手上的把手（第二轮 Task 11）：钩、✕、空隙、小方块、外框；位置都照 layout 算 ——

// open s refer 的钩挂在哪几个词上：open 写了部件就那几个；没写看 links= 的起头（对的、列的错连都算）；再没有就每个词。折起来的词不挂
function hookKeys(stage, o) {
  const e = stage.scene.opens.get(`${o.id}:refer`);
  if (!e) return [];
  let keys;
  if (e.refs?.length) keys = openParts(stage, e, []).filter((p) => p.obj === o.id && p.key != null).map((p) => p.key);
  else {
    const from = new Set([...(o.links?.pairs || []), ...(o.links?.wrongs || [])].map((p) => String(p.from)));
    keys = from.size ? o.words.filter((w) => from.has(String(w.key))).map((w) => w.key) : ordered(o).map((w) => w.key);
  }
  const folded = new Set((o.folds || []).flatMap((f) => f.keys));
  return [...new Set(keys)].filter((k) => !folded.has(k));
}
// 词的右上角：钩的那一小圈（世界坐标，18 见方）。在词框上沿外面一点：不压词，也不压词上面一排的小标签的字（标签在词正中上方）
const HOOK = 18, X_SIZE = 20;
const hookBox = (b) => ({ x: b.x + b.w - HOOK + 7, y: b.y - HOOK + 5, w: HOOK, h: HOOK });
// 学生拉的括号的 ✕：最后一截括号右下角那一道竖线的外边，在词的下沿和括号下的字中间（不压词、不压字、不压句尾的「括号外 N」）
function markX(L, m) {
  const seg = L.brackets.filter((b) => b.mark === m.id).at(-1);
  if (!seg) return null;
  return { x: seg.x + seg.w + 3 - X_SIZE / 2, y: seg.y + seg.h - 5 - X_SIZE / 2, w: X_SIZE, h: X_SIZE };
}
// 学生连的线的 ✕：拱起来的那道弧的最高处；画成「→ 整句」那种小标签的，贴在标签右边
function referX(L, r) {
  const a = L.refers.find((x) => x.from === r.from);
  if (a) {
    const n = (a.d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number); // M px py C px top qx top qx qy
    if (n.length >= 8) { const [px, py, , top, , , qx, qy] = n; return { x: (px + qx) / 2 - X_SIZE / 2, y: 0.75 * top + 0.125 * (py + qy) - X_SIZE / 2, w: X_SIZE, h: X_SIZE }; }
  }
  const t = L.tags.find((x) => x.id === `ref:${r.from}`);
  return t ? { x: t.x + t.w + 3, y: t.y + t.h / 2 - X_SIZE / 2, w: X_SIZE, h: X_SIZE } : null;
}
// 只在拖的时候画出来的东西（两个词之间的空隙、句子外框）：不带 data-obj，排版不算它
function dragMark(stage, cls, b) {
  const n = el('div', cls, stage.layer);
  n.style.transform = tr(b.x, b.y);
  n.style.width = `${b.w}px`;
  n.style.height = `${b.h}px`;
  return n;
}
// 两个词之间的一个空隙（open s move 的落点）：after 是前面有几个词（挪之前的次序），0 是第一个词前面
function gapGrip(stage, key, after, x, y) {
  let n = null;
  const box = { x: x - 16, y, w: 32, h: WORD_H };
  return {
    key, part: () => ({ gap: { after } }), node: () => n, box: () => box, area: () => screenOf(stage, box),
    show(on) { if (on && !n) n = dragMark(stage, 'sn-gap', { x: x - 1.5, y: y + 4, w: 3, h: WORD_H - 8 }); else if (!on && n) { n.remove(); n = null; } },
  };
}
// 按住一道括号拖（open s move）：这一段的词连着括号一起托起来跟着手，原来的淡下去
function spanLift(stage, id, markId) {
  const o = stage.scene.objects.get(id);
  const m = o?.marks?.find((x) => x.id === markId);
  if (!m) return null;
  const ns = ordered(o).filter((w) => m.keys.includes(w.key)).map((w) => stage.nodeOf(w)).filter((n) => n?.__box && !n.classList.contains('is-folded'));
  if (!ns.length) return null;
  const bs = ns.map((n) => n.__box);
  const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
  const box = { x: x0 - 6, y: y0 - 4, w: Math.max(...bs.map((b) => b.x + b.w)) - x0 + 12, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 + 8 };
  const g = el('div', 'st-g-ghost sn-liftghost', stage.layer);
  g.style.width = `${box.w}px`;
  g.style.height = `${box.h}px`;
  for (const n of ns) {
    const c = n.cloneNode(true);
    c.removeAttribute('data-obj');
    c.className = 'sn-word';
    if (n.dataset.paint) c.dataset.paint = n.dataset.paint;
    c.style.transform = tr(n.__box.x - box.x, n.__box.y - box.y);
    c.style.opacity = '';
    g.appendChild(c);
  }
  g.style.transform = tr(box.x, box.y);
  const own = [...(stage.decors.get(id) || [])].filter(([k]) => k.startsWith(`br:${m.id}:`) || k.startsWith(`mk:${m.id}:`) || k === `xm:${m.id}`).map(([, n]) => n);
  [...ns, ...own].forEach((n) => n.classList.add('is-lifted'));
  return { el: g, box, restore: () => [...ns, ...own].forEach((n) => n.classList.remove('is-lifted')) };
}
// 句子外框（线松在这儿 = 整句）：框画在句子外面一圈；落点是框外面的四条（不和词、括号抢：手指在句子里面时拿到的总是词或括号）
function frameGrips(stage, o) {
  const id = o.id;
  let n = null;
  const boxOf = () => { const s = stage.scene.objects.get(id); return s ? layout(s).box : null; };
  const show = (on) => {
    if (on && !n) { const b = boxOf(); if (b) n = dragMark(stage, 'sn-frame', { x: b.x - 14, y: b.y - 14, w: b.w + 28, h: b.h + 28 }); } else if (!on && n) { n.remove(); n = null; }
  };
  const OFF = 14, TH = 44;
  const band = (side) => () => {
    const b = screenOf(stage, boxOf());
    if (!b) return null;
    const X = b.x - OFF - TH, W = b.w + 2 * (OFF + TH);
    if (side === 't') return { x: X, y: b.y - OFF - TH, w: W, h: TH };
    if (side === 'b') return { x: X, y: b.y + b.h + OFF, w: W, h: TH };
    return { x: side === 'l' ? X : b.x + b.w + OFF, y: b.y - OFF, w: TH, h: b.h + 2 * OFF };
  };
  return ['t', 'b', 'l', 'r'].map((side) => ({ key: `frame:${side}`, part: () => ({ whole: true }), node: () => n, box: boxOf, rect: band(side), area: band(side), show, light: (cls, on) => n?.classList.toggle(cls, on) }));
}
// 括号能按的那一条：括号那道线上下、连着下面的成分字（只有几像素高的线手指按不准）；至少 44px
function bracketRect(stage, n) {
  const r = stage.screenRect(n);
  if (!r) return null;
  const s = stage.liveCam().s, line = r.y + r.h;
  return atLeast({ x: r.x, y: line - 12 * s, w: r.w, h: 32 * s });
}

export const sentenceView = {
  // 通用手势（gesturedom.js）抓哪儿：一个词（拉一段从它起、到它止；折起一段点它；按住挪它），一道括号（点它折起来；按住整段挪），
  // 钩（从它拉线）、两个词之间的空隙（挪到这里）、小方块（点它展开）、句子外框（线松在这儿是整句）、学生拉的括号和线上的 ✕
  grips: {
    word: (stage, o, e) => openParts(stage, e, ordered(o))
      .filter((w) => !stage.nodeOf(w)?.classList.contains('is-folded'))
      .map((w) => ({ key: `w:${w.key}`, part: () => stage.scene.partOf(o.id, w.key), node: () => stage.nodes.get(`${o.id}:${w.key}`) })),
    bracket: (stage, o) => layout(o).brackets.map((g) => ({
      key: `br:${g.id}`, part: () => ({ mark: g.mark }), node: () => stage.decor(o.id, `br:${g.id}`),
      rect: () => bracketRect(stage, stage.decor(o.id, `br:${g.id}`)),
      lift: () => spanLift(stage, o.id, g.mark),
    })),
    hook: (stage, o) => hookKeys(stage, o).map((k) => {
      const n = () => stage.decor(o.id, `hk:${k}`);
      return { key: `hk:${k}`, cls: '', part: () => stage.scene.partOf(o.id, k), node: n, box: () => n()?.__g || null, rect: () => atLeast(stage.screenRect(n())) };
    }).filter((g) => g.node()),
    gap: (stage, o) => {
      const L = layout(o), oy = o.origin?.y ?? 0;
      const out = [];
      let count = 0;
      L.items.forEach((it, i) => {
        const y = oy + L.lines[it.line].wordY;
        const prev = L.items[i - 1], left = it.box.x - it.leadW;
        out.push(gapGrip(stage, `gap:${i}`, count, prev && prev.line === it.line ? (prev.box.x + prev.box.w + prev.punctW + left) / 2 : left - 6, y));
        count += it.keys.length;
        if (!L.items[i + 1] || L.items[i + 1].line !== it.line) out.push(gapGrip(stage, `gap:${i}e`, count, it.box.x + it.box.w + it.punctW + 6, y));
      });
      return out;
    },
    pill: (stage, o) => [...layout(o).pills.keys()].map((id) => {
      const n = () => stage.decor(o.id, `fold:${id}`);
      return { key: `pill:${id}`, part: () => ({ pill: id }), node: n, rect: () => atLeast(stage.screenRect(n())) };
    }),
    sentence: (stage, o) => frameGrips(stage, o),
    xmark: (stage, o) => (o.marks || []).filter((m) => m.by === 'student').map((m) => {
      const n = () => stage.decor(o.id, `xm:${m.id}`);
      return { key: `xm:${m.id}`, cls: '', part: () => ({ mark: m.id }), node: n, rect: () => atLeast(stage.screenRect(n())) };
    }).filter((g) => g.node()),
    xrefer: (stage, o) => (o.refers || []).filter((r) => r.by === 'student').map((r) => {
      const n = () => stage.decor(o.id, `xr:${r.from}`);
      return { key: `xr:${r.from}`, cls: '', part: () => ({ refer: r.from }), node: n, rect: () => atLeast(stage.screenRect(n())) };
    }).filter((g) => g.node()),
  },
  spanPreview,
  sync(stage, o, ctx) {
    ensureCss();
    ensureMeasure(stage);
    const sc = stage.scene;
    const L = layout(o);
    const itemOf = new Map();
    for (const it of L.items) for (const k of it.keys) itemOf.set(k, it);
    const moves = [];
    let k = 0;
    // —— 词 ——
    for (const w of ordered(o)) {
      const it = itemOf.get(w.key);
      const folded = !!it.fold;
      const b = sc.partBox(w);
      let fresh = false;
      const n = stage.partNode(w, () => {
        fresh = true;
        const n = el('div', 'sn-word', stage.layer);
        el('span', 'sn-l', n);
        el('span', 'sn-t', n).textContent = w.value;
        el('span', 'sn-p', n);
        el('span', 'sn-q', n).textContent = '?';
        n.style.transform = tr(b.x, b.y);
        n.__box = b;
        if (ctx.entering === o.id) n.style.opacity = '0';
        else if (!stage.instant) {
          // 新冒出来的词（改写时）：等别的词让开了再淡进来
          n.style.opacity = '0';
          ctx.jobs.push(stage.tween(n, [{ opacity: 0, transform: tr(b.x, b.y + 12) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 420, delay: 300 + stagger(k++, { step: 40, max: 300 }), easing: EASE.out }));
        }
        return n;
      });
      if (ctx.entering === o.id && !fresh) n.style.opacity = '0';
      // 字变了（改写时 realize → realized）：淡出再淡进
      const t = n.querySelector('.sn-t');
      if (t.textContent !== w.value) {
        if (stage.instant || fresh || ctx.entering === o.id) t.textContent = w.value;
        else ctx.jobs.push((async () => { await stage.tween(t, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE.in }); t.textContent = w.value; await stage.tween(t, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: EASE.out }); })());
      }
      // 标点：前面的（开引号、开括号）和后面的（逗号、句末的点跟着排在最后的那个）
      const lead = folded ? '' : it.lead, punct = folded ? '' : shownPunct(it.punct);
      const l = n.querySelector('.sn-l'), p = n.querySelector('.sn-p');
      if (l.textContent !== lead) l.textContent = lead;
      if (p.textContent !== punct) p.textContent = punct;
      if (!folded) {
        n.style.width = `${it.boxW}px`;
        n.style.paddingLeft = `${it.padL}px`;
        n.style.paddingRight = `${it.padR}px`;
        n.style.justifyContent = it.punct ? 'flex-end' : it.lead ? 'flex-start' : 'center';
      }
      stage.flagPart(n, w, ctx);
      if (n.__busy) continue; // 专门的动作正在动它（折起来、展开）
      if (folded) {
        if (!n.classList.contains('is-folded')) { n.classList.add('is-folded'); n.__box = b; n.style.transform = tr(b.x, b.y); }
        continue;
      }
      if (n.classList.contains('is-folded')) { n.classList.remove('is-folded'); n.__box = b; n.style.transform = tr(b.x, b.y); continue; }
      if (!same(n.__box, b) && (!ctx.only || ctx.only.includes(w))) moves.push({ part: w, node: n, from: n.__box, to: b, order: 0 });
    }
    // 补位、让开的词一起动、一样快（一个一个错开出发时，往右让的前一个会追上后一个、叠在一起）
    if (moves.length > 1) {
      const d = moveDuration(Math.max(...moves.map((m) => Math.abs(m.from.x - m.to.x) + Math.abs(m.from.y - m.to.y))));
      for (const m of moves) m.duration = d;
    }
    // —— 词旁边的东西 ——
    const live = new Set();
    const pop = (delay) => (n) => stage.tween(n, [{ opacity: 0, transform: `${tr(n.__g.x, n.__g.y + 6)}` }, { opacity: 1, transform: tr(n.__g.x, n.__g.y) }], { duration: 320, delay, easing: EASE.out });
    L.brackets.forEach((g, i) => {
      const n = placeDecor(stage, o, ctx, live, `br:${g.id}`, g, () => el('div', 'sn-br', stage.layer),
        (n) => stage.tween(n, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 460, delay: stagger(i % 4, { step: 90 }), easing: EASE.out }).then(() => { n.style.clipPath = ''; }));
      paint(n, g.color);
      n.classList.toggle('is-openl', g.openL);
      n.classList.toggle('is-openr', g.openR);
      // 被挪开拆散了：断开的虚线（画面不说「这还是一段」）
      n.classList.toggle('is-broken', !!g.broken);
    });
    // 括号下的字（学生点的是中文就画中文，老师写什么画什么）；tally 开着时学生的括号后面带一个数
    for (const g of L.marks) {
      const n = placeDecor(stage, o, ctx, live, `mk:${g.id}`, g, () => { const n = el('div', 'sn-mk', stage.layer); el('span', 'sn-mk-t', n); return n; }, pop(240));
      const t = n.querySelector('.sn-mk-t') || el('span', 'sn-mk-t', n);
      if (t.textContent !== g.text) t.textContent = g.text;
      let b = n.querySelector('.sn-tally');
      if (g.tally != null) { if (!b) b = el('b', 'sn-tally', n); if (b.textContent !== String(g.tally)) b.textContent = String(g.tally); } else b?.remove();
      paint(n, g.color);
      n.classList.toggle('is-broken', !!g.broken);
    }
    // tally 剩下的那几个：句尾一个小牌子
    for (const g of L.tallies || []) {
      const n = placeDecor(stage, o, ctx, live, `tl:${g.id}`, g, () => el('div', 'sn-tally-rest', stage.layer), pop(260));
      if (n.textContent !== g.text) n.textContent = g.text;
    }
    for (const g of L.tags) {
      const n = placeDecor(stage, o, ctx, live, `tag:${g.id}`, g, () => { const n = el('div', 'sn-tag', stage.layer); n.textContent = g.text; return n; },
        (n) => stage.tween(n, [{ opacity: 0, transform: `${tr(n.__g.x, n.__g.y + 8)} scale(0.6)` }, { opacity: 1, transform: tr(n.__g.x, n.__g.y) }], { duration: 420, easing: EASE.spring }));
      if (n.textContent !== g.text) n.textContent = g.text;
      paint(n, g.color);
      n.classList.toggle('is-ref', !!g.refer);
    }
    for (const g of L.cuts) {
      placeDecor(stage, o, ctx, live, `cut:${g.key}`, g, () => { const n = el('div', 'sn-cut', stage.layer); el('i', '', n); return n; },
        (n) => stage.tween(n, [{ opacity: 0, clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, clipPath: 'inset(0 0 0% 0)' }], { duration: 300, delay: 260, easing: EASE.out }).then(() => { n.style.clipPath = ''; }));
    }
    for (const it of L.items) {
      if (!it.fold) continue;
      const n = placeDecor(stage, o, ctx, live, `fold:${it.fold.id}`, it.box, () => { const n = el('div', 'sn-fold', stage.layer); n.textContent = it.label; return n; },
        (n) => stage.tween(n, [{ opacity: 0, transform: `${tr(n.__g.x, n.__g.y)} scale(0.7)` }, { opacity: 1, transform: tr(n.__g.x, n.__g.y) }], { duration: 420, delay: 200, easing: EASE.spring }));
      if (n.textContent !== it.label) n.textContent = it.label;
      paint(n, it.fold.color);
      // 小方块的「句末标点」（折起来的是最后一段时）
      n.dataset.end = it.punct || '';
    }
    // 箭头（画在词下面那层 SVG）：位置变了就先淡掉，等词挪完再画上
    for (const r of L.refers) {
      const key = `ref:${r.from}`;
      live.add(key);
      let fresh = false;
      const g = stage.decor(o.id, key, () => {
        fresh = true;
        const g = svg('g', { class: 'sn-refs' }, stage.under);
        svg('path', { class: 'sn-ref', d: r.d }, g);
        svg('path', { class: 'sn-tip', d: tipPath(r.tip) }, g);
        svg('path', { class: 'sn-cap', d: r.cap || '' }, g); // 指到一段：那一段上面的小横线（指一个词时是空的）
        return g;
      });
      paint(g, r.color);
      const [line, tip, cap] = g.children;
      const sig = `${r.d}|${r.cap || ''}`;
      if (fresh) {
        g.__d = sig;
        if (ctx.entering === o.id) g.style.opacity = '0';
        else if (!stage.instant) {
          const len = line.getTotalLength?.() || 200;
          line.style.strokeDasharray = `${len}`;
          tip.style.opacity = '0';
          ctx.jobs.push(stage.tween(line, [{ strokeDashoffset: `${len}` }, { strokeDashoffset: '0' }], { duration: 560, delay: 120, easing: EASE.out }).then(() => { line.style.strokeDasharray = ''; line.style.strokeDashoffset = ''; return stage.tween(tip, [{ opacity: 0 }, { opacity: 1 }], { duration: 180 }); }));
        }
      } else if (g.__d !== sig) {
        g.__d = sig;
        if (stage.instant) { line.setAttribute('d', r.d); tip.setAttribute('d', tipPath(r.tip)); cap.setAttribute('d', r.cap || ''); }
        else ctx.jobs.push((async () => {
          await stage.tween(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
          line.setAttribute('d', r.d);
          tip.setAttribute('d', tipPath(r.tip));
          cap.setAttribute('d', r.cap || '');
          await stage.tween(g, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 380 });
        })());
      }
    }
    // 学生手上的把手（开着才画，只读的舞台、重放的老课没有）：open s refer 的钩；open s mark / refer 时学生自己拉的括号、连的线上的 ✕
    const opens = stage.withInput ? sc.opens : null;
    const ring = (n) => stage.tween(n, [{ opacity: 0, transform: `${tr(n.__g.x, n.__g.y)} scale(0.5)` }, { opacity: 1, transform: tr(n.__g.x, n.__g.y) }], { duration: 300, delay: 260, easing: EASE.spring });
    if (opens?.has(`${o.id}:refer`)) {
      for (const k of hookKeys(stage, o)) {
        const b = L.boxes.get(k);
        if (b) placeDecor(stage, o, ctx, live, `hk:${k}`, hookBox(b), () => { const n = el('div', 'sn-hook', stage.layer); n.setAttribute('aria-label', '从这里拉一条线'); return n; }, ring);
      }
      for (const r of o.refers || []) {
        const at = r.by === 'student' && referX(L, r);
        if (at) placeDecor(stage, o, ctx, live, `xr:${r.from}`, at, () => { const n = el('div', 'sn-x', stage.layer); n.setAttribute('aria-label', '收掉这条线'); return n; }, ring);
      }
    }
    if (opens?.has(`${o.id}:mark`)) {
      for (const m of o.marks || []) {
        const at = m.by === 'student' && markX(L, m);
        if (at) placeDecor(stage, o, ctx, live, `xm:${m.id}`, at, () => { const n = el('div', 'sn-x', stage.layer); n.setAttribute('aria-label', '收掉这道括号'); return n; }, ring);
      }
    }
    stage.dropDecor(o.id, (key) => !live.has(key));
    return moves;
  },

  // 一个词一个词写出来（从左往右、一行一行），括号这些跟着淡进来
  async enter(stage, o) {
    const ws = ordered(o).filter((w) => !stage.nodeOf(w)?.classList.contains('is-folded'));
    const decor = [...(stage.decors.get(o.id)?.values() || [])];
    await Promise.all([
      ...ws.map((w, i) => {
        const n = stage.nodeOf(w), b = n.__box;
        return stage.tween(n, [{ opacity: 0, transform: tr(b.x, b.y + 10) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 420, delay: stagger(i, { step: 32, max: 720 }), easing: EASE.out });
      }),
      ...decor.map((n) => stage.tween(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 300 })),
    ]);
  },

  choreo: {
    // 折起来：这一段的词缩进小方块里，后面的词滑过来补位
    async fold(stage, c, fx, pre) {
      const sc = stage.scene, o = sc.objects.get(fx.id);
      const pill = layout(o).pills.get(fx.fold);
      const words = fx.keys.map((k) => o.words.find((w) => w.key === k));
      const others = o.words.filter((w) => !fx.keys.includes(w.key));
      const jobs = words.map((w, i) => {
        const n = stage.nodeOf(w);
        if (!n) return null;
        const from = pre.boxes.get(stage.pid(w)) || n.__box;
        n.__busy = true;
        n.__box = { ...pill };
        const cx = pill.x + pill.w / 2 - from.w / 2, cy = pill.y + pill.h / 2 - from.h / 2;
        return stage.tween(n, [{ opacity: 1, transform: tr(from.x, from.y) }, { opacity: 0, transform: `${tr(cx, cy)} scale(0.35)` }], { duration: 420, delay: stagger(i, { step: 30, max: 240 }), easing: EASE.move }).then(() => {
          n.__busy = false;
          n.classList.add('is-folded');
          n.style.transform = tr(pill.x, pill.y);
          n.style.opacity = '';
        });
      });
      await Promise.all([...jobs, stage.wait(150).then(() => stage.sync({ pre, only: others }))]);
    },

    // 展开：后面的词先让开，这一段的词从小方块里一个个长出来
    async unfold(stage, c, fx, pre) {
      const sc = stage.scene, o = sc.objects.get(fx.id);
      const pills = fx.pills.map((id) => stage.decor(o.id, `fold:${id}`)?.__g).filter(Boolean);
      const words = fx.keys.map((k) => o.words.find((w) => w.key === k)).sort((a, b) => a.slot - b.slot);
      const others = o.words.filter((w) => !fx.keys.includes(w.key));
      const jobs = words.map((w, i) => {
        const n = stage.nodeOf(w);
        if (!n) return null;
        const b = sc.partBox(w);
        const from = pills.find((p) => n.__box && Math.abs(p.x - n.__box.x) < 1 && Math.abs(p.y - n.__box.y) < 1) || pills[0] || b;
        n.__busy = true;
        n.classList.remove('is-folded');
        n.__box = b;
        const px = from.x + from.w / 2 - b.w / 2, py = from.y + from.h / 2 - b.h / 2;
        return stage.tween(n, [{ opacity: 0, transform: `${tr(px, py)} scale(0.35)` }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 520, delay: 140 + stagger(i, { step: 40, max: 320 }), easing: EASE.out }).then(() => { n.__busy = false; });
      });
      await Promise.all([stage.sync({ pre, only: others }), ...jobs]);
    },

    // 挪词：要挪的那几个抬起来走一道弧落到新位置，别的词让开；学生拖过去的从手放开的地方直接落位
    async move(stage, c, fx, pre) {
      const sc = stage.scene, o = sc.objects.get(fx.id);
      const moved = fx.moved.map((k) => o.words.find((w) => w.key === k));
      const others = o.words.filter((w) => !fx.moved.includes(w.key));
      // 挪走的词头上的标签：先收起来，落地以后再在新位置出来（不然标签直着滑、词走弧线，半路两个交叉）
      const riders = o.tags.filter((t) => t.keys.some((k) => fx.moved.includes(k))).map((t) => stage.decor(o.id, `tag:${t.id}`)).filter(Boolean);
      await Promise.all(riders.map((n) => stage.tween(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 })));
      const slide = stage.sync({ pre, only: others });
      const fly = moved.map((w, i) => {
        const n = stage.nodeOf(w);
        if (!n) return null;
        const A = pre.boxes.get(stage.pid(w)) || n.__box, B = sc.partBox(w);
        if (c.dragged) return stage.moveNode(w, [{ transform: n.style.transform }, { transform: tr(B.x, B.y) }], B, { duration: 420, easing: EASE.spring });
        const pts = arcPoints(A, B, { dir: -1, lift: 0.3, min: 46, max: 120 });
        return stage.moveNode(w, pts.map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), B, { duration: moveDuration(Math.abs(A.x - B.x) + Math.abs(A.y - B.y)) + 220, delay: stagger(i, { step: 50 }) });
      });
      await Promise.all([slide, ...fly]);
      await Promise.all(riders.map((n) => stage.tween(n, [{ opacity: 0, transform: `${tr(n.__g.x, n.__g.y + 6)}` }, { opacity: 1, transform: tr(n.__g.x, n.__g.y) }], { duration: 260, easing: EASE.out })));
    },

    // 改写：去掉的词缩着淡掉；挪了位置的走弧线、别的滑过去；新的词等它们站好了淡进来（在 sync 里）
    async rewrite(stage, c, fx, pre) {
      const sc = stage.scene, o = sc.objects.get(fx.id);
      for (const k of fx.removed) {
        const pid = `${o.id}:${k}`;
        const n = stage.nodes.get(pid);
        if (!n) continue;
        stage.nodes.delete(pid); // 舞台不再管它：这里自己收
        const b = n.__box;
        stage.tween(n, [{ opacity: 1, transform: tr(b.x, b.y) }, { opacity: 0, transform: `${tr(b.x, b.y + 10)} scale(0.8)` }], { duration: 320, easing: EASE.in }).then(() => n.remove());
      }
      const moved = fx.moved.map((k) => o.words.find((w) => w.key === k));
      const stay = o.words.filter((w) => !fx.moved.includes(w.key));
      await stage.wait(120);
      const slide = stage.sync({ pre, only: stay });
      const fly = moved.map((w, i) => {
        const A = pre.boxes.get(stage.pid(w)), B = sc.partBox(w);
        if (!A) return null;
        const pts = arcPoints(A, B, { dir: -1, lift: 0.3, min: 46, max: 120 });
        return stage.moveNode(w, pts.map((q) => ({ transform: tr(q.x, q.y), offset: q.t })), B, { duration: moveDuration(Math.abs(A.x - B.x) + Math.abs(A.y - B.y)) + 220, delay: stagger(i, { step: 60 }) });
      });
      await Promise.all([slide, ...fly]);
    },
  },

  // 学生拖（手指的事在 pointer.js）：按住一个词拖到两个词中间（出一道竖线指着落在哪），放手就挪过去；离哪个空都远就滑回去
  dragSpec(stage, x0) {
    const id = x0.obj, key = x0.key;
    const sc = stage.scene;
    const node = () => stage.nodes.get(`${id}:${key}`);
    const part = () => sc.partOf(id, key);
    if (node()?.classList.contains('is-folded')) return null;
    let start = null, base = null, caret = null, g = null;
    const gaps = () => {
      const o = sc.objects.get(id);
      const L = layout(o);
      const out = [];
      const own = L.items.findIndex((it) => it.keys.includes(key));
      L.items.forEach((it, i) => {
        const line = L.lines[it.line];
        const y = (o.origin?.y ?? 0) + line.wordY + WORD_H / 2;
        const prev = L.items[i - 1];
        // 这一样前面的空（同一行的上一样和它之间；一行开头）
        const left = it.box.x - it.leadW;
        out.push({ at: i, x: prev && prev.line === it.line ? (prev.box.x + prev.box.w + prev.punctW + left) / 2 : left - 6, y });
        // 一行最后一样后面的空
        if (!L.items[i + 1] || L.items[i + 1].line !== it.line) out.push({ at: i + 1, x: it.box.x + it.box.w + it.punctW + 6, y });
      });
      return { out: out.filter((q) => q.at !== own && q.at !== own + 1), L };
    };
    const nearest = (p) => {
      const { out } = gaps();
      let best = null, bd = Infinity;
      for (const q of out) { const d = Math.hypot(q.x - p.x, (q.y - p.y) * 1.6); if (d < bd) { bd = d; best = q; } }
      return bd < 160 ? best : null;
    };
    const clear = () => { node()?.classList.remove('is-hold'); caret?.remove(); caret = null; };
    return {
      start(w) {
        const x = part(), n = node();
        if (!x || !n) throw new Error('这个词不在了');
        start = w;
        base = sc.partBox(x);
        n.getAnimations?.().forEach((a) => a.cancel());
        n.classList.add('is-hold');
        caret = el('div', 'sn-caret', stage.layer);
        caret.style.opacity = '0';
      },
      move(w) {
        const n = node();
        if (!start || !n) return;
        const dx = w.x - start.x, dy = w.y - start.y;
        n.style.transform = `${tr(base.x + dx, base.y + dy)} scale(1.06)`;
        g = nearest({ x: base.x + base.w / 2 + dx, y: base.y + base.h / 2 + dy });
        if (g) { caret.style.opacity = '1'; caret.style.transform = tr(g.x - 1.5, g.y - WORD_H / 2 + 4); } else caret.style.opacity = '0';
      },
      drop() {
        clear();
        const x = part();
        if (!g || !x) return null;
        const { L } = gaps();
        // 落在第 at 样前面：前面一共几个词（不算自己）→ 挪到第几个
        let count = 0;
        for (let i = 0; i < g.at; i++) count += L.items[i].keys.filter((k) => k !== key).length;
        const o = sc.objects.get(id);
        const ws = ordered(o).filter((w) => w.key !== key);
        const after = ws[count - 1];
        const where = after ? `「${after.value}」后面` : '句首';
        return { act: { type: 'drag', text: `学生把「${x.value}」拖到了${where}（舞台已经照做了）`, word: x.value, to: count + 1 }, src: `move ${id}#${key} -> ${id}.${count + 1}` };
      },
      cancel() {
        clear();
        const n = node();
        if (n && base) stage.tween(n, [{ transform: n.style.transform }, { transform: tr(base.x, base.y) }], { duration: 360, easing: EASE.spring });
      },
    };
  },

  css: `
/* 句子（types/sentence.view.js）：词是正文字体，染色、点亮是词后面一层淡底；括号、标签、斜线都用组色 */
.sn-word { position: absolute; left: 0; top: 0; height: ${WORD_H}px; display: flex; align-items: center; box-sizing: border-box; border-radius: 10px; white-space: nowrap;
  font: 500 ${FONTS.word.size}px/1 var(--sans, -apple-system, "PingFang SC", sans-serif); color: var(--st-ink); will-change: transform;
  transition: background-color .3s, box-shadow .3s, color .3s, opacity .3s, width .35s; }
.sn-word::before { content: ""; position: absolute; inset: -1px -8px; } /* 点的地方比字宽一点：a、I 也有 44px */
.sn-l, .sn-p { position: absolute; top: 0; height: 100%; display: flex; align-items: center; white-space: pre; color: var(--st-ink); }
.sn-l { right: 100%; } .sn-p { left: 100%; }
.sn-q { display: none; }
.sn-word[data-paint] { background: color-mix(in srgb, var(--c) 15%, transparent); color: color-mix(in srgb, var(--c) 78%, var(--st-ink)); }
.sn-word.is-glow { background: color-mix(in srgb, var(--st-gold) 15%, transparent); box-shadow: 0 0 0 2px var(--st-gold); }
.sn-word.is-glow[data-paint] { background: color-mix(in srgb, var(--c) 15%, transparent); box-shadow: 0 0 0 2px var(--c), 0 0 0 7px color-mix(in srgb, var(--st-gold) 24%, transparent); }
.sn-word.is-lift { background: var(--st-card); box-shadow: 0 0 0 1px var(--st-line), 0 12px 20px -12px rgb(var(--shade-rgb, 25 45 40) / 0.55); }
.sn-word.is-dim { opacity: .28; }
.sn-word.is-covered { background: color-mix(in srgb, var(--st-brand) 12%, var(--st-card)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--st-brand) 30%, transparent); }
.sn-word.is-covered .sn-t { visibility: hidden; }
.sn-word.is-covered .sn-q { display: grid; place-items: center; position: absolute; inset: 0; color: color-mix(in srgb, var(--st-brand) 60%, transparent); font-weight: 600; }
.sn-word.is-folded { opacity: 0; pointer-events: none; }
.sn-word.is-moving { z-index: 3; }
.sn-word.is-tap, .sn-word.is-drag { cursor: pointer; touch-action: none; }
.sn-word.is-tap::after, .sn-word.is-drag::after { content: ""; position: absolute; left: 7px; right: 7px; bottom: 5px; height: 2.5px; border-radius: 2px; background: var(--st-brand); opacity: 0; animation: sn-breathe 1.8s ease-in-out infinite; pointer-events: none; }
.sn-word.is-press { scale: .94; transition: scale .12s; }
.sn-word.is-hold { z-index: 5; cursor: grabbing; background: var(--st-card); box-shadow: 0 0 0 2px var(--st-brand), 0 16px 26px -14px rgb(var(--shade-rgb, 25 45 40) / 0.55); }
@keyframes sn-breathe { 0%, 100% { opacity: .12; } 50% { opacity: .6; } }
@media (prefers-reduced-motion: reduce) { .sn-word.is-tap::after, .sn-word.is-drag::after { animation: none; opacity: .45; } }
.sn-word.is-span { background: color-mix(in srgb, var(--st-brand) 11%, transparent); }
.sn-span { position: absolute; left: 0; top: 0; height: 9px; box-sizing: border-box; border: 2.5px solid var(--st-brand); border-top: 0; border-radius: 0 0 8px 8px; pointer-events: none; z-index: 4; }
.sn-br.is-tap, .sn-br.is-drag { opacity: 1; border-width: 2.5px; }
/* 拖着找落点（gesturedom.js）：线悬在词、括号上；挪一段时两个词之间的空隙；线松在外框上是整句 */
.sn-word.is-over { background: color-mix(in srgb, var(--st-brand) 11%, transparent); box-shadow: 0 0 0 2px var(--st-brand); }
.sn-br.is-over { opacity: 1; border-color: var(--st-brand); border-width: 3px; }
.sn-br.is-nodrop { border-color: color-mix(in srgb, var(--st-red) 60%, transparent); }
.sn-gap { position: absolute; left: 0; top: 0; border-radius: 2px; background: var(--st-brand); opacity: 0; pointer-events: none; transition: opacity .15s, scale .15s; }
.sn-gap.is-drop { opacity: .22; }
.sn-gap.is-over { opacity: 1; scale: 1.7 1; }
.sn-gap.is-nodrop { opacity: .45; background: var(--st-red); }
.sn-frame { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: 18px; border: 2px dashed color-mix(in srgb, var(--st-brand) 28%, transparent); pointer-events: none; transition: background-color .2s, border-color .2s; }
.sn-frame.is-over { border-color: var(--st-brand); background: color-mix(in srgb, var(--st-brand) 6%, transparent); }
.sn-liftghost { background: var(--st-card); border-radius: 12px; }
.sn-liftghost > .sn-word { position: absolute; }
/* 钩：词右上角一个小圈（从这里拉线），轻轻呼吸；拉着的时候放大一点 */
.sn-hook { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: 50%; border: 2px solid var(--st-brand); background: var(--st-card); pointer-events: none; z-index: 2; transition: scale .15s; }
.sn-hook::after { content: ""; position: absolute; inset: 3.5px; border-radius: 50%; background: var(--st-brand); animation: sn-hookbreathe 1.8s ease-in-out infinite; }
@keyframes sn-hookbreathe { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
@media (prefers-reduced-motion: reduce) { .sn-hook::after { animation: none; } }
.sn-hook.is-press, .sn-hook.is-hold { scale: 1.25; }
/* ✕：学生拉的括号、连的线上，点了收掉（点区 44px，画出来小一点不压字） */
.sn-x { position: absolute; left: 0; top: 0; box-sizing: border-box; border-radius: 50%; background: var(--st-card); pointer-events: none; z-index: 2;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--st-muted) 40%, transparent), 0 3px 8px -4px rgb(var(--shade-rgb, 25 45 40) / 0.45); transition: scale .12s; }
.sn-x::before, .sn-x::after { content: ""; position: absolute; left: 50%; top: 50%; width: 10px; height: 1.8px; margin: -0.9px 0 0 -5px; border-radius: 1px; background: var(--st-muted); rotate: 45deg; }
.sn-x::after { rotate: -45deg; }
.sn-x.is-press { scale: .86; }
.sn-x.is-lifted { opacity: 0; }
.sn-caret { position: absolute; left: 0; top: 0; width: 3px; height: ${WORD_H - 8}px; border-radius: 2px; background: var(--st-brand); transition: opacity .15s; pointer-events: none; }

/* 括号：词下面一道，两头翘上来贴着词；套在外面的那道竖线长一点，把里面的围住；跨到下一行的那头淡掉 */
.sn-br { position: absolute; left: 0; top: 0; box-sizing: border-box; border: 2px solid var(--c, var(--st-muted)); border-top: 0; border-radius: 0 0 8px 8px; pointer-events: none; opacity: .9; }
.sn-br.is-openl { border-left: 0; border-bottom-left-radius: 0; -webkit-mask-image: linear-gradient(90deg, transparent, #000 26px); mask-image: linear-gradient(90deg, transparent, #000 26px); }
.sn-br.is-openr { border-right: 0; border-bottom-right-radius: 0; -webkit-mask-image: linear-gradient(270deg, transparent, #000 26px); mask-image: linear-gradient(270deg, transparent, #000 26px); }
.sn-br.is-openl.is-openr { -webkit-mask-image: linear-gradient(90deg, transparent, #000 26px, #000 calc(100% - 26px), transparent); mask-image: linear-gradient(90deg, transparent, #000 26px, #000 calc(100% - 26px), transparent); }
.sn-mk { position: absolute; left: 0; top: 0; box-sizing: border-box; text-align: center; white-space: nowrap; pointer-events: none;
  font: 600 ${FONTS.mark.size}px/18px var(--sans, sans-serif); color: var(--c, var(--st-muted)); }
/* 被挪开拆散了的括号：断开的虚线，成分字变淡（字后面带「?」，layout 里加的） */
.sn-br.is-broken { border-style: dashed; opacity: .5; }
.sn-mk.is-broken { opacity: .5; }
/* tally s V：括号字后面的数（里面 key 的谓语几个）、句尾括号外剩下的几个 */
.sn-tally { display: inline-grid; place-items: center; min-width: 16px; height: 16px; margin-left: 4px; padding: 0 3px; box-sizing: border-box; border-radius: 8px; vertical-align: 1px;
  font: 700 11px/1 var(--sans, sans-serif); color: var(--st-card); background: var(--c, var(--st-muted)); }
.sn-tally-rest { position: absolute; left: 0; top: 0; box-sizing: border-box; display: grid; place-items: center; white-space: nowrap; pointer-events: none; border-radius: 11px;
  font: 700 ${FONTS.tag.size}px/1 var(--sans, sans-serif); color: var(--st-muted); background: color-mix(in srgb, var(--st-muted) 10%, var(--st-card)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--st-muted) 26%, transparent); }
.sn-tag { position: absolute; left: 0; top: 0; box-sizing: border-box; text-align: center; white-space: nowrap; pointer-events: none; border-radius: 6px;
  font: 700 ${FONTS.tag.size}px/20px var(--sans, sans-serif); letter-spacing: .02em; color: var(--c, var(--st-muted));
  background: color-mix(in srgb, var(--c, var(--st-muted)) 13%, var(--st-card)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--c, var(--st-muted)) 26%, transparent); }
.sn-tag.is-ref { font-weight: 600; color: var(--c, var(--st-brand)); background: transparent; box-shadow: none; }
/* 意群的斜线 */
.sn-cut { position: absolute; left: 0; top: 0; pointer-events: none; }
.sn-cut i { position: absolute; left: 50%; top: 3px; bottom: 3px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--st-brand); transform: rotate(17deg); }
/* 折起来的一段：一个淡底虚边的小方块 */
.sn-fold { position: absolute; left: 0; top: 0; box-sizing: border-box; display: grid; place-items: center; white-space: nowrap; border-radius: 11px; pointer-events: none;
  font: 500 ${FONTS.pill.size}px/1 var(--sans, sans-serif); color: var(--c, var(--st-muted));
  background: color-mix(in srgb, var(--c, var(--st-muted)) 9%, var(--st-card)); border: 1.5px dashed color-mix(in srgb, var(--c, var(--st-muted)) 55%, transparent); }
.sn-fold::after { content: attr(data-end); position: absolute; left: 100%; bottom: 4px; font: 500 ${FONTS.word.size}px/1 var(--sans, sans-serif); color: var(--st-ink); }
/* 指代的箭头 */
.sn-ref { fill: none; stroke: var(--c, var(--st-brand)); stroke-width: 2; stroke-linecap: round; opacity: .8; }
.sn-tip { fill: var(--c, var(--st-brand)); opacity: .9; }
.sn-cap { fill: none; stroke: var(--c, var(--st-brand)); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; opacity: .7; }
`,
};

// 箭头尖：朝下，落在词顶上
function tipPath({ x, y }) {
  const r = (v) => Math.round(v * 10) / 10;
  return `M${r(x)} ${r(y)} L${r(x - 5)} ${r(y - 8)} L${r(x + 5)} ${r(y - 8)} Z`;
}
