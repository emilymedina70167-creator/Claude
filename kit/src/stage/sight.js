// 量画面（舞台主线第十轮，docs/superpowers/plans/2026-11-14-stage-sight.md）：每一样东西在屏幕上真画在哪，
// 压着的、出了屏幕的、字溢出的……和学生看到的是同一个样子。以前这一把尺子只在测试工具里（tools/stage-measure.mjs），
// 课堂里给老师的「版面」用的是排版时分的格子：后来加的那一问、字变大以后长高的卡都不重量，屏幕上压着、报告写「没压着」
// （2026-11-14 情态那一节真课，学生说了五次）。现在课堂（交给学生之前先量，loop.js）、现状里的版面、排版检查、试演都用这一份。
// sightIssues / sightLines 是纯函数（tests/stage-sight.test.js）；measureStage 碰 DOM。

/** 两两比压着、每样比出了屏幕。items：{ kind: obj|label|caption|goal|dock|pop|chrome, id, rects:[{x,y,w,h}] }；tied(a, b)：系在一起的两样东西不算 */
export function sightIssues(items, { vw, vh, tied = () => false } = {}) {
  const issues = [];
  const hitArea = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 2 && h > 2 ? w * h : 0; };
  const pairHit = (A, B) => { let best = 0; for (const a of A.rects) for (const b of B.rects) best = Math.max(best, hitArea(a, b)); return best; };
  const same = (k) => ['dock', 'caption', 'goal', 'chrome'].includes(k);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.kind === 'obj' && b.kind === 'obj' && tied(a, b)) continue;
    if (a.kind === b.kind && same(a.kind)) continue;
    // 页面的按钮和底下那一条、拨数器（它们本来就挨着页面的按钮排）不算
    if ((a.kind === 'chrome' && (b.kind === 'dock' || b.kind === 'pop')) || (b.kind === 'chrome' && (a.kind === 'dock' || a.kind === 'pop'))) continue;
    const area = pairHit(a, b);
    if (area > 24) issues.push({ what: '压着', a: `${a.kind}:${a.id}`, b: `${b.kind}:${b.id}`, area: Math.round(area) });
  }
  for (const it of items) for (const r of it.rects) {
    if (r.x < -2 || r.y < -2 || r.x + r.w > vw + 2 || r.y + r.h > vh + 2) { issues.push({ what: '出了屏幕', a: `${it.kind}:${it.id}`, b: '', area: 0, r: [r.x, r.y, r.w, r.h].map(Math.round) }); break; }
  }
  return issues;
}

/** 给老师看的名字：obj:q → q；话里这一问那一行 → 这一问；dial:m → 拨盘 m；label:lm → 贴的字 lm */
export function nameOf(key, items = []) {
  const [kind, ...rest] = String(key).split(':');
  const id = rest.join(':');
  if (kind === 'obj') return id;
  if (kind === 'caption') return items.find((x) => x.kind === 'caption' && x.id === id)?.ask ? '这一问' : '话';
  if (kind === 'label') return id.startsWith('dial:') ? `拨盘 ${id.slice(5)}` : `贴的字 ${id}`;
  if (kind === 'goal') return `挑战 ${id}`;
  if (kind === 'dock') return '底下的输入框';
  if (kind === 'pop') return '拨数器';
  if (kind === 'chrome') return id;
  return key;
}

/** 一定要改的（压着、出了屏幕）。别的（字小、贴的字离得远……）只写进现状 */
export const MUST = new Set(['压着', '出了屏幕']);
export const mustOf = (issues = []) => issues.filter((x) => MUST.has(x.what));

/** 写给老师的几行：q 压着 tl（重叠约 120×40）；这一问 出了屏幕。同一对只写一次 */
export function sightLines(issues = []) {
  const seen = new Set();
  const out = [];
  for (const x of mustOf(issues)) {
    const a = x.an || x.a, b = x.bn || x.b;
    const key = x.what === '压着' ? [a, b].sort().join('|') : `${a}|out`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x.what === '压着' ? `${a} 和 ${b} 压着` : `${a} 出了屏幕`);
  }
  return out;
}

