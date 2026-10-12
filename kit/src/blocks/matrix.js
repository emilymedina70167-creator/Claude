// matrix：会动的矩阵。几个矩阵、公式排成一行；变量（滑块、figure set / play、绑定的 steps）变了，
// 值变了的格子闪一下，挪了位置的数飞过去；可以分块、带标注、点乘积里的数看它怎么算出来。
// 写法和计算在 matrixspec.js（纯函数）；标注在 marks.js。
import { parseMatrix, matrixEnv, matrixItems, floatEnv, snapSlider, flights, changedCells, checkMark } from '../matrixspec.js';
import { session } from '../session.js';
import { link } from '../link.js';
import { widget, mdToHtml, tex2html, escapeHtml, withCalcScope, calcProblems } from './common.js';
import { figureControls, sliderText, round2 } from '../plot.js';
import { markLayer } from '../marks.js';
import { letScope } from '../exact.js';

const reduceMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const FLY_MS = 560;

export function matrix(el, src) {
  const { fields, cmds } = parseMatrix(src);
  const titleText = fields.title || '';
  const body = widget(el, { title: null, cls: 'matrix-w' });
  // 题面、备注里的 \calc：组件自己的 let（初始值）+ 整节课的量
  const scope = letScope(cmds, session.vars);
  for (const msg of calcProblems([fields.title, fields.q, fields.note], scope)) session.problem(el, 'matrix', msg);
  const md = (t, o) => withCalcScope(scope, () => mdToHtml(t, o));
  if (titleText) el.querySelector('.widget').insertAdjacentHTML('afterbegin', `<div class="w-title">${md(titleText, { inline: true })}</div>`);
  body.innerHTML = `${fields.q ? `<div class="w-q">${md(fields.q)}</div>` : ''}
    <div class="mxw-body"><div class="mxw-row"></div></div>
    <div class="readout mxw-calc" hidden></div>
    <div class="sliders"></div>
    ${fields.note ? `<div class="w-note">${md(fields.note)}</div>` : ''}`;
  const host = body.querySelector('.mxw-body');
  const row = body.querySelector('.mxw-row');
  const calcBox = body.querySelector('.mxw-calc');

  // link: 某个 steps 的 id → 表达式里可以用 step（已揭开的步数）和 t
  const linkId = fields.link;
  const extra = linkId ? { step: link(linkId).step, t: 1 } : {};
  const state = { slider: {}, override: {} };
  cmds.filter((c) => c.kind === 'slider').forEach((c) => (state.slider[c.name] = c.init));

  const exactEnv = () => matrixEnv(cmds, { base: session.vars, extra, slider: state.slider, override: state.override });
  const ctl = figureControls({ root: el, cmds, state, extra, env: () => floatEnv(exactEnv().vars), draw: () => draw() });

  // 滑块：按 step 取整（B^k 这类整数次幂一格一格地变）
  const sliderBox = body.querySelector('.sliders');
  cmds.forEach((c, i) => {
    if (c.kind !== 'slider') return;
    const r = document.createElement('div');
    r.className = 'coef';
    r.dataset.cmd = i + 1;
    r.innerHTML = `${c.mods.play ? '<button type="button" class="btn btn-sm btn-play" aria-label="播放">▶</button>' : ''}<span class="coef-name">${c.mods.label ? escapeHtml(c.mods.label) : tex2html(c.name)}</span><input type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.init}" aria-label="${escapeHtml(c.name)}"><output></output>`;
    const input = r.querySelector('input');
    const out = r.querySelector('output');
    const sync = (moving = false) => { const v = snapSlider(c, state.slider[c.name]); input.value = v; out.textContent = sliderText(v, moving && c.step < 1); };
    input.addEventListener('input', () => { ctl.stop(c.name); state.slider[c.name] = snapSlider(c, input.value); sync(); draw(); });
    // 松手：记成学生的动作（课堂刷新后按它恢复，也跟着下一条消息告诉课堂 Claude）
    input.addEventListener('change', () => session.event('drag', el, { name: c.name, value: round2(state.slider[c.name]) }));
    r.querySelector('.btn-play')?.addEventListener('click', () => ctl.animate(c.name, c.min, c.max, Math.min(6000, Math.max(1200, ((c.max - c.min) / c.step) * 700))));
    c.sync = sync;
    sync();
    sliderBox.appendChild(r);
  });

  // —— 画 ——
  const nodes = new Map(); // 命令序号 → { kind, el, cells?, label?, tex? }
  let ghosts = [];
  let lastErr = '';
  let first = true;
  const layer = markLayer(host);
  const shownMarks = new Map(); // 命令序号 → spec

  function draw() {
    const { vars, errors: envErr } = exactEnv();
    const { items, marks, errors } = matrixItems(cmds, vars);
    const allErr = [...envErr, ...errors];
    const animate = !first && !reduceMotion();
    // 动画中途又变了（播放得快）：上一批飞行的数直接落地
    ghosts.forEach((g) => g.finish());
    ghosts = [];
    const keys = items.map((x) => `${x.cmd}:${x.kind}`).join('|');
    if (keys !== row.dataset.keys) {
      row.dataset.keys = keys;
      const keep = new Map(nodes);
      nodes.clear();
      row.replaceChildren(...items.map((it) => {
        const old = keep.get(it.cmd);
        const n = old && old.kind === it.kind ? old : build(it, animate);
        nodes.set(it.cmd, n);
        return n.el;
      }));
    }
    const moves = [];
    for (const it of items) update(nodes.get(it.cmd), it, animate, moves);
    if (moves.length) fly(moves);
    // 组件里的 mark：跟着 step 出现、消失；对不上矩阵的报出来
    const markErr = [];
    const want = new Map(marks.map((m) => [m.cmd, m.spec]));
    for (const [cmd] of shownMarks) if (!want.has(cmd)) { layer.remove(`c${cmd}`); shownMarks.delete(cmd); }
    for (const [cmd, spec] of want) {
      const bad = checkMark(spec, items);
      if (bad) { markErr.push(`第 ${cmd} 条（mark）：${bad}`); continue; }
      if (shownMarks.get(cmd) === spec) continue;
      const r = layer.add(`c${cmd}`, spec, { root: host, name: '这个矩阵', animate: !first });
      if (r.ok) shownMarks.set(cmd, spec);
      else markErr.push(`第 ${cmd} 条（mark）：${r.error}`);
    }
    layer.relayout();
    const errText = [...allErr, ...markErr].join('；');
    if (errText !== lastErr) {
      lastErr = errText;
      let box = body.querySelector('.mxw-error');
      if (errText) {
        if (!box) { box = document.createElement('div'); box.className = 'block-error mxw-error'; host.after(box); }
        box.textContent = `矩阵写法有误：${errText}`;
      } else box?.remove();
    }
    if (first && errText) session.problem(el, 'matrix', `矩阵写法有误：${errText}`);
    first = false;
    ctl.mark();
    ctl.emit('change', vars);
  }

  function build(it, animate) {
    const n = { kind: it.kind, el: document.createElement('div') };
    n.el.className = `mxw-item mxw-${it.kind}${animate ? ' mxw-enter' : ''}`;
    n.el.dataset.cmd = it.cmd;
    if (it.kind === 'tex') return n;
    if (it.kind === 'product') {
      n.el.innerHTML = `<span class="mxw-slot" data-k="0"></span><span class="mxw-op">${tex2html('\\times')}</span><span class="mxw-slot" data-k="1"></span><span class="mxw-op">${tex2html('=')}</span><span class="mxw-slot" data-k="2"></span>`;
      n.parts = [0, 1, 2].map((k) => ({ slot: n.el.querySelector(`.mxw-slot[data-k="${k}"]`), cells: null }));
      n.el.addEventListener('click', (e) => {
        const td = e.target.closest('.mxw-slot[data-k="2"] td[data-i]');
        if (td) pick(n, +td.dataset.i, +td.dataset.j);
      });
      return n;
    }
    n.el.innerHTML = '<span class="mxw-label" hidden></span><span class="mxw-val"></span>';
    return n;
  }

  function update(n, it, animate, moves) {
    if (it.kind === 'tex') {
      if (n.tex !== it.tex) { n.tex = it.tex; n.el.innerHTML = tex2html(it.tex); }
      return;
    }
    if (it.kind === 'product') {
      [it.A, it.B, it.C].forEach((m, k) => {
        const p = n.parts[k];
        const label = it.names[k];
        setTable(p, p.slot, m.cells, 'matrix', { name: label, split: { rows: [], cols: [] }, clickable: k === 2 }, animate, moves);
      });
      n.terms = it.terms;
      n.names = it.names;
      if (n.pick) pick(n, n.pick[0], n.pick[1]);
      return;
    }
    const lab = n.el.querySelector('.mxw-label');
    if (n.label !== it.label) {
      n.label = it.label;
      lab.hidden = it.label === undefined;
      lab.innerHTML = it.label !== undefined ? tex2html(it.label) : '';
    }
    setTable(n, n.el.querySelector('.mxw-val'), it.cells, it.shape, { name: it.name, split: it.split }, animate, moves);
  }

  // 一个矩阵的格子：形状没变就逐格改（变了的闪、挪了的飞）；形状变了整张重画
  function setTable(n, slot, cells, shape, { name, split, clickable = false }, animate, moves) {
    const sig = `${shape}:${cells.length}x${cells[0].length}:${split.rows.join(',')}/${split.cols.join(',')}:${name || ''}`;
    if (n.sig !== sig) {
      n.sig = sig;
      n.cells = cells;
      if (shape === 'number') {
        slot.innerHTML = `<span class="mxw-num">${tex2html(cells[0][0])}</span>`;
        return;
      }
      const rs = new Set(split.rows), cs = new Set(split.cols);
      slot.innerHTML = `<table class="mx mxw-mx${clickable ? ' mx-click' : ''}" data-mx${name ? ` data-mxname="${escapeHtml(name)}"` : ''}${split.rows.length ? ` data-rsplit="${split.rows.join(',')}"` : ''}${split.cols.length ? ` data-csplit="${split.cols.join(',')}"` : ''}><tbody>${cells.map((r, i) => `<tr>${r.map((v, j) => `<td data-i="${i}" data-j="${j}" class="${[rs.has(i + 1) ? 'mxw-rs' : '', cs.has(j + 1) ? 'mxw-cs' : ''].join(' ').trim()}"><span>${tex2html(v)}</span></td>`).join('')}</tr>`).join('')}</tbody></table>`;
      return;
    }
    const old = n.cells;
    n.cells = cells;
    if (shape === 'number') {
      if (old[0][0] !== cells[0][0]) {
        const s = slot.querySelector('.mxw-num');
        s.innerHTML = tex2html(cells[0][0]);
        if (animate) restart(s, 'mxw-flash');
      }
      return;
    }
    const changed = changedCells(old, cells);
    if (!changed.length) return;
    const td = (i, j) => slot.querySelector(`td[data-i="${i}"][data-j="${j}"]`);
    const fl = animate ? flights(old, cells) : [];
    // 先量出要飞的数原来在哪（改格子之前）
    for (const f of fl) {
      const src = td(...f.from);
      if (src) moves.push({ html: src.innerHTML, from: src.getBoundingClientRect(), to: () => td(...f.to) });
    }
    const landing = new Set(fl.map((f) => `${f.to[0]},${f.to[1]}`));
    for (const [i, j] of changed) {
      const c = td(i, j);
      if (!c) continue;
      c.innerHTML = `<span>${tex2html(cells[i][j])}</span>`;
      if (animate && !landing.has(`${i},${j}`)) restart(c, 'mxw-flash');
    }
  }

  // 挪了位置的数：从原来的格子飞到新格子（新格子里的数先藏着，落地再出现）
  function fly(moves) {
    const hb = host.getBoundingClientRect();
    const k = host.offsetWidth ? hb.width / host.offsetWidth : 1;
    for (const m of moves) {
      const dst = m.to();
      if (!dst || !m.from.width) continue;
      const to = dst.getBoundingClientRect();
      const g = document.createElement('div');
      g.className = 'mxw-ghost';
      g.innerHTML = m.html;
      Object.assign(g.style, { left: `${(m.from.left - hb.left) / k}px`, top: `${(m.from.top - hb.top) / k}px`, width: `${m.from.width / k}px`, height: `${m.from.height / k}px` });
      host.appendChild(g);
      dst.classList.add('mxw-await');
      const dx = (to.left - m.from.left) / k, dy = (to.top - m.from.top) / k;
      const a = g.animate([{ transform: 'translate(0, 0) scale(1)' }, { transform: `translate(${dx / 2}px, ${dy / 2 - 14}px) scale(1.25)`, offset: 0.5 }, { transform: `translate(${dx}px, ${dy}px) scale(1)` }], { duration: FLY_MS, easing: 'cubic-bezier(.35,.1,.25,1)' });
      const land = () => { g.remove(); dst.classList.remove('mxw-await'); restart(dst, 'mxw-land'); };
      a.onfinish = land;
      a.oncancel = land;
      ghosts.push(a);
    }
  }

  function restart(e, cls) {
    e.classList.remove(cls);
    void e.offsetWidth;
    e.classList.add(cls);
  }

  // 点乘积里的一个数：A 的那一行、B 的那一列亮起来，下面写出对应相乘再相加
  function pick(n, i, j) {
    const [ta, tb, tc] = n.parts.map((p) => p.slot.querySelector('table'));
    if (!ta || !tb || !tc || !tc.querySelector(`td[data-i="${i}"][data-j="${j}"]`)) { n.pick = null; calcBox.hidden = true; return; }
    n.pick = [i, j];
    ta.querySelectorAll('tr').forEach((tr, r) => tr.classList.toggle('hl', r === i));
    tb.querySelectorAll('td').forEach((td) => td.classList.toggle('hl-col', +td.dataset.j === j));
    tc.querySelectorAll('td').forEach((td) => td.classList.toggle('hl-cell', +td.dataset.i === i && +td.dataset.j === j));
    const terms = n.terms(i, j);
    const paren = (t) => (/^-|\\tfrac/.test(t) ? `\\left(${t}\\right)` : t);
    const sum = terms.map(([a, b]) => `${paren(a)}\\cdot ${paren(b)}`).join(' + ');
    const name = n.names[2].length === 1 ? n.names[2] : `(${n.names[2]})`;
    calcBox.hidden = false;
    calcBox.innerHTML = tex2html(`${name}_{${i + 1}${j + 1}} = \\text{第 ${i + 1} 行} \\cdot \\text{第 ${j + 1} 列} = ${sum} = ${n.parts[2].cells[i][j]}`, true);
  }

  if (linkId) {
    el.dataset.link = linkId;
    link(linkId).on((s) => {
      extra.step = s;
      extra.t = 0;
      draw();
      ctl.animate('t', 0, 1, 800);
    });
  }

  draw();
  if (cmds.some((c) => c.kind === 'product') && !calcBox.textContent) {
    host.insertAdjacentHTML('afterend', '<div class="w-hint">点乘积里的任意一个数，看它是哪一行乘哪一列。</div>');
  }

  // 课堂：figure target=… set / play / highlight；板书标注跟着 change 重新摆
  const api = {
    draw,
    on: ctl.on,
    animate: ctl.animate,
    play: ctl.play,
    highlight: ctl.highlight,
    vars: ctl.vars,
    snapshot: ctl.vars,
    // 矩阵不补间：直接换成新值（变了的格子闪、挪了的数飞）。换了以后算不出来（比如尺寸不对），退回原来的值并报错
    set(name, value) {
      const before = lastErr;
      const slot = Object.hasOwn(state.override, name) ? ['override', state.override[name]] : Object.hasOwn(state.slider, name) ? ['slider', state.slider[name]] : null;
      const p = ctl.set(name, value, { ms: 0 });
      if (lastErr && lastErr !== before) {
        const err = lastErr;
        if (slot) state[slot[0]][name] = slot[1]; else delete state.override[name];
        cmds.find((c) => c.kind === 'slider' && c.name === name)?.sync?.();
        draw();
        throw new Error(`${name} 换成这个值以后算不出来：${err}`);
      }
      return p;
    },
  };
  const id = session.registerScene(el, api, titleText || '矩阵');
  el.dataset.scene = id;
}
