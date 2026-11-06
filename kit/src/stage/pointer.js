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
import { pickTarget } from './layout.js';

const TAP_SLOP = 12; // 按下到松开挪了多少像素以内还算「点」
const FINGER = 30; // 手指按偏多远以内还算按到（屏幕像素）；鼠标、笔准一些
const PEN = 14;

export class PointerRouter {
  constructor(stage) {
    this.stage = stage;
    this.targets = new Map(); // id → { kind: 'tap' | 'drag', prio, rect() → 屏幕上的框（相对 view）, … }
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
    return () => { if (this.s?.tid === id) this.abort(); this.targets.delete(id); this.paint(); };
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
    const hit = pickTarget(pt, cands, { radius: e.pointerType === 'touch' ? FINGER : PEN });
    if (!hit) return;
    e.preventDefault();
    try { this.stage.view.setPointerCapture(e.pointerId); } catch { /* 旧浏览器：照样靠 view 收到 move */ }
    const s = this.s = { id: e.pointerId, tid: hit.id, t: hit.t, start: pt, last: { x: e.clientX, y: e.clientY }, moved: false, dragging: false };
    if (hit.t.kind === 'drag') {
      this.stage.beginDrag();
      s.dragging = true;
      try { hit.t.spec.start(this.stage.toWorldLive(e.clientX, e.clientY)); } catch (err) { this.abort(); this.stage.errors?.push({ line: 0, src: '', error: `拖的时候出错：${err.message}` }); }
    } else hit.t.press?.(true);
  }

  move(e) {
    const s = this.s;
    if (!s || s.id !== e.pointerId) return;
    s.last = { x: e.clientX, y: e.clientY };
    const pt = this.local(e);
    if (Math.hypot(pt.x - s.start.x, pt.y - s.start.y) > TAP_SLOP) { if (!s.moved && !s.dragging) s.t.press?.(false); s.moved = true; }
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
    this.s = null;
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
    if (!cancelled && !s.moved) s.t.onTap?.();
  }

  // 正在拖的东西被收起来了（老师换了一问、东西拿下了舞台）：放回去
  abort() {
    const s = this.s;
    if (!s) return;
    this.s = null;
    if (s.dragging) { try { s.t.spec.cancel?.(); } catch { /* 已经没了 */ } this.stage.endDrag(); } else s.t.press?.(false);
  }
}
