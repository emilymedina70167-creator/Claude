// 通用手势的画面那一半（docs/superpowers/specs/2026-11-06-stage-base-design.md 第 3 节）：手势层在底座里写一次——
// 接住手指（pointer.js）、跟着手动、放下以后变成一行学生指令（gestures.js 照规则文件里的手势表翻）、交给舞台过裁判、演、记进 log。
// 每种东西的画法只交「手能抓哪儿」：view.grips 按手势表里的名字（树的 node / parent / tray / tree / slot，矩阵的 row / label / cell，
// 句子的 word / bracket）给一组把手，每个把手 { key, part()（交给 toAct 的那一样）, node()（画出来的节点）, box()（世界坐标），
// 可选 area()（当落点时的屏幕框）、light(cls, on)、show(on)（只在拖的时候画出来的空位）、lift()（拎起来的样子）、cls、consumed }。
// 别的（拖的时候哪儿能放、悬在上面先说会怎样、弹回去、倍数框、点成分）都在这里，所有东西一样。
// 碰 DOM，靠浏览器里真的触摸检查（tools/stage-touch.mjs）；不碰 DOM 的部分在 gestures.js（有测试）。
import { EASE } from './motion.js';
import { pickTarget } from './layout.js';
import { parseScript } from './script.js';
import { gestureAct, askFor, kindsOf } from './gestures.js';
import { openKeypad, openChoices } from './keypad.js';

const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
const DROP_R = 28; // 拖着找落点：手指离一个落点多远以内算悬在它上面（屏幕像素；落点比格子的边粗一点）
const STATE = ['is-drag', 'is-tap', 'is-press', 'is-over', 'is-drop', 'is-nodrop', 'is-slip', 'is-hold', 'is-lifted', 'is-editable', 'is-editing'];

