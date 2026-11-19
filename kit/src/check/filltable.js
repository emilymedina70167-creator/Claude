// 检验里的 trace：引擎的那张过程表（stepperspec.js 的 fillSpec 排好的）自己填出来。样子和演示组件 mode: fill 的表一样（.sv-fill-t），
// 但不逐格判、不给答案：整张表交给 judge.js 一次判（第一处错以后按学生自己的上一行接着核）。
// values() 的样子正是 checkFill / judge.js 的 trace 要的：values[r][c]（每一行都有，给出的格写给出的字）、values.extra[i]（表下面那几格）
import { cellName, cellAnswer } from '../stepperspec.js';
import { escapeHtml } from '../blocks/common.js';

const givenText = (cell) => { const a = cellAnswer(cell); return a === '（空）' ? '' : a; };

/**
 * host 里画一张表。返回 { el, values(), blanks()（还有几格要填的空着：打勾的格空着也算填了）, empty()（一格都没写）, lock() }
 * onChange()：写的变了
 */
export function fillTable(host, table, { onChange = () => {} } = {}) {
  const t = table;
  const el = document.createElement('div');
  el.className = 'ck-fill';
  const width = (cell) => Math.max(2, Math.min(9, Math.max(...[].concat(cell.v).map((x) => String(x ?? '').length)) + 1));
  const cellHtml = (cell, r, c) => {
    if (cell.given) return `<td class="sv-fill-given">${escapeHtml(givenText(cell))}</td>`;
    if (cell.mark) return `<td><button type="button" class="sv-fill-mark" data-r="${r}" data-c="${c}" aria-pressed="false" aria-label="${escapeHtml(cellName(t, r, c))}：点一下打勾"></button></td>`;
    return `<td><input type="text" class="sv-fill-in" data-r="${r}" data-c="${c}" size="${width(cell)}" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" aria-label="${escapeHtml(cellName(t, r, c))}"></td>`;
  };
  // 「照抄」：把上一行抄过来再改不一样的格子（排序一趟只动几个数，iPad 上一格格重打太慢）
  const copyBtn = (r) => (t.copy && r > 0 ? `<button type="button" class="btn btn-sm sv-fill-copy" data-r="${r}">照抄</button>` : '');
  let grid = '';
  if (t.dir === 'col') {
    grid += `<tr><th></th>${t.rows.map((row) => `<th scope="col">${escapeHtml(row.label ?? '')}</th>`).join('')}</tr>`;
    t.head.forEach((h, c) => { grid += `<tr><th scope="row">${escapeHtml(h)}</th>${t.rows.map((row, r) => cellHtml(row.cells[c], r, c)).join('')}</tr>`; });
    if (t.copy) grid += `<tr class="sv-fill-copyrow"><th></th>${t.rows.map((_, r) => `<td>${copyBtn(r)}</td>`).join('')}</tr>`;
  } else {
    grid += `<tr><th></th>${t.head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}${t.copy ? '<th></th>' : ''}</tr>`;
    t.rows.forEach((row, r) => { grid += `<tr><th scope="row">${escapeHtml(row.label ?? '')}</th>${row.cells.map((cell, c) => cellHtml(cell, r, c)).join('')}${t.copy ? `<td>${copyBtn(r)}</td>` : ''}</tr>`; });
  }
  el.innerHTML = `<div class="sv-fill-wrap"><table class="sv-fill-t${t.dir === 'col' ? ' sv-fill-cols' : ''}">${grid}</table></div>
    ${(t.extra || []).length ? `<div class="sv-fill-extra">${t.extra.map((x, i) => `<label class="sv-fill-x"><span>${escapeHtml(x.label)}</span><input type="text" class="sv-fill-in sv-fill-xin" data-x="${i}" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="${escapeHtml(x.label)}"></label>`).join('')}</div>` : ''}
    ${t.note ? `<div class="w-note">${escapeHtml(t.note)}</div>` : ''}`;
  host.appendChild(el);
  const elOf = (r, c) => el.querySelector(`[data-r="${r}"][data-c="${c}"]:not(.sv-fill-copy)`);
  const inputs = () => [...el.querySelectorAll('.sv-fill-in')];
  let locked = false;

  function values() {
    const v = t.rows.map((row) => row.cells.map((cell) => (cell.given ? givenText(cell) : '')));
    v.extra = (t.extra || []).map(() => '');
    el.querySelectorAll('.sv-fill-in:not(.sv-fill-xin)').forEach((x) => { v[x.dataset.r][x.dataset.c] = x.value; });
    el.querySelectorAll('.sv-fill-xin').forEach((x) => { v.extra[x.dataset.x] = x.value; });
    el.querySelectorAll('.sv-fill-mark').forEach((x) => { v[x.dataset.r][x.dataset.c] = x.getAttribute('aria-pressed') === 'true' ? '√' : ''; });
    return v;
  }

  el.addEventListener('click', (e) => {
    if (locked) return;
    const m = e.target.closest('.sv-fill-mark');
    if (m) { const on = m.getAttribute('aria-pressed') !== 'true'; m.setAttribute('aria-pressed', on ? 'true' : 'false'); m.textContent = on ? '√' : ''; onChange(); return; }
    const cp = e.target.closest('.sv-fill-copy');
    if (!cp) return;
    const r = Number(cp.dataset.r);
    t.rows[r].cells.forEach((cell, c) => {
      const from = elOf(r - 1, c), to = elOf(r, c);
      if (!to || !to.matches('input') || to.value) return;
      if (from?.matches('input')) to.value = from.value;
      else if (t.rows[r - 1].cells[c].given) to.value = givenText(t.rows[r - 1].cells[c]);
    });
    onChange();
  });
  el.addEventListener('input', () => onChange());
  // 回车跳到下一格
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('.sv-fill-in')) return;
    e.preventDefault();
    const all = inputs();
    all[all.indexOf(e.target) + 1]?.focus();
  });

  return {
    el,
    values,
    blanks: () => inputs().filter((x) => !x.value.trim()).length,
    empty: () => inputs().every((x) => !x.value.trim()) && ![...el.querySelectorAll('.sv-fill-mark')].some((x) => x.getAttribute('aria-pressed') === 'true'),
    lock() { locked = true; el.querySelectorAll('input, button').forEach((x) => { x.disabled = true; }); },
  };
}
