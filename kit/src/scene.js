// 图形描述语言：Claude 用几行文字描述一张可交互的二维图。
//
//   range: 4
//   let A = [[2, 1], [1, 1]]
//   let x = [1, 2] drag
//   slider t 0 1 = 0 play
//   grid lerp(I, A, t)
//   vector x color=blue label=x
//   vector A*x color=green label=Ax
//   show $A\mathbf x = {A*x}$
//   goal A*x = [3, 2] msg="命中！"
import { compile, isNum, isVec, isMat, valueTeX, numText } from './expr.js';
import { createPlane, snap as snapTo, figureControls, sliderText } from './plot.js';
import { mdToHtml, tex2html, escapeHtml } from './render.js';
import { session } from './session.js';

const COLOR = {
  blue: 'var(--blue)', pink: 'var(--pink)', yellow: 'var(--yellow)', green: 'var(--green)',
  purple: 'var(--lav)', orange: 'var(--orange)', red: 'var(--coral)', white: 'var(--chalk)',
  gray: 'var(--muted)', grey: 'var(--muted)', gold: 'var(--yellow)',
  1: 'var(--v1)', 2: 'var(--v2)', 3: 'var(--v3)', 4: 'var(--v4)', 5: 'var(--v5)',
};
const FLAGS = ['drag', 'dashed', 'faint', 'play', 'after', 'before', 'thin', 'drop'];
const SUB = '₀₁₂₃₄₅₆₇₈₉';

// 把一行末尾的修饰（color=… label="…" drag 等）拆出来
export function splitMods(line) {
  const mods = {};
  let s = line.trim();
  for (;;) {
    let m = s.match(/\s+([a-z]+)=("([^"]*)"|“([^”]*)”|[^\s"“]+)$/i);
    if (m) { mods[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[2]; s = s.slice(0, m.index).trimEnd(); continue; }
    m = s.match(new RegExp(`\\s+(${FLAGS.join('|')})$`, 'i'));
    if (m) { mods[m[1].toLowerCase()] = true; s = s.slice(0, m.index).trimEnd(); continue; }
    return { body: s, mods };
  }
}

// 只在最外层按分隔符切（不切括号里的逗号）
export function splitTop(s, sep = ',') {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

const prettyLabel = (s) => String(s).replace(/([A-Za-z])(\d+)$/, (_, a, d) => a + [...d].map((c) => SUB[c]).join(''));

// 解析整段描述。字段（key: value）和命令分开返回
const ONE_LINE = new Set(['id', 'title', 'link', 'range', 'view', 'answer', 'type', 'tol', 'snap']);

export function parseScene(src) {
  const fields = {};
  const cmds = [];
  let lastField = null;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trimEnd();
    if (!line.trim()) { if (lastField) fields[lastField] += '\n'; continue; }
    const f = line.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (f && !/^(let|vector|point|segment|line|span|grid|area|polygon|text|show|goal|slider|curve|eigen)\b/.test(line)) {
      lastField = f[1].toLowerCase();
      fields[lastField] = f[2];
      continue;
    }
    const c = line.trim().match(/^(let|vector|point|segment|line|span|grid|area|polygon|text|show|goal|slider|curve|eigen)\s+(.*)$/i);
    if (c) { cmds.push({ ...parseCmd(c[1].toLowerCase(), c[2]), srcLine: line.trim() }); lastField = null; continue; }
    // 只有说明类字段（q、note、explain……）可以续行；id、title 这类一行字段后面跟着看不懂的行，多半是命令写错了
    if (lastField && !ONE_LINE.has(lastField)) fields[lastField] += '\n' + line;
    else if (/^\s*-\s*\[[ xX]\]/.test(line)) (fields._options ||= []).push(line);
    else throw new Error(`看不懂这一行：${line.trim()}`);
  }
  for (const k in fields) if (typeof fields[k] === 'string') fields[k] = fields[k].trim();
  return { fields, cmds };
}

