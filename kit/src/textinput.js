// 文字型作答的输入框：序列（type: seq）、二进制 / 十六进制（type: bin / hex）。
// 一个输入框，下面实时回显读懂的样子（序列切成一个个格子，位串四位一组），判分后在回显上标出不对的地方。
// 接口和 mathinput.js 一样（read / text / partial / mark / markAll / fill / lock / clear / onEnter），answerWidget 不用分两套。
import { splitSeq, readRadix, groupDigits } from './textcheck.js';
import { escapeHtml } from './render.js';

// shape：{ kind: 'seq', single } | { kind: 'radix', base, width }
export function textAnswerInput(container, shape) {
  const root = document.createElement('div');
  root.className = `ti ti-${shape.kind}`;
  const radix = shape.kind === 'radix';
  const ph = radix
    ? `${shape.base === 2 ? '写 0 和 1' : '写 0–9、A–F'}${shape.width ? `，共 ${shape.width} 位` : ''}，可以空格分组`
    : '按顺序写，用空格或逗号隔开';
  // 二进制只有 0 和 1：用数字键盘；十六进制和序列要字母
  const mode = radix && shape.base === 2 ? 'numeric' : 'text';
  root.innerHTML = `<input class="ti-input" type="text" inputmode="${mode}" autocomplete="off" autocorrect="off" autocapitalize="${radix ? 'characters' : 'off'}" spellcheck="false" placeholder="${escapeHtml(ph)}" aria-label="${escapeHtml(ph)}">
    <div class="ti-echo" aria-hidden="true"></div>`;
  container.appendChild(root);
  const input = root.querySelector('.ti-input');
  const echo = root.querySelector('.ti-echo');
  let wrong = new Set();
  let state = ''; // '' | 'is-right' | 'is-wrong'

  // 回显：序列一个元素一格；位串一位一格、四位之间空开，标出第几位（从左数）
  function paint() {
    const v = input.value;
    if (!v.trim()) { echo.innerHTML = ''; return; }
    if (radix) {
      let d;
      try { d = readRadix(v, shape.base); } catch (e) { echo.innerHTML = `<span class="ti-err">${escapeHtml(e.message)}</span>`; return; }
      const cells = [...d].map((c, i) => `<span class="ti-cell${wrong.has(i) ? ' is-wrong' : state ? ` ${state}` : ''}${(d.length - i) % 4 === 0 && i ? ' ti-gap' : ''}">${c}</span>`).join('');
      echo.innerHTML = `${cells}<span class="ti-count">${d.length} 位</span>`;
    } else {
      const toks = splitSeq(v, { single: shape.single });
      echo.innerHTML = toks.map((t, i) => `<span class="ti-cell${wrong.has(i) ? ' is-wrong' : state ? ` ${state}` : ''}">${escapeHtml(t)}</span>`).join('<span class="ti-sep">→</span>') + `<span class="ti-count">${toks.length} 个</span>`;
    }
  }
  input.addEventListener('input', () => { wrong = new Set(); state = ''; input.classList.remove('is-wrong', 'is-right'); paint(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); root.dispatchEvent(new CustomEvent('mi-enter')); } });

  return {
    // 原样返回写的文字（判分在 textcheck.js 里读懂）；没写抛错
    read() {
      if (!input.value.trim()) { input.focus(); throw new Error('还没写。'); }
      if (radix) readRadix(input.value, shape.base); // 写了不认识的字符：先说清楚，不算一次
      return input.value;
    },
    text() {
      const v = input.value.trim();
      if (!v) return '（未填完）';
      if (radix) { try { return groupDigits(readRadix(v, shape.base)); } catch { return v; } }
      return splitSeq(v, { single: shape.single }).join(' ');
    },
    partial() { return input.value.trim(); },
    mark(w = []) { wrong = new Set(w.map((x) => (typeof x === 'number' ? x : x.i))); state = ''; input.classList.toggle('is-wrong', true); paint(); },
    markAll(cls) { wrong = new Set(); state = cls || ''; input.classList.remove('is-wrong', 'is-right'); if (cls) input.classList.add(cls); paint(); },
    fill(value) { input.value = Array.isArray(value) ? value.join(' ') : String(value ?? ''); paint(); },
    lock(on = true) { input.disabled = on; },
    clear() { input.value = ''; wrong = new Set(); state = ''; paint(); },
    root,
    onEnter(f) { root.addEventListener('mi-enter', f); },
  };
}
