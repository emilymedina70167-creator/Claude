// 板书标注（DOM）：在宿主（课堂的一段、matrix 组件）上盖一层 SVG，按 spec（markspec.js）找到要标的地方，
// 画手绘风格的圈、框、下划线、涂色、划掉、箭头（markdraw.js），旁边写旁注。
// 宿主变大小、图重画、矩阵动起来时跟着重新摆；找不到要标的地方时返回中文原因（课堂报给 Claude，组件报成写法错误）。
import { mdToHtml } from './render.js';
import { compile, isVec } from './expr.js';
import { shapeFor, arrowPath, leaderPath, placeNote, union } from './markdraw.js';

const NS = 'http://www.w3.org/2000/svg';
// 颜色都从主题变量取（不同风格的黑板颜色不一样）
export const MARK_COLOR = { yellow: 'var(--yellow)', pink: 'var(--pink)', blue: 'var(--blue)', green: 'var(--green)', orange: 'var(--orange)', purple: 'var(--lav)', red: 'var(--coral)', white: 'var(--chalk)' };

const rect = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const shown = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

// 一个元素「有字的地方」：KaTeX 里撑高度的空 span（pstrut、strut）不算，免得框得比字大一圈
const SKIP = '.pstrut, .strut, .vlist-s, .katex-mathml, .mk-layer';
const INK = 'svg, img, canvas, .frac-line, .overline-line, .underline-line, .hline, .hdashline, .rule';
export function inkRect(el) {
  const rs = [];
  const push = (e) => { const r = e.getBoundingClientRect(); if (r.width > 0 || r.height > 0) rs.push(rect(r)); };
  let budget = 400;
  const walk = (n) => {
    for (const c of n.children) {
      if (--budget < 0) return;
      if (c.matches(SKIP)) continue;
      if (c.matches(INK) || !c.childElementCount) { if (c.matches(INK) || c.textContent.trim()) push(c); continue; }
      walk(c);
    }
  };
  walk(el);
  return union(rs) || rect(el.getBoundingClientRect());
}

// —— 矩阵的格子：matrix 组件的表格（td[data-i][data-j]），或者公式里 KaTeX 画的矩阵（.mtable）——
function findMatrix(root, of) {
  let scope = root;
  if (of) {
    scope = root.querySelector(`[data-mxname="${CSS.escape(of)}"], [data-lkmark="${CSS.escape(of)}"]`);
    if (!scope) return { error: `找不到叫 ${of} 的矩阵（matrix 组件里是 name=，公式里用 \\hl{${of}}{…} 把矩阵包起来）` };
  }
  const m = scope.matches?.('table[data-mx], .mtable') ? scope : scope.querySelector('table[data-mx], .mtable');
  if (!m) return { error: of ? `${of} 里没有矩阵` : '这里没有矩阵（行、列、元素只能标在矩阵上）' };
  return { m };
}

// KaTeX 的矩阵：一列一个 .col-align-*，列里每行一个带 .pstrut 的 span，格子的内容是 pstrut 后面那个
function katexCols(m) {
  return [...m.children].filter((c) => /\bcol-align-/.test(c.className)).map((col) => {
    const vl = col.querySelector('.vlist');
    return vl ? [...vl.children].filter((x) => x.querySelector(':scope > .pstrut')).map((x) => x.lastElementChild) : [];
  });
}

const splitsOf = (s) => String(s || '').split(',').map(Number).filter((n) => n > 0);

// 矩阵有几行几列、怎么分块（只看结构，不用量尺寸：板子还没翻到、看不见的时候也能查行号对不对）
function gridDims(m) {
  if (m.tagName === 'TABLE') {
    const trs = [...m.querySelectorAll('tr')];
    return { R: trs.length, C: Math.max(0, ...trs.map((tr) => tr.querySelectorAll('td[data-j]').length)), rsplit: splitsOf(m.dataset.rsplit), csplit: splitsOf(m.dataset.csplit), table: true };
  }
  const cols = katexCols(m);
  return { R: Math.max(0, ...cols.map((c) => c.length)), C: cols.length, rsplit: [], csplit: [], table: false };
}

