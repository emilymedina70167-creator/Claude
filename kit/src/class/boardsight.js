// 黑板的视力（2026-11-22 学生要的「设计二」）：每一轮画完，在学生的屏幕上量一遍这块板——标注的线穿过了输入框、旁注压着字、
// 内容伸出板外或要横着滑、文字里漏出没画出来的源码（**、$…$、\frac、==）、一栏太窄一段话折成好多行——照实写进黑板现状
// （页面里的老师每一轮都看得到）和外部的课的 meta/now、ext_out。只报量出来的事实，不挪、不拦、不改板；不调用 Claude。
// 学生在 5 节课里为排版说了 8 次，每一次都是他开口以后老师才知道（11-17：「标注没对准字，还压住了填空」）。舞台那边有
// stage/sight.js，黑板以前没有。
// 上半是纯函数（tests/board-sight.test.js）；measureBoard 碰 DOM，只读几何，几毫秒。

const area = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const inside = (p, r, pad = 2) => p.x > r.x + pad && p.x < r.x + r.w - pad && p.y > r.y + pad && p.y < r.y + r.h - pad;
const clip = (s, n = 36) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/**
 * 文字里漏出来的源码（学生看到的是字面上的符号）：返回 [片段]，没有是 []。
 * 只认几种几乎不会是正文本意的：成对的 **、成对的 ==、$…$ 包着的一段、反斜杠命令（\frac \begin …）。
 * 钱数「$5」、单个的 * 和 = 不算
 */
export function rawBits(text) {
  let t = String(text ?? '');
  const out = [];
  // 认出来的一段换成空格：后面的规则不再从它里面认一遍（$\frac{1}{2}$ 只算一处）
  const take = (re) => { t = t.replace(re, (m) => { if (out.length < 3) out.push(clip(m, 30)); return ' '.repeat(m.length); }); };
  take(/\*\*[^*\n]{1,40}\*\*|\*\*/g);
  // 荧光笔的 ==…== 两头贴着字（render.js 也只认这种）；代码里的「dk == 2 && i == 5」两头是空格，不是漏出来的写法（11-24 被当成了）
  if (out.length < 3) take(/==(?=[^\s=])[^=\n]{1,40}(?<=[^\s=])==/g);
  if (out.length < 3) take(/\$[^$\s][^$\n]{0,60}\$/g);
  if (out.length < 3) take(/\\(?:frac|dfrac|begin|end|sqrt|times|cdot|left|right|mathbf|text|hl|chalk|calc|alpha|beta|lambda|sum|int)\b[^\s，。]{0,24}/g);
  return [...new Set(out)];
}

/**
 * 量到的几何 → 版面问题（纯函数）。坐标都是屏幕像素、同一个原点。
 * m：{
 *   marks:    [{ id, pts: [{x,y}]（线上取的点）, note: {x,y,w,h} | null }]
 *   controls: [{ where, what, rect }]（输入框、按钮）
 *   texts:    [{ where, rect }]（正文一行行的字）
 *   spill:    [{ where, what, by }]（伸出板右边 by 像素）
 *   scroll:   [{ where, what, need, have }]（比板宽、要横着滑）
 *   raw:      [{ where, bits: [] }]
 *   narrow:   [{ where, width, lines }]（一栏 width 像素宽，那一段折成 lines 行）
 * }
 * 返回 [{ kind, key, text }]：key 用来判断「和上一次一样」
 */
export function boardSightIssues(m = {}) {
  const out = [];
  const push = (kind, key, text) => { if (!out.some((x) => x.key === key)) out.push({ kind, key, text }); };
  for (const mk of m.marks || []) {
    const pts = mk.pts || [];
    for (const c of m.controls || []) {
      // 线上至少两个点落在框里面（边上留 2 像素）才算穿过：圈住整个组件的圈从外面绕，不算
      const hit = pts.filter((p) => inside(p, c.rect)).length;
      if (hit >= 2) push('cross', `cross:${mk.id}:${c.where}:${c.what}`, `标注 ${mk.id} 的线穿过了 ${c.where} 的${c.what}`);
    }
    if (mk.note) {
      for (const c of m.controls || []) if (area(mk.note, c.rect) > 30) push('note', `note:${mk.id}:${c.where}:${c.what}`, `标注 ${mk.id} 的旁注压着 ${c.where} 的${c.what}`);
      const covered = new Set();
      for (const t of m.texts || []) {
        const a = area(mk.note, t.rect);
        if (a > 40 && a > 0.2 * Math.min(mk.note.w * mk.note.h, t.rect.w * t.rect.h)) covered.add(t.where);
      }
      for (const w of covered) push('note', `notetext:${mk.id}:${w}`, `标注 ${mk.id} 的旁注压着 ${w} 的字`);
    }
  }
  for (const s of m.spill || []) push('spill', `spill:${s.where}:${s.what}`, `${s.where} 的${s.what}伸出板的右边 ${Math.round(s.by)} 像素，学生那边被裁掉`);
  for (const s of m.scroll || []) push('scroll', `scroll:${s.where}:${s.what}`, `${s.where} 的${s.what}宽约 ${Math.round(s.need)}，这里只有 ${Math.round(s.have)}，学生要横着滑才看得全`);
  for (const r of m.raw || []) if (r.bits?.length) push('raw', `raw:${r.where}:${r.bits.join('|')}`, `${r.where} 的字里露出了没画出来的写法：${r.bits.map((b) => `「${b}」`).join('、')}`);
  for (const n of m.narrow || []) push('narrow', `narrow:${n.where}`, `${n.where} 所在的那一栏只有 ${Math.round(n.width)} 像素宽，一段话折成了 ${n.lines} 行`);
  return out;
}

