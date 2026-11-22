// 板书标注（DOM）：在宿主（课堂的一段、matrix 组件）上盖一层 SVG，按 spec（markspec.js）找到要标的地方，
// 画手绘风格的圈、框、下划线、涂色、划掉、箭头（markdraw.js），旁边写旁注。
// 宿主变大小、图重画、矩阵动起来时跟着重新摆；找不到要标的地方时返回中文原因（课堂报给 Claude，组件报成写法错误）。
import { mdToHtml } from './render.js';
import { compile as compileRad, isVec } from './expr.js';
import { shapeFor, arrowPath, arcPath, sameLine, leaderPath, placeNote, union, strokeObstacles, roomAround } from './markdraw.js';

// 同一行两处之间的箭头拱起来：旁注写在拱的那一边
function arcOf(from, to, obs) {
  if (!from || !sameLine(from, to)) return null;
  return arcPath(from, to, undefined, roomAround(union([from, to]), obs));
}
import { wordsIn, wordSpan, phraseHasPunct } from './entext.js';
import { findText, pickHit, textPreview } from './textfind.js';
import { ENCLOSE_STYLES } from './markspec.js';

// 画图的地方三角函数按角度（curve … for s 0 360、滑块的角度）：计划 3 以后表达式默认弧度，这里明着要角度（tests/expr-rad.test.js）
const compile = (src) => compileRad(src, { deg: true });

const NS = 'http://www.w3.org/2000/svg';
// 颜色都从主题变量取（不同风格的黑板颜色不一样）
export const MARK_COLOR = { yellow: 'var(--yellow)', pink: 'var(--pink)', blue: 'var(--blue)', green: 'var(--green)', orange: 'var(--orange)', purple: 'var(--lav)', red: 'var(--coral)', white: 'var(--chalk)' };

const rect = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const shown = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

// 一个元素「有字的地方」：KaTeX 里撑高度的空 span（pstrut、strut）不算，免得框得比字大一圈
const SKIP = '.pstrut, .strut, .vlist-s, .katex-mathml, .mk-layer';
const INK = 'svg, img, canvas, .frac-line, .overline-line, .underline-line, .hline, .hdashline, .rule';
// 直接写在元素里的字（列表的一条、一段话）也量：按文字本身的范围，不按元素的整行宽（不然右边的大括号跑到行尾外面去）
export function inkRect(el) {
  const rs = [];
  const push = (e) => { const r = e.getBoundingClientRect(); if (r.width > 0 || r.height > 0) rs.push(rect(r)); };
  const range = document.createRange();
  let budget = 400;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (--budget < 0) return;
      if (c.nodeType === 3) {
        if (!c.nodeValue.trim()) continue;
        range.selectNodeContents(c);
        for (const r of range.getClientRects()) if (r.width > 0) rs.push(rect(r));
        continue;
      }
      if (c.nodeType !== 1 || c.matches(SKIP)) continue;
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
  // 一行（一列）的框收紧，挨着的几行各框各的：表格的格子有内边距（7px），往里收一点，两行的框之间留出 10px；
  // 公式里的格子贴着字，往外留一点
  const inset = table ? -5 : 2;
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
  if (s.kind === 'word' || s.kind === 'words' || s.kind === 'phrase') return wordGeom(root, s, name);
  if (s.kind === 'text') return textGeom(root, s, name, spec.style === 'dots');
  if (s.kind === 'li' || s.kind === 'para' || s.kind === 'tr') return partsGeom(root, s, name);
  if (s.kind === 'blank') {
    const blanks = [...root.querySelectorAll('.en-blank')];
    if (!blanks.length) return { error: `${name} 里没有填空（blank= 用在 cloze 上）` };
    if (s.k > blanks.length) return { error: `${name} 一共 ${blanks.length} 个空，没有第 ${s.k} 个` };
    const b = blanks[s.k - 1];
    return shown(b) ? { geoms: [{ box: rect(b.getBoundingClientRect()) }] } : { hidden: true };
  }
  if (s.kind === 'part') return partGeom(root, s, name);
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

// —— 段里的第几部分：一个段落、一张表、一个列表、一个框、一个组件各算一部分，标题不算。
// 要背的一大块用一个框圈住（2026-11-03：「没必要每个都圈，直接全部一个大圈」）；框画在字外面，不压字
const PART_SKIP = 'h1, h2, h3, h4, script, style, .block-gloss';
export function segParts(root) {
  const body = root.querySelector(':scope .stage-body') || root;
  return [...body.children].filter((e) => !e.matches(PART_SKIP) && e.getClientRects().length && !e.hidden);
}
const partName = (e) => {
  const t = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14);
  const kind = e.matches('ul, ol') ? `列表（${e.children.length} 条）` : e.matches('table') ? '表格' : e.matches('.block') ? (e.querySelector('.callout') ? '框' : '组件') : '段落';
  return `${kind}「${t}${t.length >= 14 ? '…' : ''}」`;
};
function partGeom(root, s, name) {
  const parts = segParts(root);
  if (!parts.length) return { error: `${name} 里没有能按部分标的内容（part= 用在黑板的段上）` };
  if (s.b > parts.length) return { error: `${name} 一共 ${parts.length} 部分：${parts.map((e, i) => `${i + 1} ${partName(e)}`).join('；')}` };
  return { geoms: [{ box: union(parts.slice(s.a - 1, s.b).map((e) => rect(e.getBoundingClientRect()))) }] };
}

