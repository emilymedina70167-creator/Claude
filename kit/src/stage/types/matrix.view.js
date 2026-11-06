// 矩阵的画法（types/matrix.js 的画面那一半）：括号、一格格的数（分数上下叠）、增广的竖线、主元的框、阶梯线、乘积前面的「=」；
// 专门的动作：行变换（副本乘上系数飘到目标行上面再加进去、交换两行走弧线、一行乘倍数）、改一个数、
// 乘法的一格（A 的一行和 B 的一列一起亮，逐对相乘排成一条算式，加出来的数飞进那一格）。
import { EASE, moveDuration, stagger, arcPoints } from '../motion.js';
import { MX, layout, stairsPoints, zeroRows, toQ, eqWidth } from './matrix.js';
import { Q } from '../../exact.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
const SUBS = '₀₁₂₃₄₅₆₇₈₉';
const sub = (n) => String(n).replace(/\d/g, (d) => SUBS[d]);
const work = new WeakMap(); // 舞台 → 乘法那条还没淡完的算式

// 样式只放一次（舞台的 stage.css 之外的）
function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('st-css-matrix')) return;
  const s = document.createElement('style');
  s.id = 'st-css-matrix';
  s.textContent = matrixView.css;
  document.head.appendChild(s);
}

/** 一个数画进去：分数上下叠（分子、横线、分母），负号用真的减号；paren：负数加括号（乘式里的第二个数） */
export function setNum(span, v, { paren = false } = {}) {
  span.replaceChildren();
  const s = String(v ?? '');
  const neg = s.startsWith('-');
  const m = s.match(/^(-?)(\d+)\/(\d+)$/);
  const open = paren && neg;
  if (open) span.appendChild(document.createTextNode('('));
  if (!m) span.appendChild(document.createTextNode(s.replace(/^-/, '−')));
  else {
    if (m[1]) el('span', 'mx-neg', span).textContent = '−';
    const f = el('span', 'mx-frac', span);
    el('span', 'mx-num', f).textContent = m[2];
    el('span', 'mx-den', f).textContent = m[3];
  }
  if (open) span.appendChild(document.createTextNode(')'));
}
const paren = (s) => { const t = String(s).replace(/-/g, '−'); return s.startsWith('-') || s.includes('/') ? `(${t})` : t; };
// 一行乘的倍数写在牌子上：÷3、÷(−3)、×(−2)、×(2/3)
const scaleText = (a) => { const m = /^(-?)1\/(\d+)$/.exec(a); return m ? `÷${m[1] ? `(−${m[2]})` : m[2]}` : `×${paren(a)}`; };

// 括号画成一弯「月牙」（中间粗、两头尖，像排版出来的括号），高 h；右括号左右翻过来
export function bracketPath(h, side) {
  const W = 11, t = 2.8, r = (v) => Math.round(v * 10) / 10;
  const pts = [[W, 0], [W * 0.16, h * 0.1], [0, h * 0.28], [0, h / 2], [0, h * 0.72], [W * 0.16, h * 0.9], [W, h], [W * 0.16 + t * 0.7, h * 0.87], [t, h * 0.7], [t, h / 2], [t, h * 0.3], [W * 0.16 + t * 0.7, h * 0.13], [W, 0]];
  const p = pts.map(([x, y]) => [r(side === 'r' ? W - x : x), r(y)]);
  const at = (k) => `${p[k][0]} ${p[k][1]}`;
  return `M${at(0)}C${at(1)} ${at(2)} ${at(3)}C${at(4)} ${at(5)} ${at(6)}C${at(7)} ${at(8)} ${at(9)}C${at(10)} ${at(11)} ${at(12)}Z`;
}

// 把一个节点（括号、竖线、「=」）摆到新的地方：新的直接放，挪了的滑过去。括号是 SVG（高变了换形状），别的是 HTML（高变了改 height）
function put(stage, n, box, ctx, entering) {
  const was = n.__box;
  n.__box = box;
  const svgNode = n instanceof SVGElement;
  if (svgNode && box.h != null && was?.h !== box.h) n.setAttribute('d', bracketPath(box.h, n.__side));
  if (!was || stage.instant) {
    n.style.transform = tr(box.x, box.y);
    if (box.h != null && !svgNode) n.style.height = `${box.h}px`;
    if (entering && !was) n.style.opacity = '0';
    return;
  }
  if (same(was, box) && was.h === box.h) return;
  const frames = [{ transform: tr(was.x, was.y) }, { transform: tr(box.x, box.y) }];
  if (box.h != null && !svgNode) { frames[0].height = `${was.h}px`; frames[1].height = `${box.h}px`; }
  ctx.jobs.push(stage.tween(n, frames, { duration: moveDuration(Math.abs(was.x - box.x) + Math.abs(was.y - box.y) + Math.abs((was.h || 0) - (box.h || 0))), easing: EASE.move }));
}
function bracket(stage, side) {
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('class', 'mx-brk');
  p.__side = side;
  stage.under.appendChild(p);
  return p;
}

