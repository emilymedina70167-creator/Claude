// 行化简：自动用精确分数算出每一步，逐步播放
import { parseFields } from '../parse.js';
import { parseArray, asMatrix, rrefSteps, classify } from '../linalg.js';
import { widget, tex2html, matrixHtml, mdToHtml } from './common.js';

export function rref(el, src) {
  const { fields } = parseFields(src);
  if (!fields.matrix) throw new Error('需要 matrix: [[...], [...]]');
  const M = asMatrix(parseArray(fields.matrix));
  const augmented = /^(true|yes|1|是)$/i.test(fields.augmented || '');
  const mode = (fields.mode || 'rref').toLowerCase() === 'ref' ? 'ref' : 'rref';
  const vars = (fields.vars || '').split(/[,，\s]+/).filter(Boolean);
  const run = rrefSteps(M, { mode, augmented });
  const { steps } = run;
  const nVars = run.cols - (augmented ? 1 : 0);
  const varName = (j) => vars[j] || `x_{${j + 1}}`;

  const body = widget(el, { title: fields.title || (mode === 'rref' ? '行化简 Row Reduction → RREF' : '行化简 Row Reduction → REF') });
  body.innerHTML = `
    <div class="rref-stage">
      <div class="rref-op"></div>
      <div class="rref-mx"></div>
    </div>
    <div class="stepper">
      <button class="btn btn-prev" type="button">◀ 上一步</button>
      <span class="step-count"></span>
      <button class="btn btn-next btn-primary" type="button">下一步 ▶</button>
    </div>
    <div class="readout r-summary"></div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;

  let k = 0;
  const opEl = body.querySelector('.rref-op');
  const mxEl = body.querySelector('.rref-mx');
  const countEl = body.querySelector('.step-count');
  const prev = body.querySelector('.btn-prev');
  const next = body.querySelector('.btn-next');

  function show() {
    const s = steps[k];
    const rowCls = {};
    (s.rows || []).forEach((r) => (rowCls[r] = 'hl'));
    if (s.src !== undefined) rowCls[s.src] = 'hl-src';
    const pivotCells = {};
    if (k === steps.length - 1) run.pivots.forEach(([r, c]) => (pivotCells[`${r},${c}`] = 'pivot'));
    opEl.innerHTML = s.op ? `<span class="muted">第 ${k} 步：</span>${tex2html(s.op)}` : '<span class="muted">原始矩阵</span>';
    mxEl.innerHTML = matrixHtml(s.matrix, { rowCls, cellCls: pivotCells, augmented });
    countEl.textContent = `${k} / ${steps.length - 1}`;
    prev.disabled = k === 0;
    next.disabled = k === steps.length - 1;
    body.querySelector('.r-summary').innerHTML = k === steps.length - 1 ? summary() : '';
  }

  function summary() {
    const done = `<div class="ok">完成${mode === 'rref' ? '：这就是简化行阶梯形 (RREF)' : '：这是行阶梯形 (REF)'}。主元位置已标出。</div>`;
    const info = classify(run);
    if (!info) {
      return `${done}<div>${tex2html(`\\text{rank} = ${run.pivots.length}`)}　<span class="muted">主元列：${run.pivots.map(([, c]) => c + 1).join(', ') || '无'}</span></div>`;
    }
    if (mode !== 'rref') return done;
    if (info.type === 'none') return `${done}<div>出现 ${tex2html('[\\,0\\ \\cdots\\ 0 \\mid b\\,],\\ b\\neq 0')}，方程组<strong>无解</strong>（inconsistent）。</div>`;
    if (info.type === 'unique') return `${done}<div><strong>唯一解</strong>：${tex2html(info.x.map((x, j) => `${varName(j)} = ${x.toTeX()}`).join(',\\ '))}</div>`;
    // 无穷多解：用自由变量写出通解
    const R = run.result;
    const lines = run.pivots.map(([r, c]) => {
      let rhs = R[r][nVars].isZero() ? '' : R[r][nVars].toTeX();
      info.free.forEach((f) => {
        const a = R[r][f];
        if (a.isZero()) return;
        const neg = a.neg();
        const abs = neg.n < 0 ? neg.neg() : neg;
        const cf = abs.isOne() ? '' : abs.toTeX();
        rhs += `${neg.n < 0 ? ' - ' : rhs ? ' + ' : ''}${cf}${varName(f)}`;
      });
      return `${varName(c)} = ${rhs || '0'}`;
    });
    lines.push(...info.free.map((f) => `${varName(f)}\\ \\text{free}`));
    return `${done}<div><strong>无穷多解</strong>，自由变量 ${tex2html(info.free.map(varName).join(', '))}：</div>${tex2html(`\\begin{cases} ${lines.join(' \\\\ ')} \\end{cases}`, true)}`;
  }

  prev.addEventListener('click', () => { if (k > 0) { k--; show(); } });
  next.addEventListener('click', () => { if (k < steps.length - 1) { k++; show(); } });
  show();
}
