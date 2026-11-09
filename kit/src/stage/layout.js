// 舞台的排版和镜头（docs/stage-plan.md）：格子摆在哪、镜头对准哪、字贴在哪不挡东西。纯函数，有测试（tests/stage.test.js）。
// 坐标都是「世界坐标」（设计用的像素），镜头把世界缩放平移到屏幕上：屏幕 = 世界 × s + (tx, ty)

/** 一格多大、格子之间、分开排时一排一排隔多远、两排格子之间隔多远（场景和画面共用，画面的 CSS 也是这个尺寸） */
export const CELL = 64, GAP = 12, ROW_GAP = 22, SPLIT_GAP = 40, IDX_H = 22, PTR_H = 26, ARRAY_GAP = 70;

/** 一排格子的位置（左上角）：n 格，从 x0 开始，中间留 gap */
export function rowSlots(n, { cell = 64, gap = 12, x0 = 0, y0 = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cell + gap), y: y0, w: cell, h: cell }));
}

/** 几个框合起来的外框；空的给 null */
export function bbox(boxes = []) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  const x = Math.min(...list.map((b) => b.x)), y = Math.min(...list.map((b) => b.y));
  const r = Math.max(...list.map((b) => b.x + b.w)), btm = Math.max(...list.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
}

export const grow = (b, d) => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const center = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/**
 * 镜头对准一块：box 放进屏幕上能用的那一块（去掉顶上字幕、底下按钮占的地方），留 pad，放大不超过 maxScale。
 * view：{ w, h }（屏幕大小）；top / bottom：屏幕上方、下方留给别的东西的高度。返回 { s, tx, ty }
 */
export function fitCamera(box, view, { pad = 36, maxScale = 1.6, minScale = 0.35, top = 0, bottom = 0, lift = 0.3 } = {}) {
  const aw = Math.max(1, view.w - 2 * pad), ah = Math.max(1, view.h - top - bottom - 2 * pad);
  const s = Math.max(minScale, Math.min(maxScale, aw / Math.max(1, box.w), ah / Math.max(1, box.h)));
  const c = center(box);
  // 竖着放不满时不放正中间：往上提（空出来的地方上面留 lift、下面留其余），话贴在图上方，眼睛不用来回跑
  const slack = Math.max(0, ah - box.h * s);
  const y0 = top + pad + slack * lift;
  return { s, tx: view.w / 2 - c.x * s, ty: y0 - box.y * s };
}

/**
 * 镜头能用的那块屏幕：四边留白（stage.js 的 fitCamera 用的 pad）、顶上的话、底下一条按上课时常见的大小去掉
 * （话一两行时顶上约 102，底下有按钮、输入框时约 76）。摆新东西时拿它比（scene.js 的 placeFresh）：拿整块屏幕比，
 * 话和按钮占的地方没算进去，东西缩到一半了还觉得放得下
 */
export const CAMERA_ROOM = { pad: 28, top: 102, bottom: 76 };
export const cameraRoom = (view) => (view?.w > 0 && view?.h > 0 ? { w: Math.max(1, view.w - 2 * CAMERA_ROOM.pad), h: Math.max(1, view.h - CAMERA_ROOM.top - CAMERA_ROOM.bottom - 2 * CAMERA_ROOM.pad) } : null);

/**
 * 新的一样东西摆哪：照旧往下摆（已有东西的下面、居中）；横屏东西一多，往下摆以后整块放进屏幕要缩得比 minScale 还小，
 * 而摆到最右一列的右边（和最上面那样东西顶齐）缩得少一点，就另起一列。已经另起过一列（last：这一列里的几样的框），
 * 「往下摆」就是摆在这一列下面（左边和这一列对齐，不伸到左边那一列底下：伸过去 reflow 会把它推到那一列下面）；
 * 缩得不比照旧往下摆更小就先摆它，一列摆满再另起。
 * boxes：已有东西的框；size：{ w, h }；view：{ w, h }（屏幕大小，不知道就照旧往下摆）；gap：两样东西隔多远（scene.js 的
 * OBJECT_GAP：layout.js 不 import scene.js，由调用的一方传进来）。
 * 返回新东西的框的左上角 { x, y }、column（不是照旧往下摆）、start（另起了一列）
 */
