// practice：代码随机出题、代码判分。答对 count 道算过关，可以一直练下去
import { parseFields, list } from '../parse.js';
import { generate } from '../generators.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml, withCalcScope } from './common.js';
import { answerWidget, plain, plainValue, textAnswerSpec } from './answer.js';
import { parseTemplate, instantiate, checkTemplate, fillText, builtinTemplate, BUILTIN_TEMPLATES } from '../practicespec.js';
import { formulaSpec } from '../formula.js';
import { toFloat, calcValue } from '../exact.js';
import { ENGINES } from '../engines/registry.js';
import { stepperBlock } from '../stepper.js';
import { parseUseTemplate, checkUse, drawUse } from '../usespec.js';
import { pickedText } from '../practicespec.js';

const NAMES = { matvec: '矩阵乘向量', columns: '由基向量的去向写矩阵', combo: '列的线性组合', det2: '2×2 行列式', matmul: '矩阵乘法', nullspace: '零空间的基', shellpass: '希尔排序一趟', shellgroup: '希尔排序的子表划分' };

export function practice(el, src) {
  // use: 演示组件当练习题（海明码、Booth、页面置换……）：取数 + 组件的写法，判分用那个组件的引擎
  if (/^\s*use\s*[:：]/mi.test(String(src))) return usePractice(el, src);
  // 自定义题型的模板里有 pick / let / where 命令行，不能按「字段 + 续行」读
  const custom = String(src).match(/^\s*types?\s*[:：]\s*(.*)$/mi)?.[1];
  if (custom && /\bcustom\b/i.test(custom)) {
    if (list(custom).length > 1) throw new Error('type: custom（自定义题型）不能和别的题型混在一起');
    const tpl = parseTemplate(src);
    return templatePractice(el, tpl.fields, [{ tpl, name: '' }]);
  }
  const { fields } = parseFields(src);
  const types = list(fields.type || fields.types || 'matvec');
  // 线代的内置题型（det3、inverse、rank、eigen、eigvec、quadform）是写好的模板，走自定义题型那条路
  const builtin = types.filter((t) => BUILTIN_TEMPLATES[t.toLowerCase()]);
  if (builtin.length) {
    if (builtin.length < types.length) throw new Error(`内置题型 ${builtin.join('、')} 不能和 ${types.filter((t) => !builtin.includes(t)).join('、')} 写在同一个 practice 里：分成两个 practice`);
    return templatePractice(el, fields, builtin.map((t) => ({ tpl: builtinTemplate(t, fields.level), name: BUILTIN_TEMPLATES[t.toLowerCase()].name })));
  }
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
// 内置的线代题型也是模板（BUILTIN_TEMPLATES），几种题型轮着出。fields：组件自己的字段（count、title、note）
function templatePractice(el, fields, tpls) {
  const need = Math.max(1, Number(fields.count) || 3);
  const base = { ...session.vars };
  const kits = tpls.map(({ tpl, name }) => {
    const f = tpl.fields;
    const formulaOf = (vars) => (f.formula || f.calc ? formulaSpec(f.answer, f.formula, vars, { domain: f.domain, calc: f.calc }) : null);
    // check: bin / hex：答案写成二进制 / 十六进制（width: 要求几位）。序列答案要逐题算，自定义题型里先不支持
    const check = (f.check || '').toLowerCase().trim();
    if (/^(seq|sequence|order)$/.test(check)) throw new Error('practice 的自定义题型还不支持 check: seq（序列答案请用 answer 组件的 type: seq）');
    const textOf = (vars) => textAnswerSpec(check, f.answer, { scope: vars, width: f.width });
    // 先取几组数试一遍：模板写错（算不出来、条件取不到）现在就报，别等学生做到那一题
    const errors = checkTemplate(tpl, { base, formulaCheck: f.formula || f.calc ? (vars) => formulaOf(vars) : /^(bin|hex)$/.test(check) ? textOf : null });
    if (errors.length) throw new Error(errors.slice(0, 2).join('；'));
    return { tpl, f, name, check, formulaOf, textOf, prev: null };
  });
  let turn = 0;
  const title = fields.title || '练习 Practice';
  const body = widget(el, { title: escapeHtml(title), cls: 'practice' });
  body.innerHTML = `
    <div class="pr-types muted">${kits.some((x) => x.name) ? `${kits.map((x) => escapeHtml(x.name)).join(' · ')}　·　` : ''}程序随机出题，可以一直练</div>
    ${fields.note ? `<div class="w-note">${mdToHtml(fields.note)}</div>` : ''}
    <div class="pr-head"><div class="pr-dots"></div><span class="pr-count muted"></span></div>
    <div class="pr-problem"></div>
    <div class="pr-nav"><button type="button" class="btn pr-skip">换一题</button><button type="button" class="btn btn-primary pr-next" hidden>下一题 →</button></div>`;
  const done = session.gate(el, title);
  let right = 0, total = 0;
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
    const kit = kits[turn++ % kits.length];
    const f = kit.f;
    const { vars, picked } = instantiate(kit.tpl, { base, avoid: kit.prev });
    kit.prev = picked;
    const formula = kit.formulaOf(vars);
    const text = formula ? null : kit.textOf(vars);
    const value = formula || text ? null : toFloat(calcValue(f.answer, vars).value);
    const check = kit.check;
    const ptitle = kit.name || title;
    const box = body.querySelector('.pr-problem');
    next.hidden = true;
    skip.hidden = false;
    const t0 = Date.now();
    // 记录里的题目：\calc 换成算好的数，课堂 Claude 看得到这一题取的是什么数
    const rq = plain(fillText(f.q, vars).tex.replace(/\$/g, ''));
    const expected = formula ? formula.display : text ? text.display : plainValue(value);
    const onTry = (t) => session.record({ type: 'practice', liveOnly: true, title: ptitle, q: rq, value: t.text, ok: t.ok, attempts: t.attempts, transcript: t.work || undefined, check: t.note, ms: Date.now() - t0, el });
    withCalcScope(vars, () => answerWidget(box, {
      q: f.q, before: f.before, after: f.after, hint: f.hint, explain: f.explain,
      answer: value, formula, text, type: check, scope: vars, onTry,
    }, (r) => {
      total++;
      results.push(r.ok);
      if (r.ok) right++;
      session.record({ type: 'practice', final: true, ms: Date.now() - t0, title: ptitle, q: rq, ok: r.ok, attempts: r.attempts, first: r.first, expected, firstTry: r.ok && r.attempts === 1, work: r.work || undefined, check: r.note, el });
      if (right >= need) done();
      status();
      next.hidden = false;
      skip.hidden = true;
    }));
    if (focus) box.querySelector('.mi-cell, .fi-text, .ti-input')?.focus({ preventScroll: true });
  }

  next.addEventListener('click', () => newProblem());
  skip.addEventListener('click', () => newProblem());
  status();
  newProblem(false);
}

