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
import { createPlane, snap as snapTo } from './plot.js';
import { mdToHtml, tex2html, escapeHtml } from './render.js';

const COLOR = {
  blue: 'var(--v1)', orange: 'var(--v2)', green: 'var(--v3)', purple: 'var(--v4)', gold: 'var(--v5)',
  red: 'var(--bad)', gray: 'var(--muted)', grey: 'var(--muted)',
  1: 'var(--v1)', 2: 'var(--v2)', 3: 'var(--v3)', 4: 'var(--v4)', 5: 'var(--v5)',
};
const FLAGS = ['drag', 'dashed', 'faint', 'play', 'after', 'before', 'thin'];
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
export function parseScene(src) {
  const fields = {};
  const cmds = [];
  let lastField = null;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+#\s.*$/, '').trimEnd();
    if (!line.trim()) { if (lastField) fields[lastField] += '\n'; continue; }
    const f = line.match(/^([A-Za-z][\w-]*)\s*[:：]\s?(.*)$/);
    if (f && !/^(let|vector|point|segment|line|span|grid|area|polygon|text|show|goal|slider)\b/.test(line)) {
      lastField = f[1].toLowerCase();
      fields[lastField] = f[2];
      continue;
    }
    const c = line.trim().match(/^(let|vector|point|segment|line|span|grid|area|polygon|text|show|goal|slider)\s+(.*)$/i);
    if (c) { cmds.push(parseCmd(c[1].toLowerCase(), c[2])); lastField = null; continue; }
    if (lastField) fields[lastField] += '\n' + line;
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
  if (kind === 'line') {
    const [p, d] = body.split(/\s+dir\s+/);
    if (!d) throw new Error('line 的写法：line 点 dir 方向');
    return { kind, p: compile(p), d: compile(d), mods };
  }
  const exprs = splitTop(body).map(compile);
  return { kind, exprs, mods };
}