// —— 英语句子里的词：在画好的文字里找词，组件不用另外标记，普通段里的英文也能圈 ——
// 数词的范围：target 是英语组件时，是那句英文（cloze 的文字、errfind / parse 的句子、drill 的题、chunk 的句子）；target 是一段时，是整段的英文（去掉标题）
const SENTENCE = '.en-text, .en-words:not(.pz-ans), .pz-sent, .dr-q, .ck-sent, .lk-sent';
// 不算词的地方：公式、成分标注的括号和名字、反馈（揭晓的答案）、标注层自己、输入框
const NOT_WORDS = '.katex, .pz-open, .pz-close, .q-feedback, .mk-layer, .w-title, h1, h2, h3, h4, script, style, textarea, input, select, [hidden]';
function textWords(root, punct = false) {
  // 标的是一个组件：数它那句英文；标的是一整段：段里所有的英文（说明、例句、组件里的句子，按出现的顺序）
  const areas = root.matches?.('[data-bid]') ? [...root.querySelectorAll(SENTENCE)].filter(shown) : [];
  const scopes = areas.length ? areas : [root];
  const out = [];
  for (const scope of scopes) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest(NOT_WORDS) && !scope.matches(NOT_WORDS) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) for (const w of wordsIn(n.nodeValue, { punct })) out.push({ ...w, node: n });
  }
  return out;
}
function wordGeom(root, s, name) {
  if (!shown(root)) return { hidden: true };
  // phrase 里写了标点（", which"）：连标点一起数；word= / words= 只数词
  const ws = textWords(root, s.kind === 'phrase' && phraseHasPunct(s.text));
  const span = wordSpan(s, ws.map((w) => w.w));
  if (span.error) return { error: `${name}：${span.error}` };
  const a = ws[span.from], b = ws[span.to];
  const r = document.createRange();
  r.setStart(a.node, a.start);
  r.setEnd(b.node, b.end);
  // 跨行的一段词：每一行一个框（同一行的几块并起来）
  const lines = [];
  for (const c of r.getClientRects()) {
    if (c.width < 1 || c.height < 1) continue;
    const line = lines.find((l) => Math.abs(l.y + l.h / 2 - (c.top + c.height / 2)) < c.height / 2);
    if (line) Object.assign(line, union([line, rect(c)]));
    else lines.push(rect(c));
  }
  return lines.length ? { geoms: [{ box: union(lines), lines }] } : { hidden: true };
}

