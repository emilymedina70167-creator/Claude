// 含 n 的式子作答框：一个输入框，下面实时写成公式（学生看得到自己写的是什么），配一个符号小键盘（iPad）。
// 接口和 mathinput.js 的格子一样（read / text / partial / mark / markAll / fill / lock / clear / onEnter），
// answer、steps 不用分两套写。读懂写法、代值比较在 formula.js
import katex from 'katex';
import { normalizeFormula, formulaTeX } from './formula.js';

// 预览直接交给 KaTeX：formulaTeX 写出来的式子里没有 \calc、\hl 这些课件里的写法，用不着 render.js 的 tex2html；
// 不 import render.js，舞台（kit/src/stage/）用这个框时不连带整套组件
function texHtml(tex) {
  try { return katex.renderToString(tex, { displayMode: false, throwOnError: false, strict: false }); } catch { return ''; }
}

const SHOW = { alpha: 'α', beta: 'β', gamma: 'γ', lambda: 'λ', mu: 'μ', theta: 'θ' };

/** names：式子里能用的量（自由变量在前，比如 n、A、alpha）；keys：小键盘上放哪几个（默认 names 的前几个） */
export function formulaInput(container, { names = [], keys = names, placeholder = '' } = {}) {
  const root = document.createElement('div');
  root.className = 'fi';
  const v = keys[0] ? SHOW[keys[0]] || keys[0] : 'n';
  const eg = placeholder || `比如 3^(${v}-1)${keys.find((x) => /^[A-Z]$/.test(x)) || ''}`;
  root.innerHTML = `<input class="fi-text" type="text" inputmode="none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" placeholder="${eg}" aria-label="写式子">
    <div class="fi-preview" aria-live="polite"></div>`;
  container.appendChild(root);
  const inp = root.querySelector('.fi-text');
  const preview = root.querySelector('.fi-preview');

  function update() {
    const t = inp.value.trim();
    preview.classList.remove('is-bad');
    if (!t) { preview.innerHTML = ''; return; }
    try {
      preview.innerHTML = texHtml(formulaTeX(normalizeFormula(t, { names })));
    } catch (e) {
      preview.textContent = e.message;
      preview.classList.add('is-bad');
    }
  }
  inp.addEventListener('input', () => { inp.classList.remove('is-wrong', 'is-right'); update(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); hidePad(); root.dispatchEvent(new CustomEvent('mi-enter')); } });
  inp.addEventListener('focus', () => {
    target = inp;
    // Apple Pencil 点进来：用系统的「随手写」直接手写成文字，不弹小键盘
    if (lastPointer === 'pen') { inp.setAttribute('inputmode', 'text'); return; }
    inp.setAttribute('inputmode', 'none');
    showPad(keys);
  });

  return {
    // 读出式子（换成表达式）；没写、看不懂时抛出原因
    read() {
      const t = inp.value.trim();
      if (!t) { inp.focus(); throw new Error('还没写式子'); }
      try { return normalizeFormula(t, { names }); } catch (e) { inp.classList.add('is-wrong'); throw e; }
    },
    text() { return inp.value.trim() || '（没写）'; },
    partial() { return inp.value.trim(); },
    mark(wrong = []) { inp.classList.remove('is-wrong', 'is-right'); if (wrong.length) inp.classList.add('is-wrong'); },
    markAll(cls) { inp.classList.remove('is-wrong', 'is-right'); if (cls) inp.classList.add(cls); },
    fill(value) { inp.value = Array.isArray(value) ? value.join('') : String(value ?? ''); update(); },
    lock(on = true) { inp.disabled = on; },
    clear() { inp.value = ''; update(); },
    root,
    onEnter(f) { root.addEventListener('mi-enter', f); },
  };
}

// —— 符号小键盘（全页共用一个，按正在写的那个框换上它的量）——
let pad = null;
let target = null;
let lastPointer = '';
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);
  document.addEventListener('focusin', (e) => { if (pad && !e.target.classList?.contains('fi-text')) hidePad(); });
  document.addEventListener('pointerdown', (e) => {
    if (pad?.classList.contains('show') && !e.target.closest?.('.keypad, .fi')) hidePad();
  });
}

