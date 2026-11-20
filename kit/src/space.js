// 三维图：向量、点、直线、平面、张成、平行六面体，可以用手指或 Pencil 拖动旋转。
//
//   let u = [1, 0, 1]
//   let v = [0, 1, 1]
//   slider t 0 1 = 0.5
//   span u, v color=blue                 # 过原点的平面（两个向量线性相关时画成直线）
//   vector u color=blue label=u
//   vector t*u + v color=yellow label=w
//   plane normal [0, 0, 1] at [0, 0, 1]  # 过某点、给定法向量的平面
//   box u, v, [0, 0, 1]                  # 平行六面体（体积 = |det|）
//   show $\det = {det(mat(u, v, [0,0,1]))}$
//   quadric [[2,0,0],[0,3,2],[0,2,3]] = 6     # 二次曲面 xᵀAx = 6 的线框（在主轴上参数化，quadric.js）
// 第 3 批（视觉交互）：曲面、空间曲线、截痕、切平面、旋转体、积分区域、向量场、平面写方程和交线、三阶的特征方向，
// 地面上能拖的点、goal、pick。写法在 spacespec.js，几何在 fx/solid.js，这里只管投影、按远近画、手势。
import { isNum, isVec } from './expr.js';
import { fillValues } from './scene.js';
import { mdToHtml, tex2html, escapeHtml } from './render.js';
import { sliderText, figureControls } from './plot.js';
import { quadricLines } from './quadric.js';
import { parseSpace } from './spacespec.js';
import { compileWith } from './fx/defs.js';
import { judgePicks, pickFeedback } from './graphpick.js';
import { close } from './scene.js';
import { typedRegion, contourLines } from './fx/plane.js';
import {
  meshGrid, meshOver, sliceLines, planeFrom, planeMeet2, planes3, splitAll, planeInBox, revolveMesh, revolveVolume,
  solidBounds, columnOf, crossSection, sectionArea, fieldArrows3, eig3, baseDepth,
} from './fx/solid.js';

export { parseSpace };

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 480;
const COLOR = {
  blue: 'var(--blue)', pink: 'var(--pink)', yellow: 'var(--yellow)', green: 'var(--green)', purple: 'var(--lav)',
  orange: 'var(--orange)', red: 'var(--coral)', white: 'var(--chalk)', gray: 'var(--muted)', grey: 'var(--muted)',
  1: 'var(--v1)', 2: 'var(--v2)', 3: 'var(--v3)', 4: 'var(--v4)', 5: 'var(--v5)',
};
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const prettyLabel = (s) => String(s).replace(/([A-Za-z])(\d+)$/, (_, a, d) => a + [...d].map((c) => SUB[c]).join(''));

