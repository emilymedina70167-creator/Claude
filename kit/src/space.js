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
import { compile, isNum, isVec, numText } from './expr.js';
import { splitMods, splitTop, fillValues } from './scene.js';
import { mdToHtml, tex2html, escapeHtml } from './render.js';
import { figureControls } from './plot.js';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 480;
const CMDS = ['let', 'slider', 'vector', 'point', 'segment', 'line', 'span', 'plane', 'box', 'grid', 'text', 'show'];
const COLOR = {
  blue: 'var(--blue)', pink: 'var(--pink)', yellow: 'var(--yellow)', green: 'var(--green)', purple: 'var(--lav)',
  orange: 'var(--orange)', red: 'var(--coral)', white: 'var(--chalk)', gray: 'var(--muted)', grey: 'var(--muted)',
  1: 'var(--v1)', 2: 'var(--v2)', 3: 'var(--v3)', 4: 'var(--v4)', 5: 'var(--v5)',
};
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const prettyLabel = (s) => String(s).replace(/([A-Za-z])(\d+)$/, (_, a, d) => a + [...d].map((c) => SUB[c]).join(''));

export function parseSpace(src) {
  const fields = {};
  const cmds = [];
  let last = null;
  const re = new RegExp(`^(${CMDS.join('|')})\\s+(.*)$`, 'i');
  for (const raw of String(src).split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const c = line.trim().match(re);
    if (c) { cmds.push(parseCmd(c[1].toLowerCase(), c[2])); last = null; continue; }
    const f = line.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (f) { last = f[1].toLowerCase(); fields[last] = f[2]; continue; }
    if (last) fields[last] += '\n' + line;
    else throw new Error(`看不懂这一行：${line.trim()}`);
  }
  for (const k in fields) fields[k] = fields[k].trim();
  return { fields, cmds };
}

function parseCmd(kind, rest) {
  if (kind === 'show') return { kind, text: rest.trim(), mods: {} };
  if (kind === 'text') {
    const m = rest.match(/^"([^"]*)"\s+at\s+(.*)$/) || rest.match(/^“([^”]*)”\s+at\s+(.*)$/);
    if (!m) throw new Error('text 的写法：text "文字" at [x, y, z]');
    const { body, mods } = splitMods(m[2]);
    return { kind, label: m[1], at: compile(body), mods };
  }
  const { body, mods } = splitMods(rest);
  if (kind === 'let') {
    const m = body.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!m) throw new Error('let 的写法：let 名字 = 表达式');
    return { kind, name: m[1], expr: compile(m[2]), mods };
  }
  if (kind === 'slider') {
    const m = body.match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)(?:\s*=\s*(\S+))?$/);
    if (!m) throw new Error('slider 的写法：slider t 0 1 = 0');
    const min = Number(m[2]), max = Number(m[3]);
    return { kind, name: m[1], min, max, init: m[4] !== undefined ? Number(m[4]) : min, step: Number(mods.step) || (max - min) / 100, mods };
  }
  if (kind === 'vector') {
    const [what, from] = body.split(/\s+from\s+/);
    return { kind, expr: compile(what), from: from ? compile(from) : null, mods };
  }
  if (kind === 'line') {
    const [p, d] = body.split(/\s+dir\s+/);
    if (!d) throw new Error('line 的写法：line 点 dir 方向');
    return { kind, p: compile(p), d: compile(d), mods };
  }
  if (kind === 'plane') {
    const m = body.match(/^normal\s+(.+?)(?:\s+at\s+(.+))?$/);
    if (!m) throw new Error('plane 的写法：plane normal [a, b, c] at [x, y, z]（at 可省略，默认过原点）');
    return { kind, n: compile(m[1]), at: m[2] ? compile(m[2]) : null, mods };
  }
  return { kind, exprs: splitTop(body).map(compile), mods };
}

