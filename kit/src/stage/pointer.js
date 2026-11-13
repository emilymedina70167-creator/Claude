// 舞台上的手指（docs/stage-plan.md「交互」）：点、拖都走这一个口，挂在整块舞台上（stage.view），不挂在一个个节点上。
//
// 以前每种东西自己在节点上挂 pointer 监听，拖起来容易「掉」，根子有几条：
// - 平面的手柄是另一块透明的方块，挂上时摆在箭头尖上，之后不跟着走：拖完一次、吸到格点的动画还没走完它就停在半路，下一次按不到；
// - 手指比格子的边粗，按偏一点、按在两个东西中间就什么都没拿到；
// - 拖的时候镜头照样挪、老师写的下一行照样演，手指下面的东西被挪走；
// - iPad 把手势当成滚动、系统手势插进来时发 pointercancel，东西直接掉回原处。
// 所以：按下去的那一刻按每个东西「现在」在屏幕上的位置挑一个（layout.js 的 pickTarget：落在里面的最小那个，落在空处挑半径以内最近的）；
// 拖的时候整块舞台抓着这根手指（setPointerCapture 在不会被重画的 view 上）、镜头和老师的行都等手指松开；pointercancel 当松手，在哪松就算拖到哪。
// 每种东西只管「从哪拿、跟着手怎么动、放下算什么」（view 的 dragSpec），手指本身的事都在这里。
//
// 同一处的几种按法（docs/superpowers/specs/2026-11-08-stage-base-2-design.md 第 2.1 节）：同一个框、同一档 prio 上挂着的几个
// （句子的一个词上又能拉括号、又能点着折、又能按住挪）各带一种按法 how（点 tap、滑 slide、按住再拖 hold），按下去先不定，
// 照 gestures.js 的 choosePress 在第一个定得下的时刻（挪过 TAP_SLOP、按满 HOLD_MS、松手）定一种，一下只交那一种；定成 'none'
// 是作罢（什么都不交、不留半截的拖，说一句怎么按）。只有一种按法时照旧：点等松手，滑、按住再拖按下就开始（和第一轮一样）。
// 正在等的那一问（prio 2 的点）和低一档的拖不在同一个框里也分按法：点是那一问，按住再拖是拖（ask pick 等着时照样拎得起整张矩阵）
import { pressGroup } from './layout.js';
import { choosePress, HOLD_MS } from './gestures.js';
import { noteAt } from './gesturedom.js';

