// answer：自己算、自己填，自动判分（认可等价写法）
import { parseScene } from '../scene.js';
import { compile, valueTeX, numText } from '../expr.js';
import { mathInput } from '../mathinput.js';
import { shapeOf, check } from '../check.js';
import { session } from '../session.js';
import { widget, mdToHtml as mdRaw, tex2html as texRaw, withCalcScope, calcProblems } from './common.js';
import { letScope, floatVars } from '../exact.js';
import { getAI } from '../ai.js';
import { createPad } from '../ink/pad.js';
import { photoPicker, readFinal, flatFinal, photoError, transcriptHtml } from '../photo.js';
import { FEATURES } from '../features.js';
import { markDraft } from '../drafts.js';
import { formulaInput } from '../formulainput.js';
import { formulaSpec, formulaTeX, compareFormula } from '../formula.js';
import { textAnswerInput } from '../textinput.js';
import { parseSeqAnswer, checkSeq, radixAnswer, checkRadix, groupDigits } from '../textcheck.js';
import { calcValue, isQ } from '../exact.js';

// 通用作答组件：spec = {q, answer, type, before, hint, explain, solution}
// spec.formula（formulaSpec 的结果）：答案是含 n 的式子，学生写式子，页面代值比较
// onDone({ok, attempts, revealed, first, note})
export function answerWidget(body, spec, onDone) {
  // 题面、提示、解析里的 \calc 用组件自己的变量（spec.scope）：解析答完题才画，那时也要用同一份
  const mdToHtml = (t, o) => withCalcScope(spec.scope, () => mdRaw(t, o));
  const tex2html = (t, d) => withCalcScope(spec.scope, () => texRaw(t, d));
  const formula = spec.formula || null;
  // 文字型答案（序列、二进制 / 十六进制）：textAnswerSpec 的结果
  const text = spec.text || null;
  const shape = formula ? { kind: 'formula' } : text ? text.shape : shapeOf(spec.answer, spec.type);
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
  const box = body.querySelector('.ans-input');
  const input = formula ? formulaInput(box, { names: formula.names, keys: formula.keys }) : text ? textAnswerInput(box, shape) : mathInput(box, shape);
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
  // 截图作答只认数、向量、矩阵；写式子、写序列和位串的题不放
  const photo = formula || text ? { disable() {} } : photoPicker(body.querySelector('.ans-actions'), {
    label: '截图作答',
    root: body,
    async onPick(files, ui) {
      if (finished) return;
      ui.status('Claude 正在读你的解答…', 'is-wait');
      session.keepImages(body, files);
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
    onDone?.({ ok, attempts, revealed, first, last: input.text(), work, note: lastNote || undefined });
  };
  let lastNote = ''; // 写式子的题：最后一次代值检查的结果（进作答记录，课堂 Claude 看得到错在哪个 n）

  function doCheck() {
    if (finished) return;
    let given;
    try { given = input.read(); } catch (e) { show('is-bad', e.message); return; }
    let r;
    if (formula) {
      // 用的是页面读懂以后的式子（补了乘号、换了上标），学生写的原样记进记录
      try { r = compareFormula(formula.expected, given, { free: formula.free, scope: formula.scope }); } catch (e) { show('is-bad', e.message); return; }
      // 直接写 A^n 这类「没化简」的：说清楚要怎样写，不算一次
      if (r.powerBan) { input.markAll('is-wrong'); show('is-bad', mdToHtml(r.msg)); return; }
      lastNote = r.note;
      r = { ...r, msg: r.msg ? mdToHtml(r.msg) : '' };
    }
    attempts++;
    lastTried = input.partial();
    if (first === null) first = input.text();
    if (text) r = text.check(given);
    else if (!formula) r = check(given, spec.answer, spec.type);
    spec.onTry?.({ text: input.text(), ok: r.ok, attempts, work, note: lastNote || undefined });
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

  // 草稿：格子填了还没点「检查」（或改了上次检查过的答案）。交过的那次由作答记录说，这里不重复
  let lastTried = '';
  markDraft(body, () => {
    if (finished) return '';
    const t = input.partial();
    return t && t !== lastTried ? t : '';
  });
  btnCheck.addEventListener('click', doCheck);
  input.onEnter(doCheck);
  addHandwriting(body, shape, input, plainQ, { isFinished: () => finished, onWork: (t) => (work = t) });
  btnHint?.addEventListener('click', () => {
    btnHint.remove();
    fb.insertAdjacentHTML('afterend', `<div class="w-note ans-hint-box"><strong>提示：</strong>${mdToHtml(spec.hint)}</div>`);
  });
  btnReveal.addEventListener('click', () => {
    input.fill(formula ? formula.display : text ? text.display : display(spec.answer));
    show('is-reveal', `<div><strong>答案：</strong>${tex2html(formula ? formulaTeX(formula.expected) : text ? text.tex : valueTeX(spec.answer))}</div>${spec.explain ? mdToHtml(spec.explain) : ''}`);
    finish(false, true);
  });
  // 刷新后照作答记录恢复（课堂 / 实时黑板重放）：答对了的把学生填的数填回去，看了答案的照样摊开答案
  function restore({ ok, revealed, value, attempts: n } = {}) {
    if (finished) return;
    attempts = Math.max(1, Number(n) || 1);
    if (revealed) { btnReveal.click(); return; }
    if (!ok) return;
    const nums = String(value ?? '').match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi);
    if (formula) input.fill(value && value !== '（没写）' ? value : formula.display);
    else if (text) input.fill(value && value !== '（未填完）' ? value : text.display);
    else input.fill(nums ? nums.map((x) => numText(Number(x))) : display(spec.answer));
    input.markAll('is-right');
    show('is-ok', `<div class="q-verdict">✓ 正确${attempts > 1 ? `（第 ${attempts} 次）` : ''}</div>${spec.explain ? mdToHtml(spec.explain) : ''}`);
    finish(true, false);
  }
  return { input, restore };
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
    if (!FEATURES.handwriting || !ai?.images || isFinished()) return;
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
        const blob = await p.toBlob();
        session.keepImages(body, blob);
        const r = await readFinal([blob], question, shape);
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
  // 块里可以先 let 定义变量，再用表达式算答案；整节课的量（let 块）也能直接用
  const vars = floatVars(session.vars);
  for (const c of cmds) if (c.kind === 'let') vars[c.name] = c.expr(vars);
  const scope = letScope(cmds, session.vars);
  // formula: n —— 答案是含 n 的式子：学生写式子，页面代几组 n 比较
  const formula = fields.formula ? formulaSpec(fields.answer, fields.formula, scope) : null;
  const text = textAnswerSpec(fields.type, fields.answer, { scope, width: fields.width });
  const value = formula || text ? null : compile(fields.answer)(vars);
  for (const msg of calcProblems([fields.title, fields.q, fields.hint, fields.explain, fields.before, fields.after], scope)) session.problem(el, 'answer', msg);
  const title = fields.title || '动手算 Try it';
  const body = withCalcScope(scope, () => widget(el, { title, cls: 'answer' }));
  const done = session.gate(el, title);
  const onTry = (t) => session.record({ type: 'answer', liveOnly: true, title, q: plain(fields.q), value: t.text, ok: t.ok, attempts: t.attempts, transcript: t.work || undefined, check: t.note, el });
  answerWidget(body, { ...fields, answer: value, formula, text, type: (fields.type || '').toLowerCase(), onTry, scope }, (r) => {
    session.record({ type: 'answer', final: true, title, q: plain(fields.q), ok: r.ok, attempts: r.attempts, first: r.first, last: r.last, expected: formula ? formula.display : text ? text.display : plainValue(value), revealed: r.revealed, work: r.work || undefined, check: r.note, el });
    done();
  });
}

export const plain = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 200);
export const plainValue = (v) => (Array.isArray(v) ? (Array.isArray(v[0]) ? `[${v.map((r) => r.map(numText).join(' ')).join('; ')}]` : `(${v.map(numText).join(', ')})`) : numText(v));

/**
 * 文字型答案（type: seq / bin / hex）→ answerWidget 的 spec.text：{ shape, check(写的) → {ok, wrong, msg}, display, tex }。
 * 别的 type 返回 null。seq 的 answer 是序列原文（几种都对用 | 隔开）；bin / hex 的 answer 是表达式（精确地算），
 * width 是要求写几位（不写就只比数值，前导 0 不管）
 */
export function textAnswerSpec(type, answer, { scope = {}, width } = {}) {
  const t = String(type || '').toLowerCase().trim();
  if (t === 'seq' || t === 'sequence' || t === 'order') {
    const alts = parseSeqAnswer(answer);
    const single = alts.every((a) => a.every((x) => [...x].length === 1));
    const display = alts[0].join(' ');
    return { shape: { kind: 'seq', single }, check: (g) => checkSeq(g, alts), display, tex: `\\text{${alts[0].map(texSafe).join(' → ')}}` };
  }
  if (t === 'bin' || t === 'hex') {
    const base = t === 'bin' ? 2 : 16;
    const w = width === undefined || width === '' ? 0 : Number(width);
    if (!Number.isInteger(w) || w < 0 || w > 64) throw new Error(`width: 写 1 到 64 的整数（现在是「${width}」）`);
    let v = calcValue(answer, scope).value;
    if (isQ(v)) { if (!v.integer) throw new Error(`type: ${t} 的答案要是整数（现在是 ${v}）`); v = v.n; }
    const ans = radixAnswer(v, base, w);
    const shown = groupDigits(ans.digits);
    return { shape: { kind: 'radix', base, width: ans.width }, check: (g) => checkRadix(g, ans), display: shown, tex: `\\texttt{${shown.replace(/ /g, '\\,')}}${base === 16 ? '\\,\\text{H}' : ''}` };
  }
  return null;
}
const texSafe = (s) => String(s).replace(/[\\{}$&#^_%~]/g, (c) => `\\${c}`);
