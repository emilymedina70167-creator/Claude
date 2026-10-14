// 演示引擎共用的画法：一排格子（数组、序列、队列）。纯函数，返回 HTML 字符串。
// 每个格子带 data-cmd="位置"（课堂 highlight 用）和 data-pick="位置"（ask 在图上点用），位置从 base 开始数。

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 一个元素：{ v, mark }（mark：重复的数后面的 ' 个数，画成下划线）或直接是数 / 字
export const itemText = (x) => (x === null || x === undefined ? '' : typeof x === 'object' ? `${x.v}${x.mark ? '′'.repeat(x.mark) : ''}` : String(x));
const itemHtml = (x) => (x === null || x === undefined ? '' : typeof x === 'object' && x.mark ? `<u>${esc(x.v)}</u>` : esc(typeof x === 'object' ? x.v : x));

/**
 * items：要画的元素（null 是空格子）。opts：
 *   base：第一个格子的下标（默认 1）；idx：下面写不写下标（默认写）
 *   cls：{ 位置: 'sv-cmp' 这类 class }；ptr：{ 位置: 'i' }（指针写在格子下面，同一格几个用逗号）
 *   zero：额外画在最左边的一格（插入排序的 A[0]、快排的枢轴）：{ label, item }
 *   lo / hi：当前处理的区间（区间外的淡一点）；fresh：这一步刚变的位置（闪一下）
 *   pick：可以点的格子写 data-pick；label：左边的名字（如 A）
 *   extra：下面再加几行，和格子对齐：[{ label: '比较次数', cells: [...] }]（有 extra 时左边多一栏写每一行是什么）
 */
export function arrayView(items, opts = {}) {
  const { base = 1, idx = true, cls = {}, ptr = {}, zero = null, lo = null, hi = null, fresh = [], pick = true, label = '', extra = [] } = opts;
  const side = extra.length ? (t = '') => `<div class="sv-row-h">${esc(t)}</div>` : () => '';
  const n = items.length;
  const cols = n + (zero ? 1 : 0);
  const freshSet = new Set(fresh);
  const cell = (p, x) => {
    const out = (lo !== null && p < lo) || (hi !== null && p > hi);
    const c = ['sv-cell', x === null || x === undefined ? 'sv-empty' : '', out ? 'sv-out' : '', cls[p] || '', freshSet.has(p) ? 'sv-new' : ''].filter(Boolean).join(' ');
    return `<div class="${c}" data-cmd="${p - base + 1}"${pick ? ` data-pick="${p}"` : ''}>${itemHtml(x)}</div>`;
  };
  // 格子多（散列表、长主串）时格子窄一点，iPad 竖屏一行放得下
  let h = `<div class="sv-arr${extra.length ? ' sv-has-label' : ''}${cols > 12 ? ' sv-dense' : ''}" style="--cols:${cols}">`;
  if (label) h += `<div class="sv-arr-label">${esc(label)}</div>`;
  h += `<div class="sv-row">${side()}`;
  if (zero) h += `<div class="sv-cell sv-zero${zero.cls ? ` ${zero.cls}` : ''}${zero.fresh ? ' sv-new' : ''}">${itemHtml(zero.item)}</div>`;
  for (let i = 0; i < n; i++) h += cell(base + i, items[i]);
  h += '</div>';
  if (idx) {
    h += `<div class="sv-row sv-idx">${side(extra.length ? (base === 0 ? '地址' : '位置') : '')}`;
    if (zero) h += `<div>${esc(zero.label ?? '')}</div>`;
    for (let i = 0; i < n; i++) h += `<div>${base + i}</div>`;
    h += '</div>';
  }
  if (Object.keys(ptr).length) {
    h += `<div class="sv-row sv-ptr">${side()}`;
    if (zero) h += '<div></div>';
    for (let i = 0; i < n; i++) { const t = ptr[base + i]; h += `<div>${t ? `<span>▲</span>${esc(t)}` : ''}</div>`; }
    h += '</div>';
  }
  for (const r of extra) {
    h += `<div class="sv-row sv-extra">${side(r.label)}`;
    if (zero) h += '<div></div>';
    for (let i = 0; i < n; i++) h += `<div>${esc(r.cells[i] ?? '')}</div>`;
    h += '</div>';
  }
  return h + '</div>';
}

/** 几个变量写成一排小牌子：[['i', 3], ['j', 2]]，值是 undefined / null 的不写 */
export function chips(pairs) {
  const list = pairs.filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!list.length) return '';
  return `<div class="sv-chips">${list.map(([k, v]) => `<span class="sv-chip"><b>${esc(k)}</b> ${esc(v)}</span>`).join('')}</div>`;
}
