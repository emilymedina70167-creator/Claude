// 舞台的画面（docs/stage-plan.md）：照着场景（scene.js）演。一整块屏幕是一个场景，东西不往上滚；镜头移到讲的地方；
// 老师一行一个动作，这里一个一个演（能边写边演：写完一行演一行）；学生在场景里点、拖、拨、打字，就是回答。
//
// 每一行：先在场景上 check（写错了挡下、记进 errors，别的行照演）→ 场景 apply → 有专门动作的演专门的动作
// （每种东西自己的在 types/xxx.view.js 的 choreo，共用的说话、比较、飞字在这里）→ sync 把画面对齐到场景
// （每种东西的 view.sync 造 / 改自己的节点，挪动、连线、贴字、拨数这里统一演）。
// 演过的每一行记进 log（学生拖、拨造成的变化也记成一行），刷新或作废一轮时照 log 瞬间重放（replay）。
import { sceneSpans, sceneLine, swappedLine, circled, sceneOf } from './scenes.js';
import { createLookback } from './lookback.js';
const SIDE_PAD = 20; // 解析栏左右的留白（和 stage.css 的 .st-side 一样）
const SIDE_KEY = 'la-stage-side'; // 解析栏点开还是收着（这台设备记着）
const storedSide = () => { try { if (typeof location !== 'undefined' && /[?&]side=open\b/.test(location.search)) return true; return localStorage.getItem(SIDE_KEY) === 'open'; } catch { return false; } };
import { EASE, moveDuration, stagger, arcPoints, revealDelays, readHold, labelHold } from './motion.js';
import { bbox, grow, fitCamera, placeLabel, overlaps, linkGeom, wholeLinkGeom, CAMERA_ROOM, tooSmall, pickSide } from './layout.js';
import { gridOf, typeScaleOf } from './compose/grid.js';
import { layoutLines } from './compose/report.js';
import { sketchText } from './compose/sketch.js';
import { createSnapper } from './snap.js';
import { solveLayout } from './compose/solve.js';
import { canvasOf, composeInput, posLine, SENTENCE_WIDTHS } from './compose/apply.js';
import { parseScript, parseRich, richLength } from './script.js';
import { Scene, compareValues, COLOR_NAMES, pidOf, expectHit, pickAnswer, tapAnswer, pickText, unplayedNotes, compareFact, compareNote, mergeFact, chipTextOf, tapValueOf } from './scene.js';
import { goalMark, shapeText } from './goal.js';
import { measureShown, rulesOf } from './rules.js';
import { judgeAnswer, sameAnswer, answerInput, gridAnswerText, asksBack } from './answer.js';
import { formulaInput, formulaGrid, hideFormulaPad } from '../formulainput.js';
import { varText, pickNow } from './pick.js';
export { sameAnswer };
import { VIEWS } from './types/views.js';
import { PointerRouter } from './pointer.js';
import { armGesture, noteAt } from './gesturedom.js';
import { undoPlan } from './gestures.js';
import { undoneOf, handMissed } from './events.js';
import { reportError } from '../errlog.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const svg = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tr = (x, y, s = 1) => `translate(${x}px, ${y}px)${s !== 1 ? ` scale(${s})` : ''}`;
// 世界坐标里一个 SVG 东西占的地方：getBBox 不管 transform、也不管 clip-path（平面的网格线画得很长、靠 clip-path 只露出一块），
// 所以一层一层往下走：每个东西的框用 getCTM（到 under 那层 svg，就是世界坐标；transform 属性和 CSS 的 translate 都在里面）换过去，
// 有 clip-path 的只算裁剩的那块
function mapBox(b, m) {
  if (!m) return { x: b.x, y: b.y, w: b.width, h: b.height };
  const pts = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
function svgBox(n, depth = 0) {
  if (!(n instanceof SVGGraphicsElement) || depth > 8) return null;
  if (getComputedStyle(n).display === 'none') return null;
  let m = null;
  try { m = n.getCTM(); } catch { m = null; }
  const clipRef = n.getAttribute('clip-path')?.match(/url\(#([^)]+)\)/)?.[1];
  if (clipRef) {
    let b, c;
    try { b = n.getBBox(); c = document.getElementById(clipRef)?.getBBox(); } catch { b = null; }
    if (!b) return null;
    const box = mapBox(b, m);
    if (!c) return box;
    const cl = mapBox(c, m);
    const x = Math.max(box.x, cl.x), y = Math.max(box.y, cl.y), x2 = Math.min(box.x + box.w, cl.x + cl.w), y2 = Math.min(box.y + box.h, cl.y + cl.h);
    return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
  }
  const kids = [...n.children].filter((k) => k instanceof SVGGraphicsElement);
  if (kids.length && (n.tagName === 'g' || n.tagName === 'svg')) return bbox(kids.map((k) => svgBox(k, depth + 1)).filter(Boolean));
  let b;
  try { b = n.getBBox(); } catch { return null; }
  return b.width > 0 || b.height > 0 ? mapBox(b, m) : null;
}
// 节点行内的 translate（最后摆的地方；动画走的是 WAAPI，不改行内）
const transOf = (n) => { const m = String(n.style?.transform || '').match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\)/); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; };
const CAPTION_MAX = 3; // 话最多留几句在画面上（这一轮说过的，旧的淡一点）
const DOCK_ROOM = 96; // 自由构图时底下那一条（输入框、按钮）一直留的高
export const DONE_BTN = '做好了'; // 没有挑战、学生手上有没做完的东西时，页面替老师挂的那个按钮（helpLine）
export const HELP = '给个提示'; // 挑战还没做到时，页面替老师挂的那一问的按钮

/**
 * 一段讲完怎么往下走：flow 连着演（默认）、tap 停下来等学生点「接着」。
 * 2026-11-06 第一节真课学生说像放视频、来不及看就过了，先加了一段一停；学生又说一段一停也还是放片子——
 * 毛病不在快慢，在学生只能看。所以改成活的舞台（E 段：学生随时直接动、挑战当场判、老师在后台跟着），
 * 一段一停只留作选项（proto 用），课堂里不再出现
 */
export const PACES = { flow: '连着演', tap: '一段一停' };
export function storedPace() { return 'flow'; }
/** 一句写成一行指令里的字：引号挑字里没有的那一种 */
export function quoteText(t) {
  const s = String(t ?? '');
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes('」')) return `「${s}」`;
  return `"${s.replace(/"/g, '”')}"`;
}

/**
 * 页面替老师挂的那一问（一轮演完没有 ask、学生手上还有事攒着时）：q 是老师写错了没演上的那一问的话（照样留在画面上，学生用话答）；
 * 没有话、还有没做到的挑战时一个「给个提示」；都没有是「接着」。不带 ""：不动最后说的那一句（ask 带 "" 会把它清掉，
 * 老师看的现状里「最后说的话」就没了，撤一步重放以后又回来）
 */
export function helpLine(q, hasGoals, hasWork = false) {
  if (q) return `ask say ${quoteText(q)}`;
  // 没有挑战、可学生手上有交给自己做的东西还没做完（照着走的一排、开着的树）：按钮写「做好了」——「接着」像是让学生跳过去
  return hasGoals ? `ask next button="${HELP}"` : hasWork ? `ask next button="${DONE_BTN}"` : 'ask next';
}

export { COLOR_NAMES };

export class Stage {
  constructor(host, { onAct = null, onLine = null, speed = 1, input = true, pace = null, bare = false, scenesHost = null, side = null } = {}) {
    this.sideForce = side; // 'open'：栏一直开着、没有把手（回看用）
    this.scenesHost = scenesHost; // 幕条放哪（课堂给顶上那一条里留的位置；不给放在舞台自己顶上）
    // bare：嵌在别处的一小块舞台（自己练），没有上面的话、底下的输入条——镜头不给它们留地方
    this.bare = !!bare;
    // 自由构图（主线第八轮）：东西摆在哪由老师的构图意图 + 页面的求解器定，镜头固定一档字号（嵌在别处的一小块舞台照旧整台缩放）
    this.free = !this.bare;
    this.baseCam = null; // 求解器摆好时的镜头（不跟着 camera X 凑近）
    this.layoutState = null; // 最近一次摆的 { boxes, unmet, scale, grid, canvas }：现状的「版面」、预览用
    this.lastTouched = null; // 这一轮老师讲的那样东西（话默认贴着它）
    this.host = host;
    this.onAct = onAct;
    this.onLine = onLine; // 每演完老师的一行（量「第一个镜头多久出来」、收起「老师在想」）
    this.speed = speed;
    this.pace = PACES[pace] ? pace : storedPace();
    this.withInput = input;
    this.reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.instant = false; // 重放时：不演动画、不等学生
    this.scene = new Scene();
    this.scene.examCheck = this.examCheck || null; // 考情：exam= / like= 当场核（课堂读到考试资料以后挂上）
    this.log = []; // 演过的每一行 { src, by: 'teacher' | 'student' | 'page', turn }
    this.errors = []; // 这一轮没演的行 { line, src, error }
    this.turnNo = 0;
    this.nodes = new Map(); // 部件 'a:3' → 节点
    this.decors = new Map(); // 东西 id → Map(名字 → 节点)（虚框、序号、指针、树的边……）
    this.paths = new Map(); // 连线 key → path
    this.labelNodes = new Map(); // id → { node, box, sig, anchor }
    this.cam = { s: 1, tx: 0, ty: 0 };
    this.dialRuns = new Map(); // 'dial:t' / 'edit:B.2,2' → { ids：这一条路开头时还没做到的挑战（studentDo 每一下照它标 ✓ ✗）, end：停在哪 }；老师新的一轮起重新数
    this.teacherAudit = []; // 老师这一轮演的行里，页面核过不是正确的下一步的（裁判的话）：课堂下一条发给老师时带上、清掉
    this.build();
    this.noteView();
  }

