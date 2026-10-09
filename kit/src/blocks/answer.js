// answer：自己算、自己填，自动判分（认可等价写法）
import { parseScene } from '../scene.js';
import { compile, valueTeX, numText } from '../expr.js';
import { mathInput } from '../mathinput.js';
import { shapeOf, check } from '../check.js';
import { session } from '../session.js';
import { widget, mdToHtml, tex2html } from './common.js';
import { getAI, errorText } from '../ai.js';
import { createPad } from '../ink/pad.js';

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
  addHandwriting(body, shape, input, () => finished);
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

// 手写作答：在手写板上写答案 → Claude 看图转写 → 填进格子，学生确认后再点「检查」
const SHAPE_TEXT = {
  number: () => '一个数',
  vector: (s) => `一个有 ${s.n} 个分量的列向量（从上到下）`,
  matrix: (s) => `一个 ${s.r} 行 ${s.c} 列的矩阵（逐行，每行从左到右）`,
  array: (s) => `一行 ${s.n} 个数（从左到右）`,
};
const cellCount = (s) => (s.kind === 'number' ? 1 : s.kind === 'matrix' ? s.r * s.c : s.n);

function addHandwriting(body, shape, input, isFinished) {
  if (!SHAPE_TEXT[shape.kind]) return;
  getAI().then((ai) => {
    if (!ai?.images || isFinished()) return;
    const actions = body.querySelector('.ans-actions');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ans-pen';
    btn.textContent = '✎ 手写作答';
    actions.appendChild(btn);
    const box = document.createElement('div');
    box.className = 'ans-padbox';
    box.hidden = true;
    actions.after(box);
    const status = document.createElement('div');
    status.className = 'pad-status muted';
    let pad = null;
    btn.addEventListener('click', () => {
      if (!pad) {
        pad = createPad(box, {
          height: shape.kind === 'matrix' ? 240 : 200,
          hint: `用 Apple Pencil 写出答案：${SHAPE_TEXT[shape.kind](shape)}`,
          actions: [{ label: '识别并填入', primary: true, onClick: recognize }],
        });
        box.appendChild(status);
      }
      box.hidden = !box.hidden;
    });

    async function recognize(p) {
      status.textContent = 'Claude 正在看你写的答案…';
      const n = cellCount(shape);
      const prompt = `图片是学生用 Apple Pencil 手写的数学答案（白底黑字）。请把它原样转写成数字。
答案的形状：${SHAPE_TEXT[shape.kind](shape)}，共 ${n} 个数。
只回复一个 JSON 对象：{"cells": [${Array.from({ length: Math.min(n, 3) }, (_, i) => `"第${i + 1}个"`).join(', ')}${n > 3 ? ', ...' : ''}]}
- cells 按上面说的顺序列出全部 ${n} 个数，用字符串写，例如 "3"、"-1/2"、"0.25"。分数线写成 /。
- 原样转写，不要计算、不要纠正；看不清的写 ""。`;
      try {
        const r = await ai.json(prompt, { images: await p.toBlob(), modelTier: 'default' });
        const cells = Array.isArray(r?.cells) ? r.cells.map((c) => String(c ?? '').trim()) : [];
        if (!cells.length) throw { code: 'invalid_json' };
        input.clear();
        input.fill(cells.slice(0, n));
        const unclear = cells.filter((c) => !c).length + Math.max(0, n - cells.length);
        status.textContent = unclear ? `填好了，但有 ${unclear} 个没看清，请补上后再点「检查」。` : '填好了。确认和你写的一样，再点「检查」。';
        box.hidden = true;
        body.querySelector('.ans-feedback').insertAdjacentElement('beforebegin', status);
        p.clear();
      } catch (e) {
        status.textContent = errorText(e);
      }
    }
  });
}

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
