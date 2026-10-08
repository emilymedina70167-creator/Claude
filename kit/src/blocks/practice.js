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
  const title = fields.title || `练习 Practice · ${types.map((t) => NAMES[t] || t).join(' / ')}`;
  const body = widget(el, { title: escapeHtml(title), cls: 'practice' });
  body.innerHTML = `
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
    count.textContent = right >= need ? `已过关（答对 ${right} / 做了 ${total}），可以继续练` : `还需答对 ${need - right} 道`;
  }

  function newProblem(focus = true) {
    const p = generate(types[k++ % types.length], level);
    const box = body.querySelector('.pr-problem');
    next.hidden = true;
    skip.hidden = false;
    answerWidget(box, { ...p, qhtml: p.qhtml ? `<div class="arr-box">${p.qhtml}</div>` : '' }, (r) => {
      total++;
      const ok = r.ok && r.attempts === 1;
      results.push(r.ok);
      if (r.ok) right++;
      session.record({ type: 'practice', title: NAMES[p.gen] || p.gen, q: plain((p.recordQ || p.q).replace(/\$/g, '')), ok: r.ok, attempts: r.attempts, first: r.first, expected: plainValue(p.answer), firstTry: ok, stage: session.stageOf(el) });
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