// —— use:：演示组件当练习题（写法见 usespec.js）。每一题换一组数，把那个演示组件画在题目框里 ——
// 组件自己判分、诊断错法、记作答（记录的题目后面带着这一题取的数）；它报「做完了」时这一题结束
const shells = new Map();
function usePractice(el, src) {
  const tpl = parseUseTemplate(src, ENGINES);
  const fields = tpl.fields;
  const need = Math.max(1, Number(fields.count) || 3);
  const base = { ...session.vars };
  const errors = checkUse(tpl, { base });
  if (errors.length) throw new Error(errors.slice(0, 2).join('；'));
  for (const w of errors.warnings) session.problem(el, 'practice', w, { soft: true });
  if (!shells.has(tpl.use)) shells.set(tpl.use, stepperBlock(tpl.engine));
  const shell = shells.get(tpl.use);
  const title = fields.title || `练习：${tpl.engine.title}`;
  const body = widget(el, { title: escapeHtml(title), cls: 'practice pr-use' });
  body.innerHTML = `
    <div class="pr-types muted">程序随机出题、用演示组件判分，可以一直练</div>
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

  function newProblem(focus = true, retry = 0) {
    const box = body.querySelector('.pr-problem');
    next.hidden = true;
    skip.hidden = false;
    box.innerHTML = '';
    const host = document.createElement('div');
    host.className = 'pr-use-host';
    box.append(host);
    let prep;
    try {
      prep = drawUse(tpl, { base, avoid: prev });
      prev = prep.picked;
    } catch (e) {
      // 自检取过十几组都行，个别组合还是可能算不了：换一组，别让学生卡住
      session.problem(el, 'practice', `有一组数没出成题（${e.message}），页面换了一组`, { soft: true });
      if (retry < 5) return newProblem(focus, retry + 1);
      box.innerHTML = `<div class="muted">这道题出不来了：${escapeHtml(e.message)}</div>`;
      return;
    }
    const finals = [];
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      total++;
      // 一题里可能问了好几处（ask:）：都对才算这一题对；都是一次对、没看答案才算「一次对」
      const ok = finals.length > 0 && finals.every((f) => f.ok);
      results.push(ok);
      if (ok) right++;
      if (right >= need) done();
      status();
      next.hidden = false;
      skip.hidden = true;
    };
    withCalcScope(prep.vars, () => shell(host, prep.src, { embedded: true, note: pickedText(prep.picked), onFinal: (e) => finals.push(e), gate: finish }));
    if (focus) host.querySelector('input, textarea')?.focus({ preventScroll: true });
  }

  next.addEventListener('click', () => newProblem());
  skip.addEventListener('click', () => newProblem());
  status();
  newProblem(false);
}
