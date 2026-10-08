// 数学作答输入：一个数 / 向量 / 矩阵 / 一组向量（基），配 iPad 友好的数字小键盘
import { Frac } from './linalg.js';

// shape: {kind:'number'} | {kind:'vector', n} | {kind:'matrix', r, c} | {kind:'vectors', n, count}
export function mathInput(container, shape) {
  const root = document.createElement('div');
  root.className = 'mi';
  container.appendChild(root);
  let vecCount = shape.kind === 'vectors' ? Math.max(1, shape.count || 1) : 0;

  function render() {
    if (shape.kind === 'number') {
      root.innerHTML = cell(0, 0, 'mi-single');
    } else if (shape.kind === 'array') {
      root.classList.add('mi-array');
      root.innerHTML = `<div class="mi-arr" style="--cols:${shape.n}">${Array.from({ length: shape.n }, (_, i) => cell(i, 0, 'mi-acell')).join('')}${Array.from({ length: shape.n }, (_, i) => `<div class="mi-aidx">${i + 1}</div>`).join('')}</div>`;
    } else if (shape.kind === 'vector') {
      root.innerHTML = grid(shape.n, 1);
    } else if (shape.kind === 'matrix') {
      root.innerHTML = grid(shape.r, shape.c);
    } else {
      root.innerHTML = `<div class="mi-vecs">${Array.from({ length: vecCount }, (_, k) => `<div class="mi-vecwrap" data-k="${k}">${grid(shape.n, 1, k)}</div>`).join('<span class="mi-comma">,</span>')}</div>
        <div class="mi-vec-tools"><button type="button" class="btn btn-sm mi-add">＋ 加一个向量</button>${vecCount > 1 ? '<button type="button" class="btn btn-sm mi-del">－ 去掉最后一个</button>' : ''}</div>`;
      root.querySelector('.mi-add').onclick = () => { vecCount++; render(); };
      const del = root.querySelector('.mi-del');
      if (del) del.onclick = () => { vecCount--; render(); };
    }
    root.querySelectorAll('input').forEach((inp) => attachKeypad(inp));
  }

  const cell = (i, j, extra = '', k = 0) => `<input class="mi-cell ${extra}" data-i="${i}" data-j="${j}" data-k="${k}" inputmode="none" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="第 ${i + 1} 行第 ${j + 1} 列">`;
  const grid = (r, c, k = 0) => `<div class="mi-grid" style="grid-template-columns: repeat(${c}, auto)">${Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => cell(i, j, '', k)).join('')).join('')}</div>`;

  render();

  return {
    // 读出数值（Frac）；没填或写错会抛出带位置的错误
    read() {
      const val = (inp) => {
        const s = inp.value.trim().replace(/−/g, '-');
        if (!s) { inp.focus(); throw new Error('还有空格没填'); }
        try { return Frac.from(s); } catch { inp.classList.add('is-wrong'); throw new Error(`看不懂「${s}」，请写整数、小数或分数（如 -3/4）`); }
      };
      const at = (k) => [...root.querySelectorAll(`.mi-cell[data-k="${k}"]`)];
      if (shape.kind === 'number') return val(at(0)[0]);
      if (shape.kind === 'vector' || shape.kind === 'array') return at(0).map(val);
      if (shape.kind === 'matrix') {
        const cells = at(0);
        return Array.from({ length: shape.r }, (_, i) => cells.slice(i * shape.c, (i + 1) * shape.c).map(val));
      }
      return Array.from({ length: vecCount }, (_, k) => at(k).map(val));
    },
    text() {
      try {
        const v = this.read();
        const f = (x) => (Array.isArray(x) ? `(${x.map(f).join(', ')})` : String(x));
        if (shape.kind === 'matrix') return `[${v.map((r) => r.map(String).join(' ')).join('; ')}]`;
        if (shape.kind === 'vectors') return `{${v.map(f).join(', ')}}`;
        return f(v);
      } catch { return '（未填完）'; }
    },
    mark(wrong = []) {
      root.querySelectorAll('.mi-cell').forEach((c) => c.classList.remove('is-wrong', 'is-right'));
      for (const w of wrong) root.querySelector(`.mi-cell[data-k="${w.k || 0}"][data-i="${w.i}"][data-j="${w.j || 0}"]`)?.classList.add('is-wrong');
    },
    markAll(cls) { root.querySelectorAll('.mi-cell').forEach((c) => { c.classList.remove('is-wrong', 'is-right'); if (cls) c.classList.add(cls); }); },
    fill(value) {
      const cells = [...root.querySelectorAll('.mi-cell')];
      const flat = (Array.isArray(value) ? value.flat(2) : [value]).map(String);
      cells.forEach((c, i) => { if (flat[i] !== undefined) c.value = flat[i]; });
    },
    lock(on = true) { root.querySelectorAll('input, button').forEach((e) => (e.disabled = on)); },
    clear() { root.querySelectorAll('.mi-cell').forEach((c) => { c.value = ''; c.classList.remove('is-wrong', 'is-right'); }); },
    root,
    onEnter(f) { root.addEventListener('mi-enter', f); },
  };
}

// —— 小键盘（全页共用一个）——
let pad = null;
let target = null;

function attachKeypad(inp) {
  inp.addEventListener('focus', () => { target = inp; showPad(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nextCell(true); }
  });
  inp.addEventListener('input', () => inp.classList.remove('is-wrong', 'is-right'));
}

function showPad() {
  if (!pad) {
    pad = document.createElement('div');
    pad.className = 'keypad';
    pad.innerHTML = `<div class="kp-keys">${['7', '8', '9', '⌫', '4', '5', '6', '−', '1', '2', '3', '/', '0', '.', '←', '→'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>
      <div class="kp-side"><button type="button" data-k="next" class="kp-next">下一格</button><button type="button" data-k="ok" class="kp-ok">完成</button></div>`;
    // 用 pointerdown + preventDefault，避免输入框失去焦点
    pad.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      press(b.dataset.k);
    });
    document.body.appendChild(pad);
  }
  pad.classList.add('show');
  document.body.classList.add('has-keypad');
  setTimeout(() => target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
}

function hidePad() {
  pad?.classList.remove('show');
  target?.blur();
  target = null;
  // 晚一点再收回底部留白：否则正在点的按钮会因为页面跳动而点空
  setTimeout(() => { if (!pad?.classList.contains('show')) document.body.classList.remove('has-keypad'); }, 450);
}

document.addEventListener('focusin', (e) => {
  if (pad && !e.target.classList?.contains('mi-cell')) hidePad();
});
document.addEventListener('pointerdown', (e) => {
  if (pad?.classList.contains('show') && !e.target.closest?.('.keypad, .mi-cell, .mi')) hidePad();
});

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
  else if (k === 'next') nextCell(false);
  else if (k === 'ok') { const host = inp.closest('.mi'); hidePad(); host?.dispatchEvent(new CustomEvent('mi-enter')); }
  else put(k === '−' ? '-' : k);
}

function nextCell(submitAtEnd) {
  if (!target) return;
  const host = target.closest('.mi');
  const cells = [...host.querySelectorAll('.mi-cell')];
  const i = cells.indexOf(target);
  if (i < cells.length - 1) cells[i + 1].focus();
  else if (submitAtEnd) { hidePad(); host.dispatchEvent(new CustomEvent('mi-enter')); }
  else cells[0].focus();
}
