// 手写引擎：把 Apple Pencil 的点变成顺滑的粉笔笔迹。
// 笔画按「点」存储：[x, y, r]（r = 该点半径，已经算进了压力和倾斜），方便重画、擦除、导出。

export const INK_COLORS = {
  white: '#eef0e6',
  yellow: '#f2dc85',
  pink: '#f3a7b6',
  blue: '#a6d6ef',
};

// 是否见过 Pencil：见过之后，手指只用来滚动和点按，不再写字（防误触）
export const pen = { seen: false };

// 由一次指针事件得到半径：压力决定粗细，笔身倾斜越多笔迹越宽（像用粉笔侧面）
export function radiusOf(e, base) {
  let p = e.pointerType === 'pen' ? e.pressure : 0.5;
  if (!(p > 0)) p = 0.5;
  let r = base * (0.38 + 0.95 * Math.pow(p, 0.75));
  let alt = e.altitudeAngle;
  if (alt === undefined && (e.tiltX || e.tiltY)) {
    const t = Math.min(90, Math.hypot(e.tiltX, e.tiltY));
    alt = ((90 - t) * Math.PI) / 180;
  }
  if (e.pointerType === 'pen' && alt !== undefined && alt < 0.9) {
    // 倾斜超过约 40° 开始变宽，躺平时约 3 倍
    r *= 1 + (0.9 - alt) * 2.4;
  }
  return r;
}

// 一个正在写的笔画：做轻微的半径平滑，避免粗细突变
export function beginStroke({ color, size, x, y, r }) {
  return { color, size, pts: [x, y, r], bbox: [x - r, y - r, x + r, y + r] };
}

export function addPoint(s, x, y, r) {
  const n = s.pts.length;
  const lx = s.pts[n - 3], ly = s.pts[n - 2], lr = s.pts[n - 1];
  if (Math.hypot(x - lx, y - ly) < 0.6) return false; // 太近的点不要，减少抖动
  const rr = lr * 0.6 + r * 0.4;
  s.pts.push(round(x), round(y), round(rr));
  const b = s.bbox;
  b[0] = Math.min(b[0], x - rr); b[1] = Math.min(b[1], y - rr);
  b[2] = Math.max(b[2], x + rr); b[3] = Math.max(b[3], y + rr);
  return true;
}

const round = (v) => Math.round(v * 10) / 10;

