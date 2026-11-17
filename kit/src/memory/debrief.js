// 下课后的复盘（以前首页后台一节一节请 Opus 写的固定岗位）第十四轮搬进了 archive/（课后那一轮替代：做不做、写什么由项目 Claude 定）。
// 这里只留读以前写好的复盘的两个函数：以前的课、开课先取的以前的课里照样显示。纯函数。
import { transcriptText } from '../project/transcript.js';

export { transcriptText };
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/** 复盘写成文字（下一节课的课堂、备课带着；上一节的复盘也用它对照） */
export function debriefText(d) {
  if (!d) return '';
  const lines = [];
  for (const m of list(d.mis)) lines.push(`- 误解（${m.state}）：${m.text}${m.basis ? `（${m.basis}）` : ''}`);
  for (const p of list(d.pace)) lines.push(`- 节奏：${p.where}${p.how ? `——${p.how}` : ''}`);
  for (const h of list(d.habit)) lines.push(`- 习惯：${h.text}${h.basis ? `（${h.basis}）` : ''}`);
  if (d.opening) lines.push(`- 下一节开头先测：${d.opening.what}${d.opening.q ? `；题：${d.opening.q}` : ''}`);
  for (const a of list(d.advice)) lines.push(`- 建议：${a}`);
  return lines.join('\n');
}

/** 给我看的几行（「以前的课」那一页、首页「上一节」）：误解的状态、开场先测什么。不放依据里的轮次编号 */
export function debriefView(d) {
  if (!d) return [];
  const out = [];
  const by = (s) => list(d.mis).filter((m) => m.state === s).map((m) => m.text);
  if (by('消了').length) out.push({ kind: 'good', text: `消了：${by('消了').join('；')}` });
  if (by('还在').length) out.push({ kind: 'bad', text: `还在：${by('还在').join('；')}` });
  if (by('绕开了').length) out.push({ kind: 'warn', text: `没真正测过：${by('绕开了').join('；')}` });
  if (by('新冒出').length) out.push({ kind: 'bad', text: `新冒出：${by('新冒出').join('；')}` });
  if (list(d.habit).length) out.push({ kind: 'info', text: `习惯：${list(d.habit).map((h) => h.text).join('；')}` });
  if (d.opening) out.push({ kind: 'next', text: `下节先测：${d.opening.what}` });
  return out;
}