// 二维的格子（client 坐标的矩形）。KaTeX 里空着的格子：横向用这一列的范围，纵向用这一行的范围
function cellRects(m) {
  if (m.tagName === 'TABLE') return [...m.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td[data-j]')].map((td) => rect(td.getBoundingClientRect())));
  const cols = katexCols(m);
  const n = Math.max(0, ...cols.map((c) => c.length));
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(cols.map((c) => (c[i] ? inkRect(c[i]) : null)));
  const colX = cols.map((_, j) => union(rows.map((r) => r[j]).filter((x) => x && x.w > 0)));
  const rowY = rows.map((r) => union(r.filter((x) => x && x.w > 0)));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < cols.length; j++) {
      const c = rows[i][j];
      if (c && c.w > 0) continue;
      const cx = colX[j], ry = rowY[i];
      rows[i][j] = cx && ry ? { x: cx.x, y: ry.y, w: cx.w, h: ry.h } : null;
    }
  }
  return rows;
}

// 第 k 块是哪几行（列）：[起, 止)；没有这一块是 null
function band(splits, n, k) {
  const cuts = [0, ...splits.filter((x) => x < n), n];
  return k >= 1 && k <= cuts.length - 1 ? [cuts[k - 1], cuts[k]] : null;
}

function matrixGeom(root, spec) {
  const f = findMatrix(root, spec.of);
  if (f.error) return { error: f.error };
  const { R, C, rsplit, csplit, table } = gridDims(f.m);
  if (!R || !C) return { error: '这个矩阵是空的' };
  const size = `${R}×${C}`;
  const s = spec.sel;
  // 先按结构查序号对不对，再看现在看不看得见
  if (s.kind === 'row' && s.i > R) return { error: `矩阵是 ${size} 的，没有第 ${s.i} 行` };
  if (s.kind === 'col' && s.j > C) return { error: `矩阵是 ${size} 的，没有第 ${s.j} 列` };
  if (s.kind === 'entry' && (s.i > R || s.j > C)) return { error: `矩阵是 ${size} 的，没有 (${s.i}, ${s.j}) 元` };
  let rb, cb;
  if (s.kind === 'block') {
    if (!table) return { error: '公式里的矩阵不能按块标：分块写在 matrix 组件里（split rows=… cols=…），或者用 row / col / entry' };
    rb = band(rsplit, R, s.i);
    cb = band(csplit, C, s.j);
    if (!rb || !cb) return { error: `这个矩阵分成 ${rsplit.filter((x) => x < R).length + 1}×${csplit.filter((x) => x < C).length + 1} 块，没有子块 (${s.i}, ${s.j})${rsplit.length || csplit.length ? '' : '（还没分块：matrix 组件里写 split rows=… cols=…）'}` };
  }
  if (!['all', 'row', 'col', 'entry', 'diag', 'block'].includes(s.kind)) return { error: `矩阵上不能标「${s.kind}」` };
  if (!shown(f.m)) return { hidden: true };
  const rows = cellRects(f.m);
  const cells = (pick) => rows.flatMap((r, i) => r.filter((c, j) => c && pick(i, j)));
  if (s.kind === 'all') return { geoms: [{ box: union(cells(() => true)) }] };
  // 一行（一列）的框收紧，挨着的几行各框各的：表格的格子有内边距，往里收一点；公式里的格子贴着字，往外留一点
  const inset = table ? -4 : 2;
  if (s.kind === 'row') return { geoms: [{ box: union(cells((i) => i === s.i - 1)), tight: 'y', inset }] };
  if (s.kind === 'col') return { geoms: [{ box: union(cells((i, j) => j === s.j - 1)), tight: 'x', inset }] };
  if (s.kind === 'entry') {
    const c = rows[s.i - 1]?.[s.j - 1];
    return c ? { geoms: [{ box: c }] } : { error: `(${s.i}, ${s.j}) 元是空的` };
  }
  if (s.kind === 'diag') {
    const d = [];
    for (let k = 0; k < Math.min(R, C); k++) if (rows[k]?.[k]) d.push(rows[k][k]);
    return d.length > 1 ? { geoms: [{ diag: d }] } : d.length ? { geoms: [{ box: d[0] }] } : { error: '主对角线是空的' };
  }
  return { geoms: [{ box: union(cells((i, j) => i >= rb[0] && i < rb[1] && j >= cb[0] && j < cb[1])) }] };
}

