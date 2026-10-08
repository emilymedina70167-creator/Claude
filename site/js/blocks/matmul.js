// 矩阵乘法：点结果里的任意元素，看是哪一行乘哪一列
import { parseFields } from '../parse.js';
import { parseArray, asMatrix, matmul as mul } from '../linalg.js';
import { widget, tex2html, matrixHtml, mdToHtml } from './common.js';

export function matmul(el, src) {
  const { fields } = parseFields(src);
  if (!fields.a || !fields.b) throw new Error('需要 A: ... 和 B: ...');
  const A = asMatrix(parseArray(fields.a));
  const B = asMatrix(parseArray(fields.b));
  const C = mul(A, B);

  const body = widget(el, { title: fields.title || '矩阵乘法 Matrix Multiplication' });
  body.innerHTML = `
    <div class="mm-row"><div class="mm-a"></div><div class="mm-op">${tex2html('\\times')}</div><div class="mm-b"></div><div class="mm-op">${tex2html('=')}</div><div class="mm-c"></div></div>
    <div class="readout r-calc"></div>
    <div class="w-hint">点右边结果矩阵里的任意一个数，看它是怎么算出来的。</div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}`;

  function show(i, j) {
    body.querySelector('.mm-a').innerHTML = `<div class="mm-label">${tex2html('A')}</div>` + matrixHtml(A, { rowCls: { [i]: 'hl' } });
    body.querySelector('.mm-b').innerHTML = `<div class="mm-label">${tex2html('B')}</div>` + matrixHtml(B, { colCls: { [j]: 'hl-col' } });
    body.querySelector('.mm-c').innerHTML = `<div class="mm-label">${tex2html('AB')}</div>` + matrixHtml(C, { cellCls: { [`${i},${j}`]: 'hl-cell' }, clickable: true });
    const terms = A[i].map((a, k) => `(${a.toTeX()})(${B[k][j].toTeX()})`).join(' + ');
    body.querySelector('.r-calc').innerHTML = tex2html(`(AB)_{${i + 1}${j + 1}} = \\text{第 ${i + 1} 行} \\cdot \\text{第 ${j + 1} 列} = ${terms} = ${C[i][j].toTeX()}`, true);
  }
  body.addEventListener('click', (e) => {
    const td = e.target.closest('.mx-click td');
    if (td) show(+td.dataset.i, +td.dataset.j);
  });
  show(0, 0);
}