/** 世界坐标的一个框在屏幕上（相对 stage.view），按镜头现在真正的样子 */
export function screenOf(stage, b) {
  if (!b) return null;
  const p = stage.toScreenLive({ x: b.x, y: b.y }), s = stage.liveCam().s;
  return { x: p.x, y: p.y, w: b.w * s, h: b.h * s };
}
const rectOf = (stage, g) => { try { return g.rect?.() || stage.screenRect(g.node?.()) || screenOf(stage, g.box?.()); } catch { return null; } };
const areaOf = (stage, g) => { try { return g.area?.() || rectOf(stage, g); } catch { return null; } };
const light = (g, cls, on) => { try { if (g.light) g.light(cls, on); else g.node?.()?.classList.toggle(cls, on); } catch { /* 节点没了 */ } };

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
  const kinds = kindsOf(g);
  const obj = () => stage.scene.objects.get(e.obj);
  const gripsOf = (name) => { const fn = view.grips[name]; const o = obj(); if (!fn || !o) return []; try { return fn(stage, o, e) || []; } catch { return []; } };
  const armed = new Map(); // key → { off, grip, cls }
  const clsOf = (grip, kind) => grip.cls ?? (kind === 'tap' || kind === 'write' ? 'is-tap' : 'is-drag');

  // 学生的这一下：动作带上是哪种手势、那一行指令（页面不判的也有一行可写给老师）
  const actOf = (r, kind) => ({ ...r.act, gesture: kind, src: r.src });
  const send = (r, kind) => Promise.resolve(done(actOf(r, kind), r.src));
  // 放下以前先问裁判这一下会不会被拦（wrong=block、这个世界做不到）：会拦就让拎着的东西飞回去，不用等演
  const blocked = (src) => {
    try { const [c] = parseScript(src); const j = stage.scene.judgeLine(c, { by: 'student', open: e.action }); return !!j && !j.apply; } catch { return false; }
  };
  // 一下手势要先问一个值：数字键盘、一排选项；问到了再翻成指令（翻不成就在那块上说为什么，不收）
  const asking = (ask, anchor, ctx, kind, after = null) => {
    const go = (extra) => { const r = gestureAct(stage.scene, e, { ...ctx, ...extra }); if (r.error) return r.error; send(r, kind); return null; };
    if (ask.pick) return openChoices(stage, { anchor, choices: ask.choices, prompt: ask.prompt || '', onPick: (v) => go({ role: v }), onClose: after });
    return openKeypad(stage, { anchor, prompt: ask.prompt || '', onOk: (text) => go({ value: text }), onClose: after });
  };

  // —— 点一下（tap）、点一格写一个值（write）——
  const tapTarget = (grip, kind) => stage.pointer.add({
    kind: 'tap', prio: 1, rect: () => rectOf(stage, grip),
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
      if (r.error) noteAt(stage, r.error, anchor); else send(r, kind);
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
    const over = (x) => {
      if (st.over === x) return;
      if (st.over) { light(st.over.t, 'is-over', false); light(st.over.t, 'is-nodrop', false); }
      st.over = x;
      st.hint?.remove();
      st.hint = null;
      if (!x) return;
      light(x.t, x.ok ? 'is-over' : 'is-nodrop', true);
      const text = x.ok ? x.hint : x.why;
      if (text) { st.hint = el('div', `st-g-note is-hint${x.ok ? '' : ' is-bad'}`, stage.view); st.hint.textContent = text; placeAbove(stage, st.hint, areaOf(stage, x.t)); }
    };
    const spec = {
      start(w) {
        const from = grip.part();
        if (from == null) throw new Error('这个东西不在了');
        st = { w0: w, from, value: grip.value ?? null, over: null, hint: null, targets: [] };
        // 能放的地方：手势表 to 写的那几种；先挨个问一遍放上去会怎样（能放的淡淡标出来，悬上去先说会怎样，不能放的说为什么）
        for (const name of [].concat(g.to || [])) {
          for (const t of gripsOf(name)) {
            if (t.key === grip.key) continue;
            t.show?.(true);
            const ctx = { from, to: t.part(), value: st.value };
            const ask = askFor(g, obj(), kind, ctx);
            const r = ask ? null : gestureAct(stage.scene, e, ctx);
            const x = { t, ok: !!ask || !r.error, hint: ask ? ask.hint || ask.prompt : (view.gestureHint?.(stage, obj(), e, r) || ''), why: r?.error || '' };
            st.targets.push(x);
            if (x.ok) light(t, 'is-drop', true);
          }
        }
        st.lift = grip.lift?.(stage) || cloneLift(stage, grip);
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
        else if (grip.consumed) { L?.el?.remove(); after = () => L?.restore(); } else drop(L);
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
    return stage.pointer.add({
      kind: 'drag', prio: 1, spec, rect: () => rectOf(stage, grip),
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
        st = { from, to: from, words: [].concat(g.to || g.from).flatMap((name) => gripsOf(name)), prev: view.spanPreview?.(stage, obj(), e) || null };
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
    return stage.pointer.add({ kind: 'drag', prio: 1, spec, rect: () => rectOf(stage, grip), done: (act, src) => send({ act, src }, 'span') });
  };

  const arm = (grip, kind) => {
    if (kind === 'tap' || kind === 'write') return tapTarget(grip, kind);
    if (kind === 'span') return spanTarget(grip);
    return dropTarget(grip, kind);
  };
  // 照现在的样子要挂哪些：手势表的 from（拖、拉）、tap / on（点、写）
  const plan = () => {
    const out = [];
    const dropKind = kinds.find((k) => k === 'drop-on' || k === 'drop-at');
    if (dropKind) for (const s of gripsOf(g.from)) out.push({ key: `d:${s.key}`, kind: dropKind, grip: s });
    if (kinds.includes('span')) for (const s of gripsOf(g.from)) out.push({ key: `s:${s.key}`, kind: 'span', grip: s });
    for (const kind of ['tap', 'write']) {
      if (!kinds.includes(kind)) continue;
      for (const name of [].concat((kind === 'tap' && g.tap) || g.on || [])) for (const s of gripsOf(name)) out.push({ key: `${kind}:${s.key}`, kind, grip: s });
    }
    return out;
  };
  const refresh = () => {
    const want = plan();
    const keys = new Set(want.map((w) => w.key));
    for (const [k, a] of armed) if (!keys.has(k)) { a.off(); a.grip.node?.()?.classList.remove(a.cls); armed.delete(k); }
    for (const w of want) {
      const cls = clsOf(w.grip, w.kind);
      const had = armed.get(w.key);
      if (had) { had.grip = w.grip; } else armed.set(w.key, { off: arm(w.grip, w.kind), grip: w.grip, cls });
      if (cls) w.grip.node?.()?.classList.add(cls); // 节点可能重画过：再挂一次样子
    }
  };
  refresh();
  const off = () => { for (const a of armed.values()) { a.off(); if (a.cls) a.grip.node?.()?.classList.remove(a.cls); } armed.clear(); };
  off.refresh = refresh;
  return off;
}
