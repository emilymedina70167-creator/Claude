// 二维线性变换：网格从单位矩阵平滑变到 A，可拖动 î、ĵ 改矩阵
import { parseFields, list } from '../parse.js';
import { parseArray, asMatrix, toNum, eigen2, fmt } from '../linalg.js';
import { createPlane, snap } from '../plot.js';
import { widget, tex2html, mdToHtml } from './common.js';

export function transform2d(el, src) {
  const { fields } = parseFields(src);
  const A0 = toNum(asMatrix(parseArray(fields.matrix || '[[1,0],[0,1]]')));
  if (A0.length !== 2 || A0[0].length !== 2) throw new Error('transform2d 需要 2×2 矩阵');
  let A = A0.map((r) => r.slice());
  const extra = fields.vectors ? toVecs(parseArray(fields.vectors)) : [];
  const show = new Set(list(fields.show || 'det'));
  const editable = fields.editable !== 'false';

  const body = widget(el, { title: fields.title || '线性变换 Linear Transformation' });
  body.innerHTML = `
    <div class="w-plot"></div>
    <div class="w-side">
      <div class="readout r-matrix"></div>
      ${editable ? `<div class="mx-edit">
        <span class="bracket">[</span>
        <div class="mx-inputs">${[0, 1].map((i) => [0, 1].map((j) => `<input inputmode="decimal" data-i="${i}" data-j="${j}" aria-label="a${i + 1}${j + 1}">`).join('')).join('')}</div>
        <span class="bracket">]</span>
      </div>` : ''}
      <div class="t-control">
        <button class="btn btn-play" type="button">▶ 播放</button>
        <input type="range" min="0" max="1" step="0.01" value="0" class="t-slider" aria-label="变换进度">
      </div>
      <div class="readout r-info"></div>
      ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}
      ${editable ? '<div class="w-hint">提示：变换完成后可以直接拖动 î（第一列）和 ĵ（第二列）的箭头。</div>' : ''}
    </div>`;

  const plane = createPlane(body.querySelector('.w-plot'));
  const slider = body.querySelector('.t-slider');
  const playBtn = body.querySelector('.btn-play');
  const inputs = [...body.querySelectorAll('.mx-inputs input')];
  let t = 0;

  const Mt = () => [[1 - t + t * A[0][0], t * A[0][1]], [t * A[1][0], 1 - t + t * A[1][1]]];
  const apply = (M, [x, y]) => [M[0][0] * x + M[0][1] * y, M[1][0] * x + M[1][1] * y];

  function fitRange() {
    const pts = [[1, 0], [0, 1], [1, 1], ...extra].flatMap((v) => [v, apply(A, v)]);
    const m = Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
    plane.range = Math.min(10, Math.max(3, Math.ceil(m + 1)));
  }

  function draw() {
    const M = Mt();
    const R = Math.ceil(plane.range);
    plane.clear();
    plane.grid({ minor: false });
    // 变换后的网格
    const L = R * 4;
    for (let k = -L; k <= L; k++) {
      plane.line(apply(M, [k, -L]), apply(M, [k, L]), k === 0 ? 'tgrid tgrid-axis' : 'tgrid');
      plane.line(apply(M, [-L, k]), apply(M, [L, k]), k === 0 ? 'tgrid tgrid-axis' : 'tgrid');
    }
    if (show.has('det') || show.has('area')) {
      plane.poly([[0, 0], apply(M, [1, 0]), apply(M, [1, 1]), apply(M, [0, 1])], detOf(M) < 0 ? 'area area-neg' : 'area');
    }
    if (show.has('eigen') && t === 1) drawEigen();
    extra.forEach((v, i) => plane.arrow([0, 0], apply(M, v), 'var(--v3)', { label: extra.length > 1 ? `v${i + 1}` : 'v', width: 3 }));
    const i = apply(M, [1, 0]), j = apply(M, [0, 1]);
    plane.arrow([0, 0], i, 'var(--v1)', { label: 'î' });
    plane.arrow([0, 0], j, 'var(--v2)', { label: 'ĵ' });
    if (editable && t === 1) {
      plane.handle(i, 'i', 'var(--v1)');
      plane.handle(j, 'j', 'var(--v2)');
    }
    readouts(M);
  }

  function drawEigen() {
    const e = eigen2(A);
    if (e.complex || e.scalar) return;
    const R = plane.range * 2;
    for (const { vector: [x, y] } of e.pairs) {
      plane.line([-x * R, -y * R], [x * R, y * R], 'eigen-line');
    }
  }

  const detOf = (M) => M[0][0] * M[1][1] - M[0][1] * M[1][0];

  function readouts(M) {
    const shown = t === 1 ? A : M;
    body.querySelector('.r-matrix').innerHTML = tex2html(
      `${t === 1 ? 'A' : 'A_t'} = \\begin{bmatrix} ${fmt(shown[0][0])} & ${fmt(shown[0][1])} \\\\ ${fmt(shown[1][0])} & ${fmt(shown[1][1])} \\end{bmatrix}`,
      true,
    );
    let info = '';
    if (show.has('det') || show.has('area')) {
      const d = detOf(M);
      info += `<div>${tex2html(`\\det = ${fmt(d)}`)}<span class="muted">　${areaText(d)}</span></div>`;
    }
    if (show.has('eigen')) {
      const e = eigen2(A);
      if (t < 1) info += '<div class="muted">播放到最后会显示特征向量方向（虚线）</div>';
      else if (e.complex) info += `<div>${tex2html(`\\lambda = ${fmt(e.re)} \\pm ${fmt(e.im)}i`)}<span class="muted">　复特征值：没有实特征方向（有旋转）</span></div>`;
      else if (e.scalar) info += `<div>${tex2html(`\\lambda = ${fmt(e.values[0])}`)}<span class="muted">　每个方向都是特征方向</span></div>`;
      else info += e.pairs.map(({ value, vector }) => `<div>${tex2html(`\\lambda = ${fmt(value)},\\ \\mathbf v \\propto \\begin{bmatrix}${fmt(vector[0])}\\\\${fmt(vector[1])}\\end{bmatrix}`)}</div>`).join('');
    }
    body.querySelector('.r-info').innerHTML = info;
  }

  function syncInputs() {
    inputs.forEach((inp) => { if (document.activeElement !== inp) inp.value = fmt(A[+inp.dataset.i][+inp.dataset.j]); });
  }

  let anim = null;
  function play() {
    cancelAnimationFrame(anim);
    const from = t >= 1 ? 0 : t;
    const start = performance.now();
    const dur = 1400 * (1 - from);
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      t = from + (1 - from) * (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
      if (k >= 1) t = 1;
      slider.value = t;
      draw();
      if (k < 1) anim = requestAnimationFrame(step);
      else playBtn.textContent = '↺ 重播';
    };
    anim = requestAnimationFrame(step);
  }

  playBtn.addEventListener('click', play);
  slider.addEventListener('input', () => {
    cancelAnimationFrame(anim);
    t = +slider.value;
    playBtn.textContent = t >= 1 ? '↺ 重播' : '▶ 播放';
    draw();
  });
  inputs.forEach((inp) => inp.addEventListener('input', () => {
    const v = Number(inp.value);
    if (inp.value.trim() === '' || Number.isNaN(v)) return;
    A[+inp.dataset.i][+inp.dataset.j] = v;
    fitRange();
    draw();
  }));
  plane.draggable((id, [x, y]) => {
    const c = id === 'i' ? 0 : 1;
    A[0][c] = snap(x, 0.5);
    A[1][c] = snap(y, 0.5);
    syncInputs();
    draw();
  });

  fitRange();
  syncInputs();
  draw();
}

function areaText(d) {
  if (Math.abs(d) < 1e-9) return '压扁成一条线（或一个点）：不可逆';
  const k = Math.abs(d);
  const scale = Math.abs(k - 1) < 1e-9 ? '面积不变' : k > 1 ? `面积放大到 ${fmt(k)} 倍` : `面积缩小到 ${fmt(k)} 倍`;
  return d < 0 ? `${scale}，方向翻转` : scale;
}

function toVecs(a) {
  const v = toNum(a);
  return Array.isArray(v[0]) ? v : [v];
}