/** 写进黑板现状的那一节：没有问题是 ''（干净的板什么都不写） */
export function boardSightText(issues = [], { max = 12 } = {}) {
  if (!issues.length) return '';
  const shown = issues.slice(0, max);
  const more = issues.length - shown.length;
  return ['版面（页面在学生屏幕上量的）：', ...shown.map((x) => `- ${x.text}`), ...(more > 0 ? [`- 另有 ${more} 处同类的没列`] : [])].join('\n');
}

/** 两次量的结果是不是同一批问题（外部的课：一样的不再往 ext_out 里写） */
export const sightSig = (issues = []) => issues.map((x) => x.key).sort().join('\n');

// —— DOM：量一块板 ——

const RECT = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const NOT_TEXT = '.mk-layer, .mk-under, .katex, code, pre, script, style, textarea, input, select, button, [hidden], .block-stage, svg, canvas';
const where = (el) => {
  const b = el.closest?.('.block[data-bid]');
  const s = el.closest?.('[data-step]');
  return b?.dataset.bid || s?.dataset.step || '板上';
};
const CONTROL = 'input:not([type=hidden]), textarea, select, button, [contenteditable="true"], [contenteditable=""]';
const whatOf = (el) => (el.matches('button') ? '按钮' : el.matches('select') ? '下拉框' : '输入框');
// 线上取点：每条 path 按长度取 40 个点（getPointAtLength 在 path 自己的坐标里，换成屏幕坐标）
function pathPoints(path) {
  const pts = [];
  try {
    const len = path.getTotalLength();
    const ctm = path.getScreenCTM();
    if (!(len > 0) || !ctm) return pts;
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const p = path.getPointAtLength((len * i) / n);
      pts.push({ x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f });
    }
  } catch { /* 量不到的 path 不算 */ }
  return pts;
}

/**
 * 量 scopes（这块板、常驻栏）：返回 boardSightIssues 的输入。看不见的（display:none、宽 0）不量
 */
export function measureBoard(scopes = []) {
  const m = { marks: [], controls: [], texts: [], spill: [], scroll: [], raw: [], narrow: [] };
  for (const scope of scopes) {
    if (!scope || !scope.getBoundingClientRect) continue;
    const box = scope.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) continue;
    // 标注：线（mk-line、mk-lead）和旁注
    const byId = new Map();
    for (const g of scope.querySelectorAll('.mk-layer g[data-mk]')) {
      if (g.style.display === 'none') continue;
      const id = g.getAttribute('data-mk');
      const it = byId.get(id) || byId.set(id, { id, pts: [], note: null }).get(id);
      for (const p of g.querySelectorAll('path.mk-line, path.mk-lead')) it.pts.push(...pathPoints(p));
    }
    for (const n of scope.querySelectorAll('.mk-layer .mk-note[data-mk]')) {
      if (n.style.visibility === 'hidden') continue;
      const r = n.getBoundingClientRect();
      if (!(r.width > 0)) continue;
      const id = n.getAttribute('data-mk');
      const it = byId.get(id) || byId.set(id, { id, pts: [], note: null }).get(id);
      it.note = RECT(r);
    }
    m.marks.push(...byId.values());
    for (const c of scope.querySelectorAll(CONTROL)) {
      if (c.closest('.mk-layer, [hidden], .block-stage')) continue;
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) m.controls.push({ where: where(c), what: whatOf(c), rect: RECT(r) });
    }
    // 正文：一行行的字（旁注要比的）；顺带看有没有漏出来的源码
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (t) => (!t.data.trim() || t.parentElement?.closest(NOT_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const range = document.createRange();
    const rawBy = new Map();
    for (let t = walker.nextNode(), n = 0; t && n < 800; t = walker.nextNode(), n++) {
      const w = where(t.parentElement);
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) if (r.width > 0) m.texts.push({ where: w, rect: RECT(r) });
      const bits = rawBits(t.data);
      if (bits.length) rawBy.set(w, [...new Set([...(rawBy.get(w) || []), ...bits])].slice(0, 3));
    }
    for (const [w, bits] of rawBy) m.raw.push({ where: w, bits });
    // 伸出板外、要横着滑：每一段里的公式、表、图、组件（报最外面那一层）
    const right = box.right;
    const seen = new Set();
    for (const el of scope.querySelectorAll('.katex-display, table, img, .block, pre')) {
      if (el.closest('.mk-layer, [hidden]')) continue;
      const w = where(el);
      const what = el.matches('.katex-display') ? '公式' : el.matches('table') ? '表' : el.matches('img') ? '图' : el.matches('pre') ? '代码' : '组件';
      const key = `${w}:${what}`;
      if (seen.has(key)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0)) continue;
      if (el.scrollWidth > el.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(el).overflowX)) { seen.add(key); m.scroll.push({ where: w, what, need: el.scrollWidth, have: el.clientWidth }); continue; }
      if (r.right > right + 4) { seen.add(key); m.spill.push({ where: w, what, by: r.right - right }); }
    }
    // 一栏太窄：版面里的栏不到 300 像素宽，里面有一段话折成 6 行以上
    for (const col of scope.querySelectorAll('.cv-col')) {
      const cw = col.getBoundingClientRect().width;
      if (!(cw > 0 && cw < 300)) continue;
      for (const p of col.querySelectorAll('p, li')) {
        const lh = parseFloat(getComputedStyle(p).lineHeight) || 24;
        const lines = Math.round(p.getBoundingClientRect().height / lh);
        if (lines >= 6) { m.narrow.push({ where: where(p), width: cw, lines }); break; }
      }
    }
  }
  return m;
}
