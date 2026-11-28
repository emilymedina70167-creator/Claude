// 写一轮的工具（tools/ext-turn.mjs）的纯函数。tests/ext-turn.test.js
// 序号写重了会盖掉上一轮、after 写旧了页面的来回时间就不对：这两样照已有的文档算，不靠手数
const num = (d) => Number(d?.seq) || Number(String(d?.id ?? '').replace(/\D/g, '')) || 0;
const top = (docs) => Math.max(0, ...(docs || []).map(num));

/** 下一条 ext_in：{ id: 三位数, doc }。said、model 没给就不写这两栏 */
export function nextTurn({ ins = [], outs = [], text = '', said = null, model = '', now = Date.now() } = {}) {
  const seq = top(ins) + 1;
  const empty = said == null || said === '' || (Array.isArray(said) && !said.length);
  return { id: String(seq).padStart(3, '0'), doc: { seq, text: String(text), after: top(outs), at: now, ...(empty ? {} : { said }), ...(model ? { model: String(model) } : {}) } };
}

/** 一条 ext_in 执行了没有、页面回了什么：{ state: 'pending' | 'done', lines } */
export function turnStatus(inDoc) {
  if (!inDoc?.done) return { state: 'pending', lines: ['还没执行：学生的页面没开着这节课，或还没轮到'] };
  const r = inDoc.result;
  if (!r || typeof r !== 'object') return { state: 'done', lines: ['执行了，但页面没有回报 result'] };
  const lines = [];
  if (r.error) lines.push(`没执行成：${r.error}`);
  for (const o of r.ops || []) if (!o.ok) lines.push(`${o.op}${o.id ? ` ${o.id}` : o.target ? ` ${o.target}` : ''} 没执行：${o.error || '页面没说原因'}`);
  for (const e of r.errors || []) lines.push(String(e));
  for (const n of r.notes || []) lines.push(String(n));
  for (const m of r.memo || []) lines.push(m.ok ? `记上了：${m.id || m.line || ''}` : `没记上：${m.error || m.line || ''}`);
  if (!lines.length) lines.push(r.summary || '执行了，页面没有报问题');
  return { state: 'done', lines };
}

export const classLink = (sid) => `https://claude.ai/artifact/BCAMUUkMWc2rt5hSS1ULHo#${sid}`;
