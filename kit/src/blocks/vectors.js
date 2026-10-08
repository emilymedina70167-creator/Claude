// 二维向量：可拖动；mode = plot | sum | combo | span
import { parseFields } from '../parse.js';
import { parseArray, toNum, fmt } from '../linalg.js';
import { createPlane, snap, COLORS } from '../plot.js';
import { widget, tex2html, mdToHtml } from './common.js';

const RESERVED = new Set(['mode', 'title', 'target', 'range', 'note', 'a', 'b', 'snap']);

export function vectors(el, src) {
  const { fields } = parseFields(src);
  const names = Object.keys(fields).filter((k) => !RESERVED.has(k));
  const vecs = names.map((n) => toNum(parseArray(fields[n])));
  if (!vecs.length) throw new Error('至少写一个向量，例如 u: [2, 1]');
  vecs.forEach((v, i) => { if (v.length !== 2) throw new Error(`${names[i]} 需要是二维向量`); });
  const mode = (fields.mode || (vecs.length >= 2 ? 'sum' : 'plot')).toLowerCase();
  const target = fields.target ? toNum(parseArray(fields.target)) : null;
  const step = Number(fields.snap) || 0.5;
  let a = fields.a !== undefined ? Number(fields.a) : 1;
  let b = fields.b !== undefined ? Number(fields.b) : 1;

  const titles = { sum: '向量加法 Vector Addition', combo: '线性组合 Linear Combination', span: '张成空间 Span', plot: '向量 Vectors' };
  const body = widget(el, { title: fields.title || titles[mode] || titles.plot });
  body.innerHTML = `
    <div class="w-plot"></div>
    <div class="w-side">
      ${mode === 'combo' ? `
        <label class="coef"><span class="coef-name">${tex2html('a')}</span><input type="range" min="-3" max="3" step="0.1" class="sa"><output class="oa"></output></label>
        <label class="coef"><span class="coef-name">${tex2html('b')}</span><input type="range" min="-3" max="3" step="0.1" class="sb"><output class="ob"></output></label>` : ''}
      <div class="readout r-info"></div>
      ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}
      <div class="w-hint">拖动箭头末端的圆点可以改变向量。</div>
    </div>`;

  const plane = createPlane(body.querySelector('.w-plot'), { range: Number(fields.range) || autoRange() });
  const sa = body.querySelector('.sa'), sb = body.querySelector('.sb');
  const vname = (i) => `\\mathbf{${names[i]}}`;
  const vtex = ([x, y]) => `\\begin{bmatrix}${fmt(x)}\\\\${fmt(y)}\\end{bmatrix}`;

  function autoRange() {
    let m = Math.max(...vecs.flat().map(Math.abs));
    if (vecs.length >= 2) m = Math.max(m, Math.abs(vecs[0][0] + vecs[1][0]), Math.abs(vecs[0][1] + vecs[1][1]));
    if (target) m = Math.max(m, ...target.map(Math.abs));
    if (mode === 'combo') m *= 1.3;
    return Math.min(10, Math.max(3, Math.ceil(m + 1)));
  }

  function draw() {
    plane.clear();
    plane.grid();
    const [u, v] = vecs;
    let info = '';
    if (mode === 'span') {
      const R = plane.range * 3;
      const indep = v && Math.abs(u[0] * v[1] - u[1] * v[0]) > 1e-9;
      if (indep) {
        plane.poly([[-R, -R], [R, -R], [R, R], [-R, R]], 'span-plane');
        info = `<div>${tex2html(`\\operatorname{span}\\{${vname(0)}, ${vname(1)}\\} = \\mathbb{R}^2`)}</div><div class="muted">两个向量不共线（线性无关），能组合出平面上任何一点。</div>`;
      } else {
        const d = Math.hypot(...u) > 1e-9 ? u : v || [0, 0];
        if (Math.hypot(...d) > 1e-9) plane.line([-d[0] * R, -d[1] * R], [d[0] * R, d[1] * R], 'span-line');
        info = Math.hypot(...d) < 1e-9
          ? `<div class="muted">零向量的 span 只有原点。</div>`
          : `<div>${tex2html(`\\operatorname{span}\\{${names.map((_, i) => vname(i)).join(', ')}\\}`)} 是一条过原点的直线</div>${v ? '<div class="muted">两个向量共线（线性相关），只能张成一条线。</div>' : ''}`;
      }
    }
    if (mode === 'sum' && v) {
      const s = [u[0] + v[0], u[1] + v[1]];
      plane.line(u, s, 'guide');
      plane.line(v, s, 'guide');
      plane.arrow([0, 0], s, 'var(--v3)', { label: `${names[0]}+${names[1]}` });
      info = `<div>${tex2html(`${vname(0)} + ${vname(1)} = ${vtex(u)} + ${vtex(v)} = ${vtex(s)}`, true)}</div>`;
    }
    if (mode === 'combo' && v) {
      const au = [a * u[0], a * u[1]];
      const s = [au[0] + b * v[0], au[1] + b * v[1]];
      if (target) {
        plane.dot(target, 'target', 9);
        plane.text([target[0] + 0.25, target[1] + 0.25], '目标', 'plot-text target-label');
      }
      plane.arrow([0, 0], au, 'var(--v1)', { label: `${fmt(a)}${names[0]}`, width: 3, dashed: true });
      plane.arrow(au, s, 'var(--v2)', { label: `${fmt(b)}${names[1]}`, width: 3, dashed: true });
      plane.arrow([0, 0], s, 'var(--v3)', { width: 4.5 });
      info = `<div>${tex2html(`${fmt(a)}${vname(0)} + ${fmt(b)}${vname(1)} = ${vtex(s)}`, true)}</div>`;
      if (target) {
        const hit = Math.hypot(s[0] - target[0], s[1] - target[1]) < 0.051;
        info += hit
          ? `<div class="ok">命中目标！${tex2html(`a=${fmt(a)},\\ b=${fmt(b)}`)}</div>`
          : `<div class="muted">调整 ${tex2html('a')}、${tex2html('b')}，让绿色箭头指向目标 ${tex2html(vtex(target))}</div>`;
      }
    }
    vecs.forEach((w, i) => {
      if (mode === 'combo' && i < 2) {
        plane.arrow([0, 0], w, COLORS[i], { width: 2, label: names[i] });
      } else plane.arrow([0, 0], w, COLORS[i % COLORS.length], { label: names[i] });
      plane.handle(w, String(i), COLORS[i % COLORS.length]);
    });
    if (mode === 'plot') info = vecs.map((w, i) => tex2html(`${vname(i)} = ${vtex(w)}`)).join('　');
    body.querySelector('.r-info').innerHTML = info;
  }

  plane.draggable((id, [x, y]) => {
    vecs[+id] = [snap(x, step), snap(y, step)];
    draw();
  });
  const syncSliders = () => {
    if (!sa) return;
    sa.value = a; sb.value = b;
    body.querySelector('.oa').textContent = fmt(a);
    body.querySelector('.ob').textContent = fmt(b);
  };
  sa?.addEventListener('input', () => { a = Math.round(+sa.value * 10) / 10; syncSliders(); draw(); });
  sb?.addEventListener('input', () => { b = Math.round(+sb.value * 10) / 10; syncSliders(); draw(); });
  syncSliders();
  draw();
}