/**
 * 在 root 里找到 spec 要标的地方。opts.scene：root 是图时它的接口（label / item / at 要用）；opts.name：报错时怎么称呼 root。
 * 返回 { geoms: [{ box } | { diag } | { point }] }（client 坐标）、{ hidden: true }（现在看不到，先不画）或 { error }
 */
export function locate(root, spec, { scene, name = '这里' } = {}) {
  const s = spec.sel || { kind: 'all' };
  if (!root?.isConnected) return { error: `${name} 已经不在黑板上了` };
  if (['row', 'col', 'diag', 'entry', 'block'].includes(s.kind) || (s.kind === 'all' && spec.of)) return matrixGeom(root, spec);
  if (!shown(root)) return { hidden: true };
  if (s.kind === 'all') return { geoms: [{ box: rect((root.querySelector(':scope > .widget') || root).getBoundingClientRect()) }] };
  if (s.kind === 'term') {
    const els = [...root.querySelectorAll(`[data-lkmark="${CSS.escape(s.name)}"]`)];
    if (!els.length) {
      const names = [...new Set([...root.querySelectorAll('[data-lkmark]')].map((e) => e.dataset.lkmark))];
      return { error: `${name} 里没有 \\hl{${s.name}}{…}${names.length ? `（有的是：${names.join('、')}）` : '（要先在公式里用 \\hl{名字}{…} 给这一项起名字）'}` };
    }
    const vis = els.filter(shown);
    return vis.length ? { geoms: vis.map((e) => ({ box: inkRect(e) })) } : { hidden: true };
  }
  if (s.kind === 'step') {
    const items = [...root.querySelectorAll('.st-item')];
    if (!items.length) return { error: `${name} 不是 steps，没有「第几步」` };
    if (s.k > items.length) return { error: `${name} 一共 ${items.length} 步，没有第 ${s.k} 步` };
    const li = items[s.k - 1];
    if (li.hidden) return { error: `第 ${s.k} 步学生还没走到（还没出现）` };
    return { geoms: [{ box: rect(li.getBoundingClientRect()) }] };
  }
  if (s.kind === 'item' || s.kind === 'label') {
    let k = s.k;
    if (s.kind === 'label') {
      if (!scene?.cmdOfLabel) return { error: `${name} 不是 scene 图，不能按 label 找；用 item=第几条命令` };
      k = scene.cmdOfLabel(s.text);
      if (!k) return { error: `${name} 里没有 label=${s.text} 的东西${scene.labels?.().length ? `（有的是：${scene.labels().join('、')}）` : ''}` };
    }
    let els = [...root.querySelectorAll(`[data-cmd="${k}"]`)].filter((e) => !e.parentElement?.closest(`[data-cmd="${k}"]`));
    if (!els.length) return { error: `${name} 的第 ${k} 条命令现在没画东西（let 这类命令不画，或者还没出现）` };
    // label=：圈「标着这个名字的那个东西」的箭头尖和标签，不把一整根长箭头都圈进去
    if (s.kind === 'label') {
      const tip = [...root.querySelectorAll(`[data-cmd="${k}"] .vec-head, text[data-cmd="${k}"]`)];
      if (tip.length) els = tip;
    }
    const vis = els.filter((e) => e.getClientRects().length);
    return vis.length ? { geoms: [{ box: union(vis.map((e) => rect(e.getBoundingClientRect()))) }] } : { hidden: true };
  }
  if (s.kind === 'at') {
    if (!scene?.toClient) return { error: `${name} 不是 scene 图，不能用 at=[x, y] 指点` };
    let p;
    try { p = compile(s.expr)((scene.vars || scene.snapshot)?.call(scene) || {}); } catch (e) { return { error: `at=${s.expr} 算不出来：${e.message}` }; }
    if (!isVec(p) || p.length !== 2 || !p.every(Number.isFinite)) return { error: `at= 要是图里的二维坐标，比如 at=[1, 2]` };
    const range = scene.range?.();
    if (range && p.some((x) => Math.abs(x) > range + 1e-9)) return { error: `点 (${p.join(', ')}) 在图的范围（±${range}）外面` };
    const c = scene.toClient(p);
    return c ? { geoms: [{ point: c }] } : { hidden: true };
  }
  return { error: `不认识的标注位置「${s.kind}」` };
}

