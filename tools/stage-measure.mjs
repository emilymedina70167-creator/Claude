// 舞台画面的量法（tools/stage-audit.mjs 排版检查、tools/stage-try.mjs 试演共用）：在页面里量每一样东西实际占的地方，
// 报出压在一起的、跑出屏幕的、画到自己地方外面的。函数要整个塞进页面跑（page.evaluate / toString），所以不能用外面的变量。
// —— 在页面里量：每一样东西的框、贴的字、话、挑战、底下一条、拨数器，两两比 ——
export function measure(visual = false) {
  const st = window.LAStage;
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
  st.caption.querySelectorAll('.st-line:not(.is-out)').forEach((n, i) => { if (vis(n)) items.push({ kind: 'caption', id: `话${i + 1}`, rects: [textRect(n, vr)] }); });
  st.goalsEl.querySelectorAll('.st-goal:not(.is-out)').forEach((n, i) => { if (vis(n)) items.push({ kind: 'goal', id: n.dataset.id || `挑战${i + 1}`, rects: [rect(n)] }); });
  [...st.dock.children].forEach((n, i) => { if (vis(n)) items.push({ kind: 'dock', id: `底下${i + 1}`, rects: [rect(n)] }); });
  st.view.querySelectorAll('.mx-step').forEach((n) => { if (vis(n)) items.push({ kind: 'pop', id: '拨数器', rects: [rect(n)] }); });
  // 话的一行占的是字，不是整行宽
  function textRect(n, vr) {
    const r = document.createRange(); r.selectNodeContents(n);
    const rs = [...r.getClientRects()].map((q) => ({ x: q.left - vr.left, y: q.top - vr.top, w: q.width, h: q.height }));
    return union(rs) || rect(n);
  }
  const issues = [];
  const hitArea = (a, b) => { const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); return w > 2 && h > 2 ? w * h : 0; };
  const pairHit = (A, B) => { let best = 0; for (const a of A.rects) for (const b of B.rects) best = Math.max(best, hitArea(a, b)); return best; };
  const tied = (a, b) => { const o = st.scene.objects.get(a.id), p = st.scene.objects.get(b.id); const ta = o && st.scene.type(o).anchors?.(o) || [], tb = p && st.scene.type(p).anchors?.(p) || []; return ta.includes(b.id) || tb.includes(a.id); };
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.kind === 'obj' && b.kind === 'obj' && tied(a, b)) continue;
    if (a.kind === 'dock' && b.kind === 'dock') continue;
    if (a.kind === 'caption' && b.kind === 'caption') continue;
    if (a.kind === 'goal' && b.kind === 'goal') continue;
    const area = pairHit(a, b);
    if (area > 24) issues.push({ what: '压着', a: `${a.kind}:${a.id}`, b: `${b.kind}:${b.id}`, area: Math.round(area) });
  }
  const vw = st.view.clientWidth, vh = st.view.clientHeight;
  for (const it of items) for (const r of it.rects) {
    if (r.x < -2 || r.y < -2 || r.x + r.w > vw + 2 || r.y + r.h > vh + 2) { issues.push({ what: '出了屏幕', a: `${it.kind}:${it.id}`, b: '', area: 0, r: [r.x, r.y, r.w, r.h].map(Math.round) }); break; }
  }
  // 画到了自己的地方外面：objectBox 报小了（别的东西会被摆上来压着）
  for (const it of items) if (!visual && it.kind === 'obj' && it.union) {
    const u = it.union, b = it.box, s = st.cam.s;
    const out = Math.max(b.x - u.x, b.y - u.y, u.x + u.w - (b.x + b.w), u.y + u.h - (b.y + b.h));
    if (out > 6 * s) issues.push({ what: '画到了自己的地方外面', a: `obj:${it.id}`, b: '', area: Math.round(out / s) });
  }
  return { issues, cam: st.cam };
}