function parseCmd(kind, rest) {
  if (kind === 'show') return { kind, text: rest.trim(), mods: {} };
  if (kind === 'text') {
    const m = rest.match(/^"([^"]*)"\s+at\s+(.*)$/) || rest.match(/^“([^”]*)”\s+at\s+(.*)$/);
    if (!m) throw new Error('text 的写法：text "文字" at [x, y]');
    const { body, mods } = splitMods(m[2]);
    return { kind, label: m[1], at: compile(body), mods };
  }
  const { body, mods } = splitMods(rest);
  if (kind === 'let') {
    const m = body.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!m) throw new Error('let 的写法：let 名字 = 表达式');
    return { kind, name: m[1], expr: compile(m[2]), src: m[2], mods };
  }
  if (kind === 'slider') {
    const m = body.match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)(?:\s*=\s*(\S+))?$/);
    if (!m) throw new Error('slider 的写法：slider t 0 1 = 0');
    const min = Number(m[2]), max = Number(m[3]);
    return { kind, name: m[1], min, max, init: m[4] !== undefined ? Number(m[4]) : min, step: Number(mods.step) || (max - min) / 100, mods };
  }
  if (kind === 'goal') {
    const parts = body.split(/(?<![<>=!])=(?!=)/);
    if (parts.length !== 2) throw new Error('goal 的写法：goal 表达式 = 目标');
    return { kind, lhs: compile(parts[0]), rhs: compile(parts[1]), mods };
  }
  if (kind === 'vector') {
    const [what, from] = body.split(/\s+from\s+/);
    return { kind, expr: compile(what), from: from ? compile(from) : null, mods };
  }
  if (kind === 'curve') {
    // curve 表达式 for s 0 360：参数 s 从 0 走到 360（sin、cos 用角度），画出点的轨迹
    const [what, range] = body.split(/\s+for\s+/);
    const m = (range || 's 0 360').trim().match(/^([A-Za-z_]\w*)\s+(\S+)\s+(\S+)$/);
    if (!m) throw new Error('curve 的写法：curve A*[cos(s), sin(s)] for s 0 360');
    return { kind, expr: compile(what), param: m[1], from: compile(m[2]), to: compile(m[3]), mods };
  }
  if (kind === 'line') {
    const [p, d] = body.split(/\s+dir\s+/);
    if (!d) throw new Error('line 的写法：line 点 dir 方向');
    return { kind, p: compile(p), d: compile(d), mods };
  }
  const exprs = splitTop(body).map(compile);
  return { kind, exprs, mods };
}