// 画整条笔画。ox/oy 是偏移（笔画坐标 → 画布坐标）
export function drawStroke(ctx, s, ox = 0, oy = 0, color) {
  const p = s.pts;
  const n = p.length / 3;
  ctx.strokeStyle = ctx.fillStyle = color || INK_COLORS[s.color] || s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (n === 1) {
    ctx.beginPath();
    ctx.arc(p[0] + ox, p[1] + oy, p[2], 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 1; i < n; i++) drawSegment(ctx, p, i, ox, oy);
}

// 第 i 段：从前一个中点经过第 i-1 个点（控制点）到下一个中点，二次曲线让笔迹圆润
export function drawSegment(ctx, p, i, ox, oy) {
  const x0 = p[(i - 1) * 3], y0 = p[(i - 1) * 3 + 1], r0 = p[(i - 1) * 3 + 2];
  const x1 = p[i * 3], y1 = p[i * 3 + 1], r1 = p[i * 3 + 2];
  const sx = i === 1 ? x0 : (p[(i - 2) * 3] + x0) / 2;
  const sy = i === 1 ? y0 : (p[(i - 2) * 3 + 1] + y0) / 2;
  const ex = (x0 + x1) / 2, ey = (y0 + y1) / 2;
  ctx.lineWidth = (r0 + r1);
  ctx.beginPath();
  ctx.moveTo(sx + ox, sy + oy);
  ctx.quadraticCurveTo(x0 + ox, y0 + oy, ex + ox, ey + oy);
  ctx.stroke();
}

// 写的过程中只补画最新一段（低延迟）；最后一小段在 finish 时补齐
export function drawTail(ctx, s, ox, oy) {
  const p = s.pts;
  const n = p.length / 3;
  ctx.strokeStyle = INK_COLORS[s.color] || s.color;
  ctx.lineCap = 'round';
  if (n >= 2) drawSegment(ctx, p, n - 1, ox, oy);
}

export function drawEnd(ctx, s, ox, oy) {
  const p = s.pts;
  const n = p.length / 3;
  if (n < 2) return drawStroke(ctx, s, ox, oy);
  ctx.strokeStyle = INK_COLORS[s.color] || s.color;
  ctx.lineCap = 'round';
  const x0 = p[(n - 2) * 3], y0 = p[(n - 2) * 3 + 1], x1 = p[(n - 1) * 3], y1 = p[(n - 1) * 3 + 1];
  ctx.lineWidth = p[(n - 1) * 3 + 2] * 2;
  ctx.beginPath();
  ctx.moveTo((x0 + x1) / 2 + ox, (y0 + y1) / 2 + oy);
  ctx.lineTo(x1 + ox, y1 + oy);
  ctx.stroke();
}

// 橡皮：点 (x,y) 半径 R 内碰到的笔画
export function hitStroke(s, x, y, R) {
  const b = s.bbox;
  if (x < b[0] - R || x > b[2] + R || y < b[1] - R || y > b[3] + R) return false;
  const p = s.pts;
  for (let i = 0; i < p.length; i += 3) {
    if (Math.hypot(p[i] - x, p[i + 1] - y) <= R + p[i + 2]) return true;
    // 点之间也检查一下，快速划过时不漏
    if (i >= 3) {
      const mx = (p[i] + p[i - 3]) / 2, my = (p[i + 1] + p[i - 2]) / 2;
      if (Math.hypot(mx - x, my - y) <= R + p[i + 2]) return true;
    }
  }
  return false;
}

// 撤销 / 重做：操作 = {add:[笔画]} 或 {erase:[笔画]}
export class History {
  constructor(list) { this.list = list; this.undoStack = []; this.redoStack = []; }
  add(s) { this.list.push(s); this.undoStack.push({ add: [s] }); this.redoStack = []; }
  erase(ss) { if (!ss.length) return; ss.forEach((s) => remove(this.list, s)); this.recordErase(ss); }
  // 笔画已经从列表里拿掉了（边擦边消失），只补记一次撤销
  recordErase(ss) { if (!ss.length) return; this.undoStack.push({ erase: ss }); this.redoStack = []; }
  undo() {
    const op = this.undoStack.pop();
    if (!op) return false;
    if (op.add) op.add.forEach((s) => remove(this.list, s));
    if (op.erase) this.list.push(...op.erase);
    this.redoStack.push(op);
    return true;
  }
  redo() {
    const op = this.redoStack.pop();
    if (!op) return false;
    if (op.add) this.list.push(...op.add);
    if (op.erase) op.erase.forEach((s) => remove(this.list, s));
    this.undoStack.push(op);
    return true;
  }
}
const remove = (arr, s) => { const i = arr.indexOf(s); if (i >= 0) arr.splice(i, 1); };

// 把一组笔画导出成白底黑字的图片（给 Claude 识别用，对比度最高）
export async function strokesToBlob(strokes, { pad = 24, scale = 2, maxSide = 1600 } = {}) {
  if (!strokes.length) return null;
  const b = strokes.reduce((a, s) => [Math.min(a[0], s.bbox[0]), Math.min(a[1], s.bbox[1]), Math.max(a[2], s.bbox[2]), Math.max(a[3], s.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const w = b[2] - b[0] + pad * 2, h = b[3] - b[1] + pad * 2;
  const k = Math.min(scale, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * k);
  c.height = Math.ceil(h * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(k, k);
  for (const s of strokes) drawStroke(ctx, s, pad - b[0], pad - b[1], '#111111');
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// 取一个事件里所有被合并的采样点（Pencil 采样率比屏幕刷新率高，取全了笔迹更顺）
export const samples = (e) => (typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null)?.length ? e.getCoalescedEvents() : [e];
