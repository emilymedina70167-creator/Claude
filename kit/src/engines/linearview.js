// 线性结构（栈、队列、特殊矩阵、外部排序）演示共用的画法：竖着的栈、一串格子、读到哪儿的输入带、小表格。
// 纯函数，返回 HTML 字符串。格子带 data-key（同一个东西换步时滑过去，morph.js）、data-label（课堂 board mark label=）。
import { esc } from './arrayview.js';

// 一个格子：{ text, key?, cls?, pick?, cmd?, html? }
const cellHtml = (x, base = 'ln-cell') => {
  const c = [base, x.cls || ''].filter(Boolean).join(' ');
  const attrs = [
    x.key ? ` data-key="${esc(x.key)}"` : '',
    x.pick !== undefined ? ` data-pick="${esc(x.pick)}"` : '',
    x.cmd !== undefined ? ` data-cmd="${x.cmd}"` : '',
    x.text !== undefined && x.text !== '' ? ` data-label="${esc(x.text)}"` : '',
  ].join('');
  return `<div class="${c}"${attrs}>${x.html ?? esc(x.text ?? '')}</div>`;
};

/**
 * 竖着的栈：items 从栈底到栈顶。opts：
 *   label：上面写的名字（默认「栈」）；depth：至少留几格高（整个过程里最深的那次，换步时栈不跳）
 *   top：栈顶旁边的字（默认「← 栈顶」，空串不写）
 */
export function stackView(items, { label = '栈', depth = 0, top = '← 栈顶' } = {}) {
  const n = Math.max(depth, items.length, 1);
  const cells = items.map((x, i) => cellHtml({ ...x, html: `${x.html ?? esc(x.text ?? '')}${i === items.length - 1 && top ? `<span class="ln-top">${esc(top)}</span>` : ''}` })).join('');
  return `<div class="ln-stack"><div class="ln-h">${esc(label)}</div><div class="ln-stack-box" style="--depth:${n}">${cells || '<div class="ln-stack-empty muted">（空）</div>'}</div></div>`;
}

/** 一串格子（输出的后缀表达式、出栈序列、归并段……）：label 在左边（窄屏在上面），格子可以折行 */
export function seqView(items, { label = '', empty = '（还没有）', cls = '' } = {}) {
  return `<div class="ln-seq${cls ? ` ${cls}` : ''}">${label ? `<div class="ln-h">${label}</div>` : ''}<div class="ln-seq-row">${items.length ? items.map((x) => cellHtml(x)).join('') : `<span class="ln-seq-empty muted">${esc(empty)}</span>`}</div></div>`;
}

/**
 * 读到哪儿的输入带：toks 是要读的一个个符号，at 是正在读的（从 0 数，-1 是还没开始，toks.length 是读完了）。
 * 读过的淡下去、正在读的框起来。data-cmd 是第几个符号（课堂 highlight i、board mark item=i）
 */
export function tapeView(toks, at, { label = '', cls = {} } = {}) {
  const t = toks.map((x, i) => `<span class="ln-tok${i < at ? ' ln-read' : ''}${i === at ? ' ln-now' : ''}${cls[i] ? ` ${cls[i]}` : ''}" data-cmd="${i + 1}" data-label="${esc(x)}">${esc(x)}</span>`).join('');
  return `<div class="ln-tape">${label ? `<span class="ln-tape-h">${esc(label)}</span>` : ''}${t}</div>`;
}

/** 小表格（三元组表、表头用正文字体）：head 是列名，rows 是一行行的格子（{ html, cls, attrs } 或字符串） */
export function gtable(head, rows, cls = '') {
  const td = (c, tag) => (c && typeof c === 'object' ? `<${tag} class="${c.cls || ''}"${c.attrs || ''}>${c.html}</${tag}>` : `<${tag}>${c ?? ''}</${tag}>`);
  // sv-tab：不吃课件里 Markdown 表格的样式（手写体黄表头、display: block）
  return `<div class="sv-gtbl-wrap"><table class="sv-gtbl sv-tab ${cls}"><thead><tr>${head.map((h) => td(h, 'th')).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => td(c, 'td')).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// 填表：一格的答案是「空的」时，学生写 -、无、空、# 都算（vec 格子不经过 normCell，要自己列出来）
export const EMPTY_ALTS = ['', '-', '—', '无', '空', '#'];
/** 一格向量答案（几个数 / 符号用空格隔开）：空的时候给出空的几种写法；没有空格的写法也算（「+*(」） */
export const vecCell = (list, extra = {}) => (list.length ? { v: [list.join(' '), list.join('')], vec: true, ...extra } : { v: EMPTY_ALTS, vec: true, ...extra });
