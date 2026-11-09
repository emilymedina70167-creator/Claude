// 通用手势的画面那一半（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）：手势层在底座里写一次——
// 接住手指（pointer.js）、跟着手动、放下以后变成一行学生指令（gestures.js 照规则文件里的手势表翻）、交给舞台过裁判、演、记进 log。
// 每种东西的画法只交「手能抓哪儿」：view.grips 按手势表里的名字（树的 node / parent / tray / tree / slot，矩阵的 row / label / cell / whole，
// 句子的 word / bracket / hook / gap / pill / sentence / xmark / xrefer）给一组把手：grips[名字](stage, o, e, { role })，role 是 'from'
// （拿起来、点的地方，o 是开着的那一样）或 'to'（落点：矩阵整张拖要交舞台上别的矩阵）。每个把手 { key, part()（交给 toAct 的那一样）,
// node()（画出来的节点）, box()（世界坐标），可选 rect()（按的屏幕框，不写就是节点的框）、area()（当落点时的屏幕框）、light(cls, on)、
// show(on)（只在拖的时候画出来的空位、外框）、lift()（拎起来的样子）、land(L, r, 落点)（放下以后拎着的那一份怎么走：弹回去、飞进去）、cls、consumed }。
// 别的（拖的时候哪儿能放、悬在上面先说会怎样、弹回去、倍数框、点成分、从钩拉线、✕ 收掉）都在这里，所有东西一样。
// 按法（gestures.js 的 PRESS_OF）记在挂上的每一个上（how），同一处几种按法由 pointer.js 照 choosePress 分。
// 碰 DOM，靠浏览器里真的触摸检查（tools/stage-touch.mjs）；不碰 DOM 的部分在 gestures.js（有测试）。
import { EASE } from './motion.js';
import { pickTarget } from './layout.js';
import { gestureAct, askFor, kindsOf, kindArmed, writeRange, closeAct, dropVerdict, wouldBlock, ARMED_GRIPS, PRESS_OF } from './gestures.js';
import { openKeypad, openChoices } from './keypad.js';
import { reportError } from '../errlog.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const DROP_R = 28; // 拖着找落点：手指离一个落点多远以内算悬在它上面（屏幕像素；落点比格子的边粗一点）
const STATE = ['is-drag', 'is-tap', 'is-press', 'is-over', 'is-drop', 'is-nodrop', 'is-slip', 'is-hold', 'is-lifted', 'is-editable', 'is-editing', 'is-shake'];
const SVGNS = 'http://www.w3.org/2000/svg';
const LINE_DEAD = 22; // 从钩上拉线：离开钩这么远（屏幕像素）以前不算悬在哪儿（不然一按下去就悬在钩挂着的那个词、外框上）

/** 世界坐标的一个框在屏幕上（相对 stage.view），按镜头现在真正的样子 */
export function screenOf(stage, b) {
  if (!b) return null;
  const p = stage.toScreenLive({ x: b.x, y: b.y }), s = stage.liveCam().s;
  return { x: p.x, y: p.y, w: b.w * s, h: b.h * s };
}
/** open 那一项写的部件（open t.30* rotate）；没写是 fallback。部件后来没了（删了、改写了）就当没有，不让整种手势跟着出错 */
export function openParts(stage, e, fallback) {
  if (!e.refs.length) return fallback;
  return e.refs.flatMap((r) => { try { return stage.scene.parts(r); } catch { return []; } });
}
/** 手指按的框至少 44px 见方（矩阵的行把手、行号画得窄，按的地方不能跟着窄） */
export function atLeast(r, min = 44) {
  if (!r) return r;
  const w = Math.max(r.w, min), h = Math.max(r.h, min);
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}
const rectOf = (stage, g) => { try { return g.rect?.() || stage.screenRect(g.node?.()) || screenOf(stage, g.box?.()); } catch { return null; } };
const areaOf = (stage, g) => { try { return g.area?.() || rectOf(stage, g); } catch { return null; } };
const light = (g, cls, on) => { try { if (g.light) g.light(cls, on); else g.node?.()?.classList.toggle(cls, on); } catch { /* 节点没了 */ } };
// 点错了的那一处晃一下（摘里面的结点、翻不成指令的一下）：和话一起出，学生看得出是「这里不行」，不是没按到
function shake(g) {
  const n = g.node?.();
  if (!n?.classList) return;
  n.classList.remove('is-shake');
  void n.getBoundingClientRect?.();
  n.classList.add('is-shake');
  setTimeout(() => n.classList.remove('is-shake'), 420);
}
const worldCenter = (stage, g) => {
  const b = g.box?.() || g.node?.()?.__box || g.node?.()?.__g;
  if (b) return { x: b.x + (b.w || 0) / 2, y: b.y + (b.h || 0) / 2 };
  const r = rectOf(stage, g);
  if (!r) return null;
  const c = stage.liveCam();
  return { x: (r.x + r.w / 2 - c.tx) / c.s, y: (r.y + r.h / 2 - c.ty) / c.s };
};
const samePart = (a, b) => a && b && (a === b || (a.obj != null && a.obj === b.obj && a.key != null && a.key === b.key));