// 创建场景。opts.extraVars：外部提供的变量（如 predict 里的 t、guess）；
// opts.locked：{ 变量名: 原因 }，课堂 Claude 不能用 set / play 改的变量
export function createScene(container, src, opts = {}) {
  const { fields, cmds } = typeof src === 'string' ? parseScene(src) : src;
  const state = { drag: {}, slider: {}, override: {}, revealed: false, goalsHit: new Set() };
  const extra = opts.extraVars || {};

  container.innerHTML = `<div class="w-plot"></div><div class="w-side"><div class="sliders"></div><div class="readout r-show"></div><div class="goal-msg" hidden></div></div>`;
  const side = container.querySelector('.w-side');
  const plane = createPlane(container.querySelector('.w-plot'), { range: Number(fields.range) || 5 });

  cmds.filter((c) => c.kind === 'slider').forEach((c) => (state.slider[c.name] = c.init));

  // 依次求出所有 let（拖动的点用当前位置）
  function env() {
    const v = { ...extra };
    Object.assign(v, state.slider);
    for (const c of cmds) {
      if (c.kind !== 'let') continue;
      if (Object.hasOwn(state.override, c.name)) v[c.name] = state.override[c.name];
      else if (c.mods.drag && Object.hasOwn(state.drag, c.name)) v[c.name] = state.drag[c.name];
      else {
        v[c.name] = c.expr(v);
        if (c.mods.drag) state.drag[c.name] = v[c.name];
      }
    }
    return v;
  }

  // 课堂操作（play / set / highlight / vars / dragend）：见 plot.js 的 figureControls
  const ctl = figureControls({
    root: container, cmds, state, extra, env, draw: () => draw(), locked: opts.locked,
    dragValue: (name, p) => {
      if (!isVec(p) || p.length !== 2) throw new Error(`${name} 是可以拖的点，要设成二维向量，比如 [1, 2]`);
      return p;
    },
  });

  if (!fields.range) {
    const v = env();
    let m = 2;
    const take = (p) => { if (isVec(p) && p.length === 2) m = Math.max(m, ...p.map(Math.abs)); };
    for (const c of cmds) {
      try {
        if (c.kind === 'vector') { take(c.expr(v)); if (c.from) { const a = c.from(v), b = c.expr(v); take([a[0] + b[0], a[1] + b[1]]); } }
        if (c.kind === 'point') c.exprs.forEach((e) => take(e(v)));
        if (c.kind === 'let' && c.mods.drag) take(v[c.name]);
        if (c.kind === 'goal') take(c.rhs(v));
      } catch { /* 画的时候再报错 */ }
    }
    plane.range = Math.min(10, Math.max(3, Math.ceil(m + 1)));
  }

  // 滑块（行上记下命令序号：highlight 这条 slider 时让这一行闪）
  const sliderBox = side.querySelector('.sliders');
  cmds.forEach((c, i) => {
    if (c.kind !== 'slider') return;
    const row = document.createElement('div');
    row.className = 'coef';
    row.dataset.cmd = i + 1;
    row.innerHTML = `${c.mods.play ? '<button type="button" class="btn btn-sm btn-play">▶</button>' : ''}<span class="coef-name">${c.mods.label ? escapeHtml(c.mods.label) : tex2html(c.name)}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.init}" aria-label="${escapeHtml(c.name)}"><output></output>`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    const sync = (moving = false) => { input.value = state.slider[c.name]; out.textContent = sliderText(state.slider[c.name], moving); };
    // 学生自己拖滑块时，停下正在播放的动画（不然下一帧又被拉回去）；拖着的时候读数写小数，松手再写成分数
    input.addEventListener('input', () => { ctl.stop(c.name); state.slider[c.name] = Number(input.value); out.textContent = sliderText(state.slider[c.name], true); draw(); });
    input.addEventListener('change', () => sync(false));
    row.querySelector('.btn-play')?.addEventListener('click', () => ctl.animate(c.name, c.min, c.max, 1400));
    c.sync = sync;
    sync();
    sliderBox.appendChild(row);
  });

  // after / before：predict 揭晓前后；from=k / until=k：绑定的 steps 揭开到第 k 步起 / 为止
  const visible = (c) => !(c.mods.after && !state.revealed) && !(c.mods.before && state.revealed)
    && !(c.mods.from !== undefined && !((extra.step ?? 0) >= Number(c.mods.from)))
    && !(c.mods.until !== undefined && !((extra.step ?? 0) <= Number(c.mods.until)));
  const color = (c, d = 'var(--v1)') => COLOR[String(c.mods.color || '').toLowerCase()] || d;
  const vec2 = (p, what) => { if (!isVec(p) || p.length !== 2) throw new Error(`${what}需要是二维向量`); return p; };

  let lastError = null;
  function draw() {
    let v;
    plane.clear();
    plane.grid();
    const errors = [];
    try { v = env(); } catch (e) { errors.push(e.message); v = null; }
    if (v) {
      // 画第 i 条命令时 plane.cmd = i + 1：画出的元素带 data-cmd，highlight 靠它找
      cmds.forEach((c, i) => {
        if (!visible(c)) return;
        plane.cmd = i + 1;
        try { drawCmd(c, v); } catch (e) { errors.push(e.message); }
      });
      // 拖动把手（算在 let … drag 那一条命令上）
      cmds.forEach((c, i) => {
        if (c.kind === 'let' && c.mods.drag && visible(c) && !Object.hasOwn(state.override, c.name)) {
          plane.cmd = i + 1;
          try { plane.handle(vec2(v[c.name], c.name), c.name, color(c, 'var(--accent)')); } catch (e) { errors.push(e.message); }
        }
      });
      plane.cmd = null;
      if (opts.afterDraw) opts.afterDraw(plane, v);
      showReadouts(v, errors);
      checkGoals(v, ctl.quiet);
    }
    plane.cmd = null;
    const errText = errors.join('；');
    if (errText !== lastError) {
      lastError = errText;
      let box = container.querySelector('.scene-error');
      if (errText) {
        if (!box) { box = document.createElement('div'); box.className = 'block-error scene-error'; side.appendChild(box); }
        box.textContent = '图形描述有误：' + errText;
      } else box?.remove();
    }
    ctl.mark();
    ctl.emit('change', v);
  }

  function drawCmd(c, v) {
    const lab = c.mods.label ? prettyLabel(c.mods.label) : undefined;
    switch (c.kind) {
      case 'vector': {
        const to = vec2(c.expr(v), 'vector ');
        const from = c.from ? vec2(c.from(v), 'from ') : [0, 0];
        plane.arrow(from, [from[0] + to[0], from[1] + to[1]], color(c), { label: lab, dashed: !!c.mods.dashed, width: c.mods.thin ? 3.2 : Number(c.mods.width) || 5 });
        break;
      }
      case 'point': {
        for (const e of c.exprs) {
          const p = vec2(e(v), 'point ');
          plane.dot(p, 'pt', c.mods.faint ? 4 : 6).style.fill = color(c, 'var(--text)');
          if (lab) {
            const [cx, cy] = plane.placeLabel(plane.X(p[0]), plane.Y(p[1]), 0.6, -0.8, lab);
            const t = plane.text([0, 0], lab, 'plot-text pt-label');
            t.setAttribute('x', cx); t.setAttribute('y', cy); t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
          }
        }
        break;
      }
      case 'segment': {
        const [a, b] = c.exprs.map((e) => vec2(e(v), 'segment '));
        plane.line(a, b, c.mods.dashed ? 'guide' : 'seg').style.stroke = color(c, 'var(--muted)');
        break;
      }
      case 'line': {
        const p = vec2(c.p(v), 'line '), d = vec2(c.d(v), 'dir ');
        const n = Math.hypot(...d);
        if (n < 1e-9) break;
        const R = plane.range * 3 / n;
        plane.line([p[0] - d[0] * R, p[1] - d[1] * R], [p[0] + d[0] * R, p[1] + d[1] * R], c.mods.dashed ? 'span-line dashed' : 'span-line').style.stroke = color(c, 'var(--v4)');
        break;
      }
      case 'span': {
        const vs = c.exprs.map((e) => vec2(e(v), 'span ')).filter((p) => Math.hypot(...p) > 1e-9);
        const R = plane.range * 3;
        const indep = vs.length >= 2 && vs.some((a, i) => vs.some((b, j) => j > i && Math.abs(a[0] * b[1] - a[1] * b[0]) > 1e-9));
        if (indep) plane.poly([[-R, -R], [R, -R], [R, R], [-R, R]], 'span-plane').style.fill = color(c, 'var(--v4)');
        else if (vs.length) {
          const d = vs[0], n = Math.hypot(...d);
          plane.line([-d[0] / n * R, -d[1] / n * R], [d[0] / n * R, d[1] / n * R], 'span-line').style.stroke = color(c, 'var(--v4)');
        }
        break;
      }
      case 'grid': {
        const M = c.exprs[0](v);
        if (!isMat(M) || M.length !== 2 || M[0].length !== 2) throw new Error('grid 需要 2×2 矩阵');
        const ap = ([x, y]) => [M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y];
        const L = Math.ceil(plane.range) * 4;
        for (let k = -L; k <= L; k++) {
          const cls = `tgrid${k === 0 ? ' tgrid-axis' : ''}${c.mods.faint ? ' faint' : ''}`;
          plane.line(ap([k, -L]), ap([k, L]), cls);
          plane.line(ap([-L, k]), ap([L, k]), cls);
        }
        break;
      }
      case 'area': {
        const [a, b] = c.exprs.map((e) => vec2(e(v), 'area '));
        const d = a[0] * b[1] - a[1] * b[0];
        plane.poly([[0, 0], a, [a[0] + b[0], a[1] + b[1]], b], d < 0 ? 'area area-neg' : 'area');
        break;
      }
      case 'polygon': {
        plane.poly(c.exprs.map((e) => vec2(e(v), 'polygon ')), 'area').style.fill = c.mods.color ? color(c) : '';
        break;
      }
      case 'text': {
        plane.text(vec2(c.at(v), 'text '), c.label, 'plot-text');
        break;
      }
      case 'curve': {
        const a = Number(c.from(v)), b = Number(c.to(v));
        const N = Number(c.mods.samples) || 160;
        const pts = [];
        for (let i = 0; i <= N; i++) {
          const p = c.expr({ ...v, [c.param]: a + ((b - a) * i) / N });
          pts.push(vec2(p, 'curve '));
        }
        const el = plane.path(pts, `curve${c.mods.dashed ? ' dashed' : ''}`);
        el.style.stroke = color(c, 'var(--v3)');
        if (c.mods.fill) el.style.fill = color(c, 'var(--v3)');
        if (lab) plane.text(pts[Math.floor(N * 0.12)], lab, 'plot-text curve-label').style.fill = color(c, 'var(--v3)');
        break;
      }
      case 'eigen': {
        // 特征向量方向：画出经过原点的直线，标上特征值
        const M = c.exprs[0](v);
        if (!isMat(M) || M.length !== 2 || M[0].length !== 2) throw new Error('eigen 需要 2×2 矩阵');
        const [[a, b], [cc, d]] = M;
        const tr = a + d, dt = a * d - b * cc, disc = tr * tr - 4 * dt;
        if (disc < -1e-9) { plane.text([-plane.range + 0.3, plane.range - 0.6], '没有实特征向量（会转）', 'plot-text eig-note'); break; }
        const ls = disc < 1e-9 ? [tr / 2] : [(tr + Math.sqrt(disc)) / 2, (tr - Math.sqrt(disc)) / 2];
        const R = plane.range * 3;
        const cols = [color(c, 'var(--lav)'), c.mods.color2 ? COLOR[c.mods.color2] : 'var(--orange)'];
        ls.forEach((l, i) => {
          let e = Math.hypot(b, l - a) > 1e-9 ? [b, l - a] : Math.hypot(l - d, cc) > 1e-9 ? [l - d, cc] : null;
          if (!e) { plane.text([-plane.range + 0.3, plane.range - 0.6], `每个方向都是特征向量（λ=${numText(round(l))}）`, 'plot-text eig-note'); return; }
          const n = Math.hypot(...e);
          e = [e[0] / n, e[1] / n];
          const ln = plane.line([-e[0] * R, -e[1] * R], [e[0] * R, e[1] * R], 'eig-line');
          ln.style.stroke = cols[i];
          const tip = [e[0] * plane.range * 0.78, e[1] * plane.range * 0.78];
          const flip = tip[1] < -plane.range * 0.5 || tip[0] < -plane.range * 0.6 ? -1 : 1;
          const t = plane.text([tip[0] * flip, tip[1] * flip], `λ=${numText(round(l))}`, 'plot-text eig-label');
          t.style.fill = cols[i];
        });
        break;
      }
    }
  }

  // show 行：{表达式} 换成数值（公式里用 TeX，公式外也自动包成公式）
  function showReadouts(v, errors) {
    side.querySelector('.r-show').innerHTML = cmds.map((c, i) => (c.kind === 'show' && visible(c) ? `<div data-cmd="${i + 1}">${mdToHtml(fillValues(c.text, v, errors), { inline: true })}</div>` : '')).join('');
  }

  // 课堂 Claude 用 set / play 摆到目标上的（quiet）不算学生做到：记下来，
  // 之后学生动别的东西时也不算，要学生把它挪开、再自己放回目标上才算
  const placedByTeacher = new Set();
  function checkGoals(v, quiet) {
    cmds.forEach((c, i) => {
      if (c.kind !== 'goal' || state.goalsHit.has(i)) return;
      let ok = false;
      try { ok = close(c.lhs(v), c.rhs(v), Number(c.mods.tol) || 0.05); } catch { ok = false; }
      if (quiet || !ok) {
        if (quiet && ok) placedByTeacher.add(i);
        else placedByTeacher.delete(i);
        return;
      }
      if (!placedByTeacher.has(i)) {
        state.goalsHit.add(i);
        const box = side.querySelector('.goal-msg');
        box.hidden = false;
        box.innerHTML = mdToHtml(c.mods.msg || '做到了！', { inline: true });
        ctl.emit('goal', i, c);
      }
    });
  }

  // 拖把手。按下时记住手指和点的偏移，点跟着手指走、不会一按就跳到指尖；
  // 只点一下（没拖出几像素）不挪点。松手时点真的挪了位置，才发 dragend（课堂 / 实时黑板记成学生的动作）
  let dragFrom = null, grab = [0, 0];
  plane.draggable((name, [x, y], phase, moved) => {
    if (opts.dragTargets && Object.hasOwn(opts.dragTargets, name)) { opts.dragTargets[name]([x, y]); draw(); return; }
    const c = cmds.find((k) => k.kind === 'let' && k.name === name);
    if (!c) return;
    if (phase === 'start') {
      ctl.stop(name);
      dragFrom = valueNow(name);
      grab = isVec(dragFrom) && dragFrom.length === 2 ? [dragFrom[0] - x, dragFrom[1] - y] : [0, 0];
      return;
    }
    if (!moved) { if (phase === 'end') dragFrom = null; return; }
    const step = Number(c.mods.snap) || 0.5;
    state.drag[name] = [snapTo(x + grab[0], step), snapTo(y + grab[1], step)];
    draw();
    if (phase === 'end') {
      const to = state.drag[name];
      if (!close(to, dragFrom)) ctl.emit('dragend', name, [...to]);
      dragFrom = null;
    }
  });
  // 拖动开始时点在哪（动画中途按住也按画面上的位置算）
  function valueNow(name) {
    try { return env()[name]; } catch { return state.drag[name]; }
  }

  plane.drawIn = true;
  draw();
  plane.drawIn = false;
  if (lastError) session.problem(container, opts.kind || 'scene', `图形描述有误：${lastError}`);

  const goals = cmds.filter((c) => c.kind === 'goal').length;
  return {
    fields,
    plane,
    goals,
    draw,
    animate: ctl.animate,
    on: ctl.on,
    reveal() { state.revealed = true; draw(); },
    get revealed() { return state.revealed; },
    // 给助教用：当前变量（取三位小数）
    snapshot() {
      return ctl.withTargets(() => {
        const v = (() => { try { return env(); } catch { return {}; } })();
        const out = {};
        for (const c of cmds) if ((c.kind === 'let' || c.kind === 'slider') && c.name in v) out[c.name] = round(v[c.name]);
        return out;
      });
    },
    // 课堂操作：set / play / highlight / vars（scene、graph、space 一样）
    set: ctl.set,
    play: ctl.play,
    highlight: ctl.highlight,
    vars: ctl.vars,
  };
}

// {表达式} 换成数值：公式里直接放 TeX，公式外自动包成 $…$。
// 前面紧挨着字母、反斜杠、_ ^ } 的大括号属于 TeX（如 \begin{bmatrix}、x_{1}），不当作表达式
export function fillValues(text, v, errors = []) {
  return text.replace(/(?<![\\\w}_^])\{([^{}]+)\}/g, (m, expr, at) => {
    let tex;
    try { tex = valueTeX(compile(expr)(v)); } catch (e) { errors.push(e.message); tex = '?'; }
    const dollars = (text.slice(0, at).match(/(?<!\\)\$/g) || []).length;
    return dollars % 2 ? tex : `$${tex}$`;
  });
}

export function close(a, b, tol = 1e-9) {
  if (isNum(a) && isNum(b)) return Math.abs(a - b) <= tol;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.every((x, i) => close(x, b[i], tol));
  return false;
}
const round = (x) => (Array.isArray(x) ? x.map(round) : Math.round(x * 1000) / 1000);
