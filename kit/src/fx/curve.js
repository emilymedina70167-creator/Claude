// 函数图的曲线怎么采样（视觉交互第 1 批；纯函数，tests/fx-curve.test.js）。
// 以前是等分 240 个点连成一条折线、超出窗口的压到边上：跳跃间断点、无穷间断点都被连成一条竖线，
// 泰勒多项式冲出窗口的部分画成一段水平线——画出来的东西是错的。这里把曲线切成连续的几段：
//   segs   每一段是连续的一条折线（没定义的一段、跳跃、极点都断开）
//   jumps  有限的跳跃：左右极限，函数值等于哪一边（那边画实心点，另一边空心）
//   holes  可去间断点（那一点没定义、左右极限相等）：画空心点
// 只看得见采到的点：除了等分点，还把窗口里的整点、半整点、π/2 的整数倍放进去（间断点多半在这些地方）。

export const CURVE_MAX_POINTS = 6000;
const SMOOTH_DEPTH = 5; // 弯得厉害的地方最多对半分几层
const JUMP_DEPTH = 12; // 相邻两点差得大：再对半分到这一层还差得大，就是断点（陡但连续的早就缩小了）
const PER_INTERVAL = 96; // 一个等分区间里最多加几个点（振荡的地方不把总数吃光）

const fin = (y) => !Number.isNaN(y);

function grid(a, b, n) {
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(a + ((b - a) * i) / n);
  for (const q of [0.5, Math.PI / 2]) {
    const lo = Math.ceil(a / q), hi = Math.floor(b / q);
    if (hi - lo > 400) continue;
    for (let k = lo; k <= hi; k++) { const x = q === 0.5 ? k / 2 : k * q; if (x > a && x < b) xs.push(x); }
  }
  xs.sort((p, q) => p - q);
  const tiny = (b - a) * 1e-12;
  return xs.filter((x, i) => i === 0 || x - xs[i - 1] > tiny);
}