// 一段 Range 在屏幕上按行的框（同一行的几块并起来）
function lineRects(r) {
  const lines = [];
  for (const c of r.getClientRects()) {
    if (c.width < 1 || c.height < 1) continue;
    const line = lines.find((l) => Math.abs(l.y + l.h / 2 - (c.top + c.height / 2)) < Math.min(l.h, c.height) / 2);
    if (line) Object.assign(line, union([line, rect(c)]));
    else lines.push(rect(c));
  }
  return lines;
}

// —— text="…"：板上的任何一段字（textfind.js 找，这里换成屏幕上的位置）——
// 不算字的地方：公式的读屏副本、标注层自己、输入框、按钮、藏着的、作答后的「有把握吗」
const NOT_TEXT = '.katex-mathml, .mk-layer, .mk-under, script, style, textarea, input, select, button, [hidden], .sure-ask';
function textNodes(root) {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (!n.nodeValue || n.parentElement?.closest(NOT_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n && out.length < 4000; n = walker.nextNode()) out.push(n);
  return out;
}
function textGeom(root, s, name, wantChars = false) {
  if (!shown(root)) return { hidden: true };
  const nodes = textNodes(root);
  const texts = nodes.map((n) => n.nodeValue);
  const pk = pickHit(findText(texts, s.text), s.n, s.text);
  if (pk.error) return { error: `${name}：${pk.error}（这里写的是：${textPreview(texts)}）` };
  const { from, to } = pk.hit;
  const r = document.createRange();
  r.setStart(nodes[from[0]], from[1]);
  r.setEnd(nodes[to[0]], to[1]);
  const lines = lineRects(r);
  if (!lines.length) return { hidden: true };
  // 着重号：每个字的位置（空格不算）
  let chars;
  if (wantChars) {
    chars = [];
    const cr = document.createRange();
    for (let i = from[0]; i <= to[0] && chars.length < 160; i++) {
      const t = nodes[i].nodeValue;
      const a = i === from[0] ? from[1] : 0, b = i === to[0] ? to[1] : t.length;
      for (let k = a; k < b; k++) {
        if (/\s/.test(t[k]) || (t.charCodeAt(k) & 0xfc00) === 0xdc00) continue;
        const len = (t.charCodeAt(k) & 0xfc00) === 0xd800 ? 2 : 1;
        cr.setStart(nodes[i], k);
        cr.setEnd(nodes[i], Math.min(t.length, k + len));
        const c = cr.getBoundingClientRect();
        if (c.width > 0) chars.push(rect(c));
      }
    }
  }
  return { geoms: [{ box: union(lines), lines, ...(chars ? { chars } : {}) }], ...(pk.warn ? { warn: pk.warn } : {}) };
}

// —— li=1-4 / para=2 / tr=2：列表的第几条、第几段、表格的第几行（组件里面的不数，除非标的就是那个组件）——
const PART_SEL = { li: 'li', para: 'p', tr: 'table:not([data-mx]) tr' };
const PART_NAME = { li: '条（列表）', para: '段', tr: '行（表格）' };
// 只是装内容的框（定义、重点、易错、提示、解答……）：里面的列表、段落照常数；作答、演示这类组件里面的不数
const CONTENT_BLOCKS = '.block-definition, .block-theorem, .block-key, .block-warning, .block-example, .block-intuition, .block-hint, .block-solution, .block-proof';
function partsGeom(root, s, name) {
  const own = root.closest('[data-bid]');
  const all = [...root.querySelectorAll(PART_SEL[s.kind])].filter((e) => {
    let c = e.parentElement?.closest('[data-bid]');
    while (c && c !== own && c.matches(CONTENT_BLOCKS)) c = c.parentElement?.closest('[data-bid]');
    if (c && c !== own) return false;
    if (s.kind === 'para' && e.closest('li, .callout-title, .w-title')) return false;
    if (s.kind === 'tr' && e.closest('thead')) return false;
    return true;
  });
  if (!all.length) return { error: `${name} 里没有${s.kind === 'li' ? '列表' : s.kind === 'para' ? '成段的文字' : '表格'}${s.kind === 'li' ? '（列表是 Markdown 的 1. / - 开头的行）' : ''}` };
  if (s.b > all.length) return { error: `${name} 一共 ${all.length} ${PART_NAME[s.kind]}，没有第 ${s.b} ${PART_NAME[s.kind].slice(0, 1)}` };
  const picked = all.slice(s.a - 1, s.b);
  if (!picked.every(shown)) return { hidden: true };
  const lines = picked.map((e) => (s.kind === 'tr' ? rect(e.getBoundingClientRect()) : inkRect(e)));
  const box = union(lines);
  // 圈、框一组列表：连前面的序号一起圈进去（序号是 ::marker，量不到，按列表的左边距算）
  let outer;
  if (s.kind === 'li') {
    const lefts = picked.map((li) => {
      const pl = parseFloat(getComputedStyle(li.parentElement).paddingLeft) || 0;
      return li.getBoundingClientRect().left - Math.min(pl, 30);
    });
    outer = { ...box, x: Math.min(box.x, ...lefts), w: box.x + box.w - Math.min(box.x, ...lefts) };
  }
  return { geoms: [{ box, lines, ...(outer ? { outer } : {}) }] };
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
  let obsCache = []; // 板上的字（旁注要躲开、圈要留白）：重新挑位置时量一次，图在动时沿用
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule(true)) : null;
  ro?.observe(host);
  const fontsReady = document.fonts?.ready;
  fontsReady?.then(() => schedule(true));

  function schedule(again = false) {
    full ||= again;
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; layout(); });
  }

  // 旁注要躲开的字：宿主所在的整块板（或常驻栏）里的正文、公式、图上的文字、按钮、输入框。图里的线不算（旁注可以写在图上），示意图除外
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
    // 列表前面的序号（::marker 量不到）：按列表的左边距和第一行的高度算一块，圈旁边一条时别压到序号
    scope.querySelectorAll('li').forEach((li) => {
      const r = li.getBoundingClientRect();
      if (!r.width) return;
      const pl = Math.min(30, parseFloat(getComputedStyle(li.parentElement).paddingLeft) || 0);
      const lh = Math.min(r.height, parseFloat(getComputedStyle(li).lineHeight) || 24);
      if (pl > 4) add({ left: r.left - pl, top: r.top + 2, width: pl - 6, height: lh - 4 });
    });
    // 示意图不一样：里面的方块、括号、箭头都是特意画的，旁注压在线上就看不清（scene / graph 的网格线照旧不躲）
    const sk = [...scope.querySelectorAll('.sketch-svg :is(rect, circle, ellipse, polygon, polyline, path, line)')]
      .filter((e) => !e.closest('defs'))
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { box: { x: (r.left - hb.left) / k, y: (r.top - hb.top) / k, w: r.width / k, h: r.height / k }, closed: /^(rect|circle|ellipse|polygon)$/i.test(e.tagName) };
      });
    out.push(...strokeObstacles(sk));
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
    if (again) obsCache = obstacles(hb, k);
    const obs = obsCache;
    const taken = [];
    // 先画形状（旁注要躲开所有形状），再放旁注
    const plans = [];
    for (const it of items.values()) {
      const found = locate(it.root, it.spec, { scene: it.scene, name: it.name });
      if (found.hidden || found.error) { setVisible(it, false); continue; }
      const style = it.spec.style;
      // 圈、框、大括号：一组东西（几行字、几条列表）合成一个形状；划线、涂色、着重号一行一笔；✓ ✗ 写在最后一行后面
      const parts = [];
      for (const g of found.geoms) {
        if (g.point) { parts.push({ point: { x: (g.point.x - hb.left) / k, y: (g.point.y - hb.top) / k } }); continue; }
        if (g.diag) { parts.push({ diag: g.diag.map(loc) }); continue; }
        const lines = (g.lines || [g.box]).map(loc);
        if (ENCLOSE_STYLES.includes(style) || style === 'arrow') parts.push({ box: loc(style === 'brace' ? g.box : g.outer || g.box), tight: g.tight, inset: g.inset, ...(g.lines && !g.outer && style === 'circle' ? { lines } : {}) });
        else if (style === 'tick' || style === 'cross') parts.push({ box: lines[lines.length - 1] });
        else lines.forEach((ln) => parts.push({ box: ln, chars: g.chars?.map(loc).filter((c) => Math.abs(c.y + c.h / 2 - (ln.y + ln.h / 2)) < ln.h / 2) }));
      }
      const shapes = parts.map((geom, n) => {
        if (geom.box) Object.assign(geom, { room: roomAround(geom.box, obs), side: it.spec.side });
        return { geom, shape: shapeFor(style, geom, `${it.id}:${n}`) };
      });
      shapes.forEach((x) => taken.push(x.shape.bbox));
      plans.push({ it, shapes });
    }
    for (const { it, shapes } of plans) {
      const style = it.spec.style;
      setVisible(it, true);
      const paths = [];
      const under = [];
      for (const { shape } of shapes) {
        for (const d of shape.strokes) paths.push({ d, cls: 'mk-line' });
        for (const d of shape.dots || []) paths.push({ d, cls: 'mk-dot' });
        // 涂色画在字下面那一层：字照样清楚
        for (const d of shape.fills) under.push({ d, cls: 'mk-fill' });
      }
      // to=：从这里画箭头指到那里（同一个 target 里的另一段字）
      let toBox = null;
      if (it.spec.to) {
        const tg = textGeom(it.root, it.spec.to, it.name);
        if (tg.geoms) toBox = loc(tg.geoms[0].lines ? tg.geoms[0].lines[0] : tg.geoms[0].box);
      }
      let noteBox = null;
      if (it.note) {
        // 大括号：旁注写在括号尖的外面；箭头连到别处（to=）：写在两头中间的上面
        const brace = style === 'brace' && shapes[0]?.shape.bbox;
        const arc = toBox ? arcOf(union(shapes.map((x) => x.geom.box).filter(Boolean)), toBox, obs) : null;
        const target = toBox ? union([...shapes.map((x) => x.shape.bbox), toBox, ...(arc ? [arc.bbox] : [])]) : union(shapes.map((x) => x.shape.bbox));
        const w = it.note.offsetWidth, h = it.note.offsetHeight;
        const side = brace ? (it.spec.side === 'left' ? 'left' : 'right') : toBox ? it.spec.side || (arc?.down ? 'below' : 'above') : it.spec.side;
        const at = placeNote(brace || target, { w, h }, area, { side, taken, far: style === 'arrow' && !toBox, obstacles: obs, keep: again ? null : it.place });
        it.place = { side: at.side, gap: at.gap, align: at.align };
        it.note.style.left = `${Math.round(at.x)}px`;
        it.note.style.top = `${Math.round(at.y)}px`;
        noteBox = { x: at.x, y: at.y, w, h };
        taken.push(noteBox);
        // 旁注挪到了空的地方、离得远：连一条细线过去（箭头样式自己有箭头）
        if (at.lead && it.spec.style !== 'arrow') paths.push({ d: leaderPath(noteBox, target, it.id), cls: 'mk-lead' });
      }
      if (style === 'arrow' && toBox) {
        const from = union(shapes.map((x) => x.geom.box).filter(Boolean));
        paths.push({ d: arrowPath(from, toBox, it.id, { room: roomAround(union([from, toBox]), obs) }), cls: 'mk-line' });
      } else if (style === 'arrow') {
        // 箭头从旁注指过去；没有旁注就从斜上方指过去
        for (const [n, { geom, shape }] of shapes.entries()) {
          const to = geom.point || shape.bbox;
          const from = noteBox || defaultTail(to, size);
          paths.push({ d: arrowPath(from, to, `${it.id}:${n}`), cls: 'mk-line' });
        }
      }
      draw(it, paths, under);
      it.fresh = false;
    }
  }

  // 没有旁注的箭头：从目标右上方 40px 处指过去（放不下就换左边）
  function defaultTail(to, size) {
    const cx = to.w !== undefined ? to.x + to.w : to.x, cy = to.w !== undefined ? to.y : to.y;
    const right = cx + 46 < size.w;
    return { x: right ? cx + 36 : (to.x - 46), y: Math.max(0, cy - 40), w: 8, h: 8 };
  }

  function group(it, key, parent) {
    if (!it[key]) {
      it[key] = document.createElementNS(NS, 'g');
      it[key].setAttribute('class', `mk mk-${it.spec.style}`);
      it[key].setAttribute('data-mk', it.id); // 黑板的视力（class/boardsight.js）按它认是哪一条标注
      it[key].style.setProperty('--mk', MARK_COLOR[it.spec.color] || MARK_COLOR.yellow);
      parent.appendChild(it[key]);
    }
    return it[key];
  }
  function fill(g, paths) {
    const els = [...g.children];
    // 条数没变就只改 d：draw-in 动画接着播，不会因为重新摆放而从头再来
    if (els.length !== paths.length || els.some((e, i) => e.getAttribute('class') !== paths[i].cls)) {
      g.replaceChildren(...paths.map((p) => {
        const e = document.createElementNS(NS, 'path');
        e.setAttribute('class', p.cls);
        e.setAttribute('pathLength', '1');
        return e;
      }));
    }
    [...g.children].forEach((e, i) => e.setAttribute('d', paths[i].d));
  }
  function draw(it, paths, under = []) {
    fill(group(it, 'g', svg), paths);
    if (under.length || it.gu) fill(group(it, 'gu', usvg()), under);
    if (it.fresh) {
      it.g.classList.add('mk-in');
      it.gu?.classList.add('mk-in');
      it.note?.classList.add('mk-in');
    }
  }

  // 字下面那一层（荧光笔）：第一次要用时才建
  let under = null, underSvg = null;
  function usvg() {
    if (underSvg) return underSvg;
    under = document.createElement('div');
    under.className = 'mk-under';
    under.setAttribute('aria-hidden', 'true');
    underSvg = document.createElementNS(NS, 'svg');
    underSvg.setAttribute('class', 'mk-svg');
    under.appendChild(underSvg);
    host.prepend(under);
    return underSvg;
  }

  function setVisible(it, on) {
    if (it.gu) it.gu.style.display = on ? '' : 'none';
    if (it.g) it.g.style.display = on ? '' : 'none';
    if (it.note) it.note.style.visibility = on ? '' : 'hidden';
  }

  function add(id, spec, { root = host, scene, name, animate = true } = {}) {
    const found = locate(root, spec, { scene, name });
    if (found.error) return { ok: false, error: found.error };
    if (spec.to && !found.hidden) {
      const t = textGeom(root, spec.to, name || '这里');
      if (t.error) return { ok: false, error: `箭头要指到的${t.error}` };
    }
    remove(id);
    const it = { id, spec, root, scene, name, g: null, note: null, fresh: animate && !reduceMotion(), off: null };
    if (spec.note) {
      it.note = document.createElement('div');
      it.note.className = 'mk-note';
      it.note.setAttribute('data-mk', id);
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
    return { ok: true, ...(found.warn ? { warn: found.warn } : {}) };
  }

  function remove(id) {
    const it = items.get(id);
    if (!it) return false;
    it.off?.();
    it.g?.remove();
    it.gu?.remove();
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
    under?.remove();
    host.classList.remove('mk-host');
    delete host._marks;
  }

  // relayout()：图动了，标注跟着挪（旁注不换边）；relayout(true)：重新挑旁注的位置
  const api = { add, remove, clear, destroy, relayout: schedule, has: (id) => items.has(id), ids: () => [...items.keys()] };
  host._marks = api;
  return api;
}

const reduceMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
