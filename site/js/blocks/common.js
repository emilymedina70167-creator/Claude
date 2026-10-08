import { tex2html, mdToHtml, escapeHtml } from '../render.js';
import { Frac } from '../linalg.js';

export { tex2html, mdToHtml, escapeHtml };

// 用 HTML 表格画矩阵（方便高亮行/列、点击单元格）
export function matrixHtml(M, { rowCls = {}, colCls = {}, cellCls = {}, augmented = false, clickable = false, name } = {}) {
  const cols = M[0].length;
  let h = `<table class="mx${augmented ? ' mx-aug' : ''}${clickable ? ' mx-click' : ''}"${name ? ` data-name="${name}"` : ''}><tbody>`;
  M.forEach((row, i) => {
    h += `<tr class="${rowCls[i] || ''}">`;
    row.forEach((x, j) => {
      const cls = [colCls[j] || '', cellCls[`${i},${j}`] || '', augmented && j === cols - 1 ? 'aug' : ''].join(' ').trim();
      h += `<td class="${cls}" data-i="${i}" data-j="${j}">${tex2html(cell(x))}</td>`;
    });
    h += '</tr>';
  });
  return h + '</tbody></table>';
}

const cell = (x) => (x instanceof Frac ? x.toTeX() : typeof x === 'number' ? fmtNum(x) : String(x));
const fmtNum = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : String(Number(x.toFixed(2))));

export function widget(el, { title, cls = '' } = {}) {
  el.innerHTML = `<div class="widget ${cls}">${title ? `<div class="w-title">${mdToHtml(title, { inline: true })}</div>` : ''}<div class="w-body"></div></div>`;
  return el.querySelector('.w-body');
}

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