const TAP_SLOP = 12; // 按下到松开挪了多少像素以内还算「点」
const FINGER = 30; // 手指按偏多远以内还算按到（屏幕像素）；鼠标、笔准一些
const PEN = 14;
// 作罢时说一句这一处有哪几种按法（中性的，不说对错）
const PRESS_SAY = { tap: '点一下', slide: '按下就滑', hold: '按住一会儿再拖' };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class PointerRouter {
  constructor(stage) {
    this.stage = stage;
    this.targets = new Map(); // id → { kind: 'tap' | 'drag', how?, prio, rect() → 屏幕上的框（相对 view）, … }
    this.seq = 0;
    this.s = null; // 正在按着的那一下
    this.frame = 0;
    const v = stage.view;
    v.addEventListener('pointerdown', (e) => this.down(e));
    v.addEventListener('pointermove', (e) => this.move(e));
    v.addEventListener('pointerup', (e) => this.up(e, false));
    v.addEventListener('pointercancel', (e) => this.up(e, true));
    v.addEventListener('lostpointercapture', (e) => { if (this.s?.id === e.pointerId) this.up(e, true); });
  }

  /** 挂一个能点 / 能拖的；返回收起的函数 */
  add(t) {
    const id = ++this.seq;
    this.targets.set(id, t);
    this.paint();
    // 正按着的那一下用到它：还没定是哪一种（同一处的几种都还算数）、或者定的就是它，按下的这一下作罢
    return () => { const s = this.s; if (s && (s.tid === id || (!s.how && s.ids.has(id)))) this.abort(); this.targets.delete(id); this.paint(); };
  }
  // 有能拖的东西时整块舞台不让浏览器拿去滚动、缩放（舞台本来就不滚动），手势就不会把拖到一半的东西取消掉
  paint() { this.stage.view.classList.toggle('has-drag', [...this.targets.values()].some((t) => t.kind === 'drag')); }

  local(e) { const r = this.stage.view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  down(e) {
    if (this.s || (e.pointerType === 'mouse' && e.button > 0)) return;
    // 真的按钮、输入框、拨数器、话里的小块、浮出来的数字键盘和一排选项（keypad.js 的 .st-gpop）自己管
    if (e.target.closest?.('button, input, textarea, select, a, .st-dock, .mx-step, .st-dial, .st-gpop')) return;
    const pt = this.local(e);
    const cands = [];
    for (const [id, t] of this.targets) { let rect = null; try { rect = t.rect(); } catch { rect = null; } if (rect) cands.push({ id, t, prio: t.prio || 0, rect }); }
    // 同一处（同一个框、同一档 prio）挂着的几种按法，每种取先挂的那一个（和以前 pickTarget 一样谁先挂谁先）；
    // 正在等的那一问的点挑中了、手指又按在低一档的拖的框里：拖也算这一处的一种按法（layout.js 的 pressGroup）
    // 手指正按在一样东西的一个部件上、而它没交给学生（表里给定的格、句子里没开的词）：不往旁边找（按偏的宽容只给按在空处的一下）。
    // 第八轮起字号固定一档、东西挨得近，以前按在给定的格上会被算成旁边的空格（主线第三轮的真手指检查）
    const inside = cands.filter((c) => pt.x >= c.rect.x && pt.x <= c.rect.x + c.rect.w && pt.y >= c.rect.y && pt.y <= c.rect.y + c.rect.h);
    if (!inside.length && typeof document !== 'undefined') {
      const under = document.elementFromPoint?.(e.clientX, e.clientY)?.closest?.('[data-obj]');
      if (under?.__pid) return;
    }
    const g = pressGroup(pt, cands, { radius: e.pointerType === 'touch' ? FINGER : PEN });
    if (!g) return;
    const { hit, by } = g;
    e.preventDefault();
    try { this.stage.view.setPointerCapture(e.pointerId); } catch { /* 旧浏览器：照样靠 view 收到 move */ }
    const s = this.s = {
      id: e.pointerId, tid: hit.id, t: hit.t, rect: hit.rect, by, ids: new Set([...by.values()].map((c) => c.id)), presses: [...by.keys()],
      start: pt, c0: { x: e.clientX, y: e.clientY }, last: { x: e.clientX, y: e.clientY }, t0: now(), moved: false, dragging: false, how: null, timer: 0, frozen: false,
    };
    const k = choosePress(s.presses, {});
    if (k === 'slide' || k === 'hold') { this.begin(s, k); return; } // 只有一种：按下就开始（第一轮的手感）
    // 还要等：点的那一个先按下去（缩一下）；同一处有能拖的，镜头和老师的行先等着（不然等的这一会儿手指下面的东西被挪走）
    const tap = s.by.get('tap');
    s.t = (tap || hit).t;
    s.tid = (tap || hit).id;
    s.t.press?.(true);
    if (s.presses.length > 1) {
      s.mixed = true;
      if (s.presses.some((x) => x !== 'tap')) { this.stage.beginDrag(); s.frozen = true; }
      s.timer = setTimeout(() => this.decide(s, { moved: false, ms: HOLD_MS }), HOLD_MS);
    }
  }

  /** 还没定的一下：照这一刻定（定下以后不再变）。返回定的那一种（还等着是 null） */
  decide(s, info) {
    if (this.s !== s || s.how || s.dragging) return s.how;
    const k = choosePress(s.presses, info);
    if (k == null) return null;
    clearTimeout(s.timer);
    s.timer = 0;
    s.how = k;
    if (k === 'tap') return k;
    s.t.press?.(false);
    if (k === 'none') {
      // 同一处好几种、这一下哪种都不像（按了一会儿才滑、又没有按住再拖的）：作罢，浮一句这里能怎么按
      if (s.mixed) noteAt(this.stage, `这一下没认出来：${s.presses.map((x) => PRESS_SAY[x]).filter(Boolean).join('，或者')}`, s.rect, { bad: false });
      return k;
    }
    this.begin(s, k);
    return k;
  }

  /** 定成拖（滑、按住再拖）：从按下的那一点开始（不是定下的那一点），挪过了的跟到手指现在的地方 */
  begin(s, k) {
    const c = s.by.get(k);
    s.t = c.t;
    s.tid = c.id;
    s.how = k;
    if (!s.frozen) { this.stage.beginDrag(); s.frozen = true; }
    s.dragging = true;
    try {
      // held：等满 HOLD_MS 才托起来的（同一处还能点、滑）——画面让拎起来的那一份「弹」一下，看得出已经托起来了
      c.t.spec.start(this.stage.toWorldLive(s.c0.x, s.c0.y), { held: !!s.mixed && k === 'hold' });
      if (s.moved && this.s === s) c.t.spec.move(this.stage.toWorldLive(s.last.x, s.last.y));
    } catch (err) { this.abort(); this.stage.errors?.push({ line: 0, src: '', error: `拖的时候出错：${err.message}` }); }
  }

  move(e) {
    const s = this.s;
    if (!s || s.id !== e.pointerId) return;
    s.last = { x: e.clientX, y: e.clientY };
    const pt = this.local(e);
    if (!s.moved && Math.hypot(pt.x - s.start.x, pt.y - s.start.y) > TAP_SLOP) {
      s.moved = true;
      if (!s.dragging && !s.how) this.decide(s, { moved: true, ms: now() - s.t0 });
    }
    if (!s.dragging) return;
    e.preventDefault();
    // 一帧只跟一次手（iPad 的 pointermove 比屏幕刷新还密）
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.s !== s) return;
      try { s.t.spec.move(this.stage.toWorldLive(s.last.x, s.last.y)); } catch { /* 这一帧不跟 */ }
    });
  }

  up(e, cancelled) {
    const s = this.s;
    if (!s || s.id !== e.pointerId) return;
    // 还没定的：松手这一刻定（浏览器取消了这一下就作罢）；定成拖的（按满了才松手）当场开始、当场放下
    if (!s.dragging && !s.how) {
      if (cancelled) { s.how = 'none'; s.t.press?.(false); } else this.decide(s, { up: true, moved: s.moved, ms: now() - s.t0 });
    }
    this.s = null;
    clearTimeout(s.timer);
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; }
    try { this.stage.view.releasePointerCapture?.(e.pointerId); } catch { /* 已经放了 */ }
    if (s.dragging) {
      // 松手（或者浏览器取消了这一下）：在哪松就算拖到哪，不让东西无声地掉回去
      const at = cancelled ? s.last : { x: e.clientX, y: e.clientY };
      let r = null;
      try { s.t.spec.move(this.stage.toWorldLive(at.x, at.y)); r = s.t.spec.drop(this.stage.toWorldLive(at.x, at.y)); } catch { r = null; }
      this.stage.endDrag();
      if (r) s.t.done(r.act, r.src); else s.t.spec.cancel?.();
      return;
    }
    s.t.press?.(false);
    if (s.frozen) this.stage.endDrag();
    if (!cancelled && s.how === 'tap') s.t.onTap?.();
  }

  // 正在拖的东西被收起来了（老师换了一问、东西拿下了舞台）：放回去
  abort() {
    const s = this.s;
    if (!s) return;
    this.s = null;
    clearTimeout(s.timer);
    if (s.dragging) { try { s.t.spec.cancel?.(); } catch { /* 已经没了 */ } this.stage.endDrag(); return; }
    s.t.press?.(false);
    if (s.frozen) this.stage.endDrag();
  }
}