export function measureStage(st, visual = false) {
  const vr = st.view.getBoundingClientRect();
  const vis = (n) => { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false; const r = n.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5; };
  // SVG 里的线被外面那层 svg 裁掉的部分不算（平面的网格线画得很长，只露出平面那一块）
  const clipOf = (n) => { for (let p = n.parentElement; p && p !== st.root; p = p.parentElement) if (p.tagName?.toLowerCase() === 'svg' && getComputedStyle(p).overflow !== 'visible') return p.getBoundingClientRect(); return null; };
  // clip-path 裁掉的（平面的网格、张成的那一条）：裁到这样东西自己的地方
  const clipped = (n) => { for (let p = n; p && p !== st.root; p = p.parentElement) { if (p.getAttribute?.('clip-path') || (getComputedStyle(p).clipPath || 'none') !== 'none') return true; } return false; };
  const ownBox = (n) => { const id = n.closest?.('[data-obj]')?.dataset.obj; const o = id && st.scene.objects.get(id); if (!o) return null; const b = st.scene.objectBox(id), c = st.cam; return { left: vr.left + b.x * c.s + c.tx, top: vr.top + b.y * c.s + c.ty, right: vr.left + (b.x + b.w) * c.s + c.tx, bottom: vr.top + (b.y + b.h) * c.s + c.ty }; };
  const rect = (n) => {
    let r = n.getBoundingClientRect();
    const c = n instanceof SVGElement ? (clipOf(n) || (clipped(n) ? ownBox(n) : null)) : null;
    if (c) { const x = Math.max(r.left, c.left), y = Math.max(r.top, c.top), x2 = Math.min(r.right, c.right), y2 = Math.min(r.bottom, c.bottom); r = { left: x, top: y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) }; }
    return { x: r.left - vr.left, y: r.top - vr.top, w: r.width, h: r.height };
  };
  const union = (rs) => { if (!rs.length) return null; const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y)); return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }; };
  const items = [];
  const objs = [...st.scene.objects.keys()];
  function visualBoxes(id) {
    const out = [];
    for (const n of st.root.querySelectorAll(`[data-obj="${CSS.escape(id)}"]`)) {
      if (!vis(n)) continue;
      if (n instanceof SVGElement) {
        if (n.ownerSVGElement !== st.under && n.ownerSVGElement !== st.ink) continue;
        if (n.parentElement !== st.under && n.parentElement !== st.ink && n.parentElement?.closest?.('[data-obj]')?.dataset.obj === id) continue;
        const wb = st.svgBoxOf(n);
        if (wb) out.push(wb);
        continue;
      }
      if (n.parentElement !== st.layer) continue;
      out.push({ ...rect(n), screen: true });
    }
    return out;
  }
  for (const id of objs) {
    // 画出来的东西：一个一个的框（拿来和别的东西比，空着的地方不算占），和舞台自己量的同一个办法（stage.footprintBoxes：
    // 最后摆的地方、SVG 按 getCTM 换到世界坐标、clip-path 裁掉的不算），再按镜头换到屏幕上
    // 真演的时候（visual）：量看得见的样子——HTML 节点按 getBoundingClientRect（动画走到哪就是哪），SVG 按 getCTM（也跟着动画），镜头按现在真正的样子；
    // 最后摆的地方在动画走到一半时和看得见的对不上，会报出没有的重叠
    const cam0 = visual ? st.liveCam() : st.cam;
    const boxes = visual ? visualBoxes(id) : st.footprintBoxes(id);
    const rs = boxes.map((b) => (b.screen ? b : { x: b.x * cam0.s + cam0.tx, y: b.y * cam0.s + cam0.ty, w: b.w * cam0.s, h: b.h * cam0.s })).filter((r) => r.w * r.h > 4);
    const box = st.scene.objectBox(id);
    const cam = st.cam;
    const screenBox = { x: box.x * cam.s + cam.tx, y: box.y * cam.s + cam.ty, w: box.w * cam.s, h: box.h * cam.s };
    items.push({ kind: 'obj', id, rects: rs, box: screenBox, union: union(rs) });
  }
  for (const [id, l] of st.labelNodes) if (vis(l.node)) items.push({ kind: 'label', id, rects: [rect(l.node)] });
  // 横屏解析栏里的话能上下滑：滑出栏外的那几句看不见，不算（不然都算「出了屏幕」）；看得见的那一截照栏裁
  const capBox = st.sideOn ? rect(st.caption) : null;
  st.caption.querySelectorAll('.st-line:not(.is-out)').forEach((n, i) => {
    if (!vis(n)) return;
    let r = textRect(n, vr);
    if (capBox) {
      const x = Math.max(r.x, capBox.x), y = Math.max(r.y, capBox.y), x2 = Math.min(r.x + r.w, capBox.x + capBox.w), y2 = Math.min(r.y + r.h, capBox.y + capBox.h);
      if (x2 - x < 1 || y2 - y < 1) return;
      r = { x, y, w: x2 - x, h: y2 - y };
    }
    items.push({ kind: 'caption', id: `话${i + 1}`, ask: n.dataset.kind === 'ask', rects: [r] });
  });
  st.goalsEl.querySelectorAll('.st-goal:not(.is-out)').forEach((n, i) => { if (vis(n)) items.push({ kind: 'goal', id: n.dataset.id || `挑战${i + 1}`, rects: [rect(n)] }); });
  [...st.dock.children].forEach((n, i) => { if (vis(n)) items.push({ kind: 'dock', id: `底下${i + 1}`, rects: [rect(n)] }); });
  st.view.querySelectorAll('.mx-step').forEach((n) => { if (vis(n)) items.push({ kind: 'pop', id: '拨数器', rects: [rect(n)] }); });
  // 话的一行占的是字，不是整行宽
  function textRect(n, vr) {
    const r = document.createRange(); r.selectNodeContents(n);
    const rs = [...r.getClientRects()].map((q) => ({ x: q.left - vr.left, y: q.top - vr.top, w: q.width, h: q.height }));
    return union(rs) || rect(n);
  }
  // 页面自己的按钮（右上角「说过的」、撤一步、Pencil 写了字以后的「撤一笔 / 擦掉」）：东西、话压着它们也算（第十轮）
  for (const [n, name] of [[st.talkBtn, '页面的按钮「说过的」'], [st.undoBox, '页面的按钮「撤一步」'], [st.root.querySelector('.st-ink-bar'), '页面的按钮「撤一笔 / 擦掉」']]) {
    if (!n || n.hidden || !vis(n)) continue;
    const r = rect(n);
    if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > st.view.clientWidth || r.y > st.view.clientHeight) continue; // 挂在画面外面那一条上的不算
    items.push({ kind: 'chrome', id: name, rects: [r] });
  }
  const hitArea = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 2 && h > 2 ? w * h : 0; };
  const tied = (a, b) => { const o = st.scene.objects.get(a.id), p = st.scene.objects.get(b.id); const ta = o && st.scene.type(o).anchors?.(o) || [], tb = p && st.scene.type(p).anchors?.(p) || []; return ta.includes(b.id) || tb.includes(a.id); };
  const issues = sightIssues(items, { vw: st.view.clientWidth, vh: st.view.clientHeight, tied });
  // 乘积那一排散了：product P = A B 排成一排的（不是另起一行「BA =」的），A、B、「= P」要在一排上、从左往右
  // （第三次量：同名重造 product P = B A 以后「= P」被推到后造的东西下面，压不着谁，前面几项都量不出来）
  for (const [id, o] of st.scene.objects) {
    if (o.hidden || !o.product || o.prefix || o.product.a === o.product.b) continue;
    const fa = st.scene.objects.get(o.product.a), fb = st.scene.objects.get(o.product.b);
    if (!fa || !fb || fa.hidden || fb.hidden) continue;
    // 乘积的框连着「=」和整排下面那一条算式，比的是它自己的左上角（origin）；因子比它们的框（因子也是乘积时框里带着它的算式，只比右沿、上沿）
    const A = st.scene.objectBox(fa.id), B = st.scene.objectBox(fb.id), P = o.origin;
    const top = Math.max(fa.origin.y, fb.origin.y), btm = Math.min(A.y + A.h, B.y + B.h);
    const inRow = top < btm && P.y < btm && P.y + 20 > Math.min(fa.origin.y, fb.origin.y);
    const inOrder = A.x + A.w <= fb.origin.x + 2 && B.x + B.w <= P.x + 2;
    if (!inRow || !inOrder) issues.push({ what: '乘积那一排散了', a: `obj:${o.product.a} ${o.product.b}`, b: `obj:${id}`, area: 0 });
  }
  // 画到了自己的地方外面：objectBox 报小了（别的东西会被摆上来压着）
  for (const it of items) if (!visual && it.kind === 'obj' && it.union) {
    const u = it.union, b = it.box, s = st.cam.s;
    const out = Math.max(b.x - u.x, b.y - u.y, u.x + u.w - (b.x + b.w), u.y + u.h - (b.y + b.h));
    if (out > 6 * s) issues.push({ what: '画到了自己的地方外面', a: `obj:${it.id}`, b: '', area: Math.round(out / s) });
  }
  // —— 以前量不出来的四种（舞台主线第一轮：这几种排版检查都说「没压着、没出屏幕」）——
  // 字溢出了格子：部件（格子、结点）里的字比它自己的框大
  for (const [pid, n] of st.nodes || []) {
    if (!(n instanceof HTMLElement) || !vis(n)) continue;
    const texts = [];
    const walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    // 只量部件自己的字：特意挂在外面的小牌子（平衡因子、访问号、成分的标签：绝对定位的）不算
    const hung = (e) => { for (let p = e; p && p !== n; p = p.parentElement) if (['absolute', 'fixed'].includes(getComputedStyle(p).position)) return true; return false; };
    for (let t = walk.nextNode(); t; t = walk.nextNode()) { if (!t.nodeValue.trim() || !vis(t.parentElement) || hung(t.parentElement)) continue; const r = document.createRange(); r.selectNodeContents(t); texts.push(...r.getClientRects()); }
    if (!texts.length) continue;
    const box = n.getBoundingClientRect();
    // 横着溢出去，或者折成好几行、从下面溢出去（三个长词的一排格子，字叠到了下面）
    const left = Math.min(...texts.map((q) => q.left)), right = Math.max(...texts.map((q) => q.right));
    const top = Math.min(...texts.map((q) => q.top)), bottom = Math.max(...texts.map((q) => q.bottom));
    const over = Math.max(box.left - left, right - box.right, box.top - top, bottom - box.bottom);
    if (over > 4) issues.push({ what: '字溢出了格子', a: `part:${pid}`, b: '', area: Math.round(over) });
  }
  // 边上的数叠在一起：图上两条边的权的牌子盖住了一大半
  const ws = [...st.root.querySelectorAll('.gr-w')].filter(vis).map((n) => ({ n, r: rect(n) }));
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
    const a = ws[i].r, b = ws[j].r, hit = hitArea(a, b);
    if (hit > 0.35 * Math.min(a.w * a.h, b.w * b.h)) issues.push({ what: '边上的数叠在一起', a: `边权「${ws[i].n.textContent.trim()}」`, b: `边权「${ws[j].n.textContent.trim()}」`, area: Math.round(hit) });
  }
  // 贴的字没在写的那一边：写了 side=，画面摆到了别的一边
  for (const [id, cur] of st.labelNodes) {
    const l = st.scene.labels.get(id);
    if (l && l.asked && l.side && !l.dial && cur.side && cur.side !== l.side && vis(cur.node)) issues.push({ what: '贴的字没在写的那一边', a: `label:${id}（写的是 ${l.side}，画在 ${cur.side}）`, b: '', area: 0 });
  }
  // 贴的字离它贴的东西远（主线第六轮：时态课截图里贴在小人上的字跑到轴的上面去）、贴的字在屏幕上太小（生词注只有十一二像素）
  for (const [id, cur] of st.labelNodes) {
    const l = st.scene.labels.get(id);
    if (!l || l.dial || !cur.anchor || !cur.box || !vis(cur.node)) continue;
    const a = cur.anchor, b = cur.box, s = st.cam.s;
    const gx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), gy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
    const gap = Math.hypot(gx, gy) * s;
    if (gap > 70) issues.push({ what: '贴的字离得远', a: `label:${id}（隔了 ${Math.round(gap)}）`, b: '', area: 0 });
    const px = parseFloat(getComputedStyle(cur.node).fontSize) * s;
    if (px < 15) issues.push({ what: '贴的字太小', a: `label:${id}（屏幕上 ${px.toFixed(1)}px）`, b: '', area: 0 });
  }
  // 弧拱进了别的东西里：一样东西自己格子之间的弧（分组的连线、hop 的弧）压到别的东西上、被盖住
  // （和 footprintBoxes 分开量一遍：弧不算进那样东西自己占的地方时，上面的「压着」量不出来）
  for (const l of st.scene.links.values()) {
    if (l.whole || l.a.obj !== l.b.obj || !st.linkShown(l)) continue;
    const g = st.linkGeo(l);
    if (!g.box || g.rail) continue;
    const c = st.cam, r = { x: g.box.x * c.s + c.tx, y: g.box.y * c.s + c.ty, w: g.box.w * c.s, h: g.box.h * c.s };
    const hit = items.find((it) => it.kind === 'obj' && it.id !== l.a.obj && it.rects.some((q) => hitArea(r, q) > 24));
    if (hit && !issues.some((x) => x.what === '弧拱进了别的东西里' && x.a === `obj:${l.a.obj}` && x.b === `obj:${hit.id}`)) issues.push({ what: '弧拱进了别的东西里', a: `obj:${l.a.obj}`, b: `obj:${hit.id}`, area: 0 });
  }
  // 拨盘没跟着它的东西：dial … at=a 的拨盘离 a 隔了一大截（a 变矮以后拨盘留在老地方）
  for (const [id, cur] of st.labelNodes) {
    const l = st.scene.labels.get(id);
    if (!l?.dial || !cur.box || !cur.anchor || !vis(cur.node)) continue;
    const a = cur.anchor, b = cur.box;
    const gap = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), a.y - (b.y + b.h), b.y - (a.y + a.h));
    const now = st.anchorOf?.(l);
    const far = now ? Math.max(now.x - (b.x + b.w), b.x - (now.x + now.w), now.y - (b.y + b.h), b.y - (now.y + now.h)) : gap;
    if (far > 120) issues.push({ what: '拨盘没跟着它的东西', a: `拨盘 ${l.dial}（隔了 ${Math.round(far)}）`, b: '', area: 0 });
  }
  // 括号的线穿过了字：句子上两道括号交叠时，一道的竖线从另一道括号下面的字上穿过去（两样都是同一句的，压不压着量不出来）
  {
    const brs = [...st.root.querySelectorAll('.sn-br')].filter(vis).map((n) => ({ n, r: rect(n) }));
    for (const m of [...st.root.querySelectorAll('.sn-mk')].filter(vis)) {
      const t = m.querySelector('.sn-mk-t') || m, r = textRect(t, vr);
      for (const b of brs) {
        const xs = [b.n.classList.contains('is-openl') ? null : b.r.x, b.n.classList.contains('is-openr') ? null : b.r.x + b.r.w].filter((x) => x != null);
        const through = b.r.y < r.y + r.h - 2 && b.r.y + b.r.h > r.y + 2 && xs.some((x) => x > r.x + 1.5 && x < r.x + r.w - 1.5);
        if (through) { issues.push({ what: '括号的线穿过了字', a: `括号下的字「${t.textContent.trim()}」`, b: '', area: 0 }); break; }
      }
    }
  }
  // 缩得太小：整台缩到字难认（舞台自己记在 scene.tiny，和现状里那一行同一个判断）
  // 横屏的解析栏（主线第六轮 Task 10）：栏压着画面里的东西；栏里看得见的字小于 17px；这一问被挤出栏外看不见；挪到画面底部的宽输入压着东西
  if (st.sideOn) {
    const sb = rect(st.side);
    const objs = items.filter((it) => it.kind === 'obj');
    const hitObj = (b) => objs.find((o) => o.rects.some((r) => { const w = Math.min(b.x + b.w, r.x + r.w) - Math.max(b.x, r.x), h = Math.min(b.y + b.h, r.y + r.h) - Math.max(b.y, r.y); return w > 0 && h > 0 && w * h > 24; }));
    const o1 = hitObj(sb);
    if (o1) issues.push({ what: '解析栏压着画面', a: `obj:${o1.id}`, b: '', area: 0 });
    for (const n of st.side.querySelectorAll('.st-line:not(.is-out), .st-how, .st-goal')) {
      if (!vis(n)) continue;
      const r = n.getBoundingClientRect(), c = st.caption.getBoundingClientRect();
      if (n.closest('.st-caption') && (r.bottom < c.top || r.top > c.bottom)) continue; // 滑出栏外的那几句不算
      const px = parseFloat(getComputedStyle(n).fontSize);
      if (px < 15 || (px < 17 && !n.classList.contains('st-how'))) { issues.push({ what: '栏里的字太小', a: `${n.className.split(' ')[0]}（${px}px）`, b: '', area: 0 }); break; }
    }
    const q = [...st.caption.querySelectorAll('.st-line:not(.is-out)[data-kind="ask"]')].at(-1);
    if (q) { const r = q.getBoundingClientRect(), c = st.caption.getBoundingClientRect(); if (r.bottom > c.bottom + 2 || r.top < c.top - 2) issues.push({ what: '这一问看不见', a: '这一问在栏外面（被滑走了）', b: '', area: 0 }); }
    if (!st.wideDock.hidden && st.dock.childElementCount) { const o2 = hitObj(rect(st.wideDock.firstElementChild || st.wideDock)); if (o2) issues.push({ what: '宽输入压着东西', a: `obj:${o2.id}`, b: '', area: 0 }); }
  }
  if (st.scene.tiny != null) issues.push({ what: '缩得太小', a: `整台缩到了 ${st.scene.tiny} 成`, b: '', area: 0 });
  for (const x of issues) { x.an = nameOf(x.a, items); x.bn = x.b ? nameOf(x.b, items) : ''; }
  return { issues, cam: st.cam, items };
}