const nodeAt = (stage, obj, key) => stage.nodes.get(`${obj}:${key}`);

// 一格的数换成新的：缩一下、换字、弹回来（和一排格子的 write 一样）
async function flip(stage, n, box, v, { delay = 0, f = 1 } = {}) {
  if (!n || !box) return;
  const t = tr(box.x, box.y);
  await stage.tween(n, [{ transform: t, opacity: 1 }, { transform: `${t} scale(0.78)`, opacity: 0.3 }], { duration: 150 * f, delay, easing: EASE.in });
  setNum(n.firstChild, v);
  n.__val = v;
  if (v !== '') n.classList.remove('is-blank');
  await stage.tween(n, [{ transform: `${t} scale(0.78)`, opacity: 0.3 }, { transform: t, opacity: 1 }], { duration: 320 * f, easing: EASE.spring });
}

// 浮起来的一份副本（行变换时那一行的副本、乘法里飞过去的数）
function ghost(stage, box, v, cls = '') {
  const g = el('div', `mx-ghost${cls ? ` ${cls}` : ''}`, stage.layer);
  g.style.width = `${box.w}px`;
  setNum(el('span', 'mx-v', g), v);
  g.style.transform = tr(box.x, box.y);
  return g;
}

// 系数的小牌子（×(−3)、÷3）：贴在一行的左边（一列就贴在上面）
async function badge(stage, text, boxes, line, f = 1) {
  const b = el('div', 'mx-coef', stage.layer);
  b.textContent = text;
  const w = b.offsetWidth || 64, h = b.offsetHeight || 32;
  const first = boxes[0];
  const at = line === 'r' ? { x: first.x - w - 14, y: first.y + MX.CH / 2 - h / 2 } : { x: first.x + first.w / 2 - w / 2, y: first.y - h - 12 };
  b.style.transform = tr(at.x, at.y);
  await stage.tween(b, [{ opacity: 0, transform: `${tr(at.x, at.y)} scale(0.6)` }, { opacity: 1, transform: tr(at.x, at.y) }], { duration: 280 * f, easing: EASE.spring });
  return () => stage.tween(b, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 * f }).then(() => b.remove());
}

function lineNodes(stage, o, keys) {
  const ns = (keys || []).map((k) => nodeAt(stage, o.id, k));
  return ns.every((n) => n?.__box) ? ns : null;
}

// 一行乘倍数：牌子冒出来，这一行的数一个个换成新的（f < 1 演得快一点：连着的第二步、第三步）
async function scaleLine(stage, o, op, vals, f = 1) {
  const T = lineNodes(stage, o, op.keys);
  if (!T) return;
  const TB = T.map((n) => ({ ...n.__box }));
  T.forEach((n) => n.classList.add('is-target'));
  const off = await badge(stage, scaleText(op.a), TB, op.line, f);
  await stage.wait(120 * f);
  await Promise.all(T.map((n, k) => flip(stage, n, TB[k], vals[k], { delay: stagger(k, { step: 60 * f }), f })));
  off();
  if (op.kind === 'scale') T.forEach((n) => n.classList.remove('is-target'));
}

// 加上另一行的倍数：那一行的副本抬起来、乘上系数、飘到目标行上面，再落进去，目标行换成新的数
async function addLine(stage, o, op, f = 1) {
  const T = lineNodes(stage, o, op.keys), S = lineNodes(stage, o, op.src);
  if (!T || !S) return;
  const D = (ms) => ms * f;
  const TB = T.map((n) => ({ ...n.__box })), SB = S.map((n) => ({ ...n.__box }));
  T.forEach((n) => n.classList.add('is-target'));
  S.forEach((n) => n.classList.add('is-source'));
  try {
    if (op.kind === 'comb') await scaleLine(stage, o, op, op.mid, f);
    const up = (b) => ({ ...b, y: b.y - 10 });
    const G = SB.map((b, k) => ghost(stage, b, op.srcVals[k]));
    await Promise.all(G.map((g, k) => stage.tween(g, [{ opacity: 0, transform: tr(SB[k].x, SB[k].y) }, { opacity: 1, transform: tr(SB[k].x, SB[k].y - 10) }], { duration: D(300), delay: stagger(k, { step: D(40) }), easing: EASE.out })));
    if (op.b !== '1') {
      const off = await badge(stage, `×${paren(op.b)}`, SB.map(up), op.line, f);
      await Promise.all(G.map(async (g, k) => {
        const b = up(SB[k]);
        await stage.tween(g, [{ transform: tr(b.x, b.y) }, { transform: `${tr(b.x, b.y)} scale(0.8)`, opacity: 0.4 }], { duration: D(150), delay: stagger(k, { step: D(70) }) + D(80), easing: EASE.in });
        setNum(g.firstChild, op.scaled[k]);
        await stage.tween(g, [{ transform: `${tr(b.x, b.y)} scale(0.8)`, opacity: 0.4 }, { transform: tr(b.x, b.y), opacity: 1 }], { duration: D(320), easing: EASE.spring });
      }));
      await stage.wait(D(160));
      off();
    }
    // 飘过去：停在目标行上面一点（压着它），看得出「要加进去了」
    const hover = (b) => ({ ...b, y: b.y - 18 });
    const dist = Math.hypot(TB[0].x - SB[0].x, TB[0].y - SB[0].y);
    await Promise.all(G.map((g, k) => {
      const a = up(SB[k]), z = hover(TB[k]);
      const dir = op.line === 'r' ? (z.y > a.y ? -1 : 1) : -1;
      return stage.tween(g, arcPoints(a, z, { dir, lift: 0.14, min: 6, max: 26 }).map((p) => ({ transform: tr(p.x, p.y), offset: p.t })), { duration: D(moveDuration(dist) + 140), delay: stagger(k, { step: D(35) }), easing: EASE.move });
    }));
    await stage.wait(D(140));
    await Promise.all(G.map(async (g, k) => {
      const z = hover(TB[k]), d = stagger(k, { step: D(60) });
      await Promise.all([
        stage.tween(g, [{ opacity: 1, transform: tr(z.x, z.y) }, { opacity: 0, transform: `${tr(TB[k].x, TB[k].y)} scale(0.7)` }], { duration: D(280), delay: d, easing: EASE.in }).then(() => g.remove()),
        flip(stage, T[k], TB[k], op.after[k], { delay: d + D(150), f }),
      ]);
    }));
  } finally {
    T.forEach((n) => n.classList.remove('is-target'));
    S.forEach((n) => n.classList.remove('is-source'));
  }
}

