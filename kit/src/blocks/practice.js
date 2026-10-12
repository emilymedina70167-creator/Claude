// practice：代码随机出题、代码判分。答对 count 道算过关，可以一直练下去
import { parseFields, list } from '../parse.js';
import { generate } from '../generators.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml, withCalcScope } from './common.js';
import { answerWidget, plain, plainValue } from './answer.js';
import { parseTemplate, instantiate, checkTemplate, fillText } from '../practicespec.js';
import { formulaSpec } from '../formula.js';
import { toFloat, calcValue } from '../exact.js';

const NAMES = { matvec: '矩阵乘向量', columns: '由基向量的去向写矩阵', combo: '列的线性组合', det2: '2×2 行列式', matmul: '矩阵乘法', nullspace: '零空间的基', shellpass: '希尔排序一趟', shellgroup: '希尔排序的子表划分' };

export function practice(el, src) {
  // 自定义题型的模板里有 pick / let / where 命令行，不能按「字段 + 续行」读
  const custom = String(src).match(/^\s*types?\s*[:：]\s*(.*)$/mi)?.[1];
  if (custom && /\bcustom\b/i.test(custom)) {
    if (list(custom).length > 1) throw new Error('type: custom（自定义题型）不能和别的题型混在一起');
    return customPractice(el, src);
  }
  const { fields } = parseFields(src);
  const types = list(fields.type || fields.types || 'matvec');
  const need = Math.max(1, Number(fields.count) || 3);
  const level = Number(fields.level) || 1;
  types.forEach((t) => generate(t, level)); // 先检查题型名
  const title = fields.title || '练习 Practice';
  const body = widget(el, { title: escapeHtml(title), cls: 'practice' });
  body.innerHTML = `
    <div class="pr-types muted">${types.map((t) => escapeHtml(NAMES[t] || t)).join(' · ')}　·　程序出题，可以一直练</div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}
    <div class="pr-head"><div class="pr-dots"></div><span class="pr-count muted"></span></div>
    <div class="pr-problem"></div>
    <div class="pr-nav"><button type="button" class="btn pr-skip">换一题</button><button type="button" class="btn btn-primary pr-next" hidden>下一题 →</button></div>`;
  const done = session.gate(el, title);
  let right = 0, total = 0, k = 0;
  const results = [];
  const dots = body.querySelector('.pr-dots');
  const count = body.querySelector('.pr-count');
  const next = body.querySelector('.pr-next');
  const skip = body.querySelector('.pr-skip');

  function status() {
    dots.innerHTML = results.map((r) => `<span class="pr-dot ${r ? 'ok' : 'bad'}"></span>`).join('') + Array.from({ length: Math.max(0, need - right) }, () => '<span class="pr-dot"></span>').join('');
    if (session.live) { count.textContent = total ? `答对 ${right} / 做了 ${total}` : `做 ${need} 道左右`; return; }
    count.textContent = right >= need ? `已过关（答对 ${right} / 做了 ${total}），可以继续练` : `还需答对 ${need - right} 道`;
  }

  function newProblem(focus = true) {
    const p = generate(types[k++ % types.length], level);
    const box = body.querySelector('.pr-problem');
    next.hidden = true;
    skip.hidden = false;
    const t0 = Date.now();
    const rq = plain((p.recordQ || p.q).replace(/\$/g, ''));
    const onTry = (t) => session.record({ type: 'practice', liveOnly: true, title: NAMES[p.gen] || p.gen, q: rq, value: t.text, ok: t.ok, attempts: t.attempts, transcript: t.work || undefined, ms: Date.now() - t0, el });
    answerWidget(box, { ...p, onTry, qhtml: p.qhtml ? `<div class="arr-box">${p.qhtml}</div>` : '' }, (r) => {
      total++;
      const ok = r.ok && r.attempts === 1;
      results.push(r.ok);
      if (r.ok) right++;
      session.record({ type: 'practice', final: true, ms: Date.now() - t0, title: NAMES[p.gen] || p.gen, q: rq, ok: r.ok, attempts: r.attempts, first: r.first, expected: plainValue(p.answer), firstTry: ok, work: r.work || undefined, el });
      if (right >= need) done();
      status();
      next.hidden = false;
      skip.hidden = true;
    });
    if (focus) box.querySelector('.mi-cell')?.focus({ preventScroll: true });
  }

  next.addEventListener('click', () => newProblem());
  skip.addEventListener('click', () => newProblem());
  status();
  newProblem(false);
}

