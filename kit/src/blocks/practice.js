// practice：代码随机出题、代码判分。答对 count 道算过关，可以一直练下去
import { parseFields, list } from '../parse.js';
import { generate } from '../generators.js';
import { session } from '../session.js';
import { widget, mdToHtml, escapeHtml } from './common.js';
import { answerWidget, plain, plainValue } from './answer.js';

const NAMES = { matvec: '矩阵乘向量', columns: '由基向量的去向写矩阵', combo: '列的线性组合', det2: '2×2 行列式', matmul: '矩阵乘法', nullspace: '零空间的基', shellpass: '希尔排序一趟', shellgroup: '希尔排序的子表划分' };

export function practice(el, src) {
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