// 交换两行（两列）：一行从前面绕过去（浮起来、在上面一层），一行从后面绕过去，换到对方的位置
async function swapLine(stage, o, op, f = 1) {
  const L = layout(o);
  const sc = stage.scene;
  const go = (keys, to, dir, front) => keys.map((k, i) => {
    const p = sc.partOf(o.id, k), n = p && stage.nodeOf(p);
    if (!n?.__box) return null;
    n.classList.add(front ? 'is-front' : 'is-back');
    const from = { ...n.__box };
    const r = op.line === 'r' ? to : p.r, c = op.line === 'c' ? to : p.c;
    const dest = { x: L.colX[c], y: L.rowY(r), w: L.cw[c], h: MX.CH };
    const d = (moveDuration(Math.hypot(from.x - dest.x, from.y - dest.y)) + 200) * f;
    const s = front ? 0.1 : -0.06; // 前面那一行在半路大一点、后面那一行小一点：看得出谁在上面
    return stage.moveNode(p, arcPoints(from, dest, { dir, lift: 0.34, min: 26, max: 70 }).map((q) => ({ transform: tr(q.x, q.y, 1 + s * 4 * q.t * (1 - q.t)), offset: q.t })), dest, { duration: d, delay: stagger(i, { step: 40 * f }) })
      .then(() => n.classList.remove('is-front', 'is-back'));
  });
  await Promise.all([...go(op.keys, op.j, -1, true), ...go(op.other, op.i, op.line === 'r' ? -1 : 1, false)]);
}