export function columnSlot(boxes, size, view, { gap, minScale = 0.6, last = null } = {}) {
  const all = bbox(boxes);
  if (!all) return { x: 0, y: 0, column: false, start: false };
  const down = { x: Math.round(all.x + all.w / 2 - size.w / 2), y: all.y + all.h + gap, column: false, start: false };
  if (!(view?.w > 0 && view?.h > 0)) return down;
  // 摆下去以后整块放进屏幕能放多大
  const scale = (p) => { const b = bbox([all, { x: p.x, y: p.y, w: size.w, h: size.h }]); return Math.min(view.w / b.w, view.h / b.h); };
  const col = bbox(last || []);
  const below = col ? { x: Math.max(col.x, Math.round(col.x + col.w / 2 - size.w / 2)), y: col.y + col.h + gap, column: true, start: false } : null;
  // 同样大挑前面的：先摆满这一列，再照旧往下
  let best = below && scale(below) >= scale(down) ? below : down;
  if (scale(best) < minScale) {
    const right = { x: all.x + all.w + gap, y: all.y, column: true, start: true };
    if (scale(right) > scale(best)) best = right;
  }
  return best;
}

/** 世界里的一个框在屏幕上的样子 */
export const toScreen = (b, cam) => ({ x: b.x * cam.s + cam.tx, y: b.y * cam.s + cam.ty, w: b.w * cam.s, h: b.h * cam.s });

/**
 * 字贴在一个东西旁边放哪：按 prefer 的顺序试上、下、右、左，挑第一个不压着别的东西的；都压着就挑压得最少的。
 * anchor：要贴着的框；size：{ w, h }；obstacles：别的东西的框。返回 { x, y, side }（左上角）
 */
export function placeLabel(anchor, size, obstacles = [], { prefer = ['above', 'below', 'right', 'left'], gap = 10, step = 14, tries = 7 } = {}) {
  const c = center(anchor);
  // 每一边先贴着放，压着东西就再往外让一点（最多让 tries 次）：弧线、序号在旁边时，字落在它们外面，而不是换到另一边去
  const at = (side, k) => {
    const d = gap + k * step;
    if (side === 'above') return { x: c.x - size.w / 2, y: anchor.y - d - size.h };
    if (side === 'below') return { x: c.x - size.w / 2, y: anchor.y + anchor.h + d };
    if (side === 'right') return { x: anchor.x + anchor.w + d, y: c.y - size.h / 2 };
    if (side === 'left') return { x: anchor.x - d - size.w, y: c.y - size.h / 2 };
    return null;
  };
  let best = null;
  for (const side of prefer) {
    for (let k = 0; k < tries; k++) {
      const p = at(side, k);
      if (!p) break;
      const box = { ...p, ...size };
      const hit = obstacles.reduce((n, o) => n + (overlaps(grow(box, 3), o) ? overlapArea(grow(box, 3), o) + 1 : 0), 0);
      if (!hit) return { ...p, side };
      // 让得越远越不好：同样压着，挑近的
      const cost = hit + k * 40;
      if (!best || cost < best.cost) best = { ...p, side, cost };
    }
  }
  const { cost, ...rest } = best || { ...at('above', 0), side: 'above' };
  return rest;
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 按「隔 d 个」分组：n 个位置（从 1 数），返回每组的位置号。d 不在 1..n 里按 1..n 收 */
export function strideGroups(n, d) {
  const k = Math.max(1, Math.min(n, Math.round(d) || 1));
  return Array.from({ length: k }, (_, g) => {
    const out = [];
    for (let i = g + 1; i <= n; i += k) out.push(i);
    return out;
  });
}

/**
 * 两格之间的连线：原位的两格拱一道弧（同时好几组时一组一组的弧高错开），分开排时是两格中心之间一条横线。
 * A、B 是两格的框。返回 { d（SVG 路径）, box（占的地方：贴字、镜头要让开）, rail }
 */
export function linkGeom(A, B, { tier = 0, rail = false } = {}) {
  const r = (v) => Math.round(v * 10) / 10;
  if (rail) {
    const a = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, b = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    return { d: `M${r(a.x)} ${r(a.y)} L${r(b.x)} ${r(b.y)}`, box: bbox([{ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) - 3, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) + 6 }]), rail: true };
  }
  const a = { x: A.x + A.w / 2, y: A.y - 6 }, b = { x: B.x + B.w / 2, y: B.y - 6 };
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const h = Math.max(18 + 5 * tier, Math.min(100, dist * (0.16 + 0.03 * tier)));
  // 二次贝塞尔：弧顶比两头高 h，控制点在两倍高处
  const cx = (a.x + b.x) / 2, cy = Math.min(a.y, b.y) - 2 * h;
  return { d: `M${r(a.x)} ${r(a.y)} Q${r(cx)} ${r(cy)} ${r(b.x)} ${r(b.y)}`, box: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) - h - 2, w: Math.abs(b.x - a.x), h: h + Math.abs(b.y - a.y) + 2 }, rail: false };
}