// 创建场景。opts.extraVars：外部提供的变量（如 predict 里的 t、guess）
export function createScene(container, src, opts = {}) {
  const { fields, cmds } = typeof src === 'string' ? parseScene(src) : src;
  const state = { drag: {}, slider: {}, override: {}, revealed: false, goalsHit: new Set() };
  const extra = opts.extraVars || {};
  const listeners = { goal: [], change: [] };

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
      if (c.name in state.override) v[c.name] = state.override[c.name];
      else if (c.mods.drag && c.name in state.drag) v[c.name] = state.drag[c.name];
      else {
        v[c.name] = c.expr(v);
        if (c.mods.drag) state.drag[c.name] = v[c.name];
      }
    }
    return v;
  }

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

  // 滑块
  const sliderBox = side.querySelector('.sliders');
  for (const c of cmds.filter((c) => c.kind === 'slider')) {
    const row = document.createElement('div');
    row.className = 'coef';
    row.innerHTML = `${c.mods.play ? '<button type="button" class="btn btn-sm btn-play">▶</button>' : ''}<span class="coef-name">${c.mods.label ? escapeHtml(c.mods.label) : tex2html(c.name)}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.init}" aria-label="${escapeHtml(c.name)}"><output></output>`;
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    const sync = () => { input.value = state.slider[c.name]; out.textContent = numText(Math.round(state.slider[c.name] * 100) / 100); };
    input.addEventListener('input', () => { state.slider[c.name] = Number(input.value); out.textContent = numText(Math.round(state.slider[c.name] * 100) / 100); draw(); });
    row.querySelector('.btn-play')?.addEventListener('click', () => animate(c.name, c.min, c.max, 1400, sync));
    c.sync = sync;
    sync();
    sliderBox.appendChild(row);
  }

  function animate(name, from, to, dur, sync) {
    const start = performance.now();
    return new Promise((done) => {
      const step = (now) => {
        const k = Math.min(1, (now - start) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const val = from + (to - from) * e;
        if (name in state.slider) state.slider[name] = val; else extra[name] = val;
        sync?.();
        draw();
        if (k < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
  }

  const visible = (c) => !(c.mods.after && !state.revealed) && !(c.mods.before && state.revealed);
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
      for (const c of cmds) {
        if (!visible(c)) continue;
        try { drawCmd(c, v); } catch (e) { errors.push(e.message); }
      }
      // 拖动把手
      for (const c of cmds) {
        if (c.kind === 'let' && c.mods.drag && visible(c) && !(c.name in state.override)) {
          plane.handle(vec2(v[c.name], c.name), c.name, color(c, 'var(--accent)'));
        }
      }
      if (opts.afterDraw) opts.afterDraw(plane, v);
      showReadouts(v, errors);
      checkGoals(v);
    }
    const errText = errors.join('；');
    if (errText !== lastError) {
      lastError = errText;
      let box = container.querySelector('.scene-error');
      if (errText) {
        if (!box) { box = document.createElement('div'); box.className = 'block-error scene-error'; side.appendChild(box); }
        box.textContent = '图形描述有误：' + errText;
      } else box?.remove();
    }
    listeners.change.forEach((f) => f(v));
  }

  function drawCmd(c, v) {
    const lab = c.mods.label ? prettyLabel(c.mods.label) : undefined;
    switch (c.kind) {
      case 'vector': {
        const to = vec2(c.expr(v), 'vector ');
        const from = c.from ? vec2(c.from(v), 'from ') : [0, 0];
        plane.arrow(from, [from[0] + to[0], from[1] + to[1]], color(c), { label: lab, dashed: !!c.mods.dashed, width: c.mods.thin ? 2 : Number(c.mods.width) || 3.5 });
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
        plane.line([p[0] - d[0] * R, p[1] - d[1] * R], [p[0] + d[0] * R, p[1] + d[1] * R], 'span-line').style.stroke = color(c, 'var(--v4)');
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
    }
  }

  // show 行：{表达式} 换成数值（公式里用 TeX，公式外也自动包成公式）
  function showReadouts(v, errors) {
    const lines = cmds.filter((c) => c.kind === 'show' && visible(c));
    side.querySelector('.r-show').innerHTML = lines.map((c) => `<div>${mdToHtml(fillValues(c.text, v, errors), { inline: true })}</div>`).join('');
  }

  function checkGoals(v) {
    cmds.forEach((c, i) => {
      if (c.kind !== 'goal' || state.goalsHit.has(i)) return;
      let ok = false;
      try { ok = close(c.lhs(v), c.rhs(v), Number(c.mods.tol) || 0.05); } catch { ok = false; }
      if (ok) {
        state.goalsHit.add(i);
        const box = side.querySelector('.goal-msg');
        box.hidden = false;
        box.innerHTML = mdToHtml(c.mods.msg || '做到了！', { inline: true });
        listeners.goal.forEach((f) => f(i, c));
      }
    });
  }

  plane.draggable((name, [x, y]) => {
    const c = cmds.find((k) => k.kind === 'let' && k.name === name);
    const step = Number(c?.mods.snap) || 0.5;
    if (name in (opts.dragTargets || {})) opts.dragTargets[name]([x, y]);
    else state.drag[name] = [snapTo(x, step), snapTo(y, step)];
    draw();
  });

  draw();

  const goals = cmds.filter((c) => c.kind === 'goal').length;
  return {
    fields,
    plane,
    goals,
    draw,
    animate,
    on(ev, f) { listeners[ev].push(f); },
    reveal() { state.revealed = true; draw(); },
    get revealed() { return state.revealed; },
    // 给助教用：当前变量
    snapshot() {
      const v = (() => { try { return env(); } catch { return {}; } })();
      const out = {};
      for (const c of cmds) if ((c.kind === 'let' || c.kind === 'slider') && c.name in v) out[c.name] = round(v[c.name]);
      return out;
    },
    set(name, value) {
      const c = cmds.find((k) => (k.kind === 'let' || k.kind === 'slider') && k.name === name);
      if (!c) throw new Error(`图里没有变量 ${name}`);
      if (c.kind === 'slider') { state.slider[name] = Number(value); c.sync?.(); }
      else if (c.mods.drag) state.drag[name] = value;
      else state.override[name] = value;
      draw();
    },
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