// 乘法的一格：A 的这一行、B 的这一列一起亮；一对一对的数飞下来排成算式；加出来的数飞进那一格
async function mulOne(stage, fx, it, f) {
  const C = stage.scene.objects.get(fx.id);
  const cn = nodeAt(stage, fx.id, it.key);
  const rowN = it.terms.map((t) => nodeAt(stage, fx.a, t.a)), colN = it.terms.map((t) => nodeAt(stage, fx.b, t.b));
  if (!C || !cn?.__box || rowN.some((n) => !n?.__box) || colN.some((n) => !n?.__box)) return;
  const D = (ms) => ms * f;
  rowN.forEach((n) => n.classList.add('is-mrow'));
  colN.forEach((n) => n.classList.add('is-mcol'));
  cn.classList.add('is-target');
  work.get(stage)?.remove();
  // 算式先整条排好、藏着（量好每个数在哪），再一项一项亮出来：c₁₂ = 1×5 + 2×7 = 19
  const line = el('div', 'mx-work', stage.layer);
  work.set(stage, line);
  const name = /^[A-Z]$/.test(C.id) ? C.id.toLowerCase() : C.id;
  el('span', 'mx-w-head', line).textContent = `${name}${sub(it.r)}${sub(it.c)} =`;
  const slots = it.terms.map((t, k) => {
    const plus = k ? el('span', 'mx-w-op', line) : null;
    if (plus) plus.textContent = '+';
    const a = el('span', 'mx-w-n', line);
    setNum(a, t.av, { paren: k > 0 });
    const x = el('span', 'mx-w-x', line);
    x.textContent = '×';
    const b = el('span', 'mx-w-n', line);
    setNum(b, t.bv, { paren: true });
    return { plus, a, x, b };
  });
  const eq = el('span', 'mx-w-op', line);
  eq.textContent = '=';
  const res = el('span', 'mx-w-n mx-w-res', line);
  setNum(res, it.sum);
  [...line.children].slice(1).forEach((s) => { s.style.opacity = '0'; });
  // 写在整排（A B = C）下面的正中（照现在 A、B、C 在哪算）
  const w = line.offsetWidth || 200;
  const row = [fx.a, fx.b, fx.id].map((id) => stage.scene.objects.get(id)).filter(Boolean).map((m) => layout(m).box);
  const left = Math.min(...row.map((b) => b.x)), right = Math.max(...row.map((b) => b.x + b.w)), bottom = Math.max(...row.map((b) => b.y + b.h));
  const at = { x: Math.round((left + right) / 2 - w / 2), y: bottom + 14 };
  line.style.transform = tr(at.x, at.y);
  await stage.tween(line, [{ opacity: 0, transform: tr(at.x, at.y + 8) }, { opacity: 1, transform: tr(at.x, at.y) }], { duration: D(260), easing: EASE.out });
  // 一个数从格子里飞到算式里它的位置（缩到算式的字号）
  const fly = (n, v, span, ms, dir) => {
    const b = n.__box;
    const g = ghost(stage, b, v, 'is-fly');
    const cx = at.x + span.offsetLeft + span.offsetWidth / 2, cy = at.y + span.offsetTop + span.offsetHeight / 2;
    const z = { x: cx - b.w / 2, y: cy - MX.CH / 2 };
    const pts = arcPoints(b, z, { dir, lift: 0.2, min: 12, max: 60 });
    return stage.tween(g, pts.map((p) => ({ transform: tr(p.x, p.y, 1 - 0.26 * p.t), offset: p.t })), { duration: ms, easing: EASE.move }).then(() => { span.style.opacity = ''; g.remove(); });
  };
  for (let k = 0; k < it.terms.length; k++) {
    const t = it.terms[k], s = slots[k];
    rowN[k].classList.add('is-pair');
    colN[k].classList.add('is-pair');
    if (s.plus) stage.tween(s.plus, [{ opacity: 0 }, { opacity: 1 }], { duration: D(200) });
    await Promise.all([fly(rowN[k], t.av, s.a, D(620), -1), fly(colN[k], t.bv, s.b, D(620), 1)]);
    await stage.tween(s.x, [{ opacity: 0 }, { opacity: 1 }], { duration: D(160) });
    rowN[k].classList.remove('is-pair');
    colN[k].classList.remove('is-pair');
    await stage.wait(D(120));
  }
  await stage.tween(eq, [{ opacity: 0 }, { opacity: 1 }], { duration: D(180) });
  await stage.tween(res, [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }], { duration: D(320), easing: EASE.spring });
  // 结果飞进那一格
  const rb = { x: at.x + res.offsetLeft + res.offsetWidth / 2 - cn.__box.w / 2, y: at.y + res.offsetTop + res.offsetHeight / 2 - MX.CH / 2, w: cn.__box.w };
  const g = ghost(stage, rb, it.sum, 'is-fly is-res');
  await stage.tween(g, arcPoints(rb, cn.__box, { dir: -1, lift: 0.25, min: 16, max: 50 }).map((p) => ({ transform: tr(p.x, p.y, 0.74 + 0.26 * p.t), offset: p.t })), { duration: D(560), easing: EASE.move });
  g.remove();
  await flip(stage, cn, cn.__box, it.sum, { f });
  rowN.forEach((n) => n.classList.remove('is-mrow'));
  colN.forEach((n) => n.classList.remove('is-mcol'));
  cn.classList.remove('is-target');
  // 算式留一会儿给学生看，再淡掉（下一格开始时马上收掉）
  stage.tween(line, [{ opacity: 1 }, { opacity: 0 }], { duration: 400, delay: D(1600) }).then(() => { line.remove(); if (work.get(stage) === line) work.delete(stage); });
}

/**
 * 拨数器：点开放的一格，格子上方浮出「− 数 +」（屏幕上的一层，按钮够 44px，不跟着镜头缩小）；拨一下写一下（学生的 write），
 * 乘积跟着当场重算、闪一下。点别处收起。格子、数都按 key 现取（重放以后场景是新的）
 */
