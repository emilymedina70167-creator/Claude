// 简易 SVG 坐标平面：数学坐标 ↔ 屏幕坐标，带触控拖动
import { numText } from './expr.js';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 480;

export function createPlane(container, { range = 5 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('class', 'plane');
  const clipId = 'clip' + Math.random().toString(36).slice(2);
  container.appendChild(svg);

  // 画每条命令前设 p.cmd = 序号，这期间画出的元素都带上 data-cmd，课堂里 highlight 靠它找到要闪的东西
  const put = (parent, tag, attrs) => {
    const e = add(parent, tag, attrs);
    if (p.cmd != null) e.setAttribute('data-cmd', p.cmd);
    return e;
  };

  const p = {
    svg,
    range,
    cmd: null,
    X: (x) => SIZE / 2 + (x / p.range) * (SIZE / 2),
    Y: (y) => SIZE / 2 - (y / p.range) * (SIZE / 2),
    clear() {
      svg.innerHTML = `<defs><clipPath id="${clipId}"><rect width="${SIZE}" height="${SIZE}"/></clipPath></defs>`;
      p.placed = [];
      p.layer = el('g', { 'clip-path': `url(#${clipId})` });
      svg.appendChild(p.layer);
      p.top = el('g');
      svg.appendChild(p.top);
    },
    grid({ minor = true } = {}) {
      const R = Math.ceil(p.range);
      for (let k = -R; k <= R; k++) {
        if (k === 0) continue;
        p.line([k, -R], [k, R], 'grid');
        p.line([-R, k], [R, k], 'grid');
      }
      p.line([-R, 0], [R, 0], 'axis');
      p.line([0, -R], [0, R], 'axis');
      if (minor) {
        p.text([R - 0.35, -0.45], 'x', 'axis-label');
        p.text([0.3, R - 0.5], 'y', 'axis-label');
        p.placed.push(box(p.X(R - 0.35) + 4, p.Y(-0.45) - 5, 12), box(p.X(0.3) + 4, p.Y(R - 0.5) - 5, 12));
      }
    },
    line(a, b, cls, extra = {}) {
      return put(p.layer, 'line', { x1: p.X(a[0]), y1: p.Y(a[1]), x2: p.X(b[0]), y2: p.Y(b[1]), class: cls, ...extra });
    },
    path(pts, cls) {
      return put(p.layer, 'polyline', { points: pts.map(([x, y]) => `${p.X(x)},${p.Y(y)}`).join(' '), class: cls });
    },
    poly(pts, cls) {
      return put(p.layer, 'polygon', { points: pts.map(([x, y]) => `${p.X(x)},${p.Y(y)}`).join(' '), class: cls });
    },
    // 带箭头的向量
    arrow(from, to, color, { width = 3.5, label, dashed = false, layer } = {}) {
      const drawIn = p.drawIn && !dashed;
      const g = put(layer || p.layer, 'g', { class: drawIn ? 'vec vec-in' : 'vec', style: `--vc:${color}` });
      const x1 = p.X(from[0]), y1 = p.Y(from[1]), x2 = p.X(to[0]), y2 = p.Y(to[1]);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1) return g;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const h = Math.min(19, len * 0.6);
      const bx = x2 - ux * h, by = y2 - uy * h;
      put(g, 'line', { x1, y1, x2: bx, y2: by, 'stroke-width': width, class: dashed ? 'vec-line dashed' : 'vec-line', ...(drawIn ? { pathLength: 1 } : {}) });
      put(g, 'polygon', { points: `${x2},${y2} ${bx - uy * h * 0.48},${by + ux * h * 0.48} ${bx + uy * h * 0.48},${by - ux * h * 0.48}`, class: 'vec-head' });
      if (label) {
        const [cx, cy] = p.placeLabel(x2, y2, ux, uy, label);
        // 标签不套粉笔滤镜，保持清楚
        const t = put(layer || p.layer, 'text', { x: cx, y: cy, class: drawIn ? 'vec-label vec-label-in' : 'vec-label', style: `--vc:${color}`, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
        t.textContent = label;
      }
      return g;
    },
    // 给标签找一个不和已有标签重叠、也不出界的位置
    placeLabel(x, y, ux, uy, label) {
      const w = textWidth(label);
      const along = 16 + (w / 2) * Math.abs(ux) + 14 * Math.abs(uy);
      const cands = [
        [x + ux * along, y + uy * along],
        [x + ux * 10 - uy * (w / 2 + 12), y + uy * 10 + ux * 22],
        [x + ux * 10 + uy * (w / 2 + 12), y + uy * 10 - ux * 22],
        [x + ux * (along + 22), y + uy * (along + 22)],
        [x - uy * (w / 2 + 16), y + ux * 26],
        [x + uy * (w / 2 + 16), y - ux * 26],
      ];
      const inside = ([cx, cy]) => cx - w / 2 > 2 && cx + w / 2 < SIZE - 2 && cy > 16 && cy < SIZE - 14;
      const free = (c) => !p.placed.some((b) => overlap(b, box(c[0], c[1], w)));
      const pick = cands.find((c) => inside(c) && free(c)) || cands.find(inside) || cands[0];
      p.placed.push(box(pick[0], pick[1], w));
      return pick;
    },
    dot(pt, cls = 'dot', r = 5) {
      return put(p.layer, 'circle', { cx: p.X(pt[0]), cy: p.Y(pt[1]), r, class: cls });
    },
    text(pt, str, cls = 'plot-text') {
      const t = put(p.top, 'text', { x: p.X(pt[0]), y: p.Y(pt[1]), class: cls });
      t.textContent = str;
      return t;
    },
    // 拖动把手：大一点方便手指
    handle(pt, id, color) {
      const c = put(p.top, 'circle', { cx: p.X(pt[0]), cy: p.Y(pt[1]), r: 18, class: 'handle', 'data-handle': id, style: `--vc:${color}` });
      return c;
    },
    toMath(evt) {
      // SVG 按 viewBox 等比缩放、居中：图框不是正方形（比如窄屏吸顶的图）时，x、y 要用同一个比例换算，拖动才跟手
      const r = svg.getBoundingClientRect();
      const k = Math.min(r.width, r.height) / SIZE || 1;
      const sx = (evt.clientX - r.left - (r.width - SIZE * k) / 2) / k;
      const sy = (evt.clientY - r.top - (r.height - SIZE * k) / 2) / k;
      return [((sx - SIZE / 2) / (SIZE / 2)) * p.range, -((sy - SIZE / 2) / (SIZE / 2)) * p.range];
    },
    // onDrag(id, [x, y], phase)，phase 是 'start' | 'move' | 'end'
    draggable(onDrag) {
      dragHandles(svg, p.toMath, onDrag);
    },
  };
  p.clear();
  return p;
}

// 手指离按下的地方超过这么多像素才算「拖了」：点一下时手指的轻微抖动不算挪动
export const DRAG_SLOP = 4;

// 拖把手（带 data-handle 的元素）：scene 的点和 graph 的竖线共用。
// 只认按下把手的那根手指 / 笔：iPad 上手掌、第二根手指的事件不会把点抢走；
// pointercancel（系统接管手势）时坐标不可靠，用最后一次移动到的位置收尾。
// onDrag(id, 点, phase, moved)：moved 表示这次按下以后是否真的拖出了 DRAG_SLOP（点一下是 false）
export function dragHandles(svg, toPoint, onDrag) {
  let active = null, pid = null, last = null, x0 = 0, y0 = 0, moved = false;
  const finish = (e) => {
    if (active == null || (e && e.pointerId !== pid)) return;
    const id = active;
    const pt = e?.type === 'pointerup' ? toPoint(e) : last;
    active = null;
    pid = null;
    svg.classList.remove('dragging');
    onDrag(id, pt, 'end', moved);
  };
  svg.addEventListener('pointerdown', (e) => {
    const id = e.target.getAttribute?.('data-handle');
    if (!id) return;
    // 上一次拖动没收到抬起（比如换了一支笔）：先按松手收尾，再开始新的
    if (active != null) finish();
    active = id;
    pid = e.pointerId;
    x0 = e.clientX;
    y0 = e.clientY;
    moved = false;
    try { svg.setPointerCapture(e.pointerId); } catch { /* 合成事件没有真的指针 */ }
    svg.classList.add('dragging');
    e.preventDefault();
    last = toPoint(e);
    onDrag(id, last, 'start', false);
  });
  svg.addEventListener('pointermove', (e) => {
    if (active == null || e.pointerId !== pid) return;
    e.preventDefault();
    last = toPoint(e);
    moved ||= Math.hypot(e.clientX - x0, e.clientY - y0) > DRAG_SLOP;
    onDrag(active, last, 'move', moved);
  });
  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', finish);
  svg.addEventListener('lostpointercapture', finish);
}

function el(tag, attrs = {}) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function add(parent, tag, attrs) {
  const e = el(tag, attrs);
  parent.appendChild(e);
  return e;
}

// 粗略估算标签宽度（中文字更宽）
const textWidth = (s) => [...String(s)].reduce((w, ch) => w + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 30 : /[₀-₉]/.test(ch) ? 11 : 16), 0);
const box = (cx, cy, w) => ({ l: cx - w / 2 - 2, r: cx + w / 2 + 2, t: cy - 15, b: cy + 15 });
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export const snap = (v, step) => {
  const r = Math.round(v);
  if (Math.abs(v - r) < 0.18) return r;
  return Math.round(v / step) * step;
};

export const COLORS = ['var(--v1)', 'var(--v2)', 'var(--v3)', 'var(--v4)', 'var(--v5)'];

// —— 课堂指令共用（scene / graph / space）：play、set、highlight、vars、事件 ——

// 闪烁时长：highlight 让某条命令画出的东西亮这么久
export const FLASH_MS = 1600;
// play 最长 30 秒：写错单位（比如 play t 0 1 1500s）也不会让图卡住半天
const MAX_PLAY_MS = 30000;
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const now = () => (globalThis.performance?.now ? performance.now() : Date.now());
const reducedMotion = () => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// 值的形状：'n' 是数，'[n,n]' 是二维向量，'[[n,n],[n,n]]' 是 2×2 矩阵；不是有限的数 / 数组时为 null
export function shapeOf(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? 'n' : null;
  if (!Array.isArray(x) || !x.length) return null;
  const parts = x.map(shapeOf);
  return parts.includes(null) ? null : `[${parts.join(',')}]`;
}

// 两个形状相同的值之间插值（k = 0 是 a，k = 1 是 b）
export function lerpValue(a, b, k) {
  if (Array.isArray(a)) return a.map((x, i) => lerpValue(x, b[i], k));
  return k >= 1 ? b : a + (b - a) * k;
}

// 滑块旁边的读数（两位小数）。停着的时候和读数行一样写成分数（1/2、3/10）；
// 正在动（播放、学生拖着）时写小数，免得一帧一个分数（3/50、11/50……）闪个不停
export function sliderText(x, moving = false) {
  const r = Math.round(x * 100) / 100;
  if (!moving) return numText(r);
  return String(r === 0 ? 0 : r);
}

// 记录 / 发给 Claude 时保留两位小数
export function round2(x) {
  if (Array.isArray(x)) return x.map(round2);
  return typeof x === 'number' ? Math.round(x * 100) / 100 : x;
}

export function sameValue(a, b, tol = 1e-9) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol;
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i], tol));
}