export function sampleCurve(f, a, b, { ySpan, n = 240 } = {}) {
  const out = { segs: [], jumps: [], holes: [] };
  if (!(b > a) || !Number.isFinite(a) || !Number.isFinite(b)) return out;
  const g = (x) => { let y; try { y = f(x); } catch { return NaN; } return typeof y === 'number' && Number.isFinite(y) ? y : NaN; };
  const span = b - a;
  const xs = grid(a, b, n), ys = xs.map(g);
  if (!(ySpan > 0)) {
    const s = ys.filter(fin).sort((p, q) => p - q);
    ySpan = s.length ? (s[Math.floor(s.length * 0.98)] - s[Math.floor(s.length * 0.02)]) || (s[s.length - 1] - s[0]) || 1 : 1;
  }
  const BIG = 0.08 * ySpan, FLAT = 0.004 * ySpan, TOL = 0.02 * ySpan;
  const digits = Math.max(0, Math.min(15, 9 - Math.floor(Math.log10(span))));
  const nice = (x) => { const r = Number(x.toFixed(digits)); return Object.is(r, -0) ? 0 : r; }; // 断点多半是个整齐的数：0.9999999999 当 1
  const e1 = span * 1e-6, e2 = span * 1e-7;

  let total = xs.length, cur = null;
  const emit = (x, y) => { if (!cur) { cur = []; out.segs.push(cur); } const p = cur[cur.length - 1]; if (!p || x > p[0]) cur.push([x, y]); };
  const cut = () => { cur = null; };

  // 从有定义的一头 xf 往没定义的一头 xn 逼近边界。回 { x, y, stable }：stable 是往边界走函数值稳得住（不是冲向无穷、不是振荡）
  function edge(xf, yf, xn) {
    let lo = xf, ylo = yf, hi = xn;
    for (let i = 0; i < 60 && Math.abs(hi - lo) > 1e-15 * Math.max(1, Math.abs(lo)); i++) {
      const m = (lo + hi) / 2, ym = g(m);
      if (m === lo || m === hi) break;
      if (fin(ym)) { lo = m; ylo = ym; } else hi = m;
    }
    const dir = Math.sign(xf - xn);
    const y1 = g(lo + dir * e1), y2 = g(lo + dir * e2);
    const stable = fin(y1) && fin(y2) && Math.abs(y1 - y2) < TOL;
    // 紧贴边界的那个值可能被舍入弄坏（(x²−1)/(x−1) 在 1 旁边）：稳得住时信稍远一点的
    return { x: lo, y: stable && Math.abs(ylo - y2) > TOL ? y2 : ylo, stable };
  }

  // 相邻两点差得大、对半分到头还差得大：找出断点，看是跳跃、极点还是振荡
  function classify(x0, y0, x1, y1) {
    let lo = x0, ylo = y0, hi = x1, yhi = y1;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2, ym = g(m);
      if (m === lo || m === hi) break;
      if (!fin(ym)) return { kind: 'pole' };
      if (Math.abs(ym - ylo) >= Math.abs(yhi - ym)) { hi = m; yhi = ym; } else { lo = m; ylo = ym; }
    }
    const x = nice((lo + hi) / 2);
    const L1 = g(x - e1), L2 = g(x - e2), R1 = g(x + e1), R2 = g(x + e2);
    if (![L1, L2, R1, R2].every(fin)) return { kind: 'pole' };
    if (Math.max(Math.abs(L2), Math.abs(R2)) > 100 * ySpan) return { kind: 'pole' };
    if (Math.abs(L1 - L2) > TOL || Math.abs(R1 - R2) > TOL) return { kind: 'osc' };
    if (Math.abs(L2 - R2) <= TOL) return { kind: 'osc' };
    const v = g(x), close = TOL * 0.05;
    const solid = fin(v) && Math.abs(v - R2) <= close ? 'right' : fin(v) && Math.abs(v - L2) <= close ? 'left' : 'none';
    return { kind: 'jump', x, left: L2, right: R2, solid, ...(solid === 'none' && fin(v) ? { value: v } : {}) };
  }

  let ended = null; // 上一段是在哪个边界上停的（紧接着又从同一处开始：可去间断点，或者那一点没定义的跳跃）
  function walk(x0, y0, x1, y1, depth, bud) {
    const f0 = fin(y0), f1 = fin(y1);
    if (!f0 && !f1) { cut(); return; }
    if (f0 && !f1) { const e = edge(x0, y0, x1); emit(e.x, e.y); ended = e; cut(); return; }
    if (!f0 && f1) {
      const e = edge(x1, y1, x0);
      if (ended && e.stable && ended.stable && Math.abs(e.x - ended.x) < e1) {
        const x = nice((e.x + ended.x) / 2);
        if (Math.abs(e.y - ended.y) <= TOL) out.holes.push({ x, y: (e.y + ended.y) / 2 });
        else out.jumps.push({ x, left: ended.y, right: e.y, solid: 'none' });
      }
      ended = null;
      cut(); emit(e.x, e.y); emit(x1, y1);
      return;
    }
    const dy = Math.abs(y1 - y0);
    if (depth < (dy > BIG ? JUMP_DEPTH : SMOOTH_DEPTH) && bud.n > 0 && total < CURVE_MAX_POINTS) {
      const m = (x0 + x1) / 2, ym = g(m);
      bud.n--; total++;
      if (!fin(ym) || dy > BIG || Math.abs(ym - (y0 + y1) / 2) > FLAT) { walk(x0, y0, m, ym, depth + 1, bud); walk(m, ym, x1, y1, depth + 1, bud); return; }
      emit(m, ym); emit(x1, y1);
      return;
    }
    if (dy > BIG && depth >= JUMP_DEPTH) {
      const j = classify(x0, y0, x1, y1);
      if (j.kind === 'jump') {
        // 断点正好在窗口边上：只断开，不画点（边上那半个跳看不出是什么）
        if (j.x <= a + e1 || j.x >= b - e1) { cut(); if (j.x <= a + e1) emit(x1, y1); return; }
        emit(j.x, j.left);
        // 断点上函数另有一个值时，这个点自己也在网格里，两边各认出一次：只记一个
        if (!out.jumps.some((k) => Math.abs(k.x - j.x) < e1)) out.jumps.push({ x: j.x, left: j.left, right: j.right, solid: j.solid, ...('value' in j ? { value: j.value } : {}) });
        cut(); emit(j.x, j.right); emit(x1, y1);
        return;
      }
      if (j.kind === 'pole') { cut(); emit(x1, y1); return; }
    }
    emit(x1, y1);
  }

  if (fin(ys[0])) emit(xs[0], ys[0]);
  for (let i = 0; i + 1 < xs.length; i++) {
    if (fin(ys[i]) && fin(ys[i + 1])) ended = null;
    walk(xs[i], ys[i], xs[i + 1], ys[i + 1], 0, { n: PER_INTERVAL });
  }
  out.segs = out.segs.filter((s) => s.length >= 2);
  return out;
}

/** 曲线在横向 frac（0～1）处的点 [x, y]；那里没定义就找最近的有定义的点；一段都没有回 null */
export function labelSpot(segs, frac, { x0, x1 }) {
  const tx = x0 + frac * (x1 - x0);
  let best = null, d = Infinity;
  for (const s of segs) for (const p of s) { const e = Math.abs(p[0] - tx); if (e < d) { d = e; best = p; } }
  return best ? [best[0], best[1]] : null;
}