// —— 三维小工具 ——
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (k, a) => [k * a[0], k * a[1], k * a[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a);
const unit = (a) => mul(1 / len(a), a);
const vec3 = (p, what) => { if (!isVec(p) || p.length !== 3) throw new Error(`${what}需要是三维向量`); return p; };
const vec2 = (p, what) => { if (!isVec(p) || p.length !== 2) throw new Error(`${what}要写成 [x, y]（地面上的点）`); return p; };
const PLANE_COLORS = ['var(--v1)', 'var(--v2)', 'var(--v3)', 'var(--v4)', 'var(--v5)'];
// 视线和地面的夹角小于这么多度时，地面上的点不让拖、不让点（屏幕上挪一点，地面上就飞出去很远）
const FLAT_PITCH = 8;

export function createSpace(container, src, opts = {}) {
  const parsed = typeof src === 'string' ? parseSpace(src) : src;
  const { fields, cmds } = parsed;
  // 读数里的式子：和命令同一套（认函数定义；这张图按角度还是弧度，见 spacespec.js）
  const compile = (s) => compileWith(s, parsed.defs, parsed.rad ? undefined : { deg: true });
  const extra = opts.extraVars || {};
  const base = opts.baseVars || {};
  const state = { slider: {}, drag: {}, override: {}, yaw: -32, pitch: 22, spinning: /^(true|yes|1|是)$/i.test(fields.spin || ''), goalsHit: new Set(), picks: new Map() };
  const view = String(fields.view || '').split(/[\s,，]+/).map(Number);
  if (view.length === 2 && view.every(Number.isFinite)) [state.yaw, state.pitch] = view;
  const home = [state.yaw, state.pitch];
  cmds.filter((c) => c.kind === 'slider').forEach((c) => (state.slider[c.name] = c.init));
  const goalIdx = cmds.map((c, i) => (c.kind === 'goal' ? i : -1)).filter((i) => i >= 0);
  const pickIdx = cmds.map((c, i) => (c.kind === 'pick' ? i : -1)).filter((i) => i >= 0);
  pickIdx.forEach((i) => state.picks.set(i, { pts: [], tries: 0, done: false, giveup: false, res: null, msg: '' }));
  const hasTasks = goalIdx.length + pickIdx.length > 0;
  const revealed = () => hasTasks && goalIdx.every((i) => state.goalsHit.has(i)) && pickIdx.every((i) => state.picks.get(i).done);

  container.innerHTML = `<div class="w-plot sp-plot g-plot"><div class="sp-tools"><button type="button" class="btn btn-sm sp-home" title="回到开始的视角">正视角</button><button type="button" class="btn btn-sm sp-spin" title="慢慢转一圈">转一转</button></div></div><div class="w-side"><div class="sliders"></div><div class="readout r-show"></div><div class="goal-msg" hidden></div><div class="w-hint">拖动图可以旋转（手指或 Pencil 都行）。</div></div>`;
  const side = container.querySelector('.w-side');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('class', 'plane space');
  container.querySelector('.sp-plot').prepend(svg);

  // —— 式子当函数用：自变量放进一层派生的变量里 ——
  const safeNum = (y) => (isNum(y) && Number.isFinite(y) ? y : NaN);
  const fn1 = (f, v, name = 'x') => { const s = Object.create(v); return (t) => { s[name] = t; try { return safeNum(f(s)); } catch { return NaN; } }; };
  const fnXY = (f, v) => { const s = Object.create(v); return (x, y) => { s.x = x; s.y = y; try { return safeNum(f(s)); } catch { return NaN; } }; };
  const fnXYZ = (f, v) => { const s = Object.create(v); return (x, y, z) => { s.x = x; s.y = y; s.z = z; try { return safeNum(f(s)); } catch { return NaN; } }; };
  // 式子抛错的原因（函数名写错、变量没定义）：只是那一点没定义不算
  const whyOf = (f, s) => { try { f(s); return null; } catch (e) { return String(e?.message || e); } };
  const find = (kind, name) => cmds.find((c) => [].concat(kind).includes(c.kind) && c.name === name);

  // 平面：写方程的要是 x、y、z 的一次式；老写法是法向量 + 一点
  function planeOf(c, v) {
    if (!c.eq) {
      const n = vec3(c.n(v), 'normal ');
      if (len(n) < 1e-9) throw new Error('法向量不能是零向量');
      return { n, p0: c.at ? vec3(c.at(v), 'at ') : [0, 0, 0] };
    }
    const s = Object.create(v);
    const g = (x, y, z) => { s.x = x; s.y = y; s.z = z; const r = c.eq(s); if (!isNum(r)) throw new Error('plane 的方程两边要是数'); return r; };
    const d0 = g(0, 0, 0), a = g(1, 0, 0) - d0, b = g(0, 1, 0) - d0, cc = g(0, 0, 1) - d0;
    if (Math.abs(g(1, 2, 3) - (d0 + a + 2 * b + 3 * cc)) > 1e-9 * Math.max(1, Math.abs(d0), Math.abs(a), Math.abs(b), Math.abs(cc))) throw new Error('plane 的方程要是 x、y、z 的一次式（曲面用 surface）');
    const P = planeFrom(a, b, cc, -d0);
    if (!P) throw new Error('plane：x、y、z 的系数不能都是 0');
    return P;
  }
  const lineOf = (c, v) => { const p = vec3(c.p(v), 'line '), d = vec3(c.d(v), 'dir '); if (len(d) < 1e-9) throw new Error('直线的方向不能是零向量'); return { p, d }; };
  // 区域 → fx/solid.js 认的「底」
  const regionBase = (r, v) => ({ shape: r.shape, lo: fn1(r.lo, v, r.param), hi: fn1(r.hi, v, r.param), a: r.a(v), b: r.b(v) });
  function baseOf(b, v) {
    if (!b) return { rect: [-R, R, -R, R] };
    if (b.kind === 'region') return regionBase(find('region', b.of), v);
    if (b.kind === 'polar') return { shape: 'r', lo: fn1(b.lo, v, b.param), hi: fn1(b.hi, v, b.param), a: b.a(v), b: b.b(v) };
    // for x a b, y c d：先写的那个变量是外层的（y 的上下限能含 x）
    return { shape: b.u === 'y' ? 'x' : 'y', lo: fn1(b.lo, v, b.u), hi: fn1(b.hi, v, b.u), a: b.a(v), b: b.b(v) };
  }
  const volumeOf = (c, v) => { const full = revolveVolume(fn1(c.f, v), c.a(v), c.b(v), c.axis); return c.upto ? (full * Math.max(0, Math.min(2 * Math.PI, c.upto(v)))) / (2 * Math.PI) : full; };
  const columnAt = (c, v) => { const T = find('solid', c.of), p = vec2(c.at(v), 'column 的 at '); return { p, col: columnOf(fnXY(T.lo, v), fnXY(T.hi, v), baseOf(T.base, v), p[0], p[1]) }; };

  let ready = false; // 范围定下来没有（第一次 env() 是为了定范围）
  const env = () => {
    const v = { ...base, ...extra, ...state.slider };
    for (const c of cmds) {
      if (c.kind === 'let') {
        v[c.name] = Object.hasOwn(state.override, c.name) ? state.override[c.name] : c.mods.drag && Object.hasOwn(state.drag, c.name) ? state.drag[c.name] : c.expr(v);
      } else if (c.name && c.kind === 'plane') {
        // 起了名字的平面、直线：表达式里是一个量（dist、angleof 认：平面 [a, b, c, d]，直线 [[点], [方向]]）
        const P = planeOf(c, v);
        v[c.name] = [...P.n, dot(P.n, P.p0)];
      } else if (c.name && c.kind === 'line') {
        const l = lineOf(c, v);
        v[c.name] = [l.p, l.d];
      } else if (c.name && c.kind === 'revolve') {
        v[c.name] = volumeOf(c, v);
      } else if (c.kind === 'column' && (c.loName || c.hiName) && ready) {
        const { col } = columnAt(c, v);
        if (c.loName) v[c.loName] = col ? col.z0 : NaN;
        if (c.hiName) v[c.hiName] = col ? col.z1 : NaN;
      } else if (c.kind === 'slice' && c.areaName && ready) {
        const T = find('solid', c.of);
        v[c.areaName] = memoArea(c, v, () => sectionArea(fnXY(T.lo, v), fnXY(T.hi, v), baseOf(T.base, v), c.at(v)));
      }
    }
    return v;
  };
  // 截面的面积要积一次（几毫秒到几十毫秒）：同样的量不重算
  const areaMemo = new Map();
  const keyOf = (v) => { try { return JSON.stringify(v); } catch { return String(Math.random()); } };
  function memoArea(c, v, compute) {
    const k = keyOf({ ...v, [c.areaName]: 0 });
    const hit = areaMemo.get(c);
    if (hit && hit.k === k) return hit.val;
    const val = compute();
    areaMemo.set(c, { k, val });
    return val;
  }

  // 范围：没写 range 时按出现的东西自动取。z: 下 上 能把竖直方向的中心挪开（曲面 z = x² + y² 都在上半边）
  let R = Number(fields.range) || 0;
  let zc = 0;
  const zField = String(fields.z || '').trim().split(/[\s,，]+/).map(Number);
  const zGiven = zField.length === 2 && zField.every(Number.isFinite) && zField[1] > zField[0] ? zField : null;
  {
    let m = 1, zmin = 0, zmax = 0, calc = false;
    try {
      const v = env();
      const take = (p) => { if (isVec(p) && p.length === 3) m = Math.max(m, ...p.map(Math.abs)); };
      const span = (p) => { if (p && p.every(Number.isFinite)) { m = Math.max(m, Math.abs(p[0]), Math.abs(p[1])); zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]); calc = true; } };
      R = R || 3; // 下面取样时要一个临时的范围（没写底的曲面）
      for (const c of cmds) {
        try {
          if (c.kind === 'vector') { const a = c.expr(v); take(a); if (c.from) take(addv(c.from(v), a)); }
          if (c.kind === 'point') c.exprs.forEach((e) => take(e(v)));
          if (c.kind === 'box') take(c.exprs.map((e) => e(v)).reduce(addv));
          // 椭球面这种有界的：整个装得下；伸到无穷远的按半轴长取一点余量
          if (c.kind === 'quadric') { const q = quadricLines(c.A(v), c.c(v), 4); for (const l of q.lines) for (const p of l) take(p.map((x) => Math.max(-4, Math.min(4, x)))); }
          if (c.kind === 'surface' && c.form === 'z' && c.base) meshOver(fnXY(c.f, v), baseOf(c.base, v), { n: 8, m: 8 }).pts.forEach(span);
          if (c.kind === 'surface' && c.form === 'param') meshGrid(paramFn(c, v), ...c.ranges.map((r) => [r[0](v), r[1](v)]), { nu: 10, nv: 10 }).pts.forEach(span);
          if (c.kind === 'curve') { const P = curveFn(c, v), a = c.from(v), b = c.to(v); for (let i = 0; i <= 40; i++) span(P(a + ((b - a) * i) / 40)); }
          if (c.kind === 'revolve') revolveMesh(fn1(c.f, v), [c.a(v), c.b(v)], c.axis, { n: 10, m: 8 }).pts.forEach(span);
          if (c.kind === 'solid' && c.form === 'z') { const s = solidBounds(fnXY(c.lo, v), fnXY(c.hi, v), baseOf(c.base, v), { n: 8, m: 4 }); s.bottom.pts.forEach(span); s.top.pts.forEach(span); }
          if (c.kind === 'solid' && c.form === 'sph') { const h = Math.abs(c.hi({ ...v, phi: 0, [c.tName]: 0 })); span([h, h, h]); span([-h, -h, c.phi[1](v) > Math.PI / 2 + 1e-9 ? -h : 0]); }
        } catch { /* 画的时候再报错 */ }
      }
    } catch { /* 画的时候再报错 */ }
    // 微积分的图：竖直方向按内容的中间对准（只在上半边的曲面不挤在上面一半里）；写了 range 也一样，z: 明着定的优先
    if (calc && !zGiven) zc = (zmin + zmax) / 2;
    if (Number(fields.range)) R = Number(fields.range);
    else {
      const half = calc ? Math.max(m, (zmax - zmin) / 2) : m;
      R = Math.min(10, Math.max(1.5, Math.ceil(half * 2) / 2));
    }
    if (zGiven) { zc = (zGiven[0] + zGiven[1]) / 2; if (!Number(fields.range)) R = Math.max(R, (zGiven[1] - zGiven[0]) / 2); }
  }
  ready = true;
  const K = SIZE / 2 / (R * 1.55);
  const boxNow = () => ({ x0: -R, x1: R, y0: -R, y1: R, z0: zc - R, z1: zc + R });
  function paramFn(c, v) { const s = Object.create(v); return (a, b) => { s[c.params[0]] = a; s[c.params[1]] = b; try { const p = c.p(s); return isVec(p) && p.length === 3 ? p : null; } catch { return null; } }; }
  function curveFn(c, v) { const s = Object.create(v); return (t) => { s[c.param] = t; try { const p = c.p(s); return isVec(p) && p.length === 3 && p.every(Number.isFinite) ? p : null; } catch { return null; } }; }

  // 投影：先绕 z 轴转 yaw，再俯仰 pitch；返回屏幕坐标和深度（越大越远）。竖直方向以 zc 为中心
  function proj(p) {
    const a = (state.yaw * Math.PI) / 180, b = (state.pitch * Math.PI) / 180, z = p[2] - zc;
    const x1 = p[0] * Math.cos(a) - p[1] * Math.sin(a);
    const y1 = p[0] * Math.sin(a) + p[1] * Math.cos(a);
    const up = z * Math.cos(b) + y1 * Math.sin(b);
    const depth = y1 * Math.cos(b) - z * Math.sin(b);
    return [SIZE / 2 + x1 * K, SIZE / 2 - up * K, depth];
  }
  // 屏幕上的一点（viewBox 坐标）→ 过它的视线和地面 z = 0 的交点；视线快和地面平行时回 null
  function toGround(sx, sy) {
    if (Math.abs(state.pitch) < FLAT_PITCH) return null;
    const a = (state.yaw * Math.PI) / 180, b = (state.pitch * Math.PI) / 180;
    const x1 = (sx - SIZE / 2) / K, up = (SIZE / 2 - sy) / K;
    const y1 = (up + zc * Math.cos(b)) / Math.sin(b);
    return [x1 * Math.cos(a) + y1 * Math.sin(a), -x1 * Math.sin(a) + y1 * Math.cos(a)];
  }
  const color = (c, d) => COLOR[String(c.mods.color || '').toLowerCase()] || d;
  const visible = (c) => !(c.mods.from !== undefined && !((extra.step ?? 0) >= Number(c.mods.from))) && !(c.mods.until !== undefined && !((extra.step ?? 0) <= Number(c.mods.until)))
    && !(hasTasks && c.mods.after && !revealed()) && !(hasTasks && c.mods.before && revealed());
  // cur：正在画第几条命令。画出的元素带 data-cmd，课堂里 highlight 靠它找。
  // 三维图先收集、按远近排序再画，所以命令序号跟着每一项走（push / labels 记下当时的 cur）
  let cur = null;
  const el = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (cur != null) e.setAttribute('data-cmd', cur);
    parent.appendChild(e);
    return e;
  };

  let items = [];
  let labels = [];
  let overlay = []; // 画在最上面的（把手、学生点的点）
  let notes = []; // 页面自己说的话（三个平面是哪种情形）：写在读数下面
  const push = (depth, fn) => items.push({ depth, fn, cmd: cur });

  // 平面片：以 p0 为中心、两个正交方向 e1 e2 张成的正方形
  function patch(p0, e1, e2, cls, col, half = R * 0.95) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => addv(p0, addv(mul(s * half, e1), mul(t * half, e2))));
    const P = corners.map(proj);
    push(P.reduce((s, q) => s + q[2], 0) / 4 + R * 0.3, () => {
      const pg = el('polygon', { points: P.map((q) => `${q[0]},${q[1]}`).join(' '), class: cls });
      pg.style.fill = col;
      pg.style.stroke = col;
      // 平面上的几条网格线，帮助看出朝向
      for (let k = -2; k <= 2; k++) {
        const s = (k / 2) * half * 0.999;
        const a1 = proj(addv(p0, addv(mul(s, e1), mul(-half, e2)))), b1 = proj(addv(p0, addv(mul(s, e1), mul(half, e2))));
        const a2 = proj(addv(p0, addv(mul(-half, e1), mul(s, e2)))), b2 = proj(addv(p0, addv(mul(half, e1), mul(s, e2))));
        el('line', { x1: a1[0], y1: a1[1], x2: b1[0], y2: b1[1], class: 'sp-plane-grid' }).style.stroke = col;
        el('line', { x1: a2[0], y1: a2[1], x2: b2[0], y2: b2[1], class: 'sp-plane-grid' }).style.stroke = col;
      }
    });
  }
  const patchCorners = (p0, n, half) => {
    const nu = unit(n), a = Math.abs(nu[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = unit(sub(a, mul(dot(a, nu), nu))), e2 = cross(nu, e1);
    return { e1, e2, poly: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => addv(p0, addv(mul(s * half, e1), mul(t * half, e2)))) };
  };
  function seg3(a, b, cls, col, extraAttrs = {}) {
    const A = proj(a), B = proj(b);
    push((A[2] + B[2]) / 2, () => { const l = el('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], class: cls, ...extraAttrs }); if (col) l.style.stroke = col; });
  }
  // 一张填色的多边形（半透明）
  function poly3(pts, cls, col, bias = 0) {
    const P = pts.map(proj);
    push(P.reduce((s, q) => s + q[2], 0) / P.length + bias, () => { const pg = el('polygon', { points: P.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '), class: cls }); pg.style.fill = col; pg.style.stroke = col; });
  }
  // 一条空间里的折线：切成几小段各自按远近排（整条按一个深度会整个压在面的前面或后面）
  function line3(pts, cls, col, chunk = 8) {
    for (let i = 0; i + 1 < pts.length; i += chunk) {
      const part = pts.slice(i, i + chunk + 1).map(proj);
      push(part.reduce((s, q) => s + q[2], 0) / part.length - 0.02, () => { const pl = el('polyline', { points: part.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '), class: cls }); if (col) pl.style.stroke = col; });
    }
  }
  // 一张网格曲面：每个格子一个四边形，朝着看的那一面亮一点
  function mesh3(mesh, col, cls = 'sp-surf') {
    const P = mesh.pts.map((p) => (p ? proj(p) : null));
    for (const q of mesh.quads) {
      const a = P[q[0]], b = P[q[1]], c = P[q[2]], d = P[q[3]];
      const front = (c[0] - a[0]) * (d[1] - b[1]) - (c[1] - a[1]) * (d[0] - b[0]) < 0;
      push((a[2] + b[2] + c[2] + d[2]) / 4, () => {
        const pg = el('polygon', { points: `${a[0].toFixed(1)},${a[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)} ${c[0].toFixed(1)},${c[1].toFixed(1)} ${d[0].toFixed(1)},${d[1].toFixed(1)}`, class: `${cls}${front ? ' is-front' : ''}` });
        pg.style.fill = col; pg.style.stroke = col;
      });
    }
  }
  function dot3(p, col, r = 5.5, cls = 'pt') {
    const P = proj(p);
    push(P[2] - 0.05, () => { el('circle', { cx: P[0], cy: P[1], r, class: cls }).style.fill = col; });
    return P;
  }
  function arrow3(from, to, col, { label, dashed, width = 5 } = {}) {
    const A = proj(from), B = proj(to);
    push(B[2], () => {
      const g = el('g', { class: 'vec', style: `--vc:${col}` });
      const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
      if (L < 1) { el('circle', { cx: B[0], cy: B[1], r: 4, class: 'vec-head' }, g); return; }
      const ux = dx / L, uy = dy / L, h = Math.min(width < 4 ? 10 : 17, L * 0.55);
      const bx = B[0] - ux * h, by = B[1] - uy * h;
      el('line', { x1: A[0], y1: A[1], x2: bx, y2: by, 'stroke-width': width, class: dashed ? 'vec-line dashed' : 'vec-line' }, g);
      el('polygon', { points: `${B[0]},${B[1]} ${bx - uy * h * 0.48},${by + ux * h * 0.48} ${bx + uy * h * 0.48},${by - ux * h * 0.48}`, class: 'vec-head' }, g);
    });
    if (label) labels.push({ x: B[0], y: B[1], ux: B[0] - A[0], uy: B[1] - A[1], text: label, col, cmd: cur });
  }
  // 直线在盒子里的那一段
  function lineInBox(p, d) {
    const b = boxNow();
    let t0 = -Infinity, t1 = Infinity;
    for (const [i, lo, hi] of [[0, b.x0, b.x1], [1, b.y0, b.y1], [2, b.z0, b.z1]]) {
      if (Math.abs(d[i]) < 1e-12) { if (p[i] < lo || p[i] > hi) return null; continue; }
      const a = (lo - p[i]) / d[i], c = (hi - p[i]) / d[i];
      t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
    }
    return t1 > t0 ? [addv(p, mul(t0, d)), addv(p, mul(t1, d))] : null;
  }

  function axes() {
    const names = ['x', 'y', 'z'];
    for (let i = 0; i < 3; i++) {
      const e = [0, 0, 0], f = [0, 0, 0];
      e[i] = R; f[i] = -R;
      if (i === 2) { e[2] = zc + R; f[2] = zc - R; }
      seg3(f, e, 'axis sp-axis');
      const tip = i === 2 ? [0, 0, zc + R * 1.1] : mul(1.1, e);
      const T = proj(tip);
      labels.push({ x: T[0], y: T[1], ux: 0, uy: 0, text: names[i], col: 'var(--muted)', axis: true });
    }
    // 地面（z = 0）上的淡网格
    for (let k = -Math.floor(R); k <= R; k++) {
      if (!k) continue;
      seg3([k, -R, 0], [k, R, 0], 'grid');
      seg3([-R, k, 0], [R, k, 0], 'grid');
    }
  }

  // 几何只跟变量有关、跟视角无关：转的时候不重算（转一圈要画几十帧）
  const geoCache = new Map();
  let vKey = '';
  const geo = (tag, build) => {
    const k = `${cur}:${tag}`, hit = geoCache.get(k);
    if (hit && hit.vKey === vKey) return hit.val;
    const val = build();
    geoCache.set(k, { vKey, val });
    return val;
  };

  let lastErr = '';
  let coarse = false, fineTimer = 0, firstDraw = true;
  function draw({ moving = false } = {}) {
    clearTimeout(fineTimer);
    coarse = moving;
    svg.innerHTML = '';
    items = []; labels = []; overlay = []; notes = [];
    const errs = [];
    let v = null;
    try { v = env(); } catch (e) { errs.push(e.message); }
    vKey = v ? `${coarse ? 'c' : 'f'}${keyOf(v)}` : '';
    cur = null;
    axes();
    if (v) {
      drawPlanes(v, errs);
      cmds.forEach((c, i) => {
        if (!visible(c)) return;
        cur = i + 1;
        try { drawCmd(c, v); } catch (e) { errs.push(e.message); }
      });
      cur = null;
      drawHandles(v);
      drawPicks(v);
    }
    items.sort((a, b) => b.depth - a.depth).forEach((it) => { cur = it.cmd; it.fn(); });
    placeLabels();
    for (const o of overlay) { cur = o.cmd; o.fn(); }
    cur = null;
    if (v) {
      side.querySelector('.r-show').innerHTML = cmds.map((c, i) => (c.kind === 'show' && visible(c) ? `<div data-cmd="${i + 1}">${mdToHtml(fillValues(dashNaN(c.text, v), v, errs, compile), { inline: true })}</div>` : '')).join('')
        + notes.map((n) => `<div class="sp-auto">${escapeHtml(n)}</div>`).join('');
      checkGoals(v, ctl.quiet || firstDraw, errs);
      for (const i of pickIdx) { const ts = targetsOf(cmds[i], v); if (ts instanceof Error) errs.push(ts.message); }
    }
    firstDraw = false;
    const msg = [...new Set(errs)].join('；');
    if (msg !== lastErr) {
      lastErr = msg;
      let box = container.querySelector('.scene-error');
      if (msg) { if (!box) { box = document.createElement('div'); box.className = 'block-error scene-error'; side.appendChild(box); } box.textContent = '图形描述有误：' + msg; } else box?.remove();
    }
    ctl.mark();
    // 拖滑块、拖点的那几帧用稀的网格，手停了补一张细的
    if (coarse) fineTimer = setTimeout(() => draw(), 200);
  }
  // 竖着的一根、截面在那里没有（点拖到了底的外面）：读数里用到它的那一格写「—」，不报错
  const naNames = cmds.flatMap((c) => (c.kind === 'column' ? [c.loName, c.hiName] : c.kind === 'slice' ? [c.areaName] : [])).filter(Boolean);
  const goneIn = (text, v) => naNames.some((n) => Number.isNaN(v[n]) && new RegExp(`(?<![\\w.])${n}(?![\\w(])`).test(text));
  const dashNaN = (text, v) => (naNames.length ? text.replace(/(?<![\\\w}_^])\{([^{}]+)\}/g, (m, expr, at) => (goneIn(expr, v) ? ((text.slice(0, at).match(/(?<!\\)\$/g) || []).length % 2 ? '\\text{—}' : '—') : m)) : text);

  // 课堂操作（play / set / highlight / vars / dragend）：见 plot.js 的 figureControls
  const ctl = figureControls({
    root: container, cmds, state, extra, env, draw: () => draw(),
    // 地面上能拖的点：设成 [x, y]，出不了范围
    dragValue: (name, x) => {
      if (!Array.isArray(x) || x.length !== 2 || x.some((t) => typeof t !== 'number' || !Number.isFinite(t))) throw new Error(`${name} 是地面上可以拖的点，要设成 [x, y]`);
      return place2(cmds.find((k) => k.kind === 'let' && k.name === name), x);
    },
  });
  function place2(c, [x, y]) {
    const step = Number(c?.mods.snap) || 0;
    const sn = (t) => (step ? Number((Math.round(t / step) * step).toFixed(10)) : Number(t.toFixed(3)));
    return [Math.max(-R, Math.min(R, sn(x))), Math.max(-R, Math.min(R, sn(y)))];
  }

  // —— 几张平面：互相切开再按远近画（整张半透明的面叠在一起分不出谁在前） ——
  function drawPlanes(v, errs) {
    const list = [];
    cmds.forEach((c, i) => {
      if (c.kind !== 'plane' || !visible(c)) return;
      cur = i + 1;
      try {
        const P = planeOf(c, v);
        const col = color(c, c.eq ? PLANE_COLORS[list.length % PLANE_COLORS.length] : 'var(--v4)');
        const poly = c.eq ? planeInBox(P, boxNow()) : patchCorners(P.p0, P.n, R * (Number(c.mods.size) || 0.9)).poly;
        list.push({ c, i, P, col, poly });
      } catch (e) { errs.push(e.message); }
    });
    cur = null;
    if (!list.length) return;
    // 只有一张、又是老写法：照旧（带网格线的平面片）
    if (list.length === 1 && !list[0].c.eq) {
      const { c, i, P, col } = list[0];
      cur = i + 1;
      const { e1, e2 } = patchCorners(P.p0, P.n, 1);
      patch(P.p0, e1, e2, 'sp-plane', col, R * (Number(c.mods.size) || 0.9));
      cur = null;
      return;
    }
    const pieces = splitAll(list.filter((o) => o.poly).map((o, k) => ({ poly: o.poly, of: k, o })), list.filter((o) => o.poly).map((o) => o.P));
    for (const pc of pieces) { cur = pc.o.i + 1; poly3(pc.poly, 'sp-plane sp-piece', pc.o.col, R * 0.02); }
    for (const o of list) {
      if (!o.poly) continue;
      cur = o.i + 1;
      for (let k = 0; k < o.poly.length; k++) seg3(o.poly[k], o.poly[(k + 1) % o.poly.length], 'sp-plane-edge', o.col);
      const lab = o.c.mods.label ? prettyLabel(o.c.mods.label) : o.c.name ? prettyLabel(o.c.name) : null;
      if (lab) { const top = o.poly.map(proj).reduce((a, b) => (b[1] < a[1] ? b : a)); labels.push({ x: top[0], y: top[1], ux: 0, uy: -1, text: lab, col: o.col, cmd: cur }); }
    }
    cur = null;
  }

  // 一点处的数值偏导（切平面、法向量、切线用；步长跟范围走）
  const H = () => 1e-4 * Math.max(1, R);
  const explicitAt = (S, v, x, y) => { const f = fnXY(S.f, v), h = H(), z = f(x, y); return { p: [x, y, z], fx: (f(x + h, y) - f(x - h, y)) / (2 * h), fy: (f(x, y + h) - f(x, y - h)) / (2 * h) }; };

  function drawCmd(c, v) {
    const lab = c.mods.label ? prettyLabel(c.mods.label) : undefined;
    const col = color(c, 'var(--v1)');
    switch (c.kind) {
      case 'vector': {
        const to = vec3(c.expr(v), 'vector ');
        const from = c.from ? vec3(c.from(v), 'from ') : [0, 0, 0];
        arrow3(from, addv(from, to), col, { label: lab, dashed: !!c.mods.dashed, width: c.mods.thin ? 3.2 : Number(c.mods.width) || 5 });
        // 投影到地面的虚线，帮助判断高度
        if (c.mods.drop) { const tip = addv(from, to); seg3(tip, [tip[0], tip[1], 0], 'guide', col); }
        break;
      }
      case 'point': {
        for (const e of c.exprs) {
          const p = vec3(e(v), 'point ');
          const P = proj(p);
          push(P[2], () => { el('circle', { cx: P[0], cy: P[1], r: 6, class: 'pt' }).style.fill = color(c, 'var(--chalk)'); });
          if (lab) labels.push({ x: P[0], y: P[1], ux: 1, uy: -1, text: lab, col: color(c, 'var(--chalk)'), cmd: cur });
          if (c.mods.drop) seg3(p, [p[0], p[1], 0], 'guide', color(c, 'var(--muted)'));
        }
        break;
      }
      case 'segment': {
        const [a, b] = c.exprs.map((e) => vec3(e(v), 'segment '));
        seg3(a, b, c.mods.dashed ? 'guide' : 'seg', color(c, 'var(--muted)'));
        break;
      }
      case 'line': {
        const p = vec3(c.p(v), 'line '), d = vec3(c.d(v), 'dir ');
        if (len(d) < 1e-9) break;
        const u = mul(R * 1.2, unit(d));
        seg3(sub(p, u), addv(p, u), c.mods.dashed ? 'span-line dashed' : 'span-line', color(c, 'var(--v4)'));
        if (c.name || lab) { const T = proj(addv(p, mul(R * 0.9, unit(d)))); labels.push({ x: T[0], y: T[1], ux: 1, uy: -1, text: lab || prettyLabel(c.name), col: color(c, 'var(--v4)'), cmd: cur }); }
        break;
      }
      case 'span': {
        const vs = c.exprs.map((e) => vec3(e(v), 'span ')).filter((p) => len(p) > 1e-9);
        if (!vs.length) break;
        const e1 = unit(vs[0]);
        const other = vs.slice(1).map((w) => sub(w, mul(dot(w, e1), e1))).find((w) => len(w) > 1e-6);
        if (!other) { const u = mul(R * 1.4, e1); seg3(mul(-1, u), u, 'span-line', color(c, 'var(--v4)')); break; }
        const e2 = unit(other);
        // 三个向量张成整个空间：不画（会挡住一切），在读数里说明
        if (vs.length >= 3 && vs.slice(2).some((w) => Math.abs(dot(w, cross(e1, e2))) > 1e-6)) { labels.push({ x: 14, y: 24, ux: 0, uy: 0, text: '张成整个空间', col: color(c, 'var(--v4)'), fixed: true, cmd: cur }); break; }
        patch([0, 0, 0], e1, e2, 'sp-plane', color(c, 'var(--v4)'));
        break;
      }
      case 'plane': break; // drawPlanes 里一起画了
      case 'box': {
        const [a, b, d] = c.exprs.map((e) => vec3(e(v), 'box '));
        const o = [0, 0, 0];
        const faces = [[o, a, addv(a, b), b], [d, addv(d, a), addv(addv(d, a), b), addv(d, b)], [o, a, addv(a, d), d], [b, addv(b, a), addv(addv(b, a), d), addv(b, d)], [o, b, addv(b, d), d], [a, addv(a, b), addv(addv(a, b), d), addv(a, d)]];
        const fill = color(c, 'var(--yellow)');
        for (const f of faces) {
          const P = f.map(proj);
          push(P.reduce((s, q) => s + q[2], 0) / 4, () => {
            const pg = el('polygon', { points: P.map((q) => `${q[0]},${q[1]}`).join(' '), class: 'sp-face' });
            pg.style.fill = fill;
            pg.style.stroke = fill;
          });
        }
        break;
      }
      case 'quadric': {
        const A = c.A(v), cc = c.c(v);
        if (!Array.isArray(A) || A.length !== 3 || A.some((r) => !Array.isArray(r) || r.length !== 3)) throw new Error('quadric 需要 3×3 的对称矩阵');
        if (!isNum(cc)) throw new Error('quadric 的右边（= 后面）要是一个数');
        const q = quadricLines(A, cc, R);
        const qc = color(c, 'var(--v2)');
        for (const l of q.lines) for (let t = 1; t < l.length; t++) seg3(l[t - 1], l[t], 'sp-quad', qc);
        // 是什么曲面写在左上角（和「张成整个空间」一样）；c.mods.label 可以自己写
        labels.push({ x: 14, y: 24, ux: 0, uy: 0, text: lab || q.kind, col: qc, fixed: true, cmd: cur });
        break;
      }
      case 'grid': {
        // grid M：地面网格（z = 0 平面）在变换 M 下的像
        const M = c.exprs[0](v);
        if (!Array.isArray(M) || M.length !== 3 || M.some((r) => r.length !== 3)) throw new Error('grid 需要 3×3 矩阵');
        const ap = (p) => M.map((r) => r[0] * p[0] + r[1] * p[1] + r[2] * p[2]);
        const n = Math.max(1, Math.round(R / 1.5));
        for (let k = -n; k <= n; k++) {
          seg3(ap([k, -n, 0]), ap([k, n, 0]), `tgrid${k === 0 ? ' tgrid-axis' : ''}`);
          seg3(ap([-n, k, 0]), ap([n, k, 0]), `tgrid${k === 0 ? ' tgrid-axis' : ''}`);
        }
        break;
      }
      case 'text': {
        const P = proj(vec3(c.at(v), 'text '));
        labels.push({ x: P[0], y: P[1], ux: 0, uy: 0, text: c.label, col: color(c, 'var(--chalk)'), cmd: cur });
        break;
      }

      // —— 第 3 批 ——
      case 'meet': {
        const ps = c.names.map((n) => planeOf(find('plane', n), v));
        const mc = color(c, 'var(--yellow)');
        const drawLine = (m) => { const s = lineInBox(m.p, m.d); if (s) { seg3(s[0], s[1], 'sp-meet', mc); return s; } return null; };
        if (ps.length === 2) {
          const m = planeMeet2(ps[0], ps[1]);
          if (!m) notes.push(`${c.names[0]} 和 ${c.names[1]} 平行，没有交线`);
          else if (m.same) notes.push(`${c.names[0]} 和 ${c.names[1]} 重合`);
          else { const s = drawLine(m); if (s && lab) { const T = proj(s[1]); labels.push({ x: T[0], y: T[1], ux: 0, uy: -1, text: lab, col: mc, cmd: cur }); } }
          break;
        }
        const r = planes3(...ps);
        notes.push(`三个平面：${r.text}`);
        if (r.point) { const P = dot3(r.point, mc, 6.5); if (lab) labels.push({ x: P[0], y: P[1], ux: 1, uy: -1, text: lab, col: mc, cmd: cur }); }
        // 两两的交线都画出来（唯一解时三条交于一点；三棱柱时三条平行）
        for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) { const m = planeMeet2(ps[i], ps[j]); if (m && !m.same) drawLine(m); }
        break;
      }
      case 'angle': {
        const objs = c.names.map((n) => { const o = find(['plane', 'line'], n); return o.kind === 'plane' ? { plane: planeOf(o, v) } : { line: lineOf(o, v) }; });
        const ac = color(c, 'var(--pink)');
        // 在哪画、哪两个方向之间的弧
        let at, u1, u2;
        const [a, b] = objs;
        if (a.plane && b.plane) {
          const m = planeMeet2(a.plane, b.plane);
          if (!m || m.same) break;
          const s = lineInBox(m.p, m.d);
          at = s ? mul(0.5, addv(s[0], s[1])) : m.p;
          u1 = unit(cross(a.plane.n, m.d)); u2 = unit(cross(b.plane.n, m.d));
          if (dot(u1, u2) < 0) u2 = mul(-1, u2); // 取锐角
        } else if (a.line && b.line) {
          at = a.line.p; u1 = unit(a.line.d); u2 = unit(b.line.d);
          if (dot(u1, u2) < 0) u2 = mul(-1, u2);
        } else {
          const L = a.line || b.line, P = a.plane || b.plane, n = unit(P.n), d = unit(L.d), dn = dot(d, n);
          if (Math.abs(dn) < 1e-9) break; // 线和面平行：夹角 0，没有弧可画
          at = addv(L.p, mul(dot(n, sub(P.p0, L.p)) / dn, d)); // 线和面的交点
          u1 = dn < 0 ? mul(-1, d) : d;
          const pr = sub(u1, mul(dot(u1, n), n));
          if (len(pr) < 1e-9) break; // 垂直：90°
          u2 = unit(pr);
        }
        const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2)))), w = unit(sub(u2, mul(dot(u1, u2), u1))), rr = R * 0.32;
        if (!(th > 1e-6) || !w.every(Number.isFinite)) break;
        const arc = Array.from({ length: 17 }, (_, k) => { const t = (th * k) / 16; return addv(at, addv(mul(rr * Math.cos(t), u1), mul(rr * Math.sin(t), w))); });
        line3(arc, 'sp-arc', ac, 16);
        seg3(at, addv(at, mul(rr * 1.25, u1)), 'sp-arc-arm', ac); seg3(at, addv(at, mul(rr * 1.25, u2)), 'sp-arc-arm', ac);
        if (lab) { const T = proj(arc[8]); labels.push({ x: T[0], y: T[1], ux: 1, uy: -1, text: lab, col: ac, cmd: cur }); }
        break;
      }
      case 'foot': {
        const A = vec3(c.pt(v), 'foot 的点'), o = find(['plane', 'line'], c.on), fc = color(c, 'var(--yellow)');
        let Fp;
        if (o.kind === 'plane') { const P = planeOf(o, v); Fp = sub(A, mul(dot(P.n, sub(A, P.p0)) / dot(P.n, P.n), P.n)); } else { const L = lineOf(o, v); Fp = addv(L.p, mul(dot(sub(A, L.p), L.d) / dot(L.d, L.d), L.d)); }
        seg3(A, Fp, 'sp-drop', fc);
        dot3(A, fc); const T = dot3(Fp, fc, 4.5);
        if (lab) labels.push({ x: T[0], y: T[1], ux: 1, uy: 1, text: lab, col: fc, cmd: cur });
        break;
      }
      case 'eigen': {
        const A = c.A(v);
        if (!Array.isArray(A) || A.length !== 3 || A.some((r) => !isVec(r) || r.length !== 3)) throw new Error('eigen 需要 3×3 的矩阵');
        const es = eig3(A), cols = ['var(--yellow)', 'var(--pink)', 'var(--green)'];
        const num = (x) => String(Number(x.toFixed(3)));
        es.forEach((e, k) => {
          const ec = c.mods.color ? color(c, cols[k]) : cols[k % 3];
          if (e.vectors.length === 3) { labels.push({ x: 14, y: 24, ux: 0, uy: 0, text: `λ = ${num(e.value)}：整个空间`, col: ec, fixed: true, cmd: cur }); return; }
          if (e.vectors.length === 2) patch([0, 0, 0], e.vectors[0], e.vectors[1], 'sp-plane', ec, R * 0.8);
          else seg3(mul(-R * 1.2, e.vectors[0]), mul(R * 1.2, e.vectors[0]), 'sp-eigen', ec);
          const tip = e.vectors.length === 2 ? addv(mul(R * 0.8, e.vectors[0]), mul(R * 0.8, e.vectors[1])) : mul(R * (e.vectors[0][2] < 0 ? -1 : 1), e.vectors[0]);
          const T = proj(tip);
          labels.push({ x: T[0], y: T[1], ux: 1, uy: -1, text: `λ = ${num(e.value)}`, col: ec, cmd: cur });
        });
        if (es.length < 3 && es.reduce((s, e) => s + e.vectors.length, 0) < 3) notes.push(es.length === 1 && es[0].vectors.length === 1 ? '实的特征方向只有这一个（另外两个特征值是一对共轭复数，或者重根的特征向量不够）' : '线性无关的特征向量不到 3 个：这个矩阵不能相似对角化');
        break;
      }
      case 'surface': {
        const sc = color(c, 'var(--blue)');
        if (c.form === 'eq') {
          const s = geo('eq', () => sliceLines(fnXYZ(c.F, v), boxNow(), { n: 9, grid: coarse ? 22 : 40 }));
          let any = false;
          for (const fam of ['x', 'y', 'z']) for (const sl of s[fam]) for (const l of sl.lines) { any = true; line3(l, fam === 'z' ? 'sp-wire' : 'sp-wire is-faint', sc, 10); }
          if (!any) { const why = whyOf(c.F, { ...v, x: 0.123, y: 0.077, z: 0.211 }); if (why) throw new Error(why); }
          if (lab) labels.push({ x: 14, y: 24, ux: 0, uy: 0, text: lab, col: sc, fixed: true, cmd: cur });
          break;
        }
        const mesh = geo('mesh', () => {
          const N = coarse ? 12 : 24;
          const raw = c.form === 'param' ? meshGrid(paramFn(c, v), ...c.ranges.map((r) => [r[0](v), r[1](v)]), { nu: N, nv: N })
            : meshOver(fnXY(c.f, v), baseOf(c.base, v), c.base?.kind === 'polar' || (c.base?.kind === 'region' && find('region', c.base.of).shape === 'r') ? { n: coarse ? 20 : 36, m: coarse ? 5 : 8 } : { n: N, m: N });
          // 冲出范围很远的格子不画（1/x 这样的面）
          const far = (p) => Math.abs(p[2] - zc) > R * 1.6 || Math.abs(p[0]) > R * 1.6 || Math.abs(p[1]) > R * 1.6;
          return { ...raw, quads: raw.quads.filter((q) => !q.some((k) => far(raw.pts[k]))) };
        });
        if (!mesh.quads.length) { const why = c.form === 'param' ? whyOf(c.p, { ...v, [c.params[0]]: c.ranges[0][0](v) + 0.0123, [c.params[1]]: c.ranges[1][0](v) + 0.0077 }) : whyOf(c.f, { ...v, x: 0.123, y: 0.077 }); if (why) throw new Error(why); }
        mesh3(mesh, sc);
        if (lab) { const p = mesh.pts.find(Boolean); if (p) { const T = proj(p); labels.push({ x: T[0], y: T[1], ux: -1, uy: -1, text: lab, col: sc, cmd: cur }); } }
        break;
      }
      case 'curve': {
        const P = curveFn(c, v), a = c.from(v), b = c.to(v), cc = color(c, 'var(--pink)');
        const pts = geo('curve', () => { const out = []; const n = coarse ? 80 : 240; for (let i = 0; i <= n; i++) { const p = P(a + ((b - a) * i) / n); if (p) out.push(p); } return out; });
        if (pts.length < 2) { const why = whyOf(c.p, { ...v, [c.param]: (a + b) / 2 }); throw new Error(why || 'curve 的式子要是一个点 [x(t), y(t), z(t)]'); }
        line3(pts, 'sp-curve', cc, 6);
        if (lab) { const T = proj(pts[Math.floor(pts.length * 0.8)]); labels.push({ x: T[0], y: T[1], ux: 1, uy: -1, text: lab, col: cc, cmd: cur }); }
        break;
      }
      case 'section': {
        const S = find('surface', c.of), at = c.at(v), sc = color(c, 'var(--yellow)');
        if (S.form === 'param') throw new Error('section 只能截 z = f(x, y) 的曲面和写方程的曲面（参数曲面截不了）');
        const b = boxNow();
        const lines = geo('section', () => {
          if (S.form === 'eq') {
            const F = fnXYZ(S.F, v), n = coarse ? 32 : 64;
            if (c.axis === 'x') return contourLines((y, z) => F(at, y, z), 0, { x0: b.y0, x1: b.y1, y0: b.z0, y1: b.z1 }, { nx: n, ny: n }).map((l) => l.map(([y, z]) => [at, y, z]));
            if (c.axis === 'y') return contourLines((x, z) => F(x, at, z), 0, { x0: b.x0, x1: b.x1, y0: b.z0, y1: b.z1 }, { nx: n, ny: n }).map((l) => l.map(([x, z]) => [x, at, z]));
            return contourLines((x, y) => F(x, y, at), 0, { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 }, { nx: n, ny: n }).map((l) => l.map(([x, y]) => [x, y, at]));
          }
          const f = fnXY(S.f, v), bs = baseOf(S.base, v), inB = (x, y) => baseDepth(bs, x, y) >= -1e-9;
          if (c.axis === 'z') return contourLines((x, y) => (inB(x, y) ? f(x, y) - at : NaN), 0, { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 }, { nx: coarse ? 32 : 64, ny: coarse ? 32 : 64 }).map((l) => l.map(([x, y]) => [x, y, at]));
          // x = a（或 y = b）：沿另一个方向取点，出了底、冲出范围的地方断开
          const out = [];
          let run = [];
          const n = coarse ? 60 : 160;
          for (let i = 0; i <= n; i++) {
            const t = -R + (2 * R * i) / n, [x, y] = c.axis === 'x' ? [at, t] : [t, at], z = inB(x, y) ? f(x, y) : NaN;
            if (Number.isNaN(z) || Math.abs(z - zc) > R * 1.6) { if (run.length > 1) out.push(run); run = []; } else run.push([x, y, z]);
          }
          if (run.length > 1) out.push(run);
          return out;
        });
        // 那张切过来的平面淡淡地画出来
        const cut = planeInBox({ n: c.axis === 'x' ? [1, 0, 0] : c.axis === 'y' ? [0, 1, 0] : [0, 0, 1], p0: c.axis === 'x' ? [at, 0, 0] : c.axis === 'y' ? [0, at, 0] : [0, 0, at] }, b);
        if (cut) poly3(cut, 'sp-cut', sc, R * 0.05);
        for (const l of lines) line3(l, 'sp-section', sc, 6);
        if (lab && lines.length) { const l = lines[0], T = proj(l[Math.floor(l.length / 2)]); labels.push({ x: T[0], y: T[1], ux: 1, uy: -1, text: lab, col: sc, cmd: cur }); }
        break;
      }
      case 'tangent': {
        const S = find(['surface', 'curve'], c.of), tc = color(c, 'var(--yellow)'), at = c.at(v), h = H();
        if (S.kind === 'curve') {
          if (!isNum(at)) throw new Error('tangent 曲线：at 后面是参数的值（一个数）');
          const P = curveFn(S, v), p = P(at), q1 = P(at - h), q2 = P(at + h);
          if (!p || !q1 || !q2) break;
          const d = sub(q2, q1);
          if (len(d) < 1e-12) break; // 那一点速度是零：没有切线方向
          const u = unit(d);
          seg3(sub(p, mul(R * 0.7, u)), addv(p, mul(R * 0.7, u)), 'sp-tangent', tc);
          arrow3(p, addv(p, mul(R * 0.4, u)), tc, { label: lab, width: 3.2 });
          dot3(p, tc);
          // 法平面：过这一点、和切线垂直
          if (c.mods.plane) { const { poly } = patchCorners(p, u, R * 0.45); poly3(poly, 'sp-plane sp-piece', tc, R * 0.02); }
          break;
        }
        let p, n;
        if (S.form === 'z') {
          const [x, y] = vec2(at, 'tangent 的 at '), e = explicitAt(S, v, x, y);
          if (!e.p.every(Number.isFinite) || !Number.isFinite(e.fx + e.fy)) break; // 那一点曲面没定义
          p = e.p; n = [-e.fx, -e.fy, 1];
        } else if (S.form === 'param') {
          const [a, b] = vec2(at, 'tangent 的 at '), P = paramFn(S, v), p0 = P(a, b), pu1 = P(a - h, b), pu2 = P(a + h, b), pv1 = P(a, b - h), pv2 = P(a, b + h);
          if (!p0 || !pu1 || !pu2 || !pv1 || !pv2) break;
          p = p0; n = cross(sub(pu2, pu1), sub(pv2, pv1));
        } else {
          p = vec3(at, 'tangent 写方程的曲面：at 后面是曲面上的点 [x, y, z]，');
          const F = fnXYZ(S.F, v);
          n = [(F(p[0] + h, p[1], p[2]) - F(p[0] - h, p[1], p[2])) / (2 * h), (F(p[0], p[1] + h, p[2]) - F(p[0], p[1] - h, p[2])) / (2 * h), (F(p[0], p[1], p[2] + h) - F(p[0], p[1], p[2] - h)) / (2 * h)];
        }
        if (!n.every(Number.isFinite) || len(n) < 1e-12) break;
        const { poly } = patchCorners(p, n, R * 0.42);
        poly3(poly, 'sp-plane sp-piece sp-tplane', tc, -R * 0.02);
        for (let k = 0; k < 4; k++) seg3(poly[k], poly[(k + 1) % 4], 'sp-plane-edge', tc);
        const nu = unit(n);
        arrow3(p, addv(p, mul(R * 0.35, nu[2] < 0 ? mul(-1, nu) : nu)), tc, { label: lab, width: 3.2 });
        dot3(p, tc);
        break;
      }
      case 'revolve': {
        const f = fn1(c.f, v), a = c.a(v), b = c.b(v), rc = color(c, 'var(--blue)');
        const upTo = c.upto ? Math.max(0, Math.min(2 * Math.PI, c.upto(v))) : 2 * Math.PI;
        const mesh = geo('rev', () => revolveMesh(f, [a, b], c.axis, { n: coarse ? 10 : 20, m: Math.max(2, Math.round(((coarse ? 16 : 32) * upTo) / (2 * Math.PI))), upTo }));
        if (!mesh.quads.length && upTo > 1e-6) { const why = whyOf(c.f, { ...v, x: (a + b) / 2 }); if (why) throw new Error(why); }
        mesh3(mesh, rc);
        // 母线（转之前的那条曲线）和转轴
        const gen = [];
        for (let i = 0; i <= 60; i++) { const x = a + ((b - a) * i) / 60, y = f(x); if (!Number.isNaN(y)) gen.push(c.axis === 'y' ? [x, 0, y] : [x, y, 0]); }
        line3(gen, 'sp-curve', rc, 6);
        if (lab && gen.length) { const T = proj(gen[gen.length - 1]); labels.push({ x: T[0], y: T[1], ux: 1, uy: -1, text: lab, col: rc, cmd: cur }); }
        break;
      }
      case 'disk': case 'shell': {
        const V = find('revolve', c.of), f = fn1(V.f, v), x0 = c.at(v), y0 = f(x0), dc = color(c, 'var(--yellow)');
        if (c.kind === 'disk' && V.axis !== 'x') throw new Error('disk 配绕 x 轴的旋转体（圆盘法）；绕 y 轴的用 shell（柱壳法）');
        if (c.kind === 'shell' && V.axis !== 'y') throw new Error('shell 配绕 y 轴的旋转体（柱壳法）；绕 x 轴的用 disk（圆盘法）');
        if (Number.isNaN(y0)) break; // 那里曲线没定义
        if (c.kind === 'disk') {
          const ring = Array.from({ length: 48 }, (_, k) => { const t = (2 * Math.PI * k) / 48; return [x0, y0 * Math.cos(t), y0 * Math.sin(t)]; });
          poly3(ring, 'sp-slice', dc, -R * 0.01);
          seg3([x0, 0, 0], [x0, y0, 0], 'sp-drop', dc);
        } else mesh3(meshGrid((t, s) => [x0 * Math.cos(t), x0 * Math.sin(t), s * y0], [0, 2 * Math.PI], [0, 1], { nu: 32, nv: 1 }), dc, 'sp-surf sp-shell');
        break;
      }
      case 'region': {
        if (c.mods.hide) break;
        const rc = color(c, 'var(--yellow)');
        const r = geo('region', () => typedRegion(c.shape, fn1(c.lo, v, c.param), fn1(c.hi, v, c.param), c.a(v), c.b(v)));
        if (!r.polys.length) { const why = whyOf(c.lo, { ...v, [c.param]: (c.a(v) + c.b(v)) / 2 }) || whyOf(c.hi, { ...v, [c.param]: (c.a(v) + c.b(v)) / 2 }); if (why) throw new Error(why); }
        for (const pl of r.polys) poly3(pl.map(([x, y]) => [x, y, 0]), 'sp-region', rc, R * 0.4);
        break;
      }
      case 'solid': {
        const sc = color(c, 'var(--blue)');
        if (c.form === 'sph') {
          const s = Object.create(v);
          const rho = (f) => (ph, t) => { s.phi = ph; s[c.tName] = t; try { return safeNum(f(s)); } catch { return NaN; } };
          const lo = rho(c.lo), hi = rho(c.hi), [p0, p1] = c.phi.map((e) => e(v)), [t0, t1] = c.t.map((e) => e(v));
          const sph = (r, ph, t) => [r * Math.sin(ph) * Math.cos(t), r * Math.sin(ph) * Math.sin(t), r * Math.cos(ph)];
          const N = coarse ? 10 : 18;
          const parts = geo('sph', () => {
            const out = [meshGrid((ph, t) => sph(hi(ph, t), ph, t), [p0, p1], [t0, t1], { nu: N, nv: N * 2 })];
            if (lo((p0 + p1) / 2, (t0 + t1) / 2) > 1e-9) out.push(meshGrid((ph, t) => sph(lo(ph, t), ph, t), [p0, p1], [t0, t1], { nu: N, nv: N * 2 }));
            // 两个锥面（φ = 常数）、两个半平面（θ = 常数）
            for (const ph of [p0, p1]) if (ph > 1e-6 && ph < Math.PI - 1e-6) out.push(meshGrid((u, t) => sph(lo(ph, t) + (hi(ph, t) - lo(ph, t)) * u, ph, t), [0, 1], [t0, t1], { nu: 4, nv: N * 2 }));
            if (t1 - t0 < 2 * Math.PI - 1e-6) for (const t of [t0, t1]) out.push(meshGrid((u, ph) => sph(lo(ph, t) + (hi(ph, t) - lo(ph, t)) * u, ph, t), [0, 1], [p0, p1], { nu: 4, nv: N }));
            return out;
          });
          parts.forEach((m) => mesh3(m, sc, 'sp-surf sp-solid'));
          break;
        }
        const bs = baseOf(c.base, v), polar = bs.shape === 'r';
        const s = geo('solid', () => solidBounds(fnXY(c.lo, v), fnXY(c.hi, v), bs, polar ? { n: coarse ? 20 : 36, m: coarse ? 4 : 6 } : { n: coarse ? 10 : 18, m: coarse ? 6 : 10 }));
        if (!s.top.quads.length && !s.bottom.quads.length) { const why = whyOf(c.lo, { ...v, x: 0.123, y: 0.077 }) || whyOf(c.hi, { ...v, x: 0.123, y: 0.077 }); if (why) throw new Error(why); }
        mesh3(s.bottom, sc, 'sp-surf sp-solid'); mesh3(s.top, sc, 'sp-surf sp-solid');
        for (const w of s.walls) seg3(w[0], w[1], 'sp-wall', sc);
        break;
      }
      case 'column': {
        const { p, col: cl } = columnAt(c, v), cc = color(c, 'var(--pink)');
        if (!cl) break; // 点在底的外面：没有这一根（读数写「—」）
        seg3([p[0], p[1], cl.z0], [p[0], p[1], cl.z1], 'sp-column', cc);
        dot3([p[0], p[1], cl.z0], cc, 4.5); dot3([p[0], p[1], cl.z1], cc, 4.5);
        if (Math.abs(cl.z0) > 1e-9) seg3([p[0], p[1], 0], [p[0], p[1], cl.z0], 'guide', cc);
        break;
      }
      case 'slice': {
        const T = find('solid', c.of), z0 = c.at(v), sc = color(c, 'var(--yellow)');
        const lines = geo('slice', () => crossSection(fnXY(T.lo, v), fnXY(T.hi, v), baseOf(T.base, v), z0, { grid: coarse ? 32 : 64 }));
        for (const l of lines) { if (l.length >= 3) poly3(l, 'sp-slice', sc, -R * 0.01); line3(l, 'sp-section', sc, 8); }
        break;
      }
      case 'field': {
        const fc = color(c, 'var(--muted)'), n = Math.max(2, Math.min(6, Math.round(Number(c.mods.n) || 4)));
        const arrows = geo('field', () => fieldArrows3(fnXYZ(c.P, v), fnXYZ(c.Q, v), fnXYZ(c.R, v), { x0: -R * 0.8, x1: R * 0.8, y0: -R * 0.8, y1: R * 0.8, z0: zc - R * 0.8, z1: zc + R * 0.8 }, n));
        if (!arrows.length) { const why = whyOf(c.P, { ...v, x: 0.123, y: 0.077, z: 0.211 }) || whyOf(c.Q, { ...v, x: 0.123, y: 0.077, z: 0.211 }) || whyOf(c.R, { ...v, x: 0.123, y: 0.077, z: 0.211 }); if (why) throw new Error(why); }
        for (const a of arrows) arrow3(a.p, addv(a.p, a.d), fc, { width: 2.4 });
        break;
      }
      case 'normals': {
        const S = find('surface', c.of), nc = color(c, 'var(--yellow)'), n = Math.max(2, Math.min(8, Math.round(Number(c.mods.n) || 4)));
        if (S.form === 'eq') throw new Error('normals 只能画 z = f(x, y) 的曲面和参数曲面上的法向量');
        const h = H();
        const list = geo('normals', () => {
          const out = [];
          if (S.form === 'param') {
            const P = paramFn(S, v), [ua, ub] = [S.ranges[0][0](v), S.ranges[0][1](v)], [va, vb] = [S.ranges[1][0](v), S.ranges[1][1](v)];
            for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
              const a = ua + ((ub - ua) * (i + 0.5)) / n, b = va + ((vb - va) * (j + 0.5)) / n, p = P(a, b), p1 = P(a - h, b), p2 = P(a + h, b), p3 = P(a, b - h), p4 = P(a, b + h);
              if (!p || !p1 || !p2 || !p3 || !p4) continue;
              const nn = cross(sub(p2, p1), sub(p4, p3));
              if (len(nn) > 1e-12) out.push({ p, d: mul(R * 0.22, unit(nn)) });
            }
            return out;
          }
          const m = meshOver(fnXY(S.f, v), baseOf(S.base, v), { n, m: n });
          for (const p of m.pts) { if (!p) continue; const e = explicitAt(S, v, p[0], p[1]); if (Number.isFinite(e.fx + e.fy)) out.push({ p, d: mul(R * 0.22, unit([-e.fx, -e.fy, 1])) }); }
          return out;
        });
        for (const a of list) arrow3(a.p, addv(a.p, a.d), nc, { width: 2.4 });
        break;
      }
      default: break;
    }
  }

  // 地面上能拖的点：把手画在最上面一层；on=S 的再画它在曲面上的像
  function drawHandles(v) {
    cmds.forEach((c, i) => {
      if (c.kind !== 'let' || !c.mods.drag || !visible(c)) return;
      const p = v[c.name];
      if (!isVec(p) || p.length !== 2) return;
      cur = i + 1;
      const hc = color(c, 'var(--yellow)'), G = proj([p[0], p[1], 0]);
      const S = c.mods.on ? find('surface', String(c.mods.on)) : null;
      if (S && S.form === 'z') {
        const z = fnXY(S.f, v)(p[0], p[1]);
        if (!Number.isNaN(z)) { seg3([p[0], p[1], 0], [p[0], p[1], z], 'guide', hc); dot3([p[0], p[1], z], hc, 6); }
      }
      overlay.push({ cmd: cur, fn: () => {
        el('circle', { cx: G[0], cy: G[1], r: 5.5, class: 'pt' }).style.fill = hc;
        el('circle', { cx: G[0], cy: G[1], r: 22, class: 'handle', 'data-handle': c.name, style: `--vc:${hc}` });
      } });
      if (c.mods.label !== 'off') labels.push({ x: G[0], y: G[1], ux: 1, uy: -1, text: c.mods.label || c.name, col: hc, cmd: cur });
    });
    cur = null;
  }
  // 学生在地面上点的点
  function drawPicks(v) {
    for (const i of pickIdx) {
      const st = state.picks.get(i);
      st.pts.forEach((p, k) => {
        const G = proj([p[0], p[1], 0]);
        const cls = st.res ? (st.res.hits.includes(k) ? ' is-hit' : st.res.extra.includes(k) ? ' is-miss' : '') : '';
        overlay.push({ cmd: i + 1, fn: () => el('circle', { cx: G[0], cy: G[1], r: 9, class: `g-pickpt${cls}` }) });
      });
      if (st.done) {
        let ts = [];
        try { ts = cmds[i].targets(v); } catch { ts = []; }
        for (const t of ts) { const G = proj([t[0], t[1], 0]); overlay.push({ cmd: i + 1, fn: () => el('circle', { cx: G[0], cy: G[1], r: 5, class: 'g-dot g-target' }) }); }
      }
    }
  }

  // 标签最后画在最上层，互相避让；写在左上角的几条竖着排
  function placeLabels() {
    const placed = [];
    const wOf = (s) => [...String(s)].reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 26 : 14), 0);
    let fixedY = 0;
    for (const L of labels) {
      const w = wOf(L.text);
      const n = Math.hypot(L.ux, L.uy) || 1;
      const ux = L.ux / n, uy = L.uy / n;
      const cands = L.fixed ? [[L.x + w / 2, L.y + fixedY]] : [[L.x + ux * (14 + w / 2), L.y + uy * 18], [L.x + 16 + w / 2, L.y - 14], [L.x - 16 - w / 2, L.y - 14], [L.x + 16 + w / 2, L.y + 18], [L.x - 16 - w / 2, L.y + 18]];
      if (L.fixed) fixedY += 34;
      const ok = ([x, y]) => x - w / 2 > 2 && x + w / 2 < SIZE - 2 && y > 14 && y < SIZE - 8 && !placed.some((b) => Math.abs(b[0] - x) < (b[2] + w) / 2 + 2 && Math.abs(b[1] - y) < 24);
      const [x, y] = cands.find(ok) || cands[0];
      placed.push([x, y, w]);
      cur = L.cmd ?? null;
      const t = el('text', { x, y, class: L.axis ? 'axis-label' : 'vec-label', 'text-anchor': 'middle', 'dominant-baseline': 'central', style: `--vc:${L.col}` });
      t.textContent = L.text;
    }
  }

  // —— goal：学生拖到、调到了算做到。主讲用 set / play 摆上去的、一画出来就成立的不算（和 graph 一样） ——
  const placedByTeacher = new Set();
  function checkGoals(v, quiet, errs = []) {
    for (const i of goalIdx) {
      const c = cmds[i];
      if (state.goalsHit.has(i) || !visible(c)) continue;
      let ok = false;
      try { ok = c.cond ? !!c.cond(v) : close(c.lhs(v), c.rhs(v), Number(c.mods.tol) || 0.05); } catch (e) { ok = false; if (!goneIn(c.srcLine || '', v)) errs.push(`goal 算不出来：${e?.message || e}`); }
      if (quiet || !ok) { if (quiet && ok) placedByTeacher.add(i); else placedByTeacher.delete(i); continue; }
      if (placedByTeacher.has(i)) continue;
      state.goalsHit.add(i);
      const box = side.querySelector('.goal-msg');
      box.hidden = false;
      box.innerHTML = mdToHtml(c.mods.msg || '做到了！', { inline: true });
      ctl.emit('goal', i, c);
      if (revealed()) setTimeout(() => draw(), 0);
    }
  }

  // —— pick：学生在地面上点出来，页面判 ——
  const plotBox = container.querySelector('.sp-plot');
  const activePick = () => pickIdx.find((i) => !state.picks.get(i).done);
  const fmt = (p) => `(${p.map((x) => Number(x.toFixed(2))).join(', ')})`;
  const tolOf = (c) => c.tol ?? R * 0.12;
  const targetsOf = (c, v0) => {
    try {
      const ts = c.targets(v0 || env());
      for (const t of ts) if (Math.abs(t[0]) > R || Math.abs(t[1]) > R) return new Error(`pick 的目标 ${fmt(t)} 学生点不到（在范围外面）：改 range:，或者改目标`);
      return ts;
    } catch (e) { return e instanceof Error ? e : new Error(String(e)); }
  };
  function syncPicks() {
    const act = activePick();
    for (const i of pickIdx) {
      const c = cmds[i], st = state.picks.get(i), row = plotBox.querySelector(`.g-pick[data-pick="${i}"]`);
      const bad = targetsOf(c) instanceof Error;
      row.classList.toggle('is-done', st.done);
      row.classList.toggle('is-idle', !st.done && i !== act);
      row.querySelector('.g-pick-count').textContent = st.done ? '' : st.pts.length ? `点了 ${st.pts.length} 个` : '在地面（xy 平面）上点出来';
      row.querySelector('.g-pick-check').disabled = st.done || i !== act || bad;
      row.querySelector('.g-pick-clear').hidden = st.done || !st.pts.length;
      row.querySelector('.g-pick-show').hidden = st.done || st.tries < 3;
      const m = row.querySelector('.g-pick-msg');
      m.textContent = bad ? `图形描述有误：${targetsOf(c).message}` : st.msg;
      m.className = `g-pick-msg${bad ? ' is-bad' : st.done && !st.giveup ? ' is-ok' : st.res && !st.res.ok ? ' is-bad' : ''}`;
    }
  }
  function finishPick(i, giveup) {
    const c = cmds[i], st = state.picks.get(i);
    const ts = targetsOf(c);
    st.done = true; st.giveup = giveup;
    if (giveup) st.msg = '答案画在图上了（黄点）';
    ctl.emit('pick', i, { q: c.q, ok: !giveup, done: true, ...(giveup ? { giveup: true, expected: Array.isArray(ts) ? ts.map(fmt).join(', ') : '' } : {}), attempts: st.tries, value: st.pts.map(fmt).join(', '), text: st.msg });
    draw(); syncPicks();
  }
  for (const i of pickIdx) {
    const c = cmds[i], st = state.picks.get(i);
    const row = document.createElement('div');
    row.className = 'g-pick';
    row.dataset.pick = i;
    row.innerHTML = `<div class="g-pick-q">${mdToHtml(c.q, { inline: true })}</div><div class="g-pick-row"><span class="g-pick-count"></span><button type="button" class="btn btn-sm g-pick-clear" hidden>清空</button><button type="button" class="btn btn-primary g-pick-check">检查</button><button type="button" class="btn btn-sm g-pick-show" hidden>看答案</button></div><div class="g-pick-msg"></div>`;
    row.querySelector('.g-pick-clear').addEventListener('click', () => { st.pts = []; st.res = null; st.msg = ''; draw(); syncPicks(); });
    row.querySelector('.g-pick-show').addEventListener('click', () => finishPick(i, true));
    row.querySelector('.g-pick-check').addEventListener('click', () => {
      const ts = targetsOf(c);
      if (ts instanceof Error) return;
      st.tries++;
      st.res = judgePicks(st.pts, ts, tolOf(c));
      st.msg = pickFeedback(st.res);
      if (st.res.ok) { finishPick(i, false); return; }
      ctl.emit('pick', i, { q: c.q, ok: false, done: false, attempts: st.tries, value: st.pts.map(fmt).join(', '), text: st.msg });
      draw(); syncPicks();
    });
    plotBox.appendChild(row);
  }

  // —— 手势：按在把手上是拖点，别处是转视角；没怎么动就松手是「点一下」（pick 收点） ——
  const toView = (e) => { const r = svg.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE]; };
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const name = e.target?.getAttribute?.('data-handle');
    state.spinning = false;
    try { svg.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
    svg.classList.add('dragging');
    e.preventDefault();
    if (name) {
      // 记住手指和点的偏移：点不会一按就跳到指尖
      const c = cmds.find((k) => k.kind === 'let' && k.name === name);
      let cur0; try { cur0 = env()[name]; } catch { cur0 = null; }
      const [sx, sy] = toView(e), g = cur0 ? proj([cur0[0], cur0[1], 0]) : [sx, sy];
      ctl.stop(name);
      drag = { kind: 'point', name, c, id: e.pointerId, ox: g[0] - sx, oy: g[1] - sy, from: cur0, moved: false };
      return;
    }
    drag = { kind: 'view', x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch, id: e.pointerId, moved: 0 };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    if (drag.kind === 'point') {
      const [sx, sy] = toView(e), g = toGround(sx + drag.ox, sy + drag.oy);
      if (!g) return; // 视线快和地面平行：不动（转一下再拖）
      delete state.override[drag.name];
      state.drag[drag.name] = place2(drag.c, g);
      drag.moved = true;
      draw({ moving: true });
      return;
    }
    const r = svg.getBoundingClientRect();
    const k = 360 / Math.max(240, r.width);
    drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
    state.yaw = drag.yaw + (e.clientX - drag.x) * k;
    state.pitch = Math.max(-85, Math.min(85, drag.pitch + (e.clientY - drag.y) * k));
    draw();
  });
  const end = (e) => {
    const d = drag;
    drag = null;
    svg.classList.remove('dragging');
    if (!d || e.type === 'pointercancel') return;
    if (d.kind === 'point') { if (d.moved) { draw(); ctl.emit('dragend', d.name, state.drag[d.name]); } return; }
    // 点一下：有正在收点的 pick 就在地面上加一个点（点在已有的点上是去掉）
    const act = activePick();
    if (d.moved > 6 || act === undefined) return;
    const g = toGround(...toView(e));
    const st = state.picks.get(act);
    if (!g) { st.msg = '视角太平了，地面上点不准：先把图转一下'; syncPicks(); return; }
    if (Math.abs(g[0]) > R || Math.abs(g[1]) > R) return;
    const near = st.pts.findIndex((p) => Math.hypot(p[0] - g[0], p[1] - g[1]) < R * 0.07);
    if (near >= 0) st.pts.splice(near, 1); else st.pts.push([Number(g[0].toFixed(3)), Number(g[1].toFixed(3))]);
    st.res = null; st.msg = '';
    draw(); syncPicks();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  function tween(toYaw, toPitch, dur = 600) {
    const y0 = state.yaw, p0 = state.pitch, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      state.yaw = y0 + (toYaw - y0) * e; state.pitch = p0 + (toPitch - p0) * e;
      draw();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  container.querySelector('.sp-home').addEventListener('click', () => { state.spinning = false; tween(home[0], home[1]); });
  container.querySelector('.sp-spin').addEventListener('click', () => { state.spinning = !state.spinning; if (state.spinning) spin(); });
  function spin() {
    let last = performance.now();
    const step = (now) => {
      if (!state.spinning || !svg.isConnected) return;
      state.yaw += (now - last) * 0.03;
      last = now;
      draw();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // 滑块（行上记下命令序号：highlight 这条 slider 时让这一行闪）
  for (const [i, c] of cmds.entries()) {
    if (c.kind !== 'slider') continue;
    const row = document.createElement('div');
    row.className = 'coef';
    row.dataset.cmd = i + 1;
    row.innerHTML = `${c.mods.play ? '<button type="button" class="btn btn-sm btn-play">▶</button>' : ''}<span class="coef-name">${c.mods.label ? escapeHtml(c.mods.label) : tex2html(c.name)}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.init}" aria-label="${escapeHtml(c.name)}"><output></output>`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    const sync = (moving = false) => { input.value = state.slider[c.name]; out.textContent = sliderText(state.slider[c.name], moving); };
    // 学生自己拖滑块时，停下正在播放的动画；拖着的时候读数写小数，松手再写成分数
    input.addEventListener('input', () => { ctl.stop(c.name); state.slider[c.name] = Number(input.value); sync(true); draw({ moving: heavyGeo }); });
    input.addEventListener('change', () => sync(false));
    row.querySelector('.btn-play')?.addEventListener('click', () => ctl.animate(c.name, c.min, c.max, 1600));
    c.sync = sync;
    sync();
    side.querySelector('.sliders').appendChild(row);
  }
  // 图里有曲面这类算起来要一会儿的东西：拖滑块的那几帧用稀的网格
  const heavyGeo = cmds.some((c) => ['surface', 'revolve', 'solid', 'slice', 'section'].includes(c.kind));

  draw();
  syncPicks();
  if (state.spinning) spin();
  return {
    fields, draw,
    goals: goalIdx.length,
    picks: pickIdx.length,
    get lonelyAfter() { return !hasTasks && cmds.some((c) => c.mods.after || c.mods.before); },
    tasks() { return { goals: `${state.goalsHit.size}/${goalIdx.length}`, picks: pickIdx.map((i) => { const st = state.picks.get(i); return { q: cmds[i].q, picked: st.pts.map(fmt), tries: st.tries, done: st.done, ...(st.giveup ? { giveup: true } : {}) }; }) }; },
    animate: ctl.animate,
    on: ctl.on,
    get view() { return [state.yaw, state.pitch]; },
    setView(yaw, pitch) { state.yaw = yaw; state.pitch = Math.max(-85, Math.min(85, pitch)); draw(); },
    // 范围和「空间的点 → viewBox 坐标」：检查脚本用
    box: () => ({ R, zc }),
    toView: (x, y, z = 0) => proj([x, y, z]).slice(0, 2),
    snapshot() { return ctl.withTargets(() => { try { const v = env(); const o = {}; for (const c of cmds) if (c.kind === 'let' || c.kind === 'slider') o[c.name] = v[c.name]; return o; } catch { return {}; } }); },
    // 课堂操作：set / play / highlight / vars（scene、graph、space 一样）
    set: ctl.set,
    play: ctl.play,
    highlight: ctl.highlight,
    vars: ctl.vars,
    get error() { return lastErr; },
  };
}