// 默认的「拎起来」：节点复制一份跟着手走（不带 data-obj：排版不把它算进那样东西），原来的淡下去；放回去时原来的一定恢复（哪怕被裁判拦下）
function cloneLift(stage, g) {
  const n = g.node?.();
  const box = g.box?.() || n?.__box;
  if (!n || !box) return null;
  const c = n.cloneNode(true);
  c.removeAttribute('data-obj');
  c.classList.remove(...STATE);
  c.classList.add('st-g-ghost');
  c.style.transform = tr(box.x, box.y);
  c.style.opacity = '';
  stage.layer.appendChild(c);
  n.classList.add('is-lifted');
  return { el: c, box, restore: () => { n.classList.remove('is-lifted'); g.node?.()?.classList.remove('is-lifted'); } };
}

// 一句话浮在一处上方一会儿（拖到不能放的地方、写错了）：不是舞台上的东西，不记、不告诉老师
let noteEl = null;
export function noteAt(stage, text, anchor, { ms = 1800, bad = true } = {}) {
  noteEl?.remove();
  if (!text) return;
  const n = noteEl = el('div', `st-g-note${bad ? ' is-bad' : ''}`, stage.view);
  n.textContent = text;
  placeAbove(stage, n, anchor);
  stage.tween(n, [{ opacity: 0, transform: `${n.style.transform} translateY(6px)` }, { opacity: 1, transform: n.style.transform }], { duration: 200, easing: EASE.out });
  setTimeout(() => { if (noteEl === n) noteEl = null; stage.tween(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).then(() => n.remove()); }, ms);
}
function placeAbove(stage, n, a) {
  const vw = stage.view.clientWidth || 800;
  const w = n.offsetWidth, h = n.offsetHeight;
  const r = a || { x: vw / 2, y: 120, w: 0, h: 0 };
  let y = r.y - h - 10;
  if (y < 8) y = r.y + r.h + 10;
  const x = Math.max(8, Math.min(vw - w - 8, r.x + r.w / 2 - w / 2));
  n.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

/**
 * 挂上 open 的那一项（e.gesture 是规则文件手势表里的那一项）。done(act, src) 交给舞台（stage.openDone：过裁判、演、记、告诉课堂），
 * 返回收起的函数；它的 refresh() 照东西现在的样子重挂（托盘少了一个、长出新结点、多了一道括号）——舞台每演完一行叫一次
 */
export function armGesture(stage, e, view, done) {
  const g = e.gesture;
  if (!g || !view?.grips) return Object.assign(() => {}, { refresh() {} });
  // 画法还交不出把手的那一种不挂（gestures.js 的 ARMED_GRIPS：拎得起来放不下，还抢同一处别的手势的手指）
  const kinds = kindsOf(g).filter((k) => kindArmed(g, k));
  const obj = () => stage.scene.objects.get(e.obj);
  const fromNames = new Set([].concat(g.from || []));
  // 画法交的把手出错：这一种手势就没了，记进出错记录（不默默吞掉）。
  // 落点（role 'to'）不跟着 open 写的部件走：open s.6 refer 只在 that 上挂钩，线照样能松在别的词上（拉括号的起点、落点都是词，照旧只在写的那一段里）
  const gripsOf = (name, role = 'from') => [].concat(name || []).flatMap((n) => {
    const fn = view.grips[n];
    const o = obj();
    if (!fn || !o) return [];
    const ee = role === 'to' && !fromNames.has(n) && e.refs?.length ? { ...e, refs: [] } : e;
    try { return fn(stage, o, ee, { role }) || []; } catch (err) { reportError(err, { what: `舞台的手势：${o.type} 的「${n}」把手出错（open ${e.obj} ${e.action}）` }); return []; }
  });
  const armed = new Map(); // key → { off, grip, cls }
  const clsOf = (grip, kind) => grip.cls ?? (kind === 'tap' || kind === 'write' || kind === 'close' ? 'is-tap' : 'is-drag');

  // 学生的这一下：动作带上是哪种手势、那一行指令（页面不判的也有一行可写给老师）
  const actOf = (r, kind) => ({ ...r.act, gesture: kind, src: r.src });
  const send = (r, kind) => Promise.resolve(done(actOf(r, kind), r.src));
  // 放下的那一刻先问裁判这一下会不会被拦（wrong=block、这个世界做不到）：会拦就让拎着的东西飞回去，不用等演。拿舞台现在的样子问
  const blocked = (src) => wouldBlock(stage.scene, e, src);
  // 一下手势要先问一个值：数字键盘、一排选项；问到了再翻成指令（翻不成就在那块上说为什么，不收）。
  // 浮出来的那一块不比手势活得久：这一项收起了（off）一起收；按「确定」时这一项已经不是开着的那一项、东西重造过了，悄悄收起、不交
  let popup = null;
  const asking = (ask, anchor, ctx, kind, after = null) => {
    popup?.close();
    const o0 = obj();
    const go = (extra) => {
      if (stage.scene.opens.get(`${e.obj}:${e.action}`) !== e || obj() !== o0) return null;
      if (kind === 'write') { const bad = writeRange(e, extra.value); if (bad) return bad; }
      const r = gestureAct(stage.scene, e, { ...ctx, ...extra });
      if (r.error) return r.error;
      // 裁判会拦下的（wrong=block、这个世界做不到）：照样交（课堂要知道学生试了什么），那一块不收、晃一下说一句中性的
      const no = blocked(r.src);
      send(r, kind);
      return no ? '这一下没让做' : null;
    };
    const closed = () => { popup = null; after?.(); };
    const opts = { anchor, prompt: ask.prompt || '', onClose: closed };
    popup = ask.pick ? openChoices(stage, { ...opts, choices: ask.choices, onPick: (v) => go({ role: v }) }) : openKeypad(stage, { ...opts, onOk: (text) => go({ value: text }) });
    return popup;
  };
  // 挂到 pointer.js 上的一个：name 是把手的 key（检查脚本找 ✕、钩的点区用），how 是按法（同一处几种时 pointer.js 照它分）
  const add = (grip, kind, t) => stage.pointer.add({ prio: 1, rect: () => rectOf(stage, grip), name: grip.key, how: PRESS_OF[kind] || 'tap', ...t });

  // —— 点一下（tap）、点一格写一个值（write）——
  const tapTarget = (grip, kind) => add(grip, kind, {
    kind: 'tap',
    press: (on) => light(grip, 'is-press', on),
    onTap: () => {
      const ctx = kind === 'write' ? { to: grip.part() } : { from: grip.part() };
      const ask = askFor(g, obj(), kind, ctx);
      const anchor = areaOf(stage, grip);
      if (ask) {
        if (kind === 'write') { light(grip, 'is-editing', true); asking(ask, anchor, ctx, kind, () => light(grip, 'is-editing', false)); } else asking(ask, anchor, ctx, kind);
        return;
      }
      const r = gestureAct(stage.scene, e, ctx);
      if (r.error) { shake(grip); noteAt(stage, r.error, anchor); } else send(r, kind);
    },
  });

  // —— 学生做的东西头上的 ✕（学生拉的括号、连的线）：点了收掉，照手势表的 close 翻（unmark / unrefer）——
  const closeTarget = (grip) => add(grip, 'tap', {
    kind: 'tap',
    press: (on) => light(grip, 'is-press', on),
    onTap: () => {
      const r = closeAct(stage.scene, e, { from: grip.part() });
      if (r.error) { shake(grip); noteAt(stage, r.error, areaOf(stage, grip)); } else send(r, 'tap');
    },
  });

  // —— 拖到上面（drop-on）、拖到空处（drop-at）——
  const dropTarget = (grip, kind) => {
    let st = null;
    let after = null; // 托盘里的数：插进去以后它自己就没了，演完再把拎走的样子放回（拦下了、没演上也放回）
    const clear = () => {
      if (!st) return;
      for (const x of st.targets) { light(x.t, 'is-drop', false); light(x.t, 'is-over', false); light(x.t, 'is-nodrop', false); x.t.show?.(false); }
      st.hint?.remove();
    };
    // 拎着的那一份飞回原处；keep：原来那一样先别恢复（倍数框开着时还标着「从这一行来」）
    const back = (L, { keep = false } = {}) => {
      if (!L) return;
      if (!L.el) { if (!keep) L.restore(); return; }
      stage.tween(L.el, [{ transform: L.el.style.transform }, { transform: tr(L.box.x, L.box.y) }], { duration: 340, easing: EASE.spring }).then(() => { L.el.remove(); if (!keep) L.restore(); });
    };
    const drop = (L) => { L?.el?.remove(); L?.restore(); };
    // 悬上一个落点时拿舞台现在的样子再问一遍（拖起来以后前一下还在演、预写在演，舞台变了）：能不能放、先说会怎样、会不会被拦。
    // 拖起来那一刻问的只用来淡淡标出能放的地方；松手以后照旧以裁判为准
    const fresh = (x) => {
      let v;
      try { v = dropVerdict(stage.scene, e, { from: st.from, to: x.t.part(), value: st.value }, kind); } catch { return; } // 落点没了：照拖起来时的
      x.ok = !!v.ask || (!v.r?.error && !v.blocked);
      x.hint = v.ask ? v.ask.hint || v.ask.prompt : (view.gestureHint?.(stage, obj(), e, v.r) || '');
      x.why = v.why;
      light(x.t, 'is-drop', x.ok);
    };
    const over = (x) => {
      if (st.over === x) return;
      if (st.over) { light(st.over.t, 'is-over', false); light(st.over.t, 'is-nodrop', false); }
      st.over = x;
      st.hint?.remove();
      st.hint = null;
      if (!x) return;
      fresh(x);
      light(x.t, x.ok ? 'is-over' : 'is-nodrop', true);
      const text = x.ok ? x.hint : x.why;
      if (text) { st.hint = el('div', `st-g-note is-hint${x.ok ? '' : ' is-bad'}`, stage.view); st.hint.textContent = text; placeAbove(stage, st.hint, areaOf(stage, x.t)); }
    };
    const spec = {
      start(w, { held = false } = {}) {
        const from = grip.part();
        if (from == null) throw new Error('这个东西不在了');
        st = { w0: w, from, value: grip.value ?? null, over: null, hint: null, targets: [] };
        // 能放的地方：手势表 to 写的那几种；先挨个问一遍放上去会怎样（能放的淡淡标出来，悬上去先说会怎样，不能放的说为什么）
        for (const t of gripsOf(g.to, 'to')) {
          if (t.key === grip.key) continue;
          t.show?.(true);
          const ctx = { from, to: t.part(), value: st.value };
          const ask = askFor(g, obj(), kind, ctx);
          const r = ask ? null : gestureAct(stage.scene, e, ctx);
          const x = { t, ok: !!ask || !r.error, hint: ask ? ask.hint || ask.prompt : (view.gestureHint?.(stage, obj(), e, r) || ''), why: r?.error || '' };
          st.targets.push(x);
          if (x.ok) light(t, 'is-drop', true);
        }
        st.lift = grip.lift?.(stage) || cloneLift(stage, grip);
        // 按住等满了才托起来的（同一处还能点、滑）：拎起来的那一份当场放大一点、弹一下，手指还没挪就看得出已经托起来了
        if (held && st.lift?.el) {
          const L = st.lift;
          L.el.style.transform = tr(L.box.x, L.box.y, 1.08);
          L.el.classList.add('is-pop');
        }
      },
      move(w) {
        if (!st) return;
        const L = st.lift;
        if (L?.el) L.el.style.transform = tr(L.box.x + w.x - st.w0.x, L.box.y + w.y - st.w0.y, 1.08);
        const pt = stage.toScreenLive(w);
        const cands = st.targets.map((x, i) => ({ id: i, rect: areaOf(stage, x.t) }));
        const hit = pickTarget(pt, cands, { radius: DROP_R });
        over(hit ? st.targets[hit.id] : null);
      },
      drop() {
        if (!st) return null;
        const x = st.over, L = st.lift, from = st.from, value = st.value;
        clear();
        st = null;
        if (!x) { back(L); return null; }
        const anchor = areaOf(stage, x.t);
        const ctx = { from, to: x.t.part(), value };
        const ask = askFor(g, obj(), kind, ctx);
        // 先问倍数：键盘开着时这一行、那一行一直标着（看得出「r₂ + k·r₁」说的是哪两行），收起时一起恢复
        if (ask) { back(L, { keep: true }); light(x.t, 'is-over', true); asking(ask, anchor, ctx, kind, () => { L?.restore(); light(x.t, 'is-over', false); }); return null; }
        const r = gestureAct(stage.scene, e, ctx);
        if (r.error) { back(L); noteAt(stage, r.error, anchor); return null; }
        if (blocked(r.src)) back(L);
        // 画法自己定拎着的那一份怎么走（整张矩阵拖去比是弹回去，放进合计是飞进去）；原来那一样演完再恢复（并掉的那一张那时已经拿下了）
        else if (grip.land) {
          try { grip.land(L, r, x.t); } catch { drop(L); }
          after = () => L?.restore();
        } else if (grip.consumed) { L?.el?.remove(); after = () => L?.restore(); } else drop(L);
        return r;
      },
      cancel() {
        if (!st) return;
        const L = st.lift;
        clear();
        st = null;
        back(L);
      },
    };
    return add(grip, kind, {
      kind: 'drag', spec,
      press: (on) => light(grip, 'is-press', on),
      done: (act, src) => { const fin = after; after = null; send({ act, src }, kind).finally(() => fin?.()); },
    });
  };

  // —— 拉一段（span）：从一个部件拉到另一个，临时的括号跟着手；松手以后点一个（成分）——
  const spanTarget = (grip) => {
    let st = null;
    const spec = {
      start() {
        const from = grip.part();
        if (from == null) throw new Error('这个东西不在了');
        st = { from, to: from, words: gripsOf(g.to || g.from), prev: view.spanPreview?.(stage, obj(), e) || null };
        st.prev?.set(st.from, st.to);
      },
      move(w) {
        if (!st) return;
        const pt = stage.toScreenLive(w);
        const hit = pickTarget(pt, st.words.map((t, i) => ({ id: i, rect: areaOf(stage, t) })), { radius: DROP_R });
        const to = hit ? st.words[hit.id].part() : null;
        if (to && to !== st.to) { st.to = to; st.prev?.set(st.from, st.to); }
      },
      drop() {
        if (!st) return null;
        const { from, to, prev } = st;
        st = null;
        const ctx = { from, to };
        const anchor = prev?.rect?.() || rectOf(stage, grip);
        const ask = askFor(g, obj(), 'span', ctx);
        if (ask) { asking(ask, anchor, ctx, 'span', () => prev?.remove()); return null; }
        prev?.remove();
        const r = gestureAct(stage.scene, e, ctx);
        if (r.error) { noteAt(stage, r.error, anchor); return null; }
        return r;
      },
      cancel() { if (!st) return; st.prev?.remove(); st = null; },
    };
    return add(grip, 'span', { kind: 'drag', spec, press: (on) => light(grip, 'is-press', on), done: (act, src) => send({ act, src }, 'span') });
  };

  // —— 拉一条线（line）：从钩上滑出一道跟着手的弧，悬在落点（词、括号、句子外框）上标出来、先说为什么不行，松手交 ——
  const lineTarget = (grip) => {
    let st = null;
    const clear = () => {
      if (!st) return;
      for (const x of st.targets) { light(x.t, 'is-drop', false); light(x.t, 'is-over', false); light(x.t, 'is-nodrop', false); x.t.show?.(false); }
      st.hint?.remove();
      st.path?.remove();
      st.dot?.remove();
      light(grip, 'is-hold', false);
    };
    const over = (x) => {
      if (st.over === x) return;
      if (st.over) { light(st.over.t, 'is-over', false); light(st.over.t, 'is-nodrop', false); }
      st.over = x;
      st.hint?.remove();
      st.hint = null;
      if (x) {
        // 和拖到上面一样：悬上去时拿舞台现在的样子再问一遍（拉起来以后舞台可能变了）
        try {
          const v = dropVerdict(stage.scene, e, { from: st.from, to: x.t.part() }, 'line');
          x.ok = !v.r?.error && !v.blocked;
          x.why = v.why;
          light(x.t, 'is-drop', x.ok);
        } catch { /* 落点没了：照拉起来时的 */ }
      }
      st.path?.classList.toggle('is-on', !!x?.ok);
      if (!x) return;
      light(x.t, x.ok ? 'is-over' : 'is-nodrop', true);
      if (!x.ok && x.why) { st.hint = el('div', 'st-g-note is-hint is-bad', stage.view); st.hint.textContent = x.why; placeAbove(stage, st.hint, areaOf(stage, x.t)); }
    };
    // 弧：从钩拱起来落到手指（和画好的指代箭头一样往上拱），手指那头一个小圆点
    const draw = (w) => {
      const a = st.a, r = (v) => Math.round(v * 10) / 10;
      const top = Math.min(a.y, w.y) - Math.max(26, Math.min(70, Math.abs(w.x - a.x) * 0.18));
      st.path.setAttribute('d', `M${r(a.x)} ${r(a.y)} C${r(a.x)} ${r(top)} ${r(w.x)} ${r(top)} ${r(w.x)} ${r(w.y)}`);
      st.dot.setAttribute('cx', r(w.x));
      st.dot.setAttribute('cy', r(w.y));
    };
    const spec = {
      start(w) {
        const from = grip.part();
        if (from == null) throw new Error('这个东西不在了');
        const a = worldCenter(stage, grip) || w;
        st = { from, a, w0: w, far: false, over: null, hint: null, targets: [] };
        for (const t of gripsOf(g.to, 'to')) {
          if (samePart(t.part(), from)) continue; // 钩挂着的那个词自己不是落点
          t.show?.(true);
          const r = gestureAct(stage.scene, e, { from, to: t.part() });
          const x = { t, ok: !r.error, why: r.error || '' };
          st.targets.push(x);
          if (x.ok) light(t, 'is-drop', true);
        }
        const host = stage.ink || stage.under;
        st.path = document.createElementNS(SVGNS, 'path');
        st.path.setAttribute('class', 'st-g-line');
        st.dot = document.createElementNS(SVGNS, 'circle');
        st.dot.setAttribute('class', 'st-g-linedot');
        st.dot.setAttribute('r', '6');
        host?.append(st.path, st.dot);
        light(grip, 'is-hold', true);
        draw(w);
      },
      move(w) {
        if (!st) return;
        draw(w);
        const pt = stage.toScreenLive(w), p0 = stage.toScreenLive(st.a);
        if (!st.far && Math.hypot(pt.x - p0.x, pt.y - p0.y) < LINE_DEAD) return;
        st.far = true;
        const hit = pickTarget(pt, st.targets.map((x, i) => ({ id: i, rect: areaOf(stage, x.t) })), { radius: DROP_R });
        over(hit ? st.targets[hit.id] : null);
      },
      drop() {
        if (!st) return null;
        const x = st.over, from = st.from, far = st.far;
        const anchor = rectOf(stage, grip);
        clear();
        st = null;
        // 松在空处：线收回去；拉远了才说一句松在哪（就在钩上碰一下不说）
        if (!x) { if (far) noteAt(stage, '把线松在它指的词、括号或句子外框上', anchor, { bad: false }); return null; }
        const r = gestureAct(stage.scene, e, { from, to: x.t.part() });
        if (r.error) { noteAt(stage, r.error, areaOf(stage, x.t)); return null; }
        return r;
      },
      cancel() { clear(); st = null; },
    };
    return add(grip, 'line', { kind: 'drag', spec, press: (on) => light(grip, 'is-press', on), done: (act, src) => send({ act, src }, 'line') });
  };

  const arm = (grip, kind) => {
    if (kind === 'tap' || kind === 'write') return tapTarget(grip, kind);
    if (kind === 'close') return closeTarget(grip);
    if (kind === 'span') return spanTarget(grip);
    if (kind === 'line') return lineTarget(grip);
    return dropTarget(grip, kind);
  };
  // 照现在的样子要挂哪些：手势表的 from（拖、拉）、tap / on（点、写）、close.on（学生做的东西头上的 ✕）
  const plan = () => {
    const out = [];
    const dropKind = kinds.find((k) => k === 'drop-on' || k === 'drop-at');
    if (dropKind) for (const s of gripsOf(g.from)) out.push({ key: `d:${s.key}`, kind: dropKind, grip: s });
    if (kinds.includes('span')) for (const s of gripsOf(g.from)) out.push({ key: `s:${s.key}`, kind: 'span', grip: s });
    if (kinds.includes('line')) for (const s of gripsOf(g.from)) out.push({ key: `l:${s.key}`, kind: 'line', grip: s });
    for (const kind of ['tap', 'write']) {
      if (!kinds.includes(kind)) continue;
      for (const s of gripsOf((kind === 'tap' && g.tap) || g.on)) out.push({ key: `${kind}:${s.key}`, kind, grip: s });
    }
    const closeOn = [].concat(g.close?.on || []).filter((n) => ARMED_GRIPS.has(n));
    if (typeof g.close?.toAct === 'function') for (const s of gripsOf(closeOn)) out.push({ key: `x:${s.key}`, kind: 'close', grip: s });
    return out;
  };
  const refresh = () => {
    const want = plan();
    const keys = new Set(want.map((w) => w.key));
    for (const [k, a] of armed) if (!keys.has(k)) { a.off(); if (a.cls) a.grip.node?.()?.classList.remove(a.cls); armed.delete(k); }
    for (const w of want) {
      const cls = clsOf(w.grip, w.kind);
      const had = armed.get(w.key);
      if (had) { had.grip = w.grip; } else armed.set(w.key, { off: arm(w.grip, w.kind), grip: w.grip, cls });
      if (cls) w.grip.node?.()?.classList.add(cls); // 节点可能重画过：再挂一次样子
    }
  };
  refresh();
  const off = () => { popup?.close(); for (const a of armed.values()) { a.off(); if (a.cls) a.grip.node?.()?.classList.remove(a.cls); } armed.clear(); };
  off.refresh = refresh;
  return off;
}