function editAfford(stage, o, e, done) {
  const id = o.id;
  const keys = (e.refs.length ? e.refs.flatMap((r) => stage.scene.parts(r)) : o.cells).map((x) => x.key);
  const nodeOf = (k) => stage.nodes.get(`${id}:${k}`);
  const live = (k) => stage.scene.partOf(id, k);
  let pop = null, cur = null, busy = false;
  const close = () => { pop?.remove(); pop = null; if (cur != null) nodeOf(cur)?.classList.remove('is-editing'); cur = null; };
  // 拨数器放哪：矩阵下沿下面对着这一列 → 矩阵上面 → 右边 → 左边，挑第一个不压着别的东西、话、挑战、底下一条、也不出屏幕的；
  // 都压着就挑压得最少的（以前只看下面放不放得下，下面有 BA 那一排时就压在 BA 上）
  const place = () => {
    const n = cur != null && nodeOf(cur);
    const m = stage.scene.objects.get(id);
    if (!pop || !n?.__box || !m) return;
    const b = n.__box, L = layout(m).box;
    const w = pop.offsetWidth, h = pop.offsetHeight, vw = stage.view.clientWidth || 800, vh = stage.view.clientHeight || 800;
    const S = (p) => stage.toScreen(p);
    const colX = S({ x: b.x + b.w / 2, y: 0 }).x;
    const cands = [
      { x: colX - w / 2, y: S({ x: 0, y: L.y + L.h }).y + 10 },
      { x: colX - w / 2, y: S({ x: 0, y: L.y }).y - h - 10 },
      { x: S({ x: L.x + L.w, y: 0 }).x + 12, y: S({ x: 0, y: b.y + b.h / 2 }).y - h / 2 },
      { x: S({ x: L.x, y: 0 }).x - w - 12, y: S({ x: 0, y: b.y + b.h / 2 }).y - h / 2 },
    ];
    const blocks = stage.screenBlocks(id);
    const cost = (c) => {
      const r = { x: c.x, y: c.y, w, h };
      let k = 0;
      if (r.x < 8 || r.y < 8 || r.x + w > vw - 8 || r.y + h > vh - 8) k += 1e6;
      for (const q of blocks) { const ox = Math.min(r.x + w, q.x + q.w) - Math.max(r.x, q.x), oy = Math.min(r.y + h, q.y + q.h) - Math.max(r.y, q.y); if (ox > 0 && oy > 0) k += ox * oy; }
      return k;
    };
    let best = cands[0], bc = Infinity;
    for (const c of cands) { const k = cost(c); if (k < bc) { bc = k; best = c; } if (!k) break; }
    const x = Math.max(8, Math.min(vw - w - 8, best.x)), y = Math.max(8, Math.min(vh - h - 8, best.y));
    pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const paint = () => {
    const x = cur != null && live(cur);
    if (!pop || !x) { close(); return; }
    const q = toQ(x.value);
    pop.querySelector('.mx-step-v').textContent = x.value === '' ? '?' : String(x.value).replace('-', '−');
    pop.querySelector('.mx-step-dec').disabled = !!q && q.toNumber() <= e.lo;
    pop.querySelector('.mx-step-inc').disabled = !!q && q.toNumber() >= e.hi;
    place();
  };
  const step = async (d) => {
    const x = cur != null && live(cur);
    if (!x || busy) return;
    const q = toQ(x.value) || new Q(0n);
    let nv = q.add(Q.from(d));
    if (nv.toNumber() < e.lo) nv = Q.from(e.lo);
    if (nv.toNumber() > e.hi) nv = Q.from(e.hi);
    if (nv.toString() === x.value) return;
    const ref = `${id}.${x.r},${x.c}`;
    busy = true;
    try { await done({ type: 'edit', ref, from: x.value, to: nv.toString() }, `write ${ref} ${nv.toString()}`); } finally { busy = false; }
    paint();
  };
  const openFor = (k) => {
    if (cur === k) return;
    close();
    cur = k;
    nodeOf(k)?.classList.add('is-editing');
    pop = el('div', 'mx-step', stage.view);
    const dec = el('button', 'mx-step-b mx-step-dec', pop); dec.type = 'button'; dec.textContent = '−'; dec.setAttribute('aria-label', '小一点');
    el('span', 'mx-step-v', pop);
    const inc = el('button', 'mx-step-b mx-step-inc', pop); inc.type = 'button'; inc.textContent = '+'; inc.setAttribute('aria-label', '大一点');
    dec.addEventListener('click', () => step(-1));
    inc.addEventListener('click', () => step(1));
    paint();
    stage.tween(pop, [{ opacity: 0, scale: '.85' }, { opacity: 1, scale: '1' }], { duration: 240, easing: EASE.spring });
  };
  // 点一格：走舞台的 pointer.js（按偏一点也拿得到，和能拖的不打架）
  const offs = keys.map((k) => { const off = stage.armPress(`${id}:${k}`, () => openFor(k), { cls: 'is-editable' }); return () => { off(); nodeOf(k)?.classList.remove('is-editing'); }; });
  const away = (ev) => { if (pop && !ev.target.closest?.('.mx-step, .mx-cell.is-editable')) close(); };
  stage.view.addEventListener('pointerdown', away);
  return () => { offs.forEach((f) => f()); close(); stage.view.removeEventListener('pointerdown', away); };
}

/** 点乘积的一格：当场演这一格怎么一行乘一列算出来（还空着的就当场算上，学生的 mul）；演着的时候再点不理 */
function explainAfford(stage, o, e, done) {
  const id = o.id;
  let busy = false;
  const keys = (e.refs.length ? e.refs.flatMap((r) => stage.scene.parts(r)) : o.cells).map((x) => x.key);
  const offs = keys.map((k) => stage.armPress(`${id}:${k}`, async () => {
    const x = stage.scene.partOf(id, k);
    if (busy || !x) return;
    busy = true;
    const ref = `${id}.${x.r},${x.c}`;
    try { await done({ type: 'explain', ref, value: x.value }, `mul ${ref}`); } finally { busy = false; }
  }, { cls: 'is-explain' }));
  return () => offs.forEach((f) => f());
}

export const matrixView = {
  affords: { edit: editAfford, explain: explainAfford },
  sync(stage, o, ctx) {
    ensureCss();
    const L = layout(o);
    const entering = ctx.entering === o.id;
    const zero = o.stairs ? new Set(zeroRows(o)) : new Set();
    const moves = [];
    for (const x of o.cells) {
      const b = { x: L.colX[x.c], y: L.rowY(x.r), w: L.cw[x.c], h: MX.CH };
      const n = stage.partNode(x, () => {
        const n = el('div', 'mx-cell', stage.layer);
        el('span', 'mx-v', n);
        el('i', 'mx-ring', n);
        n.style.transform = tr(b.x, b.y);
        n.style.width = `${b.w}px`;
        n.__box = b;
        n.__val = null;
        if (entering) n.style.opacity = '0';
        return n;
      });
      // 专门的动作没演到的（重放、学生拨了数……）：直接换成场景里的数
      if (n.__val !== x.value) { setNum(n.firstChild, x.value); n.__val = x.value; }
      n.classList.toggle('is-blank', x.value === '');
      n.classList.toggle('is-pivot', !!x.pivot);
      n.classList.toggle('is-zero', zero.has(x.r));
      stage.flagPart(n, x, ctx);
      if (Math.abs((n.__box?.w ?? 0) - b.w) > 0.5) { n.style.width = `${b.w}px`; n.__box = { ...n.__box, w: b.w }; }
      if (!same(n.__box, b) && (!ctx.only || ctx.only.includes(x))) moves.push({ part: x, node: n, from: n.__box, to: b, order: x.r + x.c });
    }
    // 括号：两道弯的竖线（左右各一个），矩阵变宽了跟着滑开
    const box = L.box;
    put(stage, stage.decor(o.id, 'bl', () => bracket(stage, 'l')), { x: box.x + 4, y: box.y, h: box.h }, ctx, entering);
    put(stage, stage.decor(o.id, 'br', () => bracket(stage, 'r')), { x: box.x + box.w - 15, y: box.y, h: box.h }, ctx, entering);
    if (o.aug) put(stage, stage.decor(o.id, 'bar', () => el('div', 'mx-bar', stage.layer)), { x: L.barX, y: box.y + 8, h: box.h - 16 }, ctx, entering);
    if (o.product) {
      const eq = stage.decor(o.id, 'eq', () => { const n = el('div', 'mx-eq', stage.layer); n.textContent = '='; return n; });
      // 另起一行的乘积（A、B 已经排在别的乘积里）：前面写上是谁乘谁
      const pre = o.prefix ? `${o.prefix} =` : '=';
      if (eq.textContent !== pre) { eq.textContent = pre; eq.classList.toggle('is-named', !!o.prefix); }
      put(stage, eq, { x: box.x - eqWidth(o), y: box.y + box.h / 2 - 22 }, ctx, entering);
    }
    // 阶梯线：每个非零行的主元左边竖下来，沿这一行下沿走到下一个主元
    const pts = o.stairs ? stairsPoints(o) : null;
    if (pts) {
      const fresh = !stage.decor(o.id, 'stairs');
      const p = stage.decor(o.id, 'stairs', () => { const s = document.createElementNS(SVGNS, 'path'); s.setAttribute('class', 'mx-stairs'); stage.under.appendChild(s); return s; });
      const d = pts.map((q, i) => `${i ? 'L' : 'M'}${Math.round(q.x * 10) / 10} ${Math.round(q.y * 10) / 10}`).join('');
      p.setAttribute('d', d);
      if (fresh && !stage.instant) {
        const len = p.getTotalLength?.() || 400;
        p.style.strokeDasharray = `${len}`;
        ctx.jobs.push(stage.tween(p, [{ strokeDashoffset: `${len}` }, { strokeDashoffset: '0' }], { duration: 700, easing: EASE.out }).then(() => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }));
      }
    }
    stage.dropDecor(o.id, (k) => (k === 'stairs' && !pts) || (k === 'bar' && !o.aug) || (k === 'eq' && !o.product));
    return moves;
  },

  // 括号先淡进来，数一个个落下（从左上往右下）
  async enter(stage, o) {
    const ds = ['bl', 'br', 'bar', 'eq'].map((k) => stage.decor(o.id, k)).filter(Boolean);
    ds.forEach((d, i) => stage.tween(d, [{ opacity: 0 }, { opacity: 1 }], { duration: 380, delay: i * 50, easing: EASE.out }));
    await Promise.all(o.cells.map((x) => {
      const n = stage.nodeOf(x), b = n?.__box;
      if (!b) return null;
      return stage.tween(n, [{ opacity: 0, transform: tr(b.x, b.y + 14) }, { opacity: 1, transform: tr(b.x, b.y) }], { duration: 440, delay: stagger(x.r + x.c - 2, { step: 45, max: 500 }), easing: EASE.out });
    }));
  },

  choreo: {
    async rowop(stage, c, fx) {
      if (stage.instant) return;
      const o = stage.scene.objects.get(fx.id);
      // 数要变了：阶梯线先收掉；这一步的写法（r₂ − 3r₁）先贴出来，镜头跟着把它框进来，学生边看边对
      stage.dropDecor(o.id, (k) => k === 'stairs');
      stage.syncLabels().then(() => stage.keepInView());
      // 连着的几步一步一步演（同一行的副本叠在一起看不清），后面的演快一点
      for (let k = 0; k < fx.ops.length; k++) {
        const op = fx.ops[k], f = k ? 0.7 : 1;
        if (op.kind === 'swap') await swapLine(stage, o, op, f);
        else if (op.kind === 'scale') await scaleLine(stage, o, op, op.after, f);
        else await addLine(stage, o, op, f);
      }
    },
    async write(stage, c, fx) {
      const n = stage.nodeOf(fx.cell);
      if (!n?.__box || stage.instant) return;
      await flip(stage, n, n.__box, fx.cell.value);
    },
    async mul(stage, c, fx) {
      if (stage.instant) return;
      for (let k = 0; k < fx.items.length; k++) await mulOne(stage, fx, fx.items[k], k ? 0.55 : 1);
    },
  },

  css: `
.mx-cell { position: absolute; left: 0; top: 0; height: 52px; display: grid; place-items: center; border-radius: 12px; color: var(--st-ink);
  transition: background-color .35s, box-shadow .35s, opacity .35s, color .35s, width .3s; will-change: transform; }
.mx-v { display: inline-flex; align-items: center; gap: 1px; font: 500 26px/1 var(--sans, -apple-system, sans-serif); font-variant-numeric: tabular-nums; letter-spacing: -.01em; white-space: nowrap; }
.mx-frac { display: inline-grid; justify-items: center; font-size: 19px; line-height: 1.08; }
.mx-num { padding: 0 3px 2px; border-bottom: 1.6px solid currentColor; }
.mx-den { padding: 2px 3px 0; }
.mx-neg { margin-right: 1px; }
.mx-cell[data-paint] { background: color-mix(in srgb, var(--c) 15%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--c) 60%, transparent); }
.mx-cell.is-glow { box-shadow: 0 0 0 2.5px var(--st-gold), 0 0 0 7px color-mix(in srgb, var(--st-gold) 20%, transparent); }
.mx-cell.is-lift { box-shadow: 0 0 0 1px var(--st-line), 0 14px 22px -14px rgb(var(--shade-rgb, 25 45 40) / 0.5); background: var(--st-card); }
.mx-cell.is-dim, .mx-cell.is-zero { opacity: .32; }
.mx-cell.is-moving { z-index: 3; }
.mx-cell.is-front, .mx-cell.is-back { background: var(--st-card); box-shadow: 0 0 0 1px var(--st-line), 0 12px 22px -12px rgb(var(--shade-rgb, 25 45 40) / 0.5); }
.mx-cell.is-front { z-index: 5; }
.mx-cell.is-back { z-index: 4; opacity: .85; }
.mx-cell::after { content: ""; position: absolute; inset: 4px 2px; border-radius: 11px; border: 2.2px solid var(--st-brand); opacity: 0; transform: scale(1.35); transition: opacity .3s, transform .45s cubic-bezier(.34,1.45,.64,1); pointer-events: none; }
.mx-cell.is-pivot::after { opacity: 1; transform: scale(1); }
.mx-cell.is-blank::before { content: ""; position: absolute; inset: 8px 10px; border-radius: 9px; border: 1.5px dashed rgb(var(--chalk-rgb, 27 34 32) / 0.28); }
.mx-cell.is-covered .mx-v { visibility: hidden; }
.mx-cell.is-covered::before { content: "?"; position: absolute; inset: 6px 4px; display: grid; place-items: center; border-radius: 10px; background: color-mix(in srgb, var(--st-brand) 12%, var(--st-card)); color: color-mix(in srgb, var(--st-brand) 60%, transparent); font: 600 22px/1 var(--sans, sans-serif); }
.mx-cell.is-target { background: color-mix(in srgb, var(--st-gold) 13%, transparent); }
.mx-cell.is-source { background: color-mix(in srgb, var(--st-g1) 13%, transparent); }
.mx-cell.is-mrow { background: color-mix(in srgb, var(--st-g1) 14%, transparent); }
.mx-cell.is-mcol { background: color-mix(in srgb, var(--st-g2) 14%, transparent); }
.mx-cell.is-pair { box-shadow: 0 0 0 2.5px var(--st-gold); }
.mx-ring { position: absolute; inset: -3px; border-radius: 15px; border: 2px solid var(--st-brand); opacity: 0; pointer-events: none; }
.mx-cell.is-tap { cursor: pointer; touch-action: none; }
.mx-cell.is-tap .mx-ring { animation: st-breathe 1.8s ease-in-out infinite; }
.mx-cell.is-press { scale: .94; transition: scale .12s; }
/* 开放给学生直接动的：能拨的格底下一道虚线（像能拖的滑块），拨着的那一格一圈主色；乘积能点开看的格淡淡一层底 */
.mx-cell.is-editable { cursor: pointer; touch-action: manipulation; }
.mx-cell.is-editable::before { content: ""; position: absolute; left: 14px; right: 14px; bottom: 5px; border-bottom: 2px dotted color-mix(in srgb, var(--st-brand) 55%, transparent); pointer-events: none; }
.mx-cell.is-editing { box-shadow: 0 0 0 2px var(--st-brand), 0 0 0 7px color-mix(in srgb, var(--st-brand) 14%, transparent); background: var(--st-card); }
.mx-cell.is-explain { cursor: pointer; touch-action: manipulation; }
.mx-cell.is-explain:not(.is-blank) { background: color-mix(in srgb, var(--st-brand) 6%, transparent); }
.mx-step { position: absolute; left: 0; top: 0; z-index: 20; display: inline-flex; align-items: center; height: 52px; padding: 0 4px; border-radius: 999px;
  background: var(--st-card); box-shadow: 0 0 0 1px var(--st-line), 0 14px 28px -14px rgb(var(--shade-rgb, 25 45 40) / 0.5); }
.mx-step-b { width: 46px; height: 46px; border: 0; border-radius: 999px; background: none; color: var(--st-brand); font: 600 26px/1 var(--sans, sans-serif); cursor: pointer; }
.mx-step-b:disabled { opacity: .25; cursor: default; }
.mx-step-b:active { scale: .88; }
.mx-step-b:focus-visible { outline: 2px solid var(--st-brand); outline-offset: 2px; }
.mx-step-v { min-width: 2.4em; text-align: center; font: 600 21px/1 var(--sans, sans-serif); font-variant-numeric: tabular-nums; color: var(--st-ink); }
.mx-brk { fill: var(--st-ink); stroke: var(--st-ink); stroke-width: .4; stroke-linejoin: round; }
.mx-bar { position: absolute; left: 0; top: 0; width: 0; border-left: 1.6px solid rgb(var(--chalk-rgb, 27 34 32) / 0.5); pointer-events: none; }
.mx-eq { position: absolute; left: 0; top: 0; width: 56px; height: 44px; display: grid; place-items: center; font: 400 32px/1 var(--sans, sans-serif); color: var(--st-ink); pointer-events: none; }
.mx-eq.is-named { width: 104px; justify-items: end; padding-right: 12px; box-sizing: border-box; font-size: 28px; font-style: italic; font-family: "Latin Modern Math", "Cambria Math", "Times New Roman", serif; }
.mx-stairs { fill: none; stroke: var(--st-brand); stroke-width: 2; stroke-linejoin: round; opacity: .75; }
.mx-ghost { position: absolute; left: 0; top: 0; height: 52px; display: grid; place-items: center; border-radius: 12px; z-index: 6; pointer-events: none;
  background: var(--st-card); color: var(--st-g1); box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--st-g1) 55%, transparent), 0 12px 24px -12px rgb(var(--shade-rgb, 25 45 40) / 0.5); }
.mx-ghost.is-fly { background: transparent; box-shadow: none; color: var(--st-ink); }
.mx-ghost.is-res { color: var(--st-brand); }
.mx-coef { position: absolute; left: 0; top: 0; z-index: 7; padding: 6px 12px; border-radius: 999px; white-space: nowrap; pointer-events: none;
  background: var(--st-card); color: var(--st-g1); font: 600 19px/1 var(--sans, sans-serif); font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--st-g1) 45%, transparent), 0 10px 20px -12px rgb(var(--shade-rgb, 25 45 40) / 0.45); }
.mx-work { position: absolute; left: 0; top: 0; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; pointer-events: none;
  font: 500 21px/1.2 var(--sans, sans-serif); font-variant-numeric: tabular-nums; color: var(--st-ink); }
.mx-w-head { color: var(--st-muted); font-size: 19px; margin-right: 2px; }
.mx-w-n { display: inline-flex; align-items: center; }
.mx-w-n .mx-frac { font-size: 15px; }
.mx-w-x, .mx-w-op { color: var(--st-muted); }
.mx-w-res { color: var(--st-brand); font-weight: 700; }
.st-label.is-op { padding: 6px 12px; font: 600 18px/1.2 var(--sans, sans-serif); color: var(--st-brand); font-variant-numeric: tabular-nums;
  background: color-mix(in srgb, var(--st-brand) 7%, var(--st-card)); box-shadow: 0 0 0 1px color-mix(in srgb, var(--st-brand) 22%, transparent); }
@media (prefers-reduced-motion: reduce) { .mx-cell.is-tap .mx-ring { animation: none; opacity: .5; } }
`,
};