// —— 三维小工具 ——
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (k, a) => [k * a[0], k * a[1], k * a[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(...a);
const unit = (a) => mul(1 / len(a), a);
const vec3 = (p, what) => { if (!isVec(p) || p.length !== 3) throw new Error(`${what}需要是三维向量`); return p; };

export function createSpace(container, src, opts = {}) {
  const { fields, cmds } = typeof src === 'string' ? parseSpace(src) : src;
  const extra = opts.extraVars || {};
  const state = { slider: {}, drag: {}, override: {}, yaw: -32, pitch: 22, spinning: /^(true|yes|1|是)$/i.test(fields.spin || '') };
  const view = String(fields.view || '').split(/[\s,，]+/).map(Number);
  if (view.length === 2 && view.every(Number.isFinite)) [state.yaw, state.pitch] = view;
  const home = [state.yaw, state.pitch];
  cmds.filter((c) => c.kind === 'slider').forEach((c) => (state.slider[c.name] = c.init));

  container.innerHTML = `<div class="w-plot sp-plot"><div class="sp-tools"><button type="button" class="btn btn-sm sp-home" title="回到开始的视角">正视角</button><button type="button" class="btn btn-sm sp-spin" title="慢慢转一圈">转一转</button></div></div><div class="w-side"><div class="sliders"></div><div class="readout r-show"></div><div class="w-hint">拖动图可以旋转（手指或 Pencil 都行）。</div></div>`;
  const side = container.querySelector('.w-side');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('class', 'plane space');
  container.querySelector('.sp-plot').prepend(svg);

  const env = () => {
    const v = { ...extra, ...state.slider };
    for (const c of cmds) if (c.kind === 'let') v[c.name] = Object.hasOwn(state.override, c.name) ? state.override[c.name] : c.expr(v);
    return v;
  };

  // 范围：没写 range 时按出现的向量自动取
  let R = Number(fields.range) || 0;
  if (!R) {
    let m = 1;
    try {
      const v = env();
      const take = (p) => { if (isVec(p) && p.length === 3) m = Math.max(m, ...p.map(Math.abs)); };
      for (const c of cmds) {
        if (c.kind === 'vector') { const a = c.expr(v); take(a); if (c.from) take(addv(c.from(v), a)); }
        if (c.kind === 'point') c.exprs.forEach((e) => take(e(v)));
        if (c.kind === 'box') take(c.exprs.map((e) => e(v)).reduce(addv));
      }
    } catch { /* 画的时候再报错 */ }
    R = Math.min(10, Math.max(1.5, Math.ceil(m * 2) / 2));
  }
  const K = SIZE / 2 / (R * 1.55);

  // 投影：先绕 z 轴转 yaw，再俯仰 pitch；返回屏幕坐标和深度（越大越远）
  function proj(p) {
    const a = (state.yaw * Math.PI) / 180, b = (state.pitch * Math.PI) / 180;
    const x1 = p[0] * Math.cos(a) - p[1] * Math.sin(a);
    const y1 = p[0] * Math.sin(a) + p[1] * Math.cos(a);
    const up = p[2] * Math.cos(b) + y1 * Math.sin(b);
    const depth = y1 * Math.cos(b) - p[2] * Math.sin(b);
    return [SIZE / 2 + x1 * K, SIZE / 2 - up * K, depth];
  }
  const color = (c, d) => COLOR[String(c.mods.color || '').toLowerCase()] || d;
  const visible = (c) => !(c.mods.from !== undefined && !((extra.step ?? 0) >= Number(c.mods.from))) && !(c.mods.until !== undefined && !((extra.step ?? 0) <= Number(c.mods.until)));
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
  function seg3(a, b, cls, col, extraAttrs = {}) {
    const A = proj(a), B = proj(b);
    push((A[2] + B[2]) / 2, () => { const l = el('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], class: cls, ...extraAttrs }); if (col) l.style.stroke = col; });
  }
  function arrow3(from, to, col, { label, dashed, width = 5 } = {}) {
    const A = proj(from), B = proj(to);
    push(B[2], () => {
      const g = el('g', { class: 'vec', style: `--vc:${col}` });
      const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
      if (L < 1) { el('circle', { cx: B[0], cy: B[1], r: 4, class: 'vec-head' }, g); return; }
      const ux = dx / L, uy = dy / L, h = Math.min(17, L * 0.55);
      const bx = B[0] - ux * h, by = B[1] - uy * h;
      el('line', { x1: A[0], y1: A[1], x2: bx, y2: by, 'stroke-width': width, class: dashed ? 'vec-line dashed' : 'vec-line' }, g);
      el('polygon', { points: `${B[0]},${B[1]} ${bx - uy * h * 0.48},${by + ux * h * 0.48} ${bx + uy * h * 0.48},${by - ux * h * 0.48}`, class: 'vec-head' }, g);
    });
    if (label) labels.push({ x: B[0], y: B[1], ux: B[0] - A[0], uy: B[1] - A[1], text: label, col, cmd: cur });
  }

  function axes() {
    const names = ['x', 'y', 'z'];
    for (let i = 0; i < 3; i++) {
      const e = [0, 0, 0]; e[i] = R;
      seg3(mul(-1, e), e, 'axis sp-axis');
      const T = proj(mul(1.1, e));
      labels.push({ x: T[0], y: T[1], ux: 0, uy: 0, text: names[i], col: 'var(--muted)', axis: true });
    }
    // 地面（z = 0）上的淡网格
    for (let k = -Math.floor(R); k <= R; k++) {
      if (!k) continue;
      seg3([k, -R, 0], [k, R, 0], 'grid');
      seg3([-R, k, 0], [R, k, 0], 'grid');
    }
  }

  let lastErr = '';
  function draw() {
    svg.innerHTML = '';
    items = [];
    labels = [];
    const errs = [];
    let v = null;
    try { v = env(); } catch (e) { errs.push(e.message); }
    cur = null;
    axes();
    if (v) {
      cmds.forEach((c, i) => {
        if (!visible(c)) return;
        cur = i + 1;
        try { drawCmd(c, v); } catch (e) { errs.push(e.message); }
      });
    }
    items.sort((a, b) => b.depth - a.depth).forEach((it) => { cur = it.cmd; it.fn(); });
    placeLabels();
    cur = null;
    if (v) side.querySelector('.r-show').innerHTML = cmds.map((c, i) => (c.kind === 'show' && visible(c) ? `<div data-cmd="${i + 1}">${mdToHtml(fillValues(c.text, v, errs), { inline: true })}</div>` : '')).join('');
    const msg = errs.join('；');
    if (msg !== lastErr) {
      lastErr = msg;
      let box = container.querySelector('.scene-error');
      if (msg) { if (!box) { box = document.createElement('div'); box.className = 'block-error scene-error'; side.appendChild(box); } box.textContent = '图形描述有误：' + msg; } else box?.remove();
    }
    ctl.mark();
  }

  // 课堂操作（play / set / highlight / vars）：见 plot.js 的 figureControls。三维图没有拖动点，不发 dragend
  const ctl = figureControls({ root: container, cmds, state, extra, env, draw: () => draw() });

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
        seg3(sub(p, u), addv(p, u), 'span-line', color(c, 'var(--v4)'));
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
      case 'plane': {
        const n = vec3(c.n(v), 'normal ');
        if (len(n) < 1e-9) throw new Error('法向量不能是零向量');
        const nu = unit(n);
        const a = Math.abs(nu[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const e1 = unit(sub(a, mul(dot(a, nu), nu))), e2 = cross(nu, e1);
        const at = c.at ? vec3(c.at(v), 'at ') : [0, 0, 0];
        patch(at, e1, e2, 'sp-plane', color(c, 'var(--v4)'), R * (Number(c.mods.size) || 0.9));
        break;
      }
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
    }
  }

  // 标签最后画在最上层，互相避让
  function placeLabels() {
    const placed = [];
    const wOf = (s) => [...String(s)].reduce((w, ch) => w + (/[　-鿿]/.test(ch) ? 26 : 14), 0);
    for (const L of labels) {
      const w = wOf(L.text);
      const n = Math.hypot(L.ux, L.uy) || 1;
      const ux = L.ux / n, uy = L.uy / n;
      const cands = L.fixed ? [[L.x + w / 2, L.y]] : [[L.x + ux * (14 + w / 2), L.y + uy * 18], [L.x + 16 + w / 2, L.y - 14], [L.x - 16 - w / 2, L.y - 14], [L.x + 16 + w / 2, L.y + 18], [L.x - 16 - w / 2, L.y + 18]];
      const ok = ([x, y]) => x - w / 2 > 2 && x + w / 2 < SIZE - 2 && y > 14 && y < SIZE - 8 && !placed.some((b) => Math.abs(b[0] - x) < (b[2] + w) / 2 + 2 && Math.abs(b[1] - y) < 24);
      const [x, y] = cands.find(ok) || cands[0];
      placed.push([x, y, w]);
      cur = L.cmd ?? null;
      const t = el('text', { x, y, class: L.axis ? 'axis-label' : 'vec-label', 'text-anchor': 'middle', 'dominant-baseline': 'central', style: `--vc:${L.col}` });
      t.textContent = L.text;
    }
  }

  // —— 旋转 ——
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, yaw: state.yaw, pitch: state.pitch, id: e.pointerId };
    state.spinning = false;
    try { svg.setPointerCapture(e.pointerId); } catch { /* 合成事件 */ }
    svg.classList.add('dragging');
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const k = 360 / Math.max(240, r.width);
    state.yaw = drag.yaw + (e.clientX - drag.x) * k;
    state.pitch = Math.max(-85, Math.min(85, drag.pitch + (e.clientY - drag.y) * k));
    draw();
  });
  const end = () => { drag = null; svg.classList.remove('dragging'); };
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
    const sync = () => { input.value = state.slider[c.name]; out.textContent = numText(Math.round(state.slider[c.name] * 100) / 100); };
    // 学生自己拖滑块时，停下正在播放的动画
    input.addEventListener('input', () => { ctl.stop(c.name); state.slider[c.name] = Number(input.value); sync(); draw(); });
    row.querySelector('.btn-play')?.addEventListener('click', () => ctl.animate(c.name, c.min, c.max, 1600));
    c.sync = sync;
    sync();
    side.querySelector('.sliders').appendChild(row);
  }

  draw();
  if (state.spinning) spin();
  return {
    fields, draw,
    animate: ctl.animate,
    on: ctl.on,
    get view() { return [state.yaw, state.pitch]; },
    snapshot() { return ctl.withTargets(() => { try { const v = env(); const o = {}; for (const c of cmds) if (c.kind === 'let' || c.kind === 'slider') o[c.name] = v[c.name]; return o; } catch { return {}; } }); },
    // 课堂操作：set / play / highlight / vars（scene、graph、space 一样）
    set: ctl.set,
    play: ctl.play,
    highlight: ctl.highlight,
    vars: ctl.vars,
    get error() { return lastErr; },
  };
}