/**
 * 宿主上的标注层（一个宿主一层，第一次用时建）。
 *   add(id, spec, { root, scene, name, animate })：画一条（同一个 id 再画就是挪过去）。返回 { ok } 或 { ok: false, error }
 *   remove(id) / clear() / ids() / relayout()
 */
export function markLayer(host) {
  if (host._marks) return host._marks;
  host.classList.add('mk-host');
  const layer = document.createElement('div');
  layer.className = 'mk-layer';
  layer.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'mk-svg');
  layer.appendChild(svg);
  host.appendChild(layer);
  const items = new Map(); // id → { id, spec, root, scene, name, g, note, fresh, off }
  let raf = 0;
  let full = true; // 下一次要不要重新给旁注挑位置（加了、撤了、大小变了）；图在动时只跟着挪
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule(true)) : null;
  ro?.observe(host);
  const fontsReady = document.fonts?.ready;
  fontsReady?.then(() => schedule(true));

  function schedule(again = false) {
    full ||= again;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; layout(); });
  }

  // 旁注要躲开的字：宿主所在的整块板（或常驻栏）里的正文、公式、图上的文字、按钮、输入框。图里的线不算（旁注可以写在图上）
  function obstacles(hb, k) {
    const scope = host.closest('.class-page, .class-pins, .stage-body') || host;
    const out = [];
    const add = (r) => { if (r.width > 0 && r.height > 0) out.push({ x: (r.left - hb.left) / k, y: (r.top - hb.top) / k, w: r.width / k, h: r.height / k }); };
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (!t.data.trim() || t.parentElement?.closest('.mk-layer, .katex-mathml, [hidden]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const range = document.createRange();
    for (let t = walker.nextNode(), n = 0; t && n < 800; t = walker.nextNode(), n++) {
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) add(r);
    }
    scope.querySelectorAll('button, input, textarea, select, img, canvas').forEach((e) => { if (!e.closest('.mk-layer')) add(e.getBoundingClientRect()); });
    return out;
  }

  function layout() {
    if (!host.isConnected) { destroy(); return; }
    if (!items.size || !shown(host)) return;
    const again = full;
    full = false;
    const hb = host.getBoundingClientRect();
    const k = host.offsetWidth ? hb.width / host.offsetWidth : 1; // 宿主被 transform 缩放时换回自己的像素
    const loc = (b) => ({ x: (b.x - hb.left) / k, y: (b.y - hb.top) / k, w: b.w / k, h: b.h / k });
    const size = { w: host.offsetWidth, h: host.offsetHeight };
    // 旁注可以稍微出到宿主上下（一段的下面常常就是空着的黑板），左右不出去（免得横向滚动）
    const area = { x0: 0, y0: -40, x1: size.w, y1: size.h + 140 };
    const obs = again ? obstacles(hb, k) : [];
    const taken = [];
    // 先画形状（旁注要躲开所有形状），再放旁注
    const plans = [];
    for (const it of items.values()) {
      const found = locate(it.root, it.spec, { scene: it.scene, name: it.name });
      if (found.hidden || found.error) { setVisible(it, false); continue; }
      const shapes = found.geoms.map((g, n) => {
        const geom = g.point ? { point: { x: (g.point.x - hb.left) / k, y: (g.point.y - hb.top) / k } } : g.diag ? { diag: g.diag.map(loc) } : { box: loc(g.box), tight: g.tight, inset: g.inset };
        return { geom, shape: shapeFor(it.spec.style, geom, `${it.id}:${n}`) };
      });
      shapes.forEach((x) => taken.push(x.shape.bbox));
      plans.push({ it, shapes });
    }
    for (const { it, shapes } of plans) {
      setVisible(it, true);
      const paths = [];
      for (const { shape } of shapes) {
        for (const d of shape.strokes) paths.push({ d, cls: 'mk-line' });
        for (const d of shape.fills) paths.push({ d, cls: 'mk-fill' });
      }
      let noteBox = null;
      if (it.note) {
        const target = union(shapes.map((x) => x.shape.bbox));
        const w = it.note.offsetWidth, h = it.note.offsetHeight;
        const at = placeNote(target, { w, h }, area, { side: it.spec.side, taken, far: it.spec.style === 'arrow', obstacles: obs, keep: again ? null : it.place });
        it.place = { side: at.side, gap: at.gap, align: at.align };
        it.note.style.left = `${Math.round(at.x)}px`;
        it.note.style.top = `${Math.round(at.y)}px`;
        noteBox = { x: at.x, y: at.y, w, h };
        taken.push(noteBox);
        // 旁注挪到了空的地方、离得远：连一条细线过去（箭头样式自己有箭头）
        if (at.lead && it.spec.style !== 'arrow') paths.push({ d: leaderPath(noteBox, target, it.id), cls: 'mk-lead' });
      }
      if (it.spec.style === 'arrow') {
        // 箭头从旁注指过去；没有旁注就从斜上方指过去
        for (const [n, { geom, shape }] of shapes.entries()) {
          const to = geom.point || shape.bbox;
          const from = noteBox || defaultTail(to, size);
          paths.push({ d: arrowPath(from, to, `${it.id}:${n}`), cls: 'mk-line' });
        }
      }
      draw(it, paths);
      it.fresh = false;
    }
  }

  // 没有旁注的箭头：从目标右上方 40px 处指过去（放不下就换左边）
  function defaultTail(to, size) {
    const cx = to.w !== undefined ? to.x + to.w : to.x, cy = to.w !== undefined ? to.y : to.y;
    const right = cx + 46 < size.w;
    return { x: right ? cx + 36 : (to.x - 46), y: Math.max(0, cy - 40), w: 8, h: 8 };
  }

  function draw(it, paths) {
    if (!it.g) {
      it.g = document.createElementNS(NS, 'g');
      it.g.setAttribute('class', `mk mk-${it.spec.style}`);
      it.g.style.setProperty('--mk', MARK_COLOR[it.spec.color] || MARK_COLOR.yellow);
      svg.appendChild(it.g);
    }
    const els = [...it.g.children];
    // 条数没变就只改 d：draw-in 动画接着播，不会因为重新摆放而从头再来
    if (els.length !== paths.length || els.some((e, i) => e.getAttribute('class') !== paths[i].cls)) {
      it.g.replaceChildren(...paths.map((p) => {
        const e = document.createElementNS(NS, 'path');
        e.setAttribute('class', p.cls);
        e.setAttribute('pathLength', '1');
        return e;
      }));
    }
    [...it.g.children].forEach((e, i) => e.setAttribute('d', paths[i].d));
    if (it.fresh) {
      it.g.classList.add('mk-in');
      it.note?.classList.add('mk-in');
    }
  }

  function setVisible(it, on) {
    if (it.g) it.g.style.display = on ? '' : 'none';
    if (it.note) it.note.style.visibility = on ? '' : 'hidden';
  }

  function add(id, spec, { root = host, scene, name, animate = true } = {}) {
    const found = locate(root, spec, { scene, name });
    if (found.error) return { ok: false, error: found.error };
    remove(id);
    const it = { id, spec, root, scene, name, g: null, note: null, fresh: animate && !reduceMotion(), off: null };
    if (spec.note) {
      it.note = document.createElement('div');
      it.note.className = 'mk-note';
      it.note.style.setProperty('--mk', MARK_COLOR[spec.color] || MARK_COLOR.yellow);
      try { it.note.innerHTML = mdToHtml(spec.note, { inline: true }); } catch { it.note.textContent = spec.note; }
      layer.appendChild(it.note);
    }
    // 图重画（拖动、play、set）、矩阵动起来：标注跟着挪
    if (scene?.on) it.off = scene.on('change', () => schedule());
    if (root !== host) ro?.observe(root);
    items.set(id, it);
    full = true;
    if (found.hidden) schedule(true);
    else layout();
    return { ok: true };
  }

  function remove(id) {
    const it = items.get(id);
    if (!it) return false;
    it.off?.();
    it.g?.remove();
    it.note?.remove();
    items.delete(id);
    schedule(true);
    return true;
  }

  function clear() {
    for (const id of [...items.keys()]) remove(id);
  }

  function destroy() {
    clear();
    ro?.disconnect();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    layer.remove();
    host.classList.remove('mk-host');
    delete host._marks;
  }

  // relayout()：图动了，标注跟着挪（旁注不换边）；relayout(true)：重新挑旁注的位置
  const api = { add, remove, clear, destroy, relayout: schedule, has: (id) => items.has(id), ids: () => [...items.keys()] };
  host._marks = api;
  return api;
}

const reduceMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