  build() {
    const root = el('div', 'st-stage', this.host);
    this.root = root;
    this.view = el('div', 'st-view', root);
    this.world = el('div', 'st-world', this.view);
    this.under = svg('svg', { class: 'st-ink st-under', width: 1, height: 1 }, this.world); // 东西自己的线（树的边、坐标轴）：在格子下面
    this.layer = el('div', 'st-layer', this.world);
    this.ink = svg('svg', { class: 'st-ink', width: 1, height: 1 }, this.world); // 连线：在最上面
    this.caption = el('div', 'st-caption', this.view);
    this.caption.setAttribute('aria-live', 'polite');
    this.goalsEl = el('div', 'st-goals', this.view);
    this.goalsEl.setAttribute('aria-live', 'polite');
    this.dock = el('div', 'st-dock', this.view);
    // 横屏的解析栏（主线第六轮第 2 节）：挑战、这一幕说过的话、这一问、底下那一条搬进左边这一列；竖屏搬回 view（和以前一样）
    this.side = el('div', 'st-side', this.view);
    this.sideTitle = el('div', 'st-side-title', this.side);
    this.sideTitle.hidden = true;
    this.newest = el('button', 'st-side-newest', this.side);
    this.newest.type = 'button';
    this.newest.textContent = '回到最新 ↓';
    this.newest.hidden = true;
    this.newest.addEventListener('click', () => { this.caption.scrollTop = this.caption.scrollHeight; this.newest.hidden = true; });
    this.caption.addEventListener('scroll', () => { if (this.sideOn && this.atBottom()) this.newest.hidden = true; });
    // 这一问的输入在栏里放不下（按格写的矩阵答案、一排长选项）：底下那一条挪到右边画面底部正中（2.9）
    this.wideDock = el('div', 'st-dock-wide', this.view);
    this.sideOn = false;
    this.sideW = 0;
    this.sideDirty = true;
    // 解析栏收放（2026-11-12 我说的：做成收放，需要的时候点开）：默认收着，画面用满整屏；左边一个把手点开，这台设备记着
    this.sideWant = this.sideForce === 'open' ? true : storedSide();
    this.sceneTalk = []; // 这一幕说过的话 { text, ask, turn }：收着的时候也记，点开栏时照它放回
    this.sideToggle = el('button', 'st-side-toggle', this.view);
    this.sideToggle.type = 'button';
    this.sideToggle.addEventListener('click', () => this.toggleSide());
    this.flyLayer = el('div', 'st-fly', this.view);
    // 幕条（主线第六轮 3.4）：这节课的几幕，一幕一个胶囊；点一个翻回去看（lookback.js）。只读的舞台（回看自己、只读翻看）不要
    this.scenesEl = el('div', 'st-scenes', this.scenesHost || root);
    this.scenesEl.hidden = true;
    // 「说过的」（第八轮）：画面上只留这一轮的话，前几轮的收进这里，点开是一张浮层列出这一幕说过的全部
    if (this.free) {
      root.classList.add('is-free');
      this.talkBtn = el('button', 'st-talk-btn', this.scenesHost || root);
      this.talkBtn.type = 'button';
      this.talkBtn.textContent = '说过的';
      this.talkBtn.hidden = true;
      this.talkPop = el('div', 'st-talk-pop', root);
      this.talkPop.hidden = true;
      this.talkBtn.addEventListener('click', () => this.toggleTalk());
      this.talkPop.addEventListener('click', (e) => { if (e.target === this.talkPop) this.toggleTalk(false); });
    }
    if (typeof MutationObserver === 'function') new MutationObserver(() => requestAnimationFrame(() => this.fitDock())).observe(this.dock, { childList: true, subtree: true });
    this.pointer = new PointerRouter(this); // 点、拖都走它（pointer.js）
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestAnimationFrame(() => { this.noteView(); this.refocus(false); })) : null;
    this.ro?.observe(this.view);
    // 老师的眼睛（第九轮）：画面一变记一笔，静下来以后后台拍一张（snap.js）；嵌在别处的一小块舞台（自己练）不拍
    if (this.free && typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      this.snapper = createSnapper(this);
      new MutationObserver(() => { if (!this.instant) this.snapper.dirty(); }).observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    }
  }
  destroy() { this.snapper?.stop(); this.ro?.disconnect(); this.resetOpens(); this.root.remove(); this.scenesEl?.remove(); this.talkBtn?.remove(); this.keysPop?.remove(); this.cancelWait?.(); this.cancelBeat?.(); }
  setPace(p) {
    if (!PACES[p]) return;
    this.pace = p;
    if (p !== 'tap') this.cancelBeat?.(); // 正停着等学生：换成连着演就接着往下
  }

  // —— 动画：都走这一个口（速度、「减少动态」、重放统一管）——
  dur(ms) { return this.instant ? 0 : this.reduced ? 1 : Math.max(1, ms / this.speed); }
  wait(ms) { return this.instant ? Promise.resolve() : sleep(this.dur(ms)); }
  tween(node, frames, { duration = 500, delay = 0, easing = EASE.move } = {}) {
    if (!node || !frames.length) return Promise.resolve();
    const last = frames[frames.length - 1];
    // 动画停在最后一帧；完全不透明就不留在行内（不然盖住样式里的「灰掉」「淡」）
    const apply = () => { for (const [k, v] of Object.entries(last)) if (k !== 'offset' && k !== 'easing') node.style[k] = k === 'opacity' && String(v) === '1' ? '' : v; };
    if (this.instant || typeof node.animate !== 'function') { apply(); return Promise.resolve(); }
    const a = node.animate(frames, { duration: this.dur(duration), delay: this.dur(delay), easing, fill: 'both' });
    return a.finished.catch(() => {}).then(() => { apply(); a.cancel(); });
  }

  // —— 部件的节点（每种东西的 view 用）——
  pid(p) { return pidOf(p); }
  nodeOf(p) { return this.nodes.get(pidOf(p)); }
  partNode(p, create) {
    const k = pidOf(p);
    let n = this.nodes.get(k);
    if (!n) { n = create(); n.__pid = k; n.__obj = p.obj; n.dataset.obj = p.obj; this.nodes.set(k, n); }
    n.__live = this.syncMark;
    return n;
  }
  decor(objId, key, create) {
    let m = this.decors.get(objId);
    if (!m) { m = new Map(); this.decors.set(objId, m); }
    let n = m.get(key);
    if (!n && create) { n = create(); n.dataset.obj = objId; m.set(key, n); } // 记着是谁的（排版检查按它算每样东西实际占的地方）
    return n;
  }
  dropDecor(objId, test = () => true) {
    const m = this.decors.get(objId);
    if (!m) return;
    for (const [k, n] of m) if (test(k)) { m.delete(k); this.tween(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => n.remove()); }
  }
  /** 拿掉一个部件的节点：从它现在的透明度淡掉（已经缩没、淡没的直接删，不会闪回来） */
  dropNode(pid) {
    const n = this.nodes.get(pid);
    if (!n) return;
    this.nodes.delete(pid);
    const op = Number(getComputedStyle(n).opacity);
    if (this.instant || !(op > 0.02)) { n.remove(); return; }
    this.tween(n, [{ opacity: op }, { opacity: 0 }], { duration: 220 }).then(() => n.remove());
  }
  // 共用的几种样子：染色、点亮、抬起、灰掉、扣过去（像翻一张牌）
  flagPart(n, x, ctx) {
    const was = n.dataset.paint || null;
    if (x.paint) n.dataset.paint = x.paint; else delete n.dataset.paint;
    n.classList.toggle('is-glow', !!x.glow);
    n.classList.toggle('is-lift', !!x.lift);
    n.classList.toggle('is-dim', !!x.dim);
    n.classList.toggle('is-slip', !!x.slip); // 学生走偏的那一下淡淡圈着（open … wrong=mark，scene.js 的 slip）
    // 学生一次点的几样（ask pick 交了，scene.js 的 picked）：圈着；reveal=on 时之后第一下改了它们，没变的那几个画虚线淡掉
    n.classList.toggle('is-pick', !!x.pick);
    n.classList.toggle('is-pick-same', x.pick === 'same');
    if (was !== (x.paint || null) && !this.instant && ctx?.cmd === 'paint') ctx.jobs.push(this.pulse(x, stagger(ctx.jobs.length, { step: 50 })));
    if (!!n.__covered !== !!x.covered) {
      n.__covered = !!x.covered;
      if (this.instant || !n.__box || n.tagName === 'g' || n instanceof SVGElement) n.classList.toggle('is-covered', !!x.covered);
      else {
        const t = tr(n.__box.x, n.__box.y);
        ctx?.jobs.push((async () => {
          await this.tween(n, [{ transform: `${t} rotateY(0deg)` }, { transform: `${t} rotateY(90deg)` }], { duration: 180, delay: stagger(ctx.jobs.length, { step: 60 }), easing: EASE.in });
          // 换面按场景现在的样子（同一格可能同时被扣上又翻开：& 并着演的两行）
          n.classList.toggle('is-covered', !!x.covered);
          await this.tween(n, [{ transform: `${t} rotateY(-90deg)` }, { transform: t }], { duration: 220, easing: EASE.out });
        })());
      }
    }
    // 话里、字里指着它的小块跟着变色、变值
    this.root.querySelectorAll(`.st-chip[data-cell="${CSS.escape(pidOf(x))}"]`).forEach((ch) => {
      if (x.paint) ch.dataset.paint = x.paint; else delete ch.dataset.paint;
      if (ch.dataset.group || ch.closest('.st-caption, .st-goals')) return; // 话里说的那一刻是多少就是多少
      const t = this.chipText(x);
      if (ch.textContent !== t) ch.textContent = t;
    });
  }
  chipText(p) { return chipTextOf(p, this.scene.objects.get(p.obj)); }

  // —— 演一段（整段写好的） ——
  async play(src, { by = 'teacher', auto = false, unpick = true } = {}) {
    const t = this.begin({ by, auto, unpick });
    return t.end(src);
  }

  /**
   * 开一轮：老师边写边演。push(到现在为止写出来的全部文字) 每写完一行就演一行；end() 等这一轮演完、等到学生回答。
   * 返回 { push, end, abort }；end() 的结果是 { act, errors, lines }。
   * unpick：这一轮演完收掉学生上一次点的几样（ask pick 的圈）；不是老师的一轮（刷新以后重新挂那一问、连不上时那一问）写 false。
   * anyOpts：这一轮的行不查选项名（刷新以后重新挂 log 里的那一问：旧课当时收下的，照样收下）
   */
  begin({ by = 'teacher', auto = true, unpick = true, anyOpts = false } = {}) {
    const turn = ++this.turnNo;
    const mark = this.log.length;
    // 学生点的几样（ask pick）reveal=on、这一轮开始时还没揭晓：这一轮演完不收（end 里看）。在开始这一刻定——这一轮里老师自己演出变化
    // 揭晓了（insert t 47、say "你看圈"），这一轮演完学生才开始看虚实，留到下一轮演完再收（最后一审 I1）
    const unrevealedAtBegin = !!(this.scene.picked?.reveal && !this.scene.picked.diffDone);
    this.errors = [];
    // 这一轮开头台上有哪几样（演完以后台上全换了、又没写 scene：现状里说一句，scenes.js 的 swappedLine）
    const idsAtBegin = by === 'teacher' ? [...this.scene.objects.keys()] : null;
    if (by === 'teacher') this.sideDirty = true; // 横屏栏宽在一轮开头重算一次
    const openSeq0 = Math.max(0, ...[...this.scene.opens.values()].map((e) => e.seq || 0)); // 这一轮新开的手（showHow）
    if (by === 'teacher') this.scene.swapNote = '';
    this.scene.loose = []; // 话里还没着落的名字只算这一轮的（上一轮作废了留下的不算）
    // 叫老师之前那一段学生做的事刚发出去：拨数、拨格子的路从头数（和课堂循环攒的那一段对齐）
    this.dialRuns = new Map();
    // 老师这一轮演完以前不能撤（重放会把演到一半的这一轮整个重来）；演完了 end 里再定这一回合从哪儿起
    this.undoFloor = Infinity;
    this.syncUndo();
    let taken = 0;
    // 先等学生刚才那一下、做到挑战时预写的行演完，老师新写的才接着演（不叠在一起）
    let chain = Promise.all([this.studentChain, this.reacting]).catch(() => {});
    let running = null;
    let asked = null; // 这一轮演上了的那一问（一轮以它结尾：它后面的行不演）
    let askedBad = null; // 这一轮第一条没演上的 ask（写错了）：后面的行照演，后面有演上的问就挂那一问（主线第一轮 D3-3、D4-5）
    let lines = 0;
    let dead = false; // 这一轮作废了（不是指定的模型）：后面的行不演
    let said = false; // 这一轮已经开口说过：再有一句 say 就是新的一段，开演之前停下来
    let askRightAt = null; // 这一轮第一行 @ask.right（演完以后它没着落，报在这一行上）
    const goalAt = new Map(); // 这一轮写的挑战在第几行（on= 的按钮学生手上没有，报在那一行上）
    let beat = null; // 正在演的这一段 { start: 开演时 log 多长, cmds }：「再看一遍」照它倒回去重演
    let armedResolve;
    const armed = new Promise((r) => { armedResolve = r; }); // 这一轮演完、在等学生了（或者作废了）
    const run = (c) => {
      const rec = { c, ok: true };
      if (by === 'teacher') (beat ||= { start: this.log.length, cmds: [] }).cmds.push(rec);
      return this.exec(c, { by, turn }).then((r) => {
        if (r === null) rec.ok = false;
        // 一轮以演上了的那一问结尾。以前 ask 一进队就算问过了：写错的 ask 把后面的行全吞掉，学生点什么都没反应
        if (c.cmd === 'ask' && !c.on) { if (r === null) askedBad ||= c; else asked = c; }
        return r;
      });
    };
    let lastBatch = null; // 上一行所在的那一批（& 的行跟着它）
    const afterAsk = (c) => { this.errors.push({ line: c.line, src: c.src?.trim(), error: 'ask 之后的行不演（一轮以 ask 结尾）' }); };
    const enqueue = (c) => {
      if (dead) return;
      if (asked) { afterAsk(c); return; }
      if (c.on === 'ask.right' && !askRightAt) askRightAt = { line: c.line, src: c.src?.trim() };
      if (c.cmd === 'goal' && !c.on) { const id = (c.args || []).find((a) => a.t === 'word')?.v; if (id) goalAt.set(id, { line: c.line, src: c.src?.trim() }); }
      lines++;
      // & 开头的行和它**上一行**同时演（lastBatch：上一行所在的那一批）。边写边演时上一行可能还排着没开演：
      // 先记在那一批上，等它开演时一起演。以前是接到「正在演的那一批」上——那可能是好几行以前的一行，
      // 这一行就抢在前面还没演的行之前执行了（真课：sentence p 还没造，& paint p.8-9 先演，报「不是舞台上的东西」）。
      // 上一行已经演完了就自己成一批；接在一问上的照旧不演（那一问演没演上还不知道，不能和它一起演）
      if (c.par && lastBatch && !lastBatch.done) {
        if (lastBatch.ask) afterAsk(c);
        else if (lastBatch === running) lastBatch.jobs.push(run(c));
        else lastBatch.extra.push(c);
        return;
      }
      const pause = by === 'teacher' && c.cmd === 'say' && !c.on && said;
      if (c.cmd === 'say' && !c.on) said = true;
      const batch = lastBatch = { jobs: [], extra: [], done: false, ask: c.cmd === 'ask' && !c.on };
      chain = chain.then(async () => {
        if (dead) return;
        // 前面那一问演上了（演完才知道）：这一行不演（跟着它的 & 行也不演，都说一声）
        if (asked) { afterAsk(c); for (const x of batch.extra.splice(0)) afterAsk(x); batch.done = true; return; }
        if (pause) {
          await this.beat(beat, { by, turn, alive: () => !dead });
          beat = null;
          if (dead) return;
        }
        running = batch;
        batch.jobs.push(run(c));
        // 这一批还排着的时候写出来的 & 行：和它一起演
        for (const x of batch.extra.splice(0)) batch.jobs.push(run(x));
        // & 开头的行可能在这一批开演以后才写出来：等到这一批的活都演完（期间新并进来的也等）
        for (let k = 0; k < batch.jobs.length; k++) await batch.jobs[k];
        batch.done = true;
        running = null;
      });
    };
    const feed = (text, final) => {
      const all = stageLines(text);
      const done = final ? all : all.slice(0, -1);
      const fresh = done.slice(taken);
      taken = done.length;
      if (!fresh.length) return;
      const cmds = parseScript(fresh.map((l) => (l == null || !l.trim() ? '#' : l)).join('\n'));
      const base = taken - fresh.length;
      for (const c of cmds) enqueue({ ...c, line: c.line + base, src: c.src ?? fresh[c.line - 1], ...(anyOpts ? { anyOpts: true } : {}) });
    };
    let last = '';
    const end = async (text) => {
      if (dead) return { act: null, errors: [], lines, mark, dead: true };
      feed(text != null ? text : last, true);
      await chain;
      // 话里光秃秃的名字到这一轮演完还不是拨数、也不是舞台上的东西（拼错了）：告诉老师，那一行照演了（同一轮后面才造的不报）
      if (!dead && !this.instant) this.errors.push(...this.scene.looseProblems());
      // @ask.right 没着落（这一轮没有 ask、拿走它的那一问页面判不了对错）：当场告诉老师，丢掉（不能挂到下一轮的一问上，也不能被页面替它挂的那一问拿走）
      if (!dead && !this.instant) {
        const bad = this.scene.askRightProblem();
        if (bad) {
          this.errors.push({ line: askRightAt?.line ?? 0, src: askRightAt?.src || '@ask.right …', error: bad });
          this.scene.dropAskRight();
        }
      }
      if (!dead && idsAtBegin && !this.instant) this.showHow(openSeq0);
      if (!dead && idsAtBegin) this.scene.swapNote = swappedLine(idsAtBegin, [...this.scene.objects.keys()], this.log.slice(mark).some((r) => sceneOf(r.src)));
      // 学生上一次点的几样（ask pick）圈到老师这一轮演完：照一行 unpick 收掉，记进这一轮的 log（刷新照它放回）。
      // 这一轮里才交的不收（上一问还挂着时学生交的，老师还没看到）。reveal=on 还没揭晓的不收（第三次量 D2/幕1：猜错了叫老师，
      // 老师这一轮演完圈就没了，学生插进去以后看不到哪几个变了）：留到之后第一下改了它们、揭晓了，再下一轮演完才收；
      // 这一轮开始时还没揭晓、这一轮里才揭晓的（学生的一下、老师的行）也算这一种。不收就没有这一行，刷新照样留着
      const unrevealed = unrevealedAtBegin || (this.scene.picked?.reveal && !this.scene.picked.diffDone);
      if (!dead && unpick && this.scene.picked && !unrevealed && !this.log.slice(mark).some((r) => /^pick\b/.test(r.src))) {
        const [c] = parseScript('unpick');
        await this.exec({ ...c, line: 0, src: 'unpick' }, { by: 'teacher', turn });
      }
      // 撤一步只撤这以后学生做的（老师看过、照它讲了的不撤；和课堂循环这一段从 log 的哪里开始是同一处）
      if (!dead) { this.undoFloor = this.log.length; this.syncUndo(); }
      let act = null;
      // 这一轮写了问、可一条都没演上：学生手上没有老师要的那一问（课堂循环看这个马上再叫老师，loop.js）
      this.askMissed = false;
      this.handMissed = false;
      if (!this.instant && !dead && (asked || askedBad || auto)) {
        if (!this.scene.waiting) {
          // 一轮没有 ask，或者 ask 那一行写错了没演上：页面替它等，不让课停在半空。
          // 写错的那一问照样把问题留在画面上，学生用话答（第一节真课 `ask tap q#2 q#3 "哪一句说得对？"` 写错了，问题没了、也没有按钮，课就停住了）；
          // 挑战还没做到：学生在画面上试，旁边一个「给个提示」（helpLine：不带话，最后说的那一句还在）
          const q = askedBad ? (askedBad.args || []).find((a) => a.t === 'str')?.v : '';
          const src = helpLine(q, this.pendingGoals().length > 0, undoneOf(this.scene).length > 0);
          const [c] = parseScript(src);
          await this.exec({ ...c, line: 0, src }, { by: 'page', turn });
          // 现状里照实写：这一问是页面替老师挂的，不是老师问的
          // 真替老师挂了那一问才算「提问没演上、学生手上只有页面替挂的框」（上一问还挂着时不算：学生手上有那一问）
          if (askedBad && this.scene.waiting) { this.scene.waiting.standin = true; this.askMissed = true; }
        }
        // 交给学生的手没演上、学生手上没东西可动（主线第七轮）：课堂循环看这个马上叫老师重写
        this.handMissed = by === 'teacher' && handMissed(this.errors, this.scene);
        // on= 写的按钮学生手上没有：这个挑战判不了，告诉老师（报在写它的那一行上，这一轮没写就报那个挑战）
        for (const msg of this.scene.onProblems({ once: true })) {
          const id = msg.match(/^挑战 (\S+)/)?.[1];
          const at = goalAt.get(id);
          this.errors.push({ line: at?.line ?? 0, src: at?.src || `goal ${id} …`, error: msg });
        }
        armedResolve();
        act = await this.armWait();
      }
      armedResolve();
      return { act, errors: [...this.errors], lines, mark };
    };
    const abort = async () => { dead = true; this.cancelBeat?.(); await chain.catch(() => {}); armedResolve(); await this.rollback(mark); };
    // 还一行没演就不要了（学生在老师想的时候又做了事，这一轮写的已经过时）：不退回——学生这期间动过的照样留着
    const drop = () => { dead = true; armedResolve(); };
    return { push: (text) => { if (!dead) { last = text; feed(text, false); } }, end, abort, drop, turn, mark, armed };
  }

  /**
   * 一段演完、下一段开演之前：停下来等学生点「接着」（点舞台上空的地方也行），「再看一遍」把这一段倒回去重演。
   * 自动往下时停一会儿就走。话一轮里一直留着，所以学生停多久都看得到刚才说了什么
   */
  async beat(prev, { by, turn, alive }) {
    if (this.instant || this.pace !== 'tap') return;
    for (;;) {
      const choice = await new Promise((resolve) => {
        const bar = el('div', 'st-beat', this.dock);
        const again = prev?.cmds.some((x) => x.ok) ? el('button', 'st-beat-again', bar) : null;
        if (again) { again.type = 'button'; again.textContent = '↺ 再看一遍'; }
        const go = el('button', 'st-next st-beat-go', bar);
        go.type = 'button';
        go.textContent = '接着 ›';
        this.tween(bar, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 300, easing: EASE.out });
        let over = false;
        const onView = (e) => { if (!e.target.closest?.('.st-dock, button, input, .st-chip, .st-word')) done('go'); };
        const done = (k) => {
          if (over) return;
          over = true;
          this.view.removeEventListener('pointerup', onView);
          bar.remove();
          this.cancelBeat = null;
          resolve(k);
        };
        go.addEventListener('click', () => done('go'));
        again?.addEventListener('click', () => done('again'));
        this.view.addEventListener('pointerup', onView);
        this.cancelBeat = () => done('go');
        this.keepInView();
      });
      if (choice !== 'again' || !alive()) return;
      await this.rewatch(prev, { by, turn });
      if (!alive()) return;
    }
  }
  /** 把刚演完的一段倒回去再演一遍：先瞬间退回这一段开演之前，再照原来的先后（& 的照样一起）演 */
  async rewatch(beat, { by, turn }) {
    // 这一轮前几段话里没着落的名字（拼错的 {kk}）：瞬间放回（lenient）不记，存一份并回去，这一轮演完照样告诉老师（最后一审 M4）；
    // 重演的这一段再记一遍，looseProblems 按行去重
    const loose = this.scene.loose;
    await this.replay(this.log.slice(0, beat.start));
    this.scene.loose = [...loose];
    let jobs = [];
    for (const { c, ok } of beat.cmds) {
      if (!ok) continue;
      if (c.par && jobs.length) { jobs.push(this.exec(c, { by, turn })); continue; }
      await Promise.all(jobs);
      jobs = [this.exec(c, { by, turn })];
    }
    await Promise.all(jobs);
  }

  /** 作废这一轮：照 log 退回这一轮开始之前的样子 */
  async rollback(mark) {
    this.cancelWait?.();
    this.cancelBeat?.();
    this.teacherAudit = []; // 作废的那一轮不进对话：页面核过它的几步也不说了
    await this.replay(this.log.slice(0, mark));
  }

  /**
   * 开了新的一幕（scene，主线第六轮 3.2）：场景已经把台上收干净了；画面这边收掉等着的那一问、话，舞台现状里写这是第几幕
   */
  afterScene() {
    this.sceneTalk = [];
    this.toggleTalk(false);
    this.syncTalkBtn();
    this.sideDirty = true;
    this.howSaid = new Set(); // 新的一幕：手怎么动的那一句重新可以写
    this.cancelWait?.();
    this.say('');
    this.noteScenes();
  }
  /** 舞台现状里「第几幕、前面有哪几幕」那一行（照 log 推，scenes.js）；幕条（第 3.4 节）也在这里跟着重画 */
  noteScenes() {
    const spans = sceneSpans(this.log, { title: this.lessonTitle || '开头' });
    this.scene.sceneNote = sceneLine(spans);
    this.paintScenes(spans);
    // 横屏栏顶写这一幕叫什么（有两幕以上才写；一幕时就是这节课）
    const cur = spans.length > 1 ? spans.at(-1) : null;
    this.sideTitle.hidden = !cur;
    if (cur) this.sideTitle.textContent = `第 ${cur.n} 幕 · ${cur.title}`;
  }
  /** 幕条：两幕以上才有；现在这一幕亮着；点前面的一幕翻回去看，长按看它的要点 */
  paintScenes(spans) {
    const host = this.scenesEl;
    if (!this.withInput) { host.hidden = true; return; }
    const sig = spans.map((x) => `${x.n}:${x.title}:${x.end}:${x.keys.join('|')}`).join('\u0000');
    host.hidden = spans.length < 2;
    if (host.__sig === sig) return;
    host.__sig = sig;
    host.replaceChildren();
    for (const sp of spans) {
      const b = el('button', `st-scene${sp === spans.at(-1) ? ' is-now' : ''}`, host);
      b.type = 'button';
      b.textContent = `${circled(sp.n)} ${sp.title}`;
      b.title = sp.title;
      if (sp === spans.at(-1)) { b.setAttribute('aria-current', 'step'); b.addEventListener('click', () => this.lookback?.close()); continue; } // 点现在这一幕：回到现在
      let timer = null, held = false;
      b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; this.sceneKeys(b, sp); }, 450); });
      const stop = () => clearTimeout(timer);
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointercancel', stop);
      b.addEventListener('pointerleave', stop);
      b.addEventListener('click', () => { if (held) { held = false; return; } this.look(sp.n); });
    }
    host.querySelector('.is-now')?.scrollIntoView?.({ inline: 'end', block: 'nearest' });
  }
  /** 长按一幕：弹出它的要点（只读的小框，点别处收起） */
  sceneKeys(btn, sp) {
    this.keysPop?.remove();
    const pop = el('div', 'st-scene-keys', this.root);
    pop.textContent = sp.keys.length ? '' : '这一幕没有贴重点卡';
    for (const k of sp.keys) el('p', '', pop).textContent = k;
    const r = btn.getBoundingClientRect(), R = this.root.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left - R.left, R.width - 340))}px`;
    pop.style.top = `${r.bottom - R.top + 8}px`;
    this.keysPop = pop;
    const off = () => { pop.remove(); document.removeEventListener('pointerdown', off, true); };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }
  /**
   * 翻回去看第 n 幕（3.5）：只读的一层盖上来。回看的时候课照样在下面进行；老师说了话「回到现在」上亮一个点。
   * 回看时不算「很久没动」（loop.js 看 stage.looking）；关上时把看了哪一幕、多久交给课堂（act type: look，跟着下一条告诉老师，不叫老师）
   */
  async look(n) {
    const spans = sceneSpans(this.log, { title: this.lessonTitle || '开头' });
    const sp = spans.find((x) => x.n === n);
    if (!sp || sp === spans.at(-1)) return null;
    // 回看那一层挂在 host 上（和舞台的 root 平级）：放在 root 里面的话，主舞台改字（量、拨盘、按格染色都是 root.querySelectorAll）会改到回看里的字
    this.lookback ||= createLookback(this.host, {
      onOpen: (c) => { this.looking = { ...c, since: Date.now(), logAt: this.log.length }; },
      onClose: (r) => {
        const saw = this.looking;
        this.looking = null;
        this.onAct?.({ type: 'look', n: r.n, title: r.title, ms: r.ms });
        // 回看的时候老师说了话：左边栏里那几句亮一下（话都在栏里，学生回来就看得到）
        if (saw && this.log.slice(saw.logAt).some((x) => x.by === 'teacher' && /^say\b/.test(x.src))) {
          const lines = [...this.caption.querySelectorAll('.st-line:not(.is-out)')].slice(-3);
          lines.forEach((ln, i) => this.tween(ln, [{ backgroundColor: 'color-mix(in srgb, var(--st-brand) 14%, transparent)' }, { backgroundColor: 'transparent' }], { duration: 1400, delay: i * 90 }));
        }
        this.lookDone?.();
      },
    });
    return this.lookback.open(sp, this.log, { title: this.lessonTitle || '开头' });
  }
  /** 照记录瞬间重放（刷新后放回、作废一轮后退回）：画面直接到最后的样子，不演动画、不等学生 */
  async replay(log) {
    this.lookback?.reset();
    this.instant = true;
    this.clearAll();
    this.log = [];
    // ask 不重放（不等学生），可它问的那句话是画面的一部分：最后一句是 ask 问的，就照样写在上面（只读回看、刷新以后看得到问了什么）
    let asked = null;
    for (const row of log) {
      for (const c of parseScript(row.src)) {
        // @g1 ask 是记着的（做到挑战才演）：照样记回去，不算已经问过的那一问
        if (c.cmd === 'ask' && !c.on) {
          try { const s = this.scene.clone(); s.apply({ ...c, lenient: true }); asked = s.waiting?.prompt || asked; } catch { /* 这一行当时就没演 */ }
          // 这一问不重放：它拿走的 @ask.right（连同里面套着的）一并丢掉（不然挂到刷新以后的下一问上，演出上一问的确认）
          this.scene.skipAsk();
          continue;
        }
        if (c.cmd === 'say') asked = null;
        // replay：刷新重放（不借 lenient）。挑战成立、东西做完时照第一轮把预写的行拿掉不演（当时演了的行本来就在 log 里），也不说「没演」
        // 当时是舞台演的预写的行（log 里记 pre）：照样带 prewrite（演出 goal g2 时捡套着的 @g2 的行，和当时一样）
        await this.exec({ ...c, lenient: true, replay: true, ...(row.pre ? { prewrite: true } : {}) }, { by: row.by, turn: row.turn, open: row.open || null });
      }
    }
    if (asked) await this.say(asked, { ask: true });
    this.noteScenes();
    this.instant = false;
    if (Number.isFinite(this.undoFloor)) this.undoFloor = Math.min(this.undoFloor, this.log.length); // 老师正演着的一轮里重放（作废、再看一遍）：照样不能撤
    this.scene.waiting = null;
    this.armedFor = null;
    this.armedP = null;
    await this.sync();
    await this.settle();
    this.syncOpens();
    await this.refocus(false);
  }
  clearAll() {
    this.scene = new Scene();
    this.scene.examCheck = this.examCheck || null; // 考情：exam= / like= 当场核（课堂读到考试资料以后挂上）
    this.noteView(); // 重放时照同一个屏幕摆（摆新东西要看屏幕多大：横屏东西多了另起一列）
    this.nodes.forEach((n) => n.remove()); this.nodes.clear();
    this.decors.forEach((m) => m.forEach((n) => n.remove())); this.decors.clear();
    this.paths.forEach((p) => p.remove()); this.paths.clear();
    this.labelNodes.forEach((l) => l.node.remove()); this.labelNodes.clear();
    this.caption.replaceChildren();
    this.sceneTalk = [];
    this.caption.style.paddingLeft = ''; this.caption.style.removeProperty('--cap-left'); this.camSide = false; // 横屏「挑战留在左边」的摆法跟着清
    this.captionTurn = null;
    this.goalsEl.replaceChildren();
    this.resetOpens();
    this.dock.replaceChildren();
  }

  // —— 拖的时候：镜头不挪（手指下面的东西不能被挪走）、老师写的下一行等手指松开 ——
  beginDrag() {
    // 镜头正走到一半：停在现在的样子，坐标照它算（不然东西跳离手指）；松手以后再照现在的样子框一次
    // （同一处几种按法时按下去就先停住镜头，最后可能只是点一下，不能让镜头停在半路）
    const live = this.liveCam();
    const moving = this.world.getAnimations?.() || [];
    if (moving.length) this.camLater = true;
    moving.forEach((a) => a.cancel());
    this.world.style.transform = tr(live.tx, live.ty, live.s);
    this.cam = live;
    this.dragging = true;
    this.dragDone = new Promise((r) => { this.dragRelease = r; });
  }
  endDrag() {
    this.dragging = false;
    this.dragRelease?.();
    if (this.camLater) { this.camLater = false; this.keepInView(); }
  }
  /** 镜头现在真正的样子（动画走到一半也对）：读 world 算出来的 transform */
  liveCam() {
    const t = typeof getComputedStyle === 'function' ? getComputedStyle(this.world).transform : '';
    const m = t && t !== 'none' && t.match(/matrix\(([^)]+)\)/);
    if (!m) return { ...this.cam };
    const [a, , , , e, f] = m[1].split(',').map(Number);
    return { s: a || this.cam.s, tx: e, ty: f };
  }
  /** 屏幕上的一点（clientX / clientY）→ 世界坐标，按镜头现在真正的样子 */
  toWorldLive(clientX, clientY) {
    const r = this.view.getBoundingClientRect(), c = this.liveCam();
    return { x: (clientX - r.left - c.tx) / c.s, y: (clientY - r.top - c.ty) / c.s };
  }
  /** 世界坐标 → 屏幕上（相对 view），按镜头现在真正的样子 */
  toScreenLive(p) { const c = this.liveCam(); return { x: p.x * c.s + c.tx, y: p.y * c.s + c.ty }; }
  /** 一个节点现在在屏幕上的框（相对 view） */
  screenRect(n) {
    if (!n?.isConnected) return null;
    const r = n.getBoundingClientRect(), v = this.view.getBoundingClientRect();
    return { x: r.left - v.left, y: r.top - v.top, w: r.width, h: r.height };
  }
  /** 一个部件挂成能拖的（每种东西的 view.dragSpec 管怎么跟着手、放下算什么）；返回收起的函数 */
  armDrag(view, part, peers, done, { prio = 1 } = {}) {
    const spec = view?.dragSpec?.(this, part, peers);
    if (!spec) return () => {};
    const pid = pidOf(part);
    const mark = (on) => this.nodes.get(pid)?.classList.toggle('is-drag', on);
    mark(true);
    const off = this.pointer.add({ kind: 'drag', prio, spec, done, rect: () => spec.rect?.() || this.screenRect(this.nodes.get(pid)) });
    return () => { off(); mark(false); };
  }

  // —— 一行 ——
  // act / told：学生的那一下（studentDo）——裁判的结论挂到 act 上，场景改好了（或者没让做）就 told()，课堂这时才收到这一下。
  // open：学生这一下是从哪一项 open 来的（照那一项老师定的 wrong=），记进 log，重放时照它
  async exec(c, { by = 'teacher', turn = this.turnNo, act = null, told = null, open = act?.open || null } = {}) {
    if (by !== 'student' && this.dragging) await this.dragDone;
    // 学生的一下先过裁判（scene.js 的 judgeLine）：不合这个世界的规则、老师写了 wrong=block 又走偏了的不演、弹回去（不记进 log）。
    // 重放时学生的行照样过（淡淡圈着的、预写的「做对一步」和当时一样）；老师的行只在当场核，重放不核
    const judged = by === 'student' ? this.scene.judgeLine(c, { by, open }) : undefined;
    if (judged && act) judgedAct(act, judged);
    if (judged?.failed && !this.instant) reportError(judged.failed, { what: `舞台的规则判学生这一下时出错：${judged.src}` });
    if (judged && !judged.apply) {
      if (act) act.blocked = true;
      told?.();
      if (!this.instant) await this.snapBack(judged.obj);
      return { blocked: true, judged };
    }
    const err = this.scene.check(c);
    if (err) {
      if (by === 'student' && !this.instant) {
        // 学生的一下过了裁判、场景却演不了（页面造的行很少会这样）：不算进老师没演的行；记在这一下上（告诉老师「没演上」），
        // 学生那边说一句中性的话（以前没声没息：拖的东西不动、也没人说为什么），记进出错记录
        if (act) act.error = err;
        told?.();
        noteAt(this, '这一下没演上，再试一次', null, { bad: false });
        reportError(new Error(err), { what: `舞台：学生的一下过了裁判却演不了：${c.src?.trim() || ''}` });
        const id = judged?.obj || this.scene.ownTarget(c);
        if (id) await this.snapBack(id);
        return null;
      }
      this.errors.push({ line: c.line, src: c.src?.trim(), error: err });
      told?.();
      return null;
    }
    const pre = this.capture();
    // 这一行之前东西都在哪（镜头先走的时候连「之前」一起框，见 keepInView 的 extra）
    const before = this.instant || !this.scene.objects.size ? null : bbox(this.scene.shownIds().map((id) => this.scene.objectBox(id)));
    // open 也交给场景：老师写的 keep … after=place 认学生这一下是从哪一项来的
    const fx = this.scene.apply(c, by === 'student' ? { by: 'student', judged: judged ?? null, open } : { by: this.instant || by !== 'teacher' ? null : by });
    this.execTurn = turn;
    // 学生这一下引出了预写的行、做到了挑战、做完了：记在这一行上，撤一步撤不了它（预写只演一次，「做到了」也已经告诉课堂）
    const reacted = by === 'student' && !!(fx?.goalsMet?.length || fx?.done?.length || fx?.reactions?.length);
    this.log.push({ src: c.src?.trim() || '', by, turn, ...(by === 'student' && open ? { open } : {}), ...(reacted ? { reacted: true } : {}), ...(c.prewrite ? { pre: true } : {}) });
    // 写法容错照演了的（第一节真课碰到的两种，script.js / scene.js）：告诉老师下次怎么写，学生那边照常
    const forgiven = c.forgiven || fx?.forgiven;
    if (forgiven && by === 'teacher' && !this.instant) this.errors.push({ line: c.line, src: c.src?.trim(), kept: true, error: FORGIVEN[forgiven] });
    if (c.cmd === 'scene' && fx?.scene != null) this.afterScene();
    // 这一轮老师讲的那样东西（话默认贴着它）：摆位置、挑战、说话的行不算
    if (by === 'teacher' && !c.on && !['place', 'preview', 'pos', 'goal', 'watch', 'say', 'ask', 'scene', 'remove'].includes(c.cmd)) { const t = fx?.created ? fx.id : this.targetOf(c)?.id; if (t) this.lastTouched = t; }
    if (fx?.created) this.sideDirty = true; // 造了新东西：横屏栏宽重算一次
    if (by === 'teacher' && !this.instant) {
      this.onLine?.(c);
      if (this.looking) this.lookback?.markNew();
      // 老师的这一步不是正确的下一步：照演（可能是故意演错），下一条发给老师时说一声
      for (const f of fx?.judged?.facts || []) if (this.teacherAudit.length < AUDIT_MAX && !this.teacherAudit.includes(f)) this.teacherAudit.push(f);
      if (fx?.judged?.failed) reportError(fx.judged.failed, { what: `舞台的规则核老师这一行时出错：${fx.judged.src}` });
    }
    if (!this.instant) for (const e of fx?.ruleErrors || []) reportError(e, { what: `舞台的规则出错：${c.src?.trim() || ''}` });
    if (act) {
      // 这一下以后写给老师的事实（factsOf：裁判交的、ask pick 以后第一次变的、拖去比、并同类项）。
      // pickDiff 另记一份：拨数连着几下并成一条路时只写最后一下的事实，这一句落在前几下也要留着（events.js 的 pathRow）
      const facts = factsOf(fx);
      if (facts.length) act.facts = facts;
      if (fx?.pickDiff) act.pickDiff = fx.pickDiff;
      if (fx?.derived?.length) act.derived = slimDerived(fx.derived);
      if (fx?.back) act.summary = fx.back.summary; // 按「回到……」：回到以后的样子（actText 写给老师）
      if (fx?.hidden) act.hidden = fx.hidden; // 点开看怎么算碰到扣着的格：学生那边演成 ?，写给老师照实说是几（hiddenText）
      if (fx?.onGoals) act.onGoals = fx.onGoals.map(({ id, met, status }) => ({ id, met, status })); // 按了按钮才判的挑战
      // 学生这一下做到了挑战、收集型收了一张、做完了：往前走了一步，课堂循环数「试了好多下」从这一下以后重数（events.js 的 tryCount）。
      // 课堂循环收到这一下（told）时 onGoal 还没来，不记在这一下上，第 8 下正好做到的也会被说成「试了 8 下还没做到」
      if (by === 'student') { const got = [...(fx?.goalsMet || []), ...(fx?.collected || []), ...(fx?.done || [])]; if (got.length) act.reached = got; }
    }
    // 老师的行（连预写的行）让挑战成立、让东西做完了：预写的行拿掉没演（只在学生的一下演），跟着下一条告诉老师
    if (!this.instant) for (const t of unplayedNotes(fx)) this.onNote?.(t, { turn });
    // 老师（连预写的行）这一下改了学生先点的几样：写成一句交给课堂，跟着下一条告诉老师（不叫老师，loop.js 的 onNote）
    // 老师自己写的 compare：比出来的结果写成一句，跟着下一条告诉老师（以前只是动画）
    if (c.cmd === 'compare' && by !== 'student' && !this.instant) { const t = compareNote(this.scene, fx); if (t) this.onNote?.(t, { turn }); }
    if (fx?.pickDiff && fx.pickTell && by !== 'student' && !this.instant) this.onNote?.(`${fx.pickDiff}（你演的 ${c.src?.trim() || c.cmd}）`, { turn });
    told?.();
    try {
      const choreo = c.on ? null : this.choreoOf(c, fx); // @g1 的行只是记着，不演
      // 镜头先走：场景已经是这一行之后的样子，镜头这就开始挪，和东西一起动（以前等东西动完才挪，中间一段东西跑出屏幕）
      if (!this.instant && !c.on && c.cmd !== 'camera' && !fx?.created) this.keepInView({ fast: true, extra: before });
      if (choreo) await choreo(c, fx, pre);
      await this.sync({ pre, cmd: c.cmd, fx, hold: true });
      if (!this.instant) await this.settle(); // 重放时一行一行不量，放完量一次
      if (!this.instant && c.cmd !== 'camera') {
        if (this.heldLabels?.size) { await this.keepInView(); await this.revealLabels(); } else this.keepInView();
      }
      // 跟着算出来的（乘积、{A + B}……）变了：闪一下，让学生看见「我一拨，它就跟着变」（乘积一格一条交 part，跟着算的一样东西一条交 parts）
      if (!this.instant && fx?.derived?.length) fx.derived.flatMap((d) => d.parts || (d.part ? [d.part] : [])).forEach((p, i) => this.pulse(p, stagger(i, { step: 45 })));
      if (fx?.created || fx?.removed) this.resetOpens();
      this.syncOpens();
      // 贴上去的字：读一下再演下一行（第一节真课两张接连冒出来，一张 0.4 秒就过去了）
      if (!this.instant && (c.cmd === 'label' || c.cmd === 'retext')) {
        const str = (c.args || []).find((a) => a.t === 'str')?.v || '';
        await this.wait(labelHold(richLength(parseRich(str))));
      }
    } catch (e) {
      // 画面出错不能把课卡住：记下来，画面照场景重画一遍
      this.errors.push({ line: c.line, src: c.src?.trim(), error: `画面没演好：${e.message}` });
      await this.sync({ pre });
    }
    const reacts = fx?.reactions || [];
    if (!this.instant) {
      if (fx?.goalsMet?.length) this.celebrate(fx.goalsMet);
      if (fx?.collected?.length) this.celebrate(fx.collected); // 收集型收了一张（还没收齐）
      // 预写的行（挑战做到了、收集型收了一张、做完了、学生做对一步）：马上演
      if (fx?.goalsMet?.length || fx?.done?.length || reacts.length) this.react(reacts, turn);
      // 先排上预写的行再告诉课堂（课堂等 reacting 演完，看学生手上还有没有事）。瞬间重放（刷新、撤一步、作废）时不告诉：那时做到的都是以前的事
      // reacts：这几行预写演不上的，react 会在上面记 missed（课堂等演完照它数真演了几行，不说假话）
      const forGoal = reacts.filter((r) => r.goal && !r.collect), forDone = reacts.filter((r) => r.done);
      // 不是学生做到的：是舞台演预写的行时成立的（prewrite）、这一行刚写出的挑战一出来就成立（fresh），写给老师照实说
      if (fx?.goalsMet?.length) this.onGoal?.(fx.goalsMet, { by, instant: false, reacted: forGoal.length, reacts: forGoal, pressed: !!fx.pressed, prewrite: !!c.prewrite, fresh: fx.goal || null });
      if (fx?.done?.length) this.onDone?.(fx.done, { by, instant: false, reacted: forDone.length, reacts: forDone, filled: fx.filled || [], ruled: fx.ruled || [], before: fx.doneBefore || null });
    }
    return fx;
  }
  /** 没让做的那一下：拖着的部件滑回原处（场景一点没动） */
  async snapBack(id) {
    const jobs = [];
    for (const n of this.nodes.values()) {
      if (n.__obj !== id || !n.__box || n instanceof SVGElement) continue;
      n.classList.remove('is-hold', 'is-over');
      const to = tr(n.__box.x, n.__box.y);
      if (n.style.transform && n.style.transform !== to) jobs.push(this.tween(n, [{ transform: n.style.transform }, { transform: to }], { duration: 360, easing: EASE.spring }));
    }
    await Promise.all(jobs);
  }

  // —— 藏着的东西（hide=on、hide R）：照样算、现状照样写，画面上不画、不进镜头 ——
  isShown(id) { const o = this.scene.objects.get(id); return !!o && !o.hidden; }
  /** 连线两头都画着才画（藏着的那一头没有地方可连） */
  linkShown(l) { return this.isShown(l.a.obj) && this.isShown(l.b.obj); }
  /** 贴的字：贴着的东西都藏着就不画（贴在藏着的东西旁边，学生看到的是一句悬空的话）；拨数、贴在别的字上的照画 */
  labelShown(l) {
    if (l.dial) return true;
    const objs = l.refs.filter((r) => !this.scene.labels.has(r)).map((r) => String(r).match(/^[A-Za-z_]\w*/)?.[0]).filter((id) => id && this.scene.objects.has(id));
    return !objs.length || objs.some((id) => this.isShown(id));
  }
  /** 屏幕多大写回场景（摆新东西时看要不要另起一列）；还没排版（量出来是 0）就不写，照旧往下摆 */
  noteView() {
    const w = this.view?.clientWidth, h = this.view?.clientHeight;
    if (!(w > 0 && h > 0)) return;
    this.setSide(w > h && !this.bare && this.sideWant && !this.free);
    this.sideToggle.hidden = !(w > h && !this.bare) || !!this.sideForce || this.free;
    this.root.classList.toggle('is-land', w > h && !this.bare);
    this.sideToggle.textContent = this.sideOn ? '‹' : '说过的 ›';
    this.sideToggle.setAttribute('aria-label', this.sideOn ? '收起说过的话' : '点开这一幕说过的话');
    // 横屏：场景拿右边那一块摆东西、算「缩到几成」（2.8：摆新东西要不要另起一列、现状里的「字难认」都按它）
    const sw = this.sideOn ? this.sideW : 0;
    const v = this.scene.view;
    if (!v || v.w !== w - sw || v.h !== h || (v.side || 0) !== sw) this.scene.view = sw ? { w: w - sw, h, side: sw } : { w, h };
  }
  /** 横屏 / 竖屏换了：挑战、话、底下那一条搬进解析栏或者搬回 view */
  setSide(on) {
    if (on === this.sideOn && this.root.classList.contains('is-side') === on) return;
    this.sideOn = on;
    this.root.classList.toggle('is-side', on);
    if (on) {
      this.side.insertBefore(this.goalsEl, this.newest);
      this.side.insertBefore(this.sideTitle, this.goalsEl);
      this.side.insertBefore(this.caption, this.newest);
      this.side.insertBefore(this.dock, this.newest);
      this.caption.style.bottom = '';
      this.caption.style.paddingLeft = ''; this.caption.style.removeProperty('--cap-left'); this.camSide = false;
      this.sideDirty = true;
    } else {
      this.view.insertBefore(this.caption, this.side);
      this.view.insertBefore(this.goalsEl, this.side);
      this.view.insertBefore(this.dock, this.side);
      this.sideW = 0;
      this.root.style.removeProperty('--side-w');
    }
    this.rebuildCaption();
    this.fitDock();
  }
  /** 点开 / 收起解析栏：只是画面，不叫老师、不进证据；镜头跟着重新摆 */
  toggleSide() {
    this.sideWant = !this.sideWant;
    try { localStorage.setItem(SIDE_KEY, this.sideWant ? 'open' : 'closed'); } catch { /* 存不了就只这一次 */ }
    this.sideDirty = true;
    this.noteView();
    this.refocus(!this.instant);
  }
  /**
   * 话照这一幕记着的那几句重画（换了收放）：栏开着放这一幕说过的全部（前几轮淡一点），收着照以前：只放最近这一轮的、最多 CAPTION_MAX 句
   */
  rebuildCaption() {
    const all = this.sceneTalk || [];
    const lastTurn = all.at(-1)?.turn;
    const rows = this.sideOn ? all : all.filter((x) => x.turn === lastTurn).slice(-CAPTION_MAX);
    this.caption.querySelectorAll('.st-line, .st-how').forEach((n) => n.remove());
    for (const x of rows) {
      const line = el('p', 'st-line', this.caption);
      line.__text = x.text;
      line.dataset.kind = x.ask ? 'ask' : 'say';
      if (x !== rows.at(-1) && (this.sideOn ? x.turn !== lastTurn : true)) line.classList.add('is-past');
      this.richInto(line, x.text, { glyphs: [], words: [], still: true });
    }
    this.captionTurn = lastTurn ?? null;
    if (this.sideOn) this.caption.scrollTop = this.caption.scrollHeight;
  }
  atBottom() { return this.caption.scrollHeight - this.caption.scrollTop - this.caption.clientHeight < 40; }
  /** 这一问在栏宽 w 时折成几行（pickSide 量；没有这一问时 1 行） */
  askLines(w) {
    const q = [...this.caption.querySelectorAll('.st-line:not(.is-out)[data-kind="ask"]')].at(-1);
    if (!q) return 1;
    const m = this.measureLine ||= el('p', 'st-line st-measure-line', this.side);
    m.textContent = q.textContent;
    m.style.width = `${Math.max(1, w - 2 * SIDE_PAD)}px`;
    const lh = parseFloat(getComputedStyle(m).lineHeight) || 30;
    return Math.max(1, Math.round(m.offsetHeight / lh));
  }
  /** 栏宽换了：CSS、场景的屏幕一起换（已经摆好的东西不重摆） */
  setSideW(w) {
    if (w === this.sideW) return;
    this.sideW = w;
    this.root.style.setProperty('--side-w', `${w}px`);
    this.noteView();
  }
  /**
   * 底下那一条放得下栏吗（2.9）：这一问的输入照栏宽排一遍，比栏宽、或者有一格（输入框、按钮）小于 44px，就挪到右边画面底部正中。
   * 下一问换回来（每次底下那一条变了都看一遍：MutationObserver）
   */
  fitDock() {
    if (!this.sideOn) { if (this.dock.parentElement !== this.view) this.view.insertBefore(this.dock, this.side); this.wideDock.hidden = true; return; }
    if (this.dock.parentElement !== this.side) this.side.insertBefore(this.dock, this.newest);
    this.wideDock.hidden = true;
    if (!this.dock.childElementCount) return;
    const room = this.side.clientWidth - 2 * SIDE_PAD;
    const cells = [...this.dock.querySelectorAll('input, button, .fi-text')].filter((n) => n.offsetWidth);
    const tooWide = this.dock.scrollWidth > room + 1 || [...this.dock.children].some((n) => n.scrollWidth > room + 1);
    const tooSmall = cells.some((n) => n.offsetWidth < 44 || n.offsetHeight < 44);
    if (!tooWide && !tooSmall) return;
    this.wideDock.hidden = false;
    this.wideDock.appendChild(this.dock);
    if (!this.instant) this.keepInView(); // 画面底部让出它的高
  }
  /**
   * 手怎么动（主线第六轮 2.10）：老师这一轮新交给学生的手（open），在解析栏这一问下面用小字写一句怎么动——规则文件里现成的那一句
   * （gestures[动作].how，没有就用 brief）。一种动作一句、最多两句；这一幕里写过的不再写。只是把现状里告诉老师的那一句也给学生看，
   * 不提示怎么解题；发给老师的东西里不多写
   */
  showHow(seq0) {
    if (!this.root.classList.contains('is-land')) return; // 竖屏不写（竖屏不动）
    this.howSaid ||= new Set();
    const lines = [];
    for (const e of this.scene.opens.values()) {
      if ((e.seq || 0) <= seq0 || e.action === 'back') continue;
      const o = this.scene.objects.get(e.obj);
      const g = o ? rulesOf(o)?.gestures?.[e.action] : null;
      const t = g?.how || g?.brief;
      const key = `${o?.type}:${e.action}`;
      if (!t || this.howSaid.has(key) || lines.includes(t)) continue;
      this.howSaid.add(key);
      lines.push(t);
    }
    this.caption.querySelectorAll('.st-how').forEach((n) => n.remove());
    if (!lines.length) return;
    const n = el('p', 'st-how', this.caption);
    n.textContent = lines.slice(0, 2).join('；');
    this.caption.scrollTop = this.caption.scrollHeight;
  }
  /** 等回话的三个点放哪：横屏放进栏里这一问下面（classroom.js 问它）；竖屏返回 false，照旧放在画面下半 */
  placeWait(node) {
    if (!this.sideOn) return false;
    this.side.insertBefore(node, this.dock.parentElement === this.side ? this.dock : this.newest);
    return true;
  }
  /**
   * 镜头摆好以后，画着的东西里还有哪几样出了屏幕（缩到最小也放不下）：写回场景，舞台现状里写「画面上看不全」。
   * 老师用 camera 对准了一处时不算（镜头外面的是老师自己选的）
   */
  noteClipped() {
    const sc = this.scene;
    let out = [];
    if (!sc.focus) {
      const { w, h } = this.viewSize();
      const c = this.cam;
      out = sc.shownIds().filter((id) => {
        const b = sc.objectBox(id);
        const x = b.x * c.s + c.tx, y = b.y * c.s + c.ty;
        return x < (this.sideOn ? this.sideW : 0) - 2 || y < -2 || x + b.w * c.s > w + 2 || y + b.h * c.s > h + 2;
      });
    }
    if (out.join('\u0000') !== sc.clipped.join('\u0000')) sc.clipped = out;
    // 整台缩得太小、字难认（老师用 camera 对准一处时不算）：缩到了几成
    const tiny = !sc.focus && tooSmall(this.cam.s) ? Math.round(this.cam.s * 10) : null;
    if (tiny !== sc.tiny) sc.tiny = tiny;
  }

  // —— 量画出来的样子（排版的根：每种东西自己估的大小不一定对，画出来才知道）——
  /**
   * 每一样东西画出来实际占的地方（世界坐标），比它自己算的框多出去的写回 o.ext（scene.objectBox 带上它），
   * 摆东西、贴字、镜头就按真的大小来。量的是最后的样子：HTML 节点按行内的 translate 和 offsetWidth / offsetHeight（不受动画影响），
   * 世界坐标里的 SVG（树的边、括号、连线）按 getBBox。有变化返回 true
   */
  measure() {
    if (typeof document === 'undefined') return false;
    let changed = false;
    const extOf = (est, u) => {
      if (!u) return null;
      const e = { l: Math.max(0, est.x - u.x), t: Math.max(0, est.y - u.y), r: Math.max(0, u.x + u.w - (est.x + est.w)), b: Math.max(0, u.y + u.h - (est.y + est.h)) };
      return e.l > 3 || e.t > 3 || e.r > 3 || e.b > 3 ? { l: Math.round(e.l), t: Math.round(e.t), r: Math.round(e.r), b: Math.round(e.b) } : null;
    };
    const same = (a, b) => (!a && !b) || (a && b && ['l', 't', 'r', 'b'].every((k) => Math.abs(a[k] - b[k]) <= 2));
    this.noteView();
    for (const o of this.scene.objects.values()) {
      if (o.hidden) continue; // 藏着的没画，量不到：留着上一次量的
      const est = this.scene.type(o).objectBox(o);
      const ext = extOf(est, this.footprint(o.id));
      if (!same(o.ext || null, ext)) { if (ext) o.ext = ext; else delete o.ext; changed = true; }
    }
    // 贴的字画在哪写回场景（reflow 让后造的东西给字让地方）
    const rects = [];
    for (const [lid, l] of this.labelNodes) {
      const lab = this.scene.labels.get(lid);
      if (!lab || lab.dial || !l.box || !this.labelShown(lab)) continue;
      const objs = [...new Set(lab.refs.filter((r) => !this.scene.labels.has(r)).map((r) => String(r).match(/^[A-Za-z_]\w*/)?.[0]).filter((id) => id && this.scene.objects.has(id)))];
      // want：老师写的 side=（reflow 照它给写了 side=above 的字让出地方）
      rects.push({ x: Math.round(l.box.x), y: Math.round(l.box.y), w: Math.round(l.box.w), h: Math.round(l.box.h), objs, want: (lab.asked && lab.side) || null });
    }
    const key = (rs) => rs.map((r) => `${r.x},${r.y},${r.w},${r.h},${r.objs.join('+')},${r.want || ''}`).join('|');
    if (key(rects) !== key(this.scene.labelRects || [])) { this.scene.labelRects = rects; changed = true; }
    if (this.layoutDirty) { this.layoutDirty = false; changed = true; }
    return changed;
  }
  /**
   * 整样东西挪到新地方（大小没变）：它所有的节点——部件、括号、序号、边——已经在最后的地方了，这里用 CSS 的 translate（和节点自己的
   * transform 叠着）把整块从原处一起带过去，谁也不先到、谁也不落后。路挑不穿过别的东西的：直着走、先横后竖、先竖后横，挑第一条
   * 一路上都不压着别的东西的（2026-11-06：B 从 A 下面挪到 A 右边，直着走会从 A 的一角压过去）
   */
  async moveRigid(id, { dx, dy }, boxes) {
    const els = [...this.root.querySelectorAll(`[data-obj="${CSS.escape(id)}"]`)].filter((n) => n.parentElement === this.layer || n.parentElement === this.under || n.parentElement === this.ink);
    if (!els.length) return;
    // 画法自己起的挪动（括号、序号的 tween）：直接到最后，免得和整块一起走叠成两份
    for (const n of els) for (const a of n.getAnimations?.() || []) { try { if (a.effect?.getKeyframes?.().some((k) => k.transform)) a.finish(); } catch { /* 已经完了 */ } }
    const end = boxes.get(id);
    const others = [...boxes].filter(([k]) => k !== id).map(([, b]) => grow(b, 6));
    const at = (ox, oy) => ({ ...end, x: end.x - dx + ox, y: end.y - dy + oy });
    const hits = (pts) => pts.some((p) => others.some((b) => overlaps(at(p.x, p.y), b)));
    const sample = (path) => { const out = []; for (let i = 1; i < path.length; i++) for (const t of [0.25, 0.5, 0.75]) out.push({ x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t }); return out; };
    const paths = [[{ x: 0, y: 0 }, { x: dx, y: dy }], [{ x: 0, y: 0 }, { x: dx, y: 0 }, { x: dx, y: dy }], [{ x: 0, y: 0 }, { x: 0, y: dy }, { x: dx, y: dy }]];
    const path = paths.find((p) => !hits(sample(p))) || paths[0];
    const len = path.slice(1).reduce((n, p, i) => n + Math.abs(p.x - path[i].x) + Math.abs(p.y - path[i].y), 0);
    const frames = path.map((p, i) => ({ translate: `${p.x - dx}px ${p.y - dy}px`, offset: path.length > 2 ? [0, 0.5, 1][i] : i }));
    const duration = this.dur(moveDuration(len));
    await Promise.all(els.map((n) => (typeof n.animate === 'function' ? n.animate(frames, { duration, easing: EASE.move }).finished.catch(() => {}) : null)));
  }
  /** 先摆好藏着的字（hold）淡进来：这时候下面的东西已经让开、镜头已经让出地方 */
  revealLabels() {
    const ids = this.heldLabels;
    if (!ids?.size) return Promise.resolve();
    this.heldLabels = new Set();
    return Promise.all([...ids].map((id) => {
      const l = this.labelNodes.get(id);
      if (!l?.box) return null;
      const n = l.node;
      return this.tween(n, [{ opacity: 0, transform: tr(l.box.x, l.box.y + 8) }, { opacity: 1, transform: tr(l.box.x, l.box.y) }], { duration: 380, easing: EASE.out });
    }));
  }
  /** 量 → 排 → 对齐，到不再变为止（最多三遍）：贴的字跟着东西挪，挪了占的地方又变 */
  async settle() {
    if (this.free) {
      // 量 → 摆（求解器）→ 字跟着重贴 → 再量，到不再变为止（最多两遍）
      for (let i = 0; i < 2; i++) {
        const changed = this.measure();
        if (changed) await this.sync({});
        const moved = await this.compose();
        if (!changed && !moved) break;
      }
      return;
    }
    for (let i = 0; i < 3 && this.measure(); i++) { this.scene.reflow(); await this.sync({}); }
  }
  /** 一个 SVG 东西现在在世界里占的地方（排版检查用） */
  svgBoxOf(n) { return svgBox(n); }
  /** 一样东西的节点最后摆在哪（世界坐标）拼起来的框 */
  footprint(id) { return bbox(this.footprintBoxes(id)); }
  /** 一样东西的每个节点最后摆在哪（世界坐标）：排版检查（tools/stage-audit.mjs）也用它，和这里量的一样 */
  // 只算它自己画的：贴的字不算进来——字只躲东西，不推东西（试过把字算成它的一部分：一张贴在 A、B 两个上面的字把 A 撑宽，
  // 压到了 B，B 被推到 A 下面，整排都乱了）
  footprintBoxes(id) {
    const boxes = [];
    for (const n of this.root.querySelectorAll(`[data-obj="${CSS.escape(id)}"]`)) {
      if (n instanceof SVGElement) {
        if (n.ownerSVGElement === this.under || n.ownerSVGElement === this.ink) {
          if (n.parentElement?.closest?.('[data-obj]')?.dataset.obj === id && n.parentElement !== this.under && n.parentElement !== this.ink) continue; // 外面那一组已经算了
          const b = svgBox(n);
          if (b) boxes.push({ x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
          continue;
        }
        if (n.parentElement !== this.layer) continue; // 一样东西自己那层 svg 里面的，那层 svg 已经算了
        const t = transOf(n), w = parseFloat(n.getAttribute('width')) || 0, h = parseFloat(n.getAttribute('height')) || 0;
        if (t && w && h) boxes.push({ x: t.x, y: t.y, w, h });
        continue;
      }
      if (n.parentElement !== this.layer) continue; // 嵌在别的节点里面的，外面那个已经算了
      const t = transOf(n);
      if (!t || !n.offsetWidth || !n.offsetHeight) continue;
      boxes.push({ x: t.x, y: t.y, w: n.offsetWidth, h: n.offsetHeight });
    }
    // 它自己的格子之间拱起来的弧（分组的连线、hop 留下的弧）也是它画的：以前不算，弧拱到上面那样东西里去、被盖住，
    // 排版检查也量不出来（主线第一轮留下的 D1-11：隔 5 个分组的弧被上面的题卡盖住）。连到别的东西的线不算（不是哪一样自己的）
    for (const l of this.scene.links.values()) {
      if (l.whole || l.a.obj !== id || l.b.obj !== id || !this.linkShown(l)) continue;
      const g = this.linkGeo(l);
      if (g.box && !g.rail) boxes.push(g.box);
    }
    return boxes;
  }
  /** 屏幕上（相对 view）被占着的地方：别的东西、贴的字、话、挑战、底下一条（浮出来的东西——拨数器——用它躲开）。except：自己那一样 */
  screenBlocks(except = null) {
    const out = [];
    const c = this.cam;
    for (const id of this.scene.shownIds()) {
      if (id === except) continue;
      const b = this.scene.objectBox(id);
      out.push({ x: b.x * c.s + c.tx, y: b.y * c.s + c.ty, w: b.w * c.s, h: b.h * c.s });
    }
    for (const l of this.labelNodes.values()) if (l.box) out.push({ x: l.box.x * c.s + c.tx, y: l.box.y * c.s + c.ty, w: l.box.w * c.s, h: l.box.h * c.s });
    for (const n of [...this.caption.querySelectorAll('.st-line:not(.is-out)'), ...this.goalsEl.children, ...this.dock.children, ...(this.undoBox ? [this.undoBox] : [])]) { const r = this.screenRect(n); if (r) out.push(r); }
    return out;
  }
  /** 画法量到了自己的真实大小、写回场景（题卡每一行折了几行……）：这一轮对齐完再排一遍 */
  relayout() { this.layoutDirty = true; }

  // —— 活的舞台（docs/stage-plan.md E 段）——
  /** 还没做到的挑战 */
  pendingGoals() { return [...this.scene.goals.values()].filter((g) => !g.met && !g.watch); } // watch 学生不知道，不算
  /**
   * 挑战做到了：马上演老师预写的行（一句确认、揭开下一小问——答案固定的，见硬性规定），不等老师；
   * 预写里有 ask 就换掉正在等的那一问；什么都没写、挑战也都做完了，收起「给个提示」，等老师接着讲
   */
  react(list, turn) {
    this.reacting = (this.reacting || Promise.resolve()).then(async () => {
      await this.studentChain;
      for (const r of list) {
        for (const c of parseScript(r.src)) {
          // 预写的行照老师的行演（带 lenient：写下时查过了；prewrite：不算学生的一下，又让别的挑战成立也不再触发预写，里面的 ask 不拿 @ask.right）。
          // 演不上的（写下时指着还没有的部件，现在还是没有）不演，记在那一项上（missed），跟着下一条告诉老师
          // 收集型的 @g1 每收一张都演：里面写出的挑战已经有了就跳过（不重写它、不清掉 @g2 的行）
          if (r.keepGoals && (c.cmd === 'goal' || c.cmd === 'watch')) { const id = (c.args || []).find((a) => a.t === 'word')?.v; if (id && this.scene.goals.has(id)) continue; }
          const miss = this.scene.missedPrewrite({ ...c, lenient: true, prewrite: true });
          // 演不上的那一问带着跟它的 @ask.right：那一问出不来，@ask.right 连同里面套着的拿掉（不然现状一直写「还没出」）
          if (miss) { r.missed = true; this.onNote?.(miss, { turn }); if (r.preRightKey) this.scene.dropAhead(r.preRightKey); continue; }
          // 跟着这一问的 @ask.right（scene.js 的 bindRight）交给它
          await this.exec({ ...c, lenient: true, prewrite: true, ...(r.preRight ? { preRight: r.preRight, preRightKey: r.preRightKey } : {}) }, { by: 'teacher', turn });
        }
      }
      // 预写里有新的一问：换掉正在等的那一问。别的（收起「给个提示」、叫不叫老师）课堂循环看学生手上还有没有事再定（loop.js）
      const w = this.scene.waiting;
      if (w && w !== this.armedFor) { this.cancelWait?.(); this.armWait(); } else this.resyncWait?.();
    }).catch((e) => { this.errors.push({ line: 0, src: '', error: `预写的行没演好：${e.message}` }); });
    return this.reacting;
  }
  /**
   * 学生手上还有事、叫老师的事攒着（loop.js）：舞台上没有在等的一问时替它挂一问「给个提示」（和一轮演完时页面挂的同一种），
   * 学生手上就还有输入框能说话。不带话：不动最后说的那一句（刚演的预写那句话还在画面上）。老师那一轮正在演时不挂（会抢那一轮的 @ask.right）
   */
  async holdAsk() {
    if (this.instant || this.scene.waiting || this.undoFloor === Infinity) return;
    const src = helpLine('', true);
    const [c] = parseScript(src);
    await this.exec({ ...c, line: 0, src }, { by: 'page', turn: this.turnNo });
    this.armWait();
  }
  /** 刚做到的挑战：任务条那一行打勾，条件里提到的东西亮一下 */
  celebrate(ids) {
    for (const id of ids) {
      const g = this.scene.goals.get(id);
      if (!g || g.watch) continue; // watch：只叫老师，学生那边什么也没有
      const objs = new Set(g.cond.flatMap((cl) => [cl.l, cl.r]).filter((w) => w && this.scene.objects.has(w)));
      let i = 0;
      for (const ob of objs) for (const p of this.scene.parts(ob).slice(0, 12)) this.pulse(p, stagger(i++, { step: 35 }));
    }
  }
  /** 开放给学生直接动的：照场景挂上、收起（东西重造过就全部重挂） */
  syncOpens() {
    if (this.instant || !this.withInput) return;
    this.armedOpens ||= new Map();
    const want = this.scene.opens;
    // 同一项再开一次（哪怕只换了 wrong= / call= / undo=）是新的一项：照它重挂。以前只看部件、范围、input= 变没变，
    // 还挂着旧的那一项——键盘、成分那一排按「确定」时发现那一项已经不是开着的了（gesturedom.js），悄悄收起、什么都没交
    for (const [k, a] of this.armedOpens) if (want.get(k) !== a.e) { a.off(); this.armedOpens.delete(k); }
    // 还挂着的通用手势照东西现在的样子补挂（托盘少了一个、长出新结点、多了一道括号）。照开的先后（e.seq）挂：同一处挂了几种按法、
    // 画面还分不清时（gestures.js 的 ARMED_PRESS），手指拿到的是先挂的那一项，舞台现状照这个写「先开的 …」（重挂、补挂都照它，不会变）
    const order = [...want].sort((x, y) => (x[1].seq || 0) - (y[1].seq || 0));
    for (const [k, e] of order) { const a = this.armedOpens.get(k); if (!a) this.armedOpens.set(k, { off: this.armOpen(e), e }); else a.off.refresh?.(); }
    this.syncUndo();
  }
  resetOpens() { this.armedOpens?.forEach((a) => a.off()); this.armedOpens = new Map(); }
  armOpen(e) {
    const o = this.scene.objects.get(e.obj);
    const view = o && VIEWS[o.type];
    if (!view) return () => {};
    if (e.action === 'drag') {
      // 拖：算出来的（u + v、{A v}）不能拖
      const parts = (e.refs.length ? e.refs.flatMap((r) => this.scene.parts(r)) : this.scene.parts(e.obj)).filter((p) => p.expr == null && !p.live);
      const offs = parts.map((p) => this.armDrag(view, p, parts, (act, src) => this.openDone(e, act, src)));
      return () => offs.forEach((f) => f());
    }
    // 那种东西自己画的（矩阵的 ± 拨数器、点乘积看怎么算）照旧；写了 input=keypad 的、手势表里的动作走通用手势（gesturedom.js）
    const fn = !e.input && view.affords?.[e.action];
    if (fn) return fn(this, o, e, (act, src) => this.openDone(e, act, src));
    return e.gesture ? armGesture(this, e, view, (act, src) => this.openDone(e, act, src)) : () => {};
  }
  // 拖完、拨完：照一行学生的指令演。能拖的不收起来再挂（以前收起来、等这一下演完才挂回去，紧接着再拖就拿不到——「掉」了）：
  // pointer.js 每次按下都按东西现在的位置找，dragSpec 也按 key 现取，用不着重挂。演完给回这一下（裁判的结论、拦没拦都在上面）
  openDone(e, act, src) {
    // line：这一下照哪一行演的（撤一步时课堂循环照它认出撤的是哪一下；裁判判的那几种另有 act.src）
    const a = { ...act, open: e.action, ...(src ? { line: String(src).trim() } : {}) };
    const p = src ? this.studentDo(src, a) : Promise.resolve(this.onAct?.(a));
    return p.then(() => { this.syncOpens(); return a; });
  }

  // —— 撤一步（open … undo=on）：去掉这一回合学生的最后一行，照 log 重放；正在等的那一问照样等着 ——
  /**
   * 这一回合能撤哪一行（gestures.js 的 undoPlan）：只撤从写了 undo=on 的那一项来的（拨数、别的 open 来的撤不了），
   * 学生按的「回到……」都撤得了（scene.js 的 undoable）
   */
  undoPlan() {
    return undoPlan(this.log, { from: this.undoFloor || 0, undoable: (row) => this.scene.undoable(row) });
  }
  /**
   * 右上角一排：老师开的「回到……」（open t back="插入后"，一个名字一个；还没存时按不了），有哪一项 open 写了 undo=on 才有「撤一步」。
   * 撤一步这一回合学生还没做过就按不了，撤不了的那一下在按钮下面说一句（中性，不说对错）
   */
  syncUndo() {
    const live = this.withInput && !this.instant;
    const opens = live ? [...this.scene.opens.values()] : [];
    const on = opens.some((e) => e.policy?.undo);
    const backs = opens.filter((e) => e.action === 'back');
    if (!on && !backs.length) { this.undoBox?.remove(); this.undoBox = this.undoRow = this.undoBtn = null; this.backBtns = new Map(); return; }
    if (!this.undoBox) {
      this.undoBox = el('div', 'st-undo-box', this.view);
      this.undoRow = el('div', 'st-undo-row', this.undoBox);
      el('span', 'st-undo-why', this.undoBox);
      this.backBtns = new Map();
    }
    // 「回到……」照开着的对齐：收掉的拿走，新开的排在「撤一步」前面
    const want = new Map(backs.map((e) => [`${e.obj}:${e.name}`, e]));
    for (const [k, b] of this.backBtns) if (!want.has(k)) { b.remove(); this.backBtns.delete(k); }
    for (const [k, e] of want) {
      let b = this.backBtns.get(k);
      if (!b) {
        b = el('button', 'st-back', this.undoRow);
        b.type = 'button';
        b.dataset.obj = e.obj;
        b.dataset.name = e.name;
        b.textContent = `回到${e.name}`;
        b.addEventListener('click', () => this.goBack(b.dataset.obj, b.dataset.name));
        if (this.undoBtn) this.undoRow.insertBefore(b, this.undoBtn);
        this.backBtns.set(k, b);
      }
      b.disabled = !!(this.undoBusy || this.backBusy) || !this.scene.keeps.get(e.obj)?.has(e.name);
    }
    if (on && !this.undoBtn) {
      const b = this.undoBtn = el('button', 'st-undo', this.undoRow);
      b.type = 'button';
      b.textContent = '↶ 撤一步';
      b.addEventListener('click', () => this.undo());
    }
    if (!on && this.undoBtn) { this.undoBtn.remove(); this.undoBtn = null; }
    const plan = !on || this.undoBusy ? null : this.undoPlan();
    if (this.undoBtn) this.undoBtn.disabled = !!this.backBusy || !plan?.gone;
    this.undoBox.lastChild.textContent = plan?.why || '';
  }
  /**
   * 学生按「回到……」：照学生的一行 back t "插入后" 走（studentDo：先过 check、记进 log，open 记成 back，撤一步撤得了），
   * 课堂收到的这一下带着回到以后的样子（actText）
   */
  async goBack(obj, name) {
    if (this.backBusy || this.undoBusy || this.dragging) return;
    this.backBusy = true;
    this.syncUndo();
    try {
      const src = `back ${obj} ${quoteText(name)}`;
      const typed = this.typedNow();
      await this.studentDo(src, { type: 'back', obj, name, open: 'back', line: src });
      this.putTyped(typed);
    } finally {
      this.backBusy = false;
      this.syncUndo();
    }
  }
  async undo() {
    if (this.undoBusy || this.backBusy || this.dragging) return;
    this.undoBusy = true;
    this.syncUndo();
    try {
      await Promise.all([this.studentChain, this.reacting]).catch(() => {});
      const plan = this.undoPlan();
      if (!plan.gone) return;
      // 重放会收起正在等的那一问：先收起（攒着的拨数留着），放完照原样挂回去；打了一半的字也存下、挂回去以后填回
      const w = this.scene.waiting, waiting = this.armedP, floor = this.undoFloor;
      const typed = this.typedNow();
      // 那一问的 @ask.right 里套着的预写在场景上（重放会丢掉）：放完照原样放回去
      const under = w?.rightKey ? this.scene.aheadUnder(w.rightKey) : [];
      const seq = this.scene.askSeq;
      this.cancelWait?.();
      await waiting;
      await this.replay(plan.lines);
      this.scene.askSeq = Math.max(this.scene.askSeq, seq);
      for (const [k, a] of under) this.scene.ahead.set(k, a);
      // 重放不把 ask 那几行（不重演的）推回 log：log 要和撤之前一模一样、只少撤掉的那一行，课堂循环存这一段（从 S.logFrom 起）才对得上
      this.log = [...plan.lines];
      this.undoFloor = floor;
      if (w) { this.scene.waiting = w; this.armWait(); this.putTyped(typed); }
      this.onAct?.({ type: 'undo', src: plan.gone.src, open: plan.gone.open || 'undo' });
    } finally {
      this.undoBusy = false;
      this.syncUndo();
    }
  }
  /**
   * 正在等的那一问里学生打了一半的字：对老师说的输入框（#st-say-input）、一个式子框、按格的每一格（.st-fgrid）。
   * 撤一步要重放、照原样重挂那一问，挂回去的框是空的，打了一半的字就丢了：重放前存下，挂回去以后填回（putTyped）。
   * 撤一步、回到……都走它（两个按钮互相挡着，各自在自己那一下里存、填，不另加一道挡）
   */
  typedNow() {
    const w = this.scene.waiting;
    const say = this.dock.querySelector('#st-say-input')?.value || '';
    const cells = [...this.dock.querySelectorAll('.st-fgrid .fi-text')].map((n) => n.value);
    return w && (say || cells.some(Boolean)) ? { w, say, cells } : null;
  }
  /** 填回 typedNow 存的字：那一问换掉了（预写里的新一问）不填；只填空着的框（框没被换掉、学生这一会儿又打过的不盖） */
  putTyped(t) {
    if (!t || this.scene.waiting !== t.w) return;
    const say = this.dock.querySelector('#st-say-input');
    if (say && !say.value && t.say) say.value = t.say;
    const cells = [...this.dock.querySelectorAll('.st-fgrid .fi-text')];
    if (cells.length !== t.cells.length) return; // 格数变了（答案照舞台现算，撤回去以后大小不一样）：对不上哪一格，不填
    cells.forEach((n, i) => {
      if (n.value || !t.cells[i]) return;
      n.value = t.cells[i];
      n.dispatchEvent(new Event('input', { bubbles: true })); // 下面的预览跟着写成公式
    });
  }
  /** 挑战：左上角一条一条（做到了打勾）；照场景对齐 */
  syncGoals() {
    const host = this.goalsEl;
    const have = new Map([...host.children].filter((n) => !n.classList.contains('is-out')).map((n) => [n.dataset.id, n]));
    for (const g of this.scene.goals.values()) {
      if (g.watch) continue; // 只叫老师的条件：不给学生看
      if (this.scene.goalGone(g)) continue; // 做到过、它说的东西都不在台上了：收起（还挂着的那一条淡出去）
      let n = have.get(g.id);
      have.delete(g.id);
      if (!n) {
        n = el('div', 'st-goal', host);
        n.dataset.id = g.id;
        el('i', 'st-goal-mark', n);
        el('span', 'st-goal-t', n);
        if (!this.instant) this.tween(n, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 380, easing: EASE.out });
      }
      // 收集型：后面带收了几张（学生看得到还差几张）
      const count = g.collect ? `（${g.collect.got.length} / ${g.collect.n}）` : '';
      if (n.__text !== g.text + count) { const t = n.querySelector('.st-goal-t'); t.replaceChildren(); this.richInto(t, g.text); if (count) t.append(count); n.__text = g.text + count; }
      // 收集型：收下的几张列在下面（底座第二轮留下的第 5 条：以前只有「收了 2 / 4」，老师说「看看收下的这几张」画面上一张也没有）
      if (g.collect) {
        const sig = g.collect.got.map(shapeText).join('|');
        if (n.__got !== sig) {
          n.__got = sig;
          let box = n.querySelector('.st-goal-got');
          if (!box && g.collect.got.length) box = el('div', 'st-goal-got', n);
          if (box) {
            const had = box.children.length;
            box.replaceChildren(...g.collect.got.map((m0) => { const c = document.createElement('span'); c.className = 'st-got'; c.textContent = shapeText(m0); return c; }));
            // 新收的那一张弹一下
            if (!this.instant && box.children.length > had) this.tween(box.lastChild, [{ opacity: 0, scale: '.6' }, { opacity: 1, scale: '1' }], { duration: 360, easing: EASE.spring });
            if (!g.collect.got.length) box.remove();
          }
        }
      } else if (n.__got != null) { n.querySelector('.st-goal-got')?.remove(); n.__got = null; } // 同名重写成不收集的：以前收的那一排小牌拿掉
      if (g.met && !n.classList.contains('is-met')) {
        n.classList.add('is-met');
        if (!this.instant) this.tween(n.firstChild, [{ transform: 'scale(.4)' }, { transform: 'scale(1.25)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 520, easing: EASE.spring });
      }
      // 做到过、现在不成立（学生拨走了、按了「回到……」）：空心的勾。现状写的是「做到过；现在不成立」，画面不能还是实心的绿勾
      n.classList.toggle('is-was', !!g.met && goalMark(this.scene, g) === 'was');
    }
    for (const n of have.values()) {
      n.classList.add('is-out');
      this.tween(n, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 }).then(() => n.remove());
    }
  }
  // 这一行的专门动作：刚造出来的东西出场；那种东西自己的（swap、insert……）；共用的（说话、比较、飞字……）
  choreoOf(c, fx) {
    if (fx?.created) {
      const o = this.scene.objects.get(fx.id);
      // 藏着造的（hide=on）：不画、不出场（以前照样走 enter，句子找不到画好的词，报「reading '__box'」：第三次量 E2 第 1 幕）
      if (o?.hidden) return null;
      return async () => {
        // 新的东西摆进来：镜头先（快快地）让出它的地方，再画它、让它出场——不然它先画在镜头外面，镜头追过去那一会儿露出一半
        // （每种东西「出场前藏不藏」各不一样，舞台这里统一先挪镜头）
        await this.keepInView({ fast: true });
        await this.sync({ entering: fx.id });
        await VIEWS[o.type]?.enter?.(this, o);
      };
    }
    const target = this.targetOf(c);
    const own = target && VIEWS[target.type]?.choreo?.[c.cmd];
    if (own) return (cc, f, pre) => own(this, cc, f, pre);
    const mine = this[`do_${c.cmd}`];
    return mine ? (cc, f, pre) => mine.call(this, cc, f, pre) : null;
  }
  // 拨盘变了，跟着它重排的东西（句子里的 {t: … | …}）：照那种东西自己的画法演（场景交的 choreo 是哪一个）
  // 同名重造一个拨盘也一样（跟着它的句子照新的值重排）
  do_dial(c, fx, pre) { return this.do_set(c, fx, pre); }
  async do_set(c, fx, pre) {
    for (const r of fx?.binds || []) {
      if (!r?.choreo) continue;
      const o = this.scene.objects.get(r.id);
      const fn = o && VIEWS[o.type]?.choreo?.[r.choreo];
      if (fn) await fn(this, c, r, pre);
    }
  }
  targetOf(c) {
    for (const a of c.args || []) if (a.t === 'word') { const r = this.scene.isRef(a.v) && a.v.match(/^[A-Za-z_]\w*/)[0]; if (r) return this.scene.objects.get(r); }
    return null;
  }

  // 演之前每一个部件在哪（专门的动作从这里出发）
  capture() {
    const boxes = new Map();
    for (const [k, n] of this.nodes) if (n.__box) boxes.set(k, { ...n.__box });
    return { boxes, say: this.scene.say };
  }

  // —— 共用的专门动作 ——
  async do_say() { await this.say(this.scene.say); }
  async do_pulse(c, fx) { await Promise.all(fx.parts.map((x, i) => this.pulse(x, stagger(i, { step: 60 })))); }
  async do_camera() { await this.refocus(true); }
  async do_wait(c, fx) { await this.wait(fx.ms); }
  async do_ask() { const w = this.scene.waiting; if (w?.prompt) await this.say(w.prompt, { ask: true }); }

  // 比较：两个亮一下，中间冒出「65 > 49′」，停一会儿再收起。整张比（compare P Q）：两张里不一样的格各闪两下（is-flash，两张都不变）
  async do_compare(c, fx) {
    if (fx.compare) {
      const k = fx.compare;
      const nodes = [];
      for (const d of k.diff || []) for (const id of [k.a, k.b]) { try { nodes.push(...this.scene.parts(`${id}.${d.r},${d.c}`).map((p) => this.nodeOf(p)).filter(Boolean)); } catch { /* 那一张不在了 */ } }
      if (this.instant || !nodes.length) return;
      nodes.forEach((n) => { n.classList.remove('is-flash'); void n.getBoundingClientRect(); n.classList.add('is-flash'); });
      await this.wait(960);
      nodes.forEach((n) => n.classList.remove('is-flash'));
      return;
    }
    const { a, b, sign } = fx;
    const A = this.scene.partBox(a), B = this.scene.partBox(b);
    const badge = el('div', 'st-compare', this.layer);
    badge.innerHTML = '<span></span><b></b><span></span>';
    badge.children[0].textContent = this.chipText(a);
    badge.children[1].textContent = sign < 0 ? '<' : sign > 0 ? '>' : '=';
    badge.children[2].textContent = this.chipText(b);
    const w = badge.offsetWidth || 90, h = badge.offsetHeight || 34;
    const x = (A.x + A.w / 2 + B.x + B.w / 2) / 2 - w / 2, y = Math.min(A.y, B.y) - h - 16;
    await Promise.all([this.pulse(a), this.pulse(b), this.tween(badge, [{ opacity: 0, transform: tr(x, y + 10) }, { opacity: 1, transform: tr(x, y) }], { duration: 320, easing: EASE.out })]);
    await this.wait(1100);
    await this.tween(badge, [{ opacity: 1, transform: tr(x, y) }, { opacity: 0, transform: tr(x, y - 8) }], { duration: 240, easing: EASE.in });
    badge.remove();
  }

  // 话里的 [词] 飞到图上：sync 先把落点算好（字先藏着），这里从那个词的位置飞过去
  async do_fly(c, fx) {
    const word = [...this.caption.querySelectorAll('.st-line:not(.is-out)[data-kind="say"]')].at(-1)?.querySelectorAll('.st-word')[fx.word];
    await this.sync({ hide: [fx.id] });
    const l = this.labelNodes.get(fx.id);
    if (!l || !word || this.instant) { if (l) l.node.style.opacity = ''; return; }
    // 先让话让开落点（落点在图上方时话往上挪），再飞
    await this.keepInView();
    await this.wait(200);
    const r0 = word.getBoundingClientRect(), v0 = this.view.getBoundingClientRect();
    const ghost = el('span', 'st-ghost', this.flyLayer);
    ghost.textContent = word.textContent;
    const s0 = { x: r0.left - v0.left, y: r0.top - v0.top };
    const s1 = this.toScreen({ x: l.box.x, y: l.box.y });
    word.classList.add('is-flown');
    const sc = this.cam.s;
    await this.tween(ghost, arcPoints(s0, s1, { dir: -1, lift: 0.18, max: 90 }).map((q) => ({ transform: `translate(${q.x}px, ${q.y}px) scale(${1 + (sc - 1) * q.t})`, offset: q.t })), { duration: 900, easing: EASE.move });
    ghost.remove();
    l.node.style.opacity = '';
    await this.tween(l.node, [{ transform: tr(l.box.x, l.box.y, 1.12) }, { transform: tr(l.box.x, l.box.y) }], { duration: 380, easing: EASE.spring });
  }

  // —— 把画面对齐到场景：每种东西造 / 改自己的节点；挪了的滑过去、没了的淡掉；连线、贴字、拨数 ——
  async sync({ pre = null, only = null, entering = null, hide = [], cmd = null, fx = null, hold = false } = {}) {
    const sc = this.scene;
    const jobs = [];
    this.syncMark = (this.syncMark || 0) + 1;
    const ctx = { pre, only, entering, cmd, fx, jobs };
    const moves = [];
    // 藏着的不画：它的节点这一遍没碰到，下面照「没了的」淡掉；show 以后照新造的画出来
    for (const o of sc.objects.values()) if (!o.hidden) moves.push(...(VIEWS[o.type]?.sync(this, o, ctx) || []));
    this.syncGoals();
    this.syncMeasures();
    // 整样东西挪了地方（大小没变：乘积把 A、B 排成一行、下面的东西被推下去）：它的每一部分同一时间、同样快地走，
    // 不按先后错开——错开的话括号已经到了、数还在半路，压到旁边那一样上（2026-11-06 量出来的）。错开只留给里面的重排（分组、排序）
    const boxes = new Map(sc.shownIds().map((id) => [id, sc.objectBox(id)]));
    const rigid = new Map();
    for (const [id, b] of boxes) {
      const was = this.lastBoxes?.get(id);
      if (!was || Math.abs(was.w - b.w) > 1 || Math.abs(was.h - b.h) > 1) continue;
      const dx = b.x - was.x, dy = b.y - was.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) rigid.set(id, { dx, dy });
    }
    this.lastBoxes = boxes;
    const rigidJobs = [];
    if (rigid.size && !this.instant) {
      for (const [id, r] of rigid) {
        // 这一样的部件自己的挪动不要了（直接放到最后的地方），换成整块一起走
        for (let k = moves.length - 1; k >= 0; k--) {
          const m = moves[k];
          if (m.part.obj !== id || Math.abs(m.to.x - m.from.x - r.dx) > 1 || Math.abs(m.to.y - m.from.y - r.dy) > 1) continue;
          const n = this.nodeOf(m.part);
          if (n) { n.__box = { ...m.to }; n.style.transform = tr(m.to.x, m.to.y); }
          moves.splice(k, 1);
        }
        rigidJobs.push(this.moveRigid(id, r, boxes));
      }
    }
    // 没了的部件、没了的东西
    for (const [k, n] of this.nodes) if (n.__live !== this.syncMark && !only) this.dropNode(k);
    for (const id of [...this.decors.keys()]) if (!this.isShown(id)) { this.dropDecor(id); this.decors.delete(id); }
    if (rigidJobs.length) await Promise.all(rigidJobs);
    // 挪了的：连线先藏、挪完再画；按各自给的先后错开
    if (moves.length) {
      await this.hideLinks(moves.map((m) => m.part));
      await Promise.all(moves.map((m) => this.moveNode(m.part, [{ transform: tr(m.from.x, m.from.y) }, { transform: tr(m.to.x, m.to.y) }], m.to, { duration: m.duration || moveDuration(Math.abs(m.from.x - m.to.x) + Math.abs(m.from.y - m.to.y)), delay: m.order === 0 ? 0 : stagger(m.order ?? 0, { step: 70, max: 500 }) })));
    }
    // 连线
    const linkJobs = [];
    let drawn = 0;
    for (const l of sc.links.values()) {
      if (!this.linkShown(l)) continue;
      const geo = this.linkGeo(l);
      let p = this.paths.get(l.key);
      if (!p) {
        p = svg('path', { class: 'st-link' }, this.under); // 在格子下面：弧从格子顶上出发，横线藏在格子后面
        p.dataset.paint = l.color || 'g1';
        this.paths.set(l.key, p);
        p.setAttribute('d', geo.d);
        p.classList.toggle('is-rail', geo.rail);
        p.__d = geo.d;
        if (!this.instant) {
          const len = p.getTotalLength?.() || 300;
          p.style.strokeDasharray = `${len}`;
          // 重新分组时一组一组画（按组错开），别的按先后
          const delay = fx?.made ? stagger(fx.made.find((m) => m.key === l.key)?.group ?? drawn, { step: 110, max: 700 }) : stagger(drawn, { step: 90 });
          drawn++;
          linkJobs.push(this.tween(p, [{ strokeDashoffset: `${len}` }, { strokeDashoffset: '0' }], { duration: 460, delay, easing: EASE.out }).then(() => { p.style.strokeDasharray = ''; p.style.strokeDashoffset = ''; }));
        }
        continue;
      }
      p.dataset.paint = l.color || 'g1';
      if (p.__d !== geo.d || p.__hidden) {
        p.setAttribute('d', geo.d);
        p.__d = geo.d;
        p.classList.toggle('is-rail', geo.rail);
        if (p.__hidden) { p.__hidden = false; linkJobs.push(this.tween(p, [{ opacity: 0 }, { opacity: geo.rail ? 0.3 : 0.9 }], { duration: 280 }).then(() => { p.style.opacity = ''; })); }
      }
    }
    for (const [k, p] of this.paths) if (!sc.links.has(k) || !this.linkShown(sc.links.get(k))) { this.paths.delete(k); linkJobs.push(this.tween(p, [{ opacity: p.__hidden ? 0 : 1 }, { opacity: 0 }], { duration: 220 }).then(() => p.remove())); }
    await Promise.all(jobs);
    await Promise.all(linkJobs);
    await this.syncLabels(hide, { hold });
  }

  linkGeo(l) {
    const sc = this.scene;
    // 连到整样东西的那一头（link AB BA、link f.l1 AA）：一道弧，那一头用 objectBox；上下摆着的从中间的空当连过去
    if (l.whole) {
      const end = (e) => (e.key == null ? (sc.objects.has(e.obj) ? sc.objectBox(e.obj) : null) : (() => { const p = sc.partOf(e.obj, e.key); return p ? sc.partBox(p) : null; })());
      const A = end(l.a), B = end(l.b);
      return A && B ? wholeLinkGeom(A, B, { tier: l.tier || 0 }) : { d: '', box: null, rail: false };
    }
    const a = sc.partOf(l.a.obj, l.a.key), b = sc.partOf(l.b.obj, l.b.key);
    if (!a || !b) return { d: '', box: null, rail: false };
    const rail = !!(VIEWS[sc.objects.get(a.obj).type]?.rail?.(sc.objects.get(a.obj), a) || VIEWS[sc.objects.get(b.obj).type]?.rail?.(sc.objects.get(b.obj), b));
    return linkGeom(sc.partBox(a), sc.partBox(b), { tier: l.tier || 0, rail });
  }

  // 部件挪了：连着它的线先淡掉（挪完 sync 照新位置画，再淡进来）
  hideLinks(parts) {
    const keys = new Set(parts.map(pidOf));
    const jobs = [];
    for (const l of this.scene.links.values()) {
      if (!keys.has(`${l.a.obj}:${l.a.key}`) && !keys.has(`${l.b.obj}:${l.b.key}`)) continue;
      const p = this.paths.get(l.key);
      if (!p || p.__hidden) continue;
      p.__hidden = true;
      jobs.push(this.tween(p, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 }));
    }
    return Promise.all(jobs);
  }

  moveNode(x, frames, to, { duration = 520, delay = 0, easing = EASE.move } = {}) {
    const n = this.nodeOf(x);
    if (!n) return Promise.resolve();
    n.__box = { ...to };
    n.classList.add('is-moving');
    return this.tween(n, frames, { duration, delay, easing }).then(() => n.classList.remove('is-moving'));
  }
  // 旧名字
  moveCell(x, frames, to, opts) { return this.moveNode(x, frames, to, opts); }

  async pulse(x, delay = 0) {
    const n = this.nodeOf(x);
    if (!n?.__box || n instanceof SVGElement) return;
    const t = tr(n.__box.x, n.__box.y);
    await this.tween(n, [{ transform: t }, { transform: `${t} scale(1.1)` }, { transform: t }], { duration: 420, delay, easing: EASE.out });
    // 跳的这一下里它被挪走了（做到挑战时跳一下，预写的 fold 同时让后面的词补位）：停下时写回的是开跳时的位置，
    // 照它现在该在的地方放回去（别的动画还在动它就不管，那一个停下时会写它的终点）
    const now = n.__box && tr(n.__box.x, n.__box.y);
    if (now && now !== t && n.style.transform === t && !n.getAnimations?.().length) n.style.transform = now;
  }

  // —— 贴着的字和拨数：新的淡进来、字变了的换字、锚挪了的跟过去、没了的淡掉 ——
  obstacles(exceptId) {
    const sc = this.scene;
    // 贴在一样东西的部件上的字：那样东西换成它细一点的那一份（时间轴：只躲部件和轴，不躲整条，nearObstacles）
    const l = exceptId != null ? sc.labels.get(exceptId) : null;
    const nearId = l && !l.dial && l.refs?.length === 1 && !sc.objects.has(l.refs[0]) ? String(l.refs[0]).match(/^[A-Za-z_]\w*/)?.[0] : null;
    const out = [...sc.obstacles({ near: nearId })];
    for (const l of sc.links.values()) { if (!this.linkShown(l)) continue; const g = this.linkGeo(l); if (g.box) out.push(g.box); }
    // 贴在藏着的东西上的字不画、也不占地方（syncLabels 这一遍最后才把它收掉，这之前别的字摆的时候不躲它）
    for (const [id, l] of this.labelNodes) if (id !== exceptId && l.box && sc.labels.has(id) && this.labelShown(sc.labels.get(id))) out.push(l.box);
    return out;
  }
  /** 这行字贴着的是一样摆着的东西（或它的部件）：那一边被占着时东西能让开（贴在两样东西上、贴在别的字上、贴在连线上的不行） */
  roomCanBeMade(l) {
    const sc = this.scene;
    if (l.link || l.refs.length !== 1 || sc.labels.has(l.refs[0])) return false;
    const id = String(l.refs[0]).match(/^[A-Za-z_]\w*/)?.[0];
    const o = id && sc.objects.get(id);
    return !!o && !o.hidden && !!o.origin;
  }
  /** 贴在一样东西的部件上：那样东西自己的「墙」（obstacles 里 wall 的那几条，时间轴的轴），字不隔着它贴 */
  wallsOf(l) {
    if (l.dial || l.link || !l.refs?.length) return [];
    const id = String(l.refs[0]).match(/^[A-Za-z_]\w*/)?.[0];
    const o = id && !this.scene.objects.has(l.refs[0]) ? this.scene.objects.get(id) : null;
    return o ? (this.scene.type(o).nearObstacles?.(o) || []).filter((b) => b.wall) : [];
  }
  /** 这行字摆在这里，会不会压着它贴的那样东西自己的部件（锚着的那几个不算） */
  ownPartsHit(l, box) {
    const sc = this.scene;
    const id = String(l.refs[0]).match(/^[A-Za-z_]\w*/)?.[0];
    const o = id && sc.objects.get(id);
    if (!o) return false;
    let mine = [];
    try { mine = sc.objects.has(l.refs[0]) ? [] : sc.parts(l.refs[0]).map((p) => p.key); } catch { mine = []; }
    const t = sc.type(o);
    if (t.parts(o).some((p) => !mine.includes(p.key) && overlaps(grow(box, 2), t.partBox(o, p)))) return true;
    // 贴在一个部件上：那样东西自己的轴（时间轴的轴、刻度的字，nearObstacles）也是让不开的——小人在轴下面、字写 side=above，
    // 以前只比部件，字照样压在轴和「过去之后」上（主线第六轮，时态课截图）
    if (!mine.length) return false;
    const own = sc.parts(l.refs[0]).map((p) => t.partBox(o, p));
    // 那种东西自己报的「别的字要躲」的框（时间轴的轴和刻度那一条），锚着的那几个部件不算
    const same = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
    // 只看那种东西报的（不看画出来的全部：一排格子上面的弧也是画出来的，算进来的话写 side=above 的字一律换到下面——旧课放回量出来的）
    return (t.nearObstacles?.(o) || []).some((f) => !own.some((a) => same(a, f)) && overlaps(grow(box, 2), f));
  }
  anchorOf(l) {
    const sc = this.scene;
    if (l.link) { const k = sc.links.get(l.link); const g = k && this.linkGeo(k); if (g?.box) return g.box; }
    const boxes = [];
    for (const r of l.refs) {
      if (sc.labels.has(r)) { const n = this.labelNodes.get(r); if (n?.box) boxes.push(n.box); continue; }
      if (!this.isShown(String(r).match(/^[A-Za-z_]\w*/)?.[0])) continue; // 藏着的不当锚
      try { boxes.push(...(sc.objects.has(r) ? [sc.objectBox(r)] : sc.parts(r).map((x) => sc.partBox(x)))); } catch { /* 锚没了 */ }
    }
    return boxes.length ? grow(bbox(boxes), 4) : null;
  }
  // hold：新贴的字先摆好、不露出来，等这一行排完（下面的东西让开、镜头让出地方）再淡进来（revealLabels）——
  // 不然字先出来压着别的东西，过半秒别的东西才让开（2026-11-06 排版检查量出来的）
  async syncLabels(hide = [], { hold = false } = {}) {
    const sc = this.scene;
    const jobs = [];
    // 拨数先摆（别的字可能贴着它）
    const order = [...sc.labels.values()].sort((a, b) => (b.dial ? 1 : 0) - (a.dial ? 1 : 0));
    // 同一样东西旁边的几个拨盘：前面的一个要重摆，后面的跟着重摆（照造的先后排）。不然一个变宽了单独重摆，
    // 会绕到另一个的另一边去——学生眼里两个拨盘上下换了位置（主线第五轮首课走查）
    const redo = new Set();
    for (const l of order) {
      let cur = this.labelNodes.get(l.id);
      // 贴在藏着的东西上的字不画（下面照「没了的」淡掉，show 以后再贴上来）
      if (!this.labelShown(l)) continue;
      const sig = l.dial ? `dial:${l.dial}` : `${l.tone}|${l.text}`;
      if (cur && cur.sig !== sig) { cur.node.remove(); this.labelNodes.delete(l.id); cur = null; }
      const fresh = !cur;
      if (fresh) {
        const node = l.dial ? this.dialNode(l.dial) : el('div', `st-label${l.tone ? ` is-${l.tone}` : ''}`, this.layer);
        if (!l.dial) this.richInto(node, l.text);
        cur = { node, box: null, sig, anchor: null };
        this.labelNodes.set(l.id, cur);
      } else if (!l.dial) {
        cur.node.querySelectorAll('.st-var').forEach((s) => { const x = sc.vars.get(s.dataset.var); const v = x ? varText(x) : s.dataset.var; if (s.textContent !== v) s.textContent = v; });
      }
      if (l.dial) cur.node.__paint?.();
      // 什么都没贴的（拨盘没写 at=）：自由构图时贴着它归的那样东西（不然贴在整台外面，跑出画布）
      const loose = !this.anchorOf(l) && this.free ? this.labelOwner(l) : null;
      const anchor = this.anchorOf(l) || (loose ? grow(sc.objectBox(loose), 4) : null) || bbox(sc.shownIds().map((id) => sc.objectBox(id))) || { x: 0, y: 0, w: 1, h: 1 };
      const size = { w: cur.node.offsetWidth || 80, h: cur.node.offsetHeight || 32 };
      const obs = this.obstacles(l.id);
      // 东西变矮了（泳道 merge 回一排）也要重摆：以前只看左上角和宽，贴在它下面的字、拨盘留在老地方（D1-11）
      const stale = !cur.box || !cur.anchor || Math.abs(cur.anchor.x - anchor.x) > 1 || Math.abs(cur.anchor.y - anchor.y) > 1 || Math.abs(cur.anchor.w - anchor.w) > 1 || Math.abs((cur.anchor.h ?? anchor.h) - anchor.h) > 1 || cur.box.w !== size.w || obs.some((o) => overlaps(grow(cur.box, 1), o));
      if (!stale && !redo.has(l.id)) continue;
      if (l.dial) {
        const key = l.refs.join(' ');
        let after = false;
        for (const m of order) {
          if (m === l) { after = true; continue; }
          if (!after || !m.dial || m.refs.join(' ') !== key) continue;
          redo.add(m.id);
          const cm = this.labelNodes.get(m.id);
          if (cm) cm.box = null; // 它的老位置不挡着前面这一个
        }
      }
      const prefer = l.side ? [l.side, 'above', 'below', 'right', 'left'] : ['above', 'below', 'right', 'left'];
      let p = placeLabel(anchor, size, obs, { prefer, gap: l.dial ? 18 : 12, asked: !l.dial && !!l.asked && !!l.side, walls: this.wallsOf(l) });
      // 老师写了 side=above / below，那一边只是被别的东西占着：照写的那一边摆（只躲别的字），东西会让开——
      // 下面后造的东西照 labelRects 往下让，side=above 的那样东西自己往下让（scene.js 的 reflow）。
      // 以前换到别的一边、也不说，side= 等于没写（主线第一轮 D1-7、D3-4、E1-5）。左右两边没有东西能让，照旧换边、现状里说
      if (!l.dial && l.asked && (l.side === 'above' || l.side === 'below') && p.side !== l.side && this.roomCanBeMade(l)) {
        const others = [...this.labelNodes].filter(([id, n]) => id !== l.id && n.box && sc.labels.has(id) && this.labelShown(sc.labels.get(id))).map(([, n]) => n.box);
        const q = placeLabel(anchor, size, others, { prefer: [l.side], gap: 12, tries: 3, walls: this.wallsOf(l) });
        // 那一边挡着的是它自己那样东西的别的部件（贴在矩阵中间一格、树中间一个结点上）：自己让不开，照旧换到空的一边
        if (!q.none && !this.ownPartsHit(l, { ...q, ...size })) p = q; // 隔着墙（时间轴的轴）摆不了的：placeLabel 找不到那一边，照旧换边
      }
      const from = cur.box;
      const sideWas = cur.side;
      cur.box = { x: p.x, y: p.y, ...size };
      cur.anchor = anchor;
      cur.owner = this.free ? this.labelOwner(l) : null;
      // 画在了哪一边：马上记下、写回场景（和写的 side= 不一样时舞台现状照实说，排版检查也报）。
      // 以前只在下面最后才记，新贴的字（先藏着摆好的那一支）走不到那里，一直不知道自己换了边
      cur.side = p.side;
      if (!l.dial && l.placed !== p.side) l.placed = p.side;
      const node = cur.node;
      if (hide.includes(l.id)) { node.style.transform = tr(p.x, p.y); node.style.opacity = '0'; continue; }
      if (fresh || !from) {
        node.style.transform = tr(p.x, p.y);
        if (hold && !this.instant) { node.style.opacity = '0'; (this.heldLabels ||= new Set()).add(l.id); continue; }
        jobs.push(this.tween(node, [{ opacity: 0, transform: tr(p.x, p.y + 8) }, { opacity: 1, transform: tr(p.x, p.y) }], { duration: 380, easing: EASE.out }));
      } else if (Math.hypot(p.x - from.x, p.y - from.y) > 90 || (sideWas && p.side !== sideWas)) {
        // 挪得远、换到另一边：先淡出、在新地方淡进（滑过去会从别的东西上面压过去）
        jobs.push(this.tween(node, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).then(() => { node.style.transform = tr(p.x, p.y); return this.tween(node, [{ opacity: 0, transform: tr(p.x, p.y + 6) }, { opacity: 1, transform: tr(p.x, p.y) }], { duration: 260, easing: EASE.out }); }));
      } else {
        jobs.push(this.tween(node, [{ transform: tr(from.x, from.y) }, { transform: tr(p.x, p.y) }], { duration: 480 }));
      }
    }
    for (const [id, l] of this.labelNodes) if (!sc.labels.has(id) || !this.labelShown(sc.labels.get(id))) { this.labelNodes.delete(id); jobs.push(this.tween(l.node, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 }).then(() => l.node.remove())); }
    // 字摆好了、还没淡进来：镜头先让出地方（不然贴在上面的字淡进来时和话压在一起，镜头挪完才分开）
    if (jobs.length && !this.instant) this.keepInView();
    await Promise.all(jobs);
  }

  // 话、贴的字、挑战、题卡里的量（{count(t)}）：画成现在的数，数不了画「?」；不是量的（旧课的 {f(x)}）照原样（rules.js 的 measureShown）。
  // 每次 sync 照场景重写一遍（字的长短变了，下面 syncLabels 量大小时用的是新的）
  syncMeasures() {
    for (const s of this.root.querySelectorAll('.st-measure')) { const v = measureShown(this.scene, s.dataset.measure); if (s.textContent !== v) s.textContent = v; }
    // 话里的 {k2} 写在 dial k2 之前：拨数有了就换成它那时的数（只换这一次，和别的话里的拨数一样说完就不跟着变）
    for (const s of this.root.querySelectorAll('.st-var[data-pending]')) { const x = this.scene.vars.get(s.dataset.var); if (x) { s.textContent = varText(x); delete s.dataset.pending; } }
    // 贴的字、题卡、挑战里的 {t: 甲 | 乙 | 丙}：拨盘变了跟着换成现在那一段（话里的没有 __pick：说的那一刻是什么就是什么）
    for (const s of this.root.querySelectorAll('.st-pick')) { if (!s.__pick) continue; const v = pickNow(s.__pick, this.scene.vars); if (s.textContent !== v) s.textContent = v; }
  }

  // 话、字里的写法画出来：{a.2} 是同色同数的小块，{d} 是拨的数，{count(t)} 是页面数的量，$d$ 是字母，[词] 能飞走
  richInto(node, text, { glyphs = null, words = null, still = false } = {}) {
    for (const p of parseRich(text)) {
      // {t: 甲 | 乙 | 丙}：写现在那一段；still（话）不跟着变
      if (p.k === 'pick') { const s = el('span', 'st-pick', node); s.textContent = pickNow({ name: p.name, alts: p.alts, raw: p.v }, this.scene.vars); if (!still) s.__pick = { name: p.name, alts: p.alts, raw: p.v }; glyphs?.push(s); continue; }
      if (p.k === 'text') {
        if (glyphs) {
          // 一个字一个字出来；连着的英文字母、数字（will、1830）包在一个不折行的壳里——不然一个字一个 inline-block，
          // 行尾会把 1830 折成「1」和「830」（主线第五轮首课走查）
          let box = null;
          for (const ch of p.v) {
            const wordy = /[A-Za-z0-9'’]/.test(ch);
            if (wordy && !box) box = el('span', 'st-nb', node); else if (!wordy) box = null;
            const s = el('span', 'st-ch', box || node); s.textContent = ch; glyphs.push(s);
          }
        }
        else node.appendChild(document.createTextNode(p.v));
      } else if (p.k === 'ref') { const chip = this.chip(p.v); node.appendChild(chip); glyphs?.push(chip); }
      else if (p.k === 'var') {
        const s = el('span', 'st-var', node);
        s.dataset.var = p.v;
        const x = this.scene.vars.get(p.v);
        s.textContent = x ? varText(x) : p.v;
        // 写的时候还没有这个拨数（同一轮后面才写 dial）：先写名字，有了以后 syncMeasures 换成数
        if (!x) s.dataset.pending = '1';
        glyphs?.push(s);
      }
      else if (p.k === 'measure') { const s = el('span', 'st-measure', node); s.dataset.measure = p.v; s.textContent = measureShown(this.scene, p.v); glyphs?.push(s); }
      else if (p.k === 'math') { const s = el('i', 'st-math', node); s.textContent = p.v; glyphs?.push(s); }
      else { const s = el('span', 'st-word', node); s.textContent = p.v; glyphs?.push(s); words?.push(s); }
    }
  }
  chip(ref) {
    const chip = el('button', 'st-chip');
    chip.type = 'button';
    try {
      const ps = this.scene.parts(ref);
      const [x] = ps;
      // 一整行、一整列（A.r1）：写这几个数（四个以内），多了写它的名字；点了整组闪一下
      chip.textContent = ps.length > 1 ? (ps.length <= 4 ? ps.map((p) => this.chipText(p)).join(' ') : ref) : this.chipText(x);
      chip.dataset.cell = pidOf(x);
      if (ps.length > 1) chip.dataset.group = '1';
      if (x.paint) chip.dataset.paint = x.paint;
      const keys = ps.map((p) => [p.obj, p.key]);
      chip.addEventListener('click', () => keys.forEach(([obj, key], i) => { const p = this.scene.partOf(obj, key); if (p) this.pulse(p, stagger(i, { step: 40 })); }));
    } catch { chip.textContent = ref; chip.classList.add('is-bad'); }
    return chip;
  }

  // —— 说的话：一个字一个字写出来 ——
  // 一轮里说过的话留在画面上（旧的淡一点、小一点，最多 CAPTION_MAX 句），老师新一轮开口时才收起；
  // 第一版每句话都把上一句擦掉，等学生的时候只剩问题，前面讲了什么全没了
  async say(text, { ask = false } = {}) {
    let live = [...this.caption.querySelectorAll('.st-line:not(.is-out)')];
    const out = (n) => {
      n.classList.add('is-out');
      this.tween(n, [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-14px)' }], { duration: 260, easing: EASE.in }).then(() => n.remove());
    };
    if (!text) { live.forEach(out); return; }
    if (ask && live.at(-1)?.__text === text) return; // 刷新以后重新等最后一问：这句已经在上面了
    this.sceneTalk.push({ text, ask, turn: this.execTurn });
    if (this.sceneTalk.length > 400) this.sceneTalk.splice(0, this.sceneTalk.length - 400);
    this.syncTalkBtn();
    const side = this.sideOn;
    const stick = side && this.atBottom();
    if (side) {
      // 横屏：这一幕说过的话都留在栏里（开新的一幕时 scene 收），前几轮的淡一点、小一点（主线第六轮 2.2）
      if (this.captionTurn !== this.execTurn) live.forEach((n) => n.classList.add('is-past'));
    } else {
      if (!ask && this.captionTurn !== this.execTurn) { live.forEach(out); live = []; }
      live.forEach((n) => n.classList.add('is-past'));
      live.slice(0, Math.max(0, live.length - (CAPTION_MAX - 1))).forEach(out);
    }
    this.captionTurn = this.execTurn;
    const line = el('p', 'st-line', this.caption);
    line.__text = text;
    line.dataset.kind = ask ? 'ask' : 'say';
    const glyphs = [];
    this.richInto(line, text, { glyphs, words: [], still: true });
    // 栏里来了新的一句：滚到底；学生往上翻着看前面时不抢着滚回来，底下出「回到最新」
    if (side) { if (stick || this.instant) this.caption.scrollTop = this.caption.scrollHeight; else this.newest.hidden = false; }
    if (this.instant) return;
    const delays = revealDelays(glyphs.length);
    glyphs.forEach((g, i) => { g.style.opacity = '0'; this.tween(g, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320, delay: delays[i], easing: EASE.out }); });
    // 话多了一行：镜头马上让出地方（不等这一句读完；不然这几秒里新的一行往上长，压到挑战那一条）
    this.keepInView();
    await sleep(this.dur((delays.at(-1) || 0) + 320 + readHold(richLength(parseRich(text)))));
  }

  // —— 能拨的数 ——
  dialNode(name) {
    const node = el('div', 'st-dial', this.layer);
    const dec = el('button', 'st-dial-b', node); dec.type = 'button'; dec.textContent = '‹'; dec.setAttribute('aria-label', `${name} 小一点`);
    const lab = el('span', 'st-dial-v', node);
    const inc = el('button', 'st-dial-b', node); inc.type = 'button'; inc.textContent = '›'; inc.setAttribute('aria-label', `${name} 大一点`);
    const paint = () => {
      const v = this.scene.vars.get(name); if (!v) return;
      // 拨词的拨盘只写那个词（「t = 现在」里的 t 是老师起的代号，对学生是多出来的字；两个拨盘照里面的词分得开）。拨数的照旧写「d = 5」
      // 宽度照最长的那个词定：换词的时候 ‹ › 不挪（学生连着点同一个地方）
      if (v.options) { lab.innerHTML = '<b></b>'; node.classList.add('is-words'); lab.style.minWidth = `${(Math.max(...v.options.map((w) => [...w].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 1 : 0.6), 0))) * 1.1 + 0.6).toFixed(1)}em`; } else { lab.innerHTML = '<i class="st-math"></i> = <b></b>'; lab.firstChild.textContent = name; }
      lab.lastChild.textContent = varText(v); dec.disabled = v.v <= v.lo; inc.disabled = v.v >= v.hi; };
    node.__paint = paint;
    paint();
    // want：已经点了、还排着没演到的那个值。连着点 › › ›（上一下的句子还在重排）要从它接着数——以前从场景里还没改的旧值数，
    // 第二下和第一下拨到同一个值，等于被吞了（主线第五轮首课走查：真手指连点三下只走两格）
    let want = null, last = null;
    const at = () => want ?? this.scene.vars.get(name).v;
    const set = (v) => {
      const cur = this.scene.vars.get(name);
      const nv = Math.max(cur.lo, Math.min(cur.hi, v));
      const from = at();
      if (nv === from) return;
      // 拨词的拨盘（options=）：交出去的是词（set t 将来；课堂写「学生拨了 t：现在 → 将来」）
      const w = (k) => (cur.options ? cur.options[k - 1] : k);
      want = nv;
      // 排着还没开始演的上一下不演了，直接拨到最后点到的那个值（连点三下演一次，不是排着队演三次动画）
      if (last && !last.started) last.cancelled = true;
      const job = last = { started: false, cancelled: false };
      const act = { type: 'dial', name, value: w(nv), from: w(from) };
      Promise.resolve(this.studentDo(`set ${name} ${w(nv)}`, act, { cancelled: () => job.cancelled, onStart: () => { job.started = true; act.from = w(this.scene.vars.get(name).v); } }))
        .finally(() => { if (want === nv) want = null; paint(); });
    };
    dec.addEventListener('click', () => set(at() - 1));
    inc.addEventListener('click', () => set(at() + 1));
    // 按住数字左右拖也能拨（一格 36px）
    let sx = null, sv = 0;
    lab.addEventListener('pointerdown', (e) => { sx = e.clientX; sv = this.scene.vars.get(name).v; lab.setPointerCapture?.(e.pointerId); });
    lab.addEventListener('pointermove', (e) => { if (sx != null) set(sv + Math.round((e.clientX - sx) / 36)); });
    lab.addEventListener('pointerup', () => { sx = null; });
    lab.addEventListener('pointercancel', () => { sx = null; });
    return node;
  }

  // 学生的动作改了舞台（拨数、拖过去换位置、拖动平面上的向量、转一下、做一步行变换、拉一段括号）：照一行指令走场景
  // （记进 log，刷新、作废都照它放回）。先过裁判：结论挂在 act 上（act.verdict），场景改好了（或者没让做）才交给课堂——
  // 以前是一拖完马上交，那时还不知道这一下对不对、做完了没有
  //
  // 拨数、拨格子（± 拨数器）的每一下还挂上挑战每一句那时成不成立，events.js 照它把一条路写成「Dd = O：✗ ✗ ✗ ✓」：
  // 一条路的第一下记下那时还没做到的挑战（ids），marks0 是这一下之前；每一下都拿这一组 ids 判（做到了的那一停照样标得出 ✓），
  // marks 是这一下之后，met 是这一下做到的挑战
  studentDo(src, act, { cancelled = null, onStart = null } = {}) {
    const [c] = parseScript(src);
    const runKey = act.type === 'dial' ? `dial:${act.name}` : act.type === 'edit' ? `edit:${act.ref}` : null;
    let run = null;
    let sent = false;
    const told = () => {
      if (sent) return;
      sent = true;
      if (run) {
        act.marks = this.scene.clauseMarks(run.ids);
        act.met = [...this.scene.goals.values()].filter((g) => g.met && !run.met0.has(g.id)).map((g) => g.id);
        // 没演上的一下不算路上的一步（events.js 单独写一行）：它开的头不算，下一下重新开头
        if (run.first && (act.blocked || act.error || act.failed)) this.dialRuns.delete(runKey);
        // 算进路上的一下：记下停在哪，下一下从别处拨起（中间被别的动过）就另起一条
        else if (pathKey(act) === runKey && this.dialRuns.get(runKey) === run.r) run.r.end = pathEnd(act);
      }
      this.onAct?.(act);
    };
    this.studentChain = (this.studentChain || Promise.resolve())
      .then(() => {
        // 排着的时候被后一下顶掉了（拨盘连着点）：不演、不告诉课堂
        if (cancelled?.()) { sent = true; return null; }
        onStart?.();
        // 照这一下真演的时候判（前一下可能还在演）
        if (runKey) {
          let r = this.dialRuns.get(runKey);
          // 中间这个数、这一格被别的动过（从几拨起对不上）：events.js 写给老师时另起一条路，这里也另起，新的一条开头带 marks0（✓ ✗ 照样写得出）
          if (r && !pathGoesOn(r.end, act)) { this.dialRuns.delete(runKey); r = null; }
          const first = !r;
          if (first) { r = { ids: this.pendingGoals().map((g) => g.id), end: null }; this.dialRuns.set(runKey, r); act.marks0 = this.scene.clauseMarks(r.ids); }
          run = { r, ids: r.ids, first, met0: new Set([...this.scene.goals.values()].filter((g) => g.met).map((g) => g.id)) };
        }
        return this.exec({ ...c, dragged: act.type === 'drag' }, { by: 'student', act, told });
      })
      .catch(() => {})
      .then(() => { this.resyncWait?.(); })
      .then(told);
    return this.studentChain;
  }

  // —— 自由构图（主线第八轮）——
  /** 一样东西连同只贴在它身上的字占的世界框（求解器把它们当一体摆） */
  unionBox(id) {
    const sc = this.scene;
    const b = sc.objectBox(id);
    // 贴在它身上的字、拨盘（贴在几样上的算第一样的；什么都没贴的拨盘算这一轮讲的那样的，syncLabels 的 owner）：和它当一体摆，不然不进排版，压着别的、出屏幕
    const own = [...this.labelNodes].filter(([lid, n]) => n.box && n.owner === id && sc.labels.has(lid) && this.labelShown(sc.labels.get(lid))).map(([, n]) => n.box);
    return bbox([b, ...own]);
  }
  /** 一张字、一个拨盘归哪样东西（排版时和它一起摆）：贴着的第一样；什么都没贴（拨盘没写 at=）归这一轮讲的那样 */
  labelOwner(l) {
    const sc = this.scene;
    for (const r of l.refs || []) {
      if (sc.labels.has(r)) { const o = this.labelNodes.get(r)?.owner; if (o) return o; continue; }
      const id = String(r).match(/^[A-Za-z_]\w*/)?.[0];
      if (id && sc.objects.has(id) && this.isShown(id)) return id;
    }
    const shown = sc.shownIds();
    return shown.includes(this.lastTouched) ? this.lastTouched : shown.at(-1) || null;
  }
  /** 样子（老师的 style；all 垫底）：名字 → { frame, size, color, weight, align } */
  styleOf(name) { return { ...(this.scene.styles?.get('all') || {}), ...(this.scene.styles?.get(name) || {}) }; }
  /**
   * 照老师写的 style 画：带不带框、多大、什么颜色、粗细、对齐（画面上的东西的样子都归老师定；默认话不带框，别的照原样带框）。
   * 返回有没有变（变了大小要重量）
   */
  applyStyles() {
    if (!this.free) return false;
    let changed = false;
    const put = (node, st, frameDefault) => {
      if (!node) return;
      const frame = st.frame || frameDefault;
      const sig = `${frame}|${st.size || ''}|${st.color || ''}|${st.weight || ''}|${st.align || ''}`;
      if (node.__look === sig) return;
      node.__look = sig;
      changed = true;
      node.classList.toggle('st-noframe', frame === 'off');
      node.classList.toggle('st-framed', frame === 'on');
      for (const k of ['size', 'color', 'weight', 'align']) {
        const key = `look${k[0].toUpperCase()}${k.slice(1)}`;
        if (st[k]) node.dataset[key] = st[k]; else delete node.dataset[key];
      }
    };
    put(this.caption, this.styleOf('say'), 'off');
    put(this.goalsEl, this.styleOf('goals'), 'on');
    for (const [id, cur] of this.labelNodes) if (!this.scene.labels.get(id)?.dial) put(cur.node, this.styleOf(id), 'on');
    for (const id of this.scene.shownIds()) {
      const st = this.styleOf(id);
      for (const n of this.root.querySelectorAll(`[data-obj="${CSS.escape(id)}"]`)) if (n.parentElement === this.layer) put(n, st, 'on');
    }
    return changed;
  }
  /** 能折行的东西（句子）折成几种宽时的世界大小；不能折、折了一样大的给 null */
  altsOf(id) {
    const sc = this.scene, o = sc.objects.get(id);
    if (o?.type !== 'sentence') return null;
    const t = sc.type(o), est = t.objectBox(o), u = this.unionBox(id);
    const out = [];
    for (const width of SENTENCE_WIDTHS) {
      const b = t.objectBox({ ...o, width });
      const a = { w: b.w + (u.w - est.w), h: b.h + (u.h - est.h), width };
      if (!out.some((x) => Math.abs(x.w - a.w) < 2 && Math.abs(x.h - a.h) < 2)) out.push(a);
    }
    return out.length > 1 ? out : null;
  }
  /** 一块画面（话、挑战）在几种宽下有多高：画布像素 */
  measureBlock(node, widths) {
    const keep = node.style.width;
    const out = [];
    for (const w of widths) {
      node.style.width = `${Math.round(w)}px`;
      const h = node.offsetHeight;
      if (h > 0 && !out.some((x) => Math.abs(x.h - h) < 2)) out.push({ w: Math.round(w), h });
    }
    node.style.width = keep;
    return out;
  }
  /**
   * 量、解、摆：每样东西的真实大小 + 老师的构图意图 → 求解器 → 东西挪到算出来的地方（一行 pos 记进 log：刷新、回看照它放回），
   * 话、挑战两块照算出来的框摆，镜头固定在这一档字号。重放（instant）时不摆：log 里的 pos 已经把东西放回去了。
   * 返回有没有东西挪了
   */
  async compose({ animate = true } = {}) {
    if (!this.free || this.instant) return false;
    if (this.dragging) { this.camLater = true; return false; }
    // 摆着的时候又要摆（摆完那一下 sync 里贴字、长高又叫了一次）：不叠着摆，等这一次摆完。摆的过程里自己引出来的不算
    if (this.composing) { if (!this.composeQuiet) this.composeAgain = true; return false; }
    this.composing = true;
    let moved = false;
    try {
      for (let round = 0; round < 3; round++) {
        this.composeAgain = false;
        moved = (await this.composeOnce({ animate })) || moved;
        if (!this.composeAgain) break;
      }
    } finally {
      this.composing = false;
      this.composeAgain = false;
    }
    return moved;
  }
  async composeOnce({ animate }) {
    const sc = this.scene;
    // 老师写的样子先画上（大小变了要先重量一遍再排）
    if (this.applyStyles()) {
      this.composeQuiet = true;
      try { await this.sync({}); this.measure(); } finally { this.composeQuiet = false; }
    }
    const { w, h } = this.viewSize();
    // 底下那一条留一个固定的高（输入框出来、收起时画布不跟着变，东西就不上下晃）；比它高时照量的
    const dockH = Math.max(DOCK_ROOM, this.dock.childElementCount ? this.dock.offsetHeight + 8 : 0);
    const cv = canvasOf({ w, h, dockH });
    const grid = gridOf(cv);
    const ts = typeScaleOf({ w });
    this.root.style.setProperty('--ts', String(Math.round(ts * 1000) / 1000));
    this.root.style.setProperty('--cell', `${grid.cell}px`);
    const baseS = this.baseCam?.s || ts;
    const prevBox = (id) => this.layoutState?.boxes.get(id);
    const extras = [];
    const capOn = !!this.caption.querySelector('.st-line:not(.is-out), .st-how');
    this.caption.hidden = !capOn;
    if (capOn) {
      // 先试 18 格宽（读着最舒服），挤了再试窄的、宽的
      const alts = this.measureBlock(this.caption, [18, 13, 24].map((n) => n * grid.cell));
      if (alts.length) extras.push({ id: 'say', ...alts[0], alts, ...(prevBox('say') ? { prev: prevBox('say') } : {}) });
    }
    const goalsOn = !!this.goalsEl.childElementCount && [...this.goalsEl.children].some((n) => n.offsetWidth);
    if (goalsOn) {
      const gw = Math.min(24 * grid.cell, Math.max(...[...this.goalsEl.children].map((n) => n.scrollWidth + 2)));
      const [g] = this.measureBlock(this.goalsEl, [gw]);
      // 挑战默认在画布左上角一条（老师 place goals … 了照老师的）
      if (g) extras.push({ id: 'goals', ...g, ...(sc.layout.has('goals') ? (prevBox('goals') ? { prev: prevBox('goals') } : {}) : { fixed: { x: 0, y: 0, w: g.w, h: g.h } }) });
    }
    const partBox = (ref) => { try { return bbox(sc.parts(ref).map((p) => sc.partBox(p))); } catch { return null; } };
    const { items, relations } = composeInput(sc, { ts, camS: baseS, grid, boxOf: (id) => this.unionBox(id), altsOf: (id) => this.altsOf(id), partBox, extras, lastTouched: this.lastTouched });
    if (!items.length) { this.layoutState = { boxes: new Map(), unmet: [], scale: 1, grid, canvas: cv }; sc.layoutInfo = null; return false; }
    const res = solveLayout({ canvas: cv, grid, items, relations });
    const s = ts * res.scale;
    // 东西挪到算出来的地方
    const moves = [];
    for (const it of items) {
      if (it.rigid) continue;
      const B = res.boxes.get(it.id), o = sc.objects.get(it.id);
      if (!B || !o) continue;
      const U = this.unionBox(it.id), est = sc.type(o).objectBox(o);
      let width = null;
      if (it.alts) {
        const alts = this.altsOf(it.id) || [];
        const k = it.alts.reduce((bi, a, i) => (Math.abs(a.w * res.scale - B.w) < Math.abs(it.alts[bi].w * res.scale - B.w) ? i : bi), 0);
        width = alts[k]?.width || null;
        if (width === (o.width || SENTENCE_WIDTHS[0])) width = null;
      }
      const x = est.x + B.x / s - U.x, y = est.y + B.y / s - U.y;
      if (!o.placed || width || Math.abs(x - est.x) > 0.6 || Math.abs(y - est.y) > 0.6) moves.push({ id: it.id, x, y, width });
    }
    if (moves.length) {
      const src = posLine(moves);
      const [c] = parseScript(src);
      this.scene.apply({ ...c, lenient: true });
      this.log.push({ src, by: 'page', turn: this.execTurn ?? this.turnNo });
    }
    // 话、挑战两块
    const place = (node, B) => {
      if (!node || !B) return;
      node.style.left = `${Math.round(cv.left + B.x)}px`;
      node.style.top = `${Math.round(cv.top + B.y)}px`;
      node.style.width = `${Math.round(B.w)}px`;
    };
    this.root.classList.toggle('is-composed', !this.reduced && animate);
    if (capOn) place(this.caption, res.boxes.get('say'));
    if (goalsOn) place(this.goalsEl, res.boxes.get('goals'));
    // 镜头：固定这一档（老师 camera X 凑近时不动它，camera all 回来）
    this.baseCam = { s, tx: cv.left, ty: cv.top };
    this.layoutState = { boxes: res.boxes, unmet: res.unmet, scale: res.scale, grid, canvas: cv };
    // 现状里的「版面」：每样占哪几格、没照办的
    // 页面自己加的默认关系（话贴着讲的那样）没照办不告诉老师：老师没写过
    sc.layoutInfo = layoutLines({ boxes: res.boxes, grid, unmet: res.unmet.filter((u) => !u.rel?.auto), scale: res.scale });
    if (!sc.focus) {
      const from = `translate(${this.cam.tx}px, ${this.cam.ty}px) scale(${this.cam.s})`;
      const to = `translate(${this.baseCam.tx}px, ${this.baseCam.ty}px) scale(${this.baseCam.s})`;
      const camMoved = Math.abs(this.cam.s - s) > 1e-3 || Math.abs(this.cam.tx - cv.left) > 0.5 || Math.abs(this.cam.ty - cv.top) > 0.5;
      this.cam = { ...this.baseCam };
      if (camMoved) {
        this.world.getAnimations?.().forEach((a) => a.cancel());
        if (!animate || this.reduced) this.world.style.transform = to;
        else this.tween(this.world, [{ transform: from }, { transform: to }], { duration: 520, easing: EASE.move });
      } else if (!this.world.style.transform) this.world.style.transform = to;
      this.noteClipped();
    }
    if (moves.length) {
      this.composeQuiet = true;
      try { await this.sync({}); } finally { this.composeQuiet = false; }
    }
    return moves.length > 0;
  }
  /** 预览交回老师的：版面那几行 + 字画的图（compose/sketch.js） */
  previewText() {
    const st = this.layoutState;
    if (!st?.boxes?.size) return '舞台上还是空的。';
    return [...layoutLines({ boxes: st.boxes, grid: st.grid, unmet: st.unmet.filter((u) => !u.rel?.auto), scale: st.scale }), sketchText({ boxes: st.boxes, grid: st.grid })].join('\n');
  }
  /** 「说过的」：这一幕说过的话（前几轮的）列在一张浮层里 */
  toggleTalk(on = this.talkPop?.hidden) {
    if (!this.talkPop) return;
    this.talkPop.hidden = !on;
    if (!on) return;
    this.talkPop.textContent = '';
    const card = el('div', 'st-talk-card', this.talkPop);
    const head = el('div', 'st-talk-head', card);
    head.textContent = '这一幕说过的';
    const close = el('button', 'st-talk-close', head);
    close.type = 'button';
    close.textContent = '收起';
    close.addEventListener('click', () => this.toggleTalk(false));
    const list = el('div', 'st-talk-list', card);
    let turn = null;
    for (const x of this.sceneTalk || []) {
      if (turn != null && x.turn !== turn) el('hr', 'st-talk-sep', list);
      turn = x.turn;
      const p = el('p', 'st-talk-line', list);
      if (x.ask) p.classList.add('is-ask');
      this.richInto(p, x.text, { glyphs: [], words: [], still: true });
    }
    list.scrollTop = list.scrollHeight;
  }
  /** 「说过的」那个按钮：这一幕有前几轮说过的话才出来 */
  syncTalkBtn() {
    if (!this.talkBtn) return;
    const all = this.sceneTalk || [];
    this.talkBtn.hidden = !all.some((x) => x.turn !== all.at(-1)?.turn);
  }

  // —— 镜头 ——
  viewSize() { return { w: this.view.clientWidth || 800, h: this.view.clientHeight || 600 }; }
  reserve() {
    if (this.bare) return { top: 6, bottom: 6 };
    // 横屏：话、挑战、底下那一条都在左边的栏里，画面上下不用让；底下那一条挪到画面底部时让出它的高
    if (this.sideOn) return { top: 16, bottom: this.dock.parentElement === this.wideDock && this.dock.childElementCount ? this.dock.offsetHeight + 20 : 16 };
    const ch = Math.max(84, (this.caption.offsetHeight || 0) + 34);
    const gh = this.goalsEl?.childElementCount ? this.goalsEl.offsetHeight + 14 : 0;
    // 底下那一条按量出来的高（按钮折到第二行、ask say 时输入框是主角都会更高；以前写死 104，高了就压着画面）
    const dh = this.dock.childElementCount ? this.dock.offsetHeight + 16 : 40;
    return { top: ch + 18 + gh, bottom: Math.max(40, dh) };
  }
  /**
   * 镜头把 box 放在哪。挑战那几条一直摞在左上角：竖屏时它们下面才是话和画面（上面让出它们的高）；
   * 横屏时屏幕宽、不高，挑战有四五条、话有三行，上面一让画面只剩半屏，整台缩到四成（主线第一轮留下的那一条）。
   * 横屏时再算一种：挑战那一列留在左边，话和画面放在它右边——画面明显大（大一成以上）就用这一种，话跟着让到右边
   */
  fitView(box) {
    const view = this.viewSize();
    // 自由构图：没对准什么时镜头就是摆好时的那一档；camera X 凑近照旧
    if (this.free) {
      if (!this.scene.focus && this.baseCam) return { ...this.baseCam };
      const dh = this.dock.childElementCount ? this.dock.offsetHeight + 16 : 40;
      return fitCamera(box, view, { top: 16, bottom: dh, pad: CAMERA_ROOM.pad, maxScale: 1.5, lift: 0.4 });
    }
    if (this.sideOn) {
      const { top, bottom } = this.reserve();
      const opts = { bottom, pad: CAMERA_ROOM.pad, maxScale: 1.5, lift: 0.4, top };
      // 栏宽只在一轮开头、造了新东西、开新一幕、换了屏幕时重算（sideDirty），一轮中间不换；拖着的时候镜头本来就不动
      if (this.sideDirty || !this.sideW) {
        this.sideDirty = false;
        this.setSideW(pickSide(box, view, { top, bottom, pad: CAMERA_ROOM.pad, lines: (w) => this.askLines(w), cur: this.sideW || null }).w);
      }
      this.camSide = false;
      return fitCamera(box, view, { ...opts, left: this.sideW });
    }
    const cap = this.caption.style;
    const capLeft = (px) => { cap.paddingLeft = px ? `${px}px` : ''; if (px) cap.setProperty('--cap-left', `${px}px`); else cap.removeProperty('--cap-left'); }; // 淡出的旧话是绝对定位的，照 --cap-left 让
    if (cap.paddingLeft) capLeft(0); // 先照「上面让」量话有多高
    const { top, bottom } = this.reserve();
    const opts = { bottom, pad: CAMERA_ROOM.pad, maxScale: 1.5, lift: 0.4 };
    const a = fitCamera(box, view, { ...opts, top });
    const kids = this.goalsEl?.childElementCount ? [...this.goalsEl.children].filter((n) => n.offsetWidth) : [];
    if (!kids.length || view.w <= view.h) { this.camSide = false; return a; }
    const left = Math.round(this.goalsEl.offsetLeft + Math.max(...kids.map((n) => n.offsetLeft + n.offsetWidth)) + 8);
    if (left > view.w * 0.4) { this.camSide = false; return a; }
    capLeft(left); // 话让到右边（窄了可能多折一行：照让过以后的高算）
    const ch = Math.max(84, (this.caption.offsetHeight || 0) + 34);
    const b = fitCamera(box, view, { ...opts, top: ch + 18, left });
    // 已经在右边那一种时，差一点也不换回去（来回换画面会左右跳）
    if (b.s >= a.s * (this.camSide ? 1.02 : 1.1)) { this.camSide = true; return b; }
    this.camSide = false;
    capLeft(0);
    return a;
  }
  focusBox() {
    const sc = this.scene;
    const boxes = [];
    if (!sc.focus) {
      for (const id of sc.shownIds()) boxes.push(sc.objectBox(id));
      for (const l of this.labelNodes.values()) if (l.box) boxes.push(l.box);
      for (const l of sc.links.values()) { if (!this.linkShown(l)) continue; const g = this.linkGeo(l); if (g.box) boxes.push(g.box); }
    } else {
      for (const r of sc.focus) { try { boxes.push(...(sc.objects.has(r) ? [sc.objectBox(r)] : sc.parts(r).map((x) => sc.partBox(x)))); } catch { /* 没了 */ } }
      // 对准几样东西：只带贴在这几样上的字。以前台上所有贴的字都算进来——camera tl 时贴在句子 p 下面的译文也算，
      // 话贴着它的上沿摆，正好压在句子上（时态课截图第 1 条）
      const on = new Set(sc.focus.filter((r) => sc.objects.has(r)));
      if (on.size) for (const [id, l] of this.labelNodes) { const lab = sc.labels.get(id); if (l.box && lab && (lab.refs || []).some((r) => on.has(String(r).match(/^[A-Za-z_]\w*/)?.[0]))) boxes.push(l.box); }
    }
    const b = bbox(boxes);
    return b ? grow(b, 12) : null;
  }
  // fast：东西在挪、在造的时候镜头和它们一样快（0.46 秒；平时 0.76 秒慢慢走）——镜头比东西慢，东西先到，那一会儿就跑出屏幕
  async camera(box, animate = true, { fast = false } = {}) {
    if (!box) return;
    if (this.dragging) { this.camLater = true; return; }
    const next = this.fitView(box);
    const from = `translate(${this.cam.tx}px, ${this.cam.ty}px) scale(${this.cam.s})`;
    const to = `translate(${next.tx}px, ${next.ty}px) scale(${next.s})`;
    this.cam = next;
    this.noteClipped();
    this.placeCaption(box, animate);
    // 上一次镜头还在走：停在它现在的位置，从那里接着走（不然它走完会把旧镜头写回去，cam 和画面对不上）
    const cur = this.world.getAnimations?.() || [];
    const live = cur.length ? getComputedStyle(this.world).transform : null;
    cur.forEach((a) => a.cancel());
    if (!animate || this.instant) { this.world.style.transform = to; return; }
    await this.tween(this.world, [{ transform: live && live !== 'none' ? live : from }, { transform: to }], { duration: fast ? 460 : 760, easing: EASE.move });
  }
  refocus(animate = true) {
    if (this.free && !this.scene.focus) return this.compose({ animate });
    return this.camera(this.focusBox(), animate);
  }
  // 新东西跑出镜头了（新贴的字、长高的弧），镜头挪一挪；不用挪也让话让开
  // extra：挪动中的「之前」也框进来（东西缩回去、镜头要拉近时，先别拉近：还在往回滑的东西会被切到屏幕外面；挪完再收紧）
  async keepInView({ fast = false, extra = null } = {}) {
    if (this.dragging) { this.camLater = true; return; }
    if (this.free && !this.scene.focus) { await this.compose({ fast }); return; }
    const box0 = this.focusBox();
    const box = box0 && extra && !this.scene.focus ? bbox([box0, extra]) : box0;
    if (!box) return;
    if (this.scene.focus && !this.scene.focus.some((r) => this.scene.objects.has(r))) { this.placeCaption(box, true); return; }
    const next = this.fitView(box);
    if (Math.abs(next.s - this.cam.s) / this.cam.s > 0.03 || Math.abs(next.tx - this.cam.tx) > 14 || Math.abs(next.ty - this.cam.ty) > 14) await this.camera(box, true, { fast });
    else { this.noteClipped(); this.placeCaption(box, true); }
  }
  // 说的话的下沿贴着镜头里那块东西的上方，镜头挪了它跟着挪
  placeCaption(box, animate) {
    if (!box || this.free) return; // 自由构图：话是求解器摆的一块
    if (this.sideOn) { this.caption.style.bottom = ''; return; } // 横屏：话在栏里，不跟着画面
    const { h } = this.viewSize();
    const topScreen = box.y * this.cam.s + this.cam.ty;
    this.caption.style.transition = animate && !this.reduced && !this.instant ? `bottom ${this.dur(760)}ms ${EASE.move}` : 'none';
    // 话贴着镜头里那块东西的上方。老师对准一部分（camera tl）时，台上别的东西（句子）可能正摆在话的位置上（时态课截图第 1 条）：
    // 先把话挪到那几样的上面；上面放不下（会压到挑战），话照旧，垫一块毛玻璃
    let edge = topScreen;
    let backed = false;
    const capH = this.caption.offsetHeight || 0;
    if (this.scene.focus && capH) {
      const c = this.cam, R = this.caption.getBoundingClientRect(), V = this.view.getBoundingClientRect();
      const lines = [...this.caption.querySelectorAll('.st-line:not(.is-out)')].map((n) => n.getBoundingClientRect());
      const x0 = lines.length ? Math.min(...lines.map((r) => r.left)) - V.left : R.left - V.left, x1 = lines.length ? Math.max(...lines.map((r) => r.right)) - V.left : R.right - V.left;
      const boxes = [...this.scene.shownIds().map((id) => this.scene.objectBox(id)), ...[...this.labelNodes.values()].filter((l) => l.box && l.node.style.opacity !== '0').map((l) => l.box)]
        .map((b) => ({ x: b.x * c.s + c.tx, y: b.y * c.s + c.ty, w: b.w * c.s, h: b.h * c.s }));
      // 话的下沿在 bottomEdge 时（话占 [bottomEdge - 22 - capH, bottomEdge - 22]）压着哪几样
      const hits = (bottomEdge) => boxes.filter((r) => r.y < bottomEdge - 22 && r.y + r.h > bottomEdge - 22 - capH && r.x < x1 && r.x + r.w > x0);
      const under = hits(edge);
      if (under.length) {
        const floor = (this.goalsEl?.childElementCount ? this.goalsEl.offsetTop + this.goalsEl.offsetHeight : 0) + 12;
        const ceil = h - (this.dock.childElementCount ? this.dock.offsetHeight + 16 : 40);
        const up = Math.min(...under.map((r) => r.y));
        const fb = box.y * c.s + c.ty + box.h * c.s; // 镜头对准的那块的下沿
        const below = fb + 22 + capH + 22; // 话放在它下面时的「下沿」
        if (up - 22 - capH >= floor && !hits(up).length) edge = up;
        else if (below <= ceil && !hits(below).length) edge = below;
        else backed = true;
      }
    }
    this.caption.classList.toggle('is-backed', backed);
    this.caption.style.bottom = `${Math.max(0, Math.round(h - edge + 22))}px`;
  }
  toScreen(p) { return { x: p.x * this.cam.s + this.cam.tx, y: p.y * this.cam.s + this.cam.ty }; }
  /** 屏幕上的一点 → 世界坐标（平面上拖向量用） */
  toWorld(clientX, clientY) {
    const r = this.view.getBoundingClientRect();
    return { x: (clientX - r.left - this.cam.tx) / this.cam.s, y: (clientY - r.top - this.cam.ty) / this.cam.s };
  }

  // —— 等学生：点、拖、点按钮、打字、填一个答案；等待期间拨数是「试」，攒着跟回答一起说 ——
  /**
   * 挂上现在场景里的那一问（一轮演完、做到挑战时预写的行里有 ask 都走这里）：答了 onAnswer 告诉课堂，
   * 被换掉（预写的新一问、作废）是 cancel
   */
  armWait() {
    const w = this.scene.waiting;
    if (!w) return Promise.resolve(null);
    if (this.armedFor === w && this.armedP) return this.armedP;
    if (this.armedFor) this.cancelWait?.(); // 还挂着上一问（「给个提示」、被预写的新一问换掉的）：先收起，同一时间只等一问
    this.armedFor = w;
    this.armedP = this.waitAct().then((act) => {
      if (this.armedFor === w) { this.armedFor = null; this.armedP = null; }
      if (act && act.type !== 'cancel') {
        // 答对了这一问（页面判的：点对了、点的几样一样、填对了）：@ask.right 预写的行马上演，只演一次；课堂看学生手上还有没有事再叫老师
        const right = act.type === 'pick' ? act.same === true : act.right === true;
        let reacts = null;
        if (right && w.right?.length) {
          reacts = w.right.map((src) => ({ ask: true, src }));
          delete w.right;
          act.reacted = reacts.length;
          this.react(reacts, this.turnNo);
        } else if (w.right || w.rightKey) this.scene.endAsk(w); // 没答对（答错、判不了、打了字、点了按钮）：这一问的 @ask.right 连同套着的拿掉
        this.onAnswer?.(act, w, reacts ? { reacts } : {});
      }
      return act;
    });
    return this.armedP;
  }
  waitAct() {
    const w = this.scene.waiting;
    if (!w) return Promise.resolve(null);
    return new Promise((resolve) => {
      const offs = [];
      let over = false;
      const finish = async (act) => {
        if (over) return;
        over = true;
        offs.forEach((f) => f());
        this.dock.replaceChildren();
        this.cancelWait = null;
        if (this.scene.waiting === w) this.scene.waiting = null;
        await this.studentChain;
        // 等着的时候拨的数不再塞进回答（act.tries）：每一下都是试的事件，events.js 写成一条路，回答那一下只写回答
        resolve({ ...act });
      };
      this.cancelWait = () => finish({ type: 'cancel' });
      const sc = this.scene;
      const partsOf = (refs) => (refs.length ? refs.flatMap((r) => sc.parts(r)) : sc.allParts());
      // 能点的那几个照现在的舞台挂：等着的时候句子重排了（学生拨了拨盘、拖了小人，新换上来的词是新的节点），
      // 新的补挂上、没了的收掉（resyncWait，学生每做完一下、预写演完都叫一次）。以前只在问的那一刻挂一次：新词没有下划线、点不了
      const armed = new Map(); // pid → 收掉它
      const syncTaps = (arm) => {
        let ps = [];
        try { ps = partsOf(w.refs); } catch { return; }
        const now = new Set(ps.map(pidOf));
        for (const [pid, off] of armed) if (!now.has(pid) || !this.nodes.get(pid)?.classList.contains('is-tap')) { off(); armed.delete(pid); }
        for (const x of ps) if (!armed.has(pidOf(x)) && this.nodes.get(pidOf(x))) armed.set(pidOf(x), arm(x));
      };
      const tapsOn = (arm) => { syncTaps(arm); this.resyncWait = () => { if (!over) syncTaps(arm); }; offs.push(() => { this.resyncWait = null; for (const off of armed.values()) off(); armed.clear(); }); };
      if (w.kind === 'tap') {
        tapsOn((x) => this.armTap(x, () => {
          const act = tapAnswer(sc, sc.partOf(x.obj, x.key) || x, w.expect);
          this.onAct?.(act);
          finish(act);
        }));
      }
      if (w.kind === 'pick') {
        // 一次点几样：点一下亮一圈、再点取消，按按钮交。交的那一下照学生的一行 pick … 走（记进 log，刷新照它放回；
        // ask 写了 reveal=on 就带上：重放时 ask 不重放，只能从这一行拿），和 expect 比是交的这一刻比的、进回答。
        // 一个都没点时按钮按不了（觉得一个都不是，可以在下面直接写一句）
        const chosen = new Map(); // pid → 部件，照点的先后
        const btn = el('button', 'st-next st-pick-go', this.dock);
        btn.type = 'button';
        btn.textContent = `${w.button || '点好了'} →`;
        btn.disabled = true;
        this.tween(btn, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 360, easing: EASE.out });
        tapsOn((x) => {
          const pid = pidOf(x);
          return this.armTap(x, () => {
            if (over) return;
            if (chosen.has(pid)) chosen.delete(pid); else chosen.set(pid, x);
            this.nodes.get(pid)?.classList.toggle('is-picking', chosen.has(pid));
            btn.disabled = !chosen.size;
          });
        });
        offs.push(() => { for (const pid of chosen.keys()) this.nodes.get(pid)?.classList.remove('is-picking'); });
        btn.addEventListener('click', async () => {
          if (over || btn.disabled) return;
          // 照场景现在的样子找回点的几个（点完以后学生可能又动过别的）：没了的不算
          const ps = [...chosen.values()].map((x) => sc.partOf(x.obj, x.key)).filter(Boolean);
          if (!ps.length) { chosen.clear(); return; }
          btn.disabled = true;
          const refs = ps.map((p) => sc.refOf(p));
          let act;
          try { act = pickAnswer(sc, refs, w.expect, { order: !!w.order }); } catch (err) {
            act = { type: 'pick', refs: ps.map((p) => sc.tapRef(p)), expected: w.expect?.join(' ') ?? null, same: null, extra: [], missing: [], why: `页面没比成：${err?.message || err}` };
            reportError(err, { what: `舞台的 ask pick 和 expect 比：${w.prompt || ''}` });
          }
          // 点的那几样写成字（错题本里「我点的」要看得懂，不是 e.4 e.5）
          act.words = ps.map((p) => String(p.value ?? p.text ?? '')).filter(Boolean).join(' ');
          await this.studentDo(`pick ${refs.join(' ')}${w.reveal ? ' reveal=on' : ''}`, act);
          finish(act);
        });
      }
      if (w.kind === 'drag') {
        const peers = partsOf(w.refs);
        for (const x of peers) {
          const v = VIEWS[sc.objects.get(x.obj).type];
          offs.push(this.armDrag(v, x, peers, async (act, src) => { if (src) await this.studentDo(src, act); else this.onAct?.(act); finish(act); }, { prio: 2 }));
        }
      }
      // ask end（老师递过来的「下课吗？」，主线第七轮）：学习台里弹出顶上「下课」同一个确认框（课堂给 onEndAsk）；样子页里是一个按钮
      if (w.kind === 'end') {
        if (this.onEndAsk) Promise.resolve(this.onEndAsk(w)).then((yes) => finish(yes ? { type: 'end' } : { type: 'next', button: '接着上' }));
        else {
          const b = el('button', 'st-next', this.dock);
          b.type = 'button';
          b.textContent = w.button || '下课';
          b.addEventListener('click', () => finish({ type: 'end' }), { once: true });
        }
      }
      // ask pick 的按钮是交点了的几样（上面挂过了），不是「接着」
      if ((w.kind === 'next' || w.button) && w.kind !== 'pick' && w.kind !== 'end') {
        const b = el('button', 'st-next', this.dock);
        b.type = 'button';
        b.textContent = `${w.button || '接着'} →`;
        this.tween(b, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 360, easing: EASE.out });
        b.addEventListener('click', async () => {
          const act = { type: 'next', button: w.button || '接着' };
          // 按了这个按钮才判的挑战（goal … on="就这样"）：照学生的一行 press "就这样" 走（记进 log，刷新照它放回），判的结果带在回答上
          if (this.scene.hasOn?.(act.button)) await this.studentDo(`press ${quoteText(act.button)}`, act);
          else this.onAct?.(act);
          finish(act);
        }, { once: true });
      }
      // ask value 照 type 换写法（answer.js 的 answerInput）：type=matrix free=n 一格一个式子框、type=formula 一个式子框（都配符号小键盘），
      // 别的是输入框：全是数的数字键盘，要打字母、括号、= 的普通键盘
      const how = w.kind === 'value' ? answerInput(w, sc) : null;
      const formula = how?.kind === 'grid' || how?.kind === 'formula';
      if (formula) offs.push(this.armFormula(w, how, finish));
      // 打字：一直在（学生可以不点格子、不写式子，直接说「我不懂」「写在哪？」）；ask say / 一个输入框的 ask value 时把它放到最前面，那时它就是答案框。
      // 写式子的那几种（按格、一个式子框）以前不给这一行：学生对着一格格式子框，想说句话都没处说
      const asAnswer = w.kind === 'value' && !formula;
      if (this.withInput || asAnswer || w.kind === 'say') {
        const form = el('form', 'st-say', this.dock);
        const input = el('input', '', form);
        input.type = 'text';
        input.id = 'st-say-input';
        input.placeholder = asAnswer ? '写答案' : w.kind === 'say' ? '写下你的想法…' : '想说点什么也可以直接写';
        input.setAttribute('aria-label', asAnswer ? '答案' : '对老师说');
        input.enterKeyHint = 'send';
        if (asAnswer) {
          input.inputMode = how.kind === 'decimal' ? 'decimal' : 'text';
          // 答案照写的比：iPad 不许替学生改大小写、改拼写（had started 被自动改成 Had started、联想成别的词）
          input.autocomplete = 'off';
          input.setAttribute('autocapitalize', 'off');
          input.setAttribute('autocorrect', 'off');
          input.spellcheck = false;
        }
        const go = el('button', 'st-say-go', form);
        go.type = 'submit';
        go.textContent = asAnswer ? askButtonText(w) : '说';
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          let act = { type: 'say', text };
          if (asAnswer) {
            act = this.judgeValue(w, text, text);
            if (act.right === false) { form.classList.remove('is-bad'); void form.offsetWidth; form.classList.add('is-bad'); }
          }
          this.onAct?.(act);
          finish(act);
        });
        if (w.kind === 'say' || asAnswer) form.classList.add('is-main');
      }
      this.keepInView();
    });
  }

  /**
   * 判一个填的答案 → 回答的 act。given 是写的一行字或按格交的 string[][]，text 是记进回答、写给老师的那一行字。
   * 判的时候出了错（写下时验过了，可 {P^-1} 现在算不出来：学生把 P 拨成了不可逆）：页面没判成，不当学生答错、不晃红框，记进出错记录
   */
  judgeValue(w, given, text) {
    let j;
    try { j = judgeAnswer(given, { type: w.type, answer: w.answer, wrongs: w.wrongs, free: w.free, solve: w.solve, lenient: w.lenient }, this.scene); } catch (err) { j = { ok: null, misread: null, shown: String(w.answer ?? ''), failed: `页面没判成：${err?.message || err}` }; }
    // 判不对、又是一句问话（answer.js 的 asksBack）：不晃红框、不算一次作答，交给老师（主线第七轮）。先判：判对了的照常算对
    if (j.ok !== true && typeof given === 'string' && asksBack(given, w)) return { type: 'value', text, asks: true, right: null, answer: j.shown ?? String(w.answer ?? '') };
    // 页面判不了（undecided：按集合判的通解学生写的不是一次式）不是页面出错，不记进出错记录
    if (j.failed && !j.undecided) reportError(new Error(j.failed), { what: `舞台的 ask value 判答案：${w.prompt || ''}（answer=${w.answer}）` });
    return { type: 'value', text, answer: j.shown, right: j.ok, misread: j.misread, ...(j.failed ? { failed: j.failed } : {}) };
  }

  /**
   * 写式子（formulainput.js，和黑板同一个框、同一块符号小键盘）：how 是 answerInput 交的。
   *   grid（ask value … type=matrix free=n）：一格一个式子框，交的是每格写的原样（string[][]），判、记进回答、写给老师的那一行字
   *     照老师写 answer= 的样子（gridAnswerText：1 n n(n-1)/2 / 0 1 n / 0 0 1）；学生只看到对不对，哪一格不对只告诉老师（页面不替老师指错）。
   *   formula（ask value … type=formula）：一个式子框，交的是写的那一行字。
   * 符号小键盘是整页一块、贴在屏幕底下：开着时底下这一条让到它上面，镜头跟着让（reserve 量的是这一条的高）。返回收起时做的事
   */
  armFormula(w, { kind, rows, cols, names }, finish) {
    const one = kind === 'formula';
    const form = el('form', `st-say st-fgrid${one ? ' st-fone' : ''} is-main`, this.dock);
    form.noValidate = true;
    const grid = one ? formulaInput(form, { names, keys: names, placeholder: '写式子' }) : formulaGrid(form, { rows, cols, names, keys: names });
    if (one) grid.root.querySelector('.fi-text').setAttribute('aria-label', '答案（式子）');
    const foot = el('div', 'st-fgrid-foot', form);
    const msg = el('div', 'st-fgrid-msg', foot);
    msg.setAttribute('aria-live', 'polite');
    const go = el('button', 'st-say-go', foot);
    go.type = 'submit';
    go.textContent = askButtonText(w);
    let timer = null;
    const lift = () => {
      const kp = document.querySelector('.keypad.show');
      const over = kp ? Math.max(0, this.view.getBoundingClientRect().bottom - kp.getBoundingClientRect().top) : 0;
      const pad = over ? `${Math.ceil(over) + 12}px` : '';
      if (this.dock.style.paddingBottom === pad) return;
      this.dock.style.paddingBottom = pad;
      this.keepInView();
    };
    // 点进一格：小键盘马上出来，跟着让；离开：等一会儿再落回去——按「对吗」的那一下小键盘先收起，这一条要是马上落下去，
    // 手指抬起来时按钮已经不在手指下面，这一下就落空了
    form.addEventListener('focusin', () => { clearTimeout(timer); requestAnimationFrame(lift); });
    form.addEventListener('focusout', () => { clearTimeout(timer); timer = setTimeout(lift, 400); });
    form.addEventListener('input', () => { msg.textContent = ''; });
    grid.onEnter(() => form.requestSubmit());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // 还空着、读不懂的格：就在这里说（框下面的预览也写着为什么），不交、不算学生答错
      try { grid.read(); } catch (err) {
        // 读不懂的那一格，框下面的预览已经写着为什么：这里不把同一句再写一遍（主线第一轮 D4-7）
        msg.textContent = form.querySelector('.fi-preview.is-bad') ? '有一处页面读不懂（看框下面那一行）' : err.message;
        form.classList.remove('is-shake'); void form.offsetWidth; form.classList.add('is-shake');
        return;
      }
      const given = one ? grid.partial() : grid.values();
      const act = this.judgeValue(w, given, one ? given : gridAnswerText(given));
      hideFormulaPad();
      this.onAct?.(act);
      finish(act);
    });
    return () => { clearTimeout(timer); hideFormulaPad(); this.dock.style.paddingBottom = ''; };
  }

  // 点：也走 pointer.js（按偏一点、按在两个东西中间也拿得到；正在等的那一问 prio 高，比随时能拖的先）
  armTap(x, done, { prio = 2 } = {}) {
    const pid = pidOf(x);
    const node = () => this.nodes.get(pid);
    if (!node()) return () => {};
    node().classList.add('is-tap');
    const off = this.pointer.add({ kind: 'tap', prio, rect: () => this.screenRect(node()), press: (on) => node()?.classList.toggle('is-press', on), onTap: done });
    return () => { off(); node()?.classList.remove('is-tap', 'is-press'); };
  }
  /** 一个节点（不一定是一问）点了做什么：开放给学生直接动的（点格子拨数、点乘积看怎么算）用它 */
  armPress(pid, fn, { prio = 1, cls = '' } = {}) {
    const node = () => this.nodes.get(pid);
    if (cls) node()?.classList.add(cls);
    const off = this.pointer.add({ kind: 'tap', prio, rect: () => this.screenRect(node()), press: (on) => node()?.classList.toggle('is-press', on), onTap: fn });
    return () => { off(); if (cls) node()?.classList.remove(cls); node()?.classList.remove('is-press'); };
  }
}

/**
 * 老师这一轮写的字 → 要演的行（行号不变，不演的行是 null）：代码块记号那几行不演；
 * ````board memo / plan 块里的是记进记忆、写给自己的，不是镜头（课堂那边照旧读它们）
 */
// 写法容错照演了时告诉老师的话（[上一轮照演了、可写错了的行]）
const FORGIVEN = {
  say: '这一行没写 say：页面当成话照演了（下次写 say "…"）',
  'open-back': 'back= 自己是一项：页面拆成两行 open 照演了（下次分开写：open 名字 动作 一行，open 名字 back="…" 一行）',
};
export function stageLines(text) {
  let inBoard = false;
  return String(text ?? '').split('\n').map((l) => {
    const t = l.trim();
    if (/^`{3,}/.test(t)) {
      if (inBoard) { inBoard = false; return null; }
      if (/^`{3,}\s*board\b/i.test(t)) inBoard = true;
      return null;
    }
    return inBoard ? null : l;
  });
}

// 老师一轮里核出来的不对的几步最多带几条（一轮演的行有限；再多也只是同一个错一路错下去）
const AUDIT_MAX = 8;
const nextText = (x) => (x == null ? null : typeof x === 'string' ? x : x.why || null);
/** 裁判的结论挂到学生的那一下上（events.js 写给老师；存进证据、对话的是这一份，不带规则内部的动作） */
function judgedAct(act, j) {
  const v = j.verdict || {};
  act.src = j.src;
  act.verdict = { legal: v.legal !== false, right: v.right ?? null, misread: v.misread ?? null, why: v.why ?? null, next: nextText(v.next) };
  if (j.call === 'now') act.call = 'now';
  if (j.reached) act.reached = true;
  if (j.mark) act.marked = true;
  if (j.failed) act.failed = true;
  if (j.policy?.call === 'done') act.patient = true; // 老师写了做完才叫：试的这几下不算进「试了好多下」
}
/**
 * 学生这一下进 act.facts 的几句：裁判交的（fx.judged.after）、ask pick 以后第一次变的（fx.pickDiff）、整张拖去比（fx.compare：
 * 共用指令，不过裁判）、并同类项（fx.merge：X 已经不在舞台上，裁判那样东西拿不到）——后两句只能照 fx 交。什么都没有是 []
 */
export function factsOf(fx) {
  if (!fx) return [];
  const out = [...(fx.judged?.after || [])];
  if (fx.pickDiff) out.push(fx.pickDiff);
  const cmp = compareFact(fx.compare);
  if (cmp) out.push(cmp);
  if (fx.merge) out.push(mergeFact(fx.merge));
  return out;
}

/**
 * 拨数、拨格子的一下并进哪一条路（同一个数、同一格连着拨的都并成一条；events.js 写给老师、studentDo 标 ✓ ✗ 用同一套）。
 * 没让做、没演上、页面判了对错的一下不算路上的一步，单独一行
 */
export function pathKey(a) {
  if (a.error || a.blocked || a.failed) return null;
  // 页面判了对错的一下（以后拨数也过裁判时）不并进路：错法要单独写出来，不能藏在一条路里
  if ((a.verdict?.right ?? null) !== null || a.verdict?.legal === false) return null;
  if (a.type === 'dial') return `dial:${a.name}`;
  if (a.type === 'edit') return `edit:${a.ref}`;
  return null;
}
/** 路上的一下停在哪（下一下要从这里拨起才接得上） */
export const pathEnd = (a) => String(a.type === 'dial' ? a.value : a.to);
/** 这一下接不接得上停在 end 的那一条路：从几拨起对不上（中间这个数、这一格被别的动过）就另起一条；没写从几拨起的照旧接着 */
export const pathGoesOn = (end, a) => end == null || a.from == null || String(a.from) === String(end);

/** 跟着变的（scene.js 的 fx.derived）存得下的样子：不带部件本身 */
const slimDerived = (list) => list.map((d) => ({ id: d.id, changed: (d.changed || []).map((x) => ({ ref: x.ref, ...(x.expr != null ? { expr: x.expr } : {}), from: x.from, to: x.to })), ...(d.error ? { error: d.error } : {}) }));

// 一个部件画成小块写什么、写给老师写什么（扣着的不漏值）：在 scene.js（pickDiff 写给老师也用），这里照旧导出
export { chipTextOf, tapValueOf };

/** 点开看怎么算碰到的扣着的格（matrix.js 的 mul 交的 hidden）：写给老师照实说是几、扣着；学生那边演成「?」 */
export function hiddenText(list) {
  return list?.length ? `（扣着的演成了 ?：${list.map((h) => `${h.ref}（${h.value === '' ? '空' : h.value}，扣着）`).join('、')}）` : '';
}

/** 答题框右边那个按钮上的字：要判的问「对吗」；只收不判的（ask value 没写 answer=）页面并不判，写「写好了」；别的是随口说一句 */
export function askButtonText(w) {
  if (w?.kind !== 'value') return '说';
  return w.answer == null || w.answer === '' ? '写好了' : '对吗';
}

/** 学生这一下做了什么，写给老师看（和舞台现状一起发） */
export function actText(act) {
  if (!act) return '';
  // 以前等着的时候拨的数攒在回答的 act.tries 里：旧的存档照旧写出来（新的拨数是试的事件，events.js 写成一条路）
  const tries = (act.tries || []).filter((t) => t.type === 'dial').map((t) => `学生拨了 ${t.name}：${t.path.join(' → ')}（停在 ${t.path.at(-1)}）`);
  const main = (() => {
    // 过了裁判、场景却演不了：照那一行说没演上，不说「舞台已经照做了」（events.js 的 verdictText 这时不再接结论）
    if (act.error) return `学生 ${act.src || act.line || act.type}——没演上：${act.error}（舞台没动）`;
    if (act.type === 'tap') return `学生点了 ${act.ref}（${act.value}${act.slot != null && act.key !== act.slot ? `，#${act.key}` : ''}）${act.expected ? `——你预期的是 ${act.expected}，${act.right === true ? '点对了' : act.right === false ? '点的不是它' : '页面比不了（预期的那个现在不在舞台上）'}` : ''}`;
    if (act.type === 'pick') return pickText(act);
    if (act.type === 'drag' && act.a && act.b) return `学生把 ${act.a.value}（#${act.a.key}）拖到 ${act.b.value}（#${act.b.key}）那一格，两格换了位置（舞台已经照做了）`;
    if (act.type === 'drag') return act.text || '学生拖了一下';
    if (act.type === 'end') return '学生点了「下课」';
    if (act.type === 'next') return `学生点了「${act.button}」${act.onGoals?.length ? `（按了才判的：${act.onGoals.map((x) => `挑战 ${x.id}：${x.met ? '做到了' : x.status}`).join('；')}）` : ''}`;
    if (act.type === 'say') return `学生说：「${act.text}」`;
    if (act.type === 'value') {
      if (act.failed) return `学生填了「${act.text}」——${typeof act.failed === 'string' ? act.failed : '页面这一下没判成'}（不知道对不对，你看着判）`;
      if (act.asks) return `学生在答案框里打了一句问话：「${act.text}」（不算一次作答）`;
      if (act.right == null) return `学生填了「${act.text}」（这一问只收不判）`;
      return `学生填了「${act.text}」——正确答案是 ${act.answer}，${act.right ? '填对了' : `填错了${act.misread ? `（页面看出来：${act.misread}）` : ''}`}`;
    }
    if (act.type === 'edit') return `学生把 ${act.ref} 从 ${act.from === '' ? '空' : act.from} 拨到 ${act.to}`;
    if (act.type === 'explain') return `学生点了 ${act.ref}，看它怎么一行乘一列算出来${hiddenText(act.hidden)}`;
    if (act.type === 'goal') return `学生做到了挑战 ${act.id}「${act.text}」`;
    if (act.type === 'undo') return `学生撤回了自己的上一下：${act.src}（舞台已经退回去了）`;
    // 学生按的「回到……」（open … back=）：回到以后的样子写在括号里（树写层序、矩阵写整张……，scene.js 的 summaryOf）
    if (act.type === 'back') {
      const now = act.summary ? `（${act.summary}）` : '';
      return act.name != null ? `学生点了「回到${act.name}」：${act.obj} 回到了${act.name}的样子${now}` : `学生让 ${act.obj} 回到了上一下之前的样子${now}`;
    }
    // 学生点 ✕ 收掉自己拉的括号、连的线：裁判（规则的 check）交的那一句就是整句话（「学生收掉了自己拉的 s.3 V（…）」），不再写指令
    // 摘叶子、删结点同样：「学生摘了叶子 12」，删完的样子是事实（tree.rules.js 的 checkDelete、deleteFacts）
    if ((act.type === 'unmark' || act.type === 'unrefer' || act.type === 'delete') && act.verdict?.why) return `学生${act.verdict.why}`;
    // 过了裁判的一下（rotate、rowop、mark……）：学生那一行指令，后面是这一下做了什么（裁判的结论 events.js 接着写）
    if (act.src && act.verdict) return `学生 ${act.src}${act.verdict.why && act.verdict.legal !== false ? `（${act.verdict.why}）` : ''}`;
    // 通用手势做的、页面不判的一下（键盘写一格、折起一段）：照那一行写
    if (act.src) return `学生 ${act.src}`;
    return '';
  })();
  return [...tries, main].filter(Boolean).join('\n');
}

export { compareValues };