function showPad(names) {
  if (!pad) {
    pad = document.createElement('div');
    pad.className = 'keypad kp-formula';
    pad.innerHTML = '<div class="kp-keys"></div><div class="kp-side"><button type="button" data-k="ok" class="kp-ok">完成</button></div>';
    // pointerdown + preventDefault：按键时输入框不失去焦点
    pad.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      press(b.dataset.k);
    });
    document.body.appendChild(pad);
  }
  const vars = names.slice(0, 4).map((n) => [n, SHOW[n] || n, 'kp-var']);
  const keys = [...vars, ['(', '('], [')', ')'], ['^', '^'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['+', '+'], ['-', '−'], ['⌫', '⌫'],
    ['4', '4'], ['5', '5'], ['6', '6'], ['·', '·'], ['/', '/'], ['←', '←'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['0', '0'], ["'", 'ᵀ'], ['→', '→']];
  // 量不满一行时补空位，数字区对齐
  const fill = (6 - ((vars.length + 3) % 6)) % 6;
  pad.querySelector('.kp-keys').innerHTML = keys.slice(0, vars.length + 3).map(btn).join('')
    + '<span></span>'.repeat(fill) + keys.slice(vars.length + 3).map(btn).join('');
  pad.classList.add('show');
  document.body.classList.add('has-keypad');
  setTimeout(() => target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}
const btn = ([k, label, cls]) => `<button type="button" data-k="${k}"${cls ? ` class="${cls}"` : ''}>${label}</button>`;

/** 收起符号小键盘（舞台那一问被换掉、页面把输入框整个拿掉时：焦点没走，小键盘不会自己收） */
export function hideFormulaPad() { if (pad?.classList.contains('show')) hidePad(); }

function hidePad() {
  pad?.classList.remove('show');
  target?.blur();
  target = null;
  setTimeout(() => { if (!pad?.classList.contains('show') && !document.querySelector('.keypad.show')) document.body.classList.remove('has-keypad'); }, 450);
}

function press(k) {
  if (!target) return;
  const inp = target;
  const s = inp.value;
  const a = inp.selectionStart ?? s.length, b = inp.selectionEnd ?? s.length;
  const put = (t) => { inp.value = s.slice(0, a) + t + s.slice(b); inp.setSelectionRange(a + t.length, a + t.length); inp.dispatchEvent(new Event('input', { bubbles: true })); };
  if (k === '⌫') {
    if (a !== b) put('');
    else if (a > 0) { inp.value = s.slice(0, a - 1) + s.slice(a); inp.setSelectionRange(a - 1, a - 1); inp.dispatchEvent(new Event('input', { bubbles: true })); }
  } else if (k === '←') inp.setSelectionRange(Math.max(0, a - 1), Math.max(0, a - 1));
  else if (k === '→') inp.setSelectionRange(Math.min(s.length, a + 1), Math.min(s.length, a + 1));
  else if (k === 'ok') { const host = inp.closest('.fi'); hidePad(); host?.dispatchEvent(new CustomEvent('mi-enter')); }
  // 多个字母的量（alpha）写成希腊字母，前后不用加乘号：页面会补
  else put(SHOW[k] || k);
}

/**
 * 按格写的矩阵答案（Aⁿ 的每个元素是含 n 的式子）：每格一个式子框，外面画方括号。接口和 formulaInput 一样，
 * read() 返回每格读懂的式子 [[…]]，mark(wrong) 标出不对的格（按行数的序号）
 */
export function formulaGrid(container, { rows, cols, names = [], keys = names } = {}) {
  const root = document.createElement('div');
  root.className = 'fi-grid-wrap';
  root.innerHTML = `<div class="fi-grid" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr))"></div>`;
  container.appendChild(root);
  const grid = root.querySelector('.fi-grid');
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const box = document.createElement('div');
    box.className = 'fi-cell';
    grid.appendChild(box);
    const f = formulaInput(box, { names, keys, placeholder: `第 ${r + 1} 行第 ${c + 1} 列` });
    f.root.querySelector('.fi-text').setAttribute('aria-label', `第 ${r + 1} 行第 ${c + 1} 列的式子`);
    f.onEnter(() => {
      // 写完一格跳到下一格；最后一格才算交
      const next = cells[r * cols + c + 1];
      if (next) next.root.querySelector('.fi-text').focus();
      else root.dispatchEvent(new CustomEvent('mi-enter'));
    });
    cells.push(f);
  }
  const at = (fn) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => fn(cells[r * cols + c], r, c)));
  return {
    read() {
      return at((f, r, c) => {
        try { return f.read(); } catch (e) { throw new Error(`第 ${r + 1} 行第 ${c + 1} 列：${e.message}`); }
      });
    },
    text() { return `[${at((f) => f.partial() || '?').map((row) => `[${row.join(', ')}]`).join(', ')}]`; },
    // 每格写的原样（没读懂之前的字，空的是 ''）：舞台交给页面判、写给老师的是学生写的样子
    values() { return at((f) => f.partial()); },
    partial() { return cells.some((f) => f.partial()) ? this.text() : ''; },
    mark(wrong = []) { cells.forEach((f, i) => f.markAll(wrong.includes(i) ? 'is-wrong' : '')); },
    markAll(cls) { cells.forEach((f) => f.markAll(cls)); },
    fill(value) {
      const m = Array.isArray(value) ? value : parseCells(String(value ?? ''));
      if (m) cells.forEach((f, i) => f.fill(m[Math.floor(i / cols)]?.[i % cols] ?? ''));
    },
    lock(on = true) { cells.forEach((f) => f.lock(on)); },
    clear() { cells.forEach((f) => f.clear()); },
    root,
    onEnter(fn) { root.addEventListener('mi-enter', fn); },
  };
}
// 「[[2^n, 0], [0, 3^n]]」拆回每一格（看答案、刷新后恢复时填回去）
function parseCells(s) {
  const t = s.trim();
  if (!t.startsWith('[[')) return null;
  const rows = [];
  let depth = 0, cur = '', row = [];
  for (const ch of t.slice(1, -1)) {
    if (ch === '[' && depth === 0) { depth = 1; row = []; cur = ''; continue; }
    if (ch === ']' && depth === 1) { row.push(cur.trim()); rows.push(row); depth = 0; cur = ''; continue; }
    if (depth === 0) continue;
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 1) { row.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return rows;
}
