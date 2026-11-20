// 文氏图的几何（概率第 4 批）。纯函数，不碰 DOM。坐标是 SVG 的（y 朝下）。
// 做法不分两个圆、三个圆：每个圆在它和别的圆的交点上切成几段弧，一段弧的两边各是一块（圆里那边、圆外那边），
// 一块的轮廓就是挨着它的那些弧首尾接起来的一圈。圆外面那一块是矩形套着一圈洞（填充用 evenodd）。

const TAU = 2 * Math.PI;
const norm = (a) => ((a % TAU) + TAU) % TAU;
const at = (c, a) => ({ x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) });
const f2 = (v) => Number(v.toFixed(2));

// 圆摆在哪：一个在正中；两个左右；三个品字形（A 左上、B 右上、C 下）。尺寸保证最小的一块也点得到
function place(n) {
  if (n === 1) return { w: 320, h: 220, circles: [{ cx: 160, cy: 112, r: 78, la: -Math.PI * 0.75 }] };
  if (n === 2) {
    const r = 92, d = 96, cx = 190, cy = 122;
    return { w: 380, h: 244, circles: [{ cx: cx - d / 2, cy, r, la: -Math.PI * 0.75 }, { cx: cx + d / 2, cy, r, la: -Math.PI * 0.25 }] };
  }
  const r = 98, d = 104, h3 = (d * Math.sqrt(3)) / 2, cx = 200, cy = 176;
  return {
    w: 400, h: 356,
    circles: [
      { cx: cx - d / 2, cy: cy - h3 / 3 - 8, r, la: -Math.PI * 0.75 },
      { cx: cx + d / 2, cy: cy - h3 / 3 - 8, r, la: -Math.PI * 0.25 },
      { cx, cy: cy + (2 * h3) / 3 - 8, r, la: Math.PI * 0.25 },
    ],
  };
}

// 圆 i 上和别的圆的交点（角度）
function cutsOf(circles, i) {
  const c = circles[i], out = [];
  circles.forEach((o, j) => {
    if (j === i) return;
    const D = Math.hypot(o.cx - c.cx, o.cy - c.cy);
    if (D >= c.r + o.r || D <= Math.abs(c.r - o.r)) return;
    const phi = Math.atan2(o.cy - c.cy, o.cx - c.cx), al = Math.acos((c.r * c.r + D * D - o.r * o.r) / (2 * c.r * D));
    out.push(norm(phi - al), norm(phi + al));
  });
  return out.sort((a, b) => a - b);
}
const maskAt = (circles, x, y, skip = -1) => circles.reduce((m, c, i) => (i !== skip && Math.hypot(x - c.cx, y - c.cy) < c.r ? m | (1 << i) : m), 0);

// 一段弧（沿角度增加的方向从 a0 到 a1）绕原点的面积分 ∮(x dy − y dx)/2
const sweepArea = (c, a0, a1) => 0.5 * (c.r * c.r * (a1 - a0) + c.r * c.cx * (Math.sin(a1) - Math.sin(a0)) - c.r * c.cy * (Math.cos(a1) - Math.cos(a0)));

/** n 个事件（1～3）的文氏图：{ w, h, circles: [{ cx, cy, r, label }], atoms: [{ k, d, loops, at, room, area }] } */
export function vennLayout(n) {
  if (![1, 2, 3].includes(n)) throw new Error('文氏图画 1 到 3 个事件');
  const { w, h, circles } = place(n);
  const N = 1 << n;
  const border = Array.from({ length: N }, () => []);
  circles.forEach((c, i) => {
    let cuts = cutsOf(circles, i);
    if (!cuts.length) cuts = [0, Math.PI]; // 整个圆：切成两半（SVG 画不了一整圈的弧）
    cuts.forEach((a0, k) => {
      const a1 = k + 1 < cuts.length ? cuts[k + 1] : cuts[0] + TAU;
      const mid = at(c, (a0 + a1) / 2);
      const others = maskAt(circles, mid.x, mid.y, i);
      const arc = { c, a0, a1 };
      border[others | (1 << i)].push(arc); // 圆里那边
      border[others].push(arc); // 圆外那边
    });
  });
  const same = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  // 一块的那些弧接成一圈一圈
  const loopsOf = (arcs) => {
    const left = arcs.slice(), loops = [];
    while (left.length) {
      const first = left.shift();
      const loop = [{ ...first, fwd: true, from: at(first.c, first.a0), to: at(first.c, first.a1) }];
      for (let guard = 0; guard < 64; guard++) {
        const end = loop[loop.length - 1].to;
        if (loop.length > 1 || !left.length) { if (same(end, loop[0].from)) break; }
        const k = left.findIndex((a) => same(at(a.c, a.a0), end) || same(at(a.c, a.a1), end));
        if (k < 0) break;
        const a = left.splice(k, 1)[0], fwd = same(at(a.c, a.a0), end);
        loop.push({ ...a, fwd, from: at(a.c, fwd ? a.a0 : a.a1), to: at(a.c, fwd ? a.a1 : a.a0) });
      }
      loops.push(loop);
    }
    return loops;
  };
  const pathOf = (loop) => `M${f2(loop[0].from.x)} ${f2(loop[0].from.y)} ${loop.map((s) => `A${s.c.r} ${s.c.r} 0 ${s.a1 - s.a0 > Math.PI ? 1 : 0} ${s.fwd ? 1 : 0} ${f2(s.to.x)} ${f2(s.to.y)}`).join(' ')} Z`;
  const areaOf = (loop) => Math.abs(loop.reduce((s, g) => s + (g.fwd ? 1 : -1) * sweepArea(g.c, g.a0, g.a1), 0));

  // 每一块里放字的点：离各个圆的边、矩形的边都最远的那个格点
  const best = Array.from({ length: N }, () => ({ room: -1, x: 0, y: 0 }));
  const STEP = 2;
  for (let y = STEP; y < h; y += STEP) for (let x = STEP; x < w; x += STEP) {
    const k = maskAt(circles, x, y);
    let room = Math.min(x, y, w - x, h - y);
    for (const c of circles) room = Math.min(room, Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r));
    // 圆外面那一块：字放在左下角那一带（右上留给别的），别的块取最宽的地方
    const score = k === 0 ? Math.min(room, 30) - 0.02 * (x + (h - y)) : room;
    if (score > (best[k].score ?? -Infinity)) best[k] = { room, x, y, score };
  }
  const atoms = border.map((arcs, k) => {
    const loops = loopsOf(arcs);
    const holes = loops.map(pathOf).join(' ');
    const area = loops.reduce((s, l) => s + areaOf(l), 0);
    return {
      k, loops,
      d: k === 0 ? `M0 0 H${w} V${h} H0 Z ${holes}` : holes,
      area: k === 0 ? w * h - area : area,
      at: { x: best[k].x, y: best[k].y }, room: best[k].room,
    };
  });
  return {
    w, h, n,
    circles: circles.map((c) => ({ cx: c.cx, cy: c.cy, r: c.r, label: { x: f2(c.cx + (c.r + 13) * Math.cos(c.la)), y: f2(c.cy + (c.r + 13) * Math.sin(c.la)) } })),
    atoms,
  };
}

/** 画面上的一点在哪一块（矩形外面回 null） */
export function atomAt(L, x, y) {
  if (!(x >= 0 && x <= L.w && y >= 0 && y <= L.h)) return null;
  return maskAt(L.circles, x, y);
}
