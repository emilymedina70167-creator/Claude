// answer：自己算、自己填，自动判分（认可等价写法）
import { parseScene } from '../scene.js';
import { compile, valueTeX, numText } from '../expr.js';
import { mathInput } from '../mathinput.js';
import { shapeOf, check } from '../check.js';
import { session } from '../session.js';
import { widget, mdToHtml, tex2html } from './common.js';

// 通用作答组件：spec = {q, answer, type, before, hint, explain, solution}
// onDone({ok, attempts, revealed, first})
export function answerWidget(body, spec, onDone) {
  const shape = shapeOf(spec.answer, spec.type);
  body._spec = spec; // 方便调试和自动化测试
  body.innerHTML = `
    ${spec.q ? `<div class="w-q">${mdToHtml(spec.q)}</div>` : ''}
    ${spec.qhtml || ''}
    <div class="ans-row">
      ${spec.before ? `<span class="ans-before">${tex2html(spec.before)}</span>` : ''}
      <div class="ans-input"></div>
      ${spec.after ? `<span class="ans-before">${tex2html(spec.after)}</span>` : ''}
    </div>
    <div class="ans-actions">
      <button type="button" class="btn btn-primary ans-check">检查</button>
      ${spec.hint ? '<button type="button" class="btn ans-hint" hidden>提示</button>' : ''}
      <button type="button" class="btn ans-reveal" hidden>看答案</button>
    </div>
    <div class="ans-feedback" hidden></div>`;
  const input = mathInput(body.querySelector('.ans-input'), shape);
  const fb = body.querySelector('.ans-feedback');
  const btnCheck = body.querySelector('.ans-check');
  const btnHint = body.querySelector('.ans-hint');
  const btnReveal = body.querySelector('.ans-reveal');
  let attempts = 0;
  let first = null;
  let finished = false;

  const show = (cls, html) => { fb.hidden = false; fb.className = `ans-feedback ${cls}`; fb.innerHTML = html; };
  const finish = (ok, revealed) => {
    if (finished) return;
    finished = true;
    btnCheck.disabled = true;
    input.lock();
    btnReveal.hidden = true;
    onDone?.({ ok, attempts, revealed, first, last: input.text() });
  };

  function doCheck() {
    if (finished) return;
    let given;
    try { given = input.read(); } catch (e) { show('is-bad', e.message); return; }
    attempts++;
    if (first === null) first = input.text();
    const r = check(given, spec.answer, spec.type);
    if (r.ok) {
      input.markAll('is-right');
      show('is-ok', `<div class="q-verdict">✓ 正确${attempts > 1 ? `（第 ${attempts} 次）` : ''}</div>${r.msg ? `<div>${r.msg}</div>` : ''}${spec.explain ? mdToHtml(spec.explain) : ''}`);
      finish(true, false);
    } else {
      input.mark(r.wrong || []);
      show('is-bad', `<div class="q-verdict">✗ 还不对</div>${r.msg ? `<div>${r.msg}</div>` : ''}${attempts >= 2 ? '<div class="muted">可以看提示，或者直接看答案和解析。</div>' : ''}`);
      if (btnHint) btnHint.hidden = false;
      if (attempts >= 2) btnReveal.hidden = false;
    }
  }

  btnCheck.addEventListener('click', doCheck);
  input.onEnter(doCheck);
  btnHint?.addEventListener('click', () => {
    btnHint.remove();
    fb.insertAdjacentHTML('afterend', `<div class="w-note ans-hint-box"><strong>提示：</strong>${mdToHtml(spec.hint)}</div>`);
  });
  btnReveal.addEventListener('click', () => {
    input.fill(display(spec.answer));
    show('is-reveal', `<div><strong>答案：</strong>${tex2html(valueTeX(spec.answer))}</div>${spec.explain ? mdToHtml(spec.explain) : ''}`);
    finish(false, true);
  });
  return { input };
}

const display = (v) => (Array.isArray(v) ? v.map(display) : numText(v));

export function answer(el, src) {
  const { fields, cmds } = parseScene(src);
  if (!fields.answer) throw new Error('answer 需要 answer:（标准答案或表达式）');
  // 块里可以先 let 定义变量，再用表达式算答案
  const vars = {};
  for (const c of cmds) if (c.kind === 'let') vars[c.name] = c.expr(vars);
  const value = compile(fields.answer)(vars);
  const title = fields.title || '动手算 Try it';
  const body = widget(el, { title, cls: 'answer' });
  const done = session.gate(el, title);
  answerWidget(body, { ...fields, answer: value, type: (fields.type || '').toLowerCase() }, (r) => {
    session.record({ type: 'answer', title, q: plain(fields.q), ok: r.ok, attempts: r.attempts, first: r.first, expected: plainValue(value), revealed: r.revealed, stage: session.stageOf(el) });
    done();
  });
}

export const plain = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 200);
export const plainValue = (v) => (Array.isArray(v) ? (Array.isArray(v[0]) ? `[${v.map((r) => r.map(numText).join(' ')).join('; ')}]` : `(${v.map(numText).join(', ')})`) : numText(v));