// 给报错用的中文说法：「x 是一个 2 维向量」
export function describeValue(x) {
  const s = shapeOf(x);
  if (s === 'n') return '一个数';
  if (s && x.every((r) => typeof r === 'number')) return `一个 ${x.length} 维向量`;
  if (s && x.every((r) => Array.isArray(r) && r.length === x[0].length && r.every((y) => typeof y === 'number'))) return `一个 ${x.length}×${x[0].length} 矩阵`;
  return '一个不是数的值';
}

// 光晕用的模糊滤镜，第一次闪烁时放进页面（和粉笔滤镜一样放在一个不占地方的 svg 里，各张图都能引用）。
// 滤镜区域按用户坐标给：水平 / 竖直的线包围盒高度是 0，按包围盒算区域的话光晕会整个消失。
// 区域只盖住画布（scene / space 480×480，graph 640×400）再留一圈：区域越大，每次模糊要处理的像素越多
const GLOW = '<svg class="la-glow-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>'
  + '<filter id="la-glow" filterUnits="userSpaceOnUse" x="-40" y="-40" width="720" height="560"><feGaussianBlur stdDeviation="4.5"/></filter>'
  + '</defs></svg>';
function ensureGlow() {
  if (typeof document === 'undefined' || document.getElementById('la-glow') || !document.body) return;
  document.body.insertAdjacentHTML('beforeend', GLOW);
}

