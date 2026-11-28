// recalldue：板上的记忆点。外部主讲写 board recall id=… n=…，课堂把它包成这个组件画成一段（classroom.js），
// 所以刷新后这一段重画时会重新取到期的。组件自己不认识数据库：向课堂要（session.recallBoard），课堂外面画不了。
import { session } from '../session.js';
import { escapeHtml } from './common.js';
import { parseRecallDue } from '../memory/recall.js';

export function recallDue(el, src) {
  const r = parseRecallDue(src);
  const fail = (msg) => { session.problem(el, 'recalldue', msg); el.innerHTML = `<div class="block-error">${escapeHtml(msg)}</div>`; };
  if (r.error) return fail(r.error);
  el.classList.add('block-recalldue');
  el.innerHTML = '<div class="class-recall"></div>';
  if (!session.recallBoard?.(el.firstChild, { id: el.dataset.bid || '', n: r.n, space: r.space })) fail('recalldue 只在学习台的外部的课里能用：用 board recall id=… 写');
}