// —— 自定义题型：照模板随机取数出题（写法见 practicespec.js），答案精确算出来判分 ——
function customPractice(el, src) {
  const tpl = parseTemplate(src);
  const { fields } = tpl;
  const need = Math.max(1, Number(fields.count) || 3);
  const base = { ...session.vars };
  const formulaOf = (vars) => (fields.formula ? formulaSpec(fields.answer, fields.formula, vars) : null);
  // 先取几组数试一遍：模板写错（算不出来、条件取不到）现在就报，别等学生做到那一题
  const errors = checkTemplate(tpl, { base, formulaCheck: fields.formula ? (vars) => formulaOf(vars) : null });
  if (errors.length) throw new Error(errors.slice(0, 2).join('；'));
  const title = fields.title || '练习 Practice';
  const body = widget(el, { title: escapeHtml(title), cls: 'practice' });
  body.innerHTML = `
    <div class="pr-types muted">程序随机出题，可以一直练</div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}
    <div class="pr-head"><div class="pr-dots"></div><span class="pr-count muted"></span></div>
    <div class="pr-problem"></div>
    <div class="pr-nav"><button type="button" class="btn pr-skip">换一题</button><button type="button" class="btn btn-primary pr-next" hidden>下一题 →</button></div>`;
  const done = session.gate(el, title);
  let right = 0, total = 0, prev = null;
  const results = [];
  const dots = body.querySelector('.pr-dots');
  const count = body.querySelector('.pr-count');
  const next = body.querySelector('.pr-next');
  const skip = body.querySelector('.pr-skip');

  function status() {
    dots.innerHTML = results.map((r) => `<span class="pr-dot ${r ? 'ok' : 'bad'}"></span>`).join('') + Array.from({ length: Math.max(0, need - right) }, () => '<span class="pr-dot"></span>').join('');
    if (session.live) { count.textContent = total ? `答对 ${right} / 做了 ${total}` : `做 ${need} 道左右`; return; }
    count.textContent = right >= need ? `已过关（答对 ${right} / 做了 ${total}），可以继续练` : `还需答对 ${need - right} 道`;
  }

  function newProblem(focus = true) {
    const { vars, picked } = instantiate(tpl, { base, avoid: prev });
    prev = picked;
    const formula = formulaOf(vars);
    const value = formula ? null : toFloat(calcValue(fields.answer, vars).value);
    const box = body.querySelector('.pr-problem');
    next.hidden = true;
    skip.hidden = false;
    const t0 = Date.now();
    // 记录里的题目：\calc 换成算好的数，课堂 Claude 看得到这一题取的是什么数
    const rq = plain(fillText(fields.q, vars).tex.replace(/\$/g, ''));
    const expected = formula ? formula.display : plainValue(value);
    const onTry = (t) => session.record({ type: 'practice', liveOnly: true, title, q: rq, value: t.text, ok: t.ok, attempts: t.attempts, transcript: t.work || undefined, check: t.note, ms: Date.now() - t0, el });
    withCalcScope(vars, () => answerWidget(box, {
      q: fields.q, before: fields.before, after: fields.after, hint: fields.hint, explain: fields.explain,
      answer: value, formula, type: (fields.check || '').toLowerCase(), scope: vars, onTry,
    }, (r) => {
      total++;
      results.push(r.ok);
      if (r.ok) right++;
      session.record({ type: 'practice', final: true, ms: Date.now() - t0, title, q: rq, ok: r.ok, attempts: r.attempts, first: r.first, expected, firstTry: r.ok && r.attempts === 1, work: r.work || undefined, check: r.note, el });
      if (right >= need) done();
      status();
      next.hidden = false;
      skip.hidden = true;
    }));
    if (focus) box.querySelector('.mi-cell, .fi-text')?.focus({ preventScroll: true });
  }

  next.addEventListener('click', () => newProblem());
  skip.addEventListener('click', () => newProblem());
  status();
  newProblem(false);
}