/**
 * 连到整样东西的连线（link AB BA、link f.l1 AA）：A、B 是两头的框（整样东西的 objectBox，或者部件的框）。
 * 一个在另一个上面（上下隔开）：上面那一样的下沿中点连到下面那一样的上沿中点，竖着出去、竖着进来，走两样东西中间的空当
 * （照两格之间那样从上沿拱弧，下面那一样的弧会竖着穿过上面那一样）；横着排成一排的照旧从上沿拱一道弧（linkGeom）
 */
export function wholeLinkGeom(A, B, { tier = 0 } = {}) {
  const [top, bot] = A.y + A.h <= B.y ? [A, B] : B.y + B.h <= A.y ? [B, A] : [null, null];
  if (!top) return linkGeom(A, B, { tier });
  const r = (v) => Math.round(v * 10) / 10;
  const a = { x: top.x + top.w / 2, y: top.y + top.h + 4 }, b = { x: bot.x + bot.w / 2, y: bot.y - 4 };
  const k = Math.max(0, (b.y - a.y) / 2);
  return { d: `M${r(a.x)} ${r(a.y)} C${r(a.x)} ${r(a.y + k)} ${r(b.x)} ${r(b.y - k)} ${r(b.x)} ${r(b.y)}`, box: { x: Math.min(a.x, b.x), y: a.y, w: Math.abs(b.x - a.x), h: Math.max(0, b.y - a.y) }, rail: false };
}

/**
 * 手指按下去是要动哪一个（舞台的点、拖都走它，stage/pointer.js）：
 * 落在某个东西里面就是它（落在好几个里面挑最小的那个，最具体）；落在空的地方，挑离得最近、在 radius 以内的那个——
 * 手指比格子的边粗，按偏一点、按在两个东西之间也要拿得到，不能「掉」。
 * pt：{ x, y }；cands：[{ id, rect: { x, y, w, h }, prio? }]（prio 大的先：正在等的那一问比随时能拖的先）；都在屏幕坐标。返回那一个或 null
 */
export function pickTarget(pt, cands, { radius = 30 } = {}) {
  let best = null;
  const inside = (r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
  const dist = (r) => Math.hypot(Math.max(r.x - pt.x, 0, pt.x - (r.x + r.w)), Math.max(r.y - pt.y, 0, pt.y - (r.y + r.h)));
  for (const c of cands) {
    const r = c.rect;
    if (!r || !(r.w > 0) || !(r.h > 0)) continue;
    const d = inside(r) ? 0 : dist(r);
    if (d > radius) continue;
    const key = [-(c.prio || 0), d, d === 0 ? r.w * r.h : 0];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) best = { c, key };
  }
  return best ? best.c : null;
}