// 只变亮、不垫光晕的细线
const THIN = ['grid', 'tgrid', 'sp-plane-grid'];

// 「1 let A = …；2 vector x …」：highlight 序号写错时告诉课堂 Claude 每条命令是第几条
export function commandList(cmds, max = 36) {
  return cmds.map((c, k) => {
    const t = String(c.srcLine || c.kind).replace(/\s+/g, ' ').trim();
    return `${k + 1} ${t.length > max ? t.slice(0, max - 1) + '…' : t}`;
  }).join('；');
}

const clone = (x) => (Array.isArray(x) ? x.map(clone) : x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// "2"、" -1.5 " 这样的字符串也当数
const asNum = (x) => (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : x);

/**
 * 一张图的课堂操作。图自己画、自己管状态，这里管：变量放在哪、怎么写进去、补间动画、命令闪烁、事件。
 *   root      图的容器（找 data-cmd 元素、判断图还在不在页面上）
 *   cmds      解析出的命令（第 i 条命令的序号是 i + 1）
 *   state     { slider, drag, override }：滑块值、拖动点的位置、被 set 覆盖的 let
 *   extra     外部变量（link 来的 step / t，predict 的 t / guess）
 *   env()     求出当前全部变量；draw() 重画
 *   dragValue 可拖的 let 怎么校验新值（scene：二维向量；graph：一个数）；不给就当普通 let（space 没有拖动）
 *   locked    { 变量名: 原因 }：课堂 Claude 不能 set / play 的变量（predict 里学生自己放的 guess）
 * 图的 draw() 里：画第 i 条命令时给元素加 data-cmd，画完调用 ctl.mark()；检查 goal 前看 ctl.quiet
 */
export function figureControls({ root, cmds, state, extra, env, draw, dragValue, locked = {} }) {
  const listeners = {};
  const anims = new Map(); // 变量名 → { slot, from, to, ms, t0, quiet, resolve }
  let pending = null; // 下一帧：{ raf, timer }
  let quietNow = false;
  let flash = null; // { i, t0 }
  let flashTimer = 0;

  // 课堂 Claude 要改的变量：找不到、或者是学生自己的（locked）都报错
  function target(name) {
    if (has(locked, name)) throw new Error(locked[name]);
    const slot = locate(name);
    if (!slot) throw new Error(`图里没有变量 ${name}`);
    return slot;
  }
  // 变量放在哪：滑块 / 可拖的点 / 普通 let / 外部变量。create：内部动画（▶、link）允许新建外部变量，和以前一样
  function locate(name, { create = false } = {}) {
    const c = cmds.find((k) => (k.kind === 'slider' || k.kind === 'let') && k.name === name);
    if (c?.kind === 'slider') return { kind: 'slider', c };
    if (c) return { kind: c.mods.drag && dragValue ? 'drag' : 'let', c };
    if (has(extra, name) || create) return { kind: 'extra' };
    return null;
  }
  const mapOf = (slot) => (slot.kind === 'slider' ? state.slider : slot.kind === 'drag' ? state.drag : slot.kind === 'let' ? state.override : extra);
  // 写进去；是滑块就同步滑块的位置和读数（moving：动画还没走完，读数写小数）
  function write(slot, name, val, moving = false) {
    mapOf(slot)[name] = val;
    if (slot.kind === 'slider') slot.c.sync?.(moving);
  }
  function current(name) {
    try { return env()[name]; } catch { return undefined; }
  }
  function redraw(quiet) {
    quietNow = quiet;
    try { draw(); } finally { quietNow = false; }
  }

  // —— 补间：同一个变量再动时打断上一次（停在当前值），所有变量一帧只重画一次 ——
  function stop(name) {
    const a = anims.get(name);
    if (!a) return;
    anims.delete(name);
    if (a.slot.kind === 'slider') a.slot.c.sync?.(false);
    a.resolve();
  }
  function tween(name, slot, from, to, ms, quiet) {
    stop(name);
    if (!(ms > 0)) {
      write(slot, name, to);
      redraw(quiet);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      anims.set(name, { slot, from, to, ms, t0: now(), quiet, resolve });
      write(slot, name, from, true);
      redraw(quiet);
      schedule();
    });
  }
  function schedule() {
    if (pending || !anims.size) return;
    const raf = globalThis.requestAnimationFrame;
    const run = () => {
      if (!pending) return;
      if (pending.raf) globalThis.cancelAnimationFrame?.(pending.raf);
      clearTimeout(pending.timer);
      pending = null;
      step();
    };
    // 页面在后台时 requestAnimationFrame 停了：靠定时器接着走，保证动画会走完、变量停在终点
    pending = { raf: raf ? raf(run) : 0, timer: setTimeout(run, raf ? 120 : 16) };
  }
  function step() {
    const t = now();
    const done = [];
    let quiet = false;
    for (const [name, a] of anims) {
      const k = Math.min(1, (t - a.t0) / a.ms);
      write(a.slot, name, k >= 1 ? a.to : lerpValue(a.from, a.to, ease(k)), k < 1);
      quiet ||= a.quiet;
      if (k >= 1) { anims.delete(name); done.push(a); }
    }
    // 图已经从页面上拿掉（段落被替换）：不再画，直接收尾
    if (root.isConnected !== false) redraw(quiet);
    else for (const [name, a] of anims) { write(a.slot, name, a.to); anims.delete(name); done.push(a); }
    done.forEach((a) => a.resolve());
    schedule();
  }

  // 动画还没走完时，vars / snapshot 报变量要停在的值（课堂 Claude 按终值往下算）
  function withTargets(fn) {
    if (!anims.size) return fn();
    const saved = [];
    for (const [name, a] of anims) {
      const m = mapOf(a.slot);
      saved.push([m, name, has(m, name), m[name]]);
      m[name] = a.to;
    }
    try { return fn(); } finally {
      for (const [m, name, had, val] of saved.reverse()) { if (had) m[name] = val; else delete m[name]; }
    }
  }

  // —— 闪烁：画面元素后面垫一层模糊的粉笔黄光晕；HTML 行（滑块、读数）加背景高亮 ——
  function unmark() {
    root.querySelectorAll?.('.cmd-halo').forEach((h) => h.remove());
    root.querySelectorAll?.('.cmd-flash').forEach((e) => { e.classList.remove('cmd-flash'); e.style?.removeProperty('--flash-delay'); });
  }
  function mark() {
    if (!flash) return false;
    const elapsed = now() - flash.t0;
    if (elapsed >= FLASH_MS) { flash = null; return false; }
    const sel = `[data-cmd="${flash.i}"]`;
    const els = [...(root.querySelectorAll?.(sel) || [])].filter((e) => !e.parentElement?.closest?.(sel));
    // 重画会新建元素：用负的 animation-delay 接上已经闪到的地方，节奏不会被打断
    const delay = `${-Math.round(elapsed)}ms`;
    // 光晕是克隆出来的轮廓，放进 g.cmd-halo：同一个父元素里的放一组、垫在第一个元素下面，整组只模糊一次。
    // （逐个元素套滤镜的话，网格上百条线每帧各模糊一遍，动画会卡成幻灯片）
    // 网格线成片出现（压扁时挤在一起），垫光晕会糊成一整块黄：这类细线不垫光晕，只让线自己变亮（见 styles.css）
    const groups = new Map();
    for (const e of els) {
      if (e.classList.contains('cmd-flash')) continue;
      e.classList.add('cmd-flash');
      e.style.setProperty('--flash-delay', delay);
      if (e.namespaceURI !== NS || !e.parentNode || THIN.some((k) => e.classList.contains(k))) continue;
      let g = groups.get(e.parentNode);
      if (!g) {
        ensureGlow();
        g = e.ownerDocument.createElementNS(NS, 'g');
        g.setAttribute('class', 'cmd-halo');
        g.setAttribute('aria-hidden', 'true');
        g.style.setProperty('--flash-delay', delay);
        e.before(g);
        groups.set(e.parentNode, g);
      }
      const h = e.cloneNode(true);
      for (const x of [h, ...h.querySelectorAll('*')]) {
        x.removeAttribute('data-cmd');
        x.removeAttribute('data-handle');
        x.removeAttribute('id');
        x.classList.remove('vec-in', 'vec-label-in', 'cmd-flash');
      }
      g.appendChild(h);
    }
    return els.length > 0;
  }

  const ctl = {
    get quiet() { return quietNow; },
    mark,
    stop,
    withTargets,
    on(ev, f) {
      (listeners[ev] ||= []).push(f);
      return () => { const l = listeners[ev]; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
    },
    emit(ev, ...args) {
      for (const f of [...(listeners[ev] || [])]) {
        try { f(...args); } catch (e) { console.error(e); }
      }
    },

    // 图自己的动画（滑块的 ▶、link 揭开一步时的 t）：和以前一样，不认识的名字当外部变量
    animate(name, from, to, ms) {
      return tween(name, locate(name, { create: true }), from, to, Math.max(0, Number(ms) || 0), false);
    },

    // 课堂：变量从 from 动到 to（数，或形状相同的向量 / 矩阵）。动画走完 resolve；被打断也 resolve
    play(name, from = 0, to = 1, ms = 1200) {
      name = String(name ?? '').trim();
      if (!name) throw new Error('play 要写变量名，比如 play t');
      const slot = target(name);
      from = asNum(from ?? 0);
      to = asNum(to ?? 1);
      const shape = shapeOf(from);
      if (!shape || shape !== shapeOf(to)) throw new Error('play 的起点和终点要是数（或形状相同的向量），比如 play t 0 1');
      const cur = current(name);
      if (shapeOf(cur) && shapeOf(cur) !== shape) {
        const what = describeValue(cur);
        // 协议里的 play 只带数：向量、矩阵要换值时用 set，它会滑过去
        throw new Error(shape === 'n'
          ? `${name} 是${what}，play 只能播放数值变量（比如 slider t 0 1 = 0 的 t）；要让 ${name} 换个值，用 set ${name}=…，它会滑过去`
          : `${name} 是${what}，play 的起点和终点也要是${what}`);
      }
      if (slot.kind === 'drag') { dragValue(name, from); dragValue(name, to); }
      let d = Number(asNum(ms));
      if (!Number.isFinite(d) || d < 0) d = 1200;
      return tween(name, slot, clone(from), clone(to), Math.min(d, MAX_PLAY_MS), true);
    },

    // 改一个变量（value 已经求好）。形状没变时用不到半秒滑过去，学生看得出改了什么；opts.ms = 0 直接跳
    set(name, value, { ms = 450 } = {}) {
      name = String(name ?? '').trim();
      if (!name) throw new Error('set 要写变量名，比如 set x=[1, 2]');
      const slot = target(name);
      let val = asNum(value);
      if (slot.kind === 'slider') {
        if (typeof val !== 'number' || !Number.isFinite(val)) throw new Error(`滑块 ${name} 要设成一个数`);
      } else if (slot.kind === 'drag') val = dragValue(name, val);
      else if (!shapeOf(val)) throw new Error(`${name} 要设成数、向量或矩阵`);
      val = clone(val);
      const cur = current(name);
      if (ms > 0 && !reducedMotion() && shapeOf(cur) && shapeOf(cur) === shapeOf(val) && !sameValue(cur, val)) {
        return tween(name, slot, clone(cur), val, ms, true);
      }
      stop(name);
      write(slot, name, val);
      redraw(true);
      return Promise.resolve();
    },

    // 当前全部变量：外部变量 + let + 滑块（完整精度；动画中报终值）
    vars() {
      return withTargets(() => {
        const out = {};
        for (const k of Object.keys(extra)) if (shapeOf(extra[k])) out[k] = clone(extra[k]);
        let v = null;
        try { v = env(); } catch { v = null; }
        for (const c of cmds) {
          if (c.kind !== 'let' && c.kind !== 'slider') continue;
          let val = v?.[c.name];
          // 有的 let 求不出来时，至少把滑块、拖动点、set 过的值报上
          if (!v) val = c.kind === 'slider' ? state.slider[c.name] : has(state.override, c.name) ? state.override[c.name] : state.drag?.[c.name];
          if (shapeOf(val)) out[c.name] = clone(val);
        }
        return out;
      });
    },

    // 第 index 条命令（从 1 数，只数命令行）画出的东西闪约 1.6 秒。返回有没有东西可闪（let 这类不画东西的命令返回 false）
    highlight(index) {
      const i = Number(asNum(index));
      if (!Number.isInteger(i) || i < 1) throw new Error('highlight 后面要写命令序号（从 1 数），比如 highlight 3');
      if (i > cmds.length) throw new Error(cmds.length ? `图里只有 ${cmds.length} 条命令，没有第 ${i} 条。只数命令行、从 1 数：${commandList(cmds)}` : '这张图里没有命令');
      clearTimeout(flashTimer);
      unmark();
      // 滑块行这类不重画的元素：先让浏览器看到 class 被去掉，再加回来时动画才会从头播
      void root.offsetWidth;
      flash = { i, t0: now() };
      const hit = mark();
      flashTimer = setTimeout(() => { flash = null; unmark(); }, FLASH_MS);
      return hit;
    },
  };
  return ctl;
}
