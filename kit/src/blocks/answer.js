// answer：自己算、自己填，自动判分（认可等价写法）
import { parseScene } from '../scene.js';
import { compile, valueTeX, numText } from '../expr.js';
import { mathInput } from '../mathinput.js';
import { shapeOf, check } from '../check.js';
import { session } from '../session.js';
import { widget, mdToHtml, tex2html } from './common.js';
import { getAI } from '../ai.js';
import { createPad } from '../ink/pad.js';
import { photoPicker, readFinal, flatFinal, photoError, transcriptHtml } from '../photo.js';

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
  let work = ''; // 截图里认出的解答过程（进学习记录）

  // 截图作答：Claude 读出最终答案填进格子，学生核对后自己点「检查」
  const plainQ = String(spec.q || '').replace(/\s+/g, ' ').slice(0, 600) || body.querySelector('.arr-box, .w-q')?.textContent?.slice(0, 600) || '';
  const photo = photoPicker(body.querySelector('.ans-actions'), {
    label: '截图作答',
    root: body,
    async onPick(files, ui) {
      if (finished) return;
      ui.status('Claude 正在读你的解答…', 'is-wait');
      try {
        const r = await readFinal(files, plainQ, shape);
        if (r.transcript) work = r.transcript;
        const flat = flatFinal(r.final, shape);
        if (!flat) {
          ui.status(`没找到符合格式的最终答案。把最终结果在截图里写清楚（或圈出来）再传一次，也可以直接填格子。${r.transcript ? transcriptHtml(r.transcript) : ''}`, 'is-bad');
          return;
        }
        input.clear();
        input.fill(flat);
        ui.status(`已把截图里的最终答案填进格子。核对一遍，没认错就点「检查」。${r.transcript ? transcriptHtml(r.transcript) : ''}`, 'is-ok');
      } catch (e) {
        ui.status(photoError(e), 'is-bad');
      }
    },
  });

  const show = (cls, html) => { fb.hidden = false; fb.className = `ans-feedback ${cls}`; fb.innerHTML = html; };
  const finish = (ok, revealed) => {
    if (finished) return;
    finished = true;
    btnCheck.disabled = true;
    input.lock();
    btnReveal.hidden = true;
    photo.disable();
    onDone?.({ ok, attempts, revealed, first, last: input.text(), work });
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
  addHandwriting(body, shape, input, plainQ, { isFinished: () => finished, onWork: (t) => (work = t) });
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

// 手写作答：在手写板上写解答 → Claude 读出最终答案填进格子（过程进学习记录），学生确认后再点「检查」
const SHAPE_HINT = {
  number: () => '一个数',
  vector: (s) => `${s.n} 个分量的向量`,
  matrix: (s) => `${s.r}×${s.c} 矩阵`,
  array: (s) => `${s.n} 个数`,
};

function addHandwriting(body, shape, input, question, { isFinished, onWork }) {
  if (!SHAPE_HINT[shape.kind]) return;
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
    status.className = 'ph-status';
    status.hidden = true;
    box.after(status);
    const say = (html, cls) => { status.hidden = !html; status.className = `ph-status ${cls || ''}`; status.innerHTML = html || ''; };
    let pad = null;
    btn.addEventListener('click', () => {
      if (!pad) {
        pad = createPad(box, {
          height: shape.kind === 'number' ? 200 : 260,
          hint: `用 Apple Pencil 写解答，最后写出答案（${SHAPE_HINT[shape.kind](shape)}）`,
          actions: [{ label: '识别并填入', primary: true, onClick: recognize }],
        });
      }
      box.hidden = !box.hidden;
      body.classList.toggle('pad-open', !box.hidden); // 手写板打开时先收起截图那一行，界面不挤
    });

    async function recognize(p) {
      if (isFinished()) return;
      say('Claude 正在看你写的解答…', 'is-wait');
      try {
        const r = await readFinal([await p.toBlob()], question, shape);
        if (r.transcript) onWork(r.transcript);
        const flat = flatFinal(r.final, shape);
        if (!flat) {
          say(`没找到符合格式的最终答案。把最终结果写清楚（或圈出来）再识别一次，也可以直接填格子。${r.transcript ? transcriptHtml(r.transcript) : ''}`, 'is-bad');
          return;
        }
        input.clear();
        input.fill(flat);
        box.hidden = true;
        body.classList.remove('pad-open');
        say(`已把你写的最终答案填进格子。核对一遍，没认错就点「检查」。${r.transcript ? transcriptHtml(r.transcript) : ''}`, 'is-ok');
      } catch (e) {
        say(photoError(e), 'is-bad');
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
    session.record({ type: 'answer', title, q: plain(fields.q), ok: r.ok, attempts: r.attempts, first: r.first, expected: plainValue(value), revealed: r.revealed, work: r.work || undefined, stage: session.stageOf(el) });
    done();
  });
}

export const plain = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 200);
export const plainValue = (v) => (Array.isArray(v) ? (Array.isArray(v[0]) ? `[${v.map((r) => r.map(numText).join(' ')).join('; ')}]` : `(${v.map(numText).join(', ')})`) : numText(v));
