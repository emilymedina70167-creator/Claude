// 简易 SVG 坐标平面：数学坐标 ↔ 屏幕坐标，带触控拖动
const NS = 'http://www.w3.org/2000/svg';
const SIZE = 480;

export function createPlane(container, { range = 5 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('class', 'plane');
  const clipId = 'clip' + Math.random().toString(36).slice(2);
  container.appendChild(svg);

  const p = {
    svg,
    range,
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
      return add(p.layer, 'line', { x1: p.X(a[0]), y1: p.Y(a[1]), x2: p.X(b[0]), y2: p.Y(b[1]), class: cls, ...extra });
    },
    poly(pts, cls) {
      return add(p.layer, 'polygon', { points: pts.map(([x, y]) => `${p.X(x)},${p.Y(y)}`).join(' '), class: cls });
    },
    // 带箭头的向量
    arrow(from, to, color, { width = 3.5, label, dashed = false, layer } = {}) {
      const drawIn = p.drawIn && !dashed;
      const g = add(layer || p.layer, 'g', { class: drawIn ? 'vec vec-in' : 'vec', style: `--vc:${color}` });
      const x1 = p.X(from[0]), y1 = p.Y(from[1]), x2 = p.X(to[0]), y2 = p.Y(to[1]);
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 1) return g;
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const h = Math.min(19, len * 0.6);
      const bx = x2 - ux * h, by = y2 - uy * h;
      add(g, 'line', { x1, y1, x2: bx, y2: by, 'stroke-width': width, class: dashed ? 'vec-line dashed' : 'vec-line', ...(drawIn ? { pathLength: 1 } : {}) });
      add(g, 'polygon', { points: `${x2},${y2} ${bx - uy * h * 0.48},${by + ux * h * 0.48} ${bx + uy * h * 0.48},${by - ux * h * 0.48}`, class: 'vec-head' });
      if (label) {
        const [cx, cy] = p.placeLabel(x2, y2, ux, uy, label);
        // 标签不套粉笔滤镜，保持清楚
        const t = add(layer || p.layer, 'text', { x: cx, y: cy, class: drawIn ? 'vec-label vec-label-in' : 'vec-label', style: `--vc:${color}`, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
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
      return add(p.layer, 'circle', { cx: p.X(pt[0]), cy: p.Y(pt[1]), r, class: cls });
    },
    text(pt, str, cls = 'plot-text') {
      const t = add(p.top, 'text', { x: p.X(pt[0]), y: p.Y(pt[1]), class: cls });
      t.textContent = str;
      return t;
    },
    // 拖动把手：大一点方便手指
    handle(pt, id, color) {
      const c = add(p.top, 'circle', { cx: p.X(pt[0]), cy: p.Y(pt[1]), r: 18, class: 'handle', 'data-handle': id, style: `--vc:${color}` });
      return c;
    },
    toMath(evt) {
      const r = svg.getBoundingClientRect();
      const sx = ((evt.clientX - r.left) / r.width) * SIZE;
      const sy = ((evt.clientY - r.top) / r.height) * SIZE;
      return [((sx - SIZE / 2) / (SIZE / 2)) * p.range, -((sy - SIZE / 2) / (SIZE / 2)) * p.range];
    },
    // onDrag(id, [x, y], phase)
    draggable(onDrag) {
      let active = null;
      svg.addEventListener('pointerdown', (e) => {
        const id = e.target.getAttribute && e.target.getAttribute('data-handle');
        if (!id) return;
        active = id;
        svg.setPointerCapture(e.pointerId);
        svg.classList.add('dragging');
        e.preventDefault();
        onDrag(active, p.toMath(e), 'start');
      });
      svg.addEventListener('pointermove', (e) => {
        if (!active) return;
        e.preventDefault();
        onDrag(active, p.toMath(e), 'move');
      });
      const end = (e) => {
        if (!active) return;
        onDrag(active, p.toMath(e), 'end');
        active = null;
        svg.classList.remove('dragging');
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
    },
  };
  p.clear();
  return p;
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
