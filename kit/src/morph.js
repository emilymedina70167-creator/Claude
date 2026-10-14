// 演示组件换步时的过渡：画面不再整帧切换。
//   同一个东西挪了位置（写了 data-key 的：排序里的数、树的结点、模式串的字符）→ 从旧位置滑过去；
//   同一个位置上的格子、结点、边（DOM 里的位置一样、屏幕上的位置也一样）→ 颜色渐变，里面的字变了就闪一下；
//   新出现的 → 淡入。
// 引擎每一步都重画整块 HTML（innerHTML），所以先拍一张「旧画面」的快照，换完以后按快照把变化补成动画（FLIP）。
// SVG 里的东西按 getScreenCTM 换算到新的坐标系（每一步的 viewBox 可能不一样大）。
// 系统开了「减少动态效果」、或者一次跳了好几步，由调用的地方决定不动画。

const COLOR_PROPS = ['backgroundColor', 'color', 'fill', 'stroke', 'borderTopColor', 'opacity'];
const MAX_ELS = 1500; // 画面太大就不做（比如很长的代码跟踪），免得卡

// 元素在 root 里的路径：标签 + 第几个孩子，一层层拼起来
function pathOf(el, root) {
  const parts = [];
  for (let x = el; x && x !== root; x = x.parentElement) {
    const p = x.parentElement;
    const i = p ? Array.prototype.indexOf.call(p.children, x) : 0;
    parts.push(`${x.tagName}${i}`);
  }
  return parts.reverse().join('/');
}

function svgPoint(svg, x, y, inverse) {
  const m = svg.getScreenCTM?.();
  if (!m) return null;
  const pt = svg.createSVGPoint ? svg.createSVGPoint() : new DOMPoint();
  pt.x = x; pt.y = y;
  return pt.matrixTransform(inverse ? m.inverse() : m);
}

function lineEnds(line) {
  const svg = line.ownerSVGElement;
  const g = (a) => Number(line.getAttribute(a)) || 0;
  const a = svgPoint(svg, g('x1'), g('y1'));
  const b = svgPoint(svg, g('x2'), g('y2'));
  return a && b ? [a.x, a.y, b.x, b.y] : null;
}

function styleOf(el) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of COLOR_PROPS) out[p] = cs[p];
  return out;
}

/** 拍快照：{ keyed: Map(data-key → 信息), slots: Map(路径 → 信息) } */
export function snapshot(root) {
  const all = root.querySelectorAll('*');
  if (!all.length || all.length > MAX_ELS) return null;
  const keyed = new Map();
  const slots = new Map();
  for (const el of all) {
    if (el.closest('.katex')) continue; // 公式内部不管
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height && el.tagName !== 'line') continue;
    const info = { rect: r, style: styleOf(el), text: el.childElementCount ? null : el.textContent };
    if (el.tagName === 'line') info.ends = lineEnds(el);
    const k = el.getAttribute('data-key');
    if (k) keyed.set(k, info);
    else slots.set(pathOf(el, root), info);
  }
  return { keyed, slots };
}

const near = (a, b) => Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 3 && Math.abs(a.height - b.height) < 3;

function fadeColors(el, from, ms) {
  const to = styleOf(el);
  const a = {}, b = {};
  let any = false;
  for (const p of COLOR_PROPS) {
    if (from[p] && to[p] && from[p] !== to[p]) { a[p] = from[p]; b[p] = to[p]; any = true; }
  }
  if (any) el.animate([a, b], { duration: ms, easing: 'ease-out' });
}

let tweenToken = 0;

/** 按快照把变化补成动画。ms：滑动的时长 */
export function animateFrom(root, snap, { ms = 320 } = {}) {
  if (!snap) return;
  const all = root.querySelectorAll('*');
  if (all.length > MAX_ELS) return;
  const token = ++tweenToken;
  const lines = [];
  for (const el of all) {
    if (el.closest('.katex')) continue;
    const k = el.getAttribute('data-key');
    const r = el.getBoundingClientRect();
    if (k) {
      const old = snap.keyed.get(k);
      if (!old) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms * 0.8, easing: 'ease-out' }); continue; }
      if (el.tagName === 'line') { if (old.ends) lines.push([el, old.ends]); fadeColors(el, old.style, ms); continue; }
      const dx = old.rect.left - r.left, dy = old.rect.top - r.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        let tx = dx, ty = dy;
        const svg = el.ownerSVGElement;
        if (svg) { const m = svg.getScreenCTM?.(); if (m && m.a && m.d) { tx = dx / m.a; ty = dy / m.d; } }
        el.animate([{ transform: `translate(${tx}px, ${ty}px)` }, { transform: 'translate(0px, 0px)' }], { duration: ms, easing: 'cubic-bezier(.3,.7,.3,1)' });
      }
      fadeColors(el, old.style, ms);
      continue;
    }
    if (!r.width && !r.height) continue;
    const old = snap.slots.get(pathOf(el, root));
    if (!old) continue;
    if (!near(old.rect, r)) continue; // 位置变了：不是同一个格子，别乱配
    fadeColors(el, old.style, ms);
    // 格子里的字变了：闪一下（引擎没标 sv-new 的也看得出来）
    if (old.text !== null && !el.childElementCount && old.text !== el.textContent && el.textContent.trim()) {
      const cell = el.closest('.sv-cell, td, .bv-bit');
      if (cell && !cell.classList.contains('sv-new')) cell.animate([{ filter: 'brightness(1.7)' }, { filter: 'brightness(1)' }], { duration: ms * 1.4, easing: 'ease-out' });
    }
  }
  // 边：两个端点从旧位置（换算到新的坐标系）移到新位置
  if (lines.length) {
    const jobs = [];
    for (const [el, ends] of lines) {
      const svg = el.ownerSVGElement;
      const a = svgPoint(svg, ends[0], ends[1], true), b = svgPoint(svg, ends[2], ends[3], true);
      if (!a || !b) continue;
      const to = ['x1', 'y1', 'x2', 'y2'].map((n) => Number(el.getAttribute(n)) || 0);
      const from = [a.x, a.y, b.x, b.y];
      if (from.every((v, i) => Math.abs(v - to[i]) < 0.5)) continue;
      jobs.push({ el, from, to });
    }
    if (!jobs.length) return;
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      if (token !== tweenToken) { jobs.forEach(({ el, to }) => ['x1', 'y1', 'x2', 'y2'].forEach((n, i) => el.setAttribute(n, to[i]))); return; }
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      for (const { el, from, to } of jobs) ['x1', 'y1', 'x2', 'y2'].forEach((n, i) => el.setAttribute(n, from[i] + (to[i] - from[i]) * e));
      if (t < 1) requestAnimationFrame(tick);
    };
    for (const { el, from } of jobs) ['x1', 'y1', 'x2', 'y2'].forEach((n, i) => el.setAttribute(n, from[i]));
    requestAnimationFrame(tick);
  }
}

/** 正在进行的动画全部跳到终点（下一步要拍快照之前） */
export function settle(root) {
  tweenToken++;
  try { root.getAnimations?.({ subtree: true }).forEach((a) => a.finish()); } catch { /* 老浏览器 */ }
}
